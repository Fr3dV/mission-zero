// Fichiers statiques : client (/), modules partagés (/shared/), Three.js (/vendor/three/), /healthz.
//
// Les données d'une ville pèsent des dizaines de Mo (routes, bâtiments, points d'intérêt, relief) : ce module ajoute
//  - la compression négociée (brotli puis gzip, node:zlib) des .json/.js/.css/.html/.svg/.bin… ;
//  - un cache des versions compressées, adressé par le CONTENU (sha1) : un fichier n'est compressé qu'une fois.
//    Les versions vivent sur disque (.data/static-cache, STATIC_CACHE_DIR ; pré-remplies au build de l'image) et sont
//    servies depuis une copie en mémoire plafonnée (STATIC_MEMORY_MAX_MB, 64 Mo) : le même tampon sert toutes les
//    requêtes, sans allocation par requête. Si le disque n'est pas inscriptible, le cache est en mémoire seulement ;
//  - ETag (empreinte du contenu) + Last-Modified, réponses 304, `Cache-Control: no-cache` : le navigateur garde tout
//    en cache mais revalide à chaque chargement, donc modules et données sont à jour dès qu'un déploiement les change ;
//  - Vary: Accept-Encoding, HEAD, Content-Length toujours égal au nombre d'octets réellement envoyés.
// L'empreinte vient du contenu et non de la date du fichier (les dates d'une image Docker ne sont pas fiables) ; elle
// est recalculée quand la taille ou la date change, et à chaque démarrage du serveur.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
export const DEFAULT_MOUNTS = [['/shared/', join(ROOT, 'shared')], ['/vendor/three/', join(ROOT, 'node_modules/three')], ['/', join(ROOT, 'client')]];

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.json', '.css', '.svg', '.bin', '.wasm', '.glb', '.txt', '.map']);
const MIN_COMPRESS_BYTES = 1024; // en dessous, le gain ne vaut pas un aller-retour vers le cache
const MIN_GAIN = 0.95; // version compressée gardée seulement si elle fait moins de 95 % de l'original
const MAX_PARALLEL = 2; // compressions simultanées : ~20 Mo de mémoire par encodeur brotli sur un fichier de 10 Mo
const MAX_WAIT_MS = 5000; // au-delà, la requête part sans compression pendant que le cache se remplit
const CHUNK = 64 * 1024; // tampon de lecture, un seul par réponse (réutilisé d'un bloc à l'autre)
const EXT = { br: 'br', gzip: 'gz' };

/** Encodage retenu pour un en-tête Accept-Encoding : 'br', 'gzip' ou null (identité). */
export function pickEncoding(header) {
  if (!header || typeof header !== 'string') return null;
  let br = false, gzip = false;
  for (const part of header.split(',')) {
    const [rawName, ...params] = part.split(';');
    const name = rawName.trim().toLowerCase();
    let q = 1;
    for (const p of params) { const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p); if (m) q = parseFloat(m[1]); }
    if (!(q > 0)) continue;
    if (name === 'br') br = true;
    else if (name === 'gzip' || name === 'x-gzip' || name === '*') gzip = true;
  }
  return br ? 'br' : gzip ? 'gzip' : null;
}

function compressor(enc, size, best) {
  if (enc === 'br') {
    const c = zlib.constants;
    // Fenêtre ajustée à la taille (un petit module ne mobilise pas un gros encodeur) et plafonnée à 1 Mo à
    // l'exécution : mesuré sur un JSON de 10 Mo, fenêtre 2^20 = +18 Mo de mémoire, 2^22 = +92 Mo, même taille en sortie.
    const lgwin = Math.max(10, Math.min(best ? 24 : 20, Math.ceil(Math.log2(Math.max(size, 1024)))));
    return zlib.createBrotliCompress({ params: { [c.BROTLI_PARAM_QUALITY]: best ? 11 : 5, [c.BROTLI_PARAM_SIZE_HINT]: size, [c.BROTLI_PARAM_LGWIN]: lgwin } });
  }
  return zlib.createGzip({ level: best ? 9 : 6 });
}

/**
 * @param {object} opts
 * @param {Array<[string, string]>} [opts.mounts] préfixe d'URL -> dossier (premier qui possède le fichier gagne)
 * @param {string|null} [opts.cacheDir] dossier du cache disque (null = cache mémoire seulement)
 * @param {number} [opts.maxCacheBytes] plafond du cache disque (les plus anciens fichiers sont supprimés)
 * @param {number} [opts.maxMemoryBytes] plafond des versions compressées gardées en mémoire
 * @param {boolean} [opts.best] compression maximale (lente : réservée à la pré-compression au build)
 */
export function createStatic({
  mounts = DEFAULT_MOUNTS,
  cacheDir = process.env.STATIC_CACHE_DIR || join(ROOT, '.data', 'static-cache'),
  maxCacheBytes = (+process.env.STATIC_CACHE_MAX_MB || 256) * 1048576,
  maxMemoryBytes = (+process.env.STATIC_MEMORY_MAX_MB || 64) * 1048576,
  best = false,
  log = () => {},
} = {}) {
  const meta = new Map(); // fichier -> { size, mtimeMs, hash, etag, lastModified }
  const metaPending = new Map();
  // `${hash}.${ext}` -> { size, path (disque) | null, buffer (mémoire) | null, used } — ou null : compression sans intérêt
  const variants = new Map();
  const pending = new Map(); // idem -> Promise
  const counters = { requests: 0, notModified: 0, compressedResponses: 0, identityResponses: 0, compressions: 0, diskHits: 0, compressMs: 0, errors: 0 };
  let disk = cacheDir ? 'unknown' : 'off'; // unknown -> ok | off
  let memoryBytes = 0, writesSincePrune = 0, running = 0, tick = 0;
  const queue = [];

  // ------------------------------------------------------------------ empreinte du contenu

  async function describe(file, st) {
    const known = meta.get(file);
    if (known && known.size === st.size && known.mtimeMs === st.mtimeMs) return known;
    const key = `${file}|${st.size}|${st.mtimeMs}`;
    let p = metaPending.get(key);
    if (!p) {
      p = (async () => {
        const h = createHash('sha1');
        const fh = await open(file, 'r');
        try {
          const buf = Buffer.allocUnsafeSlow(CHUNK);
          for (;;) { const { bytesRead } = await fh.read(buf, 0, CHUNK, null); if (!bytesRead) break; h.update(buf.subarray(0, bytesRead)); }
        } finally { await fh.close().catch(() => {}); }
        const hash = h.digest('base64url');
        const info = { size: st.size, mtimeMs: st.mtimeMs, hash, etag: `W/"${hash}"`, lastModified: new Date(st.mtimeMs).toUTCString() };
        meta.set(file, info);
        return info;
      })().finally(() => metaPending.delete(key));
      metaPending.set(key, p);
    }
    return p;
  }

  // ------------------------------------------------------------------ cache des versions compressées

  async function limited(task) {
    if (running >= MAX_PARALLEL) await new Promise((go) => queue.push(go));
    running++;
    try { return await task(); } finally { running--; queue.shift()?.(); }
  }

  async function ensureDisk() {
    if (disk === 'unknown') {
      try { await mkdir(cacheDir, { recursive: true }); disk = 'ok'; prune().catch(() => {}); }
      catch (e) { disk = 'off'; log(`[statique] cache disque indisponible (${e.code || e.message}) : cache mémoire`); }
    }
    return disk === 'ok';
  }

  /** Supprime les plus anciens fichiers du cache disque quand il dépasse son plafond. */
  async function prune() {
    if (disk !== 'ok') return;
    writesSincePrune = 0;
    const files = [];
    let total = 0;
    for (const name of await readdir(cacheDir)) {
      try {
        const st = await stat(join(cacheDir, name));
        if (!st.isFile()) continue;
        if (name.endsWith('.tmp')) { if (Date.now() - st.mtimeMs > 600000) await unlink(join(cacheDir, name)).catch(() => {}); continue; }
        files.push({ name, size: st.size, mtimeMs: st.mtimeMs }); total += st.size;
      } catch { /* supprimé entre-temps par un autre serveur */ }
    }
    if (total <= maxCacheBytes) return;
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of files) {
      if (total <= maxCacheBytes * 0.75) break;
      await unlink(join(cacheDir, f.name)).catch(() => {});
      const v = variants.get(f.name);
      if (v) { if (v.buffer) v.path = null; else variants.delete(f.name); }
      total -= f.size;
    }
  }

  /** Garde `buffer` en mémoire pour l'entrée `key` ; les moins récemment servies sortent au-delà du plafond. */
  function keep(key, v, buffer) {
    v.buffer = buffer; v.size = buffer.length; v.used = ++tick;
    memoryBytes += buffer.length;
    if (memoryBytes <= maxMemoryBytes) return;
    const others = [...variants].filter(([k, o]) => o?.buffer && k !== key).sort((a, b) => a[1].used - b[1].used);
    for (const [k, o] of others) {
      if (memoryBytes <= maxMemoryBytes) break;
      memoryBytes -= o.buffer.length;
      o.buffer = null;
      if (!o.path) variants.delete(k); // pas de copie sur disque : sera recompressée à la prochaine demande
    }
  }

  /** Contenu compressé en mémoire (chargé du disque au premier usage), ou null s'il doit être lu en flux. */
  async function bufferOf(key, v) {
    if (v.buffer) return v.buffer;
    if (!v.path || v.size > maxMemoryBytes / 4) return null;
    v.loading ||= readFile(v.path).then((b) => { keep(key, v, b); return b; }, () => null).finally(() => { v.loading = null; });
    return v.loading;
  }

  async function compress(file, info, enc, key) {
    const t0 = performance.now();
    const h = createHash('sha1');
    const tap = new Transform({ transform(chunk, _e, cb) { h.update(chunk); cb(null, chunk); } });
    const unchanged = () => h.digest('base64url') === info.hash; // le fichier a pu être réécrit pendant la compression
    const done = (v) => { counters.compressions++; counters.compressMs += performance.now() - t0; variants.set(key, v); return v; };
    if (await ensureDisk()) {
      const final = join(cacheDir, key), tmp = `${final}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      try {
        await pipeline(createReadStream(file), tap, compressor(enc, info.size, best), createWriteStream(tmp));
        const st = await stat(tmp);
        if (!unchanged()) { await unlink(tmp).catch(() => {}); return undefined; }
        if (st.size >= info.size * MIN_GAIN) { await unlink(tmp).catch(() => {}); return done(null); }
        await rename(tmp, final);
        if (++writesSincePrune >= 200) prune().catch(() => {});
        return done({ size: st.size, path: final, buffer: null, used: ++tick });
      } catch (e) {
        await unlink(tmp).catch(() => {});
        // seule une erreur d'écriture dans le cache fait basculer en mémoire (pas un fichier source disparu)
        if (e.path === file || !['EACCES', 'EROFS', 'ENOSPC', 'EPERM', 'ENOENT', 'EDQUOT'].includes(e.code)) throw e;
        disk = 'off';
        log(`[statique] écriture du cache impossible (${e.code}) : cache mémoire`);
        return compress(file, info, enc, key);
      }
    }
    const chunks = [];
    const sink = new Transform({ transform(chunk, _e, cb) { chunks.push(chunk); cb(); } });
    await pipeline(createReadStream(file), tap, compressor(enc, info.size, best), sink);
    if (!unchanged()) return undefined;
    const buffer = Buffer.concat(chunks);
    if (buffer.length >= info.size * MIN_GAIN) return done(null);
    const v = done({ size: buffer.length, path: null, buffer: null, used: 0 });
    keep(key, v, buffer);
    return v;
  }

  /** Version compressée d'un fichier : entrée du cache, null si la compression n'apporte rien, undefined si indisponible. */
  async function variant(file, info, enc) {
    const key = `${info.hash}.${EXT[enc]}`;
    if (variants.has(key)) return variants.get(key);
    let p = pending.get(key);
    if (!p) {
      p = (async () => {
        if (!best && await ensureDisk()) {
          try {
            const st = await stat(join(cacheDir, key));
            if (st.isFile() && st.size > 0) { const v = { size: st.size, path: join(cacheDir, key), buffer: null, used: ++tick }; variants.set(key, v); counters.diskHits++; return v; }
          } catch { /* pas encore dans le cache */ }
        }
        return limited(() => compress(file, info, enc, key));
      })().catch((e) => { counters.errors++; log(`[statique] compression de ${file} : ${e.message}`); return undefined; })
        .finally(() => pending.delete(key));
      pending.set(key, p);
    }
    return p;
  }

  // ------------------------------------------------------------------ réponse

  function fresh(req, info) {
    const inm = req.headers['if-none-match'];
    if (inm != null) {
      if (inm.trim() === '*') return true;
      const strong = info.etag.slice(2);
      return inm.split(',').some((t) => t.trim().replace(/^W\//, '') === strong);
    }
    const since = Date.parse(req.headers['if-modified-since'] || '');
    return Number.isFinite(since) && Math.floor(info.mtimeMs / 1000) * 1000 <= since;
  }

  /** Envoie `length` octets du fichier ouvert, avec un seul tampon réutilisé : mémoire constante par connexion. */
  async function pump(fh, length, res) {
    // Si le client coupe, le rappel de write peut ne jamais venir : 'close' débloque alors l'attente en cours.
    let wake = null;
    const onClose = () => wake?.();
    res.on('close', onClose);
    try {
      const buf = Buffer.allocUnsafeSlow(Math.min(CHUNK, length));
      let pos = 0;
      while (pos < length && !res.destroyed) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, length - pos), pos);
        if (!bytesRead) break; // fichier raccourci pendant l'envoi
        pos += bytesRead;
        // le tampon n'est réutilisé qu'une fois ce bloc remis au système (rappel de write)
        await new Promise((next) => { wake = next; res.write(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead), next); });
      }
      if (res.destroyed) return;
      if (pos < length) res.destroy(); else res.end();
    } catch { res.destroy(); } finally { res.off('close', onClose); await fh.close().catch(() => {}); }
  }

  async function sendFile(req, res, file, st) {
    const ext = extname(file).toLowerCase();
    const info = await describe(file, st);
    const compressible = COMPRESSIBLE.has(ext);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: info.etag, 'Last-Modified': info.lastModified };
    if (compressible) headers.Vary = 'Accept-Encoding';
    if (fresh(req, info)) { counters.notModified++; res.writeHead(304, headers).end(); return; }

    const head = req.method === 'HEAD';
    const enc = compressible && info.size >= MIN_COMPRESS_BYTES ? pickEncoding(req.headers['accept-encoding']) : null;
    const key = enc ? `${info.hash}.${EXT[enc]}` : null;
    let v = null, timer;
    if (enc) {
      v = await Promise.race([variant(file, info, enc), new Promise((ok) => { timer = setTimeout(ok, MAX_WAIT_MS); })]);
      clearTimeout(timer);
    }
    if (res.destroyed) return;

    // Le contenu est en main (tampon, ou fichier OUVERT) avant d'annoncer sa taille : on envoie exactement ce nombre d'octets.
    let fh = null, length = 0, encoded = false, buffer = null;
    if (v) {
      v.used = ++tick;
      if (!head) buffer = await bufferOf(key, v);
      if (buffer) { length = buffer.length; encoded = true; }
      else if (head) { length = v.size; encoded = true; } // HEAD : la taille suffit, rien à charger
      else if (v.path) {
        try { fh = await open(v.path, 'r'); length = (await fh.stat()).size; encoded = true; }
        catch { await fh?.close().catch(() => {}); fh = null; variants.delete(key); } // purgé par un autre serveur : identité, recompressé ensuite
      }
    }
    if (!encoded) {
      fh = await open(file, 'r');
      try { length = (await fh.stat()).size; } catch (e) { await fh.close().catch(() => {}); throw e; }
    }
    if (res.destroyed) { await fh?.close().catch(() => {}); return; }
    if (encoded) { counters.compressedResponses++; headers['Content-Encoding'] = enc; } else counters.identityResponses++;
    headers['Content-Length'] = length;
    res.writeHead(200, headers);
    if (head || length === 0) { await fh?.close().catch(() => {}); res.end(); return; }
    if (buffer) { res.end(buffer); return; } // le même tampon pour toutes les requêtes : aucune copie
    await pump(fh, length, res);
  }

  async function handle(req, res) {
    counters.requests++;
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch { res.writeHead(400).end('bad request'); return; }
    if (path === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end('method not allowed'); return; }
    if (path.includes('\0')) { res.writeHead(400).end('bad request'); return; }
    if (path.endsWith('/')) path += 'index.html';
    for (const [prefix, dir] of mounts) {
      if (!path.startsWith(prefix)) continue;
      const file = normalize(join(dir, path.slice(prefix.length)));
      if (file !== dir && !file.startsWith(dir + sep)) break;
      let st;
      try { st = await stat(file); } catch { continue; } // essayer le montage suivant
      if (!st.isFile()) continue;
      await sendFile(req, res, file, st);
      return;
    }
    res.writeHead(404).end('not found');
  }

  /** Gestionnaire http (req, res). Ne rejette jamais. */
  function serve(req, res) {
    return handle(req, res).catch((e) => {
      counters.errors++;
      log(`[statique] ${req.url} : ${e?.message || e}`);
      if (res.headersSent) res.destroy(); else res.writeHead(500).end('erreur interne');
    });
  }

  /** Fichiers compressibles d'un dossier (récursif), avec leur taille. */
  async function walk(dir, out = []) {
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) await walk(full, out); }
      else if (e.isFile() && COMPRESSIBLE.has(extname(e.name).toLowerCase())) {
        try { const st = await stat(full); if (st.size >= MIN_COMPRESS_BYTES) out.push({ file: full, st }); } catch { /* supprimé entre-temps */ }
      }
    }
    return out;
  }

  /**
   * Remplit le cache en tâche de fond, un fichier à la fois, les plus gros d'abord (rien n'est chargé en mémoire).
   * @param {{dirs?: string[], files?: string[], minBytes?: number, encodings?: string[]}} o
   * @returns {Promise<{files: number, bytes: number, br: number, gzip: number, ms: number}>}
   */
  async function prewarm({ dirs = [], files = [], minBytes = MIN_COMPRESS_BYTES, encodings = ['br', 'gzip'] } = {}) {
    const t0 = performance.now();
    const list = [];
    for (const dir of dirs) await walk(dir, list);
    for (const file of files) { try { const st = await stat(file); if (st.isFile()) list.push({ file, st }); } catch { /* absent */ } }
    const todo = list.filter((f) => f.st.size >= minBytes).sort((a, b) => b.st.size - a.st.size);
    const sum = { files: 0, bytes: 0, br: 0, gzip: 0, ms: 0 };
    for (const { file, st } of todo) {
      try {
        const info = await describe(file, st);
        sum.files++; sum.bytes += info.size;
        for (const enc of encodings) { const v = await variant(file, info, enc); sum[enc] += v ? v.size : info.size; }
      } catch (e) { log(`[statique] pré-compression de ${file} : ${e.message}`); }
    }
    sum.ms = Math.round(performance.now() - t0);
    return sum;
  }

  serve.prewarm = prewarm;
  serve.stats = () => ({ ...counters, compressMs: Math.round(counters.compressMs), disk, cacheDir, memoryBytes, files: meta.size, variants: variants.size });
  return serve;
}

// Instance par défaut du serveur de jeu (créée au premier appel : importer ce module ne touche pas au disque).
let instance = null;
export const defaultStatic = () => (instance ||= createStatic({ log: (m) => console.warn(m) }));
export function serveStatic(req, res) { return defaultStatic()(req, res); }

/** Dossiers et fichiers qui méritent d'être pré-compressés (données des villes, modules du jeu, Three.js). */
export const PREWARM = {
  dirs: [join(ROOT, 'shared'), join(ROOT, 'client')],
  files: [join(ROOT, 'node_modules/three/build/three.module.js')],
};

// Serveur statique : compression négociée (brotli/gzip), cache des versions compressées, ETag/304, HEAD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStatic, pickEncoding } from '../static.js';
import { raw } from '../testkit.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mz-static-'));
  const www = join(dir, 'www'), cache = join(dir, 'cache');
  mkdirSync(join(www, 'world'), { recursive: true });
  const roads = Buffer.from(JSON.stringify({ roads: Array.from({ length: 4000 }, (_, i) => ({ id: i, name: 'Allées Jean-Jaurès', kind: 'boulevard', points: [[i, i * 2], [i + 10.5, i * 2 + 3.5]] })) }));
  const floats = new Float32Array(60000);
  for (let i = 0; i < floats.length; i++) floats[i] = Math.round(Math.sin(i) * 75000) / 10;
  const bin = Buffer.from(floats.buffer);
  const png = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7919) % 251));
  writeFileSync(join(www, 'world', 'roads.json'), roads);
  writeFileSync(join(www, 'world', 'buildings.bin'), bin);
  writeFileSync(join(www, 'small.js'), 'export const x = 1;\n');
  writeFileSync(join(www, 'image.png'), png);
  writeFileSync(join(www, 'index.html'), '<!doctype html><title>essai</title>' + '<p>bonjour</p>'.repeat(300));
  writeFileSync(join(dir, 'secret.txt'), 'hors du dossier servi '.repeat(100));
  return { dir, www, cache, roads, floats, bin, png, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((ok) => server.listen(0, ok));
  return { url: `http://localhost:${server.address().port}`, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }) };
}

test('pickEncoding : brotli avant gzip, q=0 respecté, identité par défaut', () => {
  assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
  assert.equal(pickEncoding('gzip, deflate'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0'), null);
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding('*'), 'gzip');
  assert.equal(pickEncoding(''), null);
  assert.equal(pickEncoding(undefined), null);
});

test('compression négociée : br, gzip, identité — contenu intact, Content-Length exact, Vary', async () => {
  const f = fixture();
  const serve = createStatic({ mounts: [['/', f.www]], cacheDir: f.cache });
  const srv = await listen(serve);
  try {
    const url = srv.url + '/world/roads.json';
    const br = await raw(url, { headers: { 'Accept-Encoding': 'gzip, deflate, br' } });
    assert.equal(br.status, 200);
    assert.equal(br.headers['content-encoding'], 'br');
    assert.equal(+br.headers['content-length'], br.body.length);
    assert.ok(br.body.length < f.roads.length / 4, `brotli : ${br.body.length} / ${f.roads.length}`);
    assert.ok(zlib.brotliDecompressSync(br.body).equals(f.roads));
    assert.equal(br.headers.vary, 'Accept-Encoding');
    assert.equal(br.headers['cache-control'], 'no-cache');
    assert.match(br.headers.etag, /^W\/"[\w-]+"$/);
    assert.ok(Number.isFinite(Date.parse(br.headers['last-modified'])));
    assert.match(br.headers['content-type'], /^application\/json/);

    const gz = await raw(url, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(+gz.headers['content-length'], gz.body.length);
    assert.ok(zlib.gunzipSync(gz.body).equals(f.roads));
    assert.equal(gz.headers.etag, br.headers.etag, 'même empreinte quelle que soit la compression');

    // client sans Accept-Encoding (ou qui refuse tout) : fichier brut, taille exacte
    for (const headers of [{}, { 'Accept-Encoding': 'identity' }, { 'Accept-Encoding': 'br;q=0, gzip;q=0' }]) {
      const id = await raw(url, { headers });
      assert.equal(id.status, 200);
      assert.equal(id.headers['content-encoding'], undefined);
      assert.equal(+id.headers['content-length'], f.roads.length);
      assert.ok(id.body.equals(f.roads));
      assert.equal(id.headers.vary, 'Accept-Encoding', 'Vary présent même sans compression');
    }

    // binaire Float32 : les octets décompressés redonnent exactement le tableau
    const bin = await raw(srv.url + '/world/buildings.bin', { headers: { 'Accept-Encoding': 'br' } });
    assert.equal(bin.headers['content-encoding'], 'br');
    assert.equal(bin.headers['content-type'], 'application/octet-stream');
    assert.equal(+bin.headers['content-length'], bin.body.length);
    const out = zlib.brotliDecompressSync(bin.body);
    const floats = new Float32Array(out.buffer, out.byteOffset, out.byteLength / 4);
    assert.equal(floats.length, f.floats.length);
    assert.deepEqual(Array.from(floats.subarray(0, 1000)), Array.from(f.floats.subarray(0, 1000)));
    assert.ok(out.equals(f.bin));
    assert.ok((await raw(srv.url + '/world/buildings.bin')).body.equals(f.bin));

    // petit fichier et type déjà compressé : servis tels quels
    const small = await raw(srv.url + '/small.js', { headers: { 'Accept-Encoding': 'br' } });
    assert.equal(small.headers['content-encoding'], undefined);
    assert.equal(small.body.toString(), 'export const x = 1;\n');
    assert.match(small.headers['content-type'], /^text\/javascript/);
    const png = await raw(srv.url + '/image.png', { headers: { 'Accept-Encoding': 'br' } });
    assert.equal(png.headers['content-encoding'], undefined);
    assert.equal(png.headers.vary, undefined);
    assert.ok(png.body.equals(f.png));
    // index.html d'un dossier
    const index = await raw(srv.url + '/', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(index.headers['content-encoding'], 'gzip');
    assert.match(zlib.gunzipSync(index.body).toString(), /^<!doctype html>/);
  } finally { await srv.close(); f.cleanup(); }
});

test('cache : un fichier n\'est compressé qu\'une fois (disque partagé entre serveurs), recompressé si le contenu change', async () => {
  const f = fixture();
  const serve = createStatic({ mounts: [['/', f.www]], cacheDir: f.cache });
  const srv = await listen(serve);
  const url = srv.url + '/world/roads.json', br = { headers: { 'Accept-Encoding': 'br' } };
  try {
    // 8 requêtes simultanées à froid : une seule compression
    const all = await Promise.all(Array.from({ length: 8 }, () => raw(url, br)));
    assert.ok(all.every((r) => r.headers['content-encoding'] === 'br' && r.body.equals(all[0].body)));
    assert.equal(serve.stats().compressions, 1);
    await raw(url, br); await raw(url, br);
    assert.equal(serve.stats().compressions, 1, 'les requêtes suivantes sortent du cache');
    assert.equal(readdirSync(f.cache).filter((n) => n.endsWith('.br')).length, 1);
    assert.equal(readdirSync(f.cache).filter((n) => n.endsWith('.tmp')).length, 0);

    // un autre serveur (redémarrage, autre instance) retrouve la version compressée sur disque
    const serve2 = createStatic({ mounts: [['/', f.www]], cacheDir: f.cache });
    const srv2 = await listen(serve2);
    const again = await raw(srv2.url + '/world/roads.json', br);
    assert.ok(again.body.equals(all[0].body));
    assert.deepEqual([serve2.stats().compressions, serve2.stats().diskHits], [0, 1]);
    await srv2.close();

    // contenu modifié : nouvelle empreinte, nouvelle compression, plus jamais l'ancienne version
    const next = Buffer.from(JSON.stringify({ roads: [], note: 'x'.repeat(5000) }));
    writeFileSync(join(f.www, 'world', 'roads.json'), next);
    const changed = await raw(url, br);
    assert.notEqual(changed.headers.etag, all[0].headers.etag);
    assert.ok(zlib.brotliDecompressSync(changed.body).equals(next));
    assert.equal(serve.stats().compressions, 2);

    // même taille et même date, contenu différent (cas d'une image Docker aux dates figées) : l'empreinte change au redémarrage
    const file = join(f.www, 'small.js'), when = new Date('2024-01-01T00:00:00Z');
    writeFileSync(file, 'export const x = 1;\n'); utimesSync(file, when, when);
    const s1 = createStatic({ mounts: [['/', f.www]], cacheDir: f.cache }), l1 = await listen(s1);
    const e1 = (await raw(l1.url + '/small.js')).headers.etag; await l1.close();
    writeFileSync(file, 'export const x = 2;\n'); utimesSync(file, when, when);
    const s2 = createStatic({ mounts: [['/', f.www]], cacheDir: f.cache }), l2 = await listen(s2);
    const r2 = await raw(l2.url + '/small.js', { headers: { 'If-None-Match': e1 } }); await l2.close();
    assert.equal(r2.status, 200, 'un module modifié sans changer de taille ni de date est bien renvoyé');
    assert.equal(r2.body.toString(), 'export const x = 2;\n');
  } finally { await srv.close(); f.cleanup(); }
});

test('cache disque indisponible : repli en mémoire, toujours compressé', async () => {
  const f = fixture();
  writeFileSync(join(f.dir, 'pas-un-dossier'), 'x');
  const serve = createStatic({ mounts: [['/', f.www]], cacheDir: join(f.dir, 'pas-un-dossier', 'cache') });
  const none = createStatic({ mounts: [['/', f.www]], cacheDir: null });
  const srv = await listen(serve), srv2 = await listen(none);
  try {
    for (const [s, h] of [[srv, serve], [srv2, none]]) {
      const a = await raw(s.url + '/world/roads.json', { headers: { 'Accept-Encoding': 'br' } });
      const b = await raw(s.url + '/world/roads.json', { headers: { 'Accept-Encoding': 'br' } });
      assert.equal(a.headers['content-encoding'], 'br');
      assert.equal(+b.headers['content-length'], b.body.length);
      assert.ok(zlib.brotliDecompressSync(b.body).equals(f.roads));
      assert.deepEqual([h.stats().disk, h.stats().compressions], ['off', 1]);
      assert.ok(h.stats().memoryBytes > 0);
    }
  } finally { await srv.close(); await srv2.close(); f.cleanup(); }
});

test('304 : If-None-Match (faible, fort, liste, *) et If-Modified-Since', async () => {
  const f = fixture();
  const srv = await listen(createStatic({ mounts: [['/', f.www]], cacheDir: f.cache }));
  try {
    const url = srv.url + '/world/roads.json';
    const first = await raw(url, { headers: { 'Accept-Encoding': 'br' } });
    const etag = first.headers.etag, strong = etag.slice(2);
    for (const inm of [etag, strong, `"autre", ${etag}`, '*']) {
      const r = await raw(url, { headers: { 'If-None-Match': inm, 'Accept-Encoding': 'br' } });
      assert.equal(r.status, 304, inm);
      assert.equal(r.body.length, 0);
      assert.equal(r.headers.etag, etag);
      assert.equal(r.headers.vary, 'Accept-Encoding');
      assert.equal(r.headers['cache-control'], 'no-cache');
    }
    assert.equal((await raw(url, { headers: { 'If-None-Match': '"autre"' } })).status, 200);
    assert.equal((await raw(url, { headers: { 'If-Modified-Since': first.headers['last-modified'] } })).status, 304);
    assert.equal((await raw(url, { headers: { 'If-Modified-Since': 'Mon, 01 Jan 2001 00:00:00 GMT' } })).status, 200);
    // If-None-Match l'emporte sur If-Modified-Since
    assert.equal((await raw(url, { headers: { 'If-None-Match': '"autre"', 'If-Modified-Since': first.headers['last-modified'] } })).status, 200);

    // fichier modifié : la revalidation renvoie le nouveau contenu
    writeFileSync(join(f.www, 'world', 'roads.json'), '{"roads":[]}');
    const after = await raw(url, { headers: { 'If-None-Match': etag } });
    assert.equal(after.status, 200);
    assert.equal(after.body.toString(), '{"roads":[]}');
  } finally { await srv.close(); f.cleanup(); }
});

test('HEAD, méthodes, chemins : en-têtes identiques au GET sans corps ; 404, 405, pas de sortie du dossier', async () => {
  const f = fixture();
  const srv = await listen(createStatic({ mounts: [['/data/', join(f.www, 'world')], ['/', f.www]], cacheDir: f.cache }));
  try {
    for (const enc of ['br', 'gzip', undefined]) {
      const headers = enc ? { 'Accept-Encoding': enc } : {};
      const head = await raw(srv.url + '/world/roads.json', { method: 'HEAD', headers });
      const get = await raw(srv.url + '/world/roads.json', { headers });
      assert.equal(head.status, 200);
      assert.equal(head.body.length, 0);
      for (const h of ['content-length', 'content-encoding', 'content-type', 'etag', 'last-modified', 'vary', 'cache-control']) assert.equal(head.headers[h], get.headers[h], `${h} (${enc})`);
      assert.equal(+get.headers['content-length'], get.body.length);
    }
    assert.equal((await raw(srv.url + '/world/roads.json', { method: 'HEAD', headers: { 'If-None-Match': '*' } })).status, 304);
    // montages : le premier préfixe qui possède le fichier gagne, sinon le suivant
    assert.ok((await raw(srv.url + '/data/roads.json')).body.equals(f.roads));
    assert.equal((await raw(srv.url + '/data/absent.json')).status, 404);
    assert.equal((await raw(srv.url + '/healthz')).body.toString(), 'ok');
    assert.equal((await raw(srv.url + '/absent.js')).status, 404);
    assert.equal((await raw(srv.url + '/world')).status, 404, 'un dossier n\'est pas un fichier');
    for (const path of ['/..%2Fsecret.txt', '/%2e%2e/secret.txt', '/world/..%2F..%2Fsecret.txt', '/data/..%2F..%2Fsecret.txt', '/small.js%00.png', '/%E0%A4%A']) {
      const r = await raw(srv.url + path);
      assert.ok([400, 404].includes(r.status), `${path} -> ${r.status}`);
      assert.ok(!r.body.toString().includes('hors du dossier'));
    }
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const r = await raw(srv.url + '/small.js', { method });
      assert.equal(r.status, 405);
      assert.equal(r.headers.allow, 'GET, HEAD');
    }
  } finally { await srv.close(); f.cleanup(); }
});

test('pré-compression : remplit le cache (les plus gros d\'abord), les requêtes ne compressent plus rien', async () => {
  const f = fixture();
  const builder = createStatic({ mounts: [['/', f.www]], cacheDir: f.cache, best: true }); // ce que fait le build de l'image
  const sum = await builder.prewarm({ dirs: [f.www] });
  assert.equal(sum.files, 3, 'roads.json, buildings.bin, index.html (small.js trop petit, image.png non compressible)');
  assert.ok(sum.br < sum.bytes && sum.gzip < sum.bytes);
  const serve = createStatic({ mounts: [['/', f.www]], cacheDir: f.cache });
  const srv = await listen(serve);
  try {
    for (const enc of ['br', 'gzip']) {
      const r = await raw(srv.url + '/world/roads.json', { headers: { 'Accept-Encoding': enc } });
      assert.equal(r.headers['content-encoding'], enc);
      assert.ok((enc === 'br' ? zlib.brotliDecompressSync(r.body) : zlib.gunzipSync(r.body)).equals(f.roads));
    }
    assert.equal(serve.stats().compressions, 0);
    assert.equal(serve.stats().diskHits, 2);
  } finally { await srv.close(); f.cleanup(); }
});

test('mémoire plafonnée : version trop grosse lue en flux depuis le disque, éviction des moins utilisées, contenu toujours exact', async () => {
  const f = fixture();
  // plafond minuscule : aucune version compressée ne tient en mémoire -> lecture en flux depuis le cache disque
  const streamed = createStatic({ mounts: [['/', f.www]], cacheDir: f.cache, maxMemoryBytes: 1024 });
  // sans disque et avec un plafond inférieur à deux versions : la première sort quand la seconde entre, puis est recompressée
  const tiny = createStatic({ mounts: [['/', f.www]], cacheDir: null, maxMemoryBytes: 20000 });
  const a = await listen(streamed), b = await listen(tiny);
  try {
    for (const srv of [a, b]) {
      for (let round = 0; round < 3; round++) {
        const roads = await raw(srv.url + '/world/roads.json', { headers: { 'Accept-Encoding': 'br' } });
        const bin = await raw(srv.url + '/world/buildings.bin', { headers: { 'Accept-Encoding': 'gzip' } });
        assert.equal(roads.headers['content-encoding'], 'br');
        assert.equal(+roads.headers['content-length'], roads.body.length);
        assert.ok(zlib.brotliDecompressSync(roads.body).equals(f.roads));
        assert.equal(+bin.headers['content-length'], bin.body.length);
        assert.ok(zlib.gunzipSync(bin.body).equals(f.bin));
      }
    }
    assert.equal(streamed.stats().memoryBytes, 0);
    assert.equal(streamed.stats().compressions, 2);
    assert.ok(tiny.stats().memoryBytes <= 250000, `mémoire du cache : ${tiny.stats().memoryBytes}`);
    assert.ok(tiny.stats().compressions > 2, 'les versions évincées sont recompressées à la demande');
  } finally { await a.close(); await b.close(); f.cleanup(); }
});

test('client qui coupe en plein téléchargement : le serveur continue de répondre', async () => {
  const f = fixture();
  const big = Buffer.alloc(6 * 1048576, 'mission zéro ');
  writeFileSync(join(f.www, 'world', 'gros.bin'), big);
  const serve = createStatic({ mounts: [['/', f.www]], cacheDir: f.cache });
  const srv = await listen(serve);
  try {
    for (let i = 0; i < 5; i++) {
      await new Promise((ok) => {
        const req = http.get(srv.url + '/world/gros.bin', (res) => { res.once('data', () => { req.destroy(); ok(); }); });
        req.on('error', () => {});
      });
    }
    const full = await raw(srv.url + '/world/gros.bin');
    assert.equal(+full.headers['content-length'], big.length);
    assert.ok(full.body.equals(big));
    assert.equal(serve.stats().errors, 0);
  } finally { await srv.close(); f.cleanup(); }
});

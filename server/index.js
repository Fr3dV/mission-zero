// Serveur Mission Zéro : fichiers statiques + WebSocket multijoueur (/ws).
// PROPRIÉTAIRE : agent "serveur/réseau". Ce fichier est un squelette minimal (statique seulement).
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = +(process.env.PORT || 8080);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
const MOUNTS = [['/shared/', join(ROOT, 'shared')], ['/vendor/three/', join(ROOT, 'node_modules/three')], ['/', join(ROOT, 'client')]];

export function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/healthz') { res.writeHead(200).end('ok'); return; }
  if (path.endsWith('/')) path += 'index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!path.startsWith(prefix)) continue;
    const file = normalize(join(dir, path.slice(prefix.length)));
    if (!file.startsWith(dir)) break;
    try {
      const st = statSync(file);
      if (!st.isFile()) continue;
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      createReadStream(file).pipe(res);
      return;
    } catch { /* essayer le montage suivant */ }
  }
  res.writeHead(404).end('not found');
}

const server = http.createServer(serveStatic);
server.listen(PORT, () => console.log(`Mission Zéro sur http://localhost:${PORT}`));

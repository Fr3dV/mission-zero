// Fichiers statiques : client (/), modules partagés (/shared/), Three.js (/vendor/three/), /healthz.
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
const MOUNTS = [['/shared/', join(ROOT, 'shared')], ['/vendor/three/', join(ROOT, 'node_modules/three')], ['/', join(ROOT, 'client')]];

export function serveStatic(req, res) {
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400).end('bad request'); return; }
  if (path === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end('method not allowed'); return; }
  if (path.endsWith('/')) path += 'index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!path.startsWith(prefix)) continue;
    const file = normalize(join(dir, path.slice(prefix.length)));
    if (!file.startsWith(dir)) break;
    try {
      const st = statSync(file);
      if (!st.isFile()) continue;
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
      return;
    } catch { /* essayer le montage suivant */ }
  }
  res.writeHead(404).end('not found');
}

// Génère tools/out/osm-preview.png : sert le projet en statique sur le port 8101 puis capture
// tools/osm/preview.html avec tools/shot.mjs.
// Usage : node tools/osm/preview.mjs [sortie.png] [cx cz span]   (zoom optionnel, en mètres)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 8101;
const [out = join(ROOT, 'tools', 'out', 'osm-preview.png'), cx, cz, span] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.includes('..')) throw new Error('chemin refusé');
    const buf = await readFile(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(buf);
  } catch { res.writeHead(404); res.end('introuvable'); }
});
server.listen(PORT, '127.0.0.1', () => {
  const query = span ? `?cx=${cx}&cz=${cz}&span=${span}` : '';
  const child = spawn(process.execPath, [join(ROOT, 'tools', 'shot.mjs'), `http://127.0.0.1:${PORT}/tools/osm/preview.html${query}`, out, '--wait', '2500', '--w', '1700', '--h', '1560'], { stdio: 'inherit', cwd: ROOT });
  child.on('exit', (code) => { server.close(); console.log('aperçu :', out); process.exit(code ?? 0); });
});

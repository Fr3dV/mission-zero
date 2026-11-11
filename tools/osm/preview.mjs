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
// Option --city <id> (défaut paris) : pour une ville du contrat v5 (toulouse), page tools/osm/v5/preview.html et
// sortie tools/out/tls-preview.png ; options supplémentaires --ele, --nodes, --terrain.
const argv = process.argv.slice(2); const flags = {};
for (const f of ['city']) { const i = argv.indexOf('--' + f); if (i >= 0) { flags[f] = argv[i + 1]; argv.splice(i, 2); } }
for (const f of ['ele', 'nodes', 'terrain']) { const i = argv.indexOf('--' + f); if (i >= 0) { flags[f] = 1; argv.splice(i, 1); } }
const CITY = flags.city || 'paris';
const [out = join(ROOT, 'tools', 'out', CITY === 'paris' ? 'osm-preview.png' : CITY === 'toulouse' ? 'tls-preview.png' : CITY + '-preview.png'), cx, cz, span] = argv;
const TYPES = { '.bin': 'application/octet-stream', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.includes('..')) throw new Error('chemin refusé');
    const buf = await readFile(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(buf);
  } catch { res.writeHead(404); res.end('introuvable'); }
});
server.listen(PORT, '127.0.0.1', () => {
  let query = span ? `?cx=${cx}&cz=${cz}&span=${span}` : '?';
  if (CITY !== 'paris') query += `&city=${CITY}` + ['ele', 'nodes', 'terrain'].filter((f) => flags[f]).map((f) => `&${f}=1`).join('');
  const page = CITY === 'paris' ? 'tools/osm/preview.html' : 'tools/osm/v5/preview.html';
  const child = spawn(process.execPath, [join(ROOT, 'tools', 'shot.mjs'), `http://127.0.0.1:${PORT}/${page}${query}`, out, '--wait', CITY === 'paris' ? '2500' : '7000', '--w', '1700', '--h', '1560'], { stdio: 'inherit', cwd: ROOT });
  child.on('exit', (code) => { server.close(); console.log('aperçu :', out); process.exit(code ?? 0); });
});

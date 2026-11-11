// Outils communs de la chaîne « multi-villes » (contrat v5) : projection de la ville, cache, téléchargements.
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CITIES, geoFor } from '../../../shared/cities.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const argOpt = (name, def) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; };
export const argFlag = (name) => process.argv.includes('--' + name);
export const CITY_ID = argOpt('city', 'toulouse');
if (!CITIES[CITY_ID]) { console.error('ville inconnue : ' + CITY_ID); process.exit(2); }
export const GEO = geoFor(CITY_ID);
export const { BBOX, BOUNDS, lonLatToXZ, xzToLonLat } = GEO;
export const CACHE = join(ROOT, '.data', 'osm-' + CITY_ID);
export const OUT = join(ROOT, 'shared', 'world', CITY_ID);
mkdirSync(CACHE, { recursive: true }); mkdirSync(OUT, { recursive: true });

export const UA = 'osm-extract-script/1.0';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = promisify(execFile);
/** curl (texte ou binaire). opts : { post: {k: v}, binary: bool, timeout: s } */
export async function curl(url, opts = {}) {
  const args = ['-sS', '--fail', '--compressed', '-m', String(opts.timeout || 200), '-A', UA];
  for (const [k, v] of Object.entries(opts.post || {})) args.push('--data-urlencode', k + '=' + v);
  args.push(url);
  const { stdout } = await run('curl', args, { maxBuffer: 1 << 30, encoding: opts.binary ? 'buffer' : 'utf8' });
  return stdout;
}
export const cachePath = (name) => join(CACHE, name);
export const cached = (name) => existsSync(cachePath(name));
export const readJSON = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const loadCache = (name) => (cached(name) ? readJSON(cachePath(name)) : null);
export function writeAtomic(file, data) { // data : chaîne, Buffer ou objet (JSON)
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  writeFileSync(file + '.tmp', body); renameSync(file + '.tmp', file); return body.length;
}
export const saveCache = (name, data) => writeAtomic(cachePath(name), data);
/** Éléments Overpass d'une couche, toutes tuiles confondues, dédoublonnés par type+id. */
export function loadLayer(name) {
  const out = [], seen = new Set();
  const files = [];
  if (cached(name + '.json')) files.push(name + '.json');
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) if (cached(`${name}_${i}_${j}.json`)) files.push(`${name}_${i}_${j}.json`);
  for (const f of files) for (const e of readJSON(cachePath(f)).elements) { const k = e.type[0] + e.id; if (seen.has(k)) continue; seen.add(k); out.push(e); }
  return out;
}
export const num = (v) => { if (v == null) return NaN; const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
export const inBounds = (x, z, m = 0) => x >= BOUNDS.minX - m && x <= BOUNDS.maxX + m && z >= BOUNDS.minZ - m && z <= BOUNDS.maxZ + m;

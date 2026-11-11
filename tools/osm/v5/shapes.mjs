// Géométrie des éléments OSM dans le repère de la ville + chargeurs partagés (MNT, emprises IGN).
import { readFileSync, readdirSync } from 'node:fs';
import { lonLatToXZ, BOUNDS, CACHE, cached, cachePath, readJSON } from './common.mjs';
import { r1, polyArea, simplifyRing, dedupeRing, clipRect, selfIntersects, assembleRings, pointInPoly } from '../geom.mjs';

export const xz = (g) => lonLatToXZ(g.lon, g.lat);
// Emprise de découpe : BOUNDS rentré de 0,1 m (l'arrondi à 0,1 m ne doit pas faire sortir un point).
export const CLIP = { minX: BOUNDS.minX + 0.1, maxX: BOUNDS.maxX - 0.1, minZ: BOUNDS.minZ + 0.1, maxZ: BOUNDS.maxZ - 0.1 };

/** Anneaux extérieurs / intérieurs d'un way fermé ou d'une relation multipolygone (mètres). */
export function ringsOf(e) {
  if (e.type === 'way') {
    if (!e.geometry || e.geometry.length < 4) return { outers: [], inners: [] };
    const g = e.geometry.filter(Boolean).map(xz);
    const closed = Math.hypot(g[0][0] - g[g.length - 1][0], g[0][1] - g[g.length - 1][1]) < 0.01;
    return { outers: closed ? [g.slice(0, -1)] : [], inners: [] };
  }
  const ws = (inner) => (e.members || []).filter((m) => m.type === 'way' && m.geometry && (m.role === 'inner') === inner).map((m) => m.geometry.filter(Boolean).map(xz));
  return { outers: assembleRings(ws(false)), inners: assembleRings(ws(true)) };
}
/** Polygone propre : découpé à l'emprise, simplifié, arrondi à 0,1 m, sens horaire vu de dessus (aire signée > 0). */
export function cleanPoly(ring, tol = 1.5) {
  const clipped = clipRect(ring, CLIP);
  if (clipped.length < 3) return null;
  let p = dedupeRing(simplifyRing(clipped, tol).map(([x, z]) => [r1(x), r1(z)]), 0.01);
  if (p.length < 3 || selfIntersects(p)) {
    p = dedupeRing(clipped.map(([x, z]) => [r1(x), r1(z)]), 0.01);
    if (p.length < 3 || (p.length < 1500 && selfIntersects(p))) return null;
  }
  if (polyArea(p) < 0) p.reverse();
  return p;
}
export const perimeter = (p) => { let l = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; l += Math.hypot(q[0] - p[i][0], q[1] - p[i][1]); } return l; };
export const bboxOf = (p) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const [x, z] of p) { if (x < a) a = x; if (x > b) b = x; if (z < c) c = z; if (z > d) d = z; } return [a, b, c, d]; };

/** Index spatial de polygones : inside(x, z) -> premier polygone contenant le point (ou null). */
export function polyIndex(polys, G = 100) {
  const grid = new Map();
  polys.forEach((p, i) => { const [a, b, c, d] = bboxOf(p.polygon || p); for (let gx = Math.floor(a / G); gx <= Math.floor(b / G); gx++) for (let gz = Math.floor(c / G); gz <= Math.floor(d / G); gz++) { const k = gx * 100003 + gz; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i); } });
  return { find(x, z) { for (const i of grid.get(Math.floor(x / G) * 100003 + Math.floor(z / G)) || []) if (pointInPoly(x, z, polys[i].polygon || polys[i])) return polys[i]; return null; } };
}

/** MNT brut (IGN RGE ALTI, pas de 10 m) : { x0, z0, cell, nx, nz, data: Float32Array, at(x, z) } ou null. */
export function loadDem() {
  if (!cached('dem.bin') || !cached('dem.json')) return null;
  const m = readJSON(cachePath('dem.json')), buf = readFileSync(cachePath('dem.bin'));
  const data = new Float32Array(buf.buffer, buf.byteOffset, m.nx * m.nz);
  const at = (x, z) => {
    const fx = (x - m.x0) / m.cell, fz = (z - m.z0) / m.cell;
    if (!(fx >= 0 && fz >= 0 && fx <= m.nx - 1.001 && fz <= m.nz - 1.001)) return NaN;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, i = iz * m.nx + ix;
    const a = data[i] + (data[i + 1] - data[i]) * tx, b = data[i + m.nx] + (data[i + m.nx + 1] - data[i + m.nx]) * tx;
    const h = a + (b - a) * tz; return h > -1000 && h < 5000 ? h : NaN;
  };
  return { ...m, data, at };
}

/** Emprises de bâtiments de la BD TOPO (toutes tuiles, dédoublonnées). Chaque entrée : { id, n, u1, u2, lg, st, h, e, nl, mm, mt, d, zs, polys }. */
export function loadIgnBuildings() {
  const files = readdirSync(CACHE).filter((f) => /^ign_bat_\d+_\d+\.json$/.test(f)).sort();
  if (!files.length) return null;
  const seen = new Set(), out = [];
  for (const f of files) for (const b of readJSON(cachePath(f)).features) { if (seen.has(b.id)) continue; seen.add(b.id); out.push(b); }
  return out;
}

/**
 * Arbres réels de la ville : jeu « Arbres urbains » de Toulouse Métropole s'il est en cache (avec le genre : platane…),
 * complété par les arbres OSM (natural=tree) situés à plus de 3 m d'un arbre déjà connu.
 * Retourne { list: [[x, z, genre]], sources: { metropole, osm } } — uniquement les arbres dans BOUNDS.
 */
export function loadTrees() {
  const list = [], G = 6, grid = new Map(), sources = { metropole: 0, osm: 0 };
  const key = (x, z) => Math.floor(x / G) * 100003 + Math.floor(z / G);
  const near = (x, z) => { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const i of grid.get(key(x + dx * G, z + dz * G)) || []) if (Math.hypot(list[i][0] - x, list[i][1] - z) < 3) return true; return false; };
  const add = (x, z, genus, src, minDist) => { if (x < CLIP.minX || x > CLIP.maxX || z < CLIP.minZ || z > CLIP.maxZ) return; if (minDist && near(x, z)) return; const k = key(x, z); let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(list.length); list.push([r1(x), r1(z), genus]); sources[src]++; };
  if (cached('metro_trees.json')) for (const [lon, lat, genus] of readJSON(cachePath('metro_trees.json')).trees) { const [x, z] = lonLatToXZ(lon, lat); add(x, z, /^0_|inconnu/i.test(genus) ? '' : genus, 'metropole', true); }
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { const f = `trees_${i}_${j}.json`; if (!cached(f)) continue; for (const e of readJSON(cachePath(f)).elements) { if (e.type !== 'node') continue; const [x, z] = xz(e); add(x, z, '', 'osm', true); } }
  return { list, sources };
}

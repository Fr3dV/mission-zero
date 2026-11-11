// Construit shared/world/<ville>/terrain.json : relief réel (IGN RGE ALTI) ramené au repère du moteur, où les quais
// sont à y = 0 et l'eau à −4 partout. À lancer après roads.mjs (lit roads.json pour l'eau, les voies et les rails).
//
// 1. Surface de référence de l'eau : chaque plan d'eau (fleuve, lacs), canal et rivière impose son altitude
//    réelle ; entre eux, la surface est interpolée de façon harmonique (équation de Laplace). C'est la
//    généralisation du « plan incliné ajusté sur le fleuve » : elle suit la pente de la Garonne (≈ 20 m du sud au
//    nord), les biefs du canal du Midi (perché ≈ 14 m au-dessus du fleuve) et chaque lac.
// 2. relief = altitude − (surface de l'eau + 4 m), borné à ≥ 0 : hauteur au-dessus du niveau des quais.
// 3. Forçage à 0 à moins de 60 m des grands plans d'eau et des canaux, fondu jusqu'à 300 m (15 m / 80 m pour les
//    petits plans d'eau et les rivières étroites).
// 4. Les remblais et tranchées des autoroutes, bretelles, voies ferrées et des tronçons dénivelés (ele ≠ 0) sont
//    gommés (interpolation depuis les bords du couloir) : les niveaux superposés viennent du seul champ `ele`.
// 5. Lissage léger, moyenne par blocs à 30 m, entiers au pas de 0,1 m.
// Usage : node tools/osm/build.mjs --city toulouse --only terrain
import { join } from 'node:path';
import { OUT, BOUNDS, CITY_ID, readJSON, writeAtomic } from './common.mjs';
import { loadDem } from './shapes.mjs';
import { polyArea } from '../geom.mjs';

const t0 = Date.now(), log = (...a) => console.log(...a);
const dem = loadDem();
if (!dem) { console.error('Pas de MNT en cache (fetch.mjs --only dem) : terrain.json non généré, le monde restera plat.'); process.exit(1); }
const world = readJSON(join(OUT, 'roads.json'));
const { nx, nz, cell: C, x0, z0 } = dem, N = nx * nz;
const H = new Float32Array(N);
{ // trous éventuels du MNT : valeur du voisin précédent
  let last = 140; for (let i = 0; i < N; i++) { const v = dem.data[i]; if (v > -500 && v < 5000) { H[i] = v; last = v; } else H[i] = last; } }
const ix = (x) => Math.round((x - x0) / C), iz = (z) => Math.round((z - z0) / C);
const inGrid = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz;

// ───── rastérisation ─────
function fillPoly(poly, fn) { // cellules dont le centre est dans le polygone
  let zmin = Infinity, zmax = -Infinity; for (const p of poly) { if (p[1] < zmin) zmin = p[1]; if (p[1] > zmax) zmax = p[1]; }
  for (let j = Math.max(0, Math.ceil((zmin - z0) / C)); j <= Math.min(nz - 1, Math.floor((zmax - z0) / C)); j++) {
    const z = z0 + j * C, xs = [];
    for (let k = 0, n = poly.length; k < n; k++) { const a = poly[k], b = poly[(k + 1) % n]; if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0])); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil((xs[k] - x0) / C)); i <= Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / C)); i++) fn(i, j);
  }
}
function alongLine(points, step, fn) { for (let k = 1; k < points.length; k++) { const [ax, az] = points[k - 1], [bx, bz] = points[k], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / step)); for (let s = k === 1 ? 0 : 1; s <= n; s++) fn(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n); } }
function disc(x, z, r, fn) { const ci = ix(x), cj = iz(z), n = Math.ceil(r / C); for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) { const i = ci + di, j = cj + dj; if (inGrid(i, j) && Math.hypot(x0 + i * C - x, z0 + j * C - z) <= r) fn(i, j); } }
const median = (v) => { const s = Array.from(v).sort((a, b) => a - b); return s[s.length >> 1]; };

// ───── 1. niveaux de l'eau ─────
const level = new Float32Array(N).fill(NaN); // altitude de la surface de l'eau là où elle est connue
const bigMask = new Uint8Array(N), smallMask = new Uint8Array(N), wetMask = new Uint8Array(N);
let nBig = 0, nSmall = 0;
for (const poly of world.river.polygons) {
  const area = Math.abs(polyArea(poly)), cells = [];
  fillPoly(poly, (i, j) => cells.push(j * nx + i));
  if (!cells.length) continue;
  const lv = median(cells.map((c) => H[c]));
  const isRiver = area > 250000; // la Garonne : niveau variable le long du cours (pente, chaussées du Bazacle…)
  for (const c of cells) { level[c] = isRiver ? H[c] : lv; wetMask[c] = 1; if (area >= 10000) bigMask[c] = 1; else smallMask[c] = 1; }
  if (area >= 10000) nBig++; else nSmall++;
}
// fleuve : médiane locale (rayon 40 m) parmi les cellules en eau, pour ignorer piles de ponts et îlots
{ const src = level.slice(); const R = 4;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const c = j * nx + i; if (!bigMask[c] || Number.isNaN(src[c])) continue; const v = []; for (let dj = -R; dj <= R; dj += 2) for (let di = -R; di <= R; di += 2) { const a = i + di, b = j + dj; if (inGrid(a, b) && wetMask[b * nx + a] && !Number.isNaN(src[b * nx + a])) v.push(src[b * nx + a]); } if (v.length >= 3) level[c] = median(v); } }
let nCanal = 0, nRiver = 0;
for (const w of world.waterways || []) {
  if (w.kind === 'stream') continue;
  const pts = []; alongLine(w.points, C, (x, z) => pts.push([x, z]));
  // surface de l'eau = point le plus bas du MNT à moins de 10 m de l'axe, puis médiane glissante (± 150 m)
  const raw = pts.map(([x, z]) => { let m = Infinity; const ci = ix(x), cj = iz(z); for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (inGrid(ci + di, cj + dj)) m = Math.min(m, H[(cj + dj) * nx + ci + di]); return m; });
  const sm = raw.map((_, k) => median(raw.slice(Math.max(0, k - 15), k + 16)));
  const r = Math.max(C * 0.75, w.width / 2 + 3);
  pts.forEach(([x, z], k) => disc(x, z, r, (i, j) => { const c = j * nx + i; if (wetMask[c]) return; level[c] = sm[k]; if (w.kind === 'canal') bigMask[c] = 1; else smallMask[c] = 1; }));
  if (w.kind === 'canal') nCanal++; else nRiver++;
}
log(`eau : ${nBig} grands plans d'eau, ${nSmall} petits, ${nCanal} canaux, ${nRiver} rivières imposent leur niveau`);

// ───── surface de référence : interpolation harmonique (grille grossière de 80 m, puis affinage) ─────
const F = 8, cx = Math.ceil(nx / F), cz = Math.ceil(nz / F);
const cv = new Float64Array(cx * cz), cfix = new Uint8Array(cx * cz);
{ const sum = new Float64Array(cx * cz), cnt = new Uint32Array(cx * cz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const v = level[j * nx + i]; if (!Number.isNaN(v)) { const k = Math.floor(j / F) * cx + Math.floor(i / F); sum[k] += v; cnt[k]++; } }
  let tot = 0, n = 0; for (let k = 0; k < cv.length; k++) if (cnt[k]) { cv[k] = sum[k] / cnt[k]; cfix[k] = 1; tot += cv[k]; n++; }
  const mean = tot / n; for (let k = 0; k < cv.length; k++) if (!cfix[k]) cv[k] = mean;
  for (let it = 0; it < 4000; it++) { // Gauss-Seidel avec sur-relaxation, bords en miroir
    let maxd = 0;
    for (let j = 0; j < cz; j++) for (let i = 0; i < cx; i++) { const k = j * cx + i; if (cfix[k]) continue; const a = cv[j * cx + (i > 0 ? i - 1 : i + 1)], b = cv[j * cx + (i < cx - 1 ? i + 1 : i - 1)], c = cv[(j > 0 ? j - 1 : j + 1) * cx + i], d = cv[(j < cz - 1 ? j + 1 : j - 1) * cx + i]; const nv = cv[k] + 1.85 * ((a + b + c + d) / 4 - cv[k]); maxd = Math.max(maxd, Math.abs(nv - cv[k])); cv[k] = nv; }
    if (maxd < 0.002) { log(`surface de référence : convergence en ${it} itérations`); break; }
  } }
const datum = new Float32Array(N);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { // bilinéaire depuis la grille grossière (valeurs au centre des blocs)
  const fx = Math.max(0, Math.min(cx - 1.001, (i + 0.5) / F - 0.5)), fz = Math.max(0, Math.min(cz - 1.001, (j + 0.5) / F - 0.5)), a = fx | 0, b = fz | 0, tx = fx - a, tz = fz - b;
  const p = cv[b * cx + a] + (cv[b * cx + a + 1] - cv[b * cx + a]) * tx, q = cv[(b + 1) * cx + a] + (cv[(b + 1) * cx + a + 1] - cv[(b + 1) * cx + a]) * tx;
  const c = j * nx + i; datum[c] = Number.isNaN(level[c]) ? p + (q - p) * tz : level[c];
}
for (let it = 0; it < 40; it++) for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) { const c = j * nx + i; if (!Number.isNaN(level[c])) continue; datum[c] = (datum[c - 1] + datum[c + 1] + datum[c - nx] + datum[c + nx]) / 4; }

// ───── 2. relief au-dessus du niveau des quais ─────
const BANK = 4;
let R = new Float32Array(N);
for (let c = 0; c < N; c++) R[c] = Math.max(0, H[c] - datum[c] - BANK);

// ───── 4. gommage des remblais / tranchées d'infrastructure (avant le forçage près de l'eau) ─────
const infra = new Uint8Array(N);
const mark = (points, r, pred) => { let k = 0; alongLine(points, C, (x, z) => { if (!pred || pred(x, z)) disc(x, z, r, (i, j) => { infra[j * nx + i] = 1; }); k++; }); };
for (const r of world.roads) {
  if (r.kind === 'motorway' || r.kind === 'trunk') mark(r.points, 45);
  else if (r.kind === 'ramp') mark(r.points, 28);
  else if (r.ele) for (let k = 1; k < r.points.length; k++) if (Math.abs(r.ele[k - 1]) > 0.3 || Math.abs(r.ele[k]) > 0.3) mark([r.points[k - 1], r.points[k]], 22 + r.width / 2);
  else if (r.bridge || r.tunnel) mark(r.points, 18 + r.width / 2);
}
for (const r of world.rails || []) if (r.kind === 'train' || r.kind === 'metro') mark(r.points, r.yard ? 14 : 24);
{ let n = 0; for (let c = 0; c < N; c++) n += infra[c];
  // interpolation harmonique à l'intérieur du masque (les valeurs du bord sont conservées)
  for (let it = 0; it < 400; it++) for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) { const c = j * nx + i; if (!infra[c]) continue; R[c] += 1.6 * ((R[c - 1] + R[c + 1] + R[c - nx] + R[c + nx]) / 4 - R[c]); }
  for (let c = 0; c < N; c++) if (R[c] < 0) R[c] = 0;
  log(`infrastructures gommées : ${(n * C * C / 1e6).toFixed(1)} km² de couloirs`); }

// ───── 3. forçage à 0 près de l'eau (distance par transformée de chanfrein) ─────
function distanceTo(mask) {
  const D = new Float32Array(N).fill(1e9); for (let c = 0; c < N; c++) if (mask[c]) D[c] = 0;
  const a = C, b = C * Math.SQRT2;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const c = j * nx + i; let d = D[c]; if (i > 0) d = Math.min(d, D[c - 1] + a); if (j > 0) { d = Math.min(d, D[c - nx] + a); if (i > 0) d = Math.min(d, D[c - nx - 1] + b); if (i < nx - 1) d = Math.min(d, D[c - nx + 1] + b); } D[c] = d; }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const c = j * nx + i; let d = D[c]; if (i < nx - 1) d = Math.min(d, D[c + 1] + a); if (j < nz - 1) { d = Math.min(d, D[c + nx] + a); if (i < nx - 1) d = Math.min(d, D[c + nx + 1] + b); if (i > 0) d = Math.min(d, D[c + nx - 1] + b); } D[c] = d; }
  return D;
}
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const dBig = distanceTo(bigMask), dSmall = distanceTo(smallMask);
const fade = new Float32Array(N);
for (let c = 0; c < N; c++) fade[c] = Math.min(smooth((dBig[c] - 60) / 240), smooth((dSmall[c] - 15) / 65));
for (let c = 0; c < N; c++) R[c] *= fade[c];

// ───── 5. lissage, passage à 30 m, quantification ─────
const blur = (src, w, h) => { const out = new Float32Array(src.length), tmp = new Float32Array(src.length); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = j * w + i; tmp[c] = (src[j * w + Math.max(0, i - 1)] + 2 * src[c] + src[j * w + Math.min(w - 1, i + 1)]) / 4; } for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = j * w + i; out[c] = (tmp[Math.max(0, j - 1) * w + i] + 2 * tmp[c] + tmp[Math.min(h - 1, j + 1) * w + i]) / 4; } return out; };
R = blur(blur(R, nx, nz), nx, nz);
const CELL = 30, MARGIN = 300, K = CELL / C;
const ox = BOUNDS.minX - MARGIN, oz = BOUNDS.minZ - MARGIN;
const gx = Math.ceil((BOUNDS.maxX - BOUNDS.minX + 2 * MARGIN) / CELL) + 1, gz = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ + 2 * MARGIN) / CELL) + 1;
let G = new Float32Array(gx * gz), Gf = new Float32Array(gx * gz);
for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) { // moyenne des cellules de 10 m dans un carré de 30 m centré sur le point de grille
  const ci = Math.round((ox + i * CELL - x0) / C), cj = Math.round((oz + j * CELL - z0) / C); let s = 0, n = 0, f = 1;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = Math.max(0, Math.min(nx - 1, ci + di)), b = Math.max(0, Math.min(nz - 1, cj + dj)); s += R[b * nx + a]; n++; f = Math.min(f, fade[b * nx + a]); }
  G[j * gx + i] = s / n; Gf[j * gx + i] = f;
}
G = blur(G, gx, gz);
const data = new Array(gx * gz); let max = 0, sum = 0, zeros = 0;
for (let k = 0; k < G.length; k++) { const v = Math.max(0, Math.round(G[k] * (Gf[k] < 0.02 ? 0 : 1) * 10)); data[k] = v; if (v > max) max = v; sum += v; if (!v) zeros++; }
const meta = {
  source: 'IGN RGE ALTI® (Géoplateforme, WMS ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES) — Licence Ouverte 2.0', city: CITY_ID, generated: new Date().toISOString().slice(0, 10), generator: 'tools/osm/v5/terrain.mjs',
  note: 'Hauteurs relatives au niveau des quais (0 au bord de l’eau, eau à −4), PAS des altitudes NGF : on a retranché une surface de référence qui passe par toutes les surfaces d’eau (Garonne en pente, biefs des canaux, lacs, rivières) + 4 m, puis forcé 0 à moins de 60 m des grands plans d’eau et des canaux (fondu jusqu’à 300 m). Les remblais et tranchées des autoroutes, bretelles, voies ferrées et tronçons dénivelés sont gommés : les niveaux superposés viennent de `ele` dans roads.json.',
  maxHeight: max / 10, meanHeight: Math.round(sum / data.length) / 10, flatShare: Math.round((100 * zeros) / data.length) + ' %',
};
const size = writeAtomic(join(OUT, 'terrain.json'), JSON.stringify({ meta, x0: Math.round(ox * 10) / 10, z0: Math.round(oz * 10) / 10, cell: CELL, nx: gx, nz: gz, scale: 0.1, data }));
log(`terrain.json : ${gx} × ${gz} points (pas ${CELL} m), max ${max / 10} m, moyenne ${meta.meanHeight} m, ${meta.flatShare} à 0 ; ${(size / 1e6).toFixed(2)} Mo ; fait en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
// quelques points témoins
const at = (x, z) => { const fx = (x - ox) / CELL, fz = (z - oz) / CELL, i = Math.round(fx), j = Math.round(fz); return data[j * gx + i] / 10; };
const { lonLatToXZ } = await import('./common.mjs');
for (const [name, lat, lon] of [['Capitole', 43.6045, 1.444], ['Pech-David (belvédère)', 43.5553, 1.4458], ['Jolimont (observatoire)', 43.6122, 1.4625], ['Côte Pavée', 43.5935, 1.4735], ['Matabiau', 43.6113, 1.4537], ['Pont Neuf (Garonne)', 43.5993, 1.4388], ['Blagnac aéroport', 43.6294, 1.3676], ['Balma (coteaux)', 43.611, 1.5], ['Vieille-Toulouse / Pouvourville', 43.547, 1.452], ['Saint-Cyprien', 43.5978, 1.431], ['Purpan', 43.6105, 1.4005]]) { const [x, z] = lonLatToXZ(lon, lat); log(`  ${name} : ${at(x, z)} m (MNT ${dem.at(x, z).toFixed(0)} m NGF)`); }

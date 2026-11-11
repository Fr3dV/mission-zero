// Construit shared/world/pois.json (contrat v3 « fidélité des lieux ») à partir du cache Overpass.
// À lancer APRÈS build.mjs (lit shared/world/paris.json pour les parcs, la Seine et les grands axes).
// Usage : node tools/osm/build-pois.mjs
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lonLatToXZ, BOUNDS } from '../../shared/geo.js';
import { r1, polyArea, centroid, pointInPoly, polylineLength, simplify, simplifyRing, dedupeRing, clipRect, selfIntersects, assembleRings, distPointSeg } from './geom.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.data', 'osm');
const OUT = join(ROOT, 'shared', 'world');
const load = (n) => (existsSync(join(CACHE, n + '.json')) ? JSON.parse(readFileSync(join(CACHE, n + '.json'), 'utf8')).elements : []);
const xz = (g) => lonLatToXZ(g.lon, g.lat);
const inB = (x, z) => x >= BOUNDS.minX && x <= BOUNDS.maxX && z >= BOUNDS.minZ && z <= BOUNDS.maxZ;
const num = (v) => { if (v == null) return NaN; const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
const paris = JSON.parse(readFileSync(join(OUT, 'paris.json'), 'utf8'));

function ringsOf(e) {
  if (e.type === 'way') {
    if (!e.geometry || e.geometry.length < 4) return [];
    const g = e.geometry.map(xz);
    return Math.hypot(g[0][0] - g[g.length - 1][0], g[0][1] - g[g.length - 1][1]) < 0.01 ? [g.slice(0, -1)] : [];
  }
  return assembleRings((e.members || []).filter((m) => m.type === 'way' && m.geometry && m.role !== 'inner').map((m) => m.geometry.map(xz)));
}
function cleanPoly(ring, tol) {
  let p = clipRect(ring, BOUNDS);
  if (p.length < 3) return null;
  p = dedupeRing(simplifyRing(p, tol).map(([x, z]) => [r1(x), r1(z)]), 0.01);
  if (p.length < 3 || selfIntersects(p)) {
    p = dedupeRing(clipRect(ring, BOUNDS).map(([x, z]) => [r1(x), r1(z)]), 0.01);
    if (p.length < 3 || selfIntersects(p)) return null;
  }
  if (polyArea(p) < 0) p.reverse();
  return p;
}
// grille spatiale générique de points
function pointGrid(G) {
  const m = new Map();
  return {
    add(x, z, v) { const k = Math.floor(x / G) + ',' + Math.floor(z / G); if (!m.has(k)) m.set(k, []); m.get(k).push([x, z, v]); },
    near(x, z, r) { const out = []; for (let gx = Math.floor((x - r) / G); gx <= Math.floor((x + r) / G); gx++) for (let gz = Math.floor((z - r) / G); gz <= Math.floor((z + r) / G); gz++) for (const p of m.get(gx + ',' + gz) || []) if (Math.hypot(p[0] - x, p[1] - z) <= r) out.push(p); return out; },
  };
}

// ───────────── Arbres ─────────────
const trees = [];
{
  const seen = new Set();
  for (const e of load('trees')) {
    const [x, z] = xz(e); if (!inB(x, z)) continue;
    const k = r1(x) + ',' + r1(z); if (seen.has(k)) continue; seen.add(k);
    trees.push(r1(x), r1(z));
  }
}
const treeRows = [];
for (const e of load('treerows')) {
  if (!e.geometry) continue;
  let pts = simplify(e.geometry.map(xz).filter(([x, z]) => inB(x, z)), 1).map(([x, z]) => [r1(x), r1(z)]);
  if (pts.length >= 2 && polylineLength(pts) >= 10) treeRows.push({ points: pts });
}
console.log(`arbres : ${trees.length / 2}, alignements : ${treeRows.length}`);

// ───────────── Points d'intérêt ─────────────
// échantillons des grands axes (pour prioriser les terrasses) : avenues, boulevards, quais, ou chaussée ≥ 12 m
const axisGrid = pointGrid(50);
for (const r of paris.roads) {
  if (!(r.kind === 'avenue' || r.kind === 'boulevard' || r.kind === 'quay' || r.width >= 12)) continue;
  for (let i = 1; i < r.points.length; i++) {
    const [ax, az] = r.points[i - 1], [bx, bz] = r.points[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10));
    for (let k = 0; k <= n; k++) axisGrid.add(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, 1);
  }
}
const onAxis = (x, z) => axisGrid.near(x, z, 28).length > 0;

const raw = load('pois');
const stations = raw.filter((e) => e.tags?.railway === 'station' && e.tags.name && e.type === 'node').map((e) => ({ name: e.tags.name, p: xz(e), subway: e.tags.station === 'subway' || e.tags.subway === 'yes' }));
const nearestStation = (x, z, max) => { let best = null, bd = max; for (const s of stations) { if (!s.subway) continue; const d = Math.hypot(s.p[0] - x, s.p[1] - z); if (d < bd) { bd = d; best = s; } } return best; };
const WORSHIP = /^(christian|jewish|muslim|buddhist|hindu)$/;
const cand = []; // {kind, name, x, z, prio}
for (const e of raw) {
  const t = e.tags || {};
  const g = e.type === 'node' ? e : e.center; if (!g) continue;
  const [x, z] = xz(g); if (!inB(x, z)) continue;
  if (t.level && num(t.level) < 0) { if (t.railway !== 'subway_entrance') continue; }
  if (t.disused === 'yes' || t.abandoned === 'yes' || t['disused:amenity'] || t['disused:shop']) continue;
  let kind = null, name = t.name || '', prio = 0;
  if (t.railway === 'subway_entrance') { kind = 'metro'; const s = nearestStation(x, z, 400); name = s ? s.name : name; if (t.name && s && t.name !== s.name) name = s.name; }
  else if (t.railway === 'station') { if (t.station === 'subway' || t.station === 'funicular' || t.subway === 'yes' && !t.train) continue; kind = 'station'; }
  else if (t.amenity === 'drinking_water' || t.amenity === 'fountain') {
    const wallace = t.fountain === 'wallace' || /wallace/i.test(name) || /wallace/i.test(t.model || '') || /wallace/i.test(t['drinking_water:type'] || '');
    if (wallace) { kind = 'wallace'; name = name || 'Fontaine Wallace'; } else if (t.amenity === 'fountain') kind = 'fountain'; else continue; // simples points d'eau ignorés
  }
  else if (t.amenity === 'cafe' || t.amenity === 'bar') kind = 'cafe';
  else if (t.amenity === 'restaurant') kind = 'restaurant';
  else if (t.amenity === 'pharmacy') kind = 'pharmacy';
  else if (t.amenity === 'theatre') kind = 'theatre';
  else if (t.amenity === 'place_of_worship') { if (t.religion && !WORSHIP.test(t.religion)) continue; kind = 'church'; }
  else if (t.amenity === 'school') kind = 'school';
  else if (t.amenity === 'bicycle_rental') { kind = 'velib'; }
  else if (t.shop === 'bakery') kind = 'bakery';
  else if (t.shop === 'kiosk' || t.shop === 'newsagent') { if (t.shop === 'newsagent' && e.type !== 'node') continue; kind = 'kiosk'; }
  else if (t.shop === 'books') { if (/bouquinist/i.test(name) || /bouquinist/i.test(t.description || '') || t.books === 'antiquarian' && e.type === 'node' && /quai/i.test(t['addr:street'] || '')) kind = 'bookstall'; else continue; }
  else if (t.historic === 'memorial' || t.historic === 'monument' || t.historic === 'statue' || t.tourism === 'artwork') {
    const type = t.memorial || t.artwork_type || '';
    // on écarte les plaques, pavés de mémoire et fresques : seuls les objets en volume sont utiles en 3D
    if (/plaque|stolperstein|blue_plaque|mural|graffiti|painting|street_art|mosaic|tag|relief|ghost_bike|bench|tree/.test(type)) continue;
    if (t.historic === 'memorial' && !/statue|bust|sculpture|obelisk|stele|war_memorial|column|stone|cross/.test(type) && !name) continue;
    if (t.tourism === 'artwork' && !/statue|sculpture|bust|installation|fountain|architecture/.test(type)) continue;
    kind = 'statue'; prio = t.historic === 'monument' || /statue|war_memorial|column|obelisk/.test(type) ? 2 : 1;
  }
  else if (t.tourism === 'museum') kind = 'museum';
  else if (t.tourism === 'hotel') { const stars = num(t.stars), rooms = num(t.rooms); if (!(stars >= 4 || rooms >= 80)) continue; kind = 'hotel'; prio = (stars || 0) + (rooms >= 150 ? 1 : 0); }
  else if (t.highway === 'bus_stop') kind = 'busstop';
  if (!kind) continue;
  if (kind === 'cafe' || kind === 'restaurant') prio = (t.outdoor_seating && t.outdoor_seating !== 'no' ? 2 : 0) + (onAxis(x, z) ? 1 : 0) + (name ? 0.1 : 0);
  cand.push({ kind, name, x: r1(x), z: r1(z), prio });
}
// Plafonds par catégorie (les plus prioritaires d'abord, ordre stable) + dédoublonnage à 3 m
const CAPS = { cafe: 1500, restaurant: 2000, statue: 700, hotel: 300, busstop: 1100, school: 450 };
const pois = [], stats = {};
{
  const byKind = new Map(); for (const c of cand) { if (!byKind.has(c.kind)) byKind.set(c.kind, []); byKind.get(c.kind).push(c); }
  for (const [kind, list] of byKind) {
    list.sort((a, b) => b.prio - a.prio);
    const grid = pointGrid(20); let n = 0;
    for (const c of list) {
      if (CAPS[kind] && n >= CAPS[kind]) break;
      if ((kind === 'cafe' || kind === 'restaurant') && c.prio < 1) break; // ni terrasse déclarée ni grand axe
      if (grid.near(c.x, c.z, kind === 'metro' ? 1 : 3).length) continue;
      grid.add(c.x, c.z, 1); n++;
      pois.push({ kind, name: c.name, x: c.x, z: c.z });
    }
    stats[kind] = n;
  }
}
console.log('pois :', JSON.stringify(stats));

// ───────────── Allées, escaliers, berges ─────────────
// polygones de tous les parcs / jardins publics (y compris les petits, absents de paris.json)
const parkPolys = [];
for (const e of load('green')) {
  const t = e.tags || {};
  if (!(t.leisure === 'park' || t.leisure === 'garden') || t.access === 'private' || t.access === 'no') continue;
  for (const o of ringsOf(e)) { if (Math.abs(polyArea(o)) < 800) continue; let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const [x, z] of o) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); } parkPolys.push({ p: o, a, b, c, d }); }
}
const distToPoly = (x, z, p) => { let m = Infinity; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; m = Math.min(m, distPointSeg(x, z, p[i][0], p[i][1], q[0], q[1])); } return m; };
const inPark = (x, z, margin) => parkPolys.some((k) => x > k.a - margin && x < k.b + margin && z > k.c - margin && z < k.d + margin && (pointInPoly(x, z, k.p) || distToPoly(x, z, k.p) < margin));
const nearRiver = (x, z) => paris.river.polygons.some((p) => pointInPoly(x, z, p) || distToPoly(x, z, p) < 22);
const paths = []; const pstats = { footway: 0, steps: 0, park: 0, riverbank: 0 };
for (const e of load('paths')) {
  const t = e.tags || {};
  if (!e.geometry || t.access === 'private' || t.access === 'no' || t.covered === 'yes' || t.location === 'underground' || num(t.level) < 0 || num(t.layer) < 0) continue;
  if (t.area === 'yes') continue;
  let pts = e.geometry.map(xz);
  if (!pts.every(([x, z]) => inB(x, z))) { pts = pts.filter(([x, z]) => inB(x, z)); }
  if (pts.length < 2) continue;
  const len = polylineLength(pts); const mid = pts[pts.length >> 1];
  const isSteps = t.highway === 'steps';
  let why = null;
  if (isSteps) { if (len >= 6) why = 'steps'; }
  else if (len >= 12 && (inPark(mid[0], mid[1], 6) || inPark(pts[0][0], pts[0][1], 2))) why = 'park';
  else if (len >= 25 && t.bridge !== 'yes' && nearRiver(mid[0], mid[1]) && nearRiver(pts[0][0], pts[0][1])) why = 'riverbank';
  if (!why) continue;
  pts = simplify(pts, 0.8).map(([x, z]) => [r1(x), r1(z)]);
  let width = num(t.width); if (!(width >= 0.8 && width <= 30)) width = isSteps ? 3 : why === 'riverbank' ? 5 : 3;
  const o = { kind: isSteps ? 'steps' : 'footway', points: pts, width: r1(width) };
  if (t.name) o.name = t.name;
  if (isSteps && num(t.step_count) > 0) o.steps = Math.round(num(t.step_count));
  if (why === 'riverbank') o.riverbank = true;
  paths.push(o); pstats[o.kind]++; if (why !== 'steps') pstats[why]++;
}
console.log('allées :', JSON.stringify(pstats));

// ───────────── Bassins et pièces d'eau ─────────────
const water = [];
{
  const seen = new Set();
  const push = (e, min) => {
    if (seen.has(e.type + e.id)) return; seen.add(e.type + e.id);
    const t = e.tags || {};
    if (t.water === 'river' || t.location === 'underground' || t.covered === 'yes') return;
    for (const o of ringsOf(e)) {
      const c = centroid(o); if (!inB(c[0], c[1])) continue;
      const p = cleanPoly(o, 0.4); if (!p) continue;
      const area = Math.abs(polyArea(p)); if (area < min) continue;
      water.push({ name: t.name || '', polygon: p, _a: area });
    }
  };
  for (const e of load('water')) if ((e.tags || {}).natural === 'water') push(e, 12);
  for (const e of load('fountains')) push(e, 8);
  water.sort((a, b) => b._a - a._a);
  // retire les doublons emboîtés (fontaine dessinée dans son bassin)
  for (let i = water.length - 1; i >= 0; i--) { const c = centroid(water[i].polygon); if (water.some((w, j) => j < i && pointInPoly(c[0], c[1], w.polygon) && w._a < water[i]._a * 6)) water.splice(i, 1); }
  for (const w of water) delete w._a;
}
console.log(`eau : ${water.length} bassins`);

// ───────────── Surfaces : zones piétonnes, pavés, stabilisé, pelouses ─────────────
const areas = []; const astats = { pedestrian: 0, cobble: 0, gravel: 0, grass: 0 };
{
  const tmp = [];
  const add = (kind, e, min) => {
    const t = e.tags || {};
    for (const o of ringsOf(e)) {
      const p = cleanPoly(o, 0.8); if (!p) continue;
      const area = Math.abs(polyArea(p)); if (area < min) continue;
      tmp.push({ kind, name: t.name || '', polygon: p, _a: area });
    }
  };
  for (const e of load('green')) {
    const t = e.tags || {};
    if (!(t.highway === 'pedestrian' || t.place === 'square') || t.leisure) continue;
    if (t.access === 'private' || t.access === 'no' || t.tunnel || t.indoor === 'yes' || t.covered === 'yes' || num(t.layer) < 0 || num(t.level) < 0) continue;
    const s = t.surface || '';
    const kind = /sett|cobble/.test(s) ? 'cobble' : /gravel|compacted|ground|dirt|sand|pebble|unpaved|earth/.test(s) ? 'gravel' : 'pedestrian';
    if (t.place === 'square' && t.highway !== 'pedestrian') continue; // contour de place incluant les chaussées : déjà dans paris.json/plazas
    add(kind, e, 250);
  }
  for (const e of load('grass')) { const t = e.tags || {}; if (t.access === 'private' || num(t.layer) < 0) continue; add('grass', e, 250); }
  tmp.sort((a, b) => b._a - a._a);
  const MAX = { pedestrian: 700, cobble: 300, gravel: 300, grass: 900 };
  for (const a of tmp) { if (astats[a.kind] >= MAX[a.kind]) continue; astats[a.kind]++; delete a._a; areas.push(a); }
}
console.log('surfaces :', JSON.stringify(astats));

const meta = {
  source: 'osm', attribution: '© les contributeurs d’OpenStreetMap (ODbL)', generated: new Date().toISOString().slice(0, 10), generator: 'tools/osm/build-pois.mjs',
  units: 'mètres, repère shared/geo.js, arrondi 0,1 m ; tout est à l’intérieur de BOUNDS',
  trees: 'tableau plat [x, z, …] : un arbre réel par couple (natural=tree)',
  pois: 'kind ∈ metro, station, cafe (cafés et bars), restaurant, bakery, pharmacy, fountain, wallace, statue, church (lieux de culte), theatre, museum, hotel (4★ et plus ou ≥ 80 chambres), school, kiosk, bookstall, + deux kinds hors contrat initial : velib (station Vélib’), busstop (arrêt de bus). name peut être vide. Pour metro, name = station de métro la plus proche. cafe/restaurant : seulement ceux avec terrasse déclarée (outdoor_seating) ou situés sur un grand axe, plafonnés.',
  paths: 'kind footway|steps ; allées des parcs et jardins, escaliers extérieurs (≥ 6 m), berges piétonnes de la Seine (riverbank=true). width = tag width sinon 3 m (5 m sur les berges). Champs optionnels : name, steps (nombre de marches), riverbank.',
  water: 'bassins, pièces d’eau et fontaines surfaciques (natural=water hors Seine, amenity=fountain) ; trous ignorés',
  areas: 'pedestrian = zones piétonnes ; cobble = zones piétonnes pavées (surface=sett) ; gravel = stabilisé/gravier ; grass = pelouses (landuse=grass). ≥ 250 m², triées par aire décroissante. Peut recouper paris.json/plazas et parks.',
  polygons: 'polygones simples, non fermés, sens horaire vu de dessus (aire signée positive en x,z)',
  stats: { trees: trees.length / 2, treeRows: treeRows.length, pois: stats, paths: pstats, water: water.length, areas: astats },
};
const s = JSON.stringify({ meta, trees, treeRows, pois, paths, water, areas });
writeFileSync(join(OUT, 'pois.json.tmp'), s); renameSync(join(OUT, 'pois.json.tmp'), join(OUT, 'pois.json'));
console.log(`pois.json : ${(s.length / 1e6).toFixed(2)} Mo`);

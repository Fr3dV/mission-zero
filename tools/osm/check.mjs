// Vérifie shared/world/paris.json et buildings.json. Code de sortie 1 si une vérification obligatoire échoue.
// Usage : node tools/osm/check.mjs
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUNDS } from '../../shared/geo.js';
import { LANDMARKS, LANDMARK_BY_ID } from '../../shared/landmarks.js';
import { polyArea, pointInPoly, selfIntersects, polylineLength } from './geom.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pFile = join(ROOT, 'shared', 'world', 'paris.json'), bFile = join(ROOT, 'shared', 'world', 'buildings.json');
const d = JSON.parse(readFileSync(pFile, 'utf8'));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  OK    ' : '  ÉCHEC ') + msg); if (!cond) fails++; };
const info = (msg) => console.log('  ·     ' + msg);
const { nodes, edges } = d.graph;
const roadById = new Map(d.roads.map((r) => [r.id, r]));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

console.log('Format');
const KINDS = new Set(['avenue', 'boulevard', 'street', 'quay', 'pedestrian']);
ok(d.meta?.source === 'osm' && d.meta.graphDirected === true, 'meta.source = "osm", meta.graphDirected = true');
ok(d.roads.every((r) => Number.isInteger(r.id) && typeof r.name === 'string' && KINDS.has(r.kind) && r.width > 0 && Number.isInteger(r.lanes) && typeof r.oneway === 'boolean' && typeof r.bridge === 'boolean' && r.points.length >= 2), 'toutes les routes ont id, name, kind, width, lanes, oneway, bridge, points');
ok(roadById.size === d.roads.length, 'identifiants de routes uniques');
ok(edges.every((e) => e.length === 3 && nodes[e[0]] && nodes[e[1]] && e[0] !== e[1] && roadById.has(e[2])), 'arêtes valides (nœuds et roadId existants)');
const tenth = (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;
ok(d.roads.every((r) => r.points.every((p) => tenth(p[0]) && tenth(p[1]))) && nodes.every((p) => tenth(p[0]) && tenth(p[1])), 'coordonnées arrondies à 0,1 m');

console.log('Emprise');
let worst = 0;
const over = (p) => Math.max(BOUNDS.minX - p[0], p[0] - BOUNDS.maxX, BOUNDS.minZ - p[1], p[1] - BOUNDS.maxZ, 0);
const allPts = [...nodes, ...d.roads.flatMap((r) => r.points), ...d.river.polygons.flat(), ...(d.river.islands || []).flatMap((i) => i.polygon), ...d.parks.flatMap((p) => p.polygon), ...d.plazas.flatMap((p) => p.polygon)];
for (const p of allPts) worst = Math.max(worst, over(p));
ok(worst <= 200, `aucune coordonnée à plus de 200 m hors BOUNDS (max ${worst.toFixed(1)} m, ${allPts.length} points)`);

console.log('Graphe');
// cohérence arêtes / polylignes : a et b sont deux points consécutifs de la route
const segKey = (a, b) => a[0] + ',' + a[1] + '>' + b[0] + ',' + b[1];
const segs = new Map();
for (const r of d.roads) for (let i = 1; i < r.points.length; i++) { segs.set(r.id + ':' + segKey(r.points[i - 1], r.points[i]), 1); if (!r.oneway) segs.set(r.id + ':' + segKey(r.points[i], r.points[i - 1]), 1); }
const badSeg = edges.filter((e) => !segs.has(e[2] + ':' + segKey(nodes[e[0]], nodes[e[1]]))).length;
ok(badSeg === 0, `chaque arête suit un segment de sa route, dans le bon sens (${badSeg} anomalies)`);
const adj = nodes.map(() => []), radj = nodes.map(() => []);
for (const [a, b] of edges) { adj[a].push(b); radj[b].push(a); }
const reach = (g, s) => { const seen = new Uint8Array(nodes.length); seen[s] = 1; const st = [s]; let n = 1; while (st.length) { for (const w of g[st.pop()]) if (!seen[w]) { seen[w] = 1; n++; st.push(w); } } return n; };
const f = reach(adj, 0), b = reach(radj, 0);
ok(f === nodes.length && b === nodes.length, `graphe fortement connexe (${f}/${nodes.length} atteignables, ${b}/${nodes.length} co-atteignables)`);
const nb = nodes.map(() => new Set()); for (const [a, c] of edges) { nb[a].add(c); nb[c].add(a); }
info(`${nodes.length} nœuds dont ${nb.filter((s) => s.size >= 3).length} intersections (≥ 3 voisins) et ${nb.filter((s) => s.size === 1).length} extrémités ; ${edges.length} arêtes orientées`);
const elen = edges.map((e) => dist(nodes[e[0]], nodes[e[1]]));
info(`longueur d'arête : min ${Math.min(...elen).toFixed(1)} m, médiane ${elen.slice().sort((x, y) => x - y)[elen.length >> 1].toFixed(1)} m, max ${Math.max(...elen).toFixed(1)} m`);

console.log('Monuments');
for (const l of LANDMARKS) {
  let best = Infinity; for (const n of nodes) best = Math.min(best, dist(n, [l.x, l.z]));
  ok(best < 250, `${l.name} : nœud du graphe le plus proche à ${best.toFixed(0)} m`);
}

console.log('Champs-Élysées');
{
  const ce = d.roads.filter((r) => r.name === 'Avenue des Champs-Élysées');
  // l'avenue est interrompue par le Rond-Point des Champs-Élysées : on l'accepte dans le trajet
  const ids = new Set(d.roads.filter((r) => /champs-élysées/i.test(r.name)).map((r) => r.id));
  const A = LANDMARK_BY_ID.concorde, B = LANDMARK_BY_ID.arc;
  info(`${ce.length} route(s) de ce nom, ${ce.reduce((s, r) => s + polylineLength(r.points), 0).toFixed(0)} m au total, largeur ${ce.map((r) => r.width).join('/')} m, voies ${ce.map((r) => r.lanes).join('/')}`);
  const cadj = nodes.map(() => []); for (const [a, c, id] of edges) if (ids.has(id)) cadj[a].push(c);
  const near = (l, r) => nodes.map((n, i) => (dist(n, [l.x, l.z]) < r ? i : -1)).filter((i) => i >= 0 && cadj[i].length);
  const run = (from, to, r) => { const goal = new Set(near(to, r)); const seen = new Set(near(from, r)); const st = [...seen]; while (st.length) { const v = st.pop(); if (goal.has(v)) return true; for (const w of cadj[v]) if (!seen.has(w)) { seen.add(w); st.push(w); } } return false; };
  ok(run(A, B, 250), 'trajet Concorde → Arc de Triomphe en ne suivant que les Champs-Élysées et leur rond-point (abords = 250 m)');
  ok(run(B, A, 250), 'trajet Arc de Triomphe → Concorde en ne suivant que les Champs-Élysées');
}

console.log('Seine');
{
  const A = LANDMARK_BY_ID.louvre, B = LANDMARK_BY_ID.invalides;
  let hit = null;
  for (let i = 0; i <= 200 && !hit; i++) { const t = i / 200, x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t; if (d.river.polygons.some((p) => pointInPoly(x, z, p))) hit = [x, z]; }
  ok(!!hit, `un point de la Seine entre le Louvre et les Invalides${hit ? ` (x=${hit[0].toFixed(0)}, z=${hit[1].toFixed(0)})` : ''}`);
  const names = (d.river.islands || []).map((i) => i.name);
  ok(['Île de la Cité', 'Île Saint-Louis', 'Île aux Cygnes'].every((n) => names.includes(n)), `river.islands : ${names.join(', ')}`);
  const nd = LANDMARK_BY_ID.notredame;
  ok((d.river.islands || []).some((i) => i.name === 'Île de la Cité' && pointInPoly(nd.x, nd.z, i.polygon)), 'Notre-Dame est sur l’Île de la Cité');
  info(`aire de la Seine : ${(d.river.polygons.reduce((s, p) => s + Math.abs(polyArea(p)), 0) / 1e4).toFixed(1)} ha en ${d.river.polygons.length} polygone(s)`);
}

console.log('Polygones');
{
  const polys = [...d.river.polygons.map((p) => ['Seine', p]), ...(d.river.islands || []).map((i) => [i.name, i.polygon]), ...d.parks.map((p) => ['parc ' + p.name, p.polygon]), ...d.plazas.map((p) => ['place ' + p.name, p.polygon])];
  const bad = polys.filter(([, p]) => p.length < 3 || selfIntersects(p)).map(([n]) => n);
  ok(bad.length === 0, `polygones simples, non auto-intersectants (${polys.length} testés${bad.length ? ' ; fautifs : ' + bad.join(', ') : ''})`);
  ok(polys.every(([, p]) => polyArea(p) > 0), 'sens cohérent (aire signée positive)');
  for (const n of ['Jardin des Tuileries', 'Champ-de-Mars', 'Jardin du Luxembourg', 'Parc Monceau']) ok(d.parks.some((p) => p.name.replace(/ /g, '-').toLowerCase().includes(n.replace(/ /g, '-').toLowerCase())), `parc présent : ${n}`);
}

console.log('Bâtiments');
let nB = 0;
if (existsSync(bFile)) {
  const bd = JSON.parse(readFileSync(bFile, 'utf8')).buildings;
  nB = bd.length / 6;
  ok(bd.length % 6 === 0 && bd.every((v) => typeof v === 'number' && Number.isFinite(v)), `tableau plat de ${nB} × 6 nombres`);
  let inLm = 0, out = 0, hMin = Infinity, hMax = 0, hSum = 0, small = 0, big = 0;
  for (let i = 0; i < bd.length; i += 6) {
    const [cx, cz, w, dd, , h] = bd.slice(i, i + 6);
    if (LANDMARKS.some((l) => Math.hypot(cx - l.x, cz - l.z) < l.radius)) inLm++;
    if (over([cx, cz]) > 0) out++;
    if (w * dd < 20) small++; if (w * dd > 10000) big++;
    hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); hSum += h;
  }
  ok(inLm === 0, `aucun bâtiment centré dans le disque d’un monument (${inLm})`);
  ok(out === 0, `aucun centre de bâtiment hors BOUNDS (${out})`);
  info(`hauteur min ${hMin} m, moyenne ${(hSum / nB).toFixed(1)} m, max ${hMax} m ; ${small} rectangles < 20 m², ${big} > 1 ha`);
  ok(statSync(bFile).size < 5e6, `buildings.json : ${(statSync(bFile).size / 1e6).toFixed(2)} Mo (< 5 Mo)`);
} else info('buildings.json absent');

console.log('Statistiques');
const kinds = {}; for (const r of d.roads) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
info(`${d.roads.length} routes ${JSON.stringify(kinds)}, ${(d.roads.reduce((s, r) => s + polylineLength(r.points), 0) / 1000).toFixed(0)} km`);
info(`${d.roads.filter((r) => r.oneway).length} à sens unique, ${d.roads.filter((r) => r.bridge).length} ponts, ${d.roads.filter((r) => !r.name).length} sans nom`);
info(`${nodes.length} nœuds, ${edges.length} arêtes, ${d.parks.length} parcs, ${d.plazas.length} places, ${nB} bâtiments`);
ok(statSync(pFile).size < 3e6, `paris.json : ${(statSync(pFile).size / 1e6).toFixed(2)} Mo (< 3 Mo)`);
console.log(fails ? `\n${fails} vérification(s) en échec` : '\nToutes les vérifications passent');
process.exit(fails ? 1 : 0);

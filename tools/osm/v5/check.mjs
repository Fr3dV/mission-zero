// Vérifie les données d'une ville du contrat v5 (shared/world/<ville>/). Code de sortie 1 si un contrôle échoue.
// Usage : node tools/osm/check.mjs --city toulouse
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, OUT, BOUNDS, CITY_ID, readJSON } from './common.mjs';
import { polyArea, pointInPoly, selfIntersects, polylineLength } from '../geom.mjs';

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  OK    ' : '  ÉCHEC ') + msg); if (!c) fails++; return c; };
const info = (msg) => console.log('  ·     ' + msg);
const file = (n) => join(OUT, n), size = (n) => (existsSync(file(n)) ? statSync(file(n)).size : 0), mo = (n) => (size(n) / 1e6).toFixed(2) + ' Mo';
const d = readJSON(process.env.MZ_ROADS_FILE || file('roads.json')); // MZ_ROADS_FILE : contrôler une autre version (comparaison avant / après)
const { LANDMARKS, LANDMARK_BY_ID } = await import(pathToFileURL(join(ROOT, 'shared', 'cities', CITY_ID, 'landmarks.js')).href);
const { nodes, edges, nodeEle } = d.graph, roadById = new Map(d.roads.map((r) => [r.id, r]));
const over = (x, z) => Math.max(BOUNDS.minX - x, x - BOUNDS.maxX, BOUNDS.minZ - z, z - BOUNDS.maxZ, 0);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

console.log('Format et emprise');
const KINDS = new Set(['avenue', 'boulevard', 'street', 'quay', 'pedestrian', 'motorway', 'trunk', 'ramp']);
ok(d.meta?.source === 'osm' && d.meta.graphDirected === true && d.meta.city === CITY_ID, 'meta.source, meta.city, meta.graphDirected');
ok(d.roads.every((r) => Number.isInteger(r.id) && typeof r.name === 'string' && KINDS.has(r.kind) && r.width > 0 && Number.isInteger(r.lanes) && typeof r.oneway === 'boolean' && typeof r.bridge === 'boolean' && r.points.length >= 2 && (!r.ele || r.ele.length === r.points.length)), 'routes : champs obligatoires, kind connu, ele aligné sur points');
ok(roadById.size === d.roads.length, 'identifiants de routes uniques');
{ let worst = 0, n = 0; const see = (p) => { n++; const o = over(p[0], p[1]); if (o > worst) worst = o; };
  nodes.forEach(see); for (const r of d.roads) r.points.forEach(see); for (const p of d.river.polygons) p.forEach(see); for (const i of d.river.islands) i.polygon.forEach(see);
  for (const w of d.waterways) w.points.forEach(see); for (const r of d.rails) r.points.forEach(see); for (const p of d.parks) p.polygon.forEach(see); for (const p of d.plazas) p.polygon.forEach(see);
  ok(worst <= 0.051, `tout est dans BOUNDS (${n} points, dépassement maximal ${worst.toFixed(2)} m)`); }
ok(d.roads.every((r) => r.points.every((p, i) => i === 0 || p[0] !== r.points[i - 1][0] || p[1] !== r.points[i - 1][1])), 'aucun segment de longueur nulle');

console.log('Graphe');
ok(edges.every((e) => e.length === 3 && nodes[e[0]] && nodes[e[1]] && e[0] !== e[1] && roadById.has(e[2])), 'arêtes valides');
ok(Array.isArray(nodeEle) && nodeEle.length === nodes.length, 'graph.nodeEle aligné sur graph.nodes');
{ const key = (a, b) => a[0] + ',' + a[1] + '>' + b[0] + ',' + b[1]; const segs = new Map();
  for (const r of d.roads) for (let i = 1; i < r.points.length; i++) { const e0 = r.ele ? r.ele[i - 1] : 0, e1 = r.ele ? r.ele[i] : 0; segs.set(r.id + ':' + key(r.points[i - 1], r.points[i]), [e0, e1]); if (!r.oneway) segs.set(r.id + ':' + key(r.points[i], r.points[i - 1]), [e1, e0]); }
  let bad = 0, badEle = 0; for (const e of edges) { const s = segs.get(e[2] + ':' + key(nodes[e[0]], nodes[e[1]])); if (!s) bad++; else if (Math.abs(s[0] - nodeEle[e[0]]) > 0.01 || Math.abs(s[1] - nodeEle[e[1]]) > 0.01) badEle++; }
  ok(bad === 0, `chaque arête suit un segment de sa route, dans le bon sens (${bad} anomalies)`);
  ok(badEle === 0, `nodeEle identique à ele dans les routes (${badEle} écarts)`); }
const adj = nodes.map(() => []), radj = nodes.map(() => []);
for (const [a, b, id] of edges) { adj[a].push(b, id); radj[b].push(a, id); }
{ const reach = (g) => { const seen = new Uint8Array(nodes.length); seen[0] = 1; const st = [0]; let n = 1; while (st.length) { const v = st.pop(), a = g[v]; for (let i = 0; i < a.length; i += 2) if (!seen[a[i]]) { seen[a[i]] = 1; n++; st.push(a[i]); } } return n; };
  const f = reach(adj), b = reach(radj);
  ok(f === nodes.length && b === nodes.length, `graphe fortement connexe (${f}/${nodes.length} atteignables, ${b}/${nodes.length} co-atteignables)`);
  const inG = new Set(edges.map((e) => e[2])); const drv = d.roads.filter((r) => r.kind !== 'pedestrian' && !r.service && !r.busway), out = drv.filter((r) => !inG.has(r.id));
  info(`${d.roads.filter((r) => r.service && inG.has(r.id)).length} voies de desserte dans le graphe (nommées ou aérogare) sur ${d.roads.filter((r) => r.service).length}`);
  const fast = out.filter((r) => r.kind === 'motorway' || r.kind === 'trunk');
  info(`${nodes.length} nœuds, ${edges.length} arêtes orientées ; ${out.length} routes carrossables hors graphe (${(out.reduce((s, r) => s + polylineLength(r.points), 0) / 1000).toFixed(1)} km) dont ${fast.length} autoroutes / voies rapides (${(fast.reduce((s, r) => s + polylineLength(r.points), 0) / 1000).toFixed(1)} km)`); }

console.log('Rocade');
{ // tour complet dans le graphe en ne suivant que autoroutes, voies rapides et bretelles : graphe « déroulé » où
  // l'état porte le nombre de tours autour de l'origine (franchissements signés du demi-axe x > 0)
  const fastIds = new Set(d.roads.filter((r) => r.kind === 'motorway' || r.kind === 'trunk' || r.kind === 'ramp').map((r) => r.id));
  const ring = d.roads.filter((r) => r.kind === 'motorway' && /^(A620|A61|A62)$/.test(r.ref || ''));
  info(`${ring.length} tronçons A620 / A61 / A62 (${(ring.reduce((s, r) => s + polylineLength(r.points), 0) / 1000).toFixed(0)} km de chaussées)`);
  const cross = (a, b) => { const p = nodes[a], q = nodes[b]; if ((p[1] < 0) === (q[1] < 0)) return 0; const x = p[0] + ((0 - p[1]) / (q[1] - p[1])) * (q[0] - p[0]); return x > 0 ? (q[1] > p[1] ? 1 : -1) : 0; }; // +1 = passage du nord au sud à l'est de l'origine = sens horaire
  const start = new Map(); for (const [a, , id] of edges) if (roadById.get(id).kind === 'motorway' && /^(A620|A61|A62)$/.test(roadById.get(id).ref || '') && !start.has(id)) start.set(id, a);
  const tour = (dir) => { // plus court circuit de nombre de tours `dir` (+1 horaire, −1 antihoraire) parmi quelques départs
    let shortest = 0;
    for (const s of [...start.values()].filter((_, i) => i % 5 === 0).slice(0, 16)) { const l = tourFrom(s, dir); if (l && (!shortest || l < shortest)) shortest = l; }
    return shortest;
  };
  const tourFrom = (s, dir) => {
    {
      // plus court circuit (Dijkstra) dans le graphe déroulé (nœud, nombre de tours)
      const best = new Map([[s * 8 + 3, 0]]), q = [[0, s, 0]];
      while (q.length) {
        let mi = 0; for (let i = 1; i < q.length; i++) if (q[i][0] < q[mi][0]) mi = i; const [len, v, k] = q.splice(mi, 1)[0];
        if (len > (best.get(v * 8 + k + 3) ?? Infinity)) continue;
        if (v === s && k === dir) return len;
        const a = adj[v]; for (let i = 0; i < a.length; i += 2) { if (!fastIds.has(a[i + 1])) continue; const nk = k + cross(v, a[i]); if (Math.abs(nk) > 1) continue; const nl = len + dist(nodes[v], nodes[a[i]]); const key = a[i] * 8 + nk + 3; if (nl < (best.get(key) ?? Infinity)) { best.set(key, nl); q.push([nl, a[i], nk]); } }
      }
    }
    return 0;
  };
  const cw = tour(1), ccw = tour(-1);
  ok(cw > 0, `tour complet de la rocade dans le sens horaire (périphérique intérieur) : ${(cw / 1000).toFixed(1)} km`);
  ok(ccw > 0, `tour complet de la rocade dans le sens antihoraire (périphérique extérieur) : ${(ccw / 1000).toFixed(1)} km`);
  for (const ref of ['A620', 'A61', 'A62', 'A64', 'A68', 'A621', 'A624']) { const rs = d.roads.filter((r) => r.ref === ref); ok(rs.length > 0, `${ref} : ${rs.length} tronçons, ${(rs.reduce((s, r) => s + polylineLength(r.points), 0) / 1000).toFixed(1)} km, ${[...new Set(rs.map((r) => r.maxspeed))].join('/')} km/h, ${[...new Set(rs.map((r) => r.lanes))].sort().join('/')} voies`); }
  const rb = d.roads.filter((r) => r.roundabout && dist(r.points[0], r.points[r.points.length - 1]) < 0.01 && r.points.length >= 4);
  const ccwRb = rb.filter((r) => polyArea(r.points.slice(0, -1)) < 0).length; // aire signée négative en (x, z sud) = sens antihoraire vu de dessus
  ok(ccwRb >= rb.length * 0.98, `giratoires fermés parcourus dans le sens antihoraire : ${ccwRb}/${rb.length} (${d.roads.filter((r) => r.roundabout).length} tronçons de giratoire au total)`); }

console.log('Monuments et repères');
{ // un repère posé côté pistes (tarmac, avions) n'est desservi par aucune voie publique : simple information
  const airside = []; if (size('pois.json')) for (const a of readJSON(file('pois.json')).areas) if (a.kind === 'apron' || a.kind === 'taxiway' || a.kind === 'runway') airside.push(a.polygon);
  for (const l of LANDMARKS) { let best = Infinity; for (const n of nodes) { const dd = Math.hypot(n[0] - l.x, n[1] - l.z); if (dd < best) best = dd; }
    if (best >= 300 && airside.some((p) => pointInPoly(l.x, l.z, p) || p.some((q) => Math.hypot(q[0] - l.x, q[1] - l.z) < 120))) info(`${l.name} : en zone aéroportuaire fermée (aucune voie publique), nœud du graphe le plus proche à ${best.toFixed(0)} m`);
    else ok(best < 300, `${l.name} : nœud du graphe le plus proche à ${best.toFixed(0)} m`); } }
{ const A = LANDMARK_BY_ID.tls_hoteldieu, B = LANDMARK_BY_ID.tls_daurade;
  if (A && B) { let hit = null; for (let i = 0; i <= 200 && !hit; i++) { const t = i / 200, x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t; if (d.river.polygons.some((p) => pointInPoly(x, z, p))) hit = [x, z]; } ok(!!hit, `la Garonne passe entre l'Hôtel-Dieu et la Daurade${hit ? ` (x=${hit[0].toFixed(0)}, z=${hit[1].toFixed(0)})` : ''}`); }
  const M = LANDMARK_BY_ID.tls_matabiau; let best = Infinity;
  for (const w of d.waterways) if (/canal du midi/i.test(w.name)) for (const p of w.points) best = Math.min(best, Math.hypot(p[0] - M.x, p[1] - M.z));
  ok(best < 250, `le canal du Midi passe à ${best.toFixed(0)} m de la gare Matabiau`);
  const isl = d.river.islands.map((i) => i.name).filter(Boolean); ok(isl.some((n) => /Ramier/.test(n)), `îles : ${[...new Set(isl)].join(', ')}`);
  const wn = (re) => d.waterways.filter((w) => re.test(w.name)); for (const [n, re] of [['canal du Midi', /canal du midi/i], ['canal de Brienne', /brienne/i], ['canal latéral', /lat[ée]ral/i], ['le Touch', /touch/i], ["l'Hers", /hers/i]]) { const ws = wn(re); ok(ws.length > 0, `${n} : ${(ws.reduce((s, w) => s + polylineLength(w.points), 0) / 1000).toFixed(1)} km, largeur ${[...new Set(ws.map((w) => w.width))].join('/')} m`); }
  const kinds = d.rails.reduce((a, r) => ((a[r.kind] = (a[r.kind] || 0) + polylineLength(r.points) / 1000), a), {});
  ok(kinds.tram > 5 && kinds.train > 20 && kinds.metro > 1 && kinds.cable > 1, `rails : ${Object.entries(kinds).map(([k, v]) => k + ' ' + v.toFixed(1) + ' km').join(', ')}`);
  const pl = (re) => d.plazas.filter((p) => re.test(p.name)).length; const want = ['Capitole', 'Wilson', 'Saint-Georges', 'Saint-Pierre', 'Salin', 'Esquirol', "Jeanne d'Arc", 'Arnaud Bernard'];
  info(`places nommées présentes : ${want.filter((n) => pl(new RegExp(n.replace(/[- ]/g, '.'), 'i'))).join(', ')} ; absentes : ${want.filter((n) => !pl(new RegExp(n.replace(/[- ]/g, '.'), 'i'))).join(', ') || 'aucune'}`); }

console.log('Niveaux superposés (ele)');
{ let maxSlope = 0, worst = '', nSteep = 0, longGap = 0, maxE = 0, minE = 0, minorMax = 0, minorSteep = 0;
  for (const r of d.roads) { if (!r.ele) continue; const minor = r.service || r.kind === 'pedestrian'; for (let i = 1; i < r.points.length; i++) { const L = dist(r.points[i - 1], r.points[i]), de = Math.abs(r.ele[i] - r.ele[i - 1]); maxE = Math.max(maxE, r.ele[i]); minE = Math.min(minE, r.ele[i]); if (!de && !r.ele[i]) continue; const s = de / Math.max(L, 0.5); if (L > 15.5 && (r.ele[i] || r.ele[i - 1])) longGap++; if (minor) { if (L > 1) { minorMax = Math.max(minorMax, s); if (s > 0.2) minorSteep++; } continue; } if (s > maxSlope) { maxSlope = s; worst = `${r.name || r.ref || r.kind} #${r.id}`; } if (s > 0.0805 && L > 1) nSteep++; } }
  ok(nSteep === 0, `aucune pente d'ele supérieure à 8 % sur les voies publiques (maximum ${(maxSlope * 100).toFixed(1)} % sur ${worst} ; ${nSteep} segments en excès)`);
  info(`dessertes et rues piétonnes (rampes propres, jamais reportées sur une voie publique) : pente d'ele maximale ${(minorMax * 100).toFixed(0)} %, ${minorSteep} segments à plus de 20 %`);
  ok(longGap === 0, `un sommet tous les 15 m au plus là où ele ≠ 0 (${longGap} segments trop longs)`);
  // continuité aux sommets partagés et croisements dénivelés
  const at = new Map(); let disc = 0;
  for (const r of d.roads) r.points.forEach((p, i) => { const k = p[0] + ',' + p[1], e = r.ele ? r.ele[i] : 0; const prev = at.get(k); if (prev === undefined) at.set(k, [e]); else if (!prev.some((v) => Math.abs(v - e) < 0.01)) { if (prev.some((v) => Math.abs(v - e) < 5)) disc++; prev.push(e); } });
  ok(disc === 0, `continuité d'ele aux sommets partagés (${disc} sommets où deux routes diffèrent de moins de 5 m sans être au même niveau)`);
  const G = 60, grid = new Map();
  d.roads.forEach((r, ri) => { for (let i = 1; i < r.points.length; i++) { const a = r.points[i - 1], b = r.points[i]; for (let gx = Math.floor(Math.min(a[0], b[0]) / G); gx <= Math.floor(Math.max(a[0], b[0]) / G); gx++) for (let gz = Math.floor(Math.min(a[1], b[1]) / G); gz <= Math.floor(Math.max(a[1], b[1]) / G); gz++) { const k = gx * 100003 + gz; let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(ri, i); } } });
  let nCross = 0, nBad = 0; const badList = [], seen = new Set();
  for (const cell of grid.values()) for (let p = 0; p < cell.length; p += 2) for (let q = p + 2; q < cell.length; q += 2) {
    const ri = cell[p], i = cell[p + 1], rj = cell[q], j = cell[q + 1]; if (ri === rj && Math.abs(i - j) < 2) continue;
    const A = d.roads[ri], B = d.roads[rj], a1 = A.points[i - 1], a2 = A.points[i], b1 = B.points[j - 1], b2 = B.points[j];
    if ([a1, a2].some((a) => [b1, b2].some((b) => a[0] === b[0] && a[1] === b[1]))) continue; // sommet commun = carrefour (continuité vérifiée plus haut)
    const den = (a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0]); if (Math.abs(den) < 1e-9) continue;
    const t = ((b1[0] - a1[0]) * (b2[1] - b1[1]) - (b1[1] - a1[1]) * (b2[0] - b1[0])) / den, u = ((b1[0] - a1[0]) * (a2[1] - a1[1]) - (b1[1] - a1[1]) * (a2[0] - a1[0])) / den;
    if (t <= 0.0005 || t >= 0.9995 || u <= 0.0005 || u >= 0.9995) continue;
    const key = ri < rj ? `${ri}:${i}:${rj}:${j}` : `${rj}:${j}:${ri}:${i}`; if (seen.has(key)) continue; seen.add(key); nCross++;
    const ea = (A.ele ? A.ele[i - 1] + (A.ele[i] - A.ele[i - 1]) * t : 0), eb = (B.ele ? B.ele[j - 1] + (B.ele[j] - B.ele[j - 1]) * u : 0);
    if (Math.abs(ea - eb) < 5) { nBad++; if (badList.length < 8) badList.push(`${A.name || A.ref || A.kind} / ${B.name || B.ref || B.kind} (${Math.abs(ea - eb).toFixed(1)} m @ ${(a1[0] + t * (a2[0] - a1[0])).toFixed(0)},${(a1[1] + t * (a2[1] - a1[1])).toFixed(0)})`); }
  }
  ok(nBad === 0, `aucun croisement de deux routes sans sommet commun à moins de 5 m d'écart vertical (${nCross} croisements dénivelés, ${nBad} fautifs${nBad ? ' : ' + badList.join(' ; ') : ''})`);
  const we = d.roads.filter((r) => r.ele), up = we.filter((r) => Math.max(...r.ele) > 0.5), dn = we.filter((r) => Math.min(...r.ele) < -0.5);
  const br = d.roads.filter((r) => r.bridge), tu = d.roads.filter((r) => r.tunnel);
  info(`${we.length} routes portent ele (${up.length} relevées, ${dn.length} abaissées), de ${minE} à ${maxE} m ; ponts : ${br.filter((r) => r.ele && Math.max(...r.ele) > 3).length} relevés sur ${br.length} (les autres franchissent l'eau ou une voie en tranchée) ; tunnels / trémies : ${tu.filter((r) => r.ele && Math.min(...r.ele) < -3).length} abaissés sur ${tu.length}`);
  const rl = d.rails.filter((r) => r.ele); info(`${rl.length} tronçons de rail portent ele (${rl.filter((r) => Math.max(...r.ele) > 3).length} en viaduc ou remblai, ${rl.filter((r) => Math.min(...r.ele) < -3).length} en tranchée)`); }

console.log('Niveaux : propagation et valeurs extrêmes');
{ // croisements dénivelés de chaque route (avec une autre route, un rail ou un cours d'eau), repérés par leur abscisse curviligne
  const arcs = d.roads.map((r) => { const s = [0]; for (let i = 1; i < r.points.length; i++) s.push(s[i - 1] + dist(r.points[i - 1], r.points[i])); return s; });
  const crossAt = d.roads.map(() => []);
  const G = 60, grid = new Map();
  const put = (a, b, v) => { for (let gx = Math.floor(Math.min(a[0], b[0]) / G); gx <= Math.floor(Math.max(a[0], b[0]) / G); gx++) for (let gz = Math.floor(Math.min(a[1], b[1]) / G); gz <= Math.floor(Math.max(a[1], b[1]) / G); gz++) { const k = gx * 100003 + gz; let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(v); } };
  d.roads.forEach((r, ri) => { for (let i = 1; i < r.points.length; i++) put(r.points[i - 1], r.points[i], [0, ri, i]); });
  d.rails.forEach((r, ri) => { if (r.kind !== 'cable') for (let i = 1; i < r.points.length; i++) put(r.points[i - 1], r.points[i], [1, ri, i]); });
  d.waterways.forEach((w, wi) => { if (w.kind !== 'stream') for (let i = 1; i < w.points.length; i++) put(w.points[i - 1], w.points[i], [2, wi, i]); });
  const src = [d.roads, d.rails, d.waterways];
  for (const cell of grid.values()) for (let p = 0; p < cell.length; p++) for (let q = p + 1; q < cell.length; q++) {
    const [ta, ia, sa] = cell[p], [tb, ib, sb] = cell[q]; if (ta !== 0 && tb !== 0) continue; if (ta === tb && ia === ib && Math.abs(sa - sb) < 2) continue;
    const A = src[ta][ia], B = src[tb][ib], a1 = A.points[sa - 1], a2 = A.points[sa], b1 = B.points[sb - 1], b2 = B.points[sb];
    const den = (a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0]); if (Math.abs(den) < 1e-9) continue;
    const t = ((b1[0] - a1[0]) * (b2[1] - b1[1]) - (b1[1] - a1[1]) * (b2[0] - b1[0])) / den, u = ((b1[0] - a1[0]) * (a2[1] - a1[1]) - (b1[1] - a1[1]) * (a2[0] - a1[0])) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    const ea = A.ele ? A.ele[sa - 1] + (A.ele[sa] - A.ele[sa - 1]) * t : 0, eb = B.ele ? B.ele[sb - 1] + (B.ele[sb] - B.ele[sb - 1]) * u : 0;
    if (Math.abs(ea - eb) < 3 && !(tb === 2 || ta === 2)) continue; // même niveau : carrefour ou passage à niveau
    if ((ta === 2 || tb === 2) && Math.abs(ea - eb) < 3 && !(ta === 0 ? A.bridge : B.bridge)) continue;
    if (ta === 0) crossAt[ia].push(arcs[ia][sa - 1] + t * (arcs[ia][sa] - arcs[ia][sa - 1]));
    if (tb === 0) crossAt[ib].push(arcs[ib][sb - 1] + u * (arcs[ib][sb] - arcs[ib][sb - 1]));
  }
  // (a) voie publique dénivelée de plus de 2 m sur plus de 60 m, à plus de 150 m — LE LONG DES VOIES — de tout
  // croisement dénivelé : une rampe légitime (6,5 m à 6,5 %) s'arrête bien avant ; une source d'élévation parasite
  // (rampe de parking, tunnel sans croisement) ou une propagation trop longue est attrapée ici.
  const vKey = (r, i) => r.points[i][0] + ',' + r.points[i][1] + ',' + (r.ele ? r.ele[i] : 0);
  const vIdx = new Map(), vAdj = []; const vOf = (k) => { let v = vIdx.get(k); if (v === undefined) { v = vAdj.length; vIdx.set(k, v); vAdj.push([]); } return v; };
  d.roads.forEach((r) => { for (let i = 1; i < r.points.length; i++) { const a = vOf(vKey(r, i - 1)), b = vOf(vKey(r, i)), L = dist(r.points[i - 1], r.points[i]); vAdj[a].push(b, L); vAdj[b].push(a, L); } });
  const dCross = new Float64Array(vAdj.length).fill(Infinity); { const heap = [];
    d.roads.forEach((r, ri) => { for (const c of crossAt[ri]) { let i = 1; while (i < arcs[ri].length - 1 && arcs[ri][i] < c) i++; for (const j of [i - 1, i]) { const v = vOf(vKey(r, j)), dd = Math.abs(arcs[ri][j] - c); if (dd < dCross[v]) { dCross[v] = dd; heap.push([dd, v]); } } } });
    heap.sort((a, b) => a[0] - b[0]); const queue = heap; // Dijkstra simple (file triée, peu de sources)
    while (queue.length) { let mi = 0; for (let i = 1; i < queue.length && i < 64; i++) if (queue[i][0] < queue[mi][0]) mi = i; const [dd, v] = queue.splice(mi, 1)[0]; if (dd > dCross[v] || dd > 400) continue; const a = vAdj[v]; for (let i = 0; i < a.length; i += 2) { const nd = dd + a[i + 1]; if (nd < dCross[a[i]] && nd <= 400) { dCross[a[i]] = nd; let lo = 0, hi = queue.length; while (lo < hi) { const m = (lo + hi) >> 1; if (queue[m][0] < nd) lo = m + 1; else hi = m; } queue.splice(lo, 0, [nd, a[i]]); } } } }
  const flagged = [], decks = [];
  d.roads.forEach((r, ri) => {
    if (!r.ele || r.tunnel || r.service || !['boulevard', 'avenue', 'street'].includes(r.kind)) return;
    let L = 0, worst = 0, at = null;
    for (let i = 1; i < r.points.length; i++) { if (Math.abs(r.ele[i - 1]) <= 2 || Math.abs(r.ele[i]) <= 2) continue; if (dCross[vOf(vKey(r, i - 1))] <= 150 || dCross[vOf(vKey(r, i))] <= 150) continue; L += arcs[ri][i] - arcs[ri][i - 1]; if (Math.abs(r.ele[i]) > Math.abs(worst)) { worst = r.ele[i]; at = r.points[i]; } }
    if (L > 60) (r.bridge ? decks : flagged).push({ r, L, worst, at });
  });
  flagged.sort((a, b) => Math.hypot(a.at[0], a.at[1]) - Math.hypot(b.at[0], b.at[1]));
  ok(flagged.length === 0, `aucune voie publique dénivelée de plus de 2 m sur plus de 60 m à plus de 150 m (le long des voies) d'un croisement dénivelé (${flagged.length} cas)`);
  for (const f of flagged.slice(0, 40)) info(`   ${f.r.kind} « ${f.r.name || '—'} » #${f.r.id} : ${f.L.toFixed(0)} m jusqu'à ${f.worst} m, vers x=${f.at[0].toFixed(0)}, z=${f.at[1].toFixed(0)} (à ${(Math.hypot(f.at[0], f.at[1]) / 1000).toFixed(1)} km du Capitole)`);
  if (decks.length) info(`tabliers de grands ponts (plats par construction, donc relevés loin de la voie franchie) : ${decks.map((f) => `${f.r.bridgeName || f.r.name || f.r.kind} ${f.worst} m`).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`);
  // carrefours publics de 4 branches ou plus déplacés de plus de 1 m (rampe d'un ouvrage voisin)
  { const deg = new Map(), eleOf = new Map(); for (const r of d.roads) { if (r.service || r.kind === 'pedestrian') continue; r.points.forEach((p, i) => { const k = p[0] + ',' + p[1] + ',' + (r.ele ? r.ele[i] : 0); deg.set(k, (deg.get(k) || 0) + (i === 0 || i === r.points.length - 1 ? 1 : 2)); eleOf.set(k, r.ele ? r.ele[i] : 0); }); }
    let big = 0, moved = 0, moved3 = 0; for (const [k, n] of deg) if (n >= 4) { big++; const e = Math.abs(eleOf.get(k)); if (e > 1) moved++; if (e > 3) moved3++; }
    info(`carrefours publics de 4 branches ou plus : ${big}, dont ${moved} déplacés de plus de 1 m et ${moved3} de plus de 3 m (rampe d'accès d'un ouvrage voisin)`); }
  // (b) places traversées par une voie dénivelée
  const badPlazas = [];
  for (const pz of d.plazas) { let worst = 0, who = null; const bb = pz.polygon.reduce((a, p) => [Math.min(a[0], p[0]), Math.max(a[1], p[0]), Math.min(a[2], p[1]), Math.max(a[3], p[1])], [Infinity, -Infinity, Infinity, -Infinity]);
    for (const r of d.roads) { if (!r.ele || r.tunnel) continue; r.points.forEach((p, i) => { if (Math.abs(r.ele[i]) > Math.abs(worst) && p[0] >= bb[0] && p[0] <= bb[1] && p[1] >= bb[2] && p[1] <= bb[3] && pointInPoly(p[0], p[1], pz.polygon)) { worst = r.ele[i]; who = r; } }); }
    if (Math.abs(worst) > 1) badPlazas.push(`${pz.name || 'place sans nom'} (${who.name || who.kind} à ${worst} m)`); }
  ok(badPlazas.length === 0, `aucune place traversée par une voie à plus de 1 m du sol (${badPlazas.length} cas${badPlazas.length ? ' : ' + badPlazas.slice(0, 12).join(' ; ') : ''})`);
  // (c) valeurs extrêmes : à justifier (viaduc ou échangeur à plusieurs niveaux, passage sous un pont-canal)
  const ext = d.roads.filter((r) => r.ele && (Math.min(...r.ele) < -7 || Math.max(...r.ele) > 12));
  const explained = (r) => r.kind === 'motorway' || r.kind === 'trunk' || r.kind === 'ramp' || r.bridge;
  const groups = new Map(); for (const r of ext) { const lo = Math.min(...r.ele), hi = Math.max(...r.ele), i = r.ele.indexOf(hi > 12 ? hi : lo), k = `${Math.round(r.points[i][0] / 400)},${Math.round(r.points[i][1] / 400)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push([r, hi > 12 ? hi : lo, r.points[i]]); }
  for (const g of groups.values()) info(`   extrême vers x=${g[0][2][0].toFixed(0)}, z=${g[0][2][1].toFixed(0)} : ${g.map(([r, v]) => `${r.ref || r.name || r.kind}${r.bridge ? ' (pont)' : ''} ${v} m`).filter((v, i, a) => a.indexOf(v) === i).slice(0, 8).join(', ')}`);
  const unexplained = ext.filter((r) => !explained(r) && !(Math.min(...r.ele) >= -8.6 && Math.max(...r.ele) <= 12));
  ok(unexplained.length === 0, `valeurs extrêmes (ele < −7 m ou > +12 m) : ${ext.length} routes en ${groups.size} lieux, toutes sur un viaduc, un échangeur ou sous un pont-canal (${unexplained.length} sans explication${unexplained.length ? ' : ' + unexplained.slice(0, 6).map((r) => `${r.name || r.kind} #${r.id}`).join(', ') : ''})`);
}

console.log('Polygones');
{ const polys = [...d.river.polygons.map((p) => ['eau', p]), ...d.river.islands.map((i) => ['île ' + i.name, i.polygon]), ...d.parks.map((p) => ['parc ' + p.name, p.polygon]), ...d.plazas.map((p) => ['place ' + p.name, p.polygon])];
  const bad = polys.filter(([, p]) => p.length < 3 || (p.length < 2500 && selfIntersects(p))).map(([n]) => n);
  ok(bad.length === 0, `eau, îles, parcs, places : ${polys.length} polygones simples${bad.length ? ' ; fautifs : ' + bad.slice(0, 6).join(', ') : ''}`);
  ok(polys.every(([, p]) => polyArea(p) > 0), 'sens cohérent (aire signée positive)');
  info(`eau : ${(d.river.polygons.reduce((s, p) => s + polyArea(p), 0) / 1e4).toFixed(0)} ha en ${d.river.polygons.length} polygones ; ${d.waterways.length} cours d'eau (${(d.waterways.reduce((s, w) => s + polylineLength(w.points), 0) / 1000).toFixed(0)} km) ; ${d.parks.length} parcs, ${d.plazas.length} places`); }

console.log('Bâtiments');
let nB = 0;
if (size('buildings.bin')) {
  const buf = readFileSync(file('buildings.bin')), f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4); nB = f.length / 6;
  const bm = readJSON(file('buildings-meta.json')), mb = readFileSync(file('buildings-meta.bin'));
  ok(f.length % 6 === 0 && f.every(Number.isFinite), `buildings.bin : ${nB} × 6 nombres finis`);
  ok(bm.stride === 4 && mb.length === nB * bm.stride && bm.count === nB, `buildings-meta.bin : ${mb.length / bm.stride} × ${bm.stride} octets, aligné sur buildings.bin`);
  let inLm = 0, out = 0, hMin = Infinity, hMax = 0, hSum = 0, badIdx = 0; const kc = {}, wc = {}, rc = {};
  for (let i = 0; i < nB; i++) { const cx = f[i * 6], cz = f[i * 6 + 1], h = f[i * 6 + 5]; if (LANDMARKS.some((l) => Math.hypot(cx - l.x, cz - l.z) < l.radius)) inLm++; if (over(cx, cz) > 0) out++; hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); hSum += h; const k = bm.kinds[mb[i * 4]], w = bm.walls[mb[i * 4 + 1]], r = bm.roofs[mb[i * 4 + 2]]; if (!k || !w || !r || !mb[i * 4 + 3]) badIdx++; kc[k] = (kc[k] || 0) + 1; wc[w] = (wc[w] || 0) + 1; rc[r] = (rc[r] || 0) + 1; }
  ok(inLm === 0, `aucun bâtiment centré dans le disque d'un monument (${inLm})`);
  ok(out === 0 && badIdx === 0, `centres dans BOUNDS (${out} dehors), index kind / wall / roof / levels valides (${badIdx} fautifs)`);
  // aucun axe de route ne traverse un bâtiment (hors tunnels et tranchées)
  const G = 40, grid = new Map(); for (let i = 0; i < nB; i++) { const cx = f[i * 6], cz = f[i * 6 + 1], rad = Math.hypot(f[i * 6 + 2], f[i * 6 + 3]) / 2; for (let gx = Math.floor((cx - rad) / G); gx <= Math.floor((cx + rad) / G); gx++) for (let gz = Math.floor((cz - rad) / G); gz <= Math.floor((cz + rad) / G); gz++) { const k = gx * 100003 + gz; let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(i); } }
  let samples = 0, hits = 0;
  for (const r of d.roads) { if (r.tunnel) continue; for (let i = 1; i < r.points.length; i++) { if (r.ele && (r.ele[i - 1] + r.ele[i]) / 2 <= -4) continue; const [ax, az] = r.points[i - 1], [bx, bz] = r.points[i], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 4)); for (let s = 0; s <= n; s++) { const x = ax + ((bx - ax) * s) / n, z = az + ((bz - az) * s) / n; samples++; for (const bi of grid.get(Math.floor(x / G) * 100003 + Math.floor(z / G)) || []) { const t = (f[bi * 6 + 4] * Math.PI) / 180, ux = Math.cos(t), uz = -Math.sin(t), dx = x - f[bi * 6], dz = z - f[bi * 6 + 1]; if (Math.abs(dx * ux + dz * uz) < f[bi * 6 + 2] / 2 - 0.05 && Math.abs(-dx * uz + dz * ux) < f[bi * 6 + 3] / 2 - 0.05) { hits++; break; } } } } }
  ok(hits === 0, `aucun axe de route ne traverse un bâtiment (${samples} points testés, ${hits} dans un rectangle)`);
  info(`par type : ${Object.entries(kc).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ')}`);
  info(`murs : ${Object.entries(wc).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ')} ; toits : ${Object.entries(rc).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ')}`);
  info(`hauteur : min ${hMin.toFixed(1)} m, moyenne ${(hSum / nB).toFixed(1)} m, max ${hMax.toFixed(1)} m`);
} else info('buildings.bin absent');

console.log('Relief');
if (size('terrain.json')) {
  const t = readJSON(file('terrain.json'));
  ok(t.nx > 1 && t.nz > 1 && t.data.length === t.nx * t.nz && t.data.every(Number.isInteger) && t.scale > 0, `grille ${t.nx} × ${t.nz}, pas ${t.cell} m, entiers × ${t.scale}`);
  ok(t.x0 <= BOUNDS.minX - 250 && t.z0 <= BOUNDS.minZ - 250 && t.x0 + (t.nx - 1) * t.cell >= BOUNDS.maxX + 250 && t.z0 + (t.nz - 1) * t.cell >= BOUNDS.maxZ + 250, 'couvre BOUNDS avec au moins 250 m de marge');
  const at = (x, z) => { const fx = Math.max(0, Math.min(t.nx - 1.001, (x - t.x0) / t.cell)), fz = Math.max(0, Math.min(t.nz - 1.001, (z - t.z0) / t.cell)), i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * t.nx + i; const a = t.data[k] + (t.data[k + 1] - t.data[k]) * tx, b = t.data[k + t.nx] + (t.data[k + t.nx + 1] - t.data[k + t.nx]) * tx; return (a + (b - a) * tz) * t.scale; };
  let wmax = 0, n = 0; for (const p of d.river.polygons) { if (polyArea(p) < 10000) continue; for (let i = 0; i < p.length; i += 3) { wmax = Math.max(wmax, at(p[i][0], p[i][1])); n++; } }
  for (const w of d.waterways) if (w.kind === 'canal') for (let i = 0; i < w.points.length; i += 2) { wmax = Math.max(wmax, at(w.points[i][0], w.points[i][1])); n++; }
  ok(wmax <= 0.5, `relief nul au bord des grands plans d'eau et des canaux (${n} points, maximum ${wmax.toFixed(2)} m)`);
  let max = 0, mi = 0; t.data.forEach((v, i) => { if (v > max) { max = v; mi = i; } });
  ok(max * t.scale >= 60, `coteaux conservés : point culminant ${(max * t.scale).toFixed(0)} m au-dessus des quais en x=${(t.x0 + (mi % t.nx) * t.cell).toFixed(0)}, z=${(t.z0 + Math.floor(mi / t.nx) * t.cell).toFixed(0)} (Pech-David)`);
  let steep = 0; for (let j = 0; j < t.nz; j++) for (let i = 1; i < t.nx; i++) if (Math.abs(t.data[j * t.nx + i] - t.data[j * t.nx + i - 1]) * t.scale / t.cell > 0.6) steep++;
  info(`${steep} mailles à plus de 60 % de pente ; ${Math.round((100 * t.data.filter((v) => v === 0).length) / t.data.length)} % de la grille à 0 ; Capitole ${at(0, 0).toFixed(1)} m`);
  let rmax = 0; for (const r of d.roads) { if (r.kind !== 'motorway') continue; for (let i = 1; i < r.points.length; i++) { const L = dist(r.points[i - 1], r.points[i]); if (L < 20) continue; const s = Math.abs(at(...r.points[i]) - at(...r.points[i - 1])) / L; if (s > rmax) rmax = s; } }
  info(`pente maximale du relief le long des autoroutes : ${(rmax * 100).toFixed(1)} %`);
} else info('terrain.json absent : monde plat');

console.log('Points d’intérêt');
if (size('pois.json')) {
  const po = readJSON(file('pois.json'));
  let n = 0, outN = 0; const see = (x, z) => { n++; if (over(x, z) > 0.051) outN++; };
  for (let i = 0; i < po.trees.length; i += 2) see(po.trees[i], po.trees[i + 1]);
  for (const p of po.pois) see(p.x, p.z); for (const p of po.paths) p.points.forEach((q) => see(q[0], q[1])); for (const p of po.treeRows) p.points.forEach((q) => see(q[0], q[1])); for (const w of po.water) w.polygon.forEach((q) => see(q[0], q[1])); for (const a of po.areas) a.polygon.forEach((q) => see(q[0], q[1]));
  ok(outN === 0, `tout est dans BOUNDS (${n} points, ${outN} dehors)`);
  ok(po.trees.length / 2 >= 50000 && po.treeGenus.length === po.trees.length / 2, `${po.trees.length / 2} arbres, genre connu pour ${po.treeGenus.filter(Boolean).length} (${po.treeGenus.filter((g) => po.treeGenera[g] === 'Platanus').length} platanes)`);
  const kc = {}; for (const p of po.pois) kc[p.kind] = (kc[p.kind] || 0) + 1;
  const metro = new Set(po.pois.filter((p) => p.kind === 'metro').map((p) => p.name));
  ok(['Capitole', 'Jean Jaurès', 'Esquirol', 'Arènes', 'Basso Cambo', 'Balma-Gramont', 'Borderouge', 'Ramonville'].every((s) => metro.has(s)), `${metro.size} stations de métro nommées (lignes A et B)`);
  ok((kc.tram || 0) >= 15 && (kc.velib || 0) >= 200 && (kc.busstop || 0) >= 1000 && (kc.lock || 0) >= 3 && (kc.pylon || 0) >= 5, `tram ${kc.tram}, VélôToulouse ${kc.velib}, bus ${kc.busstop}, écluses ${kc.lock}, pylônes Téléo ${kc.pylon}`);
  const mk = po.pois.filter((p) => p.kind === 'market').map((p) => p.name).join('|'); ok(/Victor Hugo/.test(mk) && /Carmes/.test(mk) && /Saint-Cyprien/.test(mk), 'marchés Victor-Hugo, des Carmes et Saint-Cyprien présents');
  const ac = {}; for (const a of po.areas) ac[a.kind] = (ac[a.kind] || 0) + 1;
  ok(['forest', 'farmland', 'industrial', 'commercial', 'residential', 'parking', 'pitch', 'cemetery', 'railway', 'runway', 'taxiway', 'apron'].every((k) => ac[k] > 0), `surfaces : ${Object.entries(ac).map(([k, v]) => k + ' ' + v).join(', ')}`);
  const ap = LANDMARK_BY_ID.tls_aeroport; if (ap) ok(po.areas.some((a) => a.kind === 'runway' && a.polygon.some((p) => Math.hypot(p[0] - ap.x, p[1] - ap.z) < 2500)), 'pistes de l’aéroport de Blagnac présentes');
  const polys = [...po.water.map((w) => w.polygon), ...po.areas.map((a) => a.polygon)]; const bad = polys.filter((p) => p.length < 3 || polyArea(p) <= 0 || (p.length < 1500 && selfIntersects(p))).length;
  ok(bad === 0, `water / areas : ${polys.length} polygones simples, sens cohérent (${bad} fautifs)`);
  // platanes du canal du Midi : arbres réels ou alignements à moins de 25 m de l'axe
  const canal = d.waterways.filter((w) => /canal du midi/i.test(w.name)); let L = 0, covered = 0; const G = 50, tg = new Map();
  const put = (x, z) => { const k = Math.floor(x / G) * 100003 + Math.floor(z / G); tg.set(k, (tg.get(k) || 0) + 1); };
  for (let i = 0; i < po.trees.length; i += 2) put(po.trees[i], po.trees[i + 1]); for (const r of po.treeRows) for (let i = 1; i < r.points.length; i++) { const a = r.points[i - 1], b = r.points[i], m = Math.max(1, Math.round(dist(a, b) / 8)); for (let s = 0; s < m; s++) put(a[0] + ((b[0] - a[0]) * s) / m, a[1] + ((b[1] - a[1]) * s) / m); }
  for (const w of canal) for (let i = 1; i < w.points.length; i++) { const a = w.points[i - 1], b = w.points[i], l = dist(a, b); L += l; let c = 0; for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) c += tg.get((Math.floor((a[0] + b[0]) / 2 / G) + gx) * 100003 + Math.floor((a[1] + b[1]) / 2 / G) + gz) || 0; if (c >= 4) covered += l; }
  ok(covered / L > 0.8, `canal du Midi bordé d'arbres sur ${Math.round((100 * covered) / L)} % de ses ${(L / 1000).toFixed(1)} km`);
  info(`${po.pois.length} pois : ${Object.entries(kc).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ')}`);
  info(`${po.paths.length} chemins (${po.paths.filter((p) => p.riverbank).length} sur les berges, ${po.paths.filter((p) => p.kind === 'steps').length} escaliers), ${po.water.length} petits bassins, ${po.treeRows.length} alignements`);
} else info('pois.json absent');

console.log('Statistiques et tailles');
{ const kc = {}, km = {}; for (const r of d.roads) { const k = r.service ? 'service' : r.kind; kc[k] = (kc[k] || 0) + 1; km[k] = (km[k] || 0) + polylineLength(r.points) / 1000; }
  info(`${d.roads.length} routes, ${Object.values(km).reduce((a, b) => a + b, 0).toFixed(0)} km : ${Object.keys(kc).map((k) => `${k} ${kc[k]} (${km[k].toFixed(0)} km)`).join(', ')}`);
  info(`${d.roads.filter((r) => r.oneway).length} à sens unique, ${d.roads.filter((r) => r.roundabout).length} tronçons de giratoire, ${d.roads.filter((r) => r.bridge).length} ponts, ${d.roads.filter((r) => r.tunnel).length} tunnels, ${d.roads.filter((r) => r.uturn).length} demi-tours de bord`);
  const pc = (k) => Math.round((100 * d.roads.filter((r) => r[k] !== undefined && r[k] !== false).length) / d.roads.length) + ' %';
  info(`remplissage : ${['facadeWidth', 'sidewalk', 'median', 'surface', 'maxspeed', 'treeLined', 'busLane', 'cycleway', 'ref'].map((k) => k + ' ' + pc(k)).join(', ')}`);
  ok(size('roads.json') < 12e6, `roads.json : ${mo('roads.json')} (< 12 Mo)`);
  if (size('buildings.bin')) ok(size('buildings.bin') < 9e6, `buildings.bin : ${mo('buildings.bin')} (< 9 Mo), buildings-meta.bin : ${mo('buildings-meta.bin')}`);
  if (size('pois.json')) ok(size('pois.json') < 8e6, `pois.json : ${mo('pois.json')} (< 8 Mo)`);
  if (size('terrain.json')) ok(size('terrain.json') < 2e6, `terrain.json : ${mo('terrain.json')} (< 2 Mo)`); }
console.log(fails ? `\n${fails} vérification(s) en échec` : '\nToutes les vérifications passent');
process.exit(fails ? 1 : 0);

// Construit shared/world/<ville>/roads.json (contrat v5) : routes, graphe orienté, niveaux (ele), rails, eau,
// parcs et places, à partir du cache (.data/osm-<ville>/). Voir tools/osm/README.md.
// Usage : node tools/osm/build.mjs --city toulouse --only roads
import { join } from 'node:path';
import { BOUNDS, OUT, CITY_ID, loadLayer, num, writeAtomic, argFlag } from './common.mjs';
import { xz, CLIP, loadDem, loadIgnBuildings, ringsOf, polyIndex } from './shapes.mjs';
import { r1, polylineLength, simplify, clipPolyline, pointInPoly } from '../geom.mjs';
import { solveLevels } from './ele.mjs';
import { mergePieces } from './merge.mjs';
import { buildWater, buildGreen } from './water.mjs';
import { enrichRoads } from './enrich.mjs';

const t0 = Date.now();
const log = (...a) => console.log(...a);

// ───────────────────────────── 1. Tronçons OSM ─────────────────────────────
const DEF = { // [largeur double sens, largeur sens unique, voies double sens, voies sens unique, vitesse]
  motorway: [0, 0, 2, 2, 110], trunk: [0, 0, 2, 2, 90], link: [0, 0, 1, 1, 50],
  primary: [7, 6.4, 2, 2, 50], secondary: [7, 6.4, 2, 2, 50], tertiary: [6.4, 4, 2, 1, 50],
  residential: [5.5, 4, 2, 1, 30], unclassified: [5.5, 4, 2, 1, 50], living_street: [4.5, 3.5, 1, 1, 20],
  pedestrian: [5, 5, 0, 0, 0], service: [4.5, 3.5, 1, 1, 20], busway: [7, 3.5, 2, 1, 50],
};
function roadKind(name, hw, cls) {
  if (hw === 'motorway') return 'motorway';
  if (hw === 'trunk') return 'trunk';
  if (cls === 'link') return 'ramp';
  if (hw === 'pedestrian') return 'pedestrian';
  const n = (name || '').toLowerCase();
  if (/^(quai|port )/.test(n)) return 'quay';
  if (/^boulevard/.test(n)) return 'boulevard';
  if (/^(avenue|cours |allées )/.test(n) && !/^(residential|living_street|unclassified|service)$/.test(hw)) return 'avenue';
  if (/^route /.test(n) && /^(primary|secondary)$/.test(hw)) return 'avenue';
  return 'street';
}
function loadPieces() {
  const pieces = []; const st = { ways: 0, kept: 0 };
  const push = (e, isService) => {
    const t = e.tags || {}; st.ways++;
    if (t.area === 'yes' || !e.geometry || e.geometry.length < 2) return;
    if (t.access === 'private' || t.access === 'no') { if (!/^(motorway|trunk)/.test(t.highway)) return; }
    const hw = t.highway, cls = hw.endsWith('_link') ? 'link' : hw;
    const tunnel = t.tunnel === 'yes' || t.tunnel === 'true';
    const covered = !tunnel && (t.tunnel === 'building_passage' || t.covered === 'yes' || t.covered === 'arcade');
    const bridge = !!t.bridge && t.bridge !== 'no';
    let layer = num(t.layer); if (!Number.isFinite(layer)) layer = bridge ? 1 : tunnel ? -1 : 0;
    layer = Math.max(-3, Math.min(3, Math.round(layer)));
    if (!bridge && !tunnel && layer !== 0 && Math.abs(layer) > 2) layer = Math.sign(layer);
    const roundabout = t.junction === 'roundabout' || t.junction === 'circular';
    let oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.oneway === '-1' || roundabout || hw === 'motorway';
    if (t.oneway === 'no') oneway = false;
    let pedestrian = hw === 'pedestrian' || t.motor_vehicle === 'no' || t.vehicle === 'no';
    if (pedestrian && /^(motorway|trunk)/.test(hw)) pedestrian = false;
    if (pedestrian) oneway = false;
    let pts = e.geometry.map((g, i) => { const [x, z] = xz(g); return { x, z, id: e.nodes[i] }; });
    if (t.oneway === '-1') pts.reverse();
    const def = DEF[cls] || DEF.residential;
    const lanesTag = num(t.lanes);
    let lanes = lanesTag > 0 ? Math.min(10, Math.round(lanesTag)) : oneway ? def[3] : def[2];
    const cyc = (k) => (t[k] === 'lane' || t[k] === 'opposite_lane' ? 1 : 0), track = (k) => (t[k] === 'track' || t[k] === 'opposite_track' ? 1 : 0);
    const nCyc = Math.min(2, 2 * cyc('cycleway') + 2 * cyc('cycleway:both') + cyc('cycleway:left') + cyc('cycleway:right'));
    const hasTrack = track('cycleway') + track('cycleway:both') + track('cycleway:left') + track('cycleway:right') > 0;
    const park = (k) => (/^(lane|street_side|parallel|yes)$/.test(t[k] || '') ? 1 : 0);
    const nPark = Math.min(2, 2 * park('parking:both') + park('parking:left') + park('parking:right') + 2 * park('parking:lane:both') + park('parking:lane:left') + park('parking:lane:right'));
    const busLane = /lane/.test([t.busway, t['busway:left'], t['busway:right'], t['busway:both']].join(' ')) || num(t['lanes:bus']) > 0 || num(t['lanes:psv']) > 0 || num(t['lanes:bus:forward']) > 0 || num(t['lanes:bus:backward']) > 0 || num(t['lanes:psv:forward']) > 0 || num(t['lanes:psv:backward']) > 0 || /designated/.test((t['bus:lanes'] || '') + (t['bus:lanes:forward'] || '') + (t['bus:lanes:backward'] || '') + (t['psv:lanes'] || ''));
    // Largeur de chaussée : tag width, sinon selon le type (autoroute : voies de 3,5 m + accotements ; ville : voies
    // de 3,1 m + bandes cyclables 1,5 m + stationnement 2 m), sinon défaut par type.
    let width = num(t['width:carriageway']); if (!(width >= 2.5 && width <= 60)) width = num(t.width);
    let widthSrc = 'tag';
    if (!(width >= 2.5 && width <= 60)) {
      if (hw === 'motorway') { width = lanes * 3.5 + 3; widthSrc = 'lanes'; }
      else if (hw === 'trunk') { width = lanes * 3.5 + 2; widthSrc = 'lanes'; }
      else if (cls === 'link') { width = lanes * 3.5 + 1.5; widthSrc = 'lanes'; }
      else if (lanesTag > 0 && !pedestrian) { width = lanes * 3.1 + nCyc * 1.5 + nPark * 2; widthSrc = 'lanes'; }
      else { width = (oneway ? def[1] : def[0]) + nCyc * 1.5 + nPark * 2; widthSrc = 'default'; }
    }
    width = Math.max(3, Math.min(40, width));
    const sv = t.surface || '';
    const surface = /^(sett|cobblestone|unhewn_cobblestone)/.test(sv) ? 'sett' : /^paving_stones/.test(sv) ? 'paving_stones' : /^(asphalt|concrete|paved)/.test(sv) ? 'asphalt' : /^(gravel|fine_gravel|compacted|unpaved|ground|dirt|earth|grass)/.test(sv) ? 'unpaved' : '';
    const ms = num(t.maxspeed);
    const sw = [t.sidewalk, t['sidewalk:both'], t['sidewalk:left'], t['sidewalk:right']].filter(Boolean).join(' ');
    const name = t.name || '';
    const ref = (t.ref || '').split(';')[0].replace(/\s+/g, '');
    const kind = pedestrian ? 'pedestrian' : roadKind(name, hw, cls);
    const attrs = { bridgeName: t['bridge:name'] || '', surface, maxspeed: ms > 0 ? ms : 0, widthSrc, busLane: busLane ? 'y' : '', cycleway: nCyc ? 'lane' : hasTrack ? 'track' : '', sidewalkTag: /no|none/.test(sw) && !/yes|both|left|right|separate/.test(sw.replace(/sidewalk/g, '')) ? 'no' : sw ? 'yes' : '' };
    for (const run of clipPolyline(pts, CLIP)) {
      pieces.push({ name, kind, hw, cls, oneway, bridge, tunnel, covered, layer, roundabout, ref, service: !!isService, busway: hw === 'busway', lanes, width, pts: run, parts: [{ len: polylineLength(run.map((q) => [q.x, q.z])), lanes, width, ...attrs }] });
      st.kept++;
    }
  };
  for (const e of loadLayer('roads')) push(e, false);
  // voies de desserte : sans les rampes de parkings souterrains (tunnel, niveau négatif)
  for (const e of loadLayer('service')) { const t = e.tags || {}; if (t.tunnel || num(t.layer) < 0 || t.covered === 'yes') continue; push(e, true); }
  log(`routes : ${st.ways} ways OSM -> ${st.kept} tronçons dans l'emprise`);
  return pieces;
}

// ───────────────────────────── 2. Raccords au bord de l'emprise ─────────────────────────────
// Une chaussée à sens unique coupée par le bord (autoroute qui sort de la carte) est raccordée à la chaussée
// opposée la plus proche par une courte boucle de demi-tour : le graphe reste fortement connexe sans contresens.
function addBorderConnectors(pieces) {
  const isCut = (p) => typeof p.id === 'string';
  const exits = [], entries = [];
  for (const p of pieces) { if (!p.oneway || p.kind === 'pedestrian' || p.service) continue; if (isCut(p.pts[p.pts.length - 1])) exits.push(p); if (isCut(p.pts[0])) entries.push(p); }
  const cand = [];
  for (const a of exits) for (const b of entries) {
    if (a === b) continue;
    const pa = a.pts[a.pts.length - 1], pb = b.pts[0], d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
    if (d > 120 || d < 3) continue;
    const big = (k) => k === 'motorway' || k === 'trunk' || k === 'ramp';
    const same = (a.ref && a.ref === b.ref) || (a.name && a.name === b.name);
    if (!same && !(big(a.kind) && big(b.kind))) continue;
    cand.push({ a, b, d: d + (same ? 0 : 60) });
  }
  cand.sort((x, y) => x.d - y.d);
  const usedA = new Set(), usedB = new Set(); let n = 0;
  for (const { a, b } of cand) {
    if (usedA.has(a) || usedB.has(b)) continue; usedA.add(a); usedB.add(b);
    const pa = a.pts[a.pts.length - 1], pb = b.pts[0];
    pieces.push({ name: '', kind: 'ramp', hw: 'connector', cls: 'link', oneway: true, bridge: false, tunnel: false, covered: false, layer: 0, roundabout: false, ref: '', service: false, busway: false, uturn: true, lanes: 1, width: 5, pts: [pa, pb], parts: [{ len: Math.hypot(pa.x - pb.x, pa.z - pb.z), lanes: 1, width: 5, widthSrc: 'default', maxspeed: 30, surface: 'asphalt' }] });
    n++;
  }
  log(`bord de l'emprise : ${exits.length} sorties et ${entries.length} entrées à sens unique, ${n} demi-tours de raccord`);
  return n;
}

// ───────────────────────────── 3. Fusion des tronçons contigus ─────────────────────────────
function aggregate(r) { // attributs d'une route fusionnée : moyennes et majorités pondérées par la longueur
  let tot = 0, lw = 0, ww = 0; for (const p of r.parts) { tot += p.len; lw += p.lanes * p.len; ww += p.width * p.len; }
  if (tot > 0) { r.lanes = r.kind === 'pedestrian' ? 0 : Math.max(1, Math.round(lw / tot)); r.width = ww / tot; }
  const maj = (k, min = 0.4) => { const m = new Map(); for (const p of r.parts) if (p[k]) m.set(p[k], (m.get(p[k]) || 0) + p.len); const b = [...m.entries()].sort((x, y) => y[1] - x[1])[0]; return b && b[1] >= tot * min ? b[0] : null; };
  r.a = { bridgeName: maj('bridgeName'), surface: maj('surface'), maxspeed: maj('maxspeed'), widthSrc: maj('widthSrc', 0) || 'default', busLane: !!maj('busLane', 0.3), cycleway: maj('cycleway', 0.3), sidewalkTag: maj('sidewalkTag', 0.3) };
  delete r.parts;
}

// ───────────────────────────── 4. Sommets et simplification ─────────────────────────────
const V = { x: [], z: [] }; const vid = new Map();
const vOf = (p) => { let i = vid.get(p.id); if (i === undefined) { i = V.x.length; V.x.push(r1(p.x)); V.z.push(r1(p.z)); vid.set(p.id, i); } return i; };
function simplifyWays(list, use, tolOf) {
  for (const r of list) {
    const tol = tolOf(r), out = []; let seg = [r.pts[0]];
    const dp = (s) => simplify(s.map((p) => [p.x, p.z, p]), tol).map((q) => q[2]);
    const flush = () => {
      let s = dp(seg);
      if (s.length === 2 && s[0].id === s[1].id && seg.length > 2) { // boucle fermée : garder le point le plus éloigné
        let fi = 1, fd = 0; seg.forEach((p, i) => { const d = Math.hypot(p.x - seg[0].x, p.z - seg[0].z); if (d > fd) { fd = d; fi = i; } });
        s = dp(seg.slice(0, fi + 1)).concat(dp(seg.slice(fi)).slice(1));
      }
      out.push(...(out.length ? s.slice(1) : s));
    };
    for (let i = 1; i < r.pts.length; i++) { seg.push(r.pts[i]); if (use.get(r.pts[i].id) >= 2 || i === r.pts.length - 1) { flush(); seg = [r.pts[i]]; } }
    r.ids = out.map(vOf); r.pts = null;
  }
}
// sommets consécutifs confondus après arrondi : on les fusionne (alias global) pour éviter les arêtes de longueur nulle
function dedupeVertices(lists) {
  const alias = new Map(); const find = (i) => { while (alias.has(i)) i = alias.get(i); return i; };
  for (const list of lists) for (const r of list) for (let i = 1; i < r.ids.length; i++) { const a = find(r.ids[i - 1]), b = find(r.ids[i]); if (a !== b && V.x[a] === V.x[b] && V.z[a] === V.z[b]) alias.set(b, a); }
  for (const list of lists) for (const r of list) { const ids = r.ids.map(find); r.ids = ids.filter((n, i) => i === 0 || n !== ids[i - 1]); }
  return alias.size;
}

// ───────────────────────────── 5. Rails ─────────────────────────────
function loadRails() {
  const pieces = [], pylons = [];
  for (const e of loadLayer('rails')) {
    const t = e.tags || {};
    if (e.type === 'node') { if (t.aerialway === 'pylon') pylons.push(xz(e)); continue; }
    if (!e.geometry) continue;
    let kind = null;
    if (t.railway === 'tram') kind = 'tram'; else if (t.railway === 'rail') kind = 'train'; else if (t.railway === 'subway' || t.railway === 'light_rail') kind = 'metro';
    else if (t.aerialway === 'gondola' || t.aerialway === 'cable_car') kind = 'cable';
    if (!kind) continue;
    const tunnel = t.tunnel === 'yes' || t.tunnel === 'true' || t.covered === 'yes';
    if (kind === 'metro' && tunnel) continue; // le métro n'est gardé que là où il est à l'air libre
    const bridge = !!t.bridge && t.bridge !== 'no';
    let layer = num(t.layer); if (!Number.isFinite(layer)) layer = bridge ? 1 : tunnel ? -1 : 0; layer = Math.max(-3, Math.min(3, Math.round(layer)));
    const pts = e.geometry.map((g, i) => { const [x, z] = xz(g); return { x, z, id: e.nodes[i] }; });
    const yard = /^(yard|siding|spur|crossover)$/.test(t.service || '');
    for (const run of clipPolyline(pts, CLIP)) pieces.push({ kind, name: t.name || '', bridge, tunnel, layer, yard, oneway: false, pts: run, parts: [] });
  }
  const merged = mergePieces(pieces, (p) => [p.kind, p.name, p.bridge, p.tunnel, p.layer, p.yard].join('|'), () => true);
  log(`rails : ${pieces.length} tronçons -> ${merged.length} après fusion ; ${pylons.length} pylônes de téléphérique`);
  return merged;
}

// ───────────────────────────── Programme ─────────────────────────────
let pieces = loadPieces();
const nConnectors = addBorderConnectors(pieces);
const nPieces = pieces.length;
let roadsIn = mergePieces(pieces,
  (p) => [p.name, p.kind, p.hw === 'pedestrian', p.oneway, p.bridge, p.tunnel, p.covered, p.layer, p.roundabout, p.ref, p.service, p.busway, !!p.uturn].join('|'),
  (p) => !p.name && !p.ref && !p.roundabout);
roadsIn.forEach(aggregate);
log(`routes : ${nPieces} tronçons -> ${roadsIn.length} après fusion`);
const railsIn = loadRails();

// nœuds à conserver : extrémités, nœuds partagés entre routes, nœuds communs route/rail (passages à niveau)
const use = new Map();
for (const r of roadsIn) r.pts.forEach((p, i) => use.set(p.id, (use.get(p.id) || 0) + (i === 0 || i === r.pts.length - 1 ? 2 : 1)));
const railUse = new Map();
for (const r of railsIn) r.pts.forEach((p, i) => railUse.set(p.id, (railUse.get(p.id) || 0) + (i === 0 || i === r.pts.length - 1 ? 2 : 1)));
for (const [id, n] of railUse) if (use.has(id)) { use.set(id, use.get(id) + 1); railUse.set(id, n + 2); }
{ // un tunnel dont une extrémité ne touche aucune autre voie mène à un parking souterrain : il est traité comme
  // une desserte (il ne déplace jamais une voie publique), sans être retiré — les identifiants de routes restent stables
  let n = 0; for (const r of roadsIn) if (r.tunnel && (use.get(r.pts[0].id) <= 2 || use.get(r.pts[r.pts.length - 1].id) <= 2)) { r.parkingAccess = true; n++; }
  if (n) log(`tunnels en impasse (accès de parkings souterrains) traités comme des dessertes : ${n}`); }
simplifyWays(roadsIn, use, (r) => (r.roundabout ? 0.5 : r.kind === 'motorway' || r.kind === 'trunk' || r.kind === 'ramp' ? 1.0 : 1.5));
simplifyWays(railsIn, railUse, () => 1.0);
const aliased = dedupeVertices([roadsIn, railsIn]);
roadsIn = roadsIn.filter((r) => r.ids.length >= 2);
const rails = railsIn.filter((r) => r.ids.length >= 2);

{ // dessertes admises dans le graphe
  const aero = []; for (const e of loadLayer('landuse')) if ((e.tags || {}).aeroway === 'aerodrome') for (const o of ringsOf(e).outers) aero.push(o);
  let n = 0; for (const r of roadsIn) { if (!r.service) continue; const mid = r.ids[r.ids.length >> 1]; if (r.name || aero.some((p) => pointInPoly(V.x[mid], V.z[mid], p))) { r.graphService = true; n++; } }
  log(`dessertes admises dans le graphe (nommées ou dans l'emprise d'un aérodrome) : ${n}`); }

// Eau, parcs, places (indépendants du réseau)
const water = buildWater(log);
const { parks, plazas } = buildGreen(log);

// ───────────────────────────── 6. Niveaux superposés ─────────────────────────────
const dem = loadDem();
if (!dem) log('MNT absent : les dénivelés sont décidés par les seuls tags (le pont monte toujours)');
const SLOPE = { motorway: 0.03, trunk: 0.04, ramp: 0.06, pedestrian: 0.1, tram: 0.06, train: 0.03, metro: 0.05, cable: 1 };
const ways = [];
for (const r of roadsIn) ways.push({ ids: r.ids, minor: r.service || !!r.parkingAccess, slope: r.service ? 0.15 : SLOPE[r.kind] || 0.065, lvl: r.layer, bridge: r.bridge, tunnel: r.tunnel, cls: r.kind === 'pedestrian' ? 'foot' : 'road', viaduct: r.kind === 'motorway' || r.kind === 'trunk' || r.kind === 'ramp', width: r.width, label: r.name || r.ref || r.kind, road: r });
for (const r of rails) { if (r.kind === 'cable') continue; ways.push({ ids: r.ids, slope: SLOPE[r.kind], lvl: r.layer, bridge: r.bridge, tunnel: r.tunnel, cls: 'rail', width: 5, label: r.name || r.kind, rail: r }); }
for (const w of water.axesForLevels) { const ids = w.points.map(([x, z]) => { V.x.push(x); V.z.push(z); return V.x.length - 1; }); ways.push({ ids, fixed: true, aqueduct: w.aqueduct, lvl: 0, label: w.name, width: w.width }); }
const bigWater = polyIndex(water.bigInfo, 150);
{ // pont sur l'eau : pont (hors viaduc autoroutier) dont un point, tous les 10 m, tombe dans un plan d'eau d'au moins 1 ha
  let n = 0;
  for (const w of ways) { if (!w.bridge || w.tunnel || w.fixed || w.viaduct) continue; let hit = false;
    for (let i = 1; i < w.ids.length && !hit; i++) { const ax = V.x[w.ids[i - 1]], az = V.z[w.ids[i - 1]], bx = V.x[w.ids[i]], bz = V.z[w.ids[i]], m = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10)); for (let k = 0; k <= m && !hit; k++) { const p = bigWater.find(ax + ((bx - ax) * k) / m, az + ((bz - az) * k) / m); if (p && p.area >= 10000 && p.meanWidth >= 10) hit = true; } }
    if (hit) { w.waterBridge = true; n++; } }
  // les travées d'approche (tabliers ayant un sommet commun avec un pont sur l'eau) font partie du même ouvrage
  for (let changed = true; changed;) { changed = false; const on = new Set(); for (const w of ways) if (w.waterBridge) for (const v of w.ids) on.add(v);
    for (const w of ways) if (w.bridge && !w.waterBridge && !w.tunnel && !w.fixed && !w.viaduct && w.ids.some((v) => on.has(v))) { w.waterBridge = true; n++; changed = true; } }
  log(`ponts au-dessus d'un plan d'eau (travées d'approche comprises) : ${n}`); }
const lv = solveLevels(V, ways, dem && ((x, z) => (bigWater.find(x, z) ? NaN : dem.at(x, z))), log);
for (const w of ways) { if (w.road) w.road.ids = w.ids; if (w.rail) w.rail.ids = w.ids; }
const ele = lv.ele;
log('niveaux :', JSON.stringify(lv.stats));
const bad = lv.crossings.filter((c) => c.mode !== 'static' && c.delta < 5);
if (bad.length) log(`  ${bad.length} croisements à moins de 5 m d'écart :`, bad.slice(0, 12).map((c) => `${ways[c.wu].label} / ${ways[c.wl].label} (${c.delta.toFixed(1)} m @ ${c.px.toFixed(0)},${c.pz.toFixed(0)})`).join(' ; '));

// ───────────────────────────── 7. Graphe orienté ─────────────────────────────
// Hors graphe : rues piétonnes, sites propres bus, voies de desserte — sauf les dessertes nommées et celles de
// l'aérogare (emprise d'un aérodrome OSM), utiles au GPS et aux missions.
const inGraph = (r) => r.kind !== 'pedestrian' && !r.busway && (!r.service || r.graphService);
let drivable = roadsIn.filter(inGraph);
const others = roadsIn.filter((r) => !inGraph(r));
const N = V.x.length;
const makeEdges = () => { const edges = []; drivable.forEach((r, ri) => { for (let i = 1; i < r.ids.length; i++) { const a = r.ids[i - 1], b = r.ids[i]; edges.push(a, b, ri); if (!r.oneway) edges.push(b, a, ri); } }); return edges; };
const mainSccOf = (edges) => { // plus grande composante fortement connexe (Tarjan itératif)
  const head = new Int32Array(N).fill(-1), next = new Int32Array(edges.length / 3), to = new Int32Array(edges.length / 3);
  for (let e = 0; e < edges.length; e += 3) { const i = e / 3; to[i] = edges[e + 1]; next[i] = head[edges[e]]; head[edges[e]] = i; }
  const idx = new Int32Array(N).fill(-1), low = new Int32Array(N), onSt = new Uint8Array(N), comp = new Int32Array(N).fill(-1), cur = new Int32Array(N);
  let counter = 0, nComp = 0; const st = [], call = [];
  for (let s = 0; s < N; s++) {
    if (idx[s] !== -1 || head[s] === -1) continue;
    call.push(s); idx[s] = low[s] = counter++; st.push(s); onSt[s] = 1; cur[s] = head[s];
    while (call.length) {
      const v = call[call.length - 1];
      if (cur[v] !== -1) { const w = to[cur[v]]; cur[v] = next[cur[v]]; if (idx[w] === -1) { idx[w] = low[w] = counter++; st.push(w); onSt[w] = 1; cur[w] = head[w]; call.push(w); } else if (onSt[w]) low[v] = Math.min(low[v], idx[w]); }
      else { if (low[v] === idx[v]) { let w; do { w = st.pop(); onSt[w] = 0; comp[w] = nComp; } while (w !== v); nComp++; } call.pop(); if (call.length) { const u = call[call.length - 1]; low[u] = Math.min(low[u], low[v]); } }
    }
  }
  const size = new Int32Array(nComp); for (let i = 0; i < N; i++) if (comp[i] >= 0) size[comp[i]]++;
  let main = 0; for (let c = 1; c < nComp; c++) if (size[c] > size[main]) main = c;
  return (n) => comp[n] === main;
};
let edges = makeEdges(), inScc = mainSccOf(edges);
// Tronçons à sens unique hors composante (impasses créées par le bord, une voie privée, une rue piétonne) : détachés
// et passés à double sens — sauf autoroutes, voies rapides et bretelles, qui restent simplement hors graphe.
let reopened = 0;
for (const r of drivable.slice()) {
  if (!r.oneway || r.ids.length < 2 || r.kind === 'motorway' || r.kind === 'trunk' || r.kind === 'ramp' || r.roundabout) continue;
  const out = []; for (let i = 1; i < r.ids.length; i++) out.push(!(inScc(r.ids[i - 1]) && inScc(r.ids[i])));
  if (!out.includes(true)) continue;
  const ids = r.ids; let first = true;
  for (let i = 0; i < out.length;) {
    let j = i; while (j < out.length && out[j] === out[i]) j++;
    const target = first ? r : { ...r };
    target.ids = ids.slice(i, j + 1);
    if (out[i]) { target.oneway = false; target.lanes = Math.max(2, target.lanes); reopened++; }
    if (!first) drivable.push(target);
    first = false; i = j;
  }
}
edges = makeEdges(); inScc = mainSccOf(edges);
const edgesBefore = edges.length / 3;

// ───────────────────────────── 8. Sortie ─────────────────────────────
const all = drivable.concat(others);
const roads = [];
const roadIdOf = new Map();
for (const r of all) {
  if (r.ids.length < 2) continue;
  const points = r.ids.map((n) => [V.x[n], V.z[n]]);
  if (!inGraph(r) && polylineLength(points) < 12) continue;
  const o = { id: roads.length + 1, name: r.name, kind: r.kind, width: r1(r.width), lanes: r.lanes, oneway: r.oneway, bridge: r.bridge, points };
  const e = r.ids.map((n) => ele[n]);
  if (e.some((v) => v !== 0)) o.ele = e;
  if (r.tunnel) o.tunnel = true;
  if (r.bridge || r.tunnel || r.layer) o.layer = r.layer;
  if (r.roundabout) o.roundabout = true;
  if (r.ref) o.ref = r.ref;
  if (r.service) o.service = true;
  if (r.busway) o.busway = true;
  if (r.uturn) o.uturn = true;
  if (r.covered) o.covered = true;
  o._r = r; roadIdOf.set(r, o.id); roads.push(o);
}
const remap = new Int32Array(N).fill(-1), nodes = [], nodeEle = [];
const m = (i) => { if (remap[i] === -1) { remap[i] = nodes.length; nodes.push([V.x[i], V.z[i]]); nodeEle.push(ele[i]); } return remap[i]; };
const outEdges = [];
for (let e = 0; e < edges.length; e += 3) { if (!(inScc(edges[e]) && inScc(edges[e + 1]))) continue; const id = roadIdOf.get(drivable[edges[e + 2]]); if (id) outEdges.push([m(edges[e]), m(edges[e + 1]), id]); }

// Champs « fidélité » : façade à façade, trottoir, terre-plein, arbres, revêtement, vitesse…
const footprints = argFlag('no-facades') ? null : loadIgnBuildings();
const estats = enrichRoads(roads, footprints, water, log);
for (const o of roads) delete o._r;

const railsOut = [];
for (const r of rails) {
  const points = r.ids.map((n) => [V.x[n], V.z[n]]); if (polylineLength(points) < 3) continue;
  const o = { kind: r.kind, name: r.name, points };
  const e = r.ids.map((n) => ele[n] || 0); if (r.kind !== 'cable' && e.some((v) => v !== 0)) o.ele = e;
  if (r.bridge) o.bridge = true; if (r.tunnel) o.tunnel = true; if (r.yard) o.yard = true;
  railsOut.push(o);
}
const kinds = {}; let km = 0; const kmBy = {};
for (const r of roads) { kinds[r.kind] = (kinds[r.kind] || 0) + 1; const l = polylineLength(r.points) / 1000; km += l; kmBy[r.kind] = (kmBy[r.kind] || 0) + l; }
const withEle = roads.filter((r) => r.ele);
const stats = {
  roads: roads.length, byKind: kinds, km: Math.round(km), kmByKind: Object.fromEntries(Object.entries(kmBy).map(([k, v]) => [k, Math.round(v)])),
  graphRoads: drivable.length, serviceRoads: roads.filter((r) => r.service).length, serviceRoadsInGraph: drivable.filter((r) => r.service).length, graphNodes: nodes.length, graphEdges: outEdges.length, edgesOutsideMainSCC: edgesBefore - outEdges.length,
  borderUturns: nConnectors, onewayStubsReopenedTwoWay: reopened, aliasedVertices: aliased,
  roundabouts: roads.filter((r) => r.roundabout).length, bridges: roads.filter((r) => r.bridge).length, tunnels: roads.filter((r) => r.tunnel).length,
  roadsWithEle: withEle.length, raisedRoads: withEle.filter((r) => Math.max(...r.ele) > 0.5).length, loweredRoads: withEle.filter((r) => Math.min(...r.ele) < -0.5).length,
  levels: lv.stats, rails: railsOut.reduce((a, r) => ((a[r.kind] = (a[r.kind] || 0) + 1), a), {}), railsWithEle: railsOut.filter((r) => r.ele).length,
  waterPolygons: water.polygons.length, islands: water.islands.length, waterways: water.waterways.length, parks: parks.length, plazas: plazas.length, v5: estats,
};
const meta = {
  source: 'osm', city: CITY_ID,
  attribution: '© les contributeurs d’OpenStreetMap (ODbL) ; façades : IGN BD TOPO (Licence Ouverte 2.0) ; relief pour les niveaux : IGN RGE ALTI',
  generated: new Date().toISOString().slice(0, 10), generator: 'tools/osm/v5/roads.mjs',
  units: 'mètres, repère geoFor(ville) de shared/cities.js (+X est, +Z sud), arrondi 0,1 m ; tout est découpé à BOUNDS',
  roads: 'kind : motorway (autoroute, rocade), trunk (voie rapide), ramp (bretelle), avenue, boulevard, street, quay, pedestrian. Les chaussées séparées sont deux routes à sens unique. Champs optionnels : ref, maxspeed (km/h, tag OSM ou défaut du type), roundabout (sens unique, sens OSM = antihoraire), tunnel, layer (niveau OSM des ponts et tunnels), ele (voir levels), busLane, cycleway (lane|track), surface (asphalt|sett|paving_stones|unpaved), sidewalk, facadeWidth, median, treeLined, bridgeName, covered (passage sous immeuble), service:true (voie de desserte : parkings, zones d’activité, aéroport ; hors graphe sauf si elle est nommée ou dans l’emprise de l’aéroport), busway:true (site propre bus, hors graphe), uturn:true (courte boucle de demi-tour ajoutée là où une chaussée à sens unique est coupée par le bord de la carte).',
  graphDirected: true,
  graph: 'Mêmes conventions que Paris. Graphe ORIENTÉ : arête [a, b, roadId] parcourue de a vers b ; une voie à double sens fournit [a,b,id] et [b,a,id]. Les nœuds sont TOUS les sommets des polylignes des routes du graphe (carrefours, extrémités, points de forme, points de densification des rampes) : chaque arête est un segment droit entre deux points consécutifs de roads[roadId].points. graph.nodeEle[i] = élévation du nœud i (même valeur que ele dans les routes). Deux routes qui se croisent à des niveaux différents n’ont PAS de nœud commun. Hors graphe : rues piétonnes, voies de desserte (service), sites propres bus. Le graphe est limité à la plus grande composante fortement connexe ; les tronçons urbains à sens unique qui en sortiraient sont passés à double sens ; autoroutes, voies rapides et bretelles ne sont jamais inversées.',
  levels: 'ele[i] = élévation (m) du sommet i de points, relative au relief de base, au centimètre ; absent = 0 partout. Gabarits : pont routier au-dessus d’une route +6,5 m ; au-dessus d’une voie ferrée +7,5 m ; au-dessus d’une rue piétonne +5,5 m ; trémie −6 m ; passage sous un pont-canal −8,5 m. Hiérarchie : une voie publique n’est jamais déplacée par une desserte, une rue piétonne ou un rail (ce sont eux qui montent ou descendent, sans propager leur rampe aux voies publiques). Entre deux voies publiques le pont monte, sauf déblai confirmé par le MNT (≥ 2,5 m), vraie trémie (tunnel de niveau négatif ≥ 25 m) ou voie sur berge réellement en contrebas d’un pont sur l’eau : alors la voie du dessous descend (ele négatif ; sans tunnel:true = tranchée ouverte). Tabliers et tubes plats ; rampes le long des voies raccordées, pente maximale 3 % (autoroute), 4 % (voie rapide), 6 % (bretelle), 6,5 % (autres routes), 10 % (rues piétonnes), 15 % (dessertes) ; un sommet tous les 12 m au plus là où ele ≠ 0. Un pont qui ne franchit que de l’eau reste à 0. Les rails portent aussi ele.',
  rails: 'rails = [{ kind: tram|train|metro|cable, name, points, ele?, bridge?, tunnel?, yard? }]. metro : seulement les tronçons à l’air libre (viaducs, tranchées ouvertes). cable : téléphérique (pylônes dans pois.json). yard = voie de service (faisceau, garage).',
  river: 'river.polygons = plans d’eau larges (fleuve et ses bras, lacs, bassins ≥ 400 m²), anneaux extérieurs, îles NON retirées. river.islands = [{name, polygon}] à dessiner par-dessus. waterways = [{ name, kind: canal|river|stream, width, points }] : cours d’eau étroits décrits par leur axe (canaux, rivières, ruisseaux à l’air libre), absents de river.polygons.',
  polygons: 'Polygones simples, non fermés, sens horaire vu de dessus (aire signée positive dans le plan x,z).',
  stats,
};
const file = join(OUT, 'roads.json');
const size = writeAtomic(file, { meta, roads, graph: { nodes, edges: outEdges, nodeEle }, river: { polygons: water.polygons, islands: water.islands }, waterways: water.waterways, rails: railsOut, parks, plazas });
log('stats :', JSON.stringify(stats));
log(`roads.json : ${(size / 1e6).toFixed(2)} Mo, fait en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

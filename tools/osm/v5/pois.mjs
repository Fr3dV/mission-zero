// Construit shared/world/<ville>/pois.json (contrats v3 + v5) : arbres, points d'intérêt, chemins, bassins,
// occupation du sol (forêts, cultures, zones d'activité, parkings, terrains de sport, aéroport…).
// À lancer après roads.mjs (lit roads.json pour l'eau, les parcs et les grands axes).
// Usage : node tools/osm/build.mjs --city toulouse --only pois
import { join } from 'node:path';
import { OUT, CITY_ID, loadLayer, readJSON, writeAtomic, num, inBounds } from './common.mjs';
import { xz, CLIP, ringsOf, cleanPoly, loadTrees, polyIndex, perimeter } from './shapes.mjs';
import { r1, polyArea, centroid, pointInPoly, polylineLength, simplify, distPointSeg, clipPolyline } from '../geom.mjs';
import { buildWater } from './water.mjs';

const t0 = Date.now(), log = (...a) => console.log(...a);
const world = readJSON(join(OUT, 'roads.json'));
const pointGrid = (G) => { const m = new Map(); const key = (x, z) => Math.floor(x / G) * 100003 + Math.floor(z / G); return { add(x, z, v) { const k = key(x, z); let c = m.get(k); if (!c) m.set(k, (c = [])); c.push([x, z, v]); }, near(x, z, r) { const out = []; for (let gx = Math.floor((x - r) / G); gx <= Math.floor((x + r) / G); gx++) for (let gz = Math.floor((z - r) / G); gz <= Math.floor((z + r) / G); gz++) for (const p of m.get(gx * 100003 + gz) || []) if (Math.hypot(p[0] - x, p[1] - z) <= r) out.push(p); return out; } }; };

// ───────────── Arbres ─────────────
const T = loadTrees();
const genusCount = {}; for (const t of T.list) if (t[2]) genusCount[t[2]] = (genusCount[t[2]] || 0) + 1;
const genera = [''].concat(Object.entries(genusCount).sort((a, b) => b[1] - a[1]).slice(0, 15).map((e) => e[0]));
const trees = [], treeGenus = [];
// ordre spatial (dalles de 500 m) : chargement par tuile et meilleure compression
T.list.sort((a, b) => Math.floor(a[1] / 500) - Math.floor(b[1] / 500) || Math.floor(a[0] / 500) - Math.floor(b[0] / 500));
for (const [x, z, g] of T.list) { trees.push(x, z); treeGenus.push(Math.max(0, genera.indexOf(g))); }
const treeRows = [];
for (const e of loadLayer('treerows')) { if (!e.geometry) continue; for (const run of clipPolyline(e.geometry.map((g) => { const [x, z] = xz(g); return { x, z }; }), CLIP)) { const pts = simplify(run.map((p) => [p.x, p.z]), 1).map(([x, z]) => [r1(x), r1(z)]); if (pts.length >= 2 && polylineLength(pts) >= 10) treeRows.push({ points: pts }); } }
// Platanes du canal du Midi : s'ils manquent dans les sources (moins de 4 arbres pour 100 m de berge), on ajoute
// un alignement de chaque côté, à 4 m du bord de l'eau, marqué synthetic:true.
{ const tg = pointGrid(40); for (let i = 0; i < trees.length; i += 2) tg.add(trees[i], trees[i + 1], 1);
  let added = 0, km = 0;
  for (const w of world.waterways || []) {
    if (w.kind !== 'canal' || !/midi|brienne|lat[ée]ral/i.test(w.name)) continue;
    for (const side of [-1, 1]) {
      let run = [];
      const flush = () => { if (run.length >= 2 && polylineLength(run) >= 60) { treeRows.push({ points: simplify(run, 0.8).map(([x, z]) => [r1(x), r1(z)]), synthetic: true, genus: 'Platanus' }); added++; km += polylineLength(run) / 1000; } run = []; };
      for (let k = 1; k < w.points.length; k++) {
        const [ax, az] = w.points[k - 1], [bx, bz] = w.points[k], L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
        const nx = (-(bz - az) / L) * side, nz = ((bx - ax) / L) * side, off = w.width / 2 + 4;
        // densité d'arbres réels dans une bande de 14 m au-delà du bord
        let n = 0; const steps = Math.max(1, Math.round(L / 20));
        for (let s = 0; s <= steps; s++) { const px = ax + ((bx - ax) * s) / steps + nx * (off + 3), pz = az + ((bz - az) * s) / steps + nz * (off + 3); n += tg.near(px, pz, 11).length; }
        if (n / Math.max(1, L / 100) < 4 && inBounds(ax + nx * off, az + nz * off) && inBounds(bx + nx * off, bz + nz * off)) { if (!run.length) run.push([ax + nx * off, az + nz * off]); run.push([bx + nx * off, bz + nz * off]); } else flush();
      }
      flush();
    }
  }
  log(`arbres : ${trees.length / 2} (${JSON.stringify(T.sources)}), ${treeRows.length} alignements dont ${added} synthétiques le long des canaux (${km.toFixed(1)} km)`); }

// ───────────── Points d'intérêt ─────────────
const axisGrid = pointGrid(50);
for (const r of world.roads) { if (!(r.kind === 'avenue' || r.kind === 'boulevard' || r.kind === 'quay' || r.kind === 'pedestrian' || r.width >= 10) || r.service) continue; for (let i = 1; i < r.points.length; i++) { const [ax, az] = r.points[i - 1], [bx, bz] = r.points[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10)); for (let k = 0; k <= n; k++) axisGrid.add(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, 1); } }
const onAxis = (x, z) => axisGrid.near(x, z, 25).length > 0;
const rawPois = loadLayer('pois');
const subway = rawPois.filter((e) => e.type === 'node' && e.tags?.railway === 'station' && (e.tags.station === 'subway' || e.tags.subway === 'yes') && e.tags.name).map((e) => ({ name: e.tags.name, p: xz(e) }));
const nearestSubway = (x, z, max) => { let best = null, bd = max; for (const s of subway) { const d = Math.hypot(s.p[0] - x, s.p[1] - z); if (d < bd) { bd = d; best = s; } } return best; };
const WORSHIP = /^(christian|jewish|muslim|buddhist|hindu)$/;
const cand = [];
for (const e of rawPois) {
  const t = e.tags || {}, g = e.type === 'node' ? e : e.center; if (!g) continue;
  const [x, z] = xz(g); if (!inBounds(x, z, -0.2)) continue;
  if (t.disused === 'yes' || t.abandoned === 'yes' || t['disused:amenity'] || t['disused:shop']) continue;
  if (num(t.level) < 0 && t.railway !== 'subway_entrance' && t.railway !== 'station') continue;
  let kind = null, name = t.name || '', prio = 0;
  if (t.railway === 'subway_entrance') { kind = 'metro'; const s = nearestSubway(x, z, 350); if (s) name = s.name; prio = 2; }
  else if (t.railway === 'station' || t.railway === 'halt' || t.public_transport === 'station') { if (t.station === 'subway' || t.subway === 'yes') { kind = 'metro'; prio = 1; } else if (t.railway === 'station' || t.railway === 'halt') { if (t.station === 'funicular' || t.aerialway) continue; kind = 'station'; } else continue; }
  else if (t.railway === 'tram_stop') kind = 'tram';
  else if (t.amenity === 'drinking_water' || t.amenity === 'fountain') { if (t.amenity === 'fountain') kind = 'fountain'; else continue; }
  else if (t.amenity === 'cafe' || t.amenity === 'bar' || t.amenity === 'pub') kind = 'cafe';
  else if (t.amenity === 'restaurant' || t.amenity === 'fast_food') kind = 'restaurant';
  else if (t.amenity === 'pharmacy') kind = 'pharmacy';
  else if (t.amenity === 'theatre' || t.amenity === 'cinema') kind = 'theatre';
  else if (t.amenity === 'place_of_worship') { if (t.religion && !WORSHIP.test(t.religion)) continue; kind = 'church'; }
  else if (t.amenity === 'school' || t.amenity === 'university' || t.amenity === 'college') kind = 'school';
  else if (t.amenity === 'bicycle_rental') kind = 'velib';
  else if (t.amenity === 'marketplace') kind = 'market';
  else if (t.amenity === 'fuel') kind = 'fuel';
  else if (t.amenity === 'hospital') kind = 'hospital';
  else if (t.amenity === 'townhall') kind = 'townhall';
  else if (t.shop === 'bakery') kind = 'bakery';
  else if (t.shop === 'kiosk' || (t.shop === 'newsagent' && e.type === 'node')) kind = 'kiosk';
  else if (t.shop === 'supermarket' || t.shop === 'mall' || t.shop === 'department_store') kind = 'supermarket';
  else if (t.waterway === 'lock_gate' || t.lock === 'yes') { kind = 'lock'; name = name || t['lock_name'] || t['lock:name'] || ''; }
  else if (t.man_made === 'water_tower') kind = 'water_tower';
  else if (t.historic === 'memorial' || t.historic === 'monument' || t.tourism === 'artwork') {
    const type = t.memorial || t.artwork_type || '';
    if (/plaque|stolperstein|mural|graffiti|painting|street_art|mosaic|tag|relief|ghost_bike|bench|tree/.test(type)) continue;
    if (t.historic === 'memorial' && !/statue|bust|sculpture|obelisk|stele|war_memorial|column|stone|cross/.test(type) && !name) continue;
    if (t.tourism === 'artwork' && !/statue|sculpture|bust|installation|fountain|architecture/.test(type)) continue;
    kind = 'statue'; prio = t.historic === 'monument' || /statue|war_memorial|column|obelisk/.test(type) ? 2 : 1;
  }
  else if (t.tourism === 'museum') kind = 'museum';
  else if (t.tourism === 'hotel') { const stars = num(t.stars), rooms = num(t.rooms); if (!(stars >= 3 || rooms >= 60)) continue; kind = 'hotel'; prio = (stars || 0) + (rooms >= 150 ? 1 : 0); }
  else if (t.highway === 'bus_stop') kind = 'busstop';
  if (!kind) continue;
  if (kind === 'cafe' || kind === 'restaurant') prio = (t.outdoor_seating && t.outdoor_seating !== 'no' ? 2 : 0) + (onAxis(x, z) ? 1 : 0) + (name ? 0.1 : 0);
  cand.push({ kind, name, x: r1(x), z: r1(z), prio });
}
for (const e of loadLayer('rails')) { // téléphérique : pylônes et gares
  if (e.type !== 'node') continue; const t = e.tags || {}; const [x, z] = xz(e); if (!inBounds(x, z, -0.2)) continue;
  if (t.aerialway === 'pylon') cand.push({ kind: 'pylon', name: t.ref ? 'Pylône ' + t.ref : '', x: r1(x), z: r1(z), prio: 0, h: num(t.height) || 0 });
  else if (t.aerialway === 'station') cand.push({ kind: 'cable_station', name: t.name || '', x: r1(x), z: r1(z), prio: 0 });
}
for (const e of loadLayer('water')) { // ponts-canaux
  const t = e.tags || {}; if (e.type !== 'way' || t.waterway !== 'canal' || !t.bridge || t.bridge === 'no' || !e.geometry) continue;
  const [x, z] = xz(e.geometry[e.geometry.length >> 1]); if (inBounds(x, z, -0.2)) cand.push({ kind: 'aqueduct', name: t.name || t['bridge:name'] || 'Pont-canal', x: r1(x), z: r1(z), prio: 0 });
}
{ // nom des écluses : polygone d'écluse (water=lock) ou tronçon de canal nommé le plus proche
  const named = []; for (const e of loadLayer('water')) { const t = e.tags || {}; if (!t.name || !/cluse/i.test(t.name) || !e.geometry) continue; const g = e.geometry.filter(Boolean); named.push([xz(g[g.length >> 1]), t.name]); }
  for (const c of cand) if (c.kind === 'lock' && !/cluse/i.test(c.name)) { let bd = 150; for (const [p, n] of named) { const dd = Math.hypot(p[0] - c.x, p[1] - c.z); if (dd < bd) { bd = dd; c.name = n; } } if (!/cluse/i.test(c.name)) c.name = c.name ? 'Écluse (' + c.name + ')' : 'Écluse'; } }
const CAPS = { cafe: 1500, restaurant: 2000, statue: 600, hotel: 300, busstop: 4500, school: 700, fountain: 400 };
const SEP = { metro: 1, tram: 45, busstop: 8, lock: 25, station: 80, cable_station: 60 }; // distance minimale entre deux points de même nature
const pois = [], pstats = {};
{ const byKind = new Map(); for (const c of cand) { if (!byKind.has(c.kind)) byKind.set(c.kind, []); byKind.get(c.kind).push(c); }
  // une station de métro sans bouche cartographiée est représentée par son nœud de station
  const entrances = pointGrid(200); for (const c of byKind.get('metro') || []) if (c.prio === 2) entrances.add(c.x, c.z, 1);
  if (byKind.has('metro')) byKind.set('metro', byKind.get('metro').filter((c) => c.prio === 2 || !entrances.near(c.x, c.z, 180).length));
  for (const [kind, list] of byKind) {
    list.sort((a, b) => b.prio - a.prio);
    const grid = pointGrid(60); let n = 0;
    for (const c of list) {
      if (CAPS[kind] && n >= CAPS[kind]) break;
      if ((kind === 'cafe' || kind === 'restaurant') && c.prio < 1) break;
      if (grid.near(c.x, c.z, SEP[kind] || 3).length) continue;
      grid.add(c.x, c.z, 1); n++;
      const o = { kind, name: c.name, x: c.x, z: c.z }; if (c.h) o.h = c.h; pois.push(o);
    }
    pstats[kind] = n;
  } }
log('pois :', JSON.stringify(pstats));

// ───────────── Chemins : parcs, berges, halage, escaliers, sentiers forestiers ─────────────
const water = buildWater(() => {});
const greenPolys = [];
for (const e of loadLayer('green')) { const t = e.tags || {}; if (!/^(park|garden|nature_reserve)$/.test(t.leisure || '') || t.access === 'private' || t.access === 'no') continue; for (const o of ringsOf(e).outers) if (Math.abs(polyArea(o)) >= 800) greenPolys.push({ polygon: o }); }
const forestPolys = [];
for (const e of loadLayer('landuse')) { const t = e.tags || {}; if (t.landuse === 'forest' || t.natural === 'wood') for (const o of ringsOf(e).outers) if (Math.abs(polyArea(o)) >= 5000) forestPolys.push({ polygon: o }); }
const greenIdx = polyIndex(greenPolys, 120), forestIdx = polyIndex(forestPolys, 200), bigWaterIdx = polyIndex(water.bigInfo, 150);
const bankGrid = pointGrid(60); // points des berges : contour des grands plans d'eau et axes des canaux / rivières
for (const b of water.bigInfo) { if (b.area < 20000) continue; const p = b.polygon; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[i][0], q[1] - p[i][1]) / 15)); for (let k = 0; k < n; k++) bankGrid.add(p[i][0] + ((q[0] - p[i][0]) * k) / n, p[i][1] + ((q[1] - p[i][1]) * k) / n, 28); } }
for (const w of water.waterways) { if (w.kind === 'stream') continue; for (let i = 1; i < w.points.length; i++) { const p = w.points[i - 1], q = w.points[i], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 15)); for (let k = 0; k < n; k++) bankGrid.add(p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n, w.width / 2 + 14); } }
const nearBank = (x, z) => bankGrid.near(x, z, 45).some((p) => Math.hypot(p[0] - x, p[1] - z) <= p[2]);
const paths = [], pathStats = { footway: 0, steps: 0, park: 0, riverbank: 0, forest: 0 };
for (const e of loadLayer('paths')) {
  const t = e.tags || {};
  if (!e.geometry || t.access === 'private' || t.access === 'no' || t.covered === 'yes' || t.location === 'underground' || num(t.level) < 0 || num(t.layer) < 0 || t.area === 'yes') continue;
  const isSteps = t.highway === 'steps';
  for (const run of clipPolyline(e.geometry.map((g) => { const [x, z] = xz(g); return { x, z }; }), CLIP)) {
    let pts = run.map((p) => [p.x, p.z]); const len = polylineLength(pts), mid = pts[pts.length >> 1], a = pts[0];
    let why = null;
    if (isSteps) { if (len >= 6) why = 'steps'; }
    else if (len >= 25 && t.bridge !== 'yes' && nearBank(mid[0], mid[1]) && nearBank(a[0], a[1])) why = 'riverbank';
    else if (t.highway === 'track' || t.highway === 'cycleway') { if (len >= 60 && (greenIdx.find(mid[0], mid[1]) || forestIdx.find(mid[0], mid[1]))) why = greenIdx.find(mid[0], mid[1]) ? 'park' : 'forest'; }
    else if (len >= 12 && (greenIdx.find(mid[0], mid[1]) || greenIdx.find(a[0], a[1]))) why = 'park';
    else if (len >= 60 && forestIdx.find(mid[0], mid[1])) why = 'forest';
    if (!why) continue;
    pts = simplify(pts, 1).map(([x, z]) => [r1(x), r1(z)]);
    let width = num(t.width); if (!(width >= 0.8 && width <= 30)) width = isSteps ? 3 : why === 'riverbank' ? 3.5 : why === 'forest' ? 2 : t.highway === 'cycleway' ? 3 : 2.5;
    const o = { kind: isSteps ? 'steps' : 'footway', points: pts, width: r1(width) };
    if (t.name) o.name = t.name; if (isSteps && num(t.step_count) > 0) o.steps = Math.round(num(t.step_count)); if (why === 'riverbank') o.riverbank = true; if (t.bridge === 'yes') o.bridge = true;
    paths.push(o); pathStats[o.kind]++; if (why !== 'steps') pathStats[why]++;
  }
}
log('chemins :', JSON.stringify(pathStats));

// ───────────── Petits bassins et fontaines ─────────────
const waterOut = water.smallWater.slice();
for (const e of loadLayer('fountains')) { const t = e.tags || {}; for (const o of ringsOf(e).outers) { const c = centroid(o); if (!inBounds(c[0], c[1])) continue; const p = cleanPoly(o, 0.4); if (p && polyArea(p) >= 8 && !waterOut.some((w) => pointInPoly(c[0], c[1], w.polygon)) && !bigWaterIdx.find(c[0], c[1])) waterOut.push({ name: t.name || '', polygon: p }); } }

// ───────────── Occupation du sol ─────────────
const RULES = [ // [kind, test(tags), aire minimale, tolérance de simplification, plafond]
  ['runway', (t) => t.aeroway === 'runway' && t.area === 'yes', 500, 1.5, 50], ['taxiway', (t) => t.aeroway === 'taxiway' && t.area === 'yes', 300, 1.5, 400], ['apron', (t) => t.aeroway === 'apron', 500, 1.5, 300],
  ['parking', (t) => t.amenity === 'parking' && !/underground|multi-storey|multi_storey|rooftop/.test(t.parking || '') && t.access !== 'private', 300, 0.8, 6000],
  ['pitch', (t) => t.leisure === 'pitch' || t.leisure === 'track', 250, 0.5, 3000],
  ['cemetery', (t) => t.landuse === 'cemetery' || t.amenity === 'grave_yard', 800, 1.5, 200],
  ['forest', (t) => t.landuse === 'forest' || t.natural === 'wood', 1500, 2.5, 2500], ['scrub', (t) => t.natural === 'scrub' || t.natural === 'heath', 3000, 2.5, 800],
  ['farmland', (t) => /^(farmland|meadow|orchard|vineyard|allotments|plant_nursery)$/.test(t.landuse || '') || t.natural === 'grassland', 4000, 3, 2500],
  ['grass', (t) => /^(grass|village_green|recreation_ground)$/.test(t.landuse || '') || t.leisure === 'golf_course', 600, 1.5, 2500],
  ['industrial', (t) => t.landuse === 'industrial' || t.landuse === 'quarry', 2000, 2.5, 1500], ['commercial', (t) => t.landuse === 'commercial' || t.landuse === 'retail', 1500, 2.5, 1500],
  ['railway', (t) => t.landuse === 'railway', 1500, 2.5, 300], ['construction', (t) => t.landuse === 'construction' || t.landuse === 'brownfield' || t.landuse === 'greenfield', 1500, 2.5, 400],
  ['residential', (t) => t.landuse === 'residential', 4000, 3, 3000],
];
const tmp = [];
for (const e of loadLayer('landuse')) {
  const t = e.tags || {}; if (num(t.layer) < 0 || t.location === 'underground') continue;
  const rule = RULES.find((r) => r[1](t)); if (!rule) continue;
  for (const o of ringsOf(e).outers) { const p = cleanPoly(o, rule[3]); if (!p) continue; const area = polyArea(p); if (area < rule[2]) continue; const a = { kind: rule[0] === 'scrub' ? 'forest' : rule[0], name: t.name || '', polygon: p, _a: area, _k: rule[0] }; if (rule[0] === 'scrub') a.scrub = true; if (rule[0] === 'pitch' && t.sport) a.sport = t.sport.split(';')[0]; if (rule[0] === 'commercial' && t.landuse === 'retail') a.retail = true; tmp.push(a); }
}
// pistes et voies de circulation de l'aéroport : décrites par leur axe dans OSM, converties en polygones
const buffer = (pts, w) => { const L = [], R = []; for (let i = 0; i < pts.length; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / d, nz = (b[0] - a[0]) / d; L.push([pts[i][0] + (nx * w) / 2, pts[i][1] + (nz * w) / 2]); R.push([pts[i][0] - (nx * w) / 2, pts[i][1] - (nz * w) / 2]); } return L.concat(R.reverse()); };
for (const e of loadLayer('landuse')) {
  const t = e.tags || {}; if (e.type !== 'way' || !e.geometry || t.area === 'yes' || !/^(runway|taxiway)$/.test(t.aeroway || '')) continue;
  const g = e.geometry.map(xz); if (Math.hypot(g[0][0] - g[g.length - 1][0], g[0][1] - g[g.length - 1][1]) < 0.01) continue;
  let w = num(t.width); if (!(w >= 5 && w <= 100)) w = t.aeroway === 'runway' ? 45 : 23;
  const pts = simplify(g, 0.5); if (polylineLength(pts) < 30) continue;
  const p = cleanPoly(buffer(pts, w), 0.5); if (!p) continue;
  tmp.push({ kind: t.aeroway, name: t.name || (t.ref ? 'Piste ' + t.ref : ''), polygon: p, _a: polyArea(p), _k: t.aeroway });
}
// zones piétonnes (comme à Paris)
for (const e of loadLayer('green')) {
  const t = e.tags || {};
  if (t.highway !== 'pedestrian' || t.leisure || t.access === 'private' || t.access === 'no' || t.tunnel || t.indoor === 'yes' || t.covered === 'yes' || num(t.layer) < 0 || num(t.level) < 0) continue;
  const s = t.surface || '', kind = /sett|cobble/.test(s) ? 'cobble' : /gravel|compacted|ground|dirt|sand|pebble|unpaved|earth/.test(s) ? 'gravel' : 'pedestrian';
  for (const o of ringsOf(e).outers) { const p = cleanPoly(o, 0.8); if (p && polyArea(p) >= 200) tmp.push({ kind, name: t.name || '', polygon: p, _a: polyArea(p), _k: kind }); }
}
tmp.sort((a, b) => b._a - a._a);
const areas = [], astats = {}, cap = Object.fromEntries(RULES.map((r) => [r[0], r[4]]));
for (const a of tmp) { const n = astats[a._k] || 0; if (cap[a._k] && n >= cap[a._k]) continue; astats[a._k] = n + 1; delete a._a; delete a._k; areas.push(a); }
log('surfaces :', JSON.stringify(astats));

const meta = {
  source: 'osm + open data', city: CITY_ID,
  attribution: '© les contributeurs d’OpenStreetMap (ODbL) ; arbres : Toulouse Métropole — « Arbres urbains » (Licence Ouverte 2.0)',
  generated: new Date().toISOString().slice(0, 10), generator: 'tools/osm/v5/pois.mjs',
  units: 'mètres, repère geoFor(ville), arrondi 0,1 m ; tout est dans BOUNDS',
  trees: 'tableau plat [x, z, …], un arbre réel par couple, trié par dalles de 500 m. treeGenus[i] = index dans treeGenera du genre de l’arbre i (0 = inconnu ; Platanus = platane…). treeRows : alignements OSM (natural=tree_row) ; ceux marqués synthetic:true longent les canaux là où les sources ne recensent pas les platanes (un arbre tous les 8 m environ à planter côté rendu).',
  pois: 'kind ∈ metro (bouche de métro, name = station ; ou la station elle-même si aucune bouche n’est cartographiée), tram (arrêt de tramway), station (gare), cable_station et pylon (téléphérique Téléo ; h = hauteur si connue), busstop, velib (station VélôToulouse), cafe (cafés, bars), restaurant, bakery, pharmacy, fountain, statue, church, school, theatre (théâtres, cinémas), museum, hotel (3★ et plus), kiosk, market (halles et marchés), supermarket, fuel (station-service), hospital, townhall, water_tower, lock (écluse / porte d’écluse), aqueduct (pont-canal). cafe/restaurant : seulement ceux avec terrasse déclarée ou situés sur un grand axe ou une rue piétonne, plafonnés.',
  paths: 'kind footway|steps ; allées des parcs, berges de Garonne et chemins de halage des canaux (riverbank:true), sentiers des bois, escaliers. Champs optionnels : name, steps, riverbank, bridge (passerelle).',
  water: 'petits bassins, mares et fontaines (les plans d’eau de 400 m² et plus sont dans roads.json → river.polygons)',
  areas: 'kind ∈ residential, commercial (retail:true pour une zone commerciale), industrial, railway, construction, farmland, forest (scrub:true pour une friche arbustive), grass, cemetery, parking, pitch (sport = football, tennis…), runway, taxiway, apron, pedestrian, cobble, gravel. Triées par aire décroissante : dessiner dans l’ordre (les grandes d’abord), parking / pitch / runway par-dessus. Les trous des multipolygones sont ignorés.',
  polygons: 'polygones simples, non fermés, sens horaire vu de dessus (aire signée positive en x,z)',
  stats: { trees: trees.length / 2, treeSources: T.sources, treeRows: treeRows.length, pois: pstats, paths: pathStats, water: waterOut.length, areas: astats },
};
const size = writeAtomic(join(OUT, 'pois.json'), { meta, trees, treeGenera: genera, treeGenus, treeRows, pois, paths, water: waterOut, areas });
log(`pois.json : ${(size / 1e6).toFixed(2)} Mo, fait en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

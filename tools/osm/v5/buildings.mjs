// Construit shared/world/<ville>/buildings.bin (+ buildings-meta.bin / .json) à partir des emprises de la BD TOPO
// de l'IGN (cache .data/osm-<ville>/ign_bat_*.json) et de shared/world/<ville>/roads.json (dégagement des chaussées).
// À lancer après roads.mjs. Voir tools/osm/README.md pour les règles de classement.
// Usage : node tools/osm/build.mjs --city toulouse --only buildings
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, OUT, BOUNDS, CITY_ID, loadLayer, readJSON, writeAtomic, num } from './common.mjs';
import { loadIgnBuildings, ringsOf, polyIndex, xz, bboxOf } from './shapes.mjs';
import { r1, polyArea, centroid, pointInPoly, dedupeRing, clipHalfPlane, minAreaRect } from '../geom.mjs';

const t0 = Date.now(), log = (...a) => console.log(...a);
export const KINDS = ['house', 'toulousaine', 'apartment', 'tower', 'slab', 'commercial', 'retail', 'industrial', 'office', 'school', 'hospital', 'church', 'civic', 'sport', 'station', 'parking', 'greenhouse', 'annex', 'hangar_aero'];
export const WALLS = ['render', 'brick', 'concrete', 'stone', 'metal', 'glass', 'wood'];
export const ROOFS = ['tile', 'flat', 'slate', 'metal', 'glass'];
const K = Object.fromEntries(KINDS.map((k, i) => [k, i])), Wm = Object.fromEntries(WALLS.map((k, i) => [k, i])), Rm = Object.fromEntries(ROOFS.map((k, i) => [k, i]));

const roadsFile = join(OUT, 'roads.json');
const world = readJSON(roadsFile);
// la liste des monuments évolue : on la relit à chaque construction
const { LANDMARKS } = await import(pathToFileURL(join(ROOT, 'shared', 'cities', CITY_ID, 'landmarks.js')).href + '?t=' + Date.now());
const B = loadIgnBuildings();
if (!B) { console.error('Pas d’emprises IGN en cache : lancer fetch.mjs --only ign-buildings'); process.exit(1); }
log(`bâtiments : ${B.length} emprises BD TOPO, ${LANDMARKS.length} monuments`);

// ───────────────────────────── Contexte OSM (occupation du sol, équipements) ─────────────────────────────
const ctxPolys = { industrial: [], commercial: [], retail: [], school: [], hospital: [], aero: [], hangar: [], parking: [], sport: [], railway: [] };
for (const e of loadLayer('landuse')) {
  const t = e.tags || {};
  let c = null;
  if (t.landuse === 'industrial') c = 'industrial'; else if (t.landuse === 'commercial') c = 'commercial'; else if (t.landuse === 'retail') c = 'retail'; else if (t.landuse === 'railway') c = 'railway';
  else if (/^(school|university|college|kindergarten)$/.test(t.amenity || '')) c = 'school'; else if (t.amenity === 'hospital') c = 'hospital';
  else if (t.amenity === 'parking' && /multi-storey|multi_storey/.test(t.parking || '')) c = 'parking';
  else if (t.aeroway === 'aerodrome') c = 'aero'; else if (t.aeroway === 'hangar' || t.aeroway === 'terminal') c = t.aeroway === 'hangar' ? 'hangar' : null;
  else if (/^(sports_centre|stadium)$/.test(t.leisure || '')) c = 'sport';
  if (!c) continue;
  for (const o of ringsOf(e).outers) if (o.length >= 3) ctxPolys[c].push({ polygon: o, name: t.name || '' });
}
const ctx = Object.fromEntries(Object.entries(ctxPolys).map(([k, v]) => [k, polyIndex(v, 150)]));
// équipements ponctuels : le bâtiment qui contient le point reçoit la nature correspondante
const poiKind = [];
for (const e of loadLayer('pois')) {
  const t = e.tags || {}, g = e.type === 'node' ? e : e.center; if (!g) continue;
  let k = null;
  if (/^(townhall|police|fire_station|library|post_office|courthouse)$/.test(t.amenity || '') || t.tourism === 'museum') k = 'civic';
  else if (t.amenity === 'place_of_worship') k = 'church'; else if (/^(school|university|college)$/.test(t.amenity || '')) k = 'school'; else if (t.amenity === 'hospital') k = 'hospital';
  else if (/^(supermarket|mall|department_store)$/.test(t.shop || '')) k = 'retail'; else if (t.amenity === 'theatre' || t.amenity === 'cinema') k = 'civic';
  else if (t.railway === 'station' && e.type === 'node' && t.station !== 'subway' && !t.subway) k = 'station';
  if (k) { const [x, z] = xz(g); poiKind.push([x, z, k]); }
}

// ───────────────────────────── Classement de chaque emprise ─────────────────────────────
const hash2 = (x, z) => { let h = (Math.round(x * 10) * 73856093) ^ (Math.round(z * 10) * 19349663); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
const items = [];
for (const b of B) {
  if (b.st === 'En ruine') continue;
  const poly = b.polys[0]; if (!poly || !poly[0] || poly[0].length < 4) continue;
  const outer = dedupeRing(poly[0]), inners = poly.slice(1).map((r) => dedupeRing(r)).filter((r) => r.length >= 3);
  if (outer.length < 3) continue;
  const area = Math.abs(polyArea(outer)) - inners.reduce((s, h) => s + Math.abs(polyArea(h)), 0);
  const c = centroid(outer), bb = bboxOf(outer);
  items.push({ b, outer, inners, area, c, bb });
}
// index des emprises pour retrouver celle qui contient un point d'intérêt
{ const G = 60, grid = new Map();
  items.forEach((it, i) => { for (let gx = Math.floor(it.bb[0] / G); gx <= Math.floor(it.bb[1] / G); gx++) for (let gz = Math.floor(it.bb[2] / G); gz <= Math.floor(it.bb[3] / G); gz++) { const k = gx * 100003 + gz; let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(i); } });
  for (const [x, z, k] of poiKind) for (const i of grid.get(Math.floor(x / G) * 100003 + Math.floor(z / G)) || []) { const it = items[i]; if (x >= it.bb[0] && x <= it.bb[1] && z >= it.bb[2] && z <= it.bb[3] && pointInPoly(x, z, it.outer)) { if (!it.poi || k === 'church' || k === 'station') it.poi = k; break; } }
}
const stats = { footprints: items.length, byKind: {}, byWall: {}, byRoof: {}, heightFromIgn: 0, heightDefault: 0, dropped: { tiny: 0, landmark: 0, outOfBounds: 0, road: 0 } };
function classify(it) {
  const b = it.b, area = it.area, [cx, cz] = it.c, dist = Math.hypot(cx, cz);
  const rect = minAreaRect(it.outer); it.rect = rect;
  const long = rect ? Math.max(rect.w, rect.d) : 0, short = rect ? Math.min(rect.w, rect.d) : 0;
  const year = +b.d || 0, light = !!b.lg;
  let h = b.h; const hKnown = h != null && h > 0;
  const lv = b.e > 0 ? b.e : 0, nl = b.nl || 0;
  const hh = hKnown ? h : lv ? lv * 3 : 0; // hauteur de travail pour le classement
  const at = (k) => !!ctx[k].find(cx, cz);
  let kind;
  if (b.n === 'Eglise' || b.n === 'Chapelle' || b.u1 === 'Religieux') kind = 'church';
  else if (b.n === 'Serre') kind = 'greenhouse';
  else if (b.n === 'Tribune') kind = 'sport';
  else if (it.poi === 'church' && area >= 80) kind = 'church';
  else if (it.poi === 'station' && area >= 150) kind = 'station';
  else if ((at('hangar') || (at('aero') && area >= 1500 && b.u1 !== 'Résidentiel')) && area >= 400) kind = 'hangar_aero';
  else if (at('parking') && area >= 300) kind = 'parking';
  else if (light || b.u1 === 'Annexe' || area < 20) kind = b.n === 'Industriel, agricole ou commercial' && area >= 150 ? 'industrial' : 'annex';
  else if (at('hospital') && area >= 60) kind = 'hospital';
  else if ((at('school') || it.poi === 'school') && area >= 60 && b.u1 !== 'Résidentiel') kind = 'school';
  else if (b.u1 === 'Sportif' || (at('sport') && area >= 150 && b.u1 !== 'Résidentiel')) kind = 'sport';
  else if (it.poi === 'civic' && area >= 150 && b.u1 !== 'Résidentiel') kind = 'civic';
  else if (b.n === 'Château' || b.n === 'Tour, donjon') kind = 'civic';
  else if (b.u1 === 'Résidentiel' || (nl >= 1 && b.u1 !== 'Industriel')) {
    const levels = lv || Math.max(1, Math.round(hh / 3));
    if ((hh >= 30 || levels >= 10) && short >= 12) kind = 'tower';
    else if (levels >= 4 && long >= 45 && long / Math.max(1, short) >= 3) kind = 'slab';
    else if (nl >= 3 || levels >= 3 || hh >= 10) kind = 'apartment';
    else if (year > 0 && year <= 1948 && levels <= 1 && hh <= 6.5 && /4/.test(b.mm || '') && area >= 45 && area <= 260 && dist < 6000) kind = 'toulousaine';
    else kind = 'house';
  }
  else if (it.poi === 'retail' && area >= 300) kind = 'retail';
  else if (b.u1 === 'Commercial et services') kind = at('retail') || (area >= 1500 && hh < 12 && !at('commercial')) ? 'retail' : (lv >= 3 || hh >= 10) && area < 6000 ? 'office' : area >= 600 ? 'commercial' : 'commercial';
  else if (b.u1 === 'Industriel' || b.u1 === 'Agricole' || b.n === 'Silo') kind = 'industrial';
  else if (b.n === 'Industriel, agricole ou commercial') kind = at('retail') ? 'retail' : at('commercial') && hh >= 9 && area < 5000 ? 'office' : 'industrial';
  else { // usage indifférencié : souvent des bâtiments publics ou tertiaires absents des fichiers fonciers
    if (at('retail') && area >= 200) kind = 'retail';
    else if (at('industrial') && area >= 150) kind = 'industrial';
    else if (at('commercial') && area >= 150) kind = hh >= 9 ? 'office' : 'commercial';
    else if (area >= 400 && hh >= 6) kind = hh >= 30 && short >= 12 ? 'tower' : 'civic';
    else if (hh >= 10) kind = 'apartment';
    else if (area < 40) kind = 'annex';
    else kind = 'house';
  }
  // ── hauteur : celle de la BD TOPO (égout du toit) ; sinon étages × 3 m ; sinon défaut par type et par quartier
  if (hKnown) stats.heightFromIgn++;
  else {
    const kk = hash2(cx, cz); stats.heightDefault++;
    h = lv ? lv * 3 + 0.5 : { annex: 2.4 + kk, house: 5 + 2 * kk, toulousaine: 4 + 2 * kk, apartment: dist < 1800 ? 12 + 6 * kk : 9 + 6 * kk, tower: 36, slab: 15, commercial: 6 + 2 * kk, retail: 6 + 2 * kk, industrial: 7 + 2 * kk, office: 10 + 4 * kk, school: 7 + 2 * kk, hospital: 12 + 4 * kk, church: 14 + 4 * kk, civic: 9 + 4 * kk, sport: 8 + 2 * kk, station: 8, parking: 9, greenhouse: 3.5, hangar_aero: 14 + 6 * kk }[kind];
  }
  h = Math.max(2.2, Math.min(150, h));
  const levels = Math.max(1, Math.min(60, lv || Math.round(h / (kind === 'industrial' || kind === 'hangar_aero' || kind === 'retail' || kind === 'commercial' ? 5 : 3)) || 1));
  // ── matériaux (codes des fichiers fonciers : 1 pierre, 2 meulière, 3 béton, 4 briques, 5 aggloméré, 6 bois, 9 autres)
  const mm = (b.mm || '').replace(/0/g, ''), mt = (b.mt || '').replace(/0/g, '');
  const old = (year > 0 && year <= 1948) || (!year && dist < 2500);
  const homey = kind === 'house' || kind === 'toulousaine' || kind === 'apartment';
  let wall;
  if (kind === 'greenhouse') wall = 'glass';
  else if (mm) {
    const m = mm[0];
    // « briques » : brique foraine apparente dans le bâti ancien, brique creuse enduite après-guerre
    wall = m === '4' || (mm.includes('4') && old) ? (old ? 'brick' : 'render') : m === '1' || m === '2' ? 'stone' : m === '3' ? 'concrete' : m === '5' ? 'render' : m === '6' ? 'wood' : mm.includes('4') && old ? 'brick' : 'render';
  } else if (kind === 'church') wall = 'brick';
  else if (homey) wall = old ? 'brick' : 'render';
  else if (kind === 'tower' || kind === 'slab' || kind === 'parking' || kind === 'hospital' || kind === 'school' || kind === 'sport' || kind === 'station') wall = 'concrete';
  else if (kind === 'civic') wall = dist < 2500 ? 'brick' : 'concrete';
  else if (kind === 'office') wall = year >= 1990 || (!year && h >= 12) ? 'glass' : 'concrete';
  else if (kind === 'industrial' || kind === 'commercial' || kind === 'retail' || kind === 'hangar_aero') wall = area >= 300 ? 'metal' : 'render';
  else wall = 'render'; // annexes
  let roof;
  if (kind === 'greenhouse') roof = 'glass';
  else if (mt) { const m = mt[0]; roof = m === '1' ? 'tile' : m === '2' ? 'slate' : m === '3' ? 'metal' : m === '4' ? 'flat' : homey && h < 12 ? 'tile' : 'flat'; }
  else if (kind === 'house' || kind === 'toulousaine' || kind === 'church' || kind === 'annex') roof = 'tile';
  else if (kind === 'apartment' || kind === 'civic') roof = old ? 'tile' : 'flat';
  else if (kind === 'industrial' || kind === 'commercial' || kind === 'retail' || kind === 'hangar_aero' || kind === 'sport' || kind === 'station') roof = area >= 300 ? 'metal' : 'tile';
  else roof = 'flat';
  it.kind = kind; it.h = h; it.meta = [K[kind], Wm[wall], Rm[roof], levels];
}

// ───────────────────────────── Rectangles orientés ─────────────────────────────
const inLandmark = (x, z) => LANDMARKS.some((l) => Math.hypot(x - l.x, z - l.z) < l.radius);
const raw = [];
const emit = (rect, it) => {
  if (rect.w < 1.6 || rect.d < 1.6) return;
  const { cx, cz } = rect;
  if (cx < BOUNDS.minX || cx > BOUNDS.maxX || cz < BOUNDS.minZ || cz > BOUNDS.maxZ) { stats.dropped.outOfBounds++; return; }
  if (inLandmark(cx, cz)) { stats.dropped.landmark++; return; }
  for (const l of LANDMARKS) { const dx = l.x - cx, dz = l.z - cz, u = dx * rect.ux + dz * rect.uz, v = -dx * rect.uz + dz * rect.ux; if (Math.abs(u) < rect.w / 2 + l.radius * 0.5 && Math.abs(v) < rect.d / 2 + l.radius * 0.5) { stats.dropped.landmark++; return; } }
  raw.push({ cx, cz, w: rect.w, d: rect.d, ux: rect.ux, uz: rect.uz, it });
};
const netArea = (o, hs) => Math.abs(polyArea(o)) - hs.reduce((s, h) => s + Math.abs(polyArea(h)), 0);
// Les emprises peu compactes (L, U, cours intérieures, grands ensembles) sont découpées récursivement.
const place = (outer, inners, it, depth) => {
  const area = netArea(outer, inners);
  if (area < 8) return;
  const rect = depth === 0 && it.rect ? it.rect : minAreaRect(outer);
  if (!rect) return;
  const fill = area / (rect.w * rect.d), excess = rect.w * rect.d - area;
  if (depth < 7 && fill < 0.74 && excess > 55 && area > 55) {
    const long = rect.w >= rect.d, nx = long ? rect.ux : -rect.uz, nz = long ? rect.uz : rect.ux, c = nx * rect.cx + nz * rect.cz;
    for (const s of [1, -1]) {
      const o2 = dedupeRing(clipHalfPlane(outer, s * nx, s * nz, s * c)); if (o2.length < 3) continue;
      place(o2, inners.map((h2) => dedupeRing(clipHalfPlane(h2, s * nx, s * nz, s * c))).filter((h2) => h2.length >= 3), it, depth + 1);
    }
    return;
  }
  emit(rect, it);
};
for (const it of items) {
  if (it.area < 8) { stats.dropped.tiny++; continue; }
  classify(it);
  place(it.outer, it.inners, it, 0);
}
log(`bâtiments : ${raw.length} rectangles avant dégagement des chaussées`);

// ───────────────────────────── Dégagement des chaussées ─────────────────────────────
// Axe de chaque route échantillonné tous les 2 m ; un rectangle qui approche l'axe à moins de la demi-largeur de
// chaussée (bornée ; 1,5 m pour les voies de desserte, 2 m pour les rues piétonnes) est rogné ou coupé en deux.
// Les tronçons en tunnel ou en tranchée profonde (ele ≤ −4 m) ne rognent rien.
const G = 25, grid = new Map(), MAXC = 8;
for (const r of world.roads) {
  const c = r.service ? 1.5 : r.kind === 'pedestrian' ? Math.min(2, r.width / 2) : Math.min(r.kind === 'motorway' || r.kind === 'trunk' ? MAXC : 6, Math.max(2.3, r.width / 2));
  if (r.tunnel) continue;
  for (let i = 1; i < r.points.length; i++) {
    if (r.ele && (r.ele[i - 1] + r.ele[i]) / 2 <= -4) continue;
    const [ax, az] = r.points[i - 1], [bx, bz] = r.points[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
    for (let k = 0; k <= n; k++) { const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n, key = Math.floor(x / G) * 100003 + Math.floor(z / G); let cell = grid.get(key); if (!cell) grid.set(key, (cell = [])); cell.push(x, z, c); }
  }
}
const trim = (q, depth) => {
  if (q.u1 - q.u0 < 2.2 || q.v1 - q.v0 < 2.2 || (q.u1 - q.u0) * (q.v1 - q.v0) < 7 || depth > 12) return [];
  const P = q.pts;
  for (let i = 0; i < P.length; i += 3) { const pu = P[i], pv = P[i + 1], c = P[i + 2];
    if (pu > q.u0 - c && pu < q.u1 + c && pv > q.v0 - c && pv < q.v1 + c) {
      const A = (a) => (a.u1 - a.u0 >= 2.2 && a.v1 - a.v0 >= 2.2 ? (a.u1 - a.u0) * (a.v1 - a.v0) : 0);
      const cu = [{ ...q, u1: Math.min(q.u1, pu - c) }, { ...q, u0: Math.max(q.u0, pu + c) }], cv = [{ ...q, v1: Math.min(q.v1, pv - c) }, { ...q, v0: Math.max(q.v0, pv + c) }];
      return (A(cu[0]) + A(cu[1]) >= A(cv[0]) + A(cv[1]) ? cu : cv).flatMap((a) => trim(a, depth + 1));
    } }
  return [q];
};
const out = []; // [cx, cz, w, d, rot, h, meta, tri]
let trimmed = 0;
for (const b of raw) {
  const rad = Math.hypot(b.w, b.d) / 2 + MAXC, pts = [];
  for (let gx = Math.floor((b.cx - rad) / G); gx <= Math.floor((b.cx + rad) / G); gx++) for (let gz = Math.floor((b.cz - rad) / G); gz <= Math.floor((b.cz + rad) / G); gz++) {
    const cell = grid.get(gx * 100003 + gz); if (!cell) continue;
    for (let i = 0; i < cell.length; i += 3) { const dx = cell[i] - b.cx, dz = cell[i + 1] - b.cz, u = dx * b.ux + dz * b.uz, v = -dx * b.uz + dz * b.ux, c = cell[i + 2]; if (Math.abs(u) < b.w / 2 + c && Math.abs(v) < b.d / 2 + c) pts.push(u, v, c); }
  }
  let parts = [{ u0: -b.w / 2, u1: b.w / 2, v0: -b.d / 2, v1: b.d / 2, pts }];
  if (pts.length) { parts = trim(parts[0], 0); trimmed++; if (!parts.length) stats.dropped.road++; }
  let rot = (Math.atan2(-b.uz, b.ux) * 180) / Math.PI; while (rot >= 90) rot -= 180; while (rot < -90) rot += 180;
  for (const q of parts) {
    const cu = (q.u0 + q.u1) / 2, cv = (q.v0 + q.v1) / 2, w = q.u1 - q.u0, d = q.v1 - q.v0;
    const cx = b.cx + cu * b.ux - cv * b.uz, cz = b.cz + cu * b.uz + cv * b.ux;
    if (inLandmark(cx, cz) || cx < BOUNDS.minX || cx > BOUNDS.maxX || cz < BOUNDS.minZ || cz > BOUNDS.maxZ) continue;
    out.push([r1(cx), r1(cz), r1(w), r1(d), r1(rot), r1(b.it.h), b.it.meta, w * d]);
  }
}
stats.trimmedForRoads = trimmed;
// Ordre spatial (dalles de 500 m, d'ouest en est puis du nord au sud) : favorise le chargement par tuile et la compression
const TILE = 500; out.sort((a, b) => Math.floor(a[1] / TILE) - Math.floor(b[1] / TILE) || Math.floor(a[0] / TILE) - Math.floor(b[0] / TILE));
// Budget de taille : au-delà, on retire d'abord les plus petites annexes hors du centre
const MAX = Math.floor(9e6 / 24);
let list = out;
if (list.length > MAX) {
  const cand = list.map((r, i) => [i, r]).filter(([, r]) => r[6][0] === K.annex && Math.hypot(r[0], r[1]) > 1800).sort((a, b) => a[1][7] - b[1][7]);
  const drop = new Set(cand.slice(0, list.length - MAX).map(([i]) => i));
  stats.droppedSmallAnnexes = drop.size; list = list.filter((_, i) => !drop.has(i));
}
const f32 = new Float32Array(list.length * 6), u8 = new Uint8Array(list.length * 4);
list.forEach((r, i) => { f32.set(r.slice(0, 6), i * 6); u8.set(r[6], i * 4); stats.byKind[KINDS[r[6][0]]] = (stats.byKind[KINDS[r[6][0]]] || 0) + 1; stats.byWall[WALLS[r[6][1]]] = (stats.byWall[WALLS[r[6][1]]] || 0) + 1; stats.byRoof[ROOFS[r[6][2]]] = (stats.byRoof[ROOFS[r[6][2]]] || 0) + 1; });
stats.rectangles = list.length;
const s1 = writeAtomic(join(OUT, 'buildings.bin'), Buffer.from(f32.buffer));
const s2 = writeAtomic(join(OUT, 'buildings-meta.bin'), Buffer.from(u8.buffer));
writeAtomic(join(OUT, 'buildings-meta.json'), {
  stride: 4, fields: ['kind', 'wall', 'roof', 'levels'], kinds: KINDS, walls: WALLS, roofs: ROOFS, count: list.length,
  meta: {
    source: 'IGN BD TOPO® (couche batiment, WFS Géoplateforme) — Licence Ouverte 2.0 ; contexte : © les contributeurs d’OpenStreetMap (ODbL)',
    generated: new Date().toISOString().slice(0, 10), generator: 'tools/osm/v5/buildings.mjs', city: CITY_ID,
    buildings: 'buildings.bin : Float32Array little-endian, 6 nombres par rectangle [cx, cz, w, d, rotDeg, h]. rotDeg = rotation.y en degrés (convention yaw, dans [−90, 90[) d’un pavé de largeur w sur son axe local X et de profondeur d sur son axe local Z. h = hauteur BD TOPO (du sol à l’égout du toit : le faîtage d’un toit en tuiles est au-dessus). Une emprise peu compacte donne plusieurs rectangles. Ordre : dalles de 500 m, du nord au sud puis d’ouest en est.',
    metaBin: 'buildings-meta.bin : Uint8Array, 4 octets par rectangle dans le même ordre : [kind, wall, roof, levels] (index dans kinds / walls / roofs ; levels = nombre de niveaux, BD TOPO ou hauteur / 3 m).',
    rules: 'kind : church (nature Église/Chapelle, usage Religieux, lieu de culte OSM) ; greenhouse (Serre) ; sport (Tribune, usage Sportif, emprise d’un stade ou complexe sportif OSM) ; station (gare OSM) ; hangar_aero (hangar ou grand bâtiment d’un aérodrome OSM) ; parking (parking en ouvrage OSM) ; annex (construction légère, usage Annexe ou moins de 20 m² : garages, abris) ; hospital / school (emprise OSM d’un hôpital, d’une école, d’une université) ; civic (mairie, police, pompiers, bibliothèque, musée, théâtre, château, ou grand bâtiment d’usage indifférencié) ; logements : tower (≥ 30 m ou ≥ 10 niveaux), slab (barre : ≥ 4 niveaux, ≥ 45 m de long, élancement ≥ 3), apartment (≥ 3 logements, ≥ 3 niveaux ou ≥ 10 m), toulousaine (maison de plain-pied d’avant 1949 en brique, 45–260 m²), house (autres maisons) ; retail (zone commerciale OSM, grande surface) ; office (services ≥ 3 niveaux, ou zone tertiaire OSM ≥ 9 m) ; commercial (autres commerces et services) ; industrial (usage industriel ou agricole, nature « industriel, agricole ou commercial », zone industrielle OSM). wall / roof : matériaux des fichiers fonciers quand ils existent (briques → brick dans le bâti d’avant 1949, render après : brique creuse enduite ; béton → concrete ; pierre → stone ; aggloméré → render ; bois → wood ; tuiles → tile ; ardoises → slate ; zinc → metal ; béton → flat), sinon défaut par type et par époque / distance au centre.',
    stats,
  },
});
log('stats :', JSON.stringify(stats));
log(`buildings.bin : ${list.length} rectangles, ${(s1 / 1e6).toFixed(2)} Mo ; buildings-meta.bin : ${(s2 / 1e6).toFixed(2)} Mo ; fait en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// Construit shared/world/paris.json et shared/world/buildings.json à partir du cache Overpass (.data/osm).
// Usage : node tools/osm/build.mjs [--no-buildings]
// Voir tools/osm/README.md pour le détail des choix.
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lonLatToXZ, BOUNDS } from '../../shared/geo.js';
import { LANDMARKS } from '../../shared/landmarks.js';
import {
  r1, polyArea, centroid, pointInPoly, polylineLength, simplify, simplifyRing, dedupeRing, clipRect, clipHalfPlane,
  clipPolyline, selfIntersects, minAreaRect, assembleRings,
} from './geom.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.data', 'osm');
const OUT = join(ROOT, 'shared', 'world');
const load = (n) => JSON.parse(readFileSync(join(CACHE, n + '.json'), 'utf8')).elements;
const writeAtomic = (file, obj) => { const s = JSON.stringify(obj); writeFileSync(file + '.tmp', s); renameSync(file + '.tmp', file); return s.length; };
const xz = (g) => lonLatToXZ(g.lon, g.lat);

const SIMPLIFY = 1.5;            // tolérance Douglas-Peucker (m)
const ROAD_MARGIN = 100;         // les routes sont coupées à BOUNDS + 100 m
const AREA_MARGIN = 150;         // les polygones (Seine, parcs) à BOUNDS + 150 m
const grow = (m) => ({ minX: BOUNDS.minX - m, maxX: BOUNDS.maxX + m, minZ: BOUNDS.minZ - m, maxZ: BOUNDS.maxZ + m });
const ROAD_RECT = grow(ROAD_MARGIN), AREA_RECT = grow(AREA_MARGIN);

// ───────────────────────────── Routes ─────────────────────────────
const DEFAULTS = { // [largeur double sens, largeur sens unique, voies double sens, voies sens unique]
  motorway: [14, 10.5, 4, 3], trunk: [14, 10.5, 4, 3], primary: [14, 10, 4, 3], secondary: [12, 9, 3, 2], tertiary: [9, 7, 2, 2],
  residential: [7, 5.5, 2, 1], unclassified: [7, 5.5, 2, 1], living_street: [5, 4.5, 1, 1], pedestrian: [6, 6, 0, 0], link: [6, 5, 2, 1],
};
function roadKind(name, hw) {
  if (hw === 'pedestrian') return 'pedestrian';
  const n = (name || '').toLowerCase();
  if (/^(quai|voie georges|voie mazas|port )/.test(n)) return 'quay';
  if (/^boulevard/.test(n)) return 'boulevard';
  if (/^(avenue|cours )/.test(n)) return 'avenue';
  return 'street';
}
function parseNum(v) { if (v == null) return NaN; const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; }

function buildRoads() {
  const raw = load('roads');
  let pieces = []; // {name, kind, hw, oneway, bridge, lanes, width, pts:[{x,z,id}]}
  for (const e of raw) {
    const t = e.tags || {};
    if (t.area === 'yes') continue;                                   // surfaces piétonnes -> plazas
    if (t.tunnel && t.tunnel !== 'no') continue;                      // monde plat : pas de souterrains
    if (t.covered === 'yes' || parseNum(t.layer) < 0) continue;
    if (t.access === 'private' || t.access === 'no') continue;
    const hw = t.highway, cls = hw.endsWith('_link') ? 'link' : hw;
    let oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.oneway === '-1' || t.junction === 'roundabout' || t.junction === 'circular';
    if (t.oneway === 'no') oneway = false;
    if (hw === 'pedestrian') oneway = false;
    let pts = e.geometry.map((g, i) => { const [x, z] = xz(g); return { x, z, id: e.nodes[i] }; });
    if (t.oneway === '-1') pts.reverse();
    const def = DEFAULTS[cls] || DEFAULTS.residential;
    let lanes = parseNum(t.lanes); if (!(lanes > 0)) lanes = oneway ? def[3] : def[2];
    lanes = Math.min(10, Math.round(lanes));
    let width = parseNum(t.width);
    if (!(width >= 2.5 && width <= 60)) width = !isNaN(parseNum(t.lanes)) && lanes > 0 ? lanes * 3.2 : oneway ? def[1] : def[0];
    width = Math.max(3, Math.min(40, width));
    const name = t.name || '';
    const bridge = !!t.bridge && t.bridge !== 'no';
    for (const run of clipPolyline(pts, ROAD_RECT)) {
      pieces.push({ name, kind: roadKind(name, hw), hw, oneway, bridge, lanes, width, pts: run });
    }
  }
  console.log(`routes : ${raw.length} ways OSM -> ${pieces.length} tronçons retenus`);

  // Fusion des tronçons contigus de même nom (mêmes kind / sens unique / pont), quand exactement deux
  // extrémités de ce groupe se touchent en un nœud. Les voies/largeurs sont moyennées (pondérées par la longueur).
  const groups = new Map();
  for (const p of pieces) {
    const k = [p.name, p.kind, p.hw === 'pedestrian', p.oneway, p.bridge].join('|');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const merged = [];
  for (const [k, list] of groups) {
    if (!list[0].name) { merged.push(...list); continue; } // les voies sans nom ne sont pas fusionnées
    const alive = new Set(list);
    const ends = new Map(); // nodeId -> [{p, atStart}]
    const reg = (p) => { for (const [id, s] of [[p.pts[0].id, true], [p.pts[p.pts.length - 1].id, false]]) { if (!ends.has(id)) ends.set(id, []); ends.get(id).push({ p, atStart: s }); } };
    const unreg = (p) => { for (const id of [p.pts[0].id, p.pts[p.pts.length - 1].id]) ends.set(id, (ends.get(id) || []).filter((e) => e.p !== p)); };
    list.forEach(reg);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [, es] of ends) {
        if (es.length !== 2 || es[0].p === es[1].p) continue;
        let [a, b] = es;
        // on veut : fin de A = début de B
        if (a.atStart && !b.atStart) [a, b] = [b, a];
        if (a.atStart === b.atStart) {
          if (list[0].oneway) continue;                       // sens incompatibles
          unreg(a.p); unreg(b.p);
          if (a.atStart) a.p.pts.reverse(); else b.p.pts.reverse();
        } else { unreg(a.p); unreg(b.p); }
        const la = polylineLength(a.p.pts.map((q) => [q.x, q.z])), lb = polylineLength(b.p.pts.map((q) => [q.x, q.z]));
        const A = a.p, B = b.p;
        A.lanesW = (A.lanesW ?? A.lanes * la) + (B.lanesW ?? B.lanes * lb);
        A.widthW = (A.widthW ?? A.width * la) + (B.widthW ?? B.width * lb);
        A.len = (A.len ?? la) + (B.len ?? lb);
        A.pts = A.pts.concat(B.pts.slice(1));
        alive.delete(B); reg(A); changed = true; break;
      }
    }
    for (const p of alive) { if (p.len) { p.lanes = Math.max(1, Math.round(p.lanesW / p.len)); p.width = p.widthW / p.len; } merged.push(p); }
  }
  console.log(`routes : ${merged.length} après fusion par nom`);
  return merged;
}

function buildGraph(roadsIn) {
  const drivable = roadsIn.filter((r) => r.kind !== 'pedestrian');
  const walk = roadsIn.filter((r) => r.kind === 'pedestrian');
  // nœuds partagés (intersections) et extrémités : à conserver lors de la simplification
  const use = new Map();
  for (const r of drivable) r.pts.forEach((p, i) => use.set(p.id, (use.get(p.id) || 0) + (i === 0 || i === r.pts.length - 1 ? 2 : 1)));
  const nodeIndex = new Map(), nodes = [];
  const nodeOf = (p) => { let i = nodeIndex.get(p.id); if (i === undefined) { i = nodes.length; nodes.push([r1(p.x), r1(p.z)]); nodeIndex.set(p.id, i); } return i; };
  for (const r of drivable) {
    const out = []; let seg = [r.pts[0]];
    const flush = () => {
      let s = simplify(seg.map((p) => [p.x, p.z, p]), SIMPLIFY).map((q) => q[2]);
      if (s.length === 2 && s[0].id === s[1].id && seg.length > 2) { // boucle fermée : garder le point le plus éloigné
        let far = seg[1], fd = 0;
        for (const p of seg) { const d = Math.hypot(p.x - seg[0].x, p.z - seg[0].z); if (d > fd) { fd = d; far = p; } }
        const i = seg.indexOf(far);
        s = simplify(seg.slice(0, i + 1).map((p) => [p.x, p.z, p]), SIMPLIFY).concat(simplify(seg.slice(i).map((p) => [p.x, p.z, p]), SIMPLIFY).slice(1)).map((q) => q[2]);
      }
      out.push(...(out.length ? s.slice(1) : s));
    };
    for (let i = 1; i < r.pts.length; i++) {
      seg.push(r.pts[i]);
      if (use.get(r.pts[i].id) >= 2 || i === r.pts.length - 1) { flush(); seg = [r.pts[i]]; }
    }
    r.nodeIds = out.map(nodeOf);
    // retire les doublons consécutifs (points confondus après arrondi)
    r.nodeIds = r.nodeIds.filter((n, i) => i === 0 || n !== r.nodeIds[i - 1]);
  }
  // Arêtes orientées : chaque segment de polyligne devient une arête a->b ; les voies à double sens
  // produisent aussi b->a.
  const N = nodes.length;
  const makeEdges = () => {
    const edges = [];
    drivable.forEach((r, ri) => {
      for (let i = 1; i < r.nodeIds.length; i++) {
        const a = r.nodeIds[i - 1], b = r.nodeIds[i];
        edges.push([a, b, ri]);
        if (!r.oneway) edges.push([b, a, ri]);
      }
    });
    return edges;
  };
  // Plus grande composante FORTEMENT connexe (Tarjan itératif) : garantit qu'un véhicule ne reste jamais piégé.
  const mainSccOf = (edges) => {
    const adj = Array.from({ length: N }, () => []);
    for (const [a, b] of edges) adj[a].push(b);
    const idx = new Int32Array(N).fill(-1), low = new Int32Array(N), onSt = new Uint8Array(N), comp = new Int32Array(N).fill(-1);
    let counter = 0, nComp = 0; const st = [];
    for (let s = 0; s < N; s++) {
      if (idx[s] !== -1) continue;
      const call = [[s, 0]]; idx[s] = low[s] = counter++; st.push(s); onSt[s] = 1;
      while (call.length) {
        const top = call[call.length - 1], v = top[0];
        if (top[1] < adj[v].length) {
          const w = adj[v][top[1]++];
          if (idx[w] === -1) { idx[w] = low[w] = counter++; st.push(w); onSt[w] = 1; call.push([w, 0]); } else if (onSt[w]) low[v] = Math.min(low[v], idx[w]);
        } else {
          if (low[v] === idx[v]) { let w; do { w = st.pop(); onSt[w] = 0; comp[w] = nComp; } while (w !== v); nComp++; }
          call.pop();
          if (call.length) { const u = call[call.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
        }
      }
    }
    const cs = new Map(); for (let i = 0; i < N; i++) cs.set(comp[i], (cs.get(comp[i]) || 0) + 1);
    const main = [...cs.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return (n) => comp[n] === main;
  };
  let edges = makeEdges();
  let inScc = mainSccOf(edges);
  // Les tronçons à sens unique restés hors de la composante (impasses créées par la coupe de l'emprise, la
  // suppression des tunnels ou une rue piétonne) sont détachés en routes distinctes et passés à DOUBLE SENS,
  // ce qui les rattache au réseau au lieu de les perdre.
  let reopened = 0;
  for (const r of drivable.slice()) {
    if (!r.oneway || r.nodeIds.length < 2) continue;
    const out = []; for (let i = 1; i < r.nodeIds.length; i++) out.push(!(inScc(r.nodeIds[i - 1]) && inScc(r.nodeIds[i])));
    if (!out.includes(true)) continue;
    const ids = r.nodeIds; let first = true;
    for (let i = 0; i < out.length;) {
      let j = i; while (j < out.length && out[j] === out[i]) j++;
      const part = ids.slice(i, j + 1);
      const target = first ? r : { ...r, pts: null };
      target.nodeIds = part;
      if (out[i]) { target.oneway = false; target.reopened = true; target.lanes = Math.max(2, target.lanes); reopened++; }
      if (!first) drivable.push(target);
      first = false; i = j;
    }
  }
  edges = makeEdges();
  inScc = mainSccOf(edges);
  // Composante faiblement connexe principale (on retire les îlots isolés)
  const parent = Int32Array.from({ length: N }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const [a, b] of edges) parent[find(a)] = find(b);
  const size = new Map(); for (let i = 0; i < N; i++) size.set(find(i), (size.get(find(i)) || 0) + 1);
  const mainRoot = [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const comps = size.size;
  const edgesBefore = edges.length;
  edges = edges.filter(([a, b]) => inScc(a) && inScc(b));
  // Routes : on garde celles de la composante faible principale (rendu), les autres sont supprimées.
  const keptRoads = drivable.filter((r) => r.nodeIds.length >= 2 && find(r.nodeIds[0]) === mainRoot);
  // Renumérotation compacte des nœuds utilisés par le graphe
  const remap = new Int32Array(N).fill(-1); const outNodes = [];
  const m = (i) => { if (remap[i] === -1) { remap[i] = outNodes.length; outNodes.push(nodes[i]); } return remap[i]; };
  const roads = [];
  const roadId = new Map();
  for (const r of keptRoads) {
    const id = roads.length + 1; roadId.set(r, id);
    roads.push({ id, name: r.name, kind: r.kind, width: r1(r.width), lanes: r.lanes, oneway: r.oneway, bridge: r.bridge, points: r.nodeIds.map((n) => nodes[n]) });
  }
  const outEdges = [];
  for (const [a, b, ri] of edges) { const id = roadId.get(drivable[ri]); if (id) outEdges.push([m(a), m(b), id]); }
  // Voies piétonnes : rendu seulement (hors graphe)
  let nWalk = 0;
  for (const r of walk) {
    let pts = simplify(r.pts.map((p) => [p.x, p.z]), SIMPLIFY).map(([x, z]) => [r1(x), r1(z)]);
    pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    if (pts.length < 2 || polylineLength(pts) < 15) continue;
    roads.push({ id: roads.length + 1, name: r.name, kind: 'pedestrian', width: r1(r.width), lanes: 0, oneway: false, bridge: r.bridge, points: pts });
    nWalk++;
  }
  const stats = {
    roads: roads.length, drivableRoads: keptRoads.length, pedestrianRoads: nWalk, droppedIsolatedRoads: drivable.length - keptRoads.length,
    weakComponentsBefore: comps, onewayStubsReopenedTwoWay: reopened, graphNodes: outNodes.length, graphEdges: outEdges.length, edgesOutsideMainSCC: edgesBefore - edges.length,
  };
  console.log('graphe :', JSON.stringify(stats));
  return { roads, graph: { nodes: outNodes, edges: outEdges }, stats };
}

// ───────────────────────────── Polygones ─────────────────────────────
// Anneaux extérieurs / intérieurs d'un élément OSM (way fermé ou relation multipolygone), en mètres.
function ringsOf(e) {
  if (e.type === 'way') {
    if (!e.geometry || e.geometry.length < 4) return { outers: [], inners: [] };
    const g = e.geometry.map(xz);
    const closed = Math.hypot(g[0][0] - g[g.length - 1][0], g[0][1] - g[g.length - 1][1]) < 0.01;
    return { outers: closed ? [g.slice(0, -1)] : [], inners: [] };
  }
  const ws = (role) => (e.members || []).filter((m) => m.type === 'way' && m.geometry && (role === 'outer' ? m.role !== 'inner' : m.role === 'inner')).map((m) => m.geometry.map(xz));
  return { outers: assembleRings(ws('outer')), inners: assembleRings(ws('inner')) };
}
// Nettoyage d'un polygone : découpe à l'emprise, simplification, sens horaire vu de dessus (aire signée > 0 en x,z).
function cleanPoly(ring, tol = SIMPLIFY, rect = AREA_RECT) {
  let p = clipRect(ring, rect);
  if (p.length < 3) return null;
  p = dedupeRing(simplifyRing(p, tol).map(([x, z]) => [r1(x), r1(z)]), 0.01);
  if (p.length < 3) return null;
  if (selfIntersects(p)) { // la simplification a pu créer un croisement : on réessaie plus finement
    p = dedupeRing(clipRect(ring, rect).map(([x, z]) => [r1(x), r1(z)]), 0.01);
    if (p.length < 3 || selfIntersects(p)) return null;
  }
  if (polyArea(p) < 0) p.reverse();
  return p;
}

function buildRiver() {
  const els = load('water');
  const polygons = [], islands = [];
  for (const e of els) {
    const t = e.tags || {};
    if (t.water === 'river' && e.type === 'relation') {
      const { outers } = ringsOf(e);
      for (const o of outers) { const p = cleanPoly(o); if (p && Math.abs(polyArea(p)) > 500) polygons.push(p); else if (!p) console.log('  Seine : anneau rejeté (hors emprise ou invalide)'); }
    }
    if ((t.place === 'islet' || t.place === 'island') && t.name) {
      for (const o of ringsOf(e).outers) { const p = cleanPoly(o); if (p && Math.abs(polyArea(p)) > 500) islands.push({ name: t.name, polygon: p }); }
    }
  }
  console.log(`Seine : ${polygons.length} polygones (${polygons.map((p) => p.length).join(', ')} points), îles : ${islands.map((i) => i.name).join(', ')}`);
  return { polygons, islands };
}

function buildGreen() {
  const els = load('green');
  const parks = [], plazas = [];
  for (const e of els) {
    const t = e.tags || {};
    if (t.access === 'private' || t.access === 'no' || t.access === 'customers') continue;
    if (t.tunnel || t.location === 'underground' || t.indoor === 'yes' || parseNum(t.layer) < 0 || parseNum(t.level) < 0) continue;
    const isPark = t.leisure === 'park' || t.leisure === 'garden';
    const isPlaza = !isPark && (t.highway === 'pedestrian' || t.place === 'square');
    if (!isPark && !isPlaza) continue;
    const name = t.name || '';
    for (const o of ringsOf(e).outers) {
      const p = cleanPoly(o);
      if (!p) continue;
      const area = Math.abs(polyArea(p));
      if (isPark) { if (area >= (name ? 3000 : 6000)) parks.push({ name, polygon: p, area }); } else if (area >= (name ? 2500 : 5000)) plazas.push({ name, polygon: p, area });
    }
  }
  // retire les polygones dont le centre tombe dans un polygone plus grand de la même couche (jardins dans un parc…)
  const dedupe = (list) => {
    list.sort((a, b) => b.area - a.area);
    const out = [];
    for (const it of list) {
      const [cx, cz] = centroid(it.polygon);
      if (out.some((o) => pointInPoly(cx, cz, o.polygon) && pointInPoly(it.polygon[0][0], it.polygon[0][1], o.polygon))) continue;
      out.push(it);
    }
    return out.map(({ name, polygon }) => ({ name, polygon }));
  };
  const res = { parks: dedupe(parks), plazas: dedupe(plazas) };
  console.log(`parcs : ${res.parks.length}, places : ${res.plazas.length}`);
  return res;
}

// ───────────────────────────── Bâtiments ─────────────────────────────
function hash2(x, z) { let h = (Math.round(x * 10) * 73856093) ^ (Math.round(z * 10) * 19349663); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; }

function buildBuildings(roads) {
  const files = readdirSync(CACHE).filter((f) => /^buildings_\d+_\d+\.json$/.test(f));
  if (!files.length) return null;
  const seen = new Set(), items = []; // {outer, inners, tags}
  const relMembers = new Set();
  if (existsSync(join(CACHE, 'buildings_rel.json'))) {
    for (const e of load('buildings_rel')) {
      const { outers, inners } = ringsOf(e);
      for (const m of e.members || []) if (m.type === 'way') relMembers.add(m.ref);
      for (const o of outers) items.push({ outer: o, inners: inners.filter((h) => pointInPoly(h[0][0], h[0][1], o)), tags: e.tags || {} });
    }
  } else console.log('  (buildings_rel.json absent : multipolygones ignorés)');
  const nRel = items.length;
  for (const f of files) for (const e of load(f.replace('.json', ''))) {
    if (e.type !== 'way' || seen.has(e.id) || relMembers.has(e.id)) continue;
    seen.add(e.id);
    const { outers } = ringsOf(e);
    if (outers.length) items.push({ outer: outers[0], inners: [], tags: e.tags || {} });
  }
  console.log(`bâtiments : ${items.length} emprises OSM (dont ${nRel} issues de multipolygones), ${files.length} tuiles`);

  const out = []; // [cx, cz, w, d, rot, h, area]
  const raw = []; // rectangles avant dégagement des chaussées
  const inLandmark = (x, z) => LANDMARKS.some((l) => Math.hypot(x - l.x, z - l.z) < l.radius);
  const stats = { tooSmall: 0, landmark: 0, outOfBounds: 0, split: 0, tagHeight: 0, tagLevels: 0, defaultHeight: 0, skippedType: 0, trimmedForRoads: 0, removedForRoads: 0 };
  const netArea = (o, hs) => Math.abs(polyArea(o)) - hs.reduce((s, h) => s + Math.abs(polyArea(h)), 0);
  const emit = (rect, h) => {
    if (rect.w < 2 || rect.d < 2) return;
    const { cx, cz } = rect;
    if (cx < BOUNDS.minX || cx > BOUNDS.maxX || cz < BOUNDS.minZ || cz > BOUNDS.maxZ) { stats.outOfBounds++; return; }
    if (inLandmark(cx, cz)) { stats.landmark++; return; }
    // un grand rectangle qui recouvrirait le centre d'un monument est écarté aussi
    for (const l of LANDMARKS) {
      const dx = l.x - cx, dz = l.z - cz, u = dx * rect.ux + dz * rect.uz, v = -dx * rect.uz + dz * rect.ux;
      if (Math.abs(u) < rect.w / 2 + l.radius * 0.5 && Math.abs(v) < rect.d / 2 + l.radius * 0.5) { stats.landmark++; return; }
    }
    raw.push({ cx, cz, w: rect.w, d: rect.d, ux: rect.ux, uz: rect.uz, h });
  };
  // Les emprises peu compactes (L, U, cours intérieures, palais) sont découpées récursivement pour que
  // les rectangles englobants ne débordent pas sur les cours et les rues.
  const place = (outer, inners, h, depth) => {
    const area = netArea(outer, inners);
    if (area < 25) { if (depth === 0) stats.tooSmall++; return; }
    const rect = minAreaRect(outer);
    if (!rect) return;
    const fill = area / (rect.w * rect.d);
    const excess = rect.w * rect.d - area; // m² de rectangle « en trop »
    if (depth < 7 && fill < 0.72 && excess > 120 && area > 80) {
      if (depth === 0) stats.split++;
      // coupe au milieu du grand côté
      const long = rect.w >= rect.d;
      const nx = long ? rect.ux : -rect.uz, nz = long ? rect.uz : rect.ux, c = nx * rect.cx + nz * rect.cz;
      for (const s of [1, -1]) {
        const o2 = dedupeRing(clipHalfPlane(outer, s * nx, s * nz, s * c));
        if (o2.length < 3) continue;
        const i2 = inners.map((h2) => dedupeRing(clipHalfPlane(h2, s * nx, s * nz, s * c))).filter((h2) => h2.length >= 3);
        place(o2, i2, h, depth + 1);
      }
      return;
    }
    emit(rect, h);
  };
  for (const it of items) {
    const t = it.tags;
    if (t.building === 'no' || t.building === 'roof' || t.location === 'underground' || parseNum(t.layer) < 0) { stats.skippedType++; continue; }
    const c = centroid(it.outer);
    if (c[0] < BOUNDS.minX - 300 || c[0] > BOUNDS.maxX + 300 || c[1] < BOUNDS.minZ - 300 || c[1] > BOUNDS.maxZ + 300) { stats.outOfBounds++; continue; }
    const area = netArea(it.outer, it.inners);
    let h = parseNum(t.height);
    const lv = parseNum(t['building:levels']);
    if (h > 0) stats.tagHeight++;
    else if (lv > 0) { h = lv * 3.2 + (parseNum(t['roof:levels']) > 0 ? parseNum(t['roof:levels']) * 3 : 0); stats.tagLevels++; }
    else { // défaut : immeuble parisien 18–24 m ; petites annexes de cour 4–8 m (variation déterministe)
      const k = hash2(c[0], c[1]);
      h = area < 50 ? 4 + k * 4 : 18 + k * 6; stats.defaultHeight++;
    }
    h = Math.max(3, Math.min(120, h));
    place(it.outer, it.inners, h, 0);
  }
  // Dégagement des chaussées : un rectangle englobant déborde parfois sur la rue (ou la rue passe sous un porche).
  // On échantillonne l'axe de chaque route tous les 2 m ; tout rectangle qui s'approche de l'axe à moins de la
  // demi-largeur de la voie (bornée à 2,5–6 m, 2 m pour les rues piétonnes) est rogné, ou coupé en deux.
  const G = 25, grid = new Map(), MAXC = 6;
  for (const r of roads) {
    const c = r.kind === 'pedestrian' ? 2 : Math.min(MAXC, Math.max(2.5, r.width / 2));
    for (let i = 1; i < r.points.length; i++) {
      const [ax, az] = r.points[i - 1], [bx, bz] = r.points[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n, key = Math.floor(x / G) + ',' + Math.floor(z / G);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push([x, z, c]);
      }
    }
  }
  const trim = (q, depth) => { // q = {u0,u1,v0,v1} dans le repère local (u,v) du rectangle d'origine
    if (q.u1 - q.u0 < 3 || q.v1 - q.v0 < 3 || (q.u1 - q.u0) * (q.v1 - q.v0) < 20) return [];
    if (depth > 12) return [];
    for (const [pu, pv, c] of q.pts) {
      if (pu > q.u0 - c && pu < q.u1 + c && pv > q.v0 - c && pv < q.v1 + c) {
        const A = (a) => (a.u1 - a.u0 >= 3 && a.v1 - a.v0 >= 3 ? (a.u1 - a.u0) * (a.v1 - a.v0) : 0);
        const cu = [{ ...q, u1: Math.min(q.u1, pu - c) }, { ...q, u0: Math.max(q.u0, pu + c) }];
        const cv = [{ ...q, v1: Math.min(q.v1, pv - c) }, { ...q, v0: Math.max(q.v0, pv + c) }];
        const best = A(cu[0]) + A(cu[1]) >= A(cv[0]) + A(cv[1]) ? cu : cv;
        return best.flatMap((a) => trim(a, depth + 1));
      }
    }
    return [q];
  };
  for (const b of raw) {
    const rad = Math.hypot(b.w, b.d) / 2 + MAXC, pts = [];
    for (let gx = Math.floor((b.cx - rad) / G); gx <= Math.floor((b.cx + rad) / G); gx++) for (let gz = Math.floor((b.cz - rad) / G); gz <= Math.floor((b.cz + rad) / G); gz++) {
      for (const [x, z, c] of grid.get(gx + ',' + gz) || []) {
        const dx = x - b.cx, dz = z - b.cz, u = dx * b.ux + dz * b.uz, v = -dx * b.uz + dz * b.ux;
        if (Math.abs(u) < b.w / 2 + c && Math.abs(v) < b.d / 2 + c) pts.push([u, v, c]);
      }
    }
    let parts = [{ u0: -b.w / 2, u1: b.w / 2, v0: -b.d / 2, v1: b.d / 2, pts }];
    if (pts.length) { parts = trim(parts[0], 0); stats.trimmedForRoads++; if (!parts.length) stats.removedForRoads++; }
    // rotDeg : rotation.y (convention yaw) telle que l'axe local X du pavé (largeur w) soit aligné sur u.
    let rot = (Math.atan2(-b.uz, b.ux) * 180) / Math.PI;
    while (rot >= 90) rot -= 180; while (rot < -90) rot += 180;
    for (const q of parts) {
      const cu = (q.u0 + q.u1) / 2, cv = (q.v0 + q.v1) / 2, w = q.u1 - q.u0, d = q.v1 - q.v0;
      const cx = b.cx + cu * b.ux - cv * b.uz, cz = b.cz + cu * b.uz + cv * b.ux;
      if (inLandmark(cx, cz) || cx < BOUNDS.minX || cx > BOUNDS.maxX || cz < BOUNDS.minZ || cz > BOUNDS.maxZ) continue;
      out.push([r1(cx), r1(cz), r1(w), r1(d), r1(rot), r1(b.h), w * d]);
    }
  }
  console.log(`bâtiments : ${out.length} rectangles`, JSON.stringify(stats));
  return { rects: out, stats, sourceFootprints: items.length };
}

// ───────────────────────────── Programme principal ─────────────────────────────
const t0 = Date.now();
const { roads, graph, stats: gstats } = buildGraph(buildRoads());
const river = buildRiver();
const { parks, plazas } = buildGreen();
const meta = {
  source: 'osm',
  attribution: '© les contributeurs d’OpenStreetMap (ODbL)',
  generated: new Date().toISOString().slice(0, 10),
  generator: 'tools/osm/build.mjs',
  units: 'mètres, repère shared/geo.js (+X est, +Z sud), arrondi 0,1 m',
  clipMargin: `routes coupées à BOUNDS + ${ROAD_MARGIN} m, polygones à BOUNDS + ${AREA_MARGIN} m`,
  roads: 'Tunnels, voies privées et surfaces piétonnes exclus. kind="pedestrian" = rues piétonnes (rendu seulement, absentes du graphe, lanes=0). Les chaussées séparées d’un boulevard sont deux routes à sens unique. Les tronçons contigus de même nom sont fusionnés (lanes/width = moyenne pondérée).',
  graphDirected: true,
  graph: 'Graphe ORIENTÉ : chaque arête [a, b, roadId] se parcourt de a vers b. Une voie à double sens fournit les DEUX arêtes [a,b,id] et [b,a,id] ; une voie à sens unique une seule. Les nœuds sont TOUS les sommets des polylignes des routes carrossables (intersections, extrémités et points de forme) : chaque arête est donc un segment droit, et nodes[a] / nodes[b] sont deux points consécutifs de roads[roadId].points. Une intersection est un nœud relié à 3 voisins distincts ou plus. Le graphe est limité à la plus grande composante fortement connexe (aucun cul-de-sac à sens unique : on peut toujours aller de n’importe quel nœud à n’importe quel autre). Les tronçons à sens unique qui seraient restés hors de cette composante (impasses créées par le bord de l’emprise, les tunnels supprimés ou une rue piétonne) sont détachés en routes distinctes et passés à double sens (oneway=false).',
  river: 'river.polygons = emprise complète de la Seine (anneaux extérieurs, les îles ne sont PAS retirées). river.islands = [{name, polygon}] : îles à dessiner par-dessus l’eau (ou à utiliser comme trous).',
  polygons: 'Polygones simples, non fermés (le premier point n’est pas répété), sens horaire vu de dessus (aire signée positive dans le plan x,z).',
  stats: gstats,
};
const paris = { meta, roads, graph, river, parks, plazas };
const size = writeAtomic(join(OUT, 'paris.json'), paris);
console.log(`paris.json : ${(size / 1e6).toFixed(2)} Mo`);

if (!process.argv.includes('--no-buildings')) {
  const b = buildBuildings(roads);
  if (b) {
    let rects = b.rects;
    const MAX_BYTES = 5e6;
    const flat = (list) => ({ meta: { source: 'osm', attribution: meta.attribution, generated: meta.generated, format: '6 nombres par bâtiment : cx, cz, w, d, rotDeg, h. rotDeg = rotation.y en degrés (convention yaw) d’un pavé de largeur w sur son axe local X et de profondeur d sur son axe local Z.', count: list.length, sourceFootprints: b.sourceFootprints, stats: b.stats }, buildings: list.flatMap((r) => r.slice(0, 6)) });
    let s = JSON.stringify(flat(rects));
    if (s.length > MAX_BYTES) { // trop gros : on retire les plus petits rectangles
      rects = rects.slice().sort((a, c) => c[6] - a[6]);
      let n = Math.floor(rects.length * (MAX_BYTES / s.length) * 0.99);
      rects = rects.slice(0, n);
      console.log(`bâtiments : fichier trop gros, ${b.rects.length - n} plus petits rectangles retirés (seuil ${rects[n - 1][6].toFixed(0)} m²)`);
    }
    const bs = writeAtomic(join(OUT, 'buildings.json'), flat(rects));
    console.log(`buildings.json : ${rects.length} bâtiments, ${(bs / 1e6).toFixed(2)} Mo`);
  } else console.log('buildings.json : pas de tuiles en cache, fichier non généré');
}
console.log(`fait en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

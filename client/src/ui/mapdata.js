// Données cartographiques de l'interface : géométries en tableaux typés, grille spatiale,
// hiérarchie des voies et versions simplifiées par niveau de zoom.
// Construit UNE fois à la création de l'interface (pendant l'écran de chargement) ; tout le reste
// (tuiles, libellés) est produit à la demande à partir de ces index, par petits pas.
import { clamp } from './util.js';

/** Hiérarchie des voies (0 = la plus importante). */
export const TIER = { MOTORWAY: 0, TRUNK: 1, MAJOR: 2, RAMP: 3, COLLECTOR: 4, STREET: 5, PED: 6, PATH: 7 };
/** Classes d'aplats, dans l'ordre de dessin. */
export const AK = { FARM: 0, FOREST: 1, RIVER: 2, ISLAND: 3, PARK: 4, GRASS: 5, CEMETERY: 6, INDUS: 7, COMM: 8, RAILAREA: 9, CONSTR: 10, PARKING: 11, PLAZA: 12, PITCH: 13, WATER: 14, APRON: 15, TAXIWAY: 16, RUNWAY: 17 };
const AREA_KIND = {
  farmland: AK.FARM, forest: AK.FOREST, wood: AK.FOREST, grass: AK.GRASS, cemetery: AK.CEMETERY, industrial: AK.INDUS,
  commercial: AK.COMM, retail: AK.COMM, railway: AK.RAILAREA, construction: AK.CONSTR, parking: AK.PARKING,
  pedestrian: AK.PLAZA, gravel: AK.PLAZA, cobble: AK.PLAZA, pitch: AK.PITCH, apron: AK.APRON, taxiway: AK.TAXIWAY, runway: AK.RUNWAY,
  park: AK.PARK, garden: AK.PARK, water: AK.WATER,
};
const CELL = 512; // maille de la grille spatiale (m)
const now = () => performance.now();

export function tierOf(r) {
  switch (r.kind) {
    case 'motorway': return TIER.MOTORWAY;
    case 'trunk': return TIER.TRUNK;
    case 'ramp': return TIER.RAMP;
    case 'avenue': case 'boulevard': return TIER.MAJOR;
    case 'pedestrian': return TIER.PED;
    default:
  }
  const w = r.width || 0, l = r.lanes || 0;
  if (l >= 4 || w >= 13) return TIER.MAJOR;
  if (r.kind === 'quay' || l >= 3 || w >= 9.5 || (r.maxspeed || 0) >= 70) return TIER.COLLECTOR;
  return TIER.STREET;
}
const DEF_W = [22, 16, 14, 7, 10, 7, 5, 3];

/** Range une liste de polylignes ([[x,z],…]) dans des tableaux typés. */
function pack(list, get) {
  const n = list.length, off = new Uint32Array(n + 1);
  let P = 0;
  for (let i = 0; i < n; i++) { off[i] = P; P += get(list[i]).length; }
  off[n] = P;
  const pts = new Float32Array(P * 2), bb = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = get(list[i]);
    let o = off[i] * 2, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < a.length; k++) {
      const x = +a[k][0], z = +a[k][1];
      pts[o++] = x; pts[o++] = z;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const q = i * 4; bb[q] = x0; bb[q + 1] = z0; bb[q + 2] = x1; bb[q + 3] = z1;
  }
  return { n, pts, off, bb };
}

/** Douglas-Peucker itératif sur pk.pts[s .. s+c) ; marque keep[k] = 1 pour les sommets conservés. */
function dp(pts, s, c, tol2, keep, stack) {
  keep[0] = 1; keep[c - 1] = 1;
  let sp = 0; stack[sp++] = 0; stack[sp++] = c - 1;
  while (sp > 0) {
    const b = stack[--sp], a = stack[--sp];
    if (b - a < 2) continue;
    const ax = pts[(s + a) * 2], az = pts[(s + a) * 2 + 1], dx = pts[(s + b) * 2] - ax, dz = pts[(s + b) * 2 + 1] - az;
    const l2 = dx * dx + dz * dz;
    let md = -1, mi = -1;
    for (let k = a + 1; k < b; k++) {
      const px = pts[(s + k) * 2] - ax, pz = pts[(s + k) * 2 + 1] - az;
      let d;
      if (l2 < 1e-6) d = px * px + pz * pz;
      else { const t = clamp((px * dx + pz * dz) / l2, 0, 1), ex = px - dx * t, ez = pz - dz * t; d = ex * ex + ez * ez; }
      if (d > md) { md = d; mi = k; }
    }
    if (md > tol2) { keep[mi] = 1; stack[sp++] = a; stack[sp++] = mi; stack[sp++] = mi; stack[sp++] = b; }
  }
}
/** Version simplifiée d'un pack (tolérance en mètres) pour les éléments retenus par include(i). */
function simplify(pk, tol, include) {
  const off = new Uint32Array(pk.n + 1);
  let capPts = 0, maxLen = 2;
  for (let i = 0; i < pk.n; i++) if (include(i)) { const c = pk.off[i + 1] - pk.off[i]; capPts += c; if (c > maxLen) maxLen = c; }
  const out = new Float32Array(capPts * 2), keep = new Uint8Array(maxLen), stack = new Int32Array(maxLen * 2 + 8);
  let o = 0;
  const tol2 = tol * tol;
  for (let i = 0; i < pk.n; i++) {
    off[i] = o >> 1;
    if (!include(i)) continue;
    const s = pk.off[i], c = pk.off[i + 1] - s;
    if (c <= 2) { for (let k = 0; k < c * 2; k++) out[o++] = pk.pts[s * 2 + k]; continue; }
    keep.fill(0, 0, c);
    dp(pk.pts, s, c, tol2, keep, stack);
    for (let k = 0; k < c; k++) if (keep[k]) { out[o++] = pk.pts[(s + k) * 2]; out[o++] = pk.pts[(s + k) * 2 + 1]; }
  }
  off[pk.n] = o >> 1;
  return { pts: out.slice(0, o), off };
}

export function buildMapData(wd, B0) {
  const T0 = now();
  wd = wd || {};
  const pois = wd.pois || {};
  B0 = B0 || { minX: -3000, maxX: 3000, minZ: -2700, maxZ: 2700 };
  const bounds = { minX: B0.minX, minZ: B0.minZ, maxX: B0.maxX, maxZ: B0.maxZ, w: B0.maxX - B0.minX, h: B0.maxZ - B0.minZ };
  const M = 300; // marge autour de l'emprise
  const ext = { minX: B0.minX - M, minZ: B0.minZ - M, maxX: B0.maxX + M, maxZ: B0.maxZ + M };
  ext.w = ext.maxX - ext.minX; ext.h = ext.maxZ - ext.minZ;

  // ---------- grille ----------
  const gx0 = Math.floor(ext.minX / CELL), gz0 = Math.floor(ext.minZ / CELL);
  const cols = Math.max(1, Math.ceil(ext.maxX / CELL) - gx0), rows = Math.max(1, Math.ceil(ext.maxZ / CELL) - gz0);
  const cellX = (x) => clamp(Math.floor(x / CELL) - gx0, 0, cols - 1), cellZ = (z) => clamp(Math.floor(z / CELL) - gz0, 0, rows - 1);
  function index(pk, include) {
    const res = { start: new Uint32Array(cols * rows + 1), items: null, mark: new Uint32Array(pk.n), stamp: 0 };
    const st = res.start;
    for (let i = 0; i < pk.n; i++) {
      if (include && !include(i)) continue;
      const q = i * 4, a = cellX(pk.bb[q]), b = cellZ(pk.bb[q + 1]), c = cellX(pk.bb[q + 2]), d = cellZ(pk.bb[q + 3]);
      for (let z = b; z <= d; z++) for (let x = a; x <= c; x++) st[z * cols + x + 1]++;
    }
    for (let k = 0; k < cols * rows; k++) st[k + 1] += st[k];
    res.items = new Uint32Array(st[cols * rows]);
    const pos = st.slice(0, cols * rows);
    for (let i = 0; i < pk.n; i++) {
      if (include && !include(i)) continue;
      const q = i * 4, a = cellX(pk.bb[q]), b = cellZ(pk.bb[q + 1]), c = cellX(pk.bb[q + 2]), d = cellZ(pk.bb[q + 3]);
      for (let z = b; z <= d; z++) for (let x = a; x <= c; x++) res.items[pos[z * cols + x]++] = i;
    }
    return res;
  }
  /** Remplit `out` (tableau JS, vidé) avec les éléments dont la boîte croise le rectangle. */
  function query(ix, pk, x0, z0, x1, z1, out) {
    out.length = 0;
    if (!ix || !pk.n) return out;
    const a = cellX(x0), b = cellZ(z0), c = cellX(x1), d = cellZ(z1);
    const stamp = ++ix.stamp, mark = ix.mark, items = ix.items, st = ix.start, bb = pk.bb;
    for (let z = b; z <= d; z++) for (let x = a; x <= c; x++) {
      const cell = z * cols + x;
      for (let k = st[cell], e = st[cell + 1]; k < e; k++) {
        const i = items[k];
        if (mark[i] === stamp) continue;
        mark[i] = stamp;
        const q = i * 4;
        if (bb[q] > x1 || bb[q + 2] < x0 || bb[q + 1] > z1 || bb[q + 3] < z0) continue;
        out.push(i);
      }
    }
    return out;
  }

  // ---------- voies ----------
  const src = [];
  for (const r of wd.roads || []) if (r && Array.isArray(r.points) && r.points.length > 1) src.push(r);
  const nRoad = src.length;
  for (const p of pois.paths || []) if (p && Array.isArray(p.points) && p.points.length > 1) src.push(p);
  const roads = pack(src, (r) => r.points);
  const n = roads.n;
  const tier = new Uint8Array(n), wid = new Float32Array(n), flag = new Uint8Array(n); // flag : 1 tunnel, 2 giratoire fermé, 4 pont
  const tierCount = new Uint32Array(8);
  for (let i = 0; i < n; i++) {
    const r = src[i], t = i < nRoad ? tierOf(r) : TIER.PATH;
    tier[i] = t; tierCount[t]++;
    wid[i] = r.width > 0 ? r.width : DEF_W[t];
    let f = (r.tunnel ? 1 : 0) | (r.bridge ? 4 : 0);
    if (r.roundabout) {
      const s = roads.off[i] * 2, e = roads.off[i + 1] * 2 - 2;
      if (Math.abs(roads.pts[s] - roads.pts[e]) < 1.5 && Math.abs(roads.pts[s + 1] - roads.pts[e + 1]) < 1.5 && e - s >= 6) f |= 2;
    }
    flag[i] = f;
  }
  roads.src = src; roads.tier = tier; roads.wid = wid; roads.flag = flag; roads.count = nRoad;
  // versions simplifiées : A = vue lointaine (grands axes), B = vue moyenne (jusqu'aux collectrices)
  roads.lodA = simplify(roads, 9, (i) => tier[i] <= TIER.MAJOR);
  roads.lodB = simplify(roads, 2.2, (i) => tier[i] <= TIER.COLLECTOR);
  const ixMajor = index(roads, (i) => tier[i] <= TIER.MAJOR);
  const ixMid = index(roads, (i) => tier[i] === TIER.RAMP || tier[i] === TIER.COLLECTOR);
  const ixMinor = index(roads, (i) => tier[i] === TIER.STREET);
  const ixPed = index(roads, (i) => tier[i] >= TIER.PED);
  const T1 = now();

  // ---------- aplats ----------
  const polySrc = [], polyK = [];
  const addPoly = (ring, k, name) => { if (Array.isArray(ring) && ring.length >= 3) { polySrc.push({ ring, name: name || '' }); polyK.push(k); } };
  for (const p of wd.river?.polygons || []) addPoly(Array.isArray(p?.[0]) ? p : p?.polygon, AK.RIVER, p?.name);
  for (const p of wd.river?.islands || []) addPoly(Array.isArray(p?.[0]) ? p : p?.polygon, AK.ISLAND, '');
  for (const p of pois.water || []) addPoly(p?.polygon, AK.WATER, p?.name);
  for (const p of wd.parks || []) addPoly(p?.polygon, AK.PARK, p?.name);
  for (const p of wd.plazas || []) addPoly(p?.polygon, AK.PLAZA, p?.name);
  for (const a of pois.areas || []) { const k = AREA_KIND[a?.kind]; if (k != null) addPoly(a.polygon, k, a.name); }
  const polys = pack(polySrc, (p) => p.ring);
  const pk = new Uint8Array(polyK), size = new Float32Array(polys.n); // size = √aire (m)
  for (let i = 0; i < polys.n; i++) {
    let a = 0;
    const s = polys.off[i], e = polys.off[i + 1];
    for (let k = s, j = e - 1; k < e; j = k++) a += polys.pts[j * 2] * polys.pts[k * 2 + 1] - polys.pts[k * 2] * polys.pts[j * 2 + 1];
    size[i] = Math.sqrt(Math.abs(a) / 2);
  }
  polys.src = polySrc; polys.k = pk; polys.size = size;
  polys.lodA = simplify(polys, 9, (i) => size[i] >= 30);
  polys.lodB = simplify(polys, 2.2, (i) => size[i] >= 8);
  const ixPolyBig = index(polys, (i) => size[i] >= 24 || pk[i] === AK.RUNWAY || pk[i] === AK.WATER || pk[i] === AK.RIVER || pk[i] === AK.ISLAND);
  const ixPolyAll = index(polys);

  // ---------- rails et cours d'eau (axes) ----------
  const railSrc = (wd.rails || []).filter((r) => r && Array.isArray(r.points) && r.points.length > 1);
  const rails = pack(railSrc, (r) => r.points);
  rails.kind = Uint8Array.from(railSrc, (r) => (r.kind === 'tram' ? 1 : r.kind === 'metro' ? 2 : r.kind === 'cable' ? 3 : 0)); // 0 train, 1 tram, 2 métro, 3 téléphérique
  rails.src = railSrc;
  rails.lodA = simplify(rails, 9, () => true);
  const ixRail = index(rails);
  const wwSrc = (wd.waterways || []).filter((r) => r && Array.isArray(r.points) && r.points.length > 1);
  const ww = pack(wwSrc, (r) => r.points);
  ww.wid = Float32Array.from(wwSrc, (r) => r.width || (r.kind === 'stream' ? 3 : 12));
  ww.kind = Uint8Array.from(wwSrc, (r) => (r.kind === 'stream' ? 2 : r.kind === 'river' ? 1 : 0));
  ww.src = wwSrc;
  ww.lodA = simplify(ww, 9, () => true);
  const ixWw = index(ww);
  const T2 = now();

  // ---------- voie la plus proche ----------
  const tmp = [];
  const nameIx = [ixMajor, ixMid, ixMinor, ixPed];
  /** Voie nommée la plus proche de (x,z) : { name, ref, tier, dist } ou null. */
  function roadAt(x, z, maxD = 28) {
    let best = -1, bd = maxD;
    const R = maxD + 24;
    for (const ix of nameIx) {
      query(ix, roads, x - R, z - R, x + R, z + R, tmp);
      for (let q = 0; q < tmp.length; q++) {
        const i = tmp[q];
        if (tier[i] === TIER.PATH) continue;
        const r = src[i];
        if (!r.name && !r.ref) continue;
        const half = wid[i] / 2;
        for (let k = roads.off[i], e = roads.off[i + 1] - 1; k < e; k++) {
          const ax = roads.pts[k * 2], az = roads.pts[k * 2 + 1], dx = roads.pts[k * 2 + 2] - ax, dz = roads.pts[k * 2 + 3] - az;
          const l2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
          const d = Math.max(0, Math.hypot(ax + dx * t - x, az + dz * t - z) - half);
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    if (best < 0) return null;
    const r = src[best];
    return { name: r.name || '', ref: r.ref || '', tier: tier[best], dist: bd };
  }

  return {
    bounds, ext, cell: CELL,
    roads, polys, rails, ww,
    ix: { major: ixMajor, mid: ixMid, minor: ixMinor, ped: ixPed, polyBig: ixPolyBig, polyAll: ixPolyAll, rail: ixRail, ww: ixWw },
    query, roadAt,
    stats: {
      prepMs: now() - T0, roadsMs: T1 - T0, areasMs: T2 - T1,
      roads: nRoad, paths: n - nRoad, points: roads.off[n], tiers: Array.from(tierCount),
      polys: polys.n, polyPoints: polys.off[polys.n], rails: rails.n, waterways: ww.n, cells: cols * rows,
      lodA: roads.lodA.pts.length / 2, lodB: roads.lodB.pts.length / 2,
    },
  };
}

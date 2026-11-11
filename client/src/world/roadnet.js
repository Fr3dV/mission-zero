// Réseau routier : index spatial sur les segments, requêtes (roadAt, plus proche point, point aléatoire),
// continuités entre tronçons et découpe aux carrefours.
import { mulberry32 } from './util.js';

const CELL = 48, PAD = 8;

export function sidewalkWidth(r) {
  if (r.kind === 'pedestrian') return 0;
  if (r.kind === 'avenue' || r.kind === 'boulevard') return r.width >= 9 ? 5 : 4;
  if (r.kind === 'quay') return 3;
  return r.width >= 9 ? 3.2 : 2.3;
}

export function createRoadNet(ctx) {
  const roads = (ctx.worldData.roads || []).filter((r) => r.points && r.points.length >= 2);
  // --- données dérivées par route
  let nSeg = 0;
  roads.forEach((r, i) => {
    // champs dérivés non énumérables : les objets route restent « propres » (JSON, Object.keys) pour les autres modules
    for (const k of ['_i', '_hw', '_sw', '_ped', '_cum', '_len', '_seg0', '_contA', '_contB', '_mx', '_mz', '_runs', '_hill', '_pave']) Object.defineProperty(r, k, { value: undefined, writable: true, enumerable: false, configurable: true });
    r._i = i; r._hw = Math.max(1.2, r.width / 2); r._sw = sidewalkWidth(r);
    r._ped = r.kind === 'pedestrian';
    const n = r.points.length, cum = new Float32Array(n);
    for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(r.points[k][0] - r.points[k - 1][0], r.points[k][1] - r.points[k - 1][1]);
    r._cum = cum; r._len = cum[n - 1]; r._seg0 = nSeg; nSeg += n - 1;
    r._contA = -1; r._contB = -1;
  });
  const sax = new Float32Array(nSeg), saz = new Float32Array(nSeg), sbx = new Float32Array(nSeg), sbz = new Float32Array(nSeg);
  const shw = new Float32Array(nSeg), sroad = new Int32Array(nSeg);
  const grid = new Map();
  const ckey = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);
  for (const r of roads) for (let k = 0; k < r.points.length - 1; k++) {
    const s = r._seg0 + k, a = r.points[k], b = r.points[k + 1];
    sax[s] = a[0]; saz[s] = a[1]; sbx[s] = b[0]; sbz[s] = b[1]; shw[s] = r._hw; sroad[s] = r._i;
    const e = r._hw + PAD;
    const cx0 = Math.floor((Math.min(a[0], b[0]) - e) / CELL), cx1 = Math.floor((Math.max(a[0], b[0]) + e) / CELL);
    const cz0 = Math.floor((Math.min(a[1], b[1]) - e) / CELL), cz1 = Math.floor((Math.max(a[1], b[1]) + e) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const k2 = ckey(cx, cz); let arr = grid.get(k2); if (!arr) grid.set(k2, (arr = [])); arr.push(s);
    }
  }
  const cellOf = (x, z) => grid.get(ckey(Math.floor(x / CELL), Math.floor(z / CELL)));

  // distance² point-segment + paramètre
  let _t = 0;
  function segDist2(s, x, z) {
    const ax = sax[s], az = saz[s], dx = sbx[s] - ax, dz = sbz[s] - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t; _t = t;
    const px = ax + dx * t - x, pz = az + dz * t - z;
    return px * px + pz * pz;
  }

  // --- continuités : deux extrémités seules sur un même nœud = même rue qui continue
  const nodeMap = new Map();
  const nkey = (p) => Math.round(p[0] * 5) * 200003 + Math.round(p[1] * 5);
  for (const r of roads) {
    const n = r.points.length;
    for (let k = 0; k < n; k++) {
      const key = nkey(r.points[k]); let e = nodeMap.get(key); if (!e) nodeMap.set(key, (e = { arms: 0, ends: [], p: r.points[k], maxHw: 0, ped: true }));
      const isEnd = k === 0 || k === n - 1;
      e.arms += isEnd ? 1 : 2; if (isEnd) e.ends.push([r._i, k === 0 ? 0 : 1]);
      if (r._hw > e.maxHw) e.maxHw = r._hw; if (!r._ped) e.ped = false;
    }
  }
  const junctions = []; // nœuds à ≥ 3 branches (pastille d'asphalte)
  for (const e of nodeMap.values()) {
    if (e.arms === 2 && e.ends.length === 2 && e.ends[0][0] !== e.ends[1][0]) {
      const [[ra, ea], [rb, eb]] = e.ends;
      if (ea === 0) roads[ra]._contA = rb; else roads[ra]._contB = rb;
      if (eb === 0) roads[rb]._contA = ra; else roads[rb]._contB = ra;
    } else if (e.arms >= 3 && e.ends.length >= 1) junctions.push(e);
  }
  /** direction (unitaire) du tronçon voisin à l'extrémité (0 = début, 1 = fin), dans le sens de parcours de r. */
  function contDir(r, end) {
    const ci = end === 0 ? r._contA : r._contB; if (ci < 0) return null;
    const c = roads[ci], p = end === 0 ? r.points[0] : r.points[r.points.length - 1];
    const n = c.points.length;
    const atStart = Math.abs(c.points[0][0] - p[0]) + Math.abs(c.points[0][1] - p[1]) < 0.5;
    let a, b;
    if (atStart) { a = c.points[0]; b = c.points[1]; } else { a = c.points[n - 1]; b = c.points[n - 2]; }
    // vecteur s'éloignant du nœud le long de c
    let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    return end === 0 ? [-dx, -dz] : [dx, dz];
  }
  // --- cadres par sommet : normale gauche « en onglet » (miter) pour décaler proprement la polyligne
  for (const r of roads) {
    const n = r.points.length, mx = new Float32Array(n), mz = new Float32Array(n);
    const dir = (k) => { const a = r.points[k], b = r.points[k + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    for (let k = 0; k < n; k++) {
      let d0 = k > 0 ? dir(k - 1) : contDir(r, 0), d1 = k < n - 1 ? dir(k) : contDir(r, 1);
      if (!d0) d0 = d1; if (!d1) d1 = d0;
      // normale gauche de (dx,dz) = (dz, -dx)  [+X est, +Z sud : gauche d'un véhicule allant vers d]
      const n0x = d0[1], n0z = -d0[0], n1x = d1[1], n1z = -d1[0];
      const dot = n0x * n1x + n0z * n1z;
      const sc = 1 / Math.max(0.35, 1 + dot);
      mx[k] = (n0x + n1x) * sc; mz[k] = (n0z + n1z) * sc;
      if (dot < -0.6) { mx[k] = n1x; mz[k] = n1z; }
    }
    r._mx = mx; r._mz = mz;
  }

  /** Point de la route r à l'abscisse s, décalé latéralement de `off` (>0 = gauche). Retourne dans out. */
  function pointAt(r, s, off, out) {
    const cum = r._cum, n = cum.length;
    let k = out._k | 0; if (k > n - 2 || cum[k] > s) k = 0;
    while (k < n - 2 && cum[k + 1] < s) k++;
    out._k = k;
    const a = r.points[k], b = r.points[k + 1], L = cum[k + 1] - cum[k] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[k]) / L));
    const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    const ox = (r._mx[k] * (1 - t) + r._mx[k + 1] * t) * off, oz = (r._mz[k] * (1 - t) + r._mz[k + 1] * t) * off;
    out.x = a[0] + (b[0] - a[0]) * t + ox; out.z = a[1] + (b[1] - a[1]) * t + oz;
    out.dx = dx; out.dz = dz; out.k = k;
    return out;
  }

  /**
   * Le point est-il sur la chaussée d'une AUTRE route (marge pad ≤ 8) ?
   * Retourne l'indice de la route trouvée ou -1. opts: self, ex1, ex2 (indices exclus), ped (inclure les rues piétonnes).
   */
  function insideOther(x, z, pad, self, ex1 = -1, ex2 = -1, ped = false) {
    const arr = cellOf(x, z); if (!arr) return -1;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i], ri = sroad[s];
      if (ri === self || ri === ex1 || ri === ex2) continue;
      const lim = shw[s] + pad; if (lim <= 0) continue;
      if (segDist2(s, x, z) < lim * lim) { if (!ped && roads[ri]._ped) continue; return ri; }
    }
    return -1;
  }
  /** Route (carrossable ou piétonne) sous le point, ou null. pad = marge ajoutée à la demi-largeur. */
  function roadAtPad(x, z, pad = 0, drivableOnly = false) {
    const arr = cellOf(x, z); if (!arr) return null;
    let best = null, bd = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i], r = roads[sroad[s]];
      if (drivableOnly && r._ped) continue;
      const lim = shw[s] + pad, d2 = segDist2(s, x, z);
      if (d2 <= lim * lim && d2 < bd) { bd = d2; best = r; }
    }
    return best;
  }
  /** Distance au bord de chaussée le plus proche (négatif = sur la chaussée), bornée à PAD. */
  function edgeDistance(x, z, includePed = true) {
    const arr = cellOf(x, z); if (!arr) return PAD;
    let best = PAD;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i]; if (!includePed && roads[sroad[s]]._ped) continue;
      const d = Math.sqrt(segDist2(s, x, z)) - shw[s]; if (d < best) best = d;
    }
    return best;
  }

  const yawOf = (dx, dz) => Math.atan2(-dx, -dz);
  function nearestRoadPoint(x, z, opts) {
    const drivable = !opts || opts.drivable !== false;
    let best = -1, bd = Infinity, bt = 0;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let ring = 0; ring < 80; ring++) {
      for (let ix = cx - ring; ix <= cx + ring; ix++) for (let iz = cz - ring; iz <= cz + ring; iz++) {
        if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
        const arr = grid.get(ckey(ix, iz)); if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const s = arr[i]; if (drivable && roads[sroad[s]]._ped) continue;
          const d2 = segDist2(s, x, z); if (d2 < bd) { bd = d2; best = s; bt = _t; }
        }
      }
      if (best >= 0 && Math.sqrt(bd) < (ring - 0.5) * CELL) break;
    }
    if (best < 0) return null;
    const dx = sbx[best] - sax[best], dz = sbz[best] - saz[best];
    return { x: sax[best] + dx * bt, z: saz[best] + dz * bt, yaw: yawOf(dx, dz), road: roads[best >= 0 ? sroad[best] : 0], dist: Math.sqrt(bd) };
  }
  // tirage aléatoire pondéré par la longueur parmi les routes carrossables hors ponts
  const pick = roads.filter((r) => !r._ped && !r.bridge && r._len > 12);
  const pickCum = new Float32Array(pick.length); { let acc = 0; pick.forEach((r, i) => { acc += r._len; pickCum[i] = acc; }); }
  const rnd = mulberry32((Math.random() * 1e9) | 0);
  const tmp = { _k: 0 };
  function randomRoadPoint() {
    if (!pick.length) return { x: 0, z: 0, yaw: 0, road: null };
    for (let tries = 0; tries < 12; tries++) {
      const v = rnd() * pickCum[pick.length - 1];
      let lo = 0, hi = pick.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (pickCum[m] < v) lo = m + 1; else hi = m; }
      const r = pick[lo], s = 5 + rnd() * (r._len - 10);
      // voie de droite si double sens, sinon axe de la voie
      const off = r.oneway ? 0 : -r._hw * 0.5;
      pointAt(r, s, off, tmp);
      if (tries < 11 && insideOther(tmp.x, tmp.z, 2, r._i, r._contA, r._contB) >= 0) continue; // pas au milieu d'un carrefour
      return { x: tmp.x, z: tmp.z, yaw: yawOf(tmp.dx, tmp.dz), road: r };
    }
  }

  /**
   * Intervalles [s0,s1,finCoupéeDébut,finCoupéeFin,autreDébut,autreFin] de l'axe de r hors carrefours.
   */
  function freeRuns(r) {
    if (r._runs) return r._runs;
    const runs = [], o = { _k: 0 }, STEP = 2;
    const n = Math.max(1, Math.ceil(r._len / STEP));
    const test = (s) => { pointAt(r, s, 0, o); return insideOther(o.x, o.z, 0.3, r._i, r._contA, r._contB); };
    let prevS = 0, prevIn = test(0), start = prevIn < 0 ? 0 : -1, startCut = false, startOther = -1;
    for (let i = 1; i <= n; i++) {
      const s = (r._len * i) / n, inn = test(s);
      if ((inn >= 0) !== (prevIn >= 0)) {
        let a = prevS, b = s; // bissection
        for (let it = 0; it < 5; it++) { const m = (a + b) / 2; if ((test(m) >= 0) === (prevIn >= 0)) a = m; else b = m; }
        const edge = (a + b) / 2;
        if (inn >= 0) { if (start >= 0) runs.push([start, edge, startCut, true, startOther, inn]); start = -1; }
        else { start = edge; startCut = true; startOther = prevIn; }
      }
      prevS = s; prevIn = inn;
    }
    if (start >= 0) runs.push([start, r._len, startCut, false, startOther, -1]);
    r._runs = runs;
    return runs;
  }

  return {
    roads, junctions, pointAt, insideOther, roadAtPad, edgeDistance, freeRuns, nearestRoadPoint, randomRoadPoint,
    roadAt: (x, z) => roadAtPad(x, z, 0),
  };
}

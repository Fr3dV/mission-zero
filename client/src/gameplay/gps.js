// GPS : index spatial des chaussées + recherche d'itinéraire A* sur worldData.graph.
// JS pur (aucune dépendance Three/DOM) : testable sous Node, et dimensionné pour une agglomération entière
// (centaines de milliers de segments) : grilles uniformes en tableaux typés, tas binaire typé, A* borné dans le temps.
//
// Graphe : si worldData.meta.graphDirected est vrai, il est orienté (sens uniques respectés, chaque double sens
// fournit ses deux arêtes) ; sinon chaque arête est parcourue dans les deux sens.
// Niveaux superposés : routes[].ele (par sommet) et graph.nodeEle (par nœud) donnent l'élévation relative au
// relief de base ; les recherches acceptent un indice d'élévation pour ne pas confondre un pont et la voie dessous.

const yawOf = (dx, dz) => Math.atan2(-dx, -dz); // avant = (-sin yaw, -cos yaw)
const FAST = { motorway: 1, trunk: 1, ramp: 1 };
const ELE_WEIGHT = 6; // 1 m d'écart vertical « coûte » 6 m dans le choix de la chaussée la plus proche

/** Chaussée carrossable (tout sauf les rues piétonnes et les sites propres de bus). */
export const isDrivable = (r) => !!r && r.kind !== 'pedestrian' && !r.busway;
/**
 * Rue de ville où l'on peut s'arrêter et que le GPS sait rejoindre : ni piétonne, ni voie rapide, ni bretelle,
 * ni tunnel, ni voie de desserte (`service` : parkings, enceintes d'hôpital ou d'aéroport — absentes du graphe).
 */
export const isStreet = (r) => !!r && r.kind !== 'pedestrian' && !FAST[r.kind] && !r.tunnel && !r.service && !r.busway;
/** Voie accessible à pied (rues, rues piétonnes, voies de desserte ; ni voie rapide, ni tunnel, ni site propre). */
export const isWalkable = (r) => !!r && !FAST[r.kind] && !r.tunnel && !r.busway;

/** Une route correspond-elle à un recalage ciblé { kind?: [...], name?, ref?, bridge? } ? */
export function roadMatches(road, q) {
  if (!road || !q) return false;
  if (road.service && !q.service) return false; // les voies de desserte ne comptent que si on les demande
  if (q.kind && !q.kind.includes(road.kind)) return false;
  if (q.bridge && !road.bridge) return false;
  if (q.name && !`${road.name || ''} ${road.bridgeName || ''}`.includes(q.name)) return false;
  if (q.ref && !String(road.ref || '').includes(q.ref)) return false;
  return true;
}

/**
 * Grille uniforme de segments (CSR en tableaux typés). segs = { n, ax, az, bx, bz } (Float32Array).
 * visit(x, z, maxDist, fn) appelle fn(i) pour les segments des cellules à moins de maxDist, anneau par anneau ;
 * fn retourne la meilleure distance connue (pour arrêter la recherche dès que possible).
 */
function buildGrid(segs, cell) {
  const { n, ax, az, bx, bz } = segs;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    if (ax[i] < minX) minX = ax[i]; if (bx[i] < minX) minX = bx[i];
    if (ax[i] > maxX) maxX = ax[i]; if (bx[i] > maxX) maxX = bx[i];
    if (az[i] < minZ) minZ = az[i]; if (bz[i] < minZ) minZ = bz[i];
    if (az[i] > maxZ) maxZ = az[i]; if (bz[i] > maxZ) maxZ = bz[i];
  }
  if (!n) { minX = minZ = 0; maxX = maxZ = 1; }
  const nx = Math.max(1, Math.floor((maxX - minX) / cell) + 1), nz = Math.max(1, Math.floor((maxZ - minZ) / cell) + 1);
  const cx = (x) => { const c = Math.floor((x - minX) / cell); return c < 0 ? 0 : c >= nx ? nx - 1 : c; };
  const cz = (z) => { const c = Math.floor((z - minZ) / cell); return c < 0 ? 0 : c >= nz ? nz - 1 : c; };
  const start = new Uint32Array(nx * nz + 1);
  const each = (fn) => {
    for (let i = 0; i < n; i++) {
      const x0 = cx(Math.min(ax[i], bx[i])), x1 = cx(Math.max(ax[i], bx[i]));
      const z0 = cz(Math.min(az[i], bz[i])), z1 = cz(Math.max(az[i], bz[i]));
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) fn(iz * nx + ix, i);
    }
  };
  each((c) => { start[c + 1]++; });
  for (let c = 0; c < nx * nz; c++) start[c + 1] += start[c];
  const items = new Uint32Array(start[nx * nz]);
  const fill = new Uint32Array(nx * nz);
  each((c, i) => { items[start[c] + fill[c]++] = i; });

  function visit(x, z, maxDist, fn) {
    const c0x = Math.floor((x - minX) / cell), c0z = Math.floor((z - minZ) / cell);
    const maxRing = Math.ceil(maxDist / cell) + 1;
    let best = maxDist;
    const scan = (c) => { for (let k = start[c]; k < start[c + 1]; k++) best = fn(items[k], best); };
    for (let ring = 0; ring <= maxRing; ring++) {
      if ((ring - 1) * cell > best) break;
      const x0 = c0x - ring, x1 = c0x + ring, z0 = c0z - ring, z1 = c0z + ring;
      if (x1 < 0 || z1 < 0 || x0 >= nx || z0 >= nz) continue; // anneau entièrement hors de la grille
      for (let iz = Math.max(0, z0); iz <= Math.min(nz - 1, z1); iz++) {
        if (iz === z0 || iz === z1) {
          for (let ix = Math.max(0, x0); ix <= Math.min(nx - 1, x1); ix++) scan(iz * nx + ix);
        } else {
          if (x0 >= 0) scan(iz * nx + x0);
          if (x1 < nx && x1 !== x0) scan(iz * nx + x1);
        }
      }
    }
  }
  return { visit, nx, nz, cell };
}

/** Index des segments de chaussée : point de route le plus proche. */
export function createRoadIndex(worldData, cell = 100) {
  const roads = worldData?.roads || [];
  let n = 0;
  for (const r of roads) n += Math.max(0, (r.points?.length || 0) - 1);
  const ax = new Float32Array(n), az = new Float32Array(n), bx = new Float32Array(n), bz = new Float32Array(n);
  const ea = new Float32Array(n), eb = new Float32Array(n), ri = new Uint32Array(n);
  n = 0;
  for (let r = 0; r < roads.length; r++) {
    const pts = roads[r].points || [], ele = roads[r].ele;
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i][0] === pts[i + 1][0] && pts[i][1] === pts[i + 1][1]) continue;
      ax[n] = pts[i][0]; az[n] = pts[i][1]; bx[n] = pts[i + 1][0]; bz[n] = pts[i + 1][1];
      ea[n] = ele ? +ele[i] || 0 : 0; eb[n] = ele ? +ele[i + 1] || 0 : 0;
      ri[n++] = r;
    }
  }
  const grid = buildGrid({ n, ax, az, bx, bz }, cell);

  /**
   * Point de l'axe de chaussée le plus proche de (x, z).
   * @param filter   (road) => bool, facultatif
   * @param eleHint  élévation relative souhaitée (m) : départage un pont et la voie qui passe dessous
   * @returns {{x,z,yaw,road,dist,side,dirX,dirZ,ele}|null} side = +1 si (x,z) est à droite du sens de la route ;
   *   ele = élévation de la chaussée en ce point, relative au relief de base.
   */
  function nearest(x, z, maxDist = 400, filter = null, eleHint) {
    if (!n) return null;
    let bi = -1, bt = 0, bScore = maxDist;
    const useEle = Number.isFinite(eleHint);
    grid.visit(x, z, maxDist, (i, best) => {
      const dx = bx[i] - ax[i], dz = bz[i] - az[i];
      let t = ((x - ax[i]) * dx + (z - az[i]) * dz) / (dx * dx + dz * dz);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      let d = Math.hypot(x - (ax[i] + dx * t), z - (az[i] + dz * t));
      if (useEle) d += Math.abs(ea[i] + (eb[i] - ea[i]) * t - eleHint) * ELE_WEIGHT;
      if (d >= bScore) return best;
      if (filter && !filter(roads[ri[i]])) return best;
      bScore = d; bi = i; bt = t;
      return d;
    });
    if (bi < 0) return null;
    const dx = bx[bi] - ax[bi], dz = bz[bi] - az[bi], l = Math.hypot(dx, dz);
    const px = ax[bi] + dx * bt, pz = az[bi] + dz * bt;
    // produit vectoriel : côté du point par rapport au sens du segment (droite = +1)
    const cross = dx * (z - az[bi]) - dz * (x - ax[bi]);
    return {
      x: px, z: pz, yaw: yawOf(dx, dz), road: roads[ri[bi]], dist: Math.hypot(x - px, z - pz), side: cross >= 0 ? 1 : -1,
      dirX: dx / l, dirZ: dz / l, ele: ea[bi] + (eb[bi] - ea[bi]) * bt,
    };
  }

  return { nearest, count: n };
}

/**
 * Recale une étape de mission sur la chaussée (logique partagée par le client et les tests).
 * @returns {{x, z, ele, road, moved, matched}} matched = le recalage ciblé (snapTo) a trouvé sa route.
 */
export function snapStepToRoad(roads, s, defaultMax = 160) {
  if (s.snap === false) return { x: s.x, z: s.z, ele: undefined, road: null, moved: 0, matched: true };
  if (s.snapTo) {
    const q = s.snapTo;
    const n = roads.nearest(s.x, s.z, q.max || 400, (r) => isDrivable(r) && roadMatches(r, q));
    if (n) return { x: n.x, z: n.z, ele: n.ele, road: n.road, moved: n.dist, matched: true };
  }
  // par défaut : une rue de ville au niveau du sol (ni voie rapide, ni trémie, ni pont si une rue passe à côté),
  // sinon n'importe quelle chaussée carrossable
  const n = roads.nearest(s.x, s.z, defaultMax, isStreet, 0) || roads.nearest(s.x, s.z, defaultMax, isDrivable, 0);
  if (!n) return { x: s.x, z: s.z, ele: undefined, road: null, moved: 0, matched: !s.snapTo };
  const half = (n.road?.width || 8) / 2;
  // déjà sur la chaussée : on garde le point (mais on connaît son élévation)
  if (n.dist <= half - 1.5) return { x: s.x, z: s.z, ele: n.ele, road: n.road, moved: 0, matched: !s.snapTo };
  return { x: n.x, z: n.z, ele: n.ele, road: n.road, moved: n.dist, matched: !s.snapTo };
}

// ------------------------------------------------------------------------------------------- routeur

/** Vitesse de parcours estimée d'une route (m/s) : maxspeed si connu, sinon selon le type ; minorée en ville (carrefours). */
export function roadSpeed(road) {
  const kind = road?.kind;
  let kmh = +road?.maxspeed;
  if (!(kmh > 0)) kmh = kind === 'motorway' ? 110 : kind === 'trunk' ? 90 : kind === 'ramp' ? 50 : kind === 'street' ? 30 : 50;
  kmh = Math.min(130, Math.max(10, kmh));
  const flow = kind === 'motorway' || kind === 'trunk' ? 0.92 : kind === 'ramp' ? 0.8 : 0.62;
  return (kmh / 3.6) * flow;
}

/** Tas binaire typé (clé flottante, valeur entière), capacité fixe réutilisée d'une recherche à l'autre. */
class Heap {
  constructor(cap) { this.k = new Float32Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  clear() { this.n = 0; }
  push(key, val) {
    const k = this.k, v = this.v;
    if (this.n >= k.length) { // ne devrait pas arriver (≤ une entrée par arête relâchée) : on double
      const k2 = new Float32Array(k.length * 2), v2 = new Int32Array(k.length * 2);
      k2.set(k); v2.set(v); this.k = k2; this.v = v2;
      return this.push(key, val);
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const n = --this.n;
    if (n > 0) {
      const lk = k[n], lv = v[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Routeur A* sur le graphe routier.
 * route(ax, az, bx, bz, opts?) -> { path: [[x, z, ele?], ...], length (m), time (s estimées), routed, partial, ms }
 *   opts.metric   'time' (défaut : préfère les voies rapides, coût = longueur / vitesse) ou 'distance'
 *   opts.fromEle / opts.toEle   élévations relatives du départ / de l'arrivée (niveaux superposés)
 *   opts.budgetMs  temps de calcul maximal (défaut 30 ms) ; au-delà, itinéraire partiel + ligne droite.
 */
export function createRouter(worldData, cell = 120) {
  const gNodes = worldData?.graph?.nodes || [];
  const gEdges = worldData?.graph?.edges || [];
  const gEle = worldData?.graph?.nodeEle || null;
  const directed = !!worldData?.meta?.graphDirected;
  const n = gNodes.length;
  const X = new Float32Array(n), Z = new Float32Array(n), E = new Float32Array(n);
  for (let i = 0; i < n; i++) { X[i] = gNodes[i][0]; Z[i] = gNodes[i][1]; E[i] = gEle ? +gEle[i] || 0 : 0; }

  // vitesse par route (les arêtes portent l'id de leur route)
  const speedById = new Map();
  for (const r of worldData?.roads || []) if (r.id != null) speedById.set(r.id, roadSpeed(r));
  let vmax = 1;

  // arêtes orientées valides
  let m = 0;
  for (const e of gEdges) if (e[0] < n && e[1] < n && e[0] !== e[1]) m += directed ? 1 : 2;
  const eA = new Uint32Array(m), eB = new Uint32Array(m), eLen = new Float32Array(m), eTime = new Float32Array(m);
  m = 0;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const e of gEdges) {
    const a = e[0], b = e[1];
    if (!(a < n && b < n) || a === b) continue;
    const len = Math.hypot(X[a] - X[b], Z[a] - Z[b], E[a] - E[b]);
    const v = speedById.get(e[2]) || 8;
    if (v > vmax) vmax = v;
    eA[m] = a; eB[m] = b; eLen[m] = len; eTime[m++] = len / v;
    if (!directed) { eA[m] = b; eB[m] = a; eLen[m] = len; eTime[m++] = len / v; }
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const comp = new Int32Array(n);
  for (let i = 0; i < n; i++) comp[i] = find(i);

  // listes d'adjacence compactes (CSR), triées par nœud de départ
  const off = new Uint32Array(n + 1);
  for (let j = 0; j < m; j++) off[eA[j] + 1]++;
  for (let i = 0; i < n; i++) off[i + 1] += off[i];
  const adjTo = new Uint32Array(m), adjLen = new Float32Array(m), adjTime = new Float32Array(m);
  {
    const fill = new Uint32Array(n);
    for (let j = 0; j < m; j++) { const a = eA[j], p = off[a] + fill[a]++; adjTo[p] = eB[j]; adjLen[p] = eLen[j]; adjTime[p] = eTime[j]; }
  }

  // grille des arêtes (pour accrocher départ et arrivée à la bonne chaussée, dans le bon sens)
  const sax = new Float32Array(m), saz = new Float32Array(m), sbx = new Float32Array(m), sbz = new Float32Array(m);
  for (let j = 0; j < m; j++) { sax[j] = X[eA[j]]; saz[j] = Z[eA[j]]; sbx[j] = X[eB[j]]; sbz[j] = Z[eB[j]]; }
  const grid = buildGrid({ n: m, ax: sax, az: saz, bx: sbx, bz: sbz }, cell);

  /** Jusqu'à `max` arêtes les plus proches de (x, z) : [{ j, t, d, px, pz }], la meilleure d'abord. */
  function nearestEdges(x, z, eleHint, component, max = 4, maxDist = 2500) {
    const out = [];
    const useEle = Number.isFinite(eleHint);
    let worst = maxDist;
    grid.visit(x, z, maxDist, (j, best) => {
      if (component >= 0 && comp[eA[j]] !== component) return best;
      const dx = sbx[j] - sax[j], dz = sbz[j] - saz[j];
      let t = ((x - sax[j]) * dx + (z - saz[j]) * dz) / (dx * dx + dz * dz || 1);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = sax[j] + dx * t, pz = saz[j] + dz * t;
      let d = Math.hypot(x - px, z - pz);
      if (useEle) d += Math.abs(E[eA[j]] + (E[eB[j]] - E[eA[j]]) * t - eleHint) * ELE_WEIGHT;
      if (d >= worst) return best;
      for (let k = 0; k < out.length; k++) if (out[k].j === j) return best; // arête à cheval sur plusieurs cellules
      out.push({ j, t, d, px, pz });
      out.sort((p, q) => p.d - q.d);
      if (out.length > max) out.length = max;
      // on ne garde que les arêtes quasi aussi proches que la meilleure (les deux sens d'une rue, un carrefour)
      const lim = out[0].d + 14;
      while (out.length > 1 && out[out.length - 1].d > lim) out.pop();
      worst = out.length >= max ? out[out.length - 1].d : Math.min(maxDist, lim);
      // borne d'arrêt de la recherche par anneaux : la plus mauvaise distance encore acceptable
      return worst;
    });
    return out;
  }

  const g = new Float32Array(n);
  const from = new Int32Array(n);
  const stamp = new Uint32Array(n);
  const closed = new Uint32Array(n);
  const goalCost = new Float32Array(n);
  const goalStamp = new Uint32Array(n);
  const goalEdge = new Int32Array(n);
  const heap = new Heap(Math.max(64, m + 16));
  let run = 0;

  function route(ax, az, bx, bz, opts = {}) {
    const t0 = now();
    const air = Math.hypot(bx - ax, bz - az);
    const straight = (extra = {}) => ({ path: [[ax, az], [bx, bz]], length: air, time: air / 8, routed: false, partial: false, ms: now() - t0, ...extra });
    if (!n || !m || air < 30) return straight();
    const byTime = opts.metric !== 'distance';
    const budget = opts.budgetMs ?? 30;
    const goals = nearestEdges(bx, bz, opts.toEle, -1);
    if (!goals.length) return straight();
    const component = comp[eA[goals[0].j]];
    const starts = nearestEdges(ax, az, opts.fromEle, component);
    if (!starts.length) return straight();

    run++;
    heap.clear();
    const hScale = byTime ? 1 / vmax : 1;
    const h = (i) => Math.hypot(X[i] - bx, Z[i] - bz) * hScale;
    const WALK = byTime ? 1 / 2.5 : 1; // rejoindre / quitter la chaussée (à pied ou hors-piste)
    // arrivées : on termine sur le nœud d'entrée de l'arête visée, puis on roule jusqu'au point projeté
    for (const gl of goals) {
      const a = eA[gl.j];
      const c = gl.t * (byTime ? eTime[gl.j] : eLen[gl.j]) + gl.d * WALK;
      if (goalStamp[a] !== run || c < goalCost[a]) { goalStamp[a] = run; goalCost[a] = c; goalEdge[a] = goals.indexOf(gl); }
    }
    // départs : on rejoint le nœud de sortie de l'arête où l'on se trouve
    for (const st of starts) {
      const b = eB[st.j];
      const c = (1 - st.t) * (byTime ? eTime[st.j] : eLen[st.j]) + st.d * WALK;
      if (stamp[b] !== run || c < g[b]) { g[b] = c; from[b] = -1; stamp[b] = run; heap.push(c + h(b), b); }
    }
    // cas particulier : départ et arrivée sur la même arête, arrivée devant
    for (const st of starts) for (const gl of goals) {
      if (st.j === gl.j && gl.t >= st.t) {
        const len = Math.hypot(gl.px - st.px, gl.pz - st.pz);
        const path = [[ax, az], [st.px, st.pz], [gl.px, gl.pz], [bx, bz]];
        return { path, length: st.d + len + gl.d, time: len / (eLen[st.j] / eTime[st.j]), routed: true, partial: false, ms: now() - t0 };
      }
    }

    let found = -1, bestNode = -1, bestH = Infinity, pops = 0, partial = false;
    let bestGoal = -1, bestGoalCost = Infinity;
    while (heap.n) {
      const u = heap.pop();
      if (closed[u] === run) continue;
      closed[u] = run;
      const gu = g[u];
      if (bestGoal >= 0 && gu + h(u) >= bestGoalCost) { found = bestGoal; break; } // plus rien de mieux à trouver
      if (goalStamp[u] === run) {
        const c = gu + goalCost[u];
        if (c < bestGoalCost) { bestGoalCost = c; bestGoal = u; }
      }
      const hu = h(u);
      if (hu < bestH) { bestH = hu; bestNode = u; }
      if ((++pops & 2047) === 0 && now() - t0 > budget) { partial = true; break; }
      for (let j = off[u]; j < off[u + 1]; j++) {
        const v = adjTo[j];
        if (closed[v] === run) continue;
        const ng = gu + (byTime ? adjTime[j] : adjLen[j]);
        if (stamp[v] !== run || ng < g[v]) { g[v] = ng; from[v] = u; stamp[v] = run; heap.push(ng + h(v), v); }
      }
    }
    if (found < 0 && bestGoal >= 0) found = bestGoal;
    const end = found >= 0 ? found : bestNode;
    if (end < 0) return straight();
    partial = found < 0;

    const mid = [];
    for (let u = end; u >= 0; u = from[u]) mid.push(u);
    mid.reverse();
    const path = [[ax, az]];
    // point d'accroche sur la chaussée de départ
    const first = mid[0];
    let st = starts[0];
    for (const s of starts) if (eB[s.j] === first) { st = s; break; }
    if (st.d > 3) path.push([st.px, st.pz, E[eA[st.j]] + (E[eB[st.j]] - E[eA[st.j]]) * st.t]);
    for (const u of mid) path.push([X[u], Z[u], E[u]]);
    if (!partial) {
      const gl = goals[goalEdge[end]];
      if (gl && (gl.t > 0.02 || gl.d > 3)) path.push([gl.px, gl.pz, E[eA[gl.j]] + (E[eB[gl.j]] - E[eA[gl.j]]) * gl.t]);
    }
    path.push([bx, bz]);
    let length = 0;
    for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    const time = partial ? g[end] + bestH : bestGoalCost;
    return { path, length, time: byTime ? time : length / 10, routed: true, partial, ms: now() - t0, expanded: pops };
  }

  /** Nœud du graphe le plus proche (compatibilité). */
  function nearestNode(x, z) {
    const e = nearestEdges(x, z, undefined, -1, 1);
    if (!e.length) return -1;
    return e[0].t < 0.5 ? eA[e[0].j] : eB[e[0].j];
  }

  return { route, nearestNode, nodeCount: n, edgeCount: gEdges.length, directed, vmax };
}

/** Projection d'un point sur une polyligne : { index (segment), t, dist, x, z }. */
export function projectOnPath(path, x, z, fromIndex = 0) {
  let best = { index: 0, t: 0, dist: Infinity, x: path[0]?.[0] ?? x, z: path[0]?.[1] ?? z };
  for (let i = Math.max(0, fromIndex); i < path.length - 1; i++) {
    const ax = path[i][0], az = path[i][1], dx = path[i + 1][0] - ax, dz = path[i + 1][1] - az;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.dist) best = { index: i, t, dist: d, x: px, z: pz };
  }
  return best;
}

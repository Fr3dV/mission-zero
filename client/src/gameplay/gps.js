// GPS : index spatial des chaussées + recherche d'itinéraire A* sur worldData.graph.
// JS pur (aucune dépendance Three/DOM) : testable sous Node.
// Si worldData.meta.graphDirected est vrai, le graphe est orienté (sens uniques respectés, chaque double sens
// fournit ses deux arêtes) ; sinon chaque arête est parcourue dans les deux sens.

const yawOf = (dx, dz) => Math.atan2(-dx, -dz); // avant = (-sin yaw, -cos yaw)

/** Index des segments de chaussée : point de route le plus proche. */
export function createRoadIndex(worldData, cell = 120) {
  const roads = worldData?.roads || [];
  const grid = new Map();
  const segs = []; // [ax, az, bx, bz, roadIndex]
  const key = (cx, cz) => cx * 100003 + cz;
  for (let ri = 0; ri < roads.length; ri++) {
    const pts = roads[ri].points || [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      if (ax === bx && az === bz) continue;
      const si = segs.length;
      segs.push([ax, az, bx, bz, ri]);
      const x0 = Math.floor(Math.min(ax, bx) / cell), x1 = Math.floor(Math.max(ax, bx) / cell);
      const z0 = Math.floor(Math.min(az, bz) / cell), z1 = Math.floor(Math.max(az, bz) / cell);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz);
        let a = grid.get(k);
        if (!a) grid.set(k, (a = []));
        a.push(si);
      }
    }
  }

  /**
   * @returns {{x,z,yaw,road,dist,side}|null} point de l'axe de chaussée le plus proche ;
   *   side = +1 si (x,z) est à droite du sens de la route, -1 à gauche.
   */
  function nearest(x, z, maxDist = 400, filter = null) {
    if (!segs.length) return null;
    const cx0 = Math.floor(x / cell), cz0 = Math.floor(z / cell);
    const maxRing = Math.ceil(maxDist / cell) + 1;
    let best = null, bd = maxDist;
    for (let ring = 0; ring <= maxRing; ring++) {
      if (best && (ring - 1) * cell > bd) break;
      for (let cx = cx0 - ring; cx <= cx0 + ring; cx++) for (let cz = cz0 - ring; cz <= cz0 + ring; cz++) {
        if (Math.max(Math.abs(cx - cx0), Math.abs(cz - cz0)) !== ring) continue;
        const a = grid.get(key(cx, cz));
        if (!a) continue;
        for (const si of a) {
          const s = segs[si];
          if (filter && !filter(roads[s[4]])) continue;
          const dx = s[2] - s[0], dz = s[3] - s[1];
          const l2 = dx * dx + dz * dz;
          let t = ((x - s[0]) * dx + (z - s[1]) * dz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = s[0] + dx * t, pz = s[1] + dz * t;
          const d = Math.hypot(x - px, z - pz);
          if (d < bd) {
            bd = d;
            const l = Math.sqrt(l2);
            // produit vectoriel : côté du point par rapport au sens du segment (droite = +1)
            const cross = dx * (z - s[1]) - dz * (x - s[0]);
            best = { x: px, z: pz, yaw: yawOf(dx, dz), road: roads[s[4]], dist: d, side: cross >= 0 ? 1 : -1, dirX: dx / l, dirZ: dz / l };
          }
        }
      }
    }
    return best;
  }

  return { nearest, count: segs.length };
}

/** Tas binaire minimal (clé flottante, valeur entière). */
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
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
    const lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n) {
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

/** Routeur A* sur le graphe routier (non orienté). */
export function createRouter(worldData, cell = 150) {
  const nodes = worldData?.graph?.nodes || [];
  const edges = worldData?.graph?.edges || [];
  const n = nodes.length;
  // listes d'adjacence compactes (CSR)
  const deg = new Uint32Array(n + 1);
  // meta.graphDirected : les voies à double sens fournissent déjà les deux arêtes -> on garde le sens réel
  const directed = !!worldData?.meta?.graphDirected;
  for (const e of edges) { if (e[0] < n && e[1] < n && e[0] !== e[1]) { deg[e[0]]++; if (!directed) deg[e[1]]++; } }
  const off = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + deg[i];
  const adj = new Uint32Array(off[n]);
  const cost = new Float32Array(off[n]);
  const fill = new Uint32Array(n);
  for (const e of edges) {
    const a = e[0], b = e[1];
    if (!(a < n && b < n) || a === b) continue;
    const d = Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]);
    adj[off[a] + fill[a]] = b; cost[off[a] + fill[a]++] = d;
    if (!directed) { adj[off[b] + fill[b]] = a; cost[off[b] + fill[b]++] = d; }
  }
  // composantes connexes : pour ne viser que des nœuds joignables entre eux
  let radj = null;
  if (directed) { radj = Array.from({ length: n }, () => []); for (const e of edges) if (e[0] < n && e[1] < n && e[0] !== e[1]) radj[e[1]].push(e[0]); }
  const comp = new Int32Array(n).fill(-1);
  const compSize = [];
  for (let i = 0, c = 0; i < n; i++) {
    if (comp[i] >= 0 || off[i + 1] === off[i]) continue;
    const stack = [i]; comp[i] = c; let size = 0;
    while (stack.length) {
      const u = stack.pop(); size++;
      for (let j = off[u]; j < off[u + 1]; j++) { const v = adj[j]; if (comp[v] < 0) { comp[v] = c; stack.push(v); } }
      if (directed && radj) for (const v of radj[u]) if (comp[v] < 0) { comp[v] = c; stack.push(v); }
    }
    compSize[c++] = size;
  }
  // grille des nœuds
  const grid = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  for (let i = 0; i < n; i++) {
    if (comp[i] < 0) continue;
    const k = key(Math.floor(nodes[i][0] / cell), Math.floor(nodes[i][1] / cell));
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  }

  function nearestNode(x, z, component = -1, maxDist = 1500) {
    const cx0 = Math.floor(x / cell), cz0 = Math.floor(z / cell);
    const maxRing = Math.ceil(maxDist / cell) + 1;
    let best = -1, bd = maxDist;
    for (let ring = 0; ring <= maxRing; ring++) {
      if (best >= 0 && (ring - 1) * cell > bd) break;
      for (let cx = cx0 - ring; cx <= cx0 + ring; cx++) for (let cz = cz0 - ring; cz <= cz0 + ring; cz++) {
        if (Math.max(Math.abs(cx - cx0), Math.abs(cz - cz0)) !== ring) continue;
        const a = grid.get(key(cx, cz));
        if (!a) continue;
        for (const i of a) {
          if (component >= 0 && comp[i] !== component) continue;
          const d = Math.hypot(nodes[i][0] - x, nodes[i][1] - z);
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return best;
  }

  const g = new Float32Array(n);
  const from = new Int32Array(n);
  const stamp = new Uint32Array(n);
  const closed = new Uint32Array(n);
  let run = 0;

  /**
   * Itinéraire de (ax,az) à (bx,bz).
   * @returns {{path: number[][], length: number, routed: boolean}} path inclut les deux extrémités.
   */
  function route(ax, az, bx, bz) {
    const straight = () => ({ path: [[ax, az], [bx, bz]], length: Math.hypot(bx - ax, bz - az), routed: false });
    if (!n || !adj.length) return straight();
    if (Math.hypot(bx - ax, bz - az) < 30) return straight();
    const goal = nearestNode(bx, bz);
    if (goal < 0) return straight();
    let start = nearestNode(ax, az, comp[goal]);
    if (start < 0) return straight();
    if (start === goal) return straight();
    run++;
    const heap = new Heap();
    const gx = nodes[goal][0], gz = nodes[goal][1];
    g[start] = 0; from[start] = -1; stamp[start] = run;
    heap.push(Math.hypot(nodes[start][0] - gx, nodes[start][1] - gz), start);
    let found = false;
    while (heap.size) {
      const u = heap.pop();
      if (u === goal) { found = true; break; }
      if (closed[u] === run) continue;
      closed[u] = run;
      const gu = g[u];
      for (let j = off[u]; j < off[u + 1]; j++) {
        const v = adj[j];
        if (closed[v] === run) continue;
        const ng = gu + cost[j];
        if (stamp[v] !== run || ng < g[v]) {
          g[v] = ng; from[v] = u; stamp[v] = run;
          heap.push(ng + Math.hypot(nodes[v][0] - gx, nodes[v][1] - gz), v);
        }
      }
    }
    if (!found) return straight();
    const mid = [];
    for (let u = goal; u >= 0; u = from[u]) mid.push(nodes[u]);
    mid.reverse();
    // évite le demi-tour initial/final quand le nœud le plus proche est « derrière »
    if (mid.length >= 2 && Math.hypot(mid[1][0] - ax, mid[1][1] - az) < Math.hypot(mid[1][0] - mid[0][0], mid[1][1] - mid[0][1])) mid.shift();
    if (mid.length >= 2) {
      const l = mid.length;
      if (Math.hypot(mid[l - 2][0] - bx, mid[l - 2][1] - bz) < Math.hypot(mid[l - 2][0] - mid[l - 1][0], mid[l - 2][1] - mid[l - 1][1])) mid.pop();
    }
    const path = [[ax, az], ...mid.map((p) => [p[0], p[1]]), [bx, bz]];
    let length = 0;
    for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    return { path, length, routed: true };
  }

  radj = null;
  return { route, nearestNode, nodeCount: n, edgeCount: edges.length, components: compSize.length, directed };
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

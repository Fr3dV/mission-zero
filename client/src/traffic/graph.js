// Trafic — préparation du graphe routier (worldData.graph) en tableaux typés.
//
// Chaque arête non orientée « e » donne deux demi-arêtes : h = 2e (sens A→B) et h = 2e+1 (sens B→A) ;
// la jumelle de h est h ^ 1. Une demi-arête est « roulable » (hDrive) si les voitures peuvent l'emprunter
// dans ce sens. Les piétons utilisent toutes les demi-arêtes.
//
// Tolérances : arêtes dégénérées ou en double ignorées, roadId inconnu → rue par défaut, graphe orienté
// (meta) ou non, culs-de-sac et composantes isolées acceptés.

export const KIND_STREET = 0, KIND_AVENUE = 1, KIND_BOULEVARD = 2, KIND_QUAY = 3, KIND_PEDESTRIAN = 4;
const KIND_ID = { street: KIND_STREET, avenue: KIND_AVENUE, boulevard: KIND_BOULEVARD, quay: KIND_QUAY, pedestrian: KIND_PEDESTRIAN };
// Vitesses de croisière (m/s) : ≈ 30–50 km/h en ville.
const KIND_SPEED = [9.4, 13.6, 13.2, 12.5, 0];
const DEFAULT_ROAD = { id: 0, name: '', kind: 'street', width: 8, lanes: 2, oneway: false, bridge: false, points: null };
const CELL = 64;

/** Le graphe est-il orienté (une arête = un sens de circulation) ? Lu dans meta, sous plusieurs orthographes possibles. */
function isDirected(worldData) {
  const m = worldData.meta || {}, g = worldData.graph || {};
  const cands = [g.directed, m.directed, m.graph && m.graph.directed, m.graphDirected];
  for (const c of cands) if (typeof c === 'boolean') return c;
  return false;
}

/** Pour une rue à sens unique d'un graphe non orienté : l'arête a→b suit-elle l'ordre des points de la rue ? */
function followsRoad(road, ax, az, bx, bz) {
  const pts = road.points;
  if (!pts || pts.length < 2) return true;
  let ia = 0, ib = 0, da = Infinity, db = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const px = pts[i][0], pz = pts[i][1];
    const d1 = (px - ax) * (px - ax) + (pz - az) * (pz - az);
    const d2 = (px - bx) * (px - bx) + (pz - bz) * (pz - bz);
    if (d1 < da) { da = d1; ia = i; }
    if (d2 < db) { db = d2; ib = i; }
  }
  if (ia === ib) {
    // Même point le plus proche : on tranche avec la direction locale de la rue.
    const i0 = Math.max(0, Math.min(pts.length - 2, ia === pts.length - 1 ? ia - 1 : ia));
    const dx = pts[i0 + 1][0] - pts[i0][0], dz = pts[i0 + 1][1] - pts[i0][1];
    return dx * (bx - ax) + dz * (bz - az) >= 0;
  }
  const last = pts.length - 1;
  const closed = Math.abs(pts[0][0] - pts[last][0]) + Math.abs(pts[0][1] - pts[last][1]) < 1;
  if (closed && Math.abs(ia - ib) > last / 2) return ia > ib; // boucle (rond-point) : le saut passe par la fermeture
  return ia < ib;
}

export function buildGraph(worldData) {
  const src = worldData.graph || { nodes: [], edges: [] };
  const nodes = src.nodes || [], edges = src.edges || [];
  const N = nodes.length;
  const directed = isDirected(worldData);
  const roadById = new Map();
  for (const r of worldData.roads || []) roadById.set(r.id, r);

  const nx = new Float32Array(N), nz = new Float32Array(N);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    const p = nodes[i]; const x = +p[0] || 0, z = +p[1] || 0;
    nx[i] = x; nz[i] = z;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!N) { minX = minZ = 0; maxX = maxZ = 1; }

  const E0 = edges.length;
  const hFrom = new Int32Array(E0 * 2), hTo = new Int32Array(E0 * 2);
  const hUx = new Float32Array(E0 * 2), hUz = new Float32Array(E0 * 2), hLen = new Float32Array(E0 * 2);
  const hDrive = new Uint8Array(E0 * 2), hLanes = new Uint8Array(E0 * 2), hKind = new Uint8Array(E0 * 2);
  const hOff0 = new Float32Array(E0 * 2), hLaneW = new Float32Array(E0 * 2);
  const hSpeed = new Float32Array(E0 * 2), hWidth = new Float32Array(E0 * 2), hWalk = new Float32Array(E0 * 2);
  const eRoad = new Array(E0);
  const seen = new Map();
  let E = 0;

  for (let k = 0; k < E0; k++) {
    const ed = edges[k];
    if (!ed) continue;
    const a = ed[0] | 0, b = ed[1] | 0;
    if (a === b || a < 0 || b < 0 || a >= N || b >= N) continue;
    const dx = nx[b] - nx[a], dz = nz[b] - nz[a];
    const len = Math.hypot(dx, dz);
    if (!(len > 0.5)) continue;
    const road = roadById.get(ed[2]) || DEFAULT_ROAD;
    const kind = KIND_ID[road.kind] ?? KIND_STREET;
    const drivable = kind !== KIND_PEDESTRIAN;
    const key = a < b ? a * N + b : b * N + a;
    let e = seen.get(key);
    if (e !== undefined) {
      // Arête déjà vue : dans un graphe orienté, le sens inverse d'un double sens.
      if (directed && drivable) hDrive[hFrom[2 * e] === a ? 2 * e : 2 * e + 1] = 1;
      continue;
    }
    e = E++; seen.set(key, e);
    eRoad[e] = road;
    const h0 = 2 * e, h1 = h0 + 1;
    hFrom[h0] = a; hTo[h0] = b; hFrom[h1] = b; hTo[h1] = a;
    hUx[h0] = dx / len; hUz[h0] = dz / len; hUx[h1] = -dx / len; hUz[h1] = -dz / len;
    hLen[h0] = hLen[h1] = len;
    hKind[h0] = hKind[h1] = kind;
    const width = Math.max(3, +road.width || 8);
    hWidth[h0] = hWidth[h1] = width;
    // Trottoir : au-delà de la chaussée ; dans une rue piétonne on marche sur la chaussée elle-même.
    hWalk[h0] = hWalk[h1] = kind === KIND_PEDESTRIAN ? Math.max(0.8, width / 2 - 1.2) : width / 2 + 1.5;
    if (drivable) {
      if (directed) hDrive[h0] = 1;
      else if (road.oneway) {
        if (followsRoad(road, nx[a], nz[a], nx[b], nz[b])) hDrive[h0] = 1; else hDrive[h1] = 1;
      } else { hDrive[h0] = 1; hDrive[h1] = 1; }
    }
  }

  // Voies : décalage latéral (vers la droite du sens de marche) de la voie i = hOff0 + i * hLaneW.
  for (let e = 0; e < E; e++) {
    const road = eRoad[e], h0 = 2 * e, h1 = h0 + 1;
    const width = hWidth[h0], lanes = Math.max(1, road.lanes | 0 || 1);
    const twoWay = hDrive[h0] && hDrive[h1];
    let base = KIND_SPEED[hKind[h0]];
    if (hKind[h0] === KIND_STREET && width < 7) base = 8.3;
    if (twoWay) {
      let n = Math.max(1, lanes >> 1);
      while (n > 1 && width / 2 / n < 2.6) n--;
      const lw = Math.min(3.4, Math.max(2.1, width / 2 / n));
      for (const h of [h0, h1]) { hLanes[h] = n; hLaneW[h] = lw; hOff0[h] = lw * 0.5; hSpeed[h] = base; }
    } else {
      let n = lanes;
      while (n > 1 && width / n < 2.6) n--;
      n = Math.min(n, 4);
      const lw = Math.min(3.4, width / n);
      for (const h of [h0, h1]) { hLanes[h] = n; hLaneW[h] = lw; hOff0[h] = -(n - 1) * lw * 0.5; hSpeed[h] = base; }
    }
  }

  // Liste d'adjacence (CSR) : demi-arêtes sortantes de chaque nœud.
  const outStart = new Int32Array(N + 1);
  for (let h = 0; h < 2 * E; h++) outStart[hFrom[h] + 1]++;
  for (let i = 0; i < N; i++) outStart[i + 1] += outStart[i];
  const outList = new Int32Array(2 * E), fill = new Int32Array(N);
  for (let h = 0; h < 2 * E; h++) { const n = hFrom[h]; outList[outStart[n] + fill[n]++] = h; }

  // Carrefours (≥ 3 voisins) : rayon ≈ demi-largeur de la plus grosse rue, verrou de priorité.
  const nodeJunction = new Uint8Array(N), nodeRadius = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const deg = outStart[i + 1] - outStart[i];
    if (deg < 3) continue;
    let drive = 0, r = 0;
    for (let k = outStart[i]; k < outStart[i + 1]; k++) {
      const h = outList[k];
      if (hDrive[h] || hDrive[h ^ 1]) { drive++; if (hWidth[h] > r) r = hWidth[h]; }
    }
    if (drive >= 3) { nodeJunction[i] = 1; nodeRadius[i] = Math.min(14, r * 0.5); }
  }

  // Grille spatiale des arêtes (CSR), pour tirer des points d'apparition autour du joueur.
  const cols = Math.max(1, Math.ceil((maxX - minX) / CELL) + 1), rows = Math.max(1, Math.ceil((maxZ - minZ) / CELL) + 1);
  const cellStart = new Int32Array(cols * rows + 1);
  const walk = (cb) => {
    for (let e = 0; e < E; e++) {
      const h = 2 * e, len = hLen[h], steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
      let last = -1;
      for (let k = 0; k <= steps; k++) {
        const s = (len * k) / steps;
        const cx = Math.floor((nx[hFrom[h]] + hUx[h] * s - minX) / CELL), cz = Math.floor((nz[hFrom[h]] + hUz[h] * s - minZ) / CELL);
        const c = cz * cols + cx;
        if (c !== last) { cb(c, e); last = c; }
      }
    }
  };
  walk((c) => { cellStart[c + 1]++; });
  for (let i = 0; i < cols * rows; i++) cellStart[i + 1] += cellStart[i];
  const cellItems = new Int32Array(cellStart[cols * rows]), cfill = new Int32Array(cols * rows);
  walk((c, e) => { cellItems[cellStart[c] + cfill[c]++] = e; });

  // Chaussées séparées trop proches (boulevards, grandes places : deux sens uniques dont les largeurs se
  // chevauchent dans les données) : on rabote les voies de gauche pour ne pas rouler dans le sens d'en face.
  for (let e = 0; e < E; e++) {
    const h = hDrive[2 * e] ? 2 * e : 2 * e + 1;
    if (!hDrive[h] || hDrive[h ^ 1] || hLanes[h] < 2) continue;
    const W = hWidth[h], ux = hUx[h], uz = hUz[h], len = hLen[h];
    let leftAvail = W / 2;
    for (let k = 1; k <= 3; k++) {
      const mx = nx[hFrom[h]] + ux * len * k * 0.25, mz = nz[hFrom[h]] + uz * len * k * 0.25;
      const cx0 = Math.max(0, Math.floor((mx - W - minX) / CELL)), cx1 = Math.min(cols - 1, Math.floor((mx + W - minX) / CELL));
      const cz0 = Math.max(0, Math.floor((mz - W - minZ) / CELL)), cz1 = Math.min(rows - 1, Math.floor((mz + W - minZ) / CELL));
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * cols + cx;
        for (let i = cellStart[c]; i < cellStart[c + 1]; i++) {
          const e2 = cellItems[i], g = 2 * e2;
          if (e2 === e || !(hDrive[g] || hDrive[g + 1])) continue;
          const twoWay2 = hDrive[g] && hDrive[g + 1];
          const dot = ux * hUx[g] + uz * hUz[g];
          // en face = antiparallèle (ou double sens à peu près parallèle)
          if (twoWay2 ? Math.abs(dot) < 0.7 : (hDrive[g] ? dot : -dot) > -0.7) continue;
          let s = (mx - nx[hFrom[g]]) * hUx[g] + (mz - nz[hFrom[g]]) * hUz[g];
          s = Math.max(0, Math.min(hLen[g], s));
          const qx = nx[hFrom[g]] + hUx[g] * s - mx, qz = nz[hFrom[g]] + hUz[g] * s - mz;
          const lat = qx * uz - qz * ux, lon = qx * ux + qz * uz; // lat > 0 = à gauche
          if (Math.abs(lon) > 3 || lat < 1 || lat > (W + hWidth[g]) / 2) continue;
          const share = lat * W / (W + hWidth[g]) - 0.15;
          if (share < leftAvail) leftAvail = share;
        }
      }
    }
    if (leftAvail >= W / 2) continue;
    leftAvail = Math.max(1.2, leftAvail);
    const total = leftAvail + W / 2;
    const n = Math.max(1, Math.min(hLanes[h], Math.floor(total / 2.6)));
    const lw = Math.min(3.4, total / n);
    hLanes[h] = hLanes[h ^ 1] = n; hLaneW[h] = hLaneW[h ^ 1] = lw;
    hOff0[h] = hOff0[h ^ 1] = W / 2 - n * lw + lw / 2; // voies calées contre le bord droit
  }

  const G = {
    directed, nodeCount: N, edgeCount: E, hCount: 2 * E,
    nx, nz, hFrom, hTo, hUx, hUz, hLen, hDrive, hLanes, hKind, hOff0, hLaneW, hSpeed, hWidth, hWalk, eRoad,
    outStart, outList, nodeJunction, nodeRadius,
    // Verrous de carrefour (voir cars.js).
    lockIn: new Int32Array(N).fill(-1), lockOut: new Int32Array(N).fill(-1), lockCnt: new Int16Array(N),
    lockT: new Float32Array(N), lockGen: new Int32Array(N),
    minX, minZ, cols, rows, cellStart, cellItems, CELL,

    /** Point sur une demi-arête, à l'abscisse s, décalé de `off` mètres vers la droite du sens de marche. */
    pointX(h, s, off) { return nx[hFrom[h]] + hUx[h] * s - hUz[h] * off; },
    pointZ(h, s, off) { return nz[hFrom[h]] + hUz[h] * s + hUx[h] * off; },
    /** Cap (yaw) d'une direction (ux, uz) : avant = (-sin yaw, -cos yaw). */
    yawOf(ux, uz) { return Math.atan2(-ux, -uz); },

    /**
     * Tire une arête au hasard dans l'anneau [rMin, rMax] autour de (x, z). Écrit out.e, out.s, out.x, out.z.
     * @returns {boolean} false si rien trouvé cette fois (à retenter plus tard).
     */
    randomEdgeNear(x, z, rMin, rMax, out, tries = 6) {
      if (!E) return false;
      for (let t = 0; t < tries; t++) {
        const ang = Math.random() * Math.PI * 2, r = Math.sqrt(rMin * rMin + Math.random() * (rMax * rMax - rMin * rMin));
        const px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
        const cx = Math.floor((px - minX) / CELL), cz = Math.floor((pz - minZ) / CELL);
        if (cx < 0 || cz < 0 || cx >= cols || cz >= rows) continue;
        const c = cz * cols + cx, n = cellStart[c + 1] - cellStart[c];
        if (!n) continue;
        const e = cellItems[cellStart[c] + ((Math.random() * n) | 0)], h = 2 * e;
        // Projection du point tiré sur l'arête, avec un peu d'aléa le long de celle-ci.
        let s = (px - nx[hFrom[h]]) * hUx[h] + (pz - nz[hFrom[h]]) * hUz[h] + (Math.random() - 0.5) * CELL * 0.5;
        s = Math.max(0, Math.min(hLen[h], s));
        const qx = nx[hFrom[h]] + hUx[h] * s, qz = nz[hFrom[h]] + hUz[h] * s;
        const d2 = (qx - x) * (qx - x) + (qz - z) * (qz - z);
        if (d2 < rMin * rMin || d2 > rMax * rMax) continue;
        out.e = e; out.s = s; out.x = qx; out.z = qz;
        return true;
      }
      return false;
    },
  };
  return G;
}

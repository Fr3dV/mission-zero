// Trafic — préparation du graphe routier (worldData.graph) en tableaux typés, pour n'importe quelle ville.
//
// Chaque arête non orientée « e » donne deux demi-arêtes : h = 2e (sens A→B) et h = 2e+1 (sens B→A) ;
// la jumelle de h est h ^ 1. Une demi-arête est « roulable » (hDrive) si les voitures peuvent l'emprunter
// dans ce sens. Les piétons utilisent les demi-arêtes « marchables » (hFlag & F_WALK).
//
// Échelle : conçu pour ~100 000 nœuds / 200 000 arêtes (Toulouse) : aucune structure par arête autre que des
// tableaux typés, détection des doubles sens par table de hachage en Int32Array, adjacence et grille spatiale
// en CSR, aucune boucle en O(n²). G.buildMs et G.bytes donnent le temps de construction et la mémoire occupée.
//
// Niveaux superposés : nodeEle[i] = élévation du nœud au-dessus du relief de base (pont +, trémie −) ;
// l'élévation le long d'une demi-arête est interpolée linéairement (G.eleAt).
//
// Tolérances : arêtes dégénérées ou en double ignorées, roadId inconnu → rue par défaut, graphe orienté
// (meta.graphDirected) ou non, culs-de-sac et composantes isolées acceptés, champs optionnels absents.

export const KIND_STREET = 0, KIND_AVENUE = 1, KIND_BOULEVARD = 2, KIND_QUAY = 3, KIND_PEDESTRIAN = 4,
  KIND_RAMP = 5, KIND_TRUNK = 6, KIND_MOTORWAY = 7;
const KIND_ID = { street: KIND_STREET, avenue: KIND_AVENUE, boulevard: KIND_BOULEVARD, quay: KIND_QUAY, pedestrian: KIND_PEDESTRIAN, ramp: KIND_RAMP, trunk: KIND_TRUNK, motorway: KIND_MOTORWAY };
// Vitesses de croisière par défaut (m/s) quand la route n'a pas de maxspeed.
const KIND_SPEED = [9.4, 13.6, 13.2, 12.5, 0, 16.5, 24.5, 30];
// Rang de priorité aux convergences sans feu : autoroute > voie rapide > grands axes > rues > bretelles.
const KIND_RANK = [2, 3, 3, 3, 0, 1, 4, 5];
// Poids de densité du trafic automobile par type de voie (0..1).
const KIND_CARS = [0.34, 0.75, 0.75, 0.6, 0, 0.5, 0.9, 1];

/** Drapeaux de demi-arête (hFlag). */
export const F_ROUND = 1, F_TUNNEL = 2, F_BRIDGE = 4, F_FAST = 8, F_WALK = 16, F_ELEV = 32,
  F_SERVICE = 64,  // voie de desserte (parking, zone d'activité, aéroport) : pas de transit, au pas
  F_NOAI = 128,    // aucune voiture IA (voies de l'aéroport côté pistes) — posé par index.js d'après les zones
  F_UTURN = 256;   // boucle de demi-tour au bord de la carte : les voitures IA y sont recyclées
/** Type de contrôle d'un nœud (nodeCtl) : 0 = aucun, 1 = réservation (carrefour urbain), 2 = céder le passage (giratoire, convergence de voies rapides). */
export const CTL_NONE = 0, CTL_LOCK = 1, CTL_YIELD = 2;

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
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const src = worldData.graph || { nodes: [], edges: [] };
  const nodes = src.nodes || [], edges = src.edges || [], srcEle = src.nodeEle || null;
  const N = nodes.length, E0 = edges.length;
  const directed = isDirected(worldData);
  let bytes = 0;
  const F32 = (n) => { bytes += n * 4; return new Float32Array(n); };
  const I32 = (n) => { bytes += n * 4; return new Int32Array(n); };
  const U8 = (n) => { bytes += n; return new Uint8Array(n); };

  // ---- nœuds
  const nx = F32(N), nz = F32(N), nodeEle = F32(N);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, hasEle = false;
  for (let i = 0; i < N; i++) {
    const p = nodes[i]; const x = +p[0] || 0, z = +p[1] || 0;
    nx[i] = x; nz[i] = z;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    if (srcEle) { const e = +srcEle[i] || 0; nodeEle[i] = e; if (e > 0.3 || e < -0.3) hasEle = true; }
  }
  if (!N) { minX = minZ = 0; maxX = maxZ = 1; }

  // ---- routes : propriétés mises à plat une fois (pas de lecture d'objet par arête ensuite)
  const roads = worldData.roads || [], R = roads.length;
  const rKind = new Uint8Array(R + 1), rFlag = new Uint16Array(R + 1), rLanes = new Uint8Array(R + 1), rOne = new Uint8Array(R + 1), rCars = new Uint8Array(R + 1);
  const rWidth = new Float32Array(R + 1), rSpeed = new Float32Array(R + 1), rWalk = new Float32Array(R + 1), rNoSw = new Uint8Array(R + 1);
  let maxId = 0, hasFast = false, hasRound = false;
  for (let i = 0; i < R; i++) { const id = roads[i].id | 0; if (id > maxId) maxId = id; }
  // id de route → indice (table directe si les ids sont compacts, sinon Map)
  const direct = maxId <= R * 8 + 1024;
  const idTab = direct ? new Int32Array(maxId + 1).fill(R) : null, idMap = direct ? null : new Map();
  for (let i = 0; i <= R; i++) {
    const r = i < R ? roads[i] : null; // l'indice R = route par défaut (roadId inconnu ou 0)
    const kind = r ? (KIND_ID[r.kind] ?? KIND_STREET) : KIND_STREET;
    const width = Math.max(3, (r && +r.width) || 8);
    let sp = KIND_SPEED[kind];
    const ms = r ? +r.maxspeed || 0 : 0;
    if (ms > 0) sp = (ms / 3.6) * (ms >= 70 ? 0.97 : 0.94);
    if (kind === KIND_STREET) { sp = Math.min(sp, 13); if (width < 7) sp = Math.min(sp, 8.3); } // rues de quartier : 30 km/h
    else if (kind === KIND_RAMP) sp = Math.max(11, sp);
    let flag = 0;
    if (r) {
      if (r.roundabout) { flag |= F_ROUND; sp = Math.min(sp, 9); hasRound = true; }
      if (r.tunnel) flag |= F_TUNNEL;
      if (r.bridge) flag |= F_BRIDGE;
      if (r.service) { flag |= F_SERVICE; sp = Math.min(sp, 4.2); }   // desserte : 15 km/h
      if (r.uturn) { flag |= F_UTURN; sp = Math.min(sp, 9); }
    }
    const fastKind = kind >= KIND_RAMP;
    if (fastKind || sp >= 19) { flag |= F_FAST; hasFast = true; }
    // trottoirs : jamais sur autoroutes, voies rapides, bretelles ni en tunnel
    const sw = r && typeof r.sidewalk === 'number' ? r.sidewalk : r && r.sidewalk === false ? 0 : 3;
    if (!fastKind && !(flag & F_TUNNEL) && kind !== KIND_PEDESTRIAN && sp < 19) flag |= F_WALK;
    rKind[i] = kind; rFlag[i] = flag; rWidth[i] = width; rSpeed[i] = sp;
    rCars[i] = Math.round(255 * (flag & F_SERVICE ? 0.04 : kind === KIND_STREET && width >= 7 ? 0.5 : KIND_CARS[kind]));
    rLanes[i] = Math.max(1, Math.min(12, r ? (r.lanes | 0) || 1 : 2));
    rOne[i] = r && r.oneway ? 1 : 0;
    // axe de marche : milieu du trottoir ; sans trottoir, l'accotement juste au-delà de la chaussée
    rWalk[i] = kind === KIND_PEDESTRIAN ? Math.max(0.8, width / 2 - 1.2) : sw > 0.5 ? width / 2 + Math.max(0.7, Math.min(2.2, sw * 0.5)) : width / 2 + 0.6;
    rNoSw[i] = sw > 0.5 ? 0 : 1;
    if (r) { if (direct) idTab[r.id | 0] = i; else idMap.set(r.id, i); }
  }
  const roadIdx = direct
    ? (id) => (id >= 0 && id <= maxId ? idTab[id] : R)
    : (id) => { const i = idMap.get(id); return i === undefined ? R : i; };

  // ---- passe A : arêtes uniques (table de hachage à adressage ouvert), sens roulables
  let cap = 1024; while (cap < E0 * 2 + 8) cap <<= 1;
  const mask = cap - 1, table = new Int32Array(cap); // valeur = e + 1
  const eA = new Int32Array(E0), eB = new Int32Array(E0), eR = new Int32Array(E0), eDir = new Uint8Array(E0); // bit0 = A→B roulable, bit1 = B→A
  let E = 0;
  for (let k = 0; k < E0; k++) {
    const ed = edges[k];
    if (!ed) continue;
    const a = ed[0] | 0, b = ed[1] | 0;
    if (a === b || a < 0 || b < 0 || a >= N || b >= N) continue;
    const dx = nx[b] - nx[a], dz = nz[b] - nz[a];
    if (!(dx * dx + dz * dz > 0.25)) continue;
    const ri = roadIdx(ed[2] | 0), drivable = rKind[ri] !== KIND_PEDESTRIAN;
    const lo = a < b ? a : b, hi = a < b ? b : a;
    let slot = (Math.imul(lo, 73856093) ^ Math.imul(hi, 19349663)) & mask, e = -1;
    for (;;) {
      const v = table[slot];
      if (v === 0) break;
      const c = v - 1;
      if ((eA[c] === a && eB[c] === b) || (eA[c] === b && eB[c] === a)) { e = c; break; }
      slot = (slot + 1) & mask;
    }
    if (e >= 0) {
      // arête déjà vue : dans un graphe orienté, c'est l'autre sens d'un double sens
      if (directed && drivable) eDir[e] |= eA[e] === a ? 1 : 2;
      continue;
    }
    e = E++; table[slot] = e + 1;
    eA[e] = a; eB[e] = b; eR[e] = ri;
    if (drivable) {
      if (directed) eDir[e] = 1;
      else if (rOne[ri] && ri < R) eDir[e] = followsRoad(roads[ri], nx[a], nz[a], nx[b], nz[b]) ? 1 : 2;
      else eDir[e] = 3;
    }
  }

  // ---- demi-arêtes
  const H = 2 * E;
  const hFrom = I32(H), hTo = I32(H);
  const hUx = F32(H), hUz = F32(H), hLen = F32(H);
  const hDrive = U8(H), hLanes = U8(H), hKind = U8(H), hPrio = U8(H);
  const hFlag = new Uint16Array(H); bytes += H * 2;
  const hOff0 = F32(H), hLaneW = F32(H), hSpeed = F32(H), hWidth = F32(H), hWalk = F32(H);
  const eRoad = I32(E), eCars = U8(E);
  for (let e = 0; e < E; e++) {
    const a = eA[e], b = eB[e], ri = eR[e], h0 = 2 * e, h1 = h0 + 1;
    const dx = nx[b] - nx[a], dz = nz[b] - nz[a], len = Math.sqrt(dx * dx + dz * dz), il = 1 / len;
    hFrom[h0] = a; hTo[h0] = b; hFrom[h1] = b; hTo[h1] = a;
    hUx[h0] = dx * il; hUz[h0] = dz * il; hUx[h1] = -dx * il; hUz[h1] = -dz * il;
    hLen[h0] = hLen[h1] = len;
    eRoad[e] = ri < R ? ri : -1;
    const kind = rKind[ri], width = rWidth[ri], lanes = rLanes[ri], sp = rSpeed[ri];
    let flag = rFlag[ri];
    if (nodeEle[a] > 2 || nodeEle[b] > 2 || nodeEle[a] < -2 || nodeEle[b] < -2) {
      flag |= F_ELEV;
      if (rNoSw[ri]) flag &= ~F_WALK; // ouvrage sans trottoir (pas d'accotement sur un tablier ni dans une trémie) : pas de piétons
    }
    hKind[h0] = hKind[h1] = kind; hFlag[h0] = hFlag[h1] = flag;
    hWidth[h0] = hWidth[h1] = width; hSpeed[h0] = hSpeed[h1] = sp;
    hWalk[h0] = hWalk[h1] = rWalk[ri];
    const d = eDir[e];
    hDrive[h0] = d & 1; hDrive[h1] = (d >> 1) & 1;
    // Voies : décalage latéral (vers la droite du sens de marche) de la voie i = hOff0 + i * hLaneW ; i = 0 à gauche.
    let n, lw, off0;
    if (d === 3) {
      n = Math.max(1, lanes >> 1);
      while (n > 1 && width / 2 / n < 2.6) n--;
      lw = Math.min(3.5, Math.max(2.1, width / 2 / n)); off0 = lw * 0.5;
    } else {
      n = Math.min(lanes, 5);
      while (n > 1 && width / n < 2.6) n--;
      lw = Math.min(3.6, width / n); off0 = -(n - 1) * lw * 0.5;
    }
    hLanes[h0] = hLanes[h1] = n; hLaneW[h0] = hLaneW[h1] = lw; hOff0[h0] = hOff0[h1] = off0;
    eCars[e] = rCars[ri];
  }

  // ---- adjacence (CSR) : demi-arêtes sortantes de chaque nœud
  const outStart = I32(N + 1);
  for (let h = 0; h < H; h++) outStart[hFrom[h] + 1]++;
  for (let i = 0; i < N; i++) outStart[i + 1] += outStart[i];
  const outList = I32(H), fill = new Int32Array(N);
  for (let h = 0; h < H; h++) { const n = hFrom[h]; outList[outStart[n] + fill[n]++] = h; }

  // ---- contrôle des nœuds : réservation (carrefour urbain) ou céder le passage (giratoire, convergence rapide)
  const nodeCtl = U8(N), nodeRadius = F32(N);
  const rankOf = (h) => (hFlag[h] & F_ROUND ? 6 : KIND_RANK[hKind[h]]);
  let nLock = 0, nYield = 0;
  for (let i = 0; i < N; i++) {
    const k0 = outStart[i], k1 = outStart[i + 1];
    if (k1 - k0 < 3) continue;
    let inDeg = 0, outDeg = 0, nb = 0, r = 0, anyRound = false, anyFast = false, anyTwoWay = false, maxRank = 0;
    for (let k = k0; k < k1; k++) {
      const h = outList[k], t = h ^ 1;
      if (!(hDrive[h] || hDrive[t])) continue;
      nb++; if (hWidth[h] > r) r = hWidth[h];
      if (hDrive[h]) outDeg++;
      if (hDrive[t]) { inDeg++; const rk = rankOf(t); if (rk > maxRank) maxRank = rk; }
      if (hDrive[h] && hDrive[t]) anyTwoWay = true;
      if (hFlag[h] & F_ROUND) anyRound = true;
      if (hKind[h] >= KIND_RAMP) anyFast = true;
    }
    if (nb < 3 || inDeg < 2 || outDeg < 1) continue; // simple divergence ou passage : aucun conflit
    const ctl = anyRound || (anyFast && !anyTwoWay) ? CTL_YIELD : CTL_LOCK;
    nodeCtl[i] = ctl; nodeRadius[i] = Math.min(14, r * 0.5);
    if (ctl === CTL_YIELD) {
      nYield++;
      // prioritaire : l'anneau du giratoire, ou la voie de plus haut rang
      for (let k = k0; k < k1; k++) { const t = outList[k] ^ 1; if (hDrive[t] && rankOf(t) === maxRank) hPrio[t] = 1; }
    } else nLock++;
  }

  // ---- grille spatiale des arêtes (CSR)
  const cols = Math.max(1, Math.ceil((maxX - minX) / CELL) + 1), rows = Math.max(1, Math.ceil((maxZ - minZ) / CELL) + 1);
  const cellStart = I32(cols * rows + 1);
  const walk = (cb) => {
    for (let e = 0; e < E; e++) {
      const h = 2 * e, len = hLen[h], steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
      const x0 = nx[hFrom[h]], z0 = nz[hFrom[h]], ux = hUx[h], uz = hUz[h];
      let last = -1;
      for (let k = 0; k <= steps; k++) {
        const s = (len * k) / steps;
        const c = Math.floor((z0 + uz * s - minZ) / CELL) * cols + Math.floor((x0 + ux * s - minX) / CELL);
        if (c !== last) { cb(c, e); last = c; }
      }
    }
  };
  walk((c) => { cellStart[c + 1]++; });
  for (let i = 0; i < cols * rows; i++) cellStart[i + 1] += cellStart[i];
  const cellItems = I32(cellStart[cols * rows]), cfill = new Int32Array(cols * rows);
  walk((c, e) => { cellItems[cellStart[c] + cfill[c]++] = e; });

  // ---- chaussées séparées trop proches (boulevards, grandes places : deux sens uniques dont les largeurs se
  // chevauchent dans les données) : on rabote les voies de gauche pour ne pas rouler dans le sens d'en face.
  for (let e = 0; e < E; e++) {
    const h = hDrive[2 * e] ? 2 * e : 2 * e + 1;
    if (!hDrive[h] || hDrive[h ^ 1] || hLanes[h] < 2) continue;
    const W = hWidth[h], ux = hUx[h], uz = hUz[h], len = hLen[h], ele = nodeEle[hFrom[h]];
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
          if (Math.abs(nodeEle[hFrom[g]] - ele) > 3) continue; // autre niveau
          const twoWay2 = hDrive[g] && hDrive[g + 1];
          const dot = ux * hUx[g] + uz * hUz[g];
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
    const lw = Math.min(3.5, total / n);
    hLanes[h] = hLanes[h ^ 1] = n; hLaneW[h] = hLaneW[h ^ 1] = lw;
    hOff0[h] = hOff0[h ^ 1] = (W / 2 - leftAvail) / 2 - (n - 1) * lw / 2; // voies centrées dans la largeur disponible
  }

  const G = {
    directed, nodeCount: N, edgeCount: E, hCount: H, hasEle, hasFast, hasRound, lockNodes: nLock, yieldNodes: nYield,
    nx, nz, nodeEle, hFrom, hTo, hUx, hUz, hLen, hDrive, hLanes, hKind, hFlag, hPrio, hOff0, hLaneW, hSpeed, hWidth, hWalk,
    eRoad, eCars, roads, outStart, outList, nodeCtl, nodeRadius,
    lockIn: I32(N).fill(-1), lockOut: I32(N).fill(-1), lockCnt: new Int16Array(N), lockT: F32(N), lockGen: I32(N),
    minX, minZ, maxX, maxZ, cols, rows, cellStart, cellItems, CELL,
    buildMs: 0, bytes: 0,

    /** Point sur une demi-arête, à l'abscisse s, décalé de `off` mètres vers la droite du sens de marche. */
    pointX(h, s, off) { return nx[hFrom[h]] + hUx[h] * s - hUz[h] * off; },
    pointZ(h, s, off) { return nz[hFrom[h]] + hUz[h] * s + hUx[h] * off; },
    /** Élévation (au-dessus du relief de base) à l'abscisse s d'une demi-arête. */
    eleAt(h, s) { const a = nodeEle[hFrom[h]], b = nodeEle[hTo[h]]; if (a === b) return a; const t = s / hLen[h]; return a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t); },
    /** Cap (yaw) d'une direction (ux, uz) : avant = (-sin yaw, -cos yaw). */
    yawOf(ux, uz) { return Math.atan2(-ux, -uz); },

    /**
     * Demi-arête la plus proche de (x, z) à moins de maxD. Si driveOnly, seules les demi-arêtes roulables comptent
     * et (dx, dz) (direction souhaitée, normalisée) départage les deux sens. `ele` (facultatif) = élévation de
     * l'appelant au-dessus du relief : les arêtes d'un autre niveau (> 3 m d'écart) sont ignorées.
     * `needFlag` (facultatif) : ne garder que les arêtes portant ce drapeau (F_WALK pour les piétons).
     * Écrit out.h, out.s, out.d (distance à l'axe) et out.lat (écart latéral signé, > 0 = à droite du sens de out.h).
     */
    nearest(x, z, maxD, out, driveOnly, dx, dz, ele, needFlag) {
      let best = 1e9; out.h = -1;
      const cx0 = Math.max(0, Math.floor((x - maxD - minX) / CELL)), cx1 = Math.min(cols - 1, Math.floor((x + maxD - minX) / CELL));
      const cz0 = Math.max(0, Math.floor((z - maxD - minZ) / CELL)), cz1 = Math.min(rows - 1, Math.floor((z + maxD - minZ) / CELL));
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * cols + cx;
        for (let i = cellStart[c]; i < cellStart[c + 1]; i++) {
          let h = 2 * cellItems[i];
          if (needFlag && !(hFlag[h] & needFlag)) continue;
          let s = (x - nx[hFrom[h]]) * hUx[h] + (z - nz[hFrom[h]]) * hUz[h];
          s = Math.max(0, Math.min(hLen[h], s));
          const qx = x - nx[hFrom[h]] - hUx[h] * s, qz = z - nz[hFrom[h]] - hUz[h] * s;
          const d = Math.hypot(qx, qz);
          if (d > maxD) continue;
          if (ele !== undefined && hasEle) { const a = nodeEle[hFrom[h]], b = nodeEle[hTo[h]]; if (Math.abs(a + (b - a) * (s / hLen[h]) - ele) > 3) continue; }
          let score = d;
          if (driveOnly) {
            const dot = dx * hUx[h] + dz * hUz[h];
            if (hDrive[h] && hDrive[h ^ 1]) { if (dot < 0) h ^= 1; score += (1 - Math.abs(dot)) * 6; }
            else if (hDrive[h]) score += (1 - dot) * 6;
            else if (hDrive[h ^ 1]) { h ^= 1; score += (1 + dot) * 6; }
            else continue;
          }
          if (score < best) {
            best = score; out.h = h; out.d = d;
            out.s = h & 1 ? hLen[h] - s : s;
            out.lat = -qx * hUz[h] + qz * hUx[h];
          }
        }
      }
      return out.h >= 0;
    },

    /**
     * Le point (x, z) est-il sur une chaussée ouverte aux voitures ? `ele` (facultatif) = élévation de l'appelant :
     * les chaussées d'un autre niveau sont ignorées. `skipE` = arête à ne pas compter (celle que longe un piéton).
     */
    onCarriageway(x, z, ele, skipE) {
      const R = 16;
      const cx0 = Math.max(0, Math.floor((x - R - minX) / CELL)), cx1 = Math.min(cols - 1, Math.floor((x + R - minX) / CELL));
      const cz0 = Math.max(0, Math.floor((z - R - minZ) / CELL)), cz1 = Math.min(rows - 1, Math.floor((z + R - minZ) / CELL));
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * cols + cx;
        for (let i = cellStart[c]; i < cellStart[c + 1]; i++) {
          const e = cellItems[i], h = 2 * e;
          if (e === skipE || !(hDrive[h] || hDrive[h + 1])) continue;
          const px = x - nx[hFrom[h]], pz = z - nz[hFrom[h]], s = px * hUx[h] + pz * hUz[h];
          if (s < 0 || s > hLen[h]) continue;
          const lat = pz * hUx[h] - px * hUz[h], w = hWidth[h] * 0.5 - 0.2;
          if (lat > w || lat < -w) continue;
          if (ele !== undefined && hasEle) { const a = nodeEle[hFrom[h]], b = nodeEle[hTo[h]]; if (Math.abs(a + (b - a) * (s / hLen[h]) - ele) > 3) continue; }
          return true;
        }
      }
      return false;
    },

    /**
     * Tire une arête au hasard dans l'anneau [rMin, rMax] autour de (x, z). Écrit out.e, out.s, out.x, out.z.
     * (dirX, dirZ, bias) : avec la probabilité `bias`, le tirage se fait dans un secteur de ±35° autour de cette
     * direction et dans la moitié extérieure de l'anneau (flux devant un joueur rapide).
     * @returns {boolean} false si rien trouvé cette fois (à retenter plus tard).
     */
    randomEdgeNear(x, z, rMin, rMax, out, tries = 6, dirX = 0, dirZ = 0, bias = 0) {
      if (!E) return false;
      for (let t = 0; t < tries; t++) {
        let ang, r;
        if (bias > 0 && Math.random() < bias) {
          ang = Math.atan2(dirZ, dirX) + (Math.random() - 0.5) * 1.2;
          const r0 = Math.max(rMin, rMax * 0.55); r = Math.sqrt(r0 * r0 + Math.random() * (rMax * rMax - r0 * r0));
        } else { ang = Math.random() * Math.PI * 2; r = Math.sqrt(rMin * rMin + Math.random() * (rMax * rMax - rMin * rMin)); }
        const px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
        const cx = Math.floor((px - minX) / CELL), cz = Math.floor((pz - minZ) / CELL);
        if (cx < 0 || cz < 0 || cx >= cols || cz >= rows) continue;
        const c = cz * cols + cx, n = cellStart[c + 1] - cellStart[c];
        if (!n) continue;
        const e = cellItems[cellStart[c] + ((Math.random() * n) | 0)], h = 2 * e;
        // projection du point tiré sur l'arête, avec un peu d'aléa le long de celle-ci
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
  bytes += N * 2;
  G.bytes = bytes;
  G.buildMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return G;
}

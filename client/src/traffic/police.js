// Trafic — police (contrat v6 « képis et police »).
//
// Une « unité » est une voiturette bleue à gyrophare, cinématique (ctx.vehicles.spawn remote, driver 'police',
// id 'police:<n>'), ni volable ni dynamique, ignorée par les piétons et par les voitures IA. Elle REJOUE LA TRACE du
// joueur : sa position (au sol) est échantillonnée toutes les 0,4 s (plus un point à chaque changement de cap), 60 s
// sont gardées ; l'unité avance le long de cette ligne brisée par setTransform, hauteur comprise (ponts, trémies).
// Elle passe donc exactement là où le joueur est passé — y compris à travers le trafic et sur les trottoirs (assumé :
// elle ne renverse personne).
//
// Apparition : à 120–160 m en arrière sur la trace si elle est assez longue ; sinon sur un nœud du graphe situé à
// cette distance PAR LA ROUTE (petite recherche bornée autour du joueur), d'où elle rejoint le point où se trouvait le
// joueur par l'itinéraire de ctx.gameplay.computeRoute (un seul calcul, budgetMs 4) ou, à défaut, par la ligne de
// nœuds trouvée par la recherche ; ensuite elle suit la trace.
//
// Raccourci : quand le joueur est en vue tout près (25 m, même niveau), qu'il s'éloigne ou s'arrête, et que la trace
// repasse à moins de 20 m de l'unité au moins 30 m de chemin plus loin (demi-tour, boucle), elle coupe droit vers ce
// point de la trace au lieu d'aller jusqu'au bout du détour — jamais à travers un immeuble ni l'eau
// (ctx.world.inBuilding / isWater, facultatifs).
//
// Loi de vitesse d'une unité, en trois temps (réglages plus bas) : APPROCHE lancée (v joueur + 8, sans ralentir dans les
// virages) jusqu'à 25 m du joueur, où elle est « engagée » ; elle garde cette allure jusqu'au premier CONTACT (14 m),
// sauf si le joueur a déjà pris la fuite (il a roulé plus vite qu'elle ne peut suivre depuis l'avis de recherche) ; puis
// POURSUITE : v + 3 plafonnée, et elle lève le pied dans les virages serrés de la trace — c'est là, et à pleine vitesse
// en ligne droite, qu'on la sème.
//
// La police a UN seul chemin de commande : l'API ci-dessous, appelée par gameplay/heat.js (aucune écoute de heat:change).
//   ctx.traffic.police = { start(level), setLevel(level), stall(sec), stop(), active, engaged, dist, units }
//     start(level)   lance la poursuite : 1 unité à 2 képis, 2 à 3 (appelé deux fois = une seule flotte)
//     setLevel(level) ajuste le nombre d'unités d'une poursuite en cours
//     stall(sec)     l'unité décroche : vitesse × 0,4 pendant sec (figure du joueur) ; sans effet sur une unité en approche
//     stop()         fin de poursuite : les unités sont retirées
//     active         une poursuite est en cours ; engaged : une unité est arrivée sur les talons du joueur depuis
//                    start() (à 25 m, sans détour restant sur son chemin)
//     dist           distance (m) de l'unité la plus proche, Infinity si aucune ; units : véhicules des unités actives
// Émet `police:stop {vehicle}` : unité à moins de 9 m du joueur roulant à moins de 1,5 m/s depuis 2 s.
import { baseHeightAt } from '@shared/terrain.js';
import { createCharacter } from '../player/index.js';
import { KIND_PEDESTRIAN } from './graph.js';

// ---------------------------------------------------------------- réglages (toute la loi de poursuite est ici)
const TRACE_DT = 0.4;         // période d'échantillonnage de la trace (s)
const TRACE_KEEP = 60;        // durée de trace gardée (s)
const TRACE_STEP = 0.75;      // déplacement minimal entre deux échantillons (m)
const TRACE_TURN = Math.cos(12 * Math.PI / 180); // échantillon supplémentaire si le cap a tourné de plus de 12°
const CAP = 512;              // points par chemin (puissance de 2)
const SPAWN_MIN = 120, SPAWN_MAX = 160; // distance d'apparition, le long de la trace ou par la route (m)
const AIR_MIN = 112, AIR_MAX = 172;     // … et bornes à vol d'oiseau (toujours entre 100 et 180 m du joueur)
const REACH = 240;            // portée de la recherche de nœuds (m par la route)
const ENGAGE = 25;            // distance d'engagement (m)
const CUT_R = 20, CUT_SKIP = 30, CUT_STEP = 3; // raccourci : la trace repasse à moins de 20 m (autre chaussée d'un boulevard comprise), au moins 30 m de chemin plus loin ; ligne sondée tous les 3 m
const APPROACH_PLUS = 8, APPROACH_MIN = 20, APPROACH_MAX = 45;  // approche : max(v joueur + 8, 20), plafond 45 m/s
const CHASE_K = 1.0, CHASE_PLUS = 3, CHASE_MIN = 8;             // poursuite : clamp(v + 3, 8, vCap) — elle revient au pare-chocs sous vCap
const CHASE_CAP = 34, CHASE_CAP_K = 0.6, FOOT_CAP = 7.5;        // vCap = min(34, 0,6 × vitesse max du joueur) ; 7,5 à pied (le sprint est à 6,4)
// (0,85 avant la finition v6 : 32,3 m/s pour la Citadine, allure qu'on ne tient pas en ville ; 0,6 = 22,8 m/s : elle reste au
// pare-chocs d'un joueur à 20 m/s et ne lâche qu'une fuite franche ; inchangé, 34 m/s, pour les voitures de 57 m/s et plus)
const CONTACT = 14, FLEE_PLUS = 2; // engagée, elle garde la loi d'approche jusqu'au premier contact (14 m), sauf si le joueur a pris la fuite : plus de vCap + 2 m/s à un moment depuis start()
// (un joueur qui ne fuit pas tout de suite l'a toujours au pare-chocs au moins une fois, quels que soient ses virages ; une
// fuite lancée avant son arrivée se joue comme avant : plafonnée dès 25 m)
const TURN_COS = Math.cos(35 * Math.PI / 180), TURN_SPAN = 15, TURN_K = 0.45, TURN_TIME = 2, TURN_FLOOR = 10; // virage serré de la trace, unité en POURSUITE : × 0,45 pendant 2 s, sans descendre sous 10 m/s (ou sous sa vitesse voulue, si elle est plus basse)
// (les virages sont le moyen de la décrocher À PLEINE VITESSE : 22,8 -> 10,3 m/s derrière une Citadine en fuite. Le plancher
// garde la pression à allure ordinaire — derrière un joueur à 14 m/s elle passe de 17 à 10 m/s, pas à 7,7 — et à pied, où il
// dépasse FOOT_CAP : un sprint en zigzag ne la ralentit pas. En approche elle ne ralentit pas du tout.)
const STALL_K = 0.4;          // stall(sec) : vitesse × 0,4 (unités engagées seulement : une figure ne retarde pas l'approche)
const MIN_DIST = 7;           // jamais à moins de 7 m du joueur…
const HOLD_DIST = 7.8;        // … elle se cale un peu au-delà (et sous les 9 m du contrôle)
const UNIT_GAP = 9;           // écart entre deux unités qui se suivent (m)
const STOP_DIST = 9, STOP_SPEED = 1.5, STOP_TIME = 2;           // contrôle : police:stop
const LOST_DIST = 400, LOST_TIME = 20;                          // semée pour de bon : retirée
const ACCEL = 4, DECEL = 18;  // reprise après un ralentissement (voiturette poussive : c'est là que le joueur creuse l'écart) / freinage (m/s²)
const RESPAWN = 2.5;          // délai entre deux apparitions (s)
const RETIRE_MAX = 12;        // une unité congédiée encore dans le champ reste garée au plus 12 s
const LEVEL = 3;              // écart vertical (m) au-delà duquel on n'est pas au même niveau
const JUMP = 150;             // téléportation du joueur (m) : trace effacée
const MAXN = 640;             // nœuds explorés au plus par la recherche d'apparition
const COLOR = '#1f4fd8';
const DRIVER = { color: '#1b2a4a', skin: '#e0ac7e', name: 'agent-zero' };

export function createPolice(T) {
  const { ctx, G } = T;
  const { hFrom, hTo, hUx, hUz, hLen, hDrive, hKind, hOff0, outStart, outList } = G;
  const M = CAP - 1;

  // ---------------------------------------------------------------- trace du joueur (anneau)
  const tX = new Float32Array(CAP), tY = new Float32Array(CAP), tZ = new Float32Array(CAP);
  const tT = new Float64Array(CAP), tS = new Float64Array(CAP); // date, abscisse curviligne cumulée
  let tHead = -1, tCount = 0, tDx = 0, tDz = 0, now = 0;
  // tête vivante : position courante du joueur (au sol), sa vitesse, le plafond de vitesse de la poursuite
  let lx = 0, ly = 0, lz = 0, py = 0, lyT = -1, pvx = 0, pvz = 0, vP = 0, vCap = FOOT_CAP, seen = false, air = false;

  const units = [];     // unités en poursuite
  const vehicles = [];  // leurs véhicules (exposé : police.units)
  const retiring = [];  // unités congédiées, encore visibles
  const pool = [];      // états réutilisables (tampons de chemin)
  let active = false, engaged = false, fled = false, dist = Infinity, want = 0, stallT = 0, spawnT = 0, serial = 0, checkT = 1;
  const last = { kind: '', len: 0 }; // dernière apparition (sondes) : 'trace' | 'route' | 'nodes' | 'edge'
  // sorties de locate() / dirAhead()
  let qx = 0, qy = 0, qz = 0, qdx = 0, qdz = -1, qi = 0, aDx = 0, aDz = 0;
  const tmpN = { h: -1, s: 0, d: 0, lat: 0 }, tmpE = { e: 0, s: 0, x: 0, z: 0 };

  /** Lit la position et la vitesse du joueur (son véhicule s'il conduit). @returns {boolean} false sans joueur. */
  function readPlayer(dt) {
    const pl = ctx.player, pv = pl && pl.mode === 'vehicle' ? pl.vehicle : null, p = pv ? pv.pos : pl && pl.pos;
    if (!p || !isFinite(p.x) || !isFinite(p.z)) return false;
    const ox = lx, oz = lz;
    lx = p.x; lz = p.z; py = isFinite(p.y) ? p.y : 0; lyT = -1;
    if (pv && pv.vel) { pvx = pv.vel.x; pvz = pv.vel.z; }
    else if (seen && dt > 1e-4) {
      // à pied (ou véhicule sans vecteur vitesse) : différence finie lissée
      const k = Math.min(1, dt * 10), ax = (lx - ox) / dt, az = (lz - oz) / dt;
      if (ax * ax + az * az < 3600) { pvx += (ax - pvx) * k; pvz += (az - pvz) * k; } else pvx = pvz = 0;
    }
    vP = Math.hypot(pvx, pvz);
    vCap = pv ? Math.min(CHASE_CAP, CHASE_CAP_K * ((pv.spec && pv.spec.maxSpeed) || 40)) : FOOT_CAP;
    air = pv ? pv.airborne === true || !!(pv.phys && pv.phys.air) : pl.grounded === false;
    seen = true;
    return true;
  }
  /** Hauteur de la trace sous le joueur : la sienne s'il est posé (tablier, trémie compris), le sol de son niveau s'il est en l'air. */
  function ground() {
    if (lyT === now) return ly;
    lyT = now;
    ly = py;
    if (air) { const y = ctx.heightAt(lx, lz, py); if (isFinite(y)) ly = y; } // un saut ne fait pas décoller la trace
    return ly;
  }
  function pushTrace(x, y, z) {
    let s = 0;
    if (tCount > 0) {
      const k = tHead & M, dx = x - tX[k], dz = z - tZ[k], d = Math.hypot(dx, dz);
      s = tS[k] + d;
      if (d > 1e-3) { tDx = dx / d; tDz = dz / d; }
    }
    tHead++;
    const k = tHead & M;
    tX[k] = x; tY[k] = y; tZ[k] = z; tT[k] = now; tS[k] = s;
    if (tCount < CAP) tCount++;
    for (let i = 0; i < units.length; i++) pathPush(units[i], x, y, z);
  }
  /** Échantillonnage : toutes les 0,4 s si l'on a bougé, plus tôt si le cap tourne ; oubli au-delà de 60 s. @returns true si téléporté. */
  function trace() {
    let jumped = false;
    if (tCount > 0) {
      const k = tHead & M, dx = lx - tX[k], dz = lz - tZ[k], d2 = dx * dx + dz * dz;
      if (d2 > JUMP * JUMP) { tCount = 0; tHead = -1; tDx = tDz = 0; pvx = pvz = vP = 0; jumped = true; }
      else if (d2 >= TRACE_STEP * TRACE_STEP) {
        let add = now - tT[k] >= TRACE_DT;
        if (!add && d2 >= 2.25) add = dx * tDx + dz * tDz < TRACE_TURN * Math.sqrt(d2);
        if (add) pushTrace(lx, ground(), lz);
      }
    }
    if (tCount === 0) pushTrace(lx, ground(), lz);
    while (tCount > 1 && now - tT[(tHead - tCount + 2) & M] > TRACE_KEEP) tCount--;
    return jumped;
  }

  // ---------------------------------------------------------------- chemin d'une unité (anneau privé : approche puis trace)
  function newUnit() {
    return {
      v: null, occ: null, pX: new Float32Array(CAP), pY: new Float32Array(CAP), pZ: new Float32Array(CAP), pS: new Float64Array(CAP),
      head: -1, count: 0, i: 0, s: 0, x: 0, y: 0, z: 0, yaw: 0, dx: 0, dz: -1, speed: 0, d: 1e9, rem: 0,
      engaged: false, chase: false, slowT: 0, turnS: 0, inTurn: false, lostT: 0, stopT: 0, stopSent: false, retireT: 0,
    };
  }
  function pathPush(u, x, y, z) {
    let s = 0;
    if (u.count > 0) {
      const k = u.head & M;
      s = u.pS[k] + Math.hypot(x - u.pX[k], z - u.pZ[k]);
      if (s - u.pS[k] < 0.05) return; // point confondu avec le précédent
    }
    u.head++;
    const k = u.head & M;
    u.pX[k] = x; u.pY[k] = y; u.pZ[k] = z; u.pS[k] = s;
    if (u.count < CAP) u.count++;
  }
  /** Abscisse du bout du chemin : le dernier point, prolongé jusqu'à la position courante du joueur. */
  function pathEnd(u) { const k = u.head & M; return u.pS[k] + Math.hypot(lx - u.pX[k], lz - u.pZ[k]); }
  /** Point du chemin à l'abscisse s : écrit qx, qy, qz, la direction du segment (qdx, qdz) et l'indice du segment qi. */
  function locate(u, s) {
    const pS = u.pS, first = u.head - u.count + 1;
    let i = u.i < first ? first : u.i;
    if (s < pS[i & M]) s = pS[i & M];
    while (i < u.head && pS[(i + 1) & M] <= s) i++;
    const a = i & M, ax = u.pX[a], ay = u.pY[a], az = u.pZ[a];
    let bx, by, bz, len;
    if (i < u.head) { const b = (i + 1) & M; bx = u.pX[b]; by = u.pY[b]; bz = u.pZ[b]; len = pS[b] - pS[a]; }
    else { bx = lx; by = ground(); bz = lz; len = Math.hypot(bx - ax, bz - az); }
    qi = i;
    if (len < 1e-3) { qx = ax; qy = ay; qz = az; qdx = u.dx; qdz = u.dz; return; }
    let t = (s - pS[a]) / len; if (t > 1) t = 1;
    qx = ax + (bx - ax) * t; qy = ay + (by - ay) * t; qz = az + (bz - az) * t;
    qdx = (bx - ax) / len; qdz = (bz - az) / len;
  }
  /** Direction du chemin à l'abscisse s2 (devant l'unité) : écrit aDx, aDz. @returns false si elle est indéterminée. */
  function dirAhead(u, s2) {
    const pS = u.pS;
    let j = u.i;
    while (j < u.head && pS[(j + 1) & M] <= s2) j++;
    const a = j & M;
    let dx, dz;
    if (j < u.head) { const b = (j + 1) & M; dx = u.pX[b] - u.pX[a]; dz = u.pZ[b] - u.pZ[a]; }
    else { dx = lx - u.pX[a]; dz = lz - u.pZ[a]; if (dx * dx + dz * dz < 2.25) return false; } // bout de trace trop court pour donner un cap
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return false;
    aDx = dx / l; aDz = dz / l;
    return true;
  }

  // ---------------------------------------------------------------- raccourci
  /** La ligne droite de l'unité au point (x, z), longue de len, est-elle libre (ni immeuble ni eau) ? */
  function clearLine(u, x, z, len) {
    const w = ctx.world;
    if (!w || !w.inBuilding) return true;
    const n = Math.ceil(len / CUT_STEP);
    for (let k = 1; k < n; k++) {
      const t = k / n, px = u.x + (x - u.x) * t, pz = u.z + (z - u.z) * t;
      if (w.inBuilding(px, pz, 1) || (w.isWater && w.isWater(px, pz))) return false;
    }
    return true;
  }
  /** Une AUTRE unité est-elle à moins de UNIT_GAP du point (x, z) ? (deux unités ne coupent pas vers le même point) */
  function otherUnitNear(u, x, z) {
    for (let i = 0; i < units.length; i++) { const o = units[i]; if (o !== u && (o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) < UNIT_GAP * UNIT_GAP) return true; }
    return false;
  }
  /**
   * Coupe le détour : cherche le point le plus avancé du chemin (au moins CUT_SKIP m plus loin) situé à moins de CUT_R
   * de l'unité, au même niveau, en ligne dégagée et libre d'une autre unité ; le point qui le précède devient la position de l'unité, qui
   * repart de là. Elle reste donc là où le joueur est réellement passé. @returns {boolean} true si le chemin a été coupé.
   */
  function shortcut(u) {
    const pS = u.pS, lim = u.s + CUT_SKIP;
    for (let j = u.head; j > u.i + 1 && pS[j & M] > lim; j--) {
      const k = j & M, dx = u.pX[k] - u.x, dz = u.pZ[k] - u.z, dy = u.pY[k] - u.y, r2 = dx * dx + dz * dz;
      if (r2 > CUT_R * CUT_R || dy >= LEVEL || dy <= -LEVEL) continue;
      const r = Math.sqrt(r2);
      if (otherUnitNear(u, u.pX[k], u.pZ[k]) || !clearLine(u, u.pX[k], u.pZ[k], r)) continue;
      const a = (j - 1) & M;
      u.pX[a] = u.x; u.pY[a] = u.y; u.pZ[a] = u.z; pS[a] = pS[k] - r;
      u.count = u.head - j + 2; u.i = j - 1; u.s = pS[a];
      u.turnS = 0; u.inTurn = false; // le virage du raccourci compte comme un virage neuf
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- apparition
  // Recherche bornée (Dijkstra) autour du joueur, À REBOURS : on remonte les demi-arêtes qu'une voiture emprunterait
  // pour venir jusqu'à lui. sDist = distance par la route, sPred = nœud suivant vers le joueur, sH = demi-arête à prendre.
  const sNode = new Int32Array(MAXN), sPred = new Int16Array(MAXN), sH = new Int32Array(MAXN), sDist = new Float32Array(MAXN), sDone = new Uint8Array(MAXN);
  let sN = 0, mark = null, slotOf = null, gen = 0;
  function addNode(node, d, pred, h) {
    if (mark[node] === gen) {
      const k = slotOf[node];
      if (!sDone[k] && d < sDist[k]) { sDist[k] = d; sPred[k] = pred; sH[k] = h; }
      return;
    }
    if (sN >= MAXN) return;
    mark[node] = gen; slotOf[node] = sN;
    sNode[sN] = node; sDist[sN] = d; sPred[sN] = pred; sH[sN] = h; sDone[sN] = 0; sN++;
  }
  /** @param h0 demi-arête roulable où se trouve le joueur, s0 son abscisse ; directed = respecter les sens de circulation. */
  function search(h0, s0, directed) {
    if (!mark) { mark = new Int32Array(G.nodeCount); slotOf = new Int16Array(G.nodeCount); }
    gen++; sN = 0;
    addNode(hFrom[h0], s0, -1, h0);
    if (!directed || hDrive[h0 ^ 1]) addNode(hTo[h0], hLen[h0] - s0, -1, h0 ^ 1);
    for (;;) {
      let u = -1, best = REACH;
      for (let k = 0; k < sN; k++) if (!sDone[k] && sDist[k] < best) { best = sDist[k]; u = k; }
      if (u < 0) break;
      sDone[u] = 1;
      const n = sNode[u];
      for (let q = outStart[n]; q < outStart[n + 1]; q++) {
        const h = outList[q], back = h ^ 1; // l'unité roulerait de hTo[h] vers n, donc sur `back`
        if (hKind[h] === KIND_PEDESTRIAN || !(directed ? hDrive[back] : hDrive[h] || hDrive[back])) continue;
        addNode(hTo[h], best + hLen[h], u, back);
      }
    }
  }
  function nearUnit(x, z, r) {
    for (let i = 0; i < units.length; i++) { const dx = units[i].x - x, dz = units[i].z - z; if (dx * dx + dz * dz < r * r) return true; }
    return false;
  }
  /** Nœud d'apparition : à 120–160 m par la route (élargi au besoin), 100–180 m à vol d'oiseau, de préférence hors champ. */
  function pickNode() {
    let best = -1, score = 1e9;
    for (let k = 0; k < sN; k++) {
      if (!sDone[k]) continue;
      const d = sDist[k];
      if (d < AIR_MIN) continue;
      const n = sNode[k], x = G.nx[n], z = G.nz[n], air = Math.hypot(x - lx, z - lz);
      if (air < AIR_MIN || air > AIR_MAX || nearUnit(x, z, 40)) continue;
      // hors de la fenêtre voulue : pénalité selon l'écart ; dans le champ de la caméra : pénalité fixe ; un peu de hasard
      let sc = d < SPAWN_MIN ? SPAWN_MIN - d : d > SPAWN_MAX ? d - SPAWN_MAX : 0;
      if (T.inView(x, z, baseHeightAt(x, z) + G.nodeEle[n])) sc += 25;
      // joueur en mouvement : elle doit arriver par-derrière (devant lui, il la croiserait de face avant qu'elle ne fasse demi-tour)
      if (vP > 3 && (x - lx) * pvx + (z - lz) * pvz > -0.2 * air * vP) sc += 80;
      sc += Math.random() * 12;
      if (sc < score) { score = sc; best = k; }
    }
    return best;
  }
  /** Deux points par tronçon (a → b), décalés de `off` m vers la droite : les angles deviennent des pans coupés. */
  function pushLeg(u, ax, az, bx, bz, off, ea, eb, flat) {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.5) return;
    const ux = (bx - ax) / L, uz = (bz - az) / L, c = Math.min(5, L * 0.35);
    for (let k = 0; k < 2; k++) {
      const s = k ? L - c : c, x = ax + ux * s - uz * off, z = az + uz * s + ux * off;
      pathPush(u, x, flat ? ctx.heightAt(x, z, ly + 0.4) : baseHeightAt(x, z) + ea + (eb - ea) * (s / L), z);
    }
  }
  /** Approche par la ligne de nœuds de la recherche, depuis le nœud du créneau k jusqu'au joueur. */
  function leadFromNodes(u, k) {
    while (k >= 0) {
      const n = sNode[k], h = sH[k], p = sPred[k];
      // tronçon entier jusqu'au nœud suivant ; pour le dernier, seulement jusqu'à la hauteur du joueur
      const L = p >= 0 ? hLen[h] : sDist[k];
      const off = hDrive[h] ? hOff0[h] : 0;
      pushLeg(u, G.nx[n], G.nz[n], G.nx[n] + hUx[h] * L, G.nz[n] + hUz[h] * L, off, G.nodeEle[n], G.eleAt(h, L), false);
      k = p;
    }
  }
  /** Approche par l'itinéraire du GPS : chaque tronçon est décalé sur la voie de droite de la demi-arête qu'il longe. */
  function leadFromRoute(u, path) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], ax = a[0], az = a[1], bx = b[0], bz = b[1], L = Math.hypot(bx - ax, bz - az);
      if (!(L >= 0.5)) continue;
      const flat = !isFinite(a[2]) || !isFinite(b[2]), ea = flat ? 0 : a[2], eb = flat ? 0 : b[2];
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      let off = 0;
      if (G.nearest((ax + bx) / 2, (az + bz) / 2, 5, tmpN, true, ux, uz, flat ? undefined : (ea + eb) / 2) && hUx[tmpN.h] * ux + hUz[tmpN.h] * uz > 0.8) off = hOff0[tmpN.h];
      pushLeg(u, ax, az, bx, bz, off, ea, eb, flat);
    }
  }
  /** Chemin d'une nouvelle unité. @returns {boolean} false si aucun point d'apparition n'a été trouvé cette fois. */
  function buildPath(u) {
    u.head = -1; u.count = 0;
    // la trace se termine exactement sous le joueur (jonction avec une éventuelle approche)
    if (tCount === 0 || Math.hypot(lx - tX[tHead & M], lz - tZ[tHead & M]) > 0.05) pushTrace(lx, ground(), lz);
    // 1) sur la trace, 120–160 m en arrière
    const first = tHead - tCount + 1, sh = tS[tHead & M];
    for (let j = tHead - 1; j >= first; j--) {
      const k = j & M, back = sh - tS[k];
      if (back < SPAWN_MIN) continue;
      if (back > SPAWN_MAX + 20) break;
      const air = Math.hypot(tX[k] - lx, tZ[k] - lz);
      if (air < AIR_MIN || air > AIR_MAX || nearUnit(tX[k], tZ[k], 40)) continue;
      for (let q = j; q <= tHead; q++) { const m = q & M; pathPush(u, tX[m], tY[m], tZ[m]); }
      last.kind = 'trace'; last.len = back;
      return true;
    }
    // 2) sur un nœud du graphe, à cette distance par la route
    const ele = ly - baseHeightAt(lx, lz);
    if (G.nearest(lx, lz, 45, tmpN, true, 0, 0, ele)) {
      const h0 = tmpN.h, s0 = tmpN.s;
      search(h0, s0, true);
      let k = pickNode();
      if (k < 0) { search(h0, s0, false); k = pickNode(); } // impasse à sens unique… : sans les sens de circulation
      if (k >= 0) {
        const n = sNode[k], sx = G.nx[n], sz = G.nz[n];
        let r = null;
        try { r = ctx.gameplay && ctx.gameplay.computeRoute ? ctx.gameplay.computeRoute(sx, sz, lx, lz, { metric: 'distance', budgetMs: 4, fromEle: G.nodeEle[n], toEle: ele }) : null; } catch (e) { r = null; }
        // l'itinéraire du GPS n'est retenu que s'il est complet et guère plus long que la ligne de nœuds
        const p = r && r.routed && !r.partial && r.path && r.path.length >= 2 && r.path.length < 160 && r.length <= sDist[k] * 1.3 + 30 ? r.path : null;
        if (p && Math.hypot(p[0][0] - sx, p[0][1] - sz) < 8) { leadFromRoute(u, p); last.kind = 'route'; last.len = r.length; }
        else { leadFromNodes(u, k); last.kind = 'nodes'; last.len = sDist[k]; }
        if (u.count > 0) { pathPush(u, lx, ly, lz); return true; }
      }
    }
    // 3) repli (aucune rue alentour) : une arête quelconque à bonne distance, puis tout droit
    if (G.randomEdgeNear(lx, lz, AIR_MIN + 6, AIR_MAX - 12, tmpE, 8) && !nearUnit(tmpE.x, tmpE.z, 40)) {
      pathPush(u, tmpE.x, ctx.heightAt(tmpE.x, tmpE.z), tmpE.z);
      pathPush(u, lx, ly, lz);
      last.kind = 'edge'; last.len = Math.hypot(tmpE.x - lx, tmpE.z - lz);
      return true;
    }
    return false;
  }
  /** Agent au volant (personnage simplifié assis, comme les conducteurs du trafic). */
  function seat(u) {
    const v = u.v;
    if (v.occupant || !v.group) return;
    try {
      const ch = createCharacter(ctx, { lod: true, shadow: false, color: DRIVER.color, skin: DRIVER.skin, name: DRIVER.name });
      if (!ch || !ch.group) return;
      const st = v.seat, sc = ch.scale || 1;
      v.group.add(ch.group);
      ch.group.position.set(st ? st.x : -(v.spec.width || 1.7) * 0.2, (st ? st.y : 0.45) - 0.5 * sc, st ? st.z : 0.12);
      ch.group.rotation.set(0, 0, 0); ch.group.visible = true;
      ch.setState({ anim: 'sit', speed: 0, wheel: v.wheelPos || null, steer: 0 });
      if (ch.snap) ch.snap();
      v.occupant = u.occ = ch;
    } catch (e) { u.occ = null; }
  }
  function spawnUnit() {
    if (!ctx.vehicles || !ctx.vehicles.spawn || !readPlayer(0)) return false;
    lyT = -1; ground();
    const u = pool.pop() || newUnit();
    if (!buildPath(u)) { pool.push(u); return false; }
    u.i = u.head - u.count + 1; u.s = u.pS[u.i & M];
    u.dx = 0; u.dz = -1;
    locate(u, u.s);
    if (qdx === 0 && qdz === -1 && dirAhead(u, u.s + 1)) { qdx = aDx; qdz = aDz; }
    u.x = qx; u.y = qy; u.z = qz; u.dx = qdx; u.dz = qdz; u.yaw = G.yawOf(qdx, qdz);
    let v = null;
    try { v = ctx.vehicles.spawn('citadine', u.x, u.z, u.yaw, { remote: true, id: 'police:' + (++serial), color: COLOR, beacon: true, y: u.y }); } catch (e) { v = null; }
    if (!v) { pool.push(u); return false; }
    v.driver = 'police';
    if (v.setBeacon) v.setBeacon(true); // (sans gyrophare livré par le module véhicules : simple citadine bleue)
    u.v = v; u.occ = null;
    u.speed = Math.max(APPROACH_MIN, Math.min(APPROACH_MAX, vP + APPROACH_PLUS)); // elle arrive lancée
    u.engaged = false; u.chase = false; u.slowT = 0; u.turnS = 0; u.inTurn = false; u.lostT = 0; u.stopT = 0; u.stopSent = false; u.retireT = 0;
    u.d = Math.hypot(u.x - lx, u.y - ly, u.z - lz); u.rem = pathEnd(u) - u.s;
    seat(u);
    v.setTransform(u.x, u.z, u.yaw, u.speed, u.y);
    v.pos.y = u.y;
    units.push(u); vehicles.push(v);
    if (u.d < dist) dist = u.d;
    return true;
  }
  function removeUnit(u) {
    const v = u.v;
    if (u.occ) { if (v && v.occupant === u.occ) v.occupant = null; u.occ.group.removeFromParent(); if (u.occ.dispose) u.occ.dispose(); u.occ = null; }
    if (v) { try { ctx.vehicles.remove(v); } catch (e) { /* module véhicules en cours de remplacement */ } }
    u.v = null;
    pool.push(u);
  }
  /** Fin de service : retirée tout de suite si personne ne la voit, sinon elle reste garée, gyrophare éteint, le temps de sortir du champ. */
  function dismiss(k) {
    const u = units[k];
    units.splice(k, 1); vehicles.splice(k, 1);
    if (!u.v) { pool.push(u); return; }
    if (!T.inView(u.x, u.z, u.y)) { removeUnit(u); return; }
    if (u.v.setBeacon) u.v.setBeacon(false);
    u.v.setTransform(u.x, u.z, u.yaw, 0, u.y);
    u.speed = 0; u.retireT = RETIRE_MAX;
    retiring.push(u);
  }
  const countFor = (level) => (level >= 3 ? 2 : 1);

  // ---------------------------------------------------------------- conduite d'une unité
  function drive(u, dt) {
    let end = pathEnd(u);
    const ex = lx - u.x, ey = ly - u.y, ez = lz - u.z, d = Math.sqrt(ex * ex + ey * ey + ez * ez);
    const level = ey < LEVEL && ey > -LEVEL;
    if (level && d <= ENGAGE) {
      // joueur en vue, tout près, mais le chemin fait encore un détour (il a fait demi-tour, bouclé…) : dès qu'il
      // s'éloigne ou s'arrête, elle coupe vers la trace toute proche ; elle n'est « engagée » qu'une fois sur ses talons
      let detour = end - u.s > d + CUT_SKIP;
      if (detour && (vP < STOP_SPEED || pvx * ex + pvz * ez > 0) && shortcut(u)) { end = pathEnd(u); detour = end - u.s > d + CUT_SKIP; }
      if (!u.engaged && !detour) { u.engaged = true; engaged = true; }
    }
    // engagée, elle passe à la loi de poursuite au premier contact — ou tout de suite si le joueur a déjà pris la fuite
    // (une fuite lancée avant son arrivée ne lui offre pas le pare-chocs)
    if (u.engaged && !u.chase && ((level && d < CONTACT) || fled)) u.chase = true;
    // loi de vitesse : approche, puis poursuite plafonnée (v + 3 : elle regagne du terrain tant que le joueur roule sous vCap)
    let vt;
    if (!u.chase) { vt = vP + APPROACH_PLUS; if (vt < APPROACH_MIN) vt = APPROACH_MIN; if (vt > APPROACH_MAX) vt = APPROACH_MAX; }
    else { vt = CHASE_K * vP + CHASE_PLUS; if (vt < CHASE_MIN) vt = CHASE_MIN; if (vt > vCap) vt = vCap; }
    // virage serré de la trace (cap changé de plus de 35° sur 15 m) : × 0,45 pendant 2 s (plancher 10 m/s), une fois par virage,
    // pour une unité en poursuite seulement (un virage qui n'en finit pas — giratoire, ronds dans l'eau — compte de nouveau tous les 30 m)
    if (dirAhead(u, u.s + TURN_SPAN) && u.dx * aDx + u.dz * aDz < TURN_COS) {
      if (!u.inTurn || u.s >= u.turnS) { u.slowT = TURN_TIME; u.turnS = u.s + 2 * TURN_SPAN; }
      u.inTurn = true;
    } else u.inTurn = false;
    if (u.slowT > 0) { u.slowT -= dt; if (u.chase) vt = Math.max(vt * TURN_K, Math.min(vt, TURN_FLOOR)); }
    if (stallT > 0 && u.engaged) vt *= STALL_K;
    if (vt > u.speed) { u.speed += ACCEL * dt; if (u.speed > vt) u.speed = vt; }
    else { u.speed -= DECEL * dt; if (u.speed < vt) u.speed = vt; }
    // distance de sécurité : elle se cale à ~8 m derrière le joueur (jamais à moins de 7 m), et derrière l'unité qui la précède
    if (level) {
      const away = d > 0.5 ? (pvx * ex + pvz * ez) / d : 0;
      const lim = (away > 0 ? away : 0) + Math.sqrt(8 * (d > HOLD_DIST ? d - HOLD_DIST : 0));
      if (lim < u.speed) u.speed = lim;
    }
    for (let i = 0; i < units.length; i++) {
      const o = units[i];
      if (o === u || o.rem >= u.rem) continue; // seulement celle qui est devant sur le chemin
      // (plus près que l'écart voulu — deux raccourcis vers la même rue : elle se laisse distancer jusqu'à le retrouver)
      const g = Math.hypot(o.x - u.x, o.y - u.y, o.z - u.z), lim = g > UNIT_GAP ? o.speed + Math.sqrt(8 * (g - UNIT_GAP)) : o.speed * g / UNIT_GAP;
      if (lim < u.speed) { u.speed = lim; if (o.chase && u.engaged) u.chase = true; } // (tenue derrière une unité en poursuite, elle n'ira pas au contact : elle l'est aussi)
    }
    // avance le long du chemin
    let ns = u.s + u.speed * dt;
    if (ns > end) ns = end;
    locate(u, ns);
    let nd = d;
    if (level) {
      const fx = lx - qx, fy = ly - qy, fz = lz - qz;
      nd = Math.sqrt(fx * fx + fy * fy + fz * fz);
    }
    if (level && nd < MIN_DIST && nd < d) { u.speed = 0; nd = d; } // ce pas la rapprocherait trop : elle reste où elle est
    else {
      u.i = qi; u.s = ns; u.x = qx; u.z = qz; u.dx = qdx; u.dz = qdz;
      // hauteur : celle de la trace, recalée sur la surface du module ville si elle est toute proche
      let y = ctx.heightAt(qx, qz, qy + 0.4);
      if (!(y - qy < 0.6 && qy - y < 0.6)) y = qy;
      u.y += (y - u.y) * Math.min(1, dt * 12);
      if (u.speed > 0.3) {
        let da = Math.atan2(-qdx, -qdz) - u.yaw;
        da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
        u.yaw += da * Math.min(1, dt * (2.5 + u.speed * 0.45)); // pas de pivot sur place
      }
    }
    u.d = nd; u.rem = end - u.s;
    const v = u.v;
    v.setTransform(u.x, u.z, u.yaw, u.speed, u.y);
    v.pos.y = u.y;
    // contrôle : tout près d'un joueur quasi arrêté depuis 2 s (une émission par arrêt)
    if (level && nd < STOP_DIST && vP < STOP_SPEED) {
      u.stopT += dt;
      if (u.stopT >= STOP_TIME && !u.stopSent) { u.stopSent = true; return true; }
    } else { u.stopT = 0; u.stopSent = false; }
    return false;
  }

  function update(dt) {
    now += dt;
    if (!readPlayer(dt)) return;
    const jumped = trace();
    if (stallT > 0) stallT -= dt;
    for (let i = retiring.length - 1; i >= 0; i--) {
      const u = retiring[i];
      u.retireT -= dt;
      if (u.retireT <= 0 || !T.inView(u.x, u.z, u.y)) { retiring.splice(i, 1); removeUnit(u); }
    }
    if (!active) return;
    if (vP > vCap + FLEE_PLUS) fled = true; // le joueur a pris la fuite (verrou levé au prochain start())
    ground();
    if (jumped) {
      // joueur téléporté : les unités sont restées là-bas, on repart d'une apparition neuve
      while (units.length) { const u = units.pop(); vehicles.pop(); removeUnit(u); }
      spawnT = 1;
    }
    if ((checkT -= dt) <= 0) {
      // (une fois par seconde) véhicule retiré par un autre module : l'unité est perdue, une relève viendra
      checkT = 1;
      const list = ctx.vehicles.list;
      for (let i = units.length - 1; i >= 0; i--) if (list && list.indexOf(units[i].v) < 0) { const u = units[i]; units.splice(i, 1); vehicles.splice(i, 1); removeUnit(u); spawnT = Math.max(spawnT, 2); }
    }
    if (units.length < want && (spawnT -= dt) <= 0) spawnT = spawnUnit() ? RESPAWN : 0.5;
    let stopped = null, dmin = Infinity;
    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i];
      if (drive(u, dt)) stopped = u.v;
      if (u.d > LOST_DIST) { u.lostT += dt; if (u.lostT > LOST_TIME) { units.splice(i, 1); vehicles.splice(i, 1); removeUnit(u); spawnT = Math.max(spawnT, 4); continue; } }
      else u.lostT = 0;
      if (u.d < dmin) dmin = u.d;
    }
    dist = dmin;
    // émis hors de la boucle : l'auditeur (gameplay) peut appeler stop() tout de suite
    if (stopped) ctx.bus.emit('police:stop', { vehicle: stopped });
  }

  const api = {
    /** Lance la poursuite (1 unité à 2 képis, 2 à 3). Appelé pendant une poursuite : simple setLevel. */
    start(level) {
      if (active) { api.setLevel(level); return true; }
      active = true; engaged = false; fled = false; stallT = 0; want = countFor(level);
      spawnT = spawnUnit() ? RESPAWN : 0.2; // la première unité part tout de suite (sinon nouvel essai dans 0,2 s)
      return true;
    },
    setLevel(level) {
      if (!active) return;
      want = countFor(level);
      while (units.length > want) { // la plus lointaine rentre au poste
        let k = 0;
        for (let i = 1; i < units.length; i++) if (units[i].d > units[k].d) k = i;
        dismiss(k);
      }
    },
    /** L'unité décroche (figure du joueur) : vitesse × 0,4 pendant `sec` secondes. */
    stall(sec) { if (active && sec > 0 && sec > stallT) stallT = Math.min(+sec, 10); },
    stop() {
      active = false; engaged = false; fled = false; want = 0; stallT = 0; dist = Infinity;
      while (units.length) dismiss(units.length - 1);
    },
    get active() { return active; },
    get engaged() { return engaged; },
    get dist() { return dist; },
    get units() { return vehicles; },
  };

  return {
    api, update,
    dispose() {
      active = false; engaged = false; dist = Infinity;
      while (units.length) { const u = units.pop(); vehicles.pop(); removeUnit(u); }
      while (retiring.length) removeUnit(retiring.pop());
    },
    _debug: { units, retiring, last, trace: { x: tX, y: tY, z: tZ, s: tS, get head() { return tHead; }, get count() { return tCount; } } },
  };
}

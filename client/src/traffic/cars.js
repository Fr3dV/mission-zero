// Trafic — voitures IA (cinématiques, suivies sur le graphe) et voitures garées.
//
// Une voiture suit une demi-arête `h` (voir graph.js) dans sa voie (décalage latéral à droite), puis une
// courbe de Bézier cubique qui la raccorde à la voie de la demi-arête suivante `next` (choisie à l'avance,
// avec `next2`, ce qui permet de freiner avant le virage, de réserver le carrefour ou de céder le passage).
//
// Hauteur (niveaux superposés) : y = relief de base + élévation interpolée sur l'arête (graph.nodeEle), recalée
// sur ctx.heightAt(x, z, y) quand la surface du module ville est à moins de 1,5 m. Deux véhicules ou piétons
// séparés de plus de 3 m en hauteur s'ignorent totalement.
//
// Règles de conduite :
//  - vitesse de la voie (maxspeed), accélération / freinage proportionnels, distance de sécurité en temps
//    (2 s sur voie rapide, 1 s en ville) ;
//  - carrefours urbains : réservation équitable (nodeCtl = CTL_LOCK) ;
//  - giratoires et convergences de voies rapides (CTL_YIELD) : pas de réservation, l'entrant cède le passage
//    à l'anneau / à la voie principale en ajustant sa vitesse (fermeture éclair), arrêt à la ligne si besoin ;
//  - voies rapides : changement de file réel (dépassement par la gauche, rabattement, voie de droite avant
//    de sortir), sortie décidée à l'avance (wantExit), clignotants ;
//  - accidents (contrat « Dégâts et impacts ») : voir crashCar / crashedTick / tryRecover ; contournement des
//    obstacles fixes (dodge), freinage d'urgence si le joueur coupe la route ;
//  - vol de voiture (contrat v3) : conducteur visible (vehicle.occupant) et ejectDriver.
import { VEHICLE_BY_ID } from '@shared/catalog.js';
import { baseHeightAt } from '@shared/terrain.js';
import { createCharacter } from '../player/index.js';
import { KIND_TRUNK, KIND_PEDESTRIAN, F_ROUND, F_TUNNEL, F_BRIDGE, F_FAST, F_ELEV, F_SERVICE, F_NOAI, F_UTURN, CTL_LOCK, CTL_YIELD } from './graph.js';
import { A_RESIDENTIAL, A_INDUSTRIAL, A_COMMERCIAL, A_NOGO } from './areas.js';

const ACC = 2.3;          // accélération douce (m/s²)
const BRAKE = 2.8;        // freinage de confort (m/s²)
const BRAKE_MAX = 9;      // freinage d'urgence (m/s²)
const D_TURN = 10;        // distance max (m) avant/après le nœud sur laquelle s'étale un virage
const MIN_GAP = 2.3;      // distance pare-chocs à pare-chocs à l'arrêt (m)
const LOCK_TIMEOUT = 9;   // un verrou de carrefour expire tout seul (s)
const WAIT_MAX = 7;       // attente max à un carrefour avant de forcer le passage (s)
const FAR = 90000;        // « garage » hors du monde pour les voitures du pool inactives
const LEVEL = 3;          // écart vertical (m) au-delà duquel deux usagers s'ignorent
const PATH_MAX = 28;      // arêtes d'anticipation (voie rapide : ~330 m, même quand les segments font 12 m)

const DRIVER_TOPS = ['#2b3a55', '#6b1f2a', '#3d5a45', '#1f1f24', '#7a7f8a', '#b04a3a', '#3f6a8a', '#d9d2c5', '#5b4a6e'];
const DRIVER_SKINS = ['#f1c9a5', '#e0ac7e', '#c68d5e', '#9a6a44', '#6e4a2f'];
const PARKED = { parked: true }; // marqueur dans T.owner pour les voitures garées intactes

export function createCars(T) {
  const { ctx, G } = T;
  const { hTo, hUx, hUz, hLen, hDrive, hLanes, hOff0, hLaneW, hSpeed, hWidth, hKind, hFlag, hPrio, outStart, outList, nodeCtl, nodeRadius, eCars } = G;
  const { lockIn, lockOut, lockCnt, lockT, lockGen } = G;
  const lockWaitIn = new Int32Array(G.nodeCount).fill(-1), lockWaitT = new Float32Array(G.nodeCount);
  const cars = [];       // tous les états (actifs ou en réserve)
  const active = [];     // véhicules IA actifs (exposé : traffic.cars)
  const loose = [];      // véhicules « empruntés » puis abandonnés : on ne les pilote plus
  const parked = [];     // { v, x, z }
  const tmp = { e: 0, s: 0, x: 0, z: 0 };
  const tmpN = { h: -1, s: 0, d: 0, lat: 0 };
  let targetCars = 0, targetParked = 0, activeCount = 0, slowTimer = 0, frame = 0, pickedExit = false, fastCount = 0, rebalT = 0;

  // Composition du parc selon la ville (T.tune.types) ; types absents du catalogue ignorés.
  const TYPES = (T.tune.types || [['citadine', 1]]).filter(([id]) => VEHICLE_BY_ID[id]);
  const TYPE_TOTAL = TYPES.reduce((a, t) => a + t[1], 0) || 1;
  const PARK_TYPES = (T.tune.parkTypes || ['citadine']).filter((id) => VEHICLE_BY_ID[id]);
  function pickType() {
    let r = Math.random() * TYPE_TOTAL;
    for (const t of TYPES) { r -= t[1]; if (r <= 0) return t[0]; }
    return TYPES[0] ? TYPES[0][0] : 'citadine';
  }

  // ---------------------------------------------------------------- verrous de carrefour
  // Une voiture détient au plus deux verrous : le carrefour au bout de son arête (lockNode) et, si l'arête
  // suivante est trop courte pour s'y arrêter, celui d'après (lock2).
  const isFree = (node) => lockCnt[node] <= 0 || T.now - lockT[node] > LOCK_TIMEOUT;
  /** Peut-on s'engager ? Libre, même entrée (file de voitures) ou trajet exactement inverse (croisement sans conflit). */
  function canLock(node, hin, hout) {
    // équité : si une voiture d'une autre entrée attend déjà, on ne se joint pas au flot en cours et on ne lui
    // passe pas devant quand le carrefour se libère (sinon un flot continu affamerait les rues transversales)
    const waiting = lockWaitIn[node] >= 0 && lockWaitIn[node] !== hin && T.now - lockWaitT[node] < 1;
    if (waiting) return false;
    return isFree(node) || lockIn[node] === hin || (lockIn[node] === (hout ^ 1) && lockOut[node] === (hin ^ 1));
  }
  function waitFor(node, hin) {
    if (lockWaitIn[node] < 0 || lockWaitIn[node] === hin || T.now - lockWaitT[node] > 1) { lockWaitIn[node] = hin; lockWaitT[node] = T.now; }
  }
  function takeLock(node, hin, hout) {
    if (lockWaitIn[node] === hin) lockWaitIn[node] = -1;
    if (isFree(node)) { lockIn[node] = hin; lockOut[node] = hout; lockCnt[node] = 1; lockGen[node]++; }
    else lockCnt[node]++;
    lockT[node] = T.now;
    return lockGen[node];
  }
  function dropLock(node, gen, forced) {
    if (node >= 0 && !forced && lockGen[node] === gen && lockCnt[node] > 0) lockCnt[node]--;
  }
  function release(c) { dropLock(c.lockNode, c.lockGen, c.forced); c.lockNode = -1; c.forced = false; }
  function release2(c) { dropLock(c.lock2, c.lock2Gen, c.forced2); c.lock2 = -1; c.forced2 = false; }

  // ---------------------------------------------------------------- itinéraire
  /**
   * Sortie au bout de la demi-arête h, prise depuis la voie `lane` (jamais de demi-tour, sauf cul-de-sac). −1 si impasse.
   *  - voie rapide : on reste sur la voie principale, sauf si la voiture a décidé de sortir (c.wantExit) ET se
   *    trouve déjà sur la file du côté de la bretelle ; à une bifurcation, la file choisit la branche ;
   *  - giratoire : sortie au hasard, un peu plus probable que de continuer sur l'anneau ;
   *  - ailleurs : au hasard, de préférence à peu près tout droit et vers les grands axes.
   * Positionne `pickedExit` quand la sortie quitte une voie rapide.
   */
  function pick(c, h, lane) {
    const node = hTo[h], ux = hUx[h], uz = hUz[h], k0 = outStart[node], k1 = outStart[node + 1];
    pickedExit = false;
    let n = 0, only = -1;
    for (let k = k0; k < k1; k++) { const o = outList[k]; if (hDrive[o] && o !== (h ^ 1) && !(hFlag[o] & F_NOAI)) { n++; only = o; } }
    if (n === 0) return hDrive[h ^ 1] ? h ^ 1 : -1; // cul-de-sac (ou voies interdites aux IA) : demi-tour
    if (n === 1) return only;

    if (hKind[h] >= KIND_TRUNK && (hFlag[h] & F_FAST) && !hDrive[h ^ 1]) {
      // chaussée de voie rapide : voie principale (la plus alignée) contre bretelles
      let main = -1, mainCos = -2, mains = 0, exit = -1, exits = 0, second = -1;
      for (let k = k0; k < k1; k++) {
        const o = outList[k];
        if (!hDrive[o] || o === (h ^ 1)) continue;
        const cos = ux * hUx[o] + uz * hUz[o];
        if (hKind[o] >= KIND_TRUNK) { mains++; if (cos > mainCos) { second = main; mainCos = cos; main = o; } else second = o; }
        else { exits++; if (Math.random() * exits < 1) exit = o; }
      }
      if (mains === 1 && exits > 0) {
        const right = ux * hUz[exit] - uz * hUx[exit] > 0;
        const onSide = right ? lane >= hLanes[h] - 1 : lane <= 0;
        if (c.wantExit && onSide) { c.wantExit = false; pickedExit = true; return exit; }
        if (!c.wantExit) c.wantExit = Math.random() < T.tune.exitProb; // prochaine sortie ?
        return main;
      }
      if (mains === 2 && exits === 0) {
        // bifurcation : files de gauche vers la branche de gauche, files de droite vers celle de droite
        const sa = ux * hUz[main] - uz * hUx[main], sb = ux * hUz[second] - uz * hUx[second];
        const left = sa < sb ? main : second, rightB = sa < sb ? second : main;
        const share = hLanes[left] / (hLanes[left] + hLanes[rightB]);
        return (lane + 0.5) / hLanes[h] < share ? left : rightB;
      }
    }
    const ring = hFlag[h] & F_ROUND;
    let total = 0, best = -1;
    for (let k = k0; k < k1; k++) {
      const o = outList[k];
      if (!hDrive[o] || o === (h ^ 1) || (hFlag[o] & F_NOAI)) continue;
      const cos = ux * hUx[o] + uz * hUz[o];
      let w;
      if (ring) w = hFlag[o] & F_ROUND ? (c.ringN > 14 ? 0.05 : 1) : 1.3;
      else w = (cos < -0.7 ? 0.04 : 0.45 + Math.max(0, cos) * 1.4) * (0.5 + 0.5 * hLanes[o]);
      if ((hFlag[o] & F_SERVICE) && !(hFlag[h] & F_SERVICE)) w *= 0.04; // on n'entre pas dans une desserte pour transiter
      total += w;
      if (Math.random() * total < w) best = o;
    }
    return best;
  }
  /** Voie d'arrivée sur n en venant de la voie `lane` de h (alignement à droite ou à gauche selon le mouvement). */
  function laneMap(h, n, lane) {
    const la = hLanes[h], lb = hLanes[n];
    if (lb === la) return lane;
    const sin = hUx[h] * hUz[n] - hUz[h] * hUx[n]; // > 0 : on tourne à droite
    if (lb < la) return sin > 0.05 ? Math.max(0, lane - (la - lb)) : Math.min(lane, lb - 1);
    // plus de voies : en venant de la droite (bretelle d'insertion, virage à droite) on prend les files de droite
    return sin > 0.02 ? lane + (lb - la) : lane;
  }
  /** Calcule l'itinéraire proche : virage courant h→next, suivant next→next2, et chemin d'anticipation. */
  function plan(c) {
    c.waitT = 0;
    setupTurn(c, c.h, c.next, c.lane, c);
    if (c.next >= 0) { c.next2 = pick(c, c.next, c.nextLane); c.exit2 = pickedExit; setupTurn(c, c.next, c.next2, c.nextLane, c.t2); }
    else { c.next2 = -1; c.exit2 = false; }
    buildPath(c);
  }
  /** Même itinéraire, autre file : seule la géométrie est recalculée. */
  function replan(c) {
    setupTurn(c, c.h, c.next, c.lane, c);
    if (c.next >= 0) setupTurn(c, c.next, c.next2, c.nextLane, c.t2);
    buildPath(c);
  }
  /** Mémorise l'insertion à venir : arête rejointe (indice k du chemin), sa géométrie et la position de la bande d'accélération. */
  function setMerge(c, k, a, off, side) {
    c.mk = k; c.mSide = side; c.mOff = off + side * hLaneW[a];
    c.mNx = G.nx[G.hFrom[a]]; c.mNz = G.nz[G.hFrom[a]]; c.mUx = hUx[a]; c.mUz = hUz[a];
  }
  /**
   * Chemin d'anticipation : h, next, next2 (itinéraire décidé), puis — sur voie rapide ou autour d'un giratoire — la
   * suite la plus probable (tout droit / l'anneau), avec pour chaque arête : distance depuis l'origine de h (pathS),
   * décalage latéral de notre file (pathOff) et vitesse maximale à son entrée (pathV, courbes comprises).
   * Repère aussi une insertion par bretelle sur le chemin (mk) : à l'approche, la voiture longe la voie rapide sur la
   * bande d'accélération, à côté de la file de rive, au lieu de suivre l'axe de la bretelle qui vient mourir en
   * biais sur l'axe de la chaussée (voir writePose).
   */
  function buildPath(c) {
    const p = c.path, ps = c.pathS, po = c.pathOff, pv = c.pathV, h = c.h;
    let n = 1;
    p[0] = h; ps[0] = 0; po[0] = hOff0[h] + c.lane * hLaneW[h]; pv[0] = 99;
    c.offN1 = 0; c.offN2 = 0; c.mk = 0;
    if (c.next >= 0) {
      const a = c.next;
      p[1] = a; ps[1] = c.sEnd + c.curveEst - c.nextS; po[1] = c.offN1 = hOff0[a] + c.nextLane * hLaneW[a]; pv[1] = 99; n = 2;
      if (c.acc !== 0) setMerge(c, 1, a, po[1], c.acc);
      if (c.next2 >= 0) {
        const b = c.next2, t2 = c.t2;
        p[2] = b; ps[2] = ps[1] + t2.sEnd + t2.curveEst - t2.nextS; po[2] = c.offN2 = hOff0[b] + t2.nextLane * hLaneW[b]; pv[2] = 99; n = 3;
        if (c.mk === 0 && t2.acc !== 0) { setMerge(c, 2, b, po[2], t2.acc); c.vCurve = 99; }
        const fl = hFlag[h] | hFlag[a] | hFlag[b];
        if (fl & (F_FAST | F_ROUND)) {
          // au-delà de next2 l'itinéraire n'est pas encore tiré : on suppose que l'on continue (tout droit, ou sur l'anneau)
          const maxD = fl & F_FAST ? 330 : 70;
          let cur = b, lane = t2.nextLane, dist = ps[2];
          while (n < PATH_MAX && dist < maxD) {
            const node = hTo[cur];
            let best = -1, bc = 0.3, bcos = 1;
            for (let k = outStart[node]; k < outStart[node + 1]; k++) {
              const o = outList[k];
              if (!hDrive[o] || o === (cur ^ 1)) continue;
              const cos = hUx[cur] * hUx[o] + hUz[cur] * hUz[o];
              const sc = cos + (hKind[o] === hKind[cur] ? 0.2 : 0) + (hFlag[o] & hFlag[cur] & F_ROUND ? 0.6 : 0);
              if (sc > bc) { bc = sc; best = o; bcos = cos; }
            }
            if (best < 0) break;
            const len = hLen[cur], nl = laneMap(cur, best, lane);
            dist += len;
            // vitesse à l'entrée de cette arête : la sienne, et celle de la courbe que dessinent les segments
            let v = hSpeed[best] * c.pers;
            if (bcos < 0.998) { const th = Math.acos(bcos < -1 ? -1 : bcos), R = th < 0.35 ? 0.8 * Math.min(len, hLen[best]) / th : D_TURN / Math.tan(th / 2), vc = Math.sqrt(2.3 * R); if (vc < v) v = vc < 2.6 ? 2.6 : vc; }
            p[n] = best; ps[n] = dist; po[n] = hOff0[best] + nl * hLaneW[best]; pv[n] = v;
            if (c.mk === 0 && hLanes[best] > hLanes[cur] && nodeCtl[node] === CTL_YIELD && !hPrio[cur] && (hFlag[best] & F_FAST) && bcos > 0.55) {
              setMerge(c, n, best, po[n], nl > 0 ? 1 : -1);
              // le dernier segment d'une bretelle coupe en biais jusqu'à l'axe de la voie rapide : ce n'est pas un virage
              pv[n] = hSpeed[best] * c.pers; if (n > 3) pv[n - 1] = hSpeed[cur] * c.pers;
            }
            lane = nl; cur = best; n++;
          }
        }
      }
    }
    c.pathN = n;
    c.fast = (hFlag[h] & F_FAST) !== 0;
    // nœuds « cédez le passage » sur le chemin (3 au plus) : arête d'entrée k, et recul de la ligne où l'on attend —
    // là où notre voie est encore dégagée de la chaussée que l'on rejoint (loin en amont si l'on arrive en biais)
    let zn = 0;
    for (let k = 1; k < n && zn < 3; k++) {
      const a = p[k - 1], b = p[k];
      if (nodeCtl[hTo[a]] !== CTL_YIELD || k === c.mk) continue;
      const sin = Math.abs(hUx[a] * hUz[b] - hUz[a] * hUx[b]);
      c.zK[zn] = k; c.zBack[zn] = Math.min(45, (hWidth[b] * 0.5 + c.halfWid + 0.5) / (sin > 0.15 ? sin : 0.15)) + c.halfLen; zn++;
    }
    c.zN = zn;
  }
  /** Géométrie du virage h→n pris depuis la voie `lane` ; résultat écrit dans `out` (la voiture elle-même ou c.t2). */
  function setupTurn(c, h, n, lane, out) {
    const len = hLen[h], node = hTo[h];
    out.acc = 0;
    if (n < 0) { out.sEnd = Math.max(0, len - c.halfLen - 1); out.nextS = 0; out.nextLane = 0; out.vCurve = 0; out.theta = 0; out.curveEst = 0; out.sStop = out.sEnd; return; }
    const cos = Math.max(-1, Math.min(1, hUx[h] * hUx[n] + hUz[h] * hUz[n]));
    const theta = Math.acos(cos), uturn = n === (h ^ 1);
    const lenB = hLen[n];
    const nextLane = uturn ? Math.min(lane, hLanes[n] - 1) : laneMap(h, n, lane);
    out.theta = theta; out.nextLane = nextLane;
    // Par défaut : raccord centré sur le nœud (lignes quasi parallèles, demi-tour).
    // (tout droit : raccord court — l'essentiel de l'arête reste en ligne droite, où se gèrent priorités et files)
    let dWant = D_TURN;
    if (uturn) dWant = 3;
    else if (theta <= 0.12) {
      // (en ville, si la file se décale franchement d'une arête à l'autre, on laisse au raccord la place de le faire)
      const sh = Math.abs(hOff0[n] + nextLane * hLaneW[n] - hOff0[h] - lane * hLaneW[h]);
      dWant = hFlag[h] & F_FAST ? 3 : Math.min(D_TURN, 3 + sh * 1.5);
    }
    let d = Math.min(0.45 * len, 0.45 * lenB, dWant);
    let sEnd = len - d, nextS = d, R = uturn ? 2 : 1e6, arc = uturn ? 2 * d + 4 : 2 * d;
    if (!uturn && theta > 0.12) {
      // Congé symétrique autour de l'intersection I des deux lignes de voie (qui n'est pas le nœud dès que
      // les voies sont décalées de l'axe) : départ à I − d sur la voie A, arrivée à I + d sur la voie B.
      const offA = hOff0[h] + lane * hLaneW[h], offB = hOff0[n] + nextLane * hLaneW[n];
      const uax = hUx[h], uaz = hUz[h], ubx = hUx[n], ubz = hUz[n];
      const wx = G.pointX(n, 0, offB) - G.pointX(h, 0, offA), wz = G.pointZ(n, 0, offB) - G.pointZ(h, 0, offA);
      const D = uax * ubz - uaz * ubx;
      const sI = (wx * ubz - wz * ubx) / D, tI = (wx * uaz - wz * uax) / D;
      const dd = Math.min(D_TURN, sI - 0.55 * len, 0.45 * lenB - tI);
      if (dd > 0.4) { sEnd = sI - dd; nextS = tI + dd; R = dd / Math.tan(theta / 2); arc = R * theta; }
      else {
        // Arêtes trop courtes pour un congé propre : raccord direct, au pas.
        sEnd = Math.min(len, Math.max(0.55 * len, sI - 0.4)); nextS = Math.max(0, Math.min(0.45 * lenB, tI + 0.4)); R = 2;
        arc = Math.abs(sI - sEnd) + Math.abs(nextS - tI);
      }
    } else if (!uturn && theta > 0.06) R = d / Math.tan(theta / 2);
    out.sEnd = sEnd; out.nextS = nextS; out.curveEst = Math.max(0.5, arc);
    // Angle faible : ce n'est pas un coin de rue mais une courbe de la route découpée en segments ; son rayon réel
    // (≈ longueur des segments / angle) est bien plus grand que celui de notre petit congé de raccord.
    if (!uturn && theta > 0.06 && theta < 0.35) R = Math.max(R, 0.8 * Math.min(len, lenB) / theta);
    out.vCurve = R > 1e5 ? 99 : Math.max(2.6, Math.sqrt(2.3 * R));
    out.sStop = Math.max(0, Math.min(sEnd, len - nodeRadius[node] - 1.5) - c.halfLen);
    // Insertion sur une voie rapide (bretelle non prioritaire qui rejoint une chaussée plus large) : on arrive à côté
    // de la file de rive, sur la bande d'accélération, et l'on s'y insère ensuite quand un créneau se présente.
    if (!uturn && theta < 1 && hLanes[n] > hLanes[h] && nodeCtl[node] === CTL_YIELD && !hPrio[h] && (hFlag[n] & F_FAST)) { out.acc = nextLane > 0 ? 1 : -1; out.vCurve = 99; }
  }
  function enterCurve(c) {
    const h = c.h, n = c.next, b = c.bez;
    // extrémités : notre file sur chaque arête (à l'arrivée sur une voie rapide par une bretelle : la bande d'accélération)
    const offA = hOff0[h] + c.lane * hLaneW[h];
    const offB = hOff0[n] + c.nextLane * hLaneW[n] + c.acc * hLaneW[n];
    const p0x = G.pointX(h, c.sEnd, offA), p0z = G.pointZ(h, c.sEnd, offA);
    let p3x = G.pointX(n, c.nextS, offB), p3z = G.pointZ(n, c.nextS, offB);
    const th = c.theta;
    c.curveLat = 0;
    if (th < 0.3 && c.acc === 0) {
      // presque tout droit, mais la file change de position latérale (voie en plus ou en moins, sortie par une bretelle
      // dont l'axe part du milieu de la chaussée) : on garde sa trajectoire, et l'écart est résorbé ensuite en douceur
      // comme un changement de file (c.lc) — jamais d'un coup de volant. Mesuré perpendiculairement à la bissectrice.
      let bx = -hUz[h] - hUz[n], bz = hUx[h] + hUx[n]; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
      const lat = (p3x - p0x) * bx + (p3z - p0z) * bz;
      if (lat > 0.4 || lat < -0.4) {
        // (hors voie rapide, l'écart reporté est borné : au-delà, on se décale dans le raccord lui-même)
        const m = hFlag[h] & F_FAST ? 12 : 2, la = lat > m ? m : lat < -m ? -m : lat;
        c.curveLat = la; p3x += hUz[n] * la; p3z -= hUx[n] * la;
      }
    }
    const chord = Math.hypot(p3x - p0x, p3z - p0z);
    const k = th < 0.12 ? chord / 3 : Math.min(chord * (2 / 3) * Math.tan(th / 4) / Math.max(Math.sin(th / 2), 0.05), chord * 0.75);
    b[0] = p0x; b[1] = p0z; b[2] = p0x + hUx[h] * k; b[3] = p0z + hUz[h] * k;
    b[4] = p3x - hUx[n] * k; b[5] = p3z - hUz[n] * k; b[6] = p3x; b[7] = p3z;
    c.cLen = measure(c); c.cu = 0; c.phase = 1;
  }
  function place(c, h, s) {
    release(c); release2(c);
    const n = hLanes[h];
    // sur voie rapide, on roule plutôt à droite
    c.h = h; c.lane = hFlag[h] & F_FAST ? n - 1 - ((Math.random() * Math.random() * n) | 0) : (Math.random() * n) | 0; c.phase = 0;
    c.lc = 0; c.dodge = 0; c.merge = 0; c.mk = 0;
    c.wantExit = Math.random() < T.tune.exitProb; c.exit1 = c.exit2 = false; c.ringN = 0;
    c.next = pick(c, h, c.lane); c.exit1 = pickedExit;
    plan(c);
    c.s = Math.min(s, Math.max(0, c.sEnd - 1));
    // trop près d'un carrefour pour s'arrêter : départ arrêté (elle demandera la priorité comme les autres)
    c.speed = nodeCtl[hTo[h]] === CTL_LOCK && c.s > c.sStop - 14 ? 0 : hSpeed[h] * (c.fast ? 0.92 : 0.6) * c.pers;
    c.mode = 0; c.dodge = c.dodgeTarget = c.dodgeSlope = 0; c.emergT = 0; c.limpT = 0;
    c.lc = 0; c.lcSlope = 0; c.lcT = 2 + Math.random() * 4; c.curveLat = 0; c.blink = null; c.blinkT = 0; c.tp = 0;
    c.yieldV = 1e9; c.yieldD = 1e9; c.yieldT = 0; c.yieldIgnore = 0;
    c.stuckT = 0; c.idleT = 0; c.ignoreT = 0; c.blockT = 0; c.honkT = 2; c.gap = 1e9; c.blockKind = 0;
    c.scanT = Math.random() * 0.1; c.wantRecycle = false;
    writePose(c);
    c.yaw = Math.atan2(-c.fx, -c.fz);
    carY(c, true);
    if (c.v.controls) c.v.controls.blinker = null;
  }
  /** Calcule c.x, c.z (et le vecteur avant) depuis l'état de parcours. */
  function writePose(c) {
    if (c.phase === 0) {
      const h = c.h, off = hOff0[h] + c.lane * hLaneW[h];
      c.x = G.pointX(h, c.s, off); c.z = G.pointZ(h, c.s, off);
      c.fx = hUx[h]; c.fz = hUz[h];
      c.lat = off + c.lc + c.dodge;
    } else {
      const b = c.bez, u = c.cu, v = 1 - u;
      const a = v * v * v, bb = 3 * v * v * u, cc = 3 * v * u * u, dd = u * u * u;
      c.x = a * b[0] + bb * b[2] + cc * b[4] + dd * b[6]; c.z = a * b[1] + bb * b[3] + cc * b[5] + dd * b[7];
      const tx = 3 * v * v * (b[2] - b[0]) + 6 * v * u * (b[4] - b[2]) + 3 * u * u * (b[6] - b[4]);
      const tz = 3 * v * v * (b[3] - b[1]) + 6 * v * u * (b[5] - b[3]) + 3 * u * u * (b[7] - b[5]);
      const l = Math.hypot(tx, tz);
      if (l > 1e-4) { c.fx = tx / l; c.fz = tz / l; }
    }
    const side = c.dodge + c.lc;
    if (side !== 0 || c.dodgeSlope !== 0 || c.lcSlope !== 0) {
      // écart d'évitement ou changement de file : décalage perpendiculaire à la trajectoire, cap incliné pendant le déport
      const rx = -c.fz, rz = c.fx, k = c.dodgeSlope + c.lcSlope;
      c.x += rx * side; c.z += rz * side;
      if (k !== 0) { const n = 1 / Math.sqrt(1 + k * k); c.fx = (c.fx + rx * k) * n; c.fz = (c.fz + rz * k) * n; }
    }
    c.tp = 0;
    if (c.mk !== 0) {
      // Insertion : dès que l'axe de la bretelle passe en deçà de la bande d'accélération, on longe la voie rapide sur
      // cette bande (à une file de la file de rive) jusqu'au nœud, au lieu de couper les voies en biais.
      const ux = c.mUx, uz = c.mUz, dx = c.x - c.mNx, dz = c.z - c.mNz, fwd = -(dx * ux + dz * uz);
      if (fwd > -2 && fwd < 90) {
        const lat = dx * -uz + dz * ux, d = (c.mOff - lat) * c.mSide;
        if (d > 0) {
          const k = fwd > 70 ? (90 - fwd) / 20 : 1, t = d * k * c.mSide; // (prise en douceur)
          c.x += -uz * t; c.z += ux * t; c.tp = t;
          if (k === 1 && d > 0.3) { c.fx = ux; c.fz = uz; }
        }
      }
    }
  }
  /** Hauteur de la voiture : relief de base + élévation de son arête, recalée sur la surface du module ville si elle est proche. */
  function carY(c, force) {
    let e;
    if (c.phase === 0) e = G.eleAt(c.h, c.s);
    else if (c.phase === 1) { const a = G.eleAt(c.h, c.sEnd), b = G.eleAt(c.next, c.nextS); e = a + (b - a) * c.cu; }
    else e = c.ele + (G.eleAt(c.h, c.recS) - c.ele) * Math.min(1, c.cu);
    c.ele = e;
    let y = baseHeightAt(c.x, c.z) + e;
    if (force || ((frame + c.idx) & 1) === 0) {
      // surface du module ville si elle est toute proche (dévers, bordure) ; sinon on fait confiance à l'arête
      const yh = ctx.heightAt(c.x, c.z, y + 0.4), d = yh - y < 0.75 && y - yh < 0.75 ? yh - y : 0;
      c.yFix = force ? d : c.yFix + Math.max(-0.05, Math.min(0.05, d - c.yFix)); // recalage progressif, jamais de saut
    }
    c.y = y + c.yFix;
  }
  /** Pose envoyée au module véhicules. La hauteur est écrite dans v.pos.y (niveau courant de la voiture). */
  function send(c) {
    const v = c.v;
    v.setTransform(c.x, c.z, c.yaw, c.speed, c.y); // 5e paramètre : la hauteur (niveau de la voiture)
    v.pos.y = c.y;
    // Tant que le module véhicules ne pose pas ses voitures cinématiques sur LEUR niveau (pont, trémie), on corrige
    // le rendu nous-mêmes ; s'il le fait déjà, les hauteurs coïncident et l'on ne touche à rien.
    const g = v.group;
    if (g && (g.position.y - c.y > 0.5 || c.y - g.position.y > 0.5) && c.ele * c.ele > 1) {
      g.position.y = c.y;
      if (c.phase === 0) g.rotation.x = Math.atan2(G.nodeEle[hTo[c.h]] - G.nodeEle[G.hFrom[c.h]], hLen[c.h]);
    }
  }
  /** Longueur approchée de la courbe de Bézier courante (8 cordes). */
  function measure(c) {
    const b = c.bez; let L = 0, px = b[0], pz = b[1];
    for (let i = 1; i <= 8; i++) {
      const u = i / 8, v = 1 - u, a = v * v * v, bb = 3 * v * v * u, cc = 3 * v * u * u, dd = u * u * u;
      const x = a * b[0] + bb * b[2] + cc * b[4] + dd * b[6], z = a * b[1] + bb * b[3] + cc * b[5] + dd * b[7];
      L += Math.hypot(x - px, z - pz); px = x; pz = z;
    }
    return Math.max(0.5, L);
  }
  function setBlink(c, val) {
    if (c.blink === val || c.limpT > 0) return;
    c.blink = val;
    if (c.v.controls) c.v.controls.blinker = val;
  }

  // ---------------------------------------------------------------- accidents
  // mode 0 = conduite (cinématique) ; mode 1 = accidentée : la physique locale du module véhicules l'emporte.
  // sev 1 = accrochage (repart après 2–4 s), 2 = choc moyen (détresse, repart au ralenti ou reste), 3 = épave.
  function honk(c) { ctx.bus.emit('traffic:honk', { x: c.x, y: c.y, z: c.z, vehicle: c.v }); }
  function crashCar(c, impact, by, push) {
    if (!c || !c.active) return;
    const v = c.v;
    let sev = impact < 5 ? 1 : 2;
    if (v.wrecked || v.damage > 0.8) sev = 3; // épave : décidée par le module véhicules (ou dégâts quasi totaux)
    if (c.mode === 1) { if (sev > c.sev) { c.sev = sev; if (sev >= 2 && v.controls) v.controls.blinker = 'hazard'; } c.restT = 0; return; }
    release(c); release2(c);
    c.mode = 1; c.sev = sev; c.restT = 0; c.crashAge = 0; c.braked = false; c.fails = 0; c.merge = 0;
    c.phase = 0; c.dodge = c.dodgeTarget = c.dodgeSlope = 0; c.lc = c.lcSlope = 0; c.emergT = 0; c.limpT = 0; c.blink = null;
    c.stay = sev === 2 && Math.random() < (impact >= 11 ? 0.6 : 0.25); // choc violent : souvent immobilisée
    c.resumeT = sev === 1 ? 2 + Math.random() * 2 : 8 + Math.random() * 8;
    // on la rend au module véhicules : dynamique, sans conducteur
    v.remote = false; v.driver = null;
    if (v.setControls) v.setControls({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    if (v.controls) v.controls.blinker = null;
    if (v.phys) { v.phys.sleeping = false; v.phys.kinT = -1; }
    if (!v.vel) v.speed = 0; // module véhicules minimal (sans physique) : elle s'arrête net
    if (push && by && v.vel) {
      // repli tant que le module véhicules n'applique pas lui-même l'impulsion (pas de vehicle:hit)
      const bvx = by.vel ? by.vel.x : -Math.sin(by.yaw) * (by.speed || 0), bvz = by.vel ? by.vel.z : -Math.cos(by.yaw) * (by.speed || 0);
      const rx = bvx - v.vel.x, rz = bvz - v.vel.z;
      v.vel.x += rx * 0.55; v.vel.z += rz * 0.55;
      if (typeof v.yawRate === 'number') {
        const ox = by.pos.x - v.pos.x, oz = by.pos.z - v.pos.z;
        v.yawRate = Math.max(-2.5, Math.min(2.5, (ox * rz - oz * rx) * 0.12));
      }
    }
    if (sev >= 2) { if (v.controls) v.controls.blinker = 'hazard'; honk(c); }
    // les voitures voisines (du même niveau) réagissent : coup de frein, parfois klaxon
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (!o.active || o === c || o.mode !== 0 || o.y - c.y > LEVEL || c.y - o.y > LEVEL) continue;
      const dx = o.x - c.x, dz = o.z - c.z, r = 28 + o.speed * 2;
      if (dx * dx + dz * dz > r * r || dx * o.fx + dz * o.fz > 0) continue; // seulement celles qui arrivent dessus
      o.emergT = 0.5 + Math.random() * 0.4;
      if (Math.random() < 0.4 && o.honkT <= 0) { o.honkT = 5; honk(o); }
    }
    if (T.alarm) T.alarm(c.x, c.z, impact, false, c.y);
  }
  /** Le conducteur reprend la route depuis la position réelle : arête la plus proche (de son niveau), courbe douce vers sa voie. */
  function tryRecover(c) {
    const v = c.v, fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const ele = v.pos.y - baseHeightAt(v.pos.x, v.pos.z);
    if (!G.nearest(v.pos.x, v.pos.z, 14, tmpN, true, fx, fz, ele)) return false;
    const h = tmpN.h;
    if (fx * hUx[h] + fz * hUz[h] < -0.15) return false; // à contresens : trop de manœuvres
    const lane = Math.max(0, Math.min(hLanes[h] - 1, Math.round((tmpN.lat - hOff0[h]) / hLaneW[h])));
    const off = hOff0[h] + lane * hLaneW[h];
    const oh = c.h, ol = c.lane, on = c.next;
    c.h = h; c.lane = lane; c.mk = 0; c.next = pick(c, h, lane); c.exit1 = pickedExit; plan(c);
    const s1 = Math.min(tmpN.s + Math.max(8, Math.min(16, 7 + Math.abs(tmpN.lat - off) * 2.5)), c.sEnd - 1);
    if (c.next < 0 || s1 - tmpN.s < 4) { c.h = oh; c.lane = ol; c.next = on; return false; }
    const b = c.bez, tx = G.pointX(h, s1, off), tz = G.pointZ(h, s1, off);
    const k = Math.hypot(tx - v.pos.x, tz - v.pos.z) / 3;
    b[0] = v.pos.x; b[1] = v.pos.z; b[2] = v.pos.x + fx * k; b[3] = v.pos.z + fz * k;
    b[4] = tx - hUx[h] * k; b[5] = tz - hUz[h] * k; b[6] = tx; b[7] = tz;
    c.cLen = measure(c); c.cu = 0; c.phase = 2; c.recS = s1; c.ele = ele;
    c.mode = 0; c.speed = 0; c.x = v.pos.x; c.z = v.pos.z; c.yaw = v.yaw; c.fx = fx; c.fz = fz;
    c.stuckT = c.idleT = c.blockT = 0; c.gap = 1e9; c.scanT = 0; c.wantRecycle = false; c.lc = c.lcSlope = 0; c.blink = null;
    c.limpT = c.sev >= 2 ? 40 : 0;
    v.remote = true; v.driver = 'ai';
    if (v.controls) v.controls.blinker = c.sev >= 2 ? 'hazard' : null;
    return true;
  }
  /** Voiture accidentée : on suit sa position physique et on décide de la suite. */
  function crashedTick(c, dt) {
    const v = c.v;
    c.x = v.pos.x; c.y = v.pos.y; c.z = v.pos.z; c.yaw = v.yaw; c.fx = -Math.sin(v.yaw); c.fz = -Math.cos(v.yaw); c.speed = v.speed || 0;
    c.crashAge += dt;
    if (v.wrecked || v.damage > 0.8) { if (c.sev < 3 && v.controls) v.controls.blinker = 'hazard'; c.sev = 3; }
    if (!c.braked && c.crashAge > 0.7) { c.braked = true; if (v.setControls) v.setControls({ brake: 0.7 }); } // le conducteur freine
    const moving = v.vel ? Math.abs(v.vel.x) + Math.abs(v.vel.z) > 0.4 || Math.abs(v.yawRate || 0) > 0.3 : Math.abs(c.speed) > 0.3;
    c.restT = moving ? 0 : c.restT + dt;
    if (c.sev < 3 && !c.stay && c.restT > c.resumeT) {
      if (!tryRecover(c)) { c.restT = 0; c.resumeT = 5; if (++c.fails >= 2) { c.stay = true; if (v.controls) v.controls.blinker = 'hazard'; } }
    }
  }

  // ---------------------------------------------------------------- perception
  function scan(c) {
    const fx = c.fx, fz = c.fz, rx = -fz, rz = fx, cy = c.y;
    const look = 9 + c.speed * 2.4, R = look + 12, RP = c.fast ? R + 160 : R;
    const hl = c.halfLen, hw = c.halfWid;
    let gap = 1e9, gs = 0, kind = 0;
    let obs = false, obsL = 0, obsE = 0, obsX = 0, obsZ = 0; // obstacle fixe que l'on peut contourner
    const offPath = c.phase === 2 || c.dodge !== 0;
    // abscisse équivalente sur le chemin, distances restantes jusqu'aux deux prochains nœuds
    const sEff = c.phase === 0 ? c.s : c.sEnd + c.cu * c.curveEst;
    const dA = c.phase === 0 ? c.sEnd - c.s + c.curveEst : (1 - c.cu) * c.cLen;
    const t2 = c.t2, dB = c.next2 >= 0 ? dA + Math.max(0, t2.sEnd - c.nextS) + t2.curveEst : 1e9;
    const myLat = c.lc + c.dodge;
    let yv = 1e9, yStop = 1e9;
    const zN = c.yieldIgnore > 0 || offPath ? 0 : c.zN; // nœuds « cédez le passage » devant nous

    // 1) autres voitures IA
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (!o.active || o === c) continue;
      if (o.y - cy > LEVEL || cy - o.y > LEVEL) continue; // autre niveau (pont, trémie) : elle n'existe pas pour nous
      const dx = o.x - c.x, dz = o.z - c.z;
      if (dx > RP || dx < -RP || dz > RP || dz < -RP) continue;
      let g = 1e9, s2 = 0, isObs = false, sl = 0, ext = 0, handled = false;
      const free = offPath || o.mode !== 0 || o.phase === 2 || o.dodge !== 0; // hors itinéraire : couloir seulement
      if (!free) {
        // a) sur notre chemin (fiable dans les courbes et sur plusieurs arêtes) : même file = écart latéral < 2 m
        const oh = o.h, path = c.path, n = c.pathN;
        for (let k = 0; k < n; k++) {
          if (path[k] !== oh) continue;
          handled = true;
          const oS = o.phase === 0 ? o.s : o.sEnd + o.cu * o.curveEst;
          const dist = c.pathS[k] + oS - sEff, dl = k === 0 && c.phase === 0 ? o.lat - c.lat : o.lat - c.pathOff[k] - myLat;
          if (dl < 2 && dl > -2) { if (dist > 0 || (dist === 0 && o.idx < c.idx)) { g = dist - hl - o.halfLen; s2 = o.speed; } }
          else if (k === 0 && c.next >= 0 && o.next === c.next && o.nextLane === c.nextLane) {
            // files qui convergent vers la même voie : la plus engagée passe devant
            const remO = o.phase === 0 ? o.sEnd - o.s + o.curveEst : (1 - o.cu) * o.cLen;
            if (remO < dA || (remO === dA && o.idx < c.idx)) { g = dA - remO - hl - o.halfLen; s2 = o.speed; }
          }
          break;
        }
        // b) convergence vers une même voie sans réservation (giratoire, insertion) : fermeture éclair avec priorités.
        //    Les nœuds « cédez le passage » de notre chemin sont cherchés dans le chemin d'anticipation de l'autre.
        if (!handled && zN > 0) {
          const op = o.path, on = o.pathN, cp = c.path;
          for (let i = 0; i < zN && !handled; i++) {
            const zk = c.zK[i], tgt = cp[zk];
            for (let k = 1; k < on; k++) {
              if (op[k] !== tgt) continue;
              if (op[k - 1] === cp[zk - 1] || o.mk === k || Math.abs(o.pathOff[k] - c.pathOff[zk]) >= 2) break;
              // même mesure des deux côtés : distance jusqu'à l'origine de l'arête visée
              let dc = c.pathS[zk] - sEff, d0 = o.pathS[k] - (o.phase === 0 ? o.s : o.sEnd + o.cu * o.curveEst);
              if (dc < 0) dc = 0; if (d0 < 0) d0 = 0;
              const pc = hPrio[cp[zk - 1]], po = hPrio[op[k - 1]];
              handled = true;
              // (temps pour atteindre le nœud ; à l'arrêt on compte un démarrage franc, sinon un anneau chargé ne laisserait jamais entrer)
              const vc = c.speed, vo = o.speed, tc = dc / (vc > 3.5 ? vc : 3.5), to = d0 / (vo > 3.5 ? vo : 3.5);
              let ahead;
              if (po > pc) ahead = to < tc + 1 + 0.25 * (vo > vc ? vo - vc : 0);        // prioritaire et assez proche : il passe
              else if (po < pc) ahead = to + 1 + 0.25 * (vc > vo ? vc - vo : 0) < tc;   // non prioritaire mais nettement en avance
              else ahead = d0 < dc || (d0 === dc && o.idx < c.idx);
              if (ahead) {
                const gv = dc - d0 - hl - o.halfLen;
                if (gv > MIN_GAP) { g = gv; s2 = vo; }
                else {
                  // côte à côte : on se laisse glisser derrière lui ; sans priorité, on ne franchit pas la ligne avant lui
                  const vf = vo - 2.5; if (vf < yv) yv = vf > 0 ? vf : 0;
                  if (pc <= po) { const dl = dc - c.zBack[i]; if (dl > -1.5 && dl < yStop) yStop = dl; }
                }
              }
              break;
            }
          }
        }
      }
      if (handled) { if (g >= 1e9) continue; } // sur notre chemin, mais pas devant nous dans notre file
      else {
        // c) couloir droit devant (trafic transversal, véhicules hors itinéraire)
        const f = dx * fx + dz * fz;
        if (f < 0 || (f < 0.02 && c.idx < o.idx) || f > look + o.halfLen) continue;
        const hd = fx * o.fx + fz * o.fz;
        if (hd < -0.8 && !free) continue;         // en face : elle est dans l'autre sens
        const cross = hd < 0.7 && hd > -0.7;
        if (c.ignoreT > 0 && o.mode === 0 && (cross || o.speed < 0.5)) continue; // sortie d'interblocage
        // trajectoires qui convergent : si chacune voit l'autre « devant », la plus engagée passe, l'autre attend
        sl = dx * rx + dz * rz; ext = cross ? o.halfLen : o.halfWid;
        const l = Math.abs(sl);
        // (seulement si elle est à côté de nous, pas déjà dans notre couloir)
        if (hd > 0 && hd < 0.98 && !free && l > hw) { const fo = -(dx * o.fx + dz * o.fz); if (fo > f + 0.05 || (fo > f - 0.05 && c.idx < o.idx)) continue; }
        // (tolérance élargie de près pour un véhicule arrêté sur lequel on se rabattrait en tournant)
        if (l > hw + ext + 0.3 + (f < 6 && o.speed < 1.5 ? (6 - f) * 0.1 : 0)) continue;
        g = f - hl - (cross ? o.halfWid + 0.6 : o.halfLen);
        s2 = Math.max(0, o.speed * hd);
        isObs = o.mode === 1 && Math.abs(o.speed) < 0.5; // accidentée à l'arrêt : contournable
      }
      if (g < gap) { gap = g; gs = s2 > 0 ? s2 : 0; kind = 1; obs = isObs; if (isObs) { obsL = sl; obsE = ext; obsX = o.x; obsZ = o.z; } }
    }

    // 2) véhicules non pilotés par le trafic (joueur local, joueurs distants, voitures abandonnées)
    const list = ctx.vehicles && ctx.vehicles.list, player = ctx.player;
    const pv = player && player.vehicle;
    if (list) for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (T.owner.has(v)) continue;
      const dx = v.pos.x - c.x, dz = v.pos.z - c.z;
      if (dx > R || dx < -R || dz > R || dz < -R) continue;
      if (v.pos.y - cy > LEVEL || cy - v.pos.y > LEVEL) continue;
      const spec = v.spec, ohl = spec ? spec.length * 0.5 : 2.2, ohw = spec ? spec.width * 0.5 : 0.95;
      const isPlayer = v === pv || v.driver === 'local';
      const sp = v.speed || 0;
      const ofx = -Math.sin(v.yaw), ofz = -Math.cos(v.yaw);
      const ovx = v.vel ? v.vel.x : ofx * sp, ovz = v.vel ? v.vel.z : ofz * sp;
      const f = dx * fx + dz * fz, sl = dx * rx + dz * rz;
      // repli : contact franc avec un véhicule rapide, sans événement vehicle:hit → même traitement qu'un choc
      const rvx = ovx - fx * c.speed, rvz = ovz - fz * c.speed, rel = Math.hypot(rvx, rvz);
      // (module véhicules sans applyImpulse = ancienne version ou repli de la page de debug ; sinon vehicle:hit fait foi)
      if (!v.applyImpulse && rel > 3 && Math.abs(f) < hl + ohl * 0.9 && Math.abs(sl) < hw + ohw * 0.9 && dx * rvx + dz * rvz < 0) { crashCar(c, rel * 0.8, v, true); return; }
      const hd = fx * ofx + fz * ofz, along = Math.abs(hd) > 0.7, ext = along ? ohw : ohl;
      // anticipation : un véhicule rapide (joueur) qui arrive en face ou coupe la route → freinage d'urgence, écart
      if (Math.abs(sp) > 3 && c.speed > 1 && (isPlayer || v.driver != null)) {
        for (let t = 0.5; t < 1.6; t += 0.5) {
          const px = dx + rvx * t, pz = dz + rvz * t, f2 = px * fx + pz * fz;
          if (f2 < -hl || f2 > hl + ohl + 1.5 || Math.abs(px * rx + pz * rz) > hw + ext + 0.4) continue;
          if (f < 0 && hd > 0.5) break; // il nous rattrape par derrière : freiner n'aiderait pas
          c.emergT = 0.6; kind = 2; c.blockKind = 2;
          if (c.honkT <= 0) { c.honkT = 4; honk(c); }
          if (c.dodgeTarget === 0 && c.phase === 0 && c.lc === 0) swerve(c, sl >= 0 ? -1 : 1, v.pos.x, v.pos.z);
          break;
        }
      }
      if (f <= 0.5 || f > look + ohl) continue;
      const l = Math.abs(sl);
      if (l > hw + ext + 0.35) continue;
      const g = f - hl - (along ? ohl : ohw + 0.5);
      if (g < gap) {
        gap = g; gs = Math.max(0, sp * hd); kind = isPlayer ? 2 : 1;
        // à l'arrêt et vide (épave, voiture abandonnée) — ou joueur qui bloque depuis longtemps : contournable
        obs = Math.abs(sp) < 0.4 && (v.driver == null || c.blockT > 4);
        if (obs) { obsL = sl; obsE = ext; obsX = v.pos.x; obsZ = v.pos.z; }
      }
    }

    // 3) joueur à pied
    if (player && player.pos && !pv && !(player.pos.y - cy > LEVEL || cy - player.pos.y > LEVEL)) {
      const dx = player.pos.x - c.x, dz = player.pos.z - c.z, f = dx * fx + dz * fz;
      // joueur à pied tout près d'une portière d'une voiture à l'arrêt : elle attend ~2 s de plus (et klaxonne)
      if (c.speed < 1.5 && c.holdCd <= 0 && Math.abs(f) < hl + 0.8 && Math.abs(dx * rx + dz * rz) < hw + 2.5) {
        c.holdT = 2; c.holdCd = 9;
        if (c.honkT <= 0) { c.honkT = 4; honk(c); }
      }
      if (f > 0.5 && f < look && Math.abs(dx * rx + dz * rz) < hw + 0.7) {
        const g = f - hl - 0.6;
        if (g < gap) { gap = g; gs = 0; kind = 2; obs = false; }
      }
    }

    // 4) piétons devant le capot
    const peds = T.peds;
    if (peds) for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p.active) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      if (dx > R || dx < -R || dz > R || dz < -R) continue;
      if (p.y - cy > LEVEL || cy - p.y > LEVEL) continue;
      const f = dx * fx + dz * fz;
      if (f <= 0.5 || f > look) continue;
      // sur la chaussée (traversée, chute, fuite) : marge large ; sinon seulement s'il est vraiment devant le capot
      if (Math.abs(dx * rx + dz * rz) > hw + (p.onRoad ? 1.1 : c.phase === 1 ? 0.9 : 0.45)) continue;
      const g = f - hl - 1.2;
      if (g < gap) {
        gap = g; gs = 0; kind = 3;
        obs = p.mode === 1; // piéton à terre : on le contourne
        if (obs) { obsL = dx * rx + dz * rz; obsE = 0.9; obsX = p.x; obsZ = p.z; }
      }
    }
    // 5) rames de tramway (prioritaires) : comme un véhicule devant nous
    const tr = T.trams;
    if (tr) for (let i = 0; i < tr.length; i++) {
      const o = tr[i];
      if (!o.active) continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      if (dx > R + 6 || dx < -R - 6 || dz > R + 6 || dz < -R - 6 || o.y - cy > LEVEL || cy - o.y > LEVEL) continue;
      const f = dx * fx + dz * fz;
      if (f <= 0.5 || f > look + 6) continue;
      const hd = fx * o.fx + fz * o.fz, along = hd > 0.7 || hd < -0.7;
      if (Math.abs(dx * rx + dz * rz) > hw + (along ? o.halfWid : o.halfLen) + 0.4) continue;
      const g = f - hl - (along ? o.halfLen : o.halfWid + 0.6);
      if (g < gap) { gap = g; gs = Math.max(0, o.speed * hd); kind = 1; obs = false; }
    }
    c.gap = gap; c.gapSpeed = gs; c.leadKind = kind; c.blockKind = gap < 12 ? kind : c.emergT > 0 ? 2 : 0;
    c.yieldV = yv; c.yieldD = yStop;
    // contournement d'un obstacle fixe : on choisit le côté qui demande le plus petit écart, s'il tient sur la chaussée
    if (obs && gap < 14 && c.dodgeTarget === 0 && c.phase === 0 && c.mode === 0 && c.lc === 0) {
      const h = c.h, off = hOff0[h] + c.lane * hLaneW[h], W = hWidth[h];
      const lo = -W / 2 + hw - 0.2 - off, hi = W / 2 - hw + 0.6 - off;
      const nl = obsL - obsE - hw - 0.5, nr = obsL + obsE + hw + 0.5;
      const okL = nl >= lo, okR = nr <= hi;
      if (okL || okR) {
        c.dodgeTarget = okL && (!okR || -nl <= nr) ? Math.min(nl, -0.05) : Math.max(nr, 0.05);
        c.passX = obsX; c.passZ = obsZ; c.passT = 0; c.swerveT = 0;
      }
    }
    if (c.merge !== 0) {
      // bande d'accélération : on s'insère dès que la file de rive est libre (au plus tard après quelques secondes)
      if (c.mergeT <= 0 || laneFree(c, -c.merge, false)) { c.blinkT = 2.6; setBlink(c, c.merge > 0 ? 'left' : 'right'); c.merge = 0; c.lcT = 5; }
    } else if (c.mode === 0 && c.phase === 0 && c.lcT <= 0 && hLanes[c.h] > 1 && c.lc === 0 && c.dodge === 0 && c.dodgeTarget === 0) laneLogic(c);
  }
  /** Léger écart réflexe (d'un côté, 1,2 m au plus) s'il reste de la place sur notre moitié de chaussée. */
  function swerve(c, side, x, z) {
    const h = c.h, off = hOff0[h] + c.lane * hLaneW[h], W = hWidth[h];
    const lo = (hDrive[h ^ 1] ? c.halfWid : -W / 2 + c.halfWid) - off, hi = W / 2 - c.halfWid + 0.5 - off;
    const d = side < 0 ? Math.max(-1.2, lo) : Math.min(1.2, hi);
    if (Math.abs(d) < 0.3) return;
    c.dodgeTarget = d; c.passX = x; c.passZ = z; c.passT = 0; c.swerveT = 2;
  }

  // ---------------------------------------------------------------- changement de file
  /** La file d'à côté (dir = −1 à gauche, +1 à droite) est-elle libre ? `keep` = créneau large (simple rabattement). */
  function laneFree(c, dir, keep) {
    const fx = c.fx, fz = c.fz, rx = -fz, rz = fx, lw = hLaneW[c.h] * dir, vc = c.speed, cy = c.y;
    const front = keep ? 16 + vc * 2.2 : 4 + vc * 0.35, hl = c.halfLen;
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (!o.active || o === c || o.y - cy > LEVEL || cy - o.y > LEVEL) continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      if (dx > 90 || dx < -90 || dz > 90 || dz < -90) continue;
      if (fx * o.fx + fz * o.fz < 0.5) continue;
      const l = dx * rx + dz * rz - lw;
      if (l > 1.8 || l < -1.8) continue;
      const f = dx * fx + dz * fz, lens = hl + o.halfLen, vo = o.speed;
      if (f >= 0) { if (f - lens < front + (vc > vo ? (vc - vo) * 2 : 0)) return false; }
      else if (-f - lens < 4 + vo * 0.5 + (vo > vc ? (vo - vc) * 2.5 : 0)) return false;
    }
    const list = ctx.vehicles.list;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (T.owner.has(v) && T.owner.get(v) !== PARKED) continue;
      const dx = v.pos.x - c.x, dz = v.pos.z - c.z;
      if (dx > 90 || dx < -90 || dz > 90 || dz < -90 || v.pos.y - cy > LEVEL || cy - v.pos.y > LEVEL) continue;
      const l = dx * rx + dz * rz - lw;
      if (l > 2 || l < -2) continue;
      const f = dx * fx + dz * fz, vo = Math.abs(v.speed || 0);
      if (f >= 0) { if (f < front + 6 + (vc > vo ? (vc - vo) * 2 : 0)) return false; }
      else if (-f < 9 + vo * 0.6 + (vo > vc ? (vo - vc) * 2.5 : 0)) return false;
    }
    return true;
  }
  function changeLane(c, dir) {
    const sEnd0 = c.sEnd, lw = hLaneW[c.h];
    c.lane += dir;
    replan(c);
    if (c.s > Math.min(sEnd0, c.sEnd) - 1) { c.lane -= dir; replan(c); c.lcT = 0.15; return false; } // trop près du nœud : à l'arête suivante
    c.lc -= dir * lw; // même position, nouvelle file de référence : l'écart se résorbe en roulant
    c.lcT = 4 + Math.random() * 4;
    c.blinkT = 2.6; setBlink(c, dir < 0 ? 'left' : 'right');
    return true;
  }
  /** Décide d'un changement de file : se placer pour sortir, dépasser un véhicule lent, se rabattre à droite. */
  function laneLogic(c) {
    const h = c.h, n = hLanes[h], lane = c.lane;
    if (c.exit1 || c.exit2 || c.speed < 3 || c.mk !== 0 || (c.theta > 0.3 && c.sEnd - c.s < 8 + c.speed * 0.5)) return;
    const vdes = hSpeed[h] * c.pers;
    if (c.fast && c.wantExit && hKind[h] >= KIND_TRUNK) {
      // sortie prochaine : gagner la file de droite, quitte à lever le pied pour trouver un créneau
      if (lane < n - 1) { if (laneFree(c, 1, false)) changeLane(c, 1); else c.lcT = 0.4; }
      return;
    }
    const slowLead = c.gap < 12 + c.speed * 2.2 && c.gapSpeed < vdes - (c.fast ? 2 : 4) && c.leadKind === 1 && (c.fast || c.gap < 14);
    if (slowLead && lane > 0 && c.yieldV > 1e8) { if (laneFree(c, -1, false)) changeLane(c, -1); else c.lcT = 0.5; return; }
    if (c.fast && lane < n - 1 && !slowLead && c.gap > 10 + c.speed * 2) {
      if (laneFree(c, 1, true)) changeLane(c, 1); else c.lcT = 1.5;
    }
  }

  // ---------------------------------------------------------------- conduite
  function drive(c, dt) {
    c.scanT -= dt;
    if (c.honkT > 0) c.honkT -= dt;
    if (c.lcT > 0) c.lcT -= dt;
    if (c.scanT <= 0) { c.scanT = 0.07 + Math.random() * 0.03; scan(c); if (c.mode !== 0) return; }
    else {
      if (c.gap < 1e8) c.gap -= (c.speed - c.gapSpeed) * dt; // extrapolation entre deux balayages
      if (c.yieldD < 1e8) c.yieldD -= c.speed * dt;
    }

    const h = c.h;
    // un verrou détenu reste vivant tant que sa voiture roule (l'expiration ne sert qu'aux verrous perdus)
    if (c.lockNode >= 0 && lockGen[c.lockNode] === c.lockGen) lockT[c.lockNode] = T.now;
    if (c.lock2 >= 0 && lockGen[c.lock2] === c.lock2Gen) lockT[c.lock2] = T.now;
    let vmax = hSpeed[h] * c.pers;
    if (c.phase === 2) vmax = 2.6; // manœuvre de retour dans la voie après un accrochage
    else if (c.phase === 0) {
      const dC = Math.max(0, c.sEnd - c.s);
      if (c.next < 0) {
        vmax = Math.min(vmax, Math.sqrt(2 * BRAKE * dC));
        if (dC < 0.5 && c.speed < 0.3) c.wantRecycle = true; // impasse à sens unique : recyclée
      } else {
        // bretelle d'insertion : on prend de la vitesse avant de rejoindre la voie rapide
        if (c.fast && hSpeed[c.next] > vmax) vmax = Math.max(vmax, hSpeed[c.next] * 0.85 * c.pers);
        if (c.vCurve < vmax) vmax = Math.min(vmax, Math.sqrt(c.vCurve * c.vCurve + 2 * BRAKE * dC));
        // virage d'après (arêtes courtes : il faut freiner dès maintenant) et vitesse de la voie suivante
        const t2 = c.t2, d2 = dC + c.curveEst + Math.max(0, t2.sEnd - c.nextS);
        if (t2.vCurve < vmax) vmax = Math.min(vmax, Math.sqrt(t2.vCurve * t2.vCurve + 2 * BRAKE * d2));
        const vn = hSpeed[c.next] * c.pers;
        if (vn < vmax) vmax = Math.min(vmax, Math.sqrt(vn * vn + 2 * BRAKE * (dC + c.curveEst)));
        // priorité (carrefour urbain) : réserver le carrefour au bout de l'arête, et celui d'après si l'on ne pourra pas s'arrêter avant
        const nodeA = hTo[h], nodeB = hTo[c.next];
        const needA = nodeCtl[nodeA] === CTL_LOCK && c.lockNode !== nodeA;
        const needB = c.next2 >= 0 && nodeCtl[nodeB] === CTL_LOCK && nodeB !== nodeA && c.lock2 !== nodeB && t2.sStop - c.nextS < 1.5;
        if (needA || needB) {
          // ligne d'arrêt à l'entrée du carrefour ; si elle est déjà dépassée (arête courte), début du virage
          const dStop = (c.s <= c.sStop + 1 ? c.sStop : c.sEnd - 0.3) - c.s;
          if (dStop < c.speed * c.speed / (2 * BRAKE) + 7) {
            const okA = !needA || canLock(nodeA, h, c.next), okB = !needB || canLock(nodeB, c.next, c.next2);
            if (!okA) waitFor(nodeA, h);
            if (!okB) waitFor(nodeB, c.next);
            if (okA && okB) {
              if (needA) { release(c); c.lockGen = takeLock(nodeA, h, c.next); c.lockNode = nodeA; }
              if (needB) { release2(c); c.lock2Gen = takeLock(nodeB, c.next, c.next2); c.lock2 = nodeB; }
              c.waitT = 0;
            } else {
              vmax = Math.min(vmax, dStop <= 0.3 ? 0 : Math.sqrt(2 * BRAKE * dStop));
              if (c.speed < 0.6) {
                c.waitT += dt;
                if (c.waitT > WAIT_MAX) { // délai max : on passe (la détection d'obstacle reste active)
                  if (needA) { release(c); c.lockNode = nodeA; c.forced = true; }
                  if (needB) { release2(c); c.lock2 = nodeB; c.forced2 = true; }
                  c.waitT = 0;
                }
              }
            }
          }
        }
      }
    } else {
      if (c.vCurve < vmax) vmax = c.vCurve;
      const t2 = c.t2;
      if (c.next2 < 0 || t2.vCurve < vmax) vmax = Math.min(vmax, Math.sqrt(t2.vCurve * t2.vCurve + 2 * BRAKE * ((1 - c.cu) * c.cLen + Math.max(0, t2.sEnd - c.nextS))));
    }
    // plus loin sur le chemin (voie rapide aux segments courts) : courbes et limitations à venir
    if (c.pathN > 3 && c.phase !== 2) {
      const sE = c.phase === 0 ? c.s : c.sEnd + c.cu * c.curveEst, ps = c.pathS, pv = c.pathV;
      for (let k = 3; k < c.pathN; k++) { const v = pv[k]; if (v < vmax) { const lim = Math.sqrt(v * v + 2 * BRAKE * Math.max(0, ps[k] - sE)); if (lim < vmax) vmax = lim; } }
    }
    // carrefour à réservation au bout de l'arête SUIVANTE : demandé dès qu'on est à distance de freinage, y compris
    // pendant le virage (arêtes courtes : on n'a parfois que quelques mètres de ligne droite entre deux nœuds)
    if (c.phase !== 2 && c.next2 >= 0) {
      const nodeA = hTo[h], nodeB = hTo[c.next];
      if (nodeCtl[nodeB] === CTL_LOCK && nodeB !== nodeA && c.lock2 !== nodeB && (c.phase === 1 || nodeCtl[nodeA] !== CTL_LOCK || c.lockNode === nodeA)) {
        const dEnd = c.phase === 0 ? c.sEnd - c.s + c.curveEst : (1 - c.cu) * c.cLen;
        const dStop = dEnd + Math.max(0.2, c.t2.sStop - c.nextS);
        if (dStop < c.speed * c.speed / (2 * BRAKE) + 7) {
          if (canLock(nodeB, c.next, c.next2)) { release2(c); c.lock2Gen = takeLock(nodeB, c.next, c.next2); c.lock2 = nodeB; }
          else {
            waitFor(nodeB, c.next);
            const lim = dStop <= 0.3 ? 0 : Math.sqrt(2 * BRAKE * dStop);
            if (lim < vmax) vmax = lim;
            if (c.speed < 0.6) { c.waitT += dt; if (c.waitT > WAIT_MAX) { release2(c); c.lock2 = nodeB; c.forced2 = true; c.waitT = 0; } }
          }
        }
      }
    }

    // céder le passage (giratoire, insertion) : se laisser glisser derrière le prioritaire, s'arrêter à la ligne au besoin
    if (c.yieldIgnore > 0) c.yieldIgnore -= dt;
    if (c.yieldV < vmax) vmax = c.yieldV;
    if (c.yieldD < 1e8) {
      const lim = c.yieldD <= 0.3 ? 0 : Math.sqrt(2 * BRAKE * c.yieldD);
      if (lim < vmax) vmax = lim;
      if (c.speed < 0.5) { c.yieldT += dt; if (c.yieldT > 12) { c.yieldT = 0; c.yieldIgnore = 3; } } // jamais bloquée indéfiniment
    } else c.yieldT = 0;
    if (c.fast && c.wantExit && c.lane < hLanes[h] - 1 && vmax > 14) vmax *= 0.88; // cherche un créneau pour se rabattre
    if (c.merge !== 0) { c.mergeT -= dt; if (c.mergeT < 5 && vmax > 12) vmax *= 0.9; } // pas de créneau : on lève un peu le pied
    if (c.limpT > 0) { // repart au ralenti après un choc moyen, feux de détresse allumés
      c.limpT -= dt; if (vmax > 4) vmax = 4;
      if (c.limpT <= 0 && c.v.controls) { c.v.controls.blinker = null; c.blink = null; }
    }
    // écart d'évitement en cours : au pas, et retour dans la voie une fois l'obstacle dépassé
    const dodging = c.dodgeTarget !== 0;
    if (dodging) {
      c.passT += dt;
      if (c.swerveT > 0) { if (c.passT > c.swerveT) c.dodgeTarget = 0; }
      else {
        if (vmax > 3.5) vmax = 3.5;
        if ((c.passX - c.x) * c.fx + (c.passZ - c.z) * c.fz < -(c.halfLen + 3) || c.passT > 30) c.dodgeTarget = 0;
      }
    }
    if (c.emergT > 0) { c.emergT -= dt; vmax = 0; } // freinage d'urgence
    if (c.holdCd > 0) c.holdCd -= dt;
    if (c.holdT > 0) { c.holdT -= dt; vmax = 0; }
    // distance de sécurité : jamais plus vite que ce qui permet de s'arrêter derrière, et intervalle en temps
    // (2 s sur voie rapide, 1 s en ville) rattrapé en douceur — d'où les ralentissements en accordéon
    if (c.gap < 1e8) {
      const g = c.gap - (dodging && c.swerveT <= 0 ? 0.7 : MIN_GAP);
      let lim = g <= 0 ? 0 : Math.sqrt(c.gapSpeed * c.gapSpeed + 2 * BRAKE * g);
      const th = c.fast ? 2 : 1, lim2 = c.gapSpeed + (g - th * c.speed) / 3;
      if (lim2 < lim) lim = lim2 > 0 ? lim2 : 0;
      if (lim < vmax) vmax = lim;
    }
    // accélération / freinage proportionnels à l'écart de vitesse
    const dv = vmax - c.speed;
    if (dv >= 0) { const amax = c.speed > 18 ? 1.5 : ACC, a = dv * 2.6; c.speed += (a < amax ? a : amax) * dt; if (c.speed > vmax) c.speed = vmax; }
    else { let b = -dv * 2.6; if (b < 1.2) b = 1.2; else if (b > BRAKE_MAX) b = BRAKE_MAX; c.speed -= b * dt; if (c.speed < vmax) c.speed = vmax; }

    // blocages : klaxon si c'est le joueur, sortie d'interblocage si c'est une autre IA
    if (c.ignoreT > 0) c.ignoreT -= dt;
    if (c.speed < 0.3) {
      c.idleT += dt;
      if (c.blockKind === 2) {
        c.blockT += dt;
        if (c.blockT > 1.5 && c.honkT <= 0) { c.honkT = 4 + Math.random() * 5; honk(c); }
      } else if (c.blockKind === 1) {
        c.stuckT += dt;
        if (c.stuckT > 8 + (c.idx % 4)) { c.ignoreT = 2.5; c.stuckT = 0; }
      }
      // à l'arrêt loin du carrefour (file, piéton, obstacle) : on rend les réservations, d'autres peuvent passer
      if (c.idleT > 2.5) { if (c.lock2 >= 0) release2(c); if (c.lockNode >= 0 && c.phase === 0 && c.s < c.sStop - 1) release(c); }
      if (c.idleT > 40) c.wantRecycle = true;
    } else { c.idleT = 0; c.stuckT = 0; c.blockT = 0; }

    // clignotants : changement de file en cours, virage ou sortie de giratoire à venir
    if (c.blinkT > 0) { c.blinkT -= dt; if (c.blinkT <= 0 && c.lc === 0) setBlink(c, null); }
    else if (c.next >= 0 && c.theta > 0.45 && (c.phase === 1 || c.sEnd - c.s < 28)) setBlink(c, hUx[h] * hUz[c.next] - hUz[h] * hUx[c.next] > 0 ? 'right' : 'left');
    else if ((hFlag[h] & F_ROUND) && c.next >= 0 && !(hFlag[c.next] & F_ROUND)) setBlink(c, 'right');
    else if (c.exit1 && c.sEnd - c.s < 60) setBlink(c, hUx[h] * hUz[c.next] - hUz[h] * hUx[c.next] > 0 ? 'right' : 'left');
    else if (c.blink && c.blink !== 'hazard') setBlink(c, null);

    // avance
    let ds = c.speed * dt;
    if (ds > 0) {
      if (c.dodge !== c.dodgeTarget) {
        // le déport suit l'avance (1 m d'écart par 1,25 m parcouru au plus) : jamais de glissade sur place
        const d = c.dodgeTarget - c.dodge, m = ds * 0.8, st = d > m ? m : d < -m ? -m : d;
        c.dodge += st; c.dodgeSlope = st / ds;
      } else c.dodgeSlope = 0;
      if (c.lc !== 0 && c.merge === 0) {
        // changement de file : ~1,2 m/s de vitesse latérale, jamais plus de 20 % de l'avance
        const m = Math.min(1.25 * dt, ds * 0.2), st = c.lc > m ? -m : c.lc < -m ? m : -c.lc;
        c.lc += st; c.lcSlope = st / ds;
      } else c.lcSlope = 0;
      if (c.phase === 2) {
        c.cu += ds / c.cLen;
        if (c.cu >= 1) { c.phase = 0; c.s = c.recS; }
      } else if (c.phase === 0) {
        c.s += ds;
        if (c.s >= c.sEnd) {
          if (c.next >= 0) { ds = c.s - c.sEnd; c.s = c.sEnd; enterCurve(c); c.cu = Math.min(0.99, ds / c.cLen); }
          else c.s = c.sEnd;
        }
      } else {
        c.cu += ds / c.cLen;
        if (c.cu >= 1) {
          const over = (c.cu - 1) * c.cLen;
          const s0 = c.nextS;
          if (c.dodge !== 0 && c.dodgeTarget !== 0 && c.swerveT <= 0) c.dodgeTarget = 0; // carrefour franchi : on se rabat
          c.ringN = hFlag[c.next] & F_ROUND ? c.ringN + 1 : 0;
          if (hFlag[c.next] & F_UTURN) c.wantRecycle = true; // boucle de bord de carte : recyclée dès qu'elle est hors champ
          c.h = c.next; c.lane = c.nextLane; c.phase = 0; c.next = c.next2; c.exit1 = c.exit2;
          c.lc -= c.curveLat; c.curveLat = 0;
          if (c.acc !== 0) { c.merge = c.acc; c.mergeT = 10; c.lc += c.acc * hLaneW[c.next]; } // sur la bande d'accélération
          // le carrefour franchi est libéré ; le verrou « d'après » devient le verrou courant
          release(c);
          c.lockNode = c.lock2; c.lockGen = c.lock2Gen; c.forced = c.forced2; c.lock2 = -1; c.forced2 = false;
          plan(c);
          c.s = Math.min(s0 + over, Math.max(s0, c.sEnd));
        }
      }
      writePose(c);
      // cap : suit la tangente, avec une vitesse de rotation bornée (pas de pivot instantané)
      let da = Math.atan2(-c.fx, -c.fz) - c.yaw;
      da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
      const lim = Math.max(1.6, Math.min(2.6, c.speed * 0.5)) * dt;
      c.yaw += da > lim ? lim : da < -lim ? -lim : da;
      carY(c, false);
    }
    send(c);
  }

  // ---------------------------------------------------------------- pool
  function deactivate(c) {
    if (!c.active) return;
    release(c); release2(c);
    c.active = false; activeCount--;
    const i = active.indexOf(c.v); if (i >= 0) active.splice(i, 1);
    resetCar(c);
    c.x = FAR + c.idx * 12; c.z = FAR; c.y = 0; c.speed = 0;
    c.v.group.visible = false;
    c.v.setTransform(c.x, c.z, 0, 0, 0);
  }
  /** Remet une voiture (éventuellement accidentée) à l'état neuf, pilotée par le trafic. */
  function resetCar(c) {
    const v = c.v;
    c.mode = 0; c.sev = 0; c.dodge = c.dodgeTarget = c.dodgeSlope = 0; c.lc = c.lcSlope = 0; c.emergT = 0; c.limpT = 0; c.phase = 0; c.blink = null;
    v.remote = true; v.driver = 'ai';
    if (v.controls) v.controls.blinker = null;
    if (v.damage > 0 || v.wrecked) { if (v.repair) v.repair(); else { v.damage = 0; v.wrecked = false; } }
  }
  /** Conducteur visible (contrat v3) : personnage simplifié assis au volant, enfant du groupe du véhicule. */
  function seatDriver(c) {
    const v = c.v;
    if (v.occupant || !v.group) return;
    try {
      if (!c.look) c.look = { color: DRIVER_TOPS[(Math.random() * DRIVER_TOPS.length) | 0], skin: DRIVER_SKINS[(Math.random() * DRIVER_SKINS.length) | 0], name: 'conducteur-' + ((Math.random() * 1e6) | 0) };
      const ch = c.occ || createCharacter(ctx, { lod: true, shadow: false, color: c.look.color, skin: c.look.skin, name: c.look.name });
      if (!ch || !ch.group) return;
      c.occ = ch;
      const st = v.seat, sc = ch.scale || 1;
      v.group.add(ch.group);
      // même convention que le module joueur : origine du groupe = bassin − 0,5 m (pose assise)
      ch.group.position.set(st ? st.x : -(v.spec.width || 1.8) * 0.2, (st ? st.y : 0.45) - 0.5 * sc, st ? st.z : 0.12);
      ch.group.rotation.set(0, 0, 0); ch.group.visible = true;
      ch.setState({ anim: 'sit', speed: 0, wheel: v.wheelPos || null, steer: 0 });
      if (ch.snap) ch.snap();
      v.occupant = ch;
    } catch (e) { c.occ = null; }
  }
  function unseatDriver(c, dispose) {
    const v = c.v, ch = c.occ;
    if (v.occupant === ch) v.occupant = null;
    if (!ch) return;
    ch.group.removeFromParent();
    if (dispose) { if (ch.dispose) ch.dispose(); c.occ = null; }
  }
  /**
   * Vol de voiture : relâche immédiatement une voiture conduite par l'IA (elle garde sa vitesse, la physique locale
   * prend le relais) et fait descendre son conducteur du côté demandé. @returns {boolean} false si non éligible.
   */
  function ejectDriver(vehicle, opts) {
    const c = vehicle && T.owner.get(vehicle);
    if (!c || c === PARKED || !c.active || cars.indexOf(c) < 0) return false;
    if (c.mode === 0 ? vehicle.driver !== 'ai' : vehicle.driver != null) return false;
    const v = c.v, yaw = v.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    const hadDriver = !!c.occ && v.occupant === c.occ;
    release(c); release2(c);
    c.active = false; activeCount--;
    const k = active.indexOf(v); if (k >= 0) active.splice(k, 1);
    cars.splice(cars.indexOf(c), 1);
    for (let i = 0; i < cars.length; i++) cars[i].idx = i;
    T.owner.delete(v); loose.push(v);
    v.remote = false; v.driver = null;
    if (v.controls) v.controls.blinker = null;
    if (v.setControls) v.setControls({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    if (v.phys) { v.phys.sleeping = false; v.phys.kinT = -1; }
    if (v.vel && c.mode === 0) { v.vel.x = fx * c.speed; v.vel.z = fz * c.speed; } // elle conserve sa vitesse
    unseatDriver(c, true);
    if (hadDriver && T.spawnEjected) {
      // à côté de la portière demandée ; de l'autre côté si un obstacle gêne
      const sd = opts && opts.side === 'right' ? 1 : -1, out = c.halfWid + 0.75, along = v.seat ? -v.seat.z : -0.1, yc = v.pos.y + 1;
      let x = v.pos.x + rx * sd * out + fx * along, z = v.pos.z + rz * sd * out + fz * along;
      if (ctx.collision && ctx.collision.test(x, z, 0.35, yc)) {
        const x2 = v.pos.x - rx * sd * out + fx * along, z2 = v.pos.z - rz * sd * out + fz * along;
        if (!ctx.collision.test(x2, z2, 0.35, yc)) { x = x2; z = z2; }
      }
      T.spawnEjected(x, z, yaw, v.pos.x, v.pos.z, c.look, v.pos.y);
    }
    return true;
  }
  function destroy(c) {
    deactivate(c);
    T.owner.delete(c.v);
    unseatDriver(c, true);
    try { ctx.vehicles.remove(c.v); } catch (e) { /* module véhicules en cours de remplacement */ }
    const i = cars.indexOf(c); if (i >= 0) cars.splice(i, 1);
  }
  function newCar() {
    const typeId = pickType(), spec = VEHICLE_BY_ID[typeId];
    const color = spec.colors[(Math.random() * spec.colors.length) | 0];
    const v = ctx.vehicles.spawn(typeId, FAR, FAR, 0, { remote: true, color, y: 0 });
    if (!v) return null;
    v.driver = 'ai';
    const sp = v.spec || spec;
    const c = {
      v, idx: cars.length, active: false, h: 0, next: -1, lane: 0, nextLane: 0, s: 0, sEnd: 0, sStop: 0, nextS: 0, curveEst: 0, theta: 0,
      phase: 0, cu: 0, cLen: 1, bez: new Float32Array(8), vCurve: 99, speed: 0, pers: 0.84 + Math.random() * 0.26,
      x: FAR, y: 0, z: FAR, yaw: 0, fx: 0, fz: -1, ele: 0, yFix: 0, lat: 0, halfLen: sp.length * 0.5, halfWid: sp.width * 0.5,
      lockNode: -1, lockGen: 0, forced: false, lock2: -1, lock2Gen: 0, forced2: false, next2: -1,
      t2: { sEnd: 0, nextS: 0, nextLane: 0, theta: 0, curveEst: 0, vCurve: 99, sStop: 0, acc: 0 }, acc: 0, merge: 0, mergeT: 0, leadKind: 0, mk: 0, mSide: 0, mOff: 0, mNx: 0, mNz: 0, mUx: 0, mUz: 1, tp: 0, waitT: 0, stuckT: 0, idleT: 0, blockT: 0, honkT: 0, ignoreT: 0, scanT: 0,
      gap: 1e9, gapSpeed: 0, blockKind: 0, wantRecycle: false, occ: null, look: null, holdT: 0, holdCd: 0,
      mode: 0, sev: 0, restT: 0, crashAge: 0, resumeT: 0, stay: false, braked: false, fails: 0, limpT: 0, emergT: 0, recS: 0,
      dodge: 0, dodgeTarget: 0, dodgeSlope: 0, passX: 0, passZ: 0, passT: 0, swerveT: 0,
      // files, itinéraire d'anticipation, céder le passage
      lc: 0, lcSlope: 0, lcT: 0, curveLat: 0, wantExit: false, exit1: false, exit2: false, ringN: 0, fast: false, blink: null, blinkT: 0,
      path: new Int32Array(PATH_MAX), pathS: new Float32Array(PATH_MAX), pathOff: new Float32Array(PATH_MAX), pathV: new Float32Array(PATH_MAX), pathN: 1, offN1: 0, offN2: 0,
      yieldV: 1e9, yieldD: 1e9, yieldT: 0, yieldIgnore: 0, zN: 0, zK: new Int8Array(3), zBack: new Float32Array(3),
    };
    cars.push(c); T.owner.set(v, c);
    return c;
  }
  /** Poids de densité du trafic en un point d'une arête (type de voie, zone, distance au centre, heure). */
  function carWeight(e, x, z) {
    let w = eCars[e] / 255;
    const h = 2 * e;
    if (!(hFlag[h] & F_FAST)) {
      const tu = T.tune, d = Math.hypot(x, z);
      if (d > tu.centreR) w *= Math.max(tu.outerCars, 1 - (1 - tu.outerCars) * (d - tu.centreR) / (tu.outerR - tu.centreR));
      const a = T.areas.kindAt(x, z);
      if (a === A_INDUSTRIAL || a === A_COMMERCIAL) w *= T.night ? 0.06 : 0.7;   // zones d'activités : désertes la nuit
      else if (a === A_RESIDENTIAL && d > tu.centreR) w *= T.night ? 0.35 : 0.6; // quartiers pavillonnaires (hors hypercentre)
      else if (a === A_NOGO) w *= 0.15;
    } else w *= T.rush; // rocade et pénétrantes : chargées aux heures de pointe
    return w;
  }
  /** Cherche une place libre hors champ dans l'anneau et y pose la voiture `c` (ou une nouvelle). */
  function trySpawn(c, burst) {
    const rMin = burst ? 45 : T.SPAWN_MIN, rMax = T.SPAWN_MAX;
    if (!G.randomEdgeNear(T.fx, T.fz, rMin, rMax, tmp, 5, T.vdx, T.vdz, burst ? 0 : T.bias)) return false;
    let h = 2 * tmp.e + (Math.random() < 0.5 ? 1 : 0), s = tmp.s;
    if (!hDrive[h]) h ^= 1;
    if (!hDrive[h] || (hFlag[h] & (F_NOAI | F_UTURN))) return false;
    if (h & 1) s = hLen[h] - s;
    // densité selon le lieu (type de voie, zone, heure) : tirage d'acceptation
    const w = carWeight(tmp.e, tmp.x, tmp.z);
    // équilibre voies rapides / rues : les voitures traversent la zone bien plus vite sur une rocade, il faut donc
    // y faire apparaître plus souvent pour y garder la densité voulue (T.fastShare, sondée autour du joueur)
    const isFast = (hFlag[h] & F_FAST) !== 0, wantFast = fastCount < T.fastShare * Math.max(1, targetCars);
    if (isFast !== wantFast && T.fastShare > 0.03 && T.fastShare < 0.97 && Math.random() < 0.8) return false;
    if (Math.random() > w * 1.6 + 0.04) return false;
    const y = baseHeightAt(tmp.x, tmp.z) + G.eleAt(h, s);
    if (!burst && T.inView(tmp.x, tmp.z, y)) return false;
    // derrière un joueur rapide, une voiture plus lente que lui ne servirait à rien
    if (T.vF > 14 && (tmp.x - T.fx) * T.vdx + (tmp.z - T.fz) * T.vdz < -60 && hSpeed[h] < T.vF * 1.05) return false;
    const list = ctx.vehicles.list, clear = 16 + hSpeed[h] * 1.3;
    for (let i = 0; i < list.length; i++) {
      const dx = list[i].pos.x - tmp.x, dz = list[i].pos.z - tmp.z;
      if (dx * dx + dz * dz < clear * clear && Math.abs(list[i].pos.y - y) < LEVEL) return false;
    }
    if (!c) c = newCar();
    if (!c) return false;
    c.active = true; activeCount++; active.push(c.v);
    c.v.group.visible = true;
    seatDriver(c);
    place(c, h, s);
    send(c);
    return true;
  }

  // ---------------------------------------------------------------- voitures garées
  const lotDir = new Map(); // parking (indice de zone) → direction principale des rangées
  function lotAxis(i) {
    let a = lotDir.get(i);
    if (a) return a;
    const p = T.areas.polygon(i); let best = 0, ux = 1, uz = 0;
    for (let k = 0; k < p.length; k++) {
      const q = p[(k + 1) % p.length], dx = q[0] - p[k][0], dz = q[1] - p[k][1], l = dx * dx + dz * dz;
      if (l > best) { best = l; const il = 1 / Math.sqrt(l); ux = dx * il; uz = dz * il; }
    }
    a = { ux, uz }; lotDir.set(i, a);
    return a;
  }
  function freeSpot(x, z, y, r) {
    const list = ctx.vehicles.list;
    for (let i = 0; i < list.length; i++) {
      const dx = list[i].pos.x - x, dz = list[i].pos.z - z;
      if (dx * dx + dz * dz < r * r && Math.abs(list[i].pos.y - y) < LEVEL) return false;
    }
    return true;
  }
  function putParked(slot, typeId, spec, x, z, yaw, y) {
    if (slot) { slot.v.setTransform(x, z, yaw, 0, y); slot.x = x; slot.z = z; return true; }
    const v = ctx.vehicles.spawn(typeId, x, z, yaw, { color: spec.colors[(Math.random() * spec.colors.length) | 0], y });
    if (!v) return false;
    T.owner.set(v, PARKED);
    parked.push({ v, x: v.pos.x, z: v.pos.z });
    return true;
  }
  /** Place de parking (pois.areas kind 'parking') : rangées alignées sur le grand côté de l'emprise. */
  function tryParkLot(slot, burst, typeId, spec) {
    const ang = Math.random() * 6.283, r = (burst ? 20 : 70) + Math.random() * 190;
    const px = T.fx + Math.cos(ang) * r, pz = T.fz + Math.sin(ang) * r;
    const i = T.areas.parkingNear(px, pz);
    if (i < 0) return false;
    const bb = T.areas.bbox, ax = lotAxis(i);
    for (let t = 0; t < 4; t++) {
      // point au hasard dans l'emprise, calé sur une grille de places (2,6 m × 11 m, deux rangées dos à dos)
      const qx = bb[i * 4] + Math.random() * (bb[i * 4 + 2] - bb[i * 4]), qz = bb[i * 4 + 1] + Math.random() * (bb[i * 4 + 3] - bb[i * 4 + 1]);
      const a = Math.round((qx * ax.ux + qz * ax.uz) / 2.6) * 2.6, row = Math.round((qx * -ax.uz + qz * ax.ux) / 5.5), b = row * 5.5 + (row & 1 ? -0.25 : 0.25) * 2;
      if ((row & 3) === 2 || (row & 3) === 3) continue; // allée de circulation
      const x = a * ax.ux - b * ax.uz, z = a * ax.uz + b * ax.ux;
      const nx = -ax.uz * 2.3, nz = ax.ux * 2.3;
      if (!T.areas.inside(i, x + nx, z + nz) || !T.areas.inside(i, x - nx, z - nz) || !T.areas.inside(i, x + ax.ux * 1.2, z + ax.uz * 1.2) || !T.areas.inside(i, x - ax.ux * 1.2, z - ax.uz * 1.2)) continue;
      const d2 = (x - T.fx) * (x - T.fx) + (z - T.fz) * (z - T.fz);
      if (d2 > 270 * 270 || (!burst && T.inView(x, z, T.fy))) continue;
      const y = ctx.heightAt(x, z);
      if (!freeSpot(x, z, y, 2.35) || (ctx.collision && ctx.collision.test(x, z, 1.0, y + 0.5))) continue;
      return putParked(slot, typeId, spec, x, z, G.yawOf(-ax.uz, ax.ux) + (row & 1 ? Math.PI : 0), y);
    }
    return false;
  }
  function tryPark(slot, burst) {
    const typeId = slot ? slot.v.typeId : PARK_TYPES[(Math.random() * PARK_TYPES.length) | 0];
    const spec = VEHICLE_BY_ID[typeId] || VEHICLE_BY_ID.citadine;
    if (T.areas.parkings > 0 && Math.random() < 0.4 && tryParkLot(slot, burst, typeId, spec)) return true;
    if (!G.randomEdgeNear(T.fx, T.fz, burst ? 25 : 90, 260, tmp, 4)) return false;
    let h = 2 * tmp.e + (Math.random() < 0.5 ? 1 : 0);
    if (hKind[h] === KIND_PEDESTRIAN || !(hDrive[h] || hDrive[h ^ 1])) return false;
    const len = hLen[h];
    if (len < 24 || (hFlag[h] & (F_BRIDGE | F_TUNNEL | F_FAST | F_ROUND | F_ELEV | F_NOAI | F_UTURN))) return false; // ni ouvrage, ni voie rapide, ni giratoire
    let s = h & 1 ? len - tmp.s : tmp.s;
    s = Math.max(9, Math.min(len - 9, s));
    // voie la plus proche de ce bord : il faut laisser passer le trafic (rue étroite : à cheval sur le trottoir)
    const outer = hDrive[h] ? hOff0[h] + (hLanes[h] - 1) * hLaneW[h] : -hOff0[h ^ 1];
    let off = Math.max(hWidth[h] / 2 - spec.width / 2 - 0.25, outer + 2.2), dir = hDrive[h] ? 1 : -1, yaw;
    const area = T.areas.count ? T.areas.kindAt(tmp.x, tmp.z) : 0;
    if (area === A_RESIDENTIAL && Math.hypot(tmp.x, tmp.z) > T.tune.centreR && hWidth[h] < 8 && Math.random() < 0.5) {
      // zone pavillonnaire : dans l'allée, devant la maison, perpendiculaire à la rue
      off = hWidth[h] / 2 + 3.6 + Math.random() * 1.5;
      yaw = G.yawOf(-hUz[h], hUx[h]) + (Math.random() < 0.5 ? Math.PI : 0);
    } else {
      // rue étroite : à cheval sur le trottoir, en laissant ~0,9 m aux piétons
      if (off + spec.width / 2 > hWidth[h] / 2 + Math.max(0.55, 2 * (G.hWalk[h] - hWidth[h] / 2) - 0.9)) return false;
      yaw = G.yawOf(hUx[h] * dir, hUz[h] * dir); // garée dans le sens de la circulation
    }
    const x = G.pointX(h, s, off), z = G.pointZ(h, s, off), y = ctx.heightAt(x, z);
    if (!burst && T.inView(x, z, y)) return false;
    if (!freeSpot(x, z, y, 7)) return false;
    if (ctx.collision && ctx.collision.test(x, z, off > hWidth[h] / 2 + 2 ? 2.2 : 1.0, y + 0.5)) return false;
    if (off > hWidth[h] / 2 + 2 && ctx.world && ctx.world.inBuilding && ctx.world.inBuilding(x, z, 2.4)) return false;
    return putParked(slot, typeId, spec, x, z, yaw, y);
  }

  /** Tâches lentes (1 fois par seconde environ) : voitures empruntées, garées, abandonnées. */
  function slowTick(burst) {
    const list = ctx.vehicles.list, fx = T.fx, fz = T.fz;
    for (let i = parked.length - 1; i >= 0; i--) {
      const p = parked[i], v = p.v;
      if (!list.includes(v)) { parked.splice(i, 1); T.owner.delete(v); continue; }
      const moved = Math.abs(v.pos.x - p.x) + Math.abs(v.pos.z - p.z) > 0.8;
      if (v.driver != null || moved) { parked.splice(i, 1); T.owner.delete(v); loose.push(v); continue; } // prise ou poussée
      const d2 = (p.x - fx) * (p.x - fx) + (p.z - fz) * (p.z - fz);
      if (parked.length > targetParked && d2 > 150 * 150 && !T.inView(p.x, p.z, v.pos.y)) { parked.splice(i, 1); T.owner.delete(v); ctx.vehicles.remove(v); continue; }
      if (d2 > 330 * 330) tryPark(p, false);
    }
    for (let i = loose.length - 1; i >= 0; i--) {
      const v = loose[i];
      if (!list.includes(v)) { loose.splice(i, 1); continue; }
      if (v.driver != null) continue; // occupée : on n'y touche pas
      const d2 = (v.pos.x - fx) * (v.pos.x - fx) + (v.pos.z - fz) * (v.pos.z - fz);
      if (d2 > T.DESPAWN * T.DESPAWN) { loose.splice(i, 1); ctx.vehicles.remove(v); }
    }
    for (let k = 0; k < 3 && parked.length < targetParked; k++) if (tryPark(null, burst)) break;
  }

  // ---------------------------------------------------------------- boucle
  function update(dt, burst) {
    const fx = T.fx, fz = T.fz, D2 = T.DESPAWN * T.DESPAWN;
    const fastFocus = T.vF > 14;
    let nFast = 0;
    frame++;
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      if (c.mode === 1 ? c.v.driver != null : c.v.driver !== 'ai') {
        // Empruntée par un joueur : on la relâche (plus pilotée, plus supprimée tant qu'elle sert).
        if (c.active) { release(c); release2(c); c.active = false; activeCount--; const k = active.indexOf(c.v); if (k >= 0) active.splice(k, 1); }
        T.owner.delete(c.v);
        unseatDriver(c, true); // prise sans passer par ejectDriver : le conducteur disparaît
        if (c.v.driver === 'local' && c.v.remote) c.v.remote = false; // physique locale pour le joueur
        if (c.v.controls) c.v.controls.blinker = null;
        loose.push(c.v);
        cars.splice(i, 1);
        continue;
      }
      if (!c.active) continue;
      if (c.mode === 1) {
        crashedTick(c, dt);
        // épave ou voiture restée sur place : recyclée seulement loin du joueur et hors champ
        const dx = c.x - fx, dz = c.z - fz, d2 = dx * dx + dz * dz;
        if (d2 > D2 || (c.mode === 1 && (c.sev === 3 || c.stay) && c.crashAge > 20 && d2 > 160 * 160 && !T.inView(c.x, c.z, c.y))) deactivate(c);
        continue;
      }
      drive(c, dt);
      if (c.mode === 1) continue;
      if (c.fast) nFast++;
      // conducteur : pose recalculée seulement de près (mains sur le volant) ; au loin il reste figé
      const dx = c.x - fx, dz = c.z - fz, d2 = dx * dx + dz * dz;
      if (c.occ && d2 < 45 * 45 && ((frame + i) & 3) === 0) c.occ.update(dt * 4);
      if (d2 > D2 || (c.wantRecycle && !T.inView(c.x, c.z, c.y))) deactivate(c);
      // joueur rapide : une voiture distancée, hors champ, ne le rattrapera jamais → recyclée vers l'avant
      else if (fastFocus && d2 > 150 * 150 && dx * T.vdx + dz * T.vdz < -150 && c.speed < T.vF && !T.inView(c.x, c.z, c.y)) deactivate(c);
    }
    for (let i = 0; i < cars.length; i++) cars[i].idx = i;
    fastCount = nFast;

    // apparitions étalées : au plus 1 par frame (2 en rafale au démarrage / après téléportation / à grande vitesse)
    const want = Math.min(targetCars, T.MAX_CARS);
    // rééquilibrage voies rapides / rues : si le quota est plein mais mal réparti (le joueur vient d'entrer sur la rocade,
    // ou de la quitter), une voiture du mauvais côté, hors champ, est recyclée de temps en temps
    const share = T.fastShare * want, deficit = T.fastShare > 0.03 && fastCount < share - 2, excess = T.fastShare < 0.97 && fastCount > share + 3;
    if ((deficit || excess) && activeCount >= want && (rebalT -= dt) <= 0) {
      rebalT = 0.3;
      for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i];
        if (c.active && c.mode === 0 && c.fast === excess && !T.inView(c.x, c.z, c.y)) { deactivate(c); break; }
      }
    }
    for (let n = burst || fastFocus ? 2 : deficit ? 3 : 1; n > 0 && activeCount < want; n--) {
      let spare = null;
      for (let i = 0; i < cars.length; i++) if (!cars[i].active) { spare = cars[i]; break; }
      trySpawn(spare, burst);
    }
    // surplus (densité réduite, nuit) : on retire les réserves, puis des voitures hors champ
    if (cars.length > want) {
      for (let i = cars.length - 1; i >= 0 && cars.length > want; i--) {
        const c = cars[i];
        if (!c.active || (c.mode === 0 && !T.inView(c.x, c.z, c.y))) { destroy(c); break; } // une par frame
      }
    }
    slowTimer -= dt;
    if (slowTimer <= 0) { slowTimer = burst ? 0.1 : 0.7; slowTick(burst); }
  }

  /** `vehicle:hit` : une de nos voitures a été percutée (l'impulsion est déjà appliquée par le module véhicules). */
  function onHit(e) {
    const c = e && T.owner.get(e.vehicle);
    if (!c || c === PARKED) return;
    // simple frôlement d'une voiture à l'arrêt et vide (garée, épave) : on continue sa route
    const by = e.by;
    if (by && by.driver == null && Math.abs(by.speed || 0) < 1 && e.impact < 3 && c.mode === 0) return;
    crashCar(c, e.impact || 4, by, false);
  }
  /** `vehicle:crash` : repli si aucun `vehicle:hit` n'est émis, et alerte des piétons. */
  function onCrash(e) {
    if (!e || !e.vehicle) return;
    const a = T.owner.get(e.vehicle), b = e.other && T.owner.get(e.other);
    if (a && a !== PARKED && a.mode === 0) crashCar(a, e.impact || 4, e.other, e.other && !e.vehicle.applyImpulse);
    if (b && b !== PARKED && b.mode === 0) crashCar(b, e.impact || 4, e.vehicle, !e.other.applyImpulse);
    if (T.alarm && e.impact > 5) T.alarm(e.vehicle.pos.x, e.vehicle.pos.z, e.impact, false, e.vehicle.pos.y);
  }

  return {
    update, onCrash, onHit, crashCar, ejectDriver, carWeight, states: cars, active, parked, loose,
    setTargets(nCars, nParked) { targetCars = nCars; targetParked = nParked; },
    get activeCount() { return activeCount; },
    dispose() { while (cars.length) destroy(cars[cars.length - 1]); for (const p of parked) { T.owner.delete(p.v); ctx.vehicles.remove(p.v); } parked.length = 0; },
  };
}

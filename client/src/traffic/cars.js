// Trafic — voitures IA (cinématiques, suivies sur le graphe) et voitures garées.
//
// Une voiture suit une demi-arête `h` (voir graph.js) dans sa voie (décalage latéral à droite), puis une
// courbe de Bézier cubique qui la raccorde à la voie de la demi-arête suivante `next` (choisie à l'avance,
// ce qui permet de freiner avant le virage et de réserver le carrefour).
//
// Accidents (contrat « Dégâts et impacts ») : sur `vehicle:hit`, la voiture est rendue à la physique locale
// (remote = false, driver = null) — voir crashCar / crashedTick / tryRecover — puis reprise (retour dans la voie
// par une courbe douce), laissée en détresse, ou abandonnée comme épave. Les autres IA s'arrêtent derrière un
// obstacle fixe ou le contournent par un écart latéral (dodge), et pilent si le joueur coupe leur route.
import { VEHICLE_BY_ID } from '@shared/catalog.js';
import { createCharacter } from '../player/index.js';

const ACC = 2.3;          // accélération douce (m/s²)
const BRAKE = 2.8;        // freinage de confort (m/s²)
const BRAKE_MAX = 9;      // freinage d'urgence (m/s²)
const D_TURN = 10;        // distance max (m) avant/après le nœud sur laquelle s'étale un virage
const MIN_GAP = 2.3;      // distance pare-chocs à pare-chocs à l'arrêt (m)
const LOCK_TIMEOUT = 9;   // un verrou de carrefour expire tout seul (s)
const WAIT_MAX = 7;       // attente max à un carrefour avant de forcer le passage (s)
const FAR = 90000;        // « garage » hors du monde pour les voitures du pool inactives

// Répartition : surtout citadines et taxis, parfois Tesla / Cayenne, rarement une supercar.
const TYPE_WEIGHTS = [
  ['citadine', 46], ['taxi', 28], ['tesla_model3', 9], ['porsche_cayenne', 7], ['tesla_models', 2.5], ['porsche_taycan', 2],
  ['tesla_cybertruck', 1.2], ['porsche_911', 1.3], ['lambo_urus', 1.2], ['lambo_huracan', 1], ['lambo_aventador', 0.5],
].filter(([id]) => VEHICLE_BY_ID[id]);
const TYPE_TOTAL = TYPE_WEIGHTS.reduce((a, t) => a + t[1], 0);
const PARK_TYPES = ['citadine', 'citadine', 'citadine', 'tesla_model3', 'porsche_cayenne', 'taxi', 'tesla_models', 'porsche_taycan'].filter((id) => VEHICLE_BY_ID[id]);

function pickType() {
  let r = Math.random() * TYPE_TOTAL;
  for (const t of TYPE_WEIGHTS) { r -= t[1]; if (r <= 0) return t[0]; }
  return TYPE_WEIGHTS[0] ? TYPE_WEIGHTS[0][0] : 'citadine';
}
const DRIVER_TOPS = ['#2b3a55', '#6b1f2a', '#3d5a45', '#1f1f24', '#7a7f8a', '#b04a3a', '#3f6a8a', '#d9d2c5', '#5b4a6e'];
const DRIVER_SKINS = ['#f1c9a5', '#e0ac7e', '#c68d5e', '#9a6a44', '#6e4a2f'];
const PARKED = { parked: true }; // marqueur dans T.owner pour les voitures garées intactes

export function createCars(T) {
  const { ctx, G } = T;
  const { hFrom, hTo, hUx, hUz, hLen, hDrive, hLanes, hOff0, hLaneW, hSpeed, hWidth, hKind, outStart, outList, nodeJunction, nodeRadius } = G;
  const { lockIn, lockOut, lockCnt, lockT, lockGen } = G;
  const lockWaitIn = new Int32Array(G.nodeCount).fill(-1), lockWaitT = new Float32Array(G.nodeCount);
  const cars = [];       // tous les états (actifs ou en réserve)
  const active = [];     // véhicules IA actifs (exposé : traffic.cars)
  const loose = [];      // véhicules « empruntés » puis abandonnés : on ne les pilote plus
  const parked = [];     // { v, x, z }
  const tmp = { e: 0, s: 0, x: 0, z: 0 };
  const tmpN = { h: -1, s: 0, d: 0, lat: 0 };
  let targetCars = 0, targetParked = 0, activeCount = 0, slowTimer = 0, frame = 0;

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
  /** Sortie aléatoire au bout de la demi-arête h (jamais de demi-tour, sauf cul-de-sac). −1 si impasse. */
  function pick(h) {
    const node = hTo[h], ux = hUx[h], uz = hUz[h];
    let total = 0, best = -1;
    for (let k = outStart[node]; k < outStart[node + 1]; k++) {
      const o = outList[k];
      if (!hDrive[o] || o === (h ^ 1)) continue;
      const cos = ux * hUx[o] + uz * hUz[o];
      // On préfère continuer à peu près tout droit et les grands axes ; les épingles sont rares.
      const w = (cos < -0.7 ? 0.04 : 0.45 + Math.max(0, cos) * 1.4) * (0.5 + 0.5 * hLanes[o]);
      total += w;
      if (Math.random() * total < w) best = o;
    }
    if (best < 0 && hDrive[h ^ 1]) best = h ^ 1; // cul-de-sac : demi-tour
    return best;
  }
  /** (Re)calcule le virage courant h→next et prépare le suivant next→next2 (anticipation du freinage et des verrous). */
  function plan(c) {
    c.waitT = 0;
    setupTurn(c, c.h, c.next, c.lane, c);
    if (c.next >= 0) { c.next2 = pick(c.next); setupTurn(c, c.next, c.next2, c.nextLane, c.t2); }
    else c.next2 = -1;
  }
  /** Géométrie du virage h→n pris depuis la voie `lane` ; résultat écrit dans `out` (la voiture elle-même ou c.t2). */
  function setupTurn(c, h, n, lane, out) {
    const len = hLen[h], node = hTo[h];
    if (n < 0) { out.sEnd = Math.max(0, len - c.halfLen - 1); out.nextS = 0; out.nextLane = 0; out.vCurve = 0; out.theta = 0; out.curveEst = 0; out.sStop = out.sEnd; return; }
    const cos = Math.max(-1, Math.min(1, hUx[h] * hUx[n] + hUz[h] * hUz[n]));
    const theta = Math.acos(cos), uturn = n === (h ^ 1);
    const lenB = hLen[n];
    const nextLane = Math.min(lane, hLanes[n] - 1);
    out.theta = theta; out.nextLane = nextLane;
    // Par défaut : raccord centré sur le nœud (lignes quasi parallèles, demi-tour).
    let d = Math.min(0.45 * len, 0.45 * lenB, uturn ? 3 : D_TURN);
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
    out.vCurve = R > 1e5 ? 99 : Math.max(2.6, Math.sqrt(2.3 * R));
    out.sStop = Math.max(0, Math.min(sEnd, len - nodeRadius[node] - 1.5) - c.halfLen);
  }
  function enterCurve(c) {
    const h = c.h, n = c.next, b = c.bez;
    const offA = hOff0[h] + c.lane * hLaneW[h], offB = hOff0[n] + c.nextLane * hLaneW[n];
    const p0x = G.pointX(h, c.sEnd, offA), p0z = G.pointZ(h, c.sEnd, offA);
    const p3x = G.pointX(n, c.nextS, offB), p3z = G.pointZ(n, c.nextS, offB);
    const chord = Math.hypot(p3x - p0x, p3z - p0z), th = c.theta;
    const k = th < 0.12 ? chord / 3 : Math.min(chord * (2 / 3) * Math.tan(th / 4) / Math.max(Math.sin(th / 2), 0.05), chord * 0.75);
    b[0] = p0x; b[1] = p0z; b[2] = p0x + hUx[h] * k; b[3] = p0z + hUz[h] * k;
    b[4] = p3x - hUx[n] * k; b[5] = p3z - hUz[n] * k; b[6] = p3x; b[7] = p3z;
    // longueur approchée (8 cordes)
    let L = 0, px = p0x, pz = p0z;
    for (let i = 1; i <= 8; i++) {
      const u = i / 8, v = 1 - u, a = v * v * v, bb = 3 * v * v * u, cc = 3 * v * u * u, dd = u * u * u;
      const x = a * b[0] + bb * b[2] + cc * b[4] + dd * b[6], z = a * b[1] + bb * b[3] + cc * b[5] + dd * b[7];
      L += Math.hypot(x - px, z - pz); px = x; pz = z;
    }
    c.cLen = Math.max(0.5, L); c.cu = 0; c.phase = 1;
  }
  function place(c, h, s) {
    release(c); release2(c);
    c.h = h; c.lane = (Math.random() * hLanes[h]) | 0; c.phase = 0;
    c.next = pick(h);
    plan(c);
    c.s = Math.min(s, Math.max(0, c.sEnd - 1));
    // trop près d'un carrefour pour s'arrêter : départ arrêté (elle demandera la priorité comme les autres)
    c.speed = nodeJunction[hTo[h]] && c.s > c.sStop - 14 ? 0 : hSpeed[h] * 0.6 * c.pers;
    c.mode = 0; c.dodge = c.dodgeTarget = c.dodgeSlope = 0; c.emergT = 0; c.limpT = 0;
    c.stunT = 0; c.stuckT = 0; c.idleT = 0; c.ignoreT = 0; c.blockT = 0; c.honkT = 2; c.gap = 1e9; c.blockKind = 0;
    c.scanT = Math.random() * 0.1; c.wantRecycle = false;
    writePose(c);
    c.yaw = Math.atan2(-c.fx, -c.fz);
  }
  /** Calcule c.x, c.z, c.yaw (et le vecteur avant) depuis l'état de parcours. */
  function writePose(c) {
    if (c.phase === 0) {
      const h = c.h, off = hOff0[h] + c.lane * hLaneW[h];
      c.x = G.pointX(h, c.s, off); c.z = G.pointZ(h, c.s, off);
      c.fx = hUx[h]; c.fz = hUz[h];
    } else {
      const b = c.bez, u = c.cu, v = 1 - u;
      const a = v * v * v, bb = 3 * v * v * u, cc = 3 * v * u * u, dd = u * u * u;
      c.x = a * b[0] + bb * b[2] + cc * b[4] + dd * b[6]; c.z = a * b[1] + bb * b[3] + cc * b[5] + dd * b[7];
      const tx = 3 * v * v * (b[2] - b[0]) + 6 * v * u * (b[4] - b[2]) + 3 * u * u * (b[6] - b[4]);
      const tz = 3 * v * v * (b[3] - b[1]) + 6 * v * u * (b[5] - b[3]) + 3 * u * u * (b[7] - b[5]);
      const l = Math.hypot(tx, tz);
      if (l > 1e-4) { c.fx = tx / l; c.fz = tz / l; }
    }
    if (c.dodge !== 0 || c.dodgeSlope !== 0) {
      // écart d'évitement : décalage perpendiculaire à la trajectoire, cap incliné pendant le déport
      const rx = -c.fz, rz = c.fx, k = c.dodgeSlope;
      c.x += rx * c.dodge; c.z += rz * c.dodge;
      if (k !== 0) { const n = 1 / Math.sqrt(1 + k * k); c.fx = (c.fx + rx * k) * n; c.fz = (c.fz + rz * k) * n; }
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

  // ---------------------------------------------------------------- accidents
  // mode 0 = conduite (cinématique) ; mode 1 = accidentée : la physique locale du module véhicules l'emporte.
  // sev 1 = accrochage (repart après 2–4 s), 2 = choc moyen (détresse, repart au ralenti ou reste), 3 = épave.
  function honk(c) { ctx.bus.emit('traffic:honk', { x: c.x, z: c.z, vehicle: c.v }); }
  function crashCar(c, impact, by, push) {
    if (!c || !c.active) return;
    const v = c.v;
    let sev = impact < 5 ? 1 : 2;
    if (v.wrecked || v.damage > 0.8) sev = 3; // épave : décidée par le module véhicules (ou dégâts quasi totaux)
    if (c.mode === 1) { if (sev > c.sev) { c.sev = sev; if (sev >= 2 && v.controls) v.controls.blinker = 'hazard'; } c.restT = 0; return; }
    release(c); release2(c);
    c.mode = 1; c.sev = sev; c.restT = 0; c.crashAge = 0; c.braked = false; c.fails = 0;
    c.phase = 0; c.dodge = c.dodgeTarget = c.dodgeSlope = 0; c.emergT = 0; c.limpT = 0;
    c.stay = sev === 2 && Math.random() < (impact >= 11 ? 0.6 : 0.25); // choc violent : souvent immobilisée
    c.resumeT = sev === 1 ? 2 + Math.random() * 2 : 8 + Math.random() * 8;
    // on la rend au module véhicules : dynamique, sans conducteur
    v.remote = false; v.driver = null;
    if (v.setControls) v.setControls({ throttle: 0, brake: 0, steer: 0, handbrake: false });
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
    // les voitures voisines réagissent : coup de frein, parfois klaxon
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (!o.active || o === c || o.mode !== 0) continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      if (dx * dx + dz * dz > 28 * 28 || dx * o.fx + dz * o.fz > 0) continue; // seulement celles qui arrivent dessus
      o.emergT = 0.5 + Math.random() * 0.4;
      if (Math.random() < 0.4 && o.honkT <= 0) { o.honkT = 5; honk(o); }
    }
    if (T.alarm) T.alarm(c.x, c.z, impact);
  }
  /** Le conducteur reprend la route depuis la position réelle : arête la plus proche, courbe douce vers sa voie. */
  function tryRecover(c) {
    const v = c.v, fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    if (!G.nearest(v.pos.x, v.pos.z, 14, tmpN, true, fx, fz)) return false;
    const h = tmpN.h;
    if (fx * hUx[h] + fz * hUz[h] < -0.15) return false; // à contresens : trop de manœuvres
    const lane = Math.max(0, Math.min(hLanes[h] - 1, Math.round((tmpN.lat - hOff0[h]) / hLaneW[h])));
    const off = hOff0[h] + lane * hLaneW[h];
    const o = { h: c.h, lane: c.lane, next: c.next };
    c.h = h; c.lane = lane; c.next = pick(h); plan(c);
    const s1 = Math.min(tmpN.s + Math.max(8, Math.min(16, 7 + Math.abs(tmpN.lat - off) * 2.5)), c.sEnd - 1);
    if (c.next < 0 || s1 - tmpN.s < 4) { c.h = o.h; c.lane = o.lane; c.next = o.next; return false; }
    const b = c.bez, tx = G.pointX(h, s1, off), tz = G.pointZ(h, s1, off);
    const k = Math.hypot(tx - v.pos.x, tz - v.pos.z) / 3;
    b[0] = v.pos.x; b[1] = v.pos.z; b[2] = v.pos.x + fx * k; b[3] = v.pos.z + fz * k;
    b[4] = tx - hUx[h] * k; b[5] = tz - hUz[h] * k; b[6] = tx; b[7] = tz;
    c.cLen = measure(c); c.cu = 0; c.phase = 2; c.recS = s1;
    c.mode = 0; c.speed = 0; c.x = v.pos.x; c.z = v.pos.z; c.yaw = v.yaw; c.fx = fx; c.fz = fz;
    c.stuckT = c.idleT = c.blockT = 0; c.gap = 1e9; c.scanT = 0; c.wantRecycle = false;
    c.limpT = c.sev >= 2 ? 40 : 0;
    v.remote = true; v.driver = 'ai';
    if (v.controls) v.controls.blinker = c.sev >= 2 ? 'hazard' : null;
    return true;
  }
  /** Voiture accidentée : on suit sa position physique et on décide de la suite. */
  function crashedTick(c, dt) {
    const v = c.v;
    c.x = v.pos.x; c.z = v.pos.z; c.yaw = v.yaw; c.fx = -Math.sin(v.yaw); c.fz = -Math.cos(v.yaw); c.speed = v.speed || 0;
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
    const fx = c.fx, fz = c.fz, rx = -fz, rz = fx;
    const look = 9 + c.speed * 2.4, R = look + 12;
    const hl = c.halfLen, hw = c.halfWid;
    let gap = 1e9, gs = 0, kind = 0;
    let obs = false, obsL = 0, obsE = 0, obsX = 0, obsZ = 0; // obstacle fixe que l'on peut contourner
    const offPath = c.phase === 2 || c.dodge !== 0;
    const remC = c.phase === 0 ? c.sEnd - c.s + c.curveEst : (1 - c.cu) * c.cLen;

    // 1) autres voitures IA
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (!o.active || o === c) continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      if (dx > R || dx < -R || dz > R || dz < -R) continue;
      let g = 1e9, s2 = 0, isObs = false, sl = 0, ext = 0;
      // a) même itinéraire (fiable aussi dans les virages et quand des files convergent vers une même voie) :
      //    on compare les distances restantes jusqu'à la fin du virage ; la plus engagée passe devant.
      const free = offPath || o.mode !== 0 || o.phase === 2 || o.dodge !== 0; // hors itinéraire : couloir seulement
      if (free) { /* voir b) */ }
      else if (o.h === c.h) {
        if (o.next === c.next && o.nextLane === c.nextLane) {
          const remO = o.phase === 0 ? o.sEnd - o.s + o.curveEst : (1 - o.cu) * o.cLen;
          if (remO < remC || (remO === remC && o.idx < c.idx)) g = remC - remO;
          else continue; // elle est derrière nous
        } else if (c.phase === 0 && o.phase === 0 && o.lane === c.lane && o.s > c.s) g = o.s - c.s;
      } else if (o.phase === 0 && o.h === c.next && o.lane === c.nextLane) g = remC + o.s - c.nextS;
      if (g < 1e9) { g -= hl + o.halfLen; s2 = o.speed; }
      else {
        // b) couloir droit devant (trafic transversal, changements de file aux carrefours)
        const f = dx * fx + dz * fz;
        if (f < 0 || (f < 0.02 && c.idx < o.idx) || f > look + o.halfLen) continue;
        const hd = fx * o.fx + fz * o.fz;
        if (hd < -0.8 && !free) continue;         // en face : elle est dans l'autre sens
        const cross = hd < 0.7 && hd > -0.7;
        if (cross && c.ignoreT > 0 && o.mode === 0) continue; // sortie d'interblocage
        sl = dx * rx + dz * rz; ext = cross ? o.halfLen : o.halfWid;
        const l = Math.abs(sl);
        if (l > hw + ext + 0.3) continue;
        g = f - hl - (cross ? o.halfWid + 0.6 : o.halfLen);
        s2 = Math.max(0, o.speed * hd);
        isObs = o.mode === 1 && Math.abs(o.speed) < 0.5; // accidentée à l'arrêt : contournable
      }
      if (g < gap) { gap = g; gs = s2; kind = 1; obs = isObs; if (isObs) { obsL = sl; obsE = ext; obsX = o.x; obsZ = o.z; } }
    }

    // 2) véhicules non pilotés par le trafic (joueur local, joueurs distants, voitures abandonnées)
    const list = ctx.vehicles && ctx.vehicles.list, player = ctx.player;
    const pv = player && player.vehicle;
    if (list) for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (T.owner.has(v)) continue;
      const dx = v.pos.x - c.x, dz = v.pos.z - c.z;
      if (dx > R || dx < -R || dz > R || dz < -R) continue;
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
          if (c.dodgeTarget === 0 && c.phase === 0) swerve(c, sl >= 0 ? -1 : 1, v.pos.x, v.pos.z);
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
    if (player && player.pos && !pv) {
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

    // 4) piétons sur la chaussée (traversée, esquive)
    const peds = T.peds;
    if (peds) for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p.active) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      if (dx > R || dx < -R || dz > R || dz < -R) continue;
      const f = dx * fx + dz * fz;
      if (f <= 0.5 || f > look) continue;
      // sur la chaussée (traversée, chute, fuite) : marge large ; sinon seulement s'il est vraiment devant le capot
      if (Math.abs(dx * rx + dz * rz) > hw + (p.onRoad ? 1.1 : 0.45)) continue;
      const g = f - hl - 1.2;
      if (g < gap) {
        gap = g; gs = 0; kind = 3;
        obs = p.mode === 1; // piéton à terre : on le contourne
        if (obs) { obsL = dx * rx + dz * rz; obsE = 0.9; obsX = p.x; obsZ = p.z; }
      }
    }
    c.gap = gap; c.gapSpeed = gs; c.blockKind = gap < 12 ? kind : c.emergT > 0 ? 2 : 0;
    // contournement d'un obstacle fixe : on choisit le côté qui demande le plus petit écart, s'il tient sur la chaussée
    if (obs && gap < 14 && c.dodgeTarget === 0 && c.phase === 0 && c.mode === 0) {
      const h = c.h, off = hOff0[h] + c.lane * hLaneW[h], W = hWidth[h];
      const lo = -W / 2 + hw - 0.2 - off, hi = W / 2 - hw + 0.6 - off;
      const nl = obsL - obsE - hw - 0.5, nr = obsL + obsE + hw + 0.5;
      const okL = nl >= lo, okR = nr <= hi;
      if (okL || okR) {
        c.dodgeTarget = okL && (!okR || -nl <= nr) ? Math.min(nl, -0.05) : Math.max(nr, 0.05);
        c.passX = obsX; c.passZ = obsZ; c.passT = 0; c.swerveT = 0;
      }
    }
  }
  /** Léger écart réflexe (d'un côté, 1,2 m au plus) s'il reste de la place sur notre moitié de chaussée. */
  function swerve(c, side, x, z) {
    const h = c.h, off = hOff0[h] + c.lane * hLaneW[h], W = hWidth[h];
    const lo = (hDrive[h ^ 1] ? c.halfWid : -W / 2 + c.halfWid) - off, hi = W / 2 - c.halfWid + 0.5 - off;
    const d = side < 0 ? Math.max(-1.2, lo) : Math.min(1.2, hi);
    if (Math.abs(d) < 0.3) return;
    c.dodgeTarget = d; c.passX = x; c.passZ = z; c.passT = 0; c.swerveT = 2;
  }

  // ---------------------------------------------------------------- conduite
  function drive(c, dt) {
    c.scanT -= dt;
    if (c.honkT > 0) c.honkT -= dt;
    if (c.scanT <= 0) { c.scanT = 0.07 + Math.random() * 0.03; scan(c); if (c.mode !== 0) return; }
    else if (c.gap < 1e8) c.gap -= (c.speed - c.gapSpeed) * dt; // extrapolation entre deux balayages

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
        if (c.vCurve < vmax) vmax = Math.min(vmax, Math.sqrt(c.vCurve * c.vCurve + 2 * BRAKE * dC));
        // virage d'après (arêtes courtes : il faut freiner dès maintenant)
        const t2 = c.t2;
        if (t2.vCurve < vmax) vmax = Math.min(vmax, Math.sqrt(t2.vCurve * t2.vCurve + 2 * BRAKE * (dC + c.curveEst + Math.max(0, t2.sEnd - c.nextS))));
        // priorité : réserver le carrefour au bout de l'arête, et celui d'après si l'on ne pourra pas s'arrêter avant
        const nodeA = hTo[h], nodeB = hTo[c.next];
        const needA = nodeJunction[nodeA] && c.lockNode !== nodeA;
        const needB = c.next2 >= 0 && nodeJunction[nodeB] && nodeB !== nodeA && c.lock2 !== nodeB && t2.sStop - c.nextS < 1.5;
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

    if (c.limpT > 0) { // repart au ralenti après un choc moyen, feux de détresse allumés
      c.limpT -= dt; if (vmax > 4) vmax = 4;
      if (c.limpT <= 0 && c.v.controls) c.v.controls.blinker = null;
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
    // distance de sécurité
    if (c.gap < 1e8) {
      const g = c.gap - (dodging && c.swerveT <= 0 ? 0.7 : MIN_GAP);
      const lim = g <= 0 ? 0 : Math.sqrt(c.gapSpeed * c.gapSpeed + 2 * BRAKE * g);
      if (lim < vmax) vmax = lim;
    }
    if (c.speed < vmax) c.speed = Math.min(vmax, c.speed + ACC * dt);
    else c.speed = Math.max(vmax, c.speed - BRAKE_MAX * dt);

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
      if (c.idleT > 40) c.wantRecycle = true;
    } else { c.idleT = 0; c.stuckT = 0; c.blockT = 0; }

    // avance
    let ds = c.speed * dt;
    if (ds > 0) {
      if (c.dodge !== c.dodgeTarget) {
        // le déport suit l'avance (1 m d'écart par 1,25 m parcouru au plus) : jamais de glissade sur place
        const d = c.dodgeTarget - c.dodge, m = ds * 0.8, st = d > m ? m : d < -m ? -m : d;
        c.dodge += st; c.dodgeSlope = st / ds;
      } else c.dodgeSlope = 0;
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
          c.h = c.next; c.lane = c.nextLane; c.phase = 0; c.next = c.next2;
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
      const lim = Math.max(1.6, c.speed * 0.5) * dt;
      c.yaw += da > lim ? lim : da < -lim ? -lim : da;
    }
    c.v.setTransform(c.x, c.z, c.yaw, c.speed);
  }

  // ---------------------------------------------------------------- pool
  function deactivate(c) {
    if (!c.active) return;
    release(c); release2(c);
    c.active = false; activeCount--;
    const i = active.indexOf(c.v); if (i >= 0) active.splice(i, 1);
    resetCar(c);
    c.x = FAR + c.idx * 12; c.z = FAR; c.speed = 0;
    c.v.group.visible = false;
    c.v.setTransform(c.x, c.z, 0, 0);
  }
  /** Remet une voiture (éventuellement accidentée) à l'état neuf, pilotée par le trafic. */
  function resetCar(c) {
    const v = c.v;
    c.mode = 0; c.sev = 0; c.dodge = c.dodgeTarget = c.dodgeSlope = 0; c.emergT = 0; c.limpT = 0; c.phase = 0;
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
      const sd = opts && opts.side === 'right' ? 1 : -1, out = c.halfWid + 0.75, along = v.seat ? -v.seat.z : -0.1;
      let x = v.pos.x + rx * sd * out + fx * along, z = v.pos.z + rz * sd * out + fz * along;
      if (ctx.collision && ctx.collision.test(x, z, 0.35, 1)) {
        const x2 = v.pos.x - rx * sd * out + fx * along, z2 = v.pos.z - rz * sd * out + fz * along;
        if (!ctx.collision.test(x2, z2, 0.35, 1)) { x = x2; z = z2; }
      }
      T.spawnEjected(x, z, yaw, v.pos.x, v.pos.z, c.look);
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
    const v = ctx.vehicles.spawn(typeId, FAR, FAR, 0, { remote: true, color });
    if (!v) return null;
    v.driver = 'ai';
    const sp = v.spec || spec;
    const c = {
      v, idx: cars.length, active: false, h: 0, next: -1, lane: 0, nextLane: 0, s: 0, sEnd: 0, sStop: 0, nextS: 0, curveEst: 0, theta: 0,
      phase: 0, cu: 0, cLen: 1, bez: new Float32Array(8), vCurve: 99, speed: 0, pers: 0.82 + Math.random() * 0.3,
      x: FAR, z: FAR, yaw: 0, fx: 0, fz: -1, halfLen: sp.length * 0.5, halfWid: sp.width * 0.5,
      lockNode: -1, lockGen: 0, forced: false, lock2: -1, lock2Gen: 0, forced2: false, next2: -1,
      t2: { sEnd: 0, nextS: 0, nextLane: 0, theta: 0, curveEst: 0, vCurve: 99, sStop: 0 }, waitT: 0, stuckT: 0, idleT: 0, blockT: 0, stunT: 0, honkT: 0, ignoreT: 0, scanT: 0,
      gap: 1e9, gapSpeed: 0, blockKind: 0, wantRecycle: false, occ: null, look: null, holdT: 0, holdCd: 0,
      mode: 0, sev: 0, restT: 0, crashAge: 0, resumeT: 0, stay: false, braked: false, fails: 0, limpT: 0, emergT: 0, recS: 0,
      dodge: 0, dodgeTarget: 0, dodgeSlope: 0, passX: 0, passZ: 0, passT: 0, swerveT: 0,
    };
    cars.push(c); T.owner.set(v, c);
    return c;
  }
  /** Cherche une place libre hors champ dans l'anneau et y pose la voiture `c` (ou une nouvelle). */
  function trySpawn(c, burst) {
    const rMin = burst ? 45 : T.SPAWN_MIN, rMax = T.SPAWN_MAX;
    if (!G.randomEdgeNear(T.fx, T.fz, rMin, rMax, tmp, 5)) return false;
    let h = 2 * tmp.e + (Math.random() < 0.5 ? 1 : 0), s = tmp.s;
    if (!hDrive[h]) h ^= 1;
    if (!hDrive[h]) return false;
    if (h & 1) s = hLen[h] - s;
    if (!burst && T.inView(tmp.x, tmp.z)) return false;
    const list = ctx.vehicles.list;
    for (let i = 0; i < list.length; i++) {
      const dx = list[i].pos.x - tmp.x, dz = list[i].pos.z - tmp.z;
      if (dx * dx + dz * dz < 16 * 16) return false;
    }
    if (!c) c = newCar();
    if (!c) return false;
    c.active = true; activeCount++; active.push(c.v);
    c.v.group.visible = true;
    seatDriver(c);
    place(c, h, s);
    c.v.setTransform(c.x, c.z, c.yaw, c.speed);
    return true;
  }

  // ---------------------------------------------------------------- voitures garées
  function tryPark(slot, burst) {
    if (!G.randomEdgeNear(T.fx, T.fz, burst ? 25 : 90, 260, tmp, 4)) return false;
    let h = 2 * tmp.e + (Math.random() < 0.5 ? 1 : 0);
    if (hKind[h] === 4 || !(hDrive[h] || hDrive[h ^ 1])) return false;
    const road = G.eRoad[tmp.e], len = hLen[h];
    if (len < 24 || (road && road.bridge)) return false;
    let s = h & 1 ? len - tmp.s : tmp.s;
    s = Math.max(9, Math.min(len - 9, s));
    const typeId = slot ? slot.v.typeId : PARK_TYPES[(Math.random() * PARK_TYPES.length) | 0];
    const spec = VEHICLE_BY_ID[typeId] || VEHICLE_BY_ID.citadine;
    // voie la plus proche de ce bord : il faut laisser passer le trafic (rue étroite : à cheval sur le trottoir)
    const outer = hDrive[h] ? hOff0[h] + (hLanes[h] - 1) * hLaneW[h] : -hOff0[h ^ 1];
    const off = Math.max(hWidth[h] / 2 - spec.width / 2 - 0.25, outer + 2.2);
    if (off + spec.width / 2 > hWidth[h] / 2 + 0.55) return false;
    const x = G.pointX(h, s, off), z = G.pointZ(h, s, off);
    if (!burst && T.inView(x, z)) return false;
    const list = ctx.vehicles.list;
    for (let i = 0; i < list.length; i++) {
      const dx = list[i].pos.x - x, dz = list[i].pos.z - z;
      if (dx * dx + dz * dz < 49) return false;
    }
    if (ctx.collision && ctx.collision.test(x, z, 1.0, 0.5)) return false;
    const dir = hDrive[h] ? 1 : -1; // garée dans le sens de la circulation
    const yaw = G.yawOf(hUx[h] * dir, hUz[h] * dir);
    if (slot) { slot.v.setTransform(x, z, yaw, 0); slot.x = x; slot.z = z; return true; }
    const v = ctx.vehicles.spawn(typeId, x, z, yaw, { color: spec.colors[(Math.random() * spec.colors.length) | 0] });
    if (!v) return false;
    T.owner.set(v, PARKED);
    parked.push({ v, x: v.pos.x, z: v.pos.z });
    return true;
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
      if (parked.length > targetParked && d2 > 150 * 150 && !T.inView(p.x, p.z)) { parked.splice(i, 1); T.owner.delete(v); ctx.vehicles.remove(v); continue; }
      if (d2 > 330 * 330) tryPark(p, false);
    }
    for (let i = loose.length - 1; i >= 0; i--) {
      const v = loose[i];
      if (!list.includes(v)) { loose.splice(i, 1); continue; }
      if (v.driver != null) continue; // occupée : on n'y touche pas
      const d2 = (v.pos.x - fx) * (v.pos.x - fx) + (v.pos.z - fz) * (v.pos.z - fz);
      if (d2 > T.DESPAWN * T.DESPAWN) { loose.splice(i, 1); ctx.vehicles.remove(v); }
    }
    if (parked.length < targetParked) tryPark(null, burst);
  }

  // ---------------------------------------------------------------- boucle
  function update(dt, burst) {
    const fx = T.fx, fz = T.fz, D2 = T.DESPAWN * T.DESPAWN;
    frame++;
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      if (c.mode === 1 ? c.v.driver != null : c.v.driver !== 'ai') {
        // Empruntée par un joueur : on la relâche (plus pilotée, plus supprimée tant qu'elle sert).
        if (c.active) { release(c); release2(c); c.active = false; activeCount--; const k = active.indexOf(c.v); if (k >= 0) active.splice(k, 1); }
        T.owner.delete(c.v);
        unseatDriver(c, true); // prise sans passer par ejectDriver : le conducteur disparaît
        if (c.v.driver === 'local' && c.v.remote) c.v.remote = false; // physique locale pour le joueur
        loose.push(c.v);
        cars.splice(i, 1);
        continue;
      }
      if (!c.active) continue;
      if (c.mode === 1) {
        crashedTick(c, dt);
        // épave ou voiture restée sur place : recyclée seulement loin du joueur et hors champ
        const dx = c.x - fx, dz = c.z - fz, d2 = dx * dx + dz * dz;
        if (d2 > D2 || (c.mode === 1 && (c.sev === 3 || c.stay) && c.crashAge > 20 && d2 > 160 * 160 && !T.inView(c.x, c.z))) deactivate(c);
        continue;
      }
      drive(c, dt);
      if (c.mode === 1) continue;
      // conducteur : pose recalculée seulement de près (mains sur le volant) ; au loin il reste figé
      if (c.occ && (c.x - fx) * (c.x - fx) + (c.z - fz) * (c.z - fz) < 45 * 45 && ((frame + i) & 3) === 0) c.occ.update(dt * 4);
      const dx = c.x - fx, dz = c.z - fz, d2 = dx * dx + dz * dz;
      if (d2 > D2 || (c.wantRecycle && !T.inView(c.x, c.z))) deactivate(c);
    }
    for (let i = 0; i < cars.length; i++) cars[i].idx = i;

    // apparitions étalées : au plus 1 par frame (2 en rafale au démarrage / après téléportation)
    const want = Math.min(targetCars, T.MAX_CARS);
    for (let n = burst ? 2 : 1; n > 0 && activeCount < want; n--) {
      let spare = null;
      for (let i = 0; i < cars.length; i++) if (!cars[i].active) { spare = cars[i]; break; }
      trySpawn(spare, burst);
    }
    // surplus (densité réduite, nuit) : on retire les réserves, puis des voitures hors champ
    if (cars.length > want) {
      for (let i = cars.length - 1; i >= 0 && cars.length > want; i--) {
        const c = cars[i];
        if (!c.active || (c.mode === 0 && !T.inView(c.x, c.z))) { destroy(c); break; } // une par frame
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
    if (T.alarm && e.impact > 5) T.alarm(e.vehicle.pos.x, e.vehicle.pos.z, e.impact);
  }

  return {
    update, onCrash, onHit, crashCar, ejectDriver, states: cars, active, parked, loose,
    setTargets(nCars, nParked) { targetCars = nCars; targetParked = nParked; },
    get activeCount() { return activeCount; },
    dispose() { while (cars.length) destroy(cars[cars.length - 1]); for (const p of parked) { T.owner.delete(p.v); ctx.vehicles.remove(p.v); } parked.length = 0; },
  };
}

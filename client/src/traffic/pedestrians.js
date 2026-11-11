// Trafic — piétons : ils longent les trottoirs (décalés de road.width/2 + 1,5 m de l'axe), tournent aux
// coins en restant sur leur trottoir, font parfois demi-tour ou traversent, esquivent les voitures (avec un
// temps de réaction : certains sont distraits) et peuvent être bousculés ou renversés — sans gore : ils
// tombent, restent au sol quelques secondes, se relèvent et s'éloignent.
//
// Machine à états (p.mode) :
//   0 NORMAL  marche / attente / traversée / immobile (idle) / esquive
//   1 À TERRE projeté (balistique), glisse, puis allongé pendant downT
//   2 RELÈVE  anim 'getup' (1,6 s)
//   3 FUITE   s'éloigne en courant ('flee', sinon 'run'), ou en boitant s'il a été heurté fort ; puis retour au trottoir
//   4 BADAUD  s'arrête et regarde un accident à distance (ou proteste, tourné vers sa voiture volée)
//   5 ÉJECTÉ  conducteur sorti de sa voiture (vol) : titube 1,2 s, puis proteste (4) ou s'enfuit (3)
import { createCharacter } from '../player/index.js';

const CLOTHES = ['#2b3a55', '#6b1f2a', '#30475e', '#3d5a45', '#8a6d3b', '#1f1f24', '#7a7f8a', '#b04a3a', '#3f6a8a', '#d9d2c5', '#5b4a6e', '#c9a227', '#2f4f4f', '#a8324a'];
const SKINS = ['#f1c9a5', '#e0ac7e', '#c68d5e', '#9a6a44', '#6e4a2f', '#f6d7bd'];
const pick = (a) => a[(Math.random() * a.length) | 0];

const BUMP_SPEED = 2.2;   // m/s (≈ 8 km/h) : en dessous on est bousculé, au-dessus renversé
const HURT_SPEED = 10;    // m/s : au-delà, on repart en boitant
const PED_MASS = 75;      // kg, pour l'impulsion rendue à la voiture
const GRAV = 9.8, SLIDE = 7;
const MAXV = 128;

export function createPedestrians(T) {
  const { ctx, G } = T;
  const { hTo, hUx, hUz, hLen, hDrive, hWalk, hWidth, outStart, outList, nodeJunction } = G;
  const peds = [];
  T.peds = peds;
  const tmp = { e: 0, s: 0, x: 0, z: 0 };
  const tmpN = { h: -1, s: 0, d: 0, lat: 0 };
  let target = 0, activeCount = 0, frame = 0, lastAlarm = -9;

  // Véhicules proches, mis à plat une fois par frame (pas de trigonométrie par piéton).
  const vX = new Float32Array(MAXV), vZ = new Float32Array(MAXV), vFx = new Float32Array(MAXV), vFz = new Float32Array(MAXV);
  const vHl = new Float32Array(MAXV), vHw = new Float32Array(MAXV), vSp = new Float32Array(MAXV), vVx = new Float32Array(MAXV), vVz = new Float32Array(MAXV);
  const vAI = new Uint8Array(MAXV), vRef = new Array(MAXV).fill(null);
  let nV = 0;
  function gatherVehicles() {
    nV = 0;
    const list = ctx.vehicles && ctx.vehicles.list;
    if (!list) return;
    const R = T.PED_RADIUS + 70, fx = T.fx, fz = T.fz;
    for (let i = 0; i < list.length && nV < MAXV; i++) {
      const v = list[i];
      const dx = v.pos.x - fx, dz = v.pos.z - fz;
      if (dx > R || dx < -R || dz > R || dz < -R) continue;
      const k = nV++, sp = v.speed || 0, f1 = -Math.sin(v.yaw), f2 = -Math.cos(v.yaw);
      vX[k] = v.pos.x; vZ[k] = v.pos.z; vFx[k] = f1; vFz[k] = f2; vSp[k] = sp;
      vHl[k] = v.spec ? v.spec.length * 0.5 : 2.2; vHw[k] = v.spec ? v.spec.width * 0.5 : 0.95;
      if (v.vel && !v.remote) { vVx[k] = v.vel.x; vVz[k] = v.vel.z; } else { vVx[k] = f1 * sp; vVz[k] = f2 * sp; }
      const own = T.owner.get(v);
      vAI[k] = own && !own.parked && own.mode === 0 ? 1 : 0;
      vRef[k] = v;
    }
  }

  const sx = (h, s, p) => G.pointX(h, s, p.side * (hWalk[h] + p.jit));
  const sz = (h, s, p) => G.pointZ(h, s, p.side * (hWalk[h] + p.jit));

  /** Choisit la suite au bout de la demi-arête courante : on reste sur le même trottoir en tournant au coin. */
  function choose(p) {
    const h = p.h, node = hTo[h], ux = hUx[h], uz = hUz[h], len = hLen[h];
    let best = -1, bestPhi = -9;
    for (let k = outStart[node]; k < outStart[node + 1]; k++) {
      const o = outList[k];
      if (o === (h ^ 1)) continue;
      // angle signé du virage, positif = vers le côté du trottoir suivi
      const phi = Math.atan2(ux * hUz[o] - uz * hUx[o], ux * hUx[o] + uz * hUz[o]) * p.side;
      if (phi > bestPhi) { bestPhi = phi; best = o; }
    }
    if (best < 0) { p.nextH = h ^ 1; p.nextSide = p.side; p.tEnd = Math.min(0.5, len * 0.3); p.nextT = p.tEnd; return; } // cul-de-sac : on contourne le bout
    if (nodeJunction[node] && Math.random() < 0.1) { // demi-tour sur le même trottoir
      p.nextH = h ^ 1; p.nextSide = -p.side; p.tEnd = Math.min(1, len * 0.3); p.nextT = p.tEnd; return;
    }
    p.nextH = best; p.nextSide = p.side;
    let tA = 0.3, tB = 0.3;
    if (bestPhi > 0.1) { // coin intérieur : on coupe à l'intersection des deux lignes de trottoir
      const offA = hWalk[h] + p.jit, offB = hWalk[best] + p.jit, c = Math.cos(bestPhi), s = Math.max(Math.sin(bestPhi), 0.3);
      tA = (offB + offA * c) / s; tB = (offA + offB * c) / s;
    }
    p.tEnd = Math.max(0.3, Math.min(tA, 14, len * 0.45));
    p.nextT = Math.max(0.3, Math.min(tB, 14, hLen[best] * 0.45));
  }
  function goEnd(p) { const s = hLen[p.h] - p.tEnd; p.stage = 1; p.tx = sx(p.h, s, p); p.tz = sz(p.h, s, p); }
  function advance(p) {
    p.h = p.nextH; p.side = p.nextSide;
    const s0 = p.nextT;
    choose(p);
    if (s0 < hLen[p.h] - p.tEnd - 0.5) { p.stage = 0; p.tx = sx(p.h, s0, p); p.tz = sz(p.h, s0, p); }
    else goEnd(p);
  }
  function arrive(p) {
    if (p.stage === 0) { p.onRoad = false; goEnd(p); return; }
    if (p.stage === 3) { p.onRoad = false; p.cur = p.speed; choose(p); advance(p); return; }
    // bout d'arête : parfois on traverse la rue
    const h = p.h;
    if (p.crossCd <= 0 && Math.random() < 0.1 && (hDrive[h] || hDrive[h ^ 1]) && hWidth[h] < 24) {
      p.stage = 2; p.waitT = 0.4 + Math.random() * 1.5; p.waited = 0; p.crossCd = 25;
      return;
    }
    advance(p);
  }
  /** Change d'animation ; si le personnage ne connaît pas `anim` (module en cours d'écriture), utilise `fallback`. */
  function setAnim(p, anim, speed, fallback) {
    if (p.anim === anim && Math.abs(p.animSpeed - speed) < 0.05) return;
    p.anim = anim; p.animSpeed = speed;
    p.ch.setState({ anim, speed });
    if (fallback && p.ch.anim !== undefined && p.ch.anim !== anim) p.ch.setState({ anim: fallback, speed });
  }
  const walkAnim = (p) => setAnim(p, p.jog ? 'run' : 'walk', p.cur || p.speed);
  function turnBack(p) { p.h ^= 1; p.side = -p.side; choose(p); goEnd(p); }

  // ---------------------------------------------------------------- chocs
  function knock(p, i, l, rvx, rvz, rel) {
    const v = vRef[i], dirX = rvx / rel, dirZ = rvz / rel;
    const rx = -vFz[i], rz = vFx[i], side = l >= 0 ? 1 : -1, lat = (0.25 + 0.5 * Math.min(1, Math.abs(l) / vHw[i])) * 0.5 * rel;
    const first = p.mode !== 1;
    p.mode = 1; p.onRoad = true; p.dodgeT = 0; p.hitCd = 0.6; p.threatT = 0;
    // projeté un peu plus vite que la voiture, vers l'avant et sur le côté où il a été pris
    p.vx = vVx[i] * 1.05 + rx * side * lat; p.vz = vVz[i] * 1.05 + rz * side * lat;
    p.vy = Math.min(1.2 + rel * 0.22, 5.5); if (p.hy < 0.05) p.hy = 0.05;
    p.downT = Math.max(p.downT, 2.5 + Math.min(rel, 25) * 0.28); // plus le choc est violent, plus il reste au sol
    p.hurt = p.hurt || rel > HURT_SPEED;
    p.srcX = vX[i]; p.srcZ = vZ[i];
    if (p.hasKnock) { try { p.ch.knock({ dirX, dirZ, speed: rel }); } catch (e) { p.hasKnock = false; } }
    if (!p.hasKnock) { // repli : le groupe bascule au sol, dos vers la direction du choc
      p.group.rotation.order = 'YXZ'; p.tiltTarget = 1.45; p.yaw = Math.atan2(dirX, dirZ);
      setAnim(p, 'lying', 0, 'idle');
      if (p.ch.anim === 'lying') p.tiltTarget = 0; // le personnage sait déjà s'allonger
    } else { p.anim = 'lying'; p.animSpeed = 0; }
    if (first || rel > 4) {
      ctx.bus.emit('pedestrian:hit', { x: p.x, z: p.z, speed: rel, vehicle: v, severity: 'knockdown', pedestrian: p });
      if (v && !v.remote && v.applyImpulse) v.applyImpulse(-dirX * PED_MASS * rel * 0.6, -dirZ * PED_MASS * rel * 0.6, p.x, p.z);
    }
    const own = T.owner.get(v);
    if (own && own.emergT !== undefined) own.emergT = 1.5; // une IA qui touche un piéton pile
    alarm(p.x, p.z, rel, false);
  }
  function bump(p, i, l, rel) {
    const v = vRef[i], rx = -vFz[i], rz = vFx[i], side = l >= 0 ? 1 : -1;
    p.hitCd = 1.5; p.ddx = rx * side; p.ddz = rz * side; p.dodgeT = 0.9; p.threatT = 9; // il s'écarte vivement
    if (p.mode === 4) p.mode = 0;
    setAnim(p, 'stumble', 3, 'run');
    ctx.bus.emit('pedestrian:hit', { x: p.x, z: p.z, speed: rel, vehicle: v, severity: 'bump', pedestrian: p });
    if (v && !v.remote && v.applyImpulse) v.applyImpulse(-vFx[i] * Math.sign(vSp[i] || 1) * PED_MASS * rel * 0.3, -vFz[i] * Math.sign(vSp[i] || 1) * PED_MASS * rel * 0.3, p.x, p.z);
    const own = T.owner.get(v);
    if (own && own.emergT !== undefined) own.emergT = 1;
  }
  function startFlee(p, fromX, fromZ, dur, limp) {
    let dx = p.x - fromX, dz = p.z - fromZ; const d = Math.hypot(dx, dz);
    if (d < 0.1) { const a = Math.random() * 6.28; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= d; dz /= d; }
    p.mode = 3; p.fdx = dx; p.fdz = dz; p.fleeT = dur; p.dodgeT = 0; p.onRoad = true; p.tiltTarget = 0;
    p.cur = limp ? 0.9 : 4.6 + Math.random() * 0.8;
    if (limp) setAnim(p, 'limp', p.cur, 'walk'); else setAnim(p, 'flee', p.cur, 'run');
  }
  /** Retour à la vie normale : trottoir le plus proche. */
  function resnap(p) {
    p.mode = 0; p.hurt = false; p.downT = 0; p.tiltTarget = 0;
    if (!G.nearest(p.x, p.z, 45, tmpN, false, 0, 0)) { p.idle = true; p.onRoad = false; setAnim(p, 'idle', 0); return; }
    let h = tmpN.h, lat = tmpN.lat, s = tmpN.s;
    if (Math.random() < 0.5) { h ^= 1; lat = -lat; s = hLen[h] - s; }
    p.idle = false; p.h = h; p.side = lat >= 0 ? 1 : -1;
    choose(p);
    // d'abord rejoindre le trottoir à sa hauteur (on est peut-être sur la chaussée), puis reprendre la marche
    s = Math.min(s, Math.max(0, hLen[h] - p.tEnd - 0.6));
    p.stage = 0; p.tx = sx(h, s, p); p.tz = sz(h, s, p);
    p.onRoad = Math.abs(lat) < hWidth[h] / 2 + 0.5;
    p.cur = p.speed; walkAnim(p);
  }
  /** Accident ou voiture folle en (x, z) : les proches s'enfuient, certains plus loin s'arrêtent pour regarder. */
  function alarm(x, z, power, noWatch) {
    if (T.now - lastAlarm < 0.3) return;
    lastAlarm = T.now;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p.active || (p.mode !== 0 && p.mode !== 4) || p.needSnap) continue;
      const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
      if (d2 < 14 * 14) { if (d2 > 0.5) startFlee(p, x, z, 3 + Math.random() * 3, false); }
      else if (!noWatch && d2 < 38 * 38 && p.mode === 0 && !p.jog && p.stage !== 3 && Math.random() < 0.4) {
        p.mode = 4; p.watchT = 4 + Math.random() * 6; p.wx = x; p.wz = z; p.dodgeT = 0;
        setAnim(p, 'idle', 0);
      }
    }
  }
  T.alarm = alarm;
  /** Conducteur éjecté de sa voiture (vol) : piéton à part entière, qui titube, puis proteste ou s'enfuit. */
  T.spawnEjected = (x, z, yaw, carX, carZ, look) => {
    const p = newPed(look);
    if (!p) return null;
    activate(p, x, z);
    p.idle = false; p.yaw = yaw; p.mode = 5; p.getT = 1.15; p.srcX = carX; p.srcZ = carZ; p.needSnap = true; p.onRoad = true; p.cur = 0;
    setAnim(p, 'stumble', 0, 'idle');
    place(p);
    // les passants proches regardent, quelques-uns s'éloignent
    for (let i = 0; i < peds.length; i++) {
      const q = peds[i];
      if (!q.active || q === p || q.mode !== 0) continue;
      const dx = q.x - x, dz = q.z - z, d2 = dx * dx + dz * dz;
      if (d2 > 26 * 26) continue;
      if (d2 < 10 * 10 && Math.random() < 0.3) startFlee(q, x, z, 2.5 + Math.random() * 2, false);
      else if (!q.jog && q.stage !== 3 && Math.random() < 0.6) { q.mode = 4; q.watchT = 3 + Math.random() * 5; q.wx = carX; q.wz = carZ; q.dodgeT = 0; setAnim(q, 'idle', 0); }
    }
    return p;
  };

  /** Contacts (balayés, donc sans effet tunnel) et menaces pour un piéton ; `full` = avec la partie esquive. */
  function vehicles(p, dt, full) {
    let threat = false, tdx = 0, tdz = 0, near = false;
    const down = p.mode === 1;
    for (let i = 0; i < nV; i++) {
      const dx = p.x - vX[i], dz = p.z - vZ[i];
      if (dx > 34 || dx < -34 || dz > 34 || dz < -34) continue;
      const fx = vFx[i], fz = vFz[i], f = dx * fx + dz * fz, l = dx * -fz + dz * fx, al = l < 0 ? -l : l;
      const hl = vHl[i], hw = vHw[i], sp = vSp[i];
      if (al < hw + 0.3 && p.hy < 1.1 && f < hl + 0.3 + 3 && f > -hl - 0.3 - 3) {
        // vitesse relative voiture → piéton (un piéton déjà projeté par cette voiture ne la « subit » plus)
        const rvx = vVx[i] - (down ? p.vx : 0), rvz = vVz[i] - (down ? p.vz : 0);
        const rf = rvx * fx + rvz * fz, rel = Math.hypot(rvx, rvz), sw = rf * dt;
        // le piéton, vu de la voiture, a parcouru [f, f + sw] pendant ce pas : contact si ce segment touche la caisse
        const lo = sw > 0 ? f : f + sw, hi = sw > 0 ? f + sw : f;
        if (hi > -hl - 0.3 && lo < hl + 0.3) {
          // une IA en conduite normale roule prudemment : en dessous de 6 m/s elle ne fait que bousculer
          if (rel >= (vAI[i] ? 6 : BUMP_SPEED) && p.hitCd <= 0 && (rf > 0 ? f > -hl * 0.5 : f < hl * 0.5)) { knock(p, i, l, rvx, rvz, rel); continue; }
          if (rel >= 0.5 && p.hitCd <= 0 && !down && p.mode !== 2) bump(p, i, l, rel);
          if (p.hy <= 0 && f < hl + 0.3 && f > -hl - 0.3) { // jamais sous la caisse : repoussé sur le côté
            const sign = l >= 0 ? 1 : -1, shift = hw + 0.4 - al;
            p.x += -fz * sign * shift; p.z += fx * sign * shift;
          }
        }
      }
      if (!full) continue;
      const asp = sp < 0 ? -sp : sp;
      if (asp > 1) {
        if (dx * dx + dz * dz < 22 * 22) near = true;
        // les IA freinent d'elles-mêmes ; on fuit surtout les autres (horizon ≈ 1 s de trajet)
        const ahead = vAI[i] ? 2 + asp * 0.35 : 2.5 + asp;
        const ff = sp > 0 ? f : -f;
        if (ff > -1 && ff < hl + ahead && al < hw + (asp > 8 && !vAI[i] ? 1.4 : 0.9)) {
          const sign = al < 0.15 ? (p.idx & 1 ? 1 : -1) : (l >= 0 ? 1 : -1);
          threat = true; tdx = -fz * sign; tdz = fx * sign;
          // voiture lancée sur le trottoir : panique autour
          if (asp > 8 && !vAI[i] && !p.onRoad && al < hw + 0.9) alarm(p.x, p.z, asp, true);
        }
      }
    }
    if (!full) return;
    p.carNear = near;
    if (threat) {
      p.threatT += 0.12;
      if (p.threatT >= p.react && (p.mode === 0 || p.mode === 4)) { p.mode = 0; p.ddx = tdx; p.ddz = tdz; p.dodgeT = 0.7; }
    } else p.threatT = 0;
  }

  // ---------------------------------------------------------------- pool
  function newPed(look) {
    const ch = createCharacter(ctx, look ? { color: look.color, skin: look.skin, name: look.name } : { color: pick(CLOTHES), skin: pick(SKINS) });
    if (!ch || !ch.group) return null;
    ctx.scene.add(ch.group);
    const jog = Math.random() < 0.06;
    const p = {
      ch, group: ch.group, active: false, idle: false, x: 0, y: 0, z: 0, yaw: 0, h: 0, side: 1, nextH: 0, nextSide: 1, nextT: 0, tEnd: 0,
      stage: 1, tx: 0, tz: 0, speed: jog ? 3 + Math.random() : 1.05 + Math.random() * 0.8, jog, cur: 0, anim: '', animSpeed: -1,
      jit: Math.random() * 1.3 - 0.5, onRoad: false, dodgeT: 0, ddx: 0, ddz: 0, waitT: 0, waited: 0, crossCd: 0, carNear: false,
      scanT: Math.random() * 0.12, colT: Math.random() * 0.25, stallT: 0, stalls: 0, animAcc: 0, idx: peds.length,
      // réaction au danger : délai avant d'esquiver (les distraits réagissent trop tard)
      react: Math.random() < 0.25 ? 0.7 + Math.random() * 0.6 : 0.12 + Math.random() * 0.3, threatT: 0,
      mode: 0, vx: 0, vz: 0, vy: 0, hy: 0, downT: 0, getT: 0, hitCd: 0, hurt: false, srcX: 0, srcZ: 0,
      needSnap: false, fdx: 0, fdz: 0, fleeT: 0, watchT: 0, wx: 0, wz: 0, tilt: 0, tiltTarget: 0, yOff: 0, hasKnock: typeof ch.knock === 'function',
    };
    peds.push(p);
    return p;
  }
  function activate(p, x, z) {
    p.x = x; p.z = z; p.active = true; activeCount++;
    p.onRoad = false; p.dodgeT = 0; p.stallT = 0; p.stalls = 0; p.crossCd = 5 + Math.random() * 20;
    p.mode = 0; p.vx = p.vz = p.vy = p.hy = 0; p.downT = 0; p.hitCd = 0; p.hurt = false; p.threatT = 0;
    p.tilt = p.tiltTarget = 0; p.group.rotation.x = 0; p.yOff = 0; p.needSnap = false;
    p.hasKnock = typeof p.ch.knock === 'function';
    p.group.visible = true;
  }
  function deactivate(p) {
    if (!p.active) return;
    p.active = false; activeCount--; p.onRoad = false; p.mode = 0;
    p.group.visible = false;
  }
  function trySpawn(p, burst) {
    const fx = T.fx, fz = T.fz;
    // immobiles près d'un monument
    if (Math.random() < 0.2) {
      const lms = ctx.LANDMARKS || [];
      for (let i = 0; i < lms.length; i++) {
        const L = lms[i], d = Math.hypot(L.x - fx, L.z - fz);
        if (d > 150 + L.radius) continue;
        const a = Math.random() * Math.PI * 2, r = L.radius + 2 + Math.random() * 12;
        const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
        const d2 = (x - fx) * (x - fx) + (z - fz) * (z - fz);
        if (d2 > T.PED_RADIUS * T.PED_RADIUS || d2 < 144) return false;
        if (!burst && d2 < 70 * 70 && T.inView(x, z)) return false;
        if (ctx.collision && ctx.collision.test(x, z, 0.5, 1)) return false;
        if (ctx.world && ctx.world.roadAt && ctx.world.roadAt(x, z)) return false;
        if (!p) p = newPed();
        if (!p) return false;
        activate(p, x, z);
        p.idle = true;
        p.yaw = Math.atan2(-(L.x - x), -(L.z - z)) + (Math.random() - 0.5) * 1.6;
        setAnim(p, 'idle', 0);
        place(p);
        return true;
      }
    }
    if (!G.randomEdgeNear(fx, fz, burst ? 10 : 28, T.PED_RADIUS, tmp, 4)) return false;
    const h = 2 * tmp.e + (Math.random() < 0.5 ? 1 : 0), side = Math.random() < 0.5 ? 1 : -1;
    const s = h & 1 ? hLen[h] - tmp.s : tmp.s;
    const jit = p ? p.jit : 0;
    const x = G.pointX(h, s, side * (hWalk[h] + jit)), z = G.pointZ(h, s, side * (hWalk[h] + jit));
    const d2 = (x - fx) * (x - fx) + (z - fz) * (z - fz);
    if (d2 < 100) return false;
    if (!burst && d2 < 75 * 75 && T.inView(x, z)) return false;
    if (ctx.collision && ctx.collision.test(x, z, 0.4, 1)) return false;
    if (!p) p = newPed();
    if (!p) return false;
    activate(p, x, z);
    p.idle = false; p.h = h; p.side = side;
    choose(p);
    if (s < hLen[h] - p.tEnd - 0.5) goEnd(p); else advance(p);
    p.cur = p.speed;
    p.yaw = G.yawOf(hUx[h], hUz[h]);
    walkAnim(p);
    place(p);
    return true;
  }
  function place(p) {
    const k = p.tilt / 1.45;
    p.y = (ctx.heightAt ? ctx.heightAt(p.x, p.z) : 0) + p.yOff * (1 - k) + p.hy + 0.2 * k;
    p.group.position.set(p.x, p.y, p.z);
    p.group.rotation.y = p.yaw;
    if (p.tilt > 0.002 || p.tiltTarget > 0) p.group.rotation.x = p.tilt;
  }

  // ---------------------------------------------------------------- boucle
  function step(p, dt) {
    if (p.hitCd > 0) p.hitCd -= dt;
    p.scanT -= dt;
    const full = p.scanT <= 0;
    if (full) p.scanT = p.dodgeT > 0 ? 0 : 0.12;
    vehicles(p, dt, full);
    if (p.crossCd > 0) p.crossCd -= dt;
    let mx = 0, mz = 0, moving = false, resolve = false;

    if (p.mode === 1) {
      // projeté : vol balistique, glissade, puis allongé
      if (p.hy > 0 || p.vy > 0) { p.vy -= GRAV * dt; p.hy += p.vy * dt; if (p.hy <= 0) { p.hy = 0; p.vy = 0; } }
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0.08) {
        p.x += p.vx * dt; p.z += p.vz * dt; resolve = true;
        if (p.hy <= 0) { const k = Math.max(0, sp - SLIDE * dt) / sp; p.vx *= k; p.vz *= k; }
      } else {
        p.vx = p.vz = 0;
        if (p.hy <= 0) {
          p.downT -= dt;
          if (p.downT <= 0) { p.mode = 2; p.getT = 1.6; p.tiltTarget = 0; setAnim(p, 'getup', 0, 'idle'); }
        }
      }
    } else if (p.mode === 2) {
      p.getT -= dt;
      if (p.getT <= 0) startFlee(p, p.srcX, p.srcZ, p.hurt ? 9 : 5 + Math.random() * 3, p.hurt);
    } else if (p.mode === 3) {
      mx = p.fdx; mz = p.fdz; moving = true; resolve = true;
      p.x += mx * p.cur * dt; p.z += mz * p.cur * dt;
      p.fleeT -= dt;
      if (p.fleeT <= 0) resnap(p);
    } else if (p.mode === 5) {
      // éjecté de sa voiture : il titube, puis proteste sur place (tourné vers la voiture) ou s'enfuit
      p.getT -= dt;
      if (p.getT <= 0) {
        if (Math.random() < 0.5) { p.mode = 4; p.watchT = 3 + Math.random() * 4; p.wx = p.srcX; p.wz = p.srcZ; setAnim(p, 'idle', 0); }
        else { p.needSnap = false; startFlee(p, p.srcX, p.srcZ, 4 + Math.random() * 3, false); }
      }
    } else if (p.mode === 4) {
      // badaud : tourné vers l'accident
      mx = p.wx - p.x; mz = p.wz - p.z; moving = true;
      p.watchT -= dt;
      if (p.watchT <= 0) { if (p.needSnap) { p.needSnap = false; resnap(p); } else { p.mode = 0; if (p.idle || p.stage === 2) setAnim(p, 'idle', 0); else walkAnim(p); } }
    } else if (p.dodgeT > 0) {
      p.dodgeT -= dt;
      mx = p.ddx; mz = p.ddz; moving = true; resolve = true;
      p.x += mx * 4.6 * dt; p.z += mz * 4.6 * dt;
      if (p.anim !== 'stumble' || p.dodgeT < 0.5) setAnim(p, 'run', 4.6);
      if (p.dodgeT <= 0) { if (p.idle || p.stage === 2) setAnim(p, 'idle', 0); else walkAnim(p); }
    } else if (p.idle) {
      /* immobile */
    } else if (p.stage === 2) {
      // attend au bord du trottoir que la voie soit libre
      setAnim(p, 'idle', 0);
      p.waitT -= dt; p.waited += dt;
      if (p.waited > 7) { p.cur = p.speed; walkAnim(p); advance(p); }
      else if (p.waitT <= 0 && !p.carNear) {
        const s = hLen[p.h] - p.tEnd;
        p.side = -p.side; p.stage = 3; p.onRoad = true;
        p.tx = sx(p.h, s, p); p.tz = sz(p.h, s, p);
        p.cur = Math.max(p.speed, 1.7);
        walkAnim(p);
      }
    } else {
      const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz), st = p.cur * dt;
      if (d <= st + 0.15) arrive(p);
      else { mx = dx / d; mz = dz / d; p.x += mx * st; p.z += mz * st; moving = true; }
    }
    if (moving) {
      // rotation douce vers la direction de marche (ou vers ce que l'on regarde)
      let da = Math.atan2(-mx, -mz) - p.yaw;
      da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
      p.yaw += da * Math.min(1, dt * 9);
    }
    if (p.tilt !== p.tiltTarget) { // repli sans character.knock : bascule du groupe
      p.tilt += (p.tiltTarget - p.tilt) * Math.min(1, dt * (p.tiltTarget > 0 ? 9 : 3));
      if (Math.abs(p.tilt - p.tiltTarget) < 0.01) { p.tilt = p.tiltTarget; if (p.tilt === 0) p.group.rotation.x = 0; }
    }
    // obstacles statiques (murs, mobilier) : on glisse ; si on piétine, demi-tour
    p.colT -= dt;
    if (ctx.collision && (p.colT <= 0 || resolve)) {
      const slow = p.colT <= 0;
      if (slow) p.colT = 0.25;
      const r = ctx.collision.resolveCircle(p.x, p.z, 0.35, p.y + 1);
      if (r.hit) {
        p.x = r.x; p.z = r.z;
        if (p.mode === 1) { p.vx *= 0.3; p.vz *= 0.3; }
        else if (p.mode === 3) { // mur : on longe
          const t = p.fdx * -r.nz + p.fdz * r.nx, s = t >= 0 ? 1 : -1;
          p.fdx = -r.nz * s; p.fdz = r.nx * s;
        } else if (slow && !p.idle && p.dodgeT <= 0 && p.stage < 2 && p.mode === 0) {
          p.stallT += 0.25;
          if (p.stallT > 2) { p.stallT = 0; p.stalls++; turnBack(p); }
        }
      } else if (slow && p.stallT > 0) p.stallT -= 0.125;
      if (slow) {
        const w = ctx.world;
        if (w) {
          // surélévation du trottoir, objets tombés à contourner (extras facultatifs du module ville)
          if (w.surfaceHeightAt && ctx.heightAt) p.yOff = Math.max(0, Math.min(0.3, w.surfaceHeightAt(p.x, p.z) - ctx.heightAt(p.x, p.z)));
          if (w.propsNear && p.mode !== 1) {
            const near = w.propsNear(p.x, p.z, 1.6);
            if (near && near.length) for (let i = 0; i < near.length; i++) {
              const o = near[i]; if (!o || !isFinite(o.x) || !isFinite(o.z)) continue;
              const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = (o.r || 0.5) + 0.4;
              if (d < min && d > 1e-3) { p.x += (dx / d) * (min - d); p.z += (dz / d) * (min - d); }
            }
          }
        }
      }
    }
    place(p);
  }

  function update(dt, burst) {
    frame++;
    gatherVehicles();
    const fx = T.fx, fz = T.fz, D2 = (T.PED_RADIUS + 20) * (T.PED_RADIUS + 20);
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p.active) continue;
      step(p, dt);
      const dx = p.x - fx, dz = p.z - fz, d2 = dx * dx + dz * dz;
      // un piéton renversé n'est jamais recyclé tant qu'il est dans le champ
      const busy = p.mode === 1 || p.mode === 2;
      if ((d2 > D2 || p.stalls >= 3) && !T.inView(p.x, p.z) || (d2 > D2 && !busy)) { deactivate(p); continue; }
      // animation : chaque frame de près ou en pleine chute, 1 frame sur 3 de loin
      if (d2 < 60 * 60 || busy) p.ch.update(dt);
      else { p.animAcc += dt; if ((frame + i) % 3 === 0) { p.ch.update(p.animAcc); p.animAcc = 0; } }
    }
    const want = Math.min(target, T.MAX_PEDS);
    for (let n = burst ? 3 : 1; n > 0 && activeCount < want; n--) {
      let spare = null;
      for (let i = 0; i < peds.length; i++) if (!peds[i].active) { spare = peds[i]; break; }
      trySpawn(spare, burst);
    }
    if (peds.length > want + 6) { // réserve trop grande (conducteurs éjectés) : on libère un personnage inactif
      for (let i = peds.length - 1; i >= 0; i--) if (!peds[i].active) { const q = peds[i]; q.group.removeFromParent(); if (q.ch.dispose) q.ch.dispose(); peds.splice(i, 1); break; }
      for (let i = 0; i < peds.length; i++) peds[i].idx = i;
    }
    if (activeCount > want) {
      for (let i = peds.length - 1; i >= 0; i--) {
        const p = peds[i];
        if (p.active && p.mode === 0 && !T.inView(p.x, p.z)) { deactivate(p); break; }
      }
    }
  }

  return {
    update, list: peds, alarm,
    setTarget(n) { target = n; },
    get activeCount() { return activeCount; },
    dispose() { for (const p of peds) { p.group.removeFromParent(); p.ch.dispose && p.ch.dispose(); } peds.length = 0; activeCount = 0; },
  };
}

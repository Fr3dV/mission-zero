// Trafic — piétons : ils longent les trottoirs (décalés de road.width/2 + 1,5 m de l'axe), tournent aux
// coins en restant sur leur trottoir, font parfois demi-tour ou traversent, et esquivent les voitures.
// Quelques-uns restent immobiles (idle) près des monuments.
import { createCharacter } from '../player/index.js';

const CLOTHES = ['#2b3a55', '#6b1f2a', '#30475e', '#3d5a45', '#8a6d3b', '#1f1f24', '#7a7f8a', '#b04a3a', '#3f6a8a', '#d9d2c5', '#5b4a6e', '#c9a227', '#2f4f4f', '#a8324a'];
const SKINS = ['#f1c9a5', '#e0ac7e', '#c68d5e', '#9a6a44', '#6e4a2f', '#f6d7bd'];
const pick = (a) => a[(Math.random() * a.length) | 0];

export function createPedestrians(T) {
  const { ctx, G } = T;
  const { hTo, hUx, hUz, hLen, hDrive, hWalk, hWidth, outStart, outList, nodeJunction } = G;
  const peds = [];
  T.peds = peds;
  const tmp = { e: 0, s: 0, x: 0, z: 0 };
  let target = 0, activeCount = 0, frame = 0;

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
    if (p.stage === 0) { goEnd(p); return; }
    if (p.stage === 3) { p.onRoad = false; p.cur = p.speed; choose(p); advance(p); return; }
    // bout d'arête : parfois on traverse la rue
    const h = p.h;
    if (p.crossCd <= 0 && Math.random() < 0.1 && (hDrive[h] || hDrive[h ^ 1]) && hWidth[h] < 24) {
      p.stage = 2; p.waitT = 0.4 + Math.random() * 1.5; p.waited = 0; p.crossCd = 25;
      return;
    }
    advance(p);
  }
  function setAnim(p, anim, speed) {
    if (p.anim === anim && Math.abs(p.animSpeed - speed) < 0.05) return;
    p.anim = anim; p.animSpeed = speed;
    p.ch.setState({ anim, speed });
  }
  function turnBack(p) { p.h ^= 1; p.side = -p.side; choose(p); goEnd(p); }

  // ---------------------------------------------------------------- voitures : esquive
  function scanVehicles(p) {
    const list = ctx.vehicles && ctx.vehicles.list;
    p.carNear = false;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
      if (dx > 32 || dx < -32 || dz > 32 || dz < -32) continue;
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = -fz, rz = fx;
      const f = dx * fx + dz * fz, l = dx * rx + dz * rz, al = Math.abs(l);
      const spec = v.spec, hl = spec ? spec.length * 0.5 : 2.2, hw = spec ? spec.width * 0.5 : 0.95;
      const sp = v.speed || 0, asp = Math.abs(sp);
      // jamais sous une voiture : on est repoussé sur le côté
      if (Math.abs(f) < hl + 0.4 && al < hw + 0.45) {
        const sign = l >= 0 ? 1 : -1, shift = hw + 0.5 - al;
        p.x += rx * sign * shift; p.z += rz * sign * shift;
      }
      if (asp > 1) {
        if (dx * dx + dz * dz < 22 * 22) p.carNear = true;
        const own = T.owner.get(v), isAI = own && !own.parked;
        const ahead = isAI ? 2 + asp * 0.35 : 3 + asp * 1.3; // les IA freinent d'elles-mêmes ; on fuit surtout les joueurs
        const ff = sp > 0 ? f : -f;
        if (ff > -1 && ff < hl + ahead && al < hw + 0.9) {
          const sign = al < 0.15 ? (Math.random() < 0.5 ? 1 : -1) : (l >= 0 ? 1 : -1);
          p.ddx = rx * sign; p.ddz = rz * sign; p.dodgeT = 0.7;
        }
      }
    }
  }

  // ---------------------------------------------------------------- pool
  function newPed() {
    const ch = createCharacter(ctx, { color: pick(CLOTHES), skin: pick(SKINS) });
    if (!ch || !ch.group) return null;
    ctx.scene.add(ch.group);
    const jog = Math.random() < 0.06;
    const p = {
      ch, group: ch.group, active: false, idle: false, x: 0, y: 0, z: 0, yaw: 0, h: 0, side: 1, nextH: 0, nextSide: 1, nextT: 0, tEnd: 0,
      stage: 1, tx: 0, tz: 0, speed: jog ? 3 + Math.random() : 1.05 + Math.random() * 0.8, jog, cur: 0, anim: '', animSpeed: -1,
      jit: Math.random() * 1.3 - 0.5, onRoad: false, dodgeT: 0, ddx: 0, ddz: 0, waitT: 0, waited: 0, crossCd: 0, carNear: false,
      scanT: Math.random() * 0.12, colT: Math.random() * 0.25, stallT: 0, stalls: 0, animAcc: 0, idx: peds.length,
    };
    peds.push(p);
    return p;
  }
  function activate(p, x, z) {
    p.x = x; p.z = z; p.active = true; activeCount++;
    p.onRoad = false; p.dodgeT = 0; p.stallT = 0; p.stalls = 0; p.crossCd = 5 + Math.random() * 20;
    p.group.visible = true;
  }
  function deactivate(p) {
    if (!p.active) return;
    p.active = false; activeCount--; p.onRoad = false;
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
    setAnim(p, p.jog ? 'run' : 'walk', p.speed);
    place(p);
    return true;
  }
  function place(p) {
    p.y = ctx.heightAt ? ctx.heightAt(p.x, p.z) : 0;
    p.group.position.set(p.x, p.y, p.z);
    p.group.rotation.y = p.yaw;
  }

  // ---------------------------------------------------------------- boucle
  function step(p, dt) {
    p.scanT -= dt;
    if (p.scanT <= 0) { p.scanT = p.dodgeT > 0 ? 0 : 0.12; scanVehicles(p); }
    if (p.crossCd > 0) p.crossCd -= dt;
    let mx = 0, mz = 0, moving = false;
    if (p.dodgeT > 0) {
      p.dodgeT -= dt;
      mx = p.ddx; mz = p.ddz; moving = true;
      p.x += mx * 4.6 * dt; p.z += mz * 4.6 * dt;
      setAnim(p, 'run', 4.6);
      if (p.dodgeT <= 0 && !p.idle && p.stage !== 2) setAnim(p, p.jog ? 'run' : 'walk', p.cur || p.speed);
      if (p.dodgeT <= 0 && (p.idle || p.stage === 2)) setAnim(p, 'idle', 0);
    } else if (p.idle) {
      /* immobile */
    } else if (p.stage === 2) {
      // attend au bord du trottoir que la voie soit libre
      setAnim(p, 'idle', 0);
      p.waitT -= dt; p.waited += dt;
      if (p.waited > 7) { setAnim(p, p.jog ? 'run' : 'walk', p.speed); advance(p); }
      else if (p.waitT <= 0 && !p.carNear) {
        const s = hLen[p.h] - p.tEnd;
        p.side = -p.side; p.stage = 3; p.onRoad = true;
        p.tx = sx(p.h, s, p); p.tz = sz(p.h, s, p);
        p.cur = Math.max(p.speed, 1.7);
        setAnim(p, p.jog ? 'run' : 'walk', p.cur);
      }
    } else {
      const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz), st = p.cur * dt;
      if (d <= st + 0.15) arrive(p);
      else { mx = dx / d; mz = dz / d; p.x += mx * st; p.z += mz * st; moving = true; }
    }
    if (moving) {
      // rotation douce vers la direction de marche
      let da = Math.atan2(-mx, -mz) - p.yaw;
      da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
      p.yaw += da * Math.min(1, dt * 9);
    }
    // obstacles statiques (murs, mobilier) : on glisse ; si on piétine, demi-tour
    p.colT -= dt;
    if (ctx.collision && (p.colT <= 0 || p.dodgeT > 0)) {
      p.colT = 0.25;
      const r = ctx.collision.resolveCircle(p.x, p.z, 0.35, p.y + 1);
      if (r.hit) {
        p.x = r.x; p.z = r.z;
        if (!p.idle && p.dodgeT <= 0 && p.stage < 2) {
          p.stallT += 0.25;
          if (p.stallT > 2) { p.stallT = 0; p.stalls++; turnBack(p); }
        }
      } else if (p.stallT > 0) p.stallT -= 0.125;
    }
    place(p);
  }

  function update(dt, burst) {
    frame++;
    const fx = T.fx, fz = T.fz, D2 = (T.PED_RADIUS + 20) * (T.PED_RADIUS + 20);
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p.active) continue;
      step(p, dt);
      const dx = p.x - fx, dz = p.z - fz, d2 = dx * dx + dz * dz;
      if (d2 > D2 || (p.stalls >= 3 && !T.inView(p.x, p.z))) { deactivate(p); continue; }
      // animation : chaque frame de près, 1 frame sur 3 de loin
      if (d2 < 60 * 60) p.ch.update(dt);
      else { p.animAcc += dt; if ((frame + i) % 3 === 0) { p.ch.update(p.animAcc); p.animAcc = 0; } }
    }
    const want = Math.min(target, T.MAX_PEDS);
    for (let n = burst ? 3 : 1; n > 0 && activeCount < want; n--) {
      let spare = null;
      for (let i = 0; i < peds.length; i++) if (!peds[i].active) { spare = peds[i]; break; }
      trySpawn(spare, burst);
    }
    if (activeCount > want) {
      for (let i = peds.length - 1; i >= 0; i--) {
        const p = peds[i];
        if (p.active && !T.inView(p.x, p.z)) { deactivate(p); break; }
      }
    }
  }

  return {
    update, list: peds,
    setTarget(n) { target = n; },
    get activeCount() { return activeCount; },
    dispose() { for (const p of peds) { p.group.removeFromParent(); p.ch.dispose && p.ch.dispose(); } peds.length = 0; activeCount = 0; },
  };
}

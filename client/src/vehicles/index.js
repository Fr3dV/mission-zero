// Module « véhicules » : modèles procéduraux, physique arcade, collisions, effets.
// Contrat : voir docs/ARCHITECTURE.md (ctx.vehicles / vehicle).
import { VEHICLE_BY_ID } from '@shared/catalog.js';
import { createMesh, getCarGeometry } from './models.js';
import { initPhysics, stepVehicle, collideVehicles } from './physics.js';
import { createEffects } from './effects.js';
import { updateEnvFallback, setFallbackEnvIntensity } from './materials.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapPi = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

export function createVehicles(ctx) {
  const { scene, bus, heightAt, camera } = ctx;
  const list = [];
  let nextId = 1;
  const fx = createEffects(ctx);
  let night = !!ctx.env?.isNight?.();
  bus.on('env:time', (e) => { night = !!e?.night; });
  const LOD_DIST = ctx.quality === 'low' ? 18 : ctx.quality === 'medium' ? 30 : 42;
  const FX_DIST = 140;

  const isDynamic = (v) => !v.remote && !(v.phys.kinT > ctx.time);

  function spawn(typeId, x, z, yaw = 0, opts = {}) {
    const spec = VEHICLE_BY_ID[typeId] || VEHICLE_BY_ID.citadine;
    const color = opts.color || spec.colors[0];
    const geo = getCarGeometry(spec.id);
    const group = createMesh(spec.id, color);
    group.rotation.order = 'YXZ';
    const cab = geo.def.cabin;
    const v = {
      id: opts.id || 'v' + nextId++, typeId: spec.id, spec, color, group,
      pos: { x, y: heightAt(x, z), z }, yaw, speed: 0,
      driver: null, remote: !!opts.remote,
      controls: { throttle: 0, brake: 0, steer: 0, handbrake: false },
      // champs étendus (audio, HUD, gameplay) : rpm 0..1, gear (-1 = R, 0 = N, 1..n), slip 0..1, damage 0..1
      rpm: 0, gear: 0, slip: 0, damage: 0,
      seat: { ...geo.info.seat },   // {x, y (hauteur du bassin), z} dans le repère du véhicule
      setControls(c) { if (c) Object.assign(v.controls, c); },
      setTransform(nx, nz, nyaw, speed = 0) { setTransform(v, nx, nz, nyaw, speed); },
      update(dt) { simulate(v, dt); },
    };
    initPhysics(v, geo.info, geo.def);
    v.vis = {
      info: geo.info, roll: 0, rollV: 0, pitch: 0, pitchV: 0, heave: 0, tPitch: 0, tRoll: 0, placed: false,
      lightKey: -1, hazardT: 0, lastSpeed: 0, accel: 0, lod: false, net: null, lastSetT: -1, setDt: 1,
      wheelPrev: [null, null, null, null], smokeAcc: 0, dist: 0, yawRateVis: 0, lastYaw: yaw,
    };
    place(v, 0, true);
    scene.add(group);
    list.push(v);
    return v;
  }

  function setTransform(v, x, z, yaw, speed) {
    if (!Number.isFinite(x + z + yaw)) return;
    const s = v.vis, p = v.phys;
    speed = Number.isFinite(speed) ? speed : 0;
    if (v.remote) {
      const gap = ctx.time - s.lastSetT;
      s.setDt = gap; s.lastSetT = ctx.time;
      const far = Math.hypot(x - v.pos.x, z - v.pos.z) > 12;
      // appelé à chaque frame (trafic, interpolation réseau déjà faite) : pose directe ; sinon lissage visuel
      if (gap < 0.04 || far || !s.net) { v.pos.x = x; v.pos.z = z; v.yaw = yaw; s.net = s.net || { x, z, yaw }; s.net.x = x; s.net.z = z; s.net.yaw = yaw; s.net.direct = true; }
      else { s.net.x = x; s.net.z = z; s.net.yaw = yaw; s.net.direct = false; }
      v.speed = speed;
    } else {
      // téléportation d'un véhicule local (réapparition, garage, mission…)
      v.pos.x = x; v.pos.z = z; v.yaw = yaw; v.speed = speed;
      v.yawRate = 0; p.steerN = 0; p.ax = p.ay = 0; p.sleeping = false;
      if (v.driver && v.driver !== 'local') p.kinT = ctx.time + 0.25; // piloté de l'extérieur : cinématique
      s.wheelPrev.fill(null);
    }
    v.vel.x = -Math.sin(v.yaw) * speed; v.vel.z = -Math.cos(v.yaw) * speed;
    s.placed = false;
  }

  function crash(v, impact, other) {
    const p = v.phys;
    if (impact < 2.2 || p.crashT > 0) return;
    p.crashT = 0.22;
    v.damage = clamp(v.damage + Math.min(0.3, impact * impact * 0.0005), 0, 1);
    v.vis.pitchV += clamp(impact * 0.03, 0, 0.6); v.vis.rollV += (Math.random() - 0.5) * clamp(impact * 0.05, 0, 0.8);
    if (impact > 9) v.vis.hazardT = 6;
    bus.emit('vehicle:crash', { vehicle: v, impact, other: other || null });
  }

  function simulate(v, dt) {
    const p = v.phys, s = v.vis;
    if (p.crashT > 0) p.crashT -= dt;
    if (v.remote) {
      const n = s.net;
      if (n && !n.direct) {
        // extrapolation de la cible + rattrapage exponentiel
        n.x += -Math.sin(n.yaw) * v.speed * dt; n.z += -Math.cos(n.yaw) * v.speed * dt;
        const k = 1 - Math.exp(-12 * dt);
        v.pos.x += (n.x - v.pos.x) * k; v.pos.z += (n.z - v.pos.z) * k; v.yaw += wrapPi(n.yaw - v.yaw) * k;
      }
      v.vel.x = -Math.sin(v.yaw) * v.speed; v.vel.z = -Math.cos(v.yaw) * v.speed;
      v.yawRate = 0; p.sleeping = false;
      v.rpm = clamp(Math.abs(v.speed) / v.spec.maxSpeed, 0, 1); v.gear = v.speed < -0.3 ? -1 : 1;
      return;
    }
    if (p.kinT > ctx.time) return;
    const wasSleeping = p.sleeping;
    const impact = stepVehicle(v, dt, ctx);
    if (impact > 0) crash(v, impact, null);
    if (!p.sleeping || !wasSleeping) s.placed = false;
  }

  /** Pose le véhicule sur le terrain (hauteur, tangage et roulis de pente) et synchronise le groupe. */
  function place(v, dt, force) {
    const s = v.vis, g = v.group;
    if (s.placed && !force) return;
    const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    const h0 = heightAt(v.pos.x, v.pos.z);
    if (h0 > 0.005) {
      const hl = s.info.wheelbase * 0.5, ht = s.info.track * 0.5;
      // avant = (-sy, -cy), droite = (cy, -sy)
      const hF = heightAt(v.pos.x - sy * hl, v.pos.z - cy * hl), hR = heightAt(v.pos.x + sy * hl, v.pos.z + cy * hl);
      const hD = heightAt(v.pos.x + cy * ht, v.pos.z - sy * ht), hG = heightAt(v.pos.x - cy * ht, v.pos.z + sy * ht);
      v.pos.y = (hF + hR + hD + hG) / 4;
      s.tPitch = Math.atan2(hF - hR, hl * 2); s.tRoll = Math.atan2(hD - hG, ht * 2);
    } else { v.pos.y = h0; s.tPitch = 0; s.tRoll = 0; }
    g.position.set(v.pos.x, v.pos.y, v.pos.z);
    g.rotation.set(s.tPitch, v.yaw, s.tRoll);
    s.placed = v.phys.sleeping && !v.remote;
  }

  function visual(v, dt, camX, camZ, localV) {
    const s = v.vis, p = v.phys, g = v.group, ud = g.userData;
    place(v, dt, false);
    const dx = v.pos.x - camX, dz = v.pos.z - camZ, dist = Math.hypot(dx, dz);
    s.dist = dist;
    const lod = dist > LOD_DIST * (s.lod ? 0.92 : 1);
    if (lod !== s.lod) { s.lod = lod; ud.setLOD(lod); }
    const dyn = isDynamic(v);
    const moving = dyn ? !p.sleeping : Math.abs(v.speed) > 0.05;
    const hasDriver = v.driver != null;

    // accélérations pour le transfert de masse
    let ax, ay, steer;
    if (dyn) { ax = p.ax; ay = p.ay; steer = v.steerAngle; }
    else {
      const a = dt > 0 ? (v.speed - s.lastSpeed) / dt : 0;
      s.accel += (clamp(a, -12, 12) - s.accel) * Math.min(1, dt * 6);
      const yr = dt > 0 ? wrapPi(v.yaw - s.lastYaw) / dt : 0;
      s.yawRateVis += (clamp(yr, -3, 3) - s.yawRateVis) * Math.min(1, dt * 8);
      ax = s.accel; ay = -s.yawRateVis * v.speed;
      steer = clamp(Math.atan((-s.yawRateVis * s.info.wheelbase) / Math.max(Math.abs(v.speed), 2.5)) * Math.sign(v.speed || 1), -0.6, 0.6);
    }
    s.lastSpeed = v.speed; s.lastYaw = v.yaw;

    if (!lod) {
      // caisse : roulis / tangage en ressort amorti (prise de roulis en virage, cabrage, plongée au freinage)
      const hk = 0.75 + (v.spec.height - 1.1) * 0.9;
      const tR = clamp(ay * 0.0052 * hk, -0.09, 0.09), tP = clamp(ax * 0.0038 * hk, -0.06, 0.06);
      const w0 = 9.5 - hk * 2, zeta = 0.42;
      const sub = dt > 0.02 ? 2 : 1, h = dt / sub;
      for (let i = 0; i < sub; i++) {
        s.rollV += (w0 * w0 * (tR - s.roll) - 2 * zeta * w0 * s.rollV) * h; s.roll += s.rollV * h;
        s.pitchV += (w0 * w0 * (tP - s.pitch) - 2 * zeta * w0 * s.pitchV) * h; s.pitch += s.pitchV * h;
      }
      s.roll = clamp(s.roll, -0.14, 0.14); s.pitch = clamp(s.pitch, -0.1, 0.1);
      ud.chassis.rotation.set(s.pitch, 0, s.roll);
      ud.chassis.position.y = -Math.abs(s.roll) * 0.12 - Math.abs(s.pitch) * 0.1;
      if (moving || Math.abs(steer - (s.steerVis || 0)) > 1e-3) {
        s.steerVis = steer; ud.setSteer(steer);
        const d = v.speed * dt;
        if (dyn && (p.lock || p.spin > 0)) {
          for (const w of ud.wheels) {
            const u = w.userData, driven = u.front ? p.rear < 1 : p.rear > 0;
            let da = !u.front && p.lock ? 0 : d / u.R;
            if (p.spin > 0 && driven) da += p.spin * 30 * dt * (p.rev ? -1 : 1);
            u.spin += da; w.rotation.x = -u.side * u.spin;
          }
        } else ud.spinWheels(d);
      }
    } else if (s.roll || s.pitch) { s.roll = s.pitch = s.rollV = s.pitchV = 0; ud.chassis.rotation.set(0, 0, 0); ud.chassis.position.y = 0; }

    // feux
    if (s.hazardT > 0) s.hazardT -= dt;
    const blinkOn = (ctx.time * 1.6) % 1 < 0.5;
    const cb = v.controls.blinker;
    const hazard = s.hazardT > 0 || cb === 'hazard';
    const bl = (hazard || cb === 'left') && blinkOn, br = (hazard || cb === 'right') && blinkOn;
    const head = night && hasDriver;
    const braking = hasDriver && (dyn ? p.brakeOn || (p.lock && Math.abs(v.speed) > 0.5) : s.accel < -1.2 || (Math.abs(v.speed) < 0.3 && v.driver === 'ai'));
    const reverse = hasDriver && (dyn ? v.gear === -1 : v.speed < -0.3);
    const key = (head ? 1 : 0) | (braking ? 2 : 0) | (reverse ? 4 : 0) | (bl ? 8 : 0) | (br ? 16 : 0) | (hasDriver ? 32 : 0) | (night ? 64 : 0);
    if (key !== s.lightKey) {
      s.lightKey = key;
      ud.setLights({ head: head ? 1 : 0, drl: hasDriver ? 1 : 0, brake: braking ? 1 : 0, reverse: reverse ? 1 : 0, blinkL: bl ? 1 : 0, blinkR: br ? 1 : 0, sign: v.typeId === 'taxi' ? (night ? 1 : 0.25) : 0 });
    }

    if (dist > FX_DIST) return;
    fx.addShadow(v.pos.x, v.pos.y, v.pos.z, v.yaw, s.tPitch, s.tRoll, v.spec.width * 1.22, v.spec.length * 1.12);
    if (head && v !== localV) fx.addBeam(v.pos.x, v.pos.y, v.pos.z, v.yaw, s.tPitch, v.spec.width);

    // fumée et traces de pneus
    if (dyn && !p.sleeping && dist < 90) {
      const sp = Math.abs(v.speed) + (p.slide || 0);
      const slip = v.slip;
      const on = slip > 0.3 && (sp > 2.5 || p.spin > 0);
      const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
      const wheels = ud.wheels;
      for (let i = 0; i < 4; i++) {
        const u = wheels[i].userData;
        // roues concernées : arrière au frein à main / dérive, motrices au patinage, toutes en glissade franche
        const active = on && (!u.front ? true : (p.spin > 0 && p.rear < 1) || p.slipF > 0.2 || (p.brakeOn && slip > 0.2 && !p.lock));
        if (!active) { s.wheelPrev[i] = null; continue; }
        const wx = v.pos.x + u.x * cy + u.z * sy, wz = v.pos.z - u.x * sy + u.z * cy, wy = v.pos.y;
        const prev = s.wheelPrev[i];
        const a = clamp((slip - 0.3) * 1.3, 0, 0.75);
        if (prev) fx.skid(prev.x, prev.y, prev.z, wx, wy, wz, v.spec.width * 0.13, prev.a, a);
        s.wheelPrev[i] = prev ? (prev.x = wx, prev.y = wy, prev.z = wz, prev.a = a, prev) : { x: wx, y: wy, z: wz, a };
        if (!u.front || p.slipF > 0.25) {
          s.smokeAcc += dt * (8 + 26 * slip);
          while (s.smokeAcc >= 1) {
            s.smokeAcc -= 1;
            fx.smoke(wx + (Math.random() - 0.5) * 0.3, wy + 0.12, wz + (Math.random() - 0.5) * 0.3,
              v.vel.x * 0.25 + (Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.9, v.vel.z * 0.25 + (Math.random() - 0.5) * 1.2,
              0.7 + Math.random() * 0.6, 1.1 + Math.random() * 1.0, 0.22 + 0.25 * slip, 0.82 + Math.random() * 0.12);
          }
        }
      }
    } else if (s.wheelPrev[2] || s.wheelPrev[3] || s.wheelPrev[0] || s.wheelPrev[1]) s.wheelPrev.fill(null);
    // fumée moteur si très endommagé
    if (v.damage > 0.55 && dist < 70 && Math.random() < dt * (4 + 10 * v.damage)) {
      const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), o = v.spec.length * 0.36;
      fx.smoke(v.pos.x - sy * o, v.pos.y + v.spec.height * 0.55, v.pos.z - cy * o, v.vel.x * 0.5, 1.2, v.vel.z * 0.5, 0.6, 1.6, 0.3 * v.damage, 0.25 + (1 - v.damage) * 0.5);
    }
  }

  function remove(v) {
    if (!v) return;
    const i = list.indexOf(v);
    if (i >= 0) list.splice(i, 1);
    // ne pas détruire un éventuel passager (personnage du joueur) : on le rend à la scène
    for (const c of [...v.group.children]) if (c !== v.group.userData.chassis && !v.group.userData.wheels.includes(c)) scene.add(c);
    v.group.userData.dispose();
  }

  function nearest(x, z, maxDist = 5, filter) {
    let best = null, bd = maxDist;
    for (const v of list) {
      if (!v.group.visible) continue;
      if (filter && !filter(v)) continue;
      // distance au flanc plutôt qu'au centre : on monte dans une voiture longue par n'importe quelle portière
      const d = Math.max(0, Math.hypot(v.pos.x - x, v.pos.z - z) - v.spec.length * 0.25);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  let envT = 0;
  function update(dt) {
    if ((envT -= dt) <= 0) { envT = 1; updateEnvFallback(ctx.renderer, scene); setFallbackEnvIntensity(night ? 0.12 : 1); }
    for (let i = 0; i < list.length; i++) { const v = list[i]; if (v.group.visible) simulate(v, dt); }
    collideVehicles(list, isDynamic, crash);
    fx.beginFrame();
    const camX = camera.position.x, camZ = camera.position.z;
    const pv = ctx.player?.vehicle;
    const localV = pv && pv.driver === 'local' ? pv : null;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (!v.group.visible) continue;
      // un choc voiture↔voiture a pu déplacer un véhicule endormi
      if (!v.phys.sleeping) v.vis.placed = false;
      if (isDynamic(v)) { v.speed = v.vel.x * -Math.sin(v.yaw) + v.vel.z * -Math.cos(v.yaw); }
      visual(v, dt, camX, camZ, localV);
    }
    fx.setSpot(localV, night && !!localV, localV?.vis.info);
    fx.update(dt, night);
  }

  return { list, spawn, remove, nearest, createMesh, update, isNight: () => night };
}

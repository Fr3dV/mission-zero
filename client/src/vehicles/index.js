// Module « véhicules » : modèles procéduraux, physique arcade, collisions, effets.
// Contrat : voir docs/ARCHITECTURE.md (ctx.vehicles / vehicle).
import { VEHICLE_BY_ID } from '@shared/catalog.js';
import { createMesh, getCarGeometry } from './models.js';
import { initPhysics, stepVehicle, collideVehicles, applyImpulse, resetVertical, SAFE_DROP_V } from './physics.js';
import { initDamage, applyDamage, repairDamage, disposeDamage, IMPACT_MIN } from './damage.js';
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
      // opts.y : hauteur du niveau voulu (tablier, trémie…) ; absent = niveau de la rue
      pos: { x, y: Number.isFinite(opts.y) ? (opts.remote ? opts.y : heightAt(x, z, opts.y)) : heightAt(x, z), z }, yaw, speed: 0,
      driver: null, remote: !!opts.remote,
      controls: { throttle: 0, brake: 0, steer: 0, handbrake: false },
      // champs étendus (audio, HUD, gameplay) : rpm 0..1, gear (-1 = R, 0 = N, 1..n), slip 0..1, damage 0..1
      rpm: 0, gear: 0, slip: 0, damage: 0,
      // dégâts (contrat v2) : mass (kg), damageZones {front, rear, left, right} 0..1, wrecked, scrape 0..1 (raclement en cours)
      mass: 1500, damageZones: null, wrecked: false, scrape: 0,
      /** Impulsion monde (N·s) ; point d'application monde optionnel → lacet. */
      applyImpulse(ix, iz, px, pz) { applyImpulse(v, ix, iz, px, pz); v.vis.placed = false; },
      /** Remet le véhicule à neuf. */
      repair() { repairDamage(v); v.vis.hazardT = 0; v.vis.lightKey = -1; v.scrape = 0; for (const w of v.group.userData.wheels) w.rotation.y = w.userData.baseY; },
      seat: { ...geo.info.seat },   // {x, y (hauteur du bassin), z} dans le repère du véhicule
      wheelPos: { ...geo.info.wheelPos }, // centre et rayon du volant {x, y, z, r}
      setControls(c) { if (c) Object.assign(v.controls, c); },
      /** y (optionnel) : hauteur de la chaussée au niveau voulu ; absent = on reste sur le niveau courant. */
      setTransform(nx, nz, nyaw, speed = 0, y) { setTransform(v, nx, nz, nyaw, speed, y); },
      update(dt) { simulate(v, dt); },
    };
    initPhysics(v, geo.info, geo.def);
    v.vis = {
      info: geo.info, roll: 0, rollV: 0, pitch: 0, pitchV: 0, heave: 0, tPitch: 0, tRoll: 0, placed: false,
      born: ctx.time || 0, lightKey: -1, hazardT: 0, lastSpeed: 0, accel: 0, lod: false, net: null, lastSetT: -1, setDt: 1,
      wheelPrev: [null, null, null, null], smokeAcc: 0, dist: 0, yawRateVis: 0, lastYaw: yaw,
      ry: 0, sim: false, yGiven: opts.remote && Number.isFinite(opts.y) ? opts.y : null, heave: 0, heaveV: 0,
    };
    initDamage(v);
    place(v, 0, true);
    scene.add(group);
    list.push(v);
    return v;
  }

  function setTransform(v, x, z, yaw, speed, y) {
    if (!Number.isFinite(x + z + yaw)) return;
    const s = v.vis, p = v.phys;
    speed = Number.isFinite(speed) ? speed : 0;
    const hasY = Number.isFinite(y);
    if (v.remote) {
      const gap = ctx.time - s.lastSetT;
      s.setDt = gap; s.lastSetT = ctx.time;
      const far = Math.hypot(x - v.pos.x, z - v.pos.z) > 12;
      // hauteur : celle fournie par l'appelant (trafic, réseau) ; sinon on reste sur le niveau courant
      // (heightAt avec le y précédent) ; après un grand saut de position, niveau de la rue
      s.yGiven = hasY ? y : null;
      const ny = hasY ? y : far ? heightAt(x, z) : heightAt(x, z, v.pos.y);
      // appelé à chaque frame (trafic, interpolation réseau déjà faite) : pose directe ; sinon lissage visuel
      if (gap < 0.04 || far || !s.net) { v.pos.x = x; v.pos.z = z; v.pos.y = ny; v.yaw = yaw; s.net = s.net || { x, z, yaw }; s.net.x = x; s.net.z = z; s.net.yaw = yaw; s.net.y = ny; s.net.direct = true; }
      else { s.net.x = x; s.net.z = z; s.net.yaw = yaw; s.net.y = hasY ? y : null; s.net.direct = false; }
      v.speed = speed;
    } else {
      // téléportation d'un véhicule local (réapparition, garage, mission…) : au niveau demandé, sinon au niveau de la rue
      v.pos.x = x; v.pos.z = z; v.yaw = yaw; v.speed = speed;
      v.pos.y = hasY ? heightAt(x, z, y) : heightAt(x, z);
      resetVertical(v);
      v.yawRate = 0; p.steerN = 0; p.ax = p.ay = 0; p.sleeping = false;
      if (v.driver && v.driver !== 'local') p.kinT = ctx.time + 0.25; // piloté de l'extérieur : cinématique
      s.wheelPrev.fill(null);
    }
    v.vel.x = -Math.sin(v.yaw) * speed; v.vel.z = -Math.cos(v.yaw) * speed;
    s.placed = false;
  }

  /**
   * Enregistre un choc : dégâts, effets, événements.
   * h = { impact (m/s), kind, tag, other, x, z (point de contact monde), nx, nz (normale poussant CE véhicule), broke, ix, iz }
   */
  function registerHit(v, h, dyn = true) {
    const p = v.phys, s = v.vis;
    if (!(h.impact >= 1.2)) return;
    if (p.crashT > 0 && h.impact < (p.crashI || 0) * 1.3) return; // rebonds du même choc
    p.crashT = 0.2; p.crashI = h.impact;
    // repère local : +x droite, +z arrière
    const c = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    const rx = h.x - v.pos.x, rz = h.z - v.pos.z;
    const lx = rx * c - rz * sn, lz = rx * sn + rz * c, ldx = h.nx * c - h.nz * sn, ldz = h.nx * sn + h.nz * c;
    const hw = v.spec.width * 0.5, hl = v.spec.length * 0.5;
    const res = applyDamage(v, { impact: h.impact, lx: clamp(lx, -hw, hw), lz: clamp(lz, -hl, hl), ldx, ldz, scale: h.kind === 'pedestrian' ? 0.25 : 1, soft: !!h.broke || h.kind === 'pedestrian' });
    if (h.impact > IMPACT_MIN) {
      s.pitchV += clamp(h.impact * 0.03, 0, 0.6); s.rollV += (Math.random() - 0.5) * clamp(h.impact * 0.05, 0, 0.8);
      if (s.dist < 120) {
        const y = v.pos.y + 0.5;
        if (res.debris) fx.spawnDebris(h.x, y, h.z, v.vel.x, v.vel.z, res.debris, h.kind === 'pedestrian' ? 0x222222 : v.color);
        if (res.glass) fx.spawnDebris(h.x, y + 0.2, h.z, v.vel.x, v.vel.z, 14, 0xcfe4ea);
        if (res.fell === 'bumper') fx.spawnDebris(h.x, y - 0.1, h.z, v.vel.x, v.vel.z, 1, v.color, [0.7, 0.09, 0.13]);
        if (res.fell === 'mirror') fx.spawnDebris(h.x, y + 0.4, h.z, v.vel.x, v.vel.z, 1, v.color, [0.11, 0.07, 0.06]);
        if (h.kind !== 'pedestrian' && h.impact > 4) fx.sparks(h.x, y, h.z, v.vel.x, v.vel.z, Math.min(14, Math.round(h.impact)));
        if (h.impact > 9) for (let k = 0; k < 6; k++) fx.smoke(h.x, y, h.z, (Math.random() - 0.5) * 3, 1 + Math.random(), (Math.random() - 0.5) * 3, 0.5, 1.2, 0.25, 0.75);
      }
      if (h.impact > 9) s.hazardT = Math.max(s.hazardT, 6);
    }
    if (v.wrecked) s.hazardT = 1e9;
    s.lightKey = -1;
    if (!dyn) {
      // véhicule distant / IA percuté : le trafic décide de le rendre dynamique ; l'impulsion reste en attente un court instant
      p.pending = { ix: h.ix || 0, iz: h.iz || 0, x: h.x, z: h.z, t: ctx.time };
      bus.emit('vehicle:hit', { vehicle: v, by: h.other || null, impact: h.impact, ix: h.ix || 0, iz: h.iz || 0, x: h.x, z: h.z });
      return;
    }
    if (h.impact < 2.2) return;
    bus.emit('vehicle:crash', { vehicle: v, impact: h.impact, kind: h.kind || 'static', tag: h.tag || '', other: h.other || null, x: h.x, z: h.z, nx: h.nx, nz: h.nz, broke: !!h.broke, wrecked: v.wrecked });
  }
  // choc voiture↔voiture (appelé pour chacun des deux véhicules)
  function crash(v, impact, other, c, sign, dyn) {
    // pas de faux choc à l'apparition : deux voitures créées au contact se séparent sans dégâts ni événement
    if (ctx.time - v.vis.born < 0.6 || (other && ctx.time - other.vis.born < 0.6)) return;
    registerHit(v, { impact, kind: 'vehicle', tag: 'vehicle', other, x: c.x, z: c.z, nx: c.nx * sign, nz: c.nz * sign, broke: false, ix: c.ix * sign, iz: c.iz * sign }, dyn);
  }

  function simulate(v, dt) {
    const p = v.phys, s = v.vis;
    if (p.crashT > 0) p.crashT -= dt;
    if (v.remote) {
      s.sim = false;
      const n = s.net;
      if (n && !n.direct) {
        // extrapolation de la cible + rattrapage exponentiel
        n.x += -Math.sin(n.yaw) * v.speed * dt; n.z += -Math.cos(n.yaw) * v.speed * dt;
        const k = 1 - Math.exp(-12 * dt);
        v.pos.x += (n.x - v.pos.x) * k; v.pos.z += (n.z - v.pos.z) * k; v.yaw += wrapPi(n.yaw - v.yaw) * k;
        if (n.y != null) { v.pos.y += (n.y - v.pos.y) * k; s.yGiven = v.pos.y; }
      }
      v.vel.x = -Math.sin(v.yaw) * v.speed; v.vel.z = -Math.cos(v.yaw) * v.speed;
      v.yawRate = 0; p.sleeping = false;
      v.rpm = clamp(Math.abs(v.speed) / v.spec.maxSpeed, 0, 1); v.gear = v.speed < -0.3 ? -1 : 1;
      return;
    }
    if (p.kinT > ctx.time) { s.sim = false; return; }
    // passage cinématique → dynamique (voiture IA rendue au joueur, réveil) : l'état vertical repart de la hauteur courante
    if (!s.sim) { s.yGiven = null; resetVertical(v); }
    // percuté alors qu'il était cinématique, puis rendu dynamique par le trafic : l'impulsion en attente s'applique
    if (p.pending) { const q = p.pending; p.pending = null; if (ctx.time - q.t < 0.6) applyImpulse(v, q.ix, q.iz, q.x, q.z); }
    const wasSleeping = p.sleeping;
    stepVehicle(v, dt, ctx);
    s.sim = !p.sleeping;
    v.scrape = p.scrape;
    if (p.hit) { const h = p.hit; p.hit = null; registerHit(v, h, true); }
    if (p.landV > 0) landing(v, p.landV);
    if (p.scrape > 0.3 && s.dist < 80 && Math.random() < dt * 30 * p.scrape) fx.sparks(p.scrapeX, v.pos.y + 0.4, p.scrapeZ, v.vel.x, v.vel.z, 2);
    if (!p.sleeping || !wasSleeping) s.placed = false;
  }

  /** Réception d'un saut ou d'une chute : suspension qui talonne, poussière ; dégâts au-delà d'une chute de 1,5 m. */
  function landing(v, vImp) {
    const s = v.vis;
    s.heaveV -= Math.min(vImp, 9) * 0.45; s.pitchV += clamp(vImp * 0.04, 0, 0.5);
    if (vImp > 2.2 && s.dist < 90) {
      const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
      for (const w of v.group.userData.wheels) {
        const u = w.userData, wx = v.pos.x + u.x * cy + u.z * sy, wz = v.pos.z - u.x * sy + u.z * cy;
        fx.smoke(wx, v.pos.y + 0.1, wz, v.vel.x * 0.2 + (Math.random() - 0.5) * 2, 0.4 + Math.random(), v.vel.z * 0.2 + (Math.random() - 0.5) * 2, 0.6, 0.9, Math.min(0.4, 0.08 * vImp), 0.7);
      }
    }
    if (vImp > SAFE_DROP_V) {
      const fxx = -Math.sin(v.yaw), fzz = -Math.cos(v.yaw), hl = v.spec.length * 0.45;
      registerHit(v, { impact: IMPACT_MIN + (vImp - SAFE_DROP_V) * 1.1, kind: 'static', tag: 'chute', other: null, x: v.pos.x + fxx * hl, z: v.pos.z + fzz * hl, nx: -fxx, nz: -fzz, broke: false }, true);
    }
  }

  /**
   * Pose de rendu : hauteur des roues et assiette (tangage, roulis) d'après la pente locale, échantillonnée sous les
   * essieux et les flancs AU NIVEAU COURANT du véhicule (tablier, rue ou trémie).
   */
  function place(v, dt, force) {
    const s = v.vis, g = v.group, p = v.phys;
    if (s.placed && !force) return;
    // La caméra de poursuite (module joueur) est mise à jour AVANT la physique et lit la pose de début de frame :
    // la voiture du joueur est dessinée à cette même pose (s.lag), sinon elle saute à l'écran quand la durée des frames varie.
    const L = s.lag, px = L ? L.x : v.pos.x, pz = L ? L.z : v.pos.z, yaw = L ? L.yaw : v.yaw;
    let py;
    if (s.sim) py = L ? L.y : v.pos.y;                       // hauteur calculée par la physique (niveaux, sauts, chutes)
    else {
      // véhicule posé, cinématique ou distant : hauteur fournie par setTransform, sinon surface de son niveau
      py = s.yGiven != null ? s.yGiven : heightAt(px, pz, v.pos.y);
      if (!Number.isFinite(py)) py = Number.isFinite(v.pos.y) ? v.pos.y : 0;
      v.pos.y = py; p.yb = py;
    }
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    let tP, tR, ry = py;
    if (s.sim && p.air) {
      // en l'air : le nez suit la trajectoire, le roulis est conservé
      tP = clamp(Math.atan2(p.vy, Math.max(6, Math.abs(v.speed))) * 0.7, -0.3, 0.3); tR = s.tRoll;
    } else {
      const hl = s.info.wheelbase * 0.5, ht = s.info.track * 0.5, lim = 0.3 + hl * 0.45;
      // avant = (-sy, -cy), droite = (cy, -sy) ; un échantillon tombé sur un autre niveau (bord de tablier) est écarté
      let hF = heightAt(px - sy * hl, pz - cy * hl, py), hR = heightAt(px + sy * hl, pz + cy * hl, py);
      if (Math.abs(hF - py) > lim) hF = py; if (Math.abs(hR - py) > lim) hR = py;
      tP = Math.atan2(hF - hR, hl * 2);
      ry = (hF + hR) * 0.5;                                  // la caisse repose sur ses deux essieux
      if (s.lod) tR = 0;
      else {
        let hD = heightAt(px + cy * ht, pz - sy * ht, py), hG = heightAt(px - cy * ht, pz + sy * ht, py);
        if (Math.abs(hD - py) > lim) hD = py; if (Math.abs(hG - py) > lim) hG = py;
        tR = Math.atan2(hD - hG, ht * 2);
      }
      if (s.sim && p.gap > 0) ry = py;                       // roues en détente : hauteur de la physique
    }
    // la suspension filtre les cassures de pente
    const k = dt > 0 && (s.sim || v.remote) ? Math.min(1, dt * 16) : 1;
    s.tPitch += (tP - s.tPitch) * k; s.tRoll += (tR - s.tRoll) * k;
    s.ry += (ry - py - s.ry) * k;
    g.position.set(px, py + s.ry, pz);
    g.rotation.set(s.tPitch, yaw, s.tRoll);
    s.placed = p.sleeping && !v.remote;
  }

  function visual(v, dt, camX, camZ, localV) {
    const s = v.vis, p = v.phys, g = v.group, ud = g.userData;
    place(v, dt, false);
    const dx = v.pos.x - camX, dz = v.pos.z - camZ, dist = Math.hypot(dx, dz);
    s.dist = dist;
    const lod = v !== localV && dist > LOD_DIST * (s.lod ? 0.9 : 1.05);   // hystérésis ; la voiture du joueur reste en HD
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
      // pompage : détente quand le sol se dérobe (sommet de bosse), talonnage à la réception
      const ext = s.sim ? Math.min(p.gap, 0.07) : 0, wh = 11;
      for (let i = 0; i < sub; i++) { s.heaveV += (wh * wh * (ext - s.heave) - 2 * 0.5 * wh * s.heaveV) * h; s.heave += s.heaveV * h; }
      s.heave = clamp(s.heave, -0.13, 0.09);
      s.roll = clamp(s.roll, -0.14, 0.14); s.pitch = clamp(s.pitch, -0.1, 0.1);
      ud.chassis.rotation.set(s.pitch, 0, s.roll);
      ud.chassis.position.y = -Math.abs(s.roll) * 0.12 - Math.abs(s.pitch) * 0.1 + s.heave;
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
    } else if (s.roll || s.pitch || s.heave) { s.roll = s.pitch = s.rollV = s.pitchV = s.heave = s.heaveV = 0; ud.chassis.rotation.set(0, 0, 0); ud.chassis.position.y = 0; }

    // feux
    if (s.hazardT > 0) s.hazardT -= dt;
    const blinkOn = (ctx.time * 1.6) % 1 < 0.5;
    const cb = v.controls.blinker;
    const hazard = s.hazardT > 0 || cb === 'hazard';
    const bl = (hazard || cb === 'left') && blinkOn, br = (hazard || cb === 'right') && blinkOn;
    const head = night && hasDriver && !v.wrecked;
    const braking = hasDriver && (dyn ? p.brakeOn || (p.lock && Math.abs(v.speed) > 0.5) : s.accel < -1.2 || (Math.abs(v.speed) < 0.3 && v.driver === 'ai'));
    const reverse = hasDriver && (dyn ? v.gear === -1 : v.speed < -0.3);
    const key = (head ? 1 : 0) | (braking ? 2 : 0) | (reverse ? 4 : 0) | (bl ? 8 : 0) | (br ? 16 : 0) | (hasDriver ? 32 : 0) | (night ? 64 : 0);
    if (key !== s.lightKey) {
      s.lightKey = key;
      ud.setLights({ head: head ? 1 : 0, drl: hasDriver ? 1 : 0, brake: braking ? 1 : 0, reverse: reverse ? 1 : 0, blinkL: bl ? 1 : 0, blinkR: br ? 1 : 0, sign: v.typeId === 'taxi' ? (night ? 1 : 0.25) : 0 });
    }

    if (dist > FX_DIST) return;
    // ombre de contact : sur le sol du niveau courant (sous la voiture quand elle est en l'air)
    const airborne = s.sim && p.gap > 0.02;
    const gy = airborne ? heightAt(g.position.x, g.position.z, g.position.y) : g.position.y;
    if (g.position.y - gy < 3) fx.addShadow(g.position.x, gy, g.position.z, g.rotation.y, airborne ? 0 : s.tPitch, airborne ? 0 : s.tRoll, v.spec.width * 1.22, v.spec.length * 1.12);
    if (head && v !== localV) fx.addBeam(v.pos.x, gy, v.pos.z, v.yaw, s.tPitch, v.spec.width);

    // fumée et traces de pneus
    if (dyn && !p.sleeping && !p.air && dist < 90) {
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
        const wx = v.pos.x + u.x * cy + u.z * sy, wz = v.pos.z - u.x * sy + u.z * cy;
        let wy = heightAt(wx, wz, v.pos.y);                   // sol sous la roue, au niveau de la voiture
        if (Math.abs(wy - v.pos.y) > 1) wy = v.pos.y;
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
    // moteur touché : vapeur blanche, puis fumée noire ; épave : fumée continue
    const eng = p.fxm ? p.fxm.engine : 0;
    if ((eng > 0.45 || v.wrecked) && dist < 70 && Math.random() < dt * (3 + 12 * eng)) {
      const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), o = v.spec.length * (p.fxm && v.typeId.match(/911|huracan|aventador/) ? -0.34 : 0.34);
      const black = eng > 0.8 || v.wrecked;
      fx.smoke(v.pos.x - sy * o, v.pos.y + v.spec.height * 0.5, v.pos.z - cy * o, v.vel.x * 0.5, 1.3, v.vel.z * 0.5, black ? 0.8 : 0.6, black ? 2.2 : 1.5, black ? 0.5 : 0.28, black ? 0.12 : 0.92);
    }
    // roue voilée / de travers sur un coin touché
    const cr = v.dmg.corners;
    if (!lod && (cr[0] > 0.45 || cr[1] > 0.45 || cr[2] > 0.45 || cr[3] > 0.45)) {
      const ws = ud.wheels;
      for (let i = 0; i < 4; i++) {
        const w = ws[i], u = w.userData, k = clamp((cr[i] - 0.45) * 2, 0, 1);
        w.rotation.y = u.baseY - (u.front ? (s.steerVis || 0) : 0) + u.side * 0.16 * k + Math.sin(u.spin) * 0.05 * k;
      }
    }
  }

  function remove(v) {
    if (!v) return;
    const i = list.indexOf(v);
    if (i >= 0) list.splice(i, 1);
    // ne pas détruire un éventuel passager (personnage du joueur) : on le rend à la scène
    for (const c of [...v.group.children]) if (c !== v.group.userData.chassis && !v.group.userData.wheels.includes(c)) scene.add(c);
    disposeDamage(v);
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

  let envT = 0, lagV = null;
  const debug = { noLag: false, fx: null };   // noLag : désactive la pose de rendu retardée (mesures avant/après)
  function update(dt) {
    if ((envT -= dt) <= 0) { envT = 1; updateEnvFallback(ctx.renderer, scene); setFallbackEnvIntensity(night ? 0.12 : 1); }
    // pose de début de frame de la voiture du joueur (celle que la caméra vient d'utiliser)
    const pv0 = ctx.player?.vehicle, lv0 = pv0 && pv0.driver === 'local' && !pv0.remote && !debug.noLag ? pv0 : null;
    if (lagV && lagV !== lv0) { lagV.vis.lag = null; lagV.vis.placed = false; }
    lagV = lv0;
    if (lv0) { const L = lv0.vis.lag || (lv0.vis.lag = { x: 0, y: 0, z: 0, yaw: 0 }); L.x = lv0.pos.x; L.y = lv0.pos.y; L.z = lv0.pos.z; L.yaw = lv0.yaw; }
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

  debug.fx = fx.objects;
  return { list, spawn, remove, nearest, createMesh, update, isNight: () => night, debug };
}

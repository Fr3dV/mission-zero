// Physique arcade des véhicules : modèle « bicyclette » à deux essieux avec pneus saturants,
// transfert de masse, boîte de vitesses, frein à main, collisions décor (cercles) et voiture↔voiture.
// Conventions : yaw = 0 regarde −Z ; avant = (−sin yaw, −cos yaw) ; droite = (cos yaw, −sin yaw).
const G = 9.81, MU0 = 1.05;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Transmission et répartition des masses par modèle (cg = position du centre de gravité, 0 = nez, 1 = poupe).
const SETUP = {
  citadine: { rear: 0, cg: 0.47, gears: 5 },
  taxi: { rear: 0, cg: 0.47, gears: 6 },
  tesla_model3: { rear: 0.6, cg: 0.5 },
  tesla_models: { rear: 0.6, cg: 0.5 },
  tesla_cybertruck: { rear: 0.55, cg: 0.5 },
  porsche_911: { rear: 0.7, cg: 0.535, gears: 7 },
  porsche_taycan: { rear: 0.6, cg: 0.5 },
  porsche_cayenne: { rear: 0.55, cg: 0.49, gears: 7 },
  lambo_huracan: { rear: 0.7, cg: 0.545, gears: 7 },
  lambo_aventador: { rear: 0.7, cg: 0.54, gears: 7 },
  lambo_urus: { rear: 0.6, cg: 0.49, gears: 7 },
};
const RATIOS = {
  5: [0.24, 0.42, 0.61, 0.8, 1],
  6: [0.2, 0.34, 0.5, 0.66, 0.83, 1],
  7: [0.17, 0.28, 0.4, 0.53, 0.67, 0.83, 1],
};
const torque = (rpm) => 1 - 1.02 * (rpm - 0.7) * (rpm - 0.7);
const gearForce = (R, i, rpm) => Math.min(1, 2 * Math.pow(R[0] / R[i], 0.85) * torque(rpm));
const pacF = (a) => Math.sin(1.5 * Math.atan(11 * a));   // avant : pic vers 9°, retombe à 0,71
const pacR = (a) => Math.sin(1.38 * Math.atan(11 * a));  // arrière : retombée plus douce (dérive contrôlable)

export const MAX_REVERSE = 12;

/** Initialise l'état physique d'un véhicule. info = géométrie (empattement, axes) fournie par models.js. */
export function initPhysics(v, info, def) {
  const s = v.spec, set = SETUP[s.id] || SETUP.citadine;
  const L = info.wheelbase;
  const cgZ = (set.cg - 0.5) * s.length;                     // décalage du CG par rapport au centre géométrique (+ = arrière)
  const a = clamp(info.cgToFront + cgZ, L * 0.3, L * 0.7), b = L - a;
  const R = s.electric ? null : RATIOS[set.gears || 6];
  const topF = s.electric ? 0.5 : gearForce(R, R.length - 1, 1);
  const cr = s.width * 0.5;
  const off = s.length * 0.5 - cr;
  v.vel = { x: 0, z: 0 };
  v.yawRate = 0; v.steerAngle = 0; v.rpm = 0; v.gear = 0; v.slip = 0; v.damage = 0;
  v.phys = {
    a, b, L, hcg: 0.3 + s.height * 0.18, k2: a * b, kc2: (s.length * s.length + s.width * s.width) / 12,
    mass: s.length * s.width * s.height * 130,
    rear: set.rear, R, cd: (topF * s.accel) / (s.maxSpeed * s.maxSpeed),
    circ: [off, 0, -off], cr, reach: s.length * 0.5 + 0.3,
    steer: 0, ax: 0, ay: 0, shiftT: 0, rev: false, sleeping: true, crashT: 0, kinT: -1,
    spin: 0, slipR: 0, slipF: 0, lock: false, gx: 0, gz: 0, brakeOn: false,
  };
}

/** Passe un véhicule en mode réveillé (après un choc, une prise en main…). */
export function wake(v) { v.phys.sleeping = false; }

function gearbox(v, vf, throttle, h) {
  const p = v.phys, s = v.spec, av = Math.abs(vf);
  if (p.rev) { v.gear = -1; v.rpm = s.electric ? av / s.maxSpeed : clamp(0.12 + av / (s.maxSpeed * 0.2) * 0.6 + throttle * 0.1, 0, 1); return clamp(1 - av / MAX_REVERSE, 0, 1) * 0.6; }
  if (s.electric) { v.gear = 1; v.rpm = clamp(av / s.maxSpeed, 0, 1); return clamp(1.6 - 1.1 * v.rpm, 0, 1); }
  const R = p.R, n = R.length;
  let g = clamp(v.gear, 1, n);
  if (p.shiftT > 0) p.shiftT -= h;
  else if (g < n && av / (s.maxSpeed * R[g - 1]) > 0.93) { g++; p.shiftT = 0.16; }
  else if (g > 1 && av / (s.maxSpeed * R[g - 2]) < (throttle > 0.8 ? 0.8 : 0.6)) { g--; p.shiftT = 0.1; }
  v.gear = g;
  let rpm = av / (s.maxSpeed * R[g - 1]);
  if (g === 1) rpm = Math.max(rpm, 0.13 + 0.42 * throttle);    // patinage de l'embrayage au démarrage
  const target = clamp(Math.max(0.12, rpm), 0, 1.02);
  v.rpm += (target - v.rpm) * Math.min(1, h * 22);
  return p.shiftT > 0 ? 0 : gearForce(R, g - 1, Math.min(1, rpm));
}

function substep(v, h, c, ctx) {
  const p = v.phys, s = v.spec;
  const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
  const fx = -sy, fz = -cy, rx = cy, rz = -sy;
  let vf = v.vel.x * fx + v.vel.z * fz, vl = v.vel.x * rx + v.vel.z * rz;
  const w = -v.yawRate;                                      // > 0 : rotation vers la droite
  const mu = MU0 * s.grip * (1 + 0.00002 * vf * vf);         // léger appui aéro
  const av = Math.abs(vf);
  const hasDriver = v.driver != null;

  // ---- commandes → efforts longitudinaux
  let throttle = hasDriver ? clamp(+c.throttle || 0, 0, 1) : 0, brake = hasDriver ? clamp(+c.brake || 0, 0, 1) : 0;
  const hand = hasDriver ? !!c.handbrake : true;
  if (p.rev) {
    if (throttle > 0.05 && brake < 0.05 && vf > -0.4) p.rev = false;
    else { const t = throttle; throttle = brake; brake = t; }
  } else if (brake > 0.05 && throttle < 0.05 && vf < 0.4) { p.rev = true; const t = throttle; throttle = brake; brake = t; }
  const dirSign = p.rev ? -1 : 1;
  const gf = gearbox(v, vf, throttle, h);
  let thrust = throttle * s.accel * gf * (1 - 0.25 * v.damage);
  // charges par essieu (par unité de masse) avec transfert longitudinal
  const tr = clamp((p.ax * p.hcg) / p.L, -G * 0.3, G * 0.3);
  const Nf = G * (p.b / p.L) - tr, Nr = G * (p.a / p.L) + tr;
  const tracLimit = mu * (Nr * p.rear + Nf * (1 - p.rear)) * (p.rear > 0 && p.rear < 1 ? 1.6 : 1.15);
  p.spin = thrust > tracLimit && av < 14 ? clamp((thrust - tracLimit) / tracLimit + 0.3, 0, 1) : 0;
  if (thrust > tracLimit * 1.12) thrust = tracLimit * 1.12;
  let brakeDec = Math.min(brake * s.brake, mu * G * 1.15);
  const coast = throttle < 0.05 ? (s.electric ? 1.4 : 0.7 + 1.6 * v.rpm) * (hasDriver ? 1 : 0) : 0;
  const drag = p.cd * vf * vf + 0.22 + coast;
  let axB = thrust * dirSign;
  p.brakeOn = brake > 0.05 && av > 0.3;

  // ---- efforts latéraux des pneus
  const d = p.steer, sd = Math.sin(d), cd = Math.cos(d);
  const vlf = vl + p.a * w, vlr = vl - p.b * w;
  const vlatW = -vf * sd + vlf * cd, vlongW = vf * cd + vlf * sd;
  const SOFT = 2.5;
  const af = Math.atan2(vlatW, Math.abs(vlongW) + SOFT), ar = Math.atan2(vlr, av + SOFT);
  const kf = 1 - 0.22 * brake;
  let Fyf = -mu * Nf * pacF(af) * kf, Fyr, FxR = 0;
  p.lock = hand && hasDriver;
  if (hand) {
    // roues arrière bloquées : frottement de glissement opposé à la vitesse du train arrière
    const vr = Math.hypot(vf, vlr), k = (hasDriver ? 0.62 : 0.9) * mu * Nr / Math.max(vr, 1.2);
    FxR = -k * vf; Fyr = -k * vlr;
  } else {
    const kr = Math.sqrt(Math.max(0.2, 1 - Math.pow(Math.min(1, (0.55 * thrust * p.rear) / (mu * Nr + 1e-3)), 2))) * (1 - 0.25 * brake);
    Fyr = -mu * Nr * pacR(ar) * kr;
  }
  p.slipF = Math.abs(af); p.slipR = Math.abs(ar);

  // freinage / traînée : s'opposent au mouvement longitudinal sans l'inverser
  let dec = brakeDec + drag;
  const ayB = Fyf * cd + Fyr;
  axB += -Fyf * sd * 0 + FxR;                                // (la composante longitudinale du braquage est négligée : conduite arcade)
  let nvf = vf + axB * h, nvl = vl + ayB * h;
  if (nvf > 0) nvf = Math.max(0, nvf - dec * h); else if (nvf < 0) nvf = Math.min(0, nvf + dec * h);
  // pente (gravité le long du terrain)
  let wx = fx * nvf + rx * nvl, wz = fz * nvf + rz * nvl;
  if (p.gx || p.gz) { wx -= G * p.gx * h; wz -= G * p.gz * h; }
  let nw = w + ((p.a * Fyf * cd - p.b * Fyr) / p.k2) * h;
  nw *= Math.exp(-0.5 * h);

  // maintien à l'arrêt (frein, frein à main, voiture vide)
  const sp = Math.hypot(wx, wz);
  if (sp < 0.35 && throttle < 0.05 && (brake > 0.05 || hand || !hasDriver || (!p.gx && !p.gz))) { wx *= 0.5; wz *= 0.5; nw *= 0.5; if (sp < 0.05) { wx = 0; wz = 0; nw = 0; } }
  // garde-fous
  const vmax = s.maxSpeed * 1.08;
  if (sp > vmax) { wx *= vmax / sp; wz *= vmax / sp; }
  nw = clamp(nw, -4.5, 4.5);
  if (!Number.isFinite(wx + wz + nw)) { wx = 0; wz = 0; nw = 0; }

  p.ax += ((nvf - vf) / h - p.ax) * Math.min(1, h * 12);
  p.ay += (ayB - p.ay) * Math.min(1, h * 12);
  v.vel.x = wx; v.vel.z = wz; v.yawRate = -nw;
  v.pos.x += wx * h; v.pos.z += wz * h; v.yaw += v.yawRate * h;
  return collideStatic(v, ctx);
}

/** Collision contre le décor : trois cercles le long de la caisse, impulsion avec rotation induite. */
function collideStatic(v, ctx) {
  const p = v.phys, col = ctx.collision;
  let impact = 0;
  const y = v.pos.y + 0.6;
  for (let i = 0; i < 3; i++) {
    const o = p.circ[i];
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const cx = v.pos.x + fx * o, cz = v.pos.z + fz * o;
    const r = col.resolveCircle(cx, cz, p.cr, y);
    if (!r.hit) continue;
    const dx = r.x - cx, dz = r.z - cz, dl = Math.hypot(dx, dz);
    let nx, nz;
    if (dl > 1e-5) { nx = dx / dl; nz = dz / dl; } else { nx = r.nx; nz = r.nz; }
    v.pos.x += dx; v.pos.z += dz;
    const px = fx * o - nx * p.cr, pz = fz * o - nz * p.cr;
    const wy = v.yawRate;
    const vpx = v.vel.x + wy * pz, vpz = v.vel.z - wy * px;
    const vn = vpx * nx + vpz * nz;
    if (vn >= 0) continue;
    const rn = pz * nx - px * nz;
    const j = (-(1 + 0.22) * vn) / (1 + (rn * rn) / p.kc2);
    v.vel.x += j * nx; v.vel.z += j * nz; v.yawRate += (rn * j) / p.kc2;
    const tx = -nz, tz = nx, vt = vpx * tx + vpz * tz, rt = pz * tx - px * tz;
    const jt = clamp(-vt / (1 + (rt * rt) / p.kc2), -0.3 * j, 0.3 * j);
    v.vel.x += jt * tx; v.vel.z += jt * tz; v.yawRate += (rt * jt) / p.kc2;
    if (-vn > impact) impact = -vn;
  }
  v.yawRate = clamp(v.yawRate, -4.5, 4.5);
  return impact;
}

/**
 * Avance la physique d'un véhicule local sur dt (sous-pas adaptatifs : ≤ 1/120 s et ≤ 0,35 m par sous-pas).
 * @returns impact maximal (m/s) contre le décor pendant la frame.
 */
export function stepVehicle(v, dt, ctx) {
  const p = v.phys, s = v.spec, c = v.controls;
  const hasDriver = v.driver != null;
  const sp0 = Math.hypot(v.vel.x, v.vel.z);
  if (!hasDriver && sp0 < 0.05 && Math.abs(v.yawRate) < 0.05) { p.sleeping = true; v.speed = 0; v.vel.x = v.vel.z = 0; v.yawRate = 0; v.slip = 0; p.ax = p.ay = 0; v.rpm = 0; v.gear = 0; p.brakeOn = false; return 0; }
  p.sleeping = false;

  // direction : débattement limité par la vitesse (reste proche de la limite d'adhérence), lissage, contre-braquage assisté
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  const vf = v.vel.x * fx + v.vel.z * fz, vl = v.vel.x * Math.cos(v.yaw) - v.vel.z * Math.sin(v.yaw);
  const mu = MU0 * s.grip;
  const dLim = Math.atan((p.L * mu * G) / Math.max(sp0 * sp0, 1)) * 1.6;
  const dMax = Math.min(0.6, dLim);
  const target = hasDriver ? clamp(+c.steer || 0, -1, 1) : 0;
  const rate = (Math.abs(target) < Math.abs(p.steerN || 0) || target * (p.steerN || 0) < 0 ? 7 : 4.5) * dt;
  p.steerN = (p.steerN || 0) + clamp(target - (p.steerN || 0), -rate, rate);
  let d = p.steerN * dMax;
  if (vf > 4) {
    // contre-braquage assisté : seulement au-delà de la dérive normale de virage (train arrière qui décroche)
    const beta = Math.atan2(vl - p.b * -v.yawRate, Math.max(vf, 3));
    const ex = Math.abs(beta) - 0.1;
    if (ex > 0) d += clamp(0.75 * ex * Math.sign(beta), -0.4, 0.4) * smooth(4, 10, vf);
  }
  p.steer = clamp(d, -0.62, 0.62);
  v.steerAngle = p.steer;

  // pente du terrain
  const hAt = ctx.heightAt;
  const h0 = hAt(v.pos.x, v.pos.z);
  if (h0 > 0.01) { p.gx = (hAt(v.pos.x + 1, v.pos.z) - hAt(v.pos.x - 1, v.pos.z)) / 2; p.gz = (hAt(v.pos.x, v.pos.z + 1) - hAt(v.pos.x, v.pos.z - 1)) / 2; } else { p.gx = p.gz = 0; }

  const n = clamp(Math.ceil(Math.max(dt * 120, (sp0 * dt) / 0.35)), 1, 16);
  const h = dt / n;
  let impact = 0;
  for (let i = 0; i < n; i++) { const im = substep(v, h, c, ctx); if (im > impact) impact = im; }

  const B = ctx.BOUNDS;
  if (B) { const m = 60; v.pos.x = clamp(v.pos.x, B.minX - m, B.maxX + m); v.pos.z = clamp(v.pos.z, B.minZ - m, B.maxZ + m); }
  const f2x = -Math.sin(v.yaw), f2z = -Math.cos(v.yaw);
  v.speed = v.vel.x * f2x + v.vel.z * f2z;
  // glissement (0..1) pour l'audio et les effets
  const slide = Math.abs(v.vel.x * Math.cos(v.yaw) - v.vel.z * Math.sin(v.yaw));
  let slip = Math.max(smooth(0.11, 0.3, p.slipR), smooth(0.14, 0.34, p.slipF) * 0.7) * smooth(3, 9, sp0);
  if (p.lock && sp0 > 2) slip = Math.max(slip, smooth(2, 10, sp0));
  if (p.spin > 0) slip = Math.max(slip, p.spin);
  if (p.brakeOn && +c.brake > 0.95 && sp0 > 22) slip = Math.max(slip, 0.25);
  v.slip += (slip - v.slip) * Math.min(1, dt * 10);
  p.slide = slide;
  return impact;
}

/**
 * Collisions voiture↔voiture. Les véhicules cinématiques (distants, IA pilotée par setTransform)
 * sont des masses infinies. onCrash(vehicle, impact) est appelé pour chaque véhicule dynamique percuté.
 */
export function collideVehicles(list, isDynamic, onCrash) {
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const A = list[i], pa = A.phys;
    if (!A.group.visible) continue;
    const dynA = isDynamic(A), actA = dynA ? !pa.sleeping : Math.abs(A.speed) > 0.5;
    for (let j = i + 1; j < n; j++) {
      const B = list[j], pb = B.phys;
      const dx = A.pos.x - B.pos.x, dz = A.pos.z - B.pos.z, reach = pa.reach + pb.reach;
      if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
      if (!B.group.visible) continue;
      const dynB = isDynamic(B);
      if (!dynA && !dynB) continue;
      if (!actA && !(dynB ? !pb.sleeping : Math.abs(B.speed) > 0.5)) continue;
      if (Math.abs(A.pos.y - B.pos.y) > 2.5) continue;
      // paire de cercles la plus enfoncée
      const afx = -Math.sin(A.yaw), afz = -Math.cos(A.yaw), bfx = -Math.sin(B.yaw), bfz = -Math.cos(B.yaw);
      let best = 0, bax = 0, baz = 0, bbx = 0, bbz = 0;
      const rs = pa.cr + pb.cr;
      for (let ia = 0; ia < 3; ia++) {
        const ax = A.pos.x + afx * pa.circ[ia], az = A.pos.z + afz * pa.circ[ia];
        for (let ib = 0; ib < 3; ib++) {
          const bx = B.pos.x + bfx * pb.circ[ib], bz = B.pos.z + bfz * pb.circ[ib];
          const pen = rs - Math.hypot(ax - bx, az - bz);
          if (pen > best) { best = pen; bax = ax; baz = az; bbx = bx; bbz = bz; }
        }
      }
      if (best <= 0) continue;
      let nx = bax - bbx, nz = baz - bbz;
      const nl = Math.hypot(nx, nz);
      if (nl > 1e-5) { nx /= nl; nz /= nl; } else { nx = 1; nz = 0; }
      const imA = dynA ? 1 / pa.mass : 0, imB = dynB ? 1 / pb.mass : 0, ims = imA + imB;
      // point de contact (milieu de la zone de recouvrement)
      const cx = bbx + nx * (pb.cr - best / 2), cz = bbz + nz * (pb.cr - best / 2);
      const rax = cx - A.pos.x, raz = cz - A.pos.z, rbx = cx - B.pos.x, rbz = cz - B.pos.z;
      const vax = A.vel.x + A.yawRate * raz, vaz = A.vel.z - A.yawRate * rax;
      const vbx = B.vel.x + (dynB ? B.yawRate : 0) * rbz, vbz = B.vel.z - (dynB ? B.yawRate : 0) * rbx;
      const vn = (vax - vbx) * nx + (vaz - vbz) * nz;
      // séparation
      A.pos.x += nx * best * (imA / ims); A.pos.z += nz * best * (imA / ims);
      B.pos.x -= nx * best * (imB / ims); B.pos.z -= nz * best * (imB / ims);
      if (vn >= 0) continue;
      const rnA = raz * nx - rax * nz, rnB = rbz * nx - rbx * nz;
      const iIA = imA / pa.kc2, iIB = imB / pb.kc2;
      const jn = (-(1 + 0.25) * vn) / (ims + rnA * rnA * iIA + rnB * rnB * iIB);
      const tx = -nz, tz = nx, vt = (vax - vbx) * tx + (vaz - vbz) * tz;
      const rtA = raz * tx - rax * tz, rtB = rbz * tx - rbx * tz;
      const jt = clamp(-vt / (ims + rtA * rtA * iIA + rtB * rtB * iIB), -0.35 * jn, 0.35 * jn);
      if (dynA) { A.vel.x += (jn * nx + jt * tx) * imA; A.vel.z += (jn * nz + jt * tz) * imA; A.yawRate = clamp(A.yawRate + (rnA * jn + rtA * jt) * iIA, -4.5, 4.5); pa.sleeping = false; }
      if (dynB) { B.vel.x -= (jn * nx + jt * tx) * imB; B.vel.z -= (jn * nz + jt * tz) * imB; B.yawRate = clamp(B.yawRate - (rnB * jn + rtB * jt) * iIB, -4.5, 4.5); pb.sleeping = false; }
      if (dynA) onCrash(A, -vn * (imA / ims), B);
      if (dynB) onCrash(B, -vn * (imB / ims), A);
    }
  }
}

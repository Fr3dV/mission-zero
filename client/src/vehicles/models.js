// Assemblage des modèles 3D : cache de géométries par type, niveaux de détail, API userData.
import * as THREE from 'three';
import { VEHICLE_BY_ID } from '@shared/catalog.js';
import { DEFS } from './defs.js';
import { buildCar } from './body.js';
import { getPaint, getMisc, getGlass, createLightsMaterial, CH } from './materials.js';

const cache = new Map();

/** Géométries (haute définition + LOD) d'un type de véhicule, construites à la demande puis mises en cache. */
export function getCarGeometry(typeId) {
  let c = cache.get(typeId);
  if (c) return c;
  const spec = VEHICLE_BY_ID[typeId] || VEHICLE_BY_ID.citadine;
  const def = DEFS[spec.id] || DEFS.citadine;
  const hi = buildCar(spec, def, false);
  const lo = buildCar(spec, def, true, { P: hi.P, out: hi.out });
  // points d'ancrage utiles aux effets (phares, feux, roues)
  const P = hi.P;
  const info = {
    wheelbase: P.axles[1].z - P.axles[0].z,
    cgToFront: -P.axles[0].z, cgToRear: P.axles[1].z,
    wheelR: def.wheelR, track: Math.abs(hi.wheels[0].x) * 2,
    noseZ: -spec.length / 2, tailZ: spec.length / 2,
    headY: Math.min(P.belt(0.03) - 0.03, 0.9),
    seat: { ...P.seat }, wheelPos: { ...P.wheelPos },
    // limites d'écrasement et régions des éléments mobiles (capot, coffre, boucliers, rétroviseurs) pour les dégâts
    ...(() => {
      const cab = def.cabin, S = new Float64Array(30), L = spec.length;
      const cabA = cab.cowl - 0.012, cabB = def.cabEnd ?? cab.rearBot ?? (def.sideGlass ? def.sideGlass[1] + 0.012 : 0.7);
      const fo = P.axles[0].z + L / 2, ro = L / 2 - P.axles[1].z, R = def.wheelR;
      const wbAt = (t) => P.section(t, S)[16];
      const yMin = (z, x) => (P.yTopAt(P.tOf(z), Math.abs(x)) ?? 9) - 0.05;
      const regions = { lampZF: P.zOf(0.2), lampZR: P.zOf(0.8), lampY: P.belt(0.1) + 0.12 };
      if (def.hoodSeam !== false) { const tA = def.hoodFront ?? 0.035, tB = cab.cowl - 0.012; regions.hood = { z0: P.zOf(tA), z1: P.zOf(tB), hx: wbAt((tA + tB) / 2) * (def.hoodSeam ?? 0.86) + 0.01, hy: P.top(tB), yMin }; }
      if (def.trunkSeam != null) { const tA = def.trunkSeam; regions.trunk = { z0: P.zOf(tA), z1: P.zOf(def.trunkEnd ?? 0.985), hx: wbAt(tA) * (def.trunkK ?? 0.84) + 0.01, hy: P.top(tA), yMin }; }
      regions.bumperF = { z: P.zOf(0) + 0.03, yMax: P.bottom(0) + 0.62 * (P.top(0) - P.bottom(0)), hx: P.hw * P.plan(0) };
      regions.bumperR = { z: P.zOf(1) - 0.03, yMax: P.bottom(1) + 0.62 * (P.top(1) - P.bottom(1)), hx: P.hw * P.plan(1) };
      if (def.mirrors !== false) { const mo = def.mirrors || {}, t = cab.cowl + (mo.dt ?? 0.045); P.section(t, S); regions.mirror = { x: S[16] + 0.03, y: S[17] + (mo.dy ?? 0.055) + 0.02, z: P.zOf(t) }; }
      return {
        regions,
        crush: { front: Math.min(0.6, Math.max(0.25, fo - R - 0.1)), rear: Math.min(0.5, Math.max(0.2, ro - R - 0.1)), side: 0.2, cabX: wbAt((cabA + cabB) / 2) - 0.1, cabZ0: P.zOf(cabA), cabZ1: P.zOf(cabB), cabY: 3 },
      };
    })(),
    // cotes mesurées (contrôle des proportions dans la page de debug)
    metrics: (() => {
      let peakT = 0, peakY = 0, clear = 9;
      for (let i = 0; i <= 200; i++) { const t = i / 200, y = P.top(t); if (y > peakY) { peakY = y; peakT = t; } if (t > 0.3 && t < 0.7) clear = Math.min(clear, P.bottom(t)); }
      const mid = (P.axles[0].t + P.axles[1].t) / 2;
      return {
        length: spec.length, wheelbase: P.axles[1].z - P.axles[0].z, frontOverhang: P.axles[0].z + spec.length / 2, rearOverhang: spec.length / 2 - P.axles[1].z,
        wheelDia: def.wheelR * 2, trackF: Math.abs(hi.wheels[0].x) * 2, trackR: Math.abs(hi.wheels[2].x) * 2, clearance: clear,
        beltRatio: P.belt(mid) / peakY, roofPeak: (P.zOf(peakT) + spec.length / 2) / spec.length, height: peakY,
        tris: { hi: (hi.paint.attributes.position.count + hi.misc.attributes.position.count + hi.lights.attributes.position.count + hi.glass.attributes.position.count + 4 * hi.wheelGeo.attributes.position.count) / 3, lo: (lo.paint.attributes.position.count + lo.misc.attributes.position.count) / 3 },
      };
    })(),

  };
  c = { spec, def, hi, lo, info };
  cache.set(typeId, c);
  return c;
}

/**
 * Crée un modèle autonome (showroom, joueurs distants, trafic).
 * group.userData = { wheels:[AVG, AVD, ARG, ARD], setLights({head, brake, reverse, blinkL, blinkR, drl, sign}),
 *                    setSteer(angleRad, >0 = droite), spinWheels(distanceM), setLOD(bool), chassis, typeId, info, dispose() }
 */
export function createMesh(typeId, color) {
  const c = getCarGeometry(typeId);
  const { spec, def, hi, lo } = c;
  const paintMat = getPaint(color || spec.colors[0], def.paint || 'metal');
  const misc = getMisc();
  const lightsMat = createLightsMaterial();
  const lint = lightsMat.userData.lint;

  const group = new THREE.Group();
  group.name = 'vehicle:' + spec.id;
  const chassis = new THREE.Group();
  group.add(chassis);
  const mk = (geo, m, shadow) => { const o = new THREE.Mesh(geo, m); o.castShadow = shadow; o.receiveShadow = true; chassis.add(o); return o; };
  const bodyHi = mk(hi.paint, paintMat, true), miscHi = mk(hi.misc, misc, true);
  const bodyLo = mk(lo.paint, paintMat, true), miscLo = mk(lo.misc, misc, true);
  const lights = mk(hi.lights, lightsMat, false);
  bodyLo.visible = miscLo.visible = false;
  const glassHi = mk(hi.glass, getGlass(), false);
  glassHi.receiveShadow = false; glassHi.renderOrder = 3;

  const wheels = hi.wheels.map((w) => {
    const m = new THREE.Mesh(hi.wheelGeo, misc);
    m.position.set(w.x, w.y, w.z);
    m.rotation.order = 'YXZ';
    m.rotation.y = w.side > 0 ? 0 : Math.PI;
    m.castShadow = false; m.receiveShadow = false;
    m.userData = { side: w.side, front: w.front, baseY: m.rotation.y, restY: w.y, x: w.x, z: w.z, R: w.R, spin: 0 };
    group.add(m);
    return m;
  });

  let lodOn = false;
  group.userData = {
    typeId: spec.id, info: c.info, chassis, wheels, lightsMaterial: lightsMat,
    parts: { bodyHi, miscHi, bodyLo, miscLo, glassHi, lights },
    setLights(s = {}) {
      const head = +(s.head ?? 0), br = +(s.brake ?? 0);
      lint[CH.HEAD] = head * 5;
      lint[CH.DRL] = Math.max(head, +(s.drl ?? 0)) * 3.2;
      lint[CH.TAIL] = Math.max(br * 7, head * 1.3);
      lint[CH.BRAKE] = br * 7;
      lint[CH.REVERSE] = +(s.reverse ?? 0) * 4;
      lint[CH.BLINK_L] = +(s.blinkL ?? 0) * 6;
      lint[CH.BLINK_R] = +(s.blinkR ?? 0) * 6;
      lint[CH.SIGN] = +(s.sign ?? (head ? 1 : 0)) * 2.2;
    },
    setSteer(a) { for (const w of wheels) if (w.userData.front) w.rotation.y = w.userData.baseY - a; },
    spinWheels(dist) { for (const w of wheels) { w.userData.spin += dist / w.userData.R; w.rotation.x = -w.userData.side * w.userData.spin; } },
    setLOD(on) {
      if (on === lodOn) return;
      lodOn = on;
      bodyHi.visible = miscHi.visible = glassHi.visible = !on; bodyLo.visible = miscLo.visible = on;
      for (const w of wheels) w.visible = !on;
    },
    dispose() { lightsMat.dispose(); group.removeFromParent(); },
  };
  group.userData.setLights({});
  return group;
}

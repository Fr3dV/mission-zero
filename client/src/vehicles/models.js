// Assemblage des modèles 3D : cache de géométries par type, niveaux de détail, API userData.
import * as THREE from 'three';
import { VEHICLE_BY_ID } from '@shared/catalog.js';
import { DEFS } from './defs.js';
import { buildCar } from './body.js';
import { getPaint, getMisc, getGlass, createLightsMaterial, CH, ATLAS_UV } from './materials.js';
import { GeoBuilder, mat } from './geo.js';

const cache = new Map();

/** Nombre de plaques d'immatriculation disponibles dans l'atlas. */
export const PLATE_COUNT = ATLAS_UV.plates.length;

// Gyrophare : rampe basse posée sur le toit, deux feux bleus (canaux BEACON_L / BEACON_R du matériau des optiques de la
// voiture, donc sans matériau ni lumière en plus). Une seule géométrie pour tous les véhicules.
const BEACON_W = 0.58;        // largeur de la rampe (m)
const BEACON_GAIN = 26;       // gain d'émission d'un feu allumé
let _beaconGeo = null;
function beaconGeometry() {
  if (_beaconGeo) return _beaconGeo;
  const b = new GeoBuilder();
  const dark = { color: 0x101114, ch: CH.OFF }, blue = 0x1446ff;
  b.add(new THREE.BoxGeometry(BEACON_W, 0.03, 0.17), mat(0, 0.015, 0), dark);
  b.add(new THREE.BoxGeometry(0.05, 0.075, 0.15), mat(0, 0.066, 0), { color: 0xc9ced6, ch: CH.OFF });
  for (const s of [-1, 1]) {
    // feu : pavé aux flancs inclinés (plus étroit en haut), visible de tous les côtés
    const g = new THREE.CylinderGeometry(0.105, 0.135, 0.08, 4, 1).rotateY(Math.PI / 4);
    b.add(g, mat(s * 0.158, 0.07, 0, 0, 0, 0, 1.18, 1, 0.74), { color: blue, ch: s < 0 ? CH.BEACON_L : CH.BEACON_R });
    g.dispose();
  }
  return (_beaconGeo = b.build(['uv', 'color', 'lch']));
}

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
    plate: (def.plateIdx ?? 0) % PLATE_COUNT,                 // plaque par défaut du modèle (voiture personnelle, vitrines)
    // ancrage du gyrophare : sur le pavillon, 22 cm derrière le haut du pare-brise (devant un éventuel lumineux de toit),
    // rampe rétrécie sur les pavillons étroits
    roof: (() => {
      // (pavillon en pointe, sans lunette déclarée : juste derrière l'arête)
      const cab = def.cabin, zW = P.zOf(cab.wsTop), z = cab.rearTop != null ? Math.min(zW + 0.22, P.zOf((cab.wsTop + cab.rearTop) / 2)) : zW + 0.06;
      const t = P.tOf(z), y0 = P.top(t);
      let flat = 0.12;
      for (let x = 0.14; x <= BEACON_W / 2 + 1e-6; x += 0.02) { const y = P.yTopAt(t, x); if (y == null || y < y0 - 0.035) break; flat = x; }
      // posée sur le point le plus bas de son emprise (bords latéraux, avant et arrière) : jamais de jour sous la rampe
      let y = Math.min(y0, P.yTopAt(t, flat) ?? y0, P.top(P.tOf(z - 0.085)), P.top(P.tOf(z + 0.085)));
      if (!Number.isFinite(y)) y = spec.height;
      return { z, y: y - 0.004, sx: Math.max(0.55, Math.min(1, (flat + 0.012) / (BEACON_W / 2))) };
    })(),
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
 *                    setSteer(angleRad, >0 = droite), spinWheels(distanceM), setLOD(bool), chassis, typeId, info, dispose(),
 *                    setPlate(index 0..PLATE_COUNT-1), plate, setBeacon(bool), beacon, flashBeacon(gauche, droite) }
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

  let lodOn = false, beacon = null;
  const plateRect = lightsMat.userData.plate;
  group.userData = {
    typeId: spec.id, info: c.info, chassis, wheels, lightsMaterial: lightsMat,
    parts: { bodyHi, miscHi, bodyLo, miscLo, glassHi, lights },
    plate: -1, beacon: false,
    /** Choisit la plaque d'immatriculation (index dans l'atlas) : simple uniform du matériau des optiques de la voiture. */
    setPlate(i) {
      i = ((Math.round(+i) || 0) % PLATE_COUNT + PLATE_COUNT) % PLATE_COUNT;
      const r = ATLAS_UV.plates[i];
      plateRect[0] = r[0]; plateRect[1] = r[1]; plateRect[2] = r[2] - r[0]; plateRect[3] = r[3] - r[1];
      group.userData.plate = i;
    },
    /** Pose (ou retire) le gyrophare ; masqué au-delà de la distance de LOD. Les éclats sont donnés par flashBeacon. */
    setBeacon(on) {
      on = !!on;
      group.userData.beacon = on;
      if (on && !beacon) {
        const R = c.info.roof;
        beacon = new THREE.Mesh(beaconGeometry(), lightsMat);
        beacon.name = 'gyrophare'; beacon.castShadow = false; beacon.receiveShadow = false;
        beacon.position.set(0, R.y, R.z); beacon.scale.x = R.sx;
        chassis.add(beacon);
      }
      if (beacon) beacon.visible = on && !lodOn;
      if (!on) lint[CH.BEACON_L] = lint[CH.BEACON_R] = 0;
    },
    /** Intensité (0..1) de chacun des deux feux du gyrophare (émissif fort : cœur blanc et halo bleu, lisible en plein jour). */
    flashBeacon(l, r) { lint[CH.BEACON_L] = l * BEACON_GAIN; lint[CH.BEACON_R] = r * BEACON_GAIN; },
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
      if (beacon) beacon.visible = group.userData.beacon && !on;
    },
    dispose() { lightsMat.dispose(); group.removeFromParent(); },
  };
  group.userData.setLights({});
  group.userData.setPlate(c.info.plate);
  return group;
}

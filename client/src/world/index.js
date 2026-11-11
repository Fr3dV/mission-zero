// Module « ville » : sol, chaussées, trottoirs, marquages, Seine + quais + ponts, immeubles haussmanniens,
// parcs, arbres, lampadaires et mobilier. PROPRIÉTAIRE : agent ville. Contrat : docs/ARCHITECTURE.md.
//
// Organisation :
//   masks.js      masque du sol (Seine / pelouses / allées / places) : texture GPU + requêtes CPU
//   roadnet.js    index spatial des segments, API roadAt / nearestRoadPoint / randomRoadPoint, carrefours
//   streets.js    sol, rubans de chaussée, trottoirs à bordure, marquages (géométrie fusionnée par tuile)
//   river.js      eau (shader), quais, parapets (collisions), ponts à arches
//   buildings.js  immeubles instanciés + shader de façade procédural
//   vegetation.js platanes d'alignement et arbres de parc (instanciés, 2 LOD)
//   props.js      lampadaires instanciés, feux, bancs, colonnes Morris, kiosques, bouches de métro
import { qualityPreset, TiledSurf, clamp } from './util.js';
import { createSurfaceTextures } from './textures.js';
import { createMasks } from './masks.js';
import { createSurfaceMaterial } from './surface.js';
import { createRoadNet } from './roadnet.js';
import { buildGround, buildStreets, Y_WALK } from './streets.js';
import { buildRiver } from './river.js';
import { buildBuildings } from './buildings.js';
import { buildVegetation } from './vegetation.js';
import { buildProps } from './props.js';
import { createDamage } from './damage.js';
import { buildSigns } from './signs.js';
import { buildTerraces } from './terraces.js';
import { setHeightLayer } from '@shared/terrain.js';

/** Facteur de nuit 0..1 à partir de l'heure (crépuscule ~19h30-21h, aube ~5h30-7h). */
function nightFromHour(h) {
  const s = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  return Math.max(s(19.3, 20.8, h), 1 - s(5.6, 7.2, h));
}

export function createWorld(ctx) {
  const { THREE, scene, bus, heightAt } = ctx;
  const t0 = performance.now();
  const timings = {};
  const lap = (name, t) => { timings[name] = Math.round(performance.now() - t); };
  const Q = qualityPreset(ctx.quality);

  let t = performance.now();
  const masks = createMasks(ctx, Q); lap('masques', t);
  t = performance.now();
  const net = createRoadNet(ctx); lap('reseau', t);

  // ---------- uniformes partagés (nuit, reflet du ciel)
  const uniforms = { uNight: { value: 0 }, uLampOn: { value: 0 }, uSky: { value: new THREE.Color(0x9fb8cc) }, uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() }, uSunK: { value: 1 } };

  // ---------- surfaces fusionnées par tuile
  t = performance.now();
  const surf = new TiledSurf(1000);
  buildGround(ctx, surf, masks);
  const streetInfo = buildStreets(ctx, net, surf, masks); lap('rues', t);
  t = performance.now();
  const river = buildRiver(ctx, net, surf, masks); lap('seine', t);

  t = performance.now();
  const tex = createSurfaceTextures(THREE, ctx.renderer, Q); lap('textures', t);
  const surfMat = createSurfaceMaterial(THREE, tex, masks, uniforms);
  const surfMeshes = [];
  let surfTris = 0;
  for (const [, b] of surf.map) {
    const geo = b.build(THREE); if (!geo) continue;
    surfTris += geo.index.count / 3;
    const m = new THREE.Mesh(geo, surfMat);
    m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.name = 'sol';
    scene.add(m); surfMeshes.push(m);
  }
  surf.map.clear();


  t = performance.now();
  const bld = buildBuildings(ctx, net, masks, Q, uniforms, river); lap('immeubles', t);
  t = performance.now();
  const veg = buildVegetation(ctx, net, masks, river, bld, Q); lap('arbres', t);
  t = performance.now();
  const props = buildProps(ctx, net, masks, river, bld, Q, uniforms, streetInfo); lap('mobilier', t);
  t = performance.now();
  const signs = buildSigns(ctx, net, bld, Q); lap('plaques', t);
  t = performance.now();
  const terraces = buildTerraces(ctx, net, bld, river, masks, Q, uniforms); lap('terrasses', t);
  const damage = createDamage(ctx, { props, veg, uniforms, terraces });
  timings.total = Math.round(performance.now() - t0);

  // ---------- cycle jour / nuit
  let nightTarget = 0, night = -1;
  const setHour = (hour, isNight) => { nightTarget = typeof hour === 'number' && isFinite(hour) ? nightFromHour(((hour % 24) + 24) % 24) : isNight ? 1 : 0; };
  bus.on('env:time', (e) => setHour(e?.hour, e?.night));
  const h0 = ctx.store?.timeOfDay ?? parseFloat(ctx.params?.get?.('time'));
  if (typeof h0 === 'number' && isFinite(h0)) setHour(h0, false);

  const skyTmp = new THREE.Color(), sunTmp = new THREE.Vector3();
  const cam = ctx.camera.position;
  const world = {
    /** Route (objet de worldData.roads) sous le point, ou null. */
    roadAt: (x, z) => net.roadAt(x, z),
    /** Point de chaussée carrossable le plus proche : {x, z, yaw, road, dist}. opts.drivable=false inclut les rues piétonnes. */
    nearestRoadPoint: (x, z, opts) => net.nearestRoadPoint(x, z, opts),
    /** Point aléatoire sur une chaussée carrossable (voie de droite, hors carrefours et ponts) : {x, z, yaw, road}. */
    randomRoadPoint: () => net.randomRoadPoint(),
    // --- extras hors contrat (facultatifs pour les autres modules)
    /** Hauteur du revêtement : heightAt + surélévation du trottoir. */
    surfaceHeightAt(x, z) {
      const bh = river.bergeHeight(x, z); if (bh !== undefined) return bh;
      const d = net.edgeDistance(x, z, false);
      return heightAt(x, z) + (d > 0.05 && d < 5 ? Y_WALK : 0);
    },
    // --- contrat v2 « dégâts et impacts »
    /** Appelé par le module véhicules à chaque contact voiture/décor : { shape, tag, x, z, dirX, dirZ, speed, mass, vehicle } -> { broke, absorb }. */
    onImpact: (e) => damage.onImpact(e),
    /** Objets tombés au sol près de (x,z) : [{x, z, r, tag}]. */
    propsNear: (x, z, r) => damage.propsNear(x, z, r),
    _damage: damage,
    _maskWater: (x, z) => masks.isWater(x, z),
    _river: river, _terraces: terraces,
    isWater: (x, z) => masks.isWater(x, z) && !river.nearDeck(x, z, 0) && river.bergeHeight(x, z) === undefined,
    isPark: (x, z) => masks.isPark(x, z),
    inBuilding: (x, z, pad) => bld.inBuilding(x, z, pad),
    stats: { timings, buildings: bld.count, proceduralBuildings: bld.procedural, trees: veg.count, lamps: props.lampCount, props: props.nProps, surfaceTriangles: surfTris, roads: net.roads.length, bridges: river.decks.length, terraces: terraces.count, terraceTables: terraces.tables || 0, bergeLen: river.bergeLen, ramps: river.ramps, stairs: river.stairs, boats: river.boats, bookstalls: river.bookstalls, plaques: signs.count, quality: ctx.quality, metros: props.metros.length, kiosks: props.kiosks.length },
    _debug: { metros: props.metros, kiosks: props.kiosks },
    update(dt) {
      // transition douce jour/nuit
      if (night < 0) night = nightTarget;
      night += clamp(nightTarget - night, -dt * 0.5, dt * 0.5);
      uniforms.uNight.value = night;
      uniforms.uLampOn.value = clamp(night * 1.6, 0, 1);
      const src = scene.fog?.color || (scene.background?.isColor ? scene.background : null);
      if (src) skyTmp.copy(src); else skyTmp.setRGB(0.55, 0.68, 0.8).multiplyScalar(1 - night * 0.95);
      uniforms.uSky.value.lerp(skyTmp, 0.1);
      // soleil de l'environnement → ombres propres analytiques des façades
      const sun = ctx.env?.sun;
      if (sun?.isDirectionalLight) {
        sunTmp.copy(sun.position).sub(sun.target.position);
        if (sunTmp.lengthSq() > 1e-6) uniforms.uSunDir.value.copy(sunTmp.normalize());
        uniforms.uSunK.value = clamp(sun.intensity / 1.2, 0, 1) * clamp(uniforms.uSunDir.value.y * 8, 0, 1) * (sun.visible ? 1 : 0);
      } else uniforms.uSunK.value = 1 - night;
      river.update(dt, night);
      bld.update(cam);
      veg.update(cam);
      props.update(cam, night);
      damage.update(dt, night);
      terraces.update(dt);
      for (const m of surfMeshes) {
        const s = m.geometry.boundingSphere;
        m.visible = Math.hypot(s.center.x - cam.x, s.center.z - cam.z) - s.radius < Q.viewDist;
      }
    },
  };
  // Relief local (contrat v4) : les berges basses et leurs rampes deviennent praticables pour tous les modules.
  // Posée APRÈS la construction : tout le sol de la ville est bâti sur le relief de base.
  setHeightLayer((x, z) => river.bergeHeight(x, z));
  console.info('[ville] construite en ' + timings.total + ' ms', JSON.stringify(world.stats));
  return world;
}

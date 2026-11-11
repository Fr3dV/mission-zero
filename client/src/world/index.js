// Module « ville » : sol, chaussées, trottoirs, marquages, fleuve + quais + ponts, immeubles, parcs, arbres,
// lampadaires et mobilier. PROPRIÉTAIRE : agent ville. Contrat : docs/ARCHITECTURE.md.
//
// Indépendant de la ville : tout ce qui est propre à une ville vient de son profil (cities/<ville>.js).
// Rien de global n'est construit au démarrage hormis des index en tableaux typés (réseau routier, bâtiments,
// niveaux superposés) et le fleuve (ouvrage linéaire) ; le reste est diffusé par tuile autour du joueur :
//
//   cities/       profils par ville (voirie, bâti, fleuve, mobilier)
//   roadnet.js    index spatial des segments, API roadAt / nearestRoadPoint / randomRoadPoint, carrefours, niveaux
//   levels.js     niveaux superposés : couche de hauteur (ponts routiers, trémies, tunnels, berges sous les ponts)
//   masks.js      masque du sol (matières, évidements) : texture(s) GPU + requêtes CPU analytiques
//   tiles.js      gestionnaire de tuiles (construction paresseuse dans un budget de temps, libération au loin)
//   ground.js     relief du sol par tuile        streets.js    voirie par tuile (+ ouvrages dénivelés, rails)
//   river.js      eau, quais, parapets, berges, ponts sur l'eau
//   buildings.js  immeubles instanciés par tuile + shader de façade procédural (facade.js)
//   vegetation.js arbres par tuile (2 LOD)       props.js      lampadaires, mobilier, plaques de rue par tuile
//   terraces.js   terrasses de café              damage.js     dégâts du décor
import { baseHeightAt, setHeightLayer } from '@shared/terrain.js';
import { qualityPreset, TiledSurf, clamp, TILE } from './util.js';
import { getProfile } from './cities/index.js';
import { createSurfaceTextures } from './textures.js';
import { createMasks } from './masks.js';
import { createSurfaceMaterial } from './surface.js';
import { createRoadNet } from './roadnet.js';
import { createLevels } from './levels.js';
import { createTileManager } from './tiles.js';
import { createGround } from './ground.js';
import { createStreets, Y_WALK } from './streets.js';
import { buildRiver } from './river.js';
import { createWaterways } from './waterways.js';
import { createBuildings } from './buildings.js';
import { createVegetation } from './vegetation.js';
import { createProps } from './props.js';
import { createDamage } from './damage.js';
import { buildTerraces } from './terraces.js';

/** Facteur de nuit 0..1 à partir de l'heure (crépuscule ~19h30-21h, aube ~5h30-7h). */
function nightFromHour(h) {
  const s = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  return Math.max(s(19.3, 20.8, h), 1 - s(5.6, 7.2, h));
}

export function createWorld(ctx) {
  const { THREE, scene, bus, collision } = ctx;
  const t0 = performance.now();
  const timings = {};
  let tl = t0;
  const lap = (name) => { const now = performance.now(); timings[name] = Math.round(now - tl); tl = now; };
  const Q = qualityPreset(ctx.quality);
  const profile = getProfile(ctx);
  // rayons de chargement : ceux du profil, bornés par la qualité
  const R = {
    ground: Math.min(profile.radii.ground, Q.viewDist), groundNear: Math.min(profile.radii.groundNear || 1500, Q.viewDist), streets: Math.min(profile.radii.streets, Q.viewDist), buildings: Math.min(profile.radii.buildings, Q.viewDist),
    trees: Math.min(profile.radii.trees, Q.treeDist + 150), props: Math.min(profile.radii.props, Q.lampDist + 100), collision: profile.radii.collision,
  };

  // ---------- index globaux (tableaux typés, coût linéaire)
  const net = createRoadNet(ctx, profile); lap('reseau');
  const levels = createLevels(ctx, net); lap('niveaux');
  const waterways = createWaterways(ctx, net, profile);
  const masks = createMasks(ctx, Q, profile, { voidQuads: levels.voidQuads, waterRibbons: waterways.ribbons }); lap('masques');

  // ---------- matériaux partagés
  const uniforms = { uNight: { value: 0 }, uLampOn: { value: 0 }, uSky: { value: new THREE.Color(0x9fb8cc) }, uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() }, uSunK: { value: 1 } };
  const tex = createSurfaceTextures(THREE, ctx.renderer, Q); lap('textures');
  const classes = masks.mode === 'classes';
  const surfMat = createSurfaceMaterial(THREE, tex, masks, uniforms, { classes });
  const farMat = createSurfaceMaterial(THREE, tex, masks, uniforms, { classes });
  farMat.polygonOffset = true; farMat.polygonOffsetFactor = 1; farMat.polygonOffsetUnits = 6; // le sol lointain passe derrière le sol proche
  const mats = { ground: surfMat, groundFar: farMat, makeGround: (fine) => createSurfaceMaterial(THREE, tex, fine, uniforms, { classes }) };

  // ---------- fleuve (construit d'un bloc : ouvrage linéaire) et canaux
  const riverSurf = new TiledSurf(1000);
  const river = buildRiver(ctx, net, riverSurf, masks, profile, levels);
  waterways.build(riverSurf, masks, river);
  const riverMeshes = [];
  for (const [, b] of riverSurf.map) {
    const geo = b.build(THREE); if (!geo) continue;
    const m = new THREE.Mesh(geo, surfMat);
    m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'sol';
    scene.add(m); riverMeshes.push(m);
  }
  riverSurf.map.clear(); lap('fleuve');

  // ---------- couches diffusées par tuile
  const bld = createBuildings(ctx, net, masks, Q, uniforms, river, profile); lap('immeubles');
  const veg = createVegetation(ctx, net, masks, river, bld, Q, profile, waterways.trees);
  const props = createProps(ctx, net, masks, river, bld, Q, uniforms, profile); lap('index');
  const terraces = buildTerraces(ctx, net, bld, river, masks, Q, uniforms, profile); lap('terrasses');
  const damage = createDamage(ctx, { props, veg, uniforms, terraces });
  const streets = createStreets(ctx, net, masks, profile, levels);
  const ground = createGround(ctx, masks, profile, mats);
  const skirt = ground.buildSkirt();

  // collisions d'une tuile : posées quand le joueur approche (rayon couvrant aussi le trafic), retirées au loin
  const colOn = (t) => {
    if (!t || t.shapes || !t.col) return;
    const sh = [];
    if (t.col instanceof Float32Array) for (let i = 0; i < t.col.length; i += 6) sh.push(collision.addBox({ x: t.col[i], z: t.col[i + 1], hw: t.col[i + 2], hd: t.col[i + 3], rot: t.col[i + 4], top: t.col[i + 5], tag: 'building' }));
    else for (const c of t.col) sh.push(c.kind === 'box' ? collision.addBox(c) : collision.addCircle(c));
    t.shapes = sh;
  };
  const colOff = (t) => {
    if (!t || !t.shapes) return;
    damage.releaseTile(t);
    for (const s of t.shapes) collision.remove(s);
    t.shapes = null;
  };
  const colRule = { radius: R.collision, hyst: 120, on: colOn, off: colOff };

  const tm = createTileManager({ size: TILE });
  tm.addLayer({ name: 'sol', radius: R.groundNear, bias: -400, has: ground.has, build: ground.build, dispose: ground.dispose, near: ground.near });
  tm.addLayer({ name: 'solLointain', size: ground.FAR, radius: R.ground, bias: -300, has: ground.hasFar, build: ground.buildFar, dispose: ground.disposeFar });
  tm.addLayer({
    name: 'rues', size: 2 * TILE, radius: R.streets, bias: -150, has: (ix, iz) => streets.hasGroup(ix, iz, 2),
    *build(ix, iz) {
      const r = yield* streets.buildTile(ix, iz, 2);
      if (!r.geo && !r.col.length) return null;
      let mesh = null;
      if (r.geo) { mesh = new THREE.Mesh(r.geo, surfMat); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.name = 'sol'; scene.add(mesh); }
      return { mesh, col: r.col, shapes: null };
    },
    dispose(t) { if (t?.mesh) { scene.remove(t.mesh); t.mesh.geometry.dispose(); } },
    near: [colRule],
  });
  tm.addLayer({ name: 'immeubles', size: bld.size, radius: R.buildings, bias: 0, has: bld.has, build: bld.buildTile, dispose: bld.dispose, near: [colRule] });
  tm.addLayer({ name: 'arbres', radius: R.trees, bias: 120, has: veg.has, build: veg.buildTile, dispose: (t) => { if (t) { damage.releaseTile(t); veg.dispose(t); } }, near: [colRule] });
  tm.addLayer({ name: 'mobilier', radius: R.props, bias: 180, has: props.has, build: props.buildTile, dispose: (t) => { if (t) { damage.releaseTile(t); props.dispose(t); } }, near: [colRule] });

  // Relief local (contrats v4 / v5) : ponts routiers, trémies, berges basses. Posée APRÈS les index : tout le sol de la
  // ville est bâti sur le relief de base (baseHeightAt).
  setHeightLayer(levels.layer);

  // ---------- premier affichage : tout ce qui entoure le point de départ est construit avant de rendre la main
  let px = 0, pz = 0;
  const tp = ctx.params?.get?.('tp'), lm = tp && ctx.LANDMARK_BY_ID?.[tp];
  if (ctx.primeAt) { px = ctx.primeAt.x; pz = ctx.primeAt.z; } else if (lm) { px = lm.x + lm.radius + 25; pz = lm.z + lm.radius + 25; }
  timings.amorce = Math.round(tm.prime(px, pz, 330, ctx.quality === 'low' ? 900 : 1600)); tl = performance.now();
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
    /** Route (objet de worldData.roads) sous le point, ou null. Avec y : la chaussée du niveau le plus proche de cette hauteur. */
    roadAt: (x, z, y) => net.roadAt(x, z, y),
    /**
     * Point de chaussée carrossable le plus proche : { x, z, y, yaw, road, dist }. 3e argument : la hauteur y de l'appelant
     * (privilégie les chaussées de ce niveau) ou des options { drivable: false (inclut les rues piétonnes), y }.
     */
    nearestRoadPoint: (x, z, a3) => net.nearestRoadPoint(x, z, a3),
    /** Point aléatoire sur une chaussée carrossable (voie de droite, hors carrefours, ponts sur l'eau et tunnels) : { x, z, y, yaw, road }. */
    randomRoadPoint: () => net.randomRoadPoint(),
    // --- contrat v2 « dégâts et impacts »
    /** Appelé par le module véhicules à chaque contact voiture/décor : { shape, tag, x, z, dirX, dirZ, speed, mass, vehicle } -> { broke, absorb }. */
    onImpact: (e) => damage.onImpact(e),
    /** Objets tombés au sol près de (x,z) : [{x, z, r, tag}]. */
    propsNear: (x, z, r) => damage.propsNear(x, z, r),
    // --- extras hors contrat (facultatifs pour les autres modules)
    /** Hauteur du revêtement pour un appelant à la hauteur y : niveaux superposés compris, + surélévation du trottoir. */
    surfaceHeightAt(x, z, y) {
      const base = baseHeightAt(x, z), h = levels.layer(x, z, base, y);
      if (h !== undefined) return h;
      const d = net.edgeDistance(x, z, false);
      return base + (d > 0.05 && d < 5 ? Y_WALK : 0);
    },
    isWater: (x, z) => masks.isWater(x, z) && !river.nearDeck(x, z, 0) && river.bergeHeight(x, z) === undefined,
    isPark: (x, z) => masks.isPark(x, z),
    inBuilding: (x, z, pad) => bld.inBuilding(x, z, pad),
    get stats() {
      const pc = props.counts();
      return { timings, city: profile.id, buildings: bld.count(), buildingsTotal: bld.total, proceduralBuildings: bld.procedural, trees: veg.count(), lamps: pc.lamps, props: pc.props, roads: net.roads.length, leveledRoads: net.leveled, levelQuads: levels.count,
        bridges: river.decks.length, bergeLen: river.bergeLen, ramps: river.ramps, stairs: river.stairs, boats: river.boats, bookstalls: river.bookstalls, terraces: terraces.count, terraceTables: terraces.tables || 0,
        plaques: props.plaque?.count || 0, tiles: tm.counts(), pending: tm.stat.pending, maxSliceMs: +tm.stat.maxSliceMs.toFixed(1), quality: ctx.quality };
    },
    _damage: damage, _maskWater: (x, z) => masks.isWater(x, z), _river: river, _terraces: terraces, _tiles: tm, _levels: levels, _net: net, _masks: masks, _profile: profile,
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
      // diffusion des tuiles autour du joueur (à défaut : de la caméra), dans le budget de temps de l'image
      const p = ctx.player?.pos, fx = p && Number.isFinite(p.x) ? p.x : cam.x, fz = p && Number.isFinite(p.z) ? p.z : cam.z;
      tm.update(fx, fz, Q.budgetMs);
      river.update(dt, night);
      waterways.update(dt, night);
      bld.update(cam);
      veg.update(cam);
      props.update(cam, night);
      damage.update(dt, night);
      terraces.update(dt);
    },
  };
  void skirt; void riverMeshes;
  console.info('[ville] ' + profile.id + ' prête en ' + timings.total + ' ms', JSON.stringify(timings));
  return world;
}

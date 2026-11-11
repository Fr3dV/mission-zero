// Module « trafic » : voitures IA sur le graphe routier, voitures garées, piétons — pour la ville courante (ctx.city).
// Tout apparaît / disparaît autour du joueur (pools recyclés). Le nombre de voitures et de piétons dépend de
// ctx.quality, de setDensity(0..1), de l'heure du jeu (pointes 7h30–9h et 17h–19h, creux la nuit) et du lieu
// (type de voies, zones de pois.areas, distance au centre).
//
// API : ctx.traffic = { update(dt), setDensity(d), ejectDriver(vehicle, {side}), cars, pedestrians, parked, trams, stats, graph }
//   cars        : véhicules IA actifs (objets du module véhicules, driver === 'ai')
//   pedestrians : états des piétons { active, x, y, z, yaw, group, idle, onRoad, ... }
//   trams       : caisses de tramway actives { active, x, y, z, fx, fz, speed } (rails kind 'tram' ; vide à Paris)
//   stats       : { cars, peds, parked, trams, ms, msMax, buildMs, graphBytes, carDens, pedDens, carTarget, pedTarget }
// Événements : écoute `env:time`, `vehicle:hit`, `vehicle:crash` ; émet `traffic:honk {x, y, z, vehicle}` et
//   `pedestrian:hit {x, y, z, speed, vehicle, severity: 'bump'|'knockdown', pedestrian}`.
import { buildGraph, F_SERVICE, F_NOAI } from './graph.js';
import { buildAreas, A_NOGO } from './areas.js';
import { createCars } from './cars.js';
import { createPedestrians } from './pedestrians.js';
import { createTrams } from './trams.js';

const BASE = {
  low: { cars: 12, peds: 15, parked: 5 },
  medium: { cars: 24, peds: 32, parked: 9 },
  high: { cars: 35, peds: 50, parked: 14 },
};

// Réglages par ville (aucune coordonnée en dur : les distances sont comptées depuis l'origine du repère de la ville).
//   centreR / pedCentreR : rayon de l'hypercentre (trafic / piétons à pleine densité) ; outerR : distance où l'on atteint
//   la densité de périphérie (outerCars, outerPeds) ; exitProb : part des voitures qui prennent la prochaine sortie
//   d'une voie rapide ; types : composition du parc roulant ; parkTypes : voitures garées.
const TUNE = {
  default: {
    centreR: 1e9, pedCentreR: 1e9, outerR: 2e9, outerCars: 1, outerPeds: 1, exitProb: 0.3,
    types: [['citadine', 46], ['taxi', 28], ['tesla_model3', 9], ['porsche_cayenne', 7], ['tesla_models', 2.5], ['porsche_taycan', 2],
      ['tesla_cybertruck', 1.2], ['porsche_911', 1.3], ['lambo_urus', 1.2], ['lambo_huracan', 1], ['lambo_aventador', 0.5]],
    parkTypes: ['citadine', 'citadine', 'citadine', 'tesla_model3', 'porsche_cayenne', 'taxi', 'tesla_models', 'porsche_taycan'],
  },
  // Toulouse : hypercentre resserré autour de l'origine, proche banlieue pavillonnaire et zones d'activités ;
  // plus de citadines et de gros gabarits « utilitaires », très peu de taxis et de supercars.
  toulouse: {
    centreR: 1800, pedCentreR: 1300, outerR: 6500, outerCars: 0.5, outerPeds: 0.18, exitProb: 0.3,
    types: [['citadine', 64], ['porsche_cayenne', 9], ['tesla_model3', 9], ['taxi', 6], ['tesla_cybertruck', 5], ['tesla_models', 1.5], ['porsche_taycan', 1],
      ['lambo_urus', 0.6], ['porsche_911', 0.5], ['lambo_huracan', 0.25], ['lambo_aventador', 0.1]],
    parkTypes: ['citadine', 'citadine', 'citadine', 'citadine', 'tesla_model3', 'porsche_cayenne', 'tesla_cybertruck', 'porsche_cayenne'],
  },
};

// Courbes horaires (heure, facteur), interpolées linéairement.
const CAR_CURVE = [0, 0.22, 5, 0.22, 6.5, 0.55, 7.5, 1.1, 9, 1.1, 10, 0.9, 12, 0.95, 14, 0.9, 16.5, 0.95, 17, 1.1, 19, 1.1, 20, 0.75, 22, 0.45, 23.5, 0.25, 24, 0.22];
const PED_CURVE = [0, 0.12, 5.5, 0.12, 7.5, 0.6, 9, 0.8, 12, 1.05, 14, 1, 17, 1.05, 19.5, 0.9, 21.5, 0.6, 23.5, 0.2, 24, 0.12];
const RUSH_CURVE = [0, 0.3, 6, 0.4, 7.5, 1, 9, 1, 10, 0.7, 16.5, 0.75, 17, 1, 19, 1, 20, 0.6, 23, 0.35, 24, 0.3];
function curve(c, h) {
  h = ((h % 24) + 24) % 24;
  for (let i = 2; i < c.length; i += 2) if (h <= c[i]) { const t = (h - c[i - 2]) / (c[i] - c[i - 2] || 1); return c[i - 1] + (c[i + 1] - c[i - 1]) * t; }
  return c[c.length - 1];
}

export function createTraffic(ctx) {
  const base = BASE[ctx.quality] || BASE.high;
  const G = buildGraph(ctx.worldData || {});
  const stats = { cars: 0, peds: 0, parked: 0, trams: 0, ms: 0, msMax: 0, buildMs: G.buildMs, graphBytes: G.bytes, carDens: 0, pedDens: 0, carTarget: 0, pedTarget: 0 };
  if (!G.edgeCount) return { update() {}, setDensity() {}, ejectDriver() { return false; }, cars: [], pedestrians: [], parked: [], stats, graph: G };

  const tA = performance.now();
  const areas = buildAreas(ctx.worldData || {});
  // voies de desserte situées côté pistes de l'aéroport (ou dans une emprise ferroviaire, un chantier…) : aucune voiture IA
  if (areas.count) {
    const { hFlag, hFrom, hTo, nx, nz, eCars } = G;
    for (let e = 0; e < G.edgeCount; e++) {
      const h = 2 * e;
      if (!(hFlag[h] & F_SERVICE)) continue;
      if (areas.kindAt((nx[hFrom[h]] + nx[hTo[h]]) / 2, (nz[hFrom[h]] + nz[hTo[h]]) / 2) === A_NOGO) { hFlag[h] |= F_NOAI; hFlag[h + 1] |= F_NOAI; eCars[e] = 0; }
    }
  }
  stats.buildMs += performance.now() - tA;

  const cityId = ctx.city && ctx.city.id;
  const T = {
    ctx, G, areas, tune: TUNE[cityId] || TUNE.default, owner: new Map(), peds: null, now: 0,
    fx: 0, fy: 0, fz: 0, vF: 0, vdx: 0, vdz: -1, bias: 0,           // point de référence (joueur) et sa vitesse lissée
    SPAWN_MIN: 120, SPAWN_MAX: 300, DESPAWN: 350, PED_RADIUS: 150, MAX_CARS: 80, MAX_PEDS: 120,
    night: false, rush: 0.75, carDens: 0.4, pedDens: 0.7, fastShare: 0, fixedRing: false,
    inView,
  };
  // Caméra (mise en cache une fois par frame) pour le test « hors champ ».
  const dir = new ctx.THREE.Vector3();
  let cpx = 0, cpy = 0, cpz = 0, cdx = 0, cdy = 0, cdz = -1;
  /** Approximation : le point (x, y, z) est-il dans le champ de la caméra, à moins de 260 m ? */
  function inView(x, z, y) {
    const dx = x - cpx, dy = (y || 0) - cpy, dz = z - cpz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 260) return false;
    if (d < 12) return true;
    return (dx * cdx + dy * cdy + dz * cdz) / d > 0.45;
  }

  const hasVehicles = !!(ctx.vehicles && ctx.vehicles.spawn && ctx.vehicles.list);
  const cars = hasVehicles ? createCars(T) : null;
  let peds = null;
  try { peds = createPedestrians(T); } catch (e) { console.warn('[traffic] piétons désactivés', e); }
  let trams = null;
  try { trams = createTrams(T); } catch (e) { console.warn('[traffic] tramways désactivés', e); }

  const urlD = ctx.params && ctx.params.get && ctx.params.get('traffic');
  let density = urlD != null && urlD !== '' && isFinite(+urlD) ? Math.max(0, Math.min(1, +urlD)) : 1;
  let carTime = 0.95, pedTime = 1, burstT = 2.5, lastFx = NaN, lastFz = NaN, probeT = 0, fastNum = 0, fastDen = 0;
  const probe = { e: 0, s: 0, x: 0, z: 0 };

  function applyTargets() {
    // le lieu : moyenne glissante de la densité des voies / trottoirs alentour (sondée en continu, voir update)
    const kc = Math.max(0.28, Math.min(1.15, 0.3 + T.carDens * 1.75)), kp = Math.max(0.03, Math.min(1.1, 0.02 + T.pedDens * 1.2));
    const fast = T.vF > 20 ? 1.2 : 1; // sur voie rapide, le rayon d'apparition est bien plus grand
    stats.carTarget = Math.round(base.cars * density * carTime * kc * fast);
    stats.pedTarget = Math.round(base.peds * density * pedTime * kp);
    if (cars) cars.setTargets(stats.carTarget, Math.round(base.parked * Math.min(1, density * 1.5)));
    if (peds) peds.setTarget(stats.pedTarget);
  }
  function setTime(hour, night) {
    if (typeof hour === 'number' && isFinite(hour)) {
      carTime = curve(CAR_CURVE, hour); pedTime = curve(PED_CURVE, hour); T.rush = curve(RUSH_CURVE, hour);
      T.night = hour < 6 || hour >= 21;
    } else { carTime = night ? 0.4 : 0.95; pedTime = night ? 0.3 : 1; T.rush = night ? 0.35 : 0.75; T.night = !!night; }
    applyTargets();
  }
  ctx.bus.on('env:time', (e) => { if (e) setTime(e.hour, e.night); });
  // Dégâts (contrat v2) : une voiture IA percutée est rendue à la physique locale, puis reprise ou laissée en épave.
  ctx.bus.on('vehicle:hit', (e) => { if (cars && e) cars.onHit(e); });
  ctx.bus.on('vehicle:crash', (e) => { if (cars && e) cars.onCrash(e); });
  try {
    const h0 = ctx.store && ctx.store.timeOfDay;
    if (typeof h0 === 'number') setTime(h0, false); else if (ctx.env && ctx.env.isNight) setTime(undefined, ctx.env.isNight());
  } catch (e) { /* env pas prêt */ }
  applyTargets();

  function update(dt) {
    const t0 = performance.now();
    T.now += dt;
    // point de référence : le joueur, sinon la caméra
    const cam = ctx.camera, p = ctx.player && ctx.player.pos;
    if (p && isFinite(p.x) && isFinite(p.z)) { T.fx = p.x; T.fz = p.z; T.fy = isFinite(p.y) ? p.y : 0; } else { T.fx = cam.position.x; T.fz = cam.position.z; T.fy = 0; }
    cam.getWorldDirection(dir);
    cpx = cam.position.x; cpy = cam.position.y; cpz = cam.position.z; cdx = dir.x; cdy = dir.y; cdz = dir.z;
    // démarrage ou téléportation : on peuple vite, y compris dans le champ
    const jx = T.fx - lastFx, jz = T.fz - lastFz, jump = Math.abs(jx) + Math.abs(jz);
    if (!(jump < 150)) { burstT = 2.5; T.vF = 0; }
    else if (dt > 1e-4) {
      // vitesse lissée du joueur : rayons d'apparition / disparition plus grands et flux vers l'avant quand il roule vite
      const v = Math.hypot(jx, jz) / dt;
      T.vF += (v - T.vF) * Math.min(1, dt * 2);
      if (v > 3) { const il = 1 / (v * dt); T.vdx += (jx * il - T.vdx) * Math.min(1, dt * 3); T.vdz += (jz * il - T.vdz) * Math.min(1, dt * 3); }
    }
    lastFx = T.fx; lastFz = T.fz;
    if (!T.fixedRing) {
      T.SPAWN_MAX = 300 + Math.min(330, T.vF * 9);
      T.DESPAWN = T.SPAWN_MAX + 50;
    }
    T.bias = T.vF > 10 ? 0.65 : 0;
    const burst = burstT > 0;
    if (burst) burstT -= dt;

    // sonde de densité du lieu (une arête au hasard autour du joueur, quelques fois par seconde)
    if ((probeT -= dt) <= 0) {
      probeT = 0.12;
      if (G.randomEdgeNear(T.fx, T.fz, 0, 190, probe, 2)) {
        if (cars && (G.hDrive[2 * probe.e] || G.hDrive[2 * probe.e + 1])) {
          const w = cars.carWeight(probe.e, probe.x, probe.z), fast = G.hFlag[2 * probe.e] & 8 ? 1 : 0;
          T.carDens += (w - T.carDens) * 0.05;
          fastNum += (w * fast - fastNum) * 0.05; fastDen += (w - fastDen) * 0.05;
          T.fastShare = fastDen > 1e-4 ? Math.min(1, fastNum / fastDen) : 0; // part du trafic attendue sur les voies rapides alentour
        }
        if (peds && (probe.x - T.fx) ** 2 + (probe.z - T.fz) ** 2 < 150 * 150) T.pedDens += (peds.probe(probe.x, probe.z) - T.pedDens) * 0.05;
      }
      applyTargets();
    }

    if (cars) cars.update(dt, burst);
    if (peds) peds.update(dt, burst);
    if (trams) trams.update(dt);

    if (cars) { stats.cars = cars.activeCount; stats.parked = cars.parked.length; }
    if (peds) stats.peds = peds.activeCount;
    if (trams) stats.trams = trams.active;
    stats.carDens = T.carDens; stats.pedDens = T.pedDens;
    const ms = performance.now() - t0;
    stats.ms += (ms - stats.ms) * 0.05;
    if (ms > stats.msMax) stats.msMax = ms;
  }

  return {
    update,
    /** Vol de voiture (contrat v3) : relâche une voiture conduite par l'IA et fait descendre son conducteur. */
    ejectDriver(vehicle, opts) { return cars ? cars.ejectDriver(vehicle, opts) : false; },
    setDensity(d) { density = Math.max(0, Math.min(1, +d || 0)); applyTargets(); },
    cars: cars ? cars.active : [],
    pedestrians: peds ? peds.list : [],
    parked: cars ? cars.parked : [],
    stats, graph: G,
    trams: trams ? trams.list : [],
    _debug: { T, cars, peds, areas, trams },
    dispose() { if (cars) cars.dispose(); if (peds) peds.dispose(); if (trams && trams.dispose) trams.dispose(); },
  };
}

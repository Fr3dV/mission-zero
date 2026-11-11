// Module « trafic » : voitures IA sur le graphe routier, voitures garées, piétons sur les trottoirs.
// Tout apparaît / disparaît autour du joueur (pools recyclés), avec une densité selon ctx.quality,
// setDensity(0..1) et l'heure (moins de monde la nuit).
//
// API : ctx.traffic = { update(dt), setDensity(d), ejectDriver(vehicle, {side}), cars, pedestrians, parked, stats, graph }
//   cars        : véhicules IA actifs (objets du module véhicules, driver === 'ai')
//   pedestrians : états des piétons { active, x, y, z, yaw, group, idle, onRoad, ... }
// Événements : écoute `env:time`, `vehicle:hit`, `vehicle:crash` ; émet `traffic:honk {x, z, vehicle}` et
//   `pedestrian:hit {x, z, speed, vehicle, severity: 'bump'|'knockdown', pedestrian}`.
import { buildGraph } from './graph.js';
import { createCars } from './cars.js';
import { createPedestrians } from './pedestrians.js';

const BASE = {
  low: { cars: 12, peds: 15, parked: 5 },
  medium: { cars: 24, peds: 32, parked: 9 },
  high: { cars: 35, peds: 50, parked: 14 },
};

export function createTraffic(ctx) {
  const base = BASE[ctx.quality] || BASE.high;
  const G = buildGraph(ctx.worldData || {});
  const stats = { cars: 0, peds: 0, parked: 0, ms: 0, msMax: 0 };
  if (!G.edgeCount) return { update() {}, setDensity() {}, ejectDriver() { return false; }, cars: [], pedestrians: [], parked: [], stats, graph: G };

  const T = {
    ctx, G, owner: new Map(), peds: null, now: 0, fx: 0, fz: 0,
    SPAWN_MIN: 120, SPAWN_MAX: 300, DESPAWN: 350, PED_RADIUS: 150, MAX_CARS: 80, MAX_PEDS: 120,
    inView,
  };
  // Caméra (mise en cache une fois par frame) pour le test « hors champ ».
  const dir = new ctx.THREE.Vector3();
  let cpx = 0, cpy = 0, cpz = 0, cdx = 0, cdy = 0, cdz = -1;
  /** Approximation : le point au sol (x, z) est-il dans le champ de la caméra, à moins de 260 m ? */
  function inView(x, z) {
    const dx = x - cpx, dy = -cpy, dz = z - cpz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 260) return false;
    if (d < 12) return true;
    return (dx * cdx + dy * cdy + dz * cdz) / d > 0.45;
  }

  const hasVehicles = !!(ctx.vehicles && ctx.vehicles.spawn && ctx.vehicles.list);
  const cars = hasVehicles ? createCars(T) : null;
  let peds = null;
  try { peds = createPedestrians(T); } catch (e) { console.warn('[traffic] piétons désactivés', e); }

  const urlD = ctx.params && ctx.params.get && ctx.params.get('traffic');
  let density = urlD != null && urlD !== '' && isFinite(+urlD) ? Math.max(0, Math.min(1, +urlD)) : 1;
  let nightFactor = 1, burstT = 2.5, lastFx = NaN, lastFz = NaN;

  function applyTargets() {
    const k = density * nightFactor;
    if (cars) cars.setTargets(Math.round(base.cars * k), Math.round(base.parked * Math.min(1, density * 1.5)));
    if (peds) peds.setTarget(Math.round(base.peds * k * (nightFactor < 1 ? 0.8 : 1)));
  }
  function setNight(hour, night) {
    if (typeof hour === 'number' && (hour < 5.5 || hour >= 23.5)) nightFactor = 0.25; // nuit profonde
    else nightFactor = night ? 0.45 : 1;
    applyTargets();
  }
  ctx.bus.on('env:time', (e) => { if (e) setNight(e.hour, e.night); });
  // Dégâts (contrat v2) : une voiture IA percutée est rendue à la physique locale, puis reprise ou laissée en épave.
  ctx.bus.on('vehicle:hit', (e) => { if (cars && e) cars.onHit(e); });
  ctx.bus.on('vehicle:crash', (e) => { if (cars && e) cars.onCrash(e); });
  try { if (ctx.env && ctx.env.isNight) setNight(ctx.store && ctx.store.timeOfDay, ctx.env.isNight()); } catch (e) { /* env pas prêt */ }
  applyTargets();

  function update(dt) {
    const t0 = performance.now();
    T.now += dt;
    // point de référence : le joueur, sinon la caméra
    const cam = ctx.camera, p = ctx.player && ctx.player.pos;
    if (p && isFinite(p.x) && isFinite(p.z)) { T.fx = p.x; T.fz = p.z; } else { T.fx = cam.position.x; T.fz = cam.position.z; }
    cam.getWorldDirection(dir);
    cpx = cam.position.x; cpy = cam.position.y; cpz = cam.position.z; cdx = dir.x; cdy = dir.y; cdz = dir.z;
    // démarrage ou téléportation : on peuple vite, y compris dans le champ
    if (!(Math.abs(T.fx - lastFx) + Math.abs(T.fz - lastFz) < 150)) burstT = 2.5;
    lastFx = T.fx; lastFz = T.fz;
    const burst = burstT > 0;
    if (burst) burstT -= dt;

    if (cars) cars.update(dt, burst);
    if (peds) peds.update(dt, burst);

    if (cars) { stats.cars = cars.activeCount; stats.parked = cars.parked.length; }
    if (peds) stats.peds = peds.activeCount;
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
    _debug: { T, cars, peds },
    dispose() { if (cars) cars.dispose(); if (peds) peds.dispose(); },
  };
}

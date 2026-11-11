// Point d'entrée : crée le contexte partagé (ctx), initialise les modules, lance la boucle.
// PROPRIÉTAIRE : intégrateur. Les agents ne modifient PAS ce fichier (ils remplacent leur module).
import * as THREE from 'three';
import { bus } from './core/bus.js';
import { store } from './core/store.js';
import { collision } from './core/collision.js';
import { heightAt, WATER_LEVEL, setHeightmap } from '@shared/terrain.js';
import { CITY, CITIES } from '@shared/cities.js';
import { LANDMARKS, LANDMARK_BY_ID } from '@shared/landmarks.js';
import { BOUNDS } from '@shared/geo.js';

import { createEnvironment } from './env/index.js';
import { createWorld } from './world/index.js';
import { createMonuments } from './monuments/index.js';
import { createVehicles } from './vehicles/index.js';
import { createPlayer } from './player/index.js';
import { createTraffic } from './traffic/index.js';
import { createGameplay } from './gameplay/index.js';
import { createNet } from './net/index.js';
import { createUI } from './ui/index.js';
import { createAudio } from './audio/index.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 9000);
camera.position.set(0, 30, 80);

async function loadJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
// Charge les données de la ville courante (CITY.files). Tout est optionnel sauf les routes :
// sans fichier de routes, on retombe sur le petit jeu d'essai paris.sample.json.
async function loadBuildings(url) {
  if (!url) return null;
  if (url.endsWith('.bin')) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return new Float32Array(await r.arrayBuffer()); }
  return (await loadJSON(url)).buildings;
}
async function loadBytes(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return new Uint8Array(await r.arrayBuffer()); }
async function loadWorldData() {
  const f = CITY.files;
  const jobs = {
    roads: () => loadJSON(f.roads),
    buildings: () => loadBuildings(f.buildings),
    pois: () => (f.pois ? loadJSON(f.pois) : null),
    buildingsMeta: () => (f.buildingsMeta ? loadJSON(f.buildingsMeta) : null),
    buildingsMetaBin: () => (f.buildingsMetaBin ? loadBytes(f.buildingsMetaBin) : null),
    terrain: () => (f.terrain ? loadJSON(f.terrain) : null),
  };
  const names = Object.keys(jobs), out = {};
  let done = 0;
  bus.emit('boot:progress', { step: 'data', city: CITY.id, done, total: names.length });
  await Promise.all(names.map(async (n) => {
    try { out[n] = await jobs[n](); } catch { out[n] = null; }
    bus.emit('boot:progress', { step: 'data', city: CITY.id, file: n, done: ++done, total: names.length });
  }));
  let data = out.roads;
  if (!data) { console.warn(`[${CITY.id}] ${f.roads} absent, utilisation de paris.sample.json`); data = await loadJSON('/shared/world/paris.sample.json'); }
  data.buildings = out.buildings; // tableau plat (Array ou Float32Array) : cx, cz, w, d, rotDeg, h par bâtiment, ou null
  data.pois = out.pois;
  data.buildingsMeta = out.buildingsMeta; // légende (et, à Paris, table byIndex)
  data.buildingsMetaBin = out.buildingsMetaBin; // Uint8Array aligné sur l'ordre des bâtiments, ou null
  data.terrain = out.terrain;
  if (out.terrain) setHeightmap(out.terrain); // avant l'init des modules : ctx.heightAt en dépend
  return data;
}

const ctx = {
  THREE, renderer, scene, camera, canvas, bus, store, collision, params,
  uiRoot: document.getElementById('ui-root'),
  heightAt, WATER_LEVEL, LANDMARKS, LANDMARK_BY_ID, BOUNDS,
  city: CITY, cities: CITIES, // ville courante (?city=) et registre des villes
  quality: params.get('quality') || 'high', // 'low' | 'medium' | 'high'
  worldData: null,
  time: 0, // secondes écoulées
  // remplis ci-dessous : env, world, monuments, vehicles, player, traffic, gameplay, net, ui, audio
};
window.__game = ctx;

const ORDER = [
  ['env', createEnvironment], ['world', createWorld], ['monuments', createMonuments],
  ['vehicles', createVehicles], ['player', createPlayer], ['traffic', createTraffic],
  ['gameplay', createGameplay], ['net', createNet], ['ui', createUI], ['audio', createAudio],
];
// Ordre de mise à jour par frame.
const UPDATE = ['player', 'vehicles', 'traffic', 'gameplay', 'net', 'world', 'monuments', 'env', 'audio', 'ui'];

async function boot() {
  document.title = `Mission Zéro — ${CITY.name}`;
  ctx.worldData = await loadWorldData();
  for (const [name, create] of ORDER) {
    bus.emit('boot:progress', { step: name });
    try { ctx[name] = (await create(ctx)) || {}; }
    catch (e) { console.error(`[boot] module ${name}`, e); ctx[name] = {}; }
  }
  const tp = params.get('tp');
  if (tp && LANDMARK_BY_ID[tp]) {
    const l = LANDMARK_BY_ID[tp];
    const r = ctx.world.nearestRoadPoint?.(l.x + l.radius + 25, l.z + l.radius + 25);
    ctx.player.teleport?.(r?.x ?? l.x + l.radius + 25, r?.z ?? l.z + l.radius + 25, Math.atan2(-(l.x - (r?.x ?? l.x)), -(l.z - (r?.z ?? l.z - 1))));
  }
  bus.emit('boot:done');
  if (params.get('autostart')) bus.emit('intent:login', { name: params.get('name') || 'Test', room: params.get('room') || CITY.id });

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    bus.emit('resize', { w: innerWidth, h: innerHeight });
  });

  let last = performance.now(), acc = 0, frames = 0;
  ctx.fps = 60;
  renderer.setAnimationLoop((now) => {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    ctx.time += dt; acc += dt; frames++;
    if (acc >= 0.5) { ctx.fps = frames / acc; acc = 0; frames = 0; }
    for (const name of UPDATE) {
      try { ctx[name].update?.(dt); } catch (e) { if (!ctx[name]._err) { ctx[name]._err = true; console.error(`[update] ${name}`, e); } }
    }
    if (ctx.env.render) ctx.env.render(dt); else renderer.render(scene, camera);
  });
}
boot();

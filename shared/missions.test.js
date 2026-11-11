// Validation des données de jeu (missions, biens) — lancé par `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MISSIONS, MISSION_BY_ID, MISSION_TYPES, LEVELS, ROUTE_M, levelForMissionsDone, missionPathLength, missionRouteLength } from './missions.js';
import { PROPERTIES, PROPERTY_BY_ID, PROPERTY_KINDS, SELL_BACK_RATIO } from './properties.js';
import { VEHICLES, VEHICLE_BY_ID, STARTING_MONEY } from './catalog.js';
import { BOUNDS } from './geo.js';

const inBounds = (p) => p.x >= BOUNDS.minX && p.x <= BOUNDS.maxX && p.z >= BOUNDS.minZ && p.z <= BOUNDS.maxZ;
const MAX_SPEED = Math.max(...VEHICLES.map((v) => v.maxSpeed));
const STEP_KINDS = ['goto', 'checkpoint', 'pickup', 'dropoff', 'stop', 'photo'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

test('missions : au moins 20, ids uniques, index cohérent', () => {
  assert.ok(MISSIONS.length >= 20, `seulement ${MISSIONS.length} missions`);
  const ids = MISSIONS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'ids de mission en double');
  for (const m of MISSIONS) assert.equal(MISSION_BY_ID[m.id], m);
});

test('missions : champs requis et types valides', () => {
  for (const m of MISSIONS) {
    const where = `mission ${m.id}`;
    assert.match(m.id, /^[a-z0-9_]+$/, where);
    for (const k of ['title', 'description', 'type']) assert.ok(typeof m[k] === 'string' && m[k].length > 2, `${where}: ${k}`);
    assert.ok(MISSION_TYPES[m.type], `${where}: type inconnu ${m.type}`);
    assert.ok(m.giver?.name, `${where}: giver`);
    for (const k of ['reward', 'minDurationSec', 'cooldownSec', 'level']) assert.ok(isNum(m[k]), `${where}: ${k}`);
    assert.ok(Number.isInteger(m.reward) && m.reward >= 500 && m.reward <= 60000, `${where}: reward ${m.reward}`);
    assert.ok(m.cooldownSec >= 30, `${where}: cooldown`);
    assert.ok(m.level >= 1 && m.level <= LEVELS.length, `${where}: level`);
    assert.ok(isNum(m.start?.x) && isNum(m.start?.z), `${where}: start`);
    assert.ok(Array.isArray(m.steps) && m.steps.length >= 1, `${where}: steps`);
    for (const [i, s] of m.steps.entries()) {
      assert.ok(isNum(s.x) && isNum(s.z) && isNum(s.radius) && s.radius >= 6, `${where}: étape ${i}`);
      assert.ok(typeof s.label === 'string' && s.label.length > 2, `${where}: label étape ${i}`);
      assert.ok(STEP_KINDS.includes(s.kind), `${where}: kind étape ${i}`);
      if (s.lookAt) assert.ok(isNum(s.lookAt.x) && isNum(s.lookAt.z), `${where}: lookAt étape ${i}`);
      if (s.kind === 'pickup' || s.kind === 'dropoff' || s.kind === 'stop') assert.ok(m.requireVehicle, `${where}: arrêt sans requireVehicle`);
    }
    if (m.vehicle) assert.ok(VEHICLE_BY_ID[m.vehicle.typeId], `${where}: véhicule inconnu`);
    if (m.type === 'taxi') {
      assert.equal(m.steps[0].kind, 'pickup', `${where}: un taxi commence par un pickup`);
      assert.equal(m.steps.at(-1).kind, 'dropoff', `${where}: un taxi finit par un dropoff`);
      assert.ok(m.passenger?.name, `${where}: passager`);
    }
    if (m.type === 'convoy') assert.ok(m.vehicle?.provided && isNum(m.maxDamage), `${where}: convoyage sans véhicule/dégâts`);
    if (m.type === 'race') assert.ok(m.timeLimitSec || m.legTimeSec, `${where}: course sans chrono`);
  }
});

test('missions : positions dans les limites de la carte', () => {
  for (const m of MISSIONS) {
    assert.ok(inBounds(m.start), `mission ${m.id}: départ hors carte`);
    for (const [i, s] of m.steps.entries()) assert.ok(inBounds(s), `mission ${m.id}: étape ${i} hors carte`);
  }
});

test('missions : minDurationSec est une borne basse honnête, les chronos sont tenables', () => {
  for (const m of MISSIONS) {
    const len = missionPathLength(m);
    const holds = m.steps.reduce((t, s) => t + (s.holdSec || 0), 0);
    const vmax = m.vehicle?.provided ? VEHICLE_BY_ID[m.vehicle.typeId].maxSpeed : MAX_SPEED;
    // durée la plus rapide imaginable : ligne droite à la vitesse de pointe + arrêts imposés
    const fastest = len / vmax + holds;
    assert.ok(m.minDurationSec > 0, `mission ${m.id}: minDurationSec nul`);
    assert.ok(m.minDurationSec <= fastest, `mission ${m.id}: minDurationSec ${m.minDurationSec}s > durée la plus rapide ${fastest.toFixed(1)}s`);
    // durée réaliste (route ≈ 1,4 × vol d'oiseau, 25 m/s de moyenne en supercar) : large marge
    const realistic = (len * 1.4) / 25 + holds;
    assert.ok(m.minDurationSec <= realistic * 0.75, `mission ${m.id}: minDurationSec trop proche du réaliste`);
    if (typeof m.timeLimitSec === 'number') {
      assert.ok(m.timeLimitSec > m.minDurationSec * 1.5, `mission ${m.id}: chrono intenable`);
      // tenable avec la voiture fournie, sinon la voiture de départ (niveaux 1-2) ou une première Tesla :
      // allure moyenne exigée sur la distance routière ≤ 45 % de la vitesse de pointe
      const car = m.vehicle?.provided ? VEHICLE_BY_ID[m.vehicle.typeId] : m.level <= 2 ? VEHICLE_BY_ID.citadine : VEHICLE_BY_ID.tesla_model3;
      const needed = missionRouteLength(m) / (m.timeLimitSec - holds);
      assert.ok(needed <= car.maxSpeed * 0.45, `mission ${m.id}: allure exigée ${needed.toFixed(1)} m/s trop élevée pour ${car.id}`);
      assert.ok(needed >= 5, `mission ${m.id}: chrono sans enjeu (${needed.toFixed(1)} m/s)`);
    }
    if (m.legTimeSec) for (const s of m.steps) assert.ok(s.legTimeSec >= 10, `mission ${m.id}: chrono d'étape`);
  }
});

test('missions : progression et équilibrage', () => {
  assert.equal(levelForMissionsDone(0), 1);
  assert.equal(levelForMissionsDone(LEVELS.at(-1).missionsDone), LEVELS.length);
  const byLevel = (lv) => MISSIONS.filter((m) => m.level === lv);
  let prevAvg = 0;
  for (const l of LEVELS) {
    const ms = byLevel(l.level);
    assert.ok(ms.length >= 3, `niveau ${l.level}: ${ms.length} missions`);
    const avg = ms.reduce((t, m) => t + m.reward, 0) / ms.length;
    assert.ok(avg > prevAvg, `niveau ${l.level}: récompense moyenne non croissante`);
    prevAvg = avg;
  }
  // assez de missions de niveau 1 pour débloquer le niveau 2 sans attendre un cooldown
  assert.ok(byLevel(1).length >= LEVELS[1].missionsDone);
  const rewards = MISSIONS.map((m) => m.reward);
  assert.ok(Math.min(...rewards) <= 1000 && Math.max(...rewards) === 60000);
  // la première Tesla demande un vrai effort (> 10 missions de début) mais reste atteignable
  const tesla = VEHICLE_BY_ID.tesla_model3.price - STARTING_MONEY;
  const early = byLevel(1).concat(byLevel(2), byLevel(3));
  const avgEarly = early.reduce((t, m) => t + m.reward, 0) / early.length;
  const n = tesla / avgEarly;
  assert.ok(n >= 8 && n <= 25, `Tesla en ${n.toFixed(1)} missions de début`);
  // les 7 types sont représentés
  for (const t of Object.keys(MISSION_TYPES)) assert.ok(MISSIONS.some((m) => m.type === t), `aucun ${t}`);
});

test('biens : contrat, unicité, limites, prix et loyers cohérents', () => {
  assert.ok(PROPERTIES.length >= 28 && PROPERTIES.length <= 40);
  const ids = PROPERTIES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'ids de bien en double');
  for (const p of PROPERTIES) {
    const where = `bien ${p.id}`;
    assert.equal(PROPERTY_BY_ID[p.id], p);
    assert.ok(typeof p.name === 'string' && p.name.length > 3, where);
    assert.ok(PROPERTY_KINDS[p.kind], `${where}: kind ${p.kind}`);
    for (const k of ['price', 'income', 'lat', 'lon', 'x', 'z']) assert.ok(isNum(p[k]), `${where}: ${k}`);
    assert.ok(inBounds(p), `${where}: hors carte`);
    assert.ok(p.price >= 15000 && p.price <= 5000000, `${where}: prix`);
    const ratio = p.income / p.price;
    assert.ok(ratio >= 0.005 && ratio <= 0.0101, `${where}: rendement horaire ${(ratio * 100).toFixed(2)} %`);
    assert.ok(Number.isInteger(p.garageSlots) && p.garageSlots >= 0, `${where}: garageSlots`);
  }
  // deux biens ne partagent pas le même emplacement
  for (let i = 0; i < PROPERTIES.length; i++) for (let j = i + 1; j < PROPERTIES.length; j++) {
    const a = PROPERTIES[i], b = PROPERTIES[j];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 25, `${a.id} et ${b.id} trop proches`);
  }
  for (const k of Object.keys(PROPERTY_KINDS)) assert.ok(PROPERTIES.some((p) => p.kind === k), `aucun bien de type ${k}`);
  assert.ok(SELL_BACK_RATIO > 0 && SELL_BACK_RATIO < 1);
  // un premier bien est abordable après quelques missions, le plus cher est un objectif long
  assert.ok(Math.min(...PROPERTIES.map((p) => p.price)) <= 20000);
  assert.ok(Math.max(...PROPERTIES.map((p) => p.price)) === 5000000);
});

// Vérifie la table ROUTE_M contre le vrai graphe routier (ignoré tant que paris.json n'est pas généré).
const PARIS = new URL('./world/paris.json', import.meta.url);
test('missions : distances routières à jour et étapes proches d\'une chaussée', { skip: !existsSync(PARIS) && 'paris.json absent' }, async () => {
  const { createRouter, createRoadIndex } = await import('../client/src/gameplay/gps.js');
  const wd = JSON.parse(readFileSync(PARIS, 'utf8'));
  const router = createRouter(wd), roads = createRoadIndex(wd);
  assert.ok(router.nodeCount > 100);
  for (const m of MISSIONS) {
    for (const [i, s] of [m.start, ...m.steps].entries()) {
      if (s.snap === false) continue;
      const n = roads.nearest(s.x, s.z, 400);
      assert.ok(n && n.dist <= 160, `mission ${m.id}: point ${i} à ${n ? n.dist.toFixed(0) : '∞'} m d'une chaussée`);
    }
    if (m.anyOrder) continue;
    const table = ROUTE_M[m.id];
    assert.ok(table && table.length === m.steps.length, `mission ${m.id}: ROUTE_M manquant`);
    // la table peut dater d'une génération précédente de paris.json : on tolère 25 % d'écart sur le total
    let prev = m.start, real = 0;
    for (const s of m.steps) { real += router.route(prev.x, prev.z, s.x, s.z).length; prev = s; }
    const total = table.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(real - total) <= Math.max(150, real * 0.25), `mission ${m.id}: route réelle ${real.toFixed(0)} m, table ${total} m — régénérer ROUTE_M`);
    // le chrono reste tenable sur le vrai réseau (allure moyenne ≤ 50 % de la vitesse de pointe)
    if (typeof m.timeLimitSec === 'number') {
      const holds = m.steps.reduce((t, s) => t + (s.holdSec || 0), 0);
      const car = m.vehicle?.provided ? VEHICLE_BY_ID[m.vehicle.typeId] : m.level <= 2 ? VEHICLE_BY_ID.citadine : VEHICLE_BY_ID.tesla_model3;
      const needed = real / (m.timeLimitSec - holds);
      assert.ok(needed <= car.maxSpeed * 0.5, `mission ${m.id}: ${needed.toFixed(1)} m/s exigés sur le réseau réel`);
    }
  }
  for (const p of PROPERTIES) {
    const n = roads.nearest(p.x, p.z, 400);
    assert.ok(n && n.dist <= 120, `bien ${p.id}: à ${n ? n.dist.toFixed(0) : '∞'} m d'une chaussée`);
  }
});

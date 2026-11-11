// Validation des données de jeu (missions, biens, lieux) de TOUTES les villes — lancé par `node --test`.
// Les tests liés au réseau routier d'une ville s'activent quand son fichier de routes existe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as M from './missions.js';
import * as P from './properties.js';
import { LEVELS as BASE_LEVELS, MISSION_TYPES, STEP_KINDS, PROPERTY_KINDS, SELL_BACK_RATIO, levelForMissionsDone, missionPathLength, missionRouteLength, missionMinDuration, missionHasMeasuredRoute } from './content-core.js';
import { CITIES, CITY_ID, CITY_IDS, geoFor } from './cities.js';
import { LANDMARKS_BY_CITY } from './landmarks.js';
import { VEHICLES, VEHICLE_BY_ID, STARTING_MONEY } from './catalog.js';
import * as PARIS_PLACES from './cities/paris/places.js';
import * as TOULOUSE_PLACES from './cities/toulouse/places.js';
import { MISSING_LANDMARKS as PARIS_MISSING } from './cities/paris/missions.js';
import { MISSING_LANDMARKS as TOULOUSE_MISSING } from './cities/toulouse/missions.js';

const PLACES = { paris: PARIS_PLACES, toulouse: TOULOUSE_PLACES };
const MISSING = { paris: PARIS_MISSING, toulouse: TOULOUSE_MISSING };
// Attendus par ville : volumes, fourchettes de prix et de récompenses, préfixe des ids.
const EXPECT = {
  paris: { minMissions: 20, maxReward: 60000, props: [28, 40], price: [15000, 5000000], idPrefix: null },
  toulouse: { minMissions: 24, maxReward: 80000, props: [30, 40], price: [12000, 2500000], idPrefix: 'tls_' },
};
const MAX_SPEED = Math.max(...VEHICLES.map((v) => v.maxSpeed));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inBounds = (b, p) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
const holdsOf = (m) => m.steps.reduce((t, s) => t + (s.holdSec || 0), 0);
/** Voiture de référence pour juger un chrono : la voiture fournie, sinon la citadine (niveaux 1-2) ou une première Tesla. */
const refCar = (m) => (m.vehicle?.provided ? VEHICLE_BY_ID[m.vehicle.typeId] : m.level <= 2 ? VEHICLE_BY_ID.citadine : VEHICLE_BY_ID.tesla_model3);

test('registre : chaque ville a ses missions, ses biens, ses lieux et ses attendus de test', () => {
  for (const c of CITY_IDS) {
    assert.ok(Array.isArray(M.MISSIONS_BY_CITY[c]) && M.MISSIONS_BY_CITY[c].length, `missions de ${c}`);
    assert.ok(Array.isArray(P.PROPERTIES_BY_CITY[c]) && P.PROPERTIES_BY_CITY[c].length, `biens de ${c}`);
    assert.ok(PLACES[c] && EXPECT[c], `lieux / attendus de ${c}`);
  }
});

test('sélecteurs : ville courante, tables toutes villes, ids uniques globalement', () => {
  assert.equal(M.MISSIONS, M.MISSIONS_BY_CITY[CITY_ID]);
  assert.equal(P.PROPERTIES, P.PROPERTIES_BY_CITY[CITY_ID]);
  assert.equal(M.ROUTE_M, M.ROUTE_M_BY_CITY[CITY_ID]);
  for (const m of M.MISSIONS) assert.equal(M.MISSION_BY_ID[m.id], m);
  for (const p of P.PROPERTIES) assert.equal(P.PROPERTY_BY_ID[p.id], p);
  // unicité toutes villes confondues, par famille puis globalement
  const families = {
    missions: M.ALL_MISSIONS.map((m) => m.id),
    biens: P.ALL_PROPERTIES.map((p) => p.id),
    concessions: CITY_IDS.flatMap((c) => PLACES[c].DEALERS.map((d) => d.id)),
    parkings: CITY_IDS.flatMap((c) => PLACES[c].PUBLIC_GARAGES.map((d) => d.id)),
    collection: CITY_IDS.flatMap((c) => PLACES[c].COLLECTIBLES.map((d) => d.id)),
  };
  for (const [name, ids] of Object.entries(families)) {
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dup, [], `ids en double (${name})`);
  }
  const all = Object.values(families).flat();
  assert.equal(new Set(all).size, all.length, 'un même id sert à deux choses différentes');
  assert.equal(M.ALL_MISSIONS.length, CITY_IDS.reduce((n, c) => n + M.MISSIONS_BY_CITY[c].length, 0));
  assert.equal(Object.keys(M.ALL_MISSION_BY_ID).length, M.ALL_MISSIONS.length);
  assert.equal(Object.keys(P.ALL_PROPERTY_BY_ID).length, P.ALL_PROPERTIES.length);
  for (const c of CITY_IDS) {
    for (const m of M.MISSIONS_BY_CITY[c]) { assert.equal(m.city, c); assert.equal(M.cityOfMission(m.id), c); assert.equal(M.ALL_MISSION_BY_ID[m.id], m); }
    for (const p of P.PROPERTIES_BY_CITY[c]) { assert.equal(p.city, c); assert.equal(P.cityOfProperty(p.id), c); assert.equal(P.ALL_PROPERTY_BY_ID[p.id], p); }
  }
  for (const bad of ['inconnu', 'constructor', '__proto__', '', null, undefined, 42]) {
    assert.equal(M.cityOfMission(bad), null);
    assert.equal(P.cityOfProperty(bad), null);
  }
  // les ids historiques de Paris ne bougent pas (sauvegardes serveur)
  for (const id of ['livraison_eiffel', 'croissants_elysee', 'gp_mission_zero']) assert.equal(M.cityOfMission(id), 'paris');
  for (const id of ['studio_montmartre', 'appart_marais', 'penthouse_eiffel']) assert.equal(P.cityOfProperty(id), 'paris');
});

test('sélecteurs : MZ_CITY / ?city= choisit bien le contenu exporté', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  for (const c of CITY_IDS) {
    const code = "Promise.all([import('./missions.js'),import('./properties.js'),import('./geo.js')]).then(([m,p,g])=>console.log(JSON.stringify({m:m.MISSIONS[0].id,n:m.MISSIONS.length,p:p.PROPERTIES[0].id,legend:m.LEVELS.at(-1).title,inb:m.MISSIONS.every(x=>x.start.x>=g.BOUNDS.minX&&x.start.x<=g.BOUNDS.maxX&&x.start.z>=g.BOUNDS.minZ&&x.start.z<=g.BOUNDS.maxZ)})))";
    const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, env: { ...process.env, MZ_CITY: c }, encoding: 'utf8' }));
    assert.equal(out.m, M.MISSIONS_BY_CITY[c][0].id, `missions exportées pour ${c}`);
    assert.equal(out.n, M.MISSIONS_BY_CITY[c].length);
    assert.equal(out.p, P.PROPERTIES_BY_CITY[c][0].id, `biens exportés pour ${c}`);
    assert.ok(out.legend.endsWith(CITIES[c].name), `titre du dernier niveau : ${out.legend}`);
    assert.ok(out.inb, `les missions de ${c} tiennent dans le BOUNDS de shared/geo.js pour ${c}`);
  }
});

test('progression : niveaux globaux', () => {
  assert.equal(levelForMissionsDone(0), 1);
  assert.equal(levelForMissionsDone(BASE_LEVELS.at(-1).missionsDone), BASE_LEVELS.length);
  assert.equal(M.LEVELS.length, BASE_LEVELS.length);
  M.LEVELS.forEach((l, i) => { assert.equal(l.level, BASE_LEVELS[i].level); assert.equal(l.missionsDone, BASE_LEVELS[i].missionsDone); });
  assert.ok(SELL_BACK_RATIO > 0 && SELL_BACK_RATIO < 1);
  assert.equal(P.SELL_BACK_RATIO, SELL_BACK_RATIO);
});

for (const city of CITY_IDS) {
  const MISSIONS = M.MISSIONS_BY_CITY[city];
  const PROPERTIES = P.PROPERTIES_BY_CITY[city];
  const places = PLACES[city], exp = EXPECT[city];
  const { BOUNDS } = geoFor(city);
  const landmarks = Object.fromEntries(LANDMARKS_BY_CITY[city].map((l) => [l.id, l]));
  const idOk = (id) => /^[a-z0-9_]+$/.test(id) && (exp.idPrefix ? id.startsWith(exp.idPrefix) : !id.startsWith('tls_'));

  test(`${city} — missions : volume, champs requis, types valides`, () => {
    assert.ok(MISSIONS.length >= exp.minMissions, `seulement ${MISSIONS.length} missions`);
    for (const m of MISSIONS) {
      const where = `mission ${m.id}`;
      assert.ok(idOk(m.id), `${where}: id (préfixe ${exp.idPrefix || 'sans tls_'})`);
      for (const k of ['title', 'description', 'type']) assert.ok(typeof m[k] === 'string' && m[k].length > 2, `${where}: ${k}`);
      assert.ok(MISSION_TYPES[m.type], `${where}: type inconnu ${m.type}`);
      assert.ok(m.giver?.name, `${where}: giver`);
      for (const k of ['reward', 'minDurationSec', 'cooldownSec', 'level']) assert.ok(isNum(m[k]), `${where}: ${k}`);
      assert.ok(Number.isInteger(m.reward) && m.reward >= 500 && m.reward <= exp.maxReward, `${where}: reward ${m.reward}`);
      assert.ok(m.cooldownSec >= 30, `${where}: cooldown`);
      assert.ok(m.level >= 1 && m.level <= BASE_LEVELS.length, `${where}: level`);
      assert.ok(isNum(m.start?.x) && isNum(m.start?.z), `${where}: start`);
      assert.ok(Array.isArray(m.steps) && m.steps.length >= 1, `${where}: steps`);
      for (const [i, s] of m.steps.entries()) {
        assert.ok(isNum(s.x) && isNum(s.z) && isNum(s.radius) && s.radius >= 6, `${where}: étape ${i}`);
        assert.ok(typeof s.label === 'string' && s.label.length > 2, `${where}: label étape ${i}`);
        assert.ok(STEP_KINDS.includes(s.kind), `${where}: kind étape ${i}`);
        if (s.lookAt) assert.ok(isNum(s.lookAt.x) && isNum(s.lookAt.z) && landmarks[s.lookAt.id], `${where}: lookAt étape ${i}`);
        if (s.snapTo) assert.ok(s.snapTo.max > 0 && (s.snapTo.kind || s.snapTo.name || s.snapTo.ref), `${where}: snapTo étape ${i}`);
        if (s.goldenHours) assert.ok(s.kind === 'photo' && s.goldenHours[0] < s.goldenHours[1], `${where}: goldenHours étape ${i}`);
        if (s.kind === 'pickup' || s.kind === 'dropoff' || s.kind === 'stop') assert.ok(m.requireVehicle, `${where}: arrêt sans requireVehicle`);
      }
      if (m.vehicle) assert.ok(VEHICLE_BY_ID[m.vehicle.typeId], `${where}: véhicule inconnu`);
      if (m.vehicleMinPrice) assert.ok(VEHICLES.some((v) => v.price >= m.vehicleMinPrice), `${where}: aucune voiture assez chère`);
      if (m.type === 'taxi') {
        assert.equal(m.steps[0].kind, 'pickup', `${where}: un taxi commence par un pickup`);
        assert.equal(m.steps.at(-1).kind, 'dropoff', `${where}: un taxi finit par un dropoff`);
        assert.ok(m.passenger?.name, `${where}: passager`);
      }
      if (m.type === 'convoy') assert.ok(m.vehicle?.provided && isNum(m.maxDamage), `${where}: convoyage sans véhicule/dégâts`);
      if (m.type === 'race') assert.ok(m.timeLimitSec || m.legTimeSec, `${where}: course sans chrono`);
      if (m.type === 'photo') assert.ok(m.steps.every((s) => s.kind === 'photo'), `${where}: étape non photo`);
    }
  });

  test(`${city} — missions : monuments référencés existants, positions dans l'emprise de la ville`, () => {
    assert.deepEqual(MISSING[city], [], 'monuments référencés par les missions mais absents de landmarks.js');
    assert.deepEqual(places.tools.missing, [], 'monuments référencés par les lieux mais absents de landmarks.js');
    for (const m of MISSIONS) {
      assert.ok(inBounds(BOUNDS, m.start), `mission ${m.id}: départ hors carte`);
      for (const [i, s] of m.steps.entries()) assert.ok(inBounds(BOUNDS, s), `mission ${m.id}: étape ${i} hors carte`);
    }
  });

  test(`${city} — missions : minDurationSec est une borne basse honnête, les chronos sont tenables`, () => {
    for (const m of MISSIONS) {
      const len = missionPathLength(m), holds = holdsOf(m);
      const vmax = m.vehicle?.provided ? VEHICLE_BY_ID[m.vehicle.typeId].maxSpeed : MAX_SPEED;
      assert.equal(m.minDurationSec, missionMinDuration(m), `mission ${m.id}: minDurationSec non recalculé`);
      // durée la plus rapide imaginable : ligne droite à la vitesse de pointe + arrêts imposés
      const fastest = len / vmax + holds;
      assert.ok(m.minDurationSec > 0, `mission ${m.id}: minDurationSec nul`);
      assert.ok(m.minDurationSec <= fastest, `mission ${m.id}: minDurationSec ${m.minDurationSec}s > durée la plus rapide ${fastest.toFixed(1)}s`);
      // durée réaliste (route ≈ 1,35 × vol d'oiseau, 25 m/s de moyenne en supercar) : large marge
      assert.ok(m.minDurationSec <= ((len * 1.35) / 25 + holds) * 0.78, `mission ${m.id}: minDurationSec trop proche du réaliste`);
      if (typeof m.timeLimitSec === 'number') {
        assert.ok(m.timeLimitSec > m.minDurationSec * 1.5, `mission ${m.id}: chrono intenable`);
        // allure moyenne exigée sur la distance routière estimée : ≤ 45 % de la vitesse de pointe de la voiture de référence
        const needed = missionRouteLength(m) / (m.timeLimitSec - holds);
        assert.ok(needed <= refCar(m).maxSpeed * 0.45, `mission ${m.id}: allure exigée ${needed.toFixed(1)} m/s trop élevée pour ${refCar(m).id}`);
        assert.ok(needed >= 5, `mission ${m.id}: chrono sans enjeu (${needed.toFixed(1)} m/s)`);
      }
      if (m.legTimeSec) for (const s of m.steps) assert.ok(s.legTimeSec >= 10, `mission ${m.id}: chrono d'étape`);
    }
  });

  test(`${city} — missions : progression et équilibrage`, () => {
    const byLevel = (lv) => MISSIONS.filter((m) => m.level === lv);
    let prevAvg = 0, prevMax = 0;
    for (const l of BASE_LEVELS) {
      const ms = byLevel(l.level);
      assert.ok(ms.length >= 3, `niveau ${l.level}: ${ms.length} missions`);
      const avg = ms.reduce((t, m) => t + m.reward, 0) / ms.length;
      assert.ok(avg > prevAvg * 1.3, `niveau ${l.level}: récompense moyenne insuffisamment croissante`);
      assert.ok(Math.min(...ms.map((m) => m.reward)) >= prevMax * 0.55, `niveau ${l.level}: une mission paie moins que le niveau précédent`);
      prevAvg = avg; prevMax = Math.max(...ms.map((m) => m.reward));
    }
    // assez de missions de niveau 1 pour débloquer le niveau 2 sans attendre un cooldown
    assert.ok(byLevel(1).length >= BASE_LEVELS[1].missionsDone);
    const rewards = MISSIONS.map((m) => m.reward);
    assert.ok(Math.min(...rewards) <= 1000 && Math.max(...rewards) === Math.max(...byLevel(BASE_LEVELS.length).map((m) => m.reward)));
    // la première Tesla demande un vrai effort (> 8 missions de début) mais reste atteignable
    const early = byLevel(1).concat(byLevel(2), byLevel(3));
    const n = (VEHICLE_BY_ID.tesla_model3.price - STARTING_MONEY) / (early.reduce((t, m) => t + m.reward, 0) / early.length);
    assert.ok(n >= 8 && n <= 25, `Tesla en ${n.toFixed(1)} missions de début`);
    // les 7 types sont représentés
    for (const t of Object.keys(MISSION_TYPES)) assert.ok(MISSIONS.some((m) => m.type === t), `aucun ${t}`);
    // les cooldowns suivent la grille : plus on gagne, plus on attend
    for (const m of MISSIONS) {
      const perMin = m.reward / (m.cooldownSec / 60);
      assert.ok(perMin >= 250 && perMin <= 3200, `mission ${m.id}: ${Math.round(perMin)} Ƶ par minute de cooldown`);
    }
    // une longue mission de banlieue paie mieux qu'une course de centre-ville du même niveau ou d'un niveau inférieur
    const long = MISSIONS.filter((m) => missionRouteLength(m) >= 12000);
    for (const big of long) for (const m of MISSIONS) {
      if (m.level <= big.level && missionRouteLength(m) < 5000 && m.type === big.type) assert.ok(big.reward > m.reward, `${big.id} (${Math.round(missionRouteLength(big) / 1000)} km) ne paie pas plus que ${m.id}`);
    }
  });

  test(`${city} — biens : contrat, emprise, prix et loyers cohérents`, () => {
    assert.ok(PROPERTIES.length >= exp.props[0] && PROPERTIES.length <= exp.props[1], `${PROPERTIES.length} biens`);
    for (const p of PROPERTIES) {
      const where = `bien ${p.id}`;
      assert.ok(idOk(p.id), `${where}: id`);
      assert.ok(typeof p.name === 'string' && p.name.length > 3, where);
      assert.ok(PROPERTY_KINDS[p.kind], `${where}: kind ${p.kind}`);
      for (const k of ['price', 'income', 'lat', 'lon', 'x', 'z']) assert.ok(isNum(p[k]), `${where}: ${k}`);
      assert.ok(inBounds(BOUNDS, p), `${where}: hors carte`);
      const [x, z] = geoFor(city).lonLatToXZ(p.lon, p.lat);
      assert.ok(Math.hypot(x - p.x, z - p.z) < 0.2, `${where}: x/z incohérents avec lat/lon dans la projection de ${city}`);
      assert.ok(p.price >= exp.price[0] && p.price <= exp.price[1], `${where}: prix`);
      const ratio = p.income / p.price;
      assert.ok(ratio >= 0.005 && ratio <= 0.0101, `${where}: rendement horaire ${(ratio * 100).toFixed(2)} %`);
      assert.ok(Number.isInteger(p.garageSlots) && p.garageSlots >= 0, `${where}: garageSlots`);
    }
    // deux biens ne partagent pas le même emplacement
    for (let i = 0; i < PROPERTIES.length; i++) for (let j = i + 1; j < PROPERTIES.length; j++) {
      const a = PROPERTIES[i], b = PROPERTIES[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 25, `${a.id} et ${b.id} trop proches`);
    }
    const prices = PROPERTIES.map((p) => p.price);
    assert.equal(Math.min(...prices), exp.price[0], 'prix plancher');
    assert.equal(Math.max(...prices), exp.price[1], 'prix plafond');
    for (const k of ['studio', 'appartement', 'loft', 'peniche', 'hotel_particulier', 'penthouse', 'commerce', 'garage']) assert.ok(PROPERTIES.some((p) => p.kind === k), `aucun bien de type ${k}`);
    // un premier bien est abordable après quelques missions
    assert.ok(Math.min(...prices) <= 20000);
  });

  test(`${city} — lieux : point de départ, concessions, parkings, collection`, () => {
    assert.ok(isNum(places.SPAWN?.x) && isNum(places.SPAWN?.z) && inBounds(BOUNDS, places.SPAWN), 'SPAWN');
    assert.ok(Math.hypot(places.SPAWN.x, places.SPAWN.z) < 400, 'le point de départ est sur la place centrale (origine de la ville)');
    if (places.SPAWN.lookAt) assert.ok(landmarks[places.SPAWN.lookAt], `SPAWN.lookAt : monument ${places.SPAWN.lookAt} inconnu`);
    assert.equal(places.DEALERS.length, 3);
    assert.deepEqual(places.DEALERS.map((d) => d.brand).sort(), ['Lamborghini', 'Porsche', 'Tesla']);
    for (const d of places.DEALERS) {
      assert.ok(idOk(d.id) && d.name && inBounds(BOUNDS, d), `concession ${d.id}`);
      assert.ok(d.show.length >= 2 && d.show.every((t) => VEHICLE_BY_ID[t]?.brand === d.brand), `concession ${d.id}: modèles exposés`);
    }
    // toutes les voitures payantes du catalogue (hors taxi générique) sont vendues quelque part
    const sold = new Set(places.DEALERS.map((d) => d.brand));
    for (const v of VEHICLES) if (['Tesla', 'Porsche', 'Lamborghini'].includes(v.brand)) assert.ok(sold.has(v.brand));
    assert.ok(places.PUBLIC_GARAGES.length >= 5);
    for (const k of places.PUBLIC_GARAGES) assert.ok(idOk(k.id) && k.name && inBounds(BOUNDS, k), `parking ${k.id}`);
    assert.ok(places.COLLECTIBLES.length >= 12);
    for (const c of places.COLLECTIBLES) assert.ok(idOk(c.id) && c.label && isNum(c.x) && isNum(c.z) && inBounds(BOUNDS, c), `objet ${c.id}`);
    for (const k of ['name', 'found', 'allFound']) assert.ok(typeof places.COLLECTIBLE[k] === 'string' && places.COLLECTIBLE[k].length > 3);
    for (const [name, q] of Object.entries(places.PLACE)) assert.ok(isNum(q.x) && isNum(q.z) && inBounds(BOUNDS, q), `repère ${name} hors carte`);
  });

  // ---- tests liés au réseau routier de la ville (ignorés tant que le fichier n'est pas généré) ----
  const roadsFile = new URL('.' + CITIES[city].files.roads.replace(/^\/shared/, ''), import.meta.url);
  test(`${city} — réseau routier : points proches d'une chaussée, distances et chronos tenables, GPS rapide`, { skip: !existsSync(roadsFile) && `${CITIES[city].files.roads} absent` }, async () => {
    const { createRouter, createRoadIndex, snapStepToRoad, isWalkable } = await import('../client/src/gameplay/gps.js');
    const wd = JSON.parse(readFileSync(roadsFile, 'utf8'));
    const router = createRouter(wd), roads = createRoadIndex(wd);
    assert.ok(router.nodeCount > 100 && roads.count > 100);
    // les tables ROUTE_M sont mesurées comme le GPS guide en voiture : trajet le plus rapide entre positions recalées
    const metric = 'time';
    const table = M.ROUTE_M_BY_CITY[city] || {};
    for (const m of MISSIONS) {
      const n0 = roads.nearest(m.start.x, m.start.z, 500, isWalkable);
      assert.ok(n0 && n0.dist <= 160, `mission ${m.id}: départ à ${n0 ? n0.dist.toFixed(0) : '∞'} m d'une rue`);
      for (const [i, s] of m.steps.entries()) {
        if (s.snap === false) continue;
        const r = snapStepToRoad(roads, s);
        assert.ok(r.road, `mission ${m.id}: étape ${i} (${s.label}) sans chaussée à proximité`);
        if (s.snapTo) assert.ok(r.matched, `mission ${m.id}: étape ${i} (${s.label}) — recalage ciblé ${JSON.stringify(s.snapTo)} introuvable`);
        assert.ok(r.moved <= (s.snapTo?.max || 160), `mission ${m.id}: étape ${i} déplacée de ${r.moved.toFixed(0)} m`);
      }
      if (m.anyOrder) continue;
      let prev = m.start, real = 0;
      for (const s of m.steps) {
        const q = snapStepToRoad(roads, s);
        const r = router.route(prev.x, prev.z, q.x, q.z, { metric, fromEle: prev.ele, toEle: q.ele, budgetMs: 1000 });
        // (un tronçon de moins de 30 m — départ et prise en charge au même endroit — n'est pas routé)
        assert.ok(!r.partial && (r.routed || Math.hypot(prev.x - q.x, prev.z - q.z) < 30), `mission ${m.id}: étape « ${s.label} » injoignable par le graphe routier`);
        real += r.length; prev = q;
      }
      if (table[m.id]) {
        assert.equal(table[m.id].length, m.steps.length, `mission ${m.id}: ROUTE_M incomplet`);
        assert.ok(missionHasMeasuredRoute(m));
        // la table peut dater d'une génération précédente des données : on tolère 25 % d'écart sur le total
        const total = table[m.id].reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(real - total) <= Math.max(150, real * 0.25), `mission ${m.id}: route réelle ${real.toFixed(0)} m, table ${total} m — régénérer ROUTE_M`);
      }
      // le chrono reste tenable sur le vrai réseau (allure moyenne ≤ 50 % de la vitesse de pointe)
      if (typeof m.timeLimitSec === 'number') {
        const needed = real / (m.timeLimitSec - holdsOf(m));
        assert.ok(needed <= refCar(m).maxSpeed * 0.5, `mission ${m.id}: ${needed.toFixed(1)} m/s exigés sur le réseau réel (${(real / 1000).toFixed(1)} km en ${m.timeLimitSec} s)`);
      }
    }
    for (const p of PROPERTIES) {
      const n = roads.nearest(p.x, p.z, 500, isWalkable);
      assert.ok(n && n.dist <= 140, `bien ${p.id}: à ${n ? n.dist.toFixed(0) : '∞'} m d'une rue`);
    }
    for (const d of [...places.DEALERS, ...places.PUBLIC_GARAGES]) {
      const n = roads.nearest(d.x, d.z, 500, isWalkable);
      assert.ok(n && n.dist <= 160, `${d.id}: à ${n ? n.dist.toFixed(0) : '∞'} m d'une rue`);
    }
    // performance du GPS : la plus longue traversée de la carte, plusieurs fois (première exécution = échauffement)
    const { minX, maxX, minZ, maxZ } = BOUNDS, k = 0.42;
    const A = [minX + (maxX - minX) * (0.5 - k), minZ + (maxZ - minZ) * (0.5 - k)], B = [minX + (maxX - minX) * (0.5 + k), minZ + (maxZ - minZ) * (0.5 + k)];
    let best = Infinity, r;
    for (let i = 0; i < 6; i++) { r = router.route(A[0], A[1], B[0], B[1], { budgetMs: 1000 }); best = Math.min(best, r.ms); }
    assert.ok(r.routed && !r.partial, 'traversée de la carte non routée');
    assert.ok(r.length >= Math.hypot(B[0] - A[0], B[1] - A[1]), 'itinéraire plus court que le vol d\'oiseau');
    assert.ok(best < 60, `itinéraire de ${(r.length / 1000).toFixed(1)} km calculé en ${best.toFixed(1)} ms (visé < 30 ms)`);
  });
}

test('toulouse — couleur locale : on dit chocolatine, et la ville est moins chère que Paris', () => {
  const texts = JSON.stringify([M.MISSIONS_BY_CITY.toulouse, P.PROPERTIES_BY_CITY.toulouse]).toLowerCase();
  assert.ok(!/pains? au chocolat/.test(texts), '« pain au chocolat » est interdit à Toulouse');
  assert.ok(texts.includes('chocolatine'));
  for (const w of ['violette', 'cassoulet', 'saucisse', 'rocade', 'canal du midi', 'stadium', 'ernest-wallon', 'blagnac', 'matabiau', 'pech-david']) assert.ok(texts.includes(w), `il manque « ${w} »`);
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const price = (c, kind) => median(P.PROPERTIES_BY_CITY[c].filter((p) => !kind || p.kind === kind).map((p) => p.price));
  assert.ok(price('toulouse') < price('paris'), 'prix médian');
  for (const k of ['studio', 'appartement', 'penthouse', 'hotel_particulier']) assert.ok(price('toulouse', k) < price('paris', k), `prix médian des biens « ${k} »`);
  // la proche banlieue est desservie : au moins une mission et un bien à plus de 5 km du Capitole dans chaque direction
  const far = (list, pred) => list.some((o) => pred(o.x ?? o.start?.x, o.z ?? o.start?.z));
  const stepsAndProps = [...M.MISSIONS_BY_CITY.toulouse.flatMap((m) => m.steps), ...P.PROPERTIES_BY_CITY.toulouse];
  assert.ok(far(stepsAndProps, (x) => x < -5000), 'ouest (Blagnac, Tournefeuille)');
  assert.ok(far(stepsAndProps, (x) => x > 4000), 'est (Balma)');
  assert.ok(far(stepsAndProps, (x, z) => z < -5000), 'nord (L\'Union, Sesquières)');
  assert.ok(far(stepsAndProps, (x, z) => z > 5000), 'sud (Ramonville, Pech-David)');
});

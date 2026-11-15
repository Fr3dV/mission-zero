// Validation des données de jeu (missions, biens, lieux) de TOUTES les villes — lancé par `node --test`.
// Les tests liés au réseau routier d'une ville s'activent quand son fichier de routes existe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as M from './missions.js';
import * as P from './properties.js';
import { LEVELS as BASE_LEVELS, MISSION_TYPES, STEP_KINDS, PROPERTY_KINDS, SELL_BACK_RATIO, LEGEND_STAR_EVERY, starsFor, levelForMissionsDone, missionPathLength, missionRouteLength, missionMinDuration, missionHasMeasuredRoute } from './content-core.js';
import { CITIES, CITY_ID, CITY_IDS, geoFor } from './cities.js';
import { LANDMARKS_BY_CITY } from './landmarks.js';
import { VEHICLES, VEHICLE_BY_ID, STARTING_MONEY, PAINTS, PAINT_BY_COLOR, HORNS, HORN_BY_ID } from './catalog.js';
import { JOB_MIN_M, JOB_MAX_M } from './jobs.js';
import * as PARIS_PLACES from './cities/paris/places.js';
import * as TOULOUSE_PLACES from './cities/toulouse/places.js';
import { MISSING_LANDMARKS as PARIS_MISSING } from './cities/paris/missions.js';
import { MISSING_LANDMARKS as TOULOUSE_MISSING } from './cities/toulouse/missions.js';

const PLACES = { paris: PARIS_PLACES, toulouse: TOULOUSE_PLACES };
const MISSING = { paris: PARIS_MISSING, toulouse: TOULOUSE_MISSING };
// Attendus par ville : volumes, fourchettes de prix et de récompenses, préfixe des ids.
//   first = mission d'index 0 (lue par index dans server/test) ; historic = ids d'avant le contrat v6, dans l'ordre ;
//   intro = mission d'introduction ; returns = missions « retour » ajoutées au pied de l'arrivée de `from` ;
//   minRdv = nombre minimal de points de rendez-vous.
const EXPECT = {
  paris: {
    minMissions: 20, maxReward: 60000, props: [28, 40], price: [15000, 5000000], idPrefix: null,
    first: 'croissants_elysee', intro: 'premiers_tours_de_roue', minRdv: 40,
    returns: { from: 'livraison_eiffel', ids: ['retour_tour_eiffel', 'souvenirs_grand_palais'] },
    historic: ['croissants_elysee', 'livraison_eiffel', 'taxi_touristes', 'photo_concorde', 'taxi_gare', 'clm_champs', 'coursier_rive_gauche', 'taxi_opera_louvre', 'tour_ouest', 'voiturier_ritz', 'tour_ponts', 'photo_montmartre', 'visite_guidee', 'fleurs_montmartre', 'coursier_grands_magasins', 'convoi_tesla', 'gp_rive_droite', 'taxi_vip_mode', 'poursuite_ballon', 'photo_grands_classiques', 'convoi_porsche', 'grand_tour', 'coursier_nuit_blanche', 'boucle_seine', 'convoi_aventador', 'cortege_officiel', 'gp_mission_zero'],
  },
  toulouse: {
    minMissions: 24, maxReward: 80000, props: [30, 40], price: [12000, 2500000], idPrefix: 'tls_',
    first: 'tls_chocolatines_capitole', intro: 'tls_premiers_tours_de_roue', minRdv: 60,
    returns: { from: 'tls_photo_ville_rose', ids: ['tls_retour_matabiau', 'tls_fenetra_victor_hugo'] },
    historic: ['tls_chocolatines_capitole', 'tls_taxi_matabiau', 'tls_photo_ville_rose', 'tls_violettes_wilson', 'tls_saucisse_saint_pierre', 'tls_clm_boulevards', 'tls_coursier_marches', 'tls_taxi_purpan', 'tls_tour_ponts', 'tls_voiturier_capitole', 'tls_supporters_stadium', 'tls_navette_mirail', 'tls_navette_paul_sabatier', 'tls_canal_ecluses', 'tls_photo_garonne', 'tls_cassoulet_balma', 'tls_supporters_wallon', 'tls_coursier_violettes', 'tls_montee_pech_david', 'tls_taxi_aeroport', 'tls_convoi_tesla', 'tls_photo_espace', 'tls_poursuite_ballon', 'tls_gp_garonne', 'tls_taxi_star_zenith', 'tls_convoi_pieces_avion', 'tls_convoi_porsche', 'tls_photo_fusee_avion', 'tls_grand_tour', 'tls_coursier_ouest', 'tls_tour_rocade', 'tls_convoi_aventador', 'tls_cortege_spatial'],
  },
};
/** Plafond de missions par ville : le budget de S.PROFILE (3 300 octets, une entrée de cooldown par mission) le suppose. */
const MAX_MISSIONS_PER_CITY = 36;
/** Niveau 1 : distance maximale PAR LA ROUTE (m) entre une arrivée et le départ de niveau 1 le plus proche. */
const NEXT_START_ROAD_MAX = 700;
/** Niveau 1 : au-delà de L1_DETOUR_FREE_M mètres de route, un parcours ne dépasse pas L1_DETOUR_MAX × son vol d'oiseau. */
const L1_DETOUR_FREE_M = 2000, L1_DETOUR_MAX = 2.5;
/** Conditions de déblocage connues de economy.unlocked() (contrat v6). */
const UNLOCK_KEYS = ['level', 'streak', 'fares', 'escapes', 'dares', 'combo', 'stars'];
const unlockOk = (u) => u && typeof u === 'object' && Object.keys(u).length === 1 && UNLOCK_KEYS.includes(Object.keys(u)[0]) && Number.isInteger(Object.values(u)[0]) && Object.values(u)[0] > 0;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
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
    'rendez-vous': CITY_IDS.flatMap((c) => PLACES[c].RDV_POINTS.map((d) => d.id)),
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
  // les seuils de niveau sont historiques (profils serveur) : le contrat v6 n'y touche pas
  assert.deepEqual(BASE_LEVELS.map((l) => [l.level, l.missionsDone, l.title]), [[1, 0, 'Stagiaire'], [2, 3, 'Coursier'], [3, 8, 'Chauffeur'], [4, 15, 'Pilote'], [5, 25, 'As du volant'], [6, 40, 'Légende']]);
});

test('progression : étoiles de Légende (contrat v6)', () => {
  assert.equal(LEGEND_STAR_EVERY, 20);
  assert.equal(M.starsFor, starsFor, 'shared/missions.js réexporte starsFor');
  assert.equal(M.LEGEND_STAR_EVERY, LEGEND_STAR_EVERY);
  const last = BASE_LEVELS.at(-1).missionsDone;
  for (const [n, stars] of [[0, 0], [39, 0], [40, 0], [59, 0], [60, 1], [79, 1], [80, 2], [100, 3], [1040, 50]]) assert.equal(starsFor(n), stars, `starsFor(${n})`);
  for (let n = 0; n < 400; n++) {
    assert.equal(starsFor(n), Math.max(0, Math.floor((n - last) / LEGEND_STAR_EVERY)));
    assert.ok(starsFor(n + 1) >= starsFor(n), 'les étoiles ne décroissent jamais');
    if (starsFor(n) > 0) assert.equal(levelForMissionsDone(n), BASE_LEVELS.length, 'pas d\'étoile avant le dernier niveau');
  }
  // entrées douteuses (profil incomplet, valeur réseau) : jamais NaN ni négatif
  for (const bad of [undefined, null, NaN, -5, 'abc', {}, Infinity]) assert.equal(starsFor(bad), 0, `starsFor(${String(bad)})`);
  assert.equal(starsFor(), 0);
  assert.equal(starsFor('60'), 1);
});

test("catalogue : véhicules inchangés, teintes et klaxons de l'Atelier (contrat v6)", () => {
  // aucun id ni prix de véhicule ne bouge (garages et profils serveur)
  assert.deepEqual(VEHICLES.map((v) => [v.id, v.price]), [['citadine', 0], ['taxi', 12000], ['tesla_model3', 45000], ['tesla_models', 110000], ['tesla_cybertruck', 95000], ['porsche_911', 230000], ['porsche_taycan', 160000], ['porsche_cayenne', 105000], ['lambo_huracan', 260000], ['lambo_aventador', 450000], ['lambo_urus', 240000]]);

  // ---- teintes : nuancier fermé de 12, dont 4 exclusives ----
  assert.equal(PAINTS.length, 12);
  assert.equal(new Set(PAINTS.map((p) => p.id)).size, 12, 'ids de teinte en double');
  assert.equal(new Set(PAINTS.map((p) => p.color)).size, 12, 'teintes en double');
  assert.equal(new Set(PAINTS.map((p) => p.name)).size, 12, 'noms de teinte en double');
  const catalogColors = new Set(VEHICLES.flatMap((v) => v.colors));
  for (const p of PAINTS) {
    const where = `teinte ${p.id}`;
    assert.ok(/^[a-z0-9_]+$/.test(p.id), `${where}: id`);
    assert.ok(typeof p.name === 'string' && p.name.length > 2, `${where}: name`);
    assert.ok(/^#[0-9a-f]{6}$/.test(p.color), `${where}: format #rrggbb en minuscules (${p.color})`);
    assert.ok(!catalogColors.has(p.color), `${where}: doublon d'une teinte catalogue (spec.colors)`);
    assert.equal(PAINT_BY_COLOR[p.color], p, `${where}: PAINT_BY_COLOR`);
    assert.deepEqual(Object.keys(p).sort(), p.unlock ? ['color', 'id', 'name', 'price', 'unlock'] : ['color', 'id', 'name', 'price'], `${where}: champs`);
    if (p.unlock) { assert.ok(unlockOk(p.unlock), `${where}: unlock inconnu ${JSON.stringify(p.unlock)}`); assert.equal(p.price, 0, `${where}: une exclusive est gratuite`); }
    else assert.equal(p.price, 1500, `${where}: prix du nuancier`);
  }
  for (const v of VEHICLES) for (const c of v.colors) assert.ok(/^#[0-9a-f]{6}$/.test(c), `${v.id}: teinte catalogue ${c}`);
  assert.equal(Object.keys(PAINT_BY_COLOR).length, 12);
  assert.deepEqual(PAINTS.filter((p) => p.unlock).map((p) => p.unlock), [{ streak: 5 }, { combo: 10000 }, { level: 6 }, { stars: 3 }]);
  assert.equal(PAINTS.filter((p) => !p.unlock).length, 8);

  // ---- klaxons : 9, ids et conditions du contrat, mélodie de 2 s au plus ----
  const expected = { std: undefined, pouet: { level: 2 }, deuxtons: { fares: 10 }, cocorico: { streak: 3 }, cucaracha: { dares: 1 }, camion: { escapes: 1 }, secanto: { level: 4 }, fanfare: { combo: 5000 }, legende: { stars: 1 } };
  assert.deepEqual(HORNS.map((h) => h.id), Object.keys(expected));
  assert.equal(new Set(HORNS.map((h) => h.name)).size, HORNS.length, 'noms de klaxon en double');
  for (const h of HORNS) {
    const where = `klaxon ${h.id}`;
    assert.equal(HORN_BY_ID[h.id], h, `${where}: HORN_BY_ID`);
    assert.ok(typeof h.name === 'string' && h.name.length > 2, `${where}: name`);
    assert.deepEqual(h.unlock, expected[h.id], `${where}: unlock`);
    if (h.unlock) assert.ok(unlockOk(h.unlock), `${where}: unlock inconnu`);
    assert.deepEqual(Object.keys(h).sort(), h.unlock ? ['id', 'name', 'notes', 'unlock'] : ['id', 'name', 'notes'], `${where}: champs`);
    assert.ok(Array.isArray(h.notes) && h.notes.length >= 1 && h.notes.length <= 16, `${where}: notes`);
    let total = 0;
    for (const n of h.notes) {
      assert.ok(Array.isArray(n) && n.length === 2, `${where}: note [Hz, s]`);
      assert.ok(isNum(n[0]) && n[0] >= 100 && n[0] <= 2000, `${where}: fréquence ${n[0]} Hz hors de la plage audible d'un klaxon`);
      assert.ok(isNum(n[1]) && n[1] >= 0.05 && n[1] <= 1, `${where}: durée de note ${n[1]} s`);
      total += n[1];
    }
    assert.ok(total <= 2 + 1e-9, `${where}: ${total.toFixed(2)} s (2 s au plus)`);
  }
  assert.equal(Object.keys(HORN_BY_ID).length, 9);
  // tout ce qui se débloque par le niveau reste atteignable
  for (const o of [...PAINTS, ...HORNS]) if (o.unlock?.level) assert.ok(o.unlock.level <= BASE_LEVELS.length, `${o.id}: niveau ${o.unlock.level} inexistant`);
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

  test(`${city} — missions : ids historiques, plafond, mission d'introduction, missions « retour » (contrat v6)`, () => {
    // les missions d'avant le contrat v6 gardent leur id ET leur rang (server/test lit MISSIONS_BY_CITY[ville][0]) :
    // les nouvelles sont ajoutées après
    assert.equal(MISSIONS[0].id, exp.first);
    assert.equal(MISSIONS[0].level, 1);
    assert.deepEqual(MISSIONS.slice(0, exp.historic.length).map((m) => m.id), exp.historic, 'ids historiques renommés, supprimés ou déplacés');
    assert.ok(MISSIONS.length <= MAX_MISSIONS_PER_CITY, `${MISSIONS.length} missions : le budget de S.PROFILE en suppose ${MAX_MISSIONS_PER_CITY} au plus`);
    const byId = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
    const l1 = MISSIONS.filter((m) => m.level === 1);
    const last = (m) => m.steps.at(-1);

    // ---- introduction : exactement une, de niveau 1, en voiture, au pied du point d'apparition ----
    const intros = MISSIONS.filter((m) => 'intro' in m);
    assert.deepEqual(intros.map((m) => m.id), [exp.intro], 'exactement une mission intro par ville');
    const intro = intros[0];
    assert.equal(intro.intro, true);
    assert.equal(intro.level, 1);
    assert.equal(intro.type, 'taxi');
    assert.equal(intro.requireVehicle, true, "l'intro se fait en voiture");
    assert.ok(!intro.vehicle && !intro.vehicleMinPrice && !intro.maxDamage && !intro.timeLimitSec && !intro.legTimeSec, "l'intro se joue avec la Citadine, sans chrono ni casse éliminatoire");
    assert.ok(dist(intro.start, places.SPAWN) < 150, `intro à ${dist(intro.start, places.SPAWN).toFixed(0)} m du point d'apparition`);
    assert.ok(intro.reward >= 900 && intro.reward <= 1300, `intro: gain ${intro.reward}`);
    assert.ok(missionHasMeasuredRoute(intro), 'intro: distance routière mesurée (ROUTE_M)');
    const introLen = missionRouteLength(intro);
    assert.ok(introLen >= 800 && introLen <= 1200, `intro: ${introLen.toFixed(0)} m par la route (800 à 1 200)`);
    assert.ok(MISSIONS.indexOf(intro) >= exp.historic.length, "l'intro est ajoutée après les missions historiques");

    // ---- missions « retour » : au pied de l'arrivée d'une mission qui laissait le joueur loin de tout ----
    const from = byId[exp.returns.from];
    assert.ok(from && from.level === 1, `mission ${exp.returns.from}`);
    const rets = exp.returns.ids.map((id) => byId[id]);
    assert.ok(rets.every(Boolean), 'missions retour manquantes');
    assert.deepEqual(rets.map((m) => m.type).sort(), ['delivery', 'taxi'], 'un retour en taxi, un retour en livraison');
    for (const m of rets) {
      const where = `mission ${m.id}`;
      assert.equal(m.level, 1, where);
      assert.ok(m.reward >= 800 && m.reward <= 1500, `${where}: gain ${m.reward} hors de la fourchette du niveau 1`);
      assert.ok(dist(m.start, last(from)) < 150, `${where}: départ à ${dist(m.start, last(from)).toFixed(0)} m de l'arrivée de ${from.id}`);
      const d = Math.min(...l1.filter((o) => o !== m).map((o) => dist(o.start, last(m))));
      assert.ok(d < 300, `${where}: arrivée à ${d.toFixed(0)} m du départ de niveau 1 le plus proche`);
      assert.ok(MISSIONS.indexOf(m) >= exp.historic.length, `${where}: ajoutée après les missions historiques`);
    }
    // les gains du niveau 1 restent dans la fourchette historique, nouvelles missions comprises
    for (const m of l1) assert.ok(m.reward >= 800 && m.reward <= 1800, `mission ${m.id}: gain ${m.reward}`);
    // toute arrivée de niveau 1 est à deux pas d'un AUTRE départ de niveau 1 (le joueur n'est jamais laissé sans cap)
    for (const m of l1) {
      const d = Math.min(...l1.filter((o) => o !== m).map((o) => dist(o.start, last(m))));
      assert.ok(d < 400, `mission ${m.id}: arrivée à ${d.toFixed(0)} m du départ de niveau 1 le plus proche`);
    }
    // une mission à pied de niveau 1 reste une balade (mesure routière, donc majorante)
    for (const m of l1) if (m.type === 'photo') assert.ok(missionRouteLength(m) < 2500, `mission ${m.id}: ${missionRouteLength(m).toFixed(0)} m à pied`);
    // au moins une mission de niveau 1 à pied et une en voiture partent à moins de 150 m du point d'apparition
    assert.ok(l1.some((m) => !m.requireVehicle && dist(m.start, places.SPAWN) < 150), 'aucune mission à pied près du point d\'apparition');
  });

  test(`${city} — points de rendez-vous : volume, ids, libellés, emprise, monuments, couverture des missions (contrat v6)`, () => {
    const pts = places.RDV_POINTS;
    assert.ok(Array.isArray(pts) && pts.length >= exp.minRdv, `${pts?.length} points de rendez-vous (au moins ${exp.minRdv})`);
    assert.equal(new Set(pts.map((p) => p.id)).size, pts.length, 'ids de rendez-vous en double');
    assert.equal(new Set(pts.map((p) => p.label)).size, pts.length, 'libellés de rendez-vous en double');
    const visible = LANDMARKS_BY_CITY[city].filter((l) => !l.hidden);
    for (const p of pts) {
      const where = `rendez-vous ${p.id}`;
      assert.ok(idOk(p.id) && p.id.startsWith(`${exp.idPrefix || ''}rdv_`), `${where}: id`);
      assert.deepEqual(Object.keys(p).sort(), p.lm ? ['id', 'label', 'lm', 'x', 'z'] : ['id', 'label', 'x', 'z'], `${where}: champs`);
      // libellé affichable avec son article, utilisable tel quel après « vers », « devant », « à », « près de »
      assert.ok(typeof p.label === 'string' && /^(la |l')\S/.test(p.label) && p.label.length <= 40, `${where}: libellé « ${p.label} »`);
      assert.ok(isNum(p.x) && isNum(p.z) && inBounds(BOUNDS, p), `${where}: hors carte`);
      // hors du disque de TOUT monument (y compris les compléments d'emprise masqués), avec 10 m de marge
      for (const l of LANDMARKS_BY_CITY[city]) assert.ok(dist(l, p) > l.radius + 10, `${where}: dans le disque de ${l.id} (${dist(l, p).toFixed(0)} m pour un rayon de ${l.radius})`);
      if ('lm' in p) {
        assert.equal(p.lm, true, `${where}: lm`);
        assert.ok(visible.some((l) => dist(l, p) <= l.radius + 200), `${where}: lm sans monument visible à moins de 200 m`);
      }
    }
    assert.ok(pts.filter((p) => p.lm).length >= 12, 'trop peu de rendez-vous au bord d\'un monument (clients touristes)');
    // deux points ne se confondent pas
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(dist(pts[i], pts[j]) > 40, `${pts[i].id} et ${pts[j].id} à ${dist(pts[i], pts[j]).toFixed(0)} m l'un de l'autre`);
    // couverture : tout départ et toute étape de mission a un rendez-vous dans la couronne où le serveur tire une
    // course de taxi (JOB_MIN_M..JOB_MAX_M de shared/jobs.js, lues ici pour que la garantie suive la règle du
    // serveur : hors couronne, pickSpot se replie sur le point le plus proche au-delà du minimum, donc une course
    // plus longue que prévu), et un entre 900 et 2 000 m (Chiche : DARE_MIN_M / DARE_MAX_M de server/game.js)
    assert.ok(JOB_MIN_M > 0 && JOB_MAX_M > JOB_MIN_M, 'couronne des courses de taxi');
    const ring = (q, a, b) => pts.some((p) => { const d = dist(p, q); return d >= a && d <= b; });
    const taxi = `aucun rendez-vous entre ${JOB_MIN_M} et ${JOB_MAX_M} m (course de taxi)`;
    for (const m of MISSIONS) for (const [i, q] of [m.start, ...m.steps].entries()) {
      const where = `mission ${m.id}, ${i ? `étape ${i - 1}` : 'départ'}`;
      assert.ok(ring(q, JOB_MIN_M, JOB_MAX_M), `${where}: ${taxi}`);
      assert.ok(ring(q, 900, 2000), `${where}: aucun rendez-vous entre 900 et 2 000 m`);
    }
    // … ainsi que le point d'apparition, les concessions et les parkings publics
    for (const q of [places.SPAWN, ...places.DEALERS, ...places.PUBLIC_GARAGES]) assert.ok(ring(q, JOB_MIN_M, JOB_MAX_M), `${q.id || 'SPAWN'}: ${taxi}`);
  });

  // ---- tests liés au réseau routier de la ville (ignorés tant que le fichier n'est pas généré) ----
  const roadsFile = new URL('.' + CITIES[city].files.roads.replace(/^\/shared/, ''), import.meta.url);
  test(`${city} — réseau routier : points proches d'une chaussée, distances et chronos tenables, GPS rapide`, { skip: !existsSync(roadsFile) && `${CITIES[city].files.roads} absent` }, async () => {
    const { createRouter, createRoadIndex, snapStepToRoad, isWalkable, isStreet, isDrivable } = await import('../client/src/gameplay/gps.js');
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
    // points de rendez-vous (contrat v6) : SUR une rue carrossable au niveau du sol (ni voie rapide, ni trémie, ni
    // tablier, ni voie de desserte), sans autre chaussée plus proche à un autre niveau, et joignables par le GPS
    // depuis le point d'apparition comme vers lui (une arrivée de course n'est pas recalée : elle doit être exacte)
    for (const p of places.RDV_POINTS) {
      const where = `rendez-vous ${p.id}`;
      const s = roads.nearest(p.x, p.z, 60, isStreet, 0);
      assert.ok(s && s.dist <= 6, `${where}: à ${s ? s.dist.toFixed(1) : '∞'} m de l'axe d'une rue carrossable`);
      assert.ok(Math.abs(s.ele) < 0.05, `${where}: rue dénivelée (ele ${s.ele.toFixed(2)})`);
      const n = roads.nearest(p.x, p.z, 60, isDrivable);
      assert.ok(n && n.dist <= 6 && Math.abs(n.ele) < 0.05, `${where}: la chaussée la plus proche (${n?.road?.name || '?'}) est à ${n ? n.dist.toFixed(1) : '∞'} m, ele ${n ? n.ele.toFixed(2) : '?'}`);
      for (const [a, b, sens] of [[places.SPAWN, p, 'aller'], [p, places.SPAWN, 'retour']]) {
        const r = router.route(a.x, a.z, b.x, b.z, { metric, budgetMs: 1000 });
        assert.ok(r.routed && !r.partial, `${where}: ${sens} non routé depuis le point d'apparition`);
      }
      // le graphe passe au pied du point : l'itinéraire d'aller s'achève à moins de 25 m
      const r = router.route(places.SPAWN.x, places.SPAWN.z, p.x, p.z, { metric, budgetMs: 1000 });
      const end = r.path[r.path.length - 2];
      assert.ok(Math.hypot(end[0] - p.x, end[1] - p.z) <= 25, `${where}: graphe routier à ${Math.hypot(end[0] - p.x, end[1] - p.z).toFixed(0)} m`);
    }
    // mission d'introduction et missions « retour » : départ résolu comme le fait le client (rue carrossable la
    // plus proche pour une mission en voiture), toujours à moins de 150 m de sa référence
    {
      const resolve = (m) => roads.nearest(m.start.x, m.start.z, 400, m.requireVehicle ? isStreet : isWalkable, 0);
      const intro = MISSIONS.find((m) => m.intro), s = resolve(intro);
      assert.ok(s && Math.hypot(s.x - places.SPAWN.x, s.z - places.SPAWN.z) < 150, `intro: départ recalé à ${s ? Math.hypot(s.x - places.SPAWN.x, s.z - places.SPAWN.z).toFixed(0) : '∞'} m du point d'apparition`);
      assert.ok(s.dist <= 12, `intro: départ à ${s.dist.toFixed(0)} m d'une rue carrossable (il doit être sur la chaussée)`);
      const from = MISSIONS.find((m) => m.id === exp.returns.from), end = snapStepToRoad(roads, from.steps.at(-1));
      for (const id of exp.returns.ids) {
        const q = resolve(MISSIONS.find((m) => m.id === id));
        assert.ok(q && Math.hypot(q.x - end.x, q.z - end.z) < 150, `mission ${id}: départ recalé à ${q ? Math.hypot(q.x - end.x, q.z - end.z).toFixed(0) : '∞'} m de l'arrivée recalée de ${from.id}`);
      }
    }
    // enchaînement de niveau 1 PAR LA ROUTE (graphe orienté : sens uniques compris). À vol d'oiseau, une arrivée peut
    // être à 100 m d'un départ et à 1,5 km de ruban GPS (rue à issue unique) : on mesure donc l'itinéraire réel
    // entre chaque arrivée recalée et le départ résolu (comme le client) de niveau 1 le plus proche.
    {
      assert.ok(router.directed, 'le graphe routier doit être orienté pour juger les enchaînements');
      const l1 = MISSIONS.filter((m) => m.level === 1);
      const startOf = (m) => roads.nearest(m.start.x, m.start.z, 400, m.requireVehicle ? isStreet : isWalkable, 0) || m.start;
      for (const m of l1) {
        const end = snapStepToRoad(roads, m.steps.at(-1));
        let best = Infinity, to = null;
        for (const o of l1) {
          if (o === m) continue;
          const s = startOf(o);
          const r = router.route(end.x, end.z, s.x, s.z, { metric, fromEle: end.ele, toEle: s.ele, budgetMs: 1000 });
          if (!r.partial && r.length < best) { best = r.length; to = o.id; }
        }
        assert.ok(best < NEXT_START_ROAD_MAX, `mission ${m.id}: le départ de niveau 1 le plus proche de son arrivée (${to}) est à ${best.toFixed(0)} m par la route (moins de ${NEXT_START_ROAD_MAX} m attendus)`);
      }
      // pas de livraison « à 800 m » qui demande 3 km de boulevards : au niveau 1, un parcours de plus de 2 km par la
      // route ne dépasse pas 2,5 fois son vol d'oiseau
      for (const m of l1) {
        if (m.anyOrder) continue;
        let prev = m.start, real = 0;
        for (const s of m.steps) { const q = snapStepToRoad(roads, s); real += router.route(prev.x, prev.z, q.x, q.z, { metric, fromEle: prev.ele, toEle: q.ele, budgetMs: 1000 }).length; prev = q; }
        const air = missionPathLength(m);
        assert.ok(real <= L1_DETOUR_FREE_M || real <= air * L1_DETOUR_MAX, `mission ${m.id}: ${real.toFixed(0)} m par la route pour ${air.toFixed(0)} m à vol d'oiseau (détour × ${(real / air).toFixed(1)})`);
      }
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

// Contrat v6 « boucle fun et rétention » : modules PURS (protocole, économie, carnet de bord, taxi libre).
// Aucun serveur n'est lancé ici : les handlers et le client réseau ont leurs propres tests (fun.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as PROTO from '../../shared/protocol.js';
import * as eco from '../../shared/economy.js';
import * as J from '../../shared/journal.js';
import * as jobs from '../../shared/jobs.js';
import * as CAT from '../../shared/catalog.js';
import * as CORE from '../../shared/content-core.js';
import { MISSIONS_BY_CITY, ALL_MISSION_BY_ID, missionRouteLength } from '../../shared/missions.js';
import { PROPERTIES_BY_CITY, ALL_PROPERTY_BY_ID } from '../../shared/properties.js';
import { LANDMARKS_BY_CITY } from '../../shared/landmarks.js';
import { geoFor, CITY_IDS } from '../../shared/cities.js';

const { C, S, ANIMS } = PROTO;
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 0, 15, 11, 0, 0); // jeudi 15 janvier 2026, midi à Paris : loin de la bascule de 4 h
const R = [600, 1500, 3000, 5500, 10000, 16000];
const LEVEL_AT = [0, 3, 8, 15, 25, 40]; // missions réussies pour atteindre les niveaux 1..6

let seq = 0;
/** Profil neuf, avec `done` missions réussies et un solde choisi. */
function profile({ done = 0, money, name = 'Alice' } = {}) {
  const p = eco.newProfile('p' + String(++seq).padStart(16, '0'), name);
  p.stats.missionsDone = done;
  if (money != null) p.money = money;
  return p;
}
const session = () => ({ mission: null });
const lastStep = (m) => m.steps[m.steps.length - 1];
/** Joue une mission de bout en bout : démarrage à `t`, arrivée `sec` secondes plus tard à la position `pos`. */
function play(p, s, m, t, { sec = m.minDurationSec + 30, pos = lastStep(m), sport = false, city = m.city } = {}) {
  const st = eco.missionStart(p, s, m.id, t, city);
  assert.equal(st.ok, true, `démarrage de ${m.id} : ${st.text}`);
  if (sport) s.mission.sport = true;
  return eco.missionComplete(p, s, m.id, t + sec * 1000, city, { pos: pos && { x: pos.x, z: pos.z } });
}
/** Première mission chronométrée (non photo, étapes dans l'ordre) d'un niveau donné. */
const timedMission = (city, level) => MISSIONS_BY_CITY[city].find((m) => m.level === level && m.type !== 'photo' && !m.anyOrder && !m.intro);
/** Remplit les compteurs du jour pour que les trois défis soient réussis. */
function fillDay(p, now) {
  const st = J.dailyState(p, now), c = p.journal.day.c;
  for (const e of st.list) {
    if (e.kind === 'star') c.star = 1;
    else if (e.kind === 'missions') c.m = e.goal;
    else if (e.kind === 'types') c.types = Object.keys(CORE.MISSION_TYPES).slice(0, e.goal);
    else if (e.kind === 'fares') c.fares = e.goal;
    else if (e.kind === 'km') c.km = e.goal;
    else if (e.kind === 'style') c.style = e.goal;
  }
  return st;
}
/** Réussit et encaisse toute la journée : retourne le total crédité. */
function fullDay(p, now) {
  fillDay(p, now);
  let total = 0;
  for (const id of ['d1', 'd2', 'd3', 'full']) { const r = eco.claim(p, { kind: 'daily', id }, { now }); assert.equal(r.ok, true, `${id} : ${r.text}`); total += r.delta; }
  return total;
}
const bytes = (o) => Buffer.byteLength(JSON.stringify(o));

// =============================================================================== protocole

test('protocole v6 : constantes C et S du contrat, version 1, capacités', () => {
  assert.equal(PROTO.PROTOCOL_VERSION, 1);
  const c = { BUY_CAR: 'buy_car', PAINT_CAR: 'paint_car', SET_LOOK: 'set_look', CLAIM: 'claim', JOB_START: 'job_start', JOB_DONE: 'job_done', JOB_ABORT: 'job_abort',
    DARE: 'dare', DARE_JOIN: 'dare_join', DARE_GO: 'dare_go', DARE_LEAVE: 'dare_leave', EMOTE: 'emote', BUMP: 'bump', HEAT: 'heat', STYLE: 'style' };
  for (const [k, v] of Object.entries(c)) assert.equal(C[k], v, `C.${k}`);
  const s = { LOOK: 'look', RECORDS: 'records', JOURNAL: 'journal', FEED: 'feed', JOB: 'job', JOB_RESULT: 'job_result', DARE: 'dare', DARE_END: 'dare_end', EMOTE: 'emote' };
  for (const [k, v] of Object.entries(s)) assert.equal(S[k], v, `S.${k}`);
  // aucun identifiant existant renommé
  const old = { HELLO: 'hello', STATE: 'st', PING: 'ping', CHAT: 'chat', MISSION_START: 'mission_start', MISSION_COMPLETE: 'mission_complete', MISSION_ABORT: 'mission_abort',
    SET_ACTIVE_CAR: 'set_car', BUY_PROPERTY: 'buy_prop', SELL_PROPERTY: 'sell_prop', TRANSFER: 'transfer' };
  for (const [k, v] of Object.entries(old)) assert.equal(C[k], v, `C.${k}`);
  const oldS = { WELCOME: 'welcome', ERROR: 'error', PROFILE: 'profile', SNAPSHOT: 'snap', JOIN: 'join', LEAVE: 'leave', CHAT: 'chat', MISSION_RESULT: 'mission_result', OWNERS: 'owners', LEADERBOARD: 'lb', PONG: 'pong' };
  for (const [k, v] of Object.entries(oldS)) assert.equal(S[k], v, `S.${k}`);
  // un type par message dans chaque sens
  assert.equal(new Set(Object.values(C)).size, Object.values(C).length);
  assert.equal(new Set(Object.values(S)).size, Object.values(S).length);
  assert.deepEqual(PROTO.FEATS, ['fun1', 'taxi', 'dare', 'heat', 'paint']);
  assert.deepEqual(PROTO.FEATS_OFFLINE, ['fun1', 'taxi', 'heat', 'paint', 'offline']);
});

test('protocole v6 : ANIMS étendu EN FIN de tableau, chutes transmises, index inconnu décodé en idle', () => {
  assert.deepEqual(ANIMS, ['idle', 'walk', 'run', 'sit', 'jump', 'fall', 'swim', 'drive', 'lying', 'getup', 'stumble']);
  for (const [anim, i] of [['lying', 8], ['getup', 9], ['stumble', 10]]) {
    const a = PROTO.encodeState({ x: 1, y: 0, z: 2, yaw: 0, speed: 0, mode: 'foot', anim });
    assert.equal(a[6], i);
    assert.equal(PROTO.decodeState(a).anim, anim);
  }
  // un pair plus ancien (tableau de 8 animations) décode 8..10 en 'idle' : même repli ici pour un index hors table
  assert.equal(PROTO.decodeState([0, 0, 0, 0, 0, 0, 99]).anim, 'idle');
  assert.equal(PROTO.encodeState({ x: 0, y: 0, z: 0, yaw: 0, speed: 0, mode: 'foot', anim: 'inconnue' })[6], 0);
});

test('protocole v6 : chaque message client nouveau tient largement sous MAX_MESSAGE_BYTES', () => {
  const samples = [
    [C.BUY_CAR, { typeId: 'lambo_aventador', color: '#ff7a00' }], [C.PAINT_CAR, { typeId: 'lambo_aventador', color: '#ff7a00' }], [C.SET_LOOK, { horn: 'cucaracha' }],
    [C.CLAIM, { kind: 'daily', id: 'full' }], [C.JOB_START, { kind: 'taxi' }], [C.JOB_DONE, { id: 'jabcdefgh12', hits: 5 }], [C.JOB_ABORT, {}],
    [C.DARE, { stake: 2000 }], [C.DARE_JOIN, { id: 'd123456' }], [C.DARE_GO, {}], [C.DARE_LEAVE, {}], [C.EMOTE, { k: 4 }], [C.BUMP, { by: 'p0123456789abcdef' }],
    [C.HEAT, { ev: 'escape', k: 3, sec: 599.9, how: 'dist' }], [C.STYLE, { pts: 123456, combo: 60000, drift: 59.9, air: 5.9, near: 240, props: 960 }],
  ];
  for (const [t, payload] of samples) {
    const raw = PROTO.encode(t, payload);
    assert.ok(Buffer.byteLength(raw) < PROTO.MAX_MESSAGE_BYTES / 8, t);
    assert.equal(PROTO.decode(raw).t, t);
  }
});

test('imports entre lots : les tables nouvelles des autres lots sont lues par espace de noms, jamais par import nommé', () => {
  for (const file of ['economy.js', 'journal.js', 'jobs.js']) {
    const src = readFileSync(new URL(`../../shared/${file}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
      for (const name of ['PAINTS', 'PAINT_BY_COLOR', 'HORNS', 'HORN_BY_ID', 'starsFor', 'LEGEND_STAR_EVERY', 'RDV_POINTS']) {
        assert.ok(!new RegExp(`\\b${name}\\b`).test(m[1]), `${file} : import nommé de ${name}`);
      }
    }
  }
});

// =============================================================================== profil

test('classOf : Ville = à pied, Citadine, Taxi, Fulgur Étincelle, Fulgur Monolithe ; Sport = le reste', () => {
  assert.equal(eco.CLASS_SPEED, 62);
  for (const id of ['citadine', 'taxi', 'tesla_model3', 'tesla_cybertruck']) assert.equal(eco.classOf(id), 'v', id);
  for (const id of ['tesla_models', 'porsche_911', 'porsche_taycan', 'porsche_cayenne', 'lambo_huracan', 'lambo_aventador', 'lambo_urus']) assert.equal(eco.classOf(id), 's', id);
  for (const id of [null, undefined, '', 'inconnue', 'constructor', '__proto__']) assert.equal(eco.classOf(id), 'v', String(id)); // à pied ou modèle inconnu
  for (const v of CAT.VEHICLES) assert.equal(eco.classOf(v.id), v.maxSpeed > 62 ? 's' : 'v', v.id);
});

test('normalizeProfile : un profil au format d’avant le contrat v6 est complété sans rien perdre, et la réparation est idempotente', () => {
  const m = MISSIONS_BY_CITY.paris[0];
  const old = { id: 'p00000000000000aa', name: 'Ancien', money: 12345, cars: ['citadine', 'taxi'], activeCar: 'taxi', tokenHash: 'abc', createdAt: 1, lastSeen: 2,
    stats: { missionsDone: 7, earned: 9000, playSeconds: 321.5 }, cooldowns: { [m.id]: 1700000000000 }, rentCarry: 0.4 };
  const p = eco.normalizeProfile(structuredClone(old));
  for (const k of Object.keys(old)) if (k !== 'stats') assert.deepEqual(p[k], old[k], `champ ${k} conservé`);
  for (const k of Object.keys(old.stats)) assert.equal(p.stats[k], old.stats[k], `stats.${k} conservé`);
  // les statistiques du contrat v6 naissent à 0 et sont toutes exposées
  assert.deepEqual(Object.keys(p.stats), eco.STAT_KEYS);
  for (const k of eco.STAT_KEYS) if (!(k in old.stats)) assert.equal(p.stats[k], 0, k);
  assert.deepEqual(Object.keys(eco.publicProfile(p, [], 'paris').stats), eco.STAT_KEYS);
  assert.deepEqual(eco.newProfile('p9', 'Neuf').stats, Object.fromEntries(eco.STAT_KEYS.map((k) => [k, 0])));
  assert.deepEqual(p.best, {});
  assert.deepEqual(p.carColors, {});
  assert.deepEqual(p.look, { h: 'std' });
  assert.equal(p.journal.v, 1);
  assert.deepEqual(p.journal.streak, { n: 0, last: '', best: 0 });
  assert.deepEqual(eco.normalizeProfile(structuredClone(p)), p, 'idempotent');
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p, 'le profil reste du JSON pur (sauvegarde sans perte)');
});

test('normalizeProfile : valeurs abîmées ramenées aux défauts (klaxon retiré du catalogue, teintes, records, journal)', () => {
  const m = MISSIONS_BY_CITY.paris[0];
  const p = eco.normalizeProfile({ id: 'p1', name: 'X', money: 10, cars: ['citadine', 'taxi'], activeCar: 'taxi',
    stats: { missionsDone: 3, fares: 'douze', bestCombo: -5, distance: 1200.5, escapes: 2 },
    best: { [m.id]: { v: 61.234, s: 'x', z: 3 }, mission_supprimee: { v: 10 }, constructor: { v: 1 } },
    carColors: { taxi: '#ABC', citadine: 'rouge', porsche_911: '#ffffff' }, look: { h: 'klaxon_disparu' }, journal: 'cassé' });
  assert.deepEqual(p.best, { [m.id]: { v: 61.2 } });
  assert.deepEqual(p.carColors, { taxi: '#aabbcc' }, 'couleur normalisée ; voiture non possédée ou teinte invalide écartée');
  assert.deepEqual(p.look, { h: 'std' });
  assert.deepEqual(p.stats, { ...Object.fromEntries(eco.STAT_KEYS.map((k) => [k, 0])), missionsDone: 3, distance: 1200.5, escapes: 2 });
  assert.equal(p.journal.day.k, '');
  // un klaxon du catalogue est conservé
  const horn = (CAT.HORNS || []).find((h) => h.id !== 'std');
  if (horn) assert.deepEqual(eco.normalizeProfile({ ...eco.newProfile('p2', 'Y'), look: { h: horn.id } }).look, { h: horn.id });
});

test('publicProfile : cooldowns filtrés sur la ville de la salle, carColors et look exposés, best et journal jamais', () => {
  const p = profile();
  for (const m of [...MISSIONS_BY_CITY.paris, ...MISSIONS_BY_CITY.toulouse]) p.cooldowns[m.id] = T0;
  p.cars.push('taxi'); p.carColors.taxi = '#111111'; p.best[MISSIONS_BY_CITY.paris[0].id] = { v: 60 };
  for (const city of ['paris', 'toulouse']) {
    const me = eco.publicProfile(p, [], city);
    assert.deepEqual(Object.keys(me.cooldowns).sort(), MISSIONS_BY_CITY[city].map((m) => m.id).sort(), `toutes les missions de ${city}, et elles seules`);
    assert.deepEqual(me.carColors, { taxi: '#111111' });
    assert.deepEqual(me.look, { h: 'std' });
    assert.ok(!('best' in me) && !('journal' in me) && !('tokenHash' in me) && !('rentCarry' in me));
  }
  // sans ville (appelant d'avant le contrat v6) : rien n'est filtré
  assert.equal(Object.keys(eco.publicProfile(p, []).cooldowns).length, MISSIONS_BY_CITY.paris.length + MISSIONS_BY_CITY.toulouse.length);
  // la vue ne partage aucune référence avec le profil
  const me = eco.publicProfile(p, ['x'], 'paris');
  me.carColors.taxi = '#000000'; me.look.h = 'zzz'; me.cars.push('y');
  assert.equal(p.carColors.taxi, '#111111'); assert.equal(p.look.h, 'std'); assert.equal(p.cars.length, 2);
});

test('poids : S.PROFILE <= 3 300 octets pour le profil le plus lourd, <= 1 300 pour un profil de début ; journal < 1,2 ko', () => {
  const stats = { earned: 987654321, playSeconds: 3600000.5, distance: 12345678.9, topSpeed: 96.97, fares: 1234, fareBestChain: 42, fareEarned: 12345678, bestCombo: 60000,
    bestDrift: 59.9, bestAir: 5.9, nearMisses: 12345, propsBroken: 123456, escapes: 123, bestEscapeSec: 8.4, fines: 123, daresWon: 123, bumpsGiven: 123, bumpsTaken: 123, dailyDone: 1234 };
  const paints = (CAT.PAINTS || []).map((t) => t.color);
  for (const city of ['paris', 'toulouse']) {
    // le plus lourd : 11 voitures peintes, toutes les missions des DEUX villes réussies, tous les biens de la ville, pseudo de 16 caractères
    const p = profile({ done: 1234, money: 987654321, name: 'Maximilien-le-16' });
    p.cars = CAT.VEHICLES.map((v) => v.id); p.activeCar = 'lambo_aventador';
    CAT.VEHICLES.forEach((v, i) => { p.carColors[v.id] = paints[i % (paints.length || 1)] || v.colors[0]; });
    for (const m of [...MISSIONS_BY_CITY.paris, ...MISSIONS_BY_CITY.toulouse]) { p.cooldowns[m.id] = T0; p.best[m.id] = { v: 123.4, s: 98.7 }; }
    Object.assign(p.stats, stats);
    eco.normalizeProfile(p);
    const props = PROPERTIES_BY_CITY[city].map((x) => x.id);
    const heavy = bytes({ t: S.PROFILE, me: eco.publicProfile(p, props, city), delta: 123456, reason: 'journée complète' });
    assert.ok(heavy <= 3300, `${city} : profil lourd ${heavy} octets`);
    // début : 2 voitures, 10 missions
    const q = profile({ done: 10 }); q.cars.push('taxi'); q.carColors.taxi = '#111111';
    for (const m of MISSIONS_BY_CITY[city].slice(0, 10)) q.cooldowns[m.id] = T0;
    Object.assign(q.stats, { earned: 31000, playSeconds: 2400, distance: 41234.5, topSpeed: 43.9, fares: 6, fareBestChain: 3, fareEarned: 5200, bestCombo: 4200, bestDrift: 3.1, bestAir: 0.8,
      nearMisses: 14, propsBroken: 31, escapes: 1, bestEscapeSec: 23, fines: 1, bumpsGiven: 1, bumpsTaken: 2, dailyDone: 2 });
    const light = bytes({ t: S.PROFILE, me: eco.publicProfile(q, [], city), delta: 1500, reason: 'mission' });
    assert.ok(light <= 1300, `${city} : profil de début ${light} octets`);
    // journal le plus chargé : 8 salles mémorisées, tous les compteurs au plafond
    for (let i = 0; i < 12; i++) { const k = i ? `toulouse:salle-des-amis-${i}` : 'amis'; J.touchRent(p, k, T0 - i * 1000); p.journal.away[k] = { rent: 1463580, sec: 43200000 }; }
    eco.normalizeProfile(p);
    J.rollDay(p, T0);
    Object.assign(p.journal.day.c, { m: 99, km: 59999.9, fares: 99, style: 50000, star: 1, types: Object.keys(CORE.MISSION_TYPES) });
    p.journal.day.claimed = ['d1', 'd2', 'd3']; p.journal.day.full = true;
    p.journal.streak = { n: 365, last: p.journal.day.k, best: 365 }; p.journal.fareWin = { at: T0, paid: 37500 }; p.journal.fineAt = T0;
    assert.equal(Object.keys(p.journal.rentAt).length, 8);
    assert.equal(Object.keys(p.journal.away).length, 8);
    assert.ok(bytes(p.journal) < 1200, `journal stocké ${bytes(p.journal)} octets`);
    assert.ok(bytes({ t: S.JOURNAL, j: J.publicJournal(p, T0, city, {}, 'aucune') }) < 1200, 'vue S.JOURNAL');
  }
});

// =============================================================================== missions

test('missionStart : mission de niveau 6 refusée (locked) pour un compte neuf, acceptée au niveau requis', () => {
  for (const city of ['paris', 'toulouse']) {
    for (const m of MISSIONS_BY_CITY[city]) {
      const s = session();
      const low = eco.missionStart(profile({ done: LEVEL_AT[m.level - 1] - 1 }), s, m.id, T0, city);
      if (m.level > 1) { assert.deepEqual([low.ok, low.code], [false, 'locked'], m.id); assert.match(low.text, new RegExp(`niveau ${m.level}`)); assert.equal(s.mission, null); }
      const ok = eco.missionStart(profile({ done: LEVEL_AT[m.level - 1] }), s, m.id, T0, city);
      assert.equal(ok.ok, true, m.id);
      assert.deepEqual(s.mission, { id: m.id, startedAt: T0, sport: false, moved: 0 });
    }
  }
  const six = MISSIONS_BY_CITY.paris.find((m) => m.level === 6);
  assert.equal(eco.missionStart(profile(), session(), six.id, T0, 'paris').code, 'locked');
  // l'ordre des refus est stable : ville avant niveau, niveau avant cooldown
  assert.equal(eco.missionStart(profile(), session(), six.id, T0, 'toulouse').code, 'wrong_city');
  assert.equal(eco.missionStart(profile(), session(), 'nexiste_pas', T0, 'paris').code, 'unknown_mission');
});

test('missionStart : annule la course de taxi en cours', () => {
  const p = profile(), s = session();
  s.job = { id: 'j1' };
  assert.equal(eco.missionStart(p, s, MISSIONS_BY_CITY.paris[0].id, T0, 'paris').ok, true);
  assert.equal(s.job, null);
});

test('missionComplete : sec = durée de l’horloge serveur, total crédité, done = stats.missionsDone', () => {
  const m = timedMission('paris', 1), p = profile(), s = session();
  const r = play(p, s, m, T0, { sec: 187.26 });
  assert.equal(r.ok, true);
  assert.equal(r.sec, 187.3, 'durée serveur à 0,1 s près');
  assert.deepEqual([r.id, r.cls, r.finishOk, r.timed, r.best, r.pb, r.reason, r.title], [m.id, 'v', true, true, null, true, 'mission', m.title]);
  assert.equal(r.base, m.reward);
  assert.equal(r.first, Math.floor(m.reward * 0.25));
  assert.equal(r.reward, r.base + r.first + r.star);
  assert.equal(r.delta, r.reward);
  assert.equal(p.money, CAT.STARTING_MONEY + r.reward);
  assert.equal(p.stats.earned, r.reward);
  assert.deepEqual([r.done, p.stats.missionsDone], [1, 1]);
  assert.equal(s.mission, null);
  assert.equal(p.cooldowns[m.id], T0 + 187260);
  assert.deepEqual(p.best[m.id], { v: 187.3 });
  // rejouer la même réponse ne paie pas deux fois
  assert.equal(eco.missionComplete(p, s, m.id, T0 + 200000, 'paris', { pos: lastStep(m) }).code, 'not_started');
});

test('missionComplete : position hors tolérance => gain de base payé, ni record ni prime ; sans position connue, idem', () => {
  const m = timedMission('paris', 1), end = lastStep(m);
  const tol = end.radius + 250 + (end.snapTo?.max || 0);
  for (const pos of [{ x: end.x + tol + 5, z: end.z }, null, { x: NaN, z: 0 }]) {
    const p = profile(), s = session();
    const r = play(p, s, m, T0, { pos });
    assert.deepEqual([r.ok, r.finishOk, r.reward, r.first, r.star, r.pb, r.best], [true, false, m.reward, 0, 0, false, null]);
    assert.deepEqual(p.best, {}, 'aucun record sans arrivée plausible');
    assert.equal(p.money, CAT.STARTING_MONEY + m.reward);
    assert.equal(p.stats.missionsDone, 1, 'la réussite compte quand même');
  }
  // juste dans la tolérance : tout est accordé
  const p = profile(), r = play(p, session(), m, T0, { pos: { x: end.x + tol - 1, z: end.z } });
  assert.deepEqual([r.finishOk, r.first > 0, r.pb], [true, true, true]);
  // sans ctx du tout (appelant d'avant le contrat v6) : même résultat qu'avant, gain de base seul
  const q = profile(), sq = session();
  eco.missionStart(q, sq, m.id, T0, 'paris');
  const legacy = eco.missionComplete(q, sq, m.id, T0 + (m.minDurationSec + 5) * 1000, 'paris');
  assert.deepEqual([legacy.ok, legacy.reward, legacy.delta, legacy.reason, legacy.finishOk], [true, m.reward, m.reward, 'mission', false]);
});

test('missionComplete : tolérance d’arrivée = rayon + 250 m + snapTo.max ; ordre libre = une étape quelconque', () => {
  const snapped = Object.values(ALL_MISSION_BY_ID).find((m) => !m.anyOrder && lastStep(m).snapTo?.max > 0);
  if (snapped) {
    const end = lastStep(snapped), reach = end.radius + 250 + end.snapTo.max;
    for (const [d, ok] of [[reach - 2, true], [reach + 2, false]]) {
      const r = play(profile({ done: 40 }), session(), snapped, T0, { pos: { x: end.x, z: end.z + d } });
      assert.equal(r.finishOk, ok, `${snapped.id} à ${Math.round(d)} m`);
    }
  }
  const any = Object.values(ALL_MISSION_BY_ID).find((m) => m.anyOrder && m.steps.length > 2);
  assert.ok(any, 'une mission en ordre libre existe');
  for (const step of any.steps) assert.equal(play(profile({ done: 40 }), session(), any, T0, { pos: step }).finishOk, true, step.label);
  const far = { x: Math.max(...any.steps.map((s) => s.x)) + 2000, z: any.steps[0].z };
  assert.equal(play(profile({ done: 40 }), session(), any, T0, { pos: far }).finishOk, false);
});

test('missionComplete : prime de première réussite (+25 %) versée une seule fois', () => {
  const m = timedMission('toulouse', 1), p = profile(), s = session();
  // un jour où la mission n'est pas la vedette, pour isoler la prime
  let t = T0;
  while (J.starFor(J.dayKey(t), 'toulouse', 1) === m.id) t += DAY;
  const a = play(p, s, m, t);
  assert.deepEqual([a.first, a.star, a.reward], [Math.floor(m.reward * 0.25), 0, m.reward + Math.floor(m.reward * 0.25)]);
  const b = play(p, s, m, t + (m.minDurationSec + 30 + m.cooldownSec + 1) * 1000);
  assert.deepEqual([b.ok, b.first, b.reward], [true, 0, m.reward]);
  // première réussite sans arrivée plausible : pas de prime, et elle n'est pas rattrapable (la clé de cooldown existe)
  const q = profile(), sq = session();
  assert.equal(play(q, sq, m, t, { pos: null }).first, 0);
  assert.equal(play(q, sq, m, t + (m.minDurationSec + 30 + m.cooldownSec + 1) * 1000).first, 0);
});

test('missionComplete : un état en voiture de sport pendant la mission => cls s, le record v ne bouge pas', () => {
  const m = timedMission('paris', 1), p = profile(), s = session();
  const v1 = play(p, s, m, T0, { sec: 200 });
  assert.deepEqual([v1.cls, v1.pb, v1.best], ['v', true, null]);
  let t = T0 + (200 + m.cooldownSec + 1) * 1000;
  const s1 = play(p, s, m, t, { sec: 90, sport: true }); // bien plus rapide, mais en Muggini Furiosa
  assert.deepEqual([s1.cls, s1.pb, s1.best], ['s', true, null]);
  assert.deepEqual(p.best[m.id], { v: 200, s: 90 }, 'le record Ville est intact');
  // record personnel : battu seulement par un temps strictement meilleur, `best` = ancien record de la catégorie
  t += (90 + m.cooldownSec + 1) * 1000;
  const v2 = play(p, s, m, t, { sec: 230 });
  assert.deepEqual([v2.cls, v2.pb, v2.best], ['v', false, 200]);
  t += (230 + m.cooldownSec + 1) * 1000;
  const v3 = play(p, s, m, t, { sec: 180.04 });
  assert.deepEqual([v3.pb, v3.best], [true, 200]);
  assert.deepEqual(p.best[m.id], { v: 180, s: 90 });
});

test('missionComplete : pas de record pour les missions photo', () => {
  const m = MISSIONS_BY_CITY.paris.find((x) => x.type === 'photo' && x.level === 1), p = profile();
  const r = play(p, session(), m, T0);
  assert.deepEqual([r.ok, r.timed, r.pb, r.best, r.finishOk], [true, false, false, null, true]);
  assert.deepEqual(p.best, {});
  assert.equal(eco.missionTimed(m.id), false);
  assert.equal(eco.missionTimed(timedMission('paris', 1).id), true);
  assert.equal(eco.missionTimed('nexiste_pas'), false);
});

test('missionComplete : mission vedette payée double une fois par jour, compteurs du jour, montée de niveau et étoiles signalées', () => {
  const p = profile(), s = session();
  const k = J.dayKey(T0), starId = J.starFor(k, 'paris', 1), m = ALL_MISSION_BY_ID[starId];
  assert.ok(m && m.level === 1, 'la vedette d’un débutant est une mission de niveau 1');
  const a = play(p, s, m, T0);
  assert.deepEqual([a.star, a.first, a.reward], [m.reward, Math.floor(m.reward * 0.25), m.reward * 2 + Math.floor(m.reward * 0.25)]);
  assert.deepEqual(p.journal.day.c, { m: 1, km: 0, fares: 0, style: 0, star: 1, types: [m.type] });
  // la même mission une seconde fois dans la journée : plus de prime vedette
  const b = play(p, s, m, T0 + (m.minDurationSec + 30 + m.cooldownSec + 1) * 1000);
  assert.deepEqual([b.star, b.reward], [0, m.reward]);
  assert.equal(p.journal.day.c.m, 2);
  // sans arrivée plausible, la vedette n'est ni payée double ni validée (elle reste à faire)
  const q = profile(), r = play(q, session(), m, T0, { pos: null });
  assert.deepEqual([r.star, q.journal.day.c.star, q.journal.day.c.m], [0, 0, 1]);
  // dayKey fourni par l'appelant
  const u = profile(), su = session();
  eco.missionStart(u, su, m.id, T0, 'paris');
  eco.missionComplete(u, su, m.id, T0 + (m.minDurationSec + 5) * 1000, 'paris', { pos: lastStep(m), dayKey: k });
  assert.equal(u.journal.day.k, k);
  // montée de niveau à la troisième réussite, étoile à la soixantième
  const lv = profile({ done: 2 }), up = play(lv, session(), timedMission('paris', 1), T0);
  assert.deepEqual([up.done, up.level, up.levelUp, up.stars, up.starUp], [3, 2, true, 0, false]);
  const lg = profile({ done: 59 }), st = play(lg, session(), timedMission('paris', 1), T0);
  assert.deepEqual([st.done, st.level, st.levelUp, st.stars, st.starUp], [60, 6, false, 1, true]);
  assert.equal(eco.levelOf(lg), 6); assert.equal(eco.starsOf(lg), 1);
});

test('missionComplete : refus inchangés (non démarrée, trop rapide, autre ville) et aucun effet de bord', () => {
  const m = [...MISSIONS_BY_CITY.paris].filter((x) => x.level === 1).sort((a, b) => b.minDurationSec - a.minDurationSec)[0];
  const p = profile(), s = session();
  assert.equal(eco.missionComplete(p, s, m.id, T0, 'paris', { pos: lastStep(m) }).code, 'not_started');
  eco.missionStart(p, s, m.id, T0, 'paris');
  assert.equal(eco.missionComplete(p, s, m.id, T0 + (m.minDurationSec / 2) * 1000, 'paris', { pos: lastStep(m) }).code, 'too_fast');
  eco.missionStart(p, s, m.id, T0, 'paris');
  assert.equal(eco.missionComplete(p, s, m.id, T0 + 600000, 'toulouse', { pos: lastStep(m) }).code, 'wrong_city');
  assert.deepEqual([p.money, p.stats.missionsDone, p.best, p.cooldowns], [CAT.STARTING_MONEY, 0, {}, {}]);
});

// =============================================================================== voitures, Atelier, klaxons

test('buyCar(color) : teinte du modèle retenue, teinte étrangère ignorée', () => {
  const car = CAT.VEHICLE_BY_ID.tesla_model3;
  const p = profile({ money: car.price * 3 });
  const r = eco.buyCar(p, car.id, '#C1121F');
  assert.deepEqual([r.ok, r.delta, r.reason, r.name, r.typeId, r.color], [true, -car.price, 'achat véhicule', car.name, car.id, '#c1121f']);
  assert.deepEqual(p.carColors, { [car.id]: '#c1121f' });
  const q = profile({ money: car.price });
  const r2 = eco.buyCar(q, car.id, '#123456'); // pas une teinte de ce modèle
  assert.deepEqual([r2.ok, r2.color], [true, car.colors[0]]);
  assert.deepEqual(q.carColors, {});
  for (const bad of [undefined, null, 42, {}, 'rouge']) { const z = profile({ money: car.price }); assert.equal(eco.buyCar(z, car.id, bad).ok, true); assert.deepEqual(z.carColors, {}); }
  assert.equal(eco.buyCar(p, car.id, '#f2f2f2').code, 'already_owned');
  assert.equal(eco.buyCar(p, '__proto__', '#f2f2f2').code, 'unknown_car');
});

test('paintCar : teinte catalogue 500 Ƶ, nuancier au prix de la table, exclusive verrouillée puis offerte, même teinte refusée', () => {
  const p = profile({ money: 10000 });
  const stock = CAT.VEHICLE_BY_ID.citadine.colors;
  let r = eco.paintCar(p, 'citadine', stock[1]);
  assert.deepEqual([r.ok, r.delta, r.reason, r.color, r.price], [true, -500, 'peinture', stock[1], 500]);
  assert.equal(p.money, 9500);
  assert.equal(p.stats.earned, 0);
  assert.equal(eco.paintCar(p, 'citadine', stock[1]).code, 'same_color');
  assert.equal(eco.paintCar(profile(), 'citadine', stock[0]).code, 'same_color', 'sans teinte enregistrée, la voiture porte la première du catalogue');
  assert.equal(eco.paintCar(p, 'taxi', stock[0]).code, 'not_owned');
  assert.equal(eco.paintCar(p, 'citadine', 'rouge').code, 'bad_color');
  assert.equal(eco.paintCar(p, 'citadine', '#010203').code, 'bad_color');
  assert.equal(p.money, 9500);
  const paints = CAT.PAINTS || [];
  assert.ok(paints.length, 'le nuancier de l’Atelier est livré');
  const paid = paints.find((t) => t.price > 0 && !t.unlock);
  r = eco.paintCar(p, 'citadine', paid.color.toUpperCase());
  assert.deepEqual([r.ok, r.delta, r.color, r.name], [true, -paid.price, paid.color, paid.name]);
  assert.equal(p.carColors.citadine, paid.color);
  const poor = profile({ money: paid.price - 1 });
  assert.equal(eco.paintCar(poor, 'citadine', paid.color).code, 'no_funds');
  assert.deepEqual(poor.carColors, {});
  // exclusives : refusées tant que la condition n'est pas remplie, gratuites ensuite
  for (const t of paints.filter((x) => x.unlock)) {
    const q = profile({ money: 0 });
    const no = eco.paintCar(q, 'citadine', t.color);
    assert.deepEqual([no.ok, no.code], [false, 'locked'], t.id);
    assert.match(no.text, /requis/);
    if (t.unlock.level) q.stats.missionsDone = LEVEL_AT[t.unlock.level - 1];
    if (t.unlock.stars) q.stats.missionsDone = 40 + 20 * t.unlock.stars;
    if (t.unlock.streak) q.journal.streak.best = t.unlock.streak;
    if (t.unlock.combo) q.stats.bestCombo = t.unlock.combo;
    if (t.unlock.fares) q.stats.fares = t.unlock.fares;
    if (t.unlock.escapes) q.stats.escapes = t.unlock.escapes;
    if (t.unlock.dares) q.stats.daresWon = t.unlock.dares;
    const yes = eco.paintCar(q, 'citadine', t.color);
    assert.deepEqual([yes.ok, yes.delta, yes.price, q.money, q.carColors.citadine], [true, 0, 0, 0, t.color], t.id);
    assert.equal(t.price, 0, 'une exclusive est offerte une fois débloquée');
  }
});

test('unlocked / hornsFor / setLook : conditions lues dans des valeurs qui ne décroissent jamais, rien ne se reverrouille', () => {
  const p = profile();
  assert.equal(eco.unlocked(p, undefined), true);
  assert.equal(eco.unlocked(p, {}), true);
  const cases = [
    [{ level: 2 }, (q) => { q.stats.missionsDone = 3; }], [{ streak: 3 }, (q) => { q.journal.streak.best = 3; }], [{ fares: 10 }, (q) => { q.stats.fares = 10; }],
    [{ escapes: 1 }, (q) => { q.stats.escapes = 1; }], [{ dares: 1 }, (q) => { q.stats.daresWon = 1; }], [{ combo: 5000 }, (q) => { q.stats.bestCombo = 5000; }],
    [{ stars: 1 }, (q) => { q.stats.missionsDone = 60; }],
  ];
  for (const [rule, grant] of cases) {
    const q = profile();
    assert.equal(eco.unlocked(q, rule), false, JSON.stringify(rule));
    grant(q);
    assert.equal(eco.unlocked(q, rule), true, JSON.stringify(rule));
  }
  assert.equal(eco.unlocked(profile({ done: 99 }), { inconnue: 1 }), false, 'condition inconnue de ce serveur : verrouillée');
  assert.equal(eco.unlocked(profile({ done: 3 }), { level: 2, fares: 1 }), false, 'toutes les conditions sont exigées');
  // la série EN COURS ne compte pas : seule la meilleure (qui ne redescend jamais) est lue
  const s = profile(); s.journal.streak = { n: 1, last: '2026-01-10', best: 3 };
  assert.equal(eco.unlocked(s, { streak: 3 }), true);
  s.journal.streak = { n: 3, last: '2026-01-10', best: 0 };
  assert.equal(eco.unlocked(s, { streak: 3 }), false);

  assert.deepEqual(eco.hornsFor(profile()), ['std']);
  const horns = CAT.HORNS || [];
  assert.ok(horns.length > 1, 'les klaxons signature sont livrés');
  const all = profile({ done: 200 }); Object.assign(all.stats, { fares: 99, escapes: 9, daresWon: 9, bestCombo: 99999 }); all.journal.streak.best = 9;
  assert.deepEqual(eco.hornsFor(all).sort(), horns.map((h) => h.id).sort());
  assert.deepEqual(eco.hornsFor(profile({ done: 3 })), ['std', ...horns.filter((h) => h.unlock && Object.keys(h.unlock).join() === 'level' && h.unlock.level <= 2).map((h) => h.id)]);

  const locked = horns.find((h) => h.unlock?.level >= 2);
  const q = profile();
  assert.deepEqual(eco.setLook(q, { horn: 'std' }), { ok: true, look: { h: 'std' }, changed: false });
  assert.equal(eco.setLook(q, { horn: locked.id }).code, 'locked');
  assert.equal(eco.setLook(q, { horn: 'nexiste_pas' }).code, 'unknown_horn');
  for (const bad of [undefined, null, {}, { horn: 3 }, { horn: 'constructor' }, { horn: '__proto__' }]) assert.equal(eco.setLook(q, bad).code, 'unknown_horn');
  assert.deepEqual(q.look, { h: 'std' });
  q.stats.missionsDone = LEVEL_AT[locked.unlock.level - 1];
  assert.deepEqual(eco.setLook(q, { horn: locked.id }), { ok: true, look: { h: locked.id }, changed: true });
  assert.deepEqual(eco.publicProfile(q, [], 'paris').look, { h: locked.id });
});

test('worth : liquidités + voitures + biens de la salle ; investir ne fait pas reculer', () => {
  const pent = ALL_PROPERTY_BY_ID.penthouse_vendome;
  const p = profile({ money: 5000000 }), owners = {};
  assert.equal(eco.worth(p, owners), 5000000);
  assert.equal(eco.buyProperty(p, owners, pent.id, 'paris').ok, true);
  assert.equal(p.money, 5000000 - pent.price);
  assert.equal(eco.worth(p, owners), 5000000, 'la fortune ne bouge pas après l’achat du penthouse');
  assert.ok(eco.worth(p, owners) > eco.worth(profile(), owners), 'il reste devant un débutant à 5 000 Ƶ');
  const q = profile({ money: 100000 });
  eco.buyCar(q, 'tesla_model3');
  assert.equal(eco.worth(q, {}), 100000);
  assert.equal(eco.worth(q), 100000, 'registre absent toléré');
  // les biens d'un autre joueur ou d'une autre salle ne comptent pas
  assert.equal(eco.worth(profile({ money: 10 }), owners), 10);
});

test('fine : min(3 % du solde, 300 × képis × niveau), jamais sous 0 Ƶ, au plus une par minute', () => {
  const rich = profile({ money: 1000000 });
  let r = eco.fine(rich, 2, T0);
  assert.deepEqual([r.ok, r.amount, r.delta, r.reason], [true, 600, -600, 'amende']); // plafond 300 × 2 × niveau 1
  assert.equal(rich.stats.fines, 1);
  assert.equal(eco.fine(rich, 2, T0 + 59000).code, 'cooldown');
  assert.equal(rich.money, 999400);
  r = eco.fine(rich, 3, T0 + 60000);
  assert.equal(r.amount, 900);
  const pro = profile({ money: 1000000, done: 40 });
  assert.equal(eco.fine(pro, 3, T0).amount, 5400); // 300 × 3 × niveau 6
  const mid = profile({ money: 10000 });
  mid.stats.earned = 777;
  assert.equal(eco.fine(mid, 3, T0).amount, 300); // 3 % du solde
  assert.deepEqual([mid.money, mid.stats.earned, mid.stats.fines], [9700, 777, 1], 'une amende ne touche pas stats.earned');
  for (const money of [0, 1, 33, 34]) {
    const poor = profile({ money });
    r = eco.fine(poor, 3, T0);
    assert.equal(r.ok, true);
    assert.equal(r.amount, Math.floor(money * 0.03));
    assert.ok(poor.money >= 0 && poor.money === money - r.amount);
  }
  // nombre de képis absurde : ramené dans 1..3, une amende n'est jamais un gain
  const odd = profile({ money: 1000000 });
  [[-5, 300], [0, 300], [NaN, 300], [2.9, 600], [99, 900]].forEach(([k, amount], i) => {
    const before = odd.money, f = eco.fine(odd, k, T0 + i * 60000);
    assert.deepEqual([f.ok, f.amount, f.delta, odd.money], [true, amount, -amount, before - amount], String(k));
  });
});

test('settleDare : somme nulle, chaque perdant paie min(mise, son solde), stats.earned intact', () => {
  const w = profile({ money: 1000 }), a = profile({ money: 5000 }), b = profile({ money: 120 }), c = profile({ money: 0 });
  const before = w.money + a.money + b.money + c.money;
  const r = eco.settleDare(w, [a, b, c], 500);
  assert.deepEqual([r.ok, r.pot, r.delta, r.reason], [true, 620, 620, 'chiche']);
  assert.deepEqual(r.paid, [{ id: a.id, amount: 500 }, { id: b.id, amount: 120 }, { id: c.id, amount: 0 }]);
  assert.deepEqual([w.money, a.money, b.money, c.money], [1620, 4500, 0, 0]);
  assert.equal(w.money + a.money + b.money + c.money, before);
  assert.deepEqual([w.stats.earned, a.stats.earned, w.stats.daresWon, a.stats.daresWon], [0, 0, 1, 0]);
  // mise 0 : personne ne paie, la victoire compte
  const w2 = profile(), l2 = profile();
  assert.equal(eco.settleDare(w2, [l2], 0).pot, 0);
  assert.deepEqual([w2.money, l2.money, w2.stats.daresWon], [CAT.STARTING_MONEY, CAT.STARTING_MONEY, 1]);
  // le vainqueur glissé par erreur parmi les perdants ne se paie pas lui-même ; mise négative ou absurde sans effet
  const w3 = profile({ money: 100 }), l3 = profile({ money: 100 });
  assert.equal(eco.settleDare(w3, [w3, l3], 2000).pot, 100);
  assert.deepEqual([w3.money, l3.money], [200, 0]);
  assert.equal(eco.settleDare(w3, [l3], -500).pot, 0);
  assert.equal(eco.settleDare(w3, [l3], 'beaucoup').pot, 0);
  // plafond de fortune : la somme reste nulle
  const top = profile({ money: eco.MAX_MONEY - 10 }), l4 = profile({ money: 1000 });
  assert.equal(eco.settleDare(top, [l4], 500).pot, 10);
  assert.equal(top.money + l4.money, eco.MAX_MONEY - 10 + 1000);
});

test('styleReport : 100 000 points après 5 s et 100 m => 6 000 retenus (rogné, pas rejeté) ; 0 m => ignoré ; aucun argent', () => {
  const p = profile();
  const big = { pts: 100000, combo: 100000, drift: 999, air: 999, near: 999, props: 999 };
  const r = eco.styleReport(p, big, { winSec: 5, movedM: 100, inVehicle: true, now: T0 });
  assert.deepEqual(r, { ok: true, pts: 6000, combo: 6000, drift: 5, air: 6, near: 10, props: 40, record: true, prevBest: 0, best: 6000 });
  assert.deepEqual([p.stats.bestCombo, p.stats.bestDrift, p.stats.bestAir, p.stats.nearMisses, p.stats.propsBroken], [6000, 5, 6, 10, 40]);
  assert.equal(p.journal.day.c.style, 6000);
  assert.equal(p.money, CAT.STARTING_MONEY);
  assert.equal(p.stats.earned, 0);
  const ign = eco.styleReport(p, big, { winSec: 5, movedM: 0, inVehicle: true, now: T0 });
  assert.deepEqual([ign.ok, ign.code], [false, 'ignored']);
  assert.equal(eco.styleReport(p, big, { winSec: 5, movedM: 49.9, inVehicle: true, now: T0 }).code, 'ignored');
  assert.equal(eco.styleReport(p, big, { winSec: 60, movedM: 5000, inVehicle: false, now: T0 }).code, 'on_foot');
  assert.equal(p.journal.day.c.style, 6000, 'un rapport refusé ne change rien');
  assert.equal(p.stats.nearMisses, 10);
});

test('styleReport : bornes par fenêtre (2 500/s, 60/m, combo 60 000, dérive, saut, frôlements, objets), records max et cumuls, plafond du jour', () => {
  const p = profile();
  // fenêtre plafonnée à 120 s : 2 500 × 120 = 300 000 points au plus, combo <= 60 000
  let r = eco.styleReport(p, { pts: 9e9, combo: 9e9, drift: 200, air: 3.14159, near: 1e6, props: 1e6 }, { winSec: 5000, movedM: 1e6, inVehicle: true, now: T0 });
  assert.deepEqual([r.pts, r.combo, r.drift, r.air, r.near, r.props], [300000, 60000, 60, 3.1, 240, 960]);
  assert.equal(p.journal.day.c.style, 50000, 'compteur du jour plafonné à 50 000 points');
  // un combo honnête de 30 s à 20 m/s peut valoir 36 000 points
  const q = profile();
  r = eco.styleReport(q, { pts: 40000, combo: 40000, drift: 12.34, air: 1.26, near: 7, props: 3 }, { winSec: 30, movedM: 600, inVehicle: true, now: T0 });
  assert.deepEqual([r.pts, r.combo, r.drift, r.air, r.near, r.props, r.record], [36000, 36000, 12.3, 1.3, 7, 3, true]);
  // rapport plus modeste : les records restent (max), les compteurs s'ajoutent, combo <= pts
  r = eco.styleReport(q, { pts: 1200, combo: 5000, drift: 2, air: 0.4, near: 2, props: 1 }, { winSec: 20, movedM: 300, inVehicle: true, now: T0 });
  assert.deepEqual([r.pts, r.combo, r.record, r.prevBest, r.best], [1200, 1200, false, 36000, 36000]);
  assert.deepEqual([q.stats.bestCombo, q.stats.bestDrift, q.stats.bestAir, q.stats.nearMisses, q.stats.propsBroken], [36000, 12.3, 1.3, 9, 4]);
  assert.equal(q.journal.day.c.style, 37200);
  // valeurs absurdes : ramenées à zéro, jamais d'exception ni de NaN dans le profil
  r = eco.styleReport(q, { pts: -5, combo: NaN, drift: 'x', air: null, near: -1, props: Infinity }, { winSec: 20, movedM: 300, inVehicle: true, now: T0 });
  assert.deepEqual([r.ok, r.pts, r.combo, r.drift, r.air, r.near, r.props], [true, 0, 0, 0, 0, 0, 0]);
  assert.equal(eco.styleReport(q, null, { winSec: 20, movedM: 300, inVehicle: true, now: T0 }).ok, true);
  for (const v of Object.values(q.stats)) assert.ok(Number.isFinite(v));
  // le lendemain, le compteur du jour repart de zéro
  eco.styleReport(q, { pts: 500, combo: 500 }, { winSec: 20, movedM: 300, inVehicle: true, now: T0 + DAY });
  assert.equal(q.journal.day.c.style, 500);
});

// =============================================================================== carnet de bord

test('dayKey : bascule à 04:00 Europe/Paris en janvier ET en juillet (03:59 / 04:00)', () => {
  // janvier : Paris = UTC+1, donc 04:00 à Paris = 03:00 UTC
  assert.equal(J.dayKey(Date.UTC(2026, 0, 15, 2, 59, 59)), '2026-01-14', '03:59:59 à Paris');
  assert.equal(J.dayKey(Date.UTC(2026, 0, 15, 3, 0, 0)), '2026-01-15', '04:00:00 à Paris');
  assert.equal(J.dayKey(Date.UTC(2026, 0, 15, 2, 59, 0)), '2026-01-14', '03:59 à Paris');
  // juillet : Paris = UTC+2, donc 04:00 à Paris = 02:00 UTC
  assert.equal(J.dayKey(Date.UTC(2026, 6, 15, 1, 59, 0)), '2026-07-14', '03:59 à Paris');
  assert.equal(J.dayKey(Date.UTC(2026, 6, 15, 2, 0, 0)), '2026-07-15', '04:00 à Paris');
  assert.equal(J.dayKey(Date.UTC(2026, 6, 15, 2, 59, 0)), '2026-07-15', '04:59 à Paris : avec un repli UTC+1 ce serait encore la veille');
  // toute la journée de jeu porte la même clé, y compris après minuit
  assert.equal(J.dayKey(Date.UTC(2026, 0, 15, 22, 0, 0)), '2026-01-15');
  assert.equal(J.dayKey(Date.UTC(2026, 0, 16, 1, 30, 0)), '2026-01-15', '02:30 le 16 : encore la journée du 15');
  // le cache par heure ne mélange pas deux instants éloignés
  assert.equal(J.dayKey(T0), '2026-01-15'); assert.equal(J.dayKey(T0 + DAY), '2026-01-16'); assert.equal(J.dayKey(T0), '2026-01-15');
  assert.equal(J.prevDayKey('2026-01-01'), '2025-12-31');
  assert.equal(J.prevDayKey('2024-03-01'), '2024-02-29');
  assert.equal(J.prevDayKey('n’importe quoi'), '');
});

test('nextResetAt : prochaine bascule à 4 h de Paris, été comme hiver', () => {
  assert.equal(J.nextResetAt(T0), Date.UTC(2026, 0, 16, 3, 0, 0));
  assert.equal(J.nextResetAt(Date.UTC(2026, 0, 16, 2, 59, 0)), Date.UTC(2026, 0, 16, 3, 0, 0));
  assert.equal(J.nextResetAt(Date.UTC(2026, 0, 16, 3, 0, 0)), Date.UTC(2026, 0, 17, 3, 0, 0));
  assert.equal(J.nextResetAt(Date.UTC(2026, 6, 15, 10, 0, 0)), Date.UTC(2026, 6, 16, 2, 0, 0));
  // Nuit du passage à l'heure d'été (29 mars 2026). La règle du contrat est « date de Paris de (now − 4 h) » : ce
  // matin-là la bascule tombe à 5 h, heure d'été (03:00 UTC), et la journée de jeu dure toujours 24 h réelles.
  assert.equal(J.nextResetAt(Date.UTC(2026, 2, 28, 12, 0, 0)), Date.UTC(2026, 2, 29, 3, 0, 0));
  assert.equal(J.nextResetAt(Date.UTC(2026, 2, 29, 12, 0, 0)), Date.UTC(2026, 2, 30, 2, 0, 0));
  // retour à l'heure d'hiver (25 octobre 2026) : bascule à 3 h, heure d'hiver (02:00 UTC), puis de nouveau 4 h
  assert.equal(J.nextResetAt(Date.UTC(2026, 9, 24, 12, 0, 0)), Date.UTC(2026, 9, 25, 2, 0, 0));
  assert.equal(J.nextResetAt(Date.UTC(2026, 9, 25, 12, 0, 0)), Date.UTC(2026, 9, 26, 3, 0, 0));
});

test('dailyFor : déterministe, indépendant de la ville, d2 et d3 de familles disjointes sur 400 jours × 6 niveaux', () => {
  const seen = new Set();
  for (let d = 0; d < 400; d++) {
    const k = J.dayKey(T0 + d * DAY);
    for (let lv = 1; lv <= 6; lv++) {
      const a = J.dailyFor(k, lv);
      assert.deepEqual(J.dailyFor(k, lv), a, 'deux appels, même résultat');
      const [d1, d2, d3] = a.list;
      assert.deepEqual([d1.id, d1.kind, d1.goal, d2.id, d3.id], ['d1', 'star', 1, 'd2', 'd3']);
      assert.ok(['missions', 'types', 'fares'].includes(d2.kind), d2.kind);
      assert.ok(['km', 'style'].includes(d3.kind), d3.kind);
      assert.notEqual(d2.kind, d3.kind);
      for (const e of a.list) { assert.equal(e.reward, R[lv - 1]); assert.ok(Number.isInteger(e.goal) && e.goal > 0); assert.ok(e.label.length > 5); }
      assert.equal(a.full, 1.5 * R[lv - 1]);
      seen.add(d2.kind); seen.add(d3.kind);
      // même tirage de familles à tous les niveaux : monter de niveau ne change que les objectifs
      assert.deepEqual(a.list.map((e) => e.kind), J.dailyFor(k, 1).list.map((e) => e.kind));
    }
  }
  assert.deepEqual([...seen].sort(), ['fares', 'km', 'missions', 'style', 'types'], 'toutes les familles sortent');
  // plafonds du jour au-dessus de tous les objectifs
  assert.ok(Math.max(...J.DAILY_GOALS.km) <= J.KM_DAY_CAP && Math.max(...J.DAILY_GOALS.style) <= J.STYLE_DAY_CAP);
  // niveau hors bornes : ramené dans 1..6
  assert.deepEqual(J.dailyFor('2026-01-15', 0), J.dailyFor('2026-01-15', 1));
  assert.deepEqual(J.dailyFor('2026-01-15', 99), J.dailyFor('2026-01-15', 6));
  // même liste de défis pour deux villes (seule la mission vedette dépend de la ville)
  const p = profile({ done: 8 });
  const a = J.publicJournal(p, T0, 'paris', {}, 'amis'), b = J.publicJournal(p, T0, 'toulouse', {}, 'amis');
  assert.deepEqual(a.list, b.list); assert.deepEqual(a.full, b.full);
});

test('starFor : mission de la ville, accessible au niveau figé, sans intro, <= 9 km quand il en existe, stable dans la journée', () => {
  for (const city of ['paris', 'toulouse']) {
    const ids = new Set();
    for (let lv = 1; lv <= 6; lv++) {
      const short = MISSIONS_BY_CITY[city].filter((m) => !m.intro && m.level <= lv && missionRouteLength(m) <= 9000);
      const band = short.filter((m) => m.level >= lv - 1);
      for (let d = 0; d < 120; d++) {
        const k = J.dayKey(T0 + d * DAY), id = J.starFor(k, city, lv), m = ALL_MISSION_BY_ID[id];
        assert.ok(m, `${city} niveau ${lv} : une vedette existe`);
        assert.equal(J.starFor(k, city, lv), id);
        assert.equal(m.city, city);
        assert.ok(m.level <= lv, `${id} (niveau ${m.level}) accessible au niveau ${lv}`);
        assert.ok(!m.intro);
        if (short.length) assert.ok(missionRouteLength(m) <= 9000, `${id} : ${Math.round(missionRouteLength(m))} m`);
        if (band.length) assert.ok(m.level >= lv - 1, `${id} : niveau ${m.level} pour un joueur de niveau ${lv}`);
        if (lv === 2) ids.add(id);
      }
    }
    assert.ok(ids.size >= 3, `${city} : la vedette change d'un jour à l'autre (${ids.size} missions en 120 jours)`);
  }
  assert.equal(J.starFor('2026-01-15', 'atlantide', 1), J.starFor('2026-01-15', 'paris', 1), 'ville inconnue : Paris');
});

test('rollDay : niveau FIGÉ à la bascule — monter de niveau dans la journée ne change ni la liste ni R', () => {
  const p = profile({ done: 2 }), s = session();
  assert.equal(J.rollDay(p, T0), true, 'compte neuf : première bascule');
  assert.equal(J.rollDay(p, T0 + HOUR), false);
  const before = J.publicJournal(p, T0, 'paris', {}, 'amis');
  assert.deepEqual([before.lv, before.list[0].reward, before.day], [1, 600, '2026-01-15']);
  const r = play(p, s, timedMission('paris', 1), T0, { pos: null });
  assert.equal(r.levelUp, true);
  assert.equal(eco.levelOf(p), 2);
  const after = J.publicJournal(p, T0 + 2 * HOUR, 'paris', {}, 'amis');
  assert.equal(after.lv, 1);
  assert.equal(after.star, before.star);
  assert.deepEqual(after.list.map((e) => [e.id, e.kind, e.goal, e.reward]), before.list.map((e) => [e.id, e.kind, e.goal, e.reward]));
  assert.equal(after.full.reward, before.full.reward);
  // le lendemain à 4 h : nouveau jour au niveau 2, compteurs à zéro
  const next = J.publicJournal(p, Date.UTC(2026, 0, 16, 3, 0, 0), 'paris', {}, 'amis');
  assert.deepEqual([next.day, next.lv, next.list[0].reward], ['2026-01-16', 2, 1500]);
  assert.ok(next.list.every((e) => e.have === 0 && !e.claimed));
  assert.deepEqual(p.journal.day.c, { m: 0, km: 0, fares: 0, style: 0, star: 0, types: [] });
});

test('claim daily : objectif exigé, payé une fois, double réclamation refusée, motifs du contrat', () => {
  const p = profile();
  const st = J.dailyState(p, T0);
  for (const id of ['d1', 'd2', 'd3', 'full']) assert.equal(eco.claim(p, { kind: 'daily', id }, { now: T0 }).code, 'not_ready', id);
  for (const bad of [{ kind: 'daily', id: 'd4' }, { kind: 'daily' }, { kind: 'bonus', id: 'd1' }, {}, null, { kind: 'daily', id: '__proto__' }]) assert.equal(eco.claim(p, bad, { now: T0 }).code, 'bad_claim');
  assert.equal(p.money, CAT.STARTING_MONEY);
  // un seul défi réussi : lui seul est payé, et la prime de journée complète attend les trois
  p.journal.day.c.star = 1;
  let r = eco.claim(p, { kind: 'daily', id: 'd1' }, { now: T0 });
  assert.deepEqual([r.ok, r.id, r.amount, r.delta, r.reason], [true, 'd1', 600, 600, 'défi du jour']);
  assert.equal(eco.claim(p, { kind: 'daily', id: 'd1' }, { now: T0 + 1000 }).code, 'claimed');
  assert.equal(eco.claim(p, { kind: 'daily', id: 'full' }, { now: T0 }).code, 'not_ready');
  assert.deepEqual([p.money, p.stats.earned, p.stats.dailyDone], [CAT.STARTING_MONEY + 600, 600, 1]);
  fillDay(p, T0);
  assert.equal(J.publicJournal(p, T0, 'paris', {}, 'amis').full.ready, true);
  for (const id of ['d2', 'd3']) assert.equal(eco.claim(p, { kind: 'daily', id }, { now: T0 }).delta, 600);
  r = eco.claim(p, { kind: 'daily', id: 'full' }, { now: T0 });
  assert.deepEqual([r.ok, r.id, r.delta, r.reason, r.streak, r.streakUp], [true, 'full', 990, 'journée complète', { n: 1, best: 1 }, true]); // 900 × 1,1
  assert.equal(eco.claim(p, { kind: 'daily', id: 'full' }, { now: T0 + 1000 }).code, 'claimed');
  for (const id of ['d1', 'd2', 'd3']) assert.equal(eco.claim(p, { kind: 'daily', id }, { now: T0 + 1000 }).code, 'claimed');
  assert.equal(p.stats.dailyDone, 3);
  const view = J.publicJournal(p, T0 + 2000, 'paris', {}, 'amis');
  assert.deepEqual(view.full, { reward: 990, ready: false, claimed: true });
  assert.ok(view.list.every((e) => e.claimed && e.have === e.goal));
  assert.equal(st.list.length, 3);
  // la prime de journée complète n'exige pas d'avoir encaissé chaque défi d'abord
  const q = profile(); fillDay(q, T0);
  assert.equal(eco.claim(q, { kind: 'daily', id: 'full' }, { now: T0 }).ok, true);
  assert.equal(eco.claim(q, { kind: 'daily', id: 'd2' }, { now: T0 }).ok, true);
});

test('défis du jour : total quotidien <= 5,25 × R à tous les niveaux, quelle que soit la série', () => {
  for (let lv = 1; lv <= 6; lv++) {
    for (const n of [0, 1, 3, 5, 30]) {
      const p = profile({ done: LEVEL_AT[lv - 1] });
      p.journal.streak = { n, last: J.prevDayKey(J.dayKey(T0)), best: n };
      const total = fullDay(p, T0);
      const mult = 1 + 0.1 * Math.min(n + 1, 5);
      assert.equal(total, 3 * R[lv - 1] + Math.round(1.5 * R[lv - 1] * mult), `niveau ${lv}, série ${n}`);
      assert.ok(total <= 5.25 * R[lv - 1]);
      if (n >= 4) assert.equal(total, 5.25 * R[lv - 1]);
    }
  }
});

test('série : 1 puis 2 le lendemain, retour à 1 après un jour sauté, meilleure série conservée et « cocorico » toujours débloqué', () => {
  const p = profile();
  fullDay(p, T0);
  assert.deepEqual(p.journal.streak, { n: 1, last: '2026-01-15', best: 1 });
  fullDay(p, T0 + DAY);
  assert.deepEqual(p.journal.streak, { n: 2, last: '2026-01-16', best: 2 });
  assert.deepEqual(J.publicJournal(p, T0 + DAY, 'paris', {}, 'amis').streak, { n: 2, best: 2 });
  fullDay(p, T0 + 2 * DAY);
  assert.deepEqual(p.journal.streak, { n: 3, last: '2026-01-17', best: 3 });
  assert.equal(eco.unlocked(p, { streak: 3 }), true);
  // le 18 : série toujours vivante (n = 3) tant que la journée n'est pas finie, prime annoncée à +40 %
  let view = J.publicJournal(p, T0 + 3 * DAY, 'paris', {}, 'amis');
  assert.deepEqual(view.streak, { n: 3, best: 3 });
  assert.equal(view.full.reward, Math.round(900 * 1.4));
  // le 18 est sauté : le 19 la série est rompue, sans malus (repart de 1), la meilleure reste
  view = J.publicJournal(p, T0 + 4 * DAY, 'paris', {}, 'amis');
  assert.deepEqual(view.streak, { n: 0, best: 3 });
  assert.equal(view.full.reward, Math.round(900 * 1.1));
  const money = p.money;
  fullDay(p, T0 + 4 * DAY);
  assert.deepEqual(p.journal.streak, { n: 1, last: '2026-01-19', best: 3 });
  assert.equal(p.money, money + 3 * 600 + 990);
  assert.equal(eco.unlocked(p, { streak: 3 }), true, 'ce qui est débloqué par la meilleure série ne se reverrouille pas');
  if ((CAT.HORN_BY_ID || {}).cocorico) {
    assert.ok(eco.hornsFor(p).includes('cocorico'));
    assert.equal(eco.setLook(p, { horn: 'cocorico' }).ok, true);
  }
  // la prime est plafonnée à +50 % à partir de 5 jours
  const q = profile();
  for (let d = 0; d < 7; d++) fullDay(q, T0 + d * DAY);
  assert.deepEqual(q.journal.streak, { n: 7, last: '2026-01-21', best: 7 });
  assert.equal(J.publicJournal(q, T0 + 6 * DAY, 'paris', {}, 'amis').full.reward, 1350);
});

test('compteurs du jour : km en mètres plafonnés à 60 000, style à 50 000, types distincts, avancement borné à l’objectif', () => {
  const p = profile();
  assert.equal(J.count(p, 'km', 1234.56, T0), 1234.56);
  // ajouts minuscules (un état à pied, une image) : rien ne se perd à l'arrondi
  const slow = profile();
  for (let i = 0; i < 1000; i++) J.count(slow, 'km', 0.03, T0);
  assert.equal(slow.journal.day.c.km, 30);
  assert.equal(J.count(p, 'km', 1e9, T0), 60000);
  assert.equal(J.count(p, 'style', 49999, T0), 49999);
  assert.equal(J.count(p, 'style', 10, T0), 50000);
  assert.equal(J.count(p, 'fares', 1, T0), 1);
  assert.equal(J.count(p, 'm', 2, T0), 2);
  assert.equal(J.count(p, 'star', 5, T0), 1);
  for (const bad of [-3, NaN, 0, 'x', Infinity]) J.count(p, 'm', bad, T0);
  assert.equal(p.journal.day.c.m, 2);
  assert.equal(J.count(p, 'inconnu', 3, T0), 0);
  assert.equal(J.countType(p, 'taxi', T0), 1);
  assert.equal(J.countType(p, 'taxi', T0), 1);
  assert.equal(J.countType(p, 'pas_un_type', T0), 1);
  assert.equal(J.countType(p, 'race', T0), 2);
  const view = J.publicJournal(p, T0, 'paris', {}, 'amis');
  for (const e of view.list) assert.ok(e.have <= e.goal && e.have >= 0);
  assert.equal(view.list[0].have, 1);
  assert.ok(view.resetAt > T0 && view.resetAt - T0 <= 25 * HOUR);
  assert.deepEqual(Object.keys(view), ['day', 'lv', 'star', 'list', 'full', 'streak', 'resetAt', 'away']);
  assert.deepEqual(Object.keys(view.list[0]), ['id', 'kind', 'goal', 'have', 'reward', 'claimed', 'label']);
  // le compteur bascule avec le jour
  assert.equal(J.count(p, 'km', 10, T0 + DAY), 10);
});

test('normalizeJournal : journal absent ou abîmé ramené à une forme saine, journal valide conservé tel quel', () => {
  for (const bad of [undefined, null, 'x', 42, [], { day: 'x', streak: 3, rentAt: 'y', away: [], fareWin: null }]) {
    assert.deepEqual(J.normalizeJournal(bad), J.newJournal());
  }
  const j = J.normalizeJournal({ v: 1, day: { k: '2026-01-15', lv: 99, c: { m: -3, km: 1e9, fares: 2.7, style: 'x', star: 7, types: ['taxi', 'taxi', 'bidon'] }, claimed: ['d1', 'd1', 'full', 'd9'], full: 'oui' },
    streak: { n: 4, last: 'hier', best: 2 }, rentAt: { amis: 5, __proto__: 9, mauvais: 'x' }, away: { amis: { rent: 10.9, sec: 3 }, vide: { rent: 0, sec: 9 } }, fareWin: { at: 5, paid: -2 }, fineAt: 'x' });
  assert.deepEqual(j.day, { k: '2026-01-15', lv: 6, c: { m: 0, km: 60000, fares: 2, style: 0, star: 1, types: ['taxi'] }, claimed: ['d1'], full: false });
  assert.deepEqual(j.streak, { n: 4, last: '', best: 4 });
  assert.deepEqual(j.rentAt, { amis: 5 });
  assert.deepEqual(j.away, { amis: { rent: 10, sec: 3 } });
  assert.deepEqual(j.fareWin, { at: 5, paid: 0 });
  assert.equal(j.fineAt, 0);
  const p = profile(); fullDay(p, T0); J.touchRent(p, 'amis', T0);
  assert.deepEqual(J.normalizeJournal(structuredClone(p.journal)), p.journal);
});

// =============================================================================== relevé du matin

const FLAT = ALL_PROPERTY_BY_ID.appart_marais; // 500 Ƶ par heure
const withFlat = () => { const p = profile(); return { p, owners: { [FLAT.id]: { id: p.id, name: p.name } } }; };

test('relevé : bien à 500 Ƶ/h, 10 h d’absence => 2 500 Ƶ encaissables une seule fois', () => {
  assert.equal(FLAT.income, 500);
  const { p, owners } = withFlat();
  assert.equal(J.awayRent(p, owners, 'amis', T0), null, 'première visite : rien à relever, mais la salle est notée');
  assert.equal(p.journal.rentAt.amis, T0);
  const a = J.awayRent(p, owners, 'amis', T0 + 10 * HOUR);
  assert.deepEqual(a, { rent: 2500, sec: 36000, props: [{ id: FLAT.id, name: FLAT.name, rent: 2500 }], added: 2500 });
  assert.deepEqual(J.publicJournal(p, T0 + 10 * HOUR, 'paris', owners, 'amis').away, { rent: 2500, sec: 36000, props: [{ id: FLAT.id, name: FLAT.name, rent: 2500 }] });
  assert.equal(J.publicJournal(p, T0 + 10 * HOUR, 'paris', owners, 'autre').away, null, 'le relevé appartient à sa salle');
  assert.equal(eco.claim(p, { kind: 'away' }, { now: T0 + 10 * HOUR, roomKey: 'autre', city: 'paris' }).code, 'nothing');
  const r = eco.claim(p, { kind: 'away' }, { now: T0 + 10 * HOUR, roomKey: 'amis', city: 'paris' });
  assert.deepEqual([r.ok, r.kind, r.amount, r.delta, r.reason], [true, 'away', 2500, 2500, 'loyers']);
  assert.deepEqual([p.money, p.stats.earned], [CAT.STARTING_MONEY + 2500, 2500]);
  assert.equal(eco.claim(p, { kind: 'away' }, { now: T0 + 10 * HOUR, roomKey: 'amis', city: 'paris' }).code, 'nothing');
  assert.equal(J.publicJournal(p, T0 + 10 * HOUR, 'paris', owners, 'amis').away, null);
  assert.equal(p.money, CAT.STARTING_MONEY + 2500);
});

test('relevé : 20 min => rien ; 40 h => 3 000 Ƶ (12 h au plus) ; reconnexion à 5 min => nul', () => {
  for (const [ms, rent] of [[20 * 60 * 1000, null], [5 * 60 * 1000, null], [30 * 60 * 1000 - 1, null], [30 * 60 * 1000, 125], [HOUR, 250], [12 * HOUR, 3000], [40 * HOUR, 3000], [30 * DAY, 3000]]) {
    const { p, owners } = withFlat();
    J.touchRent(p, 'amis', T0);
    const a = J.awayRent(p, owners, 'amis', T0 + ms);
    assert.equal(a ? a.rent : null, rent, `${ms / 60000} min`);
    assert.equal(p.journal.rentAt.amis, T0 + ms);
  }
  // sans bien dans la salle : jamais de relevé
  const p = profile();
  J.touchRent(p, 'amis', T0);
  assert.equal(J.awayRent(p, {}, 'amis', T0 + 10 * HOUR), null);
  assert.deepEqual(p.journal.away, {});
});

test('relevé : deux absences de 10 h sans encaisser => 5 000 Ƶ ; cinq absences => plafond de 6 000 Ƶ', () => {
  const { p, owners } = withFlat();
  let t = T0;
  J.touchRent(p, 'amis', t);
  const rents = [];
  for (let i = 0; i < 5; i++) {
    t += 10 * HOUR;
    const a = J.awayRent(p, owners, 'amis', t); // hello
    rents.push([a.rent, a.added]);
    t += 20 * 60 * 1000; J.touchRent(p, 'amis', t); // 20 min de jeu, puis détachement
  }
  assert.deepEqual(rents, [[2500, 2500], [5000, 2500], [6000, 1000], [6000, 0], [6000, 0]]);
  const r = eco.claim(p, { kind: 'away' }, { now: t, roomKey: 'amis' });
  assert.equal(r.delta, 6000);
  // après encaissement, le cumul repart de zéro
  assert.equal(J.awayRent(p, owners, 'amis', t + 10 * HOUR).rent, 2500);
});

test('relevé : la période connectée n’est jamais payée deux fois', () => {
  const { p, owners } = withFlat();
  J.touchRent(p, 'amis', T0);
  let t = T0 + 10 * HOUR;
  assert.equal(J.awayRent(p, owners, 'amis', t).added, 2500);
  assert.equal(J.awayRent(p, owners, 'amis', t).added, 0, 'deux hello au même instant');
  // 10 h de jeu : accrue toutes les minutes note la salle à jour (4e argument de accrue)
  let live = 0;
  for (let i = 0; i < 600; i++) { t += 60000; live += eco.accrue(p, owners, 60, { now: t, roomKey: 'amis' }); }
  assert.equal(live, 5000, 'loyers connectés : 500 Ƶ/h pendant 10 h');
  assert.equal(p.journal.rentAt.amis, t);
  // coupure puis reconnexion une minute plus tard : rien de plus
  const back = J.awayRent(p, owners, 'amis', t + 60000);
  assert.deepEqual([back.rent, back.added], [2500, 0]);
  assert.equal(p.journal.away.amis.rent, 2500);
  // accrue sans 4e argument : comportement d'avant, le journal n'est pas touché
  const q = profile();
  assert.equal(eco.accrue(q, {}, 60), 0);
  assert.deepEqual(q.journal.rentAt, {});
});

test('relevé : détail par bien au prorata des loyers (somme exacte), au plus 8 salles mémorisées, la salle courante jamais évincée', () => {
  const p = profile();
  const props = PROPERTIES_BY_CITY.paris.slice(0, 5), owners = Object.fromEntries(props.map((x) => [x.id, { id: p.id, name: p.name }]));
  owners[PROPERTIES_BY_CITY.paris[6].id] = { id: 'quelquun_dautre', name: 'Bob' };
  const perHour = props.reduce((s, x) => s + x.income, 0);
  J.touchRent(p, 'amis', T0);
  const a = J.awayRent(p, owners, 'amis', T0 + 7 * HOUR + 1234);
  assert.equal(a.rent, Math.floor(((perHour * (7 * HOUR + 1234)) / HOUR) * 0.5));
  assert.deepEqual(a.props.map((x) => x.id).sort(), props.map((x) => x.id).sort());
  assert.equal(a.props.reduce((s, x) => s + x.rent, 0), a.rent);
  for (const x of a.props) assert.equal(x.name, ALL_PROPERTY_BY_ID[x.id].name);
  // biens vendus depuis : le relevé reste dû, sans détail
  assert.deepEqual(J.awayView(p, {}, 'amis'), { rent: a.rent, sec: a.sec, props: [] });
  // 12 salles visitées : 8 gardées, les plus récentes
  for (let i = 0; i < 12; i++) J.touchRent(p, `salle${i}`, T0 + DAY + i * 1000);
  assert.deepEqual(Object.keys(p.journal.rentAt).sort(), ['salle10', 'salle11', 'salle4', 'salle5', 'salle6', 'salle7', 'salle8', 'salle9']);
  J.touchRent(p, 'vieille', 5); // horodatage le plus ancien, mais c'est la salle courante
  assert.ok('vieille' in p.journal.rentAt && Object.keys(p.journal.rentAt).length === 8);
  // clés piégées ou absurdes : ignorées
  for (const k of ['__proto__', '', null, undefined, 42]) { J.touchRent(p, k, T0); assert.equal(J.awayRent(p, owners, k, T0 + DAY), null); }
  assert.equal(Object.keys(p.journal.rentAt).length, 8);
  assert.equal(Object.getPrototypeOf(p.journal.rentAt), Object.prototype);
});

// =============================================================================== taxi libre

const PARIS_CENTER = { x: 0, z: 0 };
const fixed = (v) => () => v;
const MOOD_RAND = { normal: 0.1, presse: 0.6, touriste: 0.75, fragile: 0.9 };
/** Formules du contrat, réécrites ici indépendamment du module. */
const expectFare = (dist, level, taxi, mood) => Math.round((150 + 0.35 * dist) * (1 + 0.25 * (level - 1)) * (taxi ? 1.25 : 1) * (mood === 'touriste' ? 1.2 : 1));
const expectPar = (dist, mood) => Math.round(((dist * 1.4) / 13 + 15) * (mood === 'presse' ? 0.75 : mood === 'touriste' ? 1.5 : 1));
const expectTip = (fare, mood, elapsed, par, hits) => Math.round(fare * (mood === 'presse' ? 0.8 : 0.4) * Math.max(0, Math.min(1, 1 - Math.max(0, elapsed - par) / par)) * Math.max(0, 1 - (mood === 'fragile' ? 0.5 : 0.2) * hits));
const startJob = (p, s, over = {}) => jobs.jobStart(p, s, { kind: 'taxi', pos: PARIS_CENTER, city: 'paris', now: T0, rand: fixed(0.1), vehicleType: 'citadine', ...over });

test('points de rendez-vous : chaque ville en a, dans son emprise ; monuments visibles à rayon + 90 m', () => {
  for (const city of ['paris', 'toulouse']) {
    const spots = jobs.SPOTS_BY_CITY[city], B = geoFor(city).BOUNDS;
    assert.ok(spots.length >= 20, `${city} : ${spots.length} points`);
    assert.equal(new Set(spots.map((s) => s.id)).size, spots.length, 'ids uniques');
    for (const s of spots) {
      assert.ok(typeof s.id === 'string' && s.label && Number.isFinite(s.x) && Number.isFinite(s.z) && s.r >= 35, JSON.stringify(s));
      assert.ok(s.x >= B.minX && s.x <= B.maxX && s.z >= B.minZ && s.z <= B.maxZ, `${city} ${s.id} hors emprise`);
      if (!s.landmark) assert.equal(s.r, 45);
    }
    const sights = jobs.LANDMARK_SPOTS_BY_CITY[city], visible = LANDMARKS_BY_CITY[city].filter((l) => !l.hidden);
    assert.equal(sights.length, visible.length);
    for (const l of visible) assert.deepEqual(sights.find((s) => s.id === l.id), { id: l.id, label: l.name, x: l.x, z: l.z, r: l.radius + 90, landmark: true });
  }
  assert.ok(CITY_IDS.every((c) => Array.isArray(jobs.SPOTS_BY_CITY[c])), 'toutes les villes du registre ont leur table');
});

test('pickSpot : tire dans la couronne ; sans point dans la couronne, le plus proche au-delà de la distance minimale', () => {
  for (const city of ['paris', 'toulouse']) {
    const spots = jobs.SPOTS_BY_CITY[city], B = geoFor(city).BOUNDS;
    const origin = { x: 0, z: 0 };
    for (const v of [0, 0.25, 0.5, 0.999999]) {
      const s = jobs.pickSpot(city, origin, 500, 2500, fixed(v));
      assert.ok(s && s.dist >= 500 && s.dist <= 2500, `${city} rand ${v} : ${s?.dist}`);
      assert.ok(Math.abs(s.dist - Math.hypot(s.x - origin.x, s.z - origin.z)) < 1e-6);
      assert.deepEqual(jobs.pickSpot(city, origin, 500, 2500, fixed(v)), s, 'même tirage, même point');
    }
    assert.ok(new Set([0, 0.2, 0.4, 0.6, 0.8].map((v) => jobs.pickSpot(city, origin, 500, 2500, fixed(v)).id)).size > 1, 'le tirage dépend de rand');
    // coins de l'emprise, puis un point très au-delà : couronne vide => repli sur le plus proche à plus de 500 m
    const corners = [[B.minX, B.minZ], [B.maxX, B.minZ], [B.minX, B.maxZ], [B.maxX, B.maxZ], [B.minX - 6000, B.minZ - 6000]];
    let empty = 0;
    for (const [x, z] of corners) {
      const pos = { x, z }, d = (s) => Math.hypot(s.x - x, s.z - z);
      const ring = spots.filter((s) => d(s) >= 500 && d(s) <= 2500);
      const got = jobs.pickSpot(city, pos, 500, 2500, fixed(0.5));
      if (ring.length) { assert.ok(ring.some((s) => s.id === got.id)); continue; }
      empty++;
      const nearest = spots.filter((s) => d(s) > 500).sort((a, b) => d(a) - d(b))[0];
      assert.equal(got.id, nearest.id);
      assert.ok(got.dist > 2500, `${city} : repli à ${Math.round(got.dist)} m`);
    }
    assert.ok(empty >= 1, 'au moins un cas de couronne vide est exercé');
  }
  // préférence monument : un monument de la couronne quand il y en a un
  const t = jobs.pickSpot('paris', PARIS_CENTER, 500, 2500, fixed(0.3), { landmark: true });
  assert.equal(t.landmark, true);
  assert.ok(LANDMARKS_BY_CITY.paris.some((l) => l.id === t.id && !l.hidden));
  // sans position : null ; ville inconnue : Paris
  for (const bad of [null, undefined, {}, { x: NaN, z: 0 }]) assert.equal(jobs.pickSpot('paris', bad, 500, 2500, fixed(0)), null);
  assert.deepEqual(jobs.pickSpot('atlantide', PARIS_CENTER, 500, 2500, fixed(0.3)), jobs.pickSpot('paris', PARIS_CENTER, 500, 2500, fixed(0.3)));
  // Chiche : arrivée à 900-2 000 m
  const dare = jobs.pickSpot('toulouse', { x: 0, z: 0 }, 900, 2000, fixed(0.7));
  assert.ok(dare.dist >= 900 && dare.dist <= 2000);
  assert.deepEqual(Object.keys(jobs.nearestLandmark('paris', PARIS_CENTER)), ['id', 'name', 'dist']);
  assert.equal(jobs.nearestLandmark('paris', LANDMARKS_BY_CITY.paris[0]).id, LANDMARKS_BY_CITY.paris[0].id);
  assert.equal(jobs.nearestLandmark('paris', null), null);
});

test('taxi : départ refusé sans position, à pied, pendant une mission ou un Chiche', () => {
  const p = profile(), s = session();
  for (const pos of [null, undefined, { x: NaN, z: 1 }]) assert.equal(startJob(p, s, { pos }).code, 'no_pos');
  for (const vehicleType of [null, undefined, 'soucoupe', '__proto__']) assert.equal(startJob(p, s, { vehicleType }).code, 'no_vehicle');
  assert.equal(startJob(p, s, { kind: 'livraison' }).code, 'bad_kind');
  assert.equal(startJob(p, s, { busy: true }).code, 'busy');
  eco.missionStart(p, s, MISSIONS_BY_CITY.paris[0].id, T0, 'paris');
  assert.equal(startJob(p, s).code, 'busy');
  assert.equal(s.job ?? null, null);
  eco.missionAbort(s);
  const ok = startJob(p, s);
  assert.equal(ok.ok, true);
  // une mission démarrée annule la course
  eco.missionStart(p, s, MISSIONS_BY_CITY.paris[0].id, T0, 'paris');
  assert.equal(s.job, null);
  assert.equal(jobs.jobComplete(p, s, { pos: ok.job.to, now: T0 + 300000, hits: 0 }).code, 'no_job');
});

test('taxi : la course annoncée suit les formules du contrat pour les quatre caractères', () => {
  const seen = new Set();
  for (const [mood, v] of Object.entries(MOOD_RAND)) {
    for (const [done, level] of [[0, 1], [8, 3], [40, 6]]) {
      const p = profile({ done }), s = session();
      const r = startJob(p, s, { rand: fixed(v) });
      assert.equal(r.ok, true);
      const job = r.job, dist = Math.hypot(job.to.x, job.to.z);
      assert.deepEqual(Object.keys(job), ['id', 'kind', 'mood', 'to', 'fare', 'parSec', 'chain', 'taxi']);
      assert.deepEqual([job.kind, job.mood, job.chain, job.taxi], ['taxi', mood, 1, false]);
      assert.ok(dist >= 499 && dist <= 2501, `destination à ${Math.round(dist)} m`);
      assert.ok(Math.abs(s.job.dist - dist) < 0.2);
      assert.equal(job.fare, expectFare(s.job.dist, level, false, mood), `${mood} niveau ${level}`);
      assert.equal(job.parSec, expectPar(s.job.dist, mood));
      assert.ok(Math.abs(s.job.minSec - s.job.dist / 60) < 1e-9);
      assert.deepEqual(Object.keys(job.to), ['x', 'z', 'label', 'r']);
      if (mood === 'touriste') assert.ok(LANDMARKS_BY_CITY.paris.some((l) => l.name === job.to.label && job.to.r === l.radius + 90), 'le touriste va voir un monument');
      else assert.equal(job.to.r, 45);
      assert.deepEqual({ ...s.job, dist: 0, minSec: 0 }, { ...job, dist: 0, minSec: 0, startedAt: T0 });
      seen.add(job.id);
    }
  }
  assert.equal(seen.size, 12, 'identifiants de course distincts');
  // répartition du tirage : 55 / 15 / 15 / 15
  const edges = [[0, 'normal'], [0.5499, 'normal'], [0.55, 'presse'], [0.6999, 'presse'], [0.7, 'touriste'], [0.8499, 'touriste'], [0.85, 'fragile'], [0.9999, 'fragile']];
  for (const [v, mood] of edges) assert.equal(startJob(profile(), session(), { rand: fixed(v) }).job.mood, mood, String(v));
  assert.ok(Math.abs(jobs.MOODS.reduce((a, [, share]) => a + share, 0) - 1) < 1e-9);
});

test('taxi : bonus de 25 % seulement au volant de SON Taxi Parisien', () => {
  const owner = profile({ money: 50000 }); eco.buyCar(owner, 'taxi');
  const a = startJob(owner, session(), { vehicleType: 'taxi' });
  const b = startJob(owner, session(), { vehicleType: 'citadine' });
  const c = startJob(profile(), session(), { vehicleType: 'taxi' }); // taxi « emprunté »
  assert.deepEqual([a.job.taxi, b.job.taxi, c.job.taxi], [true, false, false]);
  const dist = Math.hypot(a.job.to.x, a.job.to.z);
  assert.equal(b.job.fare, c.job.fare);
  assert.ok(Math.abs(a.job.fare - expectFare(dist, 1, true, 'normal')) <= 1);
  assert.ok(a.job.fare > b.job.fare * 1.24 && a.job.fare < b.job.fare * 1.26);
});

test('taxi : arrivée à 300 m refusée too_far (course conservée), puis payée fare + pourboire ; missionsDone inchangé', () => {
  const p = profile(), s = session();
  const { job } = startJob(p, s);
  const t = T0 + job.parSec * 1000;
  for (const pos of [{ x: job.to.x + 300, z: job.to.z }, { x: job.to.x, z: job.to.z - 46 }, null]) {
    const far = jobs.jobComplete(p, s, { pos, now: t, hits: 0, id: job.id });
    assert.deepEqual([far.ok, far.code], [false, 'too_far']);
    assert.equal(s.job.id, job.id, 'la course est conservée');
  }
  assert.equal(jobs.jobComplete(p, s, { pos: job.to, now: t, hits: 0, id: 'jautre' }).code, 'no_job');
  assert.equal(s.job.id, job.id);
  const r = jobs.jobComplete(p, s, { pos: { x: job.to.x + 30, z: job.to.z + 30 }, now: t, hits: 0, id: job.id });
  const tip = expectTip(job.fare, 'normal', job.parSec, job.parSec, 0);
  assert.deepEqual(r, { ok: true, id: job.id, mood: 'normal', fare: job.fare, tip, chain: 1, capped: false, total: job.fare + tip, delta: job.fare + tip, reason: 'course de taxi' });
  assert.equal(tip, Math.round(job.fare * 0.4));
  assert.equal(p.money, CAT.STARTING_MONEY + job.fare + tip);
  assert.deepEqual([p.stats.missionsDone, p.stats.fares, p.stats.fareBestChain, p.stats.fareEarned, p.stats.earned], [0, 1, 1, job.fare + tip, job.fare + tip]);
  assert.equal(p.journal.day.c.fares, 1);
  assert.equal(s.job, null);
  assert.equal(jobs.jobComplete(p, s, { pos: job.to, now: t, hits: 0 }).code, 'no_job', 'pas de double paiement');
});

test('taxi : pourboire conforme pour les quatre caractères (retard, chocs, client fragile, client pressé)', () => {
  for (const [mood, v] of Object.entries(MOOD_RAND)) {
    for (const late of [0, 0.5, 1, 1.5, 2.5]) {
      for (const hits of [0, 1, 2, 5, 9, -3, 'x']) {
        const p = profile(), s = session();
        const { job } = startJob(p, s, { rand: fixed(v) });
        const elapsed = Math.max(s.job.minSec + 1, job.parSec * late);
        const r = jobs.jobComplete(p, s, { pos: job.to, now: T0 + elapsed * 1000, hits });
        const h = Math.max(0, Math.min(5, Math.floor(+hits) || 0));
        const tip = expectTip(job.fare, mood, elapsed, job.parSec, h);
        assert.equal(r.ok, true, `${mood} ${late} ${hits}`);
        assert.deepEqual([r.fare, r.tip, r.total], [job.fare, tip, job.fare + tip], `${mood}, ${late} × délai, ${hits} choc(s)`);
        assert.ok(r.tip >= 0 && r.tip <= job.fare * (mood === 'presse' ? 0.8 : 0.4) + 1);
        if (late >= 2 || h >= 5 || (mood === 'fragile' && h >= 2)) assert.equal(r.tip, 0);
      }
    }
  }
  // le pressé donne le double à l'heure, mais son délai est plus court ; le fragile perd la moitié au premier choc
  assert.equal(jobs.tipFor(1000, 'presse', 10, 100, 0), 800);
  assert.equal(jobs.tipFor(1000, 'normal', 10, 100, 0), 400);
  assert.equal(jobs.tipFor(1000, 'fragile', 10, 100, 1), 200);
  assert.equal(jobs.tipFor(1000, 'normal', 10, 100, 1), 320);
  assert.equal(jobs.tipFor(1000, 'normal', 150, 100, 0), 200);
  assert.ok(jobs.parFor(1000, 'presse') < jobs.parFor(1000, 'normal') && jobs.parFor(1000, 'normal') < jobs.parFor(1000, 'touriste'));
});

test('taxi : arrivée trop rapide annulée, abandon sans frais', () => {
  const p = profile(), s = session();
  const { job } = startJob(p, s);
  const r = jobs.jobComplete(p, s, { pos: job.to, now: T0 + (s.job.minSec - 2) * 1000, hits: 0 });
  assert.deepEqual([r.ok, r.code], [false, 'too_fast']);
  assert.equal(s.job, null, 'la course est annulée');
  assert.deepEqual([p.money, p.stats.fares], [CAT.STARTING_MONEY, 0]);
  startJob(p, s);
  assert.deepEqual(jobs.jobAbort(s), { ok: true, had: true });
  assert.deepEqual(jobs.jobAbort(s), { ok: true, had: false });
  assert.equal(s.job, null);
  assert.equal(p.money, CAT.STARTING_MONEY);
});

test('taxi : série — client suivant dans les 2 minutes => +10 % par course, plafonnée à +50 % ; au-delà elle repart de 1', () => {
  const p = profile(), s = session();
  let t = T0, lastChain = 0;
  for (let i = 1; i <= 8; i++) {
    const { job } = startJob(p, s, { now: t });
    assert.equal(job.chain, i);
    t += job.parSec * 1000;
    const before = p.money;
    const r = jobs.jobComplete(p, s, { pos: job.to, now: t, hits: 0 });
    const tip = expectTip(job.fare, 'normal', job.parSec, job.parSec, 0);
    assert.equal(r.chain, i);
    assert.equal(r.total, Math.round((job.fare + tip) * (1 + 0.1 * Math.min(i - 1, 5))));
    assert.equal(p.money - before, r.total);
    p.journal.fareWin.paid = 0; // on isole la série du plafond horaire
    lastChain = r.chain;
    t += 119000; // le client suivant monte juste à temps
  }
  assert.equal(p.stats.fareBestChain, 8);
  assert.equal(jobs.chainMult(1), 1); assert.equal(jobs.chainMult(2), 1.1); assert.equal(jobs.chainMult(6), 1.5); assert.equal(jobs.chainMult(50), 1.5);
  // trop tard : la série repart de 1
  t += 2000;
  assert.equal(startJob(p, s, { now: t }).job.chain, 1);
  assert.equal(lastChain, 8);
  assert.equal(p.stats.fareBestChain, 8, 'le record de série reste');
});

test('taxi : plafond d’une heure glissante (15 000 Ƶ × niveau), un quart au-delà, capped signalé', () => {
  assert.deepEqual([1, 2, 3, 6].map((lv) => jobs.hourCap(lv)), [15000, 18750, 22500, 33750]);
  const run = (p, s, t) => { const { job } = startJob(p, s, { now: t }); const r = jobs.jobComplete(p, s, { pos: job.to, now: t + job.parSec * 1000, hits: 0 }); return { r, nominal: job.fare + expectTip(job.fare, 'normal', job.parSec, job.parSec, 0) }; };
  // à cheval sur le plafond : le reste de la marge au plein tarif, l'excédent au quart
  let p = profile(), s = session();
  p.journal.fareWin = { at: T0, paid: 14900 };
  let { r, nominal } = run(p, s, T0 + 1000);
  assert.deepEqual([r.capped, r.total], [true, 100 + Math.round((nominal - 100) * 0.25)]);
  assert.equal(p.money, CAT.STARTING_MONEY + r.total);
  assert.equal(p.journal.fareWin.paid, 14900 + r.total);
  // déjà au-dessus : tout au quart
  ({ r, nominal } = run(p, s, T0 + 10 * 60 * 1000));
  assert.deepEqual([r.capped, r.total, r.fare > 0, r.tip > 0], [true, Math.round(nominal * 0.25), true, true]);
  // une heure après l'ouverture de la fenêtre : compteur remis à zéro
  ({ r, nominal } = run(p, s, T0 + HOUR + 1000));
  assert.deepEqual([r.capped, r.total], [false, nominal]);
  assert.equal(p.journal.fareWin.paid, nominal);
  // le plafond monte avec le niveau
  p = profile({ done: 8 }); s = session();
  p.journal.fareWin = { at: T0, paid: 20000 };
  ({ r } = run(p, s, T0 + 1000));
  assert.equal(r.capped, false, 'niveau 3 : plafond de 22 500 Ƶ');
  // enchaînement réel : on finit par être plafonné, et jamais plus de plafond + quarts dans l'heure
  p = profile(); s = session();
  let t = T0, earned = 0, capped = 0;
  for (let i = 0; i < 40 && t - T0 < HOUR - 200000; i++) {
    const { job } = startJob(p, s, { now: t });
    t += (s.job.minSec + 1) * 1000;
    const res = jobs.jobComplete(p, s, { pos: job.to, now: t, hits: 0 });
    earned += res.total; if (res.capped) capped++;
    t += 1000;
  }
  assert.ok(capped > 0, 'le plafond horaire finit par s’appliquer');
  assert.ok(earned < 15000 * 2, `gains de l'heure : ${earned} Ƶ`);
});

// Contrat v6 « boucle fun et rétention » : handlers du serveur (server/game.js), joués par de vrais clients WebSocket
// sur un serveur éphémère à horloge et à hasard pilotés. Les règles pures ont leurs tests dans fun-pure.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, join, seedPlayer, countWrites, sendState, place, drive, quit } from '../testkit.js';
import { MemoryStore } from '../store/memory.js';
import * as J from '../../shared/journal.js';
import * as jobs from '../../shared/jobs.js';
import * as CORE from '../../shared/content-core.js';
import { STARTING_MONEY } from '../../shared/catalog.js';
import { MISSIONS_BY_CITY, ALL_MISSION_BY_ID } from '../../shared/missions.js';
import { PROPERTIES_BY_CITY, ALL_PROPERTY_BY_ID } from '../../shared/properties.js';
import { LANDMARKS_BY_CITY } from '../../shared/landmarks.js';
import { FEATS } from '../../shared/protocol.js';

// Les tests de ce fichier jouent à Paris (ville par défaut du protocole), quelle que soit MZ_CITY.
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 0, 15, 11, 0, 0); // jeudi 15 janvier 2026, midi à Paris : loin de la bascule de 4 h
const PARIS = MISSIONS_BY_CITY.paris, TOULOUSE = MISSIONS_BY_CITY.toulouse;
const lastStep = (m) => m.steps[m.steps.length - 1];
/** Mission chronométrée de niveau 1 (ni photo, ni ordre libre, ni introduction). */
const M1 = PARIS.find((m) => m.level === 1 && m.type !== 'photo' && !m.anyOrder && !m.intro);
const PHOTO = PARIS.find((m) => m.level === 1 && m.type === 'photo');
const APPART = ALL_PROPERTY_BY_ID.appart_marais; // 500 Ƶ de loyer par heure
const SPOTS = jobs.SPOTS_BY_CITY.paris, SIGHTS = jobs.LANDMARK_SPOTS_BY_CITY.paris;
const O = SPOTS[0]; // point de départ des courses et des Chiches

/** Profil enregistré d'un client. */
const store0 = (app, c) => app.store.getPlayer(c.welcome.id);
const count = (c, type, pred) => c.msgs.filter((m) => m.t === type && (!pred || pred(m))).length;
const sys = (c, re) => c.msgs.filter((m) => m.t === 'chat' && m.system && re.test(m.text));
/** Hasard pilotable du serveur : les valeurs de la file, puis 0,5. */
function dice() { const d = { q: [], rand: () => (d.q.length ? d.q.shift() : 0.5) }; return d; }

/**
 * Joue une mission de bout en bout : le joueur est posé au départ, démarre, ROULE d'étape en étape (le serveur mesure
 * le chemin : un temps sans trajet n'entre pas aux records) jusqu'à l'arrivée (ou jusqu'à 1 500 m d'elle si `far`), puis
 * termine `sec` secondes d'horloge serveur après le départ. `car` = modèle conduit pendant la mission (Citadine par défaut).
 */
async function play(app, c, m, { sec = m.minDurationSec + 30, car = null, far = false } = {}) {
  const end = lastStep(m), opts = car ? { car } : {};
  await place(app, c, m.start.x, m.start.z);
  c.send('mission_start', { id: m.id }); await c.sync();
  const t0 = app.clock.t;
  for (const s of m.steps) await drive(app, c, s.x, s.z, opts);
  if (far) await drive(app, c, end.x + (end.x > 0 ? -1500 : 1500), end.z, opts);
  const left = sec - (app.clock.t - t0) / 1000;
  assert.ok(left >= 0, `mission ${m.id} : ${sec} s ne suffisent pas au trajet (${(app.clock.t - t0) / 1000} s)`);
  app.clock.t = t0 + sec * 1000;
  return c.ask('mission_complete', { id: m.id, durationSec: 1 }, 'mission_result');
}
/** Client d'un compte DÉJÀ enregistré (un compte invité tout neuf n'est écrit dans le store qu'à sa première opération). */
async function joinKnown(app, opts) {
  const s = seedPlayer(app.store, { name: opts.name, money: STARTING_MONEY });
  const c = await join(app, { ...opts, token: s.token });
  c.token = s.token; // le serveur ne renvoie un jeton qu'à la création d'un compte
  return c;
}

// ---------------------------------------------------------------- compatibilité

test('compatibilité : un profil et une salle d’avant le contrat v6 se chargent, jouent une mission et se resauvegardent sans perte', async () => {
  const store = new MemoryStore();
  const prop = PROPERTIES_BY_CITY.paris[0], other = TOULOUSE[0];
  const old = seedPlayer(store, {
    raw: { name: 'Ancien', money: 7300, cars: ['citadine', 'taxi'], activeCar: 'taxi', stats: { missionsDone: 4, earned: 9000, playSeconds: 3600 }, cooldowns: { [other.id]: T0 - DAY }, rentCarry: 0.25, createdAt: T0 - 30 * DAY },
  });
  store.putRoom({ code: 'vieux', createdAt: T0 - 30 * DAY, owners: { [prop.id]: { id: old.id, name: 'Ancien' } }, members: { [old.id]: { name: 'Ancien', money: 7300 }, p00000000000000ab: { name: 'Absent', money: 99999 } } });
  const app = await boot({ store, at: T0 });
  try {
    const a = await join(app, { name: 'Ancien', room: 'vieux', token: old.token });
    const w = a.welcome;
    assert.equal(w.id, old.id);
    assert.deepEqual([w.me.money, w.me.cars, w.me.activeCar, w.me.properties], [7300, ['citadine', 'taxi'], 'taxi', [prop.id]]);
    assert.deepEqual([w.me.stats.missionsDone, w.me.stats.earned], [4, 9000]);
    assert.deepEqual(w.me.cooldowns, {}, 'les cooldowns de Toulouse ne sont pas envoyés dans une salle de Paris');
    assert.deepEqual([w.me.carColors, w.me.look], [{}, { h: 'std' }]);
    // fiche de membre à l'ancien format { name, money } : lue telle quelle (worth absent = money)
    assert.deepEqual(w.lb.map((e) => [e.name, e.worth, e.online]), [['Absent', 99999, false], ['Ancien', 7300 + 12000 + prop.price, true]]);
    assert.deepEqual([w.records, w.feed, w.cavale, w.styleDay, w.dare], [{}, [], null, null, null]);

    const r = await play(app, a, M1, { sec: 60 });
    assert.deepEqual([r.ok, r.sec, r.done, r.rank], [true, 60, 5, 1]);
    await quit(app, a);

    const p = await store.getPlayer(old.id);
    assert.equal(p.cooldowns[other.id], T0 - DAY, 'le cooldown de l’autre ville est conservé dans le profil');
    assert.ok(p.cooldowns[M1.id] > T0);
    assert.deepEqual([p.cars, p.activeCar, p.stats.missionsDone, p.createdAt], [['citadine', 'taxi'], 'taxi', 5, T0 - 30 * DAY]);
    const rent = Math.floor(0.25 + (prop.income * 62) / 3600); // 62 s connecté : le loyer du bien continue de tomber
    assert.equal(p.money, 7300 + r.reward + rent);
    assert.ok(p.tokenHash && p.stats.playSeconds >= 3600 && p.stats.earned === 9000 + r.reward + rent);
    assert.deepEqual([p.best[M1.id], p.look, p.journal.v], [{ v: 60 }, { h: 'std' }, 1]);
    const room = await store.getRoom('vieux');
    assert.deepEqual(room.owners, { [prop.id]: { id: old.id, name: 'Ancien' } });
    assert.deepEqual(room.members.p00000000000000ab, { name: 'Absent', money: 99999 }, 'la fiche d’un absent n’est pas réécrite');
    assert.deepEqual(Object.keys(room.members[old.id]).sort(), ['lvl', 'money', 'name', 'seenAt', 'st', 'worth']);
    assert.deepEqual([room.createdAt, room.city, room.room], [T0 - 30 * DAY, 'paris', 'vieux']);
    assert.deepEqual(room.records[M1.id].v.map((e) => [e.id, e.name, e.sec]), [[old.id, 'Ancien', 60]]);
    assert.equal(room.feed.length, 1, 'le record est dans la gazette');
  } finally { await app.close(); }
});

test('compatibilité : un client qui n’envoie que les anciens messages obtient les mêmes réponses, et tous les cooldowns de SA ville', async () => {
  const store = new MemoryStore();
  const all = seedPlayer(store, { name: 'Vétéran', money: 20000, done: 80, edit: (p) => { for (const id of Object.keys(ALL_MISSION_BY_ID)) p.cooldowns[id] = T0 - DAY; } });
  const app = await boot({ store, at: T0 });
  try {
    // ancien hello : ni ville, ni capacité ; les champs en plus de welcome sont simplement ignorés par ce client
    const a = await join(app, { name: 'Vieux' });
    for (const k of ['v', 'id', 'token', 'room', 'city', 'me', 'players', 'owners', 'lb', 'ts']) assert.ok(k in a.welcome, `welcome.${k}`);
    assert.deepEqual([a.welcome.city, a.welcome.me.money, a.welcome.mission], ['paris', STARTING_MONEY, null]);
    // mission sans aucun état de position (ancien robot) : gain de base, comme avant
    a.send('mission_start', { id: M1.id }); await a.sync();
    app.advance(M1.minDurationSec + 1);
    const r = await a.ask('mission_complete', { id: M1.id, durationSec: 9999 }, 'mission_result');
    assert.deepEqual([r.id, r.ok, r.reward], [M1.id, true, M1.reward]);
    const prof = await a.next('profile');
    assert.deepEqual([prof.me.money, prof.delta, prof.reason, prof.me.stats.missionsDone], [STARTING_MONEY + M1.reward, M1.reward, 'mission', 1]);
    assert.ok(M1.id in prof.me.cooldowns);
    const e = await a.ask('buy_car', { typeId: 'lambo_aventador' }, 'error');
    assert.deepEqual([e.op, e.code], ['buy_car', 'no_funds']);
    assert.equal((await a.ask('set_car', { typeId: 'citadine' }, 'profile')).me.activeCar, 'citadine');
    assert.equal((await a.ask('ping', { c: 7 }, 'pong')).c, 7);

    const v = await join(app, { name: 'Vétéran', token: all.token });
    assert.deepEqual(Object.keys(v.welcome.me.cooldowns).sort(), PARIS.map((m) => m.id).sort(), 'toutes les missions de Paris, aucune de Toulouse');
    assert.equal((await a.next('join')).name, 'Vétéran');
    const bought = await v.ask('buy_car', { typeId: 'taxi' }, 'profile');
    assert.deepEqual([bought.delta, bought.reason, bought.me.activeCar], [-12000, 'achat véhicule', 'taxi']);
    await a.close(); await v.close();
  } finally { await app.close(); }
});

test('welcome v6 : capacités, journal, records, gazette, apparence des joueurs présents ; join porte niveau, étoiles et klaxon', async () => {
  const store = new MemoryStore();
  const star = seedPlayer(store, { name: 'Étoile', done: 61, edit: (p) => { p.look = { h: 'legende' }; } });
  const app = await boot({ store, at: T0 });
  try {
    const a = await join(app, { name: 'Étoile', token: star.token });
    const b = await join(app, { name: 'Bob' });
    const w = b.welcome;
    assert.deepEqual(w.feat, FEATS);
    assert.deepEqual(w.feat, ['fun1', 'taxi', 'dare', 'heat', 'paint']);
    assert.deepEqual(w.players, [{ name: 'Étoile', id: star.id, lvl: 6, st: 1, look: { h: 'legende' } }]);
    assert.deepEqual([w.fresh, w.best, w.away, w.dare], [true, {}, null, null]);
    const j = w.journal;
    assert.deepEqual([j.day, j.lv, j.list.map((e) => e.id), j.streak, j.away], ['2026-01-15', 1, ['d1', 'd2', 'd3'], { n: 0, best: 0 }, null]);
    assert.equal(j.star, J.starFor('2026-01-15', 'paris', 1));
    assert.ok(j.resetAt > T0 && j.resetAt - T0 < DAY);
    const jn = await a.next('join');
    assert.deepEqual(jn, { t: 'join', name: 'Bob', id: w.id, lvl: 1, st: 0, look: { h: 'std' } });
    await a.close(); await b.close();
  } finally { await app.close(); }
});

// ---------------------------------------------------------------- poids et écritures

test('poids : document de salle le plus lourd (60 membres, 40 faits, 36 missions × 2 catégories × 3 records) < 40 ko, conservé par le serveur', async () => {
  const store = new MemoryStore();
  const rich = seedPlayer(store, { name: 'Pseudo-De-16-Car', money: 5_000_000_000 }); // plus riche que les 60 membres mémorisés
  const hex = (i) => 'pfade' + i.toString(16).padStart(12, '0'), name = (i) => `Joueur-Long-${String(i).padStart(4, '0')}`;
  const members = {}, records = {}, feed = [], owners = {};
  for (let i = 1; i <= 60; i++) members[hex(i)] = { name: name(i), money: 123456789 + i, worth: 987654321 + i, lvl: 6, st: 3, seenAt: T0 - i * 1000 };
  for (const m of TOULOUSE) {
    const top = (o) => [0, 1, 2].map((k) => ({ id: hex(1 + k + o), name: name(1 + k + o), sec: 123.4 + k, at: T0 - 5000 + k }));
    records[m.id] = { v: top(0), s: top(3) };
  }
  for (let i = 0; i < 40; i++) feed.push({ t: T0 - (40 - i) * 60000, k: 'record', id: hex(1 + (i % 9)), n: name(1 + (i % 9)), d: 123.4, m: TOULOUSE[i % TOULOUSE.length].id, c: 's', p: hex(10 + (i % 9)), pn: name(10 + (i % 9)) });
  for (const [i, pr] of PROPERTIES_BY_CITY.toulouse.entries()) owners[pr.id] = { id: hex(1 + (i % 60)), name: name(1 + (i % 60)) };
  const worst = { code: 'toulouse:poids', createdAt: T0 - DAY, city: 'toulouse', room: 'poids', owners, members, records, feed, cavale: { id: hex(1), name: name(1), sec: 12.3, at: T0 - 100 }, styleDay: { k: J.dayKey(T0), id: hex(2), name: name(2), pts: 59999 } };
  assert.equal(Object.keys(records).length, 36);
  const bytes = (o) => Buffer.byteLength(JSON.stringify(o));
  assert.ok(bytes(worst) < 40000, `document le plus lourd : ${bytes(worst)} octets`);
  store.putRoom(worst);

  const app = await boot({ store, at: T0 });
  try {
    const a = await join(app, { name: 'Pseudo-De-16-Car', room: 'poids', city: 'toulouse', token: rich.token });
    assert.deepEqual([a.welcome.lb.length, a.welcome.lb[0].id], [20, rich.id], 'classement borné à 20 lignes, le plus riche en tête');
    assert.equal(a.welcome.feed.length, 12);
    assert.deepEqual([a.welcome.cavale.sec, a.welcome.styleDay.pts], [12.3, 59999]);
    // un vrai fait et un vrai record écrits par le serveur ont la forme pesée ci-dessus
    await a.ask('buy_car', { typeId: 'taxi' }, 'profile');
    const m = TOULOUSE.find((x) => x.level === 1 && x.type !== 'photo' && !x.anyOrder);
    const r = await play(app, a, m, { sec: 30 });
    assert.deepEqual([r.ok, r.rank], [true, 1]);
    await quit(app, a);
    const saved = await store.getRoom('toulouse:poids');
    assert.ok(bytes(saved) < 40000, `document resauvegardé : ${bytes(saved)} octets`);
    if (process.env.MZ_VERBOSE) console.log(`# poids du document de salle : ${bytes(worst)} octets (pire cas), ${bytes(saved)} après passage par le serveur`);
    const timed = TOULOUSE.filter((x) => x.type !== 'photo');
    assert.equal(Object.keys(saved.records).length, timed.length, 'les records des missions chronométrées sont tous conservés');
    for (const x of timed) assert.deepEqual([saved.records[x.id].v.length, saved.records[x.id].s.length], [3, 3], x.id);
    assert.deepEqual(Object.keys(saved.records[m.id].v[0]), ['id', 'name', 'sec', 'at']);
    assert.equal(saved.records[m.id].v[0].id, rich.id);
    assert.equal(saved.feed.length, 40, 'gazette plafonnée à 40 faits');
    const shape = new Set(Object.keys(feed[0]));
    for (const e of saved.feed.slice(-3)) for (const k of Object.keys(e)) assert.ok(shape.has(k), `champ de gazette inattendu : ${k}`);
    assert.deepEqual(saved.feed.slice(-2).map((e) => e.k), ['car', 'record']);
    assert.equal(Object.keys(saved.members).length, 60, 'membres plafonnés à 60');
    assert.ok(saved.members[rich.id], 'le plus riche reste au classement');
    assert.equal(Object.keys(saved.owners).length, PROPERTIES_BY_CITY.toulouse.length);
  } finally { await app.close(); }
});

test('écritures : aucun putPlayer déclenché par 300 états ; distance et vitesse de pointe écrites au tick des loyers', async () => {
  const store = new MemoryStore();
  const app = await boot({ store, at: T0 });
  try {
    const a = await join(app, { name: 'Rouleur' });
    const writes = countWrites(store);
    sendState(a, 100, 100, { car: 'citadine', speed: 15 }); await a.sync();
    for (let b = 0; b < 30; b++) {
      app.advance(1); // 10 m par seconde, 10 états par seconde
      for (let i = 1; i <= 10; i++) sendState(a, 100 + b * 10 + i, 100, { car: 'citadine', speed: 15 });
      await a.sync();
    }
    assert.deepEqual(writes, { players: 0, rooms: 0 }, 'ni profil ni salle écrits au rythme des états');
    app.game.tickRents();
    const prof = await a.next('profile');
    assert.equal(prof.delta, undefined, 'profil rafraîchi sans mouvement d’argent');
    assert.equal(prof.me.stats.distance, 300);
    assert.equal(prof.me.stats.topSpeed, 10, 'min(vitesse déclarée 15 m/s, vitesse mesurée 10 m/s)');
    assert.equal(writes.players, 1);
    assert.equal((await store.getPlayer(a.welcome.id)).journal.day.c.km, 300);
    // une téléportation ne compte ni dans la distance ni dans la vitesse
    await place(app, a, 2000, 2000, { car: 'citadine', speed: 15 });
    app.game.tickRents(); await a.sync();
    assert.equal((await store.getPlayer(a.welcome.id)).stats.distance, 300);
    await a.close();
  } finally { await app.close(); }
});

// ---------------------------------------------------------------- missions

test('missions : sec = durée de l’horloge serveur, done = missionsDone, prime de première réussite versée une seule fois', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await join(app, { name: 'Alice' });
    const first = Math.floor(M1.reward * 0.25);
    let r = await play(app, a, M1, { sec: 73.4 });
    assert.deepEqual([r.ok, r.sec, r.cls, r.best, r.pb, r.first, r.star, r.done], [true, 73.4, 'v', null, true, first, 0, 1]);
    assert.equal(r.reward, M1.reward + first, 'reward = total crédité');
    let prof = await a.next('profile');
    assert.deepEqual([prof.delta, prof.reason, prof.me.money, prof.me.stats.missionsDone], [M1.reward + first, 'mission', STARTING_MONEY + M1.reward + first, 1]);
    assert.equal(prof.me.best, undefined, 'les records personnels ne voyagent pas dans S.PROFILE');
    assert.equal((await a.next('journal')).j.day, '2026-01-15');
    app.advance(M1.cooldownSec + 1);
    r = await play(app, a, M1, { sec: 80 });
    assert.deepEqual([r.ok, r.sec, r.best, r.pb, r.first, r.reward, r.done], [true, 80, 73.4, false, 0, M1.reward, 2]);
    // les records personnels reviennent à l'accueil, pour les missions de la ville de la salle
    await quit(app, a);
    const again = await join(app, { name: 'Alice', token: a.welcome.token });
    assert.deepEqual(again.welcome.best, { [M1.id]: { v: 73.4 } });
    await again.close();
  } finally { await app.close(); }
});

test('missions : position hors tolérance => gain de base payé, ni record ni prime', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await join(app, { name: 'Alice' }), b = await join(app, { name: 'Bob' });
    const r = await play(app, a, M1, { sec: 60, far: true });
    assert.deepEqual([r.ok, r.reward, r.first, r.star, r.pb, r.rank, r.prev, r.roomBest, r.done], [true, M1.reward, 0, 0, false, 0, null, null, 1]);
    assert.equal((await a.next('profile')).me.money, STARTING_MONEY + M1.reward);
    await b.sync();
    assert.equal(count(b, 'records'), 0, 'aucun record de salle');
    assert.equal(sys(b, /a réussi la mission/).length, 1, 'la réussite reste annoncée');
    await quit(app, a);
    const again = await join(app, { name: 'Alice', token: a.welcome.token });
    assert.deepEqual([again.welcome.best, again.welcome.records], [{}, {}]);
    await again.close(); await b.close();
  } finally { await app.close(); }
});

test('missions : mission de niveau 6 refusée (locked) pour un compte neuf', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await join(app, { name: 'Neuf' });
    const six = PARIS.find((m) => m.level === 6);
    const r = await a.ask('mission_start', { id: six.id }, 'mission_result');
    assert.deepEqual([r.id, r.ok, r.reward, r.code], [six.id, false, 0, 'locked']);
    assert.match(r.reason, /niveau 6 requis/);
    app.advance(six.minDurationSec + 60);
    const done = await a.ask('mission_complete', { id: six.id }, 'mission_result');
    assert.deepEqual([done.ok, done.code], [false, 'not_started']);
    await a.close();
  } finally { await app.close(); }
});

test('missions : un état en Muggini Furiosa pendant la mission => catégorie Sport, le record Ville ne change pas', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await join(app, { name: 'Alice' });
    let r = await play(app, a, M1, { sec: 90, car: 'citadine' });
    assert.deepEqual([r.cls, r.rank, r.roomBest.sec], ['v', 1, 90]);
    app.advance(M1.cooldownSec + 1);
    r = await play(app, a, M1, { sec: 40, car: 'lambo_aventador' });
    assert.deepEqual([r.cls, r.best, r.pb, r.rank, r.roomBest.sec], ['s', null, true, 1, 40]);
    await quit(app, a);
    const again = await join(app, { name: 'Alice', token: a.welcome.token });
    assert.deepEqual(again.welcome.best, { [M1.id]: { v: 90, s: 40 } });
    assert.deepEqual([again.welcome.records[M1.id].v.sec, again.welcome.records[M1.id].s.sec], [90, 40]);
    await again.close();
  } finally { await app.close(); }
});

test('records de salle : record battu => S.RECORDS reçu par un second client, ligne système, détenteur détrôné dans la gazette', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await join(app, { name: 'Alice' }), b = await join(app, { name: 'Bob' });
    let r = await play(app, a, M1, { sec: 60 });
    assert.deepEqual([r.rank, r.prev, r.roomBest], [1, null, { id: a.welcome.id, name: 'Alice', sec: 60 }]);
    let rec = await b.next('records');
    assert.deepEqual(rec, { t: 'records', id: M1.id, cls: 'v', top: [{ id: a.welcome.id, name: 'Alice', sec: 60 }] });
    assert.match((await b.next('chat', (m) => m.system)).text, /^Record de salle ! Alice boucle « .+ » en 1:00,0 \(catégorie Ville\)\.$/);

    r = await play(app, b, M1, { sec: 40 });
    assert.deepEqual([r.rank, r.prev, r.roomBest.name, r.pb], [1, { id: a.welcome.id, name: 'Alice', sec: 60 }, 'Bob', true]);
    rec = await a.next('records', (m) => m.top.length === 2);
    assert.deepEqual(rec.top.map((e) => [e.name, e.sec]), [['Bob', 40], ['Alice', 60]]);
    assert.match((await a.next('chat', (m) => m.system && /Bob/.test(m.text))).text, /Alice perd son record/);
    const fact = (await a.next('feed', (m) => m.e.id === b.welcome.id)).e;
    assert.deepEqual([fact.k, fact.n, fact.d, fact.m, fact.c, fact.p, fact.pn], ['record', 'Bob', 40, M1.id, 'v', a.welcome.id, 'Alice']);
    assert.equal(fact.x, `Bob bat le record d'Alice sur « ${M1.title} » (0:40,0, Ville)`, 'élision devant le pseudo, catégorie dans la parenthèse');

    // Alice améliore son temps sans reprendre la tête : podium mis à jour, pas d'annonce de record
    app.advance(M1.cooldownSec + 1);
    a.msgs = []; b.msgs = [];
    r = await play(app, a, M1, { sec: 50 });
    assert.deepEqual([r.rank, r.prev, r.best, r.pb, r.roomBest.name], [2, null, 60, true, 'Bob']);
    await b.sync();
    assert.deepEqual(b.msgs.find((m) => m.t === 'records').top.map((e) => [e.name, e.sec]), [['Bob', 40], ['Alice', 50]]);
    assert.equal(sys(b, /Record de salle/).length, 0);
    assert.equal(sys(b, /Alice a réussi la mission/).length, 1);
    assert.equal(count(b, 'feed'), 0);
    // le classement compte les records détenus
    app.game.tickLeaderboards();
    const lb = await b.next('lb');
    assert.deepEqual(lb.list.map((e) => [e.name, e.rec]).sort(), [['Alice', 0], ['Bob', 1]]);
    await a.close(); await b.close();
  } finally { await app.close(); }
});

test('records de salle : podium de 3 places, une entrée par joueur, un temps plus lent n’entre pas', async () => {
  const app = await boot({ at: T0 });
  try {
    const names = ['Ana', 'Ben', 'Cléo', 'Dan'], secs = [50, 40, 30, 20], cs = [];
    for (const n of names) cs.push(await join(app, { name: n }));
    const ranks = [];
    for (let i = 0; i < 4; i++) ranks.push((await play(app, cs[i], M1, { sec: secs[i] })).rank);
    assert.deepEqual(ranks, [1, 1, 1, 1]);
    const eve = await join(app, { name: 'Ève' });
    assert.deepEqual(eve.welcome.records[M1.id], { v: { id: cs[3].welcome.id, name: 'Dan', sec: 20 } });
    const r = await play(app, eve, M1, { sec: 45 }); // plus lent que le 3e (40 s)
    assert.deepEqual([r.ok, r.rank, r.pb, r.roomBest.name], [true, 0, true, 'Dan']);
    await cs[0].sync();
    const tops = cs[0].msgs.filter((m) => m.t === 'records').map((m) => m.top.map((e) => e.sec));
    assert.deepEqual(tops, [[50], [40, 50], [30, 40, 50], [20, 30, 40]]);
    for (const c of [...cs, eve]) await c.close();
  } finally { await app.close(); }
});

test('niveau et étoiles : montée détectée par le serveur => S.LOOK à la salle, ligne système et gazette', async () => {
  const store = new MemoryStore();
  const two = seedPlayer(store, { name: 'Presque', money: 5000, done: 2 });
  const leg = seedPlayer(store, { name: 'Légende', money: 5000, done: 59 });
  const app = await boot({ store, at: T0 });
  try {
    const b = await join(app, { name: 'Témoin' });
    const a = await join(app, { name: 'Presque', token: two.token });
    assert.equal((await b.next('join')).lvl, 1);
    let r = await play(app, a, M1, { sec: 60 });
    assert.equal(r.done, 3);
    assert.deepEqual(await b.next('look'), { t: 'look', id: two.id, lvl: 2, st: 0, look: { h: 'std' } });
    assert.equal((await a.next('look')).lvl, 2, 'le joueur reçoit aussi son étiquette');
    assert.match((await b.next('chat', (m) => m.system && /niveau/.test(m.text))).text, /^Presque passe niveau 2 — Coursier !$/);
    const fact = (await b.next('feed', (m) => m.e.k === 'level')).e;
    assert.deepEqual([fact.id, fact.d, fact.st], [two.id, 2, undefined]);

    const l = await join(app, { name: 'Légende', token: leg.token });
    r = await play(app, l, M1, { sec: 70 });
    assert.equal(r.done, 60);
    assert.deepEqual(await b.next('look', (m) => m.id === leg.id), { t: 'look', id: leg.id, lvl: 6, st: 1, look: { h: 'std' } });
    assert.match((await b.next('chat', (m) => m.system && /étoile/.test(m.text))).text, /Légende décroche sa première étoile de Légende/);
    assert.equal((await b.next('feed', (m) => m.e.k === 'level' && m.e.st === 1)).e.id, leg.id);
    // l'étoile débloque son klaxon : la salle voit le changement
    assert.deepEqual((await l.ask('set_look', { horn: 'legende' }, 'profile')).me.look, { h: 'legende' });
    assert.deepEqual((await b.next('look', (m) => m.look.h === 'legende')).st, 1);
    app.game.tickLeaderboards();
    const row = (await b.next('lb')).list.find((e) => e.id === leg.id);
    assert.deepEqual([row.lvl, row.st, row.online], [6, 1, true]);
    await a.close(); await b.close(); await l.close();
  } finally { await app.close(); }
});

test('missions photo : réussite payée, mais ni record personnel ni record de salle', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await join(app, { name: 'Alice' }), b = await join(app, { name: 'Bob' });
    const r = await play(app, a, PHOTO, { sec: PHOTO.minDurationSec + 20 });
    assert.deepEqual([r.ok, r.pb, r.rank, r.roomBest, r.prev], [true, false, 0, null, null]);
    assert.ok(r.first > 0, 'la prime de première réussite, elle, est versée');
    await b.sync();
    assert.equal(count(b, 'records'), 0);
    await quit(app, a);
    const again = await join(app, { name: 'Alice', token: a.welcome.token });
    assert.deepEqual([again.welcome.best, again.welcome.records], [{}, {}]);
    await again.close(); await b.close();
  } finally { await app.close(); }
});

// ---------------------------------------------------------------- carnet de bord

test('journal : welcome.fresh vrai au premier hello du jour, faux au second, vrai de nouveau le lendemain', async () => {
  const store = new MemoryStore();
  const old = seedPlayer(store, { name: 'Habitué', money: 5000 });
  const app = await boot({ store, at: T0 });
  try {
    let a = await join(app, { name: 'Nouveau' });
    assert.equal(a.welcome.fresh, true, 'compte neuf');
    const token = a.welcome.token;
    await quit(app, a);
    a = await join(app, { name: 'Nouveau', token });
    assert.equal(a.welcome.fresh, false);
    await quit(app, a);
    app.advance(24 * 3600);
    a = await join(app, { name: 'Nouveau', token });
    assert.deepEqual([a.welcome.fresh, a.welcome.journal.day], [true, '2026-01-16']);
    await quit(app, a);
    a = await join(app, { name: 'Nouveau', token });
    assert.equal(a.welcome.fresh, false);
    const h = await join(app, { name: 'Habitué', token: old.token });
    assert.equal(h.welcome.fresh, true, 'compte existant, premier hello du jour');
    await a.close(); await h.close();
  } finally { await app.close(); }
});

test('journal : la mission vedette paie double une fois, valide d1 ; C.CLAIM paie une fois et refuse la double réclamation', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await join(app, { name: 'Alice' });
    const star = ALL_MISSION_BY_ID[a.welcome.journal.star];
    assert.ok(star && star.city === 'paris' && star.level === 1);
    assert.equal(a.welcome.journal.list[0].have, 0);
    let e = await a.ask('claim', { kind: 'daily', id: 'd1' }, 'error');
    assert.deepEqual([e.op, e.code], ['claim', 'not_ready']);
    const r = await play(app, a, star, { sec: star.minDurationSec + 40 });
    assert.deepEqual([r.ok, r.star, r.first, r.reward], [true, star.reward, Math.floor(star.reward * 0.25), star.reward * 2 + Math.floor(star.reward * 0.25)]);
    let j = (await a.next('journal')).j;
    assert.deepEqual([j.list[0].kind, j.list[0].have, j.list[0].claimed, j.full.ready], ['star', 1, false, false]);
    a.msgs = [];
    const before = STARTING_MONEY + r.reward;
    const p = await a.ask('claim', { kind: 'daily', id: 'd1' }, 'profile');
    assert.deepEqual([p.delta, p.reason, p.me.money, p.me.stats.dailyDone], [600, 'défi du jour', before + 600, 1]);
    j = (await a.next('journal')).j;
    assert.equal(j.list[0].claimed, true);
    e = await a.ask('claim', { kind: 'daily', id: 'd1' }, 'error');
    assert.equal(e.code, 'claimed');
    assert.equal((await a.ask('claim', { kind: 'daily', id: 'full' }, 'error')).code, 'not_ready');
    assert.equal((await a.ask('claim', { kind: 'daily', id: 'd9' }, 'error')).code, 'bad_claim');
    assert.equal((await a.ask('claim', { kind: 'cadeau' }, 'error')).code, 'bad_claim');
    assert.equal((await a.ask('claim', { kind: 'away' }, 'error')).code, 'nothing');
    // la vedette rejouée le même jour ne paie plus double
    app.advance(star.cooldownSec + 1);
    assert.deepEqual([(await play(app, a, star, { sec: star.minDurationSec + 40 })).star], [0]);
    await a.close();
  } finally { await app.close(); }
});

test('journal : tickJournal n’envoie S.JOURNAL que si les kilomètres affichés ont changé, et à la bascule de 4 h', async () => {
  const kmDay = T0 + 3 * DAY; // dimanche 18 janvier : le troisième défi est « rouler 3 km »
  assert.equal(J.dailyFor(J.dayKey(kmDay), 1).list[2].kind, 'km');
  assert.equal(J.dailyFor(J.dayKey(T0), 1).list[2].kind, 'style');
  let app = await boot({ at: kmDay });
  try {
    const a = await join(app, { name: 'Rouleur' });
    sendState(a, 0, 500, { car: 'citadine' }); await a.sync();
    await drive(app, a, 400, 500);
    app.game.tickJournal();
    let j = (await a.next('journal')).j;
    assert.deepEqual([j.list[2].kind, j.list[2].goal, j.list[2].have], ['km', 3000, 400]);
    app.game.tickJournal(); await a.sync();
    assert.equal(count(a, 'journal'), 0, 'rien de neuf : rien d’envoyé');
    // bascule de jour pour un joueur connecté et immobile
    app.advance(24 * 3600);
    app.game.tickJournal();
    j = (await a.next('journal')).j;
    assert.deepEqual([j.day, j.list[2].have], ['2026-01-19', 0]);
    await a.close();
  } finally { await app.close(); }
  app = await boot({ at: T0 }); // jour sans défi kilométrique : rouler ne déclenche aucun envoi
  try {
    const a = await join(app, { name: 'Rouleur' });
    sendState(a, 0, 500, { car: 'citadine' }); await a.sync();
    await drive(app, a, 400, 500);
    app.game.tickJournal(); await a.sync();
    assert.equal(count(a, 'journal'), 0);
    await a.close();
  } finally { await app.close(); }
});

test('journal : journée complète (prime majorée par la série), série 1 puis 2 le lendemain, annonce et gazette', async () => {
  const store = new MemoryStore();
  /** Remplit les compteurs du jour du profil pour que les trois défis soient réussis. */
  const fill = (p, now) => {
    const st = J.dailyState(p, now), c = p.journal.day.c;
    for (const e of st.list) {
      if (e.kind === 'star') c.star = 1; else if (e.kind === 'missions') c.m = e.goal; else if (e.kind === 'fares') c.fares = e.goal;
      else if (e.kind === 'types') c.types = Object.keys(CORE.MISSION_TYPES).slice(0, e.goal); else c[e.kind] = e.goal;
    }
  };
  const s = seedPlayer(store, { name: 'Assidu', money: 0, edit: (p) => fill(p, T0) });
  const app = await boot({ store, at: T0 });
  try {
    const b = await join(app, { name: 'Témoin' });
    let a = await join(app, { name: 'Assidu', token: s.token });
    assert.deepEqual([a.welcome.fresh, a.welcome.journal.full], [false, { reward: 990, ready: true, claimed: false }]);
    let total = 0;
    for (const id of ['d1', 'd2', 'd3']) total += (await a.ask('claim', { kind: 'daily', id }, 'profile')).delta;
    assert.equal(total, 1800);
    let p = await a.ask('claim', { kind: 'daily', id: 'full' }, 'profile');
    assert.deepEqual([p.delta, p.reason, p.me.money], [990, 'journée complète', 2790]);
    assert.ok(total + p.delta <= 5.25 * 600);
    let j = (await a.next('journal', (m) => m.j.full.claimed)).j;
    assert.deepEqual([j.streak, j.full.ready], [{ n: 1, best: 1 }, false]);
    assert.equal((await a.ask('claim', { kind: 'daily', id: 'full' }, 'error')).code, 'claimed');
    await b.sync();
    assert.equal(count(b, 'feed'), 0, 'une série d’un jour ne fait pas la gazette');
    await quit(app, a);

    // le lendemain : le profil est relu du stockage avec ses trois défis réussis
    app.advance(24 * 3600);
    app.game.tickHeartbeat(); // le compte gardé en mémoire 5 min est libéré
    const rec = await store.getPlayer(s.id);
    fill(rec, app.clock.t);
    store.putPlayer(rec);
    a = await join(app, { name: 'Assidu', token: s.token });
    assert.deepEqual([a.welcome.fresh, a.welcome.journal.day, a.welcome.journal.streak.n, a.welcome.journal.full.reward], [false, '2026-01-16', 1, 1080]);
    p = await a.ask('claim', { kind: 'daily', id: 'full' }, 'profile');
    assert.deepEqual([p.delta, p.reason], [1080, 'journée complète']); // 900 × (1 + 0,1 × 2)
    j = (await a.next('journal', (m) => m.j.full.claimed)).j;
    assert.deepEqual(j.streak, { n: 2, best: 2 });
    assert.match((await b.next('chat', (m) => m.system && /jours de défis/.test(m.text))).text, /Assidu enchaîne 2 jours de défis/);
    assert.deepEqual((({ k, id, d }) => [k, id, d])((await b.next('feed')).e), ['streak', s.id, 2]);
    await a.close(); await b.close();
  } finally { await app.close(); }
});

// ---------------------------------------------------------------- relevé du matin

/** Un propriétaire de l'appartement du Marais (500 Ƶ/h) : acheté par le serveur, puis le joueur s'en va. */
async function landlord(store, app, money = 100000) {
  const s = seedPlayer(store, { name: 'Proprio', money });
  const a = await join(app, { name: 'Proprio', token: s.token });
  await a.ask('buy_prop', { id: APPART.id }, 'profile');
  await quit(app, a);
  return s;
}
/** Absence de `hours` heures puis retour : le client reconnecté. */
async function back(app, s, hours) {
  app.advance(hours * 3600);
  return join(app, { name: 'Proprio', token: s.token });
}

test('relevé : bien à 500 Ƶ/h, 10 h d’absence => 2 500 Ƶ détaillés par bien, encaissables une seule fois (motif loyers)', async () => {
  assert.equal(APPART.income, 500);
  const store = new MemoryStore(), app = await boot({ store, at: T0 });
  try {
    const s = await landlord(store, app);
    const a = await back(app, s, 10);
    assert.deepEqual(a.welcome.away, { sec: 36000, rent: 2500, props: [{ id: APPART.id, name: APPART.name, rent: 2500 }] });
    assert.deepEqual(a.welcome.journal.away, { rent: 2500, sec: 36000, props: [{ id: APPART.id, name: APPART.name, rent: 2500 }] });
    assert.equal(a.welcome.me.money, 100000 - APPART.price, 'rien n’est crédité avant la réclamation');
    const p = await a.ask('claim', { kind: 'away' }, 'profile');
    assert.deepEqual([p.delta, p.reason, p.me.money], [2500, 'loyers', 100000 - APPART.price + 2500]);
    assert.equal((await a.next('journal')).j.away, null);
    const e = await a.ask('claim', { kind: 'away' }, 'error');
    assert.deepEqual([e.op, e.code], ['claim', 'nothing']);
    await a.close();
  } finally { await app.close(); }
});

test('relevé : 20 min => rien ; reconnexion à 5 min => welcome.away nul ; 40 h => 3 000 Ƶ (12 h au plus)', async () => {
  const store = new MemoryStore(), app = await boot({ store, at: T0 });
  try {
    const s = await landlord(store, app);
    let a = await back(app, s, 20 / 60);
    assert.deepEqual([a.welcome.away, a.welcome.journal.away], [null, null]);
    await quit(app, a);
    a = await back(app, s, 5 / 60);
    assert.deepEqual([a.welcome.away, a.welcome.journal.away], [null, null]);
    await quit(app, a);
    a = await back(app, s, 40);
    assert.deepEqual([a.welcome.away.rent, a.welcome.away.sec], [3000, 144000]);
    // une coupure de 5 min ne rouvre pas la fiche, mais le relevé reste à encaisser dans le carnet
    await quit(app, a);
    a = await back(app, s, 5 / 60);
    assert.deepEqual([a.welcome.away, a.welcome.journal.away.rent], [null, 3000]);
    assert.equal((await a.ask('claim', { kind: 'away' }, 'profile')).delta, 3000);
    await a.close();
  } finally { await app.close(); }
});

test('relevé : deux absences de 10 h sans encaisser => 5 000 Ƶ ; cinq absences => plafond de 6 000 Ƶ', async () => {
  const store = new MemoryStore(), app = await boot({ store, at: T0 });
  try {
    const s = await landlord(store, app);
    const seen = [];
    let a = null;
    for (let i = 0; i < 5; i++) {
      a = await back(app, s, 10);
      seen.push([a.welcome.away?.rent ?? null, a.welcome.journal.away.rent]);
      if (i < 4) await quit(app, a);
    }
    assert.deepEqual(seen, [[2500, 2500], [5000, 5000], [6000, 6000], [null, 6000], [null, 6000]]);
    const p = await a.ask('claim', { kind: 'away' }, 'profile');
    assert.deepEqual([p.delta, p.me.money], [6000, 100000 - APPART.price + 6000]);
    await a.close();
  } finally { await app.close(); }
});

test('relevé : la période connectée n’est jamais payée deux fois', async () => {
  const store = new MemoryStore(), app = await boot({ store, at: T0 });
  try {
    const s = await landlord(store, app);
    let a = await back(app, s, 0);
    let rents = 0;
    for (let h = 0; h < 10; h++) { app.advance(3600); app.game.tickRents(); rents += (await a.next('profile', (m) => m.reason === 'loyers')).delta; }
    assert.equal(rents, 5000, '10 h connectées : loyers pleins');
    await quit(app, a);
    a = await back(app, s, 0);
    assert.deepEqual([a.welcome.away, a.welcome.journal.away], [null, null]);
    assert.equal(a.welcome.me.money, 100000 - APPART.price + 5000);
    assert.equal((await a.ask('claim', { kind: 'away' }, 'error')).code, 'nothing');
    await a.close();
  } finally { await app.close(); }
});

// ---------------------------------------------------------------- taxi libre

const MOOD_DICE = { normal: 0.1, presse: 0.6, touriste: 0.8, fragile: 0.9 };
/** Point de rendez-vous (ou monument) correspondant à la destination annoncée par le serveur. */
const spotOf = (to, list) => list.find((s) => Math.abs(s.x - to.x) < 0.06 && Math.abs(s.z - to.z) < 0.06 && s.label === to.label);
/** Prend un client depuis O au volant de `car` : { job, t0 (horloge du départ), spot, dist }. */
async function fare(app, d, c, mood = 'normal', car = 'citadine') {
  await place(app, c, O.x, O.z, { car });
  d.q = [MOOD_DICE[mood], 0.3];
  const job = await c.ask('job_start', { kind: 'taxi' }, 'job');
  const spot = spotOf(job.to, mood === 'touriste' ? SIGHTS : SPOTS) || spotOf(job.to, SPOTS);
  return { job, t0: app.clock.t, spot, dist: Math.hypot(spot.x - O.x, spot.z - O.z) };
}

test('taxi : départ refusé sans position, à pied, pendant une mission, ou pour une activité inconnue', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await join(app, { name: 'Chauffeur' });
    let r = await a.ask('job_start', { kind: 'taxi' }, 'job_result');
    assert.deepEqual(r, { t: 'job_result', ok: false, id: null, fare: 0, tip: 0, chain: 0, capped: false, code: 'no_pos', reason: r.reason });
    await place(app, a, O.x, O.z);
    assert.equal((await a.ask('job_start', { kind: 'taxi' }, 'job_result')).code, 'no_vehicle');
    await place(app, a, O.x, O.z, { car: 'citadine' });
    assert.equal((await a.ask('job_start', { kind: 'livraison' }, 'job_result')).code, 'bad_kind');
    a.send('mission_start', { id: M1.id }); await a.sync();
    assert.equal((await a.ask('job_start', { kind: 'taxi' }, 'job_result')).code, 'busy');
    a.send('mission_abort', {}); await a.sync();
    const job = await a.ask('job_start', { kind: 'taxi' }, 'job');
    assert.deepEqual([job.kind, job.chain, job.taxi, job.to.r], ['taxi', 1, false, job.mood === 'touriste' ? job.to.r : 45]);
    assert.equal((await a.ask('job_done', { id: 'autre', hits: 0 }, 'job_result')).code, 'no_job');
    await a.close();
  } finally { await app.close(); }
});

test('taxi : arrivée à 300 m refusée too_far (course conservée), puis fare + tip conformes pour les quatre caractères', async () => {
  const d = dice(), app = await boot({ at: T0, rand: d.rand });
  try {
    const a = await join(app, { name: 'Chauffeur' });
    const late = { normal: 0.5, presse: 1.3, touriste: 0.5, fragile: 1.0 }, hits = { normal: 0, presse: 1, touriste: 0, fragile: 1 };
    let money = STARTING_MONEY, n = 0;
    for (const mood of ['normal', 'presse', 'touriste', 'fragile']) {
      const { job, t0, spot, dist } = await fare(app, d, a, mood);
      assert.equal(job.mood, mood);
      assert.ok(dist >= 500 && dist <= 1500, `destination à ${Math.round(dist)} m`);
      assert.deepEqual([job.fare, job.parSec, job.chain], [jobs.fareFor(dist, 1, false, mood), jobs.parFor(dist, mood, 'paris'), 1], mood);
      assert.equal(!!spot.landmark, mood === 'touriste', 'le touriste va voir un monument');
      // trop loin : refusé, la course continue
      await place(app, a, job.to.x + (mood === 'touriste' ? job.to.r + 255 : 300), job.to.z, { car: 'citadine' });
      let r = await a.ask('job_done', { id: job.id, hits: 0 }, 'job_result');
      assert.deepEqual([r.ok, r.code, r.id], [false, 'too_far', job.id], mood);
      app.advance(Math.round(job.parSec * late[mood]));
      await place(app, a, job.to.x, job.to.z, { car: 'citadine' });
      const elapsed = (app.clock.t - t0) / 1000;
      r = await a.ask('job_done', { id: job.id, hits: hits[mood] }, 'job_result');
      const tip = jobs.tipFor(job.fare, mood, elapsed, job.parSec, hits[mood]);
      assert.deepEqual(r, { t: 'job_result', ok: true, id: job.id, fare: job.fare, tip, chain: 1, capped: false, total: job.fare + tip }, mood);
      const p = await a.next('profile');
      money += job.fare + tip; n += 1;
      assert.deepEqual([p.delta, p.reason, p.me.money, p.me.stats.fares, p.me.stats.missionsDone], [job.fare + tip, 'course de taxi', money, n, 0], mood);
      assert.equal((await a.next('journal')).j.day, '2026-01-15');
      assert.equal((await a.ask('job_done', { id: job.id, hits: 0 }, 'job_result')).code, 'no_job', 'une course ne se paie qu’une fois');
      app.advance(300); // au-delà de 2 minutes : pas de série
    }
    const saved = await app.store.getPlayer(a.welcome.id);
    assert.deepEqual([saved.journal.day.c.fares, saved.stats.fareEarned, saved.stats.fareBestChain], [4, money - STARTING_MONEY, 1]);
    await a.close();
  } finally { await app.close(); }
});

test('taxi : série (client suivant dans les 2 minutes), bonus au volant de SON Taxi Parisien, plafond horaire', async () => {
  const store = new MemoryStore(), d = dice();
  const ROOM_LEFT = 1000; // ce qu'il reste sous le plafond de l'heure : la 1re course (moins de 1 500 m) y tient, pas la 2e
  const s = seedPlayer(store, { name: 'Chauffeur', money: 0, edit: (p) => { p.cars.push('taxi'); p.journal.fareWin = { at: T0, paid: 15000 - ROOM_LEFT }; } });
  const app = await boot({ store, at: T0, rand: d.rand });
  try {
    const a = await join(app, { name: 'Chauffeur', token: s.token });
    // 1re course, en Citadine : pas de bonus
    let f = await fare(app, d, a, 'normal');
    assert.deepEqual([f.job.taxi, f.job.fare], [false, jobs.fareFor(f.dist, 1, false, 'normal')]);
    app.advance(f.job.parSec);
    await place(app, a, f.job.to.x, f.job.to.z, { car: 'citadine' });
    let r = await a.ask('job_done', { id: f.job.id, hits: 0 }, 'job_result');
    assert.deepEqual([r.ok, r.chain, r.capped], [true, 1, false]);
    const paid = r.total;
    assert.equal((await a.next('profile')).me.money, paid);
    // 2e course dans la foulée, au volant de son taxi : série ×1,1 et bonus de 25 %
    f = await fare(app, d, a, 'normal', 'taxi');
    assert.deepEqual([f.job.taxi, f.job.chain, f.job.fare], [true, 2, jobs.fareFor(f.dist, 1, true, 'normal')]);
    app.advance(f.job.parSec);
    await place(app, a, f.job.to.x, f.job.to.z, { car: 'taxi' });
    r = await a.ask('job_done', { id: f.job.id, hits: 0 }, 'job_result');
    const nominal = Math.round((r.fare + r.tip) * 1.1), room = ROOM_LEFT - paid;
    assert.ok(nominal > room, 'la deuxième course franchit le plafond de l’heure');
    assert.deepEqual([r.chain, r.capped, r.total], [2, true, room + Math.round((nominal - room) * 0.25)]);
    const p = await a.next('profile');
    assert.deepEqual([p.delta, p.me.money, p.me.stats.fareBestChain], [r.total, paid + r.total, 2]);
    // au-delà du plafond : tout au quart
    f = await fare(app, d, a, 'normal', 'taxi');
    app.advance(f.job.parSec);
    await place(app, a, f.job.to.x, f.job.to.z, { car: 'taxi' });
    r = await a.ask('job_done', { id: f.job.id, hits: 0 }, 'job_result');
    assert.deepEqual([r.chain, r.capped, r.total], [3, true, Math.round(Math.round((r.fare + r.tip) * 1.2) * 0.25)]);
    await a.close();
  } finally { await app.close(); }
});

test('taxi : une coupure perd la course, une arrivée trop rapide l’annule, job_abort la rend sans frais', async () => {
  const d = dice(), app = await boot({ at: T0, rand: d.rand });
  try {
    let a = await joinKnown(app, { name: 'Chauffeur' });
    const token = a.token;
    let f = await fare(app, d, a);
    await quit(app, a);
    a = await join(app, { name: 'Chauffeur', token });
    app.advance(f.job.parSec);
    await place(app, a, f.job.to.x, f.job.to.z, { car: 'citadine' });
    assert.equal((await a.ask('job_done', { id: f.job.id, hits: 0 }, 'job_result')).code, 'no_job');
    // trop rapide : 2 s pour plus de 500 m, alors que le minimum est dist / 60
    f = await fare(app, d, a);
    await place(app, a, f.job.to.x, f.job.to.z, { car: 'citadine' });
    const r = await a.ask('job_done', { id: f.job.id, hits: 0 }, 'job_result');
    assert.deepEqual([r.ok, r.code], [false, 'too_fast']);
    assert.equal((await a.ask('job_done', { id: f.job.id, hits: 0 }, 'job_result')).code, 'no_job');
    f = await fare(app, d, a);
    a.send('job_abort', {}); await a.sync();
    assert.equal((await a.ask('job_done', { id: f.job.id, hits: 0 }, 'job_result')).code, 'no_job');
    assert.equal((await app.store.getPlayer(a.welcome.id)).stats.fares, 0);
    await a.close();
  } finally { await app.close(); }
});

// ---------------------------------------------------------------- Chiche

/** Valeur de hasard qui fait tirer au serveur l'arrivée la plus proche de la couronne 900–2 000 m autour de O. */
function nearestFinish() {
  const ring = SPOTS.filter((s) => { const dd = Math.hypot(s.x - O.x, s.z - O.z); return dd >= 900 && dd <= 2000; });
  let best = 0;
  ring.forEach((s, i) => { if (Math.hypot(s.x - O.x, s.z - O.z) < Math.hypot(ring[best].x - O.x, ring[best].z - O.z)) best = i; });
  return { value: (best + 0.5) / ring.length, spot: ring[best] };
}
/** Léa lance un Chiche depuis O, Tom la rejoint à 50 m, Léa donne le départ ; l'horloge passe le compte à rebours. */
async function race(app, d, { stake = 500, tokens = {} } = {}) {
  // comptes déjà enregistrés : leur profil se lit dans le store dès le hello (un invité tout neuf n'y est écrit qu'à sa première opération)
  const lea = tokens.lea ? await join(app, { name: 'Léa', token: tokens.lea }) : await joinKnown(app, { name: 'Léa' });
  const tom = tokens.tom ? await join(app, { name: 'Tom', token: tokens.tom }) : await joinKnown(app, { name: 'Tom' });
  lea.token ||= tokens.lea; tom.token ||= tokens.tom;
  await place(app, lea, O.x, O.z, { car: 'citadine' });
  await place(app, tom, O.x + 50, O.z, { car: 'citadine' });
  const fin = nearestFinish();
  d.q = [fin.value];
  const open = await lea.ask('dare', { stake }, 'dare');
  await tom.ask('dare_join', { id: open.id }, 'dare', (m) => m.players.length === 2);
  const run = await lea.ask('dare_go', {}, 'dare', (m) => m.phase === 'run');
  app.advance(5); app.game.tickDares(); // départ donné : les deux sont à moins de 120 m du point de départ
  await lea.sync(); await tom.sync();
  return { lea, tom, open, run, to: run.to };
}

test('Chiche : S.DARE (avec origin) reçu à 2 km ; DARE_JOIN à 300 m refusé, à 50 m accepté ; DARE_GO d’un non-lanceur ignoré', async () => {
  const d = dice(), app = await boot({ at: T0, rand: d.rand });
  try {
    const lea = await join(app, { name: 'Léa' }), tom = await join(app, { name: 'Tom' }), zoe = await join(app, { name: 'Zoé' });
    const mad = LANDMARKS_BY_CITY.paris.find((l) => l.id === 'madeleine');
    await place(app, lea, mad.x + 80, mad.z, { car: 'citadine' });
    await place(app, tom, mad.x + 80 + 2000, mad.z);
    const dare = await lea.ask('dare', { stake: 500 }, 'dare');
    const far = await tom.next('dare');
    assert.deepEqual(far, dare, 'toute la salle reçoit le même état');
    assert.deepEqual([dare.by, dare.stake, dare.phase, dare.players], [{ id: lea.welcome.id, name: 'Léa' }, 500, 'open', [{ id: lea.welcome.id, name: 'Léa' }]]);
    assert.deepEqual(dare.origin, { x: Math.round(lea.pos.x * 10) / 10, z: Math.round(lea.pos.z * 10) / 10, label: 'La Madeleine' });
    assert.deepEqual([dare.startsIn, dare.endsIn, dare.to.r], [94000, 334000, 35]);
    const len = Math.hypot(dare.to.x - dare.origin.x, dare.to.z - dare.origin.z);
    assert.ok(len >= 900 && len <= 2000 && typeof dare.to.label === 'string', `arrivée à ${Math.round(len)} m`);
    // un arrivant en cours de route reçoit l'état dans welcome.dare
    const late = await join(app, { name: 'Retard' });
    assert.deepEqual([late.welcome.dare.id, late.welcome.dare.phase], [dare.id, 'open']);

    await place(app, tom, dare.origin.x + 300, dare.origin.z);
    let e = await tom.ask('dare_join', { id: dare.id }, 'error');
    assert.deepEqual([e.op, e.code], ['dare_join', 'too_far']);
    assert.equal((await tom.ask('dare_join', { id: 'd-inconnu' }, 'error')).code, 'no_dare');
    assert.equal((await tom.ask('dare', { stake: 0 }, 'error')).code, 'busy', 'un seul Chiche par salle');
    await place(app, tom, dare.origin.x + 50, dare.origin.z);
    lea.msgs = [];
    const joined = await tom.ask('dare_join', { id: dare.id }, 'dare');
    assert.deepEqual(joined.players.map((p) => p.name), ['Léa', 'Tom']);
    assert.equal((await lea.next('dare')).players.length, 2);
    // inscrit à un Chiche : pas de client de taxi tant qu'on ne s'est pas retiré
    assert.equal((await tom.ask('job_start', { kind: 'taxi' }, 'job_result')).code, 'busy');

    // ni un spectateur ni un participant ne peuvent donner le départ à la place du lanceur
    zoe.send('dare_go', {}); tom.send('dare_go', {});
    await zoe.sync(); await tom.sync(); await lea.sync();
    assert.equal(count(lea, 'dare', (m) => m.phase === 'run'), 0);
    const run = await lea.ask('dare_go', {}, 'dare', (m) => m.phase === 'run');
    assert.deepEqual([run.startsIn, run.endsIn], [4000, 244000]);
    assert.equal((await zoe.ask('dare_join', { id: dare.id }, 'error')).code, 'closed');
    for (const c of [lea, tom, zoe, late]) await c.close();
  } finally { await app.close(); }
});

test('Chiche : le premier arrivé gagne, règlement à somme nulle, profils, annonce, gazette et klaxon débloqué', async () => {
  const d = dice(), app = await boot({ at: T0, rand: d.rand });
  try {
    const { lea, tom, run, to } = await race(app, d, { stake: 500 });
    assert.deepEqual(to, { x: Math.round(nearestFinish().spot.x * 10) / 10, z: Math.round(nearestFinish().spot.z * 10) / 10, label: nearestFinish().spot.label, r: 35 });
    lea.msgs = []; tom.msgs = [];
    const t0 = app.clock.t - 1000; // le départ a été donné 4 s après la clôture, l'horloge en a passé 5
    await drive(app, tom, to.x + 10, to.z);
    const end = await lea.next('dare_end');
    assert.deepEqual([end.id, end.winner, end.pot, end.reason], [run.id, { id: tom.welcome.id, name: 'Tom' }, 500, undefined]);
    assert.equal(end.sec, (app.clock.t - t0) / 1000);
    const pl = await lea.next('profile'), pt = await tom.next('profile');
    assert.deepEqual([pl.delta, pl.reason, pl.me.money], [-500, 'chiche', STARTING_MONEY - 500]);
    assert.deepEqual([pt.delta, pt.reason, pt.me.money, pt.me.stats.daresWon, pt.me.stats.earned], [500, 'chiche', STARTING_MONEY + 500, 1, 0]);
    assert.equal(pl.me.money + pt.me.money, 2 * STARTING_MONEY, 'somme des soldes inchangée');
    assert.match((await lea.next('chat', (m) => m.system)).text, /^Tom gagne le Chiche ! \+Ƶ\u00a0500$/);
    assert.deepEqual((({ k, id, d: pot }) => [k, id, pot])((await lea.next('feed')).e), ['dare', tom.welcome.id, 500]);
    assert.equal((await tom.ask('set_look', { horn: 'cucaracha' }, 'profile')).me.look.h, 'cucaracha', 'un Chiche gagné débloque La Cucaracha');
    assert.equal((await lea.ask('set_look', { horn: 'cucaracha' }, 'error')).code, 'locked');
    // le défi est terminé : plus rien à rejoindre
    assert.equal((await lea.ask('dare_join', { id: run.id }, 'error')).code, 'no_dare');
    await lea.close(); await tom.close();
  } finally { await app.close(); }
});

test('Chiche : gagné à pot nul (mise 0) => ligne du chat et victoire comptée, mais RIEN dans la gazette (ni diffusée, ni enregistrée, ni à l’accueil)', async () => {
  const d = dice(), app = await boot({ at: T0, rand: d.rand });
  try {
    const zoe = await joinKnown(app, { name: 'Zoé' }), max = await joinKnown(app, { name: 'Max' });
    await quit(app, max); // Max s'absente : sa gazette de retour ne doit pas se remplir de Chiches sans enjeu
    app.advance(1);
    let lea, tom, tokens = {};
    for (let i = 0; i < 3; i++) {
      let run, to;
      ({ lea, tom, run, to } = await race(app, d, { stake: 0, tokens }));
      lea.msgs = [];
      await drive(app, tom, to.x + 10, to.z);
      const end = await lea.next('dare_end');
      assert.deepEqual([end.id, end.winner.name, end.pot, end.reason], [run.id, 'Tom', 0, undefined]);
      assert.match((await lea.next('chat', (m) => m.system)).text, /^Tom gagne le Chiche !$/);
      tokens = { lea: lea.token, tom: tom.token };
      await quit(app, lea); await quit(app, tom);
      app.advance(60); // le seau des lancers de Léa se remplit
    }
    await zoe.sync();
    assert.equal(count(zoe, 'dare_end', (m) => m.winner?.name === 'Tom'), 3, 'les trois fins sont bien annoncées à la salle');
    assert.equal(sys(zoe, /^Tom gagne le Chiche !$/).length, 3, 'la ligne système du chat reste');
    assert.equal(count(zoe, 'feed'), 0, 'aucun fait diffusé');
    assert.deepEqual((await app.store.getRoom('test')).feed, [], 'aucun fait enregistré');
    assert.equal((await store0(app, tom)).stats.daresWon, 3, 'les victoires comptent toujours (klaxon, défis)');
    const back = await join(app, { name: 'Max', token: max.token });
    assert.deepEqual(back.welcome.feed, [], 'gazette de retour vide');
    // le même Chiche avec une mise : le fait entre dans la gazette
    back.msgs = [];
    const paid = await race(app, d, { stake: 500, tokens });
    await drive(app, paid.tom, paid.to.x + 10, paid.to.z);
    assert.deepEqual((({ k, n, d: pot, x }) => [k, n, pot, x])((await back.next('feed')).e), ['dare', 'Tom', 500, 'Tom gagne un Chiche (+Ƶ 500)']);
    assert.deepEqual((await app.store.getRoom('test')).feed.map((e) => [e.k, e.d]), [['dare', 500]]);
    for (const c of [zoe, back, paid.lea, paid.tom]) await c.close();
  } finally { await app.close(); }
});

test('Chiche : clôture en solo sans débit (à 90 s), DARE_GO seul refusé, retrait du lanceur, seau de 2 lancers', async () => {
  const d = dice(), app = await boot({ at: T0, rand: d.rand });
  try {
    const lea = await join(app, { name: 'Léa' }), tom = await join(app, { name: 'Tom' });
    await place(app, lea, O.x, O.z);
    const e0 = await lea.ask('dare', { stake: 750 }, 'error');
    assert.deepEqual([e0.op, e0.code], ['dare', 'bad_stake']);
    const solo = await lea.ask('dare', { stake: 2000 }, 'dare');
    assert.equal(solo.stake, 2000);
    assert.equal((await lea.ask('dare_go', {}, 'error')).code, 'solo');
    app.advance(89); app.game.tickDares(); await tom.sync();
    assert.equal(count(tom, 'dare_end'), 0);
    app.advance(2); app.game.tickDares();
    assert.deepEqual(await tom.next('dare_end'), { t: 'dare_end', id: solo.id, winner: null, sec: 0, pot: 0, reason: 'solo' });
    await lea.sync();
    assert.equal(count(lea, 'profile'), 0, 'aucun débit');
    // le seau s'est rempli pendant les 90 s : deux lancers de suite, le troisième est refusé
    for (let i = 0; i < 2; i++) {
      const dd = await lea.ask('dare', { stake: 0 }, 'dare');
      tom.msgs = [];
      lea.send('dare_leave', {});
      assert.deepEqual((({ id, winner, pot, reason }) => [id, winner, pot, reason])(await tom.next('dare_end')), [dd.id, null, 0, 'left']);
    }
    assert.equal((await lea.ask('dare', { stake: 0 }, 'error')).code, 'rate');
    // mise au-dessus du solde, lancer en mission : refusés
    const poor = await join(app, { name: 'Fauché' });
    await place(app, poor, O.x, O.z);
    assert.equal((await poor.ask('dare', { stake: 500 }, 'dare')).stake, 500);
    poor.send('dare_leave', {}); await poor.sync();
    await poor.ask('transfer', { to: lea.welcome.id, amount: STARTING_MONEY - 100 }, 'profile');
    assert.equal((await poor.ask('dare', { stake: 500 }, 'error')).code, 'no_funds');
    assert.equal((await store0(app, lea)).money, STARTING_MONEY + STARTING_MONEY - 100);
    for (const c of [lea, tom, poor]) await c.close();
  } finally { await app.close(); }
});
test('Chiche : téléportation pendant la course => forfait, l’autre gagne ; mission_start pendant la course => forfait', async () => {
  const d = dice(), app = await boot({ at: T0, rand: d.rand });
  try {
    let { lea, tom, run } = await race(app, d, { stake: 500 });
    tom.msgs = [];
    await place(app, lea, O.x + 1500, O.z + 1500, { car: 'citadine' }); // réapparition, garage… : forfait
    let end = await tom.next('dare_end');
    assert.deepEqual([end.id, end.winner.name, end.pot, end.reason], [run.id, 'Tom', 500, 'left']);
    assert.deepEqual([(await store0(app, lea)).money, (await store0(app, tom)).money], [STARTING_MONEY - 500, STARTING_MONEY + 500]);
    const tokens = { lea: lea.token, tom: tom.token };
    await quit(app, lea); await quit(app, tom);

    ({ lea, tom, run } = await race(app, d, { stake: 500, tokens }));
    lea.msgs = [];
    tom.send('mission_start', { id: M1.id });
    end = await lea.next('dare_end');
    assert.deepEqual([end.winner.name, end.pot, end.reason], ['Léa', 500, 'left']);
    assert.deepEqual([(await store0(app, lea)).money, (await store0(app, tom)).money], [STARTING_MONEY, STARTING_MONEY], 'un partout : somme toujours nulle');
    assert.equal(tom.msgs.filter((m) => m.t === 'mission_result').length, 0, 'la mission, elle, est bien démarrée');
    tom.send('mission_abort', {}); await tom.sync();
    await quit(app, lea); await quit(app, tom);

    // prendre un client de taxi pendant la course vaut forfait aussi (et la course de taxi commence)
    app.advance(60); // le seau des lancers de Léa se remplit
    ({ lea, tom, run } = await race(app, d, { stake: 0, tokens }));
    tom.msgs = [];
    const job = await lea.ask('job_start', { kind: 'taxi' }, 'job');
    assert.equal(job.kind, 'taxi');
    end = await tom.next('dare_end');
    assert.deepEqual([end.id, end.winner.name, end.pot, end.reason], [run.id, 'Tom', 0, 'left']);
    assert.match((await tom.next('chat', (m) => m.system)).text, /^Tom gagne le Chiche !$/);
    await tom.sync();
    assert.equal(count(tom, 'feed'), 0, 'forfait à mise nulle : rien dans la gazette');
    await lea.close(); await tom.close();
  } finally { await app.close(); }
});

test('Chiche : déconnexion du meneur pendant la course => l’autre gagne, le parti est débité quand même', async () => {
  const d = dice(), app = await boot({ at: T0, rand: d.rand });
  try {
    const { lea, tom, to } = await race(app, d, { stake: 2000 });
    await drive(app, lea, O.x + (to.x - O.x) / 2, O.z + (to.z - O.z) / 2); // Léa mène, puis sa connexion tombe
    tom.msgs = [];
    await quit(app, lea);
    const end = await tom.next('dare_end');
    assert.deepEqual([end.winner, end.pot, end.reason], [{ id: tom.welcome.id, name: 'Tom' }, 2000, 'left']);
    assert.deepEqual([(await tom.next('profile')).me.money, (await store0(app, lea)).money], [STARTING_MONEY + 2000, STARTING_MONEY - 2000]);
    app.game.tickLeaderboards();
    const lb = (await tom.next('lb')).list;
    assert.deepEqual(lb.map((e) => [e.name, e.money, e.online]), [['Tom', STARTING_MONEY + 2000, true], ['Léa', STARTING_MONEY - 2000, false]]);
    await tom.close();
  } finally { await app.close(); }
});

test('Chiche : participant à plus de 120 m au départ disqualifié ; durée maximale => fin sans débit ; un redémarrage annule sans débit', async () => {
  const d = dice();
  let app = await boot({ at: T0, rand: d.rand });
  try {
    // Tom s'éloigne pendant le compte à rebours : disqualifié au départ, Léa gagne
    const lea = await join(app, { name: 'Léa' }), tom = await join(app, { name: 'Tom' });
    await place(app, lea, O.x, O.z); await place(app, tom, O.x + 50, O.z);
    const open = await lea.ask('dare', { stake: 500 }, 'dare');
    await tom.ask('dare_join', { id: open.id }, 'dare', (m) => m.players.length === 2);
    await lea.ask('dare_go', {}, 'dare', (m) => m.phase === 'run');
    sendState(tom, O.x + 200, O.z); await tom.sync(); // 150 m de plus, sans téléportation
    assert.equal(count(lea, 'dare_end'), 0);
    app.advance(5); app.game.tickDares();
    const end = await lea.next('dare_end');
    assert.deepEqual([end.winner.name, end.pot, end.reason, end.sec], ['Léa', 500, 'left', 1]);
    await lea.close(); await tom.close();
  } finally { await app.close(); }

  app = await boot({ at: T0, rand: d.rand });
  try {
    const { lea, tom, run } = await race(app, d, { stake: 500 });
    lea.msgs = [];
    app.advance(238); app.game.tickDares(); await lea.sync();
    assert.equal(count(lea, 'dare_end'), 0, 'encore dans les 240 s');
    app.advance(2); app.game.tickDares();
    assert.deepEqual(await lea.next('dare_end'), { t: 'dare_end', id: run.id, winner: null, sec: 0, pot: 0, reason: 'timeout' });
    assert.deepEqual([(await store0(app, lea)).money, (await store0(app, tom)).money], [STARTING_MONEY, STARTING_MONEY]);
    await lea.close(); await tom.close();
  } finally { await app.close(); }

  const store = new MemoryStore();
  app = await boot({ store, at: T0, rand: d.rand });
  const { lea, tom, run } = await race(app, d, { stake: 2000 });
  await app.close(); // redémarrage du serveur en pleine course
  // … annoncé aux deux coureurs AVANT la fermeture (1012) : une annulation, pas un forfait par coupure
  for (const c of [lea, tom]) {
    assert.deepEqual(await c.next('dare_end'), { t: 'dare_end', id: run.id, winner: null, sec: 0, pot: 0, reason: 'restart' });
    assert.equal(await c.waitClose(), 1012);
  }
  assert.deepEqual([(await store.getPlayer(lea.welcome.id)).money, (await store.getPlayer(tom.welcome.id)).money], [STARTING_MONEY, STARTING_MONEY]);
  assert.deepEqual([(await store.getPlayer(lea.welcome.id)).stats.daresWon, (await store.getPlayer(tom.welcome.id)).stats.daresWon], [0, 0]);
});

// ---------------------------------------------------------------- débit et robustesse

test('émotes : 10 en rafale => 4 relayées, jamais à l’émetteur ; le klaxon vient du profil, pas du client', async () => {
  const store = new MemoryStore();
  const s = seedPlayer(store, { name: 'Coq', done: 3, edit: (p) => { p.look = { h: 'pouet' }; } });
  const app = await boot({ store, at: T0 });
  try {
    const a = await join(app, { name: 'Coq', token: s.token }), b = await join(app, { name: 'Bob' });
    for (let i = 0; i < 10; i++) a.send('emote', { k: 2 });
    await a.sync(); await b.sync();
    assert.deepEqual(b.msgs.filter((m) => m.t === 'emote'), Array(4).fill({ t: 'emote', id: s.id, k: 2 }));
    assert.equal(count(a, 'emote'), 0);
    app.advance(10); b.msgs = [];
    a.send('emote', { k: 0, h: 'legende' }); a.send('emote', { k: 9 }); a.send('emote', { k: '1' }); a.send('emote', {});
    await a.sync(); await b.sync();
    assert.deepEqual(b.msgs.filter((m) => m.t === 'emote'), [{ t: 'emote', id: s.id, k: 0, h: 'pouet' }]);
    await a.close(); await b.close();
  } finally { await app.close(); }
});

test('style : 100 000 points après 5 s et 100 m => 6 000 retenus (rogné, pas rejeté) ; à 0 m ou à pied => ignoré ; aucun argent', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await joinKnown(app, { name: 'Cascadeur' }), still = await joinKnown(app, { name: 'Immobile' }), walker = await joinKnown(app, { name: 'Piéton' });
    const report = { pts: 100000, combo: 100000, drift: 50, air: 9, near: 99, props: 999 };
    sendState(a, 0, 600, { car: 'citadine' }); sendState(still, 50, 600, { car: 'citadine' }); sendState(walker, 90, 600);
    await a.sync(); await still.sync(); await walker.sync();
    app.advance(5);
    sendState(a, 100, 600, { car: 'citadine' }); sendState(walker, 190, 600);
    const p = await a.ask('style', report, 'profile');
    assert.equal(p.delta, undefined);
    assert.deepEqual([p.me.money, p.me.stats.bestCombo, p.me.stats.bestDrift, p.me.stats.bestAir, p.me.stats.nearMisses, p.me.stats.propsBroken], [STARTING_MONEY, 6000, 5, 6, 10, 40]);
    assert.equal((await a.next('journal')).j.list[2].have, 1500, 'défi de style du jour : avancement borné à l’objectif');
    assert.equal((await store0(app, a)).journal.day.c.style, 6000);
    assert.match((await still.next('chat', (m) => m.system)).text, /^Cascadeur encaisse un combo de 6 000 points de style !$/);
    still.send('style', report); walker.send('style', report);
    await still.sync(); await walker.sync();
    assert.deepEqual([count(still, 'profile'), count(walker, 'profile')], [0, 0]);
    assert.equal((await app.store.getPlayer(still.welcome.id)).stats.bestCombo, 0);
    // la fenêtre repart du dernier rapport ACCEPTÉ : un second rapport immédiat, sans chemin, est ignoré
    a.send('style', report); await a.sync();
    assert.equal(count(a, 'profile'), 0);
    for (const c of [a, still, walker]) await c.close();
  } finally { await app.close(); }
});

test('style : combo du jour de la salle mis à jour, une seule entrée de gazette sur deux rapports rapprochés, remis à zéro le lendemain', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await join(app, { name: 'Tom' }), b = await join(app, { name: 'Inès' });
    sendState(a, 0, 600, { car: 'citadine' }); sendState(b, 0, 700, { car: 'citadine' });
    await a.sync(); await b.sync();
    await drive(app, a, 400, 600); await drive(app, b, 400, 700);
    await a.ask('style', { pts: 3000, combo: 3000, drift: 2, air: 0, near: 1, props: 0 }, 'profile');
    const e1 = (await b.next('feed')).e;
    assert.deepEqual([e1.k, e1.id, e1.n, e1.d], ['style', a.welcome.id, 'Tom', 3000]);
    assert.match(e1.x, /^Combo du jour : Tom, 3 000 points$/);
    // un combo plus petit ne prend pas le combo du jour
    await drive(app, a, 800, 600);
    await a.ask('style', { pts: 2500, combo: 2500 }, 'profile');
    await b.ask('style', { pts: 4200, combo: 4200 }, 'profile');
    const e2 = (await a.next('feed', (m) => m.e.d === 4200)).e;
    assert.deepEqual([e2.k, e2.n, e2.t], ['style', 'Inès', e1.t], 'même entrée, mise à jour sur place');
    await quit(app, b);
    const room = await app.store.getRoom('test');
    assert.deepEqual(room.feed.filter((e) => e.k === 'style').map((e) => [e.n, e.d]), [['Inès', 4200]]);
    assert.deepEqual(room.styleDay, { k: '2026-01-15', id: b.welcome.id, name: 'Inès', pts: 4200 });
    const c = await join(app, { name: 'Curieux' });
    assert.deepEqual(c.welcome.styleDay, { id: b.welcome.id, name: 'Inès', pts: 4200 });
    await c.close();
    // dix minutes plus tard : une nouvelle entrée ; le lendemain : plus de combo du jour
    app.advance(601);
    await drive(app, a, 400, 600);
    await a.ask('style', { pts: 5000, combo: 4500 }, 'profile');
    assert.equal((await app.store.getRoom('test')).feed.filter((e) => e.k === 'style').length, 2);
    app.advance(24 * 3600);
    const next = await join(app, { name: 'Demain' });
    assert.equal(next.welcome.styleDay, null);
    await a.close(); await next.close();
  } finally { await app.close(); }
});

test('képis : bust sans wanted ignoré ; deux wanted en 30 s => une seule ligne ; escape de 3 s refusé ; record de cavale = le plus court', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await joinKnown(app, { name: 'Léa' }), b = await join(app, { name: 'Tom' });
    const mad = LANDMARKS_BY_CITY.paris.find((l) => l.id === 'madeleine');
    await place(app, a, mad.x + 70, mad.z, { car: 'citadine' });
    a.send('heat', { ev: 'bust', k: 2 }); a.send('heat', { ev: 'escape', k: 2, sec: 30, how: 'dist' });
    await a.sync(); await b.sync();
    assert.deepEqual([count(a, 'profile'), b.msgs.filter((m) => m.t === 'chat').length], [0, 0]);

    app.advance(60); // le seau des képis se remplit (3 messages, puis un toutes les 20 s)
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    app.advance(30);
    a.send('heat', { ev: 'wanted', k: 3 }); await a.sync(); await b.sync();
    assert.deepEqual(sys(b, /Avis de recherche/).map((m) => m.text), ['Avis de recherche : Léa, 2 képis, près de la Madeleine.']);
    a.send('heat', { ev: 'escape', k: 3, sec: 3, how: 'dist' }); await a.sync(); // trop courte : refusée
    assert.equal(count(a, 'profile'), 0);
    assert.equal((await store0(app, a)).stats.escapes, 0);

    // vraie cavale de 40 s, 300 m de fuite mesurés par le serveur, semée à distance : record de la salle
    app.advance(60);
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    await drive(app, a, mad.x + 370, mad.z); // 4 s d'horloge
    app.advance(36); b.msgs = [];
    let p = await a.ask('heat', { ev: 'escape', k: 2, sec: 40, how: 'dist' }, 'profile');
    assert.deepEqual([p.delta, p.me.money, p.me.stats.escapes, p.me.stats.bestEscapeSec], [undefined, STARTING_MONEY, 1, 40]);
    assert.match((await b.next('chat', (m) => m.system)).text, /^Léa sème les képis en 0:40,0 : record de cavale de la salle !$/);
    assert.deepEqual((({ k, id, d }) => [k, id, d])((await b.next('feed')).e), ['cavale', a.welcome.id, 40]);
    await b.sync();
    assert.equal(sys(b, /Avis de recherche/).length, 0, 'au plus une annonce par joueur toutes les 3 min');
    // durée déclarée au-delà de l'horloge du serveur : refusée ; fuite « au temps » : comptée, sans record
    app.advance(60);
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    app.advance(10); a.msgs = [];
    a.send('heat', { ev: 'escape', k: 2, sec: 30, how: 'dist' }); await a.sync();
    assert.equal(count(a, 'profile'), 0);
    app.advance(60);
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    app.advance(20); b.msgs = [];
    p = await a.ask('heat', { ev: 'escape', k: 2, sec: 20, how: 'time' }, 'profile');
    assert.deepEqual([p.me.stats.escapes, p.me.stats.bestEscapeSec], [2, 20]);
    await b.sync();
    assert.equal(count(b, 'feed'), 0);
    assert.equal((await a.ask('set_look', { horn: 'camion' }, 'profile')).me.look.h, 'camion', 'une cavale réussie débloque la corne de camion');
    await quit(app, a);
    assert.deepEqual((({ id, name, sec }) => [id, name, sec])((await app.store.getRoom('test')).cavale), [a.welcome.id, 'Léa', 40]);
    const c = await join(app, { name: 'Curieux' });
    assert.deepEqual(c.welcome.cavale, { id: a.welcome.id, name: 'Léa', sec: 40 });
    await b.close(); await c.close();
  } finally { await app.close(); }
});

test('képis : amende plafonnée (3 % du solde, 300 × képis × niveau), jamais sous 0 Ƶ, au plus une par minute', async () => {
  const store = new MemoryStore();
  const rich = seedPlayer(store, { name: 'Riche', money: 1_000_000 }), broke = seedPlayer(store, { name: 'Fauché', money: 0 }), small = seedPlayer(store, { name: 'Petit', money: 1000 });
  const app = await boot({ store, at: T0 });
  try {
    const a = await join(app, { name: 'Riche', token: rich.token }), z = await join(app, { name: 'Fauché', token: broke.token }), s = await join(app, { name: 'Petit', token: small.token });
    a.send('heat', { ev: 'wanted', k: 3 }); await a.sync();
    let p = await a.ask('heat', { ev: 'bust', k: 3 }, 'profile');
    assert.deepEqual([p.delta, p.reason, p.me.money, p.me.stats.fines], [-900, 'amende', 1_000_000 - 900, 1]);
    a.send('heat', { ev: 'bust', k: 3 }); await a.sync();
    assert.equal(count(a, 'profile'), 0, 'un contrôle par poursuite');
    // nouvelle poursuite dans la minute : pas de seconde amende
    a.send('heat', { ev: 'wanted', k: 2 }); a.send('heat', { ev: 'bust', k: 2 }); await a.sync();
    assert.equal(count(a, 'profile'), 0);
    assert.equal((await store0(app, a)).money, 1_000_000 - 900);

    s.send('heat', { ev: 'wanted', k: 2 }); await s.sync();
    p = await s.ask('heat', { ev: 'bust', k: 2 }, 'profile');
    assert.deepEqual([p.delta, p.me.money], [-30, 970]);
    z.send('heat', { ev: 'wanted', k: 3 }); await z.sync();
    p = await z.ask('heat', { ev: 'bust', k: 3 }, 'profile');
    assert.deepEqual([p.delta, p.me.money, p.me.stats.fines], [undefined, 0, 1]);
    // un avis de recherche de plus de 10 min ne vaut plus contrôle
    app.advance(120);
    s.send('heat', { ev: 'wanted', k: 2 }); await s.sync();
    app.advance(601);
    s.send('heat', { ev: 'bust', k: 2 }); await s.sync();
    assert.equal(count(s, 'profile'), 0);
    for (const c of [a, z, s]) await c.close();
  } finally { await app.close(); }
});

test('chute : C.BUMP de la victime => ligne tendre et statistiques ; trop loin, à l’arrêt ou dans les 20 s : ignoré', async () => {
  const app = await boot({ at: T0 });
  try {
    const tom = await join(app, { name: 'Tom' }), lea = await join(app, { name: 'Léa' });
    await place(app, lea, 0, 800);
    await place(app, tom, 40, 800, { car: 'citadine', speed: 12 });
    lea.send('bump', { by: tom.welcome.id }); // à 40 m : ignoré
    await place(app, tom, 8, 800, { car: 'citadine', speed: 0.5 });
    lea.send('bump', { by: tom.welcome.id }); // presque à l'arrêt : ignoré
    await lea.sync(); await tom.sync();
    assert.equal(sys(tom, /renversé/).length, 0);
    app.advance(60);
    await place(app, tom, 6, 800, { car: 'citadine', speed: 12 });
    lea.send('bump', { by: tom.welcome.id }); lea.send('bump', { by: lea.welcome.id }); lea.send('bump', { by: 'inconnu' }); lea.send('bump', {});
    await lea.sync(); await tom.sync();
    assert.deepEqual(sys(tom, /renversé/).map((m) => m.text), ['Tom a renversé Léa — Léa se relève en râlant.']);
    app.advance(60); // le seau de Léa se remplit (2 messages, puis un toutes les 20 s)
    lea.send('bump', { by: tom.welcome.id }); await lea.sync();
    app.advance(10);
    lea.send('bump', { by: tom.welcome.id }); await lea.sync(); await tom.sync(); // 10 s après : même paire, ignoré
    assert.equal(sys(tom, /renversé/).length, 2);
    await quit(app, tom); await quit(app, lea);
    assert.deepEqual([(await store0(app, tom)).stats.bumpsGiven, (await store0(app, lea)).stats.bumpsTaken, (await store0(app, lea)).stats.bumpsGiven], [2, 2, 0]);
  } finally { await app.close(); }
});

test('robustesse : aucun message nouveau, même mal formé, ne compte comme invalide (la connexion reste ouverte)', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await joinKnown(app, { name: 'Brouillon' });
    const types = ['paint_car', 'set_look', 'claim', 'job_start', 'job_done', 'job_abort', 'dare', 'dare_join', 'dare_go', 'dare_leave', 'emote', 'bump', 'heat', 'style'];
    const junk = [{}, { id: { a: 1 }, k: 'x', by: 3, ev: [], kind: null, stake: 'tout', typeId: 7, color: {}, horn: [1], pts: 'beaucoup', hits: -4, sec: 'longtemps' }, { id: null, typeId: '__proto__', color: 'rouge', horn: 'constructor', kind: 'constructor', stake: -500, k: 2.5, pts: -1, combo: Infinity }];
    for (const body of junk) {
      for (const t of types) a.send(t, body);
      await a.sync();
      app.advance(30); // les seaux se remplissent : chaque passe atteint bien les handlers
    }
    assert.equal(a.closed, null, `${types.length * junk.length} messages mal formés : aucun n’est un « strike »`);
    assert.equal(count(a, 'error', (m) => m.code === 'server'), 0, 'aucune exception dans un handler');
    assert.deepEqual([...new Set(a.msgs.filter((m) => m.t === 'error').map((m) => m.op))].sort(), ['claim', 'dare', 'dare_join', 'paint_car', 'set_look']);
    assert.equal((await store0(app, a)).money, STARTING_MONEY);
    // témoin : les types réellement inconnus, eux, ferment la connexion au-delà de 20
    for (let i = 0; i < 21; i++) a.send('nimporte_quoi', {});
    assert.equal(await a.waitClose(), 4003);
  } finally { await app.close(); }
});

// ---------------------------------------------------------------- classement et gazette

test('classement : le joueur à 5 000 000 Ƶ qui achète penthouse_vendome reste premier (fortune totale)', async () => {
  const store = new MemoryStore();
  const penthouse = ALL_PROPERTY_BY_ID.penthouse_vendome;
  const rich = seedPlayer(store, { name: 'Crésus', money: penthouse.price });
  const app = await boot({ store, at: T0 });
  try {
    const a = await join(app, { name: 'Crésus', token: rich.token }), b = await join(app, { name: 'Débutant' }), c = await join(app, { name: 'Novice' });
    await a.ask('buy_prop', { id: penthouse.id }, 'profile');
    app.game.tickLeaderboards();
    const lb = (await b.next('lb')).list;
    assert.deepEqual(lb[0], { id: rich.id, name: 'Crésus', money: 0, online: true, worth: penthouse.price, lvl: 1, st: 0, rec: 0 });
    assert.deepEqual(lb.slice(1).map((e) => [e.money, e.worth]), [[STARTING_MONEY, STARTING_MONEY], [STARTING_MONEY, STARTING_MONEY]]);
    // une voiture compte aussi dans la fortune
    const d = await join(app, { name: 'Pilote', token: seedPlayer(store, { name: 'Pilote', money: 12000 }).token });
    await d.ask('buy_car', { typeId: 'taxi' }, 'profile');
    app.game.tickLeaderboards();
    const row = (await b.next('lb', (m) => m.list.some((e) => e.name === 'Pilote' && e.money === 0))).list.find((e) => e.name === 'Pilote');
    assert.deepEqual([row.money, row.worth], [0, 12000]);
    for (const x of [a, b, c, d]) await x.close();
  } finally { await app.close(); }
});

test('classement : un joueur connecté classé au-delà du top 20 apparaît quand même', async () => {
  const store = new MemoryStore();
  const members = {};
  for (let i = 1; i <= 24; i++) members['pfade' + i.toString(16).padStart(12, '0')] = { name: 'Ancien' + i, money: 100000 + i };
  store.putRoom({ code: 'foule', owners: {}, members });
  const app = await boot({ store, at: T0 });
  try {
    const a = await join(app, { name: 'Petit', room: 'foule' });
    const lb = a.welcome.lb;
    assert.equal(lb.length, 21);
    assert.deepEqual(lb.slice(0, 20).map((e) => e.name), Array.from({ length: 20 }, (_, i) => 'Ancien' + (24 - i)));
    assert.deepEqual([lb[20].name, lb[20].online, lb[20].money, lb[20].worth], ['Petit', true, STARTING_MONEY, STARTING_MONEY]);
    assert.ok(lb.slice(0, 20).every((e) => !e.online && e.worth === e.money && e.lvl === 1 && e.st === 0 && e.rec === 0));
    const b = await join(app, { name: 'Autre', room: 'foule' });
    app.game.tickLeaderboards();
    const live = (await a.next('lb')).list;
    assert.deepEqual(live.slice(20).map((e) => e.name).sort(), ['Autre', 'Petit']);
    await a.close(); await b.close();
  } finally { await app.close(); }
});

test('classement : un membre qui revient avec le même solde déclenche un S.LEADERBOARD (il repasse en ligne)', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await join(app, { name: 'Alice' });
    let b = await join(app, { name: 'Bob' });
    const token = b.welcome.token;
    app.game.tickLeaderboards(); await a.next('lb');
    await quit(app, b);
    app.game.tickLeaderboards();
    assert.deepEqual((await a.next('lb')).list.map((e) => [e.name, e.online]).sort(), [['Alice', true], ['Bob', false]]);
    app.game.tickLeaderboards(); await a.sync();
    assert.equal(count(a, 'lb'), 0, 'rien n’a changé : rien n’est rediffusé');
    b = await join(app, { name: 'Bob', token });
    app.game.tickLeaderboards();
    const lb = (await a.next('lb')).list;
    assert.deepEqual(lb.map((e) => [e.name, e.money, e.online]).sort(), [['Alice', STARTING_MONEY, true], ['Bob', STARTING_MONEY, true]]);
    await a.close(); await b.close();
  } finally { await app.close(); }
});

test('gazette : welcome.feed = faits des autres depuis la dernière présence, 12 au plus ; S.FEED en direct ; achats et ventes notés', async () => {
  const store = new MemoryStore();
  const rich = seedPlayer(store, { name: 'Alice', money: 2_000_000 });
  const prop = PROPERTIES_BY_CITY.paris[0];
  const app = await boot({ store, at: T0 });
  try {
    let a = await join(app, { name: 'Alice', token: rich.token });
    let b = await join(app, { name: 'Bob' });
    const btoken = b.welcome.token;
    await a.ask('buy_car', { typeId: 'tesla_model3', color: '#c1121f' }, 'profile');
    const live = (await b.next('feed')).e;
    assert.deepEqual([live.k, live.id, live.n, live.d, live.m, live.x], ['car', rich.id, 'Alice', 'Fulgur Étincelle', 'tesla_model3', "Alice s'offre une Fulgur Étincelle"]);
    assert.equal((await a.next('feed')).e.k, 'car', 'diffusé à toute la salle');
    assert.match((await b.next('chat', (m) => m.system)).text, /^Alice s'offre une Fulgur Étincelle !$/);
    await quit(app, b);
    // pendant l'absence de Bob : 7 achats-reventes = 14 faits
    for (let i = 0; i < 7; i++) {
      app.advance(10);
      await a.ask('buy_prop', { id: prop.id }, 'profile');
      await a.ask('sell_prop', { id: prop.id }, 'profile');
    }
    app.advance(10);
    b = await join(app, { name: 'Bob', token: btoken });
    const feed = b.welcome.feed;
    assert.equal(feed.length, 12, '12 faits au plus');
    assert.deepEqual(feed.map((e) => e.k), Array.from({ length: 12 }, (_, i) => (i % 2 ? 'sell' : 'buy')));
    assert.ok(feed.every((e) => e.id === rich.id && e.d === prop.name && e.m === prop.id && e.t > T0 && typeof e.x === 'string'));
    assert.deepEqual(feed.map((e) => e.t), [...feed.map((e) => e.t)].sort((x, y) => x - y), 'du plus ancien au plus récent');
    // Bob revient encore : il a déjà tout vu ; Alice ne reçoit jamais ses propres faits à l'accueil
    await quit(app, b);
    b = await join(app, { name: 'Bob', token: btoken });
    assert.deepEqual(b.welcome.feed, []);
    await quit(app, a);
    a = await join(app, { name: 'Alice', token: rich.token });
    assert.deepEqual(a.welcome.feed, []);
    // un nouveau venu a de quoi lire
    const c = await join(app, { name: 'Nouveau' });
    assert.equal(c.welcome.feed.length, 12);
    assert.equal((await app.store.getRoom('test')).feed.length, 15);
    for (const x of [a, b, c]) await x.close();
  } finally { await app.close(); }
});

// ---------------------------------------------------------------- apparence

test('apparence : teinte choisie à l’achat conservée, PAINT_CAR (500 Ƶ catalogue, nuancier, exclusive verrouillée), SET_LOOK et S.LOOK', async () => {
  const store = new MemoryStore();
  const s = seedPlayer(store, { name: 'Coquette', money: 60000, done: 3 });
  const app = await boot({ store, at: T0 });
  try {
    let a = await join(app, { name: 'Coquette', token: s.token });
    const b = await join(app, { name: 'Bob' });
    let p = await a.ask('buy_car', { typeId: 'tesla_model3', color: '#C1121F' }, 'profile');
    assert.deepEqual([p.me.carColors, p.me.money], [{ tesla_model3: '#c1121f' }, 15000]);
    p = await a.ask('paint_car', { typeId: 'tesla_model3', color: '#1d3557' }, 'profile');
    assert.deepEqual([p.delta, p.reason, p.me.carColors.tesla_model3], [-500, 'peinture', '#1d3557']);
    p = await a.ask('paint_car', { typeId: 'citadine', color: '#3ddc97' }, 'profile'); // vert menthe du nuancier
    assert.deepEqual([p.delta, p.me.carColors.citadine, p.me.money], [-1500, '#3ddc97', 13000]);
    const codes = [];
    for (const body of [{ typeId: 'citadine', color: '#3ddc97' }, { typeId: 'citadine', color: '#123456' }, { typeId: 'citadine', color: '#7b2cbf' }, { typeId: 'taxi', color: '#111111' }]) {
      const e = await a.ask('paint_car', body, 'error');
      assert.equal(e.op, 'paint_car');
      codes.push(e.code);
    }
    assert.deepEqual(codes, ['same_color', 'bad_color', 'locked', 'not_owned']);

    // klaxons : « Pouet » au niveau 2 (3 missions), les autres verrouillés ; la salle est prévenue du changement
    b.msgs = [];
    p = await a.ask('set_look', { horn: 'pouet' }, 'profile');
    assert.deepEqual(p.me.look, { h: 'pouet' });
    assert.deepEqual(await b.next('look'), { t: 'look', id: s.id, lvl: 2, st: 0, look: { h: 'pouet' } });
    let e = await a.ask('set_look', { horn: 'cocorico' }, 'error');
    assert.deepEqual([e.op, e.code], ['set_look', 'locked']);
    assert.equal((await a.ask('set_look', { horn: 'trompette' }, 'error')).code, 'unknown_horn');
    b.msgs = [];
    await a.ask('set_look', { horn: 'pouet' }, 'profile'); // inchangé : pas de S.LOOK
    await b.sync();
    assert.equal(count(b, 'look'), 0);
    a.send('emote', { k: 0 });
    assert.deepEqual(await b.next('emote'), { t: 'emote', id: s.id, k: 0, h: 'pouet' });

    // tout est conservé d'une session à l'autre et visible des arrivants
    await quit(app, a);
    a = await join(app, { name: 'Coquette', token: s.token });
    assert.deepEqual([a.welcome.me.carColors, a.welcome.me.look], [{ tesla_model3: '#1d3557', citadine: '#3ddc97' }, { h: 'pouet' }]);
    assert.deepEqual((await b.next('join')).look, { h: 'pouet' });
    const c = await join(app, { name: 'Curieux' });
    assert.deepEqual(c.welcome.players.find((x) => x.id === s.id), { name: 'Coquette', id: s.id, lvl: 2, st: 0, look: { h: 'pouet' } });
    for (const x of [a, b, c]) await x.close();
  } finally { await app.close(); }
});

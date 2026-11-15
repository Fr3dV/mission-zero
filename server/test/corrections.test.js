// Corrections de la relecture du contrat v6 (lot net-serveur) : chaque règle changée a ici son test.
// Les deux premiers tests rejouent les deux duplications d'argent trouvées par le relecteur « serveur-adverse » :
// ils échouent sans le correctif (server/store/firestore.js get(), server/game.js resolveAccount).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { boot, join, seedPlayer, sendState, place, drive, quit, countWrites } from '../testkit.js';
import { MemoryStore } from '../store/memory.js';
import { FirestoreStore } from '../store/firestore.js';
import { feedText, normalizeRoomRecord } from '../game.js';
import * as eco from '../../shared/economy.js';
import * as J from '../../shared/journal.js';
import * as jobs from '../../shared/jobs.js';
import * as CORE from '../../shared/content-core.js';
import { sanitizeCity, geoFor, CITIES } from '../../shared/cities.js';
import { STARTING_MONEY, STARTER_VEHICLE, VEHICLE_BY_ID } from '../../shared/catalog.js';
import { MISSIONS_BY_CITY } from '../../shared/missions.js';
import { ALL_PROPERTY_BY_ID } from '../../shared/properties.js';
import { LANDMARKS_BY_CITY } from '../../shared/landmarks.js';
import { PROTOCOL_VERSION, encode, decode } from '../../shared/protocol.js';

const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 0, 15, 11, 0, 0); // jeudi 15 janvier 2026, midi à Paris
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));
const PARIS = MISSIONS_BY_CITY.paris;
const M1 = PARIS.find((m) => m.level === 1 && m.type !== 'photo' && !m.anyOrder && !m.intro);
const lastStep = (m) => m.steps[m.steps.length - 1];
const O = jobs.SPOTS_BY_CITY.paris[0];
const MAD = LANDMARKS_BY_CITY.paris.find((l) => l.id === 'madeleine');
const count = (c, type, pred) => c.msgs.filter((m) => m.t === type && (!pred || pred(m))).length;
const sys = (c, re) => c.msgs.filter((m) => m.t === 'chat' && m.system && re.test(m.text)).map((m) => m.text);
function dice() { const d = { q: [], rand: () => (d.q.length ? d.q.shift() : 0.5) }; return d; }

/**
 * Base Firestore factice (option `db` du store). Par défaut commit et lecture prennent un vrai délai, comme sur le
 * réseau ; hold() retient le PROCHAIN commit jusqu'à release() (aucune dépendance au minutage de la machine).
 */
function fakeDb({ commitMs = 80, getMs = 10 } = {}) {
  const data = { players: new Map(), rooms: new Map() };
  let gate = null, open = null;
  const db = {
    data, commits: 0, failNext: false,
    hold() { gate = new Promise((ok) => { open = ok; }); },
    release() { open?.(); },
    collection: (name) => ({ doc: (id) => ({ name, id, async get() { await sleep(getMs); const v = data[name].get(id); return { exists: v != null, data: () => clone(v) }; } }) }),
    batch() {
      const ops = [];
      return {
        set(ref, rec) { ops.push([ref, rec]); },
        async commit() {
          if (gate) { const g = gate; gate = null; await g; } else await sleep(commitMs);
          if (db.failNext) { db.failNext = false; throw new Error('panne'); }
          for (const [ref, rec] of ops) data[ref.name].set(ref.id, clone(rec));
          db.commits++;
        },
      };
    },
  };
  return db;
}

/** Client WebSocket nu : en-têtes HTTP au choix (x-forwarded-for), aucun hello automatique. */
class Raw {
  constructor(url, headers = {}) {
    this.ws = new WebSocket(url, { headers }); this.msgs = []; this.closed = null;
    this.ws.on('message', (raw) => { const m = decode(raw); if (m && m.t !== 'snap') this.msgs.push(m); });
    this.ws.on('close', (code) => { this.closed = code; });
    this.ws.on('error', () => {});
  }
  open() { return new Promise((ok, ko) => { this.ws.once('open', ok); this.ws.once('error', ko); }); }
  send(type, payload) { this.ws.send(encode(type, payload)); }
  async next(type, ms = 2000) {
    const end = Date.now() + ms;
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === type);
      if (i >= 0) return this.msgs.splice(i, 1)[0];
      if (this.closed != null) throw new Error(`socket fermée (${this.closed}) en attendant ${type}`);
      if (Date.now() > end) throw new Error(`délai dépassé en attendant ${type}`);
      await sleep(3);
    }
  }
  async waitClose(ms = 2000) { const end = Date.now() + ms; while (this.closed == null && Date.now() < end) await sleep(3); return this.closed; }
  close() { try { this.ws.close(); } catch { /* déjà fermée */ } }
}
async function rawHello(app, payload, headers) {
  const c = new Raw(app.wsUrl, headers);
  await c.open();
  c.send('hello', { v: PROTOCOL_VERSION, room: 'test', ...payload });
  return c;
}
/** Compte déjà enregistré (un invité tout neuf n'est écrit dans le store qu'à sa première opération). */
async function known(app, name, { room = 'test', money = STARTING_MONEY, edit = null, done = 0 } = {}) {
  const s = seedPlayer(app.store, { name, money, edit, done });
  const c = await join(app, { name, room, token: s.token });
  c.token = s.token;
  return c;
}

// ================================================================ serveur-adverse#0 : store Firestore

test('Firestore : une lecture pendant un commit attend sa fin (jamais le document d’avant), y compris avec deux lots enchaînés ou un commit raté', async () => {
  // lecture pendant un commit : elle attend, puis rend la version qui vient d'être écrite — pas celle d'avant
  let db = fakeDb(), s = new FirestoreStore({ db, intervalMs: 3600e3 }); await s.init();
  s.putRoom({ code: 'r', v: 1 }); await s.flush(); s.putRoom({ code: 'r', v: 2 });
  db.hold();
  let f = s.flush();
  assert.equal(s.pending.rooms.size, 0, 'le lot est parti : plus rien en attente');
  let got = null;
  const g1 = s.getRoom('r').then((r) => { got = r; return r; });
  await sleep(40); // quatre fois le temps d'une lecture de la base
  assert.equal(got, null, 'la lecture attend la fin du commit (sans le correctif elle a déjà rendu la version 1)');
  assert.equal(db.data.rooms.get('r').v, 1, 'la base est encore périmée');
  db.release();
  assert.equal((await g1).v, 2);
  await f;
  assert.equal(await s.getRoom('absente'), null);
  await s.close();

  // deux flush enchaînés, une écriture entre les deux, lecture lancée pendant le premier : la plus récente fait foi
  db = fakeDb(); s = new FirestoreStore({ db, intervalMs: 3600e3 }); await s.init();
  s.putRoom({ code: 'r', v: 1 }); await s.flush(); s.putRoom({ code: 'r', v: 2 });
  db.hold();
  f = s.flush();
  const f2 = s.flush(), g2 = s.getRoom('r');
  s.putRoom({ code: 'r', v: 3 });
  db.release();
  assert.equal((await g2).v, 3);
  await f; await f2; await s.flush();
  assert.equal(db.data.rooms.get('r').v, 3);
  assert.equal(s.flushing, null);
  await s.close();

  // commit raté pendant la lecture : l'enregistrement est remis en file, la lecture le rend (pas la base, périmée)
  db = fakeDb(); s = new FirestoreStore({ db, intervalMs: 3600e3 }); await s.init();
  s.putPlayer({ id: 'p1', money: 1 }); await s.flush(); s.putPlayer({ id: 'p1', money: 2 });
  db.hold(); db.failNext = true;
  f = s.flush(); f.catch(() => {});
  const g3 = s.getPlayer('p1');
  db.release();
  assert.equal((await g3).money, 2);
  await assert.rejects(f);
  assert.equal(db.data.players.get('p1').money, 1, 'la base n’a pas reçu le lot raté');
  await s.flush();
  assert.equal(db.data.players.get('p1').money, 2, 'le lot suivant le rattrape');
  await s.close();
});

test('duplication d’argent (Firestore) : vendre un bien, sortir et revenir pendant l’écriture ne rend pas le bien une seconde fois', async () => {
  const PROP = ALL_PROPERTY_BY_ID.penthouse_vendome || Object.values(ALL_PROPERTY_BY_ID).sort((a, b) => b.price - a.price)[0];
  const BACK = Math.floor(PROP.price * 0.7);
  const db = fakeDb({ commitMs: 120, getMs: 20 });
  const store = new FirestoreStore({ db, intervalMs: 3600e3 }); await store.init();
  const X = seedPlayer(store, { name: 'Vendeur', money: PROP.price });
  await store.flush();
  const app = await boot({ store, at: T0 });
  try {
    let c = await join(app, { name: 'Vendeur', room: 'fs', token: X.token });
    assert.equal((await c.ask('buy_prop', { id: PROP.id }, 'profile')).me.money, 0);
    await store.flush(); // la base contient la salle AVEC le bien au nom du joueur
    assert.equal((await c.ask('sell_prop', { id: PROP.id }, 'profile')).me.money, BACK);
    await quit(app, c); // salle vide : écrite (en attente) puis retirée de la mémoire
    db.hold(); // le prochain commit reste en vol jusqu'à release()
    const flushing = store.flush(); // le minuteur du store tombe ici
    setTimeout(() => db.release(), 60);
    c = await join(app, { name: 'Vendeur', room: 'fs', token: X.token }); // retour PENDANT le commit
    assert.deepEqual(c.welcome.me.properties, [], 'le bien vendu n’est plus au joueur');
    assert.deepEqual(c.welcome.owners, {});
    assert.equal((await c.ask('sell_prop', { id: PROP.id }, 'error')).code, 'not_owned', 'pas de seconde vente');
    assert.equal(c.welcome.me.money, BACK);
    await flushing;
    await c.close();
  } finally { await app.close(); }
  assert.equal(db.data.players.get(X.id).money, BACK, 'aucun argent créé');
  assert.deepEqual(db.data.rooms.get('fs').owners, {});
});

// ================================================================ serveur-adverse#1 : compte en deux copies

test('duplication d’argent (compte expiré) : deux hello avec le même jeton autour du balayage ne donnent jamais deux copies du compte', async () => {
  class SlowStore extends MemoryStore { async getRoom(code) { await sleep(60); return super.getRoom(code); } } // lecture réseau
  const store = new SlowStore();
  const X = seedPlayer(store, { name: 'Double', money: 100000 });
  const M1s = seedPlayer(store, { name: 'MuleUn', money: 0 }), M2s = seedPlayer(store, { name: 'MuleDeux', money: 0 });
  const app = await boot({ store, at: T0 });
  try {
    // le compte passe en mémoire puis se déconnecte ; 5 min plus tard il est expiré, pas encore balayé
    const x = await join(app, { name: 'Double', room: 'r0', token: X.token });
    await quit(app, x);
    app.advance(301);
    // hello n°1 vers une salle pas encore chargée ; le balayage (minuteur de 25 s) tombe pendant la lecture de la salle
    const c1 = await rawHello(app, { name: 'Double', room: 'ra', token: X.token });
    await sleep(20);
    app.game.tickHeartbeat();
    const w1 = await c1.next('welcome');
    assert.equal(app.game.stats().accounts, 1, 'le compte est resté dans la table pendant son hello');
    // hello n°2, même jeton, autre salle : c'est le MÊME compte, l'ancienne connexion est remplacée
    const c2 = await rawHello(app, { name: 'Double', room: 'rb', token: X.token });
    const w2 = await c2.next('welcome');
    assert.equal(w2.id, w1.id);
    assert.equal(await c1.waitClose(), 4001, 'ancienne connexion remplacée');
    assert.equal(app.game.stats().accounts, 1);
    // chaque « copie » vire tout le solde à une mule : un seul virement peut passer
    const m1 = await join(app, { name: 'MuleUn', room: 'ra', token: M1s.token }), m2 = await join(app, { name: 'MuleDeux', room: 'rb', token: M2s.token });
    try { c1.send('transfer', { to: m1.welcome.id, amount: 100000 }); } catch { /* socket fermée */ }
    c2.send('transfer', { to: m2.welcome.id, amount: 100000 });
    await c2.next('profile'); await m2.sync(); await m1.sync();
    const total = (await store.getPlayer(X.id)).money + (await store.getPlayer(M1s.id)).money + (await store.getPlayer(M2s.id)).money;
    assert.equal(total, 100000, 'somme conservée');
    c2.close(); await m1.close(); await m2.close();
  } finally { await app.close(); }
});

// ================================================================ serveur-adverse#2 : débits par compte et par adresse

test('débits : une reconnexion avec le même compte ne remet à neuf ni le seau des Chiche ni le délai de l’avis de recherche', async () => {
  const app = await boot({ at: T0 });
  try {
    const witness = await join(app, { name: 'Témoin' });
    let a = await known(app, 'Léa');
    const token = a.token;
    await place(app, a, MAD.x + 70, MAD.z, { car: 'citadine' });
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    for (let i = 0; i < 2; i++) { await a.ask('dare', { stake: 0 }, 'dare'); a.send('dare_leave', {}); await a.sync(); }
    assert.equal((await a.ask('dare', { stake: 0 }, 'error')).code, 'rate');
    // 20 s plus tard, reconnexion : nouvelle connexion, même compte
    await quit(app, a);
    app.advance(20);
    a = await join(app, { name: 'Léa', token });
    await place(app, a, MAD.x + 70, MAD.z, { car: 'citadine' });
    assert.equal((await a.ask('dare', { stake: 0 }, 'error')).code, 'rate', 'le seau des Chiche suit le compte (1 lancer par 30 s)');
    a.send('heat', { ev: 'bust', k: 2 }); await a.sync(); // clôt la poursuite
    app.advance(61);
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync(); await witness.sync();
    assert.equal(sys(witness, /Avis de recherche/).length, 1, 'au plus un avis de recherche par JOUEUR toutes les 3 min');
    app.advance(180);
    a.send('heat', { ev: 'bust', k: 2 }); a.send('heat', { ev: 'wanted', k: 2 }); await a.sync(); await witness.sync();
    assert.equal(sys(witness, /Avis de recherche/).length, 2, 'après 3 min, l’annonce repart');
    await a.close(); await witness.close();
  } finally { await app.close(); }
});

test('débits : hello par adresse (rafale puis un toutes les 2 s) ; refus « rate » non fatal ; le dernier élément de x-forwarded-for fait foi', async () => {
  const app = await boot({ at: T0, helloBurst: 3 });
  try {
    const open = [];
    for (let i = 0; i < 3; i++) { const c = await rawHello(app, { name: `Inv${i}` }); await c.next('welcome'); open.push(c); }
    const refused = await rawHello(app, { name: 'Trop' });
    const e = await refused.next('error');
    assert.deepEqual([e.op, e.code, e.fatal], ['hello', 'rate', undefined]);
    assert.equal(await refused.waitClose(), 4003, 'code « débit dépassé » : le client réessaie de lui-même');
    app.advance(2); // un jeton revient toutes les 2 s
    const later = await rawHello(app, { name: 'Patient' });
    await later.next('welcome'); open.push(later);
    // derrière un mandataire : l'adresse est le DERNIER élément de x-forwarded-for (les premiers viennent du client)
    for (let i = 0; i < 3; i++) { const c = await rawHello(app, { name: `Nat${i}` }, { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` }); await c.next('welcome'); open.push(c); }
    const spoof = await rawHello(app, { name: 'Faussaire' }, { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' });
    assert.equal((await spoof.next('error')).code, 'rate', 'changer le premier élément ne donne pas un seau neuf');
    const other = await rawHello(app, { name: 'Voisin' }, { 'x-forwarded-for': '203.0.113.7, 198.51.100.9' });
    await other.next('welcome'); open.push(other);
    for (const c of open) c.close();
  } finally { await app.close(); }
  // sans limite (helloBurst 0) : 60 hello d'affilée passent
  const free = await boot({ at: T0, helloBurst: 0 });
  try {
    const cs = [];
    for (let i = 0; i < 60; i++) { const c = await rawHello(free, { name: `Libre${i}`, room: `r${i % 4}` }); await c.next('welcome'); cs.push(c); }
    for (const c of cs) c.close();
  } finally { await free.close(); }
});

// ================================================================ serveur-adverse#3 : records impossibles

test('records : plancher physique par catégorie (parcours par les étapes, rayons déduits, vitesse de pointe de la catégorie)', () => {
  const fast = Math.max(...Object.values(VEHICLE_BY_ID).map((v) => v.maxSpeed));
  for (const city of ['paris', 'toulouse']) {
    for (const m of MISSIONS_BY_CITY[city]) {
      const v = eco.recordFloorSec(m.id, 'v'), s = eco.recordFloorSec(m.id, 's'), holds = m.steps.reduce((t, st) => t + (st.holdSec || 0), 0);
      assert.ok(v >= s && s >= 0, m.id);
      // jamais plus long que la route réelle à la vitesse de pointe : un joueur honnête passe toujours
      assert.ok(v <= CORE.missionRouteLength(m) / eco.CLASS_SPEED + holds, `${m.id} : plancher Ville ${v.toFixed(1)} s`);
      assert.ok(s <= CORE.missionRouteLength(m) / fast + holds, `${m.id} : plancher Sport ${s.toFixed(1)} s`);
      assert.ok(eco.recordFloorMoved(m.id) <= CORE.missionPathLength(m), m.id);
    }
  }
  assert.equal(eco.recordFloorSec('constructor', 'v'), 0);
  assert.ok(eco.recordFloorSec(M1.id, 'v') > M1.minDurationSec, 'le plancher Ville est plus strict que la durée minimale toutes voitures');
});

test('records : temps impossible (téléportation à l’arrivée, ou ligne droite au-delà de la vitesse de pointe) => réussite payée, ni record ni prime', async () => {
  const app = await boot({ at: T0 });
  try {
    const end = lastStep(M1), crow = Math.hypot(end.x - M1.start.x, end.z - M1.start.z);
    const floor = eco.recordFloorSec(M1.id, 'v');
    assert.ok(crow > 300, `mission de ${Math.round(crow)} m à vol d'oiseau`);
    // 1) deux états seulement : départ, puis arrivée (téléportation), à la durée minimale de la mission
    const a = await join(app, { name: 'Mimi' }), w = await join(app, { name: 'Témoin' });
    await place(app, a, M1.start.x, M1.start.z, { car: 'citadine' });
    a.send('mission_start', { id: M1.id }); await a.sync();
    app.advance(Math.max(M1.minDurationSec, 3.3));
    sendState(a, end.x, end.z, { car: 'citadine' });
    let r = await a.ask('mission_complete', { id: M1.id }, 'mission_result');
    assert.ok(r.sec < floor, `${r.sec} s pour un plancher de ${floor.toFixed(1)} s`);
    assert.deepEqual([r.ok, r.reward, r.first, r.star, r.pb, r.rank, r.roomBest], [true, M1.reward, 0, 0, false, 0, null], 'gain de base payé, rien d’autre');
    await w.sync();
    assert.equal(count(w, 'records'), 0);
    assert.equal(sys(w, /Record de salle/).length, 0);
    // 2) durée tenable mais sans trajet (attente puis téléportation) : le chemin mesuré manque
    const b = await join(app, { name: 'Bob' });
    await place(app, b, M1.start.x, M1.start.z, { car: 'citadine' });
    b.send('mission_start', { id: M1.id }); await b.sync();
    app.advance(Math.ceil(floor) + 5);
    sendState(b, end.x, end.z, { car: 'citadine' });
    r = await b.ask('mission_complete', { id: M1.id }, 'mission_result');
    assert.deepEqual([r.ok, r.reward, r.first, r.pb, r.rank], [true, M1.reward, 0, false, 0]);
    // 3) états en ligne droite à 125 m/s, sans aucune téléportation : trop rapide pour la catégorie Ville
    const c = await join(app, { name: 'Zoé' });
    await place(app, c, M1.start.x, M1.start.z, { car: 'citadine' });
    c.send('mission_start', { id: M1.id }); await c.sync();
    const n = Math.ceil(crow / 125);
    for (let i = 1; i <= n; i++) { app.advance(1); sendState(c, M1.start.x + ((end.x - M1.start.x) * i) / n, M1.start.z + ((end.z - M1.start.z) * i) / n, { car: 'citadine' }); await c.sync(); }
    r = await c.ask('mission_complete', { id: M1.id }, 'mission_result');
    assert.ok(r.sec >= M1.minDurationSec - 0.75 && r.sec < floor);
    assert.deepEqual([r.ok, r.first, r.pb, r.rank], [true, 0, false, 0]);
    // 4) un vrai trajet à 60 m/s (sous la vitesse de pointe de la catégorie) : record, prime de première réussite
    const d = await join(app, { name: 'Honnête' });
    await place(app, d, M1.start.x, M1.start.z, { car: 'citadine' });
    d.send('mission_start', { id: M1.id }); await d.sync();
    const k = Math.ceil(crow / 60);
    for (let i = 1; i <= k; i++) { app.advance(1); sendState(d, M1.start.x + ((end.x - M1.start.x) * i) / k, M1.start.z + ((end.z - M1.start.z) * i) / k, { car: 'citadine' }); await d.sync(); }
    r = await d.ask('mission_complete', { id: M1.id }, 'mission_result');
    assert.deepEqual([r.ok, r.sec, r.first, r.pb, r.rank], [true, k, Math.floor(M1.reward * 0.25), true, 1]);
    for (const x of [a, b, c, d, w]) await x.close();
  } finally { await app.close(); }
});

test('records : après une reconnexion en cours de mission le chemin n’est plus exigé (il n’a pas été mesuré), le temps si', async () => {
  const app = await boot({ at: T0 });
  try {
    const end = lastStep(M1);
    let a = await known(app, 'Coupé');
    await place(app, a, M1.start.x, M1.start.z, { car: 'citadine' });
    a.send('mission_start', { id: M1.id }); await a.sync();
    await quit(app, a); // coupure : la mission est conservée 5 min
    app.advance(60);
    a = await join(app, { name: 'Coupé', token: a.token });
    assert.equal(a.welcome.mission, M1.id);
    await place(app, a, end.x, end.z, { car: 'citadine' });
    const r = await a.ask('mission_complete', { id: M1.id }, 'mission_result');
    assert.deepEqual([r.ok, r.pb, r.rank], [true, true, 1]);
    await a.close();
  } finally { await app.close(); }
  // règle pure : moved inconnu (hors-ligne) => seul le temps compte ; moved insuffisant => ni record ni prime
  const mk = () => ({ p: eco.newProfile('p1', 'A'), s: { mission: null, job: null } });
  const end = lastStep(M1), pos = { x: end.x, z: end.z }, long = Math.ceil(eco.recordFloorSec(M1.id, 'v')) + 10;
  let { p, s } = mk();
  eco.missionStart(p, s, M1.id, T0);
  assert.equal(eco.missionComplete(p, s, M1.id, T0 + long * 1000, 'paris', { pos }).pb, true);
  ({ p, s } = mk());
  eco.missionStart(p, s, M1.id, T0);
  let r = eco.missionComplete(p, s, M1.id, T0 + long * 1000, 'paris', { pos, moved: eco.recordFloorMoved(M1.id) - 1 });
  assert.deepEqual([r.ok, r.reward, r.pb, r.first, r.finishOk], [true, M1.reward, false, 0, false]);
  ({ p, s } = mk());
  eco.missionStart(p, s, M1.id, T0);
  r = eco.missionComplete(p, s, M1.id, T0 + long * 1000, 'paris', { pos, moved: eco.recordFloorMoved(M1.id) });
  assert.deepEqual([r.pb, r.first, r.finishOk], [true, Math.floor(M1.reward * 0.25), true]);
});

// ================================================================ serveur-adverse#4 : mise de Chiche retenue

test('Chiche : la mise est retenue du lancer (ou de l’inscription) à la fin — virement, achats et peinture refusés « busy », le perdant paie', async () => {
  const d = dice(), store = new MemoryStore();
  const A = seedPlayer(store, { name: 'Tricheur', money: 2000 }), B = seedPlayer(store, { name: 'Pigeon', money: 5000 }), C = seedPlayer(store, { name: 'Mule', money: 0 });
  const app = await boot({ store, at: T0, rand: d.rand });
  try {
    const a = await join(app, { name: 'Tricheur', token: A.token }), b = await join(app, { name: 'Pigeon', token: B.token }), m = await join(app, { name: 'Mule', token: C.token });
    await place(app, a, O.x, O.z, { car: 'citadine' }); await place(app, b, O.x + 10, O.z, { car: 'citadine' });
    const dare = await a.ask('dare', { stake: 2000 }, 'dare');
    // dès le lancer : le lanceur ne peut plus sortir d'argent
    let e = await a.ask('transfer', { to: m.welcome.id, amount: 2000 }, 'error');
    assert.deepEqual([e.op, e.code, e.text], ['transfer', 'busy', "Terminez d'abord votre Chiche."]);
    await b.ask('dare_join', { id: dare.id }, 'dare', (x) => x.players.length === 2);
    assert.equal((await b.ask('buy_car', { typeId: 'taxi' }, 'error')).code, 'busy', 'inscrit : retenu aussi');
    // un inscrit qui se retire avant le départ est libéré
    b.send('dare_leave', {}); await b.sync();
    assert.equal((await b.ask('paint_car', { typeId: STARTER_VEHICLE, color: VEHICLE_BY_ID[STARTER_VEHICLE].colors[1] }, 'profile')).delta, -500);
    await b.ask('dare_join', { id: dare.id }, 'dare', (x) => x.players.length === 2);
    await a.ask('dare_go', {}, 'dare', (x) => x.phase === 'run');
    for (const [op, payload] of [['transfer', { to: m.welcome.id, amount: 2000 }], ['buy_car', { typeId: 'taxi' }], ['buy_prop', { id: 'studio_pigalle' }], ['paint_car', { typeId: STARTER_VEHICLE, color: VEHICLE_BY_ID[STARTER_VEHICLE].colors[1] }]]) {
      e = await a.ask(op, payload, 'error');
      assert.deepEqual([e.op, e.code], [op, 'busy'], op);
    }
    app.advance(5); app.game.tickDares();
    sendState(b, O.x + 10, O.z, { car: 'citadine' }); await b.sync();
    await drive(app, b, dare.to.x, dare.to.z);
    const end = await b.next('dare_end');
    assert.deepEqual([end.winner.name, end.pot], ['Pigeon', 2000], 'le perdant a payé sa mise');
    await a.sync(); await b.sync();
    assert.deepEqual([(await store.getPlayer(A.id)).money, (await store.getPlayer(B.id)).money, (await store.getPlayer(C.id)).money], [0, 5000 - 500 + 2000, 0]);
    // le défi fini, la retenue tombe : le virement repasse (refusé pour une autre raison : plus un sou)
    assert.equal((await a.ask('transfer', { to: m.welcome.id, amount: 1 }, 'error')).code, 'no_funds');
    assert.equal((await b.ask('transfer', { to: m.welcome.id, amount: 100 }, 'profile')).delta, -100);
    for (const c of [a, b, m]) await c.close();
  } finally { await app.close(); }
});

test('Chiche : la retenue tombe à toutes les fins (solo, retrait du lanceur, durée maximale) et ne pèse pas sur une mise nulle', async () => {
  const d = dice(), app = await boot({ at: T0, rand: d.rand });
  try {
    const a = await known(app, 'Léa'), b = await known(app, 'Tom');
    await place(app, a, O.x, O.z, { car: 'citadine' }); await place(app, b, O.x + 10, O.z, { car: 'citadine' });
    const paint = { typeId: STARTER_VEHICLE, color: VEHICLE_BY_ID[STARTER_VEHICLE].colors[1] }, back = { typeId: STARTER_VEHICLE, color: VEHICLE_BY_ID[STARTER_VEHICLE].colors[0] };
    // mise nulle : aucune retenue
    await a.ask('dare', { stake: 0 }, 'dare');
    assert.equal((await a.ask('paint_car', paint, 'profile')).delta, -500);
    a.send('dare_leave', {}); await a.next('dare_end');
    // clôture en solo à 90 s
    app.advance(31);
    await a.ask('dare', { stake: 500 }, 'dare');
    assert.equal((await a.ask('paint_car', back, 'error')).code, 'busy');
    app.advance(91); app.game.tickDares();
    assert.equal((await a.next('dare_end')).reason, 'solo');
    assert.equal((await a.ask('paint_car', back, 'profile')).delta, -500);
    // retrait du lanceur
    app.advance(31);
    await a.ask('dare', { stake: 500 }, 'dare');
    a.send('dare_leave', {}); await a.next('dare_end');
    assert.equal((await a.ask('paint_car', paint, 'profile')).delta, -500);
    // durée maximale : personne n'arrive, personne ne paie, tout le monde est libéré
    app.advance(31);
    const open = await a.ask('dare', { stake: 500 }, 'dare');
    await b.ask('dare_join', { id: open.id }, 'dare', (x) => x.players.length === 2);
    await a.ask('dare_go', {}, 'dare', (x) => x.phase === 'run');
    app.advance(245); app.game.tickDares();
    assert.equal((await a.next('dare_end')).reason, 'timeout');
    assert.equal((await a.ask('paint_car', back, 'profile')).delta, -500);
    assert.equal((await b.ask('paint_car', paint, 'profile')).delta, -500);
    await a.close(); await b.close();
  } finally { await app.close(); }
});

// ================================================================ serveur-adverse#5 et directive 6 : taxi

test('taxi : courses de 500 à 1 500 m, délai selon le détour routier de la ville (Paris 1,4, Toulouse 1,9, repli 1,4), prix inchangé', () => {
  assert.deepEqual([jobs.JOB_MIN_M, jobs.JOB_MAX_M], [500, 1500]);
  assert.deepEqual(jobs.PAR_ROAD, { paris: 1.4, toulouse: 1.9 });
  assert.equal(jobs.parFor(1000, 'normal', 'paris'), Math.round((1000 * 1.4) / 13 + 15));
  assert.equal(jobs.parFor(1000, 'normal', 'toulouse'), Math.round((1000 * 1.9) / 13 + 15));
  assert.equal(jobs.parFor(1000, 'presse', 'toulouse'), Math.round(((1000 * 1.9) / 13 + 15) * 0.75));
  for (const city of [undefined, 'atlantide', 'constructor', '__proto__']) assert.equal(jobs.parFor(1000, 'normal', city), jobs.parFor(1000, 'normal', 'paris'), String(city));
  assert.equal(jobs.fareFor(1000, 1, false, 'normal'), 500, 'prix à vol d’oiseau, le même dans les deux villes');
  // la course tirée par le serveur porte le délai de SA ville
  for (const city of ['paris', 'toulouse']) {
    const spots = jobs.SPOTS_BY_CITY[city], p = eco.newProfile('p1', 'A'), s = { mission: null, job: null, jobLast: null };
    const pos = { x: spots[0].x, z: spots[0].z };
    for (const v of [0.05, 0.3, 0.6, 0.95]) {
      const res = jobs.jobStart(p, s, { kind: 'taxi', pos, city, now: T0, rand: () => v, vehicleType: 'citadine' });
      assert.equal(res.ok, true);
      const dist = Math.hypot(res.job.to.x - pos.x, res.job.to.z - pos.z);
      const inRing = spots.some((sp) => { const dd = Math.hypot(sp.x - pos.x, sp.z - pos.z); return dd >= 500 && dd <= 1500; });
      if (inRing && res.job.mood !== 'touriste') assert.ok(dist >= 499 && dist <= 1501, `${city} : course de ${Math.round(dist)} m`);
      assert.equal(res.job.parSec, jobs.parFor(s.job.dist, res.job.mood, city), city);
    }
  }
});

test('taxi : plafond dur — au-delà de 2 × le plafond horaire dans la fenêtre, une course ne paie plus rien (elle compte quand même)', () => {
  const run = (paid, level = 1) => {
    const p = eco.newProfile('p1', 'A'), s = { mission: null, job: null, jobLast: null };
    p.stats.missionsDone = [0, 3, 8, 15, 25, 40][level - 1];
    assert.equal(eco.levelOf(p), level);
    p.journal.fareWin = { at: T0, paid };
    const start = jobs.jobStart(p, s, { kind: 'taxi', pos: { x: O.x, z: O.z }, city: 'paris', now: T0, rand: () => 0.1, vehicleType: 'citadine' });
    const res = jobs.jobComplete(p, s, { pos: start.job.to, now: T0 + start.job.parSec * 1000, hits: 0, id: start.job.id });
    return { res, p, nominal: res.fare + res.tip };
  };
  const cap = jobs.hourCap(1);
  let r = run(cap); // plafond atteint : le quart
  assert.deepEqual([r.res.capped, r.res.total], [true, Math.round(r.nominal * 0.25)]);
  r = run(2 * cap - 50); // il reste 50 Ƶ sous le plafond dur
  assert.deepEqual([r.res.ok, r.res.capped, r.res.total, r.res.delta, r.p.money], [true, true, 50, 50, STARTING_MONEY + 50]);
  r = run(2 * cap); // plafond dur atteint : plus rien
  assert.deepEqual([r.res.ok, r.res.capped, r.res.total, r.p.money, r.p.stats.fares, r.p.stats.fareEarned, r.p.journal.fareWin.paid], [true, true, 0, STARTING_MONEY, 1, 0, 2 * cap]);
  r = run(2 * cap + 12345);
  assert.equal(r.res.total, 0);
  // le plafond dur suit le niveau, comme le plafond horaire
  r = run(2 * cap, 3);
  assert.deepEqual([r.res.capped, r.res.total], [true, Math.round(r.nominal * 0.25)], 'niveau 3 : plafond de 22 500 Ƶ dépassé (le quart), plafond dur de 45 000 Ƶ pas atteint');
  // un robot sur une heure pleine : jamais plus de 2 × le plafond
  const p = eco.newProfile('p1', 'A'), s = { mission: null, job: null, jobLast: null };
  let t = T0, n = 0;
  while (t < T0 + HOUR - 60000) {
    const st = jobs.jobStart(p, s, { kind: 'taxi', pos: { x: O.x, z: O.z }, city: 'paris', now: t, rand: () => 0.1, vehicleType: 'citadine' });
    t += Math.ceil(s.job.minSec) * 1000;
    assert.equal(jobs.jobComplete(p, s, { pos: st.job.to, now: t, hits: 0, id: st.job.id }).ok, true);
    n++;
  }
  assert.ok(n > 100, `${n} courses en une heure`);
  assert.ok(p.money - STARTING_MONEY <= 2 * cap, `gains de l'heure : ${p.money - STARTING_MONEY} Ƶ pour un plafond dur de ${2 * cap}`);
  assert.equal(p.stats.fareEarned, p.money - STARTING_MONEY);
});

// ================================================================ serveur-adverse#6 : record de cavale, combo du jour

test('cavale : le record de SALLE exige 110 m mesurés par le serveur et une durée qu’il a vue passer ; la statistique reste comptée', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await known(app, 'Fuyard'), w = await join(app, { name: 'Témoin' });
    await place(app, a, MAD.x + 70, MAD.z, { car: 'citadine' });
    // sans bouger : 6,1 s après l'avis, « semé » en 8,0 s (la borne) — comptée, pas de record
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    app.advance(6.1);
    let p = await a.ask('heat', { ev: 'escape', k: 2, sec: 8, how: 'dist' }, 'profile');
    assert.deepEqual([p.me.stats.escapes, p.me.stats.bestEscapeSec], [1, 8]);
    await w.sync();
    assert.deepEqual([sys(w, /record de cavale/).length, count(w, 'feed')], [0, 0]);
    // 200 m de fuite, mais durée déclarée 1,5 s au-delà de l'horloge du serveur (dans la tolérance de 2 s) : pas de record
    app.advance(60);
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    await drive(app, a, MAD.x + 270, MAD.z); // 2 s
    app.advance(10);
    p = await a.ask('heat', { ev: 'escape', k: 2, sec: 13.5, how: 'dist' }, 'profile');
    assert.equal(p.me.stats.escapes, 2);
    await w.sync();
    assert.equal(count(w, 'feed'), 0);
    // 100 m seulement : pas de record ; 120 m et durée juste (à 0,5 s près) : record
    app.advance(60);
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    await drive(app, a, MAD.x + 370, MAD.z);
    app.advance(18);
    await a.ask('heat', { ev: 'escape', k: 2, sec: 20, how: 'dist' }, 'profile');
    await w.sync();
    assert.equal(count(w, 'feed'), 0, '100 m : trop court');
    app.advance(60);
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    await drive(app, a, MAD.x + 490, MAD.z);
    app.advance(18);
    p = await a.ask('heat', { ev: 'escape', k: 2, sec: 20.5, how: 'dist' }, 'profile');
    assert.deepEqual([p.me.stats.escapes, p.me.stats.bestEscapeSec], [4, 8]);
    assert.equal((await w.next('chat', (m) => m.system && /sème/.test(m.text))).text, 'Fuyard sème les képis en 0:20,5 : record de cavale de la salle !');
    assert.equal((await w.next('feed')).e.d, 20.5);
    await a.close(); await w.close();
  } finally { await app.close(); }
});

test('cavale : le record de salle tient 7 jours (à la lecture, en mémoire comme au chargement)', async () => {
  const store = new MemoryStore();
  const app = await boot({ store, at: T0 });
  try {
    const a = await known(app, 'Fuyard');
    await place(app, a, MAD.x + 70, MAD.z, { car: 'citadine' });
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    await drive(app, a, MAD.x + 470, MAD.z); // 4 s
    app.advance(8);
    await a.ask('heat', { ev: 'escape', k: 2, sec: 12, how: 'dist' }, 'profile');
    app.advance(6 * 24 * 3600);
    let c = await join(app, { name: 'Curieux' });
    assert.equal(c.welcome.cavale.sec, 12, 'encore là au 6e jour');
    await c.close();
    app.advance(24 * 3600 + 1);
    c = await join(app, { name: 'Curieux2' });
    assert.equal(c.welcome.cavale, null, 'effacé au 7e');
    // la salle est libre : une cavale plus longue reprend le record
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    await drive(app, a, MAD.x + 70, MAD.z);
    app.advance(30);
    await a.ask('heat', { ev: 'escape', k: 2, sec: 34, how: 'dist' }, 'profile');
    assert.equal((await c.next('feed')).e.d, 34);
    await a.close(); await c.close();
  } finally { await app.close(); }
  const rec = (at) => normalizeRoomRecord({ code: 'x', cavale: { id: 'p1', name: 'A', sec: 12, at } }, T0).cavale;
  assert.deepEqual(rec(T0 - 6 * DAY), { id: 'p1', name: 'A', sec: 12, at: T0 - 6 * DAY });
  assert.equal(rec(T0 - 7 * DAY), null);
  assert.equal(normalizeRoomRecord({ code: 'x', cavale: { id: 'p1', name: 'A', sec: 12 } }, T0).cavale, null, 'record sans date : effacé');
});

test('style : le combo du jour de la salle retient au plus 600 points par seconde de fenêtre ; le record personnel n’est pas rogné', async () => {
  const app = await boot({ at: T0 });
  try {
    const a = await known(app, 'Styliste'), w = await join(app, { name: 'Témoin' });
    await place(app, a, 0, 0, { car: 'citadine' });
    await drive(app, a, 1000, 0); // 10 s et 1 000 m
    app.advance(14); // fenêtre de 24 s depuis le hello… plus les 2 s de place()
    const win = 26;
    const p = await a.ask('style', { pts: 1e9, combo: 1e9 }, 'profile');
    assert.equal(p.me.stats.bestCombo, 60000, 'record personnel : rogné à la borne du contrat, pas davantage');
    const e = (await w.next('feed', (m) => m.e.k === 'style')).e;
    assert.deepEqual([e.d, e.x], [600 * win, `Combo du jour : Styliste, ${String(600 * win).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} points`]);
    // battable dans la journée : un combo plus gros sur une fenêtre plus longue passe devant
    const b = await known(app, 'Rival');
    await place(app, b, 0, 50, { car: 'citadine' });
    await drive(app, b, 1000, 50);
    app.advance(60);
    await b.ask('style', { pts: 40000, combo: 30000 }, 'profile');
    const again = await join(app, { name: 'Curieux' });
    assert.deepEqual(again.welcome.styleDay, { id: b.welcome.id, name: 'Rival', pts: 30000 });
    for (const c of [a, b, w, again]) await c.close();
  } finally { await app.close(); }
});

// ================================================================ serveur-adverse#7 : champs objets, erreurs en une ligne

test('robustesse : un champ { toString: 1 } ne fait lever aucun handler ; hello avec un pseudo objet accepté en « Invité »', async () => {
  const logs = [], app = await boot({ at: T0, log: (l) => logs.push(l) });
  try {
    const evil = { toString: 1, valueOf: 1 };
    const g = await rawHello(app, { name: evil, room: evil, city: evil });
    const w = await g.next('welcome');
    assert.deepEqual([w.me.name, w.room, w.city], ['Invité', 'paris', 'paris']);
    g.close();
    const a = await known(app, 'Tordu');
    await place(app, a, O.x, O.z, { car: 'citadine' });
    const types = [['chat', { text: evil }], ['mission_start', { id: evil }], ['mission_complete', { id: evil }], ['buy_car', { typeId: evil }], ['set_car', { typeId: evil }],
      ['paint_car', { typeId: evil, color: evil }], ['buy_prop', { id: evil }], ['sell_prop', { id: evil }], ['job_done', { id: evil, hits: evil }], ['transfer', { to: evil, amount: evil }],
      ['claim', { kind: evil, id: evil }], ['set_look', { horn: evil }], ['dare', { stake: evil }], ['dare_join', { id: evil }], ['emote', { k: evil }], ['bump', { by: evil }],
      ['heat', { ev: evil, k: evil, sec: evil }], ['style', { pts: evil, combo: evil }], ['job_start', { kind: evil }]];
    for (const [t, body] of types) { a.send(t, body); await a.sync(); app.advance(30); }
    assert.equal(count(a, 'error', (m) => m.code === 'server'), 0, 'aucune exception dans un handler');
    assert.deepEqual(logs.filter((l) => /^\[(msg|hello)/.test(l)), []);
    assert.equal(a.closed, null);
    assert.equal(count(a, 'chat'), 0, 'un texte objet n’est pas un message');
    await a.close();
  } finally { await app.close(); }
});

test('robustesse : une exception dans un handler = UNE ligne de journal (sans pile) et un strike ; la connexion est coupée au 21e', async () => {
  const logs = [], store = new MemoryStore(), app = await boot({ store, at: T0, log: (l) => logs.push(l) });
  try {
    const a = await known(app, 'Malchance');
    const put = store.putPlayer.bind(store);
    let broken = 21; // les 21 prochaines écritures échouent (celle du départ, ensuite, passe)
    store.putPlayer = (rec) => { if (broken-- > 0) throw new Error('store en panne'); return put(rec); };
    for (let i = 0; i < 21; i++) { a.send('set_car', { typeId: STARTER_VEHICLE }); if (i % 6 === 5) { await a.sync(); app.advance(10); } }
    assert.equal(await a.waitClose(), 4003);
    const lines = logs.filter((l) => l.startsWith('[msg set_car]'));
    assert.equal(lines.length, 21);
    for (const l of lines) { assert.ok(!l.includes('\n'), 'une seule ligne'); assert.match(l, /^\[msg set_car\] Error: store en panne at /); }
    assert.equal(count(a, 'error', (m) => m.code === 'server'), 21);
  } finally { await app.close(); }
});

// ================================================================ serveur-adverse#8 : villes piégées

test('villes : « constructor », « __proto__ », « toString » ne sont pas des villes (repli sur Paris, côté règles comme côté hello)', async () => {
  for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'atlantide', '', null, undefined, 42, {}]) {
    assert.equal(sanitizeCity(id), 'paris', String(id));
    assert.equal(geoFor(id).city, CITIES.paris, String(id));
  }
  assert.equal(sanitizeCity('toulouse'), 'toulouse');
  assert.equal(geoFor('toulouse').city, CITIES.toulouse);
  const logs = [], app = await boot({ at: T0, log: (l) => logs.push(l) });
  try {
    for (const city of ['constructor', '__proto__', 'toString']) {
      const c = await join(app, { name: 'Proto', city });
      assert.equal(c.welcome.city, 'paris', city);
      await c.close();
    }
    assert.deepEqual(logs.filter((l) => l.startsWith('[hello]')), []);
  } finally { await app.close(); }
});

// ================================================================ serveur-adverse#9 : stockage borné

test('stockage : un hello sans jeton n’écrit ni profil ni salle ; la première opération (ou un trajet) les fait écrire', async () => {
  const store = new MemoryStore(), n = countWrites(store);
  let app = await boot({ store, at: T0, helloBurst: 0 });
  try {
    for (let i = 0; i < 30; i++) { const c = await join(app, { name: `Passant${i}`, room: `code-${i}` }); await quit(app, c); }
    assert.deepEqual([n.players, n.rooms, store.players.size, store.rooms.size], [0, 0, 0, 0], '30 hello, 30 codes de salle inédits : rien dans le store');
    assert.equal(app.game.stats().accounts, 30, 'les comptes restent 5 min en mémoire (reprise de session)');
    // un invité qui revient dans les 5 min retrouve son compte, toujours sans écriture
    const g = await join(app, { name: 'Fidèle', room: 'salon' });
    await quit(app, g);
    const g2 = await join(app, { name: 'Fidèle', room: 'salon', token: g.welcome.token });
    assert.deepEqual([g2.welcome.id, g2.welcome.token, n.players], [g.welcome.id, undefined, 0]);
    // première opération : profil ET salle écrits
    await g2.ask('set_car', { typeId: STARTER_VEHICLE }, 'profile');
    assert.equal((await store.getPlayer(g.welcome.id)).name, 'Fidèle');
    await quit(app, g2);
    assert.ok(await store.getRoom('salon'), 'la salle où un compte a agi est écrite à son départ');
    // un invité qui a roulé (distance reportée) est écrit à son départ
    const r = await join(app, { name: 'Rouleur', room: 'route' });
    await place(app, r, 0, 0, { car: 'citadine' }); await drive(app, r, 300, 0);
    assert.equal(await store.getPlayer(r.welcome.id), null);
    await quit(app, r);
    assert.ok((await store.getPlayer(r.welcome.id)).stats.distance >= 299);
    // un invité tout neuf dans une salle DÉJÀ enregistrée : la salle continue d'être écrite, pas lui
    const before = n.rooms;
    const v = await join(app, { name: 'Visiteur', room: 'salon' });
    await quit(app, v);
    assert.ok(n.rooms > before);
    assert.equal(await store.getPlayer(v.welcome.id), null);
    // 5 min plus tard les comptes jamais écrits ont disparu de la mémoire ; à l'arrêt, aucun n'est écrit
    app.advance(301); app.game.tickHeartbeat();
    assert.equal(app.game.stats().accounts, 0);
    const idle = await join(app, { name: 'Oisif', room: 'salon' });
    await app.close(); app = null;
    assert.equal(await store.getPlayer(idle.welcome.id), null);
    assert.deepEqual([...store.players.values()].map((p) => p.name).sort(), ['Fidèle', 'Rouleur']);
    assert.deepEqual([...store.rooms.keys()].sort(), ['route', 'salon']);
  } finally { await app?.close(); }
});

// ================================================================ serveur-adverse#10 : pseudos trompeurs

test('pseudos : « Système » refusé, caractères invisibles retirés (2 visibles exigés) ; chat sans marques de sens d’écriture', async () => {
  for (const n of ['Système', 'Systeme', 'SYSTÈME', 'système', 'System', 'S y s t è m e', 'Système2', '_Systeme-']) assert.equal(eco.sanitizeName(n), 'Invité', n);
  for (const n of ['ㅤㅤㅤㅤ', 'ᅟᅠᅟ', 'ﾠﾠ', 'Aㅤㅤ', '​‍⁠', {}, [], null, undefined, { toString: 1 }]) assert.equal(eco.sanitizeName(n), 'Invité', JSON.stringify(n));
  assert.deepEqual(['Alice', 'Élodie', 'Sys', 'Systemd', 'Le Système D', 'Jean-Luc_2', 42, 'aㅤb'].map(eco.sanitizeName), ['Alice', 'Élodie', 'Sys', 'Systemd', 'Le Système D', 'Jean-Luc_2', '42', 'ab']);
  assert.equal(eco.sanitizeChat('abc ‮drowssap‬ ‎‏‪⁦x⁩ <b>'), 'abc drowssap x ‹b›');
  assert.deepEqual([eco.sanitizeChat({ toString: 1 }), eco.sanitizeChat(null), eco.sanitizeChat(12)], ['', '', '12']);
  assert.deepEqual([eco.sanitizeRoom({}), eco.sanitizeRoom(null), eco.sanitizeRoom('Été-2026'), eco.sanitizeRoom(7)], ['paris', 'paris', 'ete-2026', '7']);
  const app = await boot({ at: T0 });
  try {
    const a = await join(app, { name: 'Système' }), b = await join(app, { name: 'ㅤㅤㅤㅤ' }), w = await join(app, { name: 'Témoin' });
    assert.deepEqual([a.welcome.me.name, b.welcome.me.name], ['Invité', 'Invité2']);
    a.send('chat', { text: 'Tom vous a envoyé ‮000 05' }); await a.sync();
    const line = await w.next('chat');
    assert.deepEqual([line.from, line.system, line.text], ['Invité', undefined, 'Tom vous a envoyé 000 05']);
    for (const c of [a, b, w]) await c.close();
  } finally { await app.close(); }
});

// ================================================================ horsligne-compat#1, style-kepis#6 : avis de recherche de session

test('képis : une fuite de durée nulle lève l’avis sans rien compter — la poursuite suivante est annoncée et paie SON plafond', async () => {
  // gameplay/heat.js n'envoie ni « bust » ni « escape » quand les képis lâchent au minuteur avec l'unité au pare-chocs :
  // le module réseau du client clôt alors la poursuite par { ev: 'escape', sec: 0 } (sinon l'avis vaudrait encore 10 min
  // et la poursuite suivante en hériterait : pas d'annonce, plafond d'amende des 3 képis)
  const app = await boot({ at: T0 });
  try {
    const a = await known(app, 'Léa', { money: 40000 }), b = await join(app, { name: 'Témoin' });
    a.send('heat', { ev: 'wanted', k: 3 }); await a.sync();
    a.send('heat', { ev: 'escape', k: 2, sec: 0 }); await a.sync();
    app.advance(240); // 4 min : l'annonce est de nouveau permise (3 min), l'ancien avis vaudrait encore 6 min
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync(); await b.sync();
    assert.equal(sys(b, /^Avis de recherche : Léa/).length, 2, 'la seconde poursuite est annoncée');
    const p = await a.ask('heat', { ev: 'bust', k: 2 }, 'profile');
    assert.deepEqual([p.delta, p.me.stats.escapes || 0, p.me.stats.fines], [-600, 0, 1], 'plafond des 2 képis, aucune cavale comptée');
    await a.close(); await b.close();
  } finally { await app.close(); }
});

test('képis : l’avis de recherche survit à une reconnexion (amende débitée, cavale comptée) ; le niveau redit au contrôle relève l’amende', async () => {
  const app = await boot({ at: T0 });
  try {
    // 40 000 Ƶ au niveau 1 : 3 % = 1 200 Ƶ, plafond 300 × képis × niveau = 600 (2 képis) ou 900 (3 képis)
    let a = await known(app, 'Léa', { money: 40000 });
    const token = a.token;
    await place(app, a, MAD.x + 70, MAD.z, { car: 'citadine' });
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    await quit(app, a); // coupure pendant la poursuite
    app.advance(3);
    a = await join(app, { name: 'Léa', token });
    let p = await a.ask('heat', { ev: 'bust', k: 2 }, 'profile');
    assert.deepEqual([p.delta, p.reason, p.me.stats.fines], [-600, 'amende', 1]);
    // cavale réussie après une coupure : comptée
    app.advance(61);
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    await quit(app, a);
    app.advance(20);
    a = await join(app, { name: 'Léa', token });
    p = await a.ask('heat', { ev: 'escape', k: 2, sec: 20, how: 'time' }, 'profile');
    assert.deepEqual([p.me.stats.escapes, p.me.stats.bestEscapeSec], [1, 20]);
    // poursuite lancée à 2 képis, montée à 3 en route (un seul « wanted »), contrôle à 3 képis : plafond de 900
    app.advance(61);
    a.send('heat', { ev: 'wanted', k: 2 }); await a.sync();
    p = await a.ask('heat', { ev: 'bust', k: 3 }, 'profile');
    assert.equal(p.delta, -900);
    // l'inverse ne baisse pas l'amende : avis à 3 képis, contrôle annoncé à 2
    app.advance(61);
    a.send('heat', { ev: 'wanted', k: 3 }); await a.sync();
    p = await a.ask('heat', { ev: 'bust', k: 2 }, 'profile');
    assert.equal(p.delta, -900);
    await a.close();
  } finally { await app.close(); }
});

// ================================================================ multijoueur#1 : gazette du forfait

test('gazette : le perdant par forfait (coupure pendant le Chiche) retrouve « X gagne un Chiche » dans welcome.feed, même à la milliseconde près', async () => {
  const d = dice(), app = await boot({ at: T0, rand: d.rand });
  try {
    const a = await known(app, 'Alice'), b = await known(app, 'Bob');
    await place(app, a, O.x, O.z, { car: 'citadine' }); await place(app, b, O.x + 10, O.z, { car: 'citadine' });
    const open = await a.ask('dare', { stake: 500 }, 'dare');
    await b.ask('dare_join', { id: open.id }, 'dare', (x) => x.players.length === 2);
    await a.ask('dare_go', {}, 'dare', (x) => x.phase === 'run');
    app.advance(5); app.game.tickDares();
    await quit(app, b); // l'horloge ne bouge pas : le fait et le départ portent le même horodatage
    const end = await a.next('dare_end');
    assert.deepEqual([end.winner.name, end.pot, end.reason], ['Alice', 500, 'left']);
    const back = await join(app, { name: 'Bob', token: b.token });
    assert.equal(back.welcome.me.money, STARTING_MONEY - 500);
    assert.deepEqual(back.welcome.feed.map((e) => [e.k, e.n, e.d, e.x]), [['dare', 'Alice', 500, 'Alice gagne un Chiche (+Ƶ 500)']]);
    // une reconnexion de plus ne le renvoie pas une seconde fois
    await quit(app, back);
    app.advance(1);
    const again = await join(app, { name: 'Bob', token: b.token });
    assert.deepEqual(again.welcome.feed, []);
    await a.close(); await again.close();
  } finally { await app.close(); }
});

// ================================================================ journal-records#0 : défis de la veille

/** Remplit les compteurs du jour pour que les objectifs `ids` soient atteints. */
function fill(p, now, ids = ['d1', 'd2', 'd3']) {
  const st = J.dailyState(p, now), c = p.journal.day.c;
  for (const e of st.list) {
    if (!ids.includes(e.id)) continue;
    if (e.kind === 'star') c.star = 1; else if (e.kind === 'missions') c.m = e.goal; else if (e.kind === 'fares') c.fares = e.goal;
    else if (e.kind === 'types') c.types = Object.keys(CORE.MISSION_TYPES).slice(0, e.goal); else c[e.kind] = e.goal;
  }
}

test('journal (règle) : à la bascule, les défis réussis non réclamés sont dus, la journée complète fait avancer la série', () => {
  const R = J.DAILY_REWARD[0];
  // trois défis réussis, rien de réclamé, série de 4 jours en cours
  let p = eco.newProfile('p1', 'A');
  fill(p, T0);
  p.journal.streak = { n: 4, last: J.prevDayKey(J.dayKey(T0)), best: 4 };
  assert.equal(J.rollDay(p, T0 + DAY), true);
  const full = Math.round(1.5 * R * (1 + 0.1 * 5));
  assert.deepEqual([p.journal.due, p.journal.dueN, p.journal.streak, p.stats.dailyDone], [3 * R + full, 5, { n: 5, last: J.dayKey(T0), best: 5 }, 3]);
  assert.deepEqual([p.journal.day.k, p.journal.day.claimed, p.journal.day.full, p.money], [J.dayKey(T0 + DAY), [], false, STARTING_MONEY], 'rien n’est crédité par la bascule elle-même');
  assert.deepEqual(J.publicJournal(p, T0 + DAY, 'paris', {}, 'r').streak, { n: 5, best: 5 }, 'la série est vivante le lendemain');
  assert.equal(J.rollDay(p, T0 + DAY), false, 'une seule bascule par jour');
  // le montant survit à un rechargement du profil
  const back = eco.normalizeProfile(clone(p));
  assert.deepEqual([back.journal.due, back.journal.dueN], [3 * R + full, 5]);
  let r = eco.settleDue(p);
  assert.deepEqual([r.ok, r.amount, r.delta, r.reason, r.streak, r.streakUp], [true, 3 * R + full, 3 * R + full, 'défis de la veille', { n: 5, best: 5 }, true]);
  assert.deepEqual([p.money, p.stats.earned, p.journal.due, p.journal.dueN], [STARTING_MONEY + 3 * R + full, 3 * R + full, 0, 0]);
  assert.equal(eco.settleDue(p).code, 'nothing', 'payé une seule fois');

  // deux défis réussis dont un déjà réclamé : seul l'autre est dû, pas de journée complète, la série ne bouge pas
  p = eco.newProfile('p1', 'A');
  fill(p, T0, ['d1', 'd3']);
  assert.equal(eco.claim(p, { kind: 'daily', id: 'd1' }, { now: T0 }).ok, true);
  J.rollDay(p, T0 + DAY);
  assert.deepEqual([p.journal.due, p.journal.dueN, p.journal.streak.n, p.stats.dailyDone], [R, 0, 0, 2]);
  r = eco.settleDue(p);
  assert.deepEqual([r.amount, r.streakUp], [R, false]);

  // tout réclamé (journée complète comprise), ou rien de réussi : rien de dû
  p = eco.newProfile('p1', 'A');
  fill(p, T0);
  for (const id of ['d1', 'd2', 'd3', 'full']) assert.equal(eco.claim(p, { kind: 'daily', id }, { now: T0 }).ok, true);
  J.rollDay(p, T0 + DAY);
  assert.deepEqual([p.journal.due, p.journal.streak.n], [0, 1]);
  p = eco.newProfile('p1', 'A');
  J.rollDay(p, T0); J.rollDay(p, T0 + DAY);
  assert.equal(p.journal.due, 0);

  // les trois défis encaissés mais pas la journée complète : la prime et la série sont dues
  p = eco.newProfile('p1', 'A');
  fill(p, T0);
  for (const id of ['d1', 'd2', 'd3']) eco.claim(p, { kind: 'daily', id }, { now: T0 });
  J.rollDay(p, T0 + DAY);
  assert.deepEqual([p.journal.due, p.journal.dueN, p.journal.streak.n, p.stats.dailyDone], [Math.round(1.5 * R * 1.1), 1, 1, 3]);

  // retour après trois jours : la veille lointaine est soldée, mais la série est rompue aujourd'hui
  p = eco.newProfile('p1', 'A');
  fill(p, T0);
  J.rollDay(p, T0 + 3 * DAY);
  assert.ok(p.journal.due > 0);
  assert.deepEqual(J.publicJournal(p, T0 + 3 * DAY, 'paris', {}, 'r').streak, { n: 0, best: 1 });
  // deux bascules sans passage : le dû se cumule
  p = eco.newProfile('p1', 'A');
  fill(p, T0, ['d1']); J.rollDay(p, T0 + DAY); fill(p, T0 + DAY, ['d1']); J.rollDay(p, T0 + 2 * DAY);
  assert.equal(p.journal.due, 2 * R);
});

test('journal (serveur) : trois défis réussis non réclamés avant 4 h => crédités au retour (motif « défis de la veille »), série avancée et annoncée', async () => {
  const store = new MemoryStore(), R = J.DAILY_REWARD[0];
  const s = seedPlayer(store, { name: 'Assidu', money: 0, edit: (p) => { fill(p, T0); p.journal.streak = { n: 1, last: J.prevDayKey(J.dayKey(T0)), best: 1 }; } });
  const app = await boot({ store, at: T0 });
  try {
    const w = await join(app, { name: 'Témoin' });
    let a = await join(app, { name: 'Assidu', token: s.token });
    assert.deepEqual([a.welcome.journal.full.ready, a.welcome.journal.streak.n], [true, 1]);
    await quit(app, a); // rien réclamé
    app.advance(20 * 3600); // le lendemain matin
    a = await join(app, { name: 'Assidu', token: s.token });
    const due = 3 * R + Math.round(1.5 * R * 1.2);
    assert.deepEqual([a.welcome.fresh, a.welcome.me.money, a.welcome.journal.day, a.welcome.journal.streak], [true, 0, '2026-01-16', { n: 2, best: 2 }]);
    const p = await a.next('profile');
    assert.deepEqual([p.delta, p.reason, p.me.money, p.me.stats.dailyDone], [due, 'défis de la veille', due, 3]);
    assert.match((await w.next('chat', (m) => m.system && /jours de défis/.test(m.text))).text, /^Assidu enchaîne 2 jours de défis !$/);
    assert.deepEqual((({ k, id, d }) => [k, id, d])((await w.next('feed')).e), ['streak', s.id, 2]);
    assert.equal((await a.ask('claim', { kind: 'daily', id: 'd1' }, 'error')).code, 'not_ready', 'les défis du nouveau jour repartent de zéro');
    assert.deepEqual([(await store.getPlayer(s.id)).money, (await store.getPlayer(s.id)).journal.due], [due, 0]);
    // payé une seule fois : ni au tick du journal, ni à la reconnexion suivante
    app.game.tickJournal(); await a.sync();
    assert.equal(count(a, 'profile'), 0);
    await quit(app, a);
    a = await join(app, { name: 'Assidu', token: s.token });
    await a.sync();
    assert.deepEqual([a.welcome.me.money, count(a, 'profile')], [due, 0]);
    await a.close(); await w.close();
  } finally { await app.close(); }
});

test('journal (serveur) : bascule de 4 h vécue en session => S.PROFILE des défis de la veille puis S.JOURNAL du nouveau jour, au tick', async () => {
  const store = new MemoryStore(), R = J.DAILY_REWARD[0];
  const at = Date.UTC(2026, 0, 16, 2, 50, 0); // 3 h 50 à Paris : la journée du 15 se termine dans 10 min
  const s = seedPlayer(store, { name: 'Veilleur', money: 100, edit: (p) => fill(p, at, ['d1', 'd2']) });
  const app = await boot({ store, at });
  try {
    const a = await join(app, { name: 'Veilleur', token: s.token });
    assert.equal(a.welcome.journal.day, '2026-01-15');
    app.game.tickJournal(); await a.sync();
    assert.deepEqual([count(a, 'profile'), count(a, 'journal')], [0, 0], 'avant 4 h : rien');
    app.advance(11 * 60);
    app.game.tickJournal();
    const p = await a.next('profile'), j = (await a.next('journal')).j;
    assert.deepEqual([p.delta, p.reason, p.me.money], [2 * R, 'défis de la veille', 100 + 2 * R]);
    assert.deepEqual([j.day, j.list.map((e) => e.have), j.streak.n], ['2026-01-16', [0, 0, 0], 0]);
    app.game.tickJournal(); await a.sync();
    assert.equal(count(a, 'profile'), 0);
    await a.close();
  } finally { await app.close(); }
});

// ================================================================ journal-records#5, multijoueur#5, directives 14 et 15 : phrases du serveur

test('phrases : élision devant un pseudo, catégorie du record, argent écrit « Ƶ 1 234 » (« +Ƶ 1 234 » pour un gain)', async () => {
  const title = M1.title, rec = (pn, c = 'v') => feedText({ k: 'record', n: 'Bob', pn, d: 17.3, m: M1.id, c });
  assert.equal(rec('Alice'), `Bob bat le record d'Alice sur « ${title} » (0:17,3, Ville)`);
  assert.equal(rec('Tom', 's'), `Bob bat le record de Tom sur « ${title} » (0:17,3, Sport)`);
  assert.equal(rec(undefined, 's'), `Bob signe le record de salle sur « ${title} » (0:17,3, Sport)`);
  assert.equal(feedText({ k: 'record', n: 'Bob', d: 9, m: M1.id }), `Bob signe le record de salle sur « ${title} » (0:09,0, Ville)`, 'fait sans catégorie : Ville');
  const of = (pn) => /record (d'|de )/.exec(rec(pn))[1];
  for (const n of ['Alice', 'Élodie', 'émile', 'Hugo', 'Yves', 'Yvan', 'Ines', 'Œdipe'.replace('Œ', 'O'), 'Ugo', 'Àgnes', 'ours']) assert.equal(of(n), "d'", n);
  for (const n of ['Bob', 'Tom', 'Yann', 'Yoan', 'Yéti', '42', 'Le Chat', '_Zed', 'Zoé']) assert.equal(of(n), 'de ', n);
  assert.equal(eco.fmtMoney(1234567), 'Ƶ 1 234 567');
  assert.equal(eco.fmtMoney(0), 'Ƶ 0');
  assert.equal(feedText({ k: 'dare', n: 'Tom', d: 2000 }), 'Tom gagne un Chiche (+Ƶ 2 000)');
  assert.equal(feedText({ k: 'dare', n: 'Tom', d: 0 }), 'Tom gagne un Chiche');
  assert.equal(eco.buyCar(eco.newProfile('p1', 'A'), 'taxi').text, 'Fonds insuffisants : il manque Ƶ 7 000.');

  const app = await boot({ at: T0 });
  try {
    const a = await known(app, 'Alice'), b = await known(app, 'Bob'), w = await known(app, 'Témoin');
    a.msgs = []; b.msgs = [];
    a.send('transfer', { to: b.welcome.id, amount: 1200 });
    assert.deepEqual([(await b.next('profile')).reason, (await a.next('profile')).reason], ["virement d'Alice", 'virement à Bob']);
    assert.equal((await b.next('chat', (m) => m.system)).text, 'Alice vous a envoyé Ƶ 1 200.');
    assert.equal((await a.next('chat', (m) => m.system)).text, 'Vous avez envoyé Ƶ 1 200 à Bob.');
    b.send('transfer', { to: a.welcome.id, amount: 5 });
    assert.equal((await a.next('profile')).reason, 'virement de Bob');
    await place(app, a, O.x, O.z, { car: 'citadine' });
    assert.equal((await a.ask('dare', { stake: 7 }, 'error')).text, 'Mise invalide : Ƶ 0, Ƶ 500 ou Ƶ 2 000.');
    // réussite d'une mission : la ligne des autres porte le gain
    await place(app, w, M1.start.x, M1.start.z, { car: 'citadine' });
    w.send('mission_start', { id: M1.id }); await w.sync();
    const end = lastStep(M1);
    await drive(app, w, end.x + 1500, end.z); // loin de l'arrivée : pas de record, donc la ligne ordinaire
    app.advance(60);
    await w.ask('mission_complete', { id: M1.id }, 'mission_result');
    assert.equal((await a.next('chat', (m) => m.system && /a réussi/.test(m.text))).text, `Témoin a réussi la mission « ${title} » (+Ƶ ${String(M1.reward).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}).`);
    for (const c of [a, b, w]) await c.close();
  } finally { await app.close(); }
});

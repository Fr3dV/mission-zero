import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { boot, join, seedPlayer, Client } from '../testkit.js';
import { MemoryStore } from '../store/memory.js';
import { FileStore } from '../store/file.js';
import { FirestoreStore } from '../store/firestore.js';
import { STARTING_MONEY, STARTER_VEHICLE, VEHICLES } from '../../shared/catalog.js';
import { MISSIONS_BY_CITY } from '../../shared/missions.js';
import { PROPERTIES_BY_CITY, SELL_BACK_RATIO } from '../../shared/properties.js';
import { PROTOCOL_VERSION, MAX_PLAYERS_PER_ROOM, CLOSE, encodeState, decodeState } from '../../shared/protocol.js';
import { geoFor } from '../../shared/cities.js';
const { BOUNDS } = geoFor('paris'); // les tests de ce fichier jouent à Paris (ville par défaut du protocole)

const M = [...MISSIONS_BY_CITY.paris].sort((a, b) => b.minDurationSec - a.minDurationSec)[0]; // la plus longue : marge nette pour le test « trop rapide »
const PROP = [...PROPERTIES_BY_CITY.paris].sort((a, b) => a.price - b.price)[0];
const CAR = VEHICLES.filter((v) => v.price > STARTING_MONEY).sort((a, b) => a.price - b.price)[0];

test('statique : /healthz, index.html, modules partagés et three', async () => {
  const app = await boot();
  try {
    assert.equal(await (await fetch(app.url + '/healthz')).text(), 'ok');
    for (const path of ['/', '/src/main.js', '/shared/protocol.js', '/vendor/three/build/three.module.js']) {
      assert.equal((await fetch(app.url + path)).status, 200, path);
    }
    assert.equal((await fetch(app.url + '/../package.json')).status, 404);
    assert.equal((await fetch(app.url + '/inexistant.js')).status, 404);
  } finally { await app.close(); }
});

test('connexion : compte invité créé, jeton, profil de départ, reprise de session', async () => {
  const app = await boot();
  try {
    const a = await join(app, { name: '  <b>Ali ce</b>!!  ' });
    const w = a.welcome;
    assert.equal(w.v, PROTOCOL_VERSION);
    assert.match(w.token, /^p[0-9a-f]{16}\.[\w-]{20,}$/);
    assert.equal(w.me.name, 'bAli ceb'); // pseudo nettoyé
    assert.equal(w.me.money, STARTING_MONEY);
    assert.deepEqual(w.me.cars, [STARTER_VEHICLE]);
    assert.equal(w.me.activeCar, STARTER_VEHICLE);
    assert.deepEqual(w.me.properties, []);
    assert.equal(w.room, 'test');
    // le secret n'est jamais stocké en clair
    const rec = await app.store.getPlayer(w.id);
    assert.ok(rec.tokenHash && !JSON.stringify(rec).includes(w.token.split('.')[1]));
    await a.close();
    // reprise avec le jeton : même compte ; jeton invalide : nouveau compte
    const b = await join(app, { name: 'Alice', token: w.token });
    assert.equal(b.welcome.id, w.id);
    assert.equal(b.welcome.token, undefined);
    const c = await join(app, { name: 'Pirate', token: w.id + '.mauvais-secret-mauvais-secret' });
    assert.notEqual(c.welcome.id, w.id);
    await b.close(); await c.close();
  } finally { await app.close(); }
});

test('salles : deux clients se voient (arrivée, instantanés, chat, départ), salles isolées', async () => {
  const app = await boot();
  try {
    const a = await join(app, { name: 'Alice', room: 'Amis!' });
    assert.equal(a.welcome.room, 'amis');
    const b = await join(app, { name: 'Bob', room: 'amis' });
    const other = await join(app, { name: 'Zoé', room: 'ailleurs' });
    assert.deepEqual(b.welcome.players.map((p) => p.name), ['Alice']);
    assert.equal((await a.next('join')).name, 'Bob');
    assert.equal(other.welcome.players.length, 0);

    a.send('st', { s: encodeState({ x: 12.34, y: 0, z: -56.78, yaw: 1.234, speed: 3, mode: 'foot', anim: 'walk' }) });
    b.send('st', { s: encodeState({ x: 100, y: 0, z: 50, yaw: 0, speed: 20, mode: 'vehicle', anim: 'sit', vehicleType: 'taxi', vehicleColor: 0x112233 }) });
    const snap = await b.next('snap', (m) => m.p.length === 2);
    const pa = decodeState(snap.p.find((p) => p[0] === a.welcome.id), 1);
    assert.deepEqual([pa.x, pa.z, pa.mode, pa.anim], [12.3, -56.8, 'foot', 'walk']);
    const pb = decodeState(snap.p.find((p) => p[0] === b.welcome.id), 1);
    assert.deepEqual([pb.mode, pb.vehicleType, pb.vehicleColor], ['vehicle', 'taxi', '#112233']);

    b.send('chat', { text: '  salut <script>alert(1)</script>  ' });
    const chat = await a.next('chat', (m) => !m.system);
    assert.equal(chat.from, 'Bob');
    assert.ok(!/[<>]/.test(chat.text) && chat.text.startsWith('salut'));
    assert.ok(!other.msgs.some((m) => m.t === 'chat' && !m.system), 'le chat ne fuit pas vers une autre salle');

    await b.close();
    assert.equal((await a.next('leave')).id, b.welcome.id);
    await a.close(); await other.close();
  } finally { await app.close(); }
});

test('validation : positions bornées, téléportations en rafale ignorées, états invalides rejetés', async () => {
  const app = await boot();
  try {
    const a = await join(app);
    const st = (x, z) => a.send('st', { s: [x, 0, z, 0, 0, 0, 0] });
    const mine = async () => (await a.next('snap')).p.find((p) => p[0] === a.welcome.id);
    st(1e9, 0);
    a.msgs = []; let p = await mine();
    assert.ok(p[1] <= BOUNDS.maxX + 300, 'x borné');
    st(0, 0); // 1re téléportation : acceptée
    await new Promise((r) => setTimeout(r, 120)); a.msgs = []; p = await mine();
    assert.equal(p[1], 0);
    app.advance(0.1); st(900, 900); // 2e téléportation immédiate : ignorée
    a.send('st', { s: ['x', 0, 0, 0, 0, 0, 0] }); a.send('st', { s: [NaN] }); a.send('st', {});
    await new Promise((r) => setTimeout(r, 120)); a.msgs = []; p = await mine();
    assert.equal(p[1], 0);
    app.advance(0.1); st(5, 5); // déplacement plausible : accepté
    await new Promise((r) => setTimeout(r, 120)); a.msgs = []; p = await mine();
    assert.equal(p[1], 5);
    await a.close();
  } finally { await app.close(); }
});

test('limites : message trop gros, JSON invalide, hello obligatoire, pseudo unique, salle pleine, compte remplacé', async () => {
  const app = await boot();
  try {
    const big = new Client(app.wsUrl); await big.open();
    big.ws.send(JSON.stringify({ t: 'hello', name: 'x'.repeat(5000) }));
    assert.equal(await big.waitClose(), 1009);

    const mute = new Client(app.wsUrl); await mute.open();
    mute.send('chat', { text: 'sans hello' }); mute.send('buy_car', { typeId: 'taxi' });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(mute.msgs.length, 0);
    for (let i = 0; i < 7; i++) mute.ws.send('pas du json');
    assert.equal(await mute.waitClose(), CLOSE.FLOOD);

    const old = new Client(app.wsUrl); await old.open();
    old.send('hello', { v: 0, name: 'Vieux', room: 'test' });
    assert.equal((await old.next('error')).code, 'version');
    assert.equal(await old.waitClose(), CLOSE.REJECTED);

    const a = await join(app, { name: 'Alice', room: 'plein' });
    const a2 = await join(app, { name: 'alice', room: 'plein' });
    assert.equal(a2.welcome.me.name, 'alice2');
    // même compte dans un second onglet : l'ancien est fermé avec le code REPLACED
    const a3 = await join(app, { name: 'Alice', room: 'plein', token: a.welcome.token });
    assert.equal(await a.waitClose(), CLOSE.REPLACED);
    assert.equal(a3.welcome.id, a.welcome.id);

    const crowd = [a2, a3];
    while (crowd.length < MAX_PLAYERS_PER_ROOM) crowd.push(await join(app, { name: 'J' + crowd.length, room: 'plein' }));
    const extra = new Client(app.wsUrl); await extra.open();
    extra.send('hello', { v: PROTOCOL_VERSION, name: 'Trop', room: 'plein' });
    assert.equal((await extra.next('error')).code, 'room_full');
    await extra.waitClose();
    await Promise.all(crowd.map((c) => c.close()));
  } finally { await app.close(); }
});

test('missions : non démarrée, trop rapide, réussite, cooldown, mission inconnue', async () => {
  const app = await boot();
  try {
    const a = await join(app);
    const done = () => a.ask('mission_complete', { id: M.id, durationSec: 9999 }, 'mission_result');
    let r = await done();
    assert.deepEqual([r.ok, r.code], [false, 'not_started']);

    a.send('mission_start', { id: M.id }); await a.sync();
    app.advance(M.minDurationSec / 2);
    r = await done(); // la durée annoncée par le client (9999 s) est ignorée : seule l'horloge serveur compte
    assert.deepEqual([r.ok, r.code], [false, 'too_fast']);
    assert.match(r.reason, /trop vite/);

    a.send('mission_start', { id: M.id }); await a.sync();
    app.advance(M.minDurationSec + 1);
    r = await done();
    assert.deepEqual([r.ok, r.reward], [true, M.reward]);
    const prof = await a.next('profile');
    assert.equal(prof.me.money, STARTING_MONEY + M.reward);
    assert.deepEqual([prof.delta, prof.reason, prof.me.stats.missionsDone, prof.me.stats.earned], [M.reward, 'mission', 1, M.reward]);

    r = await done(); // rejouer la même réponse ne paie pas deux fois
    assert.equal(r.ok, false);

    if (M.cooldownSec > 0) {
      const e = await a.ask('mission_start', { id: M.id }, 'mission_result');
      assert.deepEqual([e.ok, e.code], [false, 'cooldown']);
      app.advance(M.cooldownSec + 1);
    }
    a.send('mission_start', { id: M.id }); await a.sync();
    app.advance(M.minDurationSec + 1);
    assert.equal((await done()).ok, true);

    const e = await a.ask('mission_start', { id: 'nexiste_pas' }, 'mission_result');
    assert.deepEqual([e.ok, e.code], [false, 'unknown_mission']);
    await a.close();
  } finally { await app.close(); }
});

test('véhicules : achat sans fonds refusé, achat, doublon refusé, voiture active', async () => {
  const store = new MemoryStore();
  const rich = seedPlayer(store, { money: CAR.price + 10 });
  const app = await boot({ store });
  try {
    const poor = await join(app, { name: 'Fauché' });
    let e = await poor.ask('buy_car', { typeId: CAR.id }, 'error');
    assert.deepEqual([e.op, e.code], ['buy_car', 'no_funds']);
    assert.match(e.text, /Fonds insuffisants/);
    e = await poor.ask('buy_car', { typeId: 'soucoupe' }, 'error');
    assert.equal(e.code, 'unknown_car');
    e = await poor.ask('set_car', { typeId: CAR.id }, 'error');
    assert.equal(e.code, 'not_owned');

    const a = await join(app, { name: 'Riche', token: rich.token });
    const p = await a.ask('buy_car', { typeId: CAR.id }, 'profile');
    assert.deepEqual([p.me.money, p.delta, p.me.activeCar], [10, -CAR.price, CAR.id]);
    assert.ok(p.me.cars.includes(CAR.id));
    e = await a.ask('buy_car', { typeId: CAR.id }, 'error');
    assert.equal(e.code, 'already_owned');
    const p2 = await a.ask('set_car', { typeId: STARTER_VEHICLE }, 'profile');
    assert.equal(p2.me.activeCar, STARTER_VEHICLE);
    await a.close(); await poor.close();
  } finally { await app.close(); }
});

test('immobilier : sans fonds refusé, propriété exclusive par salle, loyers au prorata, revente', async () => {
  const store = new MemoryStore();
  const ta = seedPlayer(store, { name: 'Alice', money: PROP.price + 100 });
  const tb = seedPlayer(store, { name: 'Bob', money: PROP.price * 3 });
  const app = await boot({ store });
  try {
    const poor = await join(app, { name: 'Fauché' });
    let e = await poor.ask('buy_prop', { id: PROP.id }, 'error');
    assert.equal(e.code, 'no_funds');

    const a = await join(app, { name: 'Alice', token: ta.token });
    const b = await join(app, { name: 'Bob', token: tb.token });
    const p = await a.ask('buy_prop', { id: PROP.id }, 'profile');
    assert.deepEqual([p.me.money, p.me.properties], [100, [PROP.id]]);
    const owners = await b.next('owners');
    assert.deepEqual(owners.owners[PROP.id], { id: ta.id, name: 'Alice' });
    assert.match((await b.next('chat', (m) => m.system && /acheté/.test(m.text))).text, /Alice a acheté/);

    e = await b.ask('buy_prop', { id: PROP.id }, 'error'); // déjà possédé par Alice
    assert.equal(e.code, 'already_owned');
    assert.match(e.text, /Alice/);
    e = await b.ask('sell_prop', { id: PROP.id }, 'error');
    assert.equal(e.code, 'not_owned');

    // la même propriété reste libre dans une autre salle
    const b2 = await join(app, { name: 'Bob', token: tb.token, room: 'autre' });
    assert.equal(b2.welcome.owners[PROP.id], undefined);
    const pb = await b2.ask('buy_prop', { id: PROP.id }, 'profile');
    assert.deepEqual(pb.me.properties, [PROP.id]);

    // loyers : income par heure, au prorata (30 min -> la moitié)
    app.advance(1800); app.game.tickRents();
    const rent = await a.next('profile', (m) => m.reason === 'loyers');
    assert.equal(rent.delta, Math.floor(PROP.income / 2));
    assert.ok(rent.me.stats.playSeconds >= 1800);

    const sold = await a.ask('sell_prop', { id: PROP.id }, 'profile');
    assert.equal(sold.delta, Math.floor(PROP.price * SELL_BACK_RATIO));
    assert.deepEqual(sold.me.properties, []);
    await a.close(); await b2.close(); await poor.close();
  } finally { await app.close(); }
});

test('virements : crédit/débit, montants invalides, solde insuffisant, destinataire absent, limite de débit', async () => {
  const app = await boot();
  try {
    const a = await join(app, { name: 'Alice' });
    const b = await join(app, { name: 'Bob' });
    const far = await join(app, { name: 'Loin', room: 'ailleurs' });
    const pa = await a.ask('transfer', { to: b.welcome.id, amount: 1200 }, 'profile');
    assert.deepEqual([pa.me.money, pa.delta], [STARTING_MONEY - 1200, -1200]);
    const pb = await b.next('profile');
    assert.deepEqual([pb.me.money, pb.delta, pb.reason], [STARTING_MONEY + 1200, 1200, 'virement de Alice']);

    const bad = async (payload, code) => assert.equal((await b.ask('transfer', payload, 'error')).code, code, JSON.stringify(payload));
    await bad({ to: a.welcome.id, amount: STARTING_MONEY * 10 }, 'no_funds');
    await bad({ to: a.welcome.id, amount: -5 }, 'bad_amount');
    await bad({ to: a.welcome.id, amount: 0 }, 'bad_amount');
    await bad({ to: far.welcome.id, amount: 10 }, 'rate'); // 4e virement d'affilée : limite de débit
    app.advance(60);
    await bad({ to: a.welcome.id, amount: 1.5 }, 'bad_amount');
    await bad({ to: a.welcome.id, amount: '100' }, 'bad_amount');
    await bad({ to: far.welcome.id, amount: 10 }, 'unknown_player'); // autre salle
    app.advance(60);
    await bad({ to: b.welcome.id, amount: 10 }, 'self');

    const lb = await a.ask('ping', { c: 1 }, 'pong').then(() => { app.game.tickLeaderboards(); return a.next('lb'); });
    assert.deepEqual(lb.list.map((e) => [e.name, e.money]), [['Bob', STARTING_MONEY + 1200], ['Alice', STARTING_MONEY - 1200]]);
    await a.close(); await b.close(); await far.close();
  } finally { await app.close(); }
});

test('persistance mémoire : profil et propriétaires survivent à un redémarrage', async () => {
  const store = new MemoryStore();
  const t = seedPlayer(store, { name: 'Alice', money: PROP.price + CAR.price + 500 });
  let app = await boot({ store });
  let a = await join(app, { name: 'Alice', token: t.token, room: 'perso' });
  await a.ask('buy_prop', { id: PROP.id }, 'profile');
  await a.ask('buy_car', { typeId: CAR.id }, 'profile');
  const closed = a.waitClose();
  await app.close(); // arrêt propre : sauvegarde + fermeture 1012 (le client doit se reconnecter)
  assert.equal(await closed, CLOSE.RESTART);

  app = await boot({ store });
  try {
    a = await join(app, { name: 'Alice', token: t.token, room: 'perso' });
    assert.equal(a.welcome.me.money, 500);
    assert.deepEqual(a.welcome.me.properties, [PROP.id]);
    assert.ok(a.welcome.me.cars.includes(CAR.id));
    assert.equal(a.welcome.owners[PROP.id].id, t.id);
    assert.equal(a.welcome.lb[0].name, 'Alice');
    await a.close();
  } finally { await app.close(); }
});

test('persistance fichier : écriture atomique et relecture', async () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'mz-'));
  const file = pathJoin(dir, 'sous', 'store.json');
  try {
    const s1 = new FileStore({ file, intervalMs: 1e6 }); await s1.init();
    const app = await boot({ store: s1 });
    const a = await join(app, { name: 'Alice' });
    await app.close();
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(onDisk.players.length, 1);
    assert.equal(onDisk.rooms[0].code, 'test');
    const s2 = new FileStore({ file, intervalMs: 1e6 }); await s2.init();
    assert.equal((await s2.getPlayer(a.welcome.id)).name, 'Alice');
    await s2.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('store Firestore : écritures différées et groupées (faux client)', async () => {
  const docs = new Map(); let commits = 0, failNext = false;
  const db = {
    collection: (c) => ({ doc: (id) => ({ key: `${c}/${id}`, get: async () => ({ exists: docs.has(`${c}/${id}`), data: () => docs.get(`${c}/${id}`) }) }) }),
    batch: () => { const ops = []; return { set: (ref, data) => ops.push([ref.key, data]), commit: async () => { if (failNext) { failNext = false; throw new Error('panne'); } commits++; for (const [k, d] of ops) docs.set(k, d); } }; },
  };
  const s = new FirestoreStore({ db, intervalMs: 1e6 }); await s.init();
  s.putPlayer({ id: 'p1', money: 1 }); s.putPlayer({ id: 'p1', money: 2 }); s.putRoom({ code: 'paris', owners: {} });
  assert.equal(commits, 0);
  assert.equal((await s.getPlayer('p1')).money, 2, "lecture de l'écriture en attente");
  failNext = true;
  await assert.rejects(s.flush());
  await s.flush(); // l'échec a remis les écritures en file
  assert.equal(commits, 1);
  assert.deepEqual([...docs.keys()].sort(), ['players/p1', 'rooms/paris']);
  assert.equal(docs.get('players/p1').money, 2);
  assert.equal(await s.getPlayer('absent'), null);
  await s.close();
});

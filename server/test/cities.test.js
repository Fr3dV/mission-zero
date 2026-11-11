// Multi-villes : une salle appartient à une ville ; missions et biens ne valent que dans leur ville ;
// les salles de Paris enregistrées avant le multi-villes gardent leur clé et leurs propriétaires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, join, seedPlayer, serverState } from '../testkit.js';
import { MemoryStore } from '../store/memory.js';
import { roomKey } from '../game.js';
import { geoFor } from '../../shared/cities.js';
import { MISSIONS_BY_CITY } from '../../shared/missions.js';
import { PROPERTIES_BY_CITY } from '../../shared/properties.js';
import { STARTING_MONEY, VEHICLES } from '../../shared/catalog.js';
import { encodeState } from '../../shared/protocol.js';

const cheapest = (list) => [...list].sort((a, b) => a.price - b.price)[0];
const PARIS_MISSION = MISSIONS_BY_CITY.paris[0], TLS_MISSION = MISSIONS_BY_CITY.toulouse[0];
const PARIS_PROP = cheapest(PROPERTIES_BY_CITY.paris), TLS_PROP = cheapest(PROPERTIES_BY_CITY.toulouse);
const foot = (x, z) => ({ s: encodeState({ x, y: 0, z, yaw: 0, speed: 0, mode: 'foot', anim: 'idle' }) });

test('clé de salle : Paris garde le code nu, les autres villes sont préfixées', () => {
  assert.equal(roomKey('paris', 'amis'), 'amis');
  assert.equal(roomKey('toulouse', 'amis'), 'toulouse:amis');
  assert.equal(roomKey('toulouse', 'paris'), 'toulouse:paris');
});

test('même code de salle : villes différentes -> salles distinctes ; même ville -> ensemble ; sans `city` -> Paris', async () => {
  const app = await boot();
  try {
    const p1 = await join(app, { name: 'Paul', room: 't1', city: 'paris' });
    const t1 = await join(app, { name: 'Tom', room: 't1', city: 'toulouse' });
    const t2 = await join(app, { name: 'Tina', room: 't1', city: 'toulouse' });
    const old = await join(app, { name: 'Ancien', room: 't1' }); // onglet ouvert avant la mise à jour : pas de champ city
    const odd = await join(app, { name: 'Bizarre', room: 't1', city: 'atlantide' }); // ville inconnue : Paris

    assert.deepEqual([p1.welcome.city, t1.welcome.city, t2.welcome.city, old.welcome.city, odd.welcome.city], ['paris', 'toulouse', 'toulouse', 'paris', 'paris']);
    assert.deepEqual([p1, t1, t2, old, odd].map((c) => c.welcome.room), ['t1', 't1', 't1', 't1', 't1'], 'le code de salle renvoyé est celui saisi');
    assert.deepEqual(t1.welcome.players, [], 'Tom ne voit pas le joueur de Paris');
    assert.deepEqual(t2.welcome.players.map((p) => p.name), ['Tom']);
    assert.deepEqual(old.welcome.players.map((p) => p.name), ['Paul']);
    assert.deepEqual(odd.welcome.players.map((p) => p.name).sort(), ['Ancien', 'Paul']);

    // arrivées : chacun n'est prévenu que pour sa ville
    assert.equal((await t1.next('join')).name, 'Tina');
    assert.equal((await p1.next('join')).name, 'Ancien');
    await p1.sync(); await t1.sync();
    assert.ok(!p1.msgs.some((m) => m.t === 'join' && /Tom|Tina/.test(m.name)));
    assert.ok(!t1.msgs.some((m) => m.t === 'join' && /Paul|Ancien|Bizarre/.test(m.name)));

    // instantanés : uniquement les joueurs de la salle de sa ville
    for (const c of [p1, t1, t2, old]) c.send('st', foot(10, 20));
    for (const c of [p1, t2, old]) await c.sync();
    const ids = (snapOf) => snapOf.p.map((p) => p[0]).sort();
    assert.ok(await serverState(app, t1));
    t1.msgs = []; app.game.tickSnapshots();
    assert.deepEqual(ids(await t1.next('snap')), [t1.welcome.id, t2.welcome.id].sort());
    p1.msgs = []; app.game.tickSnapshots();
    assert.deepEqual(ids(await p1.next('snap')), [p1.welcome.id, old.welcome.id].sort());

    // chat et classement : par salle, donc par ville
    t1.send('chat', { text: 'bonjour la ville rose' });
    assert.equal((await t2.next('chat', (m) => !m.system)).from, 'Tom');
    p1.send('chat', { text: 'bonjour Paris' });
    assert.equal((await old.next('chat', (m) => !m.system)).text, 'bonjour Paris');
    await p1.sync(); await t2.sync();
    assert.ok(!p1.msgs.some((m) => m.t === 'chat' && /rose/.test(m.text)), 'le chat de Toulouse ne fuit pas à Paris');
    assert.ok(!t2.msgs.some((m) => m.t === 'chat' && /Paris/.test(m.text)), 'le chat de Paris ne fuit pas à Toulouse');
    assert.deepEqual(t2.welcome.lb.map((e) => e.name).sort(), ['Tina', 'Tom']);
    assert.deepEqual(odd.welcome.lb.map((e) => e.name).sort(), ['Ancien', 'Bizarre', 'Paul']);

    // virement vers un joueur de l'autre ville : il n'est pas dans la salle
    const e = await t1.ask('transfer', { to: p1.welcome.id, amount: 10 }, 'error');
    assert.equal(e.code, 'unknown_player');
    for (const c of [p1, t1, t2, old, odd]) await c.close();
  } finally { await app.close(); }
});

test("positions : validées avec l'emprise de la ville de la salle", async () => {
  const app = await boot();
  try {
    const P = geoFor('paris').BOUNDS, T = geoFor('toulouse').BOUNDS;
    const far = Math.round(P.maxX + 3000); // hors de Paris, bien à l'intérieur de Toulouse (≈ 15 × 15 km)
    assert.ok(far < T.maxX);
    const p = await join(app, { name: 'Paul', room: 'geo', city: 'paris' });
    const t = await join(app, { name: 'Tom', room: 'geo', city: 'toulouse' });
    p.send('st', foot(far, 0)); t.send('st', foot(far, 0));
    assert.ok((await serverState(app, p))[1] <= P.maxX + 300, 'borné à Paris');
    assert.equal((await serverState(app, t))[1], far, 'accepté tel quel à Toulouse');
    app.advance(2); t.send('st', foot(1e7, -1e7));
    const s = await serverState(app, t);
    assert.ok(s[1] <= T.maxX + 300 && s[3] >= T.minZ - 300, 'borné à Toulouse');
    await p.close(); await t.close();
  } finally { await app.close(); }
});

test('rocade : 350 km/h avec des états groupés par le réseau -> rien de rejeté ; 400 m/s -> rejeté', async () => {
  const app = await boot();
  try {
    const top = Math.max(...VEHICLES.map((v) => v.maxSpeed)); // m/s — 97 = 350 km/h
    const c = await join(app, { name: 'Pilote', room: 'rocade', city: 'toulouse' });
    let x = 0;
    const drive = (dx) => { x = Math.round((x + dx) * 10) / 10; c.send('st', { s: encodeState({ x, y: 0, z: 2000, yaw: 0, speed: top, mode: 'vehicle', anim: 'sit', vehicleType: 'lambo_aventador' }) }); };
    drive(0);
    await c.sync();
    // 3 s à vitesse maximale, 15 états/s
    for (let i = 0; i < 45; i++) { app.advance(1 / 15); drive(top / 15); await c.sync(); }
    assert.equal((await serverState(app, c))[1], x, 'conduite régulière à vitesse maximale');
    // gel réseau de 1,5 s : les états mis en tampon arrivent tous au même instant
    app.advance(1.5);
    for (let i = 0; i < 22; i++) drive(top / 15);
    assert.equal((await serverState(app, c))[1], x, 'rafale après un gel réseau');
    // les états suivants arrivent encore collés (quelques ms d'écart), puis le rythme redevient normal
    for (let i = 0; i < 10; i++) { app.advance(0.005); drive(top / 15); }
    assert.equal((await serverState(app, c))[1], x, 'états collés');
    // machine lente : 5 états/s seulement, donc de grands pas
    for (let i = 0; i < 15; i++) { app.advance(0.2); drive(top / 5); await c.sync(); }
    assert.equal((await serverState(app, c))[1], x, 'faible fréquence d\'envoi');

    // triche : 400 m/s soutenus. Le crédit de déplacement s'épuise, une téléportation est tolérée, puis les états sont ignorés.
    let rejected = 0;
    for (let i = 0; i < 40; i++) {
      app.advance(1 / 15); drive(400 / 15);
      if ((await serverState(app, c))[1] !== x) rejected++;
    }
    assert.ok(rejected >= 8, `états rejetés à 400 m/s : ${rejected}`);
    // retour à une conduite honnête : la position est de nouveau suivie
    app.advance(2); drive(5);
    assert.equal((await serverState(app, c))[1], x);
    await c.close();
  } finally { await app.close(); }
});

test("économie : mission et bien d'une autre ville refusés ; argent et voitures globaux, biens par ville", async () => {
  const store = new MemoryStore();
  const rich = seedPlayer(store, { name: 'Alice', money: PARIS_PROP.price + TLS_PROP.price + 1000 });
  const app = await boot({ store });
  try {
    // --- à Toulouse : le contenu de Paris est refusé, celui de Toulouse accepté
    let a = await join(app, { name: 'Alice', room: 'eco', city: 'toulouse', token: rich.token });
    let r = await a.ask('mission_start', { id: PARIS_MISSION.id }, 'mission_result');
    assert.deepEqual([r.ok, r.code], [false, 'wrong_city']);
    assert.match(r.reason, /Paris/); assert.match(r.reason, /Toulouse/);
    let e = await a.ask('buy_prop', { id: PARIS_PROP.id }, 'error');
    assert.deepEqual([e.op, e.code], ['buy_prop', 'wrong_city']);
    assert.match(e.text, /Paris/);
    e = await a.ask('sell_prop', { id: PARIS_PROP.id }, 'error');
    assert.equal(e.code, 'wrong_city');

    let p = await a.ask('buy_prop', { id: TLS_PROP.id }, 'profile');
    assert.deepEqual(p.me.properties, [TLS_PROP.id]);
    assert.equal(p.me.money, PARIS_PROP.price + 1000);
    a.send('mission_start', { id: TLS_MISSION.id }); await a.sync();
    app.advance(TLS_MISSION.minDurationSec + 1);
    r = await a.ask('mission_complete', { id: TLS_MISSION.id }, 'mission_result');
    assert.deepEqual([r.ok, r.reward], [true, TLS_MISSION.reward]);
    const money = PARIS_PROP.price + 1000 + TLS_MISSION.reward;
    await a.close();

    // --- à Paris, même compte, même code de salle : argent et statistiques suivent, pas les biens
    a = await join(app, { name: 'Alice', room: 'eco', city: 'paris', token: rich.token });
    assert.equal(a.welcome.me.money, money, "l'argent est global au compte");
    assert.equal(a.welcome.me.stats.missionsDone, 1, 'le niveau (missions réussies) est global');
    assert.deepEqual(a.welcome.me.properties, [], 'les biens sont par salle, donc par ville');
    assert.deepEqual(a.welcome.owners, {});
    r = await a.ask('mission_start', { id: TLS_MISSION.id }, 'mission_result');
    assert.deepEqual([r.ok, r.code], [false, 'wrong_city']);
    e = await a.ask('buy_prop', { id: TLS_PROP.id }, 'error');
    assert.equal(e.code, 'wrong_city');
    assert.match(e.text, /Toulouse/);
    p = await a.ask('buy_prop', { id: PARIS_PROP.id }, 'profile');
    assert.deepEqual(p.me.properties, [PARIS_PROP.id]);

    // mission démarrée à Paris puis « terminée » depuis Toulouse : refusée, rien n'est crédité
    a.send('mission_start', { id: PARIS_MISSION.id }); await a.sync();
    await a.close();
    app.advance(PARIS_MISSION.minDurationSec + 1);
    a = await join(app, { name: 'Alice', room: 'eco', city: 'toulouse', token: rich.token });
    assert.deepEqual(a.welcome.me.properties, [TLS_PROP.id], 'le bien de Toulouse est toujours là');
    r = await a.ask('mission_complete', { id: PARIS_MISSION.id }, 'mission_result');
    assert.deepEqual([r.ok, r.code], [false, 'wrong_city']);
    assert.equal(a.welcome.me.money, money - PARIS_PROP.price);

    // loyers : seuls les biens de la salle courante rapportent
    app.advance(3600); app.game.tickRents();
    const rent = await a.next('profile', (m) => m.reason === 'loyers');
    assert.equal(rent.delta, TLS_PROP.income);
    await a.close();

    // ids piégés : jamais pris pour une mission, un bien ou une voiture
    const b = await join(app, { name: 'Malin', room: 'eco' });
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      assert.equal((await b.ask('mission_start', { id }, 'mission_result')).code, 'unknown_mission', id);
      assert.equal((await b.ask('buy_prop', { id }, 'error')).code, 'unknown_property', id);
      app.advance(10);
      assert.equal((await b.ask('buy_car', { typeId: id }, 'error')).code, 'unknown_car', id);
    }
    assert.equal((await store.getPlayer(b.welcome.id)).money, STARTING_MONEY);
    await b.close();
  } finally { await app.close(); }
});

test("persistance : une salle de Paris d'avant le multi-villes est retrouvée sous sa clé d'origine", async () => {
  const store = new MemoryStore();
  const alice = seedPlayer(store, { name: 'Alice', money: 4242 });
  // enregistrement tel que l'écrivait la version précédente : clé = code nu, pas de champ `city`
  const legacy = { code: 'amis', createdAt: 1700000000000, owners: { [PARIS_PROP.id]: { id: alice.id, name: 'Alice' } }, members: { [alice.id]: { name: 'Alice', money: 4242 }, pabsent000000000: { name: 'Absent', money: 99999 } } };
  store.putRoom(legacy);
  const before = JSON.stringify(await store.getPlayer(alice.id));

  let app = await boot({ store });
  const a = await join(app, { name: 'Alice', room: 'amis', city: 'paris', token: alice.token });
  assert.equal(a.welcome.owners[PARIS_PROP.id].id, alice.id, 'propriétaires conservés');
  assert.deepEqual(a.welcome.me.properties, [PARIS_PROP.id]);
  assert.equal(a.welcome.me.money, 4242);
  assert.deepEqual(a.welcome.lb.map((e) => e.name), ['Absent', 'Alice'], 'classement conservé');
  const old = await join(app, { name: 'Ancien', room: 'amis' }); // client sans `city` : la même salle
  assert.equal(old.welcome.owners[PARIS_PROP.id].id, alice.id);
  assert.deepEqual(old.welcome.players.map((p) => p.name), ['Alice']);
  // le même code à Toulouse est une autre salle, vide
  const t = await join(app, { name: 'Tom', room: 'amis', city: 'toulouse' });
  assert.deepEqual(t.welcome.owners, {});
  assert.deepEqual(t.welcome.players, []);
  assert.deepEqual(t.welcome.lb.map((e) => e.name), ['Tom']);
  await app.close();

  assert.deepEqual([...store.rooms.keys()].sort(), ['amis', 'toulouse:amis']);
  const paris = await store.getRoom('amis'), tls = await store.getRoom('toulouse:amis');
  assert.equal(paris.code, 'amis');
  assert.equal(paris.createdAt, legacy.createdAt);
  assert.deepEqual(paris.owners, legacy.owners, 'aucun bien perdu ni réattribué');
  assert.deepEqual(paris.members.pabsent000000000, legacy.members.pabsent000000000);
  assert.equal(paris.city, 'paris');
  assert.deepEqual([tls.code, tls.city, tls.room], ['toulouse:amis', 'toulouse', 'amis']);
  assert.deepEqual(tls.owners, {});
  // le profil n'a changé que par ses champs vivants (lastSeen, temps de jeu) : même jeton, même argent, mêmes voitures
  const now = await store.getPlayer(alice.id), was = JSON.parse(before);
  for (const k of ['id', 'tokenHash', 'money', 'cars', 'activeCar', 'cooldowns']) assert.deepEqual(now[k], was[k], k);

  // redémarrage : tout est retrouvé, dans les deux villes
  app = await boot({ store });
  try {
    const a2 = await join(app, { name: 'Alice', room: 'amis', token: alice.token });
    assert.equal(a2.welcome.owners[PARIS_PROP.id].id, alice.id);
    const t2 = await join(app, { name: 'Tom', room: 'amis', city: 'toulouse' });
    assert.deepEqual(t2.welcome.owners, {});
    await a2.close(); await t2.close();
  } finally { await app.close(); }
});

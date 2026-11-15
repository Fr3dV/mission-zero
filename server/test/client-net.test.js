// Module réseau du CLIENT (client/src/net/index.js) face à un vrai serveur éphémère : ce que le reste du jeu lit
// sur le bus et dans le store quand la WebSocket est coupée puis rétablie (Chiche perdu de vue, mission fantôme,
// jeton du compte, avis de recherche). Le module est chargé ici sous Node : ses imports « @shared/… » sont résolus
// par un crochet de chargement, le rendu des joueurs distants (remotes.js, qui tire three.js) est remplacé par un
// bouchon, et WebSocket / localStorage / location sont fournis par le test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import WS from 'ws';
import { boot, join, seedPlayer, place, drive } from '../testkit.js';
import { MemoryStore } from '../store/memory.js';
import * as jobs from '../../shared/jobs.js';
import { CITY_ID } from '../../shared/cities.js';
import { MISSIONS_BY_CITY } from '../../shared/missions.js';

const SHARED = new URL('../../shared/', import.meta.url).href;
const REMOTES = 'data:text/javascript,' + encodeURIComponent('export const createRemotes = () => ({ clear() {}, onSnapshot() {}, remove() {}, update() {} });');
register('data:text/javascript,' + encodeURIComponent(
  `export function resolve(spec, ctx, next) {
    if (spec === './remotes.js') return { url: ${JSON.stringify(REMOTES)}, shortCircuit: true };
    return next(spec.startsWith('@shared/') ? ${JSON.stringify(SHARED)} + spec.slice(8) : spec, ctx);
  }`,
));
// navigateur minimal : stockage en mémoire (écriture refusable), hôte de la page, WebSocket espionnée
const disk = new Map();
let diskFull = false;
globalThis.localStorage = {
  getItem: (k) => (disk.has(k) ? disk.get(k) : null),
  setItem: (k, v) => { if (diskFull) throw new Error('QuotaExceededError'); disk.set(k, String(v)); },
  removeItem: (k) => { disk.delete(k); },
};
globalThis.location = { host: 'essai.test', protocol: 'http:' };
const socks = [], hellos = [];
// halted : le scénario est fini — toute socket (ouverte ou à venir) reçoit une fermeture « refusée » (4002), la seule
// qui arrête pour de bon la reconnexion automatique du module (sinon ses minuteurs retiendraient le processus)
let halted = false;
const refuse = (s) => { try { s.onclose?.({ code: 4002 }); } catch { /* socket qui n'est plus la courante */ } try { s.terminate(); } catch { /* déjà fermée */ } };
globalThis.WebSocket = class extends WS {
  constructor(url) { super(url); socks.push(this); this.on('error', () => {}); if (halted) setTimeout(() => refuse(this), 0); }
  send(data) { if (typeof data === 'string' && data.startsWith('{"t":"hello"')) hellos.push(JSON.parse(data)); return super.send(data); }
};
const { createNet } = await import('../../client/src/net/index.js');

const T0 = Date.UTC(2026, 0, 15, 11, 0, 0); // midi à Paris : loin de la bascule de 4 h
const O = jobs.SPOTS_BY_CITY[CITY_ID][0];
const M1 = MISSIONS_BY_CITY[CITY_ID].find((m) => m.level === 1 && m.type !== 'photo' && !m.intro);
const TIMED = MISSIONS_BY_CITY[CITY_ID].find((m) => m.level === 1 && m.type !== 'photo' && !m.anyOrder && !m.intro); // chronométrée, étapes dans l'ordre
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, test, ms = 6000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = test(); if (v) return v; await sleep(10); }
  throw new Error(`délai dépassé : ${what}`);
}

/**
 * Émet une intention jusqu'à ce qu'elle ait pris. Juste après un accueil, le serveur peut ne pas encore connaître la
 * position du joueur (premier état du module, à 15 Hz) : il refuse alors (« no_pos », « too_far ») et rien ne réessaie
 * à la place du joueur. Sous charge, une seule émission à délai fixe rendait ces tests intermittents.
 */
function insist(what, g, intent, payload, taken) {
  let last = 0;
  return until(what, () => {
    const v = taken();
    if (!v && Date.now() - last > 150) { last = Date.now(); g.bus.emit(intent, payload); }
    return v;
  });
}

const games = [];
/** Fin d'un scénario, réussi ou non : plus aucun minuteur ni socket du client ne retient le processus. */
async function done(app, ...clients) {
  for (const g of games.splice(0)) g.stop();
  for (const c of clients) { try { await c?.close(); } catch { /* déjà fermé */ } }
  await app.close();
}
/** Un client du jeu réduit à son module réseau : bus et store du contrat, joueur immobile au volant en (x, z). */
function game(app, { name, token = null, x = O.x, z = O.z }) {
  disk.clear(); socks.length = 0; hellos.length = 0; halted = false;
  if (token) disk.set('mz.accounts.v1', JSON.stringify({ [`${location.host}|${name.toLowerCase()}`]: token }));
  const handlers = new Map(), events = [];
  const bus = {
    on(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
    emit(type, payload) { if (type !== 'store:change') events.push([type, payload]); for (const fn of [...(handlers.get(type) || [])]) fn(payload); },
  };
  // comme client/src/core/store.js : `me` est modifié en place
  const store = { me: { id: null, money: 0 }, mission: null, set(patch) { for (const k of Object.keys(patch)) { if (k === 'me') Object.assign(store.me, patch[k]); else store[k] = patch[k]; } bus.emit('store:change', patch); } };
  const player = { pos: { x, y: 0, z }, getNetState: () => ({ x: player.pos.x, y: 0, z: player.pos.z, yaw: 0, speed: 0, mode: 'vehicle', anim: 'sit', vehicleType: 'citadine', vehicleColor: null }) };
  const net = createNet({ bus, store, params: new URLSearchParams({ ws: app.wsUrl }), player });
  const pump = setInterval(() => net.update(0.03), 30);
  const g = {
    bus, store, net, events, player,
    of: (type, from = 0) => events.slice(from).filter((e) => e[0] === type).map((e) => e[1]),
    /** Coupure douce de la WebSocket (coupure horaire de Cloud Run, Wi-Fi) ; attend que le serveur l'ait vue. */
    async cut() {
      const n = app.game.stats().connections, mark = events.length;
      for (const s of socks) if (s.readyState <= 1) s.close();
      await until('départ vu par le serveur', () => app.game.stats().connections < n);
      return mark;
    },
    /** Attend l'accueil de la reconnexion automatique ; retourne les événements émis depuis `mark`. */
    async back(mark) {
      await until('connexion rétablie', () => events.slice(mark).some((e) => e[0] === 'toast' && e[1].text === 'Connexion rétablie.'));
      await sleep(40); // les messages qui suivent l'accueil (profil, journal)
      return events.slice(mark);
    },
    stop() { clearInterval(pump); halted = true; for (const s of [...socks].reverse()) refuse(s); },
  };
  games.push(g);
  bus.emit('intent:login', { name, room: 'essai-net' });
  return g;
}
const online = (g) => until('accueil', () => g.net.status === 'online' && g.store.me.id);
/** Bob (module réseau du client) et Léa (client de test) dans la même salle ; Léa lance un Chiche que Bob relève. */
async function dared(app, { stake, go }) {
  const bobTok = seedPlayer(app.store, { name: 'Bob', money: 5000 }).token, leaTok = seedPlayer(app.store, { name: 'Léa', money: 5000 }).token;
  const bob = game(app, { name: 'Bob', token: bobTok });
  await online(bob);
  const lea = await join(app, { name: 'Léa', room: 'essai-net', token: leaTok, city: CITY_ID });
  await place(app, lea, O.x + 3, O.z);
  await until('position de Bob connue du serveur', () => bob.events.length && app.game.stats().connections === 2);
  await sleep(150);
  const open = await lea.ask('dare', { stake }, 'dare');
  await until('Chiche reçu par Bob', () => bob.store.dare?.id === open.id);
  await insist('Bob inscrit', bob, 'intent:dareJoin', {}, () => bob.store.dare?.mine);
  if (go) { lea.send('dare_go', {}); await until('départ donné', () => bob.store.dare?.phase === 'run'); }
  return { bob, lea, id: open.id };
}

test('client net : coupure pendant un Chiche LANCÉ à mise => dare:end « lost » avec la mise, puis money:change −500 « chiche » (directive 9)', async () => {
  const app = await boot({ at: T0 });
  let lea = null;
  try {
    const d = await dared(app, { stake: 500, go: true }), { bob, id } = d;
    lea = d.lea;
    assert.equal(bob.store.me.money, 5000);
    const mark = await bob.cut();
    const won = await lea.next('dare_end');
    assert.deepEqual([won.winner?.name, won.pot, won.reason], ['Léa', 500, 'left'], 'côté serveur : forfait, la mise va à l’adversaire');
    const evs = await bob.back(mark), kinds = evs.map((e) => e[0]);
    const end = evs.find((e) => e[0] === 'dare:end')[1];
    assert.deepEqual(end, { id, winner: null, sec: 0, pot: 0, reason: 'lost', won: false, stake: 500 });
    const money = evs.filter((e) => e[0] === 'money:change').map((e) => e[1]);
    assert.deepEqual(money, [{ delta: -500, reason: 'chiche', balance: 4500 }], 'la perte de la mise est annoncée, une seule fois');
    assert.ok(kinds.indexOf('dare:end') < kinds.indexOf('money:change'), 'la fin du Chiche précède la variation d’argent');
    assert.equal(bob.store.me.money, 4500);
    assert.equal(bob.store.dare, null);
    // moitié serveur de multijoueur#1 : le fait « Léa gagne un Chiche » est dans la gazette du perdant à son retour
    assert.ok(bob.store.feed.some((e) => e.k === 'dare' && /Léa gagne un Chiche/.test(e.x || '')), JSON.stringify(bob.store.feed));
  } finally { await done(app, lea); }
});

test('client net : coupure avant le départ (Chiche ouvert) ou Chiche sans mise => aucune variation d’argent annoncée', async () => {
  const app = await boot({ at: T0 });
  let lea = null;
  try {
    // inscrit, départ pas encore donné : le serveur retire le joueur, le défi reste ouvert, rien n'est débité
    const a = await dared(app, { stake: 500, go: false });
    lea = a.lea;
    const mark = await a.bob.cut();
    const evs = await a.bob.back(mark);
    assert.deepEqual(evs.filter((e) => e[0] === 'dare:end' || e[0] === 'money:change'), []);
    assert.deepEqual([a.bob.store.dare.id, a.bob.store.dare.phase, a.bob.store.dare.mine], [a.id, 'open', false], 'le Chiche est toujours là, sans Bob');
    assert.equal(a.bob.store.me.money, 5000);
  } finally { await done(app, lea); }
  const app2 = await boot({ at: T0 });
  try {
    // course lancée sans mise : forfait, mais rien à annoncer au portefeuille
    const b = await dared(app2, { stake: 0, go: true });
    lea = b.lea;
    const mark = await b.bob.cut();
    const evs = await b.bob.back(mark);
    assert.deepEqual(evs.find((e) => e[0] === 'dare:end')[1], { id: b.id, winner: null, sec: 0, pot: 0, reason: 'lost', won: false, stake: 0 });
    assert.deepEqual(evs.filter((e) => e[0] === 'money:change'), []);
  } finally { await done(app2, lea); }
});

test('client net : le Chiche d’avant la coupure est clos même si un AUTRE Chiche occupe la salle au retour', async () => {
  const app = await boot({ at: T0 });
  let lea = null;
  try {
    const d = await dared(app, { stake: 0, go: false }), { bob, id } = d;
    lea = d.lea;
    const mark = await bob.cut();
    // Léa retire son défi et en relance un pendant que Bob est coupé
    lea.send('dare_leave', {}); await lea.next('dare_end');
    app.advance(30);
    const again = await lea.ask('dare', { stake: 0 }, 'dare');
    const evs = await bob.back(mark), kinds = evs.map((e) => e[0]);
    assert.equal(evs.find((e) => e[0] === 'dare:end')[1].id, id);
    assert.equal(evs.find((e) => e[0] === 'dare:state')[1].id, again.id);
    assert.ok(kinds.indexOf('dare:end') < kinds.indexOf('dare:state'), 'fin de l’ancien avant l’annonce du nouveau');
    assert.deepEqual([bob.store.dare.id, bob.store.dare.mine], [again.id, false]);
  } finally { await done(app, lea); }
});

test('client net : mission démarrée sans connexion => refusée tout de suite (« offline ») ; mission inconnue du serveur au retour => « lost »', async () => {
  const app = await boot({ at: T0 });
  try {
    const g = game(app, { name: 'Maya', token: seedPlayer(app.store, { name: 'Maya', money: 5000 }).token, x: M1.start.x, z: M1.start.z });
    await online(g);
    // (1) démarrée pendant la fenêtre de reconnexion : le serveur n'en saura jamais rien
    let mark = await g.cut();
    assert.equal(g.net.status, 'reconnecting');
    g.store.set({ mission: { id: M1.id, phase: 'active' } }); // comme missionRunner : store.mission puis l'intention
    g.bus.emit('intent:missionStart', { id: M1.id });
    assert.deepEqual(g.of('mission:result', mark), [], 'jamais dans le même tour : le gameplay n’a pas encore annoncé mission:start');
    await sleep(5);
    assert.deepEqual(g.of('mission:result', mark), [{ id: M1.id, ok: false, reward: 0, reason: 'Pas de connexion au serveur : mission non démarrée.', code: 'offline' }]);
    assert.deepEqual(g.of('toast', mark).filter((t) => /réessayez/.test(t.text)), [], 'la carte de fin le dit : pas de toast en double');
    g.store.set({ mission: null });
    await g.back(mark);

    // (2) mission connue du serveur : elle survit à la coupure, rien n'est annoncé
    g.store.set({ mission: { id: M1.id, phase: 'active' } });
    g.bus.emit('intent:missionStart', { id: M1.id });
    await sleep(60);
    mark = await g.cut();
    assert.deepEqual((await g.back(mark)).filter((e) => e[0] === 'mission:result'), []);

    // (3) le serveur a perdu la mission (redémarrage, session expirée) : close au retour, pas à l'arrivée
    g.bus.emit('intent:missionAbort', {}); // côté serveur seulement : le client, lui, la joue toujours
    await sleep(60);
    mark = await g.cut();
    assert.deepEqual((await g.back(mark)).filter((e) => e[0] === 'mission:result').map((e) => e[1]),
      [{ id: M1.id, ok: false, reward: 0, reason: 'Mission interrompue par une coupure.', code: 'lost' }]);

    // (4) mission en cours de validation (réussite partie avant la coupure) : laissée à sa réponse
    g.store.set({ mission: { id: M1.id, phase: 'reporting' } });
    mark = await g.cut();
    assert.deepEqual((await g.back(mark)).filter((e) => e[0] === 'mission:result'), []);
  } finally { await done(app); }
});

test('client net : stockage local inscriptible ou non, la reconnexion retrouve le MÊME compte (jeton gardé en mémoire)', async () => {
  const app = await boot({ at: T0 });
  try {
    diskFull = true;
    const g = game(app, { name: 'Nora' });
    await online(g);
    const id = g.net.id;
    assert.equal(disk.has('mz.accounts.v1'), false, 'le jeton n’a pas pu être écrit');
    assert.equal(hellos[0].token, undefined, 'premier hello : compte neuf');
    const mark = await g.cut();
    await g.back(mark);
    assert.equal(hellos.length, 2);
    assert.match(hellos[1].token, new RegExp(`^${id}\\.`), 'le second hello porte le jeton reçu au premier accueil');
    assert.equal(g.net.id, id, 'même compte après la coupure');
    // nouveau login (autre pseudo) : le jeton en mémoire ne suit pas
    g.bus.emit('intent:login', { name: 'Autre', room: 'essai-net' });
    await until('second login', () => hellos.length === 3);
    assert.equal(hellos[2].token, undefined);
  } finally { diskFull = false; await done(app); }
});

test('client net : poursuite en cours => l’avis de recherche est redit à la reconnexion (le contrôle qui suit est bien payé)', async () => {
  const app = await boot({ at: T0 });
  try {
    const g = game(app, { name: 'Rudy', token: seedPlayer(app.store, { name: 'Rudy', money: 100000 }).token });
    await online(g);
    // 'wanted' parti pendant la fenêtre de reconnexion : perdu, le serveur ne connaît pas la poursuite
    let mark = await g.cut();
    g.store.heat = { level: 3, wanted: true, since: 0 };
    g.bus.emit('intent:heat', { ev: 'wanted', k: 3 });
    await g.back(mark);
    await sleep(60);
    mark = g.events.length;
    g.bus.emit('intent:heat', { ev: 'bust', k: 3 });
    const paid = await until('amende', () => g.of('money:change', mark)[0]);
    assert.deepEqual([paid.delta, paid.reason, g.store.me.stats.fines], [-900, 'amende', 1]); // min(3 % de 100 000, 300 × 3 képis × niveau 1)
    // sans poursuite en cours, rien n'est redit : un contrôle isolé reste ignoré
    g.store.heat = { level: 0, wanted: false, since: 0 };
    mark = await g.cut();
    await g.back(mark);
    g.bus.emit('intent:heat', { ev: 'bust', k: 3 });
    await sleep(120);
    assert.deepEqual(g.of('money:change', mark), []);
  } finally { await done(app); }
});

test('client net : première connexion refusée « rate » (seau de hello de l’adresse vide) => le client attend son tour au lieu de basculer hors-ligne ; dit une seule fois', async () => {
  const app = await boot({ at: T0, helloBurst: 1 });
  let first = null;
  try {
    first = await join(app, { name: 'Premier', room: 'essai-net', city: CITY_ID }); // prend le seul jeton de l'adresse
    const g = game(app, { name: 'Tard' });
    const refused = () => g.of('net:error').filter((e) => e.op === 'hello' && e.code === 'rate').length;
    // trois refus : autant que les essais sans réponse qui valent « serveur injoignable »
    await until('trois refus', () => refused() >= 3, 12000);
    await sleep(60); // la fermeture 4003 du troisième est passée
    assert.deepEqual([g.net.status, g.net.offline, g.store.me.id], ['connecting', false, null], 'toujours en attente du serveur, aucune économie locale');
    app.advance(2); // un jeton revient
    await until('en ligne', () => g.net.status === 'online' && g.store.me.id, 12000);
    assert.notEqual(g.store.me.id, 'local');
    assert.deepEqual(g.of('net:status').map((e) => e.state), ['connecting', 'online']);
    const toasts = g.of('toast').map((t) => t.text);
    assert.deepEqual(toasts.filter((t) => /Trop de connexions/.test(t)).length, 1, 'un seul toast pour tous les refus : ' + JSON.stringify(toasts));
    assert.deepEqual(toasts.filter((t) => /hors-ligne/.test(t)), []);
    assert.ok(refused() >= 3 && hellos.length === refused() + 1, 'chaque refus a été suivi d’un nouvel essai');
  } finally { await done(app, first); }
});

test('client net : serveur muet à la première connexion => toujours le mode hors-ligne au troisième essai', async () => {
  const app = await boot({ at: T0 });
  const dead = { wsUrl: `ws://localhost:${app.port}/nulle-part` }; // le serveur répond, mais pas en WebSocket sur ce chemin
  try {
    const g = game(dead, { name: 'Seul' });
    await until('hors-ligne', () => g.net.status === 'offline' && g.store.me.id === 'local', 12000);
    assert.equal(g.net.offline, true);
    assert.deepEqual(g.of('toast').map((t) => t.text).filter((t) => /hors-ligne/.test(t)), ['Serveur injoignable : mode hors-ligne.']);
    assert.equal(socks.length, 3, 'trois essais, pas un de plus');
  } finally { await done(app); }
});

test('client net : poursuite finie sans cavale méritée (aucun intent:heat) => l’avis du serveur est levé ; la suivante est annoncée et paie SON amende', async () => {
  const app = await boot({ at: T0 });
  let lea = null;
  try {
    const g = game(app, { name: 'Rudy', token: seedPlayer(app.store, { name: 'Rudy', money: 100000 }).token });
    await online(g);
    lea = await join(app, { name: 'Léa', room: 'essai-net', city: CITY_ID });
    const wanted = (k) => { g.store.heat = { level: k, wanted: true, since: 0 }; g.bus.emit('intent:heat', { ev: 'wanted', k }); };
    /** Fin de poursuite comme gameplay/heat.js : heat:change (plus recherché) D'ABORD, puis l'intention quand il y en a une. */
    const over = (prev, why, intent) => {
      g.store.heat.wanted = false; g.store.heat.level = 0;
      g.bus.emit('heat:change', { level: 0, prev, why, wanted: false });
      if (intent) g.bus.emit('intent:heat', intent);
    };
    const announced = (k) => lea.next('chat', (m) => m.system && m.text.startsWith(`Avis de recherche : Rudy, ${k} képis`));

    // 3 képis, les képis lâchent au minuteur avec l'unité au pare-chocs : ni 'bust' ni 'escape' du gameplay
    wanted(3);
    await announced(3);
    over(3, 'escape', null);
    await sleep(80);
    // 4 min plus tard (l'ancien avis vaudrait encore 6 min) : nouvelle poursuite à 2 képis, puis contrôle
    app.advance(240);
    wanted(2);
    await announced(2);
    let mark = g.events.length;
    over(2, 'bust', { ev: 'bust', k: 2 });
    const paid = await until('amende', () => g.of('money:change', mark)[0]);
    assert.deepEqual([paid.delta, paid.reason], [-600, 'amende'], 'min(3 % de 100 000, 300 × 2 képis × niveau 1) : pas le plafond des 3 képis d’avant');
    assert.equal(g.store.me.stats.escapes || 0, 0, 'la fin non méritée n’a rien compté');

    // fin méritée : l'intention part après heat:change et reste la seule — la cavale est comptée
    app.advance(240);
    wanted(2);
    await announced(2);
    app.advance(10);
    over(2, 'escape', { ev: 'escape', k: 2, sec: 9, how: 'time' });
    await until('cavale comptée', () => g.store.me.stats.escapes === 1);
    assert.equal(g.store.me.stats.bestEscapeSec, 9);
  } finally { await done(app, lea); }
});

test('client net : feed:entry d’un record battu arrive tel que le serveur l’a écrit (k, id, n, m, p = id du détrôné, phrase avec élision)', async () => {
  const app = await boot({ at: T0 });
  let alice = null, lea = null;
  try {
    const g = game(app, { name: 'Bob', token: seedPlayer(app.store, { name: 'Bob', money: 5000 }).token });
    await online(g);
    alice = await join(app, { name: 'Alice', room: 'essai-net', city: CITY_ID });
    lea = await join(app, { name: 'Léa', room: 'essai-net', city: CITY_ID });
    /** Mission jouée de bout en bout par un client de test ; `slack` = secondes de plus que le trajet. */
    const play = async (c, slack) => {
      await place(app, c, TIMED.start.x, TIMED.start.z);
      c.send('mission_start', { id: TIMED.id }); await c.sync();
      const t0 = app.clock.t;
      for (const s of TIMED.steps) await drive(app, c, s.x, s.z);
      app.clock.t = t0 + (Math.max(TIMED.minDurationSec, (app.clock.t - t0) / 1000) + slack) * 1000;
      return c.ask('mission_complete', { id: TIMED.id, durationSec: 1 }, 'mission_result');
    };
    assert.equal((await play(alice, 60)).rank, 1);
    assert.equal((await play(lea, 20)).rank, 1);
    const e = await until('record battu reçu', () => g.of('feed:entry').map((p) => p.e).find((f) => f.k === 'record' && f.p));
    assert.deepEqual([e.k, e.id, e.n, e.m, e.p, e.pn], ['record', lea.welcome.id, 'Léa', TIMED.id, alice.welcome.id, 'Alice']);
    assert.match(e.x, /^Léa bat le record d'Alice sur « /);
    assert.ok(g.store.feed.includes(e), 'la même entrée est dans store.feed');
    assert.deepEqual(g.store.records.room[TIMED.id].v.id, lea.welcome.id);
  } finally { await done(app, alice, lea); }
});

test('client net : ARRÊT puis relance du serveur pendant un Chiche à mise, une course de taxi et une mission — rien de fantôme, rien de débité', async () => {
  const store = new MemoryStore();
  let app = await boot({ store, at: T0 }), lea = null;
  const port = app.port;
  const restart = async () => { await app.close(); await sleep(200); app = await boot({ store, at: T0, port }); };
  try {
    // ---- Chiche lancé, mise 500 : le serveur l'annule sans débit et le dit avant de fermer (reason 'restart')
    const d = await dared(app, { stake: 500, go: true }), bob = d.bob;
    lea = d.lea;
    let mark = bob.events.length;
    await restart();
    let evs = await bob.back(mark);
    assert.deepEqual(evs.filter((e) => e[0] === 'dare:end').map((e) => e[1]), [{ id: d.id, winner: null, sec: 0, pot: 0, reason: 'restart', won: false }], 'une seule fin, celle du serveur');
    assert.ok(evs.findIndex((e) => e[0] === 'dare:end') < evs.findIndex((e) => e[0] === 'net:status' && e[1].state === 'reconnecting'), 'annoncée AVANT la coupure');
    assert.deepEqual(evs.filter((e) => e[0] === 'money:change'), []);
    assert.deepEqual([bob.store.me.money, bob.store.dare], [5000, null]);
    assert.equal((await store.getPlayer(bob.net.id)).money, 5000);

    // ---- course de taxi en cours : oubliée par le serveur, annoncée perdue ; une nouvelle course repart ensuite
    const job = await insist('course acceptée', bob, 'intent:jobStart', { kind: 'taxi' }, () => bob.store.job);
    mark = bob.events.length;
    await restart();
    evs = await bob.back(mark);
    assert.deepEqual(evs.filter((e) => e[0] === 'job:lost').length, 1);
    assert.equal(bob.store.job, null);
    assert.notEqual((await insist('nouvelle course', bob, 'intent:jobStart', { kind: 'taxi' }, () => bob.store.job)).id, job.id);
    bob.bus.emit('intent:jobAbort', {});

    // ---- mission en cours : le serveur relancé ne la connaît plus, elle est close au retour
    bob.store.set({ mission: { id: M1.id, phase: 'active' } });
    bob.bus.emit('intent:missionStart', { id: M1.id });
    await sleep(80);
    mark = bob.events.length;
    await restart();
    evs = await bob.back(mark);
    assert.deepEqual(evs.filter((e) => e[0] === 'mission:result').map((e) => e[1]), [{ id: M1.id, ok: false, reward: 0, reason: 'Mission interrompue par une coupure.', code: 'lost' }]);
    assert.equal(bob.net.status, 'online');
  } finally { await done(app, lea); }
});

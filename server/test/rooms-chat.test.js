// Répartiteur de salles publiques (paris -> paris-2 -> …), serveur complet, filtre et débit du chat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, join, quit, seedPlayer, Client } from '../testkit.js';
import { MemoryStore } from '../store/memory.js';
import { PROPERTIES_BY_CITY } from '../../shared/properties.js';
import { roomInstance, instanceCode } from '../game.js';
import { filterText, hasProfanity } from '../chat-filter.js';
import { PROTOCOL_VERSION, MAX_PLAYERS_PER_ROOM, CLOSE } from '../../shared/protocol.js';

const crowd = (app, n, opts) => Promise.all(Array.from({ length: n }, (_, i) => join(app, { name: `J${i}`, ...opts })));

test('instances publiques : numéros reconnus, codes privés exclus', () => {
  assert.deepEqual(['paris', 'paris-2', 'paris-99', 'paris-1', 'paris-100', 'paris-02', 'toulouse-3', 'amis', 'paris2'].map((c) => roomInstance('paris', c)),
    [1, 2, 99, 0, 0, 0, 0, 0, 0]);
  assert.equal(roomInstance('toulouse', 'toulouse-3'), 3);
  assert.equal(instanceCode('paris', 1), 'paris');
  assert.equal(instanceCode('toulouse', 4), 'toulouse-4');
});

test('salle publique pleine : le 33e joueur part en paris-2, le suivant reprend la première place libre, instance vide nettoyée', async () => {
  const app = await boot({ helloBurst: 0 });
  try {
    const first = await crowd(app, MAX_PLAYERS_PER_ROOM, { room: 'paris', city: 'paris' });
    assert.ok(first.every((c) => c.welcome.room === 'paris'));
    const over = await join(app, { name: 'Trente3', room: 'paris', city: 'paris' });
    assert.equal(over.welcome.room, 'paris-2');
    assert.equal(over.welcome.players.length, 0, 'paris-2 est une salle à part');
    // client d'avant le multi-villes (ni ville ni salle propre) : même répartition
    const old = await join(app, { name: 'Ancien', room: 'paris' });
    assert.equal(old.welcome.room, 'paris-2');
    // une autre ville a sa propre salle publique
    const tls = await join(app, { name: 'Tom', room: 'toulouse', city: 'toulouse' });
    assert.equal(tls.welcome.room, 'toulouse');
    // une place se libère dans paris : le suivant y va (instance la plus basse d'abord)
    await quit(app, first[0]);
    const next = await join(app, { name: 'Suivant', room: 'paris', city: 'paris' });
    assert.equal(next.welcome.room, 'paris');
    // reconnexion qui redemande paris-2 (instance de son accueil) : replacé avec ses amis, pas dans paris
    await quit(app, first[1]);
    const back = await join(app, { name: 'Ancien', room: 'paris-2', token: old.welcome.token });
    assert.equal(await old.waitClose(), CLOSE.REPLACED);
    assert.equal(back.welcome.room, 'paris-2');
    // paris-2 qui se vide est retirée de la mémoire comme toute salle
    await quit(app, over); await quit(app, back);
    assert.equal(app.game.stats().players['paris-2'], undefined);
    // instance demandée mais vide : on ne laisse personne seul, il rejoint la première salle qui a de la place
    const lone = await join(app, { name: 'Seul', room: 'paris-2', city: 'paris' });
    assert.equal(lone.welcome.room, 'paris');
    // paris de nouveau pleine (30 du début + Suivant + Seul) : le suivant rouvre paris-2
    assert.equal(app.game.stats().players.paris, MAX_PLAYERS_PER_ROOM);
    const again = await join(app, { name: 'Encore', room: 'paris', city: 'paris' });
    assert.equal(again.welcome.room, 'paris-2');
    await Promise.all([...first.slice(2), tls, next, lone, again].map((c) => c.close()));
  } finally { await app.close(); }
});

test('instance où le joueur possède des biens : il y retourne même vide ; sans bien, première place libre', async () => {
  const app = await boot({ helloBurst: 0 });
  try {
    const prop = PROPERTIES_BY_CITY.paris[0];
    const owner = seedPlayer(app.store, { name: 'Proprio' });
    const other = seedPlayer(app.store, { name: 'Locataire' });
    for (const s of [owner, other]) { const p = await app.store.getPlayer(s.id); p.inst = { paris: 2 }; app.store.putPlayer(p); }
    app.store.putRoom({ code: 'paris-2', owners: { [prop.id]: { id: owner.id, name: 'Proprio' } }, members: {} });
    const a = await join(app, { name: 'Proprio', room: 'paris', city: 'paris', token: owner.token });
    assert.equal(a.welcome.room, 'paris-2', 'ses loyers courent en paris-2 : il y retourne');
    await quit(app, a);
    const b = await join(app, { name: 'Locataire', room: 'paris', city: 'paris', token: other.token });
    assert.equal(b.welcome.room, 'paris', 'dernière instance vide et sans bien : pas seul en paris-2');
    assert.equal((await app.store.getPlayer(other.id)).inst.paris, 1, 'instance retenue dans le profil');
    await b.close();
  } finally { await app.close(); }
});

test('salle privée pleine : refus room_full inchangé ; serveur complet : refus explicite server_full', async () => {
  const app = await boot({ helloBurst: 0, maxConnections: 2 });
  try {
    const a = await join(app, { name: 'A', room: 'paris', city: 'paris' });
    const b = await join(app, { name: 'B', room: 'paris', city: 'paris' });
    const c = new Client(app.wsUrl); await c.open();
    const e = await c.next('error');
    assert.deepEqual([e.op, e.code, e.fatal], ['hello', 'server_full', true]);
    assert.match(e.text, /Serveur complet/);
    assert.equal(await c.waitClose(), CLOSE.REJECTED);
    assert.equal(app.game.stats().connections, 2, 'la socket refusée n’entre pas dans les connexions');
    await a.close(); await b.close();
  } finally { await app.close(); }
});

test('filtre d’injures : FR + EN, accents et leet, sans faux positifs courants', () => {
  const f = (t) => filterText(t).text;
  assert.equal(f("t'es un CONNARD !"), "t'es un *** !");
  assert.equal(f('espèce d’ENCULÉ'), 'espèce ***'); // apostrophe typographique collée : un seul mot
  assert.equal(f('c0nn4rd va'), '*** va');
  assert.equal(f('f u c k you'), '*** *** *** *** you');
  assert.equal(f('fuuuuck'), '***');
  assert.equal(f('motherfucker!!!'), '***');
  assert.equal(f('nique ta mère'), '*** ta mère');
  assert.equal(f('t g'), '*** ***'); // suite entière de lettres isolées = injure
  // français courant : ni masqué ni compté comme écart (jurons d'exclamation, homographes)
  for (const ok of ['la dispute de la salopette', 'Scunthorpe', 'un fagot de bois', 'shiitake', 'la Concorde', 'pass the class', 'cul-de-sac', 'Connexion', 'computer',
    'Salut, désolé du retard', 'je suis en retard', 'désolé pour les retards', "c'est con ce feu rouge", 'pros and cons', 'Putain de bouchon', 'merde, raté',
    "la bitte d'amarrage", 'le TGV : t g v', 'le p d g de la boîte', 'c u l t u r e', 'mon cul !'])
    assert.equal(f(ok), ok, ok);
  // mots crus : masqués, mais sans écart ; insultes : écart
  assert.deepEqual(filterText('une tapette à mouches'), { text: 'une *** à mouches', hits: 1, strikes: 0 });
  assert.equal(filterText('espèce de connard').strikes, 1);
  assert.ok(hasProfanity('GrosConnard') && hasProfanity('xXfuckXx') && hasProfanity('Bite'));
  for (const ok of ['Connexion', 'Salopette', 'Alice', 'Dominique', 'Monique', 'Véronique', 'Unique', 'Technique', 'Scunthorpe', 'Merdeka', 'Dick'])
    assert.ok(!hasProfanity(ok), ok);
});

test('chat : injures masquées, message 100 % injurieux bloqué, répétition refusée, coupure après 3 écarts, débit lié au compte', async () => {
  const app = await boot({ helloBurst: 0 });
  try {
    const a = await join(app, { name: 'Alice', room: 'salon' });
    const w = await join(app, { name: 'Witness', room: 'salon' });
    const say = (text) => a.send('chat', { text });
    // français courant : diffusé tel quel, aucun écart (sinon le 3e message ci-dessous couperait le chat)
    say('Salut, désolé du retard');
    assert.equal((await w.next('chat')).text, 'Salut, désolé du retard');
    app.advance(5);
    say("c'est con ce feu rouge, putain");
    assert.equal((await w.next('chat')).text, "c'est con ce feu rouge, putain");
    app.advance(5);
    say('salut espèce de connard');
    assert.equal((await w.next('chat')).text, 'salut espèce de ***');
    assert.equal((await a.ask('chat', { text: 'fdp' }, 'error')).code, 'filtered');
    app.advance(5);
    // 3e message filtré en 2 min : chat coupé (le message lui-même, s'il a du contenu, part filtré)
    say('bon match bande de batards');
    assert.equal((await a.next('error')).code, 'muted');
    assert.equal((await w.next('chat')).text, 'bon match bande de ***');
    assert.equal((await a.ask('chat', { text: 'pardon' }, 'error')).code, 'muted');
    app.advance(121);
    say('pardon');
    assert.equal((await w.next('chat')).text, 'pardon');
    app.advance(5);
    assert.equal((await a.ask('chat', { text: 'PARDON' }, 'error')).code, 'repeat');
    // débit : 5 d'affilée, puis refus ; une reconnexion ne remet pas le seau à neuf
    app.advance(60);
    for (let i = 0; i < 5; i++) say('message ' + i);
    assert.equal((await a.ask('chat', { text: 'de trop' }, 'error')).code, 'rate');
    const a2 = await join(app, { name: 'Alice', room: 'salon', token: a.welcome.token });
    assert.equal((await a2.ask('chat', { text: 'encore' }, 'error')).code, 'rate');
    await a2.close(); await w.close();
  } finally { await app.close(); }
});

test('pseudo injurieux remplacé par un « JoueurNNNN » stable ; prénoms courants acceptés', async () => {
  const app = await boot({ helloBurst: 0 });
  try {
    const c = await join(app, { name: 'GrosConnard', room: 'salon' });
    assert.match(c.welcome.me.name, /^Joueur\d{4}$/);
    // le client renvoie son pseudo enregistré à chaque hello : même nom de remplacement à chaque connexion
    const c2 = await join(app, { name: 'GrosConnard', room: 'salon', token: c.welcome.token });
    assert.equal(c2.welcome.me.name, c.welcome.me.name);
    // compte au nom propre qui tente un pseudo injurieux : il garde son nom
    const ok = await join(app, { name: 'Connexion', room: 'salon' });
    assert.equal(ok.welcome.me.name, 'Connexion');
    const ok2 = await join(app, { name: 'Salope', room: 'salon', token: ok.welcome.token });
    assert.equal(ok2.welcome.me.name, 'Connexion');
    for (const n of ['Dominique', 'Monique', 'Véronique', 'Scunthorpe']) {
      const x = await join(app, { name: n, room: 'salon' });
      assert.equal(x.welcome.me.name, n);
      await x.close();
    }
    await c2.close(); await ok2.close();
  } finally { await app.close(); }
});

test('répartiteur : paris pleine, paris-2 vidée, paris-3 animée => le nouveau venu va en paris-3, pas seul en paris-2', async () => {
  const app = await boot({ helloBurst: 0 });
  try {
    const p1 = await crowd(app, MAX_PLAYERS_PER_ROOM, { room: 'paris', city: 'paris' });
    const p2 = await Promise.all(Array.from({ length: MAX_PLAYERS_PER_ROOM }, (_, i) => join(app, { name: `D${i}`, room: 'paris', city: 'paris' })));
    assert.ok(p2.every((c) => c.welcome.room === 'paris-2'));
    const p3 = await Promise.all(Array.from({ length: 16 }, (_, i) => join(app, { name: `T${i}`, room: 'paris', city: 'paris' })));
    assert.ok(p3.every((c) => c.welcome.room === 'paris-3'));
    for (const c of p2) await quit(app, c);
    assert.equal(app.game.stats().players['paris-2'], undefined, 'paris-2 vidée et libérée');
    const n = await join(app, { name: 'Nouveau', room: 'paris', city: 'paris' });
    assert.equal(n.welcome.room, 'paris-3');
    // paris-3 pleine à son tour : alors seulement on rouvre paris-2
    const fill = await Promise.all(Array.from({ length: MAX_PLAYERS_PER_ROOM - 17 }, (_, i) => join(app, { name: `F${i}`, room: 'paris', city: 'paris' })));
    assert.ok(fill.every((c) => c.welcome.room === 'paris-3'));
    const last = await join(app, { name: 'Dernier', room: 'paris', city: 'paris' });
    assert.equal(last.welcome.room, 'paris-2');
    await Promise.all([...p1, ...p3, n, ...fill, last].map((c) => c.close()));
  } finally { await app.close(); }
});

test('rafale de 150 hello simultanés pendant des lectures lentes du store : personne n’est refusé à tort', async () => {
  // store à latence artificielle (lecture Firestore) : toutes les arrivées tombent dans la même fenêtre
  class SlowStore extends MemoryStore {
    async getRoom(code) { await new Promise((r) => setTimeout(r, 30)); return super.getRoom(code); }
    async getPlayer(id) { await new Promise((r) => setTimeout(r, 30)); return super.getPlayer(id); }
  }
  const app = await boot({ store: new SlowStore(), helloBurst: 0 });
  try {
    const N = 150;
    const all = await Promise.all(Array.from({ length: N }, (_, i) => join(app, { name: `R${i}`, room: 'paris', city: 'paris' })));
    const per = {};
    for (const c of all) per[c.welcome.room] = (per[c.welcome.room] || 0) + 1;
    assert.deepEqual(per, { paris: 32, 'paris-2': 32, 'paris-3': 32, 'paris-4': 32, 'paris-5': 22 });
    assert.equal(app.game.stats().connections, N);
    await Promise.all(all.map((c) => c.close()));
  } finally { await app.close(); }
});

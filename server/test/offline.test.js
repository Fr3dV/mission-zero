// Repli hors-ligne (client/src/net/offline.js) : le « mini-serveur » local doit répondre comme server/game.js.
// Le module est chargé ici sous Node : ses imports « @shared/… » (importmap du navigateur) sont résolus par un
// crochet de chargement, et localStorage est remplacé par une table en mémoire. Chaque scénario est joué deux fois,
// par un vrai client WebSocket sur un serveur éphémère et par le repli, avec la même horloge et le même hasard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { boot, join, seedPlayer, sendState, place, drive } from '../testkit.js';
import { MemoryStore } from '../store/memory.js';
import * as eco from '../../shared/economy.js';
import * as jobs from '../../shared/jobs.js';
import { MISSIONS_BY_CITY } from '../../shared/missions.js';
import { ALL_PROPERTY_BY_ID } from '../../shared/properties.js';
import { VEHICLE_BY_ID } from '../../shared/catalog.js';
import { C, S, FEATS_OFFLINE } from '../../shared/protocol.js';

const SHARED = new URL('../../shared/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(
  `export function resolve(spec, ctx, next) { return next(spec.startsWith('@shared/') ? ${JSON.stringify(SHARED)} + spec.slice(8) : spec, ctx); }`,
));
// localStorage du navigateur : une table en mémoire, vidée entre deux tests
const disk = new Map();
globalThis.localStorage = { getItem: (k) => (disk.has(k) ? disk.get(k) : null), setItem: (k, v) => { disk.set(k, String(v)); }, removeItem: (k) => { disk.delete(k); } };
const { createOffline } = await import('../../client/src/net/offline.js');

const KEY = 'mz.offline.v1';
const HOUR = 3600 * 1000;
const T0 = Date.UTC(2026, 0, 15, 11, 0, 0); // jeudi 15 janvier 2026, midi à Paris : loin de la bascule de 4 h
const PARIS = MISSIONS_BY_CITY.paris;
const M1 = PARIS.find((m) => m.level === 1 && m.type !== 'photo' && !m.anyOrder && !m.intro);
const APPART = ALL_PROPERTY_BY_ID.appart_marais; // 500 Ƶ de loyer par heure
const O = jobs.SPOTS_BY_CITY.paris[0];
const lastStep = (m) => m.steps[m.steps.length - 1];
/** Hasard reproductible : la même suite pour le serveur et pour le repli. */
const dice = (...q) => { const list = [...q]; return () => (list.length ? list.shift() : 0.5); };

/** Repli hors-ligne piloté : horloge, position et état du joueur sont ceux du test ; les messages émis sont gardés. */
function local({ at = T0, rand = dice(), name = 'Solo', city = 'paris', profile = null } = {}) {
  if (profile) disk.set(KEY, JSON.stringify({ profile, owners: {} }));
  const me = { clock: at, pos: { x: 0, y: 0, z: 0 }, st: { mode: 'foot', vehicleType: null, speed: 0 }, msgs: [] };
  me.off = createOffline({ name, room: 'solo', city, emit: (m) => me.msgs.push(m), getPos: () => me.pos, getState: () => me.st, now: () => me.clock, rand });
  me.welcome = me.off.welcome();
  me.advance = (sec) => { me.clock += sec * 1000; };
  me.car = (typeId, speed = 15) => { me.st = typeId ? { mode: 'vehicle', vehicleType: typeId, speed } : { mode: 'foot', vehicleType: null, speed: 0 }; };
  me.put = (x, z) => { me.advance(2); me.pos.x = x; me.pos.z = z; me.off.update(0.016); }; // grand saut : compté comme une téléportation
  /** Roule tout droit de `m` mètres en `sec` secondes (une mesure par seconde, comme autant d'images). */
  me.roll = (m, sec) => { for (let i = 0; i < sec; i++) { me.advance(1); me.pos.x += m / sec; me.off.update(1); } };
  /** Roule jusqu'à (x, z) par pas plausibles (100 m par seconde au plus) : jamais une téléportation. */
  me.driveTo = (x, z) => {
    const fx = me.pos.x, fz = me.pos.z, n = Math.max(1, Math.ceil(Math.hypot(x - fx, z - fz) / 100));
    for (let i = 1; i <= n; i++) { me.advance(1); me.pos.x = fx + ((x - fx) * i) / n; me.pos.z = fz + ((z - fz) * i) / n; me.off.update(1); }
  };
  me.ask = (type, payload, reply) => { me.msgs.length = 0; assert.equal(me.off.send(type, payload), true, `${type} doit avoir un handler hors-ligne`); return reply ? me.msgs.find((m) => m.t === reply) : null; };
  me.saved = () => JSON.parse(disk.get(KEY)).profile;
  return me;
}
const rich = (money, edit) => { const p = eco.newProfile('local', 'Solo'); p.money = money; edit?.(p); return p; };

test('hors-ligne : accueil complet (capacités sans Chiche, journal, records personnels) ; fresh vrai puis faux', () => {
  disk.clear();
  const a = local();
  const w = a.welcome;
  assert.deepEqual(w.feat, FEATS_OFFLINE);
  assert.ok(!w.feat.includes('dare') && w.feat.includes('offline'));
  assert.equal(w.fresh, true, 'compte neuf : la fiche du matin s’ouvre');
  assert.equal(w.away, null);
  assert.deepEqual(w.feed, []);
  assert.deepEqual([w.dare, w.cavale, w.styleDay, w.mission], [null, null, null, null]);
  assert.deepEqual(w.best, {});
  assert.deepEqual(w.records, {});
  assert.equal(w.journal.list.length, 3);
  assert.equal(w.journal.list[0].kind, 'star');
  assert.ok(PARIS.some((m) => m.id === w.journal.star), 'mission vedette de la ville');
  assert.deepEqual(w.me.look, { h: 'std' });
  assert.deepEqual(w.me.carColors, {});
  assert.deepEqual(w.lb, [{ id: 'local', name: 'Solo', money: w.me.money, online: true, worth: eco.worth(a.saved(), {}), lvl: 1, st: 0, rec: 0 }]);
  a.off.dispose();
  // même journée : plus rien de neuf ; le lendemain, la fiche revient
  assert.equal(local({ at: T0 + HOUR }).welcome.fresh, false);
  assert.equal(local({ at: T0 + 24 * HOUR }).welcome.fresh, true);
});

test('hors-ligne : une course de taxi donne le même client, le même prix et le même pourboire que le serveur', async () => {
  disk.clear();
  const moods = [];
  for (const [r, hits, late] of [[0.1, 0, 0], [0.6, 0, 40], [0.75, 1, 0], [0.9, 2, 0]]) { // normal, pressé en retard, touriste, fragile secoué
    const app = await boot({ at: T0, rand: dice(r, 0.3) });
    try {
      const c = await join(app, { name: 'Taxi' });
      await place(app, c, O.x, O.z, { car: 'citadine' });
      const job = await c.ask('job_start', { kind: 'taxi' }, 'job');

      disk.clear();
      const a = local({ rand: dice(r, 0.3) });
      a.car('citadine'); a.put(O.x, O.z);
      const mine = a.ask(C.JOB_START, { kind: 'taxi' }, S.JOB);
      assert.ok(mine, 'course acceptée hors-ligne');
      moods.push(mine.mood);
      for (const k of ['kind', 'mood', 'to', 'fare', 'parSec', 'chain', 'taxi']) assert.deepEqual(mine[k], job[k], `job.${k} (tirage ${r})`);

      // arrivée refusée hors du rayon (course conservée), puis acceptée sur place après le même temps de trajet
      const wait = job.parSec + late;
      const off = job.to.r + 300; // hors du rayon d'arrivée, et assez loin pour que le retour soit une téléportation des deux côtés
      await place(app, c, job.to.x + off, job.to.z, { car: 'citadine' });
      a.put(job.to.x + off, job.to.z);
      const far = await c.ask('job_done', { id: job.id, hits }, 'job_result'), farMine = a.ask(C.JOB_DONE, { id: mine.id, hits }, S.JOB_RESULT);
      assert.equal(far.code, 'too_far');
      assert.deepEqual({ ...farMine, id: 0, t: 0 }, { ...far, id: 0, t: 0 });
      app.advance(wait - 4); a.advance(wait - 4); // place() et put() avancent chacun de 2 s, deux fois
      await place(app, c, job.to.x, job.to.z, { car: 'citadine' });
      a.put(job.to.x, job.to.z);
      const res = await c.ask('job_done', { id: job.id, hits }, 'job_result');
      const profile = await c.next('profile'), journal = await c.next('journal');
      const resMine = a.ask(C.JOB_DONE, { id: mine.id, hits }, S.JOB_RESULT);
      assert.equal(res.ok, true);
      for (const k of ['ok', 'fare', 'tip', 'chain', 'capped', 'total']) assert.deepEqual(resMine[k], res[k], `job_result.${k} (client ${job.mood})`);
      assert.equal(res.tip, jobs.tipFor(job.fare, job.mood, wait, job.parSec, hits), 'pourboire conforme à la formule');
      const p = a.msgs.find((m) => m.t === S.PROFILE), j = a.msgs.find((m) => m.t === S.JOURNAL);
      assert.deepEqual([p.delta, p.reason, p.me.money], [profile.delta, profile.reason, profile.me.money]);
      assert.equal(p.reason, 'course de taxi');
      for (const k of ['fares', 'fareBestChain', 'fareEarned', 'missionsDone']) assert.equal(p.me.stats[k], profile.me.stats[k], `stats.${k}`);
      assert.deepEqual(j.j.list, journal.j.list);
      assert.equal(a.ask(C.JOB_DONE, { id: mine.id, hits: 0 }, S.JOB_RESULT).code, 'no_job');
    } finally { await app.close(); }
  }
  assert.deepEqual(moods, ['normal', 'presse', 'touriste', 'fragile'], 'les quatre caractères de client sont passés');
});

test('hors-ligne : refus du taxi comme sur le serveur (à pied, activité inconnue, mission en cours) ; abandon', () => {
  disk.clear();
  const a = local();
  a.put(O.x, O.z);
  const refused = a.ask(C.JOB_START, { kind: 'taxi' }, S.JOB_RESULT);
  assert.deepEqual({ ok: refused.ok, id: refused.id, code: refused.code }, { ok: false, id: null, code: 'no_vehicle' });
  a.car('citadine');
  assert.equal(a.ask(C.JOB_START, { kind: 'velo' }, S.JOB_RESULT).code, 'bad_kind');
  a.ask(C.MISSION_START, { id: M1.id });
  assert.equal(a.ask(C.JOB_START, { kind: 'taxi' }, S.JOB_RESULT).code, 'busy');
  a.ask(C.MISSION_ABORT);
  const job = a.ask(C.JOB_START, { kind: 'taxi' }, S.JOB);
  assert.ok(job?.id);
  a.ask(C.JOB_ABORT);
  assert.equal(a.ask(C.JOB_DONE, { id: job.id, hits: 0 }, S.JOB_RESULT).code, 'no_job');
});

test('hors-ligne : mission réussie comme sur le serveur (durée, catégorie, record personnel, prime de première réussite, done)', async () => {
  disk.clear();
  const app = await boot({ at: T0 });
  try {
    const end = lastStep(M1), sec = M1.minDurationSec + 30;
    const c = await join(app, { name: 'Pilote' });
    const a = local();
    for (const round of [1, 2]) {
      // côté serveur le joueur ROULE du départ à l'arrivée : le serveur mesure le chemin, un temps sans trajet n'entre pas aux records
      await place(app, c, M1.start.x, M1.start.z);
      c.send('mission_start', { id: M1.id }); await c.sync();
      const t0 = app.clock.t;
      for (const st of M1.steps) await drive(app, c, st.x, st.z);
      // … et le repli mesure le même chemin dans update() : le joueur roule aussi, de son départ à l'arrivée
      a.put(M1.start.x, M1.start.z);
      a.ask(C.MISSION_START, { id: M1.id });
      const a0 = a.clock;
      for (const st of M1.steps) a.driveTo(st.x, st.z);
      const t = round === 1 ? sec : sec - 10; // second passage plus rapide : record personnel battu, plus de prime
      app.clock.t = t0 + t * 1000; a.clock = a0 + t * 1000;
      const res = await c.ask('mission_complete', { id: M1.id }, 'mission_result'), profile = await c.next('profile');
      const mine = a.ask(C.MISSION_COMPLETE, { id: M1.id, durationSec: 1 }, S.MISSION_RESULT);
      for (const k of ['id', 'ok', 'reward', 'sec', 'cls', 'best', 'pb', 'first', 'star', 'done']) assert.deepEqual(mine[k], res[k], `mission_result.${k} (passage ${round})`);
      assert.deepEqual([mine.rank, mine.prev, mine.roomBest], [0, null, null], 'seul en salle : pas de podium');
      assert.equal(mine.sec, t);
      assert.equal(mine.pb, true);
      assert.equal(mine.first > 0, round === 1);
      const p = a.msgs.find((m) => m.t === S.PROFILE);
      assert.deepEqual([p.delta, p.reason, p.me.money, p.me.cooldowns[M1.id] > 0], [profile.delta, 'mission', profile.me.money, true]);
      assert.ok(a.msgs.some((m) => m.t === S.JOURNAL), 'S.JOURNAL après la réussite');
      // délai de la mission écoulé avant le second passage, des deux côtés
      app.advance(M1.cooldownSec + 1); a.advance(M1.cooldownSec + 1);
    }
    assert.deepEqual(a.saved().best[M1.id], { v: sec - 10 });
    a.off.dispose();
    assert.deepEqual(local({ at: a.clock }).welcome.best, { [M1.id]: { v: sec - 10 } }, 'record personnel conservé et renvoyé à l’accueil');
    // au volant d'une voiture de sport pendant la mission : catégorie Sport, le record Ville ne bouge pas
    const b = local({ at: a.clock + (M1.cooldownSec + 1) * 1000 });
    b.put(M1.start.x, M1.start.z);
    b.ask(C.MISSION_START, { id: M1.id });
    const b0 = b.clock;
    b.car('lambo_aventador');
    for (const st of M1.steps) b.driveTo(st.x, st.z);
    b.clock = b0 + sec * 1000;
    const sport = b.ask(C.MISSION_COMPLETE, { id: M1.id }, S.MISSION_RESULT);
    assert.deepEqual([sport.cls, sport.pb, sport.best], ['s', true, null]);
    assert.deepEqual(b.saved().best[M1.id], { v: sec - 10, s: sec });
    // verrou de niveau et mission inconnue : mêmes refus
    const locked = PARIS.find((m) => m.level === 6);
    assert.equal(b.ask(C.MISSION_START, { id: locked.id }, S.MISSION_RESULT).code, 'locked');
    assert.equal(b.ask(C.MISSION_COMPLETE, { id: M1.id }, S.MISSION_RESULT).code, 'not_started');
  } finally { await app.close(); }
});

test('hors-ligne : relevé du matin (10 h d’absence => 2 500 Ƶ encaissables une fois) et défis du jour réclamés par C.CLAIM', () => {
  disk.clear();
  const a = local({ profile: rich(1_000_000) });
  assert.equal(a.ask(C.BUY_PROPERTY, { id: APPART.id }, S.PROFILE).delta, -APPART.price);
  a.off.dispose(); // fermeture : l'heure est notée pour le relevé de la prochaine visite
  const b = local({ at: T0 + 10 * HOUR });
  assert.deepEqual(b.welcome.away, { sec: 36000, rent: 2500, props: [{ id: APPART.id, name: APPART.name, rent: 2500 }] });
  assert.deepEqual(b.welcome.journal.away, b.welcome.away);
  const before = b.welcome.me.money;
  const paid = b.ask(C.CLAIM, { kind: 'away' }, S.PROFILE);
  assert.deepEqual([paid.delta, paid.reason, paid.me.money], [2500, 'loyers', before + 2500]);
  assert.equal(b.msgs.find((m) => m.t === S.JOURNAL).j.away, null);
  assert.equal(b.ask(C.CLAIM, { kind: 'away' }, S.ERROR).code, 'nothing');
  // 20 minutes plus tard : rien ; les loyers de la session elle-même ne sont pas repayés par le relevé
  b.off.dispose();
  assert.equal(local({ at: T0 + 10 * HOUR + 20 * 60 * 1000 }).welcome.away, null);
  // défis : pas encore réussi, réclamation inconnue
  assert.equal(b.ask(C.CLAIM, { kind: 'daily', id: 'd1' }, S.ERROR).code, 'not_ready');
  assert.equal(b.ask(C.CLAIM, { kind: 'cadeau' }, S.ERROR).code, 'bad_claim');
  // mission vedette du jour réussie : payée double, d1 encaissable une seule fois
  // (le trajet est roulé : la prime de mission vedette exige, comme un record, un chemin mesuré)
  const star = PARIS.find((m) => m.id === b.welcome.journal.star);
  b.put(star.start.x, star.start.z);
  b.ask(C.MISSION_START, { id: star.id });
  const b0 = b.clock;
  for (const st of star.steps) b.driveTo(st.x, st.z);
  b.clock = Math.max(b.clock, b0 + (star.minDurationSec + 30) * 1000);
  const done = b.ask(C.MISSION_COMPLETE, { id: star.id }, S.MISSION_RESULT);
  assert.equal(done.star, star.reward);
  const d1 = b.ask(C.CLAIM, { kind: 'daily', id: 'd1' }, S.PROFILE);
  assert.deepEqual([d1.delta, d1.reason], [b.welcome.journal.list[0].reward, 'défi du jour']);
  assert.equal(b.msgs.find((m) => m.t === S.JOURNAL).j.list[0].claimed, true);
  assert.equal(b.ask(C.CLAIM, { kind: 'daily', id: 'd1' }, S.ERROR).code, 'claimed');
});

test('hors-ligne : style rogné par la fenêtre et le chemin mesurés localement ; kilomètres du jour ; rien à pied ni à l’arrêt', () => {
  disk.clear();
  const report = { pts: 100000, combo: 100000, drift: 99, air: 99, near: 999, props: 999 };
  const a = local();
  a.car('citadine'); a.put(O.x, O.z);
  // à l'arrêt : moins de 50 m parcourus, rapport ignoré
  a.advance(5);
  assert.equal(a.ask(C.STYLE, report, S.PROFILE), undefined);
  // 100 m en 5 s : 100 000 points déclarés => 6 000 retenus (60 par mètre), comme sur le serveur
  a.clock = T0 + 60000; a.off.welcome();
  a.roll(100, 5);
  const p = a.ask(C.STYLE, report, S.PROFILE);
  assert.ok(p, 'rapport accepté');
  assert.equal(p.delta, undefined, 'aucun argent pour le style');
  assert.deepEqual([p.me.stats.bestCombo, p.me.stats.bestDrift, p.me.stats.bestAir, p.me.stats.nearMisses, p.me.stats.propsBroken], [6000, 5, 6, 10, 40]);
  assert.equal(a.saved().journal.day.c.style, 6000);
  assert.equal(p.me.stats.distance, 100, 'distance mesurée, reportée avant le rapport');
  // vitesse de pointe : min(déclarée 15, mesurée 20 m/s)
  assert.equal(a.saved().stats.topSpeed, 15);
  // une téléportation ne compte ni dans la distance ni dans le style
  a.put(O.x + 5000, O.z);
  a.advance(5);
  assert.equal(a.ask(C.STYLE, report, S.PROFILE), undefined);
  // à pied : ignoré, même après 100 m
  a.car(null); a.roll(100, 50);
  assert.equal(a.ask(C.STYLE, report, S.PROFILE), undefined);
  assert.equal(Math.round(a.saved().journal.day.c.km), 100, 'pas de sauvegarde au rythme des images');
  // le tick du journal (15 s) n'émet S.JOURNAL que si les kilomètres affichés ont changé ; le tick des loyers écrit la distance
  a.msgs.length = 0;
  a.off.update(15);
  const j = a.msgs.filter((m) => m.t === S.JOURNAL);
  const km = a.welcome.journal.list.find((e) => e.kind === 'km');
  assert.equal(j.length, km ? 1 : 0);
  if (km) assert.equal(j[0].j.list.find((e) => e.kind === 'km').have, 200);
  a.msgs.length = 0;
  a.off.update(15);
  assert.equal(a.msgs.filter((m) => m.t === S.JOURNAL).length, 0);
  a.off.update(60);
  assert.equal(Math.round(a.saved().stats.distance), 200);
});

test('hors-ligne : képis — contrôle sans avis de recherche ignoré, amende plafonnée, fuite de 3 s refusée, cavale comptée', () => {
  disk.clear();
  const a = local({ profile: rich(100000) });
  assert.equal(a.ask(C.HEAT, { ev: 'bust', k: 2 }, S.PROFILE), undefined);
  a.ask(C.HEAT, { ev: 'wanted', k: 2 });
  const fined = a.ask(C.HEAT, { ev: 'bust', k: 2 }, S.PROFILE);
  assert.deepEqual([fined.delta, fined.reason, fined.me.stats.fines], [-600, 'amende', 1]); // min(3 % de 100 000, 300 × 2 képis × niveau 1)
  assert.equal(a.ask(C.HEAT, { ev: 'bust', k: 2 }, S.PROFILE), undefined, 'un contrôle par poursuite');
  a.advance(120);
  a.ask(C.HEAT, { ev: 'wanted', k: 3 });
  a.advance(3);
  assert.equal(a.ask(C.HEAT, { ev: 'escape', k: 3, sec: 3, how: 'dist' }, S.PROFILE), undefined, 'fuite trop courte');
  a.ask(C.HEAT, { ev: 'wanted', k: 3 });
  a.advance(20);
  assert.equal(a.ask(C.HEAT, { ev: 'escape', k: 3, sec: 60, how: 'dist' }, S.PROFILE), undefined, 'durée déclarée au-delà de l’horloge');
  a.ask(C.HEAT, { ev: 'wanted', k: 3 });
  a.advance(20);
  const free = a.ask(C.HEAT, { ev: 'escape', k: 3, sec: 19.5, how: 'dist' }, S.PROFILE);
  assert.deepEqual([free.delta, free.me.stats.escapes, free.me.stats.bestEscapeSec], [undefined, 1, 19.5]);
  // amende jamais sous 0 Ƶ
  disk.clear();
  const b = local({ profile: rich(0) });
  b.ask(C.HEAT, { ev: 'wanted', k: 3 });
  const zero = b.ask(C.HEAT, { ev: 'bust', k: 3 }, S.PROFILE);
  assert.deepEqual([zero.me.money, zero.delta, zero.me.stats.fines], [0, undefined, 1]);
});

test('hors-ligne : Atelier (teinte à l’achat, peinture, klaxon verrouillé puis choisi) ; Chiche refusé ; émotes et chutes sans effet', () => {
  disk.clear();
  const a = local({ profile: rich(200000) });
  const tesla = 'tesla_model3';
  const bought = a.ask(C.BUY_CAR, { typeId: tesla, color: '#c1121f' }, S.PROFILE);
  assert.equal(bought.me.carColors[tesla], '#c1121f', 'teinte choisie à l’achat conservée');
  assert.equal(a.ask(C.PAINT_CAR, { typeId: tesla, color: '#c1121f' }, S.ERROR).code, 'same_color');
  assert.equal(a.ask(C.PAINT_CAR, { typeId: tesla, color: '#123456' }, S.ERROR).code, 'bad_color');
  assert.equal(a.ask(C.PAINT_CAR, { typeId: 'lambo_urus', color: '#c1121f' }, S.ERROR).code, 'not_owned');
  const stock = a.ask(C.PAINT_CAR, { typeId: 'citadine', color: VEHICLE_BY_ID.citadine.colors[1] }, S.PROFILE);
  assert.deepEqual([stock.delta, stock.reason, stock.me.carColors.citadine], [-eco.PAINT_STOCK_PRICE, 'peinture', VEHICLE_BY_ID.citadine.colors[1]]);
  assert.equal(a.ask(C.SET_LOOK, { horn: 'klaxon-inconnu' }, S.ERROR).code, 'unknown_horn');
  assert.equal(a.ask(C.SET_LOOK, { horn: 'pouet' }, S.ERROR).code, 'locked'); // niveau 2 requis
  a.off.dispose();
  // niveau 2 : le klaxon se débloque ; S.LOOK suit le changement
  disk.clear();
  const b = local({ profile: rich(5000, (p) => { p.stats.missionsDone = 4; }) });
  const look = b.ask(C.SET_LOOK, { horn: 'pouet' }, S.PROFILE);
  assert.deepEqual(look.me.look, { h: 'pouet' });
  assert.deepEqual(b.msgs.find((m) => m.t === S.LOOK), { t: S.LOOK, id: 'local', lvl: eco.levelOf(b.saved()), st: 0, look: { h: 'pouet' } });
  b.ask(C.SET_LOOK, { horn: 'pouet' });
  assert.equal(b.msgs.some((m) => m.t === S.LOOK), false, 'pas de S.LOOK sans changement');
  // Chiche : erreur explicite pour les quatre messages
  for (const op of [C.DARE, C.DARE_JOIN, C.DARE_GO, C.DARE_LEAVE]) {
    assert.deepEqual(b.ask(op, { stake: 0, id: 'd1' }, S.ERROR), { t: S.ERROR, op, code: 'offline', text: 'Les défis nécessitent une connexion.' });
  }
  // klaxon, bulles et chutes : acceptés, sans réponse
  for (const [op, payload] of [[C.EMOTE, { k: 0 }], [C.EMOTE, { k: 3 }], [C.BUMP, { by: 'p0123' }]]) { b.ask(op, payload); assert.equal(b.msgs.length, 0); }
  assert.equal(b.ask(C.TRANSFER, { to: 'x', amount: 5 }, S.ERROR).code, 'offline');
  assert.equal(b.off.send('type_inconnu', {}), false);
});

test('hors-ligne : chaque message nouveau du protocole a son handler jumeau', () => {
  disk.clear();
  const a = local();
  const errors = [], error = console.error;
  console.error = (...args) => errors.push(args);
  for (const type of [C.PAINT_CAR, C.SET_LOOK, C.CLAIM, C.JOB_START, C.JOB_DONE, C.JOB_ABORT, C.DARE, C.DARE_JOIN, C.DARE_GO, C.DARE_LEAVE, C.EMOTE, C.BUMP, C.HEAT, C.STYLE]) {
    for (const payload of [{}, { id: null, kind: 7, k: 'x', by: {}, ev: [], typeId: {}, color: 3, horn: [] }, undefined]) {
      assert.equal(a.off.send(type, payload), true, `${type} accepté sans exception`);
    }
  }
  console.error = error;
  assert.deepEqual(errors, [], 'aucune exception dans un handler');
});

// ---------------------------------------------------------------- corrections de la relecture v6 (jumeaux du serveur)

test('hors-ligne : défis réussis non réclamés avant 4 h => crédités dès l’accueil du lendemain (motif « défis de la veille »), série avancée', async () => {
  const J = await import('../../shared/journal.js'), CORE = await import('../../shared/content-core.js');
  disk.clear();
  const p = rich(0, (q) => {
    const st = J.dailyState(q, T0), c = q.journal.day.c;
    for (const e of st.list) {
      if (e.kind === 'star') c.star = 1; else if (e.kind === 'missions') c.m = e.goal; else if (e.kind === 'fares') c.fares = e.goal;
      else if (e.kind === 'types') c.types = Object.keys(CORE.MISSION_TYPES).slice(0, e.goal); else c[e.kind] = e.goal;
    }
  });
  const a = local({ at: T0, profile: p });
  assert.equal(a.welcome.journal.full.ready, true);
  a.off.dispose(); // rien réclamé
  const b = local({ at: T0 + 20 * HOUR });
  assert.deepEqual([b.welcome.fresh, b.welcome.me.money, b.welcome.journal.streak], [true, 0, { n: 1, best: 1 }]);
  b.msgs.length = 0;
  b.advance(0.016); b.off.update(0.016); // première image après l'accueil : comme le serveur, qui crédite juste après S.WELCOME
  const paid = b.msgs.find((m) => m.t === S.PROFILE);
  const due = 3 * J.DAILY_REWARD[0] + Math.round(1.5 * J.DAILY_REWARD[0] * 1.1);
  assert.deepEqual([paid.delta, paid.reason, paid.me.money, paid.me.stats.dailyDone], [due, 'défis de la veille', due, 3]);
  assert.deepEqual([b.saved().money, b.saved().journal.due], [due, 0]);
  b.msgs.length = 0;
  b.advance(15); b.off.update(15);
  assert.equal(b.msgs.find((m) => m.t === S.PROFILE && m.delta), undefined, 'payé une seule fois');
  b.off.dispose();
});

test('hors-ligne : le niveau redit au contrôle relève l’amende quand il a monté en cours de poursuite (comme le serveur)', () => {
  disk.clear();
  const a = local({ profile: rich(100000) });
  a.ask(C.HEAT, { ev: 'wanted', k: 2 });
  const fined = a.ask(C.HEAT, { ev: 'bust', k: 3 }, S.PROFILE);
  assert.equal(fined.delta, -900); // min(3 % de 100 000, 300 × 3 képis × niveau 1)
  a.off.dispose();
});

test('hors-ligne : une fuite de durée nulle lève l’avis sans rien compter — la poursuite suivante paie SON plafond (comme le serveur)', () => {
  disk.clear();
  const a = local({ profile: rich(100000) });
  a.ask(C.HEAT, { ev: 'wanted', k: 3 });
  a.ask(C.HEAT, { ev: 'escape', k: 2, sec: 0 }); // poursuite close sans cavale méritée (module réseau du client)
  assert.deepEqual(a.msgs, [], 'rien n’est compté ni annoncé');
  a.advance(240);
  a.ask(C.HEAT, { ev: 'wanted', k: 2 });
  const fined = a.ask(C.HEAT, { ev: 'bust', k: 2 }, S.PROFILE);
  assert.deepEqual([fined.delta, fined.me.stats.escapes || 0], [-600, 0]); // min(3 % de 100 000, 300 × 2 képis × niveau 1)
  a.off.dispose();
});

test('hors-ligne : records — une arrivée sans trajet mesuré est payée mais n’entre pas aux records (comme le serveur)', async () => {
  disk.clear();
  const app = await boot({ at: T0 });
  try {
    const end = lastStep(M1), sec = M1.minDurationSec + 30;
    // serveur : posé à l'arrivée sans avoir roulé
    const c = await join(app, { name: 'Sauteur' });
    await place(app, c, M1.start.x, M1.start.z);
    c.send('mission_start', { id: M1.id }); await c.sync();
    const t0 = app.clock.t;
    await place(app, c, end.x, end.z);
    app.clock.t = t0 + sec * 1000;
    const res = await c.ask('mission_complete', { id: M1.id }, 'mission_result');
    // repli : même saut
    const a = local();
    a.put(M1.start.x, M1.start.z);
    a.ask(C.MISSION_START, { id: M1.id });
    const a0 = a.clock;
    a.put(end.x, end.z);
    a.clock = a0 + sec * 1000;
    const mine = a.ask(C.MISSION_COMPLETE, { id: M1.id }, S.MISSION_RESULT);
    for (const k of ['ok', 'reward', 'sec', 'cls', 'best', 'pb', 'first', 'star', 'done']) assert.deepEqual(mine[k], res[k], `mission_result.${k}`);
    assert.deepEqual([mine.ok, mine.reward, mine.pb, mine.first], [true, M1.reward, false, 0], 'gain de base payé, ni record ni prime');
    assert.equal(a.saved().best[M1.id], undefined);
    assert.ok(eco.recordFloorMoved(M1.id) > 0);
    a.off.dispose();
  } finally { await app.close(); }
});

test('hors-ligne : l’argent s’écrit « Ƶ 1 234 » (directive 14), dans fmt comme dans les refus', () => {
  disk.clear();
  const a = local({ profile: rich(100) });
  assert.equal(a.off.fmt(1234), 'Ƶ\u00a01\u202f234');
  const car = Object.values(VEHICLE_BY_ID).find((v) => v.price > 100);
  const err = a.ask(C.BUY_CAR, { typeId: car.id }, S.ERROR);
  assert.match(err.text, /Ƶ\u00a0\d/, err.text);
  assert.doesNotMatch(err.text, /\d\sƵ/, err.text);
  a.off.dispose();
});

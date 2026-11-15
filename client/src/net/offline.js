// Repli hors-ligne : un « mini-serveur » local qui applique EXACTEMENT les règles du serveur (shared/economy.js,
// shared/journal.js, shared/jobs.js) et répond avec les mêmes messages de protocole. Profil et biens sauvegardés
// dans localStorage.
//
// Comme sur le serveur, le profil (argent, voitures, statistiques, cooldowns) est commun à toutes les villes, et
// les biens sont propres à la ville (là-bas : à la salle, qui appartient à une ville). Stockage :
//   mz.offline.v1                 { profile, owners }  — `owners` = biens de PARIS (format d'origine, inchangé)
//   mz.offline.v1.owners.<ville>  { propertyId: { id, name } } pour chaque autre ville
// Une version plus ancienne du jeu, encore ouverte dans un onglet, ne lit et n'écrit que la première clé :
// elle ne peut donc ni voir ni écraser les biens des autres villes.
//
// Contrat v6 : chaque message nouveau du protocole a ici son handler jumeau de celui de server/game.js (records
// personnels, carnet de bord, relevé du matin, taxi libre, style, képis, Atelier). Ce qui demande d'autres joueurs
// n'existe pas hors-ligne : le Chiche répond par une erreur explicite, émotes et chutes sont acceptées sans effet,
// la gazette est vide et il n'y a ni record de salle, ni combo du jour. Le serveur mesure le chemin parcouru dans
// les états reçus ; ici il est mesuré dans update() à partir de getPos(), sans allocation ni sauvegarde par image
// (distance du profil, fenêtre de style, et chemin de la mission en cours : la borne des records est la même).
import { C, S, PROTOCOL_VERSION, FEATS_OFFLINE, MAX_SPEED } from '@shared/protocol.js';
import * as eco from '@shared/economy.js';
import * as J from '@shared/journal.js';
import * as jobs from '@shared/jobs.js';
import { DEFAULT_CITY, sanitizeCity } from '@shared/cities.js';

const KEY = 'mz.offline.v1';
const RENT_INTERVAL_SEC = 60;
const JOURNAL_INTERVAL_SEC = 15; // S.JOURNAL pour les kilomètres : au plus toutes les 15 s
const DIST_FLUSH_M = 20; // la distance mesurée est reportée dans le profil par paquets
// mêmes valeurs que server/game.js
const HEAT_KEEP_MS = 10 * 60 * 1000;
const ESCAPE_MIN_SEC = 8, ESCAPE_MAX_SEC = 600, ESCAPE_SLACK_SEC = 2;
const DARE_OFFLINE = 'Les défis nécessitent une connexion.';
const fmt = eco.fmtMoney; // « Ƶ 1 234 », comme toutes les phrases du serveur

function read(key) { try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : null; } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage plein ou interdit */ } }

/**
 * @param {{name: string, room: string, city?: string, emit: (msg: object) => void,
 *   getPos?: () => ({x: number, z: number} | null), getState?: () => (object | null), now?: () => number, rand?: () => number}} opts
 *   emit reçoit des messages serveur { t, ... } ; getPos = position du joueur (objet vivant, lu à chaque image) ;
 *   getState = état réseau du joueur (contrat ctx.player.getNetState()), lu au plus une fois par seconde et à chaque
 *   opération ; now et rand = horloge (ms) et générateur [0, 1) remplaçables dans les tests.
 */
export function createOffline({ name, room, city: rawCity, emit, getPos = null, getState = null, now = Date.now, rand = Math.random }) {
  const city = sanitizeCity(rawCity);
  const paris = city === DEFAULT_CITY;
  const ownersKey = `${KEY}.owners.${city}`;
  const roomKey = `local:${city}`; // « salle » du carnet de bord (loyers d'absence) : une par ville, comme les biens
  const saved = read(KEY);
  const profile = eco.normalizeProfile(saved?.profile?.id === 'local' ? saved.profile : eco.newProfile('local', name));
  const owners = (paris ? saved?.owners && typeof saved.owners === 'object' && saved.owners : read(ownersKey)) || {};
  const session = { mission: null, job: null, jobLast: null };
  profile.name = name;
  for (const id of eco.ownedProperties(owners, 'local')) owners[id].name = name;
  let sinceRent = 0, sinceJournal = 0;
  // équivalents des états volatils d'une connexion du serveur
  let hasPos = false, lastX = 0, lastZ = 0, moveAt = 0; // dernière position mesurée
  let distAcc = 0; // mètres mesurés pas encore reportés dans le profil
  let styleAt = now(), styleMoved = 0; // fenêtre de style : début (dernier rapport accepté ou accueil) et chemin parcouru
  let spdAt = 0, spdD = 0; // fenêtre d'une seconde de la vitesse de pointe
  let heat = null; // avis de recherche { k, at }
  let journalDirty = false, statsDirty = false, daySent = '', kmSent = -1;

  function save() {
    if (paris) { write(KEY, { profile, owners }); return; }
    // autre ville : les biens de Paris rangés sous la clé principale sont relus et reportés tels quels
    write(KEY, { profile, owners: read(KEY)?.owners || {} });
    write(ownersKey, owners);
  }
  const me = () => eco.publicProfile(profile, eco.ownedProperties(owners, 'local'), city);
  const out = (t, payload) => emit({ t, ...payload });
  const board = () => [{ id: 'local', name: profile.name, money: profile.money, online: true, worth: eco.worth(profile, owners), lvl: eco.levelOf(profile), st: eco.starsOf(profile), rec: 0 }];
  const lb = () => out(S.LEADERBOARD, { list: board() });
  const sendProfile = (delta, reason) => out(S.PROFILE, delta ? { me: me(), delta, reason } : { me: me() });
  const sendLook = () => out(S.LOOK, { id: 'local', lvl: eco.levelOf(profile), st: eco.starsOf(profile), look: { h: profile.look?.h || eco.DEFAULT_HORN } });
  const pos = () => { const p = getPos ? getPos() : null; return p && Number.isFinite(p.x) && Number.isFinite(p.z) ? p : null; };
  const state = () => (getState ? getState() : null);
  const driving = (st) => (st && st.mode === 'vehicle' ? st.vehicleType || null : null); // modèle conduit, null à pied
  function settle(op, res) {
    if (!res.ok) { out(S.ERROR, { op, code: res.code, text: res.text }); return false; }
    save();
    statsDirty = false;
    sendProfile(res.delta, res.reason);
    if (res.delta) lb();
    return true;
  }

  // ---- carnet de bord
  function kmHave(j) { for (const e of j.list) if (e.kind === 'km') return e.have; return -1; }
  function noteJournal(j) { journalDirty = false; daySent = j.day; kmSent = kmHave(j); }
  const journalOf = (t) => J.publicJournal(profile, t, city, owners, roomKey);
  function sendJournal() {
    const j = journalOf(now());
    noteJournal(j);
    out(S.JOURNAL, { j });
  }
  /** Reporte dans le profil la distance mesurée depuis le dernier report (statistique et compteur du jour). */
  function flushDistance(t) {
    const d = distAcc;
    if (!(d > 0)) return;
    distAcc = 0;
    profile.stats.distance = (profile.stats.distance || 0) + d;
    J.count(profile, 'km', d, t);
    journalDirty = true; statsDirty = true;
  }
  /** Catégorie des records : au volant d'une voiture de sport pendant la mission, elle est classée Sport. */
  function noteSport(st) {
    const mission = session.mission;
    if (mission && !mission.sport && eco.classOf(driving(st)) === 's') mission.sport = true;
  }

  const jobRefused = (id, res) => out(S.JOB_RESULT, { ok: false, id, fare: 0, tip: 0, chain: 0, capped: false, code: res.code, reason: res.text });
  const noDare = (op) => () => out(S.ERROR, { op, code: 'offline', text: DARE_OFFLINE });

  const handlers = {
    [C.CHAT](m) { const text = eco.sanitizeChat(m.text); if (text) out(S.CHAT, { from: profile.name, id: 'local', text }); },
    [C.MISSION_START](m) { const id = String(m.id), r = eco.missionStart(profile, session, id, now(), city); if (!r.ok) out(S.MISSION_RESULT, { id, ok: false, reward: 0, code: r.code, reason: r.text }); },
    [C.MISSION_ABORT]() { eco.missionAbort(session); },
    [C.MISSION_COMPLETE](m) {
      const id = String(m.id), t = now();
      flushDistance(t);
      noteSport(state());
      // moved = chemin mesuré depuis mission_start (lu AVANT que missionComplete ne close la mission)
      const r = eco.missionComplete(profile, session, id, t, city, { pos: pos(), moved: session.mission?.moved });
      if (!r.ok) return out(S.MISSION_RESULT, { id, ok: false, reward: 0, code: r.code, reason: r.text });
      // seul en salle : ni podium, ni détenteur à détrôner (rank 0, prev et roomBest nuls) ; le record personnel suit
      out(S.MISSION_RESULT, { id, ok: true, reward: r.reward, sec: r.sec, cls: r.cls, best: r.best, pb: r.pb, rank: 0, prev: null, roomBest: null, first: r.first, star: r.star, done: r.done });
      settle(C.MISSION_COMPLETE, r);
      sendJournal();
      if (r.levelUp || r.starUp) sendLook();
    },
    [C.BUY_CAR](m) { settle(C.BUY_CAR, eco.buyCar(profile, String(m.typeId), m.color)); },
    [C.SET_ACTIVE_CAR](m) { settle(C.SET_ACTIVE_CAR, eco.setActiveCar(profile, String(m.typeId))); },
    [C.PAINT_CAR](m) { settle(C.PAINT_CAR, eco.paintCar(profile, String(m.typeId), m.color)); },
    [C.SET_LOOK](m) { const r = eco.setLook(profile, { horn: m.horn }); if (settle(C.SET_LOOK, r) && r.changed) sendLook(); },
    [C.BUY_PROPERTY](m) { if (settle(C.BUY_PROPERTY, eco.buyProperty(profile, owners, String(m.id), city))) out(S.OWNERS, { owners: { ...owners } }); },
    [C.SELL_PROPERTY](m) { if (settle(C.SELL_PROPERTY, eco.sellProperty(profile, owners, String(m.id), city))) out(S.OWNERS, { owners: { ...owners } }); },
    [C.TRANSFER]() { out(S.ERROR, { op: C.TRANSFER, code: 'offline', text: 'Les virements nécessitent une connexion au serveur.' }); },

    // ---------------- carnet de bord : défis du jour, journée complète, relevé du matin
    [C.CLAIM](m) {
      const t = now();
      flushDistance(t); // les kilomètres du jour sont à jour avant de juger un défi
      if (settle(C.CLAIM, eco.claim(profile, { kind: m.kind, id: m.id }, { now: t, roomKey, city }))) sendJournal();
    },

    // ---------------- taxi libre : même module que le serveur, position fournie par getPos()
    [C.JOB_START](m) {
      const res = jobs.jobStart(profile, session, { kind: m.kind, pos: pos(), city, now: now(), rand, vehicleType: driving(state()) });
      if (!res.ok) return jobRefused(null, res);
      out(S.JOB, res.job);
    },
    [C.JOB_DONE](m) {
      const id = m.id == null ? undefined : String(m.id).slice(0, 32);
      const res = jobs.jobComplete(profile, session, { pos: pos(), now: now(), hits: m.hits, id });
      if (!res.ok) return jobRefused(id ?? null, res);
      save();
      statsDirty = false;
      out(S.JOB_RESULT, { ok: true, id: res.id, fare: res.fare, tip: res.tip, chain: res.chain, capped: res.capped, total: res.total });
      sendProfile(res.delta, res.reason);
      if (res.delta) lb();
      sendJournal();
    },
    [C.JOB_ABORT]() { jobs.jobAbort(session); },

    // ---------------- Chiche : il faut des adversaires, donc une connexion
    [C.DARE]: noDare(C.DARE),
    [C.DARE_JOIN]: noDare(C.DARE_JOIN),
    [C.DARE_GO]: noDare(C.DARE_GO),
    [C.DARE_LEAVE]: noDare(C.DARE_LEAVE),

    // ---------------- style, képis : mêmes règles que le serveur (fenêtre, rognage, amende) ; ni salle ni annonce
    [C.STYLE](m) {
      const t = now();
      flushDistance(t);
      const res = eco.styleReport(profile, m, { winSec: (t - styleAt) / 1000, movedM: styleMoved, inVehicle: !!driving(state()), now: t });
      if (!res.ok) return; // à pied, ou moins de 50 m parcourus : ignoré
      styleAt = t; styleMoved = 0;
      save();
      statsDirty = false;
      sendProfile();
      sendJournal();
    },
    [C.HEAT](m) {
      const t = now(), h = heat;
      if (m.ev === 'wanted') {
        const k = m.k === 3 ? 3 : 2;
        if (h && t - h.at < HEAT_KEEP_MS) { if (k > h.k) h.k = k; return; } // même poursuite
        heat = { k, at: t };
        return;
      }
      if ((m.ev !== 'bust' && m.ev !== 'escape') || !h) return; // sans avis de recherche : ignoré
      heat = null;
      if (t - h.at >= HEAT_KEEP_MS) return;
      if (m.ev === 'bust') {
        // comme le serveur : le niveau redit au contrôle compte s'il a monté en cours de poursuite
        const res = eco.fine(profile, Math.max(h.k, m.k === 3 ? 3 : 2), t); // compte lui-même stats.fines
        if (res.ok) settle(C.HEAT, res);
        return;
      }
      // fuite réussie : durée déclarée bornée par l'horloge locale ; aucun argent
      const sec = Math.round(+m.sec * 10) / 10;
      if (!(sec >= ESCAPE_MIN_SEC) || sec > ESCAPE_MAX_SEC || sec > (t - h.at) / 1000 + ESCAPE_SLACK_SEC) return;
      const stats = profile.stats;
      stats.escapes = (stats.escapes || 0) + 1;
      stats.bestEscapeSec = stats.bestEscapeSec > 0 ? Math.min(stats.bestEscapeSec, sec) : sec; // 0 = aucune cavale
      save();
      statsDirty = false;
      sendProfile();
    },
    // ---------------- klaxon, bulles, chutes : personne à qui les relayer
    [C.EMOTE]() {},
    [C.BUMP]() {},
  };

  /** Chemin parcouru et vitesse de pointe, mesurés comme le serveur le fait dans les états (téléportations exclues). */
  function track() {
    const p = getPos ? getPos() : null;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
    const t = now();
    if (hasPos) {
      const d = Math.hypot(p.x - lastX, p.z - lastZ), dt = Math.max(0, t - moveAt) / 1000;
      // au-delà de la vitesse plausible : réapparition, garage, GPS rapide — ne compte ni dans la distance ni dans la pointe
      if (d > MAX_SPEED * dt + 2) { spdAt = t; spdD = 0; }
      else {
        distAcc += d; styleMoved += d; spdD += d;
        // chemin de la mission en cours, comme le serveur le cumule dans les états : un temps sans trajet n'entre pas aux records
        const mission = session.mission;
        if (mission && mission.moved != null) mission.moved += d;
      }
    } else { spdAt = t; spdD = 0; }
    lastX = p.x; lastZ = p.z; moveAt = t; hasPos = true;
    if (t - spdAt >= 1000) {
      // une fois par seconde : catégorie Sport de la mission en cours et vitesse de pointe (au volant seulement)
      const st = state();
      noteSport(st);
      if (driving(st)) {
        const v = Math.min(Math.abs(+st.speed || 0), (spdD * 1000) / (t - spdAt));
        if (v > (profile.stats.topSpeed || 0)) { profile.stats.topSpeed = v; statsDirty = true; }
      }
      spdAt = t; spdD = 0;
    }
    if (distAcc >= DIST_FLUSH_M) flushDistance(t);
  }

  function accrue(seconds) {
    const t = now();
    const delta = eco.accrue(profile, owners, seconds, { now: t, roomKey });
    flushDistance(t);
    save();
    if (delta > 0) { sendProfile(delta, 'loyers'); lb(); }
    // distance et vitesse de pointe : écrites ici (et au départ), jamais au rythme des images
    else if (statsDirty) sendProfile();
    statsDirty = false;
  }
  /** S.JOURNAL pour les kilomètres et la bascule de 4 h : seulement si ce que le joueur voit a changé. */
  function tickJournal() {
    const t = now();
    flushDistance(t);
    // comme le serveur : à la bascule de 4 h la veille est soldée d'office (journal.rollDay), ses défis réussis mais
    // pas réclamés sont crédités ici (motif 'défis de la veille') — au premier tick après l'accueil pour un retour
    if (J.rollDay(profile, t)) journalDirty = true;
    if (profile.journal.due > 0 && settle(C.CLAIM, eco.settleDue(profile))) journalDirty = true;
    if (!journalDirty && daySent === J.dayKey(t)) return;
    const j = journalOf(t), km = kmHave(j);
    journalDirty = false;
    if (j.day === daySent && km === kmSent) return;
    noteJournal(j);
    out(S.JOURNAL, { j });
  }
  // fermeture de l'onglet : la distance est reportée et l'heure notée, pour le relevé du matin de la prochaine visite
  const onHide = () => { const t = now(); flushDistance(t); J.touchRent(profile, roomKey, t); save(); };
  if (typeof addEventListener === 'function') addEventListener('pagehide', onHide);

  return {
    /** Message de bienvenue (même forme que le serveur). */
    welcome() {
      const t = now();
      // carnet de bord : bascule de jour (compte neuf compris), puis relevé du matin calculé AVANT toute réécriture de rentAt
      const fresh = J.rollDay(profile, t);
      const away = J.awayRent(profile, owners, roomKey, t);
      styleAt = t; styleMoved = 0;
      // défis de la veille soldés à la bascule : crédités juste APRÈS l'accueil (à la première image), comme le serveur
      if (profile.journal.due > 0) sinceJournal = JOURNAL_INTERVAL_SEC;
      save();
      const journal = journalOf(t), best = {};
      noteJournal(journal);
      for (const id of Object.keys(profile.best)) if (eco.cityOfMission(id) === city) best[id] = profile.best[id];
      return {
        t: S.WELCOME, v: PROTOCOL_VERSION, id: 'local', room, city, ts: t, me: me(), players: [], owners: { ...owners }, lb: board(), mission: null,
        feat: FEATS_OFFLINE, fresh, best, records: {}, journal,
        away: away && away.added > 0 ? { sec: away.sec, rent: away.rent, props: away.props } : null,
        feed: [], dare: null, cavale: null, styleDay: null,
      };
    },
    send(type, payload = {}) { const h = Object.hasOwn(handlers, type) ? handlers[type] : null; if (!h) return false; try { h(payload || {}); } catch (e) { console.error('[net hors-ligne]', type, e); } return true; },
    update(dt) {
      track();
      sinceRent += dt; sinceJournal += dt;
      if (sinceRent >= RENT_INTERVAL_SEC) { accrue(sinceRent); sinceRent = 0; }
      if (sinceJournal >= JOURNAL_INTERVAL_SEC) { sinceJournal = 0; tickJournal(); }
    },
    dispose() { if (typeof removeEventListener === 'function') removeEventListener('pagehide', onHide); accrue(sinceRent); sinceRent = 0; },
    fmt,
  };
}

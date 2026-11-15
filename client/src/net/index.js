// Module réseau (contrat ctx.net) — PROPRIÉTAIRE : agent "serveur/réseau".
// - en ligne : WebSocket /ws, compte invité (jeton en localStorage), économie autoritaire côté serveur,
//   joueurs distants interpolés, reconnexion automatique ;
// - hors-ligne (serveur injoignable ou ?offline=1) : mêmes règles appliquées localement (shared/economy.js).
// Dans les deux cas le reste du jeu ne voit que le store et le bus (voir docs/ARCHITECTURE.md).
// Multi-villes : la ville courante (CITY_ID, ?city=) part dans le hello ; le serveur ne réunit que des joueurs de
// la même ville. Le compte (argent, voitures) est le même dans toutes les villes ; store.room reste le code saisi.
//
// Contrat v6 (boucle fun et rétention). Ce module écrit dans le store : feat (capacités du serveur), records
// { room: { missionId: { v?, s? } } (détenteurs { id, name, sec }), mine: { missionId: { v?, s? } } (secondes),
// top: { missionId: { v?, s? } } (podiums reçus en direct) }, journal (vue du carnet de bord), feed (gazette, 40 au
// plus), job (course de taxi en cours), dare (Chiche de la salle, horloge locale), styleDay, cavale, leaderboard,
// et lvl / st / look sur chaque entrée de store.players. Aucun message nouveau n'est envoyé à un serveur qui
// n'annonce pas la capacité correspondante dans welcome.feat (un serveur plus ancien compterait chaque type inconnu
// comme un message invalide).
import { C, S, CLOSE, PROTOCOL_VERSION, WS_PATH, CLIENT_SEND_HZ, DEFAULT_ROOM, encodeState, normColor } from '@shared/protocol.js';
import { sanitizeName, sanitizeRoom, createBucket } from '@shared/economy.js';
import { CITY_ID, CITIES, DEFAULT_CITY } from '@shared/cities.js';
import { createConnection } from './connection.js';
import { createOffline } from './offline.js';
import { createRemotes } from './remotes.js';

const ACCOUNTS_KEY = 'mz.accounts.v1'; // { "<hôte>|<pseudo>": jeton } — un compte invité par pseudo et par serveur
const FIRST_CONNECT_ATTEMPTS = 3; // échecs avant de basculer hors-ligne à la première connexion (un refus 'rate' n'en est pas un)
const IDLE_SEND_MS = 500; // état inchangé : envoi ralenti
const PING_MS = 2000;
const FEED_KEPT = 40; // entrées de gazette gardées dans store.feed (comme le serveur)
const PODIUM = 3;
const DEFAULT_HORN = 'std';
const UNAVAILABLE = 'Indisponible sur ce serveur.';
const NO_LINK = 'Pas de connexion au serveur : réessayez dans un instant.';
const NO_START = 'Pas de connexion au serveur : mission non démarrée.';
const MISSION_CUT = 'Mission interrompue par une coupure.';

function readAccounts() { try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || {}; } catch { return {}; } }
function writeAccounts(a) { try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(a)); } catch { /* stockage indisponible */ } }

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const safeId = (id) => typeof id === 'string' && id.length > 0 && id !== '__proto__';
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const whole = (v, max) => Math.max(0, Math.min(max, Math.floor(num(v))));
const isHolder = (e) => isObj(e) && Number.isFinite(e.sec);
const feedKey = (e) => `${e.t}|${e.k}|${e.id}`;
const cleanFeed = (list) => (Array.isArray(list) ? list.filter((e) => isObj(e) && typeof e.k === 'string') : []);
const freshRecords = () => ({ room: {}, mine: {}, top: {} });
/** Valeurs initiales du store dont ce module est l'écrivain (core/store.js ne les connaît pas). */
const freshStore = () => ({ feat: [], records: freshRecords(), journal: null, feed: [], job: null, dare: null, styleDay: null, cavale: null });

export function createNet(ctx) {
  const { bus, store, params } = ctx;
  // id -> { id, name, x, y, z, yaw, speed, mode, vehicleType, money (null tant que le classement ne l'a pas donné), lvl, st, look: { h } }
  const players = new Map(); // autres joueurs de la salle
  const remotes = createRemotes(ctx, players);
  store.players = players;
  store.set(freshStore());

  let login = null; // { name, room }
  let conn = null, offline = null;
  let welcomed = false; // un net:welcome a déjà été émis pour ce login
  // Jeton du compte gardé aussi en mémoire : si le stockage local ne peut pas être écrit (quota plein, données de site
  // bloquées), chaque reconnexion ouvrirait sinon un compte neuf en pleine partie.
  let memToken = null;
  let session = false; // hello accepté sur la connexion courante
  let misses = 0; // première connexion : essais restés sans réponse du serveur (les refus 'rate' ne comptent pas)
  let rateTold = false; // le refus 'rate' du hello a déjà été dit au joueur (une fois par attente, pas à chaque essai)
  let chased = false; // un avis de recherche est ouvert côté serveur : 'wanted' parti, ni contrôle ni fuite depuis
  let sendAcc = 0, lastSent = '', lastSentAt = 0, lastPingAt = 0, lastWarnAt = 0;
  const emoteBucket = createBucket(4, 1); // même débit que le seau du serveur : inutile d'envoyer ce qu'il ignorerait

  const net = {
    connected: false, offline: false, players, status: 'idle', ping: 0, id: null, city: CITY_ID,
    update,
    /** Envoi brut d'un message de protocole (outils de debug). */
    send: (type, payload) => transmit(type, payload),
    /** Le serveur courant annonce-t-il cette capacité ('fun1', 'taxi', 'dare', 'heat', 'paint', 'offline') ? */
    has: (cap) => has(cap),
  };

  const toast = (text, kind = 'info') => bus.emit('toast', { text, kind });
  function setStatus(state) {
    if (net.status === state) return;
    net.status = state;
    net.connected = state === 'online';
    bus.emit('net:status', { state });
  }
  const accountKey = () => `${location.host}|${login.name.toLowerCase()}`;
  const has = (cap) => Array.isArray(store.feat) && store.feat.includes(cap);
  const newPlayer = (p) => ({
    id: p.id, name: p.name, x: 0, y: 0, z: 0, yaw: 0, speed: 0, mode: 'foot', vehicleType: null, money: null,
    lvl: p.lvl || 1, st: p.st || 0, look: { h: p.look?.h || DEFAULT_HORN },
  });

  // ------------------------------------------------------------------ états du contrat v6

  /** Course de taxi perdue (coupure, session fermée) : le gameplay l'annonce, sans carte d'échec. */
  function loseJob() {
    if (!store.job) return;
    store.set({ job: null });
    bus.emit('job:lost', {});
  }
  /**
   * Chiche disparu sans S.DARE_END (reconnexion après sa fin, session fermée) : clos pour le reste du jeu par un
   * dare:end de raison 'lost' — jamais 'left', qui est l'annulation par le lanceur. S'il était lancé et que le joueur
   * y courait, la coupure a valu forfait côté serveur (aucune reprise). `stake` = mise PERDUE : celle du Chiche par
   * défaut (on ne saura rien de plus : session fermée, nouveau login), ou celle que l'appelant a constatée.
   */
  function loseDare(stake) {
    const d = store.dare;
    if (!d) return;
    store.set({ dare: null });
    bus.emit('dare:end', { id: d.id, winner: null, sec: 0, pot: 0, reason: 'lost', won: false, stake: stake ?? num(d.stake) });
  }
  /** Refus local d'une mission (même forme que S.MISSION_RESULT) : le gameplay la clôt par sa carte de fin. */
  const missionRefused = (id, code, reason) => bus.emit('mission:result', { id, ok: false, reward: 0, reason, code });
  /** État du Chiche reçu du serveur -> store.dare : les délais (ms restantes) deviennent des instants de performance.now(). */
  function dareState(d) {
    if (!isObj(d) || d.id == null) return null;
    const now = performance.now(), list = Array.isArray(d.players) ? d.players.filter(isObj) : [];
    return {
      id: d.id, by: isObj(d.by) ? d.by : null, origin: isObj(d.origin) ? d.origin : null, to: isObj(d.to) ? d.to : null, stake: num(d.stake),
      players: list, phase: d.phase === 'run' ? 'run' : 'open', startAt: now + num(d.startsIn), endAt: now + num(d.endsIn),
      mine: list.some((p) => p.id === net.id),
    };
  }
  /** Ligne d'une table de records (créée au besoin) ; null pour un id inutilisable comme clé. */
  const recRow = (table, id) => (safeId(id) ? (Object.hasOwn(table, id) ? table[id] : (table[id] = {})) : null);
  /** Gazette après une reconnexion : ce qu'on avait déjà, plus les faits manqués pendant la coupure. */
  function mergeFeed(old, missed) {
    const out = cleanFeed(old), seen = new Set(out.map(feedKey));
    for (const e of cleanFeed(missed)) if (!seen.has(feedKey(e))) out.push(e);
    out.sort((a, b) => num(a.t) - num(b.t));
    return out.slice(-FEED_KEPT);
  }

  // ------------------------------------------------------------------ messages du serveur (ou du mini-serveur hors-ligne)

  function applyLeaderboard(list) {
    if (!Array.isArray(list)) return;
    const rows = [];
    for (const r of list) {
      if (!isObj(r)) continue;
      const money = num(r.money);
      // un serveur d'avant le contrat v6 n'envoie ni fortune, ni niveau, ni records : la fortune vaut alors le solde
      rows.push({ id: r.id, name: r.name, money, online: !!r.online, worth: Number.isFinite(r.worth) ? r.worth : money, lvl: r.lvl || 1, st: r.st || 0, rec: r.rec || 0 });
      const p = players.get(r.id);
      if (p) p.money = money;
    }
    store.set({ leaderboard: rows });
  }

  const onServer = {
    [S.WELCOME](m) {
      // Un serveur d'avant le multi-villes ignore `city` et rangerait ce joueur dans une salle de Paris
      // (positions hors emprise, biens et missions d'une autre ville) : on préfère jouer hors-ligne.
      if (!net.offline && (m.city || DEFAULT_CITY) !== CITY_ID) {
        const text = `Le serveur ne propose pas encore ${CITIES[CITY_ID]?.name || CITY_ID} en ligne`;
        if (!welcomed) startOffline(`${text} : mode hors-ligne.`);
        else {
          // déjà en jeu avec un profil en ligne : on s'arrête là, sans basculer sur une économie locale
          conn?.close(); conn = null; session = false;
          clearRemotes();
          setStatus('offline');
          store.set({ online: false });
          loseJob(); loseDare();
          toast(`${text}.`, 'error');
        }
        return;
      }
      const reconnect = welcomed; // net:welcome n'est émis qu'une fois par login : net:return porte ce drapeau
      // état d'avant la coupure, lu avant que l'accueil ne le remplace (Chiche perdu de vue, solde, mission fantôme)
      const prevDare = store.dare, prevMoney = reconnect && isObj(store.me) ? num(store.me.money) : null;
      session = true; rateTold = false;
      net.id = m.id;
      // le serveur ne renvoie le jeton qu'à la création du compte : jamais effacé par un accueil qui n'en porte pas
      if (m.token) { memToken = m.token; const a = readAccounts(); a[accountKey()] = m.token; writeAccounts(a); }
      remotes.clear();
      players.clear();
      for (const p of m.players || []) if (isObj(p)) players.set(p.id, newPlayer(p));

      // contrat v6 : tout est optionnel (un serveur plus ancien n'envoie ni feat, ni records, ni journal)
      const records = freshRecords();
      if (isObj(m.records)) for (const id of Object.keys(m.records)) { const row = recRow(records.room, id); if (row && isObj(m.records[id])) Object.assign(row, m.records[id]); }
      if (isObj(m.best)) for (const id of Object.keys(m.best)) { const row = recRow(records.mine, id); if (row && isObj(m.best[id])) Object.assign(row, m.best[id]); }
      const journal = isObj(m.journal) ? m.journal : null;
      const missed = cleanFeed(m.feed);
      store.set({
        online: !net.offline, room: m.room, me: m.me, propertyOwners: m.owners || {}, players,
        feat: Array.isArray(m.feat) ? m.feat.filter((f) => typeof f === 'string') : [],
        records, journal, feed: reconnect ? mergeFeed(store.feed, missed) : missed.slice(-FEED_KEPT),
        styleDay: isObj(m.styleDay) ? m.styleDay : null, cavale: isObj(m.cavale) ? m.cavale : null,
      });
      applyLeaderboard(m.lb);
      conn?.established();
      lastSent = '';
      setStatus(net.offline ? 'offline' : 'online');
      if (!welcomed) { welcomed = true; bus.emit('net:welcome', { offline: net.offline }); }
      else toast('Connexion rétablie.', 'success');

      if (journal) bus.emit('journal:update', { j: journal });
      bus.emit('records:change', { id: null }); // toute la table vient d'être remplacée
      loseJob(); // une course de taxi ne survit pas à une coupure : le serveur l'a oubliée
      const dare = dareState(m.dare);
      // le Chiche d'avant la coupure n'est plus celui de la salle : clos d'abord, même si un autre l'a remplacé
      if (prevDare && (!dare || dare.id !== prevDare.id)) {
        // Forfait d'un Chiche à mise lancé : le serveur a débité le perdant pendant la coupure et le nouveau solde
        // n'arrive que par cet accueil. Seule une mise peut avoir fait BAISSER le solde hors connexion (loyers et
        // virements reçus le montent) : la baisse est annoncée, bornée à la mise, et rien d'autre ne l'est. Solde
        // intact = rien n'a été pris (aucun vainqueur, serveur tombé) : le Chiche est clos sans mise perdue.
        const raced = !!prevDare.mine && prevDare.phase === 'run', stake = raced ? num(prevDare.stake) : 0;
        const money = num(m.me?.money), drop = prevMoney == null ? 0 : prevMoney - money;
        const taken = stake > 0 && drop > 0;
        loseDare(raced && reconnect ? (taken ? stake : 0) : undefined);
        if (taken) bus.emit('money:change', { delta: -Math.min(stake, drop), reason: 'chiche', balance: money });
      }
      if (dare) { store.set({ dare }); bus.emit('dare:state', dare); }
      if (reconnect) {
        // Mission fantôme : le serveur ne connaît plus la mission que le joueur est en train de jouer (redémarrage du
        // serveur, session expirée). Elle est close tout de suite, pas à l'arrivée ; une mission déjà en cours de
        // validation est laissée à sa réponse (le serveur a pu la payer avant la coupure).
        const mine = store.mission;
        if (isObj(mine) && mine.id && mine.phase === 'active' && m.mission !== mine.id) missionRefused(mine.id, 'lost', MISSION_CUT);
        // Poursuite en cours : l'avis de recherche est redit (perdu s'il est parti pendant la coupure ou si le serveur
        // a redémarré ; ignoré par le serveur s'il connaît déjà cette poursuite).
        // Poursuite finie pendant la coupure (son dernier mot n'est jamais parti) : l'avis du serveur est levé.
        const heat = store.heat;
        if (isObj(heat) && heat.wanted) { if (has('heat') && transmit(C.HEAT, { ev: 'wanted', k: heat.level === 3 ? 3 : 2 })) chased = true; }
        else dropHeat();
      }

      // Retour du joueur : émis à CHAQUE welcome (premier login comme reconnexion après veille ou coupure). Le relevé
      // est celui que ce hello vient d'alimenter ; à l'ouverture du jeu, un relevé plus ancien resté sans encaissement
      // (journal.away) est rappelé aussi. À la reconnexion on ne le rappelle pas : il reste dans l'onglet Carnet.
      const pending = journal?.away;
      const away = isObj(m.away) && m.away.rent > 0 ? m.away : !reconnect && isObj(pending) && pending.rent > 0 ? pending : null;
      if (m.fresh || away || missed.length) bus.emit('net:return', { away, feed: missed, fresh: !!m.fresh, reconnect });
    },
    [S.PROFILE](m) {
      store.set({ me: m.me });
      if (m.delta) bus.emit('money:change', { delta: m.delta, reason: m.reason || '', balance: m.me.money });
    },
    [S.ERROR](m) {
      // Hello refusé pour débit ('rate', fermeture 4003) : la connexion réessaie d'elle-même et serait refusée de
      // nouveau tant que le seau de l'adresse est vide — le joueur le lit une fois, pas à chaque essai.
      const rate = m.op === C.HELLO && m.code === 'rate';
      if (!rate || !rateTold) toast(m.text || 'Opération refusée.', 'error');
      if (rate) rateTold = true;
      bus.emit('net:error', { op: m.op || null, code: m.code || null, text: m.text || '' });
    },
    [S.SNAPSHOT](m) { remotes.onSnapshot(m, net.id); },
    [S.JOIN](m) {
      const known = players.get(m.id);
      if (known) {
        known.name = m.name;
        if (m.lvl) known.lvl = m.lvl;
        if (m.st != null) known.st = m.st || 0;
        if (m.look?.h) known.look = { h: m.look.h };
      } else players.set(m.id, newPlayer(m));
      store.set({ players });
      bus.emit('net:playerJoin', { id: m.id, name: m.name });
    },
    [S.LEAVE](m) {
      const name = players.get(m.id)?.name || m.name;
      players.delete(m.id);
      remotes.remove(m.id);
      store.set({ players });
      bus.emit('net:playerLeave', { id: m.id, name });
    },
    [S.CHAT](m) { bus.emit('chat:message', { from: m.from, text: m.text, system: !!m.system, id: m.id || null }); },
    [S.MISSION_RESULT](m) {
      const ok = !!m.ok;
      if (ok && (m.cls === 'v' || m.cls === 's')) {
        // records à jour AVANT mission:result : le gameplay et l'interface lisent store.records en bâtissant la carte de fin
        const R = store.records;
        let changed = false;
        if (m.pb && Number.isFinite(m.sec)) { const row = recRow(R.mine, m.id); if (row) { row[m.cls] = m.sec; changed = true; } }
        if (isHolder(m.roomBest)) {
          const row = recRow(R.room, m.id), cur = row?.[m.cls];
          if (row && (!cur || cur.id !== m.roomBest.id || cur.sec !== m.roomBest.sec)) { row[m.cls] = m.roomBest; changed = true; }
        }
        if (changed) bus.emit('records:change', { id: m.id });
      }
      bus.emit('mission:result', {
        id: m.id, ok, reward: m.reward || 0, reason: m.reason || '', code: m.code || null,
        sec: Number.isFinite(m.sec) ? m.sec : null, cls: m.cls || null, best: Number.isFinite(m.best) ? m.best : null, pb: !!m.pb, rank: m.rank || 0,
        prev: isHolder(m.prev) ? m.prev : null, roomBest: isHolder(m.roomBest) ? m.roomBest : null,
        first: m.first || 0, star: m.star || 0, done: Number.isFinite(m.done) ? m.done : null,
      });
    },
    [S.OWNERS](m) { store.set({ propertyOwners: m.owners || {} }); },
    [S.LEADERBOARD](m) { applyLeaderboard(m.list); },
    [S.PONG](m) { if (typeof m.c === 'number') net.ping = Math.max(0, Math.round(performance.now() - m.c)); },

    // ---- contrat v6
    [S.LOOK](m) {
      // niveau, étoiles de Légende ou klaxon d'un joueur : l'étiquette et le klaxon des autres suivent (le sien est dans store.me)
      const p = players.get(m.id);
      if (p) {
        if (Number.isFinite(m.lvl)) p.lvl = m.lvl;
        if (Number.isFinite(m.st)) p.st = m.st;
        if (typeof m.look?.h === 'string') p.look = { h: m.look.h };
      } else if (m.id !== net.id) return;
      bus.emit('net:look', { id: m.id });
    },
    [S.RECORDS](m) {
      const cls = m.cls === 's' ? 's' : 'v', R = store.records;
      const row = recRow(R.room, m.id), tops = recRow(R.top, m.id);
      if (!row || !tops || !Array.isArray(m.top)) return;
      const top = m.top.filter(isHolder).slice(0, PODIUM);
      if (top.length) row[cls] = top[0]; else delete row[cls];
      tops[cls] = top;
      bus.emit('records:change', { id: m.id });
    },
    [S.JOURNAL](m) {
      const j = isObj(m.j) ? m.j : null, prev = store.journal;
      const patch = { journal: j };
      // la journée a basculé (4 h, heure de Paris) : le combo du jour de la salle repart de zéro, comme sur le serveur
      const rolled = !!(j && prev && prev.day && j.day !== prev.day);
      if (rolled && store.styleDay) patch.styleDay = null;
      store.set(patch);
      bus.emit('journal:update', { j });
      // bascule vécue en session (onglet resté ouvert la nuit) : mêmes « Nouveaux défis du jour » qu'à un retour, en
      // bandeau seulement (reconnect : jamais de fiche modale au milieu de la conduite). Un rechargement ensuite ne
      // l'annoncerait plus (welcome.fresh est alors faux).
      if (rolled) bus.emit('net:return', { away: null, feed: [], fresh: true, reconnect: true });
    },
    [S.FEED](m) {
      const e = m.e;
      if (!isObj(e) || typeof e.k !== 'string') return;
      const feed = Array.isArray(store.feed) ? store.feed : [];
      // Le combo du jour n'a qu'une entrée par salle et par 10 min : battu entre-temps, il revient avec le MÊME
      // horodatage. On remplace alors l'entrée sur place, sans nouvelle annonce (pas de feed:entry).
      let added = true;
      if (e.k === 'style') {
        for (let i = feed.length - 1; i >= 0; i--) if (feed[i].k === 'style' && feed[i].t === e.t) { feed[i] = e; added = false; break; }
      }
      if (added) { feed.push(e); if (feed.length > FEED_KEPT) feed.splice(0, feed.length - FEED_KEPT); }
      const patch = { feed };
      if (e.k === 'style') patch.styleDay = { id: e.id, name: e.n, pts: num(e.d) };
      else if (e.k === 'cavale') patch.cavale = { id: e.id, name: e.n, sec: num(e.d) };
      store.set(patch);
      if (added) bus.emit('feed:entry', { e });
    },
    [S.JOB](m) {
      // course acceptée : startAt (horloge performance.now() locale) sert au compteur et à la jauge de pourboire
      const job = {
        id: m.id, kind: m.kind || 'taxi', mood: m.mood || 'normal', to: isObj(m.to) ? m.to : null, fare: num(m.fare), parSec: num(m.parSec),
        chain: m.chain || 1, taxi: !!m.taxi, startAt: performance.now(),
      };
      store.set({ job });
      bus.emit('job:start', job);
    },
    [S.JOB_RESULT](m) {
      const ok = !!m.ok, id = m.id ?? null, cur = store.job;
      // 'too_far' conserve la course ; un refus de prise en charge (id nul) ne touche pas à la course en cours
      if (cur && (ok || (id != null && id === cur.id && m.code !== 'too_far'))) store.set({ job: null });
      const fare = num(m.fare), tip = num(m.tip);
      bus.emit('job:result', { ok, id, fare, tip, chain: m.chain || 0, capped: !!m.capped, code: m.code || null, reason: m.reason || '', total: Number.isFinite(m.total) ? m.total : ok ? fare + tip : 0 });
    },
    [S.DARE](m) {
      const dare = dareState(m);
      if (!dare) return;
      store.set({ dare });
      bus.emit('dare:state', dare);
    },
    [S.DARE_END](m) {
      const winner = isObj(m.winner) ? m.winner : null;
      store.set({ dare: null });
      bus.emit('dare:end', { id: m.id, winner, sec: num(m.sec), pot: num(m.pot), reason: m.reason || null, won: !!winner && winner.id === net.id });
    },
    [S.EMOTE](m) {
      // klaxon (k = 0) ou bulle (1 à 4) d'un autre joueur ; la position vient de store.players (dernier instantané)
      const p = players.get(m.id), k = m.k;
      if (!p || !Number.isInteger(k) || k < 0 || k > 4) return;
      bus.emit('net:emote', { id: p.id, name: p.name, k, h: k === 0 ? m.h || p.look?.h || DEFAULT_HORN : null, x: p.x, z: p.z });
    },
  };
  function handle(m) { onServer[m.t]?.(m); }

  // ------------------------------------------------------------------ connexion

  function wsUrl() {
    const custom = params?.get?.('ws'); // ?ws=wss://autre-hôte/ws pour tester un serveur distant
    if (custom && /^wss?:\/\//.test(custom)) return custom;
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`;
  }

  function startOnline() {
    net.offline = false;
    misses = 0;
    setStatus('connecting');
    conn = createConnection({
      url: wsUrl(),
      onOpen() { conn.send(C.HELLO, { v: PROTOCOL_VERSION, name: login.name, room: login.room, city: CITY_ID, token: readAccounts()[accountKey()] || memToken || undefined }); },
      onMessage: handle,
      onDown({ fatal, code, attempts }) {
        const hadSession = session;
        session = false;
        if (!welcomed) {
          // Jamais connecté : après quelques essais (ou un refus net), on joue hors-ligne. Une fermeture 4003 n'est
          // pas un échec : le serveur est là et répond, c'est le seau de hello de cette adresse qui est vide (une
          // salle entière qui arrive derrière le même routeur ; un jeton revient toutes les 2 s). Basculer alors
          // sur l'économie locale serait sans retour : la connexion réessaie, de plus en plus espacée (backoff).
          if (fatal || (code !== CLOSE.FLOOD && ++misses >= FIRST_CONNECT_ATTEMPTS)) { startOffline(fatal ? null : 'Serveur injoignable : mode hors-ligne.'); return false; }
          return true;
        }
        if (fatal) {
          // compte ouvert dans un autre onglet (ou hello refusé) : on arrête là, sans basculer sur une économie locale
          setStatus('offline');
          store.set({ online: false });
          if (code !== CLOSE.REPLACED) toast('Connexion refusée par le serveur.', 'error');
          clearRemotes();
          loseJob(); loseDare(); // plus de session : rien de tout cela ne reviendra
          return false;
        }
        if (hadSession) toast('Connexion perdue, reconnexion…', 'error');
        setStatus('reconnecting');
        return true;
      },
    });
  }

  function clearRemotes() {
    remotes.clear();
    if (players.size) { players.clear(); store.set({ players }); }
  }

  function startOffline(reason) {
    conn?.close(); conn = null;
    net.offline = true;
    clearRemotes();
    offline = createOffline({
      name: login.name, room: login.room, city: CITY_ID, emit: handle,
      getPos: () => ctx.player?.pos || null, // objet vivant du joueur : aucune allocation par image
      getState: () => ctx.player?.getNetState?.() || null,
    });
    if (reason) toast(reason, 'info');
    handle(offline.welcome());
  }

  function stop() {
    conn?.close(); conn = null;
    offline?.dispose(); offline = null;
    clearRemotes();
    welcomed = false; session = false; net.id = null; memToken = null; rateTold = false; chased = false;
    loseJob(); loseDare(); // nouveau login : course et Chiche de la session précédente sont clos pour le reste du jeu
    store.set(freshStore()); // … et rien d'autre ne doit en transparaître
  }

  /** Envoie une intention au serveur (ou au mini-serveur local). Retourne false si rien n'est joignable. */
  function transmit(type, payload) {
    if (offline) return offline.send(type, payload);
    if (conn && session && conn.send(type, payload)) return true;
    return false;
  }
  function warn(text) {
    const now = performance.now();
    if (now - lastWarnAt > 3000) { lastWarnAt = now; toast(text, 'error'); }
  }
  function request(type, payload) {
    if (transmit(type, payload)) return true;
    if (login) warn(NO_LINK);
    return false;
  }
  /**
   * Action du joueur soumise à une capacité du serveur (welcome.feat) : si elle manque, rien n'est envoyé et le
   * joueur lit « Indisponible sur ce serveur ». Sans session (reconnexion en cours), c'est le message de coupure.
   */
  function ask(cap, type, payload) {
    if ((session || offline) && !has(cap)) { warn(UNAVAILABLE); return false; }
    return request(type, payload);
  }
  /** Message d'ambiance (style, képis, klaxon, bulles, chutes) : silence si la capacité manque ou si rien n'est joignable. */
  const whisper = (cap, type, payload) => has(cap) && transmit(type, payload);
  /** Chiche : hors-ligne, la demande part quand même au mini-serveur local, qui répond par une erreur explicite. */
  const askDare = (type, payload) => (offline ? request(type, payload) : ask('dare', type, payload));
  const jobRefused = (code, reason) => bus.emit('job:result', { ok: false, id: null, fare: 0, tip: 0, chain: 0, capped: false, code, reason, total: 0 });

  // ------------------------------------------------------------------ intentions du jeu

  bus.on('intent:login', (p) => {
    stop();
    login = { name: sanitizeName(p?.name), room: sanitizeRoom(p?.room || DEFAULT_ROOM) };
    if (params?.get?.('offline') === '1' || typeof WebSocket === 'undefined') startOffline();
    else startOnline();
  });
  bus.on('intent:chat', (p) => { const text = String(p?.text ?? '').trim(); if (text) request(C.CHAT, { text }); });
  bus.on('intent:missionStart', (p) => {
    if (transmit(C.MISSION_START, { id: p?.id })) return;
    // Rien de joignable (reconnexion en cours) : le serveur ne saura jamais que cette mission a démarré. Elle est
    // refusée tout de suite — au tour suivant, car le gameplay émet cette intention AVANT d'annoncer mission:start.
    const id = p?.id;
    setTimeout(() => missionRefused(id, 'offline', NO_START), 0);
  });
  bus.on('intent:missionAbort', () => transmit(C.MISSION_ABORT));
  bus.on('intent:missionComplete', (p) => {
    if (transmit(C.MISSION_COMPLETE, { id: p?.id, durationSec: p?.durationSec })) return;
    bus.emit('mission:result', { id: p?.id, ok: false, reward: 0, reason: 'Pas de connexion au serveur : mission non validée.', code: 'offline' });
  });
  bus.on('intent:buyProperty', (p) => request(C.BUY_PROPERTY, { id: p?.id }));
  bus.on('intent:sellProperty', (p) => request(C.SELL_PROPERTY, { id: p?.id }));
  bus.on('intent:buyCar', (p) => {
    // la teinte choisie part avec l'achat (un serveur plus ancien ignore ce champ)
    const color = normColor(p?.color);
    request(C.BUY_CAR, color ? { typeId: p?.typeId, color } : { typeId: p?.typeId });
  });
  bus.on('intent:setActiveCar', (p) => request(C.SET_ACTIVE_CAR, { typeId: p?.typeId }));
  bus.on('intent:transfer', (p) => request(C.TRANSFER, { to: p?.toPlayerId, amount: Math.round(+p?.amount) }));

  // ---- contrat v6 : chaque message nouveau derrière sa capacité
  bus.on('intent:claim', (p) => ask('fun1', C.CLAIM, p?.id != null ? { kind: p?.kind, id: p.id } : { kind: p?.kind }));
  bus.on('intent:paintCar', (p) => ask('paint', C.PAINT_CAR, { typeId: p?.typeId, color: normColor(p?.color) || p?.color }));
  bus.on('intent:setLook', (p) => ask('fun1', C.SET_LOOK, { horn: p?.horn }));

  bus.on('intent:jobStart', (p) => {
    // un refus revient toujours par job:result, comme ceux du serveur (c'est le gameplay qui l'affiche)
    if ((session || offline) && !has('taxi')) return jobRefused('unavailable', UNAVAILABLE);
    if (!transmit(C.JOB_START, { kind: p?.kind || 'taxi' })) jobRefused('offline', NO_LINK);
  });
  bus.on('intent:jobDone', (p) => {
    if (!has('taxi')) return;
    if (transmit(C.JOB_DONE, { id: p?.id ?? store.job?.id, hits: whole(p?.hits, 5) })) return;
    loseJob(); // coupure en pleine course : le serveur l'a déjà oubliée
  });
  bus.on('intent:jobAbort', () => {
    if (has('taxi')) transmit(C.JOB_ABORT);
    if (store.job) store.set({ job: null }); // le serveur ne répond rien à un abandon
  });

  bus.on('intent:dare', (p) => askDare(C.DARE, { stake: whole(p?.stake, 1e9) }));
  bus.on('intent:dareJoin', (p) => askDare(C.DARE_JOIN, { id: p?.id ?? store.dare?.id }));
  bus.on('intent:dareGo', () => askDare(C.DARE_GO));
  bus.on('intent:dareLeave', () => askDare(C.DARE_LEAVE));

  bus.on('intent:style', (p) => {
    if (!p) return;
    whisper('fun1', C.STYLE, { pts: num(p.pts), combo: num(p.combo), drift: num(p.drift), air: num(p.air), near: num(p.near), props: num(p.props) });
  });
  bus.on('intent:heat', (p) => {
    if (!p || !has('heat')) return;
    const msg = { ev: p.ev, k: p.k === 3 ? 3 : 2 };
    if (p.sec != null) msg.sec = Math.round(num(p.sec) * 10) / 10;
    if (p.how) msg.how = p.how;
    if (transmit(C.HEAT, msg)) chased = p.ev === 'wanted';
  });
  /**
   * Poursuite close sans que le serveur l'ait su : son avis de recherche est levé par une fuite de durée nulle, qu'il
   * ne compte pas (ni statistique, ni record : sous la durée minimale d'une cavale). Sans cela l'avis resterait posé
   * dix minutes, et la poursuite SUIVANTE en hériterait : pas d'annonce à la salle, amende au niveau de l'ancienne.
   */
  function dropHeat() {
    if (chased && !store.heat?.wanted && has('heat') && transmit(C.HEAT, { ev: 'escape', k: 2, sec: 0 })) chased = false;
  }
  // Fin au minuteur non méritée (unité au pare-chocs) : le gameplay annonce la fin (heat:change) sans intent:heat
  // 'escape'. On regarde après coup — l'intention d'une fin méritée ou d'un contrôle part APRÈS heat:change.
  bus.on('heat:change', (p) => { if (chased && p && !p.wanted) queueMicrotask(dropHeat); });
  // klaxon et bulles express : relayés aux autres par le serveur (jamais renvoyés à l'émetteur)
  const emote = (k) => { if (has('fun1') && emoteBucket.take(performance.now())) transmit(C.EMOTE, { k }); };
  bus.on('player:horn', () => emote(0));
  bus.on('player:emote', (p) => { const k = p?.k; if (Number.isInteger(k) && k >= 1 && k <= 4) emote(k); });
  // renversé par la voiture d'un autre joueur : c'est la VICTIME qui le signale (remotes pose vehicle.driver = id du joueur)
  bus.on('player:knocked', (p) => {
    const by = p?.by?.driver;
    if (typeof by === 'string' && players.has(by)) whisper('fun1', C.BUMP, { by });
  });

  // ------------------------------------------------------------------ boucle

  function update(dt) {
    if (offline) { offline.update(dt); return; }
    if (!conn) return;
    conn.watchdog();
    if (session) {
      const now = performance.now();
      sendAcc += dt;
      if (sendAcc >= 1 / CLIENT_SEND_HZ) {
        sendAcc = Math.min(sendAcc - 1 / CLIENT_SEND_HZ, 1 / CLIENT_SEND_HZ);
        const st = ctx.player?.getNetState?.();
        if (st) {
          const s = encodeState(st), key = s.join();
          if (key !== lastSent || now - lastSentAt >= IDLE_SEND_MS) { conn.send(C.STATE, { s }); lastSent = key; lastSentAt = now; }
        }
      }
      if (now - lastPingAt >= PING_MS) { lastPingAt = now; conn.send(C.PING, { c: Math.round(now) }); }
    }
    remotes.update(dt);
  }

  return net;
}

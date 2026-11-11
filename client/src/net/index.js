// Module réseau (contrat ctx.net) — PROPRIÉTAIRE : agent "serveur/réseau".
// - en ligne : WebSocket /ws, compte invité (jeton en localStorage), économie autoritaire côté serveur,
//   joueurs distants interpolés, reconnexion automatique ;
// - hors-ligne (serveur injoignable ou ?offline=1) : mêmes règles appliquées localement (shared/economy.js).
// Dans les deux cas le reste du jeu ne voit que le store et le bus (voir docs/ARCHITECTURE.md).
// Multi-villes : la ville courante (CITY_ID, ?city=) part dans le hello ; le serveur ne réunit que des joueurs de
// la même ville. Le compte (argent, voitures) est le même dans toutes les villes ; store.room reste le code saisi.
import { C, S, CLOSE, PROTOCOL_VERSION, WS_PATH, CLIENT_SEND_HZ, DEFAULT_ROOM, encodeState } from '@shared/protocol.js';
import { sanitizeName, sanitizeRoom } from '@shared/economy.js';
import { CITY_ID, CITIES, DEFAULT_CITY } from '@shared/cities.js';
import { createConnection } from './connection.js';
import { createOffline } from './offline.js';
import { createRemotes } from './remotes.js';

const ACCOUNTS_KEY = 'mz.accounts.v1'; // { "<hôte>|<pseudo>": jeton } — un compte invité par pseudo et par serveur
const FIRST_CONNECT_ATTEMPTS = 3; // échecs avant de basculer hors-ligne à la première connexion
const IDLE_SEND_MS = 500; // état inchangé : envoi ralenti
const PING_MS = 2000;

function readAccounts() { try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || {}; } catch { return {}; } }
function writeAccounts(a) { try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(a)); } catch { /* stockage indisponible */ } }

export function createNet(ctx) {
  const { bus, store, params } = ctx;
  const players = new Map(); // id -> { id, name, x, y, z, yaw, speed, mode, vehicleType, money } (autres joueurs de la salle)
  const remotes = createRemotes(ctx, players);
  store.players = players;

  let login = null; // { name, room }
  let conn = null, offline = null;
  let welcomed = false; // un net:welcome a déjà été émis pour ce login
  let session = false; // hello accepté sur la connexion courante
  let sendAcc = 0, lastSent = '', lastSentAt = 0, lastPingAt = 0, lastWarnAt = 0;

  const net = {
    connected: false, offline: false, players, status: 'idle', ping: 0, id: null, city: CITY_ID,
    update,
    /** Envoi brut d'un message de protocole (outils de debug). */
    send: (type, payload) => transmit(type, payload),
  };

  const toast = (text, kind = 'info') => bus.emit('toast', { text, kind });
  function setStatus(state) {
    if (net.status === state) return;
    net.status = state;
    net.connected = state === 'online';
    bus.emit('net:status', { state });
  }
  const accountKey = () => `${location.host}|${login.name.toLowerCase()}`;

  // ------------------------------------------------------------------ messages du serveur (ou du mini-serveur hors-ligne)

  function applyLeaderboard(list) {
    if (!Array.isArray(list)) return;
    for (const r of list) { const p = players.get(r.id); if (p) p.money = r.money; }
    store.set({ leaderboard: list.map((r) => ({ id: r.id, name: r.name, money: r.money, online: !!r.online })) });
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
          toast(`${text}.`, 'error');
        }
        return;
      }
      session = true;
      net.id = m.id;
      if (m.token) { const a = readAccounts(); a[accountKey()] = m.token; writeAccounts(a); }
      remotes.clear();
      players.clear();
      for (const p of m.players || []) players.set(p.id, { id: p.id, name: p.name, x: 0, y: 0, z: 0, yaw: 0, speed: 0, mode: 'foot', vehicleType: null, money: 0 });
      store.set({ online: !net.offline, room: m.room, me: m.me, propertyOwners: m.owners || {}, players });
      applyLeaderboard(m.lb);
      conn?.established();
      lastSent = '';
      setStatus(net.offline ? 'offline' : 'online');
      if (!welcomed) { welcomed = true; bus.emit('net:welcome', { offline: net.offline }); }
      else toast('Connexion rétablie.', 'success');
    },
    [S.PROFILE](m) {
      store.set({ me: m.me });
      if (m.delta) bus.emit('money:change', { delta: m.delta, reason: m.reason || '', balance: m.me.money });
    },
    [S.ERROR](m) { toast(m.text || 'Opération refusée.', 'error'); },
    [S.SNAPSHOT](m) { remotes.onSnapshot(m, net.id); },
    [S.JOIN](m) {
      const known = players.get(m.id);
      if (known) known.name = m.name;
      else players.set(m.id, { id: m.id, name: m.name, x: 0, y: 0, z: 0, yaw: 0, speed: 0, mode: 'foot', vehicleType: null, money: 0 });
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
    [S.MISSION_RESULT](m) { bus.emit('mission:result', { id: m.id, ok: !!m.ok, reward: m.reward || 0, reason: m.reason || '' }); },
    [S.OWNERS](m) { store.set({ propertyOwners: m.owners || {} }); },
    [S.LEADERBOARD](m) { applyLeaderboard(m.list); },
    [S.PONG](m) { if (typeof m.c === 'number') net.ping = Math.max(0, Math.round(performance.now() - m.c)); },
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
    setStatus('connecting');
    conn = createConnection({
      url: wsUrl(),
      onOpen() { conn.send(C.HELLO, { v: PROTOCOL_VERSION, name: login.name, room: login.room, city: CITY_ID, token: readAccounts()[accountKey()] }); },
      onMessage: handle,
      onDown({ fatal, code, attempts }) {
        const hadSession = session;
        session = false;
        if (!welcomed) {
          // jamais connecté : après quelques essais (ou un refus net), on joue hors-ligne
          if (fatal || attempts >= FIRST_CONNECT_ATTEMPTS) { startOffline(fatal ? null : 'Serveur injoignable : mode hors-ligne.'); return false; }
          return true;
        }
        if (fatal) {
          // compte ouvert dans un autre onglet (ou hello refusé) : on arrête là, sans basculer sur une économie locale
          setStatus('offline');
          store.set({ online: false });
          if (code !== CLOSE.REPLACED) toast('Connexion refusée par le serveur.', 'error');
          clearRemotes();
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
    offline = createOffline({ name: login.name, room: login.room, city: CITY_ID, emit: handle });
    if (reason) toast(reason, 'info');
    handle(offline.welcome());
  }

  function stop() {
    conn?.close(); conn = null;
    offline?.dispose(); offline = null;
    clearRemotes();
    welcomed = false; session = false; net.id = null;
  }

  /** Envoie une intention au serveur (ou au mini-serveur local). Retourne false si rien n'est joignable. */
  function transmit(type, payload) {
    if (offline) return offline.send(type, payload);
    if (conn && session && conn.send(type, payload)) return true;
    return false;
  }
  function request(type, payload) {
    if (transmit(type, payload)) return;
    const now = performance.now();
    if (login && now - lastWarnAt > 3000) { lastWarnAt = now; toast('Pas de connexion au serveur : réessayez dans un instant.', 'error'); }
  }

  // ------------------------------------------------------------------ intentions du jeu

  bus.on('intent:login', (p) => {
    stop();
    login = { name: sanitizeName(p?.name), room: sanitizeRoom(p?.room || DEFAULT_ROOM) };
    if (params?.get?.('offline') === '1' || typeof WebSocket === 'undefined') startOffline();
    else startOnline();
  });
  bus.on('intent:chat', (p) => { const text = String(p?.text ?? '').trim(); if (text) request(C.CHAT, { text }); });
  bus.on('intent:missionStart', (p) => request(C.MISSION_START, { id: p?.id }));
  bus.on('intent:missionAbort', () => transmit(C.MISSION_ABORT));
  bus.on('intent:missionComplete', (p) => {
    if (transmit(C.MISSION_COMPLETE, { id: p?.id, durationSec: p?.durationSec })) return;
    bus.emit('mission:result', { id: p?.id, ok: false, reward: 0, reason: 'Pas de connexion au serveur : mission non validée.' });
  });
  bus.on('intent:buyProperty', (p) => request(C.BUY_PROPERTY, { id: p?.id }));
  bus.on('intent:sellProperty', (p) => request(C.SELL_PROPERTY, { id: p?.id }));
  bus.on('intent:buyCar', (p) => request(C.BUY_CAR, { typeId: p?.typeId }));
  bus.on('intent:setActiveCar', (p) => request(C.SET_ACTIVE_CAR, { typeId: p?.typeId }));
  bus.on('intent:transfer', (p) => request(C.TRANSFER, { to: p?.toPlayerId, amount: Math.round(+p?.amount) }));

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

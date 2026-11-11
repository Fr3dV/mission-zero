// Cœur multijoueur de Mission Zéro : comptes invités, salles, synchronisation, économie autoritaire, chat.
// Indépendant du transport HTTP : createGame({ store }) puis game.attach(serveurHttp).
import { WebSocketServer } from 'ws';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  PROTOCOL_VERSION, WS_PATH, C, S, CLOSE, ANIMS, SERVER_TICK_HZ, HEARTBEAT_MS, MAX_MESSAGE_BYTES,
  MAX_PLAYERS_PER_ROOM, MAX_SPEED, encode, decode, normColor,
} from '../shared/protocol.js';
import * as eco from '../shared/economy.js';
import { BOUNDS } from '../shared/geo.js';
import { VEHICLE_BY_ID, STARTER_VEHICLE } from '../shared/catalog.js';

const BOUNDS_MARGIN = 300; // tolérance autour de l'emprise jouable (m)
const HELLO_TIMEOUT_MS = 10000;
const ACCOUNT_KEEP_MS = 5 * 60 * 1000; // compte gardé en mémoire après déconnexion (reprise de session, mission en cours)
const LEADERBOARD_SIZE = 10;
const MEMBERS_KEPT = 60; // membres mémorisés par salle pour le classement

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + ' Ƶ';

export function createGame({ store, now = Date.now, log = () => {}, rentIntervalMs = 60000, maxConnections = +(process.env.MAX_CONNECTIONS || 1000) } = {}) {
  const rooms = new Map(); // code -> { code, record: { code, owners, members }, conns: Map(playerId -> conn), lbDirty }
  const roomLoads = new Map();
  const accounts = new Map(); // id -> { profile, session: { mission }, conn, evictAt }
  const accountLoads = new Map();
  const conns = new Set();
  let wss = null, stopped = false;
  const timers = [];

  // ------------------------------------------------------------------ comptes

  function tokenMatches(profile, secret) {
    const a = Buffer.from(sha256(secret)), b = Buffer.from(String(profile.tokenHash || ''));
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async function fetchAccount(id) {
    if (accounts.has(id)) return accounts.get(id);
    if (!accountLoads.has(id)) {
      accountLoads.set(id, (async () => {
        try {
          const rec = await store.getPlayer(id);
          if (!rec) return null;
          if (accounts.has(id)) return accounts.get(id);
          const account = { profile: eco.normalizeProfile(rec), session: { mission: null }, conn: null, evictAt: now() + ACCOUNT_KEEP_MS };
          accounts.set(id, account);
          return account;
        } finally { accountLoads.delete(id); }
      })());
    }
    return accountLoads.get(id);
  }

  /** Jeton « id.secret » -> compte existant, sinon nouveau compte invité (le secret n'est stocké que haché). */
  async function resolveAccount(token, name) {
    if (typeof token === 'string' && token.length <= 128) {
      const m = /^(p[0-9a-f]{16})\.([A-Za-z0-9_-]{20,64})$/.exec(token);
      if (m) {
        const account = await fetchAccount(m[1]);
        if (account && tokenMatches(account.profile, m[2])) return { account, token: null };
      }
    }
    const id = 'p' + randomBytes(8).toString('hex');
    const secret = randomBytes(24).toString('base64url');
    const profile = eco.newProfile(id, name);
    profile.tokenHash = sha256(secret);
    profile.createdAt = now();
    const account = { profile, session: { mission: null }, conn: null, evictAt: now() + ACCOUNT_KEEP_MS };
    accounts.set(id, account);
    return { account, token: `${id}.${secret}` };
  }

  function saveAccount(account) {
    account.profile.lastSeen = now();
    store.putPlayer(account.profile);
    const room = account.conn?.room;
    if (room) {
      const m = room.record.members[account.profile.id];
      if (!m || m.money !== account.profile.money || m.name !== account.profile.name) {
        room.record.members[account.profile.id] = { name: account.profile.name, money: account.profile.money };
        room.lbDirty = true;
      }
    }
  }

  // ------------------------------------------------------------------ salles

  async function fetchRoom(code) {
    if (rooms.has(code)) return rooms.get(code);
    if (!roomLoads.has(code)) {
      roomLoads.set(code, (async () => {
        try {
          const rec = (await store.getRoom(code)) || { code, createdAt: now() };
          if (rooms.has(code)) return rooms.get(code);
          rec.code = code;
          rec.owners = rec.owners && typeof rec.owners === 'object' ? rec.owners : {};
          rec.members = rec.members && typeof rec.members === 'object' ? rec.members : {};
          const room = { code, record: rec, conns: new Map(), lbDirty: false };
          rooms.set(code, room);
          return room;
        } finally { roomLoads.delete(code); }
      })());
    }
    return roomLoads.get(code);
  }

  function saveRoom(room) {
    const ids = Object.keys(room.record.members);
    if (ids.length > MEMBERS_KEPT) {
      ids.sort((a, b) => room.record.members[b].money - room.record.members[a].money);
      for (const id of ids.slice(MEMBERS_KEPT)) if (!room.conns.has(id)) delete room.record.members[id];
    }
    store.putRoom(room.record);
  }

  function leaderboard(room) {
    return Object.entries(room.record.members)
      .map(([id, m]) => ({ id, name: m.name, money: m.money, online: room.conns.has(id) }))
      .sort((a, b) => b.money - a.money).slice(0, LEADERBOARD_SIZE);
  }

  // ------------------------------------------------------------------ envois

  function send(conn, type, payload) { if (conn.ws.readyState === 1) conn.ws.send(encode(type, payload)); }
  function broadcast(room, type, payload, except = null) {
    const msg = encode(type, payload);
    for (const c of room.conns.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(msg);
  }
  const system = (room, text, except = null) => broadcast(room, S.CHAT, { from: 'Système', text, system: true }, except);
  const sendError = (conn, op, res) => send(conn, S.ERROR, { op, code: res.code, text: res.text });
  function sendProfile(conn, delta, reason) {
    const p = conn.account.profile;
    const payload = { me: eco.publicProfile(p, eco.ownedProperties(conn.room.record.owners, p.id)) };
    if (delta) { payload.delta = delta; payload.reason = reason; }
    send(conn, S.PROFILE, payload);
  }
  function reject(conn, code, text) {
    send(conn, S.ERROR, { op: C.HELLO, code, text, fatal: true });
    conn.ws.close(CLOSE.REJECTED, code);
  }

  // ------------------------------------------------------------------ connexion

  async function onHello(conn, m) {
    if (m.v !== PROTOCOL_VERSION) return reject(conn, 'version', 'Version du jeu obsolète : rechargez la page.');
    const code = eco.sanitizeRoom(m.room);
    let name = eco.sanitizeName(m.name);
    const { account, token } = await resolveAccount(m.token, name);
    const room = await fetchRoom(code);
    if (conn.closed || stopped) return;

    // même compte déjà connecté (autre onglet, reconnexion avant détection de la coupure) : l'ancien est remplacé
    if (account.conn) {
      const old = account.conn;
      send(old, S.ERROR, { op: C.HELLO, code: 'replaced', text: 'Session ouverte ailleurs avec ce compte.', fatal: true });
      detach(old);
      old.ws.close(CLOSE.REPLACED, 'replaced');
    }
    if (!rooms.has(code)) rooms.set(code, room); // la salle a pu être libérée entre-temps (chargement, remplacement)
    if (room.conns.size >= MAX_PLAYERS_PER_ROOM) {
      if (!room.conns.size) rooms.delete(code);
      return reject(conn, 'room_full', `La salle « ${code} » est pleine (${MAX_PLAYERS_PER_ROOM} joueurs).`);
    }
    // unicité du pseudo dans la salle
    const taken = new Set([...room.conns.values()].map((c) => c.account.profile.name.toLowerCase()));
    if (taken.has(name.toLowerCase())) {
      for (let i = 2; i < 100; i++) {
        const cand = name.slice(0, eco.NAME_MAX - String(i).length) + i;
        if (!taken.has(cand.toLowerCase())) { name = cand; break; }
      }
    }
    const p = account.profile;
    p.name = name;
    for (const id of eco.ownedProperties(room.record.owners, p.id)) room.record.owners[id].name = name;

    conn.account = account; conn.room = room; conn.accrueAt = now();
    account.conn = conn; account.evictAt = 0;
    room.conns.set(p.id, conn);
    saveAccount(account);
    clearTimeout(conn.helloTimer);

    const payload = {
      v: PROTOCOL_VERSION, id: p.id, room: code, ts: now(),
      me: eco.publicProfile(p, eco.ownedProperties(room.record.owners, p.id)),
      players: [...room.conns.values()].filter((c) => c !== conn).map((c) => ({ id: c.account.profile.id, name: c.account.profile.name })),
      owners: room.record.owners, lb: leaderboard(room),
      mission: account.session.mission?.id || null,
    };
    if (token) payload.token = token;
    send(conn, S.WELCOME, payload);
    broadcast(room, S.JOIN, { id: p.id, name }, conn);
    log(`[salle ${code}] + ${name} (${room.conns.size} joueur(s))`);
  }

  /** Retire une connexion de sa salle (fermeture, remplacement). */
  function detach(conn, silent = false) {
    if (conn.closed) return;
    conn.closed = true;
    clearTimeout(conn.helloTimer);
    conns.delete(conn);
    const { account, room } = conn;
    if (!account || account.conn !== conn) return;
    const p = account.profile;
    eco.accrue(p, room.record.owners, (now() - conn.accrueAt) / 1000);
    saveAccount(account);
    account.conn = null;
    account.evictAt = now() + ACCOUNT_KEEP_MS;
    room.conns.delete(p.id);
    room.lbDirty = true;
    if (!silent) broadcast(room, S.LEAVE, { id: p.id, name: p.name }); // l'annonce « X est parti » est affichée par le client
    saveRoom(room);
    if (!room.conns.size) rooms.delete(room.code);
    log(`[salle ${room.code}] - ${p.name} (${room.conns.size} joueur(s))`);
  }

  // ------------------------------------------------------------------ synchronisation

  function onState(conn, m) {
    const s = m.s;
    if (!Array.isArray(s) || s.length < 7 || s.length > 9) return;
    for (let i = 0; i < 7; i++) if (typeof s[i] !== 'number' || !Number.isFinite(s[i])) return;
    const x = clamp(s[0], BOUNDS.minX - BOUNDS_MARGIN, BOUNDS.maxX + BOUNDS_MARGIN);
    const z = clamp(s[2], BOUNDS.minZ - BOUNDS_MARGIN, BOUNDS.maxZ + BOUNDS_MARGIN);
    const t = now();
    if (conn.pos) {
      const dt = Math.max(0.02, (t - conn.pos.t) / 1000);
      if (Math.hypot(x - conn.pos.x, z - conn.pos.z) > MAX_SPEED * dt + 8) {
        // vitesse implausible : toléré comme téléportation (réapparition, garage), mais pas en rafale
        if (t - conn.teleportAt < 1500) return;
        conn.teleportAt = t;
      }
    }
    conn.pos = { x, z, t };
    const mode = s[5] === 1 ? 1 : 0;
    const st = [conn.account.profile.id, x, clamp(s[1], -60, 500), z, Math.round(Math.atan2(Math.sin(s[3]), Math.cos(s[3])) * 100) / 100,
      clamp(s[4], -MAX_SPEED, MAX_SPEED), mode, Number.isInteger(s[6]) && s[6] >= 0 && s[6] < ANIMS.length ? s[6] : 0];
    if (mode === 1) st.push(typeof s[7] === 'string' && VEHICLE_BY_ID[s[7]] ? s[7] : STARTER_VEHICLE, normColor(s[8]));
    conn.state = st;
  }

  function tickSnapshots() {
    const ts = now();
    for (const room of rooms.values()) {
      const p = [];
      for (const c of room.conns.values()) if (c.state) p.push(c.state);
      if (!p.length) continue;
      const msg = encode(S.SNAPSHOT, { ts, p });
      for (const c of room.conns.values()) {
        // connexion saturée : on saute l'instantané (le suivant le remplace)
        if (c.ws.readyState === 1 && c.ws.bufferedAmount < 262144) c.ws.send(msg);
      }
    }
  }

  // ------------------------------------------------------------------ économie

  /** Applique le résultat d'une opération d'économie : profil mis à jour ou erreur explicite. */
  function settle(conn, op, res) {
    if (!res.ok) { sendError(conn, op, res); return false; }
    saveAccount(conn.account);
    sendProfile(conn, res.delta, res.reason);
    return true;
  }

  const handlers = {
    [C.PING](conn, m) { send(conn, S.PONG, { c: typeof m.c === 'number' ? m.c : 0, ts: now() }); },
    [C.STATE]: onState,

    [C.CHAT](conn, m) {
      const text = eco.sanitizeChat(m.text);
      if (!text) return;
      if (!conn.chatBucket.take(now())) return sendError(conn, C.CHAT, { code: 'rate', text: 'Vous écrivez trop vite, patientez un instant.' });
      const p = conn.account.profile;
      broadcast(conn.room, S.CHAT, { from: p.name, id: p.id, text });
    },

    [C.MISSION_START](conn, m) {
      // refus (cooldown, mission inconnue) : signalé par mission_result { ok: false } — c'est le gameplay qui l'affiche
      const id = String(m.id).slice(0, 64);
      const res = eco.missionStart(conn.account.profile, conn.account.session, id, now());
      if (!res.ok) send(conn, S.MISSION_RESULT, { id, ok: false, reward: 0, code: res.code, reason: res.text });
    },
    [C.MISSION_ABORT](conn) { eco.missionAbort(conn.account.session); },
    [C.MISSION_COMPLETE](conn, m) {
      const p = conn.account.profile, id = String(m.id).slice(0, 64);
      const res = eco.missionComplete(p, conn.account.session, id, now());
      if (!res.ok) return send(conn, S.MISSION_RESULT, { id, ok: false, reward: 0, code: res.code, reason: res.text });
      saveAccount(conn.account);
      send(conn, S.MISSION_RESULT, { id, ok: true, reward: res.reward });
      sendProfile(conn, res.delta, res.reason);
      system(conn.room, `${p.name} a réussi la mission « ${res.title} » (+${fmt(res.reward)}).`, conn);
    },

    [C.BUY_CAR](conn, m) { settle(conn, C.BUY_CAR, eco.buyCar(conn.account.profile, String(m.typeId))); },
    [C.SET_ACTIVE_CAR](conn, m) { settle(conn, C.SET_ACTIVE_CAR, eco.setActiveCar(conn.account.profile, String(m.typeId))); },

    [C.BUY_PROPERTY](conn, m) {
      const room = conn.room, p = conn.account.profile;
      const res = eco.buyProperty(p, room.record.owners, String(m.id));
      if (!settle(conn, C.BUY_PROPERTY, res)) return;
      saveRoom(room);
      broadcast(room, S.OWNERS, { owners: room.record.owners });
      system(room, `${p.name} a acheté « ${res.name} ».`);
    },
    [C.SELL_PROPERTY](conn, m) {
      const room = conn.room, p = conn.account.profile;
      const res = eco.sellProperty(p, room.record.owners, String(m.id));
      if (!settle(conn, C.SELL_PROPERTY, res)) return;
      saveRoom(room);
      broadcast(room, S.OWNERS, { owners: room.record.owners });
      system(room, `${p.name} a vendu « ${res.name} ».`);
    },

    [C.TRANSFER](conn, m) {
      if (!conn.transferBucket.take(now())) return sendError(conn, C.TRANSFER, { code: 'rate', text: 'Trop de virements : patientez quelques secondes.' });
      const from = conn.account.profile;
      const target = typeof m.to === 'string' ? conn.room.conns.get(m.to) : null;
      const res = eco.transfer(from, target?.account.profile, m.amount);
      if (!res.ok) return sendError(conn, C.TRANSFER, res);
      const to = target.account.profile;
      saveAccount(conn.account); saveAccount(target.account);
      sendProfile(conn, -res.amount, `virement à ${to.name}`);
      sendProfile(target, res.amount, `virement de ${from.name}`);
      send(target, S.CHAT, { from: 'Système', system: true, text: `${from.name} vous a envoyé ${fmt(res.amount)}.` });
      send(conn, S.CHAT, { from: 'Système', system: true, text: `Vous avez envoyé ${fmt(res.amount)} à ${to.name}.` });
    },
  };
  const ECONOMY_OPS = new Set([C.MISSION_START, C.MISSION_COMPLETE, C.BUY_CAR, C.SET_ACTIVE_CAR, C.BUY_PROPERTY, C.SELL_PROPERTY, C.TRANSFER]);

  function onMessage(conn, raw, isBinary) {
    if (conn.closed) return;
    conn.alive = true;
    if (isBinary || !conn.bucket.take(now())) { conn.ws.close(CLOSE.FLOOD, 'flood'); return; }
    const m = decode(raw);
    if (!m) { if (++conn.strikes > 5) conn.ws.close(CLOSE.FLOOD, 'invalid'); return; }
    if (!conn.account) {
      // tant que le hello n'a pas abouti, rien d'autre n'est accepté
      if (m.t !== C.HELLO || conn.helloPending) return;
      conn.helloPending = true;
      onHello(conn, m).catch((e) => { log('[hello] ' + (e?.stack || e)); reject(conn, 'server', 'Erreur du serveur, réessayez.'); });
      return;
    }
    const h = handlers[m.t];
    if (!h) { if (++conn.strikes > 20) conn.ws.close(CLOSE.FLOOD, 'invalid'); return; }
    if (ECONOMY_OPS.has(m.t) && !conn.opBucket.take(now())) return sendError(conn, m.t, { code: 'rate', text: "Trop d'opérations à la suite : patientez un instant." });
    try { h(conn, m); } catch (e) { log(`[msg ${m.t}] ` + (e?.stack || e)); sendError(conn, m.t, { code: 'server', text: 'Erreur du serveur.' }); }
  }

  function onConnection(ws, req) {
    const conn = {
      ws, account: null, room: null, state: null, pos: null, teleportAt: 0, accrueAt: 0, alive: true, closed: false,
      helloPending: false, strikes: 0,
      bucket: eco.createBucket(90, 45), // tous messages (15 états/s + pings en régime normal)
      opBucket: eco.createBucket(12, 2), // opérations d'économie
      chatBucket: eco.createBucket(5, 0.5),
      transferBucket: eco.createBucket(3, 0.2),
      ip: String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '').split(',')[0].trim(),
    };
    conns.add(conn);
    conn.helloTimer = setTimeout(() => { if (!conn.account) ws.close(CLOSE.REJECTED, 'hello'); }, HELLO_TIMEOUT_MS);
    ws.on('message', (raw, isBinary) => onMessage(conn, raw, isBinary));
    ws.on('pong', () => { conn.alive = true; });
    ws.on('close', () => detach(conn));
    ws.on('error', () => { /* 'close' suit toujours */ });
  }

  // ------------------------------------------------------------------ tâches périodiques

  function tickRents() {
    const t = now();
    for (const conn of conns) {
      if (!conn.account || conn.closed) continue;
      const delta = eco.accrue(conn.account.profile, conn.room.record.owners, (t - conn.accrueAt) / 1000);
      conn.accrueAt = t;
      if (delta > 0) { saveAccount(conn.account); sendProfile(conn, delta, 'loyers'); }
    }
  }
  function tickLeaderboards() {
    for (const room of rooms.values()) {
      if (!room.lbDirty) continue;
      room.lbDirty = false;
      broadcast(room, S.LEADERBOARD, { list: leaderboard(room) });
    }
  }
  function tickHeartbeat() {
    for (const conn of conns) {
      if (!conn.alive) { conn.ws.terminate(); continue; } // 'close' -> detach
      conn.alive = false;
      try { conn.ws.ping(); } catch { /* socket déjà fermée */ }
    }
    const t = now();
    for (const [id, a] of accounts) if (!a.conn && a.evictAt && a.evictAt < t) accounts.delete(id);
  }

  // ------------------------------------------------------------------ cycle de vie

  function attach(server) {
    wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
    wss.on('connection', onConnection);
    server.on('upgrade', (req, socket, head) => {
      let path = '';
      try { path = new URL(req.url, 'http://x').pathname; } catch { /* URL invalide */ }
      if (path !== WS_PATH || stopped) { socket.destroy(); return; }
      if (conns.size >= maxConnections) { socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    const every = (fn, ms) => { const h = setInterval(fn, ms); h.unref?.(); timers.push(h); };
    every(tickSnapshots, Math.round(1000 / SERVER_TICK_HZ));
    every(tickRents, rentIntervalMs);
    every(tickLeaderboards, 3000);
    every(tickHeartbeat, HEARTBEAT_MS);
  }

  /** Arrêt propre : loyers soldés, tout est sauvegardé, clients invités à se reconnecter (code 1012). */
  async function shutdown() {
    if (stopped) return;
    stopped = true;
    for (const h of timers) clearInterval(h);
    for (const conn of [...conns]) {
      const ws = conn.ws;
      detach(conn, true);
      try { ws.close(CLOSE.RESTART, 'restart'); } catch { /* déjà fermée */ }
    }
    for (const a of accounts.values()) store.putPlayer(a.profile);
    await store.close();
    wss?.close();
  }

  return {
    attach, shutdown, tickRents, tickSnapshots, tickLeaderboards, tickHeartbeat,
    stats: () => ({ connections: conns.size, rooms: rooms.size, accounts: accounts.size }),
  };
}

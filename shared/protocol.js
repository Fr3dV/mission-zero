// Protocole réseau Mission Zéro — partagé client / serveur / robots (aucune dépendance).
// Transport : WebSocket texte, un objet JSON compact par message : { t: <type>, ... }.
// Les états de position sont des tableaux numériques arrondis (voir encodeState).
export const PROTOCOL_VERSION = 1;
export const WS_PATH = '/ws';

export const CLIENT_SEND_HZ = 15; // états envoyés par le client
export const SERVER_TICK_HZ = 12; // instantanés diffusés par le serveur
export const INTERP_DELAY_MS = 120; // tampon d'interpolation côté client
export const HEARTBEAT_MS = 25000;
export const MAX_MESSAGE_BYTES = 2048;
export const MAX_PLAYERS_PER_ROOM = 32;
export const DEFAULT_ROOM = 'paris';
export const MAX_CHAT_LEN = 200;
export const MAX_SPEED = 130; // m/s — au-delà, le déplacement est traité comme une téléportation

// Messages client -> serveur
export const C = {
  HELLO: 'hello', //            { v, name, room, token? }
  STATE: 'st', //               { s: [x, y, z, yaw, speed, mode, anim, vehicleType, vehicleColor] }
  PING: 'ping', //              { c: horloge client }
  CHAT: 'chat', //              { text }
  MISSION_START: 'mission_start', //       { id }
  MISSION_COMPLETE: 'mission_complete', // { id, durationSec? }
  MISSION_ABORT: 'mission_abort', //       {}
  BUY_CAR: 'buy_car', //        { typeId }
  SET_ACTIVE_CAR: 'set_car', // { typeId }
  BUY_PROPERTY: 'buy_prop', //  { id }
  SELL_PROPERTY: 'sell_prop', // { id }
  TRANSFER: 'transfer', //      { to, amount }
};

// Messages serveur -> client
export const S = {
  WELCOME: 'welcome', //  { v, id, token?, room, me, players:[{id,name}], owners, lb, ts }
  ERROR: 'error', //      { op, code, text, fatal? }
  PROFILE: 'profile', //  { me, delta?, reason? }
  SNAPSHOT: 'snap', //    { ts, p: [[id, x, y, z, yaw, speed, mode, anim, vehicleType, vehicleColor], ...] }
  JOIN: 'join', //        { id, name }
  LEAVE: 'leave', //      { id, name }
  CHAT: 'chat', //        { from, id?, text, system? }
  MISSION_RESULT: 'mission_result', // { id, ok, reward, code?, reason? } — aussi envoyé si mission_start est refusé
  OWNERS: 'owners', //    { owners: { propertyId: { id, name } } }
  LEADERBOARD: 'lb', //   { list: [{ id, name, money, online }] }
  PONG: 'pong', //        { c, ts }
};

// Codes de fermeture WebSocket applicatifs
export const CLOSE = {
  REPLACED: 4001, // même compte connecté ailleurs : ne pas se reconnecter
  REJECTED: 4002, // hello refusé (salle pleine, version…) : ne pas se reconnecter
  FLOOD: 4003, // débit dépassé
  RESTART: 1012, // redémarrage du serveur : se reconnecter
};

export const MODES = ['foot', 'vehicle'];
export const ANIMS = ['idle', 'walk', 'run', 'sit', 'jump', 'fall', 'swim', 'drive'];

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (Number.isFinite(+v) ? +v : 0);

/** Couleur (nombre 0xrrggbb, '#rgb', '#rrggbb', THREE.Color) -> '#rrggbb' ou null. */
export function normColor(c) {
  if (c == null) return null;
  if (typeof c === 'number' && Number.isFinite(c)) return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  if (typeof c === 'object' && typeof c.getHexString === 'function') return '#' + c.getHexString();
  if (typeof c !== 'string') return null;
  let s = c.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

/** État du joueur (contrat ctx.player.getNetState()) -> tableau compact. */
export function encodeState(st) {
  const mode = Math.max(0, MODES.indexOf(st.mode));
  const anim = Math.max(0, ANIMS.indexOf(st.anim));
  const out = [r1(num(st.x)), r1(num(st.y)), r1(num(st.z)), r2(num(st.yaw)), r1(num(st.speed)), mode, anim];
  if (mode === 1) out.push(st.vehicleType || null, normColor(st.vehicleColor));
  return out;
}

/** Tableau compact (à partir de l'index `o`) -> objet état. */
export function decodeState(a, o = 0) {
  return {
    x: a[o], y: a[o + 1], z: a[o + 2], yaw: a[o + 3], speed: a[o + 4],
    mode: MODES[a[o + 5]] || 'foot', anim: ANIMS[a[o + 6]] || 'idle',
    vehicleType: a[o + 7] || null, vehicleColor: a[o + 8] || null,
  };
}

export const encode = (type, payload) => JSON.stringify(payload ? { t: type, ...payload } : { t: type });

/** Décodage tolérant : retourne null si le message n'est pas un objet JSON { t: string }. */
export function decode(raw) {
  try {
    const m = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    return m && typeof m === 'object' && !Array.isArray(m) && typeof m.t === 'string' ? m : null;
  } catch { return null; }
}

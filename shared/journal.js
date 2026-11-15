// Carnet de bord de Mission Zéro — module PUR (aucune dépendance Node ni navigateur), lot net-serveur.
// Défis du jour, mission vedette, série de jours, relevé du matin (loyers pendant l'absence).
// Utilisé par le serveur (autorité) ET par le repli hors-ligne : mêmes règles des deux côtés.
//
// Le journal vit dans le profil persistant (p.journal) et n'est JAMAIS dans publicProfile : le client le reçoit
// par S.JOURNAL (publicJournal). Forme :
//   { v: 1,
//     day: { k: 'AAAA-MM-JJ', lv: <niveau FIGÉ à la bascule>, c: { m, km, fares, style, star, types: [] }, claimed: [], full: false },
//     streak: { n, last, best },            // n jours d'affilée ; last = jour de la dernière journée complète
//     rentAt: { roomKey: ms } (8 max),      // dernier instant où les loyers de cette salle étaient à jour
//     away: { roomKey: { rent, sec } } (8 max), // relevé du matin non encaissé
//     fareWin: { at, paid },                // fenêtre d'une heure du plafond des courses de taxi (shared/jobs.js)
//     fineAt,                               // dernière amende (shared/economy.js fine)
//     due, dueN }                           // défis de la veille soldés d'office à la bascule, pas encore crédités (Ƶ) ;
//                                           // dueN = série atteinte par la journée complète soldée d'office (0 = aucune)
// Compteurs du jour (day.c) : m = missions réussies, km = MÈTRES parcourus (mesurés par le serveur),
// fares = courses de taxi, style = points de style encaissés, star = 1 si la mission vedette est réussie,
// types = types de mission distincts réussis.
//
// Aucun import de shared/economy.js ici (economy.js et jobs.js importent ce module, pas l'inverse).
import * as CORE from './content-core.js';
import * as M from './missions.js';
import * as P from './properties.js';
import { CITIES, DEFAULT_CITY } from './cities.js';

// ---------------------------------------------------------------- constantes d'équilibrage
export const DAY_TZ = 'Europe/Paris';
export const DAY_START_HOUR = 4; // la journée du journal bascule à 4 h, heure de Paris
/** R : récompense d'un défi du jour, par niveau figé (1..6). Total quotidien <= 5,25 × R. */
export const DAILY_REWARD = [600, 1500, 3000, 5500, 10000, 16000];
export const FULL_RATIO = 1.5; // prime de journée complète = 1,5 × R, majorée par la série
export const STREAK_STEP = 0.1, STREAK_MAX = 5; // +10 % par jour de série, plafonné à 5 jours
/** Objectifs par niveau figé (index niveau − 1). km est en MÈTRES, comme le compteur day.c.km. */
export const DAILY_GOALS = {
  missions: [2, 2, 3, 3, 4, 4],
  types: [2, 2, 2, 3, 3, 3],
  fares: [2, 3, 3, 4, 5, 6],
  km: [3000, 5000, 8000, 12000, 16000, 20000],
  style: [1500, 3000, 5000, 8000, 12000, 16000],
};
export const TAXI_DAILY = true; // le défi « courses de taxi » n'est tiré que si le taxi libre est activé
export const KM_DAY_CAP = 60000, STYLE_DAY_CAP = 50000; // plafonds des compteurs du jour (m, points)
export const STAR_MAX_ROUTE_M = 9000; // la mission vedette fait au plus 9 km par la route
export const AWAY_MIN_MS = 30 * 60 * 1000; // en dessous de 30 min d'absence : pas de relevé
export const AWAY_MAX_MS = 12 * 3600 * 1000; // une absence compte pour 12 h au plus
export const AWAY_RATIO = 0.5; // les loyers d'absence valent 50 % des loyers connectés
export const AWAY_CAP_HOURS = 24; // le non-encaissé se cumule jusqu'à deux relevés pleins (24 h × 50 %)
export const ROOMS_KEPT = 8; // salles mémorisées dans rentAt / away

const HOUR_MS = 3600 * 1000;
const D2_KINDS = TAXI_DAILY ? ['missions', 'types', 'fares'] : ['missions', 'types'];
const D3_KINDS = ['km', 'style'];

const own = (table, id) => (typeof id === 'string' && table && Object.hasOwn(table, id) ? table[id] : undefined);
const safeKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= 64 && k !== '__proto__';
const int = (v, max = Number.MAX_SAFE_INTEGER) => { const n = Math.floor(+v); return n > 0 ? Math.min(max, n) : 0; };
const clampLv = (lv) => Math.max(1, Math.min(DAILY_REWARD.length, Math.floor(+lv) || 1));
const levelFn = CORE.levelForMissionsDone || (() => 1);
const levelOf = (p) => levelFn(+p?.stats?.missionsDone || 0);
const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// ---------------------------------------------------------------- jour du journal

// Intl.DateTimeFormat avec timeZone gère l'heure d'été (Node 20 avec ICU complet et navigateurs). S'il manque
// (environnement sans ICU), repli documenté : UTC+1 toute l'année (une heure de décalage l'été, sans gravité).
let dayFmt = null;
try { dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { dayFmt = null; }

function computeDayKey(ms) {
  const t = ms - DAY_START_HOUR * HOUR_MS;
  if (dayFmt) {
    try {
      let y = '', m = '', d = '';
      for (const part of dayFmt.formatToParts(new Date(t))) {
        if (part.type === 'year') y = part.value; else if (part.type === 'month') m = part.value; else if (part.type === 'day') d = part.value;
      }
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch { /* repli ci-dessous */ }
  }
  return new Date(t + HOUR_MS).toISOString().slice(0, 10);
}

// Le décalage de Paris est un nombre entier d'heures : la clé ne change qu'à une heure UTC ronde.
// Un cache par heure UTC évite tout appel Intl au rythme des états (15 par seconde et par joueur).
let cacheHour = NaN, cacheKey = '';
/** Jour du journal : date Europe/Paris de (now − 4 h), 'AAAA-MM-JJ'. */
export function dayKey(now) {
  const t = Number.isFinite(+now) ? +now : 0, h = Math.floor(t / HOUR_MS);
  if (h !== cacheHour) { cacheKey = computeDayKey(t); cacheHour = h; }
  return cacheKey;
}

/** Veille d'un jour 'AAAA-MM-JJ'. */
export function prevDayKey(k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k));
  if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] - 1)).toISOString().slice(0, 10);
}

let resetFor = '', resetValue = 0;
/** Instant (ms) de la prochaine bascule de jour (4 h, heure de Paris). */
export function nextResetAt(now) {
  const k = dayKey(now);
  if (k === resetFor && resetValue > now) return resetValue;
  let h = Math.floor(now / HOUR_MS) + 1;
  for (let i = 0; i < 30 && computeDayKey(h * HOUR_MS) === k; i++) h++;
  resetFor = k; resetValue = h * HOUR_MS;
  return resetValue;
}

// ---------------------------------------------------------------- forme et réparation

const newCounters = () => ({ m: 0, km: 0, fares: 0, style: 0, star: 0, types: [] });
const newDay = (k, lv) => ({ k, lv: clampLv(lv), c: newCounters(), claimed: [], full: false });
/** Journal vierge (jour '' : la première bascule a lieu au premier rollDay). */
export const newJournal = () => ({ v: 1, day: newDay('', 1), streak: { n: 0, last: '', best: 0 }, rentAt: {}, away: {}, fareWin: { at: 0, paid: 0 }, fineAt: 0, due: 0, dueN: 0 });

const isDay = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
const TYPE_IDS = Object.keys(CORE.MISSION_TYPES || {});

/** Répare un journal chargé (profil d'avant le contrat v6 : champ absent ; valeurs hors forme ramenées aux défauts). */
export function normalizeJournal(raw) {
  const j = newJournal();
  if (!raw || typeof raw !== 'object') return j;
  const d = raw.day;
  if (d && typeof d === 'object' && isDay(d.k)) {
    j.day.k = d.k; j.day.lv = clampLv(d.lv);
    const c = d.c && typeof d.c === 'object' ? d.c : {};
    j.day.c = {
      m: int(c.m, 9999), km: Math.round(Math.min(KM_DAY_CAP, Math.max(0, +c.km || 0)) * 1000) / 1000, fares: int(c.fares, 9999), style: int(c.style, STYLE_DAY_CAP), star: c.star ? 1 : 0,
      types: [...new Set((Array.isArray(c.types) ? c.types : []).filter((t) => TYPE_IDS.includes(t)))],
    };
    j.day.claimed = [...new Set((Array.isArray(d.claimed) ? d.claimed : []).filter((id) => id === 'd1' || id === 'd2' || id === 'd3'))];
    j.day.full = d.full === true;
  }
  const s = raw.streak;
  if (s && typeof s === 'object') {
    j.streak.n = int(s.n, 99999); j.streak.last = isDay(s.last) ? s.last : ''; j.streak.best = Math.max(int(s.best, 99999), j.streak.n);
  }
  if (raw.rentAt && typeof raw.rentAt === 'object') {
    const at = Object.entries(raw.rentAt).filter(([k, v]) => safeKey(k) && Number.isFinite(v) && v > 0).sort((a, b) => b[1] - a[1]).slice(0, ROOMS_KEPT);
    for (const [k, v] of at) j.rentAt[k] = v;
  }
  if (raw.away && typeof raw.away === 'object') {
    const aw = Object.entries(raw.away).filter(([k, v]) => safeKey(k) && v && int(v.rent) > 0).slice(0, ROOMS_KEPT);
    for (const [k, v] of aw) j.away[k] = { rent: int(v.rent, 1e12), sec: int(v.sec, 1e9) };
  }
  const w = raw.fareWin;
  if (w && typeof w === 'object' && Number.isFinite(w.at) && w.at > 0) j.fareWin = { at: w.at, paid: int(w.paid, 1e12) };
  j.fineAt = Number.isFinite(raw.fineAt) && raw.fineAt > 0 ? raw.fineAt : 0;
  j.due = int(raw.due, 1e12); j.dueN = int(raw.dueN, 99999);
  return j;
}

/** Journal du profil, créé s'il manque (les profils chargés sont déjà réparés par normalizeProfile). */
export function ensureJournal(p) {
  const j = p.journal;
  if (j && j.v === 1 && j.day && j.day.c && Array.isArray(j.day.claimed) && j.streak && j.rentAt && j.away && j.fareWin) return j;
  return (p.journal = normalizeJournal(j));
}

/**
 * Solde d'office la journée qui se termine : chaque défi réussi mais pas réclamé est dû (stats.dailyDone + 1), et si les
 * trois objectifs sont atteints sans que la prime de journée complète ait été réclamée, elle est due aussi (au taux de la
 * série, comme une réclamation) et la série avance. Rien n'est crédité ici : le montant s'ajoute à j.due, que
 * economy.settleDue verse. Un joueur qui a réussi ses défis ne perd donc ni ses primes ni sa série à 4 h.
 */
function settleDay(p, j) {
  const d = j.day;
  if (!isDay(d.k)) return;
  const def = dailyFor(d.k, d.lv);
  let due = 0, all = true;
  for (const e of def.list) {
    if (haveOf(d.c, e.kind) < e.goal) { all = false; continue; }
    if (d.claimed.includes(e.id)) continue;
    d.claimed.push(e.id);
    due += e.reward;
    if (p.stats && typeof p.stats === 'object') p.stats.dailyDone = (+p.stats.dailyDone || 0) + 1;
  }
  if (all && !d.full) {
    due += fullReward(def.full, streakAfter(j, d.k));
    const s = completeDay(p);
    if (s.up) j.dueN = s.n;
  }
  if (due > 0) j.due = int((+j.due || 0) + due, 1e12);
}

/**
 * Bascule paresseuse du jour : si le jour du journal n'est plus celui de `now`, la journée qui se termine est soldée
 * d'office (settleDay : défis réussis non réclamés dus dans j.due, série avancée), puis nouveau jour { k, lv: niveau
 * courant (figé pour la journée), compteurs à zéro }. Retourne true s'il y a eu bascule (ou compte neuf).
 * `key` (facultatif) = dayKey déjà calculé par l'appelant.
 */
export function rollDay(p, now, key) {
  const j = ensureJournal(p), k = isDay(key) ? key : dayKey(now);
  if (j.day.k === k) return false;
  settleDay(p, j);
  j.day = newDay(k, levelOf(p));
  return true;
}

// ---------------------------------------------------------------- défis du jour et mission vedette

// Hachage déterministe (FNV-1a puis mélange) : même tirage sur le serveur, hors-ligne et dans les tests.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

const DAILY_LABEL = {
  star: () => 'Réussir la mission vedette',
  missions: (g) => `Réussir ${g} missions`,
  types: (g) => `Réussir ${g} types de mission différents`,
  fares: (g) => `Conduire ${g} clients en taxi`,
  km: (g) => `Rouler ${String(Math.round(g / 100) / 10).replace('.', ',')} km`,
  style: (g) => `Encaisser ${fmtInt(g)} points de style`,
};

/**
 * Défis du jour : déterministes et INDÉPENDANTS de la ville. d1 = mission vedette ; d2 et d3 sont tirés dans deux
 * familles disjointes (jamais le même kind). `goal` et `have` du défi 'km' sont en MÈTRES.
 * @returns {{ list: [{id:'d1'|'d2'|'d3', kind, goal, reward, label}], full: number }}  full = prime de journée complète (hors série)
 */
export function dailyFor(key, lv) {
  const i = clampLv(lv) - 1, R = DAILY_REWARD[i], h = hash(`${key}|defis`);
  const k2 = D2_KINDS[h % D2_KINDS.length], k3 = D3_KINDS[(h >>> 11) % D3_KINDS.length];
  const entry = (id, kind, goal) => ({ id, kind, goal, reward: R, label: DAILY_LABEL[kind](goal) });
  return { list: [entry('d1', 'star', 1), entry('d2', k2, DAILY_GOALS[k2][i]), entry('d3', k3, DAILY_GOALS[k3][i])], full: Math.round(FULL_RATIO * R) };
}

const knownCity = (c) => (typeof c === 'string' && Object.hasOwn(CITIES, c) ? c : DEFAULT_CITY);
const routeLen = CORE.missionRouteLength || (() => 0);
const starPools = new Map();
function starPool(city, lv) {
  const id = `${city}:${lv}`;
  let pool = starPools.get(id);
  if (pool) return pool;
  const all = ((M.MISSIONS_BY_CITY || {})[city] || []).filter((m) => !m.intro && (m.level || 1) <= lv);
  const short = all.filter((m) => routeLen(m) <= STAR_MAX_ROUTE_M);
  // niveaux lv−1..lv, puis on élargit vers le bas tant qu'aucune mission courte ne convient ; en dernier recours, sans limite de longueur
  pool = [];
  for (let lo = Math.max(1, lv - 1); lo >= 1 && !pool.length; lo--) pool = short.filter((m) => (m.level || 1) >= lo);
  if (!pool.length) pool = all;
  pool = pool.map((m) => m.id);
  starPools.set(id, pool);
  return pool;
}

/**
 * Mission vedette du jour pour une ville et un niveau figé : tirée parmi les missions de la ville de niveau
 * lv−1..lv, sans flag intro, de longueur routière <= 9 km (plage élargie vers le bas si aucune ne convient).
 * @returns id de mission, ou null si la ville n'a aucune mission accessible
 */
export function starFor(key, city, lv) {
  const c = knownCity(city), pool = starPool(c, clampLv(lv));
  return pool.length ? pool[hash(`${key}|vedette|${c}`) % pool.length] : null;
}

function haveOf(c, kind) {
  if (kind === 'star') return c.star ? 1 : 0;
  if (kind === 'missions') return c.m;
  if (kind === 'types') return c.types.length;
  if (kind === 'fares') return c.fares;
  if (kind === 'km') return Math.floor(c.km);
  if (kind === 'style') return c.style;
  return 0;
}

/** Série qu'aurait le joueur s'il réclamait la journée complète le jour `k` (sans rien modifier). */
export function streakAfter(j, k) {
  const s = j.streak;
  return s.last === k ? Math.max(1, s.n) : s.last && s.last === prevDayKey(k) ? s.n + 1 : 1;
}
const fullReward = (base, n) => Math.round(base * (1 + STREAK_STEP * Math.min(n, STREAK_MAX)));

/**
 * État des défis du jour (après bascule paresseuse) : liste avec avancement, prime de journée complète.
 * `ready` = les trois objectifs sont atteints et la prime n'est pas encore encaissée.
 */
export function dailyState(p, now) {
  rollDay(p, now);
  const j = p.journal, d = j.day, def = dailyFor(d.k, d.lv);
  const list = def.list.map((e) => ({ id: e.id, kind: e.kind, goal: e.goal, have: Math.min(e.goal, haveOf(d.c, e.kind)), reward: e.reward, claimed: d.claimed.includes(e.id), label: e.label }));
  const n = streakAfter(j, d.k);
  return { k: d.k, lv: d.lv, list, streakN: n, full: { reward: fullReward(def.full, n), ready: !d.full && list.every((e) => e.have >= e.goal), claimed: d.full } };
}

/**
 * Journée complète réclamée : met la série à jour (n+1 si la dernière date d'hier, inchangée si déjà aujourd'hui,
 * sinon 1 ; best = max) et marque le jour. Retourne { n, best, up } (up = la série a progressé).
 * Les contrôles (prête, pas déjà réclamée) sont faits par economy.claim.
 */
export function completeDay(p) {
  const j = ensureJournal(p), s = j.streak, k = j.day.k, before = s.n;
  s.n = streakAfter(j, k);
  s.last = k;
  s.best = Math.max(s.best, s.n);
  j.day.full = true;
  return { n: s.n, best: s.best, up: s.n !== before };
}

// ---------------------------------------------------------------- compteurs du jour

/**
 * Ajoute `n` au compteur du jour `key` ('m' | 'km' (mètres) | 'fares' | 'style' | 'star'). Avec `now`, la bascule de
 * jour est faite d'abord. Plafonds : km 60 000 m, style 50 000 points, star 1. Retourne la nouvelle valeur.
 */
export function count(p, key, n = 1, now) {
  if (now != null) rollDay(p, now);
  const c = ensureJournal(p).day.c, add = +n;
  if (!(add > 0) || !Number.isFinite(add)) return c[key] || 0;
  // au millimètre : un ajout par état ou par image (quelques centimètres à pied) ne doit jamais être perdu à l'arrondi
  if (key === 'km') c.km = Math.round(Math.min(KM_DAY_CAP, c.km + add) * 1000) / 1000;
  else if (key === 'style') c.style = Math.min(STYLE_DAY_CAP, c.style + Math.floor(add));
  else if (key === 'star') c.star = 1;
  else if (key === 'm' || key === 'fares') c[key] += Math.floor(add);
  return c[key] || 0;
}

/** Note un type de mission réussi aujourd'hui (défi « types différents »). */
export function countType(p, type, now) {
  if (now != null) rollDay(p, now);
  const c = ensureJournal(p).day.c;
  if (typeof type === 'string' && TYPE_IDS.includes(type) && !c.types.includes(type)) c.types.push(type);
  return c.types.length;
}

// ---------------------------------------------------------------- relevé du matin (loyers d'absence)

const PROPERTIES_ALL = P.ALL_PROPERTY_BY_ID || P.PROPERTY_BY_ID || {};
/** Biens de la salle possédés par le joueur : [{ id, name, income }] (income = loyer par heure). */
function rentals(owners, playerId) {
  const out = [];
  for (const id of Object.keys(owners || {})) {
    const prop = own(PROPERTIES_ALL, id);
    if (prop && owners[id]?.id === playerId && +prop.income > 0) out.push({ id, name: prop.name, income: +prop.income });
  }
  return out;
}

/** Borne une table par salle à ROOMS_KEPT entrées : les moins bien notées partent, jamais la salle courante `keep`. */
function trim(table, keep, score) {
  const keys = Object.keys(table);
  if (keys.length <= ROOMS_KEPT) return;
  const rank = (k) => (k === keep ? Infinity : score(k));
  keys.sort((a, b) => rank(b) - rank(a));
  for (const k of keys.slice(ROOMS_KEPT)) delete table[k];
}

/** Note que les loyers de la salle sont à jour à `now` (à chaque accrue, au hello et au détachement). */
export function touchRent(p, roomKey, now) {
  if (!safeKey(roomKey) || !Number.isFinite(now)) return;
  const j = ensureJournal(p);
  j.rentAt[roomKey] = now;
  trim(j.rentAt, roomKey, (k) => j.rentAt[k]);
}

/** Relevé non encaissé de la salle : { rent, sec, props: [{ id, name, rent }] } (réparti au prorata des loyers), ou null. */
export function awayView(p, owners, roomKey) {
  const a = own(ensureJournal(p).away, roomKey);
  if (!a || !(a.rent > 0)) return null;
  const list = rentals(owners, p.id), total = list.reduce((s, r) => s + r.income, 0);
  let left = a.rent;
  const props = list.map((r, i) => {
    const part = i === list.length - 1 ? left : Math.min(left, Math.floor((a.rent * r.income) / total));
    left -= part;
    return { id: r.id, name: r.name, rent: part };
  });
  return { rent: a.rent, sec: a.sec, props };
}

/**
 * Relevé du matin, à appeler au hello AVANT toute réécriture de rentAt : si l'absence (now − rentAt[roomKey]) atteint
 * 30 min, ajoute au relevé de la salle : revenu horaire × min(absence, 12 h) × 50 %. Le non-encaissé se CUMULE d'une
 * absence à l'autre, plafonné à deux relevés pleins (24 h × 50 %). Pose ensuite rentAt[roomKey] = now : la même
 * période n'est jamais comptée deux fois.
 * @returns {{ rent, sec, props, added } | null}  relevé en attente (added = part ajoutée par CET appel), null si rien à encaisser
 */
export function awayRent(p, owners, roomKey, now) {
  if (!safeKey(roomKey) || !Number.isFinite(now)) return null;
  const j = ensureJournal(p), last = own(j.rentAt, roomKey);
  const absent = Number.isFinite(last) ? now - last : 0;
  let added = 0;
  if (absent >= AWAY_MIN_MS) {
    const perHour = rentals(owners, p.id).reduce((s, r) => s + r.income, 0);
    if (perHour > 0) {
      const cur = own(j.away, roomKey) || { rent: 0, sec: 0 };
      const cap = Math.floor(perHour * AWAY_CAP_HOURS * AWAY_RATIO);
      const gain = Math.floor(((perHour * Math.min(absent, AWAY_MAX_MS)) / HOUR_MS) * AWAY_RATIO);
      const rent = Math.max(cur.rent, Math.min(cap, cur.rent + gain));
      added = rent - cur.rent;
      if (rent > 0) {
        j.away[roomKey] = { rent, sec: cur.sec + Math.round(absent / 1000) };
        trim(j.away, roomKey, (k) => j.rentAt[k] || 0);
      }
    }
  }
  touchRent(p, roomKey, now);
  const view = awayView(p, owners, roomKey);
  return view ? { ...view, added } : null;
}

/** Encaisse le relevé de la salle : le retire du journal et retourne son montant (0 s'il n'y en a pas). */
export function takeAway(p, roomKey) {
  const j = ensureJournal(p), a = own(j.away, roomKey);
  if (!a) return 0;
  delete j.away[roomKey];
  return int(a.rent, 1e12);
}

// ---------------------------------------------------------------- vue publique

/**
 * Vue envoyée au client par S.JOURNAL (et dans S.WELCOME.journal). Fait la bascule de jour si nécessaire.
 * @returns {{ day, lv, star, list: [{id, kind, goal, have, reward, claimed, label}], full: {reward, ready, claimed},
 *             streak: {n, best}, resetAt, away: {rent, sec, props: [{id, name, rent}]} | null }}
 *   day = jour du journal ; lv = niveau figé ; star = id de la mission vedette de la ville (ou null) ;
 *   streak.n = série en cours (0 si elle est rompue : dernière journée complète avant hier) ; resetAt = prochaine bascule (ms).
 */
export function publicJournal(p, now, city, owners, roomKey) {
  const st = dailyState(p, now), j = p.journal, s = j.streak;
  const alive = s.last === st.k || (s.last && s.last === prevDayKey(st.k));
  return {
    day: st.k, lv: st.lv, star: starFor(st.k, city, st.lv), list: st.list, full: st.full,
    streak: { n: alive ? s.n : 0, best: s.best }, resetAt: nextResetAt(now),
    away: awayView(p, owners, roomKey),
  };
}

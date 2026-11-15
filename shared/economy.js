// Règles d'économie de Mission Zéro — module PUR (aucune dépendance Node ni navigateur).
// Utilisé par le serveur (autorité) ET par le client en repli hors-ligne : mêmes règles des deux côtés.
// Toutes les fonctions mutent le profil passé et retournent { ok: true, ... } ou { ok: false, code, text }.
//
// Multi-villes : l'argent, les voitures et les statistiques sont globaux au compte ; missions et biens appartiennent
// à UNE ville (ids uniques toutes villes confondues) et ne sont valables que dans une salle de cette ville.
// Les fonctions concernées reçoivent donc la ville de la salle (`city`, « paris » par défaut).
//
// Contrat v6 (boucle fun et rétention) : records par catégorie de voiture, primes de première réussite et de mission
// vedette, verrou de niveau, Atelier (teintes, klaxons), amendes, Chiche, style, réclamations du carnet de bord.
// Le carnet de bord lui-même est dans shared/journal.js, le taxi libre dans shared/jobs.js (qui importe ce module).
// Tout export NOUVEAU d'un autre lot est lu par espace de noms avec repli (CAT.PAINTS || [], CORE.starsFor || …).
import { STARTING_MONEY, STARTER_VEHICLE, VEHICLE_BY_ID } from './catalog.js';
import * as CAT from './catalog.js';
import * as CORE from './content-core.js';
import * as M from './missions.js';
import * as P from './properties.js';
import * as J from './journal.js';
import { CITIES, DEFAULT_CITY } from './cities.js';
import { normColor } from './protocol.js';

const SELL_BACK_RATIO = P.SELL_BACK_RATIO ?? 0.7;

// Tables toutes villes (contrat v5 : ALL_*_BY_ID, *_BY_CITY, cityOf*). Tant que missions.js / properties.js ne les
// exportent pas, repli sur les tables historiques, dont le contenu est celui de Paris.
// Accès par Object.hasOwn : un id comme « constructor » ou « __proto__ » ne doit jamais passer pour une entrée.
const own = (table, id) => (typeof id === 'string' && table && Object.hasOwn(table, id) ? table[id] : undefined);
const MISSIONS_ALL = M.ALL_MISSION_BY_ID || M.MISSION_BY_ID || {};
const PROPERTIES_ALL = P.ALL_PROPERTY_BY_ID || P.PROPERTY_BY_ID || {};
const vehicleById = (id) => own(VEHICLE_BY_ID, id);
const missionById = (id) => own(MISSIONS_ALL, id);
const propertyById = (id) => own(PROPERTIES_ALL, id);

function cityIndex(byCity) {
  const index = new Map();
  for (const [city, items] of Object.entries(byCity || {})) {
    for (const it of Array.isArray(items) ? items : Object.values(items || {})) if (it?.id != null) index.set(it.id, city);
  }
  return index;
}
const MISSION_CITY = cityIndex(M.MISSIONS_BY_CITY);
const PROPERTY_CITY = cityIndex(P.PROPERTIES_BY_CITY);
const knownCity = (c) => (typeof c === 'string' && Object.hasOwn(CITIES, c) ? c : null);

/** Ville d'une mission connue (null si l'id est inconnu). */
export function cityOfMission(id) {
  const m = missionById(id);
  if (!m) return null;
  return knownCity(typeof M.cityOfMission === 'function' ? M.cityOfMission(id) : null) || knownCity(m.city) || knownCity(MISSION_CITY.get(id)) || DEFAULT_CITY;
}
/** Ville d'un bien connu (null si l'id est inconnu). */
export function cityOfProperty(id) {
  const prop = propertyById(id);
  if (!prop) return null;
  return knownCity(typeof P.cityOfProperty === 'function' ? P.cityOfProperty(id) : null) || knownCity(prop.city) || knownCity(PROPERTY_CITY.get(id)) || DEFAULT_CITY;
}
const cityName = (c) => CITIES[knownCity(c) || DEFAULT_CITY].name;

// ---- Tables et constantes du contrat v6
const PAINTS = Array.isArray(CAT.PAINTS) ? CAT.PAINTS : [];
const PAINT_BY_COLOR = CAT.PAINT_BY_COLOR || Object.fromEntries(PAINTS.map((t) => [t.color, t]));
const HORNS = Array.isArray(CAT.HORNS) ? CAT.HORNS : [];
const HORN_BY_ID = CAT.HORN_BY_ID || Object.fromEntries(HORNS.map((h) => [h.id, h]));
const levelFor = CORE.levelForMissionsDone || M.levelForMissionsDone || (() => 1);
const starsFor = CORE.starsFor || ((n = 0) => Math.max(0, Math.floor(((+n || 0) - 40) / 20)));

export const DEFAULT_HORN = 'std';
/**
 * Statistiques du profil (toutes exposées par publicProfile, toujours présentes, 0 par défaut). Les trois premières sont
 * historiques ; les autres viennent du contrat v6 : distance (m, mesurée par le serveur), topSpeed (m/s), fares (courses
 * de taxi), fareBestChain, fareEarned (Ƶ), bestCombo (points), bestDrift (s), bestAir (s), nearMisses, propsBroken,
 * escapes, bestEscapeSec (cavale la plus COURTE ; 0 = aucune), fines, daresWon, bumpsGiven, bumpsTaken, dailyDone.
 */
export const STAT_KEYS = ['missionsDone', 'earned', 'playSeconds', 'distance', 'topSpeed', 'fares', 'fareBestChain', 'fareEarned', 'bestCombo', 'bestDrift', 'bestAir',
  'nearMisses', 'propsBroken', 'escapes', 'bestEscapeSec', 'fines', 'daresWon', 'bumpsGiven', 'bumpsTaken', 'dailyDone'];
const newStats = () => Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
export const CLASS_SPEED = 62; // m/s : au-dessus, la voiture est de catégorie Sport pour les records
export const FINISH_SLACK_M = 250; // tolérance de position à l'arrivée d'une mission (en plus du rayon et de snapTo.max)
export const FIRST_BONUS = 0.25; // prime de première réussite d'une mission
export const STAR_BONUS = 1; // prime de la mission vedette du jour (payée double)
export const PAINT_STOCK_PRICE = 500; // repeindre dans une teinte catalogue du modèle
export const FINE_RATE = 0.03, FINE_PER_KEPI = 300, FINE_COOLDOWN_MS = 60000; // amende : 3 % du solde, plafonnée à 300 × képis × niveau
// Borne physique des records (contrat v6, correctif « records impossibles ») : un temps n'entre aux records et n'ouvre
// droit aux primes que si la durée du serveur est tenable pour la catégorie de la voiture.
export const TOP_SPEED_SLACK = 1.08; // la physique laisse dépasser la vitesse de pointe du catalogue de 8 %
export const ROUTE_SLACK = 0.8; // marge sur la longueur du parcours (marqueurs recalés sur la chaussée côté client)
export const MOVED_MIN_RATIO = 0.8; // part de cette longueur que le serveur doit avoir MESURÉE dans les états reçus
export const STYLE_LIMITS = { WIN_MAX_SEC: 120, MIN_MOVED_M: 50, PTS_PER_SEC: 2500, PTS_PER_M: 60, COMBO_MAX: 60000, DRIFT_MAX: 60, AIR_MAX: 6, NEAR_PER_SEC: 2, PROPS_PER_SEC: 8 };

/** Catégorie de records d'un modèle : 's' (Sport) si sa vitesse de pointe dépasse CLASS_SPEED, sinon 'v' (Ville, à pied compris). */
export function classOf(typeId) {
  const v = vehicleById(typeId);
  return v && +v.maxSpeed > CLASS_SPEED ? 's' : 'v';
}
/** Niveau du joueur (1..6), d'après ses missions réussies toutes villes confondues. */
export const levelOf = (p) => levelFor(+p?.stats?.missionsDone || 0);
/** Étoiles de Légende du joueur. */
export const starsOf = (p) => starsFor(+p?.stats?.missionsDone || 0);

export const MAX_MONEY = 1e12;
export const MAX_TRANSFER = 1e9;
export const NAME_MIN = 2, NAME_MAX = 16, ROOM_MAX = 24, CHAT_MAX = 200;
const DURATION_TOLERANCE_SEC = 0.75; // marge réseau sur la durée minimale d'une mission

const fail = (code, text) => ({ ok: false, code, text });
const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
/** Écriture de l'argent, la même partout : « Ƶ 1 234 » (symbole, espace insécable, montant à la française). */
export const fmtMoney = (n) => 'Ƶ\u00a0' + fmtInt(n);
const fmt = fmtMoney;

/**
 * Lecture TYPÉE d'un champ texte reçu du réseau : une chaîne (ou un nombre fini) telle quelle, tout le reste vaut ''.
 * Jamais String(v) sur une valeur inconnue : un objet { toString: 1 } ferait lever une exception.
 */
export const text = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

// Caractères sans dessin que \p{L} laisse passer (remplissages coréens U+3164, U+115F, U+1160, U+FFA0) et points de code
// ignorables par défaut : un pseudo qui n'en serait fait s'afficherait vide dans le chat et les annonces.
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\u3164\u115f\u1160\uffa0]/gu;
// Marques de sens d'écriture (U+200E, U+200F, U+202A à U+202E, U+2066 à U+2069) : elles retourneraient le texte affiché.
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
// Pseudos réservés : les lignes du serveur sont signées « Système ». Comparaison sans accents, sans casse, lettres seules.
const RESERVED_NAMES = new Set(['systeme', 'system']);
const nameKey = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '');

/** Pseudo nettoyé : lettres/chiffres/espace/_/-, 2 à 16 caractères VISIBLES ; jamais « Système ». Sinon « Invité ». */
export function sanitizeName(raw) {
  let s = text(raw).normalize('NFC').replace(INVISIBLE, '').replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  if (s.length < NAME_MIN || RESERVED_NAMES.has(nameKey(s))) s = 'Invité';
  return s;
}
/** Code de salle : minuscules, chiffres, _ et -, 24 caractères max ; « paris » par défaut. */
export function sanitizeRoom(raw) {
  const s = text(raw).normalize('NFKD').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, ROOM_MAX);
  return s || 'paris';
}
/** Message de chat : caractères de contrôle et marques de sens d'écriture retirés, chevrons neutralisés (anti-injection HTML), longueur bornée. */
export function sanitizeChat(raw) {
  return text(raw).replace(/[\x00-\x1f\x7f\u2028\u2029]/g, ' ').replace(BIDI, '').replace(/</g, '‹').replace(/>/g, '›')
    .replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
}

export function newProfile(id, name) {
  return {
    id, name, money: STARTING_MONEY, cars: [STARTER_VEHICLE], activeCar: STARTER_VEHICLE,
    stats: newStats(),
    cooldowns: {}, // missionId -> horodatage (ms) de la dernière réussite
    rentCarry: 0, // fraction de loyer non encore créditée
    best: {}, // missionId -> { v?: sec, s?: sec } : records personnels par catégorie (jamais dans publicProfile)
    carColors: {}, // typeId -> '#rrggbb' : teinte de chaque voiture possédée (absent = première teinte du catalogue)
    look: { h: DEFAULT_HORN }, // apparence : klaxon signature
    journal: J.newJournal(), // carnet de bord (shared/journal.js ; jamais dans publicProfile)
  };
}

/** Répare un profil chargé (champs manquants, voitures inconnues du catalogue…). */
export function normalizeProfile(p) {
  p.money = Math.max(0, Math.min(MAX_MONEY, Math.floor(+p.money || 0)));
  p.cars = [...new Set((Array.isArray(p.cars) ? p.cars : []).filter((c) => vehicleById(c)))];
  if (!p.cars.includes(STARTER_VEHICLE)) p.cars.unshift(STARTER_VEHICLE);
  if (!p.cars.includes(p.activeCar)) p.activeCar = p.cars[0];
  // statistiques : uniquement des nombres finis et positifs ; les compteurs du contrat v6 naissent à 0
  const stats = { ...newStats(), ...(p.stats && typeof p.stats === 'object' ? p.stats : {}) };
  for (const k of Object.keys(stats)) { const n = +stats[k]; if (Number.isFinite(n) && n >= 0) stats[k] = n; else if (STAT_KEYS.includes(k)) stats[k] = 0; else delete stats[k]; }
  p.stats = stats;
  p.cooldowns = p.cooldowns && typeof p.cooldowns === 'object' ? p.cooldowns : {};
  p.rentCarry = +p.rentCarry || 0;
  // ---- champs du contrat v6, absents des profils enregistrés avant
  const best = {};
  for (const [id, rec] of Object.entries(p.best && typeof p.best === 'object' ? p.best : {})) {
    if (!missionById(id) || !rec || typeof rec !== 'object') continue;
    const out = {};
    for (const cls of ['v', 's']) if (Number.isFinite(rec[cls]) && rec[cls] > 0) out[cls] = Math.round(rec[cls] * 10) / 10;
    if (out.v != null || out.s != null) best[id] = out;
  }
  p.best = best;
  const colors = {};
  for (const [typeId, c] of Object.entries(p.carColors && typeof p.carColors === 'object' ? p.carColors : {})) {
    const col = normColor(c);
    if (col && p.cars.includes(typeId)) colors[typeId] = col;
  }
  p.carColors = colors;
  const horn = p.look && typeof p.look === 'object' ? p.look.h : null;
  p.look = { h: horn !== DEFAULT_HORN && own(HORN_BY_ID, horn) ? horn : DEFAULT_HORN }; // klaxon retiré du catalogue : retour à l'origine
  p.journal = J.normalizeJournal(p.journal);
  return p;
}

/**
 * Vue envoyée au client (store.me). `properties` = biens possédés dans la salle courante.
 * `city` = ville de la salle : les cooldowns sont alors filtrés sur les missions de cette ville (présence de la clé =
 * mission déjà réussie) ; sans `city`, tous les cooldowns sont renvoyés. `best` et `journal` ne sont jamais exposés ici.
 */
export function publicProfile(p, properties = [], city) {
  let cooldowns = p.cooldowns;
  if (city != null) {
    const c = knownCity(city) || DEFAULT_CITY;
    cooldowns = {};
    for (const id of Object.keys(p.cooldowns)) if (cityOfMission(id) === c) cooldowns[id] = p.cooldowns[id];
  }
  const stats = { ...p.stats, playSeconds: Math.floor(p.stats.playSeconds) };
  if (stats.distance) stats.distance = Math.round(stats.distance);
  if (stats.topSpeed) stats.topSpeed = Math.round(stats.topSpeed * 10) / 10;
  return {
    id: p.id, name: p.name, money: p.money, properties: [...properties], cars: [...p.cars], activeCar: p.activeCar,
    stats, cooldowns: { ...cooldowns }, carColors: { ...(p.carColors || {}) }, look: { h: p.look?.h || DEFAULT_HORN },
  };
}

/** Crédite (ou débite) le solde, borné à [0, MAX_MONEY] ; un gain compte dans stats.earned sauf `earned = false`. Retourne la variation réelle. */
export function credit(p, amount, earned = true) {
  const before = p.money;
  p.money = Math.max(0, Math.min(MAX_MONEY, p.money + amount));
  if (earned && amount > 0) p.stats.earned += p.money - before;
  return p.money - before;
}

// ---------------------------------------------------------------- missions
// `session` = état volatil { mission: { id, startedAt, sport, moved } | null, job: <course de taxi> | null } : une seule
// activité à la fois. `sport` est posé par le serveur dès qu'un état en mode véhicule déclare un modèle de
// catégorie Sport pendant la mission (voir classOf). `moved` = chemin (m) mesuré par le serveur depuis le départ,
// téléportations exclues ; null quand il n'est plus fiable (reconnexion en cours de mission) ou pas mesuré (hors-ligne).

function wrongCityMission(id, city) {
  const home = cityOfMission(id);
  return home === (knownCity(city) || DEFAULT_CITY) ? null
    : fail('wrong_city', `Cette mission se joue à ${cityName(home)} : elle n'est pas disponible à ${cityName(city)}.`);
}

export function missionStart(p, session, id, now, city = DEFAULT_CITY) {
  const m = missionById(id);
  if (!m) return fail('unknown_mission', 'Mission inconnue.');
  const wrong = wrongCityMission(id, city);
  if (wrong) return wrong;
  const need = Math.floor(+m.level || 1), level = levelOf(p);
  if (need > level) return fail('locked', `Mission verrouillée : niveau ${need} requis (vous êtes niveau ${level}).`);
  const wait = cooldownLeft(p, id, now);
  if (wait > 0) return fail('cooldown', `Mission disponible dans ${Math.ceil(wait)} s.`);
  session.job = null; // une mission annule la course de taxi en cours
  // remplace une éventuelle mission en cours (abandon implicite) ; moved = chemin mesuré par le serveur (null = inconnu)
  session.mission = { id, startedAt: now, sport: false, moved: 0 };
  return { ok: true, id };
}

export function missionAbort(session) { session.mission = null; return { ok: true }; }

export function cooldownLeft(p, id, now) {
  const m = missionById(id), last = m ? own(p.cooldowns, id) : 0;
  if (!m || !last) return 0;
  return Math.max(0, (last + (m.cooldownSec || 0) * 1000 - now) / 1000);
}

/** Les records (personnels et de salle) ne concernent pas les missions photo. */
export const missionTimed = (id) => { const m = missionById(id); return !!m && m.type !== 'photo'; };

/** Position plausible à l'arrivée : à moins de rayon + 250 m + snapTo.max de la dernière étape (d'une étape quelconque si anyOrder). */
function finishOkAt(m, pos) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return false;
  const steps = Array.isArray(m.steps) ? m.steps : [];
  if (!steps.length) return true;
  const near = (s) => Math.hypot(pos.x - s.x, pos.z - s.z) <= (+s.radius || 0) + FINISH_SLACK_M + (+s.snapTo?.max || 0);
  return m.anyOrder ? steps.some(near) : near(steps[steps.length - 1]);
}

const SPORT_SPEED = Math.max(CLASS_SPEED, ...(CAT.VEHICLES || []).map((v) => +v.maxSpeed || 0)); // voiture la plus rapide du catalogue
const floors = new Map();
/**
 * Plancher physique d'une mission : { len, holds } — longueur à vol d'oiseau du parcours PAR LES ÉTAPES (départ -> étape 1
 * -> … -> dernière), rayons et recalages (snapTo.max) déduits, et somme des arrêts imposés. En ordre libre (anyOrder) :
 * au moins l'étape la plus éloignée du départ. Même calcul que missionMinDuration (shared/content-core.js).
 */
function missionFloor(m) {
  let f = floors.get(m.id);
  if (f) return f;
  const steps = (Array.isArray(m.steps) ? m.steps : []).filter((st) => st && Number.isFinite(st.x) && Number.isFinite(st.z));
  const reach = (st) => (+st.radius || 0) + (+st.snapTo?.max || 0);
  const start = m.start && Number.isFinite(m.start.x) && Number.isFinite(m.start.z) ? m.start : null;
  let len = 0;
  if (start && m.anyOrder) for (const st of steps) len = Math.max(len, Math.hypot(st.x - start.x, st.z - start.z) - reach(st) - 8);
  else if (start) {
    let prev = start, prevR = 8;
    for (const st of steps) { len += Math.max(0, Math.hypot(st.x - prev.x, st.z - prev.z) - reach(st) - prevR); prev = st; prevR = reach(st); }
  }
  f = { len: Math.max(0, len), holds: steps.reduce((t, st) => t + (+st.holdSec || 0), 0) };
  floors.set(m.id, f);
  return f;
}
/**
 * Durée minimale tenable (s) d'une mission dans la catégorie `cls` : parcours × 0,8 à la vitesse de pointe de la
 * catégorie (Ville : CLASS_SPEED ; Sport : voiture la plus rapide du catalogue), majorée de 8 %, plus 90 % des arrêts.
 */
export function recordFloorSec(id, cls) {
  const m = missionById(id);
  if (!m) return 0;
  const f = missionFloor(m);
  return (f.len * ROUTE_SLACK) / ((cls === 's' ? SPORT_SPEED : CLASS_SPEED) * TOP_SPEED_SLACK) + f.holds * 0.9;
}
/** Chemin minimal (m) que le serveur doit avoir mesuré pendant la mission pour qu'un temps soit crédible. */
export function recordFloorMoved(id) {
  const m = missionById(id);
  return m ? missionFloor(m).len * MOVED_MIN_RATIO : 0;
}

/**
 * Réussite d'une mission. `ctx` = { pos: {x, z} dernière position connue du serveur, dayKey?: jour du journal déjà calculé,
 * moved?: chemin (m) mesuré par le serveur depuis mission_start, téléportations exclues (absent ou null = inconnu) }.
 * Le GAIN de base n'est jamais refusé, ni pour la position ni pour le temps ; record personnel, prime de première
 * réussite (25 %) et prime de mission vedette (100 %, une fois par jour) exigent finishOk : arrivée plausible ET temps
 * physiquement tenable (durée du serveur >= recordFloorSec de la catégorie ; chemin mesuré >= recordFloorMoved quand
 * il est connu). La durée déclarée par le client n'est pas lue.
 * @returns {{ ok: true, id, reward (total crédité), base, first, star, sec (durée serveur, 0,1 s près), cls: 'v'|'s',
 *   best (ancien record personnel de la catégorie | null), pb, finishOk, timed (mission à records), done (missionsDone après),
 *   level, levelUp, stars, starUp, title, delta, reason: 'mission' }}
 */
export function missionComplete(p, session, id, now, city = DEFAULT_CITY, ctx = {}) {
  const m = missionById(id);
  if (!m) return fail('unknown_mission', 'Mission inconnue.');
  const wrong = wrongCityMission(id, city); // mission démarrée dans une ville, « terminée » depuis une autre
  if (wrong) { if (session.mission?.id === id) session.mission = null; return wrong; }
  const cur = session.mission;
  if (!cur || cur.id !== id) return fail('not_started', "Cette mission n'a pas été démarrée.");
  const elapsed = (now - cur.startedAt) / 1000;
  if (elapsed + DURATION_TOLERANCE_SEC < (m.minDurationSec || 0)) {
    session.mission = null;
    return fail('too_fast', 'Mission terminée trop vite : gain refusé.');
  }
  const wait = cooldownLeft(p, id, now);
  if (wait > 0) { session.mission = null; return fail('cooldown', `Mission disponible dans ${Math.ceil(wait)} s.`); }
  session.mission = null;
  J.rollDay(p, now, ctx?.dayKey);
  const day = p.journal.day;
  const sec = Math.max(0.1, Math.round(elapsed * 10) / 10);
  const cls = cur.sport ? 's' : 'v';
  // temps impossible (téléportation à l'arrivée, états en ligne droite au-delà de la vitesse de pointe) : la réussite
  // reste payée, mais ni record ni prime
  const moved = ctx?.moved;
  const feasible = elapsed + DURATION_TOLERANCE_SEC >= recordFloorSec(id, cls) && (!Number.isFinite(moved) || moved >= recordFloorMoved(id));
  const finishOk = finishOkAt(m, ctx?.pos) && feasible;
  const timed = m.type !== 'photo';
  const base = Math.max(0, Math.floor(+m.reward || 0));
  // prime de première réussite : aucune clé dans cooldowns = mission jamais réussie
  const first = finishOk && !Object.hasOwn(p.cooldowns, id) ? Math.floor(base * FIRST_BONUS) : 0;
  // prime de mission vedette : une fois par jour, toutes villes confondues
  const isStar = finishOk && !day.c.star && id === J.starFor(day.k, city, day.lv);
  const star = isStar ? Math.floor(base * STAR_BONUS) : 0;
  // record personnel de la catégorie
  const old = own(p.best, id)?.[cls];
  const best = Number.isFinite(old) ? old : null;
  const pb = finishOk && timed && (best == null || sec < best);
  if (pb) { if (!Object.hasOwn(p.best, id)) p.best[id] = {}; p.best[id][cls] = sec; }

  p.cooldowns[id] = now;
  const levelBefore = levelOf(p), starsBefore = starsOf(p);
  const delta = credit(p, base + first + star);
  p.stats.missionsDone += 1;
  J.count(p, 'm', 1);
  J.countType(p, m.type);
  if (isStar) J.count(p, 'star', 1);
  const level = levelOf(p), stars = starsOf(p);
  return {
    ok: true, id, reward: delta, base, first, star, sec, cls, best, pb, finishOk, timed, done: p.stats.missionsDone,
    level, levelUp: level > levelBefore, stars, starUp: stars > starsBefore, title: m.title || id, delta, reason: 'mission',
  };
}

// ---------------------------------------------------------------- véhicules

/** Achat. `color` (facultatif) = teinte choisie : retenue si elle figure dans spec.colors du modèle, sinon ignorée. */
export function buyCar(p, typeId, color) {
  const v = vehicleById(typeId);
  if (!v || !Number.isFinite(v.price)) return fail('unknown_car', 'Véhicule inconnu.');
  if (p.cars.includes(typeId)) return fail('already_owned', 'Vous possédez déjà ce véhicule.');
  if (p.money < v.price) return fail('no_funds', `Fonds insuffisants : il manque ${fmt(v.price - p.money)}.`);
  const delta = credit(p, -v.price, false);
  p.cars.push(typeId);
  p.activeCar = typeId;
  const col = normColor(color);
  if (col && Array.isArray(v.colors) && v.colors.includes(col)) (p.carColors ||= {})[typeId] = col;
  return { ok: true, delta, reason: 'achat véhicule', name: v.name, typeId, color: p.carColors?.[typeId] || v.colors?.[0] || null };
}

// ---------------------------------------------------------------- Atelier : teintes et klaxons

const UNLOCK_TEXT = {
  level: (n) => `niveau ${n} requis`,
  streak: (n) => `série de ${n} jours requise`,
  fares: (n) => `${n} courses de taxi requises`,
  escapes: (n) => (n > 1 ? `${n} cavales réussies requises` : 'une cavale réussie requise'),
  dares: (n) => (n > 1 ? `${n} Chiches gagnés requis` : 'un Chiche gagné requis'),
  combo: (n) => `combo de ${fmtInt(n)} points requis`,
  stars: (n) => (n > 1 ? `${n} étoiles de Légende requises` : 'une étoile de Légende requise'),
};
const unlockText = (rule) => Object.keys(rule || {}).map((k) => (UNLOCK_TEXT[k] ? UNLOCK_TEXT[k](rule[k]) : 'condition inconnue')).join(', ');

/** Valeurs du joueur lues par les conditions de déblocage : toutes MONOTONES (rien ne se reverrouille jamais). */
function unlockValue(p, key) {
  const st = p.stats || {};
  if (key === 'level') return levelOf(p);
  if (key === 'streak') return +p.journal?.streak?.best || 0; // la MEILLEURE série, pas la série en cours
  if (key === 'fares') return +st.fares || 0;
  if (key === 'escapes') return +st.escapes || 0;
  if (key === 'dares') return +st.daresWon || 0;
  if (key === 'combo') return +st.bestCombo || 0;
  if (key === 'stars') return starsOf(p);
  return NaN; // condition inconnue de ce serveur : verrouillée
}

/** true si le joueur remplit la condition `rule` { level?, streak?, fares?, escapes?, dares?, combo?, stars? } (absente = libre). */
export function unlocked(p, rule) {
  if (!rule || typeof rule !== 'object') return true;
  for (const k of Object.keys(rule)) if (!(unlockValue(p, k) >= +rule[k])) return false;
  return true;
}

/** Klaxons que le joueur peut choisir : ids du catalogue dont la condition est remplie ('std' toujours). */
export function hornsFor(p) {
  const out = [DEFAULT_HORN];
  for (const h of HORNS) if (h.id !== DEFAULT_HORN && unlocked(p, h.unlock)) out.push(h.id);
  return out;
}

/** Choix du klaxon signature : { horn }. Retourne { ok, look: { h }, changed }. */
export function setLook(p, look) {
  const id = typeof look?.horn === 'string' ? look.horn : '';
  const h = id === DEFAULT_HORN ? { id } : own(HORN_BY_ID, id);
  if (!h) return fail('unknown_horn', 'Klaxon inconnu.');
  if (!unlocked(p, h.unlock)) return fail('locked', `Klaxon verrouillé : ${unlockText(h.unlock)}.`);
  const changed = p.look?.h !== id;
  p.look = { h: id };
  return { ok: true, look: { h: id }, changed };
}

/**
 * Repeindre une voiture possédée. Teinte de spec.colors du modèle : 500 Ƶ ; teinte du nuancier CAT.PAINTS : prix de la
 * table (0 pour une exclusive), refusée ('locked') tant que sa condition n'est pas remplie.
 */
export function paintCar(p, typeId, color) {
  const v = vehicleById(typeId);
  if (!v || !p.cars.includes(typeId)) return fail('not_owned', 'Vous ne possédez pas ce véhicule.');
  const col = normColor(color);
  if (!col) return fail('bad_color', 'Teinte inconnue.');
  const stock = Array.isArray(v.colors) ? v.colors : [];
  let price = PAINT_STOCK_PRICE, name = 'teinte catalogue';
  if (!stock.includes(col)) {
    const paint = own(PAINT_BY_COLOR, col);
    if (!paint) return fail('bad_color', "Cette teinte n'est pas au nuancier de l'Atelier.");
    if (!unlocked(p, paint.unlock)) return fail('locked', `Teinte « ${paint.name} » verrouillée : ${unlockText(paint.unlock)}.`);
    price = Math.max(0, Math.floor(+paint.price || 0)); name = paint.name;
  }
  if ((p.carColors?.[typeId] || stock[0]) === col) return fail('same_color', 'Votre voiture porte déjà cette teinte.');
  if (p.money < price) return fail('no_funds', `Fonds insuffisants : il manque ${fmt(price - p.money)}.`);
  const delta = credit(p, -price, false);
  (p.carColors ||= {})[typeId] = col;
  return { ok: true, delta, reason: 'peinture', typeId, color: col, name, price };
}

export function setActiveCar(p, typeId) {
  if (!vehicleById(typeId) || !p.cars.includes(typeId)) return fail('not_owned', 'Vous ne possédez pas ce véhicule.');
  p.activeCar = typeId;
  return { ok: true };
}

// ---------------------------------------------------------------- immobilier
// `owners` = registre de la salle { propertyId: { id, name } } : un bien n'a qu'un propriétaire par salle.
// Une salle appartient à une ville : son registre ne contient que des biens de cette ville.

export function ownedProperties(owners, playerId) {
  return Object.keys(owners).filter((k) => owners[k]?.id === playerId && propertyById(k));
}

function wrongCityProperty(id, city) {
  const home = cityOfProperty(id);
  return home === (knownCity(city) || DEFAULT_CITY) ? null
    : fail('wrong_city', `Ce bien se trouve à ${cityName(home)} : il n'est pas disponible à ${cityName(city)}.`);
}

export function buyProperty(p, owners, id, city = DEFAULT_CITY) {
  const prop = propertyById(id);
  if (!prop || !Number.isFinite(prop.price)) return fail('unknown_property', 'Bien inconnu.');
  const wrong = wrongCityProperty(id, city);
  if (wrong) return wrong;
  const o = own(owners, id);
  if (o) return fail('already_owned', o.id === p.id ? 'Ce bien vous appartient déjà.' : `Ce bien appartient déjà à ${o.name}.`);
  if (p.money < prop.price) return fail('no_funds', `Fonds insuffisants : il manque ${fmt(prop.price - p.money)}.`);
  const delta = credit(p, -prop.price, false);
  owners[id] = { id: p.id, name: p.name };
  return { ok: true, delta, reason: 'achat immobilier', name: prop.name };
}

export function sellProperty(p, owners, id, city = DEFAULT_CITY) {
  const prop = propertyById(id);
  if (!prop || !Number.isFinite(prop.price)) return fail('unknown_property', 'Bien inconnu.');
  const wrong = wrongCityProperty(id, city);
  if (wrong) return wrong;
  if (own(owners, id)?.id !== p.id) return fail('not_owned', 'Ce bien ne vous appartient pas.');
  delete owners[id];
  const delta = credit(p, Math.floor(prop.price * SELL_BACK_RATIO), false);
  return { ok: true, delta, reason: 'vente immobilière', name: prop.name };
}

/** Fortune totale : liquidités + prix catalogue des voitures + prix des biens possédés dans la salle (`owners`). */
export function worth(p, owners = {}) {
  let total = +p.money || 0;
  for (const id of p.cars || []) total += +vehicleById(id)?.price || 0;
  for (const id of ownedProperties(owners || {}, p.id)) total += +propertyById(id).price || 0;
  return total;
}

/**
 * Loyers : `income` par heure connectée, au prorata de `seconds`. Retourne le montant entier crédité.
 * `at` (facultatif) = { now, roomKey } : note dans le journal que les loyers de la salle sont à jour (relevé du matin).
 */
export function accrue(p, owners, seconds, at) {
  if (at && at.roomKey != null) J.touchRent(p, at.roomKey, at.now);
  if (!(seconds > 0)) return 0;
  p.stats.playSeconds += seconds;
  let perHour = 0;
  for (const id of ownedProperties(owners, p.id)) perHour += +propertyById(id).income || 0;
  if (perHour <= 0) return 0;
  p.rentCarry += (perHour * seconds) / 3600;
  const whole = Math.floor(p.rentCarry);
  if (whole <= 0) return 0;
  p.rentCarry -= whole;
  return credit(p, whole);
}

// ---------------------------------------------------------------- virements

export function transfer(from, to, amount) {
  if (!to) return fail('unknown_player', "Ce joueur n'est pas dans la salle.");
  if (to.id === from.id) return fail('self', 'Impossible de se faire un virement à soi-même.');
  if (!Number.isSafeInteger(amount) || amount <= 0) return fail('bad_amount', 'Montant invalide : entier positif attendu.');
  if (amount > MAX_TRANSFER) return fail('bad_amount', 'Montant trop élevé.');
  if (amount > from.money) return fail('no_funds', 'Fonds insuffisants pour ce virement.');
  if (to.money + amount > MAX_MONEY) return fail('bad_amount', 'Le destinataire a atteint le plafond.');
  from.money -= amount;
  to.money += amount;
  return { ok: true, amount };
}

// ---------------------------------------------------------------- képis : amende

/**
 * Amende d'un contrôle de police à `k` képis : min(3 % du solde, 300 × k × niveau), jamais plus que le solde,
 * au plus une par minute ('cooldown' sinon). Retourne { ok, amount, delta: -amount, reason: 'amende' }.
 */
export function fine(p, k, now) {
  const j = J.ensureJournal(p);
  if (j.fineAt && now - j.fineAt >= 0 && now - j.fineAt < FINE_COOLDOWN_MS) return fail('cooldown', 'Vous venez déjà de payer une amende.');
  const kepis = Math.max(1, Math.min(3, Math.floor(+k) || 1));
  const amount = Math.max(0, Math.min(Math.floor(p.money * FINE_RATE), FINE_PER_KEPI * kepis * levelOf(p), p.money));
  j.fineAt = now;
  const before = p.money;
  credit(p, -amount, false);
  p.stats.fines = (p.stats.fines || 0) + 1;
  return { ok: true, amount: before - p.money, delta: p.money - before, reason: 'amende' };
}

// ---------------------------------------------------------------- Chiche : règlement

/**
 * Règlement d'un Chiche, à SOMME NULLE : chaque perdant paie min(stake, son solde) au vainqueur (rien n'est débité avant
 * la fin). stats.earned n'est pas touché ; stats.daresWon du vainqueur augmente.
 * @returns {{ ok: true, pot, paid: [{ id, amount }], delta: pot, reason: 'chiche' }}  pot = gain net du vainqueur
 */
export function settleDare(winner, losers, stake) {
  const bet = Math.max(0, Math.floor(+stake) || 0), paid = [];
  let pot = 0;
  for (const l of losers || []) {
    if (!l || l === winner || l.id === winner.id) continue;
    const amount = Math.max(0, Math.min(bet, l.money, MAX_MONEY - winner.money));
    l.money -= amount; winner.money += amount; pot += amount;
    paid.push({ id: l.id, amount });
  }
  winner.stats.daresWon = (winner.stats.daresWon || 0) + 1;
  return { ok: true, pot, paid, delta: pot, reason: 'chiche' };
}

// ---------------------------------------------------------------- style

const pos0 = (v) => (Number.isFinite(+v) && +v > 0 ? +v : 0);

/**
 * Rapport de style d'une fenêtre. `ctx` = { winSec: durée SERVEUR de la fenêtre, movedM: chemin mesuré par le serveur,
 * inVehicle, now? (bascule de jour du journal) }. Refusé hors véhicule ('on_foot') ou si movedM < 50 ('ignored') ;
 * sinon les valeurs sont ROGNÉES, jamais rejetées : pts <= min(2 500 × winSec, 60 × movedM), combo <= min(pts, 60 000),
 * drift <= min(60, winSec), air <= 6, near <= 2 × winSec, props <= 8 × winSec. Aucun argent.
 * @returns {{ ok: true, pts, combo, drift, air, near, props, record (bestCombo battu), prevBest, best }}
 */
export function styleReport(p, report, ctx = {}) {
  if (!ctx.inVehicle) return fail('on_foot', 'Le style se gagne au volant.');
  const winSec = Math.min(STYLE_LIMITS.WIN_MAX_SEC, pos0(ctx.winSec)), movedM = pos0(ctx.movedM);
  if (movedM < STYLE_LIMITS.MIN_MOVED_M) return fail('ignored', 'Rapport de style ignoré.');
  const r = report || {};
  const pts = Math.floor(Math.min(pos0(r.pts), STYLE_LIMITS.PTS_PER_SEC * winSec, STYLE_LIMITS.PTS_PER_M * movedM));
  const combo = Math.floor(Math.min(pos0(r.combo), pts, STYLE_LIMITS.COMBO_MAX));
  const drift = Math.round(Math.min(pos0(r.drift), STYLE_LIMITS.DRIFT_MAX, winSec) * 10) / 10;
  const air = Math.round(Math.min(pos0(r.air), STYLE_LIMITS.AIR_MAX) * 10) / 10;
  const near = Math.floor(Math.min(pos0(r.near), STYLE_LIMITS.NEAR_PER_SEC * winSec));
  const props = Math.floor(Math.min(pos0(r.props), STYLE_LIMITS.PROPS_PER_SEC * winSec));
  const st = p.stats, prevBest = st.bestCombo || 0;
  if (combo > prevBest) st.bestCombo = combo;
  if (drift > (st.bestDrift || 0)) st.bestDrift = drift;
  if (air > (st.bestAir || 0)) st.bestAir = air;
  if (near) st.nearMisses = (st.nearMisses || 0) + near;
  if (props) st.propsBroken = (st.propsBroken || 0) + props;
  J.count(p, 'style', pts, Number.isFinite(ctx.now) ? ctx.now : undefined);
  return { ok: true, pts, combo, drift, air, near, props, record: combo > prevBest, prevBest, best: st.bestCombo || 0 };
}

// ---------------------------------------------------------------- réclamations du carnet de bord

/**
 * Réclamation. `what` = { kind: 'daily', id: 'd1' | 'd2' | 'd3' | 'full' } ou { kind: 'away' } ; `ctx` = { now, roomKey, city }.
 *   daily d1..d3 : objectif atteint et pas encore encaissé -> R (motif 'défi du jour'), stats.dailyDone + 1
 *   daily full   : les trois objectifs atteints -> 1,5 × R × (1 + 0,1 × min(série, 5)) (motif 'journée complète') ;
 *                  la série avance (voir journal.completeDay) ; retour + { streak: { n, best }, streakUp }
 *   away         : relevé du matin de la salle `roomKey` (motif 'loyers')
 * Refus : 'bad_claim', 'not_ready', 'claimed', 'nothing'.
 */
export function claim(p, what, ctx = {}) {
  const kind = what?.kind, now = ctx.now;
  if (kind === 'away') {
    const amount = J.takeAway(p, ctx.roomKey);
    if (!(amount > 0)) return fail('nothing', 'Aucun loyer à encaisser.');
    const delta = credit(p, amount);
    return { ok: true, kind, amount, delta, reason: 'loyers' };
  }
  if (kind !== 'daily' || !Number.isFinite(now)) return fail('bad_claim', 'Réclamation inconnue.');
  const state = J.dailyState(p, now), id = what.id;
  if (id === 'full') {
    if (state.full.claimed) return fail('claimed', 'La prime de journée complète est déjà encaissée.');
    if (!state.full.ready) return fail('not_ready', "Il reste des défis du jour à réussir.");
    const streak = J.completeDay(p);
    const delta = credit(p, state.full.reward);
    return { ok: true, kind, id, amount: state.full.reward, delta, reason: 'journée complète', streak: { n: streak.n, best: streak.best }, streakUp: streak.up };
  }
  const entry = state.list.find((e) => e.id === id);
  if (!entry) return fail('bad_claim', 'Défi inconnu.');
  if (entry.claimed) return fail('claimed', 'Ce défi est déjà encaissé.');
  if (entry.have < entry.goal) return fail('not_ready', "Ce défi n'est pas encore réussi.");
  p.journal.day.claimed.push(id);
  p.stats.dailyDone = (p.stats.dailyDone || 0) + 1;
  const delta = credit(p, entry.reward);
  return { ok: true, kind, id, amount: entry.reward, delta, reason: 'défi du jour' };
}

/**
 * Défis de la veille : à la bascule de 4 h, journal.rollDay solde d'office les défis réussis mais pas réclamés (et la
 * journée complète, qui fait avancer la série) et en garde le montant dans journal.due. Cette fonction le crédite.
 * À appeler après toute bascule possible (hello, tick du journal). Refus : 'nothing'.
 * @returns {{ ok: true, amount, delta, reason: 'défis de la veille', streak: { n, best }, streakUp }}
 *   streakUp = la journée complète soldée d'office a fait avancer la série (n = sa nouvelle valeur)
 */
export function settleDue(p) {
  const j = J.ensureJournal(p), amount = Math.floor(+j.due) || 0, n = Math.floor(+j.dueN) || 0;
  if (!(amount > 0)) { j.due = 0; j.dueN = 0; return fail('nothing', 'Aucun défi de la veille à solder.'); }
  j.due = 0; j.dueN = 0;
  const delta = credit(p, amount);
  return { ok: true, amount, delta, reason: 'défis de la veille', streak: { n: n || j.streak.n, best: j.streak.best }, streakUp: n > 0 };
}

// ---------------------------------------------------------------- limite de débit (seau à jetons)

export function createBucket(capacity, refillPerSec) {
  let tokens = capacity, last = 0;
  return {
    take(now, cost = 1) {
      if (last) tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec);
      last = now;
      if (tokens < cost) return false;
      tokens -= cost;
      return true;
    },
  };
}

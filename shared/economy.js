// Règles d'économie de Mission Zéro — module PUR (aucune dépendance Node ni navigateur).
// Utilisé par le serveur (autorité) ET par le client en repli hors-ligne : mêmes règles des deux côtés.
// Toutes les fonctions mutent le profil passé et retournent { ok: true, ... } ou { ok: false, code, text }.
import { STARTING_MONEY, STARTER_VEHICLE, VEHICLE_BY_ID } from './catalog.js';
import { MISSION_BY_ID } from './missions.js';
import { PROPERTY_BY_ID, SELL_BACK_RATIO } from './properties.js';

export const MAX_MONEY = 1e12;
export const MAX_TRANSFER = 1e9;
export const NAME_MIN = 2, NAME_MAX = 16, ROOM_MAX = 24, CHAT_MAX = 200;
const DURATION_TOLERANCE_SEC = 0.75; // marge réseau sur la durée minimale d'une mission

const fail = (code, text) => ({ ok: false, code, text });
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + ' Ƶ';

/** Pseudo nettoyé : lettres/chiffres/espace/_/-, 2 à 16 caractères. */
export function sanitizeName(raw) {
  let s = String(raw ?? '').normalize('NFC').replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  if (s.length < NAME_MIN) s = 'Invité';
  return s;
}
/** Code de salle : minuscules, chiffres, _ et -, 24 caractères max ; « paris » par défaut. */
export function sanitizeRoom(raw) {
  const s = String(raw ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, ROOM_MAX);
  return s || 'paris';
}
/** Message de chat : caractères de contrôle retirés, chevrons neutralisés (anti-injection HTML), longueur bornée. */
export function sanitizeChat(raw) {
  return String(raw ?? '').replace(/[\x00-\x1f\x7f\u2028\u2029]/g, ' ').replace(/</g, '‹').replace(/>/g, '›')
    .replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
}

export function newProfile(id, name) {
  return {
    id, name, money: STARTING_MONEY, cars: [STARTER_VEHICLE], activeCar: STARTER_VEHICLE,
    stats: { missionsDone: 0, earned: 0, playSeconds: 0 },
    cooldowns: {}, // missionId -> horodatage (ms) de la dernière réussite
    rentCarry: 0, // fraction de loyer non encore créditée
  };
}

/** Répare un profil chargé (champs manquants, voitures inconnues du catalogue…). */
export function normalizeProfile(p) {
  p.money = Math.max(0, Math.min(MAX_MONEY, Math.floor(+p.money || 0)));
  p.cars = [...new Set((Array.isArray(p.cars) ? p.cars : []).filter((c) => VEHICLE_BY_ID[c]))];
  if (!p.cars.includes(STARTER_VEHICLE)) p.cars.unshift(STARTER_VEHICLE);
  if (!p.cars.includes(p.activeCar)) p.activeCar = p.cars[0];
  p.stats = { missionsDone: 0, earned: 0, playSeconds: 0, ...(p.stats || {}) };
  p.cooldowns = p.cooldowns && typeof p.cooldowns === 'object' ? p.cooldowns : {};
  p.rentCarry = +p.rentCarry || 0;
  return p;
}

/** Vue envoyée au client (store.me). `properties` = biens possédés dans la salle courante. */
export function publicProfile(p, properties = []) {
  return {
    id: p.id, name: p.name, money: p.money, properties: [...properties], cars: [...p.cars], activeCar: p.activeCar,
    stats: { ...p.stats, playSeconds: Math.floor(p.stats.playSeconds) }, cooldowns: { ...p.cooldowns },
  };
}

function credit(p, amount, earned = true) {
  const before = p.money;
  p.money = Math.max(0, Math.min(MAX_MONEY, p.money + amount));
  if (earned && amount > 0) p.stats.earned += p.money - before;
  return p.money - before;
}

// ---------------------------------------------------------------- missions
// `session` = état volatil { mission: { id, startedAt } | null } (une seule mission à la fois).

export function missionStart(p, session, id, now) {
  const m = MISSION_BY_ID[id];
  if (!m) return fail('unknown_mission', 'Mission inconnue.');
  const wait = cooldownLeft(p, id, now);
  if (wait > 0) return fail('cooldown', `Mission disponible dans ${Math.ceil(wait)} s.`);
  session.mission = { id, startedAt: now }; // remplace une éventuelle mission en cours (abandon implicite)
  return { ok: true, id };
}

export function missionAbort(session) { session.mission = null; return { ok: true }; }

export function cooldownLeft(p, id, now) {
  const m = MISSION_BY_ID[id], last = p.cooldowns[id];
  if (!m || !last) return 0;
  return Math.max(0, (last + (m.cooldownSec || 0) * 1000 - now) / 1000);
}

export function missionComplete(p, session, id, now) {
  const m = MISSION_BY_ID[id];
  if (!m) return fail('unknown_mission', 'Mission inconnue.');
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
  p.cooldowns[id] = now;
  const reward = Math.max(0, Math.floor(+m.reward || 0));
  const delta = credit(p, reward);
  p.stats.missionsDone += 1;
  return { ok: true, id, reward: delta, title: m.title || id, delta, reason: 'mission' };
}

// ---------------------------------------------------------------- véhicules

export function buyCar(p, typeId) {
  const v = VEHICLE_BY_ID[typeId];
  if (!v) return fail('unknown_car', 'Véhicule inconnu.');
  if (p.cars.includes(typeId)) return fail('already_owned', 'Vous possédez déjà ce véhicule.');
  if (p.money < v.price) return fail('no_funds', `Fonds insuffisants : il manque ${fmt(v.price - p.money)}.`);
  const delta = credit(p, -v.price, false);
  p.cars.push(typeId);
  p.activeCar = typeId;
  return { ok: true, delta, reason: 'achat véhicule', name: v.name };
}

export function setActiveCar(p, typeId) {
  if (!VEHICLE_BY_ID[typeId] || !p.cars.includes(typeId)) return fail('not_owned', 'Vous ne possédez pas ce véhicule.');
  p.activeCar = typeId;
  return { ok: true };
}

// ---------------------------------------------------------------- immobilier
// `owners` = registre de la salle { propertyId: { id, name } } : un bien n'a qu'un propriétaire par salle.

export function ownedProperties(owners, playerId) {
  return Object.keys(owners).filter((k) => owners[k]?.id === playerId && PROPERTY_BY_ID[k]);
}

export function buyProperty(p, owners, id) {
  const prop = PROPERTY_BY_ID[id];
  if (!prop) return fail('unknown_property', 'Bien inconnu.');
  const o = owners[id];
  if (o) return fail('already_owned', o.id === p.id ? 'Ce bien vous appartient déjà.' : `Ce bien appartient déjà à ${o.name}.`);
  if (p.money < prop.price) return fail('no_funds', `Fonds insuffisants : il manque ${fmt(prop.price - p.money)}.`);
  const delta = credit(p, -prop.price, false);
  owners[id] = { id: p.id, name: p.name };
  return { ok: true, delta, reason: 'achat immobilier', name: prop.name };
}

export function sellProperty(p, owners, id) {
  const prop = PROPERTY_BY_ID[id];
  if (!prop) return fail('unknown_property', 'Bien inconnu.');
  if (owners[id]?.id !== p.id) return fail('not_owned', 'Ce bien ne vous appartient pas.');
  delete owners[id];
  const delta = credit(p, Math.floor(prop.price * SELL_BACK_RATIO), false);
  return { ok: true, delta, reason: 'vente immobilière', name: prop.name };
}

/** Loyers : `income` par heure connectée, au prorata de `seconds`. Retourne le montant entier crédité. */
export function accrue(p, owners, seconds) {
  if (!(seconds > 0)) return 0;
  p.stats.playSeconds += seconds;
  let perHour = 0;
  for (const id of ownedProperties(owners, p.id)) perHour += +PROPERTY_BY_ID[id].income || 0;
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

// Logique commune des contenus de jeu (missions, biens, lieux), partagée par toutes les villes.
// PROPRIÉTAIRE : agent « gameplay ». JS pur (importé par le serveur Node) : aucune dépendance navigateur.
//
// Les DONNÉES sont par ville : shared/cities/<ville>/missions.js, properties.js, places.js.
// Les sélecteurs historiques shared/missions.js et shared/properties.js exposent la ville courante
// et les tables toutes villes.
//
// ---- Missions --------------------------------------------------------------------------------
// Contrat minimal lu par le SERVEUR pour valider les gains (ne pas renommer ces champs) :
//   id (string unique TOUTES VILLES confondues), city, reward (ZéroCoins),
//   minDurationSec (anti-triche : durée mini plausible), cooldownSec (délai avant de la refaire).
// Le reste est interprété par client/src/gameplay :
//   title, description, giver {name, role}, type, level (1..6), start {x,z},
//   steps [{ x, z, radius, label, kind, holdSec?, onFoot?, lookAt?, snap?, snapTo?, goldenHours? }],
//   timeLimitSec? (chrono global), legTimeSec? (chrono remis à zéro à chaque étape : poursuites),
//   anyOrder? (étapes dans l'ordre de son choix), requireVehicle?, vehicle? { typeId, provided },
//   vehicleMinPrice? (standing exigé par le client), maxDamage? (convoyage : cumul d'impacts toléré),
//   passenger? { name, color }.
//
// Types : delivery | taxi | race | tour | courier | convoy | photo
// kind d'étape : goto (défaut) | checkpoint | pickup | dropoff | stop | photo
//   pickup/dropoff/stop : en véhicule, à l'arrêt, pendant holdSec. photo : à pied, monument cadré, holdSec.
//   snap:false = ne pas recaler la position sur la chaussée la plus proche (parvis, esplanades).
//   snapTo = { kind?: ['motorway','trunk'], name?: 'Pont Neuf', ref?: 'A620', max: 600 } : recaler de préférence sur
//            une chaussée de ce type / dont le nom (ou bridgeName) contient ce texte, dans un rayon `max`.
//   goldenHours = [h0, h1] : heures où la lumière est idéale (hors créneau, la pose photo est trois fois plus longue).
import { VEHICLES, VEHICLE_BY_ID } from './catalog.js';
import { geoFor } from './cities.js';

/** Niveaux : nombre de missions réussies (toutes villes confondues) nécessaire pour atteindre chaque niveau. */
export const LEVELS = [
  { level: 1, missionsDone: 0, title: 'Stagiaire' },
  { level: 2, missionsDone: 3, title: 'Coursier' },
  { level: 3, missionsDone: 8, title: 'Chauffeur' },
  { level: 4, missionsDone: 15, title: 'Pilote' },
  { level: 5, missionsDone: 25, title: 'As du volant' },
  { level: 6, missionsDone: 40, title: 'Légende' },
];
export function levelForMissionsDone(n = 0) {
  let lv = 1;
  for (const l of LEVELS) if (n >= l.missionsDone) lv = l.level;
  return lv;
}

export const MISSION_TYPES = {
  delivery: { label: 'Livraison', color: '#ffb703' },
  taxi: { label: 'Taxi', color: '#ffd60a' },
  race: { label: 'Course', color: '#ff4d6d' },
  tour: { label: 'Tournée', color: '#4cc9f0' },
  courier: { label: 'Coursier', color: '#fb8500' },
  convoy: { label: 'Convoyage', color: '#c77dff' },
  photo: { label: 'Photo', color: '#80ed99' },
};
export const STEP_KINDS = ['goto', 'checkpoint', 'pickup', 'dropoff', 'stop', 'photo'];

// ---- Biens -----------------------------------------------------------------------------------
// Contrat (serveur, UI, carte) : { id, city, name, kind, price, income, lat, lon, x, z }
//   income = loyer encaissé par heure de jeu réel connectée (ZéroCoins), ≈ 0,5–1 % du prix.
// Champs optionnels : garageSlots (nombre de voitures que le bien peut abriter : sert de garage
//   et de point de réapparition), address (texte affiché), description.
export const PROPERTY_KINDS = {
  studio: { label: 'Studio', garageSlots: 1 },
  appartement: { label: 'Appartement', garageSlots: 1 },
  loft: { label: 'Loft', garageSlots: 2 },
  maison: { label: 'Maison', garageSlots: 2 },
  villa: { label: 'Villa', garageSlots: 3 },
  peniche: { label: 'Péniche', garageSlots: 1 },
  hotel_particulier: { label: 'Hôtel particulier', garageSlots: 4 },
  penthouse: { label: 'Penthouse', garageSlots: 3 },
  commerce: { label: 'Commerce', garageSlots: 0 },
  garage: { label: 'Garage', garageSlots: 4 },
};
export const SELL_BACK_RATIO = 0.7;

// ---- Outils de saisie, paramétrés par la projection d'une ville -----------------------------------
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Outils pour écrire le contenu d'une ville dans SA projection (jamais shared/geo.js).
 * @param cityId        identifiant de shared/cities.js
 * @param landmarkById  monuments de la ville (pour near / around / lookAt)
 * @returns { G, near, around, S, P, landmark, missing, BOUNDS }
 *   `missing` liste les ids de monuments demandés mais absents (vérifié par les tests) : la position
 *   retombe alors sur l'origine de la ville plutôt que de faire planter le serveur au chargement.
 */
export function cityTools(cityId, landmarkById = {}) {
  const { lonLatToXZ, BOUNDS } = geoFor(cityId);
  const missing = [];
  const landmark = (id) => {
    const l = Object.hasOwn(landmarkById, id) ? landmarkById[id] : null;
    if (!l && !missing.includes(id)) missing.push(id);
    return l;
  };
  /** Position depuis des coordonnées GPS réelles. */
  const G = (lat, lon) => { const [x, z] = lonLatToXZ(lon, lat); return { x: r1(x), z: r1(z) }; };
  /** Position relative à un monument (mètres : dx vers l'Est, dz vers le Sud). */
  const near = (id, dx = 0, dz = 0) => { const l = landmark(id) || { x: 0, z: 0 }; return { x: r1(l.x + dx), z: r1(l.z + dz) }; };
  /** Point à `dist` mètres du monument dans la direction du cap `bearingDeg` (0 = Nord, 90 = Est). */
  const around = (id, bearingDeg, dist) => {
    const a = (bearingDeg * Math.PI) / 180;
    return near(id, Math.sin(a) * dist, -Math.cos(a) * dist);
  };
  /** Point devant la façade principale d'un monument, à `k` × son rayon du centre (zone dégagée). */
  const front = (id, k = 0.92) => {
    const l = landmark(id);
    if (!l) return { x: 0, z: 0 };
    // rot = (180 - F)° où F = azimut de la façade : direction (sin F, -cos F) = (sin rot, cos rot)
    return { x: r1(l.x + Math.sin(l.rot) * l.radius * k), z: r1(l.z + Math.cos(l.rot) * l.radius * k) };
  };
  /** Étape de mission. */
  const S = (pos, label, extra = {}) => ({ x: pos.x, z: pos.z, radius: 12, label, ...extra });
  /** Bien immobilier. */
  const P = (id, name, kind, price, income, lat, lon, extra = {}) => {
    const [x, z] = lonLatToXZ(lon, lat);
    return { id, city: cityId, name, kind, price, income, lat, lon, x: r1(x), z: r1(z), garageSlots: PROPERTY_KINDS[kind]?.garageSlots ?? 0, ...extra };
  };
  return { cityId, G, near, around, front, S, P, landmark, missing, BOUNDS };
}

// ---- Calculs dérivés des missions ---------------------------------------------------------------
const MAX_CATALOG_SPEED = Math.max(...VEHICLES.map((v) => v.maxSpeed));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Rapport moyen distance routière / vol d'oiseau, par ville (repli quand un tronçon n'est pas dans la table). */
const ROAD_FACTOR = { paris: 1.4, toulouse: 1.35 };
const ROAD_FACTOR_ANY = 1.6; // tournées en ordre libre (trajet au plus proche voisin)
const roadFactor = (m) => ROAD_FACTOR[m.city] ?? 1.4;

// Distances routières réelles par tronçon, toutes villes (ids uniques) : alimentée par buildMissions().
const ROUTE_TABLE = {};

/** Longueur à vol d'oiseau du parcours (départ → étapes). anyOrder : tournée au plus proche voisin. */
export function missionPathLength(m) {
  if (!m.anyOrder) {
    let len = 0, prev = m.start;
    for (const s of m.steps) { len += dist(prev, s); prev = s; }
    return len;
  }
  const left = [...m.steps];
  let len = 0, cur = m.start;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (dist(cur, left[i]) < dist(cur, left[bi])) bi = i;
    len += dist(cur, left[bi]); cur = left[bi]; left.splice(bi, 1);
  }
  return len;
}

/** Borne basse honnête de la durée : trajet en ligne droite, rayons déduits, vitesse de pointe, arrêts imposés. */
export function missionMinDuration(m) {
  const vmax = m.vehicle?.provided ? (VEHICLE_BY_ID[m.vehicle.typeId]?.maxSpeed ?? MAX_CATALOG_SPEED) : MAX_CATALOG_SPEED;
  const holds = m.steps.reduce((t, s) => t + (s.holdSec || 0), 0);
  // un recalage ciblé (snapTo) peut déplacer l'étape jusqu'à `max` mètres : on le déduit comme un rayon
  const reach = (s) => s.radius + (s.snapTo?.max || 0);
  let len;
  if (m.anyOrder) {
    // quel que soit l'ordre, il faut au moins atteindre l'étape la plus éloignée du départ
    len = Math.max(...m.steps.map((s) => Math.max(0, dist(m.start, s) - reach(s) - 8)));
  } else {
    len = 0;
    let prev = m.start, prevR = 8;
    for (const s of m.steps) { len += Math.max(0, dist(prev, s) - reach(s) - prevR); prev = s; prevR = reach(s); }
  }
  // 0,8 : marge pour le recalage des marqueurs sur la chaussée côté client
  return Math.max(3, Math.floor((len / vmax) * 0.8 + holds * 0.9));
}

/** Distance routière estimée de chaque tronçon (table ROUTE_M de la ville, sinon vol d'oiseau × facteur). */
export function missionLegLengths(m) {
  const t = ROUTE_TABLE[m.id];
  if (!m.anyOrder && t && t.length === m.steps.length) return t;
  const f = roadFactor(m);
  let prev = m.start;
  return m.steps.map((s) => { const d = dist(prev, s) * f; prev = s; return d; });
}
/** Distance routière estimée du parcours complet. */
export function missionRouteLength(m) {
  if (m.anyOrder) return missionPathLength(m) * ROAD_FACTOR_ANY;
  return missionLegLengths(m).reduce((a, b) => a + b, 0);
}
/** true si les chronos de la mission reposent sur des distances mesurées (et non sur le vol d'oiseau). */
export const missionHasMeasuredRoute = (m) => !m.anyOrder && ROUTE_TABLE[m.id]?.length === m.steps.length;

/**
 * Finalise les missions brutes d'une ville : étapes normalisées, lookAt résolus, chronos et minDurationSec calculés.
 * Champs de saisie consommés : `pace` (m/s, allure moyenne exigée par le chrono global sur la distance routière)
 * et `legPace` (idem, par étape).
 * @param tools   résultat de cityTools()
 * @param raw     missions brutes
 * @param routeM  { missionId: [mètres par tronçon] } mesurés sur le graphe routier de la ville (facultatif)
 */
export function buildMissions(tools, raw, routeM = {}) {
  for (const [id, legs] of Object.entries(routeM)) ROUTE_TABLE[id] = legs;
  return raw.map((r) => {
    const { pace, legPace, ...m } = r;
    m.city = tools.cityId;
    m.steps = m.steps.map((s) => ({ kind: 'goto', ...s }));
    // lookAt : identifiant de monument -> position (ignoré si le monument n'existe pas : voir tools.missing)
    for (const s of m.steps) {
      if (typeof s.lookAt !== 'string') continue;
      const l = tools.landmark(s.lookAt);
      if (l) s.lookAt = { id: l.id, name: l.name, x: l.x, z: l.z }; else delete s.lookAt;
    }
    const holds = m.steps.reduce((t, s) => t + (s.holdSec || 0), 0);
    if (pace) m.timeLimitSec = Math.round(missionRouteLength(m) / pace + holds * 1.5 + 20);
    if (legPace) {
      // chrono par étape : temps alloué proportionnel à la distance routière de chaque tronçon
      const legs = missionLegLengths(m);
      m.steps.forEach((s, i) => { s.legTimeSec = Math.round(legs[i] / legPace + 12); });
      m.legTimeSec = true;
    }
    m.minDurationSec = missionMinDuration(m);
    return m;
  });
}

/** Index par id d'une liste d'objets { id }. */
export const byId = (list) => Object.fromEntries(list.map((o) => [o.id, o]));

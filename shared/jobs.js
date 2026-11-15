// Taxi libre de Mission Zéro — module PUR (aucune dépendance Node ni navigateur), lot net-serveur.
// Courses à la volée : le serveur tire la destination et le caractère du client, calcule le prix, le délai et le
// pourboire. Utilisé par le serveur (autorité) ET par le repli hors-ligne (position fournie par getPos()).
// Sert aussi au Chiche : pickSpot() tire son arrivée.
//
// `session` = état volatil du compte (voir shared/economy.js) :
//   session.job     = { id, kind, mood, to: {x, z, label, r}, dist, fare, parSec, minSec, startedAt, taxi, chain } | null
//                     exclusif avec session.mission (et avec un Chiche en cours : drapeau `busy` passé par l'appelant)
//   session.jobLast = { at, chain } : fin de la course précédente (série de courses enchaînées)
// Une course ne compte PAS dans stats.missionsDone. Une coupure perd session.job (le client l'annonce).
import * as ECO from './economy.js';
import * as J from './journal.js';
import * as CAT from './catalog.js';
import * as LM from './landmarks.js';
import * as PARIS from './cities/paris/places.js';
import * as TOULOUSE from './cities/toulouse/places.js';
import { DEFAULT_CITY } from './cities.js';

// ---------------------------------------------------------------- constantes d'équilibrage
export const JOB_MIN_M = 500, JOB_MAX_M = 1500; // couronne où le serveur tire la destination (courses courtes)
export const SPOT_RADIUS = 45; // rayon d'arrivée autour d'un point de rendez-vous (m)
export const LANDMARK_MARGIN = 90; // un monument s'atteint depuis les rues qui l'entourent : r = radius + 90
export const FARE_BASE = 150, FARE_PER_M = 0.35; // prix de base : 150 Ƶ + 0,35 Ƶ par mètre à vol d'oiseau
export const LEVEL_STEP = 0.25; // +25 % par niveau au-dessus du premier (prix et plafond horaire)
export const TAXI_BONUS = 1.25; // au volant de SON Taxi Parisien
export const TOURIST_FARE = 1.2; // un touriste paie mieux
export const PAR_SPEED = 13, PAR_BASE_SEC = 15; // délai nominal : distance × détour routier de la ville, à 13 m/s, + 15 s
/** Détour routier moyen par ville (route / vol d'oiseau), pour le DÉLAI seulement : le prix reste à vol d'oiseau. */
export const PAR_ROAD = { paris: 1.4, toulouse: 1.9 };
export const PAR_ROAD_DEFAULT = 1.4;
export const PAR_MOOD = { presse: 0.75, touriste: 1.5 }; // délai plus court pour le pressé, plus long pour le touriste
export const MIN_SPEED = 60; // m/s : une arrivée plus rapide que dist / 60 est refusée ('too_fast')
export const TIP_RATE = 0.4, TIP_RATE_PRESSE = 0.8; // pourboire maximal, en part du prix
export const HIT_COST = 0.2, HIT_COST_FRAGILE = 0.5; // part du pourboire perdue à chaque choc
export const MAX_HITS = 5;
export const CHAIN_WINDOW_MS = 120000; // la série continue si le client suivant monte dans les 2 minutes
export const CHAIN_STEP = 0.1, CHAIN_MAX = 5; // +10 % par course enchaînée, plafonné à +50 %
export const HOUR_CAP = 15000, HOUR_MS = 3600 * 1000; // plafond de gains par heure glissante (× niveau)
export const OVER_CAP_RATIO = 0.25; // au-delà du plafond, une course ne rapporte plus que le quart
export const HARD_CAP_RATIO = 2; // plafond dur : au-delà de 2 × le plafond horaire dans la fenêtre, une course ne paie plus rien
/** Caractères de client et leur probabilité de tirage (somme 1). */
export const MOODS = [['normal', 0.55], ['presse', 0.15], ['touriste', 0.15], ['fragile', 0.15]];
const MOOD_EDGES = [0.55, 0.7, 0.85]; // bornes cumulées, écrites en clair (0,55 + 0,15 ne vaut pas exactement 0,7 en flottant)
const DURATION_TOLERANCE_SEC = 0.75;

const fail = (code, text) => ({ ok: false, code, text });
const own = (table, id) => (typeof id === 'string' && table && Object.hasOwn(table, id) ? table[id] : undefined);
const finitePos = (pos) => !!pos && Number.isFinite(pos.x) && Number.isFinite(pos.z);

// ---------------------------------------------------------------- points de rendez-vous

const PLACES_BY_CITY = { paris: PARIS, toulouse: TOULOUSE };
const LANDMARKS_BY_CITY = LM.LANDMARKS_BY_CITY || {};

/** « saintLazare » -> « Saint Lazare » (repli tant qu'une ville n'a pas de RDV_POINTS). */
const humanize = (key) => String(key).replace(/([a-zà-ÿ0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function landmarkSpots(city) {
  return (LANDMARKS_BY_CITY[city] || []).filter((l) => !l.hidden && Number.isFinite(l.x) && Number.isFinite(l.z))
    .map((l) => ({ id: l.id, label: l.name, x: l.x, z: l.z, r: (+l.radius || 0) + LANDMARK_MARGIN, landmark: true }));
}
function citySpots(city) {
  const places = PLACES_BY_CITY[city] || {};
  const rdv = Array.isArray(places.RDV_POINTS) ? places.RDV_POINTS.filter((s) => s && Number.isFinite(s.x) && Number.isFinite(s.z)) : [];
  if (rdv.length) return rdv.map((s) => ({ id: String(s.id), label: s.label || humanize(s.id), x: s.x, z: s.z, r: SPOT_RADIUS }));
  // repli : repères nommés de la ville, puis monuments visibles
  const named = Object.entries(places.PLACE || {}).filter(([, s]) => s && Number.isFinite(s.x) && Number.isFinite(s.z))
    .map(([key, s]) => ({ id: key, label: humanize(key), x: s.x, z: s.z, r: SPOT_RADIUS }));
  return [...named, ...landmarkSpots(city)];
}
const CITY_IDS = [...new Set([...Object.keys(PLACES_BY_CITY), ...Object.keys(LANDMARKS_BY_CITY)])];
/** Destinations possibles par ville : [{ id, label, x, z, r, landmark? }] (RDV_POINTS ; repli : PLACE puis monuments). */
export const SPOTS_BY_CITY = Object.fromEntries(CITY_IDS.map((c) => [c, citySpots(c)]));
/** Monuments visibles par ville, comme destinations de touriste : r = radius + 90. */
export const LANDMARK_SPOTS_BY_CITY = Object.fromEntries(CITY_IDS.map((c) => [c, landmarkSpots(c)]));

function inRing(list, pos, minD, maxD) {
  const out = [];
  for (const s of list) { const d = Math.hypot(s.x - pos.x, s.z - pos.z); if (d >= minD && d <= maxD) out.push(s); }
  return out;
}

/**
 * Tire un point de `city` entre `minD` et `maxD` mètres de `pos`. `opts.landmark` : de préférence un monument.
 * REPLI : aucun point dans la couronne => le point le plus proche au-delà de minD, sans borne haute ;
 * aucun point du tout => null. `rand` = générateur [0, 1) (Math.random par défaut ; fixé dans les tests).
 * @returns {{ id, label, x, z, r, dist, landmark? } | null}
 */
export function pickSpot(city, pos, minD, maxD, rand = Math.random, opts = {}) {
  if (!finitePos(pos)) return null;
  const c = typeof city === 'string' && Object.hasOwn(SPOTS_BY_CITY, city) ? city : DEFAULT_CITY;
  const base = SPOTS_BY_CITY[c] || [], sights = LANDMARK_SPOTS_BY_CITY[c] || [];
  let ring = opts?.landmark ? inRing(sights, pos, minD, maxD) : [];
  if (!ring.length) ring = inRing(base, pos, minD, maxD);
  let spot = null;
  if (ring.length) spot = ring[Math.min(ring.length - 1, Math.floor((+rand() || 0) * ring.length))];
  else {
    let bd = Infinity;
    for (const s of base.length ? base : sights) { const d = Math.hypot(s.x - pos.x, s.z - pos.z); if (d > minD && d < bd) { bd = d; spot = s; } }
  }
  return spot ? { ...spot, dist: Math.hypot(spot.x - pos.x, spot.z - pos.z) } : null;
}

/** Monument visible le plus proche de `pos` dans `city` : { id, name, dist } ou null (annonces « près de … »). */
export function nearestLandmark(city, pos) {
  if (!finitePos(pos)) return null;
  let best = null, bd = Infinity;
  for (const l of LANDMARKS_BY_CITY[city] || []) {
    if (l.hidden) continue;
    const d = Math.hypot(l.x - pos.x, l.z - pos.z);
    if (d < bd) { bd = d; best = l; }
  }
  return best ? { id: best.id, name: best.name, dist: bd } : null;
}

// ---------------------------------------------------------------- formules

const levelMult = (level) => 1 + LEVEL_STEP * (Math.max(1, level) - 1);
/** Prix de base d'une course (hors pourboire et série). */
export function fareFor(dist, level, taxi, mood) {
  return Math.round((FARE_BASE + FARE_PER_M * dist) * levelMult(level) * (taxi ? TAXI_BONUS : 1) * (mood === 'touriste' ? TOURIST_FARE : 1));
}
/** Détour routier de la ville (repli : 1,4). */
export const parRoad = (city) => own(PAR_ROAD, city) ?? PAR_ROAD_DEFAULT;
/** Délai (s) au-delà duquel le pourboire commence à fondre, selon le détour routier de la ville. */
export function parFor(dist, mood, city) {
  return Math.round(((dist * parRoad(city)) / PAR_SPEED + PAR_BASE_SEC) * (PAR_MOOD[mood] || 1));
}
/** Pourboire : plein à l'heure, nul au double du délai, réduit par les chocs (davantage pour un client fragile). */
export function tipFor(fare, mood, elapsedSec, parSec, hits) {
  const onTime = Math.max(0, Math.min(1, 1 - Math.max(0, elapsedSec - parSec) / parSec));
  const calm = Math.max(0, 1 - (mood === 'fragile' ? HIT_COST_FRAGILE : HIT_COST) * hits);
  return Math.round(fare * (mood === 'presse' ? TIP_RATE_PRESSE : TIP_RATE) * onTime * calm);
}
/** Multiplicateur de série : ×1 à la première course, +10 % par course enchaînée, plafonné à ×1,5. */
export const chainMult = (chain) => 1 + CHAIN_STEP * Math.min(Math.max(1, chain) - 1, CHAIN_MAX);
/** Plafond de gains de taxi par heure glissante, selon le niveau. */
export const hourCap = (level) => Math.round(HOUR_CAP * levelMult(level));

function drawMood(rand) {
  const r = +rand() || 0;
  for (let i = 0; i < MOOD_EDGES.length; i++) if (r < MOOD_EDGES[i]) return MOODS[i][0];
  return MOODS[MOOD_EDGES.length][0];
}

// ---------------------------------------------------------------- opérations

let seq = 0;

/**
 * Prise en charge d'un client. `opts` = { kind: 'taxi', pos: {x, z} position connue du serveur, city, now, rand?,
 * vehicleType: modèle déclaré par l'état en mode véhicule (null à pied), busy?: Chiche en cours }.
 * Refus : 'bad_kind', 'busy' (mission ou Chiche en cours), 'no_pos', 'no_vehicle', 'no_spot'.
 * @returns {{ ok: true, job: { id, kind, mood, to: {x, z, label, r}, fare, parSec, chain, taxi } }}  job = charge de S.JOB
 */
export function jobStart(p, session, opts = {}) {
  const { kind, pos, city, now, rand = Math.random, vehicleType, busy } = opts;
  if (kind !== 'taxi') return fail('bad_kind', 'Activité inconnue.');
  if (session.mission || busy) return fail('busy', "Terminez d'abord votre activité en cours.");
  if (!finitePos(pos)) return fail('no_pos', 'Position inconnue : roulez un instant puis réessayez.');
  if (!own(CAT.VEHICLE_BY_ID, vehicleType)) return fail('no_vehicle', 'Il faut être au volant pour prendre un client.');
  const mood = drawMood(rand);
  const spot = pickSpot(city, pos, JOB_MIN_M, JOB_MAX_M, rand, { landmark: mood === 'touriste' });
  if (!spot) return fail('no_spot', 'Aucun client par ici : essayez un peu plus loin.');
  const level = ECO.levelOf(p), dist = spot.dist;
  const taxi = vehicleType === 'taxi' && Array.isArray(p.cars) && p.cars.includes('taxi');
  const last = session.jobLast;
  const chain = last && now - last.at >= 0 && now - last.at <= CHAIN_WINDOW_MS ? last.chain + 1 : 1;
  const id = `j${Math.floor(now).toString(36)}${(++seq % 1296).toString(36)}`;
  const to = { x: Math.round(spot.x * 10) / 10, z: Math.round(spot.z * 10) / 10, label: spot.label, r: spot.r };
  const job = { id, kind, mood, to, dist, fare: fareFor(dist, level, taxi, mood), parSec: parFor(dist, mood, city), minSec: dist / MIN_SPEED, startedAt: now, taxi, chain };
  session.job = job; // remplace une éventuelle course en cours (abandon implicite)
  return { ok: true, job: { id, kind, mood, to, fare: job.fare, parSec: job.parSec, chain, taxi } };
}

/**
 * Arrivée d'une course. `opts` = { pos, now, hits: 0..5 chocs déclarés par le client (ne peut que réduire le pourboire),
 * id?: identifiant annoncé par le client (refusé 'no_job' s'il ne correspond pas) }.
 * Refus : 'no_job' ; 'too_far' (à plus de to.r de l'arrivée : la course est CONSERVÉE) ; 'too_fast' (course annulée).
 * @returns {{ ok: true, id, mood, fare, tip, chain, capped, total (crédité), delta, reason: 'course de taxi' }}
 *   total = (fare + tip) × série, rogné au quart au-delà du plafond horaire (capped: true), et à RIEN au-delà du
 *   plafond dur (2 × le plafond horaire encaissés dans la fenêtre) : la course compte, mais total peut valoir 0.
 */
export function jobComplete(p, session, opts = {}) {
  const { pos, now, hits, id } = opts;
  const job = session.job;
  if (!job || (id != null && String(id) !== job.id)) return fail('no_job', 'Aucune course en cours.');
  if (!finitePos(pos) || Math.hypot(pos.x - job.to.x, pos.z - job.to.z) > job.to.r) return fail('too_far', "Vous n'êtes pas encore à destination.");
  const elapsed = (now - job.startedAt) / 1000;
  if (elapsed + DURATION_TOLERANCE_SEC < job.minSec) { session.job = null; return fail('too_fast', 'Course terminée trop vite : rien à encaisser.'); }
  session.job = null;
  const h = Math.max(0, Math.min(MAX_HITS, Math.floor(+hits) || 0));
  const tip = tipFor(job.fare, job.mood, elapsed, job.parSec, h);
  const nominal = Math.round((job.fare + tip) * chainMult(job.chain));
  // plafond d'une heure glissante : fenêtre { at, paid } du journal
  const j = J.ensureJournal(p);
  if (!(now - j.fareWin.at >= 0 && now - j.fareWin.at < HOUR_MS)) j.fareWin = { at: now, paid: 0 };
  const cap = hourCap(ECO.levelOf(p)), room = Math.max(0, cap - j.fareWin.paid);
  const capped = nominal > room;
  // au-delà du plafond horaire : le quart ; jamais plus, dans la fenêtre, que le plafond dur
  const total = Math.min(capped ? room + Math.round((nominal - room) * OVER_CAP_RATIO) : nominal, Math.max(0, HARD_CAP_RATIO * cap - j.fareWin.paid));
  const delta = ECO.credit(p, total);
  j.fareWin.paid += delta;
  session.jobLast = { at: now, chain: job.chain };
  const st = p.stats;
  st.fares = (st.fares || 0) + 1;
  if (job.chain > (st.fareBestChain || 0)) st.fareBestChain = job.chain;
  st.fareEarned = (st.fareEarned || 0) + delta;
  J.count(p, 'fares', 1, now);
  return { ok: true, id: job.id, mood: job.mood, fare: job.fare, tip, chain: job.chain, capped, total: delta, delta, reason: 'course de taxi' };
}

/** Abandon de la course en cours (sans frais). Retourne { ok: true, had } (had = il y avait une course). */
export function jobAbort(session) {
  const had = !!session.job;
  session.job = null;
  return { ok: true, had };
}

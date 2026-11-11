// Missions de la VILLE COURANTE + tables toutes villes. PROPRIÉTAIRE : agent « gameplay ».
// JS pur (importé par le serveur Node) : aucune dépendance navigateur.
//
// Les données sont par ville : shared/cities/<ville>/missions.js ; la logique commune (niveaux, types,
// calcul de minDurationSec et des chronos) est dans shared/content-core.js.
//
// Côté client : MISSIONS / MISSION_BY_ID / ROUTE_M = contenu de la ville de `?city=` (shared/cities.js).
// Côté serveur (pas de ville courante) : MISSIONS_BY_CITY, ALL_MISSIONS, ALL_MISSION_BY_ID, cityOfMission(id).
//   Champs lus pour valider un gain : id, city, reward, minDurationSec, cooldownSec.
//   Les ids sont uniques toutes villes confondues ; le niveau du joueur est global (missions réussies
//   toutes villes confondues), comme l'argent et les voitures.
import { CITY, CITY_ID } from './cities.js';
import { LEVELS as BASE_LEVELS } from './content-core.js';
import { MISSIONS as PARIS, ROUTE_M as PARIS_ROUTE_M } from './cities/paris/missions.js';
import { MISSIONS as TOULOUSE, ROUTE_M as TOULOUSE_ROUTE_M } from './cities/toulouse/missions.js';

export { MISSION_TYPES, STEP_KINDS, levelForMissionsDone, missionPathLength, missionMinDuration, missionLegLengths, missionRouteLength, missionHasMeasuredRoute } from './content-core.js';

// ---- Toutes villes (serveur) ----
export const MISSIONS_BY_CITY = { paris: PARIS, toulouse: TOULOUSE };
export const ROUTE_M_BY_CITY = { paris: PARIS_ROUTE_M, toulouse: TOULOUSE_ROUTE_M };
export const ALL_MISSIONS = Object.values(MISSIONS_BY_CITY).flat();
export const ALL_MISSION_BY_ID = Object.fromEntries(ALL_MISSIONS.map((m) => [m.id, m]));
/** Ville d'une mission (« paris », « toulouse »…), ou null si l'id est inconnu. */
export const cityOfMission = (id) => (typeof id === 'string' && Object.hasOwn(ALL_MISSION_BY_ID, id) ? ALL_MISSION_BY_ID[id].city : null);

// ---- Ville courante (client) ----
export const MISSIONS = MISSIONS_BY_CITY[CITY_ID] || PARIS;
export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
export const ROUTE_M = ROUTE_M_BY_CITY[CITY_ID] || PARIS_ROUTE_M;

/** Niveaux (globaux). Seul le titre du dernier porte le nom de la ville où l'on joue. */
export const LEVELS = BASE_LEVELS.map((l, i) => (i === BASE_LEVELS.length - 1 ? { ...l, title: `${l.title} de ${CITY.name}` } : l));

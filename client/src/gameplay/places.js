// Lieux fixes du gameplay pour la VILLE COURANTE : repères, point de départ, concessions, parkings publics,
// objets à collectionner. Les données sont par ville dans shared/cities/<ville>/places.js (JS pur).
import { CITY_ID } from '@shared/cities.js';
import * as PARIS from '@shared/cities/paris/places.js';
import * as TOULOUSE from '@shared/cities/toulouse/places.js';

export const PLACES_BY_CITY = { paris: PARIS, toulouse: TOULOUSE };
const C = PLACES_BY_CITY[CITY_ID] || PARIS;

/** Repères nommés de la ville : { nom: {x, z} }. */
export const PLACE = C.PLACE;
/** Point d'apparition d'un nouveau joueur : { x, z, yaw?, label }. */
export const SPAWN = C.SPAWN;
/** Concessions : [{ id, brand, name, color, x, z, street?, show: [typeId] }]. */
export const DEALERS = C.DEALERS;
/** Parkings publics : [{ id, name, x, z }]. */
export const PUBLIC_GARAGES = C.PUBLIC_GARAGES;
/** Objets à collectionner : [{ id, label, x, z, snap? }] et leurs textes { name, found, color, allFound }. */
export const COLLECTIBLES = C.COLLECTIBLES;
export const COLLECTIBLE = C.COLLECTIBLE;

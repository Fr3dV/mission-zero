// Biens immobiliers de la VILLE COURANTE + tables toutes villes. PROPRIÉTAIRE : agent « gameplay ».
// JS pur (importé par le serveur Node) : aucune dépendance navigateur.
//
// Les données sont par ville : shared/cities/<ville>/properties.js ; types de biens et taux de revente
// dans shared/content-core.js. Contrat d'un bien : { id, city, name, kind, price, income, lat, lon, x, z }
// (x, z dans le repère de SA ville) + garageSlots, address.
//
// Côté client : PROPERTIES / PROPERTY_BY_ID = biens de la ville de `?city=`.
// Côté serveur : PROPERTIES_BY_CITY, ALL_PROPERTIES, ALL_PROPERTY_BY_ID, cityOfProperty(id).
//   Les ids sont uniques toutes villes confondues ; les biens appartiennent à une salle, donc à une ville.
import { CITY_ID } from './cities.js';
import { PROPERTIES as PARIS } from './cities/paris/properties.js';
import { PROPERTIES as TOULOUSE } from './cities/toulouse/properties.js';

export { PROPERTY_KINDS, SELL_BACK_RATIO } from './content-core.js';

// ---- Toutes villes (serveur) ----
export const PROPERTIES_BY_CITY = { paris: PARIS, toulouse: TOULOUSE };
export const ALL_PROPERTIES = Object.values(PROPERTIES_BY_CITY).flat();
export const ALL_PROPERTY_BY_ID = Object.fromEntries(ALL_PROPERTIES.map((p) => [p.id, p]));
/** Ville d'un bien, ou null si l'id est inconnu. */
export const cityOfProperty = (id) => (typeof id === 'string' && Object.hasOwn(ALL_PROPERTY_BY_ID, id) ? ALL_PROPERTY_BY_ID[id].city : null);

// ---- Ville courante (client) ----
export const PROPERTIES = PROPERTIES_BY_CITY[CITY_ID] || PARIS;
export const PROPERTY_BY_ID = Object.fromEntries(PROPERTIES.map((p) => [p.id, p]));

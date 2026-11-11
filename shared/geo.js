// Projection lat/lon -> repère monde (mètres) de la VILLE COURANTE (voir shared/cities.js).
// +X = Est, +Z = Sud (donc -Z = Nord), +Y = haut. Origine : Concorde à Paris, Capitole à Toulouse.
// Pour une ville précise (serveur, données propres à une ville) : geoFor(id) de shared/cities.js.
import { CITY_ID, geoFor } from './cities.js';

const g = geoFor(CITY_ID);
export const ORIGIN = g.ORIGIN;
export const BBOX = g.BBOX; // emprise du monde jouable (lon/lat)
export const BOUNDS = g.BOUNDS; // la même en mètres : { minX, maxX, minZ, maxZ }
export const lonLatToXZ = g.lonLatToXZ;
export const xzToLonLat = g.xzToLonLat;

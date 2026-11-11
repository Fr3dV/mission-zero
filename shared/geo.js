// Projection lat/lon -> repère monde (mètres).
// Origine = Place de la Concorde. +X = Est, +Z = Sud (donc -Z = Nord), +Y = haut.
export const ORIGIN = { lat: 48.8656, lon: 2.3212 };
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function lonLatToXZ(lon, lat) {
  return [(lon - ORIGIN.lon) * M_PER_DEG_LON, -(lat - ORIGIN.lat) * M_PER_DEG_LAT];
}
export function xzToLonLat(x, z) {
  return [ORIGIN.lon + x / M_PER_DEG_LON, ORIGIN.lat - z / M_PER_DEG_LAT];
}

// Emprise du monde jouable (bbox lon/lat) : de la Tour Eiffel au Panthéon, jusqu'à Montmartre.
export const BBOX = { minLon: 2.283, maxLon: 2.362, minLat: 48.843, maxLat: 48.8895 };
const [minX, maxZ] = lonLatToXZ(BBOX.minLon, BBOX.minLat);
const [maxX, minZ] = lonLatToXZ(BBOX.maxLon, BBOX.maxLat);
export const BOUNDS = { minX, maxX, minZ, maxZ };

// Registre des villes jouables. JS pur (importé par le client ET le serveur Node).
//
// Une ville = une origine de projection, une emprise, et ses fichiers de données.
// Côté client, la ville courante vient du paramètre d'URL `?city=<id>` (lu une fois, au chargement :
// changer de ville = recharger la page). Côté serveur il n'y a pas de « ville courante » : chaque salle
// porte sa ville, et le code serveur utilise geoFor(id) et les tables *_BY_CITY.
//
// Repère de chaque ville : mètres, origine = `origin`, +X = Est, +Z = Sud, +Y = haut.

export const DEFAULT_CITY = 'paris';

export const CITIES = {
  paris: {
    id: 'paris',
    name: 'Paris',
    tagline: 'De la Tour Eiffel à Montmartre',
    origin: { lat: 48.8656, lon: 2.3212 }, // place de la Concorde
    bbox: { minLon: 2.283, maxLon: 2.362, minLat: 48.843, maxLat: 48.8895 },
    plate: '75',
    style: 'paris',
    // Fichiers de données (URL servies depuis /shared/). null = pas de fichier.
    files: {
      roads: '/shared/world/paris.json',
      buildings: '/shared/world/buildings.json',
      buildingsMeta: '/shared/world/buildings-meta.json',
      pois: '/shared/world/pois.json',
      terrain: null, // relief analytique (butte Montmartre), voir shared/terrain.js
    },
  },
  toulouse: {
    id: 'toulouse',
    name: 'Toulouse',
    tagline: 'La ville rose, du Capitole à la proche banlieue',
    origin: { lat: 43.6045, lon: 1.444 }, // place du Capitole
    // Toulouse et sa première couronne : Blagnac et l'aéroport, Balma, L'Union, Ramonville, Tournefeuille (est).
    bbox: { minLon: 1.335, maxLon: 1.525, minLat: 43.535, maxLat: 43.675 },
    plate: '31',
    style: 'toulouse',
    files: {
      roads: '/shared/world/toulouse/roads.json',
      buildings: '/shared/world/toulouse/buildings.bin', // Float32Array little-endian, 6 nombres par bâtiment
      buildingsMeta: '/shared/world/toulouse/buildings-meta.json', // légende : { stride, fields, kinds, walls, roofs }
      buildingsMetaBin: '/shared/world/toulouse/buildings-meta.bin', // Uint8Array, `stride` octets par bâtiment
      pois: '/shared/world/toulouse/pois.json',
      terrain: '/shared/world/toulouse/terrain.json', // grille d'altitudes (voir shared/terrain.js)
    },
  },
};

export const CITY_IDS = Object.keys(CITIES);

/** Ville courante : `?city=` dans le navigateur, variable MZ_CITY sous Node (tests, outils), sinon Paris. */
export function currentCityId() {
  let id = null;
  try {
    if (typeof location !== 'undefined' && location.search) id = new URLSearchParams(location.search).get('city');
    else if (typeof process !== 'undefined' && process.env) id = process.env.MZ_CITY || null;
  } catch { /* environnement sans location ni process */ }
  return id && CITIES[id] ? id : DEFAULT_CITY;
}
export const CITY_ID = currentCityId();
export const CITY = CITIES[CITY_ID];

/** Nettoie un identifiant de ville reçu du réseau. */
export const sanitizeCity = (id) => (typeof id === 'string' && CITIES[id] ? id : DEFAULT_CITY);

const M_PER_DEG_LAT = 111320;
const geoCache = new Map();

/** Projection et emprise d'une ville : { city, ORIGIN, BBOX, BOUNDS, lonLatToXZ(lon, lat), xzToLonLat(x, z) }. */
export function geoFor(id) {
  const city = CITIES[id] || CITIES[DEFAULT_CITY];
  let g = geoCache.get(city.id);
  if (g) return g;
  const ORIGIN = city.origin, BBOX = city.bbox;
  const mLon = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);
  const lonLatToXZ = (lon, lat) => [(lon - ORIGIN.lon) * mLon, -(lat - ORIGIN.lat) * M_PER_DEG_LAT];
  const xzToLonLat = (x, z) => [ORIGIN.lon + x / mLon, ORIGIN.lat - z / M_PER_DEG_LAT];
  const [minX, maxZ] = lonLatToXZ(BBOX.minLon, BBOX.minLat);
  const [maxX, minZ] = lonLatToXZ(BBOX.maxLon, BBOX.maxLat);
  g = { city, ORIGIN, BBOX, BOUNDS: { minX, maxX, minZ, maxZ }, lonLatToXZ, xzToLonLat };
  geoCache.set(city.id, g);
  return g;
}

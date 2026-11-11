import { geoFor } from '../../cities.js';

// Monuments et grands repères de TOULOUSE. PROPRIÉTAIRE : agent « monuments ».
// Format identique à Paris : { id, name, lat, lon, x, z, rot, radius, hidden? }.
// rot = rotation.y (radians) du modèle 3D, dont la façade principale est construite vers +Z local.
//       Avec F = azimut réel de la façade (degrés, sens horaire depuis le nord) : rot = (180 - F)°.
// radius = rayon (m) du disque couvrant l'emprise : le module ville n'y pose aucun bâtiment.
// Les ids sont préfixés `tls_` : ils doivent rester uniques toutes villes confondues.
// (Liste de départ posée par l'intégrateur avec des positions approximatives : à vérifier et compléter.)
const { lonLatToXZ } = geoFor('toulouse');
const L = (id, name, lat, lon, facingDeg = 180, radius = 60) => {
  const [x, z] = lonLatToXZ(lon, lat);
  return { id, name, lat, lon, x, z, rot: ((180 - facingDeg) * Math.PI) / 180, radius };
};

export const LANDMARKS = [
  L('tls_capitole', 'Capitole', 43.60440, 1.44420, 270, 75),            // façade sur la place, à l'ouest
  L('tls_saintsernin', 'Basilique Saint-Sernin', 43.60840, 1.44200, 270, 70),
  L('tls_jacobins', 'Couvent des Jacobins', 43.60330, 1.44030, 270, 60),
  L('tls_saintetienne', 'Cathédrale Saint-Étienne', 43.60000, 1.45030, 270, 65),
  L('tls_lagrave', 'Dôme de La Grave', 43.60000, 1.43300, 90, 80),
  L('tls_hoteldieu', 'Hôtel-Dieu Saint-Jacques', 43.59870, 1.43650, 60, 80),
  L('tls_daurade', 'Basilique de la Daurade', 43.60100, 1.43950, 240, 35),
  L('tls_wilson', 'Place Wilson', 43.60460, 1.44740, 180, 20),
  L('tls_matabiau', 'Gare Matabiau', 43.61130, 1.45370, 225, 110),
  L('tls_mediatheque', 'Médiathèque José-Cabanis', 43.60980, 1.45530, 225, 60),
  L('tls_halleauxgrains', 'Halle aux Grains', 43.59930, 1.45400, 0, 40),
  L('tls_palaisjustice', 'Palais de justice', 43.59450, 1.44550, 0, 70),
  L('tls_stadium', 'Stadium de Toulouse', 43.58330, 1.43410, 0, 150),
  L('tls_zenith', 'Zénith', 43.59670, 1.41000, 90, 90),
  L('tls_wallon', 'Stade Ernest-Wallon', 43.62050, 1.41650, 0, 130),
  L('tls_citeespace', "Cité de l'espace", 43.58670, 1.49330, 180, 140),
  L('tls_hallemachine', 'Halle de la Machine', 43.57350, 1.48100, 180, 90),
  L('tls_aeroport', 'Aéroport Toulouse-Blagnac', 43.62940, 1.36760, 90, 220),
  L('tls_aeroscopia', 'Aeroscopia', 43.65950, 1.35980, 180, 120),
];

export const LANDMARK_BY_ID = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));

import { geoFor } from '../../cities.js';

// Monuments et grands repères de TOULOUSE. PROPRIÉTAIRE : agent « monuments ».
// Format identique à Paris : { id, name, lat, lon, x, z, rot, radius, hidden? }.
// rot = rotation.y (radians) du modèle 3D, dont la façade principale est construite vers +Z local.
//       Avec F = azimut réel de la façade (degrés, sens horaire depuis le nord) : rot = (180 - F)°.
// radius = rayon (m) du disque couvrant l'emprise : le module ville n'y pose aucun bâtiment.
// hidden = simple réserve d'emprise (ou élément d'un ensemble) : absent de la carte et des découvertes.
// Les ids sont préfixés `tls_` : ils doivent rester uniques toutes villes confondues.
// Positions, azimuts et dimensions calés sur les emprises IGN (BD TOPO) et les relevés OpenStreetMap.
const { lonLatToXZ, xzToLonLat } = geoFor('toulouse');
const L = (id, name, lat, lon, facingDeg = 180, radius = 60, hidden = false) => {
  const [x, z] = lonLatToXZ(lon, lat);
  const l = { id, name, lat, lon, x, z, rot: ((180 - facingDeg) * Math.PI) / 180, radius };
  if (hidden) l.hidden = true;
  return l;
};
// Entrée positionnée en coordonnées LOCALES d'un autre monument (lx vers sa droite, lz vers sa façade) :
// sert aux éléments d'un même ensemble (place et arcades du Capitole, hall D de l'aérogare…).
// dFacing = azimut de façade relatif à celui du monument de base.
const R = (base, id, name, lx, lz, dFacing = 0, radius = 30, hidden = false) => {
  const c = Math.cos(base.rot), s = Math.sin(base.rot), x = base.x + lx * c + lz * s, z = base.z - lx * s + lz * c;
  const [lon, lat] = xzToLonLat(x, z);
  const l = { id, name, lat, lon, x, z, rot: base.rot - (dFacing * Math.PI) / 180, radius };
  if (hidden) l.hidden = true;
  return l;
};

export const LANDMARKS = [
  // ---- cœur historique ----
  L('tls_capitole', 'Capitole', 43.60447, 1.44427, 261, 62),                       // emprise réelle 109 × 56 m ; façade ouest sur la place
  L('tls_saintsernin', 'Basilique Saint-Sernin', 43.60837, 1.44193, 239, 64),      // chevet au nord-est (axe 59°)
  L('tls_jacobins', 'Couvent des Jacobins', 43.60349, 1.44018, 261, 62),           // église, clocher, cloître
  L('tls_saintetienne', 'Cathédrale Saint-Étienne', 43.59988, 1.45046, 262, 60),
  L('tls_lagrave', 'Dôme de La Grave', 43.60081, 1.43298, 15, 70),                 // chapelle Saint-Joseph ; le dôme regarde la Garonne
  L('tls_hoteldieu', 'Hôtel-Dieu Saint-Jacques', 43.59982, 1.43661, 54, 95),       // façade sur la Garonne
  L('tls_daurade', 'Basilique de la Daurade', 43.60099, 1.43988, 232, 40),         // péristyle vers le quai
  L('tls_wilson', 'Place Wilson', 43.60485, 1.44738, 180, 12),                     // fontaine et statue de Goudouli
  L('tls_matabiau', 'Gare Matabiau', 43.61139, 1.45357, 259, 100),                 // bâtiment des voyageurs, face au canal du Midi
  L('tls_mediatheque', 'Médiathèque José-Cabanis', 43.610261, 1.455653, 228, 48),  // arche Marengo
  L('tls_halleauxgrains', 'Halle aux Grains', 43.59988, 1.45446, 195, 34),
  L('tls_palaisjustice', 'Palais de justice', 43.59390, 1.44482, 178, 72),            // ancien parlement, ailes est, nouveau palais
  // ---- sports et spectacles ----
  L('tls_stadium', 'Stadium de Toulouse', 43.58333, 1.43409, 202, 115),            // grand axe à 112°
  L('tls_zenith', 'Zénith', 43.59827, 1.40923, 183, 70),
  L('tls_wallon', 'Stade Ernest-Wallon', 43.62177, 1.41539, 157, 115),
  // ---- espace, aéronautique ----
  L('tls_citeespace', "Cité de l'espace", 43.58560, 1.49330, 180, 185),            // Ariane 5, Mir, planétarium
  L('tls_hallemachine', 'Halle de la Machine', 43.57277, 1.47811, 229, 66),        // et le Minotaure, côté Piste des Géants
  L('tls_aeroport', 'Aéroport Toulouse-Blagnac', 43.63107, 1.37311, 219, 200),     // aérogare (halls A à D) ; +Z vers les pistes
  L('tls_aeroscopia', 'Aeroscopia', 43.66000, 1.36000, 266, 115),                  // hangar en éventail, avions exposés
  // ---- ajouts ----
  L('tls_chateaudeau', "Château d'eau (galerie photo)", 43.59870, 1.43693, 54, 12),
  L('tls_tourcontrole', 'Tour de contrôle de Blagnac', 43.63512, 1.36783, 219, 14),
  L('tls_airbus', 'Tarmac Airbus', 43.62220, 1.36150, 233, 30),                    // A380, A350, BelugaXL et A320 au sol
  L('tls_dalbade', 'Notre-Dame de la Dalbade', 43.59765, 1.44256, 264, 36),
  L('tls_taur', 'Notre-Dame du Taur', 43.60558, 1.44273, 262, 30),                 // le clocher-mur donne sur la rue du Taur
  L('tls_augustins', 'Musée des Augustins', 43.601079, 1.446475, 264, 62),
  L('tls_assezat', "Hôtel d'Assézat", 43.60038, 1.44200, 10, 32),
  L('tls_palaissports', 'Palais des sports', 43.61224, 1.43536, 161, 55),
  L('tls_trinite', 'Fontaine de la Trinité', 43.59973, 1.44408, 180, 5),
  L('tls_jeannedarc', "Statue de Jeanne d'Arc", 43.60885, 1.44575, 180, 5),
  L('tls_monumentmorts', 'Monument aux morts', 43.59978, 1.45208, 264, 14),
  L('tls_grandrond', 'Grand Rond', 43.59578, 1.45264, 180, 20),                    // bassin, jets d'eau, kiosque à musique
  L('tls_jardinjaponais', 'Jardin japonais', 43.61230, 1.43320, 180, 28),
  L('tls_teleo', 'Téléo — station Hôpital Rangueil', 43.55833, 1.45293, 180, 22),  // la ligne entière (3 km) est construite d'ici
  L('tls_teleo_ups', 'Téléo — station Université Paul-Sabatier', 43.56023, 1.46467, 180, 22, true),
  L('tls_teleo_oncopole', 'Téléo — station Oncopole', 43.55430, 1.42827, 180, 22, true),
];

// ---- ensembles : entrées placées dans le repère d'un monument de base ----
const BY = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));
LANDMARKS.push(
  // place du Capitole : dallage et croix occitane (centre de la place), galerie des arcades à l'ouest (trois disques pour 109 m)
  R(BY.tls_capitole, 'tls_capitole_place', 'Place du Capitole', 0, 72.5, 0, 44, true),
  R(BY.tls_capitole, 'tls_capitole_arcades', 'Arcades de la place du Capitole', -2.5, 132, 180, 24, true),
  R(BY.tls_capitole, 'tls_capitole_arcades_n', 'Arcades du Capitole (nord)', -40, 132, 180, 24, true),
  R(BY.tls_capitole, 'tls_capitole_arcades_s', 'Arcades du Capitole (sud)', 35, 132, 180, 24, true),
  R(BY.tls_lagrave, 'tls_lagrave_hopital', 'Hôpital de La Grave', 72, -8, 0, 80, true),
  R(BY.tls_matabiau, 'tls_matabiau_nord', 'Gare Matabiau (aile nord)', -150, 0, 0, 70, true),
  R(BY.tls_aeroport, 'tls_aeroport_d', 'Aérogare — hall D', -255, 0, 0, 78, true),
  R(BY.tls_taur, 'tls_taur_nef', 'Notre-Dame du Taur (nef)', 0, -30, 0, 26, true),
);

export const LANDMARK_BY_ID = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));

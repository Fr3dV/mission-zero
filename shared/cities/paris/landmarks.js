import { geoFor } from '../../cities.js';

// Monuments de PARIS (projection de Paris, quelle que soit la ville courante).
const { lonLatToXZ } = geoFor('paris');

// Monuments : position réelle (centre du modèle), format { id, name, lat, lon, x, z, rot, radius }.
// rot = rotation.y (radians) du modèle 3D, dont la façade principale est construite vers +Z local.
//       Avec F = azimut réel de la façade (degrés, sens horaire depuis le nord) : rot = (180 - F)°.
// radius = rayon (m) du disque couvrant l'emprise : le module ville n'y pose aucun bâtiment.
// Les 12 premiers ids sont historiques (missions, interface, serveur) : ne jamais les renommer ni les supprimer.
const L = (id, name, lat, lon, facingDeg = 180, radius = 60) => {
  const [x, z] = lonLatToXZ(lon, lat);
  return { id, name, lat, lon, x, z, rot: ((180 - facingDeg) * Math.PI) / 180, radius };
};

export const LANDMARKS = [
  // ---- les 12 monuments d'origine ----
  L('eiffel', 'Tour Eiffel', 48.85837, 2.29448, 133, 75),               // axe Champ-de-Mars – pont d'Iéna
  L('arc', 'Arc de Triomphe', 48.87379, 2.29503, 115.5, 30),            // axe des Champs-Élysées
  L('notredame', 'Notre-Dame de Paris', 48.85297, 2.34990, 295, 75),    // façade occidentale
  L('louvre', 'Pyramide du Louvre', 48.86102, 2.33585, 289.5, 150),     // cour Napoléon, ouverte vers le Carrousel
  L('sacrecoeur', 'Sacré-Cœur', 48.88670, 2.34310, 172, 60),
  L('invalides', 'Les Invalides', 48.85505, 2.31254, 185, 115),         // église du Dôme et Saint-Louis
  L('concorde', 'Obélisque de la Concorde', 48.86563, 2.32114, 206, 62),// avec les deux fontaines
  L('pantheon', 'Panthéon', 48.84622, 2.34613, 288, 62),
  L('opera', 'Opéra Garnier', 48.872069, 2.331715, 186, 68),
  L('grandpalais', 'Grand Palais', 48.86610, 2.31250, 94, 150),         // façade sur l'avenue Winston-Churchill
  L('madeleine', 'La Madeleine', 48.87005, 2.32455, 206, 62),
  L('trocadero', 'Trocadéro', 48.86200, 2.28870, 133.7, 110),           // parvis des Droits de l'homme
  // ---- compléments d'emprise des grands ensembles ----
  L('chaillot_paris', 'Palais de Chaillot — aile Paris', 48.863099, 2.289918, 133.7, 95),
  L('chaillot_passy', 'Palais de Chaillot — aile Passy', 48.861150, 2.287087, 133.7, 95),
  L('hotelinvalides', 'Hôtel des Invalides', 48.857108, 2.312814, 185, 150),
  L('courcarree', 'Cour Carrée du Louvre', 48.860390, 2.338553, 289.5, 120),
  L('carrousel', 'Arc du Carrousel', 48.86170, 2.33290, 289.5, 175),    // avec les ailes de Flore et de Marsan
  // ---- autres grands édifices ----
  L('hoteldeville', 'Hôtel de Ville', 48.85645, 2.35235, 289, 95),
  L('pompidou', 'Centre Pompidou', 48.86064, 2.35240, 289, 100),
  L('orsay', "Musée d'Orsay", 48.85995, 2.32655, 25, 105),
  L('bourbon', 'Palais Bourbon', 48.86185, 2.31870, 22, 95),
  L('petitpalais', 'Petit Palais', 48.86605, 2.31460, 274, 80),
  L('vendome', 'Colonne Vendôme', 48.86748, 2.32944, 213, 10),
  L('lafayette', 'Galeries Lafayette', 48.873585, 2.33215, 191, 55),
  L('printemps', 'Printemps Haussmann', 48.873949, 2.327799, 191, 46),
  L('palaisroyal', 'Palais-Royal', 48.863677, 2.337103, 199, 85),
  L('palaisroyal_jardin', 'Jardin du Palais-Royal', 48.865121, 2.337859, 199, 115),
  L('institut', 'Institut de France', 48.857286, 2.337184, 19, 66),
  L('conciergerie', 'Conciergerie et Sainte-Chapelle', 48.85565, 2.34520, 24, 110),
  L('luxembourg', 'Palais du Luxembourg', 48.84855, 2.33720, 178, 85),
  L('saintsulpice', 'Église Saint-Sulpice', 48.85100, 2.33480, 263, 68),
  L('sainteustache', 'Église Saint-Eustache', 48.86335, 2.34510, 292, 62),
  L('saintjacques', 'Tour Saint-Jacques', 48.85800, 2.34895, 296, 14),
  L('saintgermain', 'Saint-Germain-des-Prés', 48.85395, 2.33440, 290, 45),
  L('moulinrouge', 'Moulin Rouge', 48.88425, 2.33225, 200, 20),
  L('saintlazare', 'Gare Saint-Lazare', 48.876271, 2.325166, 167, 125),
  L('garedunord', 'Gare du Nord', 48.88060, 2.35510, 191, 115),
  L('boursecommerce', 'Bourse de commerce', 48.86290, 2.34280, 289, 38),
  L('brongniart', 'Palais Brongniart', 48.86905, 2.34130, 289, 48),
  L('ecolemilitaire', 'École militaire', 48.85250, 2.30380, 314, 115),
  L('branly', 'Musée du quai Branly', 48.86090, 2.29780, 334, 90),
  L('flamme', 'Flamme de la Liberté', 48.864478, 2.300932, 180, 5),
  L('henri4', 'Statue de Henri IV', 48.85725, 2.34105, 120, 5),
  L('victoires', 'Place des Victoires', 48.86575, 2.34115, 200, 6),
  L('jeannedarc', "Statue de Jeanne d'Arc", 48.86385, 2.33220, 206, 3),
];

// Entrées qui ne servent qu'à réserver une emprise (construites par un autre monument) :
// masquées de la carte et du compteur de découvertes.
for (const l of LANDMARKS) if (['chaillot_paris', 'chaillot_passy', 'palaisroyal_jardin'].includes(l.id)) l.hidden = true;
export const LANDMARK_BY_ID = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));

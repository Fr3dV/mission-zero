// Lieux de PARIS : repères nommés (réutilisés par les missions), point de départ, concessions,
// parkings publics, objets à collectionner. PROPRIÉTAIRE : agent « gameplay ».
// JS pur ; projection de Paris quelle que soit la ville courante (geoFor('paris'), jamais shared/geo.js).
import { cityTools } from '../../content-core.js';
import { LANDMARKS, LANDMARK_BY_ID } from './landmarks.js';

export const tools = cityTools('paris', LANDMARK_BY_ID);
const { G, near, around } = tools;

// ---- Repères : lieux réels réutilisés par les missions ----------------------------------------
export const PLACE = {
  rueRoyale: G(48.8685, 2.3232),
  elysee: G(48.8704, 2.3167),
  concordeNord: G(48.8664, 2.3212),
  concordeSud: G(48.8648, 2.3212),
  eiffelQuai: G(48.8598, 2.2925), // pont d'Iéna
  eiffelChampDeMars: G(48.8560, 2.2980),
  etoile: around('arc', 116, 55), // débouché des Champs-Élysées
  rondPoint: G(48.8690, 2.3100),
  georgeV: G(48.8716, 2.3015),
  saintLazare: G(48.8758, 2.3254),
  gareDuNord: G(48.8800, 2.3550),
  operaPlace: G(48.8708, 2.3320),
  galeries: G(48.8733, 2.3322),
  printemps: G(48.8738, 2.3283),
  vendome: G(48.8677, 2.3295),
  palaisRoyal: G(48.8634, 2.3365),
  halles: G(48.8620, 2.3465),
  louvreRivoli: G(48.8625, 2.3360),
  louvreParking: G(48.8607, 2.3330), // parking du Carrousel
  orsay: G(48.8603, 2.3255),
  saintGermain: G(48.8540, 2.3336),
  luxembourg: G(48.8490, 2.3375),
  bonMarche: G(48.8512, 2.3245),
  odeon: G(48.8510, 2.3390),
  saintMichel: G(48.8532, 2.3437),
  sorbonne: G(48.8487, 2.3430),
  citeFleurs: G(48.8551, 2.3470), // marché aux fleurs, île de la Cité
  hotelDeVille: G(48.8566, 2.3515),
  pompidou: G(48.8606, 2.3510),
  chatelet: G(48.8581, 2.3470),
  assemblee: G(48.8619, 2.3186),
  ecoleMilitaire: G(48.8525, 2.3035),
  rueCler: G(48.8565, 2.3063),
  montaigne: G(48.8663, 2.3042),
  avenueFoch: G(48.8732, 2.2880),
  victorHugo: G(48.8698, 2.2853),
  monceau: G(48.8790, 2.3090),
  clichy: G(48.8835, 2.3275),
  moulinRouge: G(48.8841, 2.3323),
  pigalle: G(48.8822, 2.3375),
  abbesses: G(48.8843, 2.3385),
  tertre: G(48.8865, 2.3408),
  pontConcorde: G(48.8635, 2.3195),
  pontAlexandre: G(48.8639, 2.3136),
  pontInvalides: G(48.8635, 2.3105),
  pontAlma: G(48.8635, 2.3016),
  pontIena: G(48.8598, 2.2925),
  pontBirHakeim: G(48.8556, 2.2877),
  pontRoyal: G(48.8603, 2.3299),
  pontCarrousel: G(48.8595, 2.3329),
  pontNeuf: G(48.8571, 2.3413),
  pontSaintMichel: G(48.8540, 2.3447),
  pontSully: G(48.8505, 2.3585),
  teslaMadeleine: G(48.8712, 2.3222),
  porscheChamps: G(48.8708, 2.3050),
  lamboGrandeArmee: G(48.8760, 2.2870),
  quaiBranly: G(48.8612, 2.2975),
  rivoliConcorde: G(48.8660, 2.3235),
  trocaderoPlace: G(48.8630, 2.2872),
  invalidesEsplanade: G(48.8590, 2.3130),
  pantheonSoufflot: G(48.8466, 2.3440),
  notreDameParvis: near('notredame', -75, 30),
  sacreCoeurParvis: near('sacrecoeur', 0, 60),
};


/** Point d'apparition d'un nouveau joueur : sur la chaussée, côté sud-est de la place de la Concorde. lookAt = monument à regarder. */
export const SPAWN = { x: 30, z: 60, lookAt: 'concorde', label: 'Place de la Concorde' };

/** Concessions : trois adresses réelles. `show` = modèles exposés sur les podiums ; `street` = rue à privilégier. */
export const DEALERS = [
  { id: 'tesla', brand: 'Tesla', name: 'Tesla Madeleine', color: '#e63946', ...G(48.8712, 2.3222), street: 'Malesherbes', show: ['tesla_model3', 'tesla_models', 'tesla_cybertruck'] },
  { id: 'porsche', brand: 'Porsche', name: 'Porsche Champs-Élysées', color: '#f4d35e', ...G(48.8708, 2.3050), street: 'Champs-Élysées', show: ['porsche_911', 'porsche_taycan', 'porsche_cayenne'] },
  { id: 'lamborghini', brand: 'Lamborghini', name: 'Lamborghini Grande-Armée', color: '#9bff3c', ...G(48.8758, 2.2880), street: 'Grande Armée', show: ['lambo_huracan', 'lambo_aventador', 'lambo_urus'] },
];

/** Parkings publics : permettent de sortir une voiture possédée sans être propriétaire d'un bien. */
export const PUBLIC_GARAGES = [
  { id: 'parking_concorde', name: 'Parking Concorde', ...G(48.8668, 2.3228) },
  { id: 'parking_etoile', name: 'Parking Étoile-Wagram', ...G(48.8752, 2.2965) },
  { id: 'parking_saint_michel', name: 'Parking Saint-Michel', ...G(48.8525, 2.3425) },
  { id: 'parking_anvers', name: 'Parking Anvers — Montmartre', ...G(48.8828, 2.3440) },
  { id: 'parking_tour_eiffel', name: 'Parking Quai Branly', ...G(48.8605, 2.2965) },
];

/** Objet à collectionner de la ville (textes affichés). */
export const COLLECTIBLE = {
  name: 'Macaron doré', found: 'Macaron doré trouvé', color: '#ffd166',
  allFound: 'Tous les macarons dorés de Paris sont à vous. Chapeau !',
};

/** Macarons dorés cachés : un par monument (dans le disque dégagé) + quelques lieux insolites. */
const BEARINGS = { eiffel: 0, arc: 200, notredame: 250, louvre: 60, sacrecoeur: 180, invalides: 0, concorde: 300, pantheon: 250, opera: 180, grandpalais: 130, madeleine: 180, trocadero: 135 };
export const COLLECTIBLES = [
  ...LANDMARKS.filter((l) => !l.hidden).map((l) => {
    const a = ((BEARINGS[l.id] ?? 0) * Math.PI) / 180, d = l.radius * 0.92;
    return { id: 'macaron_' + l.id, label: l.name, x: l.x + Math.sin(a) * d, z: l.z - Math.cos(a) * d, snap: false };
  }),
  { id: 'macaron_pont_neuf', label: 'Pont Neuf', ...G(48.8571, 2.3413) },
  { id: 'macaron_alexandre', label: 'Pont Alexandre III', ...G(48.8639, 2.3136) },
  { id: 'macaron_bir_hakeim', label: 'Pont de Bir-Hakeim', ...G(48.8556, 2.2877) },
  { id: 'macaron_tertre', label: 'Place du Tertre', ...G(48.8865, 2.3408) },
  { id: 'macaron_moulin_rouge', label: 'Moulin Rouge', ...G(48.8841, 2.3323) },
  { id: 'macaron_monceau', label: 'Parc Monceau', ...G(48.8797, 2.3090) },
  { id: 'macaron_jardin_luxembourg', label: 'Jardin du Luxembourg', ...G(48.8485, 2.3371) },
  { id: 'macaron_palais_royal', label: 'Palais-Royal', ...G(48.8638, 2.3370) },
];

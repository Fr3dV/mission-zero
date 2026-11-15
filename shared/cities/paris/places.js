// Lieux de PARIS : repères nommés (réutilisés par les missions), point de départ, concessions,
// parkings publics, points de rendez-vous (taxi libre, Chiche), objets à collectionner. PROPRIÉTAIRE : agent « gameplay ».
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
  // contrat v6 : départs et arrivées des missions de niveau 1 ajoutées (intro, retours)
  // entrée des Champs-Élysées, sur la chaussée de la place : 50 m devant le joueur (dans le sens de circulation)
  // quand il apparaît, recalé sur la chaussée, et à 124 m de SPAWN
  concordeDepart: near('concorde', -58, -19),
  grandPalaisChurchill: G(48.8676, 2.3140), // angle des Champs-Élysées et de l'avenue Winston-Churchill
  marigny: G(48.8683, 2.3140), // théâtre Marigny, avenue de Marigny
  courDeRome: G(48.8755, 2.3250), // gare Saint-Lazare, côté rue Saint-Lazare
  palaisRoyalPlace: G(48.8628, 2.3363), // place du Palais-Royal, côté rue de Rivoli
  madeleinePlace: G(48.8693, 2.3238), // place de la Madeleine, côté rue Royale
};


/** Point d'apparition d'un nouveau joueur : sur la chaussée, côté sud-est de la place de la Concorde. lookAt = monument à regarder. */
export const SPAWN = { x: 30, z: 60, lookAt: 'concorde', label: 'Place de la Concorde' };

/** Concessions : trois adresses réelles. `show` = modèles exposés sur les podiums ; `street` = rue à privilégier. */
export const DEALERS = [
  { id: 'tesla', brand: 'Fulgur', name: 'Fulgur Madeleine', color: '#e63946', ...G(48.8712, 2.3222), street: 'Malesherbes', show: ['tesla_model3', 'tesla_models', 'tesla_cybertruck'] },
  { id: 'porsche', brand: 'Falkner', name: 'Falkner Champs-Élysées', color: '#f4d35e', ...G(48.8708, 2.3050), street: 'Champs-Élysées', show: ['porsche_911', 'porsche_taycan', 'porsche_cayenne'] },
  { id: 'lamborghini', brand: 'Muggini', name: 'Muggini Grande-Armée', color: '#9bff3c', ...G(48.8758, 2.2880), street: 'Grande Armée', show: ['lambo_huracan', 'lambo_aventador', 'lambo_urus'] },
];

/** Parkings publics : permettent de sortir une voiture possédée sans être propriétaire d'un bien. */
export const PUBLIC_GARAGES = [
  { id: 'parking_concorde', name: 'Parking Concorde', ...G(48.8668, 2.3228) },
  { id: 'parking_etoile', name: 'Parking Étoile-Wagram', ...G(48.8752, 2.2965) },
  { id: 'parking_saint_michel', name: 'Parking Saint-Michel', ...G(48.8525, 2.3425) },
  { id: 'parking_anvers', name: 'Parking Anvers — Montmartre', ...G(48.8828, 2.3440) },
  { id: 'parking_tour_eiffel', name: 'Parking Quai Branly', ...G(48.8605, 2.2965) },
];

/**
 * Points de rendez-vous (contrat v6) : destinations des courses de taxi libre et des « Chiche ! », tirées par le
 * serveur. Format : { id, label, x, z, lm? }.
 *   - lieux réels, saisis en latitude / longitude SUR l'axe d'une rue carrossable au niveau du sol (ni pont, ni
 *     trémie, ni voie rapide, ni rue piétonne), hors du disque de tout monument (rayon + 10 m) ;
 *   - label = libellé affichable, toujours avec son article et commençant par « la » ou « l' » : il se place tel
 *     quel après « vers », « devant », « à » ou « près de » (« près de la Madeleine ») ;
 *   - lm: true = le point borde un monument visible (à moins de 200 m de son emprise) : clients touristes ;
 *   - densité : tout départ et toute étape de mission a au moins un point dans la couronne des courses de taxi
 *     (JOB_MIN_M..JOB_MAX_M de shared/jobs.js : 500 à 1 500 m) et un entre 900 et 2 000 m (Chiche) ; vérifié par
 *     shared/missions.test.js, ainsi que la distance à la chaussée quand le fichier de routes est présent.
 */
const R = (id, label, lat, lon, lm = false) => ({ id, label, ...G(lat, lon), ...(lm ? { lm: true } : {}) });
export const RDV_POINTS = [
  // Concorde, Madeleine, Opéra, Grands Boulevards
  R('rdv_concorde', 'la place de la Concorde', 48.86669, 2.32200, true),
  R('rdv_madeleine', 'la Madeleine', 48.86930, 2.32381, true),
  R('rdv_elysee', "l'Élysée", 48.87046, 2.31747),
  R('rdv_saint_augustin', "l'église Saint-Augustin", 48.87455, 2.32127),
  R('rdv_saint_lazare', 'la gare Saint-Lazare', 48.87523, 2.32668, true),
  R('rdv_trinite', "l'église de la Trinité", 48.87622, 2.33162),
  R('rdv_opera', "l'Opéra Garnier", 48.87079, 2.33199, true),
  R('rdv_galeries', 'la coupole des Galeries Lafayette', 48.87348, 2.33307, true),
  R('rdv_vendome', 'la place Vendôme', 48.86770, 2.32952, true),
  R('rdv_bourse', 'la place de la Bourse', 48.86881, 2.34052, true),
  R('rdv_grands_boulevards', 'la station Grands Boulevards', 48.87154, 2.34271),
  R('rdv_porte_saint_denis', 'la porte Saint-Denis', 48.86968, 2.35261),
  // Louvre, Halles, Marais
  R('rdv_louvre', 'la pyramide du Louvre', 48.86254, 2.33604, true),
  R('rdv_victoires', 'la place des Victoires', 48.86558, 2.34096, true),
  R('rdv_bourse_commerce', 'la Bourse de commerce', 48.86290, 2.34184, true),
  R('rdv_arts_et_metiers', 'la station Arts et Métiers', 48.86548, 2.35565),
  R('rdv_pompidou', "l'entrée du Centre Pompidou", 48.86133, 2.35354, true),
  R('rdv_saint_jacques', 'la tour Saint-Jacques', 48.85745, 2.34876, true),
  R('rdv_hotel_de_ville', "l'Hôtel de Ville", 48.85769, 2.35274, true),
  R('rdv_temple', 'la station Temple', 48.86810, 2.36136),
  R('rdv_archives', 'la rue des Archives', 48.86030, 2.35715),
  R('rdv_saint_paul', 'la station Saint-Paul', 48.85546, 2.36008),
  R('rdv_samaritaine', 'la Samaritaine', 48.85914, 2.34181),
  // îles et Quartier latin
  R('rdv_notre_dame', 'la cathédrale Notre-Dame', 48.85389, 2.34729, true),
  R('rdv_saint_michel', 'la fontaine Saint-Michel', 48.85334, 2.34351),
  R('rdv_sorbonne', 'la Sorbonne', 48.84872, 2.34293),
  R('rdv_pantheon', 'la place du Panthéon', 48.84665, 2.34404, true),
  R('rdv_jussieu', 'la station Jussieu', 48.84604, 2.35454),
  R('rdv_luxembourg', 'la grille du jardin du Luxembourg', 48.84663, 2.34046),
  R('rdv_odeon', "l'Odéon", 48.85099, 2.33870),
  R('rdv_institut', "la coupole de l'Institut", 48.85735, 2.33828, true),
  R('rdv_monge', 'la rue Monge', 48.84551, 2.35203),
  R('rdv_monde_arabe', "l'Institut du monde arabe", 48.84913, 2.35581),
  R('rdv_ile_saint_louis', "la rue Saint-Louis-en-l'Île", 48.85183, 2.35655),
  // Saint-Germain, Sèvres, Invalides
  R('rdv_saint_germain', "l'église Saint-Germain-des-Prés", 48.85403, 2.33344, true),
  R('rdv_saint_sulpice', 'la place Saint-Sulpice', 48.85100, 2.33289, true),
  R('rdv_saint_placide', 'la station Saint-Placide', 48.84689, 2.32700),
  R('rdv_bon_marche', "l'entrée du Bon Marché", 48.85130, 2.32499),
  R('rdv_duroc', 'la station Duroc', 48.84697, 2.31701),
  R('rdv_rue_du_bac', 'la rue du Bac', 48.85598, 2.32562),
  R('rdv_orsay', "l'entrée du musée d'Orsay", 48.85893, 2.32456, true),
  R('rdv_assemblee', "l'Assemblée nationale", 48.86278, 2.31821, true),
  R('rdv_invalides', "l'esplanade des Invalides", 48.85901, 2.31299, true),
  R('rdv_dome_invalides', 'la coupole des Invalides', 48.85318, 2.31250, true),
  R('rdv_varenne', 'la rue de Varenne', 48.85585, 2.31632),
  R('rdv_segur', 'la station Ségur', 48.84722, 2.30723),
  // Champ-de-Mars, Grenelle, Passy
  R('rdv_dupleix', 'la station Dupleix', 48.85031, 2.29354),
  R('rdv_ecole_militaire', "l'École militaire", 48.85448, 2.30579, true),
  R('rdv_saint_dominique', 'la rue Saint-Dominique', 48.85948, 2.30633),
  R('rdv_bourdonnais', "l'avenue de la Bourdonnais", 48.85754, 2.30031),
  R('rdv_eiffel', 'la tour Eiffel', 48.85937, 2.29356, true),
  R('rdv_branly', "l'entrée du musée du quai Branly", 48.86125, 2.29649, true),
  R('rdv_bir_hakeim', 'la station Bir-Hakeim', 48.85385, 2.28919),
  R('rdv_motte_picquet', 'la station La Motte-Picquet', 48.84903, 2.29844),
  R('rdv_passy', 'la rue de Passy', 48.85847, 2.28423),
  R('rdv_trocadero', 'la place du Trocadéro', 48.86262, 2.28731, true),
  R('rdv_iena', "la place d'Iéna", 48.86451, 2.29367),
  // Champs-Élysées, Étoile, Ternes, Monceau
  R('rdv_alma', 'la flamme de la Liberté', 48.86461, 2.30136, true),
  R('rdv_montaigne', "l'avenue Montaigne", 48.86606, 2.30448),
  R('rdv_grand_palais', 'la verrière du Grand Palais', 48.86760, 2.31398, true),
  R('rdv_george_v', "l'avenue des Champs-Élysées", 48.87170, 2.30156),
  R('rdv_etoile', "l'Arc de Triomphe", 48.87353, 2.29590, true),
  R('rdv_foch', "l'avenue Foch", 48.87306, 2.28803),
  R('rdv_victor_hugo', 'la place Victor-Hugo', 48.86987, 2.28525),
  R('rdv_ternes', 'la place des Ternes', 48.87820, 2.29852),
  R('rdv_pereire', 'la place Pereire', 48.88479, 2.29801),
  R('rdv_monceau', 'la rotonde du parc Monceau', 48.88041, 2.30913),
  R('rdv_rome', 'la station Rome', 48.88241, 2.32134),
  R('rdv_malesherbes', 'la station Malesherbes', 48.88304, 2.30919),
  R('rdv_europe', "la place de l'Europe", 48.87877, 2.32224),
  // Clichy, Pigalle, Montmartre, gares du Nord et de l'Est
  R('rdv_clichy', 'la place de Clichy', 48.88350, 2.32764),
  R('rdv_blanche', 'la place Blanche', 48.88378, 2.33273, true),
  R('rdv_pigalle', 'la place Pigalle', 48.88223, 2.33752),
  R('rdv_abbesses', 'la place des Abbesses', 48.88427, 2.33846),
  R('rdv_caulaincourt', 'la rue Caulaincourt', 48.88780, 2.33362),
  R('rdv_lepic', 'la rue Lepic', 48.88522, 2.33416),
  R('rdv_sacre_coeur', 'la basilique du Sacré-Cœur', 48.88715, 2.34140, true),
  R('rdv_anvers', 'la station Anvers', 48.88299, 2.34403),
  R('rdv_barbes', 'la station Barbès-Rochechouart', 48.88386, 2.35129),
  R('rdv_la_fayette', 'la rue La Fayette', 48.87596, 2.34433),
  R('rdv_gare_du_nord', 'la gare du Nord', 48.87881, 2.35381, true),
  R('rdv_poissonniere', 'la rue du Faubourg-Poissonnière', 48.87719, 2.34897),
  R('rdv_la_chapelle', 'la station La Chapelle', 48.88429, 2.35963),
  R('rdv_chateau_d_eau', "la station Château d'Eau", 48.87249, 2.35605),
  R('rdv_gare_de_l_est', "la gare de l'Est", 48.87612, 2.35846),
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

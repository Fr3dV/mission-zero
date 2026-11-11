// Lieux de TOULOUSE : repères nommés (réutilisés par les missions), point de départ, concessions,
// parkings publics, objets à collectionner. PROPRIÉTAIRE : agent « gameplay ».
// JS pur ; projection de Toulouse quelle que soit la ville courante (geoFor('toulouse'), jamais shared/geo.js).
// Positions réelles (lat, lon) ; le client les recale sur la chaussée la plus proche à l'exécution.
import { cityTools } from '../../content-core.js';
import { LANDMARKS, LANDMARK_BY_ID } from './landmarks.js';

export const tools = cityTools('toulouse', LANDMARK_BY_ID);
const { G, front } = tools;

// ---- Repères : lieux réels réutilisés par les missions ----------------------------------------
export const PLACE = {
  // hypercentre
  capitole: G(43.6046, 1.4428), // place du Capitole, côté arcades
  capitoleDonjon: G(43.6043, 1.4456), // square Charles-de-Gaulle, derrière le Capitole
  wilson: G(43.6047, 1.4473),
  jeanJaures: G(43.6058, 1.4490), // bas des allées
  jeanJauresCanal: G(43.6085, 1.4545), // haut des allées, au bord du canal
  victorHugo: G(43.6066, 1.4474), // marché Victor-Hugo
  jeanneDArc: G(43.6087, 1.4455),
  saintSernin: G(43.6083, 1.4412),
  taur: G(43.6064, 1.4432), // rue du Taur
  arnaudBernard: G(43.6105, 1.4405),
  compans: G(43.6113, 1.4350), // Compans-Caffarelli, jardin japonais
  jacobins: G(43.6036, 1.4398), // rue Lakanal
  saintPierre: G(43.6042, 1.4353), // place Saint-Pierre
  daurade: G(43.6012, 1.4395), // quai de la Daurade
  esquirol: G(43.6003, 1.4437),
  carmes: G(43.5978, 1.4455), // marché des Carmes
  dalbade: G(43.5977, 1.4418),
  saintGeorges: G(43.6022, 1.4478),
  saintEtienne: G(43.6003, 1.4497),
  saintAubin: G(43.6027, 1.4560), // marché Saint-Aubin
  halleAuxGrains: G(43.5993, 1.4540),
  francoisVerdier: G(43.5996, 1.4519), // allées François-Verdier
  grandRond: G(43.5947, 1.4525),
  jardinPlantes: G(43.5925, 1.4512),
  palaisJustice: G(43.5950, 1.4442), // place du Salin
  saintMichel: G(43.5890, 1.4470),
  // gare et canal du Midi
  matabiau: G(43.6112, 1.4532), // parvis de la gare
  ecluseBayard: G(43.6106, 1.4527),
  ecluseMatabiau: G(43.6142, 1.4490),
  ecluseMinimes: G(43.6166, 1.4367),
  ecluseBearnais: G(43.6143, 1.4262),
  pontsJumeaux: G(43.6117, 1.4192), // port de l'Embouchure
  portSaintSauveur: G(43.5968, 1.4585),
  pontDemoiselles: G(43.5866, 1.4640),
  // Garonne
  pontNeuf: G(43.5993, 1.4385),
  pontSaintPierre: G(43.6025, 1.4351), // piéton
  pontCatalans: G(43.6043, 1.4281),
  pontSaintMichel: G(43.5925, 1.4398),
  pontCoubertin: G(43.5843, 1.4345), // vers l'île du Ramier
  prairieFiltres: G(43.5965, 1.4372), // cours Dillon
  laGraveQuai: G(43.6012, 1.4388), // quai de la Daurade, face au dôme
  hotelDieuQuai: G(43.5990, 1.4398), // quai de Tounis, face à l'Hôtel-Dieu
  // rive gauche et ouest
  saintCyprien: G(43.5977, 1.4298), // marché Saint-Cyprien, place Roguet
  patteDOie: G(43.5963, 1.4235),
  arenes: G(43.5935, 1.4183),
  zenith: G(43.5961, 1.4100), // rue Roquemaurel
  cartoucherie: G(43.6008, 1.4085),
  purpan: G(43.6080, 1.4020), // hôpital Purpan, avenue du Professeur-Jean-Dausset
  saintMartinDuTouch: G(43.6045, 1.3720), // siège d'Airbus
  tournefeuille: G(43.5850, 1.3460),
  mirail: G(43.5777, 1.4040), // université Jean-Jaurès, allée Antonio-Machado
  bassoCambo: G(43.5700, 1.3925),
  reynerie: G(43.5705, 1.4015), // lac de la Reynerie
  routeEspagne: G(43.5549, 1.4230),
  // nord
  wallon: G(43.6195, 1.4175), // stade Ernest-Wallon
  septDeniers: G(43.6200, 1.4125),
  minimes: G(43.6215, 1.4345),
  chalets: G(43.6130, 1.4470),
  bonnefoy: G(43.6190, 1.4600),
  borderouge: G(43.6410, 1.4520),
  croixDaurade: G(43.6355, 1.4640),
  sesquieres: G(43.6519, 1.4248), // avenue des États-Unis
  lacSesquieres: G(43.6540, 1.4090),
  union: G(43.6565, 1.4850),
  // Blagnac
  blagnac: G(43.6360, 1.3905), // vieux Blagnac
  aeroport: G(43.6304, 1.3741), // dépose-minute de l'aérogare
  aeroscopia: G(43.6592, 1.3588), // rue Roger-Béteille
  airbusLagardere: G(43.6615, 1.3640), // usine d'assemblage Jean-Luc-Lagardère
  // est et sud-est
  balma: G(43.6110, 1.4990),
  balmaGramont: G(43.6295, 1.4822),
  cotePavee: G(43.5935, 1.4695),
  citeEspace: G(43.5863, 1.4915),
  halleMachine: G(43.5730, 1.4806), // avenue de l'Aérodrome-de-Montaudran
  montaudran: G(43.5722, 1.4850), // piste des Géants
  rangueilFac: G(43.5745, 1.4625), // faculté de pharmacie
  paulSabatier: G(43.5608, 1.4630), // université Paul-Sabatier
  chuRangueil: G(43.5584, 1.4537), // avenue du Professeur-Jean-Poulhès
  ramonville: G(43.5557, 1.4757), // terminus du métro
  ramonvilleCentre: G(43.5465, 1.4750),
  // sud
  stadium: G(43.5828, 1.4363), // allée Gabriel-Biénès, île du Ramier
  empalot: G(43.5790, 1.4425),
  pechDavid: G(43.5565, 1.4478), // belvédère des coteaux
  // rocade : points relevés sur la chaussée du « Périphérique Intérieur » (sens des aiguilles d'une montre), depuis l'ouest
  rocPurpan: G(43.6041, 1.4016),
  rocSeptDeniers: G(43.6247, 1.4183), // après le pont de l'Embouchure
  rocLalande: G(43.6455, 1.4217),
  rocCroixDaurade: G(43.6445, 1.4695),
  rocRoseraie: G(43.6259, 1.4795),
  rocLasbordes: G(43.5983, 1.4920),
  rocMontaudran: G(43.5751, 1.4964),
  rocPalays: G(43.5652, 1.4849),
  rocRangueil: G(43.5722, 1.4618),
  rocEmpalot: G(43.5746, 1.4396), // pont d'Empalot, au-dessus de la Garonne
  rocLanglade: G(43.5694, 1.4235),
  rocCepiere: G(43.5849, 1.4029),
};

/** Point d'apparition d'un nouveau joueur : place du Capitole, côté rue (angle sud-ouest, rue Dominique-Baudis). lookAt = monument à regarder. */
export const SPAWN = { ...G(43.6040, 1.4431), lookAt: 'tls_capitole', label: 'Place du Capitole' };

/** Concessions, dans les vraies zones de concessions de l'agglomération. `street` = voie à privilégier si elle existe. */
export const DEALERS = [
  { id: 'tls_tesla', brand: 'Tesla', name: 'Tesla Balma-Gramont', color: '#e63946', ...G(43.6300, 1.4835), street: 'Lavaur', show: ['tesla_model3', 'tesla_models', 'tesla_cybertruck'] },
  { id: 'tls_porsche', brand: 'Porsche', name: "Porsche Route d'Espagne", color: '#f4d35e', ...G(43.5558, 1.4237), street: 'Espagne', show: ['porsche_911', 'porsche_taycan', 'porsche_cayenne'] },
  { id: 'tls_lamborghini', brand: 'Lamborghini', name: 'Lamborghini Sesquières', color: '#9bff3c', ...G(43.6528, 1.4243), street: 'États-Unis', show: ['lambo_huracan', 'lambo_aventador', 'lambo_urus'] },
];

/** Parkings publics : permettent de sortir une voiture possédée sans être propriétaire d'un bien. */
export const PUBLIC_GARAGES = [
  { id: 'tls_parking_capitole', name: 'Parking du Capitole', ...G(43.6050, 1.4425) },
  { id: 'tls_parking_jean_jaures', name: 'Parking Jean-Jaurès', ...G(43.6063, 1.4500) },
  { id: 'tls_parking_esquirol', name: 'Parking Esquirol', ...G(43.6002, 1.4442) },
  { id: 'tls_parking_carmes', name: 'Parking des Carmes', ...G(43.5980, 1.4460) },
  { id: 'tls_parking_victor_hugo', name: 'Parking Victor-Hugo', ...G(43.6069, 1.4478) },
  { id: 'tls_parking_jeanne_d_arc', name: "Parking Jeanne-d'Arc", ...G(43.6089, 1.4459) },
  { id: 'tls_parking_aeroport', name: "Parking de l'aéroport", ...G(43.6309, 1.3749) },
  { id: 'tls_parking_gramont', name: 'Parc relais Balma-Gramont', ...G(43.6292, 1.4815) },
  { id: 'tls_parking_ramonville', name: 'Parc relais Ramonville', ...G(43.5555, 1.4765) },
  { id: 'tls_parking_arenes', name: 'Parc relais des Arènes', ...G(43.5932, 1.4178) },
];

/** Objet à collectionner de la ville (textes affichés). */
export const COLLECTIBLE = {
  name: 'Violette de Toulouse', found: 'Violette cueillie', color: '#b388ff',
  allFound: 'Toutes les violettes de Toulouse sont dans votre bouquet. Macarel, quel flair !',
};

/** Violettes cachées : une devant chaque monument (dans son emprise dégagée) + quelques lieux insolites. */
export const COLLECTIBLES = [
  ...LANDMARKS.filter((l) => !l.hidden).map((l) => ({ id: 'tls_violette_' + l.id.replace(/^tls_/, ''), label: l.name, ...front(l.id, 0.9), snap: false })),
  { id: 'tls_violette_pont_neuf', label: 'Pont Neuf', ...PLACE.pontNeuf },
  { id: 'tls_violette_prairie_filtres', label: 'Prairie des Filtres', ...PLACE.prairieFiltres },
  { id: 'tls_violette_jardin_japonais', label: 'Jardin japonais', ...PLACE.compans },
  { id: 'tls_violette_ponts_jumeaux', label: 'Ponts-Jumeaux', ...PLACE.pontsJumeaux },
  { id: 'tls_violette_saint_pierre', label: 'Place Saint-Pierre', ...PLACE.saintPierre },
  { id: 'tls_violette_jardin_plantes', label: 'Jardin des Plantes', ...PLACE.jardinPlantes },
  { id: 'tls_violette_port_saint_sauveur', label: 'Port Saint-Sauveur', ...PLACE.portSaintSauveur },
  { id: 'tls_violette_pech_david', label: 'Belvédère de Pech-David', ...PLACE.pechDavid },
  { id: 'tls_violette_piste_geants', label: 'Piste des Géants', ...PLACE.montaudran },
  { id: 'tls_violette_sesquieres', label: 'Lac de Sesquières', ...PLACE.lacSesquieres },
  { id: 'tls_violette_reynerie', label: 'Lac de la Reynerie', ...PLACE.reynerie },
  { id: 'tls_violette_vieux_blagnac', label: 'Vieux Blagnac', ...PLACE.blagnac },
];

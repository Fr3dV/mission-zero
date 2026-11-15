// Lieux de TOULOUSE : repères nommés (réutilisés par les missions), point de départ, concessions,
// parkings publics, points de rendez-vous (taxi libre, Chiche), objets à collectionner. PROPRIÉTAIRE : agent « gameplay ».
// JS pur ; projection de Toulouse quelle que soit la ville courante (geoFor('toulouse'), jamais shared/geo.js).
// Positions réelles (lat, lon) ; le client les recale sur la chaussée la plus proche à l'exécution.
import { cityTools } from '../../content-core.js';
import { LANDMARKS, LANDMARK_BY_ID } from './landmarks.js';

export const tools = cityTools('toulouse', LANDMARK_BY_ID);
const { G, front } = tools;

// ---- Repères : lieux réels réutilisés par les missions ----------------------------------------
export const PLACE = {
  // hypercentre
  // rue Romiguières, à deux pas des arcades de la place du Capitole, AVANT l'angle de la rue Mirepoix : de là on repart
  // vers le sud (Mirepoix, Gambetta) comme vers le nord (rue des Lois). Plus près de la place (ancienne ancre, 43.6046 /
  // 1.4428), la rue n'a plus qu'une issue, la rue des Lois, et tout départ commençait par 1,2 km de détour.
  capitole: G(43.6047, 1.4413),
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
  // contrat v6 : départs et arrivées des missions de niveau 1 ajoutées (intro, retours)
  capitoleSud: G(43.6039, 1.4433), // angle sud-ouest de la place du Capitole, à 20 m du point d'apparition
  gambetta: G(43.6037, 1.4425), // rue Léon-Gambetta, à 60 m du point d'apparition
  carmesOuest: G(43.5973, 1.4444), // place des Carmes, côté rue Saint-Rémésy
  pargaminieres: G(43.60446, 1.43920), // rue Pargaminières, derrière les Jacobins
  larrey: G(43.60368, 1.43838), // rue Alexis-Larrey, entre les Jacobins et la place Saint-Pierre
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
  // hypercentre
  R('tls_rdv_capitole', 'la place du Capitole', 43.60370, 1.44245, true),
  R('tls_rdv_wilson', 'la place Wilson', 43.60449, 1.44736, true),
  R('tls_rdv_jean_jaures', 'la station Jean-Jaurès', 43.60569, 1.44865),
  R('tls_rdv_victor_hugo', 'la halle Victor-Hugo', 43.60661, 1.44745),
  R('tls_rdv_jeanne_d_arc', "la place Jeanne-d'Arc", 43.60870, 1.44552, true),
  R('tls_rdv_saint_sernin', 'la basilique Saint-Sernin', 43.60868, 1.44279, true),
  R('tls_rdv_arnaud_bernard', 'la place Arnaud-Bernard', 43.61051, 1.44040),
  R('tls_rdv_compans', 'la station Compans-Caffarelli', 43.61070, 1.43571),
  R('tls_rdv_jacobins', "l'église des Jacobins", 43.60447, 1.43918, true),
  R('tls_rdv_saint_pierre', 'la place Saint-Pierre', 43.60419, 1.43528),
  R('tls_rdv_daurade', 'la basilique de la Daurade', 43.60146, 1.43976, true),
  R('tls_rdv_esquirol', 'la place Esquirol', 43.60037, 1.44368),
  R('tls_rdv_assezat', "l'hôtel d'Assézat", 43.60027, 1.44254, true),
  R('tls_rdv_augustins', "l'entrée du musée des Augustins", 43.60059, 1.44507, true),
  R('tls_rdv_carmes', 'la place des Carmes', 43.59779, 1.44559),
  R('tls_rdv_salin', 'la place du Salin', 43.59489, 1.44421, true),
  R('tls_rdv_saint_georges', 'la place Saint-Georges', 43.60210, 1.44741),
  R('tls_rdv_saint_etienne', 'la cathédrale Saint-Étienne', 43.60020, 1.44966, true),
  R('tls_rdv_saint_aubin', 'la place Saint-Aubin', 43.60262, 1.45597),
  R('tls_rdv_halle_aux_grains', 'la Halle aux Grains', 43.59929, 1.45408, true),
  R('tls_rdv_grand_rond', 'la grille du Grand-Rond', 43.59469, 1.45242, true),
  R('tls_rdv_jardin_plantes', "l'entrée du Jardin des Plantes", 43.59349, 1.44875),
  R('tls_rdv_saint_michel', 'la station Saint-Michel', 43.58611, 1.44721),
  R('tls_rdv_francois_verdier', 'la station François-Verdier', 43.60051, 1.45182),
  // gare, canal, faubourgs et communes du nord et du nord-est
  R('tls_rdv_matabiau', 'la gare Matabiau', 43.61105, 1.45174, true),
  R('tls_rdv_mediatheque', 'la médiathèque José-Cabanis', 43.61001, 1.45498, true),
  R('tls_rdv_chalets', 'la rue de la Concorde', 43.61331, 1.44634),
  R('tls_rdv_canal_du_midi', 'la station Canal-du-Midi', 43.61524, 1.43471),
  R('tls_rdv_minimes', 'la station Minimes', 43.62047, 1.43587),
  R('tls_rdv_barriere_de_paris', 'la barrière de Paris', 43.62702, 1.43359),
  R('tls_rdv_la_vache', 'la station La Vache', 43.63371, 1.43599),
  R('tls_rdv_trois_cocus', 'la station Trois-Cocus', 43.63788, 1.44418),
  R('tls_rdv_borderouge', 'la station Borderouge', 43.64086, 1.45245),
  R('tls_rdv_croix_daurade', 'la mairie de Croix-Daurade', 43.63738, 1.46377),
  R('tls_rdv_bonnefoy', 'la mairie de Bonnefoy', 43.61636, 1.45349),
  R('tls_rdv_jolimont', 'la station Jolimont', 43.61494, 1.46430),
  R('tls_rdv_roseraie', 'la station Roseraie', 43.61989, 1.46961),
  R('tls_rdv_argoulets', 'la station Argoulets', 43.62376, 1.47647),
  R('tls_rdv_balma_gramont', 'la station Balma-Gramont', 43.62909, 1.48263),
  R('tls_rdv_soupetard', 'la place Soupetard', 43.61240, 1.47728),
  R('tls_rdv_balma', 'la mairie de Balma', 43.60618, 1.49920),
  R('tls_rdv_balma_marche', 'la place du marché de Balma', 43.60917, 1.49523),
  R('tls_rdv_union', "la mairie de L'Union", 43.65704, 1.48459),
  R('tls_rdv_clinique_union', "la clinique de L'Union", 43.65247, 1.50922),
  R('tls_rdv_union_avenue_toulouse', "l'avenue de Toulouse, à L'Union", 43.65168, 1.47323),
  R('tls_rdv_saint_jean', 'la mairie de Saint-Jean', 43.66520, 1.50461),
  R('tls_rdv_lalande', 'la mairie de Lalande', 43.64750, 1.43306),
  R('tls_rdv_sesquieres', "l'avenue des États-Unis", 43.65295, 1.42398),
  R('tls_rdv_lac_sesquieres', 'la base de loisirs de Sesquières', 43.65432, 1.41184),
  R('tls_rdv_aucamville', "la mairie d'Aucamville", 43.66936, 1.42959),
  // est et sud-est
  R('tls_rdv_port_saint_sauveur', 'la capitainerie du port Saint-Sauveur', 43.59686, 1.45852),
  R('tls_rdv_cote_pavee', "l'avenue Jean-Rieux", 43.59215, 1.46791),
  R('tls_rdv_hers', "la place de l'Hers", 43.59674, 1.48369),
  R('tls_rdv_cite_espace', "la Cité de l'espace", 43.58678, 1.49101, true),
  R('tls_rdv_pont_demoiselles', 'la mairie du pont des Demoiselles', 43.58551, 1.46602),
  R('tls_rdv_ormeau', "la place de l'Ormeau", 43.57925, 1.48268),
  R('tls_rdv_halle_machine', 'la Halle de la Machine', 43.57285, 1.48042, true),
  R('tls_rdv_montaudran', 'la piste des Géants', 43.57253, 1.48539),
  R('tls_rdv_saint_agne', 'la gare Saint-Agne', 43.58035, 1.44946),
  R('tls_rdv_saouzelong', 'la station Saouzelong', 43.57950, 1.45897),
  R('tls_rdv_rangueil', 'la station Rangueil', 43.57463, 1.46174),
  R('tls_rdv_fac_pharmacie', 'la faculté de pharmacie', 43.56785, 1.46432),
  R('tls_rdv_paul_sabatier', "l'université Paul-Sabatier", 43.56100, 1.46292),
  R('tls_rdv_chu_rangueil', "l'hôpital de Rangueil", 43.55842, 1.45365, true),
  R('tls_rdv_pech_david', 'la colline de Pech-David', 43.55657, 1.44739),
  R('tls_rdv_saint_orens', "l'église Saint-Jean-Bosco", 43.57018, 1.51849),
  R('tls_rdv_labege', 'la gare de Labège-Innopole', 43.54760, 1.51288),
  R('tls_rdv_ramonville', 'la station Ramonville', 43.55575, 1.47629),
  R('tls_rdv_ramonville_centre', 'la mairie de Ramonville', 43.54640, 1.47514),
  // sud et rive gauche
  R('tls_rdv_empalot', 'la station Empalot', 43.58000, 1.44174),
  R('tls_rdv_stadium', "l'entrée du Stadium", 43.58176, 1.43605, true),
  R('tls_rdv_fer_a_cheval', 'la place du Fer-à-Cheval', 43.59288, 1.43477),
  R('tls_rdv_croix_de_pierre', 'la Croix-de-Pierre', 43.58555, 1.42779),
  R('tls_rdv_saint_cyprien', 'la halle Saint-Cyprien', 43.59768, 1.42980),
  R('tls_rdv_hotel_dieu', "l'Hôtel-Dieu", 43.59901, 1.43456, true),
  R('tls_rdv_la_grave', "l'hôpital de La Grave", 43.59939, 1.43179, true),
  R('tls_rdv_patte_d_oie', "la Patte-d'Oie", 43.59645, 1.42345),
  R('tls_rdv_arenes', 'la station Arènes', 43.59269, 1.41755),
  R('tls_rdv_zenith', "l'esplanade du Zénith", 43.59610, 1.40999, true),
  R('tls_rdv_cartoucherie', 'la halle de la Cartoucherie', 43.60077, 1.40901),
  R('tls_rdv_fontaine_lestang', 'la station Fontaine-Lestang', 43.58769, 1.41839),
  R('tls_rdv_bagatelle', 'la station Bagatelle', 43.58003, 1.41198),
  R('tls_rdv_mirail', "l'université du Mirail", 43.57769, 1.40402),
  R('tls_rdv_reynerie', 'la station Reynerie', 43.57052, 1.40208),
  R('tls_rdv_basso_cambo', 'la station Basso-Cambo', 43.56992, 1.39102),
  R('tls_rdv_lafourguette', 'la place de Lafourguette', 43.56484, 1.41001),
  R('tls_rdv_saint_simon', 'la mairie de Saint-Simon', 43.55719, 1.38023),
  R('tls_rdv_route_espagne', "la route d'Espagne", 43.55487, 1.42310),
  R('tls_rdv_jean_perrin', 'la rue Jean-Perrin', 43.55168, 1.41144),
  R('tls_rdv_oncopole', "l'Oncopole", 43.55772, 1.42663),
  R('tls_rdv_mermoz', 'la station Mermoz', 43.58340, 1.41517),
  R('tls_rdv_bellefontaine', 'la station Bellefontaine', 43.56576, 1.39838),
  R('tls_rdv_gallieni', 'la gare Gallieni', 43.57299, 1.41984),
  // ouest
  R('tls_rdv_hippodrome', "l'entrée de l'hippodrome", 43.59486, 1.40953),
  R('tls_rdv_ramassiers', 'la gare des Ramassiers', 43.60183, 1.35294),
  R('tls_rdv_lardenne', 'la mairie de Lardenne', 43.58927, 1.37869),
  R('tls_rdv_pradettes', 'la place des Pradettes', 43.58125, 1.38839),
  R('tls_rdv_cugnaux', 'la mairie de Cugnaux', 43.53693, 1.34477),
  R('tls_rdv_tournefeuille', 'la mairie de Tournefeuille', 43.58360, 1.34584),
  R('tls_rdv_saint_martin', "l'église de Saint-Martin-du-Touch", 43.60139, 1.37012),
  R('tls_rdv_airbus_saint_martin', "l'entrée d'Airbus à Saint-Martin", 43.60417, 1.37190),
  R('tls_rdv_route_bayonne', 'la route de Bayonne', 43.60840, 1.38397),
  R('tls_rdv_purpan', "l'hôpital Purpan", 43.60799, 1.40197),
  R('tls_rdv_ancely', 'la place Ancely', 43.61869, 1.39728),
  R('tls_rdv_sept_deniers', 'la place des Sept-Deniers', 43.61680, 1.40805),
  R('tls_rdv_wallon', "l'entrée du stade Ernest-Wallon", 43.61969, 1.41515, true),
  R('tls_rdv_ponts_jumeaux', 'la place des Ponts-Jumeaux', 43.61503, 1.42129),
  R('tls_rdv_heracles', 'la place Héraclès', 43.60811, 1.42767),
  // Blagnac et la zone aéronautique
  R('tls_rdv_blagnac', 'la mairie de Blagnac', 43.63483, 1.39687),
  R('tls_rdv_vieux_blagnac', 'la place du vieux Blagnac', 43.63603, 1.39102),
  R('tls_rdv_odyssud', 'la salle Odyssud', 43.63630, 1.38532),
  R('tls_rdv_patinoire', 'la patinoire de Blagnac', 43.64005, 1.38269),
  R('tls_rdv_grand_noble', 'la station Grand-Noble', 43.64484, 1.37752),
  R('tls_rdv_aeroport', "l'aéroport de Blagnac", 43.62978, 1.37507, true),
  R('tls_rdv_andromede', 'la station Andromède-Lycée', 43.65478, 1.37347),
  R('tls_rdv_aeroscopia', "l'entrée d'Aeroscopia", 43.65916, 1.35841, true),
  R('tls_rdv_airbus_lagardere', "l'usine Jean-Luc-Lagardère", 43.66142, 1.36378),
  R('tls_rdv_meett', "l'entrée du MEETT", 43.66698, 1.36148),
  R('tls_rdv_beauzelle', 'la mairie de Beauzelle', 43.66838, 1.37931),
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

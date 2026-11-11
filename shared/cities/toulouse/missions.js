// Missions de TOULOUSE. PROPRIÉTAIRE : agent « gameplay ».
// Format, types et champs : voir shared/content-core.js. JS pur ; projection de Toulouse (geoFor('toulouse')).
// Tous les ids sont préfixés `tls_` (uniques toutes villes confondues).
// Ici on dit « chocolatine ». Toujours.
import { buildMissions } from '../../content-core.js';
import { tools, PLACE } from './places.js';

const { S, front } = tools;

// Recalages ciblés (voir snapTo dans content-core.js)
const BRIDGE = (name) => ({ name, bridge: true, max: 300 }); // milieu d'un pont nommé
const ROCADE = { kind: ['motorway'], name: 'Périphérique Intérieur', max: 250 }; // chaussée intérieure de la rocade (sens horaire)
const CP = { kind: 'checkpoint', radius: 18 };
const RING = { kind: 'checkpoint', radius: 45, snapTo: ROCADE };
const PHOTO = { kind: 'photo', onFoot: true, holdSec: 2, radius: 16 };

// minDurationSec et timeLimitSec sont calculés par buildMissions() à partir de la géométrie.
// `pace` (m/s) = allure moyenne exigée par le chrono sur la distance routière estimée.
const RAW = [
  // ============ Niveau 1 — Stagiaire (hypercentre) ============
  {
    id: 'tls_chocolatines_capitole', level: 1, type: 'delivery', reward: 800, cooldownSec: 90,
    title: 'Chocolatines pour le Capitole',
    description: "Ici on dit chocolatine, et monsieur le maire en a commandé trente. Filez des Carmes à la place du Capitole avant qu'elles ne refroidissent.",
    giver: { name: 'Mme Fournil', role: 'Boulangère' },
    start: PLACE.carmes, pace: 8,
    steps: [S(PLACE.capitole, 'Place du Capitole')],
  },
  {
    id: 'tls_taxi_matabiau', level: 1, type: 'taxi', reward: 1500, cooldownSec: 120, requireVehicle: true,
    title: 'Bienvenue dans la Ville rose',
    description: "Un voyageur tout juste descendu du train veut voir le Capitole. Prenez-le à la gare Matabiau et montrez-lui la brique rose.",
    giver: { name: 'M. Parisien', role: 'Voyageur' },
    passenger: { name: 'M. Parisien', color: '#457b9d' },
    start: PLACE.matabiau,
    steps: [
      S(PLACE.matabiau, 'Prendre le voyageur', { kind: 'pickup', holdSec: 2 }),
      S(PLACE.capitoleDonjon, 'Le Capitole', { kind: 'dropoff', holdSec: 1.5 }),
    ],
  },
  {
    id: 'tls_photo_ville_rose', level: 1, type: 'photo', reward: 1300, cooldownSec: 150,
    title: 'Trois cartes postales roses',
    description: "L'office de tourisme veut trois clichés : le Capitole, Saint-Sernin et les Jacobins. À pied, bien cadrés, et sans le doigt devant l'objectif.",
    giver: { name: 'Office de tourisme', role: 'Donjon du Capitole' },
    start: PLACE.capitole,
    steps: [
      S(front('tls_capitole', 1.15), 'Photographier le Capitole', { ...PHOTO, lookAt: 'tls_capitole', snap: false }),
      S(front('tls_saintsernin', 0.95), 'Photographier Saint-Sernin', { ...PHOTO, lookAt: 'tls_saintsernin', snap: false }),
      S(front('tls_jacobins', 0.95), 'Photographier les Jacobins', { ...PHOTO, lookAt: 'tls_jacobins', snap: false }),
    ],
  },
  {
    id: 'tls_violettes_wilson', level: 1, type: 'delivery', reward: 1000, cooldownSec: 100,
    title: 'Dites-le avec des violettes',
    description: "La péniche de la violette, amarrée devant la gare, envoie un bouquet à un amoureux qui attend place Wilson. Il transpire déjà.",
    giver: { name: 'Violette', role: 'Fleuriste sur péniche' },
    start: PLACE.ecluseBayard, pace: 8,
    steps: [S(PLACE.wilson, 'Place Wilson')],
  },
  {
    id: 'tls_saucisse_saint_pierre', level: 1, type: 'delivery', reward: 1200, cooldownSec: 120,
    title: 'Un mètre de saucisse',
    description: "Le bar à tapas de la place Saint-Pierre est à sec : livrez un mètre de saucisse de Toulouse depuis le marché Victor-Hugo.",
    giver: { name: 'Maison Garcia', role: 'Charcutier du marché' },
    start: PLACE.victorHugo,
    steps: [S(PLACE.saintPierre, 'Place Saint-Pierre')],
  },

  // ============ Niveau 2 — Coursier (centre et faubourgs) ============
  {
    id: 'tls_clm_boulevards', level: 2, type: 'race', reward: 3200, cooldownSec: 180, requireVehicle: true,
    title: 'Contre-la-montre des boulevards',
    description: "De la gare Matabiau au palais de justice par la ceinture des boulevards : Jean-Jaurès, François-Verdier, le Grand-Rond. Le chrono tourne !",
    giver: { name: 'Jacky Chrono', role: 'Commissaire de course' },
    start: PLACE.matabiau, pace: 13,
    steps: [
      S(PLACE.jeanJaures, 'Jean-Jaurès', CP),
      S(PLACE.francoisVerdier, 'François-Verdier', { ...CP, snapTo: { name: 'François Verdier', max: 200 } }),
      S(PLACE.grandRond, 'Grand-Rond', { ...CP, radius: 22 }),
      S(PLACE.palaisJustice, 'Palais de justice', { ...CP, radius: 20 }),
    ],
  },
  {
    id: 'tls_coursier_marches', level: 2, type: 'courier', reward: 3800, cooldownSec: 240, anyOrder: true,
    title: 'La tournée des marchés',
    description: "Quatre cagettes pour quatre marchés : Victor-Hugo, les Carmes, Saint-Cyprien et Saint-Aubin. Dans l'ordre que vous voulez, mais avant la fin du marché !",
    giver: { name: 'Zéro Primeur', role: 'Maraîcher' },
    start: PLACE.capitole,
    steps: [
      S(PLACE.victorHugo, 'Marché Victor-Hugo'),
      S(PLACE.carmes, 'Marché des Carmes'),
      S(PLACE.saintCyprien, 'Marché Saint-Cyprien'),
      S(PLACE.saintAubin, 'Marché Saint-Aubin'),
    ],
  },
  {
    id: 'tls_taxi_purpan', level: 2, type: 'taxi', reward: 3800, cooldownSec: 240, requireVehicle: true,
    title: 'Ça va naître !',
    description: "Un futur papa affolé doit rejoindre la maternité de Purpan. Doucement dans les virages… mais ne traînez pas !",
    giver: { name: 'Kévin', role: 'Futur papa' },
    passenger: { name: 'Kévin', color: '#e76f51' },
    start: PLACE.capitole, pace: 10,
    steps: [
      S(PLACE.capitole, 'Prendre le futur papa', { kind: 'pickup', holdSec: 2 }),
      S(PLACE.purpan, 'Hôpital Purpan', { kind: 'dropoff', holdSec: 1.5, radius: 16 }),
    ],
  },
  {
    id: 'tls_tour_ponts', level: 2, type: 'tour', reward: 4500, cooldownSec: 300,
    title: 'Les ponts de la Garonne',
    description: "Rive droite, rive gauche, et on recommence : traversez le pont Neuf, le pont des Catalans, le pont Saint-Michel, puis le pont Pierre-de-Coubertin vers l'île du Ramier.",
    giver: { name: 'Capitaine Garonne', role: 'Batelier' },
    start: PLACE.daurade,
    steps: [
      S(PLACE.pontNeuf, 'Pont Neuf', { radius: 18, snapTo: BRIDGE('Pont Neuf') }),
      S(PLACE.pontCatalans, 'Pont des Catalans', { radius: 18, snapTo: BRIDGE('Pont des Catalans') }),
      S(PLACE.pontSaintMichel, 'Pont Saint-Michel', { radius: 18, snapTo: BRIDGE('Pont Saint-Michel') }),
      S(PLACE.pontCoubertin, 'Pont Pierre-de-Coubertin', { radius: 18, snapTo: BRIDGE('Coubertin') }),
    ],
  },
  {
    id: 'tls_voiturier_capitole', level: 2, type: 'convoy', reward: 4000, cooldownSec: 300, requireVehicle: true,
    title: 'Voiturier du grand hôtel',
    description: "Le voiturier du grand hôtel de la place du Capitole est débordé. Garez le Cayenne d'un client au parking des Carmes… sans une rayure.",
    giver: { name: 'Firmin', role: 'Chef voiturier' },
    vehicle: { typeId: 'porsche_cayenne', provided: true }, maxDamage: 30,
    start: PLACE.capitole,
    steps: [S(PLACE.carmes, 'Parking des Carmes', { kind: 'stop', holdSec: 2 })],
  },
  {
    id: 'tls_supporters_stadium', level: 2, type: 'taxi', reward: 4200, cooldownSec: 300, requireVehicle: true,
    title: 'Allez les Violets !',
    description: "Trois supporters du Téfécé ont traîné place Saint-Pierre. Déposez-les au Stadium avant le coup d'envoi, écharpes au vent.",
    giver: { name: 'Les Violets', role: 'Supporters' },
    passenger: { name: 'Les supporters', color: '#7b2cbf' },
    start: PLACE.saintPierre, pace: 10,
    steps: [
      S(PLACE.saintPierre, 'Prendre les supporters', { kind: 'pickup', holdSec: 2 }),
      S(PLACE.stadium, 'Stadium de Toulouse', { kind: 'dropoff', holdSec: 2, radius: 18 }),
    ],
  },
  {
    id: 'tls_navette_mirail', level: 2, type: 'taxi', reward: 5500, cooldownSec: 300, requireVehicle: true,
    title: 'Partiel au Mirail',
    description: "Une étudiante a raté son métro à Esquirol et son partiel commence au Mirail. Faites la navette jusqu'à l'université.",
    giver: { name: 'Léa', role: 'Étudiante en lettres' },
    passenger: { name: 'Léa', color: '#2a9d8f' },
    start: PLACE.esquirol,
    steps: [
      S(PLACE.esquirol, "Prendre l'étudiante", { kind: 'pickup', holdSec: 2 }),
      S(PLACE.mirail, 'Université du Mirail', { kind: 'dropoff', holdSec: 1.5, radius: 16 }),
    ],
  },

  // ============ Niveau 3 — Chauffeur (toute la ville) ============
  {
    id: 'tls_navette_paul_sabatier', level: 3, type: 'taxi', reward: 8000, cooldownSec: 480, requireVehicle: true,
    title: 'Navette des facs',
    description: "Deux étudiants en retard : déposez le premier à la fac de pharmacie de Rangueil, le second à l'université Paul-Sabatier. Leur amphi n'attend pas.",
    giver: { name: 'Hugo & Inès', role: 'Étudiants en sciences' },
    passenger: { name: 'Hugo', color: '#3a86ff' },
    start: PLACE.jeanJaures, pace: 12,
    steps: [
      S(PLACE.jeanJaures, 'Prendre les étudiants', { kind: 'pickup', holdSec: 2 }),
      S(PLACE.rangueilFac, 'Faculté de pharmacie', { kind: 'stop', holdSec: 3, radius: 16 }),
      S(PLACE.paulSabatier, 'Université Paul-Sabatier', { kind: 'dropoff', holdSec: 2, radius: 16 }),
    ],
  },
  {
    id: 'tls_canal_ecluses', level: 3, type: 'tour', reward: 6500, cooldownSec: 420,
    title: "D'écluse en écluse",
    description: "Une balade le long du canal du Midi, sous les platanes : des Ponts-Jumeaux au pont des Demoiselles, saluez chaque éclusier au passage.",
    giver: { name: 'Pierre-Paul', role: 'Éclusier' },
    start: PLACE.pontsJumeaux,
    steps: [
      S(PLACE.ecluseBearnais, 'Écluse du Béarnais', { radius: 18 }),
      S(PLACE.ecluseMinimes, 'Écluse des Minimes', { radius: 18 }),
      S(PLACE.ecluseMatabiau, 'Écluse Matabiau', { radius: 18 }),
      S(PLACE.ecluseBayard, 'Écluse Bayard', { radius: 18 }),
      S(PLACE.portSaintSauveur, 'Port Saint-Sauveur', { radius: 18 }),
      S(PLACE.pontDemoiselles, 'Pont des Demoiselles', { radius: 20 }),
    ],
  },
  {
    id: 'tls_photo_garonne', level: 3, type: 'photo', reward: 5500, cooldownSec: 360,
    title: 'La Garonne au couchant',
    description: "Le dôme de La Grave au coucher du soleil, c'est LA photo de Toulouse. Ajoutez l'Hôtel-Dieu et le pont Neuf depuis la prairie des Filtres. La lumière est parfaite entre 17 h et 21 h.",
    giver: { name: 'La Dépêche du Dimanche', role: 'Journal' },
    start: PLACE.saintPierre,
    steps: [
      S(PLACE.laGraveQuai, 'Photographier le dôme de La Grave', { ...PHOTO, lookAt: 'tls_lagrave', goldenHours: [17, 21.5] }),
      S(PLACE.hotelDieuQuai, "Photographier l'Hôtel-Dieu", { ...PHOTO, lookAt: 'tls_hoteldieu' }),
      S(PLACE.prairieFiltres, 'Photographier le pont Neuf', { ...PHOTO }),
    ],
  },
  {
    id: 'tls_cassoulet_balma', level: 3, type: 'delivery', reward: 7000, cooldownSec: 420, requireVehicle: true,
    title: 'Cassoulet à emporter',
    description: "Une cassole fumante part d'un restaurant d'Esquirol pour un repas de famille à Balma. Si elle se renverse sur la banquette, c'est fichu : évitez les chocs.",
    giver: { name: 'Chef Bonhoure', role: 'Restaurateur' },
    maxDamage: 45,
    start: PLACE.esquirol, pace: 11,
    steps: [S(PLACE.balma, 'Balma — centre', { radius: 16 })],
  },
  {
    id: 'tls_supporters_wallon', level: 3, type: 'taxi', reward: 6000, cooldownSec: 420, requireVehicle: true,
    title: 'Rouge et noir',
    description: "Jour de match pour le Stade. Prenez la bande place du Capitole, passez chercher les copains à Compans, et tous à Ernest-Wallon avant le coup d'envoi !",
    giver: { name: 'Les Rouge et Noir', role: 'Supporters' },
    passenger: { name: 'Les supporters', color: '#c1121f' },
    start: PLACE.capitole, pace: 11,
    steps: [
      S(PLACE.capitole, 'Prendre les supporters', { kind: 'pickup', holdSec: 2 }),
      S(PLACE.compans, 'Les copains de Compans', { kind: 'stop', holdSec: 3, radius: 16 }),
      S(PLACE.wallon, 'Stade Ernest-Wallon', { kind: 'dropoff', holdSec: 2, radius: 18 }),
    ],
  },
  {
    id: 'tls_coursier_violettes', level: 3, type: 'courier', reward: 7500, cooldownSec: 480, anyOrder: true,
    title: 'Fête de la violette',
    description: "Cinq bouquets à livrer pour la fête de la violette : Jardin des Plantes, Halle aux Grains, Saint-Sernin, jardin japonais et Saint-Cyprien. Ordre libre.",
    giver: { name: 'Violette', role: 'Fleuriste sur péniche' },
    start: PLACE.ecluseBayard, pace: 9,
    steps: [
      S(PLACE.jardinPlantes, 'Jardin des Plantes'),
      S(PLACE.halleAuxGrains, 'Halle aux Grains'),
      S(PLACE.saintSernin, 'Saint-Sernin'),
      S(PLACE.compans, 'Jardin japonais'),
      S(PLACE.saintCyprien, 'Saint-Cyprien'),
    ],
  },
  {
    id: 'tls_montee_pech_david', level: 3, type: 'race', reward: 7000, cooldownSec: 420, requireVehicle: true,
    title: 'La montée de Pech-David',
    description: "Course de côte : du Stadium au belvédère de Pech-David par Empalot et l'hôpital de Rangueil. Là-haut, toute la ville à vos pieds.",
    giver: { name: 'Jacky Chrono', role: 'Commissaire de course' },
    start: PLACE.stadium, pace: 12,
    steps: [
      S(PLACE.empalot, 'Empalot', CP),
      S(PLACE.chuRangueil, 'Hôpital de Rangueil', { ...CP, radius: 20 }),
      S(PLACE.pechDavid, 'Belvédère de Pech-David', { ...CP, radius: 20 }),
    ],
  },

  // ============ Niveau 4 — Pilote (la banlieue commence) ============
  {
    id: 'tls_taxi_aeroport', level: 4, type: 'taxi', reward: 15000, cooldownSec: 720, requireVehicle: true,
    title: 'Vol dans quarante minutes',
    description: "Une ingénieure a un avion à prendre à Blagnac et elle est encore place Wilson. Par la rocade, c'est jouable. Par le centre, c'est perdu.",
    giver: { name: 'Mme Dassault-Latécoère', role: 'Ingénieure pressée' },
    passenger: { name: "L'ingénieure", color: '#1d3557' },
    start: PLACE.wilson, pace: 16,
    steps: [
      S(PLACE.wilson, "Prendre l'ingénieure", { kind: 'pickup', holdSec: 2 }),
      S(PLACE.aeroport, 'Aéroport Toulouse-Blagnac', { kind: 'dropoff', holdSec: 2, radius: 18 }),
    ],
  },
  {
    id: 'tls_convoi_tesla', level: 4, type: 'convoy', reward: 12500, cooldownSec: 600, requireVehicle: true,
    title: 'Model S pour la Côte Pavée',
    description: "Le showroom de Balma-Gramont livre une Model S Plaid à une notaire de la Côte Pavée. Pas une égratignure, s'il vous plaît.",
    giver: { name: 'Elodie Watt', role: 'Conseillère Tesla' },
    vehicle: { typeId: 'tesla_models', provided: true }, maxDamage: 25,
    start: PLACE.balmaGramont,
    steps: [S(PLACE.cotePavee, 'Côte Pavée', { kind: 'stop', holdSec: 2, radius: 14 })],
  },
  {
    id: 'tls_photo_espace', level: 4, type: 'photo', reward: 11000, cooldownSec: 600,
    title: 'La tête dans les étoiles',
    description: "Reportage à Montaudran : Ariane 5 dressée à la Cité de l'espace, le Minotaure de la Halle de la Machine, puis la piste des Géants d'où décollaient les pionniers.",
    giver: { name: 'Ciel & Briques', role: 'Magazine' },
    start: PLACE.cotePavee,
    steps: [
      S(PLACE.citeEspace, 'Photographier Ariane 5', { ...PHOTO, lookAt: 'tls_citeespace', radius: 18 }),
      S(PLACE.halleMachine, 'Photographier le Minotaure', { ...PHOTO, lookAt: 'tls_hallemachine', radius: 18 }),
      S(PLACE.montaudran, 'Photographier la piste des Géants', { ...PHOTO, radius: 18 }),
    ],
  },
  {
    id: 'tls_poursuite_ballon', level: 4, type: 'race', reward: 13000, cooldownSec: 600, requireVehicle: true,
    title: 'Le ballon ovale géant',
    description: "Le ballon de rugby gonflable de la prairie des Filtres s'est envolé ! Suivez-le de point en point avant qu'il ne reparte : chaque étape a son propre chrono.",
    giver: { name: 'Monsieur Zéro', role: 'Patron' },
    start: PLACE.prairieFiltres, legPace: 12,
    steps: [
      S(PLACE.pontSaintMichel, 'Pont Saint-Michel', { ...CP, snapTo: BRIDGE('Pont Saint-Michel') }),
      S(PLACE.grandRond, 'Grand-Rond', { ...CP, radius: 22 }),
      S(PLACE.halleAuxGrains, 'Halle aux Grains', CP),
      S(PLACE.matabiau, 'Gare Matabiau', { ...CP, radius: 20 }),
      S(PLACE.arnaudBernard, 'Arnaud-Bernard', CP),
      S(PLACE.compans, 'Compans-Caffarelli', { ...CP, radius: 20 }),
    ],
  },
  {
    id: 'tls_gp_garonne', level: 4, type: 'race', reward: 14500, cooldownSec: 600, requireVehicle: true,
    title: 'Grand Prix des deux rives',
    description: "Compans, Arnaud-Bernard, Jean-Jaurès, le Grand-Rond, le pont Saint-Michel, la Patte-d'Oie et retour par le pont des Catalans : le circuit urbain de la Ville rose.",
    giver: { name: 'Jacky Chrono', role: 'Commissaire de course' },
    start: PLACE.compans, pace: 17,
    steps: [
      S(PLACE.arnaudBernard, 'Arnaud-Bernard', CP),
      S(PLACE.jeanJaures, 'Jean-Jaurès', CP),
      S(PLACE.grandRond, 'Grand-Rond', { ...CP, radius: 22 }),
      S(PLACE.pontSaintMichel, 'Pont Saint-Michel', { ...CP, snapTo: BRIDGE('Pont Saint-Michel') }),
      S(PLACE.patteDOie, "Patte-d'Oie", { ...CP, radius: 20 }),
      S(PLACE.pontCatalans, 'Pont des Catalans', { ...CP, snapTo: BRIDGE('Pont des Catalans') }),
      S(PLACE.compans, 'Arrivée — Compans', { ...CP, radius: 20 }),
    ],
  },
  {
    id: 'tls_taxi_star_zenith', level: 4, type: 'taxi', reward: 17000, cooldownSec: 720, requireVehicle: true,
    title: 'Ce soir au Zénith',
    description: "Une chanteuse atterrit à Blagnac : passage éclair à son hôtel du Capitole, puis direction le Zénith. Elle ne monte que dans une belle voiture.",
    giver: { name: 'Nougarette', role: 'Chanteuse' },
    passenger: { name: 'Nougarette', color: '#111111' },
    vehicleMinPrice: 45000,
    start: PLACE.aeroport, pace: 14,
    steps: [
      S(PLACE.aeroport, 'Prendre la chanteuse', { kind: 'pickup', holdSec: 2, radius: 18 }),
      S(PLACE.capitole, 'Hôtel du Capitole', { kind: 'stop', holdSec: 4 }),
      S(PLACE.zenith, 'Zénith de Toulouse', { kind: 'dropoff', holdSec: 2, radius: 18 }),
    ],
  },

  // ============ Niveau 5 — As du volant (d'un bout à l'autre de l'agglomération) ============
  {
    id: 'tls_convoi_pieces_avion', level: 5, type: 'convoy', reward: 32000, cooldownSec: 1200, requireVehicle: true,
    title: 'Pièces détachées, avion entier',
    description: "Un empennage attend à Montaudran, berceau de l'Aéropostale. Convoyez-le dans le pick-up jusqu'à l'usine d'assemblage de Blagnac : un choc, et l'avion ne volera pas droit.",
    giver: { name: 'Chef Saint-Ex', role: "Chef d'atelier" },
    vehicle: { typeId: 'tesla_cybertruck', provided: true }, maxDamage: 20,
    start: PLACE.montaudran, pace: 17,
    steps: [S(PLACE.airbusLagardere, "Usine d'assemblage de Blagnac", { kind: 'stop', holdSec: 3, radius: 18 })],
  },
  {
    id: 'tls_convoi_porsche', level: 5, type: 'convoy', reward: 30000, cooldownSec: 900, requireVehicle: true,
    title: "La 911 de L'Union",
    description: "Un rugbyman à la retraite s'offre une 911 Turbo S. Montez-la de la route d'Espagne jusqu'à L'Union, intacte et dans les temps.",
    giver: { name: 'Ferdinand', role: 'Vendeur Porsche' },
    vehicle: { typeId: 'porsche_911', provided: true }, maxDamage: 18,
    start: PLACE.routeEspagne, pace: 17,
    steps: [S(PLACE.union, "L'Union — centre", { kind: 'stop', holdSec: 2, radius: 16 })],
  },
  {
    id: 'tls_photo_fusee_avion', level: 5, type: 'photo', reward: 32000, cooldownSec: 1200,
    title: "De la fusée à l'A380",
    description: "Le grand reportage aéronautique : Ariane 5 à la Cité de l'espace, les décollages à Blagnac, puis l'A380 d'Aeroscopia. Toute l'agglomération à traverser.",
    giver: { name: 'Ciel & Briques', role: 'Magazine' },
    start: PLACE.capitole,
    steps: [
      S(PLACE.citeEspace, 'Photographier Ariane 5', { ...PHOTO, lookAt: 'tls_citeespace', radius: 18 }),
      S(PLACE.aeroport, "Photographier l'aérogare de Blagnac", { ...PHOTO, lookAt: 'tls_aeroport', radius: 20 }),
      S(PLACE.aeroscopia, "Photographier l'A380 d'Aeroscopia", { ...PHOTO, lookAt: 'tls_aeroscopia', radius: 20 }),
    ],
  },
  {
    id: 'tls_grand_tour', level: 5, type: 'tour', reward: 34000, cooldownSec: 1200, requireVehicle: true,
    title: 'Toulouse en huit étapes',
    description: "Le défi des vrais Toulousains : Saint-Sernin, Matabiau, Saint-Étienne, la Halle aux Grains, la Cité de l'espace, la Halle de la Machine, le Stadium et le pont Neuf, d'une seule traite et chrono en main.",
    giver: { name: 'Clémence', role: 'Guide-conférencière' },
    start: PLACE.capitole, pace: 17,
    steps: [
      S(PLACE.saintSernin, 'Saint-Sernin', { radius: 20 }),
      S(PLACE.matabiau, 'Gare Matabiau', { radius: 20 }),
      S(PLACE.saintEtienne, 'Cathédrale Saint-Étienne', { radius: 20 }),
      S(PLACE.halleAuxGrains, 'Halle aux Grains', { radius: 20 }),
      S(PLACE.citeEspace, "Cité de l'espace", { radius: 22 }),
      S(PLACE.halleMachine, 'Halle de la Machine', { radius: 22 }),
      S(PLACE.stadium, 'Stadium', { radius: 22 }),
      S(PLACE.pontNeuf, 'Pont Neuf', { radius: 20, snapTo: BRIDGE('Pont Neuf') }),
    ],
  },
  {
    id: 'tls_coursier_ouest', level: 5, type: 'courier', reward: 28000, cooldownSec: 1200, anyOrder: true, requireVehicle: true,
    title: 'Colis urgents, côté piste',
    description: "Six plis pour l'ouest aéronautique : Cartoucherie, Purpan, Saint-Martin-du-Touch, l'aéroport, le vieux Blagnac et les Sept-Deniers. Ordre libre, chrono serré.",
    giver: { name: 'Zéro Colis', role: 'Messagerie' },
    start: PLACE.arenes, pace: 13,
    steps: [
      S(PLACE.cartoucherie, 'La Cartoucherie', { radius: 14 }),
      S(PLACE.purpan, 'Hôpital Purpan', { radius: 14 }),
      S(PLACE.saintMartinDuTouch, 'Saint-Martin-du-Touch', { radius: 14 }),
      S(PLACE.aeroport, 'Aéroport', { radius: 16 }),
      S(PLACE.blagnac, 'Vieux Blagnac', { radius: 14 }),
      S(PLACE.septDeniers, 'Sept-Deniers', { radius: 14 }),
    ],
  },

  // ============ Niveau 6 — Légende (la rocade et au-delà) ============
  {
    id: 'tls_tour_rocade', level: 6, type: 'race', reward: 75000, cooldownSec: 1800, requireVehicle: true,
    title: 'Le tour de la rocade',
    description: "L'épreuve reine : un tour complet du périphérique intérieur, de Purpan à Purpan dans le sens des aiguilles d'une montre. Plus de trente kilomètres, deux fois la Garonne, zéro bouchon toléré.",
    giver: { name: 'Monsieur Zéro', role: 'Patron' },
    start: PLACE.purpan, pace: 24,
    steps: [
      S(PLACE.rocSeptDeniers, 'Rocade — Sept-Deniers', RING),
      S(PLACE.rocLalande, 'Rocade — Lalande', RING),
      S(PLACE.rocCroixDaurade, 'Rocade — Croix-Daurade', RING),
      S(PLACE.rocRoseraie, 'Rocade — Roseraie', RING),
      S(PLACE.rocLasbordes, 'Rocade — Lasbordes', RING),
      S(PLACE.rocMontaudran, 'Rocade — Montaudran', RING),
      S(PLACE.rocPalays, 'Rocade — Le Palays', RING),
      S(PLACE.rocRangueil, 'Rocade — Rangueil', RING),
      S(PLACE.rocEmpalot, 'Rocade — Empalot', RING),
      S(PLACE.rocLanglade, 'Rocade — Langlade', RING),
      S(PLACE.rocCepiere, 'Rocade — La Cépière', RING),
      S(PLACE.rocPurpan, 'Arrivée — Purpan', RING),
    ],
  },
  {
    id: 'tls_convoi_aventador', level: 6, type: 'convoy', reward: 48000, cooldownSec: 1500, requireVehicle: true,
    title: 'Le taureau sur les coteaux',
    description: "Un patron de start-up veut son Aventador devant sa villa de Pech-David. Traversez toute la ville depuis Sesquières… et rendez-la comme neuve.",
    giver: { name: 'Ferruccio', role: 'Vendeur Lamborghini' },
    vehicle: { typeId: 'lambo_aventador', provided: true }, maxDamage: 12,
    start: PLACE.sesquieres, pace: 15,
    steps: [S(PLACE.pechDavid, 'Villa de Pech-David', { kind: 'stop', holdSec: 2, radius: 16 })],
  },
  {
    id: 'tls_cortege_spatial', level: 6, type: 'taxi', reward: 58000, cooldownSec: 1500, requireVehicle: true,
    title: 'Délégation spatiale',
    description: "Une astronaute en visite officielle : accueil à l'aéroport, passage à l'usine d'assemblage, réception au Capitole, puis discours à la Cité de l'espace. Voiture de prestige exigée, ponctualité aussi.",
    giver: { name: 'Commandante Claudie', role: 'Astronaute' },
    passenger: { name: "L'astronaute", color: '#f77f00' },
    vehicleMinPrice: 100000,
    start: PLACE.aeroport, pace: 18,
    steps: [
      S(PLACE.aeroport, "Prendre l'astronaute", { kind: 'pickup', holdSec: 2, radius: 18 }),
      S(PLACE.airbusLagardere, "Usine d'assemblage", { kind: 'stop', holdSec: 4, radius: 18 }),
      S(PLACE.capitole, 'Réception au Capitole', { kind: 'stop', holdSec: 4, radius: 14 }),
      S(PLACE.citeEspace, "Cité de l'espace", { kind: 'dropoff', holdSec: 2, radius: 18 }),
    ],
  },
];

// Distances routières réelles de chaque tronçon (départ→étape 1, étape 1→étape 2, …), en mètres,
// mesurées par A* (trajet le plus rapide, sens uniques respectés, voies rapides préférées) sur
// shared/world/toulouse/roads.json entre les positions recalées sur la chaussée. Sert à régler les chronos.
// Table vide ou incomplète = repli sur le vol d'oiseau × 1,35 (voir content-core.js).
// À régénérer si les positions ou les données changent (shared/missions.test.js le vérifie quand roads.json est présent).
export const ROUTE_M = {
  tls_chocolatines_capitole: [1372],
  tls_taxi_matabiau: [8, 1228],
  tls_photo_ville_rose: [1591, 2991, 1392],
  tls_violettes_wilson: [1911],
  tls_saucisse_saint_pierre: [3304],
  tls_clm_boulevards: [896, 1382, 635, 2064],
  tls_taxi_purpan: [26, 4678],
  tls_tour_ponts: [388, 1402, 1935, 1989],
  tls_voiturier_capitole: [2573],
  tls_supporters_stadium: [1, 3502],
  tls_navette_mirail: [7, 7524],
  tls_navette_paul_sabatier: [0, 4903, 2393],
  tls_canal_ecluses: [713, 1026, 1482, 1074, 2704, 2126],
  tls_photo_garonne: [789, 259, 1384],
  tls_cassoulet_balma: [6752],
  tls_supporters_wallon: [26, 919, 3050],
  tls_montee_pech_david: [1547, 3783, 1916],
  tls_taxi_aeroport: [23, 10504],
  tls_convoi_tesla: [5122],
  tls_photo_espace: [2498, 4012, 1537],
  tls_poursuite_ballon: [1986, 2073, 1464, 2563, 1912, 523],
  tls_gp_garonne: [1176, 1046, 2018, 2191, 1701, 1423, 1074],
  tls_taxi_star_zenith: [1, 9864, 4684],
  tls_convoi_pieces_avion: [21034],
  tls_convoi_porsche: [21040],
  tls_photo_fusee_avion: [8180, 20374, 4873],
  tls_grand_tour: [2377, 2370, 2034, 1637, 3719, 4012, 5939, 2996],
  tls_tour_rocade: [4815, 2356, 4880, 2313, 3324, 2678, 2848, 2306, 1930, 1476, 2752, 2330],
  tls_convoi_aventador: [15975],
  tls_cortege_spatial: [1, 5489, 14700, 8157],
};

export const MISSIONS = buildMissions(tools, RAW, ROUTE_M);
/** Monuments référencés par les missions mais absents de landmarks.js (doit rester vide : vérifié par les tests). */
export const MISSING_LANDMARKS = tools.missing;

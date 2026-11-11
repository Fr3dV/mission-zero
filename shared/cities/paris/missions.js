// Missions de PARIS. PROPRIÉTAIRE : agent « gameplay ».
// Format, types et champs : voir shared/content-core.js. JS pur ; projection de Paris (geoFor('paris')).
// Les ids sont historiques (sauvegardes serveur) : ne pas les renommer.
import { buildMissions } from '../../content-core.js';
import { tools, PLACE } from './places.js';

const { G, near, around, S } = tools;

// ---- Missions ---------------------------------------------------------------------------
// minDurationSec et timeLimitSec sont calculés plus bas à partir de la géométrie (voir finalize()).
// `pace` (m/s) = allure moyenne exigée par le chrono sur la distance routière estimée.
const RAW = [
  // ============ Niveau 1 — Stagiaire ============
  {
    id: 'croissants_elysee', level: 1, type: 'delivery', reward: 800, cooldownSec: 90,
    title: 'Croissants présidentiels',
    description: "La boulangerie de la rue Royale a une commande urgente pour l'Élysée. Livrez les croissants tant qu'ils sont chauds !",
    giver: { name: 'Mme Brioche', role: 'Boulangère' },
    start: PLACE.rueRoyale, pace: 9,
    steps: [S(PLACE.elysee, "Palais de l'Élysée", { kind: 'goto' })],
  },
  {
    id: 'livraison_eiffel', level: 1, type: 'delivery', reward: 1500, cooldownSec: 120,
    title: 'Livraison express',
    description: "Un colis attend à la Concorde. Destination : le pied de la Tour Eiffel.",
    giver: { name: 'Zéro Colis', role: 'Messagerie' },
    start: near('concorde', 45, 10),
    steps: [S(PLACE.eiffelQuai, 'Tour Eiffel — pont d\'Iéna')],
  },
  {
    id: 'taxi_touristes', level: 1, type: 'taxi', reward: 1400, cooldownSec: 120, requireVehicle: true,
    title: 'Premiers clients',
    description: "Deux touristes cherchent un taxi à la Madeleine pour aller voir la Joconde. Déposez-les au Louvre.",
    giver: { name: 'Bob & Linda', role: 'Touristes' },
    passenger: { name: 'Bob', color: '#e76f51' },
    start: PLACE.rueRoyale,
    steps: [
      S(G(48.8693, 2.3238), 'Prendre les touristes', { kind: 'pickup', holdSec: 2 }),
      S(PLACE.louvreRivoli, 'Musée du Louvre', { kind: 'dropoff', holdSec: 1.5 }),
    ],
  },
  {
    id: 'photo_concorde', level: 1, type: 'photo', reward: 1200, cooldownSec: 150,
    title: 'Cartes postales',
    description: "Un éditeur de cartes postales veut trois clichés : l'Obélisque, la Madeleine et le Grand Palais. À pied, bien cadrés !",
    giver: { name: 'Éditions du Pigeon', role: 'Éditeur' },
    start: near('concorde', 40, -30),
    steps: [
      S(around('concorde', 150, 48), "Photographier l'Obélisque", { kind: 'photo', onFoot: true, holdSec: 2, lookAt: 'concorde', radius: 14, snap: false }),
      S(G(48.8690, 2.3235), 'Photographier la Madeleine', { kind: 'photo', onFoot: true, holdSec: 2, lookAt: 'madeleine', radius: 14 }),
      S(G(48.8655, 2.3140), 'Photographier le Grand Palais', { kind: 'photo', onFoot: true, holdSec: 2, lookAt: 'grandpalais', radius: 14 }),
    ],
  },
  {
    id: 'taxi_gare', level: 1, type: 'taxi', reward: 1800, cooldownSec: 150, requireVehicle: true,
    title: 'Train à prendre',
    description: "Un voyageur en retard doit attraper son train gare Saint-Lazare. Prenez-le à l'Opéra, et ne traînez pas.",
    giver: { name: 'M. Dupressé', role: 'Voyageur' },
    passenger: { name: 'M. Dupressé', color: '#457b9d' },
    start: PLACE.operaPlace, pace: 9,
    steps: [
      S(PLACE.operaPlace, 'Prendre le voyageur', { kind: 'pickup', holdSec: 2 }),
      S(PLACE.saintLazare, 'Gare Saint-Lazare', { kind: 'dropoff', holdSec: 1.5 }),
    ],
  },

  // ============ Niveau 2 — Coursier ============
  {
    id: 'clm_champs', level: 2, type: 'race', reward: 2500, cooldownSec: 180, requireVehicle: true,
    title: 'Contre-la-montre des Champs',
    description: "De la Concorde à l'Étoile, la plus belle avenue du monde rien que pour vous. Le chrono tourne !",
    giver: { name: 'Jacky Chrono', role: 'Commissaire de course' },
    start: G(48.8664, 2.3195), pace: 15,
    steps: [
      S(PLACE.rondPoint, 'Rond-point des Champs-Élysées', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.georgeV, 'George V', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.etoile, "Place de l'Étoile", { kind: 'checkpoint', radius: 20 }),
    ],
  },
  {
    id: 'coursier_rive_gauche', level: 2, type: 'courier', reward: 3500, cooldownSec: 240, anyOrder: true,
    title: 'Tournée rive gauche',
    description: "Quatre colis à déposer rive gauche, dans l'ordre que vous voulez. Trouvez le meilleur itinéraire !",
    giver: { name: 'Zéro Colis', role: 'Messagerie' },
    start: PLACE.orsay,
    steps: [
      S(PLACE.saintGermain, 'Saint-Germain-des-Prés'),
      S(PLACE.bonMarche, 'Le Bon Marché'),
      S(PLACE.luxembourg, 'Jardin du Luxembourg'),
      S(PLACE.saintMichel, 'Fontaine Saint-Michel'),
    ],
  },
  {
    id: 'taxi_opera_louvre', level: 2, type: 'taxi', reward: 3000, cooldownSec: 240, requireVehicle: true,
    title: 'Soirée à l\'Opéra',
    description: "Une cantatrice arrive gare Saint-Lazare. Passez prendre son costume place Vendôme, puis déposez-la à l'Opéra Garnier.",
    giver: { name: 'La Castafiore', role: 'Cantatrice' },
    passenger: { name: 'La Castafiore', color: '#d62828' },
    start: PLACE.saintLazare,
    steps: [
      S(PLACE.saintLazare, 'Prendre la cantatrice', { kind: 'pickup', holdSec: 2 }),
      S(PLACE.vendome, 'Costume place Vendôme', { kind: 'stop', holdSec: 3 }),
      S(PLACE.operaPlace, 'Opéra Garnier', { kind: 'dropoff', holdSec: 1.5 }),
    ],
  },
  {
    id: 'tour_ouest', level: 2, type: 'tour', reward: 4500, cooldownSec: 300,
    title: 'Les géants de l\'Ouest',
    description: "Un guide prépare son circuit : passez par l'Arc de Triomphe, le Trocadéro, la Tour Eiffel et les Invalides.",
    giver: { name: 'Gaspard', role: 'Guide-conférencier' },
    start: PLACE.georgeV,
    steps: [
      S(PLACE.etoile, 'Arc de Triomphe', { radius: 20 }),
      S(PLACE.trocaderoPlace, 'Trocadéro', { radius: 20 }),
      S(PLACE.eiffelQuai, 'Tour Eiffel', { radius: 18 }),
      S(PLACE.invalidesEsplanade, 'Esplanade des Invalides', { radius: 20 }),
    ],
  },
  {
    id: 'voiturier_ritz', level: 2, type: 'convoy', reward: 4000, cooldownSec: 300, requireVehicle: true,
    title: 'Voiturier du palace',
    description: "Le voiturier du palace de la place Vendôme est débordé. Garez le Cayenne d'un client au parking du Carrousel… sans une rayure.",
    giver: { name: 'Firmin', role: 'Chef voiturier' },
    vehicle: { typeId: 'porsche_cayenne', provided: true }, maxDamage: 30,
    start: PLACE.vendome,
    steps: [S(PLACE.louvreParking, 'Parking du Carrousel', { kind: 'stop', holdSec: 2 })],
  },

  // ============ Niveau 3 — Chauffeur ============
  {
    id: 'tour_ponts', level: 3, type: 'race', reward: 7000, cooldownSec: 420, requireVehicle: true,
    title: 'Le tour des ponts',
    description: "Six ponts, deux rives, un seul chrono. Zigzaguez au-dessus de la Seine de la Concorde à Bir-Hakeim.",
    giver: { name: 'Capitaine Mouche', role: 'Batelier' },
    start: PLACE.concordeSud, pace: 13,
    steps: [
      S(PLACE.pontConcorde, 'Pont de la Concorde', { kind: 'checkpoint', radius: 16 }),
      S(PLACE.pontAlexandre, 'Pont Alexandre III', { kind: 'checkpoint', radius: 16 }),
      S(PLACE.pontInvalides, 'Pont des Invalides', { kind: 'checkpoint', radius: 16 }),
      S(PLACE.pontAlma, "Pont de l'Alma", { kind: 'checkpoint', radius: 16 }),
      S(PLACE.pontIena, "Pont d'Iéna", { kind: 'checkpoint', radius: 16 }),
      S(PLACE.pontBirHakeim, 'Pont de Bir-Hakeim', { kind: 'checkpoint', radius: 18 }),
    ],
  },
  {
    id: 'photo_montmartre', level: 3, type: 'photo', reward: 5000, cooldownSec: 360,
    title: 'Montmartre en trois clichés',
    description: "Un magazine veut le Moulin Rouge, la place du Tertre et le Sacré-Cœur. Grimpez sur la butte, appareil en main.",
    giver: { name: 'Paris Pêle-Mêle', role: 'Magazine' },
    start: PLACE.clichy,
    steps: [
      S(PLACE.moulinRouge, 'Photographier le Moulin Rouge', { kind: 'photo', onFoot: true, holdSec: 2, radius: 14 }),
      S(PLACE.tertre, 'Photographier la place du Tertre', { kind: 'photo', onFoot: true, holdSec: 2, radius: 14 }),
      S(PLACE.sacreCoeurParvis, 'Photographier le Sacré-Cœur', { kind: 'photo', onFoot: true, holdSec: 2, lookAt: 'sacrecoeur', radius: 16, snap: false }),
    ],
  },
  {
    id: 'visite_guidee', level: 3, type: 'taxi', reward: 8000, cooldownSec: 480, requireVehicle: true,
    title: 'Visite guidée en taxi',
    description: "Une famille veut voir Paris sans marcher. Arrêtez-vous devant chaque monument le temps d'une photo, puis terminez au Trocadéro.",
    giver: { name: 'Famille Tanaka', role: 'Visiteurs' },
    passenger: { name: 'M. Tanaka', color: '#2a9d8f' },
    start: PLACE.operaPlace,
    steps: [
      S(PLACE.operaPlace, 'Prendre la famille', { kind: 'pickup', holdSec: 2 }),
      S(PLACE.rueRoyale, 'Arrêt photo : la Madeleine', { kind: 'stop', holdSec: 3 }),
      S(PLACE.concordeNord, 'Arrêt photo : la Concorde', { kind: 'stop', holdSec: 3, radius: 16 }),
      S(PLACE.etoile, "Arrêt photo : l'Arc de Triomphe", { kind: 'stop', holdSec: 3, radius: 18 }),
      S(PLACE.trocaderoPlace, 'Trocadéro', { kind: 'dropoff', holdSec: 2, radius: 16 }),
    ],
  },
  {
    id: 'fleurs_montmartre', level: 3, type: 'delivery', reward: 6000, cooldownSec: 420, requireVehicle: true,
    title: 'Dites-le avec des fleurs',
    description: "Un bouquet géant part du marché aux fleurs de l'île de la Cité pour un mariage au Sacré-Cœur. Fragile : évitez les chocs.",
    giver: { name: 'Rose Pétale', role: 'Fleuriste' },
    maxDamage: 45,
    start: PLACE.citeFleurs, pace: 11,
    steps: [S(PLACE.sacreCoeurParvis, 'Parvis du Sacré-Cœur', { radius: 16, snap: false })],
  },
  {
    id: 'coursier_grands_magasins', level: 3, type: 'courier', reward: 7500, cooldownSec: 480, anyOrder: true,
    title: 'Fièvre des grands magasins',
    description: "Cinq retraits pour une cliente très pressée : Galeries, Printemps, Vendôme, Palais-Royal et les Halles. Ordre libre.",
    giver: { name: 'Mme de Shopping', role: 'Cliente exigeante' },
    start: PLACE.operaPlace, pace: 9,
    steps: [
      S(PLACE.galeries, 'Galeries Lafayette'),
      S(PLACE.printemps, 'Printemps Haussmann'),
      S(PLACE.vendome, 'Place Vendôme'),
      S(PLACE.palaisRoyal, 'Palais-Royal'),
      S(PLACE.halles, 'Les Halles'),
    ],
  },

  // ============ Niveau 4 — Pilote ============
  {
    id: 'convoi_tesla', level: 4, type: 'convoy', reward: 12000, cooldownSec: 600, requireVehicle: true,
    title: 'Livraison de Model S',
    description: "Le showroom Tesla de la Madeleine doit livrer une Model S Plaid à un professeur du Panthéon. Pas une égratignure, s'il vous plaît.",
    giver: { name: 'Elodie Watt', role: 'Conseillère Tesla' },
    vehicle: { typeId: 'tesla_models', provided: true }, maxDamage: 25,
    start: PLACE.teslaMadeleine,
    steps: [S(PLACE.pantheonSoufflot, 'Rue Soufflot — Panthéon', { kind: 'stop', holdSec: 2, radius: 14 })],
  },
  {
    id: 'gp_rive_droite', level: 4, type: 'race', reward: 14000, cooldownSec: 600, requireVehicle: true,
    title: 'Grand Prix de la Rive Droite',
    description: "Étoile, Concorde, Rivoli, Louvre, Opéra, Madeleine : le circuit urbain le plus chic du monde.",
    giver: { name: 'Jacky Chrono', role: 'Commissaire de course' },
    start: PLACE.etoile, pace: 17,
    steps: [
      S(PLACE.rondPoint, 'Rond-point des Champs-Élysées', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.concordeNord, 'Place de la Concorde', { kind: 'checkpoint', radius: 20 }),
      S(PLACE.louvreRivoli, 'Rue de Rivoli — Louvre', { kind: 'checkpoint', radius: 16 }),
      S(PLACE.operaPlace, "Place de l'Opéra", { kind: 'checkpoint', radius: 18 }),
      S(PLACE.rueRoyale, 'Rue Royale — Madeleine', { kind: 'checkpoint', radius: 16 }),
    ],
  },
  {
    id: 'taxi_vip_mode', level: 4, type: 'taxi', reward: 15000, cooldownSec: 720, requireVehicle: true,
    title: 'Fashion Week',
    description: "Une créatrice de mode quitte l'avenue Montaigne pour son défilé à l'Opéra, puis file à la gare du Nord. Elle ne monte que dans une belle voiture.",
    giver: { name: 'Coco Lagerfeld', role: 'Créatrice' },
    passenger: { name: 'Coco', color: '#111111' },
    vehicleMinPrice: 45000,
    start: PLACE.montaigne, pace: 13,
    steps: [
      S(PLACE.montaigne, 'Prendre la créatrice', { kind: 'pickup', holdSec: 2 }),
      S(PLACE.operaPlace, "Défilé à l'Opéra", { kind: 'stop', holdSec: 4 }),
      S(PLACE.gareDuNord, 'Gare du Nord', { kind: 'dropoff', holdSec: 2, radius: 16 }),
    ],
  },
  {
    id: 'poursuite_ballon', level: 4, type: 'race', reward: 13000, cooldownSec: 600, requireVehicle: true,
    title: 'Le ballon de Monsieur Zéro',
    description: "La montgolfière publicitaire s'est détachée ! Suivez-la de point en point avant qu'elle ne reparte : chaque étape a son propre chrono.",
    giver: { name: 'Monsieur Zéro', role: 'Patron' },
    start: PLACE.invalidesEsplanade, legPace: 12,
    steps: [
      S(PLACE.assemblee, 'Assemblée nationale', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.orsay, "Musée d'Orsay", { kind: 'checkpoint', radius: 18 }),
      S(PLACE.pontRoyal, 'Pont Royal', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.palaisRoyal, 'Palais-Royal', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.chatelet, 'Châtelet', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.hotelDeVille, 'Hôtel de Ville', { kind: 'checkpoint', radius: 20 }),
    ],
  },
  {
    id: 'photo_grands_classiques', level: 4, type: 'photo', reward: 11000, cooldownSec: 600,
    title: 'Les grands classiques',
    description: "Reportage pour un guide de voyage : Tour Eiffel depuis le Trocadéro, pyramide du Louvre, Notre-Dame et Panthéon.",
    giver: { name: 'Guide du Flâneur', role: 'Éditeur' },
    start: PLACE.trocaderoPlace,
    steps: [
      S(near('trocadero', 55, 55), 'Photographier la Tour Eiffel', { kind: 'photo', onFoot: true, holdSec: 2, lookAt: 'eiffel', radius: 18, snap: false }),
      S(near('louvre', -70, 35), 'Photographier la Pyramide', { kind: 'photo', onFoot: true, holdSec: 2, lookAt: 'louvre', radius: 18, snap: false }),
      S(PLACE.notreDameParvis, 'Photographier Notre-Dame', { kind: 'photo', onFoot: true, holdSec: 2, lookAt: 'notredame', radius: 18, snap: false }),
      S(PLACE.pantheonSoufflot, 'Photographier le Panthéon', { kind: 'photo', onFoot: true, holdSec: 2, lookAt: 'pantheon', radius: 16 }),
    ],
  },

  // ============ Niveau 5 — As du volant ============
  {
    id: 'convoi_porsche', level: 5, type: 'convoy', reward: 25000, cooldownSec: 900, requireVehicle: true,
    title: 'La 911 du peintre',
    description: "Un peintre de Montmartre s'offre une 911 Turbo S. Montez-la des Champs-Élysées jusqu'à la place du Tertre, intacte et dans les temps.",
    giver: { name: 'Ferdinand', role: 'Vendeur Porsche' },
    vehicle: { typeId: 'porsche_911', provided: true }, maxDamage: 18,
    start: PLACE.porscheChamps, pace: 12,
    steps: [S(PLACE.tertre, 'Place du Tertre', { kind: 'stop', holdSec: 2, radius: 14 })],
  },
  {
    id: 'grand_tour', level: 5, type: 'tour', reward: 30000, cooldownSec: 1200, requireVehicle: true,
    title: 'Paris en douze monuments',
    description: "Le défi des vrais Parisiens : les douze monuments de la capitale d'une seule traite, chrono en main.",
    giver: { name: 'Gaspard', role: 'Guide-conférencier' },
    start: PLACE.trocaderoPlace, pace: 15,
    steps: [
      S(PLACE.eiffelQuai, 'Tour Eiffel', { radius: 20 }),
      S(PLACE.invalidesEsplanade, 'Les Invalides', { radius: 20 }),
      S(G(48.8655, 2.3140), 'Grand Palais', { radius: 20 }),
      S(PLACE.etoile, 'Arc de Triomphe', { radius: 20 }),
      S(PLACE.concordeNord, 'Obélisque de la Concorde', { radius: 20 }),
      S(PLACE.rueRoyale, 'La Madeleine', { radius: 18 }),
      S(PLACE.operaPlace, 'Opéra Garnier', { radius: 18 }),
      S(PLACE.clichy, 'Montmartre — place de Clichy', { radius: 20 }),
      S(PLACE.louvreRivoli, 'Le Louvre', { radius: 18 }),
      S(PLACE.pontSaintMichel, 'Notre-Dame — pont Saint-Michel', { radius: 18 }),
      S(PLACE.pantheonSoufflot, 'Panthéon', { radius: 18 }),
    ],
  },
  {
    id: 'coursier_nuit_blanche', level: 5, type: 'courier', reward: 28000, cooldownSec: 1200, anyOrder: true, requireVehicle: true,
    title: 'Nuit Blanche',
    description: "Huit galeries attendent leurs œuvres avant l'ouverture. Ordre libre, chrono serré : à vous d'optimiser la tournée.",
    giver: { name: 'Galerie Zéro', role: 'Galeriste' },
    start: PLACE.pompidou, pace: 12,
    steps: [
      S(PLACE.hotelDeVille, 'Hôtel de Ville'),
      S(PLACE.halles, 'Les Halles'),
      S(PLACE.palaisRoyal, 'Palais-Royal'),
      S(PLACE.orsay, "Musée d'Orsay"),
      S(PLACE.saintGermain, 'Saint-Germain-des-Prés'),
      S(PLACE.odeon, 'Odéon'),
      S(PLACE.sorbonne, 'La Sorbonne'),
      S(PLACE.pontSully, 'Pont de Sully'),
    ],
  },
  {
    id: 'boucle_seine', level: 5, type: 'race', reward: 26000, cooldownSec: 900, requireVehicle: true,
    title: 'La grande boucle de la Seine',
    description: "Rive droite à l'aller, rive gauche au retour : la boucle des quais du pont Neuf à la Tour Eiffel.",
    giver: { name: 'Capitaine Mouche', role: 'Batelier' },
    start: PLACE.pontNeuf, pace: 19,
    steps: [
      S(PLACE.pontCarrousel, 'Pont du Carrousel', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.concordeSud, 'Quai — Concorde', { kind: 'checkpoint', radius: 20 }),
      S(PLACE.pontAlma, "Pont de l'Alma", { kind: 'checkpoint', radius: 18 }),
      S(PLACE.pontIena, "Pont d'Iéna", { kind: 'checkpoint', radius: 18 }),
      S(PLACE.quaiBranly, 'Quai Branly', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.assemblee, 'Quai d\'Orsay — Assemblée', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.orsay, "Musée d'Orsay", { kind: 'checkpoint', radius: 18 }),
      S(PLACE.pontNeuf, 'Pont Neuf', { kind: 'checkpoint', radius: 18 }),
    ],
  },

  // ============ Niveau 6 — Légende ============
  {
    id: 'convoi_aventador', level: 6, type: 'convoy', reward: 45000, cooldownSec: 1500, requireVehicle: true,
    title: 'Silence, on tourne !',
    description: "Un tournage sur le parvis de Notre-Dame réclame une Aventador orange. Traversez tout Paris depuis la Grande-Armée… et rendez-la comme neuve.",
    giver: { name: 'Luc Clap', role: 'Réalisateur' },
    vehicle: { typeId: 'lambo_aventador', provided: true }, maxDamage: 12,
    start: PLACE.lamboGrandeArmee, pace: 14,
    steps: [S(PLACE.pontSaintMichel, 'Pont Saint-Michel — Notre-Dame', { kind: 'stop', holdSec: 2, radius: 14 })],
  },
  {
    id: 'cortege_officiel', level: 6, type: 'taxi', reward: 40000, cooldownSec: 1500, requireVehicle: true,
    title: 'Cortège officiel',
    description: "Un ambassadeur enchaîne les rendez-vous : Élysée, Assemblée, Invalides puis dîner à Montmartre. Voiture de prestige exigée, ponctualité aussi.",
    giver: { name: 'Son Excellence', role: 'Ambassadeur' },
    passenger: { name: "L'ambassadeur", color: '#1d3557' },
    vehicleMinPrice: 100000,
    start: PLACE.elysee, pace: 14,
    steps: [
      S(PLACE.elysee, "Prendre l'ambassadeur", { kind: 'pickup', holdSec: 2 }),
      S(PLACE.assemblee, 'Assemblée nationale', { kind: 'stop', holdSec: 4, radius: 14 }),
      S(PLACE.invalidesEsplanade, 'Les Invalides', { kind: 'stop', holdSec: 4, radius: 16 }),
      S(PLACE.abbesses, 'Dîner aux Abbesses', { kind: 'dropoff', holdSec: 2, radius: 14 }),
    ],
  },
  {
    id: 'gp_mission_zero', level: 6, type: 'race', reward: 60000, cooldownSec: 1800, requireVehicle: true,
    title: 'Grand Prix Mission Zéro',
    description: "L'épreuve reine : un tour complet de Paris, de la Grande-Armée à Montmartre en passant par les deux rives. Réservé aux légendes.",
    giver: { name: 'Monsieur Zéro', role: 'Patron' },
    start: PLACE.avenueFoch, pace: 23,
    steps: [
      S(PLACE.etoile, "Place de l'Étoile", { kind: 'checkpoint', radius: 22 }),
      S(PLACE.trocaderoPlace, 'Trocadéro', { kind: 'checkpoint', radius: 20 }),
      S(PLACE.pontIena, "Pont d'Iéna", { kind: 'checkpoint', radius: 18 }),
      S(PLACE.ecoleMilitaire, 'École Militaire', { kind: 'checkpoint', radius: 20 }),
      S(PLACE.bonMarche, 'Le Bon Marché', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.luxembourg, 'Luxembourg', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.pontSaintMichel, 'Pont Saint-Michel', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.chatelet, 'Châtelet', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.operaPlace, 'Opéra', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.pigalle, 'Pigalle', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.monceau, 'Parc Monceau', { kind: 'checkpoint', radius: 18 }),
      S(PLACE.etoile, "Arrivée — place de l'Étoile", { kind: 'checkpoint', radius: 22 }),
    ],
  },
];


// Distances routières réelles de chaque tronçon (départ→étape 1, étape 1→étape 2, …), en mètres,
// mesurées par A* (trajet le plus rapide, sens uniques respectés) sur shared/world/paris.json entre les
// positions recalées sur la chaussée. Sert à régler les chronos.
// À régénérer si les positions changent (shared/missions.test.js le vérifie quand paris.json est présent).
export const ROUTE_M = {
  croissants_elysee: [1371],
  livraison_eiffel: [2746],
  taxi_touristes: [117, 1692],
  photo_concorde: [255, 494, 1227],
  taxi_gare: [0, 1089],
  clm_champs: [814, 681, 466],
  taxi_opera_louvre: [42, 1190, 707],
  tour_ouest: [478, 1774, 2019, 2346],
  voiturier_ritz: [2108],
  tour_ponts: [429, 641, 447, 957, 827, 792],
  photo_montmartre: [508, 2083, 135],
  visite_guidee: [0, 973, 292, 2118, 1774],
  fleurs_montmartre: [6083],
  convoi_tesla: [3939],
  gp_rive_droite: [1159, 1007, 2081, 1190, 973],
  taxi_vip_mode: [389, 3170, 2180],
  poursuite_ballon: [743, 1182, 827, 1879, 1463, 1076],
  photo_grands_classiques: [820, 3732, 2146, 995],
  convoi_porsche: [5102],
  grand_tour: [2036, 2346, 727, 1743, 2154, 300, 898, 2022, 3196, 2411, 1085],
  boucle_seine: [1387, 2552, 1960, 827, 937, 1743, 1182, 1976],
  convoi_aventador: [5801],
  cortege_officiel: [57, 1364, 754, 4841],
  gp_mission_zero: [649, 1774, 2019, 1539, 2457, 1283, 935, 804, 2248, 1589, 2995, 1467],
};

export const MISSIONS = buildMissions(tools, RAW, ROUTE_M);
/** Monuments référencés par les missions mais absents de landmarks.js (doit rester vide : vérifié par les tests). */
export const MISSING_LANDMARKS = tools.missing;

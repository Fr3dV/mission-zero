// Biens immobiliers de TOULOUSE et de sa proche banlieue. PROPRIÉTAIRE : agent « gameplay ».
// Contrat et types de biens : voir shared/content-core.js. JS pur ; projection de Toulouse (geoFor('toulouse')).
// Tous les ids sont préfixés `tls_`. Toulouse est moins chère que Paris : de 12 000 à 2 500 000 Ƶ.
// income (loyer horaire) : 0,5–0,65 % du prix pour le logement, ≈ 0,6 % pour les garages, ≈ 0,95 % pour les commerces.
import { tools } from './places.js';

const { P } = tools;

export const PROPERTIES = [
  // ---- Chambres et studios (premiers achats) ----
  P('tls_chambre_rangueil', "Chambre d'étudiant à Rangueil", 'studio', 12000, 75, 43.5700, 1.4640, { address: 'Avenue de Rangueil' }),
  P('tls_chambre_mirail', "Chambre d'étudiant au Mirail", 'studio', 12500, 80, 43.5770, 1.4040, { address: 'Rue de l\'Université du Mirail' }),
  P('tls_studio_bonnefoy', 'Studio à Bonnefoy', 'studio', 14000, 85, 43.6190, 1.4600, { address: 'Faubourg Bonnefoy' }),
  P('tls_studio_saint_michel', 'Studio à Saint-Michel', 'studio', 15000, 95, 43.5890, 1.4470, { address: 'Grande-Rue Saint-Michel' }),
  P('tls_studio_arnaud_bernard', 'Studio à Arnaud-Bernard', 'studio', 17000, 105, 43.6102, 1.4408, { address: 'Place Arnaud-Bernard' }),

  // ---- T2 et appartements ----
  P('tls_t2_minimes', 'T2 aux Minimes', 'appartement', 40000, 230, 43.6215, 1.4345, { address: 'Avenue des Minimes' }),
  P('tls_t2_saint_cyprien', 'T2 à Saint-Cyprien', 'appartement', 48000, 280, 43.5975, 1.4315, { address: 'Rue de la République' }),
  P('tls_t2_chalets', 'T2 aux Chalets', 'appartement', 58000, 330, 43.6130, 1.4470, { address: 'Rue de la Concorde' }),
  P('tls_t2_carmes', 'T2 aux Carmes', 'appartement', 62000, 360, 43.5972, 1.4448, { address: 'Rue des Filatiers' }),
  P('tls_t3_compans', 'T3 à Compans-Caffarelli', 'appartement', 70000, 400, 43.6112, 1.4345, { address: 'Boulevard Lascrosses' }),
  P('tls_appart_saint_etienne', 'Appartement à Saint-Étienne', 'appartement', 105000, 590, 43.5998, 1.4515, { address: 'Rue Croix-Baragnon' }),
  P('tls_appart_capitole', 'Appartement place du Capitole', 'appartement', 130000, 730, 43.6048, 1.4424, { address: 'Arcades de la place du Capitole' }),

  // ---- Lofts ----
  P('tls_loft_saint_aubin', "Loft d'artiste à Saint-Aubin", 'loft', 165000, 950, 43.6032, 1.4568, { address: 'Rue Riquet' }),
  P('tls_loft_cartoucherie', 'Loft à la Cartoucherie', 'loft', 190000, 1100, 43.6005, 1.4085, { address: 'Écoquartier de la Cartoucherie' }),

  // ---- Toulousaines et pavillons de banlieue ----
  P('tls_pavillon_union', "Pavillon à L'Union", 'maison', 140000, 780, 43.6560, 1.4845, { address: "L'Union" }),
  P('tls_pavillon_tournefeuille', 'Pavillon à Tournefeuille', 'maison', 145000, 800, 43.5850, 1.3465, { address: 'Tournefeuille' }),
  P('tls_toulousaine_croix_daurade', 'Toulousaine à Croix-Daurade', 'maison', 150000, 840, 43.6350, 1.4640, { address: "Route d'Albi" }),
  P('tls_pavillon_ramonville', 'Pavillon à Ramonville', 'maison', 155000, 860, 43.5468, 1.4755, { address: 'Ramonville-Saint-Agne' }),
  P('tls_pavillon_blagnac', 'Pavillon à Blagnac', 'maison', 160000, 890, 43.6370, 1.3920, { address: 'Vieux Blagnac' }),
  P('tls_pavillon_balma', 'Pavillon à Balma', 'maison', 170000, 940, 43.6105, 1.4980, { address: 'Balma' }),
  P('tls_toulousaine_cote_pavee', 'Toulousaine à la Côte Pavée', 'maison', 210000, 1150, 43.5938, 1.4700, { address: 'Avenue Jean-Rieux' }),
  P('tls_villa_pech_david', 'Villa avec piscine à Pech-David', 'villa', 680000, 3700, 43.5586, 1.4470, { address: 'Chemin des Côtes de Pech-David' }),

  // ---- Péniches ----
  P('tls_peniche_embouchure', "Péniche au port de l'Embouchure", 'peniche', 200000, 1200, 43.6113, 1.4200, { address: 'Ponts-Jumeaux' }),
  P('tls_peniche_canal', 'Péniche sur le canal du Midi', 'peniche', 230000, 1400, 43.5970, 1.4580, { address: 'Port Saint-Sauveur' }),

  // ---- Commerces (meilleur rendement) ----
  P('tls_commerce_violettes', 'Fleuriste de violettes', 'commerce', 22000, 215, 43.6090, 1.4447, { address: "Place Jeanne-d'Arc" }),
  P('tls_commerce_etal', 'Étal au marché Victor-Hugo', 'commerce', 45000, 440, 43.6064, 1.4470, { address: 'Marché Victor-Hugo' }),
  P('tls_commerce_boulangerie', "Boulangerie « La Chocolatine d'or »", 'commerce', 70000, 680, 43.6068, 1.4428, { address: 'Rue du Taur' }),
  P('tls_commerce_tapas', 'Bar à tapas place Saint-Pierre', 'commerce', 240000, 2300, 43.6040, 1.4350, { address: 'Place Saint-Pierre' }),
  P('tls_commerce_brasserie', 'Brasserie place Wilson', 'commerce', 420000, 3900, 43.6045, 1.4478, { address: 'Place Wilson' }),

  // ---- Garages ----
  P('tls_garage_box_saint_cyprien', 'Box fermé à la Patte-d\'Oie', 'garage', 20000, 120, 43.5960, 1.4240, { address: "Patte-d'Oie", garageSlots: 2 }),
  P('tls_garage_montaudran', 'Garage de la zone de Montaudran', 'garage', 95000, 560, 43.5745, 1.4835, { address: 'Montaudran', garageSlots: 6 }),
  P('tls_garage_hangar_aeroport', "Hangar près de l'aéroport", 'garage', 260000, 1500, 43.6340, 1.3790, { address: 'Blagnac — zone aéroportuaire', garageSlots: 10 }),

  // ---- Hôtels particuliers ----
  P('tls_hotel_busca', 'Hôtel particulier au Busca', 'hotel_particulier', 720000, 3900, 43.5895, 1.4540, { address: 'Allée des Demoiselles' }),
  P('tls_hotel_dalbade', 'Hôtel particulier rue de la Dalbade', 'hotel_particulier', 900000, 4900, 43.5980, 1.4418, { address: 'Rue de la Dalbade' }),

  // ---- Penthouses (objectifs longs) ----
  P('tls_penthouse_jean_jaures', 'Penthouse des allées Jean-Jaurès', 'penthouse', 1600000, 8600, 43.6070, 1.4515, { address: 'Allées Jean-Jaurès' }),
  P('tls_penthouse_garonne', 'Penthouse vue Garonne', 'penthouse', 2500000, 13500, 43.5972, 1.4403, { address: 'Quai de Tounis' }),
];

// Biens immobiliers de PARIS. PROPRIÉTAIRE : agent « gameplay ».
// Contrat et types de biens : voir shared/content-core.js. JS pur ; projection de Paris (geoFor('paris')).
// Les ids sont historiques (sauvegardes serveur) : ne pas les renommer.
import { tools } from './places.js';

const { P } = tools;

export const PROPERTIES = [
  // ---- Studios (premiers achats) ----
  P('studio_pigalle', 'Studio à Pigalle', 'studio', 15000, 90, 48.8805, 2.3400, { address: 'Rue des Martyrs, 9e' }),
  P('studio_gare_nord', 'Studio gare du Nord', 'studio', 16000, 100, 48.8795, 2.3540, { address: 'Rue de Dunkerque, 10e' }),
  P('studio_montmartre', 'Studio à Montmartre', 'studio', 20000, 130, 48.8848, 2.3335, { address: 'Rue Lepic, 18e' }),
  P('studio_batignolles', 'Studio aux Batignolles', 'studio', 20000, 125, 48.8858, 2.3195, { address: 'Rue des Batignolles, 17e' }),
  P('studio_huchette', 'Chambre de bonne au Quartier latin', 'studio', 24000, 150, 48.8527, 2.3462, { address: 'Rue de la Huchette, 5e' }),

  // ---- Appartements ----
  P('appart_montorgueil', 'Appartement rue Montorgueil', 'appartement', 75000, 430, 48.8650, 2.3468, { address: 'Rue Montorgueil, 2e' }),
  P('appart_marais', 'Appartement au Marais', 'appartement', 85000, 500, 48.8590, 2.3570, { address: 'Rue des Archives, 4e' }),
  P('appart_haussmann', 'Deux-pièces boulevard Haussmann', 'appartement', 95000, 550, 48.8735, 2.3290, { address: 'Boulevard Haussmann, 9e' }),
  P('appart_rue_cler', 'Appartement rue Cler', 'appartement', 110000, 620, 48.8565, 2.3063, { address: 'Rue Cler, 7e' }),
  P('appart_opera', "Appartement avenue de l'Opéra", 'appartement', 120000, 680, 48.8680, 2.3335, { address: "Avenue de l'Opéra, 1er" }),
  P('appart_saint_germain', 'Appartement boulevard Saint-Germain', 'appartement', 140000, 780, 48.8530, 2.3300, { address: 'Boulevard Saint-Germain, 6e' }),
  P('appart_kleber', 'Appartement avenue Kléber', 'appartement', 160000, 880, 48.8672, 2.2905, { address: 'Avenue Kléber, 16e' }),

  // ---- Lofts ----
  P('loft_montmartre', "Atelier d'artiste place du Tertre", 'loft', 180000, 1050, 48.8868, 2.3400, { address: 'Place du Tertre, 18e' }),
  P('loft_sentier', 'Loft dans le Sentier', 'loft', 210000, 1200, 48.8680, 2.3480, { address: "Rue d'Aboukir, 2e" }),
  P('loft_odeon', "Loft à l'Odéon", 'loft', 260000, 1450, 48.8500, 2.3390, { address: "Rue de l'Odéon, 6e" }),

  // ---- Péniches sur la Seine ----
  P('peniche_champs', 'Péniche port des Champs-Élysées', 'peniche', 320000, 1900, 48.8642, 2.3160, { address: 'Port des Champs-Élysées, 8e' }),
  P('peniche_montebello', 'Péniche quai de Montebello', 'peniche', 380000, 2300, 48.8521, 2.3488, { address: 'Quai de Montebello, 5e' }),
  P('peniche_suffren', 'Péniche port de Suffren', 'peniche', 450000, 2700, 48.8590, 2.2912, { address: 'Port de Suffren, 7e' }),

  // ---- Commerces (meilleur rendement) ----
  P('commerce_bouquiniste', 'Boîte de bouquiniste quai de Conti', 'commerce', 25000, 250, 48.8572, 2.3385, { address: 'Quai de Conti, 6e' }),
  P('commerce_boulangerie', 'Boulangerie « Au Zéro Défaut »', 'commerce', 60000, 580, 48.8843, 2.3382, { address: 'Rue des Abbesses, 18e' }),
  P('commerce_souvenirs', 'Boutique de souvenirs rue de Rivoli', 'commerce', 150000, 1400, 48.8625, 2.3330, { address: 'Rue de Rivoli, 1er' }),
  P('commerce_cafe', 'Café-terrasse à Saint-Germain', 'commerce', 300000, 2800, 48.8541, 2.3326, { address: 'Boulevard Saint-Germain, 6e' }),
  P('commerce_cabaret', 'Cabaret à Pigalle', 'commerce', 650000, 6000, 48.8825, 2.3360, { address: 'Boulevard de Clichy, 9e' }),

  // ---- Garages ----
  P('garage_rennes', 'Box fermé rue de Rennes', 'garage', 35000, 200, 48.8468, 2.3268, { address: 'Rue de Rennes, 6e', garageSlots: 2 }),
  P('garage_rome', 'Garage Saint-Lazare', 'garage', 220000, 1300, 48.8778, 2.3238, { address: 'Rue de Rome, 8e', garageSlots: 6 }),
  P('garage_grande_armee', 'Garage de la Grande-Armée', 'garage', 400000, 2400, 48.8755, 2.2890, { address: 'Avenue de la Grande-Armée, 17e', garageSlots: 10 }),

  // ---- Hôtels particuliers ----
  P('hotel_marais', 'Hôtel particulier du Marais', 'hotel_particulier', 950000, 5200, 48.8580, 2.3600, { address: 'Rue des Francs-Bourgeois, 3e' }),
  P('hotel_monceau', 'Hôtel particulier parc Monceau', 'hotel_particulier', 1200000, 6500, 48.8785, 2.3105, { address: 'Rue de Monceau, 8e' }),
  P('hotel_saint_louis', "Hôtel particulier de l'île Saint-Louis", 'hotel_particulier', 1500000, 8000, 48.8518, 2.3565, { address: "Quai d'Anjou, 4e" }),
  P('hotel_foch', 'Hôtel particulier avenue Foch', 'hotel_particulier', 1800000, 9500, 48.8730, 2.2870, { address: 'Avenue Foch, 16e' }),

  // ---- Penthouses (objectifs longs) ----
  P('penthouse_eiffel', 'Penthouse vue Tour Eiffel', 'penthouse', 750000, 4200, 48.8560, 2.2990, { address: 'Avenue de la Bourdonnais, 7e' }),
  P('penthouse_champs', 'Penthouse des Champs-Élysées', 'penthouse', 2600000, 14000, 48.8712, 2.3035, { address: 'Avenue des Champs-Élysées, 8e' }),
  P('penthouse_montaigne', 'Penthouse avenue Montaigne', 'penthouse', 3400000, 18000, 48.8665, 2.3048, { address: 'Avenue Montaigne, 8e' }),
  P('penthouse_vendome', 'Suite-penthouse place Vendôme', 'penthouse', 5000000, 26000, 48.8672, 2.3302, { address: 'Place Vendôme, 1er' }),
];

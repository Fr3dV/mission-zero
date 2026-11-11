import { lonLatToXZ } from './geo.js';

// Biens immobiliers achetables. PROPRIÉTAIRE DU FICHIER : agent "gameplay".
// Contrat (utilisé par serveur, UI, carte) : { id, name, kind, price, income, lat, lon, x, z }
//   income = loyer encaissé par heure de jeu réel connectée (ZéroCoins).
const P = (id, name, kind, price, income, lat, lon) => {
  const [x, z] = lonLatToXZ(lon, lat);
  return { id, name, kind, price, income, lat, lon, x, z };
};

export const PROPERTIES = [
  P('studio_montmartre', 'Studio à Montmartre', 'studio', 20000, 150, 48.8845, 2.3405),
  P('appart_marais', 'Appartement au Marais', 'appartement', 85000, 600, 48.8590, 2.3570),
  P('penthouse_eiffel', 'Penthouse vue Tour Eiffel', 'penthouse', 750000, 5000, 48.8560, 2.2990),
];

export const PROPERTY_BY_ID = Object.fromEntries(PROPERTIES.map((p) => [p.id, p]));
export const SELL_BACK_RATIO = 0.7;

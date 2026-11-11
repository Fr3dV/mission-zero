// Lieux fixes du gameplay : concessions, parkings publics (garages), objets à collectionner.
import { lonLatToXZ } from '@shared/geo.js';
import { LANDMARKS } from '@shared/landmarks.js';

const G = (lat, lon) => { const [x, z] = lonLatToXZ(lon, lat); return { x, z }; };

/** Concessions : trois adresses réelles. `show` = modèles exposés sur les podiums. */
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

/** Macarons dorés cachés : un par monument (dans le disque dégagé) + quelques lieux insolites. */
const BEARINGS = { eiffel: 0, arc: 200, notredame: 250, louvre: 60, sacrecoeur: 180, invalides: 0, concorde: 300, pantheon: 250, opera: 180, grandpalais: 130, madeleine: 180, trocadero: 135 };
export const COLLECTIBLES = [
  ...LANDMARKS.map((l) => {
    const a = ((BEARINGS[l.id] ?? 0) * Math.PI) / 180, d = l.radius * 0.92;
    return { id: 'macaron_' + l.id, label: l.name, x: l.x + Math.sin(a) * d, z: l.z - Math.cos(a) * d, snap: false };
  }),
  { id: 'macaron_pont_neuf', label: 'Pont Neuf', ...G(48.8571, 2.3413) },
  { id: 'macaron_alexandre', label: 'Pont Alexandre III', ...G(48.8639, 2.3136) },
  { id: 'macaron_bir_hakeim', label: 'Pont de Bir-Hakeim', ...G(48.8556, 2.2877) },
  { id: 'macaron_tertre', label: 'Place du Tertre', ...G(48.8865, 2.3408) },
  { id: 'macaron_moulin_rouge', label: 'Moulin Rouge', ...G(48.8841, 2.3323) },
  { id: 'macaron_monceau', label: 'Parc Monceau', ...G(48.8797, 2.3090) },
  { id: 'macaron_luxembourg', label: 'Jardin du Luxembourg', ...G(48.8485, 2.3371) },
  { id: 'macaron_palais_royal', label: 'Palais-Royal', ...G(48.8638, 2.3370) },
];

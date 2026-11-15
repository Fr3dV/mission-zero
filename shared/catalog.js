// Catalogue des véhicules — source de vérité partagée client/serveur (prix, perfs).
// Unités : vitesse en m/s, accélération en m/s², dimensions en mètres.
export const CURRENCY = { code: 'ZC', name: 'ZéroCoin', symbol: 'Ƶ' };
export const STARTING_MONEY = 5000;

export const VEHICLES = [
  { id: 'citadine', name: 'Citadine', brand: 'Générique', price: 0, maxSpeed: 38, accel: 5.5, brake: 14, grip: 1.0, length: 3.7, width: 1.7, height: 1.5, electric: false, colors: ['#c8ccd0', '#2b4a7a', '#8a1c1c'] },
  { id: 'taxi', name: 'Taxi Parisien', brand: 'G7', price: 12000, maxSpeed: 44, accel: 6.5, brake: 15, grip: 1.0, length: 4.7, width: 1.85, height: 1.5, electric: false, colors: ['#111111'] },
  { id: 'tesla_model3', name: 'Tesla Model 3', brand: 'Tesla', price: 45000, maxSpeed: 62, accel: 11, brake: 18, grip: 1.15, length: 4.69, width: 1.85, height: 1.44, electric: true, colors: ['#f2f2f2', '#c1121f', '#1d3557', '#0b0b0b'] },
  { id: 'tesla_models', name: 'Tesla Model S Plaid', brand: 'Tesla', price: 110000, maxSpeed: 89, accel: 17, brake: 20, grip: 1.25, length: 5.02, width: 1.99, height: 1.43, electric: true, colors: ['#0b0b0b', '#f2f2f2', '#7a0c0c'] },
  { id: 'tesla_cybertruck', name: 'Tesla Cybertruck', brand: 'Tesla', price: 95000, maxSpeed: 58, accel: 12, brake: 16, grip: 1.0, length: 5.68, width: 2.2, height: 1.79, electric: true, colors: ['#b9bcc0'] },
  { id: 'porsche_911', name: 'Porsche 911 Turbo S', brand: 'Porsche', price: 230000, maxSpeed: 92, accel: 16, brake: 22, grip: 1.4, length: 4.54, width: 1.9, height: 1.3, electric: false, colors: ['#f4d000', '#c1121f', '#e8e8e8', '#101820'] },
  { id: 'porsche_taycan', name: 'Porsche Taycan', brand: 'Porsche', price: 160000, maxSpeed: 72, accel: 15, brake: 21, grip: 1.3, length: 4.96, width: 1.97, height: 1.38, electric: true, colors: ['#2a6f97', '#e8e8e8', '#101820'] },
  { id: 'porsche_cayenne', name: 'Porsche Cayenne', brand: 'Porsche', price: 105000, maxSpeed: 68, accel: 10, brake: 17, grip: 1.1, length: 4.93, width: 1.98, height: 1.7, electric: false, colors: ['#101820', '#5c5c5c', '#f2f2f2'] },
  { id: 'lambo_huracan', name: 'Lamborghini Huracán', brand: 'Lamborghini', price: 260000, maxSpeed: 90, accel: 16.5, brake: 23, grip: 1.45, length: 4.52, width: 1.93, height: 1.17, electric: false, colors: ['#7ed321', '#ff7a00', '#f4d000'] },
  { id: 'lambo_aventador', name: 'Lamborghini Aventador', brand: 'Lamborghini', price: 450000, maxSpeed: 97, accel: 18, brake: 24, grip: 1.5, length: 4.8, width: 2.03, height: 1.14, electric: false, colors: ['#ff7a00', '#f4d000', '#0b0b0b', '#7ed321'] },
  { id: 'lambo_urus', name: 'Lamborghini Urus', brand: 'Lamborghini', price: 240000, maxSpeed: 85, accel: 14, brake: 20, grip: 1.25, length: 5.11, width: 2.02, height: 1.64, electric: false, colors: ['#f4d000', '#0b0b0b', '#3a86ff'] },
];

export const VEHICLE_BY_ID = Object.fromEntries(VEHICLES.map((v) => [v.id, v]));
export const STARTER_VEHICLE = 'citadine';

// ---- L'Atelier (contrat v6) : teintes et klaxons signature --------------------------------------
// `unlock` = condition de déblocage, lue côté SERVEUR dans des valeurs qui ne décroissent jamais
// (rien ne se reverrouille) : { level?, streak?, fares?, escapes?, dares?, combo?, stars? }
//   level = niveau du joueur, streak = meilleure série de jours, fares = courses de taxi, escapes = cavales
//   réussies, dares = Chiches gagnés, combo = meilleur combo de style, stars = étoiles de Légende.
// Absent = disponible d'emblée.

/**
 * Nuancier FERMÉ de l'Atelier : 8 teintes payantes et 4 exclusives (gratuites une fois la condition remplie).
 * Aucune n'est en doublon d'une teinte catalogue (spec.colors, repeinte à 500 Ƶ) ni du bleu des képis.
 * Format : { id, name, color: '#rrggbb' (minuscules), price, unlock? }.
 */
export const PAINTS = [
  { id: 'menthe', name: 'Vert menthe', color: '#3ddc97', price: 1500 },
  { id: 'corail', name: 'Corail', color: '#ff6b6b', price: 1500 },
  { id: 'lavande', name: 'Lavande', color: '#9d8df1', price: 1500 },
  { id: 'turquoise', name: 'Turquoise', color: '#00b4d8', price: 1500 },
  { id: 'rose_bonbon', name: 'Rose bonbon', color: '#ff5d8f', price: 1500 },
  { id: 'vert_anglais', name: 'Vert anglais', color: '#1b4332', price: 1500 },
  { id: 'caramel', name: 'Caramel', color: '#c68642', price: 1500 },
  { id: 'creme', name: 'Crème', color: '#f1e3c6', price: 1500 },
  // exclusives : cadenassées tant que la condition n'est pas remplie
  { id: 'aurore', name: 'Orange aurore', color: '#ffb347', price: 0, unlock: { streak: 5 } },
  { id: 'cascade', name: 'Magenta cascadeur', color: '#e0109c', price: 0, unlock: { combo: 10000 } },
  { id: 'violet_zero', name: 'Violet Zéro', color: '#7b2cbf', price: 0, unlock: { level: 6 } },
  { id: 'or_legende', name: 'Or de Légende', color: '#d4af37', price: 0, unlock: { stars: 3 } },
];
export const PAINT_BY_COLOR = Object.fromEntries(PAINTS.map((p) => [p.color, p]));

// Hauteurs de notes (Hz), gamme tempérée.
const N = {
  Mib3: 155.56, Re4: 293.66, Fa4: 349.23, Sol4: 392.0, La4: 440.0, Sib4: 466.16, Si4: 493.88,
  Do5: 523.25, Re5: 587.33, Mi5: 659.25, Sol5: 783.99, Si5: 987.77,
};

/**
 * Klaxons signature. `notes` = mélodie [[fréquence Hz, durée s], …], jouée d'un trait (2 s au plus, sans silence).
 * Airs traditionnels du domaine public ou sonneries originales uniquement.
 * Format : { id, name, unlock?, notes }.
 */
export const HORNS = [
  { id: 'std', name: "Klaxon d'origine", notes: [[420, 0.35]] },
  { id: 'pouet', name: 'Pouet', unlock: { level: 2 }, notes: [[N.Sib4, 0.1], [N.Fa4, 0.2]] },
  { id: 'deuxtons', name: 'Deux-tons', unlock: { fares: 10 }, notes: [[N.La4, 0.26], [N.Re5, 0.26], [N.La4, 0.26], [N.Re5, 0.3]] },
  // chant du coq : trois notes qui montent, la dernière tenue puis retombée
  { id: 'cocorico', name: 'Cocorico', unlock: { streak: 3 }, notes: [[N.Re5, 0.12], [N.Re5, 0.1], [N.Sol5, 0.16], [N.Si5, 0.42], [N.Sol5, 0.2]] },
  // « La Cucaracha », air traditionnel
  {
    id: 'cucaracha', name: 'La Cucaracha', unlock: { dares: 1 },
    notes: [[N.Sol4, 0.11], [N.Sol4, 0.11], [N.Sol4, 0.11], [N.Do5, 0.28], [N.Mi5, 0.3], [N.Sol4, 0.11], [N.Sol4, 0.11], [N.Sol4, 0.11], [N.Do5, 0.28], [N.Mi5, 0.3]],
  },
  { id: 'camion', name: 'Corne de camion', unlock: { escapes: 1 }, notes: [[N.Mib3, 0.3], [N.Mib3, 0.9]] },
  // « Se Canto », hymne occitan traditionnel (celui qu'on chante au Stadium)
  {
    id: 'secanto', name: 'Se Canto', unlock: { level: 4 },
    notes: [[N.Re4, 0.14], [N.Sol4, 0.14], [N.Sol4, 0.14], [N.La4, 0.14], [N.Si4, 0.28], [N.Si4, 0.14], [N.La4, 0.14], [N.La4, 0.14], [N.Si4, 0.14], [N.Sol4, 0.4]],
  },
  // sonnerie originale
  { id: 'fanfare', name: 'Fanfare', unlock: { combo: 5000 }, notes: [[N.Do5, 0.14], [N.Do5, 0.14], [N.Do5, 0.14], [N.Mi5, 0.28], [N.Do5, 0.14], [N.Mi5, 0.14], [N.Sol5, 0.5]] },
  // « Une petite musique de nuit » (Mozart, 1787)
  {
    id: 'legende', name: 'Klaxon de Légende', unlock: { stars: 1 },
    notes: [[N.Sol4, 0.3], [N.Re4, 0.15], [N.Sol4, 0.3], [N.Re4, 0.15], [N.Sol4, 0.15], [N.Re4, 0.15], [N.Sol4, 0.15], [N.Si4, 0.15], [N.Re5, 0.4]],
  },
];
export const HORN_BY_ID = Object.fromEntries(HORNS.map((h) => [h.id, h]));

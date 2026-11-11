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

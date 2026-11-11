import { lonLatToXZ } from './geo.js';

// Monuments : position réelle. rot = orientation (radians, autour de Y) de l'axe principal.
const L = (id, name, lat, lon, rotDeg = 0, radius = 60) => {
  const [x, z] = lonLatToXZ(lon, lat);
  return { id, name, lat, lon, x, z, rot: (rotDeg * Math.PI) / 180, radius };
};

export const LANDMARKS = [
  L('eiffel', 'Tour Eiffel', 48.85837, 2.29448, 45, 70),
  L('arc', 'Arc de Triomphe', 48.87379, 2.29503, -26, 30),
  L('notredame', 'Notre-Dame de Paris', 48.85297, 2.34990, -25, 70),
  L('louvre', 'Pyramide du Louvre', 48.86102, 2.33585, -26, 120),
  L('sacrecoeur', 'Sacré-Cœur', 48.88670, 2.34310, 0, 50),
  L('invalides', 'Les Invalides', 48.85505, 2.31254, 0, 90),
  L('concorde', 'Obélisque de la Concorde', 48.86563, 2.32114, 0, 20),
  L('pantheon', 'Panthéon', 48.84622, 2.34613, 20, 50),
  L('opera', 'Opéra Garnier', 48.87197, 2.33160, 0, 60),
  L('grandpalais', 'Grand Palais', 48.86610, 2.31250, -26, 90),
  L('madeleine', 'La Madeleine', 48.87005, 2.32455, 0, 45),
  L('trocadero', 'Trocadéro', 48.86200, 2.28870, 45, 80),
];

export const LANDMARK_BY_ID = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));

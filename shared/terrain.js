import { LANDMARK_BY_ID } from './landmarks.js';

// Relief : Paris est plat (y=0), sauf la butte Montmartre sous le Sacré-Cœur.
// Fonction pure et déterministe, utilisée par le client ET le serveur.
const M = LANDMARK_BY_ID.sacrecoeur;
const HILL_H = 38;
const HILL_SIGMA = 380;

export function heightAt(x, z) {
  const dx = x - M.x;
  const dz = z - M.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > 1500 * 1500) return 0;
  return HILL_H * Math.exp(-d2 / (2 * HILL_SIGMA * HILL_SIGMA));
}

export const WATER_LEVEL = -4; // surface de la Seine (les quais sont à y=0)

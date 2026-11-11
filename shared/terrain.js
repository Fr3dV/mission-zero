import { LANDMARK_BY_ID } from './landmarks.js';

// Relief : Paris est plat (y=0), sauf la butte Montmartre sous le Sacré-Cœur.
// baseHeightAt est pure et déterministe. heightAt y ajoute une couche locale optionnelle,
// enregistrée côté client par le module ville (berges de la Seine en contrebas, rampes).
const M = LANDMARK_BY_ID.sacrecoeur;
const HILL_H = 38;
const HILL_SIGMA = 380;

export function baseHeightAt(x, z) {
  const dx = x - M.x;
  const dz = z - M.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > 1500 * 1500) return 0;
  return HILL_H * Math.exp(-d2 / (2 * HILL_SIGMA * HILL_SIGMA));
}

let layer = null;
/**
 * Enregistre une couche de relief locale : fn(x, z, base) -> hauteur du sol, ou undefined pour garder `base`.
 * Appelée très souvent (joueur, véhicules, trafic, piétons) : elle doit être rapide (grille spatiale, rejet précoce).
 * Passer null pour la retirer.
 */
export function setHeightLayer(fn) { layer = fn; }

/** Hauteur du sol praticable en (x, z). Tous les modules passent par ici (ctx.heightAt). */
export function heightAt(x, z) {
  const base = baseHeightAt(x, z);
  if (layer) { const h = layer(x, z, base); if (h !== undefined) return h; }
  return base;
}

export const WATER_LEVEL = -4; // surface de la Seine (les quais sont à y=0)

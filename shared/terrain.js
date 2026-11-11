// Relief de la VILLE COURANTE. Utilisé par tous les modules via ctx.heightAt.
//
// heightAt(x, z, y?) = relief de base de la ville + couche locale du module ville (berges, rampes, ponts, tranchées).
//
//  - Relief de base (baseHeightAt) :
//      Paris    : plat (y = 0) sauf la butte Montmartre (formule analytique).
//      autres   : grille d'altitudes chargée au démarrage (setHeightmap), sinon plat.
//  - Couche locale (setHeightLayer) : enregistrée par le module ville. Elle reçoit la hauteur courante `y` de
//    l'appelant (pieds, roues) pour choisir entre des surfaces SUPERPOSÉES (tablier de pont au-dessus d'une berge
//    ou d'une rocade, trémie sous une place). Règle à respecter par la couche :
//      y fourni   -> la surface la plus haute située à moins de STEP_UP (1,2 m) au-dessus de y, sinon la plus basse ;
//      y absent   -> la surface la plus proche du relief de base (le « niveau de la rue »).
//    Tout appelant qui se déplace (joueur, véhicule, piéton, caméra) DOIT passer son y courant.
import { CITY_ID } from './cities.js';
import { LANDMARK_BY_ID as PARIS_LM } from './cities/paris/landmarks.js';

export const STEP_UP = 1.2; // marche maximale franchie sans changer de niveau (m)
export const WATER_LEVEL = -4; // surface des fleuves et canaux par rapport au quai (y = 0 au bord de l'eau)

// ---- Paris : butte Montmartre sous le Sacré-Cœur ----
const M = PARIS_LM.sacrecoeur;
const HILL_H = 38;
const HILL_SIGMA = 380;
function parisHeight(x, z) {
  const dx = x - M.x;
  const dz = z - M.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > 1500 * 1500) return 0;
  return HILL_H * Math.exp(-d2 / (2 * HILL_SIGMA * HILL_SIGMA));
}

// ---- Grille d'altitudes (autres villes) ----
// Format du fichier terrain : { x0, z0, cell, nx, nz, scale, data: [entiers] }
//   hauteur(ix, iz) = data[iz * nx + ix] * scale (mètres) au point (x0 + ix * cell, z0 + iz * cell).
// Les hauteurs sont relatives au niveau des quais (0 au bord de l'eau), pas des altitudes NGF.
let hm = null;
export function setHeightmap(grid) {
  if (!grid || !grid.data || !(grid.nx > 1) || !(grid.nz > 1)) { hm = null; return; }
  hm = { x0: +grid.x0, z0: +grid.z0, inv: 1 / grid.cell, nx: grid.nx | 0, nz: grid.nz | 0, scale: grid.scale ?? 1, data: grid.data };
}
export const hasHeightmap = () => !!hm;
function gridHeight(x, z) {
  let fx = (x - hm.x0) * hm.inv, fz = (z - hm.z0) * hm.inv;
  if (fx < 0) fx = 0; else if (fx > hm.nx - 1.001) fx = hm.nx - 1.001;
  if (fz < 0) fz = 0; else if (fz > hm.nz - 1.001) fz = hm.nz - 1.001;
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, d = hm.data, i = iz * hm.nx + ix;
  const a = d[i] + (d[i + 1] - d[i]) * tx, b = d[i + hm.nx] + (d[i + hm.nx + 1] - d[i + hm.nx]) * tx;
  return (a + (b - a) * tz) * hm.scale;
}

const PARIS = CITY_ID === 'paris';
/** Relief pur (sans la couche du module ville). */
export function baseHeightAt(x, z) {
  if (PARIS) return parisHeight(x, z);
  return hm ? gridHeight(x, z) : 0;
}

let layer = null;
/**
 * Enregistre la couche de relief locale : fn(x, z, base, y) -> hauteur du sol, ou undefined pour garder `base`.
 * `y` = hauteur courante de l'appelant, ou undefined (voir la règle en tête de fichier).
 * Appelée très souvent (joueur, véhicules, trafic, piétons) : elle doit être rapide (grille spatiale, rejet précoce).
 * Passer null pour la retirer.
 */
export function setHeightLayer(fn) { layer = fn; }

/** Hauteur du sol praticable en (x, z) pour un appelant situé à la hauteur y. Tous les modules passent par ici (ctx.heightAt). */
export function heightAt(x, z, y) {
  const base = baseHeightAt(x, z);
  if (layer) { const h = layer(x, z, base, y); if (h !== undefined) return h; }
  return base;
}

// Profils par ville du module ville. Le profil est choisi par ctx.city.style (sinon ctx.city.id), défaut Paris.
import paris from './paris.js';
import toulouse from './toulouse.js';

const PROFILES = { paris, toulouse };

/** Profil de la ville courante. Une ville inconnue reçoit une copie du profil de Toulouse (ville générique à grande échelle). */
export function getProfile(ctx) {
  const c = ctx.city || { id: 'paris', style: 'paris' };
  const p = PROFILES[c.style] || PROFILES[c.id];
  if (p) return p;
  return { ...toulouse, id: c.id, roadProfiles: [[/^(Pont|Passerelle|Viaduc) /, { trees: 0 }]], centre: { x: 0, z: 0, r: 900 }, faubourg: { x: 0, z: 0, r: 2400 } };
}

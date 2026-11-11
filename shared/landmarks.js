// Monuments de la VILLE COURANTE (voir shared/cities.js). Les listes par ville sont dans shared/cities/<ville>/landmarks.js.
import { CITY_ID } from './cities.js';
import { LANDMARKS as PARIS } from './cities/paris/landmarks.js';
import { LANDMARKS as TOULOUSE } from './cities/toulouse/landmarks.js';

export const LANDMARKS_BY_CITY = { paris: PARIS, toulouse: TOULOUSE };
export const LANDMARKS = LANDMARKS_BY_CITY[CITY_ID] || PARIS;
export const LANDMARK_BY_ID = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));
/** Monuments visibles par le joueur (carte, découvertes) : sans les entrées `hidden` (simples réserves d'emprise). */
export const SIGHTS = LANDMARKS.filter((l) => !l.hidden);

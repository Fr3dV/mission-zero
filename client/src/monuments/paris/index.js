// Registre des monuments de PARIS : id de shared/cities/paris/landmarks.js -> fonction de construction.
// Les ids absents (chaillot_paris, chaillot_passy, palaisroyal_jardin) sont de simples compléments d'emprise.
import { buildEiffel } from './eiffel.js';
import { buildArc } from './arc.js';
import { buildNotreDame } from './notredame.js';
import { buildLouvre, buildCourCarree, buildCarrousel } from './louvre.js';
import { buildSacreCoeur } from './sacrecoeur.js';
import { buildInvalides, buildHotelInvalides } from './invalides.js';
import { buildConcorde } from './concorde.js';
import { buildPantheon } from './pantheon.js';
import { buildOpera } from './opera.js';
import { buildGrandPalais } from './grandpalais.js';
import { buildMadeleine } from './madeleine.js';
import { buildTrocadero } from './trocadero.js';
import * as civic from './civic.js';
import * as culture from './culture.js';
import * as churches from './churches.js';
import * as city from './city.js';

export const DEFS = {
  eiffel: buildEiffel, arc: buildArc, notredame: buildNotreDame, louvre: buildLouvre, courcarree: buildCourCarree, carrousel: buildCarrousel,
  sacrecoeur: buildSacreCoeur, invalides: buildInvalides, hotelinvalides: buildHotelInvalides, concorde: buildConcorde, pantheon: buildPantheon,
  opera: buildOpera, grandpalais: buildGrandPalais, madeleine: buildMadeleine, trocadero: buildTrocadero,
  ...civic.DEFS, ...culture.DEFS, ...churches.DEFS, ...city.DEFS,
};

// Registre des monuments de TOULOUSE : id de shared/cities/toulouse/landmarks.js -> fonction de construction.
// Les ids absents (entrées `hidden` de simple réserve d'emprise) ne construisent rien.
import * as capitole from './capitole.js';
import * as eglises from './eglises.js';
import * as garonne from './garonne.js';
import * as rail from './rail.js';
import * as aero from './aero.js';
import * as sport from './sport.js';
import * as espace from './espace.js';
import * as centre from './centre.js';
import * as teleo from './teleo.js';

export const DEFS = { ...capitole.DEFS, ...eglises.DEFS, ...garonne.DEFS, ...rail.DEFS, ...aero.DEFS, ...sport.DEFS, ...espace.DEFS, ...centre.DEFS, ...teleo.DEFS };

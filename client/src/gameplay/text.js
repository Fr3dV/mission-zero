// Écritures communes aux textes composés par le gameplay (toasts, bandeaux, invite E) : une seule copie pour le lot.
// Mêmes règles que l'interface (ui/util.js : zc, de) et le serveur, chacun sa copie.

/** Entier à la française : « 1 234 ». */
export const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
/** Somme d'argent : « Ƶ 1 234 » (symbole, espace insécable, montant). */
export const fmtZ = (n) => `Ƶ ${fmtInt(n)}`;
/** Gain : « +Ƶ 1 234 ». */
export const gainZ = (n) => `+${fmtZ(n)}`;
/** Typographie française : espace insécable devant « : ; ! ? % » et à l'intérieur des guillemets (copie de ui/util.js : typo). Idempotente. */
export const typo = (s) => (typeof s !== 'string' || s.length < 3 || s.indexOf(' ') < 0 ? s : s.replace(/ ([:;!?»%])/g, '\u00a0$1').replace(/« /g, '«\u00a0'));
/** « de Tom », « d'Alice », « d'Yves » mais « de Yann » : élision devant une voyelle ou un h. */
export const de = (name) => (/^([aeiouàâäéèêëîïôöùûüh]|y(?![aeiouéè]))/i.test(String(name ?? '').trim()) ? `d'${name}` : `de ${name}`);

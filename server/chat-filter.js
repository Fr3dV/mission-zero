// Filtre d'injures du chat (et des pseudos) — module PUR, sans dépendance, utilisé par server/game.js.
//
// Principe : le message est découpé en mots ; chaque mot est ramené à une forme de comparaison (minuscules, accents
// retirés, « leet » simple : 0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s, €→e, ponctuation interne supprimée :
// « f.u.c.k », « c0nn4rd », « ENCULÉ » tombent tous). Un mot injurieux est remplacé par « *** » ; le reste du
// message est rendu tel quel. Les lettres isolées qui se suivent (« f u c k », « p d ») sont recollées pour la
// comparaison, et retenues seulement si toute la suite forme une injure (« t g v », « p d g » passent).
// Deux gravités : les insultes visées et injures racistes ou homophobes comptent comme écarts (coupure du chat
// après plusieurs) ; les mots seulement crus (MILD) sont masqués sans écart ; les jurons d'exclamation courants
// (« putain », « merde », « con ») ne sont pas filtrés.
//
// Trois listes, pour limiter les faux positifs (« dispute », « salopette », « Scunthorpe », « fagot ») :
//   EXACT  : le mot entier doit correspondre (après normalisation) ;
//   STEMS  : le mot COMMENCE par la racine (« enfoiré », « enfoirés ») ;
//   INSIDE : la racine est n'importe où dans le mot (« motherfucker », « tagueule »), réservé aux racines sans
//            homographe innocent.
// Les lettres étirées (« connnnard », « fuuuuck ») sont essayées réduites à 2 puis à 1 occurrence (à 1 seulement si une
// lettre était répétée au moins 3 fois : « bitte » d'amarrage n'est pas lue « bite »).

const EXACT = new Set([
  // français : insultes visées, injures racistes et homophobes (comptent comme écarts)
  'conne', 'connes', 'pd', 'pds', 'pede', 'pedes', 'tg', 'ntm', 'fdp', 'vtff', 'nique', 'niquer', 'niques', 'niquez',
  'salope', 'salopes', 'salaud', 'salauds', 'salopard', 'salopards', 'pute', 'putes',
  'merdeux', 'batard', 'batards', 'batarde', 'batardes',
  'tafiole', 'tafioles', 'gouine', 'gouines', 'trouduc', 'branleur', 'branleurs', 'branleuse',
  'negre', 'negres', 'bougnoule', 'bougnoules', 'youpin', 'youpins', 'bicot', 'bicots', 'chinetoque', 'chinetoques',
  'tagueule', 'triso', 'trisos', 'enfoire', 'enfoires',
  // anglais (pas « retard » : homographe français courant, « désolé du retard »)
  'ass', 'arse', 'asshole', 'assholes', 'bitch', 'bitches', 'bastard', 'bastards', 'cunt', 'cunts',
  'whore', 'whores', 'slut', 'sluts', 'fag', 'fags', 'faggot', 'faggots',
  'cock', 'cocks', 'pussy', 'pussies', 'wanker', 'wankers', 'twat', 'twats', 'stfu', 'kys', 'nigga', 'niggas',
]);
// jurons non dirigés et mots crus : masqués (« *** ») mais ne comptent PAS comme écarts (pas de coupure du chat).
// « putain », « merde », « con », « cul » ne sont pas filtrés du tout : exclamations courantes (« c'est con ce feu
// rouge », « pros and cons »), le filtre ne doit pas caviarder du français ordinaire.
const MILD = new Set(['bite', 'bites', 'couille', 'couilles', 'tapette', 'tapettes', 'shit', 'shits', 'shitty', 'dick', 'dicks']);
// mots crus acceptés dans un pseudo (prénoms réels : « Dick »)
const NAME_OK = new Set(['dick'])
const STEMS = ['enfoir', 'connar', 'connas', 'pouffias', 'petass', 'branlez', 'bougnoul', 'bullshit', 'dickhead', 'jackass', 'dumbass'];
const INSIDE = ['fuck', 'encul', 'nigger', 'motherf', 'niktamer', 'niquetamer', 'ntamere', 'fils2pute', 'filsdepute', 'tagueul', 'suceuse', 'suceur'];

// pseudos d'un seul tenant : injures cherchées n'importe où dans le nom (en plus de STEMS et INSIDE), choisies sans
// homographe courant (pas « conne » : « connexion » ; pas « pute » : « computer » ; pas « salope » : « salopette »)
// (pas « nique » : Dominique, Monique, Véronique, Unique ; pas « cunt » : Scunthorpe ; pas « merde » : Merdeka)
const NAME_INSIDE = ['putain', 'batard', 'bitch', 'whore', 'faggot', 'asshole', 'pussy', 'salaud', 'bougnoul'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '€': 'e' };

/** Forme de comparaison d'un mot : minuscules sans accents, leet simple, rien d'autre que des lettres a-z (et 2 pour « fils2pute »). */
export function normWord(word) {
  const s = String(word).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/^[^a-z0-9@$€]+|[^a-z0-9@$€]+$/g, ''); // ponctuation en bordure (« con ! », « (merde) »)
  const leet = s.replace(/[013457@$€]/g, (c) => LEET[c]);
  return leet.replace(/[^a-z2]/g, '');
}

const squeeze = (w, n) => w.replace(n === 1 ? /([a-z])\1+/g : /([a-z])\1{2,}/g, n === 1 ? '$1' : '$1$1');

/** Formes de comparaison d'un mot normalisé : tel quel, lettres étirées réduites à 2, et à 1 seulement s'il y avait
 * une lettre étirée (« biiite » → « bite », mais « bitte » d'amarrage reste « bitte »). */
function forms(w) {
  const w2 = squeeze(w, 2);
  if (w2 === w) return [w];
  const w1 = squeeze(w, 1);
  return w1 === w2 ? [w2] : [w2, w1];
}

/** Gravité d'un mot déjà normalisé : 2 = injure (écart), 1 = mot cru masqué sans écart, 0 = rien. */
export function badLevel(w) {
  if (!w) return 0;
  const fs = forms(w);
  for (const c of fs) {
    if (EXACT.has(c)) return 2;
    for (const s of STEMS) if (c.startsWith(s)) return 2;
  }
  // racines internes (aucune n'est un mot court courant : « shit » reste exact, sinon « shiitake » réduit à 1 tomberait)
  const w1 = squeeze(w, 1);
  for (const s of INSIDE) if (w.includes(s) || squeeze(w, 2).includes(s) || w1.includes(s)) return 2;
  for (const c of fs) if (MILD.has(c)) return 1;
  return 0;
}

/** Le mot (déjà normalisé) est-il injurieux (insulte comptée comme écart) ? */
export function isBadWord(w) { return badLevel(w) === 2; }

/**
 * Filtre un message : chaque mot injurieux ou cru devient « *** ».
 * @returns {{ text: string, hits: number, strikes: number }}  hits = mots remplacés ; strikes = parmi eux, les
 *   insultes qui comptent comme écarts (les mots seulement crus sont masqués sans écart)
 */
export function filterText(text) {
  const parts = String(text).split(/(\s+)/); // séparateurs gardés aux indices impairs
  const words = [];
  for (let i = 0; i < parts.length; i += 2) if (parts[i]) words.push({ i, n: normWord(parts[i]) });
  const bad = new Map(); // indice du mot -> gravité
  for (const w of words) { const l = badLevel(w.n); if (l) bad.set(w.i, l); }
  // lettres isolées consécutives (« f u c k », « p . d ») : recollées, et retenues seulement si TOUTE la suite forme
  // une injure (« t g v », « p d g », « c u l t u r e » ne sont pas caviardés)
  for (let a = 0; a < words.length;) {
    if (words[a].n.length !== 1) { a++; continue; }
    let b = a;
    while (b + 1 < words.length && words[b + 1].n.length === 1) b++;
    if (b > a) {
      const l = badLevel(words.slice(a, b + 1).map((w) => w.n).join(''));
      if (l) for (let k = a; k <= b; k++) bad.set(words[k].i, l);
    }
    a = b + 1;
  }
  if (!bad.size) return { text: String(text), hits: 0, strikes: 0 };
  let strikes = 0;
  for (const [i, l] of bad) { parts[i] = '***'; if (l === 2) strikes++; }
  return { text: parts.join(''), hits: bad.size, strikes };
}

/** Le texte (pseudo) contient-il une injure, même collée (« GrosConnard », « xXfuckXx ») ? */
export function hasProfanity(text) {
  const f = filterText(text);
  if (f.strikes) return true;
  // mots crus : refusés dans un pseudo, sauf prénoms réels (« Dick »)
  if (f.hits && String(text).split(/\s+/).some((t) => { const n = normWord(t); return badLevel(n) === 1 && !NAME_OK.has(n); })) return true;
  const w = normWord(String(text).replace(/\s+/g, ''));
  if (isBadWord(w)) return true;
  const w2 = squeeze(w, 2);
  // pseudo d'un seul tenant : racines cherchées partout (INSIDE l'est déjà par isBadWord)
  for (const s of NAME_INSIDE) if (w2.includes(s)) return true;
  for (const s of STEMS) if (w2.includes(s)) return true;
  return false;
}

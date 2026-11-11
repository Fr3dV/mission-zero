// Tirage déterministe de l'apparence d'un personnage (morphologie, tenue cohérente, coiffure, accessoires, démarche).
// Garde-robe plausible pour Paris : palettes sobres, quelques accents.

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const SKINS = ['#f3d3bd', '#eec4a4', '#e6b592', '#d9a47c', '#c68e63', '#a8724a', '#8a5a3a', '#6b4329', '#4f3020', '#f0c8ae'];
const HAIRS = ['#15110f', '#231813', '#2f2018', '#3d2a1c', '#55381f', '#6f4a28', '#8a6238', '#b08a4e', '#c9a868', '#7a2e17', '#0d0d0f'];
const GREYS = ['#8f8f8f', '#b4b2ae', '#d6d4cf', '#6e6e70'];
const SOBER = ['#1b2333', '#14161a', '#2b2d31', '#3a3f47', '#4b5058', '#6d6f72', '#8c8a83', '#b9b3a6', '#d8d2c4', '#ece8df', '#f4f2ec', '#3b4534', '#4a3a2c', '#6b4f36', '#a8875c', '#c2a878', '#5a1f24', '#27364f', '#2f4a63'];
const ACCENT = ['#b3261e', '#c98a1b', '#1f6f6b', '#1f4fa8', '#7a2a50', '#d9643a', '#2e7d4f', '#e3c14a', '#c4576a'];
const DENIM = ['#1e2a40', '#27395a', '#34507a', '#4b6a94', '#6e8bb0', '#16181d', '#2a2c31', '#8fa3bd'];
const CHINO = ['#1c1e22', '#2c2f36', '#3c4048', '#55504a', '#6b5b45', '#8b7a5e', '#b3a283', '#cfc4aa', '#27364f', '#3b4534', '#4d2a26'];
const LEATHER = ['#15120f', '#2a1c12', '#4a2f1a', '#6a4526', '#111114'];
const SNEAK = ['#f1f0ec', '#e6e3da', '#15161a', '#2b2d33', '#8d9096', '#27364f', '#b3261e', '#c9c2ae'];
const INNER = ['#f3f1ea', '#e7ecf2', '#d9e2ee', '#16171b', '#c8cdd2', '#e9dcc8', '#2b3140', '#b8c7d6'];
const COATS = ['#14161a', '#1b2333', '#2b2d31', '#4b5058', '#6b4f36', '#a8875c', '#c2a878', '#3b4534', '#5a1f24', '#8c8a83'];
const TRENCH = ['#c2a878', '#b39a6b', '#a8875c', '#8b7a5e', '#1b2333', '#3c4048'];
const EYES = 3;

function weighted(rnd, table) {
  let tot = 0; for (const k in table) tot += table[k];
  let r = rnd() * tot;
  for (const k in table) { r -= table[k]; if (r <= 0) return k; }
  return Object.keys(table)[0];
}

let anon = 0;
/**
 * @param opts { name, color, skin, gender: 'm'|'f', age, height (m), build (-1..1), outfit: {top, bottom, shoes, hair, ...} }
 */
export function makeLook(opts = {}) {
  const name = String(opts.name ?? 'anonyme#' + (anon++));
  const rnd = mulberry(hashStr(name) || 1);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 1.15; // ≈ N(0, 0.5)
  const o = opts.outfit || {};
  const g = opts.gender ? (opts.gender === 'f' ? 1 : 0) : rnd() < 0.5 ? 1 : 0;
  const teenRoll = rnd();
  const age = opts.age ?? (teenRoll < 0.07 ? Math.round(13 + rnd() * 4) : Math.round(18 + Math.pow(rnd(), 1.25) * 58));
  const kid = age < 18 ? Math.max(0, Math.min(1, (18 - age) / 12)) : 0; // 0 adulte .. 1 enfant de 6 ans
  const rain = opts.weather === 'rain';
  const old = age > 58, young = age < 30;
  const height = opts.height ?? (kid > 0 ? Math.max(1.1, (g ? 1.63 : 1.72) - kid * 0.62 + gauss() * 0.06) : Math.min(1.95, Math.max(1.55, (g ? 1.65 : 1.78) + gauss() * 0.13)));
  const build = Math.max(-1, Math.min(1, opts.build ?? gauss() * 0.9 + (age > 45 ? 0.2 : -0.05)));

  // --- tenue
  let top = o.top || weighted(rnd, g
    ? { tshirt: rain ? 2 : 10, shirt: rain ? 3 : 9, pull: 15, blouson: 10, veste: kid ? 1 : 10, manteau: rain ? 22 : 13, trench: rain ? 20 : 10, doudoune: rain ? 14 : 7, robe: rain || kid ? 4 : 14, hoodie: young ? (rain ? 14 : 6) : 1 }
    : { tshirt: rain ? 3 : 13, shirt: rain ? 4 : 14, pull: 15, hoodie: old ? 1 : rain ? 18 : 10, blouson: 14, veste: kid ? 1 : 12, manteau: rain ? 18 : 10, trench: rain ? 8 : 3, doudoune: rain ? 16 : 9 });
  const casual = top === 'tshirt' || top === 'hoodie' || top === 'shirt';
  let bottom = o.bottom || (top === 'robe' ? 'none' : weighted(rnd, g
    ? { jean: 42, pantalon: 26, jupe: top === 'doudoune' ? 6 : 22, short: casual && !old ? 8 : 0 }
    : { jean: 50, pantalon: 42, short: casual && !old ? 8 : 0 }));
  if (top === 'robe') bottom = 'none';
  const skirt = bottom === 'jupe' || top === 'robe';
  const formal = top === 'veste' || top === 'manteau' || top === 'trench';
  const shoes = o.shoes || weighted(rnd, g
    ? { baskets: skirt ? 30 : 45, bottines: 30, talons: skirt || bottom === 'pantalon' ? 25 : 5 }
    : { baskets: formal ? 30 : 60, bottines: 18, derbies: formal ? 45 : 12 });
  const sleeve = top === 'tshirt' || (top === 'robe' && rnd() < 0.6) ? 'short' : 'long';
  const tights = skirt && rnd() < 0.55;
  const tucked = top === 'shirt' && rnd() < 0.4;

  // --- cheveux
  const skin = opts.skin ?? pick(SKINS);
  const darkSkin = SKINS.indexOf(skin) >= 5 && SKINS.indexOf(skin) <= 8;
  const hair = o.hair || weighted(rnd, g
    ? { long: 34, milong: 26, chignon: 14, queue: 20, court: 6, afro: darkSkin ? 22 : 2 }
    : { court: 52, rase: 14, milong: 8, calvitie: age > 42 ? 22 : 2, chauve: age > 35 ? 6 : 1, afro: darkSkin ? 16 : 1 });
  const beard = o.beard ?? (!g && rnd() < 0.3 ? (rnd() < 0.5 ? 2 : 1) : 0);
  const grey = age > 62 ? rnd() < 0.85 : age > 48 ? rnd() < 0.4 : false;
  const hairColor = grey ? pick(GREYS) : pick(HAIRS);

  // --- accessoires
  const coat = top === 'manteau' || top === 'trench' || top === 'doudoune';
  const hatRoll = rnd();
  const hat = o.hat ?? (hair === 'chignon' || hair === 'queue' || hair === 'afro' ? 'none' : hatRoll < (rain ? 0.3 : coat ? 0.16 : 0.05) ? 'bonnet' : hatRoll > (young && !g ? 0.86 : 0.95) ? 'casquette' : 'none');
  const glasses = o.glasses ?? (rnd() < (old ? 0.5 : 0.2) ? 1 : rnd() < 0.06 ? 2 : 0); // 1 = vue, 2 = soleil
  const scarf = o.scarf ?? (rnd() < (coat ? 0.4 : formal ? 0.2 : 0.05));
  const phones = o.headphones ?? (hat === 'none' && age < 40 && rnd() < 0.09);
  const bag = o.bag ?? weighted(rnd, g ? { none: 38, dos: 14, bandouliere: 22, tote: 26 } : { none: 55, dos: 26, bandouliere: 14, tote: 5 });

  // --- couleurs
  const sober = () => pick(SOBER), acc = () => pick(ACCENT);
  const topColor = opts.color ?? (top === 'trench' ? pick(TRENCH) : coat || top === 'veste' ? pick(COATS) : top === 'blouson' ? (rnd() < 0.5 ? pick(LEATHER) : pick(COATS)) : rnd() < 0.2 ? acc() : sober());
  const bottomColor = bottom === 'jean' || (bottom === 'short' && rnd() < 0.5) ? pick(DENIM) : skirt && rnd() < 0.25 ? acc() : pick(CHINO);
  const ATT = formal ? ['relax', 'relax', 'pockets', 'behind', 'phone', 'crossed'] : ['relax', 'relax', 'pockets', 'pockets', 'phone', 'crossed', 'hip'];
  const look = {
    name, g, age, height, build, kid,
    attitude: opts.attitude || pick(ATT), fringe: !!g && (hair === 'long' || hair === 'milong') && rnd() < 0.4,
    top, bottom, shoes, sleeve, tights, tucked, hair, beard, hat, glasses, scarf, phones, bag,
    turtleneck: top === 'pull' && rnd() < 0.3,
    eye: Math.floor(rnd() * EYES),
    colors: {
      skin, top: topColor, bottom: top === 'robe' ? topColor : bottomColor,
      shoes: shoes === 'baskets' ? pick(SNEAK) : pick(LEATHER),
      hair: hairColor, bag: rnd() < 0.3 ? acc() : rnd() < 0.5 ? pick(LEATHER) : sober(),
      inner: pick(INNER), scarf: rnd() < 0.45 ? acc() : sober(),
      legs: tights ? (rnd() < 0.7 ? '#17171b' : '#3a2a26') : skin,
      hat: rnd() < 0.35 ? acc() : sober(), belt: pick(LEATHER),
      sole: shoes === 'baskets' ? (rnd() < 0.8 ? '#ecebe6' : '#2a2a2c') : '#1a1816',
    },
    // --- démarche et attitude (pour que les piétons ne marchent pas tous pareil)
    gait: {
      phase: rnd() * 6.283, cadence: 0.93 + rnd() * 0.14 - (old ? 0.04 : 0), arm: 0.7 + rnd() * 0.6, sway: 0.7 + rnd() * 0.7 + g * 0.25,
      bounce: 0.8 + rnd() * 0.5, stoop: (old ? 0.06 + rnd() * 0.08 : rnd() * 0.04) + (rnd() < 0.15 ? 0.05 : 0), toeOut: 0.04 + rnd() * 0.1,
      look: 0.6 + rnd() * 0.8, side: rnd() < 0.5 ? -1 : 1, hurry: rnd(),
    },
  };
  // cohérences
  if (look.bottom === 'short' && (coat || top === 'veste')) look.bottom = 'jean';
  if (look.hat !== 'none' && look.phones) look.phones = false;
  return look;
}

/** Clé de cache de la géométrie (tout ce qui influe sur la forme). */
export function shapeKey(l, lod) {
  const q = (v, s) => Math.round(v / s);
  return [l.g, q(l.build, 0.5), l.top, l.bottom, l.shoes, l.sleeve, l.tucked ? 1 : 0, l.hair, l.beard, l.hat, l.glasses, l.scarf ? 1 : 0, l.phones ? 1 : 0, l.bag,
    l.turtleneck ? 1 : 0, l.eye, l.age > 60 ? 1 : 0, l.fringe ? 1 : 0, l.attitude === 'phone' ? 1 : 0, lod ? 1 : 0].join('|');
}

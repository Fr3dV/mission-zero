// Personnage procédural articulé (humanoïde ~1,78 m, pieds à y = 0, face vers −Z).
// Un seul SkinnedMesh (1 draw call) : toutes les pièces sont fusionnées, la couleur passe par les sommets.
// Utilisé pour le joueur local, les joueurs distants (net) et les piétons (traffic).
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Squelette
// ---------------------------------------------------------------------------------------------
const H = 0, SP = 1, CH = 2, NK = 3, HD = 4, AL = 5, FL = 6, AR = 7, FR = 8, TL = 9, SL = 10, FTL = 11, TR = 12, SR = 13, FTR = 14;
const NB = 15;
// [parent, x, y, z] en pose de repos (repère du personnage). Gauche = −X, droite = +X.
const SHX = 0.198, HIPX = 0.088;
const BONES = [
  [-1, 0, 0.94, 0],        // bassin
  [H, 0, 1.06, 0],         // colonne
  [SP, 0, 1.22, 0],        // poitrine
  [CH, 0, 1.47, 0],        // cou
  [NK, 0, 1.55, 0],        // tête
  [CH, -SHX, 1.42, 0],     // bras G
  [AL, -SHX, 1.13, 0],     // avant-bras G
  [CH, SHX, 1.42, 0],      // bras D
  [AR, SHX, 1.13, 0],      // avant-bras D
  [H, -HIPX, 0.9, 0],      // cuisse G
  [TL, -HIPX, 0.49, 0],    // tibia G
  [SL, -HIPX, 0.08, 0],    // pied G
  [H, HIPX, 0.9, 0],       // cuisse D
  [TR, HIPX, 0.49, 0],     // tibia D
  [SR, HIPX, 0.08, 0],     // pied D
];

// Identifiants de « matière » (index dans la palette du personnage).
const P_SKIN = 0, P_TOP = 1, P_PANTS = 2, P_SHOES = 3, P_HAIR = 4, P_ACCENT = 5, P_SHIRT = 6, P_DARK = 7, P_SOLE = 8, P_SKIN2 = 9;

// ---------------------------------------------------------------------------------------------
// Constructeur de géométrie (tubes à anneaux horizontaux, pondérés sur 2 os)
// ---------------------------------------------------------------------------------------------
class Builder {
  constructor() { this.pos = []; this.idx = []; this.si = []; this.sw = []; this.part = []; }
  vert(x, y, z, b0, w0, b1, part) {
    this.pos.push(x, y, z); this.si.push(b0, b1, 0, 0); this.sw.push(w0, 1 - w0, 0, 0); this.part.push(part);
    return this.part.length - 1;
  }
  /**
   * rings : [{x, y, z, rx, rz, b0, w0, b1, part}] triés par y croissant.
   * opts : seg, part (valeur ou fn(angle, ring) -> id), shape(v=[x,y,z], angle, ring), capBottom, capTop
   */
  tube(rings, opts = {}) {
    const seg = opts.seg || 10;
    const base = this.part.length;
    const v = [0, 0, 0];
    for (const r of rings) {
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        v[0] = r.x + Math.cos(a) * r.rx; v[1] = r.y; v[2] = (r.z || 0) + Math.sin(a) * r.rz;
        if (opts.shape) opts.shape(v, a, r);
        let part = r.part ?? opts.part ?? 0;
        if (typeof opts.part === 'function') part = opts.part(a, r) ?? part;
        this.vert(v[0], v[1], v[2], r.b0, r.w0 ?? 1, r.b1 ?? r.b0, part);
      }
    }
    for (let j = 0; j < rings.length - 1; j++) {
      for (let i = 0; i < seg; i++) {
        const i1 = (i + 1) % seg;
        const a = base + j * seg + i, b = base + (j + 1) * seg + i, c = base + j * seg + i1, d = base + (j + 1) * seg + i1;
        this.idx.push(a, b, c, c, b, d);
      }
    }
    const cap = (ring, j, flip) => {
      const c = this.vert(ring.x, ring.y, ring.z || 0, ring.b0, ring.w0 ?? 1, ring.b1 ?? ring.b0, ring.part ?? (typeof opts.part === 'number' ? opts.part : 0));
      for (let i = 0; i < seg; i++) {
        const a = base + j * seg + i, b = base + j * seg + ((i + 1) % seg);
        if (flip) this.idx.push(c, a, b); else this.idx.push(c, b, a);
      }
    };
    if (opts.capBottom) cap(rings[0], 0, true);
    if (opts.capTop) cap(rings[rings.length - 1], rings.length - 1, false);
  }
  /** Ellipsoïde (sphère UV d'axe Y) ; thetaMax(angle) permet un dôme partiel (cheveux, casquette). */
  blob(cx, cy, cz, rx, ry, rz, bone, part, opts = {}) {
    const stacks = opts.stacks || 6;
    const rings = [];
    for (let j = 0; j <= stacks; j++) rings.push({ x: cx, y: cy, z: cz, rx: 1, rz: 1, b0: bone, t: j / stacks });
    const tMax = opts.thetaMax;
    this.tube(rings, {
      seg: opts.seg || 8, part,
      shape: (v, a, r) => {
        // t = 0 : bas, t = 1 : sommet
        let th;
        if (tMax) th = (1 - r.t) * tMax(a); else th = (1 - r.t) * Math.PI;
        const s = Math.sin(th), c = Math.cos(th);
        v[0] = cx + Math.cos(a) * s * rx; v[1] = cy + c * ry; v[2] = cz + Math.sin(a) * s * rz;
        if (opts.shape) opts.shape(v, a, th);
      },
    });
  }
}

// Générateur pseudo-aléatoire déterministe à partir d'un nom.
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const SKINS = ['#f1c9a5', '#e6b48c', '#d49a6a', '#b97a4e', '#8d5a36', '#5e3a22', '#f5d6ba'];
const HAIRS = ['#1b1512', '#2e1f16', '#4a2f1b', '#6b4423', '#a8763e', '#d9b36c', '#8c8c8c', '#b03a1e', '#0e0e10'];
const TOPS = ['#2b3a55', '#7a1f1f', '#2f5d3a', '#c9a227', '#e8e4da', '#1c1c1f', '#3a86ff', '#8e5572', '#d96c2c', '#4f6d7a', '#5a4632', '#b8c4d0'];
const JEANS = ['#27364f', '#34507a', '#1b1d23', '#4b5563', '#6b5b45', '#7b8794', '#22303c', '#3d3a36'];
const SHOES = ['#f2f2f2', '#17171a', '#5a3b22', '#c1121f', '#2b2b30', '#e8e2d4', '#3b4a5c', '#7a6a55', '#111111'];
const SHIRTS = ['#f4f1ea', '#dfe7ef', '#1e1e22', '#c9d6c2', '#e9c9b1'];
const ACCENTS = ['#c1121f', '#1d3557', '#e9c46a', '#2a9d8f', '#111111', '#f2f2f2', '#6d597a', '#e76f51'];

let anonCount = 0;
/** Tire les variations (déterministes) d'un personnage. */
function makeLook(opts) {
  // sans nom (piétons) : chaque création reçoit une graine différente
  const name = String(opts.name ?? 'anonyme#' + (anonCount++));
  const rnd = mulberry(hashStr(name) || 1);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const look = {
    hair: pick(['short', 'short', 'long', 'cap', 'beanie', 'buzz', 'bob']),
    top: pick(['jacket', 'jacket', 'hoodie', 'tshirt', 'tshirt', 'coat']),
    bottom: rnd() < 0.18 ? 'shorts' : 'jeans',
    bag: rnd() < 0.3,
    build: 0.92 + rnd() * 0.2,        // carrure
    height: 0.94 + rnd() * 0.11,      // taille (× 1,78 m)
    skin: opts.skin ?? pick(SKINS),
    hairColor: pick(HAIRS),
    topColor: opts.color ?? pick(TOPS),
    pants: pick(JEANS),
    shoes: pick(SHOES),
    shirt: pick(SHIRTS),
    accent: pick(ACCENTS),
    phase: rnd() * 10,
  };
  if (look.bottom === 'shorts' && (look.top === 'coat' || look.top === 'jacket')) look.top = 'tshirt';
  return look;
}

// ---------------------------------------------------------------------------------------------
// Géométrie (mise en cache par variante de forme ; les couleurs sont propres à chaque personnage)
// ---------------------------------------------------------------------------------------------
const geoCache = new Map();

function buildBase(look, lod) {
  const key = [look.hair, look.top, look.bottom, look.bag ? 1 : 0, Math.round(look.build * 10), lod ? 1 : 0].join('|');
  let base = geoCache.get(key);
  if (base) return base;
  const b = new Builder();
  const seg = lod ? 6 : 12, segS = lod ? 5 : 8, stacks = lod ? 4 : 7;
  const W = Math.round(look.build * 10) / 10; // facteur de largeur
  const jacket = look.top === 'jacket' || look.top === 'coat';
  const hoodie = look.top === 'hoodie';
  const loose = jacket ? 1.1 : hoodie ? 1.08 : 1.02;
  const longSleeve = look.top !== 'tshirt';
  const shorts = look.bottom === 'shorts';

  // --- bassin (pantalon)
  b.tube([
    { x: 0, y: 0.8, z: 0.005, rx: 0.1 * W, rz: 0.085, b0: H },
    { x: 0, y: 0.86, z: 0.005, rx: 0.15 * W, rz: 0.105, b0: H },
    { x: 0, y: 0.94, z: 0.005, rx: 0.152 * W, rz: 0.105, b0: H },
    { x: 0, y: 1.02, z: 0, rx: 0.14 * W, rz: 0.095, b0: H, w0: 0.6, b1: SP },
  ], { seg, part: P_PANTS, capBottom: true });

  // --- torse (haut). L'ouverture de la veste laisse voir la chemise sur le devant.
  const hem = look.top === 'coat' ? 0.74 : jacket ? 0.86 : hoodie ? 0.87 : 0.9;
  const torso = [
    { x: 0, y: hem, z: 0.005, rx: 0.158 * W * loose, rz: 0.11 * loose, b0: H },
    { x: 0, y: 0.98, z: 0.003, rx: 0.152 * W * loose, rz: 0.106 * loose, b0: H, w0: 0.7, b1: SP },
    { x: 0, y: 1.06, z: 0, rx: 0.142 * W * loose, rz: 0.1 * loose, b0: SP, w0: 0.6, b1: H },
    { x: 0, y: 1.14, z: -0.002, rx: 0.146 * W * loose, rz: 0.102 * loose, b0: SP },
    { x: 0, y: 1.22, z: -0.006, rx: 0.158 * W * loose, rz: 0.108 * loose, b0: CH, w0: 0.5, b1: SP },
    { x: 0, y: 1.31, z: -0.01, rx: 0.163 * W * loose, rz: 0.114 * loose, b0: CH },
    { x: 0, y: 1.39, z: -0.006, rx: 0.166 * W * loose, rz: 0.106 * loose, b0: CH },
    { x: 0, y: 1.445, z: 0, rx: 0.14 * W * loose, rz: 0.088 * loose, b0: CH },
    { x: 0, y: 1.475, z: 0.004, rx: 0.075, rz: 0.066, b0: CH, w0: 0.6, b1: NK },
  ];
  if (look.top === 'coat') torso.splice(1, 0, { x: 0, y: 0.86, z: 0.004, rx: 0.16 * W * loose, rz: 0.112 * loose, b0: H });
  b.tube(torso, {
    seg, capTop: true, capBottom: true,
    part: (a, r) => {
      const front = -Math.sin(a); // devant = angle −90° (z négatif)
      if (hoodie && front > 0.9 && r.y > 0.95 && r.y < 1.1) return P_ACCENT; // poche kangourou
      return P_TOP;
    },
  });
  // veste ouverte : plastron de chemise en V, plaqué sur le devant du torse
  if (jacket) {
    const rings = [];
    for (const r of torso) {
      if (r.y < 0.97 || r.y > 1.45) continue;
      const t = (r.y - 0.97) / 0.48;
      rings.push({ x: 0, y: r.y, z: (r.z || 0) - r.rz + 0.004 + 0.012 * t * t, rx: (0.012 + 0.058 * Math.pow(t, 0.8)) * W, rz: 0.012, b0: r.b0, w0: r.w0, b1: r.b1 });
    }
    b.tube(rings, { seg: 6, part: P_SHIRT, capBottom: true, capTop: true });
  }
  // capuche du sweat (bourrelet derrière la nuque)
  if (hoodie && !lod) b.blob(0, 1.46, 0.075, 0.11 * W, 0.07, 0.06, CH, P_TOP, { seg: segS, stacks: 4 });

  // --- cou + tête
  b.tube([
    { x: 0, y: 1.45, z: 0.006, rx: 0.05, rz: 0.052, b0: CH, w0: 0.5, b1: NK },
    { x: 0, y: 1.52, z: 0.004, rx: 0.046, rz: 0.05, b0: NK },
    { x: 0, y: 1.58, z: 0, rx: 0.05, rz: 0.055, b0: HD },
  ], { seg: segS, part: P_SKIN });
  const HY = 1.655, HZ = -0.012;
  b.blob(0, HY, HZ, 0.086, 0.121, 0.102, HD, P_SKIN, {
    seg, stacks: stacks + 1,
    shape: (v, a, th) => {
      const t = (v[1] - HY) / 0.121; // −1 (menton) .. 1 (sommet)
      if (t < 0) { // mâchoire plus étroite, menton en avant
        const k = 1 - 0.3 * t * t;
        v[0] *= k; v[2] = HZ + (v[2] - HZ) * (1 - 0.18 * t * t) - 0.012 * t * t;
      }
    },
  });
  if (!lod) {
    // yeux, sourcils, nez, oreilles
    for (const s of [-1, 1]) {
      b.blob(s * 0.032, 1.67, -0.101, 0.012, 0.009, 0.006, HD, P_DARK, { seg: 6, stacks: 3 });
      b.blob(s * 0.033, 1.692, -0.1, 0.018, 0.004, 0.006, HD, P_HAIR, { seg: 6, stacks: 2 });
      b.blob(s * 0.087, 1.655, -0.005, 0.01, 0.024, 0.016, HD, P_SKIN2, { seg: 6, stacks: 3 });
    }
    b.blob(0, 1.642, -0.112, 0.011, 0.02, 0.014, HD, P_SKIN2, { seg: 6, stacks: 3 });
    b.blob(0, 1.6, -0.102, 0.022, 0.0045, 0.006, HD, P_SKIN2, { seg: 6, stacks: 2 }); // bouche
  }

  // --- cheveux / couvre-chef
  const frontness = (a) => { const f = (1 - Math.sin(a)) / 2; return f * f * (3 - 2 * f); }; // 1 = devant
  const dome = (back, front, scale, part, drop = 0) => b.blob(0, HY + 0.01, HZ + 0.008, 0.086 * scale, 0.121 * scale, 0.102 * scale, HD, part, {
    seg, stacks: stacks, thetaMax: (a) => (back + (front - back) * frontness(a)) * Math.PI / 180,
    shape: drop ? (v, a, th) => { if (th > 1.7) { const k = (th - 1.7); v[1] -= drop * k; v[0] *= 1 + 0.25 * k; } } : null,
  });
  if (look.hair === 'short') dome(118, 58, 1.07, P_HAIR);
  else if (look.hair === 'buzz') dome(108, 62, 1.025, P_HAIR);
  else if (look.hair === 'bob') dome(140, 56, 1.12, P_HAIR, 0.06);
  else if (look.hair === 'long') dome(150, 54, 1.11, P_HAIR, 0.2);
  else if (look.hair === 'beanie') { dome(120, 50, 1.04, P_HAIR); dome(84, 70, 1.11, P_ACCENT); }
  else if (look.hair === 'cap') {
    dome(120, 50, 1.035, P_HAIR); dome(80, 74, 1.09, P_ACCENT);
    b.blob(0, HY + 0.045, HZ - 0.125, 0.07, 0.008, 0.07, HD, P_ACCENT, { seg: segS, stacks: 3 }); // visière
  }

  // --- bras (épaule -> poignet) + mains
  for (const s of [-1, 1]) {
    const up = s < 0 ? AL : AR, fo = s < 0 ? FL : FR;
    const x = s * SHX * (0.94 + 0.06 * W) * (jacket ? 1.03 : 1);
    const sl = longSleeve ? loose : 1, cut = 1.24; // limite de la manche courte
    const sleeve = (y) => (longSleeve || y > cut ? P_TOP : P_SKIN);
    const rr = (y, r) => r * (sleeve(y) === P_TOP ? (longSleeve ? sl : 1.12) : 1);
    const ys = [[0.855, 0.03, fo], [0.9, 0.033, fo], [1.0, 0.04, fo], [1.08, 0.042, fo], [1.13, 0.041, fo, 0.5, up], [1.18, 0.043, up]];
    if (!longSleeve) ys.push([cut - 0.004, 0.047, up], [cut + 0.004, 0.047, up]);
    ys.push([1.33, 0.05, up], [1.4, 0.054, up], [1.44, 0.05, up], [1.467, 0.036, up], [1.48, 0.014, up]);
    b.tube(ys.map(([y, r, b0, w0, b1]) => ({ x, y, z: 0, rx: rr(y, r), rz: rr(y, r * 1.08), b0, w0, b1, part: sleeve(y) })), { seg: segS, capBottom: true, capTop: true });
    b.blob(x, 0.79, -0.008, 0.021, 0.075, 0.04, fo, P_SKIN, { seg: 6, stacks: lod ? 3 : 4 });
  }

  // --- jambes (cheville -> hanche) + chaussures
  for (const s of [-1, 1]) {
    const th = s < 0 ? TL : TR, sh = s < 0 ? SL : SR, ft = s < 0 ? FTL : FTR;
    const x = s * HIPX;
    const cut = 0.47;
    const leg = (y) => (!shorts || y > cut ? P_PANTS : P_SKIN);
    const k = shorts ? 1 : 1.06;
    const ys = [[0.065, 0.043 * k, sh], [0.13, 0.046 * k, sh], [0.3, 0.061, sh, 1, sh, 0.01], [0.42, 0.055, sh]];
    if (shorts) ys.push([cut - 0.004, 0.054, sh], [cut + 0.004, 0.066, sh]);
    ys.push([0.49, shorts ? 0.067 : 0.056, sh, 0.5, th], [0.56, shorts ? 0.07 : 0.061, th], [0.74, 0.078 * (0.8 + 0.2 * W), th], [0.85, 0.086 * (0.8 + 0.2 * W), th], [0.92, 0.078, th, 0.5, H]);
    b.tube(ys.map(([y, r, b0, w0, b1, dz]) => ({ x, y, z: dz || 0, rx: r, rz: r * 1.05, b0, w0, b1, part: leg(y) })), { seg: segS + 1, capBottom: true, capTop: true });
    // chaussure : ellipsoïde allongé vers l'avant, semelle plate, bout abaissé
    const FYc = 0.05;
    b.blob(x, FYc, -0.055, 0.048, 0.055, 0.135, ft, P_SHOES, {
      seg: segS, stacks: lod ? 4 : 6,
      shape: (v) => {
        const tz = (v[2] + 0.055) / 0.135; // −1 = pointe, 1 = talon
        if (v[1] > FYc) v[1] = FYc + (v[1] - FYc) * (tz < 0 ? 1 + 0.75 * tz * (2 + tz) * 0.9 : 1 + 0.25 * tz);
        if (v[1] < 0.012) v[1] = 0.0;
        if (tz < -0.2) v[0] = x + (v[0] - x) * (1 + 0.08 * tz);
      },
    });
    if (!lod) b.blob(x, 0.012, -0.055, 0.05, 0.012, 0.138, ft, P_SOLE, { seg: segS, stacks: 2 });
  }

  // --- sac à dos
  if (look.bag) {
    const bz = 0.105 * loose + 0.07;
    const sq = (v, a, r) => { // section en rectangle arrondi
      const c = Math.cos(a), sn = Math.sin(a);
      v[0] = Math.sign(c) * Math.pow(Math.abs(c), 0.45) * r.rx;
      v[2] = r.z + Math.sign(sn) * Math.pow(Math.abs(sn), 0.45) * r.rz;
    };
    b.tube([
      { x: 0, y: 1.03, z: bz, rx: 0.09, rz: 0.05, b0: SP },
      { x: 0, y: 1.07, z: bz, rx: 0.125, rz: 0.075, b0: SP, w0: 0.5, b1: CH },
      { x: 0, y: 1.2, z: bz, rx: 0.13, rz: 0.08, b0: CH },
      { x: 0, y: 1.35, z: bz, rx: 0.125, rz: 0.072, b0: CH },
      { x: 0, y: 1.42, z: bz - 0.006, rx: 0.1, rz: 0.055, b0: CH },
      { x: 0, y: 1.44, z: bz - 0.012, rx: 0.06, rz: 0.03, b0: CH },
    ], { seg: lod ? 6 : 10, part: P_ACCENT, capBottom: true, capTop: true, shape: sq });
    if (!lod) for (const s of [-1, 1]) {
      b.tube([
        { x: s * 0.105 * W, y: 1.1, z: -0.03, rx: 0.014, rz: 0.118 * loose, b0: CH },
        { x: s * 0.105 * W, y: 1.44, z: -0.005, rx: 0.014, rz: 0.1 * loose, b0: CH },
      ], { seg: 6, part: P_DARK });
    }
  }

  const position = new Float32Array(b.pos);
  const index = new Uint16Array(b.idx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  base = {
    position, index, normal: g.attributes.normal.array,
    skinIndex: new Uint16Array(b.si), skinWeight: new Float32Array(b.sw), part: new Uint8Array(b.part),
  };
  g.dispose();
  geoCache.set(key, base);
  return base;
}

const _c = new THREE.Color();
function makeGeometry(base, look) {
  const pal = [look.skin, look.topColor, look.pants, look.shoes, look.hairColor, look.accent, look.shirt, '#141416', '#e9e6df', look.skin]
    .map((c) => { _c.set(c); return [_c.r, _c.g, _c.b]; });
  pal[P_SKIN2] = pal[P_SKIN].map((v) => v * 0.8);
  if (look.shoes === '#f2f2f2') pal[P_SOLE] = [0.5, 0.5, 0.5];
  const n = base.part.length;
  const color = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const p = pal[base.part[i]]; color[i * 3] = p[0]; color[i * 3 + 1] = p[1]; color[i * 3 + 2] = p[2]; }
  const g = new THREE.BufferGeometry();
  // Les tableaux typés sont partagés (pas de copie mémoire), mais chaque personnage a ses propres tampons GPU.
  g.setAttribute('position', new THREE.BufferAttribute(base.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(base.normal, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(base.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(base.skinWeight, 4));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setIndex(new THREE.BufferAttribute(base.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.35);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.9, -0.2, -0.9), new THREE.Vector3(0.9, 2, 0.9));
  return g;
}

let sharedMaterial = null;
function getMaterial() {
  if (!sharedMaterial) sharedMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0 });
  return sharedMaterial;
}

// ---------------------------------------------------------------------------------------------
// Animations procédurales : chaque pose remplit un tableau [NB × 3 angles d'Euler] + [dy, dz] du bassin.
// Conventions : rotation X > 0 = le membre part vers l'avant (−Z) ; buste X < 0 = penché en avant.
// ---------------------------------------------------------------------------------------------
const PN = NB * 3 + 2, DY = NB * 3, DZ = NB * 3 + 1;
const ANIMS = ['idle', 'walk', 'run', 'sit', 'jump', 'fall'];
const set = (P, bone, x, y = 0, z = 0) => { P[bone * 3] = x; P[bone * 3 + 1] = y; P[bone * 3 + 2] = z; };
const pos = (v) => (v > 0 ? v : 0);

const POSES = {
  idle(P, t, ph) {
    const br = Math.sin(t * 1.7 + ph), sw = Math.sin(t * 0.55 + ph * 2);
    set(P, H, 0, 0, 0.018 * sw);
    set(P, SP, 0.015 * br, 0, -0.012 * sw);
    set(P, CH, -0.03 + 0.025 * br, 0, -0.008 * sw);
    set(P, NK, 0.03, 0, 0);
    set(P, HD, -0.02 - 0.012 * br, 0.16 * Math.sin(t * 0.31 + ph * 3), 0);
    set(P, AL, 0.03 + 0.012 * br, 0, -0.075 - 0.012 * br);
    set(P, AR, 0.03 + 0.012 * br, 0, 0.075 + 0.012 * br);
    set(P, FL, 0.16 + 0.02 * br, 0, 0);
    set(P, FR, 0.16 + 0.02 * br, 0, 0);
    set(P, TL, 0.035, 0.06, -0.035 - 0.018 * sw);
    set(P, TR, 0.035, -0.06, 0.035 - 0.018 * sw);
    set(P, SL, -0.07); set(P, SR, -0.07);
    set(P, FTL, 0.035, 0.1); set(P, FTR, 0.035, -0.1);
    P[DY] = -0.004 + 0.003 * br; P[DZ] = 0;
  },
  walk(P, t, ph, phi) {
    const s = Math.sin(phi), c = Math.cos(phi);
    const tl = 0.44 * s + 0.06, tr = -0.44 * s + 0.06;
    const kl = 0.1 + 0.85 * Math.pow(pos(Math.cos(phi + 0.75)), 1.4), kr = 0.1 + 0.85 * Math.pow(pos(-Math.cos(phi + 0.75)), 1.4);
    set(P, H, -0.02, -0.11 * s, 0.035 * c);
    set(P, SP, -0.02, 0.09 * s, -0.02 * c);
    set(P, CH, -0.02, 0.1 * s, -0.012 * c);
    set(P, NK, 0.02, -0.04 * s, 0);
    set(P, HD, 0.02, -0.04 * s, 0);
    set(P, AL, -0.5 * s + 0.02, 0, -0.07); set(P, AR, 0.5 * s + 0.02, 0, 0.07);
    set(P, FL, 0.22 + 0.28 * pos(-s), 0, 0); set(P, FR, 0.22 + 0.28 * pos(s), 0, 0);
    set(P, TL, tl, 0, -0.02); set(P, TR, tr, 0, 0.02);
    set(P, SL, -kl); set(P, SR, -kr);
    set(P, FTL, -(tl - kl) * 0.55 + 0.25 * pos(s) * pos(c) + 0.02); set(P, FTR, -(tr - kr) * 0.55 + 0.25 * pos(-s) * pos(-c) + 0.02);
    P[DY] = -0.03 + 0.022 * Math.cos(2 * phi); P[DZ] = 0;
  },
  run(P, t, ph, phi) {
    const s = Math.sin(phi), c = Math.cos(phi);
    const tl = 0.82 * s + 0.3, tr = -0.82 * s + 0.3;
    const kl = 0.35 + 1.45 * Math.pow(pos(Math.cos(phi + 0.8)), 1.3), kr = 0.35 + 1.45 * Math.pow(pos(-Math.cos(phi + 0.8)), 1.3);
    set(P, H, -0.2, -0.17 * s, 0.04 * c);
    set(P, SP, -0.08, 0.14 * s, -0.02 * c);
    set(P, CH, -0.06, 0.2 * s, -0.02 * c);
    set(P, NK, 0.12, -0.08 * s, 0);
    set(P, HD, 0.14, -0.08 * s, 0);
    set(P, AL, -0.95 * s + 0.05, 0, -0.14); set(P, AR, 0.95 * s + 0.05, 0, 0.14);
    set(P, FL, 1.45 - 0.35 * s, 0, 0.25); set(P, FR, 1.45 + 0.35 * s, 0, -0.25);
    set(P, TL, tl, 0, -0.02); set(P, TR, tr, 0, 0.02);
    set(P, SL, -kl); set(P, SR, -kr);
    set(P, FTL, -0.25 * pos(-s) - 0.3 * pos(Math.cos(phi + 0.8)) + 0.2 * pos(s)); set(P, FTR, -0.25 * pos(s) - 0.3 * pos(-Math.cos(phi + 0.8)) + 0.2 * pos(-s));
    P[DY] = -0.05 - 0.05 * Math.cos(2 * phi); P[DZ] = 0;
  },
  sit(P, t, ph) {
    const br = Math.sin(t * 1.6 + ph), st = Math.sin(t * 0.9 + ph);
    set(P, H, 0.2, 0, 0);
    set(P, SP, -0.05, 0, 0);
    set(P, CH, -0.04 + 0.015 * br, 0, 0);
    set(P, NK, -0.05, 0, 0);
    set(P, HD, -0.06, 0.05 * Math.sin(t * 0.4 + ph), 0);
    // bras tendus vers le volant
    set(P, AL, 0.82 + 0.02 * st, 0, 0.1); set(P, AR, 0.82 - 0.02 * st, 0, -0.1);
    set(P, FL, 0.6, 0, 0.12); set(P, FR, 0.6, 0, -0.12);
    set(P, TL, 1.22, 0, -0.1); set(P, TR, 1.22, 0, 0.1);
    set(P, SL, -1.0); set(P, SR, -0.9);
    set(P, FTL, 0.15); set(P, FTR, 0.3);
    P[DY] = -0.46; P[DZ] = 0;
  },
  jump(P, t) {
    set(P, H, -0.08, 0, 0); set(P, SP, -0.04, 0, 0); set(P, CH, -0.04, 0, 0); set(P, NK, 0.05, 0, 0); set(P, HD, 0.05, 0, 0);
    set(P, AL, 0.75, 0, -0.3); set(P, AR, -0.35, 0, 0.3);
    set(P, FL, 0.8, 0, 0); set(P, FR, 0.5, 0, 0);
    set(P, TL, 0.95, 0, 0); set(P, TR, -0.1, 0, 0);
    set(P, SL, -1.25); set(P, SR, -0.5);
    set(P, FTL, -0.1); set(P, FTR, -0.5);
    P[DY] = 0; P[DZ] = 0;
  },
  fall(P, t) {
    const w = Math.sin(t * 9) * 0.05;
    set(P, H, 0.02, 0, 0); set(P, SP, 0.02, 0, 0); set(P, CH, 0.03, 0, 0); set(P, NK, 0, 0, 0); set(P, HD, -0.08, 0, 0);
    set(P, AL, 0.15 + w, 0, -0.95); set(P, AR, 0.15 - w, 0, 0.95);
    set(P, FL, 0.35, 0, 0); set(P, FR, 0.35, 0, 0);
    set(P, TL, 0.4, 0, -0.08); set(P, TR, 0.05, 0, 0.08);
    set(P, SL, -0.55); set(P, SR, -0.3);
    set(P, FTL, -0.3); set(P, FTR, -0.3);
    P[DY] = 0; P[DZ] = 0;
  },
};
const _tmp = new Float32Array(PN);

/**
 * Crée un personnage.
 * @param ctx contexte du jeu (non utilisé pour le rendu : le module importe three directement)
 * @param opts { color (haut), skin, name (graine des variations), lod (version simplifiée), shadow }
 */
export function createCharacter(ctx, opts = {}) {
  const lod = !!opts.lod;
  const look = makeLook(opts);
  const base = buildBase(look, lod);
  const geometry = makeGeometry(base, look);

  const group = new THREE.Group();
  group.name = 'personnage:' + (opts.name ?? '');
  const rig = new THREE.Group();
  rig.scale.setScalar(look.height);
  group.add(rig);

  const bones = BONES.map(() => new THREE.Bone());
  const rest = BONES.map(([p, x, y, z]) => (p < 0 ? [x, y, z] : [x - BONES[p][1], y - BONES[p][2], z - BONES[p][3]]));
  BONES.forEach(([p], i) => { bones[i].position.set(rest[i][0], rest[i][1], rest[i][2]); if (p >= 0) bones[p].add(bones[i]); });
  const mesh = new THREE.SkinnedMesh(geometry, getMaterial());
  mesh.castShadow = opts.shadow ?? !lod;
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  rig.add(mesh);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));

  const weights = { idle: 1, walk: 0, run: 0, sit: 0, jump: 0, fall: 0 };
  const P = new Float32Array(PN);
  let anim = 'idle', speed = 0, phi = look.phase, t = look.phase, acc = 0, frame = 0, first = true;

  function apply() {
    P.fill(0);
    let total = 0;
    for (const a of ANIMS) {
      const w = weights[a];
      if (w < 0.004) continue;
      POSES[a](_tmp, t, look.phase, phi);
      for (let i = 0; i < PN; i++) P[i] += _tmp[i] * w;
      total += w;
    }
    const k = total > 0 ? 1 / total : 0;
    for (let i = 0; i < NB; i++) bones[i].rotation.set(P[i * 3] * k, P[i * 3 + 1] * k, P[i * 3 + 2] * k);
    bones[0].position.set(rest[0][0], rest[0][1] + P[DY] * k, rest[0][2] + P[DZ] * k);
  }

  const api = {
    group, mesh, bones, look, lod,
    /** hauteur du sommet de la tête (m) — pratique pour placer une étiquette de nom */
    height: 1.79 * look.height,
    get anim() { return anim; },
    setState(s = {}) {
      if (s.anim && POSES[s.anim]) anim = s.anim;
      if (s.speed != null) speed = Math.abs(s.speed);
      else if (s.anim) speed = s.anim === 'run' ? 5.5 : s.anim === 'walk' ? 1.5 : 0;
    },
    /** Force la pose immédiatement (sans fondu). */
    snap() { for (const a of ANIMS) weights[a] = a === anim ? 1 : 0; apply(); },
    update(dt) {
      if (lod) { // version simplifiée : pose recalculée une frame sur deux
        acc += dt; frame++;
        if (frame & 1 && !first) return;
        dt = acc; acc = 0;
      }
      t += dt;
      // fondu entre animations
      const k = first ? 1 : 1 - Math.exp(-9 * dt);
      first = false;
      for (const a of ANIMS) weights[a] += ((a === anim ? 1 : 0) - weights[a]) * k;
      // cadence du cycle : la foulée s'allonge avec la vitesse
      const stride = (1.15 + 0.42 * Math.min(speed, 8)) * look.height;
      const moving = weights.walk + weights.run;
      if (moving > 0.01) phi += (Math.PI * 2 * Math.max(speed, 0.6) / stride) * dt;
      if (phi > 1e4) phi -= Math.PI * 2 * 1000;
      apply();
    },
    dispose() {
      group.removeFromParent();
      geometry.dispose();
      mesh.skeleton.dispose();
    },
  };
  apply();
  return api;
}

export const CHARACTER_ANIMS = ANIMS;

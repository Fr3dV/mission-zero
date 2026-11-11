// Géométrie procédurale d'un personnage habillé : corps, tête, cheveux, vêtements, chaussures, accessoires.
// Tout est construit en pose de repos (bras le long du corps, face vers −Z, pieds à y = 0, taille de référence 1,78 m)
// puis fusionné en un seul maillage skinné. Résultats mis en cache par « clé de forme ».
import { MeshBuilder, sampleKeys, ringPoint, frontZ, backZ, smooth, lerp } from './mesh.js';
import { shapeKey } from './look.js';

// ------------------------------------------------------------------------------------------------ os
export const BONE = { H: 0, SP: 1, CH: 2, NK: 3, HD: 4, AL: 5, FL: 6, HL: 7, AR: 8, FR: 9, HR: 10, TL: 11, SL: 12, FTL: 13, TR: 14, SR: 15, FTR: 16, LID: 17 };
export const NB = 18;
const { H, SP, CH, NK, HD, AL, FL, HL, AR, FR, HR, TL, SL, FTL, TR, SR, FTR, LID } = BONE;
export const BONE_PARENT = [-1, H, SP, CH, NK, CH, AL, FL, CH, AR, FR, H, TL, SL, H, TR, SR, HD];
export const HIP_Y = 0.9, KNEE_Y = 0.5, ANKLE_Y = 0.08, SHOULDER_Y = 1.425, ELBOW_Y = 1.13, WRIST_Y = 0.865, HIPX = 0.09;
const LID_Y = 1.6782;

// ------------------------------------------------------------------------------------------------ tuiles de l'atlas
export const TILE = {
  SKIN: 0, FACE_M: 1, FACE_F: 2, HAND: 3, EYES: 4, HAIR: 5, COTTON: 6, TSHIRT: 7,
  SHIRT: 8, KNIT: 9, HOODIE: 10, BLOUSON: 11, COAT: 12, PUFFER: 13, DENIM: 14, JEANHIP: 15,
  CHINO: 16, CHINOHIP: 17, KNITS: 18, WOOL: 19, LEATHER: 20, SNEAKER: 21, RUBBER: 22, GLASSES: 23,
  DRESS: 24, BAG: 25, SCARF: 26, PLAIN: 27,
};
// index de couleur (palette du personnage)
export const COL = { SKIN: 0, TOP: 1, BOTTOM: 2, SHOE: 3, HAIR: 4, BAG: 5, INNER: 6, DARK: 7, SOLE: 8, WHITE: 9, SCARF: 10, LEGS: 11, HAT: 12, BELT: 13, SKIN2: 14, METAL: 15 };

// ------------------------------------------------------------------------------------------------ profils du corps
const K = (rows, f) => rows.map((r) => { const o = {}; f.forEach((n, i) => { o[n] = r[i]; }); return o; });
const TF5 = ['y', 'rx', 'rf', 'rb', 'n'];
const TORSO_M = K([[0.8, 0.085, 0.075, 0.085, 2.2], [0.86, 0.17, 0.098, 0.12, 2.4], [0.92, 0.166, 0.102, 0.122, 2.5], [0.98, 0.16, 0.106, 0.11, 2.4], [1.04, 0.15, 0.106, 0.1, 2.3], [1.1, 0.142, 0.105, 0.096, 2.3],
  [1.18, 0.147, 0.11, 0.1, 2.3], [1.26, 0.16, 0.12, 0.11, 2.4], [1.32, 0.17, 0.124, 0.116, 2.5], [1.38, 0.174, 0.116, 0.116, 2.6], [1.43, 0.18, 0.084, 0.094, 2.9], [1.462, 0.128, 0.07, 0.086, 2.5], [1.49, 0.088, 0.062, 0.072, 2.1], [1.515, 0.06, 0.058, 0.062, 2]], TF5);
const TORSO_F = K([[0.8, 0.085, 0.075, 0.085, 2.2], [0.86, 0.174, 0.098, 0.127, 2.4], [0.92, 0.175, 0.1, 0.13, 2.5], [0.98, 0.165, 0.1, 0.114, 2.4], [1.04, 0.145, 0.095, 0.098, 2.3], [1.1, 0.124, 0.09, 0.088, 2.2],
  [1.18, 0.126, 0.098, 0.09, 2.2], [1.26, 0.138, 0.126, 0.098, 2.3], [1.32, 0.148, 0.128, 0.104, 2.4], [1.38, 0.154, 0.108, 0.106, 2.5], [1.43, 0.161, 0.078, 0.088, 2.9], [1.462, 0.114, 0.066, 0.08, 2.5], [1.49, 0.076, 0.056, 0.066, 2.1], [1.515, 0.052, 0.05, 0.055, 2]], TF5);
const LEG = K([[0.06, 0.036, 0.04, 0.04], [0.1, 0.035, 0.036, 0.038], [0.18, 0.04, 0.038, 0.045], [0.28, 0.05, 0.043, 0.061], [0.36, 0.055, 0.046, 0.067], [0.44, 0.05, 0.05, 0.054], [0.5, 0.054, 0.061, 0.052],
  [0.56, 0.06, 0.064, 0.058], [0.66, 0.072, 0.076, 0.074], [0.78, 0.085, 0.088, 0.09], [0.88, 0.089, 0.09, 0.096], [0.95, 0.084, 0.085, 0.09]], ['y', 'rx', 'rf', 'rb']);
const ARM = K([[0.855, 0.026, 0.02], [0.9, 0.03, 0.025], [0.98, 0.038, 0.036], [1.07, 0.043, 0.042], [1.13, 0.04, 0.042], [1.19, 0.042, 0.045], [1.3, 0.047, 0.052], [1.365, 0.05, 0.056], [1.402, 0.047, 0.054], [1.427, 0.035, 0.044], [1.438, 0.013, 0.018]], ['y', 'rx', 'rf']);
const HEAD = K([[1.548, 0.018, 0.016, 0.02, -0.052, 2.2], [1.56, 0.04, 0.05, 0.04, -0.035, 2.3], [1.58, 0.057, 0.072, 0.055, -0.02, 2.3], [1.605, 0.065, 0.086, 0.07, -0.008, 2.25], [1.635, 0.07, 0.094, 0.085, 0, 2.2],
  [1.67, 0.074, 0.094, 0.094, 0.002, 2.15], [1.7, 0.076, 0.096, 0.098, 0.004, 2.1], [1.73, 0.075, 0.09, 0.098, 0.006, 2.1], [1.755, 0.066, 0.074, 0.088, 0.008, 2.05], [1.772, 0.042, 0.045, 0.06, 0.01, 2], [1.78, 0.004, 0.004, 0.004, 0.01, 2]], ['y', 'rx', 'rf', 'rb', 'z', 'n']);
export const HEAD_V0 = 1.535, HEAD_V1 = 1.79;
const bell = (y, c, s) => Math.exp(-((y - c) * (y - c)) / (s * s));

/** Morphologie quantifiée (g : 0 homme / 1 femme, c : corpulence −1..1). */
function morph(look) {
  const g = look.g, c = Math.round(look.build / 0.5) * 0.5;
  const torso = TORSO_M.map((m, i) => {
    const f = TORSO_F[i], k = { y: m.y, rx: lerp(m.rx, f.rx, g), rf: lerp(m.rf, f.rf, g), rb: lerp(m.rb, f.rb, g), n: m.n, z: 0 };
    if (m.y < 1.47) {
      const waist = bell(m.y, 1.08, 0.16);
      k.rx *= 1 + c * (0.08 + 0.14 * waist);
      k.rf += Math.max(c, 0) * 0.075 * bell(m.y, 1.06, 0.15) + c * 0.008;
      k.rb += c * 0.012;
    }
    return k;
  });
  return { g, c, torso, shx: 0.187 - 0.02 * g + 0.008 * c, arm: 1 - 0.14 * g + 0.11 * c, leg: 1 + 0.12 * c, neck: 0.056 - 0.008 * g + 0.004 * c, jaw: 1 - 0.07 * g + 0.03 * Math.max(0, c), age: look.age };
}
export function bonePositions(look) {
  const M = morph(look), s = M.shx;
  return [[0, 0.94, 0], [0, 1.06, 0], [0, 1.22, 0], [0, 1.49, 0.008], [0, 1.565, 0.004],
    [-s, SHOULDER_Y, 0], [-s - 0.008, ELBOW_Y, 0], [-s - 0.015, WRIST_Y, 0], [s, SHOULDER_Y, 0], [s + 0.008, ELBOW_Y, 0], [s + 0.015, WRIST_Y, 0],
    [-HIPX, HIP_Y, 0], [-HIPX, KNEE_Y, 0], [-HIPX, ANKLE_Y, 0.01], [HIPX, HIP_Y, 0], [HIPX, KNEE_Y, 0], [HIPX, ANKLE_Y, 0.01], [0, LID_Y, -0.08]];
}

// ------------------------------------------------------------------------------------------------ pondération
function torsoSkin(M, skirt) {
  return (x, y, z, S) => {
    if (y < 1.0) {
      S.b0 = H; S.b1 = H; S.w0 = 1;
      if (skirt && y < 0.9) { S.b1 = x < 0 ? TL : TR; S.w0 = 1 - Math.min(0.93, (0.9 - y) / 0.16) * Math.min(1, Math.abs(x) / 0.03); }
    } else if (y < 1.12) { S.b0 = SP; S.b1 = H; S.w0 = smooth(1.0, 1.12, y); }
    else if (y < 1.2) { S.b0 = SP; S.b1 = SP; S.w0 = 1; }
    else if (y < 1.3) { S.b0 = CH; S.b1 = SP; S.w0 = smooth(1.2, 1.3, y); }
    else {
      S.b0 = CH; S.b1 = CH; S.w0 = 1;
      const ax = Math.abs(x);
      if (y > 1.47 && ax < 0.1) { S.b1 = NK; S.w0 = 1 - 0.8 * smooth(1.47, 1.54, y); }
      else if (ax > 0.11) { S.b1 = x < 0 ? AL : AR; S.w0 = 1 - 0.5 * smooth(0.11, M.shx + 0.03, ax) * smooth(1.3, 1.41, y); }
    }
  };
}
const legSkin = (s) => { const T = s < 0 ? TL : TR, Sh = s < 0 ? SL : SR, F = s < 0 ? FTL : FTR; return (x, y, z, S) => {
  if (y > 0.83) { S.b0 = T; S.b1 = H; S.w0 = 1 - 0.65 * smooth(0.83, 0.97, y); }
  else if (y > 0.56) { S.b0 = T; S.b1 = T; S.w0 = 1; }
  else if (y > 0.44) { S.b0 = T; S.b1 = Sh; S.w0 = smooth(0.44, 0.56, y); }
  else if (y > 0.115) { S.b0 = Sh; S.b1 = Sh; S.w0 = 1; }
  else { S.b0 = Sh; S.b1 = F; S.w0 = smooth(0.05, 0.115, y); }
}; };
const armSkin = (s) => { const U = s < 0 ? AL : AR, F = s < 0 ? FL : FR, Hd = s < 0 ? HL : HR; return (x, y, z, S) => {
  if (y > 1.37) { S.b0 = U; S.b1 = CH; S.w0 = 1 - 0.45 * smooth(1.37, 1.45, y); }
  else if (y > 1.185) { S.b0 = U; S.b1 = U; S.w0 = 1; }
  else if (y > 1.075) { S.b0 = U; S.b1 = F; S.w0 = smooth(1.075, 1.185, y); }
  else if (y > 0.89) { S.b0 = F; S.b1 = F; S.w0 = 1; }
  else { S.b0 = F; S.b1 = Hd; S.w0 = smooth(0.845, 0.89, y); }
}; };
const headSkin = (x, y, z, S) => { S.b0 = HD; S.b1 = CH; S.w0 = smooth(1.4, 1.54, y); };

const range = (a, b, step) => { const out = [], n = Math.max(1, Math.round((b - a) / step)); for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n); return out; };

// ------------------------------------------------------------------------------------------------ tête
const WARP = 0.5;
const warp = (t) => t + (WARP * Math.sin(2 * Math.PI * t)) / (2 * Math.PI);
/** u (colonne de la tuile visage) correspondant à l'abscisse x (m) sur le devant du visage. */
export function faceU(x, rx = 0.0745) {
  const c = Math.max(-1, Math.min(1, x / rx)), a = -Math.acos(Math.sign(c) * Math.pow(Math.abs(c), 1.08));
  const w = (Math.PI / 2 - a) / (2 * Math.PI);
  let lo = 0.25, hi = 0.75;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (warp(m) < w) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
export const faceV = (y) => (y - HEAD_V0) / (HEAD_V1 - HEAD_V0);

const HR_ = {};
function headRing(M, y) {
  sampleKeys(HEAD, Math.max(1.548, Math.min(1.78, y)), HR_);
  if (y < 1.64) { const k = 1 - (1 - M.jaw) * smooth(1.64, 1.57, y); HR_.rx *= k; }
  HR_.x = 0;
  return HR_;
}
const G2 = (dx, sx, dy, sy) => Math.exp(-(dx * dx) / (sx * sx) - (dy * dy) / (sy * sy));
/** Relief du visage (nez, orbites, arcades, pommettes, lèvres, menton) : déplace p vers l'avant. */
function faceDisp(M, p) {
  if (p[2] > -0.03) return;
  const x = p[0], y = p[1], ax = Math.abs(x);
  const ny = y - 1.636, prof = ny > 0 ? Math.exp(-(ny * ny) / (0.03 * 0.03)) : Math.exp(-(ny * ny) / (0.0085 * 0.0085));
  const wn = 0.0095 + 0.0065 * Math.exp(-(ny * ny) / (0.012 * 0.012));
  let d = (0.022 - 0.003 * M.g) * prof * Math.exp(-(x * x) / (wn * wn));
  d -= 0.0085 * G2(ax - 0.031, 0.017, y - 1.672, 0.012);
  d += (0.0045 - 0.002 * M.g) * G2(ax - 0.03, 0.03, y - 1.694, 0.008);
  d += 0.004 * G2(ax - 0.052, 0.02, y - 1.645, 0.016);
  d += (0.004 + 0.0015 * M.g) * G2(x, 0.021, y - 1.609, 0.0055) + (0.0038 + 0.0015 * M.g) * G2(x, 0.018, y - 1.597, 0.006);
  d -= 0.0022 * G2(x, 0.024, y - 1.603, 0.0022);
  d += 0.005 * G2(x, 0.02, y - 1.562, 0.012);
  p[2] -= d * smooth(0.03, 0.06, -p[2]);
}
const HP = [0, 0, 0];
/** Point de la tête pour la colonne t (0..1, non déformée) et la hauteur y ; off = décalage radial (cheveux). */
function headPoint(M, t, y, off, face, out) {
  const r = headRing(M, y);
  ringPoint(r, warp(t), out);
  if (face) faceDisp(M, out);
  if (off) {
    const dx = out[0], dy = (out[1] - 1.68) * 0.9, dz = out[2] - 0.005, l = Math.hypot(dx, dy, dz) || 1;
    out[0] += (dx / l) * off; out[1] += (dy / l) * off; out[2] += (dz / l) * off;
  }
  return out;
}
/** z de la surface du visage en (x, y). */
function faceZ(M, x, y) {
  const r = headRing(M, y);
  HP[0] = x; HP[1] = y; HP[2] = frontZ(r, x);
  faceDisp(M, HP);
  return HP[2];
}

function buildHead(mb, M, look, q) {
  const tile = M.g ? TILE.FACE_F : TILE.FACE_M;
  const ys = q ? [1.548, 1.556, 1.566, 1.578, 1.588, ...range(1.594, 1.702, 0.0062), 1.714, 1.728, 1.742, 1.756, 1.767, 1.775, 1.78] : [1.548, 1.57, 1.605, 1.65, 1.7, 1.745, 1.772, 1.78];
  const seg = q ? 28 : 8;
  const base = mb.count, cols = seg + 1;
  for (const y of ys) for (let i = 0; i < cols; i++) {
    const t = i / seg;
    headPoint(M, t, y, 0, q, HP);
    mb.vert(HP[0], HP[1], HP[2], tile, t, faceV(y), [HD], COL.SKIN);
  }
  mb.quadGrid(base, cols, ys.length);
  // cou
  const nr = M.neck;
  mb.tube([{ y: 1.455, rx: nr + 0.008, rf: nr + 0.004, rb: nr + 0.01, z: 0.012 }, { y: 1.5, rx: nr, rf: nr, rb: nr + 0.004, z: 0.008 }, { y: 1.55, rx: nr - 0.003, rf: nr - 0.002, rb: nr, z: 0.004 }, { y: 1.6, rx: nr - 0.004, rf: nr - 0.006, rb: nr - 0.002, z: 0.004 }],
    { seg: q ? 12 : 6, tile: TILE.SKIN, col: COL.SKIN, skin: (x, y, z, S) => { if (y < 1.5) { S.b0 = NK; S.b1 = CH; S.w0 = smooth(1.45, 1.5, y); } else { S.b0 = HD; S.b1 = NK; S.w0 = smooth(1.5, 1.58, y); } } });
  if (!q) return;
  const earsHidden = look.hair === 'long' || look.hair === 'milong' || look.hat === 'bonnet';
  for (const s of [-1, 1]) {
    // oreilles
    const ex = s * (headRing(M, 1.66).rx - 0.003);
    if (!earsHidden) mb.tube([{ y: 1.63, rx: 0.002, rf: 0.004 }, { y: 1.64, rx: 0.006, rf: 0.012 }, { y: 1.658, rx: 0.008, rf: 0.016 }, { y: 1.678, rx: 0.008, rf: 0.017 }, { y: 1.69, rx: 0.005, rf: 0.012 }, { y: 1.695, rx: 0.002, rf: 0.004 }].map((r) => ({ ...r, x: ex, z: 0.014 })),
      { seg: 6, tile: TILE.SKIN, col: COL.SKIN2, skin: [HD], disp: (p) => { p[0] += s * Math.max(0, p[2] - 0.008) * 0.32 + s * 0.002; } });
    // yeux (carreau en amande posé dans l'orbite) + paupières (os LID : écrasées au repos, descendues au clignement)
    const eye = (dz, tileE, col, skin, k) => mb.patch((u, v, o) => {
      const a = (u - 0.5) * 2, hx = 0.0145, hy = 0.0061 * Math.sqrt(Math.max(0, 1 - a * a * 0.92));
      o[0] = s * 0.031 + a * hx; o[1] = 1.672 + (v - 0.5) * 2 * hy - a * s * 0.0006; o[2] = faceZ(M, o[0], o[1]) - dz;
    }, { nu: 6, nv: 2, tile: tileE, col, skin, uv: k == null ? null : (u, v, o) => { o[0] = (k + (s < 0 ? u : 1 - u)) / 3; o[1] = v; } });
    eye(0.0016, TILE.EYES, COL.WHITE, [HD], look.eye);
    eye(0.003, TILE.SKIN, COL.SKIN2, [LID], null);
  }
}

// ------------------------------------------------------------------------------------------------ cheveux, barbe, couvre-chefs
const HAIRS = {
  court: { line: [[0, 1.738], [0.22, 1.73], [0.36, 1.676], [0.47, 1.668], [0.5, 1.692], [0.6, 1.66], [0.75, 1.606], [1, 1.6]], th: 0.013, front: 0.011 },
  rase: { line: [[0, 1.74], [0.22, 1.733], [0.36, 1.68], [0.47, 1.672], [0.5, 1.694], [0.6, 1.665], [0.75, 1.612], [1, 1.606]], th: 0.0035, front: 0 },
  milong: { line: [[0, 1.736], [0.16, 1.724], [0.26, 1.63], [0.36, 1.575], [0.5, 1.555], [1, 1.54]], th: 0.02, front: 0.006, hang: 1 },
  long: { line: [[0, 1.736], [0.15, 1.724], [0.24, 1.6], [0.32, 1.5], [0.42, 1.47], [0.55, 1.4], [0.7, 1.35], [1, 1.33]], th: 0.021, front: 0.004, hang: 1 },
  chignon: { line: [[0, 1.74], [0.25, 1.735], [0.38, 1.695], [0.5, 1.68], [0.7, 1.618], [1, 1.602]], th: 0.009, front: 0.002 },
  queue: { line: [[0, 1.74], [0.25, 1.735], [0.38, 1.695], [0.5, 1.68], [0.7, 1.618], [1, 1.602]], th: 0.009, front: 0.002 },
  calvitie: { line: [[0.4, 1.674], [0.5, 1.686], [0.6, 1.66], [0.75, 1.606], [1, 1.6]], th: 0.0045, front: 0, from: 0.58, top: [[0.4, 1.69], [0.55, 1.735], [0.75, 1.748], [1, 1.752]] },
  chauve: null,
};
const pl = (tab, x) => { let i = 0; while (i < tab.length - 2 && tab[i + 1][0] < x) i++; const a = tab[i], b = tab[i + 1]; return lerp(a[1], b[1], Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0])))); };
const YH = 1.635; // sous cette hauteur, les cheveux longs tombent à la verticale

/** Nappe épousant le crâne, de `top` jusqu'à la ligne `line(fa)` ; fa = 0 devant, 1 derrière. */
function skullCap(mb, M, o) {
  const from = o.from || 0, tA = o.from ? 0.5 + from / 2 : 0, span = o.from ? 1 - from : 1;
  mb.patch((u, v, out) => {
    const t = (tA + u * span) % 1, fa = Math.abs(warp(t) - 0.5) * 2;
    const yTop = o.top ? pl(o.top, fa) : 1.7805, yb = pl(o.line, fa);
    const s = o.top ? v : 0.35 * v + 0.65 * (1 - Math.cos(v * Math.PI / 2)), y = lerp(yTop, yb, s); // rangs resserrés près du sommet (épouse la calotte)
    let th = (o.th + (o.front || 0) * smooth(0.45, 0.1, fa) * smooth(0.75, 0.2, s)) * (0.7 + 0.45 * Math.sin(Math.PI * Math.min(1, s * 1.1)));
    if (v > 0.985 && o.lip !== false) th *= 0.25; // bord rentré
    if (o.top && v < 0.02) th *= 0.2;
    if (o.th2) th += o.th2 * smooth(1 - o.band, 1 - o.band + 0.05, s); // revers (bonnet)
    if (o.hang && y < YH) {
      headPoint(M, t, YH, th, false, out);
      const d = YH - y;
      out[1] = y; out[0] *= 1 - 0.25 * Math.min(1, d / 0.3);
      out[2] += smooth(0.45, 0.75, fa) * (d * 0.22 + 0.012 * Math.sin(d * 14)) - smooth(0.45, 0.2, fa) * d * 0.1;
    } else headPoint(M, t, y, th, false, out);
  }, { orient: 'vol', nu: o.nu, nv: o.nv, tile: o.tile ?? TILE.HAIR, col: o.col ?? COL.HAIR, skin: o.hang ? headSkin : [HD], uv: (u, v, uvo) => { uvo[1] = 1 - v; } });
}

function buildHair(mb, M, look, q) {
  const st = HAIRS[look.hair];
  const hat = look.hat;
  if (st) skullCap(mb, M, { ...st, nu: q ? (st.from ? 16 : 24) : 8, nv: q ? (st.hang ? 12 : 8) : 3, th: hat !== 'none' ? Math.min(st.th, 0.009) : st.th, front: hat !== 'none' ? 0 : st.front });
  if (look.hair === 'chignon') {
    const c = [0, 1.752, 0.088];
    mb.tube(range(-1, 1, q ? 0.34 : 0.67).map((k) => ({ x: c[0], z: c[2], y: c[1] + k * 0.036, rx: 0.04 * Math.sqrt(Math.max(0.02, 1 - k * k)), rf: 0.036 * Math.sqrt(Math.max(0.02, 1 - k * k)) })), { seg: q ? 10 : 5, tile: TILE.HAIR, col: COL.HAIR, skin: [HD] });
  } else if (look.hair === 'queue') {
    const path = [];
    for (let i = 0; i <= (q ? 7 : 3); i++) { const k = i / (q ? 7 : 3); path.push({ x: 0, y: 1.735 - k * k * 0.26 + 0.02 * Math.sin(k * 3), z: 0.092 + 0.05 * Math.sin(k * 2.2) + k * 0.02, rx: 0.02 * (0.55 + 1.1 * Math.sin(Math.PI * Math.min(1, k * 0.9 + 0.12))) * (1 - 0.6 * k * k), rz: 0.016 * (1 - 0.5 * k * k), v: 1 - k }); }
    mb.sweep(path, { seg: q ? 8 : 4, tile: TILE.HAIR, col: COL.HAIR, skin: headSkin, caps: true, up: [1, 0, 0] });
  }
  if (look.beard && q) {
    const th = look.beard > 1 ? 0.009 : 0.004;
    mb.patch((u, v, out) => { // collier + menton
      const a = (u - 0.5) * 2, t = 0.5 + a * 0.215, fa = Math.abs(a);
      const y0 = 1.546, y1 = lerp(1.6, 1.668, smooth(0.25, 1, fa));
      const y = lerp(y0, y1, v);
      headPoint(M, t, y, th * Math.sin(Math.PI * Math.min(1, 0.12 + v * 0.95)) * (1 - 0.5 * smooth(0.7, 1, fa)), true, out);
      if (v === 0) out[1] -= 0.004;
    }, { nu: 14, nv: 5, tile: TILE.HAIR, col: COL.HAIR, skin: [HD] });
    mb.patch((u, v, out) => { // moustache
      const x = (u - 0.5) * 0.062, y = 1.6135 + v * 0.013 - Math.abs(x) * 0.12;
      out[0] = x; out[1] = y; out[2] = faceZ(M, x, y) - th * 0.6 * Math.sin(Math.PI * (0.15 + 0.7 * v));
    }, { nu: 6, nv: 2, tile: TILE.HAIR, col: COL.HAIR, skin: [HD] });
  }
  // --- couvre-chefs
  if (hat === 'bonnet') {
    skullCap(mb, M, { line: [[0, 1.712], [0.4, 1.69], [0.5, 1.668], [1, 1.648]], th: 0.017, th2: 0.007, band: 0.3, nu: q ? 20 : 8, nv: q ? 8 : 3, tile: TILE.KNITS, col: COL.HAT, lip: false, pow: 0.9 });
  } else if (hat === 'casquette') {
    skullCap(mb, M, { line: [[0, 1.722], [0.4, 1.712], [0.5, 1.7], [1, 1.69]], th: 0.014, nu: q ? 20 : 8, nv: q ? 7 : 3, tile: TILE.COTTON, col: COL.HAT, lip: false, pow: 0.9 });
    mb.patch((u, v, out) => { // visière
      const a = (u - 0.5) * 2, w = 0.078 * (1 - 0.25 * v * v);
      out[0] = a * w; out[1] = 1.722 - v * 0.012 - a * a * 0.008; out[2] = -0.088 - v * 0.075 * (1 - 0.45 * a * a) + a * a * 0.03;
    }, { nu: q ? 8 : 4, nv: q ? 3 : 1, tile: TILE.COTTON, col: COL.HAT, skin: [HD] });
  }
  if (look.phones && q) { // casque audio : arceau + coques
    const path = [];
    for (let i = 0; i <= 10; i++) { const a = -1.25 + (2.5 * i) / 10; path.push({ x: Math.sin(a) * 0.092, y: 1.695 + Math.cos(a) * 0.1, z: 0.016, rx: 0.011, rz: 0.004 }); }
    mb.sweep(path, { seg: 4, tile: TILE.RUBBER, col: COL.DARK, skin: [HD], up: [0, 0, 1] });
    for (const s of [-1, 1]) mb.sweep([{ x: s * 0.078, y: 1.66, z: 0.016, rx: 0.026, rz: 0.032 }, { x: s * 0.1, y: 1.66, z: 0.016, rx: 0.03, rz: 0.036 }, { x: s * 0.106, y: 1.66, z: 0.016, rx: 0.022, rz: 0.028 }], { seg: 10, tile: TILE.RUBBER, col: COL.DARK, skin: [HD], caps: true, up: [0, 1, 0] });
  }
  if (look.glasses && q) {
    const sun = look.glasses === 2;
    mb.patch((u, v, out) => {
      const x = (u - 0.5) * 0.14;
      out[0] = x; out[1] = 1.656 + v * 0.033; out[2] = -0.106 + 0.085 * (1 - Math.sqrt(1 - Math.min(0.98, (x * x) / (0.088 * 0.088)))) ;
    }, { nu: 8, nv: 1, tile: TILE.GLASSES, col: COL.WHITE, skin: [HD], uv: (u, v, o) => { o[1] = (sun ? 0.5 : 0) + v * 0.5; } });
    for (const s of [-1, 1]) mb.sweep([{ x: s * 0.07, y: 1.678, z: -0.082, rx: 0.0016, rz: 0.003 }, { x: s * 0.081, y: 1.678, z: -0.02, rx: 0.0016, rz: 0.003 }, { x: s * 0.08, y: 1.67, z: 0.03, rx: 0.0016, rz: 0.003 }], { seg: 4, tile: TILE.RUBBER, col: COL.DARK, skin: [HD], up: [0, 1, 0] });
  }
}

// ------------------------------------------------------------------------------------------------ haut du corps
const TOPS = {
  tshirt: { tile: TILE.TSHIRT, sl: TILE.COTTON, ease: 0.008, hem: 0.915, collar: 'crew' },
  shirt: { tile: TILE.SHIRT, sl: TILE.COTTON, ease: 0.012, hem: 0.9, cuff: 0.004, collar: 'shirt' },
  pull: { tile: TILE.KNIT, sl: TILE.KNITS, ease: 0.02, hem: 0.9, cuff: 0.008, collar: 'crew', rib: 1 },
  hoodie: { tile: TILE.HOODIE, sl: TILE.COTTON, ease: 0.03, hem: 0.885, cuff: 0.01, collar: 'hood', rib: 1 },
  blouson: { tile: TILE.BLOUSON, sl: TILE.LEATHER, ease: 0.028, hem: 0.935, cuff: 0.008, collar: 'stand', rib: 1 },
  veste: { tile: TILE.COAT, sl: TILE.WOOL, ease: 0.02, hem: 0.845, collar: 'lapel' },
  manteau: { tile: TILE.COAT, sl: TILE.WOOL, ease: 0.03, hem: 0.56, collar: 'lapel' },
  trench: { tile: TILE.COAT, sl: TILE.WOOL, ease: 0.028, hem: 0.5, collar: 'lapel', belt: 1 },
  doudoune: { tile: TILE.PUFFER, sl: TILE.PUFFER, ease: 0.045, hem: 0.885, cuff: 0.012, collar: 'puff', quilt: 1 },
  robe: { tile: TILE.DRESS, sl: TILE.COTTON, ease: 0.007, hem: 0.56, collar: 'scoop', flare: 1 },
};
const RG = {};
/** Section du vêtement de torse à la hauteur y (corps + aisance, tombé droit sous les hanches). */
function garmentRing(M, G, y, out = {}) {
  const hipY = 0.92;
  const long = G.hem < 0.79;
  sampleKeys(M.torso, Math.min(1.515, Math.max(y, long ? hipY : 0.8)), out);
  let e = G.ease * (y > 1.4 ? lerp(1, 0.55, smooth(1.4, 1.47, y)) : 1);
  if (y > 1.485) e *= 0.3;
  if (G.ease >= 0.018 && y < 1.3 && y > 0.9) { // les vêtements amples ne marquent pas la taille
    const ch = sampleKeys(M.torso, 1.3, RG), fill = bell(y, 1.1, 0.13);
    out.rx = Math.max(out.rx, lerp(out.rx, ch.rx - 0.012, fill)); out.rb = Math.max(out.rb, lerp(out.rb, ch.rb - 0.006, fill));
    if (!M.g) out.rf = Math.max(out.rf, lerp(out.rf, ch.rf - 0.012, fill));
  }
  if (y < hipY && long) { // jupe, manteau : léger évasement
    const d = hipY - y, fl = G.flare ? 0.2 : 0.05;
    out.rx += d * fl; out.rf += d * fl * 0.8 + 0.012 * Math.min(1, d / 0.08); out.rb += d * fl * 0.6; out.n = lerp(out.n, 2.2, Math.min(1, d / 0.2));
  }
  if (G.rib && y < G.hem + 0.045) e -= 0.012 * smooth(G.hem + 0.045, G.hem + 0.01, y);
  if (G.quilt) e += 0.011 * Math.pow(Math.abs(Math.sin((Math.PI * (y - G.hem)) / 0.078)), 0.55) - 0.004;
  out.rx += e; out.rf += e; out.rb += e; out.y = y; out.x = 0; out.z = out.z || 0;
  return out;
}
const hoop = (mb, M, G, y, h, off, o) => mb.tube([-1, -0.55, 0.55, 1].map((k) => { const r = garmentRing(M, G, y + k * h, {}); const e = off * (Math.abs(k) === 1 ? 0.15 : 1); r.rx += e; r.rf += e; r.rb += e; return r; }), o);

function buildTop(mb, M, look, q) {
  const G = { ...TOPS[look.top] };
  if (look.tucked) G.hem = 1.0;
  if (look.top === 'robe' && look.g === 0) G.hem = 0.9;
  const skirt = G.hem < 0.8;
  const skin = torsoSkin(M, skirt);
  const ys = [];
  const step = q ? (G.quilt ? 0.0195 : 0.034) : 0.085;
  for (const y of range(G.hem, 1.4, step)) ys.push(y);
  ys.push(...(q ? [1.425, 1.445, 1.462, 1.478, 1.492] : [1.445, 1.485]));
  const rings = ys.map((y) => garmentRing(M, G, y, {}));
  rings.push({ x: 0, y: 1.503, z: 0.01, rx: M.neck + 0.014, rf: M.neck + 0.011, rb: M.neck + 0.016, n: 2 }); // raccord au cou
  // ourlet : bord légèrement retourné vers l'intérieur
  const hemIn = { ...rings[0], rx: rings[0].rx - 0.014, rf: rings[0].rf - 0.014, rb: rings[0].rb - 0.014, y: G.hem + 0.004, v: 0 };
  const pleat = look.top === 'robe' ? (p, u, r) => { if (r.y < 0.9) { const k = (0.9 - r.y) * 0.05 * Math.sin(u * Math.PI * 2 * 14); p[0] *= 1 + k; p[2] *= 1 + k; } } : null;
  mb.tube([hemIn, ...rings], { seg: q ? 22 : 8, tile: G.tile, col: COL.TOP, skin, v0: G.hem, v1: 1.5, disp: pleat });
    const at = (y) => garmentRing(M, G, y, {});

  // --- encolure
  const collarSkin = (x, y, z, S) => { S.b0 = CH; S.b1 = NK; S.w0 = 1 - 0.5 * smooth(1.48, 1.54, y); };
  const nk = M.neck;
  const neckLoop = (y, r, drop, rr, col, tile) => { const path = []; const n = q ? 14 : 8; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; path.push({ x: Math.sin(a) * (r + 0.004), y: y - drop * (0.5 - 0.5 * Math.cos(a)), z: 0.01 - Math.cos(a) * r - drop * 0.25 * (0.5 - 0.5 * Math.cos(a)), rx: rr, rz: rr * 0.8 }); } mb.sweep(path, { seg: q ? 5 : 3, closed: true, tile, col, skin: collarSkin, up: [0, 1, 0] }); };
  if (G.collar === 'crew' && q) {
    if (look.turtleneck) mb.tube([{ y: 1.475, rx: nk + 0.022, rf: nk + 0.018, rb: nk + 0.02, z: 0.01 }, { y: 1.51, rx: nk + 0.011, rf: nk + 0.01, rb: nk + 0.012, z: 0.008 }, { y: 1.545, rx: nk + 0.009, rf: nk + 0.008, rb: nk + 0.01, z: 0.005 }, { y: 1.552, rx: nk + 0.002, rf: nk + 0.002, rb: nk + 0.004, z: 0.005 }], { seg: 12, tile: TILE.KNITS, col: COL.TOP, skin: collarSkin });
    else neckLoop(1.502, nk + 0.012, 0.03, look.top === 'pull' ? 0.008 : 0.005, COL.TOP, G.sl);
  } else if (G.collar === 'scoop' && q) neckLoop(1.5, nk + 0.02, 0.05, 0.004, COL.TOP, G.sl);
  else if (G.collar === 'shirt' && q) {
    // col de chemise : pied de col + pointes rabattues
    mb.tube([{ y: 1.478, rx: nk + 0.03, rf: nk + 0.034, rb: nk + 0.024, z: 0.008 }, { y: 1.492, rx: nk + 0.024, rf: nk + 0.028, rb: nk + 0.02, z: 0.008 }, { y: 1.522, rx: nk + 0.008, rf: nk + 0.006, rb: nk + 0.01, z: 0.008 }, { y: 1.526, rx: nk + 0.003, rf: nk + 0.002, rb: nk + 0.005, z: 0.008 }],
      { seg: 14, tile: TILE.COTTON, col: COL.TOP, skin: collarSkin, disp: (p, u) => { const f = smooth(0.42, 0.5, u) * smooth(0.58, 0.5, u); if (p[1] < 1.5) { p[1] -= 0.022 * smooth(0.3, 0.46, u) * smooth(0.7, 0.54, u) * (1 - f); } p[1] -= f * 0.012; } });
  } else if (G.collar === 'stand' && q) {
    mb.tube([{ y: 1.47, rx: nk + 0.03, rf: nk + 0.03, rb: nk + 0.03, z: 0.008 }, { y: 1.5, rx: nk + 0.02, rf: nk + 0.022, rb: nk + 0.022, z: 0.008 }, { y: 1.528, rx: nk + 0.017, rf: nk + 0.02, rb: nk + 0.018, z: 0.008 }, { y: 1.53, rx: nk + 0.011, rf: nk + 0.014, rb: nk + 0.012, z: 0.008 }], { seg: 12, tile: G.sl, col: COL.TOP, skin: collarSkin });
  } else if (G.collar === 'puff') {
    neckLoop(1.512, nk + 0.03, 0.02, q ? 0.024 : 0.02, COL.TOP, TILE.PUFFER);
  } else if (G.collar === 'hood') {
    if (q) neckLoop(1.5, nk + 0.02, 0.03, 0.011, COL.TOP, G.sl);
    // capuche retombée dans le dos
    mb.tube(range(-1, 1, q ? 0.4 : 1).map((k) => ({ x: 0, y: 1.445 + k * 0.075, z: 0.075 + 0.03 * (1 - k * k), rx: 0.118 * Math.sqrt(Math.max(0.03, 1 - k * k * 0.85)), rf: 0.045, rb: 0.062 * Math.sqrt(Math.max(0.05, 1 - k * k)) })), { seg: q ? 10 : 6, tile: G.sl, col: COL.TOP, skin: [CH] });
  } else if (G.collar === 'lapel') {
    // revers : plastron (vêtement du dessous) en V + deux revers en relief + col arrière
    const vy0 = look.top === 'veste' ? 1.2 : 1.24, vy1 = 1.492;
    const halfW = (v) => 0.006 + 0.068 * Math.pow(v, 0.85);
    const zAt = (x, y) => frontZ(at(y), x);
    mb.patch((u, v, o) => { const y = lerp(vy0, vy1, v), x = (u - 0.5) * 2 * halfW(v); o[0] = x; o[1] = y; o[2] = zAt(x, y) - 0.0035; }, { nu: q ? 4 : 2, nv: q ? 6 : 3, tile: TILE.SHIRT, col: COL.INNER, skin, uv: (u, v, o) => { o[0] = 0.5 + (u - 0.5) * 0.3; o[1] = 0.55 + v * 0.42; } });
    if (q) {
      for (const s of [-1, 1]) mb.patch((u, v, o) => {
        const y = lerp(vy0 - 0.012, vy1 - 0.02, v), w = halfW(Math.max(0, (y - vy0) / (vy1 - vy0)));
        const lw = 0.012 + 0.05 * Math.sin(Math.PI * Math.min(1, v * 1.08)) * (v > 0.78 ? 0.75 : 1);
        const x = s * (w - 0.004 + u * lw); o[0] = x; o[1] = y + u * 0.012 * v; o[2] = zAt(x, y) - 0.009 + 0.004 * u;
      }, { nu: 2, nv: 7, tile: G.sl, col: COL.TOP, skin });
      mb.tube([{ y: 1.47, rx: nk + 0.04, rf: 0.01, rb: nk + 0.034, z: 0.012 }, { y: 1.5, rx: nk + 0.026, rf: 0.01, rb: nk + 0.026, z: 0.012 }, { y: 1.522, rx: nk + 0.016, rf: 0.01, rb: nk + 0.02, z: 0.012 }, { y: 1.505, rx: nk + 0.034, rf: 0.01, rb: nk + 0.036, z: 0.014 }], { seg: 10, u0: -0.22, u1: 0.22, tile: G.sl, col: COL.TOP, skin: collarSkin });
    }
  }
  // --- ceintures
  if (G.belt) { hoop(mb, M, G, 1.09, 0.02, 0.005, { seg: q ? 22 : 8, tile: G.sl, col: COL.TOP, skin }); if (q) mb.box(0.0, 1.09, frontZ(at(1.09), 0) - 0.008, 0.022, 0.022, 0.004, { tile: TILE.LEATHER, col: COL.BELT, skin, n: 6 }); }
  if (look.tucked) { const Gp = { ease: 0.011, hem: 0.8 }; hoop(mb, M, Gp, 1.0, 0.017, 0.004, { seg: q ? 22 : 8, tile: TILE.LEATHER, col: COL.BELT, skin }); if (q) mb.box(0, 1.0, frontZ(garmentRing(M, Gp, 1.0, {}), 0) - 0.006, 0.02, 0.019, 0.004, { tile: TILE.PLAIN, col: COL.METAL, skin, n: 6 }); }
  // --- écharpe
  if (look.scarf) {
    neckLoop(1.525, nk + 0.034, 0.045, q ? 0.03 : 0.026, COL.SCARF, TILE.SCARF);
    const zf = (y) => frontZ(at(y), -0.045) - 0.012;
    mb.tube(range(1.2, 1.5, q ? 0.06 : 0.15).map((y) => ({ x: -0.045 + (1.5 - y) * 0.03, y, z: zf(Math.min(y, 1.44)), rx: 0.036, rf: 0.009, rb: 0.009, n: 4 })), { seg: q ? 8 : 4, tile: TILE.SCARF, col: COL.SCARF, skin, capBottom: true });
  }
  // --- manches + bras + mains
  const sAS = [-1, 1];
  for (const s of sAS) {
    const sk = armSkin(s);
    const xc = (y) => s * (M.shx + 0.015 * smooth(SHOULDER_Y, WRIST_Y, y));
    const long = look.sleeve === 'long';
    const cutY = long ? 0.875 : 1.262;
    const eS = long ? Math.min(G.ease, 0.03) + 0.004 : 0.012;
    const ring = (y, e, extra = 0) => { const k = sampleKeys(ARM, y, {}); const fold = long && G.ease > 0.015 ? 0.004 * bell(y, 1.115, 0.018) + 0.003 * bell(y, 1.16, 0.014) : 0; const qu = G.quilt && y < 1.4 ? 0.01 * Math.pow(Math.abs(Math.sin((Math.PI * (y - 0.865)) / 0.0774)), 0.55) : 0; const top = smooth(1.438, 1.39, y); return { x: xc(y), y, z: 0, rx: k.rx * M.arm + (e + fold + qu + extra) * top, rf: k.rf * M.arm + (e + fold + qu + extra) * top, rb: (k.rf * M.arm + (e + fold + qu + extra) * top) * (1 + 0.1 * bell(y, 1.12, 0.03)), n: 2 }; };
    const ysA = q ? [...range(cutY, 1.38, G.quilt ? 0.0194 : 0.036), 1.398, 1.416, 1.43, 1.438] : [cutY, lerp(cutY, 1.13, 0.5), 1.13, 1.28, 1.4, 1.437];
    const sl = ysA.map((y) => ring(y, eS));
    if (long && G.cuff) { sl[0] = ring(cutY, G.cuff); if (q) sl[1] = ring(ysA[1], lerp(G.cuff, eS, 0.8)); }
    const cuffIn = { ...sl[0], rx: sl[0].rx - 0.01, rf: sl[0].rf - 0.01, rb: sl[0].rb - 0.01, y: cutY + 0.003, v: sl[0].v };
    mb.tube([cuffIn, ...sl], { seg: q ? 10 : 5, tile: G.sl, col: COL.TOP, skin: sk, v0: 0.865, v1: 1.475, capTop: true, uv: G.quilt ? (u, v, p, o) => { o[0] = 0.04 + u * 0.36; } : null });
    if (!long) mb.tube((q ? range(0.868, 1.29, 0.042) : [0.868, 1.0, 1.13, 1.29]).map((y) => ring(y, 0)), { seg: q ? 10 : 5, tile: TILE.SKIN, col: COL.SKIN, skin: sk });
    buildHand(mb, M, s, xc(WRIST_Y), q);
  }
  return G;
}

function buildHand(mb, M, s, x, q) {
  const Hd = s < 0 ? HL : HR, k = 0.92 * (1 - 0.1 * M.g + 0.04 * M.c);
  // paume + doigts regroupés, légèrement repliés vers la cuisse ; la tuile « main » dessine les sillons entre les doigts
  const keys = [[0.875, 0.021, 0.026, 0, 0], [0.85, 0.017, 0.031, 0, -0.002], [0.825, 0.013, 0.041, -0.001, -0.004], [0.79, 0.012, 0.044, -0.003, -0.005], [0.765, 0.0115, 0.042, -0.006, -0.006],
    [0.74, 0.0105, 0.039, -0.011, -0.008], [0.715, 0.0095, 0.036, -0.018, -0.011], [0.694, 0.008, 0.031, -0.025, -0.013], [0.682, 0.005, 0.022, -0.029, -0.014]];
  const rings = (q ? keys : [keys[0], keys[2], keys[5], keys[8]]).map(([y, rx, rz, dx, dz], i, a) => ({ x: x + s * dx * k, y: WRIST_Y + (y - WRIST_Y) * k, z: dz * k - 0.004, rx: rx * k, rf: rz * k, rb: rz * k * 0.92, n: 2.6, v: 1 - i / (a.length - 1) })).reverse();
  mb.tube(rings, { seg: q ? 10 : 5, tile: TILE.HAND, col: COL.SKIN, capBottom: true, skin: (px, y, z, S) => { S.b0 = Hd; S.b1 = s < 0 ? FL : FR; S.w0 = smooth(0.875, 0.845, y); },
    uv: s < 0 ? (u, v, p, o) => { o[0] = 1 - u; } : null });
  if (!q) return;
  // pouce
  const p0 = [x - s * 0.002, WRIST_Y - 0.035 * k, -0.03 * k];
  mb.sweep([0, 0.33, 0.66, 1].map((t) => ({ x: p0[0] - s * 0.012 * t * t, y: p0[1] - 0.075 * k * t, z: p0[2] - 0.034 * k * Math.sin(t * 1.9), rx: 0.0105 * k * (1 - 0.35 * t), rz: 0.0095 * k * (1 - 0.35 * t), v: 0.45 * (1 - t) })), { seg: 6, tile: TILE.SKIN, col: COL.SKIN, skin: [Hd], caps: true, up: [1, 0, 0] });
}

// ------------------------------------------------------------------------------------------------ bas du corps
const BOTS = {
  jean: { hip: TILE.JEANHIP, leg: TILE.DENIM, e: [0.006, 0.009, 0.014], hem: 0.075 },
  pantalon: { hip: TILE.CHINOHIP, leg: TILE.CHINO, e: [0.014, 0.02, 0.026], hem: 0.085 },
  short: { hip: TILE.CHINOHIP, leg: TILE.CHINO, e: [0.014, 0.02, 0.02], hem: 0.565 },
  jupe: { hem: 0.57 },
};
function legRing(M, s, y, e, shoeTop) {
  const k = sampleKeys(LEG, y, {}), m = y > 0.55 ? M.leg * (1 + 0.03 * M.g) : lerp(1, M.leg, 0.5) * (1 - 0.06 * M.g);
  return { x: s * HIPX * (1 + 0.02 * smooth(0.5, 0.9, y) * M.c), y, z: 0.004, rx: k.rx * m + e, rf: k.rf * m + e, rb: k.rb * m + e, n: 2.1 };
}
function buildBottom(mb, M, look, q) {
  const kind = look.bottom, Bt = BOTS[kind];
  const boots = look.shoes === 'bottines';
  const skirt = kind === 'jupe', bare = kind === 'none' || skirt;
  if (skirt) {
    const G = { ease: 0.012, hem: Bt.hem, flare: 1 }, skin = torsoSkin(M, true);
    const rings = range(G.hem, 1.03, q ? 0.04 : 0.12).map((y) => garmentRing(M, G, y, {}));
    const hemIn = { ...rings[0], rx: rings[0].rx - 0.02, rf: rings[0].rf - 0.02, rb: rings[0].rb - 0.02, y: G.hem + 0.004 };
    mb.tube([hemIn, ...rings], { seg: q ? 22 : 8, tile: TILE.DRESS, col: COL.BOTTOM, skin, v0: G.hem, v1: 1.5, capTop: true,
      disp: (p, u, r) => { const k = (1.0 - r.y) * 0.035 * Math.sin(u * Math.PI * 2 * 14); p[0] *= 1 + k; p[2] *= 1 + k; } });
    hoop(mb, M, G, 1.015, 0.016, 0.003, { seg: q ? 22 : 8, tile: TILE.PLAIN, col: COL.BOTTOM, skin });
  } else if (!bare) {
    // bassin (ceinture, braguette, poches : dessinés dans la tuile)
    const G = { ease: Bt.e[0] + 0.004, hem: 0.8 }, skin = torsoSkin(M, false);
    const rings = range(0.86, 1.03, q ? 0.034 : 0.085).map((y) => garmentRing(M, G, y, {}));
    rings.unshift({ ...rings[0], y: 0.835, rx: rings[0].rx - 0.012, rf: rings[0].rf - 0.012, rb: rings[0].rb - 0.02 });
    mb.tube(rings, { seg: q ? 22 : 8, tile: Bt.hip, col: COL.BOTTOM, skin, capBottom: true, capTop: true, v0: 0.8, v1: 1.03 });
  }
  for (const s of [-1, 1]) {
    const sk = legSkin(s);
    const hem = bare ? 0.95 : Bt.hem;
    if (!bare) {
      const e = (y) => (y > 0.6 ? Bt.e[0] : y > 0.45 ? lerp(Bt.e[1], Bt.e[0], smooth(0.45, 0.6, y)) : lerp(Bt.e[2], Bt.e[1], smooth(0.2, 0.45, y)))
        + (kind !== 'short' ? 0.004 * bell(y, 0.11, 0.022) + 0.003 * bell(y, 0.155, 0.02) + 0.0025 * bell(y, 0.46, 0.02) : 0);
      const ys = q ? [...range(hem, 0.44, 0.03), ...range(0.47, 0.95, 0.04)] : [hem, 0.3, 0.5, 0.7, 0.95];
      const rings = ys.filter((y) => y >= hem).map((y) => legRing(M, s, y, e(y)));
      if (kind !== 'short') { rings[0].rx = Math.max(rings[0].rx, 0.05); rings[0].rf = Math.max(rings[0].rf, 0.056); rings[0].rb = Math.max(rings[0].rb, 0.052); } // bas de jambe sur la chaussure
      const hemIn = { ...rings[0], rx: rings[0].rx - 0.012, rf: rings[0].rf - 0.012, rb: rings[0].rb - 0.012, y: hem + 0.003 };
      mb.tube([hemIn, ...rings], { seg: q ? 12 : 6, tile: Bt.leg, col: COL.BOTTOM, skin: sk, v0: 0.06, v1: 0.95, capTop: true, uv: s < 0 ? (u, v, p, o) => { o[0] = 1 - u; } : null });
    }
    // jambe nue (ou collants) sous le short, la jupe, la robe
    if (bare || kind === 'short') {
      const top = bare ? 0.95 : 0.6;
      mb.tube((q ? range(0.065, top, 0.04) : [0.065, 0.3, 0.5, top]).map((y) => legRing(M, s, y, 0)), { seg: q ? 12 : 6, tile: TILE.SKIN, col: COL.LEGS, skin: sk, capTop: bare });
    }
    buildShoe(mb, look, s, q, boots);
  }
  if (bare && kind === 'none') mb.tube(range(0.8, 0.98, 0.09).map((y) => garmentRing(M, { ease: 0.002, hem: 0.8 }, y, {})), { seg: q ? 14 : 8, tile: TILE.SKIN, col: COL.LEGS, skin: torsoSkin(M, false), capBottom: true });
}

function buildShoe(mb, look, s, q, boots) {
  const F = s < 0 ? FTL : FTR, kind = look.shoes;
  const sole = kind === 'baskets' ? 0.024 : 0.012, heel = kind === 'talons' ? 0.035 : kind === 'baskets' ? 0 : 0.012;
  const slim = kind === 'talons' ? 0.86 : kind === 'derbies' ? 0.94 : 1;
  const len = kind === 'baskets' ? 0.28 : 0.275;
  // sections le long du pied (du talon vers la pointe) : [s, demi-largeur, hauteur]
  const keys = [[0, 0.018, 0.045], [0.02, 0.031, 0.07], [0.07, 0.04, kind === 'talons' ? 0.06 : 0.092], [0.12, 0.044, kind === 'talons' ? 0.04 : 0.084], [0.17, 0.049, kind === 'talons' ? 0.036 : 0.064], [0.215, 0.049, 0.048], [0.25, 0.04, 0.04], [0.272, 0.022, 0.028], [0.28, 0.006, 0.014]];
  const ks = q ? keys : [keys[0], keys[2], keys[4], keys[6], keys[8]];
  const x0 = s * HIPX, zHeel = 0.082;
  const base = (t) => sole + heel * smooth(0.11, 0.05, t);
  const xf = (p) => { const t = p[1], w = p[2]; p[1] = -w; p[2] = zHeel - t; p[0] += s * 0.012 * smooth(0.05, 0.25, t); };
  const tile = kind === 'baskets' ? TILE.SNEAKER : TILE.LEATHER;
  mb.tube(ks.map(([t, w, h]) => { const b = base(t), hh = h * (kind === 'baskets' ? 1.04 : 1); return { x: x0, y: (t * len) / 0.28, z: -(b + hh * 0.45), rx: w * slim, rf: hh * 0.55, rb: hh * 0.45, n: 2.5, v: t / 0.28 }; }),
    { seg: q ? 10 : 6, tile, col: COL.SHOE, skin: [F], xf, capBottom: true, capTop: true });
  // semelle (et talon)
  mb.tube(ks.map(([t, w]) => { const b = base(t); return { x: x0, y: (t * len) / 0.28, z: -b / 2, rx: (w + 0.004) * slim * (kind === 'talons' && t < 0.1 ? 0.7 : 1), rf: b / 2 + 0.002, rb: b / 2, n: 5, v: t / 0.28 }; }),
    { seg: q ? 10 : 6, tile: TILE.RUBBER, col: COL.SOLE, skin: [F], xf, capBottom: true, capTop: true });
  if (boots && q) { // tige de bottine
    mb.tube([0.07, 0.1, 0.14, 0.18, 0.186].map((y, i) => ({ x: x0, y, z: 0.006, rx: i === 4 ? 0.038 : 0.047 - (y - 0.07) * 0.03, rf: i === 4 ? 0.04 : 0.05 - (y - 0.07) * 0.03, rb: i === 4 ? 0.04 : 0.05 - (y - 0.07) * 0.02 })), { seg: 10, tile: TILE.LEATHER, col: COL.SHOE, skin: legSkin(s) });
  } else if (kind === 'talons' && q) { // cou-de-pied nu
    mb.tube([{ x: x0, y: 0.045, z: -0.03, rx: 0.03, rf: 0.05, rb: 0.03 }, { x: x0, y: 0.075, z: -0.012, rx: 0.034, rf: 0.04, rb: 0.035 }], { seg: 8, tile: TILE.SKIN, col: COL.LEGS, skin: [F], capTop: true });
  }
}

// ------------------------------------------------------------------------------------------------ sacs
function buildBag(mb, M, look, q, G) {
  const at = (y) => garmentRing(M, G, y, {});
  const skin = torsoSkin(M, false);
  if (look.bag === 'dos') {
    const bz = backZ(at(1.25), 0) + 0.062;
    mb.tube([[1.02, 0.09, 0.045], [1.05, 0.125, 0.07], [1.2, 0.132, 0.078], [1.34, 0.128, 0.07], [1.42, 0.105, 0.055], [1.445, 0.06, 0.03]].map(([y, rx, rz]) => ({ x: 0, y, z: bz, rx, rf: rz, rb: rz, n: 4.5 })), { seg: q ? 14 : 8, tile: TILE.BAG, col: COL.BAG, skin: (x, y, z, S) => { S.b0 = CH; S.b1 = SP; S.w0 = smooth(1.05, 1.25, y); }, capTop: true, capBottom: true });
    if (q) for (const s of [-1, 1]) {
      const x = s * (M.shx - 0.072), zf = (y) => frontZ(at(y), x) - 0.006;
      const pts = [[x, 1.4, bz - 0.045], [x, 1.47 + G.ease * 0.55, 0.035], [x, 1.468 + G.ease * 0.5, -0.02], [x, 1.42, zf(1.42)], [x, 1.33, zf(1.33)], [x, 1.24, zf(1.24)], [x * 1.08, 1.16, zf(1.16)], [s * (at(1.1).rx + 0.003), 1.09, -0.02], [x * 1.25, 1.06, bz - 0.055]];
      mb.sweep(pts.map(([px, y, z]) => ({ x: px, y, z, rx: 0.004, rz: 0.015 })), { seg: 4, tile: TILE.BAG, col: COL.BAG, skin, up: [s, 0, 0] });
    }
  } else if (look.bag === 'bandouliere') {
    // sangle en travers du buste (épaule droite -> hanche gauche) + sacoche
    const n = q ? 18 : 8, path = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, k = Math.cos(a), sgn = Math.sin(a);
      const y = 1.2 + k * 0.265, x = k * 0.5 * (M.shx - 0.03) + 0.02 - (1 - k) * 0.06, r = at(y);
      const z = sgn < 0 ? frontZ(r, x) - 0.007 : backZ(r, x) + 0.007;
      path.push({ x, y: y + (y > 1.44 ? G.ease * 0.5 : 0), z: lerp(r.z || 0, z, Math.min(1, Math.abs(sgn) * 2.2)), rx: 0.016, rz: 0.004 });
    }
    mb.sweep(path, { seg: 4, closed: true, tile: TILE.BAG, col: COL.DARK, skin, up: [0.5, 0.3, 0] });
    const hx = -(at(0.95).rx + 0.05);
    mb.box(hx, 0.93, 0.01, 0.045, 0.09, 0.125, { tile: TILE.BAG, col: COL.BAG, skin: [H], n: 4, seg: q ? 10 : 6 });
  } else if (look.bag === 'tote') {
    const bx = M.shx + 0.07 + G.ease, bz = 0.075;
    mb.box(bx, 1.02, bz, 0.035, 0.15, 0.13, { tile: TILE.BAG, col: COL.BAG, skin: (x, y, z, S) => { S.b0 = CH; S.b1 = SP; S.w0 = 0.6; }, n: 5, seg: q ? 10 : 6 });
    if (q) for (const d of [-1, 1]) mb.sweep([[bx, 1.16, bz + d * 0.07], [bx - 0.02, 1.32, bz + d * 0.05], [M.shx - 0.03, 1.462 + G.ease * 0.7, bz * 0.3 + d * 0.02], [M.shx - 0.06, 1.44, bz * 0.3 + d * 0.02 + 0.03]].map(([x, y, z]) => ({ x, y, z, rx: 0.004, rz: 0.011 })), { seg: 4, tile: TILE.BAG, col: COL.BAG, skin: [CH], up: [0, 0, 1] });
  }
}

// ------------------------------------------------------------------------------------------------ assemblage
const cache = new Map();
/** Géométrie de base (tableaux typés partagés) pour une apparence ; q = 1 complet, 0 = simplifié. */
export function buildBody(look, lod) {
  const key = shapeKey(look, lod);
  let base = cache.get(key);
  if (base) return base;
  const M = morph(look), q = lod ? 0 : 1;
  const mb = new MeshBuilder();
  buildHead(mb, M, look, q);
  buildHair(mb, M, look, q);
  const G = buildTop(mb, M, look, q);
  buildBottom(mb, M, look, q);
  if (look.bag !== 'none') buildBag(mb, M, look, q, G);
  base = mb.finish();
  base.bonePos = bonePositions(look);
  base.key = key;
  cache.set(key, base);
  return base;
}

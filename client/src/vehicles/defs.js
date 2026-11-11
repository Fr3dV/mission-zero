// Définitions de forme des 11 véhicules (voir body.js pour le générateur).
// t = abscisse normalisée le long de la caisse (0 = début du bouclier avant, 1 = fin de caisse ; les boucliers
// bombés noseBulge / tailBulge s'ajoutent aux extrémités) ; hauteurs en mètres ;
// `plan` = demi-largeur en fraction de la demi-largeur catalogue ; 's' = arête vive.
// Décalcomanies (fonction de P = profil) : p = projection ('front' | 'rear' | 'side' | 'top'), coordonnées dans le
// plan de projection (face avant/arrière : x,y ; côté : z,y ; dessus : x,z) ; m:'light' = optique (ch = canal),
// m:'glass' = glace transparente ; fx : 1 = nid d'abeille, 2 = carbone.
import { CH } from './materials.js';

const bot = (c, nose, tail, f = 0.05, r = 0.05) => [[0, nose], [0.02, c + (nose - c) * 0.4], [f, c + 0.012], [f + 0.07, c], [1 - r - 0.07, c], [1 - r, c + 0.02], [0.98, c + (tail - c) * 0.45], [1, tail]];
const PLAN = [[0, 0.9], [0.04, 0.955], [0.12, 0.99], [0.3, 1], [0.8, 1], [0.92, 0.985], [1, 0.92]];

// couleurs d'optiques
const LENS = 0x050607, LED = 0xe6efff, RED = 0x9a0c10, DRED = 0x4a0508, AMBER = 0xd9730a, WHITE = 0xd8dde2, REFL = 0x8d9299;
const lens = (p, shape, extra = {}) => ({ p, ...shape, c: LENS, r: 0.1, mt: 0, lift: 0.008, ...extra });
const refl = (p, shape, extra = {}) => ({ p, ...shape, c: REFL, r: 0.2, mt: 1, lift: 0.011, ...extra });
const cover = (p, shape, extra = {}) => ({ p, m: 'glass', ...shape, c: 0xa8b8c8, r: 0.1, lift: 0.024, ...extra });
const head = (shape, extra = {}) => ({ p: 'front', m: 'light', ch: CH.HEAD, c: LED, lift: 0.015, ...shape, ...extra });
const drl = (shape, extra = {}) => ({ p: 'front', m: 'light', ch: CH.DRL, c: LED, lift: 0.016, ...shape, ...extra });
const tail = (shape, extra = {}) => ({ p: 'rear', m: 'light', ch: CH.TAIL, c: RED, lift: 0.014, ...shape, ...extra });
const tlens = (shape, extra = {}) => ({ p: 'rear', ...shape, c: DRED, r: 0.12, mt: 0, lift: 0.009, ...extra });
const brake = (shape, extra = {}) => ({ p: 'rear', m: 'light', ch: CH.BRAKE, c: RED, lift: 0.015, ...shape, ...extra });
const rev = (shape, extra = {}) => ({ p: 'rear', m: 'light', ch: CH.REVERSE, c: WHITE, lift: 0.016, ...shape, ...extra });
const blinkF = (shape, extra = {}) => ({ p: 'front', m: 'light', ch: 'blink', c: AMBER, lift: 0.016, ...shape, ...extra });
const blinkR = (shape, extra = {}) => ({ p: 'rear', m: 'light', ch: 'blink', c: AMBER, lift: 0.016, ...shape, ...extra });
// troisième feu stop : fine barrette en haut de la lunette arrière (projetée par le dessus)
const chmsl = (z, w = 0.42) => ({ p: 'top', m: 'light', ch: CH.BRAKE, c: RED, lift: 0.012, rect: [0, z, w, 0.03], center: true, sub: [6, 1] });
const dark = (p, shape, extra = {}) => ({ p, ...shape, c: 0x040404, r: 0.7, ...extra });
const gloss = (p, shape, extra = {}) => ({ p, ...shape, c: 0x050506, r: 0.12, mt: 0.1, lift: 0.005, ...extra });
const chrome = (p, shape, extra = {}) => ({ p, ...shape, c: 0xd0d3d6, r: 0.12, mt: 1, ...extra });
const carbon = (p, shape, extra = {}) => ({ p, ...shape, c: 0x2a2b2e, r: 0.22, mt: 0.2, fx: 2, lift: 0.007, ...extra });
// agrandit une forme autour de son centre
const grow = (s, k) => {
  if (s.ell) return { ...s, ell: [s.ell[0], s.ell[1], s.ell[2] * k, s.ell[3] * k] };
  if (s.rect) return { ...s, rect: [s.rect[0], s.rect[1], s.rect[2] * k, s.rect[3] * k] };
  if (s.quad) { const cx = s.quad.reduce((a, q) => a + q[0], 0) / 4, cy = s.quad.reduce((a, q) => a + q[1], 0) / 4; return { ...s, quad: s.quad.map((q) => [cx + (q[0] - cx) * k, cy + (q[1] - cy) * k]) }; }
  return s;
};
/** Prise d'air : entourage noir brillant + grille en nid d'abeille. */
const intake = (p, shape, extra = {}) => [gloss(p, grow(shape, 1.08), { lift: 0.005, ...extra }), { p, ...grow(shape, 0.9), c: 0x2c2d30, r: 0.45, fx: 1, lift: 0.009, ...extra }];
/** Bloc optique avant : cuvelage noir, réflecteur chromé, glace. */
const lamp = (p, shape, k = 0.8) => [lens(p, shape), refl(p, grow(shape, k)), cover(p, shape)];
/** Feu arrière : boîtier rouge sombre + glace. */
const tlamp = (shape) => [tlens(shape), cover('rear', shape, { c: 0xc06a6a, r: 0.12, lift: 0.022 })];

export const DEFS = {
  // -------------------------------------------------------------------------------------------
  // Citadine générique (gabarit Clio / 208) : capot court plongeant, hayon vertical, feux hauts.
  citadine: {
    axleF: 0.175, axleR: 0.845, wheelR: 0.295, tireW: 0.19, archGap: 0.045,
    noseBulge: 0.2, tailBulge: 0.1, capKy: 0.35,
    top: [[0, 0.7], [0.04, 0.775], [0.12, 0.86], [0.22, 0.95, 's'], [0.36, 1.37], [0.46, 1.485], [0.6, 1.5], [0.78, 1.475], [0.9, 1.4, 's'], [0.985, 1.0, 's'], [1, 0.93]],
    belt: [[0, 0.69], [0.05, 0.775], [0.14, 0.85], [0.22, 0.9], [0.55, 0.94], [0.8, 0.99], [0.93, 1.0], [1, 0.92]],
    bottom: bot(0.17, 0.24, 0.3),
    plan: [[0, 0.9], [0.04, 0.955], [0.12, 0.99], [0.3, 1], [0.84, 1], [0.94, 0.985], [1, 0.93]],
    beltIn: [[0, 0.03], [0.22, 0.05], [0.9, 0.065], [1, 0.03]], tum: 0.34, roofW: 0.62, sideHollow: 0.016,
    cabin: { cowl: 0.22, wsTop: 0.375, rearTop: 0.9, rearBot: 0.985 },
    sideGlass: [0.22, 0.85], pillars: [[0.54, 0.565]],
    cladBase: 2, seams: [0.285, 0.555, 0.8], handles: [0.52, 0.765], handleColor: 0x0c0c0d, archTrim: 0.028,
    hoodSeam: 0.84, hoodFront: 0.03, trunkSeam: null,
    paint: 'solid', interior: { seat: 0x2e3034 },
    wheel: { style: 'cap', rimRatio: 0.66 },
    plates: { front: 0.42, rear: 0.62 }, plateIdx: 1,
    exhausts: [{ x: 0.48, y: 0.26, r: 0.028, center: true }],
    decals: (P) => [
      ...lamp('front', { ell: [0.6, 0.71, 0.2, 0.07], rot: 0.2, n: 2.6 }),
      head({ ell: [0.57, 0.705, 0.05, 0.04] }), drl({ ell: [0.67, 0.73, 0.03, 0.025] }),
      blinkF({ ell: [0.74, 0.745, 0.028, 0.02] }),
      ...intake('front', { ell: [0, 0.6, 0.3, 0.035], n: 3, center: true }),
      ...intake('front', { ell: [0, 0.31, 0.5, 0.075], n: 4, center: true }),
      gloss('front', { ell: [0.68, 0.33, 0.085, 0.065], n: 3 }), drl({ ell: [0.68, 0.33, 0.035, 0.03] }),
      dark('front', { rect: [0, 0.215, 1.3, 0.05], center: true, sub: [10, 1] }),
      ...tlamp({ ell: [0.7, 1.04, 0.1, 0.17], n: 3 }),
      tail({ ell: [0.7, 1.09, 0.06, 0.07], n: 3 }), brake({ ell: [0.7, 1.09, 0.03, 0.04], n: 3, lift: 0.018 }),
      rev({ ell: [0.7, 0.94, 0.045, 0.028], n: 3 }), blinkR({ ell: [0.7, 0.99, 0.045, 0.022], n: 3 }),
      dark('rear', { rect: [0, 0.3, 1.4, 0.14], center: true, sub: [10, 2] }),
      { p: 'rear', ell: [0.62, 0.36, 0.08, 0.018], n: 3, c: 0x7a0a0a, r: 0.3, lift: 0.01 },
      chmsl(P.zOf(0.9) + 0.045, 0.3),
      // découpe du hayon
      dark('rear', { strip: [[0.56, 0.52, 0.57, 0.52], [0.56, 0.92, 0.57, 0.92]], sub: [6, 1], lift: 0.003 }),
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Taxi parisien : grande berline tricorps noire, calandre chromée, lumineux de toit.
  taxi: {
    axleF: 0.185, axleR: 0.8, wheelR: 0.33, tireW: 0.22,
    noseBulge: 0.2, tailBulge: 0.14,
    top: [[0, 0.74], [0.04, 0.8], [0.13, 0.875], [0.24, 0.975, 's'], [0.37, 1.38], [0.46, 1.49], [0.56, 1.5], [0.66, 1.465], [0.85, 1.1, 's'], [0.97, 1.08], [1, 1.02]],
    belt: [[0, 0.73], [0.06, 0.795], [0.15, 0.865], [0.24, 0.93], [0.5, 0.965], [0.75, 1.02], [0.85, 1.055], [0.97, 1.06], [1, 1.0]],
    bottom: bot(0.16, 0.22, 0.3),
    plan: PLAN,
    beltIn: [[0, 0.03], [0.24, 0.05], [0.84, 0.075], [1, 0.04]], tum: 0.4, roofW: 0.58,
    cabin: { cowl: 0.24, wsTop: 0.385, rearTop: 0.665, rearBot: 0.85 },
    sideGlass: [0.24, 0.775], pillars: [[0.495, 0.517]],
    seams: [0.27, 0.505, 0.72], handles: [0.47, 0.685], handleColor: 0xd0d3d6, handleMetal: 1, beltTrim: 'chrome',
    hoodSeam: 0.86, trunkSeam: 0.865, cabEnd: 0.84,
    paint: 'solid', interior: { seat: 0x3a3b3e },
    wheel: { style: 'multi', rimRatio: 0.68 },
    plates: { front: 0.4, rear: 0.8 },
    taxiSign: { t: 0.5 },
    exhausts: [{ x: 0.55, y: 0.27, r: 0.03 }],
    decals: (P) => [
      ...lamp('front', { ell: [0.64, 0.745, 0.21, 0.055], rot: 0.12, n: 3 }),
      head({ ell: [0.58, 0.74, 0.05, 0.03], n: 3 }), head({ ell: [0.7, 0.755, 0.04, 0.026], n: 3 }),
      drl({ strip: [[0.46, 0.705, 0.46, 0.715], [0.82, 0.745, 0.82, 0.757]], sub: [6, 1] }),
      blinkF({ ell: [0.8, 0.78, 0.035, 0.016], n: 3 }),
      chrome('front', { ell: [0, 0.6, 0.4, 0.115], n: 4, center: true, lift: 0.004 }),
      { p: 'front', ell: [0, 0.6, 0.38, 0.1], n: 4, center: true, c: 0x2c2d30, r: 0.45, fx: 1, lift: 0.008 },
      chrome('front', { rect: [0, 0.6, 0.76, 0.012], center: true, lift: 0.012 }),
      ...intake('front', { ell: [0, 0.3, 0.46, 0.055], n: 4, center: true }),
      gloss('front', { ell: [0.72, 0.36, 0.1, 0.055], n: 3 }), drl({ ell: [0.72, 0.36, 0.04, 0.018], n: 3 }),
      ...tlamp({ ell: [0.66, 0.97, 0.23, 0.065], n: 3.5 }),
      tail({ strip: [[0.46, 0.99, 0.46, 1.005], [0.86, 0.99, 0.86, 1.005]], sub: [6, 1] }), tail({ strip: [[0.46, 0.94, 0.46, 0.955], [0.86, 0.94, 0.86, 0.955]], sub: [6, 1] }),
      brake({ ell: [0.74, 0.972, 0.08, 0.014], n: 3 }),
      rev({ ell: [0.52, 0.972, 0.04, 0.014], n: 3 }), blinkR({ ell: [0.84, 0.972, 0.03, 0.014], n: 3 }),
      chrome('rear', { rect: [0, 0.905, 0.72, 0.014], center: true, lift: 0.01 }),
      dark('rear', { rect: [0, 0.3, 1.5, 0.12], center: true, sub: [10, 2] }),
      chmsl(P.zOf(0.665) + 0.05),
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Tesla Model 3 : nez lisse sans calandre, toit vitré, poignées affleurantes, pas d'échappement.
  tesla_model3: {
    axleF: 0.165, axleR: 0.795, wheelR: 0.335, tireW: 0.235,
    noseBulge: 0.22, tailBulge: 0.13, capKy: 0.4,
    top: [[0, 0.67], [0.04, 0.725], [0.13, 0.8], [0.26, 0.93, 's'], [0.39, 1.33], [0.48, 1.435], [0.57, 1.44], [0.67, 1.39], [0.89, 1.1, 's'], [0.97, 1.09], [1, 1.04]],
    belt: [[0, 0.66], [0.05, 0.72], [0.16, 0.8], [0.26, 0.895], [0.5, 0.94], [0.75, 1.0], [0.89, 1.045], [0.97, 1.055], [1, 1.0]],
    bottom: bot(0.15, 0.24, 0.32),
    plan: PLAN,
    beltIn: [[0, 0.03], [0.25, 0.05], [0.6, 0.08], [0.85, 0.09], [1, 0.04]], tum: 0.46, roofW: 0.52,
    cabin: { cowl: 0.26, wsTop: 0.415, rearTop: 0.64, rearBot: 0.89 },
    sideGlass: [0.26, 0.815], pillars: [[0.508, 0.528]], roofGlass: [0.435, 0.625],
    seams: [0.28, 0.518, 0.745], handles: [0.495, 0.715], handleColor: 0xb9bcc0, handleMetal: 1, beltTrim: 'black',
    hoodSeam: 0.84, trunkSeam: 0.9, cabEnd: 0.86,
    paint: 'pearl', interior: { seat: 0x1c1d20, screen: true },
    wheel: { style: 'aero', rimRatio: 0.72 },
    plates: { front: 0.4, rear: 0.7 },
    decals: (P) => [
      ...lamp('front', { ell: [0.68, 0.7, 0.2, 0.06], rot: 0.26, n: 2.3 }),
      head({ ell: [0.66, 0.695, 0.045, 0.032] }), head({ ell: [0.76, 0.722, 0.03, 0.022] }),
      drl({ strip: [[0.5, 0.672, 0.5, 0.66], [0.68, 0.737, 0.69, 0.722], [0.86, 0.775, 0.87, 0.76]], sub: [5, 1], lift: 0.018 }),
      ...intake('front', { ell: [0, 0.3, 0.52, 0.05], n: 4, center: true }),
      gloss('front', { ell: [0.76, 0.4, 0.06, 0.09], n: 3, rot: -0.2 }), drl({ ell: [0.76, 0.42, 0.02, 0.03], n: 3 }),
      ...tlamp({ quad: [[0.4, 0.93], [0.88, 0.96], [0.9, 1.05], [0.4, 1.0]], sub: [8, 2] }),
      tail({ strip: [[0.42, 0.985, 0.42, 0.998], [0.66, 1.0, 0.66, 1.015], [0.88, 1.02, 0.885, 1.04]], sub: [5, 1] }),
      tail({ strip: [[0.86, 0.97, 0.885, 0.97], [0.86, 1.03, 0.885, 1.03]], sub: [2, 1] }),
      brake({ strip: [[0.5, 0.955, 0.5, 0.968], [0.84, 0.975, 0.84, 0.99]], sub: [5, 1] }),
      rev({ ell: [0.5, 0.945, 0.05, 0.01], n: 3 }), blinkR({ ell: [0.74, 0.958, 0.06, 0.01], n: 3 }),
      dark('rear', { ell: [0, 0.33, 0.72, 0.09], n: 5, center: true }),
      { p: 'rear', ell: [0.62, 0.45, 0.1, 0.018], n: 3, c: 0x7a0a0a, r: 0.3, lift: 0.008 },
      chmsl(P.zOf(0.64) + 0.05),
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Tesla Model S Plaid : grande berline fastback basse et large, hayon, bandeau chromé arrière.
  tesla_models: {
    axleF: 0.175, axleR: 0.78, wheelR: 0.355, tireW: 0.265,
    noseBulge: 0.24, tailBulge: 0.14, capKy: 0.4,
    top: [[0, 0.66], [0.04, 0.71], [0.14, 0.79], [0.285, 0.925, 's'], [0.41, 1.32], [0.49, 1.42], [0.56, 1.43], [0.67, 1.375], [0.915, 1.05, 's'], [0.975, 1.03], [1, 0.98]],
    belt: [[0, 0.65], [0.05, 0.71], [0.17, 0.8], [0.285, 0.885], [0.5, 0.925], [0.75, 0.975], [0.915, 1.005], [0.975, 1.005], [1, 0.95]],
    bottom: bot(0.14, 0.22, 0.3),
    plan: [[0, 0.9], [0.04, 0.95], [0.12, 0.985], [0.3, 0.99], [0.6, 0.995], [0.8, 1], [0.92, 0.985], [1, 0.92]],
    beltIn: [[0, 0.03], [0.25, 0.06], [0.6, 0.1], [0.85, 0.13], [1, 0.05]], tum: 0.5, roofW: 0.5,
    cabin: { cowl: 0.285, wsTop: 0.43, rearTop: 0.66, rearBot: 0.915 },
    sideGlass: [0.285, 0.82], pillars: [[0.518, 0.538]], roofGlass: [0.45, 0.645],
    clad: [[0, 0.05, 2]],
    seams: [0.305, 0.528, 0.745], handles: [0.505, 0.72], handleColor: 0xc8ccd0, handleMetal: 1, beltTrim: 'chrome',
    hoodSeam: 0.82, cabEnd: 0.88,
    interior: { seat: 0xd6d3cb, screen: true },
    wheel: { style: 'twin5', rimRatio: 0.76, rimColor: 0x2a2c30, rimRough: 0.35 }, caliper: 0xc1121f,
    plates: { front: 0.38, rear: 0.68 },
    wing: { t: 0.985, h: 0.03, span: 0.62, chord: 0.11, dark: true, carbon: true, posts: 0.3 },
    decals: (P) => [
      ...lamp('front', { ell: [0.7, 0.695, 0.23, 0.045], rot: 0.18, n: 2.6 }),
      head({ ell: [0.64, 0.688, 0.04, 0.022] }), head({ ell: [0.75, 0.708, 0.035, 0.02] }),
      drl({ strip: [[0.48, 0.67, 0.48, 0.658], [0.7, 0.728, 0.71, 0.714], [0.92, 0.752, 0.93, 0.738]], sub: [5, 1], lift: 0.018 }),
      gloss('front', { ell: [0, 0.6, 0.26, 0.016], n: 3, center: true }),
      ...intake('front', { ell: [0, 0.3, 0.6, 0.06], n: 4, center: true }),
      gloss('front', { ell: [0.82, 0.4, 0.055, 0.1], n: 3, rot: -0.2 }),
      carbon('front', { rect: [0, 0.2, 1.5, 0.04], center: true, sub: [10, 1] }),
      ...tlamp({ quad: [[0.36, 0.9], [0.93, 0.925], [0.95, 0.995], [0.36, 0.95]], sub: [8, 2] }),
      tail({ strip: [[0.38, 0.935, 0.38, 0.946], [0.66, 0.95, 0.66, 0.963], [0.93, 0.972, 0.935, 0.988]], sub: [5, 1] }),
      brake({ strip: [[0.5, 0.915, 0.5, 0.926], [0.9, 0.935, 0.9, 0.948]], sub: [5, 1] }),
      chrome('rear', { rect: [0, 0.925, 0.7, 0.02], center: true, lift: 0.01 }),
      rev({ ell: [0.44, 0.918, 0.04, 0.008], n: 3 }), blinkR({ ell: [0.8, 0.93, 0.07, 0.008], n: 3, lift: 0.019 }),
      carbon('rear', { quad: [[-0.78, 0.22], [0.78, 0.22], [0.7, 0.42], [-0.7, 0.42]], sub: [10, 3], center: true }),
      { p: 'rear', ell: [0.74, 0.5, 0.08, 0.016], n: 3, c: 0x7a0a0a, r: 0.3, lift: 0.008 },
      chmsl(P.zOf(0.66) + 0.05),
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Tesla Cybertruck : facettes planes en inox brossé, pavillon triangulaire, barres lumineuses.
  tesla_cybertruck: {
    axleF: 0.165, axleR: 0.8, wheelR: 0.44, tireW: 0.3, archGap: 0.075, archCrest: 0.05,
    noseBulge: 0.05, tailBulge: 0.03, capAngle: 35, capKy: 0.2,
    top: [[0, 1.1, 's'], [0.21, 1.33, 's'], [0.41, 1.79, 's'], [1, 1.29, 's']],
    belt: [[0, 1.085, 's'], [0.21, 1.22, 's'], [1, 1.265, 's']],
    bottom: [[0, 0.5, 's'], [0.03, 0.42, 's'], [0.97, 0.42, 's'], [1, 0.52]],
    plan: [[0, 0.93, 's'], [0.2, 1, 's'], [0.97, 1, 's'], [1, 0.985]],
    beltIn: [[0, 0.05], [0.2, 0.1], [1, 0.1]], tum: 0.5, roofW: 0.5, hoodP: 6, sideMid: 0.5, tuck: 0.03, sideHollow: 0,
    crease: 14, flare: 0.03,
    cabin: { cowl: 0.21, wsTop: 0.41 },
    sideGlass: [0.21, 0.635], pillars: [[0.435, 0.455]], roofGlass: [0.425, 0.6],
    cladBase: 2, archTrim: 0.11, seams: [0.245, 0.445, 0.64], handles: [], beltTrim: 'black',
    hoodSeam: 0.9, hoodFront: 0.02, cabEnd: 0.64,
    paint: 'steel', interior: { seat: 0x2a2b2e, screen: true },
    wheel: { style: 'cyber', rimRatio: 0.6 },
    plates: { rear: 0.86 },
    mirrors: { sx: 0.11, sy: 0.07, dy: 0.04 },
    decals: (P) => [
      lens('front', { rect: [0, 1.055, 1.98, 0.05], center: true, sub: [16, 1] }),
      drl({ rect: [0, 1.055, 1.94, 0.018], center: true, sub: [16, 1] }),
      ...lamp('front', { ell: [0.8, 0.88, 0.14, 0.04], n: 4 }),
      head({ ell: [0.74, 0.88, 0.04, 0.022], n: 4 }), head({ ell: [0.86, 0.88, 0.04, 0.022], n: 4 }),
      dark('front', { ell: [0, 0.66, 0.98, 0.13], n: 6, center: true }),
      { p: 'front', ell: [0, 0.69, 0.6, 0.05], n: 5, center: true, c: 0x2c2d30, r: 0.45, fx: 1, lift: 0.01 },
      lens('rear', { rect: [0, 1.21, 2.08, 0.06], center: true, sub: [16, 1] }),
      tail({ rect: [0, 1.21, 2.04, 0.022], center: true, sub: [16, 1] }),
      brake({ rect: [0.94, 1.14, 0.1, 0.05] }), rev({ rect: [0.8, 1.14, 0.08, 0.03] }),
      dark('rear', { ell: [0, 0.7, 1.0, 0.13], n: 6, center: true }),
      // joint de la ridelle
      dark('rear', { rect: [0, 1.0, 1.9, 0.008], center: true, sub: [12, 1], lift: 0.003 }),
      // couvre-benne à lamelles
      ...[0.7, 0.76, 0.82, 0.88, 0.94].map((t) => dark('top', { rect: [0, P.zOf(t), 1.7, 0.008], center: true, sub: [10, 1], lift: 0.003 })),
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Porsche 911 Turbo S : phares ovales sur des ailes hautes, capot en creux, pavillon fuyant,
  // hanches arrière très larges, bandeau lumineux, aileron, quatre sorties.
  porsche_911: {
    axleF: 0.2, axleR: 0.765, wheelR: 0.35, tireW: 0.29, archGap: 0.04, archCrest: 0.05,
    noseBulge: 0.22, tailBulge: 0.2, capKy: 0.45,
    top: [[0, 0.6], [0.04, 0.655], [0.12, 0.715], [0.21, 0.78], [0.295, 0.86, 's'], [0.42, 1.215], [0.48, 1.29], [0.53, 1.3], [0.61, 1.255], [0.71, 1.13], [0.81, 0.99], [0.9, 0.9], [0.97, 0.85], [1, 0.8]],
    belt: [[0, 0.63], [0.03, 0.69], [0.08, 0.75], [0.15, 0.79], [0.21, 0.805], [0.295, 0.845], [0.5, 0.87], [0.68, 0.9], [0.8, 0.915], [0.9, 0.885], [0.97, 0.845], [1, 0.79]],
    bottom: bot(0.13, 0.2, 0.26, 0.045, 0.04),
    plan: [[0, 0.86], [0.04, 0.91], [0.12, 0.935], [0.3, 0.925], [0.5, 0.93], [0.7, 0.99], [0.8, 1], [0.9, 0.99], [1, 0.9]],
    beltIn: [[0, 0.04], [0.2, 0.06], [0.33, 0.07], [0.5, 0.1], [0.7, 0.22], [0.82, 0.25], [0.93, 0.14], [1, 0.06]], tum: 0.5, roofW: 0.47, hoodP: 2.6, sideHollow: 0.02,
    cabin: { cowl: 0.295, wsTop: 0.435, rearTop: 0.59, rearBot: 0.79 },
    sideGlass: [0.295, 0.69],
    clad: [[0, 0.04, 2]],
    seams: [0.325, 0.555], handles: [0.525], handleColor: 0x0c0c0d, beltTrim: 'black',
    hoodSeam: 0.7, hoodFront: 0.04, cabEnd: 0.69,
    interior: { seat: 0x4a1a16, rearDz: 0.7, recline: 0.38 },
    wheel: { style: 'multi', rimRatio: 0.76, rimColor: 0xb9bcc0, dish: 0.06 }, caliper: 0xf4d000,
    plates: { front: 0.36, rear: 0.5 },
    wing: { t: 0.93, h: 0.07, span: 0.8, chord: 0.2, posts: 0.2, rake: 1, droop: 0.3 },
    exhausts: [{ x: 0.4, y: 0.3, r: 0.045, sx: 1.5 }, { x: 0.54, y: 0.3, r: 0.045, sx: 1.5 }],
    decals: (P) => [
      ...lamp('top', { ell: [0.66, P.zOf(0.07), 0.12, 0.2] }, 0.82),
      head({ p: 'top', ell: [0.66, P.zOf(0.06), 0.06, 0.085] }),
      ...[[0.615, 0.115], [0.705, 0.115], [0.615, 0.02], [0.705, 0.02]].map(([x, t]) => drl({ p: 'top', ell: [x, P.zOf(t), 0.016, 0.024], lift: 0.019 })),
      ...intake('front', { ell: [0, 0.31, 0.26, 0.07], n: 4, center: true }),
      ...intake('front', { ell: [0.6, 0.33, 0.2, 0.085], n: 4 }),
      drl({ rect: [0.6, 0.445, 0.3, 0.012], lift: 0.012 }), blinkF({ rect: [0.6, 0.428, 0.3, 0.008], lift: 0.012 }),
      carbon('front', { rect: [0, 0.2, 1.5, 0.035], center: true, sub: [10, 1] }),
      tlens({ rect: [0, 0.825, 1.62, 0.06], center: true, sub: [18, 1] }),
      tail({ rect: [0, 0.83, 1.58, 0.022], center: true, sub: [18, 1] }),
      brake({ ell: [0.68, 0.83, 0.13, 0.024], n: 3, lift: 0.018 }),
      blinkR({ rect: [0.68, 0.805, 0.24, 0.008], lift: 0.016 }),
      rev({ rect: [0, 0.27, 0.12, 0.03], center: true, lift: 0.02 }),
      ...intake('rear', { ell: [0, 0.33, 0.74, 0.1], n: 5, center: true }),
      gloss('rear', { ell: [0.86, 0.42, 0.04, 0.09], n: 3 }),
      // grille du capot moteur (lamelles) et prises d'air latérales
      ...intake('top', { ell: [0, P.zOf(0.875), 0.3, 0.13], n: 4, center: true, rings: 4 }),
      gloss('side', { ell: [P.zOf(0.675), 0.62, 0.05, 0.14], n: 3, rot: -0.25 }),
      { p: 'top', m: 'light', ch: CH.BRAKE, c: RED, lift: 0.012, rect: [0, P.zOf(0.8), 0.4, 0.02], center: true, sub: [6, 1] },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Porsche Taycan : berline électrique basse, phares à quatre points avec « larmes » verticales, bandeau arrière.
  porsche_taycan: {
    axleF: 0.18, axleR: 0.78, wheelR: 0.36, tireW: 0.27, archGap: 0.04, archCrest: 0.045,
    noseBulge: 0.2, tailBulge: 0.16, capKy: 0.42,
    top: [[0, 0.6], [0.04, 0.65], [0.13, 0.73], [0.28, 0.875, 's'], [0.4, 1.26], [0.48, 1.365], [0.55, 1.38], [0.65, 1.34], [0.885, 1.04, 's'], [0.965, 1.01], [1, 0.95]],
    belt: [[0, 0.625], [0.04, 0.685], [0.13, 0.765], [0.28, 0.86], [0.5, 0.9], [0.75, 0.955], [0.885, 0.995], [0.965, 0.99], [1, 0.94]],
    bottom: bot(0.13, 0.21, 0.28),
    plan: [[0, 0.87], [0.04, 0.925], [0.12, 0.96], [0.3, 0.965], [0.55, 0.97], [0.75, 1], [0.9, 0.99], [1, 0.91]],
    beltIn: [[0, 0.04], [0.25, 0.06], [0.5, 0.1], [0.75, 0.18], [0.9, 0.14], [1, 0.05]], tum: 0.5, roofW: 0.48, hoodP: 2.6, sideHollow: 0.018,
    cabin: { cowl: 0.28, wsTop: 0.42, rearTop: 0.655, rearBot: 0.885 },
    sideGlass: [0.28, 0.8], pillars: [[0.508, 0.528]], roofGlass: [0.44, 0.635],
    clad: [[0, 0.04, 2]],
    seams: [0.3, 0.518, 0.735], handles: [0.495, 0.705], handleColor: 0x0c0c0d, beltTrim: 'black',
    hoodSeam: 0.74, trunkSeam: 0.9, cabEnd: 0.86,
    interior: { seat: 0x1d1e21, screen: true },
    wheel: { style: 'five', rimRatio: 0.76, rimColor: 0xa9adb2, dish: 0.05 }, caliper: 0xdfe3e6,
    plates: { front: 0.34, rear: 0.52 },
    decals: (P) => [
      ...lamp('top', { ell: [0.72, P.zOf(0.055), 0.13, 0.14], n: 3.5 }, 0.86),
      ...[[0.665, 0.07], [0.775, 0.07], [0.665, 0.035], [0.775, 0.035]].map(([x, t], i) => (i < 2 ? head : drl)({ p: 'top', ell: [x, P.zOf(t), 0.036, 0.032], n: 4, lift: 0.018 })),
      // « larmes » : prises d'air verticales sous les phares
      gloss('front', { strip: [[0.72, 0.6, 0.83, 0.61], [0.77, 0.36, 0.84, 0.38]], sub: [6, 2] }),
      ...intake('front', { ell: [0, 0.3, 0.5, 0.06], n: 4, center: true }),
      carbon('front', { rect: [0, 0.2, 1.5, 0.035], center: true, sub: [10, 1] }),
      tlens({ rect: [0, 0.94, 1.76, 0.055], center: true, sub: [18, 1] }),
      tail({ rect: [0, 0.943, 1.72, 0.02], center: true, sub: [18, 1] }),
      brake({ ell: [0.72, 0.943, 0.13, 0.022], n: 3, lift: 0.018 }),
      blinkR({ rect: [0.72, 0.922, 0.22, 0.007], lift: 0.016 }),
      rev({ rect: [0, 0.3, 0.12, 0.03], center: true, lift: 0.02 }),
      carbon('rear', { quad: [[-0.76, 0.22], [0.76, 0.22], [0.66, 0.44], [-0.66, 0.44]], sub: [10, 3], center: true }),
      { p: 'rear', ell: [0.8, 0.5, 0.07, 0.014], n: 3, c: 0x7a0a0a, r: 0.3, lift: 0.008 },
      chmsl(P.zOf(0.655) + 0.05),
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Porsche Cayenne : grand SUV, capot haut, phares à quatre points, bandeau arrière, becquet de toit.
  porsche_cayenne: {
    axleF: 0.18, axleR: 0.785, wheelR: 0.39, tireW: 0.285, archGap: 0.055,
    noseBulge: 0.2, tailBulge: 0.12, capKy: 0.35,
    top: [[0, 0.95], [0.04, 0.98], [0.13, 1.02], [0.26, 1.1, 's'], [0.39, 1.56], [0.47, 1.685], [0.57, 1.7], [0.76, 1.66], [0.875, 1.58, 's'], [0.98, 1.16, 's'], [1, 1.1]],
    belt: [[0, 0.94], [0.05, 0.97], [0.13, 1.005], [0.26, 1.06], [0.5, 1.09], [0.8, 1.14], [0.93, 1.15], [1, 1.09]],
    bottom: bot(0.21, 0.3, 0.36),
    plan: [[0, 0.9], [0.04, 0.95], [0.12, 0.98], [0.3, 0.985], [0.6, 0.99], [0.78, 1], [0.93, 0.99], [1, 0.93]],
    beltIn: [[0, 0.03], [0.25, 0.06], [0.6, 0.1], [0.82, 0.13], [0.93, 0.1], [1, 0.05]], tum: 0.36, roofW: 0.56, sideHollow: 0.02,
    cabin: { cowl: 0.26, wsTop: 0.4, rearTop: 0.875, rearBot: 0.98 },
    sideGlass: [0.26, 0.855], pillars: [[0.492, 0.512], [0.712, 0.732]],
    cladBase: 2, archTrim: 0.03, seams: [0.28, 0.502, 0.722], handles: [0.478, 0.7], handleColor: 0x0c0c0d, beltTrim: 'chrome',
    hoodSeam: 0.8,
    interior: { seat: 0x6b5137 },
    wheel: { style: 'twin5', rimRatio: 0.7, rimColor: 0xb4b8bc, dish: 0.05 }, caliper: 0xc1121f,
    plates: { front: 0.52, rear: 0.9 },
    wing: { t: 0.87, h: 0.012, span: 0.6, chord: 0.16, posts: 0.3, rake: 0.4 },
    exhausts: [{ x: 0.5, y: 0.36, r: 0.04, sx: 1.6 }, { x: 0.64, y: 0.36, r: 0.04, sx: 1.6 }],
    decals: (P) => [
      ...lamp('front', { ell: [0.7, 0.875, 0.18, 0.06], n: 3, rot: 0.1 }),
      head({ ell: [0.64, 0.885, 0.035, 0.015], n: 4 }), head({ ell: [0.75, 0.895, 0.035, 0.015], n: 4 }),
      drl({ ell: [0.64, 0.853, 0.035, 0.011], n: 4 }), drl({ ell: [0.75, 0.863, 0.035, 0.011], n: 4 }),
      ...intake('front', { ell: [0, 0.62, 0.4, 0.15], n: 5, center: true }),
      ...intake('front', { ell: [0.72, 0.62, 0.16, 0.12], n: 4 }),
      drl({ rect: [0.72, 0.755, 0.26, 0.012], lift: 0.013 }), blinkF({ rect: [0.72, 0.74, 0.26, 0.007], lift: 0.013 }),
      chrome('front', { rect: [0, 0.37, 0.9, 0.02], center: true, lift: 0.008 }),
      tlens({ rect: [0, 1.13, 1.8, 0.07], center: true, sub: [18, 1] }),
      tail({ rect: [0, 1.135, 1.76, 0.02], center: true, sub: [18, 1] }),
      brake({ ell: [0.74, 1.135, 0.14, 0.03], n: 3, lift: 0.018 }),
      rev({ ell: [0.5, 1.112, 0.06, 0.008], n: 3, lift: 0.018 }), blinkR({ ell: [0.76, 1.108, 0.1, 0.007], n: 3, lift: 0.019 }),
      dark('rear', { ell: [0, 0.4, 0.84, 0.1], n: 5, center: true }),
      chrome('rear', { rect: [0, 0.47, 0.9, 0.016], center: true, lift: 0.009 }),
      dark('rear', { strip: [[0.7, 0.62, 0.71, 0.62], [0.7, 1.05, 0.71, 1.05]], sub: [6, 1], lift: 0.003 }),
      chmsl(P.zOf(0.875) + 0.03, 0.6),
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Lamborghini Huracán : coin très bas, nez en pointe, prises d'air hexagonales, feux en Y, capot moteur à lamelles.
  lambo_huracan: {
    axleF: 0.225, axleR: 0.82, wheelR: 0.345, tireW: 0.3, archGap: 0.035, archCrest: 0.04,
    noseBulge: 0.16, tailBulge: 0.06, capAngle: 60, capKy: 0.25,
    top: [[0, 0.5, 's'], [0.09, 0.61], [0.19, 0.7], [0.265, 0.78, 's'], [0.39, 1.09], [0.455, 1.165], [0.52, 1.165], [0.63, 1.08], [0.82, 0.935, 's'], [1, 0.89, 's']],
    belt: [[0, 0.5, 's'], [0.09, 0.62], [0.19, 0.71], [0.265, 0.76], [0.5, 0.8], [0.68, 0.88], [0.82, 0.92], [1, 0.88, 's']],
    bottom: bot(0.12, 0.17, 0.3, 0.03, 0.03),
    plan: [[0, 0.82, 's'], [0.07, 0.95], [0.2, 0.97], [0.4, 0.955], [0.6, 0.97], [0.8, 1], [0.96, 0.99], [1, 0.96, 's']],
    beltIn: [[0, 0.04], [0.2, 0.05], [0.35, 0.1], [0.55, 0.16], [0.75, 0.26], [0.9, 0.2], [1, 0.1]], tum: 0.62, roofW: 0.42, hoodP: 3.2, sideHollow: 0.03,
    crease: 26, tuck: 0.05,
    cabin: { cowl: 0.265, wsTop: 0.425, rearTop: 0.555, rearBot: 0.82 },
    sideGlass: [0.265, 0.655], rearGlassOpaque: true, cabEnd: 0.6,
    clad: [[0, 0.04, 2]], cladBase: 2,
    seams: [0.32, 0.565], handles: [], beltTrim: 'black',
    hoodSeam: 0.6, hoodFront: 0.05,
    paint: 'pearl', interior: { seat: 0x1a1a1c, rear: false, recline: 0.5 },
    wheel: { style: 'y5', rimRatio: 0.78, rimColor: 0x1d1e21, rimRough: 0.3, dish: 0.05 }, caliper: 0xf4d000,
    plates: { rear: 0.5 }, mirrors: { dy: 0.07, dt: 0.07 },
    exhausts: [{ x: 0.2, y: 0.62, r: 0.055, dark: true }],
    decals: (P) => [
      lens('front', { quad: [[0.36, 0.56], [0.84, 0.6], [0.86, 0.66], [0.44, 0.615]], sub: [8, 2] }),
      cover('front', { quad: [[0.36, 0.56], [0.84, 0.6], [0.86, 0.66], [0.44, 0.615]], sub: [8, 2] }),
      drl({ strip: [[0.4, 0.571, 0.44, 0.603], [0.62, 0.593, 0.63, 0.617]], sub: [5, 1], lift: 0.018 }),
      drl({ strip: [[0.62, 0.593, 0.63, 0.617], [0.83, 0.613, 0.835, 0.631]], sub: [4, 1], lift: 0.018 }),
      drl({ strip: [[0.62, 0.617, 0.636, 0.617], [0.8, 0.651, 0.81, 0.639]], sub: [4, 1], lift: 0.018 }),
      head({ ell: [0.54, 0.6, 0.03, 0.01], lift: 0.018 }),
      ...intake('front', { quad: [[0.22, 0.2], [0.78, 0.2], [0.76, 0.44], [0.32, 0.41]], sub: [8, 3] }),
      ...intake('front', { quad: [[-0.18, 0.2], [0.18, 0.2], [0.22, 0.31], [-0.22, 0.31]], sub: [6, 2], center: true }),
      carbon('front', { rect: [0, 0.165, 1.7, 0.04], center: true, sub: [12, 1] }),
      // feux arrière en Y
      gloss('rear', { quad: [[-0.76, 0.5], [0.76, 0.5], [0.82, 0.76], [-0.82, 0.76]], sub: [10, 3], center: true }),
      { p: 'rear', quad: [[-0.6, 0.53], [0.6, 0.53], [0.62, 0.7], [-0.62, 0.7]], sub: [10, 3], center: true, c: 0x2c2d30, r: 0.45, fx: 1, lift: 0.009 },
      tail({ strip: [[0.36, 0.8, 0.36, 0.822], [0.62, 0.8, 0.62, 0.822]], sub: [4, 1] }),
      tail({ strip: [[0.62, 0.8, 0.62, 0.822], [0.9, 0.86, 0.9, 0.882]], sub: [4, 1] }),
      tail({ strip: [[0.62, 0.8, 0.64, 0.8], [0.88, 0.745, 0.88, 0.767]], sub: [4, 1] }),
      brake({ ell: [0.62, 0.81, 0.03, 0.012], lift: 0.019 }),
      rev({ rect: [0, 0.28, 0.12, 0.03], center: true, lift: 0.02 }),
      carbon('rear', { quad: [[-0.72, 0.2], [0.72, 0.2], [0.62, 0.42], [-0.62, 0.42]], sub: [10, 3], center: true }),
      ...[-0.36, -0.12, 0.12, 0.36].map((x) => dark('rear', { rect: [x, 0.3, 0.014, 0.2], center: true, sub: [1, 3], lift: 0.012 })),
      // prises d'air latérales et capot moteur
      ...intake('side', { quad: [[P.zOf(0.6), 0.42], [P.zOf(0.715), 0.52], [P.zOf(0.715), 0.74], [P.zOf(0.64), 0.68]], sub: [6, 3] }),
      gloss('top', { quad: [[-0.34, P.zOf(0.66)], [0.34, P.zOf(0.66)], [0.42, P.zOf(0.93)], [-0.42, P.zOf(0.93)]], sub: [4, 10], center: true, lift: 0.006 }),
      ...[0.7, 0.75, 0.8, 0.85, 0.9].map((t) => carbon('top', { rect: [0, P.zOf(t), 0.62, 0.03], center: true, sub: [6, 1], lift: 0.011 })),
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Lamborghini Aventador : plus long, plus large et plus bas ; énormes prises d'air latérales, sortie hexagonale centrale.
  lambo_aventador: {
    axleF: 0.225, axleR: 0.8, wheelR: 0.355, tireW: 0.33, archGap: 0.035, archCrest: 0.04,
    noseBulge: 0.18, tailBulge: 0.06, capAngle: 60, capKy: 0.25,
    top: [[0, 0.47, 's'], [0.09, 0.575], [0.19, 0.655], [0.25, 0.73, 's'], [0.39, 1.07], [0.45, 1.135], [0.51, 1.14], [0.61, 1.07], [0.8, 0.93, 's'], [1, 0.87, 's']],
    belt: [[0, 0.47, 's'], [0.09, 0.585], [0.19, 0.665], [0.25, 0.71], [0.48, 0.77], [0.66, 0.88], [0.8, 0.915], [1, 0.86, 's']],
    bottom: bot(0.115, 0.16, 0.29, 0.03, 0.03),
    plan: [[0, 0.8, 's'], [0.07, 0.93], [0.2, 0.95], [0.4, 0.93], [0.6, 0.96], [0.8, 1], [0.96, 0.99], [1, 0.96, 's']],
    beltIn: [[0, 0.04], [0.2, 0.05], [0.33, 0.11], [0.55, 0.18], [0.75, 0.3], [0.9, 0.22], [1, 0.1]], tum: 0.66, roofW: 0.4, hoodP: 3.2, sideHollow: 0.035,
    crease: 24, tuck: 0.05,
    cabin: { cowl: 0.25, wsTop: 0.42, rearTop: 0.54, rearBot: 0.8 },
    sideGlass: [0.25, 0.635], rearGlassOpaque: true, cabEnd: 0.585,
    clad: [[0, 0.04, 2]], cladBase: 2,
    seams: [0.31, 0.555], handles: [], beltTrim: 'black',
    hoodSeam: 0.6, hoodFront: 0.05,
    paint: 'pearl', interior: { seat: 0x1a1a1c, rear: false, recline: 0.55 },
    wheel: { style: 'y5', rimRatio: 0.78, rimColor: 0x17181a, rimRough: 0.3, dish: 0.055 }, caliper: 0xc1121f,
    plates: { rear: 0.44 }, mirrors: { dy: 0.07, dt: 0.07 },
    exhausts: [{ x: 0, y: 0.6, r: 0.1, hex: true, dark: true, center: true, sx: 1.5 }],
    decals: (P) => [
      lens('front', { quad: [[0.4, 0.53], [0.88, 0.57], [0.9, 0.63], [0.48, 0.585]], sub: [8, 2] }),
      cover('front', { quad: [[0.4, 0.53], [0.88, 0.57], [0.9, 0.63], [0.48, 0.585]], sub: [8, 2] }),
      drl({ strip: [[0.44, 0.541, 0.48, 0.573], [0.66, 0.563, 0.67, 0.587]], sub: [5, 1], lift: 0.018 }),
      drl({ strip: [[0.66, 0.563, 0.67, 0.587], [0.87, 0.583, 0.875, 0.601]], sub: [4, 1], lift: 0.018 }),
      drl({ strip: [[0.66, 0.587, 0.676, 0.587], [0.84, 0.621, 0.85, 0.609]], sub: [4, 1], lift: 0.018 }),
      head({ ell: [0.58, 0.57, 0.03, 0.01], lift: 0.018 }),
      ...intake('front', { quad: [[0.2, 0.19], [0.82, 0.19], [0.8, 0.42], [0.34, 0.39]], sub: [8, 3] }),
      ...intake('front', { quad: [[-0.14, 0.19], [0.14, 0.19], [0.2, 0.29], [-0.2, 0.29]], sub: [6, 2], center: true }),
      carbon('front', { rect: [0, 0.155, 1.8, 0.04], center: true, sub: [12, 1] }),
      gloss('rear', { quad: [[-0.8, 0.46], [0.8, 0.46], [0.86, 0.74], [-0.86, 0.74]], sub: [10, 3], center: true }),
      { p: 'rear', quad: [[-0.66, 0.49], [0.66, 0.49], [0.68, 0.69], [-0.68, 0.69]], sub: [10, 3], center: true, c: 0x2c2d30, r: 0.45, fx: 1, lift: 0.009 },
      tail({ strip: [[0.4, 0.78, 0.4, 0.802], [0.64, 0.78, 0.64, 0.802]], sub: [4, 1] }),
      tail({ strip: [[0.64, 0.78, 0.64, 0.802], [0.94, 0.845, 0.94, 0.867]], sub: [4, 1] }),
      tail({ strip: [[0.64, 0.78, 0.66, 0.78], [0.92, 0.725, 0.92, 0.747]], sub: [4, 1] }),
      brake({ ell: [0.64, 0.79, 0.03, 0.012], lift: 0.019 }),
      rev({ rect: [0.3, 0.28, 0.1, 0.03], lift: 0.02 }),
      carbon('rear', { quad: [[-0.76, 0.19], [0.76, 0.19], [0.66, 0.42], [-0.66, 0.42]], sub: [10, 3], center: true }),
      ...[-0.42, -0.2, 0.2, 0.42].map((x) => dark('rear', { rect: [x, 0.3, 0.014, 0.2], center: true, sub: [1, 3], lift: 0.012 })),
      ...intake('side', { quad: [[P.zOf(0.555), 0.38], [P.zOf(0.705), 0.5], [P.zOf(0.705), 0.76], [P.zOf(0.62), 0.7]], sub: [6, 3] }),
      gloss('top', { quad: [[-0.3, P.zOf(0.65)], [0.3, P.zOf(0.65)], [0.4, P.zOf(0.93)], [-0.4, P.zOf(0.93)]], sub: [4, 10], center: true, lift: 0.006 }),
      ...[0.69, 0.74, 0.79, 0.84, 0.89].map((t) => carbon('top', { rect: [0, P.zOf(t), 0.56, 0.03], center: true, sub: [6, 1], lift: 0.011 })),
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Lamborghini Urus : SUV coupé agressif, grande calandre hexagonale, Y lumineux, pavillon fuyant.
  lambo_urus: {
    axleF: 0.18, axleR: 0.785, wheelR: 0.405, tireW: 0.315, archGap: 0.05, archCrest: 0.045,
    noseBulge: 0.16, tailBulge: 0.1, capAngle: 62, capKy: 0.3,
    top: [[0, 0.84, 's'], [0.04, 0.89], [0.13, 0.965], [0.26, 1.07, 's'], [0.4, 1.53], [0.47, 1.63], [0.54, 1.64], [0.69, 1.57], [0.875, 1.36, 's'], [0.965, 1.14, 's'], [1, 1.1, 's']],
    belt: [[0, 0.835, 's'], [0.05, 0.895], [0.13, 0.955], [0.26, 1.04], [0.5, 1.09], [0.75, 1.17], [0.9, 1.19], [1, 1.1, 's']],
    bottom: bot(0.2, 0.26, 0.36, 0.04, 0.04),
    plan: [[0, 0.88, 's'], [0.05, 0.95], [0.14, 0.975], [0.3, 0.97], [0.55, 0.975], [0.78, 1], [0.94, 0.99], [1, 0.95, 's']],
    beltIn: [[0, 0.04], [0.25, 0.07], [0.6, 0.12], [0.8, 0.18], [0.93, 0.14], [1, 0.07]], tum: 0.42, roofW: 0.5, hoodP: 3, sideHollow: 0.03,
    crease: 28,
    cabin: { cowl: 0.26, wsTop: 0.415, rearTop: 0.875, rearBot: 0.965 },
    sideGlass: [0.26, 0.845], pillars: [[0.492, 0.512]],
    cladBase: 2, archTrim: 0.035, seams: [0.28, 0.502, 0.72], handles: [0.478, 0.695], handleColor: 0x0c0c0d, beltTrim: 'black',
    hoodSeam: 0.7,
    paint: 'pearl', interior: { seat: 0x1a1a1c },
    wheel: { style: 'y5', rimRatio: 0.76, rimColor: 0x1d1e21, rimRough: 0.3, dish: 0.05 }, caliper: 0xf4d000,
    plates: { front: 0.5, rear: 0.74 },
    wing: { t: 0.873, h: 0.012, span: 0.56, chord: 0.15, posts: 0.3, rake: 0.4 },
    exhausts: [{ x: 0.5, y: 0.38, r: 0.045 }, { x: 0.62, y: 0.38, r: 0.045 }],
    decals: (P) => [
      lens('front', { quad: [[0.42, 0.865], [0.9, 0.905], [0.92, 0.965], [0.48, 0.915]], sub: [8, 2] }),
      cover('front', { quad: [[0.42, 0.865], [0.9, 0.905], [0.92, 0.965], [0.48, 0.915]], sub: [8, 2] }),
      drl({ strip: [[0.47, 0.878, 0.49, 0.903], [0.7, 0.9, 0.705, 0.92]], sub: [5, 1], lift: 0.018 }),
      drl({ strip: [[0.7, 0.9, 0.705, 0.92], [0.89, 0.92, 0.895, 0.936]], sub: [4, 1], lift: 0.018 }),
      drl({ strip: [[0.7, 0.92, 0.715, 0.92], [0.87, 0.955, 0.88, 0.943]], sub: [4, 1], lift: 0.018 }),
      head({ ell: [0.6, 0.9, 0.03, 0.01], lift: 0.018 }),
      ...intake('front', { quad: [[-0.34, 0.34], [0.34, 0.34], [0.44, 0.76], [-0.44, 0.76]], sub: [8, 4], center: true }),
      ...intake('front', { quad: [[0.52, 0.38], [0.8, 0.4], [0.82, 0.7], [0.6, 0.72]], sub: [8, 4] }),
      carbon('front', { rect: [0, 0.27, 1.7, 0.05], center: true, sub: [12, 1] }),
      gloss('rear', { rect: [0, 0.99, 1.7, 0.13], center: true, sub: [12, 2] }),
      tail({ strip: [[0.36, 0.985, 0.36, 1.005], [0.6, 0.985, 0.6, 1.005]], sub: [4, 1] }),
      tail({ strip: [[0.6, 0.985, 0.6, 1.005], [0.82, 1.025, 0.82, 1.045]], sub: [4, 1] }),
      tail({ strip: [[0.6, 0.985, 0.62, 0.985], [0.81, 0.94, 0.81, 0.96]], sub: [4, 1] }),
      brake({ ell: [0.6, 0.995, 0.03, 0.012], lift: 0.019 }),
      rev({ rect: [0.28, 0.965, 0.08, 0.02], lift: 0.016 }),
      carbon('rear', { quad: [[-0.8, 0.28], [0.8, 0.28], [0.72, 0.56], [-0.72, 0.56]], sub: [10, 3], center: true }),
      ...[-0.3, 0, 0.3].map((x) => dark('rear', { rect: [x, 0.4, 0.014, 0.2], center: true, sub: [1, 3], lift: 0.012 })),
      dark('rear', { strip: [[0.74, 0.62, 0.75, 0.62], [0.74, 1.06, 0.75, 1.06]], sub: [6, 1], lift: 0.003 }),
      chmsl(P.zOf(0.875) + 0.03, 0.6),
    ],
  },
};

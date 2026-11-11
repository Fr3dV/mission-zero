// Le Capitole de Toulouse. Dimensions calées sur l'emprise réelle (IGN) : 109 m × 56 m, façade de 41 travées
// en brique et pierre (huit colonnes de marbre rose à l'avant-corps central, fronton, attique « CAPITOLIUM »),
// cour Henri-IV traversante, théâtre dans la moitié sud, donjon côté square Charles-de-Gaulle ;
// place du Capitole (dallage, croix occitane) et galerie des arcades à l'ouest.
// Repère : +Z = ouest (vers la place), +X = sud (théâtre).
import * as THREE from 'three';
import { P, arcadeShape, palaceWing } from '../kit.js';
import { bwing, brick, balustrade, flag, FR, OC, EU } from './tk.js';

const HW = 54.5, ZF = 28, DEP = 13, BAY = 109 / 41;   // demi-longueur, plan de façade, épaisseur de l'aile de façade, travée (2,66 m)
const H0 = 6.8, H1 = 7.2, H2 = 3.6, HC = H0 + H1 + H2; // rez-de-chaussée, étage noble, attique -> corniche à 17,6 m
const mk = (hex, r = 0.8, mt = 0, t = 0, g = 0.4) => { const c = new THREE.Color(hex); return { c: [c.r, c.g, c.b], r, m: mt, t, g }; };

// travée de façade (groupe face à +Z, mur en z = 0) : arcade au rez-de-chaussée, haute fenêtre à balcon, attique
function bay(B, x, o = {}) {
  if (!o.noGround) B.win(x, 0.5, 0, BAY * 0.52, 4.1, { arch: true, frameMat: P.pierre, lit: 0.35, farMin: 0 });
  B.win(x, H0 + 1.1, 0, BAY * 0.46, 4.5, { frameMat: P.pierre, lit: 0.6, farMin: 0 });
  B.win(x, H0 + H1 + 0.9, 0, BAY * 0.42, 1.5, { frameMat: P.pierre, lit: 0.3 });
  if (B.hi) {
    B.box(P.ironD, BAY * 0.66, 0.9, 0.45, x, H0 + 0.25, 0.32, 0, { jit: 0 });              // balcon de ferronnerie
    B.box(P.pierre, BAY * 0.72, 0.28, 0.7, x, H0 - 0.03, 0.3, 0, { jit: 0 });
    B.box(P.pierre, BAY * 0.62, 0.28, 0.28, x, H0 + 6, 0.14, 0, { jit: 0 });               // corniche de la fenêtre
  }
}
// pilastre ionique de pierre sur les deux étages
function pilaster(B, x, z = 0, w = 0.6) {
  if (B.far) return;
  B.box(P.pierre, w, H1 + H2 - 0.9, 0.3, x, H0 + 0.3, z + 0.11, 0, { jit: 0.02 });
  B.box(P.pierre, w + 0.3, 0.5, 0.46, x, H0 + H1 + H2 - 0.72, z + 0.15, 0, { jit: 0 }); B.box(P.pierre, w + 0.18, 0.36, 0.42, x, H0 + 0.1, z + 0.13, 0, { jit: 0 });
}

function buildCapitole(m) {
  const { B } = m, BR = P.brick, ST = P.pierre;
  const GW = 4.4, GH = 6;                                                                   // passage central vers la cour Henri-IV
  // ================= aile de façade (ouest) =================
  for (const sx of [-1, 1]) { B.box(BR, HW - GW / 2, HC + 3, DEP, sx * (HW + GW / 2) / 2, -3, ZF - DEP / 2); m.collide.box(sx * (HW + GW / 2) / 2, ZF - DEP / 2, (HW - GW / 2) / 2 + 0.2, DEP / 2 + 0.2); }
  B.extrude(BR, arcadeShape(-GW / 2, GW / 2, GH + 0.6, [{ x: 0, w: GW - 0.8, h: GH }]), DEP, 0, 0, ZF - DEP); B.box(BR, GW, HC - GH - 0.6, DEP, 0, GH + 0.6, ZF - DEP / 2);
  m.collide.box(0, ZF - DEP / 2, GW / 2, DEP / 2, 0, GH);
  B.frustum(P.tile, 2 * HW, DEP, 2 * HW - 9, 2.5, 2.4, 0, HC + 0.6, ZF - DEP / 2);
  B.group(0, 0, ZF, 0, () => {
    // soubassement, bandeaux, entablement
    B.box(ST, 2 * HW + 0.4, 1.0, 0.5, 0, 0, 0.1); B.box(ST, 2 * HW + 0.3, 0.45, 0.5, 0, H0 - 0.45, 0.12, 0, { jit: 0 });
    B.box(ST, 2 * HW + 0.5, 0.95, 0.6, 0, HC - 0.95, 0.15, 0, { jit: 0.02 }); B.box(ST, 2 * HW + 1.2, 0.45, 1.2, 0, HC, 0.25, 0, { jit: 0 });
    // ailes courantes : 12 travées de part et d'autre du corps central
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 12; i++) { const x = sx * (3.5 * BAY + (i + 0.5) * BAY); bay(B, x); pilaster(B, x - sx * BAY / 2); }
      pilaster(B, sx * 15.5 * BAY);
      balustrade(B, 12 * BAY - 0.6, sx * 9.5 * BAY, HC + 0.45, 0.5);
    }
    // ---- avant-corps central : 7 travées, trois portails, huit colonnes de marbre rose, attique sculpté, fronton ----
    const CW = 7 * BAY + 1.6, CZ = 1.5;
    B.box(BR, CW, HC + 3, CZ, 0, -3, CZ / 2); B.box(ST, CW + 0.5, 1.1, CZ + 0.4, 0, 0, CZ / 2); B.box(ST, CW + 0.4, 0.55, CZ + 1.5, 0, H0 - 0.55, CZ / 2 + 0.6, 0, { jit: 0 });
    B.group(0, 0, CZ, 0, () => {
      for (const x of [-2 * BAY, 2 * BAY]) B.win(x, 0, 0, 2.9, GH - 1.9, { arch: true, mat: P.shadow, frameMat: ST, farMin: 0 });
      B.extrude(ST, archBand(GW / 2 - 0.4, 0.55), 0.35, 0, GH - (GW / 2 - 0.4), 0); B.box(P.shadow, GW - 0.8, GH - (GW / 2 - 0.4), 0.1, 0, 0, -CZ + 0.02, 0, { jit: 0 });
      for (const x of [-3 * BAY, -BAY, BAY, 3 * BAY]) B.win(x, 0.6, 0, 1.4, 3.8, { arch: true, frameMat: ST, lit: 0.4, farMin: 0 });
      for (let i = 0; i < 7; i++) { const x = (i - 3) * BAY; B.win(x, H0 + 1.1, 0, 1.3, 4.7, { frameMat: ST, lit: 0.9, farMin: 0 }); B.win(x, H0 + H1 + 0.9, 0, 1.15, 1.5, { frameMat: ST, lit: 0.4 }); if (B.hi) B.box(P.ironD, 1.9, 0.9, 0.3, x, H0 + 0.25, 0.85, 0, { jit: 0 }); }
      for (let i = 0; i < 8; i++) B.column((i - 3.5) * BAY, H0, 0.95, 0.42, H1 + H2 - 0.9, 'ion', P.marbre);
      B.box(ST, CW + 0.6, 1.05, 2.1, 0, HC - 1.05, 0.65, 0, { jit: 0.02 }); B.box(ST, CW + 1.5, 0.5, 3, 0, HC, 0.65, 0, { jit: 0 });
      // attique « CAPITOLIUM », groupes sculptés (la Force, la Justice), fronton aux armes de la ville, horloge
      B.box(ST, CW - 0.8, 3.9, 1.6, 0, HC + 0.5, 0); B.box(ST, CW, 0.45, 2, 0, HC + 4.4, 0, 0, { jit: 0 });
      B.box(P.shadow, 11, 1.3, 0.12, 0, HC + 1.8, 0.82, 0, { jit: 0 }); B.box(P.gold, 9.4, 0.65, 0.08, 0, HC + 2.12, 0.9, 0, { jit: 0 });
      for (const sx of [-1, 1]) { B.lump(P.stoneL, sx * 7.4, HC + 4.85, 0.1, 3.6, 3.2, 1.2, 3, sx + 5); B.statue(P.stoneL, sx * 9.6, HC + 4.85, 0.3, 2.8); }
      B.gable(ST, P.tile, 10.4, 3.2, 1.8, 0, HC + 4.85, 0); B.lump(P.stoneL, 0, HC + 5.05, 1, 4.4, 2, 0.5, 4, 2);
      B.add(new THREE.CircleGeometry(0.95, 16), P.stoneW, 0, HC + 3.45, 0.84, 0, { jit: 0 });
      flag(B, -1.4, HC + 0.4, 2.1, 5.2, FR); flag(B, 0, HC + 0.4, 2.1, 5.2, OC); flag(B, 1.4, HC + 0.4, 2.1, 5.2, EU);
    });
    // ---- avant-corps latéraux : cinq travées, pilastres, fronton ----
    for (const sx of [-1, 1]) B.group(sx * 18 * BAY, 0, 0, 0, () => {
      const LW = 5 * BAY + 0.6;
      B.box(BR, LW, HC + 3, 0.9, 0, -3, 0.45); B.box(ST, LW + 0.4, 1.1, 1.3, 0, 0, 0.45);
      B.group(0, 0, 0.9, 0, () => { for (let i = 0; i < 5; i++) bay(B, (i - 2) * BAY); for (let i = 0; i <= 5; i++) pilaster(B, (i - 2.5) * BAY, 0, 0.65); });
      B.box(ST, LW + 0.5, 0.95, 1.6, 0, HC - 0.95, 0.55, 0, { jit: 0.02 }); B.box(ST, LW + 1.2, 0.45, 2.2, 0, HC, 0.6, 0, { jit: 0 });
      B.box(ST, LW - 0.6, 1.3, 1.3, 0, HC + 0.45, 0.4); B.gable(ST, P.tile, 9.4, 2.6, 1.5, 0, HC + 1.75, 0.45); B.lump(P.stoneL, 0, HC + 1.9, 1.25, 3.6, 1.6, 0.4, 3, sx + 9);
      for (const x of [-5.8, 5.8]) B.statue(P.stoneL, x, HC + 1.75, 0.55, 2.4);
    });
  });
  // ================= aile est (rue Ernest-Roschach), blocs intérieurs, cours =================
  const SIDE = brick({ floors: [{ h: H0, arch: true, w: 1.5, wh: 4, sill: 0.5 }, { h: H1, w: 1.25, wh: 4.3, sill: 1.1, lit: 0.5 }, { h: H2, w: 1.1, wh: 1.5, sill: 0.9 }], bay: BAY, pil: true });
  const ZI0 = -13, ZI1 = ZF - DEP;                                                          // les blocs intérieurs s'étendent de z = -13 à z = 15
  bwing(m, 0, (-ZF + ZI0) / 2, 0, { ...SIDE, dep: ZI0 + ZF, len: 2 * HW, gates: [{ x: 0, w: GW, h: GH }] });
  const block = (x0, x1, h, roof = P.tile) => {
    const w = x1 - x0, cx = (x0 + x1) / 2, d = ZI1 - ZI0, cz = (ZI0 + ZI1) / 2;
    B.box(BR, w, h + 3, d, cx, -3, cz); B.frustum(roof, w + 0.5, d + 0.5, w * 0.35, d - w * 0.65 > 1 ? d - w * 0.65 : 1, 2.6, cx, h, cz); m.collide.box(cx, cz, w / 2 + 0.2, d / 2 + 0.2);
  };
  block(-HW, -38, HC - 0.4); block(-15, -GW / 2 - 2.8, HC - 0.4); block(GW / 2 + 2.8, 14, HC - 0.4); block(20, HW, HC - 0.4);
  // cours : Henri-IV (traversante, au centre), cour nord, cour sud
  for (const [x0, x1] of [[-38, -15], [-GW / 2 - 2.8, GW / 2 + 2.8], [14, 20]]) B.box(P.pave, x1 - x0, 0.3, ZI1 - ZI0, (x0 + x1) / 2, -0.22, (ZI0 + ZI1) / 2, 0, { jit: 0 });
  for (const sx of [-1, 1]) B.group(sx * (GW / 2 + 2.8), 0, 1, -sx * Math.PI / 2, () => {     // façades Renaissance de la cour Henri-IV
    B.winRow(-13, 13, 0.4, 0.02, 6, 2.2, 4.4, { arch: true, mat: P.shadow, frameMat: ST, farMin: 0 }); B.winRow(-13, 13, H0 + 1, 0.02, 6, 1.5, 3.8, { frameMat: ST, lit: 0.6 }); B.winRow(-13, 13, H0 + H1 + 0.6, 0.02, 6, 1.3, 1.4, { frameMat: ST });
    if (B.hi) { B.box(ST, 28, 0.4, 0.4, 0, H0 - 0.4, 0.18, 0, { jit: 0 }); B.box(ST, 28, 0.6, 0.6, 0, HC - 1.6, 0.25, 0, { jit: 0 }); }
  });
  m.collide.box(-26.5, 1, 11.4, 13.8); m.collide.box(17, 1, 2.9, 13.8);                      // cours fermées
  B.group(0, 0, ZI0, 0, () => {                                                              // portail de Nicolas Bachelier, Henri IV en pied
    for (const sx of [-1, 1]) B.box(ST, 1.9, GH + 0.5, 0.7, sx * 3.25, 0, 0.3); B.box(ST, 8.4, 11.8 - GH - 0.4, 0.7, 0, GH + 0.4, 0.3); B.gable(ST, null, 8.8, 1.8, 0.9, 0, 11.8, 0.3);
    B.box(P.shadow, 2.2, 3.6, 0.2, 0, 7.4, 0.66, 0, { jit: 0 }); B.statue(mk(0x2c2a28, 0.4, 0.3), 0, 7.6, 0.9, 3); B.box(P.gold, 3, 0.26, 0.1, 0, 6.95, 0.72, 0, { jit: 0 });
  });
  // théâtre du Capitole (moitié sud) : cage de scène et coupole de la salle émergent des toits
  B.box(BR, 26, 7, 24, 37, HC - 1, 1); B.box(ST, 27, 0.5, 25, 37, HC + 6, 1, 0, { jit: 0 }); B.frustum(P.zinc, 26, 24, 14, 12, 2.6, 37, HC + 6.5, 1);
  B.cyl(P.zinc, 7, 7.4, 1.8, 37, HC + 6.5, 5, 20); B.dome(P.zinc, 7.1, 2.6, 37, HC + 8.3, 5, 20);
  // ================= donjon du Capitole (square Charles-de-Gaulle) =================
  B.group(13, 0, -39.5, 0, () => {
    const dw = 11.4, dd = 12.6, dh = 21, SL = P.ardoise;
    B.box(BR, dw, dh + 3, dd, 0, -3, 0); B.box(P.brickD, dw + 0.4, 1.4, dd + 0.4, 0, 0, 0);
    // mâchicoulis et chemin de ronde crénelé
    B.box(BR, dw + 1.5, 2.6, dd + 1.5, 0, dh - 1.2, 0); B.box(ST, dw + 1.7, 0.3, dd + 1.7, 0, dh - 1.4, 0, 0, { jit: 0 }); B.box(ST, dw + 1.7, 0.3, dd + 1.7, 0, dh + 1.4, 0, 0, { jit: 0 });
    if (B.hi) for (let k = 0; k < 4; k++) B.group(0, 0, 0, k * Math.PI / 2, () => { const L = k % 2 ? dd : dw, off = (k % 2 ? dw : dd) / 2 + 0.75; for (let i = 0; i < Math.round(L / 1.5); i++) { B.box(ST, 0.4, 1, 0.9, -L / 2 + 0.75 + i * 1.5, dh - 2.3, off - 0.4, 0, { jit: 0 }); if (i % 2 === 0) B.box(BR, 0.9, 0.9, 0.4, -L / 2 + 0.75 + i * 1.5, dh + 1.7, off - 0.2, 0, { jit: 0.03 }); } });
    // échauguettes d'angle à poivrières d'ardoise
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const x = sx * (dw / 2 + 0.3), z = sz * (dd / 2 + 0.3); B.cyl(BR, 1.4, 1.4, 7.5, x, dh - 4, z, 10); B.cyl(ST, 1.4, 0.45, 1.6, x, dh - 5.6, z, 10); B.cyl(SL, 0.08, 1.65, 4.6, x, dh + 3.5, z, 10, { open: true }); B.cyl(ST, 1.55, 1.55, 0.25, x, dh + 3.3, z, 10, { jit: 0 }); }
    // haut comble d'ardoise (restauration de Viollet-le-Duc), campanile
    B.frustum(SL, dw - 0.6, dd - 0.6, 1.6, 4.2, 9.5, 0, dh + 1.7, 0);
    B.box(SL, 2.2, 2.6, 2.2, 0, dh + 11, 0); B.cyl(P.shadow, 1.3, 1.3, 1.8, 0, dh + 13.6, 0, 6); B.cyl(SL, 0.06, 1.7, 5, 0, dh + 15.4, 0, 8, { open: true }); B.cyl(P.gold, 0.04, 0.12, 1.6, 0, dh + 20.2, 0, 4);
    // baies à meneaux, porte (côté square)
    for (let k = 0; k < 4; k++) B.group(0, 0, 0, k * Math.PI / 2, () => { const off = (k % 2 ? dw : dd) / 2 + 0.02; for (const y of [7.5, 13.5]) { B.win(0, y, off, 1.9, 2.6, { frameMat: ST, lit: 0.7, farMin: 0 }); if (B.hi) B.box(ST, 0.16, 2.6, 0.2, 0, y, off + 0.12, 0, { jit: 0 }); } });
    B.group(0, 0, -dd / 2 - 0.02, Math.PI, () => B.win(0, 0, 0, 2, 3.4, { arch: true, mat: P.bois, frameMat: ST, farMin: 0 }));
  });
  m.collide.box(13, -39.5, 6.6, 7.2);
  return { height: 42 };
}

// ---------- place du Capitole : dallage de granit, croix occitane de bronze ----------
function buildPlace(m) {
  const { B } = m, W = 116, D = 88;                                                          // centrée sur la croix
  B.box(mk(0xb4aca0, 0.78, 0, 1, 0), W, 0.5, D, 0, -0.44, 0, 0, { jit: 0 });
  if (B.hi) { for (let i = 1; i < 10; i++) B.box(P.paveD, W, 0.04, 0.45, 0, 0.03, -D / 2 + i * D / 10, 0, { jit: 0 }); for (let i = 1; i < 12; i++) B.box(P.paveD, 0.45, 0.04, D, -W / 2 + i * W / 12, 0.03, 0, 0, { jit: 0 }); }
  B.add(occitanCross(9, B.far ? 6 : 12), mk(0xb98a3c, 0.4, 0.75, 0, 0.5), 0, 0.07, 0, 0, { jit: 0 });
  return { height: 1 };
}

// ---------- galerie des arcades (côté ouest de la place) : arcades de brique, plafonds peints ----------
function buildArcades(m) {
  const { B } = m, N = 25, STEP = 4.3, LEN = N * STEP + 1.4, DEPTH = 28, GAL = 4.8, AH = 4.9;
  // +Z local = vers la place (est) ; le monument est centré sur l'immeuble
  const zf = DEPTH / 2;
  const arches = []; for (let i = 0; i < N; i++) arches.push({ x: (i - (N - 1) / 2) * STEP, w: 3.3, h: AH });
  B.extrude(P.brick, arcadeShape(-LEN / 2, LEN / 2, 5.9, arches), 0.9, 0, 0, zf - 0.9);
  B.box(P.brick, LEN, 5.9 + 3, DEPTH - GAL, 0, -3, -GAL / 2); B.box(P.stoneL, LEN, 0.3, GAL, 0, 5.6, zf - GAL / 2, 0, { jit: 0 });
  B.group(0, 0, zf - GAL + 0.02, 0, () => B.winRow(-LEN / 2 + 2, LEN / 2 - 2, 0.3, 0, N, 3.2, 3.6, { mat: P.glassLit, frame: false, lit: 1, farMin: 1e9 }));     // vitrines sous la galerie
  if (B.hi) {
    for (let i = 0; i < N; i++) { const c = [[0.55, 0.12, 0.1], [0.1, 0.25, 0.5], [0.75, 0.55, 0.1], [0.15, 0.4, 0.3], [0.5, 0.2, 0.45]][i % 5]; B.box({ c, r: 0.6, m: 0, t: 0, g: 0.6 }, 3.2, 0.06, 3.6, (i - (N - 1) / 2) * STEP, 5.52, zf - GAL / 2, 0, { jit: 0.3 }); }   // plafonds peints (Moretti)
    for (let i = 0; i <= N; i++) B.box(P.pierre, 1, 0.35, 1.1, (i - N / 2) * STEP, AH - 1.75, zf - 0.45, 0, { jit: 0 });
  }
  for (let i = 0; i <= N; i++) m.collide.box((i - N / 2) * STEP, zf - 0.45, 0.55, 0.55, 0, -10, 8);
  m.collide.box(0, -GAL / 2, LEN / 2 + 0.2, (DEPTH - GAL) / 2 + 0.2);
  B.group(0, 5.9, 0, 0, () => palaceWing(B, brick({ len: LEN, dep: DEPTH, base: 0, plinth: false, floors: [{ h: 4.4, w: 1.6, wh: 3, sill: 0.9, lit: 0.5 }, { h: 4, w: 1.6, wh: 2.7, sill: 0.9, lit: 0.4 }, { h: 3.4, w: 1.5, wh: 2.1, sill: 0.8 }], bay: STEP, pil: true, roofH: 3.4 })));
  return { height: 24 };
}

// arc en plein cintre (bandeau)
function archBand(r, t) { const s = new THREE.Shape(); s.absarc(0, 0, r + t, 0, Math.PI, false); s.lineTo(-r, 0); s.absarc(0, 0, r, Math.PI, 0, true); s.closePath(); return s; }
// croix occitane tracée au sol en bandes de bronze (comme celle de Raymond Moretti) : quatre bras évasés à trois pointes pommetées
function occitanCross(R, seg) {
  const parts = [], band = (x0, z0, x1, z1, w) => { const len = Math.hypot(x1 - x0, z1 - z0); parts.push(new THREE.BoxGeometry(w, 0.05, len + w * 0.6).rotateY(Math.atan2(x1 - x0, z1 - z0)).translate((x0 + x1) / 2, 0.025, (z0 + z1) / 2)); };
  const arm = [[[0.07, 0.07], [0.3, 0.74]], [[0.3, 0.74], [0.12, 0.66]], [[0.12, 0.66], [0, 0.84]]];
  for (let k = 0; k < 4; k++) {
    const c = Math.cos(k * Math.PI / 2), s = Math.sin(k * Math.PI / 2), T = ([x, z]) => [(x * c - z * s) * R, (x * s + z * c) * R];
    for (const sx of [-1, 1]) for (const [p, q] of arm) { const a = T([p[0] * sx, p[1]]), b = T([q[0] * sx, q[1]]); band(a[0], a[1], b[0], b[1], 0.045 * R); }
    for (const [x, z] of [[0.33, 0.8], [0, 0.93], [-0.33, 0.8]]) { const p = T([x, z]); parts.push(new THREE.CylinderGeometry(0.07 * R, 0.07 * R, 0.06, seg).translate(p[0], 0.03, p[1])); }
  }
  parts.push(new THREE.CylinderGeometry(0.06 * R, 0.06 * R, 0.06, seg));
  const pos = [], nor = [];
  for (const g of parts) { const n = g.index ? g.toNonIndexed() : g; pos.push(...n.attributes.position.array); nor.push(...n.attributes.normal.array); }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  return out;
}

export const DEFS = { tls_capitole: buildCapitole, tls_capitole_place: buildPlace, tls_capitole_arcades: buildArcades };

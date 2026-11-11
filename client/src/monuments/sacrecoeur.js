// Basilique du Sacré-Cœur : travertin blanc, grand dôme ovoïde (83 m), quatre coupoles d'angle, porche à trois arches,
// campanile (84 m) derrière le chevet, podium et grand escalier.
import * as THREE from 'three';
import { P, arcadeShape, stairs, ovoid } from './kit.js';

export function buildSacreCoeur(m) {
  const { B } = m, W = P.stoneW, WD = { ...P.stoneW, c: P.stoneW.c.map((v) => v * 0.9) }, PY = 2.4;
  // podium + escalier
  B.box(WD, 42, PY + 4, 78, 0, -4, 3); B.box(P.stoneL, 42.6, 0.4, 78.6, 0, PY - 0.4, 3);
  stairs(B, P.stoneL, 30, 12, PY / 12, 0.55, 0, 0, 42);
  for (const sx of [-1, 1]) B.box(WD, 2.4, PY + 1, 7, sx * 16.2, 0, 45.4);
  m.collide.box(0, 3, 21.4, 39.4); m.collide.box(0, 45.4, 17.5, 3.6);
  const lantern = (x, y, z, r, h) => {
    B.cyl(W, r * 1.25, r * 1.25, h * 0.12, x, y, z, 12); B.cyl(P.shadow, r * 0.7, r * 0.7, h * 0.5, x, y + h * 0.12, z, 10);
    if (B.hi) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; B.cyl(W, r * 0.14, r * 0.14, h * 0.5, x + Math.sin(a) * r * 0.95, y + h * 0.12, z + Math.cos(a) * r * 0.95, 6); }
    B.cyl(W, r * 1.2, r * 1.2, h * 0.08, x, y + h * 0.62, z, 12); ovoid(B, W, r * 1.1, h * 0.45, x, y + h * 0.7, z, 12, 2);
    B.box(P.stoneL, 0.18, h * 0.22, 0.18, x, y + h * 1.13, z); B.box(P.stoneL, h * 0.1, 0.18, 0.18, x, y + h * 1.27, z);
  };
  B.group(0, PY, 0, 0, () => {
    // ---- corps principal (plan carré) ----
    B.box(W, 35, 27, 35, 0, 0, 8); B.box(P.stoneL, 36.4, 1, 36.4, 0, 26, 8); B.box(W, 33, 2.5, 33, 0, 27, 8);
    B.frustum(P.lead, 33, 33, 22, 22, 3, 0, 29.5, 8);
    // façade sud au-dessus du porche : grande baie, niche du Christ, pignon
    B.group(0, 0, 25.5, 0, () => {
      B.box(W, 16, 31, 1.6, 0, 0, 0.4); B.gable(W, P.lead, 17, 5, 2.2, 0, 31, 0.4);
      B.win(0, 17.5, 1.2, 5, 6.5, { arch: true, mat: P.vitrail, farMin: 0 }); B.box(P.shadow, 3, 5, 0.3, 0, 29.6, 1.1); B.statue(W, 0, 29.8, 1.5, 4.2);
      for (const sx of [-1, 1]) { B.win(sx * 11.5, 16, 0, 2.6, 6, { arch: true, mat: P.vitrail }); B.box(W, 2, 29, 2, sx * 8, 0, 0.6); }
    });
    for (const ry of [Math.PI / 2, -Math.PI / 2]) B.group(0, 0, 8, ry, () => {
      for (const x of [-8, 0, 8]) { B.win(x, 14, 17.5, 3, 7, { arch: true, mat: P.vitrail, farMin: 0 }); B.win(x, 3, 17.5, 2.2, 4.5, { arch: true, mat: P.vitrail }); }
      if (B.hi) for (const x of [-12.5, -4, 4, 12.5]) B.box(W, 1.6, 26, 1.2, x, 0, 17.6);
    });
    // ---- porche ----
    B.extrude(W, arcadeShape(-14.5, 14.5, 15.5, [{ x: -9, w: 5.6, h: 11.5 }, { x: 0, w: 6.4, h: 12.5 }, { x: 9, w: 5.6, h: 11.5 }]), 1.8, 0, 0, 34.4);
    for (const sx of [-1, 1]) B.extrude(W, arcadeShape(-5, 5, 15.5, [{ x: 0, w: 5.2, h: 11 }]), 1.6, sx * 14.5 - (sx > 0 ? 1.6 : 0), 0, 31, Math.PI / 2);
    B.box(W, 29, 1.2, 10.5, 0, 15.5, 31); B.box(P.stoneL, 30.4, 0.8, 11.4, 0, 16.7, 31);
    B.box(P.shadow, 27, 15, 0.3, 0, 0, 26.2);
    if (B.hi) { for (const x of [-9, 0, 9]) B.box(P.bronze, 3.4, 7, 0.3, x, 0, 26.5); for (let i = 0; i < 24; i++) B.box(W, 0.35, 1.3, 0.35, -13.8 + i * 1.2, 17.5, 35.6, 0, { jit: 0 }); B.box(W, 29, 0.3, 0.6, 0, 18.8, 35.6); }
    // statues équestres (Saint Louis, Jeanne d'Arc) : bronze vert-de-gris
    for (const sx of [-1, 1]) { B.box(W, 4.4, 2.2, 7, sx * 10.5, 17.5, 32); B.lump(P.verdigris, sx * 10.5, 19.7, 32, 3, 5.5, 5.5, 7, sx + 5); }
    // ---- grand dôme ----
    const DZ = 8;
    B.cyl(W, 11.4, 12.2, 5.5, 0, 31, DZ, 32);
    B.cyl(W, 9.6, 9.6, 14, 0, 36.5, DZ, 32); B.cyl(P.stoneL, 11.6, 11.4, 1.2, 0, 50.5, DZ, 32); B.cyl(W, 10.4, 10.9, 1.6, 0, 51.7, DZ, 32);
    const nd = B.far ? 10 : 20;
    for (let i = 0; i < nd; i++) {
      const a = (i + 0.5) * Math.PI * 2 / nd, s = Math.sin(a), c = Math.cos(a);
      B.cyl(W, 0.5, 0.56, 11.5, s * 10.6, 37.5, DZ + c * 10.6, 8);
      B.group(0, 0, DZ, a + Math.PI / nd, () => B.win(0, 39, 9.62, 1.9, 7.5, { arch: true, mat: P.shadow, frame: false, farMin: 0 }));
    }
    B.cyl(P.stoneL, 11.2, 11.2, 0.8, 0, 36.7, DZ, 32); B.cyl(P.stoneL, 11.3, 11.3, 0.9, 0, 49, DZ, 32);
    ovoid(B, W, 10.3, 21, 0, 53.3, DZ, 36, 2.2);
    if (B.hi) for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; for (let k = 0; k < 6; k++) { const t = 0.08 + k * 0.14, r = 10.3 * Math.pow(1 - Math.pow(t, 2.2), 0.62) + 0.05; B.box(P.stoneL, 0.5, 0.8, 0.35, Math.sin(a) * r, 53.3 + 21 * t, DZ + Math.cos(a) * r, a, { jit: 0 }); } }
    lantern(0, 73.4, DZ, 2.3, 7.4);
    // ---- quatre coupoles d'angle ----
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * 13.2, z = DZ + sz * 13.2;
      B.cyl(W, 4.4, 4.4, 7.5, x, 29, z, 16); B.cyl(P.stoneL, 5, 4.8, 0.8, x, 36.5, z, 16);
      for (let i = 0; i < 8; i++) B.group(x, 0, z, i * Math.PI / 4, () => B.win(0, 30.5, 4.42, 1.3, 3.8, { arch: true, mat: P.shadow, frame: false }));
      ovoid(B, W, 4.5, 9, x, 37.3, z, 18, 2.2); lantern(x, 46, z, 1.0, 3.4);
    }
    // ---- chevet et campanile ----
    B.cyl(W, 13, 13, 22, 0, 0, -9.5, 24, { t0: Math.PI / 2, tl: Math.PI }); B.dome(P.lead, 13.3, 6, 0, 22, -9.5, 24, { p0: Math.PI, pl: Math.PI });
    B.box(W, 26, 22, 4, 0, 0, -9);
    if (B.hi) for (let i = 0; i < 7; i++) B.group(0, 0, -9.5, Math.PI / 2 + (i + 0.5) * Math.PI / 7, () => B.win(0, 11, 13.02, 2, 6, { arch: true, mat: P.vitrail }));
    const CZ = -27;
    B.box(W, 10.5, 56, 10.5, 0, 0, CZ); B.box(P.stoneL, 11.6, 1, 11.6, 0, 55, CZ);
    B.box(W, 9.8, 13, 9.8, 0, 56, CZ); B.box(P.stoneL, 11.4, 1.2, 11.4, 0, 69, CZ);
    for (let k = 0; k < 4; k++) B.group(0, 0, CZ, k * Math.PI / 2, () => {
      for (const x of [-2.2, 2.2]) B.win(x, 57.5, 4.92, 2.6, 8.2, { arch: true, mat: P.shadow, frame: false, farMin: 0 });
      if (B.hi) { for (const x of [-4.2, 0, 4.2]) B.cyl(W, 0.4, 0.45, 10, x, 57, 5.2, 8); for (let j = 0; j < 4; j++) B.win(0, 8 + j * 11, 5.26, 1.1, 4.5, { arch: true, mat: P.shadow, frame: false }); }
    });
    B.cyl(W, 4.6, 4.9, 4, 0, 70.2, CZ, 16); ovoid(B, W, 4.8, 8.5, 0, 74.2, CZ, 18, 2); lantern(0, 80.2, CZ, 0.7, 2.6);
  });
  m.collide.circle(0, -9.5, 13.6); m.collide.box(0, -27, 5.8, 5.8);
  return { height: 86 };
}

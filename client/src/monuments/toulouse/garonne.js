// Rive gauche de la Garonne : dôme de La Grave et son hôpital, Hôtel-Dieu Saint-Jacques, château d'eau (galerie photo).
import * as THREE from 'three';
import { P, domeLune, stairs } from '../kit.js';
import { bwing, brick, FL } from './tk.js';

const BR = P.brick, ST = P.pierre, TL = P.tile, CU = P.copper;

// ---------- Dôme de La Grave (chapelle Saint-Joseph) : +Z = vers la Garonne (NNE), l'hôpital s'étend vers +X (ouest) ----------
function buildLaGrave(m) {
  const { B } = m, A8 = Math.PI / 8;
  // corps octogonal de brique à chaînes de pierre, quatre avant-corps
  B.cyl(BR, 19.6, 19.6, 16 + 3, 0, -3, 0, 8, { exact: true, ry: A8 }); B.cyl(ST, 20, 20, 0.6, 0, 15.4, 0, 8, { exact: true, ry: A8, jit: 0 }); B.cyl(TL, 13.9, 19.9, 2.4, 0, 16, 0, 8, { exact: true, ry: A8, open: true });
  for (let k = 0; k < 8; k++) B.group(0, 0, 0, k * Math.PI / 4, () => {
    const ap = 19.6 * Math.cos(A8);
    if (k % 2 === 0) { B.box(BR, 11, 17, 2.4, 0, 0, ap + 0.9); B.gable(ST, TL, 11.6, 2.8, 2.8, 0, 17, ap + 0.9); B.win(0, 0, ap + 2.12, 3, 6, { arch: true, mat: P.bois, frameMat: ST, farMin: 0 }); B.add(new THREE.CircleGeometry(1.3, 14), P.vitrail, 0, 12, ap + 2.14, 0, { jit: 0 }); }
    else B.win(0, 5, ap + 0.02, 2.6, 7, { arch: true, mat: P.vitrail, frameMat: ST, farMin: 0 });
    if (B.hi) B.group(0, 0, 0, A8, () => B.box(ST, 1.1, 15.4, 0.6, 0, 0, 19.5, 0, { jit: 0.02 }));
  });
  // tambour : huit grandes baies cintrées, pilastres jumelés
  B.cyl(BR, 13.6, 13.6, 10.5, 0, 16.6, 0, 40); B.cyl(ST, 14.3, 14.1, 1.1, 0, 27.1, 0, 40, { jit: 0 }); B.cyl(ST, 14, 14, 0.5, 0, 17.6, 0, 40, { jit: 0 });
  for (let k = 0; k < 8; k++) B.group(0, 0, 0, k * Math.PI / 4, () => {
    B.win(0, 19.2, 13.62, 2.8, 5.6, { arch: true, mat: P.vitrail, frameMat: ST, farMin: 0, lit: 1 });
    if (B.hi) B.group(0, 0, 0, A8, () => { for (const x of [-0.9, 0.9]) B.box(ST, 0.8, 9.4, 0.5, x, 17.7, 13.5, 0, { jit: 0 }); });
  });
  // dôme de cuivre vert-de-gris, côtes, œils-de-bœuf, lanternon
  const DY = 28.2, R = 13.9, DH = 15.5;
  B.dome(CU, R, DH, 0, DY, 0, 48);
  for (let k = 0; k < 16; k++) B.add(domeLune(R * 1.006, DH * 1.004, k * Math.PI / 8 - 0.02, 0.04, 0.02, 0.95, B.far ? 4 : 9), P.verdigris, 0, DY, 0, 0, { uv: 'cyl', r: R });
  if (B.hi) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + A8, th = 0.36 * Math.PI / 2, rr = R * Math.cos(th); B.add(new THREE.SphereGeometry(1.1, 8, 6).scale(1, 1.2, 0.6), P.verdigris, Math.sin(a) * rr, DY + DH * Math.sin(th), Math.cos(a) * rr, a, { jit: 0 }); }
  B.cyl(CU, 3.3, 3.8, 1, 0, DY + DH - 0.5, 0, 16); B.cyl(P.shadow, 2.1, 2.1, 4.6, 0, DY + DH + 0.5, 0, 12);
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; B.cyl(CU, 0.28, 0.3, 4.6, Math.sin(a) * 2.5, DY + DH + 0.5, Math.cos(a) * 2.5, 6); }
  B.cyl(CU, 3.1, 2.9, 0.6, 0, DY + DH + 5.1, 0, 16); B.dome(CU, 2.7, 2.6, 0, DY + DH + 5.7, 0, 16); B.sphere(P.gold, 0.5, 0, DY + DH + 8.7, 0, 8); B.box(P.gold, 0.14, 2.2, 0.14, 0, DY + DH + 9, 0); B.box(P.gold, 1.1, 0.14, 0.14, 0, DY + DH + 10.4, 0);
  m.collide.circle(0, 0, 21);
  // ---- hôpital de La Grave : quadrillage d'ailes de brique autour de cinq cours, aile courbe sur la Garonne ----
  const W = brick({ dep: 13, floors: [{ h: 4.6, arch: true, w: 2, wh: 3, sill: 0.6 }, FL.etage, { h: 3.6, w: 1.5, wh: 2, sill: 0.9 }], bay: 4.4, roofH: 2.8 });
  bwing(m, 65, -61.5, 0, { ...W, len: 112 }); bwing(m, 70, -11.5, 0, { ...W, len: 100 }); bwing(m, 42, 28.5, 0, { ...W, len: 66 });
  bwing(m, 14, 0, Math.PI / 2, { ...W, len: 110, dep: 12 }); bwing(m, 65, -20, Math.PI / 2, { ...W, len: 70 }); bwing(m, 118.5, -36.5, Math.PI / 2, { ...W, len: 63 });
  bwing(m, 78, 42, Math.PI / 2, { ...W, len: 30 });
  bwing(m, -5, 62.5, 0, { ...W, len: 130, dep: 15, base: 8 });                                   // aile de la berge
  const arc = [[60, 62], [84, 58], [104, 49], [121, 38]];
  for (let i = 0; i < arc.length - 1; i++) { const [x0, z0] = arc[i], [x1, z1] = arc[i + 1]; bwing(m, (x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(-(z1 - z0), x1 - x0), { ...W, dep: 14, len: Math.hypot(x1 - x0, z1 - z0) + 1.5, base: 8 }); }
  return { height: 56 };
}

// ---------- Hôtel-Dieu Saint-Jacques : +Z = façade sur la Garonne ----------
function buildHotelDieu(m) {
  const { B } = m;
  const F = [{ h: 5.2, arch: true, w: 2.2, wh: 3.4, sill: 0.8 }, { h: 5, w: 1.8, wh: 3.2, sill: 1 }, { h: 4.6, w: 1.7, wh: 2.8, sill: 1 }, { h: 3.6, w: 1.5, wh: 1.8, sill: 0.9 }];
  const W = brick({ dep: 20, floors: F, bay: 4.3, roofH: 3.2, pil: true });
  // aile du fleuve (les pieds dans l'eau : soubassement de pierre et arches)
  bwing(m, -22, 41, 0, { ...W, len: 126, base: 10 });
  B.group(-22, 0, 51, 0, () => {
    B.box(ST, 127, 7, 1.2, 0, -8, 0.3);
    for (let i = 0; i < (B.far ? 0 : 14); i++) B.win(-58.5 + i * 9, -7.6, 0.92, 5, 3.4, { arch: true, mat: P.shadow, frame: false });
    // avant-corps central : fronton, lanternon d'ardoise
    B.box(BR, 18, 21.6, 1.4, 0, -1, 0.5); B.gable(ST, TL, 18.6, 4, 1.8, 0, 20.6, 0.5);
    if (B.hi) { for (const x of [-7.6, -2.6, 2.6, 7.6]) B.box(ST, 0.9, 19, 0.5, x, 0, 1.3, 0, { jit: 0.02 }); B.add(new THREE.CircleGeometry(1.2, 14), P.stoneW, 0, 22, 1.44, 0, { jit: 0 }); }
    B.cyl(P.ardoise, 2.4, 2.8, 2.6, 0, 22.4, -9.5, 8); B.dome(P.ardoise, 2.6, 2.2, 0, 25, -9.5, 8); B.cyl(P.gold, 0.05, 0.2, 2, 0, 27, -9.5, 4);
  });
  // ailes en retour et aile nord (cours intérieures)
  bwing(m, 22, -3, Math.PI / 2, { ...W, len: 66, dep: 24 }); bwing(m, -70, 8, Math.PI / 2, { ...W, len: 46, dep: 16 });
  bwing(m, 17, -38, 0, { ...W, len: 165, dep: 15, floors: F.slice(0, 3) });
  // vestige du pont de la Daurade : pile et départ d'arche en pierre
  B.box(ST, 9, 15, 11, -15, -9, 60.5); B.frustum(ST, 9, 11, 7.5, 9, 1.6, -15, 6, 60.5);
  B.add(new THREE.CylinderGeometry(9, 9, 8, B.n(10), 1, false, 0, Math.PI / 2).rotateZ(Math.PI / 2).rotateY(Math.PI), ST, -15, -3, 66, 0, { uv: 'cyl', r: 9 });
  return { height: 30 };
}

// ---------- Château d'eau (galerie photographique) : tour de brique ronde, galerie annulaire, lanternon ----------
function buildChateauDeau(m) {
  const { B } = m;
  B.cyl(BR, 9.5, 9.6, 6.4 + 3, 0, -3, 0, 32); B.cyl(ST, 9.8, 9.8, 0.45, 0, 6, 0, 32, { jit: 0 }); B.cyl(TL, 5.6, 9.8, 1.6, 0, 6.4, 0, 32, { open: true });
  const n = B.far ? 8 : 16;
  for (let i = 0; i < n; i++) B.group(0, 0, 0, i * Math.PI * 2 / n, () => B.win(0, 0.8, 9.56, 2.2, 3.4, { arch: true, mat: P.glassLit, frameMat: ST, lit: 1, farMin: 0 }));
  B.cyl(BR, 5.4, 5.6, 19, 0, 6.4, 0, 28); B.cyl(ST, 5.9, 5.7, 0.7, 0, 25.4, 0, 28, { jit: 0 }); B.cyl(ST, 5.65, 5.65, 0.35, 0, 15, 0, 28, { jit: 0 });
  for (let i = 0; i < 8; i++) B.group(0, 0, 0, i * Math.PI / 4, () => { B.win(0, 9, 5.5, 1.2, 3.6, { arch: true, mat: P.shadow, frameMat: ST, farMin: 0 }); B.win(0, 17.5, 5.44, 1.1, 5, { arch: true, mat: P.shadow, frameMat: ST, farMin: 0 }); });
  B.cyl(P.zinc, 0.9, 5.9, 3.4, 0, 26.1, 0, 28, { open: true }); B.cyl(BR, 1.2, 1.3, 2.4, 0, 29.3, 0, 10); B.dome(P.zinc, 1.4, 1.2, 0, 31.7, 0, 10); B.cyl(P.ironD, 0.04, 0.1, 1.8, 0, 32.8, 0, 4);
  m.collide.circle(0, 0, 9.8);
  return { height: 34 };
}

export const DEFS = { tls_lagrave: buildLaGrave, tls_hoteldieu: buildHotelDieu, tls_chateaudeau: buildChateauDeau };

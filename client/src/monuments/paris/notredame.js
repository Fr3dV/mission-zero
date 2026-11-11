// Notre-Dame de Paris : façade occidentale à deux tours (69 m), rosace, trois portails, nef, transept,
// arcs-boutants, chevet arrondi et flèche (96 m).
import * as THREE from 'three';
import { P, ogiveShape, rose } from '../kit.js';

export function buildNotreDame(m) {
  const { B } = m, S = P.stoneG, SL = P.stoneL, RF = P.slate;
  const ZF = 62, ZN = 48, ZA = -46, ZT = -8; // façade, début de nef, centre du chevet, transept
  // ---- nef, bas-côtés, chapelles ----
  const L = ZN - ZA, zc = (ZN + ZA) / 2;
  B.box(S, 13, 35, L, 0, -3, zc); B.gable(S, RF, 14, 10, L + 0.5, 0, 32, zc);
  B.box(S, 27, 22, L, 0, -3, zc); B.box(S, 39, 13.5, L, 0, -3, zc);
  for (const sx of [-1, 1]) {
    B.tris(RF, [sx * 6.5, 23.5, ZN, sx * 13.7, 19, ZN, sx * 13.7, 19, ZA, sx * 6.5, 23.5, ZN, sx * 13.7, 19, ZA, sx * 6.5, 23.5, ZA], 0, 0, 0, 0, { up: true });
    B.tris(RF, [sx * 13, 13, ZN, sx * 20, 10.5, ZN, sx * 20, 10.5, ZA, sx * 13, 13, ZN, sx * 20, 10.5, ZA, sx * 13, 13, ZA], 0, 0, 0, 0, { up: true });
  }
  // chevet : trois demi-cylindres étagés + toitures
  const half = (mat, r, h, y, open) => B.cyl(mat, r, r, h, 0, y, ZA, 20, { t0: Math.PI / 2, tl: Math.PI, open });
  half(S, 19.5, 13.5, -3); half(S, 13.5, 22, -3); half(S, 6.5, 35, -3);
  const roofHalf = (r0, r1, y0, y1) => B.add(new THREE.CylinderGeometry(r1, r0, y1 - y0, B.n(20), 1, true, Math.PI / 2, Math.PI).translate(0, (y1 - y0) / 2, 0), RF, 0, y0, ZA, 0, { uv: 'cyl', r: r0 });
  roofHalf(20, 13.5, 10.5, 13); roofHalf(13.7, 6.5, 19, 23.5); roofHalf(7, 0.1, 32, 42);
  // ---- transept ----
  B.box(S, 48, 35, 13, 0, -3, ZT); B.gable(S, RF, 14, 10, 48.5, 0, 32, ZT, Math.PI / 2);
  for (const ry of [Math.PI / 2, -Math.PI / 2]) B.group(0, 0, ZT, ry, () => {
    rose(B, 0, 21, 24, 5.6, SL);
    B.extrude(P.shadow, ogiveShape(4.2, 8), 0.3, 0, 0, 24); B.extrude(SL, ogiveShape(5.6, 9.2), 0.15, 0, 0, 24);
    for (const sx of [-1, 1]) { B.box(S, 2.2, 36, 1.6, sx * 7.4, 0, 24.3); B.frustum(RF, 2.2, 1.6, 0, 0, 5, sx * 7.4, 36, 24.3); }
    if (B.hi) B.winRow(-5.5, 5.5, 10.5, 24, 5, 1.1, 3.6, { arch: true, mat: P.vitrail, frame: false });
  });
  // ---- flèche ----
  B.cyl(P.slate, 2.3, 2.9, 8, 0, 41, ZT, 8); B.cyl(P.copper, 2.7, 2.7, 0.5, 0, 49, ZT, 8);
  B.cyl(P.slate, 0.12, 2.2, 45, 0, 49.5, ZT, 8); B.box(P.gold, 0.25, 1.6, 0.25, 0, 94.5, ZT);
  if (B.hi) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; B.statue(P.copper, Math.sin(a) * 3.4, 41.5, ZT + Math.cos(a) * 3.4, 2.4); }
  // ---- baies de la nef, arcs-boutants ----
  const bays = [];
  for (let z = ZN - 3.2; z > ZA; z -= 6.3) if (Math.abs(z - ZT) > 8.5) bays.push(z);
  for (const sx of [-1, 1]) B.group(0, 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => {
    // dans ce groupe : X local = -sx·Z monde, +Z local = extérieur
    for (const z of bays) {
      const x = -sx * z;
      B.win(x, 23.5, 6.5, 2.4, 5.5, { arch: true, mat: P.vitrail, frame: false, farMin: 0 });
      B.win(x, 14.5, 13.5, 2.2, 3.4, { arch: true, mat: P.vitrail, frame: false });
      B.win(x, 3.5, 19.5, 2.6, 5, { arch: true, mat: P.vitrail, frame: false });
    }
  });
  const flyer = (len, y0, y1, th) => { const s = new THREE.Shape(); s.moveTo(0, y0); s.lineTo(len, y1); s.lineTo(len, y1 - th); s.quadraticCurveTo(len * 0.45, y1 - th - (y1 - y0) * 0.75, 0, y0 - th * 2.6); s.closePath(); return s; };
  const buttress = (far2) => {
    // dans un groupe dont +X pointe vers l'extérieur ; culée à x = 20..23
    B.box(S, 3.2, 26, 1.3, 21.4, -3, 0); B.frustum(S, 3.2, 1.3, 3.2, 1.3, 0.01, 21.4, 23, 0);
    B.frustum(RF, 1.5, 1.3, 0, 0, 4.2, 22.2, 23, 0); B.box(S, 1.5, 3, 1.3, 22.2, 20, 0);
    B.extrude(S, flyer(13.4, 30, 22.5, 0.8), 0.7, 6.5, 0, -0.35);
    if (B.hi && !far2) B.extrude(S, flyer(6.6, 19.5, 14.5, 0.6), 0.6, 13.3, 0, -0.3);
  };
  for (const z of [...bays.map((z) => z + 3.15), bays[bays.length - 1] - 3.15]) {
    if (Math.abs(z - ZT) < 7) continue;
    B.group(0, 0, z, 0, () => buttress()); B.group(0, 0, z, Math.PI, () => buttress());
  }
  const na = B.far ? 5 : 9;
  for (let i = 0; i < na; i++) { const a = Math.PI * (i + 0.5) / na; B.group(0, 0, ZA, a, () => buttress(true)); } // +X local tourne de +X vers -Z
  // ---- massif occidental ----
  B.box(S, 41, 35, 14, 0, -3, 55);
  B.box(S, 15, 12, 2.5, 0, 31.5, 56);                                   // mur derrière la galerie centrale
  B.gable(S, RF, 14, 10, 1, 0, 32, 53.5);
  for (const sx of [-1, 1]) {
    const tx = sx * 13.6;
    B.box(S, 13.8, 37, 14, tx, 32, 55);                                  // tour
    B.box(SL, 14.6, 1.2, 14.8, tx, 67.8, 55); B.box(RF, 12.6, 0.4, 12.8, tx, 69, 55);
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) { B.box(S, 1.7, 37.5, 1.7, tx + cx * 6.5, 32, 55 + cz * 6.6); B.frustum(RF, 1.5, 1.5, 0, 0, 2.6, tx + cx * 6.5, 69.5, 55 + cz * 6.6); }
    // grandes baies géminées des tours (quatre faces)
    for (let k = 0; k < 4; k++) B.group(tx, 0, 55, k * Math.PI / 2, () => {
      for (const ox of [-2.6, 2.6]) { B.extrude(P.shadow, ogiveShape(2.9, 20), 0.2, ox, 45.5, 6.95); if (B.hi) B.extrude(SL, ogiveShape(3.7, 20.8), 0.1, ox, 45.3, 6.92); }
      if (B.hi) for (let j = 0; j < 9; j++) B.box(S, 7.8, 0.25, 0.3, 0, 47 + j * 1.6, 7.05, 0, { jit: 0 }); // abat-sons
    });
  }
  B.group(0, 0, ZF, 0, () => {
    // contreforts de façade
    for (const x of [-20.4, -6.8, 6.8, 20.4]) { B.box(S, 2.4, 46, 1.9, x, -3, 0.5); B.box(S, 2.0, 12, 1.4, x, 31, 0.3); }
    // portails
    for (const [x, w, h] of [[0, 7.2, 12.5], [-13.6, 6.2, 11], [13.6, 6.2, 11]]) {
      B.extrude(SL, ogiveShape(w + 3.4, h + 2.4), 0.25, x, 0, 0); B.extrude(P.deco, ogiveShape(w + 2.2, h + 1.6), 0.4, x, 0, 0);
      B.extrude(P.stoneD, ogiveShape(w + 1.0, h + 0.8), 0.5, x, 0, 0); B.extrude(P.shadow, ogiveShape(w, h), 0.6, x, 0, 0);
      if (B.hi) { B.box(P.bronze, w * 0.42, h * 0.52, 0.2, x - w * 0.23, 0, 0.55, 0, { jit: 0 }); B.box(P.bronze, w * 0.42, h * 0.52, 0.2, x + w * 0.23, 0, 0.55, 0, { jit: 0 }); B.box(SL, 0.5, h * 0.55, 0.5, x, 0, 0.7); B.lump(P.deco, x, h * 0.56, 0.6, w * 0.8, h * 0.25, 0.4, 6, x + 50); }
    }
    // galerie des rois
    B.box(P.stoneD, 41.6, 3.6, 0.5, 0, 15, 0); B.box(SL, 42, 0.5, 1, 0, 14.6, 0); B.box(SL, 42, 0.5, 1, 0, 18.6, 0);
    if (B.hi) for (let i = 0; i < 28; i++) { const x = -19.6 + i * 1.452; if (Math.abs(Math.abs(x) - 6.8) < 1.2 || Math.abs(x) > 19.3) continue; B.box(P.deco, 0.7, 2.7, 0.5, x, 15.4, 0.4, 0, { jit: 0.06 }); }
    // rosace ouest et baies géminées
    rose(B, 0, 25.5, 0, 4.8, SL, 12);
    if (B.hi) { B.statue(P.deco, 0, 19.2, 1, 2.6); B.statue(P.deco, -2.2, 19.2, 1, 2); B.statue(P.deco, 2.2, 19.2, 1, 2); }
    for (const sx of [-1, 1]) {
      B.extrude(SL, ogiveShape(9.6, 11), 0.15, sx * 13.6, 20, 0);
      for (const ox of [-2.1, 2.1]) B.extrude(P.shadow, ogiveShape(3.3, 8.6), 0.3, sx * 13.6 + ox, 20.4, 0);
      if (B.hi) B.add(new THREE.CircleGeometry(1.2, 12), P.shadow, sx * 13.6, 28.6, 0.2, 0, { jit: 0 });
    }
    B.box(SL, 42, 0.6, 1.1, 0, 31.6, 0);
    // galerie à jour (colonnettes)
    B.box(SL, 42, 0.8, 1.2, 0, 42.2, 0); B.box(P.shadow, 13.6 * 2 + 13, 9.2, 0.1, 0, 32.6, -0.05);
    const nc = B.far ? 0 : 38;
    for (let i = 0; i < nc; i++) { const x = -19.2 + i * 38.4 / (nc - 1); B.box(SL, 0.28, 8.4, 0.28, x, 32.8, 0.5, 0, { jit: 0 }); }
    B.box(SL, 42, 1.3, 0.4, 0, 43, 0.6);
  });
  // ---- collisions ----
  m.collide.box(0, (ZF + ZA) / 2 + 1, 23.2, (ZF - ZA) / 2 + 1);
  m.collide.box(0, ZT, 25, 7.3);
  m.collide.circle(0, ZA, 23.5);
  return { height: 96 };
}

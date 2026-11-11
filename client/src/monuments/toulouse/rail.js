// Quartier de la gare : gare Matabiau (façade de pierre aux blasons, grande halle) et médiathèque José-Cabanis (arche Marengo).
import * as THREE from 'three';
import { P, pavilion, arcadeShape } from '../kit.js';
import { bwing, brick, sheds } from './tk.js';

const mk = (hex, r = 0.6, g = 1) => { const c = new THREE.Color(hex); return { c: [c.r, c.g, c.b], r, m: 0, t: 0, g }; };

// ---------- Gare Matabiau : +Z = façade (ouest-sud-ouest, vers le canal du Midi) ----------
function buildMatabiau(m) {
  const { B } = m, S = P.pierre, ZF = 12, L = 163, X0 = -3.5;
  const F = [{ h: 7.5, arch: true, w: 3, wh: 5.6, sill: 0.4, lit: 0.8 }, { h: 5.2, w: 1.9, wh: 3.2, sill: 1, lit: 0.5 }];
  const W = { wall: S, dep: 20, floors: F, bay: 5.4, roof: 'mansard', roofH: 5, roofMat: P.ardoise, pil: true, frameMat: P.stoneL };
  // bâtiment des voyageurs : ailes, pavillon central à horloge, pavillons d'extrémité
  bwing(m, X0, ZF - 10, 0, { ...W, len: L });
  for (const [x, w, h] of [[X0, 30, 17], [X0 - L / 2 + 10, 20, 15], [X0 + L / 2 - 10, 20, 15]]) { pavilion(B, x, ZF - 10, 0, { w, d: 23, h, roofH: x === X0 ? 9 : 7, roofMat: P.ardoise, wall: S }); m.collide.box(x, ZF - 10, w / 2 + 0.7, 12.2); }
  B.group(X0, 0, ZF + 1.52, 0, () => {
    B.add(new THREE.CircleGeometry(1.7, 18), { ...P.stoneW, t: 0, g: 2 }, 0, 19.6, 0.4, 0, { jit: 0 }); B.add(new THREE.RingGeometry(1.65, 1.95, 18), P.ironD, 0, 19.6, 0.42, 0, { jit: 0 });
    // marquise de fer et de verre, blasons des villes desservies sur la frise
    B.box(P.metalD, L - 26, 0.25, 4.2, 0, 6.6, 2); B.box({ c: [0.34, 0.47, 0.53], r: 0.12, m: 0.4, t: 0, g: 2 }, L - 28, 0.08, 3.8, 0, 6.86, 2, 0, { jit: 0 });
    if (B.hi) {
      for (let i = 0; i < 20; i++) B.cyl(P.metalD, 0.09, 0.09, 6.6, -L / 2 + 16 + i * (L - 32) / 19, 0, 3.9, 5);
      const cols = [0xb3261c, 0x1f4fa3, 0xd9a520, 0x1e7a44, 0x7a1f6b];
      for (let i = 0; i < 26; i++) { const x = -L / 2 + 14 + i * (L - 28) / 25; if (Math.abs(x) < 15.5) continue; B.box(mk(cols[i % 5], 0.5, 0.9), 0.9, 1.1, 0.12, x, 11.4, -1.4, 0, { jit: 0.15 }); B.add(new THREE.CircleGeometry(0.45, 3, Math.PI, Math.PI), mk(cols[i % 5], 0.5, 0.9), x, 11.4, -1.34, 0, { jit: 0.15 }); }
    }
  });
  // aile basse nord (messageries) et grande halle des voyageurs (faîtages parallèles aux voies)
  bwing(m, -150, 0, 0, { ...W, len: 130, dep: 26, floors: [{ h: 7.5, arch: true, w: 3, wh: 5.4, sill: 0.4 }], roof: 'hip', roofH: 3, roofMat: P.zinc, pil: false });
  B.group(X0, 0, 0, Math.PI / 2, () => sheds({ ...m, collide: { box() {}, circle() {} } }, 10, 68, L / 2, -L / 2, 3, 11, 6, { walls: false }));
  m.collide.box(X0, -37, L / 2, 29.5);
  if (B.hi) for (let i = 0; i < 5; i++) B.box(P.metalD, 150, 0.3, 4.5, X0 - 60, 5, -76 - i * 11);                  // abris de quai
  return { height: 30 };
}

// ---------- Médiathèque José-Cabanis : l'arche Marengo (78 × 46 × 34 m), façades à brise-soleil de terre cuite ----------
function buildMediatheque(m) {
  const { B } = m, HWX = 36, HD = 21, H = 34, AW = 12.5, AH = 25;                                  // demi-largeur de l'arche, hauteur libre
  const terra = mk(0xa2573f, 0.85, 0.8), dark = mk(0x3b3f45, 0.6, 0.3);
  for (const sx of [-1, 1]) {
    const w = HWX - AW, cx = sx * (AW + w / 2);
    B.box(P.verre, w, H + 3, 2 * HD, cx, -3, 0, 0, { jit: 0 }); B.box(dark, w + 0.6, 4.6, 2 * HD + 0.6, cx, 0, 0);
    B.box(terra, w + 0.4, H - 4.6, 1.2, cx, 4.6, 0, 0, { jit: 0.02 }); B.box(terra, 1.4, H - 4.6, 2 * HD + 0.5, sx * (HWX - 0.5), 4.6, 0); B.box(terra, 1.4, H - 4.6, 2 * HD + 0.5, sx * (AW + 0.5), 4.6, 0);
    for (const sz of [-1, 1]) B.group(cx, 0, sz * HD, sz > 0 ? 0 : Math.PI, () => {
      if (B.hi) { for (let j = 0; j < 24; j++) B.box(terra, w - 2.6, 0.38, 0.7, 0, 5.4 + j * 1.18, 0.5, 0, { jit: 0.08 }); for (let i = 0; i <= 4; i++) B.box(dark, 0.3, H - 5, 0.5, -w / 2 + 1.4 + i * (w - 2.8) / 4, 4.8, 0.25, 0, { jit: 0 }); }
      else B.box(terra, w - 2.6, H - 6, 0.3, 0, 5.2, 0.3, 0, { jit: 0 });
      B.winRow(-w / 2 + 2, w / 2 - 2, 0.6, 0.32, 4, 4.4, 3.4, { mat: P.verreLit, frame: false, lit: 1, farMin: 0 });
    });
    B.group(sx * (HWX + 0.02), 0, 0, sx * Math.PI / 2, () => { for (let j = 0; j < 6; j++) B.winRow(-17, 17, 6.4 + j * 4.5, 0.22, 6, 3.4, 2.6, { mat: P.verreLit, frame: false, lit: 0.6, farMin: 1e9 }); });
    m.collide.box(cx, 0, w / 2 + 0.3, HD + 0.3);
  }
  // le linteau habité de l'arche, sa sous-face claire
  B.box(P.verre, 2 * AW, H - AH, 2 * HD, 0, AH, 0, 0, { jit: 0 }); B.box(P.blanc, 2 * AW, 0.5, 2 * HD + 0.4, 0, AH - 0.5, 0, 0, { jit: 0 }); B.box(terra, 2 * HWX + 0.8, 1.4, 2 * HD + 0.8, 0, H - 0.6, 0);
  for (const sz of [-1, 1]) B.group(0, 0, sz * HD, sz > 0 ? 0 : Math.PI, () => { if (B.hi) for (let j = 0; j < 7; j++) B.box(terra, 2 * AW, 0.38, 0.7, 0, AH + 0.5 + j * 1.18, 0.5, 0, { jit: 0.08 }); else B.box(terra, 2 * AW, H - AH - 1, 0.3, 0, AH + 0.4, 0.3, 0, { jit: 0 }); });
  m.collide.box(0, 0, AW, HD, 0, AH - 1);
  return { height: 36 };
}

export const DEFS = { tls_matabiau: buildMatabiau, tls_mediatheque: buildMediatheque };

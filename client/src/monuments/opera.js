// Opéra Garnier : façade à loggia (colonnes jumelées), attique doré, groupes dorés, dôme de cuivre vert-de-gris,
// cage de scène à fronton (Apollon), pavillons latéraux.
import * as THREE from 'three';
import { P, arcadeShape, stairs, domeLune } from './kit.js';

export function buildOpera(m) {
  const { B } = m, S = P.stone, CU = P.copper;
  const ZF = 58;
  // ---- façade principale ----
  B.box(S, 70, 33, 16.5, 0, -3, ZF - 9.75);                         // corps de la façade (derrière l'arcade)
  stairs(B, P.stoneL, 56, 5, 0.2, 0.45, 0, 0, ZF);
  const arches = []; for (let i = 0; i < 7; i++) arches.push({ x: -18 + i * 6, w: 4.2, h: 7.6 });
  B.extrude(S, arcadeShape(-35, 35, 9.6, arches), 1.5, 0, 0, ZF - 1.5);
  B.box(P.shadow, 44, 8, 0.1, 0, 0, ZF - 1.44);
  B.box(P.stoneL, 71, 0.7, 2.6, 0, 9.6, ZF - 0.9); B.box(P.deco, 70.6, 1.2, 0.5, 0, 10.3, ZF + 0.1);     // balcon de la loggia
  // loggia : fond en retrait, grandes baies éclairées, colonnes jumelées
  B.box(P.stoneD, 44, 12.4, 0.3, 0, 10.3, ZF - 1.45);
  for (let i = 0; i < 7; i++) {
    const x = -18 + i * 6;
    B.group(0, 0, ZF - 1.28, 0, () => B.win(x, 11, 0, 3, 7.2, { arch: true, lit: 1, farMin: 0, frameMat: P.deco }));
    if (B.hi) { B.sphere(P.gold, 0.55, x, 20.6, ZF - 1.1, 8, 1, 1, 0.5); B.box(P.granite, 0.5, 4.2, 0.5, x - 2.1, 11, ZF - 1, 0, { jit: 0 }); B.box(P.granite, 0.5, 4.2, 0.5, x + 2.1, 11, ZF - 1, 0, { jit: 0 }); B.statue(P.deco, x - 3, 1.2, ZF + 0.3, 2.6); }
  }
  for (let i = 0; i <= 7; i++) { const x = -21 + i * 6; B.column(x - 0.95, 10.4, ZF - 0.35, 0.8, 10.6, 'cor'); B.column(x + 0.95, 10.4, ZF - 0.35, 0.8, 10.6, 'cor'); }
  // pavillons d'extrémité (frontons cintrés)
  for (const sx of [-1, 1]) B.group(sx * 29.5, 0, ZF, 0, () => {
    B.box(S, 12, 31.5, 2.4, 0, -2, 0); B.win(0, 0, 1.2, 4, 7.4, { arch: true, mat: P.shadow, farMin: 0 }); B.win(0, 11.5, 1.2, 3.2, 6.4, { arch: true, lit: 1, farMin: 0 });
    B.column(-4.2, 10.4, 1.6, 0.8, 10.6, 'cor'); B.column(4.2, 10.4, 1.6, 0.8, 10.6, 'cor'); B.box(P.stoneL, 11, 0.8, 1.4, 0, 9.6, 1.6);
    B.gable(P.deco, P.zinc, 12.4, 3, 3, 0, 24.7, 0.4);
    B.box(S, 7, 6, 4, 0, 29.5, -1); B.lump(P.gold, 0, 35.5, -0.5, 5, 7, 3.4, 9, sx + 7);                 // L'Harmonie / La Poésie
  });
  // entablement et attique à masques dorés
  B.box(P.stoneL, 71, 1.1, 18, 0, 21, ZF - 9.2); B.box(S, 70.4, 1.6, 17.4, 0, 22.1, ZF - 9.4); B.box(P.stoneL, 72, 1, 19, 0, 23.7, ZF - 9.2);
  B.box(P.deco, 46, 5, 16, 0, 24.7, ZF - 9.6); B.box(P.gold, 46.4, 0.35, 16.4, 0, 29.7, ZF - 9.6, 0, { jit: 0 }); B.box(P.gold, 46.2, 0.2, 16.2, 0, 25, ZF - 9.6, 0, { jit: 0 });
  if (B.hi) for (let i = 0; i < 16; i++) { const x = -21.6 + i * 2.88; B.sphere(P.gold, 0.5, x, 30.4, ZF - 1.8, 6); B.box(P.gold, 1.6, 2.2, 0.15, x, 26.2, ZF - 1.55, 0, { jit: 0 }); }
  B.frustum(P.zinc, 68, 14, 60, 4, 3, 0, 24.7 + 5.2, ZF - 10);
  // ---- foyer / grand escalier ----
  B.box(S, 60, 31, 26, 0, -3, 27); B.box(P.stoneL, 61.4, 1, 27.4, 0, 27, 27); B.frustum(P.zinc, 60, 26, 44, 8, 5, 0, 28, 27);
  // ---- salle : tambour et dôme de cuivre ----
  const AZ = -4;
  B.box(S, 68, 29, 40, 0, -3, AZ); B.box(P.stoneL, 69.4, 1, 41.4, 0, 25, AZ); B.frustum(P.zinc, 68, 40, 50, 30, 4, 0, 26, AZ);
  B.cyl(S, 21.5, 21.5, 8, 0, 26, AZ, 48); B.cyl(P.stoneL, 22.6, 22.2, 1, 0, 34, AZ, 48);
  if (B.hi) for (let i = 0; i < 24; i++) B.group(0, 0, AZ, i * Math.PI / 12, () => B.win(0, 29.5, 21.52, 1.7, 2.6, { frame: false, lit: 0.6, arch: true }));
  B.dome(CU, 21.8, 10.5, 0, 35, AZ, 48);
  if (B.hi) for (let i = 0; i < 16; i++) B.add(domeLune(21.95, 10.62, i * Math.PI / 8 - 0.014, 0.028, 0.02, 0.96, 10), P.gold, 0, 35, AZ, 0, { uv: 'cyl', r: 20 });
  B.cyl(P.gold, 3.4, 3.9, 1.2, 0, 45, AZ, 16); B.cyl(CU, 2.6, 2.9, 2.6, 0, 46.2, AZ, 12); B.dome(CU, 2.9, 2, 0, 48.8, AZ, 12); B.cyl(P.gold, 0.1, 0.5, 2.6, 0, 50.6, AZ, 6);
  // ---- cage de scène : fronton tourné vers la place, Apollon, Pégases ----
  const SZ = -38;
  B.box(S, 54, 49, 24, 0, -3, SZ); B.box(P.stoneL, 55.6, 1.2, 25.6, 0, 46, SZ);
  B.gable(P.deco, CU, 55, 9.5, 25, 0, 47.2, SZ);
  B.lump(P.stoneL, 0, 47.6, SZ + 12.6, 30, 5, 0.6, 9, 2);
  B.box(P.deco, 3, 2, 3, 0, 56.2, SZ + 11); B.lump(P.gold, 0, 58.2, SZ + 11, 2.6, 6, 2.2, 6, 11);           // Apollon et sa lyre
  for (const sx of [-1, 1]) { B.box(P.deco, 3.4, 1.6, 3.4, sx * 25.6, 47.2, SZ + 11); B.lump(P.bronze, sx * 25.6, 48.8, SZ + 11, 3.4, 4.6, 3, 6, sx + 14); }
  for (const ry of [Math.PI / 2, -Math.PI / 2]) B.group(0, 0, SZ, ry, () => B.winRow(-10, 10, 30, 27.02, 4, 2.2, 8, { arch: true, mat: P.shadow }));
  B.group(0, 0, SZ + 12.02, 0, () => B.winRow(-24, 24, 30.5, 0, 7, 2.6, 7, { arch: true, mat: P.shadow }));
  // ---- pavillons latéraux (Empereur, Abonnés) ----
  for (const sx of [-1, 1]) {
    B.box(S, 12, 24, 20, sx * 38, -3, AZ);
    B.cyl(S, 9.6, 9.6, 23, sx * 43, -3, AZ, 28); B.cyl(P.stoneL, 10.2, 10, 0.9, sx * 43, 20, AZ, 28); B.dome(CU, 9.7, 5.6, sx * 43, 20.9, AZ, 28);
    B.cyl(P.gold, 0.9, 1.2, 1.4, sx * 43, 26.3, AZ, 8); B.lump(P.gold, sx * 43, 27.6, AZ, 1.6, 2.6, 1.6, 3, sx + 21);
    for (let i = 0; i < 7; i++) B.group(sx * 43, 0, AZ, sx * (Math.PI / 2 + (i - 3) * 0.42), () => { B.win(0, 9.5, 9.62, 2.2, 6, { arch: true, lit: 0.6 }); B.win(0, 1.5, 9.62, 2.2, 5, { arch: true, mat: P.shadow }); });
    m.collide.circle(sx * 43, AZ, 10);
    // façades latérales
    for (const [zc, len, xw] of [[27, 22, 30], [ZF - 9.75, 14, 35], [-24, 8, 34]]) B.group(sx * xw, 0, zc, sx * Math.PI / 2, () => { B.winRow(-len / 2, len / 2, 2, 0.02, Math.round(len / 4.5), 2.2, 5.5, { arch: true }); B.winRow(-len / 2, len / 2, 12, 0.02, Math.round(len / 4.5), 2.2, 7, { arch: true, lit: 0.6 }); });
  }
  // ---- administration (arrière) ----
  B.box(S, 62, 25, 14, 0, -3, -55); B.box(P.stoneL, 63.2, 0.9, 15.2, 0, 22, -55); B.frustum(P.zinc, 62, 14, 54, 5, 4.5, 0, 22.9, -55);
  B.group(0, 0, -62.02, Math.PI, () => { for (const y of [2, 8.5, 15]) B.winRow(-29, 29, y, 0, 13, 1.9, 4.2, { arch: y < 5 }); });
  for (const sx of [-1, 1]) B.group(sx * 31.02, 0, -55, sx * Math.PI / 2, () => { for (const y of [2, 8.5, 15]) B.winRow(-6, 6, y, 0, 3, 1.9, 4.2); });
  m.collide.box(0, 37.5, 35.6, 21.5); m.collide.box(0, AZ, 34.4, 20.4); m.collide.box(0, -44, 31.4, 18.6); m.collide.box(0, ZF + 1.2, 28.5, 1.4);
  return { height: 64 };
}

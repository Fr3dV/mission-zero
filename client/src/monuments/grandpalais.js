// Grand Palais : grande nef à verrière métallique (voûte en berceau + dôme central), façade à colonnade ionique,
// porche monumental, quadriges de bronze, nef transversale et palais d'Antin à l'arrière.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P } from './kit.js';

export function buildGrandPalais(m) {
  const { B, kit, far } = m, S = P.stone;
  const NZ = 48, HL = 108, HD = 26, WH = 19;              // centre de la nef, demi-longueur, demi-profondeur, hauteur des murs
  const ZF = NZ + HD;
  // ---- murs périphériques (anneau : l'intérieur est visible à travers la verrière) ----
  const wall = (w, d, x, z, h = WH) => { B.box(S, w, h + 3, d, x, -3, z); B.box(P.stoneL, w + 0.8, 1.1, d + 0.8, x, h, z); };
  wall(2 * HL, 3, 0, NZ - HD + 1.5); wall(3, 2 * HD, HL - 1.5, NZ); wall(3, 2 * HD, -HL + 1.5, NZ);
  wall(2 * HL, 3, 0, ZF - 4.5);                          // mur de fond de la colonnade
  B.box(P.pave, 2 * HL - 4, 0.3, 2 * HD - 4, 0, 0, NZ, 0, { jit: 0 });
  // ---- façade : soubassement, colonnade ionique, entablement, balustrade ----
  B.box(P.stoneD, 2 * HL, 3.4, 4, 0, 0, ZF - 1.8);
  B.box(P.stoneL, 2 * HL + 0.6, 1.2, 5, 0, 16.6, ZF - 1.8); B.box(S, 2 * HL, 1.6, 4.4, 0, 17.8, ZF - 1.8); B.box(P.stoneL, 2 * HL + 1.2, 0.9, 5.6, 0, 19.4, ZF - 1.8);
  if (B.hi) for (let i = 0; i < 80; i++) { const x = -HL + 1 + i * (2 * HL - 2) / 79; if (Math.abs(x) > 17) B.box(P.stoneL, 0.35, 1.2, 0.35, x, 20.3, ZF + 0.4, 0, { jit: 0 }); }
  B.box(P.stoneL, 2 * HL, 0.3, 0.6, 0, 21.5, ZF + 0.4);
  for (const sx of [-1, 1]) {
    B.colonnade(sx * 19.5, ZF - 0.6, sx * (HL - 16.5), ZF - 0.6, 19, 3.4, 0.85, 13.2, 'ion');
    B.group(0, 0, ZF - 3, 0, () => {
      B.winRow(sx * 17.5, sx * (HL - 14.5), 5, 0, 19, 2.4, 7, { arch: true, lit: 0.5, farMin: 0 });
      B.box({ ...P.copper, c: [0.32, 0.36, 0.4] }, HL - 32, 2, 0.15, sx * (HL + 3) / 2, 13.6, 0.05, 0, { jit: 0 });   // frise en mosaïque
      B.box(P.gold, HL - 32, 0.2, 0.18, sx * (HL + 3) / 2, 13.5, 0.06, 0, { jit: 0 });
    });
    // pavillons d'angle + quadriges de Récipon
    B.group(sx * (HL - 7), 0, ZF - 1, 0, () => {
      B.box(S, 15, 25, 7, 0, -2, 0); B.box(P.stoneL, 16, 1, 8, 0, 23, 0); B.win(0, 4, 3.5, 4.4, 10, { arch: true, lit: 0.7, farMin: 0 });
      for (const o of [-5.6, 5.6]) B.column(o, 3.4, 3.9, 0.85, 13.2, 'ion');
      B.box(P.stoneD, 9, 3, 6, 0, 24, 0); B.lump(P.verdigris, 0, 27, 0.5, 8, 6.5, 5, 10, sx + 4);
    });
  }
  // porche central : trois grandes baies entre colonnes jumelées
  B.group(0, 0, ZF, 0, () => {
    B.box(S, 34, 27, 9, 0, -2, -1.5); B.box(P.stoneL, 35.4, 1.2, 10.4, 0, 25, -1.5); B.box(S, 30, 3.2, 7, 0, 26.2, -1.5); B.box(P.stoneL, 31, 0.6, 8, 0, 29.4, -1.5);
    for (const x of [-9.4, 0, 9.4]) B.win(x, 0.5, 3, 5.6, 14.5, { arch: true, lit: 0.9, farMin: 0 });
    for (const x of [-14.6, -4.7, 4.7, 14.6]) { B.column(x - 1.15, 0.4, 4.2, 1.0, 19.4, 'ion'); B.column(x + 1.15, 0.4, 4.2, 1.0, 19.4, 'ion'); if (B.hi) B.lump(P.deco, x, 20.6, 4, 3, 3.6, 1.6, 4, x + 40); }
    B.box(P.stoneL, 33, 1.3, 2.8, 0, 19.8, 4);
    for (let i = 0; i < 7; i++) B.box(P.stoneL, 30 - i * 0.01, 0.2, 0.5, 0, i * 0.2, 5.6 + (6 - i) * 0.45 - 1.4, 0, { jit: 0.02 });
  });
  // façades latérales et arrière
  for (const sx of [-1, 1]) B.group(sx * HL, 0, NZ, sx * Math.PI / 2, () => B.winRow(-22, 22, 4.5, 0.02, 8, 2.6, 8.5, { arch: true, lit: 0.5 }));
  B.group(0, 0, NZ - HD, Math.PI, () => { B.winRow(24, HL - 4, 4.5, 0.02, 15, 2.6, 8.5, { arch: true, lit: 0.5 }); B.winRow(-HL + 4, -24, 4.5, 0.02, 15, 2.6, 8.5, { arch: true, lit: 0.5 }); });
  // ---- nef transversale et palais d'Antin ----
  const TZ0 = NZ - HD, TZ1 = -96, TL = TZ0 - TZ1, TZc = (TZ0 + TZ1) / 2;
  wall(3, TL, 21.5, TZc); wall(3, TL, -21.5, TZc); B.box(P.pave, 40, 0.3, TL, 0, 0, TZc, 0, { jit: 0 });
  for (const sx of [-1, 1]) B.group(sx * 23, 0, TZc, sx * Math.PI / 2, () => B.winRow(-TL / 2 + 2, TL / 2 - 2, 4.5, 0.02, 10, 2.6, 8.5, { arch: true, lit: 0.5 }));
  B.box(S, 149, 24, 52, 0, -3, -122); B.box(P.stoneL, 150.2, 1, 53.2, 0, 21, -122); B.frustum(P.zinc, 149, 52, 130, 30, 5, 0, 22, -122);
  B.group(0, 0, -148.02, Math.PI, () => { B.winRow(-70, 70, 4.5, 0, 22, 2.4, 9, { arch: true, lit: 0.4 }); for (const x of [-12, -8, 8, 12]) B.column(x, 0.5, 1.2, 0.8, 16, 'ion'); B.win(0, 0, 0.3, 5, 11, { arch: true, mat: P.shadow, farMin: 0 }); });
  B.cyl(S, 13, 13, 7, 0, 21, -122, 24); B.dome(P.zinc, 13.2, 8, 0, 28, -122, 24);
  for (const sx of [-1, 1]) B.group(sx * 74.52, 0, -122, sx * Math.PI / 2, () => B.winRow(-22, 22, 4.5, 0, 7, 2.4, 9, { arch: true, lit: 0.4 }));
  // ---- verrière : berceau longitudinal, culs-de-four, berceau transversal, dôme, lanterne ----
  const parts = [], RISE = 16, RZ = HD - 3.2, GY = WH + 0.6;
  const barrel = (len, rad, rise, ru, rv) => {
    const g = new THREE.CylinderGeometry(rad, rad, len, far ? 10 : 20, 1, true, 0, Math.PI);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
    g.rotateZ(Math.PI / 2); g.scale(1, rise / rad, 1); return g;          // axe le long de X, bombé vers +Y
  };
  const cap = (rad, rise, sign) => {
    const g = new THREE.SphereGeometry(rad, far ? 6 : 12, far ? 5 : 10, 0, Math.PI, 0, Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 12, uv.getY(i) * 12);
    g.rotateY(sign * Math.PI / 2); g.scale(0.8, rise / rad, 1); return g;
  };
  const LB = HL - 3.4 - RZ * 0.8;
  parts.push(barrel(2 * LB, RZ, RISE, 12, Math.round(2 * LB / 4)).translate(0, GY, NZ));
  parts.push(cap(RZ, RISE, 1).translate(LB, GY, NZ), cap(RZ, RISE, -1).translate(-LB, GY, NZ));
  parts.push(barrel(TL + 6, 20, 14.5, 10, Math.round(TL / 4)).rotateY(Math.PI / 2).translate(0, GY, TZc + 3));
  const dome = new THREE.SphereGeometry(27, far ? 12 : 28, far ? 5 : 10, 0, Math.PI * 2, 0, Math.PI / 2);
  { const uv = dome.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 40, uv.getY(i) * 14); }
  dome.scale(1, 15 / 27, 0.9); parts.push(dome.translate(0, GY + 10.5, NZ));
  const drum = new THREE.CylinderGeometry(27, 27, 4.5, far ? 12 : 28, 1, true);
  { const uv = drum.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 40, uv.getY(i) * 1); }
  drum.scale(1, 1, 0.9); parts.push(drum.translate(0, GY + 8.25, NZ));
  const glass = new THREE.Mesh(mergeGeometries(parts), kit.glassPalais); glass.name = 'grandpalais:verriere'; glass.renderOrder = 2; glass.castShadow = !far; m.add(glass);
  m.onUpdate((dt, st) => { kit.glassPalais.emissiveIntensity = st.night * 0.5; });
  // ceinture métallique, lanterne et mât
  B.add(new THREE.TorusGeometry(27, 0.5, 6, B.n(40)).rotateX(Math.PI / 2).scale(1, 1, 0.9), P.steel, 0, GY + 10.5, NZ);
  B.cyl(P.steel, 3.2, 3.6, 1.2, 0, GY + 25, NZ, 12); B.cyl(P.glassLit, 2.4, 2.4, 3.2, 0, GY + 26.2, NZ, 12, { jit: 0 }); B.dome(P.steel, 2.9, 2.4, 0, GY + 29.4, NZ, 12);
  B.cyl(P.steel, 0.08, 0.16, 12, 0, GY + 31.6, NZ, 6);
  if (B.hi) { // drapeau tricolore
    B.box({ ...P.glass, c: [0.02, 0.1, 0.45], r: 0.8, g: 0.3 }, 1.4, 2.6, 0.05, 0.75, GY + 40.6, NZ, 0, { jit: 0 }); B.box({ ...P.stoneW, t: 0, g: 0.3 }, 1.4, 2.6, 0.05, 2.15, GY + 40.6, NZ, 0, { jit: 0 }); B.box({ ...P.glass, c: [0.6, 0.03, 0.04], r: 0.8, g: 0.3 }, 1.4, 2.6, 0.05, 3.55, GY + 40.6, NZ, 0, { jit: 0 });
    // fermes métalliques apparentes sous la verrière
    for (let i = -8; i <= 8; i++) if (Math.abs(i) > 2) B.add(new THREE.TorusGeometry(RZ - 0.4, 0.28, 5, 20, Math.PI).scale(1, RISE / RZ, 1), P.steel, i * (LB / 8.5), GY, NZ, Math.PI / 2);
  }
  m.collide.box(0, NZ, HL + 0.4, HD + 0.6); m.collide.box(0, ZF + 3.2, 17.4, 3.4); m.collide.box(0, TZc, 23.4, TL / 2); m.collide.box(0, -122, 74.9, 26.4);
  return { height: 64 };
}

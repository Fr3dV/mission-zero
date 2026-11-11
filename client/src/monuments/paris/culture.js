// Musées et grands magasins : Centre Pompidou, musée d'Orsay, Petit Palais, Galeries Lafayette, Printemps, quai Branly.
import * as THREE from 'three';
import { P, mat, wing, court, pavilion, stairs, arcadeShape, domeLune, ovoid } from '../kit.js';

const clock = (B, x, y, z, r) => { B.add(new THREE.CircleGeometry(r, 24), { ...P.stoneW, t: 0, g: 2 }, x, y, z, 0, { jit: 0 }); B.add(new THREE.RingGeometry(r * 0.88, r * 1.08, 24), P.ironD, x, y, z + 0.03, 0, { jit: 0 }); B.box(P.ironD, r * 0.08, r * 0.75, 0.05, x, y, z + 0.05, 0, { jit: 0 }); B.add(new THREE.BoxGeometry(r * 0.08, r * 0.5, 0.05).translate(0, r * 0.25, 0).rotateZ(-1.9), P.ironD, x, y, z + 0.05, 0, { jit: 0 }); };

// ---------- Centre Pompidou (166 × 60 × 42 m) ----------
function buildPompidou(m) {
  const { B } = m, HX = 83, HZ = 24, H = 42, NB = 13, bay = 2 * HX / NB, FL = 7;
  const white = mat(0xe6e6e2, 0.5, 0.3, 0, 0.8), blue = mat(0x2468b4, 0.5, 0.2, 0, 0.9), green = mat(0x2a9450, 0.5, 0.2, 0, 0.9), red = mat(0xc9352b, 0.5, 0.2, 0, 1.2), yellow = mat(0xe6bd27, 0.5, 0.2, 0, 0.9);
  const glassB = mat(0x33495a, 0.12, 0.35, 0, 0), tube = mat(0xb9c9d2, 0.1, 0.3, 0, 2);
  // volume vitré et planchers
  B.box(glassB, 2 * HX, H, 2 * HZ, 0, 0, 0, 0, { jit: 0 });
  for (let f = 1; f <= 6; f++) B.box(white, 2 * HX + 0.6, 0.7, 2 * HZ + 0.6, 0, f * FL - 0.35, 0, 0, { jit: 0 });
  if (B.hi) for (const sz of [-1, 1]) for (let f = 0; f < 6; f++) B.group(0, 0, sz * HZ, sz > 0 ? 0 : Math.PI, () => B.winRow(-HX, HX, f * FL + 1.2, 0.04, 26, 5.2, 4.6, { frame: false, lit: 0.45 }));
  // exosquelette : poteaux, gerberettes, tirants en croix
  const diag = (x0, y0, x1, y1, z, t) => { const len = Math.hypot(x1 - x0, y1 - y0); B.add(new THREE.BoxGeometry(len, t, t).rotateZ(Math.atan2(y1 - y0, x1 - x0)), white, (x0 + x1) / 2, (y0 + y1) / 2, z, 0, { jit: 0 }); };
  for (const sz of [-1, 1]) {
    const zo = sz * (HZ + 6.2);
    for (let i = 0; i <= NB; i++) {
      const x = -HX + i * bay;
      B.cyl(white, 0.45, 0.45, H + 1, x, 0, sz * (HZ + 0.8), 8); B.cyl(white, 0.16, 0.16, H, x, 0, zo, 6);
      if (B.hi) for (let f = 1; f <= 6; f++) B.box(white, 0.4, 0.7, 7.6, x, f * FL - 0.5, sz * (HZ + 3), 0, { jit: 0 });
      m.collide.circle(x, zo, 0.4, -10, 6);
    }
    if (B.hi) for (let i = 0; i < NB; i++) for (let f = 0; f < 6; f++) { const x0 = -HX + i * bay; diag(x0, f * FL, x0 + bay, (f + 1) * FL, zo, 0.13); diag(x0 + bay, f * FL, x0, (f + 1) * FL, zo, 0.13); }
    for (let f = 1; f <= 6; f++) B.box(white, 2 * HX, 0.22, 0.22, 0, f * FL, zo, 0, { jit: 0 });
  }
  // façade ouest (piazza) : escalator « chenille » en tube vitré, coursives
  const ZT = HZ + 7.6;
  for (let f = 0; f < 6; f++) {
    const x0 = -74 + f * 24.6, y0 = FL * f + 1.2, x1 = x0 + 18.5, y1 = y0 + FL, len = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
    if (f < 5) {
      B.add(new THREE.CylinderGeometry(1.75, 1.75, len, B.n(12), 1, true).rotateZ(a - Math.PI / 2), tube, (x0 + x1) / 2, (y0 + y1) / 2 + 1.6, ZT, 0, { jit: 0 });
      B.add(new THREE.BoxGeometry(len, 0.5, 2.6).rotateZ(a), red, (x0 + x1) / 2, (y0 + y1) / 2 - 0.1, ZT, 0, { jit: 0 });
      B.add(new THREE.CylinderGeometry(1.75, 1.75, 6.3, B.n(12), 1, true).rotateZ(Math.PI / 2), tube, x1 + 3.05, y1 + 1.6, ZT, 0, { jit: 0 }); B.box(red, 6.3, 0.5, 2.6, x1 + 3.05, y1 - 0.35, ZT, 0, { jit: 0 });
    }
    if (B.hi) B.add(new THREE.CylinderGeometry(1.3, 1.3, 2 * HX, 10, 1, true).rotateZ(Math.PI / 2), { ...tube, g: 0.4 }, 0, FL * (f + 1) - 4.6, HZ + 4.4, 0, { jit: 0 });
  }
  B.add(new THREE.CylinderGeometry(1.75, 1.75, 2 * HX - 100, 10, 1, true).rotateZ(Math.PI / 2), tube, 50, H - 3.4, ZT, 0, { jit: 0 });
  // façade est (rue du Renard) : gaines colorées — bleu = air, vert = eau, jaune = électricité, rouge = circulations
  const cols = [blue, blue, green, blue, yellow, red, blue, green, blue, blue, yellow, blue, red];
  for (let i = 0; i < NB; i++) {
    const x0 = -HX + i * bay, c = cols[i % cols.length], ZE = -(HZ + 3.2);
    B.cyl(c, 1.05, 1.05, H + (i % 3) * 1.5, x0 + bay * 0.3, 0, ZE, 10); B.cyl(blue, 0.7, 0.7, H + 2, x0 + bay * 0.62, 0, ZE - 0.6, 8);
    if (B.hi) { B.cyl(green, 0.32, 0.32, H, x0 + bay * 0.82, 0, ZE + 0.6, 6); B.cyl(yellow, 0.22, 0.22, H - 3, x0 + bay * 0.12, 0, ZE + 0.8, 6); B.add(new THREE.CylinderGeometry(0.7, 0.7, 4.5, 8).rotateX(Math.PI / 2), c, x0 + bay * 0.3, H + (i % 3) * 1.5, ZE + 2.2, 0, { jit: 0 }); }
    if (i % 4 === 1) { B.box(red, 3.4, H - 4, 3, x0 + bay * 0.5, 0, ZE - 2.6); B.box(red, 4, 4, 4, x0 + bay * 0.5, H - 3, ZE - 2.6); }
  }
  // toiture technique et manches à air blanches de la piazza
  for (let i = 0; i < 6; i++) { B.box(blue, 16, 3.2, 9, -66 + i * 26, H, -9, 0, { jit: 0.1 }); B.box(white, 10, 2, 7, -60 + i * 26, H, 8); }
  for (const x of [-70, -35, 35, 70]) { B.cyl(white, 1.3, 1.3, 5.5, x, 0, HZ + 34, 10); B.add(new THREE.CylinderGeometry(1.7, 1.3, 3, 10).rotateX(1.1), white, x, 6.2, HZ + 34.8); m.collide.circle(x, HZ + 34, 1.5, -10, 8); }
  m.collide.box(0, 0, HX + 0.4, HZ + 1.4); m.collide.box(0, -(HZ + 4), HX, 2.6);
  return { height: 48 };
}

// ---------- Musée d'Orsay (ancienne gare, 175 × 75 m) : sept arcades vitrées sur la Seine, deux horloges, grande nef ----------
function buildOrsay(m) {
  const { B } = m, S = P.stone, ZF = 37, HX = 87;
  // façade Seine : sept grandes arcades entre deux pavillons
  const arches = []; for (let i = 0; i < 7; i++) arches.push({ x: -51 + i * 17, w: 12.4, h: 20 });
  B.extrude(S, arcadeShape(-60, 60, 25, arches), 3, 0, 0, ZF - 3);
  B.box(P.stoneL, 121, 1.2, 4.2, 0, 25, ZF - 1.5); B.box(S, 120, 3, 3, 0, 26.2, ZF - 1.5); B.box(P.stoneL, 121, 0.6, 3.6, 0, 29.2, ZF - 1.5);
  for (const a of arches) { B.group(a.x, 0, ZF - 2.6, 0, () => B.win(0, 0.4, 0, 12.2, 13.4, { arch: true, mat: mat(0x2c3b46, 0.12, 0.3, 0, 2), frame: false, farMin: 0 })); if (B.hi) { for (let k = 1; k < 4; k++) B.box(P.steel, 0.25, 19, 0.2, a.x - 6.2 + k * 3.1, 0.4, ZF - 2.3, 0, { jit: 0 }); B.box(P.steel, 12.4, 0.3, 0.2, a.x, 8, ZF - 2.3, 0, { jit: 0 }); B.lump(P.deco, a.x + 8.5, 21, ZF + 0.2, 3, 3.4, 0.8, 2, a.x); } }
  for (const x of [-25.5, 0, 25.5]) { B.box(S, 4, 4, 3, x, 29.8, ZF - 1.5); B.statue(P.deco, x, 33.8, ZF - 1.5, 5.5); }      // Bordeaux, Toulouse, Nantes
  for (const sx of [-1, 1]) B.group(sx * 73.5, 0, ZF - 9, 0, () => {
    B.box(S, 27, 36, 20, 0, -2, 0); B.box(P.stoneL, 28.2, 1.1, 21.2, 0, 34, 0);
    B.frustum(P.slate, 27, 20, 15, 9, 9, 0, 35, 0); B.frustum(P.slate, 15, 9, 9, 4, 2.6, 0, 44, 0); B.box(P.lead, 9.4, 0.7, 4.4, 0, 46.6, 0);
    clock(B, 0, 26, 10.06, 4.6); B.win(0, 1, 10.02, 6, 13, { arch: true, mat: P.shadow, farMin: 0 });
    for (const x of [-9.5, 9.5]) { B.win(x, 2, 10.02, 2.6, 6); B.win(x, 12, 10.02, 2.4, 6); B.win(x, 23, 10.02, 2.2, 4); }
    B.group(sx * 13.52, 0, 0, sx * Math.PI / 2, () => { B.win(0, 1, 0, 6, 13, { arch: true, farMin: 0 }); B.win(0, 23, 0, 3, 5, { arch: true }); });
  });
  // grande nef : voûte en berceau (zinc et verrière zénithale), corps arrière sur la rue de Lille (ancien hôtel)
  B.box(S, 2 * HX - 54, 24, 46, 0, -2, 4);
  B.add(new THREE.CylinderGeometry(21, 21, 2 * HX - 54, B.n(20), 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.52, 1), P.zinc, 0, 22, 6, 0, { uv: 'cyl', r: 20 });
  B.add(new THREE.CylinderGeometry(21.15, 21.15, 2 * HX - 62, B.n(12), 1, true, Math.PI / 2 - 0.45, 0.9).rotateZ(Math.PI / 2).scale(1, 0.52, 1), mat(0x8fb0bd, 0.1, 0.4, 0, 2), 0, 22, 6, 0, { uv: 'cyl', r: 20, jit: 0 });
  wing(m, 0, -27, 0, { len: 2 * HX, dep: 20, floors: [{ h: 7, arch: true, w: 2.6, wh: 4.6 }, { h: 5.5, w: 2, wh: 3.6 }, { h: 5.5, w: 2, wh: 3.6 }, { h: 5, w: 1.9, wh: 3 }, { h: 4.5, w: 1.8, wh: 2.6 }], bay: 4.7, roof: 'mansard', roofH: 7, roofMat: P.slate });
  // parvis ouest : marquise d'entrée
  B.group(HX, 0, 4, -Math.PI / 2, () => { B.box(S, 46, 24, 4, 0, 0, -2); for (const x of [-15, -5, 5, 15]) B.win(x, 0.4, 0.02, 7, 12, { arch: true, lit: 0.7, farMin: 0 }); B.box(P.steel, 44, 0.4, 7, 0, 7, 3.5); B.box(mat(0x8fb0bd, 0.1, 0.4, 0, 2), 43, 0.1, 6.4, 0, 7.4, 3.5, 0, { jit: 0 }); });
  m.collide.box(0, 4, HX + 0.4, ZF - 3.6);
  return { height: 50 };
}

// ---------- Petit Palais : porche à grand arc et dôme, colonnade ionique, pavillons d'angle ----------
function buildPetitPalais(m) {
  const { B } = m, S = P.stone, ZF = 38;
  const F = [{ h: 5, w: 2, wh: 2.4, sill: 1.6 }, { h: 10, arch: true, w: 2.8, wh: 6.4, sill: 1.2, lit: 0.5 }];
  // ailes de façade à colonnade
  for (const sx of [-1, 1]) {
    wing(m, sx * 33, ZF - 9, 0, { len: 38, dep: 18, floors: F, bay: 4.2, roof: 'flat' });
    B.colonnade(sx * 16, ZF + 1.2, sx * 50, ZF + 1.2, 9, 5, 0.6, 9.4, 'ion'); B.box(P.stoneD, 38, 5, 3, sx * 33, 0, ZF + 0.8); B.box(P.stoneL, 39, 1.2, 3.4, sx * 33, 14.4, ZF + 0.8);
    if (B.hi) for (let i = 0; i < 16; i++) B.box(P.stoneL, 0.3, 1, 0.3, sx * (15 + i * 2.4), 16.4, ZF + 1.6, 0, { jit: 0 });
    // pavillons d'angle à petit dôme
    B.group(sx * 59, 0, ZF - 8, 0, () => { B.box(S, 16, 19, 22, 0, -2, 0); B.box(P.stoneL, 17, 0.9, 23, 0, 17, 0); B.dome(P.slate, 7.4, 6, 0, 17.9, 0, 20); B.cyl(P.gold, 0.1, 0.4, 2.4, 0, 23.8, 0, 6); B.win(0, 5.5, 11.02, 4.4, 7.4, { arch: true, lit: 0.7, farMin: 0 }); for (const x of [-5.6, 5.6]) B.column(x, 5, 11.6, 0.6, 9.4, 'ion'); B.group(sx * 8.02, 0, 0, sx * Math.PI / 2, () => B.win(0, 5.5, 0, 4.4, 7.4, { arch: true, lit: 0.7 })); });
    m.collide.box(sx * 59, ZF - 8, 8.3, 11.3);
    // ailes latérales convergentes (plan en trapèze) et galerie arrière
    const x0 = sx * 60, z0 = ZF - 19, x1 = sx * 40, z1 = -52, len = Math.hypot(x1 - x0, z1 - z0);
    wing(m, (x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(-(z1 - z0), x1 - x0), { len, dep: 16, floors: F, bay: 4.4, roof: 'flat' });
  }
  wing(m, 0, -56, 0, { len: 84, dep: 16, floors: F, bay: 4.4, roof: 'flat' });
  // porche central : escalier, grand arc à grille dorée, dôme
  B.group(0, 0, ZF - 6, 0, () => {
    B.box(S, 26, 24, 24, 0, -2, 0); B.box(P.stoneL, 27.2, 1, 25.2, 0, 22, 0);
    const ring = new THREE.Shape(); ring.absarc(0, 0, 8.4, 0, Math.PI, false); ring.lineTo(-6.4, 0); ring.absarc(0, 0, 6.4, Math.PI, 0, true); ring.closePath();
    B.extrude(P.deco, ring, 1, 0, 11.5, 12); B.box(P.deco, 2, 11.5, 1, -7.4, 0, 12.5); B.box(P.deco, 2, 11.5, 1, 7.4, 0, 12.5);
    B.box(P.shadow, 12.8, 11.5, 0.2, 0, 0, 12.1, 0, { jit: 0 }); B.add(new THREE.CircleGeometry(6.4, 20, 0, Math.PI), P.shadow, 0, 11.5, 12.2, 0, { jit: 0 });
    B.box(P.gold, 9, 8.6, 0.12, 0, 4.2, 12.36, 0, { jit: 0 }); B.add(new THREE.CircleGeometry(4.5, 16, 0, Math.PI), P.gold, 0, 12.8, 12.36, 0, { jit: 0 }); B.box(P.shadow, 4.4, 4.2, 0.2, 0, 4.2 - 4.2, 12.4, 0, { jit: 0 });
    for (const x of [-11, -9, 9, 11]) B.column(x, 4.4, 13, 0.6, 10.4, 'ion'); B.lump(P.deco, 0, 20.2, 12.6, 9, 3.6, 0.9, 5, 2);
    stairs(B, P.stoneL, 15, 20, 0.21, 0.4, 0, 0, 13.6); for (const x of [-9.5, 9.5]) { B.box(S, 3.6, 4.6, 6, x, 0, 16); B.lump(P.deco, x, 4.6, 16, 2.6, 3.4, 4, 3, x); }
    B.cyl(S, 11, 11.4, 5, 0, 23, 0, 28); B.cyl(P.stoneL, 11.8, 11.6, 0.8, 0, 28, 0, 28); B.dome(P.slate, 11.2, 10.5, 0, 28.8, 0, 32);
    for (let i = 0; i < 8; i++) B.group(0, 0, 0, i * Math.PI / 4 + Math.PI / 8, () => B.win(0, 24, 11.22, 1.8, 2.8, { arch: true, frame: false, farMin: 0 }));
    B.cyl(P.gold, 2, 2.4, 0.8, 0, 39.1, 0, 10); B.cyl(P.slate, 1.5, 1.6, 2.6, 0, 39.9, 0, 8); B.dome(P.slate, 1.7, 1.6, 0, 42.5, 0, 8); B.cyl(P.gold, 0.05, 0.2, 2.4, 0, 44, 0, 5);
  });
  m.collide.box(0, ZF - 6, 13.4, 12.4); m.collide.box(0, ZF + 10, 11.6, 4.4);
  return { height: 47 };
}

// ---------- Galeries Lafayette (coupole) et Printemps (rotondes) ----------
const STORE = [{ h: 6.5, w: 3.4, wh: 4.4, sill: 0.8, lit: 0.95 }, { h: 4.6, w: 2.6, wh: 3, lit: 0.7 }, { h: 4.6, w: 2.6, wh: 3, lit: 0.7 }, { h: 4.6, w: 2.6, wh: 3, lit: 0.6 }, { h: 4.2, w: 2.2, wh: 2.6, lit: 0.5 }];
function buildLafayette(m) {
  const { B } = m, W = 72, D = 76;
  court(m, 0, 0, W, D, { dep: 16, floors: STORE, bay: 4.6, roof: 'mansard', roofH: 5.5, roofMat: P.zinc, pil: true });
  B.box(P.stone, W - 30, 27, D - 30, 0, 0, 0); B.box(P.zinc, W - 28, 0.6, D - 28, 0, 27, 0);
  // grande coupole néo-byzantine (33 m de diamètre) et terrasse
  B.cyl(P.stone, 17.5, 17.5, 4, 0, 27.4, 0, 40); B.cyl(mat(0xd9a441, 0.4, 0.2, 0, 2), 16.8, 16.8, 2.4, 0, 31.4, 0, 40, { jit: 0 }); B.cyl(P.stoneL, 17.6, 17.4, 0.6, 0, 33.8, 0, 40);
  B.dome(mat(0x7f8f8a, 0.25, 0.5, 0, 0.9), 16.6, 12, 0, 34.4, 0, 40);
  for (let i = 0; i < 10; i++) B.add(domeLune(16.75, 12.1, i * Math.PI / 5 - 0.03, 0.06, 0.02, 0.96, B.far ? 4 : 9), P.gold, 0, 34.4, 0, 0, { uv: 'cyl', r: 16 });
  for (let i = 0; i < 10; i++) B.add(domeLune(16.7, 12.06, i * Math.PI / 5 + 0.12, Math.PI / 5 - 0.24, 0.1, 0.62, B.far ? 3 : 7), mat(0x5a7fa0, 0.15, 0.3, 0, 2), 0, 34.4, 0, 0, { uv: 'cyl', r: 16, jit: 0.2 });
  B.cyl(P.gold, 2.2, 2.6, 1, 0, 46.2, 0, 10); B.cyl(P.zinc, 1.6, 1.7, 3, 0, 47.2, 0, 8); B.dome(P.gold, 1.8, 2, 0, 50.2, 0, 8);
  // rotondes d'angle sur le boulevard, marquises rouges, enseigne
  for (const sx of [-1, 1]) { B.cyl(P.stone, 6.5, 6.5, 29, sx * (W / 2 - 3), 0, D / 2 - 3, 20); B.dome(P.zinc, 6.7, 6, sx * (W / 2 - 3), 29, D / 2 - 3, 20); B.cyl(P.gold, 0.08, 0.5, 3, sx * (W / 2 - 3), 35, D / 2 - 3, 6); m.collide.circle(sx * (W / 2 - 3), D / 2 - 3, 6.8); }
  B.box(mat(0xa8281e, 0.6, 0, 0, 1.2), W - 16, 0.5, 2.6, 0, 5.4, D / 2 + 1.3, 0, { jit: 0 }); B.box(mat(0xfff0c8, 0.5, 0, 0, 2), 26, 1.8, 0.3, 0, 26.4, D / 2 + 0.3, 0, { jit: 0 });
  return { height: 54 };
}
function buildPrintemps(m) {
  const { B } = m, W = 66, D = 28;
  court(m, 0, 0, W, D, { dep: 14, floors: STORE, bay: 4.4, roof: 'mansard', roofH: 5.5, roofMat: P.slate, pil: true });
  B.box(P.stone, W - 26, 27, D - 26, 0, 0, 0); B.dome(mat(0x6f8fa8, 0.15, 0.4, 0, 2), 7, 4.5, 0, 27, 0, 24, { jit: 0 }); B.cyl(P.zinc, 7.4, 7.4, 0.8, 0, 26.6, 0, 24);
  // quatre rotondes d'angle à dômes d'ardoise et d'or
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (W / 2 - 2.5), z = sz * (D / 2 - 2.5);
    B.cyl(P.stone, 6, 6, 31, x, 0, z, 20); B.cyl(P.stoneL, 6.6, 6.4, 0.8, x, 31, z, 20); B.cyl(P.gold, 6.2, 6.2, 0.35, x, 25, z, 20, { jit: 0 });
    ovoid(B, P.slate, 6.1, 9.5, x, 31.8, z, 20, 2.6);
    for (let i = 0; i < 8; i++) B.add(domeLune(6.2, 7.4, i * Math.PI / 4 - 0.04, 0.08, 0.03, 0.8, 5), P.gold, x, 31.8, z, 0, { uv: 'cyl', r: 6 });
    B.cyl(P.gold, 1.2, 1.5, 0.6, x, 41.2, z, 8); B.cyl(P.stoneL, 0.9, 1, 3, x, 41.8, z, 8); B.dome(P.gold, 1.1, 1.6, x, 44.8, z, 8); B.cyl(P.gold, 0.05, 0.2, 2.6, x, 46.2, z, 5);
    if (B.hi) for (let i = 0; i < 6; i++) B.group(x, 0, z, Math.atan2(sx, sz) + (i - 2.5) * 0.5, () => { B.win(0, 8, 6.02, 1.8, 14, { lit: 0.9 }); });
    m.collide.circle(x, z, 6.3);
  }
  B.box(mat(0xfff0c8, 0.5, 0, 0, 2), 24, 2, 0.3, 0, 27.6, D / 2 + 0.3, 0, { jit: 0 }); B.box(mat(0x1f6f5a, 0.6, 0, 0, 1), W - 16, 0.5, 2.4, 0, 5.4, D / 2 + 1.2, 0, { jit: 0 });
  return { height: 50 };
}

// ---------- Musée du quai Branly (suggestion) : longue galerie sur pilotis, boîtes colorées, palissade de verre ----------
function buildBranly(m) {
  const { B } = m, rust = mat(0x8a4a32, 0.8, 0.1, 0, 0.6), N = B.far ? 6 : 12;
  const pt = (t) => [-95 + 190 * t, -10 + 26 * Math.sin(t * Math.PI)];                       // galerie légèrement arquée
  for (let i = 0; i < N; i++) {
    const [x0, z0] = pt(i / N), [x1, z1] = pt((i + 1) / N), len = Math.hypot(x1 - x0, z1 - z0) + 0.6, ry = Math.atan2(-(z1 - z0), x1 - x0), x = (x0 + x1) / 2, z = (z0 + z1) / 2;
    B.box(rust, len, 12, 22, x, 10, z, ry); B.box(P.ironD, len, 0.5, 22.6, x, 22, z, ry);
    B.group(x, 0, z, ry, () => { for (const sx of [-0.3, 0.3]) for (const sz of [-7, 7]) { B.cyl(P.ironD, 0.55, 0.45, 10, sx * len, 0, sz, 8); } if (B.hi) B.winRow(-len / 2, len / 2, 13, -11.02 * -1, 4, 2.8, 5, { frame: false, lit: 0.5 }); });
    for (const sx of [-0.3, 0.3]) for (const sz of [-7, 7]) { const c = Math.cos(ry), s = Math.sin(ry); m.collide.circle(x + sx * len * c + sz * s, z - sx * len * s + sz * c, 0.7, -10, 9); }
    m.collide.box(x, z, len / 2, 11, ry, 9.5);
    // boîtes multicolores en saillie côté Seine
    const cols = [0x9a3b2a, 0xc7772e, 0x5a2f25, 0xb7a23a, 0x6d5a3a];
    for (let k = 0; k < 2; k++) { const w = 5 + ((i * 3 + k) % 3) * 2, c = Math.cos(ry), s = Math.sin(ry), lx = (k - 0.5) * len * 0.5, lz = 12.5; B.box(mat(cols[(i * 2 + k) % 5], 0.7, 0, 0, 0.8), w, 5 + ((i + k) % 3) * 1.5, 5, x + lx * c + lz * s, 12 + ((i + k) % 2) * 2, z - lx * s + lz * c, ry); }
  }
  // palissade de verre le long du quai et bâtiment à mur végétal
  B.box(mat(0x9fc0c8, 0.08, 0.3, 0, 0.3), 150, 11, 0.3, -18, 0, 44, 0, { jit: 0 }); m.collide.box(-18, 44, 75, 0.4);
  B.box(mat(0x3f6b34, 0.95, 0, 0.3, 0.3), 40, 17, 14, 100, 0, 14); B.group(100, 0, 21.02, 0, () => B.winRow(-20, 20, 2, 0, 6, 2, 12, { frame: false })); m.collide.box(100, 14, 20.2, 7.2);
  return { height: 24 };
}

export const DEFS = { pompidou: buildPompidou, orsay: buildOrsay, petitpalais: buildPetitPalais, lafayette: buildLafayette, printemps: buildPrintemps, branly: buildBranly };

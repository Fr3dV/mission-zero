// Palais et édifices publics : Hôtel de Ville, Palais Bourbon, Luxembourg (Sénat), Institut de France, École militaire,
// Palais-Royal (colonnes de Buren, galeries du jardin, Comédie-Française), Palais Brongniart, Bourse de commerce.
import * as THREE from 'three';
import { P, wing, court, pavilion, stairs, palaceWing, arcadeShape, domeLune } from './kit.js';

const F3 = [{ h: 7, arch: true, w: 2.6, wh: 4.6, sill: 1 }, { h: 6.5, w: 2.1, wh: 4.2 }, { h: 5.5, w: 1.9, wh: 3 }];
const lanternTop = (B, mat, x, y, z, r, h) => { B.cyl(P.stoneL, r, r * 1.1, h * 0.5, x, y, z, 10); B.dome(mat, r * 1.15, h * 0.3, x, y + h * 0.5, z, 10); B.cyl(P.gold, 0.06, 0.2, h * 0.35, x, y + h * 0.78, z, 5); };

// ---------- Hôtel de Ville (143 × 80 m, néo-Renaissance) ----------
function buildHotelDeVille(m) {
  const { B } = m, W = 143, D = 80, RF = P.slate;
  court(m, 0, 0, W, D, { dep: 20, floors: F3, bay: 4.8, roof: 'mansard', roofH: 9, roofMat: RF, pil: true });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { pavilion(B, sx * (W / 2 - 10), sz * (D / 2 - 11), 0, { w: 22, d: 24, h: 24, roofH: 13, roofMat: RF }); m.collide.box(sx * (W / 2 - 10), sz * (D / 2 - 11), 11.6, 12.6); }
  for (const sx of [-1, 1]) { pavilion(B, sx * 28, D / 2 - 9, 0, { w: 15, d: 22, h: 24, roofH: 11, roofMat: RF }); m.collide.box(sx * 28, D / 2 - 9, 8, 11.5); }
  // pavillon central : horloge, campanile
  B.group(0, 0, D / 2 - 8, 0, () => {
    B.box(P.stone, 30, 30, 24, 0, -2, 0); B.box(P.stoneL, 31.4, 1, 25.4, 0, 28, 0); B.frustum(RF, 30, 24, 15, 9, 13, 0, 29, 0);
    B.group(0, 0, 12.02, 0, () => {
      for (const x of [-9, 0, 9]) { B.win(x, 0.6, 0, 4.2, 6.5, { arch: true, mat: P.shadow, farMin: 0 }); B.win(x, 10, 0, 3.4, 7, { arch: true, lit: 1, farMin: 0 }); }
      B.box(P.stoneL, 9, 9, 1.2, 0, 21, 0.3); B.gable(P.deco, RF, 9.6, 3, 1.6, 0, 30, 0.3);
      B.add(new THREE.CircleGeometry(2.3, 20), P.stoneW, 0, 25.5, 0.95, 0, { jit: 0 }); B.add(new THREE.RingGeometry(2.3, 2.7, 20), P.gold, 0, 25.5, 0.97, 0, { jit: 0 });
      if (B.hi) { for (let i = 0; i < 12; i++) B.statue(P.deco, -13.2 + i * 2.4, 18.2, 0.6, 2.6); for (const x of [-13.5, -4.5, 4.5, 13.5]) { B.column(x, 9.6, 0.7, 0.5, 8.4, 'cor'); } }
    });
    B.box(P.stone, 6.5, 9, 6.5, 0, 38, 2); B.box(P.stoneL, 7.6, 0.6, 7.6, 0, 47, 2);
    for (let k = 0; k < 4; k++) B.group(0, 0, 2, k * Math.PI / 2, () => B.win(0, 39.5, 3.27, 2.2, 5, { arch: true, mat: P.shadow, frame: false, farMin: 0 }));
    B.frustum(RF, 6.5, 6.5, 0, 0, 9, 0, 47.6, 2); B.cyl(P.gold, 0.05, 0.25, 3.5, 0, 56, 2, 5);
  });
  m.collide.box(0, D / 2 - 8, 15.4, 12.6);
  if (B.hi) { // statues des personnalités dans les niches, lucarnes
    for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) B.statue(P.deco, sx * (38 + i * 2.6), 8, D / 2 + 0.5, 2.4);
    for (const sz of [-1, 1]) for (let i = 0; i < 20; i++) B.frustum(RF, 2, 2, 0, 0, 4, -57 + i * 6, 28.5, sz * (D / 2 - 3));
  }
  return { height: 60 };
}

// ---------- Palais Bourbon (Assemblée nationale) : colonnade de douze colonnes face au pont de la Concorde ----------
function buildBourbon(m) {
  const { B } = m, S = P.stone, ZP = 46, PY = 5.2;
  B.box(P.stoneD, 62, PY + 3, 14, 0, -3, ZP - 5); stairs(B, P.stoneL, 46, 26, PY / 26, 0.42, 0, 0, ZP + 2);
  for (const sx of [-1, 1]) { B.box(P.stoneD, 8, PY + 1, 12, sx * 27, 0, ZP + 7.5); B.box(S, 4, 3, 4, sx * 27, PY + 1, ZP + 9); B.statue(P.stoneL, sx * 27, PY + 4, ZP + 9, 5); B.box(S, 3.6, 2.4, 3.6, sx * 17.5, 0, ZP + 15.5); B.statue(P.stoneL, sx * 17.5, 2.4, ZP + 15.5, 4.4); }
  m.collide.box(0, ZP + 3, 31.5, 11.5);
  B.group(0, PY, 0, 0, () => {
    B.colonnade(-24.2, ZP, 24.2, ZP, 12, 0, 0.85, 15.5, 'cor');
    B.box(P.stoneL, 52, 1.3, 9, 0, 15.5, ZP - 3); B.box(S, 51.6, 1.9, 8.6, 0, 16.8, ZP - 3); B.box(P.stoneL, 53.6, 1, 10.4, 0, 18.7, ZP - 3);
    B.gable(P.deco, P.zinc, 53.6, 7, 10.4, 0, 19.7, ZP - 3); B.lump(P.stoneL, 0, 20, ZP + 2.3, 30, 4.6, 0.8, 14, 6);
    B.box(P.stoneD, 52, 15.5, 0.4, 0, 0, ZP - 6.6);
    B.group(0, 0, ZP - 6.38, 0, () => { for (const x of [-18, -9, 0, 9, 18]) B.win(x, 0, 0, 3, 8, { mat: P.bronze, farMin: 0 }); });
  });
  // murs latéraux à bas-reliefs, corps du palais, hémicycle
  for (const [cx, w] of [[-37, 14], [43, 26]]) { B.box(S, w, 21, 10, cx, 0, ZP - 9); B.box(P.stoneL, w + 0.8, 0.9, 10.8, cx, 21, ZP - 9); B.box(P.deco, w - 5, 7, 0.4, cx, 9, ZP - 3.9); B.lump(P.deco, cx, 9.4, ZP - 3.6, w - 6, 6, 0.6, 7, cx); }
  B.box(S, 102, 22, 26, 7, -2, ZP - 27); B.frustum(P.zinc, 102, 26, 90, 12, 4, 7, 20, ZP - 27);
  B.cyl(S, 21, 21, 24, 0, 0, 22, 32); B.cyl(P.stoneL, 21.8, 21.6, 0.9, 0, 24, 22, 32); B.dome(P.zinc, 21, 6.5, 0, 24.9, 22, 32); B.cyl(P.glassLit, 5, 5, 1.2, 0, 31, 22, 16, { jit: 0 });
  m.collide.box(7, ZP - 22, 51.4, 18.4); m.collide.circle(0, 22, 21.3);
  // hôtel côté place du Palais-Bourbon : cour d'honneur
  court(m, 7, -30, 102, 78, { dep: 15, floors: [{ h: 6.5, arch: true, w: 2.4, wh: 4 }, { h: 6, w: 2, wh: 3.6 }, { h: 4.5, w: 1.8, wh: 2.4 }], bay: 4.6, roof: 'mansard', roofH: 5, roofMat: P.slate, gatesN: [{ x: 0, w: 10, h: 9 }] });
  return { height: 34 };
}

// ---------- Palais du Luxembourg (Sénat) ----------
function buildLuxembourg(m) {
  const { B } = m, W = 90, D = 118, wall = { ...P.stone, c: P.stone.c.map((v) => v * 0.96) };
  const F = [{ h: 7.5, arch: true, w: 2.6, wh: 5, sill: 0.9 }, { h: 7, arch: true, w: 2.3, wh: 4.4 }, { h: 6.5, w: 2, wh: 3.6 }];
  court(m, 0, 0, W, D, { dep: 16, floors: F, bay: 5, roof: 'mansard', roofH: 6.5, roofMat: P.slate, pil: true, wall, gatesN: [{ x: 0, w: 9, h: 10 }] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { pavilion(B, sx * (W / 2 - 11), sz * (D / 2 - 13), 0, { w: 24, d: 28, h: 24, roofH: 9, wall }); m.collide.box(sx * (W / 2 - 11), sz * (D / 2 - 13), 12.6, 14.6); }
  // pavillon central côté jardin (horloge) et terrasse
  pavilion(B, 0, D / 2 - 6, 0, { w: 26, d: 26, h: 27, roofH: 10, wall }); m.collide.box(0, D / 2 - 6, 13.6, 13.6);
  B.group(0, 0, D / 2 + 7.02, 0, () => { B.add(new THREE.CircleGeometry(1.9, 16), P.stoneW, 0, 24, 0.9, 0, { jit: 0 }); B.add(new THREE.RingGeometry(1.9, 2.2, 16), P.gold, 0, 24, 0.92, 0, { jit: 0 }); });
  // tour-porche à dôme sur la rue de Vaugirard
  B.cyl(P.stone, 6, 6, 7, 0, 21.5, -D / 2 + 8, 16); B.cyl(P.stoneL, 6.6, 6.4, 0.7, 0, 28.5, -D / 2 + 8, 16); B.dome(P.slate, 6.2, 7, 0, 29.2, -D / 2 + 8, 16); lanternTop(B, P.slate, 0, 36, -D / 2 + 8, 1.2, 5);
  if (B.hi) for (let i = 0; i < 8; i++) B.column(Math.sin(i * Math.PI / 4 + 0.39) * 6.3, 21.6, -D / 2 + 8 + Math.cos(i * Math.PI / 4 + 0.39) * 6.3, 0.4, 6.6, 'cor');
  return { height: 42 };
}

// ---------- Institut de France : coupole face au pont des Arts, ailes en quart de cercle ----------
function buildInstitut(m) {
  const { B } = m, S = P.stone;
  // chapelle à coupole
  B.box(S, 28, 24, 26, 0, -2, 4); B.box(P.stoneL, 29.4, 1, 27.4, 0, 22, 4);
  B.group(0, 0, 17, 0, () => {
    B.box(S, 20, 22, 4, 0, 0, 1); for (const x of [-7.5, -2.5, 2.5, 7.5]) B.column(x, 1.5, 3.6, 0.75, 16.5, 'cor');
    B.box(P.stoneL, 20.6, 1.6, 6.4, 0, 18, 1.6); B.gable(P.deco, P.lead, 20.6, 4.6, 6.4, 0, 19.6, 1.6);
    B.win(0, 1.5, 3.02, 3.4, 8, { arch: true, mat: P.bronze, farMin: 0 }); stairs(B, P.stoneL, 18, 7, 0.21, 0.4, 0, 0, 4.4);
  });
  B.cyl(S, 11, 11.4, 4, 0, 23, 4, 32); B.cyl(S, 10.2, 10.2, 9, 0, 27, 4, 32); B.cyl(P.stoneL, 11.2, 11, 1, 0, 36, 4, 32);
  for (let i = 0; i < 8; i++) B.group(0, 0, 4, i * Math.PI / 4, () => { B.win(0, 28.5, 10.22, 2.4, 5.6, { arch: true, frame: false, farMin: 0 }); if (B.hi) B.group(0, 0, 0, Math.PI / 8, () => { for (const x of [-0.9, 0.9]) B.box(P.stoneL, 0.8, 9, 0.6, x, 27, 10.3); }); });
  B.dome(P.lead, 10.6, 11, 0, 37, 4, 36);
  for (let i = 0; i < 8; i++) B.add(domeLune(10.72, 11.1, i * Math.PI / 4 - 0.05 + Math.PI / 8, 0.1, 0.02, 0.96, B.far ? 4 : 9), P.gold, 0, 37, 4, 0, { uv: 'cyl', r: 10 });
  B.cyl(P.gold, 2.6, 3, 0.8, 0, 47.8, 4, 12); lanternTop(B, P.lead, 0, 48.6, 4, 1.7, 7);
  m.collide.box(0, 6, 14.4, 15.4);
  // ailes courbes vers la Seine et pavillons d'extrémité
  for (const sx of [-1, 1]) {
    const N = B.far ? 3 : 6, cx = sx * 30, cz = 22, R = 20;
    for (let i = 0; i < N; i++) {
      // quart de cercle de (cx, cz - R) [côté chapelle] à (cx + sx·R, cz) [pavillon], concave vers la Seine
      const t = Math.PI / 2 + (i + 0.5) / N * Math.PI / 2, x = cx - sx * R * Math.cos(t), z = cz - R * Math.sin(t), len = R * Math.PI / 2 / N + 1.6, ry = Math.atan2(Math.cos(t), sx * Math.sin(t));
      B.group(x, 0, z, ry, () => palaceWing(B, { len, dep: 10, floors: [{ h: 7, arch: true, w: 2.4, wh: 4.6 }, { h: 6, w: 2, wh: 3.6 }], bay: len / 2, roof: 'hip', roofH: 3, roofMat: P.slate }));
      m.collide.box(x, z, len / 2, 5.3, ry);
    }
    B.box(S, 18, 13, 10, sx * 22, 0, 2); m.collide.box(sx * 22, 2, 9, 5.2);
    B.group(sx * 49, 0, 18, 0, () => { B.box(S, 12, 19, 16, 0, -1, 0); B.box(P.stoneL, 13, 0.9, 17, 0, 18, 0); B.gable(P.deco, P.slate, 12.4, 3.2, 16.4, 0, 18.9, 0); B.win(0, 1, 8.02, 2.6, 6, { arch: true, farMin: 0 }); for (const x of [-4.6, -2.2, 2.2, 4.6]) B.column(x, 0.5, 8.5, 0.5, 12.5, 'cor'); B.box(P.stoneL, 12, 1.3, 2.4, 0, 13, 8.3); });
    m.collide.box(sx * 49, 18, 6.2, 9);
  }
  // (les cours arrière, entre les rues Mazarine et de Seine, sont laissées au bâti de la ville)
  return { height: 58 };
}

// ---------- École militaire : pavillon central à dôme quadrangulaire, face au Champ-de-Mars ----------
function buildEcoleMilitaire(m) {
  const { B } = m, S = P.stone, ZF = 26;
  for (const sx of [-1, 1]) { wing(m, sx * 55, ZF, 0, { dep: 18, floors: F3, bay: 4.8, len: 76, roof: 'mansard', roofH: 6, roofMat: P.slate, pil: true }); pavilion(B, sx * 96, ZF, 0, { w: 20, d: 24, h: 21, roofH: 8 }); m.collide.box(sx * 96, ZF, 10.6, 12.6); }
  B.group(0, 0, ZF, 0, () => {
    B.box(S, 36, 26, 26, 0, -2, 0); B.box(P.stoneL, 37.4, 1.1, 27.4, 0, 24, 0);
    for (const x of [-12.6, -9, -3.4, 3.4, 9, 12.6]) { B.column(x, 0.6, 14.2, 0.85, 18, 'cor'); }
    B.box(P.stoneL, 30, 1.5, 4, 0, 18.6, 13.6); B.gable(P.deco, P.slate, 30, 5, 4, 0, 20.1, 13.6); B.lump(P.stoneL, 0, 20.4, 15.3, 16, 3.4, 0.6, 8, 3);
    B.group(0, 0, 13.02, 0, () => { for (const x of [-6.2, 0, 6.2]) { B.win(x, 0.6, 0, 3, 6.4, { arch: true, mat: P.shadow, farMin: 0 }); B.win(x, 10, 0, 2.6, 6, { arch: true, lit: 0.9, farMin: 0 }); } });
    // dôme quadrangulaire
    B.box(S, 24, 5, 20, 0, 25, 0); B.box(P.stoneL, 25, 0.8, 21, 0, 30, 0);
    const pts = [[1, 0], [0.97, 0.2], [0.86, 0.45], [0.68, 0.68], [0.45, 0.86], [0.2, 0.97]];
    for (let i = 0; i < pts.length - 1; i++) B.frustum(P.slate, 24 * pts[i][0], 20 * pts[i][0], 24 * pts[i + 1][0], 20 * pts[i + 1][0], 12 * (pts[i + 1][1] - pts[i][1]), 0, 30.8 + 12 * pts[i][1], 0);
    B.box(P.stoneL, 5.4, 3, 4.6, 0, 42.4, 0); B.frustum(P.slate, 5.4, 4.6, 0, 0, 3, 0, 45.4, 0);
    B.add(new THREE.CircleGeometry(1.7, 16), P.stoneW, 0, 27.5, 10.05, 0, { jit: 0 }); if (B.hi) for (const x of [-9, -6, 6, 9]) B.statue(P.stoneL, x, 25, 11, 3);
  });
  m.collide.box(0, ZF, 18.4, 14.8);
  court(m, 0, -42, 150, 100, { dep: 15, floors: F3, bay: 4.8, roof: 'mansard', roofH: 6, roofMat: P.slate, gatesN: [{ x: 0, w: 10, h: 9 }] });
  return { height: 50 };
}

// ---------- Palais-Royal : cour de l'Horloge, cour d'honneur (colonnes de Buren), galeries du jardin, Comédie-Française ----------
function buildPalaisRoyal(m) {
  const { B } = m, S = P.stone;
  const F = [{ h: 6.5, arch: true, w: 2.8, wh: 4.6, sill: 0.4 }, { h: 6.5, w: 2.1, wh: 4.4 }, { h: 5, w: 1.9, wh: 2.8 }];
  const W = { dep: 14, floors: F, bay: 4.6, roof: 'mansard', roofH: 5, roofMat: P.slate, pil: true };
  // corps central (Conseil d'État) et cour de l'Horloge ouverte au sud
  wing(m, 0, 12, 0, { ...W, len: 74, dep: 16 }); pavilion(B, 0, 13, 0, { w: 20, d: 20, h: 21, roofH: 7 }); m.collide.box(0, 13, 10.6, 10.6);
  for (const sx of [-1, 1]) { wing(m, sx * 30, 37, Math.PI / 2, { ...W, len: 34 }); B.box(S, 15, 21, 6, sx * 30, 0, 55); B.gable(P.deco, P.slate, 15, 3.4, 6, sx * 30, 21, 55); B.group(sx * 30, 0, 58.02, 0, () => { B.win(0, 1, 0, 2.6, 5, { arch: true }); B.win(0, 9, 0, 2.2, 5, { lit: 0.8 }); for (const x of [-5.6, 5.6]) B.column(x, 6.6, 0.6, 0.5, 11, 'ion'); }); m.collide.box(sx * 30, 55, 7.6, 3.2); }
  B.extrude(S, arcadeShape(-23, 23, 7, [-16, -8, 0, 8, 16].map((x) => ({ x, w: x ? 4.6 : 6, h: 6 }))), 2.4, 0, 0, 54); B.box(P.stoneL, 46.6, 0.7, 3, 0, 7, 55.2);
  for (const x of [-21.5, -12, -4.2, 4.2, 12, 21.5]) m.collide.box(x, 55.2, x * x > 400 ? 1.5 : 1.3, 1.3);
  // cour d'honneur : ailes Montpensier / Valois, galerie d'Orléans (double colonnade), colonnes de Buren
  for (const sx of [-1, 1]) wing(m, sx * 37, -34, Math.PI / 2, { ...W, len: 76 });
  for (const z of [-64, -76]) { B.colonnade(-28, z, 28, z, 15, 0.3, 0.42, 5.6, 'dor'); B.box(P.stoneL, 60, 0.9, 1.6, 0, 5.9, z); for (let i = 0; i < 15; i++) m.collide.circle(-28 + i * 4, z, 0.5, -10, 7); }
  B.box(P.pave, 62, 0.25, 14, 0, 0, -70, 0, { jit: 0 });
  const black = { ...P.shadow, c: [0.02, 0.02, 0.02], r: 0.4, g: 0.1 }, white = { ...P.stoneW, t: 0 };
  B.box(P.paveD, 58, 0.06, 52, 0, 0.02, -32, 0, { jit: 0 });
  for (let i = 0; i < 13; i++) for (let j = 0; j < 11; j++) {
    const x = -24.6 + i * 4.1, z = -55 + j * 4.5, h = [0.45, 0.9, 1.6, 0.45, 2.4, 0.9, 0.45, 3.1][(i * 3 + j * 5) % 8];
    if (B.far) { if ((i + j) % 3 === 0) B.box(white, 0.9, h, 0.9, x, 0, z); continue; }
    B.cyl(white, 0.42, 0.42, h, x, 0.05, z, 8, { jit: 0 });
    for (let k = 0; k < h / 0.3; k += 2) B.cyl(black, 0.43, 0.43, 0.15, x, 0.05 + k * 0.15 + 0.075, z, 8, { jit: 0 });
    for (let s = 0; s < 4; s++) { const a = s * Math.PI / 2 + Math.PI / 4; B.box(black, 0.2, h, 0.04, x + Math.sin(a) * 0.415, 0.05, z + Math.cos(a) * 0.415, a, { jit: 0 }); }
  }
  // galeries du jardin (Montpensier, Valois, Beaujolais) : arcades continues sur 230 m
  const G = { dep: 13, floors: [{ h: 6, arch: true, w: 2.9, wh: 4.9, sill: 0.3, lit: 0.6 }, { h: 5.5, w: 1.9, wh: 3.8 }, { h: 4.5, w: 1.8, wh: 2.6 }, { h: 3.5, w: 1.6, wh: 1.8 }], bay: 4.4, roof: 'mansard', roofH: 4.5, roofMat: P.slate, pil: true };
  for (const sx of [-1, 1]) wing(m, sx * 52, -173, Math.PI / 2, { ...G, dep: 12, len: 196, gates: [{ x: 30, w: 7, h: 6 }, { x: -50, w: 7, h: 6 }] });
  wing(m, 0, -277, 0, { ...G, dep: 12, len: 116, gates: [{ x: 0, w: 8, h: 6 }] });
  if (B.hi) { B.cyl(P.stoneL, 8, 8.4, 0.7, 0, 0, -175, 24); B.cyl(P.water, 7.4, 7.4, 0.1, 0, 0.6, -175, 24, { jit: 0 }); }
  m.collide.circle(0, -175, 8.5, -10, 3);
  // Comédie-Française (salle Richelieu), à l'angle sud-ouest
  B.group(-66, 0, 34, 0, () => {
    B.box(S, 34, 24, 38, 0, -2, 0); B.box(P.stoneL, 35.2, 1, 39.2, 0, 22, 0); B.frustum(P.zinc, 34, 38, 20, 22, 6, 0, 23, 0); B.cyl(P.zinc, 9, 10, 3, 0, 29, -4, 20); B.dome(P.zinc, 9, 3, 0, 32, -4, 20);
    for (const [ry, len, off] of [[0, 28, 19], [-Math.PI / 2, 32, 17], [Math.PI, 28, 19]]) B.group(0, 0, 0, ry, () => { B.colonnade(-len / 2, off + 1.2, len / 2, off + 1.2, Math.round(len / 4) + 1, 0.2, 0.45, 6.3, 'dor'); B.box(P.stoneL, len + 2, 0.9, 3, 0, 6.5, off + 0.9); B.winRow(-len / 2, len / 2, 9, off + 0.02, Math.round(len / 4.4), 2, 5, { lit: 0.8 }); B.winRow(-len / 2, len / 2, 16.5, off + 0.02, Math.round(len / 4.4), 1.8, 3); B.box(P.shadow, len, 6, 0.1, 0, 0.2, off + 0.06); });
  });
  m.collide.box(-66, 34, 18.4, 20.6);
  return { height: 34 };
}

// ---------- Palais Brongniart (ancienne Bourse) : temple périptère corinthien sans fronton ----------
function buildBrongniart(m) {
  const { B } = m, S = P.stone, PY = 3, HX = 19, HZ = 33, r = 0.55, h = 10.4;
  B.box(P.stoneD, 41, PY + 3, 69, 0, -3, 0); stairs(B, P.stoneL, 30, 15, PY / 15, 0.4, 0, 0, 34.5); stairs(B, P.stoneL, 30, 15, PY / 15, 0.4, 0, 0, -34.5, Math.PI);
  m.collide.box(0, 0, 20.8, 40.6);
  B.group(0, PY, 0, 0, () => {
    B.colonnade(-HX, HZ, HX, HZ, 14, 0, r, h, 'cor'); B.colonnade(-HX, -HZ, HX, -HZ, 14, 0, r, h, 'cor');
    for (const sx of [-1, 1]) for (let i = 1; i < 23; i++) B.column(sx * HX, 0, HZ - i * (2 * HZ / 23), r, h, 'cor');
    B.box(S, 33, h, 61, 0, 0, 0); B.box(P.stoneL, 40.4, 1, 68.4, 0, h, 0); B.box(S, 40, 1.4, 68, 0, h + 1, 0); B.box(P.stoneL, 41.6, 0.8, 69.6, 0, h + 2.4, 0);
    B.box(S, 36, 4.2, 64, 0, h + 3.2, 0); B.box(P.stoneL, 37, 0.6, 65, 0, h + 7.4, 0); B.frustum(P.zinc, 36, 64, 16, 40, 4, 0, h + 8, 0); B.box(P.glassLit, 14, 0.5, 36, 0, h + 12, 0, 0, { jit: 0 });
    for (const [ry, len, off] of [[0, 28, 30.5], [Math.PI, 28, 30.5], [Math.PI / 2, 56, 16.5], [-Math.PI / 2, 56, 16.5]]) B.group(0, 0, 0, ry, () => { B.winRow(-len / 2, len / 2, 0.4, off + 0.02, Math.round(len / 4.6), 2, 4.6, { arch: true, lit: 0.6 }); B.winRow(-len / 2, len / 2, 6.4, off + 0.02, Math.round(len / 4.6), 1.8, 2.6); });
  });
  return { height: 28 };
}

// ---------- Bourse de commerce : rotonde à coupole, colonne Médicis ----------
function buildBourseCommerce(m) {
  const { B } = m, S = P.stone, R = 30;
  B.cyl(S, R, R, 23, 0, -2, 0, 56); B.cyl(P.stoneL, R + 0.7, R + 0.5, 1, 0, 21, 0, 56); B.cyl(S, R - 1, R - 1, 3, 0, 22, 0, 56); B.cyl(P.stoneD, R + 0.3, R + 0.3, 1.2, 0, 0, 0, 56);
  const n = B.far ? 12 : 24;
  for (let i = 0; i < n; i++) B.group(0, 0, 0, (i + 0.5) * Math.PI * 2 / n, () => { B.win(0, 1.5, R + 0.02, 3, 6.5, { arch: true, farMin: 0, lit: 0.5 }); B.win(0, 12, R + 0.02, 2.6, 5, { arch: true, farMin: 0, lit: 0.5 }); if (B.hi) B.group(0, 0, 0, Math.PI / n, () => B.box(P.stoneL, 1.1, 20, 0.5, 0, 1, R + 0.1)); });
  B.dome(P.slate, 24, 15, 0, 25, 0, 48); B.dome({ ...P.glass, c: [0.5, 0.62, 0.68], r: 0.1, m: 0.4, g: 2 }, 16.5, 10.6, 0, 29.6, 0, 40, { jit: 0 });
  if (B.hi) for (let i = 0; i < 24; i++) B.add(domeLune(16.6, 10.7, i * Math.PI / 12 - 0.012, 0.024, 0.02, 0.97, 8), P.steel, 0, 29.6, 0, 0, { uv: 'cyl', r: 16 });
  B.cyl(P.steel, 1.2, 1.6, 1.2, 0, 40, 0, 10);
  // portique d'entrée (ouest) et colonne Médicis (sud-est)
  B.group(0, 0, R, 0, () => { B.box(S, 16, 24, 5, 0, 0, 0); for (const x of [-6.4, -4.4, 4.4, 6.4]) B.column(x, 0.4, 3, 0.6, 13.6, 'cor'); B.box(P.stoneL, 16.6, 1.4, 3, 0, 14, 2.4); B.gable(P.deco, P.zinc, 16.6, 4, 3, 0, 24, 1.2); B.win(0, 0.4, 2.52, 4.4, 9, { arch: true, mat: P.shadow, farMin: 0 }); B.lump(P.stoneL, 0, 15.6, 3, 10, 6, 1.2, 5, 4); });
  const a = 2.2; B.cyl(S, 1.5, 1.7, 29, Math.sin(a) * (R + 1.6), 0, Math.cos(a) * (R + 1.6), 12); B.cyl(P.ironD, 2, 1.6, 2.4, Math.sin(a) * (R + 1.6), 29, Math.cos(a) * (R + 1.6), 8);
  m.collide.circle(0, 0, R + 0.6); m.collide.box(0, R + 2, 8.4, 3.6);
  return { height: 42 };
}

export const DEFS = { hoteldeville: buildHotelDeVille, bourbon: buildBourbon, luxembourg: buildLuxembourg, institut: buildInstitut, ecolemilitaire: buildEcoleMilitaire, palaisroyal: buildPalaisRoyal, brongniart: buildBrongniart, boursecommerce: buildBourseCommerce };

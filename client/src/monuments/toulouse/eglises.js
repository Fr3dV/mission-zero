// Églises de Toulouse : basilique Saint-Sernin, couvent des Jacobins, cathédrale Saint-Étienne,
// basilique de la Daurade, Notre-Dame de la Dalbade, Notre-Dame du Taur, couvent des Augustins.
// Repère commun : +Z = façade occidentale, chevet vers -Z, +X = sud.
import * as THREE from 'three';
import { P, ogiveShape, arcadeShape, rose, stairs } from '../kit.js';
import { octTower, octSpire, buttress, balustrade, bwing, brick, FL } from './tk.js';

const BR = P.brick, ST = P.pierre, TL = P.tile;
// demi-cylindre et demi-cône tournés vers -Z (chevets)
const halfCyl = (B, mat, r, h, x, y, z, seg = 16, exact = false) => B.cyl(mat, r, r, h, x, y, z, seg, { t0: Math.PI / 2, tl: Math.PI, exact });
const halfCone = (B, mat, r0, r1, h, x, y, z, seg = 16, exact = false) => B.add(new THREE.CylinderGeometry(r1, r0, h, exact ? seg : B.n(seg), 1, true, Math.PI / 2, Math.PI).translate(0, h / 2, 0), mat, x, y, z, 0, { uv: 'cyl', r: r0 });
// toit en appentis entre deux lignes parallèles à Z : (x0, y0) bas -> (x1, y1) haut, de z0 à z1
const leanTo = (B, mat, x0, y0, x1, y1, z0, z1) => B.tris(mat, [x0, y0, z0, x1, y1, z0, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y0, z1], 0, 0, 0, 0, { up: true });
// absidiole : petite chapelle ronde à toit conique, adossée
const absidiole = (B, x, z, r, h, wall = BR) => {
  B.cyl(wall, r, r, h + 3, x, -3, z, 12); B.cyl(ST, r + 0.25, r + 0.25, 0.4, x, h - 0.4, z, 12, { jit: 0 }); B.cyl(TL, 0.15, r + 0.45, r * 0.75, x, h, z, 12, { open: true });
  if (B.hi) B.cyl(ST, r + 0.12, r + 0.12, 0.3, x, h * 0.42, z, 12, { jit: 0 });
};
// baie en plein cintre à encadrement de pierre, sur un mur face à +Z du groupe courant
const romanWin = (B, x, y, z, w, h, o = {}) => B.win(x, y, z, w, h, { arch: true, mat: o.mat || P.vitrail, frameMat: ST, farMin: o.farMin ?? 9, frame: o.frame });

// ====================== Basilique Saint-Sernin (115 m, clocher octogonal de 65 m) ======================
function buildSaintSernin(m) {
  const { B } = m;
  const ZW = 53.5, ZA = -38, ZT = -25, TW = 11, XT = 30;           // façade, centre du rond-point, axe et demi-largeur du transept, demi-longueur
  const NW = 4.8, A1 = 10.4, A2 = 17.3, NH = 21.5, A1H = 16, A2H = 8.6;
  const Z0 = ZW - 8, LN = Z0 - ZA, zc = (Z0 + ZA) / 2;
  // ---- nef à cinq vaisseaux, chœur ----
  B.box(BR, 2 * NW, NH + 3, LN, 0, -3, zc); B.gable(BR, TL, 2 * NW + 1, 4.2, LN + 0.4, 0, NH, zc);
  B.box(BR, 2 * A1, A1H + 3, LN, 0, -3, zc);
  const zN1 = ZT + TW, lOut = Z0 - zN1;
  B.box(BR, 2 * A2, A2H + 3, lOut, 0, -3, (Z0 + zN1) / 2);
  for (const sx of [-1, 1]) {
    leanTo(B, TL, sx * (A1 + 0.4), A1H, sx * NW, A1H + 3.6, Z0, ZA); leanTo(B, TL, sx * (A2 + 0.4), A2H, sx * A1, A2H + 3, Z0, zN1);
    B.group(0, 0, 0, sx * Math.PI / 2, () => {                      // +Z local = extérieur ; X local = -sx·Z monde
      const nb = 11, step = lOut / nb;
      for (let i = 0; i < nb; i++) {
        const zw = Z0 - (i + 0.5) * step, x = -sx * zw;
        romanWin(B, x, 2.6, A2, 1.4, 3.4); romanWin(B, x, A2H + 3.4, A1, 1.2, 2.4, { frame: false });
        if (B.hi) { B.box(BR, 0.9, A2H, 0.5, x + step / 2, 0, A2 + 0.2); B.box(BR, 0.8, A1H - A2H - 3, 0.4, x + step / 2, A2H + 3, A1 + 0.15); }
      }
      if (B.hi) { B.box(ST, lOut, 0.35, 0.5, -sx * (Z0 + zN1) / 2, A2H - 0.35, A2 + 0.15, 0, { jit: 0 }); B.box(ST, LN, 0.35, 0.5, -sx * zc, A1H - 0.35, A1 + 0.15, 0, { jit: 0 }); }
    });
  }
  // ---- transept à collatéraux, pignons nord et sud ----
  B.box(BR, 2 * XT, NH + 3, 2 * NW, 0, -3, ZT); B.gable(BR, TL, 2 * NW + 1, 4.2, 2 * XT + 0.4, 0, NH, ZT, Math.PI / 2);
  B.box(BR, 2 * XT, A1H + 3, 2 * TW, 0, -3, ZT);
  for (const sz of [-1, 1]) B.tris(TL, [-XT, A1H, ZT + sz * (TW + 0.4), XT, A1H, ZT + sz * (TW + 0.4), XT, A1H + 3.6, ZT + sz * NW, -XT, A1H, ZT + sz * (TW + 0.4), XT, A1H + 3.6, ZT + sz * NW, -XT, A1H + 3.6, ZT + sz * NW], 0, 0, 0, 0, { up: true });
  for (const sx of [-1, 1]) B.group(sx * XT, 0, ZT, sx * Math.PI / 2, () => {
    // porte des Comtes (sud) / portail nord : deux arches jumelles, baies, pilastres
    for (const x of [-2.2, 2.2]) { B.win(x, 0, 0.02, 2.6, 4.6, { arch: true, mat: P.bois, frameMat: ST, farMin: 0 }); }
    B.box(ST, 11, 0.5, 0.8, 0, 7.4, 0.3, 0, { jit: 0 }); romanWin(B, 0, 10, 0.02, 2, 4.6, { farMin: 0 }); for (const x of [-6.6, 6.6]) romanWin(B, x, 3, 0.02, 1.4, 3.2);
    for (const x of [-TW, -NW - 0.4, NW + 0.4, TW]) B.box(BR, 1.3, x * x > 40 ? A1H : NH + 2, 0.8, x, 0, 0.3);
    if (B.hi) B.add(new THREE.CircleGeometry(1.1, 12), P.shadow, 0, 18.5, 0.06, 0, { jit: 0 });
  });
  // ---- chevet : abside, déambulatoire, cinq chapelles rayonnantes, quatre chapelles orientées ----
  halfCyl(B, BR, A1 + 3.6, 10.5 + 3, 0, -3, ZA, 24); halfCone(B, TL, A1 + 4, NW + 1, 3.6, 0, 10.5, ZA, 24);
  B.cyl(ST, A1 + 3.85, A1 + 3.85, 0.4, 0, 10.1, ZA, 24, { t0: Math.PI / 2, tl: Math.PI, jit: 0 });
  halfCyl(B, BR, NW + 1, NH + 3, 0, -3, ZA, 16); halfCone(B, TL, NW + 1.5, 0.1, 4.2, 0, NH, ZA, 16);
  B.cyl(ST, NW + 1.25, NW + 1.25, 0.45, 0, NH - 0.45, ZA, 16, { t0: Math.PI / 2, tl: Math.PI, jit: 0 });
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i + 0.5) * Math.PI / 5, r = A1 + 3.2, big = i === 2;
    absidiole(B, Math.sin(a) * r, ZA + Math.cos(a) * r, big ? 4 : 3.3, big ? 8 : 7);
    if (B.hi) B.group(0, 0, ZA, a, () => { romanWin(B, 0, 2.4, r + (big ? 4 : 3.3) + 0.02, 1.1, 2.6, { frame: false }); for (const s of [-1, 1]) B.group(0, 0, 0, s * 0.31, () => romanWin(B, 0, 4, A1 + 3.62, 1.2, 3, { frame: false })); B.group(0, 0, 0, 0.16, () => B.win(0, 14.5, NW + 1.02, 1.1, 3, { arch: true, mat: P.vitrail, frame: false })); });
  }
  for (const x of [-25.6, -16.8, 16.8, 25.6]) absidiole(B, x, ZT - TW - 0.6, 3.1, 7);
  // ---- clocher octogonal : trois étages romans, deux étages gothiques à arcs en mitre, flèche ----
  B.box(BR, 13.4, 4.6, 13.4, 0, NH - 0.2, ZT); B.box(ST, 14, 0.4, 14, 0, NH + 4.2, ZT, 0, { jit: 0 });
  const top = octTower(B, 0, NH + 4.4, ZT, [{ r: 6.7, h: 5.8, arch: 'round' }, { r: 6.35, h: 5.8, arch: 'round' }, { r: 6.0, h: 5.8, arch: 'round' }, { r: 5.6, h: 6.4, arch: 'mitre' }, { r: 5.2, h: 6.4, arch: 'mitre' }]);
  B.cyl(ST, 5.6, 5.6, 1.3, 0, top, ZT, 8, { exact: true, ry: Math.PI / 8, open: true });
  if (B.hi) for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; B.frustum(ST, 0.7, 0.7, 0, 0, 2.2, Math.sin(a) * 5.5, top + 1.3, ZT + Math.cos(a) * 5.5); }
  octSpire(B, P.stoneD, 0, top + 0.6, ZT, 4.6, 9.6);
  // ---- massif occidental inachevé : deux souches de tours, double portail, galerie de cinq baies, grande rose ----
  B.box(BR, 2 * A2 + 0.6, 24 + 3, 8.5, 0, -3, ZW - 4.25);
  for (const sx of [-1, 1]) { B.box(BR, 10.6, 27.5 + 3, 9.6, sx * 12.2, -3, ZW - 4.6); B.frustum(TL, 11.2, 10.2, 3, 3, 2, sx * 12.2, 27.5, ZW - 4.6); B.box(BR, 1.6, 26, 1.2, sx * 16.8, 0, ZW + 0.4); B.box(BR, 1.6, 26, 1.2, sx * 7, 0, ZW + 0.4); }
  B.frustum(TL, 13.4, 8.6, 3, 2, 1.6, 0, 24, ZW - 4.3);
  B.group(0, 0, ZW, 0, () => {
    B.box(ST, 11.4, 8.4, 1.1, 0, 0, 0.5); B.box(ST, 12, 0.5, 1.5, 0, 8.4, 0.6, 0, { jit: 0 });
    for (const x of [-2.6, 2.6]) { B.win(x, 0, 1.06, 3.2, 4.6, { arch: true, mat: P.bois, frameMat: ST, farMin: 0 }); if (B.hi) for (const s of [-1, 1]) B.cyl(P.marbre, 0.2, 0.22, 4.6, x + s * 1.9, 0, 1.25, 8); }
    for (let i = 0; i < 5; i++) romanWin(B, (i - 2) * 2.1, 10.2, 0.02, 1.2, 2.6, { mat: P.shadow });
    B.add(new THREE.CircleGeometry(3.5, B.n(24)), P.shadow, 0, 18.6, 0.06, 0, { jit: 0 }); B.add(new THREE.RingGeometry(3.5, 4.2, B.n(24)), ST, 0, 18.6, 0.1, 0, { jit: 0 });
    if (B.hi) for (const sx of [-1, 1]) { romanWin(B, sx * 12.2, 12, 0.42, 1.5, 3.6, { mat: P.shadow }); romanWin(B, sx * 12.2, 20.5, 0.42, 1.5, 3.6, { mat: P.shadow }); }
  });
  // ---- porte Miègeville (flanc sud) ----
  B.group(A2, 0, 14, Math.PI / 2, () => {
    B.box(ST, 8.4, 9.6, 1.6, 0, 0, 0.8); B.box(ST, 9, 0.5, 2, 0, 9.6, 0.9, 0, { jit: 0 }); B.win(0, 0, 1.62, 3.2, 4.4, { arch: true, mat: P.bois, frame: false, farMin: 0 });
    if (B.hi) { B.lump(P.stoneL, 0, 5.2, 1.7, 3.6, 1.6, 0.3, 5, 4); for (const x of [-2.6, 2.6]) B.statue(P.stoneL, x, 6.2, 1.7, 2); for (let i = 0; i < 9; i++) B.box(ST, 0.35, 0.4, 0.5, -3.6 + i * 0.9, 9.2, 1.9, 0, { jit: 0 }); }
  });
  m.collide.box(0, (ZW + zN1) / 2, A2 + 0.6, (ZW - zN1) / 2 + 0.6); m.collide.box(0, ZT, XT + 0.5, TW + 0.5); m.collide.box(0, (ZA + ZT - TW) / 2, A1 + 0.5, (ZT - TW - ZA) / 2 + 0.5);
  m.collide.circle(0, ZA, A1 + 7); m.collide.box(A2 + 0.9, 14, 1, 4.4);
  for (const x of [-25.6, -16.8, 16.8, 25.6]) m.collide.circle(x, ZT - TW - 0.6, 3.3);
  return { height: 67 };
}

// ====================== Couvent des Jacobins (église-forteresse, clocher de 45 m, cloître) ======================
function buildJacobins(m) {
  const { B } = m, ZW = 37.5, ZE = -30.5, HX = 10.6, H = 28, L = ZW - ZE, zc = (ZW + ZE) / 2, BAY = L / 10;
  // ---- vaisseau unique à hauts contreforts, abside à sept pans ----
  B.box(BR, 2 * HX, H + 3, L, 0, -3, zc); B.gable(BR, TL, 2 * HX + 1.4, 4.4, L + 0.4, 0, H, zc);
  halfCyl(B, BR, HX, H + 3, 0, -3, ZE, 7, true); halfCone(B, TL, HX + 0.7, 0.1, 4.4, 0, H, ZE, 7, true);
  B.box(ST, 2 * HX + 0.6, 0.5, L + 0.3, 0, H - 0.5, zc, 0, { jit: 0 });
  const span = arcadeShape(-BAY / 2, BAY / 2, 3.4, [{ x: 0, w: BAY - 1.9, h: 2.7 }]);
  const bayDeco = (x) => {                                           // dans un groupe dont +Z est l'extérieur, mur en z = HX
    buttress(B, x - BAY / 2, HX, 1.7, 3, 25.6);
    B.extrude(ST, ogiveShape(2.9, 18.6), 0.14, x, 6.2, HX); B.extrude(P.vitrail, ogiveShape(2.3, 18), 0.22, x, 6.5, HX);
    if (B.hi) { B.box(ST, 0.16, 15, 0.3, x, 6.5, HX + 0.14, 0, { jit: 0 }); B.extrude(BR, span, 2.4, x, 24.4, HX); }   // meneau ; arc de décharge entre contreforts
  };
  for (const sx of [-1, 1]) B.group(0, 0, 0, sx * Math.PI / 2, () => {    // +Z local = extérieur ; X local = -sx·Z monde
    for (let i = 0; i < 10; i++) { const x = -sx * (ZW - (i + 0.5) * BAY); if (sx < 0 && i === 8) { buttress(B, x - BAY / 2, HX, 1.7, 3, 25.6); continue; } bayDeco(x); }
    buttress(B, sx > 0 ? -ZE : ZW, HX, 1.7, 3, 25.6);
  });
  for (let i = 0; i < 7; i++) B.group(0, 0, ZE, Math.PI / 2 + (i + 0.5) * Math.PI / 7, () => { const ap = HX * Math.cos(Math.PI / 14); B.extrude(P.vitrail, ogiveShape(2.1, 18), 0.22, 0, 6.5, ap); B.group(0, 0, 0, Math.PI / 14, () => buttress(B, 0, HX - 0.2, 1.5, 2.8, 25.6)); });
  // façade occidentale : pignon nu, portail, oculus ; portail sud
  B.group(0, 0, ZW, 0, () => {
    for (const x of [-HX + 0.9, HX - 0.9]) buttress(B, x, 0, 1.8, 2.6, 26);
    B.extrude(ST, ogiveShape(5.4, 8.6), 0.4, 0, 0, 0); B.extrude(P.bois, ogiveShape(3.6, 6.8), 0.5, 0, 0, 0);
    B.add(new THREE.CircleGeometry(2.2, B.n(18)), P.vitrail, 0, 19, 0.06, 0, { jit: 0 }); B.add(new THREE.RingGeometry(2.2, 2.7, B.n(18)), ST, 0, 19, 0.1, 0, { jit: 0 });
    B.extrude(P.vitrail, ogiveShape(1.6, 7), 0.12, -5, 9, 0); B.extrude(P.vitrail, ogiveShape(1.6, 7), 0.12, 5, 9, 0);
  });
  // ---- clocher octogonal (flanc nord, près du chœur) : quatre étages d'arcs en mitre, sans flèche ----
  const TX = -HX - 3.2, TZ = -21;
  B.box(BR, 9.4, 24 + 3, 9.4, TX, -3, TZ); B.box(ST, 9.9, 0.4, 9.9, TX, 23.6, TZ, 0, { jit: 0 });
  const top = octTower(B, TX, 24, TZ, [{ r: 4.9, h: 5.2, arch: 'mitre' }, { r: 4.7, h: 5.2, arch: 'mitre' }, { r: 4.5, h: 5.2, arch: 'mitre' }, { r: 4.3, h: 5.2, arch: 'mitre' }]);
  B.cyl(ST, 4.6, 4.6, 1.1, TX, top, TZ, 8, { exact: true, ry: Math.PI / 8, open: true }); B.cyl(TL, 0.2, 4.2, 1.2, TX, top, TZ, 8, { exact: true, ry: Math.PI / 8, open: true });
  for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; B.frustum(BR, 0.7, 0.7, 0, 0, 2.4, TX + Math.sin(a) * 4.5, top + 1, TZ + Math.cos(a) * 4.5); }
  // ---- cloître (nord) : galeries à colonnettes de marbre, salle capitulaire, réfectoire ----
  const CX = -30, CZ = 20, G = 13, GW = 4;
  for (let k = 0; k < 4; k++) B.group(CX, 0, CZ, k * Math.PI / 2, () => {
    B.tris(TL, [-G - GW, 5.4, G + GW, G + GW, 5.4, G + GW, G, 4, G, -G - GW, 5.4, G + GW, G, 4, G, -G, 4, G], 0, 0, 0, 0, { up: true });
    B.box(ST, 2 * G, 0.7, 0.6, 0, 0, G); B.box(ST, 2 * G, 0.5, 0.5, 0, 3.5, G, 0, { jit: 0 });
    if (B.hi) for (let i = 0; i < 20; i++) for (const dz of [-0.16, 0.16]) B.box(P.marbre, 0.16, 2.8, 0.16, -G + 0.7 + i * (2 * G - 1.4) / 19, 0.7, G + dz, 0, { jit: 0.05 });
  });
  B.box(P.pelouse, 2 * G, 0.12, 2 * G, CX, 0, CZ, 0, { jit: 0 });
  if (B.hi) for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) B.cyl(mkc(0x23402a), 0.15, 1.3, 9, CX + x, 0, CZ + z, 6);      // cyprès
  const RG = brick({ dep: 9, floors: [{ h: 6, arch: true, w: 1.8, wh: 3.6, sill: 1.2, mat: P.vitrail }, { h: 4, w: 1.3, wh: 2, sill: 1 }], bay: 5.2, roof: 'gable', roofH: 3.4 });
  bwing(m, CX - 1.5, CZ - G - GW - 4.5, 0, { ...RG, len: 38 });                                     // salle capitulaire
  B.group(-27, 0, -14, 0, () => { B.box(BR, 9, 9 + 3, 12, 0, -3, 0); B.gable(BR, TL, 9.6, 2.6, 12.4, 0, 9, 0); halfCyl(B, BR, 4.5, 12, 0, -3, -6, 5, true); halfCone(B, TL, 4.9, 0.1, 2.6, 0, 9, -6, 5, true); });   // chapelle Saint-Antonin
  m.collide.box(-27, -15, 4.8, 8.4);
  bwing(m, CX - G - GW - 6.5, CZ, Math.PI / 2, { ...RG, dep: 13, len: 50, floors: [{ h: 6, w: 1.6, wh: 3, sill: 1.6 }, { h: 5, w: 1.4, wh: 2.4, sill: 1.2 }, { h: 4, w: 1.3, wh: 1.8, sill: 1 }] });
  bwing(m, -44, CZ + G + GW + 5, 0, { ...RG, dep: 10, len: 62, floors: [{ h: 13, w: 2, wh: 8.5, sill: 3, arch: true, mat: P.vitrail }], roofH: 4 });   // grand réfectoire
  m.collide.box(0, zc, HX + 3.2, L / 2 + 0.6); m.collide.circle(0, ZE, HX + 3); m.collide.box(TX, TZ, 5, 5); m.collide.box(0, ZW + 1.4, HX + 0.6, 1.6);
  return { height: 47 };
}
const mkc = (hex) => { const c = new THREE.Color(hex); return { c: [c.r, c.g, c.b], r: 0.95, m: 0, t: 0, g: 0 }; };

// vaisseau gothique générique le long de -Z (x décalé possible) : nef haute, collatéraux, chevet rond, arcs-boutants
function vessel(B, o) {
  const { z0, z1, w, h, aw, ah, rh = 8, wall = BR, roof = TL, bay = 6.5, x = 0, apse = true, fly = true } = o, L = z0 - z1, zc = (z0 + z1) / 2;
  B.group(x, 0, 0, 0, () => {
    B.box(wall, w, h + 3, L, 0, -3, zc); B.gable(wall, roof, w + 1, rh, L + 0.4, 0, h, zc);
    B.box(wall, aw, ah + 3, L, 0, -3, zc);
    for (const sx of [-1, 1]) leanTo(B, roof, sx * (aw / 2 + 0.4), ah, sx * w / 2, ah + 3.4, z0, z1);
    if (apse) { halfCyl(B, wall, aw / 2, ah + 3, 0, -3, z1, 20); halfCyl(B, wall, w / 2, h + 3, 0, -3, z1, 14); halfCone(B, roof, aw / 2 + 0.4, w / 2, 3.4, 0, ah, z1, 20); halfCone(B, roof, w / 2 + 0.5, 0.1, rh, 0, h, z1, 14); }
    const n = Math.max(1, Math.round(L / bay));
    for (const sx of [-1, 1]) B.group(0, 0, zc, sx * Math.PI / 2, () => {
      for (let i = 0; i < n; i++) {
        const lx = -L / 2 + (i + 0.5) * L / n;
        B.extrude(P.vitrail, ogiveShape(bay * 0.36, h - ah - 6), 0.15, lx, ah + 4.6, w / 2); B.extrude(P.vitrail, ogiveShape(bay * 0.36, ah - 4), 0.15, lx, 2.6, aw / 2);
        if (fly) {
          B.box(wall, 1.2, ah + 7, 2.8, lx + L / n / 2, 0, aw / 2 + 0.7); B.frustum(ST, 1.2, 2.8, 0, 0, 2.6, lx + L / n / 2, ah + 7, aw / 2 + 0.7);
          if (B.hi) { const s = new THREE.Shape(), d = (aw - w) / 2; s.moveTo(0, h - 3); s.lineTo(d, ah + 5); s.lineTo(d, ah + 4.2); s.quadraticCurveTo(d * 0.5, ah + 5.5, 0, h - 5.5); s.closePath(); B.extrude(ST, s, 0.6, lx + L / n / 2 + 0.3, 0, w / 2, -Math.PI / 2); }
        }
      }
    });
  });
}

// ====================== Cathédrale Saint-Étienne (façade dissymétrique, clocher-donjon, nef raimondine et grand chœur) ======================
function buildSaintEtienne(m) {
  const { B } = m, ZW = 56.5, ZN = 10, ZA = -33.5, NX = 7, OFF = -3.5, PG = { ...P.stoneG, c: P.stoneG.c.map((v, i) => v * [0.93, 0.9, 0.84][i]) };
  // ---- nef raimondine : large vaisseau unique, bas, en brique ; chapelles et sacristies au sud ----
  B.box(BR, 20, 20 + 3, ZW - ZN, NX, -3, (ZW + ZN) / 2); B.gable(BR, TL, 21, 4, ZW - ZN + 0.4, NX, 20, (ZW + ZN) / 2);
  B.box(BR, 8, 9 + 3, 34, NX + 14, -3, 28); B.tris(TL, [NX + 10, 11.5, 45, NX + 18.3, 9, 45, NX + 18.3, 9, 11, NX + 10, 11.5, 45, NX + 18.3, 9, 11, NX + 10, 11.5, 11], 0, 0, 0, 0, { up: true });
  for (const sx of [-1, 1]) B.group(NX, 0, (ZW + ZN) / 2, sx * Math.PI / 2, () => { for (let i = 0; i < 3; i++) { const x = -15.5 + i * 15.5; if (sx > 0) buttress(B, x - 7.75, 10, 1.8, 2.6, 18); B.extrude(P.vitrail, ogiveShape(2.2, 7.5), 0.15, x, 10.5, 10); } });
  // ---- chœur gothique, plus haut et désaxé vers le nord : collatéraux, chapelles, arcs-boutants ----
  vessel(B, { z0: ZN, z1: ZA, w: 13, h: 30, aw: 43, ah: 14, rh: 8, wall: PG, roof: P.ardoise, bay: 6.2, x: OFF });
  B.box(PG, 13, 31, 1.5, OFF, 0, ZN + 0.4); B.gable(PG, null, 14, 8, 1.5, OFF, 30, ZN + 0.4);                       // mur pignon provisoire du chœur
  if (B.hi) B.add(new THREE.CircleGeometry(2.4, 16), P.vitrail, OFF, 24, ZN + 1.2, 0, { jit: 0 });
  B.group(OFF - 21.5, 0, ZN - 9, -Math.PI / 2, () => { B.box(PG, 12, 22, 3, 0, 0, 1.5); B.extrude(P.shadow, ogiveShape(4, 9), 0.3, 0, 0, 3); rose(B, 0, 15.5, 3.02, 3, ST, 12); });   // portail nord
  // ---- façade occidentale : rose dans l'axe de la nef, portail décalé, gros contrefort sud, clocher-donjon au nord ----
  B.group(NX, 0, ZW, 0, () => {
    B.box(PG, 21, 21, 1.6, 0, 0, 0.3); B.gable(PG, TL, 21.6, 4.4, 1.8, 0, 21, 0.3);
    rose(B, 0, 15, 1.12, 3.4, ST, 12);
    B.extrude(ST, ogiveShape(7.4, 11.4), 0.5, -2.4, 0, 1.1); B.extrude(P.deco, ogiveShape(5.8, 9.8), 0.7, -2.4, 0, 1.1); B.extrude(P.bois, ogiveShape(3.8, 7.2), 0.9, -2.4, 0, 1.1);
    if (B.hi) { B.box(ST, 0.4, 5.4, 0.5, -2.4, 0, 2.1); B.lump(P.deco, -2.4, 6, 2.1, 3, 2, 0.4, 4, 3); for (const x of [4.6, 7.2]) B.statue(P.deco, x, 4, 1.5, 2.2); }
    B.box(BR, 3.2, 22, 3.4, 11.4, 0, 0.8); B.frustum(TL, 3.2, 3.4, 0, 0, 3, 11.4, 22, 0.8);
  });
  // clocher-donjon (56 m) : base de pierre, étages de brique, horloge, crénelage et campanile
  const tx = -7, tz = ZW - 5.6, w = 10.4;
  B.box(PG, w, 22 + 3, w + 1.6, tx, -3, tz); B.box(BR, w - 0.4, 28, w + 1.2, tx, 22, tz); B.box(ST, w + 0.4, 0.5, w + 2, tx, 21.6, tz, 0, { jit: 0 }); B.box(ST, w + 0.3, 0.5, w + 1.9, tx, 36, tz, 0, { jit: 0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(BR, 1.7, 50, 1.7, tx + sx * (w / 2 - 0.45), 0, tz + sz * (w / 2 + 0.35));
  for (let k = 0; k < 4; k++) B.group(tx, 0, tz, k * Math.PI / 2, () => {
    const off = (k % 2 ? w : w + 1.6) / 2 - 0.18;
    for (const x of [-1.7, 1.7]) { B.win(x, 38.5, off, 1.6, 6.5, { mitre: true, mat: P.shadow, frame: false, farMin: 0 }); B.win(x, 26, off, 1.3, 5, { arch: true, mat: P.shadow, frame: false }); }
    if (k === 0) { B.add(new THREE.CircleGeometry(1.6, 16), P.stoneW, 0, 33.4, off + 0.06, 0, { jit: 0 }); B.add(new THREE.RingGeometry(1.6, 1.9, 16), P.ironD, 0, 33.4, off + 0.08, 0, { jit: 0 }); }
    if (B.hi) for (let i = 0; i < 5; i++) B.box(BR, 1, 1.2, 0.5, -4.2 + i * 2.1, 50.6, off - 0.1, 0, { jit: 0.03 });
  });
  B.box(ST, w + 0.6, 0.6, w + 2.2, tx, 50, tz, 0, { jit: 0 }); B.frustum(TL, w - 1.5, w, 2, 2, 2.6, tx, 50.6, tz);
  B.cyl(P.ironD, 0.9, 1.1, 2.6, tx, 53.2, tz, 6); B.cyl(P.ironD, 0.05, 1.2, 1.6, tx, 55.8, tz, 6, { open: true });
  m.collide.box(NX, (ZW + ZN) / 2 + 1, 12.8, (ZW - ZN) / 2 + 1.6); m.collide.box(NX + 14, 28, 4.3, 17.3); m.collide.box(OFF, (ZN + ZA) / 2, 23.6, (ZN - ZA) / 2 + 0.5); m.collide.circle(OFF, ZA, 23.6); m.collide.box(tx, tz, 5.6, 6.4);
  return { height: 58 };
}

// ====================== Basilique Notre-Dame de la Daurade (péristyle dorique face à la Garonne) ======================
function buildDaurade(m) {
  const { B } = m, ZF = 26;
  B.box(BR, 30, 22 + 3, 46, 0, -3, 0); B.gable(BR, TL, 31, 5, 46.4, 0, 22, 0); B.cyl(BR, 9, 9, 22, 0, -3, -23, 16, { t0: Math.PI / 2, tl: Math.PI }); halfCone(B, TL, 9.4, 0.1, 5, 0, 19, -23, 16);
  B.cyl(BR, 7.5, 7.5, 6, 0, 22, -6, 16); B.dome(P.ardoise, 7.7, 5, 0, 28, -6, 16); B.cyl(P.gold, 0.06, 0.3, 2.4, 0, 33, -6, 5);
  // péristyle : six colonnes doriques de pierre, entablement massif, fronton
  B.box(ST, 30, 1.6, 8, 0, 0, ZF - 3); stairs(B, ST, 26, 6, 0.27, 0.42, 0, 0, ZF + 1);
  B.group(0, 1.6, 0, 0, () => { B.colonnade(-12.5, ZF - 0.6, 12.5, ZF - 0.6, 6, 0, 1.25, 12.4, 'dor', ST); B.box(ST, 30, 3, 8, 0, 12.4, ZF - 3); B.gable(ST, TL, 30.6, 5.6, 8.4, 0, 15.4, ZF - 3); });
  B.group(0, 1.6, 23.02, 0, () => { B.win(0, 0, 0, 3.6, 7.5, { mat: P.bois, frameMat: ST, farMin: 0 }); for (const x of [-9, 9]) B.win(x, 1, 0, 2.2, 5, { arch: true, mat: P.shadow, frameMat: ST }); });
  for (const ry of [Math.PI / 2, -Math.PI / 2]) B.group(0, 0, 0, ry, () => B.winRow(-20, 20, 12, 15.02, 5, 2.2, 5.5, { arch: true, mat: P.vitrail, frameMat: ST }));
  m.collide.box(0, 2, 15.4, 26); m.collide.circle(0, -23, 9.3);
  return { height: 36 };
}

// ====================== Notre-Dame de la Dalbade (haut clocher de brique, tympan de céramique) ======================
function buildDalbade(m) {
  const { B } = m, ZF = 28;
  B.box(BR, 20, 26 + 3, 50, 0, -3, 2); B.gable(BR, TL, 21, 4, 50.4, 0, 26, 2); halfCyl(B, BR, 10, 26 + 3, 0, -3, -23, 7, true); halfCone(B, TL, 10.5, 0.1, 4, 0, 26, -23, 7, true);
  for (const sx of [-1, 1]) B.group(0, 0, 2, sx * Math.PI / 2, () => { for (let i = 0; i < 6; i++) { const x = -21 + i * 8.4; buttress(B, x - 4.2, 10, 1.5, 2.2, 24); B.extrude(P.vitrail, ogiveShape(1.8, 10), 0.15, x, 12, 10); } });
  B.group(0, 0, ZF - 1, 0, () => {
    // portail Renaissance et tympan de céramique émaillée (Le Couronnement de la Vierge)
    B.box(ST, 9, 12.5, 1.4, 0, 0, 0.6); B.gable(ST, null, 9.4, 2.2, 1.6, 0, 12.5, 0.6); B.win(0, 0, 1.32, 3.6, 5, { mat: P.bois, frame: false, farMin: 0 });
    B.add(new THREE.CircleGeometry(2.2, 14, 0, Math.PI), mkm(0x2a5fa8, 0.3, 1.2), 0, 5.4, 1.34, 0, { jit: 0 }); B.add(new THREE.CircleGeometry(1.2, 10, 0, Math.PI), mkm(0xe0b23a, 0.3, 1.2), 0, 5.4, 1.37, 0, { jit: 0 });
    for (const x of [-3.4, 3.4]) B.column(x, 0.2, 1.6, 0.4, 6.4, 'cor', ST);
    rose(B, 0, 19, 0.04, 3, ST, 12);
  });
  // clocher (nord-ouest) : tour de brique très élancée, étages d'arcs en mitre, couronnement crénelé
  const tx = -12.5, tz = ZF - 6, w = 8.6;
  B.box(BR, w, 30 + 3, w, tx, -3, tz);
  const top = octTower(B, tx, 30, tz, [{ r: 4.5, h: 6.2, arch: 'mitre' }, { r: 4.3, h: 6.2, arch: 'mitre' }, { r: 4.1, h: 6.2, arch: 'mitre' }, { r: 3.9, h: 6.2, arch: 'mitre' }, { r: 3.7, h: 5.6, arch: 'mitre' }]);
  B.cyl(ST, 4.1, 4.1, 1.1, tx, top, tz, 8, { exact: true, ry: Math.PI / 8, open: true }); octSpire(B, BR, tx, top + 0.3, tz, 3.4, 7);
  m.collide.box(0, 2, 12.4, 26); m.collide.circle(0, -23, 10.3); m.collide.box(tx, tz, 4.6, 4.6);
  return { height: 70 };
}
const mkm = (hex, r, g) => { const c = new THREE.Color(hex); return { c: [c.r, c.g, c.b], r, m: 0, t: 0, g }; };

// ====================== Notre-Dame du Taur (clocher-mur) ======================
function buildTaur(m) {
  const { B } = m;
  B.box(BR, 13, 16 + 3, 42, 0, -3, -22); B.gable(BR, TL, 14, 3.4, 42.4, 0, 16, -22); halfCyl(B, BR, 6.5, 19, 0, -3, -43, 7, true); halfCone(B, TL, 7, 0.1, 3.4, 0, 16, -43, 7, true);
  // clocher-mur : pignon de brique percé de deux rangs de baies en mitre, crénelé, flanqué de deux tourelles
  B.box(BR, 15, 30 + 3, 3, 0, -3, -0.5); B.box(BR, 11, 6, 2.6, 0, 30, -0.5); B.box(BR, 6, 5, 2.4, 0, 36, -0.5);
  B.group(0, 0, 1, 0, () => {
    for (const sx of [-1, 1]) { B.cyl(BR, 1.7, 1.7, 34, sx * 7.4, -2, -1.2, 8, { exact: true }); B.cyl(TL, 0.1, 2, 3.2, sx * 7.4, 32, -1.2, 8, { exact: true, open: true }); }
    for (let i = 0; i < 3; i++) B.win((i - 1) * 3.4, 20.5, 0.02, 1.9, 4.6, { mitre: true, mat: P.shadow, frame: false, farMin: 0 });
    for (const x of [-1.9, 1.9]) B.win(x, 30.6, -0.18, 1.8, 3.4, { mitre: true, mat: P.shadow, frame: false, farMin: 0 });
    B.win(0, 36.8, -0.28, 1.6, 2.4, { mitre: true, mat: P.shadow, frame: false, farMin: 0 });
    B.extrude(ST, ogiveShape(5, 8), 0.3, 0, 0, 0); B.extrude(P.bois, ogiveShape(3.2, 6.2), 0.4, 0, 0, 0);
    if (B.hi) { for (let i = 0; i < 7; i++) B.box(BR, 1, 1.1, 0.6, -6 + i * 2, 30, -0.3, 0, { jit: 0.03 }); for (let i = 0; i < 5; i++) B.box(BR, 0.9, 1, 0.6, -4 + i * 2, 36, -0.3, 0, { jit: 0.03 }); B.box(ST, 15.4, 0.4, 3.4, 0, 19.4, -1.5, 0, { jit: 0 }); B.box(ST, 15.4, 0.4, 3.4, 0, 29.6, -1.5, 0, { jit: 0 }); }
    B.box(BR, 3, 2.4, 2.4, 0, 41, -1.5); B.box(P.ironD, 0.1, 1.6, 0.1, 0, 43.4, -1.5, 0, { jit: 0 });
  });
  m.collide.box(0, -20, 7.8, 23); m.collide.circle(0, -43, 6.8);
  return { height: 45 };
}

// ====================== Couvent des Augustins (musée) : église, clocher tronqué, grand cloître ======================
function buildAugustins(m) {
  const { B } = m;
  // église le long de la rue (au nord du cloître) : vaisseau unique de brique à contreforts
  B.box(BR, 16, 22 + 3, 56, -27, -3, 0); B.gable(BR, TL, 17, 4, 56.4, -27, 22, 0);
  B.group(-27, 0, 0, -Math.PI / 2, () => { for (let i = 0; i < 7; i++) { const x = -24 + i * 8; buttress(B, x - 4, 8, 1.5, 2.2, 20.5); B.extrude(P.vitrail, ogiveShape(1.8, 9), 0.15, x, 9, 8); } });
  const top = octTower(B, -16.5, 22, -24, [{ r: 4.6, h: 5.6, arch: 'mitre' }, { r: 4.4, h: 5.6, arch: 'mitre' }]);
  B.box(BR, 9.4, 25, 9.4, -16.5, -3, -24); B.cyl(TL, 0.2, 4.8, 2.4, -16.5, top, -24, 8, { exact: true, ry: Math.PI / 8, open: true });
  // grand cloître gothique et ailes du musée (aile Darcy sur la rue d'Alsace-Lorraine)
  const G = 19, GW = 4;
  for (let k = 0; k < 4; k++) B.group(8, 0, 0, k * Math.PI / 2, () => {
    B.tris(TL, [-G - GW, 6, G + GW, G + GW, 6, G + GW, G, 4.4, G, -G - GW, 6, G + GW, G, 4.4, G, -G, 4.4, G], 0, 0, 0, 0, { up: true });
    B.box(ST, 2 * G, 0.7, 0.6, 0, 0, G); B.box(ST, 2 * G, 0.5, 0.5, 0, 3.9, G, 0, { jit: 0 });
    if (B.hi) for (let i = 0; i < 24; i++) for (const dz of [-0.16, 0.16]) B.box(ST, 0.18, 3.2, 0.18, -G + 0.8 + i * (2 * G - 1.6) / 23, 0.7, G + dz, 0, { jit: 0.05 });
  });
  B.box(P.pelouse, 2 * G, 0.12, 2 * G, 8, 0, 0, 0, { jit: 0 });
  const W = brick({ dep: 12, floors: [{ h: 7, arch: true, w: 2.2, wh: 4.6, sill: 1 }, { h: 6, w: 1.8, wh: 3.6, sill: 1.2 }], bay: 5, roofH: 3 });
  bwing(m, 8 + G + GW + 6, 0, Math.PI / 2, { ...W, len: 2 * (G + GW) + 24 }); bwing(m, 8, G + GW + 6, 0, { ...W, len: 2 * (G + GW) }); bwing(m, 8, -G - GW - 6, 0, { ...W, len: 2 * (G + GW) });
  m.collide.box(-27, 0, 10.4, 28.4); m.collide.box(-16.5, -24, 5, 5);
  return { height: 36 };
}

export const DEFS = { tls_saintsernin: buildSaintSernin, tls_jacobins: buildJacobins, tls_saintetienne: buildSaintEtienne, tls_daurade: buildDaurade, tls_dalbade: buildDalbade, tls_taur: buildTaur, tls_augustins: buildAugustins };

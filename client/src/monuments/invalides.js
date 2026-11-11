// Les Invalides : église du Dôme (dôme doré, 107 m), façade sud à deux ordres, église Saint-Louis et ailes de l'Hôtel.
import * as THREE from 'three';
import { P, wing, stairs, domeLune } from './kit.js';

export function buildInvalides(m) {
  const { B } = m, S = P.stone, PY = 1.8;
  B.box(P.stoneD, 54, PY + 3, 54, 0, -3, 0); stairs(B, P.stoneL, 24, 9, PY / 9, 0.5, 0, 0, 28.5);
  m.collide.box(0, 0, 27.3, 27.3); m.collide.box(0, 30.5, 12.3, 2.6);
  B.group(0, PY, 0, 0, () => {
    // ---- corps carré à deux niveaux ----
    B.box(S, 50, 15, 50, 0, 0, 0); B.box(P.stoneL, 51.6, 1.2, 51.6, 0, 14.4, 0);
    B.box(S, 49, 12.6, 49, 0, 15.6, 0); B.box(P.stoneL, 51, 1.3, 51, 0, 28.2, 0); B.box(S, 48, 1.4, 48, 0, 29.5, 0);
    B.frustum(P.slate, 48, 48, 34, 34, 2.5, 0, 30.9, 0);
    for (let k = 0; k < 4; k++) B.group(0, 0, 0, k * Math.PI / 2, () => {
      if (k === 0) return;
      for (const x of [-18, -9, 0, 9, 18]) { B.win(x, 3.5, 25, 2.6, 6, { arch: true }); B.win(x, 18.5, 24.5, 2.4, 5.5, { arch: true }); }
      if (B.hi) for (const x of [-22.5, -13.5, -4.5, 4.5, 13.5, 22.5]) { B.box(P.stoneL, 1.3, 13.6, 0.5, x, 0.6, 25.1); B.box(P.stoneL, 1.2, 11.6, 0.5, x, 16, 24.6); }
    });
    // ---- façade sud : avant-corps, ordres dorique puis corinthien, fronton ----
    B.box(S, 24, 28.6, 3, 0, 0, 25.6); B.box(P.stoneL, 25.4, 1.2, 4.2, 0, 14.4, 25.8); B.box(P.stoneL, 25.4, 1.3, 4.2, 0, 28.2, 25.8);
    B.gable(P.deco, P.slate, 17, 5.2, 4, 0, 29.5, 25.8);
    B.group(0, 0, 27.1, 0, () => {
      B.win(0, 0, 0, 4.4, 8.5, { arch: true, mat: P.shadow, farMin: 0 }); B.win(0, 18, 0, 3.6, 6.5, { arch: true, farMin: 0, lit: 1 });
      for (const sx of [-1, 1]) {
        B.win(sx * 8.4, 3, 0, 2.2, 5, { mat: P.shadow }); B.win(sx * 8.4, 18.5, 0, 2.2, 5, { mat: P.shadow });
        if (B.hi) { B.statue(P.stoneL, sx * 8.4, 3.2, 0.5, 3.6); B.statue(P.stoneL, sx * 8.4, 18.7, 0.5, 3.4); B.statue(P.stoneL, sx * 10.5, 30.8, -1, 3); B.statue(P.stoneL, sx * 7, 30.8, -1, 3); }
        for (const x of [3.6, 5.6, 10.8]) { B.column(sx * x, 0.4, 1.3, 0.72, 13.8, 'dor'); B.column(sx * x, 15.7, 1.3, 0.62, 12.4, 'cor'); }
      }
      for (const sx of [-1, 1]) { B.win(sx * 18.5, 3.5, -2.1, 2.6, 6, { arch: true }); B.win(sx * 18.5, 18.5, -2.6, 2.4, 5.5, { arch: true }); }
    });
    // ---- tambour ----
    B.cyl(S, 15.4, 15.8, 5, 0, 30.9, 0, 40);
    B.cyl(S, 13.4, 13.4, 14.5, 0, 35.9, 0, 40); B.cyl(P.stoneL, 15.6, 15.2, 1.6, 0, 50.4, 0, 40);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = i * Math.PI * 2 / n;
      B.group(0, 0, 0, a, () => { B.win(0, 38.5, 13.42, 2.5, 7, { arch: true, frame: false, farMin: 0 }); });
      B.group(0, 0, 0, a + Math.PI / n, () => {
        B.box(S, 2.6, 14.5, 2.2, 0, 35.9, 13.9);                         // contrefort
        for (const x of [-1.9, 1.9]) B.column(x, 36.3, 14.5, 0.55, 14, 'cor');
      });
    }
    // ---- attique ----
    B.cyl(S, 12.3, 12.3, 8.6, 0, 52, 0, 40); B.cyl(P.stoneL, 13.6, 13.2, 1.1, 0, 60.6, 0, 40);
    for (let i = 0; i < n; i++) B.group(0, 0, 0, i * Math.PI * 2 / n, () => {
      B.win(0, 54, 12.32, 2, 4.2, { arch: true, frame: false, farMin: 0 });
      if (B.hi) B.group(0, 0, 0, Math.PI / n, () => { B.lump(P.stoneL, 0, 52, 13.2, 1.6, 6, 1.6, 4, i + 3); B.statue(P.stoneL, 0, 61.7, 12.6, 2.4); });
    });
    // ---- dôme doré : calotte d'or, côtes et panneaux de plomb à trophées ----
    const DY = 61.7, R = 13.1, DH = 19;
    B.dome(P.gold, R, DH, 0, DY, 0, 48);
    for (let i = 0; i < n; i++) {
      const a = i * Math.PI * 2 / n;
      B.add(domeLune(R * 1.006, DH * 1.004, a + 0.075, Math.PI * 2 / n - 0.15, 0.12, 0.93, B.far ? 4 : 10), P.lead, 0, DY, 0, 0, { uv: 'cyl', r: R });
      if (B.hi) for (const [t, w, h] of [[0.2, 2.6, 3.2], [0.42, 2.2, 2.8], [0.62, 1.5, 2.2]]) {      // trophées dorés
        const th = (1 - t) * Math.PI / 2, rr = R * Math.sin(th) * 1.02, am = a + Math.PI / n;
        B.box(P.gold, w, h, 0.3, Math.sin(am) * rr, DY + DH * Math.cos(th) * 1.0 - h / 2, Math.cos(am) * rr, am, { jit: 0 });
      }
    }
    // ---- lanternon et flèche ----
    B.cyl(P.gold, 4.2, 4.6, 1.2, 0, DY + DH - 0.6, 0, 16); B.cyl(P.shadow, 2.3, 2.3, 7, 0, DY + DH + 0.6, 0, 12);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; B.cyl(P.gold, 0.32, 0.36, 7, Math.sin(a) * 2.8, DY + DH + 0.6, Math.cos(a) * 2.8, 8); }
    B.cyl(P.gold, 3.6, 3.4, 0.9, 0, DY + DH + 7.6, 0, 16); B.dome(P.gold, 3.1, 2.6, 0, DY + DH + 8.5, 0, 16);
    B.cyl(P.gold, 0.12, 1.5, 13.6, 0, DY + DH + 10.6, 0, 8); B.box(P.gold, 0.2, 2.2, 0.2, 0, DY + DH + 24, 0); B.box(P.gold, 1.2, 0.2, 0.2, 0, DY + DH + 25.4, 0);
  });
  // ---- église Saint-Louis (nef des soldats), entre le Dôme et la cour d'honneur ----
  B.box(S, 24, 25, 126, 0, -3, -88); B.gable(S, P.slate, 25, 8, 126.5, 0, 22, -88);
  B.box(S, 40, 15, 126, 0, -3, -88);
  for (const sx of [-1, 1]) B.tris(P.slate, [sx * 12, 17, -25, sx * 20.4, 12, -25, sx * 20.4, 12, -151, sx * 12, 17, -25, sx * 20.4, 12, -151, sx * 12, 17, -151], 0, 0, 0, 0, { up: true });
  for (const ry of [Math.PI / 2, -Math.PI / 2]) B.group(0, 0, -88, ry, () => { B.winRow(-60, 60, 17.5, 12, 14, 2.2, 3.4, { arch: true, mat: P.vitrail }); B.winRow(-60, 60, 3, 20, 14, 2.2, 5.5, { arch: true }); });
  m.collide.box(0, -88, 20.3, 63.3);
  return { height: 107 };
}

// Hôtel des Invalides : façade nord (196 m) et son portail, cour d'honneur à deux niveaux d'arcades, cours latérales,
// batterie triomphale (canons de bronze) face à l'esplanade. Origine = centre de la cour d'honneur, +Z vers le Dôme.
export function buildHotelInvalides(m) {
  const { B } = m, S = P.stone;
  const F = [{ h: 6, arch: true, w: 2.4, wh: 3.8, sill: 0.8 }, { h: 5.5, w: 1.9, wh: 3.2 }, { h: 5, w: 1.8, wh: 2.6 }];
  const ARC = [{ h: 7.5, arch: true, w: 3.3, wh: 4.6, sill: 0.3, lit: 0.15 }, { h: 7, arch: true, w: 3.3, wh: 4.2, sill: 0.4, lit: 0.4 }];
  const W = { dep: 16, floors: F, bay: 4.6, roof: 'mansard', roofH: 6, roofMat: P.slate };
  const ZN = -92;
  // façade nord et portail central (arc triomphal, Louis XIV équestre)
  wing(m, 0, ZN, 0, { ...W, len: 196, dep: 18, gates: [{ x: 0, w: 11, h: 10 }] });
  B.group(0, 0, ZN - 9.7, Math.PI, () => {
    B.extrude(P.stoneL, arcRingBig(9.5, 1.6), 0.6, 0, 16.5 - 9.5 + 0, 0); B.lump(P.deco, 0, 11.5, 0.5, 7, 5.5, 1, 5, 9);
    for (const sx of [-1, 1]) { B.box(P.stoneL, 2.2, 16.5, 1.4, sx * 7.4, 0, 0.3); B.statue(P.deco, sx * 7.4, 4, 1.3, 3.4); }
    if (B.hi) for (let i = 0; i < 20; i++) for (const sx of [-1, 1]) B.lump(P.deco, sx * (14 + i * 4.3), 17.4, -0.4, 1.4, 2.2, 0.8, 2, i);   // lucarnes à trophées
  });
  for (const sx of [-1, 1]) { pavilionEnd(B, sx * 92, ZN); }
  // cour d'honneur (102 × 64 m) : galeries à arcades sur deux niveaux
  for (const sx of [-1, 1]) wing(m, sx * 40, -32, Math.PI / 2, { ...W, floors: ARC, len: 102, bay: 5.1, pil: true });
  wing(m, 0, 27, 0, { ...W, floors: ARC, len: 96, bay: 5.1, pil: true });
  B.group(0, 0, 19, Math.PI, () => {                                           // pavillon sud : entrée de Saint-Louis, statue de Napoléon
    B.box(S, 16, 20, 2, 0, 0, 0.4); B.gable(P.deco, P.slate, 16.6, 4, 2.4, 0, 20, 0.4);
    B.win(0, 0.3, 1.42, 4, 6.5, { arch: true, mat: P.shadow, farMin: 0 }); B.win(0, 9, 1.42, 3.4, 5.5, { arch: true, mat: P.shadow, farMin: 0 }); B.statue(P.bronze, 0, 9.3, 1.9, 3.6);
    for (const x of [-6, -3.6, 3.6, 6]) { B.column(x, 0.3, 1.9, 0.5, 7.4, 'ion'); B.column(x, 8.2, 1.9, 0.45, 6.8, 'cor'); }
  });
  // cours latérales : ailes extérieures et transversales
  for (const sx of [-1, 1]) {
    wing(m, sx * 98, 5, Math.PI / 2, { ...W, len: 176 });
    wing(m, sx * 69, 27, 0, { ...W, len: 42, chimneys: false }); wing(m, sx * 56, 102, 0, { ...W, len: 84 });
    wing(m, sx * 69, -40, 0, { ...W, len: 42, chimneys: false });
  }
  // batterie triomphale : canons de bronze sur affûts, tournés vers l'esplanade
  for (let i = 0; i < 16; i++) {
    const x = (i - 7.5) * 9.5 + (i < 8 ? -6 : 6), z = ZN - 26;
    B.box(P.ironD, 1.1, 0.7, 2.4, x, 0, z, 0, { jit: 0 });
    B.add(new THREE.CylinderGeometry(0.2, 0.3, 3.3, 8).rotateX(-Math.PI / 2 + 0.07), P.verdigris, x, 1.05, z - 0.5, 0, { jit: 0.1 });
    if (B.hi) for (const sx of [-1, 1]) B.add(new THREE.CylinderGeometry(0.75, 0.75, 0.16, 12).rotateZ(Math.PI / 2), P.ironD, x + sx * 0.72, 0.75, z + 0.3, 0, { jit: 0 });
    m.collide.circle(x, z, 1.3, -10, 2.5);
  }
  B.box(P.stoneD, 170, 0.9, 0.9, 0, 0, ZN - 21);                                 // parapet du fossé
  return { height: 34 };
}
function arcRingBig(r, t) { const s = new THREE.Shape(); s.absarc(0, 0, r + t, 0, Math.PI, false); s.lineTo(-r, 0); s.absarc(0, 0, r, Math.PI, 0, true); s.closePath(); return s; }
function pavilionEnd(B, x, z) { B.box(P.stone, 14, 20, 20, x, 0, z); B.frustum(P.slate, 14.6, 20.6, 6, 9, 8, x, 20, z); }

// Les Invalides : église du Dôme (dôme doré, 107 m), façade sud à deux ordres, église Saint-Louis et ailes de l'Hôtel.
import * as THREE from 'three';
import { P, palaceWing, stairs, domeLune } from './kit.js';

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
  // ---- église Saint-Louis (nef des soldats) au nord ----
  B.box(S, 24, 25, 62, 0, -3, -56); B.gable(S, P.slate, 25, 8, 62.5, 0, 22, -56);
  for (const ry of [Math.PI / 2, -Math.PI / 2]) B.group(0, 0, -56, ry, () => { B.winRow(-28, 28, 12, 12, 9, 2.4, 6, { arch: true, mat: P.vitrail }); B.winRow(-28, 28, 3, 12, 9, 2, 4.5, { arch: true }); });
  m.collide.box(0, -56, 12.3, 31.3);
  // ---- ailes de l'Hôtel des Invalides ----
  const floors = [{ h: 6, arch: true, w: 2.4, wh: 3.6, sill: 0.9 }, { h: 5.5, w: 1.9, wh: 3.2 }, { h: 5, w: 1.8, wh: 2.6 }];
  for (const sx of [-1, 1]) {
    B.group(sx * 44, 0, -52, Math.PI / 2, () => palaceWing(B, { len: 72, dep: 13, floors, bay: 4.5, roof: 'mansard', roofH: 6, roofMat: P.slate }));
    m.collide.box(sx * 44, -52, 6.9, 36.4);
    B.group(sx * 28, 0, -82, 0, () => palaceWing(B, { len: 19, dep: 12, floors, bay: 4.5, roof: 'mansard', roofH: 6, roofMat: P.slate, chimneys: false }));
    m.collide.box(sx * 28, -82, 10, 6.4);
  }
  return { height: 107 };
}

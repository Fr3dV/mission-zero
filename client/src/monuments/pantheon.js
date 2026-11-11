// Panthéon : plan en croix grecque, péristyle corinthien à fronton, dôme à colonnade (83 m).
import { P, stairs, domeLune } from './kit.js';

export function buildPantheon(m) {
  const { B } = m, S = P.stone, PY = 2.4, ZP = 46.5, CZ = -10;
  B.box(P.stoneD, 86, PY + 3, 34, 0, -3, CZ); B.box(P.stoneD, 34, PY + 3, 98, 0, -3, -11); B.box(P.stoneD, 40, PY + 3, 14, 0, -3, 42.5);
  stairs(B, P.stoneL, 31, 11, PY / 11, 0.5, 0, 0, 49.5);
  m.collide.box(0, CZ, 43.3, 17.3); m.collide.box(0, -11, 17.3, 49.3); m.collide.box(0, 45.5, 20.3, 9.6);
  B.group(0, PY, 0, 0, () => {
    // ---- bras de la croix : murs aveugles, frise de guirlandes, corniche ----
    const arm = (w, d, x, z) => {
      B.box(S, w, 24, d, x, 0, z); B.box(P.deco, w + 0.3, 2.4, d + 0.3, x, 19.2, z); B.box(P.stoneL, w + 1.6, 1.1, d + 1.6, x, 23.6, z);
      B.box(S, w - 0.4, 2.4, d - 0.4, x, 24.7, z); B.frustum(P.lead, w - 1, d - 1, Math.max(1, w - d), Math.max(1, d - w), 3.2, x, 27.1, z);
    };
    arm(32, 94, 0, -11); arm(84, 32, 0, CZ);
    if (B.hi) { // panneaux en creux rythmant les murs
      for (const ry of [Math.PI / 2, -Math.PI / 2]) B.group(0, 0, 0, ry, () => { for (const zw of [30, 22, 14, -34, -42, -50]) B.box(P.stoneD, 4.2, 9, 0.2, ry > 0 ? -zw : zw, 6, 16.02, 0, { jit: 0.02 }); });
      for (const ry of [0, Math.PI]) B.group(0, 0, CZ, ry, () => { for (const x of [-36, -28, -20, 20, 28, 36]) B.box(P.stoneD, 4.2, 9, 0.2, x, 6, 16.02, 0, { jit: 0.02 }); });
    }
    // ---- péristyle ----
    const r = 1.0, h = 19;
    B.colonnade(-13, ZP, 13, ZP, 6, 0, r, h, 'cor');
    for (const sx of [-1, 1]) { B.column(sx * 13, 0, ZP - 5.2, r, h, 'cor'); B.column(sx * 7.8, 0, ZP - 5.2, r, h, 'cor'); B.column(sx * 2.6, 0, ZP - 5.2, r, h, 'cor'); B.column(sx * 13, 0, ZP - 10.4, r, h, 'cor'); B.column(sx * 18.2, 0, ZP - 10.4, r, h, 'cor'); B.column(sx * 18.2, 0, ZP - 5.2, r, h, 'cor'); }
    B.box(P.stoneL, 29, 1.4, 13.4, 0, h, ZP - 5.2); B.box(S, 28.6, 1.9, 13, 0, h + 1.4, ZP - 5.2); B.box(P.stoneL, 30.6, 1, 15, 0, h + 3.3, ZP - 5.2);
    B.box(P.stoneL, 40, 1.4, 3, 0, h, ZP - 9.6); B.box(S, 39.6, 1.9, 2.8, 0, h + 1.4, ZP - 9.6); B.box(P.stoneL, 41.4, 1, 4.2, 0, h + 3.3, ZP - 9.6);
    B.gable(P.deco, P.lead, 30.6, 7, 15, 0, h + 4.3, ZP - 5.2);
    B.box(P.bronze, 18, 0.7, 0.1, 0, h + 2, ZP + 1.32, 0, { jit: 0 });     // « Aux grands hommes la patrie reconnaissante »
    B.lump(P.stoneL, 0, h + 4.6, ZP + 1.9, 16, 4.6, 0.9, 12, 4);
    B.box(P.stoneD, 31, 19, 0.2, 0, 0, 36.02, 0, { jit: 0 });                // fond du pronaos, plus sombre (contraste des colonnes)
    B.group(0, 0, 36.14, 0, () => { B.win(0, 0, 0, 4.4, 9.5, { mat: P.bronze, farMin: 0 }); for (const x of [-7.8, 7.8]) B.win(x, 0, 0, 2.6, 6, { mat: P.bronze }); });
    // ---- dôme ----
    B.box(S, 34, 4.6, 34, 0, 24.7, CZ);
    B.cyl(S, 17.2, 17.6, 4.4, 0, 29.3, CZ, 48); B.cyl(P.stoneL, 17.6, 17.6, 0.7, 0, 33.7, CZ, 48);
    B.cyl(S, 12.8, 12.8, 12.6, 0, 34.4, CZ, 48);
    const n = 32;
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) * Math.PI * 2 / n;
      B.column(Math.sin(a) * 15.9, 34.4, CZ + Math.cos(a) * 15.9, 0.66, 11.6, 'cor');
      if (i % 2 === 0) B.group(0, 0, CZ, a + Math.PI / n, () => B.win(0, 36.4, 12.82, 2, 6.6, { arch: true, frame: false, farMin: 0, lit: 0.6 }));
    }
    B.cyl(P.stoneL, 16.8, 16.6, 1.0, 0, 46, CZ, 48, { open: false }); B.cyl(S, 16.6, 16.6, 1.3, 0, 47, CZ, 48); B.cyl(P.stoneL, 17.3, 17, 0.7, 0, 48.3, CZ, 48);
    if (B.hi) for (let i = 0; i < 64; i++) { const a = i * Math.PI / 32; B.box(P.stoneL, 0.3, 1.1, 0.3, Math.sin(a) * 16.9, 49, CZ + Math.cos(a) * 16.9, a, { jit: 0 }); }
    B.torus(P.stoneL, 16.9, 0.18, 0, 50.1, CZ, 48);
    B.cyl(S, 12.4, 12.6, 8.4, 0, 47, CZ, 48); B.cyl(P.stoneL, 13.3, 13, 0.9, 0, 55.4, CZ, 48);
    for (let i = 0; i < 16; i++) B.group(0, 0, CZ, i * Math.PI / 8, () => B.win(0, 50.5, 12.5, 1.8, 3.4, { arch: true, frame: false, farMin: 0 }));
    B.dome(P.lead, 12.6, 14.2, 0, 56.3, CZ, 48);
    if (B.hi) for (let i = 0; i < 32; i++) B.add(domeLune(12.75, 14.35, i * Math.PI / 16 - 0.022, 0.044, 0.02, 0.97, 10), P.zinc, 0, 56.3, CZ, 0, { uv: 'cyl', r: 12 });
    B.cyl(P.stoneL, 3.6, 4, 1, 0, 70.2, CZ, 16); B.cyl(P.shadow, 2.3, 2.3, 6, 0, 71.2, CZ, 12);
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; B.cyl(P.stoneL, 0.3, 0.33, 6, Math.sin(a) * 2.8, 71.2, CZ + Math.cos(a) * 2.8, 8); }
    B.cyl(P.stoneL, 3.5, 3.3, 0.8, 0, 77.2, CZ, 16); B.dome(P.lead, 3, 2.6, 0, 78, CZ, 16);
    B.box(P.gold, 0.2, 2.3, 0.2, 0, 80.6, CZ); B.box(P.gold, 1.2, 0.2, 0.2, 0, 81.9, CZ);
  });
  return { height: 85 };
}

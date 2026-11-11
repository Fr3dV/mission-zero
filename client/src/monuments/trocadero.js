// Trocadéro — palais de Chaillot : deux pavillons de tête, deux ailes en arc de cercle (≈ 195 m chacune, rayon ≈ 284 m)
// embrassant les jardins, parvis des Droits de l'homme (statues dorées) ouvert sur la Tour Eiffel,
// fontaines de Varsovie en contrebas (grand bassin, canons à eau et jets animés).
import { P, slab, Water } from './kit.js';

export function buildTrocadero(m) {
  const { B, kit } = m, S = P.stoneL, CZ = 212, R = 284, D2R = Math.PI / 180;
  const at = (deg, r = R) => [r * Math.sin(deg * D2R), CZ - r * Math.cos(deg * D2R)];
  // ---- parvis ----
  slab(B, P.pave, [[-31, -88], [31, -88], [31, 9], [-31, 9]], -0.5, 0.75);
  if (B.hi) { for (let i = 0; i < 11; i++) B.box(P.paveD, 60, 0.03, 0.9, 0, 0.25, -84 + i * 9, 0, { jit: 0 }); for (const x of [-20, -10, 0, 10, 20]) B.box(P.paveD, 0.9, 0.03, 95, x, 0.25, -39.5, 0, { jit: 0 }); }
  for (const sx of [-1, 1]) { B.box(P.stoneD, 22, 1.3, 1.1, sx * 20, 0, 9.4); m.collide.box(sx * 20, 9.4, 11, 0.7, 0, -10, 2); }      // garde-corps du belvédère (ouvert au centre)
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { const z = -62 + i * 13; B.box(S, 1.8, 2.6, 1.8, sx * 27, 0.25, z); B.statue(P.gold, sx * 27, 2.85, z, 3.6, -sx * Math.PI / 2); m.collide.circle(sx * 27, z, 1.2, -10, 7); }
  for (const sx of [-1, 1]) {
    // ---- pavillon de tête ----
    const px = sx * 45, pz = -47;
    B.group(px, 0, pz, 0, () => {
      B.box(S, 27, 35, 44, 0, -3, 0); B.box(P.stone, 28, 1.2, 45, 0, 32, 0); B.box(S, 25, 2.4, 42, 0, 33.2, 0);
      for (const s of [1, -1]) B.group(0, 0, s * 22, s > 0 ? 0 : Math.PI, () => {
        B.winRow(-10, 10, 6, 0.02, 5, 1.9, 19, { lit: 0.5, farMin: 0, frame: false }); B.box(P.gold, 22, 0.5, 0.12, 0, 28.3, 0.06, 0, { jit: 0 });   // inscriptions de Paul Valéry
        if (B.hi) for (let i = 0; i <= 5; i++) B.box(P.stone, 0.9, 25, 0.5, -10 + i * 4, 2.5, 0.1, 0, { jit: 0.02 });
      });
      for (const s of [1, -1]) B.group(s * 13.5, 0, 0, s * Math.PI / 2, () => { B.winRow(-18, 18, 6, 0.02, 9, 1.9, 19, { lit: 0.5, farMin: 0, frame: false }); if (B.hi) for (let i = 0; i <= 9; i++) B.box(P.stone, 0.9, 25, 0.5, -18 + i * 4, 2.5, 0.1, 0, { jit: 0.02 }); });
      B.group(-sx * 13.52, 0, -6, -sx * Math.PI / 2, () => B.win(0, 0, 0.3, 6, 9, { mat: P.shadow, farMin: 0 }));
      B.box(S, 5, 6, 5, -sx * 10, 0, 24.5); B.lump(P.bronze, -sx * 10, 6, 24.5, 4, 7, 3.4, 8, sx + 2);                              // Apollon / Hercule
    });
    m.collide.box(px, pz, 13.8, 22.3);
    // ---- aile courbe : segments tangents au cercle ----
    const N = B.far ? 6 : 14, A0 = 12.6, A1 = 48.2, da = (A1 - A0) / N, len = R * da * D2R + 0.6;
    for (let i = 0; i < N; i++) {
      const a = sx * (A0 + (i + 0.5) * da), [x, z] = at(a);
      B.group(x, 0, z, -a * D2R, () => {
        B.box(S, len, 21, 20, 0, -3, 0); B.box(P.stoneD, len, 2.4, 20.4, 0, 0, 0); B.box(P.stone, len + 0.2, 0.9, 21, 0, 18, 0); B.box(S, len, 1.8, 17, 0, 18.9, 0);
        const nw = B.far ? 3 : 4;
        for (const s of [1, -1]) B.group(0, 0, s * 10, s > 0 ? 0 : Math.PI, () => {
          B.winRow(-len / 2, len / 2, 3.6, 0.02, nw, 1.6, 12, { lit: 0.45, farMin: 0, frame: false });
          if (B.hi) for (let k = 0; k <= nw; k++) B.box(P.stone, 0.8, 15.4, 0.4, -len / 2 + k * len / nw, 2.4, 0.1, 0, { jit: 0.02 });
        });
      });
      m.collide.box(x, z, len / 2, 10.2, -a * D2R);
    }
    // ---- pavillon d'extrémité ----
    const ae = sx * 50.1, [ex, ez] = at(ae), ery = -ae * D2R;
    B.group(ex, 0, ez, ery, () => {
      B.box(S, 20, 28, 26, 0, -3, 0); B.box(P.stone, 21, 1, 27, 0, 25, 0);
      for (const s of [1, -1]) B.group(0, 0, s * 13, s > 0 ? 0 : Math.PI, () => B.winRow(-8, 8, 4, 0.02, 4, 1.8, 16, { lit: 0.5, farMin: 0, frame: false }));
      B.group(sx * 10, 0, 0, sx * Math.PI / 2, () => B.winRow(-11, 11, 4, 0.02, 6, 1.8, 16, { lit: 0.5, farMin: 0, frame: false }));
    });
    m.collide.box(ex, ez, 10.3, 13.3, ery);
  }
  // ---- fontaines de Varsovie : cascade, grand bassin, 20 canons à eau, rangées de jets ----
  const FX = -2;
  B.box(P.stoneD, 46, 2.2, 14, FX, -0.4, 52); B.box(P.water, 42, 0.12, 10, FX, 1.8, 52, 0, { jit: 0 });
  B.box(P.stoneD, 46, 1.1, 124, FX, -0.4, 121); B.box(P.water, 43, 0.12, 121, FX, 0.66, 121, 0, { jit: 0 });
  for (const sx of [-1, 1]) { B.box(S, 4, 4.4, 4, FX + sx * 26, 0, 47); B.lump(sx > 0 ? P.gold : P.bronze, FX + sx * 26, 4.4, 47, 3.2, 5, 2.8, 5, sx + 31); m.collide.box(FX + sx * 26, 47, 2.2, 2.2); }
  m.collide.box(FX, 114, 23, 69);
  if (B.hi) {
    const W = new Water();
    W.sheet(FX - 21, 59.2, FX + 21, 59.2, 1.8, 0.7, 40);
    for (let i = 0; i < 20; i++) { const x = FX - 19 + i * 2; W.arc([x, 2, 56], [x, 0.7, 112 + (i % 2) * 6], 7.5, 0.16, 12); }
    for (let i = 0; i < 14; i++) for (const sx of [-1, 1]) W.jet(FX + sx * 18, 0.7, 70 + i * 8, 5 + (i % 3), 0.1);
    for (let i = 0; i < 7; i++) W.jet(FX - 12 + i * 4, 0.7, 176, 9, 0.14);
    m.add(W.mesh(kit, 'trocadero:eau'));
  }
  return { height: 36 };
}

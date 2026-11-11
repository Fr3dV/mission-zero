// Trocadéro — palais de Chaillot : deux ailes courbes embrassant les jardins, deux pavillons de tête,
// parvis des Droits de l'homme (statues dorées) ouvert sur la Tour Eiffel, bassin de la fontaine de Varsovie.
import { P, slab } from './kit.js';

export function buildTrocadero(m) {
  const { B } = m, S = P.stoneL, CZ = 55, R = 85, D2R = Math.PI / 180;
  const at = (deg, r = R) => [r * Math.sin(deg * D2R), CZ - r * Math.cos(deg * D2R)];
  // ---- parvis ----
  slab(B, P.pave, [[-24, -52], [24, -52], [24, 6], [-24, 6]], -0.5, 0.75);
  if (B.hi) { for (let i = 0; i < 7; i++) B.box(P.paveD, 46, 0.03, 0.9, 0, 0.25, -48 + i * 8.5, 0, { jit: 0 }); for (const x of [-12, 0, 12]) B.box(P.paveD, 0.9, 0.03, 56, x, 0.25, -23, 0, { jit: 0 }); }
  B.box(P.stoneD, 50, 1.4, 1.2, 0, 0, 6.6);                                  // garde-corps du belvédère
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { const z = -34 + i * 11; B.box(S, 1.8, 2.6, 1.8, sx * 21, 0.25, z); B.statue(P.gold, sx * 21, 2.85, z, 3.4, -sx * Math.PI / 2); }
  // ---- une aile (sx = ±1) ----
  for (const sx of [-1, 1]) {
    // pavillon de tête
    const [px, pz] = at(sx * 24.5), pry = -sx * 24.5 * D2R;
    B.group(px, 0, pz, pry, () => {
      B.box(S, 24, 34, 34, 0, -3, 0); B.box(P.stone, 25, 1.2, 35, 0, 31, 0); B.box(S, 22, 2.4, 32, 0, 32.2, 0);
      B.box(P.gold, 20, 0.5, 0.12, 0, 27.6, 17.05, 0, { jit: 0 }); B.box(P.gold, 20, 0.5, 0.12, 0, 27.6, -17.05, 0, { jit: 0 });  // inscriptions de Paul Valéry
      for (const s of [1, -1]) B.group(0, 0, s * 17, s > 0 ? 0 : Math.PI, () => { B.winRow(-9, 9, 5, 0.02, 5, 1.7, 19, { lit: 0.5, farMin: 0, frame: false }); if (B.hi) for (let i = 0; i <= 5; i++) B.box(P.stone, 0.8, 24, 0.5, -9 + i * 3.6, 2.5, 0.1, 0, { jit: 0.02 }); });
      B.group(-sx * 12, 0, 0, -sx * Math.PI / 2, () => { B.winRow(-13, 13, 5, 0.02, 7, 1.7, 19, { lit: 0.5, farMin: 0, frame: false }); B.win(0, 0, 0.3, 5, 8, { mat: P.shadow, farMin: 0 }); if (B.hi) for (let i = 0; i <= 7; i++) B.box(P.stone, 0.8, 24, 0.5, -13 + i * 3.714, 2.5, 0.1, 0, { jit: 0.02 }); });
      B.box(S, 5, 5.5, 5, -sx * 13, 0, 13); B.lump(P.bronze, -sx * 13, 5.5, 13, 4, 6.5, 3.4, 8, sx + 2);                           // Apollon / Hercule
    });
    m.collide.box(px, pz, 12.4, 17.4, pry);
    // aile courbe : segments tangents
    const N = B.far ? 5 : 10, A0 = 33, A1 = 84, da = (A1 - A0) / N, len = R * da * D2R + 0.5;
    for (let i = 0; i < N; i++) {
      const a = sx * (A0 + (i + 0.5) * da), [x, z] = at(a);
      B.group(x, 0, z, -a * D2R, () => {
        B.box(S, len, 20, 17, 0, -3, 0); B.box(P.stoneD, len, 2.2, 17.4, 0, 0, 0); B.box(P.stone, len + 0.2, 0.9, 18, 0, 17, 0); B.box(S, len, 1.6, 15, 0, 17.9, 0);
        const nw = B.far ? 2 : 3;
        for (const s of [1, -1]) B.group(0, 0, s * 8.5, s > 0 ? 0 : Math.PI, () => {
          B.winRow(-len / 2, len / 2, 3.4, 0.02, nw, 1.5, 11.5, { lit: 0.45, farMin: 0, frame: false });
          if (B.hi) for (let k = 0; k <= nw; k++) B.box(P.stone, 0.7, 14.6, 0.4, -len / 2 + k * len / nw, 2.2, 0.1, 0, { jit: 0.02 });
        });
      });
      m.collide.box(x, z, len / 2, 8.7, -a * D2R);
    }
    // pavillon d'extrémité
    const [ex, ez] = at(sx * 89), ery = -sx * 89 * D2R;
    B.group(ex, 0, ez, ery, () => {
      B.box(S, 15, 27, 22, 0, -3, 0); B.box(P.stone, 16, 1, 23, 0, 24, 0);
      for (const s of [1, -1]) B.group(0, 0, s * 11, s > 0 ? 0 : Math.PI, () => B.winRow(-6, 6, 4, 0.02, 3, 1.7, 15, { lit: 0.5, farMin: 0, frame: false }));
      B.group(sx * 7.5, 0, 0, sx * Math.PI / 2, () => B.winRow(-9, 9, 4, 0.02, 5, 1.7, 15, { lit: 0.5, farMin: 0, frame: false }));
    });
    m.collide.box(ex, ez, 7.8, 11.3, ery);
  }
  // ---- fontaine de Varsovie : bassin en longueur, jets et canons à eau ----
  B.box(P.stoneD, 26, 1.1, 36, 0, -0.4, 64); B.box(P.water, 23.6, 0.12, 33.6, 0, 0.66, 64, 0, { jit: 0 });
  if (B.hi) {
    for (let i = 0; i < 8; i++) for (const sx of [-1, 1]) B.cyl(P.foam, 0.04, 0.22, 5.5, sx * 8, 0.7, 50 + i * 4, 5);
    for (let i = 0; i < 5; i++) B.cyl(P.foam, 0.06, 0.35, 9, -8 + i * 4, 0.7, 76, 6);
    for (const sx of [-1, 1]) { B.box(S, 3, 3.2, 3, sx * 14.6, 0, 47.5); B.lump(P.bronze, sx * 14.6, 3.2, 47.5, 2.6, 4, 2.4, 5, sx + 31); }
  }
  m.collide.box(0, 64, 13, 18);
  return { height: 36 };
}

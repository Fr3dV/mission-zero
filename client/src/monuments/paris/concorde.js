// Place de la Concorde : obélisque de Louxor (granit rose, pyramidion doré) et les deux fontaines (des Mers, des Fleuves).
import { P, Water } from '../kit.js';

export function buildConcorde(m) {
  const { B } = m, G = { ...P.granite, t: 0.12 };
  // ---- obélisque ----
  B.box(P.stoneD, 9.5, 3.4, 9.5, 0, -3, 0); B.box(P.stoneL, 7.6, 0.5, 7.6, 0, 0.4, 0);
  B.box(G, 5.2, 1.3, 5.2, 0, 0.9, 0); B.box(G, 3.7, 4.4, 3.7, 0, 2.2, 0); B.box(G, 4.3, 0.5, 4.3, 0, 6.6, 0);
  B.frustum(G, 2.42, 2.42, 1.56, 1.56, 20.6, 0, 7.1, 0); B.frustum(P.gold, 1.56, 1.56, 0, 0, 2.3, 0, 27.7, 0);
  if (B.hi) {
    for (let k = 0; k < 4; k++) B.group(0, 0, 0, k * Math.PI / 2, () => {
      B.box(P.gold, 2.6, 2.8, 0.06, 0, 3, 1.86, 0, { jit: 0 });                    // schémas dorés du piédestal
      for (let j = 0; j < 14; j++) B.box({ ...G, c: G.c.map((v) => v * 0.8) }, 0.5 - j * 0.012, 0.9, 0.05, 0, 8 + j * 1.4, 1.2 - (j * 1.4 + 0.9) * 0.0209 + 0.0, 0, { jit: 0.1 }); // hiéroglyphes
    });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl(P.bronze, 0.12, 0.16, 1.2, sx * 4.4, 0.4, sz * 4.4, 6);
    for (let k = 0; k < 4; k++) B.group(0, 0, 0, k * Math.PI / 2, () => B.box(P.bronze, 8.8, 0.08, 0.08, 0, 1.3, 4.4, 0, { jit: 0 }));
  }
  m.collide.circle(0, 0, 5);
  // ---- fontaines ----
  const fountain = (z, seed) => B.group(0, 0, z, 0, () => {
    B.lathe(P.stoneL, [[9.4, 0], [9.4, 0.95], [9.0, 1.05], [8.6, 0.95], [8.6, 0.4], [0.1, 0.4]], 0, 0, 0, 40);
    B.cyl(P.water, 8.6, 8.6, 0.12, 0, 0.6, 0, 40, { jit: 0 });
    B.cyl(P.bronze, 2.3, 2.7, 1.6, 0, 0.6, 0, 12);
    B.cyl(P.bronze, 0.9, 1.3, 2.4, 0, 2.2, 0, 10);
    B.lathe(P.bronze, [[0.7, 4.3], [2.6, 4.7], [3.9, 5.2], [4.0, 5.45], [3.7, 5.4], [0.3, 5.3]], 0, 0, 0, 24); B.torus(P.gold, 3.95, 0.12, 0, 5.42, 0, 24);
    B.cyl(P.bronze, 0.5, 0.7, 2.2, 0, 5.3, 0, 8);
    B.lathe(P.bronze, [[0.4, 7.2], [1.5, 7.5], [2.2, 7.9], [2.25, 8.1], [0.2, 8.0]], 0, 0, 0, 20); B.torus(P.gold, 2.2, 0.09, 0, 8.08, 0, 20);
    B.cyl(P.gold, 0.2, 0.45, 1.1, 0, 8, 0, 8); B.sphere(P.gold, 0.5, 0, 9.4, 0, 8);
    if (B.hi) {
      B.cyl(P.foam, 4.1, 4.3, 0.12, 0, 0.66, 0, 24, { jit: 0 });
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3, s = Math.sin(a), c = Math.cos(a);
        B.statue(i % 2 ? P.bronze : P.gold, s * 2.1, 2.2, c * 2.1, 2.3, a);        // figures assises du piédouche
        B.statue(P.bronze, s * 5.9, 0.6, c * 5.9, 2.2, a); B.sphere(P.gold, 0.45, s * 5.2, 1.6, c * 5.2, 6, 1, 0.7, 1); // néréides et tritons
      }
    }
  });
  fountain(50, 1); fountain(-50, 2);
  if (B.hi) { // eau animée : jet sommital, nappes des deux vasques, jets des tritons et néréides vers la vasque
    const W = new Water();
    for (const z of [50, -50]) {
      W.jet(0, 9.6, z, 2.4, 0.06); W.fall(0, 5.5, z, 2.25, 2.6, 2.55); W.fall(0, 0.7, z, 3.98, 4.5, 4.7, 32);
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, s = Math.sin(a), c = Math.cos(a); W.arc([s * 5.5, 2.2, z + c * 5.5], [s * 3.2, 5.5, z + c * 3.2], 0.9, 0.05); W.arc([s * 5.9, 2.4, z + c * 5.9], [s * 7.6, 0.7, z + c * 7.6], 0.5, 0.04, 6); }
    }
    m.add(W.mesh(m.kit, 'concorde:eau'));
  }
  m.collide.circle(0, 50, 9.6); m.collide.circle(0, -50, 9.6);
  return { height: 30 };
}

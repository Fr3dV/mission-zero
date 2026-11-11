// Église de la Madeleine : temple périptère corinthien (108 m × 43 m), 52 colonnes de 20 m, frontons, haut podium.
import { P, stairs } from '../kit.js';

export function buildMadeleine(m) {
  const { B } = m, S = P.stone, PY = 4.2, HX = 19.4, HZ = 51, r = 1.05, h = 19.6;
  B.box(P.stoneD, 43.6, PY + 3, 107, 0, -3, 0); B.box(P.stoneL, 44, 0.5, 107.4, 0, PY - 0.5, 0);
  stairs(B, P.stoneL, 30, 20, PY / 20, 0.42, 0, 0, 53.5); stairs(B, P.stoneL, 30, 20, PY / 20, 0.42, 0, 0, -53.5, Math.PI);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) B.box(P.stoneD, 3.4, PY + 0.6, 8.6, sx * 16.7, 0, sz * 57.8);
  m.collide.box(0, 0, 22.2, 54); m.collide.box(0, 58, 18.6, 4.4); m.collide.box(0, -58, 18.6, 4.4);
  B.group(0, PY, 0, 0, () => {
    // péristyle : 8 colonnes en façade, 18 sur les flancs, second rang au pronaos
    B.colonnade(-HX, HZ, HX, HZ, 8, 0, r, h, 'cor'); B.colonnade(-HX, -HZ, HX, -HZ, 8, 0, r, h, 'cor');
    for (const sx of [-1, 1]) for (let i = 1; i < 17; i++) B.column(sx * HX, 0, HZ - i * 6, r, h, 'cor');
    for (let i = 1; i < 7; i++) B.column(-HX + i * (2 * HX / 7), 0, HZ - 6, r, h, 'cor');
    // cella
    B.box(S, 30.6, h, 84, 0, 0, -5);
    B.box(P.stoneD, 30.8, h, 0.2, 0, 0, 36.95, 0, { jit: 0 });
    B.group(0, 0, 37.07, 0, () => { B.box(P.stoneL, 8.4, 13.4, 0.5, 0, 0, 0.1); B.box(P.bronze, 5.6, 11.4, 0.3, 0, 0, 0.35, 0, { jit: 0 }); if (B.hi) for (let j = 0; j < 4; j++) for (const x of [-1.4, 1.4]) B.box(P.ironD, 2.2, 2.3, 0.1, x, 0.6 + j * 2.7, 0.52, 0, { jit: 0.08 }); });
    for (const ry of [Math.PI / 2, -Math.PI / 2]) B.group(0, 0, -5, ry, () => {
      for (let i = 0; i < 13; i++) { const x = -36 + i * 6; B.box(P.shadow, 2.2, 5, 0.25, x, 6.5, 15.25, 0, { jit: 0 }); if (B.hi) { B.box(P.stoneL, 3, 0.4, 0.6, x, 6.1, 15.4); B.gable(P.stoneL, null, 3.2, 0.9, 0.6, x, 11.5, 15.4); B.statue(P.stoneL, x, 6.5, 15.5, 3.6); } }
    });
    // entablement, frontons, toiture
    B.box(P.stoneL, 41.6, 1.5, 104.8, 0, h, 0); B.box(P.deco, 41.2, 1.7, 104.4, 0, h + 1.5, 0); B.box(P.stoneL, 43.6, 1.0, 106.8, 0, h + 3.2, 0);
    if (B.hi) for (const sx of [-1, 1]) for (let i = 0; i < 70; i++) B.box(P.stoneL, 0.5, 0.45, 0.7, sx * 21.1, h + 2.75, -51.8 + i * 1.5, 0, { jit: 0 });
    B.gable(P.deco, P.zinc, 43.6, 7.4, 106.8, 0, h + 4.2, 0);
    for (const sz of [-1, 1]) {
      B.tris(P.stoneL, rake(21.8, 7.4, sz * 53.4, 0.9), 0, h + 4.2, 0);
      B.lump(P.stoneL, 0, h + 4.4, sz * 53.6, 26, 4.6, 0.8, 16, sz + 5); B.lump(P.stoneL, 0, h + 8, sz * 53.6, 5, 3, 0.8, 3, sz + 8);
    }
  });
  return { height: 36 };
}
// rampants du fronton (bandeau saillant le long des deux pentes), dans le plan z
function rake(a, hh, z, t) {
  const o = [], d = z > 0 ? 0.5 : -0.5, q = (p0, p1, p2, p3) => (z > 0 ? o.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3) : o.push(...p0, ...p2, ...p1, ...p0, ...p3, ...p2));
  for (const s of [-1, 1]) {
    const A = [s * a, 0, z + d], Bq = [0, hh, z + d], C = [0, hh - t * 1.1, z + d], D = [s * (a - t * 2.9), 0, z + d];
    if (s > 0) q(D, A, Bq, C); else q(A, D, C, Bq);
  }
  return o;
}

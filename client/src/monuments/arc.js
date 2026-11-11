// Arc de Triomphe de l'Étoile : 45 m × 22 m × 50 m, grande arche (14,6 × 29,2 m) et arches latérales traversantes (8,4 × 18,7 m).
import * as THREE from 'three';
import { P } from './kit.js';

export function buildArc(m) {
  const { B } = m, S = P.stone;
  const HW = 22.5, HD = 11, HB = 37, hx = 7.31, ah = 29.19, sd = 4.22, sh = 18.68;
  // contour avec une arche en plein cintre posée au sol
  const notch = (x0, x1, r, h, top) => {
    const s = new THREE.Shape(); s.moveTo(x0, 0); s.lineTo(-r, 0); s.lineTo(-r, h - r); s.absarc(0, h - r, r, Math.PI, 0, true); s.lineTo(r, 0); s.lineTo(x1, 0); s.lineTo(x1, top); s.lineTo(x0, top); s.closePath(); return s;
  };
  const front = notch(-HW, HW, hx, ah, HB);
  B.extrude(S, front, HD - sd, 0, 0, sd); B.extrude(S, front, HD - sd, 0, 0, -HD);
  // partie centrale au-dessus de la grande voûte
  const mid = new THREE.Shape(); mid.moveTo(-hx, ah - hx); mid.absarc(0, ah - hx, hx, Math.PI, 0, true); mid.lineTo(hx, HB); mid.lineTo(-hx, HB); mid.closePath();
  B.extrude(S, mid, 2 * sd, 0, 0, -sd);
  // parties latérales percées des petites arches (extrudées le long de X)
  const sideS = notch(-sd, sd, sd, sh, HB);
  B.extrude(S, sideS, HW - hx, hx, 0, 0, Math.PI / 2); B.extrude(S, sideS, HW - hx, -HW, 0, 0, Math.PI / 2);
  // fondations (terrain)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.box(P.stoneD, HW - hx, 3, HD - sd, sx * (HW + hx) / 2, -3, sz * (HD + sd) / 2);
    m.collide.box(sx * (HW + hx) / 2, sz * (HD + sd) / 2, (HW - hx) / 2 + 0.4, (HD - sd) / 2 + 0.4);
  }
  // entablement, corniche, attique
  B.box(P.stoneL, 45.6, 1.0, 22.6, 0, HB, 0);          // architrave
  B.box(P.deco, 45.2, 2.2, 22.2, 0, HB + 1, 0);        // frise sculptée
  B.box(P.stoneL, 47.6, 1.3, 24.6, 0, HB + 3.2, 0);    // corniche saillante
  B.box(S, 44.2, 6.6, 21.2, 0, HB + 4.5, 0);           // attique
  B.box(P.stoneL, 45.4, 0.9, 22.4, 0, HB + 11.1, 0);
  B.box(P.stoneD, 43, 0.9, 20, 0, HB + 12, 0);
  if (B.hi) {
    // boucliers et pilastres de l'attique
    const shields = (n, len, z, ry) => B.group(0, 0, 0, ry, () => { for (let i = 0; i < n; i++) { const x = -len / 2 + len * (i + 0.5) / n; B.box(P.deco, 1.5, 3.2, 0.35, x, HB + 6.4, z, 0, { jit: 0.03 }); B.box(P.stoneL, 0.5, 6.4, 0.3, x + len / n / 2, HB + 4.6, z, 0, { jit: 0 }); } });
    shields(10, 43, 10.6, 0); shields(10, 43, 10.6, Math.PI); shields(5, 20, 22.1, Math.PI / 2); shields(5, 20, 22.1, -Math.PI / 2);
    // denticules de la corniche
    for (const sz of [-1, 1]) for (let i = 0; i < 46; i++) B.box(P.stoneL, 0.45, 0.5, 0.6, -22.5 + i + 0.5, HB + 2.75, sz * 11.5, 0, { jit: 0 });
  }
  // décor des deux grandes faces
  for (const ry of [0, Math.PI]) B.group(0, 0, 0, ry, () => {
    const z = HD;
    // archivolte de la grande arche
    const ring = new THREE.Shape(); ring.absarc(0, 0, hx + 1.3, 0, Math.PI, false); ring.lineTo(-hx, 0); ring.absarc(0, 0, hx, Math.PI, 0, true); ring.closePath();
    B.extrude(P.stoneL, ring, 0.35, 0, ah - hx, z);
    if (B.hi) B.box(P.deco, 2.2, 3, 0.9, 0, ah - 0.6, z);  // clé
    for (const sx of [-1, 1]) {
      const cx = sx * (HW + hx) / 2;
      B.box(P.stoneL, HW - hx + 0.5, 1.0, 0.5, cx, ah - hx - 0.5, z);         // imposte
      B.box(P.stoneD, HW - hx + 0.6, 2.6, 0.8, cx, 0, z);                     // socle
      B.box(P.stoneL, 9, 4.6, 2.6, cx, 0, z + 1);                             // piédestal du groupe sculpté
      B.lump(P.deco, cx, 4.6, z + 1.2, 8, 12.5, 2.4, 14, sx + 3 + ry);        // haut-relief (La Marseillaise…)
      B.box(P.stoneL, 9.6, 6.6, 0.3, cx, 23.6, z, 0, { jit: 0.02 });          // panneau en bas-relief
      B.box(P.deco, 8.6, 5.6, 0.45, cx, 24.1, z, 0, { jit: 0.02 });
      B.lump(P.deco, cx, 24.3, z + 0.3, 8, 5, 0.6, 9, sx + 9 + ry);
      B.lump(P.deco, sx * (hx + 3.2), 30.6, z + 0.2, 4.5, 4.2, 0.6, 5, sx + 20); // renommées des écoinçons
    }
  });
  // faces latérales : archivolte et panneau
  for (const ry of [Math.PI / 2, -Math.PI / 2]) B.group(0, 0, 0, ry, () => {
    const ring = new THREE.Shape(); ring.absarc(0, 0, sd + 0.9, 0, Math.PI, false); ring.lineTo(-sd, 0); ring.absarc(0, 0, sd, Math.PI, 0, true); ring.closePath();
    B.extrude(P.stoneL, ring, 0.3, 0, sh - sd, HW);
    B.box(P.stoneL, 22.4, 1.0, 0.5, 0, ah - hx - 0.5, HW);
    for (const sx of [-1, 1]) B.box(P.stoneD, HD - sd + 0.3, 2.6, 0.8, sx * (HD + sd) / 2, 0, HW);
    B.box(P.stoneL, 12, 6.6, 0.3, 0, 26, HW, 0, { jit: 0.02 }); B.box(P.deco, 11, 5.6, 0.45, 0, 26.5, HW, 0, { jit: 0.02 });
    B.lump(P.deco, 0, 26.7, HW + 0.3, 10, 5, 0.6, 9, 31 + ry);
  });
  return { height: 50 };
}

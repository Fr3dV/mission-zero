// Outils propres à Toulouse : ailes de brique à toits de tuiles, clochers octogonaux, balustrades, drapeaux.
import * as THREE from 'three';
import { P, wing, court, palaceWing } from '../kit.js';

// Étages types des édifices de brique (hauteurs en m)
export const FL = {
  rdc: { h: 5.5, arch: true, w: 2.3, wh: 3.7, sill: 0.5 },
  noble: { h: 5.5, w: 1.8, wh: 3.6, sill: 1 },
  etage: { h: 4, w: 1.6, wh: 2.4, sill: 1 },
  attique: { h: 3, w: 1.4, wh: 1.3, sill: 0.9 },
};
/** Options d'aile « brique et pierre, tuiles canal » pour wing / court / palaceWing. */
export const brick = (o = {}) => ({ wall: P.brick, roof: 'hip', roofMat: P.tile, roofH: 2.6, bay: 4, dep: 12, floors: [FL.rdc, FL.etage, FL.etage], frameMat: P.pierre, plinthMat: P.brickD, dormers: false, chimneys: false, ...o });
export const bwing = (m, x, z, ry, o) => wing(m, x, z, ry, brick(o));
export const bcourt = (m, cx, cz, w, d, o) => court(m, cx, cz, w, d, brick(o));
export { palaceWing };

/** Balustrade de pierre le long de X (centrée), posée à y. */
export function balustrade(B, len, x, y, z, ry = 0, h = 1.1) {
  B.group(x, y, z, ry, () => {
    B.box(P.pierre, len, 0.22, 0.45, 0, 0, 0, 0, { jit: 0 }); B.box(P.pierre, len, 0.2, 0.5, 0, h - 0.2, 0, 0, { jit: 0 });
    if (B.far) { B.box(P.pierre, len, h - 0.4, 0.2, 0, 0.2, 0, 0, { jit: 0 }); return; }
    const n = Math.max(2, Math.round(len / 0.55));
    for (let i = 0; i < n; i++) B.box(P.pierre, 0.2, h - 0.4, 0.2, -len / 2 + (i + 0.5) * len / n, 0.2, 0, 0, { jit: 0 });
    for (let i = 0; i <= Math.round(len / 4.2); i++) B.box(P.pierre, 0.5, h, 0.5, -len / 2 + i * len / Math.round(len / 4.2), 0, 0, 0, { jit: 0 });
  });
}

/**
 * Clocher octogonal toulousain : étages en léger retrait, deux baies par face (plein cintre roman ou arc en mitre),
 * colonnettes de pierre aux angles, bandeaux. tiers = [{ r, h, arch: 'round' | 'mitre' | 'none', n }]. Retourne la hauteur atteinte.
 */
export function octTower(B, x, y, z, tiers, o = {}) {
  const A8 = Math.PI / 8, wall = o.wall || P.brick;
  let yy = y;
  for (const t of tiers) {
    B.cyl(wall, t.r, t.r, t.h, x, yy, z, 8, { exact: true, ry: A8 });
    B.cyl(P.pierre, t.r + 0.22, t.r + 0.22, 0.26, x, yy + t.h - 0.26, z, 8, { exact: true, ry: A8, jit: 0 });
    const ap = t.r * Math.cos(A8), fw = 2 * t.r * Math.sin(A8);
    if (t.arch && t.arch !== 'none') for (let k = 0; k < 8; k++) B.group(x, 0, z, k * Math.PI / 4, () => {
      const n = t.n || 2, w = fw * (n === 1 ? 0.34 : 0.25), top = w / 2, hh = t.h * (t.fill || 0.62) - top;
      for (let i = 0; i < n; i++) {
        const ox = n === 1 ? 0 : (i - 0.5) * fw * 0.42;
        B.win(ox, yy + t.h * 0.16, ap + 0.02, w, hh, { arch: t.arch === 'round', mitre: t.arch === 'mitre', mat: P.shadow, frame: false, farMin: 0 });
        if (B.hi) for (const s of [-1, 1]) B.box(P.pierre, 0.11, hh, 0.11, ox + s * (w / 2 + 0.07), yy + t.h * 0.16, ap + 0.06, 0, { jit: 0 });
      }
    });
    if (B.hi) for (let k = 0; k < 8; k++) { const a = A8 + k * Math.PI / 4; B.cyl(P.pierre, 0.14, 0.14, t.h, x + Math.sin(a) * t.r, yy, z + Math.cos(a) * t.r, 6, { jit: 0 }); }
    yy += t.h;
  }
  return yy;
}

/** Flèche octogonale (brique ou ardoise) coiffant un clocher, avec boule et croix. */
export function octSpire(B, mat, x, y, z, r, h) {
  B.add(new THREE.CylinderGeometry(0.12, r, h, 8, 1, true).rotateY(Math.PI / 8).translate(0, h / 2, 0), mat, x, y, z, 0, { uv: 'cyl', r });
  B.sphere(P.gold, 0.45, x, y + h + 0.2, z, 6); B.box(P.ironD, 0.1, 2, 0.1, x, y + h + 0.5, z, 0, { jit: 0 }); B.box(P.ironD, 1, 0.1, 0.1, x, y + h + 1.7, z, 0, { jit: 0 });
}

/** Drapeau sur hampe inclinée ou droite ; cols = bandes verticales (couleurs linéaires [r,g,b]). */
export function flag(B, x, y, z, h, cols, ry = 0) {
  if (B.far) return;
  B.cyl(P.metal, 0.05, 0.06, h, x, y, z, 5, { jit: 0 });
  const w = 2.2 / cols.length;
  cols.forEach((c, i) => B.box({ c, r: 0.8, m: 0, t: 0, g: 0.3 }, w, 1.5, 0.04, x + Math.cos(ry) * (0.1 + w * (i + 0.5)), y + h - 1.6, z - Math.sin(ry) * (0.1 + w * (i + 0.5)), ry, { jit: 0 }));
}
export const FR = [[0.0, 0.06, 0.4], [0.9, 0.9, 0.9], [0.75, 0.02, 0.03]], OC = [[0.6, 0.02, 0.03], [0.85, 0.6, 0.05], [0.6, 0.02, 0.03]], EU = [[0.0, 0.05, 0.35], [0.0, 0.05, 0.35]];

/** Contrefort de brique à ressauts, face à +Z du groupe courant (adossé au mur en z). */
export function buttress(B, x, z, w, d, h, o = {}) {
  const wall = o.wall || P.brick;
  B.box(wall, w, h * 0.55 + 3, d, x, -3, z + d / 2); B.box(wall, w, h * 0.3, d * 0.78, x, h * 0.55, z + d * 0.39); B.box(wall, w, h * 0.15, d * 0.55, x, h * 0.85, z + d * 0.275);
  B.tris(o.cap || P.tile, [x - w / 2, h, z, x + w / 2, h, z, x + w / 2, h - 1.2, z + d * 0.55, x - w / 2, h, z, x + w / 2, h - 1.2, z + d * 0.55, x - w / 2, h - 1.2, z + d * 0.55], 0, 0.02, 0, 0, { up: true });
  if (B.hi) { B.box(P.pierre, w + 0.15, 0.25, d * 0.8, x, h * 0.55, z + d * 0.4, 0, { jit: 0 }); B.box(P.pierre, w + 0.15, 0.25, d * 0.57, x, h * 0.85, z + d * 0.285, 0, { jit: 0 }); }
}

/** Halles métalliques à pignons (gares, usines) : n travées le long de X, faîtages le long de Z, de z0 (avant) à z1. */
export function sheds(m, x0, x1, z0, z1, n, h, rise, o = {}) {
  const { B } = m, w = (x1 - x0) / n, L = z0 - z1, zc = (z0 + z1) / 2, glass = { c: [0.34, 0.47, 0.53], r: 0.12, m: 0.4, t: 0, g: 2 }, wall = o.wall || P.metal, roof = o.roof || P.zinc;
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * w;
    B.gable(wall, roof, w, rise, L, x, h, zc);
    if (o.glass !== false) B.tris(glass, [x - w * 0.04, h + rise * 0.93, z0 - 2, x - w * 0.34, h + rise * 0.33, z0 - 2, x - w * 0.34, h + rise * 0.33, z1 + 2, x - w * 0.04, h + rise * 0.93, z0 - 2, x - w * 0.34, h + rise * 0.33, z1 + 2, x - w * 0.04, h + rise * 0.93, z1 + 2], 0, 0.06, 0, 0, { up: true, jit: 0, uv: 'box' });
    if (o.posts !== false) for (let k = 0; k <= (B.far ? 2 : 6); k++) B.cyl(P.metalD, 0.3, 0.35, h, x - w / 2, 0, z0 - k * L / (B.far ? 2 : 6), 6);
  }
  if (o.walls !== false) { B.box(wall, x1 - x0, h, 0.8, (x0 + x1) / 2, 0, z1); B.box(wall, 0.8, h, L, x0, 0, zc); B.box(wall, 0.8, h, L, x1, 0, zc); }
  if (o.collide !== false) m.collide.box((x0 + x1) / 2, zc, (x1 - x0) / 2 + 0.5, L / 2 + 0.5);
}

/** Statue équestre stylisée (cheval + cavalier), pieds à y, regarde vers +Z ; s ≈ hauteur au garrot. */
export function equestrian(B, mt, x, y, z, s, ry = 0) {
  B.group(x, y, z, ry, () => {
    if (B.far) { B.box(mt, s * 0.7, s * 2.6, s * 2.4, 0, 0, 0); return; }
    const o = { jit: 0.04 }, by = s * 1.25;
    B.add(new THREE.SphereGeometry(s * 0.46, 10, 8).scale(0.8, 0.86, 2.0), mt, 0, by, 0, 0, o);
    B.add(new THREE.CylinderGeometry(s * 0.17, s * 0.3, s * 0.95, 8).rotateX(0.7), mt, 0, by + s * 0.5, s * 0.95, 0, o);
    B.add(new THREE.BoxGeometry(s * 0.24, s * 0.28, s * 0.66).rotateX(0.75), mt, 0, by + s * 0.92, s * 1.42, 0, o);
    for (const sx of [-1, 1]) { B.add(new THREE.CylinderGeometry(s * 0.13, s * 0.08, s * 0.95, 6).rotateX(0.1 * sx), mt, sx * s * 0.2, s * 0.47, s * 0.72, 0, o); B.add(new THREE.CylinderGeometry(s * 0.15, s * 0.08, s * 0.98, 6).rotateX(-0.08 * sx), mt, sx * s * 0.22, s * 0.49, -s * 0.66, 0, o); }
    B.add(new THREE.CylinderGeometry(s * 0.03, s * 0.1, s * 0.85, 5).rotateX(-0.6), mt, 0, by - s * 0.2, -s * 1.12, 0, o);
    B.statue(mt, 0, by + s * 0.13, -s * 0.05, s * 1.55);
  });
}

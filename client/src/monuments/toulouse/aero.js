// Aéronautique : aérogare de Toulouse-Blagnac (halls, jetées, passerelles), tour de contrôle, avions au sol
// (A320, A350, A380, BelugaXL, A340, Concorde, A400M, Caravelle — silhouettes sans livrée de compagnie),
// tarmac des usines Airbus, musée Aeroscopia (hangar en arche et avions exposés dehors).
import * as THREE from 'three';
import { P } from '../kit.js';

const mk = (hex, r = 0.4, mt = 0.2, g = 0.5) => { const c = new THREE.Color(hex); return { c: [c.r, c.g, c.b], r, m: mt, t: 0, g }; };
const WHITE = mk(0xeef0f1, 0.32, 0.15), GREY = mk(0xb4b9bf, 0.4, 0.4), DARK = mk(0x22262c, 0.3, 0.3, 0), TYRE = mk(0x1a1a1c, 0.9, 0, 0), BLUE = mk(0x1d3f77, 0.4, 0.2), MIL = mk(0x7d858a, 0.6, 0.2);

// caractéristiques réelles (m) : longueur, diamètre du fuselage, envergure, cordes d'emplanture / d'extrémité, flèche (°), empennage, dérive, moteurs
const SPECS = {
  a320: { L: 37.6, D: 3.95, span: 35.8, cr: 7, ct: 1.6, sw: 25, stab: 12.5, fin: 5.9, eng: [[5.75, 1.15, 4.4]] },
  a350: { L: 66.8, D: 5.96, span: 64.75, cr: 12.5, ct: 2.4, sw: 32, stab: 18.7, fin: 9.4, eng: [[10.5, 1.75, 6.6]] },
  a380: { L: 72.7, D: 7.14, sy: 1.18, span: 79.75, cr: 17.7, ct: 3.8, sw: 33.5, stab: 30.4, fin: 12, eng: [[14.9, 1.6, 6], [25.7, 1.6, 6]] },
  a340: { L: 75.4, D: 5.64, span: 63.45, cr: 11.5, ct: 2.4, sw: 31, stab: 21.5, fin: 9, eng: [[9.4, 1.3, 5.5], [19.3, 1.3, 5.5]] },
  beluga: { L: 63.1, D: 5.64, span: 60.3, cr: 10.5, ct: 2.4, sw: 30, stab: 19.4, fin: 9.5, eng: [[9.4, 1.55, 6]], bubble: true },
  caravelle: { L: 32, D: 3.2, span: 34.3, cr: 6.5, ct: 1.7, sw: 20, stab: 10.6, fin: 5, eng: [], rear: true },
  a400m: { L: 45.1, D: 5.6, span: 42.4, cr: 6.6, ct: 2.6, sw: 15, stab: 18.5, fin: 8.2, eng: [[5.9, 0.75, 5], [11.6, 0.75, 5]], high: true, mil: true },
};

// plaque mince horizontale de contour pts = [[x, z], ...] ; lift = relèvement en y par mètre de |x| (dièdre)
function plate(B, mat, pts, y, t, lift = 0) {
  const sh = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z))); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false }).rotateX(Math.PI / 2);     // (x, zforme, épaisseur) -> (x, -épaisseur, z)
  if (lift) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.abs(p.getX(i)) * lift); g.computeVertexNormals(); }
  B.add(g, mat, 0, y + t, 0, 0, { jit: 0 });
}
// plaque mince verticale dans le plan YZ : pts = [[z, y], ...]
function fin(B, mat, pts, x, t) {
  const sh = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y))); sh.closePath();
  B.add(new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false }).rotateY(-Math.PI / 2), mat, x + t / 2, 0, 0, 0, { jit: 0 });
}

/** Avion posé sur son train, nez vers +Z du groupe (x, y, z, ry). */
export function aircraft(B, type, x, y, z, ry = 0, o = {}) {
  const s = SPECS[type], L = s.L, R = s.D / 2, sy = s.sy || 1, body = s.mil ? MIL : WHITE, wingM = s.mil ? MIL : GREY;
  const cy = s.high ? R + 1.6 : s.D * 0.92 * sy, zN = L / 2, zT = -L / 2;
  B.group(x, y, z, ry, () => {
    if (B.far) {                                                     // version lointaine : fuselage, voilure et dérive réduits à l'essentiel
      B.add(new THREE.CylinderGeometry(R * 0.5, R, L * 0.92, 6).rotateX(Math.PI / 2), body, 0, cy, 0, 0, { jit: 0 });
      const t = Math.tan(s.sw * Math.PI / 180), h = s.span / 2, zr = L * 0.14;
      plate(B, wingM, [[0, zr], [h, zr - h * t], [h, zr - h * t - s.ct], [0, zr - s.cr], [-h, zr - h * t - s.ct], [-h, zr - h * t]], s.high ? cy + R * 0.8 : cy - R * 0.5, 0.5);
      fin(B, body, [[zT + s.fin * 1.3, cy + R * 0.6], [zT + 0.4, cy + R * 0.6], [zT + 0.2, cy + R + s.fin], [zT + s.fin * 0.45, cy + R + s.fin]], 0, 0.4);
      return;
    }
    // ---- fuselage (révolution), queue relevée ----
    const prof = [[0.02, zT], [R * 0.28, zT + L * 0.04], [R * 0.72, zT + L * 0.16], [R, zT + L * 0.3], [R, zN - L * 0.13], [R * 0.86, zN - L * 0.075], [R * 0.6, zN - L * 0.035], [R * 0.28, zN - L * 0.008], [0.02, zN]];
    const g = new THREE.LatheGeometry(prof.map(([r, zz]) => new THREE.Vector2(r, zz)), 18).rotateX(Math.PI / 2); g.scale(1, sy, 1);
    const pp = g.attributes.position, z0 = zT + L * 0.3;
    for (let i = 0; i < pp.count; i++) { const zz = pp.getZ(i); if (zz < z0) pp.setY(i, pp.getY(i) + R * 0.75 * Math.pow((z0 - zz) / (L * 0.3), 1.6)); else if (zz > zN - L * 0.1 && !s.bubble) pp.setY(i, pp.getY(i) - R * 0.28 * Math.pow((zz - (zN - L * 0.1)) / (L * 0.1), 2)); }
    g.computeVertexNormals(); B.add(g, body, 0, cy, 0, 0, { jit: 0 });
    // hublots, pare-brise, filet décoratif neutre
    if (!s.bubble) { for (const sx of [-1, 1]) { B.box(DARK, 0.06, R * 0.11, L * 0.6, sx * R * 0.985, cy + R * 0.16 * sy, -L * 0.02, 0, { jit: 0 }); if (sy > 1) B.box(DARK, 0.06, R * 0.11, L * 0.5, sx * R * 0.9, cy + R * 0.72 * sy, 0, 0, { jit: 0 }); if (!s.mil) B.box(BLUE, 0.05, R * 0.07, L * 0.74, sx * R * 0.995, cy - R * 0.08, -L * 0.03, 0, { jit: 0 }); } }
    B.add(new THREE.SphereGeometry(R * 0.6, 8, 5, 0, Math.PI * 2, 0.5, 0.7).rotateX(Math.PI / 2.35), DARK, 0, cy + (s.bubble ? -R * 0.28 : R * 0.2 * sy), zN - L * 0.075, 0, { jit: 0 });
    if (s.bubble) {                                                   // soute géante du Beluga, cockpit abaissé
      B.add(new THREE.SphereGeometry(1, 16, 10).scale(R * 1.55, R * 1.5, L * 0.39), body, 0, cy + R * 1.05, L * 0.03, 0, { jit: 0 });
      B.add(new THREE.SphereGeometry(1, 12, 8).scale(R * 1.2, R * 0.9, L * 0.12), body, 0, cy + R * 0.8, -L * 0.26, 0, { jit: 0 });
      for (const sx of [-1, 1]) B.add(new THREE.SphereGeometry(0.45, 6, 4).scale(1, 0.7, 1.4), DARK, sx * R * 1.1, cy + R * 1.3, zN - L * 0.17, 0, { jit: 0 });   // l'« œil » du béluga
    }
    // ---- voilure en flèche, saumons relevés ----
    const t = Math.tan(s.sw * Math.PI / 180), h = s.span / 2, zr = L * (s.rear ? 0.08 : 0.15), wy = s.high ? cy + R * 0.82 : cy - R * 0.55 * sy, lift = s.high ? -0.03 : 0.09;
    for (const sx of [-1, 1]) {
      plate(B, wingM, [[sx * R * 0.5, zr], [sx * h, zr - h * t], [sx * h, zr - h * t - s.ct], [sx * h * 0.38, zr - h * 0.38 * t - s.cr * 0.62], [sx * R * 0.5, zr - s.cr]], wy, R * 0.22, lift);
      if (!s.high && !s.rear) fin(B, wingM, [[zr - h * t - s.ct * 0.2, wy + h * lift], [zr - h * t - s.ct, wy + h * lift], [zr - h * t - s.ct * 1.5, wy + h * lift + s.ct * 1.1], [zr - h * t - s.ct * 1.15, wy + h * lift + s.ct * 1.1]], sx * h, 0.12);
    }
    // ---- empennage horizontal, dérive ----
    const hs = s.stab / 2, zs = zT + L * 0.115, ys = s.high ? cy + R + s.fin * 0.98 : s.rear ? cy + R + s.fin * 0.45 : cy + R * 0.55, ts = Math.tan((s.sw + 5) * Math.PI / 180);
    for (const sx of [-1, 1]) plate(B, wingM, [[sx * 0.2, zs], [sx * hs, zs - hs * ts], [sx * hs, zs - hs * ts - s.cr * 0.2], [sx * 0.2, zs - s.cr * 0.5]], ys, R * 0.12, s.high ? 0 : 0.1);
    const fz = zT + L * 0.2, fy = cy + R * 0.8 * sy + R * 0.3;
    fin(B, body, [[fz, fy], [zT + L * 0.035, fy + R * 0.25], [zT + L * 0.005, fy + s.fin], [zT + L * 0.075, fy + s.fin]], 0, R * 0.14);
    if (s.bubble) for (const sx of [-1, 1]) fin(B, body, [[zs - hs * ts + 0.4, ys - 1.6], [zs - hs * ts - s.cr * 0.22, ys - 1.6], [zs - hs * ts - s.cr * 0.3, ys + 2.6], [zs - hs * ts - s.cr * 0.05, ys + 2.6]], sx * hs, 0.14);
    // ---- moteurs ----
    for (const [ex, er, el] of s.eng) for (const sx of [-1, 1]) {
      const ez = zr - ex * t + el * 0.35, ey = s.high ? wy - er * 0.4 : wy + ex * lift - er * 1.15;
      B.add(new THREE.CylinderGeometry(er, er * 0.78, el, 12).rotateX(Math.PI / 2), s.mil ? MIL : WHITE, sx * ex, ey, ez, 0, { jit: 0 });
      B.add(new THREE.CircleGeometry(er * 0.86, 12), DARK, sx * ex, ey, ez + el / 2 + 0.02, 0, { jit: 0 });
      if (s.high) { for (let k = 0; k < 4; k++) B.add(new THREE.BoxGeometry(0.22, 5.2, 0.06).rotateZ(k * Math.PI / 4), DARK, sx * ex, ey, ez + el / 2 + 0.5, 0, { jit: 0 }); B.add(new THREE.ConeGeometry(0.5, 1.2, 8).rotateX(Math.PI / 2), MIL, sx * ex, ey, ez + el / 2 + 0.6, 0, { jit: 0 }); }
      else B.box(wingM, 0.3, er * 0.9, el * 0.7, sx * ex, ey + er * 0.6, ez - el * 0.25, 0, { jit: 0 });
    }
    if (s.rear) for (const sx of [-1, 1]) { B.add(new THREE.CylinderGeometry(0.75, 0.6, 4.6, 10).rotateX(Math.PI / 2), WHITE, sx * (R + 0.9), cy + R * 0.3, zT + L * 0.24, 0, { jit: 0 }); B.add(new THREE.CircleGeometry(0.62, 10), DARK, sx * (R + 0.9), cy + R * 0.3, zT + L * 0.24 + 2.32, 0, { jit: 0 }); }
    // ---- train d'atterrissage ----
    const leg = (lx, lz, n) => { B.cyl(GREY, 0.14, 0.16, cy - R * sy * 0.8, lx, 0.5, lz, 6, { jit: 0 }); for (let k = 0; k < n; k++) B.add(new THREE.CylinderGeometry(0.55, 0.55, 0.36, 10).rotateZ(Math.PI / 2), TYRE, lx + (k % 2 ? 0.34 : -0.34), 0.55, lz + (k > 1 ? -1.3 : 0), 0, { jit: 0 }); };
    leg(0, zN - L * 0.13, 2);
    const gx = s.high ? R * 0.9 : Math.max(R * 1.3, s.span * 0.1);
    for (const sx of [-1, 1]) { leg(sx * gx, zr - s.cr * 0.72, L > 50 ? 4 : 2); if (s.eng.length > 1 && !s.high) leg(sx * R * 0.5, zr - s.cr * 0.95, 4); }
  });
  if (o.collide) {
    const c = Math.cos(ry), sn = Math.sin(ry), tw = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c], hgt = cy + R * sy + 1;
    for (const k of [-0.3, 0, 0.3]) { const [px, pz] = tw(0, k * L); o.collide.box(px, pz, R + 0.2, L * 0.17, ry, -10, hgt + 2); }
    const [wx, wz] = tw(0, L * 0.15 - s.span * 0.2 * Math.tan(s.sw * Math.PI / 180) - s.cr * 0.3); o.collide.box(wx, wz, s.span / 2, s.cr * 0.42, ry, s.high ? cy + R * 0.6 : cy - R * sy, hgt);
  }
}

/** Concorde : fuselage effilé, aile delta gothique, quatre réacteurs en deux nacelles. */
export function concorde(B, x, y, z, ry = 0, o = {}) {
  const L = 61.7, R = 1.45, cy = 5.4, zN = L / 2, zT = -L / 2;
  B.group(x, y, z, ry, () => {
    const prof = [[0.02, zT], [R * 0.5, zT + L * 0.1], [R, zT + L * 0.28], [R, zN - L * 0.24], [R * 0.7, zN - L * 0.12], [R * 0.3, zN - L * 0.04], [0.02, zN]];
    const g = new THREE.LatheGeometry(prof.map(([r, zz]) => new THREE.Vector2(r, zz)), B.far ? 6 : 14).rotateX(Math.PI / 2);
    const pp = g.attributes.position; for (let i = 0; i < pp.count; i++) { const zz = pp.getZ(i); if (zz > zN - L * 0.16) pp.setY(i, pp.getY(i) - 1.5 * Math.pow((zz - (zN - L * 0.16)) / (L * 0.16), 1.6)); }
    g.computeVertexNormals(); B.add(g, WHITE, 0, cy, 0, 0, { jit: 0 });
    for (const sx of [-1, 1]) plate(B, WHITE, [[sx * 0.8, 14], [sx * 4.2, 2], [sx * 12.8, -19], [sx * 12.8, -23.5], [sx * 0.8, -23]], cy - 1.2, 0.5);
    fin(B, WHITE, [[-13, cy + 1], [-27.5, cy + 1.2], [-29, cy + 6.2], [-25.5, cy + 6.2]], 0, 0.3);
    if (B.far) return;
    for (const sx of [-1, 1]) { B.box(WHITE, 2.9, 1.5, 11.5, sx * 5.2, cy - 2.8, -15.5, 0, { jit: 0 }); B.box(DARK, 2.5, 1.1, 0.1, sx * 5.2, cy - 2.6, -9.72, 0, { jit: 0 }); B.box(DARK, 0.05, 0.16, L * 0.5, sx * R * 0.97, cy + 0.3, 2, 0, { jit: 0 }); }
    const leg = (lx, lz, h) => { B.cyl(GREY, 0.13, 0.15, h, lx, 0.5, lz, 6, { jit: 0 }); for (const k of [-0.33, 0.33]) B.add(new THREE.CylinderGeometry(0.5, 0.5, 0.34, 10).rotateZ(Math.PI / 2), TYRE, lx + k, 0.5, lz, 0, { jit: 0 }); };
    leg(0, 18, cy - 1.6); leg(-3.9, -9, cy - 2.2); leg(3.9, -9, cy - 2.2);
  });
  if (o.collide) { const c = Math.cos(ry), sn = Math.sin(ry); for (const k of [-0.3, 0, 0.3]) o.collide.box(x + k * L * sn, z + k * L * c, R + 0.3, L * 0.17, ry, -10, 9); o.collide.box(x - 13 * sn, z - 13 * c, 12.8, 9, ry, cy - 2, 8); }
}

// passerelle télescopique : couloir vitré sur pylône, du bâtiment (z0) vers l'avion (z1), dans le groupe courant
function jetBridge(B, x, z0, z1) {
  const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
  B.box(WHITE, 3, 2.8, len, x, 4.2, zc, 0, { jit: 0 }); B.box(P.verre, 3.06, 1.1, len - 2, x, 5.3, zc, 0, { jit: 0 }); B.cyl(WHITE, 2.3, 2.3, 3.2, x, 4, z1, 12); B.cyl(GREY, 0.3, 0.35, 4.2, x, 0, z1, 6); B.cyl(GREY, 0.3, 0.35, 4.2, x, 0, zc, 6);
}

// ---------- Aérogare de Toulouse-Blagnac : +Z = côté pistes (sud-ouest), +X = vers le hall A (sud-est) ----------
function buildAeroport(m) {
  const { B } = m, glass = P.verre, TILT = -0.138;
  // corps principal (halls C, B, A) : barre de 370 m légèrement oblique, toitures en vague
  B.group(50, 0, 35, TILT, () => {
    const halls = [[-125, 120, 15.5], [0, 130, 17.5], [125, 120, 15]];
    for (const [hx, hw, hh] of halls) {
      B.box(mk(0xd8dadc, 0.5, 0.2), hw, hh + 3, 40, hx, -3, 0); B.box(glass, hw - 4, hh - 4.5, 0.4, hx, 3.6, -20.1, 0, { jit: 0 }); B.box(P.verreLit, hw - 6, 3, 0.4, hx, 0.4, -20.15, 0, { jit: 0 });
      B.box(glass, hw - 6, hh - 6, 0.4, hx, 5, 20.1, 0, { jit: 0 });
      B.add(new THREE.CylinderGeometry(70, 70, hw + 2, B.n(14), 1, false, Math.PI / 2 - 0.299, 0.598).rotateZ(Math.PI / 2), mk(0xe9ebec, 0.35, 0.5), hx, hh - 66.6, 0, 0, { uv: 'cyl', r: 20, jit: 0 });
      if (B.hi) { for (let i = 0; i <= 10; i++) B.box(WHITE, 0.4, hh - 3, 0.6, hx - hw / 2 + 2 + i * (hw - 4) / 10, 3, -20.4, 0, { jit: 0 }); B.box(WHITE, hw, 0.5, 7, hx, 6.2, -24, 0, { jit: 0 }); for (let i = 0; i < 6; i++) B.cyl(GREY, 0.25, 0.25, 6.2, hx - hw / 2 + 8 + i * (hw - 16) / 5, 0, -27, 6); }
    }
    B.box(glass, 372, 6.5, 12, 0, 0, 26, 0, { jit: 0 }); B.box(WHITE, 373, 0.5, 13, 0, 6.5, 26, 0, { jit: 0 });                // jetée vitrée côté pistes
    if (B.hi) B.box(BLUE, 60, 2.6, 0.3, 0, 19, -19.4, 0, { jit: 0 });
  });
  m.collide.box(50, 41, 187, 26.5, TILT);
  // hall D : satellite en croissant et ses quatre doigts d'embarquement
  const DX = -252, DZ = -2, N = B.far ? 5 : 10;
  for (let i = 0; i < N; i++) {
    const a = Math.PI * (i + 0.5) / N, r = 50, x = DX + r * Math.cos(a), z = DZ + r * Math.sin(a), len = r * Math.PI / N + 2;
    const ry = -a - Math.PI / 2;
    B.box(mk(0xd8dadc, 0.5, 0.2), len, 13 + 3, 24, x, -3, z, ry); B.box(glass, len, 7, 24.4, x, 4, z, ry, { jit: 0 }); B.box(WHITE, len + 0.6, 0.6, 25.2, x, 13, z, ry, { jit: 0 });
    m.collide.box(x, z, len / 2, 12.2, ry);
  }
  B.box(mk(0xd8dadc, 0.5, 0.2), 70, 12, 22, -165, 0, 2); B.box(glass, 68, 6, 22.4, -165, 4, 2, 0, { jit: 0 }); m.collide.box(-165, 2, 35, 11.2);
  for (const a of [0.22, 0.42, 0.6, 0.8]) { const an = Math.PI * a, x = DX + 78 * Math.cos(an), z = DZ + 78 * Math.sin(an); B.box(WHITE, 3.4, 3, 34, x, 4.2, z, Math.PI / 2 - an, { jit: 0 }); B.cyl(GREY, 0.3, 0.3, 4.2, x, 0, z, 6); m.collide.circle(x, z, 0.5, -10, 5); }
  // passerelles et avions aux postes (nez vers l'aérogare)
  const stands = [['a320', 16, 100], ['a320', 100, 122], ['a320', 215, 150], ['a320', 272, 158], ['a320', -160, 92], ['a320', -233, 132], ['a320', -287, 136], ['a350', 405, 78]];
  stands.forEach(([type, x, z], i) => {
    aircraft(B, type, x, 0, z + (type === 'a350' ? 34 : 19), Math.PI + (i % 2 ? 0.05 : -0.04), { collide: m.collide });
    if (i < 4) jetBridge(B, x + 4, 66 + (x - 50) * 0.139, z + 6);
  });
  // matériel de piste : escabeaux, tracteurs, citernes
  if (B.hi) for (const [x, z] of [[40, 125], [128, 150], [240, 172], [-140, 122], [-210, 160]]) { B.box(mk(0xe0b21c, 0.6, 0), 2.2, 1.6, 4.2, x, 0, z, 0.4); B.box(WHITE, 2.4, 2.4, 7, x + 9, 0, z + 4, -0.3); B.box(DARK, 2.3, 0.8, 2, x + 9, 2.4, z + 6.6, -0.3, { jit: 0 }); }
  return { height: 22 };
}

// ---------- Tour de contrôle de Blagnac (45 m) ----------
function buildTourControle(m) {
  const { B } = m, C = P.beton;
  B.box(C, 22, 7, 16, 0, -1, 4); B.box(P.verre, 20, 2.4, 16.2, 0, 2.4, 4, 0, { jit: 0 });
  B.cyl(C, 3.4, 3.8, 33, 0, -1, 0, 8, { exact: true }); B.cyl(C, 6.2, 3.4, 4, 0, 32, 0, 12); B.cyl(P.verreLit, 7.2, 6.2, 3.4, 0, 36, 0, 12, { jit: 0 }); B.cyl(C, 7.6, 7.6, 0.7, 0, 39.4, 0, 12); B.cyl(C, 4.2, 5.2, 2.4, 0, 40.1, 0, 12);
  B.cyl(P.metal, 0.1, 0.25, 6, 0, 42.5, 0, 5); B.sphere(WHITE, 1.3, 2.4, 43.6, 0, 8); if (B.hi) for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; B.box(C, 0.2, 3.4, 0.2, Math.sin(a) * 6.75, 36, Math.cos(a) * 6.75, a, { jit: 0 }); }
  m.collide.box(0, 4, 11.2, 8.2); m.collide.circle(0, 0, 4);
  return { height: 49 };
}

// ---------- Tarmac des usines Airbus : appareils en essais avant livraison ----------
function buildAirbus(m) {
  const { B } = m;
  aircraft(B, 'a380', 96, 0, -170, Math.PI / 2, { collide: m.collide }); aircraft(B, 'a350', 92, 0, -122, -Math.PI / 2, { collide: m.collide });
  aircraft(B, 'beluga', 62, 0, -72, Math.PI / 2 - 0.16, { collide: m.collide }); aircraft(B, 'a350', 262, 0, -72, -0.85, { collide: m.collide }); aircraft(B, 'a320', 24, 0, -24, -0.75, { collide: m.collide });
  aircraft(B, 'a320', 190, 0, -214, Math.PI / 2, { collide: m.collide });
  if (B.hi) for (const [x, z] of [[40, -150], [150, -100], [10, -60]]) { B.box(mk(0xe0b21c, 0.6, 0), 2.2, 1.6, 4.2, x, 0, z, 0.5); B.box(WHITE, 2.6, 3.4, 9, x + 7, 0, z - 6, 1.2); }
  return { height: 26 };
}

// ---------- Aeroscopia : hangar-musée en arche (plan en éventail), Concorde, A380, A340, A400M, Caravelle dehors ----------
function buildAeroscopia(m) {
  const { B } = m, shell = mk(0xc9ced2, 0.35, 0.7, 0.7);
  // éventail : centre (CX, CZ), rayons R0..R1, ouverture A0..A1 autour de -Z ; voûte en arc le long du rayon
  const CX = -22, CZ = 168, R0 = 178, R1 = 252, A0 = -0.33, A1 = 0.27, NA = B.far ? 5 : 12, NR = B.far ? 4 : 8, HT = 23;
  const pt = (a, r, h) => [CX + Math.sin(a) * r, h, CZ - Math.cos(a) * r], tris = [], ends = [];
  const hgt = (j) => 1.5 + HT * Math.sin(Math.PI * j / NR);
  for (let i = 0; i < NA; i++) for (let j = 0; j < NR; j++) {
    const a0 = A0 + (A1 - A0) * i / NA, a1 = A0 + (A1 - A0) * (i + 1) / NA, r0 = R0 + (R1 - R0) * j / NR, r1 = R0 + (R1 - R0) * (j + 1) / NR;
    const p00 = pt(a0, r0, hgt(j)), p01 = pt(a0, r1, hgt(j + 1)), p10 = pt(a1, r0, hgt(j)), p11 = pt(a1, r1, hgt(j + 1));
    tris.push(...p00, ...p01, ...p11, ...p00, ...p11, ...p10);
  }
  B.tris(shell, tris, 0, 0, 0, 0, { up: true, uv: 'box' });
  for (const a of [A0, A1]) for (let j = 0; j < NR; j++) { const r0 = R0 + (R1 - R0) * j / NR, r1 = R0 + (R1 - R0) * (j + 1) / NR, q = [pt(a, r0, 0), pt(a, r1, 0), pt(a, r1, hgt(j + 1)), pt(a, r0, hgt(j))]; ends.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3], ...q[0], ...q[2], ...q[1], ...q[0], ...q[3], ...q[2]); }
  B.tris(P.verre, ends, 0, 0, 0, 0, { jit: 0 });
  for (let i = 0; i < NA; i++) { const a = A0 + (A1 - A0) * (i + 0.5) / NA, len = (A1 - A0) / NA; for (const r of [R0, R1]) { const [x, , z] = pt(a, r, 0); B.box(shell, r * len + 0.4, 1.6, 0.6, x, 0, z, -a); } const [cx, , cz] = pt(a, (R0 + R1) / 2, 0); m.collide.box(cx, cz, (R0 + R1) / 2 * len / 2 + 0.3, (R1 - R0) / 2, -a); }
  // bâtiment d'accueil
  B.box(mk(0x3b3f45, 0.6, 0.3), 20, 8, 56, 26, 0, 40, 0.42); B.box(P.verreLit, 20.4, 3, 50, 26, 1, 40, 0.42, { jit: 0 }); m.collide.box(26, 40, 10.2, 28.2, 0.42);
  // avions exposés à l'extérieur (positions relevées)
  const at = (lat, lon) => m.ll(lat, lon);
  { const [x, z] = at(43.65943, 1.36047); concorde(B, x + 22, 0, z + 6, 0.5, { collide: m.collide }); }
  { const [x, z] = at(43.66135, 1.35978); aircraft(B, 'a380', x, 0, z, -1.2, { collide: m.collide }); }
  { const [x, z] = at(43.66219, 1.35960); aircraft(B, 'a340', x, 0, z + 20, -1.5, { collide: m.collide }); }
  { const [x, z] = at(43.65970, 1.35877); aircraft(B, 'a400m', x, 0, z, 2.2, { collide: m.collide }); }
  { const [x, z] = at(43.65919, 1.36010); aircraft(B, 'caravelle', x, 0, z, 0.9, { collide: m.collide }); }
  return { height: 28 };
}

export const DEFS = { tls_aeroport: buildAeroport, tls_tourcontrole: buildTourControle, tls_airbus: buildAirbus, tls_aeroscopia: buildAeroscopia };

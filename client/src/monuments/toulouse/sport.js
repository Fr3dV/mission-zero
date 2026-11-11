// Sports et spectacles : Stadium de Toulouse (île du Ramier), stade Ernest-Wallon, Zénith, Halle aux Grains, palais des sports.
import * as THREE from 'three';
import { P } from '../kit.js';

const mk = (hex, r = 0.7, mt = 0, g = 0.5, t = 0) => { const c = new THREE.Color(hex); return { c: [c.r, c.g, c.b], r, m: mt, t, g }; };
const quad = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
// pelouse et tracé du terrain (w le long de X, l le long de Z), centré
function pitch(B, x, z, w, l, ry = 0) {
  B.box(P.pelouse, w + 8, 0.2, l + 8, x, -0.08, z, ry, { jit: 0 });
  if (B.far) return;
  B.group(x, 0, z, ry, () => { const W = mk(0xf0f0ec, 0.8); for (const sz of [-1, 1]) B.box(W, w, 0.02, 0.2, 0, 0.13, sz * l / 2, 0, { jit: 0 }); for (const sx of [-1, 1]) B.box(W, 0.2, 0.02, l, sx * w / 2, 0.13, 0, 0, { jit: 0 }); B.box(W, w, 0.02, 0.2, 0, 0.13, 0, 0, { jit: 0 }); for (let k = 0; k < 9; k++) B.box(mk(0x6b9a48, 0.95, 0, 0), w, 0.01, l / 18, 0, 0.125, -l / 2 + (k * 2 + 0.5) * l / 18, 0, { jit: 0 }); });
}
// tribune droite : gradins montant vers -Z local (le terrain est du côté +Z), toit en porte-à-faux
function stand(B, m, x, z, ry, len, dep, hBack, roofH, seat, o = {}) {
  const C = P.beton, a = len / 2, t = [], side = [];
  B.group(x, 0, z, ry, () => {
    quad(t, [-a, 1.4, dep / 2], [a, 1.4, dep / 2], [a, hBack, -dep / 2 + 2], [-a, hBack, -dep / 2 + 2]);
    B.tris(seat, t, 0, 0, 0, 0, { jit: 0 });
    if (B.hi) for (let i = 0; i < Math.round(len / 14); i++) B.tris(mk(0xe8e8e4, 0.8), [(() => { const x0 = -a + (i + 0.5) * len / Math.round(len / 14) - 0.6, q = []; quad(q, [x0, 1.45, dep / 2], [x0 + 1.2, 1.45, dep / 2], [x0 + 1.2, hBack + 0.05, -dep / 2 + 2], [x0, hBack + 0.05, -dep / 2 + 2]); return q; })()].flat(), 0, 0, 0, 0, { jit: 0 });   // escaliers d'accès
    B.box(C, len, hBack + 3 + 3, 2, 0, -3, -dep / 2 + 1); B.box(C, len, 1.4 + 3, 0.5, 0, -3, dep / 2);
    for (const sx of [-1, 1]) { side.length = 0; side.push(sx * a, 0, dep / 2, sx * a, 0, -dep / 2 + 2, sx * a, hBack, -dep / 2 + 2, sx * a, 0, dep / 2, sx * a, hBack, -dep / 2 + 2, sx * a, 1.4, dep / 2); B.tris(C, [...side, ...[0, 2, 1, 3, 5, 4].flatMap((k) => side.slice(k * 3, k * 3 + 3))], 0, 0, 0, 0); }
    if (roofH) {
      const q = []; quad(q, [-a - 1, roofH - 1.2, dep / 2 - dep * 0.15], [a + 1, roofH - 1.2, dep / 2 - dep * 0.15], [a + 1, roofH, -dep / 2 - 1], [-a - 1, roofH, -dep / 2 - 1]);
      B.tris(o.roofMat || P.metal, [...q, ...[0, 2, 1, 3, 5, 4].flatMap((k) => q.slice(k * 3, k * 3 + 3))], 0, 0, 0, 0, { jit: 0, uv: 'box' });
      const n = Math.max(2, Math.round(len / (B.far ? 40 : 15)));
      for (let i = 0; i <= n; i++) { const px = -a + i * len / n; B.box(P.metalD, 0.5, roofH + 2, 0.7, px, 0, -dep / 2 - 0.2, 0, { jit: 0 }); if (B.hi) B.add(new THREE.BoxGeometry(0.35, 0.5, dep * 0.9).rotateX(1.2 / (dep * 0.85)), P.metalD, px, roofH - 0.3, -dep * 0.08, 0, { jit: 0 }); }
    }
    if (o.wallMat) B.box(o.wallMat, len + 0.4, Math.min(hBack, 7), 0.4, 0, 0, -dep / 2 - 0.1);
  });
  m.collide.box(x, z, ry % Math.PI ? dep / 2 + 0.6 : len / 2 + 0.6, ry % Math.PI ? len / 2 + 0.6 : dep / 2 + 0.6);
}

// ---------- Stadium de Toulouse : anneau continu de 33 000 places, toiture périphérique ----------
function buildStadium(m) {
  const { B } = m, N = B.far ? 24 : 56, C = P.beton, violet = mk(0x5a3b8f, 0.7), white = mk(0xe9e9e6, 0.7), roof = mk(0xd9dcde, 0.35, 0.5);
  const sup = (a, b, t, n = 2.8) => { const c = Math.cos(t), s = Math.sin(t); return [a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]; };
  const seatsV = [], seatsW = [], wall = [], rf = [], inner = [];
  for (let i = 0; i < N; i++) {
    const t0 = i / N * Math.PI * 2, t1 = (i + 1) / N * Math.PI * 2, [ix0, iz0] = sup(88, 42, t0), [ix1, iz1] = sup(88, 42, t1), [ox0, oz0] = sup(105, 70, t0, 3.4), [ox1, oz1] = sup(105, 70, t1, 3.4);
    const hB = 21, mx = (v) => v * 0.82;
    quad(i % 7 === 3 ? seatsW : seatsV, [ix1, 1.6, iz1], [ix0, 1.6, iz0], [ox0 * 0.985, hB, oz0 * 0.985], [ox1 * 0.985, hB, oz1 * 0.985]);
    quad(wall, [ox0, -3, oz0], [ox1, -3, oz1], [ox1, hB + 2.5, oz1], [ox0, hB + 2.5, oz0]);
    quad(inner, [ix0, -1, iz0], [ix1, -1, iz1], [ix1, 1.6, iz1], [ix0, 1.6, iz0]);
    // toiture : couronne inclinée vers le terrain, double face
    const r0 = [ox0 * 1.03, 29, oz0 * 1.03], r1 = [ox1 * 1.03, 29, oz1 * 1.03], q0 = [ix0 + (ox0 - ix0) * 0.12, 26, iz0 + (oz0 - iz0) * 0.12], q1 = [ix1 + (ox1 - ix1) * 0.12, 26, iz1 + (oz1 - iz1) * 0.12];
    quad(rf, q1, q0, r0, r1); quad(rf, q0, q1, r1, r0);
    if (B.hi && i % 2 === 0) { B.cyl(P.metalD, 0.35, 0.45, 29, ox0 * 1.01, 0, oz0 * 1.01, 6, { jit: 0 }); B.add(new THREE.BoxGeometry(0.3, 0.4, 1).scale(1, 1, Math.hypot(ox0 - q0[0], oz0 - q0[2])).rotateY(Math.atan2(q0[0] - ox0, q0[2] - oz0)), P.metalD, (ox0 + q0[0]) / 2, 27.2, (oz0 + q0[2]) / 2, 0, { jit: 0 }); }
    void mx;
  }
  B.tris(violet, seatsV, 0, 0, 0, 0, { jit: 0 }); B.tris(white, seatsW, 0, 0, 0, 0, { jit: 0 }); B.tris(C, wall, 0, 0, 0, 0, { uv: 'box' }); B.tris(C, inner, 0, 0, 0, 0, { jit: 0, uv: 'box' }); B.tris(roof, rf, 0, 0, 0, 0, { jit: 0, uv: 'box' });
  // tribunes d'honneur rapportées (nord et sud), loges vitrées
  B.box(C, 60, 24, 14, 0, 0, -75); B.box(P.verreLit, 56, 3, 14.4, 0, 12, -75, 0, { jit: 0 }); B.box(C, 120, 20, 15, 0, 0, 82.5); B.box(P.verreLit, 110, 3, 15.4, 0, 9, 82.5, 0, { jit: 0 });
  pitch(B, 0, 0, 105, 68, Math.PI / 2);
  // quatre mâts d'éclairage
  if (B.hi) for (const sx of [-1, 1]) for (const sz of [-1, 1]) { B.cyl(P.metalD, 0.5, 0.9, 46, sx * 108, 0, sz * 74, 8); B.box(mk(0xf2f0e0, 0.4, 0, 2), 9, 5, 0.6, sx * 108, 44, sz * 74, Math.atan2(sx, sz)); }
  m.collide.box(0, 0, 106, 71); m.collide.box(0, -77, 30.5, 7); m.collide.box(0, 82.5, 60.5, 8);
  return { height: 46 };
}

// ---------- Stade Ernest-Wallon (Stade toulousain) : quatre tribunes, rouge et noir ----------
function buildWallon(m) {
  const { B } = m, red = mk(0xb3261c, 0.7), black = mk(0x26262a, 0.7), wallM = mk(0xb04a35, 0.85, 0, 0.6);
  stand(B, m, -36.5, -4, Math.PI / 2, 180, 21, 17, 25, red, { wallMat: wallM }); stand(B, m, 68, -2, -Math.PI / 2, 176, 20, 15, 22, red, { wallMat: wallM });
  stand(B, m, 2, -86.5, 0, 102, 17, 10, 14, black, { wallMat: wallM }); stand(B, m, 5, 82.5, Math.PI, 96, 17, 10, 14, black, { wallMat: wallM });
  pitch(B, 14.5, -2, 70, 122);
  if (B.hi) { const W = mk(0xf0f0ec, 0.6); for (const sz of [-1, 1]) { for (const sx of [-1, 1]) B.cyl(W, 0.1, 0.12, 13, 14.5 + sx * 2.8, 0, -2 + sz * 50, 5); B.box(W, 5.6, 0.14, 0.14, 14.5, 3, -2 + sz * 50, 0, { jit: 0 }); } }   // poteaux de rugby
  return { height: 28 };
}

// ---------- Zénith Toulouse Métropole : grande salle polygonale, couverture suspendue à des mâts ----------
function buildZenith(m) {
  const { B } = m, skin = mk(0xb9bdc1, 0.45, 0.5), R = 52;
  B.cyl(skin, R - 2, R, 15 + 3, 0, -3, 0, 10, { exact: true }); B.cyl(mk(0x8f2a22, 0.6, 0.2), R + 0.3, R + 0.3, 2.2, 0, 12.5, 0, 10, { exact: true, jit: 0 });
  B.cyl(P.zinc, 9, R - 1.5, 7.5, 0, 15, 0, 10, { exact: true, open: true }); B.cyl(P.zinc, 9.4, 9.4, 1.4, 0, 22.5, 0, 10, { exact: true }); B.cyl(P.zinc, 0.5, 9.4, 1.2, 0, 23.9, 0, 10, { exact: true, open: true });
  B.group(0, 0, 0, Math.PI / 2, () => { B.box(P.verreLit, 28, 8.5, 1.2, 0, 0.4, R * 0.951 - 0.2, 0, { jit: 0 }); B.box(P.metalD, 34, 0.6, 9, 0, 9, R * 0.951 + 3.5); for (const x of [-15, -5, 5, 15]) B.cyl(P.metalD, 0.25, 0.25, 9, x, 0, R * 0.951 + 7, 6); });
  for (let k = 0; k < 5; k++) {                                                           // mâts inclinés et haubans
    const a = k * Math.PI * 2 / 5 + 0.3, s = Math.sin(a), c = Math.cos(a);
    B.add(new THREE.CylinderGeometry(0.35, 0.6, 36, 8).translate(0, 18, 0).rotateX(-0.22), mk(0xe9e9e6, 0.4, 0.3), s * (R + 6), 0, c * (R + 6), a, { jit: 0 });
    if (B.hi) for (const f of [0.25, 0.55]) { const tx = s * (R + 6 - 7.5), ty = 35, tz = c * (R + 6 - 7.5), ex = s * R * f, ey = 15 + 7.5 * (1 - f), ez = c * R * f, len = Math.hypot(tx - ex, ty - ey, tz - ez); B.add(new THREE.CylinderGeometry(0.06, 0.06, len, 4).translate(0, len / 2, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(tx - ex, ty - ey, tz - ez).normalize())), P.metalD, ex, ey, ez, 0, { jit: 0 }); }
    m.collide.circle(s * (R + 6), c * (R + 6), 0.9, -10, 6);
  }
  B.box(skin, 46, 5, 26, -30, 0, 46, 0.5); m.collide.box(-30, 46, 23, 13, 0.5);
  m.collide.circle(0, 0, R * 0.97);
  return { height: 38 };
}

// ---------- Halle aux Grains : halle hexagonale de brique, lanterneau ----------
function buildHalleAuxGrains(m) {
  const { B } = m, BR = P.brick, ST = P.pierre, R = 31.5, ap = R * Math.cos(Math.PI / 6), fw = R;
  B.cyl(BR, R, R, 11.5 + 3, 0, -3, 0, 6, { exact: true }); B.cyl(ST, R + 0.4, R + 0.4, 0.7, 0, 10.8, 0, 6, { exact: true, jit: 0 }); B.cyl(P.brickD, R + 0.25, R + 0.25, 1.3, 0, 0, 0, 6, { exact: true });
  for (let k = 0; k < 6; k++) B.group(0, 0, 0, k * Math.PI / 3 + Math.PI / 6, () => {
    for (const x of [-fw * 0.3, 0, fw * 0.3]) B.win(x, 2.4, ap + 0.02, 3.4, 5.2, { arch: true, frameMat: ST, lit: 0.7, farMin: 0 });
    if (k === 0) { B.box(BR, 13, 12.5, 3, 0, 0, ap + 1.5); B.gable(ST, P.zinc, 13.6, 3, 3.4, 0, 12.5, ap + 1.5); B.win(0, 0, ap + 3.02, 4.4, 6.5, { arch: true, mat: P.shadow, frameMat: ST, farMin: 0 }); }
    if (B.hi) B.group(0, 0, 0, Math.PI / 6, () => B.box(ST, 1.3, 11, 1, 0, 0, R - 0.2, 0, { jit: 0.02 }));
  });
  B.cyl(P.zinc, 9, R + 0.5, 6.5, 0, 11.5, 0, 6, { exact: true, open: true }); B.cyl(P.verreLit, 8.6, 8.6, 2.6, 0, 18, 0, 6, { exact: true, jit: 0 }); B.cyl(P.zinc, 0.4, 9.2, 2.4, 0, 20.6, 0, 6, { exact: true, open: true });
  m.collide.circle(0, 0, ap + 0.5); m.collide.box(...[Math.sin(Math.PI / 6) * (ap + 1.5), Math.cos(Math.PI / 6) * (ap + 1.5)], 6.6, 2, Math.PI / 6);
  return { height: 24 };
}

// ---------- Palais des sports André-Brouat : halle à toiture en vague ----------
function buildPalaisSports(m) {
  const { B } = m, clad = mk(0x9c5744, 0.85, 0.05, 0.8);
  B.box(clad, 83, 9 + 3, 66, 0, -3, 0); B.box(P.verreLit, 60, 5, 0.5, 0, 1, 33.1, 0, { jit: 0 }); B.box(P.metalD, 64, 0.5, 6, 0, 6.2, 36);
  B.add(new THREE.CylinderGeometry(60, 60, 83.6, B.n(14), 1, false, Math.PI / 2 - 0.59, 1.18).rotateZ(Math.PI / 2), mk(0xd4d7da, 0.35, 0.55), 0, 9 - 49.8, 0, 0, { uv: 'cyl', r: 20, jit: 0 });
  if (B.hi) for (const ry of [Math.PI / 2, -Math.PI / 2, Math.PI]) B.group(0, 0, 0, ry, () => { const L = ry === Math.PI ? 83 : 66, off = ry === Math.PI ? 33 : 41.5; B.winRow(-L / 2 + 4, L / 2 - 4, 5.4, off + 0.02, 6, 6, 1.8, { mat: P.verre, frame: false, farMin: 1e9 }); });
  m.collide.box(0, 0, 41.8, 33.4);
  return { height: 22 };
}

export const DEFS = { tls_stadium: buildStadium, tls_wallon: buildWallon, tls_zenith: buildZenith, tls_halleauxgrains: buildHalleAuxGrains, tls_palaissports: buildPalaisSports };

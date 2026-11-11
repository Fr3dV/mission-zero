// Cité de l'espace (Ariane 5 grandeur nature sur sa table de lancement, station Mir, planétarium, coupoles)
// et Halle de la Machine à Montaudran (grande halle vitrée, le Minotaure sur la Piste des Géants).
import * as THREE from 'three';
import { P } from '../kit.js';

const mk = (hex, r = 0.5, mt = 0.1, g = 0.6, t = 0) => { const c = new THREE.Color(hex); return { c: [c.r, c.g, c.b], r, m: mt, t, g }; };
const WHITE = mk(0xeceeee, 0.35, 0.15, 1), DARK = mk(0x23272c, 0.4, 0.3, 0.1), PANEL = mk(0x162a52, 0.25, 0.5, 0.2), GOLD = mk(0xc9a23a, 0.35, 0.7, 0.8);

// ---------- Cité de l'espace : +Z = sud ----------
function buildCiteEspace(m) {
  const { B } = m, C = P.beton;
  // ---- Ariane 5 (53 m) sur sa table de lancement ----
  const [ax, az] = m.ll(43.58556, 1.49301), TY = 5.5;
  B.box(C, 20, TY + 3, 22, ax, -3, az); B.box(DARK, 6, 3.6, 22.4, ax - 5, 0.4, az, 0, { jit: 0 }); B.box(DARK, 6, 3.6, 22.4, ax + 5, 0.4, az, 0, { jit: 0 }); B.box(C, 21, 0.6, 23, ax, TY, az);
  if (B.hi) { B.box(mk(0x8e959b, 0.5, 0.5), 3, 12, 3, ax, TY, az - 8.5); for (let j = 0; j < 6; j++) B.box(mk(0x8e959b, 0.5, 0.5), 3.4, 0.2, 3.4, ax, TY + 2 * j, az - 8.5, 0, { jit: 0 }); for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl(mk(0x8e959b, 0.5, 0.5), 0.12, 0.2, 62, ax + sx * 16, 0, az + sz * 16, 5); }
  const RY = TY + 0.9, RC = 2.7;
  B.cyl(DARK, 1.6, 2.2, 2.6, ax, RY - 0.6, az, 12, { jit: 0 });                                            // moteur Vulcain
  B.cyl(WHITE, RC, RC, 30.5, ax, RY + 1.4, az, 24); B.cyl(DARK, RC + 0.03, RC + 0.03, 1.2, ax, RY + 23.5, az, 24, { jit: 0 }); B.cyl(GOLD, RC + 0.02, RC + 0.02, 0.7, ax, RY + 31.9, az, 24, { jit: 0 });
  B.cyl(DARK, RC + 0.04, RC + 0.04, 1.6, ax, RY + 32.6, az, 24, { jit: 0 }); B.cyl(WHITE, RC, RC, 9, ax, RY + 34.2, az, 24);
  B.lathe(WHITE, [[RC, 0], [RC * 0.96, 2.4], [RC * 0.8, 5], [RC * 0.52, 7.2], [RC * 0.2, 8.6], [0.02, 9]], ax, RY + 43.2, az, 24);
  for (const sx of [-1, 1]) {                                                                                // deux propulseurs d'appoint
    const bx = ax + sx * (RC + 1.62);
    B.cyl(DARK, 1.1, 1.75, 2.4, bx, RY - 1.6, az, 12, { jit: 0 }); B.cyl(WHITE, 1.52, 1.52, 26.6, bx, RY + 0.8, az, 16); B.cyl(WHITE, 0.25, 1.52, 4.2, bx, RY + 27.4, az, 16);
    if (B.hi) { for (const y of [5, 12, 19]) B.cyl(DARK, 1.55, 1.55, 0.3, bx, RY + y, az, 16, { jit: 0 }); B.box(WHITE, 1.3, 0.5, 0.5, ax + sx * (RC + 0.4), RY + 26, az, 0, { jit: 0 }); B.box(WHITE, 1.3, 0.5, 0.5, ax + sx * (RC + 0.4), RY + 3, az, 0, { jit: 0 }); }
  }
  m.collide.box(ax, az, 10.4, 11.4);
  // ---- station Mir : bloc de base, nœud d'amarrage, modules en croix, panneaux solaires ----
  const [mx, mz] = m.ll(43.58563, 1.49401), MY = 7.5, cylX = (mat, r, len, x, y, z, seg = 12) => B.add(new THREE.CylinderGeometry(r, r, len, B.n(seg)).rotateZ(Math.PI / 2), mat, x, y, z, 0, { uv: 'cyl', r, jit: 0.04 }), cylZ = (mat, r, len, x, y, z, seg = 12) => B.add(new THREE.CylinderGeometry(r, r, len, B.n(seg)).rotateX(Math.PI / 2), mat, x, y, z, 0, { uv: 'cyl', r, jit: 0.04 });
  cylX(WHITE, 2.1, 9, mx - 3, MY, mz); cylX(WHITE, 1.45, 5, mx - 10, MY, mz); cylX(WHITE, 2, 5.8, mx - 15.4, MY, mz); B.sphere(WHITE, 1.7, mx + 2.6, MY, mz, 10);
  cylZ(WHITE, 2.05, 12, mx + 2.6, MY, mz + 8); cylZ(WHITE, 2.05, 12, mx + 2.6, MY, mz - 8); cylX(WHITE, 2.05, 11, mx + 9.5, MY, mz);
  for (const [px, pz, w, d] of [[mx - 3, mz + 8.5, 3.2, 12], [mx - 3, mz - 8.5, 3.2, 12], [mx - 15.4, mz + 6.5, 2.6, 9], [mx + 2.6, mz + 17, 12, 3], [mx + 2.6, mz - 17, 12, 3], [mx + 12, mz + 7, 3, 10], [mx + 12, mz - 7, 3, 10]]) B.box(PANEL, w, 0.12, d, px, MY, pz, 0, { jit: 0 });
  for (const [px, pz] of [[mx - 14, mz], [mx - 3, mz], [mx + 2.6, mz + 10], [mx + 2.6, mz - 10], [mx + 11, mz]]) { B.cyl(mk(0x8e959b, 0.5, 0.5), 0.3, 0.4, MY - 2, px, 0, pz, 6); m.collide.circle(px, pz, 0.6, -10, 5); }
  // ---- bâtiment principal : IMAX et dôme blanc du planétarium ----
  const [bx, bz] = m.ll(43.58610, 1.49185), [px, pz] = m.ll(43.58628, 1.49162), [ix, iz] = m.ll(43.58593, 1.49169);
  B.cyl(mk(0xdcdedc, 0.6, 0.1), 36, 36, 8 + 3, bx, -3, bz, 28); B.cyl(P.verreLit, 36.2, 36.2, 3, bx, 1, bz, 28, { jit: 0, t0: 0.4, tl: 2.2 }); B.cyl(mk(0xdcdedc, 0.6, 0.1), 37, 37, 0.6, bx, 8, bz, 28);
  B.dome(WHITE, 12.5, 11, px, 8.4, pz, 28); B.box(mk(0x3d4750, 0.5, 0.3), 30, 17, 24, ix, 0, iz, 0.2);
  m.collide.circle(bx, bz, 36.5); m.collide.box(ix, iz, 15.2, 12.2, 0.2);
  // ---- Astralia (entrée) et sa sphère, Terr@dome, Lunexplorer, coupole de l'astronome ----
  const [sx2, sz2] = m.ll(43.58688, 1.49314);
  B.box(mk(0xdcdedc, 0.6, 0.1), 51, 11 + 3, 86, sx2, -3, sz2, 0.82); B.box(P.verreLit, 51.4, 4, 60, sx2, 1, sz2, 0.82, { jit: 0 }); B.sphere(WHITE, 10, sx2 + 6, 13, sz2 - 4, 20); m.collide.box(sx2, sz2, 25.7, 43.2, 0.82);
  B.dome(WHITE, 12.5, 12.5, -8, 0, -66, 24); B.cyl(DARK, 12.7, 12.7, 1, -8, 0, -66, 24, { jit: 0 }); m.collide.circle(-8, -66, 12.8);
  const [lx, lz] = m.ll(43.58521, 1.49417); B.cyl(WHITE, 11, 11, 9, lx, 0, lz, 24); B.dome(mk(0xb9bdc1, 0.4, 0.4), 11.2, 3, lx, 9, lz, 24); B.cyl(P.verreLit, 11.1, 11.1, 2.4, lx, 2, lz, 24, { jit: 0 }); m.collide.circle(lx, lz, 11.4);
  B.cyl(WHITE, 3.6, 3.6, 4.2, 30, 0, 60, 14); B.dome(WHITE, 3.8, 3.8, 30, 4.2, 60, 14); B.box(DARK, 1.1, 3.4, 0.3, 30, 4.6, 63.2, 0, { jit: 0 }); m.collide.circle(30, 60, 3.9);
  return { height: 60 };
}

// ---------- Halle de la Machine : +Z = vers la Piste des Géants ----------
function buildHalleMachine(m) {
  const { B } = m, W = 103, D = 72, H = 14, steel = mk(0x3a3f45, 0.55, 0.5, 0.3), wood = mk(0x8a6238, 0.8, 0, 0.6), woodD = mk(0x5e4226, 0.8, 0, 0.5);
  B.box(steel, W, 5 + 3, D, 0, -3, 0); B.box(P.verre, W - 1.2, H - 5, D - 1.2, 0, 5, 0, 0, { jit: 0 }); B.box(steel, W + 0.6, 0.8, D + 0.6, 0, H, 0);
  B.add(new THREE.CylinderGeometry(70, 70, W + 1, B.n(14), 1, false, Math.PI / 2 - 0.54, 1.08).rotateZ(Math.PI / 2), mk(0xc4c8cb, 0.4, 0.55, 0.5), 0, H + 0.6 - 60, 0, 0, { uv: 'cyl', r: 20, jit: 0 });
  for (const sz of [-1, 1]) B.group(0, 0, sz * D / 2, sz > 0 ? 0 : Math.PI, () => {
    if (B.hi) for (let i = 0; i <= 12; i++) B.box(steel, 0.5, H, 0.6, -W / 2 + i * W / 12, 0, 0.2, 0, { jit: 0 });
    if (sz > 0) { B.box(P.verreLit, 30, 4, 0.4, -24, 0.4, 0.3, 0, { jit: 0 }); B.box(woodD, 24, 12, 0.5, 26, 0, 0.35, 0, { jit: 0 }); }   // accueil vitré, grandes portes des machines
  });
  m.collide.box(0, 0, W / 2 + 0.4, D / 2 + 0.4);
  // ---- le Minotaure (Astérion, 14 m) : corps de taureau à quatre pattes, buste, tête cornue, en bois et acier ----
  const mx = 26, mz = 62;                                       // sorti sur la Piste des Géants, devant les grandes portes
  B.group(mx, 0, mz, 0.5, () => {
    if (B.far) { B.box(wood, 4, 12, 13, 0, 0, 0); return; }
    B.add(new THREE.SphereGeometry(1, 12, 8).scale(2.3, 2.5, 5.2), wood, 0, 6.3, -1, 0, { jit: 0.05 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { B.add(new THREE.CylinderGeometry(0.55, 0.42, 3.2, 8).rotateX(sz * 0.25), woodD, sx * 1.9, 4.2, -1 + sz * 3.4, 0, { jit: 0.05 }); B.add(new THREE.CylinderGeometry(0.4, 0.5, 3, 8).rotateX(-sz * 0.2), steel, sx * 1.9, 1.5, -1 + sz * 3.9, 0, { jit: 0 }); B.sphere(steel, 0.55, sx * 1.9, 3, -1 + sz * 3.75, 6); }
    B.add(new THREE.CylinderGeometry(1.6, 2, 4.4, 10).rotateX(0.25), wood, 0, 9.4, 3.2, 0, { jit: 0.05 });                         // buste
    B.sphere(wood, 1.5, 0, 12.2, 4.2, 10); B.add(new THREE.BoxGeometry(1.5, 1.3, 2.2), woodD, 0, 11.8, 5.6, 0, { jit: 0 });             // tête, mufle
    for (const sx of [-1, 1]) { B.add(new THREE.CylinderGeometry(0.08, 0.32, 2.6, 6).rotateZ(-sx * 1.0), GOLD, sx * 1.9, 13.4, 4.2, 0, { jit: 0 }); B.add(new THREE.CylinderGeometry(0.45, 0.35, 3.6, 8).rotateZ(sx * 0.35), wood, sx * 2.4, 8.6, 3.4, 0, { jit: 0.05 }); B.add(new THREE.CylinderGeometry(0.35, 0.3, 3, 8).rotateX(-1.1), woodD, sx * 3, 6.6, 4.6, 0, { jit: 0.05 }); }
    B.add(new THREE.CylinderGeometry(0.06, 0.2, 4, 5).rotateX(-0.9), woodD, 0, 6.6, -7.2, 0, { jit: 0 });                             // queue
    for (const sx of [-1, 1]) B.add(new THREE.SphereGeometry(1, 8, 6).scale(0.25, 1.8, 2.6).rotateZ(sx * 0.5), mk(0x4a3a2a, 0.7, 0.2), sx * 2.4, 8.6, -1.5, 0, { jit: 0 });   // ailes repliées
  });
  m.collide.box(mx, mz, 3, 6.5, 0.5);
  return { height: 22 };
}

export const DEFS = { tls_citeespace: buildCiteEspace, tls_hallemachine: buildHalleMachine };

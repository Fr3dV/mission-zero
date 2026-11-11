// Louvre : pyramide de verre (base 35,4 m, hauteur 21,6 m), trois pyramidions, bassins triangulaires,
// et ailes du palais en U autour de la cour Napoléon (ouverte vers +Z, côté Tuileries).
import * as THREE from 'three';
import { P, palaceWing, slab } from './kit.js';

export function buildLouvre(m) {
  const { B, kit, far } = m, S = P.stone;
  // ---- verre : toutes les pyramides dans un seul mesh ----
  const pos = [], uv = [];
  const pyramid = (x, z, base, h, rows) => {
    const a = base / 2, c = [[-a, a], [a, a], [a, -a], [-a, -a]];
    for (let k = 0; k < 4; k++) { const p = c[k], q = c[(k + 1) % 4]; pos.push(x + p[0], 0.3, z + p[1], x + q[0], 0.3, z + q[1], x, h + 0.3, z); uv.push(0, 0, rows, 0, rows / 2, rows); }
    B.box(P.steel, base + 0.5, 0.35, base + 0.5, x, 0, z, 0, { jit: 0 });
    m.collide.box(x, z, a, a, 0, -100, h);
  };
  pyramid(0, 0, 35.4, 21.6, far ? 9 : 18);
  for (const [x, z] of [[41, 0], [-41, 0], [0, -41]]) pyramid(x, z, 8, 4.9, 4);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  const glass = new THREE.Mesh(g, kit.glassLouvre); glass.name = 'louvre:verre'; glass.renderOrder = 2; glass.castShadow = !far; m.add(glass);
  m.onUpdate((dt, st) => { kit.glassLouvre.emissiveIntensity = st.night * 0.55; });
  if (!far) { // intérieur suggéré : sol clair et pilier d'accueil
    B.box(P.stoneL, 33, 0.25, 33, 0, 0.02, 0, 0, { jit: 0 }); B.cyl(P.steel, 1.2, 1.2, 4.5, 0, 0.2, 0, 12); B.cyl(P.steel, 4, 4, 0.3, 0, 4.7, 0, 16);
  }
  // ---- bassins triangulaires (nord, sud, est) avec jets ----
  const A = 17.7;
  for (const k of [1, 2, 3]) B.group(0, 0, 0, k * Math.PI / 2, () => {
    slab(B, P.paveD, [[-A - 1.2, A + 0.8], [A + 1.2, A + 0.8], [0, 2 * A + 2.2]], 0, 0.55);
    slab(B, P.water, [[-A + 0.6, A + 1.6], [A - 0.6, A + 1.6], [0, 2 * A + 1]], 0.5, 0.12, { jit: 0 });
    if (B.hi) for (const x of [-7, 0, 7]) B.cyl(P.foam, 0.05, 0.3, 2.6, x, 0.6, A + 5, 6);
  });
  // ---- palais ----
  const floors = [{ h: 9, arch: true, w: 2.7, wh: 4.9, sill: 1.3, lit: 0.5 }, { h: 8.5, w: 2.2, wh: 5, sill: 1.6, lit: 0.45 }, { h: 6.5, w: 1.9, wh: 3, sill: 1.6, lit: 0.3 }];
  const wing = (x, z, ry, len) => B.group(x, 0, z, ry, () => palaceWing(B, { len, dep: 20, floors, bay: 5.6, roof: 'mansard', roofH: 6.5, roofMat: P.slate, pil: true }));
  const XW = 66, ZE = -86;
  wing(XW, -3, Math.PI / 2, 176); wing(-XW, -3, Math.PI / 2, 176); wing(0, ZE, 0, 112);
  m.collide.box(XW, -3, 10.4, 88.4); m.collide.box(-XW, -3, 10.4, 88.4); m.collide.box(0, ZE, 56, 10.4);
  // pavillons (toits « à l'impériale »)
  const pavilion = (x, z, ry, w = 27, big = false) => B.group(x, 0, z, ry, () => {
    const H = big ? 31 : 28, d = 25;
    B.box(S, w, H + 3, d, 0, -3, 0); B.box(P.stoneL, w + 1.4, 1, d + 1.4, 0, H, 0); B.box(P.stoneD, w + 0.5, 1.2, d + 0.5, 0, 0, 0);
    B.frustum(P.slate, w, d, w * 0.55, d * 0.5, 9, 0, H + 1, 0); B.frustum(P.slate, w * 0.55, d * 0.5, w * 0.3, d * 0.2, 2.5, 0, H + 10, 0);
    B.box(P.lead, w * 0.32, 0.8, d * 0.22, 0, H + 12.5, 0);
    for (const s of [1, -1]) B.group(0, 0, s * d / 2, s > 0 ? 0 : Math.PI, () => {
      B.win(0, 1.2, 0, 4.2, 6, { arch: true, lit: 0.8, farMin: 0 }); B.win(0, 11.5, 0, 3.6, 7, { arch: true, lit: 0.8, farMin: 0 });
      for (const sx of [-1, 1]) { B.win(sx * 8.5, 1.4, 0, 2.6, 5, { arch: true }); B.win(sx * 8.5, 11.5, 0, 2.2, 5); B.win(sx * 8.5, 20, 0, 1.9, 3); }
      B.win(0, 22, 0, 2.4, 3.4);
      if (B.hi) {
        for (const sx of [-1, 1]) for (const o of [3.6, 5.2]) { B.cyl(P.stoneL, 0.5, 0.55, 8.5, sx * o, 1.2, 0.9, 10); B.cyl(P.stoneL, 0.45, 0.5, 7.5, sx * o, 11, 0.9, 10); }
        B.box(P.stoneL, 12.5, 0.9, 2.2, 0, 9.8, 0.6); B.box(P.stoneL, 12.5, 0.9, 2.2, 0, 18.6, 0.6);
        B.gable(P.deco, P.slate, 13, 3.2, 1.6, 0, H - 4.5 + 4.6, 0.6); B.lump(P.deco, 0, 20, 0.9, 10, 5, 0.8, 8, x + z);
      }
    });
  });
  pavilion(XW, -3, Math.PI / 2, 30, true); pavilion(-XW, -3, Math.PI / 2, 30, true); pavilion(0, ZE, 0, 30, true); // Richelieu, Denon, Sully
  pavilion(XW, ZE, 0); pavilion(-XW, ZE, 0); pavilion(XW, 85, Math.PI / 2); pavilion(-XW, 85, Math.PI / 2);
  for (const [x, z] of [[XW, ZE], [-XW, ZE], [XW, 85], [-XW, 85]]) m.collide.box(x, z, 13.6, 13.6);
  for (const [x, z, ry] of [[XW, -3, 0], [-XW, -3, 0], [0, ZE, Math.PI / 2]]) m.collide.box(x, z, 12.8, 15.2, ry);
  return { height: 44 };
}

// Palais du Louvre, en trois ensembles partageant le même repère (+Z vers l'ouest / Tuileries, +X vers la Seine) :
//  - louvre     : pyramide de verre, pyramidions, bassins, et les deux massifs Richelieu (nord) / Denon (sud) de la cour Napoléon ;
//  - courcarree : la Cour Carrée (pavillon de l'Horloge, colonnade de Perrault), porches traversants sur les quatre côtés ;
//  - carrousel  : arc de triomphe du Carrousel, longues ailes de Rivoli (Rohan, Marsan) et du bord de l'eau (Flore), guichets.
import * as THREE from 'three';
import { P, slab, wing, court, pavilion, arcadeShape, Water } from './kit.js';

const FLOORS = [{ h: 9, arch: true, w: 2.7, wh: 4.9, sill: 1.3, lit: 0.5 }, { h: 8.5, w: 2.2, wh: 5, sill: 1.6, lit: 0.45 }, { h: 6.5, w: 1.9, wh: 3, sill: 1.6, lit: 0.3 }];
const WING = { dep: 20, floors: FLOORS, bay: 5.6, roof: 'mansard', roofH: 6.5, roofMat: P.slate, pil: true };
const Z0 = -128, Z1 = 85;            // extrémités est et ouest des massifs de la cour Napoléon

export function buildLouvre(m) {
  const { B, kit, far } = m;
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
  if (!far) { B.box(P.stoneL, 33, 0.25, 33, 0, 0.02, 0, 0, { jit: 0 }); B.cyl(P.steel, 1.2, 1.2, 4.5, 0, 0.2, 0, 12); B.cyl(P.steel, 4, 4, 0.3, 0, 4.7, 0, 16); }
  // ---- bassins triangulaires (nord, sud, est) avec jets animés ----
  const A = 17.7, W = new Water();
  for (const k of [1, 2, 3]) B.group(0, 0, 0, k * Math.PI / 2, () => {
    slab(B, P.paveD, [[-A - 1.2, A + 0.8], [A + 1.2, A + 0.8], [0, 2 * A + 2.2]], 0, 0.55);
    slab(B, P.water, [[-A + 0.6, A + 1.6], [A - 0.6, A + 1.6], [0, 2 * A + 1]], 0.5, 0.12, { jit: 0 });
    const c = Math.cos(k * Math.PI / 2), s = Math.sin(k * Math.PI / 2);
    for (const x of [-7, 0, 7]) W.jet(x * c + (A + 5) * s, 0.6, -x * s + (A + 5) * c, 3.2, 0.07);
  });
  if (!far) m.add(W.mesh(kit, 'louvre:eau'));
  // ---- massifs Richelieu (-X) et Denon (+X) : aile sur cour, aile extérieure, ailes transversales (cours intérieures) ----
  const len = Z1 - Z0, zc = (Z0 + Z1) / 2;
  for (const sx of [-1, 1]) {
    const xi = sx * 68, xo = sx > 0 ? 134 : -127;
    // passage piéton (côté Rivoli : passage Richelieu ; côté Seine : porte des Lions suggérée)
    const gates = [{ x: -(30 - zc) * 1, w: 9, h: 9 }];
    wing(m, xi, zc, Math.PI / 2, { ...WING, len, gates }); wing(m, xo, zc, Math.PI / 2, { ...WING, len, dep: 18, gates });
    for (const z of [Z0 + 9, -20, Z1 - 9]) wing(m, (xi + xo) / 2, z, 0, { ...WING, len: Math.abs(xo - xi) - 19, dep: 16, pil: false, chimneys: false });
    pavilion(B, xi, -20, Math.PI / 2, { w: 30, h: 31 }); m.collide.box(xi, -20, 12.8, 15.2);                 // Richelieu / Denon
    for (const z of [Z0 + 4, Z1]) { pavilion(B, xi, z, Math.PI / 2); m.collide.box(xi, z, 12.8, 13.8); }     // Colbert, Turgot / Daru, Mollien
  }
  return { height: 44 };
}

export function buildCourCarree(m) {
  const { B } = m, S = 164, h = S / 2, G = [{ x: 0, w: 10, h: 10 }];
  court(m, 0, 0, S, S, { ...WING, gatesN: G, gatesS: G, gatesE: G, gatesW: G });
  // pavillons d'angle et pavillon de l'Horloge (Sully, côté pyramide = +Z) en deux moitiés de part et d'autre du porche
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { pavilion(B, sx * (h - 11), sz * (h - 11), 0, { w: 24, d: 24, h: 28 }); m.collide.box(sx * (h - 11), sz * (h - 11), 12.4, 12.4); }
  for (const sx of [-1, 1]) { B.box(P.stone, 9, 32, 22, sx * 10.5, 0, h - 10); m.collide.box(sx * 10.5, h - 10, 4.6, 11.2); }
  B.box(P.stone, 12, 20, 22, 0, 12, h - 10); B.box(P.stoneL, 31.5, 1, 23.4, 0, 32, h - 10);
  B.frustum(P.slate, 30, 22, 16, 10, 11, 0, 33, h - 10); B.frustum(P.slate, 16, 10, 9, 5, 3, 0, 44, h - 10); B.box(P.lead, 9.4, 0.8, 5.4, 0, 47, h - 10);
  for (const s of [1, -1]) B.group(0, 0, h - 10 + s * 11.02, s > 0 ? 0 : Math.PI, () => { B.win(0, 14, 0, 4, 7, { arch: true, lit: 0.9, farMin: 0 }); B.win(0, 25, 0, 2.6, 2.6, { mat: P.gold, farMin: 0 }); for (const x of [-9, 9]) { B.win(x, 13, 0, 2.2, 6); B.win(x, 23, 0, 2, 4); } });
  // colonnade de Perrault (façade est = -Z) : colonnes jumelées à l'étage, fronton central
  B.group(0, 0, -h, Math.PI, () => {
    B.box(P.stone, 30, 27, 3, 0, 0, 0.5); B.gable(P.deco, P.zinc, 30, 5, 3.4, 0, 27, 0.5);
    for (let i = 0; i < 14; i++) for (const sx of [-1, 1]) { const x = sx * (19 + i * 4.3); if (x * sx > 70) continue; B.column(x - 0.75, 9.2, 1.1, 0.62, 13.6, 'cor'); B.column(x + 0.75, 9.2, 1.1, 0.62, 13.6, 'cor'); }
    for (const x of [-12, -7.5, 7.5, 12]) B.column(x, 9.2, 2.6, 0.62, 13.6, 'cor');
    B.box(P.stoneL, S, 1.2, 3, 0, 22.8, 0.9); B.box(P.stoneL, S, 0.9, 2.6, 0, 8.4, 0.9);
  });
  return { height: 48 };
}

export function buildCarrousel(m) {
  const { B } = m, S = P.stone, ZO = -229;     // décalage : coordonnées du Louvre -> locales (origine = arc du Carrousel)
  // ---- arc de triomphe du Carrousel (23 × 19 × 7,3 m) ----
  const arches = [{ x: 0, w: 4.6, h: 9 }, { x: -6.9, w: 2.9, h: 6.4 }, { x: 6.9, w: 2.9, h: 6.4 }];
  B.extrude(S, arcadeShape(-11.5, 11.5, 12.2, arches), 7.3, 0, 0, -3.65);
  B.box(P.stoneL, 24, 0.9, 8.4, 0, 12.2, 0); B.box(P.deco, 23.2, 1.2, 7.6, 0, 13.1, 0); B.box(P.stoneL, 24.6, 0.7, 9, 0, 14.3, 0);
  B.box(S, 21.5, 3.6, 6.4, 0, 15, 0); B.box(P.stoneL, 22.2, 0.5, 7, 0, 18.6, 0);
  B.box(P.stoneD, 7, 1, 4.4, 0, 19.1, 0); B.lump(P.verdigris, 0, 20.1, 0, 6.2, 3.8, 3.4, 6, 3);                      // quadrige
  for (const sx of [-1, 1]) B.statue(P.gold, sx * 4.6, 20.1, 0, 3.4);
  for (const sz of [-1, 1]) for (const x of [-10.2, -3.5, 3.5, 10.2]) {
    B.box(P.stoneL, 1.7, 2.2, 1.7, x, 0, sz * 4.4); B.column(x, 2.2, sz * 4.4, 0.42, 9.6, 'cor', { ...P.granite, t: 0.1 });
    B.box(P.stoneL, 1.7, 2.9, 1.9, x, 11.8, sz * 4.3); B.statue(P.stoneL, x, 14.7, sz * 4.4, 3, sz > 0 ? 0 : Math.PI);
    if (B.hi) B.box(P.granite, 2.6, 1.6, 0.2, x * 0.66, 15.9, sz * 3.25, 0, { jit: 0 });
  }
  for (const x of [-10.2, -4.6, 4.6, 10.2]) m.collide.box(x, 0, 1.4, 4.2);
  // ---- ailes ouest : Rivoli (nord, légèrement divergente) et bord de l'eau (sud), guichets du Carrousel ----
  const W2 = { dep: 20, floors: FLOORS, bay: 5.6, roof: 'mansard', roofH: 6.5, roofMat: P.slate, pil: true };
  const seg = (x0, z0, x1, z1, gt) => { const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz); wing(m, (x0 + x1) / 2, (z0 + z1) / 2 + ZO, Math.atan2(-dz, dx), { ...W2, len, gates: gt.map((t) => ({ x: (t - 0.5) * len, w: 14, h: 9.5 })) }); };
  seg(-127, 85, -172, 320, [0.36]); seg(136, 85, 136, 320, [0.36]);
  // pavillons : Rohan / guichets, Marsan (nord-ouest), Flore (sud-ouest)
  pavilion(B, -172, 334 + ZO, Math.PI / 2, { w: 32, d: 26, h: 31 }); m.collide.box(-172, 334 + ZO, 13.4, 16.4);
  pavilion(B, 136, 334 + ZO, Math.PI / 2, { w: 32, d: 26, h: 31 }); m.collide.box(136, 334 + ZO, 13.4, 16.4);
  return { height: 40 };
}

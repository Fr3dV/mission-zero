// Repères urbains : colonne Vendôme, Flamme de la Liberté, statues équestres (Henri IV, Louis XIV, Jeanne d'Arc),
// Moulin Rouge (ailes tournantes, lumineuses la nuit), gares Saint-Lazare et du Nord.
import * as THREE from 'three';
import { P, mat, wing, pavilion, arcadeShape, rng } from '../kit.js';

// statue équestre : cheval + cavalier, longueur ≈ 2,6 s, hauteur ≈ 3 s ; pieds à y, regarde vers +Z
function equestrian(B, mt, x, y, z, s, ry = 0, rear = false) {
  B.group(x, y, z, ry, () => {
    if (B.far) { B.box(mt, s * 0.7, s * 2.6, s * 2.4, 0, 0, 0); return; }
    const o = { jit: 0.04 }, tilt = rear ? -0.5 : 0, by = s * (rear ? 1.55 : 1.25), cy = Math.cos(tilt), sy = Math.sin(tilt);
    const at = (lz, ly) => [by + ly * cy - lz * sy, lz * cy + ly * sy];                                  // point du cheval (repère du corps) -> (y, z)
    B.add(new THREE.SphereGeometry(s * 0.46, 10, 8).scale(0.8, 0.86, 2.0).rotateX(tilt), mt, 0, by, 0, 0, o);                                  // corps
    { const [y, z] = at(s * 0.95, s * 0.5); B.add(new THREE.CylinderGeometry(s * 0.17, s * 0.3, s * 0.95, 8).rotateX(0.7 + tilt), mt, 0, y, z, 0, o); }   // encolure
    { const [y, z] = at(s * 1.42, s * 0.92); B.add(new THREE.BoxGeometry(s * 0.24, s * 0.28, s * 0.66).rotateX(0.75 + tilt), mt, 0, y, z, 0, o); }        // tête
    for (const sx of [-1, 1]) {
      { const [y, z] = at(s * 0.7, -s * 0.6); B.add(new THREE.CylinderGeometry(s * 0.13, s * 0.08, s * 0.95, 6).rotateX(rear ? -1.1 : 0.1 * sx), mt, sx * s * 0.2, rear ? y + s * 0.25 : s * 0.47, rear ? z + s * 0.3 : s * 0.72 + sx * s * 0.05, 0, o); }
      B.add(new THREE.CylinderGeometry(s * 0.15, s * 0.08, s * 0.98, 6).rotateX(rear ? 0.3 : -0.08 * sx), mt, sx * s * 0.22, s * 0.49, -s * 0.66, 0, o);
    }
    B.add(new THREE.CylinderGeometry(s * 0.03, s * 0.1, s * 0.85, 5).rotateX(-0.6), mt, 0, by - s * 0.2 + (rear ? -s * 0.35 : 0), -s * 1.12, 0, o);        // queue
    { const [y, z] = at(-s * 0.05, s * 0.25); B.statue(mt, 0, y - s * 0.12, z, s * 1.55); }
  });
}

// ---------- Colonne Vendôme (44 m) ----------
function buildVendome(m) {
  const { B } = m, br = mat(0x2f4a3f, 0.45, 0.6, 0, 0.9), brL = mat(0x47695a, 0.45, 0.6, 0, 0.9);
  B.box(P.stoneL, 8.6, 0.5, 8.6, 0, 0, 0); B.box(P.granite, 6.4, 1.2, 6.4, 0, 0.5, 0); B.box(br, 5.4, 5.2, 5.4, 0, 1.7, 0); B.box(brL, 5.9, 0.6, 5.9, 0, 6.9, 0);
  if (B.hi) { for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.lump(brL, sx * 2.5, 7.5, sz * 2.5, 0.9, 1.6, 0.9, 1, 3); for (let k = 0; k < 4; k++) B.group(0, 0, 0, k * Math.PI / 2, () => B.lump(brL, 0, 2.2, 2.75, 4, 3.6, 0.3, 6, k + 1)); }
  B.cyl(br, 1.85, 2.3, 1.2, 0, 7.5, 0, 20); B.cyl(br, 1.62, 1.85, 28.5, 0, 8.7, 0, 24);
  // frise en spirale (bas-reliefs de la Grande Armée)
  const n = B.far ? 0 : 22 * 16, pts = [];
  for (let i = 0; i < n; i++) { const t = i / n, a = t * 22 * Math.PI * 2, r = 1.86 - 0.23 * t + 0.03; pts.push([Math.sin(a) * r, 9 + t * 28, Math.cos(a) * r, a]); }
  for (let i = 0; i < n; i += 2) B.box(brL, 0.5, 0.75, 0.1, pts[i][0], pts[i][1], pts[i][2], pts[i][3], { jit: 0.25 });
  B.cyl(brL, 2.3, 1.7, 1.4, 0, 37.2, 0, 16); B.box(br, 4.4, 0.4, 4.4, 0, 38.6, 0);
  if (B.hi) for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; B.cyl(br, 0.05, 0.05, 1.1, Math.sin(a) * 2, 39, Math.cos(a) * 2, 4); }
  B.cyl(br, 1.1, 1.3, 2.2, 0, 39, 0, 12); B.dome(br, 1.15, 0.9, 0, 41.2, 0, 12); B.statue(br, 0, 42, 0, 3.8);                                      // Napoléon en César
  m.collide.box(0, 0, 3.6, 3.6);
  return { height: 46 };
}

// ---------- Flamme de la Liberté (place de l'Alma) ----------
function buildFlamme(m) {
  const { B } = m, gold = { ...P.gold, g: 2 }, marble = mat(0x3a3a3c, 0.3, 0.1, 0.2, 0.3);
  B.box(mat(0x77777a, 0.5, 0, 0.3, 0.2), 4.6, 0.5, 4.6, 0, 0, 0); B.box(marble, 3.2, 2.4, 3.2, 0, 0.5, 0); B.box(mat(0x77777a, 0.5, 0, 0.3, 0.2), 3.6, 0.3, 3.6, 0, 2.9, 0);
  B.cyl({ ...P.gold, g: 1.4 }, 0.9, 0.5, 0.5, 0, 3.2, 0, 12);
  const r = rng(9);
  for (let i = 0; i < (B.far ? 1 : 9); i++) { const a = i * 2.4, d = i ? 0.25 + r() * 0.3 : 0, h = i ? 1.6 + r() * 1.2 : 3.3; B.lathe(gold, [[0.02, 0], [0.32 - d * 0.2, h * 0.12], [0.5 - d * 0.5, h * 0.35], [0.3 - d * 0.3, h * 0.7], [0.02, h]], Math.sin(a) * d, 3.7, Math.cos(a) * d, 8); }
  m.collide.circle(0, 0, 2.4);
  return { height: 8 };
}

// ---------- statues équestres ----------
function buildHenri4(m) {
  const { B } = m; B.box(P.stoneL, 9, 0.5, 5.4, 0, 0, 0); B.box(P.stone, 7, 5, 3.6, 0, 0.5, 0); B.box(P.stoneL, 7.6, 0.5, 4.2, 0, 5.5, 0);
  if (B.hi) for (const sx of [-1, 1]) B.box(P.verdigris, 0.12, 2.6, 2.6, sx * 3.56, 1.8, 0, 0, { jit: 0 });
  B.group(0, 0, 0, Math.PI / 2, () => equestrian(B, P.verdigris, 0, 6, 0, 2.1)); m.collide.box(0, 0, 4.6, 2.8);
  return { height: 13 };
}
function buildVictoires(m) {
  const { B } = m; B.cyl(P.stoneL, 5.4, 5.6, 0.5, 0, 0, 0, 24); B.box(P.stone, 4.2, 6, 6.4, 0, 0.5, 0); B.box(P.stoneL, 4.8, 0.5, 7, 0, 6.5, 0);
  if (B.hi) for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; B.cyl(P.ironD, 0.06, 0.06, 1.3, Math.sin(a) * 5.2, 0.5, Math.cos(a) * 5.2, 4); }
  equestrian(B, P.verdigris, 0, 7, -0.6, 2.2, 0, true); m.collide.circle(0, 0, 5.5);                                            // Louis XIV, cheval cabré
  return { height: 15 };
}
function buildJeanneDArc(m) {
  const { B } = m; B.box(P.stoneL, 3.6, 0.4, 5.6, 0, 0, 0); B.box(P.stone, 2.6, 3.6, 4.6, 0, 0.4, 0); B.box(P.stoneL, 3, 0.4, 5, 0, 4, 0);
  equestrian(B, P.gold, 0, 4.4, 0, 1.55); B.cyl(P.gold, 0.03, 0.03, 4.4, 0.6, 6.6, 0.3, 4); B.box(P.gold, 0.04, 1.1, 1.5, 0.6, 9.9, -0.55, 0, { jit: 0 });   // étendard
  // pas de collision : dans les données, la place des Pyramides est une chaussée continue (l'îlot réel n'y figure pas)
  return { height: 12 };
}

// ---------- Moulin Rouge ----------
function buildMoulinRouge(m) {
  const { B, kit, far } = m, red = mat(0xb5121b, 0.5, 0.1, 0, 1.5), redD = mat(0x7d0f15, 0.6, 0, 0, 0.9), lamp = mat(0xfff0b8, 0.4, 0, 0, 2);
  B.box(redD, 26, 9, 14, 0, 0, 0); B.box(mat(0x2a2326, 0.8, 0, 0, 0.3), 26, 5, 14, 0, 9, 0); B.box(red, 26.6, 0.7, 14.6, 0, 8.6, 0, 0, { jit: 0 });
  B.box(red, 18, 3.4, 0.5, 2, 9.8, 7.2, 0, { jit: 0 }); B.box(lamp, 15, 1.5, 0.2, 2, 10.75, 7.5, 0, { jit: 0 });                               // enseigne « MOULIN ROUGE »
  B.box(P.shadow, 8, 4.4, 0.3, 2, 0, 7.05, 0, { jit: 0 }); B.box(lamp, 9, 0.5, 1.6, 2, 4.6, 7.9, 0, { jit: 0 });
  if (B.hi) for (let i = 0; i < 26; i++) B.sphere(lamp, 0.16, -12.5 + i, 8.3, 7.4, 5);
  // le moulin : fût conique, calotte, quatre ailes en treillis
  const MX = -8, MY = 9, MZ = 2;
  B.cyl(red, 2.5, 3.6, 8.5, MX, MY, MZ, 16); B.cyl(redD, 3, 2.7, 0.6, MX, MY + 8.5, MZ, 16); B.cyl(red, 0.2, 2.9, 3.4, MX, MY + 9.1, MZ, 16, { open: true });
  if (B.hi) for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; B.sphere(lamp, 0.14, MX + Math.sin(a) * 3.1, MY + 8.8, MZ + Math.cos(a) * 3.1, 5); }
  B.group(MX, 0, MZ + 3.3, 0, () => B.win(0, MY + 2.5, 0, 1.2, 2, { arch: true, lit: 1, frame: false }));
  const geo = [], bar = (w, h, x, y, rot) => { const g = new THREE.BoxGeometry(w, h, 0.12); g.translate(x, y, 0); g.rotateZ(rot); geo.push(g); };
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; bar(0.22, 9.4, 0, 4.7, a); bar(0.14, 7, 1.5, 5.6, a); bar(0.14, 7, 0.75, 5.6, a); for (let j = 0; j < 8; j++) bar(1.6, 0.12, 0.8, 2.3 + j * 0.95, a); }
  const pos = [], idx = []; let base = 0;
  for (const g of geo) { pos.push(...g.attributes.position.array); for (const i of g.index.array) idx.push(i + base); base += g.attributes.position.count; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setIndex(idx); sg.computeVertexNormals();
  const sm = moulinMat(kit), sails = new THREE.Mesh(sg, sm); sails.position.set(MX, MY + 7, MZ + 3.4); sails.name = 'moulinrouge:ailes'; sails.castShadow = !far; m.add(sails);
  m.onUpdate((dt, st, visible) => { sm.emissiveIntensity = 0.15 + st.night * 2.2; if (visible) sails.rotation.z = -st.time * 0.35; });
  m.collide.box(0, 0, 13.3, 7.3);
  return { height: 24 };
}
function moulinMat(kit) { return kit._moulin || (kit._moulin = new THREE.MeshStandardMaterial({ color: 0xc0141d, roughness: 0.5, emissive: 0xff2a20, emissiveIntensity: 0.15, side: THREE.DoubleSide })); }

// ---------- gares : bâtiment de façade + halles métalliques ----------
function sheds(m, x0, x1, z0, z1, n, h, rise) {
  const { B } = m, w = (x1 - x0) / n, L = z0 - z1, zc = (z0 + z1) / 2, glass = mat(0x9db6c0, 0.12, 0.4, 0, 2);
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * w;
    B.gable(P.steel, P.zinc, w, rise, L, x, h, zc); B.box(glass, w * 0.34, 0.12, L - 4, x - w * 0.2, h + rise * 0.6 + 0.1, zc, 0, { jit: 0 });
    if (B.hi) { B.tris(glass, [x + w * 0.04, h + rise * 0.93, z0 - 2, x + w * 0.37, h + rise * 0.27, z0 - 2, x + w * 0.37, h + rise * 0.27, z1 + 2, x + w * 0.04, h + rise * 0.93, z0 - 2, x + w * 0.37, h + rise * 0.27, z1 + 2, x + w * 0.04, h + rise * 0.93, z1 + 2], 0, 0.05, 0, 0, { up: true, jit: 0 }); }
    for (const xx of i ? [x - w / 2] : [x - w / 2]) for (let k = 0; k <= (B.far ? 2 : 6); k++) B.cyl(P.steel, 0.3, 0.35, h, xx, 0, z0 - k * L / (B.far ? 2 : 6), 6);
  }
  B.box(P.stoneD, x1 - x0, h, 1, (x0 + x1) / 2, 0, z1); B.box(P.stoneD, 1, h, L, x0, 0, zc); B.box(P.stoneD, 1, h, L, x1, 0, zc);
  m.collide.box((x0 + x1) / 2, zc, (x1 - x0) / 2 + 0.6, L / 2 + 0.6);
}
function buildSaintLazare(m) {
  const { B } = m, ZF = 48, F = [{ h: 7.5, arch: true, w: 3.2, wh: 5.6, sill: 0.4, lit: 0.7 }, { h: 6, w: 2.2, wh: 4 }, { h: 5, w: 2, wh: 3 }];
  wing(m, 0, ZF - 10, 0, { len: 176, dep: 20, floors: F, bay: 5.2, roof: 'mansard', roofH: 6.5, roofMat: P.slate, pil: true });
  for (const x of [-80, 0, 80]) { pavilion(B, x, ZF - 10, 0, { w: x ? 22 : 30, d: 24, h: x ? 22 : 24, roofH: 9 }); m.collide.box(x, ZF - 10, x ? 11.6 : 15.6, 12.6); }
  B.group(0, 0, ZF + 2.02, 0, () => { B.add(new THREE.CircleGeometry(2.2, 18), { ...P.stoneW, t: 0, g: 2 }, 0, 21, 0.9, 0, { jit: 0 }); B.add(new THREE.RingGeometry(2.1, 2.5, 18), P.ironD, 0, 21, 0.92, 0, { jit: 0 }); });
  sheds(m, -86, 86, ZF - 20, -92, 6, 13, 9);
  // cour de Rome / cour du Havre : les deux sculptures d'Arman (horloges et valises empilées)
  for (const [x, c] of [[-52, P.bronze], [52, P.bronze]]) { for (let i = 0; i < (B.far ? 1 : 10); i++) B.cyl(c, 0.55, 0.55, 0.5, x + ((i * 7) % 5 - 2) * 0.12, i * 0.5, ZF + 16, 8); if (B.far) B.cyl(c, 0.6, 0.6, 5, x, 0, ZF + 16, 6); m.collide.circle(x, ZF + 16, 0.9, -10, 6); }
  return { height: 34 };
}
function buildGareDuNord(m) {
  const { B } = m, S = P.stone, ZF = 58;
  // pavillon central : grande verrière en plein cintre, pilastres ioniques jumelés, statues des villes
  B.group(0, 0, ZF - 6, 0, () => {
    B.extrude(S, arcadeShape(-35, 35, 33, [{ x: 0, w: 30, h: 29 }]), 12, 0, 0, -6);
    B.box(mat(0x31424d, 0.12, 0.35, 0, 2), 29.6, 14, 0.3, 0, 0, 0, 0, { jit: 0 }); B.add(new THREE.CircleGeometry(14.8, 28, 0, Math.PI), mat(0x31424d, 0.12, 0.35, 0, 2), 0, 14, 0.15, 0, { jit: 0 });
    if (B.hi) { for (let i = 1; i < 8; i++) B.box(P.steel, 0.3, 27, 0.3, -15 + i * 3.75, 0, 0.3, 0, { jit: 0 }); for (const y of [7, 14, 20]) B.box(P.steel, 29, 0.3, 0.3, 0, y, 0.3, 0, { jit: 0 }); }
    B.box(P.stoneL, 72, 1.4, 13, 0, 33, 0); B.gable(S, P.zinc, 44, 7, 12, 0, 34.4, 0); B.box(P.stoneL, 72, 0.6, 13, 0, 9.6, 0.2);
    for (const x of [-32, -28.5, -20.5, -17, 17, 20.5, 28.5, 32]) B.column(x, 0.5, 6.6, 0.9, 31, 'ion');
    for (const x of [-30.2, -18.7, 18.7, 30.2]) { B.box(S, 5.4, 2.2, 2.4, x, 34.4, 5.4); B.statue(P.deco, x, 36.6, 5.4, 4.6); }
    for (const [x, y] of [[0, 41.4], [-9, 39.9], [9, 39.9], [-18, 37.2], [18, 37.2]]) { B.box(S, 2.2, 1.6, 2.2, x, y, 4.6); B.statue(P.deco, x, y + 1.6, 4.6, x ? 4.4 : 5.4); }   // Paris et les capitales
    B.add(new THREE.CircleGeometry(1.8, 16), { ...P.stoneW, t: 0, g: 2 }, 0, 30.8, 6.06, 0, { jit: 0 });
  });
  m.collide.box(0, ZF - 6, 35.4, 6.4);
  // pavillons latéraux à arcades et ailes
  for (const sx of [-1, 1]) {
    B.group(sx * 62, 0, ZF - 6, 0, () => { B.extrude(S, arcadeShape(-27, 27, 22, [-18, -6, 6, 18].map((x) => ({ x, w: 8.4, h: 16 }))), 11, 0, 0, -5.5); B.box(P.stoneL, 55, 1.2, 12, 0, 22, 0); B.box(S, 54, 2.4, 10, 0, 23.2, 0);
      for (const x of [-18, -6, 6, 18]) { B.group(x, 0, 0, 0, () => B.win(0, 0.2, 0, 8.2, 11.6, { arch: true, mat: mat(0x31424d, 0.12, 0.35, 0, 2), frame: false, farMin: 0 })); }
      for (const x of [-24, -12, 0, 12, 24]) { B.column(x, 0.5, 6.1, 0.7, 20.5, 'ion'); if (B.hi) B.statue(P.deco, x, 25.6, 4.6, 3.4); } });
    m.collide.box(sx * 62, ZF - 6, 27.4, 6);
    pavilion(B, sx * 96, ZF - 11, 0, { w: 14, d: 20, h: 22, roofH: 8, roofMat: P.zinc }); m.collide.box(sx * 96, ZF - 11, 7.6, 10.6);
  }
  sheds(m, -36, 36, ZF - 12, -80, 1, 26, 12); sheds(m, -96, -36, ZF - 12, -80, 2, 16, 7); sheds(m, 36, 96, ZF - 12, -80, 2, 16, 7);
  return { height: 48 };
}

export const DEFS = { vendome: buildVendome, flamme: buildFlamme, henri4: buildHenri4, victoires: buildVictoires, jeannedarc: buildJeanneDArc, moulinrouge: buildMoulinRouge, saintlazare: buildSaintLazare, garedunord: buildGareDuNord };

// Églises et édifices médiévaux : Conciergerie / Palais de Justice / Sainte-Chapelle, Saint-Sulpice, Saint-Eustache,
// tour Saint-Jacques, Saint-Germain-des-Prés.
import * as THREE from 'three';
import { P, wing, stairs, ogiveShape, rose, ovoid } from '../kit.js';

const F3 = [{ h: 7, arch: true, w: 2.6, wh: 4.6, sill: 1 }, { h: 6.5, w: 2.1, wh: 4.2 }, { h: 5.5, w: 1.9, wh: 3 }];
// vaisseau d'église le long de -Z (façade en z0, chevet rond en z1) : nef haute, bas-côtés, toits, baies, arcs-boutants simples
function nave(B, o) {
  const { z0, z1, w, h, aw, ah, S = P.stoneG, RF = P.slate, rh = 9 } = o, L = z0 - z1, zc = (z0 + z1) / 2;
  B.box(S, w, h + 3, L, 0, -3, zc); B.gable(S, RF, w + 1, rh, L + 0.4, 0, h, zc);
  B.box(S, aw, ah + 3, L, 0, -3, zc);
  for (const sx of [-1, 1]) B.tris(RF, [sx * w / 2, ah + 3.5, z0, sx * (aw / 2 + 0.4), ah, z0, sx * (aw / 2 + 0.4), ah, z1, sx * w / 2, ah + 3.5, z0, sx * (aw / 2 + 0.4), ah, z1, sx * w / 2, ah + 3.5, z1], 0, 0, 0, 0, { up: true });
  B.cyl(S, aw / 2, aw / 2, ah + 3, 0, -3, z1, 20, { t0: Math.PI / 2, tl: Math.PI }); B.cyl(S, w / 2, w / 2, h + 3, 0, -3, z1, 16, { t0: Math.PI / 2, tl: Math.PI });
  B.add(new THREE.CylinderGeometry(w / 2, aw / 2 + 0.4, 3.5, B.n(20), 1, true, Math.PI / 2, Math.PI).translate(0, 1.75, 0), RF, 0, ah, z1, 0, { uv: 'cyl', r: aw / 2 });
  B.add(new THREE.CylinderGeometry(0.1, w / 2 + 0.5, rh, B.n(16), 1, true, Math.PI / 2, Math.PI).translate(0, rh / 2, 0), RF, 0, h, z1, 0, { uv: 'cyl', r: w / 2 });
  const bay = o.bay || 6.5, n = Math.max(1, Math.floor(L / bay));
  for (const sx of [-1, 1]) B.group(0, 0, zc, sx * Math.PI / 2, () => {
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + (i + 0.5) * L / n;
      B.win(x, ah + 5, w / 2, bay * 0.36, h - ah - 7.5, { arch: true, mat: P.vitrail, frame: false, farMin: 0 }); B.win(x, 2.5, aw / 2, bay * 0.36, ah - 5, { arch: true, mat: P.vitrail, frame: false });
      if (o.fly !== false) { B.box(S, 1.1, ah + 6, 2.6, x + L / n / 2, -3 + 3, aw / 2 + 0.6); B.frustum(RF, 1.1, 2.6, 0, 0, 2.5, x + L / n / 2, ah + 6, aw / 2 + 0.6);
        if (B.hi) { const s = new THREE.Shape(); const d = (aw - w) / 2; s.moveTo(0, h - 3); s.lineTo(d, ah + 4); s.lineTo(d, ah + 3.2); s.quadraticCurveTo(d * 0.5, ah + 4.5, 0, h - 5.5); s.closePath(); B.extrude(S, s, 0.6, x + L / n / 2 + 0.3, 0, w / 2, -Math.PI / 2); } }
    }
  });
}

// ---------- Conciergerie, Palais de Justice et Sainte-Chapelle (+Z = quai de l'Horloge, +X = ouest) ----------
function buildConciergerie(m) {
  const { B } = m, S = P.stoneG, RF = P.slate, ZQ = 80;
  const W = { dep: 18, floors: F3, bay: 5, roof: 'mansard', roofH: 9, roofMat: RF, wall: S };
  wing(m, 41, ZQ - 9, 0, { ...W, len: 148 });                                // Conciergerie, le long du quai
  wing(m, 106, 0, Math.PI / 2, { ...W, len: 140 }); wing(m, 41, -70, 0, { ...W, len: 148 });
  wing(m, 46, 5, 0, { ...W, len: 102, dep: 16 }); wing(m, -24, 55, Math.PI / 2, { ...W, len: 30 });
  // tours rondes du quai : César et d'Argent (jumelles), Bonbec (crénelée)
  const tower = (x, r, h, cren) => { B.cyl(S, r, r * 1.04, h + 2, x, -2, ZQ + 1, 20); B.cyl(P.stoneL, r + 0.5, r + 0.3, 0.9, x, h, ZQ + 1, 20); if (cren) { B.cyl(S, r + 0.3, r + 0.3, 1.6, x, h + 0.9, ZQ + 1, 20); } B.cyl(RF, 0.1, r + 0.4, r * 2.1, x, h + (cren ? 2.5 : 0.9), ZQ + 1, 20, { open: true }); if (B.hi) for (let j = 0; j < 3; j++) B.group(x, 0, ZQ + 1, 0, () => B.win(0, 6 + j * 6.5, r + 0.02, 0.9, 2.4, { frame: false, mat: P.shadow })); m.collide.circle(x, ZQ + 1, r + 0.3); };
  tower(26, 5.4, 23); tower(42, 5.4, 23); tower(88, 5.2, 21, true);
  // tour de l'Horloge (angle du boulevard du Palais)
  B.group(-38, 0, ZQ - 3, 0, () => {
    B.box(S, 10, 40, 10, 0, -2, 0); B.box(P.stoneL, 11, 0.9, 11, 0, 38, 0); B.box(S, 9, 5, 9, 0, 38.9, 0); B.frustum(RF, 10, 10, 3, 3, 6, 0, 43.9, 0); B.cyl(P.lead, 1.4, 1.5, 2.4, 0, 49.9, 0, 8); B.dome(P.lead, 1.6, 1.8, 0, 52.3, 0, 8);
    for (let k = 0; k < 4; k++) B.group(0, 0, 0, k * Math.PI / 2, () => B.win(0, 40, 4.52, 2, 3, { arch: true, mat: P.shadow, frame: false, farMin: 0 }));
    B.group(-5.02, 0, 0, -Math.PI / 2, () => { B.box(mat0(0x1f3f8a), 4.2, 5.4, 0.3, 0, 9, 0, 0, { jit: 0 }); B.add(new THREE.CircleGeometry(1.5, 16), P.gold, 0, 11.6, 0.2, 0, { jit: 0 }); B.gable(P.gold, RF, 5, 1.6, 0.8, 0, 14.4, 0.2); });
  });
  m.collide.box(-38, ZQ - 3, 5.3, 5.3);
  // cour du Mai (entrée sur le boulevard, côté est = -X) : façade à colonnes et dôme carré, grand escalier
  B.group(-16, 0, 18, -Math.PI / 2, () => {
    B.box(S, 40, 24, 16, 0, -2, 0); B.box(P.stoneL, 41, 1, 17, 0, 22, 0); for (const x of [-4.5, -1.5, 1.5, 4.5]) B.column(x, 4, 8.8, 0.7, 14, 'cor');
    B.box(P.stoneL, 13, 1.4, 3, 0, 18, 9); B.box(S, 12, 4, 3, 0, 19.4, 9); B.frustum(RF, 18, 14, 8, 6, 8, 0, 23, 0); stairs(B, P.stoneL, 14, 19, 0.21, 0.4, 0, 0, 9.5);
    B.winRow(-18, -8, 5, 8.02, 2, 2.4, 6, { arch: true }); B.winRow(8, 18, 5, 8.02, 2, 2.4, 6, { arch: true }); B.win(0, 4, 8.02, 3, 7, { arch: true, mat: P.shadow, farMin: 0 });
  });
  m.collide.box(-16, 18, 8.3, 20.3); m.collide.box(-28, 18, 4, 7.2);
  // ---- Sainte-Chapelle : chapelle haute aux verrières de 15 m, flèche à 75 m (axe est-ouest = X local, chevet à l'est = -X) ----
  B.group(18, 0, -30, Math.PI / 2, () => {      // dans ce groupe : +Z = ouest (façade), -Z = chevet
    const L = 36, w = 11, h = 31;
    B.box(P.stoneL, w, h + 2, L - 5, 0, -2, 2.5); B.cyl(P.stoneL, w / 2, w / 2, h + 2, 0, -2, -L / 2 + 5, 14, { t0: Math.PI / 2, tl: Math.PI });
    B.gable(P.stoneL, RF, w + 0.8, 10.5, L - 5, 0, h, 2.5); B.add(new THREE.CylinderGeometry(0.1, w / 2 + 0.4, 10.5, 14, 1, true, Math.PI / 2, Math.PI).translate(0, 5.25, 0), RF, 0, h, -L / 2 + 5, 0, { uv: 'cyl', r: 5 });
    B.box(P.gold, 0.2, 0.9, L - 5, 0, h + 10.5, 2.5, 0, { jit: 0 });
    for (const sx of [-1, 1]) B.group(0, 0, 2.5, sx * Math.PI / 2, () => { for (let i = 0; i < 4; i++) { const x = -11.6 + i * 7.75; B.win(x, 11.5, w / 2, 4.6, 14.5, { arch: true, mat: P.vitrail, frame: false, farMin: 0 }); B.win(x, 2.5, w / 2, 3.4, 4.4, { arch: true, mat: P.vitrail, frame: false }); } for (let i = 0; i <= 4; i++) { const x = -15.5 + i * 7.75; B.box(P.stoneL, 1.3, h + 1, 2.2, x, 0, w / 2 + 0.9); B.frustum(RF, 1.3, 2.2, 0, 0, 5, x, h + 1, w / 2 + 0.9); B.box(P.gold, 0.12, 1.2, 0.12, x, h + 6, w / 2 + 0.9, 0, { jit: 0 }); } });
    for (let i = 0; i < 5; i++) B.group(0, 0, -L / 2 + 5, Math.PI / 2 + (i + 0.5) * Math.PI / 5, () => { B.win(0, 11.5, w / 2 + 0.02, 2.6, 14.5, { arch: true, mat: P.vitrail, frame: false, farMin: 0 }); B.group(0, 0, 0, Math.PI / 10, () => B.box(P.stoneL, 1, h + 1, 1.8, 0, 0, w / 2 + 0.7)); });
    B.group(0, 0, L / 2, 0, () => { rose(B, 0, 22.5, 0.02, 4.4, P.stoneL, 16); B.box(P.stoneL, 12.6, 9, 4, 0, 0, 1.6); B.box(P.stoneL, 12.6, 0.6, 4.6, 0, 9, 1.6); B.extrude(P.shadow, ogiveShape(4.4, 7), 0.2, 0, 0, 3.6); B.extrude(P.shadow, ogiveShape(4.4, 6.4), 0.2, 0, 10.4, 0.06); for (const x of [-6, 6]) { B.cyl(P.stoneL, 1.2, 1.3, 35, x, 0, 0.4, 8); B.cyl(RF, 0.05, 1.5, 9, x, 35, 0.4, 8, { open: true }); } });
    B.cyl(P.lead, 1.5, 1.9, 6, 0, h + 9, 0, 8); B.cyl(P.lead, 0.08, 1.4, 27, 0, h + 15, 0, 8, { open: true }); B.box(P.gold, 0.16, 1.4, 0.16, 0, h + 42, 0);
  });
  m.collide.box(18, -30, 18.4, 7.4);
  return { height: 76 };
}
const mat0 = (hex) => { const c = new THREE.Color(hex); return { c: [c.r, c.g, c.b], r: 0.5, m: 0.1, t: 0, g: 1 }; };

// ---------- Saint-Sulpice : façade à deux ordres superposés, deux tours inégales (73 m au nord, 68 m au sud) ----------
function buildSaintSulpice(m) {
  const { B } = m, S = P.stone, ZF = 56;
  nave(B, { z0: ZF - 14, z1: -36, w: 21, h: 32, aw: 52, ah: 15, S, RF: P.slate, rh: 8, bay: 7.4, fly: false });
  B.cyl(S, 7, 7, 16, 0, -3, -58, 16); B.dome(P.slate, 7.2, 4.5, 0, 13, -58, 16);                       // chapelle de la Vierge
  B.box(S, 56, 35, 15, 0, -3, -8); B.gable(S, P.slate, 16, 8, 56.4, 0, 32, -8, Math.PI / 2);          // transept
  for (const ry of [Math.PI / 2, -Math.PI / 2]) B.group(0, 0, -8, ry, () => { B.win(0, 14, 28.02, 5, 11, { arch: true, mat: P.vitrail, farMin: 0 }); B.win(0, 0.5, 28.02, 3.4, 7, { arch: true, mat: P.shadow, farMin: 0 }); for (const x of [-6.4, 6.4]) { B.column(x, 0.5, 28.6, 0.6, 12, 'dor'); B.column(x, 14, 28.6, 0.55, 11, 'ion'); } });
  // façade : portique dorique, loggia ionique
  B.box(S, 34, 27, 8, 0, -2, ZF - 10); for (const sx of [-1, 1]) B.box(S, 13, 27.6, 13.4, sx * 23, -2, ZF - 7.5); B.box(P.shadow, 34, 10.4, 0.2, 0, 1.4, ZF - 5.9, 0, { jit: 0 }); B.box(P.shadow, 34, 10, 0.2, 0, 14, ZF - 5.9, 0, { jit: 0 });
  B.box(S, 60, 1.4, 14, 0, 0, ZF - 7.5); stairs(B, P.stoneL, 36, 7, 0.2, 0.4, 0, 0, ZF);
  for (let i = 0; i < 8; i++) { const x = -15.4 + i * 4.4; B.column(x, 1.4, ZF - 1.2, 0.72, 10.6, 'dor'); B.column(x, 14, ZF - 1.2, 0.62, 10, 'ion'); if (i > 0 && i < 7) { B.column(x, 1.4, ZF - 4.2, 0.72, 10.6, 'dor'); } }
  B.box(P.stoneL, 36, 2, 7.6, 0, 12, ZF - 3.2); B.box(P.stoneL, 59, 1.6, 14, 0, 24, ZF - 7.5); if (B.hi) for (let i = 0; i < 26; i++) B.box(P.stoneL, 0.3, 1.1, 0.3, -16.2 + i * 1.3, 25.6, ZF - 0.4, 0, { jit: 0 });
  // tours : nord (achevée, -X) et sud (inachevée, +X)
  const twr = (sx, done) => B.group(sx * 23, 0, ZF - 7.5, 0, () => {
    B.box(S, 13, 16, 13.4, 0, 25.6, 0); B.box(P.stoneL, 14, 1, 14.4, 0, 41.6, 0);
    for (let k = 0; k < 4; k++) B.group(0, 0, 0, k * Math.PI / 2, () => { B.win(0, 29, 6.72, 3.2, 8.5, { arch: true, mat: P.shadow, frame: false, farMin: 0 }); for (const x of [-4.6, 4.6]) B.column(x, 26.4, 7, 0.55, 12.6, done ? 'cor' : 'dor'); B.gable(P.deco, null, 12, 2.4, 0.8, 0, 42.6, 6.4); });
    const r = done ? 5.6 : 5.9, h2 = done ? 22 : 18;
    B.cyl(S, r, r, h2, 0, 44, 0, 20); B.cyl(P.stoneL, r + 0.8, r + 0.6, 1, 0, 44 + h2, 0, 20);
    for (let i = 0; i < 8; i++) B.group(0, 0, 0, i * Math.PI / 4, () => { B.win(0, 46.5, r + 0.02, 1.8, h2 - 7, { arch: true, mat: P.shadow, frame: false, farMin: 0 }); if (done) B.group(0, 0, 0, Math.PI / 8, () => B.column(0, 44.2, r + 0.5, 0.48, h2 - 1.2, 'cor')); });
    if (done) { for (let i = 0; i < 16; i++) B.box(P.stoneL, 0.28, 1.2, 0.28, Math.sin(i * Math.PI / 8) * (r + 0.4), 67, Math.cos(i * Math.PI / 8) * (r + 0.4), 0, { jit: 0 }); B.cyl(S, 2.2, 2.6, 3, 0, 67, 0, 10); B.cyl(P.lead, 0.1, 0.4, 3, 0, 70, 0, 5); }
    else { B.cyl(S, r - 0.6, r - 0.6, 3.4, 0, 63, 0, 20); B.cyl(P.lead, r - 0.4, r - 0.4, 0.5, 0, 66.4, 0, 20); B.cyl(P.lead, 0.1, 0.3, 1.6, 0, 66.9, 0, 5); }
  });
  twr(-1, true); twr(1, false);
  m.collide.box(0, 10, 26.4, 46.4); m.collide.box(0, -8, 28.4, 7.8); m.collide.circle(0, -36, 26.3); m.collide.circle(0, -58, 7.3); m.collide.box(0, ZF + 1.4, 18.4, 1.6);
  return { height: 73 };
}

// ---------- Saint-Eustache : vaisseau gothique très haut, décor Renaissance, façade classique à une seule tour ----------
function buildSaintEustache(m) {
  const { B } = m, S = P.stone, ZF = 44;
  nave(B, { z0: ZF - 10, z1: -34, w: 15, h: 33, aw: 42, ah: 17, S, RF: P.slate, rh: 10, bay: 6.6 });
  B.box(S, 46, 36, 13, 0, -3, 2); B.gable(S, P.slate, 14, 10, 46.4, 0, 33, 2, Math.PI / 2);
  for (const ry of [Math.PI / 2, -Math.PI / 2]) B.group(0, 0, 2, ry, () => { rose(B, 0, 25, 23.02, 4.6, P.stoneL, 12); B.extrude(P.shadow, ogiveShape(4, 8), 0.3, 0, 0, 23.02); B.win(0, 11, 23.02, 5, 6, { arch: true, mat: P.vitrail, frame: false }); for (const x of [-7.5, 7.5]) { B.cyl(S, 1.6, 1.7, 37, x, 0, 23.4, 8); B.cyl(P.slate, 0.1, 1.9, 5, x, 37, 23.4, 8, { open: true }); } });
  B.cyl(P.slate, 1.6, 2.2, 6, 0, 42, 2, 8); B.cyl(P.slate, 0.1, 1.5, 9, 0, 48, 2, 8, { open: true });                  // campanile de croisée
  B.cyl(S, 7, 7, 20, 0, -3, -57, 14); B.cyl(P.slate, 0.1, 7.4, 6, 0, 17, -57, 14, { open: true });                    // chapelle de la Vierge
  // façade occidentale classique : deux ordres, fronton, tour nord seule
  B.box(S, 44, 30, 10, 0, -2, ZF - 5); B.box(P.stoneL, 45, 1.2, 11, 0, 13.4, ZF - 5); B.box(P.stoneL, 45, 1.2, 11, 0, 27, ZF - 5);
  for (const x of [-13, -9.4, -3.6, 3.6, 9.4, 13]) { B.column(x, 0.6, ZF + 0.9, 0.75, 12.6, 'dor'); B.column(x, 14.6, ZF + 0.9, 0.62, 12.2, 'ion'); }
  B.box(P.stoneL, 30, 1.4, 3, 0, 13.3, ZF + 0.6); B.box(P.stoneL, 30, 1.4, 3, 0, 26.8, ZF + 0.6); B.gable(P.deco, P.slate, 20, 4.4, 3, 0, 28.2, ZF + 0.6);
  B.group(0, 0, ZF + 0.02, 0, () => { B.win(0, 0.6, 0, 4, 8.6, { arch: true, mat: P.shadow, farMin: 0 }); B.win(0, 16, 0, 5, 8, { arch: true, mat: P.vitrail, farMin: 0 }); for (const x of [-17.5, 17.5]) { B.win(x, 1, 0, 2.6, 6, { arch: true, mat: P.shadow }); B.win(x, 16, 0, 2.4, 6, { arch: true, mat: P.vitrail }); } });
  B.box(S, 12, 14, 10, -16, 28.2, ZF - 5); B.box(P.stoneL, 13, 1, 11, -16, 42.2, ZF - 5); for (let k = 0; k < 4; k++) B.group(-16, 0, ZF - 5, k * Math.PI / 2, () => { B.win(0, 30.5, k % 2 ? 6.02 : 5.02, 3, 8, { arch: true, mat: P.shadow, frame: false, farMin: 0 }); });
  B.box(S, 12, 4, 10, 16, 28.2, ZF - 5);
  m.collide.box(0, 5, 21.4, 40); m.collide.box(0, 2, 23.6, 7); m.collide.circle(0, -40, 21.5); m.collide.circle(0, -57, 7.3);
  return { height: 58 };
}

// ---------- Tour Saint-Jacques (54 m, gothique flamboyant) ----------
function buildSaintJacques(m) {
  const { B } = m, S = P.stoneW, w = 10.4;
  B.box(P.stoneL, 16, 1.2, 16, 0, 0, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { B.box(S, 3.2, 52, 3.2, sx * (w / 2 - 0.6), 1.2, sz * (w / 2 - 0.6)); B.frustum(P.stoneL, 2.2, 2.2, 0, 0, 5, sx * (w / 2 - 0.6), 53.2, sz * (w / 2 - 0.6)); m.collide.box(sx * (w / 2 - 0.6), sz * (w / 2 - 0.6), 1.8, 1.8); }
  B.box(S, w - 1, 44, w - 1, 0, 9.2, 0); B.box(P.stoneL, w + 1, 0.8, w + 1, 0, 9, 0); B.box(P.stoneL, w + 0.6, 0.6, w + 0.6, 0, 26, 0); B.box(P.stoneL, w + 0.6, 0.6, w + 0.6, 0, 37.5, 0); B.box(P.stoneL, w + 1.2, 1, w + 1.2, 0, 52.4, 0);
  for (let k = 0; k < 4; k++) B.group(0, 0, 0, k * Math.PI / 2, () => {
    B.extrude(P.shadow, ogiveShape(3.6, 7), 0.2, 0, 1.2, w / 2 - 0.62); B.extrude(P.shadow, ogiveShape(3.2, 12), 0.2, 0, 11.5, w / 2 - 0.52);
    for (const x of [-1.6, 1.6]) { B.extrude(P.shadow, ogiveShape(2.2, 9), 0.2, x, 27.4, w / 2 - 0.52); B.extrude(P.shadow, ogiveShape(2.2, 13), 0.2, x, 38.6, w / 2 - 0.52); }
    if (B.hi) { for (let j = 0; j < 6; j++) B.box(S, 5.6, 0.2, 0.25, 0, 40 + j * 1.9, w / 2 - 0.35, 0, { jit: 0 }); for (let i = 0; i < 7; i++) B.box(P.stoneL, 0.3, 1.5, 0.3, -3.6 + i * 1.2, 53.4, w / 2, 0, { jit: 0 }); B.box(P.stoneL, 8, 0.25, 0.3, 0, 54.9, w / 2); for (const x of [-2.4, 2.4]) B.statue(P.stoneL, x, 24, w / 2 - 0.2, 2); }
  });
  B.statue(P.stoneL, -w / 2 + 0.6, 58.2, w / 2 - 0.6, 3.6); B.statue(P.stoneL, 0, 1.2, 0, 2.6);                         // saint Jacques au sommet, Pascal sous la voûte
  return { height: 62 };
}

// ---------- Saint-Germain-des-Prés : clocher-porche roman à flèche d'ardoise ----------
function buildSaintGermain(m) {
  const { B } = m, S = P.stoneG, ZF = 32;
  nave(B, { z0: ZF - 8, z1: -24, w: 9.5, h: 19, aw: 22, ah: 9, S, RF: P.slate, rh: 6, bay: 5.4 });
  B.box(S, 30, 21, 8, 0, -2, -14); B.gable(S, P.slate, 9, 5.5, 30.4, 0, 19, -14, Math.PI / 2);
  B.group(0, 0, ZF - 4, 0, () => {
    B.box(S, 9.6, 36, 9.6, 0, -2, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(S, 1.6, 30, 1.6, sx * 4.6, 0, sz * 4.6);
    B.box(P.stoneL, 10.6, 0.7, 10.6, 0, 22, 0); B.box(P.stoneL, 10.6, 0.7, 10.6, 0, 34, 0);
    for (let k = 0; k < 4; k++) B.group(0, 0, 0, k * Math.PI / 2, () => { for (const x of [-1.7, 1.7]) B.win(x, 25, 4.82, 1.8, 5.4, { arch: true, mat: P.shadow, frame: false, farMin: 0 }); if (B.hi) B.win(0, 12, 4.82, 1.4, 3.4, { arch: true, mat: P.shadow, frame: false }); });
    B.add(new THREE.CylinderGeometry(0.15, 6.9, 19, 8, 1, true).rotateY(Math.PI / 8).translate(0, 9.5, 0), P.slate, 0, 34.7, 0, 0, { uv: 'cyl', r: 6 }); B.box(P.gold, 0.14, 1.6, 0.14, 0, 53.5, 0);
    B.extrude(P.shadow, ogiveShape(3.4, 5.6), 0.2, 0, 0, 4.82); B.box(S, 12, 9, 5, 0, 0, 5); B.gable(S, P.slate, 12.6, 3, 5.4, 0, 9, 5); B.extrude(P.shadow, ogiveShape(3.4, 5.6), 0.2, 0, 0, 7.42);
  });
  m.collide.box(0, 2, 11.4, 30.6); m.collide.box(0, -14, 15.4, 4.4); m.collide.circle(0, -26, 11.3); m.collide.box(0, ZF + 1, 6.3, 2.8);
  return { height: 55 };
}

export const DEFS = { conciergerie: buildConciergerie, saintsulpice: buildSaintSulpice, sainteustache: buildSaintEustache, saintjacques: buildSaintJacques, saintgermain: buildSaintGermain };

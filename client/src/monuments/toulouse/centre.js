// Compléments du centre : hôtel d'Assézat, palais de justice, place Wilson (fontaine de Goudouli), fontaine de la Trinité,
// statue de Jeanne d'Arc, monument aux morts, Grand Rond (bassin, kiosque), jardin japonais.
import * as THREE from 'three';
import { P, Water, arcadeShape } from '../kit.js';
import { bwing, bcourt, brick, FL, octTower, equestrian } from './tk.js';

const mk = (hex, r = 0.6, mt = 0, g = 0.6, t = 0) => { const c = new THREE.Color(hex); return { c: [c.r, c.g, c.b], r, m: mt, t, g }; };
const BR = P.brick, ST = P.pierre, TL = P.tile;

// bassin rond à margelle de pierre
function basin(B, x, z, r, y = 0) { B.lathe(ST, [[r + 0.5, 0], [r + 0.5, 0.75], [r + 0.2, 0.85], [r, 0.75], [r, 0.3], [0.1, 0.3]], x, y, z, 32); B.cyl(P.water, r, r, 0.1, x, y + 0.5, z, 32, { jit: 0 }); }

// ---------- Hôtel d'Assézat : hôtel Renaissance, cour à ordres superposés, tour d'escalier ----------
function buildAssezat(m) {
  const { B } = m;
  const F = [{ h: 5.4, arch: true, w: 2.2, wh: 3.6, sill: 0.5 }, { h: 5.2, arch: true, w: 2, wh: 3.4, sill: 0.8, lit: 0.6 }, { h: 4.6, arch: true, w: 1.8, wh: 2.8, sill: 0.8 }];
  bcourt(m, 0, 4, 38, 38, { dep: 9, floors: F, bay: 4.2, pil: true, roofH: 2.6, gatesS: [{ x: 0, w: 4.4, h: 5 }] });
  // tour d'escalier d'angle, lanterne et dôme
  B.box(BR, 6.4, 26 + 3, 6.4, -7, -3, -7); B.box(ST, 7, 0.5, 7, -7, 25.6, -7, 0, { jit: 0 });
  const top = octTower(B, -7, 26, -7, [{ r: 3, h: 4.2, arch: 'round', n: 1 }]); B.dome(P.ardoise, 3.1, 2.8, -7, top, -7, 8); B.cyl(P.gold, 0.04, 0.14, 1.8, -7, top + 2.8, -7, 4);
  B.group(0, 0, 23.02, 0, () => { B.box(ST, 8, 9, 0.6, 0, 5.2, 0.2); if (B.hi) for (const x of [-3, 3]) B.column(x, 0.3, 0.7, 0.36, 5, 'cor', ST); });
  B.box(P.pave, 20, 0.2, 20, 0, -0.1, 4, 0, { jit: 0 });
  return { height: 34 };
}

// ---------- Palais de justice (place du Salin) : ancien parlement de brique sur cour, ailes est, nouveau palais vitré au sud ----------
// Repère : +Z = sud, +X = est ; la place du Parlement longe l'ensemble à l'ouest.
function buildPalaisJustice(m) {
  const { B } = m, F = [FL.rdc, FL.noble, FL.etage];
  bcourt(m, -32, -11.5, 34, 39, { dep: 10, floors: F, bay: 4.3, pil: true });
  bcourt(m, 10.5, -10, 51, 40, { dep: 12, floors: F, bay: 4.4, pil: true, gatesN: [{ x: 0, w: 5, h: 5 }] });
  bwing(m, 59, -4.5, 0, { len: 42, dep: 24, floors: F, bay: 4.4, pil: true });
  B.group(-32, 0, -31.02, Math.PI, () => {                                              // portique sur la place du Salin
    B.box(ST, 18, 14, 2.2, 0, 0, 1); B.gable(ST, TL, 18.6, 3.2, 2.6, 0, 14, 1); for (const x of [-6.4, -2.2, 2.2, 6.4]) B.column(x, 0.4, 2.5, 0.58, 11, 'ion', ST);
    B.win(0, 0.4, 2.12, 3, 6, { arch: true, mat: P.bois, frame: false, farMin: 0 });
  });
  // nouveau palais (2008) : grande halle vitrée et tour ronde de brique des archives
  B.box(P.verre, 58, 17, 44, -6, 0, 38, 0, { jit: 0 }); B.box(mk(0x3b3f45, 0.6, 0.3), 59, 0.8, 45, -6, 17, 38); B.box(P.verreLit, 58.4, 3.4, 44.4, -6, 0.3, 38, 0, { jit: 0 });
  if (B.hi) for (let i = 0; i <= 12; i++) { B.box(mk(0x3b3f45, 0.6, 0.3), 0.35, 17, 0.5, -35 + i * 58 / 12, 0, 60.1, 0, { jit: 0 }); B.box(mk(0x3b3f45, 0.6, 0.3), 0.35, 17, 0.5, -35 + i * 58 / 12, 0, 15.9, 0, { jit: 0 }); }
  B.cyl(BR, 9, 9, 21, -12, -2, 63, 24); B.cyl(ST, 9.3, 9.3, 0.5, -12, 19, 63, 24, { jit: 0 });
  m.collide.box(-6, 38, 29.2, 22.2); m.collide.circle(-12, 63, 9.2);
  return { height: 26 };
}

// ---------- Place Wilson : bassin, rocher et statue du poète Pierre Goudouli ----------
function buildWilson(m) {
  const { B, kit } = m;
  basin(B, 0, 0, 8.5);
  B.add(new THREE.DodecahedronGeometry(2.6, 0).scale(1.3, 0.8, 1.1), mk(0x8f8a7e, 0.9, 0, 0.5, 0.6), 0, 1.2, 0, 0.4); B.add(new THREE.DodecahedronGeometry(1.6, 0), mk(0x8f8a7e, 0.9, 0, 0.5, 0.6), 0.6, 2.6, -0.3, 1);
  B.statue(P.stoneW, 0.3, 3.4, 0, 3, 0.3); B.lump(P.stoneW, -1.6, 0.6, 1.4, 1.6, 1.6, 1, 2, 5);                                   // Goudouli assis, la nymphe Garonne
  if (B.hi) { const W = new Water(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; W.arc([Math.sin(a) * 7.6, 0.6, Math.cos(a) * 7.6], [Math.sin(a) * 3.4, 0.6, Math.cos(a) * 3.4], 2.2, 0.05, 7); } W.jet(0.6, 4, -0.3, 0.1, 0.01); m.add(W.mesh(kit, 'wilson:eau')); }
  m.collide.circle(0, 0, 9.2, -10, 6);
  return { height: 8 };
}

// ---------- Fontaine de la Trinité : trois sirènes ailées de bronze portant une vasque de marbre ----------
function buildTrinite(m) {
  const { B, kit } = m;
  basin(B, 0, 0, 3.6);
  B.cyl(mk(0xc9b79c, 0.5, 0, 0.8), 0.9, 1.2, 0.9, 0, 0.3, 0, 12);
  for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; B.statue(P.verdigris, Math.sin(a) * 0.9, 1.1, Math.cos(a) * 0.9, 2.2, a); if (B.hi) for (const s of [-1, 1]) B.add(new THREE.SphereGeometry(0.5, 6, 4).scale(0.2, 1.3, 0.8), P.verdigris, Math.sin(a + s * 0.5) * 1.15, 2.4, Math.cos(a + s * 0.5) * 1.15, a, { jit: 0 }); }
  B.lathe(mk(0xd9c2ae, 0.4, 0, 0.9), [[0.3, 3.1], [1.4, 3.4], [2, 3.8], [2.05, 3.95], [0.2, 3.9]], 0, 0, 0, 20); B.cyl(P.verdigris, 0.1, 0.25, 0.9, 0, 3.9, 0, 6);
  if (B.hi) { const W = new Water(); W.fall(0, 0.5, 0, 2.0, 2.4, 3.4, 20); W.jet(0, 4.7, 0, 0.9, 0.04); m.add(W.mesh(kit, 'trinite:eau')); }
  m.collide.circle(0, 0, 4.2, -10, 5);
  return { height: 6 };
}

// ---------- Statue équestre de Jeanne d'Arc ----------
function buildJeanneDArc(m) {
  const { B } = m;
  B.box(ST, 5.4, 0.5, 7.4, 0, 0, 0); B.box(mk(0xb9b3a6, 0.7, 0, 0.8, 0.5), 3.2, 4.6, 5.2, 0, 0.5, 0); B.box(ST, 3.7, 0.4, 5.7, 0, 5.1, 0);
  if (B.hi) for (const sx of [-1, 1]) B.box(P.verdigris, 0.1, 2.2, 3.2, sx * 1.62, 1.8, 0, 0, { jit: 0 });
  equestrian(B, P.verdigris, 0, 5.5, 0, 1.8); B.cyl(P.verdigris, 0.03, 0.03, 3.4, 0.7, 8.4, 0.3, 4);
  m.collide.box(0, 0, 2.8, 3.8, 0, -10, 9);
  return { height: 12 };
}

// ---------- Monument aux morts (allées François-Verdier) : portique à trois baies, attique sculpté ----------
function buildMonumentMorts(m) {
  const { B } = m, S = P.stoneL;
  B.extrude(S, arcadeShape(-11, 11, 10.5, [{ x: 0, w: 6, h: 9 }, { x: -7.3, w: 3.4, h: 7 }, { x: 7.3, w: 3.4, h: 7 }]), 8, 0, 0, -4);
  B.box(S, 23, 1, 9, 0, 10.5, 0); B.box(P.deco, 22, 3.4, 8, 0, 11.5, 0); B.box(S, 23.4, 0.7, 9.4, 0, 14.9, 0); B.box(P.stoneD, 26, 0.6, 12, 0, 0, 0);
  for (const sz of [-1, 1]) B.group(0, 0, sz * 4, sz > 0 ? 0 : Math.PI, () => { B.lump(P.deco, 0, 11.7, 0.3, 19, 3, 0.5, 14, sz + 3); for (const x of [-10.2, -4.4, 4.4, 10.2]) B.box(S, 1.2, 10.5, 0.6, x, 0, 0.3, 0, { jit: 0.02 }); });
  for (const x of [-10.2, -4.5, 4.5, 10.2]) m.collide.box(x, 0, x * x > 60 ? 0.9 : 0.75, 4.2);
  return { height: 17 };
}

// ---------- Grand Rond : bassin central aux jets d'eau, kiosque à musique ----------
function buildGrandRond(m) {
  const { B, kit } = m, iron = mk(0x2f4d3a, 0.5, 0.4, 0.5);
  basin(B, 0, 0, 14);
  B.cyl(ST, 1.6, 2, 1.2, 0, 0.3, 0, 12); B.lathe(ST, [[0.5, 1.5], [2.4, 2], [2.5, 2.2], [0.3, 2.1]], 0, 0, 0, 16);
  if (B.hi) { const W = new Water(); W.jet(0, 2.1, 0, 7, 0.12); W.fall(0, 0.5, 0, 2.4, 2.8, 1.7, 16); for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; W.arc([Math.sin(a) * 12.4, 0.6, Math.cos(a) * 12.4], [Math.sin(a) * 5, 0.6, Math.cos(a) * 5], 3.4, 0.06, 8); } m.add(W.mesh(kit, 'grandrond:eau')); }
  m.collide.circle(0, 0, 14.7, -10, 4);
  // kiosque à musique : soubassement de brique, huit colonnettes de fonte, toit de zinc à lambrequin
  B.group(0, 0, -34, 0, () => {
    B.cyl(BR, 5.6, 5.8, 1.3, 0, 0, 0, 8, { exact: true }); B.cyl(ST, 5.9, 5.9, 0.25, 0, 1.3, 0, 8, { exact: true, jit: 0 });
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; B.cyl(iron, 0.1, 0.13, 4, Math.sin(a) * 5.2, 1.5, Math.cos(a) * 5.2, 6); if (B.hi) B.box(iron, 4, 0.9, 0.06, Math.sin(a + Math.PI / 8) * 4.85, 1.55, Math.cos(a + Math.PI / 8) * 4.85, a + Math.PI / 8, { jit: 0 }); }
    B.cyl(P.zinc, 1.2, 6.3, 2.2, 0, 5.5, 0, 8, { exact: true, open: true }); B.cyl(iron, 6.3, 6.3, 0.35, 0, 5.2, 0, 8, { exact: true, jit: 0 }); B.cyl(P.zinc, 0.05, 1.2, 1.4, 0, 7.7, 0, 8, { exact: true, open: true });
  });
  m.collide.circle(0, -34, 6);
  return { height: 10 };
}

// ---------- Jardin japonais (Compans-Caffarelli) : étang, pont rouge en arc, pavillon de thé, île aux rochers ----------
function buildJardinJaponais(m) {
  const { B } = m, wood = P.bois, roofM = mk(0x3d3f42, 0.6, 0.2, 0.3);
  B.add(new THREE.CircleGeometry(1, B.n(28)).rotateX(-Math.PI / 2).scale(17, 1, 11), P.water, 0, 0.08, 4, 0, { jit: 0 }); B.add(new THREE.RingGeometry(0.97, 1.06, B.n(28)).rotateX(-Math.PI / 2).scale(17.4, 1, 11.4), mk(0x8f8a7e, 0.9, 0, 0, 0.5), 0, 0.1, 4, 0, { jit: 0 });
  // pont rouge en dos d'âne
  const N = B.far ? 4 : 10, L = 13, rise = 2.4;
  for (let i = 0; i < N; i++) { const t0 = i / N, t1 = (i + 1) / N, x0 = -L / 2 + L * t0, x1 = -L / 2 + L * t1, y0 = rise * Math.sin(Math.PI * t0), y1 = rise * Math.sin(Math.PI * t1), len = Math.hypot(x1 - x0, y1 - y0); B.add(new THREE.BoxGeometry(len + 0.05, 0.22, 2.6).rotateZ(Math.atan2(y1 - y0, x1 - x0)), P.rougeJ, (x0 + x1) / 2 + 3, (y0 + y1) / 2 + 0.3, 4, 0, { jit: 0 }); for (const sz of [-1, 1]) { B.add(new THREE.BoxGeometry(len + 0.05, 0.14, 0.14).rotateZ(Math.atan2(y1 - y0, x1 - x0)), P.rougeJ, (x0 + x1) / 2 + 3, (y0 + y1) / 2 + 1.3, 4 + sz * 1.25, 0, { jit: 0 }); if (i % 2 === 0) B.box(P.rougeJ, 0.16, 1.2, 0.16, x0 + 3, y0 + 0.3, 4 + sz * 1.25, 0, { jit: 0 }); } }
  // pavillon de thé sur pilotis, toit à larges débords
  B.group(-14, 0, -9, 0.3, () => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(wood, 0.3, 4.2, 0.3, sx * 3.6, 0, sz * 2.8, 0, { jit: 0 });
    B.box(wood, 8, 0.3, 6.4, 0, 0.8, 0); B.box(mk(0xe9e2cf, 0.8, 0, 2), 7.2, 2.6, 0.15, 0, 1.2, -2.8, 0, { jit: 0 }); B.box(mk(0xe9e2cf, 0.8, 0, 1), 0.15, 2.6, 5.6, -3.6, 1.2, 0, 0, { jit: 0 });
    B.frustum(roofM, 11.5, 9.6, 3, 1.6, 2.2, 0, 4, 0); B.frustum(roofM, 12.6, 10.6, 11.5, 9.6, 0.3, 0, 3.8, 0);
  });
  m.collide.box(-14, -9, 4.4, 3.6, 0.3);
  // île, lanterne de pierre, rochers, pins taillés
  B.add(new THREE.SphereGeometry(1, 10, 6).scale(4, 0.9, 3), P.pelouse, -4, 0, 5, 0, { jit: 0 });
  if (B.hi) { B.cyl(ST, 0.18, 0.22, 1.1, 8, 0, -4, 6); B.box(ST, 0.7, 0.5, 0.7, 8, 1.1, -4); B.frustum(ST, 1.2, 1.2, 0.2, 0.2, 0.5, 8, 1.6, -4); for (const [x, z, s] of [[-5, 5, 1.2], [-3, 6, 0.8], [12, 8, 1], [-18, 2, 1.3], [6, -10, 0.9]]) B.add(new THREE.DodecahedronGeometry(s, 0).scale(1.2, 0.7, 1), mk(0x77736a, 0.95, 0, 0), x, s * 0.4, z, s); for (const [x, z] of [[-4.5, 4.4], [15, -6], [-20, -14]]) { B.cyl(mk(0x4a3a2a, 0.9), 0.14, 0.2, 2.4, x, 0.4, z, 5); B.add(new THREE.SphereGeometry(1.5, 8, 5).scale(1.3, 0.5, 1.1), mk(0x2f5a34, 0.95, 0, 0), x + 0.3, 3, z, 0); } }
  return { height: 7 };
}

export const DEFS = { tls_assezat: buildAssezat, tls_palaisjustice: buildPalaisJustice, tls_wilson: buildWilson, tls_trinite: buildTrinite, tls_jeannedarc: buildJeanneDArc, tls_monumentmorts: buildMonumentMorts, tls_grandrond: buildGrandRond, tls_jardinjaponais: buildJardinJaponais };

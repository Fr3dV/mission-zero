// Atlas de textures partagé par tous les personnages (dessiné une seule fois sur canvas) :
//  - albedo « multiplicatif » en niveaux de gris/teintes (la couleur vient des sommets) + alpha (lunettes),
//  - normal map dérivée d'une carte de hauteur (trame des tissus, coutures, plis, mailles, mèches),
//  - rugosité par matière (peau, tissu, cuir, œil...).
import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS } from './mesh.js';
import { TILE, faceU, faceV } from './body.js';

const TS = 256;
let atlas = null;

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function getAtlas() {
  if (atlas) return atlas;
  const W = ATLAS_COLS * TS, Hh = ATLAS_ROWS * TS;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const cA = mk(W, Hh), cH = mk(W, Hh), cR = mk(W / 4, Hh / 4);
  const A = cA.getContext('2d'), Hc = cH.getContext('2d', { willReadFrequently: true }), R = cR.getContext('2d');
  A.fillStyle = '#e8e8e8'; A.fillRect(0, 0, W, Hh);
  Hc.fillStyle = '#808080'; Hc.fillRect(0, 0, W, Hh);
  R.fillStyle = 'rgb(0,200,0)'; R.fillRect(0, 0, W / 4, Hh / 4);
  const rnd = rng(1234);
  const X = (u) => u * TS, Y = (v) => (1 - v) * TS;

  /** Dessine une tuile : fn(a, h) reçoit les contextes albedo et hauteur, origine en haut à gauche de la tuile (256 px). */
  function tile(i, rough, base, fn, skin = 0) {
    const tx = (i % ATLAS_COLS) * TS, ty = Math.floor(i / ATLAS_COLS) * TS;
    for (const c of [A, Hc]) { c.save(); c.beginPath(); c.rect(tx, ty, TS, TS); c.clip(); c.translate(tx, ty); }
    if (base) { A.fillStyle = base; A.fillRect(0, 0, TS, TS); }
    if (fn) fn(A, Hc);
    A.restore(); Hc.restore();
    R.fillStyle = `rgb(0,${Math.round(rough * 255)},${skin ? 255 : 0})`; R.fillRect(tx / 4, ty / 4, TS / 4, TS / 4);
    return [tx / 4, ty / 4];
  }
  // --- motifs de base
  const line = (c, x0, y0, x1, y1, w, style) => { c.strokeStyle = style; c.lineWidth = w; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); };
  const both = (a, h, fn, dark, depth) => { fn(a, `rgba(0,0,0,${dark})`); fn(h, depth < 0 ? `rgba(0,0,0,${-depth})` : `rgba(255,255,255,${depth})`); };
  const speckle = (a, h, n, alpha, size = 2) => { for (let i = 0; i < n; i++) { const x = rnd() * TS, y = rnd() * TS, s = 1 + rnd() * size, d = rnd(); a.fillStyle = `rgba(0,0,0,${alpha * d})`; a.fillRect(x, y, s, s); h.fillStyle = d > 0.5 ? `rgba(255,255,255,${alpha * 2})` : `rgba(0,0,0,${alpha * 2})`; h.fillRect(x, y, s, s); } };
  const weave = (a, h, pitch = 3, k = 1) => {
    for (let p = 0; p < TS; p += pitch) { line(h, p, 0, p, TS, 1, `rgba(255,255,255,${0.2 * k})`); line(h, 0, p, TS, p, 1, `rgba(0,0,0,${0.2 * k})`); line(a, 0, p, TS, p, 1, `rgba(0,0,0,${0.035 * k})`); }
    speckle(a, h, 900, 0.035 * k);
  };
  const twill = (a, h, pitch = 4, k = 1) => {
    for (let p = -TS; p < TS; p += pitch) { line(h, p, TS, p + TS, 0, 1.6, `rgba(255,255,255,${0.3 * k})`); line(a, p, TS, p + TS, 0, 1, `rgba(0,0,0,${0.07 * k})`); }
    speckle(a, h, 1400, 0.05 * k);
  };
  const knit = (a, h, cw = 8, rh = 6) => {
    for (let x = 0; x < TS; x += cw) for (let y = -rh; y < TS; y += rh) {
      for (const c of [h, a]) { c.strokeStyle = c === h ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.07)'; c.lineWidth = c === h ? 1.5 : 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + cw / 2, y + rh); c.lineTo(x + cw, y); c.stroke(); }
    }
    for (let x = 0; x < TS; x += cw) line(h, x, 0, x, TS, 1, 'rgba(0,0,0,0.35)');
  };
  const ribs = (a, h, v0, v1, pitch = 5) => { for (let x = 0; x < TS; x += pitch) { both(a, h, (c, st) => line(c, x, Y(v1), x, Y(v0), 2, st), 0.16, -0.5); } both(a, h, (c, st) => line(c, 0, Y(v1), TS, Y(v1), 1.5, st), 0.25, -0.6); };
  const felt = (a, h, k = 1) => { speckle(a, h, 5000, 0.06 * k, 3); };
  const stitch = (a, h, pts, dbl = false, dark = 0.3) => {
    const path = (c, off) => { c.beginPath(); pts.forEach(([u, v], i) => { const x = X(u) + off, y = Y(v) + off; if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke(); };
    for (const off of dbl ? [0, 3] : [0]) {
      a.strokeStyle = `rgba(0,0,0,${dark})`; a.lineWidth = 1.3; a.setLineDash([3, 2]); path(a, off); a.setLineDash([]);
      h.strokeStyle = 'rgba(0,0,0,0.55)'; h.lineWidth = 2; path(h, off);
    }
  };
  const seam = (a, h, u0, v0, u1, v1, dark = 0.22) => both(a, h, (c, st) => line(c, X(u0), Y(v0), X(u1), Y(v1), 1.6, st), dark, -0.6);
  const button = (a, h, u, v, r = 3.2) => {
    a.fillStyle = 'rgba(20,20,20,0.75)'; a.beginPath(); a.arc(X(u), Y(v), r, 0, 7); a.fill();
    a.fillStyle = 'rgba(255,255,255,0.25)'; a.beginPath(); a.arc(X(u) - 0.8, Y(v) - 0.8, r * 0.4, 0, 7); a.fill();
    h.fillStyle = 'rgba(255,255,255,0.9)'; h.beginPath(); h.arc(X(u), Y(v), r, 0, 7); h.fill();
  };
  const zipper = (a, h, u, v0, v1) => {
    both(a, h, (c, st) => line(c, X(u), Y(v0), X(u), Y(v1), 5, st), 0.35, -0.4);
    a.strokeStyle = 'rgba(190,190,190,0.9)'; a.lineWidth = 2; a.setLineDash([2, 2]); a.beginPath(); a.moveTo(X(u), Y(v0)); a.lineTo(X(u), Y(v1)); a.stroke(); a.setLineDash([]);
    line(h, X(u), Y(v0), X(u), Y(v1), 2, 'rgba(255,255,255,0.8)');
  };
  const sideSeams = (a, h) => { seam(a, h, 0.25, 0, 0.25, 0.86, 0.14); seam(a, h, 0.75, 0, 0.75, 0.86, 0.14); };
  const shade = (a, x, y, rx, ry, color) => { const g = a.createRadialGradient(x, y, 0, x, y, 1); g.addColorStop(0, color); g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)')); a.save(); a.translate(x, y); a.scale(rx, ry); a.translate(-x, -y); a.fillStyle = g; a.beginPath(); a.arc(x, y, 1, 0, 7); a.fill(); a.restore(); };

  // ------------------------------------------------------------------ peau, visages, mains, yeux, cheveux
  tile(TILE.SKIN, 0.7, '#ebebeb', (a, h) => { speckle(a, h, 900, 0.035); for (let i = 0; i < 40; i++) shade(a, rnd() * TS, rnd() * TS, 10 + rnd() * 16, 10 + rnd() * 16, 'rgba(200,120,100,0.05)'); }, 1);
  const face = (fem, old) => (a, h) => {
    speckle(a, h, 500, 0.025);
    const PX = (x) => faceU(x) * TS, PY = (y) => Y(faceV(y));
    const sx = Math.abs(PX(0.01) - PX(0)) * 100; // px par mètre au centre
    for (const s of [-1, 1]) {
      shade(a, PX(s * 0.031), PY(1.6735), sx * 0.021, sx * 0.014, 'rgba(110,70,60,0.34)');   // orbite
      shade(a, PX(s * 0.031), PY(1.664), sx * 0.016, sx * 0.006, 'rgba(120,80,80,0.16)');     // cerne
      shade(a, PX(s * 0.046), PY(1.632), sx * 0.022, sx * 0.018, 'rgba(235,120,105,0.2)');    // joue
      shade(a, PX(s * 0.0125), PY(1.652), sx * 0.005, sx * 0.02, 'rgba(120,80,70,0.16)');     // flanc du nez
      // sourcil
      const bw = fem ? 2.6 : 4.4;
      for (const c of [a, h]) {
        c.strokeStyle = c === a ? 'rgba(60,40,30,0.16)' : 'rgba(255,255,255,0.5)'; c.lineWidth = bw; c.lineCap = 'round';
        c.beginPath(); c.moveTo(PX(s * 0.0125), PY(1.6895)); c.quadraticCurveTo(PX(s * 0.03), PY(fem ? 1.699 : 1.6965), PX(s * 0.05), PY(1.6905)); c.stroke(); c.lineCap = 'butt';
      }
      // pli de paupière + narine
      a.strokeStyle = 'rgba(90,55,45,0.45)'; a.lineWidth = 1.2; a.beginPath(); a.moveTo(PX(s * 0.018), PY(1.6805)); a.quadraticCurveTo(PX(s * 0.031), PY(1.6845), PX(s * 0.045), PY(1.6795)); a.stroke();
      a.fillStyle = 'rgba(55,25,22,0.8)'; a.beginPath(); a.ellipse(PX(s * 0.0078), PY(1.6305), sx * 0.0042, sx * 0.0024, 0, 0, 7); a.fill();
      // ombre du pavillon / tempe
      shade(a, PX(s * 0.07), PY(1.66), sx * 0.01, sx * 0.03, 'rgba(120,80,70,0.12)');
    }
    shade(a, PX(0), PY(1.627), sx * 0.02, sx * 0.006, 'rgba(100,55,45,0.3)');   // sous le nez
    shade(a, PX(0), PY(1.587), sx * 0.02, sx * 0.007, 'rgba(100,60,50,0.2)');   // sous la lèvre
    shade(a, PX(0), PY(1.552), sx * 0.05, sx * 0.012, 'rgba(90,55,45,0.25)');   // sous le menton
    // lèvres
    const mw = fem ? 0.0235 : 0.0245, my = 1.603;
    const lips = (c, fill) => {
      c.fillStyle = fill; c.beginPath();
      c.moveTo(PX(-mw), PY(my)); c.quadraticCurveTo(PX(-mw * 0.45), PY(my + (fem ? 0.0085 : 0.0062)), PX(-0.004), PY(my + (fem ? 0.0078 : 0.0056)));
      c.quadraticCurveTo(PX(0), PY(my + (fem ? 0.0062 : 0.0045)), PX(0.004), PY(my + (fem ? 0.0078 : 0.0056)));
      c.quadraticCurveTo(PX(mw * 0.45), PY(my + (fem ? 0.0085 : 0.0062)), PX(mw), PY(my));
      c.quadraticCurveTo(PX(0), PY(my - (fem ? 0.0185 : 0.0155)), PX(-mw), PY(my)); c.fill();
    };
    lips(a, fem ? 'rgba(178,58,70,0.72)' : 'rgba(170,85,80,0.42)');
    lips(h, 'rgba(255,255,255,0.35)');
    for (const c of [a, h]) { c.strokeStyle = c === a ? 'rgba(70,25,28,0.85)' : 'rgba(0,0,0,0.8)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(PX(-mw), PY(my)); c.quadraticCurveTo(PX(0), PY(my - 0.0016), PX(mw), PY(my)); c.stroke(); }
    if (!fem) shade(a, PX(0), PY(1.585), sx * 0.06, sx * 0.04, 'rgba(70,60,60,0.1)'); // ombre de barbe
    // teintes : nez et oreilles plus rouges, sillon nasogénien, paupière inférieure
    shade(a, PX(0), PY(1.64), sx * 0.014, sx * 0.014, 'rgba(225,110,95,0.2)');
    for (const s of [-1, 1]) {
      shade(a, PX(s * 0.074), PY(1.662), sx * 0.02, sx * 0.03, 'rgba(225,110,95,0.22)');
      a.strokeStyle = `rgba(95,55,45,${old ? 0.5 : 0.2})`; a.lineWidth = old ? 1.6 : 1.2; a.beginPath(); a.moveTo(PX(s * 0.014), PY(1.63)); a.quadraticCurveTo(PX(s * 0.027), PY(1.618), PX(s * 0.029), PY(1.6)); a.stroke();
      if (old) { // rides : patte d'oie, poche sous l'œil, pli de la joue
        for (let i = 0; i < 3; i++) line(a, PX(s * 0.048), PY(1.672 + (i - 1) * 0.002), PX(s * 0.058), PY(1.674 + (i - 1) * 0.006), 1, 'rgba(95,55,45,0.4)');
        a.strokeStyle = 'rgba(95,55,45,0.4)'; a.lineWidth = 1.3; a.beginPath(); a.moveTo(PX(s * 0.018), PY(1.662)); a.quadraticCurveTo(PX(s * 0.031), PY(1.656), PX(s * 0.044), PY(1.663)); a.stroke();
        a.beginPath(); a.moveTo(PX(s * 0.03), PY(1.597)); a.quadraticCurveTo(PX(s * 0.034), PY(1.585), PX(s * 0.03), PY(1.572)); a.stroke();
      }
    }
    if (old) for (let i = 0; i < 3; i++) { a.strokeStyle = 'rgba(95,55,45,0.32)'; a.lineWidth = 1.2; a.beginPath(); a.moveTo(PX(-0.04), PY(1.708 + i * 0.008)); a.quadraticCurveTo(PX(0), PY(1.711 + i * 0.008), PX(0.04), PY(1.708 + i * 0.008)); a.stroke(); }
  };
  const shine = ([rx, ry]) => { // front, nez et pommettes un peu plus brillants
    for (const [u, v, r] of [[0.5, 0.72, 9], [0.5, 0.42, 4], [0.42, 0.44, 4], [0.58, 0.44, 4]]) { const g = R.createRadialGradient(rx + u * 64, ry + (1 - v) * 64, 0, rx + u * 64, ry + (1 - v) * 64, r); g.addColorStop(0, 'rgba(0,120,255,0.75)'); g.addColorStop(1, 'rgba(0,170,255,0)'); R.fillStyle = g; R.fillRect(rx, ry, 64, 64); }
  };
  shine(tile(TILE.FACE_M, 0.68, '#ececec', face(false, false), 1)); shine(tile(TILE.FACE_F, 0.66, '#eeeeee', face(true, false), 1));
  shine(tile(TILE.FACE_MO, 0.72, '#e9e9e9', face(false, true), 1)); shine(tile(TILE.FACE_FO, 0.7, '#ebebeb', face(true, true), 1));

  tile(TILE.HAND, 0.7, '#ebebeb', (a, h) => {
    a.fillStyle = 'rgba(255,255,255,0.5)'; a.fillRect(X(0.55), 0, X(0.4), TS); // paume plus claire
    for (const u of [0.15, 0.25, 0.35]) shade(a, X(u), Y(0.5), 9, 7, 'rgba(210,110,95,0.25)'); // jointures
    speckle(a, h, 500, 0.03);
    for (const cu of [0.25, 0.75]) {
      for (const du of [-0.1, 0, 0.1]) both(a, h, (c, st) => line(c, X(cu + du), Y(0.0), X(cu + du * 0.92), Y(0.5), 2.4, st), 0.5, -0.9); // sillons entre les doigts
      for (const v of [0.5, 0.33, 0.2]) for (const du of [-0.15, -0.05, 0.05, 0.15]) line(a, X(cu + du - 0.035), Y(v), X(cu + du + 0.035), Y(v), 1, 'rgba(90,50,40,0.28)'); // phalanges
    }
  }, 1);


  tile(TILE.EYES, 0.14, '#efe9e4', (a) => {
    const irises = ['#4a2c17', '#557a96', '#66703c'];
    for (let k = 0; k < 3; k++) {
      const w = TS / 3, x0 = k * w, cx = x0 + w / 2, cy = TS * 0.47;
      let g = a.createLinearGradient(x0, 0, x0 + w, 0); g.addColorStop(0, 'rgba(120,70,60,0.5)'); g.addColorStop(0.25, 'rgba(0,0,0,0)'); g.addColorStop(0.75, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(120,70,60,0.5)');
      a.fillStyle = g; a.fillRect(x0, 0, w, TS);
      a.fillStyle = '#1a0f0a'; a.beginPath(); a.ellipse(cx, cy, w * 0.215, TS * 0.5, 0, 0, 7); a.fill();
      a.fillStyle = irises[k]; a.beginPath(); a.ellipse(cx, cy, w * 0.195, TS * 0.455, 0, 0, 7); a.fill();
      g = a.createRadialGradient(cx, cy, 0, cx, cy, 1); g.addColorStop(0.3, 'rgba(0,0,0,0.25)'); g.addColorStop(0.75, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
      a.save(); a.translate(cx, cy); a.scale(w * 0.195, TS * 0.455); a.translate(-cx, -cy); a.fillStyle = g; a.beginPath(); a.arc(cx, cy, 1, 0, 7); a.fill(); a.restore();
      a.fillStyle = '#050505'; a.beginPath(); a.ellipse(cx, cy, w * 0.08, TS * 0.19, 0, 0, 7); a.fill();
      a.fillStyle = 'rgba(255,255,255,0.9)'; a.beginPath(); a.ellipse(cx + w * 0.07, cy - TS * 0.17, w * 0.03, TS * 0.06, 0, 0, 7); a.fill();
      g = a.createLinearGradient(0, 0, 0, TS); g.addColorStop(0, 'rgba(15,8,6,0.95)'); g.addColorStop(0.1, 'rgba(15,8,6,0.9)'); g.addColorStop(0.36, 'rgba(40,20,15,0)'); g.addColorStop(0.9, 'rgba(60,30,25,0)'); g.addColorStop(1, 'rgba(60,30,25,0.5)');
      a.fillStyle = g; a.fillRect(x0, 0, w, TS);
    }
  });

  tile(TILE.HAIR, 0.48, '#cfcfcf', (a, h) => {
    for (let i = 0; i < 520; i++) {
      const x = rnd() * TS, w = 0.6 + rnd() * 2, d = rnd(), y0 = rnd() * TS * 0.5 - TS * 0.25, len = TS * (0.5 + rnd());
      const wob = (rnd() - 0.5) * 10;
      for (const c of [a, h]) { c.strokeStyle = c === a ? (d > 0.72 ? `rgba(255,255,255,${0.35 * rnd()})` : `rgba(0,0,0,${0.3 * d})`) : (d > 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'); c.lineWidth = w; c.beginPath(); c.moveTo(x, y0); c.quadraticCurveTo(x + wob, y0 + len / 2, x + wob * 0.3, y0 + len); c.stroke(); }
    }
    // bande de reflet (les mèches accrochent la lumière à mi-hauteur)
    const g = a.createLinearGradient(0, Y(0.9), 0, Y(0.45)); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.45, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    for (let x = 0; x < TS; x += 3) { a.fillStyle = g; a.globalAlpha = 0.35 + 0.65 * rnd(); a.fillRect(x, Y(0.9) + (rnd() - 0.5) * 16, 3, Y(0.45) - Y(0.9)); } a.globalAlpha = 1;
    const g2 = a.createLinearGradient(0, Y(0.3), 0, Y(0)); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,0.3)'); a.fillStyle = g2; a.fillRect(0, Y(0.3), TS, Y(0) - Y(0.3));
    // pointes : dents transparentes en bas de la tuile (bord d'implantation non rectiligne)
    a.globalCompositeOperation = 'destination-out';
    for (let x = 0; x < TS; x += 4 + rnd() * 5) { const w = 3 + rnd() * 5, hh = 8 + rnd() * 22; a.beginPath(); a.moveTo(x, TS); a.lineTo(x + w / 2, TS - hh); a.lineTo(x + w, TS); a.fill(); }
    a.globalCompositeOperation = 'source-over';
  });

  // ------------------------------------------------------------------ hauts
  const grain = (a, h, k = 1) => { for (let i = 0; i < 2600; i++) { const x = rnd() * TS, y = rnd() * TS; h.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.1 * k})` : `rgba(0,0,0,${0.1 * k})`; h.fillRect(x, y, 1.5, 1.5); } speckle(a, h, 300, 0.02); };
  // plis de manche : tension au coude (v ≈ 0,43), sous l'épaule, tassement au poignet
  const sleeveFolds = (a, h, k = 1) => {
    for (const [v0, n, amp] of [[0.43, 5, 1], [0.8, 3, 0.6], [0.08, 3, 0.7]]) for (let i = 0; i < n; i++) {
      const v = v0 + (i - n / 2) * 0.022, u0 = rnd() * 0.5, u1 = u0 + 0.3 + rnd() * 0.3, bend = (rnd() - 0.5) * 0.04;
      both(a, h, (c, st) => { c.strokeStyle = st; c.lineWidth = 2.2; c.beginPath(); c.moveTo(X(u0), Y(v)); c.quadraticCurveTo(X((u0 + u1) / 2), Y(v + bend), X(u1), Y(v + bend * 0.3)); c.stroke(); }, 0.07 * amp * k, -0.42 * amp * k);
    }
  };
  tile(TILE.COTTON, 0.92, null, (a, h) => { weave(a, h, 3); sleeveFolds(a, h); });
  tile(TILE.TSHIRT, 0.92, null, (a, h) => { weave(a, h, 3); sideSeams(a, h); stitch(a, h, [[0, 0.035], [1, 0.035]], true, 0.2); });
  tile(TILE.SHIRT, 0.82, '#ececec', (a, h) => {
    weave(a, h, 2, 0.7); sideSeams(a, h);
    seam(a, h, 0.478, 0, 0.478, 1); seam(a, h, 0.522, 0, 0.522, 1);
    for (let v = 0.08; v < 1; v += 0.115) button(a, h, 0.5, v, 2);
    stitch(a, h, [[0.585, 0.74], [0.585, 0.62], [0.615, 0.6], [0.645, 0.62], [0.645, 0.74], [0.585, 0.74]]);
    seam(a, h, 0, 0.84, 0.2, 0.86); seam(a, h, 0.8, 0.86, 1, 0.84);
    stitch(a, h, [[0, 0.03], [1, 0.03]], false, 0.2);
  });
  tile(TILE.KNIT, 0.97, null, (a, h) => { knit(a, h, 5, 4); ribs(a, h, 0, 0.085, 4); });
  tile(TILE.KNITS, 0.97, null, (a, h) => { knit(a, h, 5, 4); ribs(a, h, 0, 0.07, 4); sleeveFolds(a, h, 0.8); });
  tile(TILE.HOODIE, 0.95, null, (a, h) => {
    felt(a, h, 0.6); weave(a, h, 4, 0.5); sideSeams(a, h); ribs(a, h, 0, 0.075, 4);
    const pk = [[0.36, 0.1], [0.4, 0.3], [0.6, 0.3], [0.64, 0.1]];
    stitch(a, h, [...pk, pk[0]], true, 0.3);
    both(a, h, (c, st) => { line(c, X(0.365), Y(0.11), X(0.4), Y(0.28), 3, st); line(c, X(0.635), Y(0.11), X(0.6), Y(0.28), 3, st); }, 0.3, -0.6);
    for (const u of [0.475, 0.525]) { line(a, X(u), Y(0.97), X(u + (u - 0.5) * 0.3), Y(0.74), 2.4, 'rgba(0,0,0,0.28)'); line(h, X(u), Y(0.97), X(u + (u - 0.5) * 0.3), Y(0.74), 2.4, 'rgba(255,255,255,0.8)'); }
  });
  tile(TILE.BLOUSON, 0.5, '#e6e6e6', (a, h) => {
    grain(a, h); sideSeams(a, h); ribs(a, h, 0, 0.07, 4);
    zipper(a, h, 0.5, 0.07, 1);
    for (const s of [-1, 1]) { both(a, h, (c, st) => line(c, X(0.5 + s * 0.1), Y(0.3), X(0.5 + s * 0.14), Y(0.14), 3, st), 0.4, -0.7); seam(a, h, 0.5 + s * 0.06, 0.07, 0.5 + s * 0.06, 0.62, 0.12); seam(a, h, 0.5 + s * 0.02, 0.8, 0.5 + s * 0.22, 0.76, 0.16); }
    seam(a, h, 0, 0.8, 0.22, 0.78, 0.16); seam(a, h, 0.78, 0.78, 1, 0.8, 0.16);
  });
  tile(TILE.COAT, 0.96, null, (a, h) => {
    felt(a, h); twill(a, h, 5, 0.35); sideSeams(a, h);
    seam(a, h, 0.535, 0, 0.535, 0.74, 0.28); seam(a, h, 0, 0, 0, 0.92, 0.2); seam(a, h, 1, 0, 1, 0.92, 0.2);
    for (const v of [0.5, 0.61, 0.72]) button(a, h, 0.505, v, 4);
    for (const s of [-1, 1]) { both(a, h, (c, st) => line(c, X(0.5 + s * 0.11), Y(0.44), X(0.5 + s * 0.19), Y(0.43), 2.5, st), 0.35, -0.7); stitch(a, h, [[0.5 + s * 0.11, 0.42], [0.5 + s * 0.19, 0.41]], false, 0.2); }
    stitch(a, h, [[0, 0.02], [1, 0.02]], false, 0.2);
  });
  tile(TILE.PUFFER, 0.5, '#e6e6e6', (a, h) => {
    const g = h.createLinearGradient(0, 0, 0, TS * 0.1268);
    for (let k = 0; k < 9; k++) { // boudins : dégradé de hauteur + couture sombre
      const y1 = Y(k * 0.1268), y0 = Y((k + 1) * 0.1268);
      const gr = h.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, '#404040'); gr.addColorStop(0.5, '#c8c8c8'); gr.addColorStop(1, '#404040'); h.fillStyle = gr; h.fillRect(0, y0, TS, y1 - y0);
      const ga = a.createLinearGradient(0, y0, 0, y1); ga.addColorStop(0, 'rgba(0,0,0,0.28)'); ga.addColorStop(0.3, 'rgba(0,0,0,0)'); ga.addColorStop(0.75, 'rgba(0,0,0,0.04)'); ga.addColorStop(1, 'rgba(0,0,0,0.32)'); a.fillStyle = ga; a.fillRect(0, y0, TS, y1 - y0);
    }
    void g; speckle(a, h, 300, 0.03);
    zipper(a, h, 0.5, 0, 1);
  });
  tile(TILE.WOOL, 0.95, null, (a, h) => { felt(a, h, 0.5); twill(a, h, 4, 0.4); sleeveFolds(a, h); seam(a, h, 0.0, 0, 0.0, 1, 0.16); seam(a, h, 1, 0, 1, 1, 0.16); for (const u of [0.02, 0.06]) button(a, h, u, 0.05, 2); });
  // veste de costume : drap fin, pinces, poches à rabat, boutonnage bas, plis de tension à la taille
  tile(TILE.SUIT, 0.93, null, (a, h) => {
    felt(a, h, 0.35); twill(a, h, 4, 0.4); sideSeams(a, h);
    seam(a, h, 0.53, 0, 0.53, 0.56, 0.3); seam(a, h, 0, 0, 0, 0.95, 0.2); seam(a, h, 1, 0, 1, 0.95, 0.2);
    for (const v of [0.4, 0.52]) button(a, h, 0.505, v, 3.4);
    for (const s of [-1, 1]) {
      seam(a, h, 0.5 + s * 0.15, 0.2, 0.5 + s * 0.13, 0.62, 0.12); // pince
      both(a, h, (c, st) => line(c, X(0.5 + s * 0.1), Y(0.3), X(0.5 + s * 0.2), Y(0.29), 3, st), 0.3, -0.7);
      stitch(a, h, [[0.5 + s * 0.1, 0.27], [0.5 + s * 0.2, 0.26]], false, 0.18);
      for (let i = 0; i < 3; i++) both(a, h, (c, st) => line(c, X(0.5 + s * 0.04), Y(0.44 + i * 0.02), X(0.5 + s * 0.2), Y(0.5 + i * 0.03), 1.8, st), 0.05, -0.3);
    }
    seam(a, h, 0.58, 0.72, 0.66, 0.72, 0.22); stitch(a, h, [[0, 0.02], [1, 0.02]], false, 0.18);
  });
  tile(TILE.LEATHER, 0.5, '#e6e6e6', (a, h) => { grain(a, h); sleeveFolds(a, h, 1.2); seam(a, h, 0, 0.06, 1, 0.06, 0.2); seam(a, h, 0, 0, 0, 1, 0.14); seam(a, h, 1, 0, 1, 1, 0.14); });
  tile(TILE.DRESS, 0.8, null, (a, h) => {
    weave(a, h, 2, 0.6);
    for (let i = 0; i < 14; i++) { const u = (i + 0.5) / 14; const g1 = a.createLinearGradient(0, Y(0.42), 0, Y(0)); g1.addColorStop(0, 'rgba(0,0,0,0)'); g1.addColorStop(1, 'rgba(0,0,0,0.22)'); a.strokeStyle = g1; a.lineWidth = 5; a.beginPath(); a.moveTo(X(u), Y(0.42)); a.lineTo(X(u), Y(0)); a.stroke(); }
    seam(a, h, 0, 0.5, 1, 0.5, 0.18); sideSeams(a, h); stitch(a, h, [[0, 0.02], [1, 0.02]], false, 0.2);
  });

  // ------------------------------------------------------------------ bas
  const denimBase = (a, h) => { twill(a, h, 4, 1); };
  tile(TILE.DENIM, 0.9, '#c9c9c9', (a, h) => {
    shade(a, X(0.5), Y(0.72), 60, 70, 'rgba(255,255,255,0.32)'); shade(a, X(0.5), Y(0.46), 44, 34, 'rgba(255,255,255,0.3)'); shade(a, X(0.02), Y(0.8), 40, 50, 'rgba(255,255,255,0.2)'); shade(a, X(0.98), Y(0.8), 40, 50, 'rgba(255,255,255,0.2)');
    denimBase(a, h);
    stitch(a, h, [[0.25, 0], [0.25, 1]], true, 0.3); seam(a, h, 0.75, 0, 0.75, 1, 0.22);
    stitch(a, h, [[0, 0.035], [1, 0.035]], true, 0.3);
    for (let i = 0; i < 5; i++) both(a, h, (c, st) => { c.strokeStyle = st; c.lineWidth = 1.6; c.beginPath(); c.moveTo(X(0.3), Y(0.9 - i * 0.022)); c.quadraticCurveTo(X(0.42), Y(0.89 - i * 0.03), X(0.56), Y(0.93 - i * 0.02)); c.stroke(); }, 0.1, -0.35); // moustaches
    for (let i = 0; i < 4; i++) for (const u0 of [0, 0.84]) both(a, h, (c, st) => line(c, X(u0), Y(0.47 + i * 0.016), X(u0 + 0.16), Y(0.462 + i * 0.016 + (i % 2) * 0.008), 1.4, st), 0.07, -0.4); // plis derrière le genou
    for (let i = 0; i < 9; i++) { const u0 = rnd(), v0 = 0.05 + rnd() * 0.12; both(a, h, (c, st) => line(c, X(u0), Y(v0), X(u0 + 0.25 + rnd() * 0.2), Y(v0 + (rnd() - 0.5) * 0.03), 1.5, st), 0.06, -0.4); } // tassement sur la chaussure
  });
  const hipCommon = (a, h, jeans) => {
    // ceinture + passants + bouton + braguette
    both(a, h, (c, st) => line(c, 0, Y(0.86), TS, Y(0.86), 1.6, st), 0.3, -0.7);
    stitch(a, h, [[0, 0.885], [1, 0.885]], false, 0.25); stitch(a, h, [[0, 0.975], [1, 0.975]], false, 0.25);
    for (const u of [0.02, 0.2, 0.4, 0.6, 0.8, 0.98]) { a.fillStyle = 'rgba(0,0,0,0.2)'; a.fillRect(X(u) - 3, Y(1), 6, Y(0.84) - Y(1)); h.fillStyle = 'rgba(255,255,255,0.8)'; h.fillRect(X(u) - 3, Y(1), 6, Y(0.84) - Y(1)); }
    button(a, h, 0.5, 0.925, 3.4);
    stitch(a, h, [[0.5, 0.86], [0.5, 0.3]], false, 0.3); stitch(a, h, [[0.535, 0.86], [0.535, 0.48], [0.52, 0.4], [0.5, 0.36]], jeans, 0.3);
    seam(a, h, 0.25, 0, 0.25, 0.86, 0.2); seam(a, h, 0.75, 0, 0.75, 0.86, 0.2); seam(a, h, 0, 0, 0, 0.86, 0.22); seam(a, h, 1, 0, 1, 0.86, 0.22);
  };
  tile(TILE.JEANHIP, 0.9, '#c9c9c9', (a, h) => {
    denimBase(a, h); hipCommon(a, h, true);
    for (const s of [-1, 1]) {
      stitch(a, h, [[0.5 + s * 0.08, 0.86], [0.5 + s * 0.11, 0.66], [0.5 + s * 0.2, 0.6], [0.5 + s * 0.245, 0.6]], true, 0.32); // poches avant
      const c = s < 0 ? 0.13 : 0.87; // poches arrière
      stitch(a, h, [[c - 0.075, 0.76], [c + 0.075, 0.76], [c + 0.07, 0.4], [c, 0.32], [c - 0.07, 0.4], [c - 0.075, 0.76]], true, 0.34);
      stitch(a, h, [[c - 0.06, 0.6], [c, 0.54], [c + 0.06, 0.6]], false, 0.25);
      seam(a, h, s < 0 ? 0 : 1, 0.74, 0.5 - s * 0.255, 0.84, 0.25); // empiècement
    }
  });
  tile(TILE.CHINO, 0.86, null, (a, h) => {
    twill(a, h, 3, 0.45); seam(a, h, 0.25, 0, 0.25, 1, 0.16); seam(a, h, 0.75, 0, 0.75, 1, 0.16);
    line(a, X(0.5), Y(0), X(0.5), Y(0.95), 1.4, 'rgba(0,0,0,0.12)'); line(h, X(0.5), Y(0), X(0.5), Y(0.95), 2.5, 'rgba(255,255,255,0.7)'); // pli repassé
    for (let i = 0; i < 3; i++) for (const u0 of [0, 0.84]) both(a, h, (c, st) => line(c, X(u0), Y(0.47 + i * 0.018), X(u0 + 0.16), Y(0.464 + i * 0.018), 1.4, st), 0.06, -0.35);
    for (let i = 0; i < 7; i++) { const u0 = rnd(), v0 = 0.05 + rnd() * 0.12; both(a, h, (c, st) => line(c, X(u0), Y(v0), X(u0 + 0.25 + rnd() * 0.2), Y(v0 + (rnd() - 0.5) * 0.03), 1.5, st), 0.05, -0.35); }
    stitch(a, h, [[0, 0.03], [1, 0.03]], false, 0.18);
  });
  tile(TILE.CHINOHIP, 0.86, null, (a, h) => {
    twill(a, h, 3, 0.45); hipCommon(a, h, false);
    for (const s of [-1, 1]) {
      both(a, h, (c, st) => line(c, X(0.5 + s * 0.13), Y(0.86), X(0.5 + s * 0.23), Y(0.5), 2, st), 0.3, -0.7); // poches italiennes
      const c = s < 0 ? 0.13 : 0.87; both(a, h, (cc, st) => line(cc, X(c - 0.07), Y(0.66), X(c + 0.07), Y(0.66), 2.2, st), 0.35, -0.7); button(a, h, c, 0.63, 2.2);
    }
  });

  // ------------------------------------------------------------------ chaussures, accessoires
  tile(TILE.SNEAKER, 0.7, '#efefef', (a, h) => {
    speckle(a, h, 500, 0.03);
    seam(a, h, 0, 0.8, 1, 0.8, 0.22); stitch(a, h, [[0.2, 0.8], [0.3, 0.86], [0.5, 0.9], [0.7, 0.86], [0.8, 0.8]], false, 0.25); // bout
    a.fillStyle = 'rgba(0,0,0,0.16)'; a.fillRect(X(0.41), Y(0.76), X(0.18), Y(0.3) - Y(0.76)); // languette
    for (let v = 0.36; v < 0.76; v += 0.065) { for (const c of [a, h]) { c.strokeStyle = c === a ? 'rgba(0,0,0,0.32)' : 'rgba(255,255,255,0.9)'; c.lineWidth = 3; c.beginPath(); c.moveTo(X(0.4), Y(v)); c.lineTo(X(0.6), Y(v + 0.03)); c.moveTo(X(0.6), Y(v)); c.lineTo(X(0.4), Y(v + 0.03)); c.stroke(); } }
    for (const u of [0.24, 0.76]) { both(a, h, (c, st) => { line(c, X(u - 0.05), Y(0.3), X(u + 0.05), Y(0.62), 5, st); line(c, X(u - 0.08), Y(0.36), X(u + 0.02), Y(0.68), 5, st); }, 0.22, 0.5); } // bandes latérales
    seam(a, h, 0, 0.16, 1, 0.16, 0.2); stitch(a, h, [[0.36, 0.3], [0.3, 0.5], [0.3, 0.76]], false, 0.2); stitch(a, h, [[0.64, 0.3], [0.7, 0.5], [0.7, 0.76]], false, 0.2);
  });
  tile(TILE.RUBBER, 0.85, '#e6e6e6', (a, h) => { for (let y = 0; y < TS; y += 6) line(h, 0, y, TS, y, 1, 'rgba(0,0,0,0.3)'); });
  // lunettes : moitié basse = monture de vue (verres transparents), moitié haute = solaires
  {
    const i = TILE.GLASSES, tx = (i % ATLAS_COLS) * TS, ty = Math.floor(i / ATLAS_COLS) * TS;
    A.clearRect(tx, ty, TS, TS);
    R.fillStyle = 'rgb(0,50,0)'; R.fillRect(tx / 4, ty / 4, TS / 4, TS / 4);
    const frames = (y0, hgt, fill) => {
      for (const s of [-1, 1]) {
        const cx = tx + TS * (0.5 + s * 0.222), cy = y0 + hgt * 0.5, rx = TS * 0.16, ry = hgt * 0.4;
        A.beginPath(); A.roundRect(cx - rx, cy - ry, rx * 2, ry * 2, [ry * 0.5, ry * 0.5, ry * 0.9, ry * 0.9]);
        if (fill) { A.fillStyle = '#1a1c20'; A.fill(); }
        A.strokeStyle = '#1b1b1f'; A.lineWidth = fill ? 5 : 6; A.stroke();
      }
      A.strokeStyle = '#1b1b1f'; A.lineWidth = 5; A.beginPath(); A.moveTo(tx + TS * 0.44, y0 + hgt * 0.36); A.quadraticCurveTo(tx + TS * 0.5, y0 + hgt * 0.22, tx + TS * 0.56, y0 + hgt * 0.36); A.stroke();
      A.beginPath(); A.moveTo(tx + 4, y0 + hgt * 0.3); A.lineTo(tx + TS * 0.07, y0 + hgt * 0.3); A.moveTo(tx + TS - 4, y0 + hgt * 0.3); A.lineTo(tx + TS * 0.93, y0 + hgt * 0.3); A.stroke();
    };
    frames(ty + TS / 2, TS / 2, false); frames(ty, TS / 2, true);
  }
  tile(TILE.BAG, 0.8, '#e2e2e2', (a, h) => {
    weave(a, h, 4, 1.2);
    stitch(a, h, [[0.36, 0.12], [0.36, 0.5], [0.64, 0.5], [0.64, 0.12], [0.36, 0.12]], true, 0.3);
    zipper(a, h, 0.5, 0.56, 0.9); both(a, h, (c, st) => line(c, X(0.3), Y(0.56), X(0.7), Y(0.56), 2.5, st), 0.35, -0.6);
    seam(a, h, 0.25, 0, 0.25, 1, 0.2); seam(a, h, 0.75, 0, 0.75, 1, 0.2);
  });
  tile(TILE.SCARF, 0.97, null, (a, h) => { knit(a, h, 9, 7); for (let v = 0.1; v < 1; v += 0.25) { a.fillStyle = 'rgba(0,0,0,0.16)'; a.fillRect(0, Y(v + 0.06), TS, Y(v) - Y(v + 0.06)); } });
  tile(TILE.PLAIN, 0.55, '#ececec', null);

  // ------------------------------------------------------------------ normal map (Sobel sur la carte de hauteur)
  const src = Hc.getImageData(0, 0, W, Hh).data;
  const cN = mk(W, Hh), N = cN.getContext('2d'), img = N.createImageData(W, Hh), d = img.data;
  const STR = 2.2 / 255;
  for (let y = 0; y < Hh; y++) {
    const ym = Math.max(0, y - 1) * W, yp = Math.min(Hh - 1, y + 1) * W, yc = y * W;
    for (let x = 0; x < W; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1);
      const dx = (src[(yc + xp) * 4] - src[(yc + xm) * 4]) * STR, dy = (src[(yp + x) * 4] - src[(ym + x) * 4]) * STR;
      const l = 1 / Math.sqrt(dx * dx + dy * dy + 1), o = (yc + x) * 4;
      d[o] = (-dx * l * 0.5 + 0.5) * 255; d[o + 1] = (dy * l * 0.5 + 0.5) * 255; d[o + 2] = (l * 0.5 + 0.5) * 255; d[o + 3] = 255;
    }
  }
  N.putImageData(img, 0, 0);

  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; return t; };
  atlas = { map: tex(cA, true), normalMap: tex(cN, false), roughnessMap: tex(cR, false), canvases: { albedo: cA, normal: cN, rough: cR, height: cH } };
  return atlas;
}

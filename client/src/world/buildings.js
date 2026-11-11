// Immeubles haussmanniens : un gabarit unitaire (murs + brisis de mansarde + toit à croupes + 2 souches de
// cheminée) instancié par bâtiment (2 vec4 par instance), façade entièrement procédurale dans le fragment shader
// (travées de fenêtres, bandeaux, balcons filants, rez-de-chaussée commerçant, zinc, lucarnes, fenêtres allumées).
import { TILE, tileKey, hash2, mulberry32 } from './util.js';

const BASE_INDEX_COUNT = 72; // murs + brisis + toit (les cheminées suivent)

function unitGeometry(THREE) {
  const pos = [], fn = [], part = [], idx = [];
  const quad = (v, n, p) => {
    const b = pos.length / 3;
    for (const q of v) { pos.push(q[0], q[1], q[2]); fn.push(n[0], n[1]); part.push(p); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const N = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let p = 0; p < 3; p++) for (const n of N) {
    const t = [n[1], -n[0]], A = [n[0] - t[0], n[1] - t[1]], B = [n[0] + t[0], n[1] + t[1]];
    quad([[A[0], p, A[1]], [B[0], p, B[1]], [B[0], p + 1, B[1]], [A[0], p + 1, A[1]]], n, p);
  }
  for (let c = 0; c < 2; c++) {
    for (const n of N) {
      const t = [n[1], -n[0]], A = [n[0] - t[0], n[1] - t[1]], B = [n[0] + t[0], n[1] + t[1]];
      quad([[A[0], 4, A[1]], [B[0], 4, B[1]], [B[0], 5, B[1]], [A[0], 5, A[1]]], n, 3 + c);
    }
    quad([[-1, 5, 1], [1, 5, 1], [1, 5, -1], [-1, 5, -1]], [0, 0], 3 + c);
  }
  return {
    position: new THREE.BufferAttribute(new Float32Array(pos), 3),
    aFn: new THREE.BufferAttribute(new Float32Array(fn), 2),
    aPart: new THREE.BufferAttribute(new Float32Array(part), 1),
    index: new THREE.BufferAttribute(new Uint16Array(idx), 1),
    indexCount: idx.length,
  };
}

const VERT_PARS = `
attribute vec4 iA;
attribute vec4 iB;
attribute vec2 aFn;
attribute float aPart;
varying vec2 vFUv;
flat varying vec4 vFB;
flat varying vec4 vFC;
vec3 bP; vec3 bN;
void mzBuilding() {
  float w = iB.x, d = iB.y, h = iB.z;
  float mh = h > 11.0 ? 3.1 : (h > 7.0 ? 1.7 : 0.5);
  float rh = h > 11.0 ? 1.3 : 0.6;
  float he = h - mh - rh;
  float inset = mh * 0.3;
  vec2 hf = vec2(w, d) * 0.5;
  float lvl = position.y; vec2 sg = position.xz;
  float run = max(min(hf.x, hf.y) - inset, 0.05);
  vec3 p; vec3 n = vec3(aFn.x, 0.0, aFn.y);
  vec2 t = vec2(aFn.y, -aFn.x);
  float L = abs(t.x) * w + abs(t.y) * d;
  float vv = 0.0;
  if (aPart < 2.5) {
    if (lvl < 0.5) p = vec3(sg.x * hf.x, -4.0, sg.y * hf.y);
    else if (lvl < 1.5) p = vec3(sg.x * hf.x, he, sg.y * hf.y);
    else if (lvl < 2.5) p = vec3(sg.x * (hf.x - inset), he + mh, sg.y * (hf.y - inset));
    else p = vec3(sg.x * max(hf.x - inset - run, 0.0), he + mh + rh, sg.y * max(hf.y - inset - run, 0.0));
    if (aPart > 1.5) { n = normalize(n * rh + vec3(0.0, run, 0.0)); vFUv = p.xz; }
    else if (aPart > 0.5) { n = normalize(n * mh + vec3(0.0, inset, 0.0)); vFUv = vec2(dot(p.xz, t) + L * 0.5, (lvl - 1.0) * mh); }
    else vFUv = vec2(dot(p.xz, t) + L * 0.5, p.y);
  } else {
    float side = aPart < 3.5 ? -1.0 : 1.0;
    float sm = min(hf.x, hf.y), lg = max(hf.x, hf.y);
    float cs = sm < 3.6 ? 0.0 : (sm - inset - 0.9) * 0.7;
    float c = side * lg * (0.42 + 0.2 * fract(iB.w * 7.31 + side * 0.37));
    float th = cs > 0.0 ? 0.32 : 0.0;
    float y = lvl < 4.5 ? he + mh - 0.3 : he + mh + rh + 1.25;
    if (w >= d) p = vec3(c + sg.x * th, y, sg.y * cs); else p = vec3(sg.x * cs, y, c + sg.y * th);
    if (aFn == vec2(0.0)) n = vec3(0.0, 1.0, 0.0);
    L = abs(t.x) * (w >= d ? th : cs) * 2.0 + abs(t.y) * (w >= d ? cs : th) * 2.0;
    vFUv = vec2(dot(sg, t) * L * 0.5, y - (he + mh + rh + 1.25));
  }
  float cr = cos(iA.w), sr = sin(iA.w);
  bP = vec3(iA.x + p.x * cr + p.z * sr, iA.y + p.y, iA.z - p.x * sr + p.z * cr);
  bN = vec3(n.x * cr + n.z * sr, n.y, -n.x * sr + n.z * cr);
  vFB = vec4(L, he, iB.w, aPart);
  vFC = vec4(mh, w, d, h);
}`;

const FRAG_PARS = `
varying vec2 vFUv;
flat varying vec4 vFB;
flat varying vec4 vFC;
uniform float uNight;
uniform vec3 uSky;
float fH11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float fH21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float fNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fH21(i), fH21(i + vec2(1.0, 0.0)), f.x), mix(fH21(i + vec2(0.0, 1.0)), fH21(i + vec2(1.0)), f.x), f.y); }
float fBox(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
vec3 fS(vec3 c) { return c * c * (c * 0.305306011 + 0.682171111) + c * 0.012522878; }
vec3 fPal(float t) { // teintes de devantures / stores
  t = fract(t) * 6.0;
  if (t < 1.0) return vec3(0.42, 0.07, 0.09); if (t < 2.0) return vec3(0.08, 0.22, 0.14); if (t < 3.0) return vec3(0.07, 0.11, 0.24);
  if (t < 4.0) return vec3(0.06, 0.06, 0.07); if (t < 5.0) return vec3(0.36, 0.2, 0.09); return vec3(0.55, 0.42, 0.12);
}
// fenêtre à la française : retourne (masque vitrage, masque menuiserie)
vec2 fWindow(float bu, float y, float ww, float y0, float y1, float aw, float ah) {
  float inW = fBox(bu, -ww, ww, aw) * fBox(y, y0, y1, ah);
  float inner = fBox(bu, -ww + 0.07, ww - 0.07, aw) * fBox(y, y0 + 0.07, y1 - 0.07, ah);
  float mun = max(fBox(abs(bu), -1.0, 0.028, aw), fBox(y, mix(y0, y1, 0.68) - 0.025, mix(y0, y1, 0.68) + 0.025, ah));
  mun = max(mun, fBox(y, mix(y0, y1, 0.36) - 0.02, mix(y0, y1, 0.36) + 0.02, ah) * 0.8);
  float frame = max(1.0 - inner, mun * (1.0 - smoothstep(0.02, 0.08, aw)));
  return vec2(inW, clamp(frame, 0.0, 1.0));
}`;

const FRAG_MAIN = `
float fPart = vFB.w, fL = vFB.x, fHe = vFB.y, fSeed = vFB.z;
vec2 fuv = vFUv;
float aw = fwidth(fuv.x) * 0.7 + 1e-4, ah = fwidth(fuv.y) * 0.7 + 1e-4;
float fRough = 0.86, fGlass = 0.0; vec3 fEmis = vec3(0.0); vec3 fCol;
float t1 = fH11(fSeed), t2 = fH11(fSeed + 3.7), t3 = fH11(fSeed + 9.1);
vec3 stone = fS(mix(vec3(0.80, 0.725, 0.595), vec3(0.89, 0.835, 0.72), t1));
if (t2 > 0.9) stone = fS(mix(vec3(0.88, 0.86, 0.82), vec3(0.74, 0.62, 0.52), t3)); // enduit clair ou brique pâle
float nS = max(1.0, floor(fL / 5.4 + 0.5));
float nB = fL < 3.4 ? 1.0 : nS * 2.0;
float bw = fL / nB;
float bi = floor(fuv.x / bw), bu = fuv.x - (bi + 0.5) * bw;
float ww = min(0.62, bw * 0.27);
if (fPart < 0.5) {
  // ================= mur
  float rdc = fHe < 9.0 ? 3.3 : 4.4;
  float nF = max(1.0, floor((fHe - rdc) / 3.05 + 0.5));
  float fH = (fHe - rdc) / nF;
  float grime = fNoise(fuv * vec2(0.31, 0.11) + fSeed * 17.0), fine = fNoise(fuv * 11.0);
  float streak = fNoise(vec2(fuv.x * 2.3 + fSeed * 5.0, fuv.y * 0.18));
  fCol = stone * (0.84 + 0.2 * grime) * (0.955 + 0.09 * fine) * (0.93 + 0.1 * streak);
  if (fuv.y > rdc) {
    float fy = (fuv.y - rdc) / fH, fi = floor(fy), fv = (fy - fi) * fH;
    float balc = (fi == 1.0 && nF >= 4.0) || (fi == nF - 1.0 && nF >= 3.0) ? 1.0 : 0.0;
    float balcUp = (fi == 0.0 && nF >= 4.0) || (fi == nF - 2.0 && nF >= 3.0) ? 1.0 : 0.0;
    // refends au 1er étage
    if (fi < 0.5) fCol *= 1.0 - 0.2 * fBox(fract(fuv.y / 0.43), 0.0, 0.09, ah / 0.43) * (1.0 - smoothstep(0.05, 0.2, ah));
    // chaînes d'angle / trumeaux discrets
    fCol *= 1.0 - 0.06 * fBox(abs(bu), bw * 0.5 - 0.06, bw * 0.5 + 0.1, aw);
    // ombre sous bandeau / balcon de l'étage supérieur, corniche sommitale
    float top = fi == nF - 1.0 ? 1.0 : 0.0;
    fCol *= 1.0 - (0.2 + 0.3 * balcUp + 0.15 * top) * smoothstep(fH - 0.5 - 0.5 * balcUp, fH, fv);
    // bandeau d'étage (ou dalle de balcon)
    float band = fBox(fv, -0.05, 0.2, ah);
    fCol = mix(fCol, stone * 1.06, band * 0.85);
    fCol = mix(fCol, stone * (0.5 + 0.6 * smoothstep(fH - 0.42, fH - 0.1, fv)), top * fBox(fv, fH - 0.42, fH + 0.1, ah) * 0.85);
    // fenêtre
    float wy0 = 0.26 - 0.1 * balc, wy1 = fH - 0.62;
    float surround = fBox(bu, -ww - 0.17, ww + 0.17, aw) * fBox(fv, wy0 - 0.04, wy1 + 0.2, ah);
    fCol = mix(fCol, stone * 1.09, surround * 0.75);
    fCol = mix(fCol, stone * 0.7, fBox(bu, -ww - 0.24, ww + 0.24, aw) * fBox(fv, wy1 + 0.2, wy1 + 0.27, ah) * 0.7); // ombre du linteau saillant
    vec2 win = fWindow(bu, fv, ww, wy0, wy1, aw, ah);
    float wid = fH21(vec2(bi + fSeed * 13.0, fi + fSeed * 7.0 + fL));
    float wid2 = fract(wid * 17.31);
    vec3 glass = mix(vec3(0.012, 0.016, 0.02), vec3(0.06, 0.065, 0.07), wid);
    // voilages / rideaux
    float curt = step(0.45, wid) * fBox(abs(bu), ww * (0.25 + 0.5 * wid2), ww, aw);
    glass = mix(glass, vec3(0.42, 0.4, 0.36) * (0.5 + 0.5 * wid2), curt * 0.6);
    // embrasure : ombre portée du tableau (haut + un côté)
    float rec = 1.0 - 0.6 * smoothstep(wy1 - 0.3, wy1, fv);
    rec *= 1.0 - 0.35 * smoothstep(ww - 0.22, ww, bu);
    vec3 frameC = vec3(0.78, 0.77, 0.73) * (0.75 + 0.25 * t3);
    vec3 wc = mix(glass, frameC, win.y) * rec;
    float lit = step(1.0 - 0.42 * uNight, wid2 * 0.999) * uNight;
    vec3 warm = mix(vec3(1.0, 0.66, 0.3), vec3(1.0, 0.86, 0.62), wid) * (0.45 + 0.6 * wid2);
    if (wid > 0.93) warm = vec3(0.4, 0.55, 1.0) * 0.6;
    fEmis += win.x * (1.0 - win.y) * lit * warm * (0.75 + 0.25 * curt) * (0.6 + 0.4 * fNoise(vec2(bu * 3.0, fv * 2.0) + wid * 31.0));
    fCol = mix(fCol, wc, win.x);
    fGlass = win.x * (1.0 - win.y) * (1.0 - curt * 0.7) * (1.0 - lit);
    fRough = mix(fRough, mix(0.1, 0.55, win.y), win.x);
    // garde-corps en fonte (filant aux étages nobles)
    float rTop = wy0 + 0.92;
    float zone = mix(fBox(bu, -ww - 0.04, ww + 0.04, aw) * fBox(fv, wy0, rTop, ah), fBox(fv, 0.12, rTop + 0.04, ah), balc);
    float bars = fBox(fract(fuv.x * 7.5), 0.0, 0.24, aw * 7.5);
    float motif = fBox(fract(fv * 5.0 + 0.3), 0.0, 0.2, ah * 5.0) * step(0.5, fract(fuv.x * 3.75));
    float rails = max(fBox(fv, rTop - 0.05, rTop + 0.04, ah), fBox(fv, wy0 + 0.1 * balc, wy0 + 0.05 + 0.1 * balc, ah));
    float iron = max(max(bars, motif * 0.8) * 0.85, rails);
    iron = mix(iron, 0.42, smoothstep(0.03, 0.12, aw));
    fCol = mix(fCol, vec3(0.012, 0.014, 0.016), zone * iron);
    fEmis *= 1.0 - zone * iron;
    fGlass *= 1.0 - zone * iron;
    // console / ombre de la dalle de balcon
    fCol *= 1.0 - 0.25 * balc * fBox(fv, 0.0, 0.12, ah);
  } else {
    // ================= rez-de-chaussée
    float y = fuv.y;
    float sw = fL / nS, si = floor(fuv.x / sw), sx = fuv.x - (si + 0.5) * sw;
    float sh = fH21(vec2(si + 1.0, fSeed * 91.0 + fL)), sh2 = fract(sh * 23.7), sh3 = fract(sh * 91.3);
    // refends + soubassement
    fCol *= 1.0 - 0.2 * fBox(fract(y / 0.46), 0.0, 0.085, ah / 0.46) * (1.0 - smoothstep(0.05, 0.2, ah));
    fCol = mix(fCol, stone * 0.62, fBox(y, -9.0, 0.5, ah) * 0.7);
    // entablement sous le 1er étage
    fCol = mix(fCol, stone * 1.05, fBox(y, rdc - 0.3, rdc + 0.1, ah) * 0.8);
    fCol *= 1.0 - 0.3 * fBox(y, rdc - 0.42, rdc - 0.3, ah);
    float pil = 0.34;
    float inShop = fBox(sx, -sw * 0.5 + pil, sw * 0.5 - pil, aw) * fBox(y, 0.0, rdc - 0.5, ah);
    if (fL < 3.4) inShop = 0.0;
    if (sh < 0.66) {
      // ---- boutique
      vec3 sc = fPal(sh2 * 5.99 + fSeed);
      vec3 c = sc * (0.8 + 0.4 * fNoise(fuv * 3.0));
      float signY0 = rdc - 1.25, glassTop = signY0 - 0.06;
      // vitrine
      float gl = fBox(y, 0.55, glassTop, ah) * fBox(abs(sx), -1.0, sw * 0.5 - pil - 0.12, aw);
      float mull = max(fBox(fract((sx + sw * 0.5) / 1.35), 0.0, 0.045, aw / 1.35), fBox(y, glassTop - 0.55, glassTop - 0.5, ah));
      // porte
      float door = fBox(sx - (sh3 - 0.5) * sw * 0.5, -0.5, 0.5, aw) * fBox(y, 0.06, 2.25, ah);
      gl = max(gl * (1.0 - mull), door * fBox(abs(sx - (sh3 - 0.5) * sw * 0.5), -1.0, 0.42, aw) * fBox(y, 0.2, 2.15, ah));
      // intérieur : fond sombre, présentoir et articles colorés
      vec2 cell = vec2(sx / 0.34 + si * 3.0, y / 0.3), ci = floor(cell), cf = fract(cell);
      float item = step(0.3, fH21(ci + fSeed)) * fBox(cf.x, 0.16, 0.84, aw / 0.34) * fBox(cf.y, 0.0, 0.3 + 0.6 * fH21(ci + 7.0), ah / 0.3) * fBox(y, 0.62, 1.78, ah) * (1.0 - smoothstep(0.04, 0.14, aw));
      vec3 itemC = 0.1 + 1.1 * fPal(fH21(ci + 3.0) * 5.99 + sh3 * 3.0) + 0.25 * fH21(ci + 11.0);
      vec3 inside = vec3(0.022, 0.022, 0.025) * (1.0 + 3.0 * smoothstep(2.6, 0.6, y)) * (0.7 + 0.6 * fNoise(vec2(sx * 2.5 + si * 9.0, y * 2.0)));
      inside = mix(inside, itemC * 0.55, item);
      inside = mix(inside, vec3(0.28, 0.24, 0.19), fBox(y, 0.55, 0.62, ah) * 0.8);
      c = mix(c, inside, gl);
      fEmis += gl * uNight * step(sh3, 0.8) * mix(vec3(1.0, 0.8, 0.52), fPal(sh3 * 3.0 + bi) + 0.5, 0.25) * (0.1 + 0.3 * fNoise(vec2(sx * 1.7 + si * 3.0, y * 1.3)) + 0.5 * item * itemC) * (0.5 + 0.5 * smoothstep(0.5, 1.6, y));
      fGlass = gl * inShop * (1.0 - uNight * 0.8);
      // enseigne
      float sgnB = fBox(y, signY0, rdc - 0.52, ah);
      float letters = fBox(y, signY0 + 0.2, rdc - 0.74, ah) * fBox(abs(sx), -1.0, sw * (0.16 + 0.14 * sh2), aw) * step(0.42, fNoise(vec2(sx * 7.0 + si * 13.0, 0.5))) * (1.0 - smoothstep(0.04, 0.12, aw));
      c = mix(c, sc * 0.85, sgnB);
      c = mix(c, mix(vec3(0.85, 0.7, 0.32), vec3(0.9), step(0.5, sh3)), letters);
      // store banne
      if (sh2 < 0.6) {
        float ay0 = signY0 - 0.75 + 0.07 * cos(sx * 12.0), ay1 = signY0 + 0.02;
        float aw_ = fBox(y, ay0, ay1, ah) * fBox(abs(sx), -1.0, sw * 0.5 - pil + 0.1, aw);
        vec3 ac = fPal(sh3 * 5.99 + 2.0) * 1.5 + 0.04;
        if (sh3 > 0.5) ac = mix(ac, vec3(0.82, 0.78, 0.68), step(0.5, fract(sx * 2.2)) * (1.0 - smoothstep(0.1, 0.3, aw)));
        ac *= 0.62 + 0.5 * smoothstep(ay0, ay1, y);
        c *= 1.0 - 0.45 * fBox(y, ay0 - 0.55, ay0, 0.2) * (1.0 - aw_);
        c = mix(c, ac, aw_);
        fEmis *= 1.0 - aw_; fGlass *= 1.0 - aw_;
        fRough = mix(fRough, 0.95, aw_);
      }
      fRough = mix(fRough, mix(0.5, 0.1, gl), inShop);
      fCol = mix(fCol, c, inShop);
      fEmis *= inShop;
    } else if (sh < 0.8) {
      // ---- porte cochère
      vec3 dc = fPal(sh2 * 2.99 + 0.02) * 0.9;
      float dh = min(rdc - 0.95, 3.5), dwid = min(1.35, sw * 0.5 - 0.6);
      float arch = y - (dh - dwid) > 0.0 ? length(vec2(sx, y - (dh - dwid))) : abs(sx);
      float din = (1.0 - smoothstep(dwid - aw, dwid + aw, arch)) * fBox(y, 0.0, dh + 0.1, ah);
      float dsur = (1.0 - smoothstep(dwid + 0.22 - aw, dwid + 0.22 + aw, arch)) * fBox(y, 0.0, dh + 0.4, ah);
      fCol = mix(fCol, stone * 1.08, dsur * 0.8);
      float panel = fBox(abs(abs(sx) - dwid * 0.5), -1.0, dwid * 0.33, aw) * max(fBox(y, 0.25, 1.05, ah), fBox(y, 1.25, dh - dwid * 0.6, ah));
      vec3 dcol = dc * (0.75 + 0.35 * panel) * (1.0 - 0.6 * fBox(abs(sx), -1.0, 0.02, aw));
      dcol *= 1.0 - 0.5 * smoothstep(dh - 0.5, dh, y);
      fCol = mix(fCol, dcol, din);
      fRough = mix(fRough, 0.45, din);
      fEmis = vec3(0.0);
    } else {
      // ---- mur à fenêtres (logements / bureaux au rez-de-chaussée)
      vec2 win = fWindow(bu, y, ww, 1.15, rdc - 1.0, aw, ah);
      float surround = fBox(bu, -ww - 0.15, ww + 0.15, aw) * fBox(y, 1.05, rdc - 0.82, ah);
      fCol = mix(fCol, stone * 1.08, surround * 0.7);
      float wid = fH21(vec2(bi + fSeed * 3.0, 77.0));
      vec3 wc = mix(vec3(0.02, 0.025, 0.03), vec3(0.7, 0.69, 0.66), win.y) * (1.0 - 0.5 * smoothstep(rdc - 1.3, rdc - 1.0, y));
      // barreaux
      float bars = fBox(fract(fuv.x * 9.0), 0.0, 0.2, aw * 9.0) * (1.0 - smoothstep(0.03, 0.1, aw));
      wc = mix(wc, vec3(0.015), bars * 0.8);
      fEmis += win.x * (1.0 - win.y) * step(0.7, wid) * uNight * vec3(1.0, 0.75, 0.42) * 0.6;
      fCol = mix(fCol, wc, win.x);
      fGlass = win.x * (1.0 - win.y) * (1.0 - bars) * 0.7;
      fRough = mix(fRough, 0.15, win.x * (1.0 - win.y));
    }
  }
  // la nuit : lueur chaude des réverbères sur le bas des façades (pas de PointLight)
  fEmis += fCol * vec3(1.0, 0.68, 0.36) * uNight * 0.2 * (1.0 - smoothstep(0.5, 11.0, fuv.y));
  // salissure en pied de façade + assombrissement de rue étroite
  fCol *= mix(0.74, 1.0, smoothstep(0.0, 1.4, fuv.y)) * mix(0.9, 1.0, smoothstep(0.0, 14.0, fuv.y));
} else if (fPart < 1.5) {
  // ================= brisis de mansarde (zinc / ardoise) + lucarnes
  float mh = vFC.x;
  vec3 zinc = fS(mix(vec3(0.40, 0.44, 0.49), vec3(0.50, 0.54, 0.58), t3));
  if (t2 < 0.35) zinc = fS(mix(vec3(0.24, 0.26, 0.30), vec3(0.32, 0.34, 0.38), t3)); // ardoise
  float seams = fBox(fract(fuv.x / 0.62), 0.0, 0.07, aw / 0.62) * (1.0 - smoothstep(0.04, 0.15, aw));
  float rows = t2 < 0.35 ? fBox(fract(fuv.y / 0.28), 0.0, 0.12, ah / 0.28) * (1.0 - smoothstep(0.03, 0.1, ah)) : 0.0;
  fCol = zinc * (0.86 + 0.22 * fNoise(fuv * vec2(1.5, 0.4) + fSeed)) * (1.0 - 0.3 * seams) * (1.0 - 0.25 * rows);
  fRough = 0.5;
  // corniche / chéneau en pied
  fCol = mix(fCol, stone * 1.02, fBox(fuv.y, -1.0, 0.22, ah));
  fCol *= 1.0 - 0.3 * fBox(fuv.y, 0.22, 0.34, ah);
  if (mh > 2.5) {
    float ly0 = 0.5, ly1 = mh - 0.7, lw = min(0.5, bw * 0.24);
    float body = fBox(bu, -lw - 0.16, lw + 0.16, aw) * fBox(fuv.y, ly0 - 0.1, ly1 + 0.12, ah);
    float ped = fBox(fuv.y, ly1 + 0.12, ly1 + 0.5, ah) * (1.0 - smoothstep(-aw, aw, abs(bu) - (lw + 0.3) * (1.0 - (fuv.y - ly1 - 0.12) / 0.4)));
    vec3 lc = stone * 1.04;
    if (t2 < 0.35) lc = zinc * 1.25;
    fCol = mix(fCol, lc, max(body, ped));
    fCol *= 1.0 - 0.3 * fBox(bu, lw + 0.16, lw + 0.4, aw) * fBox(fuv.y, ly0, ly1, ah); // ombre de la joue
    vec2 win = fWindow(bu, fuv.y, lw, ly0, ly1, aw, ah);
    float wid = fH21(vec2(bi + fSeed * 5.0, 99.0 + fL)), wid2 = fract(wid * 17.31);
    vec3 wc = mix(mix(vec3(0.012, 0.016, 0.02), vec3(0.07), wid), vec3(0.76, 0.75, 0.71), win.y) * (1.0 - 0.5 * smoothstep(ly1 - 0.25, ly1, fuv.y));
    float lit = step(1.0 - 0.38 * uNight, wid2 * 0.999) * uNight;
    fEmis += win.x * (1.0 - win.y) * lit * mix(vec3(1.0, 0.66, 0.3), vec3(1.0, 0.86, 0.62), wid) * 0.7;
    fCol = mix(fCol, wc, win.x);
    fGlass = win.x * (1.0 - win.y) * (1.0 - lit);
    fRough = mix(fRough, 0.12, fGlass);
  }
} else if (fPart < 2.5) {
  // ================= terrasson (zinc à tasseaux)
  vec3 zinc = fS(mix(vec3(0.47, 0.50, 0.54), vec3(0.58, 0.61, 0.64), t3));
  float su = vFC.y >= vFC.z ? fuv.x : fuv.y;
  float seams = fBox(fract(su / 0.65), 0.0, 0.08, fwidth(su) / 0.65) * (1.0 - smoothstep(0.04, 0.2, fwidth(su)));
  fCol = zinc * (0.84 + 0.26 * fNoise(fuv * 0.6 + fSeed * 3.0)) * (1.0 - 0.28 * seams);
  fRough = 0.48;
} else {
  // ================= souche de cheminée + mitrons
  vec3 plaster = fS(mix(vec3(0.70, 0.64, 0.54), vec3(0.80, 0.74, 0.64), t3));
  fCol = plaster * (0.8 + 0.3 * fNoise(fuv * vec2(2.0, 1.0) + fSeed));
  float yy = -fuv.y; // distance sous le sommet
  if (yy < 0.42) {
    float pot = fBox(fract(fuv.x / 0.42 + 0.5), 0.2, 0.8, aw / 0.42);
    if (pot < 0.5 && aw < 0.2) discard;
    fCol = mix(fCol, fS(vec3(0.66, 0.36, 0.24)) * (0.7 + 0.5 * fNoise(fuv * 5.0)), smoothstep(0.0, 0.2, 0.2 - aw));
  } else fCol *= 1.0 - 0.3 * fBox(yy, 0.42, 0.55, ah);
}
diffuseColor.rgb = fCol;
`;

export function createBuildingMaterial(THREE, uniforms) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight; sh.uniforms.uSky = uniforms.uSky;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <beginnormal_vertex>', 'mzBuilding();\nvec3 objectNormal = bN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = bP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <map_fragment>', FRAG_MAIN)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmis;')
      .replace('#include <opaque_fragment>', `
{
  vec3 vv = normalize(vViewPosition);
  float ndv = saturate(dot(normal, vv));
  float fres = 0.05 + 0.95 * pow(1.0 - ndv, 4.0);
  // direction réfléchie en repère monde : vers le haut = ciel, à l'horizontale = façades d'en face
  vec3 rw = (vec4(reflect(-vv, normal), 0.0) * viewMatrix).xyz;
  float skyLum = dot(uSky, vec3(0.3, 0.5, 0.2));
  vec3 refl = mix(vec3(0.33, 0.29, 0.23) * skyLum, uSky, smoothstep(0.02, 0.4, rw.y + 0.12 * sin(vFUv.x * 1.3 + vFB.z)));
  outgoingLight = mix(outgoingLight, refl, fGlass * (0.1 + 0.75 * fres));
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'mz-building';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', 'mzBuilding();\nvec3 transformed = bP;');
  };
  depth.customProgramCacheKey = () => 'mz-building-depth';
  return { mat, depth };
}

// ---------- test de recouvrement de rectangles orientés (SAT)
function obbOverlap(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const axes = [[a.c, -a.s], [a.s, a.c], [b.c, -b.s], [b.s, b.c]];
  for (const [ux, uz] of axes) {
    const ra = a.hw * Math.abs(a.c * ux - a.s * uz) + a.hd * Math.abs(a.s * ux + a.c * uz);
    const rb = b.hw * Math.abs(b.c * ux - b.s * uz) + b.hd * Math.abs(b.s * ux + b.c * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}

/** Génère des immeubles le long des rues quand buildings.json est absent. Retourne un tableau plat [cx,cz,w,d,rotDeg,h]. */
function proceduralBuildings(ctx, net, masks) {
  const { LANDMARKS, BOUNDS } = ctx;
  const out = [], rnd = mulberry32(20261111);
  const grid = new Map(), GC = 40;
  const gk = (x, z) => (Math.floor(x / GC) + 1024) * 2048 + (Math.floor(z / GC) + 1024);
  const o = { _k: 0 };
  const blocked = (x, z, pad) => net.edgeDistance(x, z, true) < pad || masks.nearWater(x, z, 4) || masks.isPark(x, z);
  const tryAdd = (x, z, w, d, rot, h) => {
    if (x < BOUNDS.minX - 80 || x > BOUNDS.maxX + 80 || z < BOUNDS.minZ - 80 || z > BOUNDS.maxZ + 80) return false;
    for (const l of LANDMARKS) if (Math.hypot(x - l.x, z - l.z) < l.radius + Math.max(w, d) * 0.6) return false;
    const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
    for (const [lx, lz] of [[0, 0], [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, -hd], [0, hd], [-hw, 0], [hw, 0]]) {
      if (blocked(x + lx * c + lz * s, z - lx * s + lz * c, 1.6)) return false;
    }
    const box = { x, z, hw: hw - 0.4, hd: hd - 0.4, c, s };
    const r = Math.hypot(hw, hd);
    const x0 = Math.floor((x - r) / GC), x1 = Math.floor((x + r) / GC), z0 = Math.floor((z - r) / GC), z1 = Math.floor((z + r) / GC);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) { const a = grid.get((ix + 1024) * 2048 + iz + 1024); if (a) for (const b of a) if (obbOverlap(box, b)) return false; }
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) { const k = (ix + 1024) * 2048 + iz + 1024; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(box); }
    out.push(x, z, w, d, (rot * 180) / Math.PI, h);
    return true;
  };
  // grandes artères d'abord (elles imposent l'alignement)
  const order = [...net.roads].filter((r) => !r._ped || r.width > 3).sort((a, b) => b.width - a.width);
  for (const r of order) {
    const big = r.kind === 'avenue' || r.kind === 'boulevard';
    for (const sg of [1, -1]) {
      let s = 2 + rnd() * 3;
      while (s < r._len - 6) {
        const w = 11 + rnd() * 13, d = 11 + rnd() * 5, h = (big ? 21 : 16) + rnd() * 6;
        const off = r._hw + r._sw + 1.0 + d / 2;
        net.pointAt(r, s + w / 2, sg * off, o);
        // rot : X local le long de la rue
        const rot = Math.atan2(-o.dz, o.dx);
        if (tryAdd(o.x, o.z, w, d, rot, h)) s += w + 0.05; else s += 3;
      }
    }
  }
  return out;
}

/** Tissu urbain de remplissage au-delà de l'emprise des données (pour l'horizon). Tableau plat [cx,cz,w,d,rotDeg,h]. */
function fillerBuildings(ctx, masks) {
  const { BOUNDS } = ctx;
  const out = [], rnd = mulberry32(99173);
  const ang = (-24 * Math.PI) / 180, c = Math.cos(ang), s = Math.sin(ang);
  const cx = (BOUNDS.minX + BOUNDS.maxX) / 2, cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
  const BW = 78, BD = 46, GAP = 13, R = 5200;
  const inData = (x, z) => x > BOUNDS.minX - 150 && x < BOUNDS.maxX + 150 && z > BOUNDS.minZ - 150 && z < BOUNDS.maxZ + 150;
  const inMask = (x, z) => x > masks.x0 + 30 && x < masks.x0 + masks.sizeX - 30 && z > masks.z0 + 30 && z < masks.z0 + masks.sizeZ - 30;
  for (let u = -R; u < R; u += BW + GAP) for (let v = -R; v < R; v += BD + GAP) {
    const bx = cx + u * c + v * s, bz = cz - u * s + v * c;
    if (!inMask(bx, bz) || inData(bx, bz)) continue;
    if (rnd() < 0.08) continue; // quelques vides (squares, cours)
    const n = 3, h0 = 15 + rnd() * 7;
    for (let i = 0; i < n; i++) {
      const lu = u + (i + 0.5 - n / 2) * (BW / n), w = BW / n, x = cx + lu * c + v * s, z = cz - lu * s + v * c;
      if (inData(x, z) || masks.nearWater(x, z, 30)) continue;
      out.push(x, z, w, BD, (ang * 180) / Math.PI, h0 + rnd() * 5);
    }
  }
  return out;
}

export function buildBuildings(ctx, net, masks, Q, uniforms) {
  const { THREE, scene, heightAt, collision, LANDMARKS, worldData } = ctx;
  let src = worldData.buildings;
  const procedural = !src || !src.length;
  if (procedural) src = proceduralBuildings(ctx, net, masks);
  const tiles = new Map();
  const occ = new Map(), OC = 32; // occupation (pour éviter arbres/mobilier dans les immeubles)
  let kept = 0;
  const addAll = (src, real, filler) => {
    const n = Math.floor(src.length / 6);
    for (let i = 0; i < n; i++) {
      let x = src[i * 6], z = src[i * 6 + 1], w = src[i * 6 + 2], d = src[i * 6 + 3], h = src[i * 6 + 5];
      const rot = (src[i * 6 + 4] * Math.PI) / 180;
      if (!(w > 2.5 && d > 2.5) || !(h > 0)) continue;
      let skip = false;
      for (const l of LANDMARKS) { const lim = l.radius + Math.min(w, d) * 0.5; const dx = x - l.x, dz = z - l.z; if (dx * dx + dz * dz < lim * lim) { skip = true; break; } }
      if (skip) continue;
      h = Math.min(Math.max(h, 5), 75);
      const c = Math.cos(rot), s = Math.sin(rot);
      if (real) {
        // les données réelles sont des rectangles englobants : on rogne ceux qui mordent sur une chaussée
        let ok = false;
        for (let it = 0; it < 4 && !ok; it++) {
          ok = true;
          const hw = w / 2, hd = d / 2;
          // points de contrôle : centre + pourtour tous les ~4 m
          const nx = Math.max(2, Math.ceil(w / 4)), nz = Math.max(2, Math.ceil(d / 4));
          const bad = (lx, lz) => net.roadAtPad(x + lx * c + lz * s, z - lx * s + lz * c, 0.7, true);
          if (bad(0, 0)) ok = false;
          for (let k = 0; k <= nx && ok; k++) { const lx = -hw + (w * k) / nx; if (bad(lx, -hd) || bad(lx, hd)) ok = false; }
          for (let k = 1; k < nz && ok; k++) { const lz = -hd + (d * k) / nz; if (bad(-hw, lz) || bad(hw, lz)) ok = false; }
          if (!ok) { w *= 0.8; d *= 0.8; if (w < 4 || d < 4) break; }
        }
        if (!ok) continue;
        if (masks.isWater(x, z)) continue;
      }
      const hw = w / 2, hd = d / 2;
      let base = heightAt(x, z);
      for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) base = Math.min(base, heightAt(x + lx * c + lz * s, z - lx * s + lz * c));
      const seed = hash2(Math.round(x * 3), Math.round(z * 3)) * 100;
      const k = tileKey(x, z, 700);
      let t = tiles.get(k); if (!t) tiles.set(k, (t = { a: [], b: [], maxR: 0, minY: Infinity, maxY: -Infinity }));
      t.a.push(x, base, z, rot); t.b.push(w, d, h, seed);
      t.maxR = Math.max(t.maxR, Math.hypot(hw, hd)); t.minY = Math.min(t.minY, base - 4); t.maxY = Math.max(t.maxY, base + h + 2);
      collision.addBox({ x, z, hw, hd, rot, top: base + h, tag: 'building' });
      if (filler) continue;
      // occupation
      const r = Math.hypot(hw, hd), ob = { x, z, hw, hd, c, s };
      for (let ix = Math.floor((x - r) / OC); ix <= Math.floor((x + r) / OC); ix++) for (let iz = Math.floor((z - r) / OC); iz <= Math.floor((z + r) / OC); iz++) {
        const kk = (ix + 1024) * 2048 + iz + 1024; let a = occ.get(kk); if (!a) occ.set(kk, (a = [])); a.push(ob);
      }
      kept++;
    }
  };
  addAll(src, !procedural, false);
  if (worldData.meta?.source !== 'sample') addAll(fillerBuildings(ctx, masks), false, true);
  /** Le point (avec marge) est-il dans un immeuble ? */
  function inBuilding(x, z, pad = 0) {
    const a = occ.get((Math.floor(x / OC) + 1024) * 2048 + Math.floor(z / OC) + 1024); if (!a) return false;
    for (const b of a) {
      const dx = x - b.x, dz = z - b.z, lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
      if (Math.abs(lx) < b.hw + pad && Math.abs(lz) < b.hd + pad) return true;
    }
    return false;
  }

  const unit = unitGeometry(THREE);
  const { mat, depth } = createBuildingMaterial(THREE, uniforms);
  const meshes = [];
  for (const [k, t] of tiles) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', unit.position); g.setAttribute('aFn', unit.aFn); g.setAttribute('aPart', unit.aPart);
    g.setIndex(unit.index);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(t.a), 4));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(t.b), 4));
    g.instanceCount = t.a.length / 4;
    // sphère englobante réelle de la tuile
    let cx = 0, cz = 0; const cnt = t.a.length / 4;
    for (let i = 0; i < cnt; i++) { cx += t.a[i * 4]; cz += t.a[i * 4 + 2]; }
    cx /= cnt; cz /= cnt; const cy = (t.minY + t.maxY) / 2;
    let r2 = 0; for (let i = 0; i < cnt; i++) r2 = Math.max(r2, (t.a[i * 4] - cx) ** 2 + (t.a[i * 4 + 2] - cz) ** 2);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), Math.hypot(Math.sqrt(r2) + t.maxR, (t.maxY - t.minY) / 2));
    const m = new THREE.Mesh(g, mat);
    m.customDepthMaterial = depth;
    m.castShadow = Q.shadows; m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'immeubles';
    m.userData.center = g.boundingSphere.center; m.userData.radius = g.boundingSphere.radius;
    scene.add(m); meshes.push(m);
  }
  return {
    meshes, count: kept, procedural, inBuilding,
    update(cam) {
      for (const m of meshes) {
        const c = m.userData.center, dist = Math.hypot(c.x - cam.x, c.z - cam.z) - m.userData.radius;
        m.visible = dist < Q.viewDist;
        if (m.visible) m.geometry.setDrawRange(0, Q.chimneys && dist < Q.detailDist ? unit.indexCount : BASE_INDEX_COUNT);
      }
    },
  };
}

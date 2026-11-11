// Shaders des immeubles (GLSL injecté dans MeshStandardMaterial via onBeforeCompile).
//
// Deux géométries partagent le même programme :
//  - le GABARIT (parts 0..4) : murs, brisis, terrasson, 2 souches de cheminée — toutes distances ;
//  - les DÉTAILS (parts 5..9) : dalles de balcon, garde-corps, corniche, stores bannes, lucarnes en volume —
//    seulement pour les immeubles proches (LOD), positionnés dans le vertex shader à partir des mêmes
//    2-3 vec4 par immeuble.
// Le relief des baies (fenêtres, vitrines, portes cochères en retrait dans l'épaisseur du mur) et les pièces
// derrière les vitres (interior mapping) sont calculés analytiquement dans le fragment shader : intersection
// rayon/boîte exacte, sans marche de rayon, donc stable en mouvement ; le relief s'efface avec la taille du pixel.

// ------------------------------------------------------------------ commun vertex + fragment
export const COMMON = `
void mzRoof(float h, float style, out float mh, out float rh) {
  mh = h > 11.0 ? 3.1 : (h > 7.0 ? 1.7 : 0.5);
  rh = h > 11.0 ? 1.3 : 0.6;
  if (style > 2.5) { mh = 1.0; rh = 0.2; } // Art déco / moderne : attique et toit-terrasse
}
// Styles ≥ 5 (Toulouse) : la hauteur des données est celle de l'ÉGOUT ; le toit vient par-dessus, selon son type :
// 1 quatre pentes en tuiles, 2 deux pentes en tuiles, 3 terrasse (acrotère), 4 deux pentes en bac acier, 5 quatre pentes en ardoise.
// (même formule que roofRise() dans buildings.js)
void mzRoofT(float w, float d, float rt, out float mh, out float rh) {
  float m = min(w, d) * 0.5;
  if (rt > 2.5 && rt < 3.5) { mh = 0.35; rh = 0.02; }
  else if (rt > 3.5 && rt < 4.5) { mh = 0.0; rh = clamp(m * 0.12, 0.3, 2.5); }
  else { mh = 0.0; rh = clamp(m * 0.34, 0.45, 3.4); }
}
void mzLayout(float L, float he, float style, out float rdc, out float nF, out float fH, out float nS, out float nB, out float bw) {
  rdc = he < 9.0 ? 3.3 : 4.4;
  nF = max(1.0, floor((he - rdc) / 3.05 + 0.5));
  fH = (he - rdc) / nF;
  nS = max(1.0, floor(L / 5.4 + 0.5));
  nB = L < 3.4 ? 1.0 : nS * 2.0;
  bw = max(L, 0.01) / nB;
  if (style > 5.5) { // maisons, barres, hangars : rez-de-chaussée bas, étages de 2,8 m ; une baie par travée pour les maisons
    rdc = he < 4.6 ? he + 0.02 : 2.9;
    nF = max(1.0, floor((he - rdc) / 2.8 + 0.5)); fH = max((he - rdc) / nF, 0.05);
    if (style < 6.5 || style > 8.5) { nS = max(1.0, floor(L / 4.2 + 0.5)); nB = L < 3.0 ? 1.0 : nS; bw = max(L, 0.01) / nB; }
  }
}
float mzBalc(float fi, float nF, float style) { // balcon filant à l'étage fi ?
  if (style > 1.5) return 0.0;
  return ((fi == 1.0 && nF >= 4.0) || (fi == nF - 1.0 && nF >= 3.0)) ? 1.0 : 0.0;
}
float mzH21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// boutique i du mur : x = type (< 0.66 boutique, < 0.8 porte cochère, sinon mur à fenêtres), y,z = variations
vec3 mzShop(float si, float seed, float L) { float sh = mzH21(vec2(si + 1.0, seed * 91.0 + L)); return vec3(sh, fract(sh * 23.7), fract(sh * 91.3)); }
`;

// ------------------------------------------------------------------ vertex
export const VERT_PARS = COMMON + `
attribute vec4 iA;   // cx, base, cz, rot
attribute vec4 iB;   // w, d, h, graine
attribute vec4 iC;   // masque de faces mitoyennes, style, enfouissement, -
attribute vec2 aFn;  // normale de face (repère local)
attribute float aPart;
attribute float aSlot;
attribute vec3 aNrm; // normale des pièces de détail (tangente, haut, sortant)
varying vec2 vFUv;
varying vec3 vWP;
varying float vSub;
flat varying vec4 vFB;
flat varying vec4 vFC;
flat varying vec4 vFD;
flat varying vec4 vFT;
vec3 bP; vec3 bN;
void mzBuilding() {
  float w = iB.x, d = iB.y, h = iB.z, styleRaw = iC.y, rtp = iC.w;
  // styles ≥ 5 : rendus avec la modénature d'un style de base (5 → 1, maisons → 2, barres et hangars → 4)
  float style = styleRaw > 4.5 ? (styleRaw < 5.5 ? 1.0 : ((styleRaw < 6.5 || styleRaw > 8.5) ? 2.0 : 4.0)) : styleRaw;
  float mh, rh; if (styleRaw > 4.5) mzRoofT(w, d, rtp, mh, rh); else mzRoof(h, style, mh, rh);
  float gable = (styleRaw > 4.5 && (abs(rtp - 2.0) < 0.5 || abs(rtp - 4.0) < 0.5)) ? 1.0 : 0.0, gEnd = 0.0;
  float he = h - mh - rh;
  float inset = (style > 2.5 || styleRaw > 4.5) ? 0.0 : mh * 0.3;
  vec2 hf = vec2(w, d) * 0.5;
  vec3 n = vec3(aFn.x, 0.0, aFn.y);
  vec2 t = vec2(aFn.y, -aFn.x);
  float L = abs(t.x) * w + abs(t.y) * d;
  float fIdx = aFn.x > 0.5 ? 0.0 : (aFn.x < -0.5 ? 1.0 : (aFn.y > 0.5 ? 2.0 : 3.0));
  float blind = mod(floor(iC.x / exp2(fIdx)), 2.0);
  // LOD des détails : distance caméra → emprise de l'immeuble
  float dcam = max(0.0, length(cameraPosition.xz - iA.xz) - 0.5 * max(w, d));
  float lodF = 1.0 - smoothstep(MZ_LOD0, MZ_LOD1, dcam);
  vec3 p; vSub = 0.0;
  if (aPart < 2.5) {
    // ---------- gabarit : murs / brisis / terrasson
    float lvl = position.y; vec2 sg = position.xz;
    // pignon : pas de retrait du brisis sur une face mitoyenne (mur vertical jusqu'au faîte)
    float bx = mod(floor(iC.x / (sg.x > 0.0 ? 1.0 : 2.0)), 2.0), bz = mod(floor(iC.x / (sg.y > 0.0 ? 4.0 : 8.0)), 2.0);
    vec2 ins = vec2(bx > 0.5 ? 0.0 : inset, bz > 0.5 ? 0.0 : inset);
    float run = max(min(hf.x, hf.y) - inset, 0.05);
    if (lvl < 0.5) p = vec3(sg.x * hf.x, -iC.z, sg.y * hf.y);
    else if (lvl < 1.5) p = vec3(sg.x * hf.x, he, sg.y * hf.y);
    else if (lvl < 2.5) p = vec3(sg.x * (hf.x - ins.x), he + mh, sg.y * (hf.y - ins.y));
    else {
      vec2 top = vec2(max(hf.x - inset - run, 0.0), max(hf.y - inset - run, 0.0));
      if (gable > 0.5) { if (hf.x >= hf.y) top.x = hf.x; else top.y = hf.y; } // deux pentes : le faîte va d'un pignon à l'autre
      p = vec3(sg.x * top.x, he + mh + rh, sg.y * top.y);
    }
    if (aPart > 1.5 && gable > 0.5 && ((hf.x >= hf.y) ? abs(aFn.x) : abs(aFn.y)) > 0.5) { gEnd = 1.0; vFUv = vec2(dot(p.xz, t) + L * 0.5, p.y); } // pignon (mur)
    else if (aPart > 1.5) { n = normalize(n * rh + vec3(0.0, run, 0.0)); vFUv = p.xz; }
    else if (aPart > 0.5) { if (blind < 0.5 && inset > 0.0) n = normalize(n * mh + vec3(0.0, inset, 0.0)); vFUv = vec2(dot(p.xz, t) + L * 0.5, he + (lvl - 1.0) * mh); }
    else vFUv = vec2(dot(p.xz, t) + L * 0.5, p.y);
  } else if (aPart < 4.5) {
    // ---------- souches de cheminée
    vec2 sg = position.xz; float lvl = position.y;
    float side = aPart < 3.5 ? -1.0 : 1.0;
    float sm = min(hf.x, hf.y), lg = max(hf.x, hf.y);
    float cs = (sm < 3.6 || style > 2.5 || styleRaw > 4.5) ? 0.0 : (sm - inset - 0.9) * 0.7;
    float c = side * lg * (0.42 + 0.2 * fract(iB.w * 7.31 + side * 0.37));
    float th = cs > 0.0 ? 0.32 : 0.0;
    float y = lvl < 4.5 ? he + mh - 0.3 : he + mh + rh + 1.25;
    if (w >= d) p = vec3(c + sg.x * th, y, sg.y * cs); else p = vec3(sg.x * cs, y, c + sg.y * th);
    if (aFn == vec2(0.0)) n = vec3(0.0, 1.0, 0.0);
    L = abs(t.x) * (w >= d ? th : cs) * 2.0 + abs(t.y) * (w >= d ? cs : th) * 2.0;
    vFUv = vec2(dot(sg, t) * L * 0.5, y - (he + mh + rh + 1.25));
  } else {
    // ---------- détails en volume (immeubles proches) : repère de façade (u le long du mur, y, o vers l'extérieur)
    float rdc, nF, fH, nS, nB, bw; mzLayout(L, he, styleRaw, rdc, nF, fH, nS, nB, bw);
    float a = position.x, b = position.y, c = position.z;
    float show = (1.0 - blind) * step(0.01, lodF) * step(3.4, L) * step(styleRaw, 5.5);
    float u = 0.0, y = 0.0, o = 0.0;
    if (aPart < 6.5) {            // 5 dalle de balcon, 6 garde-corps
      float fi = aSlot < 0.5 ? 1.0 : nF - 1.0;
      show *= mzBalc(fi, nF, style);
      float y0 = rdc + fi * fH;
      u = mix(0.22, L - 0.22, a); o = c * 0.62;
      y = aPart < 5.5 ? y0 + mix(-0.17, 0.03, b) : y0 + 0.03 + b * 0.97;
      if (aPart > 5.5) o = c * 0.58;
    } else if (aPart < 7.5) {     // 7 corniche
      show *= style > 3.5 ? 0.0 : 1.0;
      u = mix(-0.34, L + 0.34, a); y = he + mix(-0.42, 0.06, b); o = c * 0.42;
    } else if (aPart < 8.5) {     // 8 store banne (bande continue, découpée par boutique dans le fragment)
      u = mix(0.0, L, a); y = rdc - 1.22 - (1.0 - b) * 0.5; o = 0.04 + c * 0.95;
    } else {                      // 9 lucarnes
      float stride = max(1.0, ceil(nB / 12.0)), i = aSlot * stride;
      show *= step(i + 0.5, nB) * step(2.5, mh) * step(style, 2.5);
      float lw = min(0.5, bw * 0.24) + 0.17;
      u = (i + 0.5) * bw + (a * 2.0 - 1.0) * lw; y = he + mix(0.42, mh - 0.5, b); o = mix(-0.08, -(inset + 0.25), c);
    }
    o *= lodF; vSub = aNrm.z > 0.5 ? 0.0 : (abs(aNrm.y) > 0.5 ? (aNrm.y > 0.0 ? 2.0 : 3.0) : 1.0);
    float hfn = abs(aFn.x) * hf.x + abs(aFn.y) * hf.y;
    vec2 xz = aFn * (hfn + o) + t * (u - L * 0.5);
    p = show > 0.5 ? vec3(xz.x, y, xz.y) : vec3(0.0, -20.0, 0.0);
    n = vec3(t.x * aNrm.x + aFn.x * aNrm.z, aNrm.y, t.y * aNrm.x + aFn.y * aNrm.z);
    vFUv = vec2(u, y);
  }
  float cr = cos(iA.w), sr = sin(iA.w);
  bP = vec3(iA.x + p.x * cr + p.z * sr, iA.y + p.y, iA.z - p.x * sr + p.z * cr);
  bN = vec3(n.x * cr + n.z * sr, n.y, -n.x * sr + n.z * cr);
  vWP = bP;
  vFB = vec4(L, he, iB.w, aPart);
  vFC = vec4(mh, w, d, h);
  vFD = vec4(blind, styleRaw, lodF, styleRaw > 4.5 ? rtp + 10.0 * gEnd : 0.0);
  vFT = vec4(t.x * cr + t.y * sr, -t.x * sr + t.y * cr, aFn.x * cr + aFn.y * sr, -aFn.x * sr + aFn.y * cr);
}`;

// ------------------------------------------------------------------ fragment : déclarations
export const FRAG_PARS = COMMON + `
varying vec2 vFUv;
varying vec3 vWP;
varying float vSub;
flat varying vec4 vFB;
flat varying vec4 vFC;
flat varying vec4 vFD;
flat varying vec4 vFT;
uniform float uNight;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform float uSunK;
float fH11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float fH21(vec2 p) { return mzH21(p); }
float fNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fH21(i), fH21(i + vec2(1.0, 0.0)), f.x), mix(fH21(i + vec2(0.0, 1.0)), fH21(i + vec2(1.0)), f.x), f.y); }
float fBox(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
vec3 fS(vec3 c) { return c * c * (c * 0.305306011 + 0.682171111) + c * 0.012522878; }
float fIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 fPal(float t) { // teintes de devantures / stores
  t = fract(t) * 6.0;
  if (t < 1.0) return vec3(0.42, 0.07, 0.09); if (t < 2.0) return vec3(0.08, 0.22, 0.14); if (t < 3.0) return vec3(0.07, 0.11, 0.24);
  if (t < 4.0) return vec3(0.06, 0.06, 0.07); if (t < 5.0) return vec3(0.36, 0.2, 0.09); return vec3(0.55, 0.42, 0.12);
}
// menuiserie d'une fenêtre à la française : 1 = bois (dormant, montants, petits bois), 0 = vitre
float fFrame(float bu, float y, float ww, float y0, float y1, float aw, float ah) {
  float inner = fBox(bu, -ww + 0.07, ww - 0.07, aw) * fBox(y, y0 + 0.07, y1 - 0.07, ah);
  float mun = max(fBox(abs(bu), -1.0, 0.028, aw), fBox(y, mix(y0, y1, 0.68) - 0.025, mix(y0, y1, 0.68) + 0.025, ah));
  mun = max(mun, fBox(y, mix(y0, y1, 0.36) - 0.02, mix(y0, y1, 0.36) + 0.02, ah) * 0.8);
  return clamp(max(1.0 - inner, mun * (1.0 - smoothstep(0.02, 0.08, aw))), 0.0, 1.0);
}
// ferronnerie d'un garde-corps (u le long du mur, v = hauteur 0..1 m) : couverture 0..1.
// Le motif se simplifie avec la distance (barreaux plus espacés et plus épais, volutes supprimées) pour rester
// résoluble à l'écran : pas de tramage ni de scintillement.
float fIron(float u, float v, float aw, float ah) {
  float k = exp2(clamp(ceil(log2(max(aw, 1e-4) / 0.011)), 0.0, 4.0));
  float rw = max(0.035, 1.3 * ah);
  float rails = max(fBox(v, 0.965 - rw, 0.965 + rw, ah), fBox(v, 0.07 - rw * 0.7, 0.07 + rw * 0.7, ah));
  rails = max(rails, fBox(v, 0.2, 0.235, ah) * step(k, 1.5));
  float sp = 0.132 * k;
  float bars = fBox(fract(u / sp), 0.0, 0.15, aw / sp) * fBox(v, 0.04, 0.95, ah);
  vec2 c = vec2(fract(u / 0.264) - 0.5, (v - 0.56) / 0.264);
  float ring = 1.0 - smoothstep(0.035, 0.05 + aw * 3.0, abs(length(c - vec2(0.0, 0.42 * sign(c.y))) - 0.36));
  ring *= fBox(v, 0.23, 0.9, ah) * step(k, 1.5);
  return max(rails, max(bars, ring));
}
#ifdef MZ_RELIEF
// Baie rectangulaire en retrait de D dans le mur. p = point sur le nu du mur, r = rayon (u, v, profondeur > 0).
// q = point atteint, side = 0 fond / 1 tableau / 2 appui ou linteau, z = profondeur atteinte, nt = normale (repère façade)
void fBay(vec2 p, vec2 c0, vec2 c1, float D, vec3 r, out vec2 q, out float side, out float z, out vec3 nt) {
  vec2 e = p + r.xy / r.z * D;
  side = 0.0; z = D; q = e; nt = vec3(0.0, 0.0, 1.0);
  if (e.x < c0.x || e.x > c1.x || e.y < c0.y || e.y > c1.y) {
    float tx = r.x > 0.0 ? (c1.x - p.x) / max(r.x, 1e-4) : (c0.x - p.x) / min(r.x, -1e-4);
    float ty = r.y > 0.0 ? (c1.y - p.y) / max(r.y, 1e-4) : (c0.y - p.y) / min(r.y, -1e-4);
    float t = max(min(tx, ty), 0.0);
    z = clamp(t * r.z, 0.0, D); q = p + r.xy * t;
    if (tx < ty) { side = 1.0; nt = vec3(r.x > 0.0 ? -1.0 : 1.0, 0.0, 0.0); } else { side = 2.0; nt = vec3(0.0, r.y > 0.0 ? -1.0 : 1.0, 0.0); }
  }
}
// part de soleil reçue par un point (q, z) au fond de la baie
float fBayLit(vec2 q, float z, vec2 c0, vec2 c1, vec3 s) {
  if (s.z <= 0.03) return 1.0;
  vec2 x = q + s.xy / s.z * z;
  return fBox(x.x, c0.x, c1.x, 0.02) * fBox(x.y, c0.y, c1.y, 0.02);
}
// Pièce derrière une vitre (interior mapping). g = point d'entrée (x centré, y depuis le plancher), r = rayon.
vec3 fRoom(vec2 g, vec3 r, float hw, float hh, float dep, float id, out float k, out float lamp) {
  float tx = r.x > 0.0 ? (hw - g.x) / max(r.x, 1e-4) : (-hw - g.x) / min(r.x, -1e-4);
  float ty = r.y > 0.0 ? (hh - g.y) / max(r.y, 1e-4) : (-g.y) / min(r.y, -1e-4);
  float tz = dep / r.z;
  float t = max(min(min(tx, ty), tz), 0.0);
  vec3 h = vec3(g, 0.0) + r * t;
  float i1 = fract(id * 7.13), i2 = fract(id * 13.7), i3 = fract(id * 29.3);
  vec3 wallC = i2 < 0.5 ? mix(vec3(0.62, 0.56, 0.46), vec3(0.4, 0.48, 0.5), step(0.6, i1)) : mix(vec3(0.7, 0.68, 0.64), vec3(0.52, 0.34, 0.26), step(0.85, i2));
  vec3 c;
  if (t >= tz) {
    c = wallC;
    vec2 b = vec2(h.x / hw, h.y / hh);
    float fr = fBox(b.x, -0.6 + i1 * 0.6, -0.15 + i1 * 0.6, 0.02) * fBox(b.y, 0.4, 0.78, 0.02);
    c = mix(c, vec3(0.2, 0.14, 0.1) + 0.3 * vec3(i2, i3, i1), fr * step(0.3, i3));
    c = mix(c, vec3(0.15, 0.1, 0.07), fBox(b.x, 0.3, 0.72, 0.02) * fBox(b.y, -1.0, 0.74, 0.02) * step(i3, 0.5));
  } else if (ty < tx) c = r.y > 0.0 ? vec3(0.8, 0.78, 0.74) : vec3(0.3, 0.2, 0.13);
  else c = wallC * 0.8;
  k = exp(-h.z * 0.3);
  vec3 lp = vec3(hw * (i1 - 0.5), hh - 0.55, dep * (0.35 + 0.4 * i3)) - h;
  lamp = 1.0 / (1.0 + 1.3 * dot(lp, lp));
  return c;
}
#endif
`;

// ------------------------------------------------------------------ fragment : couleur / matière
export const FRAG_MAIN = `
float fPart = vFB.w, fL = vFB.x, fHe = vFB.y, fSeed = vFB.z, fStyleRaw = vFD.y, fLod = vFD.z;
// styles ≥ 5 (Toulouse) : modénature d'un style de base + matières propres ; fMat = matériau des murs des données (1 brique, 2 enduit…)
float fStyle = fStyleRaw > 4.5 ? (fStyleRaw < 5.5 ? 1.0 : ((fStyleRaw < 6.5 || fStyleRaw > 8.5) ? 2.0 : 4.0)) : fStyleRaw;
float fRt = mod(vFD.w, 10.0), fMat = floor(fract(fStyleRaw) * 20.0 + 0.5);
float fHouse = (fStyleRaw > 5.5 && (fStyleRaw < 6.5 || fStyleRaw > 8.5)) ? 1.0 : 0.0;
vec2 fuv = vFUv;
float aw = fwidth(fuv.x) * 0.7 + 1e-4, ah = fwidth(fuv.y) * 0.7 + 1e-4;
float fRough = 0.86, fGlass = 0.0, fOcc = 0.0, fUseNt = 0.0, fTilt = 0.0; vec3 fEmis = vec3(0.0); vec3 fCol; vec3 fNt = vec3(0.0, 0.0, 1.0); vec2 fBump = vec2(0.0);
float t1 = fH11(fSeed), t2 = fH11(fSeed + 3.7), t3 = fH11(fSeed + 9.1);
// ---- teinte de façade selon le style
vec3 stone = t1 < 0.45 ? mix(vec3(0.80, 0.725, 0.595), vec3(0.87, 0.80, 0.67), t3) : (t1 < 0.8 ? mix(vec3(0.85, 0.77, 0.61), vec3(0.9, 0.84, 0.71), t3) : mix(vec3(0.78, 0.76, 0.71), vec3(0.86, 0.84, 0.79), t3));
if (fStyle > 3.5) stone = mix(vec3(0.7, 0.7, 0.68), vec3(0.82, 0.81, 0.78), t3);
else if (fStyle > 2.5) stone = t2 < 0.6 ? mix(vec3(0.60, 0.33, 0.24), vec3(0.74, 0.55, 0.36), t3) : mix(vec3(0.84, 0.8, 0.72), vec3(0.9, 0.87, 0.8), t3);
else if (fStyle > 1.5) stone = t1 < 0.5 ? mix(vec3(0.88, 0.86, 0.8), vec3(0.8, 0.79, 0.76), t3) : mix(vec3(0.87, 0.78, 0.63), vec3(0.86, 0.76, 0.7), t3);
float fBrick = (fStyle > 2.5 && fStyle < 3.5 && t2 < 0.6) ? 1.0 : 0.0;
vec3 trim = vec3(0.0); float fTrim = 0.0;
if (fStyleRaw > 4.5) {
  fBrick = 0.0;
  vec3 brickC = mix(vec3(0.70, 0.40, 0.29), vec3(0.80, 0.51, 0.37), t3);                 // brique foraine rose-orangé
  vec3 renderC = t2 < 0.4 ? mix(vec3(0.90, 0.86, 0.76), vec3(0.93, 0.90, 0.83), t3)      // enduits : blanc cassé, sable, ocre rosé
    : (t2 < 0.75 ? mix(vec3(0.88, 0.78, 0.60), vec3(0.91, 0.83, 0.67), t3) : mix(vec3(0.87, 0.69, 0.56), vec3(0.90, 0.80, 0.68), t3));
  if (fStyleRaw < 5.5) { fBrick = fMat == 1.0 ? 1.0 : (fMat == 2.0 ? 0.0 : step(t1, 0.7)); stone = fBrick > 0.5 ? brickC : renderC; trim = vec3(0.86, 0.82, 0.74); fTrim = fBrick; }
  else if (fStyleRaw < 6.5) { fBrick = fMat == 1.0 ? 1.0 : 0.0; stone = fBrick > 0.5 ? brickC : renderC; trim = vec3(0.88, 0.85, 0.78); fTrim = fBrick; }
  else if (fStyleRaw < 7.5) { stone = t1 > 0.7 ? mix(vec3(0.84, 0.76, 0.64), vec3(0.88, 0.82, 0.72), t3) : mix(vec3(0.80, 0.79, 0.75), vec3(0.90, 0.88, 0.82), t3); if (fMat == 1.0) { stone = brickC; fBrick = 1.0; } }
  else if (fStyleRaw < 8.5) { stone = fMat == 2.0 ? renderC : (fMat == 1.0 ? brickC : (t1 < 0.45 ? mix(vec3(0.72, 0.73, 0.74), vec3(0.84, 0.84, 0.82), t3) : (t1 < 0.7 ? vec3(0.82, 0.80, 0.70) : (t1 < 0.85 ? vec3(0.42, 0.50, 0.60) : vec3(0.50, 0.56, 0.50))))); }
  else { fBrick = fMat == 2.0 ? 0.0 : (fMat == 1.0 ? 1.0 : step(t1, 0.6)); stone = fBrick > 0.5 ? brickC : renderC; trim = vec3(0.87, 0.83, 0.75); fTrim = fBrick; }
}
stone = fS(stone);
trim = fTrim > 0.5 ? fS(trim) / 1.08 : stone; // encadrements, bandeaux et appuis (pierre ou brique claire sur les façades de brique)
float rdc, nF, fH, nS, nB, bw; mzLayout(fL, fHe, fStyleRaw, rdc, nF, fH, nS, nB, bw);
float bi = floor(fuv.x / bw), bu = fuv.x - (bi + 0.5) * bw;
float ww = min(0.62, bw * 0.27);
if (fStyle > 2.5) ww = min(1.05, bw * 0.36);
// ---- repère de façade : rayon de vue et direction du soleil (u, v, profondeur / sortant)
vec3 fT3 = vec3(vFT.x, 0.0, vFT.y), fN3 = vec3(vFT.z, 0.0, vFT.w);
vec3 rdW = normalize(vWP - cameraPosition);
vec3 rt = vec3(dot(rdW, fT3), rdW.y, max(-dot(rdW, fN3), 0.05));
vec3 st = vec3(dot(uSunDir, fT3), uSunDir.y, dot(uSunDir, fN3));
float relief = 1.0 - smoothstep(0.02, 0.085, max(aw, ah));
float sunUp = max(st.y, 0.0) / max(st.z, 0.08); // longueur d'ombre verticale par mètre de saillie
float sunFace = step(0.03, st.z);

if (fStyleRaw > 7.5 && fStyleRaw < 8.5 && fPart < 1.5) {
  // ================= hangar, commerce, annexe : bardage nervuré (ou enduit), soubassement, portes sectionnelles — très peu coûteux
  float det = 1.0 - smoothstep(0.03, 0.12, aw), plain = fMat == 2.0 || fMat == 1.0 ? 1.0 : 0.0;
  float rib = fBox(fract(fuv.x / 0.3), 0.0, 0.5, aw / 0.3) * (1.0 - plain);
  fCol = stone * (0.88 + 0.14 * fNoise(fuv * vec2(0.2, 0.05) + fSeed * 3.0)) * (1.0 - 0.1 * rib * det);
  fCol *= 1.0 - 0.18 * smoothstep(0.5, 0.9, fNoise(vec2(fuv.x * 1.3 + fSeed, fuv.y * 0.05)));          // coulures
  float big = step(5.5, fHe);
  fCol = mix(fCol, fS(vec3(0.60, 0.59, 0.56)), fBox(fuv.y, -9.0, 0.25 + 0.65 * big, ah) * 0.9);        // soubassement
  fCol = mix(fCol, fS(fPal(t2 * 2.99 + 0.02)) * 0.7, fBox(fuv.y, fHe - 0.9, fHe + 3.0, ah) * step(0.55, t3) * big * (1.0 - plain)); // bandeau de couleur
  float sw = fL / max(1.0, floor(fL / 13.0 + 0.5)), si = floor(fuv.x / sw), sx = fuv.x - (si + 0.5) * sw;
  float dw = big > 0.5 ? 2.0 : min(1.25, fL * 0.5 - 0.3), dh = min(big > 0.5 ? 4.2 : 2.1, fHe - 0.3);
  float door = fBox(sx, -dw, dw, aw) * fBox(fuv.y, 0.0, dh, ah) * step(0.45, fH21(vec2(si + fSeed * 3.0, fL))) * step(2.6, fL) * (1.0 - vFD.x);
  fCol = mix(fCol, fS(vec3(0.80, 0.81, 0.82)) * (0.82 + 0.18 * step(0.5, fract(fuv.y / 0.5))) * (1.0 - 0.3 * fBox(fuv.y, dh - 0.12, dh, ah)), door);
  fCol *= mix(0.72, 1.0, smoothstep(0.0, 1.4, fuv.y));
  fRough = mix(plain > 0.5 ? 0.9 : 0.55, 0.5, door);
  fEmis += fCol * vec3(1.0, 0.68, 0.36) * uNight * 0.16 * (1.0 - smoothstep(0.5, 9.0, fuv.y));
} else if (fPart < 1.5 && vFD.x > 0.5) {
  // ================= mur mitoyen / pignon aveugle : enduit, héberges, traces de conduits
  vec3 pl = fS(mix(vec3(0.74, 0.71, 0.65), vec3(0.83, 0.79, 0.7), t3));
  float n1 = fNoise(fuv * vec2(0.22, 0.09) + fSeed * 7.0), n2 = fNoise(fuv * 2.7 + fSeed);
  fCol = pl * (0.78 + 0.26 * n1) * (0.94 + 0.1 * n2);
  // coulures verticales, conduits de fumée, reprises d'enduit
  fCol *= 1.0 - 0.22 * smoothstep(0.55, 0.9, fNoise(vec2(fuv.x * 1.7 + fSeed * 3.0, fuv.y * 0.06)));
  float flue = fBox(fract(fuv.x / max(fL * 0.5, 2.5) + 0.25 + t1 * 0.3), 0.0, 0.9 / max(fL * 0.5, 2.5), aw / max(fL * 0.5, 2.5));
  fCol = mix(fCol, pl * 0.62, flue * 0.5 * step(4.0, fL));
  float repr = fBox(fuv.y, fHe * (0.25 + 0.3 * t2), fHe * (0.5 + 0.3 * t2), 0.15) * fBox(fuv.x, fL * 0.15 * t1, fL * (0.5 + 0.4 * t1), 0.15);
  fCol = mix(fCol, pl * vec3(1.06, 1.03, 0.97), repr * 0.5);
  fCol *= mix(0.7, 1.0, smoothstep(-1.0, 2.5, fuv.y));
  fRough = 0.93;
} else if (fPart < 0.5) {
  // ================= mur de façade
  float grime = fNoise(fuv * vec2(0.31, 0.11) + fSeed * 17.0), fine = fNoise(fuv * 11.0);
  float streak = fNoise(vec2(fuv.x * 2.3 + fSeed * 5.0, fuv.y * 0.18));
  fCol = stone * (0.84 + 0.2 * grime) * (0.955 + 0.09 * fine) * (0.93 + 0.1 * streak);
  float detail = 1.0 - smoothstep(0.012, 0.05, max(aw, ah));
  if (fBrick > 0.5) {
    // brique : assises de 6,5 cm, joints clairs
    float row = floor(fuv.y / 0.075), bx = fract(fuv.x / 0.23 + 0.5 * mod(row, 2.0));
    float joint = max(fBox(fract(fuv.y / 0.075), 0.0, 0.16, ah / 0.075), fBox(bx, 0.0, 0.06, aw / 0.23));
    fCol *= mix(1.0, 0.82 + 0.36 * fH21(vec2(floor(fuv.x / 0.23 + 0.5 * mod(row, 2.0)), row)), detail);
    fCol = mix(fCol, vec3(0.62, 0.58, 0.5), joint * detail * 0.75);
  } else if (fStyle < 1.5 && fStyleRaw < 4.5) {
    // appareillage de pierre de taille : assises de 34 cm, joints verticaux décalés
    float row = floor(fuv.y / 0.34), jx = fract(fuv.x / 0.95 + 0.5 * mod(row, 2.0));
    float joint = max(fBox(fract(fuv.y / 0.34), 0.0, 0.03, ah / 0.34), fBox(jx, 0.0, 0.011, aw / 0.95));
    fCol *= 1.0 - 0.16 * joint * detail;
    fCol *= mix(1.0, 0.95 + 0.1 * fH21(vec2(floor(fuv.x / 0.95 + 0.5 * mod(row, 2.0)), row + fSeed)), detail);
  }
  if (fuv.y > rdc) {
    float fy = (fuv.y - rdc) / fH, fi = floor(fy), fv = (fy - fi) * fH;
    float balc = mzBalc(fi, nF, fStyle), balcUp = mzBalc(fi + 1.0, nF, fStyle);
    float top = fi == nF - 1.0 ? 1.0 : 0.0;
    float orn = fStyle < 1.5 ? 1.0 : (fStyle < 2.5 ? 0.45 : 0.0); // richesse de la modénature
    // refends au 1er étage (haussmannien)
    if (fi < 0.5 && fStyle < 1.5) { float rf = fBox(fract(fuv.y / 0.43), 0.0, 0.09, ah / 0.43) * (1.0 - smoothstep(0.05, 0.2, ah)); fCol *= 1.0 - 0.22 * rf; }
    // trumeaux / pilastres discrets
    fCol *= 1.0 - 0.06 * orn * fBox(abs(bu), bw * 0.5 - 0.06, bw * 0.5 + 0.1, aw);
    // bandeau d'étage (saillie de 6 cm : dessus clair, ombre portée dessous)
    float band = fBox(fv, -0.05, 0.2, ah) * orn;
    fCol = mix(fCol, trim * 1.07, band * 0.85);
    fOcc = max(fOcc, orn * sunFace * fBox(fv, fH - 0.06 * sunUp - 0.02, fH, ah));
    // corniche sommitale et dalle de balcon de l'étage supérieur : ombre portée analytique (saillie 0,4 / 0,62 m)
    float proj = max(0.62 * balcUp, 0.42 * top * step(fStyle, 3.5));
    fOcc = max(fOcc, sunFace * step(0.01, proj) * smoothstep(fH - proj * sunUp - 0.06, fH - proj * sunUp + 0.06, fv));
    fCol *= 1.0 - (0.12 + 0.2 * balcUp + 0.12 * top) * smoothstep(fH - 0.45 - 0.4 * balcUp, fH, fv); // occlusion ambiante sous saillie
    fCol = mix(fCol, stone * (0.55 + 0.55 * smoothstep(fH - 0.42, fH - 0.1, fv)), top * fBox(fv, fH - 0.42, fH + 0.1, ah) * 0.85 * (1.0 - fLod) * step(fStyle, 3.5));
    // ---------- fenêtre
    float wy0 = (fStyle > 2.5 ? 0.95 : 0.26) - 0.1 * balc, wy1 = fH - (fStyle > 2.5 ? 0.5 : 0.62);
    float inW = fBox(bu, -ww, ww, aw) * fBox(fv, wy0, wy1, ah);
    float surround = fBox(bu, -ww - 0.17, ww + 0.17, aw) * fBox(fv, wy0 - 0.04, wy1 + 0.2, ah) * orn;
    fCol = mix(fCol, trim * 1.09, surround * 0.75);
    // linteau saillant + clef, appui saillant : ombres portées
    fCol = mix(fCol, stone * 0.72, fBox(bu, -ww - 0.24, ww + 0.24, aw) * fBox(fv, wy1 + 0.2, wy1 + 0.27, ah) * 0.7 * orn);
    fCol = mix(fCol, stone * 1.12, fBox(abs(bu), -1.0, 0.11, aw) * fBox(fv, wy1 + 0.01, wy1 + 0.2, ah) * 0.6 * orn * step(fStyle, 0.5));
    float sill = fBox(bu, -ww - 0.1, ww + 0.1, aw) * fBox(fv, wy0 - 0.09, wy0 - 0.01, ah) * (1.0 - balc);
    fCol = mix(fCol, trim * 1.1, sill * 0.8);
    fOcc = max(fOcc, sunFace * (1.0 - balc) * fBox(bu + 0.05 * st.x / max(st.z, 0.08), -ww - 0.1, ww + 0.1, aw) * fBox(fv, wy0 - 0.09 - 0.07 * sunUp, wy0 - 0.09, ah));
    // coulures sous l'appui
    fCol *= 1.0 - 0.2 * (1.0 - balc) * fBox(bu, -ww - 0.05, ww + 0.05, 0.08) * (1.0 - smoothstep(wy0 - 1.1, wy0 - 0.1, fv)) * step(0.0, wy0 - 0.1 - fv) * (1.0 - smoothstep(0.0, 1.2, wy0 - fv)) * (0.4 + 0.9 * fNoise(vec2(fuv.x * 9.0, fuv.y * 0.7)));
    float wid = fH21(vec2(bi + fSeed * 13.0, fi + fSeed * 7.0 + fL));
    float wid2 = fract(wid * 17.31), wid3 = fract(wid * 51.7);
    // --- relief : embrasure de 26 cm
    vec2 wq = vec2(bu, fv); float wSide = 0.0, wz = 0.0; vec3 wnt = vec3(0.0, 0.0, 1.0); float wLit = 1.0;
    vec2 c0 = vec2(-ww, wy0), c1 = vec2(ww, wy1);
#ifdef MZ_RELIEF
    float D = 0.26 * relief;
    if (inW > 0.001 && D > 0.002) { fBay(vec2(bu, fv), c0, c1, D, rt, wq, wSide, wz, wnt); wLit = fBayLit(wq, wz, c0, c1, st); }
#endif
    float shut = step(fStyle > 1.5 && fStyle < 2.5 ? 0.72 : 0.9, wid3); // volets / persiennes fermés
    float lit = step(1.0 - 0.42 * uNight, wid2 * 0.999) * uNight * (1.0 - shut);
    vec3 warm = mix(vec3(1.0, 0.66, 0.3), vec3(1.0, 0.86, 0.62), wid) * (0.45 + 0.6 * wid2);
    if (wid > 0.93) warm = vec3(0.4, 0.55, 1.0) * 0.6;
    vec3 wc; float wRough = 0.5, wGlass = 0.0; vec3 wEm = vec3(0.0);
    if (wSide > 0.5) {
      // tableau / appui / linteau en pierre
      wc = stone * (wSide > 1.5 ? (wnt.y > 0.0 ? 1.08 : 0.8) : 0.94) * (0.9 + 0.1 * fine);
      wRough = 0.86;
    } else {
      float frame = fFrame(wq.x, wq.y, ww, wy0, wy1, aw, ah);
      vec3 frameC = (fStyle > 3.5 ? vec3(0.12, 0.13, 0.14) : vec3(0.78, 0.77, 0.73) * (0.75 + 0.25 * t3));
      vec3 glassC = vec3(0.012, 0.016, 0.02);
      float curt = step(0.45, wid) * fBox(abs(wq.x), ww * (0.25 + 0.5 * wid2), ww, aw);  // rideaux latéraux
      float sheer = step(0.62, wid3) * step(wid3, 0.9);                                // voilage
#ifdef MZ_RELIEF
      if (relief > 0.01) {
        float rk, rl; vec3 room = fRoom(vec2(wq.x, wq.y + 0.0), rt, bw * 0.5 - 0.08, fH - 0.3, 4.2, wid + bi * 0.37 + fi * 0.11, rk, rl);
        vec3 dayC = room * (0.05 + 0.2 * rk) * (0.6 + 0.4 * sunFace);
        glassC = mix(glassC, dayC, relief);
        wEm = lit * room * warm * (0.35 + 0.5 * rk + 2.2 * rl) * relief;
      }
#endif
      wEm = mix(lit * warm * (0.6 + 0.4 * fNoise(vec2(bu * 3.0, fv * 2.0) + wid * 31.0)), wEm, relief);
      vec3 curtC = mix(vec3(0.5, 0.47, 0.42), vec3(0.55, 0.3, 0.22), step(0.8, wid2)) * (0.45 + 0.5 * wid2);
      glassC = mix(glassC, curtC * (0.5 + 0.5 * fBox(fract(wq.x * 9.0), 0.2, 0.8, aw * 9.0 + 0.1)), curt * 0.9);
      glassC = mix(glassC, vec3(0.5, 0.49, 0.46) * (0.7 + 0.3 * fNoise(vec2(wq.x * 14.0, wq.y * 0.8))), sheer * 0.55);
      wEm *= 1.0 - 0.5 * curt - 0.25 * sheer; wEm += lit * warm * 0.35 * (curt + sheer * 0.6);
      wGlass = (1.0 - frame) * (1.0 - curt * 0.5 - sheer * 0.3) * (1.0 - lit * 0.8);
      // persiennes fermées : lames horizontales
      vec3 shC = mix(vec3(0.72, 0.72, 0.69), mix(vec3(0.3, 0.36, 0.33), vec3(0.42, 0.44, 0.5), t3), step(0.5, t2));
      float lam = fBox(fract(wq.y / 0.055), 0.0, 0.45, ah / 0.055);
      shC *= mix(0.8, 0.62 + 0.45 * lam, 1.0 - smoothstep(0.01, 0.03, ah));
      shC *= 1.0 - 0.5 * fBox(abs(wq.x), -1.0, 0.012, aw);
      wc = mix(mix(glassC, frameC, frame), shC, shut);
      wEm *= (1.0 - frame) * (1.0 - shut); wGlass *= 1.0 - shut;
      wRough = mix(mix(0.06, 0.5, frame), 0.6, shut);
      wc *= 1.0 - 0.3 * (1.0 - relief) * smoothstep(wy1 - 0.3, wy1, fv); // loin : ombre peinte du linteau
      fTilt = (wid - 0.5) * 0.05;
    }
    wc *= mix(1.0, 0.82, relief * step(0.5, wSide + 0.6)); // occlusion ambiante de l'embrasure
    fCol = mix(fCol, wc, inW);
    fRough = mix(fRough, wRough, inW);
    fGlass = wGlass * inW; fEmis += wEm * inW;
    fOcc = mix(fOcc, 1.0 - wLit, inW);
    if (wSide > 0.5 && inW > 0.5) { fNt = wnt; fUseNt = 1.0; }
    // ---------- garde-corps peint (s'efface quand le vrai volume prend le relais) / appuis de fenêtre en fonte
    float rTop = wy0 + 0.92;
    if (fHouse > 0.5) { // volets battants ouverts de part et d'autre de la baie
      float sht = fBox(abs(bu), ww + 0.04, ww * 1.9, aw) * fBox(fv, wy0 - 0.02, wy1 + 0.02, ah);
      vec3 shC = fS(t2 < 0.3 ? vec3(0.42, 0.55, 0.66) : (t2 < 0.5 ? vec3(0.45, 0.56, 0.47) : (t2 < 0.75 ? vec3(0.80, 0.78, 0.72) : vec3(0.45, 0.30, 0.22))));
      fCol = mix(fCol, shC * (0.82 + 0.18 * step(0.5, fract(fv / 0.09))), sht); fGlass *= 1.0 - sht; fEmis *= 1.0 - sht;
    }
    float gz = fBox(bu, -ww - 0.04, ww + 0.04, aw) * (1.0 - balc) * step(fStyle, 2.5) * (1.0 - fHouse);
    float ironW = gz * fIron(fuv.x, fv - wy0 + 0.03, aw, ah) * fBox(fv, wy0, rTop + 0.06, ah);
    float ironB = balc * (1.0 - fLod) * fIron(fuv.x, fv - 0.03, aw, ah) * fBox(fv, 0.03, 1.03, ah);
    float iron = max(ironW, ironB);
    fCol = mix(fCol, vec3(0.012, 0.014, 0.016), iron);
    fEmis *= 1.0 - iron; fGlass *= 1.0 - iron; fRough = mix(fRough, 0.5, iron);
    // balcons maçonnés Art déco
    if (fStyle > 2.5 && fStyle < 3.5) { float mb = fBox(bu, -ww - 0.2, ww + 0.2, aw) * fBox(fv, 0.0, 0.92, ah) * step(0.5, fH11(fi + fSeed)); fCol = mix(fCol, stone * 1.12 * (1.0 - 0.25 * fBox(fv, 0.0, 0.1, ah)), mb); fGlass *= 1.0 - mb; fEmis *= 1.0 - mb; if (mb > 0.5) { fUseNt = 0.0; fOcc = 0.0; } }
    fCol *= 1.0 - 0.25 * balc * fBox(fv, 0.0, 0.12, ah) * (1.0 - fLod);
  } else {
    // ================= rez-de-chaussée
    float y = fuv.y;
    float sw = fL / nS, si = floor(fuv.x / sw), sx = fuv.x - (si + 0.5) * sw;
    vec3 shp = mzShop(si, fSeed, fL); float sh = shp.x, sh2 = shp.y, sh3 = shp.z;
    // maisons, barres : pas de boutique ; une porte (d'entrée ou de garage) au milieu d'une façade sur deux
    if (fStyleRaw > 5.5) sh = (si == floor(nS * 0.5) && fract(fSeed * 13.7 + fL * 0.37) < 0.5) ? 0.7 : 0.9;
    // refends + soubassement (qui descend jusqu'au sol sur les pentes)
    float rfm = fBox(fract(y / 0.46), 0.0, 0.085, ah / 0.46) * (1.0 - smoothstep(0.05, 0.2, ah)) * step(fStyle, 2.5) * step(fStyleRaw, 5.5);
    fCol *= 1.0 - 0.22 * rfm;
    fCol = mix(fCol, stone * 0.6, fBox(y, -9.0, 0.5, ah) * 0.7);
    fCol *= 1.0 - 0.12 * fBox(y, 0.5, 0.56, ah);
    // entablement sous le 1er étage
    float entab = 1.0 - fHouse;
    fCol = mix(fCol, trim * 1.05, fBox(y, rdc - 0.3, rdc + 0.1, ah) * 0.8 * entab);
    fCol *= 1.0 - 0.3 * fBox(y, rdc - 0.42, rdc - 0.3, ah) * entab;
    fOcc = max(fOcc, sunFace * fBox(y, rdc - 0.3 - 0.08 * sunUp, rdc - 0.3, ah) * entab);
    float pil = 0.34;
    float inShop = fBox(sx, -sw * 0.5 + pil, sw * 0.5 - pil, aw) * fBox(y, 0.0, rdc - 0.5, ah);
    if (fL < 3.4) inShop = 0.0;
    if (sh < 0.66) {
      // ---- boutique : devanture en applique, vitrine en retrait de 35 cm
      float pharma = step(0.9, sh2);
      vec3 sc = pharma > 0.5 ? vec3(0.75, 0.78, 0.76) : fPal(sh2 * 5.99 + fSeed);
      vec3 c = sc * (0.8 + 0.4 * fNoise(fuv * 3.0));
      float signY0 = rdc - 1.25, glassTop = signY0 - 0.06;
      float hx = sw * 0.5 - pil - 0.12, dcx = (sh3 - 0.5) * sw * 0.5;
      vec2 g0 = vec2(-hx, 0.55), g1 = vec2(hx, glassTop);
      float gl = fBox(y, 0.55, glassTop, ah) * fBox(sx, -hx, hx, aw);
      float doorM = fBox(sx - dcx, -0.5, 0.5, aw) * fBox(y, 0.06, 2.25, ah);
      vec2 sq = vec2(sx, y); float sSide = 0.0, sz = 0.0; vec3 snt = vec3(0.0, 0.0, 1.0); float sLit = 1.0;
#ifdef MZ_RELIEF
      float D = 0.35 * relief;
      if (gl > 0.001 && D > 0.002) { fBay(vec2(sx, y), g0, g1, D, rt, sq, sSide, sz, snt); sLit = fBayLit(sq, sz, g0, g1, st); }
#endif
      vec3 gc; float gGlass = 0.0; vec3 gEm = vec3(0.0);
      if (sSide > 0.5) gc = sc * (sSide > 1.5 && snt.y > 0.0 ? 1.1 : 0.7);
      else {
        float mull = max(fBox(fract((sq.x + sw * 0.5) / 1.35), 0.0, 0.045, aw / 1.35), fBox(sq.y, glassTop - 0.55, glassTop - 0.5, ah));
        // étalage à 45 cm derrière la vitre, boutique profonde de 6 m derrière
        vec2 dq = sq; vec3 room = vec3(0.05); float rk = 0.5, rl = 0.0;
#ifdef MZ_RELIEF
        dq = sq + rt.xy / rt.z * 0.45 * relief;
        if (relief > 0.01) room = fRoom(vec2(sq.x, sq.y), rt, sw * 0.5 - pil, rdc - 0.9, 6.0, sh3 + si * 0.3, rk, rl);
#endif
        vec2 cell = vec2(dq.x / 0.34 + si * 3.0, dq.y / 0.3), ci = floor(cell), cf = fract(cell);
        float item = step(0.3, fH21(ci + fSeed)) * fBox(cf.x, 0.16, 0.84, aw / 0.34) * fBox(cf.y, 0.0, 0.3 + 0.6 * fH21(ci + 7.0), ah / 0.3) * fBox(dq.y, 0.62, 1.78, ah) * (1.0 - smoothstep(0.04, 0.14, aw));
        vec3 itemC = 0.1 + 1.1 * fPal(fH21(ci + 3.0) * 5.99 + sh3 * 3.0) + 0.25 * fH21(ci + 11.0);
        vec3 inside = mix(vec3(0.022, 0.022, 0.025) * (1.0 + 3.0 * smoothstep(2.6, 0.6, y)), room * (0.06 + 0.2 * rk), relief);
        inside = mix(inside, itemC * 0.55, item);
        inside = mix(inside, vec3(0.28, 0.24, 0.19), fBox(dq.y, 0.5, 0.62, ah) * 0.8);
        float open = step(sh3, 0.8);
        gEm = uNight * open * (mix(vec3(1.0, 0.8, 0.52), fPal(sh3 * 3.0 + bi) + 0.5, 0.25) * (0.1 + 0.3 * fNoise(vec2(sx * 1.7 + si * 3.0, y * 1.3))) * (1.0 - relief) + room * vec3(1.0, 0.82, 0.58) * (0.25 + 0.5 * rk + 1.6 * rl) * relief + 0.5 * item * itemC) * (0.5 + 0.5 * smoothstep(0.5, 1.6, y));
        gc = mix(inside, c * 0.8, mull); gEm *= 1.0 - mull;
        gGlass = (1.0 - mull) * (1.0 - uNight * open * 0.7);
      }
      gc *= mix(1.0, 0.85, relief * step(0.5, sSide + 0.6));
      // porte vitrée (dans le plan de la devanture)
      float dgl = fBox(abs(sx - dcx), -1.0, 0.42, aw) * fBox(y, 0.2, 2.15, ah);
      c = mix(c, gc, gl * (1.0 - doorM));
      c = mix(c, vec3(0.03, 0.035, 0.04), doorM * dgl);
      float gm = gl * (1.0 - doorM);
      fEmis += gEm * gm + doorM * dgl * uNight * step(sh3, 0.8) * vec3(0.5, 0.4, 0.26);
      fGlass = (gGlass * gm + doorM * dgl * 0.9) * inShop;
      fOcc = mix(fOcc, 1.0 - sLit, gm * inShop);
      if (sSide > 0.5 && gm * inShop > 0.5) { fNt = snt; fUseNt = 1.0; }
      // enseigne-bandeau, lettres, croix de pharmacie
      float sgnB = fBox(y, signY0, rdc - 0.52, ah);
      float letters = fBox(y, signY0 + 0.2, rdc - 0.74, ah) * fBox(abs(sx), -1.0, sw * (0.16 + 0.14 * sh2), aw) * step(0.42, fNoise(vec2(sx * 7.0 + si * 13.0, 0.5))) * (1.0 - smoothstep(0.04, 0.12, aw));
      c = mix(c, sc * 0.85, sgnB);
      c = mix(c, mix(vec3(0.85, 0.7, 0.32), vec3(0.9), step(0.5, sh3)), letters * (1.0 - pharma));
      vec2 cp = vec2(sx, y - (signY0 + rdc - 0.52) * 0.5);
      float crossM = pharma * max(fBox(cp.x, -0.09, 0.09, aw) * fBox(cp.y, -0.27, 0.27, ah), fBox(cp.x, -0.27, 0.27, aw) * fBox(cp.y, -0.09, 0.09, ah));
      c = mix(c, vec3(0.03, 0.5, 0.16), crossM);
      fEmis += crossM * inShop * vec3(0.1, 1.0, 0.35) * (0.35 + 1.4 * uNight);
      // store banne peint (remplacé par le volume de près) + son ombre sur la vitrine
      float hasAw = step(sh2, 0.6);
      float ay0 = signY0 - 0.75 + 0.07 * cos(sx * 12.0), ay1 = signY0 + 0.02;
      float aw_ = hasAw * fBox(y, ay0, ay1, ah) * fBox(abs(sx), -1.0, sw * 0.5 - pil + 0.1, aw) * (1.0 - fLod);
      vec3 ac = fPal(sh3 * 5.99 + 2.0) * 1.5 + 0.04;
      if (sh3 > 0.5) ac = mix(ac, vec3(0.82, 0.78, 0.68), step(0.5, fract(sx * 2.2)) * (1.0 - smoothstep(0.1, 0.3, aw)));
      ac *= 0.62 + 0.5 * smoothstep(ay0, ay1, y);
      c *= 1.0 - 0.3 * hasAw * fBox(y, signY0 - 1.3, signY0, 0.2) * (1.0 - aw_);
      fOcc = max(fOcc, hasAw * sunFace * inShop * fBox(y, signY0 - 0.5 - 0.95 * sunUp, signY0 + 0.05, 0.05));
      c = mix(c, ac, aw_);
      fEmis *= 1.0 - aw_; fGlass *= 1.0 - aw_;
      fRough = mix(fRough, mix(0.5, 0.08, gl * (1.0 - sSide * 0.5)), inShop);
      fRough = mix(fRough, 0.95, aw_ * inShop);
      fCol = mix(fCol, c, inShop);
      fEmis *= inShop;
    } else if (sh < 0.8) {
      // ---- porte cochère en retrait de 45 cm sous son arc
      vec3 dc = fPal(sh2 * 2.99 + 0.02) * 0.9;
      float dh = min(rdc - 0.95, 3.5), dwid = min(1.35, sw * 0.5 - 0.6);
      if (fStyleRaw > 5.5) { dh = min(rdc - 0.3, 2.15); dwid = min(sh2 < 0.5 ? 0.48 : 1.2, sw * 0.5 - 0.3); } // porte d'entrée ou de garage
      float arch = y - (dh - dwid) > 0.0 ? length(vec2(sx, y - (dh - dwid))) : abs(sx);
      if (fStyleRaw > 5.5) arch = abs(sx);
      float din = (1.0 - smoothstep(dwid - aw, dwid + aw, arch)) * fBox(y, 0.0, dh + 0.1, ah);
      float dsur = (1.0 - smoothstep(dwid + 0.22 - aw, dwid + 0.22 + aw, arch)) * fBox(y, 0.0, dh + 0.4, ah);
      fCol = mix(fCol, stone * 1.08, dsur * 0.8);
      vec2 dq = vec2(sx, y); float dLit = 1.0, jamb = 0.0;
#ifdef MZ_RELIEF
      float D = 0.45 * relief;
      if (din > 0.001 && D > 0.002) {
        dq = vec2(sx, y) + rt.xy / rt.z * D;
        float a2 = dq.y - (dh - dwid) > 0.0 ? length(vec2(dq.x, dq.y - (dh - dwid))) : abs(dq.x);
        jamb = step(dwid, a2) + step(dq.y, 0.0);
        vec2 sp = dq + (st.z > 0.03 ? st.xy / st.z * D : vec2(0.0));
        float a3 = sp.y - (dh - dwid) > 0.0 ? length(vec2(sp.x, sp.y - (dh - dwid))) : abs(sp.x);
        dLit = 1.0 - smoothstep(dwid - 0.03, dwid + 0.03, a3);
      }
#endif
      float panel = fBox(abs(abs(dq.x) - dwid * 0.5), -1.0, dwid * 0.33, aw) * max(fBox(dq.y, 0.25, 1.05, ah), fBox(dq.y, 1.25, dh - dwid * 0.6, ah));
      vec3 dcol = dc * (0.75 + 0.35 * panel) * (1.0 - 0.6 * fBox(abs(dq.x), -1.0, 0.02, aw));
      dcol = mix(dcol, vec3(0.5, 0.4, 0.15), fBox(length(vec2(abs(dq.x) - 0.14, dq.y - 1.15)), -1.0, 0.045, aw) * (1.0 - smoothstep(0.02, 0.06, aw))); // boutons de laiton
      dcol *= 1.0 - 0.4 * (1.0 - relief) * smoothstep(dh - 0.5, dh, y);
      if (jamb > 0.5) dcol = stone * 0.78;
      fCol = mix(fCol, dcol, din);
      fRough = mix(fRough, jamb > 0.5 ? 0.86 : 0.4, din);
      fOcc = mix(fOcc, 1.0 - dLit, din);
      fEmis = vec3(0.0);
    } else {
      // ---- mur à fenêtres (logements / bureaux au rez-de-chaussée), barreaudées
      float y0 = 1.15, y1 = rdc - 1.0;
      if (fStyleRaw > 5.5) { y0 = 0.95; y1 = min(2.15, rdc - 0.42); }
      float inW = fBox(bu, -ww, ww, aw) * fBox(y, y0, y1, ah);
      float surround = fBox(bu, -ww - 0.15, ww + 0.15, aw) * fBox(y, y0 - 0.1, y1 + 0.18, ah);
      fCol = mix(fCol, trim * 1.08, surround * 0.7);
      if (fHouse > 0.5) { // volets battants ouverts
        float sht = fBox(abs(bu), ww + 0.04, ww * 1.9, aw) * fBox(y, y0 - 0.02, y1 + 0.02, ah);
        vec3 shC = fS(t2 < 0.3 ? vec3(0.42, 0.55, 0.66) : (t2 < 0.5 ? vec3(0.45, 0.56, 0.47) : (t2 < 0.75 ? vec3(0.80, 0.78, 0.72) : vec3(0.45, 0.30, 0.22))));
        fCol = mix(fCol, shC * (0.82 + 0.18 * step(0.5, fract(y / 0.09))), sht);
      }
      vec2 wq = vec2(bu, y); float wSide = 0.0, wz = 0.0; vec3 wnt = vec3(0.0, 0.0, 1.0); float wLit = 1.0;
#ifdef MZ_RELIEF
      float D = 0.24 * relief;
      if (inW > 0.001 && D > 0.002) { fBay(vec2(bu, y), vec2(-ww, y0), vec2(ww, y1), D, rt, wq, wSide, wz, wnt); wLit = fBayLit(wq, wz, vec2(-ww, y0), vec2(ww, y1), st); }
#endif
      float wid = fH21(vec2(bi + fSeed * 3.0, 77.0));
      float frame = fFrame(wq.x, wq.y, ww, y0, y1, aw, ah);
      vec3 wc = wSide > 0.5 ? stone * 0.9 : mix(vec3(0.02, 0.025, 0.03), vec3(0.7, 0.69, 0.66), frame);
      wc *= 1.0 - 0.4 * (1.0 - relief) * smoothstep(rdc - 1.3, rdc - 1.0, y);
      float bars = fBox(fract(fuv.x * 9.0), 0.0, 0.2, aw * 9.0) * (1.0 - smoothstep(0.03, 0.1, aw)) * step(fStyleRaw, 5.5);
      wc = mix(wc, vec3(0.015), bars * 0.8);
      float em = inW * (1.0 - frame) * step(0.7, wid) * uNight * (1.0 - step(0.5, wSide));
      fEmis += em * vec3(1.0, 0.75, 0.42) * 0.6;
      fCol = mix(fCol, wc, inW);
      fGlass = inW * (1.0 - frame) * (1.0 - bars) * 0.7 * (1.0 - step(0.5, wSide));
      fRough = mix(fRough, wSide > 0.5 ? 0.86 : 0.15, inW * (1.0 - frame));
      fOcc = mix(fOcc, 1.0 - wLit, inW);
      if (wSide > 0.5 && inW > 0.5) { fNt = wnt; fUseNt = 1.0; }
    }
  }
  // génoise : rangs de tuiles en encorbellement sous l'égout des toits de tuiles (Toulouse)
  if (fStyleRaw > 4.5 && (fRt < 2.5 || fRt > 4.5) && (fStyleRaw < 7.5 || fStyleRaw > 8.5)) {
    float gy = (fuv.y - (fHe - 0.27)) / 0.27;
    if (gy > 0.0) {
      float row = floor(gy * 3.0), sc = abs(sin((fuv.x / 0.21 + 0.5 * mod(row, 2.0)) * 3.14159));
      vec3 gc = fS(vec3(0.76, 0.48, 0.33)) * mix(0.85, 0.5 + 0.65 * sc, 1.0 - smoothstep(0.02, 0.07, aw)) * (0.75 + 0.25 * fract(gy * 3.0));
      fCol = gc; fGlass = 0.0; fEmis = vec3(0.0); fUseNt = 0.0;
    }
    fCol *= 1.0 - 0.3 * fBox(fuv.y, fHe - 0.5, fHe - 0.27, ah);
  }
  // descente d'eaux pluviales en zinc à l'angle
  float pipe = fBox(fuv.x, 0.14, 0.24, aw) * step(6.0, fL) * step(0.35, fuv.y) * step(fStyle, 2.5) * (1.0 - smoothstep(0.03, 0.1, aw));
  fCol = mix(fCol, vec3(0.2, 0.22, 0.24) * (0.7 + 0.6 * fBox(fuv.x, 0.17, 0.21, aw)), pipe);
  fGlass *= 1.0 - pipe; fEmis *= 1.0 - pipe;
  // la nuit : lueur chaude des réverbères sur le bas des façades (pas de PointLight)
  fEmis += fCol * vec3(1.0, 0.68, 0.36) * uNight * 0.2 * (1.0 - smoothstep(0.5, 11.0, fuv.y));
  // salissures en pied de façade, éclaboussures, assombrissement de rue étroite
  float foot = smoothstep(0.0, 1.5, fuv.y);
  fCol *= mix(0.62 + 0.2 * fNoise(vec2(fuv.x * 1.3, 0.0)), 1.0, foot) * mix(0.9, 1.0, smoothstep(0.0, 14.0, fuv.y));
  fCol *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.18, fuv.y));
} else if (fPart < 1.5) {
  // ================= brisis de mansarde (zinc / ardoise) + lucarnes peintes (au loin) — ou attique des toits-terrasses
  float mh = vFC.x, my = fuv.y - fHe;
  if (fStyle > 2.5 || fStyleRaw > 4.5) {
    fCol = stone * (0.9 + 0.12 * fNoise(fuv * vec2(0.4, 1.3) + fSeed)) * (1.0 - 0.25 * fBox(my, mh - 0.14, mh + 0.1, ah));
    fCol = mix(fCol, stone * 1.1, fBox(my, mh - 0.3, mh - 0.14, ah));
  } else {
    vec3 zinc = fS(mix(vec3(0.40, 0.44, 0.49), vec3(0.50, 0.54, 0.58), t3));
    float slate = step(t2, 0.35);
    if (slate > 0.5) zinc = fS(mix(vec3(0.24, 0.26, 0.30), vec3(0.32, 0.34, 0.38), t3));
    float sf = fract(fuv.x / 0.62), det = 1.0 - smoothstep(0.04, 0.15, aw);
    float seams = fBox(sf, 0.0, 0.07, aw / 0.62) * det * (1.0 - slate);
    float rows = slate * fBox(fract(my / 0.28), 0.0, 0.12, ah / 0.28) * (1.0 - smoothstep(0.03, 0.1, ah));
    float tile = slate * fH21(vec2(floor(fuv.x / 0.2 + 0.5 * mod(floor(my / 0.28), 2.0)), floor(my / 0.28))) * det;
    fCol = zinc * (0.86 + 0.22 * fNoise(fuv * vec2(1.5, 0.4) + fSeed)) * (1.0 - 0.3 * seams) * (1.0 - 0.25 * rows) * (0.92 + 0.16 * tile);
    fBump = vec2((fBox(sf, 0.0, 0.035, aw / 0.62) - fBox(sf, 0.035, 0.07, aw / 0.62)) * det * (1.0 - slate) * 0.8, rows * 0.5);
    fRough = slate > 0.5 ? 0.62 : 0.42;
    // chéneau / corniche en pied
    fCol = mix(fCol, stone * 1.02, fBox(my, -1.0, 0.22, ah) * (1.0 - fLod));
    fCol = mix(fCol, vec3(0.3, 0.32, 0.34), fBox(my, 0.0, 0.2, ah) * fLod);
    fCol *= 1.0 - 0.3 * fBox(my, 0.22, 0.34, ah);
    float stride = max(1.0, ceil(nB / 12.0));
    if (mh > 2.5 && mod(bi, stride) < 0.5 && bi < 12.0 * stride) {
      float ly0 = 0.5, ly1 = mh - 0.7, lw = min(0.5, bw * 0.24);
      float body = fBox(bu, -lw - 0.16, lw + 0.16, aw) * fBox(my, ly0 - 0.1, ly1 + 0.12, ah);
      float ped = fBox(my, ly1 + 0.12, ly1 + 0.5, ah) * (1.0 - smoothstep(-aw, aw, abs(bu) - (lw + 0.3) * (1.0 - (my - ly1 - 0.12) / 0.4)));
      vec3 lc = slate > 0.5 ? zinc * 1.25 : stone * 1.04;
      fCol = mix(fCol, lc, max(body, ped));
      fCol *= 1.0 - 0.3 * fBox(bu, lw + 0.16, lw + 0.4, aw) * fBox(my, ly0, ly1, ah);
      float inW = fBox(bu, -lw, lw, aw) * fBox(my, ly0, ly1, ah);
      float frame = fFrame(bu, my, lw, ly0, ly1, aw, ah);
      float wid = fH21(vec2(bi + fSeed * 5.0, 99.0 + fL)), wid2 = fract(wid * 17.31);
      vec3 wc = mix(mix(vec3(0.012, 0.016, 0.02), vec3(0.07), wid), vec3(0.76, 0.75, 0.71), frame) * (1.0 - 0.5 * smoothstep(ly1 - 0.25, ly1, my));
      float lit = step(1.0 - 0.38 * uNight, wid2 * 0.999) * uNight;
      fEmis += inW * (1.0 - frame) * lit * mix(vec3(1.0, 0.66, 0.3), vec3(1.0, 0.86, 0.62), wid) * 0.7;
      fCol = mix(fCol, wc, inW);
      fGlass = inW * (1.0 - frame) * (1.0 - lit);
      fRough = mix(fRough, 0.1, fGlass);
      fBump *= 1.0 - max(body, ped);
    }
  }
} else if (fPart < 2.5) {
  // ================= terrasson (zinc à tasseaux) ou toit-terrasse gravillonné ; Toulouse : tuiles canal, bac acier, terrasse
  if (fStyleRaw > 4.5) {
    if (vFD.w > 9.5) { // pignon : le mur monte jusqu'au faîte
      fCol = stone * (0.86 + 0.14 * fNoise(fuv * vec2(0.3, 0.12) + fSeed * 5.0));
      if (fBrick > 0.5) fCol *= mix(1.0, 0.86 + 0.28 * fH21(vec2(floor(fuv.x / 0.23), floor(fuv.y / 0.075))), 1.0 - smoothstep(0.012, 0.05, max(aw, ah)));
      fRough = 0.9;
    } else if (fRt > 2.5 && fRt < 3.5) { // terrasse : étanchéité gravillonnée, lanterneaux
      fCol = fS(vec3(0.55, 0.54, 0.51)) * (0.8 + 0.4 * fNoise(fuv * 0.5 + fSeed)) * (0.9 + 0.2 * fNoise(fuv * 9.0));
      vec2 vf = fract(fuv / vec2(9.0, 7.0)); float vr = fH21(floor(fuv / vec2(9.0, 7.0)) + fSeed);
      float lan = step(0.82, vr) * fBox(vf.x, 0.35, 0.6, fwidth(fuv.x) / 9.0) * fBox(vf.y, 0.3, 0.6, fwidth(fuv.y) / 7.0);
      fCol = mix(fCol, fS(vec3(0.82, 0.84, 0.86)), lan);
      fRough = 0.95;
    } else {
      float cu = vWP.x * vFT.x + vWP.z * vFT.y, cw = fwidth(cu) + 1e-4, ch = fwidth(vWP.y) + 1e-4;
      float det = 1.0 - smoothstep(0.03, 0.14, cw);
      if (fRt > 3.5 && fRt < 4.5) { // bac acier nervuré, plaques translucides
        float rb = fBox(fract(cu / 0.33), 0.0, 0.14, cw / 0.33) * det;
        fCol = fS(mix(vec3(0.58, 0.60, 0.62), vec3(0.70, 0.71, 0.70), t3)) * (0.86 + 0.22 * fNoise(fuv * 0.3 + fSeed)) * (1.0 - 0.28 * rb);
        float tr = step(0.8, fH21(vec2(floor(cu / 6.0), fSeed))) * fBox(fract(cu / 6.0), 0.3, 0.5, cw / 6.0);
        fCol = mix(fCol, fS(vec3(0.78, 0.82, 0.80)), tr * 0.8);
        fRough = 0.5;
      } else { // tuiles canal (ou ardoise) : rangs de couvert et de courant dans le sens de la pente
        float fx = fract(cu / 0.2), row = floor(vWP.y / 0.1);
        vec3 tile = fRt > 4.5 ? mix(vec3(0.25, 0.27, 0.31), vec3(0.33, 0.35, 0.39), t3) : mix(vec3(0.70, 0.41, 0.28), vec3(0.80, 0.54, 0.37), t3);
        float var = fH21(vec2(floor(cu / 0.2), row + fSeed));
        float chan = fBox(fx, 0.0, 0.3, cw / 0.2), lap = fBox(fract(vWP.y / 0.1), 0.0, 0.2, ch / 0.1) * (1.0 - smoothstep(0.02, 0.06, ch));
        fCol = fS(tile) * (0.8 + 0.34 * fNoise(fuv * 0.35 + fSeed * 3.0)) * mix(1.0, 0.8 + 0.4 * var, det) * (1.0 - 0.4 * chan * det) * (1.0 - 0.22 * lap);
        fCol = mix(fCol, fCol * vec3(0.78, 0.82, 0.68), 0.55 * smoothstep(0.5, 0.82, fNoise(fuv * 0.9 + fSeed * 11.0))); // patine, lichens
        fRough = 0.86;
      }
    }
  } else if (fStyle > 2.5) {
    fCol = fS(vec3(0.5, 0.5, 0.5)) * (0.8 + 0.4 * fNoise(fuv * 0.5 + fSeed)) * (0.9 + 0.2 * fNoise(fuv * 9.0));
    fRough = 0.95;
  } else {
    vec3 zinc = fS(mix(vec3(0.47, 0.50, 0.54), vec3(0.58, 0.61, 0.64), t3));
    float su = vFC.y >= vFC.z ? fuv.x : fuv.y, sw2 = fwidth(su), sf = fract(su / 0.65), det = 1.0 - smoothstep(0.04, 0.2, sw2);
    float seams = fBox(sf, 0.0, 0.08, sw2 / 0.65) * det;
    fCol = zinc * (0.84 + 0.26 * fNoise(fuv * 0.6 + fSeed * 3.0)) * (1.0 - 0.28 * seams);
    // quelques verrières / châssis de toit
    vec2 vc = floor(fuv / vec2(4.5, 3.2)); float vr = fH21(vc + fSeed);
    vec2 vf = fract(fuv / vec2(4.5, 3.2));
    float sky = step(0.9, vr) * fBox(vf.x, 0.3, 0.62, sw2 / 4.5) * fBox(vf.y, 0.3, 0.7, fwidth(fuv.y) / 3.2);
    fCol = mix(fCol, vec3(0.03, 0.04, 0.05), sky); fGlass = sky * 0.8;
    fRough = mix(0.44, 0.08, sky);
  }
} else if (fPart < 4.5) {
  // ================= souche de cheminée en brique + mitrons
  vec3 br = fS(mix(vec3(0.62, 0.42, 0.32), vec3(0.74, 0.66, 0.55), step(0.5, t3)));
  float row = floor(fuv.y / 0.075), det = 1.0 - smoothstep(0.012, 0.05, max(aw, ah));
  float joint = max(fBox(fract(fuv.y / 0.075), 0.0, 0.16, ah / 0.075), fBox(fract(fuv.x / 0.23 + 0.5 * mod(row, 2.0)), 0.0, 0.06, aw / 0.23));
  fCol = br * (0.8 + 0.3 * fNoise(fuv * vec2(2.0, 1.0) + fSeed));
  fCol = mix(fCol, vec3(0.6, 0.57, 0.5), joint * det * 0.7);
  float yy = -fuv.y; // distance sous le sommet
  if (yy < 0.42) {
    float pot = fBox(fract(fuv.x / 0.42 + 0.5), 0.2, 0.8, aw / 0.42);
    if (pot < 0.5 && aw < 0.2) discard;
    fCol = mix(fCol, fS(vec3(0.66, 0.36, 0.24)) * (0.7 + 0.5 * fNoise(fuv * 5.0)), smoothstep(0.0, 0.2, 0.2 - aw));
  } else { fCol *= 1.0 - 0.3 * fBox(yy, 0.42, 0.55, ah); fCol = mix(fCol, stone, fBox(yy, 0.55, 0.7, ah) * 0.7); }
} else if (fPart < 5.5) {
  // ================= dalle de balcon (pierre), sous-face plus sombre, consoles
  fCol = stone * (0.95 + 0.1 * fNoise(fuv * 4.0));
  if (vSub > 2.5) { fCol *= 0.8; fCol *= 1.0 - 0.35 * fBox(abs(bu), bw * 0.5 - 0.22, bw * 0.5 + 0.1, aw); }
} else if (fPart < 6.5) {
  // ================= garde-corps en ferronnerie (découpe alpha procédurale)
  float fi = floor((fuv.y - rdc - 0.01) / fH), v = fuv.y - (rdc + fi * fH) - 0.03;
  float cov = fIron(fuv.x, v, aw, ah);
  if (cov < 0.5) discard;
  fCol = vec3(0.014, 0.016, 0.018); fRough = 0.45;
} else if (fPart < 7.5) {
  // ================= corniche à modillons
  fCol = stone * (1.0 + 0.06 * fNoise(fuv * 3.0));
  if (vSub > 2.5) fCol *= 0.72 + 0.28 * fBox(fract(fuv.x / 0.42), 0.0, 0.5, aw / 0.42);
} else if (fPart < 8.5) {
  // ================= store banne en toile (découpé par boutique)
  float sw = fL / nS, si = floor(fuv.x / sw), sx = fuv.x - (si + 0.5) * sw;
  vec3 shp = mzShop(si, fSeed, fL);
  float signY0 = rdc - 1.25;
  float lowEdge = signY0 - 0.5 - 0.11 + 0.035 * cos(sx * 21.0);
  if (shp.x >= 0.66 || shp.y >= 0.6 || abs(sx) > sw * 0.5 - 0.3 || (vSub < 0.5 && fuv.y < lowEdge)) discard;
  vec3 ac = fPal(shp.z * 5.99 + 2.0) * 1.5 + 0.04;
  if (shp.z > 0.5) ac = mix(ac, vec3(0.82, 0.78, 0.68), step(0.5, fract(sx * 2.2)) * (1.0 - smoothstep(0.1, 0.3, aw)));
  fCol = ac * (0.85 + 0.2 * fNoise(fuv * vec2(3.0, 9.0)));
  fRough = 0.95;
} else {
  // ================= lucarne en volume : façade (fenêtre), joues et toit en zinc
  float mh = vFC.x, my = fuv.y - fHe;
  float slate = step(t2, 0.35);
  vec3 zinc = slate > 0.5 ? fS(mix(vec3(0.24, 0.26, 0.30), vec3(0.32, 0.34, 0.38), t3)) : fS(mix(vec3(0.40, 0.44, 0.49), vec3(0.50, 0.54, 0.58), t3));
  if (vSub > 0.5) { fCol = zinc * (vSub > 1.5 ? 1.05 : 0.9); fRough = 0.45; }
  else {
    float lw = min(0.5, bw * 0.24), ly0 = 0.5, ly1 = mh - 0.7;
    fCol = (slate > 0.5 ? zinc * 1.25 : stone * 1.04) * (0.95 + 0.1 * fNoise(fuv * 5.0));
    float inW = fBox(bu, -lw, lw, aw) * fBox(my, ly0, ly1, ah);
    vec2 wq = vec2(bu, my); float wSide = 0.0, wz = 0.0; vec3 wnt = vec3(0.0, 0.0, 1.0); float wLit = 1.0;
#ifdef MZ_RELIEF
    float D = 0.14 * relief;
    if (inW > 0.001 && D > 0.002) { fBay(vec2(bu, my), vec2(-lw, ly0), vec2(lw, ly1), D, rt, wq, wSide, wz, wnt); wLit = fBayLit(wq, wz, vec2(-lw, ly0), vec2(lw, ly1), st); }
#endif
    float frame = fFrame(wq.x, wq.y, lw, ly0, ly1, aw, ah);
    float wid = fH21(vec2(bi + fSeed * 5.0, 99.0 + fL)), wid2 = fract(wid * 17.31);
    float lit = step(1.0 - 0.38 * uNight, wid2 * 0.999) * uNight;
    vec3 wc = wSide > 0.5 ? fCol * 0.85 : mix(mix(vec3(0.012, 0.016, 0.02), vec3(0.07), wid), vec3(0.76, 0.75, 0.71), frame);
    float gm = inW * (1.0 - frame) * (1.0 - step(0.5, wSide));
    fEmis += gm * lit * mix(vec3(1.0, 0.66, 0.3), vec3(1.0, 0.86, 0.62), wid) * 0.7;
    fCol = mix(fCol, wc, inW);
    fGlass = gm * (1.0 - lit); fRough = mix(fRough, 0.1, fGlass);
    fOcc = (1.0 - wLit) * inW;
    if (wSide > 0.5 && inW > 0.5) { fNt = wnt; fUseNt = 1.0; }
  }
}
diffuseColor.rgb = fCol;
`;

// normale : tableaux des baies (repère façade), léger gauchissement des vitres, joints debout du zinc
export const FRAG_NORMAL = `#include <normal_fragment_maps>
if (fUseNt > 0.5) {
  vec3 nW = fT3 * fNt.x + vec3(0.0, fNt.y, 0.0) + fN3 * fNt.z;
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
} else if (fGlass > 0.3 && fPart < 0.5) {
  // chaque vitre est un peu de travers : les reflets ne sont pas tous identiques
  vec3 nW = normalize(fN3 + fT3 * fTilt + vec3(0.0, fTilt * 0.7, 0.0) + 0.012 * vec3(sin(vFUv.y * 3.1 + vFB.z), 0.0, cos(vFUv.x * 2.7)));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
} else if (dot(fBump, fBump) > 1e-6) {
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  vec2 s0 = dFdx(vFUv), s1 = dFdy(vFUv);
  vec3 q1p = cross(q1, normal), q0p = cross(normal, q0);
  vec3 bT = q1p * s0.x + q0p * s1.x, bB = q1p * s0.y + q0p * s1.y;
  float det = max(dot(bT, bT), dot(bB, bB));
  if (det > 0.0) { float sc = inversesqrt(det); normal = normalize(normal - (bT * fBump.x + bB * fBump.y) * sc); }
}`;

// éclairage direct : ombres propres analytiques (embrasures, balcons, corniches, stores)
export const FRAG_LIGHT = `#include <lights_fragment_end>
{
  float k = 1.0 - clamp(fOcc, 0.0, 1.0) * uSunK;
  reflectedLight.directDiffuse *= k; reflectedLight.directSpecular *= k;
}`;

// reflets des vitres : environnement de la scène (IBL) si présent, sinon couleur du ciel
export const FRAG_GLASS = `
{
  vec3 vv = normalize(vViewPosition);
  float ndv = saturate(dot(normal, vv));
  float fres = 0.06 + 0.94 * pow(1.0 - ndv, 4.0);
  vec3 rw = (vec4(reflect(-vv, normal), 0.0) * viewMatrix).xyz;
  float skyLum = dot(uSky, vec3(0.3, 0.5, 0.2));
  vec3 refl = uSky;
#ifdef USE_ENVMAP
  refl = getIBLRadiance(vv, normal, 0.04);
#endif
  // vers l'horizontale et vers le bas, la vitre reflète les façades d'en face plutôt que le ciel
  refl = mix(vec3(0.33, 0.29, 0.23) * skyLum, refl, smoothstep(0.02, 0.4, rw.y + 0.12 * sin(vFUv.x * 1.3 + vFB.z)));
  outgoingLight = mix(outgoingLight, refl, clamp(fGlass, 0.0, 1.0) * (0.12 + 0.8 * fres));
}
#include <opaque_fragment>`;

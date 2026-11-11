// Textures procédurales (canvas / tableaux) du module ville : couches de sol en DataArrayTexture
// (albédo + normales), petites textures utilitaires (feuillage, écorce, halo).
import { mulberry32, clamp } from './util.js';

// Couches de la texture « surface ».
export const L_ASPHALT = 0, L_SIDEWALK = 1, L_PAVE = 2, L_GRASS = 3, L_GRAVEL = 4, L_PAINT = 5, L_STONE = 6, L_PLAIN = 7, L_GROUND = 8;
export const LAYERS = 8;
// Taille (m) couverte par une répétition de chaque couche.
export const LAYER_SIZE = [7, 5, 3.2, 9, 6, 4, 3.6, 2];

function makeNoise(seed) {
  // bruit de valeur périodique
  const rnd = mulberry32(seed);
  const N = 64, tab = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) tab[i] = rnd();
  const sm = (t) => t * t * (3 - 2 * t);
  /** x,y en [0,1) ; freq = nb de cellules par période (≤ 64, entier). */
  const noise = (x, y, freq) => {
    const fx = x * freq, fy = y * freq;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = sm(fx - x0), ty = sm(fy - y0);
    const xa = ((x0 % freq) + freq) % freq, xb = (xa + 1) % freq, ya = ((y0 % freq) + freq) % freq, yb = (ya + 1) % freq;
    const a = tab[ya * N + xa], b = tab[ya * N + xb], c = tab[yb * N + xa], d = tab[yb * N + xb];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  const fbm = (x, y, freq, oct) => {
    let s = 0, a = 0.5, n = 0;
    for (let o = 0; o < oct && freq <= 64; o++) { s += a * noise(x, y, freq); n += a; a *= 0.5; freq *= 2; }
    return s / n;
  };
  return { noise, fbm, rnd };
}

/**
 * Chaque générateur remplit rgb (0..255, sRGB) et h (hauteur 0..1) pour le pixel (u,v) ∈ [0,1).
 */
function genLayer(layer, S, alb, hgt, off) {
  const { noise, fbm, rnd } = makeNoise(1000 + layer * 77);
  const px = new Float32Array(S * S); // bruit blanc par pixel
  for (let i = 0; i < S * S; i++) px[i] = rnd();
  // pavés : teinte par pierre
  const stoneTint = new Float32Array(64 * 64); for (let i = 0; i < stoneTint.length; i++) stoneTint[i] = rnd();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, w = px[y * S + x];
    let r = 128, g = 128, b = 128, h = 0.5;
    switch (layer) {
      case L_ASPHALT: {
        const big = fbm(u, v, 4, 4), grain = fbm(u, v, 64, 1) * 0.5 + w * 0.5;
        let c = 62 + big * 18 + (grain - 0.5) * 34;
        if (w > 0.965) c += 38; else if (w < 0.03) c -= 18; // granulats clairs / creux
        // fissures et reprises discrètes
        const crack = Math.abs(fbm(u, v, 8, 3) - 0.5);
        if (crack < 0.006) c -= 16;
        r = c; g = c; b = c + 2; h = 0.5 + (grain - 0.5) * 0.9 - (crack < 0.006 ? 0.3 : 0);
        break;
      }
      case L_SIDEWALK: {
        const big = fbm(u, v, 4, 4), grain = w;
        let c = 118 + big * 22 + (grain - 0.5) * 20;
        if (w > 0.97) c += 22;
        // joints de dalles / bandes de reprise discrets
        const ju = Math.abs(((u * 4) % 1) - 0.5), jv = Math.abs(((v * 2) % 1) - 0.5);
        const joint = ju > 0.492 || jv > 0.494;
        if (joint) c -= 7;
        r = c + 1; g = c; b = c - 3; h = 0.5 + (grain - 0.5) * 0.5 - (joint ? 0.12 : 0);
        break;
      }
      case L_PAVE: {
        // pavés parisiens : ~11 cm, joints sombres, rangées décalées
        const NX = 28, NY = 28;
        const row = Math.floor(v * NY), fy = v * NY - row;
        const uu = u * NX + (row % 2) * 0.5, col = Math.floor(uu), fx = uu - col;
        const t = stoneTint[(row % 64) * 64 + (((col % NX) + NX) % NX)];
        const ex = Math.min(fx, 1 - fx), ey = Math.min(fy, 1 - fy);
        const e = Math.min(ex, ey);
        const dome = clamp(e / 0.22, 0, 1);
        let c = 100 + t * 26 + (w - 0.5) * 14 + fbm(u, v, 4, 3) * 16;
        if (e < 0.07) c = 66 + w * 14;
        r = c + 4; g = c + 1; b = c - 4; h = e < 0.07 ? 0.1 : 0.45 + dome * 0.45 + (w - 0.5) * 0.08;
        break;
      }
      case L_GRASS: {
        const big = fbm(u, v, 4, 4), mid = fbm(u, v, 32, 2), bl = w;
        const k = 0.75 + big * 0.35 + (mid - 0.5) * 0.3 + (bl - 0.5) * 0.3;
        r = 66 * k + big * 14; g = 96 * k + mid * 10; b = 44 * k; h = 0.4 + (bl - 0.5) * 0.7 + (mid - 0.5) * 0.5;
        break;
      }
      case L_GRAVEL: {
        const big = fbm(u, v, 4, 4), grain = w;
        const k = 0.86 + big * 0.16 + (grain - 0.5) * 0.2;
        r = 206 * k; g = 188 * k; b = 150 * k; h = 0.5 + (grain - 0.5) * 0.8;
        break;
      }
      case L_PAINT: {
        const wear = fbm(u, v, 8, 4), grain = w;
        let c = 226 + (grain - 0.5) * 18;
        if (wear > 0.62) c -= (wear - 0.62) * 420; // usure
        c = clamp(c, 90, 245);
        r = c; g = c; b = c - 6; h = 0.6 + (grain - 0.5) * 0.3;
        break;
      }
      case L_STONE: {
        // pierre de taille : blocs 0,9 × 0,45 m, joints creux, teinte par bloc, coulures
        const NYB = 8, NXB = 4;
        const row = Math.floor(v * NYB), fy = v * NYB - row;
        const uu = u * NXB + (row % 2) * 0.5, col = Math.floor(uu), fx = uu - col;
        const t = stoneTint[(row % 64) * 64 + (((col % NXB) + NXB) % NXB)];
        const e = Math.min(Math.min(fx, 1 - fx) * 2.0, Math.min(fy, 1 - fy));
        const big = fbm(u, v, 4, 4), streak = fbm(u, v * 0.25, 32, 2);
        const k = 0.84 + t * 0.14 + (big - 0.5) * 0.2 + (w - 0.5) * 0.07 - Math.max(0, streak - 0.55) * 0.5;
        let c = 1;
        if (e < 0.035) c = 0.62;
        r = 196 * k * c; g = 184 * k * c; b = 160 * k * c; h = e < 0.035 ? 0.15 : 0.6 + (w - 0.5) * 0.15 + (big - 0.5) * 0.2;
        break;
      }
      default: { // L_PLAIN : grain fin neutre (granit des bordures, béton, métal peint)
        const big = fbm(u, v, 8, 3);
        const c = 205 + (w - 0.5) * 34 + (big - 0.5) * 30;
        r = c; g = c; b = c; h = 0.5 + (w - 0.5) * 0.5;
      }
    }
    const i = off + (y * S + x) * 4;
    alb[i] = clamp(r, 0, 255); alb[i + 1] = clamp(g, 0, 255); alb[i + 2] = clamp(b, 0, 255); alb[i + 3] = 255;
    hgt[y * S + x] = h;
  }
}

function heightToNormal(hgt, S, out, off, strength) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const xl = (x + S - 1) % S, xr = (x + 1) % S, yu = (y + S - 1) % S, yd = (y + 1) % S;
    const dx = (hgt[y * S + xr] - hgt[y * S + xl]) * strength, dy = (hgt[yd * S + x] - hgt[yu * S + x]) * strength;
    const l = 1 / Math.hypot(dx, dy, 1), i = off + (y * S + x) * 4;
    out[i] = (-dx * l * 0.5 + 0.5) * 255; out[i + 1] = (-dy * l * 0.5 + 0.5) * 255; out[i + 2] = (l * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
}

const NORMAL_STRENGTH = [1.6, 1.0, 3.2, 2.0, 1.6, 0.8, 2.6, 0.8];

export function createSurfaceTextures(THREE, renderer, Q) {
  const S = Q.texSize;
  const alb = new Uint8Array(S * S * 4 * LAYERS), nrm = new Uint8Array(S * S * 4 * LAYERS), hgt = new Float32Array(S * S);
  for (let l = 0; l < LAYERS; l++) {
    genLayer(l, S, alb, hgt, l * S * S * 4);
    heightToNormal(hgt, S, nrm, l * S * S * 4, NORMAL_STRENGTH[l]);
  }
  const aniso = Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy());
  const mk = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, S, S, LAYERS);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = aniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(alb, true), normal: mk(nrm, false) };
}

/** Texture 2D simple à partir d'un générateur par pixel (r,g,b,a 0..255). */
export function pixelTexture(THREE, S, fn, { srgb = true, repeat = true, aniso = 4 } = {}) {
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) fn(x / S, y / S, data, (y * S + x) * 4);
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

/** Feuillage : albédo moucheté + alpha de découpe (bruit en amas) et carte de normales. */
export function createLeafTextures(THREE, S = 256) {
  const { fbm, rnd } = makeNoise(4242);
  const hgt = new Float32Array(S * S), cut = new Float32Array(S * S);
  // amas de feuilles : petits disques clairs/sombres
  const blobs = [];
  for (let i = 0; i < 420; i++) blobs.push([rnd(), rnd(), 0.028 + rnd() * 0.03, rnd()]);
  const cell = 16, grid = Array.from({ length: cell * cell }, () => []);
  for (const b of blobs) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = (Math.floor(b[0] * cell) + dx + cell) % cell, cy = (Math.floor(b[1] * cell) + dy + cell) % cell; grid[cy * cell + cx].push(b);
  }
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let best = 0, tone = 0.5;
    for (const b of grid[Math.floor(v * cell) * cell + Math.floor(u * cell)]) {
      let dx = Math.abs(u - b[0]), dy = Math.abs(v - b[1]); if (dx > 0.5) dx = 1 - dx; if (dy > 0.5) dy = 1 - dy;
      const d = 1 - Math.hypot(dx, dy) / b[2];
      if (d > best) { best = d; tone = b[3]; }
    }
    const n = fbm(u, v, 8, 4);
    const k = 0.55 + tone * 0.5 + best * 0.25 + (n - 0.5) * 0.4;
    const i = (y * S + x) * 4;
    data[i] = clamp(200 * k, 0, 255); data[i + 1] = clamp(204 * k, 0, 255); data[i + 2] = clamp(184 * k, 0, 255);
    cut[y * S + x] = clamp(best * 1.1 + (n - 0.5) * 0.3, 0, 1);
    data[i + 3] = cut[y * S + x] * 255;
    hgt[y * S + x] = best * 0.7 + tone * 0.3;
  }
  const nd = new Uint8Array(S * S * 4); heightToNormal(hgt, S, nd, 0, 3.0);
  const mk = (d, srgb) => { const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.UnsignedByteType); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t; };
  return { map: mk(data, true), normalMap: mk(nd, false) };
}

/** Halo radial (flaques de lumière des lampadaires). */
export function createGlowTexture(THREE, S = 64) {
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot((x + 0.5) / S - 0.5, (y + 0.5) / S - 0.5) * 2;
    const a = Math.pow(clamp(1 - d, 0, 1), 2.2);
    const i = (y * S + x) * 4; data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = a * 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

/** Carte de normales de vaguelettes (bruit fractal périodique, sans motif régulier). */
export function createWaterNormal(THREE, S = 256) {
  const { fbm } = makeNoise(9001);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // crêtes douces : |bruit - 0.5| inversé + détail
    const a = fbm(u, v, 4, 4), b = fbm(u + 0.37, v + 0.11, 8, 3);
    h[y * S + x] = (1 - Math.abs(a - 0.5) * 2) * 0.6 + b * 0.5;
  }
  const d = new Uint8Array(S * S * 4); heightToNormal(h, S, d, 0, 5.0);
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

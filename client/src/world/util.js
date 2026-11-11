// Outils communs du module ville : aléa déterministe, tuiles, constructeur de géométrie fusionnée.

export const TILE = 500; // taille d'une tuile de culling (m)

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const tileKey = (x, z, size = TILE) => (Math.floor(x / size) + 512) * 1024 + (Math.floor(z / size) + 512);
export const tileOrigin = (key) => ({ x: (Math.floor(key / 1024) - 512) * TILE, z: ((key % 1024) - 512) * TILE });

/** Réglages par niveau de qualité. */
export function qualityPreset(q) {
  if (q === 'low') return { texSize: 256, maskSize: 1024, viewDist: 1300, detailDist: 250, treeDist: 500, treeNear: 90, lampDist: 400, propDist: 300, treeDensity: 0.5, lampStep: 44, aniso: 2, chimneys: false, shadows: false, relief: false, detailLod: [-2, -1] };
  if (q === 'medium') return { texSize: 512, maskSize: 2048, viewDist: 2600, detailDist: 450, treeDist: 900, treeNear: 140, lampDist: 650, propDist: 450, treeDensity: 0.8, lampStep: 34, aniso: 4, chimneys: true, shadows: true, relief: true, detailLod: [60, 85] };
  return { texSize: 512, maskSize: 4096, viewDist: 9000, detailDist: 700, treeDist: 1500, treeNear: 220, lampDist: 1000, propDist: 700, treeDensity: 1, lampStep: 30, aniso: 8, chimneys: true, shadows: true, relief: true, detailLod: [100, 130] };
}

/**
 * Constructeur de géométrie « surface » (sol, chaussées, trottoirs, murs de quai, ponts...).
 * Sommet : position(3 f32) | uv(2 f32) | normal(4 i8) | color(4 u8) | aSurf(4 u8 : couche, biais, mode, -)
 */
export class SurfBuilder {
  constructor(cap = 1024) {
    this.n = 0; this.cap = cap;
    this.pos = new Float32Array(cap * 3); this.uv = new Float32Array(cap * 2);
    this.nrm = new Int8Array(cap * 4); this.col = new Uint8Array(cap * 4); this.surf = new Uint8Array(cap * 4);
    this.idx = []; // tableau JS (converti à la fin)
    this.minY = Infinity; this.maxY = -Infinity;
  }
  _grow() {
    const cap = this.cap * 2;
    const g = (old, T, k) => { const a = new T(cap * k); a.set(old); return a; };
    this.pos = g(this.pos, Float32Array, 3); this.uv = g(this.uv, Float32Array, 2);
    this.nrm = g(this.nrm, Int8Array, 4); this.col = g(this.col, Uint8Array, 4); this.surf = g(this.surf, Uint8Array, 4);
    this.cap = cap;
  }
  /** Ajoute un sommet, retourne son indice. c = [r,g,b] 0..255 ; n = [nx,ny,nz]. */
  v(x, y, z, u, w, layer, bias, mode, c, nx = 0, ny = 1, nz = 0) {
    if (this.n >= this.cap) this._grow();
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = w;
    this.nrm[i * 4] = nx * 127; this.nrm[i * 4 + 1] = ny * 127; this.nrm[i * 4 + 2] = nz * 127;
    this.col[i * 4] = c[0]; this.col[i * 4 + 1] = c[1]; this.col[i * 4 + 2] = c[2]; this.col[i * 4 + 3] = 255;
    this.surf[i * 4] = layer; this.surf[i * 4 + 1] = bias; this.surf[i * 4 + 2] = mode;
    if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y;
    return i;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quadIdx(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  /** Quad horizontal/quelconque par 4 points [x,y,z] (ordre a,b,c,d en boucle), uv = xz monde. */
  flatQuad(a, b, c, d, layer, bias, col, mode = 0, uvs = null) {
    const p = [a, b, c, d]; const id = [];
    for (let k = 0; k < 4; k++) id.push(this.v(p[k][0], p[k][1], p[k][2], uvs ? uvs[k][0] : p[k][0], uvs ? uvs[k][1] : p[k][2], layer, bias, mode, col));
    // orientation : la face doit regarder vers le haut
    const ux = b[0] - a[0], uz = b[2] - a[2], vx = d[0] - a[0], vz = d[2] - a[2];
    if (uz * vx - ux * vz >= 0) this.idx.push(id[0], id[1], id[2], id[0], id[2], id[3]);
    else this.idx.push(id[0], id[2], id[1], id[0], id[3], id[2]);
  }
  /** Mur vertical entre (ax,az) et (bx,bz), de y0 à y1, normale (nx,nz), uv en mètres (mode 1). */
  wall(ax, az, bx, bz, y0a, y1a, y0b, y1b, nx, nz, layer, col, u0 = 0, bias = 0) {
    const len = Math.hypot(bx - ax, bz - az);
    const i0 = this.v(ax, y0a, az, u0, y0a, layer, bias, 1, col, nx, 0, nz);
    const i1 = this.v(bx, y0b, bz, u0 + len, y0b, layer, bias, 1, col, nx, 0, nz);
    const i2 = this.v(bx, y1b, bz, u0 + len, y1b, layer, bias, 1, col, nx, 0, nz);
    const i3 = this.v(ax, y1a, az, u0, y1a, layer, bias, 1, col, nx, 0, nz);
    this.idx.push(i0, i1, i2, i0, i2, i3, i0, i2, i1, i0, i3, i2); // double face (robuste au sens des polygones)
  }
  /** Prisme (muret, parapet) le long d'un segment : largeur w, de y0 à y1. Faces latérales + dessus. */
  prism(ax, az, bx, bz, w, y0a, y0b, h, layer, col, caps = true) {
    let dx = bx - ax, dz = bz - az; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const nx = -dz * w / 2, nz = dx * w / 2, ux = -dz, uz = dx;
    const y1a = y0a + h, y1b = y0b + h;
    const side = (s) => {
      const ox = nx * s, oz = nz * s;
      const i0 = this.v(ax + ox, y0a, az + oz, 0, y0a, layer, 0, 1, col, ux * s, 0, uz * s);
      const i1 = this.v(bx + ox, y0b, bz + oz, len, y0b, layer, 0, 1, col, ux * s, 0, uz * s);
      const i2 = this.v(bx + ox, y1b, bz + oz, len, y1b, layer, 0, 1, col, ux * s, 0, uz * s);
      const i3 = this.v(ax + ox, y1a, az + oz, 0, y1a, layer, 0, 1, col, ux * s, 0, uz * s);
      if (s > 0) this.idx.push(i0, i2, i1, i0, i3, i2); else this.idx.push(i0, i1, i2, i0, i2, i3);
    };
    side(1); side(-1);
    const t0 = this.v(ax + nx, y1a, az + nz, 0, 0, layer, 0, 1, col), t1 = this.v(bx + nx, y1b, bz + nz, len, 0, layer, 0, 1, col);
    const t2 = this.v(bx - nx, y1b, bz - nz, len, w, layer, 0, 1, col), t3 = this.v(ax - nx, y1a, az - nz, 0, w, layer, 0, 1, col);
    this.idx.push(t0, t2, t1, t0, t3, t2);
    if (caps) {
      const cap = (px, pz, y0, y1, sx, sz, flip) => {
        const c0 = this.v(px + nx, y0, pz + nz, 0, y0, layer, 0, 1, col, sx, 0, sz), c1 = this.v(px - nx, y0, pz - nz, w, y0, layer, 0, 1, col, sx, 0, sz);
        const c2 = this.v(px - nx, y1, pz - nz, w, y1, layer, 0, 1, col, sx, 0, sz), c3 = this.v(px + nx, y1, pz + nz, 0, y1, layer, 0, 1, col, sx, 0, sz);
        if (flip) this.idx.push(c0, c2, c1, c0, c3, c2); else this.idx.push(c0, c1, c2, c0, c2, c3);
      };
      cap(ax, az, y0a, y1a, -dx, -dz, true); cap(bx, bz, y0b, y1b, dx, dz, false);
    }
  }
  /** Convertit en BufferGeometry (ou null si vide). */
  build(THREE, bounds) {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    const n = this.n;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, n * 4), 4, true));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 4), 4, true));
    g.setAttribute('aSurf', new THREE.BufferAttribute(this.surf.slice(0, n * 4), 4, false));
    g.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(this.idx), 1) : new THREE.BufferAttribute(new Uint16Array(this.idx), 1));
    if (bounds) g.boundingSphere = bounds; else g.computeBoundingSphere();
    return g;
  }
}

/** Ensemble de SurfBuilder indexés par tuile. */
export class TiledSurf {
  constructor(size = TILE) { this.map = new Map(); this.size = size; }
  at(x, z) {
    const k = tileKey(x, z, this.size);
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = new SurfBuilder()));
    return b;
  }
}

/** Point dans polygone ([[x,z],...]). */
export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}
export function polyBBox(poly) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
  return { x0, x1, z0, z1 };
}

// Outils géométriques du module véhicules : courbes de profil, accumulateur de géométrie fusionnée.
import * as THREE from 'three';

/**
 * Courbe 1D interpolée (cubique monotone, sans dépassement) passant par des points [t, v, 's'?].
 * Le drapeau 's' marque une arête vive (tangente discontinue).
 */
export function curve(pts) {
  const n = pts.length;
  if (n === 1) { const c = pts[0][1]; return () => c; }
  const T = pts.map((p) => p[0]), V = pts.map((p) => p[1]);
  const d = [], h = [];
  for (let i = 0; i < n - 1; i++) { h[i] = Math.max(1e-9, T[i + 1] - T[i]); d[i] = (V[i + 1] - V[i]) / h[i]; }
  const mL = new Float64Array(n), mR = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) mL[i] = mR[i] = d[0];
    else if (i === n - 1) mL[i] = mR[i] = d[n - 2];
    else if (pts[i][2] === 's') { mL[i] = d[i - 1]; mR[i] = d[i]; }
    else {
      const a = d[i - 1], b = d[i];
      // moyenne harmonique pondérée (Fritsch–Butland) : monotone, pas de dépassement
      mL[i] = mR[i] = a * b <= 0 ? 0 : (3 * (h[i - 1] + h[i])) / ((2 * h[i] + h[i - 1]) / a + (h[i] + 2 * h[i - 1]) / b);
    }
  }
  return (t) => {
    if (t <= T[0]) return V[0];
    if (t >= T[n - 1]) return V[n - 1];
    let i = 0;
    while (i < n - 2 && t > T[i + 1]) i++;
    const s = (t - T[i]) / h[i], s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * V[i] + (s3 - 2 * s2 + s) * h[i] * mR[i] + (-2 * s3 + 3 * s2) * V[i + 1] + (s3 - s2) * h[i] * mL[i + 1];
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _nm = new THREE.Matrix3();

// UV du texel blanc de l'atlas (voir materials.js)
export const UV_WHITE = [0.03, 0.97];

/**
 * Accumulateur de triangles non indexés avec attributs par sommet :
 * position, normal, uv, color, pbr (rugosité, métal), lch (canal lumineux).
 */
export class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.pbr = []; this.lch = []; }
  get count() { return this.pos.length / 3; }

  /** Ajoute une BufferGeometry (indexée ou non) transformée par `matrix`. style = {color, rough, metal, ch, uv:[u,v]|'keep'|{rect:[u0,v0,u1,v1]}} */
  add(geom, matrix, style = {}) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const p = g.attributes.position, nrm = g.attributes.normal, guv = g.attributes.uv;
    if (matrix) _nm.getNormalMatrix(matrix);
    _c.set(style.color ?? 0xffffff);
    const cr = _c.r, cg = _c.g, cb = _c.b; // Color.set convertit le sRGB en linéaire
    const rough = style.rough ?? 0.6, metal = style.metal ?? 0, ch = style.ch ?? 0, fx = style.fx ?? 0;
    const flip = matrix ? matrix.determinant() < 0 : false;
    const n = p.count;
    for (let t = 0; t < n; t += 3) {
      for (let k = 0; k < 3; k++) {
        const i = t + (flip ? 2 - k : k);
        _v.fromBufferAttribute(p, i); if (matrix) _v.applyMatrix4(matrix);
        this.pos.push(_v.x, _v.y, _v.z);
        if (nrm) { _v.fromBufferAttribute(nrm, i); if (matrix) _v.applyMatrix3(_nm).normalize(); this.nor.push(_v.x, _v.y, _v.z); }
        else this.nor.push(0, 1, 0);
        if (style.uv === 'keep' && guv) this.uv.push(guv.getX(i), guv.getY(i));
        else if (style.uv?.rect && guv) { const r = style.uv.rect; this.uv.push(lerp(r[0], r[2], guv.getX(i)), lerp(r[1], r[3], guv.getY(i))); }
        else if (style.uv === 'xz') { _v.fromBufferAttribute(p, i); if (matrix) _v.applyMatrix4(matrix); this.uv.push(_v.x, _v.z); }
        else if (style.uv === 'xy') { _v.fromBufferAttribute(p, i); if (matrix) _v.applyMatrix4(matrix); this.uv.push(_v.x, _v.y); }
        else if (style.uv === 'zy') { _v.fromBufferAttribute(p, i); if (matrix) _v.applyMatrix4(matrix); this.uv.push(_v.z, _v.y); }
        else if (Array.isArray(style.uv)) this.uv.push(style.uv[0], style.uv[1]);
        else this.uv.push(UV_WHITE[0], UV_WHITE[1]);
        this.col.push(cr, cg, cb); this.pbr.push(rough, metal, fx); this.lch.push(ch);
      }
    }
    if (g !== geom) g.dispose();
    return this;
  }

  /** Ajoute un triangle brut (positions/normales déjà en repère voiture). */
  tri(p, n, style, uvs) {
    _c.set(style.color ?? 0xffffff);
    for (let k = 0; k < 3; k++) {
      this.pos.push(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
      this.nor.push(n[k * 3], n[k * 3 + 1], n[k * 3 + 2]);
      if (uvs) this.uv.push(uvs[k * 2], uvs[k * 2 + 1]); else this.uv.push(UV_WHITE[0], UV_WHITE[1]);
      this.col.push(_c.r, _c.g, _c.b); this.pbr.push(style.rough ?? 0.6, style.metal ?? 0, style.fx ?? 0); this.lch.push(style.ch ?? 0);
    }
  }

  append(o) {
    for (const k of ['pos', 'nor', 'uv', 'col', 'pbr', 'lch']) { const a = this[k], b = o[k]; for (let i = 0; i < b.length; i++) a.push(b[i]); }
    return this;
  }

  build(attrs = ['uv', 'color', 'pbr', 'lch']) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (attrs.includes('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (attrs.includes('color')) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (attrs.includes('pbr')) g.setAttribute('pbr', new THREE.Float32BufferAttribute(this.pbr, 3));
    if (attrs.includes('lch')) g.setAttribute('lch', new THREE.Float32BufferAttribute(this.lch, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** Matrice de transformation pratique. */
export function mat(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
}

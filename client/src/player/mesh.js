// Primitives de construction de maillage pour les personnages : tubes à sections profilées, balayages le long
// d'un chemin, carreaux paramétriques. Chaque sommet porte : position, uv (dans un atlas de tuiles), 2 os + poids,
// index de couleur (palette du personnage). Les normales sont lissées avec soudure par position.

export const ATLAS_COLS = 8, ATLAS_ROWS = 4;
const INSET = 0.02;

/** Coordonnées d'atlas pour la tuile `tile` (u, v locaux 0..1 ; v = 0 en bas de la tuile). */
export function atlasU(tile, u) { return ((tile % ATLAS_COLS) + INSET + Math.min(1, Math.max(0, u)) * (1 - 2 * INSET)) / ATLAS_COLS; }
export function atlasV(tile, v) { return 1 - (Math.floor(tile / ATLAS_COLS) + 1 - (INSET + Math.min(1, Math.max(0, v)) * (1 - 2 * INSET))) / ATLAS_ROWS; }

const sgnPow = (c, e) => (c < 0 ? -Math.pow(-c, e) : Math.pow(c, e));
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

/** Interpolation Catmull-Rom de clés {y, ...champs numériques} triées par y croissant. */
export function sampleKeys(keys, y, out = {}) {
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && keys[i + 1].y < y) i++;
  const k1 = keys[i], k2 = keys[i + 1], k0 = keys[Math.max(0, i - 1)], k3 = keys[Math.min(n - 1, i + 2)];
  const t = Math.min(1, Math.max(0, (y - k1.y) / (k2.y - k1.y || 1)));
  const t2 = t * t, t3 = t2 * t;
  for (const f in k1) {
    if (f === 'y') continue;
    const p1 = k1[f], p2 = k2[f] ?? p1;
    // tangentes pondérées par l'espacement réel des clés (évite les dépassements)
    const m1 = k0 === k1 ? p2 - p1 : ((p2 - (k0[f] ?? p1)) / (k2.y - k0.y)) * (k2.y - k1.y);
    const m2 = k3 === k2 ? p2 - p1 : (((k3[f] ?? p2) - p1) / (k3.y - k1.y)) * (k2.y - k1.y);
    out[f] = (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
  }
  out.y = y;
  return out;
}

/** Point d'une section profilée (superellipse, rayons avant/arrière distincts). u = 0 dos, 0.25 = +X, 0.5 = devant (−Z). */
export function ringPoint(r, u, out) {
  const a = Math.PI / 2 - u * Math.PI * 2;
  const e = 2 / (r.n || 2);
  const c = sgnPow(Math.cos(a), e), s = sgnPow(Math.sin(a), e);
  out[0] = (r.x || 0) + c * r.rx; out[1] = r.y; out[2] = (r.z || 0) + s * (s < 0 ? r.rf ?? r.rx : r.rb ?? r.rf ?? r.rx);
  return out;
}
/** z de la surface avant d'une section à l'abscisse x. */
export function frontZ(r, x) {
  const k = Math.min(1, Math.abs((x - (r.x || 0)) / r.rx)), n = r.n || 2;
  return (r.z || 0) - (r.rf ?? r.rx) * Math.pow(1 - Math.pow(k, n), 1 / n);
}
export function backZ(r, x) {
  const k = Math.min(1, Math.abs((x - (r.x || 0)) / r.rx)), n = r.n || 2;
  return (r.z || 0) + (r.rb ?? r.rf ?? r.rx) * Math.pow(1 - Math.pow(k, n), 1 / n);
}

const S = { b0: 0, w0: 1, b1: 0 };
const P3 = [0, 0, 0];

export class MeshBuilder {
  constructor() { this.p = []; this.uv = []; this.si = []; this.sw = []; this.col = []; this.idx = []; }
  get count() { return this.col.length; }

  /** skin : [b0, w0, b1] ou fn(x, y, z, S) qui remplit S.b0 / S.w0 / S.b1. */
  vert(x, y, z, tile, u, v, skin, col) {
    if (typeof skin === 'function') { S.b0 = 0; S.w0 = 1; S.b1 = 0; skin(x, y, z, S); } else { S.b0 = skin[0]; S.w0 = skin[1] ?? 1; S.b1 = skin[2] ?? skin[0]; }
    this.p.push(x, y, z); this.uv.push(atlasU(tile, u), atlasV(tile, v));
    this.si.push(S.b0, S.b1); this.sw.push(S.w0);
    this.col.push(col);
    return this.col.length - 1;
  }
  /**
   * Oriente vers l'extérieur les triangles ajoutés depuis l'index i0 (ombres et éclairage cohérents).
   * mode 'vol' : volume signé (pièces fermées ou en dôme) ; 'radial' : la normale moyenne s'éloigne de l'axe du corps.
   */
  orient(i0, v0, mode) {
    const p = this.p, idx = this.idx;
    let cx = 0, cy = 0, cz = 0; const nv = this.count - v0;
    for (let i = v0; i < this.count; i++) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; }
    cx /= nv; cy /= nv; cz /= nv;
    let s = 0;
    for (let t = i0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ax = p[a] - cx, ay = p[a + 1] - cy, az = p[a + 2] - cz, bx = p[b] - cx, by = p[b + 1] - cy, bz = p[b + 2] - cz, dx = p[c] - cx, dy = p[c + 1] - cy, dz = p[c + 2] - cz;
      if (mode === 'vol') s += ax * (by * dz - bz * dy) + ay * (bz * dx - bx * dz) + az * (bx * dy - by * dx);
      else { const nx = (by - ay) * (dz - az) - (bz - az) * (dy - ay), nz = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax); s += nx * cx + nz * (cz - 0.0); }
    }
    if (s < 0) for (let t = i0; t < idx.length; t += 3) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
  }
  quadGrid(base, cols, rows) {
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const a = base + j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      this.idx.push(a, b, c, b, d, c);
    }
  }

  /**
   * Tube vertical. rings : sections {x, y, z, rx, rf, rb, n} par y croissant.
   * opts : seg, tile, col, skin, v0/v1 (plage de y pour v ; défaut : étendue du tube), warp(u) (répartition angulaire),
   *        disp(pt, u, ring) (déformation), xf(pt) (transformation finale), capTop, capBottom, u0/u1 (arc partiel), uv(u, v, pt, out)
   */
  tube(rings, o) {
    const seg = o.seg || 12, cols = seg + 1, base = this.count, i0 = this.idx.length;
    const y0 = o.v0 ?? rings[0].y, y1 = o.v1 ?? rings[rings.length - 1].y;
    const ua = o.u0 ?? 0, ub = o.u1 ?? 1, UV = [0, 0];
    for (const r of rings) {
      for (let i = 0; i < cols; i++) {
        const u = ua + (ub - ua) * (i / seg);
        ringPoint(r, o.warp ? o.warp(u) : u, P3);
        if (o.disp) o.disp(P3, u, r);
        UV[0] = u; UV[1] = (r.v ?? (r.y - y0) / (y1 - y0 || 1));
        if (o.uv) o.uv(u, UV[1], P3, UV);
        if (o.xf) o.xf(P3);
        this.vert(P3[0], P3[1], P3[2], r.tile ?? o.tile, UV[0], UV[1], o.skin, typeof o.col === 'function' ? o.col(u, r, P3) : r.col ?? o.col);
      }
    }
    this.quadGrid(base, cols, rings.length);
    const cap = (r, j) => {
      P3[0] = r.x || 0; P3[1] = r.y; P3[2] = (r.z || 0) + ((r.rb ?? r.rx) - (r.rf ?? r.rx)) / 2;
      if (o.xf) o.xf(P3);
      const c = this.vert(P3[0], P3[1], P3[2], o.tile, 0.5, 0.5, o.skin, r.col ?? (typeof o.col === 'function' ? o.col(0, r, P3) : o.col));
      for (let i = 0; i < seg; i++) { if (j) this.idx.push(c, base + j * cols + i + 1, base + j * cols + i); else this.idx.push(c, base + j * cols + i, base + j * cols + i + 1); }
    };
    if (o.capBottom) cap(rings[0], 0);
    if (o.capTop) cap(rings[rings.length - 1], rings.length - 1);
    this.orient(i0, base, o.u0 != null ? 'radial' : 'vol');
    return base;
  }

  /**
   * Balayage d'une section elliptique le long d'un chemin [{x, y, z, rx, rz}] (rx : dans le plan « côté », rz : selon `up`).
   * opts : seg, tile, col, skin, closed, caps, up [x,y,z] (référence d'orientation)
   */
  sweep(path, o) {
    const seg = o.seg || 6, cols = seg + 1, n = path.length, base = this.count, i0 = this.idx.length;
    const up = o.up || [0, 0, 1];
    for (let j = 0; j < n; j++) {
      const p = path[j];
      const a = path[o.closed ? (j - 1 + n) % n : Math.max(0, j - 1)], b = path[o.closed ? (j + 1) % n : Math.min(n - 1, j + 1)];
      let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // N = up × T (repli si colinéaires), B = T × N
      let nx = up[1] * tz - up[2] * ty, ny = up[2] * tx - up[0] * tz, nz = up[0] * ty - up[1] * tx;
      let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-4) { nx = 1; ny = 0; nz = 0; nl = 1; }
      nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      for (let i = 0; i < cols; i++) {
        const ang = (i / seg) * Math.PI * 2, c = Math.cos(ang) * p.rx, s = Math.sin(ang) * (p.rz ?? p.rx);
        this.vert(p.x + nx * c + bx * s, p.y + ny * c + by * s, p.z + nz * c + bz * s, o.tile, i / seg, p.v ?? j / (n - 1), o.skin, p.col ?? o.col);
      }
    }
    this.quadGrid(base, cols, n);
    if (o.closed) for (let i = 0; i < seg; i++) { const a = base + (n - 1) * cols + i, c = base + i; this.idx.push(a, a + 1, c, a + 1, c + 1, c); }
    if (o.caps && !o.closed) for (const j of [0, n - 1]) {
      const p = path[j], c = this.vert(p.x, p.y, p.z, o.tile, 0.5, 0.5, o.skin, p.col ?? o.col);
      for (let i = 0; i < seg; i++) { if (j) this.idx.push(c, base + j * cols + i + 1, base + j * cols + i); else this.idx.push(c, base + j * cols + i, base + j * cols + i + 1); }
    }
    this.orient(i0, base, 'vol');
    return base;
  }

  /** Carreau paramétrique : fn(u, v, out[3]) pour u, v ∈ [0, 1]. opts : nu, nv, tile, col, skin, uv(u, v, out[2]) */
  patch(fn, o) {
    const nu = o.nu || 2, nv = o.nv || 2, base = this.count, UV = [0, 0], i0 = this.idx.length;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      fn(u, v, P3);
      UV[0] = u; UV[1] = v; if (o.uv) o.uv(u, v, UV);
      this.vert(P3[0], P3[1], P3[2], o.tile, UV[0], UV[1], o.skin, o.col);
    }
    this.quadGrid(base, nu + 1, nv + 1);
    this.orient(i0, base, o.orient || 'radial');
    return base;
  }

  /** Boîte arrondie (tube à section quasi rectangulaire) centrée en (x, y, z), demi-dimensions (hx, hy, hz). */
  box(x, y, z, hx, hy, hz, o) {
    const r = Math.min(hy * 0.35, 0.02);
    return this.tube([
      { x, z, y: y - hy, rx: hx * 0.8, rf: hz * 0.8, rb: hz * 0.8, n: o.n || 5 },
      { x, z, y: y - hy + r, rx: hx, rf: hz, rb: hz, n: o.n || 5 },
      { x, z, y: y + hy - r, rx: hx, rf: hz, rb: hz, n: o.n || 5 },
      { x, z, y: y + hy, rx: hx * 0.8, rf: hz * 0.8, rb: hz * 0.8, n: o.n || 5 },
    ], { seg: 8, capTop: true, capBottom: true, ...o });
  }

  /** Ajoute un autre maillage (pièces mises en cache). */
  append(m) {
    const off = this.count;
    for (const k of ['p', 'uv', 'si', 'sw', 'col']) { const a = this[k], b = m[k]; for (let i = 0; i < b.length; i++) a.push(b[i]); }
    for (let i = 0; i < m.idx.length; i++) this.idx.push(m.idx[i] + off);
  }

  /** Tableaux typés finaux (normales lissées, sommets confondus soudés pour le calcul). */
  finish() {
    const n = this.count, pos = new Float32Array(this.p), idx = n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
    const nrm = new Float32Array(n * 3);
    // soudure : même position -> même accumulateur
    const rep = new Int32Array(n), map = new Map();
    for (let i = 0; i < n; i++) {
      const key = (Math.round((pos[i * 3] + 2) * 4000) * 20000 + Math.round((pos[i * 3 + 1] + 1) * 4000)) * 20000 + Math.round((pos[i * 3 + 2] + 2) * 4000); // exact (< 2^53)
      const j = map.get(key);
      if (j === undefined) { map.set(key, i); rep[i] = i; } else rep[i] = j;
    }
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      for (const v of [idx[t], idx[t + 1], idx[t + 2]]) { const r = rep[v] * 3; nrm[r] += nx; nrm[r + 1] += ny; nrm[r + 2] += nz; }
    }
    for (let i = 0; i < n; i++) {
      const r = rep[i] * 3;
      let x = nrm[r], y = nrm[r + 1], z = nrm[r + 2];
      if (rep[i] !== i) { nrm[i * 3] = x; nrm[i * 3 + 1] = y; nrm[i * 3 + 2] = z; continue; }
      const l = Math.hypot(x, y, z);
      if (l > 1e-12) { x /= l; y /= l; z /= l; } else { x = 0; y = 1; z = 0; }
      nrm[r] = x; nrm[r + 1] = y; nrm[r + 2] = z;
    }
    // (les représentants sont normalisés avant d'être recopiés : second passage pour les copies faites trop tôt)
    for (let i = 0; i < n; i++) if (rep[i] !== i) { const r = rep[i] * 3; nrm[i * 3] = nrm[r]; nrm[i * 3 + 1] = nrm[r + 1]; nrm[i * 3 + 2] = nrm[r + 2]; }
    const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const w = Math.min(1, Math.max(0, this.sw[i]));
      skinIndex[i * 4] = this.si[i * 2]; skinIndex[i * 4 + 1] = this.si[i * 2 + 1];
      skinWeight[i * 4] = w; skinWeight[i * 4 + 1] = 1 - w;
    }
    return { count: n, position: pos, normal: nrm, uv: new Float32Array(this.uv), skinIndex, skinWeight, part: new Uint8Array(this.col), index: idx };
  }
}

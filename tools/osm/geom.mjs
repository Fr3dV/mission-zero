// Petites fonctions de géométrie 2D (plan x,z) utilisées par build.mjs et check.mjs.

export const r1 = (v) => Math.round(v * 10) / 10 || 0; // arrondi 0,1 m (et -0 -> 0)

export function polyArea(p) { // aire signée (formule du lacet) dans le plan (x,z)
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) { const q = p[(i + 1) % n]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return a / 2;
}
export function centroid(p) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[(i + 1) % n], c = p[i][0] * q[1] - q[0] * p[i][1];
    a += c; cx += (p[i][0] + q[0]) * c; cz += (p[i][1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) return p[0];
  return [cx / (3 * a), cz / (3 * a)];
}
export function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function polylineLength(p) {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}
export function distPointSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

// Douglas-Peucker sur une polyligne ouverte (les extrémités sont conservées).
export function simplify(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distPointSeg(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// Simplification d'un anneau fermé (sans point de fermeture répété).
export function simplifyRing(ring, tol) {
  if (ring.length < 5) return ring.slice();
  // on coupe l'anneau en deux au point le plus éloigné du premier, pour garder deux ancres stables
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = simplify(ring.slice(0, far + 1), tol);
  const b = simplify(ring.slice(far).concat([ring[0]]), tol);
  return a.concat(b.slice(1, -1));
}
export function dedupeRing(ring, eps = 0.05) {
  const out = [];
  for (const p of ring) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p); }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
  return out;
}

// Découpe d'un polygone par un demi-plan (Sutherland-Hodgman) : garde n·p <= c.
export function clipHalfPlane(poly, nx, nz, c) {
  const out = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const da = nx * a[0] + nz * a[1] - c, db = nx * b[0] + nz * b[1] - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
  }
  return out;
}
export function clipRect(poly, r) {
  let p = clipHalfPlane(poly, 1, 0, r.maxX);
  p = clipHalfPlane(p, -1, 0, -r.minX);
  p = clipHalfPlane(p, 0, 1, r.maxZ);
  p = clipHalfPlane(p, 0, -1, -r.minZ);
  return dedupeRing(p);
}
// Découpe d'une polyligne par un rectangle : retourne la liste des morceaux intérieurs.
// Chaque point est {x,z,id} ; les points créés sur le bord reçoivent un id synthétique.
let synth = 0;
export function clipPolyline(pts, r) {
  const inside = (p) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
  const cross = (a, b) => { // a dedans, b dehors : point de sortie
    let t = 1;
    const dx = b.x - a.x, dz = b.z - a.z;
    if (dx > 0) t = Math.min(t, (r.maxX - a.x) / dx); if (dx < 0) t = Math.min(t, (r.minX - a.x) / dx);
    if (dz > 0) t = Math.min(t, (r.maxZ - a.z) / dz); if (dz < 0) t = Math.min(t, (r.minZ - a.z) / dz);
    return { x: a.x + t * dx, z: a.z + t * dz, id: 'c' + ++synth };
  };
  const runs = []; let cur = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], pin = inside(p);
    if (pin) {
      if (!cur) { cur = []; if (i > 0) cur.push(cross(p, pts[i - 1])); }
      cur.push(p);
    } else if (cur) { cur.push(cross(pts[i - 1], p)); runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs.filter((x) => x.length >= 2);
}

function segInter(a, b, c, d) { // intersection stricte (croisement propre) de deux segments
  const o = (p, q, s) => (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
export function selfIntersects(p) {
  const n = p.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segInter(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
  }
  return false;
}

export function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
// Rectangle orienté d'aire minimale. Retourne {cx, cz, w, d, ux, uz} : w le long de u=(ux,uz), d le long de la perpendiculaire.
export function minAreaRect(points) {
  const h = convexHull(points);
  if (h.length < 3) return null;
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    let ux = b[0] - a[0], uz = b[1] - a[1]; const l = Math.hypot(ux, uz);
    if (l < 1e-6) continue; ux /= l; uz /= l;
    let mnU = Infinity, mxU = -Infinity, mnV = Infinity, mxV = -Infinity;
    for (const q of h) {
      const u = q[0] * ux + q[1] * uz, v = -q[0] * uz + q[1] * ux;
      if (u < mnU) mnU = u; if (u > mxU) mxU = u; if (v < mnV) mnV = v; if (v > mxV) mxV = v;
    }
    const area = (mxU - mnU) * (mxV - mnV);
    if (!best || area < best.area) {
      const cu = (mnU + mxU) / 2, cv = (mnV + mxV) / 2;
      best = { area, w: mxU - mnU, d: mxV - mnV, ux, uz, cx: cu * ux - cv * uz, cz: cu * uz + cv * ux };
    }
  }
  return best;
}

// Assemble des tronçons (listes de points [x,z]) en anneaux fermés, par coïncidence des extrémités.
export function assembleRings(ways) {
  const key = (p) => p[0].toFixed(3) + ',' + p[1].toFixed(3);
  const rings = [], open = [];
  for (const w of ways) {
    if (w.length < 2) continue;
    if (key(w[0]) === key(w[w.length - 1])) { if (w.length >= 4) rings.push(w.slice(0, -1)); } else open.push(w.slice());
  }
  while (open.length) {
    let cur = open.pop(), grown = true;
    while (grown && key(cur[0]) !== key(cur[cur.length - 1])) {
      grown = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i], e = key(cur[cur.length - 1]);
        if (key(w[0]) === e) { cur = cur.concat(w.slice(1)); } else if (key(w[w.length - 1]) === e) { cur = cur.concat(w.slice().reverse().slice(1)); } else continue;
        open.splice(i, 1); grown = true; break;
      }
    }
    if (key(cur[0]) === key(cur[cur.length - 1]) && cur.length >= 4) rings.push(cur.slice(0, -1));
    // sinon : anneau incomplet (coupé par l'emprise de la requête), ignoré
  }
  return rings;
}

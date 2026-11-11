// Roues procédurales : pneu (profil tourné), jante détaillée (plusieurs dessins), disque de frein.
// Géométrie construite pour le côté DROIT (face extérieure vers +X, axe de rotation = X).
import * as THREE from 'three';
import { GeoBuilder, mat } from './geo.js';

const TIRE = { color: 0x0b0b0c, rough: 0.9, metal: 0 };

function lathe(pts, seg) {
  // profil [rayon, axial] → révolution autour de X
  const g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg);
  g.rotateZ(-Math.PI / 2); // axe Y → axe X
  return g;
}

/** Rayon tapered box : rayon de r0 à r1, largeur w0→w1 (tangentielle), épaisseur e (axiale). */
function spokeGeo(r0, r1, w0, w1, e, x0, x1) {
  // 8 sommets : extrémité moyeu (r0) et extrémité jante (r1) ; x0/x1 = position axiale aux deux bouts
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getY(i) + 0.5; // 0 = moyeu, 1 = jante
    const w = (w0 + (w1 - w0) * u) * p.getZ(i);
    const x = (x0 + (x1 - x0) * u) + p.getX(i) * e;
    p.setXYZ(i, x, r0 + (r1 - r0) * u, w);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * @param o {R, W, style, rimColor, rimRough, rimMetal, lod}
 * styles : 'five' | 'twin5' | 'multi' | 'y5' | 'aero' | 'cyber' | 'cap' | 'mesh'
 */
export function buildWheelGeometry(o) {
  const b = new GeoBuilder();
  addWheel(b, o, null);
  return b.build(['uv', 'color', 'pbr']);
}

/** Ajoute une roue dans un GeoBuilder (matrice optionnelle) — sert aussi à la version LOD statique. */
export function addWheel(b, o, matrix) {
  const R = o.R, W = o.W, hw = W / 2;
  const rimR = R * (o.rimRatio ?? 0.7);
  const seg = o.lod ? 12 : 30;
  const rim = { color: o.rimColor ?? 0xc9ccd0, rough: o.rimRough ?? 0.28, metal: o.rimMetal ?? 0.95 };
  const M = (m) => (matrix ? matrix.clone().multiply(m || new THREE.Matrix4()) : m || null);

  // pneu
  const sh = Math.min(0.03, (R - rimR) * 0.45);
  if (o.lod) {
    // version très légère : cylindre + flasque
    const g = new THREE.CylinderGeometry(R, R, W, 10, 1, false); g.rotateZ(-Math.PI / 2);
    b.add(g, M(), TIRE);
    b.add(new THREE.CircleGeometry(rimR, 10), M(mat(hw + 0.002, 0, 0, 0, Math.PI / 2, 0)), { ...rim, rough: 0.45 });
    return;
  }
  const prof = [[rimR, -hw * 0.9], [rimR + 0.012, -hw], [R - sh, -hw], [R - sh * 0.25, -hw * 0.84], [R, -hw * 0.66]];
  for (const g of [-0.36, 0, 0.36]) { const a = g * hw, gw = Math.min(0.009, hw * 0.07); prof.push([R, a - gw * 1.6], [R - 0.009, a - gw], [R - 0.009, a + gw], [R, a + gw * 1.6]); } // rainures
  prof.push([R, hw * 0.66], [R - sh * 0.25, hw * 0.84], [R - sh, hw], [rimR + 0.012, hw], [rimR, hw * 0.9]);
  b.add(lathe(prof, seg), M(), TIRE);
  if (!o.lod) {
    // flanc extérieur avec marquages (motif procédural fx = 3, uv polaire)
    const r0 = rimR + 0.012, r1 = R - sh, n = 40, x = hw + 0.0015;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const P = (a, r) => { const v = new THREE.Vector3(x, Math.cos(a) * r, Math.sin(a) * r); if (matrix) v.applyMatrix4(matrix); return v; };
      const A = P(a0, r0), B = P(a1, r0), C = P(a1, r1), D = P(a0, r1);
      const nrm = new THREE.Vector3(1, 0, 0); if (matrix) nrm.transformDirection(matrix);
      const N = [nrm.x, nrm.y, nrm.z, nrm.x, nrm.y, nrm.z, nrm.x, nrm.y, nrm.z];
      const st = { color: 0x141415, rough: 0.85, metal: 0, fx: 3 };
      b.tri([A.x, A.y, A.z, C.x, C.y, C.z, B.x, B.y, B.z], N, st, [k / n, 0, (k + 1) / n, 1, (k + 1) / n, 0]);
      b.tri([A.x, A.y, A.z, D.x, D.y, D.z, C.x, C.y, C.z], N, st, [k / n, 0, k / n, 1, (k + 1) / n, 1]);
    }
  }

  // rebord + fût de jante (surface intérieure visible)
  b.add(lathe([[rimR * 0.9, -hw * 0.7], [rimR * 0.93, hw * 0.45], [rimR - 0.012, hw * 0.88], [rimR + 0.004, hw * 0.93], [rimR + 0.006, hw * 0.9]].reverse(), seg), M(), rim);
  // fond sombre + disque de frein
  b.add(new THREE.CircleGeometry(rimR * 0.92, 20), M(mat(-hw * 0.35, 0, 0, 0, Math.PI / 2, 0)), { color: 0x050505, rough: 0.9, metal: 0 });
  const discR = rimR * (o.discRatio ?? 0.8);
  b.add(new THREE.RingGeometry(discR * 0.42, discR, 24), M(mat(hw * 0.12, 0, 0, 0, Math.PI / 2, 0)), { color: 0x8d9094, rough: 0.38, metal: 1 });
  b.add(new THREE.CylinderGeometry(discR * 0.44, discR * 0.44, hw * 0.5, 16), M(mat(hw * 0.25, 0, 0, 0, 0, Math.PI / 2)), { color: 0x2a2b2e, rough: 0.5, metal: 0.8 });

  const xo = hw * 0.84; // plan de la face de jante
  const dish = o.dish ?? 0.045; // creux des branches vers le moyeu
  const hubR = rimR * 0.2;
  const spoke = (ang, r0, r1, w0, w1, e, x0, x1, st = rim) => b.add(spokeGeo(r0, r1, w0, w1, e, x0, x1), M(mat(0, 0, 0, ang, 0, 0)), st);
  const style = o.style || 'five';
  const rEnd = rimR * 0.965;
  if (style === 'five') {
    for (let i = 0; i < 5; i++) spoke((i / 5) * Math.PI * 2, hubR * 0.6, rEnd, rimR * 0.34, rimR * 0.2, 0.03, xo - dish, xo + 0.002);
  } else if (style === 'twin5') {
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
      b.add(spokeGeo(hubR * 0.6, rEnd, rimR * 0.09, rimR * 0.075, 0.03, xo - dish, xo + 0.002), M(mat(0, 0, 0, (i / 5) * Math.PI * 2 + s * 0.13, 0, 0).multiply(mat(0, 0, s * rimR * 0.06))), rim);
    }
  } else if (style === 'multi') {
    for (let i = 0; i < 10; i++) spoke((i / 10) * Math.PI * 2, hubR * 0.7, rEnd, rimR * 0.1, rimR * 0.13, 0.028, xo - dish, xo + 0.002);
  } else if (style === 'mesh') {
    for (let i = 0; i < 14; i++) spoke((i / 14) * Math.PI * 2, hubR * 0.7, rEnd, rimR * 0.06, rimR * 0.06, 0.024, xo - dish, xo + 0.002);
  } else if (style === 'y5') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      spoke(a, hubR * 0.5, rimR * 0.52, rimR * 0.2, rimR * 0.13, 0.03, xo - dish, xo - dish * 0.45);
      for (const s of [-1, 1]) {
        b.add(spokeGeo(0, rimR * 0.52, rimR * 0.085, rimR * 0.07, 0.028, xo - dish * 0.45, xo + 0.002),
          M(mat(0, 0, 0, a, 0, 0).multiply(mat(0, rimR * 0.5, 0, s * 0.42, 0, 0))), rim);
      }
    }
  } else if (style === 'aero') {
    // enjoliveur aérodynamique : disque sombre + 5 pales larges
    b.add(new THREE.CircleGeometry(rimR * 0.97, 30), M(mat(xo - 0.012, 0, 0, 0, Math.PI / 2, 0)), { color: 0x1b1c1f, rough: 0.5, metal: 0.4 });
    for (let i = 0; i < 5; i++) spoke((i / 5) * Math.PI * 2 + 0.2, hubR, rEnd, rimR * 0.2, rimR * 0.5, 0.012, xo - 0.006, xo, { color: 0x53565b, rough: 0.4, metal: 0.8 });
  } else if (style === 'cyber') {
    b.add(new THREE.CircleGeometry(rimR * 0.985, 30), M(mat(xo - 0.004, 0, 0, 0, Math.PI / 2, 0)), { color: 0x101113, rough: 0.6, metal: 0.3 });
    for (let i = 0; i < 7; i++) spoke((i / 7) * Math.PI * 2, hubR * 1.2, rEnd, rimR * 0.1, rimR * 0.3, 0.014, xo, xo + 0.004, { color: 0x1c1d20, rough: 0.5, metal: 0.4 });
  } else { // 'cap' : enjoliveur de citadine
    b.add(new THREE.CircleGeometry(rimR * 0.97, 30), M(mat(xo - 0.015, 0, 0, 0, Math.PI / 2, 0)), { color: 0x9da1a6, rough: 0.4, metal: 0.8 });
    for (let i = 0; i < 8; i++) spoke((i / 8) * Math.PI * 2, hubR, rEnd, rimR * 0.2, rimR * 0.26, 0.012, xo - 0.006, xo, { color: 0xc4c7cb, rough: 0.35, metal: 0.9 });
  }
  // moyeu / cache central + écrous
  const flat = style === 'aero' || style === 'cyber' || style === 'cap';
  const hx = flat ? xo - 0.004 : xo - dish - 0.004;
  b.add(new THREE.CylinderGeometry(hubR, hubR * 1.15, 0.035, 16), M(mat(hx, 0, 0, 0, 0, -Math.PI / 2)), flat ? { color: 0x1b1c1f, rough: 0.4, metal: 0.6 } : rim);
  b.add(new THREE.CircleGeometry(hubR * 0.6, 12), M(mat(hx + 0.0185, 0, 0, 0, Math.PI / 2, 0)), { color: 0x111214, rough: 0.3, metal: 0.5 });
  if (!flat) for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3; b.add(new THREE.CylinderGeometry(0.011, 0.011, 0.02, 6), M(mat(hx + 0.012, Math.cos(a) * hubR * 1.5, Math.sin(a) * hubR * 1.5, 0, 0, Math.PI / 2)), { color: 0x9a9da1, rough: 0.3, metal: 1 }); }
  if (!flat) b.add(new THREE.CylinderGeometry(hubR * 2.1, hubR * 2.1, 0.012, 18), M(mat(hx - 0.012, 0, 0, 0, 0, Math.PI / 2)), rim);
}

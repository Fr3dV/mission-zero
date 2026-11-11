// Tour Eiffel (330 m) : quatre piliers courbes en treillis, arches, trois étages, campanile et antenne.
// Treillis = faces texturées (alpha) + membrures/traverses instanciées en 3D. Illumination dorée, scintillement, phare.
import * as THREE from 'three';
import { P, curve, rng } from './kit.js';

// demi-largeur extérieure de la tour et demi-écart intérieur entre piliers, en fonction de la hauteur
const W = curve([[0, 62.5], [57.6, 32.8], [115.7, 18.8], [196, 9.6], [276, 5.0], [300, 4.2]]);
const GAP = curve([[0, 37.5], [57.6, 17.6], [115.7, 9.2], [186, 0]]);
const gap = (h) => (h >= 186 ? 0 : Math.max(0, GAP(h)));
const H1 = 57.6, H2 = 115.7, HM = 186, H3 = 276;

export function buildEiffel(m) {
  const { B, kit, far } = m;
  const pos = [], uvs = [], samples = [];
  const PAD = 0.004;
  // quad a(u0,v0) b(u1,v0) c(u1,v1) d(u0,v1), motif p de l'atlas
  const quad = (a, b, c, d, p, v0, v1) => {
    const u0 = p / 4 + PAD, u1 = (p + 1) / 4 - PAD;
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    samples.push([a, b, c, d]);
  };
  // les 4 côtés : (s, h, depth) -> monde, pour le côté k (rotation de k × 90°)
  const side = (k, s, h, d) => { const c = Math.cos(k * Math.PI / 2), sn = Math.sin(k * Math.PI / 2); return [s * c + d * sn, h, -s * sn + d * c]; };

  // --- piliers : anneaux successifs ---
  const rings = [];
  const section = (h0, h1, n) => { for (let i = rings.length ? 1 : 0; i <= n; i++) rings.push(h0 + (h1 - h0) * i / n); };
  section(0, H1, 5); section(H1, H2, 6); section(H2, HM, 8); section(HM, H3, 11);
  const beams = [];
  const beam = (a, b, t) => beams.push([a, b, t]);
  for (let k = 0; k < rings.length - 1; k++) {
    const h0 = rings[k], h1 = rings[k + 1], w0 = W(h0), w1 = W(h1), g0 = gap(h0), g1 = gap(h1);
    const t = 1.15 - 0.6 * (h0 / H3);
    if (h1 <= HM + 0.01) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const c0 = [[sx * w0, sz * w0], [sx * w0, sz * g0], [sx * g0, sz * g0], [sx * g0, sz * w0]];
        const c1 = [[sx * w1, sz * w1], [sx * w1, sz * g1], [sx * g1, sz * g1], [sx * g1, sz * w1]];
        for (let f = 0; f < 4; f++) {
          const a = c0[f], b = c0[(f + 1) % 4], c = c1[(f + 1) % 4], d = c1[f];
          quad([a[0], h0, a[1]], [b[0], h0, b[1]], [c[0], h1, c[1]], [d[0], h1, d[1]], 0, k, k + 1);
          if (!far) {
            const A0 = [a[0], h0, a[1]], B0 = [b[0], h0, b[1]], C1 = [c[0], h1, c[1]], D1 = [d[0], h1, d[1]];
            beam(A0, D1, t); beam(D1, C1, t * 0.7);
            if (h1 <= H2 + 0.01 || f % 2 === 0) { beam(A0, C1, t * 0.42); beam(B0, D1, t * 0.42); }   // croix de Saint-André en volume
          }
        }
      }
    } else {
      // fût unique au-dessus de la jonction des piliers
      for (let f = 0; f < 4; f++) {
        const a = side(f, -w0, h0, w0), b = side(f, w0, h0, w0), c = side(f, w1, h1, w1), d = side(f, -w1, h1, w1);
        quad(a, b, c, d, 0, k, k + 1);
        if (!far) { beam(a, d, t); beam(d, c, t * 0.7); }
      }
    }
  }

  // --- arches décoratives sous le premier étage + écoinçons ---
  const A = 33.2, HC = 13, Bv = 35.5, TH = 3.4, NA = far ? 14 : 28, TOP = 52.5;
  const gapInv = (s) => { let lo = 0, hi = TOP; for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (GAP(mid) > s) lo = mid; else hi = mid; } return lo; };
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < NA; i++) {
      const f0 = Math.PI * i / NA, f1 = Math.PI * (i + 1) / NA;
      const pt = (f, r) => { const s = (A - r) * Math.cos(f), h = HC + (Bv - r) * Math.sin(f); return [s, h]; };
      const o0 = pt(f0, 0), o1 = pt(f1, 0), i0 = pt(f0, TH), i1 = pt(f1, TH);
      const P3 = ([s, h]) => side(k, s, h, W(h) - 0.15);
      quad(P3(i0), P3(o0), P3(o1), P3(i1), 1, i * 0.5, (i + 1) * 0.5);
      // écoinçon : de l'extrados jusqu'à la poutre du 1er étage ou au flanc du pilier
      const top = (s) => Math.min(TOP, Math.abs(s) > GAP(TOP) ? gapInv(Math.abs(s)) : TOP);
      const t0 = [o0[0], Math.max(o0[1], top(o0[0]))], t1 = [o1[0], Math.max(o1[1], top(o1[0]))];
      if (t0[1] - o0[1] > 0.5 || t1[1] - o1[1] > 0.5) quad(P3(o0), P3(t0), P3(t1), P3(o1), 2, o0[0] / 6, o1[0] / 6);
    }
  }

  // --- étages : frises en treillis, garde-corps, planchers ---
  const band = (h0, h1, hw, p, cell, inner) => {
    for (let k = 0; k < 4; k++) {
      const n = Math.max(1, Math.round(2 * hw / cell));
      quad(side(k, -hw, h0, hw), side(k, -hw, h1, hw), side(k, hw, h1, hw), side(k, hw, h0, hw), p, 0, n);
    }
    if (inner) band(h0, h1, inner, p, cell);
  };
  const deck = (h, hw, hole, th = 0.9) => {
    const d = hw - hole;
    B.box(P.ironD, hw * 2, th, d, 0, h, hw - d / 2); B.box(P.ironD, hw * 2, th, d, 0, h, -hw + d / 2);
    B.box(P.ironD, d, th, hole * 2, hw - d / 2, h, 0); B.box(P.ironD, d, th, hole * 2, -hw + d / 2, h, 0);
  };
  // 1er étage
  band(52.5, 57.8, 33.6, 1, 5.3, 17); deck(57.2, 35.2, 16.5); band(58.1, 60.8, 35.2, 3, 2.7);
  for (let k = 0; k < 4; k++) B.group(0, 0, 0, k * Math.PI / 2, () => {
    B.box(P.ironD, 26, 6.5, 9, 0, 58.1, 26, 0);                         // pavillons (restaurants)
    B.box(P.glassLit, 24, 2.6, 9.2, 0, 60, 26, 0, { jit: 0 });
    if (!far) B.box(P.gold, 60, 0.5, 0.25, 0, 55.6, 33.75, 0, { jit: 0 }); // frise des savants
  });
  // 2e étage
  band(110.5, 115.9, 19.6, 1, 5.4, 9.5); deck(115.4, 21.2, 7); band(116.3, 118.6, 21.2, 3, 2.3);
  for (let k = 0; k < 4; k++) B.group(0, 0, 0, k * Math.PI / 2, () => { B.box(P.ironD, 14, 4.2, 5, 0, 116.3, 16.5); B.box(P.glassLit, 13, 1.6, 5.2, 0, 117.6, 16.5, 0, { jit: 0 }); });
  // palier intermédiaire
  band(194.5, 197, 10.4, 1, 2.5); deck(196.6, 11.2, 0.01, 0.6); band(197.2, 198.8, 11.2, 3, 1.6);
  // 3e étage : encorbellement, galerie vitrée, terrasse grillagée, campanile
  B.frustum(P.ironD, 10.4, 10.4, 16.6, 16.6, 4, 0, 271, 0);
  B.box(P.iron, 16.8, 4.6, 16.8, 0, 275, 0); B.box(P.glassLit, 17, 1.8, 17, 0, 276.4, 0, 0, { jit: 0 });
  B.box(P.ironD, 17.6, 0.5, 17.6, 0, 279.6, 0);
  band(280.1, 282.6, 8.4, 3, 2.5);
  B.box(P.iron, 9.5, 5, 9.5, 0, 280.1, 0); B.box(P.glassLit, 9.7, 1.6, 9.7, 0, 282, 0, 0, { jit: 0 });
  B.frustum(P.ironD, 10.5, 10.5, 6.5, 6.5, 1.6, 0, 285.1, 0);
  B.cyl(P.iron, 3.1, 3.3, 5.5, 0, 286.7, 0, 12); B.dome(P.ironD, 3.5, 3.6, 0, 292.2, 0, 12);
  B.cyl(P.glassLit, 1.3, 1.3, 2.2, 0, 295.6, 0, 10, { jit: 0 });         // lanterne du phare
  B.cyl(P.ironD, 1.7, 1.7, 0.4, 0, 297.8, 0, 10);
  // antenne
  B.cyl(P.ironD, 0.8, 1.1, 14, 0, 298, 0, 8);
  for (const [y, r] of [[301, 2.0], [304.5, 1.8], [308, 1.6], [311.5, 1.3]]) B.cyl(P.iron, r, r, 1.6, 0, y, 0, 10);
  B.cyl(P.ironD, 0.22, 0.6, 18, 0, 312, 0, 6);

  // --- socles maçonnés des piliers (4 massifs par pilier) + collisions ---
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (const a of [40.5, 59.5]) for (const c of [40.5, 59.5]) B.frustum(P.stoneD, 8.5, 8.5, 6, 6, 3.6, sx * a, 0, sz * c, 0), B.box(P.stoneD, 9, 3, 9, sx * a, -3, sz * c);
    if (!far) B.box(P.ironD, 9, 7, 9, sx * 50, 0, sz * 50); // machinerie d'ascenseur au pied
    m.collide.box(sx * 50, sz * 50, 13.5, 13.5, 0, -100, 34);
  }

  // --- mesh du treillis ---
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals(); g.computeBoundingSphere();
  const lat = new THREE.Mesh(g, kit.lattice); lat.name = 'eiffel:treillis'; lat.castShadow = !far; lat.receiveShadow = false;
  m.add(lat);

  // --- poutres instanciées (membrures et traverses) ---
  if (!far && beams.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), kit.iron, beams.length);
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), a = new THREE.Vector3(), sc = new THREE.Vector3();
    beams.forEach(([p0, p1, t], i) => {
      a.set(...p0); dir.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); const len = dir.length(); dir.normalize();
      q.setFromUnitVectors(up, dir); sc.set(t, len, t); mt.compose(a, q, sc); im.setMatrixAt(i, mt);
    });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = true; im.name = 'eiffel:poutres';
    m.add(im);
  }

  // --- scintillement : points lumineux répartis sur la structure ---
  const NS = far ? 1400 : (kit.quality === 'low' ? 1800 : 3600), sp = new Float32Array(NS * 3), sd = new Float32Array(NS), r = rng(42);
  for (let i = 0; i < NS; i++) {
    const [a, b, c, d] = samples[Math.floor(r() * r() * samples.length) % samples.length] || samples[0], u = r(), v = r();
    for (let k = 0; k < 3; k++) sp[i * 3 + k] = (a[k] * (1 - u) + b[k] * u) * (1 - v) + (d[k] * (1 - u) + c[k] * u) * v;
    sd[i] = r();
  }
  // répartition plus régulière en hauteur : une partie des points directement sur les arêtes
  for (let i = 0; i < NS; i += 3) {
    const h = 300 * r(), w = W(h), s = Math.floor(r() * 4), e = r() < 0.5 ? -1 : 1, on = gap(h) > 0 ? (r() < 0.5 ? w : gap(h)) : w * (r() * 2 - 1);
    const p = side(s, e * on, h, w); sp[i * 3] = p[0]; sp[i * 3 + 1] = p[1]; sp[i * 3 + 2] = p[2];
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  const sm = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aSeed; uniform float uTime, uScale; varying float vA;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() { float t = floor(uTime * 9.0 + aSeed * 31.0); float f = step(0.9, hash(aSeed * 91.7 + t * 1.37));
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = f; gl_Position = projectionMatrix * mv;
        gl_PointSize = f * clamp(uScale * 2.6 / -mv.z, 2.0, 9.0); }`,
    fragmentShader: `varying float vA; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5 || vA < 0.5) discard; gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * (2.5 * smoothstep(0.5, 0.0, d)), 1.0); }`,
  });
  const sparkle = new THREE.Points(sg, sm); sparkle.name = 'eiffel:scintillement'; sparkle.visible = false; sparkle.frustumCulled = false;
  m.add(sparkle);

  // --- phare tournant (deux faisceaux opposés) ---
  const L = 1100, cone = new THREE.CylinderGeometry(1.0, 26, L, 14, 1, true).translate(0, -L / 2, 0).rotateZ(Math.PI / 2);
  const cc = new Float32Array(cone.attributes.position.count * 3);
  for (let i = 0; i < cone.attributes.position.count; i++) { const k = 1 - Math.abs(cone.attributes.position.getX(i)) / L; cc[i * 3] = k * 0.55; cc[i * 3 + 1] = k * 0.6; cc[i * 3 + 2] = k * 0.7; }
  cone.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  const c2 = cone.clone().rotateY(Math.PI);
  const bg = new THREE.BufferGeometry();
  for (const name of ['position', 'color']) { const a = cone.attributes[name].array, b = c2.attributes[name].array, o = new Float32Array(a.length * 2); o.set(a); o.set(b, a.length); bg.setAttribute(name, new THREE.BufferAttribute(o, 3)); }
  const ia = cone.index.array, idx = new Uint16Array(ia.length * 2); idx.set(ia); for (let i = 0; i < ia.length; i++) idx[ia.length + i] = ia[i] + cone.attributes.position.count;
  bg.setIndex(new THREE.BufferAttribute(idx, 1));
  const bm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beacon = new THREE.Mesh(bg, bm); beacon.position.y = 296.7; beacon.rotation.z = -0.02; beacon.visible = false; beacon.frustumCulled = false; beacon.name = 'eiffel:phare';
  m.add(beacon);

  // --- lueur dorée au sol sous la tour : une seule SpotLight (version proche uniquement) ---
  let spot = null;
  if (!far && kit.quality !== 'low') {
    spot = new THREE.SpotLight(0xffb450, 0, 170, 1.05, 0.7, 1.6); spot.position.set(0, 56, 0); spot.target.position.set(0, 0, 0); spot.castShadow = false; spot.name = 'eiffel:lueur';
    m.root.add(spot); m.root.add(spot.target);
  }

  m.onUpdate((dt, st, visible) => {
    if (!far) { kit.lattice.emissiveIntensity = st.night * 1.15; kit.iron.emissiveIntensity = st.night * 1.0; }
    if (spot) spot.intensity = st.night * 9000;
    if (!visible) return;
    const on = st.night > 0.5;
    beacon.visible = on;
    if (on) { bm.opacity = 0.13 * st.night; beacon.rotation.y = st.time * 0.55; }
    const tw = on && st.sparkle;
    sparkle.visible = tw;
    if (tw) { sm.uniforms.uTime.value = st.time; sm.uniforms.uScale.value = st.pxScale; }
  });
  return { height: 330 };
}

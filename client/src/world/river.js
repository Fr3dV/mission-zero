// La Seine : eau (shader), quais maçonnés avec parapets, ponts à arches.
import { L_STONE, L_PLAIN, L_SIDEWALK, createWaterNormal } from './textures.js';
import { Y_GROUND } from './streets.js';

const QUAY = [214, 206, 190], BRIDGE = [232, 222, 202], COPING = [226, 220, 208];
const Y_QUAY = 0.12, PARAPET_H = 1.02;

export function buildRiver(ctx, net, surf, masks) {
  const { THREE, scene, collision, WATER_LEVEL, heightAt } = ctx;
  const { roads } = net;

  // ---------- 1. tronçons de route au-dessus de l'eau = ponts
  const decks = []; // {r, sa, sb, W}
  const o = { _k: 0 }, o2 = { _k: 0 };
  for (const r of roads) {
    const n = Math.max(1, Math.ceil(r._len / 2));
    let start = -1, last = -1; const iv = [];
    for (let i = 0; i <= n; i++) {
      const s = (r._len * i) / n; net.pointAt(r, s, 0, o);
      if (masks.isWater(o.x, o.z)) { if (start < 0) start = s; last = s; }
      else if (start >= 0 && s - last > 6) { iv.push([start, last]); start = -1; }
    }
    if (start >= 0) iv.push([start, last]);
    for (const [a, b] of iv) {
      if (b - a < 6) continue;
      const W = r._hw + r._sw + (r._sw > 0 ? 0.9 : 0.5);
      decks.push({ r, sa: Math.max(0, a - 3), sb: Math.min(r._len, b + 3), W });
    }
  }
  // grille de points d'axe des tabliers (pour couper les parapets de quai au droit des ponts)
  const dgrid = new Map(), DC = 16;
  const dkey = (x, z) => (Math.floor(x / DC) + 2048) * 4096 + (Math.floor(z / DC) + 2048);
  for (const d of decks) {
    for (let s = d.sa - 6; s <= d.sb + 6; s += 1.5) {
      net.pointAt(d.r, Math.max(0, Math.min(d.r._len, s)), 0, o);
      const k = dkey(o.x, o.z); let a = dgrid.get(k); if (!a) dgrid.set(k, (a = [])); a.push(o.x, o.z, d.W);
    }
  }
  function nearDeck(x, z, pad) {
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      const a = dgrid.get(dkey(x + ix * DC, z + iz * DC)); if (!a) continue;
      for (let i = 0; i < a.length; i += 3) { const lim = a[i + 2] + pad; const dx = a[i] - x, dz = a[i + 1] - z; if (dx * dx + dz * dz < lim * lim) return true; }
    }
    return false;
  }

  // ---------- 2. quais : mur, couronnement, parapet (+ collision)
  const probe = Math.max(3, masks.texel * 1.7);
  const addParapetBox = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.3) return;
    collision.addBox({ x: (ax + bx) / 2, z: (az + bz) / 2, hw: len / 2 + 0.15, hd: 0.32, rot: Math.atan2(-(bz - az), bx - ax), top: PARAPET_H + 0.6, tag: 'parapet' });
  };
  const B = ctx.BOUNDS, CL = 140;
  const outside = (p) => p[0] < B.minX - CL || p[0] > B.maxX + CL || p[1] < B.minZ - CL || p[1] > B.maxZ + CL;
  const quayPolys = [...masks.riverPolys, ...masks.islands];
  for (const poly of quayPolys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (outside(a) && outside(b)) continue;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.5) continue;
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      const m = Math.max(1, Math.ceil(L / 8));
      let runA = null, runB = null; // tronçon de parapet en cours (pour fusionner les collisions)
      const flush = () => { if (runA) addParapetBox(runA[0], runA[1], runB[0], runB[1]); runA = null; };
      for (let k = 0; k < m; k++) {
        const t0 = k / m, t1 = (k + 1) / m;
        const ax = a[0] + (b[0] - a[0]) * t0, az = a[1] + (b[1] - a[1]) * t0, bx = a[0] + (b[0] - a[0]) * t1, bz = a[1] + (b[1] - a[1]) * t1;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        let nx = -dz, nz = dx;
        const wP = masks.isWater(mx + nx * probe, mz + nz * probe), wM = masks.isWater(mx - nx * probe, mz - nz * probe);
        if (wP === wM) { flush(); continue; }
        if (wP) { nx = -nx; nz = -nz; } // (nx,nz) pointe vers la terre
        const bld = surf.at(mx, mz);
        bld.wall(ax, az, bx, bz, -6.5, Y_QUAY, -6.5, Y_QUAY, -nx, -nz, L_STONE, QUAY, L * t0);
        // couronnement (déborde un peu sur l'eau, recouvre le bord du sol découpé par le masque)
        const c0 = -0.45, c1 = 1.7, c2 = 2.4;
        bld.flatQuad([ax + nx * c0, Y_QUAY, az + nz * c0], [bx + nx * c0, Y_QUAY, bz + nz * c0], [bx + nx * c1, Y_QUAY, bz + nz * c1], [ax + nx * c1, Y_QUAY, az + nz * c1], L_PLAIN, 3, COPING);
        bld.flatQuad([ax + nx * c1, Y_QUAY, az + nz * c1], [bx + nx * c1, Y_QUAY, bz + nz * c1], [bx + nx * c2, Y_GROUND - 0.01, bz + nz * c2], [ax + nx * c2, Y_GROUND - 0.01, az + nz * c2], L_SIDEWALK, 3, COPING);
        bld.wall(ax + nx * c0, az + nz * c0, bx + nx * c0, bz + nz * c0, Y_QUAY - 0.35, Y_QUAY, Y_QUAY - 0.35, Y_QUAY, -nx, -nz, L_PLAIN, COPING, L * t0);
        if (nearDeck(mx, mz, 0.2) || net.roadAtPad(mx + nx * 0.3, mz + nz * 0.3, 0.6, false)) { flush(); continue; }
        const px = nx * 0.3, pz = nz * 0.3;
        bld.prism(ax + px, az + pz, bx + px, bz + pz, 0.5, Y_QUAY, Y_QUAY, PARAPET_H, L_STONE, QUAY, true);
        if (!runA) runA = [ax + px, az + pz];
        runB = [bx + px, bz + pz];
      }
      flush();
    }
  }

  // ---------- 3. ponts
  for (const d of decks) {
    const { r, sa, sb, W } = d, L = sb - sa;
    const nSpan = Math.max(1, Math.round(L / 30)), Ls = L / nSpan, pw = Math.min(1.6, Ls * 0.12);
    const Y_PIER = -6.5, Y_SPRING = WATER_LEVEL + 0.5, Y_CROWN = -1.0, Y_TOP = Y_GROUND;
    const prof = []; // [s, yBas]
    for (let i = 0; i < nSpan; i++) {
      const s0 = sa + i * Ls;
      prof.push([s0, Y_PIER], [s0 + pw, Y_PIER], [s0 + pw, Y_SPRING]);
      const NA = 12;
      for (let k = 1; k < NA; k++) { const tau = k / NA, c = 2 * tau - 1; prof.push([s0 + pw + (Ls - 2 * pw) * tau, Y_SPRING + (Y_CROWN - Y_SPRING) * Math.sqrt(Math.max(0, 1 - c * c))]); }
      prof.push([s0 + Ls - pw, Y_SPRING], [s0 + Ls - pw, Y_PIER]);
    }
    prof.push([sb, Y_PIER]);
    for (let i = 0; i < prof.length - 1; i++) {
      const [s0, y0] = prof[i], [s1, y1] = prof[i + 1];
      net.pointAt(r, s0, W, o); const lx0 = o.x, lz0 = o.z; net.pointAt(r, s0, -W, o); const rx0 = o.x, rz0 = o.z;
      net.pointAt(r, s1, W, o2); const lx1 = o2.x, lz1 = o2.z; net.pointAt(r, s1, -W, o2); const rx1 = o2.x, rz1 = o2.z;
      const bld = surf.at(lx0, lz0);
      const nx = o2.dz, nz = -o2.dx; // normale gauche
      if (s1 - s0 > 0.01) {
        bld.wall(lx0, lz0, lx1, lz1, y0, Y_TOP, y1, Y_TOP, nx, nz, L_STONE, BRIDGE, s0);
        bld.wall(rx0, rz0, rx1, rz1, y0, Y_TOP, y1, Y_TOP, -nx, -nz, L_STONE, BRIDGE, s0);
      }
      // intrados (ou face de pile si s0 == s1)
      const vertical = s1 - s0 <= 0.01;
      const sl = Math.hypot(s1 - s0, y1 - y0) || 1;
      const ny = vertical ? 0 : -(s1 - s0) / sl, nl = vertical ? (i % 2 ? 1 : -1) : (y1 - y0) / sl;
      const a0 = bld.v(lx0, y0, lz0, 0, s0 + y0, L_STONE, 0, 1, [150, 144, 132], o2.dx * nl, ny, o2.dz * nl);
      const a1 = bld.v(rx0, y0, rz0, 2 * W, s0 + y0, L_STONE, 0, 1, [150, 144, 132], o2.dx * nl, ny, o2.dz * nl);
      const a2 = bld.v(rx1, y1, rz1, 2 * W, s0 + sl + y0, L_STONE, 0, 1, [150, 144, 132], o2.dx * nl, ny, o2.dz * nl);
      const a3 = bld.v(lx1, y1, lz1, 0, s0 + sl + y0, L_STONE, 0, 1, [150, 144, 132], o2.dx * nl, ny, o2.dz * nl);
      bld.idx.push(a0, a1, a2, a0, a2, a3, a0, a2, a1, a0, a3, a2);
    }
    // corniche + parapets (collision)
    const pOff = W - 0.3;
    const cum = r._cum; const brk = [sa];
    for (let k = 0; k < cum.length; k++) if (cum[k] > sa + 0.5 && cum[k] < sb - 0.5) brk.push(cum[k]);
    brk.push(sb);
    for (let i = 0; i < brk.length - 1; i++) {
      const m = Math.max(1, Math.ceil((brk[i + 1] - brk[i]) / 14));
      for (let k = 0; k < m; k++) {
        const s0 = brk[i] + ((brk[i + 1] - brk[i]) * k) / m, s1 = brk[i] + ((brk[i + 1] - brk[i]) * (k + 1)) / m;
        for (const sg of [1, -1]) {
          net.pointAt(r, s0 + 1e-3, sg * pOff, o); net.pointAt(r, s1 - 1e-3, sg * pOff, o2);
          const bld = surf.at(o.x, o.z);
          const first = i === 0 && k === 0, lastP = i === brk.length - 2 && k === m - 1;
          bld.prism(o.x, o.z, o2.x, o2.z, 0.5, Y_GROUND, Y_GROUND, PARAPET_H + 0.1, L_STONE, BRIDGE, first || lastP);
          // corniche sous le parapet
          net.pointAt(r, s0 + 1e-3, sg * (W + 0.12), o); net.pointAt(r, s1 - 1e-3, sg * (W + 0.12), o2);
          bld.prism(o.x, o.z, o2.x, o2.z, 0.3, -0.45, -0.45, 0.4, L_PLAIN, COPING, false);
          net.pointAt(r, s0, sg * pOff, o); net.pointAt(r, s1, sg * pOff, o2);
          addParapetBox(o.x, o.z, o2.x, o2.z);
        }
      }
    }
  }

  // ---------- 4. eau
  const wn = createWaterNormal(THREE);
  const uni = { uWTime: { value: 0 }, uWNrm: { value: wn }, uWSky: { value: new THREE.Color(0x9fb8cc) } };
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c3a31, roughness: 0.2, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWTime; uniform sampler2D uWNrm; uniform vec3 uWSky; varying vec3 vWPos;`)
      .replace('#include <normal_fragment_maps>', `
{
  vec2 p = vWPos.xz;
  // quatre nappes de vaguelettes à des échelles et orientations différentes (pas de trame visible)
  vec2 pa = mat2(0.80, 0.60, -0.60, 0.80) * p, pb = mat2(0.28, 0.96, -0.96, 0.28) * p, pc = mat2(-0.62, 0.78, -0.78, -0.62) * p;
  vec2 n1 = texture2D(uWNrm, p * 0.0113 + vec2(uWTime * 0.004, uWTime * 0.002)).xy * 2.0 - 1.0;
  vec2 n2 = texture2D(uWNrm, pa * 0.043 + vec2(-uWTime * 0.011, uWTime * 0.007)).xy * 2.0 - 1.0;
  vec2 n3 = texture2D(uWNrm, pb * 0.137 + vec2(uWTime * 0.03, -uWTime * 0.021)).xy * 2.0 - 1.0;
  vec2 n4 = texture2D(uWNrm, pc * 0.41 + vec2(uWTime * 0.06, uWTime * 0.05)).xy * 2.0 - 1.0;
  n2 = mat2(0.80, -0.60, 0.60, 0.80) * n2; n3 = mat2(0.28, -0.96, 0.96, 0.28) * n3; n4 = mat2(-0.62, -0.78, 0.78, -0.62) * n4;
  float dist = length(vViewPosition);
  float fade = 1.0 / (1.0 + dist * 0.01), fade2 = 1.0 / (1.0 + dist * 0.04);
  vec3 wn = normalize(vec3(n1 * 0.35 + n2 * 0.5 + n3 * 0.55 * fade + n4 * 0.45 * fade2, 2.0));
  // plan horizontal : tangente = X monde, bitangente = Z monde
  vec3 wN = normalize(vec3(wn.x, wn.z, wn.y));
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
}`)
      .replace('#include <opaque_fragment>', `
{
  float ndv = saturate(dot(normal, normalize(vViewPosition)));
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  outgoingLight = mix(outgoingLight, uWSky, clamp(fres, 0.0, 1.0) * 0.85);
}
#include <opaque_fragment>`);
  };
  const cx = masks.x0 + masks.sizeX / 2, cz = masks.z0 + masks.sizeZ / 2;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(masks.sizeX + 3000, masks.sizeZ + 3000), mat);
  water.rotation.x = -Math.PI / 2; water.position.set(cx, WATER_LEVEL, cz);
  water.receiveShadow = true; water.name = 'seine';
  scene.add(water);

  const tmpC = new THREE.Color();
  return {
    water, decks, nearDeck,
    update(dt, night) {
      uni.uWTime.value += dt;
      // reflet du ciel : couleur du brouillard / fond de scène (fournis par l'agent environnement)
      const src = scene.fog?.color || (scene.background?.isColor ? scene.background : null);
      if (src) tmpC.copy(src); else tmpC.setRGB(0.55, 0.68, 0.8).multiplyScalar(1 - night * 0.95);
      uni.uWSky.value.lerp(tmpC, 0.1);
    },
  };
}

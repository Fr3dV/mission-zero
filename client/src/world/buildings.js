// Immeubles parisiens : un gabarit unitaire (murs + brisis + toit + 2 souches de cheminée) instancié par bâtiment
// (3 vec4 par instance) et, pour les immeubles proches, un second jeu de pièces en vrai volume (balcons filants,
// garde-corps, corniches, stores, lucarnes) instancié sur les mêmes données. Shaders : voir facade.js.
import { tileKey, hash2, mulberry32 } from './util.js';
import { VERT_PARS, FRAG_PARS, FRAG_MAIN, FRAG_NORMAL, FRAG_LIGHT, FRAG_GLASS } from './facade.js';

const BASE_INDEX_COUNT = 72; // murs + brisis + toit (les cheminées suivent)
const FACES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function unitGeometry(THREE) {
  const pos = [], fn = [], part = [], idx = [];
  const quad = (v, n, p) => {
    const b = pos.length / 3;
    for (const q of v) { pos.push(q[0], q[1], q[2]); fn.push(n[0], n[1]); part.push(p); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  for (let p = 0; p < 3; p++) for (const n of FACES) {
    const t = [n[1], -n[0]], A = [n[0] - t[0], n[1] - t[1]], B = [n[0] + t[0], n[1] + t[1]];
    quad([[A[0], p, A[1]], [B[0], p, B[1]], [B[0], p + 1, B[1]], [A[0], p + 1, A[1]]], n, p);
  }
  for (let c = 0; c < 2; c++) {
    for (const n of FACES) {
      const t = [n[1], -n[0]], A = [n[0] - t[0], n[1] - t[1]], B = [n[0] + t[0], n[1] + t[1]];
      quad([[A[0], 4, A[1]], [B[0], 4, B[1]], [B[0], 5, B[1]], [A[0], 5, A[1]]], n, 3 + c);
    }
    quad([[-1, 5, 1], [1, 5, 1], [1, 5, -1], [-1, 5, -1]], [0, 0], 3 + c);
  }
  const nv = pos.length / 3;
  return {
    position: new THREE.BufferAttribute(new Float32Array(pos), 3),
    aFn: new THREE.BufferAttribute(new Float32Array(fn), 2),
    aPart: new THREE.BufferAttribute(new Float32Array(part), 1),
    aSlot: new THREE.BufferAttribute(new Float32Array(nv), 1),
    aNrm: new THREE.BufferAttribute(new Float32Array(nv * 3), 3),
    index: new THREE.BufferAttribute(new Uint16Array(idx), 1),
    indexCount: idx.length,
  };
}

/** Pièces de détail en volume, exprimées dans le repère de façade (a le long du mur, b vertical, c sortant). */
function detailGeometry(THREE) {
  const pos = [], fn = [], part = [], slot = [], nrm = [], idx = [];
  let face = FACES[0];
  // v : 4 points (a,b,c) ; n : normale (tangente, haut, sortant) ; flip : repère inversé (lucarnes : c vers l'intérieur)
  const quad = (v, n, p, s, flip = false) => {
    const b = pos.length / 3;
    for (const q of v) { pos.push(q[0], q[1], q[2]); fn.push(face[0], face[1]); part.push(p); slot.push(s); nrm.push(n[0], n[1], n[2]); }
    // sens de parcours cohérent avec la normale fournie (matériau double face : la normale suit gl_FrontFacing)
    const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2], wx = v[3][0] - v[0][0], wy = v[3][1] - v[0][1], wz = v[3][2] - v[0][2];
    const d = (uy * wz - uz * wy) * n[0] + (uz * wx - ux * wz) * n[1] + (ux * wy - uy * wx) * n[2];
    if ((d >= 0) !== flip) idx.push(b, b + 1, b + 2, b, b + 2, b + 3); else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  };
  for (face of FACES) {
    for (let s = 0; s < 2; s++) {
      // dalle de balcon
      quad([[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [0, 0, 1], 5, s);
      quad([[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], [0, 1, 0], 5, s);
      quad([[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [0, -1, 0], 5, s);
      quad([[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], [-1, 0, 0], 5, s);
      quad([[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]], [1, 0, 0], 5, s);
      // garde-corps : face + 2 retours
      quad([[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [0, 0, 1], 6, s);
      quad([[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], [-1, 0, 0], 6, s);
      quad([[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]], [1, 0, 0], 6, s);
    }
    // corniche : sous-face en biais (modillons), bandeau de face, dessus
    quad([[0, 0, 0.1], [1, 0, 0.1], [1, 0.55, 1], [0, 0.55, 1]], [0, -0.85, 0.5], 7, 0);
    quad([[0, 0.55, 1], [1, 0.55, 1], [1, 1, 1], [0, 1, 1]], [0, 0, 1], 7, 0);
    quad([[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], [0, 1, 0], 7, 0);
    // store banne : toile en pente + lambrequin
    quad([[0, 1, 0], [1, 1, 0], [1, 0, 1], [0, 0, 1]], [0, 0.88, 0.47], 8, 0);
    quad([[0, -0.36, 1], [1, -0.36, 1], [1, 0, 1], [0, 0, 1]], [0, 0, 1], 8, 0);
    // lucarnes (c = profondeur vers l'intérieur)
    for (let k = 0; k < 12; k++) {
      quad([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [0, 0, 1], 9, k, true);
      quad([[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], [-1, 0, 0], 9, k, true);
      quad([[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]], [1, 0, 0], 9, k, true);
      quad([[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], [0, 1, 0], 9, k, true);
    }
  }
  return {
    position: new THREE.BufferAttribute(new Float32Array(pos), 3),
    aFn: new THREE.BufferAttribute(new Float32Array(fn), 2),
    aPart: new THREE.BufferAttribute(new Float32Array(part), 1),
    aSlot: new THREE.BufferAttribute(new Float32Array(slot), 1),
    aNrm: new THREE.BufferAttribute(new Float32Array(nrm), 3),
    index: new THREE.BufferAttribute(new Uint16Array(idx), 1),
  };
}

export function createBuildingMaterial(THREE, uniforms, Q, doubleSide) {
  const lod = `\n#define MZ_LOD0 ${Q.detailLod[0].toFixed(1)}\n#define MZ_LOD1 ${Q.detailLod[1].toFixed(1)}\n` + (Q.relief ? '#define MZ_RELIEF\n' : '');
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight; sh.uniforms.uSky = uniforms.uSky;
    sh.uniforms.uSunDir = uniforms.uSunDir; sh.uniforms.uSunK = uniforms.uSunK;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + lod + VERT_PARS)
      .replace('#include <beginnormal_vertex>', 'mzBuilding();\nvec3 objectNormal = bN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = bP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + lod + FRAG_PARS)
      .replace('#include <map_fragment>', FRAG_MAIN)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmis;')
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <lights_fragment_end>', FRAG_LIGHT)
      .replace('#include <opaque_fragment>', FRAG_GLASS);
  };
  mat.customProgramCacheKey = () => 'mz-building-' + (doubleSide ? 'd' : 's') + lod;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + lod + VERT_PARS)
      .replace('#include <begin_vertex>', 'mzBuilding();\nvec3 transformed = bP;');
  };
  depth.customProgramCacheKey = () => 'mz-building-depth' + lod;
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

// Quartiers au bâti plus ancien et plus bas (pas d'haussmannien dominant) : cercles [x, z, rayon] en mètres monde.
const M_LON = 111320 * Math.cos((48.8656 * Math.PI) / 180), M_LAT = 111320;
const OLD_ZONES = [[2.358, 48.857, 650], [2.3565, 48.8517, 330], [2.3445, 48.8497, 430], [2.3475, 48.8535, 260]] // Marais, île Saint-Louis, Quartier latin, Saint-Michel / Huchette
  .map(([lon, lat, r]) => [(lon - 2.3212) * M_LON, -(lat - 48.8656) * M_LAT, r]);

export function buildBuildings(ctx, net, masks, Q, uniforms, river) {
  const { THREE, scene, heightAt, collision, LANDMARKS, worldData } = ctx;
  let src = worldData.buildings;
  const procedural = !src || !src.length;
  if (procedural) src = proceduralBuildings(ctx, net, masks);
  const occ = new Map(), OC = 32; // occupation (mitoyenneté, arbres/mobilier hors des immeubles)
  const list = [];                // immeubles retenus
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
          const nx = Math.max(2, Math.ceil(w / 4)), nz = Math.max(2, Math.ceil(d / 4));
          const bad = (lx, lz) => net.roadAtPad(x + lx * c + lz * s, z - lx * s + lz * c, 0.7, true);
          if (bad(0, 0)) ok = false;
          for (let k = 0; k <= nx && ok; k++) { const lx = -hw + (w * k) / nx; if (bad(lx, -hd) || bad(lx, hd)) ok = false; }
          for (let k = 1; k < nz && ok; k++) { const lz = -hd + (d * k) / nz; if (bad(-hw, lz) || bad(hw, lz)) ok = false; }
          if (!ok) { w *= 0.8; d *= 0.8; if (w < 4 || d < 4) break; }
        }
        if (!ok) continue;
        if (masks.isWater(x, z)) continue;
        // édicules cartographiés aux culées des ponts (pylônes du pont Alexandre III...) : déjà construits avec le pont
        if (river && Math.max(w, d) < 10 && river.nearDeck(x, z, 7)) continue;
      }
      const hw = w / 2, hd = d / 2;
      // niveau de référence = sol au centre ; le soubassement descend jusqu'au point le plus bas de l'emprise
      const base = heightAt(x, z); let lo = base;
      for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) lo = Math.min(lo, heightAt(x + lx * c + lz * s, z - lx * s + lz * c));
      const seed = hash2(Math.round(x * 3), Math.round(z * 3)) * 100;
      // style déterministe : 0 haussmannien, 1 post-haussmannien, 2 immeuble de rapport enduit, 3 Art déco, 4 moderne
      const hs = hash2(Math.round(x * 7) + 11, Math.round(z * 7) - 5);
      let style = hs < 0.56 ? 0 : hs < 0.68 ? 1 : hs < 0.87 ? 2 : hs < 0.95 ? 3 : 4;
      // style par quartier : bâti ancien enduit au Marais, sur l'île Saint-Louis, au Quartier latin et sur la butte Montmartre
      let old = false; for (const q of OLD_ZONES) if ((x - q[0]) ** 2 + (z - q[1]) ** 2 < q[2] * q[2]) { old = true; break; }
      const sc = ctx.LANDMARK_BY_ID?.sacrecoeur; if (!old && sc && (x - sc.x) ** 2 + (z - sc.z) ** 2 < 520 * 520) old = true;
      if (old) style = hs < 0.68 ? 2 : hs < 0.86 ? 0 : hs < 0.94 ? 1 : 3;
      if (h > 34 || Math.min(w, d) > 42) style = 4; else if (h < 11 && style < 2) style = 2;
      const b = { x, z, hw, hd, c, s, rot, w, d, h, base, drop: base - lo + 1.0, seed, style, blind: 0, filler };
      list.push(b);
      collision.addBox({ x, z, hw, hd, rot, top: base + h, tag: 'building' });
      const r = Math.hypot(hw, hd);
      for (let ix = Math.floor((x - r) / OC); ix <= Math.floor((x + r) / OC); ix++) for (let iz = Math.floor((z - r) / OC); iz <= Math.floor((z + r) / OC); iz++) {
        const kk = (ix + 1024) * 2048 + iz + 1024; let a = occ.get(kk); if (!a) occ.set(kk, (a = [])); a.push(b);
      }
      if (!filler) kept++;
    }
  };
  addAll(src, !procedural, false);
  if (worldData.meta?.source !== 'sample') addAll(fillerBuildings(ctx, masks), false, true);

  /** Le point (avec marge) est-il dans un immeuble ? (les immeubles de remplissage hors emprise ne comptent pas si real=true) */
  function inBuilding(x, z, pad = 0, self = null) {
    const a = occ.get((Math.floor(x / OC) + 1024) * 2048 + Math.floor(z / OC) + 1024); if (!a) return false;
    for (const b of a) {
      if (b === self) continue;
      const dx = x - b.x, dz = z - b.z, lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
      if (Math.abs(lx) < b.hw + pad && Math.abs(lz) < b.hd + pad) return true;
    }
    return false;
  }
  // faces mitoyennes : le mur est collé à un voisin → pignon aveugle (bit par face, ordre de FACES)
  for (const b of list) {
    for (let f = 0; f < 4; f++) {
      const [nx, nz] = FACES[f], tx = nz, tz = -nx;
      const half = Math.abs(nx) * b.hw + Math.abs(nz) * b.hd, L2 = Math.abs(tx) * b.hw + Math.abs(tz) * b.hd;
      let inside = 0;
      for (const u of [-0.6, 0, 0.6]) {
        const lx = nx * (half + 0.9) + tx * L2 * u, lz = nz * (half + 0.9) + tz * L2 * u;
        if (inBuilding(b.x + lx * b.c + lz * b.s, b.z - lx * b.s + lz * b.c, 0, b)) inside++;
      }
      if (inside >= 2) b.blind |= 1 << f;
    }
  }

  // ---------- tuiles du gabarit (toutes distances)
  const tiles = new Map();
  const NG = 96, near = new Map(); // grille des immeubles pour le jeu de détails proche
  list.forEach((b, i) => {
    const k = tileKey(b.x, b.z, 700);
    let t = tiles.get(k); if (!t) tiles.set(k, (t = { a: [], b: [], c: [], maxR: 0, minY: Infinity, maxY: -Infinity }));
    t.a.push(b.x, b.base, b.z, b.rot); t.b.push(b.w, b.d, b.h, b.seed); t.c.push(b.blind, b.style, b.drop, 0);
    t.maxR = Math.max(t.maxR, Math.hypot(b.hw, b.hd)); t.minY = Math.min(t.minY, b.base - b.drop); t.maxY = Math.max(t.maxY, b.base + b.h + 2);
    if (!b.filler) { const nk = tileKey(b.x, b.z, NG); let a = near.get(nk); if (!a) near.set(nk, (a = [])); a.push(i); }
  });
  const unit = unitGeometry(THREE);
  const { mat, depth } = createBuildingMaterial(THREE, uniforms, Q, false);
  const meshes = [];
  for (const [, t] of tiles) {
    const g = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'aFn', 'aPart', 'aSlot', 'aNrm']) g.setAttribute(k, unit[k]);
    g.setIndex(unit.index);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(t.a), 4));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(t.b), 4));
    g.setAttribute('iC', new THREE.InstancedBufferAttribute(new Float32Array(t.c), 4));
    g.instanceCount = t.a.length / 4;
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

  // ---------- détails en volume pour les immeubles proches (1 seul draw call, tampon d'instances dynamique)
  let detail = null;
  if (Q.detailLod[1] > 0) {
    const CAP = 1600, du = detailGeometry(THREE);
    const g = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'aFn', 'aPart', 'aSlot', 'aNrm']) g.setAttribute(k, du[k]);
    g.setIndex(du.index);
    const A = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4), B = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4), C = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    for (const at of [A, B, C]) at.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', A); g.setAttribute('iB', B); g.setAttribute('iC', C);
    g.instanceCount = 0;
    const m = new THREE.Mesh(g, createBuildingMaterial(THREE, uniforms, Q, true).mat);
    m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'immeubles-details';
    scene.add(m);
    let lx = Infinity, lz = Infinity;
    detail = {
      mesh: m, count: 0,
      update(cam) {
        if (Math.abs(cam.x - lx) + Math.abs(cam.z - lz) < 10) return;
        lx = cam.x; lz = cam.z;
        const R = Q.detailLod[1] + 12; let n = 0;
        for (let ix = Math.floor((cam.x - R - 60) / NG); ix <= Math.floor((cam.x + R + 60) / NG); ix++) for (let iz = Math.floor((cam.z - R - 60) / NG); iz <= Math.floor((cam.z + R + 60) / NG); iz++) {
          const a = near.get((ix + 512) * 1024 + iz + 512); if (!a) continue;
          for (const i of a) {
            const b = list[i];
            if (n >= CAP || Math.hypot(b.x - cam.x, b.z - cam.z) - 0.5 * Math.max(b.w, b.d) > R) continue;
            A.array[n * 4] = b.x; A.array[n * 4 + 1] = b.base; A.array[n * 4 + 2] = b.z; A.array[n * 4 + 3] = b.rot;
            B.array[n * 4] = b.w; B.array[n * 4 + 1] = b.d; B.array[n * 4 + 2] = b.h; B.array[n * 4 + 3] = b.seed;
            C.array[n * 4] = b.blind; C.array[n * 4 + 1] = b.style; C.array[n * 4 + 2] = b.drop; n++;
          }
        }
        A.needsUpdate = B.needsUpdate = C.needsUpdate = true;
        g.instanceCount = n; detail.count = n; m.visible = n > 0;
      },
    };
  }
  return {
    meshes, count: kept, procedural, inBuilding, detail,
    update(cam) {
      for (const m of meshes) {
        const c = m.userData.center, dist = Math.hypot(c.x - cam.x, c.z - cam.z) - m.userData.radius;
        m.visible = dist < Q.viewDist;
        if (m.visible) m.geometry.setDrawRange(0, Q.chimneys && dist < Q.detailDist ? unit.indexCount : BASE_INDEX_COUNT);
      }
      detail?.update(cam);
    },
  };
}

// Immeubles : un gabarit unitaire (murs + brisis + toit + 2 souches de cheminée) instancié par bâtiment
// (3 vec4 par instance) et, pour les immeubles proches, un second jeu de pièces en vrai volume (balcons filants,
// garde-corps, corniches, stores, lucarnes) instancié sur les mêmes données. Shaders : voir facade.js.
import { baseHeightAt } from '@shared/terrain.js';
import { TILE, tileKeyI, hash2, mulberry32, bucketByTile } from './util.js';
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

/**
 * Immeubles de la ville, diffusés par tuile.
 *  - Au démarrage : seulement des index en tableaux typés sur le tableau plat des bâtiments (rangement par tuile,
 *    grille d'occupation pour inBuilding) — coût linéaire, quelques dizaines de ms pour 300 000 bâtiments.
 *  - À la demande : chaque tuile trie ses bâtiments (rognage sur les chaussées, monuments, eau), choisit style et
 *    toit (profil de la ville + méta), détecte les murs mitoyens et remplit ses tampons d'instances.
 */
/** Hauteur ajoutée au-dessus de l'égout par le toit des styles ≥ 5 (voir mzRoofT dans facade.js). */
export function roofRise(rt, w, d) {
  const m = Math.min(w, d) * 0.5;
  if (rt === 3) return 0.37;
  return rt === 4 ? Math.min(2.5, Math.max(0.3, m * 0.12)) : Math.min(3.4, Math.max(0.45, m * 0.34));
}

export function createBuildings(ctx, net, masks, Q, uniforms, river, profile) {
  const { THREE, scene, LANDMARKS, worldData } = ctx;
  // ---------- source : données réelles, sinon génération le long des rues (petites villes), + remplissage hors emprise
  let src = worldData.buildings;
  const procedural = !src || !src.length;
  if (procedural) src = net.roads.length < 6000 ? proceduralBuildings(ctx, net, masks) : [];
  const nData = Math.floor(src.length / 6);
  const fill = profile.filler && worldData.meta?.source !== 'sample' ? fillerBuildings(ctx, masks) : [];
  const n = nData + Math.floor(fill.length / 6);
  const RAW = new Float32Array(n * 6);
  RAW.set(src.length % 6 ? src.slice(0, nData * 6) : src, 0); RAW.set(fill, nData * 6);
  // ---------- méta (nature, murs, toit, niveaux) : binaire aligné (grandes villes) ou table byIndex (Paris)
  const legend = worldData.buildingsMeta || null, metaBin = worldData.buildingsMetaBin || null;
  const stride = legend?.stride | 0, fields = legend?.fields || [];
  const fK = fields.indexOf('kind'), fW = fields.indexOf('wall'), fR = fields.indexOf('roof'), fL = fields.indexOf('levels');
  const kinds = legend?.kinds || [], walls = legend?.walls || [], roofs = legend?.roofs || legend?.roofShapes || [];
  const byIndex = legend?.byIndex || null;
  const metaOf = (i, out) => {
    out.kind = ''; out.wall = ''; out.roof = ''; out.levels = 0;
    if (i >= nData) return out;
    if (metaBin && stride > 0 && (i + 1) * stride <= metaBin.length) {
      const o = i * stride;
      if (fK >= 0) out.kind = kinds[metaBin[o + fK]] || ''; if (fW >= 0) out.wall = walls[metaBin[o + fW]] || '';
      if (fR >= 0) out.roof = roofs[metaBin[o + fR]] || ''; if (fL >= 0) out.levels = metaBin[o + fL];
    } else if (byIndex) { const m = byIndex[i]; if (m) { out.kind = kinds[m[0]] || ''; out.levels = m[1] | 0; out.roof = roofs[m[2]] || ''; } }
    return out;
  };
  // ---------- index globaux typés
  const COS = new Float32Array(n), SIN = new Float32Array(n), SC = new Float32Array(n).fill(1), ST = new Uint8Array(n); // ST : 0 non trié, 1 gardé, 2 écarté
  for (let i = 0; i < n; i++) { const rot = (RAW[i * 6 + 4] * Math.PI) / 180; COS[i] = Math.cos(rot); SIN[i] = Math.sin(rot); }
  const BT = 1000; // taille des tuiles d'immeubles (m)
  const tiles = bucketByTile(n, (i, p) => { p[0] = RAW[i * 6]; p[1] = RAW[i * 6 + 1]; }, BT);
  // grille d'occupation (cases de 32 m) : pour chaque case, les bâtiments dont le cercle englobant la touche
  const OC = 32;
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = RAW[i * 6], z = RAW[i * 6 + 1]; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z; }
  if (!n) { bx0 = bz0 = 0; bx1 = bz1 = 1; }
  const ox0 = Math.floor((bx0 - 80) / OC), oz0 = Math.floor((bz0 - 80) / OC), ow = Math.floor((bx1 + 80) / OC) - ox0 + 1, oh = Math.floor((bz1 + 80) / OC) - oz0 + 1;
  const oStart = new Int32Array(ow * oh + 1);
  const eachCell = (i, fn) => {
    const x = RAW[i * 6], z = RAW[i * 6 + 1], r = Math.hypot(RAW[i * 6 + 2], RAW[i * 6 + 3]) * 0.5;
    for (let cz = Math.floor((z - r) / OC) - oz0, c1 = Math.floor((z + r) / OC) - oz0; cz <= c1; cz++) for (let cx = Math.floor((x - r) / OC) - ox0, c2 = Math.floor((x + r) / OC) - ox0; cx <= c2; cx++) fn(cz * ow + cx);
  };
  for (let i = 0; i < n; i++) eachCell(i, (c) => { oStart[c + 1]++; });
  for (let c = 0; c < ow * oh; c++) oStart[c + 1] += oStart[c];
  const oItems = new Int32Array(oStart[ow * oh]);
  { const f = oStart.slice(0, ow * oh); for (let i = 0; i < n; i++) eachCell(i, (c) => { oItems[f[c]++] = i; }); }
  /** Le point (avec marge) est-il dans un immeuble ? Instantané partout (index global). self = indice à ignorer. */
  function inBuilding(x, z, pad = 0, self = -1) {
    const cx = Math.floor(x / OC) - ox0, cz = Math.floor(z / OC) - oz0;
    if (cx < 0 || cz < 0 || cx >= ow || cz >= oh) return false;
    const c = cz * ow + cx;
    for (let k = oStart[c], e = oStart[c + 1]; k < e; k++) {
      const i = oItems[k]; if (i === self || ST[i] === 2) continue;
      const o = i * 6, dx = x - RAW[o], dz = z - RAW[o + 1], lx = dx * COS[i] - dz * SIN[i], lz = dx * SIN[i] + dz * COS[i];
      if (Math.abs(lx) < RAW[o + 2] * 0.5 * SC[i] + pad && Math.abs(lz) < RAW[o + 3] * 0.5 * SC[i] + pad) return true;
    }
    return false;
  }
  /** Trie un bâtiment (une seule fois) : écarté s'il est sur un monument, dans l'eau, sous un pont ; rogné s'il mord sur une chaussée. */
  function sort(i) {
    if (ST[i]) return ST[i] === 1;
    const o = i * 6, x = RAW[o], z = RAW[o + 1]; let w = RAW[o + 2], d = RAW[o + 3];
    const drop = () => { ST[i] = 2; return false; };
    if (!(w > 2.5 && d > 2.5) || !(RAW[o + 5] > 0)) return drop();
    for (const l of LANDMARKS) { const lim = l.radius + Math.min(w, d) * 0.5; const dx = x - l.x, dz = z - l.z; if (dx * dx + dz * dz < lim * lim) return drop(); }
    if (i < nData && !procedural) {
      // les données réelles sont des rectangles englobants : on rogne ceux qui mordent sur une chaussée
      const c = COS[i], s = SIN[i]; let ok = false, sc = 1;
      for (let it = 0; it < 4 && !ok; it++) {
        ok = true;
        const hw = w / 2, hd = d / 2, nx = Math.max(2, Math.ceil(w / 4)), nz = Math.max(2, Math.ceil(d / 4));
        const bad = (lx, lz) => net.roadAtPad(x + lx * c + lz * s, z - lx * s + lz * c, 0.7, true, 0);
        if (bad(0, 0)) ok = false;
        for (let k = 0; k <= nx && ok; k++) { const lx = -hw + (w * k) / nx; if (bad(lx, -hd) || bad(lx, hd)) ok = false; }
        for (let k = 1; k < nz && ok; k++) { const lz = -hd + (d * k) / nz; if (bad(-hw, lz) || bad(hw, lz)) ok = false; }
        if (!ok) { w *= 0.8; d *= 0.8; sc *= 0.8; if (w < 4 || d < 4) break; }
      }
      if (!ok || masks.isWater(x, z)) return drop();
      // édicules cartographiés aux culées des ponts : déjà construits avec le pont
      if (river && Math.max(w, d) < 10 && river.nearDeck(x, z, 7)) return drop();
      SC[i] = sc;
    }
    ST[i] = 1;
    return true;
  }

  const unit = unitGeometry(THREE);
  const { mat, depth } = createBuildingMaterial(THREE, uniforms, Q, false);
  const loaded = new Map(); // clé de tuile -> objet de tuile
  const meta = { kind: '', wall: '', roof: '', levels: 0 }, bb = { x: 0, z: 0, w: 0, d: 0, h: 0, kind: '', wall: '', roof: '', levels: 0 };
  /** Générateur : construit la tuile d'immeubles (ix, iz). */
  function* buildTile(ix, iz) {
    const rg = tiles.range(ix, iz); if (!rg) return null;
    const A = [], Bv = [], C = [], col = [];
    let maxR = 0, minY = Infinity, maxY = -Infinity, steps = 0;
    for (let k = rg[0]; k < rg[1]; k++) {
      const i = tiles.items[k];
      if ((++steps & 31) === 0) yield;
      if (!sort(i)) continue;
      const o = i * 6, x = RAW[o], z = RAW[o + 1], w = RAW[o + 2] * SC[i], d = RAW[o + 3] * SC[i], c = COS[i], s = SIN[i];
      const h = Math.min(Math.max(RAW[o + 5], 3.2), 90), hw = w / 2, hd = d / 2, rot = (RAW[o + 4] * Math.PI) / 180;
      // niveau de référence = sol au centre ; le soubassement descend jusqu'au point le plus bas de l'emprise
      const base = baseHeightAt(x, z); let lo = base;
      for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) lo = Math.min(lo, baseHeightAt(x + lx * c + lz * s, z - lx * s + lz * c));
      const seed = hash2(Math.round(x * 3), Math.round(z * 3)) * 100, hs = hash2(Math.round(x * 7) + 11, Math.round(z * 7) - 5);
      metaOf(i, meta);
      bb.x = x; bb.z = z; bb.w = w; bb.d = d; bb.h = h; bb.kind = meta.kind; bb.wall = meta.wall; bb.roof = meta.roof; bb.levels = meta.levels;
      const st = profile.buildingStyle(ctx, bb, hs);
      // faces mitoyennes : le mur est collé à un voisin → pignon aveugle (bit par face, ordre de FACES)
      let blind = 0;
      for (let f = 0; f < 4; f++) {
        const [nx, nz] = FACES[f], tx = nz, tz = -nx;
        const half = Math.abs(nx) * hw + Math.abs(nz) * hd, L2 = Math.abs(tx) * hw + Math.abs(tz) * hd;
        let inside = 0;
        for (const u of [-0.6, 0, 0.6]) { const lx = nx * (half + 0.9) + tx * L2 * u, lz = nz * (half + 0.9) + tz * L2 * u; if (inBuilding(x + lx * c + lz * s, z - lx * s + lz * c, 0, i)) inside++; }
        if (inside >= 2) blind |= 1 << f;
      }
      // styles ≥ 5 : la hauteur des données est celle de l'égout, le toit s'ajoute (même formule que mzRoofT dans facade.js)
      A.push(x, base, z, rot); Bv.push(w, d, st.style > 4.5 ? h + roofRise(st.roof | 0, w, d) : h, seed); C.push(blind, st.style, base - lo + 1.0, st.roof | 0);
      col.push(x, z, hw, hd, rot, base + h);
      maxR = Math.max(maxR, Math.hypot(hw, hd)); minY = Math.min(minY, lo - 1); maxY = Math.max(maxY, base + h + 2);
    }
    const cnt = A.length / 4; if (!cnt) return null;
    const g = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'aFn', 'aPart', 'aSlot', 'aNrm']) g.setAttribute(k, unit[k]);
    g.setIndex(unit.index);
    const a = new Float32Array(A), b = new Float32Array(Bv), c = new Float32Array(C);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(b, 4));
    g.setAttribute('iC', new THREE.InstancedBufferAttribute(c, 4));
    g.instanceCount = cnt;
    let cx = 0, cz = 0;
    for (let i = 0; i < cnt; i++) { cx += a[i * 4]; cz += a[i * 4 + 2]; }
    cx /= cnt; cz /= cnt; const cy = (minY + maxY) / 2;
    let r2 = 0; for (let i = 0; i < cnt; i++) r2 = Math.max(r2, (a[i * 4] - cx) ** 2 + (a[i * 4 + 2] - cz) ** 2);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), Math.hypot(Math.sqrt(r2) + maxR, (maxY - minY) / 2));
    const m = new THREE.Mesh(g, mat);
    m.customDepthMaterial = depth;
    m.castShadow = Q.shadows; m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'immeubles';
    scene.add(m);
    const t = { mesh: m, a, b, c, n: cnt, col: new Float32Array(col), key: tileKeyI(ix, iz), ix, iz, center: g.boundingSphere.center, radius: g.boundingSphere.radius, shapes: null };
    loaded.set(t.key, t); nearDirty = true;
    return t;
  }

  // ---------- détails en volume pour les immeubles proches (1 seul draw call, tampon d'instances dynamique)
  let detail = null, nearDirty = true;
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
    m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'immeubles-details'; m.visible = false;
    scene.add(m);
    let lx = Infinity, lz = Infinity;
    detail = {
      mesh: m, count: 0,
      update(cam) {
        if (!nearDirty && Math.abs(cam.x - lx) + Math.abs(cam.z - lz) < 10) return;
        lx = cam.x; lz = cam.z; nearDirty = false;
        const R = Q.detailLod[1] + 12; let k = 0;
        for (let ix = Math.floor((cam.x - R - 40) / BT); ix <= Math.floor((cam.x + R + 40) / BT); ix++) for (let iz = Math.floor((cam.z - R - 40) / BT); iz <= Math.floor((cam.z + R + 40) / BT); iz++) {
          const t = loaded.get(tileKeyI(ix, iz)); if (!t) continue;
          for (let i = 0; i < t.n && k < CAP; i++) {
            const o = i * 4;
            if (Math.hypot(t.a[o] - cam.x, t.a[o + 2] - cam.z) - 0.5 * Math.max(t.b[o], t.b[o + 1]) > R) continue;
            A.array.set(t.a.subarray(o, o + 4), k * 4); B.array.set(t.b.subarray(o, o + 4), k * 4); C.array.set(t.c.subarray(o, o + 4), k * 4); k++;
          }
        }
        A.needsUpdate = B.needsUpdate = C.needsUpdate = true;
        g.instanceCount = k; detail.count = k; m.visible = k > 0;
      },
    };
  }
  return {
    total: n, procedural, inBuilding, detail, loaded, buildTile, size: BT,
    has: (ix, iz) => !!tiles.range(ix, iz),
    dispose(t) { if (!t) return; scene.remove(t.mesh); t.mesh.geometry.dispose(); loaded.delete(t.key); nearDirty = true; },
    count() { let c = 0; for (const t of loaded.values()) c += t.n; return c; },
    update(cam) {
      for (const t of loaded.values()) {
        const dist = Math.hypot(t.center.x - cam.x, t.center.z - cam.z) - t.radius;
        t.mesh.geometry.setDrawRange(0, Q.chimneys && dist < Q.detailDist ? unit.indexCount : BASE_INDEX_COUNT);
      }
      detail?.update(cam);
    },
  };
}

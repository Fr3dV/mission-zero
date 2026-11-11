// Arbres : platanes d'alignement le long des avenues/boulevards/quais et arbres de parc.
// Instanciés par tuile, deux niveaux de détail (proche / lointain) partageant les mêmes matrices.
import { baseHeightAt } from '@shared/terrain.js';
import { TILE, tileKeyI, mulberry32, hash2, bucketByTile } from './util.js';
import { C_GRASS, C_FOREST, C_GARDEN, C_FIELD, C_PITCH } from './masks.js';
import { createLeafTextures } from './textures.js';
import { Y_WALK } from './streets.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

function treeGeometry(THREE, lod, seed) {
  const rnd = mulberry32(seed);
  const pos = [], col = [], uv = [], idx = [];
  const push = (g, color, crown, uvScale = 1) => {
    const p = g.attributes.position, u = g.attributes.uv, base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      const c = color(p.getX(i), p.getY(i), p.getZ(i));
      col.push(c[0], c[1], c[2], crown);
      uv.push(u ? u.getX(i) * uvScale : 0, u ? u.getY(i) * uvScale : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  };
  const bark = () => [1, 1, 1];
  const trunkH = 5.2;
  const tg = new THREE.CylinderGeometry(0.16, 0.27, trunkH, lod ? 5 : 8, 1, true); tg.translate(0, trunkH / 2, 0);
  push(tg, bark, 0, 3);
  // houppier ovoïde : masses de feuillage réparties sur une enveloppe en œuf
  const blobs = [];
  const cy = trunkH + 4.3, RX = 3.6, RY = 4.6;
  if (!lod) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rnd(), len = 3.2 + rnd() * 1.0, tilt = 0.5 + rnd() * 0.3;
      const bg = new THREE.CylinderGeometry(0.045, 0.12, len, 5, 1, true); bg.translate(0, len / 2, 0);
      bg.rotateZ(-tilt); bg.rotateY(a); bg.translate(0, trunkH - 0.6, 0);
      push(bg, bark, 0, 3);
    }
    blobs.push([0, cy, 0, 3.1]);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + rnd() * 0.6, e = -0.35 + rnd() * 0.5; blobs.push([Math.cos(a) * Math.cos(e) * RX * 0.72, cy + Math.sin(e) * RY * 0.7 - 0.6, Math.sin(a) * Math.cos(e) * RX * 0.72, 2.0 + rnd() * 0.6]); }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + rnd() * 0.8; blobs.push([Math.cos(a) * RX * 0.42, cy + RY * 0.48 + rnd() * 0.5, Math.sin(a) * RX * 0.42, 1.8 + rnd() * 0.5]); }
    blobs.push([0.2, cy + RY * 0.82, -0.1, 1.7]);
  } else blobs.push([0, cy - 0.2, 0, 3.7], [0.3, cy + 2.4, 0.2, 2.9]);
  for (const [bx, by, bz, br] of blobs) {
    let ig = new THREE.IcosahedronGeometry(br, lod ? 0 : 1);
    ig.deleteAttribute('normal'); ig.deleteAttribute('uv'); ig = mergeVertices(ig, 1e-3);
    const p = ig.attributes.position;
    const u = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = lod ? 1.08 : 0.94 + 0.16 * Math.sin(x * 2.3 + seed) * Math.sin(y * 2.9 + 1.3) * Math.sin(z * 2.1 + 0.7) + 0.07 * hash2(Math.round(x * 40) + Math.round(z * 17), Math.round(y * 40));
      const sy = lod ? 1.15 : 0.92;
      p.setXYZ(i, bx + x * n, by + y * n * sy, bz + z * n);
      u[i * 2] = Math.atan2(z, x) * br * 0.42 + bx * 0.3; u[i * 2 + 1] = (by + y) * 0.42;
    }
    ig.setAttribute('uv', new THREE.BufferAttribute(u, 2));
    const lo = trunkH + 0.3, hi = cy + RY;
    push(ig, (x, y, z) => {
      // plus sombre en bas et vers l'intérieur, plus clair et chaud au sommet
      const t = Math.min(1, Math.max(0, (y - lo) / (hi - lo))), rad = Math.min(1, Math.hypot(x, z) / RX);
      const k = (0.62 + 0.5 * t) * (0.8 + 0.25 * rad) + 0.06 * Math.sin(x * 1.7 + z * 2.3);
      return [0.9 * k * (1 + 0.18 * t), 1.0 * k, 0.74 * k * (1 - 0.15 * t)];
    }, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 4));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Arbres de la ville, diffusés par tuile : arbres réels (pois.trees, treeRows), alignements le long des voies
 * plantées, semis des parcs, bois et jardins (d'après la classe de sol). Tout est déterministe (aléa par position).
 */
export function createVegetation(ctx, net, masks, river, bld, Q, profile, extraTrees = []) {
  const { THREE, scene, LANDMARKS } = ctx;
  const leaf = createLeafTextures(THREE, Q.texSize >= 512 ? 256 : 128);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: leaf.map, roughness: 0.82, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    // normales du feuillage redressées vers le ciel : lumière plus douce, dessous moins noirs
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTP;\nvarying vec3 vTN;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
vTP = position; vTN = normal;
#ifdef USE_COLOR_ALPHA
if (color.a > 0.5) objectNormal = normalize(objectNormal + vec3(0.0, 0.6, 0.0));
#endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTP;\nvarying vec3 vTN;')
      .replace('#include <map_fragment>', `
// feuillage : texture projetée sur 3 axes (pas d'étirement), découpe en dentelle sur la silhouette
vec3 tw = pow(abs(normalize(vTN)), vec3(3.0)); tw /= (tw.x + tw.y + tw.z);
vec4 leafT = texture2D(map, vTP.zy * 0.37) * tw.x + texture2D(map, vTP.xz * 0.37) * tw.y + texture2D(map, vTP.xy * 0.37) * tw.z;
vec4 leafB = texture2D(map, vTP.zy * 0.083 + 0.3) * tw.x + texture2D(map, vTP.xz * 0.083 + 0.3) * tw.y + texture2D(map, vTP.xy * 0.083 + 0.3) * tw.z;
`)
      .replace('#include <alphatest_fragment>', `
#ifdef USE_COLOR_ALPHA
{
  float ndv = abs(dot(normalize(vNormal), normalize(vViewPosition)));
  float lw = fwidth(vTP.x) + fwidth(vTP.y);
  if (vColor.a > 0.5) {
    if (ndv < 0.38 && leafT.a < (0.38 - ndv) * 2.4 * (1.0 - smoothstep(0.25, 0.8, lw))) discard;
    diffuseColor.rgb *= leafT.rgb * (0.55 + 0.9 * leafB.g) * 1.45;
  } else {
    diffuseColor.rgb = vec3(0.2, 0.175, 0.135) * (0.45 + 0.9 * leafB.g) * (0.75 + 0.4 * leafT.g);
  }
}
#endif`);
  };
  mat.customProgramCacheKey = () => 'mz-tree';
  const geoNear = [treeGeometry(THREE, 0, 11), treeGeometry(THREE, 0, 29)], geoFar = [treeGeometry(THREE, 1, 11), treeGeometry(THREE, 1, 29)];
  const tint = profile.treeTint || [0.115, 0.185, 0.06];
  const nearLandmark = (x, z, pad) => { for (const l of LANDMARKS) if ((x - l.x) ** 2 + (z - l.z) ** 2 < (l.radius + pad) ** 2) return true; return false; };

  // ---------- arbres réels (pois.json) rangés par tuile ; alignements réels (treeRows) par tuile
  const pois = ctx.worldData.pois;
  const PT = Array.isArray(pois?.trees) || ArrayBuffer.isView(pois?.trees) ? pois.trees : [];
  const realTrees = PT.length >= 1600;
  const nPT = PT.length >> 1;
  const ptTiles = bucketByTile(nPT, (i, p) => { p[0] = PT[i * 2]; p[1] = PT[i * 2 + 1]; });
  const rowTiles = new Map();
  // arbres fournis par d'autres parties du module (doubles alignements de platanes des canaux)
  for (let i = 0; i + 1 < extraTrees.length; i += 2) { const key = tileKeyI(Math.floor(extraTrees[i] / TILE), Math.floor(extraTrees[i + 1] / TILE)); let arr = rowTiles.get(key); if (!arr) rowTiles.set(key, (arr = [])); arr.push(extraTrees[i], extraTrees[i + 1]); }
  for (const row of Array.isArray(pois?.treeRows) ? pois.treeRows : []) {
    const pts = row?.points; if (!Array.isArray(pts)) continue;
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 9));
      for (let j = 0; j < n; j++) { const x = a[0] + ((b[0] - a[0]) * j) / n, z = a[1] + ((b[1] - a[1]) * j) / n, key = tileKeyI(Math.floor(x / TILE), Math.floor(z / TILE)); let arr = rowTiles.get(key); if (!arr) rowTiles.set(key, (arr = [])); arr.push(x, z); }
    }
  }
  const okSpot = (x, z) => Number.isFinite(x) && Number.isFinite(z) && !masks.nearWater(x, z, 3) && !bld.inBuilding(x, z, 1.4) && !nearLandmark(x, z, 4) && net.edgeDistance(x, z, false) > 0.6 && !net.inZone(x, z, 2);
  // densité du semis par classe de sol : pas du treillis (m) et probabilité de garder un point
  const SOW = new Float32Array(32), KEEP = new Float32Array(16);
  SOW[C_GRASS] = realTrees ? 20 : 13; KEEP[C_GRASS] = 1; SOW[C_FOREST] = 8.5; KEEP[C_FOREST] = 0.9; SOW[C_GARDEN] = 21; KEEP[C_GARDEN] = 0.5; SOW[C_FIELD] = 0; SOW[C_PITCH] = 0;

  const loaded = new Map();
  const dummy = new THREE.Object3D(), col3 = new THREE.Color(), o = { _k: 0 };
  /** Générateur : arbres de la tuile (ix, iz). Retourne { near, far, sphere, col (collisions), recs } ou null. */
  function* buildTile(ix, iz) {
    const key = tileKeyI(ix, iz), variant = (ix * 3 + iz * 5) & 1, ox = ix * TILE, oz = iz * TILE;
    const A = [], recs = [], col = [];
    const add = (x, z, scale, y) => {
      const h1 = hash2(Math.round(x * 13), Math.round(z * 13)), h2 = hash2(Math.round(z * 17) + 3, Math.round(x * 17));
      A.push(x, y, z, h1 * 6.283, scale, 0.82 + h2 * 0.3, 0.86 + h1 * 0.22);
      const rec = { type: 'tree', x, y, z, scale, variant, group: null, j: recs.length, tileRef: null };
      recs.push(rec);
      col.push({ kind: 'circle', x, z, r: 0.32 * scale, bottom: y - 2, top: y + 5, tag: 'tree', data: rec });
    };
    let steps = 0;
    // ---------- arbres réels
    const rg = ptTiles.range(ix, iz);
    if (rg) {
      const stepN = Math.max(1, Math.ceil((rg[1] - rg[0]) / 1500)); // plafond par tuile
      for (let k = rg[0]; k < rg[1]; k += stepN) {
        const i = ptTiles.items[k], x = PT[i * 2], z = PT[i * 2 + 1], hh = hash2(Math.round(x * 5), Math.round(z * 5));
        if ((++steps & 63) === 0) yield;
        const bh = river?.bergeHeight ? river.bergeHeight(x, z) : undefined; // arbres réels plantés sur une berge basse
        if (bh !== undefined) { if (bh === river.Y_B && river.bergeHeight(x + 1.2, z) === bh && river.bergeHeight(x - 1.2, z) === bh && river.bergeHeight(x, z + 1.2) === bh && river.bergeHeight(x, z - 1.2) === bh) add(x, z, 0.7 + hh * 0.3, bh); continue; }
        if (okSpot(x, z)) add(x, z, 0.72 + hh * 0.4, baseHeightAt(x, z) + (masks.isPark(x, z) ? 0 : Y_WALK));
      }
    }
    const rows = rowTiles.get(key);
    if (rows) for (let k = 0; k < rows.length; k += 2) { const x = rows[k], z = rows[k + 1]; if (okSpot(x, z)) add(x, z, 0.85 + hash2(Math.round(x * 5), Math.round(z * 5)) * 0.25, baseHeightAt(x, z) + Y_WALK); }
    yield;
    // ---------- alignements le long des voies plantées (positions fixées par l'abscisse : identiques d'une tuile à l'autre)
    for (const [ri, sA, sB] of net.tilePieces.get(key) || []) {
      const r = net.roads[ri];
      if (r._ped || r._sw < 3 || !r._trees || (realTrees && r._trees < 2)) continue;
      const sc = r._sw >= 5 ? 1 : r._sw >= 4 ? 0.88 : 0.72;
      const step = (r._sw >= 4 ? 10.5 : 12) / Math.max(0.35, Q.treeDensity);
      for (const [s0, s1] of net.freeRuns(r)) {
        const a = s0 + 8, b = s1 - 8; if (b - a < 6 || b < sA || a > sB) continue;
        const n = Math.max(1, Math.floor((b - a) / step));
        for (let i = 0; i <= n; i++) {
          const hh = hash2(ri * 31 + i, 77), s = a + ((b - a) * i) / n + (hh - 0.5) * 0.8;
          for (const sg of r._trees > 1 ? [1, -1, 2, -2] : [1, -1]) {
            // 2e rangée (très larges trottoirs) au milieu du trottoir, en quinconce
            const ss = s + (Math.abs(sg) > 1 ? step * 0.5 : 0);
            if (ss < sA || ss >= sB) continue;
            net.pointAt(r, ss, Math.sign(sg) * (r._hw + (Math.abs(sg) > 1 ? r._sw * 0.62 : Math.min(1.7, r._sw * 0.45))), o);
            if (o.e !== 0 && Math.abs(o.e) > 0.3) continue;
            if (net.inZone(o.x, o.z, 3)) continue;
            if (masks.nearWater(o.x, o.z, 4) || bld.inBuilding(o.x, o.z, 2.2 * sc) || nearLandmark(o.x, o.z, 6)) continue;
            if (net.edgeDistance(o.x, o.z, true) < 0.9) continue;
            add(o.x, o.z, sc * (0.9 + hash2(ri * 7 + i, sg + 9) * 0.25), baseHeightAt(o.x, o.z) + Y_WALK);
          }
        }
      }
      if ((++steps & 7) === 0) yield;
    }
    yield;
    // ---------- semis des parcs, bois et jardins : treillis régulier perturbé, densité selon la classe de sol
    for (const S of [8.5, 13, 20, 21]) {
      let any = false; for (let c = 0; c < 16; c++) if (SOW[c] === S) any = true;
      if (!any) continue;
      for (let gx = Math.floor(ox / S); gx * S < ox + TILE; gx++) for (let gz = Math.floor(oz / S); gz * S < oz + TILE; gz++) {
        const jx = hash2(gx * 3 + 1, gz * 5 + (S | 0)), jz = hash2(gz * 7 + 2, gx * 11 + (S | 0));
        const x = (gx + 0.15 + jx * 0.7) * S, z = (gz + 0.15 + jz * 0.7) * S;
        if (x < ox || x >= ox + TILE || z < oz || z >= oz + TILE) continue;
        const cls = masks.classAt(x, z);
        if (SOW[cls] !== S || hash2(gx + 91, gz - 37) > KEEP[cls] * Q.treeDensity) continue;
        if (masks.nearWater(x, z, 5) || bld.inBuilding(x, z, 3) || nearLandmark(x, z, 12) || net.edgeDistance(x, z) < 3) continue;
        add(x, z, (cls === C_FOREST ? 0.8 : 0.75) + jx * 0.55, baseHeightAt(x, z));
      }
      yield;
    }
    const cnt = recs.length; if (!cnt) return null;
    const near = new THREE.InstancedMesh(geoNear[variant], mat, cnt);
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < cnt; j++) {
      const b = j * 7;
      dummy.position.set(A[b], A[b + 1], A[b + 2]); dummy.rotation.set(0, A[b + 3], 0); dummy.scale.set(A[b + 4], A[b + 4] * (0.92 + 0.16 * A[b + 6]), A[b + 4]); dummy.updateMatrix();
      near.setMatrixAt(j, dummy.matrix);
      near.setColorAt(j, col3.setRGB(A[b + 5] * tint[0], A[b + 6] * tint[1], A[b + 5] * tint[2]));
      cx += A[b]; cy += A[b + 1]; cz += A[b + 2];
    }
    cx /= cnt; cy /= cnt; cz /= cnt; let r2 = 0;
    for (let j = 0; j < cnt; j++) r2 = Math.max(r2, (A[j * 7] - cx) ** 2 + (A[j * 7 + 1] - cy) ** 2 + (A[j * 7 + 2] - cz) ** 2);
    const sphere = new THREE.Sphere(new THREE.Vector3(cx, cy + 7, cz), Math.sqrt(r2) + 14);
    const far = new THREE.InstancedMesh(geoFar[variant], mat, cnt);
    far.instanceMatrix = near.instanceMatrix; far.instanceColor = near.instanceColor;
    for (const m of [near, far]) { m.boundingSphere = sphere; m.matrixAutoUpdate = false; m.receiveShadow = true; m.name = 'arbres'; m.visible = false; scene.add(m); }
    near.castShadow = Q.shadows; far.castShadow = false;
    const t = { near, far, sphere, col, recs, key, n: cnt, shapes: null };
    for (const rec of recs) { rec.group = t; rec.tileRef = t; }
    loaded.set(key, t);
    return t;
  }
  return {
    mat, geoFar, geoNear, realTrees, loaded, buildTile,
    has: () => true,
    dispose(t) { if (!t) return; scene.remove(t.near); scene.remove(t.far); t.near.dispose(); loaded.delete(t.key); },
    count() { let c = 0; for (const t of loaded.values()) c += t.n; return c; },
    update(cam) {
      for (const g of loaded.values()) {
        const d = Math.hypot(g.sphere.center.x - cam.x, g.sphere.center.z - cam.z) - g.sphere.radius;
        g.near.visible = d < Q.treeNear;
        g.far.visible = !g.near.visible && d < Q.treeDist;
      }
    },
  };
}

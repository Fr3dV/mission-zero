// Arbres : platanes d'alignement le long des avenues/boulevards/quais et arbres de parc.
// Instanciés par tuile, deux niveaux de détail (proche / lointain) partageant les mêmes matrices.
import { tileKey, mulberry32, hash2 } from './util.js';
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

export function buildVegetation(ctx, net, masks, river, bld, Q) {
  const { THREE, scene, heightAt, collision, LANDMARKS } = ctx;
  const rnd = mulberry32(4711);
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
  const TT = 600;

  const tiles = new Map(); // clé -> [x,y,z,yaw,scale,variant,teinte...]  (+ a.recs : fiche par arbre, attachée à sa collision)
  const nearLandmark = (x, z, pad) => { for (const l of LANDMARKS) if (Math.hypot(x - l.x, z - l.z) < l.radius + pad) return true; return false; };
  let count = 0;
  const add = (x, z, scale, y) => {
    const k = tileKey(x, z, TT); let a = tiles.get(k); if (!a) tiles.set(k, (a = []));
    a.push(x, y, z, rnd() * 6.283, scale, k % 2, 0.82 + rnd() * 0.3, 0.86 + rnd() * 0.22);
    const rec = { type: 'tree', x, y, z, scale, variant: k % 2, group: null, j: 0 };
    (a.recs || (a.recs = [])).push(rec);
    collision.addCircle({ x, z, r: 0.32 * scale, top: y + 5, tag: 'tree', data: rec });
    count++;
  };
  // ---------- arbres réels (pois.json, contrat v3) : remplacent les alignements devinés quand la donnée existe
  const pois = ctx.worldData.pois;
  const realTrees = Array.isArray(pois?.trees) && pois.trees.length >= 800;
  if (realTrees) {
    const okSpot = (x, z) => Number.isFinite(x) && Number.isFinite(z) && !masks.nearWater(x, z, 3) && !bld.inBuilding(x, z, 1.4) && !nearLandmark(x, z, 4) && net.edgeDistance(x, z, false) > 0.6 && !net.inZone(x, z, 2);
    const stepN = Math.max(1, Math.ceil(pois.trees.length / 2 / 45000));
    for (let i = 0; i + 1 < pois.trees.length; i += 2 * stepN) { const x = pois.trees[i], z = pois.trees[i + 1];
      const bh = river.bergeHeight ? river.bergeHeight(x, z) : undefined; // arbres réels plantés sur une berge basse
      if (bh !== undefined) { if (bh === river.Y_B && river.bergeHeight(x + 1.2, z) === bh && river.bergeHeight(x - 1.2, z) === bh && river.bergeHeight(x, z + 1.2) === bh && river.bergeHeight(x, z - 1.2) === bh) add(x, z, 0.7 + rnd() * 0.3, bh); continue; }
      if (okSpot(x, z)) add(x, z, 0.72 + rnd() * 0.4, heightAt(x, z) + (masks.isPark(x, z) ? 0 : Y_WALK)); }
    for (const row of Array.isArray(pois.treeRows) ? pois.treeRows : []) {
      const pts = row?.points; if (!Array.isArray(pts)) continue;
      for (let k = 0; k + 1 < pts.length; k++) { const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 9)); for (let j = 0; j < n; j++) { const x = a[0] + ((b[0] - a[0]) * j) / n, z = a[1] + ((b[1] - a[1]) * j) / n; if (okSpot(x, z)) add(x, z, 0.85 + rnd() * 0.25, heightAt(x, z) + Y_WALK); } }
    }
  }
  // ---------- alignements
  const o = { _k: 0 };
  for (const r of net.roads) {
    if (realTrees && r._trees < 2) continue;
    if (r._ped || r._sw < 3 || !r._trees) continue;
    const sc = r._sw >= 5 ? 1 : r._sw >= 4 ? 0.88 : 0.72;
    const step = (r._sw >= 4 ? 10.5 : 12) / Math.max(0.35, Q.treeDensity);
    for (const [s0, s1] of net.freeRuns(r)) {
      const a = s0 + 8, b = s1 - 8; if (b - a < 6) continue;
      const n = Math.max(1, Math.floor((b - a) / step));
      for (let i = 0; i <= n; i++) {
        const s = a + ((b - a) * i) / n + (rnd() - 0.5) * 0.8;
        for (const sg of r._trees > 1 ? [1, -1, 2, -2] : [1, -1]) {
          // 2e rangée (Champs-Élysées, Foch) au milieu du large trottoir
          net.pointAt(r, s + (Math.abs(sg) > 1 ? step * 0.5 : 0), Math.sign(sg) * (r._hw + (Math.abs(sg) > 1 ? r._sw * 0.62 : Math.min(1.7, r._sw * 0.45))), o);
          if (net.inZone(o.x, o.z, 3)) continue;
          if (masks.nearWater(o.x, o.z, 4) || bld.inBuilding(o.x, o.z, 2.2 * sc) || nearLandmark(o.x, o.z, 6)) continue;
          if (net.edgeDistance(o.x, o.z, true) < 0.9) continue;
          add(o.x, o.z, sc * (0.9 + rnd() * 0.25), heightAt(o.x, o.z) + Y_WALK);
        }
      }
    }
  }
  // ---------- parcs
  for (const info of masks.parkInfos) {
    const { bb, area } = info;
    const target = Math.min(700, Math.floor((area / (realTrees ? 420 : 170)) * Q.treeDensity));
    let placed = 0;
    const recent = [];
    for (let t = 0; t < target * 5 && placed < target; t++) {
      const x = bb.x0 + rnd() * (bb.x1 - bb.x0), z = bb.z0 + rnd() * (bb.z1 - bb.z0);
      if (!masks.isGrass(x, z) || masks.nearWater(x, z, 5)) continue;
      if (bld.inBuilding(x, z, 3) || nearLandmark(x, z, 12) || net.edgeDistance(x, z) < 3) continue;
      let ok = true; for (let i = Math.max(0, recent.length - 60); i < recent.length; i++) if (Math.abs(recent[i][0] - x) + Math.abs(recent[i][1] - z) < 6.5) { ok = false; break; }
      if (!ok) continue;
      recent.push([x, z]);
      add(x, z, 0.75 + rnd() * 0.55, heightAt(x, z));
      placed++;
    }
  }

  const dummy = new THREE.Object3D(), c = new THREE.Color();
  const groups = [];
  for (const [, a] of tiles) {
    // deux variantes de gabarit par tuile → au plus 2 maillages (×2 LOD)
    for (let variant = 0; variant < 2; variant++) {
      const ids = []; for (let i = 0; i < a.length / 8; i++) if (a[i * 8 + 5] === variant) ids.push(i);
      if (!ids.length) continue;
      const near = new THREE.InstancedMesh(geoNear[variant], mat, ids.length);
      let cx = 0, cy = 0, cz = 0;
      ids.forEach((id, j) => {
        const b = id * 8;
        dummy.position.set(a[b], a[b + 1], a[b + 2]); dummy.rotation.set(0, a[b + 3], 0); dummy.scale.set(a[b + 4], a[b + 4] * (0.92 + 0.16 * a[b + 7]), a[b + 4]); dummy.updateMatrix();
        near.setMatrixAt(j, dummy.matrix);
        near.setColorAt(j, c.setRGB(a[b + 6] * 0.115, a[b + 7] * 0.185, a[b + 6] * 0.06));
        cx += a[b]; cy += a[b + 1]; cz += a[b + 2];
      });
      cx /= ids.length; cy /= ids.length; cz /= ids.length; let r2 = 0;
      for (const id of ids) r2 = Math.max(r2, (a[id * 8] - cx) ** 2 + (a[id * 8 + 1] - cy) ** 2 + (a[id * 8 + 2] - cz) ** 2);
      const sphere = new THREE.Sphere(new THREE.Vector3(cx, cy + 7, cz), Math.sqrt(r2) + 14);
      const far = new THREE.InstancedMesh(geoFar[variant], mat, ids.length);
      far.instanceMatrix = near.instanceMatrix; far.instanceColor = near.instanceColor;
      for (const m of [near, far]) { m.boundingSphere = sphere; m.matrixAutoUpdate = false; m.receiveShadow = true; m.name = 'arbres'; scene.add(m); }
      near.castShadow = Q.shadows; far.castShadow = false;
      const grp = { near, far, sphere };
      ids.forEach((id, j) => { a.recs[id].group = grp; a.recs[id].j = j; });
      groups.push(grp);
    }
  }
  return {
    count, mat, geoFar, geoNear, realTrees,
    update(cam) {
      for (const g of groups) {
        const d = Math.hypot(g.sphere.center.x - cam.x, g.sphere.center.z - cam.z) - g.sphere.radius;
        g.near.visible = d < Q.treeNear;
        g.far.visible = !g.near.visible && d < Q.treeDist;
      }
    },
  };
}

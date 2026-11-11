// Cours d'eau étroits décrits par leur axe (worldData.waterways : canaux, rivières, ruisseaux) : rubans d'eau au niveau
// du terrain (contrairement au fleuve, dont le plan d'eau est à WATER_LEVEL), berges, chemin de halage, alignements
// d'arbres, petits ponts là où une rue franchit le canal. Ouvrage linéaire : construit d'un bloc au démarrage.
import { baseHeightAt } from '@shared/terrain.js';
import { PolySet } from './masks.js';
import { L_STONE, L_PLAIN, L_GRASS, L_GRAVEL } from './textures.js';

export function createWaterways(ctx, net, profile) {
  const { THREE, scene, collision } = ctx;
  const src = (ctx.worldData.waterways || []).filter((w) => w && Array.isArray(w.points) && w.points.length >= 2 && (w.width || 0) >= 2.5);
  const ways = [], ribbons = [], trees = [];
  const ribbonSet = new PolySet();
  for (const w of src) {
    const pts = w.points, n = pts.length, cum = new Float32Array(n), mx = new Float32Array(n), mz = new Float32Array(n);
    for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    const dir = (k) => { const a = pts[k], b = pts[k + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    for (let k = 0; k < n; k++) {
      const d0 = dir(Math.max(0, k - 1)), d1 = dir(Math.min(n - 2, k));
      const n0x = d0[1], n0z = -d0[0], n1x = d1[1], n1z = -d1[0], dot = n0x * n1x + n0z * n1z, sc = 1 / Math.max(0.5, 1 + dot);
      mx[k] = (n0x + n1x) * sc; mz[k] = (n0z + n1z) * sc;
    }
    const hw = Math.min(40, w.width) / 2, canal = w.kind === 'canal';
    const way = { w, pts, cum, mx, mz, hw, canal, len: cum[n - 1] };
    ways.push(way);
    // emprise (pour le masque de sol et le test « eau ») : un quad par segment, un peu plus large que l'eau
    const e = hw + 0.35;
    for (let k = 0; k < n - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const q = [[a[0] + mx[k] * e, a[1] + mz[k] * e], [b[0] + mx[k + 1] * e, b[1] + mz[k + 1] * e], [b[0] - mx[k + 1] * e, b[1] - mz[k + 1] * e], [a[0] - mx[k] * e, a[1] - mz[k] * e]];
      q._ribbon = true; ribbons.push(q); ribbonSet.add(q);
    }
  }
  ribbonSet.freeze();
  const P = (way, s, off, out) => {
    const { cum, pts } = way; let k = out._k | 0; if (k > cum.length - 2 || cum[k] > s) k = 0;
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    out._k = k;
    const a = pts[k], b = pts[k + 1], L = cum[k + 1] - cum[k] || 1, t = Math.min(1, Math.max(0, (s - cum[k]) / L));
    out.x = a[0] + (b[0] - a[0]) * t + (way.mx[k] * (1 - t) + way.mx[k + 1] * t) * off;
    out.z = a[1] + (b[1] - a[1]) * t + (way.mz[k] * (1 - t) + way.mz[k + 1] * t) * off;
    out.dx = (b[0] - a[0]) / L; out.dz = (b[1] - a[1]) / L;
    return out;
  };
  let waterMesh = null, uni = null;
  const stat = { ways: ways.length, km: 0, bridges: 0, boats: 0 };

  return {
    ribbons, trees, stat,
    isCanal: (x, z) => ribbonSet.contains(x, z),
    /** Géométrie (dans le jeu de tuiles permanent du fleuve), eau, collisions. */
    build(surf, masks, river) {
      if (!ways.length) return;
      const BANK = profile.canal?.bank || [150, 160, 120], BRICK = profile.quay?.wall || [196, 118, 92], COPING = profile.quay?.coping || [226, 214, 196];
      const wp = [], wi = [];
      const o0 = { _k: 0 }, o1 = { _k: 0 }, o2 = { _k: 0 }, o3 = { _k: 0 };
      const box = (ax, az, bx, bz, hd, bottom, top, tag) => { const len = Math.hypot(bx - ax, bz - az); if (len > 0.3) collision.addBox({ x: (ax + bx) / 2, z: (az + bz) / 2, hw: len / 2 + 0.1, hd, rot: Math.atan2(-(bz - az), bx - ax), bottom, top, tag }); };
      for (const way of ways) {
        const { hw, canal, len } = way; stat.km += len / 1000;
        const depth = canal ? 1.5 : 1.9;
        // niveau de l'eau : relief de l'axe lissé (un bief de canal est horizontal ; on évite une eau « en pente » visible)
        const N = Math.max(1, Math.ceil(len / 8)), yw = new Float32Array(N + 1);
        for (let i = 0; i <= N; i++) { P(way, (len * i) / N, 0, o0); yw[i] = baseHeightAt(o0.x, o0.z); }
        const sm = new Float32Array(N + 1);
        for (let i = 0; i <= N; i++) { let lo = Infinity; for (let j = Math.max(0, i - 10); j <= Math.min(N, i + 10); j++) if (yw[j] < lo) lo = yw[j]; sm[i] = lo - depth; }
        for (let i = 0; i < N; i++) {
          const s0 = (len * i) / N + 1e-3, s1 = (len * (i + 1)) / N - 1e-3, y0 = sm[i], y1 = sm[i + 1];
          // eau
          P(way, s0, hw + 0.4, o0); P(way, s0, -(hw + 0.4), o1); P(way, s1, -(hw + 0.4), o2); P(way, s1, hw + 0.4, o3);
          const b = wp.length / 3;
          wp.push(o0.x, y0, o0.z, o1.x, y0, o1.z, o2.x, y1, o2.z, o3.x, y1, o3.z);
          wi.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 2, b + 1, b, b + 3, b + 2);
          const bld = surf.at(o0.x, o0.z), sm0 = (s0 + s1) / 2;
          for (const sg of [1, -1]) {
            P(way, s0, sg * (hw + 0.3), o0); P(way, s1, sg * (hw + 0.3), o1);
            const g0 = baseHeightAt(o0.x, o0.z), g1 = baseHeightAt(o1.x, o1.z);
            const nx = -sg * o0.dz, nz = sg * o0.dx; // vers l'eau
            if (canal) {
              // canal : perré maçonné + couronnement, chemin de halage en stabilisé
              bld.wall(o0.x, o0.z, o1.x, o1.z, y0 - 0.8, g0 + 0.06, y1 - 0.8, g1 + 0.06, nx, nz, L_STONE, BRICK, s0);
              P(way, s0, sg * (hw - 0.1), o2); P(way, s1, sg * (hw - 0.1), o3);
              const a2 = [o2.x, g0 + 0.07, o2.z], b2 = [o3.x, g1 + 0.07, o3.z];
              P(way, s0, sg * (hw + 1.0), o2); P(way, s1, sg * (hw + 1.0), o3);
              bld.flatQuad(a2, b2, [o3.x, baseHeightAt(o3.x, o3.z) + 0.07, o3.z], [o2.x, baseHeightAt(o2.x, o2.z) + 0.07, o2.z], L_PLAIN, 6, COPING);
              const a3 = [o2.x, baseHeightAt(o2.x, o2.z) + 0.03, o2.z], b3 = [o3.x, baseHeightAt(o3.x, o3.z) + 0.03, o3.z];
              P(way, s0, sg * (hw + 3.6), o2); P(way, s1, sg * (hw + 3.6), o3);
              bld.flatQuad(a3, b3, [o3.x, baseHeightAt(o3.x, o3.z) + 0.03, o3.z], [o2.x, baseHeightAt(o2.x, o2.z) + 0.03, o2.z], L_GRAVEL, 2, [240, 232, 212]);
            } else {
              // rivière, ruisseau : berge en herbe en pente douce
              P(way, s0, sg * (hw * 0.55), o2); P(way, s1, sg * (hw * 0.55), o3);
              bld.flatQuad([o0.x, g0 + 0.02, o0.z], [o1.x, g1 + 0.02, o1.z], [o3.x, y1 - 0.5, o3.z], [o2.x, y0 - 0.5, o2.z], L_GRASS, 1, BANK);
            }
            // on ne roule pas dans l'eau : bordure basse, ouverte là où une voie franchit le cours d'eau
            if (!net.roadAtPad(o0.x, o0.z, 2.5, false, 0) && !net.roadAtPad(o1.x, o1.z, 2.5, false, 0)) box(o0.x, o0.z, o1.x, o1.z, 0.3, -Infinity, Math.max(g0, g1) + 1.1, 'berge');
            // platanes en double alignement le long des canaux (voûte), tous les 9 m
            if (canal && i % 1 === 0 && Math.floor(sm0 / 9) !== Math.floor((sm0 - len / N) / 9)) for (const off of [hw + 2.2, hw + 5.4]) { P(way, sm0, sg * off, o2); trees.push(o2.x, o2.z); }
          }
          // péniches amarrées (canaux larges), de loin en loin
          if (canal && hw >= 7 && i % 55 === 27) {
            P(way, sm0, hw - 3.1, o2); stat.boats++;
            const hull = stat.boats % 2 ? [40, 52, 46] : [100, 40, 34], L = 24;
            surf.at(o2.x, o2.z).prism(o2.x - o2.dx * L / 2, o2.z - o2.dz * L / 2, o2.x + o2.dx * L / 2, o2.z + o2.dz * L / 2, 4.6, y0 - 0.3, y0 - 0.3, 1.4, L_PLAIN, hull, true);
            surf.at(o2.x, o2.z).prism(o2.x - o2.dx * L * 0.3, o2.z - o2.dz * L * 0.3, o2.x + o2.dx * L * 0.1, o2.z + o2.dz * L * 0.1, 3.6, y0 + 1.1, y0 + 1.1, 1.5, L_PLAIN, [226, 220, 208], true);
          }
        }
        // petits ponts : rues au sol qui franchissent le cours d'eau (rives maçonnées, parapets, collision au niveau de la rue)
        const done = new Set(), pr = { _k: 0 }, q0 = { _k: 0 }, q1 = { _k: 0 };
        for (let s = 0; s <= len; s += 3) {
          P(way, s, 0, o0);
          const r = net.roadAtPad(o0.x, o0.z, 0, false, 0);
          if (!r || done.has(r._i) || r._ele) continue;
          done.add(r._i);
          // abscisse du point de la route le plus proche de l'axe de l'eau
          let best = 0, bd = Infinity;
          for (let u = 0; u <= r._len; u += 2) { net.pointAt(r, u, 0, pr); const d = (pr.x - o0.x) ** 2 + (pr.z - o0.z) ** 2; if (d < bd) { bd = d; best = u; } }
          let sa = best, sb = best;
          while (sa > 0 && best - sa < 45 && ribbonSet.contains(net.pointAt(r, sa - 1.5, 0, pr).x, pr.z)) sa -= 1.5;
          while (sb < r._len && sb - best < 45 && ribbonSet.contains(net.pointAt(r, sb + 1.5, 0, pr).x, pr.z)) sb += 1.5;
          sa = Math.max(0, sa - 2.5); sb = Math.min(r._len, sb + 2.5);
          if (sb - sa < 4) continue;
          stat.bridges++;
          const W = r._hw + r._sw + 0.7, yWat = sm[Math.min(N, Math.round((s / len) * N))];
          for (const sg of [1, -1]) {
            net.pointAt(r, sa, sg * W, q0); net.pointAt(r, sb, sg * W, q1);
            const g0 = baseHeightAt(q0.x, q0.z), g1 = baseHeightAt(q1.x, q1.z), b2 = surf.at(q0.x, q0.z);
            b2.wall(q0.x, q0.z, q1.x, q1.z, yWat - 0.6, g0 + 0.05, yWat - 0.6, g1 + 0.05, sg * q0.dz, -sg * q0.dx, L_STONE, BRICK, 0);
            b2.prism(q0.x, q0.z, q1.x, q1.z, 0.4, g0, g1, 0.95, L_STONE, BRICK, true);
            box(q0.x, q0.z, q1.x, q1.z, 0.3, Math.min(g0, g1) - 0.6, Math.max(g0, g1) + 1.6, 'parapet');
          }
          // tablier sous la chaussée et les trottoirs (dalle)
          net.pointAt(r, sa, W, q0); net.pointAt(r, sb, W, q1); const A = [q0.x, baseHeightAt(q0.x, q0.z) - 0.02, q0.z], Bq = [q1.x, baseHeightAt(q1.x, q1.z) - 0.02, q1.z];
          net.pointAt(r, sa, -W, q0); net.pointAt(r, sb, -W, q1);
          surf.at(A[0], A[2]).flatQuad(A, Bq, [q1.x, baseHeightAt(q1.x, q1.z) - 0.02, q1.z], [q0.x, baseHeightAt(q0.x, q0.z) - 0.02, q0.z], L_PLAIN, 0, [150, 146, 138]);
        }
      }
      // surface de l'eau (même shader que le fleuve, teinte calme des canaux)
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wp), 3));
      const nn = new Float32Array(wp.length); for (let i = 1; i < nn.length; i += 3) nn[i] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
      g.setIndex(wi);
      const mat = river.waterMaterial.clone();
      mat.onBeforeCompile = river.waterMaterial.onBeforeCompile; mat.customProgramCacheKey = river.waterMaterial.customProgramCacheKey;
      mat.color.setHex(profile.canal?.water ?? 0x3f5a3a);
      waterMesh = new THREE.Mesh(g, mat);
      waterMesh.receiveShadow = true; waterMesh.name = 'canaux'; waterMesh.frustumCulled = false; waterMesh.matrixAutoUpdate = false;
      scene.add(waterMesh);
      uni = river.waterUniforms; void uni; void masks;
      stat.km = Math.round(stat.km * 10) / 10;
    },
    update() { /* l'eau des canaux partage les uniformes (temps, ciel) du fleuve */ },
  };
}

// Sol de la ville, par tuile : maillage du relief de base (baseHeightAt), matière choisie par le masque de sol.
//
// Raccords sans fissure : quand le relief vient d'une grille d'altitudes (bilinéaire par maille), le treillis de chaque
// tuile contient les bords de la tuile ET toutes les lignes de la grille d'altitudes ; le long d'un bord de tuile la
// hauteur est donc linéaire entre deux sommets, quel que soit le niveau de détail des deux tuiles voisines.
import { baseHeightAt, hasHeightmap } from '@shared/terrain.js';
import { TILE, SurfBuilder } from './util.js';
import { L_GROUND } from './textures.js';
import { Y_GROUND } from './streets.js';

const WHITE = [255, 255, 255];

export function createGround(ctx, masks, profile, mats) {
  const { THREE, scene } = ctx;
  const terr = hasHeightmap() ? ctx.worldData.terrain : null;
  const tx0 = Math.floor(masks.x0 / TILE), tx1 = Math.ceil((masks.x0 + masks.sizeX) / TILE) - 1;
  const tz0 = Math.floor(masks.z0 / TILE), tz1 = Math.ceil((masks.z0 + masks.sizeZ) / TILE) - 1;

  /** Coordonnées du treillis le long d'un axe pour la tuile [a, a + TILE] : bords, lignes de la grille d'altitudes, k subdivisions. */
  function lattice(a, size, g0, cell, k, out) {
    out.length = 0; out.push(a);
    const st = cell / k;
    for (let i = Math.floor((a - g0) / st) + 1; ; i++) { const v = g0 + i * st; if (v >= a + size - 1e-3) break; if (v > a + 1e-3) out.push(v); }
    out.push(a + size);
    return out;
  }
  const xs = [], zs = [];
  /** Géométrie du sol du carré [ox, ox+size]². fine = vrai près du joueur (subdivision des mailles du relief) ; dy = décalage vertical. */
  function geometry(ox, oz, size, fine, dy = 0) {
    if (terr) { const k = fine ? 2 : 1; lattice(ox, size, terr.x0, terr.cell, k, xs); lattice(oz, size, terr.z0, terr.cell, k, zs); }
    else {
      // relief analytique (ou plat) : treillis régulier de 20 m si la tuile n'est pas plate
      let lo = Infinity, hi = -Infinity;
      const M = Math.max(5, Math.round(size / 100));
      for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) { const h = baseHeightAt(ox + (i * size) / M, oz + (j * size) / M); if (h < lo) lo = h; if (h > hi) hi = h; }
      const N = hi - lo < 0.01 ? 1 : Math.round(size / 20);
      xs.length = zs.length = 0; for (let i = 0; i <= N; i++) { xs.push(ox + (i * size) / N); zs.push(oz + (i * size) / N); }
    }
    const nx = xs.length, nz = zs.length, b = new SurfBuilder(nx * nz + 8);
    const flat = nx === 2 && nz === 2;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j];
      let gx = 0, gy = 1, gz = 0;
      if (!flat) { const e = 2; gx = baseHeightAt(x - e, z) - baseHeightAt(x + e, z); gz = baseHeightAt(x, z - e) - baseHeightAt(x, z + e); gy = 2 * e; const l = Math.hypot(gx, gy, gz); gx /= l; gy /= l; gz /= l; }
      b.v(x, baseHeightAt(x, z) + Y_GROUND + dy, z, x, z, L_GROUND, 0, 0, WHITE, gx, gy, gz);
    }
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, c = a + nx; b.idx.push(a, c, a + 1, a + 1, c, c + 1); }
    return b.build(THREE);
  }
  const coarseMat = mats.ground;
  return {
    has: (ix, iz) => ix >= tx0 && ix <= tx1 && iz >= tz0 && iz <= tz1,
    build(ix, iz) {
      const m = new THREE.Mesh(geometry(ix * TILE, iz * TILE, TILE, false), coarseMat);
      m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'sol';
      scene.add(m);
      return { mesh: m, ix, iz, fineGeo: false, fineMat: null };
    },
    dispose(t) { scene.remove(t.mesh); t.mesh.geometry.dispose(); if (t.fineMat) { t.fineMat.userData.mask.uMask.value.dispose(); t.fineMat.dispose(); } },
    // près du joueur : maillage plus fin (relief en grille) et masque de sol haute résolution (mode 'classes')
    near: [
      { radius: (profile.radii.groundNear || 1500) - 300, on(t) { if (terr && !t.fineGeo) { t.mesh.geometry.dispose(); t.mesh.geometry = geometry(t.ix * TILE, t.iz * TILE, TILE, true); t.fineGeo = true; } }, off(t) { if (t.fineGeo) { t.mesh.geometry.dispose(); t.mesh.geometry = geometry(t.ix * TILE, t.iz * TILE, TILE, false); t.fineGeo = false; } } },
      { radius: profile.mask?.fineRadius || 0, on(t) { const f = masks.fineFor(t.ix, t.iz); if (!f) return; t.fineMat = mats.makeGround(f); t.mesh.material = t.fineMat; }, off(t) { if (!t.fineMat) return; t.mesh.material = coarseMat; t.fineMat.userData.mask.uMask.value.dispose(); t.fineMat.dispose(); t.fineMat = null; } },
    ],
    // --- sol lointain : grandes tuiles (FAR m), légèrement abaissées et repoussées en profondeur (le sol proche passe devant)
    FAR: 2000,
    hasFar(ix, iz) { const F = 2000; return (ix + 1) * F > tx0 * TILE && ix * F < (tx1 + 1) * TILE && (iz + 1) * F > tz0 * TILE && iz * F < (tz1 + 1) * TILE; },
    buildFar(ix, iz) {
      const F = 2000;
      // rognée sur l'emprise du sol (la jupe prend le relais au-delà)
      const m = new THREE.Mesh(geometry(ix * F, iz * F, F, false, -0.14), mats.groundFar);
      m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'sol-lointain';
      scene.add(m);
      return { mesh: m };
    },
    disposeFar(t) { scene.remove(t.mesh); t.mesh.geometry.dispose(); },
    /** Jupe lointaine (au-delà des données) : bandes jusqu'à l'horizon, à la hauteur du bord de l'emprise. */
    buildSkirt() {
      const b = new SurfBuilder(256), F = profile.skirt || 7000;
      const FT = 2000, X0 = Math.floor((tx0 * TILE) / FT) * FT, X1 = Math.ceil(((tx1 + 1) * TILE) / FT) * FT, Z0 = Math.floor((tz0 * TILE) / FT) * FT, Z1 = Math.ceil(((tz1 + 1) * TILE) / FT) * FT;
      const strip = (ax, az, bx, bz, ox, oz) => { // segment de bord (a→b), extrudé de (ox, oz)
        const ha = baseHeightAt(ax, az) + Y_GROUND - 0.14, hb = baseHeightAt(bx, bz) + Y_GROUND - 0.14;
        b.flatQuad([ax, ha, az], [bx, hb, bz], [bx + ox, hb, bz + oz], [ax + ox, ha, az + oz], L_GROUND, 0, WHITE);
      };
      const st = terr ? TILE : (X1 - X0);
      for (let x = X0; x < X1 - 1; x += st) { const xe = Math.min(X1, x + st); strip(x, Z0, xe, Z0, 0, -F); strip(x, Z1, xe, Z1, 0, F); }
      const stz = terr ? TILE : (Z1 - Z0);
      for (let z = Z0; z < Z1 - 1; z += stz) { const ze = Math.min(Z1, z + stz); strip(X0, z, X0, ze, -F, 0); strip(X1, z, X1, ze, F, 0); }
      for (const [cx, cz, sx, sz] of [[X0, Z0, -1, -1], [X1, Z0, 1, -1], [X0, Z1, -1, 1], [X1, Z1, 1, 1]]) { const h = baseHeightAt(cx, cz) + Y_GROUND - 0.14; b.flatQuad([cx, h, cz], [cx + sx * F, h, cz], [cx + sx * F, h, cz + sz * F], [cx, h, cz + sz * F], L_GROUND, 0, WHITE); }
      const m = new THREE.Mesh(b.build(THREE), mats.groundFar);
      m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'sol-lointain'; m.frustumCulled = false;
      scene.add(m);
      return m;
    },
  };
}

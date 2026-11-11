// Diffusion par tuile : construction paresseuse autour d'un point (le joueur), dans un budget de temps par image,
// et libération au loin. Chaque « couche » (sol, rues, immeubles, arbres, mobilier…) déclare son rayon, sa fonction
// de construction (éventuellement un générateur, repris d'image en image) et sa fonction de libération.
import { TILE, tileKeyI, tileDist } from './util.js';

export function createTileManager({ size = TILE } = {}) {
  const layers = [];
  let lastX = Infinity, lastZ = Infinity, dirty = true, queue = [];
  const stat = { built: 0, disposed: 0, maxSliceMs: 0, pending: 0 };

  /**
   * def : { name, radius, hyst?, bias?, has(ix, iz) -> bool, build(ix, iz, entry) -> objet | générateur,
   *         dispose(obj, entry), near?: [{ radius, hyst?, on(obj, entry), off(obj, entry) }] }
   */
  function addLayer(def) {
    const L = { size, bias: 0, near: [], ...def, tiles: new Map() };
    if (L.hyst === undefined) L.hyst = L.size * 0.6;
    layers.push(L);
    return L;
  }
  function rescan(cx, cz) {
    queue = [];
    for (const L of layers) {
      const R = L.radius, size = L.size, ix0 = Math.floor((cx - R) / size), ix1 = Math.floor((cx + R) / size), iz0 = Math.floor((cz - R) / size), iz1 = Math.floor((cz + R) / size);
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
        const d = tileDist(ix, iz, cx, cz, size); if (d >= R) continue;
        const key = tileKeyI(ix, iz);
        if (L.tiles.has(key) || !L.has(ix, iz)) continue;
        L.tiles.set(key, { ix, iz, key, obj: null, job: null, ready: false, d, on: [] });
      }
      for (const [key, e] of L.tiles) {
        e.d = tileDist(e.ix, e.iz, cx, cz, L.size);
        if (e.d > R + L.hyst) { release(L, e); L.tiles.delete(key); continue; }
        if (!e.ready) queue.push([e.d + L.bias, L, e]);
        else for (let k = 0; k < L.near.length; k++) {
          const n = L.near[k];
          if (!e.on[k] && e.d < n.radius) { e.on[k] = true; n.on(e.obj, e); }
          else if (e.on[k] && e.d > n.radius + (n.hyst ?? L.size * 0.3)) { e.on[k] = false; n.off(e.obj, e); }
        }
      }
    }
    queue.sort((a, b) => b[0] - a[0]); // le plus proche à la fin (pop)
    stat.pending = queue.length;
  }
  function release(L, e) {
    if (e.ready) { for (let k = 0; k < L.near.length; k++) if (e.on[k]) { e.on[k] = false; L.near[k].off(e.obj, e); } L.dispose?.(e.obj, e); stat.disposed++; }
    e.job = null; e.ready = false; e.obj = null; e.dead = true;
  }
  /** Avance la construction de l'entrée la plus prioritaire ; retourne false s'il ne reste rien. */
  function step(deadline) {
    const top = queue[queue.length - 1]; if (!top) return false;
    const [, L, e] = top;
    if (e.dead) { queue.pop(); return true; }
    if (!e.job) {
      const r = L.build(e.ix, e.iz, e);
      if (r && typeof r.next === 'function') e.job = r; else { finish(L, e, r); queue.pop(); return true; }
    }
    for (;;) {
      const r = e.job.next();
      if (r.done) { finish(L, e, r.value); queue.pop(); return true; }
      if (performance.now() >= deadline) return true;
    }
  }
  function finish(L, e, obj) {
    e.obj = obj; e.job = null; e.ready = true; stat.built++;
    for (let k = 0; k < L.near.length; k++) if (e.d < L.near[k].radius) { e.on[k] = true; L.near[k].on(obj, e); }
  }
  return {
    addLayer, layers, stat, size,
    /** Force un nouveau balayage (rayon d'une couche modifié, données arrivées…). */
    invalidate() { dirty = true; },
    /** Reconstruit la tuile (ix, iz) d'une couche (après une modification de son contenu). */
    rebuild(L, ix, iz) { const e = L.tiles.get(tileKeyI(ix, iz)); if (e) { release(L, e); L.tiles.delete(e.key); dirty = true; } },
    /** À appeler à chaque image : (x, z) = centre d'intérêt, budget en ms. */
    update(x, z, budgetMs) {
      if (dirty || Math.abs(x - lastX) + Math.abs(z - lastZ) > 60) { rescan(x, z); lastX = x; lastZ = z; dirty = false; }
      if (!queue.length) return;
      const t0 = performance.now(), deadline = t0 + budgetMs;
      while (performance.now() < deadline && step(deadline));
      const dt = performance.now() - t0; if (dt > stat.maxSliceMs) stat.maxSliceMs = dt;
      stat.pending = queue.length;
    },
    /** Construit sans attendre tout ce qui est à moins de `radius` de (x, z), dans la limite de maxMs. */
    prime(x, z, radius, maxMs) {
      rescan(x, z); lastX = x; lastZ = z; dirty = false;
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < maxMs) {
        const top = queue[queue.length - 1]; if (top[2].d > radius && !top[2].job) break;
        step(performance.now() + 50);
      }
      stat.pending = queue.length;
      return performance.now() - t0;
    },
    counts() { const o = {}; for (const L of layers) { let r = 0; for (const e of L.tiles.values()) if (e.ready) r++; o[L.name] = r; } return o; },
  };
}

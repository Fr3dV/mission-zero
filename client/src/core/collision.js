// Collisions statiques 2D (plan XZ) avec grille spatiale.
// Les obstacles sont des boîtes orientées (OBB) ou des cercles, avec une plage verticale [bottom, top].
const CELL = 40;
const grid = new Map();
let nextId = 1;
const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;

function cellsFor(s) {
  const r = s.kind === 'circle' ? s.r : Math.hypot(s.hw, s.hd);
  const x0 = Math.floor((s.x - r) / CELL), x1 = Math.floor((s.x + r) / CELL);
  const z0 = Math.floor((s.z - r) / CELL), z1 = Math.floor((s.z + r) / CELL);
  const out = [];
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) out.push(key(cx, cz));
  return out;
}
function insert(s) {
  s.id = nextId++;
  s.cells = cellsFor(s);
  for (const k of s.cells) {
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(s);
  }
  return s;
}

export const collision = {
  /** Boîte orientée. x,z = centre ; hw,hd = demi-largeur (X local) / demi-profondeur (Z local) ; rot = rotation Y (rad). */
  addBox({ x, z, hw, hd, rot = 0, bottom = -Infinity, top = Infinity, tag = '' }) {
    return insert({ kind: 'box', x, z, hw, hd, rot, cos: Math.cos(rot), sin: Math.sin(rot), bottom, top, tag });
  },
  addCircle({ x, z, r, bottom = -Infinity, top = Infinity, tag = '' }) {
    return insert({ kind: 'circle', x, z, r, bottom, top, tag });
  },
  remove(s) {
    if (!s?.cells) return;
    for (const k of s.cells) {
      const a = grid.get(k);
      if (!a) continue;
      const i = a.indexOf(s);
      if (i >= 0) a.splice(i, 1);
    }
    s.cells = null;
  },
  clear() { grid.clear(); },

  /**
   * Repousse un cercle (x,z,r) à hauteur y hors des obstacles.
   * @returns {{x:number,z:number,hit:boolean,nx:number,nz:number,tag:string}} position corrigée + normale du dernier contact.
   */
  resolveCircle(x, z, r, y = 0.5) {
    let hit = false, nx = 0, nz = 0, tag = '';
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
      const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const a = grid.get(key(cx, cz));
        if (!a) continue;
        for (const s of a) {
          if (y < s.bottom || y > s.top) continue;
          let px, pz;
          if (s.kind === 'circle') {
            const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz), min = r + s.r;
            if (d >= min) continue;
            const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
            px = ux * (min - d); pz = uz * (min - d);
          } else {
            // passage en repère local de la boîte
            const dx = x - s.x, dz = z - s.z;
            const lx = dx * s.cos - dz * s.sin, lz = dx * s.sin + dz * s.cos;
            const qx = Math.max(-s.hw, Math.min(s.hw, lx)), qz = Math.max(-s.hd, Math.min(s.hd, lz));
            let ox = lx - qx, oz = lz - qz;
            const d = Math.hypot(ox, oz);
            let plx, plz;
            if (d > 1e-6) {
              if (d >= r) continue;
              plx = (ox / d) * (r - d); plz = (oz / d) * (r - d);
            } else {
              // centre à l'intérieur : sortir par la face la plus proche
              const ex = s.hw - Math.abs(lx), ez = s.hd - Math.abs(lz);
              if (ex < ez) { plx = Math.sign(lx || 1) * (ex + r); plz = 0; }
              else { plx = 0; plz = Math.sign(lz || 1) * (ez + r); }
            }
            px = plx * s.cos + plz * s.sin; pz = -plx * s.sin + plz * s.cos;
          }
          x += px; z += pz;
          const l = Math.hypot(px, pz) || 1;
          nx = px / l; nz = pz / l; hit = true; moved = true; tag = s.tag;
        }
      }
      if (!moved) break;
    }
    return { x, z, hit, nx, nz, tag };
  },
  /** true si le cercle touche un obstacle. */
  test(x, z, r, y = 0.5) { return this.resolveCircle(x, z, r, y).hit; },
};

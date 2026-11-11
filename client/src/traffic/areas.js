// Trafic — zones de la ville (worldData.pois.areas, parcs, places) indexées dans une grille, pour moduler la
// densité des voitures et des piétons selon le lieu et trouver les parkings proches.
// Rien n'est testé par arête : la zone d'un point n'est cherchée qu'au moment d'une apparition (quelques fois
// par image), par test point-dans-polygone sur les seules zones de la case.

export const A_NONE = 0, A_RESIDENTIAL = 1, A_COMMERCIAL = 2, A_INDUSTRIAL = 3, A_PARKING = 4, A_PEDESTRIAN = 5, A_GREEN = 6, A_NOGO = 7;
const KIND = {
  residential: A_RESIDENTIAL, commercial: A_COMMERCIAL, retail: A_COMMERCIAL, industrial: A_INDUSTRIAL, parking: A_PARKING,
  pedestrian: A_PEDESTRIAN, cobble: A_PEDESTRIAN, plaza: A_PEDESTRIAN, park: A_GREEN, grass: A_GREEN, gravel: A_GREEN, forest: A_NOGO, farmland: A_NOGO,
  runway: A_NOGO, taxiway: A_NOGO, apron: A_NOGO, railway: A_NOGO, construction: A_NOGO, cemetery: A_GREEN, pitch: A_GREEN,
};
// Si plusieurs zones se recouvrent, la plus « forte » l'emporte (une place piétonne dans un quartier résidentiel…).
const STRENGTH = [0, 1, 3, 4, 5, 6, 2, 7];
const CELL = 128;

function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

export function buildAreas(worldData) {
  const list = [], kinds = [];
  const add = (arr, forced) => {
    if (!Array.isArray(arr)) return;
    for (const a of arr) {
      const poly = a && (a.polygon || a.points);
      const k = forced || KIND[a && a.kind] || 0;
      if (!k || !poly || poly.length < 3) continue;
      list.push(poly); kinds.push(k);
    }
  };
  add(worldData.pois && worldData.pois.areas, 0);
  add(worldData.plazas, A_PEDESTRIAN);
  add(worldData.parks, A_GREEN);
  const n = list.length;
  if (!n) return { count: 0, parkings: 0, pedZones: 0, kindAt: () => A_NONE, parkingNear: () => -1, randomOfKind: () => -1, polygon: () => null, inside: () => false, bbox: null };
  const bb = new Float32Array(n * 4);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, parkings = 0, pedZones = 0;
  for (let i = 0; i < n; i++) {
    const p = list[i]; let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < p.length; k++) { const x = p[k][0], z = p[k][1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    bb[i * 4] = x0; bb[i * 4 + 1] = z0; bb[i * 4 + 2] = x1; bb[i * 4 + 3] = z1;
    if (x0 < minX) minX = x0; if (x1 > maxX) maxX = x1; if (z0 < minZ) minZ = z0; if (z1 > maxZ) maxZ = z1;
    if (kinds[i] === A_PARKING) parkings++; else if (kinds[i] === A_PEDESTRIAN) pedZones++;
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / CELL) + 1), rows = Math.max(1, Math.ceil((maxZ - minZ) / CELL) + 1);
  const start = new Int32Array(cols * rows + 1);
  const each = (cb) => {
    for (let i = 0; i < n; i++) {
      const cx0 = Math.floor((bb[i * 4] - minX) / CELL), cx1 = Math.floor((bb[i * 4 + 2] - minX) / CELL);
      const cz0 = Math.floor((bb[i * 4 + 1] - minZ) / CELL), cz1 = Math.floor((bb[i * 4 + 3] - minZ) / CELL);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) cb(cz * cols + cx, i);
    }
  };
  each((c) => { start[c + 1]++; });
  for (let i = 0; i < cols * rows; i++) start[i + 1] += start[i];
  const items = new Int32Array(start[cols * rows]), fill = new Int32Array(cols * rows);
  each((c, i) => { items[start[c] + fill[c]++] = i; });

  return {
    count: n, parkings, pedZones,
    /** Type de zone en (x, z) (A_*), A_NONE hors de toute zone connue. */
    kindAt(x, z) {
      const cx = Math.floor((x - minX) / CELL), cz = Math.floor((z - minZ) / CELL);
      if (cx < 0 || cz < 0 || cx >= cols || cz >= rows) return A_NONE;
      const c = cz * cols + cx;
      let best = A_NONE;
      for (let k = start[c]; k < start[c + 1]; k++) {
        const i = items[k], kd = kinds[i];
        if (STRENGTH[kd] <= STRENGTH[best]) continue;
        if (x < bb[i * 4] || x > bb[i * 4 + 2] || z < bb[i * 4 + 1] || z > bb[i * 4 + 3]) continue;
        if (inside(list[i], x, z)) best = kd;
      }
      return best;
    },
    /** Indice d'une zone du type `kind` dont l'emprise touche la case de (x, z), tirée au hasard ; −1 s'il n'y en a pas. */
    randomOfKind(x, z, kind) {
      const cx = Math.floor((x - minX) / CELL), cz = Math.floor((z - minZ) / CELL);
      if (cx < 0 || cz < 0 || cx >= cols || cz >= rows) return -1;
      const c = cz * cols + cx, m = start[c + 1] - start[c];
      if (!m) return -1;
      const k0 = (Math.random() * m) | 0;
      for (let k = 0; k < m; k++) { const i = items[start[c] + ((k0 + k) % m)]; if (kinds[i] === kind) return i; }
      return -1;
    },
    parkingNear(x, z) { return this.randomOfKind(x, z, A_PARKING); },
    polygon: (i) => list[i],
    bbox: bb,
    inside: (i, x, z) => inside(list[i], x, z),
  };
}

// Masque du sol : dit au shader du sol quelle matière afficher en chaque point (pelouse, allée, place, champ, parking…)
// et où le sol est évidé (fleuve, canal, tranchée routière). Sert aussi aux requêtes CPU (isWater, isGrass, isPark…).
//
// Deux modes, choisis par le profil de la ville :
//  - 'legacy'  (Paris) : UNE texture canvas pour toute la ville. R = eau, G = parc, B = minéral
//                        (G seul = pelouse, G+B = allée stabilisée, B seul = place pavée).
//  - 'classes' (grandes villes) : R = couverture « évidé », G = indice de classe de sol (voir CLASSES). Une carte
//                        grossière pour toute la ville (lointain + requêtes CPU) et des cartes fines par tuile,
//                        rastérisées à la demande près du joueur (rien de global en haute résolution).
// La question « est-ce de l'eau ? » est toujours analytique (point dans polygone indexé par bandes) : exacte et
// indépendante de la résolution des textures.
import { polyBBox, polyArea, mulberry32, TILE, tileKey } from './util.js';

// Classes de sol du mode 'classes' : [couche de texture, teinte r,g,b, rugosité]. L'ordre est celui de l'indice G.
export const CLASSES = [
  [1, 0.90, 0.90, 0.90, 0.86], //  0 sol urbain (trottoir)
  [3, 1.00, 1.00, 1.00, 1.00], //  1 pelouse, parc
  [4, 1.00, 1.00, 1.00, 1.00], //  2 stabilisé, allée
  [2, 1.00, 1.00, 1.00, 0.72], //  3 pavés, zone piétonne
  [3, 0.52, 0.62, 0.44, 1.00], //  4 sous-bois
  [3, 1.30, 1.16, 0.70, 1.00], //  5 champ
  [0, 1.00, 1.00, 1.00, 0.88], //  6 parking (bitume)
  [3, 0.80, 1.22, 0.78, 1.00], //  7 terrain de sport
  [4, 0.78, 0.78, 0.78, 1.00], //  8 cimetière
  [4, 0.52, 0.47, 0.44, 1.00], //  9 ballast ferroviaire
  [0, 0.82, 0.82, 0.86, 0.85], // 10 piste d'aéroport
  [7, 0.70, 0.70, 0.68, 0.80], // 11 tarmac, voie de circulation (béton)
  [3, 0.95, 1.02, 0.82, 1.00], // 12 jardins de zone pavillonnaire
  [4, 0.68, 0.58, 0.44, 1.00], // 13 chantier, terre
  [0, 1.22, 1.22, 1.22, 0.88], // 14 cour d'activité, zone commerciale
  [0, 1.00, 1.00, 1.00, 0.88], // 15 chaussée vue de loin
];
export const C_BASE = 0, C_GRASS = 1, C_GRAVEL = 2, C_PAVE = 3, C_FOREST = 4, C_FIELD = 5, C_PARKING = 6, C_PITCH = 7, C_GARDEN = 12, C_ROADFAR = 15;
const KIND_CLASS = { pedestrian: 3, cobble: 3, gravel: 2, grass: 1, forest: 4, farmland: 5, industrial: 14, commercial: 14, residential: 12, parking: 6, pitch: 7, cemetery: 8, runway: 10, taxiway: 11, apron: 11, railway: 9, construction: 13 };
const KIND_PRIO = { farmland: 0, residential: 1, industrial: 2, commercial: 2, forest: 3, grass: 4, cemetery: 5, railway: 5, construction: 5, parking: 6, pitch: 7, apron: 8, taxiway: 9, runway: 10, gravel: 11, pedestrian: 12, cobble: 12 };

/** Ensemble de polygones avec test « point dedans » rapide (arêtes rangées par bandes de z). */
export class PolySet {
  constructor(band = 32) { this.band = band; this.rows = new Map(); this.n = 0; this.x0 = Infinity; this.x1 = -Infinity; this.z0 = Infinity; this.z1 = -Infinity; this.polys = []; }
  add(poly) {
    if (!poly || poly.length < 3) return;
    const id = this.n++; this.polys.push(poly);
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0], az = poly[j][1], bx = poly[i][0], bz = poly[i][1];
      if (ax < this.x0) this.x0 = ax; if (ax > this.x1) this.x1 = ax; if (az < this.z0) this.z0 = az; if (az > this.z1) this.z1 = az;
      if (az === bz) continue;
      for (let r = Math.floor(Math.min(az, bz) / this.band), r1 = Math.floor(Math.max(az, bz) / this.band); r <= r1; r++) { let a = this.rows.get(r); if (!a) this.rows.set(r, (a = [])); a.push(id, ax, az, bx, bz); }
    }
  }
  /** À appeler après le dernier add : fige les bandes en tableaux typés. */
  freeze() { for (const [k, a] of this.rows) this.rows.set(k, Float32Array.from(a)); return this; }
  contains(x, z) {
    if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return false;
    const a = this.rows.get(Math.floor(z / this.band)); if (!a) return false;
    let cur = -1, odd = false;
    for (let i = 0; i < a.length; i += 5) {
      if (a[i] !== cur) { if (odd) return true; cur = a[i]; }
      const az = a[i + 2], bz = a[i + 4];
      if ((az > z) !== (bz > z) && x < ((a[i + 3] - a[i + 1]) * (z - az)) / (bz - az) + a[i + 1]) odd = !odd;
    }
    return odd;
  }
}

/** Remplissage par balayage d'un polygone (coordonnées déjà en pixels, tableau plat) dans une carte d'octets S×S. */
function fillPoly(buf, S, px, n, value) {
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const y = px[i * 2 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const ya = Math.max(0, Math.ceil(y0 - 0.5)), yb = Math.min(S - 1, Math.floor(y1 - 0.5));
  const xs = fillPoly.xs;
  for (let y = ya; y <= yb; y++) {
    const yc = y + 0.5; let m = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ay = px[j * 2 + 1], by = px[i * 2 + 1];
      if ((ay > yc) !== (by > yc)) xs[m++] = px[j * 2] + ((px[i * 2] - px[j * 2]) * (yc - ay)) / (by - ay);
    }
    if (m < 2) continue;
    // tri par insertion (peu de croisements par ligne)
    for (let i = 1; i < m; i++) { const v = xs[i]; let k = i - 1; while (k >= 0 && xs[k] > v) { xs[k + 1] = xs[k]; k--; } xs[k + 1] = v; }
    for (let i = 0; i + 1 < m; i += 2) {
      const xa = Math.max(0, Math.ceil(xs[i] - 0.5)), xb = Math.min(S - 1, Math.floor(xs[i + 1] - 0.5));
      if (xb >= xa) buf.fill(value, y * S + xa, y * S + xb + 1);
    }
  }
}
fillPoly.xs = new Float64Array(4096);

export function createMasks(ctx, Q, profile, extra = {}) {
  const { THREE, BOUNDS, worldData } = ctx;
  const cfg = profile.mask || { mode: 'legacy', size: { high: 4096 }, margin: 700 };
  const MARGIN = cfg.margin ?? 700;
  const x0 = BOUNDS.minX - MARGIN, z0 = BOUNDS.minZ - MARGIN;
  const sizeX = BOUNDS.maxX - BOUNDS.minX + 2 * MARGIN, sizeZ = BOUNDS.maxZ - BOUNDS.minZ + 2 * MARGIN;

  const river = worldData.river || {};
  const riverPolys = (river.polygons || []).filter((p) => p && p.length >= 3);
  const islands = (river.islands || []).map((i) => i.polygon || i).filter((p) => p && p.length >= 3);
  // bords du fleuve coupés à la limite des données : prolongés vers l'extérieur
  const CLIP = 140, EXT = [];
  const outside = (p) => (p[0] < BOUNDS.minX - CLIP ? 1 : 0) | (p[0] > BOUNDS.maxX + CLIP ? 2 : 0) | (p[1] < BOUNDS.minZ - CLIP ? 4 : 0) | (p[1] > BOUNDS.maxZ + CLIP ? 8 : 0);
  for (const poly of riverPolys) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], m = outside(a) & outside(b);
    if (!m) continue;
    const ex = (m & 1 ? -1 : m & 2 ? 1 : 0) * 1500, ez = (m & 4 ? -1 : m & 8 ? 1 : 0) * 1500;
    EXT.push([[a[0], a[1]], [b[0], b[1]], [b[0] + ex, b[1] + ez], [a[0] + ex, a[1] + ez]]);
  }
  // --- eau : test analytique. waterPolys = fleuve + prolongements + rubans des canaux ; voidPolys = tranchées routières
  const waterPolys = [...riverPolys, ...EXT, ...(extra.waterRibbons || [])];
  const voidPolys = extra.voidQuads || [];
  const waterSet = new PolySet(), islandSet = new PolySet(), riverSet = new PolySet();
  for (const p of waterPolys) waterSet.add(p);
  for (const p of riverPolys) riverSet.add(p);
  for (const p of EXT) riverSet.add(p);
  for (const p of islands) islandSet.add(p);
  waterSet.freeze(); islandSet.freeze(); riverSet.freeze();
  const isWater = (x, z) => waterSet.contains(x, z) && !islandSet.contains(x, z);
  /** Dans le fleuve proprement dit (plan d'eau à WATER_LEVEL), canaux et ruisseaux exclus. */
  const isRiver = (x, z) => riverSet.contains(x, z) && !islandSet.contains(x, z);
  const nearWater = (x, z, pad) => isWater(x, z) || isWater(x + pad, z) || isWater(x - pad, z) || isWater(x, z + pad) || isWater(x, z - pad);

  const parkInfos = [];
  for (const pk of worldData.parks || []) { const poly = pk.polygon; if (!poly || poly.length < 3) continue; parkInfos.push({ park: pk, bb: polyBBox(poly), area: Math.abs(polyArea(poly)) }); }
  const common = { x0, z0, sizeX, sizeZ, parkInfos, riverPolys, islands, waterPolys, isWater, isRiver, nearWater, mode: cfg.mode };

  // =====================================================================================================
  if (cfg.mode !== 'classes') {
    const S = (cfg.size && (cfg.size[ctx.quality] || cfg.size.high)) || Q.maskSize;
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    const sx = S / sizeX, sz = S / sizeZ;
    g.setTransform(sx, 0, 0, sz, -x0 * sx, -z0 * sz);
    const path = (poly) => { g.beginPath(); g.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]); g.closePath(); };
    g.fillStyle = '#ff0000';
    for (const poly of waterPolys) { path(poly); g.fill(); }
    for (const poly of voidPolys) { path(poly); g.fill(); }
    g.fillStyle = '#000000';
    for (const poly of islands) { path(poly); g.fill(); }
    // parcs et places (additif sur V et B)
    g.globalCompositeOperation = 'lighter';
    for (const pl of worldData.plazas || []) { if (!pl.polygon || pl.polygon.length < 3) continue; g.fillStyle = '#0000ff'; path(pl.polygon); g.fill(); }
    for (const info of parkInfos) {
      const poly = info.park.polygon, { bb, area } = info;
      g.save(); path(poly); g.clip();
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#00ff00'; g.fillRect(bb.x0 - 5, bb.z0 - 5, bb.x1 - bb.x0 + 10, bb.z1 - bb.z0 + 10);
      // allées : pourtour + axes + trame pour les grands jardins (stabilisé = G+B)
      g.strokeStyle = '#00ffff'; g.lineJoin = 'round'; g.lineCap = 'round';
      const rnd = mulberry32((poly[0][0] * 31 + poly[0][1] * 17) | 0);
      g.lineWidth = area > 20000 ? 14 : 7; path(poly); g.stroke();
      if (area > 2500) {
        let best = 0, ang = 0;
        for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } }
        const cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2, R = Math.hypot(bb.x1 - bb.x0, bb.z1 - bb.z0);
        const ux = Math.cos(ang), uz = Math.sin(ang);
        const line = (ox, oz, dx, dz, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(cx + ox - dx * R, cz + oz - dz * R); g.lineTo(cx + ox + dx * R, cz + oz + dz * R); g.stroke(); };
        const main = area > 60000 ? 12 : 5;
        line(0, 0, ux, uz, main); line(0, 0, -uz, ux, main * 0.8);
        if (area > 30000) {
          const step = area > 150000 ? 90 : 60;
          for (let k = -6; k <= 6; k++) { if (!k) continue; line(-uz * k * step, ux * k * step, ux, uz, 4.5); line(ux * k * step * 1.4, uz * k * step * 1.4, -uz, ux, 4.5); }
          g.fillStyle = '#00ffff'; g.beginPath(); g.arc(cx, cz, 16 + rnd() * 8, 0, Math.PI * 2); g.fill();
        }
      }
      g.restore();
      g.globalCompositeOperation = 'lighter';
    }
    g.globalCompositeOperation = 'source-over';
    g.setTransform(1, 0, 0, 1, 0, 0);
    const img = g.getImageData(0, 0, S, S).data;
    const G = new Uint8Array(S * S), B = new Uint8Array(S * S);
    for (let i = 0, j = 0; i < S * S; i++, j += 4) { G[i] = img[j + 1]; B[i] = img[j + 2]; }
    const tex = new THREE.CanvasTexture(cv);
    tex.flipY = false; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.NoColorSpace; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const at = (arr, x, z) => {
      let px = ((x - x0) * sx) | 0, pz = ((z - z0) * sz) | 0;
      if (px < 0) px = 0; else if (px >= S) px = S - 1; if (pz < 0) pz = 0; else if (pz >= S) pz = S - 1;
      return arr[pz * S + px];
    };
    return {
      ...common, texture: tex, rect: new THREE.Vector4(x0, z0, 1 / sizeX, 1 / sizeZ), size: S, texel: sizeX / S,
      isGrass: (x, z) => at(G, x, z) > 128 && at(B, x, z) < 128,
      isPark: (x, z) => at(G, x, z) > 128,
      isPlaza: (x, z) => at(B, x, z) > 128 && at(G, x, z) < 128,
      classAt: (x, z) => (at(G, x, z) > 128 ? (at(B, x, z) > 128 ? C_GRAVEL : C_GRASS) : at(B, x, z) > 128 ? C_PAVE : C_BASE),
      fineFor: () => null, areasNear: () => [],
    };
  }

  // =====================================================================================================
  // mode 'classes'
  const S = cfg.coarse || 2048, sx = S / sizeX, sz = S / sizeZ;
  // classe d'un polygone de sol : celle de sa nature, sauf avis du profil de la ville (nombre = classe imposée, < 0 = ignoré)
  const areaClass = (kind, cx, cz, a) => { const c = profile.areaClass ? profile.areaClass(kind, cx, cz, a) : undefined; return c === undefined ? KIND_CLASS[kind] : c; };
  // polygones de sol classés, dans l'ordre de peinture (les derniers recouvrent les premiers)
  const items = []; // { poly, cls, prio, bb }
  for (const a of worldData.pois?.areas || []) {
    const poly = a?.polygon; if (!poly || poly.length < 3) continue;
    const bb = polyBBox(poly), cls = areaClass(a.kind, (bb.x0 + bb.x1) / 2, (bb.z0 + bb.z1) / 2, a);
    if (cls === undefined || cls === null || cls < 0) continue;
    items.push({ poly, cls, prio: KIND_PRIO[a.kind] ?? 4, bb, kind: a.kind });
  }
  for (const info of parkInfos) items.push({ poly: info.park.polygon, cls: C_GRASS, prio: 4.5, bb: info.bb, kind: 'park' });
  for (const pl of worldData.plazas || []) { if (!pl.polygon || pl.polygon.length < 3) continue; items.push({ poly: pl.polygon, cls: C_PAVE, prio: 12.5, bb: polyBBox(pl.polygon), kind: 'plaza' }); }
  items.sort((a, b) => a.prio - b.prio);
  // allées des parcs (pois.paths footway) : rubans de stabilisé peints par-dessus les pelouses, à haute résolution seulement
  const pathLines = [];
  for (const p of worldData.pois?.paths || []) { if (!p || p.kind !== 'footway' || p.riverbank || !Array.isArray(p.points) || p.points.length < 2) continue; pathLines.push(p); }
  // rangement par tuile (boîte englobante)
  const byTile = new Map(), pathsByTile = new Map(), waterByTile = new Map(), voidByTile = new Map(), islandByTile = new Map();
  const bucket = (map, bb, v) => {
    for (let ix = Math.floor(bb.x0 / TILE); ix <= Math.floor(bb.x1 / TILE); ix++) for (let iz = Math.floor(bb.z0 / TILE); iz <= Math.floor(bb.z1 / TILE); iz++) {
      const k = (ix + 512) * 1024 + iz + 512; let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(v);
    }
  };
  items.forEach((it, i) => bucket(byTile, it.bb, i));
  pathLines.forEach((p) => { let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity; for (const q of p.points) { if (q[0] < bx0) bx0 = q[0]; if (q[0] > bx1) bx1 = q[0]; if (q[1] < bz0) bz0 = q[1]; if (q[1] > bz1) bz1 = q[1]; } bucket(pathsByTile, { x0: bx0 - 3, x1: bx1 + 3, z0: bz0 - 3, z1: bz1 + 3 }, p); });
  for (const p of waterPolys) bucket(waterByTile, polyBBox(p), p);
  for (const p of voidPolys) bucket(voidByTile, polyBBox(p), p);
  for (const p of islands) bucket(islandByTile, polyBBox(p), p);

  const px = new Float64Array(8192);
  /** Rastérise une liste de polygones dans buf (S×S) avec la transformation monde → pixel donnée. */
  const raster = (buf, SS, poly, ox, oz, kx, kz, value) => {
    const n = Math.min(poly.length, 4096);
    for (let i = 0; i < n; i++) { px[i * 2] = (poly[i][0] - ox) * kx; px[i * 2 + 1] = (poly[i][1] - oz) * kz; }
    fillPoly(buf, SS, px, n, value);
  };
  const quad = [[0, 0], [0, 0], [0, 0], [0, 0]];
  const rasterLine = (buf, SS, pts, w, ox, oz, kx, kz, value) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1]; let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz); if (l < 0.01) continue; dx /= l; dz /= l;
      const nx = -dz * w / 2, nz = dx * w / 2, e = w * 0.3;
      quad[0][0] = a[0] - dx * e + nx; quad[0][1] = a[1] - dz * e + nz; quad[1][0] = b[0] + dx * e + nx; quad[1][1] = b[1] + dz * e + nz;
      quad[2][0] = b[0] + dx * e - nx; quad[2][1] = b[1] + dz * e - nz; quad[3][0] = a[0] - dx * e - nx; quad[3][1] = a[1] - dz * e - nz;
      raster(buf, SS, quad, ox, oz, kx, kz, value);
    }
  };

  // --- carte grossière de toute la ville : classes + routes vues de loin + évidements
  const cls = new Uint8Array(S * S), vd = new Uint8Array(S * S);
  for (const it of items) raster(cls, S, it.poly, x0, z0, sx, sz, it.cls);
  const texelC = sizeX / S;
  for (const r of worldData.roads || []) { if (!r.points || r.points.length < 2 || r.tunnel) continue; const w = Math.max(r.width || 6, texelC * 1.1); if ((r.width || 6) < 5 && r.kind !== 'pedestrian') continue; rasterLine(cls, S, r.points, w, x0, z0, sx, sz, r.kind === 'pedestrian' ? C_PAVE : C_ROADFAR); }
  for (const p of waterPolys) raster(vd, S, p, x0, z0, sx, sz, 255);
  for (const p of voidPolys) raster(vd, S, p, x0, z0, sx, sz, 255);
  for (const p of islands) raster(vd, S, p, x0, z0, sx, sz, 0);
  const pack = (c, v, SS) => { const d = new Uint8Array(SS * SS * 4); for (let i = 0, j = 0; i < SS * SS; i++, j += 4) { d[j] = v[i]; d[j + 1] = c[i]; d[j + 3] = 255; } return d; };
  const mkTex = (data, SS) => {
    const t = new THREE.DataTexture(data, SS, SS, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = false;
    t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return t;
  };
  const texture = mkTex(pack(cls, vd, S), S);
  const classAt = (x, z) => {
    let ix = ((x - x0) * sx) | 0, iz = ((z - z0) * sz) | 0;
    if (ix < 0) ix = 0; else if (ix >= S) ix = S - 1; if (iz < 0) iz = 0; else if (iz >= S) iz = S - 1;
    return cls[iz * S + ix];
  };

  // --- cartes fines par tuile (à la demande) : 1 texel de marge de chaque côté pour un raccord sans couture
  const F = cfg.fine || 256, FS = F * 2;
  const fc = new Uint8Array(F * F), fv2 = new Uint8Array(FS * FS), fv = new Uint8Array(F * F);
  function fineFor(ix, iz) {
    const key = (ix + 512) * 1024 + iz + 512;
    const tl = TILE / (F - 2), ox = ix * TILE - tl, oz = iz * TILE - tl, span = TILE + 2 * tl, k = F / span;
    fc.fill(0); fv2.fill(0);
    // classes : on part de la carte grossière (continuité avec le lointain), puis on repeint les polygones de la tuile
    const ids = byTile.get(key);
    if (ids) for (const i of ids) raster(fc, F, items[i].poly, ox, oz, k, k, items[i].cls);
    const pl = pathsByTile.get(key);
    if (pl) for (const p of pl) rasterLine(fc, F, p.points, Math.max(2.2, Math.min(6, p.width || 3)), ox, oz, k, k, C_GRAVEL);
    // évidements (sur-échantillonnés ×2 puis moyennés : bord lissé)
    const k2 = FS / span;
    const wl = waterByTile.get(key), vl = voidByTile.get(key), il = islandByTile.get(key);
    let anyVoid = false;
    if (wl) { anyVoid = true; for (const p of wl) raster(fv2, FS, p, ox, oz, k2, k2, 255); }
    if (vl) { anyVoid = true; for (const p of vl) raster(fv2, FS, p, ox, oz, k2, k2, 255); }
    if (il && anyVoid) for (const p of il) raster(fv2, FS, p, ox, oz, k2, k2, 0);
    if (anyVoid) { for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) { const o = (y * 2) * FS + x * 2; fv[y * F + x] = (fv2[o] + fv2[o + 1] + fv2[o + FS] + fv2[o + FS + 1]) >> 2; } } else fv.fill(0);
    return { texture: mkTex(pack(fc, fv, F), F), rect: new THREE.Vector4(ox, oz, 1 / span, 1 / span), size: F };
  }
  const GREEN = new Uint8Array(16); for (const c of [1, 4, 5, 7, 12]) GREEN[c] = 1;
  return {
    ...common, texture, rect: new THREE.Vector4(x0, z0, 1 / sizeX, 1 / sizeZ), size: S, texel: 1.2,
    classAt,
    isGrass: (x, z) => { const c = classAt(x, z); return c === C_GRASS || c === C_FOREST || c === C_GARDEN; },
    isPark: (x, z) => GREEN[classAt(x, z)] === 1,
    isPlaza: (x, z) => classAt(x, z) === C_PAVE,
    fineFor,
    /** Polygones de sol classés touchant la tuile : [{ poly, cls, bb, kind }] (arbres des bois, haies, parkings…). */
    areasNear(ix, iz) { const ids = byTile.get((ix + 512) * 1024 + iz + 512); return ids ? ids.map((i) => items[i]) : []; },
  };
}

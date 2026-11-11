// Masque du sol : une texture (canvas) couvrant la carte, R = Seine, G = parc, B = minéral
// (G seul = pelouse, G+B = allée stabilisée, B seul = place pavée). Sert au shader du sol (découpe de la
// Seine, pelouses, places) ET aux requêtes CPU (estDansLEau, estPelouse...).
import { polyBBox, polyArea, mulberry32 } from './util.js';

export function createMasks(ctx, Q) {
  const { THREE, BOUNDS, worldData } = ctx;
  const MARGIN = 700;
  const x0 = BOUNDS.minX - MARGIN, z0 = BOUNDS.minZ - MARGIN;
  const sizeX = BOUNDS.maxX - BOUNDS.minX + 2 * MARGIN, sizeZ = BOUNDS.maxZ - BOUNDS.minZ + 2 * MARGIN;
  const S = Q.maskSize;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const sx = S / sizeX, sz = S / sizeZ;
  g.setTransform(sx, 0, 0, sz, -x0 * sx, -z0 * sz);
  const path = (poly) => { g.beginPath(); g.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]); g.closePath(); };

  const river = worldData.river || {};
  const riverPolys = river.polygons || [];
  const islands = (river.islands || []).map((i) => i.polygon || i).filter((p) => p && p.length >= 3);

  // --- Seine (rouge). Les bords coupés à la limite des données sont prolongés vers l'extérieur.
  const CLIP = 140;
  const outside = (p) => (p[0] < BOUNDS.minX - CLIP ? 1 : 0) | (p[0] > BOUNDS.maxX + CLIP ? 2 : 0) | (p[1] < BOUNDS.minZ - CLIP ? 4 : 0) | (p[1] > BOUNDS.maxZ + CLIP ? 8 : 0);
  g.fillStyle = '#ff0000'; g.strokeStyle = '#ff0000';
  for (const poly of riverPolys) {
    path(poly); g.fill();
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const m = outside(a) & outside(b);
      if (!m) continue;
      const ex = (m & 1 ? -1 : m & 2 ? 1 : 0) * 1500, ez = (m & 4 ? -1 : m & 8 ? 1 : 0) * 1500;
      // élargit un peu vers l'extérieur pour suivre la direction du fleuve
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(b[0] + ex, b[1] + ez); g.lineTo(a[0] + ex, a[1] + ez); g.closePath(); g.fill();
    }
  }
  g.fillStyle = '#000000';
  for (const poly of islands) { path(poly); g.fill(); }

  // --- Parcs et places (additif sur V et B)
  g.globalCompositeOperation = 'lighter';
  for (const pl of worldData.plazas || []) {
    if (!pl.polygon || pl.polygon.length < 3) continue;
    g.fillStyle = '#0000ff'; path(pl.polygon); g.fill();
  }
  const parkInfos = [];
  for (const pk of worldData.parks || []) {
    const poly = pk.polygon; if (!poly || poly.length < 3) continue;
    const bb = polyBBox(poly), area = Math.abs(polyArea(poly));
    parkInfos.push({ park: pk, bb, area });
    g.save(); path(poly); g.clip();
    // le parc entier devient « pelouse » (G) — on efface d'abord B (place sous-jacente éventuelle)
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#00ff00'; g.fillRect(bb.x0 - 5, bb.z0 - 5, bb.x1 - bb.x0 + 10, bb.z1 - bb.z0 + 10);
    // allées : pourtour + axes + trame pour les grands jardins (stabilisé = G+B)
    g.strokeStyle = '#00ffff'; g.lineJoin = 'round'; g.lineCap = 'round';
    const rnd = mulberry32((poly[0][0] * 31 + poly[0][1] * 17) | 0);
    g.lineWidth = area > 20000 ? 14 : 7; path(poly); g.stroke();
    if (area > 2500) {
      // axe principal = plus long côté du polygone
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
        // rond-point central
        g.fillStyle = '#00ffff'; g.beginPath(); g.arc(cx, cz, 16 + rnd() * 8, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
    g.globalCompositeOperation = 'lighter';
  }
  g.globalCompositeOperation = 'source-over';
  g.setTransform(1, 0, 0, 1, 0, 0);

  const img = g.getImageData(0, 0, S, S).data;
  // copies compactes par canal pour les requêtes CPU
  const R = new Uint8Array(S * S), G = new Uint8Array(S * S), B = new Uint8Array(S * S);
  for (let i = 0, j = 0; i < S * S; i++, j += 4) { R[i] = img[j]; G[i] = img[j + 1]; B[i] = img[j + 2]; }

  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

  const at = (arr, x, z) => {
    let px = ((x - x0) * sx) | 0, pz = ((z - z0) * sz) | 0;
    if (px < 0) px = 0; else if (px >= S) px = S - 1; if (pz < 0) pz = 0; else if (pz >= S) pz = S - 1;
    return arr[pz * S + px];
  };
  return {
    texture: tex,
    rect: new THREE.Vector4(x0, z0, 1 / sizeX, 1 / sizeZ),
    x0, z0, sizeX, sizeZ, texel: sizeX / S,
    parkInfos, riverPolys, islands,
    isWater: (x, z) => at(R, x, z) > 110,
    /** eau à moins de `pad` mètres (échantillonnage en croix) */
    nearWater(x, z, pad) { return at(R, x, z) > 110 || at(R, x + pad, z) > 110 || at(R, x - pad, z) > 110 || at(R, x, z + pad) > 110 || at(R, x, z - pad) > 110; },
    isGrass: (x, z) => at(G, x, z) > 128 && at(B, x, z) < 128,
    isPark: (x, z) => at(G, x, z) > 128,
    isPlaza: (x, z) => at(B, x, z) > 128 && at(G, x, z) < 128,
  };
}

// Mobilier urbain : lampadaires parisiens instanciés (émissifs la nuit + flaques de lumière additives),
// feux tricolores, bancs, colonnes Morris, kiosques, bouches de métro (fusionnés par tuile).
import { baseHeightAt } from '@shared/terrain.js';
import { TILE, tileKeyI, hash2, bucketByTile } from './util.js';
import { createGlowTexture } from './textures.js';
import { Y_WALK } from './streets.js';

/** Petit constructeur de géométrie (boîtes, cylindres) avec couleur et « lueur » par sommet. */
export class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.g = []; this.ox = 0; this.oy = 0; this.oz = 0; this.cs = 1; this.sn = 0; }
  at(x, y, z, yaw = 0) { this.ox = x; this.oy = y; this.oz = z; this.cs = Math.cos(yaw); this.sn = Math.sin(yaw); return this; }
  _v(x, y, z, nx, ny, nz, col, glow) {
    const { cs, sn } = this;
    this.p.push(this.ox + x * cs + z * sn, this.oy + y, this.oz - x * sn + z * cs);
    this.n.push(nx * cs + nz * sn, ny, -nx * sn + nz * cs);
    this.c.push(col[0], col[1], col[2]); this.g.push(glow);
  }
  quad(a, b, c, d, col, glow = 0) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const q of [a, b, c, a, c, d]) this._v(q[0], q[1], q[2], nx, ny, nz, col, glow);
  }
  box(cx, cy, cz, sx, sy, sz, col, glow = 0, bottom = false) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, glow);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, glow);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, glow);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, glow);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col, glow);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, glow);
  }
  /** Tronc de cône d'axe Y (normales lissées). */
  cyl(cx, cz, y0, y1, r0, r1, seg, col, glow = 0, cap = false) {
    const sl = (r0 - r1) / (y1 - y0 || 1);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const P = [[cx + c0 * r0, y0, cz + s0 * r0, c0, s0], [cx + c1 * r0, y0, cz + s1 * r0, c1, s1], [cx + c1 * r1, y1, cz + s1 * r1, c1, s1], [cx + c0 * r1, y1, cz + s0 * r1, c0, s0]];
      for (const k of [0, 2, 1, 0, 3, 2]) { const q = P[k]; const l = Math.hypot(1, sl); this._v(q[0], q[1], q[2], q[3] / l, sl / l, q[4] / l, col, glow); }
      if (cap) for (const q of [[cx, y1, cz], [cx + c1 * r1, y1, cz + s1 * r1], [cx + c0 * r1, y1, cz + s0 * r1]]) this._v(q[0], q[1], q[2], 0, 1, 0, col, glow);
    }
  }
  build(THREE) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    const n = new Int8Array(this.n.length); for (let i = 0; i < n.length; i++) n[i] = this.n[i] * 127;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3, true));
    const c = new Uint8Array(this.c.length); for (let i = 0; i < c.length; i++) c[i] = Math.min(255, this.c[i] * 255);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3, true));
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Uint8Array(this.g), 1, false));
    g.computeBoundingSphere();
    return g;
  }
}

const IRON = [0.035, 0.05, 0.042], GREEN = [0.04, 0.115, 0.07], LAMP = [1.0, 0.78, 0.46];

function lampGeometry(THREE) {
  const g = new Geo();
  // socle + fût cannelé + bague + lanterne
  g.cyl(0, 0, 0, 0.55, 0.2, 0.15, 8, IRON);
  g.cyl(0, 0, 0.55, 0.7, 0.15, 0.09, 8, IRON);
  g.cyl(0, 0, 0.7, 4.3, 0.085, 0.055, 6, IRON);
  g.cyl(0, 0, 4.3, 4.42, 0.11, 0.11, 6, IRON);
  g.cyl(0, 0, 4.42, 4.62, 0.05, 0.16, 4, IRON);
  // lanterne (verre évasé à 4 pans) + chapeau
  g.cyl(0, 0, 4.62, 5.2, 0.17, 0.3, 4, LAMP, 1);
  g.cyl(0, 0, 5.2, 5.26, 0.36, 0.34, 4, IRON);
  g.cyl(0, 0, 5.26, 5.5, 0.32, 0.06, 4, IRON, 0, true);
  g.cyl(0, 0, 5.5, 5.68, 0.035, 0.02, 4, IRON, 0, true);
  return g.build(THREE);
}

export function createPropMaterial(THREE, uniforms) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLampOn = uniforms.uLampOn; sh.uniforms.uSig = uniforms.uSig || (uniforms.uSig = { value: 1 });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uLampOn;\nuniform float uSig;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float gl = vGlow > 1.5 ? 1.6 * uSig : (vGlow > 0.5 ? uLampOn * 3.2 : 0.0);
totalEmissiveRadiance += vColor.rgb * gl;
if (vGlow > 0.5 && vGlow < 1.5) diffuseColor.rgb = mix(vec3(0.75, 0.74, 0.7), diffuseColor.rgb, uLampOn);`);
  };
  mat.customProgramCacheKey = () => 'mz-props2';
  return mat;
}

/**
 * Mobilier urbain diffusé par tuile : lampadaires instanciés (+ flaques et halos nocturnes), feux tricolores, bancs,
 * colonnes Morris, kiosques, bouches de métro (fusionnés), et emplacements des plaques de rue. Positions déterministes
 * (fixées par l'abscisse le long des voies), identiques d'un chargement de tuile à l'autre.
 */
export function createProps(ctx, net, masks, river, bld, Q, uniforms, profile) {
  const { THREE, scene, LANDMARKS } = ctx;
  const mat = createPropMaterial(THREE, uniforms);
  const o = { _k: 0 };
  const F = profile.furniture || {};
  const nearLandmark = (x, z, pad = 0) => { for (const l of LANDMARKS) if ((x - l.x) ** 2 + (z - l.z) ** 2 < (l.radius + pad) ** 2) return true; return false; };
  const free = (x, z, pad = 0.6) => !bld.inBuilding(x, z, pad) && !nearLandmark(x, z) && !(masks.isWater(x, z) && !river.nearDeck(x, z, 0));
  const yw = (x, z) => baseHeightAt(x, z) + Y_WALK;

  const lampGeo = lampGeometry(THREE);
  const glowTex = createGlowTexture(THREE);
  const poolGeo = new THREE.PlaneGeometry(22, 22); poolGeo.rotateX(-Math.PI / 2); poolGeo.translate(0, 0.07, 0);
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffc080, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
  const haloGeo = new THREE.PlaneGeometry(2.6, 2.6); haloGeo.translate(0, 4.95, 0);
  // halo « billboard » : orienté face caméra dans le vertex shader
  const haloMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffc27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  haloMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 4.95, 0.0, 1.0);
mvPosition.xy += position.xy - vec2(0.0, 4.95);
gl_Position = projectionMatrix * mvPosition;`);
  };
  const dummy = new THREE.Object3D();

  // ---------- rangements par tuile faits une fois : lampadaires de berge, stations de métro, plaques (atlas des noms)
  const bl = river?.bergeLamps || [], blTiles = bucketByTile(Math.floor(bl.length / 3), (i, p) => { p[0] = bl[i * 3]; p[1] = bl[i * 3 + 2]; });
  const poiMetros = (Array.isArray(ctx.worldData.pois?.pois) ? ctx.worldData.pois.pois : []).filter((p) => p && p.kind === 'metro' && Number.isFinite(p.x) && Number.isFinite(p.z));
  // sans données de stations : grands carrefours espacés (calcul global, bon marché)
  let metroSites = poiMetros.map((p) => ({ x: p.x, z: p.z, hw: 0, real: true }));
  if (poiMetros.length < 5) { metroSites = []; for (const j of net.junctions) { if (j.maxHw < 4.7 || j.ped || Math.abs(j.e) > 0.3) continue; if (metroSites.some((m) => (m.x - j.p[0]) ** 2 + (m.z - j.p[1]) ** 2 < 380 * 380)) continue; metroSites.push({ x: j.p[0], z: j.p[1], hw: j.maxHw, real: false }); } }
  const metroTiles = bucketByTile(metroSites.length, (i, p) => { p[0] = metroSites[i].x; p[1] = metroSites[i].z; });

  // mobilier : gabarits
  const bench = (g) => {
    g.box(0, 0.44, 0, 1.9, 0.06, 0.42, GREEN); g.box(0, 0.78, 0.2, 1.9, 0.34, 0.05, GREEN);
    for (const sx of [-0.8, 0.8]) { g.box(sx, 0.22, 0, 0.07, 0.44, 0.4, IRON); g.box(sx, 0.62, 0.21, 0.06, 0.4, 0.06, IRON); }
  };
  const morris = (g, seed) => {
    g.cyl(0, 0, 0, 0.35, 0.72, 0.68, 12, GREEN);
    const hue = [[0.75, 0.16, 0.12], [0.9, 0.75, 0.3], [0.14, 0.3, 0.6], [0.85, 0.82, 0.74], [0.1, 0.45, 0.4]];
    for (let i = 0; i < 12; i++) { // affiches (pans colorés)
      const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2, R = 0.64, col = hue[(seed + (i >> 1) * 3) % hue.length];
      g.quad([Math.cos(a1) * R, 0.35, Math.sin(a1) * R], [Math.cos(a0) * R, 0.35, Math.sin(a0) * R], [Math.cos(a0) * R, 3.0, Math.sin(a0) * R], [Math.cos(a1) * R, 3.0, Math.sin(a1) * R], col);
    }
    g.cyl(0, 0, 3.0, 3.25, 0.74, 0.86, 12, GREEN); g.cyl(0, 0, 3.25, 3.4, 0.9, 0.82, 12, GREEN);
    g.cyl(0, 0, 3.4, 4.0, 0.8, 0.3, 12, GREEN); g.cyl(0, 0, 4.0, 4.5, 0.1, 0.03, 6, GREEN, 0, true);
  };
  const kiosk = (g) => {
    g.box(0, 1.25, 0, 2.6, 2.5, 2.0, GREEN);
    g.box(0, 1.5, -1.02, 2.2, 1.3, 0.05, [0.8, 0.72, 0.5], 0); // étal de journaux
    for (let i = 0; i < 5; i++) g.box(-0.85 + i * 0.42, 1.5 + ((i * 7) % 3) * 0.2 - 0.2, -1.06, 0.34, 0.42, 0.03, [[0.8, 0.2, 0.15], [0.9, 0.9, 0.85], [0.2, 0.35, 0.7], [0.95, 0.8, 0.2], [0.15, 0.5, 0.3]][i]);
    g.box(0, 2.62, 0, 3.1, 0.14, 2.5, GREEN);
    g.cyl(0, 0, 2.69, 3.5, 1.5, 0.25, 8, [0.06, 0.15, 0.1], 0, true);
    g.cyl(0, 0, 3.5, 3.9, 0.08, 0.02, 6, GREEN, 0, true);
  };
  /** Bouche de métro : entourage Guimard (Paris) ou trémie sobre à totem « M » (Toulouse et autres). */
  const metro = (g, totem) => {
    g.quad([-1.4, 0.03, 2.6], [1.4, 0.03, 2.6], [1.4, 0.03, -2.6], [-1.4, 0.03, -2.6], [0.01, 0.01, 0.012]); // trémie
    for (let k = 0; k < 6; k++) g.box(0, 0.012, -2.2 + k * 0.5, 2.7, 0.02, 0.3, [0.2, 0.2, 0.2].map((v) => v * (1 - k * 0.14)));
    const RAIL = totem ? [0.32, 0.34, 0.36] : GREEN;
    for (const sx of [-1.45, 1.45]) { g.box(sx, 0.55, 0, 0.08, 1.0, 5.3, RAIL); g.box(sx, 1.08, 0, 0.14, 0.07, 5.4, RAIL); }
    g.box(0, 0.55, 2.65, 2.98, 1.0, 0.08, RAIL); g.box(0, 1.08, 2.65, 3.0, 0.07, 0.14, RAIL);
    if (totem) { // mât et disque lumineux « M »
      g.cyl(1.7, -3.0, 0, 3.6, 0.08, 0.07, 8, [0.5, 0.52, 0.55]);
      g.box(1.7, 4.0, -3.0, 0.9, 0.9, 0.12, [0.85, 0.1, 0.12], 2);
      g.box(1.7, 4.0, -3.07, 0.5, 0.5, 0.02, [1, 1, 1], 2); g.box(1.7, 4.0, -2.93, 0.5, 0.5, 0.02, [1, 1, 1], 2);
    } else {
      for (const sx of [-1.45, 1.45]) { g.cyl(sx, -2.7, 0, 3.4, 0.07, 0.05, 6, GREEN); g.cyl(sx, -2.7, 3.4, 3.75, 0.1, 0.16, 6, [1.0, 0.45, 0.2], 2, true); }
      g.box(0, 3.0, -2.7, 2.9, 0.5, 0.07, [0.95, 0.8, 0.25], 2);
      g.box(0, 3.0, -2.7, 2.5, 0.3, 0.09, GREEN);
    }
  };

  const loaded = new Map();
  /** Générateur : mobilier de la tuile (ix, iz). */
  function* buildTile(ix, iz) {
    const key = tileKeyI(ix, iz), col = [];
    const L = []; // lampadaires : x, y, z, yaw
    L.mesh = null;
    const addLamp = (x, y, z, yaw) => { L.push(x, y, z, yaw); col.push({ kind: 'circle', x, z, r: 0.2, bottom: y - 1, top: y + 5, tag: 'lamp', data: { type: 'lamp', tile: L, i: L.length / 4 - 1, x, z, y, tileRef: null } }); };
    const g = new Geo(); g.mesh = null;
    const pd = (type, v0, x, z) => ({ type, geo: g, v0, v1: g.p.length / 3, x, z, y: g.oy, tileRef: null });
    const plaques = [];
    let steps = 0, nProps = 0;
    for (const [ri, sA, sB] of net.tilePieces.get(key) || []) {
      const r = net.roads[ri];
      if ((++steps & 3) === 0) yield;
      if (r.tunnel || r._mw) continue;
      const hw = r._hw, own = (s) => s >= sA && s < sB;
      // ---------- lampadaires
      if (!(r._ped && r._len < 40)) {
        const both = r._sw >= 4, off = r._ped ? Math.max(0.5, hw - 0.7) : hw + 0.6;
        const step = r._ped ? Q.lampStep * 1.3 : both ? Q.lampStep * 1.15 : Q.lampStep;
        let side = hash2(ri, 5) < 0.5 ? 1 : -1;
        for (const [s0, s1] of net.freeRuns(r)) {
          const a = s0 + 3.5, b = s1 - 3.5; if (b - a < 4) continue;
          const n = Math.max(1, Math.round((b - a) / step));
          for (let i = 0; i < n; i++, side = -side) {
            const s = a + ((b - a) * (i + 0.5)) / n; if (!own(s)) continue;
            for (const sg of both ? [1, -1] : [side]) {
              net.pointAt(r, s, sg * off, o);
              if (Math.abs(o.e) > 0.3 && r._sw <= 0) continue;
              if (!free(o.x, o.z, 0.3) || (!r._ped && net.edgeDistance(o.x, o.z, false, o.e) < 0.4) || net.inZone(o.x, o.z, 1)) continue;
              const e = o.e, lx = o.x, lz = o.z, yaw = Math.atan2(o.dx, o.dz) + (hash2(ri * 3 + i, sg) < 0.5 ? 0 : Math.PI / 4);
              net.pointAt(r, s, 0, o);
              addLamp(lx, net.deckY(lx, lz, o.x, o.z, e) + (r._ped ? 0.01 : Y_WALK), lz, yaw);
            }
          }
        }
      }
      // ---------- feux tricolores aux passages piétons des grands carrefours
      for (const f of net.runsInfo(r)) {
        const sites = [];
        if (f.lightB && own(f.s1 - 5.5)) { net.pointAt(r, f.s1 - 5.5, -(hw + 0.6), o); sites.push([o.x, o.z, Math.atan2(o.dx, o.dz), o.e]); }
        if (f.lightA && own(f.s0 + 5.5)) { net.pointAt(r, f.s0 + 5.5, hw + 0.6, o); sites.push([o.x, o.z, Math.atan2(-o.dx, -o.dz), o.e]); }
        for (const [x, z, yaw, e] of sites) {
          if (!free(x, z, 0.2) || net.edgeDistance(x, z, false, e) < 0.35 || net.inZone(x, z, 1)) continue;
          const y = yw(x, z) + e, v0 = g.p.length / 3, green = hash2(Math.round(x * 3), Math.round(z * 3)) < 0.5;
          g.at(x, y, z, yaw);
          g.cyl(0, 0, 0, 2.6, 0.06, 0.05, 6, IRON);
          g.box(0, 3.05, 0, 0.3, 0.95, 0.26, [0.02, 0.022, 0.02]);
          g.box(0, 3.35, -0.14, 0.17, 0.17, 0.03, green ? [0.12, 0.01, 0.01] : [1, 0.08, 0.05], green ? 0 : 2);
          g.box(0, 3.05, -0.14, 0.17, 0.17, 0.03, [0.14, 0.08, 0.0], 0);
          g.box(0, 2.75, -0.14, 0.17, 0.17, 0.03, green ? [0.1, 1, 0.35] : [0.01, 0.1, 0.03], green ? 2 : 0);
          g.box(0, 1.5, -0.1, 0.16, 0.3, 0.08, [0.02, 0.022, 0.02]); // répétiteur piéton
          col.push({ kind: 'circle', x, z, r: 0.12, bottom: y - 1, top: y + 3.5, tag: 'feu', data: pd('feu', v0, x, z) });
          nProps++;
        }
        // ---------- plaques de rue : sur le premier mur rencontré de chaque côté, aux extrémités des tronçons
        if (f.s1 - f.s0 >= 14 && r.name) for (const [s, endOK] of [[f.s0 + 5, true], [f.s1 - 5, true]]) {
          if (!endOK || !own(s)) continue;
          for (const sg of [1, -1]) {
            net.pointAt(r, s, sg * (hw + Math.max(0.6, r._sw - 0.6)), o);
            if (Math.abs(o.e) > 0.3) continue;
            const nx = sg * o.dz, nz = -sg * o.dx; let x = o.x, z = o.z, hit = false;
            for (let t = 0; t < 16; t += 0.25) { if (bld.inBuilding(x + nx * 0.25, z + nz * 0.25, 0)) { hit = true; break; } x += nx * 0.25; z += nz * 0.25; }
            if (!hit || net.edgeDistance(x, z, true) < 0.3) continue;
            plaques.push(x - nx * 0.05, baseHeightAt(x, z) + 3.25, z - nz * 0.05, Math.atan2(-nx, -nz), ri);
          }
        }
      }
      // ---------- le long des larges trottoirs : bancs, colonnes Morris, kiosques
      if (r._sw >= 4 && r._len >= 60) for (const [s0, s1] of net.freeRuns(r)) {
        for (let k = 0, s = s0 + 14 + hash2(ri, 21) * 30; s < s1 - 14; k++, s += 45 + hash2(ri * 5 + k, 23) * 50) {
          if (!own(s)) continue;
          const sg = hash2(ri * 7 + k, 29) < 0.5 ? 1 : -1, pick = hash2(ri * 11 + k, 31);
          net.pointAt(r, s, sg * (hw + r._sw - 1.3), o);
          if (Math.abs(o.e) > 0.3 || !free(o.x, o.z, 1.4) || net.edgeDistance(o.x, o.z) < 1.2 || net.inZone(o.x, o.z, 2)) continue;
          const y = yw(o.x, o.z), v0 = g.p.length / 3;
          g.at(o.x, y, o.z, Math.atan2(sg * o.dz, -sg * o.dx)); // face vers la chaussée
          if (pick < 0.62 || (!F.morris && !F.kiosk)) { bench(g); col.push({ kind: 'circle', x: o.x, z: o.z, r: 0.7, bottom: y - 1, top: y + 1, tag: 'banc', data: pd('banc', v0, o.x, o.z) }); }
          else if (pick < 0.9 || !F.kiosk || r._sw < 5) { if (!F.morris) continue; morris(g, (pick * 50) | 0); col.push({ kind: 'circle', x: o.x, z: o.z, r: 0.85, bottom: y - 1, top: y + 4.5, tag: 'morris', data: pd('morris', v0, o.x, o.z) }); }
          else { kiosk(g); col.push({ kind: 'circle', x: o.x, z: o.z, r: 1.6, bottom: y - 1, top: y + 3.5, tag: 'kiosque', data: pd('kiosque', v0, o.x, o.z) }); }
          nProps++;
        }
      }
    }
    yield;
    // ---------- lampadaires des berges basses (positions fournies par river.js, au niveau de la promenade)
    const rb = blTiles.range(ix, iz);
    if (rb) for (let k = rb[0]; k < rb[1]; k++) { const i = blTiles.items[k]; addLamp(bl[i * 3], bl[i * 3 + 1], bl[i * 3 + 2], 0); }
    // ---------- bouches de métro
    const rm = metroTiles.range(ix, iz);
    if (rm) for (let k = rm[0]; k < rm[1]; k++) {
      const j = metroSites[metroTiles.items[k]], x = j.x, z = j.z;
      for (let t = 0; t < (j.real ? 28 : 10); t++) {
        const a = hash2(k * 13 + t, 41) * Math.PI * 2, R = j.real ? 2 + t * 1.1 : j.hw + 9 + hash2(k * 17 + t, 43) * 8, px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
        if (net.edgeDistance(px, pz) < (j.real ? 2.4 : 3.6) || !free(px, pz, j.real ? 2.6 : 3.5) || masks.isWater(px, pz) || (!j.real && masks.isPark(px, pz))) continue;
        const yaw = hash2(k, 47) * Math.PI, y = yw(px, pz) - 0.1;
        g.at(px, y, pz, yaw); metro(g, F.metro === 'totem');
        col.push({ kind: 'box', x: px, z: pz, hw: 1.6, hd: 2.8, rot: yaw, bottom: y - 1, top: y + 1.2, tag: 'metro', data: { type: 'metro' } });
        nProps++;
        break;
      }
    }
    yield;
    const nL = L.length / 4;
    const t = { key, ix, iz, col, lamps: null, pool: null, halo: null, sphere: null, props: null, plaques: plaques.length ? new Float32Array(plaques) : null, nLamps: nL, nProps, shapes: null, L, g };
    if (nL) {
      const m = new THREE.InstancedMesh(lampGeo, mat, nL);
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < nL; i++) { dummy.position.set(L[i * 4], L[i * 4 + 1], L[i * 4 + 2]); dummy.rotation.set(0, L[i * 4 + 3], 0); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); cx += L[i * 4]; cy += L[i * 4 + 1]; cz += L[i * 4 + 2]; }
      cx /= nL; cy /= nL; cz /= nL; let r2 = 0;
      for (let i = 0; i < nL; i++) r2 = Math.max(r2, (L[i * 4] - cx) ** 2 + (L[i * 4 + 1] - cy) ** 2 + (L[i * 4 + 2] - cz) ** 2);
      const sphere = new THREE.Sphere(new THREE.Vector3(cx, cy + 3, cz), Math.sqrt(r2) + 10);
      m.boundingSphere = sphere; m.castShadow = Q.shadows; m.receiveShadow = false; m.matrixAutoUpdate = false; m.name = 'lampadaires';
      scene.add(m); L.mesh = m; t.lamps = m; t.sphere = sphere;
      const mk = (geo, material) => { const p = new THREE.InstancedMesh(geo, material, nL); p.instanceMatrix = m.instanceMatrix; p.boundingSphere = sphere; p.matrixAutoUpdate = false; p.visible = false; p.renderOrder = 3; p.name = 'lumiere-lampadaire'; scene.add(p); return p; };
      t.pool = mk(poolGeo, poolMat); t.halo = mk(haloGeo, haloMat);
    }
    const geo = g.build(THREE);
    if (geo) { const m = new THREE.Mesh(geo, mat); m.castShadow = Q.shadows; m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'mobilier'; scene.add(m); g.mesh = m; t.props = m; }
    for (const c of col) if (c.data) c.data.tileRef = t;
    loaded.set(key, t);
    plaqueDirty = true;
    return t;
  }

  // ---------- plaques de rue : atlas des noms (voies les plus longues) + un seul maillage instancié pour les plaques proches
  let plaqueDirty = true, plaque = null;
  if (Q.texSize >= 512) {
    const len = new Map();
    for (const r of net.roads) { const nm = (r.name || '').trim(); if (nm && nm.length <= 34) len.set(nm, (len.get(nm) || 0) + r._len); }
    const COLS = Q.maskSize >= 4096 ? 16 : 8, ROWS = 32, CW = 256, CH = 64;
    const names = [...len.entries()].sort((a, b) => b[1] - a[1]).slice(0, COLS * ROWS).map((e) => e[0]);
    if (names.length) {
      const cv = document.createElement('canvas'); cv.width = COLS * CW; cv.height = ROWS * CH;
      const g2 = cv.getContext('2d'); g2.textAlign = 'center'; g2.textBaseline = 'middle';
      const P = profile.plaque || { bg: '#1d3f8c', border: '#2f6b4c', line: '#e9eef5', fg: '#f4f6fa' };
      const cellOf = new Map();
      names.forEach((name, i) => {
        const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
        cellOf.set(name, [i % COLS, ROWS - 1 - Math.floor(i / COLS)]);
        g2.fillStyle = P.border; g2.fillRect(cx, cy, CW, CH);
        g2.fillStyle = P.line; g2.fillRect(cx + 5, cy + 5, CW - 10, CH - 10);
        g2.fillStyle = P.bg; g2.fillRect(cx + 7, cy + 7, CW - 14, CH - 14);
        const sp = name.indexOf(' '), kind = sp > 0 ? name.slice(0, sp).toUpperCase() : '', rest = (sp > 0 ? name.slice(sp + 1) : name).toUpperCase();
        g2.fillStyle = P.fg;
        g2.font = '600 13px Helvetica, Arial, sans-serif'; g2.fillText(kind, cx + CW / 2, cy + 19);
        let fs = 24; g2.font = `700 ${fs}px Helvetica, Arial, sans-serif`;
        while (fs > 11 && g2.measureText(rest).width > CW - 26) { fs--; g2.font = `700 ${fs}px Helvetica, Arial, sans-serif`; }
        g2.fillText(rest, cx + CW / 2, cy + 41);
      });
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(Q.aniso, ctx.renderer.capabilities.getMaxAnisotropy()); tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
      const CAP = 600, geo = new THREE.PlaneGeometry(0.92, 0.46);
      const cells = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 2), 2); cells.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aCell', cells);
      const pm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.1 });
      pm.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
          .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = (uv + aCell) * vec2(${(1 / COLS).toFixed(6)}, ${(1 / ROWS).toFixed(6)});`);
      };
      pm.customProgramCacheKey = () => 'mz-plaques' + COLS;
      const mesh = new THREE.InstancedMesh(geo, pm, CAP);
      mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.receiveShadow = true; mesh.name = 'plaques-de-rue'; mesh.visible = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      let lx = Infinity, lz = Infinity;
      plaque = {
        mesh, names: names.length, count: 0,
        update(cam) {
          if (!plaqueDirty && Math.abs(cam.x - lx) + Math.abs(cam.z - lz) < 12) return;
          lx = cam.x; lz = cam.z; plaqueDirty = false;
          const R = 140; let k = 0;
          for (let ix = Math.floor((cam.x - R) / TILE); ix <= Math.floor((cam.x + R) / TILE); ix++) for (let iz = Math.floor((cam.z - R) / TILE); iz <= Math.floor((cam.z + R) / TILE); iz++) {
            const t = loaded.get(tileKeyI(ix, iz)); if (!t || !t.plaques) continue;
            for (let i = 0; i < t.plaques.length && k < CAP; i += 5) {
              const p = t.plaques; if ((p[i] - cam.x) ** 2 + (p[i + 2] - cam.z) ** 2 > R * R) continue;
              const cell = cellOf.get((net.roads[p[i + 4]].name || '').trim()); if (!cell) continue;
              dummy.position.set(p[i], p[i + 1], p[i + 2]); dummy.rotation.set(0, p[i + 3], 0); dummy.updateMatrix(); mesh.setMatrixAt(k, dummy.matrix);
              cells.array[k * 2] = cell[0]; cells.array[k * 2 + 1] = cell[1]; k++;
            }
          }
          mesh.count = k; mesh.visible = k > 0; plaque.count = k; mesh.instanceMatrix.needsUpdate = true; cells.needsUpdate = true;
        },
      };
    }
  }

  return {
    mat, Geo, lampGeo, loaded, buildTile, plaque,
    has: (ix, iz) => { const k = tileKeyI(ix, iz); return net.tilePieces.has(k) || !!blTiles.range(ix, iz) || !!metroTiles.range(ix, iz); },
    dispose(t) {
      if (!t) return;
      for (const m of [t.lamps, t.pool, t.halo]) if (m) scene.remove(m);
      if (t.lamps) t.lamps.dispose();
      if (t.props) { scene.remove(t.props); t.props.geometry.dispose(); }
      loaded.delete(t.key); plaqueDirty = true;
    },
    counts() { let l = 0, p = 0; for (const t of loaded.values()) { l += t.nLamps; p += t.nProps; } return { lamps: l, props: p }; },
    update(cam, night) {
      const pools = night > 0.05;
      poolMat.opacity = 0.36 * night; haloMat.opacity = 0.4 * night;
      for (const t of loaded.values()) {
        if (t.lamps) {
          const c = t.sphere.center, d = Math.hypot(c.x - cam.x, c.z - cam.z) - t.sphere.radius;
          t.lamps.visible = d < Q.lampDist;
          t.pool.visible = pools && d < Q.lampDist * 0.7;
          t.halo.visible = pools && d < Q.lampDist * 1.6;
        }
        if (t.props) { const s = t.props.geometry.boundingSphere; t.props.visible = Math.hypot(s.center.x - cam.x, s.center.z - cam.z) - s.radius < Q.propDist; }
      }
      plaque?.update(cam);
    },
  };
}

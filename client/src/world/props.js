// Mobilier urbain : lampadaires parisiens instanciés (émissifs la nuit + flaques de lumière additives),
// feux tricolores, bancs, colonnes Morris, kiosques, bouches de métro (fusionnés par tuile).
import { tileKey, mulberry32 } from './util.js';
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

export function buildProps(ctx, net, masks, river, bld, Q, uniforms, streetInfo) {
  const { THREE, scene, heightAt, collision, LANDMARKS } = ctx;
  const rnd = mulberry32(777);
  const mat = createPropMaterial(THREE, uniforms);
  const o = { _k: 0 };
  const nearLandmark = (x, z, pad = 0) => { for (const l of LANDMARKS) if (Math.hypot(x - l.x, z - l.z) < l.radius + pad) return true; return false; };
  const free = (x, z, pad = 0.6) => !bld.inBuilding(x, z, pad) && !nearLandmark(x, z) && !(masks.isWater(x, z) && !river.nearDeck(x, z, 0));

  // ---------- lampadaires (instanciés par tuile)
  const lampTiles = new Map();
  const addLamp = (x, z, yaw) => {
    const k = tileKey(x, z); let a = lampTiles.get(k); if (!a) lampTiles.set(k, (a = []));
    a.push(x, heightAt(x, z) + Y_WALK, z, yaw);
    collision.addCircle({ x, z, r: 0.2, top: heightAt(x, z) + 5, tag: 'lamp', data: { type: 'lamp', tile: a, i: a.length / 4 - 1, x, z, y: heightAt(x, z) + Y_WALK } });
  };
  for (const r of net.roads) {
    const both = r._sw >= 4;
    const off = r._ped ? Math.max(0.5, r._hw - 0.7) : r._hw + 0.6;
    if (r._ped && r._len < 40) continue;
    let side = rnd() < 0.5 ? 1 : -1;
    for (const [s0, s1] of net.freeRuns(r)) {
      const a = s0 + 3.5, b = s1 - 3.5; if (b - a < 4) continue;
      const step = r._ped ? Q.lampStep * 1.3 : both ? Q.lampStep * 1.15 : Q.lampStep;
      const n = Math.max(1, Math.round((b - a) / step));
      for (let i = 0; i < n; i++) {
        const s = a + ((b - a) * (i + 0.5)) / n;
        for (const sg of both ? [1, -1] : [side]) {
          net.pointAt(r, s, sg * off, o);
          if (!free(o.x, o.z, 0.3) || (!r._ped && net.edgeDistance(o.x, o.z, false) < 0.4) || net.inZone(o.x, o.z, 1)) continue;
          addLamp(o.x, o.z, Math.atan2(o.dx, o.dz) + (rnd() < 0.5 ? 0 : Math.PI / 4));
        }
        side = -side;
      }
    }
  }
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
  const lampMeshes = [], poolMeshes = [];
  const dummy = new THREE.Object3D();
  let lampCount = 0;
  for (const [, a] of lampTiles) {
    const n = a.length / 4; lampCount += n;
    const m = new THREE.InstancedMesh(lampGeo, mat, n);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      dummy.position.set(a[i * 4], a[i * 4 + 1], a[i * 4 + 2]); dummy.rotation.set(0, a[i * 4 + 3], 0); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
      cx += a[i * 4]; cy += a[i * 4 + 1]; cz += a[i * 4 + 2];
    }
    cx /= n; cy /= n; cz /= n; let r2 = 0;
    for (let i = 0; i < n; i++) r2 = Math.max(r2, (a[i * 4] - cx) ** 2 + (a[i * 4 + 1] - cy) ** 2 + (a[i * 4 + 2] - cz) ** 2);
    const sphere = new THREE.Sphere(new THREE.Vector3(cx, cy + 3, cz), Math.sqrt(r2) + 10);
    m.boundingSphere = sphere; m.castShadow = Q.shadows; m.receiveShadow = false; m.matrixAutoUpdate = false; m.name = 'lampadaires';
    scene.add(m); lampMeshes.push(m); a.mesh = m;
    for (const [geo, material] of [[poolGeo, poolMat], [haloGeo, haloMat]]) {
      const p = new THREE.InstancedMesh(geo, material, n);
      p.instanceMatrix = m.instanceMatrix; p.boundingSphere = sphere; p.matrixAutoUpdate = false; p.visible = false; p.renderOrder = 3; p.name = 'lumiere-lampadaire';
      scene.add(p); poolMeshes.push(p);
    }
  }

  // ---------- mobilier fusionné par tuile
  const tiles = new Map();
  const geoAt = (x, z) => { const k = tileKey(x, z); let g = tiles.get(k); if (!g) tiles.set(k, (g = new Geo())); return g; };
  const yw = (x, z) => heightAt(x, z) + Y_WALK;
  let nProps = 0;
  // donnée attachée à la collision : type + plage de sommets [v0, v1) dans la géométrie fusionnée de la tuile (geo.mesh)
  const pd = (type, g, v0, x, z) => ({ type, geo: g, v0, v1: g.p.length / 3, x, z, y: g.oy });
  // feux tricolores
  for (const L of streetInfo.lights) {
    if (!free(L.x, L.z, 0.2) || net.edgeDistance(L.x, L.z, false) < 0.35 || net.inZone(L.x, L.z, 1)) continue;
    const g = geoAt(L.x, L.z).at(L.x, yw(L.x, L.z), L.z, L.yaw), v0 = g.p.length / 3;
    g.cyl(0, 0, 0, 2.6, 0.06, 0.05, 6, IRON);
    g.box(0, 3.05, 0, 0.3, 0.95, 0.26, [0.02, 0.022, 0.02]);
    const green = rnd() < 0.5;
    g.box(0, 3.35, -0.14, 0.17, 0.17, 0.03, green ? [0.12, 0.01, 0.01] : [1, 0.08, 0.05], green ? 0 : 2);
    g.box(0, 3.05, -0.14, 0.17, 0.17, 0.03, [0.14, 0.08, 0.0], 0);
    g.box(0, 2.75, -0.14, 0.17, 0.17, 0.03, green ? [0.1, 1, 0.35] : [0.01, 0.1, 0.03], green ? 2 : 0);
    g.box(0, 1.5, -0.1, 0.16, 0.3, 0.08, [0.02, 0.022, 0.02]); // répétiteur piéton
    collision.addCircle({ x: L.x, z: L.z, r: 0.12, top: yw(L.x, L.z) + 3.5, tag: 'feu', data: pd('feu', g, v0, L.x, L.z) });
    nProps++;
  }
  // le long des avenues et boulevards : bancs, colonnes Morris, kiosques
  const kiosks = [];
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
  for (const r of net.roads) {
    if (r._sw < 4 || r._len < 60) continue;
    for (const [s0, s1] of net.freeRuns(r)) {
      for (let s = s0 + 14 + rnd() * 30; s < s1 - 14; s += 45 + rnd() * 50) {
        const sg = rnd() < 0.5 ? 1 : -1, pick = rnd();
        net.pointAt(r, s, sg * (r._hw + r._sw - 1.3), o);
        if (!free(o.x, o.z, 1.4) || net.edgeDistance(o.x, o.z) < 1.2 || net.inZone(o.x, o.z, 2)) continue;
        // yaw : face vers la chaussée
        const g = geoAt(o.x, o.z).at(o.x, yw(o.x, o.z), o.z, Math.atan2(sg * o.dz, -sg * o.dx)), v0 = g.p.length / 3;
        if (pick >= 0.9 && r._sw >= 5) kiosks.push([o.x, o.z]);
        if (pick < 0.62) { bench(g); collision.addCircle({ x: o.x, z: o.z, r: 0.7, top: yw(o.x, o.z) + 1, tag: 'banc', data: pd('banc', g, v0, o.x, o.z) }); }
        else if (pick < 0.9) { morris(g, (rnd() * 5) | 0); collision.addCircle({ x: o.x, z: o.z, r: 0.85, top: yw(o.x, o.z) + 4.5, tag: 'morris', data: pd('morris', g, v0, o.x, o.z) }); }
        else if (r._sw >= 5) { kiosk(g); collision.addCircle({ x: o.x, z: o.z, r: 1.6, top: yw(o.x, o.z) + 3.5, tag: 'kiosque', data: pd('kiosque', g, v0, o.x, o.z) }); }
        nProps++;
      }
    }
  }
  // bouches de métro près des grands carrefours (espacées)
  const metros = [];
  // positions réelles des stations (pois kind 'metro') si la donnée existe, sinon grands carrefours espacés
  const poiMetros = (Array.isArray(ctx.worldData.pois?.pois) ? ctx.worldData.pois.pois : []).filter((p) => p && p.kind === 'metro' && Number.isFinite(p.x) && Number.isFinite(p.z));
  const metroSites = poiMetros.length >= 5 ? poiMetros.map((p) => ({ p: [p.x, p.z], maxHw: 0, ped: false, real: true })) : net.junctions;
  for (const j of metroSites) {
    if (!j.real && (j.maxHw < 4.7 || j.ped)) continue;
    const [x, z] = j.p;
    if (metros.some((m) => Math.hypot(m[0] - x, m[1] - z) < (j.real ? 25 : 380))) continue;
    // cherche un emplacement libre autour du carrefour
    for (let t = 0; t < (j.real ? 28 : 10); t++) {
      const a = rnd() * Math.PI * 2, R = j.real ? 2 + t * 1.1 : j.maxHw + 9 + rnd() * 8, px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
      if (net.edgeDistance(px, pz) < (j.real ? 2.4 : 3.6) || !free(px, pz, j.real ? 2.6 : 3.5) || masks.isWater(px, pz) || (!j.real && masks.isPark(px, pz))) continue;
      metros.push([x, z, px, pz]);
      const yaw = rnd() * Math.PI, g = geoAt(px, pz).at(px, yw(px, pz) - 0.1, pz, yaw);
      g.quad([-1.4, 0.03, 2.6], [1.4, 0.03, 2.6], [1.4, 0.03, -2.6], [-1.4, 0.03, -2.6], [0.01, 0.01, 0.012]); // trémie
      for (let k = 0; k < 6; k++) g.box(0, -0.0 + 0.012, -2.2 + k * 0.5, 2.7, 0.02, 0.3, [0.2, 0.2, 0.2].map((v) => v * (1 - k * 0.14)));
      // entourage Guimard : balustrade verte sur 3 côtés
      for (const sx of [-1.45, 1.45]) { g.box(sx, 0.55, 0, 0.08, 1.0, 5.3, GREEN); g.box(sx, 1.08, 0, 0.14, 0.07, 5.4, GREEN); }
      g.box(0, 0.55, 2.65, 2.98, 1.0, 0.08, GREEN); g.box(0, 1.08, 2.65, 3.0, 0.07, 0.14, GREEN);
      // candélabres et enseigne
      for (const sx of [-1.45, 1.45]) { g.cyl(sx, -2.7, 0, 3.4, 0.07, 0.05, 6, GREEN); g.cyl(sx, -2.7, 3.4, 3.75, 0.1, 0.16, 6, [1.0, 0.45, 0.2], 2, true); }
      g.box(0, 3.0, -2.7, 2.9, 0.5, 0.07, [0.95, 0.8, 0.25], 2);
      g.box(0, 3.0, -2.7, 2.5, 0.3, 0.09, GREEN);
      collision.addBox({ x: px, z: pz, hw: 1.6, hd: 2.8, rot: yaw, top: yw(px, pz) + 1.2, tag: 'metro', data: { type: 'metro' } });
      nProps++;
      break;
    }
  }
  const propMeshes = [];
  for (const [, g] of tiles) {
    const geo = g.build(THREE); if (!geo) continue;
    const m = new THREE.Mesh(geo, mat); m.castShadow = Q.shadows; m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'mobilier';
    scene.add(m); propMeshes.push(m); g.mesh = m;
  }
  return {
    lampCount, nProps, mat, Geo, metros, kiosks, lampGeo, propMeshes,
    update(cam, night) {
      const pools = night > 0.05;
      poolMat.opacity = 0.36 * night; haloMat.opacity = 0.4 * night;
      for (let i = 0; i < lampMeshes.length; i++) {
        const m = lampMeshes[i], c = m.boundingSphere.center, d = Math.hypot(c.x - cam.x, c.z - cam.z) - m.boundingSphere.radius;
        m.visible = d < Q.lampDist;
        poolMeshes[i * 2].visible = pools && d < Q.lampDist * 0.7;
        poolMeshes[i * 2 + 1].visible = pools && d < Q.lampDist * 1.6;
      }
      for (const m of propMeshes) { const c = m.geometry.boundingSphere.center; m.visible = Math.hypot(c.x - cam.x, c.z - cam.z) - m.geometry.boundingSphere.radius < Q.propDist; }
    },
  };
}

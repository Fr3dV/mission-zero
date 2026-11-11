// Dégâts des véhicules : zones, conséquences mécaniques, déformation locale de la carrosserie
// (copie à l'écriture des géométries en cache), éléments qui cèdent par paliers.
// Repère local du véhicule : +x = droite, +z = arrière (l'avant regarde −z), y = haut.
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hash = (i) => { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };

/** Seuil (m/s) sous lequel un choc ne laisse aucune trace, et énergie normalisée d'un impact. */
// Réglage « solide » : rien sous ~15 km/h, un choc à 50 km/h marque sans handicaper,
// il faut ~110 km/h de face (ou plusieurs gros chocs) pour approcher l'épave.
export const IMPACT_MIN = 4;
export const impactEnergy = (impact) => { const d = Math.max(0, impact - IMPACT_MIN); return d * d * 0.0022; };

// Modèles à moteur central/arrière : c'est la zone arrière qui abîme le moteur.
const REAR_ENGINE = { porsche_911: 1, lambo_huracan: 1, lambo_aventador: 1 };

export function initDamage(v) {
  v.damage = 0;
  v.damageZones = { front: 0, rear: 0, left: 0, right: 0 };
  v.wrecked = false;
  v.dmg = {
    corners: [0, 0, 0, 0],          // AVG, AVD, ARG, ARD (même ordre que userData.wheels)
    steerBias: 0, stallT: 0,
    parts: { bumperF: 0, bumperR: 0, hood: 0, trunk: 0, mirrorL: 0, mirrorR: 0, lampF: [0, 0], lampR: [0, 0], glass: { front: 0, rear: 0, left: 0, right: 0 } },
    clones: null, hoodAngle: 0, trunkAngle: 0, sagF: 0, sagR: 0,
  };
  updateMechanics(v);
}

/** Conséquences mécaniques progressives, lues par la physique (v.phys.fxm). */
export function updateMechanics(v) {
  const z = v.damageZones, d = v.dmg, eng = REAR_ENGINE[v.typeId] ? z.rear : z.front;
  const worst = Math.max(...d.corners);
  v.phys.fxm = {
    power: v.wrecked ? 0 : clamp(1 - 0.45 * eng * eng - 0.15 * v.damage, 0.3, 1),
    brake: clamp(1 - 0.45 * v.damage, 0.5, 1),
    grip: clamp(1 - 0.28 * clamp((worst - 0.45) * 2, 0, 1), 0.7, 1),
    steerBias: clamp(d.steerBias, -0.07, 0.07),
    wobble: clamp((worst - 0.4) * 1.6, 0, 1),
    drag: worst > 0.85 ? 1.6 : 0,     // pneu crevé / roue qui frotte
    engine: eng,
  };
}

// ---------------------------------------------------------------------------------------------
// Géométries propres au véhicule (créées au premier dégât) : positions et normales copiées,
// autres attributs partagés avec le cache, plus un masque de dégâts pour la peinture.
function cowGeometry(src, extra) {
  const g = new THREE.BufferGeometry();
  for (const k in src.attributes) g.setAttribute(k, k === 'position' || k === 'normal' || extra.includes(k) ? src.attributes[k].clone() : src.attributes[k]);
  g.boundingSphere = src.boundingSphere.clone(); g.boundingSphere.radius += 0.6;
  g.boundingBox = src.boundingBox?.clone() || null;
  return g;
}
function ensureClones(v) {
  const d = v.dmg;
  if (d.clones) return d.clones;
  const P = v.group.userData.parts;
  const mk = (mesh, extra = [], mask = false) => {
    const g = cowGeometry(mesh.geometry, extra);
    const n = g.attributes.position.count;
    if (mask) g.setAttribute('dmg', new THREE.BufferAttribute(new Float32Array(n), 1));
    const o = { mesh, orig: mesh.geometry, geo: g, disp: new Float32Array(n), base: mesh.geometry.attributes.position.array };
    mesh.geometry = g;
    return o;
  };
  d.clones = {
    paintHi: mk(P.bodyHi, [], true), miscHi: mk(P.miscHi), glass: mk(P.glassHi, ['pbr']), lights: mk(P.lights, ['color']),
    paintLo: mk(P.bodyLo, [], true), miscLo: mk(P.miscLo),
  };
  return d.clones;
}

/** Enfonce localement toutes les géométries autour du point d'impact (cumulatif et borné). */
function deform(v, lx, ly, lz, dx, dz, depth, radius, zone) {
  const C = ensureClones(v), info = v.vis.info, lim = info.crush;
  const maxDisp = zone === 'front' ? lim.front : zone === 'rear' ? lim.rear : lim.side;
  const r2 = radius * radius, seed = Math.floor(lx * 31 + lz * 17);
  for (const key in C) {
    const c = C[key], pos = c.geo.attributes.position, nor = c.geo.attributes.normal, pa = pos.array, na = nor.array, disp = c.disp;
    const dm = c.geo.attributes.dmg?.array, interiorGuard = key === 'miscHi';
    let touched = false;
    for (let t = 0; t < pa.length; t += 9) {
      let any = false;
      for (let k = 0; k < 3; k++) {
        const o = t + k * 3, i = o / 3;
        const px = pa[o] - lx, py = (pa[o + 1] - ly) * 0.55, pz = pa[o + 2] - lz;
        const q = px * px + py * py + pz * pz;
        if (q >= r2) continue;
        const bx = c.base[o], bz = c.base[o + 2];
        // l'habitacle (sièges, planche, doublure) et la cellule centrale ne bougent presque pas
        if (interiorGuard && Math.abs(bx) < lim.cabX && bz > lim.cabZ0 && bz < lim.cabZ1 && c.base[o + 1] < lim.cabY) continue;
        let w = 1 - Math.sqrt(q) / radius; w = w * w * (3 - 2 * w);
        // froissement cohérent : le bruit dépend de la position (cellules de ~9 cm), pas du sommet
        const cell = Math.floor(c.base[o] * 11) * 7.13 + Math.floor(c.base[o + 1] * 11) * 3.71 + Math.floor(bz * 11) * 1.37 + seed;
        let amt = depth * w * (0.78 + 0.44 * hash(cell));
        const room = maxDisp - disp[i];
        if (amt > room) amt = room;
        if (amt <= 0.0005) { if (dm && w > 0.25) dm[i] = Math.max(dm[i], Math.min(1, w * (0.5 + depth * 3))); continue; }
        let nx2 = pa[o] + dx * amt, nz2 = pa[o + 2] + dz * amt;
        // ne traverse ni la cloison avant ni la cloison arrière de l'habitacle
        if (zone === 'front' && bz < lim.cabZ0 && nz2 > lim.cabZ0 - 0.04) nz2 = Math.max(pa[o + 2], lim.cabZ0 - 0.04);
        if (zone === 'rear' && bz > lim.cabZ1 && nz2 < lim.cabZ1 + 0.04) nz2 = Math.min(pa[o + 2], lim.cabZ1 + 0.04);
        if ((zone === 'left' || zone === 'right') && Math.abs(nx2) < lim.cabX - 0.05 && Math.abs(bx) >= lim.cabX - 0.05) nx2 = Math.sign(bx) * (lim.cabX - 0.05);
        pa[o] = nx2; pa[o + 2] = nz2; pa[o + 1] += (hash(cell * 1.7) - 0.5) * amt * 0.18;
        disp[i] += amt;
        if (dm) dm[i] = Math.max(dm[i], Math.min(1, w * (0.35 + depth * 2.2)));
        any = true;
      }
      if (!any) continue;
      touched = true;
      // tôle froissée : normale de facette mélangée à l'ancienne normale lissée
      const ax = pa[t + 3] - pa[t], ay = pa[t + 4] - pa[t + 1], az = pa[t + 5] - pa[t + 2], bx2 = pa[t + 6] - pa[t], by2 = pa[t + 7] - pa[t + 1], bz2 = pa[t + 8] - pa[t + 2];
      let fx = ay * bz2 - az * by2, fy = az * bx2 - ax * bz2, fz = ax * by2 - ay * bx2;
      const fl = Math.hypot(fx, fy, fz);
      if (fl < 1e-9) continue;
      fx /= fl; fy /= fl; fz /= fl;
      for (let k = 0; k < 3; k++) {
        const o = t + k * 3;
        let x = na[o] * 0.45 + fx * 0.55, y = na[o + 1] * 0.45 + fy * 0.55, z = na[o + 2] * 0.45 + fz * 0.55;
        const l = Math.hypot(x, y, z) || 1; na[o] = x / l; na[o + 1] = y / l; na[o + 2] = z / l;
      }
    }
    if (touched) { pos.needsUpdate = true; nor.needsUpdate = true; if (c.geo.attributes.dmg) c.geo.attributes.dmg.needsUpdate = true; }
  }
}

/** Applique une transformation à un sous-ensemble de sommets (capot, coffre, pare-chocs, rétroviseur). */
function movePart(v, test, fn, keys = ['paintHi', 'miscHi', 'paintLo', 'miscLo', 'lights']) {
  const C = ensureClones(v);
  const p = [0, 0, 0];
  for (const key of keys) {
    const c = C[key], pa = c.geo.attributes.position.array, base = c.base;
    let any = false;
    for (let o = 0; o < pa.length; o += 3) {
      if (!test(base[o], base[o + 1], base[o + 2], key)) continue;
      p[0] = pa[o]; p[1] = pa[o + 1]; p[2] = pa[o + 2];
      fn(p, key, o / 3, c);
      pa[o] = p[0]; pa[o + 1] = p[1]; pa[o + 2] = p[2]; any = true;
    }
    if (any) { c.geo.attributes.position.needsUpdate = true; if (c.geo.attributes.dmg) c.geo.attributes.dmg.needsUpdate = true; }
  }
}
function rotateX(p, y0, z0, a) { const c = Math.cos(a), s = Math.sin(a), y = p[1] - y0, z = p[2] - z0; p[1] = y0 + y * c - z * s; p[2] = z0 + y * s + z * c; }
function rotateZ(p, x0, y0, a) { const c = Math.cos(a), s = Math.sin(a), x = p[0] - x0, y = p[1] - y0; p[0] = x0 + x * c - y * s; p[1] = y0 + x * s + y * c; }

function setHood(v, angle) {
  const d = v.dmg, R = v.vis.info.regions.hood, da = angle - d.hoodAngle;
  if (!R || Math.abs(da) < 1e-4) return;
  d.hoodAngle = angle; d.parts.hood = angle > 0.3 ? 2 : angle > 0 ? 1 : 0;
  // charnière côté pare-brise : l'avant du capot se soulève
  movePart(v, (x, y, z) => z > R.z0 && z < R.z1 && Math.abs(x) < R.hx && y > R.yMin(z, x), (p) => rotateX(p, R.hy, R.z1, da), ['paintHi', 'miscHi', 'paintLo']);
}
function setTrunk(v, angle) {
  const d = v.dmg, R = v.vis.info.regions.trunk, da = angle - d.trunkAngle;
  if (!R || Math.abs(da) < 1e-4) return;
  d.trunkAngle = angle; d.parts.trunk = angle > 0 ? 1 : 0;
  movePart(v, (x, y, z) => z > R.z0 && z < R.z1 && Math.abs(x) < R.hx && y > R.yMin(z, x), (p) => rotateX(p, R.hy, R.z0, -da), ['paintHi', 'miscHi', 'paintLo']);
}
function setBumper(v, end, level, side) {
  const d = v.dmg, key = end > 0 ? 'bumperR' : 'bumperF', R = v.vis.info.regions[key];
  if (level <= d.parts[key]) return false;
  const inB = (x, y, z) => (end > 0 ? z > R.z : z < R.z) && y < R.yMax;
  if (d.parts[key] === 0) {
    // 1er palier : le bouclier se décroche d'un côté et pend
    const s = side || 1;
    movePart(v, inB, (p) => { rotateZ(p, -s * R.hx, R.yMax, -s * 0.07); p[2] += end * 0.03; });
  }
  if (level >= 2) {
    // 2e palier : il tombe (peinture masquée, détails et optiques du bouclier repliés hors de vue)
    movePart(v, inB, (p, k, i, c) => { if (c.geo.attributes.dmg) c.geo.attributes.dmg.array[i] = 2; else { p[0] *= 0.6; p[1] = R.yMax - 0.05; p[2] -= end * 0.12; } });
  }
  d.parts[key] = level;
  return level >= 2;
}
function dropMirror(v, s) {
  const d = v.dmg, key = s < 0 ? 'mirrorL' : 'mirrorR', R = v.vis.info.regions.mirror;
  if (d.parts[key] || !R) return false;
  d.parts[key] = 1;
  movePart(v, (x, y, z) => x * s > R.x && Math.abs(z - R.z) < 0.22 && Math.abs(y - R.y) < 0.14, (p) => { p[0] = s * R.x; p[1] = R.y; p[2] = R.z; }, ['paintHi', 'miscHi', 'paintLo', 'miscLo']);
  return true;
}
function breakLamps(v, end, s) {
  const d = v.dmg, arr = end > 0 ? d.parts.lampR : d.parts.lampF, idx = s < 0 ? 0 : 1;
  if (arr[idx]) return false;
  arr[idx] = 1;
  const C = ensureClones(v), R = v.vis.info.regions, zl = end > 0 ? R.lampZR : R.lampZF;
  const c = C.lights, pa = c.base, col = c.geo.attributes.color.array;
  for (let o = 0; o < pa.length; o += 3) if (pa[o] * s > 0.02 && (end > 0 ? pa[o + 2] > zl : pa[o + 2] < zl)) { col[o] *= 0.04; col[o + 1] *= 0.04; col[o + 2] *= 0.04; }
  c.geo.attributes.color.needsUpdate = true;
  // glace de l'optique fissurée
  const g = C.glass, gp = g.base, pb = g.geo.attributes.pbr.array;
  for (let o = 0; o < gp.length; o += 3) if (gp[o] * s > 0.02 && (end > 0 ? gp[o + 2] > zl : gp[o + 2] < zl) && gp[o + 1] < R.lampY) pb[o + 1] = Math.max(pb[o + 1], 1);
  g.geo.attributes.pbr.needsUpdate = true;
  return true;
}
/** Vitrage par zone : 1 = étoilé, 2 = brisé. */
function setGlass(v, zone, level) {
  const d = v.dmg;
  if (level <= d.parts.glass[zone]) return false;
  d.parts.glass[zone] = level;
  const C = ensureClones(v), g = C.glass, n = g.orig.attributes.normal.array, gp = g.base, pb = g.geo.attributes.pbr.array, R = v.vis.info.regions;
  for (let o = 0; o < gp.length; o += 3) {
    if (gp[o + 1] < R.lampY && (gp[o + 2] < R.lampZF || gp[o + 2] > R.lampZR)) continue; // glaces d'optiques : gérées à part
    const nx = n[o], nz = n[o + 2];
    const zn = Math.abs(nx) > 0.6 ? (nx < 0 ? 'left' : 'right') : nz < 0 ? 'front' : 'rear';
    if (zn === zone) pb[o + 1] = Math.max(pb[o + 1], level);
  }
  g.geo.attributes.pbr.needsUpdate = true;
  return true;
}

/**
 * Applique un choc au véhicule.
 * hit = { impact (m/s), lx, lz (point de contact local), ldx, ldz (direction d'enfoncement locale, unitaire), scale? }
 * @returns {{ zone, energy, glass: bool, debris: number, fell: string|null }} pour les effets (débris, sons).
 */
export function applyDamage(v, hit) {
  const d = v.dmg, zs = v.damageZones, info = v.vis.info;
  const e = impactEnergy(hit.impact) * (hit.scale ?? 1);
  const out = { zone: null, energy: e, glass: false, debris: 0, fell: null };
  if (e <= 0) return out;
  const { lx, lz, ldx, ldz } = hit;
  // zone : d'après le point de contact (nez / poupe) puis d'après la direction du choc
  const hl = v.spec.length * 0.5, endBand = v.spec.width * 0.32;
  const zone = lz < -(hl - endBand) && ldz > -0.2 ? 'front' : lz > hl - endBand && ldz < 0.2 ? 'rear'
    : Math.abs(ldz) >= Math.abs(ldx) ? (ldz > 0 ? 'front' : 'rear') : ldx > 0 ? 'left' : 'right';
  out.zone = zone;
  zs[zone] = clamp(zs[zone] + e, 0, 1);
  // un choc violent se propage un peu aux zones voisines
  for (const k in zs) if (k !== zone) zs[k] = clamp(zs[k] + e * 0.08, 0, 1);
  v.damage = clamp(v.damage + e * 0.55, 0, 1);
  // coin touché → roue / train roulant
  const fi = lz < 0 ? 0 : 2, si = lx < 0 ? 0 : 1;
  const nearAxle = Math.abs(Math.abs(lz) - info.wheelbase * 0.5) < 0.9 || zone === 'front' || zone === 'rear';
  if (nearAxle) {
    const off = clamp(Math.abs(lx) / (v.spec.width * 0.5), 0, 1);
    const share = zone === 'left' || zone === 'right' ? 1 : 0.35 + 0.65 * off;
    const ck = hit.soft ? 0.25 : 0.9;   // objet fauché : le train roulant souffre peu
    d.corners[fi + si] = clamp(d.corners[fi + si] + e * share * ck, 0, 1);
    if (zone === 'front' || zone === 'rear') d.corners[fi + (1 - si)] = clamp(d.corners[fi + (1 - si)] + e * (1 - off) * 0.5, 0, 1);
    if (lz < 0 && e > 0.08 && !hit.soft) d.steerBias += (lx < 0 ? -1 : 1) * e * 0.07 * (0.3 + off); // train avant faussé : tire du côté touché
  }
  if (v.damage >= 1 && !v.wrecked) { v.wrecked = true; }

  // ---- déformation locale
  const depth = Math.min(0.6, 0.42 * Math.pow(e, 0.6)), radius = 0.38 + 0.5 * Math.sqrt(Math.min(e, 4));
  if (depth > 0.012) deform(v, lx, hit.ly ?? 0.5, lz, ldx, ldz, depth, radius, zone);
  out.debris = Math.round(clamp(e * 26, 0, 22));

  // ---- éléments qui cèdent par paliers
  const P = d.parts, side = lx < 0 ? -1 : 1;
  if (zone === 'front') {
    if (zs.front > 0.3 && setBumper(v, -1, zs.front > 0.75 ? 2 : 1, side)) out.fell = 'bumper';
    if (zs.front > 0.28 && breakLamps(v, -1, side)) out.glass = true;
    if (zs.front > 0.7 && breakLamps(v, -1, -side)) out.glass = true;
    setHood(v, zs.front > 0.85 ? 0.5 : zs.front > 0.5 ? 0.12 : 0);
    if (zs.front > 0.45 && setGlass(v, 'front', zs.front > 0.9 && hit.impact > 16 ? 2 : 1)) out.glass = true;
  } else if (zone === 'rear') {
    if (zs.rear > 0.3 && setBumper(v, 1, zs.rear > 0.75 ? 2 : 1, side)) out.fell = 'bumper';
    if (zs.rear > 0.28 && breakLamps(v, 1, side)) out.glass = true;
    if (zs.rear > 0.7 && breakLamps(v, 1, -side)) out.glass = true;
    setTrunk(v, zs.rear > 0.55 ? 0.14 : 0);
    if (zs.rear > 0.5 && setGlass(v, 'rear', zs.rear > 0.9 ? 2 : 1)) out.glass = true;
  } else {
    if (zs[zone] > 0.3 && dropMirror(v, zone === 'left' ? -1 : 1)) out.fell = 'mirror';
    if (zs[zone] > 0.3 && setGlass(v, zone, zs[zone] > 0.65 ? 2 : 1)) out.glass = true;
  }
  if (hit.impact > 20 && setGlass(v, 'front', P.glass.front || 1)) out.glass = true;
  updateMechanics(v);
  return out;
}

/** Remet le véhicule à neuf : géométries du cache, zones et pièces réinitialisées. */
export function repairDamage(v) {
  disposeDamage(v);
  const ph = v.phys;
  initDamage(v);
  ph.stalled = false;
}

/** Libère les géométries propres au véhicule (à appeler à la suppression). */
export function disposeDamage(v) {
  const C = v.dmg?.clones;
  if (!C) return;
  for (const k in C) { const c = C[k]; c.mesh.geometry = c.orig; c.geo.dispose(); }
  v.dmg.clones = null;
}

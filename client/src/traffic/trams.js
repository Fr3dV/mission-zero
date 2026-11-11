// Trafic — rames de tramway sur worldData.rails (kind 'tram'). Secondaire et volontairement simple :
//   - chaque polyligne de rail est parcourue dans le sens de ses points (une voie par sens dans les données) ;
//     au bout, la rame enchaîne sur la polyligne qui commence à proximité, sinon elle reste au terminus ;
//   - trois caisses articulées (modèle procédural, sans type de véhicule au catalogue), 40 km/h au plus,
//     arrêt d'une dizaine de secondes aux stations (pois kind 'tram' proches de la voie) ;
//   - prioritaire : les voitures IA la voient comme un véhicule (T.trams) et s'arrêtent ; elle ne freine que
//     pour un obstacle sur la voie (véhicule, joueur, piéton), du même niveau ;
//   - collision avec les voitures du joueur : trois boîtes mobiles dans ctx.collision (tag 'tram'), mises à jour
//     seulement près du joueur ; les piétons esquivent la rame comme une voiture.
// Trois rames au plus autour du joueur ; rien n'est créé s'il n'y a pas de rails de tram (Paris).
import { baseHeightAt } from '@shared/terrain.js';

const SEG_LEN = 10.4, SEG_GAP = 0.6, HALF_W = 1.25, NSEG = 3;
const VMAX = 11, ACC = 0.9, BRK = 1.3;
const LEVEL = 3;

export function createTrams(T) {
  const { ctx } = T, THREE = ctx.THREE;
  const rails = ((ctx.worldData && ctx.worldData.rails) || []).filter((r) => r && r.kind === 'tram' && !r.yard && !r.tunnel && r.points && r.points.length >= 2);
  const list = [];
  T.trams = list; // segments visibles par les voitures et les piétons : { x, y, z, fx, fz, speed, active }
  if (!rails.length) return { update() {}, list, lines: 0, active: 0 };

  // ---- pièces de voie : longueurs cumulées, élévations, stations, enchaînement
  const pieces = rails.map((r) => {
    const n = r.points.length, cum = new Float32Array(n), xs = new Float32Array(n), zs = new Float32Array(n), el = new Float32Array(n);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = r.points[i][0], z = r.points[i][1];
      xs[i] = x; zs[i] = z; el[i] = r.ele ? +r.ele[i] || 0 : 0;
      if (i) cum[i] = cum[i - 1] + Math.hypot(x - xs[i - 1], z - zs[i - 1]);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    return { n, xs, zs, el, cum, len: cum[n - 1], x0, z0, x1, z1, next: -1, stops: [] };
  }).filter((p) => p.len > 1);
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i], ex = a.xs[a.n - 1], ez = a.zs[a.n - 1];
    let best = -1, bd = 30;
    for (let j = 0; j < pieces.length; j++) { if (j === i) continue; const d = Math.hypot(pieces[j].xs[0] - ex, pieces[j].zs[0] - ez); if (d < bd) { bd = d; best = j; } }
    a.next = best;
  }
  const stopsPoi = ((ctx.worldData.pois && ctx.worldData.pois.pois) || []).filter((q) => q.kind === 'tram');
  for (const p of pieces) {
    for (const q of stopsPoi) {
      if (q.x < p.x0 - 20 || q.x > p.x1 + 20 || q.z < p.z0 - 20 || q.z > p.z1 + 20) continue;
      let bs = -1, bd = 18 * 18;
      for (let i = 0; i < p.n - 1; i++) {
        const ax = p.xs[i], az = p.zs[i], dx = p.xs[i + 1] - ax, dz = p.zs[i + 1] - az, l2 = dx * dx + dz * dz || 1;
        let t = ((q.x - ax) * dx + (q.z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = (ax + dx * t - q.x) ** 2 + (az + dz * t - q.z) ** 2;
        if (d < bd) { bd = d; bs = p.cum[i] + Math.sqrt(l2) * t; }
      }
      if (bs >= 0 && !p.stops.some((s) => Math.abs(s - bs) < 40)) p.stops.push(bs + SEG_LEN * 1.5); // nez de la rame au-delà du quai
    }
    p.stops.sort((a, b) => a - b);
  }

  // ---- modèle : une caisse = boîtes fusionnées (couleurs par sommet), partagée par toutes les rames
  function boxGeo(parts) {
    const pos = [], col = [], nor = [], idx = [];
    for (const [w, h, l, y, z, c] of parts) {
      const g = new THREE.BoxGeometry(w, h, l), p = g.attributes.position, nn = g.attributes.normal, b = pos.length / 3, cc = new THREE.Color(c);
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i) + y, p.getZ(i) + z); nor.push(nn.getX(i), nn.getY(i), nn.getZ(i)); col.push(cc.r, cc.g, cc.b); }
      for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + b);
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); out.setIndex(idx);
    return out;
  }
  const W = HALF_W * 2;
  const carGeo = boxGeo([
    [W, 2.35, SEG_LEN, 1.6, 0, '#e9ebee'],           // caisse
    [W + 0.04, 0.95, SEG_LEN - 0.8, 2.0, 0, '#1c2530'], // bandeau vitré
    [W + 0.05, 0.28, SEG_LEN, 0.62, 0, '#b0123c'],   // bas de caisse coloré
    [W - 0.5, 0.3, SEG_LEN - 2, 2.95, 0, '#8d9299'],  // équipements de toiture
    [W - 0.3, 0.35, 2.2, 0.2, -SEG_LEN * 0.3, '#2a2d33'], [W - 0.3, 0.35, 2.2, 0.2, SEG_LEN * 0.3, '#2a2d33'], // bogies
  ]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });

  function newTram() {
    const t = { active: false, pi: 0, prev: -1, s: 0, speed: 0, stopT: 0, stopI: 0, endT: 0, segs: [], boxes: [null, null, null], bx: NaN, bz: NaN };
    for (let k = 0; k < NSEG; k++) {
      const m = new THREE.Mesh(carGeo, mat); m.castShadow = true; m.visible = false; ctx.scene.add(m);
      const seg = { mesh: m, x: 0, y: 0, z: 0, fx: 0, fz: -1, speed: 0, active: false, halfLen: SEG_LEN / 2, halfWid: HALF_W, tram: t };
      t.segs.push(seg); list.push(seg);
    }
    return t;
  }
  const trams = [];
  const out = { x: 0, z: 0, e: 0, fx: 0, fz: -1 };
  /** Point de la voie à l'abscisse s de la pièce p (écrit dans out). */
  function at(p, s) {
    if (s < 0) s = 0; else if (s > p.len) s = p.len;
    let lo = 0, hi = p.n - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (p.cum[m] <= s) lo = m; else hi = m - 1; }
    const l = p.cum[lo + 1] - p.cum[lo] || 1, t = (s - p.cum[lo]) / l, dx = p.xs[lo + 1] - p.xs[lo], dz = p.zs[lo + 1] - p.zs[lo];
    out.x = p.xs[lo] + dx * t; out.z = p.zs[lo] + dz * t; out.e = p.el[lo] + (p.el[lo + 1] - p.el[lo]) * t; out.fx = dx / l; out.fz = dz / l;
  }
  function removeBoxes(t) { for (let k = 0; k < NSEG; k++) if (t.boxes[k]) { ctx.collision.remove(t.boxes[k]); t.boxes[k] = null; } t.bx = NaN; }
  function deactivate(t) { t.active = false; removeBoxes(t); for (const s of t.segs) { s.active = false; s.mesh.visible = false; } }
  function pose(t) {
    const p = pieces[t.pi], pp = t.prev >= 0 ? pieces[t.prev] : null;
    for (let k = 0; k < NSEG; k++) {
      const seg = t.segs[k], s = t.s - SEG_LEN / 2 - k * (SEG_LEN + SEG_GAP);
      if (s >= 0 || !pp) at(p, s); else at(pp, pp.len + s);
      let y = baseHeightAt(out.x, out.z) + out.e;
      const yh = ctx.heightAt(out.x, out.z, y + 0.4); if (Math.abs(yh - y) < 0.75) y = yh;
      seg.x = out.x; seg.y = y; seg.z = out.z; seg.fx = out.fx; seg.fz = out.fz; seg.speed = t.speed; seg.active = true;
      seg.mesh.position.set(out.x, y + 0.05, out.z); seg.mesh.rotation.y = Math.atan2(-out.fx, -out.fz); seg.mesh.visible = true;
    }
  }
  /** Distance libre devant le nez (véhicules, joueur, piétons du même niveau sur la voie), 1e9 si rien. */
  function clearAhead(t) {
    const h = t.segs[0], hx = h.x + h.fx * SEG_LEN / 2, hz = h.z + h.fz * SEG_LEN / 2, fx = h.fx, fz = h.fz;
    let gap = 1e9;
    const test = (x, z, y, r) => {
      if (y - h.y > LEVEL || h.y - y > LEVEL) return;
      const dx = x - hx, dz = z - hz, f = dx * fx + dz * fz;
      if (f < 0 || f > 28 || Math.abs(dx * -fz + dz * fx) > HALF_W + r) return;
      if (f - r < gap) gap = f - r;
    };
    const vl = ctx.vehicles && ctx.vehicles.list;
    if (vl) for (let i = 0; i < vl.length; i++) { const v = vl[i]; if (v.group && v.group.visible === false) continue; test(v.pos.x, v.pos.z, v.pos.y, 1.6); }
    const pl = ctx.player;
    if (pl && pl.pos && !pl.vehicle) test(pl.pos.x, pl.pos.z, pl.pos.y, 0.5);
    const peds = T.peds;
    if (peds) for (let i = 0; i < peds.length; i++) { const q = peds[i]; if (q.active) test(q.x, q.z, q.y, 0.4); }
    for (let i = 0; i < list.length; i++) { const o = list[i]; if (o.active && o.tram !== t) test(o.x, o.z, o.y, SEG_LEN / 2); }
    return gap;
  }

  let spawnT = 1;
  function trySpawn() {
    const fx = T.fx, fz = T.fz;
    const p0 = (Math.random() * pieces.length) | 0;
    for (let q = 0; q < pieces.length; q++) {
      const pi = (p0 + q) % pieces.length, p = pieces[pi];
      if (p.len < 60 || fx < p.x0 - 480 || fx > p.x1 + 480 || fz < p.z0 - 480 || fz > p.z1 + 480) continue;
      const i = (Math.random() * (p.n - 1)) | 0, x = p.xs[i], z = p.zs[i], d = Math.hypot(x - fx, z - fz);
      if (d < 170 || d > 480 || p.cum[i] < 40 || T.inView(x, z, baseHeightAt(x, z) + p.el[i])) continue;
      if (trams.some((o) => o.active && Math.hypot(o.segs[0].x - x, o.segs[0].z - z) < 220)) continue;
      let t = trams.find((o) => !o.active);
      if (!t) { if (trams.length >= 3) return; t = newTram(); trams.push(t); }
      t.active = true; t.pi = pi; t.prev = -1; t.s = p.cum[i]; t.speed = VMAX * 0.7; t.stopT = 0; t.endT = 0;
      t.stopI = 0; while (t.stopI < p.stops.length && p.stops[t.stopI] < t.s + 30) t.stopI++;
      pose(t);
      return;
    }
  }

  function update(dt) {
    const fx = T.fx, fz = T.fz;
    if ((spawnT -= dt) <= 0) { spawnT = 1.5; if (trams.filter((t) => t.active).length < 3) trySpawn(); }
    for (let i = 0; i < trams.length; i++) {
      const t = trams[i];
      if (!t.active) continue;
      const p = pieces[t.pi];
      let vmax = VMAX;
      // prochaine station, bout de ligne
      if (t.stopT > 0) { t.stopT -= dt; vmax = 0; }
      else if (t.stopI < p.stops.length) {
        const d = p.stops[t.stopI] - t.s;
        if (d < 0.6 && t.speed < 0.4) { t.stopT = 8 + Math.random() * 4; t.stopI++; vmax = 0; } else vmax = Math.min(vmax, Math.sqrt(2 * BRK * Math.max(0, d)) + 0.3);
      }
      if (p.next < 0) vmax = Math.min(vmax, Math.sqrt(2 * BRK * Math.max(0, p.len - t.s - 1)));
      const gap = clearAhead(t);
      if (gap < 1e8) vmax = Math.min(vmax, gap < 2.5 ? 0 : Math.sqrt(2 * 2.2 * (gap - 2.5)));
      if (t.speed < vmax) t.speed = Math.min(vmax, t.speed + ACC * dt); else t.speed = Math.max(vmax, t.speed - (gap < 12 ? 3 : BRK) * dt);
      t.s += t.speed * dt;
      if (t.s >= p.len) {
        if (p.next >= 0) { t.s -= p.len; t.prev = t.pi; t.pi = p.next; t.stopI = 0; }
        else { t.s = p.len; t.speed = 0; t.endT += dt; } // terminus
      }
      pose(t);
      const hx = t.segs[0].x, hz = t.segs[0].z, d2 = (hx - fx) * (hx - fx) + (hz - fz) * (hz - fz);
      if (d2 > 680 * 680 || (t.endT > 6 && !T.inView(hx, hz, t.segs[0].y))) { deactivate(t); continue; }
      // obstacle mobile pour les voitures du joueur : boîtes de collision, rafraîchies seulement de près
      if (d2 < 140 * 140) {
        if (!(Math.abs(hx - t.bx) + Math.abs(hz - t.bz) < 0.06)) {
          removeBoxes(t); t.bx = hx; t.bz = hz;
          for (let k = 0; k < NSEG; k++) { const s = t.segs[k]; t.boxes[k] = ctx.collision.addBox({ x: s.x, z: s.z, hw: HALF_W, hd: SEG_LEN / 2, rot: Math.atan2(-s.fx, -s.fz), bottom: s.y - 0.5, top: s.y + 3.4, tag: 'tram' }); }
        }
      } else if (t.boxes[0]) removeBoxes(t);
    }
  }

  return {
    update, list, lines: pieces.length,
    get active() { let n = 0; for (const t of trams) if (t.active) n++; return n; },
    dispose() { for (const t of trams) { deactivate(t); for (const s of t.segs) s.mesh.removeFromParent(); } },
  };
}

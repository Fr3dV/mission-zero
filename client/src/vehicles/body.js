// Générateur de carrosserie procédurale : surface « loftée » à partir de courbes de profil
// (ligne de toit, ligne de caisse, soubassement, vue en plan), passages de roue creusés,
// vitrage, optiques et détails projetés sur la surface (décalcomanies conformes).
import * as THREE from 'three';
import { curve, clamp, lerp, smoothstep, GeoBuilder, mat } from './geo.js';
import { ATLAS_UV, CH } from './materials.js';
import { addWheel } from './wheels.js';

const ROWS = 15;
const GLASS = { color: 0x2b3038, rough: 0.05, metal: 0.88 };
const TRIM = { color: 0x08090a, rough: 0.12, metal: 0.3 };
const DARK = { color: 0x0a0a0b, rough: 0.75, metal: 0 };
const DEFAULT_PLAN = [[0, 0.58], [0.008, 0.72], [0.03, 0.84], [0.07, 0.925], [0.15, 0.985], [0.3, 1], [0.8, 1], [0.92, 0.975], [0.965, 0.92], [0.99, 0.82], [1, 0.7]];

/** Normales lissées avec seuil d'arête vive. pos : tableau plat de triangles non indexés. */
function creasedNormals(pos, cosA) {
  const nt = pos.length / 9;
  const fw = new Float32Array(nt * 3), fu = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2];
    const bx = pos[o + 6] - pos[o], by = pos[o + 7] - pos[o + 1], bz = pos[o + 8] - pos[o + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    fw[t * 3] = nx; fw[t * 3 + 1] = ny; fw[t * 3 + 2] = nz;
    fu[t * 3] = nx / l; fu[t * 3 + 1] = ny / l; fu[t * 3 + 2] = nz / l;
  }
  const map = new Map();
  const key = (i) => Math.round(pos[i] * 2000) + '_' + Math.round(pos[i + 1] * 2000) + '_' + Math.round(pos[i + 2] * 2000);
  const keys = new Array(nt * 3);
  for (let c = 0; c < nt * 3; c++) { const k = key(c * 3); keys[c] = k; let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(c); }
  const out = new Float32Array(nt * 9);
  for (let c = 0; c < nt * 3; c++) {
    const t = (c / 3) | 0, ux = fu[t * 3], uy = fu[t * 3 + 1], uz = fu[t * 3 + 2];
    let nx = 0, ny = 0, nz = 0;
    for (const c2 of map.get(keys[c])) {
      const t2 = (c2 / 3) | 0;
      if (ux * fu[t2 * 3] + uy * fu[t2 * 3 + 1] + uz * fu[t2 * 3 + 2] >= cosA) { nx += fw[t2 * 3]; ny += fw[t2 * 3 + 1]; nz += fw[t2 * 3 + 2]; }
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    out[c * 3] = nx / l; out[c * 3 + 1] = ny / l; out[c * 3 + 2] = nz / l;
  }
  return out;
}

/** Profil paramétrique d'un véhicule : sections transversales et projections sur la surface. */
export function makeProfile(spec, def) {
  const L = spec.length, hw = spec.width / 2;
  const top = curve(def.top), beltC = curve(def.belt), bottom = curve(def.bottom), plan = curve(def.plan || DEFAULT_PLAN);
  const beltIn = curve(def.beltIn || [[0, 0.03], [1, 0.03]]);
  const tum = def.tum ?? 0.42, tuck = def.tuck ?? 0.025, roofMin = hw * (def.roofW ?? 0.5), hoodP = def.hoodP ?? 2.2, sideMid = def.sideMid ?? 0.4;
  const R = def.wheelR, tireW = def.tireW, gap = def.archGap ?? 0.05, Ra = R + gap;
  const zOf = (t) => (t - 0.5) * L, tOf = (z) => z / L + 0.5;
  const axles = [def.axleF, def.axleR].map((t) => ({ t, z: zOf(t) }));
  const crestR = Ra + (def.archCrest ?? 0.03);
  // la ligne de caisse passe toujours au-dessus des passages de roue (galbe d'aile automatique)
  const belt = (t) => {
    let y = beltC(t);
    const z = zOf(t);
    for (const a of axles) { const dz = z - a.z; if (Math.abs(dz) < crestR) y = Math.max(y, R + Math.sqrt(crestR * crestR - dz * dz)); }
    return y;
  };
  const flare = def.flare ?? 0.02;
  /** Élargissement d'aile autour des passages de roue au point (z, y). */
  const flareAt = (z, y) => {
    let f = 0;
    for (const a of axles) {
      const dz = z - a.z, dy = y - R;
      const dist = dy >= 0 ? Math.hypot(dz, dy) : Math.abs(dz);
      if (dist < Ra + 0.12 && dy > -0.2) f = Math.max(f, flare * Math.min(1, 1 - (dist - Ra) / 0.12));
    }
    return f;
  };
  const HX = [1, 0.93, 0.84, 0.74, 0.5, 0.25, 0];

  /** Demi-section (x ≥ 0) à l'abscisse t : écrit 15 points [x,y] dans o. */
  function section(t, o) {
    const w = hw * plan(t), yb = bottom(t);
    let ybelt = belt(t); const ytop = top(t);
    if (ybelt < yb + 0.06) ybelt = yb + 0.06;
    const ins = Math.min(beltIn(t), w * 0.5), wb = w - ins, sh = ybelt - yb, h = ytop - ybelt;
    const x1 = Math.max(0, Math.min(w * 0.8, w - (tireW + 0.1)));
    o[0] = 0; o[1] = yb;
    o[2] = x1; o[3] = yb;
    o[4] = Math.max(x1, w - tuck - 0.04); o[5] = yb + 0.012;
    o[6] = w - tuck; o[7] = yb + Math.min(0.09, sh * 0.2);
    o[8] = w; o[9] = yb + sh * sideMid;
    o[10] = w - ins * 0.12; o[11] = yb + sh * 0.64;
    o[12] = w - ins * 0.5; o[13] = yb + sh * 0.86;
    o[14] = wb + ins * 0.1; o[15] = yb + sh * 0.975;
    o[16] = wb; o[17] = ybelt;
    // partie haute : forme « capot » (arche) fondue vers la forme « habitacle » (vitre latérale + pavillon)
    const f = smoothstep(0.03, 0.22, h), hp = Math.max(h, 0);
    const d10 = Math.min(0.15 * hp, 0.075), d11 = Math.min(0.06 * hp, 0.03), d12 = Math.min(0.02 * hp, 0.009), d13 = Math.min(0.005 * hp, 0.002);
    const y10 = ytop - d10, hg = Math.max(0, y10 - ybelt);
    const wr = Math.min(wb, Math.max(roofMin, wb - tum * hg));
    const CX = [wb, (wb + wr) / 2 + 0.012, wr, wr - 0.045, wr * 0.6, wr * 0.3, 0];
    const CY = [ybelt, ybelt + hg * 0.5, y10, ytop - d11, ytop - d12, ytop - d13, ytop];
    for (let k = 1; k < 7; k++) {
      const hx = wb * HX[k], hy = ybelt + h * (1 - Math.pow(HX[k], hoodP));
      o[16 + k * 2] = lerp(hx, CX[k], f); o[17 + k * 2] = lerp(hy, CY[k], f);
    }
    return o;
  }
  const S = new Float64Array(ROWS * 2);

  /** x de la face latérale à (t, y) ; null hors carrosserie. */
  function xAt(t, y) {
    section(t, S);
    let best = null;
    for (let j = 0; j < ROWS - 1; j++) {
      const y0 = S[j * 2 + 1], y1 = S[j * 2 + 3];
      if ((y0 <= y && y <= y1) || (y1 <= y && y <= y0)) {
        const x = Math.abs(y1 - y0) < 1e-9 ? Math.max(S[j * 2], S[j * 2 + 2]) : S[j * 2] + ((y - y0) / (y1 - y0)) * (S[j * 2 + 2] - S[j * 2]);
        if (best === null || x > best) best = x;
      }
    }
    return best;
  }
  /** y du dessus de la carrosserie à (t, |x|). */
  function yTopAt(t, ax) {
    section(t, S);
    let best = null;
    for (let j = 4; j < ROWS - 1; j++) {
      const x0 = S[j * 2], x1 = S[j * 2 + 2];
      if ((x0 <= ax && ax <= x1) || (x1 <= ax && ax <= x0)) {
        const y = Math.abs(x1 - x0) < 1e-9 ? Math.max(S[j * 2 + 1], S[j * 2 + 3]) : S[j * 2 + 1] + ((ax - x0) / (x1 - x0)) * (S[j * 2 + 3] - S[j * 2 + 1]);
        if (best === null || y > best) best = y;
      }
    }
    return best;
  }
  function inside(t, ax, y) {
    section(t, S);
    let c = false;
    for (let j = 0; j < ROWS - 1; j++) {
      const yj = S[j * 2 + 1], yk = S[j * 2 + 3];
      if ((yj > y) !== (yk > y)) { const xi = S[j * 2] + ((y - yj) / (yk - yj)) * (S[j * 2 + 2] - S[j * 2]); if (xi > ax) c = !c; }
    }
    return c;
  }
  /** z de la surface vue de face (dir = +1) ou de l'arrière (dir = -1) au point (x, y). */
  function zFace(x, y, dir) {
    const ax = Math.abs(x), t0 = dir > 0 ? 0 : 1, step = 0.006 * dir;
    if (inside(t0, ax, y)) return zOf(t0);
    let t = t0, n = 0;
    do { t += step; n++; } while (n < 90 && !inside(t, ax, y));
    if (n >= 90) return null;
    let lo = t - step, hi = t;
    for (let k = 0; k < 11; k++) { const m = (lo + hi) / 2; if (inside(m, ax, y)) hi = m; else lo = m; }
    return zOf(hi);
  }
  return { L, hw, top, belt, bottom, plan, section, xAt, yTopAt, zFace, zOf, tOf, R, tireW, Ra, axles, def, spec, flare, flareAt };
}

// ---------------------------------------------------------------------------------------------
// Décalcomanies conformes : formes 2D projetées sur la carrosserie.
function shapeGrids(d) {
  // retourne une liste de grilles {nu, nv, pt(u,v) -> [a,b]}
  if (d.ell) {
    const [cx, cy, rx, ry] = d.ell, n = d.n ?? 2, rot = d.rot ?? 0, cr = Math.cos(rot), sr = Math.sin(rot);
    const sc = (v) => Math.sign(v) * Math.pow(Math.abs(v), 2 / n);
    return [{ nu: d.rings ?? 3, nv: d.seg ?? 20, pt: (u, v) => { const a = v * Math.PI * 2, px = rx * u * sc(Math.cos(a)), py = ry * u * sc(Math.sin(a)); return [cx + px * cr - py * sr, cy + px * sr + py * cr]; } }];
  }
  const quads = d.quad ? [d.quad] : [];
  if (d.strip) for (let i = 0; i < d.strip.length - 1; i++) { const a = d.strip[i], b = d.strip[i + 1]; quads.push([[a[0], a[1]], [b[0], b[1]], [b[2], b[3]], [a[2], a[3]]]); }
  if (d.rect) { const [cx, cy, w, h] = d.rect, k = d.skew ?? 0; quads.push([[cx - w / 2 - k, cy - h / 2], [cx + w / 2 - k, cy - h / 2], [cx + w / 2 + k, cy + h / 2], [cx - w / 2 + k, cy + h / 2]]); }
  const [nu, nv] = d.sub ?? [6, 3];
  return quads.map((q) => ({ nu, nv, pt: (u, v) => [lerp(lerp(q[0][0], q[1][0], u), lerp(q[3][0], q[2][0], u), v), lerp(lerp(q[0][1], q[1][1], u), lerp(q[3][1], q[2][1], u), v)] }));
}

const PROJ_DIR = { front: [0, 0, -1], rear: [0, 0, 1], side: [1, 0, 0], top: [0, 1, 0] };

function addDecal(P, d, out) {
  const proj = d.p || 'front';
  const project = (a, b) => {
    if (proj === 'front' || proj === 'rear') { const z = P.zFace(a, b, proj === 'front' ? 1 : -1); return z === null ? null : [a, b, z]; }
    if (proj === 'side') { const x = P.xAt(P.tOf(a), b); return x === null ? null : [x + P.flareAt(a, b), b, a]; }
    const y = P.yTopAt(P.tOf(b), Math.abs(a)); return y === null ? null : [a, y, b];
  };
  const dir = PROJ_DIR[proj], lift = d.lift ?? 0.006;
  const target = d.m === 'light' ? out.lights : out.decals;
  const style = { color: d.c ?? 0x050505, rough: d.r ?? (d.m === 'light' ? 0.2 : 0.6), metal: d.mt ?? 0 };
  const uvRect = d.plate != null ? ATLAS_UV.plates[d.plate % ATLAS_UV.plates.length] : null;
  for (const g of shapeGrids(d)) {
    const { nu, nv } = g, W = nv + 1;
    const pts = [], nrm = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const [a, b] = g.pt(i / nu, j / nv); pts.push(project(a, b)); nrm.push([0, 0, 0]); }
    const tris = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = i * W + j, b = (i + 1) * W + j, c = (i + 1) * W + j + 1, e = i * W + j + 1;
      for (const [p, q, r] of [[a, b, c], [a, c, e]]) {
        const A = pts[p], B = pts[q], C = pts[r];
        if (!A || !B || !C) continue;
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (Math.hypot(nx, ny, nz) < 1e-10) continue;
        const flip = nx * dir[0] + ny * dir[1] + nz * dir[2] < 0;
        if (flip) { nx = -nx; ny = -ny; nz = -nz; }
        tris.push(flip ? [p, r, q] : [p, q, r]);
        for (const k of [p, q, r]) { nrm[k][0] += nx; nrm[k][1] += ny; nrm[k][2] += nz; }
      }
    }
    for (const n of nrm) { const l = Math.hypot(n[0], n[1], n[2]) || 1; n[0] /= l; n[1] /= l; n[2] /= l; }
    const sides = d.center ? [1] : [1, -1];
    for (const s of sides) {
      const st = { ...style, ch: d.ch === 'blink' ? (s > 0 ? CH.BLINK_R : CH.BLINK_L) : d.ch ?? 0 };
      for (const t of tris) {
        const idx = s > 0 ? t : [t[0], t[2], t[1]];
        const p = [], n = [], uv = uvRect ? [] : null;
        for (const k of idx) {
          const q = pts[k], m = nrm[k];
          p.push(s * (q[0] + m[0] * lift), q[1] + m[1] * lift, q[2] + m[2] * lift); n.push(s * m[0], m[1], m[2]);
          if (uv) { const i = Math.floor(k / W), j = k % W; uv.push(lerp(uvRect[0], uvRect[2], i / nu), lerp(uvRect[1], uvRect[3], j / nv)); }
        }
        target.tri(p, n, st, uv);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
/**
 * Construit les géométries d'un véhicule.
 * @returns {{paint, misc, lights, wheelGeo:[avant, arrière], wheels:[{x,y,z,R,front,side}], info}}
 */
export function buildCar(spec, def, lod = false, shared = null) {
  const P = shared?.P || makeProfile(spec, def);
  const { L, hw, section, zOf, R, tireW, Ra } = P;
  const paint = new GeoBuilder(), misc = new GeoBuilder();
  const out = shared?.out || { lights: new GeoBuilder(), decals: new GeoBuilder() };
  const cab = def.cabin;

  // ---- stations longitudinales
  const feat = [];
  const addF = (t) => { if (t != null && t >= 0 && t <= 1) feat.push(t); };
  const N = lod ? 12 : 46;
  [0, 0.004, 0.012, 0.026, 0.05, 0.95, 0.974, 0.988, 0.996, 1].forEach((t, i) => { if (!lod || i % 2 === 0 || i === 9) addF(t); });
  [cab.cowl, cab.wsTop, cab.rearTop, cab.rearBot, ...(def.sideGlass || []), ...(def.roofGlass || [])].forEach(addF);
  for (const p of def.pillars || []) { addF(p[0]); addF(p[1]); }
  for (const p of def.top) if (p[2] === 's') addF(p[0]);
  for (const p of def.belt) if (p[2] === 's') addF(p[0]);
  const na = lod ? 5 : 18;
  for (const a of P.axles) for (let k = 1; k < na; k++) addF(P.tOf(a.z - Math.cos((k / na) * Math.PI) * Ra));
  for (const a of P.axles) { addF(P.tOf(a.z - Ra * 1.12)); addF(P.tOf(a.z + Ra * 1.12)); addF(P.tOf(a.z - Ra * 1.3)); addF(P.tOf(a.z + Ra * 1.3)); }
  feat.sort((a, b) => a - b);
  let base = [];
  const minGap = lod ? 0.02 : 0.006;
  for (const t of feat) if (!base.length || t - base[base.length - 1] > 0.0015) base.push(t);
  for (let i = 1; i < N; i++) { const t = i / N; if (base.every((s) => Math.abs(s - t) > minGap * 1.6)) base.push(t); }
  // bords des passages de roue : station dédoublée (extérieur / intérieur du passage)
  const edges = [];
  for (let ai = 0; ai < 2; ai++) { const a = P.axles[ai]; edges.push(P.tOf(a.z - Ra), P.tOf(a.z + Ra)); }
  base = base.filter((t) => edges.every((e) => Math.abs(e - t) > 0.002));
  const stList = base.map((t) => ({ t, k: t, inner: false }));
  for (let ai = 0; ai < 2; ai++) {
    const tA = edges[ai * 2], tB = edges[ai * 2 + 1];
    stList.push({ t: tA, k: tA - 1e-7, inner: false }, { t: tA, k: tA + 1e-7, inner: true }, { t: tB, k: tB - 1e-7, inner: true }, { t: tB, k: tB + 1e-7, inner: false });
  }
  stList.sort((a, b) => a.k - b.k);
  const stations = stList.map((s) => s.t);
  const NS = stations.length;

  // ---- grille de sommets (demi-caisse x ≥ 0) ; dans les passages de roue, les rangées basses
  //      remontent sur l'arc du passage (découpe nette, lèvre de passage incluse)
  const V = new Float32Array(NS * ROWS * 3), inZ = new Uint8Array(NS);
  const perim = new Float32Array(NS * ROWS);
  const S = new Float64Array(ROWS * 2);
  const flare = P.flare;
  const xOnSide = (y) => { // x du flanc (rangées 3..8) à la hauteur y
    for (let j = 3; j < 8; j++) { const y0 = S[j * 2 + 1], y1 = S[j * 2 + 3]; if (y <= y1 || j === 7) { const u = clamp((y - y0) / Math.max(1e-6, y1 - y0), 0, 1); return lerp(S[j * 2], S[j * 2 + 2], u); } }
    return S[16];
  };
  for (let i = 0; i < NS; i++) {
    section(stations[i], S);
    const z0 = zOf(stations[i]);
    let arch = null, dzA = 0;
    for (const a of P.axles) { const dz = z0 - a.z; if (Math.abs(dz) < Ra - 1e-5 || (stList[i].inner && Math.abs(Math.abs(dz) - Ra) < 1e-4)) { arch = a; dzA = dz; } }
    const yb = S[1], ybelt = S[17];
    let acc = 0, px = 0, py = 0;
    for (let j = 0; j < ROWS; j++) {
      let x = S[j * 2], y = S[j * 2 + 1];
      if (j >= 2 && j <= 7) {
        if (arch) {
          const yA = R + Math.sqrt(Math.max(0, Ra * Ra - dzA * dzA));
          if (j <= 3) { y = yA; x = xOnSide(yA) + flare - (j === 2 ? 0.03 : 0); }
          else { const fr = (y - yb) / (ybelt - yb); y = yA + ((fr - 0.2) / 0.8) * (ybelt - yA); x = xOnSide(y) + P.flareAt(z0, y); }
        } else {
          x += P.flareAt(z0, y);
        }
      }
      if (j > 0) acc += Math.hypot(x - px, y - py);
      px = x; py = y;
      perim[i * ROWS + j] = acc;
      V[(i * ROWS + j) * 3] = x; V[(i * ROWS + j) * 3 + 1] = y; V[(i * ROWS + j) * 3 + 2] = z0;
    }
    if (arch) inZ[i] = 1;
  }

  // ---- triangles + étiquette matériau
  const pos = [], uvs = [], tags = [];
  const inRange = (t, r) => r && t >= r[0] && t <= r[1];
  const clad = def.clad || [];
  const bandTag = (j, t) => {
    if (j === 0) return 'dark';
    let cmax = def.cladBase ?? 1;
    for (const c of clad) if (t >= c[0] && t <= c[1]) cmax = Math.max(cmax, c[2]);
    if (j <= cmax) return 'dark';
    if (j === 8 || j === 9) {
      if (inRange(t, def.sideGlass)) { for (const p of def.pillars || []) if (inRange(t, p)) return 'trim'; return 'glass'; }
      return 'paint';
    }
    if (j >= 11) {
      if (t > cab.cowl && t < cab.wsTop) return 'glass';
      if (cab.rearTop != null && t > cab.rearTop && t < cab.rearBot) return 'glass';
      if (inRange(t, def.roofGlass)) return 'glass';
    }
    return 'paint';
  };
  const pushV = (i, j) => { const o = (i * ROWS + j) * 3; pos.push(V[o], V[o + 1], V[o + 2]); uvs.push(V[o + 2] * 7, perim[i * ROWS + j] * 7); };
  for (let i = 0; i < NS - 1; i++) {
    const tm = (stations[i] + stations[i + 1]) / 2;
    for (let j = 0; j < ROWS - 1; j++) {
      const a = i * ROWS + j, b = a + ROWS;
      if (j === 1 && inZ[i] && inZ[i + 1]) continue;                               // dessous du passage
      const tag = bandTag(j, tm);
      pushV(i, j); pushV(i + 1, j); pushV(i + 1, j + 1); tags.push(tag);
      pushV(i, j); pushV(i + 1, j + 1); pushV(i, j + 1); tags.push(tag);
    }
  }
  // orientation globale (volume signé positif = normales sortantes)
  let vol = 0;
  for (let o = 0; o < pos.length; o += 9) {
    vol += pos[o] * (pos[o + 4] * pos[o + 8] - pos[o + 5] * pos[o + 7]) - pos[o + 1] * (pos[o + 3] * pos[o + 8] - pos[o + 5] * pos[o + 6]) + pos[o + 2] * (pos[o + 3] * pos[o + 7] - pos[o + 4] * pos[o + 6]);
  }
  const swap = (arr, o, n) => { for (let k = 0; k < n; k++) { const tmp = arr[o + n + k]; arr[o + n + k] = arr[o + 2 * n + k]; arr[o + 2 * n + k] = tmp; } };
  if (vol < 0) for (let t = 0; t < tags.length; t++) { swap(pos, t * 9, 3); swap(uvs, t * 6, 2); }
  // faces avant/arrière (éventails)
  for (const [i, dirz] of [[0, -1], [NS - 1, 1]]) {
    const o0 = i * ROWS * 3, cy = (V[o0 + 1] + V[o0 + (ROWS - 1) * 3 + 1]) / 2, cz = V[o0 + 2];
    for (let j = 0; j < ROWS - 1; j++) {
      const a = o0 + j * 3, b = a + 3;
      // normale attendue : dirz ; (c, a, b) en x ≥ 0 → (b-a)×... on teste le signe
      const nz = (V[a] - 0) * (V[b + 1] - cy) - (V[a + 1] - cy) * (V[b] - 0);
      const tag = 'paint';
      if (nz * dirz > 0) { pos.push(0, cy, cz, V[a], V[a + 1], V[a + 2], V[b], V[b + 1], V[b + 2]); uvs.push(0, cy * 7, V[a] * 7, V[a + 1] * 7, V[b] * 7, V[b + 1] * 7); }
      else { pos.push(0, cy, cz, V[b], V[b + 1], V[b + 2], V[a], V[a + 1], V[a + 2]); uvs.push(0, cy * 7, V[b] * 7, V[b + 1] * 7, V[a] * 7, V[a + 1] * 7); }
      tags.push(tag);
    }
  }
  // suppression des triangles dégénérés
  const fp = [], fuv = [], ftag = [];
  for (let t = 0; t < tags.length; t++) {
    const o = t * 9;
    const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2], bx = pos[o + 6] - pos[o], by = pos[o + 7] - pos[o + 1], bz = pos[o + 8] - pos[o + 2];
    if (Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) < 1e-9) continue;
    for (let k = 0; k < 9; k++) fp.push(pos[o + k]);
    for (let k = 0; k < 6; k++) fuv.push(uvs[t * 6 + k]);
    ftag.push(tags[t]);
  }
  // miroir
  const nh = ftag.length;
  for (let t = 0; t < nh; t++) {
    const o = t * 9, u = t * 6;
    fp.push(-fp[o], fp[o + 1], fp[o + 2], -fp[o + 6], fp[o + 7], fp[o + 8], -fp[o + 3], fp[o + 4], fp[o + 5]);
    fuv.push(fuv[u], fuv[u + 1], fuv[u + 4], fuv[u + 5], fuv[u + 2], fuv[u + 3]);
    ftag.push(ftag[t]);
  }
  const fn = creasedNormals(fp, Math.cos(((def.crease ?? 52) * Math.PI) / 180));
  const STY = { glass: GLASS, trim: TRIM, dark: DARK };
  for (let t = 0; t < ftag.length; t++) {
    const p = fp.slice(t * 9, t * 9 + 9), n = fn.subarray(t * 9, t * 9 + 9);
    if (ftag[t] === 'paint') paint.tri(p, n, {}, fuv.slice(t * 6, t * 6 + 6));
    else misc.tri(p, n, STY[ftag[t]]);
  }

  // ---- roues (positions) et passages de roue (coquilles sombres)
  const wheels = [];
  for (let ai = 0; ai < 2; ai++) {
    const a = P.axles[ai];
    const wSide = hw * P.plan(a.t);
    const wx = wSide + flare - tireW / 2 - (def.wheelInset ?? 0.03);
    for (const s of [-1, 1]) wheels.push({ x: s * wx, y: R, z: a.z, R, front: ai === 0, side: s });
    const xin = Math.max(0, Math.min(wSide * 0.8, wSide - (tireW + 0.1)));
    const yb = P.bottom(a.t);
    const nseg = lod ? 6 : 18;
    const ring = [];
    ring.push([a.z + Ra, yb]);
    for (let k = 0; k <= nseg; k++) { const an = (k / nseg) * Math.PI; ring.push([a.z + Math.cos(an) * Ra, R + Math.sin(an) * Ra]); }
    ring.push([a.z - Ra, yb]);
    for (const s of [-1, 1]) {
      const m = new THREE.Matrix4().makeScale(s, 1, 1);
      const g = new GeoBuilder();
      for (let k = 0; k < ring.length - 1; k++) {
        const [z0, y0] = ring[k], [z1, y1] = ring[k + 1];
        const xo0 = (P.xAt(P.tOf(z0), Math.max(y0, yb + 0.02)) ?? wSide) + flare - 0.03, xo1 = (P.xAt(P.tOf(z1), Math.max(y1, yb + 0.02)) ?? wSide) + flare - 0.03;
        // bande intérieure (normale vers le centre de la roue)
        const nz0 = -(z0 - a.z) / Ra, ny0 = -(y0 - R) / Ra, nz1 = -(z1 - a.z) / Ra, ny1 = -(y1 - R) / Ra;
        g.tri([xo0, y0, z0, xin, y0, z0, xin, y1, z1], [0, ny0, nz0, 0, ny0, nz0, 0, ny1, nz1], DARK);
        g.tri([xo0, y0, z0, xin, y1, z1, xo1, y1, z1], [0, ny0, nz0, 0, ny1, nz1, 0, ny1, nz1], DARK);
        // paroi intérieure
        g.tri([xin, yb, a.z, xin, y1, z1, xin, y0, z0], [1, 0, 0, 1, 0, 0, 1, 0, 0], DARK);
      }
      // GeoBuilder.add gère l'inversion d'enroulement pour le miroir
      misc.add(g.build([]), m, DARK);
    }
    // étriers de frein (statiques)
    if (!lod && def.caliper != null) {
      const rimR = R * (def.wheel?.rimRatio ?? 0.7);
      for (const s of [-1, 1]) {
        const dirz = ai === 0 ? 1 : -1, ang = 0.95, rr = rimR * 0.62; // derrière l'axe à l'avant, devant à l'arrière
        misc.add(new THREE.BoxGeometry(0.07, 0.085, rimR * 0.72), mat(s * (wx + tireW * 0.1), R + Math.cos(ang) * rr, a.z + dirz * Math.sin(ang) * rr, dirz * ang, 0, 0), { color: def.caliper, rough: 0.35, metal: 0.3 });
      }
    }
  }

  // ---- détails projetés (optiques, prises d'air, plaques, joints) — construits une seule fois (partagés avec le LOD)
  if (!shared) {
    for (const d of def.decals || []) addDecal(P, d, out);
    const seam = { color: 0x030303, rough: 0.9, metal: 0 };
    for (const t of def.seams || []) {
      const z = zOf(t), y0 = P.bottom(t) + 0.1, y1 = P.belt(t) - 0.012;
      addDecal(P, { p: 'side', quad: [[z - 0.004, y0], [z + 0.004, y0], [z + 0.004, y1], [z - 0.004, y1]], sub: [1, 10], c: seam.color, r: 0.9, lift: 0.002 }, out);
    }
    for (const t of def.handles || []) {
      const z = zOf(t), y = P.belt(t) - (def.handleDrop ?? 0.075);
      addDecal(P, { p: 'side', ell: [z, y, 0.085, 0.016], n: 4, rings: 1, seg: 12, c: def.handleColor ?? 0x0a0a0a, r: 0.25, mt: def.handleMetal ?? 0.2, lift: 0.004 }, out);
    }
    if (def.archTrim) {
      for (const a of P.axles) {
        const strip = [];
        for (let k = 0; k <= 22; k++) { const an = -0.5 + (k / 22) * (Math.PI + 1.0); const c = Math.cos(an), s = Math.sin(an); strip.push([a.z + c * (Ra + 0.002), R + s * (Ra + 0.002), a.z + c * (Ra + def.archTrim), R + s * (Ra + def.archTrim)]); }
        addDecal(P, { p: 'side', strip, sub: [1, 2], c: 0x0b0b0c, r: 0.7, lift: 0.004 }, out);
      }
    }
    // plaques d'immatriculation
    const pl = def.plates || {};
    const plate = (proj, y, idx) => {
      const w = 0.26, h = 0.055, s = proj === 'front' ? 1 : -1;
      addDecal(P, { p: proj, center: true, quad: [[s * w, y - h], [-s * w, y - h], [-s * w, y + h], [s * w, y + h]], sub: [8, 2], c: 0xffffff, r: 0.45, plate: idx, lift: 0.009 }, out);
    };
    if (pl.front != null) plate('front', pl.front, def.plateIdx ?? 0);
    if (pl.rear != null) plate('rear', pl.rear, def.plateIdx ?? 0);
    addExtras(P, def, paint, out);
    out.extraPaint = new GeoBuilder();
    addPaintExtras(P, def, out.extraPaint, out);
  }
  paint.append(out.extraPaint);
  misc.append(out.decals);

  let wheelGeo = null;
  const wopt = { R, W: tireW, ...(def.wheel || {}) };
  if (lod) for (const w of wheels) addWheel(misc, { ...wopt, lod: true }, mat(w.x, w.y, w.z, 0, w.side > 0 ? 0 : Math.PI, 0));
  else { const b = new GeoBuilder(); addWheel(b, wopt, null); wheelGeo = b.build(['uv', 'color', 'pbr']); }

  return {
    P, out, wheels, wheelGeo,
    paint: paint.build(['uv']),
    misc: misc.build(['uv', 'color', 'pbr']),
    lights: shared ? null : out.lights.build(['uv', 'color', 'lch']),
  };
}

// ---------------------------------------------------------------------------------------------
// Éléments rapportés non peints : sorties d'échappement, lumineux taxi, aileron sombre…
function addExtras(P, def, paint, out) {
  const { decals, lights } = out;
  const chrome = { color: 0xd7d9dc, rough: 0.12, metal: 1 };
  for (const e of def.exhausts || []) {
    for (const s of e.center ? [1] : [-1, 1]) {
      const z = P.zFace(e.x, e.y, -1) ?? P.zOf(1);
      const r = e.r ?? 0.045;
      const g = new THREE.CylinderGeometry(r, r, 0.09, e.hex ? 6 : 14, 1, true);
      decals.add(g, mat(s * e.x, e.y, z - 0.012, Math.PI / 2, 0, 0, e.sx ?? 1, 1, 1), e.dark ? { color: 0x18191b, rough: 0.3, metal: 0.9 } : chrome);
      decals.add(new THREE.CircleGeometry(r * 0.92, e.hex ? 6 : 14), mat(s * e.x, e.y, z + 0.005, 0, 0, 0, e.sx ?? 1, 1, 1), { color: 0x020202, rough: 0.9, metal: 0 });
    }
  }
  if (def.taxiSign) {
    const t = def.taxiSign.t ?? 0.47, y = P.top(t) + 0.005, z = P.zOf(t);
    const w = 0.4, h = 0.13, dp = 0.13;
    decals.add(new THREE.BoxGeometry(w + 0.06, 0.02, dp + 0.05), mat(0, y + 0.01, z), { color: 0x0c0c0d, rough: 0.5, metal: 0 });
    decals.add(new THREE.BoxGeometry(w, h, dp), mat(0, y + 0.02 + h / 2, z), { color: 0xe9e6da, rough: 0.35, metal: 0 });
    const st = { color: 0xffffff, ch: CH.SIGN };
    lights.add(new THREE.PlaneGeometry(w - 0.02, h - 0.02), mat(0, y + 0.02 + h / 2, z - dp / 2 - 0.002, 0, Math.PI, 0), { ...st, uv: { rect: ATLAS_UV.taxi } });
    lights.add(new THREE.PlaneGeometry(w - 0.02, h - 0.02), mat(0, y + 0.02 + h / 2, z + dp / 2 + 0.002), { ...st, uv: { rect: ATLAS_UV.taxi } });
  }
  if (def.extras) def.extras({ P, decals, lights, mat, THREE, CH });
}

// Éléments rapportés peints : rétroviseurs, aileron.
function addPaintExtras(P, def, paint, out) {
  const { decals } = out;
  if (def.mirrors !== false) {
    const cab = def.cabin, mo = def.mirrors || {};
    const t = cab.cowl + (mo.dt ?? 0.045), z = P.zOf(t);
    const S = P.section(t, new Float64Array(ROWS * 2));
    const xb = S[16], y = S[17] + (mo.dy ?? 0.055);
    for (const s of [-1, 1]) {
      const g = new THREE.SphereGeometry(1, 12, 8);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) p.setZ(i, p.getZ(i) * 0.3);
      g.computeVertexNormals();
      const sx = mo.sx ?? 0.1, sy = mo.sy ?? 0.062, sz = mo.sz ?? 0.07;
      paint.add(g, mat(s * (xb + 0.115), y + 0.02, z, 0, s * -0.12, 0, sx, sy, sz), {});
      decals.add(new THREE.CircleGeometry(1, 14), mat(s * (xb + 0.115), y + 0.02, z + sz * 0.3 + 0.002, 0, s * -0.12, 0, sx * 0.86, sy * 0.82, 1), { color: 0xaab4c0, rough: 0.03, metal: 1 });
      decals.add(new THREE.BoxGeometry(0.1, 0.022, 0.05), mat(s * (xb + 0.04), y - 0.012, z, 0, 0, s * 0.25), { color: 0x0a0a0b, rough: 0.4, metal: 0 });
    }
  }
  if (def.wing) {
    const w = def.wing, t = w.t, z = P.zOf(t), span = P.hw * 2 * (w.span ?? 0.82), chord = w.chord ?? 0.26;
    const yBase = P.top(t), y = yBase + (w.h ?? 0.12);
    const target = w.dark ? decals : paint;
    const st = w.dark ? { color: 0x0b0b0c, rough: 0.35, metal: 0.1 } : {};
    const g = new THREE.BoxGeometry(span, 0.022, chord, 8, 1, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / (span / 2), v = p.getZ(i) / (chord / 2);
      p.setY(i, p.getY(i) * (1 - 0.5 * Math.abs(v)) + 0.03 * v * (w.rake ?? 1) - 0.03 * u * u * (w.droop ?? 0));
      p.setZ(i, p.getZ(i) + Math.abs(u) * Math.abs(u) * (w.sweep ?? 0.03));
    }
    g.computeVertexNormals();
    target.add(g, mat(0, y, z), st);
    for (const s of [-1, 1]) {
      const px = s * span * (w.posts ?? 0.3);
      const yb = P.yTopAt(t, Math.abs(px)) ?? yBase;
      decals.add(new THREE.BoxGeometry(0.03, Math.max(0.02, y - yb) + 0.02, chord * 0.55), mat(px, (y + yb) / 2 - 0.01, z), { color: 0x0b0b0c, rough: 0.4, metal: 0.1 });
    }
  }
}

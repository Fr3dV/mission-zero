// La Seine : eau (shader), quais maçonnés avec parapets, ponts à arches.
import { L_STONE, L_PLAIN, L_SIDEWALK, L_PAVE, createWaterNormal } from './textures.js';
import { Y_GROUND } from './streets.js';

const QUAY = [214, 206, 190], BRIDGE = [232, 222, 202], COPING = [226, 220, 208];
const Y_QUAY = 0.12, PARAPET_H = 1.02;

export function buildRiver(ctx, net, surf, masks) {
  const { THREE, scene, collision, WATER_LEVEL, heightAt } = ctx;
  const { roads } = net;

  // ---------- 1. tronçons de route au-dessus de l'eau = ponts
  const decks = []; // {r, sa, sb, W}
  const o = { _k: 0 }, o2 = { _k: 0 };
  for (const r of roads) {
    const n = Math.max(1, Math.ceil(r._len / 2));
    let start = -1, last = -1; const iv = [];
    for (let i = 0; i <= n; i++) {
      const s = (r._len * i) / n; net.pointAt(r, s, 0, o);
      if (masks.isWater(o.x, o.z)) { if (start < 0) start = s; last = s; }
      else if (start >= 0 && s - last > 6) { iv.push([start, last]); start = -1; }
    }
    if (start >= 0) iv.push([start, last]);
    for (const [a, b] of iv) {
      if (b - a < 6) continue;
      const W = r._hw + r._sw + (r._sw > 0 ? 0.9 : 0.5);
      decks.push({ r, sa: Math.max(0, a - 3), sb: Math.min(r._len, b + 3), W });
    }
  }
  // grille de points d'axe des tabliers (pour couper les parapets de quai au droit des ponts)
  const dgrid = new Map(), DC = 16;
  const dkey = (x, z) => (Math.floor(x / DC) + 2048) * 4096 + (Math.floor(z / DC) + 2048);
  for (const d of decks) {
    for (let s = d.sa - 6; s <= d.sb + 6; s += 1.5) {
      net.pointAt(d.r, Math.max(0, Math.min(d.r._len, s)), 0, o);
      const k = dkey(o.x, o.z); let a = dgrid.get(k); if (!a) dgrid.set(k, (a = [])); a.push(o.x, o.z, d.W);
    }
  }
  function nearDeck(x, z, pad) {
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      const a = dgrid.get(dkey(x + ix * DC, z + iz * DC)); if (!a) continue;
      for (let i = 0; i < a.length; i += 3) { const lim = a[i + 2] + pad; const dx = a[i] - x, dz = a[i + 1] - z; if (dx * dx + dz * dz < lim * lim) return true; }
    }
    return false;
  }

  // ---------- 2. quais : mur, couronnement, parapet (+ collision) — et berges basses en contrebas
  const probe = Math.max(3, masks.texel * 1.7);
  const addParapetBox = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.3) return;
    collision.addBox({ x: (ax + bx) / 2, z: (az + bz) / 2, hw: len / 2 + 0.15, hd: 0.32, rot: Math.atan2(-(bz - az), bx - ax), top: PARAPET_H + 0.6, tag: 'parapet' });
  };
  /** Mur de collision mince entre deux points, actif seulement pour ce qui est sous `top` (berge) ou partout (top = Infinity). */
  const addWallBox = (ax, az, bx, bz, top, hd = 0.25) => {
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.2) return;
    collision.addBox({ x: (ax + bx) / 2, z: (az + bz) / 2, hw: len / 2 + 0.1, hd, rot: Math.atan2(-(bz - az), bx - ax), top, tag: 'parapet' });
  };
  const B = ctx.BOUNDS, CL = 140;
  const outside = (p) => p[0] < B.minX - CL || p[0] > B.maxX + CL || p[1] < B.minZ - CL || p[1] > B.maxZ + CL;
  const quayPolys = [...masks.riverPolys, ...masks.islands];

  // --- où y a-t-il une berge basse ? tronçons réels (pois.paths riverbank) sinon repli par plages de longitude
  const Y_B = WATER_LEVEL + 1, BW = 9;                       // niveau et largeur de la promenade basse
  const mPerLon0 = 111320 * Math.cos((48.8656 * Math.PI) / 180), lonX0 = (lon) => (lon - 2.3212) * mPerLon0;
  const bankPaths = (Array.isArray(ctx.worldData.pois?.paths) ? ctx.worldData.pois.paths : []).filter((p) => p && p.riverbank && Array.isArray(p.points) && p.points.length >= 2);
  const bankGrid = new Map(), BG = 40, bgk = (x, z) => (Math.floor(x / BG) + 2048) * 4096 + Math.floor(z / BG) + 2048;
  for (const p of bankPaths) for (let i = 0; i + 1 < p.points.length; i++) {
    const a = p.points[i], b = p.points[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 6));
    for (let k = 0; k <= n; k++) { const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n, key = bgk(x, z); let arr = bankGrid.get(key); if (!arr) bankGrid.set(key, (arr = [])); arr.push(x, z); }
  }
  const RB = [[lonX0(2.3015), lonX0(2.3325)], [lonX0(2.341), lonX0(2.3585)]], LB = [[lonX0(2.3015), lonX0(2.3265)], [lonX0(2.343), lonX0(2.357)]];
  function wantBank(x, z, nz) {
    if (bankPaths.length) {
      for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) { const arr = bankGrid.get(bgk(x + ix * BG, z + iz * BG)); if (!arr) continue; for (let i = 0; i < arr.length; i += 2) if ((arr[i] - x) ** 2 + (arr[i + 1] - z) ** 2 < 30 * 30) return true; }
      return false;
    }
    const rng = nz < -0.25 ? RB : nz > 0.25 ? LB : []; for (const [a, b] of rng) if (x > a && x < b) return true; return false;
  }

  // --- pré-passe : pièces de rive (≤ 8 m) dans l'ordre de chaque polygone
  const polyPieces = [];
  for (const poly of quayPolys) {
    const pcs = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if ((outside(a) && outside(b)) || L < 0.5) { pcs.push(null); continue; }
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, m = Math.max(1, Math.ceil(L / 8));
      for (let k = 0; k < m; k++) {
        const t0 = k / m, t1 = (k + 1) / m;
        const ax = a[0] + (b[0] - a[0]) * t0, az = a[1] + (b[1] - a[1]) * t0, bx = a[0] + (b[0] - a[0]) * t1, bz = a[1] + (b[1] - a[1]) * t1;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        let nx = -dz, nz = dx;
        const wP = masks.isWater(mx + nx * probe, mz + nz * probe), wM = masks.isWater(mx - nx * probe, mz - nz * probe);
        if (wP === wM) { pcs.push(null); continue; }
        if (wP) { nx = -nx; nz = -nz; } // (nx,nz) pointe vers la terre
        const pc = { ax, az, bx, bz, mx, mz, nx, nz, dx, dz, len: L / m, u: L * t0, first: k === 0, berge: false, open: false, ua: 0 };
        // berge : donnée réelle proche, assez d'eau devant pour la bande, pas sous un pont (la hauteur du sol est 2D :
        // un même point ne peut pas être à la fois tablier et berge)
        pc.berge = wantBank(mx - nx * 4, mz - nz * 4, nz) && !nearDeck(mx, mz, 3.5) && masks.isWater(mx - nx * (BW + 2), mz - nz * (BW + 2)) && masks.isWater(mx - nx * BW * 0.5, mz - nz * BW * 0.5) && !nearDeck(mx - nx * BW, mz - nz * BW, 3.5);
        pcs.push(pc);
      }
    }
    polyPieces.push(pcs);
  }
  // --- suites de pièces de berge, lignes extérieures en onglet, rampes et escaliers
  const hq = [];                // quads de la couche de hauteur : ax,az,bx,bz,cx,cz,dx,dz,h0,h1 (h0 côté a-d, h1 côté b-c)
  const bergeLamps = [], runsInfo = [];
  let bergeLen = 0, nRamps = 0, nStairs = 0;
  const STONE_B = [206, 198, 182], PAVE_B = [225, 220, 210];
  for (const pcs of polyPieces) {
    let i = 0;
    while (i < pcs.length) {
      if (!pcs[i] || !pcs[i].berge) { i++; continue; }
      let j = i; while (j + 1 < pcs.length && pcs[j + 1] && pcs[j + 1].berge && Math.hypot(pcs[j + 1].ax - pcs[j].bx, pcs[j + 1].az - pcs[j].bz) < 0.5) j++;
      const run = pcs.slice(i, j + 1); i = j + 1;
      let total = 0; for (const pc of run) { pc.ua = total; total += pc.len; }
      if (total < 30) { for (const pc of run) pc.berge = false; continue; }
      bergeLen += total;
      // points extérieurs en onglet (vers l'eau = -n)
      for (let k = 0; k < run.length; k++) {
        const pc = run[k], pv = run[k - 1], nxn = run[k + 1];
        const mit = (q) => { if (!q) return [-pc.nx, -pc.nz]; let mx = -pc.nx - q.nx, mz = -pc.nz - q.nz; const d = 1 + (pc.nx * q.nx + pc.nz * q.nz); const sc = 1 / Math.max(0.5, d); return [mx * sc, mz * sc]; };
        const m0 = mit(pv), m1 = mit(nxn);
        pc.oax = pc.ax + m0[0] * BW; pc.oaz = pc.az + m0[1] * BW; pc.obx = pc.bx + m1[0] * BW; pc.obz = pc.bz + m1[1] * BW;
      }
      // accès : rampe carrossable (palier = 1 pièce au niveau du quai, puis 34 m à ~9 %) et escalier (9 m)
      const structs = [];
      const place = (k, type) => { const pc = run[k]; if (!pc || pc.open || nearDeck(pc.mx, pc.mz, 14) || net.roadAtPad(pc.mx + pc.nx * 0.3, pc.mz + pc.nz * 0.3, 0.6, false)) return false; const L = type === 'ramp' ? 34 : 9; if (pc.ua + pc.len + L > total - 4) return false; pc.open = true; structs.push({ type, s0: pc.ua, land: pc.len, len: L, w: type === 'ramp' ? 5.6 : 2.6 }); if (type === 'ramp') nRamps++; else nStairs++; return true; };
      if (total >= 62) { for (let k = 1; k < run.length && !place(k, 'ramp'); k++); }
      for (let u = 190; u < total - 60; u += 180) { const k = run.findIndex((pc) => pc.ua >= u); if (k > 0) for (let q = k; q < Math.min(run.length, k + 4) && !place(q, (Math.round(u / 180) % 2) ? 'stairs' : 'ramp'); q++); }
      if (total >= 40 && total < 62) for (let k = 1; k < run.length && !place(k, 'stairs'); k++);
      const hAt = (u) => { for (const st of structs) { if (u >= st.s0 - 1e-3 && u <= st.s0 + st.land + st.len + 1e-3) return [u <= st.s0 + st.land ? 0 : Y_B * ((u - st.s0 - st.land) / st.len), st]; } return [Y_B, null]; };
      runsInfo.push({ x: run[0].ax, z: run[0].az, len: Math.round(total), structs: structs.length });
      for (const pc of run) {
        // sous-segments : coupures aux limites des ouvrages
        const cuts = [pc.ua, pc.ua + pc.len];
        for (const st of structs) for (const c of [st.s0, st.s0 + st.land, st.s0 + st.land + st.len]) if (c > pc.ua + 0.05 && c < pc.ua + pc.len - 0.05) cuts.push(c);
        cuts.sort((p, q) => p - q);
        const bld = surf.at(pc.mx, pc.mz);
        const P = (u, f) => { const t = (u - pc.ua) / pc.len, ix = pc.ax + (pc.bx - pc.ax) * t, iz = pc.az + (pc.bz - pc.az) * t, ox = pc.oax + (pc.obx - pc.oax) * t, oz = pc.oaz + (pc.obz - pc.oaz) * t; return [ix + (ox - ix) * f, iz + (oz - iz) * f]; };
        for (let c = 0; c + 1 < cuts.length; c++) {
          const u0 = cuts[c], u1 = cuts[c + 1], um = (u0 + u1) / 2;
          const [, st] = hAt(um); const h0 = st ? hAt(u0 + 1e-3)[0] : Y_B, h1 = st ? hAt(u1 - 1e-3)[0] : Y_B;
          const fw = st ? st.w / BW : 0;
          const a0 = P(u0, 0), b0 = P(u1, 0), a1 = P(u0, 1), b1 = P(u1, 1);
          if (st) {
            const am = P(u0, fw), bm = P(u1, fw);
            // rampe / palier / escalier (bande intérieure) + mur de soutènement côté fleuve
            bld.flatQuad([a0[0], h0 + 0.01, a0[1]], [b0[0], h1 + 0.01, b0[1]], [bm[0], h1 + 0.01, bm[1]], [am[0], h0 + 0.01, am[1]], L_PAVE, 1, PAVE_B);
            hq.push(a0[0], a0[1], b0[0], b0[1], bm[0], bm[1], am[0], am[1], h0, h1);
            bld.wall(am[0], am[1], bm[0], bm[1], Y_B, h0, Y_B, h1, -pc.nx, -pc.nz, L_STONE, STONE_B, u0);
            if (Math.max(h0, h1) > Y_B + 0.4) { bld.prism(am[0], am[1], bm[0], bm[1], 0.35, h0, h1, 0.85, L_STONE, STONE_B, true); addWallBox(am[0], am[1], bm[0], bm[1], Infinity, 0.2); }
            if (st.type === 'stairs' && u0 >= st.s0 + st.land - 0.01) { // marches visibles (la hauteur praticable reste une pente)
              const nS = Math.round((h0 - h1) / 0.17), cm = P(u0, fw / 2), dm = P(u1, fw / 2);
              for (let q = 0; q < nS; q++) { const t = (q + 0.5) / nS; box2(cm[0] + (dm[0] - cm[0]) * t, cm[1] + (dm[1] - cm[1]) * t, pc.dx, pc.dz, (u1 - u0) / nS, st.w, h0 + (h1 - h0) * ((q + 1) / nS), (h0 - h1) / nS + 0.02, L_PLAIN, [214, 208, 196]); }
            }
            // mur d'about du palier (côté début de berge)
            if (Math.abs(u0 - st.s0) < 0.01) { bld.wall(a0[0], a0[1], am[0], am[1], Y_B, 0, Y_B, 0, -pc.dx, -pc.dz, L_STONE, STONE_B, 0); addWallBox(a0[0], a0[1], am[0], am[1], Infinity, 0.2); bld.prism(a0[0], a0[1], am[0], am[1], 0.35, 0, 0, 0.85, L_STONE, STONE_B, true); }
            bld.flatQuad([am[0], Y_B, am[1]], [bm[0], Y_B, bm[1]], [b1[0], Y_B, b1[1]], [a1[0], Y_B, a1[1]], L_PAVE, 1, PAVE_B);
            hq.push(am[0], am[1], bm[0], bm[1], b1[0], b1[1], a1[0], a1[1], Y_B, Y_B);
          } else {
            bld.flatQuad([a0[0], Y_B, a0[1]], [b0[0], Y_B, b0[1]], [b1[0], Y_B, b1[1]], [a1[0], Y_B, a1[1]], L_PAVE, 1, PAVE_B);
            hq.push(a0[0], a0[1], b0[0], b0[1], b1[0], b1[1], a1[0], a1[1], Y_B, Y_B);
          }
          // bord de quai côté fleuve : mur, bordure de pierre, collision basse (on ne roule pas dans la Seine)
          bld.wall(a1[0], a1[1], b1[0], b1[1], -6.5, Y_B, -6.5, Y_B, -pc.nx, -pc.nz, L_STONE, STONE_B, u0);
          const e0 = P(u0, 0.965), e1 = P(u1, 0.965);
          bld.prism(e0[0], e0[1], e1[0], e1[1], 0.5, Y_B, Y_B, 0.22, L_PLAIN, COPING, false);
          addWallBox(e0[0], e0[1], e1[0], e1[1], Y_B + 2.2, 0.3);
        }
        // mur de fond (pied du mur de quai) : infranchissable depuis la berge, y compris là où le parapet est ouvert
        addWallBox(pc.ax + pc.nx * 0.25, pc.az + pc.nz * 0.25, pc.bx + pc.nx * 0.25, pc.bz + pc.nz * 0.25, -0.6, 0.3);
        // anneaux d'amarrage et échelles sur le mur de quai, bollards, bancs, lampadaires
        const k8 = Math.round(pc.ua / 8);
        box2(pc.mx - pc.nx * 0.06, pc.mz - pc.nz * 0.06, pc.dx, pc.dz, 0.32, 0.1, Y_B + 1.25, 0.3, L_PLAIN, [38, 36, 34]);
        if (k8 % 9 === 4) for (const o of [-0.25, 0.25]) box2(pc.mx + pc.dx * o - pc.nx * 0.08, pc.mz + pc.dz * o - pc.nz * 0.08, pc.dx, pc.dz, 0.06, 0.08, Y_B, 2.9, L_PLAIN, [40, 40, 42]);
        const em = P(pc.ua + pc.len / 2, 0.93); box2(em[0], em[1], pc.dx, pc.dz, 0.34, 0.34, Y_B + 0.2, 0.42, L_PLAIN, [32, 34, 36]);
        const [hm, stm] = hAt(pc.ua + pc.len / 2);
        if (!stm && k8 % 5 === 2) { const q = P(pc.ua + pc.len / 2, 0.08); bergeLamps.push(q[0], Y_B, q[1]); }
        if (!stm && k8 % 6 === 0) { const q = P(pc.ua + pc.len / 2, 0.14); box2(q[0], q[1], pc.dx, pc.dz, 1.9, 0.45, Y_B + 0.4, 0.07, L_PLAIN, [120, 88, 54]); box2(q[0] + pc.nx * 0.2, q[1] + pc.nz * 0.2, pc.dx, pc.dz, 1.9, 0.06, Y_B + 0.45, 0.42, L_PLAIN, [120, 88, 54]); for (const o of [-0.8, 0.8]) box2(q[0] + pc.dx * o, q[1] + pc.dz * o, pc.dx, pc.dz, 0.08, 0.42, Y_B, 0.42, L_PLAIN, [40, 44, 42]); }
        void hm;
      }
      // abouts de la berge (mur + collision)
      for (const [pc, end] of [[run[0], 0], [run[run.length - 1], 1]]) {
        const ix = end ? pc.bx : pc.ax, iz = end ? pc.bz : pc.az, ox = end ? pc.obx : pc.oax, oz = end ? pc.obz : pc.oaz;
        surf.at(ix, iz).wall(ix, iz, ox, oz, -6.5, Y_B, -6.5, Y_B, end ? pc.dx : -pc.dx, end ? pc.dz : -pc.dz, L_STONE, STONE_B, 0);
        addWallBox(ix, iz, ox, oz, Y_B + 2.2, 0.3);
      }
    }
  }
  function box2(x, z, dx, dz, len, w, y0, h, layer, col) { surf.at(x, z).prism(x - dx * len / 2, z - dz * len / 2, x + dx * len / 2, z + dz * len / 2, w, y0, y0, h, layer, col, true); }

  // --- couche de hauteur (contrat v4) : grille de quads, rejet immédiat hors de l'emprise des berges, aucune allocation
  const HQ = new Float32Array(hq), nQ = HQ.length / 10, HC = 12;
  let hx0 = Infinity, hx1 = -Infinity, hz0 = Infinity, hz1 = -Infinity;
  for (let q = 0; q < nQ; q++) for (let k = 0; k < 8; k += 2) { const x = HQ[q * 10 + k], z = HQ[q * 10 + k + 1]; if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; if (z < hz0) hz0 = z; if (z > hz1) hz1 = z; }
  const gw = nQ ? Math.floor((hx1 - hx0) / HC) + 1 : 0, gh = nQ ? Math.floor((hz1 - hz0) / HC) + 1 : 0;
  const cellStart = new Int32Array(gw * gh + 1); let cellItems = new Int32Array(0);
  if (nQ) {
    const lists = new Array(gw * gh);
    for (let q = 0; q < nQ; q++) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < 8; k += 2) { const x = HQ[q * 10 + k], z = HQ[q * 10 + k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      for (let cx = Math.floor((x0 - hx0) / HC); cx <= Math.floor((x1 - hx0) / HC); cx++) for (let cz = Math.floor((z0 - hz0) / HC); cz <= Math.floor((z1 - hz0) / HC); cz++) (lists[cz * gw + cx] || (lists[cz * gw + cx] = [])).push(q);
    }
    let n = 0; for (let c = 0; c < gw * gh; c++) { cellStart[c] = n; n += lists[c] ? lists[c].length : 0; } cellStart[gw * gh] = n;
    cellItems = new Int32Array(n); for (let c = 0; c < gw * gh; c++) if (lists[c]) cellItems.set(lists[c], cellStart[c]);
  }
  /** Hauteur de la berge / rampe en (x,z), ou undefined hors des berges. */
  function bergeHeight(x, z) {
    if (x < hx0 || x > hx1 || z < hz0 || z > hz1) return undefined;
    const c = Math.floor((z - hz0) / HC) * gw + Math.floor((x - hx0) / HC);
    for (let k = cellStart[c], e = cellStart[c + 1]; k < e; k++) {
      const o = cellItems[k] * 10;
      const ax = HQ[o], az = HQ[o + 1], bx = HQ[o + 2], bz = HQ[o + 3], cx = HQ[o + 4], cz = HQ[o + 5], dx = HQ[o + 6], dz = HQ[o + 7];
      const s1 = (bx - ax) * (z - az) - (bz - az) * (x - ax), s2 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx), s3 = (dx - cx) * (z - cz) - (dz - cz) * (x - cx), s4 = (ax - dx) * (z - dz) - (az - dz) * (x - dx);
      if ((s1 >= 0 && s2 >= 0 && s3 >= 0 && s4 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0 && s4 <= 0)) {
        const h0 = HQ[o + 8], h1 = HQ[o + 9]; if (h0 === h1) return h0;
        const ex = bx - ax, ez = bz - az; let t = ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez); t = t < 0 ? 0 : t > 1 ? 1 : t;
        return h0 + (h1 - h0) * t;
      }
    }
    return undefined;
  }

  // --- murs de quai, couronnement, parapets
  for (const pcs of polyPieces) {
    let runA = null, runB = null; // tronçon de parapet en cours (pour fusionner les collisions)
    const flush = () => { if (runA) addParapetBox(runA[0], runA[1], runB[0], runB[1]); runA = null; };
    for (const pc of pcs) {
      if (!pc) { flush(); continue; }
      if (pc.first) flush();
      const { ax, az, bx, bz, mx, mz, nx, nz } = pc;
      const bld = surf.at(mx, mz);
      bld.wall(ax, az, bx, bz, -6.5, Y_QUAY, -6.5, Y_QUAY, -nx, -nz, L_STONE, QUAY, pc.u);
      // couronnement (déborde un peu sur l'eau, recouvre le bord du sol découpé par le masque)
      const c0 = pc.open ? 0.0 : -0.45, c1 = 1.7, c2 = 2.4;
      bld.flatQuad([ax + nx * c0, Y_QUAY, az + nz * c0], [bx + nx * c0, Y_QUAY, bz + nz * c0], [bx + nx * c1, Y_QUAY, bz + nz * c1], [ax + nx * c1, Y_QUAY, az + nz * c1], L_PLAIN, 6, COPING);
      bld.flatQuad([ax + nx * c1, Y_QUAY, az + nz * c1], [bx + nx * c1, Y_QUAY, bz + nz * c1], [bx + nx * c2, Y_GROUND + 0.006, bz + nz * c2], [ax + nx * c2, Y_GROUND + 0.006, az + nz * c2], L_SIDEWALK, 4, COPING);
      if (!pc.open) bld.wall(ax + nx * c0, az + nz * c0, bx + nx * c0, bz + nz * c0, Y_QUAY - 0.35, Y_QUAY, Y_QUAY - 0.35, Y_QUAY, -nx, -nz, L_PLAIN, COPING, pc.u);
      if (pc.open || nearDeck(mx, mz, 0.2) || net.roadAtPad(mx + nx * 0.3, mz + nz * 0.3, 0.6, false)) { flush(); continue; }
      const px = nx * 0.3, pz = nz * 0.3;
      bld.prism(ax + px, az + pz, bx + px, bz + pz, 0.5, Y_QUAY, Y_QUAY, PARAPET_H, L_STONE, QUAY, true);
      if (!runA) runA = [ax + px, az + pz];
      runB = [bx + px, bz + pz];
    }
    flush();
  }

  // ---------- 3. ponts
  for (const d of decks) {
    const { r, sa, sb, W } = d, L = sb - sa;
    // ponts célèbres individualisés d'après leur nom
    const nm = r.bridgeName || r.name || '';
    const kind = /Alexandre.III/.test(nm) ? 'alex' : /Pont Neuf/.test(nm) ? 'neuf' : /Bir.Hakeim/.test(nm) ? 'bir' : /Arts|Debilly|Senghor|Solf[ée]rino|Passerelle/i.test(nm) ? 'metal' : 'stone';
    d.kind = kind;
    const metal = kind === 'alex' || kind === 'metal';
    const BR = kind === 'alex' ? [150, 160, 158] : kind === 'metal' ? [78, 92, 88] : kind === 'neuf' ? [226, 214, 190] : BRIDGE, BL = metal ? L_PLAIN : L_STONE;
    const nSpan = kind === 'alex' ? 1 : Math.max(1, Math.round(L / (kind === 'neuf' ? 19 : kind === 'metal' ? 22 : 30))), Ls = L / nSpan, pw = Math.min(kind === 'metal' ? 0.5 : 1.6, Ls * 0.12);
    const Y_PIER = -6.5, Y_SPRING = WATER_LEVEL + 0.5, Y_CROWN = kind === 'alex' ? -0.75 : metal ? -0.6 : -1.0, Y_TOP = Y_GROUND;
    const prof = []; // [s, yBas]
    for (let i = 0; i < nSpan; i++) {
      const s0 = sa + i * Ls;
      prof.push([s0, Y_PIER], [s0 + pw, Y_PIER], [s0 + pw, Y_SPRING]);
      const NA = 12;
      for (let k = 1; k < NA; k++) { const tau = k / NA, c = 2 * tau - 1; prof.push([s0 + pw + (Ls - 2 * pw) * tau, Y_SPRING + (Y_CROWN - Y_SPRING) * Math.sqrt(Math.max(0, 1 - c * c))]); }
      prof.push([s0 + Ls - pw, Y_SPRING], [s0 + Ls - pw, Y_PIER]);
    }
    prof.push([sb, Y_PIER]);
    for (let i = 0; i < prof.length - 1; i++) {
      const [s0, y0] = prof[i], [s1, y1] = prof[i + 1];
      net.pointAt(r, s0, W, o); const lx0 = o.x, lz0 = o.z; net.pointAt(r, s0, -W, o); const rx0 = o.x, rz0 = o.z;
      net.pointAt(r, s1, W, o2); const lx1 = o2.x, lz1 = o2.z; net.pointAt(r, s1, -W, o2); const rx1 = o2.x, rz1 = o2.z;
      const bld = surf.at(lx0, lz0);
      const nx = o2.dz, nz = -o2.dx; // normale gauche
      if (s1 - s0 > 0.01) {
        bld.wall(lx0, lz0, lx1, lz1, y0, Y_TOP, y1, Y_TOP, nx, nz, BL, BR, s0);
        bld.wall(rx0, rz0, rx1, rz1, y0, Y_TOP, y1, Y_TOP, -nx, -nz, BL, BR, s0);
      }
      // intrados (ou face de pile si s0 == s1)
      const vertical = s1 - s0 <= 0.01;
      const sl = Math.hypot(s1 - s0, y1 - y0) || 1;
      const ny = vertical ? 0 : -(s1 - s0) / sl, nl = vertical ? (i % 2 ? 1 : -1) : (y1 - y0) / sl;
      const a0 = bld.v(lx0, y0, lz0, 0, s0 + y0, L_STONE, 0, 1, [150, 144, 132], o2.dx * nl, ny, o2.dz * nl);
      const a1 = bld.v(rx0, y0, rz0, 2 * W, s0 + y0, L_STONE, 0, 1, [150, 144, 132], o2.dx * nl, ny, o2.dz * nl);
      const a2 = bld.v(rx1, y1, rz1, 2 * W, s0 + sl + y0, L_STONE, 0, 1, [150, 144, 132], o2.dx * nl, ny, o2.dz * nl);
      const a3 = bld.v(lx1, y1, lz1, 0, s0 + sl + y0, L_STONE, 0, 1, [150, 144, 132], o2.dx * nl, ny, o2.dz * nl);
      bld.idx.push(a0, a1, a2, a0, a2, a3, a0, a2, a1, a0, a3, a2);
    }
    // corniche + parapets (collision)
    const pOff = W - 0.3;
    const cum = r._cum; const brk = [sa];
    for (let k = 0; k < cum.length; k++) if (cum[k] > sa + 0.5 && cum[k] < sb - 0.5) brk.push(cum[k]);
    brk.push(sb);
    for (let i = 0; i < brk.length - 1; i++) {
      const m = Math.max(1, Math.ceil((brk[i + 1] - brk[i]) / 14));
      for (let k = 0; k < m; k++) {
        const s0 = brk[i] + ((brk[i + 1] - brk[i]) * k) / m, s1 = brk[i] + ((brk[i + 1] - brk[i]) * (k + 1)) / m;
        for (const sg of [1, -1]) {
          net.pointAt(r, s0 + 1e-3, sg * pOff, o); net.pointAt(r, s1 - 1e-3, sg * pOff, o2);
          const bld = surf.at(o.x, o.z);
          const first = i === 0 && k === 0, lastP = i === brk.length - 2 && k === m - 1;
          if (metal) { bld.prism(o.x, o.z, o2.x, o2.z, 0.1, Y_GROUND + 1.0, Y_GROUND + 1.0, 0.1, L_PLAIN, BR, false); bld.prism(o.x, o.z, o2.x, o2.z, 0.06, Y_GROUND, Y_GROUND, 0.55, L_PLAIN, BR, false); bld.prism(o.x, o.z, o2.x, o2.z, 0.22, Y_GROUND, Y_GROUND, 0.18, L_PLAIN, BR, false); }
          else bld.prism(o.x, o.z, o2.x, o2.z, 0.5, Y_GROUND, Y_GROUND, PARAPET_H + 0.1, BL, BR, first || lastP);
          // corniche sous le parapet
          net.pointAt(r, s0 + 1e-3, sg * (W + 0.12), o); net.pointAt(r, s1 - 1e-3, sg * (W + 0.12), o2);
          bld.prism(o.x, o.z, o2.x, o2.z, 0.3, -0.45, -0.45, 0.4, L_PLAIN, COPING, false);
          net.pointAt(r, s0, sg * pOff, o); net.pointAt(r, s1, sg * pOff, o2);
          addParapetBox(o.x, o.z, o2.x, o2.z);
        }
      }
    }
  }

  // éléments propres aux ponts célèbres
  const box = (x, z, dx, dz, len, w, y0, h, layer, col) => surf.at(x, z).prism(x - dx * len / 2, z - dz * len / 2, x + dx * len / 2, z + dz * len / 2, w, y0, y0, h, layer, col, true);
  for (const d of decks) {
    const { r, sa, sb, W } = d, L = sb - sa;
    if (d.kind === 'alex') {
      // quatre pylônes de pierre surmontés de groupes dorés, candélabres le long du parapet
      for (const s of [sa + 1.5, sb - 1.5]) for (const sg of [1, -1]) {
        net.pointAt(r, s, sg * (W + 1.6), o);
        if (masks.isWater(o.x, o.z)) continue; // seulement aux culées (le pont peut être découpé en plusieurs tronçons)
        box(o.x, o.z, o.dx, o.dz, 3.2, 3.2, 0, 15, L_STONE, [236, 228, 210]);
        box(o.x, o.z, o.dx, o.dz, 3.8, 3.8, 15, 0.7, L_PLAIN, [236, 228, 210]);
        box(o.x, o.z, o.dx, o.dz, 2.2, 1.2, 15.7, 2.6, L_PLAIN, [235, 180, 45]);
        box(o.x, o.z, o.dx, o.dz, 0.9, 2.4, 17.2, 1.6, L_PLAIN, [235, 180, 45]);
        collision.addBox({ x: o.x, z: o.z, hw: 1.7, hd: 1.7, rot: Math.atan2(-o.dz, o.dx), tag: 'parapet' });
      }
      for (let s = sa + 10; s < sb - 8; s += 9) for (const sg of [1, -1]) { net.pointAt(r, s, sg * (W - 0.3), o); box(o.x, o.z, o.dx, o.dz, 0.16, 0.16, 1.1, 3.0, L_PLAIN, [40, 46, 44]); box(o.x, o.z, o.dx, o.dz, 0.5, 0.5, 4.1, 0.5, L_PLAIN, [240, 225, 180]); }
    } else if (d.kind === 'neuf') {
      // demi-lunes au droit de chaque pile
      const n = Math.max(1, Math.round(L / 19));
      for (let i = 1; i < n; i++) for (const sg of [1, -1]) {
        net.pointAt(r, sa + (L * i) / n, sg * (W + 0.75), o);
        box(o.x, o.z, o.dx, o.dz, 3.4, 1.9, -6.5, 6.5 + Y_GROUND, L_STONE, [226, 214, 190]);
        box(o.x, o.z, o.dx, o.dz, 3.4, 1.9, Y_GROUND, 0.14, L_PLAIN, COPING);
        net.pointAt(r, sa + (L * i) / n, sg * (W + 1.5), o); box(o.x, o.z, o.dx, o.dz, 3.4, 0.4, Y_GROUND, 1.1, L_STONE, [226, 214, 190]);
      }
    } else if (d.kind === 'bir') {
      // viaduc du métro : deux files de colonnettes de fonte et tablier supérieur (sans collision : décor)
      for (let s = sa; s <= sb; s += 6) for (const sg of [1, -1]) { net.pointAt(r, s, sg * 2.4, o); box(o.x, o.z, o.dx, o.dz, 0.34, 0.34, 0.1, 6.3, L_PLAIN, [96, 112, 104]); }
      for (let s = sa; s < sb; s += 12) { net.pointAt(r, Math.min(sb, s + 6), 0, o); box(o.x, o.z, o.dx, o.dz, 12.1, 7.4, 6.4, 1.1, L_PLAIN, [110, 126, 118]); }
    }
  }

  // ---------- 3 bis. bouquinistes sur les parapets, péniches amarrées
  const mPerLon = 111320 * Math.cos((48.8656 * Math.PI) / 180), lonX = (lon) => (lon - 2.3212) * mPerLon;
  const BQ_L = [lonX(2.3285), lonX(2.357)], BQ_R = [lonX(2.333), lonX(2.3575)]; // rive gauche : Voltaire → Tournelle ; rive droite : Louvre → pont Marie
  let acc = 200, nBoat = 0, nBox = 0;
  for (const poly of masks.riverPolys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (outside(a) && outside(b)) continue;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 2) continue;
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      for (let t = 1.5; t < L - 1.5; t += 2.6) {
        const x = a[0] + dx * t, z = a[1] + dz * t;
        let nx = -dz, nz = dx;
        const wP = masks.isWater(x + nx * probe, z + nz * probe), wM = masks.isWater(x - nx * probe, z - nz * probe);
        if (wP === wM) continue;
        if (wP) { nx = -nx; nz = -nz; }
        // boîtes vertes des bouquinistes (par groupes de 4, un vide entre les groupes)
        const left = nz > 0.25 && x > BQ_L[0] && x < BQ_L[1], right = nz < -0.25 && x > BQ_R[0] && x < BQ_R[1];
        if ((left || right) && (Math.floor(t / 2.6) % 6) < 4 && !nearDeck(x, z, 3) && !net.roadAtPad(x + nx * 0.3, z + nz * 0.3, 0.6, false) && bergeHeight(x - nx * 2.8, z - nz * 2.8) !== 0) {
          box(x + nx * 0.3, z + nz * 0.3, dx, dz, 2.0, 0.78, Y_QUAY + PARAPET_H, 0.6, L_PLAIN, [26, 62, 42]);
          box(x + nx * 0.3, z + nz * 0.3, dx, dz, 2.1, 0.86, Y_QUAY + PARAPET_H + 0.6, 0.06, L_PLAIN, [20, 48, 33]); nBox++;
        }
        // péniches amarrées le long des quais
        acc += 2.6;
        const bo = bergeHeight(x - nx * 3, z - nz * 3) !== undefined ? BW + 0.6 : 0; // amarrée contre la berge s'il y en a une
        if (acc > (bo ? 150 : 430) && !nearDeck(x, z, 30) && masks.isWater(x - nx * (5 + bo), z - nz * (5 + bo)) && masks.isWater(x - nx * 9, z - nz * 9) && masks.isWater(x - nx * 5 + dx * 16, z - nz * 5 + dz * 16) && masks.isWater(x - nx * 5 - dx * 16, z - nz * 5 - dz * 16)) {
          acc = 0; nBoat++;
          const bx = x - nx * (4.6 + bo), bz = z - nz * (4.6 + bo), long = nBoat % 3 === 0;
          if (bo) box(x - nx * (BW + 1.2), z - nz * (BW + 1.2), nx, nz, 3.4, 1.1, Y_B - 0.05, 0.12, L_PLAIN, [150, 120, 84]); // passerelle
          const hull = nBoat % 2 ? [36, 40, 48] : [92, 34, 30], len = long ? 44 : 30;
          box(bx, bz, dx, dz, len, 5.2, WATER_LEVEL - 0.4, 1.7, L_PLAIN, hull);
          box(bx, bz, dx, dz, len - 1.2, 4.6, WATER_LEVEL + 1.3, 0.08, L_PLAIN, [120, 96, 70]);
          if (long) { box(bx, bz, dx, dz, len * 0.7, 4.2, WATER_LEVEL + 1.3, 1.9, L_PLAIN, [225, 228, 230]); box(bx, bz, dx, dz, len * 0.7 + 0.6, 4.5, WATER_LEVEL + 3.2, 0.12, L_PLAIN, [245, 245, 240]); } // bateau-mouche vitré
          else box(bx - dx * len * 0.3, bz - dz * len * 0.3, dx, dz, len * 0.28, 3.8, WATER_LEVEL + 1.3, 1.7, L_PLAIN, [228, 224, 214]);
        }
      }
    }
  }

  // ---------- 4. eau
  const wn = createWaterNormal(THREE);
  const uni = { uWTime: { value: 0 }, uWNrm: { value: wn }, uWSky: { value: new THREE.Color(0x9fb8cc) } };
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c3a31, roughness: 0.2, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWTime; uniform sampler2D uWNrm; uniform vec3 uWSky; varying vec3 vWPos;`)
      .replace('#include <normal_fragment_maps>', `
{
  vec2 p = vWPos.xz;
  // quatre nappes de vaguelettes à des échelles et orientations différentes (pas de trame visible)
  vec2 pa = mat2(0.80, 0.60, -0.60, 0.80) * p, pb = mat2(0.28, 0.96, -0.96, 0.28) * p, pc = mat2(-0.62, 0.78, -0.78, -0.62) * p;
  vec2 n1 = texture2D(uWNrm, p * 0.0113 + vec2(uWTime * 0.004, uWTime * 0.002)).xy * 2.0 - 1.0;
  vec2 n2 = texture2D(uWNrm, pa * 0.043 + vec2(-uWTime * 0.011, uWTime * 0.007)).xy * 2.0 - 1.0;
  vec2 n3 = texture2D(uWNrm, pb * 0.137 + vec2(uWTime * 0.03, -uWTime * 0.021)).xy * 2.0 - 1.0;
  vec2 n4 = texture2D(uWNrm, pc * 0.41 + vec2(uWTime * 0.06, uWTime * 0.05)).xy * 2.0 - 1.0;
  n2 = mat2(0.80, -0.60, 0.60, 0.80) * n2; n3 = mat2(0.28, -0.96, 0.96, 0.28) * n3; n4 = mat2(-0.62, -0.78, 0.78, -0.62) * n4;
  float dist = length(vViewPosition);
  float fade = 1.0 / (1.0 + dist * 0.01), fade2 = 1.0 / (1.0 + dist * 0.04);
  vec3 wn = normalize(vec3(n1 * 0.35 + n2 * 0.5 + n3 * 0.55 * fade + n4 * 0.45 * fade2, 2.0));
  // plan horizontal : tangente = X monde, bitangente = Z monde
  vec3 wN = normalize(vec3(wn.x, wn.z, wn.y));
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
}`)
      .replace('#include <opaque_fragment>', `
{
  float ndv = saturate(dot(normal, normalize(vViewPosition)));
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  outgoingLight = mix(outgoingLight, uWSky, clamp(fres, 0.0, 1.0) * 0.85);
}
#include <opaque_fragment>`);
  };
  const cx = masks.x0 + masks.sizeX / 2, cz = masks.z0 + masks.sizeZ / 2;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(masks.sizeX + 3000, masks.sizeZ + 3000), mat);
  water.rotation.x = -Math.PI / 2; water.position.set(cx, WATER_LEVEL, cz);
  water.receiveShadow = true; water.name = 'seine';
  scene.add(water);

  const tmpC = new THREE.Color();
  return {
    water, decks, nearDeck, boats: nBoat, bookstalls: nBox, bergeHeight, bergeLamps, bergeLen: Math.round(bergeLen), ramps: nRamps, stairs: nStairs, runsInfo, Y_B,
    update(dt, night) {
      uni.uWTime.value += dt;
      // reflet du ciel : couleur du brouillard / fond de scène (fournis par l'agent environnement)
      const src = scene.fog?.color || (scene.background?.isColor ? scene.background : null);
      if (src) tmpC.copy(src); else tmpC.setRGB(0.55, 0.68, 0.8).multiplyScalar(1 - night * 0.95);
      uni.uWSky.value.lerp(tmpC, 0.1);
    },
  };
}

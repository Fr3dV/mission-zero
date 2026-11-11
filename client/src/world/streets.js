// Sol, chaussées, pastilles de carrefour, trottoirs à bordure et marquages au sol.
import { TILE } from './util.js';
import { L_ASPHALT, L_SIDEWALK, L_PAVE, L_PLAIN, L_GROUND } from './textures.js';

const BIKE = [150, 196, 160], WHITE = [255, 255, 255], CURB = [178, 176, 170], WALK = [232, 230, 226], PAINT = [255, 255, 255], PAVE_DARK = [150, 148, 146];
export const Y_ROAD = 0.02, Y_WALK = 0.11, Y_GROUND = -0.03;

export function buildGround(ctx, surf, masks) {
  const { heightAt, LANDMARK_BY_ID } = ctx;
  const hill = LANDMARK_BY_ID.sacrecoeur;
  const tx0 = Math.floor(masks.x0 / TILE), tx1 = Math.ceil((masks.x0 + masks.sizeX) / TILE);
  const tz0 = Math.floor(masks.z0 / TILE), tz1 = Math.ceil((masks.z0 + masks.sizeZ) / TILE);
  for (let tx = tx0; tx < tx1; tx++) for (let tz = tz0; tz < tz1; tz++) {
    const ox = tx * TILE, oz = tz * TILE;
    const near = hill && Math.hypot(ox + TILE / 2 - hill.x, oz + TILE / 2 - hill.z) < 1500 + TILE;
    const N = near ? 25 : 1, st = TILE / N;
    const b = surf.at(ox + 1, oz + 1);
    const base = b.n;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = ox + i * st, z = oz + j * st;
      let nx = 0, ny = 1, nz = 0;
      if (near) { const e = 2; nx = heightAt(x - e, z) - heightAt(x + e, z); nz = heightAt(x, z - e) - heightAt(x, z + e); ny = 2 * e; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l; }
      b.v(x, heightAt(x, z) + Y_GROUND, z, x, z, L_GROUND, 0, 0, WHITE, nx, ny, nz);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = base + j * (N + 1) + i, c = a + N + 1;
      b.idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  // jupe lointaine (au-delà des données) : 4 grands quads jusqu'à l'horizon
  const X0 = tx0 * TILE, X1 = tx1 * TILE, Z0 = tz0 * TILE, Z1 = tz1 * TILE, F = 7000;
  const far = surf.at(400000, 400000);
  for (const [a, b, c, d] of [[[X0 - F, Z0 - F], [X1 + F, Z0 - F], [X1 + F, Z0], [X0 - F, Z0]], [[X0 - F, Z1], [X1 + F, Z1], [X1 + F, Z1 + F], [X0 - F, Z1 + F]],
    [[X0 - F, Z0], [X0, Z0], [X0, Z1], [X0 - F, Z1]], [[X1, Z0], [X1 + F, Z0], [X1 + F, Z1], [X1, Z1]]]) {
    far.flatQuad([a[0], Y_GROUND, a[1]], [b[0], Y_GROUND, b[1]], [c[0], Y_GROUND, c[1]], [d[0], Y_GROUND, d[1]], L_GROUND, 0, WHITE);
  }
}

export function buildStreets(ctx, net, surf, masks) {
  const { heightAt } = ctx;
  const { roads } = net;
  const pa = { _k: 0 }, pb = { _k: 0 }, pc = { _k: 0 }, pd = { _k: 0 };
  const lights = []; // emplacements de feux tricolores

  const onHill = (r) => {
    if (r._hill !== undefined) return r._hill;
    let h = false; for (const p of r.points) if (heightAt(p[0], p[1]) > 0.02) { h = true; break; }
    return (r._hill = h);
  };
  /**
   * Ruban entre deux décalages latéraux (offA à hauteur yA, offB à hauteur yB) de l'abscisse s0 à s1.
   * mode ≥ 2 : uv = (décalage, s / period).
   */
  function ribbon(r, s0, s1, offA, yA, offB, yB, layer, bias, col, mode = 0, period = 1) {
    if (s1 - s0 < 0.05) return;
    const cum = r._cum, hill = onHill(r), maxStep = hill ? 6 : 1e9;
    // points de rupture : s0, sommets intermédiaires, s1
    let prev = s0, k = 0;
    while (k < cum.length - 1 && cum[k + 1] <= s0 + 1e-4) k++;
    for (;;) {
      let next = Math.min(s1, k < cum.length - 1 ? cum[k + 1] : s1);
      if (next <= prev + 1e-4) { if (next >= s1 - 1e-4) break; k++; continue; }
      const m = Math.max(1, Math.ceil((next - prev) / maxStep));
      for (let i = 0; i < m; i++) {
        const a = prev + ((next - prev) * i) / m, b = prev + ((next - prev) * (i + 1)) / m;
        // léger recul pour rester dans le bon segment (cadres d'onglet)
        net.pointAt(r, a + 1e-4, offA, pa); net.pointAt(r, a + 1e-4, offB, pb); net.pointAt(r, b - 1e-4, offB, pc); net.pointAt(r, b - 1e-4, offA, pd);
        const A = [pa.x, heightAt(pa.x, pa.z) + yA, pa.z], B = [pb.x, heightAt(pb.x, pb.z) + yB, pb.z];
        const C = [pc.x, heightAt(pc.x, pc.z) + yB, pc.z], D = [pd.x, heightAt(pd.x, pd.z) + yA, pd.z];
        const uvs = mode >= 2 ? [[offA, a / period], [offB, a / period], [offB, b / period], [offA, b / period]] : null;
        surf.at(A[0], A[2]).flatQuad(A, B, C, D, layer, bias, col, mode, uvs);
      }
      prev = next;
      if (next >= s1 - 1e-4) break;
      k++;
    }
  }

  // ---------- chaussées
  for (const r of roads) {
    const pave = r._ped || /Champs-Élysées/.test(r.name || '');
    r._pave = pave;
    ribbon(r, 0, r._len, r._hw, r._ped ? Y_ROAD - 0.008 : Y_ROAD, -r._hw, r._ped ? Y_ROAD - 0.008 : Y_ROAD, pave ? L_PAVE : L_ASPHALT, r._ped ? 1 : 2, r._ped ? WHITE : pave ? PAVE_DARK : WHITE);
  }
  // ---------- pastilles aux carrefours (comblent les coins entre rubans)
  for (const e of net.junctions) {
    const R = e.maxHw, x = e.p[0], z = e.p[1], y = heightAt(x, z) + (e.ped ? Y_ROAD - 0.008 : Y_ROAD);
    const b = surf.at(x, z), c = b.v(x, y, z, x, z, e.ped ? L_PAVE : L_ASPHALT, e.ped ? 1 : 2, 0, WHITE);
    const N = 12; let first = -1, prev = -1;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
      const v = b.v(px, heightAt(px, pz) + y - heightAt(x, z), pz, px, pz, e.ped ? L_PAVE : L_ASPHALT, e.ped ? 1 : 2, 0, WHITE);
      if (i === 0) first = v; else b.tri(c, v, prev);
      prev = v;
    }
    b.tri(c, first, prev);
  }

  // ---------- trottoirs
  for (const r of roads) {
    const sw = r._sw; if (sw <= 0) continue;
    const hw = r._hw;
    for (const sgn of [1, -1]) {
      const clipped = (s) => {
        net.pointAt(r, s, sgn * (hw + 0.45), pa); if (net.insideOther(pa.x, pa.z, -0.1, r._i) >= 0) return true;
        net.pointAt(r, s, sgn * (hw + sw - 0.15), pa); return net.insideOther(pa.x, pa.z, -0.1, r._i) >= 0;
      };
      const emit = (s0, s1) => {
        if (s1 - s0 < 0.4) return;
        ribbon(r, s0, s1, sgn * (hw - 0.03), Y_ROAD, sgn * hw, Y_WALK, L_PLAIN, 3, CURB);                 // face de bordure
        ribbon(r, s0, s1, sgn * hw, Y_WALK, sgn * (hw + 0.25), Y_WALK, L_PLAIN, 3, CURB);                 // dessus de bordure (granit)
        ribbon(r, s0, s1, sgn * (hw + 0.25), Y_WALK, sgn * (hw + sw), Y_WALK, L_SIDEWALK, 3, WALK);       // trottoir
        ribbon(r, s0, s1, sgn * (hw + sw), Y_WALK, sgn * (hw + sw + 0.9), Y_GROUND - 0.01, L_SIDEWALK, 3, WALK); // raccord arrière en pente douce
        // abouts (pentes courtes aux extrémités coupées)
        for (const [s, d] of [[s0, -1], [s1, 1]]) {
          if ((s <= 0.01 && r._contA >= 0) || (s >= r._len - 0.01 && r._contB >= 0)) continue;
          net.pointAt(r, s, sgn * hw, pa); net.pointAt(r, s, sgn * (hw + sw), pb);
          const ex = pa.dx * d * 0.35, ez = pa.dz * d * 0.35;
          const y0 = heightAt(pa.x, pa.z);
          surf.at(pa.x, pa.z).flatQuad([pa.x, y0 + Y_WALK, pa.z], [pb.x, y0 + Y_WALK, pb.z], [pb.x + ex, y0 + Y_GROUND, pb.z + ez], [pa.x + ex, y0 + Y_GROUND, pa.z + ez], L_PLAIN, 3, CURB);
        }
      };
      const STEP = 2.5, n = Math.max(1, Math.ceil(r._len / STEP));
      let prevS = 0, prevC = clipped(0), start = prevC ? -1 : 0;
      for (let i = 1; i <= n; i++) {
        const s = (r._len * i) / n, c = clipped(s);
        if (c !== prevC) {
          let a = prevS, b = s;
          for (let it = 0; it < 4; it++) { const m = (a + b) / 2; if (clipped(m) === prevC) a = m; else b = m; }
          if (c) { emit(start, a); start = -1; } else start = b;
        }
        prevS = s; prevC = c;
      }
      if (start >= 0) emit(start, r._len);
    }
  }

  // ---------- marquages
  for (const r of roads) {
    if (r._ped) continue;
    const hw = r._hw, lanes = Math.max(1, r.lanes | 0), laneW = r.width / lanes;
    const base = r._pave ? L_PAVE : L_ASPHALT;
    const lines = []; // [décalage, continu?]
    if (!r.oneway && lanes >= 2) {
      lines.push([0, lanes >= 4]);
      for (let k = 1; k < lanes / 2; k++) { lines.push([k * laneW, false]); lines.push([-k * laneW, false]); }
    } else if (r.oneway && lanes >= 2) {
      for (let k = 1; k < lanes; k++) lines.push([(k - lanes / 2) * laneW, false]);
    }
    // piste cyclable sur les grands axes : bande teintée + ligne continue côté trottoir
    const bike = r.width >= 9.5 && (r.kind === 'avenue' || r.kind === 'boulevard' || r.kind === 'quay');
    const runs = net.freeRuns(r);
    for (const [s0, s1, cutA, cutB, oA, oB] of runs) {
      const len = s1 - s0;
      const okW = r.width >= 4.4 && len > 16;
      const cwA = okW && cutA && oA >= 0 && !roads[oA]._ped, cwB = okW && cutB && oB >= 0 && !roads[oB]._ped;
      const a = s0 + (cwA ? 6.4 : 0.6), b = s1 - (cwB ? 6.4 : 0.6);
      if (b - a > 3) for (const [off, solid] of lines) ribbon(r, a, b, off + 0.075, Y_ROAD + 0.006, off - 0.075, Y_ROAD + 0.006, base, 4, PAINT, solid ? 4 : 2, 6);
      if (bike && b - a > 12) for (const sg of r.oneway ? [-1] : [-1, 1]) {
        ribbon(r, a, b, sg * (hw - 0.12), Y_ROAD + 0.004, sg * (hw - 1.55), Y_ROAD + 0.004, base, 3, BIKE);
        ribbon(r, a, b, sg * (hw - 1.55), Y_ROAD + 0.006, sg * (hw - 1.7), Y_ROAD + 0.006, base, 4, PAINT, 4);
        // pictogrammes simplifiés (chevrons) tous les 40 m
        for (let s = a + 6; s < b - 4; s += 40) ribbon(r, s, s + 1.6, sg * (hw - 0.5), Y_ROAD + 0.007, sg * (hw - 1.2), Y_ROAD + 0.007, base, 4, PAINT, 2, 0.8);
      }
      const cross = (sa, sb) => ribbon(r, sa, sb, hw - 0.3, Y_ROAD + 0.006, -hw + 0.3, Y_ROAD + 0.006, base, 4, PAINT, 3, 1);
      const big = (o) => r.lanes >= 3 || (roads[o].lanes | 0) >= 3 || (r.lanes >= 2 && (roads[o].lanes | 0) >= 2);
      if (cwB) {
        cross(s1 - 4.3, s1 - 1.3);
        ribbon(r, s1 - 5.7, s1 - 5.3, r.oneway ? hw - 0.2 : 0, Y_ROAD + 0.006, -hw + 0.2, Y_ROAD + 0.006, base, 4, PAINT, 4);
        if (big(oB)) { net.pointAt(r, s1 - 5.5, -(hw + 0.6), pa); lights.push({ x: pa.x, z: pa.z, yaw: Math.atan2(pa.dx, pa.dz) }); }
      }
      if (cwA) {
        cross(s0 + 1.3, s0 + 4.3);
        if (!r.oneway) {
          ribbon(r, s0 + 5.3, s0 + 5.7, hw - 0.2, Y_ROAD + 0.006, 0, Y_ROAD + 0.006, base, 4, PAINT, 4);
          if (big(oA)) { net.pointAt(r, s0 + 5.5, hw + 0.6, pa); lights.push({ x: pa.x, z: pa.z, yaw: Math.atan2(-pa.dx, -pa.dz) }); }
        }
      }
    }
  }
  return { lights };
}

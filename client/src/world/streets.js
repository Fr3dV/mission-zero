// Sol, chaussées, pastilles de carrefour, trottoirs à bordure et marquages au sol.
import { TILE } from './util.js';
import { L_ASPHALT, L_SIDEWALK, L_PAVE, L_PLAIN, L_GROUND } from './textures.js';

const BIKE = [150, 196, 160], WHITE = [255, 255, 255], CURB = [178, 176, 170], WALK = [232, 230, 226], PAINT = [255, 255, 255];
// Ordre de couches STRICT des surfaces de sol (jamais deux matières différentes à la même hauteur) : chaque classe a
// sa hauteur franche (≥ 4 mm d'écart) ET son biais de profondeur (aSurf.y, appliqué en NDC dans le vertex shader, donc
// valable à toute distance). Du bas vers le haut :
//   sol -0,030 (b0) < rue piétonne pavée 0,008 (b1) < chaussée pavée 0,016 (b2) < chaussée bitume 0,024 (b3)
//   < disque de place 0,032 (b4) < bande cyclable 0,037 (b5) < peinture 0,042 (b6) ; trottoir 0,110 (b4) < bordure 0,115 (b5)
// Les raccords en pente (arrière et abouts de trottoir) s'arrêtent AU-DESSUS de la surface qu'ils rejoignent (pas de croisement).
// Deux rubans de MÊME classe peuvent se recouvrir à la même hauteur (carrefours) : même texture en coordonnées monde,
// même teinte, même normale → pixel identique quel que soit le gagnant du test de profondeur.
export const Y_PED = 0.008, Y_SETT = 0.016, Y_ROAD = 0.024, Y_ZONE = 0.032, Y_BIKE = 0.037, Y_PAINT = 0.042, Y_WALK = 0.11, Y_CURB = 0.115, Y_GROUND = -0.03;
/** [hauteur, biais, couche] de la chaussée selon sa classe : 0 piétonne pavée, 1 pavée, 2 bitume. */
const ROAD_CLASS = [[Y_PED, 1], [Y_SETT, 2], [Y_ROAD, 3]];

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
    const cum = r._cum, hill = onHill(r), maxStep = hill ? 4 : 1e9;
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
    const pave = r._surf === 'sett';
    r._pave = pave;
    const [ry, rb] = ROAD_CLASS[pave ? (r._ped ? 0 : 1) : 2]; r._y = ry; // une rue piétonne bitumée est rangée avec le bitume
    ribbon(r, 0, r._len, r._hw, ry, -r._hw, ry, pave ? L_PAVE : L_ASPHALT, rb, WHITE);
  }
  // ---------- pastilles aux carrefours (comblent les coins entre rubans)
  for (const e of net.junctions) {
    // la pastille prend la classe la plus haute des voies du nœud : elle est coplanaire avec des rubans de MÊME matière seulement
    const [cy, cb] = ROAD_CLASS[e.cls], lay = e.cls === 2 ? L_ASPHALT : L_PAVE;
    const R = e.maxHw, x = e.p[0], z = e.p[1], y = heightAt(x, z) + cy;
    const b = surf.at(x, z), c = b.v(x, y, z, x, z, lay, cb, 0, WHITE);
    const N = 12; let first = -1, prev = -1;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
      const v = b.v(px, heightAt(px, pz) + cy, pz, px, pz, lay, cb, 0, WHITE);
      if (i === 0) first = v; else b.tri(c, v, prev);
      prev = v;
    }
    b.tri(c, first, prev);
  }

  // ---------- places entièrement revêtues : disque pavé + plateau central surélevé à bordure de granit
  for (const q of net.zones) {
    const fan = (R, y, layer, bias, col, N = 64) => {
      const b = surf.at(q.x, q.z), c = b.v(q.x, heightAt(q.x, q.z) + y, q.z, q.x, q.z, layer, bias, 0, col); let first = -1, prev = -1;
      for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2, px = q.x + Math.cos(a) * R, pz = q.z + Math.sin(a) * R; const v = b.v(px, heightAt(px, pz) + y, pz, px, pz, layer, bias, 0, col); if (i === 0) first = v; else b.tri(c, v, prev); prev = v; }
      b.tri(c, first, prev);
    };
    fan(q.r, Y_ZONE, L_PAVE, 4, WHITE); // au-dessus de tous les rubans : pavage uniforme, sans raccords
    if (q.island) {
      fan(q.island, Y_WALK, L_PAVE, 4, [215, 208, 196]);
      const b = surf.at(q.x, q.z), N = 64;
      for (let i = 0; i < N; i++) { // bordure
        const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
        const P = (a, R, y) => [q.x + Math.cos(a) * R, y, q.z + Math.sin(a) * R];
        b.flatQuad(P(a0, q.island + 0.35, Y_ZONE), P(a1, q.island + 0.35, Y_ZONE), P(a1, q.island, Y_CURB), P(a0, q.island, Y_CURB), L_PLAIN, 5, CURB);
      }
    }
  }

  // ---------- trottoirs
  for (const r of roads) {
    const sw = r._sw; if (sw <= 0) continue;
    const hw = r._hw;
    for (const sgn of [1, -1]) {
      const clipped = (s) => {
        net.pointAt(r, s, sgn * (hw + 0.45), pa); if (net.insideOther(pa.x, pa.z, -0.1, r._i) >= 0 || net.inZone(pa.x, pa.z)) return true;
        net.pointAt(r, s, sgn * (hw + sw - 0.15), pa); return net.insideOther(pa.x, pa.z, -0.1, r._i) >= 0;
      };
      const emit = (s0, s1) => {
        if (s1 - s0 < 0.4) return;
        ribbon(r, s0, s1, sgn * (hw - 0.03), r._y, sgn * hw, Y_CURB, L_PLAIN, 5, CURB);                   // face de bordure
        ribbon(r, s0, s1, sgn * hw, Y_CURB, sgn * (hw + 0.25), Y_CURB, L_PLAIN, 5, CURB);                 // dessus de bordure (granit), 4 mm au-dessus du trottoir
        ribbon(r, s0, s1, sgn * (hw + 0.24), Y_WALK, sgn * (hw + sw), Y_WALK, L_SIDEWALK, 4, WALK);       // trottoir
        ribbon(r, s0, s1, sgn * (hw + sw), Y_WALK, sgn * (hw + sw + 0.9), Y_GROUND + 0.006, L_SIDEWALK, 4, WALK); // raccord arrière en pente douce
        // abouts (pentes courtes aux extrémités coupées)
        for (const [s, d] of [[s0, -1], [s1, 1]]) {
          if ((s <= 0.01 && r._contA >= 0) || (s >= r._len - 0.01 && r._contB >= 0)) continue;
          net.pointAt(r, s, sgn * hw, pa); net.pointAt(r, s, sgn * (hw + sw), pb);
          const ex = pa.dx * d * 0.35, ez = pa.dz * d * 0.35;
          const y0 = heightAt(pa.x, pa.z);
          surf.at(pa.x, pa.z).flatQuad([pa.x, y0 + Y_CURB, pa.z], [pb.x, y0 + Y_CURB, pb.z], [pb.x + ex, y0 + Y_PAINT + 0.006, pb.z + ez], [pa.x + ex, y0 + Y_PAINT + 0.006, pa.z + ez], L_PLAIN, 5, CURB);
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
    if (r._ped || /^Place /.test(r.name || '')) continue; // les places pavées n'ont pas de marquage de voies
    const hw = r._hw, lanes = Math.max(1, r._lanes | 0), laneW = r._w / lanes;
    const base = r._pave ? L_PAVE : L_ASPHALT;
    const lines = []; // [décalage, continu?]
    if (!r.oneway && lanes >= 2) {
      lines.push([0, lanes >= 4]);
      for (let k = 1; k < lanes / 2; k++) { lines.push([k * laneW, false]); lines.push([-k * laneW, false]); }
    } else if (r.oneway && lanes >= 2) {
      for (let k = 1; k < lanes; k++) lines.push([(k - lanes / 2) * laneW, false]);
    }
    // piste cyclable sur les grands axes : bande teintée + ligne continue côté trottoir
    const bike = r._w >= 9.5 && !r._pave && (r.kind === 'avenue' || r.kind === 'boulevard' || r.kind === 'quay');
    const runs = net.freeRuns(r);
    for (const [s0, s1, cutA, cutB, oA, oB] of runs) {
      const len = s1 - s0;
      const okW = r._w >= 4.4 && len > 16;
      let cwA = okW && cutA && oA >= 0 && !roads[oA]._ped, cwB = okW && cutB && oB >= 0 && !roads[oB]._ped;
      if (cwA) { net.pointAt(r, s0 + 3, 0, pa); if (net.inZone(pa.x, pa.z, -2)) cwA = false; }
      if (cwB) { net.pointAt(r, s1 - 3, 0, pa); if (net.inZone(pa.x, pa.z, -2)) cwB = false; }
      let a = s0 + (cwA ? 6.4 : 0.6), b = s1 - (cwB ? 6.4 : 0.6);
      // pas de lignes de voie sur le pavage des places (zones)
      while (b - a > 3 && net.inZone(net.pointAt(r, a, 0, pa).x, pa.z, 1)) a += 2;
      while (b - a > 3 && net.inZone(net.pointAt(r, b, 0, pa).x, pa.z, 1)) b -= 2;
      if (b - a > 3) for (const [off, solid] of lines) ribbon(r, a, b, off + 0.075, Y_PAINT, off - 0.075, Y_PAINT, base, 6, PAINT, solid ? 4 : 2, 6);
      if (bike && b - a > 12) for (const sg of r.oneway ? [-1] : [-1, 1]) {
        ribbon(r, a, b, sg * (hw - 0.12), Y_BIKE, sg * (hw - 1.55), Y_BIKE, base, 5, BIKE);
        ribbon(r, a, b, sg * (hw - 1.55), Y_PAINT, sg * (hw - 1.7), Y_PAINT, base, 6, PAINT, 4);
        // pictogrammes simplifiés (chevrons) tous les 40 m
        for (let s = a + 6; s < b - 4; s += 40) ribbon(r, s, s + 1.6, sg * (hw - 0.5), Y_PAINT, sg * (hw - 1.2), Y_PAINT, base, 6, PAINT, 2, 0.8);
      }
      const cross = (sa, sb) => ribbon(r, sa, sb, hw - 0.3, Y_PAINT, -hw + 0.3, Y_PAINT, base, 6, PAINT, 3, 1);
      const big = (o) => r._lanes >= 3 || (roads[o]._lanes | 0) >= 3 || (r._lanes >= 2 && (roads[o]._lanes | 0) >= 2);
      if (cwB) {
        cross(s1 - 4.3, s1 - 1.3);
        ribbon(r, s1 - 5.7, s1 - 5.3, r.oneway ? hw - 0.2 : 0, Y_PAINT, -hw + 0.2, Y_PAINT, base, 6, PAINT, 4);
        if (big(oB)) { net.pointAt(r, s1 - 5.5, -(hw + 0.6), pa); lights.push({ x: pa.x, z: pa.z, yaw: Math.atan2(pa.dx, pa.dz) }); }
      }
      if (cwA) {
        cross(s0 + 1.3, s0 + 4.3);
        if (!r.oneway) {
          ribbon(r, s0 + 5.3, s0 + 5.7, hw - 0.2, Y_PAINT, 0, Y_PAINT, base, 6, PAINT, 4);
          if (big(oA)) { net.pointAt(r, s0 + 5.5, hw + 0.6, pa); lights.push({ x: pa.x, z: pa.z, yaw: Math.atan2(-pa.dx, -pa.dz) }); }
        }
      }
    }
  }
  return { lights };
}

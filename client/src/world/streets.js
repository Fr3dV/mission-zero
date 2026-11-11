// Voirie, par tuile : chaussées, pastilles de carrefour, trottoirs à bordure, marquages au sol, glissières
// d'autoroute, rails, et ouvrages des routes dénivelées (tabliers et piles, remblais, trémies, tunnels).
// Construction paresseuse : buildTile(ix, iz) est un générateur repris d'image en image par le gestionnaire de tuiles.
import { baseHeightAt, hasHeightmap } from '@shared/terrain.js';
import { TILE, SurfBuilder, tileKeyI, tileKey } from './util.js';
import { L_ASPHALT, L_SIDEWALK, L_PAVE, L_PLAIN, L_GRASS, L_GRAVEL, L_STONE } from './textures.js';
import { deckHalf, TUNNEL_MIN } from './levels.js';

const BIKE = [150, 196, 160], WHITE = [255, 255, 255], CURB = [178, 176, 170], WALK = [232, 230, 226], PAINT = [255, 255, 255];
const CONCRETE = [176, 174, 168], DARKC = [92, 92, 94], STEEL = [96, 100, 106], TALUS = [200, 225, 170], LIGHT = [255, 226, 170];
// Ordre de couches STRICT des surfaces de sol (jamais deux matières différentes à la même hauteur) : chaque classe a
// sa hauteur franche (≥ 4 mm d'écart) ET son biais de profondeur (aSurf.y, appliqué en NDC dans le vertex shader, donc
// valable à toute distance). Du bas vers le haut :
//   sol -0,030 (b0) < rue piétonne pavée 0,008 (b1) < chaussée pavée 0,016 (b2) < chaussée bitume 0,024 (b3)
//   < disque de place 0,032 (b4) < bande cyclable 0,037 (b5) < peinture 0,042 (b6) ; trottoir 0,110 (b4) < bordure 0,115 (b5)
// Les raccords en pente (arrière et abouts de trottoir) s'arrêtent AU-DESSUS de la surface qu'ils rejoignent (pas de croisement).
// Deux rubans de MÊME classe peuvent se recouvrir à la même hauteur (carrefours) : même texture en coordonnées monde,
// même teinte, même normale → pixel identique quel que soit le gagnant du test de profondeur.
export const Y_PED = 0.008, Y_SETT = 0.016, Y_ROAD = 0.024, Y_ZONE = 0.032, Y_BIKE = 0.037, Y_PAINT = 0.042, Y_WALK = 0.11, Y_CURB = 0.115, Y_GROUND = -0.03;
/** [hauteur, biais] de la chaussée selon sa classe : 0 piétonne pavée, 1 pavée, 2 bitume. */
const ROAD_CLASS = [[Y_PED, 1], [Y_SETT, 2], [Y_ROAD, 3]];

/** Prépare une polyligne quelconque (rail) pour net.pointAt : abscisses cumulées, normales en onglet, élévation. */
function prepareLine(o) {
  const n = o.points.length, cum = new Float32Array(n), mx = new Float32Array(n), mz = new Float32Array(n);
  for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(o.points[k][0] - o.points[k - 1][0], o.points[k][1] - o.points[k - 1][1]);
  const dir = (k) => { const a = o.points[k], b = o.points[k + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  for (let k = 0; k < n; k++) {
    const d0 = dir(Math.max(0, k - 1)), d1 = dir(Math.min(n - 2, k));
    const n0x = d0[1], n0z = -d0[0], n1x = d1[1], n1z = -d1[0], dot = n0x * n1x + n0z * n1z, sc = 1 / Math.max(0.35, 1 + dot);
    mx[k] = (n0x + n1x) * sc; mz[k] = (n0z + n1z) * sc;
  }
  let ele = null;
  if (Array.isArray(o.ele) && o.ele.length === n && o.ele.some((v) => Math.abs(v) > 0.05)) ele = Float32Array.from(o.ele, (v) => +v || 0);
  for (const [k, v] of [['_cum', cum], ['_mx', mx], ['_mz', mz], ['_ele', ele], ['_len', cum[n - 1]], ['_hill', undefined]]) Object.defineProperty(o, k, { value: v, writable: true, enumerable: false, configurable: true });
}

export function createStreets(ctx, net, masks, profile, levels = null) {
  const { THREE } = ctx;
  const { roads } = net;
  const pa = { _k: 0 }, pb = { _k: 0 }, pc = { _k: 0 }, pd = { _k: 0 }, c0 = { _k: 0 }, c1 = { _k: 0 }, pm = { _k: 0 };
  const heightmap = hasHeightmap();
  const noLane = profile.noLaneMarkings || null;

  // --- rails (tram, train) : tronçons par tuile
  const railPieces = new Map();
  for (const rl of ctx.worldData.rails || []) {
    if (!rl || !Array.isArray(rl.points) || rl.points.length < 2 || rl.kind === 'cable') continue;
    if (rl.kind === 'metro' && !(Array.isArray(rl.ele) && rl.ele.some((v) => v > 1.5))) continue; // métro : seulement ses viaducs
    prepareLine(rl);
    let curKey = -1, sStart = 0; const ts = [];
    for (let k = 0; k < rl.points.length - 1; k++) {
      const a = rl.points[k], b = rl.points[k + 1], L = rl._cum[k + 1] - rl._cum[k];
      ts.length = 0; ts.push(0, 1);
      const cut = (p, q) => { if (p === q) return; const lo = Math.min(p, q), hi = Math.max(p, q); for (let g = Math.floor(lo / TILE) + 1; g * TILE < hi; g++) ts.push((g * TILE - p) / (q - p)); };
      cut(a[0], b[0]); cut(a[1], b[1]); if (ts.length > 2) ts.sort((p, q) => p - q);
      for (let i = 0; i + 1 < ts.length; i++) {
        const tm = (ts[i] + ts[i + 1]) / 2, key = tileKey(a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm);
        if (key !== curKey) { const s = rl._cum[k] + L * ts[i]; if (curKey >= 0 && s > sStart) { let arr = railPieces.get(curKey); if (!arr) railPieces.set(curKey, (arr = [])); arr.push([rl, sStart, s]); } curKey = key; sStart = s; }
      }
    }
    if (curKey >= 0) { let arr = railPieces.get(curKey); if (!arr) railPieces.set(curKey, (arr = [])); arr.push([rl, sStart, rl._len]); }
  }

  // cases (8 m) traversées par une voie ferrée au sol : un tablier routier qui les survole est un viaduc, pas un remblai
  const railCells = new Set(), railKey = (x, z) => (Math.floor(x / 8) + 8192) * 16384 + Math.floor(z / 8) + 8192;
  for (const rl of ctx.worldData.rails || []) {
    if (!rl || !rl._cum || rl.kind === 'metro') continue;
    const o = { _k: 0 };
    for (let s = 0; s <= rl._len; s += 6) { net.pointAt(rl, s, 0, o); if (Math.abs(o.e) < 1.5) railCells.add(railKey(o.x, o.z)); }
  }
  const railNear = (x, z) => railCells.size > 0 && (railCells.has(railKey(x, z)) || railCells.has(railKey(x + 6, z)) || railCells.has(railKey(x - 6, z)) || railCells.has(railKey(x, z + 6)) || railCells.has(railKey(x, z - 6)));

  const onHill = (r) => {
    if (r._hill !== undefined) return r._hill;
    let h = false; const h0 = baseHeightAt(r.points[0][0], r.points[0][1]);
    if (heightmap) h = true;
    else for (const p of r.points) if (Math.abs(baseHeightAt(p[0], p[1]) - h0) > 0.02 || h0 > 0.02) { h = true; break; }
    return (r._hill = h);
  };
  let B = null; // constructeur de la tuile en cours
  /**
   * Ruban entre deux décalages latéraux (offA à hauteur yA, offB à hauteur yB au-dessus de la chaussée) de s0 à s1.
   * mode ≥ 2 : uv = (décalage, s / period). Suit le relief (subdivision adaptative) et l'élévation de la route.
   */
  function ribbon(r, s0, s1, offA, yA, offB, yB, layer, bias, col, mode = 0, period = 1) {
    if (s1 - s0 < 0.05) return;
    const cum = r._cum, hill = onHill(r);
    const hc = (s) => { net.pointAt(r, s, 0, pm); return baseHeightAt(pm.x, pm.z); };
    // routes dénivelées : la hauteur vient de la couche des niveaux (raccords fondus aux carrefours), comme la physique
    const lvl = levels && r._i !== undefined && r._ele ? levels : null;
    const he = (s) => net.pointAt(r, s, 0, pm).e;
    const Y = (o, c) => { const own = net.deckY(o.x, o.z, c.x, c.z, c.e); return lvl && c.e !== 0 ? lvl.near(o.x, o.z, own) : own; };
    const quad = (a, b) => {
      // léger recul pour rester dans le bon segment (cadres d'onglet)
      net.pointAt(r, a + 1e-4, 0, c0); net.pointAt(r, b - 1e-4, 0, c1);
      net.pointAt(r, a + 1e-4, offA, pa); net.pointAt(r, a + 1e-4, offB, pb); net.pointAt(r, b - 1e-4, offB, pc); net.pointAt(r, b - 1e-4, offA, pd);
      const A = [pa.x, Y(pa, c0) + yA, pa.z], Bq = [pb.x, Y(pb, c0) + yB, pb.z];
      const C = [pc.x, Y(pc, c1) + yB, pc.z], D = [pd.x, Y(pd, c1) + yA, pd.z];
      const uvs = mode >= 2 ? [[offA, a / period], [offB, a / period], [offB, b / period], [offA, b / period]] : null;
      B.flatQuad(A, Bq, C, D, layer, bias, col, mode, uvs);
    };
    const span = (a, b, depth) => {
      if (depth < 7 && b - a > 2.4) {
        const m = (a + b) / 2;
        if ((lvl && b - a > 5 && (Math.abs(he(a)) > 0.02 || Math.abs(he(b)) > 0.02)) || (hill && depth < 6 && Math.abs(hc(m) - (hc(a) + hc(b)) / 2) > 0.012)) { span(a, m, depth + 1); span(m, b, depth + 1); return; }
      }
      quad(a, b);
    };
    // points de rupture : s0, sommets intermédiaires, s1
    let prev = s0, k = 0;
    while (k < cum.length - 1 && cum[k + 1] <= s0 + 1e-4) k++;
    for (;;) {
      const next = Math.min(s1, k < cum.length - 1 ? cum[k + 1] : s1);
      if (next <= prev + 1e-4) { if (next >= s1 - 1e-4) break; k++; continue; }
      span(prev, next, 0);
      prev = next;
      if (next >= s1 - 1e-4) break;
      k++;
    }
  }
  /** Hauteur absolue de la chaussée de r en son axe à l'abscisse s. */
  const axisY = (r, s, o) => { net.pointAt(r, s, 0, o); return baseHeightAt(o.x, o.z) + o.e; };
  /** Parcourt [sA, sB] par pas ≤ step en s'arrêtant aux sommets : cb(a, b). */
  function steps(r, sA, sB, step, cb) {
    const cum = r._cum; let prev = sA, k = 0;
    while (k < cum.length - 1 && cum[k + 1] <= sA + 1e-4) k++;
    for (;;) {
      const next = Math.min(sB, k < cum.length - 1 ? cum[k + 1] : sB);
      if (next > prev + 1e-3) { const n = Math.max(1, Math.ceil((next - prev) / step)); for (let i = 0; i < n; i++) cb(prev + ((next - prev) * i) / n, prev + ((next - prev) * (i + 1)) / n); prev = next; }
      if (next >= sB - 1e-4) break;
      k++;
    }
  }
  const box = (col, ax, az, bx, bz, hd, bottom, top, tag = 'parapet') => { const len = Math.hypot(bx - ax, bz - az); if (len > 0.2) col.push({ kind: 'box', x: (ax + bx) / 2, z: (az + bz) / 2, hw: len / 2 + 0.1, hd, rot: Math.atan2(-(bz - az), bx - ax), bottom, top, tag }); };

  // ------------------------------------------------------------------ un tronçon de route dans la tuile
  function roadPiece(col, r, sA, sB) {
    const pave = r._surf === 'sett', hw = r._hw, sw = r._sw;
    const [ry, rb] = ROAD_CLASS[r._cls]; r._y = ry; r._pave = pave;
    const baseL = pave ? L_PAVE : L_ASPHALT;
    ribbon(r, sA, sB, hw, ry, -hw, ry, baseL, rb, WHITE);

    // ---------- trottoirs
    if (sw > 0) for (const sgn of [1, -1]) {
      const clipped = (s) => {
        net.pointAt(r, s, sgn * (hw + 0.45), pa); if (net.insideOther(pa.x, pa.z, -0.1, r._i, -1, -1, false, pa.e) >= 0 || net.inZone(pa.x, pa.z)) return true;
        net.pointAt(r, s, sgn * (hw + sw - 0.15), pa); return net.insideOther(pa.x, pa.z, -0.1, r._i, -1, -1, false, pa.e) >= 0;
      };
      const emit = (s0, s1, cap0, cap1) => {
        if (s1 - s0 < 0.4) return;
        ribbon(r, s0, s1, sgn * (hw - 0.03), ry, sgn * hw, Y_CURB, L_PLAIN, 5, CURB);                     // face de bordure
        ribbon(r, s0, s1, sgn * hw, Y_CURB, sgn * (hw + 0.25), Y_CURB, L_PLAIN, 5, CURB);                 // dessus de bordure (granit), au-dessus du trottoir
        ribbon(r, s0, s1, sgn * (hw + 0.24), Y_WALK, sgn * (hw + sw), Y_WALK, L_SIDEWALK, 4, WALK);       // trottoir
        ribbon(r, s0, s1, sgn * (hw + sw), Y_WALK, sgn * (hw + sw + 0.9), Y_GROUND + 0.006, L_SIDEWALK, 4, WALK); // raccord arrière en pente douce
        // abouts (pentes courtes aux extrémités coupées par un carrefour ou en fin de voie)
        for (const [s, d, cap] of [[s0, -1, cap0], [s1, 1, cap1]]) {
          if (!cap || (s <= 0.01 && r._contA >= 0) || (s >= r._len - 0.01 && r._contB >= 0)) continue;
          net.pointAt(r, s, 0, c0); net.pointAt(r, s, sgn * hw, pa); net.pointAt(r, s, sgn * (hw + sw), pb);
          const ex = pa.dx * d * 0.35, ez = pa.dz * d * 0.35;
          const y0 = net.deckY(pa.x, pa.z, c0.x, c0.z, c0.e);
          B.flatQuad([pa.x, y0 + Y_CURB, pa.z], [pb.x, y0 + Y_CURB, pb.z], [pb.x + ex, y0 + Y_PAINT + 0.006, pb.z + ez], [pa.x + ex, y0 + Y_PAINT + 0.006, pa.z + ez], L_PLAIN, 5, CURB);
        }
      };
      const STEP = 2.5, n = Math.max(1, Math.ceil((sB - sA) / STEP));
      let prevS = sA, prevC = clipped(sA), start = prevC ? -1 : sA, startCap = sA <= 0.01;
      for (let i = 1; i <= n; i++) {
        const s = sA + ((sB - sA) * i) / n, c = clipped(s);
        if (c !== prevC) {
          let a = prevS, b = s;
          for (let it = 0; it < 4; it++) { const m = (a + b) / 2; if (clipped(m) === prevC) a = m; else b = m; }
          if (c) { emit(start, a, startCap, true); start = -1; } else { start = b; startCap = true; }
        }
        prevS = s; prevC = c;
      }
      if (start >= 0) emit(start, sB, startCap, sB >= r._len - 0.01);
    }

    // ---------- marquages
    if (!r._ped && !r.uturn && !(noLane && noLane.test(r.name || ''))) {
      const lanes = Math.max(1, r._lanes | 0), laneW = r._w / lanes, per = r._mw ? 13 : 6;
      const lines = []; // [décalage, continu?]
      if (!r.oneway && lanes >= 2) {
        lines.push([0, lanes >= 4]);
        for (let k = 1; k < lanes / 2; k++) { lines.push([k * laneW, false]); lines.push([-k * laneW, false]); }
      } else if (r.oneway && lanes >= 2) {
        for (let k = 1; k < lanes; k++) lines.push([(k - lanes / 2) * laneW, false]);
      }
      if (r._mw) { lines.push([hw - 0.35, true]); lines.push([-(hw - 0.35), true]); } // lignes de rive
      // piste cyclable sur les grands axes : bande teintée + ligne continue côté trottoir
      const bike = (r.cycleway === true || r._w >= 9.5) && !pave && !r._mw && (r.cycleway === true || r.kind === 'avenue' || r.kind === 'boulevard' || r.kind === 'quay');
      const own = (s) => s >= sA && s < sB; // un motif ponctuel appartient à la tuile qui contient son début
      for (const f of net.runsInfo(r)) {
        const a = Math.max(f.a, sA), b = Math.min(f.b, sB);
        if (b - a > 0.3 && f.b - f.a > 3) for (const [off, solid] of lines) ribbon(r, a, b, off + 0.075, Y_PAINT, off - 0.075, Y_PAINT, baseL, 6, PAINT, solid ? 4 : 2, per);
        if (bike && f.b - f.a > 12) for (const sg of r.oneway ? [-1] : [-1, 1]) {
          if (b - a > 0.3) { ribbon(r, a, b, sg * (hw - 0.12), Y_BIKE, sg * (hw - 1.55), Y_BIKE, baseL, 5, BIKE); ribbon(r, a, b, sg * (hw - 1.55), Y_PAINT, sg * (hw - 1.7), Y_PAINT, baseL, 6, PAINT, 4); }
          // pictogrammes simplifiés (chevrons) tous les 40 m
          for (let s = f.a + 6; s < f.b - 4; s += 40) if (own(s)) ribbon(r, s, s + 1.6, sg * (hw - 0.5), Y_PAINT, sg * (hw - 1.2), Y_PAINT, baseL, 6, PAINT, 2, 0.8);
        }
        const cross = (sa, sb) => ribbon(r, sa, sb, hw - 0.3, Y_PAINT, -hw + 0.3, Y_PAINT, baseL, 6, PAINT, 3, 1);
        if (f.cwB && own(f.s1 - 5.7)) { cross(f.s1 - 4.3, f.s1 - 1.3); ribbon(r, f.s1 - 5.7, f.s1 - 5.3, r.oneway ? hw - 0.2 : 0, Y_PAINT, -hw + 0.2, Y_PAINT, baseL, 6, PAINT, 4); }
        if (f.cwA && own(f.s0 + 1.3)) { cross(f.s0 + 1.3, f.s0 + 4.3); if (!r.oneway) ribbon(r, f.s0 + 5.3, f.s0 + 5.7, hw - 0.2, Y_PAINT, 0, Y_PAINT, baseL, 6, PAINT, 4); }
        // ---------- autoroutes et voies rapides : séparateur en béton côté gauche, glissière métallique côté droit
        if (r._mw && b - a > 2) steps(r, a, b, 24, (u, v) => {
          const ya = axisY(r, u, c0), ea = c0.e, yb = axisY(r, v, c1), eb = c1.e;
          if (Math.abs(ea) > 0.7 || Math.abs(eb) > 0.7) return; // les ouvrages dénivelés ont leurs propres parapets
          const sides = r.oneway ? (r.kind === 'ramp' ? [[-1, 0]] : [[1, 1], [-1, 0]]) : [[1, 0], [-1, 0]];
          for (const [sg, concrete] of sides) {
            net.pointAt(r, u + 1e-3, sg * (hw + 0.45), pa); net.pointAt(r, v - 1e-3, sg * (hw + 0.45), pb);
            if (net.insideOther(pa.x, pa.z, 0.3, r._i, r._contA, r._contB, false, ea) >= 0 || net.insideOther(pb.x, pb.z, 0.3, r._i, r._contA, r._contB, false, eb) >= 0) continue;
            const y0 = baseHeightAt(pa.x, pa.z) + ea, y1 = baseHeightAt(pb.x, pb.z) + eb;
            if (concrete) B.prism(pa.x, pa.z, pb.x, pb.z, 0.5, y0, y1, 0.85, L_PLAIN, CONCRETE, false);
            else { B.prism(pa.x, pa.z, pb.x, pb.z, 0.1, y0 + 0.42, y1 + 0.42, 0.3, L_PLAIN, STEEL, false); B.prism(pa.x, pa.z, pa.x + (pb.x - pa.x) * 0.02, pa.z + (pb.z - pa.z) * 0.02, 0.12, y0, y0, 0.6, L_PLAIN, STEEL, false); }
            box(col, pa.x, pa.z, pb.x, pb.z, 0.3, Math.min(y0, y1) - 0.6, Math.max(y0, y1) + 1.5, 'glissiere');
          }
        });
      }
    }

    // ---------- ouvrages des routes dénivelées
    if (r._ele) levelPiece(col, r, sA, sB);
    if (levels && levels.trenches) overPiece(col, r, sA, sB);
  }

  // ------------------------------------------------------------------ tabliers, remblais, trémies, tunnels
  function levelPiece(col, r, sA, sB) {
    const W = deckHalf(r), hw = r._hw, sw = r._sw, ry = r._y;
    let prevCovered = null, prevVia = null;
    const P = (s, off, o) => net.pointAt(r, s, off, o);
    // quelque chose passe-t-il dessous (rue restée au sol, voie ferrée, eau) ? -> viaduc plutôt que remblai
    const crossed = (a, b) => {
      for (const s of [a, (a + b) / 2, b]) for (const off of [0, W, -W]) { P(s, off, pm); if (net.groundCover(pm.x, pm.z) > 0 || railNear(pm.x, pm.z) || masks.isWater(pm.x, pm.z)) return true; }
      return false;
    };
    // une autre chaussée du même niveau se raccorde-t-elle ici ? (pas de parapet en travers d'un carrefour)
    const joined = (o, e, pad) => net.insideOther(o.x, o.z, pad, r._i, -1, -1, true, e) >= 0;
    steps(r, sA, sB, 8, (a, b) => {
      const ya = axisY(r, a + 1e-3, c0), ea = c0.e, ax = c0.x, az = c0.z; const dxn = c0.dx, dzn = c0.dz;
      const yb = axisY(r, b - 1e-3, c1), eb = c1.e, bx = c1.x, bz = c1.z;
      const em = (ea + eb) / 2;
      if (Math.abs(em) < 0.25) { prevCovered = null; prevVia = null; return; }
      // accotement jusqu'au bord de l'ouvrage (routes sans trottoir)
      if (sw <= 0) for (const sg of [1, -1]) ribbon(r, a, b, sg * hw, ry, sg * (W + 0.25), ry, L_ASPHALT, r._cls + 1, [225, 225, 225]);
      if (em > 0) {
        // ======== tablier ou rampe au-dessus du sol
        const via = em >= 4.2 || (em > 2.3 && crossed(a, b));
        for (const sg of [1, -1]) {
          const nx = sg * dzn, nz = -sg * dxn; // normale sortante
          if (em > 0.7) for (let h = 0; h < 2; h++) { // parapet de béton par demi-pas + collision propre à ce niveau
            const u = a + ((b - a) * h) / 2, v = a + ((b - a) * (h + 1)) / 2, yu = ya + ((yb - ya) * h) / 2, yv = ya + ((yb - ya) * (h + 1)) / 2;
            P(u + 1e-3, sg * (W + 0.08), pa); P(v - 1e-3, sg * (W + 0.08), pb);
            pm.x = (pa.x + pb.x) / 2; pm.z = (pa.z + pb.z) / 2;
            if (joined(pm, em, 0.5) || joined(pa, em, 0.3) || joined(pb, em, 0.3)) continue;
            B.prism(pa.x, pa.z, pb.x, pb.z, 0.3, yu, yv, 0.95, L_PLAIN, CONCRETE, false);
            box(col, pa.x, pa.z, pb.x, pb.z, 0.25, Math.min(yu, yv) - 0.5, Math.max(yu, yv) + 1.7);
          }
          P(a + 1e-3, sg * (W + 0.25), pa); P(b - 1e-3, sg * (W + 0.25), pb);
          if (via) {
            // viaduc : rive du tablier (1,1 m)
            B.wall(pa.x, pa.z, pb.x, pb.z, ya - 1.1, ya + 0.02, yb - 1.1, yb + 0.02, nx, nz, L_PLAIN, CONCRETE, a);
          } else {
            // remblai : talus engazonné (pente 3/2), ou mur de soutènement s'il n'y a pas la place (autre voie, eau)
            const run = 1.5 * em;
            P(a + 1e-3, sg * (W + 0.25 + 1.5 * ea), pc); P(b - 1e-3, sg * (W + 0.25 + 1.5 * eb), pd);
            const mx = (pc.x + pd.x) / 2, mz = (pc.z + pd.z) / 2;
            const blocked = run > 0.6 && (net.roadAtPad(mx, mz, 0.4, false, 0) || masks.isWater(mx, mz));
            if (blocked) {
              B.wall(pa.x, pa.z, pb.x, pb.z, baseHeightAt(pa.x, pa.z) - 0.1, ya + 0.02, baseHeightAt(pb.x, pb.z) - 0.1, yb + 0.02, nx, nz, L_PLAIN, CONCRETE, a);
              if (em > 1) box(col, pa.x, pa.z, pb.x, pb.z, 0.25, -Infinity, Math.min(ya, yb) - 0.4, 'remblai');
            } else {
              B.flatQuad([pa.x, ya - 0.03, pa.z], [pb.x, yb - 0.03, pb.z], [pd.x, baseHeightAt(pd.x, pd.z) - 0.02, pd.z], [pc.x, baseHeightAt(pc.x, pc.z) - 0.02, pc.z], L_GRASS, 1, TALUS);
              if (em > 1) box(col, pc.x, pc.z, pd.x, pd.z, 0.25, -Infinity, Math.min(ya, yb) - 0.4, 'remblai');
            }
          }
        }
        // culée : mur de front sous le tablier, là où le remblai laisse place au viaduc
        if (prevVia !== null && prevVia !== via && ea > 1.2) {
          P(a + 1e-3, W + 0.25, pa); P(a + 1e-3, -(W + 0.25), pb);
          const g = Math.min(baseHeightAt(pa.x, pa.z), baseHeightAt(pb.x, pb.z)) - 0.1, d = via ? 1 : -1;
          B.wall(pa.x, pa.z, pb.x, pb.z, g, ya - 0.05, g, ya - 0.05, d * dxn, d * dzn, L_PLAIN, CONCRETE, 0);
          B.wall(pb.x, pb.z, pa.x, pa.z, g, ya - 0.05, g, ya - 0.05, -d * dxn, -d * dzn, L_PLAIN, CONCRETE, 0);
          box(col, pa.x, pa.z, pb.x, pb.z, 0.3, -Infinity, ya - 0.5, 'remblai');
        }
        prevVia = via;
        if (via) {
          // sous-face du tablier + piles (hors des voies, des rails et de l'eau qu'on enjambe)
          P(a + 1e-3, W + 0.25, pa); P(a + 1e-3, -(W + 0.25), pb); P(b - 1e-3, -(W + 0.25), pc); P(b - 1e-3, W + 0.25, pd);
          const i0 = B.v(pa.x, ya - 1.1, pa.z, 0, a, L_PLAIN, 0, 1, DARKC, 0, -1, 0), i1 = B.v(pb.x, ya - 1.1, pb.z, 2 * W, a, L_PLAIN, 0, 1, DARKC, 0, -1, 0);
          const i2 = B.v(pc.x, yb - 1.1, pc.z, 2 * W, b, L_PLAIN, 0, 1, DARKC, 0, -1, 0), i3 = B.v(pd.x, yb - 1.1, pd.z, 0, b, L_PLAIN, 0, 1, DARKC, 0, -1, 0);
          B.idx.push(i0, i1, i2, i0, i2, i3, i0, i2, i1, i0, i3, i2);
          const k0 = Math.ceil(a / 24), sp = k0 * 24;
          if (sp < b && em > 3) for (const sg of W > 5 ? [1, -1] : [0]) {
            P(sp, sg * Math.min(W * 0.55, W - 1.2), pa);
            if (net.roadAtPad(pa.x, pa.z, 1.6, false, 0) || masks.isWater(pa.x, pa.z) || railNear(pa.x, pa.z)) continue;
            const yt = ya + ((yb - ya) * (sp - a)) / (b - a) - 1.1, y0 = baseHeightAt(pa.x, pa.z) - 0.3;
            B.prism(pa.x - pa.dx * 0.6, pa.z - pa.dz * 0.6, pa.x + pa.dx * 0.6, pa.z + pa.dz * 0.6, 1.2, y0, y0, yt - y0, L_PLAIN, CONCRETE, true);
            B.prism(pa.x - pa.dx * 0.8, pa.z - pa.dz * 0.8, pa.x + pa.dx * 0.8, pa.z + pa.dz * 0.8, Math.min(2.6, W), yt - 0.5, yt - 0.5, 0.5, L_PLAIN, CONCRETE, true);
            col.push({ kind: 'circle', x: pa.x, z: pa.z, r: 0.85, bottom: -Infinity, top: yt - 0.2, tag: 'pile' });
          }
        }
        prevCovered = null;
      } else {
        // ======== trémie ou tranchée (ouverte), tunnel (couvert)
        prevVia = null;
        const covered = !!r.tunnel && em < TUNNEL_MIN;
        const gA = baseHeightAt(ax, az), gB = baseHeightAt(bx, bz);
        const ceilA = Math.min(ya + 5.2, gA - 0.7), ceilB = Math.min(yb + 5.2, gB - 0.7);
        for (const sg of [1, -1]) {
          const nx = -sg * dzn, nz = sg * dxn; // normale vers la chaussée
          // murs par demi-pas, ouverts là où une autre chaussée du même niveau débouche (carrefour au fond de la tranchée)
          for (let h = 0; h < 2; h++) {
            const u = a + ((b - a) * h) / 2, v = a + ((b - a) * (h + 1)) / 2, yu = ya + ((yb - ya) * h) / 2, yv = ya + ((yb - ya) * (h + 1)) / 2;
            const cu = ceilA + ((ceilB - ceilA) * h) / 2, cv = ceilA + ((ceilB - ceilA) * (h + 1)) / 2;
            P(u + 1e-3, sg * (W + 0.25), pa); P(v - 1e-3, sg * (W + 0.25), pb);
            pm.x = (pa.x + pb.x) / 2; pm.z = (pa.z + pb.z) / 2;
            if (joined(pm, em, 0.3) || joined(pa, em, 0.1) || joined(pb, em, 0.1)) continue;
            const ta = covered ? cu : baseHeightAt(pa.x, pa.z) + 0.02, tb = covered ? cv : baseHeightAt(pb.x, pb.z) + 0.02;
            B.wall(pa.x, pa.z, pb.x, pb.z, yu - 0.05, ta, yv - 0.05, tb, nx, nz, L_PLAIN, covered ? [150, 148, 142] : CONCRETE, u);
            if (covered) {
              box(col, pa.x, pa.z, pb.x, pb.z, 0.3, -Infinity, Math.max(cu, cv) + 0.3, 'tunnel');
              // rampe lumineuse au-dessus des voies
              if (Math.floor(u / 8) % 2 === 0 && h === 0) { const y0 = yu + 3.6, y1 = yv + 3.6; const q = (o, y) => [o.x + nx * 0.06, y, o.z + nz * 0.06]; B.flatQuad(q(pa, y0), q(pb, y1), q(pb, y1 + 0.25), q(pa, y0 + 0.25), L_PLAIN, 6, LIGHT, 5, [[0, 0], [1, 0], [1, 1], [0, 1]]); B.idx.push(B.n - 4, B.n - 2, B.n - 3, B.n - 4, B.n - 1, B.n - 2); }
            } else if (em < -0.7) box(col, pa.x, pa.z, pb.x, pb.z, 0.3, -Infinity, Math.min(baseHeightAt(pa.x, pa.z), baseHeightAt(pb.x, pb.z)) - 0.35, 'tremie'); // niveau bas seulement : la rue qui enjambe passe au-dessus
          }
          if (!covered) {
            // couronnement au niveau du sol (recouvre le bord du sol évidé par le masque)
            const o0 = sg * (W - 0.2), o1 = sg * (W + 1.5);
            P(a + 1e-3, o0, pc); P(a + 1e-3, o1, pd); const A0 = [pc.x, baseHeightAt(pc.x, pc.z) + 0.1, pc.z], A1 = [pd.x, baseHeightAt(pd.x, pd.z) + 0.1, pd.z];
            P(b - 1e-3, o0, pc); P(b - 1e-3, o1, pd);
            B.flatQuad(A0, [pc.x, baseHeightAt(pc.x, pc.z) + 0.1, pc.z], [pd.x, baseHeightAt(pd.x, pd.z) + 0.1, pd.z], A1, L_PLAIN, 6, CONCRETE);
            // garde-corps + collision au niveau du sol, par demi-pas, ouvert là où une rue au sol enjambe la tranchée
            // (et là où deux tranchées se rejoignent : pas de garde-corps au-dessus du vide)
            if (em < -0.7) for (let h = 0; h < 2; h++) {
              const u = a + ((b - a) * h) / 2, v = a + ((b - a) * (h + 1)) / 2;
              P(u + 1e-3, sg * (W + 0.45), pc); P(v - 1e-3, sg * (W + 0.45), pd);
              pm.x = (pc.x + pd.x) / 2; pm.z = (pc.z + pd.z) / 2;
              if (joined(pm, 0, 0.2) || joined(pc, 0, 0) || joined(pd, 0, 0) || joined(pm, em, 0.3)) continue;
              const g0 = baseHeightAt(pc.x, pc.z), g1 = baseHeightAt(pd.x, pd.z);
              B.prism(pc.x, pc.z, pd.x, pd.z, 0.25, g0 + 0.1, g1 + 0.1, 0.9, L_PLAIN, CONCRETE, false);
              box(col, pc.x, pc.z, pd.x, pd.z, 0.3, Math.min(g0, g1) - 0.35, Math.max(g0, g1) + 1.2, 'tremie');
            }
          }
        }
        if (covered) {
          // dalle de couverture (sous-face)
          P(a + 1e-3, W + 0.25, pa); P(a + 1e-3, -(W + 0.25), pb); P(b - 1e-3, -(W + 0.25), pc); P(b - 1e-3, W + 0.25, pd);
          const i0 = B.v(pa.x, ceilA, pa.z, 0, a, L_PLAIN, 0, 1, DARKC, 0, -1, 0), i1 = B.v(pb.x, ceilA, pb.z, 2 * W, a, L_PLAIN, 0, 1, DARKC, 0, -1, 0);
          const i2 = B.v(pc.x, ceilB, pc.z, 2 * W, b, L_PLAIN, 0, 1, DARKC, 0, -1, 0), i3 = B.v(pd.x, ceilB, pd.z, 0, b, L_PLAIN, 0, 1, DARKC, 0, -1, 0);
          B.idx.push(i0, i1, i2, i0, i2, i3, i0, i2, i1, i0, i3, i2);
        }
        // tête de tunnel : mur de front entre la dalle et le sol, à la transition tranchée ↔ tunnel
        if (prevCovered !== null && prevCovered !== covered) {
          P(a + 1e-3, W + 0.25, pa); P(a + 1e-3, -(W + 0.25), pb);
          B.wall(pa.x, pa.z, pb.x, pb.z, ceilA, gA + 0.9, ceilA, gA + 0.9, covered ? -dxn : dxn, covered ? -dzn : dzn, L_PLAIN, CONCRETE, 0);
          box(col, pa.x, pa.z, pb.x, pb.z, 0.3, ceilA - 0.2, gA + 1.2, 'tunnel');
        }
        prevCovered = covered;
      }
    });
  }

  // ------------------------------------------------------------------ rue restée au sol qui enjambe une tranchée
  function overPiece(col, r, sA, sB) {
    const off = r._hw + r._sw + 0.25;
    const scan = (o, step, emit) => {
      const deep = (s) => { net.pointAt(r, s, o, pm); return pm.e === 0 && levels.trenchDepth(pm.x, pm.z) > 1.2; };
      const n = Math.max(1, Math.ceil((sB - sA) / step));
      let prevS = sA, prev = deep(sA), start = prev ? sA : -1, any = false;
      for (let i = 1; i <= n; i++) {
        const s = sA + ((sB - sA) * i) / n, d = deep(s);
        if (d !== prev) {
          let lo = prevS, hi = s; for (let it = 0; it < 4; it++) { const m = (lo + hi) / 2; if (deep(m) === prev) lo = m; else hi = m; }
          if (d) start = hi; else { emit(start, lo); any = true; start = -1; }
        }
        prevS = s; prev = d;
      }
      if (start >= 0) { emit(start, sB); any = true; }
      return any;
    };
    // sous-face de la dalle (vue depuis la tranchée)
    const found = scan(0, 3, (a, b) => {
      const u = Math.max(0, a - 1), v = Math.min(r._len, b + 1);
      net.pointAt(r, u, off, pa); net.pointAt(r, u, -off, pb); net.pointAt(r, v, -off, pc); net.pointAt(r, v, off, pd);
      const ya = baseHeightAt(pa.x, pa.z) - 0.8, yb = baseHeightAt(pd.x, pd.z) - 0.8;
      const i0 = B.v(pa.x, ya, pa.z, 0, u, L_PLAIN, 0, 1, DARKC, 0, -1, 0), i1 = B.v(pb.x, ya, pb.z, 2 * off, u, L_PLAIN, 0, 1, DARKC, 0, -1, 0);
      const i2 = B.v(pc.x, yb, pc.z, 2 * off, v, L_PLAIN, 0, 1, DARKC, 0, -1, 0), i3 = B.v(pd.x, yb, pd.z, 0, v, L_PLAIN, 0, 1, DARKC, 0, -1, 0);
      B.idx.push(i0, i1, i2, i0, i2, i3, i0, i2, i1, i0, i3, i2);
    });
    if (!found) return;
    // rives : parapet (collision au niveau de la rue) + bandeau de la dalle
    for (const sg of [1, -1]) scan(sg * off, 2, (a, b) => {
      const u0 = Math.max(0, a - 0.8), v0 = Math.min(r._len, b + 0.8), n = Math.max(1, Math.ceil((v0 - u0) / 3));
      for (let i = 0; i < n; i++) {
        const u = u0 + ((v0 - u0) * i) / n, v = u0 + ((v0 - u0) * (i + 1)) / n;
        net.pointAt(r, u, sg * off, pa); net.pointAt(r, v, sg * off, pb);
        // pas de parapet en travers d'une autre rue qui débouche sur l'ouvrage (carrefour sur dalle)
        pm.x = (pa.x + pb.x) / 2; pm.z = (pa.z + pb.z) / 2;
        const open = (o) => net.insideOther(o.x, o.z, 0.4, r._i, -1, -1, true, 0) >= 0;
        if (open(pm) || open(pa) || open(pb)) continue;
        const ya = baseHeightAt(pa.x, pa.z), yb = baseHeightAt(pb.x, pb.z);
        B.prism(pa.x, pa.z, pb.x, pb.z, 0.24, ya, yb, 1.0, L_PLAIN, CONCRETE, false);
        B.wall(pa.x, pa.z, pb.x, pb.z, ya - 0.8, ya + 0.02, yb - 0.8, yb + 0.02, sg * pa.dz, -sg * pa.dx, L_PLAIN, CONCRETE, u);
        box(col, pa.x, pa.z, pb.x, pb.z, 0.25, Math.min(ya, yb) - 0.5, Math.max(ya, yb) + 1.7);
      }
    });
  }

  // ------------------------------------------------------------------ rails
  function railPiece(rl, sA0, sB0, col) {
    const tram = rl.kind === 'tram';
    // le métro n'est dessiné que là où il sort de terre (viaduc)
    const parts = [];
    if (rl.kind === 'metro') steps(rl, sA0, sB0, 12, (a, b) => { if (net.pointAt(rl, (a + b) / 2, 0, pm).e > 1) parts.push([a, b]); }); else parts.push([sA0, sB0]);
    for (const [sA, sB] of parts) {
      if (tram) ribbon(rl, sA, sB, 1.35, Y_ZONE, -1.35, Y_ZONE, L_PAVE, 4, [205, 200, 190]);
      else {
        // plateforme ferroviaire : ballast légèrement surélevé, traverses
        ribbon(rl, sA, sB, 1.9, 0.22, -1.9, 0.22, L_GRAVEL, 4, [118, 108, 100]);
        for (const sg of [1, -1]) ribbon(rl, sA, sB, sg * 1.9, 0.22, sg * 2.6, Y_GROUND + 0.006, L_GRAVEL, 4, [118, 108, 100]);
        ribbon(rl, sA, sB, 1.25, 0.235, -1.25, 0.235, L_GRAVEL, 5, [70, 52, 40], 2, 0.62);
      }
      const yr = tram ? Y_PAINT : 0.3;
      for (const o of [0.7175, -0.7175]) ribbon(rl, sA, sB, o + 0.05, yr, o - 0.05, yr, L_PLAIN, 6, STEEL, 4);
    }
    // voie en élévation (pont-rail, viaduc du tram ou du métro) : tablier, rives et piles
    if (rl._ele) steps(rl, sA0, sB0, 12, (a, b) => {
      const ya = axisY(rl, a + 1e-3, c0), ea = c0.e, dxn = c0.dx, dzn = c0.dz, yb = axisY(rl, b - 1e-3, c1), eb = c1.e;
      if ((ea + eb) / 2 < 1.5) return;
      const W = 2.9;
      for (const sg of [1, -1]) { net.pointAt(rl, a + 1e-3, sg * W, pa); net.pointAt(rl, b - 1e-3, sg * W, pb); B.wall(pa.x, pa.z, pb.x, pb.z, ya - 1.2, ya + 0.55, yb - 1.2, yb + 0.55, sg * dzn, -sg * dxn, L_PLAIN, CONCRETE, a); B.wall(pb.x, pb.z, pa.x, pa.z, yb - 0.05, yb + 0.55, ya - 0.05, ya + 0.55, -sg * dzn, sg * dxn, L_PLAIN, CONCRETE, a); }
      net.pointAt(rl, a + 1e-3, W, pa); net.pointAt(rl, a + 1e-3, -W, pb); net.pointAt(rl, b - 1e-3, -W, pc); net.pointAt(rl, b - 1e-3, W, pd);
      for (const [dy, col2, ny] of [[-1.2, DARKC, -1], [-0.04, CONCRETE, 1]]) {
        const i0 = B.v(pa.x, ya + dy, pa.z, 0, a, L_PLAIN, 0, 1, col2, 0, ny, 0), i1 = B.v(pb.x, ya + dy, pb.z, 2 * W, a, L_PLAIN, 0, 1, col2, 0, ny, 0);
        const i2 = B.v(pc.x, yb + dy, pc.z, 2 * W, b, L_PLAIN, 0, 1, col2, 0, ny, 0), i3 = B.v(pd.x, yb + dy, pd.z, 0, b, L_PLAIN, 0, 1, col2, 0, ny, 0);
        if (ny < 0) B.idx.push(i0, i1, i2, i0, i2, i3); else B.idx.push(i0, i2, i1, i0, i3, i2);
      }
      const sp = Math.ceil(a / 24) * 24;
      if (sp < b) {
        net.pointAt(rl, sp, 0, pa);
        if (!(net.roadAtPad(pa.x, pa.z, 1.8, false, 0) || masks.isWater(pa.x, pa.z))) {
          const yt = ya + ((yb - ya) * (sp - a)) / (b - a) - 1.2, y0 = baseHeightAt(pa.x, pa.z) - 0.3;
          B.prism(pa.x - pa.dx * 0.7, pa.z - pa.dz * 0.7, pa.x + pa.dx * 0.7, pa.z + pa.dz * 0.7, 1.7, y0, y0, yt - y0, L_PLAIN, CONCRETE, true);
          if (col) col.push({ kind: 'circle', x: pa.x, z: pa.z, r: 1.0, bottom: -Infinity, top: yt - 0.2, tag: 'pile' });
        }
      }
    });
  }

  // ------------------------------------------------------------------ tuile
  const fan = (x, z, R, yOff, e, layer, bias, col, N) => {
    const yc = baseHeightAt(x, z) + e;
    const c = B.v(x, yc + yOff, z, x, z, layer, bias, 0, col); let first = -1, prev = -1;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
      const v = B.v(px, net.deckY(px, pz, x, z, e) + yOff, pz, px, pz, layer, bias, 0, col);
      if (i === 0) first = v; else B.tri(c, v, prev);
      prev = v;
    }
    B.tri(c, first, prev);
  };
  /** Générateur : ajoute la voirie de la tuile (ix, iz) au constructeur `mine` et ses collisions par niveau à `col`. */
  function* buildInto(ix, iz, mine, col) {
    const key = tileKeyI(ix, iz);
    let n = 0;
    for (const [ri, sA, sB] of net.tilePieces.get(key) || []) { B = mine; roadPiece(col, roads[ri], sA, sB); if ((++n & 1) === 0) yield; }
    B = mine;
    // pastilles aux carrefours (comblent les coins entre rubans) : classe la plus haute des voies du nœud,
    // donc coplanaires avec des rubans de MÊME matière seulement
    for (const e of net.tileJunctions.get(key) || []) { const [cy, cb] = ROAD_CLASS[e.cls]; fan(e.p[0], e.p[1], e.maxHw, cy, e.e, e.cls === 2 ? L_ASPHALT : L_PAVE, cb, WHITE, 12); }
    yield; B = mine;
    // places entièrement revêtues : disque pavé + plateau central surélevé à bordure de granit
    for (const q of net.tileZones.get(key) || []) {
      fan(q.x, q.z, q.r, Y_ZONE, 0, L_PAVE, 4, WHITE, 64); // au-dessus de tous les rubans : pavage uniforme, sans raccords
      if (q.island) {
        fan(q.x, q.z, q.island, Y_WALK, 0, L_PAVE, 4, [215, 208, 196], 64);
        const h0 = baseHeightAt(q.x, q.z);
        for (let i = 0; i < 64; i++) { // bordure
          const a0 = (i / 64) * Math.PI * 2, a1 = ((i + 1) / 64) * Math.PI * 2;
          const P = (a, R, y) => [q.x + Math.cos(a) * R, h0 + y, q.z + Math.sin(a) * R];
          B.flatQuad(P(a0, q.island + 0.35, Y_ZONE), P(a1, q.island + 0.35, Y_ZONE), P(a1, q.island, Y_CURB), P(a0, q.island, Y_CURB), L_PLAIN, 5, CURB);
        }
      }
    }
    for (const [rl, sA, sB] of railPieces.get(key) || []) { B = mine; railPiece(rl, sA, sB, col); if ((++n & 3) === 0) yield; }
    B = null;
  }
  /** Générateur : voirie d'un groupe de k×k tuiles (ix, iz en unités de k·TILE) ; retourne { geo, col }. */
  function* buildTile(ix, iz, k = 1) {
    const mine = new SurfBuilder(4096), col = [];
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) yield* buildInto(ix * k + a, iz * k + b, mine, col);
    return { geo: mine.build(THREE), col };
  }
  const hasOne = (ix, iz) => { const k = tileKeyI(ix, iz); return net.tilePieces.has(k) || net.tileJunctions.has(k) || net.tileZones.has(k) || railPieces.has(k); };
  return {
    buildTile,
    hasGroup: (ix, iz, k) => { for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) if (hasOne(ix * k + a, iz * k + b)) return true; return false; },
    has: (ix, iz) => { const k = tileKeyI(ix, iz); return net.tilePieces.has(k) || net.tileJunctions.has(k) || net.tileZones.has(k) || railPieces.has(k); },
    stone: L_STONE,
  };
}

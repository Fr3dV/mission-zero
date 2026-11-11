// Réseau routier : index spatial typé sur les segments (toute la ville, instantané partout), requêtes
// (roadAt, plus proche point, point aléatoire), continuités entre tronçons, découpe aux carrefours,
// niveaux superposés (`ele` par sommet) et répartition des tronçons par tuile pour la construction paresseuse.
import { baseHeightAt } from '@shared/terrain.js';
import { mulberry32, TILE, tileKey } from './util.js';

const CELL = 48, PAD = 8;
const LEVEL_GAP = 2.2; // deux chaussées à plus de 2,2 m d'écart vertical ne se « voient » pas (pont / rue en dessous)

export function sidewalkWidth(r) {
  if (r.kind === 'pedestrian' || r.kind === 'motorway' || r.kind === 'trunk' || r.kind === 'ramp') return 0;
  if (r.kind === 'avenue' || r.kind === 'boulevard') return r.width >= 9 ? 5 : 4;
  if (r.kind === 'quay') return 3;
  return r.width >= 9 ? 3.2 : 2.3;
}

function applyProfile(r, profile) {
  let p = null;
  for (const [re, prof] of profile.roadProfiles || []) if (re.test(r.name || '')) { p = prof; break; }
  r._w = r.width; r._lanes = r.lanes | 0;
  r._mw = r.kind === 'motorway' || r.kind === 'trunk' || r.kind === 'ramp';
  r._trees = r.kind === 'pedestrian' || r._mw ? 0 : (r.kind === 'avenue' || r.kind === 'boulevard' || r.kind === 'quay') ? 1 : 0;
  r._surf = r.kind === 'pedestrian' ? 'sett' : 'asphalt';
  let sw = sidewalkWidth(r);
  if (p) {
    if (p.width && !r.oneway && r.width < p.width) { r._w = p.width; r._lanes = p.lanes || r._lanes; }
    if (p.sidewalk) sw = p.sidewalk;
    if (p.trees !== undefined) r._trees = p.trees;
    if (p.surface) r._surf = p.surface;
  }
  // données enrichies (contrats v3 / v5) : prioritaires sur les valeurs par défaut
  if (typeof r.sidewalk === 'number' && r.sidewalk >= 0 && r.kind !== 'pedestrian' && !r._mw) sw = Math.min(25, r.sidewalk);
  if (r.surface === 'sett' || r.surface === 'paving_stones' || r.surface === 'cobblestone') r._surf = 'sett'; else if (r.surface === 'asphalt' && !(p && p.surface)) r._surf = 'asphalt';
  if (typeof r.treeLined === 'boolean' && !(p && p.trees !== undefined)) r._trees = r.treeLined ? Math.max(1, r._trees) : 0;
  // voies de desserte (parkings, zones d'activité, aéroport), sites propres bus, boucles de demi-tour : ni trottoir ni arbres
  if (r.service || r.busway || r.uturn) { sw = 0; r._trees = 0; }
  if (sw < (profile.minSidewalk || 0)) sw = 0; // un « trottoir » de quelques décimètres n'est qu'une bordure : pas de ruban
  if (r.bridge || r._mw || r.tunnel) r._trees = 0;
  if (r._mw) r._surf = 'asphalt';
  r._sw = r.kind === 'pedestrian' || r._mw ? 0 : sw;
  r._hw = Math.max(1.2, r._w / 2);
}

const KEYS = ['_i', '_hw', '_sw', '_ped', '_cum', '_len', '_seg0', '_contA', '_contB', '_mx', '_mz', '_runs', '_hill', '_pave', '_w', '_lanes', '_trees', '_surf', '_y', '_ele', '_mw', '_info', '_cls', '_rb', '_eadj'];

export function createRoadNet(ctx, profile) {
  const roads = (ctx.worldData.roads || []).filter((r) => r.points && r.points.length >= 2);
  // --- données dérivées par route
  let nSeg = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, nLeveled = 0;
  for (let i = 0; i < roads.length; i++) {
    const r = roads[i];
    // champs dérivés non énumérables : les objets route restent « propres » (JSON, Object.keys) pour les autres modules
    for (const k of KEYS) Object.defineProperty(r, k, { value: undefined, writable: true, enumerable: false, configurable: true });
    r._i = i; applyProfile(r, profile);
    r._ped = r.kind === 'pedestrian';
    const n = r.points.length, cum = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const p = r.points[k];
      if (k) cum[k] = cum[k - 1] + Math.hypot(p[0] - r.points[k - 1][0], p[1] - r.points[k - 1][1]);
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
    }
    r._cum = cum; r._len = cum[n - 1]; r._seg0 = nSeg; nSeg += n - 1;
    r._contA = -1; r._contB = -1;
    // élévation par sommet (pont routier, rampe, trémie) : null si la route reste au sol
    r._ele = null;
    if (Array.isArray(r.ele) && r.ele.length === n) { let any = false; for (let k = 0; k < n; k++) if (Math.abs(r.ele[k]) > 0.05) { any = true; break; } if (any) { r._ele = Float32Array.from(r.ele, (v) => +v || 0); nLeveled++; } }
    if (r._ele) {
      // ouvrages : pas de large esplanade sur un tablier ni au fond d'une trémie (le trottoir réel reste au niveau du sol)
      let mn = 0; for (let k = 0; k < n; k++) if (r._ele[k] < mn) mn = r._ele[k];
      r._sw = mn < -1 ? 0 : Math.min(r._sw, 1.8);
      // trémie à une voie : chaussée à la largeur de la voie (la largeur des données est celle de l'avenue en surface)
      if (mn < -1.5 && r.oneway && (r.lanes | 0) <= 1 && r._w > 5) { r._w = 4.6; r._hw = 2.3; r._lanes = 1; }
    }
    r._cls = r._surf === 'sett' ? (r._ped ? 0 : 1) : 2; // classe de revêtement : 0 piétonne pavée, 1 pavée, 2 bitume
  }
  if (!roads.length) { x0 = z0 = -100; x1 = z1 = 100; }
  const sax = new Float32Array(nSeg), saz = new Float32Array(nSeg), sbx = new Float32Array(nSeg), sbz = new Float32Array(nSeg);
  const shw = new Float32Array(nSeg), sroad = new Int32Array(nSeg), se0 = new Float32Array(nSeg), se1 = new Float32Array(nSeg), scov = new Float32Array(nSeg);
  // --- grille CSR (tableaux typés) : pour chaque case, les segments dont la boîte élargie la touche
  const gx0 = Math.floor((x0 - 64) / CELL), gz0 = Math.floor((z0 - 64) / CELL);
  const gw = Math.floor((x1 + 64) / CELL) - gx0 + 1, gh = Math.floor((z1 + 64) / CELL) - gz0 + 1;
  const cellStart = new Int32Array(gw * gh + 1);
  const eachCell = (s, fn) => {
    const e = shw[s] + PAD;
    const cx0 = Math.floor((Math.min(sax[s], sbx[s]) - e) / CELL) - gx0, cx1 = Math.floor((Math.max(sax[s], sbx[s]) + e) / CELL) - gx0;
    const cz0 = Math.floor((Math.min(saz[s], sbz[s]) - e) / CELL) - gz0, cz1 = Math.floor((Math.max(saz[s], sbz[s]) + e) / CELL) - gz0;
    for (let cz = Math.max(0, cz0); cz <= Math.min(gh - 1, cz1); cz++) for (let cx = Math.max(0, cx0); cx <= Math.min(gw - 1, cx1); cx++) fn(cz * gw + cx);
  };
  for (const r of roads) for (let k = 0; k < r.points.length - 1; k++) {
    const s = r._seg0 + k, a = r.points[k], b = r.points[k + 1];
    sax[s] = a[0]; saz[s] = a[1]; sbx[s] = b[0]; sbz[s] = b[1]; shw[s] = r._hw; sroad[s] = r._i;
    scov[s] = r._hw + Math.min(7, r._sw + (r._sw > 0 ? 0.55 : 0.8));
    if (r._ele) { se0[s] = r._ele[k]; se1[s] = r._ele[k + 1]; }
    eachCell(s, (c) => { cellStart[c + 1]++; });
  }
  for (let c = 0; c < gw * gh; c++) cellStart[c + 1] += cellStart[c];
  const cellItems = new Int32Array(cellStart[gw * gh]);
  { const fill = cellStart.slice(0, gw * gh); for (let s = 0; s < nSeg; s++) eachCell(s, (c) => { cellItems[fill[c]++] = s; }); }
  /** Indice de case de (x,z), ou -1 hors grille. */
  const cellOf = (x, z) => { const cx = Math.floor(x / CELL) - gx0, cz = Math.floor(z / CELL) - gz0; return cx < 0 || cz < 0 || cx >= gw || cz >= gh ? -1 : cz * gw + cx; };

  // distance² point-segment + paramètre
  let _t = 0;
  function segDist2(s, x, z) {
    const ax = sax[s], az = saz[s], dx = sbx[s] - ax, dz = sbz[s] - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t; _t = t;
    const px = ax + dx * t - x, pz = az + dz * t - z;
    return px * px + pz * pz;
  }
  const segE = (s) => se0[s] + (se1[s] - se0[s]) * _t; // élévation du segment au paramètre de la dernière projection

  // --- continuités : deux extrémités seules sur un même nœud (et au même niveau) = même rue qui continue
  const nodeMap = new Map();
  const nkey = (p, e) => Math.round(p[0] * 5) * 200003 + Math.round(p[1] * 5) + Math.round(e / 3) * 7919;
  for (const r of roads) {
    const n = r.points.length;
    for (let k = 0; k < n; k++) {
      const ev = r._ele ? r._ele[k] : 0, key = nkey(r.points[k], ev);
      let e = nodeMap.get(key); if (!e) nodeMap.set(key, (e = { arms: 0, ends: [], p: r.points[k], e: ev, maxHw: 0, ped: true, cls: 0, tun: false }));
      e.cls = Math.max(e.cls, r._cls);
      const isEnd = k === 0 || k === n - 1;
      e.arms += isEnd ? 1 : 2; if (isEnd) e.ends.push([r._i, k === 0 ? 0 : 1]);
      if (r._hw > e.maxHw) e.maxHw = r._hw; if (!r._ped) e.ped = false; if (r.tunnel) e.tun = true;
      if (r._ele && Math.abs(ev) > 0.05) (e.lv || (e.lv = [])).push(r._i, k);
    }
  }
  // places entièrement revêtues (disque pavé, pas de trottoirs ni d'arbres dedans), fournies par le profil de la ville
  const zones = profile.zones ? profile.zones(ctx, roads) : [];
  const inZone = zones.length ? (x, z, pad = 0) => { for (const q of zones) if ((x - q.x) ** 2 + (z - q.z) ** 2 < (q.r + pad) ** 2) return q; return null; } : () => null;
  const junctions = []; // nœuds à ≥ 3 branches (pastille de revêtement)
  for (const e of nodeMap.values()) {
    if (e.arms === 2 && e.ends.length === 2 && e.ends[0][0] !== e.ends[1][0]) {
      const [[ra, ea], [rb, eb]] = e.ends;
      if (ea === 0) roads[ra]._contA = rb; else roads[ra]._contB = rb;
      if (eb === 0) roads[rb]._contA = ra; else roads[rb]._contB = ra;
    } else if (e.arms >= 3 && e.ends.length >= 1) junctions.push(e);
  }
  /** direction (unitaire) du tronçon voisin à l'extrémité (0 = début, 1 = fin), dans le sens de parcours de r. */
  function contDir(r, end) {
    const ci = end === 0 ? r._contA : r._contB; if (ci < 0) return null;
    const c = roads[ci], p = end === 0 ? r.points[0] : r.points[r.points.length - 1];
    const n = c.points.length;
    const atStart = Math.abs(c.points[0][0] - p[0]) + Math.abs(c.points[0][1] - p[1]) < 0.5;
    let a, b;
    if (atStart) { a = c.points[0]; b = c.points[1]; } else { a = c.points[n - 1]; b = c.points[n - 2]; }
    let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    return end === 0 ? [-dx, -dz] : [dx, dz];
  }
  // --- cadres par sommet : normale gauche « en onglet » (miter) pour décaler proprement la polyligne
  for (const r of roads) {
    const n = r.points.length, mx = new Float32Array(n), mz = new Float32Array(n);
    const dir = (k) => { const a = r.points[k], b = r.points[k + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    for (let k = 0; k < n; k++) {
      let d0 = k > 0 ? dir(k - 1) : contDir(r, 0), d1 = k < n - 1 ? dir(k) : contDir(r, 1);
      if (!d0) d0 = d1; if (!d1) d1 = d0;
      // normale gauche de (dx,dz) = (dz, -dx)  [+X est, +Z sud : gauche d'un véhicule allant vers d]
      const n0x = d0[1], n0z = -d0[0], n1x = d1[1], n1z = -d1[0];
      const dot = n0x * n1x + n0z * n1z;
      const sc = 1 / Math.max(0.35, 1 + dot);
      mx[k] = (n0x + n1x) * sc; mz[k] = (n0z + n1z) * sc;
      if (dot < -0.6) { mx[k] = n1x; mz[k] = n1z; }
    }
    r._mx = mx; r._mz = mz;
  }

  /** Point de la route r à l'abscisse s, décalé latéralement de `off` (>0 = gauche). Remplit out (x, z, dx, dz, k, e). */
  function pointAt(r, s, off, out) {
    const cum = r._cum, n = cum.length;
    let k = out._k | 0; if (k > n - 2 || cum[k] > s) k = 0;
    while (k < n - 2 && cum[k + 1] < s) k++;
    out._k = k;
    const a = r.points[k], b = r.points[k + 1], L = cum[k + 1] - cum[k] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[k]) / L));
    const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    const ox = (r._mx[k] * (1 - t) + r._mx[k + 1] * t) * off, oz = (r._mz[k] * (1 - t) + r._mz[k + 1] * t) * off;
    out.x = a[0] + (b[0] - a[0]) * t + ox; out.z = a[1] + (b[1] - a[1]) * t + oz;
    out.dx = dx; out.dz = dz; out.k = k;
    out.e = r._ele ? r._ele[k] + (r._ele[k + 1] - r._ele[k]) * t : 0;
    if (r._eadj) out.e += deltaAt(r._eadj, s);
    return out;
  }
  /** Correction d'élévation (m) à l'abscisse s : listes [s0, δ0, s1, δ1, …] triées, nulles en dehors. */
  function deltaAt(lists, s) {
    let d = 0;
    for (const L of lists) {
      const n = L.length; if (s <= L[0] || s >= L[n - 2]) continue;
      let i = 0; while (L[i + 2] < s) i += 2;
      d += L[i + 1] + ((L[i + 3] - L[i + 1]) * (s - L[i])) / (L[i + 2] - L[i] || 1);
    }
    return d;
  }
  // --- bretelles et voies qui se détachent d'une chaussée dénivelée plus large : dans les données elles montent ou
  // descendent dès le nœud commun, alors qu'elles sont encore DANS l'emprise de l'autre chaussée (une marche de
  // plusieurs mètres en travers de la voie). On les garde au niveau de la chaussée mère tant que leur axe n'en est pas
  // sorti, puis on rejoint leur profil par une pente supplémentaire de 10 %.
  {
    let _pd = 0, _pe = 0;
    const projectOn = (T, kHint, x, z) => {
      let bd = Infinity;
      for (let k = Math.max(0, kHint - 14), ke = Math.min(T.points.length - 2, kHint + 14); k <= ke; k++) {
        const a = T.points[k], b = T.points[k + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = a[0] + dx * t - x, pz = a[1] + dz * t - z, d2 = px * px + pz * pz;
        if (d2 < bd) { bd = d2; _pe = T._ele[k] + (T._ele[k + 1] - T._ele[k]) * t; }
      }
      _pd = Math.sqrt(bd);
    };
    const pr = { _k: 0 };
    let nAdj = 0;
    for (const e of nodeMap.values()) {
      if (!e.lv || e.lv.length < 4) continue;
      for (let a = 0; a < e.lv.length; a += 2) {
        const R = roads[e.lv[a]], kR = e.lv[a + 1];
        if (kR !== 0 && kR !== R.points.length - 1) continue; // seulement une route qui se termine à ce nœud
        let best = null, bestPeak = 0.3;
        for (let b = 0; b < e.lv.length; b += 2) {
          const T = roads[e.lv[b]], kT = e.lv[b + 1];
          if (T === R) continue;
          const WT = T._hw + T._sw + 0.8; if (WT < R._hw + 0.5) continue;
          const list = [0, 0]; let peak = 0, dc = -1, gc = 0;
          const dMax = Math.min(90, R._len - 1);
          for (let d = 2; d <= dMax; d += 2) {
            pointAt(R, kR === 0 ? d : R._len - d, 0, pr); projectOn(T, kT, pr.x, pr.z);
            const gap = _pe - pr.e;
            if (_pd >= WT || Math.abs(gap) > 4.5) { dc = d; break; }
            list.push(d, gap); gc = gap; if (Math.abs(gap) > peak) peak = Math.abs(gap);
          }
          if (peak <= bestPeak) continue;
          if (dc < 0) dc = list[list.length - 2] + 2;
          // retour au profil des données : pente supplémentaire de 10 %, et toujours avant l'autre bout de la route
          const Lr = Math.min(Math.abs(gc) / 0.1, Math.max(2, R._len - 1 - dc));
          for (let d = dc, i = 0; i < 60; i++, d += 2) { const f = 1 - (d - dc + 2) / (Lr + 2); if (f <= 0) { list.push(d, 0); break; } list.push(d, gc * f); }
          if (list[list.length - 1] !== 0) list.push(list[list.length - 2] + 0.5, 0);
          best = list; bestPeak = peak;
        }
        if (!best) continue;
        // abscisses croissantes
        const n = best.length / 2, L = new Float32Array(best.length);
        for (let i = 0; i < n; i++) { const j = kR === 0 ? i : n - 1 - i; L[i * 2] = kR === 0 ? best[j * 2] : R._len - best[j * 2]; L[i * 2 + 1] = best[j * 2 + 1]; }
        (R._eadj || (R._eadj = [])).push(L); nAdj++;
      }
    }
    // élévations par segment (tests de niveau) recalées sur le profil corrigé
    if (nAdj) for (const r of roads) { if (!r._eadj) continue; for (let k = 0; k < r.points.length - 1; k++) { se0[r._seg0 + k] = r._ele[k] + deltaAt(r._eadj, r._cum[k]); se1[r._seg0 + k] = r._ele[k + 1] + deltaAt(r._eadj, r._cum[k + 1]); } }
  }
  const tmpE = { _k: 0 };
  /** Élévation (m au-dessus du relief) de la route r à l'abscisse s. */
  const eleAt = (r, s) => (r._ele ? pointAt(r, s, 0, tmpE).e : 0);
  /**
   * Hauteur absolue de la chaussée de r en un point (x,z) de sa section à l'abscisse s (axe en cx,cz, élévation e).
   * Au sol la chaussée épouse le relief en travers ; dès qu'elle s'élève (ou s'enfonce) le tablier est de niveau.
   */
  function deckY(x, z, cx, cz, e) {
    if (e === 0) return baseHeightAt(x, z);
    const w = Math.min(1, Math.abs(e) * 2);
    return baseHeightAt(x, z) * (1 - w) + baseHeightAt(cx, cz) * w + e;
  }

  /**
   * Le point est-il sur la chaussée d'une AUTRE route du même niveau (marge pad ≤ 8) ?
   * Retourne l'indice de la route trouvée ou -1. self, ex1, ex2 = indices exclus ; ped = inclure les rues piétonnes ;
   * lv = élévation du point au-dessus du relief (0 = au sol).
   */
  function insideOther(x, z, pad, self, ex1 = -1, ex2 = -1, ped = false, lv = 0) {
    const c = cellOf(x, z); if (c < 0) return -1;
    for (let i = cellStart[c], e = cellStart[c + 1]; i < e; i++) {
      const s = cellItems[i], ri = sroad[s];
      if (ri === self || ri === ex1 || ri === ex2) continue;
      const lim = shw[s] + pad; if (lim <= 0) continue;
      if (segDist2(s, x, z) < lim * lim) { if ((!ped && roads[ri]._ped) || Math.abs(segE(s) - lv) > LEVEL_GAP) continue; return ri; }
    }
    return -1;
  }
  /** Route (carrossable ou piétonne) sous le point au niveau lv (0 = sol), ou null. pad = marge ajoutée à la demi-largeur. */
  function roadAtPad(x, z, pad = 0, drivableOnly = false, lv = 0) {
    const c = cellOf(x, z); if (c < 0) return null;
    let best = null, bd = Infinity;
    for (let i = cellStart[c], e = cellStart[c + 1]; i < e; i++) {
      const s = cellItems[i], r = roads[sroad[s]];
      if (drivableOnly && r._ped) continue;
      const lim = shw[s] + pad, d2 = segDist2(s, x, z);
      if (d2 <= lim * lim && d2 < bd && Math.abs(segE(s) - lv) <= LEVEL_GAP) { bd = d2; best = r; }
    }
    return best;
  }
  /** Route sous le point ; avec y (hauteur de l'appelant) on choisit la chaussée du niveau le plus proche. */
  function roadAt(x, z, y) {
    const c = cellOf(x, z); if (c < 0) return null;
    const lv = y === undefined ? 0 : y - baseHeightAt(x, z);
    let best = null, bd = Infinity;
    for (let i = cellStart[c], e = cellStart[c + 1]; i < e; i++) {
      const s = cellItems[i];
      if (segDist2(s, x, z) > shw[s] * shw[s]) continue;
      const d = Math.abs(segE(s) - lv); if (d < bd) { bd = d; best = roads[sroad[s]]; }
    }
    return best && (y === undefined ? bd <= LEVEL_GAP : bd <= 4) ? best : null;
  }
  /**
   * Recouvrement du point par une chaussée restée au sol (trottoirs compris) : marge en mètres jusqu'à son bord
   * (> 0 = dessus), 0 sinon ; out reçoit la direction (dx, dz) de la chaussée. Sert aux raccords avec les rampes et aux rues
   * qui enjambent une tranchée.
   */
  function groundCover(x, z, out) {
    const c = cellOf(x, z); if (c < 0) return 0;
    let best = 0, bs = -1;
    for (let i = cellStart[c], e = cellStart[c + 1]; i < e; i++) {
      const s = cellItems[i]; if (se0[s] !== 0 || se1[s] !== 0) continue;
      const lim = scov[s], d2 = segDist2(s, x, z);
      if (d2 < lim * lim) {
        // plein poids sur la chaussée ; sur le trottoir la rue reste une surface (pont au-dessus d'une tranchée) mais ne
        // l'emporte jamais sur la chaussée d'une voie dénivelée qu'elle longe
        const d = Math.sqrt(d2), core = shw[s] + 0.8 - d, w = core > 0.3 ? core : Math.min(0.3, lim - d);
        if (w > best) { best = w; bs = s; }
      }
    }
    if (out && bs >= 0) { const dx = sbx[bs] - sax[bs], dz = sbz[bs] - saz[bs], l = Math.hypot(dx, dz) || 1; out.dx = dx / l; out.dz = dz / l; }
    return best;
  }
  /** Le segment k de la route r est-il resté au sol (élévation nulle à ses deux bouts) ? */
  const segFlat = (r, k) => se0[r._seg0 + k] === 0 && se1[r._seg0 + k] === 0;
  /** Distance au bord de chaussée le plus proche du même niveau (négatif = sur la chaussée), bornée à PAD. */
  function edgeDistance(x, z, includePed = true, lv = 0) {
    const c = cellOf(x, z); if (c < 0) return PAD;
    let best = PAD;
    for (let i = cellStart[c], e = cellStart[c + 1]; i < e; i++) {
      const s = cellItems[i]; if (!includePed && roads[sroad[s]]._ped) continue;
      const d = Math.sqrt(segDist2(s, x, z)) - shw[s]; if (d < best && Math.abs(segE(s) - lv) <= LEVEL_GAP) best = d;
    }
    return best;
  }

  const yawOf = (dx, dz) => Math.atan2(-dx, -dz);
  /**
   * Point de chaussée le plus proche : { x, z, y, yaw, road, dist }. Le 3e argument est soit la hauteur y de l'appelant
   * (la recherche privilégie alors les chaussées proches de cette hauteur), soit des options { drivable, y }.
   */
  function nearestRoadPoint(x, z, a3) {
    const opts = a3 && typeof a3 === 'object' ? a3 : null, y = typeof a3 === 'number' ? a3 : opts?.y;
    const drivable = !opts || opts.drivable !== false;
    const lv = y === undefined ? undefined : y - baseHeightAt(x, z);
    let best = -1, bd = Infinity, bt = 0, braw = 0;
    const cx = Math.floor(x / CELL) - gx0, cz = Math.floor(z / CELL) - gz0;
    for (let ring = 0; ring < 90; ring++) {
      for (let ix = cx - ring; ix <= cx + ring; ix++) for (let iz = cz - ring; iz <= cz + ring; iz++) {
        if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring || ix < 0 || iz < 0 || ix >= gw || iz >= gh) continue;
        const c = iz * gw + ix;
        for (let i = cellStart[c], e = cellStart[c + 1]; i < e; i++) {
          const s = cellItems[i]; if (drivable && roads[sroad[s]]._ped) continue;
          const d2 = segDist2(s, x, z);
          // écart de niveau : pénalité (un pont 6 m au-dessus n'est « proche » que s'il n'y a rien d'autre)
          let cost = d2; if (lv !== undefined) { const dl = Math.abs(segE(s) - lv); if (dl > 1.5) cost = (Math.sqrt(d2) + dl * 6) ** 2; }
          if (cost < bd) { bd = cost; best = s; bt = _t; braw = d2; }
        }
      }
      if (best >= 0 && Math.sqrt(bd) < (ring - 0.5) * CELL) break;
    }
    if (best < 0) return null;
    const dx = sbx[best] - sax[best], dz = sbz[best] - saz[best], px = sax[best] + dx * bt, pz = saz[best] + dz * bt;
    const br = roads[sroad[best]], bk = best - br._seg0;
    return { x: px, z: pz, y: baseHeightAt(px, pz) + eleAt(br, br._cum[bk] + (br._cum[bk + 1] - br._cum[bk]) * bt), yaw: yawOf(dx, dz), road: br, dist: Math.sqrt(braw) };
  }
  // tirage aléatoire pondéré par la longueur parmi les routes carrossables (hors ponts sur l'eau et tunnels)
  const pick = roads.filter((r) => !r._ped && !r.bridge && !r.tunnel && r._len > 12);
  const pickCum = new Float64Array(pick.length); { let acc = 0; pick.forEach((r, i) => { acc += r._len; pickCum[i] = acc; }); }
  const rnd = mulberry32((Math.random() * 1e9) | 0);
  const tmp = { _k: 0 };
  /** Point aléatoire sur une chaussée carrossable (voie de droite, hors carrefours) : { x, z, y, yaw, road }. */
  function randomRoadPoint() {
    if (!pick.length) return { x: 0, z: 0, y: baseHeightAt(0, 0), yaw: 0, road: null };
    for (let tries = 0; tries < 12; tries++) {
      const v = rnd() * pickCum[pick.length - 1];
      let lo = 0, hi = pick.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (pickCum[m] < v) lo = m + 1; else hi = m; }
      const r = pick[lo], s = 5 + rnd() * (r._len - 10);
      // voie de droite si double sens, sinon axe de la voie (largeur des données : compatible avec le graphe du trafic)
      const off = r.oneway ? 0 : -r.width * 0.25;
      pointAt(r, s, off, tmp);
      if (tries < 11 && insideOther(tmp.x, tmp.z, 2, r._i, r._contA, r._contB, false, tmp.e) >= 0) continue; // pas au milieu d'un carrefour
      const e = tmp.e, x = tmp.x, z = tmp.z, dx = tmp.dx, dz = tmp.dz;
      pointAt(r, s, 0, tmp);
      return { x, z, y: deckY(x, z, tmp.x, tmp.z, e), yaw: yawOf(dx, dz), road: r };
    }
  }

  /** Intervalles [s0,s1,finCoupéeDébut,finCoupéeFin,autreDébut,autreFin] de l'axe de r hors carrefours (même niveau). */
  function freeRuns(r) {
    if (r._runs) return r._runs;
    const runs = [], o = { _k: 0 }, STEP = 2;
    const n = Math.max(1, Math.ceil(r._len / STEP));
    const test = (s) => { pointAt(r, s, 0, o); return insideOther(o.x, o.z, 0.3, r._i, r._contA, r._contB, false, o.e); };
    let prevS = 0, prevIn = test(0), start = prevIn < 0 ? 0 : -1, startCut = false, startOther = -1;
    for (let i = 1; i <= n; i++) {
      const s = (r._len * i) / n, inn = test(s);
      if ((inn >= 0) !== (prevIn >= 0)) {
        let a = prevS, b = s; // bissection
        for (let it = 0; it < 5; it++) { const m = (a + b) / 2; if ((test(m) >= 0) === (prevIn >= 0)) a = m; else b = m; }
        const edge = (a + b) / 2;
        if (inn >= 0) { if (start >= 0) runs.push([start, edge, startCut, true, startOther, inn]); start = -1; }
        else { start = edge; startCut = true; startOther = prevIn; }
      }
      prevS = s; prevIn = inn;
    }
    if (start >= 0) runs.push([start, r._len, startCut, false, startOther, -1]);
    r._runs = runs;
    return runs;
  }
  /**
   * Tronçons libres enrichis : passages piétons, lignes d'arrêt, feux. Partagé par les marquages (streets.js) et le
   * mobilier (props.js) : [{ s0, s1, a, b, cwA, cwB, lightA, lightB }] où [a,b] est la portion qui reçoit les lignes de voie.
   */
  function runsInfo(r) {
    if (r._info) return r._info;
    const out = [], pa = { _k: 0 };
    const noCross = r._ped || r._mw || !!r.tunnel || !!r.roundabout;
    for (const [s0, s1, cutA, cutB, oA, oB] of freeRuns(r)) {
      const okW = !noCross && r._w >= 4.4 && s1 - s0 > 16;
      const okO = (o) => o >= 0 && !roads[o]._ped && !roads[o]._mw;
      let cwA = okW && cutA && okO(oA), cwB = okW && cutB && okO(oB);
      if (cwA && inZone(pointAt(r, s0 + 3, 0, pa).x, pa.z, -2)) cwA = false;
      if (cwB && inZone(pointAt(r, s1 - 3, 0, pa).x, pa.z, -2)) cwB = false;
      let a = s0 + (cwA ? 6.4 : 0.6), b = s1 - (cwB ? 6.4 : 0.6);
      // pas de lignes de voie sur le pavage des places (zones)
      if (zones.length) { while (b - a > 3 && inZone(pointAt(r, a, 0, pa).x, pa.z, 1)) a += 2; while (b - a > 3 && inZone(pointAt(r, b, 0, pa).x, pa.z, 1)) b -= 2; }
      const big = (o) => r._lanes >= 3 || (roads[o]._lanes | 0) >= 3 || (r._lanes >= 2 && (roads[o]._lanes | 0) >= 2);
      out.push({ s0, s1, a, b, cwA, cwB, lightB: cwB && big(oB), lightA: cwA && !r.oneway && big(oA) });
    }
    r._info = out;
    return out;
  }

  // --- répartition par tuile (construction paresseuse) : tronçons [route, sA, sB], carrefours, zones
  const tilePieces = new Map(), tileJunctions = new Map(), tileZones = new Map();
  const push = (map, key, v) => { let a = map.get(key); if (!a) map.set(key, (a = [])); a.push(v); };
  const ts = [];
  for (const r of roads) {
    let curKey = -1, sStart = 0;
    for (let k = 0; k < r.points.length - 1; k++) {
      const a = r.points[k], b = r.points[k + 1], L = r._cum[k + 1] - r._cum[k];
      ts.length = 0; ts.push(0, 1);
      const cut = (pa, pb) => { if (pa === pb) return; const lo = Math.min(pa, pb), hi = Math.max(pa, pb); for (let g = Math.floor(lo / TILE) + 1; g * TILE < hi; g++) ts.push((g * TILE - pa) / (pb - pa)); };
      cut(a[0], b[0]); cut(a[1], b[1]);
      if (ts.length > 2) ts.sort((p, q) => p - q);
      for (let i = 0; i + 1 < ts.length; i++) {
        const tm = (ts[i] + ts[i + 1]) / 2, key = tileKey(a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm);
        if (key !== curKey) { const s = r._cum[k] + L * ts[i]; if (curKey >= 0 && s > sStart) push(tilePieces, curKey, [r._i, sStart, s]); curKey = key; sStart = s; }
      }
    }
    if (curKey >= 0) push(tilePieces, curKey, [r._i, sStart, r._len]);
  }
  for (const e of junctions) push(tileJunctions, tileKey(e.p[0], e.p[1]), e);
  for (const q of zones) push(tileZones, tileKey(q.x, q.z), q);

  return {
    roads, junctions, zones, inZone, pointAt, eleAt, deckY, insideOther, roadAtPad, roadAt, edgeDistance, groundCover, segFlat, freeRuns, runsInfo,
    nearestRoadPoint, randomRoadPoint, tilePieces, tileJunctions, tileZones, leveled: nLeveled,
    bounds: { x0, x1, z0, z1 },
  };
}

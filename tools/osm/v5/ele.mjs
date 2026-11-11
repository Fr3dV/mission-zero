// Niveaux superposés (contrat v5) : calcule l'élévation `ele` de chaque sommet des routes et des rails.
//
// Entrée : des « voies » (routes, rails) décrites par une suite d'indices de sommets partagés (un carrefour ou un
// passage à niveau = même indice dans les deux voies), plus des voies d'eau (axes de canaux) à hauteur fixe.
// 1. Croisements : deux segments qui se coupent sans sommet commun sont dénivelés. Le niveau (tag layer, sinon
//    pont = +1, tunnel = −1) dit qui passe dessus. Même niveau sans pont ni tunnel entre deux routes = erreur de
//    saisie : on les raccorde par un sommet commun.
// 2. Qui bouge ? Une voie PUBLIQUE n'est jamais déplacée par une voie « suiveuse » (desserte, rue piétonne, rail) :
//    c'est la suiveuse qui monte ou descend, et sa rampe ne se propage pas aux sommets des voies publiques.
//    Entre deux voies publiques, le pont monte, sauf déblai de la voie du dessous confirmé par le MNT (≥ 2,5 m,
//    et plus que le remblai du dessus), vraie trémie (tunnel de niveau négatif ≥ 25 m), voie cartographiée sous le
//    niveau du sol (layer < 0) ou voie sur berge sous un pont qui franchit l'eau : alors c'est elle qui descend.
//    Un rail sous un pont routier descend (tranchée), sauf remblai routier confirmé par le MNT.
// 3. Résolution : bornes basses (voie du dessus ≥ voie du dessous + gabarit) et bornes hautes (dessous ≤ dessus −
//    gabarit), propagées en rampes le long du réseau avec une pente maximale par type de voie
//    (enveloppes de Lipschitz, par un Dijkstra). Les tabliers de pont et les tunnels sont plats. On itère jusqu'au
//    point fixe car relever une voie relève aussi celles qui passent au-dessus d'elle.
//    Exception : un pont qui franchit de l'eau (axe d'un canal ou d'une rivière) reste à 0 ; les voies qui passent
//    dessous descendent.
// 4. Les voies sont densifiées (un sommet tous les 12 m au plus) partout où ele ≠ 0.

export const CLEAR = { road: 6.5, rail: 7.5, foot: 5.5, tunnel: 6, aqueduct: 8.5, underwater: 9 };
const MAX_UP = 27, MAX_DOWN = -20;

class Heap { // tas binaire max sur la priorité
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) { const K = this.k, P = this.p; let i = K.length; K.push(k); P.push(p); while (i > 0) { const j = (i - 1) >> 1; if (P[j] >= P[i]) break; [K[i], K[j]] = [K[j], K[i]]; [P[i], P[j]] = [P[j], P[i]]; i = j; } }
  pop() { const K = this.k, P = this.p, top = [K[0], P[0]], lk = K.pop(), lp = P.pop(); const n = K.length; if (n) { K[0] = lk; P[0] = lp; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < n && P[l] > P[m]) m = l; if (r < n && P[r] > P[m]) m = r; if (m === i) break; [K[i], K[m]] = [K[m], K[i]]; [P[i], P[m]] = [P[m], P[i]]; i = m; } } return top; }
}

/**
 * @param V   { x: number[], z: number[] } sommets (les nouveaux sommets de densification y sont ajoutés)
 * @param ways [{ ids: number[], slope, lvl, bridge, tunnel, cls: 'road'|'rail'|'foot', fixed?: bool, aqueduct?: bool, label }]
 *             fixed = voie d'eau (hauteur 0 imposée, hors résolution)
 * @param dem  (x, z) -> altitude absolue ou NaN ; null si pas de MNT
 * @returns { ele: Float64Array (par sommet), crossings, stats }
 */
export function solveLevels(V, ways, dem, log = console.log) {
  const stats = { crossings: 0, raise: 0, lower: 0, glitchJoined: 0, sameLevelIgnored: 0, demDecisions: 0, why: {}, contradictory: 0, waterBridgesReleased: 0, infeasible: 0, flipped: 0, unsatisfied: 0, densified: 0 };
  const segLen = (a, b) => Math.hypot(V.x[a] - V.x[b], V.z[a] - V.z[b]);

  // ───── 1. croisements géométriques (grille de 60 m) ─────
  const G = 60, grid = new Map();
  ways.forEach((w, wi) => { for (let i = 1; i < w.ids.length; i++) {
    const a = w.ids[i - 1], b = w.ids[i];
    for (let gx = Math.floor(Math.min(V.x[a], V.x[b]) / G); gx <= Math.floor(Math.max(V.x[a], V.x[b]) / G); gx++) for (let gz = Math.floor(Math.min(V.z[a], V.z[b]) / G); gz <= Math.floor(Math.max(V.z[a], V.z[b]) / G); gz++) {
      const k = gx * 100003 + gz; let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(wi, i);
    } } });
  const crossings = [], seenPair = new Set(), joins = [];
  for (const cell of grid.values()) for (let p = 0; p < cell.length; p += 2) for (let q = p + 2; q < cell.length; q += 2) {
    const wi = cell[p], i = cell[p + 1], wj = cell[q], j = cell[q + 1];
    if (wi === wj && Math.abs(i - j) < 2) continue;
    const A = ways[wi], B = ways[wj];
    if (A.fixed && B.fixed) continue;
    const a1 = A.ids[i - 1], a2 = A.ids[i], b1 = B.ids[j - 1], b2 = B.ids[j];
    if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
    const x1 = V.x[a1], z1 = V.z[a1], x2 = V.x[a2], z2 = V.z[a2], x3 = V.x[b1], z3 = V.z[b1], x4 = V.x[b2], z4 = V.z[b2];
    const den = (x2 - x1) * (z4 - z3) - (z2 - z1) * (x4 - x3); if (Math.abs(den) < 1e-9) continue;
    const t = ((x3 - x1) * (z4 - z3) - (z3 - z1) * (x4 - x3)) / den, u = ((x3 - x1) * (z2 - z1) - (z3 - z1) * (x2 - x1)) / den;
    if (t <= 0.0005 || t >= 0.9995 || u <= 0.0005 || u >= 0.9995) continue;
    const key = wi < wj ? `${wi}:${i}:${wj}:${j}` : `${wj}:${j}:${wi}:${i}`; if (seenPair.has(key)) continue; seenPair.add(key);
    const px = x1 + t * (x2 - x1), pz = z1 + t * (z2 - z1);
    // sommets coïncidents (même position à 0,3 m près) : déjà raccordés par un sommet voisin
    if ([a1, a2].some((a) => [b1, b2].some((b) => Math.hypot(V.x[a] - V.x[b], V.z[a] - V.z[b]) < 0.3))) continue;
    crossings.push({ wi, wj, px, pz });
  }
  // ───── 2. classement de chaque croisement ─────
  // échantillons du MNT le long d'une voie, à une distance curviligne [d1, d2] du point P, de chaque côté
  const arcOf = (w) => { if (!w._arc) { const s = [0]; for (let i = 1; i < w.ids.length; i++) s.push(s[i - 1] + segLen(w.ids[i - 1], w.ids[i])); w._arc = s; } return w._arc; };
  const locate = (w, px, pz) => { // segment de la voie le plus proche de P -> { i, t, s }
    let best = null, bd = Infinity; const arc = arcOf(w);
    for (let i = 1; i < w.ids.length; i++) {
      const a = w.ids[i - 1], b = w.ids[i], dx = V.x[b] - V.x[a], dz = V.z[b] - V.z[a], l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((px - V.x[a]) * dx + (pz - V.z[a]) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - V.x[a] - t * dx, pz - V.z[a] - t * dz);
      if (d < bd) { bd = d; best = { i, t, s: arc[i - 1] + t * Math.sqrt(l2) }; }
    }
    return best;
  };
  const pointAt = (w, s) => { const arc = arcOf(w); if (s < 0 || s > arc[arc.length - 1]) return null; let i = 1; while (i < arc.length - 1 && arc[i] < s) i++; const a = w.ids[i - 1], b = w.ids[i], L = arc[i] - arc[i - 1], t = L > 0 ? (s - arc[i - 1]) / L : 0; return [V.x[a] + (V.x[b] - V.x[a]) * t, V.z[a] + (V.z[b] - V.z[a]) * t]; };
  // Lecture du MNT autour d'un croisement : hU = hauteur de la voie du dessus au-dessus du terrain naturel (remblai),
  // hL = hauteur de la voie du dessous (négative si elle est en déblai). Le terrain naturel est pris sur les
  // diagonales entre les deux voies (80 à 160 m), à l'écart des remblais et des tranchées qui longent les voies.
  const dirAt = (w, s) => { const a = pointAt(w, Math.max(0, s - 6)), b = pointAt(w, Math.min(arcOf(w)[arcOf(w).length - 1], s + 6)); if (!a || !b) return null; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); return L > 0.01 ? [(b[0] - a[0]) / L, (b[1] - a[1]) / L] : null; };
  const med = (v) => { v = v.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : NaN; };
  const alongDem = (w, s0, d1, d2) => { const v = []; for (const sg of [-1, 1]) for (let d = d1; d <= d2; d += 6) { const p = pointAt(w, s0 + sg * d); if (p) v.push(dem(p[0], p[1])); } return med(v); };
  const demRead = (U, L, px, pz) => {
    const su = locate(U, px, pz).s, sl = locate(L, px, pz).s, du = dirAt(U, su), dl = dirAt(L, sl); if (!du || !dl) return null;
    const ground = [];
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { let bx = a * du[0] + b * dl[0], bz = a * du[1] + b * dl[1]; const n = Math.hypot(bx, bz); if (n < 0.3) continue; bx /= n; bz /= n; for (let d = 80; d <= 160; d += 20) ground.push(dem(px + bx * d, pz + bz * d)); }
    const zG = med(ground), zU = alongDem(U, su, 20, 40), zL = alongDem(L, sl, 30, 60);
    if (!Number.isFinite(zG)) return null;
    return { hU: Number.isFinite(zU) ? zU - zG : 0, hL: Number.isFinite(zL) ? zL - zG : 0, sep: Number.isFinite(zU) && Number.isFinite(zL) ? zU - zL : 0 };
  };
  const list = [];
  // voies « suiveuses » : desserte, rue piétonne, rail — elles ne déplacent jamais une voie publique
  const follower = (w) => !!w.minor || w.cls === 'foot' || w.cls === 'rail';
  // ponts sur l'eau : pont (hors viaduc d'autoroute) qui franchit l'axe d'un canal ou d'une rivière d'au moins 10 m de
  // large. Il reste à 0 tant qu'il ne franchit que de l'eau, un rail ou une voie sur berge réellement en contrebas.
  for (const c of crossings) { const A = ways[c.wi], B = ways[c.wj]; if (A.fixed === B.fixed) continue; const W = A.fixed ? A : B, R = A.fixed ? B : A; if (R.bridge && !R.tunnel && !W.aqueduct && (W.width || 0) >= 10 && !R.viaduct) R.waterBridge = true; }
  stats.waterBridges = ways.filter((w) => w.waterBridge).length;
  for (const c of crossings) {
    const A = ways[c.wi], B = ways[c.wj];
    if (A.fixed || B.fixed) { // voie d'eau : pont-canal au-dessus d'une route, ou tunnel sous un canal
      const W = A.fixed ? A : B, R = A.fixed ? B : A, ri = A.fixed ? c.wj : c.wi;
      if (R.tunnel) list.push({ ...c, mode: 'static', wl: ri, C: CLEAR.underwater, label: 'tunnel sous ' + W.label });
      else if (W.aqueduct && !R.bridge) list.push({ ...c, mode: 'static', wl: ri, C: CLEAR.aqueduct, label: 'sous le pont-canal ' + W.label });
      continue;
    }
    if (A.lvl === B.lvl && !!A.bridge === !!B.bridge && !!A.tunnel === !!B.tunnel) {
      // même niveau, mêmes tags : entre deux routes c'est un carrefour mal saisi (on raccorde) ; avec un rail
      // c'est un passage à niveau sans nœud commun (aucune contrainte)
      if (A.cls !== 'rail' && B.cls !== 'rail') { joins.push(c); stats.glitchJoined++; } else stats.sameLevelIgnored++;
      continue;
    }
    // qui est dessus ? niveau, puis pont > rien > tunnel
    const rank = (w) => w.lvl * 10 + (w.bridge ? 1 : 0) - (w.tunnel ? 1 : 0);
    const upIsA = rank(A) >= rank(B), U = upIsA ? A : B, L = upIsA ? B : A, wu = upIsA ? c.wi : c.wj, wl = upIsA ? c.wj : c.wi;
    const C = L.cls === 'rail' ? CLEAR.rail : L.cls === 'foot' ? CLEAR.foot : L.tunnel && !U.bridge ? CLEAR.tunnel : CLEAR.road;
    // ── Qui bouge ? Hiérarchie : une voie PUBLIQUE (route hors desserte et hors rue piétonne) n'est jamais déplacée
    // par une voie « suiveuse » (desserte, rue piétonne, rail) : c'est la suiveuse qui monte ou descend. Entre
    // deux voies publiques, celle du dessous ne descend que si le croisement l'établit : déblai confirmé par le
    // MNT (≥ 2,5 m), vraie trémie (tunnel de niveau négatif d'au moins 25 m), voie cartographiée sous le niveau
    // du sol (layer < 0), ou voie sur berge sous un pont qui franchit l'eau (ce pont reste au niveau des quais) ;
    // un remblai confirmé par le MNT fait au contraire monter le pont. Sinon c'est le pont qui monte.
    const d = dem ? demRead(U, L, c.px, c.pz) : null; if (d) { stats.demDecisions++; c.dem = d; }
    const EU = d ? d.hU : 0, EL = d ? -d.hL : 0, sep = d ? d.sep : 0;
    const demRaise = EU >= 2.5 && EU > EL, demLower = EL >= 2.5 && EL > EU;
    const pubU = !follower(U), pubL = !follower(L), Llen = arcOf(L)[arcOf(L).length - 1];
    const realTunnel = L.tunnel && L.lvl < 0 && Llen >= 25;
    let mode, why;
    if (!pubU && pubL) { if (U.cls === 'rail' && demLower) { mode = 'lower'; why = 'route en déblai sous un rail (MNT)'; } else { mode = 'raise'; why = 'suiveuse au-dessus'; } }
    else if (pubU && !pubL) { if (L.cls === 'rail' && demRaise) { mode = 'raise'; why = 'route en remblai sur un rail (MNT)'; } else { mode = 'lower'; why = 'suiveuse en dessous'; } }
    else if (!pubU && !pubL) { mode = L.tunnel || demLower ? 'lower' : 'raise'; why = 'entre suiveuses'; }
    else if (demLower) { mode = 'lower'; why = 'déblai confirmé par le MNT'; }
    else if (demRaise) { mode = 'raise'; why = 'remblai confirmé par le MNT'; }
    else if (realTunnel) { mode = 'lower'; why = 'trémie'; }
    else if (L.lvl < 0 && !L.bridge) { mode = 'lower'; why = 'voie cartographiée sous le niveau du sol'; }
    else if (U.waterBridge) { mode = 'lower'; why = 'voie sur berge sous un pont sur l’eau'; }
    else { mode = 'raise'; why = 'pont (défaut)'; }
    // l'autre choix reste-t-il permis si celui-ci s'avère impossible ? (jamais d'abaissement injustifié d'une voie publique)
    const canLower = !pubL || mode === 'lower' || realTunnel || L.lvl < 0 || !!U.waterBridge, canRaise = true;
    if (mode === 'raise' && U.waterBridge) U.wbRaised = true; // ce pont sur l'eau est relevé par son propre franchissement
    stats.why[why] = (stats.why[why] || 0) + 1;
    c.canLower = canLower; c.canRaise = canRaise; c.why = why;
    list.push({ ...c, mode, wu, wl, C });
  }
  stats.crossings = list.length;

  // ───── raccord des croisements « même niveau » entre routes (sommet commun) ─────
  const insertVertex = (w, px, pz, v) => { const loc = locate(w, px, pz); w.ids.splice(loc.i, 0, v); w._arc = null; };
  for (const c of joins) { const v = V.x.length; V.x.push(Math.round(c.px * 10) / 10); V.z.push(Math.round(c.pz * 10) / 10); insertVertex(ways[c.wi], c.px, c.pz, v); insertVertex(ways[c.wj], c.px, c.pz, v); }

  // ───── 3. densification préalable autour des croisements et des tunnels ─────
  const STEP = 12;
  const densify = (w, s0, s1) => { // insère des sommets pour que tout segment recouvrant [s0, s1] fasse ≤ STEP
    const arc = arcOf(w), ids = [w.ids[0]];
    for (let i = 1; i < w.ids.length; i++) {
      const a = w.ids[i - 1], b = w.ids[i], L = arc[i] - arc[i - 1];
      if (L > STEP && arc[i] > s0 && arc[i - 1] < s1) { const n = Math.ceil(L / STEP); for (let k = 1; k < n; k++) { const t = k / n; V.x.push(Math.round((V.x[a] + (V.x[b] - V.x[a]) * t) * 10) / 10); V.z.push(Math.round((V.z[a] + (V.z[b] - V.z[a]) * t) * 10) / 10); ids.push(V.x.length - 1); stats.densified++; } }
      ids.push(b);
    }
    w.ids = ids; w._arc = null;
  };
  // (un segment partagé par deux voies — rare — serait densifié deux fois avec des sommets distincts : on l'évite
  // en ne densifiant que la première voie qui porte ce segment)
  const reach = (w, C) => C / w.slope + 25;
  for (const c of list) { for (const wi of [c.wu, c.wl]) { if (wi === undefined) continue; const w = ways[wi]; if (w.fixed) continue; const s = locate(w, c.px, c.pz).s, R = reach(w, c.C); densify(w, s - R, s + R); } }

  // ───── 4. résolution ─────
  let ele = null, adj = null, leader = null;
  const buildAdj = () => {
    const N = V.x.length; adj = Array.from({ length: N }, () => []);
    // Propagation ORIENTÉE : le long d'une voie publique elle va dans les deux sens et entraîne les voies
    // raccordées ; le long d'une suiveuse (desserte, rue piétonne, rail) elle ne peut pas entrer dans un sommet
    // appartenant à une voie publique. Une rampe de parking ou une tranchée ferroviaire ne déplace donc jamais
    // une rue, même à un carrefour ou à un passage à niveau.
    leader = new Uint8Array(N); for (const w of ways) if (!w.fixed && !follower(w)) for (const n of w.ids) leader[n] = 1;
    const seen = new Map();
    const arc = (a, b, cost) => { const k = a * N + b, prev = seen.get(k); if (prev !== undefined && prev <= cost) return; seen.set(k, cost); adj[a].push(b, cost); };
    for (const w of ways) { if (w.fixed) continue; const f = follower(w); for (let i = 1; i < w.ids.length; i++) { const a = w.ids[i - 1], b = w.ids[i]; if (a === b) continue; const cost = w.slope * segLen(a, b); if (!f || !leader[b]) arc(a, b, cost); if (!f || !leader[a]) arc(b, a, cost); } }
  };
  // sign = +1 : plus petite fonction ≥ src (bornes basses), tronquée à `lim` (0) ; sign = −1 : plus grande fonction
  // ≤ src (bornes hautes), tronquée à `lim` (≥ 0 : au-delà, la borne haute ne contraint plus rien).
  const envelope = (src, sign, lim) => {
    const N = V.x.length, val = new Float64Array(N).fill(sign * lim), h = new Heap();
    for (const [n, v] of src) { const m = sign * v; if (m > val[n]) { val[n] = m; h.push(n, m); } }
    while (h.size) { const [n, m] = h.pop(); if (m < val[n] - 1e-9) continue; const a = adj[n]; for (let i = 0; i < a.length; i += 2) { const nv = m - a[i + 1]; if (nv > val[a[i]] + 1e-9) { val[a[i]] = nv; h.push(a[i], nv); } } }
    if (sign < 0) for (let i = 0; i < N; i++) val[i] = -val[i];
    return val;
  };
  const bracket = (w, c) => { const loc = locate(w, c.px, c.pz); return [w.ids[loc.i - 1], w.ids[loc.i], loc.t]; };
  // sommets de la voie `w` situés dans l'emprise de l'autre voie (demi-largeur + 5 m) autour du croisement, plus
  // les deux sommets qui encadrent le croisement : le palier est plat sur toute la largeur franchie
  const span = (w, c, other) => { const loc = locate(w, c.px, c.pz), arc = arcOf(w), half = (other.width || 8) / 2 + 5, out = [w.ids[loc.i - 1], w.ids[loc.i]]; for (let i = loc.i - 2; i >= 0 && loc.s - arc[i] <= half; i--) out.push(w.ids[i]); for (let i = loc.i + 1; i < w.ids.length && arc[i] - loc.s <= half; i++) out.push(w.ids[i]); return out; };
  const eleAt = (w, c) => { if (w.fixed) return 0; const [a, b, t] = bracket(w, c); return ele[a] + (ele[b] - ele[a]) * t; };
  // coût de propagation minimal entre deux sommets (= dénivelé maximal possible entre eux), limité à `max`
  const costBetween = (from, to, max) => { const d = new Map([[from, 0]]), h = new Heap(); h.push(from, 0); while (h.size) { const [n, m] = h.pop(); const dn = -m; if (dn > (d.get(n) ?? Infinity) + 1e-9) continue; if (n === to) return dn; const a = adj[n]; for (let i = 0; i < a.length; i += 2) { const nd = dn + a[i + 1]; if (nd < max && nd < (d.get(a[i]) ?? Infinity)) { d.set(a[i], nd); h.push(a[i], -nd); } } } return Infinity; };

  let hitCap = false;
  const solveOnce = () => {
    hitCap = false;
    buildAdj();
    const N = V.x.length; ele = new Float64Array(N);
    let upPrev = null; // enveloppe des bornes basses de l'itération précédente (planchers)
    // gabarit réduit quand les deux voies sont raccordées par un chemin trop court pour le dénivelé demandé
    for (const c of list) { if (c.mode === 'static' || c.Ceff !== undefined) continue; const [ua] = bracket(ways[c.wu], c), [la] = bracket(ways[c.wl], c); const k = costBetween(ua, la, c.C + 1); if (k < c.C + 0.6) { c.Ceff = Math.max(0, k - 0.6); stats.infeasible++; c.infeasible = true; } else c.Ceff = c.C; }
    for (let it = 0; it < 40; it++) {
      const lb = new Map(), ub = new Map();
      const setLb = (n, v) => { if (v >= MAX_UP) hitCap = true; v = Math.min(MAX_UP, v); if (v > (lb.get(n) ?? 0)) lb.set(n, v); };
      const setUb = (n, v) => { v = Math.max(MAX_DOWN, v); if (!ub.has(n) || v < ub.get(n)) ub.set(n, v); };
      // un pont sur l'eau que rien n'oblige à monter reste au niveau des quais : il ne porte pas la rampe d'un ouvrage voisin
      for (const w of ways) if (w.waterBridge && !w.wbRaised) { const f = follower(w); for (const n of w.ids) if (!f || !leader[n]) setUb(n, 0); }
      const deckNeed = new Map(), tubeNeed = new Map(); // tabliers et tunnels plats
      for (const c of list) {
        if (c.mode === 'static') { const w = ways[c.wl]; if (w.tunnel) tubeNeed.set(w, Math.min(tubeNeed.get(w) ?? 0, -c.C)); else { const f = follower(w); for (const n of span(w, c, ways[c.wi === c.wl ? c.wj : c.wi])) if (!f || !leader[n]) setUb(n, -c.C); } continue; }
        const U = ways[c.wu], L = ways[c.wl];
        const fU = follower(U), fL = follower(L);
        const raiseU = (need) => { if (need > 0) { if (U.bridge) deckNeed.set(U, Math.max(deckNeed.get(U) ?? 0, need)); else for (const n of span(U, c, L)) if (!fU || !leader[n]) setLb(n, need); } };
        const lowerL = (need) => { if (L.tunnel) tubeNeed.set(L, Math.min(tubeNeed.get(L) ?? 0, need)); else for (const n of span(L, c, U)) if (!fL || !leader[n]) setUb(n, need); };
        // La voie désignée bouge. Condition toujours nécessaire en plus : la voie du dessus doit dépasser d'un
        // gabarit le PLANCHER de la voie du dessous (ce que ses propres franchissements lui imposent, rampes
        // comprises) — c'est ainsi qu'un échangeur à trois niveaux s'empile, et qu'un pont monte au-dessus d'une
        // voie qui ne peut pas descendre assez vite.
        const floorL = () => { if (!upPrev) return -Infinity; const [a, b] = bracket(L, c); return Math.max(upPrev[a], upPrev[b]); };
        if (c.mode === 'raise') raiseU(Math.max(eleAt(L, c), floorL()) + c.Ceff);
        else { lowerL(eleAt(U, c) - c.Ceff); raiseU(floorL() + c.Ceff); }
      }
      // (une suiveuse n'impose rien aux sommets qu'elle partage avec une voie publique : passage à niveau, raccord)
      for (const [w, need] of deckNeed) { const f = follower(w); for (const n of w.ids) if (!f || !leader[n]) setLb(n, need); }
      for (const [w, need] of tubeNeed) { const f = follower(w); for (const n of w.ids) if (!f || !leader[n]) setUb(n, need); }
      // ele = min(max(0, bornes basses), bornes hautes) : reste lipschitzienne (pente respectée) ; en cas de conflit
      // entre un pont et une trémie voisins, c'est la borne haute (la trémie) qui l'emporte
      let top = 0; for (const v of lb.values()) if (v > top) top = v;
      let bottom = 0; for (const v of ub.values()) if (v < bottom) bottom = v;
      const up = envelope(lb, 1, bottom - 0.5), dn = envelope(ub, -1, top + 0.5); // enveloppes NON tronquées à 0
      upPrev = up;
      let change = 0; for (let i = 0; i < N; i++) { const e = Math.min(Math.max(0, up[i]), dn[i]); change = Math.max(change, Math.abs(e - ele[i])); ele[i] = e; }
      if (change < 0.005) break;
    }
  };
  // Tags contradictoires (une rue à la fois au-dessus et au-dessous d'un même faisceau de voies…) : la résolution
  // diverge jusqu'au plafond. On neutralise alors les croisements qui réclament une hauteur absurde et on reprend.
  const solve = () => {
    for (let guard = 0; guard < 6; guard++) {
      solveOnce(); if (!hitCap) return;
      let n = 0; for (const c of list) { if (c.mode === 'static' || !c.Ceff) continue; if (eleAt(ways[c.wu], c) > 20 || eleAt(ways[c.wl], c) > 13.5) { c.Ceff = 0; c.infeasible = true; c.contradictory = true; n++; } }
      stats.contradictory += n; if (!n) return;
    }
  };
  solve();
  // croisements non satisfaits : on essaie l'autre mode (la voie du dessous descend au lieu que le dessus monte, ou l'inverse)
  for (let round = 0; round < 2; round++) {
    let flipped = 0;
    for (const c of list) { if (c.mode === 'static' || c.infeasible) continue; const d = eleAt(ways[c.wu], c) - eleAt(ways[c.wl], c); if (d < c.Ceff - 0.4 && !c.flipped && (c.mode === 'raise' ? c.canLower : c.canRaise)) { c.mode = c.mode === 'raise' ? 'lower' : 'raise'; if (c.mode === 'raise' && ways[c.wu].waterBridge) ways[c.wu].wbRaised = true; c.flipped = true; flipped++; } }
    if (!flipped) break; stats.flipped += flipped; solve();
  }
  // croisement encore insatisfait parce qu'un pont sur l'eau voisin, tenu à 0, bloque la rampe : on libère ce pont
  for (let round = 0; round < 3; round++) {
    const pinned = new Map(); for (const w of ways) if (w.waterBridge && !w.wbRaised) for (const n of w.ids) pinned.set(n, w);
    let released = 0;
    for (const c of list) {
      if (c.mode !== 'raise' || c.infeasible) continue; if (eleAt(ways[c.wu], c) - eleAt(ways[c.wl], c) >= c.Ceff - 0.4) continue;
      const [a, b] = bracket(ways[c.wu], c), seen = new Map([[a, 0], [b, 0]]), h = new Heap(); h.push(a, 0); h.push(b, 0);
      while (h.size) { const [n, m] = h.pop(), dn = -m; if (dn > (seen.get(n) ?? Infinity) + 1e-9) continue; const w = pinned.get(n); if (w && !w.wbRaised) { w.wbRaised = true; released++; } const e = adj[n]; for (let i = 0; i < e.length; i += 2) { const nd = dn + e[i + 1]; if (nd <= c.C + 1 && nd < (seen.get(e[i]) ?? Infinity)) { seen.set(e[i], nd); h.push(e[i], -nd); } } }
    }
    if (!released) break; stats.waterBridgesReleased += released; solve();
  }
  // densification complémentaire : toute arête de plus de 15 m dont une extrémité est dénivelée
  for (let round = 0; round < 4; round++) {
    let n0 = stats.densified;
    for (const w of ways) { if (w.fixed) continue; const arc = arcOf(w); const spans = []; for (let i = 1; i < w.ids.length; i++) if (arc[i] - arc[i - 1] > 15 && (Math.abs(ele[w.ids[i - 1]]) > 0.01 || Math.abs(ele[w.ids[i]]) > 0.01)) spans.push([arc[i - 1], arc[i]]); for (const [s0, s1] of spans.reverse()) densify(w, s0 + 0.01, s1 - 0.01); }
    if (stats.densified === n0) break; solve();
  }
  for (const c of list) {
    if (c.mode === 'static') continue;
    c.delta = eleAt(ways[c.wu], c) - eleAt(ways[c.wl], c);
    if (c.mode === 'raise') stats.raise++; else stats.lower++;
    if (c.delta < 5) { stats.unsatisfied++; }
  }
  if (process.env.MZ_ELE_DEBUG) { // MZ_ELE_DEBUG="x,z[,rayon]" : détail des croisements autour d'un point
    const [dx, dz, dr = 120] = process.env.MZ_ELE_DEBUG.split(',').map(Number);
    for (const c of list) { if (Math.hypot(c.px - dx, c.pz - dz) > dr) continue; if (c.mode === 'static') { log(`  [static] ${ways[c.wl].label} @ ${c.px.toFixed(0)},${c.pz.toFixed(0)} ele ${eleAt(ways[c.wl], c).toFixed(2)}`); continue; } const U = ways[c.wu], L = ways[c.wl]; log(`  [${c.mode}${c.flipped ? '*' : ''}] ${U.label}${U.bridge ? '(B)' : ''}${U.tunnel ? '(T)' : ''} lvl ${U.lvl} = ${eleAt(U, c).toFixed(2)}  /  ${L.label}${L.bridge ? '(B)' : ''}${L.tunnel ? '(T)' : ''} lvl ${L.lvl} = ${eleAt(L, c).toFixed(2)}  C ${c.Ceff}  ${c.why}  canLower ${c.canLower}  dem ${c.dem ? c.dem.hU.toFixed(1) + '/' + c.dem.hL.toFixed(1) + '/' + c.dem.sep.toFixed(1) : '-'} @ ${c.px.toFixed(0)},${c.pz.toFixed(0)}`); }
  }
  for (let i = 0; i < ele.length; i++) ele[i] = Math.round(ele[i] * 100) / 100 || 0; // au centimètre : la pente reste exacte sur les segments courts
  return { ele, crossings: list, stats };
}

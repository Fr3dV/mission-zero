// Niveaux superposés (contrat v5) : tabliers de ponts routiers et rampes (ele > 0), trémies et tunnels (ele < 0),
// berges basses sous les ponts. Fournit la couche de hauteur enregistrée dans shared/terrain.js :
//   avec y  : la surface la plus haute située à moins de STEP_UP au-dessus de y, sinon la plus basse ;
//   sans y  : la surface la plus proche du relief de base (le niveau de la rue).
// Index global en tableaux typés (seules les routes qui quittent le sol y figurent) : instantané partout.
import { baseHeightAt, STEP_UP } from '@shared/terrain.js';

export const K_DECK = 1, K_TRENCH = 2, K_TUNNEL = 3; // nature d'un quad : tablier/rampe, tranchée ouverte, tunnel couvert
const HC = 16;
export const TUNNEL_MIN = -4.0; // profondeur à partir de laquelle une route `tunnel` est réellement couverte

/** Demi-largeur praticable d'un tablier ou d'une trémie (chaussée + trottoirs ou accotement). */
export const deckHalf = (r) => r._hw + r._sw + (r._sw > 0 ? 0.55 : 0.8); // (les trottoirs des routes dénivelées sont bornés dans roadnet.js)

const GAP = 3.0; // deux surfaces à moins de 3 m d'écart vertical se raccordent (carrefour, pied de rampe) ; au-delà : deux niveaux

export function createLevels(ctx, net) {
  // --- quads par segment des routes dénivelées : coins (gauche a, gauche b, droite b, droite a), élévations, nature, axe, route
  const q = [], qw = []; // qw : demi-largeur, distance du début du quad au bout libre de la route (début), idem (fin)
  const voidQuads = [];
  const pa = { _k: 0 }, pb = { _k: 0 }, pc = { _k: 0 };
  for (const r of net.roads) {
    if (!r._ele) continue;
    const W = deckHalf(r);
    const fine = !!r._eadj; // profil corrigé (bretelle maintenue au niveau de la chaussée qu'elle quitte) : pas plus fin
    for (let k = 0; k < r.points.length - 1; k++) {
      const s0 = r._cum[k], s1 = r._cum[k + 1], L = s1 - s0, n = Math.max(1, Math.ceil(L / (fine ? 4 : 14)));
      if (net.segFlat(r, k)) continue; // segment resté au sol : c'est une chaussée ordinaire (net.groundCover)
      for (let i = 0; i < n; i++) {
        // léger recouvrement entre tronçons consécutifs : jamais de fente où le tablier « disparaît »
        const sa = Math.max(0, s0 + (L * i) / n - 0.02), sb = Math.min(r._len, s0 + (L * (i + 1)) / n + 0.02);
        const ea = net.eleAt(r, sa), eb = net.eleAt(r, sb), em = (ea + eb) / 2;
        // tunnel couvert seulement là où il y a la hauteur d'une dalle au-dessus de la chaussée ; sinon tranchée ouverte (rampe d'accès)
        const kind = em >= -0.02 ? K_DECK : r.tunnel && em < TUNNEL_MIN ? K_TUNNEL : K_TRENCH;
        net.pointAt(r, sa, 0, pa); net.pointAt(r, sb, 0, pb);
        const cax = pa.x, caz = pa.z, cbx = pb.x, cbz = pb.z;
        q.push(0, 0, 0, 0, 0, 0, 0, 0, ea, eb, kind, cax, caz, cbx, cbz, r._i);
        qw.push(W, 0, 0);
        // la tranchée ouverte évide le sol (un peu plus large : murs de soutènement compris)
        if (kind === K_TRENCH && em < -0.3) {
          const l = Math.hypot(cbx - cax, cbz - caz) || 1, dx = (cbx - cax) / l, dz = (cbz - caz) / l, g = W + 0.45, ext = 0.6;
          const x0 = cax - dx * ext, z0 = caz - dz * ext, x1 = cbx + dx * ext, z1 = cbz + dz * ext;
          voidQuads.push([[x0 + dz * g, z0 - dx * g], [x1 + dz * g, z1 - dx * g], [x1 - dz * g, z1 + dx * g], [x0 - dz * g, z0 + dx * g]]);
        }
      }
    }
  }
  const Q = new Float32Array(q), nQ = Q.length / 16, QW = new Float32Array(qw);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < nQ; i++) { const o = i * 16, W = QW[i * 3]; x0 = Math.min(x0, Q[o + 11] - W, Q[o + 13] - W); x1 = Math.max(x1, Q[o + 11] + W, Q[o + 13] + W); z0 = Math.min(z0, Q[o + 12] - W, Q[o + 14] - W); z1 = Math.max(z1, Q[o + 12] + W, Q[o + 14] + W); }
  const gw = nQ ? Math.floor((x1 - x0) / HC) + 1 : 0, gh = nQ ? Math.floor((z1 - z0) / HC) + 1 : 0;
  const cellStart = new Int32Array(gw * gh + 1); let cellItems = new Int32Array(0);
  if (nQ) {
    const each = (i, fn) => {
      const o = i * 16, W = QW[i * 3];
      const a0 = Math.min(Q[o + 11], Q[o + 13]) - W, a1 = Math.max(Q[o + 11], Q[o + 13]) + W, b0 = Math.min(Q[o + 12], Q[o + 14]) - W, b1 = Math.max(Q[o + 12], Q[o + 14]) + W;
      for (let cz = Math.floor((b0 - z0) / HC); cz <= Math.floor((b1 - z0) / HC); cz++) for (let cx = Math.floor((a0 - x0) / HC); cx <= Math.floor((a1 - x0) / HC); cx++) fn(cz * gw + cx);
    };
    for (let i = 0; i < nQ; i++) each(i, (c) => { cellStart[c + 1]++; });
    for (let c = 0; c < gw * gh; c++) cellStart[c + 1] += cellStart[c];
    cellItems = new Int32Array(cellStart[gw * gh]);
    const fill = cellStart.slice(0, gw * gh);
    for (let i = 0; i < nQ; i++) each(i, (c) => { cellItems[fill[c]++] = i; });
  }
  // un tronçon couvre les points à moins de sa demi-largeur de son axe (capsule : robuste dans les virages serrés)
  let _t = 0, _d = 0;
  const inCap = (qi, x, z) => {
    const o = qi * 16, ux = Q[o + 13] - Q[o + 11], uz = Q[o + 14] - Q[o + 12], rx = x - Q[o + 11], rz = z - Q[o + 12];
    let t = (rx * ux + rz * uz) / (ux * ux + uz * uz || 1); t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = rx - ux * t, pz = rz - uz * t, d2 = px * px + pz * pz, W = QW[qi * 3];
    if (d2 > W * W) return false;
    _t = t; _d = Math.sqrt(d2); return true;
  };

  // berges (fournies plus tard par river.js) : fonction (x, z) -> hauteur | undefined, et « sous un tablier au sol ? »
  let bergeHeight = null, underDeck = null;
  const cH = new Float64Array(12), cW = new Float64Array(12), cX = new Float64Array(12), cZ = new Float64Array(12), cR = new Int32Array(12), cS = new Float64Array(12), cSH = new Float64Array(12), sH = new Float64Array(14);
  const cov = { dx: 0, dz: 0 };
  /**
   * Couche de hauteur : voir la règle en tête de fichier. Là où plusieurs chaussées se recouvrent, la plus « présente »
   * (le point est le plus loin de son bord) donne la surface ; les autres s'y fondent si elles sont à peu près à la
   * même hauteur (carrefour entre rampes, pied de bretelle : pas de marche), s'effacent si elles longent la première
   * plus haut ou plus bas (le dénivelé devient un talus entre les deux voies), ou forment un autre NIVEAU si elles la
   * croisent franchement (pont, passage inférieur, rue qui enjambe une tranchée).
   */
  function layer(x, z, base, y) {
    let n = 0, ground = true, needRoad = false;
    if (nQ && x >= x0 && x <= x1 && z >= z0 && z <= z1) {
      const c = Math.floor((z - z0) / HC) * gw + Math.floor((x - x0) / HC);
      for (let k = cellStart[c], e = cellStart[c + 1]; k < e; k++) {
        const qi = cellItems[k], o = qi * 16;
        if (!inCap(qi, x, z)) continue;
        const t = _t, ux = Q[o + 13] - Q[o + 11], uz = Q[o + 14] - Q[o + 12], ul = Math.sqrt(ux * ux + uz * uz) || 1;
        const el = Q[o + 8] + (Q[o + 9] - Q[o + 8]) * t, ae = Math.abs(el);
        const wb = Math.min(1, ae * 2), hAxis = baseHeightAt(Q[o + 11] + ux * t, Q[o + 12] + uz * t);
        const h = wb >= 1 ? hAxis + el : base * (1 - wb) + hAxis * wb + el;
        const w = Math.max(1e-3, QW[qi * 3] - _d), kind = Q[o + 10], ri = Q[o + 15];
        if (kind === K_TRENCH) { if (el < -0.05) ground = false; needRoad = true; }   // tranchée ouverte : pas de sol au-dessus
        else if (kind === K_DECK && el < 2.0) ground = false;                          // rampe basse, remblai : rien dessous
        if (ae < GAP) needRoad = true;
        // un seul candidat par route (ses tronçons successifs se recouvrent) : le plus présent
        let j = 0; for (; j < n; j++) if (cR[j] === ri && Math.abs(cH[j] - h) < 1.2) break;
        let w4 = w * w; w4 *= w4;
        if (j < n) { cS[j] += w4; cSH[j] += w4 * h; if (w <= cW[j]) continue; cW[j] = w; cX[j] = ux / ul; cZ[j] = uz / ul; continue; }
        if (n >= 10) continue;
        cH[n] = h; cW[n] = w; cX[n] = ux / ul; cZ[n] = uz / ul; cR[n] = ri; cS[n] = w4; cSH[n++] = w4 * h;
      }
      for (let j = 0; j < n; j++) cH[j] = cSH[j] / cS[j]; // tronçons successifs d'une même route : fondus entre eux
    }
    // une chaussée restée au sol qui recouvre le point : elle se raccorde aux rampes basses, ou enjambe la tranchée
    if (needRoad) { const g = net.groundCover(x, z, cov); if (g > 0) { cH[n] = base; cW[n] = g; cX[n] = cov.dx; cZ[n] = cov.dz; cR[n++] = -1; ground = false; } }
    let m = 0;
    if (n === 1) sH[m++] = cH[0];
    else while (n > 0) {
      let d = 0; for (let i = 1; i < n; i++) if (cW[i] > cW[d]) d = i;
      const hd = cH[d], dx = cX[d], dz = cZ[d];
      let w4 = cW[d] * cW[d]; w4 *= w4; let sw = w4, swh = w4 * hd;
      cH[d] = cH[n - 1]; cW[d] = cW[n - 1]; cX[d] = cX[n - 1]; cZ[d] = cZ[n - 1]; cR[d] = cR[n - 1]; n--;
      for (let i = 0; i < n; i++) {
        const gap = Math.abs(cH[i] - hd);
        let K;
        if (gap <= 0.8) K = 1;
        else if (Math.abs(cX[i] * dx + cZ[i] * dz) > 0.85) { if (gap >= GAP) continue; K = gap <= 1.5 ? 1 : (GAP - gap) / (GAP - 1.5); K *= K; } // voies parallèles
        else { if (gap >= 1.5) continue; K = (1.5 - gap) / 0.7; }                                                                                  // voies qui se croisent
        let wi = cW[i] * cW[i]; wi *= wi * K; sw += wi; swh += wi * cH[i];
        cH[i] = cH[n - 1]; cW[i] = cW[n - 1]; cX[i] = cX[n - 1]; cZ[i] = cZ[n - 1]; cR[i] = cR[n - 1]; n--; i--;
      }
      sH[m++] = swh / sw;
    }
    if (bergeHeight) {
      const bh = bergeHeight(x, z);
      if (bh !== undefined) { sH[m++] = bh; if (!underDeck(x, z)) ground = false; }
    }
    if (!m) return undefined;
    if (ground) sH[m++] = base;
    if (m === 1) return sH[0];
    let best = sH[0];
    if (y === undefined) { for (let i = 1; i < m; i++) if (Math.abs(sH[i] - base) < Math.abs(best - base)) best = sH[i]; return best; }
    const lim = y + STEP_UP; let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < m; i++) { const h = sH[i]; if (h <= lim && h > hi) hi = h; if (h < lo) lo = h; }
    return hi > -Infinity ? hi : lo;
  }
  /** Profondeur (m, positive) de la tranchée ouverte sous le point, 0 s'il n'y en a pas. */
  function trenchDepth(x, z) {
    if (!nQ || x < x0 || x > x1 || z < z0 || z > z1) return 0;
    const c = Math.floor((z - z0) / HC) * gw + Math.floor((x - x0) / HC);
    let d = 0;
    for (let k = cellStart[c], e = cellStart[c + 1]; k < e; k++) {
      const qi = cellItems[k], o = qi * 16;
      if (Q[o + 10] !== K_TRENCH || !inCap(qi, x, z)) continue;
      const em = -(Q[o + 8] + Q[o + 9]) / 2; if (em > d) d = em;
    }
    return d;
  }
  return {
    layer, voidQuads, count: nQ, trenchDepth, trenches: voidQuads.length,
    /** Hauteur de la surface du réseau dénivelé la plus proche de yRef (rendu des chaussées), ou yRef s'il n'y en a pas. */
    near(x, z, yRef) { const h = layer(x, z, baseHeightAt(x, z), yRef + 0.3); return h === undefined || Math.abs(h - yRef) > 1.2 ? yRef : h; },
    /** Débogage : quads qui couvrent (x, z) -> [{ road, e, w, kind }]. */
    quadsAt(x, z) {
      const out = []; if (!nQ || x < x0 || x > x1 || z < z0 || z > z1) return out;
      const c = Math.floor((z - z0) / HC) * gw + Math.floor((x - x0) / HC);
      for (let k = cellStart[c], e = cellStart[c + 1]; k < e; k++) {
        const qi = cellItems[k], o = qi * 16; if (!inCap(qi, x, z)) continue;
        out.push({ road: Q[o + 15], e: +(Q[o + 8] + (Q[o + 9] - Q[o + 8]) * _t).toFixed(2), w: +(QW[qi * 3] - _d).toFixed(2), kind: Q[o + 10] });
      }
      return out;
    },
    /** Branche les berges basses (river.js). */
    setBerge(fn, under) { bergeHeight = fn; underDeck = under; },
    /** Toutes les surfaces superposées en (x, z) (débogage / contrôles) : tableau de hauteurs. */
    surfacesAt(x, z) { const out = []; const base = baseHeightAt(x, z); for (const y of [undefined, -50, 50]) { const h = layer(x, z, base, y); const v = h === undefined ? base : h; if (!out.some((o) => Math.abs(o - v) < 0.01)) out.push(v); } return out; },
  };
}

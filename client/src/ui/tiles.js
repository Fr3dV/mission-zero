// Fond de carte en tuiles multi-niveaux, générées à la demande et mises en cache.
// Chaque tuile est peinte par un générateur découpé en petits pas ; pump(budget) en exécute
// autant que le budget de temps de l'image le permet (jamais une ville entière d'un bloc).
import { TIER, AK } from './mapdata.js';

/** Échelles des niveaux (px par mètre) : de la ville entière (1/32) au pâté de maisons (4). */
export const LEVELS = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4];
export const TILE = 256;
const BATCH = 2200; // segments (ou sommets) tracés entre deux reprises de main

// Largeur minimale à l'écran (px) par catégorie de voie et par niveau ; 0 = non dessinée à ce niveau.
const MIN_PX = [
  [2.6, 3.0, 3.4, 3.8, 4.2, 4.6, 5.0, 5.0], // autoroute, rocade
  [1.8, 2.2, 2.6, 3.0, 3.4, 3.8, 4.2, 4.2], // voie rapide
  [1.0, 1.3, 1.8, 2.2, 2.6, 3.0, 3.4, 3.4], // grands axes
  [0, 0, 1.2, 1.6, 2.0, 2.4, 2.8, 2.8], // bretelles
  [0, 0, 1.0, 1.4, 1.8, 2.2, 2.6, 2.6], // collectrices
  [0, 0, 0, 0.8, 1.2, 1.6, 2.0, 2.0], // rues
  [0, 0, 0, 0, 0.8, 1.2, 1.5, 1.5], // rues piétonnes
  [0, 0, 0, 0, 0, 1.0, 1.2, 1.2], // allées
];
// Premier niveau où une classe d'aplat est dessinée.
const POLY_MIN_L = [];
POLY_MIN_L[AK.FARM] = 1; POLY_MIN_L[AK.FOREST] = 0; POLY_MIN_L[AK.RIVER] = 0; POLY_MIN_L[AK.ISLAND] = 0; POLY_MIN_L[AK.PARK] = 0; POLY_MIN_L[AK.GRASS] = 3;
POLY_MIN_L[AK.CEMETERY] = 2; POLY_MIN_L[AK.INDUS] = 1; POLY_MIN_L[AK.COMM] = 1; POLY_MIN_L[AK.RAILAREA] = 2; POLY_MIN_L[AK.CONSTR] = 3; POLY_MIN_L[AK.PARKING] = 4;
POLY_MIN_L[AK.PLAZA] = 3; POLY_MIN_L[AK.PITCH] = 3; POLY_MIN_L[AK.WATER] = 0; POLY_MIN_L[AK.APRON] = 1; POLY_MIN_L[AK.TAXIWAY] = 1; POLY_MIN_L[AK.RUNWAY] = 0;

const area = (o) => { const a = []; for (const k of Object.keys(o)) a[AK[k]] = o[k]; return a; };
/** Palettes par style de ville (ctx.city.style). */
export const PALETTES = {
  paris: {
    out: '#080b13', land: '#111625', limit: 'rgba(240,193,112,.3)', island: '#14291f', waterEdge: '#1f4a6e',
    area: area({ FARM: '#141a1c', FOREST: '#12261c', PARK: '#14291f', GRASS: '#13251d', CEMETERY: '#16241f', INDUS: '#151a28', COMM: '#171b2c', RAILAREA: '#161a26', CONSTR: '#1a1d28', PARKING: '#151a29', PLAZA: '#1b2134', PITCH: '#173024', WATER: '#143049', RIVER: '#143049', ISLAND: '#111625', APRON: '#1c2233', TAXIWAY: '#262d40', RUNWAY: '#3a425a' }),
    road: ['#f3d9a4', '#dcb877', '#b8975c', '#c9aa72', '#5a6486', '#3a4463', '#2c3450', '#2a3a34'], roadCase: '#0c101b',
    rail: '#7c8499', railCase: '#0c101b', tram: '#8fb8d8', metro: '#6a7390', ww: '#1b4263',
    route: '#ef5a5a', player: '#6fd0ff', accent: '#f0c170', txt: '#eef0f6', mute: '#9aa3b8', bg: '#0c101b', halo: 'rgba(8,11,20,.92)',
    label: { top: '#fbeecb', major: '#e6cfa0', street: '#aab2c8', water: '#7fb4de', park: 'rgba(130,190,160,.85)', district: 'rgba(238,240,246,.5)' },
  },
  toulouse: {
    out: '#0d0809', land: '#1a1215', limit: 'rgba(242,165,131,.32)', island: '#1b2b1e', waterEdge: '#2f6390',
    area: area({ FARM: '#1d1915', FOREST: '#16241a', PARK: '#1b2b1e', GRASS: '#19261c', CEMETERY: '#1c2620', INDUS: '#211a23', COMM: '#261b20', RAILAREA: '#1f181c', CONSTR: '#261d1a', PARKING: '#221a1e', PLAZA: '#2b1f22', PITCH: '#1d3323', WATER: '#1c3c5a', RIVER: '#1c3c5a', ISLAND: '#1a1215', APRON: '#29222c', TAXIWAY: '#35313b', RUNWAY: '#4c4753' }),
    road: ['#ffdcc6', '#f0a989', '#c77b63', '#e0a08a', '#86636a', '#5e4a51', '#43343a', '#33342c'], roadCase: '#120b0d',
    rail: '#8d8790', railCase: '#120b0d', tram: '#a9cdea', metro: '#7a7480', ww: '#2a5a83',
    route: '#7fd0ff', player: '#ffe08a', accent: '#f2a583', txt: '#f6efec', mute: '#b3a3a3', bg: '#120b0d', halo: 'rgba(15,9,11,.92)',
    label: { top: '#fff0e6', major: '#f3c3ad', street: '#bfaeb0', water: '#9cc4e4', park: 'rgba(150,200,160,.85)', district: 'rgba(246,239,236,.5)' },
  },
};

export function createTiles(data, pal, opts = {}) {
  const cap = opts.cap || 200;
  const tiles = new Map();
  const pending = [], jobs = [], pool = [];
  let frame = 0, completed = 0;
  const stats = { tiles: 0, tileMs: 0, maxTileMs: 0, steps: 0, maxStepMs: 0, pumps: 0, pumpMs: 0, maxPumpMs: 0, cached: 0, dropped: 0 };
  const key = (L, tx, tz) => (L * 8192 + (tx + 4096)) * 8192 + (tz + 4096);
  const { roads, polys, rails, ww, ix, query, bounds } = data;
  const qa = [], qb = [];

  function get(L, tx, tz, prio) {
    const k = key(L, tx, tz);
    let r = tiles.get(k);
    if (!r) { r = { k, L, tx, tz, cv: null, ready: false, job: null, used: frame, prio, pf: frame, ms: 0, pin: false }; tiles.set(k, r); pending.push(r); }
    r.used = frame;
    if (r.pf !== frame) { r.pf = frame; r.prio = prio; } else if (prio < r.prio) r.prio = prio;
    return r;
  }
  function release(r) { tiles.delete(r.k); if (r.cv && pool.length < 24) pool.push(r.cv); r.cv = null; r.job = null; }
  function evict() {
    if (tiles.size <= cap) return;
    const old = [];
    for (const r of tiles.values()) if (r.ready && !r.pin && frame - r.used > 3) old.push(r);
    old.sort((a, b) => a.used - b.used);
    for (let i = 0; i < old.length && tiles.size > cap * 0.85; i++) release(old[i]);
  }

  // ------------------------------------------------------------------ peinture d'une tuile
  function* paint(r) {
    const L = r.L, s = LEVELS[L], W = TILE / s, x0 = r.tx * W, z0 = r.tz * W;
    const px = 1 / s, mg = 26 + 4 * px; // marge de requête : demi-largeur max d'une voie + liseré
    const qx0 = x0 - mg, qz0 = z0 - mg, qx1 = x0 + W + mg, qz1 = z0 + W + mg;
    const g = r.cv.getContext('2d', { alpha: false });
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.setLineDash([]);
    g.fillStyle = pal.out; g.fillRect(0, 0, TILE, TILE);
    g.setTransform(s, 0, 0, s, -x0 * s, -z0 * s);
    g.fillStyle = pal.land; g.fillRect(bounds.minX, bounds.minZ, bounds.w, bounds.h);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const lodOf = (pk) => (L <= 1 ? pk.lodA : L <= 3 ? pk.lodB : null);
    yield;

    // ---- aplats (zones, parcs, eau, aéroport), par classe
    {
      const cand = query(L <= 2 ? ix.polyBig : ix.polyAll, polys, qx0, qz0, qx1, qz1, qa);
      const by = [];
      for (let q = 0; q < cand.length; q++) {
        const i = cand[q], k = polys.k[i];
        if (L < POLY_MIN_L[k]) continue;
        if (polys.size[i] * s < (k === AK.WATER || k === AK.RIVER || k === AK.RUNWAY || k === AK.ISLAND ? 1 : 3)) continue;
        (by[k] || (by[k] = [])).push(i);
      }
      const lod = lodOf(polys);
      for (let k = 0; k < by.length; k++) {
        const list = by[k];
        if (!list) continue;
        g.fillStyle = pal.area[k] || pal.land;
        let cnt = 0;
        g.beginPath();
        for (let q = 0; q < list.length; q++) {
          const i = list[q];
          let P = polys.pts, a = polys.off[i], e = polys.off[i + 1];
          if (lod && lod.off[i + 1] - lod.off[i] >= 3) { P = lod.pts; a = lod.off[i]; e = lod.off[i + 1]; }
          g.moveTo(P[a * 2], P[a * 2 + 1]);
          for (let p = a + 1; p < e; p++) g.lineTo(P[p * 2], P[p * 2 + 1]);
          g.closePath();
          cnt += e - a;
          if (cnt > BATCH) { g.fill(); yield; g.beginPath(); cnt = 0; }
        }
        if (cnt) g.fill();
        if ((k === AK.WATER || k === AK.RIVER) && L >= 3) { g.strokeStyle = pal.waterEdge; g.lineWidth = 1.2 * px; g.stroke(); }
        if (k === AK.RUNWAY && L >= 2) { g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1 * px; g.stroke(); }
        yield;
      }
    }

    // ---- canaux et cours d'eau (axes)
    if (ww.n) {
      const cand = query(ix.ww, ww, qx0, qz0, qx1, qz1, qa);
      const lod = L <= 1 ? ww.lodA : null;
      g.strokeStyle = pal.ww;
      for (let q = 0; q < cand.length; q++) {
        const i = cand[q];
        if (ww.kind[i] === 2 && L < 2) continue; // ruisseaux : pas en vue lointaine
        const P = lod ? lod.pts : ww.pts, a = lod ? lod.off[i] : ww.off[i], e = lod ? lod.off[i + 1] : ww.off[i + 1];
        if (e - a < 2) continue;
        g.beginPath(); g.moveTo(P[a * 2], P[a * 2 + 1]);
        for (let p = a + 1; p < e; p++) g.lineTo(P[p * 2], P[p * 2 + 1]);
        g.lineWidth = Math.max(ww.wid[i], (ww.kind[i] === 2 ? 0.8 : 1.6) * px); g.stroke();
      }
      yield;
    }

    // ---- voies ferrées, tram, métro
    if (rails.n) {
      const cand = query(ix.rail, rails, qx0, qz0, qx1, qz1, qa).slice(); // copie : qa est réutilisé pendant les pauses
      const lod = L <= 1 ? rails.lodA : null;
      for (let kind = 0; kind < 4; kind++) {
        if ((kind === 1 && L < 2) || (kind === 2 && L < 3) || (kind === 3 && L < 2)) continue;
        g.beginPath();
        let any = false;
        for (let q = 0; q < cand.length; q++) {
          const i = cand[q];
          if (rails.kind[i] !== kind) continue;
          const P = lod ? lod.pts : rails.pts, a = lod ? lod.off[i] : rails.off[i], e = lod ? lod.off[i + 1] : rails.off[i + 1];
          if (e - a < 2) continue;
          any = true; g.moveTo(P[a * 2], P[a * 2 + 1]);
          for (let p = a + 1; p < e; p++) g.lineTo(P[p * 2], P[p * 2 + 1]);
        }
        if (!any) continue;
        if (kind === 0) {
          if (L >= 3) { g.strokeStyle = pal.railCase; g.lineWidth = 3.4 * px; g.stroke(); g.lineCap = 'butt'; g.setLineDash([5 * px, 5 * px]); g.strokeStyle = pal.rail; g.lineWidth = 1.8 * px; g.stroke(); g.setLineDash([]); g.lineCap = 'round'; }
          else { g.strokeStyle = pal.rail; g.globalAlpha = 0.7; g.lineWidth = 1 * px; g.stroke(); g.globalAlpha = 1; }
        } else if (kind === 1) { g.strokeStyle = pal.tram; g.globalAlpha = 0.85; g.lineWidth = (L >= 4 ? 1.8 : 1.2) * px; g.stroke(); g.globalAlpha = 1; }
        else if (kind === 2) { g.setLineDash([2 * px, 3 * px]); g.strokeStyle = pal.metro; g.lineWidth = 1.4 * px; g.stroke(); g.setLineDash([]); }
        else { g.lineCap = 'butt'; g.setLineDash([1.5 * px, 4 * px]); g.strokeStyle = pal.tram; g.lineWidth = 2.2 * px; g.stroke(); g.setLineDash([]); g.lineCap = 'round'; } // téléphérique
        yield;
      }
    }

    // ---- voies : regroupées par (catégorie, largeur), des moins importantes aux plus importantes
    {
      const groups = []; // groups[tier] = Map(largeur quantifiée → indices)
      const step = Math.max(1.5, px * 0.75);
      const take = (index) => {
        const cand = query(index, roads, qx0, qz0, qx1, qz1, qb);
        for (let q = 0; q < cand.length; q++) {
          const i = cand[q], t = roads.tier[i], mp = MIN_PX[t][L];
          if (!mp) continue;
          const wq = Math.round(Math.max(roads.wid[i] * 0.85, mp * px) / step) + (roads.flag[i] & 1 ? 4096 : 0);
          const m = groups[t] || (groups[t] = new Map());
          let a = m.get(wq);
          if (!a) m.set(wq, (a = []));
          a.push(i);
        }
      };
      take(ix.major);
      if (L >= 2) take(ix.mid);
      if (L >= 3) take(ix.minor);
      if (L >= 4) take(ix.ped);
      yield;
      const lod = lodOf(roads);
      // îlots centraux des giratoires (vue rapprochée)
      if (L >= 4) {
        g.fillStyle = pal.island; g.beginPath();
        let any = false;
        for (const m of groups) if (m) for (const list of m.values()) for (let q = 0; q < list.length; q++) {
          const i = list[q];
          if (!(roads.flag[i] & 2)) continue;
          any = true;
          const a = roads.off[i], e = roads.off[i + 1];
          g.moveTo(roads.pts[a * 2], roads.pts[a * 2 + 1]);
          for (let p = a + 1; p < e; p++) g.lineTo(roads.pts[p * 2], roads.pts[p * 2 + 1]);
          g.closePath();
        }
        if (any) g.fill();
      }
      const order = [TIER.PATH, TIER.PED, TIER.STREET, TIER.COLLECTOR, TIER.MAJOR, TIER.RAMP, TIER.TRUNK, TIER.MOTORWAY];
      for (const t of order) {
        const m = groups[t];
        if (!m) continue;
        const cased = t <= TIER.MAJOR || (t === TIER.RAMP && L >= 3) || (t === TIER.COLLECTOR && L >= 5);
        const keys = [...m.keys()].sort((a, b) => a - b);
        for (let pass = cased ? 0 : 1; pass < 2; pass++) {
          for (const wq of keys) {
            const tunnel = wq >= 4096, wm = (tunnel ? wq - 4096 : wq) * step;
            if (pass === 0 && tunnel) continue;
            const list = m.get(wq);
            if (pass === 0) { g.strokeStyle = pal.roadCase; g.lineWidth = wm + 2.4 * px; g.globalAlpha = 1; }
            else { g.strokeStyle = pal.road[t]; g.lineWidth = wm; g.globalAlpha = tunnel ? 0.4 : 1; }
            if (t === TIER.PATH) g.setLineDash([2 * px, 2.5 * px]);
            let cnt = 0;
            g.beginPath();
            for (let q = 0; q < list.length; q++) {
              const i = list[q];
              let P = roads.pts, a = roads.off[i], e = roads.off[i + 1];
              if (lod && lod.off[i + 1] - lod.off[i] >= 2) { P = lod.pts; a = lod.off[i]; e = lod.off[i + 1]; }
              g.moveTo(P[a * 2], P[a * 2 + 1]);
              for (let p = a + 1; p < e; p++) g.lineTo(P[p * 2], P[p * 2 + 1]);
              cnt += e - a;
              if (cnt > BATCH) { g.stroke(); yield; g.beginPath(); cnt = 0; }
            }
            if (cnt) g.stroke();
            if (t === TIER.PATH) g.setLineDash([]);
          }
          yield;
        }
      }
      g.globalAlpha = 1;
    }

    // ---- limite de la zone jouable
    g.strokeStyle = pal.limit; g.lineWidth = 1.5 * px; g.setLineDash([6 * px, 5 * px]); g.lineCap = 'butt';
    g.strokeRect(bounds.minX, bounds.minZ, bounds.w, bounds.h);
    g.setLineDash([]);
  }

  // ------------------------------------------------------------------ ordonnanceur
  /** Exécute des pas de peinture pendant au plus `budget` ms. Renvoie le temps passé. */
  function pump(budget) {
    if (!pending.length && !jobs.length) return 0;
    const t0 = performance.now();
    let t = t0;
    while (pending.length && t - t0 < budget) {
      let bi = -1, bp = Infinity;
      for (let i = pending.length - 1; i >= 0; i--) {
        const r = pending[i];
        if (!r.pin && frame - r.used > 45) { pending.splice(i, 1); release(r); stats.dropped++; if (bi > i) bi--; continue; }
        if (r.prio < bp) { bp = r.prio; bi = i; }
      }
      if (bi < 0 || bi >= pending.length) break;
      const r = pending[bi];
      if (!r.job) { r.cv = pool.pop() || Object.assign(document.createElement('canvas'), { width: TILE, height: TILE }); r.job = paint(r); }
      let fin = false;
      for (;;) {
        let res;
        try { res = r.job.next(); } catch (e) { console.warn('[ui] tuile', e); res = { done: true }; }
        const t2 = performance.now(), d = t2 - t;
        t = t2; r.ms += d; stats.steps++;
        if (d > stats.maxStepMs) stats.maxStepMs = d;
        if (res.done) { fin = true; break; }
        if (t - t0 >= budget) break;
      }
      if (fin) {
        r.ready = true; r.job = null; pending.splice(pending.indexOf(r), 1); completed++;
        stats.tiles++; stats.tileMs += r.ms; if (r.ms > stats.maxTileMs) stats.maxTileMs = r.ms;
        evict();
      }
    }
    while (jobs.length && t - t0 < budget) {
      const j = jobs[0];
      let res;
      try { res = j.gen.next(); } catch (e) { console.warn('[ui] tâche carte', e); res = { done: true }; }
      const t2 = performance.now(), d = t2 - t;
      t = t2; stats.steps++;
      if (d > stats.maxStepMs) stats.maxStepMs = d;
      if (res.done) { jobs.shift(); j.done?.(); }
    }
    const el = t - t0;
    stats.pumps++; stats.pumpMs += el; if (el > stats.maxPumpMs) stats.maxPumpMs = el;
    stats.cached = tiles.size;
    return el;
  }

  // ------------------------------------------------------------------ affichage
  /** Niveau adapté à une échelle d'affichage (px écran par mètre). */
  function levelFor(scale, sharp = 0.62) { let L = 0; while (L < LEVELS.length - 1 && LEVELS[L] < scale * sharp) L++; return L; }
  /**
   * Dessine les tuiles couvrant le rectangle monde donné. Le contexte doit déjà porter la transformation
   * monde → écran (rotation comprise). `sharp` : exigence de netteté (0,62 = jusqu'à 1,6× d'agrandissement toléré). Renvoie le nombre de tuiles encore manquantes (remplacées par un niveau plus grossier).
   */
  function draw(g, scale, x0, z0, x1, z1, cx, cz, sharp) {
    const L = levelFor(scale, sharp), W = TILE / LEVELS[L], eps = 0.7 / scale;
    const a = Math.floor(x0 / W), b = Math.floor(z0 / W), c = Math.floor(x1 / W), d = Math.floor(z1 / W);
    let missing = 0;
    for (let tz = b; tz <= d; tz++) for (let tx = a; tx <= c; tx++) {
      const dx = (tx + 0.5) * W - cx, dz = (tz + 0.5) * W - cz;
      const r = get(L, tx, tz, (dx * dx + dz * dz) / (W * W));
      if (r.ready) { g.drawImage(r.cv, tx * W, tz * W, W + eps, W + eps); continue; }
      missing++;
      for (let k = 1; k <= L; k++) {
        const f = 1 << k, ptx = Math.floor(tx / f), ptz = Math.floor(tz / f);
        const p = tiles.get(key(L - k, ptx, ptz));
        if (!p || !p.ready) continue;
        p.used = frame;
        const sub = TILE / f;
        g.drawImage(p.cv, (tx - ptx * f) * sub, (tz - ptz * f) * sub, sub, sub, tx * W, tz * W, W + eps, W + eps);
        break;
      }
    }
    return missing;
  }
  /** Demande en avance les tuiles d'un rectangle (sans dessiner). */
  function prefetch(scale, x0, z0, x1, z1, cx, cz, sharp) {
    const L = levelFor(scale, sharp), W = TILE / LEVELS[L];
    for (let tz = Math.floor(z0 / W); tz <= Math.floor(z1 / W); tz++) for (let tx = Math.floor(x0 / W); tx <= Math.floor(x1 / W); tx++) {
      const dx = (tx + 0.5) * W - cx, dz = (tz + 0.5) * W - cz;
      get(L, tx, tz, 4 + (dx * dx + dz * dz) / (W * W));
    }
  }

  // Niveau 0 (ville entière) : demandé d'emblée et jamais libéré → il y a toujours un fond à afficher.
  {
    const W = TILE / LEVELS[0], e = data.ext;
    for (let tz = Math.floor(e.minZ / W); tz <= Math.floor((e.maxZ - 1) / W); tz++) for (let tx = Math.floor(e.minX / W); tx <= Math.floor((e.maxX - 1) / W); tx++) get(0, tx, tz, -1).pin = true;
  }

  return {
    pump, draw, prefetch, levelFor, stats, pal,
    beginFrame() { frame++; },
    addJob(gen, done) { const j = { gen, done }; jobs.push(j); return j; },
    cancelJob(j) { const i = jobs.indexOf(j); if (i >= 0) jobs.splice(i, 1); },
    get completed() { return completed; },
    get pending() { return pending.length; },
    resetStats() { for (const k of Object.keys(stats)) stats[k] = 0; },
  };
}

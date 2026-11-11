// Minicarte + grande carte + itinéraire GPS — module interface.
// Le fond vient de tuiles multi-niveaux (tiles.js) générées à la demande à partir des index de mapdata.js ;
// rien n'est pré-rendu pour la ville entière. Libellés (noms de voies, pastilles A620…) : calque recalculé
// par petits pas quand la vue se stabilise. Marqueurs regroupés quand ils se chevauchent.
import { h, icon, clamp, fmtDist, zc } from './util.js';
import { buildMapData, TIER, AK } from './mapdata.js';
import { createTiles, PALETTES } from './tiles.js';
import { CITY_SOURCES } from './cityart.js';
import { MISSIONS } from '@shared/missions.js';
import { PROPERTIES } from '@shared/properties.js';

const SANS = '"Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif';
const COND = '"Avenir Next Condensed", "DIN Condensed", "Arial Narrow", "Avenir Next", system-ui, sans-serif';
const SERIF = 'Didot, "Bodoni 72", Georgia, serif';
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const DISTRICT = /^(quarter|suburb|neighbou?rhood|district|quartier|borough|locality|town|village|hamlet|commune|arrondissement)$/;
const PLACE_KIND = {
  metro: ['Station de métro', 2.5], subway: ['Station de métro', 2.5], tram: ['Station de tramway', 2.5], tramstop: ['Station de tramway', 2.5],
  station: ['Gare', 2.5], train: ['Gare', 2.5], museum: ['Musée', 4], theatre: ['Théâtre', 4], stadium: ['Stade', 4], hospital: ['Hôpital', 4],
  university: ['Université', 4], airport: ['Aéroport', 1], mall: ['Centre commercial', 4], townhall: ['Mairie', 4.5], market: ['Marché', 4.5],
  cable_station: ['Station du téléphérique', 2.5],
};
const TOWNHALL = /^(?:Mairie de quartier|Hôtel de ville de|Château-Mairie de|Mairie d['’]|Mairie de|Mairie du)\s*(.+)$/i;

export function createMaps(ctx, api) {
  const { bus, store } = ctx;
  const wd = ctx.worldData || {};
  const cityName = ctx.city?.name || 'Paris';
  const pal = PALETTES[ctx.city?.style] || PALETTES[ctx.city?.id] || PALETTES.paris;
  const low = ctx.quality === 'low';
  const data = buildMapData(wd, ctx.BOUNDS);
  const tiles = createTiles(data, pal, { cap: low ? 110 : 240 });
  const B = data.ext;
  const perf = { mini: { n: 0, ms: 0, max: 0 }, big: { n: 0, ms: 0, max: 0 }, labels: { n: 0, ms: 0 }, frame: { n: 0, ms: 0, max: 0 } };
  const tick = (o, t0) => { const d = performance.now() - t0; o.n++; o.ms += d; if (d > o.max) o.max = d; return d; };

  const roadAt = (x, z, maxD) => data.roadAt(x, z, maxD);
  const roadNameAt = (x, z, maxD) => { const r = data.roadAt(x, z, maxD); return r ? r.name || r.ref : null; };

  // ---------- Itinéraire de repli (A* sur worldData.graph) : utilisé seulement si personne ne fournit de tracé ----------
  let adj = null;
  const nodes = wd.graph?.nodes || [];
  function buildAdj() {
    adj = nodes.map(() => []);
    for (const e of wd.graph?.edges || []) {
      const a = nodes[e[0]], b = nodes[e[1]]; if (!a || !b) continue;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      adj[e[0]].push(e[1], d); adj[e[1]].push(e[0], d);
    }
  }
  function nearestNode(x, z) {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (adj[i].length === 0) continue;
      const dx = nodes[i][0] - x, dz = nodes[i][1] - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }
  function route(x0, z0, x1, z1) {
    // au-delà de 30 000 nœuds (Toulouse), un A* synchrone dépasserait le budget d'une image : trait direct
    if (!nodes.length || nodes.length > 30000) return [[x0, z0], [x1, z1]];
    if (!adj) buildAdj();
    const s = nearestNode(x0, z0), t = nearestNode(x1, z1);
    if (s < 0 || t < 0) return [[x0, z0], [x1, z1]];
    const n = nodes.length, gs = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const heap = [];
    const push = (f, v) => { let i = heap.length; heap.push([f, v]); while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= f) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let i = 0; for (;;) { let m = i; const l = 2 * i + 1, r = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
      return top;
    };
    const tx = nodes[t][0], tz = nodes[t][1];
    gs[s] = 0; push(0, s);
    let found = false;
    while (heap.length) {
      const u = pop()[1];
      if (done[u]) continue; done[u] = 1;
      if (u === t) { found = true; break; }
      const a = adj[u];
      for (let i = 0; i < a.length; i += 2) {
        const v = a[i], ng = gs[u] + a[i + 1];
        if (ng < gs[v]) { gs[v] = ng; prev[v] = u; push(ng + Math.hypot(nodes[v][0] - tx, nodes[v][1] - tz), v); }
      }
    }
    const out = [[x1, z1]];
    if (found) for (let u = t; u >= 0; u = prev[u]) out.push(nodes[u]);
    out.push([x0, z0]);
    return out.reverse();
  }

  // ---------- État GPS ----------
  let gps = null; // {x, z, label, path, own, mine, cx, cz}
  let nextGpsMine = false;
  const me = () => {
    const p = ctx.player || {};
    return { x: p.pos?.x || 0, z: p.pos?.z || 0, yaw: (p.mode === 'vehicle' && p.vehicle ? p.vehicle.yaw : p.yaw) || 0 };
  };
  bus.on('gps:set', (p) => {
    if (!p || !isFinite(p.x) || !isFinite(p.z)) return;
    const m = me();
    const has = Array.isArray(p.path) && p.path.length > 1;
    // un autre module (gameplay) a déjà répondu à cette même demande avec un tracé : on le garde
    if (!has && gps && !gps.own && gps.x === p.x && gps.z === p.z) return;
    gps = { x: p.x, z: p.z, label: p.label || 'Destination', path: has ? p.path : route(m.x, m.z, p.x, p.z), own: !has, mine: nextGpsMine, cx: m.x, cz: m.z, hint: 0 };
    api.onGps?.(gps);
    big.dirty = true;
  });
  bus.on('gps:clear', () => { gps = null; api.onGps?.(null); big.dirty = true; });
  function setGps(x, z, label) { nextGpsMine = true; bus.emit('gps:set', { x, z, label }); nextGpsMine = false; }

  /** Tracé à afficher (tel que reçu) : coupe la partie déjà parcourue et repart de la position du joueur. */
  function livePath(m) {
    if (!gps?.path) return null;
    const p = gps.path, n = p.length;
    // recherche locale autour du dernier sommet connu (les tracés de Toulouse comptent des milliers de points)
    let bi = clamp(gps.hint || 0, 0, n - 1), bd = Infinity;
    const lo = n > 400 ? Math.max(0, bi - 60) : 0, hi = n > 400 ? Math.min(n, bi + 240) : n;
    for (let i = lo; i < hi; i++) { const d = (p[i][0] - m.x) ** 2 + (p[i][1] - m.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    if (n > 400 && bd > 400 * 400) { bd = Infinity; for (let i = 0; i < n; i++) { const d = (p[i][0] - m.x) ** 2 + (p[i][1] - m.z) ** 2; if (d < bd) { bd = d; bi = i; } } }
    gps.hint = bi;
    if (bi < n - 1) {
      const a = p[bi], b = p[bi + 1];
      if ((m.x - a[0]) * (b[0] - a[0]) + (m.z - a[1]) * (b[1] - a[1]) > 0) bi++;
    }
    return { pts: p, from: bi };
  }
  function strokePath(g, m, lp) {
    g.beginPath(); g.moveTo(m.x, m.z);
    for (let i = lp.from; i < lp.pts.length; i++) g.lineTo(lp.pts[i][0], lp.pts[i][1]);
  }

  // ---------- Marqueurs ----------
  let markers = [];
  function missionList() { const g = ctx.gameplay?.missions; return Array.isArray(g) && g.length ? g : MISSIONS; }
  function propertyList() { const g = ctx.gameplay?.properties; return Array.isArray(g) && g.length ? g : PROPERTIES; }
  function dealerList() {
    const g = ctx.gameplay || {};
    const d = g.dealers || g.dealerships || g.concessions;
    return Array.isArray(d) ? d : [];
  }
  function refreshMarkers() {
    const out = [];
    for (const l of ctx.LANDMARKS || []) if (!l.hidden) out.push({ t: 'landmark', x: l.x, z: l.z, label: l.name, sub: 'Monument' });
    for (const d of dealerList()) if (isFinite(d?.x) && isFinite(d?.z)) out.push({ t: 'dealer', x: d.x, z: d.z, label: d.name || (d.brand ? `Concession ${d.brand}` : 'Concession'), brand: d.brand, sub: 'Concession automobile' });
    const owners = store.propertyOwners || {}, mine = store.me?.properties || [];
    for (const p of propertyList()) {
      if (!isFinite(p?.x) || !isFinite(p?.z)) continue;
      const o = owners[p.id];
      const st = mine.includes(p.id) || (o && o.id != null && o.id === store.me?.id) ? 'mine' : o ? 'taken' : 'free';
      out.push({ t: 'property', x: p.x, z: p.z, label: p.name, id: p.id, st, sub: st === 'mine' ? 'Votre bien' : st === 'taken' ? `Propriété de ${o.name || '…'}` : `À vendre · ${zc(p.price)}` });
    }
    const cur = store.mission?.id ?? store.mission?.mission?.id;
    for (const m of missionList()) {
      const s = m?.start || (isFinite(m?.x) ? m : null);
      if (!s || !isFinite(s.x) || !isFinite(s.z) || m.id === cur) continue;
      out.push({ t: 'mission', x: s.x, z: s.z, label: m.title || 'Mission', id: m.id, sub: m.reward != null ? `Mission · ${zc(m.reward)}` : 'Mission' });
    }
    markers = out;
  }
  function playerMarkers() {
    const out = [];
    const players = store.players;
    if (!players || typeof players.forEach !== 'function') return out;
    players.forEach((p, id) => { if (p && (p.id ?? id) !== store.me?.id && isFinite(p.x) && isFinite(p.z)) out.push({ t: 'player', x: p.x, z: p.z, label: p.name || 'Joueur', id: p.id ?? id, sub: 'Joueur' }); });
    return out;
  }

  /** Pictogramme d'un marqueur, centré en (x,y), taille r (px). */
  function glyph(g, m, x, y, r) {
    g.lineWidth = 1.5;
    if (m.t === 'landmark') {
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.78, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.78, y); g.closePath();
      g.fillStyle = pal.bg; g.fill(); g.strokeStyle = pal.accent; g.stroke();
      g.beginPath(); g.arc(x, y, r * 0.22, 0, 6.3); g.fillStyle = pal.accent; g.fill();
    } else if (m.t === 'property') {
      const c = m.st === 'mine' ? '#5fd39a' : m.st === 'taken' ? '#8b93a8' : pal.txt;
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y - r * 0.1); g.lineTo(x + r * 0.7, y - r * 0.1); g.lineTo(x + r * 0.7, y + r * 0.85); g.lineTo(x - r * 0.7, y + r * 0.85); g.lineTo(x - r * 0.7, y - r * 0.1); g.lineTo(x - r, y - r * 0.1); g.closePath();
      g.fillStyle = m.st === 'free' ? pal.bg : c; g.fill(); g.strokeStyle = c; g.stroke();
    } else if (m.t === 'mission') {
      g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fillStyle = pal.accent; g.fill(); g.strokeStyle = pal.bg; g.stroke();
      g.fillStyle = pal.bg; g.fillRect(x - r * 0.14, y - r * 0.58, r * 0.28, r * 0.72);
      g.beginPath(); g.arc(x, y + r * 0.48, r * 0.17, 0, 6.3); g.fill();
    } else if (m.t === 'dealer') {
      const q = r * 0.9;
      g.beginPath(); g.rect(x - q, y - q, q * 2, q * 2); g.fillStyle = '#7aa8ff'; g.fill(); g.strokeStyle = pal.bg; g.stroke();
      g.fillStyle = pal.bg; g.fillRect(x - q * 0.62, y - q * 0.1, q * 1.24, q * 0.42); g.fillRect(x - q * 0.36, y - q * 0.5, q * 0.72, q * 0.44);
    } else if (m.t === 'player') {
      g.beginPath(); g.arc(x, y, r * 0.72, 0, 6.3); g.fillStyle = pal.player; g.fill(); g.strokeStyle = pal.bg; g.lineWidth = 2; g.stroke();
    } else if (m.t === 'gps') {
      g.beginPath(); g.arc(x, y - r * 0.5, r * 0.8, Math.PI * 0.85, Math.PI * 2.15); g.lineTo(x, y + r); g.closePath();
      g.fillStyle = pal.route; g.fill(); g.strokeStyle = '#fff'; g.stroke();
      g.beginPath(); g.arc(x, y - r * 0.5, r * 0.28, 0, 6.3); g.fillStyle = '#fff'; g.fill();
    } else if (m.t === 'cluster') {
      g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fillStyle = pal.bg; g.fill(); g.strokeStyle = pal.accent; g.lineWidth = 1.5; g.stroke();
    } else if (m.t === 'place') {
      g.beginPath(); g.arc(x, y, r * 0.7, 0, 6.3); g.fillStyle = pal.txt; g.fill(); g.strokeStyle = pal.bg; g.lineWidth = 2; g.stroke();
    }
  }
  function arrow(g, x, y, r, rot) {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.72, r * 0.8); g.lineTo(0, r * 0.42); g.lineTo(-r * 0.72, r * 0.8); g.closePath();
    g.fillStyle = '#fff'; g.strokeStyle = pal.bg; g.lineWidth = 2; g.stroke(); g.fill();
    g.restore();
  }

  // =====================================================================
  // Minicarte
  // =====================================================================
  const mini = { el: null, cv: null, g: null, size: 0, dpr: 1, zoom: 0.62, look: 0 };
  mini.cv = h('canvas', { class: 'mz-mini-cv' });
  mini.north = h('span', { class: 'mz-mini-n', text: 'N' });
  mini.el = h('div', { class: 'mz-mini', title: 'Carte (M)', onclick: () => api.openMap?.() }, mini.cv, mini.north);
  function sizeMini() {
    const css = api.isCompact() ? 104 : 184;
    mini.dpr = Math.min(window.devicePixelRatio || 1, 2);
    mini.size = css;
    mini.cv.width = mini.cv.height = Math.round(css * mini.dpr);
    mini.g = mini.cv.getContext('2d', { alpha: false });
  }
  const MINI_SHARP = low ? 0.62 : 0.88;
  const speedOf = () => Math.abs((ctx.player?.mode === 'vehicle' ? ctx.player?.vehicle?.speed : ctx.player?.speed) || 0);
  function drawMini() {
    const g = mini.g; if (!g) return;
    const t0 = performance.now();
    const m = me(), D = mini.cv.width, R = D / 2, dpr = mini.dpr, spd = speedOf();
    // Dézoom doux avec la vitesse : ~125 m de rayon à pied, ~360 m à 130 km/h, 720 m au-delà de 330 km/h.
    const radius = clamp(125 + spd * 6.5, 125, 720);
    mini.zoom += (mini.size / 2 / radius - mini.zoom) * 0.07;
    // À vive allure le joueur glisse vers le bas du cercle : plus de route visible devant.
    mini.look += (clamp(spd / 38, 0, 1) * 0.3 - mini.look) * 0.06;
    const k = mini.zoom * dpr, oy = R * mini.look;
    const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = pal.out; g.fillRect(0, 0, D, D);
    g.setTransform(k * c, k * s, -k * s, k * c, R - k * (c * m.x - s * m.z), R + oy - k * (s * m.x + c * m.z));
    const wcx = m.x - s * oy / k, wcz = m.z - c * oy / k, rad = R / k + 2;
    // la minicarte ne couvre que quelques tuiles : on peut se permettre le niveau le plus net
    tiles.draw(g, k, wcx - rad, wcz - rad, wcx + rad, wcz + rad, wcx, wcz, MINI_SHARP);
    if (spd > 10) tiles.prefetch(k, wcx - s * rad * 1.6 - rad, wcz - c * rad * 1.6 - rad, wcx - s * rad * 1.6 + rad, wcz - c * rad * 1.6 + rad, wcx, wcz, MINI_SHARP);
    const lp = livePath(m);
    if (lp) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      strokePath(g, m, lp); g.strokeStyle = pal.halo; g.lineWidth = 7.5 * dpr / k; g.stroke();
      g.strokeStyle = pal.route; g.lineWidth = 4 * dpr / k; g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const rMax = R - 9 * dpr, reach = (R + oy) / k + 30;
    const put = (mk, edge, r) => {
      const wx = mk.x - m.x, wz = mk.z - m.z;
      if (!edge && (wx > reach || wx < -reach || wz > reach || wz < -reach)) return;
      let x = k * (wx * c - wz * s), y = oy + k * (wx * s + wz * c);
      const d = Math.hypot(x, y);
      if (d > rMax) { if (!edge) return; x *= rMax / d; y *= rMax / d; }
      glyph(g, mk, R + x, R + y, r * dpr);
    };
    for (let i = 0; i < markers.length; i++) put(markers[i], false, markers[i].t === 'landmark' ? 6 : 5.5);
    for (const mk of playerMarkers()) put(mk, true, 5.5);
    if (gps) put({ t: 'gps', x: gps.x, z: gps.z }, true, 7.5);
    arrow(g, R, R + oy, 8.5 * dpr, 0);
    // « N » sur l'anneau (transform CSS : pas de reflow)
    const nr = mini.size / 2 - 1;
    mini.north.style.transform = `translate(${(s * nr).toFixed(1)}px, ${(-c * nr).toFixed(1)}px)`;
    tick(perf.mini, t0);
  }

  // =====================================================================
  // Grande carte
  // =====================================================================
  const ZMAX = 3;
  const big = { open: false, dirty: false, cx: 0, cz: 0, zoom: 0.5, minZoom: 0.05, el: null, cv: null, g: null, w: 0, h: 0, dpr: 1, sel: null, seen: 0, clusters: [], moveT: 0 };
  big.cv = h('canvas', { class: 'mz-map-cv' });
  big.info = h('div', { class: 'mz-map-info' });
  const view = () => { big.dirty = true; big.moveT = performance.now(); lab.stale = true; };
  const zoomBy = (f) => { big.zoom = clamp(big.zoom * f, big.minZoom, ZMAX); clampView(); view(); };
  const searchIn = h('input', { class: 'mz-input mz-map-search-in', type: 'search', placeholder: 'Rechercher un lieu, une station, une rue…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Rechercher un lieu' });
  const searchRes = h('div', { class: 'mz-map-results', hidden: true });
  const st = data.stats.tiers;
  const legendBase = [
    st[TIER.MOTORWAY] + st[TIER.TRUNK] > 0 ? ['line', pal.road[0], 'Autoroute, rocade', 5] : null,
    ['line', pal.road[2], 'Grand axe', 3], ['line', pal.road[5], 'Rue', 2],
    data.rails.n ? ['dash', pal.rail, 'Voie ferrée', 2] : null,
    data.rails.kind.includes?.(1) ? ['line', pal.tram, 'Tramway', 2] : null,
    data.ww.n ? ['line', pal.ww, 'Canal', 4] : null,
    data.polys.k.includes?.(AK.RUNWAY) ? ['line', pal.area[AK.RUNWAY], 'Aéroport', 6] : null,
  ].filter(Boolean);
  const sources = (() => {
    const s = wd.meta?.sources;
    if (Array.isArray(s) && s.length) return '© ' + s.map((x) => (typeof x === 'string' ? x : x?.name || x?.title || '')).filter(Boolean).map((x) => x.replace(/^©\s*/, '')).join(', ');
    if (typeof s === 'string' && s) return s;
    return CITY_SOURCES[ctx.city?.id] || CITY_SOURCES.paris;
  })();
  // mentions détaillées fournies avec les données (licences), affichées dans les réglages
  const sourceDetails = [...new Set([wd.meta?.attribution, wd.pois?.meta?.attribution].filter((s) => typeof s === 'string' && s))];
  big.el = h('div', { class: 'mz-map', hidden: true },
    big.cv,
    h('div', { class: 'mz-map-head' },
      h('div', { class: 'mz-map-title' }, h('span', { class: 'mz-eyebrow', text: `Plan de ${cityName}` }), h('strong', { text: 'Carte' })),
      h('div', { class: 'mz-map-search' }, icon('locate', 16), searchIn, searchRes),
      h('div', { class: 'mz-map-hint', text: 'Cliquez pour tracer un itinéraire · molette pour zoomer' }),
      h('button', { class: 'mz-iconbtn', type: 'button', title: 'Fermer (M)', onclick: () => api.close?.() }, icon('close'))),
    h('div', { class: 'mz-map-tools' },
      h('button', { class: 'mz-iconbtn', type: 'button', title: 'Zoom avant', onclick: () => zoomBy(1.6) }, icon('plus')),
      h('button', { class: 'mz-iconbtn', type: 'button', title: 'Zoom arrière', onclick: () => zoomBy(1 / 1.6) }, icon('minus')),
      h('button', { class: 'mz-iconbtn', type: 'button', title: 'Recentrer sur moi', onclick: () => { const m = me(); big.cx = m.x; big.cz = m.z; clampView(); view(); } }, icon('locate')),
      h('button', { class: 'mz-iconbtn', type: 'button', title: `Voir tout ${cityName}`, onclick: () => { big.cx = (B.minX + B.maxX) / 2; big.cz = (B.minZ + B.maxZ) / 2; big.zoom = big.minZoom; view(); } }, icon('map'))),
    h('div', { class: 'mz-map-legend' },
      h('div', { class: 'mz-leg-grid' }, [
        ['me', 'Vous'], ['player', 'Joueurs'], ['landmark', 'Monuments'], ['mission', 'Missions'],
        ['free', 'Bien à vendre'], ['mine', 'Votre bien'], ['dealer', 'Concessions'], ['gps', 'Destination'],
      ].map(([k, t]) => h('div', { class: 'mz-leg' }, h('canvas', { width: 36, height: 36, dataset: { k } }), t))),
      h('div', { class: 'mz-leg-grid mz-leg-base' }, legendBase.map(([kind, col, t, w]) => h('div', { class: 'mz-leg' }, h('i', { class: 'mz-leg-line' + (kind === 'dash' ? ' is-dash' : ''), style: `--c:${col};--w:${w}px` }), t)))),
    h('div', { class: 'mz-map-credit', text: sources }),
    big.info);
  big.el.querySelectorAll('.mz-leg canvas').forEach((c) => {
    const g = c.getContext('2d'), k = c.dataset.k;
    if (k === 'me') arrow(g, 18, 18, 12, 0);
    else if (k === 'free' || k === 'mine') glyph(g, { t: 'property', st: k }, 18, 18, 11);
    else glyph(g, { t: k }, 18, k === 'gps' ? 20 : 18, k === 'gps' ? 12 : 11);
  });

  function sizeBig() {
    big.dpr = Math.min(window.devicePixelRatio || 1, low ? 1 : 2);
    big.w = window.innerWidth; big.h = window.innerHeight;
    big.cv.width = Math.round(big.w * big.dpr); big.cv.height = Math.round(big.h * big.dpr);
    big.g = big.cv.getContext('2d', { alpha: false });
    big.minZoom = Math.min(big.w / B.w, big.h / B.h) * 0.94;
    big.zoom = clamp(big.zoom, big.minZoom, ZMAX);
  }
  function clampView() { big.cx = clamp(big.cx, B.minX, B.maxX); big.cz = clamp(big.cz, B.minZ, B.maxZ); }
  const w2s = (x, z) => [(x - big.cx) * big.zoom + big.w / 2, (z - big.cz) * big.zoom + big.h / 2];
  const s2w = (sx, sy) => [(sx - big.w / 2) / big.zoom + big.cx, (sy - big.h / 2) / big.zoom + big.cz];

  // ---------- Calque des libellés (noms de voies le long du tracé, pastilles de numéro, quartiers, parcs) ----------
  const lab = { front: document.createElement('canvas'), back: document.createElement('canvas'), ready: false, cx: 0, cz: 0, z: 1, stale: true, job: null, token: 0 };
  const cw = new Map(); // largeur des caractères par police
  function charW(g, font, ch) {
    let m = cw.get(font);
    if (!m) cw.set(font, (m = new Map()));
    let w = m.get(ch);
    if (w == null) { w = g.measureText(ch).width; m.set(ch, w); }
    return w;
  }
  // Quartiers et communes : POI dédiés s'il y en a ; sinon déduits des mairies (« Mairie de quartier Lardenne », « Mairie de Blagnac »)
  // et des grands ensembles résidentiels nommés. Zones d'activité nommées : pour la recherche.
  let districts = null, zones = null;
  function buildDistricts() {
    districts = []; zones = [];
    const seen = new Set();
    const add = (name, x, z) => { const n = norm(name); if (n && !seen.has(n) && isFinite(x) && isFinite(z)) { seen.add(n); districts.push({ name, x, z }); } };
    for (const p of wd.pois?.pois || []) {
      if (!p || !p.name) continue;
      if (DISTRICT.test(p.kind || '')) add(p.name, p.x, p.z);
      else if (p.kind === 'townhall') { const m = TOWNHALL.exec(p.name); if (m && !/^\d+$/.test(m[1])) add(m[1].replace(/^./, (c) => c.toUpperCase()), p.x, p.z); }
    }
    for (const a of wd.pois?.areas || []) {
      if (!a || !a.name || !Array.isArray(a.polygon) || (a.kind !== 'residential' && a.kind !== 'industrial' && a.kind !== 'commercial')) continue;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const q of a.polygon) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; }
      const size = Math.hypot(x1 - x0, z1 - z0);
      if (a.kind === 'residential') { if (size >= 320) add(a.name, (x0 + x1) / 2, (z0 + z1) / 2); }
      else if (size >= 160) zones.push({ name: a.name, x: (x0 + x1) / 2, z: (z0 + z1) / 2 });
    }
  }
  function* buildLabels(token) {
    const t0 = performance.now();
    const z = big.zoom, dpr = big.dpr, W = big.w, H = big.h, cx = big.cx, cz = big.cz;
    const cv = lab.back;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    const x0 = cx - W / 2 / z, z0 = cz - H / 2 / z, x1 = x0 + W / z, z1 = z0 + H / z;
    const placed = [], seen = new Map(), cand = [];
    const hit = (a, b, c, d) => { for (const q of placed) if (a < q[2] && c > q[0] && b < q[3] && d > q[1]) return true; return false; };
    const repeat = (key, x, y, dist) => { const l = seen.get(key); if (l) { for (const q of l) if (Math.abs(q[0] - x) < dist && Math.abs(q[1] - y) < dist) return true; l.push([x, y]); } else seen.set(key, [[x, y]]); return false; };
    const rx = [], ry = [], rl = [];
    /** Plus longue portion d'une polyligne à l'écran → rx/ry (px) et longueurs cumulées rl. Renvoie sa longueur. */
    const run = (P, a, e) => {
      let bs = -1, be = -1, bl = 0, cs = -1, cl = 0, px = 0, py = 0;
      for (let p = a; p < e; p++) {
        const sx = (P[p * 2] - x0) * z, sy = (P[p * 2 + 1] - z0) * z;
        const inside = sx > -30 && sy > -30 && sx < W + 30 && sy < H + 30;
        if (inside) { if (cs < 0) { cs = p; cl = 0; } else cl += Math.hypot(sx - px, sy - py); if (cl > bl || bs < 0) { bl = cl; bs = cs; be = p; } } else cs = -1;
        px = sx; py = sy;
      }
      rx.length = ry.length = rl.length = 0;
      if (bs < 0 || be <= bs) return 0;
      let acc = 0;
      for (let p = bs; p <= be; p++) {
        const sx = (P[p * 2] - x0) * z, sy = (P[p * 2 + 1] - z0) * z;
        if (rx.length) acc += Math.hypot(sx - rx[rx.length - 1], sy - ry[ry.length - 1]);
        rx.push(sx); ry.push(sy); rl.push(acc);
      }
      return acc;
    };
    const at = (d, out) => { // point et angle à l'abscisse curviligne d
      let i = 1;
      while (i < rl.length - 1 && rl[i] < d) i++;
      const seg = rl[i] - rl[i - 1] || 1, t = (d - rl[i - 1]) / seg;
      out[0] = rx[i - 1] + (rx[i] - rx[i - 1]) * t; out[1] = ry[i - 1] + (ry[i] - ry[i - 1]) * t; out[2] = Math.atan2(ry[i] - ry[i - 1], rx[i] - rx[i - 1]);
    };
    const pa = [0, 0, 0], pb = [0, 0, 0];
    const along = (text, font, color, P, a, e, gap, spacing) => {
      const len = run(P, a, e);
      if (len < 40) return false;
      g.font = font;
      let tw = 0;
      for (const ch of text) tw += charW(g, font, ch) + spacing;
      if (len < tw + 24) return false;
      const s0 = (len - tw) / 2;
      at(s0, pa); at(s0 + tw, pb);
      if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < tw * 0.86) return false; // trop sinueux
      const bx0 = Math.min(pa[0], pb[0]) - 5, by0 = Math.min(pa[1], pb[1]) - 8, bx1 = Math.max(pa[0], pb[0]) + 5, by1 = Math.max(pa[1], pb[1]) + 8;
      if (hit(bx0, by0, bx1, by1)) return false;
      if (repeat(text, (bx0 + bx1) / 2, (by0 + by1) / 2, gap)) return false;
      placed.push([bx0, by0, bx1, by1]);
      const flip = pb[0] < pa[0];
      const gl = [];
      let d = flip ? s0 + tw : s0;
      for (const ch of text) {
        const w = charW(g, font, ch) + spacing;
        at(flip ? d - w / 2 : d + w / 2, pa);
        gl.push(ch, pa[0], pa[1], flip ? pa[2] + Math.PI : pa[2]);
        d += flip ? -w : w;
      }
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      for (let pass = 0; pass < 2; pass++) {
        if (pass === 0) { g.strokeStyle = pal.halo; g.lineWidth = 3; } else g.fillStyle = color;
        for (let i = 0; i < gl.length; i += 4) {
          const co = Math.cos(gl[i + 3]) * dpr, si = Math.sin(gl[i + 3]) * dpr;
          g.setTransform(co, si, -si, co, gl[i + 1] * dpr, gl[i + 2] * dpr);
          if (pass === 0) g.strokeText(gl[i], 0, 0); else g.fillText(gl[i], 0, 0);
        }
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    };
    const flat = (text, x, y, font, color, key, gap) => {
      g.font = font;
      const hw = g.measureText(text).width / 2 + 6;
      if (x < -hw || y < -10 || x > W + hw || y > H + 10 || hit(x - hw, y - 9, x + hw, y + 9)) return false;
      if (key && repeat(key, x, y, gap)) return false;
      placed.push([x - hw, y - 9, x + hw, y + 9]);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.strokeStyle = pal.halo; g.lineWidth = 3.5; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
      return true;
    };
    const shield = (ref, P, a, e) => {
      const len = run(P, a, e);
      if (len < 70) return;
      at(len / 2, pa);
      g.font = `700 10px ${SANS}`;
      const hw = g.measureText(ref).width / 2 + 5, x = pa[0], y = pa[1];
      if (hit(x - hw - 2, y - 10, x + hw + 2, y + 10) || repeat('#' + ref, x, y, 360)) return;
      placed.push([x - hw - 2, y - 10, x + hw + 2, y + 10]);
      const red = /^[AN]\s?\d/i.test(ref), yel = /^(R?[DM])\s?\d/i.test(ref);
      g.beginPath(); g.roundRect(x - hw, y - 7.5, hw * 2, 15, 3);
      g.fillStyle = red ? '#c8372d' : yel ? '#f2c230' : pal.bg; g.fill();
      g.strokeStyle = red || yel ? 'rgba(255,255,255,.85)' : pal.mute; g.lineWidth = 1; g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = yel ? '#1a1206' : '#fff'; g.fillText(ref, x, y + 0.5);
    };

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const { roads, ww, polys, ix, query } = data;
    let work = 0;
    const lodR = z < 0.2 ? roads.lodA : z < 1 ? roads.lodB : null;
    const geo = (i) => (lodR && lodR.off[i + 1] - lodR.off[i] >= 2 ? [lodR.pts, lodR.off[i], lodR.off[i + 1]] : [roads.pts, roads.off[i], roads.off[i + 1]]);
    // 1. pastilles de numéro (A620, N124, M901…)
    query(ix.major, roads, x0, z0, x1, z1, cand);
    const majors = cand.slice();
    for (const i of majors) {
      const r = roads.src[i];
      if (!r.ref || roads.tier[i] > (z >= 0.25 ? TIER.MAJOR : TIER.TRUNK)) continue;
      const [P, a, e] = geo(i);
      shield(String(r.ref).split(';')[0].trim(), P, a, e);
      if (++work % 60 === 0) { yield; if (token !== lab.token) return; g.setTransform(dpr, 0, 0, dpr, 0, 0); }
    }
    yield; if (token !== lab.token) return;
    // 2. canaux et cours d'eau
    if (z >= 0.1 && ww.n) {
      query(ix.ww, ww, x0, z0, x1, z1, cand);
      for (const i of cand.slice()) {
        const name = ww.src[i].name;
        if (!name || (ww.kind[i] === 2 && z < 0.8)) continue;
        along(name, `italic 12.5px ${SERIF}`, pal.label.water, ww.pts, ww.off[i], ww.off[i + 1], 420, 0.6);
      }
      yield; if (token !== lab.token) return;
    }
    // 3. quartiers
    if (z >= 0.03 && z <= 0.75) {
      if (!districts) buildDistricts();
      for (const d of districts) flat(String(d.name).toUpperCase(), (d.x - x0) * z, (d.z - z0) * z, `600 10.5px ${COND}`, pal.label.district, null, 0);
      yield; if (token !== lab.token) return;
    }
    // 4. noms des voies, des plus importantes aux rues
    const passes = [[majors, TIER.MAJOR, 0.42], [null, TIER.COLLECTOR, 0.95], [null, TIER.PED, 1.6]];
    for (const [list0, maxTier, zMin] of passes) {
      if (z < zMin) break;
      let list = list0;
      if (!list) { query(maxTier === TIER.COLLECTOR ? ix.mid : ix.minor, roads, x0, z0, x1, z1, cand); list = cand.slice(); if (maxTier === TIER.PED) { query(ix.ped, roads, x0, z0, x1, z1, cand); list = list.concat(cand); } }
      for (const i of list) {
        const t = roads.tier[i], name = roads.src[i].name;
        if (!name || t === TIER.RAMP || t === TIER.PATH) continue;
        const [P, a, e] = geo(i);
        if (t <= TIER.MAJOR) along(name.toUpperCase(), `600 10px ${COND}`, t <= TIER.TRUNK ? pal.label.top : pal.label.major, P, a, e, 380, 1);
        else along(name, `500 10.5px ${SANS}`, pal.label.street, P, a, e, 300, 0.2);
        if (++work % 24 === 0) { yield; if (token !== lab.token) return; g.setTransform(dpr, 0, 0, dpr, 0, 0); }
      }
      yield; if (token !== lab.token) return;
    }
    // 5. parcs et forêts
    if (z >= 0.12) {
      query(z < 0.5 ? ix.polyBig : ix.polyAll, polys, x0, z0, x1, z1, cand);
      const pf = `italic ${Math.round(clamp(z * 26, 11, 14))}px ${SERIF}`;
      for (const i of cand.slice()) {
        const k = polys.k[i], name = polys.src[i].name;
        const green = k === AK.PARK || k === AK.FOREST || k === AK.CEMETERY;
        if (!name || (!green && k !== AK.INDUS && k !== AK.COMM) || polys.size[i] * z < (green ? 70 : 110)) continue;
        const q = i * 4;
        flat(name, ((polys.bb[q] + polys.bb[q + 2]) / 2 - x0) * z, ((polys.bb[q + 1] + polys.bb[q + 3]) / 2 - z0) * z, pf, green ? pal.label.park : pal.label.district, name, 300);
      }
    }
    perf.labels.n++; perf.labels.ms += performance.now() - t0;
    if (token !== lab.token) return;
    const f = lab.front; lab.front = lab.back; lab.back = f;
    lab.cx = cx; lab.cz = cz; lab.z = z; lab.ready = true; big.dirty = true;
  }

  // ---------- Dessin ----------
  const pick = (types) => (types.mission ? 'mission' : types.property ? 'property' : types.dealer ? 'dealer' : 'landmark');
  function drawBig() {
    const g = big.g; if (!g || !big.open) return;
    const t0 = performance.now();
    const dpr = big.dpr, z = big.zoom, zs = z * dpr, m = me();
    const x0 = big.cx - big.w / 2 / z, z0 = big.cz - big.h / 2 / z, x1 = x0 + big.w / z, z1 = z0 + big.h / z;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = pal.out; g.fillRect(0, 0, big.cv.width, big.cv.height);
    g.setTransform(zs, 0, 0, zs, -x0 * zs, -z0 * zs);
    tiles.draw(g, zs, x0, z0, x1, z1, big.cx, big.cz);
    big.seen = tiles.completed;
    const lp = livePath(m);
    if (lp) {
      g.lineJoin = 'round'; g.lineCap = 'round'; strokePath(g, m, lp);
      g.strokeStyle = pal.halo; g.lineWidth = 8 / z; g.stroke();
      g.strokeStyle = pal.route; g.lineWidth = 4 / z; g.stroke();
    }
    // calque des libellés (recalé sur la vue courante tant qu'il n'est pas recalculé)
    if (lab.ready) {
      const k = z / lab.z;
      if (k > 0.7 && k < 1.45) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        const lx = (lab.cx - big.w / 2 / lab.z - x0) * zs, ly = (lab.cz - big.h / 2 / lab.z - z0) * zs;
        g.globalAlpha = k === 1 ? 1 : 0.75;
        g.drawImage(lab.front, lx, ly, lab.front.width * k, lab.front.height * k);
        g.globalAlpha = 1;
      }
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const placed = [];
    const label = (t, x, y, col, font, force) => {
      g.font = font;
      const hw = g.measureText(t).width / 2 + 5, r = [x - hw, y - 9, x + hw, y + 9];
      if (!force) for (const q of placed) if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) return;
      placed.push(r);
      g.lineWidth = 3.5; g.strokeStyle = pal.halo; g.lineJoin = 'round'; g.strokeText(t, x, y); g.fillStyle = col; g.fillText(t, x, y);
    };
    // marqueurs : regroupés par cases de 38 px quand ils se chevauchent
    const CL = 38, cells = new Map(), list = [];
    for (let i = 0; i < markers.length; i++) {
      const mk = markers[i], sx = (mk.x - x0) * z, sy = (mk.z - z0) * z;
      if (sx < -40 || sy < -40 || sx > big.w + 40 || sy > big.h + 40) continue;
      if (mk === big.sel) { list.push({ mk, x: sx, y: sy, n: 1 }); continue; }
      const key = Math.floor(sx / CL) * 4096 + Math.floor(sy / CL);
      let c = cells.get(key);
      if (!c) { c = { mk, x: 0, y: 0, n: 0, types: {}, wx: 0, wz: 0 }; cells.set(key, c); list.push(c); }
      c.x += sx; c.y += sy; c.wx += mk.x; c.wz += mk.z; c.n++; c.types[mk.t] = 1;
    }
    for (const c of list) if (c.n > 1) { c.x /= c.n; c.y /= c.n; c.wx /= c.n; c.wz /= c.n; }
    big.clusters = list;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (c.n === 1) { glyph(g, c.mk, c.x, c.y, c.mk.t === 'landmark' ? 8 : 7.5); continue; }
      glyph(g, { t: 'cluster' }, c.x, c.y, 11);
      g.font = `700 11px ${SANS}`; g.fillStyle = pal.accent; g.fillText(String(c.n), c.x, c.y + 0.5);
    }
    const pm = playerMarkers();
    for (const mk of pm) { const [sx, sy] = w2s(mk.x, mk.z); glyph(g, mk, sx, sy, 7.5); label(mk.label, sx, sy - 16, pal.player, `600 12px ${SANS}`, true); }
    if (big.sel && big.sel.t === 'place') { const [sx, sy] = w2s(big.sel.x, big.sel.z); glyph(g, big.sel, sx, sy, 8); }
    for (const c of list) if (c.n === 1 && c.mk === big.sel) label(c.mk.label, c.x, c.y + 19, '#fff', `600 12px ${SANS}`, true);
    for (const c of list) if (c.n === 1 && c.mk.t === 'landmark' && c.mk !== big.sel) label(c.mk.label, c.x, c.y + 19, pal.accent, `600 12px ${SANS}`, false);
    if (z > 0.3) for (const c of list) if (c.n === 1 && c.mk.t !== 'landmark' && c.mk !== big.sel) label(c.mk.label, c.x, c.y + 18, pal.txt, `500 11.5px ${SANS}`, false);
    if (gps) { const [sx, sy] = w2s(gps.x, gps.z); glyph(g, { t: 'gps' }, sx, sy - 9, 11); }
    const [mx, my] = w2s(m.x, m.z);
    g.beginPath(); g.arc(mx, my, 17, 0, 6.3); g.fillStyle = 'rgba(255,255,255,.14)'; g.fill();
    arrow(g, mx, my, 10, -m.yaw);
    // échelle
    const bar = [50, 100, 200, 500, 1000, 2000, 5000].find((d) => d * z >= 70) || 5000;
    const bx = big.w - 28 - bar * z, by = big.h - 26;
    g.strokeStyle = pal.mute; g.lineWidth = 1.5; g.beginPath(); g.moveTo(bx, by - 5); g.lineTo(bx, by); g.lineTo(bx + bar * z, by); g.lineTo(bx + bar * z, by - 5); g.stroke();
    g.font = `500 11px ${SANS}`; g.fillStyle = pal.mute; g.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, bx + bar * z / 2, by - 11);
    big.dirty = false;
    tick(perf.big, t0);
  }

  function showInfo(mk) {
    big.info.replaceChildren();
    if (!mk && !gps) { big.info.classList.remove('is-on'); return; }
    const title = mk?.label || gps?.label || 'Destination';
    const d = Math.hypot((mk?.x ?? gps.x) - me().x, (mk?.z ?? gps.z) - me().z);
    const actions = [];
    if (mk?.t === 'property') actions.push(h('button', { class: 'mz-btn mz-btn--sm', type: 'button', text: 'Voir la fiche', onclick: () => api.open?.('property', { id: mk.id }) }));
    if (mk?.t === 'dealer') actions.push(h('button', { class: 'mz-btn mz-btn--sm', type: 'button', text: 'Catalogue', onclick: () => api.open?.('dealer', { brand: mk.brand }) }));
    if (mk?.t === 'mission' && ctx.gameplay?.startMission) actions.push(h('button', { class: 'mz-btn mz-btn--sm mz-btn--gold', type: 'button', text: 'Démarrer', onclick: () => { ctx.gameplay.startMission(mk.id); api.close?.(); } }));
    actions.push(h('button', { class: 'mz-btn mz-btn--sm mz-btn--ghost', type: 'button', text: 'Effacer l’itinéraire', onclick: () => { big.sel = null; bus.emit('gps:clear', {}); showInfo(null); } }));
    big.info.append(
      h('div', { class: 'mz-map-info-txt' }, h('span', { class: 'mz-eyebrow', text: mk?.sub || 'Itinéraire' }), h('strong', { text: title }), h('span', { class: 'mz-dim', text: `à ${fmtDist(d)}` })),
      h('div', { class: 'mz-row' }, actions));
    big.info.classList.add('is-on');
  }
  function clickAt(sx, sy) {
    // un groupe de marqueurs : on zoome dessus
    let cl = null, cd = 15 * 15;
    for (const c of big.clusters) if (c.n > 1) { const d = (c.x - sx) ** 2 + (c.y - sy) ** 2; if (d < cd) { cd = d; cl = c; } }
    if (cl) { big.cx = cl.wx; big.cz = cl.wz; big.zoom = clamp(big.zoom * 2.6, big.minZoom, ZMAX); clampView(); view(); return; }
    let best = null, bd = 18 * 18;
    for (const c of big.clusters) if (c.n === 1) { const d = (c.x - sx) ** 2 + (c.y - sy) ** 2; if (d < bd) { bd = d; best = c.mk; } }
    for (const mk of playerMarkers()) { const [x, y] = w2s(mk.x, mk.z); const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = mk; } }
    big.sel = best;
    let [x, z] = s2w(sx, sy); let label;
    if (best) { x = best.x; z = best.z; label = best.label; } else label = roadNameAt(x, z, 40) || 'Point sur la carte';
    if (x < data.bounds.minX || x > data.bounds.maxX || z < data.bounds.minZ || z > data.bounds.maxZ) { bus.emit('toast', { text: `Ce point est hors de ${cityName}.`, kind: 'info' }); return; }
    setGps(x, z, label);
    showInfo(best);
    big.dirty = true;
  }

  // ---------- Recherche d'un lieu ----------
  let places = null;
  function buildPlaces() {
    const out = [], seen = new Set();
    const add = (label, sub, x, z, rank, extra) => {
      if (!label || !isFinite(x) || !isFinite(z)) return;
      const n = norm(label), key = sub + '|' + n;
      if (!n || seen.has(key)) return;
      seen.add(key);
      out.push({ label, sub, n, x, z, rank, ...extra });
    };
    for (const l of ctx.LANDMARKS || []) if (!l.hidden) add(l.name, 'Monument', l.x, l.z, 0, { zoom: 0.9 });
    for (const p of wd.pois?.pois || []) {
      if (!p || !p.name) continue;
      if (PLACE_KIND[p.kind]) add(p.name, PLACE_KIND[p.kind][0], p.x, p.z, PLACE_KIND[p.kind][1], { zoom: 1 });
    }
    if (!districts) buildDistricts();
    for (const d of districts) add(d.name, 'Quartier', d.x, d.z, 1, { zoom: 0.3 });
    for (const d of zones) add(d.name, 'Zone d’activité', d.x, d.z, 4, { zoom: 0.5 });
    for (const mk of markers) if (mk.t === 'dealer' || mk.t === 'property') add(mk.label, mk.t === 'dealer' ? 'Concession' : 'Bien immobilier', mk.x, mk.z, 3, { zoom: 1 });
    const { polys, roads } = data;
    for (let i = 0; i < polys.n; i++) {
      const k = polys.k[i], name = polys.src[i].name;
      if (name && polys.size[i] >= 40 && (k === AK.PARK || k === AK.FOREST)) add(name, k === AK.PARK ? 'Parc' : 'Forêt', (polys.bb[i * 4] + polys.bb[i * 4 + 2]) / 2, (polys.bb[i * 4 + 1] + polys.bb[i * 4 + 3]) / 2, 5, { zoom: 0.7 });
    }
    for (let i = 0; i < roads.count; i++) {
      const name = roads.src[i].name;
      if (!name || roads.tier[i] === TIER.RAMP) continue;
      const mid = (roads.off[i] + roads.off[i + 1]) >> 1;
      add(name, roads.tier[i] <= TIER.MAJOR ? 'Grand axe' : 'Rue', roads.pts[mid * 2], roads.pts[mid * 2 + 1], roads.tier[i] <= TIER.MAJOR ? 6 : 7, { zoom: 1.4 });
    }
    places = out;
  }
  function search(q) {
    const n = norm(q);
    if (n.length < 2) return [];
    if (!places) buildPlaces();
    const toks = n.split(' '), res = [];
    for (const p of places) {
      let ok = true;
      for (const t of toks) if (!p.n.includes(t)) { ok = false; break; }
      if (!ok) continue;
      const sc = (p.n.startsWith(n) ? 0 : (' ' + p.n).includes(' ' + n) ? 2 : 8) + p.rank + p.n.length * 0.01;
      res.push([sc, p]);
    }
    res.sort((a, b) => a[0] - b[0]);
    return res.slice(0, 8).map((r) => r[1]);
  }
  function goTo(p) {
    searchRes.hidden = true; searchIn.value = p.label; searchIn.blur();
    big.cx = p.x; big.cz = p.z; big.zoom = clamp(Math.max(big.zoom, p.zoom || 1), big.minZoom, ZMAX); clampView();
    big.sel = { t: 'place', x: p.x, z: p.z, label: p.label, sub: p.sub };
    setGps(p.x, p.z, p.label); showInfo(big.sel); view();
  }
  let found = [];
  searchIn.addEventListener('input', () => {
    found = search(searchIn.value);
    searchRes.replaceChildren(...(found.length ? found.map((p) => h('button', { class: 'mz-map-result', type: 'button', onclick: () => goTo(p) }, h('b', { text: p.label }), h('span', { text: p.sub })))
      : norm(searchIn.value).length >= 2 ? [h('div', { class: 'mz-map-noresult', text: `Aucun lieu trouvé à ${cityName}.` })] : []));
    searchRes.hidden = !searchRes.childElementCount;
  });
  searchIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && found[0]) { e.preventDefault(); goTo(found[0]); } });
  searchIn.addEventListener('focus', () => { if (searchRes.childElementCount) searchRes.hidden = false; });

  // ---------- Interactions (souris + tactile avec pincement) ----------
  const ptrs = new Map(); let moved = 0, pinch = 0;
  big.cv.addEventListener('pointerdown', (e) => { searchRes.hidden = true; if (document.activeElement === searchIn) searchIn.blur(); big.cv.setPointerCapture?.(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 1) moved = 0; pinch = 0; });
  big.cv.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    if (ptrs.size === 1) { moved += Math.abs(dx) + Math.abs(dy); big.cx -= dx / big.zoom; big.cz -= dy / big.zoom; }
    p[0] = e.clientX; p[1] = e.clientY;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) big.zoom = clamp(big.zoom * d / pinch, big.minZoom, ZMAX);
      pinch = d; moved = 99;
    }
    clampView(); view();
  });
  const up = (e) => { if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); pinch = 0; if (e.type === 'pointerup' && ptrs.size === 0 && moved < 6 && e.button === 0) clickAt(e.clientX, e.clientY); };
  big.cv.addEventListener('pointerup', up); big.cv.addEventListener('pointercancel', up);
  big.cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [wx, wz] = s2w(e.clientX, e.clientY);
    big.zoom = clamp(big.zoom * Math.exp(-e.deltaY * 0.0016), big.minZoom, ZMAX);
    big.cx = wx - (e.clientX - big.w / 2) / big.zoom; big.cz = wz - (e.clientY - big.h / 2) / big.zoom;
    clampView(); view();
  }, { passive: false });
  big.cv.addEventListener('contextmenu', (e) => { e.preventDefault(); big.sel = null; bus.emit('gps:clear', {}); showInfo(null); });

  function openBig() {
    refreshMarkers();
    big.open = true; big.el.hidden = false; sizeBig();
    const m = me(); big.cx = m.x; big.cz = m.z; big.zoom = clamp(0.5, big.minZoom, ZMAX); clampView();
    big.sel = null; searchIn.value = ''; searchRes.hidden = true; searchRes.replaceChildren();
    lab.ready = false; showInfo(null); view(); drawBig();
  }
  function closeBig() { big.open = false; big.el.hidden = true; lab.token++; if (lab.job) { tiles.cancelJob(lab.job); lab.job = null; } }

  // ---------- Boucle ----------
  let tMini = 0, tSlow = 0, tBig = 0;
  sizeMini(); refreshMarkers();
  const onResize = () => { sizeMini(); if (big.open) { sizeBig(); view(); } };
  bus.on('resize', onResize);
  window.addEventListener('resize', onResize);
  const miniStep = low ? 1 / 15 : 1 / 30;

  function update(dt, visible) {
    const f0 = performance.now();
    tiles.beginFrame();
    tSlow += dt;
    if (tSlow > 1) {
      tSlow = 0; refreshMarkers();
      if (gps) {
        const m = me(), d = Math.hypot(gps.x - m.x, gps.z - m.z);
        if (gps.mine && d < 22) { const l = gps.label; bus.emit('gps:clear', {}); bus.emit('toast', { text: `Vous êtes arrivé : ${l || 'destination'}`, kind: 'success' }); }
        else if (gps.own && Math.hypot(m.x - gps.cx, m.z - gps.cz) > 45) { gps.path = route(m.x, m.z, gps.x, gps.z); gps.cx = m.x; gps.cz = m.z; gps.hint = 0; }
      }
    }
    let drew = false;
    if (big.open) {
      tBig += dt;
      if (big.dirty || tiles.completed !== big.seen || tBig > 0.25) { tBig = 0; drawBig(); drew = true; }
      // libellés : recalculés quand la vue ne bouge plus depuis 180 ms
      if (lab.stale && !lab.job && ptrs.size === 0 && performance.now() - big.moveT > 180 && tiles.pending < 6) {
        lab.stale = false;
        const token = ++lab.token;
        lab.job = tiles.addJob(buildLabels(token), () => { lab.job = null; });
      } else if (lab.stale && lab.job) { lab.token++; tiles.cancelJob(lab.job); lab.job = null; }
    } else if (visible) {
      tMini += dt;
      if (tMini >= miniStep) { tMini = 0; drawMini(); drew = true; }
    }
    // génération des tuiles : budget de temps par image (le dessin de la carte est déjà compté)
    tiles.pump(drew ? 3 : 4);
    tick(perf.frame, f0);
  }

  return {
    miniEl: mini.el, bigEl: big.el, update, openBig, closeBig, resizeMini: sizeMini,
    roadNameAt, roadAt, setGps, getGps: () => gps, me, sources, sourceDetails,
    gpsDistance: () => { if (!gps) return null; const m = me(); return Math.hypot(gps.x - m.x, gps.z - m.z); },
    missionList, propertyList, dealerList, search,
    /** Vue de la grande carte (tests, captures) : setView({x, z, zoom}). */
    setView(v) { if (v.x != null) big.cx = v.x; if (v.z != null) big.cz = v.z; if (v.zoom != null) big.zoom = clamp(v.zoom === 'fit' ? big.minZoom : v.zoom, big.minZoom, ZMAX); clampView(); view(); },
    stats() {
      const avg = (o) => (o.n ? +(o.ms / o.n).toFixed(3) : 0), r = (v) => +v.toFixed(2);
      const t = tiles.stats;
      return {
        prep: data.stats,
        tiles: { rendered: t.tiles, avgMs: t.tiles ? r(t.tileMs / t.tiles) : 0, maxTileMs: r(t.maxTileMs), steps: t.steps, maxStepMs: r(t.maxStepMs), avgPumpMs: t.pumps ? r(t.pumpMs / t.pumps) : 0, maxPumpMs: r(t.maxPumpMs), cached: t.cached, dropped: t.dropped, pending: tiles.pending },
        mini: { draws: perf.mini.n, avgMs: avg(perf.mini), maxMs: r(perf.mini.max), zoom: r(mini.zoom), level: tiles.levelFor(mini.zoom * mini.dpr, MINI_SHARP) },
        big: { draws: perf.big.n, avgMs: avg(perf.big), maxMs: r(perf.big.max), zoom: r(big.zoom), level: tiles.levelFor(big.zoom * big.dpr) },
        labels: { builds: perf.labels.n, avgMs: avg(perf.labels) },
        frame: { n: perf.frame.n, avgMs: avg(perf.frame), maxMs: r(perf.frame.max) },
      };
    },
    resetStats() { tiles.resetStats(); for (const o of Object.values(perf)) { o.n = 0; o.ms = 0; o.max = 0; } },
  };
}

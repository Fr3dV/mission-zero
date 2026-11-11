// Minicarte + grande carte + itinéraire GPS — module interface.
// Le fond (routes, Seine, parcs) est pré-rendu une fois dans un canvas hors écran ;
// la minicarte n'en recopie qu'une fenêtre tournée (≤ 30 Hz).
import { h, icon, clamp, fmtDist, zc } from './util.js';
import { MISSIONS } from '@shared/missions.js';
import { PROPERTIES } from '@shared/properties.js';

const COL = {
  bg: '#0c101b', block: '#111625', park: '#14291f', parkEdge: '#1f4030', river: '#143049', riverEdge: '#1f4a6e',
  plaza: '#1b2134', street: '#363f5c', quay: '#46507199', ped: '#2c3450', major: '#b8975c', majorCase: '#0c101b',
  gold: '#f0c170', rouge: '#ef5a5a', vert: '#5fd39a', ciel: '#6fd0ff', txt: '#eef0f6', mute: '#9aa3b8',
};
const MAJOR = { avenue: 1, boulevard: 1 };

export function createMaps(ctx, api) {
  const { bus, store } = ctx;
  const wd = ctx.worldData || {};
  const roads = Array.isArray(wd.roads) ? wd.roads.filter((r) => r && Array.isArray(r.points) && r.points.length > 1) : [];
  const B0 = ctx.BOUNDS || { minX: -3000, maxX: 3000, minZ: -2700, maxZ: 2700 };
  const B = { minX: B0.minX - 200, maxX: B0.maxX + 200, minZ: B0.minZ - 200, maxZ: B0.maxZ + 200 };
  const BW = B.maxX - B.minX, BH = B.maxZ - B.minZ;

  // Boîtes englobantes des routes (culling + recherche du nom de rue).
  const rb = new Float32Array(roads.length * 4);
  roads.forEach((r, i) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const p of r.points) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; }
    rb.set([a, b, c, d], i * 4);
  });

  function poly(g, pts) {
    if (!pts || pts.length < 3) return;
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }
  /** Dessine le monde dans g. s = px/m ; (x0,z0) = coin haut-gauche monde ; w,h = taille px. */
  function paintWorld(g, s, x0, z0, w, hgt) {
    g.save();
    g.setTransform(s, 0, 0, s, -x0 * s, -z0 * s);
    const vx1 = x0 + w / s, vz1 = z0 + hgt / s, px = 1 / s;
    g.fillStyle = COL.bg; g.fillRect(x0, z0, w / s, hgt / s);
    g.fillStyle = COL.block; g.fillRect(B0.minX, B0.minZ, B0.maxX - B0.minX, B0.maxZ - B0.minZ);
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); for (const p of wd.plazas || []) poly(g, p.polygon); g.fillStyle = COL.plaza; g.fill();
    g.beginPath(); for (const p of wd.parks || []) poly(g, p.polygon);
    g.fillStyle = COL.park; g.fill(); g.strokeStyle = COL.parkEdge; g.lineWidth = Math.max(2, 1 * px); g.stroke();
    g.beginPath(); for (const p of wd.river?.polygons || []) poly(g, p);
    g.fillStyle = COL.river; g.fill('evenodd'); g.strokeStyle = COL.riverEdge; g.lineWidth = Math.max(3, 1 * px); g.stroke();
    // Routes regroupées par (catégorie, largeur) pour limiter les stroke().
    const buckets = new Map();
    for (let i = 0; i < roads.length; i++) {
      const o = i * 4;
      if (rb[o] > vx1 || rb[o + 2] < x0 || rb[o + 1] > vz1 || rb[o + 3] < z0) continue;
      const r = roads[i];
      const cat = MAJOR[r.kind] ? 2 : r.kind === 'pedestrian' ? 0 : 1;
      const wq = Math.max(4, Math.round((r.width || 10) / 4) * 4);
      const key = cat * 1000 + wq + (r.kind === 'quay' ? 500 : 0);
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { cat, w: wq, quay: r.kind === 'quay', list: [] }));
      b.list.push(r.points);
    }
    const order = [...buckets.values()].sort((a, b) => a.cat - b.cat || a.w - b.w);
    const trace = (b) => { g.beginPath(); for (const pts of b.list) { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); } };
    for (const b of order) {
      if (b.cat === 2) continue;
      trace(b);
      g.strokeStyle = b.cat === 0 ? COL.ped : b.quay ? '#465071' : COL.street;
      g.lineWidth = Math.max(b.w * (b.cat === 0 ? 0.5 : 0.8), 1.1 * px); g.stroke();
    }
    for (const b of order) { if (b.cat !== 2) continue; trace(b); g.strokeStyle = COL.majorCase; g.lineWidth = Math.max(b.w * 0.8, 2 * px) + 2.5 * px; g.stroke(); }
    for (const b of order) { if (b.cat !== 2) continue; trace(b); g.strokeStyle = COL.major; g.lineWidth = Math.max(b.w * 0.8, 2 * px); g.stroke(); }
    g.restore();
  }

  // ---------- Fond pré-rendu ----------
  let S = ctx.quality === 'low' ? 0.3 : 0.5;
  S = Math.min(S, 3000 / BW, 3000 / BH);
  const base = document.createElement('canvas');
  base.width = Math.ceil(BW * S); base.height = Math.ceil(BH * S);
  try { paintWorld(base.getContext('2d'), S, B.minX, B.minZ, base.width, base.height); } catch (e) { console.warn('[ui] fond de carte', e); }

  // ---------- Nom de la rue la plus proche ----------
  function roadNameAt(x, z, maxD = 28) {
    let best = null, bd = maxD * maxD;
    for (let i = 0; i < roads.length; i++) {
      const o = i * 4;
      if (x < rb[o] - maxD || x > rb[o + 2] + maxD || z < rb[o + 1] - maxD || z > rb[o + 3] + maxD) continue;
      const r = roads[i]; if (!r.name) continue;
      const pts = r.points;
      for (let k = 0; k < pts.length - 1; k++) {
        const ax = pts[k][0], az = pts[k][1], dx = pts[k + 1][0] - ax, dz = pts[k + 1][1] - az;
        const l2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
        const ex = ax + dx * t - x, ez = az + dz * t - z, d = ex * ex + ez * ez;
        if (d < bd) { bd = d; best = r.name; }
      }
    }
    return best;
  }

  // ---------- Itinéraire (A* sur worldData.graph) ----------
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
    if (!nodes.length) return [[x0, z0], [x1, z1]];
    if (!adj) buildAdj();
    const s = nearestNode(x0, z0), t = nearestNode(x1, z1);
    if (s < 0 || t < 0) return [[x0, z0], [x1, z1]];
    const n = nodes.length, gs = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const heap = []; // tas binaire [f, noeud]
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
    gps = { x: p.x, z: p.z, label: p.label || 'Destination', path: has ? p.path : route(m.x, m.z, p.x, p.z), own: !has, mine: nextGpsMine, cx: m.x, cz: m.z };
    api.onGps?.(gps);
    if (big.open) big.draw();
  });
  bus.on('gps:clear', () => { gps = null; api.onGps?.(null); if (big.open) big.draw(); });
  function setGps(x, z, label) { nextGpsMine = true; bus.emit('gps:set', { x, z, label }); nextGpsMine = false; }

  /** Tracé à afficher : coupe la partie déjà parcourue et repart de la position du joueur. */
  function livePath(m) {
    if (!gps?.path) return null;
    const p = gps.path; let bi = 0, bd = Infinity;
    for (let i = 0; i < p.length; i++) { const d = (p[i][0] - m.x) ** 2 + (p[i][1] - m.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    if (bi < p.length - 1) {
      // si le joueur a dépassé le sommet le plus proche, on saute au suivant
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
    for (const l of ctx.LANDMARKS || []) if (!l.hidden) out.push({ t: 'landmark', x: l.x, z: l.z, label: l.name });
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
    players.forEach((p, id) => { if (p && (p.id ?? id) !== store.me?.id && isFinite(p.x) && isFinite(p.z)) out.push({ t: 'player', x: p.x, z: p.z, label: p.name || 'Joueur', id: p.id ?? id }); });
    return out;
  }

  /** Pictogramme d'un marqueur, centré en (x,y), taille r (px). */
  function glyph(g, m, x, y, r) {
    g.lineWidth = 1.5;
    if (m.t === 'landmark') {
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.78, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.78, y); g.closePath();
      g.fillStyle = COL.bg; g.fill(); g.strokeStyle = COL.gold; g.stroke();
      g.beginPath(); g.arc(x, y, r * 0.22, 0, 6.3); g.fillStyle = COL.gold; g.fill();
    } else if (m.t === 'property') {
      const c = m.st === 'mine' ? COL.vert : m.st === 'taken' ? '#8b93a8' : COL.txt;
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y - r * 0.1); g.lineTo(x + r * 0.7, y - r * 0.1); g.lineTo(x + r * 0.7, y + r * 0.85); g.lineTo(x - r * 0.7, y + r * 0.85); g.lineTo(x - r * 0.7, y - r * 0.1); g.lineTo(x - r, y - r * 0.1); g.closePath();
      g.fillStyle = m.st === 'free' ? COL.bg : c; g.fill(); g.strokeStyle = c; g.stroke();
    } else if (m.t === 'mission') {
      g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fillStyle = COL.gold; g.fill(); g.strokeStyle = COL.bg; g.stroke();
      g.fillStyle = COL.bg; g.fillRect(x - r * 0.14, y - r * 0.58, r * 0.28, r * 0.72);
      g.beginPath(); g.arc(x, y + r * 0.48, r * 0.17, 0, 6.3); g.fill();
    } else if (m.t === 'dealer') {
      const q = r * 0.9;
      g.beginPath(); g.rect(x - q, y - q, q * 2, q * 2); g.fillStyle = '#7aa8ff'; g.fill(); g.strokeStyle = COL.bg; g.stroke();
      g.fillStyle = COL.bg; g.fillRect(x - q * 0.62, y - q * 0.1, q * 1.24, q * 0.42); g.fillRect(x - q * 0.36, y - q * 0.5, q * 0.72, q * 0.44);
    } else if (m.t === 'player') {
      g.beginPath(); g.arc(x, y, r * 0.72, 0, 6.3); g.fillStyle = COL.ciel; g.fill(); g.strokeStyle = COL.bg; g.lineWidth = 2; g.stroke();
    } else if (m.t === 'gps') {
      g.beginPath(); g.arc(x, y - r * 0.5, r * 0.8, Math.PI * 0.85, Math.PI * 2.15); g.lineTo(x, y + r); g.closePath();
      g.fillStyle = COL.rouge; g.fill(); g.strokeStyle = '#fff'; g.stroke();
      g.beginPath(); g.arc(x, y - r * 0.5, r * 0.28, 0, 6.3); g.fillStyle = '#fff'; g.fill();
    }
  }
  function arrow(g, x, y, r, rot) {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.72, r * 0.8); g.lineTo(0, r * 0.42); g.lineTo(-r * 0.72, r * 0.8); g.closePath();
    g.fillStyle = '#fff'; g.strokeStyle = COL.bg; g.lineWidth = 2; g.stroke(); g.fill();
    g.restore();
  }

  // ---------- Minicarte ----------
  const mini = { el: null, cv: null, g: null, size: 0, dpr: 1, zoom: 0.62 };
  mini.cv = h('canvas', { class: 'mz-mini-cv' });
  mini.north = h('span', { class: 'mz-mini-n', text: 'N' });
  mini.el = h('div', { class: 'mz-mini', title: 'Carte (M)', onclick: () => api.openMap?.() }, mini.cv, mini.north);
  function sizeMini() {
    const css = api.isCompact() ? 104 : 184;
    mini.dpr = Math.min(window.devicePixelRatio || 1, 2);
    mini.size = css;
    mini.cv.width = mini.cv.height = Math.round(css * mini.dpr);
    mini.g = mini.cv.getContext('2d');
  }
  function drawMini() {
    const g = mini.g; if (!g) return;
    const m = me(), D = mini.cv.width, R = D / 2, dpr = mini.dpr;
    const spd = Math.abs((ctx.player?.mode === 'vehicle' ? ctx.player?.vehicle?.speed : ctx.player?.speed) || 0);
    const target = clamp(0.66 - spd * 0.011, 0.26, 0.66) * (mini.size / 184 * 0.25 + 0.75);
    mini.zoom += (target - mini.zoom) * 0.08;
    const k = mini.zoom * dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = COL.bg; g.fillRect(0, 0, D, D);
    g.translate(R, R); g.rotate(m.yaw); g.scale(k, k); g.translate(-m.x, -m.z);
    const half = (R / k) * 1.45;
    const sx = clamp((m.x - half - B.minX) * S, 0, base.width), sy = clamp((m.z - half - B.minZ) * S, 0, base.height);
    const ex = clamp((m.x + half - B.minX) * S, 0, base.width), ey = clamp((m.z + half - B.minZ) * S, 0, base.height);
    if (ex - sx > 1 && ey - sy > 1) g.drawImage(base, sx, sy, ex - sx, ey - sy, sx / S + B.minX, sy / S + B.minZ, (ex - sx) / S, (ey - sy) / S);
    const lp = livePath(m);
    if (lp) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      strokePath(g, m, lp); g.strokeStyle = 'rgba(12,16,27,.85)'; g.lineWidth = 7.5 * dpr / k; g.stroke();
      g.strokeStyle = COL.rouge; g.lineWidth = 4 * dpr / k; g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const c = Math.cos(m.yaw), s = Math.sin(m.yaw), rMax = R - 9 * dpr;
    const put = (mk, edge, r) => {
      const dx = (mk.x - m.x) * k, dz = (mk.z - m.z) * k;
      let x = dx * c - dz * s, y = dx * s + dz * c;
      const d = Math.hypot(x, y);
      if (d > rMax) { if (!edge) return; x *= rMax / d; y *= rMax / d; }
      glyph(g, mk, R + x, R + y, r * dpr);
    };
    for (const mk of markers) put(mk, false, mk.t === 'landmark' ? 6 : 5.5);
    for (const mk of playerMarkers()) put(mk, true, 5.5);
    if (gps) put({ t: 'gps', x: gps.x, z: gps.z }, true, 7.5);
    arrow(g, R, R, 8.5 * dpr, 0);
    // « N » sur l'anneau (transform CSS : pas de reflow)
    const nr = mini.size / 2 - 1;
    mini.north.style.transform = `translate(${(s * nr).toFixed(1)}px, ${(-c * nr).toFixed(1)}px)`;
  }

  // ---------- Grande carte ----------
  const big = { open: false, cx: 0, cz: 0, zoom: 0.5, el: null, cv: null, g: null, w: 0, h: 0, dpr: 1, sharpT: 0, sel: null };
  big.cv = h('canvas', { class: 'mz-map-cv' });
  big.info = h('div', { class: 'mz-map-info' });
  const zoomBy = (f) => { big.zoom = clamp(big.zoom * f, big.minZoom || 0.1, 2.6); clampView(); big.draw(); };
  big.el = h('div', { class: 'mz-map', hidden: true },
    big.cv,
    h('div', { class: 'mz-map-head' },
      h('div', { class: 'mz-map-title' }, h('span', { class: 'mz-eyebrow', text: 'Plan de Paris' }), h('strong', { text: 'Carte' })),
      h('div', { class: 'mz-map-hint', text: 'Cliquez pour tracer un itinéraire · molette pour zoomer · glissez pour déplacer' }),
      h('button', { class: 'mz-iconbtn', type: 'button', title: 'Fermer (M)', onclick: () => api.close?.() }, icon('close'))),
    h('div', { class: 'mz-map-tools' },
      h('button', { class: 'mz-iconbtn', type: 'button', title: 'Zoom avant', onclick: () => zoomBy(1.4) }, icon('plus')),
      h('button', { class: 'mz-iconbtn', type: 'button', title: 'Zoom arrière', onclick: () => zoomBy(1 / 1.4) }, icon('minus')),
      h('button', { class: 'mz-iconbtn', type: 'button', title: 'Recentrer sur moi', onclick: () => { const m = me(); big.cx = m.x; big.cz = m.z; clampView(); big.draw(); } }, icon('locate'))),
    h('div', { class: 'mz-map-legend' }, [
      ['me', 'Vous'], ['player', 'Joueurs'], ['landmark', 'Monuments'], ['mission', 'Missions'],
      ['free', 'Bien à vendre'], ['mine', 'Votre bien'], ['dealer', 'Concessions'], ['gps', 'Destination'],
    ].map(([k, t]) => h('div', { class: 'mz-leg' }, h('canvas', { width: 36, height: 36, dataset: { k } }), t))),
    big.info);
  // pictos de la légende
  big.el.querySelectorAll('.mz-leg canvas').forEach((c) => {
    const g = c.getContext('2d'), k = c.dataset.k;
    if (k === 'me') arrow(g, 18, 18, 12, 0);
    else if (k === 'free' || k === 'mine') glyph(g, { t: 'property', st: k }, 18, 18, 11);
    else glyph(g, { t: k }, 18, k === 'gps' ? 20 : 18, k === 'gps' ? 12 : 11);
  });

  function sizeBig() {
    big.dpr = Math.min(window.devicePixelRatio || 1, 2);
    big.w = window.innerWidth; big.h = window.innerHeight;
    big.cv.width = Math.round(big.w * big.dpr); big.cv.height = Math.round(big.h * big.dpr);
    big.g = big.cv.getContext('2d');
    big.minZoom = Math.min(big.w / BW, big.h / BH) * 0.9;
  }
  function clampView() { big.cx = clamp(big.cx, B.minX, B.maxX); big.cz = clamp(big.cz, B.minZ, B.maxZ); }
  const w2s = (x, z) => [(x - big.cx) * big.zoom + big.w / 2, (z - big.cz) * big.zoom + big.h / 2];
  const s2w = (sx, sy) => [(sx - big.w / 2) / big.zoom + big.cx, (sy - big.h / 2) / big.zoom + big.cz];

  big.draw = (sharp = false) => {
    const g = big.g; if (!g || !big.open) return;
    const dpr = big.dpr, z = big.zoom, m = me();
    const x0 = big.cx - big.w / 2 / z, z0 = big.cz - big.h / 2 / z;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (sharp || z <= S * 1.15) {
      if (z > S * 1.15) paintWorld(g, z * dpr, x0, z0, big.cv.width, big.cv.height);
      else { g.fillStyle = COL.bg; g.fillRect(0, 0, big.cv.width, big.cv.height); g.imageSmoothingQuality = 'high'; g.drawImage(base, (B.minX - x0) * z * dpr, (B.minZ - z0) * z * dpr, BW * z * dpr, BH * z * dpr); }
    } else {
      g.fillStyle = COL.bg; g.fillRect(0, 0, big.cv.width, big.cv.height);
      g.drawImage(base, (B.minX - x0) * z * dpr, (B.minZ - z0) * z * dpr, BW * z * dpr, BH * z * dpr);
      clearTimeout(big.sharpT); big.sharpT = setTimeout(() => big.draw(true), 160);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // itinéraire
    const lp = livePath(m);
    if (lp) {
      g.save(); g.setTransform(z * dpr, 0, 0, z * dpr, -x0 * z * dpr, -z0 * z * dpr);
      g.lineJoin = 'round'; g.lineCap = 'round'; strokePath(g, m, lp);
      g.strokeStyle = 'rgba(12,16,27,.9)'; g.lineWidth = 8 / z; g.stroke();
      g.strokeStyle = COL.rouge; g.lineWidth = 4 / z; g.stroke(); g.restore();
    }
    // libellés : priorité joueurs > monuments > sélection > reste > parcs, sans chevauchement
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const placed = [];
    const SANS = '"Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif';
    const label = (t, x, y, col, font, force) => {
      g.font = font;
      const hw = g.measureText(t).width / 2 + 5, r = [x - hw, y - 9, x + hw, y + 9];
      if (!force) for (const q of placed) if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) return;
      placed.push(r);
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(8,11,20,.92)'; g.lineJoin = 'round'; g.strokeText(t, x, y); g.fillStyle = col; g.fillText(t, x, y);
    };
    const all = playerMarkers().concat(markers);
    const vis = [];
    for (const mk of all) {
      const [sx, sy] = w2s(mk.x, mk.z);
      if (sx < -40 || sy < -40 || sx > big.w + 40 || sy > big.h + 40) continue;
      vis.push([mk, sx, sy]);
    }
    for (let i = vis.length - 1; i >= 0; i--) { const [mk, sx, sy] = vis[i]; glyph(g, mk, sx, sy, mk.t === 'landmark' ? 8 : 7.5); }
    for (const [mk, sx, sy] of vis) if (mk.t === 'player') label(mk.label, sx, sy - 16, COL.ciel, `600 12px ${SANS}`, true);
    for (const [mk, sx, sy] of vis) if (mk.t === 'landmark') label(mk.label, sx, sy + 19, COL.gold, `600 12px ${SANS}`, false);
    for (const [mk, sx, sy] of vis) if (mk === big.sel && mk.t !== 'player' && mk.t !== 'landmark') label(mk.label, sx, sy + 18, '#fff', `600 12px ${SANS}`, true);
    if (z > 0.3) for (const [mk, sx, sy] of vis) if (mk.t !== 'player' && mk.t !== 'landmark' && mk !== big.sel) label(mk.label, sx, sy + 18, COL.txt, `500 11.5px ${SANS}`, false);
    if (z > 0.2) {
      const pf = `italic ${Math.round(clamp(z * 26, 11, 15))}px Didot, "Bodoni 72", Georgia, serif`;
      for (const p of wd.parks || []) {
        if (!p.name || !p.polygon?.length) continue;
        let a = Infinity, b2 = Infinity, c = -Infinity, d = -Infinity;
        for (const q of p.polygon) { if (q[0] < a) a = q[0]; if (q[0] > c) c = q[0]; if (q[1] < b2) b2 = q[1]; if (q[1] > d) d = q[1]; }
        if ((c - a) * z < 90) continue;
        const [sx, sy] = w2s((a + c) / 2, (b2 + d) / 2);
        if (sx < 0 || sy < 0 || sx > big.w || sy > big.h) continue;
        label(p.name, sx, sy, 'rgba(130,190,160,.8)', pf, false);
      }
    }
    if (gps) { const [sx, sy] = w2s(gps.x, gps.z); glyph(g, { t: 'gps' }, sx, sy - 9, 11); }
    const [mx, my] = w2s(m.x, m.z);
    g.beginPath(); g.arc(mx, my, 17, 0, 6.3); g.fillStyle = 'rgba(240,193,112,.16)'; g.fill();
    arrow(g, mx, my, 10, m.yaw === 0 ? 0 : -m.yaw);
    // rose des vents discrète + échelle
    const bar = [50, 100, 200, 500, 1000, 2000].find((d) => d * z >= 70) || 2000;
    const bx = big.w - 28 - bar * z, by = big.h - 26;
    g.strokeStyle = COL.mute; g.lineWidth = 1.5; g.beginPath(); g.moveTo(bx, by - 5); g.lineTo(bx, by); g.lineTo(bx + bar * z, by); g.lineTo(bx + bar * z, by - 5); g.stroke();
    g.font = '500 11px "Avenir Next", Avenir, system-ui, sans-serif'; g.fillStyle = COL.mute; g.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, bx + bar * z / 2, by - 11);
  };

  function showInfo(mk, x, z) {
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
    void x; void z;
  }
  function clickAt(sx, sy) {
    let best = null, bd = 18 * 18;
    for (const mk of markers.concat(playerMarkers())) { const [x, y] = w2s(mk.x, mk.z); const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = mk; } }
    big.sel = best;
    let [x, z] = s2w(sx, sy); let label;
    if (best) { x = best.x; z = best.z; label = best.label; } else label = roadNameAt(x, z, 40) || 'Point sur la carte';
    if (x < B.minX || x > B.maxX || z < B.minZ || z > B.maxZ) return;
    setGps(x, z, label);
    showInfo(best, x, z);
  }

  // Interactions (pointeurs : souris + tactile avec pincement)
  const ptrs = new Map(); let moved = 0, pinch = 0;
  big.cv.addEventListener('pointerdown', (e) => { big.cv.setPointerCapture?.(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 1) moved = 0; pinch = 0; });
  big.cv.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    if (ptrs.size === 1) { moved += Math.abs(dx) + Math.abs(dy); big.cx -= dx / big.zoom; big.cz -= dy / big.zoom; }
    p[0] = e.clientX; p[1] = e.clientY;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) big.zoom = clamp(big.zoom * d / pinch, big.minZoom, 2.6);
      pinch = d; moved = 99;
    }
    clampView(); big.draw();
  });
  const up = (e) => { if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); pinch = 0; if (e.type === 'pointerup' && ptrs.size === 0 && moved < 6 && e.button === 0) clickAt(e.clientX, e.clientY); };
  big.cv.addEventListener('pointerup', up); big.cv.addEventListener('pointercancel', up);
  big.cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [wx, wz] = s2w(e.clientX, e.clientY);
    big.zoom = clamp(big.zoom * Math.exp(-e.deltaY * 0.0015), big.minZoom, 2.6);
    big.cx = wx - (e.clientX - big.w / 2) / big.zoom; big.cz = wz - (e.clientY - big.h / 2) / big.zoom;
    clampView(); big.draw();
  }, { passive: false });
  big.cv.addEventListener('contextmenu', (e) => { e.preventDefault(); big.sel = null; bus.emit('gps:clear', {}); showInfo(null); });

  function openBig() {
    refreshMarkers();
    big.open = true; big.el.hidden = false; sizeBig();
    const m = me(); big.cx = m.x; big.cz = m.z; big.zoom = clamp(0.5, big.minZoom, 2.6); clampView();
    showInfo(null); big.draw();
  }
  function closeBig() { big.open = false; big.el.hidden = true; clearTimeout(big.sharpT); }

  // ---------- Boucle ----------
  let tMini = 0, tSlow = 0, tBig = 0;
  sizeMini(); refreshMarkers();
  bus.on('resize', () => { sizeMini(); if (big.open) { sizeBig(); big.draw(); } });
  window.addEventListener('resize', () => { sizeMini(); if (big.open) { sizeBig(); big.draw(); } });
  const miniStep = ctx.quality === 'low' ? 1 / 15 : 1 / 30;

  function update(dt, visible) {
    tSlow += dt;
    if (tSlow > 1) {
      tSlow = 0; refreshMarkers();
      if (gps) {
        const m = me(), d = Math.hypot(gps.x - m.x, gps.z - m.z);
        if (gps.mine && d < 22) { bus.emit('gps:clear', {}); bus.emit('toast', { text: `Vous êtes arrivé : ${gps?.label || 'destination'}`, kind: 'success' }); }
        else if (gps.own && Math.hypot(m.x - gps.cx, m.z - gps.cz) > 45) { gps.path = route(m.x, m.z, gps.x, gps.z); gps.cx = m.x; gps.cz = m.z; }
      }
    }
    if (big.open) { tBig += dt; if (tBig > 0.25) { tBig = 0; if (ptrs.size === 0) big.draw(big.zoom > S * 1.15); } return; }
    if (!visible) return;
    tMini += dt;
    if (tMini >= miniStep) { tMini = 0; drawMini(); }
  }

  return {
    miniEl: mini.el, bigEl: big.el, update, openBig, closeBig, resizeMini: sizeMini,
    roadNameAt, setGps, getGps: () => gps, me,
    gpsDistance: () => { if (!gps) return null; const m = me(); return Math.hypot(gps.x - m.x, gps.z - m.z); },
    missionList, propertyList,
  };
}

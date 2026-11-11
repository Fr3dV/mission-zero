// Outils DOM, icônes SVG inline et formats — module interface.

/** Crée un élément. attrs : class, text, html, style, dataset, on<Event>, sinon attribut. */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const P = {
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M10.5 18.5h3"/>',
  map: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z"/><path d="M9 4v14M15 6v14"/>',
  chat: '<path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4z"/>',
  mission: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>',
  home: '<path d="M3.5 11.5 12 4l8.5 7.5"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/>',
  car: '<path d="M3 15.5v-2.2l2.2-.8L7.5 8.5h8l2.8 4 2.7.8v2.2"/><circle cx="7.5" cy="16" r="1.9"/><circle cx="16.5" cy="16" r="1.9"/><path d="M9.4 16h5.2"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.5-3.5 3-5 6-5s5.5 1.5 6 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M17.5 14.6c2 .3 3.2 1.7 3.5 4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5.5H4.5c0 3 1.5 4.5 3.8 4.8M16 5.5h3.5c0 3-1.5 4.5-3.8 4.8"/><path d="M12 13v4M8.5 20h7M9.5 17h5"/>',
  user: '<circle cx="12" cy="8.5" r="3.7"/><path d="M4.5 20c.7-4 3.7-6 7.5-6s6.8 2 7.5 6"/>',
  settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  pin: '<path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5v-4h-11v11h4"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  send: '<path d="M4 12 20 4.5 15 20l-3.2-6.3z"/><path d="M20 4.5 11.8 13.7"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  offline: '<path d="M4 4l16 16"/><path d="M2.5 9.5a14 14 0 0 1 5-3M11 5.3a14 14 0 0 1 10.5 4.2M6 13a9 9 0 0 1 3.5-2.2M14.5 11a9 9 0 0 1 3.5 2M9.5 16.5a4 4 0 0 1 4-.6"/><circle cx="12" cy="19.5" r=".8" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  locate: '<circle cx="12" cy="12" r="5.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  bolt: '<path d="M13 3 5.5 13.5H11L10 21l8-11h-5.5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5 19 4M15.5 7.5l2.5 2.5M13 10l2 2"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><circle cx="12" cy="16.8" r=".7" fill="currentColor"/>',
  flag: '<path d="M6 21V4M6 4.5h11l-2.2 3.5L17 11.5H6"/>',
};

/** Icône SVG inline (trait, couleur héritée). */
export function icon(name, size = 18) {
  const s = document.createElement('span');
  s.className = 'mz-ico';
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  return s;
}

/** Remplace le contenu d'un élément (ignore null/false, aplatit les tableaux). */
export function fill(el, ...kids) { el.replaceChildren(); append(el, kids); return el; }

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
export const zc = (n) => `Ƶ ${fmtInt(n)}`;
export function fmtDist(m) {
  if (!isFinite(m)) return '';
  if (m < 950) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
export function fmtHour(hh) {
  const t = (((Number(hh) || 0) % 24) + 24) % 24;
  const H = Math.floor(t), M = Math.floor((t - H) * 60);
  return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* repli ci-dessous */ }
  try {
    const ta = h('textarea', { style: 'position:fixed;opacity:0;left:-99px' });
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

export const lsGet = (k, d = null) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

/** Bouton à double validation : 1er clic arme (« Confirmer… »), 2e clic exécute. */
export function confirmButton(label, confirmLabel, onConfirm, cls = 'mz-btn') {
  let armed = false, timer = 0;
  const b = h('button', { class: cls, type: 'button', text: label });
  b.addEventListener('click', () => {
    if (b.disabled) return;
    if (!armed) {
      armed = true; b.textContent = confirmLabel; b.classList.add('is-armed');
      timer = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove('is-armed'); }, 3500);
    } else { clearTimeout(timer); armed = false; b.classList.remove('is-armed'); b.textContent = label; onConfirm(); }
  });
  return b;
}

// ---------- Silhouettes de voitures (profil à l'échelle, avant vers la droite) ----------
const SHAPES = {
  coupe: { body: [[0, .3], [0, .6], [.09, .7], [.3, .99], [.5, 1], [.7, .66], [.95, .52], [1, .42], [1, .3]], glass: [[.17, .7], [.32, .93], [.49, .94], [.65, .68]] },
  sedan: { body: [[0, .3], [0, .64], [.12, .7], [.26, .99], [.56, 1], [.73, .68], [.96, .6], [1, .48], [1, .3]], glass: [[.17, .7], [.28, .93], [.55, .94], [.69, .7]] },
  hatch: { body: [[0, .28], [0, .7], [.07, .98], [.55, 1], [.74, .66], [.96, .58], [1, .45], [1, .28]], glass: [[.06, .7], [.1, .93], [.54, .94], [.7, .68]] },
  suv: { body: [[0, .28], [0, .72], [.05, .98], [.58, 1], [.75, .7], [.97, .64], [1, .5], [1, .28]], glass: [[.05, .72], [.08, .93], [.57, .94], [.71, .71]] },
  truck: { body: [[0, .3], [0, .7], [.42, 1], [1, .6], [1, .3]], glass: [[.22, .78], [.42, .93], [.72, .77]], sharp: true },
};
function smooth(pts, sharp) {
  if (sharp) return 'M' + pts.map((p) => p.join(',')).join('L') + 'Z';
  const n = pts.length; let d = '';
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    d += i === 0 ? `M${mx.toFixed(1)},${my.toFixed(1)}` : `Q${a[0].toFixed(1)},${a[1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const a = pts[0], b = pts[1];
  return d + `Q${a[0].toFixed(1)},${a[1].toFixed(1)} ${((a[0] + b[0]) / 2).toFixed(1)},${((a[1] + b[1]) / 2).toFixed(1)}Z`;
}
let carUid = 0;
/** Profil stylisé d'un véhicule du catalogue, proportions réelles (longueur/hauteur). */
export function carSilhouette(spec, color) {
  const L = spec?.length || 4.5, H = spec?.height || 1.45;
  const kind = /cybertruck/.test(spec?.id || '') ? 'truck' : H >= 1.6 ? 'suv' : H < 1.36 ? 'coupe' : L < 4 ? 'hatch' : 'sedan';
  const sh = SHAPES[kind];
  const k = 33, W = 200, VH = 74, ground = 66;
  const x0 = (W - L * k) / 2, bw = L * k, bh = H * k;
  const map = (p) => [x0 + p[0] * bw, ground - p[1] * bh];
  const body = smooth(sh.body.map(map), sh.sharp);
  const glass = 'M' + sh.glass.map(map).map((p) => p.map((v) => v.toFixed(1)).join(',')).join('L') + 'Z';
  const r = Math.min(12.5, bh * 0.27), w1 = x0 + bw * 0.19, w2 = x0 + bw * 0.81, wy = ground - r;
  const id = 'mzc' + (++carUid);
  const c = color || spec?.colors?.[0] || '#c8ccd0';
  const wheel = (x) => `<circle cx="${x.toFixed(1)}" cy="${wy.toFixed(1)}" r="${(r + 2.2).toFixed(1)}" fill="#0b0e17"/><circle cx="${x.toFixed(1)}" cy="${wy.toFixed(1)}" r="${r.toFixed(1)}" fill="#161a26" stroke="#3b4258" stroke-width="1"/><circle cx="${x.toFixed(1)}" cy="${wy.toFixed(1)}" r="${(r * 0.52).toFixed(1)}" fill="none" stroke="#8a93ab" stroke-width="1.1"/>`;
  const el = document.createElement('div');
  el.className = 'mz-car';
  el.innerHTML = `<svg viewBox="0 0 ${W} ${VH}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></linearGradient></defs>
<ellipse cx="100" cy="${ground + 0.6}" rx="${(bw * 0.54).toFixed(1)}" ry="3.2" fill="#000" opacity=".5"/>
<path d="${body}" fill="${c}"/><path d="${body}" fill="url(#${id})" stroke="rgba(255,255,255,.4)" stroke-width=".9"/>
<path d="${glass}" fill="#0c1220" opacity=".86" stroke="rgba(255,255,255,.22)" stroke-width=".7" stroke-linejoin="round"/>
<rect x="${(x0 + bw - 5).toFixed(1)}" y="${(ground - bh * 0.5).toFixed(1)}" width="4" height="2.4" rx="1" fill="#fff3c4"/>
<rect x="${(x0 + 1).toFixed(1)}" y="${(ground - bh * 0.57).toFixed(1)}" width="3.6" height="2.4" rx="1" fill="#ff4d4d"/>
${wheel(w1)}${wheel(w2)}</svg>`;
  return el;
}

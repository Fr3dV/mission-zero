// Interface « Mission Zéro » : chargement, choix de la ville, accueil, HUD, minicarte, carte, téléphone, panneaux, chat.
// Contrat : createUI(ctx) -> { update(dt), open(panel, data), close(), isOpen(), banner(payload), prefs, setPref(clé, valeur) }.
// Fichiers : banners.js (file de bandeaux, carte de fin de mission), hudfun.js (jauge de niveau, encart objectif,
// pastilles képis / défis, pile de style, effets, vibration), panels.js (téléphone, concession, fiche de bien),
// carnet.js (onglet Carnet, fiche du matin), maps.js (cartes).
// L'interface ne modifie jamais l'argent : elle émet des intent:* sur le bus.
// Rien n'est propre à une ville ici : noms, styles et textes viennent de ctx.city (voir welcome.js, cityart.js, tiles.js).
import { h, icon, zc, fmtInt, fmtDist, fmtClock, fmtTime, fmtHour, lsGet, lsSet, clamp, starReward, typo } from './util.js';
import { shell } from './welcome.js';
import { createMaps } from './maps.js';
import { createPanels } from './panels.js';
import { createBanners } from './banners.js';
import { createHudFun } from './hudfun.js';
import { VEHICLE_BY_ID } from '@shared/catalog.js';

export function createUI(ctx) {
  const { bus, store, params } = ctx;
  const root = ctx.uiRoot || document.body;
  const ui = shell.ui;
  if (ui.parentNode !== root) root.appendChild(ui);
  shell.attach(bus);
  const city = ctx.city || shell.city;
  const { autostart, coarse, isCompact } = shell;

  const S = { logged: false, panel: null, panelName: null, chat: false, welcome: !autostart, net: 'connecting', booted: false, toggleT: 0, togglePanel: null, selfUnlockT: 0 };
  let pendingReturn = null; // fiche du matin (net:return) en attente d'ouverture : voir plus bas
  const RETURN_DELAY = 700; // ms entre la disparition de l'écran d'accueil et l'ouverture de la fiche
  const player = () => ctx.player || {};
  const setPlayerEnabled = (on) => { if (ctx.player && typeof ctx.player === 'object') ctx.player.enabled = on; };
  function capture() {
    const cap = S.welcome || S.panel != null || S.chat;
    setPlayerEnabled(!cap);
    if (cap && document.pointerLockElement) { S.selfUnlockT = performance.now(); try { document.exitPointerLock(); } catch { /* sans objet */ } }
    ui.classList.toggle('is-panel', S.panel != null);
  }

  // =====================================================================
  // Chargement + accueil (l'écran lui-même vit dans welcome.js, créé dès l'import)
  // =====================================================================
  // Données de la ville absentes : main.js s'est rabattu sur le petit jeu d'essai → on le dit clairement.
  const wdMeta = ctx.worldData?.meta || {};
  const sample = wdMeta.source === 'sample' || !(ctx.worldData?.roads?.length > 0);
  if (sample) shell.notice(`Les données de ${city.name} ne sont pas disponibles pour le moment : un quartier d’essai est chargé à la place.${shell.otherCities().length ? ' Vous pouvez choisir une autre ville.' : ''}`);

  let welcomeGone = false, welcomeGoneAt = 0;
  function hideWelcome() {
    if (welcomeGone) return;
    welcomeGone = true; welcomeGoneAt = performance.now(); S.welcome = false; shell.hide();
    ui.classList.add('is-live'); capture();
    if (pendingReturn) setTimeout(flushReturn, RETURN_DELAY); // la ville d'abord, la fiche du matin ensuite
  }
  bus.on('boot:done', () => {
    S.booted = true;
    shell.ready();
    bus.emit('audio:volume', { value: Number(lsGet('mz.volume', '0.7')) });
    bus.emit('ui:prefs', { ...prefs });
    maps.resizeMini();
    if (autostart) { S.logged = true; setTimeout(hideWelcome, 150); if (sample) setTimeout(() => toast(`Données de ${city.name} indisponibles : quartier d’essai chargé.`, 'error'), 600); return; }
    capture();
  });
  shell.onPlay = (name, room) => {
    if (S.logged) return;
    S.logged = true;
    bus.emit('intent:login', { name, room });
    setTimeout(hideWelcome, 2500); // repli si net:welcome tarde
  };
  bus.on('net:welcome', (p) => { setNet(p?.offline ? 'offline' : 'online'); S.logged = true; hideWelcome(); });

  // =====================================================================
  // Préférences (contrat v6) : objet STABLE, lu paresseusement par les autres modules via ctx.ui.prefs.
  // localStorage : mz.quiet ('1'), mz.fx ('full' | 'soft' | 'off'), mz.hideobj ('1'). Modifier via api.setPref().
  // =====================================================================
  const FX = ['full', 'soft', 'off'];
  const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const prefs = { quiet: lsGet('mz.quiet', '0') === '1', fx: FX.includes(lsGet('mz.fx')) ? lsGet('mz.fx') : reducedMotion ? 'soft' : 'full', hideObjective: lsGet('mz.hideobj', '0') === '1' };
  function applyPrefs() {
    ui.classList.toggle('mz-fx-soft', prefs.fx === 'soft');
    ui.classList.toggle('mz-fx-off', prefs.fx === 'off');
    fun.applyPrefs();
  }
  function setPref(key, value) {
    if (key === 'quiet' || key === 'hideObjective') value = !!value;
    else if (key !== 'fx' || !FX.includes(value)) return false;
    if (prefs[key] === value) return true;
    prefs[key] = value;
    lsSet(key === 'quiet' ? 'mz.quiet' : key === 'fx' ? 'mz.fx' : 'mz.hideobj', key === 'fx' ? value : value ? '1' : '0');
    applyPrefs();
    bus.emit('ui:prefs', { ...prefs });
    return true;
  }
  const fun = createHudFun(ctx, { prefs, touch: !!coarse, banner: (p) => banners.push(p), open: (p, d) => api.open(p, d), idle: () => !S.welcome && S.panel == null && !pendingReturn });

  // =====================================================================
  // HUD
  // =====================================================================
  const moneyV = h('span', { class: 'mz-wallet-v', text: fmtInt(store.me?.money) });
  const floats = h('div', { class: 'mz-floats' });
  const hourV = h('span', { text: fmtHour(store.timeOfDay) });
  const hourIco = h('span', { class: 'mz-hour-ico' }, icon('sun', 14));
  const onlineV = h('span', { text: '1' });
  const netChip = h('span', { class: 'mz-chipstat mz-netchip', hidden: true }, icon('offline', 14), h('span', { text: 'Hors ligne' }));
  const tr = h('div', { class: 'mz-tr' },
    h('div', { class: 'mz-wallet' }, h('span', { class: 'mz-wallet-s', text: 'Ƶ' }), moneyV, floats),
    fun.els.lvl,
    h('div', { class: 'mz-meta' }, netChip, h('span', { class: 'mz-chipstat', title: 'Joueurs en ligne' }, icon('users', 14), onlineV), h('span', { class: 'mz-chipstat mz-citychip', title: city.tagline || city.name }, icon('pin', 13), h('span', { text: city.name })), h('span', { class: 'mz-chipstat mz-hourchip', title: `Heure à ${city.name}` }, hourIco, hourV), fun.els.heatChip, fun.els.dailyChip),
    h('div', { class: 'mz-tbtns' },
      h('button', { class: 'mz-iconbtn', type: 'button', 'aria-label': 'Téléphone', onclick: () => api.open('phone') }, icon('phone')),
      h('button', { class: 'mz-iconbtn', type: 'button', 'aria-label': 'Carte', onclick: () => api.open('map') }, icon('map')),
      h('button', { class: 'mz-iconbtn', type: 'button', 'aria-label': 'Chat', onclick: () => openChat() }, icon('chat'))));

  // Suivi d'activité unifié (mission, course de taxi, Chiche) : piloté par mission:update SEUL.
  // Masqué quand `mission === null` ou après 3 s sans mise à jour — jamais d'après store.mission (nul pour une course ou un Chiche).
  const mEye = h('span', { class: 'mz-eyebrow', text: 'Mission' });
  const mT = h('strong', { class: 'mz-mis-title' }), mS = h('span', { class: 'mz-mis-step' }), mPips = h('span', { class: 'mz-pips' });
  const mRival = h('span', { class: 'mz-mis-rival', hidden: true });
  const mTipF = h('i'), mTip = h('div', { class: 'mz-mis-tip', hidden: true }, h('span', { text: 'Pourboire' }), h('span', { class: 'mz-mis-tipbar' }, mTipF));
  const mD = h('span', { class: 'mz-mis-d' }), mR = h('span', { class: 'mz-mis-r' }), mC = h('span', { class: 'mz-mis-c' });
  const tracker = h('div', { class: 'mz-mis', hidden: true },
    h('div', { class: 'mz-mis-head' }, mEye, mPips), mT, mS, mRival, mTip, h('div', { class: 'mz-mis-foot' }, mD, mR, mC));
  const M = { on: false, t: 0, pips: '', eye: 'Mission', tip: -1, beep: -1, flip: false, stepFlip: false };
  /** Emplacement haut-gauche : UN seul occupant, priorité suivi d'activité > carte de fin > encart objectif. */
  function tlSync() {
    const card = !M.on && banners.card.active();
    if (tracker.hidden === M.on) tracker.hidden = !M.on;
    if (banners.card.el.hidden === card) banners.card.el.hidden = !card;
    fun.setAllowed(!M.on && !card);
  }
  function trackOff() {
    if (!M.on) return;
    M.on = false; M.beep = -1; tracker.classList.remove('is-beep-a', 'is-beep-b');
    fun.setCalm(false); tlSync();
  }
  bus.on('mission:update', (p) => {
    const m = p?.mission;
    if (!p || m === null || p.done) { trackOff(); return; }
    // une mise à jour attardée de la mission qui vient de finir ne rouvre pas le suivi par-dessus sa carte de fin
    if (!M.on && banners.card.active() && typeof m === 'object' && m?.id != null && m.id === banners.card.id() && performance.now() - banners.card.endedAt() < 500) return;
    M.t = performance.now();
    if (!M.on) { M.on = true; banners.card.close(); tlSync(); }
    const kind = typeof m === 'object' ? m?.kind : null;
    const eye = p.eyebrow || (kind === 'job' ? 'Course' : kind === 'dare' ? 'Chiche !' : 'Mission');
    if (eye !== M.eye) { M.eye = eye; mEye.textContent = typo(eye); }
    const title = typo((typeof m === 'object' ? m?.title : null) || store.mission?.title || eye);
    if (mT.textContent !== title) mT.textContent = title;
    const txt = typo(p.text || (typeof p.step === 'object' ? p.step?.label || p.step?.text : typeof p.step === 'string' ? p.step : '') || '');
    if (mS.textContent !== txt) mS.textContent = txt;
    const n = Number(p.stepCount ?? (typeof m === 'object' ? m?.steps?.length : 0)) || 0, i = Number(p.stepIndex ?? (typeof p.step === 'number' ? p.step : 0)) || 0;
    const key = `${i}/${n}`;
    if (key !== M.pips) { M.pips = key; mPips.replaceChildren(...(n > 1 && n <= 12 ? Array.from({ length: n }, (_, k) => h('i', { class: k < i ? 'is-done' : k === i ? 'is-on' : '' })) : [])); }
    // record à battre dans la catégorie de la voiture conduite, chrono en cours
    const el = p.elapsed != null && isFinite(p.elapsed) ? fmtTime(p.elapsed) : '';
    let rv = '';
    if (p.rival?.name && p.rival.sec > 0) rv = `À battre : ${p.rival.name === store.me?.name ? 'votre record' : p.rival.name} ${fmtTime(p.rival.sec)}${el ? ` · vous ${el}` : ''}`;
    else if (p.mine > 0) rv = `Votre record : ${fmtTime(p.mine)}${el ? ` · vous ${el}` : ''}`;
    rv = typo(rv);
    if (mRival.textContent !== rv) { mRival.textContent = rv; mRival.hidden = !rv; }
    // jauge de pourboire (course de taxi)
    const tip = p.tip != null && isFinite(p.tip) ? Math.round(clamp(p.tip, 0, 1) * 50) / 50 : -1;
    if (tip !== M.tip) { M.tip = tip; mTip.hidden = tip < 0; if (tip >= 0) { mTipF.style.setProperty('--f', String(tip)); mTip.classList.toggle('is-low', tip < 0.34); } }
    let d = p.distance != null && isFinite(p.distance) && p.distance > 0 ? fmtDist(p.distance) : '';
    if (p.maxDamage) d += `${d ? ' · ' : ''}Dégâts ${Math.round(((p.damage || 0) / p.maxDamage) * 100)}\u00a0%`;
    if (mD.textContent !== d) mD.textContent = d;
    // mission vedette encore à faire : même montant doublé que l'encart objectif et le téléphone (jamais une course ni un Chiche)
    const r = p.reward > 0 ? `+${zc(kind == null || kind === 'mission' ? starReward(store.journal, typeof m === 'object' ? m?.id : m, p.reward) : p.reward)}` : '';
    if (mR.textContent !== r) mR.textContent = r;
    const timed = p.timeLeft != null && isFinite(p.timeLeft);
    const c = timed ? fmtClock(p.timeLeft) : !rv ? el : '';
    if (mC.textContent !== c) mC.textContent = c;
    mC.classList.toggle('is-low', timed && p.timeLeft < 15);
    mC.classList.toggle('is-chrono', !timed);
    // bips visuels : un éclat par seconde sous 10 s (le son correspondant est joué par le module audio)
    const beep = timed && p.timeLeft < 10 && p.timeLeft > 0 ? Math.ceil(p.timeLeft) : -1;
    if (beep !== M.beep) { M.beep = beep; M.flip = !M.flip; tracker.classList.toggle('is-beep-a', beep >= 0 && M.flip); tracker.classList.toggle('is-beep-b', beep >= 0 && !M.flip); }
    fun.setCalm(!!p.maxDamage);
  });
  // étape validée : éclat des repères d'étape (le suivi lui-même est rafraîchi par mission:update)
  bus.on('mission:step', () => { if (!M.on) return; M.stepFlip = !M.stepFlip; mPips.className = 'mz-pips ' + (M.stepFlip ? 'is-a' : 'is-b'); });
  bus.on('mission:start', () => { banners.card.close(); });

  // Minicarte, plaque de rue, GPS
  const plaqueT = h('span'), plaqueR = h('b', { hidden: true });
  const plaque = h('div', { class: 'mz-plaque', hidden: true }, h('div', { class: 'mz-plaque-in' }, plaqueR, plaqueT));
  const gpsT = h('span'), gpsD = h('b');
  const gpsChip = h('div', { class: 'mz-gps', hidden: true }, icon('pin', 14), gpsT, gpsD);
  const maps = createMaps(ctx, {
    isCompact, touch: !!coarse,
    openMap: () => api.open('map'),
    open: (p, d) => api.open(p, d),
    close: () => api.close(),
    onGps: (g) => { gpsChip.hidden = !g; if (g) { gpsT.textContent = typo(g.label); gpsD.textContent = ''; lastGps = ''; } }, // lastGps : la distance est réécrite au prochain relevé, même inchangée
  });
  const bl = h('div', { class: 'mz-bl' }, maps.miniEl, h('div', { class: 'mz-bl-info' }, plaque, gpsChip));

  // Compteur
  const ARC = 2 * Math.PI * 52 * (240 / 360);
  const spV = h('span', { class: 'mz-sp-v', text: '0' }), spG = h('span', { class: 'mz-sp-g', text: 'N' }), spN = h('span', { class: 'mz-sp-n' });
  const speedo = h('div', { class: 'mz-speedo', hidden: true });
  speedo.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(150 60 60)" fill="none" stroke-linecap="round">
<circle cx="60" cy="60" r="52" stroke="rgba(255,255,255,.14)" stroke-width="3" stroke-dasharray="${ARC.toFixed(1)} 999"/>
<circle class="mz-sp-arc" cx="60" cy="60" r="52" stroke="currentColor" stroke-width="3.5" stroke-dasharray="0 999"/>
<circle cx="60" cy="60" r="45" stroke="rgba(255,255,255,.08)" stroke-width="2" stroke-dasharray="${(ARC * 45 / 52).toFixed(1)} 999"/>
<circle class="mz-sp-rpm" cx="60" cy="60" r="45" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-dasharray="0 999"/></g></svg>`;
  speedo.append(h('div', { class: 'mz-sp-c' }, spV, h('span', { class: 'mz-sp-u', text: 'km/h' })), spG, spN);
  const spArc = speedo.querySelector('.mz-sp-arc'), spRpm = speedo.querySelector('.mz-sp-rpm');
  let spLast = -1, spGear = '', spVeh = null, spArcLast = -1, spRpmLast = -1;

  // Invite contextuelle
  const prK = h('kbd'), prT = h('span');
  const prompt = h('div', { class: 'mz-prompt', hidden: true }, prK, prT);
  bus.on('player:prompt', (p) => {
    const text = typeof p === 'string' ? p : p?.text;
    if (!text) { prompt.hidden = true; return; }
    const m = /^\s*\[?([A-Za-zÀ-ÿ0-9]{1,7})\]?\s*[—–:-]\s*(.+)$/.exec(text);
    const key = p?.key || (m ? m[1] : '');
    // écran tactile : jamais de touche du clavier dans l'invite (« F — Descendre » devient « Descendre »)
    const kbdKey = !!coarse && /^([a-z0-9]|tab|maj|espace|entrée|échap|ctrl|alt)$/i.test(key);
    prK.hidden = !key || kbdKey; prK.textContent = key; prT.textContent = typo(m && (!p?.key || kbdKey) ? m[2] : text);
    prompt.hidden = false;
  });

  // Toasts, chat (les bandeaux et la carte de fin vivent dans banners.js)
  const toasts = h('div', { class: 'mz-toasts', role: 'status' });
  // Pendant la fiche du matin, les messages du jeu (accueil de Monsieur Zéro, monument découvert…) attendent sa fermeture :
  // ils ne recouvrent pas la fiche et ne s'effacent pas sans avoir été lus. Les erreurs, elles, passent tout de suite.
  const heldToasts = [];
  // la file est vidée d'un bloc : un message de nouveau retenu (fiche encore ouverte) attend le prochain passage, sans boucle
  function flushToasts() { for (const t of heldToasts.splice(0)) toast(t[0], t[1]); }
  function toast(text, kind = 'info') {
    if (!text) return;
    if (kind !== 'error' && (S.panel === 'return' || pendingReturn)) { heldToasts.push([text, kind]); if (heldToasts.length > 4) heldToasts.shift(); return; }
    const t = h('div', { class: `mz-toast is-${kind}` }, h('i'), h('span', { text }));
    toasts.appendChild(t);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 400); }, 4200);
  }
  bus.on('toast', (p) => toast(p?.text, p?.kind));
  const feed = h('div', { class: 'mz-feed' });
  const CHAT_MAX = 200; // MAX_CHAT_LEN de shared/protocol.js
  const chatIn = h('input', { class: 'mz-input', type: 'text', maxlength: String(CHAT_MAX), autocomplete: 'off', placeholder: coarse ? 'Message…' : 'Message… (Entrée pour envoyer)', 'aria-label': 'Message' });
  const chatBox = h('form', { class: 'mz-chatbox', hidden: true, onsubmit: (e) => { e.preventDefault(); sendChat(); } }, chatIn, h('button', { class: 'mz-iconbtn', type: 'submit', 'aria-label': 'Envoyer' }, icon('send')));
  const chat = h('div', { class: 'mz-chat' }, feed, chatBox);
  function pushLine(from, text, system) {
    if (!text) return;
    const l = h('div', { class: 'mz-line' + (system ? ' is-sys' : '') }, from && !system ? h('b', { text: from }) : null, h('span', { text }));
    feed.appendChild(l);
    while (feed.children.length > 30) feed.firstChild.remove();
    setTimeout(() => l.classList.add('is-old'), 9000);
  }
  bus.on('chat:message', (p) => p && pushLine(typeof p.from === 'object' ? p.from?.name : p.from, p.text, p.system));
  bus.on('net:playerJoin', (p) => p?.name && p.id !== store.me?.id && pushLine(null, `${p.name} a rejoint la salle`, true));
  bus.on('net:playerLeave', (p) => p?.name && pushLine(null, `${p.name} est parti`, true));
  function openChat() {
    if (S.welcome || S.panel) return;
    S.chat = true; chatBox.hidden = false; chat.classList.add('is-open'); ui.classList.add('is-chat'); capture();
    setTimeout(() => chatIn.focus(), 0);
  }
  function closeChat() { if (!S.chat) return; S.chat = false; chatBox.hidden = true; chat.classList.remove('is-open'); ui.classList.remove('is-chat'); chatIn.value = ''; chatIn.blur(); capture(); }
  function sendChat() { const text = chatIn.value.trim().slice(0, CHAT_MAX); if (text) bus.emit('intent:chat', { text }); closeChat(); }

  const vignette = h('div', { class: 'mz-vignette' });
  bus.on('vehicle:crash', (p) => {
    if (!p || p.vehicle !== player().vehicle || !(p.impact > 4)) return;
    vignette.classList.remove('is-hit'); void vignette.offsetWidth; vignette.classList.add('is-hit');
  });

  // Bandeaux (ui:banner, file de 4) et carte de fin (mission:end) : la carte occupe .mz-tl, le bandeau le centre.
  const hud = h('div', { class: 'mz-hud' });
  const banners = createBanners(ctx, {
    hud, touch: !!coarse, level: fun.level, setLevel: fun.setLevel, quiet: () => !!prefs.quiet, sheetOpen: () => S.panel === 'return' || !!pendingReturn,
    onCard: (shown) => { if (shown && M.on) { M.on = false; fun.setCalm(false); } tlSync(); },
  });
  hud.append(fun.els.fxSpeed, fun.els.fxGold, vignette, h('div', { class: 'mz-tl' }, tracker, banners.card.el, fun.els.obj), tr, bl, chat, speedo, fun.els.style, prompt, toasts);
  ui.appendChild(hud);

  // Argent : compteur qui défile + variations flottantes
  const mny = { shown: Number(store.me?.money) || 0, target: Number(store.me?.money) || 0, last: '' };
  bus.on('money:change', (p) => {
    if (!p || !p.delta) return;
    const f = h('div', { class: 'mz-float ' + (p.delta > 0 ? 'is-plus' : 'is-minus') }, `${p.delta > 0 ? '+' : '−'}${fmtInt(Math.abs(p.delta))}`, p.reason ? h('small', { text: reasonLabel(p.reason) }) : null);
    floats.appendChild(f);
    f.addEventListener('animationend', () => f.remove());
    while (floats.children.length > 4) floats.firstChild.remove();
    tr.classList.remove('is-bump'); void tr.offsetWidth; tr.classList.add('is-bump');
  });
  // Motifs émis par le serveur (S.PROFILE.reason, contrat v6) -> libellé court de la variation d'argent.
  // Les virements arrivent en clair (« virement à Léa », « virement de Tom ») : on se contente d'une majuscule.
  const REASONS = {
    mission: 'Mission', loyers: 'Loyers', 'achat véhicule': 'Véhicule', 'achat immobilier': 'Immobilier', 'vente immobilière': 'Vente',
    'course de taxi': 'Course de taxi', 'défi du jour': 'Défi du jour', 'défis de la veille': 'Défis de la veille', 'journée complète': 'Journée complète', amende: 'Amende', peinture: 'Atelier', chiche: 'Chiche !',
  };
  const reasonLabel = (r) => { const s = String(r ?? '').trim(); return REASONS[s] || REASONS[s.toLowerCase()] || (s ? s[0].toUpperCase() + s.slice(1, 30) : ''); };

  function setNet(state) {
    S.net = state;
    shell.setNet(state);
    netChip.hidden = state === 'online' || (state === 'connecting' && !S.logged);
    netChip.className = 'mz-chipstat mz-netchip is-' + state;
    netChip.lastChild.textContent = state === 'offline' ? 'Hors ligne' : 'Reconnexion…';
  }
  bus.on('net:status', (p) => p?.state && setNet(p.state));

  // =====================================================================
  // Fiche du matin (net:return, émis à chaque S.WELCOME dès qu'il y a quelque chose à lire)
  // =====================================================================
  // Premier login : la fiche s'ouvre (défis du jour, relevé des loyers, gazette). Reconnexion après veille ou coupure :
  // jamais de fiche modale au milieu de la conduite, un bandeau 'info' seulement ; le relevé reste dans l'onglet Carnet.
  // Avec ?autostart=1 (sondes, captures) la fiche ne s'ouvre pas d'elle-même non plus, sauf ?fiche=1.
  const autoFiche = !autostart || params?.get?.('fiche') === '1';
  function returnBanner(p) {
    const rent = Number(p.away?.rent) > 0;
    banners.push({ kind: 'info', eyebrow: 'Carnet de bord', title: rent ? 'Relevé du matin disponible' : p.fresh ? 'Nouveaux défis du jour' : 'Du nouveau dans la Gazette', sub: `${coarse ? 'Téléphone' : 'Tab'} ▸ Carnet`, ms: 4200 });
  }
  function flushReturn() {
    const p = pendingReturn;
    pendingReturn = null;
    if (!p) return;
    if (S.welcome) { pendingReturn = p; return; }
    if (S.panel != null || S.chat) { returnBanner(p); flushToasts(); return; } // le joueur a déjà ouvert autre chose : on ne lui prend pas la main
    api.open('return', p);
  }
  // À la manette (le module joueur n'émet rien tant qu'un panneau est ouvert) : un bouton ferme la fiche, X / carré = « Y aller ».
  // Lu à 10 Hz et seulement pendant que la fiche est ouverte ; il faut d'abord avoir vu tous les boutons relâchés.
  let padArmed = false;
  function padReturn() {
    let pads = null;
    try { pads = navigator.getGamepads ? navigator.getGamepads() : null; } catch { pads = null; }
    if (!pads) return;
    let down = -1;
    for (let i = 0; i < pads.length && down < 0; i++) { const b = pads[i]?.buttons; if (b) for (let k = 0; k < b.length && k < 16; k++) if (b[k]?.pressed) { down = k; break; } }
    if (down < 0) { padArmed = true; return; }
    if (!padArmed || performance.now() - panels.returnOpenedAt() < 450) return;
    padArmed = false;
    if (down === 2) panels.returnGo(); else api.close();
  }
  bus.on('net:return', (p) => {
    if (!p || !(p.fresh || Number(p.away?.rent) > 0 || (Array.isArray(p.feed) && p.feed.length))) return;
    if (p.reconnect || !autoFiche) { returnBanner(p); return; }
    pendingReturn = { fresh: !!p.fresh, away: p.away || null, feed: Array.isArray(p.feed) ? p.feed : [] };
    if (!S.welcome) setTimeout(flushReturn, welcomeGone ? Math.max(0, RETURN_DELAY - (performance.now() - welcomeGoneAt)) : RETURN_DELAY);
  });

  // =====================================================================
  // Panneaux
  // =====================================================================
  const panels = createPanels(ctx, { maps, prefs, setPref, touch: !!coarse, banner: (p) => banners.push(p), idle: () => !S.welcome && S.panel == null && !pendingReturn, open: (p, d) => api.open(p, d), close: () => api.close(), netState: () => S.net, switchCity: (id) => shell.switchCity(id, store.room), inviteUrl: () => shell.inviteUrl(store.room), otherCities: shell.otherCities });
  ui.append(maps.bigEl, ...panels.els);

  const api = {
    update,
    open(panel, data) {
      if (S.welcome || !panel) return;
      if (S.chat) closeChat();
      if (S.panel === 'map') maps.closeBig();
      panels.hide();
      const p = panel === 'map' ? 'map' : panel === 'dealer' || panel === 'property' || panel === 'return' ? panel : 'phone';
      if (p === 'map') maps.openBig(); else panels.show(panel, data);
      const changed = S.panel !== p || S.panelName !== panel;
      S.panel = p; S.panelName = panel; capture();
      if (p !== 'return') flushToasts();
      // notification (jamais la commande ui:open) : émise une fois l'état changé, donc réentrante sans boucle
      if (changed) bus.emit('ui:opened', { panel });
    },
    close() {
      if (S.chat) closeChat();
      if (S.panel == null) return;
      const was = S.panelName || S.panel;
      if (S.panel === 'map') maps.closeBig();
      panels.hide(); S.panel = null; S.panelName = null; capture();
      if (document.activeElement instanceof HTMLElement && ui.contains(document.activeElement)) document.activeElement.blur();
      flushToasts();
      bus.emit('ui:closed', { panel: was });
    },
    isOpen: () => S.welcome || S.panel != null || S.chat,
    toast,
    /** Pousse un bandeau dans la file : { kind:'ok'|'ko'|'gold'|'info', eyebrow, title, sub?, ms?, sound? } (comme ui:banner). */
    banner: (p) => banners.push(p),
    /** Préférences { quiet, fx, hideObjective } : même objet pendant toute la session (lecture paresseuse). */
    prefs,
    /** Change une préférence ('quiet' | 'fx' | 'hideObjective'), l'enregistre et émet ui:prefs. */
    setPref,
    /** Mesures de la file de bandeaux (sondes). */
    bannerStats: () => banners.stats(),
    /** Recharge la page dans une autre ville (ctx.cities) en gardant salle, qualité, etc. */
    switchCity: (id) => shell.switchCity(id, store.room),
    /** Mesures des cartes (préparation, tuiles, ms par image). */
    mapStats: () => maps.stats(),
    maps,
  };
  const recentKey = (p) => performance.now() - S.toggleT < 300 && S.togglePanel === p;
  bus.on('ui:open', (p) => { if (!p?.panel || recentKey(p.panel)) return; api.open(p.panel, p.data); });
  bus.on('ui:close', () => { if (performance.now() - S.toggleT < 300) return; api.close(); });
  function toggle(panel) {
    S.toggleT = performance.now(); S.togglePanel = panel;
    if (S.panel === panel || (panel === 'phone' && S.panel && S.panel !== 'map')) api.close(); else api.open(panel);
  }

  // Clavier (capture : avant les écouteurs de jeu)
  const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock']);
  window.addEventListener('keydown', (e) => {
    if (S.welcome || !S.booted) return;
    const tg = e.target, typing = tg instanceof HTMLElement && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT');
    if (e.code === 'Escape') {
      e.preventDefault();
      if (S.chat) closeChat(); else if (S.panel) { S.toggleT = performance.now(); S.togglePanel = S.panel; api.close(); } else toggle('phone');
      return;
    }
    if (S.panel === 'return' && !typing) {
      // Fiche du matin : E suit la mission vedette, n'importe quelle autre touche la ferme (rien n'atteint le jeu).
      e.stopPropagation();
      const onBtn = tg instanceof HTMLElement && tg.tagName === 'BUTTON' && (e.code === 'Enter' || e.code === 'Space' || e.code === 'Tab');
      if (onBtn || MODIFIERS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return; // navigation au clavier dans la fiche, raccourcis du navigateur
      e.preventDefault();
      if (e.repeat || performance.now() - panels.returnOpenedAt() < 450) return; // la touche encore enfoncée à l'ouverture ne compte pas
      if (e.code === 'KeyE') panels.returnGo(); else { S.toggleT = performance.now(); S.togglePanel = 'return'; api.close(); }
      return;
    }
    if (S.panel || S.chat || typing) {
      // Un menu capture les entrées : rien ne doit atteindre le jeu.
      if (e.code === 'Tab' && S.panel) { e.preventDefault(); if (!e.repeat) toggle('phone'); }
      else if (e.code === 'KeyM' && S.panel === 'map' && !typing && !e.repeat) toggle('map');
      if (!typing) e.stopPropagation();
      return;
    }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Tab') { e.preventDefault(); toggle('phone'); }
    else if (e.code === 'KeyM') toggle('map');
    else if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); openChat(); }
  }, true);
  // Échap pendant le verrouillage du pointeur : le navigateur le consomme → on ouvre le téléphone.
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement || performance.now() - S.selfUnlockT < 400) return;
    if (S.logged && !S.welcome && !S.panel && !S.chat && document.hasFocus()) setTimeout(() => { if (!S.panel && !S.chat && !document.pointerLockElement && player().enabled !== false) api.open('phone'); }, 60);
  });
  // Les touches frappées dans nos champs ne remontent pas jusqu'aux écouteurs du jeu.
  ui.addEventListener('keydown', (e) => e.stopPropagation());
  const onResize = () => { shell.applyCompact(); maps.resizeMini(); };
  window.addEventListener('resize', onResize);

  // =====================================================================
  // Boucle (léger : aucune lecture de layout, textes modifiés seulement s'ils changent)
  // =====================================================================
  let tHud = 0, tSlow = 0, tHalf = 0, tPad = 0, lastHour = '', lastOnline = -1, lastPlaque = null, lastNight = null, lastGps = '';
  function update(dt) {
    // argent
    const target = Number(store.me?.money) || 0;
    if (target !== mny.target) mny.target = target;
    if (mny.shown !== mny.target) {
      const diff = mny.target - mny.shown;
      mny.shown = Math.abs(diff) < 1 ? mny.target : mny.shown + diff * Math.min(1, dt * 6);
      const s = fmtInt(mny.shown);
      if (s !== mny.last) { mny.last = s; moneyV.textContent = s; }
    }
    if (S.welcome) return;
    if (M.on && performance.now() - M.t > 3000) trackOff(); // 3 s sans mission:update : l'activité est finie
    const live = S.panel == null;
    if (S.panel === 'return') { tPad += dt; if (tPad >= 0.1) { tPad = 0; padReturn(); } } else if (padArmed) padArmed = false;
    maps.update(dt, live);

    tHud += dt;
    if (!live) tHud = 0; // panneau ouvert : le HUD est masqué, le compte à rebours de la carte de fin ne court pas (elle garde sa durée à la fermeture)
    if (tHud >= 1 / 15 && live) {
      const p = player(), v = p.mode === 'vehicle' ? p.vehicle : null;
      const abs = Math.abs(Number(v ? v.speed : p.speed) || 0);
      banners.card.tick(tHud, abs);
      fun.tick(v, abs, v ? v.spec?.maxSpeed || VEHICLE_BY_ID[v.typeId]?.maxSpeed || 60 : 0);
      tHud = 0;
      if (!!v === speedo.hidden) { speedo.hidden = !v; ui.classList.toggle('is-driving', !!v); }
      if (v) {
        if (v !== spVeh) { spVeh = v; spN.textContent = v.spec?.name || VEHICLE_BY_ID[v.typeId]?.name || ''; }
        const ms = Number(v.speed) || 0, kmh = Math.round(Math.abs(ms) * 3.6);
        if (kmh !== spLast) { spLast = kmh; spV.textContent = kmh; }
        const max = (v.spec?.maxSpeed || VEHICLE_BY_ID[v.typeId]?.maxSpeed || 60);
        const f = clamp(Math.abs(ms) / max, 0, 1);
        const a = Math.round(f * ARC);
        if (a !== spArcLast) { spArcLast = a; spArc.setAttribute('stroke-dasharray', `${a} 999`); speedo.classList.toggle('is-hot', f > 0.9); }
        // rapport et régime : valeurs du véhicule si présentes, sinon estimation
        const elec = v.spec?.electric;
        let gear = v.gear, rpm = v.rpm;
        if (gear == null) gear = ms < -0.5 ? 'R' : kmh < 1 ? 'N' : elec ? 'D' : 1 + Math.min(5, Math.floor(f * 6));
        else if (gear === 0) gear = 'N'; else if (gear === -1) gear = 'R';
        if (rpm == null) rpm = elec ? f : kmh < 1 ? 0.12 : 0.25 + 0.75 * ((f * 6) % 1);
        else if (rpm > 1.5) rpm /= (v.maxRpm || v.spec?.maxRpm || 8000);
        if (String(gear) !== spGear) { spGear = String(gear); spG.textContent = spGear; }
        const r = Math.round(clamp(rpm, 0, 1) * ARC * 45 / 52);
        if (r !== spRpmLast) { spRpmLast = r; spRpm.setAttribute('stroke-dasharray', `${r} 999`); }
      }
    }

    tHalf += dt;
    if (tHalf >= 0.5) {
      tHalf = 0;
      if (S.panel && S.panel !== 'map') panels.refresh();
      if (live) {
        const m = maps.me();
        const road = maps.roadAt(m.x, m.z, 26);
        let name = road ? road.name || road.ref : null, ref = road && road.name && road.ref ? String(road.ref).split(';')[0].trim() : '';
        if (!name) for (const l of ctx.LANDMARKS || []) if (!l.hidden && Math.hypot(l.x - m.x, l.z - m.z) < (l.radius || 50) + 40) { name = l.name; break; }
        const key = name ? ref + '|' + name : null;
        if (key !== lastPlaque) { lastPlaque = key; plaque.hidden = !name; if (name) { plaqueT.textContent = name; plaqueR.hidden = !ref; plaqueR.textContent = ref; plaque.classList.toggle('is-fast', !!road && road.tier <= 1); } }
        const d = maps.gpsDistance(), ds = d == null ? '' : fmtDist(d);
        if (ds !== lastGps) { lastGps = ds; gpsD.textContent = ds; }
      }
    }

    tSlow += dt;
    if (tSlow >= 1) {
      tSlow = 0;
      const hh = fmtHour(store.timeOfDay);
      if (hh !== lastHour) { lastHour = hh; hourV.textContent = hh; }
      const t = Number(store.timeOfDay) || 0, night = t < 6.5 || t >= 20.5;
      if (night !== lastNight) { lastNight = night; hourIco.replaceChildren(icon(night ? 'moon' : 'sun', 14)); }
      const P = store.players; let n = 1;
      if (P && typeof P.forEach === 'function') { n = 0; let hasMe = false; P.forEach((pl, id) => { n++; if ((pl?.id ?? id) === store.me?.id) hasMe = true; }); if (!hasMe) n++; }
      if (n !== lastOnline) { lastOnline = n; onlineV.textContent = String(n); }
      fun.slow();
      panels.slow();
    }
  }

  applyPrefs(); tlSync(); capture();
  return api;
}

// Interface « Mission Zéro » : chargement, choix de la ville, accueil, HUD, minicarte, carte, téléphone, panneaux, chat.
// Contrat : createUI(ctx) -> { update(dt), open(panel, data), close(), isOpen() }.
// L'interface ne modifie jamais l'argent : elle émet des intent:* sur le bus.
// Rien n'est propre à une ville ici : noms, styles et textes viennent de ctx.city (voir welcome.js, cityart.js, tiles.js).
import { h, icon, zc, fmtInt, fmtDist, fmtClock, fmtHour, lsGet, clamp } from './util.js';
import { shell } from './welcome.js';
import { createMaps } from './maps.js';
import { createPanels } from './panels.js';
import { VEHICLE_BY_ID } from '@shared/catalog.js';

export function createUI(ctx) {
  const { bus, store, params } = ctx;
  const root = ctx.uiRoot || document.body;
  const ui = shell.ui;
  if (ui.parentNode !== root) root.appendChild(ui);
  shell.attach(bus);
  const city = ctx.city || shell.city;
  const { autostart, coarse, isCompact } = shell;

  const S = { logged: false, panel: null, chat: false, welcome: !autostart, net: 'connecting', booted: false, toggleT: 0, togglePanel: null, selfUnlockT: 0 };
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

  let welcomeGone = false;
  function hideWelcome() {
    if (welcomeGone) return;
    welcomeGone = true; S.welcome = false; shell.hide();
    ui.classList.add('is-live'); capture();
  }
  bus.on('boot:done', () => {
    S.booted = true;
    shell.ready();
    bus.emit('audio:volume', { value: Number(lsGet('mz.volume', '0.7')) });
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
    h('div', { class: 'mz-meta' }, netChip, h('span', { class: 'mz-chipstat', title: 'Joueurs en ligne' }, icon('users', 14), onlineV), h('span', { class: 'mz-chipstat mz-citychip', title: city.tagline || city.name }, icon('pin', 13), h('span', { text: city.name })), h('span', { class: 'mz-chipstat', title: `Heure à ${city.name}` }, hourIco, hourV)),
    h('div', { class: 'mz-tbtns' },
      h('button', { class: 'mz-iconbtn', type: 'button', 'aria-label': 'Téléphone', onclick: () => api.open('phone') }, icon('phone')),
      h('button', { class: 'mz-iconbtn', type: 'button', 'aria-label': 'Carte', onclick: () => api.open('map') }, icon('map')),
      h('button', { class: 'mz-iconbtn', type: 'button', 'aria-label': 'Chat', onclick: () => openChat() }, icon('chat'))));

  // Suivi de mission
  const mT = h('strong', { class: 'mz-mis-title' }), mS = h('span', { class: 'mz-mis-step' }), mPips = h('span', { class: 'mz-pips' });
  const mD = h('span', { class: 'mz-mis-d' }), mC = h('span', { class: 'mz-mis-c' });
  const tracker = h('div', { class: 'mz-mis', hidden: true },
    h('div', { class: 'mz-mis-head' }, h('span', { class: 'mz-eyebrow', text: 'Mission' }), mPips), mT, mS, h('div', { class: 'mz-mis-foot' }, mD, mC));
  let misT = -99, misPipsKey = '';
  bus.on('mission:update', (p) => {
    const m = p?.mission;
    if (!p || m === null || p.done) { tracker.hidden = true; return; }
    misT = ctx.time || 0; tracker.hidden = false;
    const title = (typeof m === 'object' ? m?.title : null) || store.mission?.title || 'Mission';
    if (mT.textContent !== title) mT.textContent = title;
    const txt = p.text || (typeof p.step === 'object' ? p.step?.label || p.step?.text : typeof p.step === 'string' ? p.step : '') || '';
    if (mS.textContent !== txt) mS.textContent = txt;
    const n = Number(p.stepCount ?? (typeof m === 'object' ? m?.steps?.length : 0)) || 0, i = Number(p.stepIndex ?? (typeof p.step === 'number' ? p.step : 0)) || 0;
    const key = `${i}/${n}`;
    if (key !== misPipsKey) { misPipsKey = key; mPips.replaceChildren(...(n > 1 && n <= 12 ? Array.from({ length: n }, (_, k) => h('i', { class: k < i ? 'is-done' : k === i ? 'is-on' : '' })) : [])); }
    let d = p.distance != null && isFinite(p.distance) && p.distance > 0 ? fmtDist(p.distance) : '';
    if (p.maxDamage) d += `${d ? ' · ' : ''}Dégâts ${Math.round(((p.damage || 0) / p.maxDamage) * 100)} %`;
    if (mD.textContent !== d) mD.textContent = d;
    const c = p.timeLeft != null && isFinite(p.timeLeft) ? fmtClock(p.timeLeft) : '';
    if (mC.textContent !== c) mC.textContent = c;
    mC.classList.toggle('is-low', p.timeLeft != null && p.timeLeft < 15);
  });

  // Minicarte, plaque de rue, GPS
  const plaqueT = h('span'), plaqueR = h('b', { hidden: true });
  const plaque = h('div', { class: 'mz-plaque', hidden: true }, h('div', { class: 'mz-plaque-in' }, plaqueR, plaqueT));
  const gpsT = h('span'), gpsD = h('b');
  const gpsChip = h('div', { class: 'mz-gps', hidden: true }, icon('pin', 14), gpsT, gpsD);
  const maps = createMaps(ctx, {
    isCompact,
    openMap: () => api.open('map'),
    open: (p, d) => api.open(p, d),
    close: () => api.close(),
    onGps: (g) => { gpsChip.hidden = !g; if (g) { gpsT.textContent = g.label; gpsD.textContent = ''; } },
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
    prK.hidden = !key; prK.textContent = key; prT.textContent = m && !p?.key ? m[2] : text;
    prompt.hidden = false;
  });

  // Toasts, bandeau, chat
  const toasts = h('div', { class: 'mz-toasts', role: 'status' });
  function toast(text, kind = 'info') {
    if (!text) return;
    const t = h('div', { class: `mz-toast is-${kind}` }, h('i'), h('span', { text }));
    toasts.appendChild(t);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 400); }, 4200);
  }
  bus.on('toast', (p) => toast(p?.text, p?.kind));
  const banner = h('div', { class: 'mz-banner', hidden: true });
  let bannerT = 0;
  bus.on('mission:result', (p) => {
    if (!p) return;
    tracker.hidden = true;
    const reasons = { timeout: 'Temps écoulé', time: 'Temps écoulé', abort: 'Mission abandonnée', aborted: 'Mission abandonnée', cooldown: 'Mission indisponible pour le moment', too_fast: 'Mission refusée par le serveur', crash: 'Véhicule détruit' };
    banner.className = 'mz-banner ' + (p.ok ? 'is-ok' : 'is-ko');
    banner.replaceChildren(
      h('span', { class: 'mz-eyebrow', text: p.ok ? 'Mission réussie' : 'Mission échouée' }),
      h('strong', { text: p.ok ? `+${zc(p.reward || 0)}` : reasons[p.reason] || p.reason || 'Réessayez' }));
    banner.hidden = false; clearTimeout(bannerT);
    bannerT = setTimeout(() => { banner.classList.add('is-out'); setTimeout(() => { banner.hidden = true; }, 500); }, 3800);
  });

  bus.on('gameplay:levelUp', (p) => {
    if (!p) return;
    banner.className = 'mz-banner is-ok';
    banner.replaceChildren(h('span', { class: 'mz-eyebrow', text: `Niveau ${p.level ?? ''}` }), h('strong', { text: p.title || 'Nouveau niveau' }));
    banner.hidden = false; clearTimeout(bannerT);
    bannerT = setTimeout(() => { banner.classList.add('is-out'); setTimeout(() => { banner.hidden = true; }, 500); }, 3800);
  });

  const feed = h('div', { class: 'mz-feed' });
  const chatIn = h('input', { class: 'mz-input', type: 'text', maxlength: '140', autocomplete: 'off', placeholder: 'Message… (Entrée pour envoyer)', 'aria-label': 'Message' });
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
    S.chat = true; chatBox.hidden = false; chat.classList.add('is-open'); capture();
    setTimeout(() => chatIn.focus(), 0);
  }
  function closeChat() { if (!S.chat) return; S.chat = false; chatBox.hidden = true; chat.classList.remove('is-open'); chatIn.value = ''; chatIn.blur(); capture(); }
  function sendChat() { const text = chatIn.value.trim().slice(0, 140); if (text) bus.emit('intent:chat', { text }); closeChat(); }

  const vignette = h('div', { class: 'mz-vignette' });
  bus.on('vehicle:crash', (p) => {
    if (!p || p.vehicle !== player().vehicle || !(p.impact > 4)) return;
    vignette.classList.remove('is-hit'); void vignette.offsetWidth; vignette.classList.add('is-hit');
  });

  const hud = h('div', { class: 'mz-hud' }, vignette, h('div', { class: 'mz-tl' }, tracker), tr, bl, chat, speedo, prompt, toasts, banner);
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
  const REASONS = { mission: 'Mission', rent: 'Loyers', income: 'Loyers', buyCar: 'Véhicule', car: 'Véhicule', buyProperty: 'Immobilier', property: 'Immobilier', sellProperty: 'Vente', transfer: 'Virement', transferIn: 'Virement reçu', transferOut: 'Virement envoyé', start: 'Capital de départ', fine: 'Amende', repair: 'Réparation' };
  const reasonLabel = (r) => REASONS[r] || String(r).slice(0, 28);

  function setNet(state) {
    S.net = state;
    shell.setNet(state);
    netChip.hidden = state === 'online' || (state === 'connecting' && !S.logged);
    netChip.className = 'mz-chipstat mz-netchip is-' + state;
    netChip.lastChild.textContent = state === 'offline' ? 'Hors ligne' : 'Reconnexion…';
  }
  bus.on('net:status', (p) => p?.state && setNet(p.state));

  // =====================================================================
  // Panneaux
  // =====================================================================
  const panels = createPanels(ctx, { maps, open: (p, d) => api.open(p, d), close: () => api.close(), netState: () => S.net, switchCity: (id) => shell.switchCity(id, store.room), inviteUrl: () => shell.inviteUrl(store.room), otherCities: shell.otherCities });
  ui.append(maps.bigEl, ...panels.els);

  const api = {
    update,
    open(panel, data) {
      if (S.welcome || !panel) return;
      if (S.chat) closeChat();
      if (S.panel === 'map') maps.closeBig();
      panels.hide();
      const p = panel === 'map' ? 'map' : panel === 'dealer' || panel === 'property' ? panel : 'phone';
      if (p === 'map') maps.openBig(); else panels.show(panel, data);
      S.panel = p; capture();
    },
    close() {
      if (S.chat) closeChat();
      if (S.panel == null) return;
      if (S.panel === 'map') maps.closeBig();
      panels.hide(); S.panel = null; capture();
      if (document.activeElement instanceof HTMLElement && ui.contains(document.activeElement)) document.activeElement.blur();
    },
    isOpen: () => S.welcome || S.panel != null || S.chat,
    toast,
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
  window.addEventListener('keydown', (e) => {
    if (S.welcome || !S.booted) return;
    const tg = e.target, typing = tg instanceof HTMLElement && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT');
    if (e.code === 'Escape') {
      e.preventDefault();
      if (S.chat) closeChat(); else if (S.panel) { S.toggleT = performance.now(); S.togglePanel = S.panel; api.close(); } else toggle('phone');
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
  let tHud = 0, tSlow = 0, tHalf = 0, lastHour = '', lastOnline = -1, lastPlaque = null, lastNight = null, lastGps = '';
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
    const live = S.panel == null;
    maps.update(dt, live);

    tHud += dt;
    if (tHud >= 1 / 15 && live) {
      tHud = 0;
      const p = player(), v = p.mode === 'vehicle' ? p.vehicle : null;
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
      if (!tracker.hidden && store.mission == null && (ctx.time || 0) - misT > 3) tracker.hidden = true;
    }
  }

  capture();
  return api;
}

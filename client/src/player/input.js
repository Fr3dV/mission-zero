// Entrées du joueur : clavier (AZERTY/QWERTY via event.code), souris (pointer lock), manette, tactile.
// Produit un état normalisé (input.state) et des événements sur fronts (input.on('vehicle' | 'interact' | 'camera' | ...)).
// M / T / Tab sont seulement signalés (jamais consommés) : c'est l'interface qui les gère.
// Contrat v6 : H = klaxon ('horn'), G = « Chiche ! » ('dare'), 1 à 4 = bulles express ('emote1'..'emote4') ;
// au tactile, bouton klaxon (appui court = klaxon, appui long = roue des quatre bulles).

const EDGE_KEYS = {
  KeyF: 'vehicle', KeyE: 'interact', KeyC: 'camera', KeyM: 'map', KeyT: 'chat', Tab: 'menu', Space: 'jump',
  KeyH: 'horn', KeyG: 'dare', Digit1: 'emote1', Digit2: 'emote2', Digit3: 'emote3', Digit4: 'emote4',
};
/** Textes des bulles express (k = 1..4), dans l'ordre du message réseau EMOTE. */
export const EMOTE_LABELS = ['Chiche ?', 'Bravo !', 'Oups…', 'Suis-moi'];
const HORN_HOLD_MS = 350; // appui long sur le bouton klaxon tactile : roue des bulles
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const DEAD = 0.16;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function createInput(ctx) {
  const { canvas } = ctx;
  const state = {
    moveX: 0, moveY: 0,       // déplacement à pied (−1..1, moveY > 0 = avant)
    lookDX: 0, lookDY: 0,     // rotation caméra accumulée pour la frame (pixels équivalents)
    zoom: 0,                  // molette (crans) pour la frame
    throttle: 0, brake: 0,    // 0..1
    steer: 0,                 // −1..1 (> 0 = droite), lissé au clavier
    handbrake: false, sprint: false, jump: false, lookBack: false,
  };
  const keys = new Set();
  const listeners = new Map();
  const pressed = new Set(); // actions déclenchées pendant la frame courante
  let lookX = 0, lookY = 0, wheel = 0, dragging = false, lastLookTime = -10;
  let steerKb = 0;
  let activity = 0; // compteur de gestes volontaires (touche, bouton, doigt, clic) : sert à interrompre un plan de caméra
  const forceTouch = ctx.params?.get?.('touch') === '1';
  const isTouch = forceTouch || (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches);
  const touch = { mx: 0, my: 0, gas: false, brake: false, jump: false };
  const padPrev = [];
  // Périphérique réellement utilisé en dernier ('kbd' | 'pad' | 'touch'), publié par input.device : il suit le dernier geste
  // (touche du clavier, bouton ou manche de la manette, doigt sur une commande ou sur l'écran), pas le matériel présent.
  let device = isTouch ? 'touch' : 'kbd';
  const padSeen = [];
  let padStick = false;

  const enabled = () => ctx.player?.enabled !== false && !ctx.ui?.isOpen?.();
  function fire(action) {
    activity++;
    pressed.add(action);
    const l = listeners.get(action);
    if (l) for (const fn of [...l]) { try { fn(); } catch (e) { console.error('[input]', action, e); } }
  }

  // ------------------------------------------------------------------ clavier
  function onKeyDown(e) {
    if (isEditable(e.target) || isEditable(document.activeElement)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const on = enabled();
    if (on && GAME_KEYS.has(e.code)) e.preventDefault(); // pas de défilement de page
    if (!e.repeat && !keys.has(e.code)) {
      keys.add(e.code);
      device = 'kbd';
      if (on) activity++;
      const action = EDGE_KEYS[e.code];
      // M / T / Tab : simple notification, l'interface écoute elle-même le clavier
      if (action && on) fire(action);
    }
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function clearKeys() { keys.clear(); dragging = false; }
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', clearKeys);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearKeys(); });

  // ------------------------------------------------------------------ souris
  const locked = () => document.pointerLockElement === canvas;
  function onMouseDown(e) {
    if (isTouch && e.pointerType === 'touch') return;
    if (!enabled()) return;
    dragging = true; activity++;
    if (!locked() && canvas.requestPointerLock) {
      try { const p = canvas.requestPointerLock(); if (p?.catch) p.catch(() => {}); } catch { /* refusé : on garde le glisser */ }
    }
  }
  function onMouseMove(e) {
    if (!(locked() || dragging) || !enabled()) return;
    lookX += e.movementX || 0; lookY += e.movementY || 0;
  }
  canvas?.addEventListener('mousedown', onMouseDown);
  addEventListener('mouseup', () => { dragging = false; });
  addEventListener('mousemove', onMouseMove);
  canvas?.addEventListener('wheel', (e) => { if (enabled()) wheel += Math.sign(e.deltaY); }, { passive: true });
  canvas?.addEventListener('contextmenu', (e) => e.preventDefault());

  // ------------------------------------------------------------------ tactile
  let touchUI = null, touchHidden = false;
  const lookTouches = new Map();
  if (isTouch && ctx.uiRoot) touchUI = buildTouchUI();
  if (canvas) {
    // glisser sur l'écran (hors commandes) = orienter la caméra
    canvas.addEventListener('touchstart', (e) => { device = 'touch'; for (const t of e.changedTouches) lookTouches.set(t.identifier, { x: t.clientX, y: t.clientY }); }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        const p = lookTouches.get(t.identifier); if (!p) continue;
        if (enabled()) { lookX += (t.clientX - p.x) * 1.6; lookY += (t.clientY - p.y) * 1.6; }
        p.x = t.clientX; p.y = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) lookTouches.delete(t.identifier); };
    canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);
  }

  function buildTouchUI() {
    const root = document.createElement('div');
    root.className = 'mzp-touch';
    const style = document.createElement('style');
    // Portrait (< 560 px) : le bouton réel du menu gamzu mesure 86 px de large (50 % ± 43 px, bande de 90 px en bas). Frein et
    // accélérateur se partagent la largeur restante à sa droite (50vw − 62 px, 3 px entre les deux) : à 390 px de large,
    // frein 240..303 et accélérateur 305..376 ; tailles d'origine (69 et 79 px hors tout) retrouvées dès 422 px de large.
    style.textContent = `
.mzp-touch{display:contents;pointer-events:none;user-select:none;-webkit-user-select:none;touch-action:none;font-family:system-ui,sans-serif}
.mzp-touch *{touch-action:none;-webkit-tap-highlight-color:transparent}
.mzp-joy{position:absolute;left:max(18px,env(safe-area-inset-left));bottom:max(22px,env(safe-area-inset-bottom));width:150px;height:150px;border-radius:50%;pointer-events:auto;
  background:radial-gradient(circle,rgba(255,255,255,.10) 0%,rgba(255,255,255,.05) 60%,rgba(255,255,255,.16) 100%);border:1.5px solid rgba(255,255,255,.28);backdrop-filter:blur(3px)}
.mzp-knob{position:absolute;left:50%;top:50%;width:62px;height:62px;margin:-31px;border-radius:50%;background:rgba(255,255,255,.55);box-shadow:0 2px 10px rgba(0,0,0,.35)}
.mzp-btns{position:absolute;right:max(16px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom));width:220px;height:220px}
.mzp-btn{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:50%;pointer-events:auto;color:#fff;font-weight:700;font-size:13px;letter-spacing:.02em;
  background:rgba(18,22,32,.5);border:1.5px solid rgba(255,255,255,.32);backdrop-filter:blur(3px);text-shadow:0 1px 2px rgba(0,0,0,.6)}
.mzp-btn.on{background:rgba(255,255,255,.42);transform:scale(.94)}
.mzp-btn svg{width:46%;height:46%;fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.mzp-gas{right:0;bottom:0;width:92px;height:92px;background:rgba(40,160,90,.5)}
.mzp-brake{right:104px;bottom:6px;width:72px;height:72px;background:rgba(190,50,50,.5)}
.mzp-jump{right:6px;bottom:104px;width:64px;height:64px}
.mzp-veh{right:84px;bottom:100px;width:60px;height:60px}
.mzp-act{right:158px;bottom:92px;width:56px;height:56px}
.mzp-horn{right:96px;bottom:166px;width:48px;height:48px;box-sizing:border-box;background:rgba(214,158,46,.5)}
.mzp-horn svg{width:54%;height:54%}
.mzp-wheel{position:absolute;left:0;top:0;width:0;height:0;display:none}
.mzp-wheel.on{display:block;animation:mzp-pop .12s ease-out}
@keyframes mzp-pop{from{opacity:0}to{opacity:1}}
.mzp-bub{position:absolute;width:88px;height:38px;margin:-19px 0 0 -44px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;border-radius:19px;pointer-events:auto;
  white-space:nowrap;color:#10141c;font-weight:800;font-size:14px;background:rgba(255,255,255,.93);border:2px solid rgba(12,16,24,.55);box-shadow:0 3px 12px rgba(0,0,0,.4)}
.mzp-bub.on{background:#ffd24a;border-color:#fff;transform:scale(1.1)}
@media (max-width:559px){
.mzp-joy{left:max(14px,env(safe-area-inset-left));width:132px;height:132px;box-sizing:border-box}
.mzp-knob{width:56px;height:56px;margin:-28px}
.mzp-btns{right:max(14px,env(safe-area-inset-right));width:152px;height:212px;
  --mzp-g:clamp(50px,calc((50vw - 62px)*.53),79px);--mzp-b:clamp(46px,calc((50vw - 62px)*.47),69px)}
.mzp-gas{right:0;bottom:0;width:var(--mzp-g);height:var(--mzp-g);box-sizing:border-box}
.mzp-brake{right:calc(var(--mzp-g) + 3px);bottom:4px;width:var(--mzp-b);height:var(--mzp-b);box-sizing:border-box}
.mzp-jump{right:6px;bottom:84px;width:62px;height:62px}
.mzp-veh{right:86px;bottom:80px;width:60px;height:60px}
.mzp-act{right:88px;bottom:148px;width:56px;height:56px}
.mzp-horn{right:13px;bottom:156px;width:48px;height:48px}
}
`;
    root.appendChild(style);
    // joystick virtuel
    const joy = document.createElement('div'); joy.className = 'mzp-joy';
    const knob = document.createElement('div'); knob.className = 'mzp-knob'; joy.appendChild(knob);
    let joyId = null, joyCx = 0, joyCy = 0, joyR = 46;
    const joyMove = (e) => {
      let x = (e.clientX - joyCx) / joyR, y = (e.clientY - joyCy) / joyR;
      const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      touch.mx = x; touch.my = -y;
      knob.style.transform = `translate(${x * joyR}px,${y * joyR}px)`;
    };
    const joyEnd = (e) => { if (e.pointerId !== joyId) return; joyId = null; touch.mx = touch.my = 0; knob.style.transform = ''; };
    joy.addEventListener('pointerdown', (e) => {
      // géométrie relevée une fois par appui (jamais pendant le glissement) : centre et course du pommeau (46 px en 150, 37 px en 132)
      const r = joy.getBoundingClientRect(); joyCx = r.left + r.width / 2; joyCy = r.top + r.height / 2; joyR = Math.max(20, r.width / 2 - 29);
      joyId = e.pointerId; activity++; device = 'touch'; try { joy.setPointerCapture?.(e.pointerId); } catch { /* pointeur synthétique */ } joyMove(e); e.preventDefault();
    });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
    joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
    root.appendChild(joy);
    // boutons
    const btns = document.createElement('div'); btns.className = 'mzp-btns';
    const ICON = {
      gas: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
      brake: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
      jump: '<svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7M5 20h14"/></svg>',
      veh: '<svg viewBox="0 0 24 24"><path d="M3 16v-3l2.5-5.5h13L21 13v3M3 16h18M7 16v2M17 16v2M6 12h12"/></svg>',
      act: '<svg viewBox="0 0 24 24"><path d="M8 12V6a1.6 1.6 0 013.2 0v5M11.2 10V4.6a1.6 1.6 0 013.2 0V11M14.4 7a1.6 1.6 0 013.2 0v8a6 6 0 01-11 3.2L4 14.5a1.6 1.6 0 012.6-1.8L8 14"/></svg>',
      horn: '<svg viewBox="0 0 24 24"><path d="M4 10v4h3l5 4V6L7 10H4zM16 9.5a3.5 3.5 0 010 5M18.5 7a7 7 0 010 10"/></svg>',
    };
    const mk = (cls, label, title, down, up) => {
      const b = document.createElement('div'); b.className = 'mzp-btn ' + cls; b.innerHTML = label; b.title = title; b.setAttribute('aria-label', title);
      b.addEventListener('pointerdown', (e) => { device = 'touch'; try { b.setPointerCapture?.(e.pointerId); } catch { /* pointeur synthétique */ } b.classList.add('on'); down?.(e); e.preventDefault(); });
      const rel = (e) => { b.classList.remove('on'); up?.(e); };
      b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel);
      btns.appendChild(b); return b;
    };
    mk('mzp-gas', ICON.gas, 'Accélérer / courir', () => { touch.gas = true; activity++; }, () => { touch.gas = false; });
    mk('mzp-brake', ICON.brake, 'Freiner / reculer', () => { touch.brake = true; activity++; }, () => { touch.brake = false; });
    mk('mzp-jump', ICON.jump, 'Saut / frein à main', () => { touch.jump = true; if (enabled()) fire('jump'); }, () => { touch.jump = false; });
    mk('mzp-veh', ICON.veh, 'Monter / descendre', () => { if (enabled()) fire('vehicle'); });
    mk('mzp-act', ICON.act, 'Interagir', () => { if (enabled()) fire('interact'); });
    // klaxon : appui court = klaxon ; appui long (350 ms) = roue des quatre bulles, on relâche sur une bulle pour l'envoyer
    const wheel = document.createElement('div'); wheel.className = 'mzp-wheel';
    const bubs = EMOTE_LABELS.map((txt, i) => {
      const el = document.createElement('div'); el.className = 'mzp-bub'; el.textContent = txt; el.dataset.k = String(i + 1);
      // relâchement directement sur la bulle (pointeur non capturé par le bouton)
      el.addEventListener('pointerup', (e) => { e.stopPropagation(); hornEnd(i + 1); });
      wheel.appendChild(el); return el;
    });
    // positions des bulles autour du centre du bouton (px) : en arche s'il y a la place à droite, sinon en arc à gauche (portrait)
    const ARCH = [[-84, 8], [-48, -52], [48, -52], [84, 8]], LEFT = [[-96, 30], [-100, -16], [-88, -62], [4, -74]];
    const bx = [0, 0, 0, 0], by = [0, 0, 0, 0];
    let hornTimer = 0, hornOpen = false, hornDown = false, hornPick = 0;
    function hornLayout() {
      // une seule lecture de géométrie par ouverture de la roue ; les bulles sont ramenées dans l'écran
      const r = hornBtn.getBoundingClientRect(), pr = ctx.uiRoot.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, off = cx + 84 + 48 <= pr.right ? ARCH : LEFT;
      for (let i = 0; i < 4; i++) {
        bx[i] = clamp(cx + off[i][0], pr.left + 46, pr.right - 46); by[i] = clamp(cy + off[i][1], pr.top + 22, pr.bottom - 22);
        bubs[i].style.left = (bx[i] - pr.left) + 'px'; bubs[i].style.top = (by[i] - pr.top) + 'px';
      }
    }
    /** Bulle désignée par le doigt (1..4), 0 s'il est resté sur le bouton ou trop loin. */
    function hornHit(x, y) {
      let best = 0, bd = 40 * 40;
      for (let i = 0; i < 4; i++) { const dx = (x - bx[i]) / 1.5, dy = y - by[i], d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i + 1; } }
      return best;
    }
    function hornMark(k) { if (k === hornPick) return; hornPick = k; for (let i = 0; i < 4; i++) bubs[i].classList.toggle('on', i + 1 === k); }
    function hornEnd(k) {
      if (!hornDown) return;
      hornDown = false; clearTimeout(hornTimer); hornBtn.classList.remove('on');
      const open = hornOpen;
      hornOpen = false; wheel.classList.remove('on'); hornMark(0);
      if (!enabled()) return;
      if (!open) fire('horn'); else if (k >= 1 && k <= 4) fire('emote' + k);
    }
    const hornBtn = mk('mzp-horn', ICON.horn, 'Klaxon (appui long : bulles)', () => {
      hornDown = true; hornOpen = false; activity++;
      clearTimeout(hornTimer);
      hornTimer = setTimeout(() => { if (!hornDown || !enabled()) return; hornOpen = true; hornLayout(); wheel.classList.add('on'); }, HORN_HOLD_MS);
    }, (e) => { if (e?.type === 'pointercancel') root.cancel(); else hornEnd(hornOpen ? hornHit(e.clientX, e.clientY) : 0); });
    hornBtn.addEventListener('pointermove', (e) => { if (hornOpen) hornMark(hornHit(e.clientX, e.clientY)); });
    root.appendChild(btns);
    root.appendChild(wheel);
    /** Menu ouvert pendant un appui : tout est relâché sans rien émettre. */
    root.cancel = () => { hornDown = false; hornOpen = false; clearTimeout(hornTimer); wheel.classList.remove('on'); hornMark(0); hornBtn.classList.remove('on'); };
    ctx.uiRoot.appendChild(root);
    return root;
  }

  // ------------------------------------------------------------------ manette
  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected && p.axes.length >= 2) { gp = p; break; }
    if (!gp) return null;
    const b = (i) => gp.buttons[i]?.value ?? 0;
    // manette « utilisée » : un bouton (ou une gâchette) vient d'être enfoncé, ou un manche vient de quitter le centre.
    // Sur front seulement : une manette posée, gâchette coincée, ne reprend pas la main à un joueur au clavier.
    let used = false;
    for (let i = 0, n = Math.min(gp.buttons.length, 20); i < n; i++) { const d = b(i) > 0.5; if (d && !padSeen[i]) used = true; padSeen[i] = d; }
    const stick = Math.max(Math.abs(gp.axes[0] || 0), Math.abs(gp.axes[1] || 0), Math.abs(gp.axes[2] || 0), Math.abs(gp.axes[3] || 0)) > 0.5;
    if (stick && !padStick) used = true;
    padStick = stick;
    if (used) device = 'pad';
    const edge = (i, action) => { const d = b(i) > 0.5; if (d && !padPrev[i] && enabled()) fire(action); padPrev[i] = d; };
    edge(3, 'vehicle');   // Y / triangle
    edge(2, 'interact');  // X / carré
    edge(4, 'camera');    // LB
    edge(0, 'jump');      // A / croix
    edge(12, 'horn');     // croix directionnelle, haut : klaxon
    return {
      mx: dz(gp.axes[0] || 0), my: -dz(gp.axes[1] || 0),
      lx: dz(gp.axes[2] || 0), ly: dz(gp.axes[3] || 0),
      throttle: b(7), brake: b(6), handbrake: b(0) > 0.5 || b(1) > 0.5,
      sprint: b(10) > 0.5 || b(1) > 0.5, jump: b(0) > 0.5, lookBack: b(5) > 0.5 || b(11) > 0.5,
    };
  }

  const k = (...codes) => codes.some((c) => keys.has(c));

  const input = {
    state, keys, isTouch,
    /** Périphérique utilisé en dernier : 'kbd' (clavier / souris), 'pad' (manette : X = interagir, Y = véhicule) ou 'touch' (commandes à l'écran). */
    get device() { return device; },
    get locked() { return locked(); },
    /** secondes écoulées depuis le dernier mouvement de caméra volontaire */
    get idleLook() { return (ctx.time || 0) - lastLookTime; },
    /** compteur qui avance à chaque geste volontaire du joueur (touche, bouton, manette, doigt, clic) */
    get activity() { return activity; },
    /** true si l'action a été déclenchée pendant cette frame */
    pressed: (action) => pressed.has(action),
    isDown: (code) => keys.has(code),
    on(action, fn) { if (!listeners.has(action)) listeners.set(action, new Set()); listeners.get(action).add(fn); return () => listeners.get(action).delete(fn); },
    /** Simule une action (tests, interface tactile externe). */
    trigger: fire,
    releasePointer() { if (locked()) document.exitPointerLock?.(); dragging = false; },
    /** À appeler en fin de frame : oublie les actions déclenchées. */
    endFrame() { pressed.clear(); },
    update(dt) {
      const on = enabled();
      if (!on) {
        if (locked()) document.exitPointerLock?.();
        // menu ouvert : tout est relâché (la direction revient doucement au centre)
        steerKb += (0 - steerKb) * Math.min(1, dt * 6);
        Object.assign(state, { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, zoom: 0, throttle: 0, brake: 0, steer: steerKb, handbrake: false, sprint: false, jump: false, lookBack: false });
        lookX = lookY = wheel = 0;
        if (touchUI && !touchHidden) { touchHidden = true; touchUI.style.display = 'none'; touchUI.cancel?.(); }
        pollGamepad();
        return;
      }
      if (touchUI && touchHidden) { touchHidden = false; touchUI.style.display = ''; }
      const gp = pollGamepad();
      // --- clavier
      const fwd = (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0);
      const side = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
      let mx = side, my = fwd;
      const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
      // direction progressive : braquage plus lent que le retour au centre
      const rate = side === 0 ? 5.5 : Math.sign(side) !== Math.sign(steerKb) && steerKb !== 0 ? 7.5 : 3.2;
      const d = side - steerKb;
      steerKb += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
      let throttle = Math.max(0, fwd), brake = Math.max(0, -fwd), steer = steerKb;
      let handbrake = k('Space'), sprint = k('ShiftLeft', 'ShiftRight'), jump = k('Space'), lookBack = k('KeyV', 'KeyB');
      let lx = lookX, ly = lookY;
      // --- manette
      if (gp) {
        if (Math.hypot(gp.mx, gp.my) > Math.hypot(mx, my)) { mx = gp.mx; my = gp.my; }
        if (Math.abs(gp.mx) > Math.abs(steer)) steer = gp.mx * Math.abs(gp.mx); // courbe douce
        throttle = Math.max(throttle, gp.throttle); brake = Math.max(brake, gp.brake);
        handbrake = handbrake || gp.handbrake; sprint = sprint || gp.sprint; jump = jump || gp.jump; lookBack = lookBack || gp.lookBack;
        lx += gp.lx * 900 * dt; ly += gp.ly * 600 * dt;
      }
      // --- tactile
      if (isTouch) {
        if (Math.hypot(touch.mx, touch.my) > Math.hypot(mx, my)) { mx = touch.mx; my = touch.my; }
        if (Math.abs(touch.mx) > Math.abs(steer)) steer = touch.mx;
        if (touch.gas) { throttle = 1; sprint = true; }
        if (touch.brake) brake = 1;
        if (Math.hypot(touch.mx, touch.my) > 0.92) sprint = true;
        handbrake = handbrake || touch.jump; jump = jump || touch.jump;
      }
      if (lx || ly) lastLookTime = ctx.time || 0;
      state.moveX = clamp(mx, -1, 1); state.moveY = clamp(my, -1, 1);
      state.lookDX = lx; state.lookDY = ly; state.zoom = wheel;
      state.throttle = clamp(throttle, 0, 1); state.brake = clamp(brake, 0, 1); state.steer = clamp(steer, -1, 1);
      state.handbrake = handbrake; state.sprint = sprint; state.jump = jump; state.lookBack = lookBack;
      lookX = lookY = wheel = 0;
    },
    destroy() {
      removeEventListener('keydown', onKeyDown); removeEventListener('keyup', onKeyUp); removeEventListener('blur', clearKeys);
      removeEventListener('mousemove', onMouseMove); canvas?.removeEventListener('mousedown', onMouseDown);
      touchUI?.remove();
    },
  };
  return input;
}

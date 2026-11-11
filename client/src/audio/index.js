// Audio : 100 % WebAudio procédural (oscillateurs, bruit filtré, enveloppes). Aucun fichier son.
// Contrat : ctx.audio = { update(dt), play(name, opts), setVolume(v) }.
// L'AudioContext est créé/repris au premier geste utilisateur. Volume maître : bus `audio:volume {value}`,
// mémorisé en localStorage. Sons de play() : door, start, crash, honk, coin, cash, spend, success, fail,
// toast, ui, click, step, bell, bird.   opts : { volume, x, z (position monde), pan, impact, kind }.
import { createEngineAudio, createTrafficVoices } from './engine.js';
import { createMusic } from './music.js';

const LS_KEY = 'mz.audio.volume';

export function createAudio(ctx) {
  const { bus, camera, params } = ctx;
  let ac = null, G = null; // G : graphe (créé au premier geste)
  let volume = 0.8;
  try { const v = parseFloat(localStorage.getItem(LS_KEY)); if (Number.isFinite(v)) volume = Math.min(1, Math.max(0, v)); } catch { /* stockage indisponible */ }
  let loggedIn = !!params?.get?.('autostart');
  let inVehicle = false, uiOpen = false;
  let stepAcc = 0, stepFoot = 0, birdT = 3, farT = 15, swellT = 0, lastBellHour = null;
  const right = { x: 1, z: 0 }, listener = { x: 0, z: 0 };

  // ---------- création du graphe ----------
  function makeNoise() {
    const len = ac.sampleRate * 2, mk = () => ac.createBuffer(1, len, ac.sampleRate);
    const white = mk(), brown = mk(), w = white.getChannelData(0), b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const x = Math.random() * 2 - 1; w[i] = x; last = (last + 0.02 * x) / 1.02; b[i] = last * 3.5; }
    // raccord de boucle sans clic pour le bruit brun
    for (let i = 0; i < 2000; i++) { const k = i / 2000; b[len - 2000 + i] = b[len - 2000 + i] * (1 - k) + b[i] * k; }
    return { white, brown };
  }
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ac = new AC({ latencyHint: 'interactive' }); } catch { ac = null; return; }
    const master = ac.createGain(); master.gain.value = volume;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(comp).connect(ac.destination);
    const mk = (v) => { const g = ac.createGain(); g.gain.value = v; g.connect(master); return g; };
    const sfx = mk(0.9), engineBus = mk(0.6), amb = mk(0.0), musicBus = mk(0.55);
    const noise = makeNoise();
    const loop = (buf, rate) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random()); return s; };
    const biq = (type, f, q) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; };
    // ambiance : rumeur grave + trafic lointain + pluie
    const rumble = ac.createGain(); rumble.gain.value = 0.5; loop(noise.brown, 0.7).connect(biq('lowpass', 170)).connect(rumble).connect(amb);
    const hum = ac.createGain(); hum.gain.value = 0.1; loop(noise.white, 0.6).connect(biq('bandpass', 620, 0.45)).connect(hum).connect(amb);
    const rainG = ac.createGain(); rainG.gain.value = 0;
    const rs = loop(noise.white, 1.0); const rhp = biq('highpass', 1400), rlp = biq('lowpass', 8500);
    rs.connect(rhp).connect(rlp).connect(rainG); loop(noise.brown, 1.6).connect(biq('bandpass', 420, 0.7)).connect(rainG); rainG.connect(master);
    G = {
      master, sfx, engineBus, amb, musicBus, noise, rumble, hum, rainG,
      engine: createEngineAudio(ac, engineBus, noise),
      traffic: createTrafficVoices(ac, engineBus, noise, ctx.quality === 'low' ? 3 : 4),
      music: createMusic(ac, musicBus),
    };
    if (ctx.player?.mode === 'vehicle' && ctx.player.vehicle) { inVehicle = true; G.engine.setVehicle(ctx.player.vehicle); }
    if (!loggedIn) G.music.start();
  }
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'gamepadconnected']) window.addEventListener(ev, init, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (!ac) return; if (document.hidden) ac.suspend().catch(() => {}); else ac.resume().catch(() => {}); });

  // ---------- briques de synthèse ----------
  // Sortie spatialisée simple : panoramique + atténuation selon la position monde.
  function outFor(opts, range = 120) {
    let pan = opts?.pan ?? 0, att = 1;
    if (opts && Number.isFinite(opts.x) && Number.isFinite(opts.z)) {
      const dx = opts.x - listener.x, dz = opts.z - listener.z, d = Math.hypot(dx, dz);
      att = Math.max(0, 1 - d / range) ** 1.6;
      pan = Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / Math.max(d, 5))) * 0.9;
    }
    const g = ac.createGain(); g.gain.value = att * (opts?.volume ?? 1);
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(G.sfx); } else g.connect(G.sfx);
    return g;
  }
  function tone(out, { type = 'sine', f, f2, t = 0, dur = 0.2, vol = 0.3, attack = 0.005, detune = 0 }) {
    const t0 = ac.currentTime + t, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur); o.detune.value = detune;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + dur + 0.03);
    return o;
  }
  function burst(out, { buf = 'white', type = 'lowpass', f = 1000, f2, q = 0.7, t = 0, dur = 0.2, vol = 0.3, attack = 0.003, rate = 1 }) {
    const t0 = ac.currentTime + t, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = G.noise[buf]; s.playbackRate.value = rate; fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t0); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
    s.connect(fl).connect(g).connect(out); s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.03);
  }

  // ---------- sons ponctuels ----------
  const SOUNDS = {
    click(o) { tone(outFor(o), { type: 'triangle', f: 1400, f2: 900, dur: 0.04, vol: 0.12 }); },
    ui(o) { const out = outFor(o); const open = o?.kind !== 'close'; burst(out, { type: 'bandpass', f: open ? 500 : 2200, f2: open ? 2400 : 450, q: 1.2, dur: 0.16, vol: 0.12 }); tone(out, { type: 'sine', f: open ? 660 : 520, f2: open ? 990 : 390, dur: 0.09, vol: 0.07, t: 0.02 }); },
    toast(o) {
      const out = outFor(o), k = o?.kind;
      if (k === 'error') { tone(out, { type: 'square', f: 196, dur: 0.16, vol: 0.07 }); tone(out, { type: 'square', f: 147, dur: 0.22, vol: 0.07, t: 0.12 }); }
      else if (k === 'success') { tone(out, { f: 880, dur: 0.12, vol: 0.1 }); tone(out, { f: 1320, dur: 0.2, vol: 0.1, t: 0.08 }); }
      else tone(out, { type: 'triangle', f: 1046, f2: 980, dur: 0.14, vol: 0.09 });
    },
    coin(o) { const out = outFor(o); tone(out, { type: 'square', f: 988, dur: 0.08, vol: 0.07 }); tone(out, { type: 'square', f: 1319, dur: 0.38, vol: 0.07, t: 0.075 }); tone(out, { f: 2637, dur: 0.3, vol: 0.03, t: 0.075 }); },
    cash(o) { // caisse enregistreuse : tiroir + clochette
      const out = outFor(o);
      burst(out, { type: 'bandpass', f: 3200, q: 2, dur: 0.07, vol: 0.2 }); burst(out, { type: 'bandpass', f: 5200, q: 3, dur: 0.25, vol: 0.1, t: 0.05 });
      for (const [f, t] of [[2093, 0.1], [2637, 0.16], [3136, 0.22]]) tone(out, { f, t, dur: 0.6, vol: 0.07 });
      tone(out, { f: 120, f2: 70, dur: 0.12, vol: 0.2, t: 0.02 });
    },
    spend(o) { const out = outFor(o); tone(out, { type: 'triangle', f: 520, f2: 330, dur: 0.16, vol: 0.09 }); burst(out, { type: 'highpass', f: 3000, dur: 0.05, vol: 0.04 }); },
    success(o) { const out = outFor(o); [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { tone(out, { type: 'triangle', f, t: i * 0.11, dur: i === 3 ? 0.9 : 0.25, vol: 0.14 }); tone(out, { f: f * 2, t: i * 0.11, dur: 0.3, vol: 0.04 }); }); tone(out, { type: 'triangle', f: 783.99, t: 0.33, dur: 0.9, vol: 0.08 }); tone(out, { type: 'triangle', f: 659.25, t: 0.33, dur: 0.9, vol: 0.08 }); },
    fail(o) { const out = outFor(o); [[392, 0], [349.2, 0.18], [311.1, 0.36], [233.1, 0.56]].forEach(([f, t], i) => tone(out, { type: 'sawtooth', f, f2: i === 3 ? f * 0.9 : undefined, t, dur: i === 3 ? 0.7 : 0.2, vol: 0.07 })); },
    door(o) { const out = outFor(o, 40); tone(out, { f: 130, f2: 55, dur: 0.14, vol: 0.5 }); burst(out, { type: 'lowpass', f: 900, f2: 200, dur: 0.1, vol: 0.35 }); burst(out, { type: 'bandpass', f: 2600, q: 3, dur: 0.03, vol: 0.12, t: 0.015 }); },
    start(o) { // démarreur thermique, ou carillon de mise sous tension pour un électrique
      const out = outFor(o, 40);
      if (o?.electric) { tone(out, { f: 660, dur: 0.25, vol: 0.06 }); tone(out, { f: 990, dur: 0.4, vol: 0.06, t: 0.12 }); return; }
      for (let i = 0; i < 6; i++) { tone(out, { type: 'sawtooth', f: 95 + i * 3, f2: 80, t: i * 0.075, dur: 0.07, vol: 0.12 }); burst(out, { type: 'bandpass', f: 1200, q: 2, t: i * 0.075, dur: 0.05, vol: 0.05 }); }
      burst(out, { buf: 'brown', type: 'lowpass', f: 600, f2: 150, t: 0.45, dur: 0.35, vol: 0.5 });
    },
    crash(o) {
      const k = Math.min(1, Math.max(0.15, (o?.impact ?? 6) / 16)), out = outFor(o, 150);
      tone(out, { f: 90, f2: 38, dur: 0.25 + 0.2 * k, vol: 0.5 * k });
      burst(out, { type: 'lowpass', f: 2500 + 3000 * k, f2: 180, dur: 0.25 + 0.4 * k, vol: 0.5 * k });
      for (let i = 0; i < 4; i++) tone(out, { type: 'square', f: 180 + Math.random() * 900, dur: 0.12 + Math.random() * 0.25, vol: 0.06 * k, t: Math.random() * 0.04, detune: Math.random() * 60 });
      if (k > 0.55) for (let i = 0; i < 7; i++) burst(out, { type: 'bandpass', f: 4000 + Math.random() * 5000, q: 9, t: 0.06 + Math.random() * 0.45, dur: 0.05 + Math.random() * 0.1, vol: 0.12 * k }); // verre
    },
    honk(o) {
      const out = outFor(o, 140), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.connect(out);
      const dur = o?.dur ?? (0.25 + Math.random() * 0.35), t0 = ac.currentTime, g = ac.createGain();
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.16, t0 + 0.015); g.gain.setValueAtTime(0.16, t0 + dur); g.gain.linearRampToValueAtTime(0, t0 + dur + 0.05); g.connect(lp);
      const base = o?.pitch ?? (390 + Math.random() * 60);
      for (const f of [base, base * 1.26]) { const os = ac.createOscillator(); os.type = 'sawtooth'; os.frequency.value = f; os.connect(g); os.start(t0); os.stop(t0 + dur + 0.08); }
    },
    step(o) { const out = outFor(o, 30), a = stepFoot ? 1 : 0.86; burst(out, { buf: 'brown', type: 'lowpass', f: 700 * a, f2: 160, dur: 0.07, vol: 0.5 * (o?.volume ?? 1) }); burst(out, { type: 'bandpass', f: (o?.wet ? 3800 : 1900) * a, q: 1.5, dur: o?.wet ? 0.08 : 0.025, vol: o?.wet ? 0.09 : 0.06 }); },
    bell(o) { // cloche lointaine : partiels inharmoniques
      const out = outFor({ pan: -0.3, ...o }), base = o?.pitch ?? 196;
      [[0.5, 0.25, 4], [1, 0.5, 3.2], [1.19, 0.3, 2.4], [1.5, 0.18, 1.8], [2, 0.22, 1.5], [2.74, 0.1, 1.0], [3.76, 0.06, 0.7]].forEach(([r, v, d]) => tone(out, { f: base * r, dur: d, vol: v * 0.09, attack: 0.004, t: o?.t ?? 0 }));
    },
    bird(o) {
      const out = outFor({ pan: Math.random() * 1.6 - 0.8, ...o }), n = 2 + Math.floor(Math.random() * 5), f0 = 2600 + Math.random() * 1800;
      let t = 0;
      for (let i = 0; i < n; i++) { const d = 0.05 + Math.random() * 0.08, up = Math.random() < 0.6; tone(out, { f: f0 * (up ? 0.85 : 1.15), f2: f0 * (up ? 1.2 : 0.8), t, dur: d, vol: 0.035, attack: 0.01 }); t += d + 0.03 + Math.random() * 0.06; }
    },
  };
  function play(name, opts) {
    if (!ac || !G || ac.state !== 'running') return false;
    const fn = SOUNDS[name]; if (!fn) return false;
    try { fn(opts || {}); } catch (e) { console.warn('[audio]', name, e); return false; }
    return true;
  }

  // ---------- événements ----------
  bus.on('audio:volume', (e) => api.setVolume(e?.value));
  bus.on('net:welcome', () => { loggedIn = true; G?.music.stop(); });
  bus.on('player:enterVehicle', (e) => {
    inVehicle = true; const v = e?.vehicle || ctx.player?.vehicle;
    if (!G) return;
    G.engine.setVehicle(v);
    play('door'); setTimeout(() => play('start', { electric: !!v?.spec?.electric }), 220);
  });
  bus.on('player:exitVehicle', () => { inVehicle = false; play('door'); });
  bus.on('vehicle:crash', (e) => {
    const v = e?.vehicle, mine = v && v === ctx.player?.vehicle;
    play('crash', { impact: e?.impact, x: mine ? undefined : v?.pos?.x, z: mine ? undefined : v?.pos?.z });
  });
  bus.on('traffic:honk', (e) => play('honk', e || {}));
  bus.on('money:change', (e) => { const d = e?.delta || 0; if (d > 0) play(d >= 1000 ? 'cash' : 'coin'); else if (d < 0) play('spend'); });
  bus.on('mission:result', (e) => play(e?.ok ? 'success' : 'fail'));
  bus.on('toast', (e) => play('toast', { kind: e?.kind }));
  bus.on('ui:open', () => { uiOpen = true; play('ui', { kind: 'open' }); });
  bus.on('ui:close', () => { uiOpen = false; play('ui', { kind: 'close' }); });
  bus.on('env:time', (e) => {
    // cloches lointaines à l'heure pile (pas au tout premier événement, ni la nuit profonde)
    if (!e || e.hour === lastBellHour) return;
    const first = lastBellHour === null; lastBellHour = e.hour;
    if (first || e.hour < 7 || e.hour > 22) return;
    const n = Math.min(4, ((e.hour + 11) % 12) + 1);
    for (let i = 0; i < n; i++) play('bell', { t: i * 1.7, volume: 0.5 });
  });

  // ---------- parcs (oiseaux) ----------
  const parks = (ctx.worldData?.parks || []).map((p) => {
    const pts = p.polygon || []; let x = 0, z = 0, r = 0;
    for (const q of pts) { x += q[0]; z += q[1]; } x /= pts.length || 1; z /= pts.length || 1;
    for (const q of pts) r = Math.max(r, Math.hypot(q[0] - x, q[1] - z));
    return { x, z, r };
  });
  function parkProximity() {
    let best = 0;
    for (const p of parks) { const d = Math.hypot(p.x - listener.x, p.z - listener.z) - p.r; best = Math.max(best, d < 0 ? 1 : Math.max(0, 1 - d / 80)); }
    return best;
  }

  const api = {
    get context() { return ac; },
    get ready() { return !!G; },
    get master() { return G?.master || null; },
    get engineState() { return G?.engine.state || null; },
    play,
    setVolume(v) {
      if (!Number.isFinite(+v)) return;
      volume = Math.min(1, Math.max(0, +v));
      try { localStorage.setItem(LS_KEY, String(volume)); } catch { /* ignoré */ }
      if (G) G.master.gain.setTargetAtTime(volume, ac.currentTime, 0.05);
    },
    getVolume() { return volume; },
    update(dt) {
      if (!ac || !G || ac.state !== 'running') return;
      const t = ac.currentTime;
      // auditeur = caméra
      listener.x = camera.position.x; listener.z = camera.position.z;
      const m = camera.matrixWorld.elements; const rl = Math.hypot(m[0], m[2]) || 1; right.x = m[0] / rl; right.z = m[2] / rl;
      const player = ctx.player, env = ctx.env;
      const veh = player?.mode === 'vehicle' ? player.vehicle : null;
      if (veh && (!inVehicle || G.engine.state.active === false)) { inVehicle = true; G.engine.setVehicle(veh); } // rattrapage si l'événement a été manqué
      if (!veh && inVehicle && player) inVehicle = false;
      G.engine.update(dt, !!veh);
      G.traffic.update(dt, ctx.vehicles?.list, listener, right, veh);

      // ambiance
      const night = env?.isNight?.() ? 1 : 0, rain = env?.rain ?? 0;
      const ambLevel = (loggedIn ? 1 : 0.25) * (night ? 0.4 : 0.9) * (veh ? 0.55 : 1);
      G.amb.gain.setTargetAtTime(ambLevel * 0.5, t, 0.6);
      G.rainG.gain.setTargetAtTime(rain * (veh ? 0.11 : 0.17), t, 0.5);
      swellT -= dt;
      if (swellT <= 0) { swellT = 1.5 + Math.random() * 3; G.hum.gain.setTargetAtTime(0.05 + Math.random() * 0.12, t, 1.2); }
      // pas à pied
      if (player && player.mode !== 'vehicle' && player.enabled !== false) {
        const sp = Math.abs(player.speed || 0);
        if (sp > 0.6) {
          stepAcc += dt * (1.5 + sp * 0.42);       // cadence ≈ 2 pas/s en marchant, 3,5 en courant
          if (stepAcc >= 1) { stepAcc = 0; stepFoot ^= 1; play('step', { volume: 0.5 + Math.min(0.5, sp / 12), wet: (env?.wetness ?? 0) > 0.4 }); }
        } else stepAcc = 0.6;
      }
      // oiseaux le jour (surtout près des parcs), bruits lointains
      if (loggedIn) {
        birdT -= dt;
        if (birdT <= 0) {
          const prox = parkProximity(); birdT = (prox > 0.2 ? 1.2 : 5) + Math.random() * (prox > 0.2 ? 4 : 12);
          if (!night && rain < 0.2 && !veh) play('bird', { volume: 0.35 + 0.65 * prox });
        }
        farT -= dt;
        if (farT <= 0) { farT = 18 + Math.random() * 35; if (!night || Math.random() < 0.3) play('honk', { volume: 0.05 + Math.random() * 0.05, pan: Math.random() * 1.6 - 0.8, dur: 0.15 + Math.random() * 0.3 }); }
      }
      G.music.update();
    },
  };
  return api;
}

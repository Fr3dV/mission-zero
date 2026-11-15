// Audio : 100 % WebAudio procédural (oscillateurs, bruit filtré, enveloppes). Aucun fichier son.
// Contrat : ctx.audio = { update(dt), play(name, opts), setVolume(v) }.
// L'AudioContext est créé/repris au premier geste utilisateur. Volume maître : bus `audio:volume {value}`,
// mémorisé en localStorage. Sons de play() : door, start, crash, wood, clang, thud, glass, clatter, honk, coin, cash,
// spend, success, fail, toast, ui, click, step, bell, bird, et (contrat v6) missionStart, checkpoint, photo, pickup,
// missionSuccess, missionFail, levelUp, tick, trick, whoosh, land, bank, bust, record, stamp, beep, go, whistle,
// coinrow, fanfare.   opts : { volume, x, z (position monde), pan, impact, kind, pitch (demi-tons pour tick, trick
// et beep ; Hz pour honk), t (retard en secondes, calé sur l'horloge audio), h (klaxon du catalogue), notes }.
// Qui joue quoi : les sons de mission viennent des appels directs du gameplay ; les fanfares de bandeau arrivent
// par ui:bannerShow {sound} ; le reste (style, képis, taxi, Chiche, klaxons, social) est branché ici sur le bus.
// Mise au point : ?audiolog=1 consigne chaque déclenchement dans window.__audiolog ({ name, t (ms, performance.now()
// de l'instant où le son démarre, retard compris), ok, et les options impact, pitch, pan, volume, kind, h }).
import * as CAT from '@shared/catalog.js';
import { createEngineAudio, createTrafficVoices, createSiren } from './engine.js';
import { createMusic } from './music.js';

const LS_KEY = 'mz.audio.volume';
const NONE = Object.freeze({});
const MUSIC_FADE = 8;        // s : fondu de la musique d'accueil à l'entrée en ville
const CASH_DELAY = 0.45;     // s : la caisse tombe après la fanfare de réussite, pas dessus
const HUSH_MS = 1000;        // ms sans bip de toast après un bandeau sonore ou une carte de fin
const TICK_MAX = 8;          // tics de style par seconde, au plus
const HONK_FAR_VOL = 0.55;   // plafond de volume du klaxon d'un ami (le sien reste à 1)
const SIREN_RANGE = 220;     // m : au-delà, la sirène des képis est inaudible
const HONK_RANGE = 140;      // m : portée du klaxon d'un ami (celle de outFor dans 'honk') ; au-delà, rien n'est synthétisé
const BLIP_RANGE = 120;      // m : portée de la bulle sonore d'un ami
const PAIR_MS = 80;          // ms : fenêtre d'appariement des deux vehicle:crash d'un même choc voiture contre voiture
const FICHE_DELAY_MS = 700;  // ms : la fiche du matin s'ouvre ce délai après l'entrée en ville (RETURN_DELAY de ui/index.js)…
const FICHE_SLACK_MS = 500;  // ms : … et on l'attend encore ce temps-là avant de relâcher les bips de toasts retenus
const EVENT_MS = 150;        // ms : un toast collé à un son d'événement ne bipe pas (le son a déjà parlé)
const EVENT_SND = { checkpoint: 1, photo: 1, pickup: 1, bank: 1, bust: 1 };
const JINGLES = { missionStart: 1, missionSuccess: 1, missionFail: 1, levelUp: 1, record: 1, fanfare: 1 };
const GO_CHORD = [466.16, 587.33, 698.46];

export function createAudio(ctx) {
  const { bus, camera, params } = ctx;
  let ac = null, G = null; // G : graphe (créé au premier geste)
  let volume = 0.8;
  try { const v = parseFloat(localStorage.getItem(LS_KEY)); if (Number.isFinite(v)) volume = Math.min(1, Math.max(0, v)); } catch { /* stockage indisponible */ }
  let loggedIn = !!params?.get?.('autostart');
  let inVehicle = false, uiOpen = false;
  let stepAcc = 0, stepFoot = 0, birdT = 3, farT = 15, swellT = 0, lastBellHour = null;
  const right = { x: 1, z: 0 }, listener = { x: 0, z: 0 };
  // journal de déclenchement (?audiolog=1) et instants des derniers sons (anti-empilement), en ms performance.now()
  const LOG = params?.get?.('audiolog') ? (window.__audiolog = []) : null;
  const lastAt = Object.create(null);
  let tOff = 0;                                            // retard (s) du son en cours de déclenchement : opts.t
  let lastImpactT = -1e9, lastImpactTag = '', lastImpactBroke = false, lastPropT = -1e9, lastPropTag = '';
  let hushUntil = 0, toastT = -1e9, blipT = -1e9, uiT = -1e9, bannerSndT = -1e9, deliveredT = -1e9;
  let successT = -1e9, cashWait = 0, jobPaidT = -1e9;
  let pairT = -1e9, pairA = null, pairB = null;            // dernier choc voiture contre voiture (premier événement de la paire)
  let eventT = -1e9;                                       // dernier son d'événement (voir EVENT_SND), en ms
  let holdUntil = 0, heldKind = null, welcomeT = 0;        // toasts retenus par la fiche du matin : Infinity tant qu'elle est ouverte
  const autoFiche = !params?.get?.('autostart') || params?.get?.('fiche') === '1'; // même règle que l'interface (ui/index.js)
  const tickT = new Float64Array(TICK_MAX).fill(-1e9); let tickI = 0, comboN = 0, lastMult = 1, whooshT = -1e9;
  const honkT = new Float64Array(3).fill(-1e9), hornEnd = new Map(); let honkI = 0, myHornEnd = 0;
  let wantedPrev = false, sirenVeh = null, sirenScan = 0, sirenPan = 0;
  let tlPrev = null, tlId = null, dareAt = 0, dareK = 0;
  const quiet = () => ctx.ui?.prefs?.quiet === true;      // préférence lue au moment de l'usage, jamais à l'init

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
    // raclement continu (tôle contre pierre) : bruit filtré, niveau piloté par vehicle.scrape
    const scrapeG = ac.createGain(); scrapeG.gain.value = 0;
    loop(noise.white, 0.8).connect(biq('bandpass', 2100, 1.3)).connect(scrapeG); loop(noise.brown, 2.2).connect(biq('bandpass', 620, 2)).connect(scrapeG); scrapeG.connect(sfx);
    G = {
      scrapeG,
      master, sfx, engineBus, amb, musicBus, noise, rumble, hum, rainG,
      engine: createEngineAudio(ac, engineBus, noise),
      traffic: createTrafficVoices(ac, engineBus, noise, ctx.quality === 'low' ? 3 : 4),
      music: createMusic(ac, musicBus),
      siren: createSiren(ac, sfx),
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
    const t0 = ac.currentTime + tOff + t, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur); o.detune.value = detune;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + dur + 0.03);
    return o;
  }
  function burst(out, { buf = 'white', type = 'lowpass', f = 1000, f2, q = 0.7, t = 0, dur = 0.2, vol = 0.3, attack = 0.003, rate = 1 }) {
    const t0 = ac.currentTime + tOff + t, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = G.noise[buf]; s.playbackRate.value = rate; fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t0); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
    s.connect(fl).connect(g).connect(out); s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.03);
  }

  const lowpass = (out, f) => { const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f; lp.connect(out); return lp; };
  // Note de trompe : dents de scie tenues (attaque franche, relâchement court), à brancher derrière un passe-bas.
  function hornNote(dest, t, freqs, dur, vol = 0.16) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.012); g.gain.setValueAtTime(vol, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.04); g.connect(dest);
    for (const f of freqs) { const os = ac.createOscillator(); os.type = 'sawtooth'; os.frequency.value = f; os.connect(g); os.start(t); os.stop(t + dur + 0.07); }
  }
  // Mélodie d'un klaxon signature : CAT.HORN_BY_ID[h].notes = [[fréquence Hz, durée s], …] (lot shared-contenu ;
  // table absente ou id inconnu => null, et l'appelant retombe sur le klaxon deux tons d'origine).
  const hornNotes = (o) => { const n = o?.notes || (o?.h != null ? (CAT.HORN_BY_ID || NONE)[o.h]?.notes : null); return Array.isArray(n) && n.length ? n : null; };
  function hornLen(h) { const n = hornNotes({ h }); if (!n) return 0.35; let d = 0; for (const x of n) d += +x?.[1] || 0; return Math.min(2.5, d); }
  const semi = (n) => 2 ** ((+n || 0) / 12);

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
    // ---- impacts (contrat « dégâts » v2) : bois, métal creux, choc sourd
    wood(o) { // tronc / banc qui craque : claquement sec + éclats
      const k = Math.min(1, Math.max(0.2, (o?.impact ?? 6) / 14)), out = outFor(o, 150);
      burst(out, { buf: 'brown', type: 'lowpass', f: 900, f2: 140, dur: 0.18 + 0.15 * k, vol: 0.6 * k });
      for (let i = 0; i < 5 + Math.round(6 * k); i++) burst(out, { type: 'bandpass', f: 350 + Math.random() * 1400, q: 5, t: Math.random() * (0.12 + 0.3 * k), dur: 0.02 + Math.random() * 0.05, vol: 0.28 * k });
      tone(out, { type: 'triangle', f: 160, f2: 70, dur: 0.2, vol: 0.3 * k });
    },
    clang(o) { // lampadaire, feu, poteau : métal creux qui résonne
      const k = Math.min(1, Math.max(0.2, (o?.impact ?? 6) / 14)), out = outFor(o, 170), base = 170 + Math.random() * 90;
      [[1, 0.5, 1.1], [2.76, 0.32, 0.8], [5.4, 0.2, 0.5], [8.93, 0.12, 0.3], [13.3, 0.06, 0.18]].forEach(([r, v, d]) => tone(out, { f: base * r, dur: d * (0.6 + 0.6 * k), vol: v * 0.22 * k, attack: 0.002 }));
      burst(out, { type: 'bandpass', f: 2400, q: 1.5, dur: 0.05, vol: 0.3 * k });
    },
    thud(o) { // choc mou et sourd (piéton) : volontairement discret
      const k = Math.min(1, Math.max(0.25, (o?.impact ?? 5) / 12)), out = outFor(o, 90);
      tone(out, { f: 85, f2: 42, dur: 0.16, vol: 0.4 * k });
      burst(out, { buf: 'brown', type: 'lowpass', f: 320, f2: 90, dur: 0.14, vol: 0.5 * k });
    },
    glass(o) { // verre brisé
      const k = Math.min(1, Math.max(0.3, (o?.impact ?? 10) / 20)), out = outFor(o, 150);
      burst(out, { type: 'highpass', f: 3500, dur: 0.12, vol: 0.25 * k });
      for (let i = 0; i < 10; i++) burst(out, { type: 'bandpass', f: 3500 + Math.random() * 6000, q: 10, t: 0.03 + Math.random() * 0.6, dur: 0.04 + Math.random() * 0.1, vol: 0.13 * k });
    },
    honk(o) { // opts.h (ou opts.notes) : mélodie du klaxon signature ; sinon le deux-tons d'origine
      const out = outFor(o, 140), lp = lowpass(out, 2400), t0 = ac.currentTime + tOff, notes = hornNotes(o);
      if (notes) {
        let t = 0;
        for (const n of notes) {
          const f = +n?.[0] || 0, d = +n?.[1] || 0;
          if (f > 0 && d > 0) hornNote(lp, t0 + t, notes.length === 1 ? [f, f * 1.26] : f < 200 ? [f, f * 1.007, f * 1.5] : [f, f * 1.007], Math.max(0.03, d - 0.05), f < 200 && notes.length > 1 ? 0.12 : 0.16); // une seule note : accord du deux-tons ; grave : quinte de corne de camion
          t += d; if (t > 2.5) break;
        }
        return;
      }
      const base = o?.pitch ?? (390 + Math.random() * 60);
      hornNote(lp, t0, [base, base * 1.26], o?.dur ?? (0.25 + Math.random() * 0.35));
    },
    step(o) { const out = outFor(o, 30), a = stepFoot ? 1 : 0.86; burst(out, { buf: 'brown', type: 'lowpass', f: 700 * a, f2: 160, dur: 0.07, vol: 0.5 * (o?.volume ?? 1) }); burst(out, { type: 'bandpass', f: (o?.wet ? 3800 : 1900) * a, q: 1.5, dur: o?.wet ? 0.08 : 0.025, vol: o?.wet ? 0.09 : 0.06 }); },
    bell(o) { // cloche lointaine : partiels inharmoniques
      const out = outFor({ pan: -0.3, ...o }), base = o?.pitch ?? 196;
      [[0.5, 0.25, 4], [1, 0.5, 3.2], [1.19, 0.3, 2.4], [1.5, 0.18, 1.8], [2, 0.22, 1.5], [2.74, 0.1, 1.0], [3.76, 0.06, 0.7]].forEach(([r, v, d]) => tone(out, { f: base * r, dur: d, vol: v * 0.09, attack: 0.004 }));
    },
    bird(o) {
      const out = outFor({ pan: Math.random() * 1.6 - 0.8, ...o }), n = 2 + Math.floor(Math.random() * 5), f0 = 2600 + Math.random() * 1800;
      let t = 0;
      for (let i = 0; i < n; i++) { const d = 0.05 + Math.random() * 0.08, up = Math.random() < 0.6; tone(out, { f: f0 * (up ? 0.85 : 1.15), f2: f0 * (up ? 1.2 : 0.8), t, dur: d, vol: 0.035, attack: 0.01 }); t += d + 0.03 + Math.random() * 0.06; }
    },
  };
  // ---- contrat v6 : missions (appels directs du gameplay), bandeaux, style, képis, taxi, Chiche
  Object.assign(SOUNDS, {
    clatter(o) { // table et chaises de terrasse qui valsent : tôle légère et bois sec
      const k = Math.min(1, Math.max(0.3, (o?.impact ?? 6) / 14)), out = outFor(o, 120);
      burst(out, { buf: 'brown', type: 'lowpass', f: 700, f2: 200, dur: 0.07, vol: 0.6 * k });
      for (let i = 0; i < 4; i++) { const t = Math.random() * 0.22; tone(out, { type: 'triangle', f: 900 + Math.random() * 2200, t, dur: 0.04 + Math.random() * 0.1, vol: 0.16 * k, attack: 0.002 }); burst(out, { type: 'bandpass', f: 2500 + Math.random() * 3000, q: 7, t, dur: 0.03 + Math.random() * 0.05, vol: 0.4 * k }); }
    },
    missionStart(o) { // motif montant : « c'est parti »
      const out = outFor(o);
      [[392, 0], [523.25, 0.09], [659.25, 0.18], [783.99, 0.27]].forEach(([f, t], i) => tone(out, { type: 'triangle', f, t, dur: i === 3 ? 0.5 : 0.14, vol: 0.12 }));
      tone(out, { f: 1567.98, t: 0.27, dur: 0.45, vol: 0.035 });
      burst(out, { type: 'bandpass', f: 500, f2: 3200, q: 1.2, dur: 0.3, vol: 0.05, attack: 0.1 });
    },
    checkpoint(o) { // ding d'étape : clochette à deux partiels
      const out = outFor(o);
      tone(out, { f: 1318.5, dur: 0.5, vol: 0.13, attack: 0.002 }); tone(out, { f: 1975.5, dur: 0.35, vol: 0.06, attack: 0.002 }); tone(out, { type: 'triangle', f: 659.25, dur: 0.18, vol: 0.06 });
    },
    photo(o) { // déclic d'obturateur : rideau, miroir, petit moteur d'entraînement
      const out = outFor(o);
      burst(out, { type: 'highpass', f: 2500, dur: 0.025, vol: 0.3 }); burst(out, { type: 'bandpass', f: 1400, q: 2, dur: 0.03, vol: 0.25, t: 0.07 });
      tone(out, { type: 'square', f: 180, dur: 0.03, vol: 0.06, t: 0.07 }); burst(out, { type: 'bandpass', f: 900, f2: 1800, q: 6, dur: 0.12, vol: 0.08, t: 0.11 });
    },
    pickup(o) { // scintillement du macaron : arpège cristallin
      const out = outFor(o);
      [1568, 2093, 2637, 3136, 4186].forEach((f, i) => tone(out, { f, t: i * 0.045, dur: 0.22 + i * 0.03, vol: 0.06, attack: 0.002 }));
      burst(out, { type: 'highpass', f: 6000, dur: 0.25, vol: 0.025, t: 0.05 });
    },
    missionSuccess(o) { // fanfare brève : la caisse ('cash') tombe 0,45 s plus tard, dans le trou qu'elle lui laisse
      const out = outFor(o);
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { tone(out, { type: 'triangle', f, t: i * 0.085, dur: i === 3 ? 0.8 : 0.16, vol: 0.14 }); tone(out, { f: f * 2, t: i * 0.085, dur: 0.22, vol: 0.035 }); });
      tone(out, { type: 'triangle', f: 783.99, t: 0.255, dur: 0.7, vol: 0.07 }); tone(out, { type: 'triangle', f: 659.25, t: 0.255, dur: 0.7, vol: 0.07 });
    },
    missionFail(o) { // « wah-wah » débonnaire : deux notes qui s'affaissent, jamais de buzzer
      const out = lowpass(outFor(o), 1500);
      tone(out, { type: 'sawtooth', f: 311.1, f2: 293.7, dur: 0.3, vol: 0.09, attack: 0.03 }); tone(out, { type: 'sawtooth', f: 277.2, f2: 261.6, t: 0.3, dur: 0.3, vol: 0.09, attack: 0.03 });
      tone(out, { type: 'sawtooth', f: 246.9, f2: 185, t: 0.6, dur: 0.75, vol: 0.1, attack: 0.03 }); tone(out, { type: 'triangle', f: 123.5, f2: 92.5, t: 0.6, dur: 0.75, vol: 0.08 });
    },
    levelUp(o) { // fanfare de niveau : appel de cuivres, accord tenu, pluie d'étoiles
      const dry = outFor(o), out = lowpass(dry, 2600);
      [[392, 0, 0.09], [392, 0.1, 0.09], [392, 0.2, 0.09], [523.25, 0.3, 0.24], [659.25, 0.54, 0.16], [783.99, 0.7, 1.1]].forEach(([f, t, dur]) => { tone(out, { type: 'sawtooth', f, t, dur, vol: 0.11, attack: 0.012 }); tone(out, { type: 'sawtooth', f: f * 1.005, t, dur, vol: 0.06, attack: 0.012 }); });
      tone(out, { type: 'sawtooth', f: 523.25, t: 0.7, dur: 1.1, vol: 0.07, attack: 0.02 }); tone(out, { type: 'sawtooth', f: 659.25, t: 0.7, dur: 1.1, vol: 0.07, attack: 0.02 }); tone(dry, { type: 'triangle', f: 130.8, t: 0.7, dur: 0.9, vol: 0.12 });
      [2093, 2637, 3136, 4186, 5274].forEach((f, i) => tone(dry, { f, t: 0.78 + i * 0.07, dur: 0.4, vol: 0.035, attack: 0.002 }));
    },
    fanfare(o) { // livraison d'une voiture neuve : jingle de concession, puis le démarreur (enchaîné par l'appelant)
      const dry = outFor(o), out = lowpass(dry, 3000);
      [[523.25, 0, 0.1], [659.25, 0.1, 0.1], [783.99, 0.2, 0.1], [1046.5, 0.3, 0.2], [880, 0.5, 0.1], [1046.5, 0.6, 0.8]].forEach(([f, t, dur]) => { tone(out, { type: 'sawtooth', f, t, dur, vol: 0.1, attack: 0.01 }); tone(out, { type: 'square', f: f / 2, t, dur, vol: 0.035, attack: 0.01 }); });
      tone(out, { type: 'sawtooth', f: 659.25, t: 0.6, dur: 0.8, vol: 0.06 }); tone(out, { type: 'sawtooth', f: 783.99, t: 0.6, dur: 0.8, vol: 0.06 });
      [2637, 3136, 4186].forEach((f, i) => tone(dry, { f, t: 0.66 + i * 0.08, dur: 0.45, vol: 0.03, attack: 0.002 }));
    },
    tick(o) { // tic de style : opts.pitch (demi-tons) le fait grimper avec le combo
      const out = outFor(o), f = 784 * semi(o?.pitch);
      tone(out, { type: 'triangle', f, dur: 0.055, vol: 0.11, attack: 0.002 }); tone(out, { f: f * 2, dur: 0.04, vol: 0.03, attack: 0.002 });
    },
    trick(o) { // figure qui compte (multiplicateur en hausse) : carillon à la quinte, hauteur selon opts.pitch (demi-tons)
      const out = outFor(o), f = 523.25 * semi(o?.pitch);
      tone(out, { type: 'triangle', f, dur: 0.13, vol: 0.11, attack: 0.003 }); tone(out, { f: f * 1.5, t: 0.055, dur: 0.24, vol: 0.09, attack: 0.003 }); tone(out, { f: f * 3, t: 0.055, dur: 0.14, vol: 0.025 });
    },
    whoosh(o) { // frôlement : souffle qui passe, à gauche ou à droite (opts.pan)
      const out = outFor(o);
      burst(out, { type: 'bandpass', f: 320, f2: 2400, q: 0.9, dur: 0.17, vol: 0.3, attack: 0.09 }); burst(out, { type: 'bandpass', f: 2400, f2: 300, q: 0.9, t: 0.14, dur: 0.32, vol: 0.28, attack: 0.02 });
      burst(out, { buf: 'brown', type: 'lowpass', f: 260, t: 0.08, dur: 0.25, vol: 0.2, attack: 0.05 });
    },
    land(o) { // réception d'un saut : pneus et suspension, selon opts.impact (vitesse verticale, m/s)
      const k = Math.min(1, Math.max(0.2, (o?.impact ?? 4) / 10)), out = outFor(o, 90);
      tone(out, { f: 72, f2: 38, dur: 0.16 + 0.1 * k, vol: 0.5 * k }); burst(out, { buf: 'brown', type: 'lowpass', f: 520, f2: 120, dur: 0.18, vol: 0.5 * k });
      burst(out, { type: 'bandpass', f: 1700, q: 6, t: 0.06, dur: 0.09, vol: 0.06 * k });
      if (k > 0.5) burst(out, { type: 'bandpass', f: 2600, q: 8, dur: 0.1, vol: 0.1 * k });
    },
    bank(o) { // combo encaissé : « ka-ching » léger (opts.record : quelques étincelles en plus)
      const out = outFor(o);
      burst(out, { type: 'bandpass', f: 3500, q: 2, dur: 0.05, vol: 0.15 }); tone(out, { type: 'square', f: 1568, dur: 0.09, vol: 0.05 });
      tone(out, { f: 2093, t: 0.07, dur: 0.5, vol: 0.09, attack: 0.002 }); tone(out, { f: 3136, t: 0.07, dur: 0.3, vol: 0.03, attack: 0.002 });
      if (o?.record) [2637, 3136, 4186].forEach((f, i) => tone(out, { f, t: 0.18 + i * 0.06, dur: 0.35, vol: 0.05, attack: 0.002 }));
    },
    bust(o) { // combo perdu : « oups », deux notes molles et un pneu qui se dégonfle
      const out = outFor(o);
      tone(out, { type: 'triangle', f: 392, f2: 277, dur: 0.2, vol: 0.11 }); tone(out, { type: 'triangle', f: 277, f2: 175, t: 0.18, dur: 0.36, vol: 0.11 });
      burst(out, { type: 'bandpass', f: 1800, f2: 500, q: 1, t: 0.05, dur: 0.4, vol: 0.05, attack: 0.03 });
    },
    record(o) { // record battu : cloche claire et pluie d'étoiles
      const out = outFor(o);
      [[1, 0.5, 1.6], [2, 0.25, 1.2], [2.76, 0.15, 0.8], [5.4, 0.06, 0.4]].forEach(([r, v, d]) => tone(out, { f: 880 * r, dur: d, vol: v * 0.26, attack: 0.002 }));
      [1760, 2217.5, 2637, 3520].forEach((f, i) => tone(out, { f, t: 0.12 + i * 0.07, dur: 0.4, vol: 0.04, attack: 0.002 }));
    },
    stamp(o) { // coup de tampon sur la fiche du matin
      const out = outFor(o);
      tone(out, { f: 115, f2: 48, dur: 0.12, vol: 0.45 }); burst(out, { buf: 'brown', type: 'lowpass', f: 750, f2: 150, dur: 0.1, vol: 0.4 });
      burst(out, { type: 'highpass', f: 3200, t: 0.012, dur: 0.05, vol: 0.06 }); burst(out, { type: 'bandpass', f: 1800, f2: 2600, q: 1.5, t: 0.16, dur: 0.12, vol: 0.03, attack: 0.04 });
    },
    beep(o) { // bip : compte à rebours par défaut ; kind 'chat', 'join' ou 'pop' pour les bips discrets du salon
      const out = outFor(o), k = o?.kind;
      if (k === 'chat') tone(out, { f: 1320, f2: 1480, dur: 0.08, vol: 0.1, attack: 0.004 });
      else if (k === 'join') { tone(out, { f: 880, dur: 0.1, vol: 0.09, attack: 0.004 }); tone(out, { f: 1320, t: 0.09, dur: 0.16, vol: 0.09, attack: 0.004 }); }
      else if (k === 'pop') { tone(out, { f: 480, f2: 960, dur: 0.07, vol: 0.14, attack: 0.003 }); burst(out, { type: 'bandpass', f: 1500, q: 2, dur: 0.02, vol: 0.06 }); }
      else { const f = 880 * semi(o?.pitch); tone(out, { type: 'square', f, dur: 0.1, vol: 0.05, attack: 0.002 }); tone(out, { f, dur: 0.13, vol: 0.1, attack: 0.002 }); }
    },
    go(o) { hornNote(lowpass(outFor(o), 2800), ac.currentTime + tOff, GO_CHORD, 0.6, 0.13); }, // top départ : corne à air, accord franc
    whistle(o) { // sifflet à roulette du képi : un coup bref, un coup long
      const out = outFor(o), t0 = ac.currentTime + tOff;
      for (let i = 0; i < 2; i++) {
        const t = t0 + i * 0.2, dur = i ? 0.42 : 0.14, os = ac.createOscillator(), lfo = ac.createOscillator(), dev = ac.createGain(), g = ac.createGain();
        os.frequency.setValueAtTime(2250, t); os.frequency.linearRampToValueAtTime(2420, t + 0.05); lfo.frequency.value = 31; dev.gain.value = 170; lfo.connect(dev).connect(os.frequency);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.11, t + 0.012); g.gain.setValueAtTime(0.11, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
        os.connect(g).connect(out); os.start(t); lfo.start(t); os.stop(t + dur + 0.06); lfo.stop(t + dur + 0.06);
        burst(out, { type: 'bandpass', f: 2400, q: 3, t: i * 0.2, dur: dur + 0.03, vol: 0.05, attack: 0.01 });
      }
    },
    coinrow(o) { // course payée : les pièces dégringolent une à une (opts.n), puis la clochette
      const out = outFor(o), n = Math.min(10, Math.max(3, Math.round(o?.n ?? 6)));
      for (let i = 0; i < n; i++) { const f = 1319 * semi((i % 5) * 2); tone(out, { type: 'square', f, t: i * 0.065, dur: 0.07, vol: 0.05 }); tone(out, { f: f * 2, t: i * 0.065, dur: 0.16, vol: 0.025 }); }
      tone(out, { f: 2637, t: n * 0.065, dur: 0.5, vol: 0.07, attack: 0.002 }); tone(out, { f: 3951, t: n * 0.065, dur: 0.3, vol: 0.025, attack: 0.002 });
    },
  });
  // opts.t = retard en secondes (calé sur l'horloge audio). Renvoie true si le son a réellement été lancé.
  function play(name, opts) {
    const fn = SOUNDS[name], now = performance.now(), d = Math.max(0, +(opts && opts.t) || 0);
    let ok = false;
    if (fn && ac && G && ac.state === 'running') {
      tOff = d;
      try { fn(opts || NONE); ok = true; } catch (e) { console.warn('[audio]', name, e); }
      tOff = 0;
    }
    if (LOG) { if (LOG.length >= 4000) LOG.splice(0, 2000); LOG.push({ name, t: now + d * 1000, ok, impact: opts?.impact, pitch: opts?.pitch, pan: opts?.pan, volume: opts?.volume, kind: opts?.kind, h: opts?.h }); }
    if (!fn) return false;
    lastAt[name] = now + d * 1000;
    // son d'événement : le toast du même fait se taira (klaxon mélodique non spatialisé = le mien ou l'essai au garage)
    if (EVENT_SND[name] || (name === 'honk' && opts?.h != null && !Number.isFinite(opts.x))) eventT = now + d * 1000;
    if (JINGLES[name]) hushUntil = Math.max(hushUntil, now + d * 1000 + HUSH_MS);
    if (name === 'missionSuccess') { successT = now; if (cashWait) { cashWait = 0; play('cash', { t: CASH_DELAY }); } }
    return ok;
  }

  // ---------- événements ----------
  bus.on('audio:volume', (e) => api.setVolume(e?.value));
  bus.on('net:welcome', () => { loggedIn = true; if (!welcomeT) welcomeT = performance.now(); G?.music.stop(MUSIC_FADE); }); // fondu de la musique d'accueil, pas de coupure
  bus.on('player:enterVehicle', (e) => {
    inVehicle = true; const v = e?.vehicle || ctx.player?.vehicle;
    if (!G) return;
    G.engine.setVehicle(v);
    play('door'); play('start', { t: 0.22, electric: !!v?.spec?.electric });
  });
  bus.on('player:exitVehicle', () => { inVehicle = false; play('door'); });

  // ---- chocs et décor
  const WOODY = { tree: 1, banc: 1, kiosque: 1 }, METAL = { lamp: 1, feu: 1, metro: 1, morris: 1 };
  bus.on('vehicle:crash', (e) => {
    const v = e?.vehicle, my = ctx.player?.vehicle, now = performance.now();
    let mine = !!v && v === my;
    // Choc voiture contre voiture : un vehicle:crash par véhicule dynamique, donc deux pour un seul choc. Le second de
    // la paire (mêmes voitures, rôles inversés, à moins de PAIR_MS) est muet ; le premier sonne « chez moi » dès que
    // ma voiture est l'une des deux. Si un seul des deux événements arrive (seuil, anti-rebond), c'est lui qui sonne.
    if (e?.kind === 'vehicle') {
      const other = e.other || null;
      if (other && now - pairT < PAIR_MS && v === pairB && other === pairA) { pairT = -1e9; pairA = pairB = null; return; }
      pairT = now; pairA = v || null; pairB = other;
      if (my && other === my) mine = true;
    }
    const o = { impact: e?.impact, x: mine ? undefined : (e?.x ?? v?.pos?.x), z: mine ? undefined : (e?.z ?? v?.pos?.z) };
    const tag = e?.tag || '', imp = e?.impact || 0;
    if (e?.kind === 'pedestrian') { play('thud', o); return; }
    // le décor qui vient de céder a déjà fait son bruit : world:propBroken part AVANT le vehicle:crash du même choc
    const dup = now - lastPropT < 120 && (!!e?.broke || tag === lastPropTag);
    if (WOODY[tag] || METAL[tag] || tag === 'terrasse') {
      if (!dup) play(WOODY[tag] ? 'wood' : METAL[tag] ? 'clang' : 'clatter', o);
      if (imp > 5 && !e?.broke) play('crash', { ...o, impact: imp * 0.5 });   // l'objet a tenu : la tôle sonne aussi ; s'il a cédé, le bois ou le métal a déjà tout dit
    } else play('crash', o);
    if (imp > 13) play('glass', o);
    // la fenêtre « ordre inverse » (vehicle:crash AVANT world:propBroken) n'est armée que si ce choc n'a pas déjà été apparié
    lastImpactT = now; lastImpactTag = tag; lastImpactBroke = !!e?.broke && !dup;
  });
  // Décor qui cède (module ville) : un son par objet, proportionné à l'énergie du choc (joules, ramenée à la vitesse
  // d'impact équivalente d'une voiture de 1 200 kg). Le doublon avec vehicle:crash est écarté dans les deux ordres.
  bus.on('world:propBroken', (e) => {
    const now = performance.now(), tag = e?.tag || '', kind = e?.kind || tag;
    if (now - lastImpactT < 120 && lastImpactBroke && lastImpactTag === tag) { lastImpactBroke = false; return; } // un choc ne consomme qu'un objet
    lastPropT = now; lastPropTag = tag;
    const imp = Number.isFinite(e?.energy) ? Math.min(30, Math.sqrt(Math.max(0, e.energy) / 600)) : 8;
    play(kind === 'terrasse' ? 'clatter' : WOODY[kind] || WOODY[tag] ? 'wood' : 'clang', { x: e?.x, z: e?.z, impact: imp });
  });
  bus.on('pedestrian:hit', (e) => play('thud', { x: e?.x, z: e?.z, impact: Math.min(12, (e?.speed ?? 4)) }));
  bus.on('vehicle:landed', (e) => { // réception d'un saut (toute voiture dynamique ; spatialisée si ce n'est pas la mienne)
    const v = e?.vehicle, imp = Number.isFinite(e?.landV) ? e.landV : 3 + 4 * (e?.airTime || 0);
    if (v && v === ctx.player?.vehicle) play('land', { impact: imp }); else if (v?.pos) play('land', { impact: imp, x: v.pos.x, z: v.pos.z, volume: 0.7 });
  });

  // ---- klaxons : trafic, le mien (klaxon signature de store.me.look.h), ceux des amis (spatialisés, bornés)
  bus.on('traffic:honk', (e) => play('honk', e || NONE));
  bus.on('player:horn', (e) => {
    const now = performance.now(); if (now < myHornEnd) return;       // la mélodie en cours va au bout
    const veh = e?.vehicle || (ctx.player?.mode === 'vehicle' ? ctx.player.vehicle : null);
    if (!veh) { myHornEnd = now + 200; play('honk', { pitch: 620, dur: 0.12, volume: 0.55 }); return; } // à pied : « pouet » de poche
    const h = ctx.store?.me?.look?.h;
    myHornEnd = now + Math.max(250, hornLen(h) * 1000 - 60);
    play('honk', { h, pitch: 415, dur: 0.3 });
  });
  bus.on('net:emote', (e) => {
    if (!e || quiet()) return;                                        // mode tranquille : ni klaxon ni bulle sonore
    const now = performance.now(), pos = Number.isFinite(e.x) && Number.isFinite(e.z);
    // hors de portée : rien n'est synthétisé, et ni les créneaux de klaxons ni l'anti-collage des bulles ne sont consommés
    const far = pos ? Math.hypot(e.x - listener.x, e.z - listener.z) : 0;
    if (far >= (e.k ? BLIP_RANGE : HONK_RANGE)) return;
    if (e.k) { if (now - blipT < 250) return; blipT = now; play('beep', pos ? { kind: 'pop', x: e.x, z: e.z } : { kind: 'pop', volume: 0.3 }); return; }
    if (now < (hornEnd.get(e.id) || 0) || now - honkT[honkI] < 1000) return; // pas deux mélodies superposées par ami, 3 klaxons d'amis par seconde au plus
    honkT[honkI] = now; honkI = (honkI + 1) % honkT.length;
    // ami à pied : le même « pouet » de poche que le mien (player:horn), jamais la mélodie de sa voiture
    const who = ctx.store?.players?.get?.(e.id);
    if (who && who.mode && who.mode !== 'vehicle') {
      hornEnd.set(e.id, now + 200);
      play('honk', pos ? { pitch: 620, dur: 0.12, x: e.x, z: e.z, volume: 0.4 } : { pitch: 620, dur: 0.12, volume: 0.2 });
      return;
    }
    hornEnd.set(e.id, now + hornLen(e.h) * 1000);
    play('honk', pos ? { h: e.h, x: e.x, z: e.z, volume: HONK_FAR_VOL, dur: 0.3 } : { h: e.h, volume: 0.2, dur: 0.3 });
  });
  bus.on('net:playerLeave', (e) => { hornEnd.delete(e?.id); });

  // ---- argent : la caisse d'une mission attend la fin de la fanfare, celle d'une course est jouée par job:result
  bus.on('money:change', (e) => {
    const d = e?.delta || 0, now = performance.now();
    if (d < 0) { play('spend'); return; }
    if (!(d > 0)) return;
    if (e.reason === 'course de taxi' || now - jobPaidT < 500) return;
    if (e.reason === 'mission') {
      const since = (now - successT) / 1000;
      if (since < CASH_DELAY) play('cash', { t: CASH_DELAY - since });  // fanfare lancée à l'instant : caisse à t0 + 0,45 s
      else if (since < 3) play('cash');
      else cashWait = now;                                              // fanfare pas encore partie : play('missionSuccess') ou update() tranchera
      return;
    }
    play(d >= 1000 ? 'cash' : 'coin');
  });
  bus.on('job:result', (e) => { if (!e?.ok) return; jobPaidT = performance.now(); play('coinrow', { n: 4 + Math.min(5, e.chain || 1) }); });

  // ---- interface : bandeaux sonores, carte de fin, toasts, panneaux
  bus.on('mission:end', (e) => {
    hushUntil = Math.max(hushUntil, performance.now() + HUSH_MS);
    if (e?.outcome === 'success' && e.rank === 1) play('record', { t: 1.0 });  // record de salle : la cloche, après la fanfare et la caisse
  });
  bus.on('ui:bannerShow', (e) => {
    const snd = e?.sound; if (typeof snd !== 'string' || !SOUNDS[snd]) return;
    const now = performance.now();
    hushUntil = Math.max(hushUntil, now + HUSH_MS);
    if (now - (lastAt[snd] ?? -1e9) < 400 || now - deliveredT < 1500) return;  // déjà joué par un appel direct, ou couvert par la fanfare de livraison
    bannerSndT = now; play(snd);
  });
  function toastBeep(kind, t = 0) {
    const now = performance.now();
    if (now < hushUntil || now - toastT < 150 || now - blipT < 150) return;    // pas de bip sur une fanfare, ni deux bips collés
    toastT = now; play('toast', t ? { kind, t } : { kind });
  }
  // Le bip est décidé en microtâche : le bus est synchrone, l'émetteur a donc fini son geste (toast PUIS son d'étape,
  // ou l'inverse) et l'on sait si un son d'événement ou une fanfare accompagne ce toast.
  bus.on('toast', (e) => {
    const kind = e?.kind, t0 = performance.now();
    queueMicrotask(() => {
      // fiche du matin attendue ou ouverte : l'interface retient ce toast (sauf une erreur), son bip attend avec lui
      if (kind !== 'error' && holdUntil && performance.now() < holdUntil) { heldKind = kind || 'info'; return; }
      if (Math.abs(t0 - eventT) < EVENT_MS) return;
      toastBeep(kind);
    });
  });
  // toasts retenus relâchés par l'interface (fiche fermée, autre panneau ouvert, fiche finalement pas ouverte) : un seul bip
  function releaseToasts(t) { const k = heldKind; heldKind = null; if (k) toastBeep(k, t); }
  // ui:open / ui:close sont des COMMANDES adressées à l'UI : seules ses notifications ui:opened / ui:closed font un son.
  const uiSound = (kind) => { const now = performance.now(); if (now - uiT < 90) return; uiT = now; play('ui', { kind }); };
  bus.on('ui:opened', (e) => {
    uiOpen = true; uiSound('open');
    if (e?.panel === 'return') { holdUntil = Infinity; play('stamp', { t: 0.2 }); }   // la fiche du matin est tamponnée quand elle apparaît
    else { if (holdUntil === Infinity) holdUntil = 0; releaseToasts(0.15); }
  });
  bus.on('ui:closed', () => { uiOpen = false; uiSound('close'); if (holdUntil === Infinity) holdUntil = 0; releaseToasts(0.15); });
  bus.on('gameplay:carDelivered', (e) => { // livraison en fanfare : jingle, puis le démarreur de la voiture neuve
    const now = performance.now();
    hushUntil = Math.max(hushUntil, now + HUSH_MS);
    if (now - bannerSndT > 600) play('fanfare');
    deliveredT = now;
    play('start', { t: 1.0, electric: !!e?.vehicle?.spec?.electric, volume: 0.7 });
  });
  // Fiche du matin : l'interface retient les toasts dès net:return (fiche en attente d'ouverture), puis tant que la
  // fiche est ouverte. Même condition et même délai d'ouverture que ui/index.js ; l'attente est bornée (voir update()).
  bus.on('net:return', (e) => {
    if (!e || e.reconnect || !autoFiche || holdUntil === Infinity) return;
    const now = performance.now(), wait = welcomeT ? Math.max(0, FICHE_DELAY_MS - (now - welcomeT)) : FICHE_DELAY_MS;
    if (e.fresh || Number(e.away?.rent) > 0 || (Array.isArray(e.feed) && e.feed.length)) holdUntil = now + wait + FICHE_SLACK_MS;
  });

  // ---- missions et activités : chrono, style, képis, Chiche
  bus.on('mission:update', (e) => { // trois bips quand le chrono passe sous 10 s
    const tl = e?.timeLeft, id = e?.mission?.id ?? null;
    if (!e?.mission || !Number.isFinite(tl)) { tlPrev = null; tlId = id; return; }
    if (id === tlId && tlPrev !== null && tlPrev > 10 && tl <= 10 && tl > 0) for (let i = 0; i < 3; i++) play('beep', { t: i * 0.22 });
    tlPrev = tl; tlId = id;
  });
  bus.on('style:trick', (e) => { // un tic par figure, plus aigu et plus discret à mesure que le combo s'allonge
    const now = performance.now(), mult = e?.mult || 1, up = mult > lastMult;
    comboN++; lastMult = mult;
    if (e?.kind === 'near' && now - whooshT > 180) { whooshT = now; play('whoosh', { pan: Math.max(-1, Math.min(1, +e.side || 0)) * 0.8 }); }
    if (now - tickT[tickI] < 1000) return;                             // plafond : TICK_MAX tics dans la seconde glissante
    tickT[tickI] = now; tickI = (tickI + 1) % TICK_MAX;
    const volume = Math.max(0.35, 1 - 0.04 * (comboN - 1));
    if (up) play('trick', { pitch: Math.min(14, (mult - 1) * 2), volume }); else play('tick', { pitch: Math.min(19, comboN - 1), volume });
  });
  bus.on('style:bank', (e) => { comboN = 0; lastMult = 1; play('bank', { record: !!e?.record, volume: Math.min(1, 0.55 + (e?.pts || 0) / 6000) }); });
  bus.on('style:bust', () => { comboN = 0; lastMult = 1; play('bust'); });
  bus.on('heat:change', (e) => { const w = !!e?.wanted; if (w && !wantedPrev) play('whistle'); wantedPrev = w; }); // coup de sifflet à l'entrée en poursuite
  bus.on('dare:state', (e) => { // Chiche : le compte à rebours est égrené dans update(), calé sur startAt (horloge performance.now())
    if (e?.mine && e.phase === 'run' && Number.isFinite(e.startAt)) { if (e.startAt !== dareAt && e.startAt > performance.now()) { dareAt = e.startAt; dareK = 99; } }
    else dareAt = 0;
  });
  bus.on('dare:end', () => { dareAt = 0; });

  // ---- salon : bips discrets (coupés en mode tranquille)
  function social(kind) {
    const now = performance.now();
    if (quiet() || now - blipT < 700 || now - toastT < 150) return;
    blipT = now; play('beep', { kind, volume: 0.6 });
  }
  bus.on('chat:message', (e) => {
    if (!e || e.system) return;
    const me = ctx.store?.me, from = typeof e.from === 'object' ? e.from?.name : e.from;
    if (me && (e.id != null ? e.id === me.id : from === me.name)) return;     // mon propre message
    social('chat');
  });
  bus.on('net:playerJoin', (e) => { if (e && e.id !== ctx.store?.me?.id) social('join'); });
  bus.on('env:time', (e) => {
    // cloches lointaines à l'heure pile (pas au tout premier événement, ni la nuit profonde)
    if (!e || e.hour === lastBellHour) return;
    const first = lastBellHour === null; lastBellHour = e.hour;
    if (first || e.hour < 7 || e.hour > 22) return;
    const n = Math.min(4, ((e.hour + 11) % 12) + 1);
    for (let i = 0; i < n; i++) play('bell', { t: i * 1.7, volume: 0.5 });
  });

  // unité de police la plus proche de l'auditeur (pour le panoramique de la sirène) ; appelé 3 fois par seconde au plus
  function nearestPolice() {
    const list = ctx.vehicles?.list; let best = null, bd = Infinity;
    if (list) for (const v of list) {
      if (!v || v.driver !== 'police' || !v.pos) continue;
      const dx = v.pos.x - listener.x, dz = v.pos.z - listener.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = v; }
    }
    return best;
  }

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
    get siren() { return G?.siren || null; },   // { gain (GainNode), pan (StereoPannerNode), level }
    get music() { return G?.music || null; },
    get buses() { return G ? { sfx: G.sfx, amb: G.amb, engine: G.engineBus, music: G.musicBus } : null; },   // pour les sondes (niveaux)
    get uiOpen() { return uiOpen; },
    get names() { return Object.keys(SOUNDS); },
    play,
    setVolume(v) {
      if (!Number.isFinite(+v)) return;
      volume = Math.min(1, Math.max(0, +v));
      try { localStorage.setItem(LS_KEY, String(volume)); } catch { /* ignoré */ }
      if (G) G.master.gain.setTargetAtTime(volume, ac.currentTime, 0.05);
    },
    getVolume() { return volume; },
    update(dt) {
      // caisse de mission restée en attente : la fanfare n'est pas venue, on encaisse quand même
      if (cashWait && performance.now() - cashWait > 250) { const late = performance.now() - cashWait > 2000; cashWait = 0; if (!late) play('cash'); }
      // la fiche du matin ne s'est pas ouverte (autre panneau déjà ouvert) : les toasts retenus sont déjà à l'écran
      if (holdUntil && holdUntil !== Infinity && performance.now() > holdUntil) { holdUntil = 0; releaseToasts(0); }
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
      G.scrapeG.gain.setTargetAtTime(veh && Number.isFinite(veh.scrape) ? Math.min(1, veh.scrape) * 0.3 : 0, t, 0.05);
      G.traffic.update(dt, ctx.vehicles?.list, listener, right, veh);

      // ambiance
      const night = env?.isNight?.() ? 1 : 0, rain = env?.rain ?? 0;
      const ambLevel = (loggedIn ? 1 : 0.25) * (night ? 0.4 : 0.9) * (veh ? 0.55 : 1);
      G.amb.gain.setTargetAtTime(ambLevel * 0.5, t, 0.6);
      G.rainG.gain.setTargetAtTime(rain * (veh ? 0.11 : 0.17), t, 0.5);
      swellT -= dt;
      if (swellT <= 0) { swellT = 1.5 + Math.random() * 3; G.hum.gain.setTargetAtTime(0.05 + Math.random() * 0.12, t, 1.2); }
      // sirène des képis : niveau selon la distance de l'unité (ctx.traffic.police.dist), panoramique selon sa position
      let siren = 0;
      if (ctx.store?.heat?.wanted) {
        const d = ctx.traffic?.police?.dist;
        if (d < SIREN_RANGE) {                         // faux pour undefined, NaN et Infinity (aucune unité)
          const k = 1 - Math.max(0, d - 15) / (SIREN_RANGE - 15); siren = 0.015 + 0.13 * k * k;
          sirenScan -= dt;
          if (sirenScan <= 0) { sirenScan = 0.3; sirenVeh = nearestPolice(); }
          if (sirenVeh?.pos) { const dx = sirenVeh.pos.x - listener.x, dz = sirenVeh.pos.z - listener.z; sirenPan = Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / Math.max(Math.hypot(dx, dz), 6))) * 0.85; } else sirenPan = 0;
        }
      } else if (sirenVeh) { sirenVeh = null; sirenScan = 0; }
      G.siren.set(siren, sirenPan, t);
      // Chiche : trois bips puis la corne de départ
      if (dareAt) {
        const left = dareAt - performance.now(), k = left > 0 ? Math.ceil(left / 1000) : 0;
        if (k !== dareK) { if (k === 0) { play('go'); dareAt = 0; } else if (k <= 3 && k < dareK) play('beep', { pitch: 0 }); dareK = k; }
      }
      // pas à pied (jamais en l'air : la vitesse horizontale est conservée pendant un saut)
      if (player && player.mode !== 'vehicle' && player.enabled !== false && player.grounded !== false) {
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

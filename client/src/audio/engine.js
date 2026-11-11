// Synthèse du moteur du véhicule du joueur (thermique ou électrique), roulement, vent, crissement,
// et voix simplifiées pour les véhicules proches. 100 % WebAudio procédural.

// Profils moteur : cylindres, régime de ralenti / rupteur, harmoniques (timbre), brillance, résonances d'échappement.
const PROFILES = {
  i4:    { cyl: 4,  idle: 850,  red: 6200, gears: 5, harm: [1, 0.55, 0.38, 0.22, 0.15, 0.1, 0.06, 0.04], sub: 0.35, rough: 0.5, bright: 2600, formants: [380, 1150], drive: 1.6, vol: 0.8 },
  flat6: { cyl: 6,  idle: 900,  red: 7400, gears: 7, harm: [1, 0.3, 0.62, 0.2, 0.34, 0.25, 0.14, 0.12, 0.08], sub: 0.55, rough: 0.75, bright: 3800, formants: [520, 1700], drive: 2.6, vol: 0.95 },
  v8:    { cyl: 8,  idle: 750,  red: 6800, gears: 8, harm: [1, 0.7, 0.4, 0.42, 0.2, 0.16, 0.1, 0.06], sub: 0.8, rough: 0.9, bright: 2800, formants: [300, 900], drive: 2.4, vol: 0.95 },
  v10:   { cyl: 10, idle: 1000, red: 8500, gears: 7, harm: [1, 0.5, 0.55, 0.42, 0.34, 0.3, 0.22, 0.18, 0.14, 0.1], sub: 0.4, rough: 0.6, bright: 5200, formants: [700, 2300], drive: 3.2, vol: 1.0 },
  v12:   { cyl: 12, idle: 950,  red: 8700, gears: 7, harm: [1, 0.6, 0.5, 0.48, 0.36, 0.3, 0.26, 0.2, 0.16, 0.12], sub: 0.5, rough: 0.5, bright: 5600, formants: [620, 2600], drive: 3.0, vol: 1.0 },
};
const TYPE_PROFILE = {
  citadine: 'i4', taxi: 'i4', porsche_911: 'flat6', porsche_cayenne: 'v8',
  lambo_huracan: 'v10', lambo_aventador: 'v12', lambo_urus: 'v8',
};
const GEAR_TOP = { 5: [0.2, 0.38, 0.58, 0.8, 1.02], 7: [0.14, 0.25, 0.38, 0.52, 0.68, 0.84, 1.02], 8: [0.12, 0.22, 0.33, 0.45, 0.58, 0.72, 0.87, 1.02] };

export function profileFor(vehicle) {
  const id = vehicle?.typeId || '';
  if (vehicle?.spec?.electric) return null;
  if (TYPE_PROFILE[id]) return PROFILES[TYPE_PROFILE[id]];
  if (/lambo|ferrari/.test(id)) return PROFILES.v10;
  if (/porsche/.test(id)) return PROFILES.flat6;
  return PROFILES.i4;
}

function driveCurve(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}
const set = (param, v, t, tc = 0.03) => param.setTargetAtTime(v, t, tc);

export function createEngineAudio(ac, out, noise) {
  const now = () => ac.currentTime;
  const loopNoise = (buf, rate = 1) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * buf.duration); return s; };

  // ---------- moteur thermique ----------
  const eng = ac.createGain(); eng.gain.value = 0; eng.connect(out);
  const oscMain = ac.createOscillator(), oscSub = ac.createOscillator(), oscCrank = ac.createOscillator();
  oscSub.type = 'sawtooth'; oscCrank.type = 'triangle';
  const gMain = ac.createGain(), gSub = ac.createGain(), gCrank = ac.createGain();
  const shaper = ac.createWaveShaper(); shaper.oversample = '2x';
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
  const f1 = ac.createBiquadFilter(); f1.type = 'peaking'; f1.Q.value = 1.6; f1.gain.value = 7;
  const f2 = ac.createBiquadFilter(); f2.type = 'peaking'; f2.Q.value = 2.0; f2.gain.value = 5;
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 35;
  oscMain.connect(gMain).connect(shaper); oscSub.connect(gSub).connect(shaper); oscCrank.connect(gCrank).connect(shaper);
  shaper.connect(lp).connect(f1).connect(f2).connect(hp).connect(eng);
  // bruit d'admission/échappement, modulé au rythme des explosions
  const nSrc = loopNoise(noise.white), nAM = ac.createGain(), nBP = ac.createBiquadFilter(), nGain = ac.createGain();
  nBP.type = 'bandpass'; nBP.Q.value = 0.9; nAM.gain.value = 0.5; nGain.gain.value = 0;
  const amDepth = ac.createGain(); amDepth.gain.value = 0.5; oscSub.connect(amDepth).connect(nAM.gain);
  nSrc.connect(nAM).connect(nBP).connect(nGain).connect(eng);
  oscMain.start(); oscSub.start(); oscCrank.start();

  // ---------- moteur électrique ----------
  const elec = ac.createGain(); elec.gain.value = 0; elec.connect(out);
  const e1 = ac.createOscillator(), e2 = ac.createOscillator(), e3 = ac.createOscillator();
  e1.type = 'sine'; e2.type = 'triangle'; e3.type = 'sawtooth';
  const ge1 = ac.createGain(), ge2 = ac.createGain(), ge3 = ac.createGain(), e3lp = ac.createBiquadFilter();
  e3lp.type = 'lowpass'; e3lp.frequency.value = 500; ge1.gain.value = 0.6; ge2.gain.value = 0.18; ge3.gain.value = 0;
  e1.connect(ge1).connect(elec); e2.connect(ge2).connect(elec); e3.connect(e3lp).connect(ge3).connect(elec);
  e1.start(); e2.start(); e3.start();

  // ---------- roulement, vent, pneus ----------
  const roll = ac.createGain(); roll.gain.value = 0; const rollLP = ac.createBiquadFilter(); rollLP.type = 'lowpass'; rollLP.frequency.value = 400;
  loopNoise(noise.brown, 1.0).connect(rollLP).connect(roll).connect(out);
  const wind = ac.createGain(); wind.gain.value = 0; const windBP = ac.createBiquadFilter(); windBP.type = 'bandpass'; windBP.frequency.value = 700; windBP.Q.value = 0.5;
  loopNoise(noise.white, 0.8).connect(windBP).connect(wind).connect(out);
  const skid = ac.createGain(); skid.gain.value = 0;
  const skA = ac.createBiquadFilter(); skA.type = 'bandpass'; skA.frequency.value = 1750; skA.Q.value = 9;
  const skB = ac.createBiquadFilter(); skB.type = 'bandpass'; skB.frequency.value = 2380; skB.Q.value = 12;
  const skSrc = loopNoise(noise.white, 1.1); skSrc.connect(skA).connect(skid); skSrc.connect(skB).connect(skid); skid.connect(out);
  const skLfo = ac.createOscillator(); skLfo.frequency.value = 5.3; const skLfoG = ac.createGain(); skLfoG.gain.value = 90; skLfo.connect(skLfoG); skLfoG.connect(skA.frequency); skLfoG.connect(skB.frequency); skLfo.start();

  // ---------- état ----------
  let vehicle = null, profile = null, electric = false, sporty = false;
  let rpm = 0, gear = 0, shiftT = 0, onLevel = 0, slipS = 0;
  const state = { rpm: 0, gear: 1, electric: false, active: false };

  function setVehicle(v) {
    vehicle = v; onLevel = 0; gear = 0; shiftT = 0;
    if (!v) return;
    profile = profileFor(v); electric = !profile;
    sporty = /taycan|plaid|models/.test(v.typeId || '');
    if (profile) {
      const n = profile.harm.length, re = new Float32Array(n + 1), im = new Float32Array(n + 1);
      for (let i = 0; i < n; i++) im[i + 1] = profile.harm[i] * (i % 2 ? -1 : 1);
      oscMain.setPeriodicWave(ac.createPeriodicWave(re, im));
      shaper.curve = driveCurve(profile.drive);
      f1.frequency.value = profile.formants[0]; f2.frequency.value = profile.formants[1];
      gSub.gain.value = profile.sub * 0.5; gCrank.gain.value = profile.rough * 0.25; gMain.gain.value = 0.6;
      rpm = profile.idle;
    }
  }

  function update(dt, inVehicle) {
    const t = now();
    const v = inVehicle ? vehicle : null;
    onLevel += ((v ? 1 : 0) - onLevel) * Math.min(1, dt * (v ? 2.5 : 6));
    state.active = !!v;
    if (!v && onLevel < 0.01) {
      set(eng.gain, 0, t, 0.05); set(elec.gain, 0, t, 0.05); set(roll.gain, 0, t, 0.1); set(wind.gain, 0, t, 0.1); set(skid.gain, 0, t, 0.05);
      return;
    }
    const veh = vehicle; if (!veh) return;
    const speed = Math.abs(veh.speed || 0), maxSpeed = veh.spec?.maxSpeed || 45;
    const c = veh.controls || {};
    const throttle = Math.min(1, Math.max(0, +c.throttle || 0));
    const s = Math.min(1.05, speed / maxSpeed);

    if (!electric) {
      const p = profile;
      let rpmTarget;
      if (Number.isFinite(veh.rpm) && veh.rpm > 0) { rpmTarget = p.idle + (p.red - p.idle) * Math.min(1, veh.rpm); /* vehicle.rpm est normalisé 0..1, gear est 1-based */ if (Number.isFinite(veh.gear)) gear = Math.max(0, veh.gear - 1); }
      else {
        // boîte simulée : rapports étagés sur la vitesse max
        const tops = GEAR_TOP[p.gears] || GEAR_TOP[5];
        let rn = s / tops[gear];
        if (rn > 0.93 && gear < tops.length - 1) { gear++; shiftT = 0.14; rn = s / tops[gear]; }
        else if (gear > 0 && s / tops[gear - 1] < (throttle > 0.7 ? 0.62 : 0.45)) { gear--; shiftT = 0.08; rn = s / tops[gear]; }
        if (gear === 0) rn = Math.max(rn, throttle * 0.32); // patinage de l'embrayage au démarrage
        rpmTarget = p.idle + (p.red - p.idle) * Math.min(1, rn);
      }
      shiftT = Math.max(0, shiftT - dt);
      rpm += (rpmTarget - rpm) * Math.min(1, dt * (shiftT > 0 ? 14 : 9));
      const jitter = 1 + (Math.random() - 0.5) * 0.012 * p.rough;
      const fire = (rpm / 60) * (p.cyl / 2) * jitter;      // fréquence d'allumage
      const rn = (rpm - p.idle) / (p.red - p.idle);
      const load = shiftT > 0 ? 0.1 : throttle;
      set(oscMain.frequency, fire, t, 0.02); set(oscSub.frequency, fire / 2, t, 0.02); set(oscCrank.frequency, rpm / 60, t, 0.02);
      set(lp.frequency, 260 + p.bright * (0.12 + 0.88 * rn) * (0.35 + 0.65 * load), t, 0.05);
      set(nBP.frequency, 500 + 2600 * rn, t, 0.05);
      set(nGain.gain, (0.03 + 0.22 * load) * (0.3 + rn), t, 0.05);
      set(eng.gain, onLevel * p.vol * (0.14 + 0.12 * rn + 0.2 * load) * (shiftT > 0 ? 0.6 : 1), t, 0.04);
      set(elec.gain, 0, t, 0.05);
      state.rpm = rpm; state.gear = gear + 1;
    } else {
      // sifflement d'onduleur/réducteur : hauteur proportionnelle à la vitesse, niveau à la charge
      const f = 110 + speed * 46;
      set(e1.frequency, f, t, 0.04); set(e2.frequency, f * 2.02 + 3, t, 0.04); set(e3.frequency, 60 + speed * 9, t, 0.04);
      set(ge3.gain, sporty ? 0.25 * throttle : 0.04, t, 0.08); set(e3lp.frequency, 300 + speed * 18, t, 0.08);
      const lvl = Math.min(1, speed / 4) * (0.012 + 0.05 * throttle) + (speed < 8 && speed > 0.3 ? 0.012 : 0); // + bourdonnement piéton à basse vitesse
      set(elec.gain, onLevel * lvl, t, 0.06);
      set(eng.gain, 0, t, 0.05);
      state.rpm = speed * 180; state.gear = 1;
    }
    state.electric = electric;

    // roulement / vent
    set(rollLP.frequency, 250 + speed * 22, t, 0.1);
    set(roll.gain, onLevel * Math.min(1, speed / 35) * 0.5, t, 0.1);
    set(windBP.frequency, 500 + speed * 14, t, 0.1);
    set(wind.gain, onLevel * Math.min(1, (speed / 70) ** 2) * 0.35, t, 0.1);
    // crissement
    let slip = 0;
    if (Number.isFinite(veh.slip)) slip = Math.min(1, Math.abs(veh.slip));
    else if (c.handbrake && speed > 5) slip = Math.min(1, speed / 18);
    else if ((+c.brake || 0) > 0.9 && speed > 16) slip = 0.25;
    else if (Math.abs(+c.steer || 0) > 0.85 && s > 0.6) slip = 0.2;
    slipS += (slip - slipS) * Math.min(1, dt * 10);
    set(skid.gain, onLevel * slipS * 0.5, t, 0.03);
    set(skA.frequency, 1500 + speed * 12, t, 0.1);
  }

  return { setVehicle, update, state, mute() { const t = now(); for (const g of [eng, elec, roll, wind, skid]) set(g.gain, 0, t, 0.02); } };
}

// Voix pour les autres véhicules proches (3–4 max) : grave + souffle, panoramique et atténuation.
export function createTrafficVoices(ac, out, noise, count = 4) {
  const voices = [];
  for (let i = 0; i < count; i++) {
    const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 60;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
    const og = ac.createGain(); og.gain.value = 0.5;
    const ns = ac.createBufferSource(); ns.buffer = noise.brown; ns.loop = true; ns.start(0, Math.random() * 2);
    const nlp = ac.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 900;
    const g = ac.createGain(); g.gain.value = 0;
    const pan = ac.createStereoPanner();
    osc.connect(lp).connect(og).connect(g); ns.connect(nlp).connect(g); g.connect(pan).connect(out); osc.start();
    voices.push({ osc, lp, og, nlp, g, pan, veh: null, lastD: 0 });
  }
  const RANGE = 65;
  const cand = [];
  return {
    voices,
    update(dt, list, listener, right, exclude) {
      const t = ac.currentTime;
      cand.length = 0;
      if (list) for (const v of list) {
        if (!v || v === exclude || !v.pos) continue;
        const dx = v.pos.x - listener.x, dz = v.pos.z - listener.z, d2 = dx * dx + dz * dz;
        if (d2 < RANGE * RANGE && Math.abs(v.speed || 0) > 0.8) cand.push({ v, d2 });
      }
      cand.sort((a, b) => a.d2 - b.d2); cand.length = Math.min(cand.length, voices.length);
      // garder les affectations existantes, libérer les autres
      for (const vo of voices) if (vo.veh && !cand.some((c) => c.v === vo.veh)) vo.veh = null;
      for (const c of cand) if (!voices.some((vo) => vo.veh === c.v)) { const free = voices.find((vo) => !vo.veh); if (free) { free.veh = c.v; free.lastD = Math.sqrt(c.d2); } }
      for (const vo of voices) {
        const v = vo.veh;
        if (!v) { vo.g.gain.setTargetAtTime(0, t, 0.15); continue; }
        const dx = v.pos.x - listener.x, dz = v.pos.z - listener.z, d = Math.hypot(dx, dz) || 0.01;
        const sp = Math.abs(v.speed || 0), el = !!v.spec?.electric;
        const radial = dt > 0 ? (d - vo.lastD) / dt : 0; vo.lastD = d;      // > 0 : s'éloigne
        const doppler = 1 - Math.max(-0.12, Math.min(0.12, radial / 160));
        const att = (1 - d / RANGE) ** 2;
        vo.osc.frequency.setTargetAtTime((48 + sp * 3.6) * doppler, t, 0.08);
        vo.lp.frequency.setTargetAtTime(220 + sp * 22, t, 0.1);
        vo.og.gain.setTargetAtTime(el ? 0.03 : 0.42, t, 0.1);
        vo.nlp.frequency.setTargetAtTime((500 + sp * 45) * doppler, t, 0.1);
        vo.g.gain.setTargetAtTime(att * (0.12 + Math.min(1, sp / 25) * 0.4), t, 0.1);
        vo.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / Math.max(d, 4))) * 0.85, t, 0.08);
      }
    },
  };
}

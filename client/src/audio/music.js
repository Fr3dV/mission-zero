// Bonus : courte boucle générative façon jazz manouche / accordéon (100 % synthétique, aucune œuvre existante).
// Jouée dans les menus (avant la connexion). Planification par anticipation depuis update().
const A2 = 110;
const st = (n) => A2 * 2 ** (n / 12);
// grille en la mineur : Am6 | Am6 | Dm6 | Dm6 | E7 | E7 | Am6 | E7
const CHORDS = {
  Am6: { root: 0, notes: [12, 15, 19, 21] }, Dm6: { root: 5, notes: [12 + 5, 15 + 5, 19 + 5 - 12, 21 + 5 - 12] }, E7: { root: 7, notes: [11, 14, 16, 20] },
};
const GRID = ['Am6', 'Am6', 'Dm6', 'Dm6', 'E7', 'E7', 'Am6', 'E7'];
const SCALE = [0, 2, 3, 5, 7, 8, 11]; // la mineur harmonique

export function createMusic(ac, out) {
  const bus = ac.createGain(); bus.gain.value = 0; bus.connect(out);
  const BEAT = 60 / 188;
  let playing = false, nextT = 0, beat = 0, deg = 7, rest = 0;

  function pluck(t, f, vol, dur) {
    const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.Q.value = 1;
    lp.frequency.setValueAtTime(Math.min(6000, f * 6), t); lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.2), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(lp).connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.02);
  }
  function accordion(t, f, vol, dur) {
    const g = ac.createGain(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.03); g.gain.setValueAtTime(vol, t + dur - 0.04); g.gain.linearRampToValueAtTime(0, t + dur);
    for (const [type, det, k] of [['sawtooth', -7, 0.5], ['sawtooth', 8, 0.5], ['square', 0, 0.22]]) {
      const o = ac.createOscillator(), og = ac.createGain(); o.type = type; o.frequency.value = f; o.detune.value = det; og.gain.value = k;
      o.connect(og).connect(lp); o.start(t); o.stop(t + dur + 0.02);
    }
    lp.connect(g).connect(bus);
  }
  function scheduleBeat(t, b) {
    const bar = Math.floor(b / 4) % GRID.length, inBar = b % 4, ch = CHORDS[GRID[bar]];
    // la pompe : basse sur 1 et 3, accord sec sur 2 et 4 (plus doux sur 1 et 3)
    if (inBar === 0) pluck(t, st(ch.root - 12), 0.5, 0.5);
    if (inBar === 2) pluck(t, st(ch.root - 12 + 7 - (ch.root + 7 > 12 ? 12 : 0)), 0.42, 0.45);
    const strong = inBar % 2 === 1;
    ch.notes.forEach((n, i) => pluck(t + i * 0.006, st(n), strong ? 0.13 : 0.06, strong ? 0.11 : 0.2));
    // mélodie d'accordéon : marche aléatoire en croches swinguées, attirée par les notes de l'accord
    for (let k = 0; k < 2; k++) {
      const tt = t + (k ? BEAT * 0.62 : 0);
      if (rest > 0) { rest--; continue; }
      if (Math.random() < 0.14) { rest = 1 + Math.floor(Math.random() * 3); continue; }
      deg += [-2, -1, -1, 1, 1, 2, 3, -3][Math.floor(Math.random() * 8)];
      deg = Math.max(3, Math.min(17, deg));
      let semi = SCALE[deg % 7] + 12 * Math.floor(deg / 7);
      if (k === 0 && inBar === 0) { // temps fort : note de l'accord la plus proche
        let best = semi, bd = 99;
        for (const n of ch.notes) for (const o of [0, 12, 24]) { const d = Math.abs(n + o - semi); if (d < bd) { bd = d; best = n + o; } }
        semi = best;
      }
      const long = Math.random() < 0.2;
      accordion(tt, st(semi + 12), 0.11, BEAT * (long ? 0.95 : 0.36));
      if (long) rest = 1;
    }
  }
  return {
    get playing() { return playing; },
    start() { if (playing) return; playing = true; nextT = ac.currentTime + 0.1; beat = 0; bus.gain.cancelScheduledValues(ac.currentTime); bus.gain.setTargetAtTime(0.5, ac.currentTime, 0.3); },
    stop() { if (!playing) return; playing = false; bus.gain.setTargetAtTime(0, ac.currentTime, 0.5); },
    update() {
      if (!playing) return;
      if (nextT < ac.currentTime - 0.5) nextT = ac.currentTime + 0.05; // onglet resté en arrière-plan
      while (nextT < ac.currentTime + 0.25) { scheduleBeat(nextT, beat++); nextT += BEAT; }
    },
  };
}

// Style : chaque geste de conduite compte. Agrège les figures du joueur LOCAL (dérive, frôlement, saut, objet
// fauché, esquive, pointe, emprunt, cavale) en combos : les points s'empilent, le multiplicateur vaut le nombre de
// types de figures différents, et le tout est encaissé après 6 s sans figure — ou perdu sur un gros choc, un piéton
// renversé ou un contrôle de police. Aucun argent ici : le style nourrit les défis, les records et le combo du jour
// (rapport agrégé `intent:style`, validé et rogné par le serveur).
//
// Sources (contrat v6, « Bus — style ») — toutes facultatives : une source absente et la figure correspondante
// n'existe simplement pas.
//   lus chaque image sur le véhicule du joueur : vehicle.driftAngle (rad, lissé, 0 sous 3 m/s), vehicle.airborne ;
//   événements : vehicle:landed, traffic:nearMiss, pedestrian:dodge, world:propBroken, vehicle:carjack (figures),
//                vehicle:crash, pedestrian:hit (perte du combo).
// Règle d'attribution commune : un événement ne compte que si e.vehicle === ctx.player.vehicle ET que le joueur
// conduit (vehicle:carjack : e.by === 'local'). Jamais de rayon autour du joueur, jamais de lecture de v.slip seul
// (une voiture calée gaz à fond contre un mur patine sans bouger : driftAngle y vaut 0).
//
// Sorties : style:trick {kind, label, pts, n, mult, total, gain, side?} — n = occurrences de ce type dans le combo ;
// pts = points de la LIGNE affichée : le cumul des n occurrences (« Strike de terrasse ×5 +140 »), ou pour une dérive
// ses points jusqu'ici (« Dérive 2,4 s +310 ») ; gain = points de cette seule occurrence, répétition et bonus compris ;
// total = somme du combo avant multiplicateur. style:combo {total, mult, left, max, active} (10 Hz au plus, objet
// RÉUTILISÉ : ne pas le garder ; max = durée totale de la fenêtre d'encaissement, en secondes) ; style:bank {pts, mult, tricks, record, best} (pts = total × multiplicateur) ;
// style:bust {lost, why} ; intent:style {pts, combo, drift, air, near, props} (envoyé seulement au volant : le serveur
// l'ignore à pied) ; store.style {total, mult, left, max, best} modifié en place.

// ---- barème (tout l'équilibrage du style est ici) ----
const DRIFT_ANGLE = 0.25;       // rad : |driftAngle| au-delà duquel la voiture dérive…
const DRIFT_SPEED = 8;          // …à condition de rouler à plus de 8 m/s
const DRIFT_RATE = 160;         // points par seconde de dérive…
const DRIFT_REF = 20;           // …à 20 m/s ; proportionnel à la vitesse…
const DRIFT_K_MIN = 0.5, DRIFT_K_MAX = 2; // …entre ×0,5 et ×2
const DRIFT_MIN_SEC = 0.5;      // en deçà ce n'est qu'un coup de volant : pas de figure
const DRIFT_GRACE = 0.3;        // s : la dérive survit à un bref passage sous les seuils (changement d'appui)
const DRIFT_TICK = 0.5;         // s : rythme de mise à jour de la ligne « Dérive 2,4 s » pendant la dérive
const NEAR_PTS = 250;           // frôlement
const AIR_BASE = 150, AIR_RATE = 400; // saut : 150 + 400 par seconde de vol
const AIR_MIN = 0.25, AIR_MAX = 6;    // durée de vol comptée (s) : seuil de vehicle:landed, plafond du serveur
const PROP_PTS = 60, TERRACE_PTS = 40; // objet fauché (mobilier de terrasse : 40)
const DODGE_PTS = 150;          // piéton esquivé de justesse
const SPEED_PTS = 200;          // pointe…
const SPEED_K = 0.9, SPEED_SEC = 2;   // …plus de 90 % de spec.maxSpeed pendant 2 s
const SPEED_REARM = 0.8;        // nouvelle pointe seulement après être repassé sous 80 %
const JACK_PTS = 300;           // emprunt d'une voiture
const REPEAT_STEP = 0.15, REPEAT_MIN = 0.3; // répétition d'un même type dans un combo : −15 % par occurrence, plancher 30 %
const MULT_MAX = 8;             // multiplicateur = nombre de types distincts (1..8)
const CHASE_BONUS = 1.5;        // +50 % sur toute figure pendant une poursuite
const BANK_SEC = 6;             // encaissement après 6 s sans figure (publié dans style:combo.max et store.style.max)
const BUST_IMPACT = 9;          // m/s : choc NON cassant au-delà duquel le combo est perdu
const REPORT_SEC = 20;          // intent:style au plus toutes les 20 s (et seulement après un encaissement)
const REPORT_DRIVE = 1;         // …et au volant depuis 1 s : le serveur refuse un rapport tant qu'il nous voit à pied
const COMBO_DT = 0.1;           // style:combo à 10 Hz au plus
const RECORD_MIN = 1000;        // en deçà, un encaissement n'est jamais annoncé comme un record

const KINDS = ['drift', 'near', 'air', 'prop', 'dodge', 'speed', 'jack', 'cavale'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sec1 = (s) => (Math.round(s * 10) / 10).toFixed(1).replace('.', ',');

export function createStyle(g) {
  const { ctx, bus, store } = g;
  const st = store.style || (store.style = { total: 0, mult: 1, left: 0, max: BANK_SEC, best: 0 }); // modifié en place
  st.max = BANK_SEC;

  // combo en cours
  const count = {}, sum = {}; // par type dans le combo : occurrences, points cumulés
  for (const k of KINDS) { count[k] = 0; sum[k] = 0; }
  let active = false, base = 0, kinds = 0, tricks = 0, left = 0, comboT = 0;
  // dérive en cours : raw = points avant répétition, rep = facteur de répétition figé à sa validation
  const drift = { on: false, counted: false, t: 0, gap: 0, raw: 0, rep: 1, n: 0, tick: 0, shown: -1 };
  // pointe de vitesse
  let fastT = 0, fastArmed = true;
  // fenêtre du prochain rapport au serveur (unités du message C.STYLE) et bilan de la session
  const win = { pts: 0, combo: 0, drift: 0, air: 0, near: 0, props: 0, banked: false };
  const session = { banks: 0, busts: 0, points: 0, best: 0, drifts: 0, bestDrift: 0, jumps: 0, bestAir: 0, near: 0, props: 0, dodges: 0, tricks: 0 };
  let reportT = REPORT_SEC; // le premier encaissement est rapporté sans attendre
  let driveT = 0;           // s passées au volant sans interruption
  const comboEv = { total: 0, mult: 1, left: 0, max: BANK_SEC, active: false }; // réutilisé

  // ---------------------------------------------------------------- attribution
  const myCar = () => { const p = ctx.player; return p && p.mode === 'vehicle' ? p.vehicle || null : null; };
  /** Règle d'attribution commune : l'événement vient-il de la voiture que le joueur conduit ? */
  const mine = (e) => { const v = myCar(); return !!e && !!v && e.vehicle === v; };
  const chased = () => !!store.heat?.wanted;

  // ---------------------------------------------------------------- combo
  const driftPts = () => (drift.counted ? Math.round(drift.raw * drift.rep) : 0);
  const total = () => base + driftPts();
  const mult = () => clamp(kinds, 1, MULT_MAX);
  function open() {
    if (active) return;
    active = true; base = 0; kinds = 0; tricks = 0; comboT = COMBO_DT;
    for (const k of KINDS) { count[k] = 0; sum[k] = 0; }
  }
  /** Inscrit une occurrence du type `kind` dans le combo ; retourne son facteur de répétition. */
  function occurrence(kind) {
    open();
    const n = ++count[kind];
    if (n === 1) kinds++;
    tricks++; session.tricks++;
    left = BANK_SEC;
    return Math.max(REPEAT_MIN, 1 - REPEAT_STEP * (n - 1));
  }
  function sync() { st.total = active ? total() : 0; st.mult = active ? mult() : 1; st.left = active ? left : 0; }
  function emitCombo() {
    comboEv.total = st.total; comboEv.mult = st.mult; comboEv.left = st.left; comboEv.active = active;
    bus.emit('style:combo', comboEv);
  }
  function emitTrick(kind, label, pts, gain, side) {
    sync();
    const e = { kind, label, pts, n: count[kind], mult: st.mult, total: st.total, gain };
    if (side === 1 || side === -1) e.side = side;
    bus.emit('style:trick', e);
  }
  /**
   * Figure ponctuelle : `pts` du barème, avant répétition et bonus de poursuite. opts = { side, bonus:false }.
   * Retourne les points réellement inscrits.
   */
  function trick(kind, pts, label, opts) {
    if (count[kind] === undefined || !(pts > 0)) return 0;
    const rep = occurrence(kind);
    const got = Math.max(1, Math.round(pts * rep * (opts?.bonus !== false && chased() ? CHASE_BONUS : 1)));
    base += got; sum[kind] += got;
    emitTrick(kind, label, sum[kind], got, opts?.side);
    return got;
  }
  /** Referme le combo (état seulement ; l'appelant émet ensuite style:bank ou style:bust, puis style:combo inactif). */
  function reset() {
    active = false; base = 0; kinds = 0; tricks = 0; left = 0;
    drift.on = false; drift.counted = false; drift.raw = 0; drift.t = 0; drift.gap = 0;
    sync();
  }
  /** Encaisse le combo : points × multiplicateur. */
  function bank() {
    if (drift.counted) endDrift();
    const m = mult(), pts = Math.round(base * m), n = tricks;
    reset();
    if (pts > 0) {
      const before = Math.max(st.best || 0, Number(store.me?.stats?.bestCombo) || 0);
      const record = pts >= RECORD_MIN && pts > before;
      if (pts > (st.best || 0)) st.best = pts;
      session.banks++; session.points += pts; session.best = st.best;
      win.pts += pts; if (pts > win.combo) win.combo = pts; win.banked = true;
      bus.emit('style:bank', { pts, mult: m, tricks: n, record, best: st.best });
    }
    emitCombo();
  }
  /** Perd le combo en cours. why = 'crash' | 'pedestrian' | 'police'. Retourne true s'il y avait quelque chose à perdre. */
  function bust(why) {
    if (!active) return false;
    const lost = Math.round(total() * mult());
    session.busts++;
    reset(); // la dérive en cours repart de zéro
    bus.emit('style:bust', { lost, why: why || 'crash' });
    emitCombo();
    return true;
  }

  // ---------------------------------------------------------------- dérive (lue chaque image)
  function endDrift() {
    if (drift.counted) {
      const pts = driftPts();
      base += pts;
      if (drift.t > session.bestDrift) session.bestDrift = drift.t;
      if (drift.t > win.drift) win.drift = drift.t;
      drift.counted = false; // avant sync() : les points sont désormais dans `base`
      if (pts !== drift.shown) emitTrick('drift', `Dérive ${sec1(drift.t)} s`, pts, pts);
    }
    drift.on = false; drift.counted = false; drift.raw = 0; drift.t = 0; drift.gap = 0;
  }
  function updateDrift(dt, v, speed) {
    const a = v ? +v.driftAngle : 0;
    const sliding = !!v && !v.airborne && speed > DRIFT_SPEED && (a > DRIFT_ANGLE || a < -DRIFT_ANGLE);
    if (!sliding) {
      if (drift.on) { drift.gap += dt; if (drift.gap > DRIFT_GRACE || !v) endDrift(); }
      return;
    }
    if (!drift.on) { drift.on = true; drift.counted = false; drift.t = 0; drift.raw = 0; drift.tick = 0; drift.shown = -1; }
    drift.gap = 0;
    drift.t += dt;
    drift.raw += DRIFT_RATE * clamp(speed / DRIFT_REF, DRIFT_K_MIN, DRIFT_K_MAX) * (chased() ? CHASE_BONUS : 1) * dt;
    if (!drift.counted) {
      if (drift.t < DRIFT_MIN_SEC) return;
      drift.rep = occurrence('drift'); drift.n = count.drift; drift.counted = true; drift.tick = DRIFT_TICK; session.drifts++;
    }
    left = BANK_SEC; // une dérive en cours tient le combo ouvert
    drift.tick += dt;
    if (drift.tick >= DRIFT_TICK) {
      drift.tick = 0; drift.shown = driftPts();
      emitTrick('drift', `Dérive ${sec1(drift.t)} s`, drift.shown, drift.shown);
    }
  }

  // ---------------------------------------------------------------- pointe de vitesse (lue chaque image)
  function updateSpeed(dt, v, speed) {
    const max = v?.spec?.maxSpeed;
    if (!(max > 0) || v.airborne) { fastT = 0; return; }
    if (speed > max * SPEED_K) {
      if (!fastArmed) return;
      fastT += dt;
      if (fastT >= SPEED_SEC) { fastT = 0; fastArmed = false; trick('speed', SPEED_PTS, `Pointe ${Math.round(speed * 3.6)} km/h`); }
    } else {
      fastT = 0;
      if (speed < max * SPEED_REARM) fastArmed = true;
    }
  }

  // ---------------------------------------------------------------- figures sur événement
  bus.on('vehicle:landed', (e) => {
    if (!mine(e)) return;
    const t = Math.min(AIR_MAX, +e.airTime || 0);
    if (t < AIR_MIN) return;
    session.jumps++; if (t > session.bestAir) session.bestAir = t;
    if (t > win.air) win.air = t;
    trick('air', AIR_BASE + AIR_RATE * t, `Saut ${sec1(t)} s`);
  });
  bus.on('traffic:nearMiss', (e) => {
    if (!mine(e)) return;
    session.near++; win.near++;
    trick('near', NEAR_PTS, 'Frôlement', { side: e.side });
  });
  bus.on('pedestrian:dodge', (e) => {
    if (!mine(e)) return;
    session.dodges++;
    trick('dodge', DODGE_PTS, 'Esquive');
  });
  bus.on('world:propBroken', (e) => {
    if (!mine(e)) return; // seul le véhicule en cause compte : plus de rayon de 20 m autour du joueur
    const terrace = e.kind === 'terrasse' || e.tag === 'terrasse';
    session.props++; win.props++;
    trick('prop', terrace ? TERRACE_PTS : PROP_PTS, terrace ? 'Strike de terrasse' : 'Strike');
  });
  bus.on('vehicle:carjack', (e) => { if (e?.by === 'local') trick('jack', JACK_PTS, 'Emprunt'); });

  // ---------------------------------------------------------------- pertes
  bus.on('vehicle:crash', (e) => {
    if (!active || !mine(e) || e.broke || e.kind === 'pedestrian') return; // un objet qui cède est une figure, pas un choc
    if (Math.abs(+e.impact || 0) > BUST_IMPACT) bust('crash');
  });
  bus.on('pedestrian:hit', (e) => { if (active && e?.severity === 'knockdown' && mine(e)) bust('pedestrian'); });

  // ---------------------------------------------------------------- boucle
  function report() {
    reportT = 0;
    bus.emit('intent:style', { pts: win.pts, combo: win.combo, drift: Math.round(win.drift * 10) / 10, air: Math.round(win.air * 10) / 10, near: win.near, props: win.props });
    win.pts = 0; win.combo = 0; win.drift = 0; win.air = 0; win.near = 0; win.props = 0; win.banked = false;
  }
  function update(dt) {
    const v = myCar();
    let speed = 0;
    if (v) { const vel = v.vel; speed = vel ? Math.hypot(vel.x, vel.z) : Math.abs(v.speed || 0); }
    updateDrift(dt, v, speed);
    if (v) updateSpeed(dt, v, speed); else fastT = 0;
    if (active) {
      // le chrono d'encaissement ne tourne ni pendant une dérive validée, ni en l'air (le saut n'est compté qu'à la réception)
      if (!drift.counted && !(v && v.airborne)) left -= dt;
      if (left <= 0) bank();
      else {
        sync();
        comboT += dt;
        if (comboT >= COMBO_DT) { comboT = 0; emitCombo(); }
      }
    }
    if (reportT < REPORT_SEC) reportT += dt;
    // rapport seulement au volant (descendu de voiture, la fenêtre attend le prochain trajet), et pas dans l'image où
    // l'on remonte : le serveur doit avoir reçu un état « véhicule »
    driveT = v ? driveT + dt : 0;
    if (win.banked && reportT >= REPORT_SEC && driveT >= REPORT_DRIVE) report();
  }

  return {
    update,
    /** Figure décidée par un autre sous-module (heat.js : 'cavale'). opts = { side, bonus:false }. Retourne les points inscrits. */
    trick,
    /** Perd le combo en cours (heat.js : contrôle de police). */
    bust,
    /** État en lecture (= store.style, modifié en place) : { total, mult, left, max, best }. */
    get state() { return st; },
    get active() { return active; },
    /** Bilan de la session : { banks, busts, points, best, drifts, bestDrift (s), jumps, bestAir (s), near, props, dodges, tricks }. */
    session,
  };
}

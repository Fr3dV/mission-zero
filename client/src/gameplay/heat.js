// Képis : trop de bêtises au volant et les képis s'allument (chaleur 0..3, képis = partie entière). À 2 képis,
// hors activité, c'est l'avis de recherche : une voiturette bleue colle au pare-chocs et l'on s'en débarrasse par
// l'adresse (virages serrés, sauts, frôlements) — jamais par une taxe. Immobilisé : « Papiers du véhicule… ».
//
// Contrat v6, « Bus — képis et police » :
//   - sources, filtrées par la règle d'attribution commune (e.vehicle === ctx.player.vehicle ET le joueur conduit ;
//     vehicle:carjack : e.by === 'local') : pedestrian:hit 'knockdown', vehicle:carjack, vehicle:crash contre une
//     voiture, world:propBroken ;
//   - ce module est le SEUL à commander la police : ctx.traffic.police = { start(level), setLevel(level), stall(sec),
//     stop(), active, engaged, dist }, lue paresseusement à chaque usage. Sans module police : la poursuite n'est
//     qu'un minuteur (évasion 'time' après 35 s sans nouvelle infraction) ;
//   - jamais de poursuite pendant une mission, une course ou un Chiche (chaleur plafonnée sous le seuil) ;
//     inversement, tant que la poursuite dure, g.guards refuse 'mission', 'job', 'dare', 'respawn' et 'spawnCar'.
// Sorties : store.heat {level, wanted, since} modifié en place (since = performance.now() du début de la poursuite,
// 0 sinon) ; heat:change {level, prev, why, wanted} ; heat:escape {level, sec, how} ; heat:bust {level} ;
// intent:heat {ev:'wanted'|'bust'|'escape', k, sec?, how?} (UN 'wanted' par poursuite) ; bandeaux ui:banner.
// Fin au minuteur avec l'unité au pare-chocs (moins de 25 m) : heat:escape 'time' et le bandeau « Les képis
// abandonnent » partent toujours, mais sans figure 'cavale' ni intent:heat 'escape' — rouler au pas une minute ne
// compte pas pour une cavale.

import { fmtInt } from './text.js';

// ---- barème (tout l'équilibrage des képis est ici ; la loi de l'unité de police est dans traffic/police.js) ----
const HEAT_MAX = 3;
const GAIN_KNOCKDOWN = 0.6;     // piéton renversé ('bump' ignoré)
const GAIN_JACK = 0.5;          // voiture « empruntée »
const GAIN_CRASH = 0.25;        // choc contre une voiture…
const CRASH_IMPACT = 9;         // …d'impact supérieur à 9 m/s
const GAIN_PROP = 0.03, GAIN_TERRACE = 0.02; // objet fauché (mobilier de terrasse : 0,02)…
const PROP_CAP = 1.9;           // …le mobilier seul ne fait jamais dépasser 1,9 : il ne déclenche pas de poursuite
const DECAY = 0.02;             // par seconde, hors poursuite…
const DECAY_HOLD = 4;           // …à partir de 4 s après la dernière infraction (deux piétons renversés en 10 s font ainsi toujours 1 képi)
const CAP_ACTIVITY = 1.9;       // plafond pendant une mission, une course ou un Chiche
const CAP_FRAGILE = 1;          // plafond pendant une mission à maxDamage
const WANTED_LEVEL = 2;         // képis à partir desquels la poursuite se déclenche (hors activité)
const ESCAPE_DIST = 110;        // évasion 'dist' : unité la plus proche à plus de 110 m…
const ESCAPE_HOLD = 4;          // …pendant 4 s…
const ESCAPE_UNENGAGED = 25;    // …après engagement, ou si aucune unité ne s'est engagée au bout de 25 s
const ESCAPE_TIME_2 = 60, ESCAPE_TIME_3 = 80; // évasion 'time' : poursuite sans contrôle (2 képis / 3 képis)
const ESCAPE_NO_POLICE = 35;    // sans module police : évasion 'time' après 35 s sans nouvelle infraction
const TIME_CLOSE = 25;          // évasion 'time' avec l'unité à moins de 25 m : les képis lâchent, mais ce n'est pas une cavale (ni points, ni compteur)
const AFTER_ESCAPE = 0.9;       // chaleur après une évasion
const IMMUNITY = 20;            // s d'immunité après une évasion
const CAVALE_DIST = 500, CAVALE_TIME = 200; // figure 'cavale' : points par képi (semés à distance / à l'usure)
const CAVALE_FAST = 30;         // semés en moins de 30 s : points doublés
const STALL_SEC = 1.2;          // l'unité décroche 1,2 s à chaque frôlement ou saut du joueur…
const STALL_AIR = 0.5;          // …d'au moins 0,5 s de vol
const CRASH_GAP = 0.5;          // s : deux chocs plus rapprochés sont le même accrochage
const PED_GAP = 3;              // s : un même piéton ne compte qu'une fois
const BLOCKED = { mission: 1, job: 1, dare: 1, respawn: 1, spawnCar: 1 }; // refusés pendant la poursuite
const GUARD_TEXT = 'Semez d\'abord les képis.';
const EPS = 1e-9;

const fmtClock = (s) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export function createHeat(g) {
  const { ctx, bus, store } = g;
  const st = store.heat || (store.heat = { level: 0, wanted: false, since: 0 }); // modifié en place
  let heat = 0, immune = 0, hold = 0, crashT = 0, lastPed = null, pedT = 0;
  // poursuite en cours : t = durée (s), far = temps passé hors de portée, quiet = temps sans infraction, started = police.start appelé
  const chase = { on: false, t: 0, far: 0, quiet: 0, started: false };

  const police = () => ctx.traffic?.police || null;
  const myCar = () => { const p = ctx.player; return p && p.mode === 'vehicle' ? p.vehicle || null : null; };
  /** Règle d'attribution commune : l'événement vient-il de la voiture que le joueur conduit ? */
  const mine = (e) => { const v = myCar(); return !!e && !!v && e.vehicle === v; };
  /** Une activité (mission, course de taxi, Chiche) est-elle en cours ? */
  const occupied = () => !!g.missions?.active || !!g.busy?.();
  /** Plafond de chaleur du moment. */
  const cap = () => { const a = g.missions?.active; return a ? (a.def?.maxDamage != null ? CAP_FRAGILE : CAP_ACTIVITY) : g.busy?.() ? CAP_ACTIVITY : HEAT_MAX; };
  const levelOf = (h) => Math.min(HEAT_MAX, Math.floor(h + EPS));

  /** Publie le niveau et l'état de poursuite ; heat:change seulement si l'un des deux a changé. */
  function publish(why) {
    const level = levelOf(heat), prev = st.level, wanted = chase.on;
    if (level === prev && wanted === st.wanted) return;
    st.level = level; st.wanted = wanted;
    bus.emit('heat:change', { level, prev, why, wanted });
  }

  // ---------------------------------------------------------------- poursuite
  function startChase(why) {
    const level = levelOf(heat);
    chase.on = true; chase.t = 0; chase.far = 0; chase.quiet = 0; chase.started = false;
    st.since = performance.now();
    const pol = police();
    if (pol) { try { pol.start(level); chase.started = true; } catch (e) { console.warn('[gameplay] police.start', e); } }
    publish(why);
    bus.emit('intent:heat', { ev: 'wanted', k: level });
    bus.emit('ui:banner', { kind: 'ko', eyebrow: 'Avis de recherche', title: `${level} képis à vos trousses`, sub: pol ? 'Semez-les : virages serrés, sauts, frôlements' : 'Faites-vous oublier une demi-minute', ms: 3400 });
  }
  /** Fin de poursuite (état seulement) : les unités sont congédiées. */
  function stopChase() {
    chase.on = false; chase.far = 0; chase.quiet = 0; chase.started = false;
    st.since = 0;
    try { police()?.stop?.(); } catch (e) { console.warn('[gameplay] police.stop', e); }
  }
  /**
   * Les képis sont semés. how = 'dist' (à distance) | 'time' (ils abandonnent) ; dist = distance de l'unité la plus
   * proche lue AVANT la fin de poursuite (police.stop() la remet à Infinity).
   */
  function escape(how, dist) {
    const level = levelOf(heat), sec = Math.round(chase.t * 10) / 10;
    // au minuteur avec l'unité au pare-chocs : personne n'a été semé
    const earned = !(how === 'time' && dist < TIME_CLOSE);
    stopChase();
    heat = AFTER_ESCAPE; immune = IMMUNITY; hold = 0;
    st.level = levelOf(heat); st.wanted = false;
    bus.emit('heat:escape', { level, sec, how });
    bus.emit('heat:change', { level: st.level, prev: level, why: 'escape', wanted: false });
    if (earned) bus.emit('intent:heat', { ev: 'escape', k: level, sec, how });
    const base = how === 'dist' ? CAVALE_DIST * level * (sec < CAVALE_FAST ? 2 : 1) : CAVALE_TIME * level;
    // figure décidée ici, comptée par style.js (sans le bonus de poursuite : elle est terminée)
    let pts = 0;
    if (earned) { try { pts = g.style?.trick?.('cavale', base, `Cavale ${fmtClock(sec)}`, { bonus: false }) || 0; } catch (e) { console.warn('[gameplay] figure cavale', e); } }
    const sub = pts > 0 ? `+${fmtInt(pts)} points de style` : '';
    if (how === 'dist') bus.emit('ui:banner', { kind: 'gold', eyebrow: 'Cavale réussie', title: `Semés ! ${fmtClock(sec)}`, sub, ms: 3600, sound: 'record' });
    else bus.emit('ui:banner', { kind: 'ok', eyebrow: 'Cavale', title: 'Les képis abandonnent', sub: `Tenu ${fmtClock(sec)}${sub ? ' · ' + sub : ''}`, ms: 3200 });
  }
  /** Contrôle : amende (décidée par le serveur), combo perdu, voiture empruntée rendue. */
  function bustNow() {
    const level = levelOf(heat);
    stopChase();
    heat = 0;
    st.level = 0; st.wanted = false;
    bus.emit('heat:bust', { level });
    bus.emit('heat:change', { level: 0, prev: level, why: 'bust', wanted: false });
    bus.emit('intent:heat', { ev: 'bust', k: level });
    try { g.style?.bust?.('police'); } catch (e) { console.warn('[gameplay] combo confisqué', e); }
    const returned = returnBorrowedCar();
    const fined = Array.isArray(store.feat) && store.feat.includes('heat'); // sans cette capacité, le serveur n'en saura rien
    bus.emit('ui:banner', {
      kind: 'ko', eyebrow: 'Contrôle des képis', title: '« Papiers du véhicule… »', ms: 3600, sound: 'bust',
      // (pas de « petite amende » ici : le serveur n'en prélève pas toujours — délai de 60 s, solde vide — et le débit réel
      // s'affiche sous le portefeuille quand il a lieu)
      sub: returned ? 'La voiture empruntée retourne à son propriétaire.' : fined ? 'Circulez.' : 'Ça ira pour cette fois : circulez.',
    });
  }
  /** Hors mission, la voiture qui n'est pas celle du joueur est rendue (descente puis retrait). Retourne true si c'est fait. */
  function returnBorrowedCar() {
    const p = ctx.player, v = p?.vehicle;
    if (!v || g.missions?.active || v === g.estate?.personalCar || v.personal || v.mission) return false;
    try {
      p.exitVehicle?.(true);
      if (p.vehicle === v) return false; // descente impossible : on ne retire rien sous le joueur
      ctx.vehicles?.remove?.(v);
      return true;
    } catch (e) { console.warn('[gameplay] voiture rendue', e); return false; }
  }

  // ---------------------------------------------------------------- infractions
  /** Ajoute `gain` de chaleur (plafonds du moment, immunité) ; propMax = plafond propre au mobilier. */
  function add(gain, why, propMax) {
    if (immune > 0 || !(gain > 0)) return;
    hold = DECAY_HOLD; // la chaleur ne retombe pas pendant qu'on enchaîne les bêtises
    if (chase.on) chase.quiet = 0; // toute nouvelle infraction relance le minuteur d'oubli
    let max = cap();
    if (propMax !== undefined && propMax < max) max = propMax;
    if (heat >= max) return; // déjà au plafond : rien (et jamais de baisse ici)
    heat = Math.min(max, heat + gain);
    if (chase.on) {
      const level = levelOf(heat);
      if (level !== st.level) { try { police()?.setLevel?.(level); } catch (e) { console.warn('[gameplay] police.setLevel', e); } }
      publish(why);
    } else if (levelOf(heat) >= WANTED_LEVEL && !occupied()) startChase(why);
    else publish(why);
  }
  bus.on('pedestrian:hit', (e) => {
    if (e?.severity !== 'knockdown' || !mine(e)) return;
    const now = ctx.time || 0;
    if (e.pedestrian && e.pedestrian === lastPed && now - pedT < PED_GAP) return;
    lastPed = e.pedestrian || null; pedT = now;
    add(GAIN_KNOCKDOWN, 'pedestrian');
  });
  bus.on('vehicle:carjack', (e) => { if (e?.by === 'local') add(GAIN_JACK, 'jack'); });
  bus.on('vehicle:crash', (e) => {
    if (!mine(e) || e.kind !== 'vehicle' || !(Math.abs(+e.impact || 0) > CRASH_IMPACT)) return;
    if (e.other?.driver === 'police') return; // la voiturette n'est pas « le trafic »
    const now = ctx.time || 0;
    if (now - crashT < CRASH_GAP) return;
    crashT = now;
    add(GAIN_CRASH, 'crash');
  });
  bus.on('world:propBroken', (e) => {
    if (!mine(e)) return;
    add(e.kind === 'terrasse' || e.tag === 'terrasse' ? GAIN_TERRACE : GAIN_PROP, 'prop', PROP_CAP);
  });

  // l'adresse fait décrocher l'unité : frôlement, saut d'au moins 0,5 s
  const stall = () => { if (chase.on) { try { police()?.stall?.(STALL_SEC); } catch (e) { console.warn('[gameplay] police.stall', e); } } };
  bus.on('traffic:nearMiss', (e) => { if (chase.on && mine(e)) stall(); });
  bus.on('vehicle:landed', (e) => { if (chase.on && mine(e) && (+e.airTime || 0) >= STALL_AIR) stall(); });
  // contrôle : unité à moins de 9 m du joueur presque à l'arrêt depuis 2 s (décidé par traffic/police.js)
  bus.on('police:stop', () => { if (chase.on) bustNow(); });

  // interdits croisés pendant la poursuite (startMission, client de taxi, Chiche, réapparition, sortie de voiture)
  g.guards.push((what) => (chase.on && BLOCKED[what] ? GUARD_TEXT : null));

  // ---------------------------------------------------------------- boucle
  function update(dt) {
    if (immune > 0) immune -= dt;
    if (!chase.on) {
      if (heat <= 0) return;
      if (hold > 0) hold -= dt; else heat -= DECAY * dt;
      const max = cap();
      if (heat > max) heat = max; // une activité commence : on repasse sous le seuil
      if (heat < 0) heat = 0;
      // activité terminée avec assez de képis (ou chaleur posée par une sonde) : la poursuite part maintenant
      if (levelOf(heat) >= WANTED_LEVEL && !occupied()) startChase('activity');
      else publish('calm');
      return;
    }
    // jamais de poursuite pendant une activité (les étapes à l'arrêt seraient des contrôles) : elle est levée sans suite
    if (occupied()) { stopChase(); heat = Math.min(heat, cap()); publish('activity'); return; }
    chase.t += dt; chase.quiet += dt;
    const pol = police();
    if (!pol) { if (chase.quiet >= ESCAPE_NO_POLICE) escape('time'); return; }
    if (!chase.started) { try { pol.start(levelOf(heat)); chase.started = true; } catch (e) { console.warn('[gameplay] police.start', e); } }
    const d = pol.dist;
    if ((pol.engaged || chase.t >= ESCAPE_UNENGAGED) && !(d <= ESCAPE_DIST)) chase.far += dt; else chase.far = 0;
    if (chase.far >= ESCAPE_HOLD) escape('dist', d);
    else if (chase.t >= (levelOf(heat) >= 3 ? ESCAPE_TIME_3 : ESCAPE_TIME_2)) escape('time', d);
  }

  /** Remise à zéro (changement de compte, sondes) : poursuite levée sans suite, képis éteints, immunité effacée. */
  function reset() {
    if (chase.on) stopChase();
    heat = 0; immune = 0; hold = 0; lastPed = null;
    publish('reset');
  }

  return {
    update, reset,
    /** État en lecture (= store.heat, modifié en place) : { level, wanted, since }. */
    get state() { return st; },
    /** Chaleur flottante 0..3 (les képis en sont la partie entière). */
    get value() { return heat; },
    get wanted() { return chase.on; },
    /** Durée de la poursuite en cours (s), 0 sinon. */
    get chaseSec() { return chase.on ? chase.t : 0; },
    get immune() { return immune > 0; },
  };
}

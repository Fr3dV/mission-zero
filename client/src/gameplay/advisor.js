// Conseiller : le joueur a toujours un cap. Choisit en permanence le « prochain objectif » (une mission à
// rejoindre, ou le Chiche ouvert de la salle), le publie dans store.objective + gameplay:objective, et le suit
// d'un appui sur E « dans le vide ». Gère aussi les premières minutes (Monsieur Zéro, mission d'introduction).
//
// Coût : le choix se fait sur des distances à vol d'oiseau, puis l'itinéraire n'est calculé que pour 3 candidats
// au plus (2 ms chacun), toutes les 5 s ou après 150 m de déplacement — et pas du tout si rien n'a bougé. Entre
// deux recalculs, la distance affichée est estimée une fois par seconde d'après le vol d'oiseau (voir publish) :
// aucun calcul d'itinéraire les autres images.
import { MISSIONS, MISSION_BY_ID, missionRouteLength } from '@shared/missions.js';
import { VEHICLE_BY_ID } from '@shared/catalog.js';
import { levelInfo, START_RING } from './missionRunner.js';
import { de } from './text.js';

// ---- réglages ----
const RECALC_SEC = 5;       // recalcul d'itinéraire au plus tôt toutes les 5 s (si le joueur a bougé)…
const RECALC_MOVE = 150;    // …ou dès 150 m parcourus
const RECALC_IDLE = 30;     // à l'arrêt : un contrôle toutes les 30 s (cooldowns qui se terminent)
const ROUTE_BUDGET_MS = 2;  // par itinéraire
const ROUTED_MAX = 3;       // candidats départagés par la route
const AIR_FACTOR = 1.35;    // détour routier moyen pour le préfiltre à vol d'oiseau
const STAR_RANGE = 2500;    // la mission vedette est favorisée en deçà (m par la route)
const FOOT_TOUR_MAX = 2000; // aux niveaux 1-2 et sans voiture à portée, pas de tournée à pied plus longue (jamais la vedette)
const WALK_REACH = 450;     // sans voiture à portée : au-delà, un départ devient pénible à rejoindre
const CAR_REACH = 150;      // « voiture à portée » : sa voiture personnelle à moins de 150 m
const INTRO_RANGE = 1500;   // la mission d'introduction n'est imposée que si elle n'est pas à l'autre bout de la ville (?tp=)
const PIN_SEC = 8;          // après une fin de mission : « Suivante » / « Recommencer » restent l'objectif 8 s
const FIRST_DELAY = 2;      // s après la première apparition : Monsieur Zéro prend la parole
const fin = Number.isFinite;

export function createAdvisor(g) {
  const { ctx, bus, store } = g;
  const missions = g.missions;
  const byCar = (m) => !!m.requireVehicle || !!m.vehicle?.provided;

  // ---------------------------------------------------------------- candidats
  /** Mission d'introduction de la ville (champ intro) ; sinon la mission de niveau 1 en voiture la plus proche de (x, z). */
  function introMission(x, z) {
    const flagged = MISSIONS.find((m) => m.intro);
    if (flagged) return flagged;
    let best = null, bd = Infinity;
    for (const m of MISSIONS) {
      if (m.level !== 1 || !byCar(m)) continue;
      const s = missions.resolved[m.id].start, d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }
  const ownsCarWorth = (min) => (store.me?.cars || []).some((id) => (VEHICLE_BY_ID[id]?.price ?? 0) >= min);
  /** Le joueur a-t-il une voiture sous la main (au volant, ou sa voiture personnelle tout près) ? */
  function carAtHand(x, z) {
    if (ctx.player?.mode === 'vehicle') return true;
    const v = g.estate?.personalCar;
    return !!v && !!v.pos && Math.hypot(v.pos.x - x, v.pos.z - z) <= CAR_REACH;
  }
  /**
   * Coût d'un candidat (m « ressentis », le plus petit gagne) pour une distance `dist` jusqu'à son départ.
   * q = contexte du choix : { lv, car, star, intro } ; air = distance à vol d'oiseau.
   */
  function costOf(m, dist, q, air) {
    if (q.intro === m.id && air <= INTRO_RANGE) return -1; // première session : d'office
    let c = dist;
    if (!q.car && dist > WALK_REACH) c = WALK_REACH + (dist - WALK_REACH) * 3; // à pied, loin = pénible
    if (m.id === q.star && dist <= STAR_RANGE) return c * 0.35; // vedette du jour : payée double
    if (!missions.neverDone(m.id)) c = c * 1.6 + 1200; // déjà réussie : après les nouveautés
    return c;
  }
  const cand = []; // réutilisé : { m, st, air, cost }
  /** Missions jouables depuis (x, z), triées par coût estimé à vol d'oiseau. opts = { level } force le niveau. */
  function shortlist(x, z, excludeId, opts) {
    const lv = opts?.level ?? missions.level();
    const q = { lv, car: carAtHand(x, z), star: missions.starId(), intro: null };
    if (missions.missionsDone() === 0 && !opts?.level) { const im = introMission(x, z); if (im && missions.neverDone(im.id)) q.intro = im.id; }
    cand.length = 0;
    let spare = null; // tournée à pied trop longue : seulement s'il n'y a rien d'autre
    for (const m of MISSIONS) {
      if (m.id === excludeId || m.level > lv || missions.cooldownLeft(m.id) > 0) continue;
      if (m.vehicleMinPrice && !ownsCarWorth(m.vehicleMinPrice)) continue; // standing hors de portée
      const st = missions.resolved[m.id].start;
      const air = Math.hypot(st.x - x, st.z - z);
      const c = { m, st, air, cost: costOf(m, air * AIR_FACTOR, q, air) };
      if (lv <= 2 && !q.car && m.id !== q.star && !byCar(m) && q.intro !== m.id && missionRouteLength(m) > FOOT_TOUR_MAX) { if (!spare || c.cost < spare.cost) spare = c; continue; }
      cand.push(c);
    }
    if (!cand.length && spare) cand.push(spare);
    cand.sort((a, b) => a.cost - b.cost);
    return q;
  }
  /** Longueur d'itinéraire jusqu'à un point (même métrique et même graphe que le ruban GPS : à pied, sans les sens uniques), bornée dans le temps. */
  function roadDist(x, z, y, tx, tz, tele) {
    try {
      const r = g.route(x, z, tx, tz, { metric: g.routeMetric(x, z, tx, tz), fromEle: fin(y) ? g.eleOf(x, z, y) : undefined, toEle: tele, budgetMs: ROUTE_BUDGET_MS });
      if (fin(r?.length)) return r.length;
    } catch { /* repli : vol d'oiseau */ }
    return Math.hypot(tx - x, tz - z) * AIR_FACTOR;
  }
  /**
   * Départ utilisable dont l'anneau contient (x, z) — celui que la touche E lancerait (missionRunner.collect : le plus
   * proche, niveau et délai permis) : { m, st, air, dist } | null.
   */
  function ringStart(x, z, y, excludeId, lv) {
    let best = null, bd = START_RING;
    for (const m of MISSIONS) {
      if (m.id === excludeId || m.level > lv || missions.cooldownLeft(m.id) > 0) continue;
      const st = missions.resolved[m.id].start, d = Math.hypot(st.x - x, st.z - z);
      if (d <= bd && g.sameLevel(y, st.y, 4, st.x, st.z)) { bd = d; best = { m, st, air: d, dist: d }; }
    }
    return best;
  }
  /** Meilleur candidat après départage par la route des ROUTED_MAX premiers : { m, st, air, dist } | null. */
  function pick(x, z, y, excludeId, opts) {
    // sur un anneau de départ, E démarre cette mission-là (un interactable garde la priorité) : l'objectif et la carte
    // de fin (« Suivante ») annoncent donc celle-là
    const here = ringStart(x, z, y, excludeId, opts?.level ?? missions.level());
    if (here) return here;
    const q = shortlist(x, z, excludeId, opts);
    let best = null, bc = Infinity;
    const n = Math.min(ROUTED_MAX, cand.length);
    for (let i = 0; i < n; i++) {
      const c = cand[i];
      const dist = roadDist(x, z, y, c.st.x, c.st.z, c.st.ele);
      const cost = costOf(c.m, dist, q, c.air);
      if (cost < bc) { bc = cost; best = { m: c.m, st: c.st, air: c.air, dist }; }
    }
    return best;
  }

  /**
   * Mission conseillée depuis (fromX, fromZ), hors `excludeId` : { id, title, dist (m par la route), reward } | null.
   * Sert à la carte de fin de mission (« Suivante ») ; opts.level = niveau à considérer (après une montée de niveau),
   * opts.y = hauteur du point de départ du calcul (niveaux superposés).
   */
  function suggestNext(fromX, fromZ, excludeId, opts) {
    const b = pick(fromX, fromZ, opts?.y, excludeId, opts);
    return b ? { id: b.m.id, title: b.m.title, dist: Math.round(b.dist), reward: b.m.reward } : null;
  }

  // ---------------------------------------------------------------- objectif courant
  let cur = null; // { kind, id, title, type, reward, x, z, ele, dist, air (au moment du calcul), star }
  let pin = null; // { id, until } : préférence temporaire après une fin de mission
  let trackDare = null; // id du Chiche dont on suit le point de départ au GPS
  let calcT = 0, calcX = 0, calcZ = 0, pubT = 0, dirty = true, lastSig = '', advised = null;
  const quiet = () => { try { return !!ctx.ui?.prefs?.quiet; } catch { return false; } };

  /** Chiche ouvert de la salle, à proposer (jamais en mode tranquille, ni si l'on y participe déjà). */
  function openDare() {
    const d = store.dare;
    if (!d || d.phase !== 'open' || d.mine || !d.origin || !fin(d.origin.x) || !fin(d.origin.z) || quiet()) return null;
    return d;
  }
  /** Une activité occupe-t-elle déjà le joueur (mission, course de taxi, Chiche) ? */
  const occupied = () => !!missions.active || !!g.busy?.();

  function recalc() {
    const p = g.playerPos();
    calcX = p.x; calcZ = p.z; calcT = 0; dirty = false;
    if (trackDare && missions.tracked) trackDare = null; // le GPS suit désormais un départ de mission
    if (occupied()) { cur = null; return; }
    // pendant la carte de fin (« E — Suivante » / « E — Recommencer »), un Chiche ouvert ne prend pas la place de
    // l'objectif annoncé : il redevient prioritaire quand la préférence expire
    if (pin && (ctx.time || 0) >= pin.until) pin = null;
    const od = openDare(), d = pin ? null : od;
    if (d) {
      const o = d.origin;
      cur = { kind: 'dare', id: d.id, title: `Chiche ${de(d.by?.name || 'la salle')}`, type: 'dare', reward: d.stake || 0, x: o.x, z: o.z, ele: undefined, star: false, air: Math.hypot(o.x - p.x, o.z - p.z), dist: roadDist(p.x, p.z, p.y, o.x, o.z) };
      return;
    }
    if (trackDare && !od) { trackDare = null; if (!missions.tracked) g.nav.clear('track'); } // le Chiche suivi n'est plus ouvert
    let b = null;
    // départ déjà suivi au GPS (choix du joueur), sinon préférence temporaire (« Suivante » / « Recommencer ») : on ne change pas d'avis
    const keep = missions.tracked || (pin ? pin.id : null);
    const km = keep ? MISSION_BY_ID[keep] : null;
    if (km && km.level <= missions.level() && missions.cooldownLeft(km.id) <= 0) {
      const st = missions.resolved[km.id].start;
      b = { m: km, st, air: Math.hypot(st.x - p.x, st.z - p.z), dist: roadDist(p.x, p.z, p.y, st.x, st.z, st.ele) };
    }
    if (!b) b = pick(p.x, p.z, p.y);
    cur = b ? { kind: 'mission', id: b.m.id, title: b.m.title, type: b.m.type, reward: b.m.reward, x: b.st.x, z: b.st.z, ele: b.st.ele, star: b.m.id === missions.starId(), air: b.air, dist: b.dist } : null;
  }

  function publish() {
    pubT = 0;
    const p = g.playerPos();
    const level = levelInfo(missions.missionsDone());
    let o;
    if (!cur) o = { kind: 'none', id: null, title: '', type: null, reward: 0, dist: 0, x: 0, z: 0, tracking: false, star: false, level };
    else {
      // entre deux recalculs : distance par la route estimée d'après le déplacement à vol d'oiseau. En s'éloignant : la
      // longueur calculée plus le recul majoré du détour moyen (un prorata s'emballe quand la route fait dix fois le vol
      // d'oiseau) ; en s'approchant : le prorata, qui tombe à zéro à l'arrivée. Jamais moins que le vol d'oiseau.
      const air = Math.hypot(cur.x - p.x, cur.z - p.z);
      const add = cur.dist + (air - cur.air) * AIR_FACTOR;
      const dist = Math.max(air, air < cur.air && cur.air > 5 ? Math.min(add, cur.dist * (air / cur.air)) : add);
      const tracking = isTracking();
      o = { kind: cur.kind, id: cur.id, title: cur.title, type: cur.type, reward: cur.reward, dist: Math.max(0, Math.round(dist)), x: cur.x, z: cur.z, tracking, star: cur.star, level };
    }
    store.objective = o; // écrit en direct (pas de store:change une fois par seconde) ; l'UI écoute gameplay:objective
    bus.emit('gameplay:objective', o);
    // le départ conseillé porte un faisceau plus haut
    const adv = o.kind === 'mission' ? o.id : null;
    if (adv !== advised) { advised = adv; missions.refreshStartMarkers(); }
    lastSig = sigNow();
  }
  /** L'objectif courant est-il suivi au GPS ? */
  function isTracking() {
    if (!cur) return false;
    return cur.kind === 'mission' ? missions.tracked === cur.id : trackDare === cur.id && g.nav.dest?.source === 'track' && !missions.tracked;
  }
  /** Signature de ce qui est publié : un changement déclenche une publication immédiate (sinon 1 Hz). */
  const sigNow = () => `${cur ? cur.kind : 'none'}|${cur ? cur.id : null}|${isTracking()}|${cur ? cur.star : false}`;

  /** Demande un nouveau choix dès la prochaine image (état du jeu changé : mission, profil, journal, Chiche…). */
  function poke() { dirty = true; }

  /**
   * E « dans le vide » : suit l'objectif. Mission : guidage jusqu'au départ (elle démarre à l'arrivée, ou tout de
   * suite si l'on y est) ; Chiche : GPS vers son point de départ. Retourne true si quelque chose a été suivi.
   */
  function follow() {
    if (dirty) recalc();
    const o = cur;
    if (!o) return false;
    if (o.kind === 'mission') { const ok = missions.startMission(o.id); poke(); return ok; }
    if (o.kind === 'dare') {
      missions.untrack();
      trackDare = o.id;
      g.nav.set(o.x, o.z, o.title, 'track');
      publish();
      return true;
    }
    return false;
  }
  /** Arrête le suivi GPS d'un Chiche (abandon du suivi). */
  function untrack() { if (!trackDare) return false; trackDare = null; g.nav.clear('track'); poke(); return true; }

  // ---------------------------------------------------------------- événements
  bus.on('mission:end', (e) => {
    // la carte de fin propose « E — Suivante » (réussite) ou « E — Recommencer » (échec) : même objectif ici, 8 s
    const id = e?.outcome === 'success' ? e.next?.id : e?.retry ? e.id : null;
    pin = id ? { id, until: (ctx.time || 0) + PIN_SEC } : null;
    poke();
  });
  bus.on('mission:start', poke);
  bus.on('net:welcome', poke);
  bus.on('journal:update', () => { poke(); missions.refreshStartMarkers(); });
  bus.on('dare:state', poke);
  bus.on('dare:end', poke);
  bus.on('job:start', poke);
  bus.on('job:result', poke);
  bus.on('job:lost', poke);
  bus.on('ui:prefs', poke);
  bus.on('store:change', (patch) => { if (patch?.me && (patch.me.stats || patch.me.cooldowns || patch.me.cars)) poke(); });

  // ---------------------------------------------------------------- première session
  // Monsieur Zéro accueille le nouveau joueur (aucune mission réussie) : un mot, le ruban jusqu'à la mission
  // d'introduction, un faisceau violet sur sa voiture. Rien si une mission est déjà en cours ou suivie
  // (sonde lancée par ?autostart, reprise).
  let firstT = -1, firstDone = false;
  bus.on('net:welcome', () => { if (!firstDone) firstT = FIRST_DELAY; });
  function firstSession() {
    firstDone = true;
    if (missions.missionsDone() !== 0 || missions.active || missions.tracked || occupied()) return;
    const p = g.playerPos();
    const im = introMission(p.x, p.z);
    if (!im || !missions.neverDone(im.id) || missions.cooldownLeft(im.id) > 0 || im.level > missions.level()) return;
    const st = missions.resolved[im.id].start;
    if (Math.hypot(st.x - p.x, st.z - p.z) > INTRO_RANGE) return; // apparu loin du centre (?tp=) : pas de guidage forcé
    const car = g.estate?.personalCar;
    const carName = car?.spec?.name || 'voiture';
    // au tactile : aucun libellé de touche (le bouton « Monter / descendre » porte une voiture)
    const how = g.touch?.() ? 'montez (bouton voiture)' : 'F pour monter';
    g.toast(`Monsieur Zéro : « Montrez-moi ce que vous savez faire. Votre ${carName} vous attend — ${how}, puis suivez le ruban. »`, 'info');
    missions.startMission(im.id, { silent: true }); // suivi automatique : le ruban mène au départ
    if (car && byCar(im)) g.estate.setCarHint?.(true);
    bus.emit('gameplay:firstSession', { id: im.id });
    recalc(); publish();
  }

  // ---------------------------------------------------------------- boucle
  function update(dt) {
    if (firstT >= 0) { firstT -= dt; if (firstT < 0) firstSession(); }
    calcT += dt; pubT += dt;
    if (pin && (ctx.time || 0) >= pin.until) { pin = null; dirty = true; }
    let need = dirty;
    if (!need && calcT >= RECALC_SEC) {
      const p = g.playerPos();
      const moved = Math.hypot(p.x - calcX, p.z - calcZ);
      // immobile : rien n'a changé, on ne recalcule pas (sauf de loin en loin pour les cooldowns)
      need = moved > 4 || calcT >= RECALC_IDLE;
    } else if (!need && calcT > 0.5) {
      const p = g.playerPos();
      const dx = p.x - calcX, dz = p.z - calcZ;
      need = dx * dx + dz * dz >= RECALC_MOVE * RECALC_MOVE;
    }
    if (need) {
      recalc();
      if (sigNow() !== lastSig) { publish(); return; }
    }
    if (pubT >= 1) publish();
  }

  return {
    update, poke, follow, untrack, suggestNext,
    /** Objectif publié (copie de store.objective). */
    get objective() { return store.objective; },
    /** id de la mission conseillée (son départ porte un faisceau plus haut), ou null. */
    get advisedId() { return advised; },
    /** id du Chiche dont on suit le départ au GPS, ou null. */
    get trackingDare() { return trackDare; },
    /** true pendant la fenêtre de la carte de fin (« E — Suivante » / « E — Recommencer » restent l'objectif). */
    get pinned() { return !!pin && (ctx.time || 0) < pin.until; },
  };
}

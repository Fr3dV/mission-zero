// Taxi libre : en voiture, hors mission, un passant au faisceau vert hèle au bord du trottoir. On s'arrête à sa
// hauteur, il monte et annonce sa destination ; on le dépose, il paie la course et son pourboire, et le client
// suivant attend déjà à deux pas. Aucun argent ici : la destination, le caractère du client, le prix et le
// pourboire sont décidés par le serveur (ou son repli hors-ligne).
//
// Contrat v6, « Bus — taxi » et « Règles serveur du taxi libre » :
//   intentions : intent:jobStart {kind:'taxi'} (prise en charge), intent:jobDone {id, hits} (arrivée, hits = chocs
//                0..5, ne peut que réduire le pourboire), intent:jobAbort {} (abandon) ;
//   réponses   : job:start {id, kind, mood, to:{x,z,label,r}, fare, parSec, chain, taxi, startAt?} ;
//                job:result {ok, id, fare, tip, chain, capped, code, reason, total?} — un refus de prise en charge a
//                id nul ; 'too_far' CONSERVE la course ; job:lost {} = course perdue par une coupure (annoncée par
//                un toast, jamais par une carte d'échec).
// Le délai nominal (parSec) n'est jamais recalculé ici : la jauge de pourboire lit celui de job:start (= store.job.parSec).
// Suivi : pseudo-mission {id, title, kind:'job'} dans mission:update (eyebrow 'Course', tip 0..1), 4 fois par seconde ;
// store.mission reste null. Activité : g.activities ('job', abandon = intent:jobAbort). Interdits croisés : pas
// d'offre ni de prise en charge en mission, en Chiche ou pendant une poursuite (g.guard('job')) ; pendant une course,
// g.guards refuse 'mission' et 'dare'.
import { LANDMARKS } from '@shared/landmarks.js';
import { createCharacter } from '../player/index.js';
import { ICON } from './markers.js';
import { RDV_POINTS } from './places.js';
import { fmtZ, gainZ } from './text.js';

// ---- réglages (tout l'équilibrage local du taxi est ici ; prix, délais et pourboire : shared/jobs.js, côté serveur) ----
const OFFER_MIN = 120, OFFER_MAX = 350; // m : couronne où le client apparaît autour du joueur
const NEXT_MAX = 300;         // m : après une course payée, le client suivant attend à moins de 300 m
const BEAM_RANGE = 540;       // m : portée du faisceau vert (plein éclat jusqu'à 400 m, fondu au-delà)
const DEST_MIN = 500, DEST_MAX = 6000; // m : une offre n'existe que si un point de rendez-vous est à cette distance
const FIRST_WAIT = 12;        // s de conduite libre avant le premier client
const NEXT_WAIT = 1.2;        // s après une course payée
const SKIP_WAIT = 8;          // s après un client ignoré, perdu de vue ou une course abandonnée
const RETRY_WAIT = 2;         // s entre deux essais de placement
const PLACE_TRIES = 6;        // points essayés par essai de placement
const OFFER_TTL = 150;        // s : au-delà, le client a trouvé un autre taxi (s'il n'est pas sous nos yeux)
const OFFER_LOST = 650;       // m : client semé
const PICK_MARGIN = 5;        // m ajoutés à la demi-largeur de la rue : distance de prise en charge…
const PICK_MIN = 13, PICK_MAX = 20; // …bornée (13 m : une voiture arrêtée le long du trottoir d'en face est encore « à sa hauteur »)
const STOP_SPEED = 1.5;       // m/s : « à l'arrêt »
const PICK_HOLD = 0.5;        // s à l'arrêt pour que le client monte
const DROP_HOLD = 0.4;        // s à l'arrêt pour qu'il descende
const DROP_MARGIN = 6;        // m retirés au rayon d'arrivée du serveur (la position qu'il connaît a un léger retard)
const ASK_TIMEOUT = 5;        // s sans réponse à une prise en charge : on réessaie
const PAY_TIMEOUT = 6;        // s sans réponse à une arrivée : on réessaie
const FOOT_MAX = 60;          // s à pied pendant une course : le client s'en va
const HIT_IMPACT = 5;         // m/s : choc ressenti par le client (un objet qui cède ne compte pas)
const HIT_GAP = 1.2;          // s : deux chocs plus rapprochés n'en font qu'un
const MAX_HITS = 5;
const HIT_COST = 0.2, HIT_COST_FRAGILE = 0.5; // part du pourboire perdue par choc (miroir de shared/jobs.js, pour la jauge)
const LINE_SEC = 3.5;         // s d'affichage d'une réplique dans le suivi
const HUD_DT = 0.25;          // mission:update 4 fois par seconde
const OFFER_COLOR = '#3ddc84', DEST_COLOR = '#3ddc84';
const GUARD_TEXT = 'Déposez d\'abord votre client.';

// répliques selon le caractère du client ({d} = destination, capitale initiale)
const LINES = {
  pickup: {
    normal: ['{d}, s\'il vous plaît.', 'Bonjour ! {d}, je vous prie.', '{d}. Prenez par où vous voulez.'],
    presse: ['{d}, et vite !', '{d} — je suis déjà en retard !', '{d}, vite ! Je double le pourboire si on fonce.'],
    touriste: ['{d}, please ! On m\'a dit que c\'était magnifique.', '{d} ! Et passez par les jolies rues…', 'Oh, un vrai taxi ! {d}, s\'il vous plaît.'],
    fragile: ['{d}… et doucement, j\'ai le cœur fragile.', '{d}. Sans à-coups, mon petit, je vous en prie.', '{d}, tout en douceur : je sors de chez le cardiologue.'],
  },
  hit: {
    normal: ['Hé, doucement !', 'Vous l\'avez eu où, votre permis ?', 'Attention, quand même !'],
    presse: ['Aïe ! Mais ne ralentissez pas !', 'Tant pis pour la carrosserie, foncez !', 'Ouille… on perd du temps, là !'],
    touriste: ['Oh là là ! C\'est ça, la conduite à la française ?', 'Wow ! C\'est compris dans la visite ?', 'Je filme tout, vous savez…'],
    fragile: ['Aïe… mon cœur !', 'Doucement, j\'ai dit ! Mes pilules…', 'Oh ! J\'ai vu ma vie défiler.'],
  },
  late: {
    normal: ['On n\'avance pas beaucoup…', 'Vous êtes sûr du chemin ?'],
    presse: ['On n\'y sera jamais ! Accélérez !', 'Mon train, mon train, mon train…'],
    touriste: ['On a déjà vu cette rue, non ?', 'C\'est encore loin ?'],
    fragile: ['Prenez votre temps… enfin, pas trop.', 'Je vais finir par rater mon feuilleton.'],
  },
};
const MOOD_NAME = { normal: 'Le client', presse: 'Le client (pressé)', touriste: 'Le client (touriste)', fragile: 'Le client (cœur fragile)' };
const fin = Number.isFinite;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const cap = (s) => { s = String(s || ''); return s ? s[0].toUpperCase() + s.slice(1) : s; };

export function createTaxi(g) {
  const { ctx, bus, store, markers } = g;

  // phase : 'idle' (rien) | 'offer' (un client hèle) | 'asking' (prise en charge demandée) | 'ride' (client à bord)
  //         | 'paying' (arrivée annoncée, réponse attendue)
  let phase = 'idle';
  let wait = FIRST_WAIT, nextMax = OFFER_MAX, seq = 0;
  let offer = null;  // { x, z, y, half, ax, az, t, hold, c: personnage }
  let job = null;    // course en cours : { id, mood, to, fare, parSec, chain, taxi, startAt, tx, tz, ty, label, dropR }
  let rider = null;  // personnage du client à bord (masqué), reposé sur le trottoir à l'arrivée
  let askT = 0, askCool = 0, payT = 0, doneCool = 0, hold = 0, footT = 0, hits = 0, hitT = -1e9;
  let line = '', lineT = 0, lateSaid = false, tip = 1, elapsed = 0, hudT = 0, silentAbort = false;
  let hailed = false; // la première offre de la session a été annoncée (le faisceau peut naître hors champ)
  const leaving = []; // clients déposés qui s'éloignent : { c, t, dx, dz }
  const pseudo = { id: null, title: '', kind: 'job' }; // pseudo-mission du suivi (réutilisée)
  const stepEv = { label: '', kind: 'dropoff', x: 0, z: 0, radius: 0 };

  // ---------------------------------------------------------------- utilitaires
  const myCar = () => { const p = ctx.player; return p && p.mode === 'vehicle' ? p.vehicle || null : null; };
  /** Règle d'attribution commune : l'événement vient-il de la voiture que le joueur conduit ? */
  const mine = (e) => { const v = myCar(); return !!e && !!v && e.vehicle === v; };
  const riding = () => phase === 'ride' || phase === 'paying';
  const enabled = () => Array.isArray(store.feat) && store.feat.includes('taxi');
  const pickLine = (kind, mood) => { const l = LINES[kind][mood] || LINES[kind].normal; return l[Math.floor(Math.random() * l.length)]; };
  const say = (text) => { line = `« ${text} »`; lineT = LINE_SEC; };
  function inLandmark(x, z) {
    for (const l of LANDMARKS) if (Math.hypot(l.x - x, l.z - z) < (l.radius || 0) + 6) return true;
    return false;
  }
  /** Un point de rendez-vous existe-t-il entre DEST_MIN et DEST_MAX de (x, z) ? (sinon le serveur n'aurait rien à proposer) */
  function hasDestination(x, z) {
    for (const s of RDV_POINTS) { const d = Math.hypot(s.x - x, s.z - z); if (d >= DEST_MIN && d <= DEST_MAX) return true; }
    return false;
  }
  /** Une offre peut-elle exister maintenant ? (jamais en mission, en Chiche ni pendant une poursuite) */
  function mayOffer() {
    if (!enabled() || !RDV_POINTS.length || g.missions?.active || g.guard('job')) return false;
    // premières minutes : le joueur suit le ruban de sa mission d'introduction, on ne le distrait pas
    return !(g.missions?.tracked && g.missions.missionsDone() === 0);
  }

  // ---------------------------------------------------------------- personnages
  function removeChar(c) { if (!c) return; try { c.group.removeFromParent(); c.dispose?.(); } catch { /* déjà retiré */ } }
  function refreshMarkers() {
    if (riding() && job) markers.set('job', [{ x: job.tx, z: job.tz, y: job.ty, color: DEST_COLOR, icon: ICON.flag, radius: job.ringR, beamH: 120, beamR: 1.4, range: 1e5, iconSize: 2.6, iconY: 5.5 }]);
    else if (offer) markers.set('job', [{ x: offer.x, z: offer.z, y: offer.y, color: OFFER_COLOR, icon: ICON.person, radius: 2.4, beamH: 80, beamR: 0.9, range: BEAM_RANGE, iconSize: 2.1, iconY: 4.4 }]);
    else markers.clear('job');
  }

  // ---------------------------------------------------------------- offre
  /** Cherche un bord de trottoir pour le client, de préférence devant la voiture. Retourne true si l'offre est posée. */
  function placeOffer() {
    const p = g.playerPos(), yaw = ctx.player?.yaw ?? 0;
    const max = Math.max(OFFER_MIN + 60, nextMax);
    for (let k = 0; k < PLACE_TRIES; k++) {
      // d'abord dans un cône devant la voiture, puis tout autour
      const a = yaw + (Math.random() - 0.5) * (k < 3 ? 1.7 : Math.PI * 2);
      const d = OFFER_MIN + 25 + Math.random() * (max - OFFER_MIN - 45);
      const tx = p.x - Math.sin(a) * d, tz = p.z - Math.cos(a) * d;
      let c = g.curbPoint(tx, tz, 1.1, g.isStreet);
      if (!c.road || !g.isStreet(c.road) || Math.abs(c.ele || 0) > 0.5) continue; // une rue carrossable, au niveau du sol
      if (!g.freeSpot(c.x, c.z, 0.6, c.y)) { c = g.curbPoint(tx, tz, 0.3, g.isStreet); if (!c.road || !g.freeSpot(c.x, c.z, 0.5, c.y)) continue; }
      const dist = Math.hypot(c.x - p.x, c.z - p.z);
      if (dist < OFFER_MIN || dist > max || inLandmark(c.x, c.z) || !hasDestination(c.x, c.z)) continue;
      let ch = null;
      try {
        ch = createCharacter(ctx, { name: `client-taxi-${Date.now() % 100000}-${++seq}` });
        ch.group.position.set(c.x, c.y, c.z);
        ch.group.rotation.y = Math.atan2(-(c.ax - c.x), -(c.az - c.z)); // tourné vers la chaussée
        ch.setState?.({ anim: 'idle', speed: 0 });
        ctx.scene.add(ch.group);
      } catch (e) { console.warn('[gameplay] client de taxi', e); ch = null; }
      offer = { x: c.x, z: c.z, y: c.y, half: c.half || 4, ax: c.ax, az: c.az, t: 0, hold: 0, c: ch };
      phase = 'offer'; nextMax = OFFER_MAX;
      refreshMarkers();
      // première offre de la session : un mot, car le client peut apparaître hors champ (ensuite le faisceau et la carte suffisent)
      if (!hailed) { hailed = true; g.toast(`Un client vous hèle à ${Math.max(10, Math.round(dist / 10) * 10)} m — cherchez le faisceau vert.`, 'info'); }
      return true;
    }
    return false;
  }
  /** Retire l'offre en cours (client ignoré, activité commencée…). keep = le personnage est gardé (il monte à bord). */
  function dropOffer(keep) {
    if (!offer) return;
    if (!keep) removeChar(offer.c);
    offer = null;
    if (phase === 'offer' || phase === 'asking') phase = 'idle';
    refreshMarkers();
  }
  /** Distance de prise en charge : la demi-largeur de la rue du client plus une marge, bornée. */
  const pickRadius = (o) => Math.min(PICK_MAX, Math.max(PICK_MIN, o.half + PICK_MARGIN));
  function updateOffer(dt) {
    const o = offer, p = g.playerPos();
    const d = Math.hypot(o.x - p.x, o.z - p.z);
    o.t += dt;
    if (!mayOffer()) { dropOffer(); wait = SKIP_WAIT; return; }
    if (d > OFFER_LOST || (o.t > OFFER_TTL && d > 90)) { dropOffer(); wait = SKIP_WAIT; return; }
    if (o.c && d < 220) {
      // de près, le client se tourne vers la voiture qui approche
      if (d < 45 && d > 1.5) o.c.group.rotation.y = Math.atan2(-(p.x - o.x), -(p.z - o.z));
      o.c.update?.(dt);
    }
    if (phase === 'asking') {
      askT += dt;
      if (askT > ASK_TIMEOUT) { phase = 'offer'; askCool = 3; o.hold = 0; }
      return;
    }
    if (askCool > 0) { askCool -= dt; return; }
    const v = myCar();
    if (v && d <= pickRadius(o) && Math.abs(v.speed || 0) < STOP_SPEED && g.sameLevel(p.y, o.y, 4, o.x, o.z)) {
      o.hold += dt;
      if (o.hold >= PICK_HOLD) { o.hold = 0; phase = 'asking'; askT = 0; bus.emit('intent:jobStart', { kind: 'taxi' }); }
    } else o.hold = 0;
  }

  // ---------------------------------------------------------------- course
  /** Point visé par le GPS et le marqueur : la destination, recalée sur une rue quand c'est un monument (r large). */
  function resolveTarget(to) {
    let x = to.x, z = to.z, ele;
    const r = fin(to.r) && to.r > 0 ? to.r : 45;
    // la rue doit rester dans le disque d'arrivée du serveur (marge comprise), sinon on s'y arrêterait pour rien
    const reach = Math.max(30, r - DROP_MARGIN - 4);
    const n = g.roads.nearest(x, z, reach, g.isStreet, 0) || g.roads.nearest(x, z, reach, g.drivable, 0);
    if (n && (r > 60 || n.dist > 6)) { x = n.x; z = n.z; ele = n.ele; }
    return { x, z, ele, y: g.groundY(x, z, ele) };
  }
  function begin(e) {
    const to = e?.to;
    if (!to || !fin(to.x) || !fin(to.z)) return;
    if (riding()) { dropRider(false); endRide(); } // une nouvelle course remplace la précédente
    const t = resolveTarget(to), r = fin(to.r) && to.r > 0 ? to.r : 45;
    job = {
      id: e.id ?? null, mood: LINES.pickup[e.mood] ? e.mood : 'normal', to, fare: +e.fare || 0, parSec: +e.parSec > 0 ? +e.parSec : 0, chain: e.chain || 1, taxi: !!e.taxi,
      startAt: fin(e.startAt) ? e.startAt : performance.now(), tx: t.x, tz: t.z, ty: t.y, ele: t.ele, label: to.label || 'la destination',
      dropR: Math.max(8, r - DROP_MARGIN), ringR: Math.min(Math.max(8, r - DROP_MARGIN), 18),
    };
    // le client de l'offre monte à bord (masqué jusqu'à l'arrivée)
    rider = offer?.c || null;
    if (rider) rider.group.visible = false;
    dropOffer(true);
    phase = 'ride'; hits = 0; hitT = -1e9; hold = 0; footT = 0; payT = 0; doneCool = 0; lateSaid = false; tip = 1; elapsed = 0; hudT = HUD_DT; silentAbort = false;
    pseudo.id = job.id; pseudo.title = cap(job.label);
    stepEv.label = `Déposez votre client : ${job.label}`; stepEv.x = job.tx; stepEv.z = job.tz; stepEv.radius = job.ringR;
    // le joueur a choisi une course : le départ de mission qu'il suivait attendra
    try { g.missions?.untrack?.(); g.advisor?.untrack?.(); } catch (err) { console.warn('[gameplay] taxi', err); }
    g.nav.set(job.tx, job.tz, `Course : ${job.label}`, 'job', job.ele);
    refreshMarkers();
    const first = pickLine('pickup', job.mood).replace('{d}', cap(job.label));
    say(first);
    g.toast(`${MOOD_NAME[job.mood]} : « ${first} »${job.taxi ? ' (+25 % : c\'est votre taxi)' : ''}`, 'info');
    g.advisor?.poke?.();
  }
  /** Fin de course (état seulement) : marqueur, GPS et suivi retirés. */
  function endRide() {
    job = null; phase = 'idle'; line = ''; lineT = 0;
    markers.clear('job');
    g.nav.clear('job');
    bus.emit('mission:update', { mission: null, step: null, stepIndex: 0, stepCount: 0, text: '', timeLeft: null, distance: 0 });
    refreshMarkers();
    g.advisor?.poke?.();
  }
  /** Le client descend sur le trottoir ; walk = il s'éloigne quelques secondes avant de disparaître. */
  function dropRider(walk) {
    const c = rider;
    rider = null;
    if (!c) return;
    try {
      const p = g.playerPos(), side = g.accessPoint(p.x, p.z);
      const far = Math.hypot(side.x - p.x, side.z - p.z) > 25; // pas de trottoir à portée : il descend à côté de la voiture
      const x = far ? p.x + 2.2 : side.x, z = far ? p.z : side.z;
      c.group.position.set(x, far || !g.sameLevel(side.y, p.y, 3) ? p.y : side.y, z);
      c.group.visible = true;
      const dx = side.dirX || 1, dz = side.dirZ || 0;
      if (walk) { c.group.rotation.y = Math.atan2(-dx, -dz); c.setState?.({ anim: 'walk', speed: 1.4 }); } else c.setState?.({ anim: 'idle', speed: 0 });
      leaving.push({ c, t: walk ? 7 : 4, dx: walk ? dx : 0, dz: walk ? dz : 0 });
    } catch (e) { console.warn('[gameplay] client de taxi', e); removeChar(c); }
  }
  function updateLeaving(dt) {
    for (let i = leaving.length - 1; i >= 0; i--) {
      const l = leaving[i];
      l.t -= dt;
      if (l.t <= 0) { removeChar(l.c); leaving.splice(i, 1); continue; }
      if (l.dx || l.dz) { const pos = l.c.group.position; pos.x += l.dx * 1.4 * dt; pos.z += l.dz * 1.4 * dt; }
      l.c.update?.(dt);
    }
  }
  /** Jauge de pourboire 0..1 : pleine à l'heure, vide au double du délai, entamée par chaque choc. */
  function tipGauge() {
    const par = job.parSec;
    const onTime = par > 0 ? clamp01(1 - Math.max(0, elapsed - par) / par) : 1;
    return onTime * Math.max(0, 1 - (job.mood === 'fragile' ? HIT_COST_FRAGILE : HIT_COST) * hits);
  }
  function emitUpdate(text, dist) {
    bus.emit('mission:update', {
      mission: pseudo, step: stepEv, stepIndex: 0, stepCount: 1, text, timeLeft: null, distance: dist, damage: null, maxDamage: null,
      eyebrow: 'Course', elapsed, reward: job.fare, rival: null, mine: null, tip,
    });
  }
  function updateRide(dt) {
    const j = job, p = g.playerPos(), v = myCar();
    // une mission a commencé malgré tout (sonde, démarrage forcé) : la course est abandonnée sans bruit
    if (g.missions?.active) { silentAbort = true; bus.emit('intent:jobAbort', {}); if (riding()) abandoned(); return; }
    elapsed = Math.max(0, (performance.now() - j.startAt) / 1000);
    tip = tipGauge();
    if (lineT > 0) lineT -= dt;
    if (doneCool > 0) doneCool -= dt;
    if (!lateSaid && j.parSec > 0 && elapsed > j.parSec) { lateSaid = true; say(pickLine('late', j.mood)); }
    const d = Math.hypot(j.to.x - p.x, j.to.z - p.z), dMark = Math.hypot(j.tx - p.x, j.tz - p.z);
    let text = lineT > 0 ? line : stepEv.label;
    if (phase === 'paying') {
      payT += dt;
      text = 'Le client règle la course…';
      if (payT > PAY_TIMEOUT) { phase = 'ride'; doneCool = 3; hold = 0; } // pas de réponse : on redemandera
    } else if (!v) {
      footT += dt; hold = 0;
      text = 'Remontez en voiture : votre client attend';
      if (footT > FOOT_MAX) { g.toast('Votre client a fini par héler un autre taxi.', 'info'); silentAbort = true; bus.emit('intent:jobAbort', {}); if (riding()) abandoned(); return; }
    } else {
      footT = 0;
      if (d <= j.dropR) {
        if (Math.abs(v.speed || 0) < STOP_SPEED) {
          hold += dt;
          text = 'Le client descend…';
          if (hold >= DROP_HOLD && doneCool <= 0) { phase = 'paying'; payT = 0; bus.emit('intent:jobDone', { id: j.id, hits }); if (!riding()) return; }
        } else { hold = 0; text = 'Vous y êtes : arrêtez-vous'; }
      } else hold = 0;
    }
    hudT += dt;
    if (hudT >= HUD_DT) {
      hudT = 0;
      g.nav.set(j.tx, j.tz, `Course : ${j.label}`, 'job', j.ele);
      emitUpdate(text, dMark);
    }
  }
  /** Course abandonnée (par le joueur, ou sans bruit quand une autre activité l'a remplacée). */
  function abandoned() {
    if (!riding()) return;
    const quiet = silentAbort;
    silentAbort = false;
    dropRider(false);
    endRide();
    wait = SKIP_WAIT;
    if (!quiet) g.toast('Course abandonnée : votre client descend en râlant.', 'info');
  }
  /** Course payée : bandeau, le client s'éloigne, le suivant attend déjà tout près. */
  function paid(e) {
    // total = somme réellement créditée (peut valoir 0 : plafond dur de l'heure) ; sans ce champ, prix + pourboire
    const fare = +e.fare || 0, tipZ = +e.tip || 0, total = fin(e.total) ? Math.max(0, e.total) : fare + tipZ;
    const chain = e.chain || 1, mult = 1 + 0.1 * Math.min(Math.max(1, chain) - 1, 5);
    let sub = `Course ${fmtZ(fare)} + pourboire ${fmtZ(tipZ)}`;
    if (chain > 1) sub += ` · série ×${mult.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;
    if (e.capped) sub += ' · plafond de l\'heure atteint';
    dropRider(true);
    endRide();
    wait = NEXT_WAIT; nextMax = NEXT_MAX;
    if (total <= 0 && e.capped) bus.emit('ui:banner', { kind: 'info', eyebrow: 'Course non payée', title: 'Plafond de l\'heure atteint', sub: 'Vos courses ne rapportent plus rien pour l\'instant : revenez plus tard.', ms: 3800 });
    else bus.emit('ui:banner', { kind: 'ok', eyebrow: 'Course payée', title: gainZ(total), sub, ms: 3400 });
  }

  // ---------------------------------------------------------------- réponses du serveur (ou du repli hors-ligne)
  bus.on('job:start', (e) => { if (e && (e.kind || 'taxi') === 'taxi') begin(e); });
  bus.on('job:result', (e) => {
    if (!e) return;
    if (riding() && (e.id == null || e.id === job.id) && (e.ok || e.id != null || phase === 'paying')) {
      if (e.ok) { paid(e); return; }
      if (e.code === 'too_far') { phase = 'ride'; doneCool = 2; hold = 0; say('Encore quelques mètres, s\'il vous plaît.'); return; } // la course continue
      // course annulée par le serveur (terminée trop vite, oubliée…) : un mot, jamais de carte d'échec
      g.toast(e.reason || 'La course n\'a pas pu être réglée.', 'info');
      dropRider(false); endRide(); wait = SKIP_WAIT;
      return;
    }
    if (phase === 'asking' && !e.ok) {
      // prise en charge refusée : le client reste sur le trottoir, sauf s'il n'y a aucune destination par ici
      g.toast(e.reason || 'Ce client a changé d\'avis.', 'error');
      phase = 'offer'; askCool = 8;
      if (e.code === 'no_spot' || e.code === 'unavailable') { dropOffer(); wait = 30; }
    }
  });
  bus.on('job:lost', () => {
    if (phase === 'asking') { phase = 'offer'; askCool = 3; return; }
    if (!riding()) return;
    g.toast('Course interrompue par une coupure.', 'info');
    dropRider(false); endRide(); wait = SKIP_WAIT;
  });
  // abandon : le nôtre (abortActivity) comme celui d'un autre émetteur — le serveur ne répond rien
  bus.on('intent:jobAbort', () => { if (riding()) abandoned(); });

  // chocs ressentis par le client (le pourboire fond) ; un objet qui cède n'en est pas un
  function hit() {
    const now = ctx.time || 0;
    if (now - hitT < HIT_GAP) return;
    hitT = now;
    if (hits < MAX_HITS) hits++;
    say(pickLine('hit', job.mood));
  }
  bus.on('vehicle:crash', (e) => { if (phase === 'ride' && mine(e) && !e.broke && Math.abs(+e.impact || 0) > HIT_IMPACT) hit(); });
  bus.on('pedestrian:hit', (e) => { if (phase === 'ride' && e?.severity === 'knockdown' && mine(e)) hit(); });

  // ---------------------------------------------------------------- activité, interdits, invite
  g.activities.push({
    kind: 'job',
    on: riding,
    get: () => (riding() && job ? { id: job.id, title: `Course — ${job.label}`, canAbort: true } : null),
    abort: () => { if (!riding()) return false; bus.emit('intent:jobAbort', {}); if (riding()) abandoned(); return true; },
  });
  g.guards.push((what) => ((what === 'mission' || what === 'dare') && riding() ? GUARD_TEXT : null));
  const noop = () => {};
  function collect(px, pz, out) {
    if (phase !== 'offer' || !offer) return;
    const d = Math.hypot(offer.x - px, offer.z - pz);
    if (d > 28) return;
    const v = myCar();
    // à l'arrêt hors de portée, l'invite ne promet pas que le client monte : elle dit d'avancer
    const text = !v ? 'Ce passant cherche un taxi : revenez en voiture'
      : d > pickRadius(offer) && Math.abs(v.speed || 0) < STOP_SPEED ? 'Avancez jusqu\'au client' : 'Arrêtez-vous : le client monte';
    out.push({ d, key: false, text, sub: '', action: noop });
  }

  // ---------------------------------------------------------------- boucle
  function update(dt) {
    if (leaving.length) updateLeaving(dt);
    if (riding()) { updateRide(dt); return; }
    if (offer) { updateOffer(dt); return; }
    // pas d'offre : le délai ne court qu'au volant, hors activité
    if (!myCar() || !mayOffer()) return;
    wait -= dt;
    if (wait <= 0 && !placeOffer()) wait = RETRY_WAIT;
  }

  return {
    update, collect,
    /**
     * Course ou offre en cours, en lecture : { phase, offer:{x,z}|null, job, hits, tip, elapsed } — null si rien.
     * offer = position du client qui hèle (point vert « Client » de la carte quand phase === 'offer').
     */
    get state() {
      if (phase === 'idle' && !offer) return null;
      return { phase, offer: offer ? { x: offer.x, z: offer.z } : null, job, hits, tip, elapsed };
    },
    get phase() { return phase; },
    get riding() { return riding(); },
    /** Sondes : fait apparaître un client tout de suite (true si un emplacement a été trouvé). */
    offerNow() { if (riding() || offer) return !!offer; wait = 0; return placeOffer(); },
  };
}

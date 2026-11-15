// Déroulé des missions : départ, étapes, conditions, chrono, dégâts, passager, fin.
// L'argent n'est jamais touché ici : on émet intent:missionStart / intent:missionComplete,
// le module net répond par mission:result (+ money:change).
// Contrat v6 : mission:end est la SEULE source de la carte de fin (un seul par mission, toujours complet :
// temps, records, reste à parcourir, mission suivante, niveau) ; plus aucun toast d'échec, de refus, d'abandon,
// de délai ni de niveau ici — la carte et le bandeau de l'interface les remplacent.
import { MISSIONS, MISSION_BY_ID, MISSION_TYPES, LEVELS, levelForMissionsDone, missionLegLengths } from '@shared/missions.js';
import { VEHICLE_BY_ID } from '@shared/catalog.js';
// exports livrés par d'autres lots : lus par espace de noms, avec repli local s'ils n'existent pas encore
import * as CORE from '@shared/content-core.js';
import * as ECO from '@shared/economy.js';
import { createCharacter } from '../player/index.js';
import { ICON } from './markers.js';
import { snapStepToRoad } from './gps.js';
import { fmtZ } from './text.js';

const TYPE_ICON = { delivery: ICON.parcel, taxi: ICON.person, race: ICON.clock, tour: ICON.pin, courier: ICON.parcel, convoy: ICON.car, photo: ICON.camera };
const STEP_ICON = { goto: ICON.flag, checkpoint: ICON.flag, pickup: ICON.person, dropoff: ICON.flag, stop: ICON.wait, photo: ICON.camera };
const START_RADIUS = 6;
/** Rayon de l'anneau de départ où la touche E propose de démarrer la mission (lu aussi par le conseiller). */
export const START_RING = START_RADIUS + 1.5;
const OBJECTIVE_COLOR = '#ffd60a';
const STAR_COLOR = '#ffc300'; // colonne de la mission vedette du jour
const fin = Number.isFinite;
const round1 = (v) => Math.round(v * 10) / 10;

const LAST_LEVEL = LEVELS[LEVELS.length - 1];
const STAR_EVERY = CORE.LEGEND_STAR_EVERY || 20;
/** Étoiles de Légende : une toutes les STAR_EVERY missions au-delà du dernier niveau. */
export const starsFor = CORE.starsFor || ((done = 0) => Math.max(0, Math.floor(((+done || 0) - LAST_LEVEL.missionsDone) / STAR_EVERY)));
/** Catégorie de record d'un modèle : 's' (Sport) au-delà de 62 m/s de pointe, sinon 'v' (Ville, à pied compris). */
export const classOf = ECO.classOf || ((typeId) => ((VEHICLE_BY_ID[typeId]?.maxSpeed || 0) > (ECO.CLASS_SPEED || 62) ? 's' : 'v'));

/**
 * Jauge de niveau pour `done` missions réussies : { n, title, have, need, nextTitle, stars }
 * (« Stagiaire ▸ Coursier 1/3 » = title ▸ nextTitle have/need ; au dernier niveau, la jauge mène à la prochaine étoile).
 */
export function levelInfo(done = 0) {
  done = Math.max(0, Math.floor(+done || 0));
  const n = levelForMissionsDone(done), cur = LEVELS[n - 1] || LEVELS[0], nxt = LEVELS[n];
  const stars = starsFor(done);
  if (nxt) return { n, title: cur.title, have: done - cur.missionsDone, need: nxt.missionsDone - cur.missionsDone, nextTitle: nxt.title, stars };
  return { n, title: cur.title, have: (done - cur.missionsDone) % STAR_EVERY, need: STAR_EVERY, nextTitle: `★${stars + 1}`, stars };
}

export function createMissionRunner(g) {
  const { ctx, bus, store, markers } = g;

  // Positions résolues (recalées sur la chaussée, avec leur hauteur `y`) pour chaque mission de la ville courante.
  const resolved = {};
  for (const m of MISSIONS) {
    // départ au bord de la chaussée (une rue carrossable si la mission se fait en voiture)
    const start = g.curbPoint(m.start.x, m.start.z, -1.6, m.requireVehicle ? g.isStreet : g.isWalkable);
    resolved[m.id] = {
      start,
      steps: m.steps.map((s) => {
        // photo : un point accessible à pied (trottoir) ; sinon l'axe de la chaussée, éventuellement ciblée (snapTo)
        if (s.kind === 'photo' && s.snap !== false && !s.snapTo) { const a = g.accessPoint(s.x, s.z); return { ...s, x: a.x, z: a.z, y: a.y, ele: a.ele }; }
        const p = snapStepToRoad(g.roads, s);
        return { ...s, x: p.x, z: p.z, ele: p.ele, y: g.groundY(p.x, p.z, p.ele) };
      }),
    };
  }
  // Plusieurs missions partent du même lieu (une place, une gare) : on écarte leurs marqueurs de départ le long
  // de la rue pour que chacun reste visible et accessible avec E.
  {
    const placed = [];
    const SPACING = 11;
    for (const m of MISSIONS) {
      const st = resolved[m.id].start;
      const clash = (x, z) => placed.some((q) => Math.hypot(q.x - x, q.z - z) < SPACING - 1 && g.sameLevel(q.y, st.y, 4));
      if (st.road && clash(st.x, st.z)) {
        for (let k = 1; k <= 12; k++) {
          // +1, -1, +2, -2… pas le long de la chaussée
          const d = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * SPACING;
          const c = g.curbPoint(st.ax + st.dirX * d, st.az + st.dirZ * d, -1.6, m.requireVehicle ? g.isStreet : g.isWalkable);
          if (!clash(c.x, c.z)) { resolved[m.id].start = c; break; }
        }
      }
      placed.push(resolved[m.id].start);
    }
  }
  /** Le joueur est-il dans le disque d'un point (même niveau : un pont n'est pas la voie qui passe dessous) ? */
  const within = (p, s, r) => Math.hypot(s.x - p.x, s.z - p.z) <= r && g.sameLevel(p.y, s.y, 6, s.x, s.z);

  let active = null; // mission en cours
  let tracked = null; // id de mission suivie au GPS (départ à rejoindre)
  let hudT = 0;
  let lastObjectiveSig = '';
  let announced = 0; // dernier niveau annoncé par gameplay:levelUp
  const drops = []; // véhicules de mission à retirer : { v, at } (voir retireVehicle)

  // ---------------------------------------------------------------- progression
  const missionsDone = () => {
    const s = store.me?.stats?.missionsDone;
    return typeof s === 'number' ? s : g.save.data.done || 0;
  };
  const level = () => levelForMissionsDone(missionsDone());
  const cooldownLeft = (id) => {
    // source de vérité : store.me.cooldowns (horodatages serveur) ; repli : sauvegarde locale
    const m = MISSION_BY_ID[id], last = store.me?.cooldowns?.[id] ?? g.save.data.last?.[id];
    if (!m || !last) return 0;
    return Math.max(0, m.cooldownSec - (Date.now() - last) / 1000);
  };
  /** Jamais réussie : pas de clé dans store.me.cooldowns (source serveur), ni de trace dans la sauvegarde locale. */
  const neverDone = (id) => !(store.me?.cooldowns && Object.hasOwn(store.me.cooldowns, id)) && !(g.save.data.count?.[id] > 0);
  /** Mission vedette du jour (payée double), tant que le défi « vedette » du journal n'est pas rempli. */
  function starId() {
    const j = store.journal;
    if (!j || typeof j.star !== 'string') return null;
    const d1 = Array.isArray(j.list) ? j.list.find((d) => d?.kind === 'star') : null;
    return d1 && (d1.claimed || d1.have >= d1.goal) ? null : j.star;
  }
  function status(m) {
    const lv = level();
    const cd = cooldownLeft(m.id);
    const available = m.level <= lv && cd <= 0;
    // canStart = ce que la carte et le téléphone doivent proposer (« Démarrer ») ; star = mission vedette du jour
    return { mission: m, locked: m.level > lv, cooldownLeft: cd, available, canStart: available && !active, start: resolved[m.id].start, done: g.save.data.count?.[m.id] || 0, fresh: neverDone(m.id), star: m.id === starId(), intro: !!m.intro };
  }
  const getAvailableMissions = () => MISSIONS.map(status).filter((s) => s.available).map((s) => s.mission);
  const getMissionStates = () => MISSIONS.map(status);

  // ---------------------------------------------------------------- marqueurs de départ
  function refreshStartMarkers() {
    if (active) { markers.clear('missionStarts'); return; }
    const list = [];
    const advised = g.advisor?.advisedId ?? null; // départ conseillé (« Prochain objectif ») : faisceau plus haut
    for (const m of MISSIONS) {
      const st = status(m);
      const p = st.start;
      if (st.locked) list.push({ x: p.x, z: p.z, y: p.y, color: '#8d99ae', icon: ICON.lock, radius: 3.2, beamH: 0, range: 260, iconSize: 1.2, iconY: 3.4 });
      else if (st.cooldownLeft > 0) list.push({ x: p.x, z: p.z, y: p.y, color: '#8d99ae', icon: ICON.clock, radius: 3.2, beamH: 0, range: 320, iconSize: 1.2, iconY: 3.4 });
      else {
        const follow = tracked === m.id, hi = follow || advised === m.id;
        const k = { x: p.x, z: p.z, y: p.y, color: MISSION_TYPES[m.type]?.color || '#ffb703', icon: TYPE_ICON[m.type] ?? ICON.mission, radius: 3.6, beamH: follow ? 110 : hi ? 95 : 60, beamR: follow ? 1.3 : hi ? 1.1 : 0.8, range: follow ? 1e5 : hi ? 2600 : 1500, iconSize: 2.3, iconY: 4.6 };
        if (st.star) {
          // mission vedette du jour : colonne dorée étoilée, coiffée d'une étoile (2 instances)
          Object.assign(k, { color: STAR_COLOR, star: true, beamH: Math.max(k.beamH, 130), beamR: Math.max(k.beamR, 1.2), range: Math.max(k.range, 2600) });
          list.push({ x: p.x, z: p.z, y: p.y, color: STAR_COLOR, icon: ICON.star, radius: 0, beamH: 0, range: k.range, iconSize: 1.5, iconY: 7.6 });
        }
        list.push(k);
      }
    }
    markers.set('missionStarts', list);
  }

  // ---------------------------------------------------------------- interaction (touche E)
  function collect(px, pz, out, py) {
    if (active) return;
    // départ suivi tout proche : seul celui-là est proposé (les départs voisins sont à 11 m, leurs anneaux se touchent)
    const only = tracked && within({ x: px, z: pz, y: py }, resolved[tracked].start, 25) ? tracked : null;
    for (const m of MISSIONS) {
      if (only && m.id !== only) continue;
      const p = resolved[m.id].start;
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d > START_RING || !g.sameLevel(py, p.y, 4, p.x, p.z)) continue;
      const st = status(m);
      let text, ok = false;
      if (st.locked) text = `${m.title} — niveau ${m.level} requis (${LEVELS[m.level - 1].title} : ${LEVELS[m.level - 1].missionsDone} missions réussies)`;
      else if (st.cooldownLeft > 0) text = `${m.title} — de nouveau disponible dans ${fmtTime(st.cooldownLeft)}`;
      // mission vedette du jour : le gain annoncé est doublé, comme dans l'encart d'objectif, le Carnet et le téléphone
      else { text = `Démarrer « ${m.title} » — ${MISSION_TYPES[m.type]?.label || ''} · ${st.star ? `${fmtZ(m.reward * 2)} (vedette ×2)` : fmtZ(m.reward)}`; ok = true; }
      out.push({ d, key: ok, text, sub: ok ? `${m.giver?.name || ''} : ${m.description}` : '', action: () => startMission(m.id) });
    }
  }

  // ---------------------------------------------------------------- démarrage
  function startMission(id, opts = {}) {
    const m = MISSION_BY_ID[id];
    if (!m) return false;
    if (active) { g.toast('Une mission est déjà en cours (abandonnez-la d\'abord).', 'error'); return false; }
    const st = status(m);
    if (!opts.force) {
      // autres activités (poursuite, Chiche, course de taxi) : chaque sous-module déclare ses interdits dans g.guards
      const why = g.guard?.('mission', id);
      if (why) { g.toast(why, 'error'); return false; }
      if (st.locked) { const l = LEVELS[m.level - 1]; g.toast(`« ${m.title} » est réservée au rang ${l.title} (${l.missionsDone} missions réussies).`, 'error'); return false; }
      if (st.cooldownLeft > 0) { g.toast(`« ${m.title} » sera disponible dans ${fmtTime(st.cooldownLeft)}.`, 'info'); return false; }
      const p = g.playerPos();
      if (!within(p, st.start, START_RADIUS + 2)) {
        // trop loin : on guide jusqu'au départ, la mission démarrera à l'arrivée
        const same = tracked === id;
        tracked = id;
        g.nav.set(st.start.x, st.start.z, `Départ : ${m.title}`, 'track', st.start.ele);
        if (!same) {
          refreshStartMarkers();
          if (!opts.silent) g.toast(`Rendez-vous au départ de « ${m.title} ».`, 'info');
          g.advisor?.poke?.();
        }
        return true;
      }
    }
    if (tracked) g.nav.clear('track');
    tracked = null;
    const r = resolved[id];
    active = {
      def: m, steps: r.steps, phase: 'active', stepIndex: 0, done: new Set(),
      t0: performance.now(), elapsed: 0,
      timeLeft: typeof m.timeLimitSec === 'number' ? m.timeLimitSec : m.legTimeSec ? r.steps[0].legTimeSec : null,
      damage: 0, crashSum: 0, damageBase: null, hold: 0, vehicle: null, passenger: null, aboard: false,
      text: '', distance: 0, reportT: 0,
      sport: false, // catégorie de record : Sport dès qu'un modèle Sport a été conduit pendant la mission (comme le serveur)
      levelBefore: level(), doneBefore: missionsDone(),
    };
    // véhicule fourni (convoyage, voiturier)
    if (m.vehicle?.provided && ctx.vehicles?.spawn) {
      const sp = g.lanePoint(r.start.x, r.start.z, 7, r.start.ele);
      try {
        // opts.y : la voiture apparaît au niveau de la chaussée choisie (pont, trémie), pas à celui de la rue
        active.vehicle = ctx.vehicles.spawn(m.vehicle.typeId, sp.x, sp.z, sp.yaw, { y: sp.y });
        active.vehicle.mission = id;
      } catch (e) { console.warn('[gameplay] véhicule de mission', e); }
    }
    // passager PNJ qui attend à la première prise en charge
    const pick = r.steps.find((s) => s.kind === 'pickup');
    if (pick && m.passenger) {
      try {
        const c = createCharacter(ctx, { color: m.passenger.color, name: m.passenger.name });
        const side = g.accessPoint(pick.x, pick.z);
        c.group.position.set(side.x, side.y, side.z);
        c.group.rotation.y = (side.yaw ?? 0) + Math.PI / 2;
        c.setState?.({ anim: 'idle', speed: 0 });
        ctx.scene.add(c.group);
        active.passenger = c;
      } catch (e) { console.warn('[gameplay] passager', e); }
    }
    store.set({ mission: publicState() });
    bus.emit('intent:missionStart', { id });
    bus.emit('mission:start', { id, mission: m });
    ctx.audio?.play?.('missionStart');
    g.toast(`${m.giver?.name ? m.giver.name + ' : ' : ''}${m.description}`, 'info');
    refreshStartMarkers();
    g.advisor?.poke?.();
    lastObjectiveSig = '';
    hudT = 1; // force un mission:update immédiat
    return true;
  }
  /** Cesse de suivre un départ de mission (sans toucher à une mission en cours). */
  function untrack() {
    if (!tracked) return false;
    tracked = null;
    g.nav.clear('track');
    refreshStartMarkers();
    g.advisor?.poke?.();
    return true;
  }

  // ---------------------------------------------------------------- état public (store.mission / mission:update)
  function publicState() {
    const a = active;
    if (!a) return null;
    const stepCount = a.steps.length;
    const stepIndex = a.def.anyOrder ? a.done.size : a.stepIndex;
    const step = currentTargets()[0] || a.steps[stepCount - 1];
    return {
      id: a.def.id, title: a.def.title, type: a.def.type, reward: a.def.reward, giver: a.def.giver,
      phase: a.phase, stepIndex, stepCount, step: step ? { label: step.label, kind: step.kind, x: step.x, z: step.z, y: step.y, radius: step.radius } : null,
      text: a.text, timeLeft: a.timeLeft, elapsed: a.elapsed, distance: a.distance,
      damage: a.def.maxDamage != null ? a.damage : null, maxDamage: a.def.maxDamage ?? null,
    };
  }
  /** Catégorie de record de la mission en cours : celle de la voiture conduite, Sport une fois pour toutes. */
  const classNow = (a) => (a.sport ? 's' : classOf(ctx.player?.mode === 'vehicle' ? ctx.player.vehicle?.typeId : undefined));
  /**
   * Records de la mission `id` dans la catégorie `cls` (store.records, écrit par net) :
   * rival = détenteur du record de salle s'il n'est pas le joueur lui-même ; mine = record personnel (s) ou null.
   */
  function recordsFor(id, cls) {
    const rec = store.records;
    let room = rec?.room?.[id]?.[cls];
    if (Array.isArray(room)) room = room[0];
    let mine = rec?.mine?.[id]?.[cls];
    if (mine && typeof mine === 'object') mine = mine.sec;
    const isMe = !!room && room.id != null && room.id === store.me?.id;
    if (isMe && !fin(mine)) mine = room.sec;
    return { rival: room && fin(room.sec) && !isMe ? { name: room.name || '?', sec: room.sec } : null, mine: fin(mine) ? mine : null };
  }
  function emitUpdate() {
    const s = publicState();
    if (!s) return;
    // mise à jour en place de store.mission (sans store:change à chaque tick), + événement dédié
    if (store.mission && store.mission.id === s.id) Object.assign(store.mission, s); else store.set({ mission: s });
    const rec = recordsFor(s.id, classNow(active));
    bus.emit('mission:update', {
      mission: s, step: s.step, stepIndex: s.stepIndex, stepCount: s.stepCount, text: s.text, timeLeft: s.timeLeft, distance: s.distance, damage: s.damage, maxDamage: s.maxDamage,
      eyebrow: 'Mission', elapsed: s.elapsed, reward: s.reward, rival: rec.rival, mine: rec.mine,
    });
  }

  function currentTargets() {
    const a = active;
    if (!a) return [];
    if (a.def.anyOrder) return a.steps.filter((_, i) => !a.done.has(i));
    return a.stepIndex < a.steps.length ? [a.steps[a.stepIndex]] : [];
  }

  // ---------------------------------------------------------------- fin de mission
  /**
   * Retire un véhicule de mission `delay` secondes plus tard — jamais sous le joueur en pleine vitesse : on attend
   * qu'il ralentisse (6 s au plus) pour le faire descendre. Puis sa voiture personnelle lui est livrée à côté,
   * pour ne pas le laisser à pied loin de tout (convoyage, voiturier).
   */
  function retireVehicle(v, delay) { drops.push({ v, at: (ctx.time || 0) + delay }); }
  function updateDrops() {
    const now = ctx.time || 0;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i], v = d.v;
      if (now < d.at) continue;
      const inside = ctx.player?.vehicle === v;
      if (inside && Math.abs(v.speed || 0) > 1.5 && now < d.at + 6) continue;
      drops.splice(i, 1);
      try {
        if (inside) ctx.player.exitVehicle?.(true);
        ctx.vehicles?.remove?.(v);
      } catch { /* déjà retiré */ }
      try { g.estate?.bringPersonalCar?.(); } catch (e) { console.warn('[gameplay] voiture personnelle', e); }
    }
  }
  function cleanup(removeVehicleDelay = 0) {
    const a = active;
    if (!a) return;
    if (a.passenger) { const c = a.passenger; setTimeout(() => { try { c.group.removeFromParent(); c.dispose?.(); } catch { /* déjà retiré */ } }, a.aboard ? 0 : 5000); if (a.aboard) c.group.visible = false; }
    if (a.vehicle) retireVehicle(a.vehicle, removeVehicleDelay);
    active = null;
    markers.clear('objective');
    g.nav.clear('mission');
    store.set({ mission: null });
    bus.emit('mission:update', { mission: null, step: null, stepIndex: 0, stepCount: 0, text: '', timeLeft: null, distance: 0 });
    refreshStartMarkers();
  }
  /** Mètres restant à parcourir par la route jusqu'à la dernière étape (pour la carte d'échec). */
  function remainingMeters(a, p) {
    const targets = currentTargets();
    if (!targets.length) return 0;
    const m = a.def, first = nearestOf(targets, p);
    let d = Math.hypot(first.x - p.x, first.z - p.z);
    try {
      const r = g.route(p.x, p.z, first.x, first.z, { fromEle: g.eleOf(p.x, p.z, p.y), toEle: first.ele, budgetMs: 6 });
      if (fin(r?.length)) d = r.length;
    } catch { /* vol d'oiseau */ }
    if (!m.anyOrder) {
      const legs = missionLegLengths(m);
      for (let i = a.stepIndex + 1; i < a.steps.length; i++) d += fin(legs[i]) ? legs[i] : Math.hypot(a.steps[i].x - a.steps[i - 1].x, a.steps[i].z - a.steps[i - 1].z) * 1.4;
    } else {
      // ordre libre : tournée au plus proche voisin, majorée du détour routier moyen
      const left = targets.filter((s) => s !== first);
      let cur = first;
      while (left.length) {
        let bi = 0;
        for (let i = 1; i < left.length; i++) if (Math.hypot(left[i].x - cur.x, left[i].z - cur.z) < Math.hypot(left[bi].x - cur.x, left[bi].z - cur.z)) bi = i;
        d += Math.hypot(left[bi].x - cur.x, left[bi].z - cur.z) * 1.6;
        cur = left[bi]; left.splice(bi, 1);
      }
    }
    return Math.max(1, Math.round(d));
  }
  /** Annonce une montée de niveau (une fois par niveau), juste après mission:end. */
  function announceLevel(lv) {
    if (lv > announced) {
      announced = lv;
      const l = LEVELS[lv - 1];
      if (l) bus.emit('gameplay:levelUp', { level: lv, title: l.title });
    }
    refreshStartMarkers();
  }
  /**
   * Fin de mission, quel que soit le dénouement : nettoie, puis émet UN mission:end complet (carte de fin de l'UI),
   * le son, et la montée de niveau éventuelle.
   * @param outcome 'success' | 'failed' | 'aborted' | 'refused' | 'timeout'
   * @param r       réponse du serveur (mission:result) ou { reason, code } pour un dénouement local
   */
  function finish(outcome, r = {}) {
    const a = active;
    if (!a) return;
    const def = a.def, id = def.id, ok = outcome === 'success';
    const p = g.playerPos();
    // reste à parcourir : seulement pour un échec ou un abandon en cours de route
    const remain = (outcome === 'failed' || outcome === 'aborted') && a.phase === 'active' ? remainingMeters(a, p) : null;
    const sec = fin(r.sec) ? r.sec : round1(a.elapsed);
    const cls = r.cls === 's' || r.cls === 'v' ? r.cls : a.sport ? 's' : 'v';
    // compteur de missions après ce dénouement : celui du serveur, sinon le compteur connu (+1 s'il n'a pas encore bougé)
    const done = fin(r.done) ? r.done : missionsDone() + (ok && missionsDone() === a.doneBefore ? 1 : 0);
    const before = a.levelBefore;
    if (ok) {
      const d = g.save.data;
      d.done = (d.done || 0) + 1;
      d.last = { ...(d.last || {}), [id]: Date.now() };
      d.count = { ...(d.count || {}), [id]: (d.count?.[id] || 0) + 1 };
      g.save.write();
    }
    cleanup(outcome === 'aborted' || outcome === 'refused' ? 0 : 2.5);
    // « Recommencer » n'a de sens que si la mission peut repartir tout de suite
    const retry = !ok && r.code !== 'locked' && r.code !== 'cooldown' && def.level <= levelForMissionsDone(done) && cooldownLeft(id) <= 0;
    // suivante : jamais la mission qui vient de finir (son cooldown n'est pas encore dans store.me)
    let next = null;
    try { next = g.advisor?.suggestNext?.(p.x, p.z, id, { level: levelForMissionsDone(done), y: p.y }) || null; } catch (e) { console.warn('[gameplay] mission suivante', e); }
    bus.emit('mission:end', {
      id, title: def.title, type: def.type, outcome, reason: r.reason || '', code: r.code || null, reward: ok ? (fin(r.reward) ? r.reward : def.reward) : 0,
      sec, cls, best: fin(r.best) ? r.best : null, pb: !!r.pb, rank: r.rank || 0, prev: r.prev || null, roomBest: r.roomBest || null, first: r.first || 0, star: r.star || 0,
      remain, next, retry, level: levelInfo(done),
    });
    // un abandon est un choix du joueur : pas de jingle d'échec (la carte « Mission abandonnée » suffit)
    if (ok) ctx.audio?.play?.('missionSuccess'); else if (outcome !== 'aborted') ctx.audio?.play?.('missionFail');
    if (!ok) return;
    const lv = levelForMissionsDone(done);
    if (fin(r.done)) { if (lv > before) announceLevel(lv); else refreshStartMarkers(); }
    // repli (serveur sans `done`) : le compteur arrive avec le profil, on re-vérifie le niveau un peu plus tard
    else setTimeout(() => { const after = Math.max(lv, level()); if (after > before) announceLevel(after); else refreshStartMarkers(); }, 300);
  }
  /** Échec local (chrono, dégâts, véhicule perdu) ou abandon : `reason` est un texte court, en minuscules, affichable tel quel. */
  function fail(reason, outcome = 'failed', code = null) {
    const a = active;
    if (!a) return;
    bus.emit('intent:missionAbort', { id: a.def.id, reason });
    finish(outcome, { reason, code });
  }
  function abortMission() {
    if (tracked) { untrack(); if (!active) return true; }
    if (!active || active.phase !== 'active') return false;
    fail('abandon', 'aborted', 'abort');
    return true;
  }
  function complete() {
    const a = active;
    a.phase = 'reporting';
    a.reportT = 0;
    a.text = 'Mission accomplie !';
    a.timeLeft = null;
    a.levelBefore = level(); a.doneBefore = missionsDone();
    markers.clear('objective');
    g.nav.clear('mission');
    const durationSec = Math.round(((performance.now() - a.t0) / 1000) * 10) / 10;
    emitUpdate();
    bus.emit('intent:missionComplete', { id: a.def.id, durationSec });
  }
  bus.on('mission:result', (r) => {
    const a = active;
    if (!a || !r || r.id !== a.def.id) return;
    if (a.phase === 'active') {
      // refus dès le démarrage (cooldown serveur, niveau, mission inconnue…)
      if (r.ok === false) finish('refused', r);
      return;
    }
    finish(r.ok ? 'success' : 'refused', r);
  });

  // dégâts : cumul des impacts signalés par le module véhicules
  bus.on('vehicle:crash', (e) => {
    const a = active;
    if (!a || a.phase !== 'active' || a.def.maxDamage == null || !e) return;
    const v = a.vehicle || ctx.player?.vehicle;
    if (!v || e.vehicle !== v) return;
    const impact = Math.abs(+e.impact || 0);
    if (impact > 4) a.crashSum += impact - 4; // même seuil que le modèle de dégâts des véhicules
  });

  // ---------------------------------------------------------------- boucle
  function stepDone(i) {
    const a = active, s = a.steps[i], m = a.def;
    a.hold = 0;
    // (pas de toast « … monte à bord » : son bip tombait sur le ding d'étape, et le suivi affiche déjà « Le client monte… »)
    if (s.kind === 'pickup' && a.passenger) { a.aboard = true; a.passenger.group.visible = false; }
    if (s.kind === 'dropoff' && a.passenger) {
      a.aboard = false;
      const p = g.playerPos();
      // le client descend sur le trottoir, au niveau où l'on se trouve
      const side = g.accessPoint(p.x, p.z);
      a.passenger.group.position.set(side.x, g.sameLevel(side.y, p.y, 3) ? side.y : p.y, side.z);
      a.passenger.group.visible = true;
      a.passenger.setState?.({ anim: 'idle', speed: 0 });
    }
    if (s.kind === 'photo') { g.flash(); ctx.audio?.play?.('photo'); }
    else ctx.audio?.play?.('checkpoint');
    bus.emit('mission:step', { id: m.id, stepIndex: i, label: s.label, kind: s.kind });
    if (m.anyOrder) a.done.add(i); else a.stepIndex = i + 1;
    const remaining = m.anyOrder ? a.steps.length - a.done.size : a.steps.length - a.stepIndex;
    if (remaining <= 0) { complete(); return; }
    if (m.legTimeSec) a.timeLeft = currentTargets()[0].legTimeSec;
    if (m.anyOrder) g.toast(`${s.label} : livré ! Encore ${remaining}.`, 'success');
    lastObjectiveSig = '';
    store.set({ mission: publicState() });
  }

  function refreshObjective(targets, vehicleHint) {
    const a = active;
    const sig = targets.map((s) => a.steps.indexOf(s)).join(',') + '|' + (vehicleHint ? `${Math.round(vehicleHint.x / 3)}:${Math.round(vehicleHint.z / 3)}` : '');
    if (sig === lastObjectiveSig) return;
    lastObjectiveSig = sig;
    const list = targets.map((s) => ({ x: s.x, z: s.z, y: s.y, color: OBJECTIVE_COLOR, icon: STEP_ICON[s.kind] ?? ICON.flag, radius: s.radius, beamH: 120, beamR: 1.4, range: 1e5, iconSize: 2.6, iconY: 5.5 }));
    if (!a.def.anyOrder) {
      const next = a.steps[a.stepIndex + 1];
      if (next) list.push({ x: next.x, z: next.z, y: next.y, color: '#ffffff', icon: null, radius: next.radius * 0.8, beamH: 35, beamR: 0.5, range: 900 });
    }
    if (vehicleHint) list.push({ x: vehicleHint.x, z: vehicleHint.z, y: vehicleHint.y, color: '#c77dff', icon: ICON.car, radius: 0, beamH: 45, beamR: 0.6, range: 1e5, iconSize: 2, iconY: 4.2 });
    markers.set('objective', list);
  }

  function update(dt) {
    const player = ctx.player;
    const p = g.playerPos();

    if (drops.length) updateDrops();
    // mission suivie : démarrage automatique à l'arrivée au départ (un refus arrête le suivi au lieu d'insister)
    if (!active && tracked) {
      const st = resolved[tracked].start;
      if (within(p, st, START_RADIUS) && !startMission(tracked)) untrack();
    }
    const a = active;
    if (!a) return;

    if (a.phase === 'reporting') {
      a.reportT += dt;
      // pas de réponse du module net : la carte de fin le dit (plus de toast)
      if (a.reportT > 8) { finish('timeout', { reason: 'le serveur n\'a pas confirmé la mission', code: 'timeout' }); return; }
      // le suivi reste alimenté pendant l'attente (l'UI le masque après 3 s sans mission:update)
      hudT += dt;
      if (hudT >= 0.25) { hudT = 0; emitUpdate(); }
      return;
    }

    const m = a.def;
    a.elapsed += dt;
    const inVehicle = player?.mode === 'vehicle' && !!player.vehicle;
    const veh = inVehicle ? player.vehicle : null;
    const speed = Math.abs(veh ? veh.speed ?? player.speed ?? 0 : player?.speed ?? 0);
    if (veh && !a.sport && classOf(veh.typeId) === 's') a.sport = true;

    // --- dégâts ---
    if (m.maxDamage != null) {
      const v = a.vehicle || veh;
      if (v && typeof v.damage === 'number') {
        if (a.damageBase == null || a.damageV !== v) { a.damageBase = v.damage; a.damageV = v; }
        const scale = v.damage <= 1.0001 && a.damageBase <= 1.0001 ? 100 : 1; // dégâts normalisés 0..1 ou en points
        a.damage = Math.max(a.crashSum, (v.damage - a.damageBase) * scale);
      } else a.damage = a.crashSum;
      if (a.damage > m.maxDamage) { fail(m.type === 'convoy' ? 'la voiture est trop abîmée' : 'la marchandise est abîmée', 'failed', 'damage'); return; }
    }
    // --- véhicule fourni disparu ---
    if (a.vehicle && ctx.vehicles?.list && !ctx.vehicles.list.includes(a.vehicle)) { a.vehicle = null; fail('le véhicule a disparu', 'failed', 'vehicle'); return; }

    // --- conditions de véhicule ---
    let vehicleOk = true, vehicleMsg = '', vehicleHint = null;
    if (a.vehicle) {
      if (veh !== a.vehicle) { vehicleOk = false; vehicleMsg = `Montez dans la ${a.vehicle.spec?.name || VEHICLE_BY_ID[m.vehicle.typeId]?.name || 'voiture'}`; vehicleHint = a.vehicle.pos; }
    } else if (m.requireVehicle && !inVehicle) { vehicleOk = false; vehicleMsg = 'Montez dans un véhicule'; }
    // standing : une voiture À SOI (modèle possédé) du prix exigé — une berline empruntée dans la rue ne compte pas
    else if (m.vehicleMinPrice && veh && !((veh.spec?.price ?? 0) >= m.vehicleMinPrice && ownsCar(veh.typeId))) { vehicleOk = false; vehicleMsg = `Le client exige votre propre voiture, d'au moins ${fmtZ(m.vehicleMinPrice)}`; }

    // --- chrono (ne démarre qu'une fois au volant du véhicule fourni) ---
    if (a.timeLeft != null && !(a.vehicle && !a.started && !vehicleOk)) {
      a.timeLeft -= dt;
      if (a.timeLeft <= 0) { a.timeLeft = 0; fail('temps écoulé', 'failed', 'time'); return; }
    }
    if (vehicleOk) a.started = true;

    // --- étapes ---
    const targets = currentTargets();
    let nearest = null, nd = Infinity;
    for (const s of targets) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < nd) { nd = d; nearest = s; } }
    let text = nearest ? nearest.label : '';
    if (nearest && nd <= nearest.radius && g.sameLevel(p.y, nearest.y, 6, nearest.x, nearest.z)) {
      const s = nearest, i = a.steps.indexOf(s);
      let ok = true, need = s.holdSec || 0;
      if (s.kind === 'photo') {
        if (inVehicle) { ok = false; text = 'Descendez du véhicule pour photographier'; }
        else if (s.lookAt && !isLookingAt(s.lookAt)) { ok = false; text = `Cadrez : ${s.lookAt.name || 'le monument'} (tournez la caméra)`; }
        else if (s.goldenHours && !inHours(s.goldenHours)) { need *= 3; text = 'Lumière un peu plate… pose longue, ne bougez plus'; }
        else text = s.goldenHours ? 'Lumière dorée, parfait ! Ne bougez plus…' : 'Ne bougez plus… clic !';
      } else if (!vehicleOk && (m.requireVehicle || a.vehicle || m.vehicleMinPrice)) { ok = false; text = vehicleMsg; }
      else if (s.kind === 'pickup' || s.kind === 'dropoff' || s.kind === 'stop') {
        if (speed > 1.5) { ok = false; text = 'Arrêtez-vous'; }
        else text = s.kind === 'pickup' ? 'Le client monte…' : s.kind === 'dropoff' ? 'Le client descend…' : 'Patientez…';
      }
      if (ok) {
        a.hold += dt;
        if (a.hold >= need) { stepDone(i); if (!active || active.phase !== 'active') return; }
      } else a.hold = 0;
    } else {
      a.hold = 0;
      if (!vehicleOk) text = vehicleMsg;
    }
    a.text = text;
    // distance annoncée dans le suivi : ce qu'il reste du ruban GPS quand il mène à cette étape (la même mesure que
    // l'encart d'objectif — par la route, pas à vol d'oiseau), jamais moins que le vol d'oiseau ; sans itinéraire : vol d'oiseau
    const tgt = vehicleHint || nearest, air = vehicleHint ? Math.hypot(vehicleHint.x - p.x, vehicleHint.z - p.z) : nd === Infinity ? 0 : nd;
    const nv = g.nav, nd2 = nv.dest;
    const routed = !!tgt && !!nd2 && nd2.source === 'mission' && !!nv.path && fin(nv.left) && Math.hypot(nd2.x - tgt.x, nd2.z - tgt.z) < 2;
    a.distance = routed ? Math.max(air, nv.left) : air;

    // --- marqueurs, GPS et HUD (~4 fois/s) ---
    hudT += dt;
    if (hudT >= 0.25) {
      hudT = 0;
      const t2 = currentTargets();
      refreshObjective(t2, vehicleHint);
      const dest = vehicleHint ? { x: vehicleHint.x, z: vehicleHint.z, label: vehicleMsg, ele: g.eleOf(vehicleHint.x, vehicleHint.z, vehicleHint.y) } : nearestOf(t2, p);
      if (dest) g.nav.set(dest.x, dest.z, dest.label, 'mission', dest.ele);
      emitUpdate();
    }
  }

  const ownsCar = (typeId) => !!store.me?.cars?.includes?.(typeId);
  const nearestOf = (list, p) => {
    let b = null, bd = Infinity;
    for (const s of list) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; b = s; } }
    return b;
  };

  /** L'heure du jeu est-elle dans le créneau [h0, h1] ? */
  const inHours = ([h0, h1]) => { const h = +store.timeOfDay; return !Number.isFinite(h) || (h >= h0 && h <= h1); };

  /** La caméra regarde-t-elle vers la cible (à ±40° en horizontal) ? */
  const dir = new ctx.THREE.Vector3();
  function isLookingAt(t) {
    const cam = ctx.camera;
    cam.getWorldDirection(dir);
    const dx = t.x - cam.position.x, dz = t.z - cam.position.z;
    const l = Math.hypot(dx, dz) || 1, fl = Math.hypot(dir.x, dir.z) || 1;
    return (dir.x * dx + dir.z * dz) / (l * fl) > Math.cos((40 * Math.PI) / 180);
  }

  // premier profil reçu : le niveau de départ n'est pas une « montée de niveau »
  bus.on('net:welcome', () => { announced = Math.max(announced, level()); });

  refreshStartMarkers();
  // les cooldowns se terminent sans événement : rafraîchissement périodique des marqueurs de départ
  let slowT = 0;
  return {
    update(dt) { update(dt); slowT += dt; if (slowT > 5) { slowT = 0; if (!active) refreshStartMarkers(); } },
    collect, startMission, abortMission, untrack, getAvailableMissions, getMissionStates, refreshStartMarkers,
    level, missionsDone, cooldownLeft, neverDone, starId, levelInfo, resolved,
    get active() { return active; },
    get tracked() { return tracked; },
  };
}

function fmtTime(sec) {
  sec = Math.ceil(sec);
  return sec >= 60 ? `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s` : `${sec} s`;
}

// Déroulé des missions : départ, étapes, conditions, chrono, dégâts, passager, fin.
// L'argent n'est jamais touché ici : on émet intent:missionStart / intent:missionComplete,
// le module net répond par mission:result (+ money:change).
import { MISSIONS, MISSION_BY_ID, MISSION_TYPES, LEVELS, levelForMissionsDone } from '@shared/missions.js';
import { VEHICLE_BY_ID } from '@shared/catalog.js';
import { createCharacter } from '../player/index.js';
import { ICON } from './markers.js';

const TYPE_ICON = { delivery: ICON.parcel, taxi: ICON.person, race: ICON.clock, tour: ICON.pin, courier: ICON.parcel, convoy: ICON.car, photo: ICON.camera };
const STEP_ICON = { goto: ICON.flag, checkpoint: ICON.flag, pickup: ICON.person, dropoff: ICON.flag, stop: ICON.wait, photo: ICON.camera };
const START_RADIUS = 6;
const OBJECTIVE_COLOR = '#ffd60a';
const fmtZ = (n) => `${Math.round(n).toLocaleString('fr-FR')} Ƶ`;

export function createMissionRunner(g) {
  const { ctx, bus, store, markers } = g;

  // Positions résolues (recalées sur la chaussée) pour chaque mission.
  const resolved = {};
  for (const m of MISSIONS) {
    // départ au bord de la chaussée (carrossable si la mission se fait en voiture)
    const start = g.curbPoint(m.start.x, m.start.z, -1.6, m.requireVehicle ? g.drivable : null);
    resolved[m.id] = {
      start,
      steps: m.steps.map((s) => {
        const p = s.snap === false ? { x: s.x, z: s.z } : s.kind === 'photo' ? g.accessPoint(s.x, s.z) : g.roadPoint(s.x, s.z);
        return { ...s, x: p.x, z: p.z };
      }),
    };
  }

  let active = null; // mission en cours
  let tracked = null; // id de mission suivie au GPS (départ à rejoindre)
  let hudT = 0;
  let lastObjectiveSig = '';

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
  function status(m) {
    const lv = level();
    const cd = cooldownLeft(m.id);
    return { mission: m, locked: m.level > lv, cooldownLeft: cd, available: m.level <= lv && cd <= 0, start: resolved[m.id].start, done: g.save.data.count?.[m.id] || 0 };
  }
  const getAvailableMissions = () => MISSIONS.map(status).filter((s) => s.available).map((s) => s.mission);
  const getMissionStates = () => MISSIONS.map(status);

  // ---------------------------------------------------------------- marqueurs de départ
  function refreshStartMarkers() {
    if (active) { markers.clear('missionStarts'); return; }
    const list = [];
    for (const m of MISSIONS) {
      const st = status(m);
      const p = st.start;
      if (st.locked) list.push({ x: p.x, z: p.z, color: '#8d99ae', icon: ICON.lock, radius: 3.2, beamH: 0, range: 260, iconSize: 1.2, iconY: 3.4 });
      else if (st.cooldownLeft > 0) list.push({ x: p.x, z: p.z, color: '#8d99ae', icon: ICON.clock, radius: 3.2, beamH: 0, range: 320, iconSize: 1.2, iconY: 3.4 });
      else list.push({ x: p.x, z: p.z, color: MISSION_TYPES[m.type]?.color || '#ffb703', icon: TYPE_ICON[m.type] ?? ICON.mission, radius: 3.6, beamH: tracked === m.id ? 110 : 60, beamR: tracked === m.id ? 1.3 : 0.8, range: tracked === m.id ? 1e5 : 1500, iconSize: 2.3, iconY: 4.6 });
    }
    markers.set('missionStarts', list);
  }

  // ---------------------------------------------------------------- interaction (touche E)
  function collect(px, pz, out) {
    if (active) return;
    for (const m of MISSIONS) {
      const p = resolved[m.id].start;
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d > START_RADIUS + 1.5) continue;
      const st = status(m);
      let text, ok = false;
      if (st.locked) text = `${m.title} — niveau ${m.level} requis (${LEVELS[m.level - 1].missionsDone} missions réussies)`;
      else if (st.cooldownLeft > 0) text = `${m.title} — de nouveau disponible dans ${fmtTime(st.cooldownLeft)}`;
      else { text = `Démarrer « ${m.title} » — ${MISSION_TYPES[m.type]?.label || ''} · ${fmtZ(m.reward)}`; ok = true; }
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
      if (st.locked) { g.toast(`Niveau ${m.level} requis pour « ${m.title} ».`, 'error'); return false; }
      if (st.cooldownLeft > 0) { g.toast(`« ${m.title} » sera disponible dans ${fmtTime(st.cooldownLeft)}.`, 'info'); return false; }
      const p = g.playerPos();
      if (Math.hypot(p.x - st.start.x, p.z - st.start.z) > START_RADIUS + 2) {
        // trop loin : on guide jusqu'au départ, la mission démarrera à l'arrivée
        tracked = id;
        g.nav.set(st.start.x, st.start.z, `Départ : ${m.title}`, 'track');
        refreshStartMarkers();
        g.toast(`Rendez-vous au départ de « ${m.title} ».`, 'info');
        return true;
      }
    }
    tracked = null;
    const r = resolved[id];
    active = {
      def: m, steps: r.steps, phase: 'active', stepIndex: 0, done: new Set(),
      t0: performance.now(), elapsed: 0,
      timeLeft: typeof m.timeLimitSec === 'number' ? m.timeLimitSec : m.legTimeSec ? r.steps[0].legTimeSec : null,
      damage: 0, crashSum: 0, damageBase: null, hold: 0, vehicle: null, passenger: null, aboard: false,
      text: '', distance: 0, reportT: 0,
    };
    // véhicule fourni (convoyage, voiturier)
    if (m.vehicle?.provided && ctx.vehicles?.spawn) {
      const sp = g.lanePoint(r.start.x, r.start.z, 7);
      try {
        active.vehicle = ctx.vehicles.spawn(m.vehicle.typeId, sp.x, sp.z, sp.yaw, {});
        active.vehicle.mission = id;
      } catch (e) { console.warn('[gameplay] véhicule de mission', e); }
    }
    // passager PNJ qui attend à la première prise en charge
    const pick = r.steps.find((s) => s.kind === 'pickup');
    if (pick && m.passenger) {
      try {
        const c = createCharacter(ctx, { color: m.passenger.color, name: m.passenger.name });
        const side = g.accessPoint(pick.x, pick.z);
        c.group.position.set(side.x, ctx.heightAt?.(side.x, side.z) ?? 0, side.z);
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
    lastObjectiveSig = '';
    hudT = 1; // force un mission:update immédiat
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
      phase: a.phase, stepIndex, stepCount, step: step ? { label: step.label, kind: step.kind, x: step.x, z: step.z, radius: step.radius } : null,
      text: a.text, timeLeft: a.timeLeft, elapsed: a.elapsed, distance: a.distance,
      damage: a.def.maxDamage != null ? a.damage : null, maxDamage: a.def.maxDamage ?? null,
    };
  }
  function emitUpdate() {
    const s = publicState();
    if (!s) return;
    // mise à jour en place de store.mission (sans store:change à chaque tick), + événement dédié
    if (store.mission && store.mission.id === s.id) Object.assign(store.mission, s); else store.set({ mission: s });
    bus.emit('mission:update', { mission: s, step: s.step, stepIndex: s.stepIndex, stepCount: s.stepCount, text: s.text, timeLeft: s.timeLeft, distance: s.distance, damage: s.damage, maxDamage: s.maxDamage });
  }

  function currentTargets() {
    const a = active;
    if (!a) return [];
    if (a.def.anyOrder) return a.steps.filter((_, i) => !a.done.has(i));
    return a.stepIndex < a.steps.length ? [a.steps[a.stepIndex]] : [];
  }

  // ---------------------------------------------------------------- fin de mission
  function cleanup(removeVehicleDelay = 0) {
    const a = active;
    if (!a) return;
    if (a.passenger) { const c = a.passenger; setTimeout(() => { try { c.group.removeFromParent(); c.dispose?.(); } catch { /* déjà retiré */ } }, a.aboard ? 0 : 5000); if (a.aboard) c.group.visible = false; }
    if (a.vehicle) {
      const v = a.vehicle;
      const drop = () => { try { if (ctx.player?.vehicle === v) ctx.player.exitVehicle?.(); ctx.vehicles?.remove?.(v); } catch { /* ignore */ } };
      if (removeVehicleDelay > 0) setTimeout(drop, removeVehicleDelay * 1000); else drop();
    }
    active = null;
    markers.clear('objective');
    g.nav.clear('mission');
    store.set({ mission: null });
    bus.emit('mission:update', { mission: null, step: null, stepIndex: 0, stepCount: 0, text: '', timeLeft: null, distance: 0 });
    refreshStartMarkers();
  }
  function fail(reason, outcome = 'failed') {
    const a = active;
    if (!a) return;
    const id = a.def.id;
    cleanup(outcome === 'aborted' ? 0 : 2.5);
    bus.emit('intent:missionAbort', { id, reason });
    bus.emit('mission:end', { id, outcome, reason });
    ctx.audio?.play?.('missionFail');
    g.toast(outcome === 'aborted' ? `Mission abandonnée : ${a.def.title}` : `Mission échouée — ${reason}`, outcome === 'aborted' ? 'info' : 'error');
  }
  function abortMission() {
    if (tracked) { tracked = null; g.nav.clear('track'); refreshStartMarkers(); if (!active) return true; }
    if (!active || active.phase !== 'active') return false;
    fail('abandon', 'aborted');
    return true;
  }
  function complete() {
    const a = active;
    a.phase = 'reporting';
    a.reportT = 0;
    a.text = 'Mission accomplie !';
    a.timeLeft = null;
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
      // refus dès le démarrage (cooldown serveur, mission inconnue…)
      if (r.ok === false) { cleanup(0); g.toast(`Mission refusée${r.reason ? ' : ' + r.reason : ''}`, 'error'); bus.emit('mission:end', { id: r.id, outcome: 'refused', reason: r.reason }); }
      return;
    }
    const before = level();
    if (r.ok) {
      const d = g.save.data;
      d.done = (d.done || 0) + 1;
      d.last = { ...(d.last || {}), [r.id]: Date.now() };
      d.count = { ...(d.count || {}), [r.id]: (d.count?.[r.id] || 0) + 1 };
      g.save.write();
    }
    const def = a.def;
    cleanup(2.5);
    bus.emit('mission:end', { id: r.id, outcome: r.ok ? 'success' : 'refused', reason: r.reason, reward: r.reward });
    if (r.ok) {
      ctx.audio?.play?.('missionSuccess');
      // le compteur serveur (stats.missionsDone) peut arriver juste après : on re-vérifie le niveau un peu plus tard
      setTimeout(() => {
        const after = level();
        if (after > before) {
          const l = LEVELS[after - 1];
          g.toast(`Niveau ${after} atteint : ${l.title} ! Nouvelles missions débloquées.`, 'success');
          bus.emit('gameplay:levelUp', { level: after, title: l.title });
        }
        refreshStartMarkers();
      }, 300);
    } else if (def) {
      refreshStartMarkers();
    }
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
    if (s.kind === 'pickup' && a.passenger) { a.aboard = true; a.passenger.group.visible = false; g.toast(`${m.passenger?.name || 'Le client'} monte à bord.`, 'info'); }
    if (s.kind === 'dropoff' && a.passenger) {
      a.aboard = false;
      const p = g.playerPos(), side = g.accessPoint(p.x, p.z);
      a.passenger.group.position.set(side.x, ctx.heightAt?.(side.x, side.z) ?? 0, side.z);
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
    const list = targets.map((s) => ({ x: s.x, z: s.z, color: OBJECTIVE_COLOR, icon: STEP_ICON[s.kind] ?? ICON.flag, radius: s.radius, beamH: 120, beamR: 1.4, range: 1e5, iconSize: 2.6, iconY: 5.5 }));
    if (!a.def.anyOrder) {
      const next = a.steps[a.stepIndex + 1];
      if (next) list.push({ x: next.x, z: next.z, color: '#ffffff', icon: null, radius: next.radius * 0.8, beamH: 35, beamR: 0.5, range: 900 });
    }
    if (vehicleHint) list.push({ x: vehicleHint.x, z: vehicleHint.z, color: '#c77dff', icon: ICON.car, radius: 0, beamH: 45, beamR: 0.6, range: 1e5, iconSize: 2, iconY: 4.2 });
    markers.set('objective', list);
  }

  function update(dt) {
    const player = ctx.player;
    const p = g.playerPos();

    // mission suivie : démarrage automatique à l'arrivée au départ
    if (!active && tracked) {
      const st = resolved[tracked].start;
      if (Math.hypot(p.x - st.x, p.z - st.z) <= START_RADIUS) startMission(tracked);
    }
    const a = active;
    if (!a) return;

    if (a.phase === 'reporting') {
      a.reportT += dt;
      if (a.reportT > 8) { // pas de réponse du module net
        const id = a.def.id;
        cleanup(2.5);
        g.toast('Le serveur n\'a pas confirmé la mission. Réessayez.', 'error');
        bus.emit('mission:end', { id, outcome: 'timeout' });
      }
      return;
    }

    const m = a.def;
    a.elapsed += dt;
    const inVehicle = player?.mode === 'vehicle' && !!player.vehicle;
    const veh = inVehicle ? player.vehicle : null;
    const speed = Math.abs(veh ? veh.speed ?? player.speed ?? 0 : player?.speed ?? 0);

    // --- dégâts ---
    if (m.maxDamage != null) {
      const v = a.vehicle || veh;
      if (v && typeof v.damage === 'number') {
        if (a.damageBase == null || a.damageV !== v) { a.damageBase = v.damage; a.damageV = v; }
        const scale = v.damage <= 1.0001 && a.damageBase <= 1.0001 ? 100 : 1; // dégâts normalisés 0..1 ou en points
        a.damage = Math.max(a.crashSum, (v.damage - a.damageBase) * scale);
      } else a.damage = a.crashSum;
      if (a.damage > m.maxDamage) { fail(m.type === 'convoy' ? 'la voiture est trop abîmée' : 'la marchandise est abîmée'); return; }
    }
    // --- véhicule fourni disparu ---
    if (a.vehicle && ctx.vehicles?.list && !ctx.vehicles.list.includes(a.vehicle)) { a.vehicle = null; fail('le véhicule a disparu'); return; }

    // --- conditions de véhicule ---
    let vehicleOk = true, vehicleMsg = '', vehicleHint = null;
    if (a.vehicle) {
      if (veh !== a.vehicle) { vehicleOk = false; vehicleMsg = `Montez dans la ${a.vehicle.spec?.name || VEHICLE_BY_ID[m.vehicle.typeId]?.name || 'voiture'}`; vehicleHint = a.vehicle.pos; }
    } else if (m.requireVehicle && !inVehicle) { vehicleOk = false; vehicleMsg = 'Montez dans un véhicule'; }
    else if (m.vehicleMinPrice && veh && (veh.spec?.price ?? 0) < m.vehicleMinPrice) { vehicleOk = false; vehicleMsg = `Le client exige une voiture d'au moins ${fmtZ(m.vehicleMinPrice)}`; }

    // --- chrono (ne démarre qu'une fois au volant du véhicule fourni) ---
    if (a.timeLeft != null && !(a.vehicle && !a.started && !vehicleOk)) {
      a.timeLeft -= dt;
      if (a.timeLeft <= 0) { a.timeLeft = 0; fail('temps écoulé'); return; }
    }
    if (vehicleOk) a.started = true;

    // --- étapes ---
    const targets = currentTargets();
    let nearest = null, nd = Infinity;
    for (const s of targets) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < nd) { nd = d; nearest = s; } }
    let text = nearest ? nearest.label : '';
    if (nearest && nd <= nearest.radius) {
      const s = nearest, i = a.steps.indexOf(s);
      let ok = true;
      if (s.kind === 'photo') {
        if (inVehicle) { ok = false; text = 'Descendez du véhicule pour photographier'; }
        else if (s.lookAt && !isLookingAt(s.lookAt)) { ok = false; text = `Cadrez : ${s.lookAt.name || 'le monument'} (tournez la caméra)`; }
        else text = 'Ne bougez plus… clic !';
      } else if (!vehicleOk && (m.requireVehicle || a.vehicle || m.vehicleMinPrice)) { ok = false; text = vehicleMsg; }
      else if (s.kind === 'pickup' || s.kind === 'dropoff' || s.kind === 'stop') {
        if (speed > 1.5) { ok = false; text = 'Arrêtez-vous'; }
        else text = s.kind === 'pickup' ? 'Le client monte…' : s.kind === 'dropoff' ? 'Le client descend…' : 'Patientez…';
      }
      if (ok) {
        a.hold += dt;
        if (a.hold >= (s.holdSec || 0)) { stepDone(i); if (!active || active.phase !== 'active') return; }
      } else a.hold = 0;
    } else {
      a.hold = 0;
      if (!vehicleOk) text = vehicleMsg;
    }
    a.text = text;
    a.distance = vehicleHint ? Math.hypot(vehicleHint.x - p.x, vehicleHint.z - p.z) : nd === Infinity ? 0 : nd;

    // --- marqueurs, GPS et HUD (~4 fois/s) ---
    hudT += dt;
    if (hudT >= 0.25) {
      hudT = 0;
      const t2 = currentTargets();
      refreshObjective(t2, vehicleHint);
      const dest = vehicleHint ? { x: vehicleHint.x, z: vehicleHint.z, label: vehicleMsg } : nearestOf(t2, p);
      if (dest) g.nav.set(dest.x, dest.z, dest.label, 'mission');
      emitUpdate();
    }
  }

  const nearestOf = (list, p) => {
    let b = null, bd = Infinity;
    for (const s of list) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; b = s; } }
    return b;
  };

  /** La caméra regarde-t-elle vers la cible (à ±40° en horizontal) ? */
  const dir = new ctx.THREE.Vector3();
  function isLookingAt(t) {
    const cam = ctx.camera;
    cam.getWorldDirection(dir);
    const dx = t.x - cam.position.x, dz = t.z - cam.position.z;
    const l = Math.hypot(dx, dz) || 1, fl = Math.hypot(dir.x, dir.z) || 1;
    return (dir.x * dx + dir.z * dz) / (l * fl) > Math.cos((40 * Math.PI) / 180);
  }

  refreshStartMarkers();
  // les cooldowns se terminent sans événement : rafraîchissement périodique des marqueurs de départ
  let slowT = 0;
  return {
    update(dt) { update(dt); slowT += dt; if (slowT > 5) { slowT = 0; if (!active) refreshStartMarkers(); } },
    collect, startMission, abortMission, getAvailableMissions, getMissionStates, refreshStartMarkers,
    level, missionsDone, cooldownLeft, resolved,
    get active() { return active; },
    get tracked() { return tracked; },
  };
}

function fmtTime(sec) {
  sec = Math.ceil(sec);
  return sec >= 60 ? `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s` : `${sec} s`;
}

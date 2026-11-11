// Module gameplay : missions, GPS, immobilier, concessions, garages, voiture personnelle, à-côtés.
// PROPRIÉTAIRE : agent "gameplay". Voir docs/ARCHITECTURE.md pour les contrats.
// Règle d'or : l'argent n'est JAMAIS modifié ici — on émet des intent:*, le module net tranche.
import { MISSIONS, MISSION_BY_ID, LEVELS } from '@shared/missions.js';
import { PROPERTIES } from '@shared/properties.js';
import { LANDMARKS } from '@shared/landmarks.js';
import { createMarkers, ICON } from './markers.js';
import { createRoadIndex, createRouter, projectOnPath } from './gps.js';
import { createMissionRunner } from './missionRunner.js';
import { createEstate } from './estate.js';
import { COLLECTIBLES } from './places.js';

export function createGameplay(ctx) {
  const { bus, store } = ctx;
  const markers = createMarkers(ctx);
  const roads = createRoadIndex(ctx.worldData);
  const router = createRouter(ctx.worldData);
  const drivable = (r) => r.kind !== 'pedestrian';

  // ---------------------------------------------------------------- utilitaires partagés
  const playerPos = () => ctx.player?.pos || { x: 0, y: 0, z: 0 };
  const toast = (text, kind = 'info') => bus.emit('toast', { text, kind });

  /** Point au bord de la chaussée la plus proche, du côté de (x,z). outside > 0 = sur le trottoir. */
  function curbPoint(x, z, outside = -1.6, filter = null) {
    let n = filter ? roads.nearest(x, z, 260, filter) : null;
    if (!n) n = roads.nearest(x, z, 260);
    if (!n) return { x, z, yaw: 0, dirX: 1, dirZ: 0, perpX: 0, perpZ: 1, road: null, half: 4, ax: x, az: z };
    const half = (n.road?.width || 8) / 2;
    const px = -n.dirZ * n.side, pz = n.dirX * n.side; // perpendiculaire, vers le point d'origine
    const off = Math.max(0, half + outside);
    return { x: n.x + px * off, z: n.z + pz * off, yaw: n.yaw, dirX: n.dirX, dirZ: n.dirZ, perpX: px, perpZ: pz, road: n.road, half, ax: n.x, az: n.z };
  }
  /** true si un disque de rayon r est libre de tout obstacle statique (immeubles, mobilier). */
  function freeSpot(x, z, r = 0.6) {
    try { return !ctx.collision?.test?.(x, z, r, 1); } catch { return true; }
  }
  /** Point d'accès piéton près d'une adresse : sur le trottoir si possible, sinon de plus en plus près de la chaussée. */
  function accessPoint(x, z, filter = null) {
    let c = null;
    for (const outside of [2.2, 1.2, 0.3, -1.2]) {
      c = curbPoint(x, z, outside, filter);
      if (!c.road || freeSpot(c.x, c.z, 0.7)) return c;
    }
    return c;
  }
  /** Recale un point sur l'axe de la chaussée carrossable la plus proche s'il est hors chaussée. */
  function roadPoint(x, z, maxSnap = 160) {
    const n = roads.nearest(x, z, maxSnap, drivable);
    if (!n) return { x, z };
    const half = (n.road?.width || 8) / 2;
    return n.dist > half - 1.5 ? { x: n.x, z: n.z } : { x, z };
  }
  /** Emplacement pour poser une voiture : voie de droite de la rue la plus proche, `ahead` mètres plus loin. */
  function lanePoint(x, z, ahead = 6) {
    const n = roads.nearest(x, z, 600, drivable);
    if (n) {
      const half = (n.road?.width || 8) / 2;
      const lat = n.road?.oneway ? 0 : Math.min(half * 0.5, 3.2);
      return { x: n.x - n.dirZ * lat + n.dirX * ahead, z: n.z + n.dirX * lat + n.dirZ * ahead, yaw: n.yaw, road: n.road };
    }
    try { const w = ctx.world?.nearestRoadPoint?.(x, z); if (w) return { x: w.x, z: w.z, yaw: w.yaw ?? 0, road: w.road }; } catch { /* module ville indisponible */ }
    return { x: x + 3, z, yaw: ctx.player?.yaw ?? 0, road: null };
  }

  // sauvegarde locale (statistiques sans argent : progression de secours, cooldowns, collection)
  const save = {
    key: 'mz.gameplay.anon', data: {},
    load(name) {
      save.key = 'mz.gameplay.' + (name || 'anon');
      try { save.data = JSON.parse(localStorage.getItem(save.key) || '{}') || {}; } catch { save.data = {}; }
    },
    write() { try { localStorage.setItem(save.key, JSON.stringify(save.data)); } catch { /* stockage indisponible */ } },
  };
  save.load(ctx.params?.get?.('name'));

  // flash d'appareil photo
  let flashEl = null;
  function flash() {
    if (!ctx.uiRoot) return;
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.style.cssText = 'position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .45s ease-out;z-index:5';
      ctx.uiRoot.appendChild(flashEl);
    }
    flashEl.style.transition = 'none'; flashEl.style.opacity = '0.85';
    requestAnimationFrame(() => requestAnimationFrame(() => { flashEl.style.transition = 'opacity .45s ease-out'; flashEl.style.opacity = '0'; }));
  }

  // ---------------------------------------------------------------- GPS / navigation
  const PRIO = { manual: 0, track: 1, mission: 2 };
  let emitting = false;
  const nav = {
    dest: null, path: null, length: 0, routedAt: 0, routedFrom: null,
    set(x, z, label = '', source = 'manual') {
      const d = nav.dest;
      if (d && PRIO[d.source] > PRIO[source]) return;
      if (d && d.source === source && Math.hypot(d.x - x, d.z - z) < 2 && d.label === label) return;
      nav.dest = { x, z, label, source };
      reroute();
    },
    clear(source) {
      if (!nav.dest || (source && nav.dest.source !== source)) return;
      nav.dest = null; nav.path = null;
      markers.clearRibbon();
      emitting = true; bus.emit('gps:clear', { source: 'gameplay' }); emitting = false;
    },
  };
  function reroute() {
    const d = nav.dest;
    if (!d) return;
    const p = playerPos();
    const r = router.route(p.x, p.z, d.x, d.z);
    nav.path = r.path; nav.length = r.length; nav.routedAt = ctx.time; nav.routedFrom = { x: p.x, z: p.z };
    markers.setRibbonColor(d.source === 'mission' ? 0xffd60a : 0x35d0ff);
    emitting = true;
    bus.emit('gps:set', { x: d.x, z: d.z, label: d.label, path: r.path, distance: r.length, source: 'gameplay' });
    emitting = false;
  }
  // l'UI (carte) peut poser une destination sans itinéraire : on calcule le trajet et on réémet avec `path`
  bus.on('gps:set', (e) => { if (emitting || !e || e.source === 'gameplay' || typeof e.x !== 'number') return; nav.set(e.x, e.z, e.label || 'Destination', 'manual'); });
  bus.on('gps:clear', () => { if (emitting) return; if (nav.dest?.source === 'manual') { nav.dest = null; nav.path = null; markers.clearRibbon(); } });

  let navT = 0;
  function updateNav(dt) {
    navT += dt;
    if (navT < 0.2) return;
    navT = 0;
    const d = nav.dest;
    if (!d || !nav.path) return;
    const p = playerPos();
    const direct = Math.hypot(d.x - p.x, d.z - p.z);
    if (d.source === 'manual' && direct < 12) { nav.clear('manual'); toast('Vous êtes arrivé à destination.', 'info'); return; }
    const proj = projectOnPath(nav.path, p.x, p.z);
    const since = ctx.time - nav.routedAt;
    if (since > 1.5 && (proj.dist > 45 || (since > 8 && proj.dist > 18))) { reroute(); return; }
    markers.setRibbon(nav.path, proj.index, proj.t, 340, ctx.player?.mode === 'vehicle' ? 3 : 1.6);
  }

  // ---------------------------------------------------------------- sous-modules
  const g = { ctx, bus, store, markers, roads, router, nav, save, playerPos, toast, flash, curbPoint, accessPoint, freeSpot, drivable, roadPoint, lanePoint, missions: null, estate: null };
  const missions = (g.missions = createMissionRunner(g));
  const estate = (g.estate = createEstate(g));

  // ---------------------------------------------------------------- à-côtés : macarons dorés et découverte des monuments
  const collectibles = COLLECTIBLES.map((c) => (c.snap === false ? { ...c } : { ...c, ...roadPointOrSelf(c) }));
  function roadPointOrSelf(c) { const p = accessPoint(c.x, c.z); return { x: p.x, z: p.z }; }
  function refreshExtras() {
    const found = save.data.found || [];
    markers.set('extras', collectibles.filter((c) => !found.includes(c.id)).map((c) => ({ x: c.x, z: c.z, color: '#ffd166', icon: ICON.star, radius: 1.1, beamH: 7, beamR: 0.25, range: 170, iconSize: 1.1, iconY: 1.7 })));
  }
  let extraT = 0;
  function updateExtras(dt) {
    extraT += dt;
    if (extraT < 0.3) return;
    extraT = 0;
    const p = playerPos();
    const d = save.data;
    for (const c of collectibles) {
      if (d.found?.includes(c.id)) continue;
      if (Math.hypot(c.x - p.x, c.z - p.z) < 3.2) {
        d.found = [...(d.found || []), c.id];
        save.write();
        refreshExtras();
        ctx.audio?.play?.('pickup');
        toast(`Macaron doré trouvé (${c.label}) — ${d.found.length}/${collectibles.length}`, 'success');
        bus.emit('gameplay:collect', { id: c.id, count: d.found.length, total: collectibles.length });
        if (d.found.length === collectibles.length) toast('Tous les macarons dorés de Paris sont à vous. Chapeau !', 'success');
      }
    }
    for (const l of LANDMARKS) {
      if (l.hidden) continue;
      if (d.seen?.includes(l.id)) continue;
      if (Math.hypot(l.x - p.x, l.z - p.z) < l.radius + 70) {
        d.seen = [...(d.seen || []), l.id];
        save.write();
        toast(`Monument découvert : ${l.name} (${d.seen.length}/${LANDMARKS.filter((m) => !m.hidden).length})`, 'success');
        bus.emit('gameplay:discover', { id: l.id, name: l.name, count: d.seen.length, total: LANDMARKS.filter((m) => !m.hidden).length });
      }
    }
  }
  refreshExtras();

  // ---------------------------------------------------------------- interaction (E) et invite à l'écran
  let hintEl = null, hintSig = '', hintT = 0, current = null;
  function nearestInteractable() {
    const p = playerPos();
    const out = [];
    missions.collect(p.x, p.z, out);
    estate.collect(p.x, p.z, out);
    out.sort((a, b) => a.d - b.d);
    return out[0] || null;
  }
  function showHint(it) {
    const sig = it ? it.text + '|' + it.sub : '';
    if (sig === hintSig) return;
    hintSig = sig;
    bus.emit('interact:hint', it ? { text: it.text, sub: it.sub || '', key: it.key ? 'E' : null } : null);
    if (!ctx.uiRoot || api.showHints === false) { if (hintEl) hintEl.style.opacity = '0'; return; }
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.className = 'gp-hint';
      hintEl.style.cssText = 'position:absolute;left:50%;bottom:25%;transform:translateX(-50%);max-width:min(620px,86vw);padding:10px 16px;border-radius:12px;'
        + 'background:rgba(12,15,22,.78);color:#fff;font:600 15px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none;'
        + 'box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.14);opacity:0;transition:opacity .18s;z-index:4';
      ctx.uiRoot.appendChild(hintEl);
    }
    if (!it) { hintEl.style.opacity = '0'; return; }
    hintEl.textContent = '';
    const l1 = document.createElement('div');
    if (it.key) {
      const k = document.createElement('span');
      k.textContent = 'E';
      k.style.cssText = 'display:inline-block;min-width:22px;margin-right:9px;padding:1px 6px;border-radius:6px;background:#ffd60a;color:#111;font-weight:800';
      l1.appendChild(k);
    }
    l1.appendChild(document.createTextNode(it.text));
    hintEl.appendChild(l1);
    if (it.sub) {
      const l2 = document.createElement('div');
      l2.textContent = it.sub;
      l2.style.cssText = 'margin-top:3px;font-weight:400;font-size:13px;opacity:.82';
      hintEl.appendChild(l2);
    }
    hintEl.style.opacity = '1';
  }
  const uiOpen = () => { try { return !!ctx.ui?.isOpen?.(); } catch { return false; } };
  bus.on('player:interact', () => {
    if (uiOpen()) return;
    const it = nearestInteractable();
    if (it) { try { it.action(); } catch (e) { console.error('[gameplay] interaction', e); } }
  });

  // ---------------------------------------------------------------- événements globaux
  bus.on('net:welcome', () => {
    save.load(store.me?.name);
    refreshExtras();
    publishLevel();
    missions.refreshStartMarkers();
  });
  // Le niveau est une notion gameplay (dérivée de stats.missionsDone) : on le publie dans store.me.stats.level
  // (écriture en place, sans store.set) pour que l'UI puisse l'afficher sans dépendre de ce module.
  const publishLevel = () => { const st = store.me?.stats; if (st && typeof st === 'object' && st.level !== missions.level()) st.level = missions.level(); };
  bus.on('store:change', (patch) => { if (patch?.me) { publishLevel(); if (patch.me.stats || patch.me.cooldowns) missions.refreshStartMarkers(); } });
  bus.on('mission:end', publishLevel);
  bus.on('intent:missionAbortRequest', () => missions.abortMission()); // pour l'UI (bouton « Abandonner »)

  // ---------------------------------------------------------------- API publique
  const api = {
    missions: MISSIONS,
    properties: PROPERTIES,
    levels: LEVELS,
    dealers: estate.dealers.map((d) => ({ ...d.def, x: d.x, z: d.z })),
    garages: estate.garages.map((k) => ({ ...k.def, x: k.x, z: k.z })),
    showHints: true,
    startMission: (id, opts) => missions.startMission(id, opts),
    abortMission: () => missions.abortMission(),
    getAvailableMissions: () => missions.getAvailableMissions(),
    /** État détaillé de toutes les missions : [{ mission, available, locked, cooldownLeft, start:{x,z}, done }] */
    getMissionStates: () => missions.getMissionStates(),
    getMission: (id) => MISSION_BY_ID[id] || null,
    get activeMission() { return store.mission; },
    get level() { return missions.level(); },
    get missionsDone() { return missions.missionsDone(); },
    /** Lance le guidage GPS vers (x,z). Retourne { path, length }. */
    routeTo(x, z, label = 'Destination') { nav.set(x, z, label, 'manual'); return { path: nav.path, length: nav.length }; },
    clearRoute() { nav.clear('manual'); },
    /** Calcule un itinéraire sans l'afficher : { path: [[x,z],...], length, routed } */
    computeRoute: (ax, az, bx, bz) => router.route(ax, az, bx, bz),
    nearestRoadPoint: (x, z) => roads.nearest(x, z, 600),
    spawnPersonalCar: (typeId) => estate.spawnPersonalCar(typeId),
    get personalCar() { return estate.personalCar; },
    get stats() { return { missionsDone: missions.missionsDone(), level: missions.level(), collectibles: (save.data.found || []).length, collectiblesTotal: collectibles.length, landmarksSeen: (save.data.seen || []).length }; },
    update(dt) {
      missions.update(dt);
      estate.update(dt);
      updateNav(dt);
      updateExtras(dt);
      hintT += dt;
      if (hintT > 0.15) { hintT = 0; current = uiOpen() ? null : nearestInteractable(); showHint(current); }
      markers.update(dt);
    },
  };
  return api;
}

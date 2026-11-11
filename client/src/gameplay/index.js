// Module gameplay : missions, GPS, immobilier, concessions, garages, voiture personnelle, à-côtés.
// PROPRIÉTAIRE : agent "gameplay". Voir docs/ARCHITECTURE.md pour les contrats.
// Règle d'or : l'argent n'est JAMAIS modifié ici — on émet des intent:*, le module net tranche.
// Multi-villes : tout le contenu vient de la ville courante (shared/missions.js, shared/properties.js,
// ./places.js) ; aucune coordonnée ni aucun nom de lieu en dur ici.
// Niveaux superposés : chaque point recalé sur une chaussée garde son élévation (`ele`, relative au relief)
// et sa hauteur (`y`) pour que marqueurs, voitures et personnages apparaissent sur le pont et non dessous.
import { MISSIONS, MISSION_BY_ID, LEVELS } from '@shared/missions.js';
import { PROPERTIES } from '@shared/properties.js';
import { LANDMARKS } from '@shared/landmarks.js';
import { baseHeightAt } from '@shared/terrain.js';
import { createMarkers, ICON } from './markers.js';
import { createRoadIndex, createRouter, projectOnPath, isDrivable, isStreet, isWalkable } from './gps.js';
import { createMissionRunner } from './missionRunner.js';
import { createEstate } from './estate.js';
import { COLLECTIBLES, COLLECTIBLE, SPAWN, PLACE } from './places.js';

export function createGameplay(ctx) {
  const { bus, store } = ctx;
  const roads = createRoadIndex(ctx.worldData);
  const router = createRouter(ctx.worldData);
  const drivable = isDrivable;

  // ---------------------------------------------------------------- utilitaires partagés
  const playerPos = () => ctx.player?.pos || { x: 0, y: 0, z: 0 };
  const toast = (text, kind = 'info') => bus.emit('toast', { text, kind });
  const fin = Number.isFinite;

  /**
   * Hauteur du sol en (x, z) pour une chaussée d'élévation relative `ele` (pont, trémie).
   * Sans élévation : le niveau de la rue. Avec : la surface du module ville à cette hauteur, ou à défaut relief + ele.
   */
  function groundY(x, z, ele) {
    let h;
    try {
      if (!fin(ele) || Math.abs(ele) < 0.3) h = ctx.heightAt(x, z);
      else {
        const yRoad = baseHeightAt(x, z) + ele;
        h = ctx.heightAt(x, z, yRoad + 0.6);
        if (!(Math.abs(h - yRoad) < 2.5)) h = yRoad;
      }
    } catch { h = 0; }
    return fin(h) ? h : 0;
  }
  /** Élévation relative au relief d'un objet situé à la hauteur y (indice pour choisir le bon niveau). */
  const eleOf = (x, z, y) => { if (!fin(y)) return undefined; try { return y - baseHeightAt(x, z); } catch { return undefined; } };
  /** Hauteur de la chaussée en (x, z) : celle que renvoie le module ville quand il la connaît, sinon groundY. */
  function roadY(x, z, ele) {
    const guess = groundY(x, z, ele);
    try {
      const w = ctx.world?.nearestRoadPoint?.(x, z, guess);
      if (w && fin(w.y) && Math.hypot(w.x - x, w.z - z) < 8 && Math.abs(w.y - guess) < 3) return w.y;
    } catch { /* module ville indisponible */ }
    return guess;
  }
  /**
   * Le joueur (hauteur y1) est-il au même niveau qu'un point (hauteur y2) ? Inconnu = oui.
   * Si (x, z) est fourni et que le sol n'a qu'UNE surface à cet endroit (pas de pont au-dessus d'une autre voie,
   * ou tablier pas encore construit par le module ville), il n'y a pas d'ambiguïté : oui.
   */
  function sameLevel(y1, y2, tol = 5, x, z) {
    if (!fin(y1) || !fin(y2) || Math.abs(y1 - y2) <= tol) return true;
    if (!fin(x) || !fin(z)) return false;
    try { return Math.abs(ctx.heightAt(x, z, Math.max(y1, y2) + 0.6) - ctx.heightAt(x, z, Math.min(y1, y2) - 50)) < 1.5; } catch { return true; }
  }

  /** Point au bord de la chaussée la plus proche, du côté de (x,z). outside > 0 = sur le trottoir. */
  function curbPoint(x, z, outside = -1.6, filter = isWalkable) {
    // eleHint = 0 : à distance comparable, on préfère une rue au niveau du sol à une trémie ou à un tablier
    let n = filter ? roads.nearest(x, z, 400, filter, 0) : null;
    if (!n && filter !== isWalkable) n = roads.nearest(x, z, 400, isWalkable, 0);
    if (!n) n = roads.nearest(x, z, 400, null, 0);
    if (!n) return { x, z, y: groundY(x, z), ele: undefined, yaw: 0, dirX: 1, dirZ: 0, perpX: 0, perpZ: 1, road: null, half: 4, ax: x, az: z };
    const half = (n.road?.width || 8) / 2;
    const px = -n.dirZ * n.side, pz = n.dirX * n.side; // perpendiculaire, vers le point d'origine
    const off = Math.max(0, half + outside);
    const cx = n.x + px * off, cz = n.z + pz * off;
    return { x: cx, z: cz, y: groundY(cx, cz, n.ele), ele: n.ele, yaw: n.yaw, dirX: n.dirX, dirZ: n.dirZ, perpX: px, perpZ: pz, road: n.road, half, ax: n.x, az: n.z };
  }
  /** true si un disque de rayon r est libre de tout obstacle statique (immeubles, mobilier) à la hauteur y. */
  function freeSpot(x, z, r = 0.6, y) {
    try { return !ctx.collision?.test?.(x, z, r, (fin(y) ? y : groundY(x, z)) + 1); } catch { return true; }
  }
  /** Point d'accès piéton près d'une adresse : sur le trottoir si possible, sinon de plus en plus près de la chaussée. */
  function accessPoint(x, z, filter = isWalkable) {
    let c = null;
    for (const outside of [2.2, 1.2, 0.3, -1.2]) {
      c = curbPoint(x, z, outside, filter);
      if (!c.road || freeSpot(c.x, c.z, 0.7, c.y)) return c;
    }
    return c;
  }
  /** Recale un point sur l'axe de la rue carrossable la plus proche s'il est hors chaussée. */
  function roadPoint(x, z, maxSnap = 160) {
    const n = roads.nearest(x, z, maxSnap, isStreet, 0) || roads.nearest(x, z, maxSnap, drivable, 0);
    if (!n) return { x, z, y: groundY(x, z) };
    const half = (n.road?.width || 8) / 2;
    const q = n.dist > half - 1.5 ? { x: n.x, z: n.z } : { x, z };
    return { ...q, ele: n.ele, y: groundY(q.x, q.z, n.ele) };
  }
  /**
   * Emplacement pour poser une voiture : voie de droite de la rue la plus proche, `ahead` mètres plus loin.
   * eleHint = élévation relative souhaitée (niveau du joueur ou du marqueur) ; retourne aussi y.
   */
  function lanePoint(x, z, ahead = 6, eleHint) {
    const hint = fin(eleHint) ? eleHint : 0; // sans indication : le niveau de la rue
    // avec indication : d'abord la chaussée où l'on se trouve, quelle qu'elle soit (un tablier de rocade compris)
    let n = fin(eleHint) ? roads.nearest(x, z, 30, drivable, hint) : null;
    if (n && Math.abs(n.ele - hint) > 2.5) n = null;
    n = n || roads.nearest(x, z, 600, isStreet, hint) || roads.nearest(x, z, 1500, drivable, hint);
    if (n) {
      const half = (n.road?.width || 8) / 2;
      const lat = n.road?.oneway ? 0 : Math.min(half * 0.5, 3.2);
      const lx = n.x - n.dirZ * lat + n.dirX * ahead, lz = n.z + n.dirX * lat + n.dirZ * ahead;
      return { x: lx, z: lz, y: roadY(lx, lz, n.ele), ele: n.ele, yaw: n.yaw, road: n.road };
    }
    try { const w = ctx.world?.nearestRoadPoint?.(x, z); if (w) return { x: w.x, z: w.z, y: fin(w.y) ? w.y : groundY(w.x, w.z), yaw: w.yaw ?? 0, road: w.road }; } catch { /* module ville indisponible */ }
    return { x: x + 3, z, y: groundY(x + 3, z), yaw: ctx.player?.yaw ?? 0, road: null };
  }
  const markers = createMarkers(ctx, { yAt: groundY });

  /** Point d'apparition d'un nouveau joueur dans la ville courante, recalé sur la chaussée (lu par le module joueur). */
  function computeSpawn() {
    if (!SPAWN || !fin(SPAWN.x) || !fin(SPAWN.z)) return null;
    let x = SPAWN.x, z = SPAWN.z, y, yaw = SPAWN.yaw;
    try {
      const w = ctx.world?.nearestRoadPoint?.(x, z);
      if (w && fin(w.x) && fin(w.z) && Math.hypot(w.x - x, w.z - z) < 200) { x = w.x; z = w.z; if (fin(w.y)) y = w.y; if (!fin(yaw)) yaw = w.yaw; }
    } catch { /* module ville indisponible */ }
    if (!fin(y)) {
      const n = roads.nearest(x, z, 200, isStreet) || roads.nearest(x, z, 200);
      if (n && (x === SPAWN.x && z === SPAWN.z)) { x = n.x; z = n.z; if (!fin(yaw)) yaw = n.yaw; }
      y = groundY(x, z, n && Math.hypot(n.x - x, n.z - z) < 4 ? n.ele : undefined);
    }
    // on apparaît tourné vers le monument de la place (yaw = 0 regarde vers -Z ; avant = (-sin yaw, -cos yaw))
    const l = SPAWN.lookAt ? LANDMARKS.find((m) => m.id === SPAWN.lookAt) : null;
    if (l && !fin(SPAWN.yaw)) yaw = Math.atan2(-(l.x - x), -(l.z - z));
    return { x, z, y, yaw: fin(yaw) ? yaw : 0, label: SPAWN.label || ctx.city?.name || '' };
  }
  const spawn = computeSpawn();

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
    dest: null, path: null, length: 0, time: 0, routedAt: 0, lastMs: 0,
    /** ele = élévation relative de la destination si elle est connue (pont, trémie). */
    set(x, z, label = '', source = 'manual', ele) {
      const d = nav.dest;
      if (d && PRIO[d.source] > PRIO[source]) return;
      if (d && d.source === source && Math.hypot(d.x - x, d.z - z) < 2 && d.label === label) return;
      nav.dest = { x, z, label, source, ele };
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
    // en voiture (ou de loin) : l'itinéraire le plus rapide, qui préfère les voies rapides ; à pied et tout près : le plus court
    const onFoot = ctx.player?.mode !== 'vehicle';
    const metric = onFoot && Math.hypot(d.x - p.x, d.z - p.z) < 700 ? 'distance' : 'time';
    const r = router.route(p.x, p.z, d.x, d.z, { metric, fromEle: eleOf(p.x, p.z, p.y), toEle: d.ele });
    nav.path = r.path; nav.length = r.length; nav.time = r.time; nav.routedAt = ctx.time; nav.lastMs = r.ms;
    markers.setRibbonColor(d.source === 'mission' ? 0xffd60a : 0x35d0ff);
    emitting = true;
    // path : [[x, z, ele?], ...] — la 3e composante (élévation relative de la chaussée) est facultative
    bus.emit('gps:set', { x: d.x, z: d.z, label: d.label, path: r.path, distance: r.length, time: r.time, source: 'gameplay' });
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
    // hors de l'itinéraire : on recalcule (au plus toutes les 1,5 s ; les longs calculs sont espacés davantage)
    const wait = Math.max(1.5, nav.lastMs / 10);
    if (since > wait && (proj.dist > 45 || (since > 8 && proj.dist > 18))) { reroute(); return; }
    markers.setRibbon(nav.path, proj.index, proj.t, 340, ctx.player?.mode === 'vehicle' ? 3 : 1.6);
  }

  // ---------------------------------------------------------------- sous-modules
  const g = { ctx, bus, store, markers, roads, router, nav, save, playerPos, toast, flash, curbPoint, accessPoint, freeSpot, drivable, isStreet, isWalkable, roadPoint, lanePoint, groundY, roadY, eleOf, sameLevel, missions: null, estate: null };
  const missions = (g.missions = createMissionRunner(g));
  const estate = (g.estate = createEstate(g));

  // ---------------------------------------------------------------- à-côtés : objets à collectionner et découverte des monuments
  const CK = COLLECTIBLE || { name: 'Objet', found: 'Objet trouvé', color: '#ffd166', allFound: 'Collection complète !' };
  const collectibles = (COLLECTIBLES || []).map((c) => {
    if (c.snap === false) return { ...c, y: groundY(c.x, c.z) };
    const p = accessPoint(c.x, c.z);
    return { ...c, x: p.x, z: p.z, y: p.y };
  });
  function refreshExtras() {
    const found = save.data.found || [];
    markers.set('extras', collectibles.filter((c) => !found.includes(c.id)).map((c) => ({ x: c.x, z: c.z, y: c.y, color: CK.color || '#ffd166', icon: ICON.star, radius: 1.1, beamH: 7, beamR: 0.25, range: 170, iconSize: 1.1, iconY: 1.7 })));
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
      if (Math.hypot(c.x - p.x, c.z - p.z) < 3.2 && sameLevel(p.y, c.y, 4, c.x, c.z)) {
        d.found = [...(d.found || []), c.id];
        save.write();
        refreshExtras();
        ctx.audio?.play?.('pickup');
        const mine = collectibles.filter((k) => d.found.includes(k.id)).length; // la sauvegarde est commune à toutes les villes
        toast(`${CK.found} (${c.label}) — ${mine}/${collectibles.length}`, 'success');
        bus.emit('gameplay:collect', { id: c.id, name: CK.name, count: mine, total: collectibles.length });
        if (mine === collectibles.length) toast(CK.allFound, 'success');
      }
    }
    for (const l of sights) {
      if (d.seen?.includes(l.id)) continue;
      if (Math.hypot(l.x - p.x, l.z - p.z) < l.radius + 70) {
        d.seen = [...(d.seen || []), l.id];
        save.write();
        const seen = sights.filter((m) => d.seen.includes(m.id)).length;
        toast(`Monument découvert : ${l.name} (${seen}/${sights.length})`, 'success');
        bus.emit('gameplay:discover', { id: l.id, name: l.name, count: seen, total: sights.length });
      }
    }
  }
  const sights = LANDMARKS.filter((l) => !l.hidden);
  refreshExtras();

  // ---------------------------------------------------------------- interaction (E) et invite à l'écran
  let hintEl = null, hintSig = '', hintT = 0, current = null;
  function nearestInteractable() {
    const p = playerPos();
    const out = [];
    missions.collect(p.x, p.z, out, p.y);
    estate.collect(p.x, p.z, out, p.y);
    // ce qui est utilisable passe avant ce qui est verrouillé ou en attente, puis le plus proche
    out.sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || a.d - b.d);
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
    /** Ville courante et ses repères nommés ({ nom: {x, z} }). */
    city: ctx.city?.id || null,
    places: PLACE,
    /** Point d'apparition d'un nouveau joueur : { x, z, yaw, y, label } (recalé sur la chaussée). */
    spawn,
    SPAWN: spawn,
    get activeMission() { return store.mission; },
    get level() { return missions.level(); },
    get missionsDone() { return missions.missionsDone(); },
    /** Lance le guidage GPS vers (x,z). Retourne { path, length }. */
    routeTo(x, z, label = 'Destination') { nav.set(x, z, label, 'manual'); return { path: nav.path, length: nav.length }; },
    clearRoute() { nav.clear('manual'); },
    /** Calcule un itinéraire sans l'afficher : { path: [[x,z,ele?],...], length, time, routed, partial, ms } ; opts = { metric, fromEle, toEle, budgetMs } */
    computeRoute: (ax, az, bx, bz, opts) => router.route(ax, az, bx, bz, opts),
    /** Point de chaussée le plus proche : { x, z, yaw, road, dist, ele, y } */
    nearestRoadPoint: (x, z, y) => { const n = roads.nearest(x, z, 600, null, eleOf(x, z, y)); return n ? { ...n, y: groundY(n.x, n.z, n.ele) } : null; },
    spawnPersonalCar: (typeId) => estate.spawnPersonalCar(typeId),
    get personalCar() { return estate.personalCar; },
    get stats() { return { missionsDone: missions.missionsDone(), level: missions.level(), collectibles: collectibles.filter((c) => (save.data.found || []).includes(c.id)).length, collectiblesTotal: collectibles.length, collectibleName: CK.name, landmarksSeen: sights.filter((l) => (save.data.seen || []).includes(l.id)).length, landmarksTotal: sights.length }; },
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

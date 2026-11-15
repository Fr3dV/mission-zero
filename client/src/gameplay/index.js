// Module gameplay : missions, GPS, immobilier, concessions, garages, voiture personnelle, à-côtés.
// PROPRIÉTAIRE : agent "gameplay". Voir docs/ARCHITECTURE.md pour les contrats.
// Règle d'or : l'argent n'est JAMAIS modifié ici — on émet des intent:*, le module net tranche.
// Multi-villes : tout le contenu vient de la ville courante (shared/missions.js, shared/properties.js,
// ./places.js) ; aucune coordonnée ni aucun nom de lieu en dur ici.
// Niveaux superposés : chaque point recalé sur une chaussée garde son élévation (`ele`, relative au relief)
// et sa hauteur (`y`) pour que marqueurs, voitures et personnages apparaissent sur le pont et non dessous.
//
// Boucle fun (contrat v6) — organisation interne. Chaque sous-module est une fabrique createXxx(g) rangée dans
// g.<nom> par use() et mise à jour chaque image dans l'ordre d'enregistrement. L'objet `g` porte l'API interne :
//   g.missions (missionRunner), g.estate, g.advisor, g.style (figures et combos), g.heat (képis et poursuite),
//   g.taxi (taxi libre), g.dare (Chiche), g.nav (GPS : set / clear / dest), g.route (itinéraire du joueur : à pied
//   sans les sens uniques — g.routerFoot —, au volant par g.router), g.touch() (écran tactile : pas de libellé de touche),
//   g.markers (couches de marqueurs), g.save (sauvegarde locale du compte), g.toast, g.playerPos, lanePoint…
//   g.activities : fournisseurs de l'activité en cours ({ kind, on() -> bool, get() -> { id, title, canAbort } | null, abort() }) ;
//   g.guards     : interdits croisés ((quoi, id) -> texte du refus | null), consultés par g.guard(quoi, id)
//                  avant 'mission', 'spawnCar', 'respawn', 'job' (prise en charge d'un client) et 'dare' (Chiche) ;
//   g.interact   : sources d'interactions pour la touche E ((px, pz, out, py) => out.push({ d, key, text, sub, action })).
// Textes composés ici (toasts, bandeaux, invite) : écritures communes dans ./text.js — argent « Ƶ 1 234 » / « +Ƶ 1 234 »,
// élision devant un pseudo (« Chiche d'Alice ») ; au tactile, aucun libellé de touche (g.touch()).
import { MISSIONS, MISSION_BY_ID, LEVELS } from '@shared/missions.js';
import { PROPERTIES } from '@shared/properties.js';
import { LANDMARKS } from '@shared/landmarks.js';
import { baseHeightAt } from '@shared/terrain.js';
import { createMarkers, ICON } from './markers.js';
import { createRoadIndex, createRouter, projectOnPath, isDrivable, isStreet, isWalkable } from './gps.js';
import { createMissionRunner } from './missionRunner.js';
import { createEstate } from './estate.js';
import { createAdvisor } from './advisor.js';
import { createStyle } from './style.js';
import { createHeat } from './heat.js';
import { createTaxi } from './taxi.js';
import { createDare } from './dare.js';
import { COLLECTIBLES, COLLECTIBLE, SPAWN, PLACE, RDV_POINTS } from './places.js';
import { de, typo } from './text.js';

// Pictogramme du bouton tactile « Interagir » (même tracé que player/input.js), pour l'invite à l'écran.
const HAND_SVG = '<svg viewBox="0 0 24 24" aria-label="Interagir"><path d="M8 12V6a1.6 1.6 0 013.2 0v5M11.2 10V4.6a1.6 1.6 0 013.2 0V11M14.4 7a1.6 1.6 0 013.2 0v8a6 6 0 01-11 3.2L4 14.5a1.6 1.6 0 012.6-1.8L8 14"/></svg>';

// Obstacles « mous » : un tronçon d'itinéraire hors chaussée peut les frôler (mobilier, voitures, marches).
const SOFT_TAGS = { tree: 1, lamp: 1, feu: 1, banc: 1, morris: 1, kiosque: 1, metro: 1, terrasse: 1, dealer: 1, vehicle: 1, tram: 1, chute: 1, marche: 1 };

export function createGameplay(ctx) {
  const { bus, store } = ctx;
  // Valeurs initiales des états que ce module écrit (store.js n'est pas modifiable ; tout lecteur tolère undefined).
  store.objective = null;
  store.style = { total: 0, mult: 1, left: 0, max: 6, best: 0 };
  store.heat = { level: 0, wanted: false, since: 0 };

  const roads = createRoadIndex(ctx.worldData);
  /**
   * Un tronçon hors chaussée (du point d'accroche sur la route jusqu'à la destination, ou l'inverse) coupe-t-il
   * un monument, un immeuble, un parapet ? Échantillonné tous les 2 m, extrémités exclues (une adresse est
   * souvent au pied d'une façade). L'itinéraire s'arrête alors au point d'accroche (voir gps.js).
   */
  function legBlocked(x0, z0, x1, z1, ele) {
    const col = ctx.collision;
    if (!col?.resolveCircle) return false;
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.min(120, Math.ceil(len / 2));
    if (n < 2) return false;
    const y = groundY(x0, z0, ele) + 1;
    for (let i = 1; i < n; i++) {
      const t = i / n, r = col.resolveCircle(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 0.8, y);
      if (r.hit && !SOFT_TAGS[r.tag]) return true;
    }
    return false;
  }
  const router = createRouter(ctx.worldData, 120, { blocked: legBlocked });
  // À pied, les sens uniques ne comptent pas : second routeur sur le même graphe, non orienté (arêtes des doubles
  // sens dédoublonnées). Sans graphe orienté, c'est le même routeur.
  const routerFoot = (() => {
    const wd = ctx.worldData, edges = wd?.graph?.edges;
    if (!wd?.meta?.graphDirected || !Array.isArray(edges)) return router;
    try {
      const n = wd.graph.nodes?.length || 0, seen = new Set(), list = [];
      for (const e of edges) {
        const a = e[0], b = e[1], k = a < b ? a * n + b : b * n + a;
        if (seen.has(k)) continue;
        seen.add(k); list.push(e);
      }
      return createRouter({ ...wd, graph: { ...wd.graph, edges: list }, meta: { ...wd.meta, graphDirected: false } }, 120, { blocked: legBlocked });
    } catch (e) { console.warn('[gameplay] routeur piéton', e); return router; }
  })();
  const onFoot = () => ctx.player?.mode !== 'vehicle';
  /** Itinéraire du joueur tel qu'il se déplace : à pied sans les sens uniques, au volant par le graphe des voitures. opts.foot force le choix. */
  const route = (ax, az, bx, bz, opts) => ((opts?.foot ?? onFoot()) ? routerFoot : router).route(ax, az, bx, bz, opts);
  const drivable = isDrivable;

  // ---------------------------------------------------------------- utilitaires partagés
  const playerPos = () => ctx.player?.pos || { x: 0, y: 0, z: 0 };
  const toast = (text, kind = 'info') => bus.emit('toast', { text, kind });
  const fin = Number.isFinite;
  // Écran tactile : aucun libellé de touche clavier (E, F, G) dans les textes. Lu au premier besoin, quand les
  // modules joueur et interface existent (ils sont créés après celui-ci).
  let touchK = null;
  const touch = () => {
    if (touchK !== null) return touchK;
    let t = false;
    try { t = !!(ctx.player?.input?.isTouch || ctx.ui?.touch || ctx.params?.get?.('touch') === '1'); } catch { t = false; }
    if (ctx.player?.input && ctx.ui) touchK = t;
    return t;
  };

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

  // sauvegarde locale (statistiques sans argent : progression de secours, cooldowns, collection), indexée par
  // l'identifiant du COMPTE (store.me.id) : le pseudo affiché peut être renommé par le serveur (« Alice2 »).
  // Tant que le compte n'est pas connu (écran d'accueil), rien n'est lu ni écrit.
  const save = {
    key: null, data: {},
    /** Charge la sauvegarde du compte `id` ; reprend UNE fois l'ancienne sauvegarde indexée par pseudo. */
    load(id, name) {
      save.key = id != null && id !== '' ? 'mz.gameplay.' + id : null;
      save.data = {};
      if (!save.key) return;
      try {
        let raw = localStorage.getItem(save.key);
        const old = name ? 'mz.gameplay.' + name : null;
        if (raw == null && old && old !== save.key) {
          raw = localStorage.getItem(old);
          if (raw != null) { localStorage.setItem(save.key, raw); localStorage.removeItem(old); }
        }
        save.data = JSON.parse(raw || '{}') || {};
      } catch { save.data = {}; }
    },
    write() { if (!save.key) return; try { localStorage.setItem(save.key, JSON.stringify(save.data)); } catch { /* stockage indisponible */ } },
  };
  try { localStorage.removeItem('mz.gameplay.anon'); } catch { /* stockage indisponible */ } // clé parasite des versions précédentes
  let welcomed = false; // profil reçu : la sauvegarde du compte est chargée

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
  // sources de guidage : destination posée à la main < départ suivi < activité en cours (mission, course de taxi, Chiche)
  const PRIO = { manual: 0, track: 1, job: 2, dare: 2, mission: 2 };
  const RIBBON = { mission: 0xffd60a, dare: 0xffd60a, job: 0x3ddc84 }; // ruban jaune (mission, Chiche), vert (course), bleu sinon
  let emitting = false;
  const nav = {
    // left = ce qu'il reste à parcourir le long du ruban (m), tenu à jour par updateNav ; length = longueur à l'instant du calcul
    dest: null, path: null, length: 0, left: 0, time: 0, routedAt: 0, lastMs: 0, cut: false, ox: 0, oz: 0,
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
  /** En voiture (ou de loin) : l'itinéraire le plus rapide, qui préfère les voies rapides ; à pied et tout près : le plus court. */
  const routeMetric = (ax, az, bx, bz) => (ctx.player?.mode !== 'vehicle' && Math.hypot(bx - ax, bz - az) < 700 ? 'distance' : 'time');
  function reroute() {
    const d = nav.dest;
    if (!d) return;
    const p = playerPos();
    const r = route(p.x, p.z, d.x, d.z, { metric: routeMetric(p.x, p.z, d.x, d.z), fromEle: eleOf(p.x, p.z, p.y), toEle: d.ele });
    nav.path = r.path; nav.length = r.length; nav.left = r.length; nav.time = r.time; nav.routedAt = ctx.time; nav.lastMs = r.ms;
    // départ coupé (aucun accès dégagé jusqu'à la chaussée) : le tracé ne part pas du joueur, on retient d'où il a été calculé
    nav.cut = !!r.cutStart; nav.ox = p.x; nav.oz = p.z;
    markers.setRibbonColor(RIBBON[d.source] ?? 0x35d0ff);
    emitting = true;
    // path : [[x, z, ele?], ...] — la 3e composante (élévation relative de la chaussée) est facultative
    bus.emit('gps:set', { x: d.x, z: d.z, label: d.label, path: r.path, distance: r.length, time: r.time, source: 'gameplay' });
    emitting = false;
  }
  /**
   * Destination choisie par le joueur (bouton GPS du téléphone, clic sur la carte) : elle remplace un départ suivi
   * (mission conseillée, Chiche) ; pendant une activité, le guidage de l'activité reste et le joueur lit pourquoi.
   */
  const BUSY_NAME = { mission: 'votre mission', job: 'votre course', dare: 'le Chiche' };
  function setManual(x, z, label) {
    const src = nav.dest?.source;
    if (src && PRIO[src] >= 2) {
      toast(`Terminez d'abord ${BUSY_NAME[src] || 'votre activité'} : le GPS y reste réglé.`, 'info');
      // La carte de l'interface doit se recaler sur la destination réelle. Mais cet appel a lieu PENDANT la diffusion de
      // son gps:set : réémis tout de suite, le nôtre serait traité avant l'événement d'origine, qui l'écraserait.
      // On réémet donc une fois la diffusion en cours terminée.
      setTimeout(() => { if (nav.dest && PRIO[nav.dest.source] >= 2) reroute(); }, 0);
      return false;
    }
    if (src === 'track') { try { missions.untrack(); advisor?.untrack?.(); } catch (e) { console.warn('[gameplay] suivi', e); } }
    nav.set(x, z, label, 'manual');
    return true;
  }
  // l'UI (carte) peut poser une destination sans itinéraire : on calcule le trajet et on réémet avec `path`
  bus.on('gps:set', (e) => { if (emitting || !e || e.source === 'gameplay' || typeof e.x !== 'number') return; setManual(e.x, e.z, e.label || 'Destination'); });
  bus.on('gps:clear', () => { if (emitting) return; if (nav.dest?.source === 'manual') { nav.dest = null; nav.path = null; markers.clearRibbon(); } });

  /** Longueur du tracé restant à partir de sa projection (segment index, abscisse t) jusqu'à son dernier point. */
  function pathLeft(path, index, t) {
    let sum = 0;
    for (let i = index; i < path.length - 1; i++) {
      const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
      sum += i === index ? l * (1 - t) : l;
    }
    return sum;
  }
  // monter ou descendre de voiture change de graphe (sens uniques) : le ruban est recalculé à la prochaine passe
  let navT = 0, modeDirty = false;
  const modeChanged = () => { modeDirty = true; };
  bus.on('player:enterVehicle', modeChanged);
  bus.on('player:exitVehicle', modeChanged);
  function updateNav(dt) {
    navT += dt;
    if (navT < 0.2) return;
    navT = 0;
    const d = nav.dest;
    if (modeDirty) { modeDirty = false; advisor?.poke?.(); if (d) { reroute(); return; } }
    if (!d || !nav.path) return;
    const p = playerPos();
    const direct = Math.hypot(d.x - p.x, d.z - p.z);
    if (d.source === 'manual' && direct < 12) { nav.clear('manual'); toast('Vous êtes arrivé à destination.', 'info'); return; }
    const proj = projectOnPath(nav.path, p.x, p.z);
    nav.left = proj.dist + pathLeft(nav.path, proj.index, proj.t); // l'écart au tracé compte : il reste à le rejoindre
    const since = ctx.time - nav.routedAt;
    // hors de l'itinéraire : on recalcule (au plus toutes les 1,5 s ; les longs calculs sont espacés davantage)
    const wait = Math.max(1.5, nav.lastMs / 10);
    // tracé au départ coupé : l'écart se mesure aussi au point d'où il a été calculé (sinon on recalculerait sans fin)
    const off = nav.cut ? Math.min(proj.dist, Math.hypot(p.x - nav.ox, p.z - nav.oz)) : proj.dist;
    if (since > wait && (off > 45 || (since > 8 && off > 18))) { reroute(); return; }
    markers.setRibbon(nav.path, proj.index, proj.t, 340, ctx.player?.mode === 'vehicle' ? 3 : 1.6);
  }

  // ---------------------------------------------------------------- sous-modules
  const g = { ctx, bus, store, markers, roads, router, routerFoot, route, nav, save, playerPos, toast, touch, flash, curbPoint, accessPoint, freeSpot, drivable, isStreet, isWalkable, roadPoint, lanePoint, groundY, roadY, eleOf, sameLevel, routeMetric, missions: null, estate: null, advisor: null, style: null, heat: null, taxi: null, dare: null };

  // interdits croisés : un sous-module pousse (quoi, id) => texte du refus | null (« Semez d'abord les képis »…)
  g.guards = [];
  g.guard = (what, id) => {
    for (const fn of g.guards) { try { const why = fn(what, id); if (why) return why; } catch (e) { console.warn('[gameplay] garde', e); } }
    return null;
  };
  // activité en cours hors mission : un sous-module pousse
  // { kind: 'job' | 'dare', on() -> bool, get() -> { id, title, canAbort } | null, abort() -> bool }
  g.activities = [];
  // sources d'interactions (touche E)
  g.interact = [];
  /** Une course de taxi ou un Chiche occupe-t-il le joueur ? (les missions se lisent dans g.missions.active) */
  g.busy = () => {
    // appelé chaque image par heat.js : aucune allocation ici (on() plutôt que get())
    for (let i = 0; i < g.activities.length; i++) {
      const a = g.activities[i];
      try { if (a.on ? a.on() : a.get?.()) return true; } catch { /* fournisseur en panne : ignoré */ }
    }
    const d = store.dare;
    return !!(d && d.mine) || !!store.job;
  };

  const subs = []; // sous-modules mis à jour chaque image, dans l'ordre d'enregistrement
  /** Crée un sous-module, le range dans g[name] et l'inscrit à la boucle. Une panne à la création ne casse pas le reste. */
  function use(name, create) {
    let m = null;
    try { m = create(g) || null; } catch (e) { console.error(`[gameplay] sous-module ${name}`, e); }
    g[name] = m;
    if (m?.update) subs.push(m);
    if (m?.collect) g.interact.push((px, pz, out, py) => m.collect(px, pz, out, py));
    return m;
  }
  const missions = use('missions', createMissionRunner);
  const estate = use('estate', createEstate);
  const advisor = use('advisor', createAdvisor);
  // style avant heat : heat.js lit g.style (figure 'cavale', combo confisqué) et style.js lit store.heat (bonus de poursuite)
  use('style', createStyle);
  use('heat', createHeat);
  // taxi et Chiche après heat : leurs interdits ('job', 'dare') s'ajoutent à celui de la poursuite, déjà inscrit
  use('taxi', createTaxi);
  use('dare', createDare);

  // ---------------------------------------------------------------- activité en cours et abandon unique
  /** Activité déclarée par un sous-module, sinon lue dans l'état réseau (store.job, store.dare) : { kind, id, title, canAbort } | null. */
  function extraActivity() {
    for (const a of g.activities) {
      let s = null;
      try { s = a.get?.(); } catch { s = null; }
      if (s) return { kind: a.kind, id: s.id ?? null, title: s.title || '', canAbort: s.canAbort !== false, abort: a.abort };
    }
    const d = store.dare;
    if (d && d.mine) return { kind: 'dare', id: d.id ?? null, title: `Chiche ${de(d.by?.name || 'la salle')}`, canAbort: true, abort: null };
    const j = store.job;
    if (j) return { kind: 'job', id: j.id ?? null, title: j.to?.label ? `Course — ${j.to.label}` : 'Course de taxi', canAbort: true, abort: null };
    return null;
  }
  /** Activité en cours : mission > Chiche / course > suivi GPS. */
  function activity() {
    const a = missions.active;
    if (a) return { kind: 'mission', id: a.def.id, title: a.def.title, canAbort: a.phase === 'active' };
    const x = extraActivity();
    if (x) return { kind: x.kind, id: x.id, title: x.title, canAbort: x.canAbort };
    if (missions.tracked) { const m = MISSION_BY_ID[missions.tracked]; return { kind: 'track', id: missions.tracked, title: `Départ : ${m?.title || ''}`, canAbort: true }; }
    if (nav.dest && nav.dest.source !== 'mission') return { kind: 'track', id: nav.dest.source === 'track' ? advisor?.trackingDare ?? null : null, title: nav.dest.label || 'Destination', canAbort: true };
    return null;
  }
  /** Abandonne l'activité en cours (mission, course, Chiche, ou simple suivi GPS). Retourne true si quelque chose a été arrêté. */
  function abortActivity() {
    if (missions.active) return missions.abortMission();
    const x = extraActivity();
    if (x) {
      if (!x.canAbort) return false;
      if (x.abort) { try { return x.abort() !== false; } catch (e) { console.warn('[gameplay] abandon', e); return false; } }
      bus.emit(x.kind === 'dare' ? 'intent:dareLeave' : 'intent:jobAbort', {});
      return true;
    }
    if (missions.tracked) return missions.untrack();
    if (advisor?.untrack?.()) return true;
    if (nav.dest && nav.dest.source !== 'mission') { nav.clear(nav.dest.source); return true; }
    return false;
  }

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
    // derrière l'écran d'accueil, on ne découvre ni ne ramasse rien (sinon : toast en double au chargement du compte)
    if (!welcomed) return;
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
    for (const collect of g.interact) { try { collect(p.x, p.z, out, p.y); } catch (e) { console.warn('[gameplay] interaction', e); } }
    // ce qui est utilisable passe avant ce qui est verrouillé ou en attente, puis le plus proche
    out.sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || a.d - b.d);
    return out[0] || null;
  }
  function showHint(it) {
    const tactile = touch();
    // au tactile et au volant, le compteur de vitesse de l'interface est affiché : l'invite se range à côté de lui
    const drive = tactile && ctx.player?.mode === 'vehicle';
    const sig = it ? it.text + '|' + it.sub + (drive ? '|v' : '') : '';
    if (sig === hintSig) return;
    hintSig = sig;
    bus.emit('interact:hint', it ? { text: it.text, sub: it.sub || '', key: it.key ? 'E' : null } : null);
    if (!ctx.uiRoot || api.showHints === false) { if (hintEl) hintEl.style.opacity = '0'; return; }
    if (!hintEl) {
      // 180 px au moins du bas : au-dessus de la plaque de rue et de la pastille GPS dans une petite fenêtre. Sous 580 px de
      // haut, il ne reste que 87 px entre elles et le bandeau central : le détail tient sur une ligne (coupée).
      // Au tactile, l'invite ne doit masquer ni le bouton « Interagir » qu'elle demande de presser, ni le bandeau central,
      // ni le chat : en paysage, posée SOUS la bande du bandeau, entre le manche et la grappe de boutons ; en portrait,
      // entre le chat et la grappe (même seuil que le module joueur : 560 px de large). Le détail (seconde ligne) n'y est
      // pas affiché : il est dit par le toast du donneur de mission au démarrage.
      const css = document.createElement('style');
      css.textContent = '.gp-hint{position:absolute;left:50%;bottom:max(25%,180px);transform:translateX(-50%);max-width:min(620px,86vw);padding:10px 16px;border-radius:12px;'
        + 'background:rgba(12,15,22,.78);color:#fff;font:600 15px/1.35 system-ui,sans-serif;text-align:center;text-wrap:balance;pointer-events:none;'
        + 'box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.14);opacity:0;transition:opacity .18s;z-index:4}'
        // (centrée par les marges : avec left:50 % la largeur disponible ne serait que la moitié de l'écran)
        + '.gp-hint.is-touch{left:170px;right:170px;transform:none;margin:0 auto;width:fit-content;max-width:620px}'
        + '@media (max-height:579px){.gp-hint .gp-hint-sub{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;line-clamp:1;overflow:hidden}}'
        // (portrait : 50 px seulement entre le bas du chat — à 276 px du bas — et le haut d'« Interagir » — à 226 px : deux lignes serrées)
        + '@media (max-width:559px){.gp-hint.is-touch{left:7vw;right:7vw;bottom:calc(209px + max(20px,env(safe-area-inset-bottom)));max-width:none;padding:5px 12px;font-size:13px;line-height:1.3}'
        + '.gp-hint.is-touch .gp-hint-sub{display:none}.gp-hint.is-touch .gp-hint-key{min-width:0;margin-right:7px;padding:0 5px}.gp-hint.is-touch .gp-hint-key svg{width:13px;height:16px}}'
        // (petit téléphone debout, moins de 680 px de haut : le bandeau central descend jusqu'à 33 px d'« Interagir » — une seule ligne, coupée)
        + '@media (max-width:559px) and (max-height:679px){.gp-hint.is-touch{max-width:86vw;box-sizing:border-box}.gp-hint.is-touch .gp-hint-main{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}'
        // (téléphone couché : manche à gauche — 150 px —, « Interagir » à 214 px du bord droit de la grappe, pastille en bas)
        + '@media (max-height:500px){.gp-hint.is-touch{left:calc(162px + max(18px,env(safe-area-inset-left)));right:calc(228px + max(16px,env(safe-area-inset-right)));'
        + 'bottom:calc(46px + env(safe-area-inset-bottom))}.gp-hint.is-touch .gp-hint-sub{display:none}}'
        // (au volant, le compteur de vitesse s'ajoute : en portrait au-dessus du manche — 18..102 px du bord gauche —, téléphone
        // couché à droite du manche — 180..276 px ; l'invite commence après lui. Portrait : deux lignes au plus, comme à pied.
        // Téléphone couché de moins de 800 px de large : colonne étroite, petit corps, quatre lignes au plus ; sous 660 px
        // de large il ne reste pas de place à droite du compteur, la règle ne s'applique pas)
        + '@media (max-width:559px){.gp-hint.is-touch.is-drive{left:110px}}'
        + '@media (max-width:559px) and (max-height:679px){.gp-hint.is-touch.is-drive{max-width:calc(93vw - 110px)}}'
        + '@media (max-width:559px) and (min-height:680px){.gp-hint.is-touch.is-drive .gp-hint-main{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}}'
        + '@media (max-height:500px) and (min-width:660px){.gp-hint.is-touch.is-drive{left:calc(266px + max(18px,env(safe-area-inset-left)))}}'
        + '@media (max-height:500px) and (min-width:660px) and (max-width:799px){.gp-hint.is-touch.is-drive{padding:5px 10px;font-size:13px;line-height:1.3}'
        + '.gp-hint.is-touch.is-drive .gp-hint-main{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;line-clamp:4;overflow:hidden}}'
        + '.gp-hint-key{display:inline-block;min-width:22px;margin-right:9px;padding:1px 6px;border-radius:6px;background:#ffd60a;color:#111;font-weight:800}'
        + '.gp-hint-key svg{display:block;width:18px;height:22px;fill:none;stroke:#111;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}';
      ctx.uiRoot.appendChild(css);
      hintEl = document.createElement('div');
      hintEl.className = 'gp-hint';
      ctx.uiRoot.appendChild(hintEl);
    }
    if (!it) { hintEl.style.opacity = '0'; return; }
    hintEl.classList.toggle('is-touch', tactile);
    hintEl.classList.toggle('is-drive', drive);
    hintEl.textContent = '';
    const l1 = document.createElement('div');
    l1.className = 'gp-hint-main';
    if (it.key) {
      const k = document.createElement('span');
      k.className = 'gp-hint-key';
      // au tactile : pas de lettre, le pictogramme du bouton « Interagir » (la main du module joueur)
      if (tactile) { k.innerHTML = HAND_SVG; k.style.verticalAlign = 'middle'; } else k.textContent = 'E';
      l1.appendChild(k);
    }
    l1.appendChild(document.createTextNode(typo(it.text))); // posé hors de h() : la typographie est faite ici
    hintEl.appendChild(l1);
    if (it.sub) {
      const l2 = document.createElement('div');
      l2.textContent = typo(it.sub);
      l2.className = 'gp-hint-sub';
      l2.style.cssText = 'margin-top:3px;font-weight:400;font-size:13px;opacity:.82';
      hintEl.appendChild(l2);
    }
    hintEl.style.opacity = '1';
  }
  const uiOpen = () => { try { return !!ctx.ui?.isOpen?.(); } catch { return false; } };
  bus.on('player:interact', () => {
    if (uiOpen()) return;
    const it = nearestInteractable();
    try {
      // un interactable utilisable garde la priorité ; sinon E « dans le vide » suit le prochain objectif ;
      // à défaut, l'interactable verrouillé explique pourquoi il l'est
      if (it?.key) it.action();
      else if (advisor?.follow()) { /* objectif suivi */ }
      else if (it) it.action();
    } catch (e) { console.error('[gameplay] interaction', e); }
  });

  // ---------------------------------------------------------------- événements globaux
  bus.on('net:welcome', () => {
    save.load(store.me?.id, store.me?.name);
    welcomed = true;
    refreshExtras();
    publishLevel();
    missions.refreshStartMarkers();
  });
  // Le niveau est une notion gameplay (dérivée de stats.missionsDone) : on le publie dans store.me.stats.level
  // (écriture en place, sans store.set) pour que l'UI puisse l'afficher sans dépendre de ce module.
  const publishLevel = () => { const st = store.me?.stats; if (st && typeof st === 'object' && st.level !== missions.level()) st.level = missions.level(); };
  bus.on('store:change', (patch) => { if (patch?.me) { publishLevel(); if (patch.me.stats || patch.me.cooldowns) missions.refreshStartMarkers(); } });
  bus.on('mission:end', publishLevel);
  bus.on('intent:missionAbortRequest', () => abortActivity()); // compatibilité (l'UI appelle abortActivity directement)

  // ---------------------------------------------------------------- API publique
  const api = {
    missions: MISSIONS,
    properties: PROPERTIES,
    levels: LEVELS,
    dealers: estate.dealers.map((d) => ({ ...d.def, x: d.x, z: d.z })),
    garages: estate.garages.map((k) => ({ ...k.def, x: k.x, z: k.z })),
    showHints: true,
    startMission: (id, opts) => missions.startMission(id, opts),
    /** Alias historique de abortActivity pour une mission (ou un départ suivi). */
    abortMission: () => missions.abortMission(),
    /** Activité en cours : { kind: 'mission'|'job'|'dare'|'track', id, title, canAbort } | null. */
    get activity() { return activity(); },
    /** Abandon unique : mission (comme abortMission), course (intent:jobAbort), Chiche (intent:dareLeave), suivi GPS (effacé). */
    abortActivity,
    /** Prochain objectif publié (store.objective) : { kind, id, title, type, reward, dist, x, z, tracking, star, level }. */
    get objective() { return store.objective; },
    /** Mission conseillée depuis (fromX, fromZ), hors excludeId : { id, title, dist, reward } | null. */
    suggestNext: (fromX, fromZ, excludeId, opts) => advisor?.suggestNext(fromX, fromZ, excludeId, opts) ?? null,
    /** Suit l'objectif courant, comme E « dans le vide » (bouton « Y aller » de l'interface). */
    followObjective: () => !!advisor?.follow(),
    /** Jauge de niveau : { n, title, have, need, nextTitle, stars }. */
    get levelInfo() { return missions.levelInfo(missions.missionsDone()); },
    // états en lecture des sous-modules de la boucle fun (style, képis, course, Chiche)
    get style() { return g.style?.state ?? store.style; },
    get heat() { return g.heat?.state ?? store.heat; },
    get job() { return g.taxi?.state ?? store.job ?? null; },
    get dare() { return g.dare?.state ?? store.dare ?? null; },
    /** Points de rendez-vous de la ville (taxi, Chiche) : [{ id, label, x, z }]. */
    rdvPoints: RDV_POINTS,
    /** Interne (sondes et pages de test uniquement) : l'objet `g` partagé par les sous-modules. */
    _g: g,
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
    routeTo(x, z, label = 'Destination') { setManual(x, z, label); return { path: nav.path, length: nav.length }; },
    clearRoute() { nav.clear('manual'); },
    /** Reste à parcourir le long du ruban GPS affiché, en mètres (la distance de l'encart mission) ; null sans itinéraire. */
    get gpsLeft() { return nav.dest && nav.path && Number.isFinite(nav.left) ? nav.left : null; },
    /**
     * Calcule un itinéraire sans l'afficher : { path: [[x,z,ele?],...], length, time, routed, partial, cutStart, cutEnd, ms } ;
     * opts = { metric, fromEle, toEle, budgetMs, foot }. Sans `metric`, c'est celle du ruban GPS et de l'objectif (à pied et à
     * moins de 700 m : le plus court, sinon le plus rapide), sur le graphe du joueur (à pied : sans les sens uniques) :
     * la longueur rendue est donc celle que le joueur voit. Avec `metric` : le graphe des voitures, sauf foot = true.
     */
    computeRoute: (ax, az, bx, bz, opts) => route(ax, az, bx, bz, opts?.metric ? { foot: false, ...opts } : { ...opts, metric: routeMetric(ax, az, bx, bz) }),
    /** Point de chaussée le plus proche : { x, z, yaw, road, dist, ele, y } */
    nearestRoadPoint: (x, z, y) => { const n = roads.nearest(x, z, 600, null, eleOf(x, z, y)); return n ? { ...n, y: groundY(n.x, n.z, n.ele) } : null; },
    spawnPersonalCar: (typeId) => estate.spawnPersonalCar(typeId),
    get personalCar() { return estate.personalCar; },
    /** Point de carte « Votre voiture » : { x, z, label, typeId } | null (voiture personnelle sortie et inoccupée). */
    get carPoint() { const v = estate.personalCar; return v && v.pos && ctx.vehicles?.list?.includes(v) && ctx.player?.vehicle !== v ? { x: v.pos.x, z: v.pos.z, label: 'Votre voiture', typeId: v.typeId } : null; },
    get stats() { return { missionsDone: missions.missionsDone(), level: missions.level(), collectibles: collectibles.filter((c) => (save.data.found || []).includes(c.id)).length, collectiblesTotal: collectibles.length, collectibleName: CK.name, landmarksSeen: sights.filter((l) => (save.data.seen || []).includes(l.id)).length, landmarksTotal: sights.length }; },
    update(dt) {
      for (let i = 0; i < subs.length; i++) subs[i].update(dt);
      updateNav(dt);
      updateExtras(dt);
      hintT += dt;
      if (hintT > 0.15) { hintT = 0; current = uiOpen() ? null : nearestInteractable(); showHint(current); }
      markers.update(dt);
    },
  };
  return api;
}

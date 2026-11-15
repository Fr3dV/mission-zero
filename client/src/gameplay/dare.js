// « Chiche ! » — la course express entre amis. G lance le défi là où l'on se trouve : le serveur tire une arrivée à
// 1-2 km et toute la salle est invitée (l'encart « Prochain objectif » du conseiller mène au point de départ, où E
// devient « Relever le défi »). Le lanceur donne le départ avec G dès qu'un adversaire est inscrit (sinon départ
// automatique au bout de 90 s) : compte à rebours géant, ruban jaune jusqu'à l'arrivée, chacun sa route, et un
// bandeau pour toute la salle à la fin. Aucun argent ni arbitrage ici : inscriptions, départ, vainqueur et mise sont
// décidés par le serveur.
//
// Contrat v6, « Bus — taxi, Chiche… » et « Règles serveur du Chiche » :
//   entrées    : player:dare {} (touche G) ; dare:state {id, by:{id,name}, origin:{x,z,label}, to:{x,z,label,r}, stake,
//                players:[{id,name}], phase:'open'|'run', startAt, endAt (ms, horloge performance.now()), mine} à chaque
//                changement ; dare:end {id, winner:{id,name}|null, sec, pot, reason:'solo'|'timeout'|'left'|'lost'|'restart'|
//                null, won, stake?} — 'lost' = Chiche perdu de vue après une coupure (forfait si la course était lancée ;
//                stake = mise RÉELLEMENT débitée, 0 si le solde est intact) ; 'restart' = arrêt du serveur, annulé sans débit ;
//                net:status {state} (une coupure pendant la course vaut forfait : l'écran le dit) ;
//   intentions : intent:dare {stake}, intent:dareJoin {id}, intent:dareGo {}, intent:dareLeave {}.
// Suivi : pseudo-mission {id, title, kind:'dare'} dans mission:update (eyebrow 'Chiche !'), 4 fois par seconde tant
// que le joueur est inscrit ; store.mission reste null. Activité : g.activities ('dare', abandon = intent:dareLeave).
// Interdits croisés : pendant un Chiche où l'on est inscrit, g.guards refuse 'mission' et 'job' ; lancer ou relever
// un défi est refusé en mission, en course de taxi (garde de taxi.js) et pendant une poursuite (garde de heat.js).
// Invitation : le bandeau central n'est montré qu'à un joueur libre (ni mission, ni course, ni poursuite, ni carte de
// fin à l'écran), à moins de 600 m du départ, et au plus une fois par tranche de 90 s ; sinon la ligne du chat suffit.
// Fin d'un Chiche auquel on ne participait pas : bandeau central seulement si l'on est libre (ni mission, ni course, ni poursuite).
import { ICON } from './markers.js';
import { fmtZ, gainZ, de } from './text.js';

// ---- réglages (les règles — 80 m, 120 m, 90 s, 4 s, 240 s — sont celles du serveur, rappelées ici pour l'affichage) ----
const JOIN_R = 80;            // m : on s'inscrit à moins de 80 m du point de départ…
const JOIN_MARGIN = 4;        // …moins une marge (la position connue du serveur a un léger retard)
const WARN_R = 100;           // m : « Restez près du départ » (hors course au-delà de 120 m à l'instant du départ)
const COUNTDOWN_MS = 4000;    // délai entre la clôture des inscriptions et le départ
const STAKE_KEY = 0;          // mise d'un défi lancé à la touche G (les mises se choisissent dans le téléphone)
const KEY_GAP = 1200;         // ms entre deux appuis sur G pris en compte
const INVITE_R = 600;         // m à vol d'oiseau : au-delà, pas de bandeau d'invitation central
const INVITE_GAP_MS = 90000;  // au plus un bandeau d'invitation par tranche de 90 s
const OUT_START_MS = 1500;    // une mise hors course dans les 1,5 s qui suivent le top : « trop loin du départ »
const DEP_LABEL = 'Départ du Chiche'; // libellé du guidage vers le point de départ posé par la touche G
const LAST_SEC = 30;          // s : le temps restant s'affiche en fin de course
const HUD_DT = 0.25;          // mission:update 4 fois par seconde
const COLOR = '#ffd60a';
const GUARD_TEXT = 'Chiche en cours : allez au bout, ou retirez-vous depuis le téléphone.';
const fin = Number.isFinite;
const fmtClock = (s) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export function createDare(g) {
  const { ctx, bus, store, markers } = g;
  let cur = null; // dernier état reçu du Chiche de la salle (dare:state), null s'il n'y en a pas
  let hudOn = false, hudT = 0, warned = false, goShown = false, leftByMe = false, keyAt = -1e9, markSig = '';
  let cut = false;      // la connexion a été coupée pendant la course où l'on était inscrit : le serveur compte un forfait
  let owed = null;      // sorti en cours de course (forfait, abandon, hors course) : { stake } — la mise ira au vainqueur
  let inviteAt = -1e9;  // dernier bandeau d'invitation central (performance.now())
  const pseudo = { id: null, title: '', kind: 'dare' }; // pseudo-mission du suivi (réutilisée)
  const stepEv = { label: '', kind: 'goto', x: 0, z: 0, radius: 0 };

  const myId = () => store.me?.id ?? ctx.net?.id ?? null;
  const byMe = (d) => !!d && !!d.by && d.by.id != null && d.by.id === myId();
  const count = (d) => (Array.isArray(d.players) ? d.players.length : 0);
  const quiet = () => { try { return !!ctx.ui?.prefs?.quiet; } catch { return false; } };
  // au tactile il n'y a ni touche G ni touche E : le départ se donne depuis le téléphone, on rejoint par l'encart d'objectif
  const touch = () => !!g.touch?.();
  const goHow = () => (touch() ? 'Téléphone ▸ Joueurs' : 'G');
  const banner = (kind, title, sub, ms, sound) => bus.emit('ui:banner', { kind, eyebrow: 'Chiche !', title, sub: sub || '', ms: ms || 3200, sound });

  // ---------------------------------------------------------------- marqueurs et ruban
  /** Marqueurs et GPS d'après l'état courant (refaits seulement quand il change). */
  function sync() {
    const d = cur;
    const sig = d ? `${d.id}|${d.phase}|${!!d.mine}|${quiet()}` : '';
    if (sig === markSig) return;
    markSig = sig;
    if (!d) { markers.clear('dare'); g.nav.clear('dare'); return; }
    const list = [];
    const o = d.origin, to = d.to;
    if (d.mine) {
      // inscrit : l'arrivée (disque = rayon réel de la ligne) et le ruban jaune, prioritaire sur tout autre guidage
      if (to && fin(to.x) && fin(to.z)) {
        list.push({ x: to.x, z: to.z, color: COLOR, icon: ICON.flag, radius: fin(to.r) && to.r > 0 ? to.r : 35, beamH: 130, beamR: 1.5, range: 1e5, iconSize: 2.8, iconY: 6 });
        g.nav.set(to.x, to.z, `Arrivée : ${to.label || 'Chiche'}`, 'dare');
      }
      if (d.phase === 'open' && o && fin(o.x) && fin(o.z)) list.push({ x: o.x, z: o.z, color: '#ffffff', icon: null, radius: 8, beamH: 0, range: 400 });
    } else {
      g.nav.clear('dare');
      // invitation : le point de départ se voit de loin (masqué en mode tranquille)
      if (d.phase === 'open' && o && fin(o.x) && fin(o.z) && !quiet()) list.push({ x: o.x, z: o.z, color: COLOR, icon: ICON.flag, radius: 10, beamH: 110, beamR: 1.2, range: 1e5, iconSize: 2.4, iconY: 5 });
    }
    markers.set('dare', list);
  }
  // compte à rebours géant (3, 2, 1, Partez !) : un élément à nous, touché seulement quand le chiffre change —
  // la file de bandeaux de l'interface ne garantit pas l'instant d'affichage
  let countEl = null, countK = -1, countHide = 0;
  function showCount(text, go) {
    if (!ctx.uiRoot) return;
    if (!countEl) {
      countEl = document.createElement('div');
      countEl.className = 'gp-count';
      countEl.style.cssText = 'position:absolute;left:50%;top:32%;transform:translate(-50%,-50%);font:900 104px/1 system-ui,sans-serif;letter-spacing:.02em;'
        + 'color:#ffd60a;text-shadow:0 4px 0 rgba(0,0,0,.55),0 0 28px rgba(0,0,0,.45);pointer-events:none;opacity:0;transition:opacity .25s;z-index:4;white-space:nowrap';
      ctx.uiRoot.appendChild(countEl);
    }
    countEl.textContent = text;
    countEl.style.fontSize = go ? '76px' : '104px';
    countEl.style.color = go ? '#ffffff' : '#ffd60a';
    countEl.style.opacity = '1';
    try { countEl.animate?.([{ transform: 'translate(-50%,-50%) scale(1.6)' }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 240, easing: 'ease-out' }); } catch { /* sans animation */ }
  }
  function hideCount() { countK = -1; countHide = 0; if (countEl) countEl.style.opacity = '0'; }
  function closeHud() {
    hideCount();
    if (!hudOn) return;
    hudOn = false;
    bus.emit('mission:update', { mission: null, step: null, stepIndex: 0, stepCount: 0, text: '', timeLeft: null, distance: 0 });
  }

  // ---------------------------------------------------------------- actions du joueur
  /** Lancer ou relever un défi est-il possible maintenant ? Sinon le joueur lit pourquoi. */
  function free() {
    if (g.missions?.active) { g.toast('Terminez d\'abord votre mission.', 'error'); return false; }
    const why = g.guard('dare');
    if (why) { g.toast(why, 'error'); return false; }
    return true;
  }
  /** Lance un Chiche là où l'on se trouve (le serveur tire l'arrivée et prévient la salle). */
  function launch(stake = STAKE_KEY) {
    if (!store.me || !free()) return false;
    const others = store.players;
    if (store.online !== false && others && others.size === 0) { g.toast('Personne à défier pour l\'instant : invitez un ami dans la salle.', 'info'); return false; }
    bus.emit('intent:dare', { stake });
    return true;
  }
  /** Relève le défi ouvert de la salle (à faire près de son point de départ : le serveur vérifie). */
  function join() {
    const d = cur;
    if (!d || d.phase !== 'open' || d.mine || !free()) return false;
    if ((d.stake || 0) > (store.me?.money ?? 0)) { g.toast(`Il vous faut ${fmtZ(d.stake)} pour relever ce défi.`, 'error'); return false; }
    bus.emit('intent:dareJoin', { id: d.id });
    return true;
  }
  /** Le lanceur donne le départ. */
  function go() {
    const d = cur;
    if (!d || d.phase !== 'open' || !byMe(d)) return false;
    if (count(d) < 2) { g.toast('Attendez au moins un adversaire au départ.', 'info'); return false; }
    bus.emit('intent:dareGo', {});
    return true;
  }
  const nearOrigin = (d, px, pz) => !!d.origin && Math.hypot(d.origin.x - px, d.origin.z - pz) <= JOIN_R - JOIN_MARGIN;
  // touche G : lancer ; pour le lanceur, donner le départ ; pour les autres, relever le défi (ou s'y rendre)
  bus.on('player:dare', () => {
    const now = performance.now();
    if (now - keyAt < KEY_GAP) return;
    keyAt = now;
    const d = cur;
    if (!d) { launch(STAKE_KEY); return; }
    if (d.phase === 'open') {
      if (byMe(d)) { go(); return; }
      if (d.mine) { g.toast(`${d.by?.name || 'Le lanceur'} donne le départ : restez près de la ligne.`, 'info'); return; }
      const p = g.playerPos();
      if (nearOrigin(d, p.x, p.z)) { join(); return; }
      // trop loin : comme E « dans le vide », le GPS mène au point de départ
      if (!(store.objective?.kind === 'dare' && g.advisor?.follow?.()) && d.origin) g.nav.set(d.origin.x, d.origin.z, DEP_LABEL, 'track');
      g.toast('Rejoignez le point de départ pour relever le défi.', 'info');
      return;
    }
    g.toast(d.mine ? 'Le Chiche est lancé : foncez !' : 'Un Chiche est déjà en cours dans la salle.', 'info');
  });
  bus.on('intent:dareLeave', () => { if (cur?.mine) leftByMe = true; });
  // coupure pendant la course : le serveur met hors course à la déconnexion (forfait, la mise reste en jeu)
  bus.on('net:status', (e) => { if (e && e.state !== 'online' && cur?.mine && cur.phase === 'run') cut = true; });

  /** Le joueur suivait-il au GPS le point de départ de ce Chiche (E sur l'encart, ou G de loin) ? À lire AVANT de changer d'état. */
  const following = (id) => g.advisor?.trackingDare === id || (g.nav.dest?.source === 'track' && g.nav.dest.label === DEP_LABEL);
  /** Efface le guidage vers le départ posé par la touche G (celui de l'encart est retiré par le conseiller). */
  const stopFollowing = () => { if (g.nav.dest?.source === 'track' && g.nav.dest.label === DEP_LABEL) g.nav.clear('track'); };
  /** Le joueur a-t-il une activité en cours (mission, course de taxi ou Chiche, poursuite) ? Alors rien de central pour le Chiche des autres. */
  const occupied = () => !!(g.missions?.active || g.busy?.() || store.heat?.wanted);
  /** Bandeau d'invitation central : seulement pour un joueur libre, pas trop loin, et pas plus d'un par tranche de 90 s. */
  function invite(s) {
    const o = s.origin, p = g.playerPos(), now = performance.now();
    if (!o || !fin(o.x) || !fin(o.z) || Math.hypot(o.x - p.x, o.z - p.z) > INVITE_R) return;
    // occupé (mission, course, poursuite) ou carte de fin à l'écran : E ne mènerait pas au départ, rien de central
    if (occupied() || g.advisor?.pinned) return;
    if (now - inviteAt < INVITE_GAP_MS) return;
    inviteAt = now;
    // (le libellé du départ est un nom de monument, sans article : pas de « près de … »)
    const where = o.label ? `Départ : ${o.label} — ` : '';
    banner('info', `${s.by?.name || 'Un joueur'} lance un Chiche`, `${where}${touch() ? 'touchez « Rejoindre le départ »' : 'E : rejoindre le départ'}`, 4200);
  }
  /** Pourquoi le joueur n'est plus inscrit (le serveur met hors course : trop loin au top, coupure, téléportation, autre activité). */
  function outText(s) {
    if (s.phase !== 'run') return 'Vous n\'êtes plus inscrit à ce Chiche.';
    const due = s.stake > 0 ? ' — votre mise reste en jeu' : '';
    if (cut) return `Hors course : la coupure de connexion vaut forfait${due}.`;
    if (performance.now() < s.startAt + OUT_START_MS) return `Hors course : vous étiez trop loin du départ${due}.`;
    return `Hors course : forfait${due}.`;
  }

  // ---------------------------------------------------------------- état de la salle
  bus.on('dare:state', (s) => {
    if (!s || s.id == null) return;
    const prev = cur && cur.id === s.id ? cur : null;
    const followed = following(s.id);
    if (!prev) { warned = false; goShown = false; leftByMe = false; cut = false; owed = null; }
    cur = s;
    const mineNow = !!s.mine, mineBefore = !!prev?.mine;
    if (!prev && s.phase === 'open') {
      if (byMe(s)) banner('info', 'Chiche lancé !', `Arrivée : ${s.to?.label || '?'} — ${goHow()} pour donner le départ`, 3800);
      else if (!mineNow && !quiet()) invite(s);
    }
    if (mineNow && !mineBefore) {
      leftByMe = false; // réinscrit après un retrait : la suite (annulation, hors course) redevient lisible
      // inscrit : le départ de mission ou le point de départ que l'on suivait laissent place au ruban du Chiche
      try { g.missions?.untrack?.(); g.advisor?.untrack?.(); } catch (e) { console.warn('[gameplay] chiche', e); }
      stopFollowing();
      if (!byMe(s)) g.toast(`Défi relevé${s.stake > 0 ? ` (mise ${fmtZ(s.stake)})` : ''} ! Restez près du départ.`, 'success');
      hudT = HUD_DT;
    } else if (mineBefore && !mineNow) {
      // sorti en cours de course, de gré ou de force : le serveur fera payer la mise s'il y a un vainqueur
      if (s.phase === 'run') owed = { stake: s.stake || 0 };
      if (!leftByMe) g.toast(outText(s), 'error');
      closeHud();
    } else if (!mineNow && prev && prev.phase === 'open' && s.phase === 'run' && followed) {
      // en route vers le départ, mais la course est partie
      if (!quiet()) g.toast('Le Chiche est parti sans vous.', 'info');
      stopFollowing();
    }
    sync();
  });
  bus.on('dare:end', (e) => {
    if (cur && e?.id != null && cur.id !== e.id) return; // fin d'un défi précédent arrivée en retard : celui en cours continue
    const d = cur;
    const was = !!d?.mine, launcher = byMe(d), left = leftByMe, wasCut = cut, due = owed;
    const followed = !!d && following(d.id);
    cur = null; leftByMe = false; cut = false; owed = null;
    sync();
    closeHud();
    const w = e?.winner;
    // Chiche perdu de vue pendant une coupure ('lost' ; repli : fin 'left' sans vainqueur après une coupure constatée ici)
    const lost = !w && (e?.reason === 'lost' || (wasCut && e?.reason === 'left'));
    if (w) {
      const pot = +e.pot || 0, time = e.sec > 0 ? fmtClock(e.sec) : '';
      if (e.won || (w.id != null && w.id === myId())) {
        const bits = [];
        if (pot > 0) bits.push(gainZ(pot));
        if (e.reason === 'left') bits.push('vos adversaires ont renoncé'); else if (time) bits.push(`en ${time}`);
        banner('gold', 'Vous gagnez le Chiche !', bits.join(' · '), 4200, 'record');
      } else if (was || due) {
        // perdant : encore en lice, ou sorti en cours de course (forfait, abandon) — le serveur débite la mise des deux
        const stake = was ? d.stake || 0 : due.stake;
        // à deux, la mise hors course au top clôt le défi sans état intermédiaire (fin 'left' dans la seconde) : on nomme la cause
        const p = g.playerPos(), o = d.origin;
        const offLine = was && !left && e.reason === 'left' && (+e.sec || 0) < 1 && !!o && fin(o.x) && fin(o.z) && Math.hypot(o.x - p.x, o.z - p.z) > WARN_R;
        const sub = offLine ? `Hors course : trop loin du départ au top${stake > 0 ? ` — mise perdue : ${fmtZ(stake)}` : ''}`
          : stake > 0 ? `Mise perdue : ${fmtZ(stake)} — la revanche ?` : touch() ? 'La revanche ?' : 'La revanche ? G pour relancer';
        banner('ko', `${w.name || 'Un adversaire'} gagne le Chiche !`, sub, offLine ? 4400 : 4000);
      } else if (!quiet() && !occupied()) banner('info', `${w.name || 'Un joueur'} gagne le Chiche !`, pot > 0 ? gainZ(pot) : '', 3000); // spectateur occupé : la ligne du chat suffit
    } else if (lost && was && d.phase === 'run') {
      // la course était lancée : la déconnexion vaut forfait (pas de reprise) — l'écran dit la vérité
      // la mise annoncée est celle que net a constatée (e.stake, même nulle : solde intact, rien n'a été pris) ; sans
      // ce champ (fin 'left' d'un net plus ancien), celle du Chiche
      const stake = e?.stake != null ? Math.max(0, +e.stake || 0) : d.stake || 0;
      if (stake > 0) banner('ko', 'Chiche perdu par forfait', `Connexion coupée · Mise perdue : ${fmtZ(stake)}`, 4200);
      else if (d.stake > 0) banner('info', 'Chiche interrompu', 'Connexion coupée : rien n\'a été débité.', 3600);
      else banner('ko', 'Chiche perdu par forfait', 'Connexion coupée', 4200);
    } else if ((was || launcher) && !left) {
      if (e?.reason === 'solo') banner('info', 'Chiche annulé', 'Personne n\'a relevé le défi.', 3200);
      else if (e?.reason === 'timeout') banner('ko', 'Chiche terminé', 'Personne n\'a rallié l\'arrivée à temps.', 3600);
      else if (lost) banner('info', 'Chiche interrompu', 'Connexion coupée : le défi n\'a pas attendu.', 3200);
      else if (e?.reason === 'restart') banner('info', 'Chiche annulé', 'Le serveur redémarre : rien n\'est débité.', 3200);
      else banner('info', 'Chiche annulé', launcher ? '' : 'Le défi a été retiré.', 3000);
    } else if (left && launcher) g.toast('Chiche annulé.', 'info');
    else if (followed && !quiet()) {
      // en route vers le départ sans être inscrit : le guidage disparaît, le joueur lit pourquoi
      g.toast(e?.reason === 'solo' ? 'Le Chiche est clos : personne ne l\'a relevé à temps.' : lost ? 'Le Chiche est terminé.' : `${d.by?.name || 'Le lanceur'} a annulé son Chiche.`, 'info');
    }
    if (followed) stopFollowing();
  });
  bus.on('ui:prefs', sync);

  // ---------------------------------------------------------------- activité, interdits, invite
  g.activities.push({
    kind: 'dare',
    on: () => !!cur && !!cur.mine,
    get: () => (cur && cur.mine ? { id: cur.id, title: byMe(cur) ? 'Votre Chiche' : `Chiche ${de(cur.by?.name || 'la salle')}`, canAbort: true } : null),
    abort: () => { if (!cur || !cur.mine) return false; leftByMe = true; bus.emit('intent:dareLeave', {}); return true; },
  });
  g.guards.push((what) => ((what === 'mission' || what === 'job') && cur && cur.mine ? GUARD_TEXT : null));
  /** Touche E : relever le défi à moins de 80 m de son point de départ. */
  function collect(px, pz, out) {
    const d = cur;
    if (!d || d.phase !== 'open' || d.mine || !nearOrigin(d, px, pz)) return;
    // carte de fin de mission à l'écran (« E — Suivante ») : E va à ce qu'elle annonce, le défi attend qu'elle se referme
    if (g.advisor?.pinned) return;
    const far = Math.hypot(d.origin.x - px, d.origin.z - pz);
    // priorité sur ce qui n'est pas juste sous les pieds du joueur : le défi ne dure que 90 s
    out.push({ d: far / 20, key: true, text: d.stake > 0 ? `Relever le défi · mise ${fmtZ(d.stake)}` : 'Relever le défi', sub: `Chiche ${de(d.by?.name || 'la salle')} — arrivée : ${d.to?.label || '?'}`, action: join });
  }

  // ---------------------------------------------------------------- suivi (inscrits seulement)
  /** « 1er Léa · vous −120 m » : classement à vol d'oiseau jusqu'à l'arrivée, d'après store.players. */
  function ranking(d, myDist) {
    const me = myId(), players = store.players;
    let ahead = 0, known = 0, name = '', best = Infinity;
    for (const pl of d.players) {
      if (!pl || pl.id === me) continue;
      const q = players?.get?.(pl.id);
      if (!q || !fin(q.x) || !fin(q.z)) continue;
      const dd = Math.hypot(d.to.x - q.x, d.to.z - q.z);
      known++;
      if (dd < myDist) ahead++;
      if (dd < best) { best = dd; name = pl.name || q.name || '?'; }
    }
    if (!known) return `Foncez : ${d.to.label || 'l\'arrivée'} !`;
    if (!ahead) return `1er vous · ${name} −${Math.round(best - myDist)} m`;
    return `${ahead > 1 ? `${ahead + 1}e · ` : ''}1er ${name} · vous −${Math.round(myDist - best)} m`;
  }
  function update(dt) {
    const d = cur;
    if (!d) return;
    if (!d.mine) { if (hudOn) closeHud(); return; }
    const now = performance.now();
    if (d.phase === 'run') {
      // compte à rebours calé sur startAt (les bips et le klaxon du départ sont joués par le module audio)
      const left = d.startAt - now;
      if (left > 0) { const k = Math.ceil(left / 1000); if (k !== countK && k <= 3) { countK = k; showCount(String(k), false); } }
      else if (!goShown) { goShown = true; if (left > -1500) { showCount('Partez !', true); countHide = now + 1300; } }
      else if (countHide && now > countHide) hideCount();
    }
    hudT += dt;
    if (hudT < HUD_DT) return;
    hudT = 0;
    const p = g.playerPos(), n = count(d), o = d.origin, to = d.to;
    if (!to || !fin(to.x) || !fin(to.z)) return;
    let text, timeLeft = null, dist = 0, elapsed = null;
    const started = d.phase === 'run' && now >= d.startAt;
    if (!started) {
      const far = o ? Math.hypot(o.x - p.x, o.z - p.z) : 0;
      if (d.phase === 'open') {
        timeLeft = Math.max(0, (d.startAt - now - COUNTDOWN_MS) / 1000);
        text = byMe(d) ? (n >= 2 ? `${goHow()} — donner le départ (${n} pilotes)` : 'En attente d\'un adversaire…') : `En attente du départ (${n} pilotes)`;
      } else text = `Départ dans ${Math.max(1, Math.ceil((d.startAt - now) / 1000))}…`;
      if (far > WARN_R) {
        text = 'Restez près du départ !'; dist = far;
        if (!warned) { warned = true; g.toast('Restez près du départ : trop loin au top, vous seriez hors course.', 'error'); }
      } else if (far < WARN_R - 15) warned = false;
    } else {
      elapsed = (now - d.startAt) / 1000;
      dist = Math.hypot(to.x - p.x, to.z - p.z);
      text = ranking(d, dist);
      const left = (d.endAt - now) / 1000;
      if (left < LAST_SEC) timeLeft = Math.max(0, left);
    }
    g.nav.set(to.x, to.z, `Arrivée : ${to.label || 'Chiche'}`, 'dare'); // sans effet si le ruban y mène déjà
    pseudo.id = d.id; pseudo.title = `Arrivée : ${to.label || '?'}`;
    stepEv.label = pseudo.title; stepEv.x = to.x; stepEv.z = to.z; stepEv.radius = fin(to.r) ? to.r : 35;
    hudOn = true;
    bus.emit('mission:update', {
      mission: pseudo, step: stepEv, stepIndex: 0, stepCount: 1, text, timeLeft, distance: dist, damage: null, maxDamage: null,
      eyebrow: 'Chiche !', elapsed, reward: (d.stake || 0) * Math.max(0, n - 1), rival: null, mine: null,
    });
  }

  return {
    update, collect, launch, join, go,
    /** État du Chiche de la salle, en lecture (= dernier dare:state) : null s'il n'y en a pas. */
    get state() { return cur; },
    /** Le joueur est-il inscrit au Chiche en cours ? */
    get mine() { return !!cur?.mine; },
  };
}

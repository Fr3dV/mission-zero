// File de bandeaux (ui:banner) et carte de fin de mission (mission:end) — module interface.
// Deux éléments DISTINCTS : le bandeau (.mz-banner, centré, un seul visible, file de 4) et la carte de fin
// (.mz-endcard, dans l'emplacement haut-gauche .mz-tl). Un bandeau peut donc s'afficher pendant qu'une carte est là.
// Aucun travail par image : la file avance sur des minuteurs, la carte sur tick() (15 Hz, appelé par index.js).
import { h, icon, zc, fmtDist, fmtTime, keyChip, starReward } from './util.js';
import * as MIS from '@shared/missions.js';

const KINDS = { ok: 1, ko: 1, gold: 1, info: 1 };
const WAIT_MAX = 3800;  // attente maximale d'un bandeau en file (contrat : 4 s, 200 ms de marge pour les minuteurs)
const QUEUE_MAX = 4;    // bandeaux en attente derrière celui qui est affiché
const SOFT_MS = 1100;   // en dessous de cette durée par bandeau, la file abandonne ses 'info' les plus anciens
const HARD_MS = 700;    // plancher absolu d'affichage (bandeaux poussés en rafale décalée, sans 'info' à abandonner)
const DEFAULT_MS = { ok: 3200, ko: 3600, gold: 4200, info: 2600 };
const FOLD_MS = 2500;   // la carte de fin reste entière au moins ce temps-là, même si l'on roule (le temps de lire temps, record et prime)
const cap1 = (s) => { s = String(s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };

/**
 * @param {object} ctx
 * @param {object} env { hud, touch:bool, level:() => niveau courant, setLevel:(l) => void, onCard:() => void,
 *                       quiet:() => mode tranquille, sheetOpen:() => fiche du matin ouverte ou en attente }
 */
export function createBanners(ctx, env) {
  const { bus, store } = ctx;
  const now = () => performance.now();

  // =====================================================================
  // File de bandeaux
  // =====================================================================
  const waiting = [];
  let cur = null, el = null, timer = 0, outTimer = 0;
  const stats = { shown: 0, dropped: 0, maxWaitMs: 0 };

  function push(p) {
    if (!p || (!p.title && !p.eyebrow)) return false;
    const kind = KINDS[p.kind] ? p.kind : 'info';
    const ms = Math.min(8000, Math.max(HARD_MS, Number(p.ms) || DEFAULT_MS[kind]));
    const b = { kind, eyebrow: p.eyebrow || '', title: p.title || '', sub: p.sub || '', sound: p.sound || null, ms, tq: now(), t0: 0, tag: p.tag || null };
    if (!cur) { show(b); return true; }
    waiting.push(b);
    while (waiting.length > QUEUE_MAX) drop(Math.max(0, waiting.findIndex((w) => w.kind === 'info')));
    plan();
    return true;
  }
  function drop(i) { waiting.splice(i, 1); stats.dropped++; }
  /** Durée accordée au bandeau affiché pour que chaque suivant parte avant WAIT_MAX, à parts égales. */
  function slot() {
    let s = cur.ms;
    for (let j = 0; j < waiting.length; j++) s = Math.min(s, (waiting[j].tq + WAIT_MAX - cur.t0) / (j + 1));
    return s;
  }
  /** (Re)calcule l'instant où le bandeau affiché cède sa place. */
  function plan() {
    clearTimeout(timer);
    if (!cur) return;
    // trop de monde pour un affichage confortable : on abandonne d'abord les 'info' les plus anciens
    while (waiting.length && slot() < Math.min(cur.ms, SOFT_MS)) {
      const i = waiting.findIndex((w) => w.kind === 'info');
      if (i < 0) break;
      drop(i);
    }
    const end = cur.t0 + Math.max(slot(), Math.min(cur.ms, HARD_MS));
    timer = setTimeout(next, Math.max(0, end - now()));
  }
  function show(b) {
    clearTimeout(outTimer);
    if (el) el.remove(); // jamais deux .mz-banner à la fois
    b.t0 = now();
    if (b.tq) stats.maxWaitMs = Math.max(stats.maxWaitMs, Math.round(b.t0 - b.tq));
    cur = b; stats.shown++;
    el = h('div', { class: `mz-banner is-${b.kind}`, role: 'status' },
      b.eyebrow ? h('span', { class: 'mz-eyebrow', text: b.eyebrow }) : null,
      b.title ? h('strong', { text: b.title }) : null,
      b.sub ? h('small', { text: b.sub }) : null);
    env.hud.appendChild(el);
    // la pile de toasts passe sous le bandeau tant qu'il est là (ui.css, .has-banner) : une lecture de hauteur par bandeau, jamais par image
    env.hud.style.setProperty('--bh', `${el.offsetHeight || 110}px`);
    env.hud.classList.add('has-banner');
    bus.emit('ui:bannerShow', { kind: b.kind, sound: b.sound });
    plan();
  }
  function next() {
    const b = waiting.shift();
    if (b) { show(b); return; }
    cur = null;
    env.hud.classList.remove('has-banner');
    const old = el;
    if (!old) return;
    old.classList.add('is-out');
    outTimer = setTimeout(() => { old.remove(); if (el === old) el = null; }, 480);
  }
  /** Retire les bandeaux portant cette marque, affiché ou en file (départ d'une mission que le serveur vient de refuser). */
  function cancel(tag) {
    for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].tag === tag) waiting.splice(i, 1);
    if (!cur || cur.tag !== tag) { plan(); return; }
    clearTimeout(timer);
    if (!waiting.length && el) { el.remove(); el = null; } // retiré net : il annonçait un départ qui n'a pas eu lieu
    next();
  }
  bus.on('ui:banner', push);

  // Bandeaux dont l'interface est la source : départ de mission, montée de niveau.
  // (Le son de départ est joué par le gameplay ; celui du niveau part avec SON bandeau, via ui:bannerShow.)
  bus.on('mission:start', (p) => {
    const m = p?.mission || MIS.MISSION_BY_ID?.[p?.id];
    if (!m?.title) return;
    // mission vedette encore à faire : gain affiché doublé, comme dans l'encart objectif, le Carnet et le téléphone
    push({ kind: 'info', eyebrow: 'C’est parti', title: m.title, sub: m.reward > 0 ? `+${zc(starReward(store.journal, m.id ?? p?.id, m.reward))}` : '', ms: 2200, tag: `start:${m.id ?? p?.id}` });
  });
  // Refus du serveur (délai, niveau) : la carte « Mission refusée » ne cohabite pas avec le « C'est parti » de la même mission.
  bus.on('mission:end', (e) => { if (e?.outcome === 'refused' && e.id != null) cancel(`start:${e.id}`); });
  // Record de salle perdu en direct : le joueur détrôné le lit en face (la ligne du chat parle de lui à la troisième personne).
  // Rien pendant la fiche du matin (elle le dit déjà) ni en mode tranquille. Texte bâti sur les champs du fait, pas sur sa phrase.
  bus.on('feed:entry', (p) => {
    const e = p?.e, my = store.me?.id;
    if (!e || e.k !== 'record' || my == null || e.p !== my || e.id === my || env.quiet?.() || env.sheetOpen?.()) return;
    const title = MIS.MISSION_BY_ID?.[e.m]?.title;
    push({ kind: 'ko', eyebrow: 'Record de salle', title: `${e.n || 'Un pilote'} bat VOTRE record`, sub: `${title ? `« ${title} » — ` : ''}${env.touch ? 'Téléphone' : 'Tab'} ▸ Carnet : Reprendre mon record`, ms: 4200 });
  });
  bus.on('gameplay:levelUp', (p) => {
    if (!p) return;
    push({ kind: 'gold', eyebrow: `Niveau ${p.level ?? ''}`.trim(), title: p.title || 'Nouveau niveau', sound: 'levelUp', ms: 3800 });
  });

  // =====================================================================
  // Carte de fin de mission
  // =====================================================================
  const card = h('div', { class: 'mz-endcard', hidden: true });
  const C = { on: false, left: 0, t0: 0, slim: false, id: null, lvlT: 0 };
  const FAIL_EYEBROW = { failed: 'Mission échouée', timeout: 'Mission non confirmée', aborted: 'Mission abandonnée', refused: 'Mission refusée' };
  const FAIL_DEFAULT = { failed: 'Ce n’est que partie remise', timeout: 'Le serveur n’a pas répondu', refused: 'Réessayez dans un instant' };
  const sec = (v) => (v != null && isFinite(v) && v > 0 ? fmtTime(v) : '');

  function levelGauge(prev, lv) {
    if (!lv) return null;
    const frac = (l) => (l && l.need > 0 ? Math.min(1, Math.max(0, l.have / l.need)) : l ? 1 : 0);
    const up = prev && lv.n > prev.n;
    const from = prev && (up || prev.n === lv.n) ? frac(prev) : 0;
    const label = (l) => [l.title || `Niveau ${l.n}`, l.nextTitle ? h('i', { text: ' ▸ ' }) : null, l.nextTitle ? h('b', { text: l.nextTitle }) : null, l.need > 0 ? h('em', { text: ` ${l.have}/${l.need}` }) : null];
    const txt = h('span', { class: 'mz-lvl-t' }, label(up ? prev : lv));
    const fillEl = h('i');
    fillEl.style.setProperty('--f', from.toFixed(3));
    const set = (f) => fillEl.style.setProperty('--f', f.toFixed(3));
    // la jauge gagne son cran une fois la carte affichée ; à la montée de niveau elle se remplit puis repart du nouveau palier
    clearTimeout(C.lvlT);
    C.lvlT = setTimeout(() => {
      if (!up) { set(frac(lv)); return; }
      set(1);
      C.lvlT = setTimeout(() => { txt.replaceChildren(...label(lv).filter(Boolean)); gauge.classList.add('is-up'); set(frac(lv)); }, 950);
    }, 350);
    const gauge = h('div', { class: 'mz-end-lvl' }, lv.stars > 0 ? h('span', { class: 'mz-stars', text: `★${lv.stars}` }) : null, txt, h('span', { class: 'mz-lvl-bar' }, fillEl));
    return gauge;
  }

  function showCard(e) {
    if (!e) return;
    const ok = e.outcome === 'success';
    const def = MIS.MISSION_BY_ID?.[e.id];
    const title = e.title || def?.title || 'Mission';
    const key = () => keyChip('E', env.touch);
    let full, slim, dur = 6;
    if (ok) {
      const record = !!e.pb || e.rank >= 1;
      if (record) dur = 8;
      const t = sec(e.sec), cls = e.cls === 's' ? 'Sport' : e.cls === 'v' ? 'Ville' : '';
      let perso = '';
      if (t && e.pb) perso = e.best > 0 && e.best > e.sec ? `record personnel (−${fmtTime(Math.max(1, Math.round(e.best - e.sec)))})` : 'record personnel';
      else if (t && e.best > 0) perso = `votre record ${fmtTime(e.best)}`;
      let room = '';
      if (e.rank === 1) room = `Record de salle ${t}${e.prev?.name && e.prev.id !== store.me?.id ? ` — vous détrônez ${e.prev.name}` : ''}`;
      else if (e.rank === 2 || e.rank === 3) room = `${e.rank}ᵉ temps de la salle${e.roomBest?.name ? ` · à battre : ${e.roomBest.name} ${sec(e.roomBest.sec)}` : ''}`;
      else if (e.roomBest?.name && e.roomBest.sec > 0 && e.roomBest.id !== store.me?.id) room = `À battre : ${e.roomBest.name} ${sec(e.roomBest.sec)}`;
      const primes = [e.first > 0 ? `Première réussite +${zc(e.first)}` : '', e.star > 0 ? `Mission vedette ×2 +${zc(e.star)}` : ''].filter(Boolean);
      const prev = env.level?.() || null;
      const nx = e.next;
      const nxReward = nx?.reward > 0 ? starReward(store.journal, nx.id, nx.reward) : 0; // la suivante est la vedette du jour : ×2
      // badge court de la ligne repliée : ce qu'on ne relira pas si l'on roule déjà
      const tag = e.rank === 1 ? 'record de salle' : e.pb ? 'record' : '';
      full = [
        h('div', { class: 'mz-end-head' }, h('span', { class: 'mz-eyebrow', text: 'Mission réussie' }), e.reward > 0 ? h('strong', { class: 'mz-end-gain', text: `+${zc(e.reward)}` }) : null),
        h('span', { class: 'mz-end-title', text: title }),
        t ? h('div', { class: 'mz-end-time' + (e.pb ? ' is-pb' : '') }, icon('clock', 14), h('b', { text: t }), cls ? h('span', { text: cls }) : null, perso ? h('span', { class: 'mz-end-perso', text: perso }) : null) : null,
        room ? h('div', { class: 'mz-end-room' + (e.rank === 1 ? ' is-gold' : '') }, icon('trophy', 14), h('span', { text: room })) : null,
        primes.length ? h('div', { class: 'mz-end-primes' }, primes.map((p) => h('span', { text: p }))) : null,
        levelGauge(prev, e.level),
        nx?.title ? h('div', { class: 'mz-end-next' }, key(), h('span', null, h('span', null, h('b', { text: 'Suivante : ' }), nx.title),
          // distance dans son propre élément : en paysage compact elle cède la place au titre (ui.css)
          nx.dist > 0 || nxReward > 0 ? h('small', null, nx.dist > 0 ? h('span', { class: 'mz-end-nx-d', text: fmtDist(nx.dist) + (nxReward > 0 ? ' · ' : '') }) : null, nxReward > 0 ? `+${zc(nxReward)}` : null) : null)) : null,
      ];
      // une ligne : le temps officiel et le record y restent lisibles (une course finit toujours en roulant) ; sans chrono, le libellé
      slim = [t ? null : icon('check', 14), t ? h('b', { class: 'mz-end-slim-t', text: t }) : h('b', { class: 'mz-end-slim-l', text: 'Mission réussie' }), t && tag ? h('em', { class: 'mz-end-slim-rec' + (e.rank === 1 ? ' is-room' : ''), text: tag }) : null,
        e.reward > 0 ? h('span', { class: 'mz-end-gain', text: `+${zc(e.reward)}` }) : null, nx?.title ? [key(), h('span', { class: 'mz-end-slim-nx', text: 'Suivante' })] : null];
      if (e.level) env.setLevel?.(e.level);
    } else {
      const oc = FAIL_EYEBROW[e.outcome] ? e.outcome : 'failed';
      if (oc === 'aborted') dur = 4;
      // un abandon est un choix du joueur : pas de « raison », le titre suffit
      const reason = oc === 'aborted' ? title : cap1(e.reason) || FAIL_DEFAULT[oc];
      const where = e.remain != null && isFinite(e.remain) && e.remain > 0 ? `à ${fmtDist(e.remain)} de l’arrivée` : '';
      // coupure réseau (mission perdue de vue ou serveur injoignable) : le serveur n'a rien refusé, la mission n'est pas validée
      const cut = e.code === 'lost' || e.code === 'offline';
      full = [
        h('div', { class: 'mz-end-head' }, h('span', { class: 'mz-eyebrow', text: cut ? 'Mission non validée' : FAIL_EYEBROW[oc] })),
        h('strong', { class: 'mz-end-why', text: reason }),
        oc === 'aborted' && !where ? null : h('span', { class: 'mz-end-title', text: oc === 'aborted' ? where : where ? `${title} — ${where}` : title }),
        e.retry ? h('div', { class: 'mz-end-next' }, key(), h('span', null, h('span', null, h('b', { text: 'Recommencer' })))) : null,
      ];
      slim = [icon('close', 14), h('b', { text: oc === 'aborted' ? FAIL_EYEBROW[oc] : reason }), // une ligne n'a pas la place pour la distance restante ET « Recommencer » : l'action passe d'abord (la distance est sur la carte entière)
        where && !e.retry ? h('span', { class: 'mz-end-slim-where', text: where }) : null, e.retry ? [key(), h('span', { text: 'Recommencer' })] : null];
    }
    card.className = 'mz-endcard ' + (ok ? 'is-ok' : 'is-ko') + (ok && (e.pb || e.rank >= 1) ? ' is-record' : '');
    card.replaceChildren(h('div', { class: 'mz-end-full' }, full), h('div', { class: 'mz-end-slim' }, slim));
    C.on = true; C.left = dur; C.t0 = now(); C.slim = false; C.id = e.id ?? null;
    env.onCard?.(true);
  }
  function closeCard() {
    if (!C.on) return;
    C.on = false; clearTimeout(C.lvlT);
    env.onCard?.(false);
  }
  bus.on('mission:end', showCard);
  // E ferme la carte (le gameplay, lui, suit l'objectif « Suivante / Recommencer » sur le même player:interact).
  bus.on('player:interact', () => { if (C.on && now() - C.t0 > 350) closeCard(); });

  return {
    push,
    stats: () => ({ ...stats, waiting: waiting.length, visible: !!cur }),
    card: {
      el: card,
      active: () => C.on,
      id: () => C.id,
      endedAt: () => C.t0,
      close: closeCard,
      /** Appelé à ~15 Hz : compte à rebours, repli en une ligne dès que l'on roule. */
      tick(dt, speed) {
        if (!C.on) return;
        C.left -= dt;
        if (C.left <= 0) { closeCard(); return; }
        if (!C.slim && speed > 5 && now() - C.t0 > FOLD_MS) { C.slim = true; card.classList.add('is-slim'); }
      },
    },
  };
}

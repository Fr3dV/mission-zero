// Cap permanent et « jus » du HUD — module interface.
// Jauge de niveau et étoiles (sous le portefeuille), encart « Prochain objectif » (emplacement haut-gauche),
// pastilles képis et « Défis n/3 », pile de style, traits de vitesse et liseré doré (CSS seul), vibration.
// Tout est piloté par les événements du bus ; tick() (15 Hz) et slow() (1 Hz) sont appelés par index.js.
// Aucune lecture de layout, aucun texte réécrit s'il n'a pas changé. Tout lecteur de ctx.store tolère undefined.
import { h, fill, icon, zc, fmtInt, fmtDist, keyChip, keepUnits, typo, clamp, lsGet, lsSet } from './util.js';
import * as MIS from '@shared/missions.js';
import { VEHICLES } from '@shared/catalog.js';

const starsFor = MIS.starsFor || ((n) => Math.max(0, Math.floor((n - 40) / 20)));
const STAR_EVERY = MIS.LEGEND_STAR_EVERY || 20;
const TRICK_LABEL = { drift: 'Dérive', near: 'Frôlement', air: 'Saut', prop: 'Strike', dodge: 'Esquive', speed: 'Pointe', jack: 'Emprunt', cavale: 'Cavale' };

/** Niveau déduit du nombre de missions réussies (repli quand le gameplay ne fournit pas `level`). */
export function levelFromDone(done) {
  done = Math.max(0, Math.floor(Number(done) || 0));
  const L = MIS.LEVELS || [];
  if (!L.length) return null;
  let cur = L[0], next = null;
  for (const l of L) { if (done >= l.missionsDone) cur = l; else { next = l; break; } }
  if (next) return { n: cur.level, title: cur.title, have: done - cur.missionsDone, need: next.missionsDone - cur.missionsDone, nextTitle: next.title, stars: 0 };
  const stars = starsFor(done);
  return { n: cur.level, title: cur.title, have: (done - cur.missionsDone) % STAR_EVERY, need: STAR_EVERY, nextTitle: `★ ${stars + 1}`, stars };
}
function normLevel(l) {
  if (!l || typeof l !== 'object') return null;
  const n = Math.max(1, Math.floor(Number(l.n ?? l.level) || 1));
  return { n, title: l.title || (MIS.LEVELS || []).find((x) => x.level === n)?.title || `Niveau ${n}`, have: Math.max(0, Math.floor(Number(l.have) || 0)), need: Math.max(0, Math.floor(Number(l.need) || 0)), nextTitle: l.nextTitle || '', stars: Math.max(0, Math.floor(Number(l.stars) || 0)) };
}
/** Libellé d'un défi du jour (vue publique du journal : { id, kind, goal, have, reward, claimed }). */
export function dailyLabel(d) {
  const g = Number(d?.goal) || 0, s = g > 1 ? 's' : '';
  switch (d?.kind) {
    case 'star': return 'Mission vedette du jour';
    case 'missions': return `${g} mission${s} réussie${s}`;
    case 'types': return `${g} type${s} de mission${s}`;
    case 'fares': return `${g} course${s} de taxi`;
    case 'km': return `${g >= 1000 ? fmtDist(g) : `${g} km`} au compteur`;
    case 'style': return `${fmtInt(g)} points de style`;
    default: return 'Défi du jour';
  }
}

/**
 * @param {object} ctx
 * @param {object} env { prefs, touch:bool, banner:(payload) => void, open:(panel, data) => void, idle:() => bool (HUD visible, aucun panneau) }
 */
export function createHudFun(ctx, env) {
  const { bus, store } = ctx;
  const P = env.prefs;
  const mine = (e) => !!e && !!ctx.player && e.vehicle === ctx.player.vehicle && ctx.player.mode === 'vehicle';

  // =====================================================================
  // Jauge de niveau + étoiles de Légende
  // =====================================================================
  const lvStars = h('span', { class: 'mz-stars', hidden: true });
  const lvCur = h('span'), lvNext = h('b'), lvCnt = h('em'), lvFill = h('i');
  const lvl = h('div', { class: 'mz-lvl', hidden: true }, h('span', { class: 'mz-lvl-t' }, lvStars, lvCur, h('i', { text: ' ▸ ' }), lvNext, lvCnt), h('span', { class: 'mz-lvl-bar' }, lvFill));
  const LV = { cur: null, key: '', fromGameplay: false, objKey: '' };
  function paintLevel() {
    const l = LV.cur;
    const show = !!l && !P.hideObjective;
    if (lvl.hidden === show) lvl.hidden = !show;
    if (!l) return;
    const key = `${l.n}|${l.title}|${l.have}|${l.need}|${l.nextTitle}|${l.stars}`;
    if (key === LV.key) return;
    LV.key = key;
    lvCur.textContent = l.title;
    lvNext.textContent = l.nextTitle || '';
    lvNext.previousSibling.hidden = lvNext.hidden = !l.nextTitle;
    lvCnt.textContent = l.need > 0 ? ` ${l.have}/${l.need}` : '';
    lvStars.hidden = !(l.stars > 0); lvStars.textContent = l.stars > 0 ? `★${l.stars} ` : '';
    lvl.title = `Niveau ${l.n} · ${l.title}`;
    lvFill.style.setProperty('--f', (l.need > 0 ? clamp(l.have / l.need, 0, 1) : 1).toFixed(3));
    lvl.classList.toggle('is-slim', l.n >= 3);
    obj.classList.toggle('is-slim', l.n >= 3);
  }
  function setLevel(l, fromGameplay = true) {
    const n = normLevel(l);
    if (!n) return;
    if (fromGameplay) LV.fromGameplay = true;
    LV.cur = n; paintLevel();
  }

  // =====================================================================
  // Encart « Prochain objectif »
  // =====================================================================
  const oEye = h('span', { class: 'mz-eyebrow' }), oTitle = h('strong', { class: 'mz-obj-title' });
  const oDist = h('b'), oRew = h('span'), oHintT = h('span');
  const oKey = keyChip('E', env.touch), oRoute = icon('route', 14);
  const obj = h('div', { class: 'mz-obj', hidden: true }, oEye, oTitle, h('div', { class: 'mz-obj-meta' }, oDist, oRew), h('div', { class: 'mz-obj-hint' }, oKey, oRoute, oHintT));
  const O = { allowed: true, data: store.objective || null, key: '' };
  function paintObjective() {
    const o = O.data;
    const show = O.allowed && !!o && !!o.kind && o.kind !== 'none' && !!o.title && !P.hideObjective && !(o.kind === 'dare' && P.quiet);
    if (obj.hidden === show) obj.hidden = !show;
    if (!show) return;
    const dare = o.kind === 'dare';
    const d = o.dist != null && isFinite(o.dist) && o.dist > 0 ? fmtDist(o.dist) : '';
    const key = `${o.kind}|${o.id}|${o.title}|${d}|${o.reward}|${!!o.tracking}|${!!o.star}`;
    if (key === O.key) return;
    O.key = key;
    oEye.textContent = typo(dare ? 'Chiche !' : o.star ? 'Mission vedette · ×2 aujourd’hui' : 'Prochain objectif');
    oTitle.textContent = typo(o.title);
    oDist.textContent = d;
    // mission vedette encore à faire (o.star) : le gain affiché est doublé, comme dans le Carnet, la fiche et le téléphone
    const rew = o.star && !dare ? o.reward * 2 : o.reward;
    oRew.textContent = rew > 0 ? `${d ? ' · ' : ''}+${zc(rew)}` : '';
    oKey.hidden = !!o.tracking; oRoute.hidden = !o.tracking;
    oHintT.textContent = o.tracking ? (dare ? 'En route vers le départ' : 'Itinéraire tracé') : dare ? 'Rejoindre le départ' : 'Itinéraire';
    obj.classList.toggle('is-dare', dare);
    obj.classList.toggle('is-star', !!o.star && !dare);
    obj.classList.toggle('is-tracking', !!o.tracking);
  }
  /** Niveau porté par l'objectif : appliqué seulement quand IL change (sinon un objectif pas encore rafraîchi après
   *  une fin de mission ramènerait la jauge au palier précédent, alors que mission:end vient de donner le nouveau). */
  function levelFromObjective(o) {
    const l = o?.level;
    if (!l) return;
    const k = `${l.n}|${l.have}|${l.need}|${l.stars}`;
    if (k === LV.objKey) return;
    LV.objKey = k; setLevel(l);
  }
  bus.on('gameplay:objective', (o) => {
    O.data = o || null;
    levelFromObjective(o);
    paintObjective();
  });

  // =====================================================================
  // Pastilles : képis, défis du jour
  // =====================================================================
  const kepis = [0, 1, 2].map(() => h('i', { class: 'mz-kepi' }, icon('kepi', 15)));
  const heatD = h('b', { class: 'mz-heat-d', hidden: true });
  const heatChip = h('span', { class: 'mz-chipstat mz-heat', hidden: true, title: 'Képis : semez-les par l’adresse' }, kepis, heatD);
  const HT = { key: '', d: '' };
  /** Distance de l'unité de police la plus proche, arrondie à 5 m ; rien sans unité (Infinity) ou sans module trafic. */
  function paintHeatDist() {
    let d = NaN;
    try { d = Number(ctx.traffic?.police?.dist); } catch { d = NaN; }
    const txt = isFinite(d) && d >= 0 && !heatChip.hidden ? `${Math.round(d / 5) * 5}\u00a0m` : '';
    if (txt === HT.d) return;
    HT.d = txt; heatD.textContent = txt; heatD.hidden = !txt;
  }
  function paintHeat(level, wanted) {
    const hs = store.heat;
    const lv = clamp(Math.floor(Number(level ?? hs?.level) || 0), 0, 3), w = !!(wanted ?? hs?.wanted);
    const key = `${lv}|${w}`;
    if (key === HT.key) return;
    HT.key = key;
    heatChip.hidden = lv < 1 && !w;
    for (let i = 0; i < 3; i++) kepis[i].classList.toggle('is-on', i < lv);
    heatChip.classList.toggle('is-wanted', w);
    paintHeatDist();
  }
  bus.on('heat:change', (e) => { if (e) paintHeat(e.level, e.wanted); });

  const dailyT = h('span');
  const dailyChip = h('button', { class: 'mz-chipstat mz-daily', type: 'button', hidden: true, title: 'Défis du jour — Carnet', onclick: () => env.open('phone', { tab: 'carnet' }) }, icon('flag', 13), dailyT);
  const DY = { key: '', day: null, done: {} };
  function paintDaily(announce) {
    const j = store.journal, list = Array.isArray(j?.list) ? j.list : null;
    if (!list || !list.length) { if (!dailyChip.hidden) dailyChip.hidden = true; DY.key = ''; return; }
    if (j.day !== DY.day) { DY.day = j.day; DY.done = {}; announce = false; } // premier relevé du jour : rien à annoncer
    let done = 0, ready = !!(j.full?.ready && !j.full?.claimed);
    for (const d of list) {
      const ok = d.have >= d.goal;
      if (ok) { done++; if (!d.claimed) ready = true; }
      if (ok && !DY.done[d.id] && announce && !d.claimed) env.banner({ kind: 'ok', eyebrow: 'Défi du jour réussi', title: d.label || dailyLabel(d), sub: d.reward > 0 ? `+${zc(d.reward)} à encaisser — ${env.touch ? 'Téléphone' : 'Tab'} ▸ Carnet` : '', ms: 3000 });
      DY.done[d.id] = ok;
    }
    const key = `${done}/${list.length}|${ready}`;
    if (key === DY.key) return;
    DY.key = key;
    dailyT.textContent = `Défis ${done}/${list.length}`;
    dailyChip.classList.toggle('is-ready', ready);
    dailyChip.hidden = false;
  }
  bus.on('journal:update', () => paintDaily(true));

  // =====================================================================
  // Pile de style
  // =====================================================================
  const stLines = h('div', { class: 'mz-style-lines' });
  const stMult = h('span', { class: 'mz-style-mult', text: '×1' }), stTotal = h('span', { class: 'mz-style-total', text: '0' });
  const stNote = h('span', { class: 'mz-style-note', hidden: true });
  const stFill = h('i');
  const stDay = h('span', { class: 'mz-style-day', hidden: true });
  const style = h('div', { class: 'mz-style', hidden: true }, stLines, h('div', { class: 'mz-style-main' }, stNote, stMult, stTotal), h('span', { class: 'mz-style-bar' }, stFill), stDay);
  const fxSpeed = h('div', { class: 'mz-fx mz-fx-speed' }), fxGold = h('div', { class: 'mz-fx mz-fx-gold' });
  const ST = { on: false, gold: false, total: -1, mult: -1, f: -1, lines: [], outT: 0, hideT: 0, out: false, day: '', flip: false };
  const gold = (on) => { if (on !== ST.gold) { ST.gold = on; fxGold.classList.toggle('is-on', on); } };
  function styleShow() {
    clearTimeout(ST.hideT);
    if (ST.out) styleReset(); // un nouveau combo commence pendant l'animation de sortie du précédent
    if (!ST.on) { ST.on = true; style.hidden = false; }
    gold(true);
  }
  function styleReset() {
    clearTimeout(ST.outT); ST.out = false;
    style.classList.remove('is-bank', 'is-bust');
    stNote.hidden = true; stLines.replaceChildren(); ST.lines.length = 0;
    ST.total = ST.mult = ST.f = -1; ST.day = ''; stDay.hidden = true;
  }
  function styleHide() {
    clearTimeout(ST.hideT); styleReset();
    ST.on = false; style.hidden = true; gold(false);
  }
  function styleNumbers(total, mult) {
    let moved = false;
    if (total != null && total !== ST.total) { ST.total = total; stTotal.textContent = fmtInt(total); moved = true; }
    if (mult != null && mult !== ST.mult) {
      ST.mult = mult; stMult.textContent = `×${mult}`; moved = true;
      fxGold.style.setProperty('--k', clamp(0.3 + 0.09 * mult, 0.3, 1).toFixed(2));
    }
    if (!moved) return;
    // Combo du jour : store.styleDay.pts est un ENCAISSEMENT (multiplicateur inclus) ; on lui compare donc total × multiplicateur,
    // une fois les deux valeurs à jour. Ligne affichée dès la moitié, « battu » une fois dépassé.
    const sd = store.styleDay, pts = Number(sd?.pts) || 0, worth = Math.max(0, ST.total) * Math.max(1, ST.mult);
    const own = !!sd && sd.id != null && sd.id === store.me?.id;
    const day = typo(!(pts > 0) || worth < pts * 0.5 ? '' : worth > pts ? 'Combo du jour battu : encaissez !' : own ? `Votre combo du jour : ${fmtInt(pts)}` : `À battre : ${sd.name || 'la salle'} ${fmtInt(pts)}`);
    if (day !== ST.day) { ST.day = day; stDay.textContent = day; stDay.hidden = !day; stDay.classList.toggle('is-beat', worth > pts && pts > 0); }
  }
  bus.on('style:trick', (e) => {
    if (!e) return;
    styleShow();
    // « ×n » : nombre de figures du type cumulées dans la ligne. Pas pour une dérive : sa durée et ses points sont ceux de cette seule dérive.
    const text = `${e.label || TRICK_LABEL[e.kind] || 'Figure'}${e.n > 1 && e.kind !== 'drift' && !/[×x]\s*\d/.test(e.label || '') ? ` ×${e.n}` : ''}`, pts = e.pts > 0 ? `+${fmtInt(e.pts)}` : '';
    // Une ligne par TYPE de figure (pts est le cumul du type dans le combo) ; une dérive, elle, porte ses propres points : une ligne par dérive.
    const key = e.kind === 'drift' ? `drift#${e.n || 0}` : String(e.kind);
    const at = ST.lines.findIndex((l) => l.key === key);
    let line = at >= 0 ? ST.lines[at] : null;
    if (!line) {
      line = { key, kind: e.kind, t: h('span'), p: h('b'), text: '' };
      line.el = h('div', { class: 'mz-style-line' }, line.t, line.p);
      ST.lines.push(line); stLines.appendChild(line.el);
      if (ST.lines.length > 3) ST.lines.shift().el.remove();
    } else {
      // la ligne mise à jour repasse en bas de la pile (la limite de 3 retire toujours la plus ancienne)
      if (at !== ST.lines.length - 1) { ST.lines.splice(at, 1); ST.lines.push(line); stLines.appendChild(line.el); }
      ST.flip = !ST.flip; line.el.className = 'mz-style-line ' + (ST.flip ? 'is-a' : 'is-b'); // relance l'éclat sans lecture de layout
    }
    if (text !== line.text) { line.text = text; fill(line.t, keepUnits(text)); } // la ligne est en capitales, pas ses unités (« 1,2 s », « 142 km/h »)
    line.p.textContent = pts;
    styleNumbers(e.total, e.mult);
  });
  bus.on('style:combo', (e) => {
    if (!e) return;
    if (e.active === false) { if (ST.on && !ST.out) { clearTimeout(ST.hideT); ST.hideT = setTimeout(styleHide, 350); } return; } // laisse à style:bank / style:bust le temps d'arriver
    styleShow();
    styleNumbers(e.total, e.mult);
    const f = Math.round(clamp((Number(e.left) || 0) / (Number(e.max) > 0 ? e.max : 6), 0, 1) * 50) / 50; // e.max = fenêtre d'encaissement (s)
    if (f !== ST.f) { ST.f = f; stFill.style.setProperty('--f', String(f)); }
  });
  function styleOut(cls, note, total) {
    clearTimeout(ST.hideT); clearTimeout(ST.outT);
    if (!ST.on) { ST.on = true; style.hidden = false; }
    ST.out = true;
    style.classList.remove('is-bank', 'is-bust'); style.classList.add(cls);
    stNote.textContent = typo(note); stNote.hidden = false;
    stTotal.textContent = total; ST.total = -1;
    ST.day = ''; stDay.hidden = true; // la ligne « À battre » ne reste pas sous « Record ! » ni sous un combo perdu
    gold(false);
    ST.outT = setTimeout(styleHide, 1600);
  }
  bus.on('style:bank', (e) => {
    if (!e) return;
    styleOut('is-bank', e.record ? 'Record !' : 'Encaissé', `+${fmtInt(e.pts)}`);
    fxGold.classList.remove('is-bank-a', 'is-bank-b'); ST.flip = !ST.flip; fxGold.classList.add(ST.flip ? 'is-bank-a' : 'is-bank-b');
    rumble(25, 0.3);
  });
  bus.on('style:bust', (e) => {
    if (!e) return;
    styleOut('is-bust', e.why === 'police' ? 'Combo confisqué' : 'Oups, pardon !', e.lost > 0 ? `−${fmtInt(e.lost)}` : '');
    rumble(90, 0.7);
  });

  // =====================================================================
  // Vibration (téléphone : navigator.vibrate ; manette : vibrationActuator), selon prefs.fx
  // =====================================================================
  let rumbleT = 0;
  function rumble(ms, strong) {
    if (P.fx === 'off') return;
    const t = performance.now();
    if (t - rumbleT < 90) return;
    rumbleT = t;
    const k = P.fx === 'soft' ? 0.5 : 1, dur = Math.round(clamp(ms, 10, 220) * k);
    try { if (env.touch && navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate(dur); } catch { /* indisponible */ }
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : null;
      if (pads) for (let i = 0; i < pads.length; i++) {
        const a = pads[i]?.vibrationActuator;
        if (a?.playEffect) a.playEffect('dual-rumble', { duration: dur + 40, strongMagnitude: clamp(strong * k, 0, 1), weakMagnitude: clamp(strong * k * 0.6, 0, 1) })?.catch?.(() => {});
      }
    } catch { /* indisponible */ }
  }
  bus.on('vehicle:crash', (e) => { if (mine(e) && e.impact > 4) rumble(40 + e.impact * 8, e.impact / 18); });
  bus.on('vehicle:landed', (e) => { if (mine(e)) rumble(30 + (Number(e.landV) || 0) * 6, 0.4); });
  bus.on('player:knocked', () => rumble(180, 1));
  bus.on('heat:bust', () => rumble(120, 0.8));

  // =====================================================================
  // Première voiture : un bandeau doré, une seule fois par compte, quand le solde atteint le prix de l'occasion la moins chère
  // =====================================================================
  const USED = VEHICLES.filter((v) => v.brand === 'G7' && v.price > 0).sort((a, b) => a.price - b.price)[0] || null;
  let firstCarDone = false;
  function firstCar() {
    if (firstCarDone || !USED) return;
    const me = store.me, id = me?.id;
    if (id == null || !Array.isArray(me.cars)) return;
    const key = `mz.firstcar.${id}`;
    const bought = me.cars.some((c) => { const t = typeof c === 'string' ? c : c?.typeId || c?.id; return VEHICLES.some((v) => v.id === t && v.price > 0); });
    if (bought || lsGet(key) === '1') { firstCarDone = true; return; }
    if (!((Number(me.money) || 0) >= USED.price) || !env.idle?.()) return; // pas sous un panneau : le bandeau y passerait sans être vu
    firstCarDone = true; lsSet(key, '1');
    env.banner({ kind: 'gold', eyebrow: 'Votre première voiture est à portée', title: USED.name, sub: `D’occasion · ${zc(USED.price)} — ${env.touch ? 'Téléphone' : 'Tab'} ▸ Garage ▸ Occasions`, ms: 5200 });
  }

  // premier état (le gameplay et net ont posé leurs valeurs initiales avant la création de l'interface)
  levelFromObjective(store.objective);
  paintObjective(); paintHeat(); paintDaily(false);

  let speedOn = false;
  return {
    els: { lvl, heatChip, dailyChip, obj, style, fxSpeed, fxGold },
    level: () => LV.cur,
    setLevel,
    /** L'emplacement haut-gauche est-il libre pour l'encart objectif ? (priorité : suivi > carte de fin > objectif) */
    setAllowed(on) { if (on !== O.allowed) { O.allowed = on; paintObjective(); } },
    /** Une seule ligne pendant une mission à maxDamage. */
    setCalm(on) { style.classList.toggle('is-calm', !!on); },
    /** ~15 Hz : traits de vitesse au-delà de 82 % de la vitesse maximale. */
    tick(v, abs, max) {
      const on = !!v && P.fx === 'full' && abs > 22 && abs > max * 0.82;
      if (on !== speedOn) { speedOn = on; fxSpeed.classList.toggle('is-on', on); }
      if (!heatChip.hidden || HT.d) paintHeatDist();
    },
    /** 1 Hz : relit le store (valeurs modifiées en place ou posées sans événement). */
    slow() {
      const o = store.objective;
      if (o && o !== O.data) O.data = o;
      if (o?.level) levelFromObjective(o);
      else if (!LV.fromGameplay && store.me?.id != null) { const l = levelFromDone(store.me?.stats?.missionsDone); if (l) setLevel(l, false); }
      paintObjective(); paintHeat(); paintDaily(true); firstCar();
    },
    /** À appeler après un changement de préférences. */
    applyPrefs() { paintLevel(); paintObjective(); if (P.fx !== 'full' && speedOn) { speedOn = false; fxSpeed.classList.remove('is-on'); } },
    rumble,
  };
}

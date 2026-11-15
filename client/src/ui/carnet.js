// Carnet de bord (onglet du téléphone) et fiche du matin (net:return) — module interface.
// Les deux partagent les mêmes blocs : « Aujourd'hui » (défis du jour, mission vedette, série), relevé des loyers
// d'absence, Gazette de la salle. Tout vient du store alimenté par le module réseau (store.journal, store.feed,
// store.styleDay, store.me.stats) ; chaque lecteur tolère undefined. L'interface ne crédite rien : elle émet
// intent:claim { kind: 'daily', id } ou { kind: 'away' } et attend journal:update.
import { h, fill, icon, zc, fmtInt, fmtDist, fmtDur, fmtRecord, fmtTime, badge, keyChip, clamp, de } from './util.js';
import { dailyLabel } from './hudfun.js';
import * as MIS from '@shared/missions.js';
import { VEHICLE_BY_ID } from '@shared/catalog.js';

const FULL_RATIO = 1.5; // prime de journée complète = 1,5 × la récompense d'un défi, majorée de 10 % par jour de série (règle serveur)
const GAZETTE_MAX = 40;

/**
 * @param {object} ctx
 * @param {object} env { touch:bool, has:(capacité) => bool, open:(panel, data) => void, close:() => void, distTo:({x,z}) => m }
 */
export function createCarnet(ctx, env) {
  const { bus, store } = ctx;
  const me = () => store.me || {};
  const journal = () => { const j = store.journal; return j && Array.isArray(j.list) ? j : null; };
  const missionOf = (id) => (id ? MIS.MISSION_BY_ID?.[id] || null : null);
  const plural = (n, one, many = one + 's') => (n > 1 ? many : one);

  // Réclamations en attente de la réponse du serveur (le bouton patiente au lieu de se laisser recliquer).
  const pending = new Map();
  const isPending = (key) => { const t = pending.get(key); if (t && performance.now() - t < 4000) return true; pending.delete(key); return false; };
  function claim(kind, id) {
    const key = kind + ':' + (id || '');
    if (isPending(key)) return;
    pending.set(key, performance.now());
    bus.emit('intent:claim', id ? { kind, id } : { kind });
    paint();
    setTimeout(() => { if (pending.delete(key)) paint(); }, 4100); // sans réponse (refus, coupure) : le bouton redevient cliquable
  }
  bus.on('journal:update', () => { pending.clear(); paint(); });
  bus.on('net:error', () => { if (pending.size) { pending.clear(); paint(); } });
  bus.on('feed:entry', () => { if (!sheet.hidden) paint(); });

  // ---------------------------------------------------------------- défis du jour, mission vedette, série
  /** L'état du défi « mission vedette » : encore à faire ? */
  function starTodo(j) {
    if (!j || typeof j.star !== 'string' || !missionOf(j.star)) return null;
    const d1 = j.list.find((d) => d?.kind === 'star');
    return d1 && (d1.claimed || d1.have >= d1.goal) ? null : missionOf(j.star);
  }
  function progress(d) {
    const have = Math.max(0, Number(d.have) || 0), goal = Math.max(1, Number(d.goal) || 1);
    // kilomètres TRONQUÉS au dixième (jamais « 3,0 / 3,0 km » tant qu'il reste 40 m à rouler), même format des deux côtés
    if (d.kind === 'km') return goal >= 1000 ? `${(Math.floor(Math.min(have, goal) / 100) / 10).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / ${fmtDist(goal)}` : `${fmtInt(Math.floor(have))} / ${fmtInt(goal)} km`;
    return `${fmtInt(Math.min(have, goal))} / ${fmtInt(goal)}`;
  }
  function resetIn(j) {
    const ms = Number(j?.resetAt) - Date.now();
    return ms > 0 && ms < 36 * 3600e3 ? `Nouveaux défis dans ${fmtDur(ms / 1000)}` : '';
  }
  function claimBtn(key, label, onClick, cls = 'mz-btn mz-btn--gold mz-btn--sm') {
    const wait = isPending(key);
    return h('button', { class: cls, type: 'button', disabled: wait, dataset: { claim: key }, onclick: onClick }, wait ? 'Un instant…' : label);
  }
  /** Bloc « Aujourd'hui ». opts.fresh : premier passage de la journée (titre « 3 nouveaux défis ») ; opts.sheet : dans la fiche
   *  du matin (son pied porte déjà « Y aller » : la ligne de la mission vedette n'a de bouton que dans l'onglet Carnet). */
  function today(opts = {}) {
    const j = journal();
    if (!j) return h('section', { class: 'mz-jr' }, h('div', { class: 'mz-jr-head' }, h('span', { class: 'mz-eyebrow', text: 'Aujourd’hui' })),
      h('p', { class: 'mz-dim', text: 'Vos défis du jour arrivent : ils s’affichent dès que le serveur les a tirés.' }));
    const n = j.list.length, done = j.list.filter((d) => d.have >= d.goal).length;
    const streak = Math.max(0, Number(j.streak?.n) || 0), best = Math.max(0, Number(j.streak?.best) || 0);
    const star = missionOf(j.star), todo = starTodo(j);
    const dStar = star ? env.distTo(star.start || star) : NaN;
    const reset = resetIn(j);
    // majoration de série déjà comprise dans la prime annoncée par le serveur : on la déduit au lieu de la supposer
    const R = Number(j.list[0]?.reward) || 0, ratio = R > 0 && j.full?.reward > 0 ? j.full.reward / (FULL_RATIO * R) - 1 : 0;
    const bonus = ratio > 0.04 && ratio < 0.56 ? Math.round(ratio * 10) * 10 : 0;
    return h('section', { class: 'mz-jr' },
      h('div', { class: 'mz-jr-head' },
        h('div', null, h('span', { class: 'mz-eyebrow', text: 'Aujourd’hui' }),
          h('strong', { class: 'mz-jr-title', text: opts.fresh ? `${n} ${plural(n, 'nouveau défi', 'nouveaux défis')}` : `Défis du jour · ${done}/${n}` })),
        h('div', { class: 'mz-jr-streak' + (streak > 0 ? ' is-on' : '') },
          h('b', { text: streak > 0 ? `Série : ${streak} ${plural(streak, 'jour')}` : 'Série à lancer' }),
          h('small', { text: best > streak ? `votre record : ${best} ${plural(best, 'jour')}` : streak > 0 ? 'votre plus belle série' : 'trois défis réussis = un jour de série' }))),
      star ? h('div', { class: 'mz-jr-star' + (todo ? '' : ' is-done') }, icon('star', 16),
        h('span', { class: 'mz-jr-star-t' }, h('small', { text: 'Mission vedette' }), h('b', { text: star.title })),
        todo ? badge('×2 aujourd’hui', 'mz-badge--gold') : badge('Réussie', 'mz-badge--vert', 'check'),
        todo && isFinite(dStar) ? badge(fmtDist(dStar), '', 'pin') : null,
        todo && star.reward > 0 ? h('span', { class: 'mz-jr-gain', text: `+${zc(star.reward * 2)}` }) : null,
        todo && !opts.sheet && ctx.gameplay?.startMission ? h('button', { class: 'mz-btn mz-btn--gold mz-btn--sm', type: 'button', dataset: { act: 'star-go' }, text: 'Y aller',
          disabled: !!store.mission, title: store.mission ? 'Une mission est déjà en cours' : null,
          onclick: () => { env.close(); try { ctx.gameplay.startMission(star.id); } catch { /* gameplay indisponible */ } } }) : null) : null,
      h('div', { class: 'mz-dailies' }, j.list.map((d, i) => {
        const ok = d.have >= d.goal, f = clamp((Number(d.have) || 0) / Math.max(1, Number(d.goal) || 1), 0, 1);
        return h('div', { class: 'mz-daily' + (ok ? ' is-ok' : '') + (d.claimed ? ' is-claimed' : '') },
          h('span', { class: 'mz-daily-n' }, ok ? icon('check', 14) : String(i + 1)),
          h('div', { class: 'mz-daily-main' },
            h('div', { class: 'mz-daily-top' }, h('b', { text: d.label || dailyLabel(d) }), h('span', { text: progress(d) })),
            h('span', { class: 'mz-daily-bar' }, h('i', { style: `--f:${f.toFixed(3)}` }))),
          d.claimed ? badge('Encaissé', 'mz-badge--vert', 'check')
            : ok ? claimBtn('daily:' + d.id, `Réclamer +${zc(d.reward)}`, () => claim('daily', d.id))
              : h('span', { class: 'mz-jr-gain is-todo', text: `+${zc(d.reward)}` }));
      })),
      j.full ? h('div', { class: 'mz-jr-full' + (j.full.ready && !j.full.claimed ? ' is-ready' : '') },
        h('span', null, h('b', null, 'Journée complète', bonus > 0 && !j.full.claimed ? badge(`Série +${bonus} %`, 'mz-badge--gold') : null), h('small', { text: j.full.claimed ? 'Prime encaissée : à demain pour la suite de la série.' : j.full.ready ? 'Les trois défis sont réussis : la prime vous attend.' : 'Les trois défis réussis, la prime tombe et la série avance.' })),
        j.full.claimed ? badge('Encaissée', 'mz-badge--vert', 'check')
          : j.full.ready ? claimBtn('daily:full', `Réclamer +${zc(j.full.reward)}`, () => claim('daily', 'full'))
            : h('span', { class: 'mz-jr-gain is-todo', text: j.full.reward > 0 ? `+${zc(j.full.reward)}` : '' })) : null,
      reset ? h('small', { class: 'mz-jr-reset', text: reset }) : null);
  }

  // ---------------------------------------------------------------- relevé des loyers d'absence
  let awayPayload = null; // relevé porté par net:return, tant que store.journal ne l'a pas (ou plus) en propre
  function awayData() {
    const j = journal();
    const a = j ? j.away : awayPayload;
    return a && a.rent > 0 ? a : null;
  }
  function away() {
    const a = awayData();
    if (!a) return null;
    const props = Array.isArray(a.props) ? a.props.filter((p) => p && p.rent > 0) : [];
    return h('section', { class: 'mz-jr mz-jr-away' },
      h('div', { class: 'mz-jr-head' },
        h('div', null, h('span', { class: 'mz-eyebrow', text: 'Pendant votre absence' }), h('strong', { class: 'mz-jr-title', text: a.sec > 0 ? fmtDur(a.sec) : 'Relevé des loyers' })),
        h('strong', { class: 'mz-price', text: `+${zc(a.rent)}` })),
      props.length ? h('div', { class: 'mz-away-rows' }, props.map((p) => h('div', { class: 'mz-away-row' }, icon('home', 14), h('span', { text: p.name || 'Bien' }), h('b', { text: `+${zc(p.rent)}` })))) : null,
      h('div', { class: 'mz-row mz-row--between' },
        h('small', { class: 'mz-dim', text: 'Vos biens travaillent pour vous : la moitié du loyer, douze heures au plus par absence.' }),
        claimBtn('away:', `Encaisser ${zc(a.rent)}`, () => { claim('away'); if (!journal()) awayPayload = null; }, 'mz-btn mz-btn--gold')));
  }

  // ---------------------------------------------------------------- Gazette
  function ago(t) {
    const s = (Date.now() - Number(t)) / 1000;
    if (!isFinite(s) || s < 0) return '';
    if (s < 90) return 'à l’instant';
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
    return `il y a ${Math.round(s / 86400)} j`;
  }
  /** Fin d'une phrase de record, comme le serveur : « sur « Titre » (0:17,3, Ville) » — la catégorie (`c` : 's' Sport, sinon Ville)
   *  quand le fait la porte : un temps Sport ne se bat pas en Ville. */
  const recTail = (e) => `sur « ${missionOf(e.m)?.title || 'une mission'} » (${fmtRecord(e.d)}${e.c ? `, ${e.c === 's' ? 'Sport' : 'Ville'}` : ''})`;
  /** Phrase d'un fait de gazette : celle du serveur (`x`), sinon reconstruite. */
  function factText(e) {
    if (e.x) return e.x;
    const n = e.n || 'Quelqu’un';
    switch (e.k) {
      case 'record': return `${n} ${e.pn ? `bat le record ${de(e.pn)}` : 'signe le record de salle'} ${recTail(e)}`;
      case 'buy': return `${n} a acheté « ${e.d} »`;
      case 'sell': return `${n} a vendu « ${e.d} »`;
      case 'car': return `${n} s’offre : ${e.d}`;
      case 'level': return e.st ? `${n} décroche une étoile de Légende` : `${n} passe niveau ${e.d}`;
      case 'dare': return `${n} gagne un Chiche${e.d > 0 ? ` (+${zc(e.d)})` : ''}`;
      case 'cavale': return `${n} sème les képis en ${fmtRecord(e.d)} : record de cavale`;
      case 'streak': return `${n} enchaîne ${e.d} jours de défis`;
      case 'style': return `Combo du jour : ${n}, ${fmtInt(e.d)} points`;
      default: return '';
    }
  }
  /** Record perdu par le joueur : « Bob bat VOTRE record sur … ». La phrase du serveur est reprise (elle porte la catégorie) quelle
   *  que soit son élision (« de Tom », « d'Alice », « d’Alice ») ; si elle a changé de forme, la phrase est rebâtie sur les champs. */
  function lostText(e) {
    const t = factText(e), r = t.replace(/bat le record d(?:e\s+|['’]\s*).+?(?=\ssur\s)/, 'bat VOTRE record');
    return r !== t ? r : `${e.n || 'Quelqu’un'} bat VOTRE record ${recTail(e)}`;
  }
  const FACT_ICON = { record: 'trophy', buy: 'home', sell: 'home', car: 'car', level: 'star', dare: 'flag', cavale: 'kepi', streak: 'book', style: 'bolt' };
  /** Bouton d'action d'un fait : { label, gold?, run } ou null. `inCarnet` : on est déjà dans l'onglet Carnet. */
  function factAction(e, inCarnet) {
    const mine = e.id != null && e.id === me().id;
    const carnet = inCarnet ? null : { label: 'Mon carnet', run: () => env.open('phone', { tab: 'carnet' }) };
    switch (e.k) {
      case 'record': {
        const m = missionOf(e.m);
        if (!m || mine || !ctx.gameplay?.startMission) return null;
        const lost = e.p != null && e.p === me().id;
        return { label: lost ? 'Reprendre mon record' : 'Battre ce temps', gold: lost, run: () => { env.close(); ctx.gameplay.startMission(m.id); } };
      }
      case 'car': { const v = VEHICLE_BY_ID[e.m]; return v && v.price > 0 ? { label: 'Voir au catalogue', run: () => env.open('dealer', { brand: v.brand, typeId: v.id }) } : null; }
      case 'buy': case 'sell': return e.m ? { label: 'Voir le bien', run: () => env.open('property', { id: e.m }) } : null;
      case 'level': return { label: 'Classement', run: () => env.open('phone', { tab: 'classement' }) };
      case 'dare': return env.has('dare') ? { label: 'Lancer un Chiche', run: () => env.open('phone', { tab: 'joueurs' }) } : null;
      case 'streak': return mine ? null : inCarnet ? null : { label: 'Mes défis', run: () => env.open('phone', { tab: 'carnet' }) };
      case 'style': case 'cavale': return carnet;
      default: return null;
    }
  }
  /** Liste de faits, du plus récent au plus ancien. */
  function gazette(list, max, inCarnet) {
    const rows = (Array.isArray(list) ? list : []).filter((e) => e && typeof e === 'object' && factText(e)).slice(-max).reverse();
    if (!rows.length) return null;
    return h('div', { class: 'mz-gaz' }, rows.map((e) => {
      const a = factAction(e, inCarnet), lost = e.k === 'record' && e.p != null && e.p === me().id;
      return h('div', { class: 'mz-gaz-row' + (lost ? ' is-lost' : '') }, icon(FACT_ICON[e.k] || 'flag', 15),
        h('span', { class: 'mz-gaz-t' }, h('span', { text: lost ? lostText(e) : factText(e) }), e.t ? h('small', { text: ago(e.t) }) : null),
        a ? h('button', { class: 'mz-btn mz-btn--sm' + (a.gold ? ' mz-btn--gold' : ' mz-btn--ghost'), type: 'button', text: a.label, onclick: a.run }) : null);
    }));
  }

  // ---------------------------------------------------------------- style : combo du jour, carnet de cascadeur
  function styleBlock() {
    const sd = store.styleDay, pts = Number(sd?.pts) || 0, st = me().stats || {};
    const mine = pts > 0 && sd.id != null && sd.id === me().id;
    const rows = [
      ['Meilleur combo', Math.max(Number(st.bestCombo) || 0, Number(store.style?.best) || 0), (v) => `${fmtInt(v)} pts`],
      ['Plus longue dérive', st.bestDrift, (v) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`],
      ['Plus long saut', st.bestAir, (v) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`],
      ['Frôlements', st.nearMisses, fmtInt], ['Objets fauchés', st.propsBroken, fmtInt],
      ['Cavales réussies', st.escapes, fmtInt], ['Cavale la plus rapide', st.bestEscapeSec, fmtTime],
    ].filter((r) => Number(r[1]) > 0);
    // record de cavale de la salle (la fuite la plus courte) : store.cavale { id, name, sec }
    const cv = store.cavale, cvMine = cv?.id != null && cv.id === me().id;
    return h('section', { class: 'mz-jr mz-jr-style' },
      h('div', { class: 'mz-jr-head' },
        h('div', null, h('span', { class: 'mz-eyebrow', text: 'Combo du jour de la salle' }),
          h('strong', { class: 'mz-jr-title', text: pts > 0 ? `${mine ? 'Vous' : sd.name || 'Un pilote'} · ${fmtInt(pts)} points` : 'La place est libre' })),
        pts > 0 ? badge(mine ? 'C’est le vôtre' : 'À battre', mine ? 'mz-badge--vert' : 'mz-badge--gold', mine ? 'check' : 'bolt') : null),
      pts > 0 ? null : h('p', { class: 'mz-dim', text: `Dérives, frôlements, sauts : le premier combo de ${fmtInt(2000)} points ou plus encaissé aujourd’hui prend la place.` }),
      cv?.sec > 0 ? h('div', { class: 'mz-jr-cavale' }, icon('kepi', 15), h('span', null, 'Record de cavale de la salle : ', h('b', { text: `${cvMine ? 'vous' : cv.name || 'un pilote'} · ${fmtRecord(cv.sec)}` }))) : null,
      h('h4', { class: 'mz-h4', text: 'Carnet de cascadeur' }),
      rows.length ? h('dl', { class: 'mz-stats' }, rows.map(([t, v, f]) => h('div', null, h('dt', { text: t }), h('dd', { text: f(Number(v)) }))))
        : h('p', { class: 'mz-dim', text: 'Vos plus belles figures s’inscriront ici : enchaînez-les sans toucher personne, puis laissez le combo s’encaisser.' }));
  }

  // ---------------------------------------------------------------- onglet Carnet
  function tab() {
    const feed = gazette(store.feed, GAZETTE_MAX, true);
    return [
      today(), away(), styleBlock(),
      h('h4', { class: 'mz-h4', text: 'Gazette de la salle' }),
      feed || h('p', { class: 'mz-dim', text: 'Rien à signaler pour l’instant : records, achats et exploits de la salle s’afficheront ici.' }),
    ];
  }
  /** Signature des données affichées par l'onglet (rafraîchissement à 2 Hz du téléphone). */
  function signature() {
    const j = store.journal, f = store.feed, sd = store.styleDay, st = me().stats || {};
    const last = Array.isArray(f) ? f[f.length - 1] : null, cv = store.cavale;
    return `${JSON.stringify(j || 0)}|${last ? `${f.length}:${last.t}:${last.d}` : 0}|${sd?.id}:${sd?.pts}|${cv?.id}:${cv?.sec}|${st.bestCombo}|${st.bestDrift}|${st.bestAir}|${st.nearMisses}|${st.propsBroken}|${st.escapes}|${pending.size}`;
  }
  /** Quelque chose attend d'être encaissé (pastille sur l'entrée Carnet du téléphone). */
  function hasReward() {
    const j = journal();
    if (!j) return false;
    if (j.away?.rent > 0 || (j.full?.ready && !j.full?.claimed)) return true;
    return j.list.some((d) => d.have >= d.goal && !d.claimed);
  }

  // ---------------------------------------------------------------- fiche du matin
  const R = { fresh: false, feed: [], t0: 0 };
  const sheetBody = h('div', { class: 'mz-return-body' });
  const sheetHead = h('header', { class: 'mz-return-head' });
  const sheetFoot = h('footer', { class: 'mz-return-foot' });
  const sheet = h('div', { class: 'mz-modal mz-return', hidden: true, onpointerdown: (e) => { if (e.target === sheet) env.close(); } },
    h('div', { class: 'mz-sheet mz-return-sheet', role: 'dialog', 'aria-label': 'Fiche du matin' }, sheetHead, sheetBody, sheetFoot));
  /** « Y aller » : suit la mission vedette du jour (guidage jusqu'au départ), sinon l'objectif conseillé. */
  const goal = () => ((Number(me().stats?.missionsDone) || 0) > 0 ? starTodo(journal()) : null); // débutant : l'objectif conseillé (mission d'introduction) passe avant la vedette
  function go() {
    const m = goal();
    env.close();
    let ok = false;
    try { ok = m && ctx.gameplay?.startMission ? ctx.gameplay.startMission(m.id) !== false : false; } catch { ok = false; }
    if (!ok) { try { ctx.gameplay?.followObjective?.(); } catch { /* pas d'objectif à suivre */ } }
  }
  function paintSheet() {
    if (sheet.hidden) return;
    const m = goal();
    const hour = new Date().getHours();
    fill(sheetHead,
      h('div', null, h('span', { class: 'mz-eyebrow', text: R.fresh ? 'La fiche du matin' : 'Pendant votre absence' }),
        h('h2', { class: 'mz-display mz-display--sm', text: `${hour >= 18 || hour < 4 ? 'Bonsoir' : 'Bonjour'}${me().name ? `, ${me().name}` : ''}` })),
      h('button', { class: 'mz-iconbtn', type: 'button', title: 'Fermer', 'aria-label': 'Fermer', onclick: () => env.close() }, icon('close')));
    const feed = gazette(R.feed, 12, false);
    const keep = sheetBody.scrollTop;
    fill(sheetBody, R.fresh || journal() ? today({ fresh: R.fresh, sheet: true }) : null, away(),
      feed ? [h('h4', { class: 'mz-h4', text: 'La Gazette de la salle' }), feed] : null);
    sheetBody.scrollTop = keep;
    const can = !!ctx.gameplay?.startMission || !!ctx.gameplay?.followObjective;
    fill(sheetFoot,
      h('span', { class: 'mz-hint', text: env.touch ? 'Touchez « Fermer » pour reprendre la route.' : 'N’importe quelle touche pour fermer.' }),
      h('div', { class: 'mz-row' },
        h('button', { class: 'mz-btn mz-btn--ghost', type: 'button', text: 'Fermer', onclick: () => env.close() }),
        can ? h('button', { class: 'mz-btn mz-btn--gold mz-return-go', type: 'button', onclick: go }, keyChip('E', env.touch), h('span', { text: m ? `Y aller · ${m.title}` : 'Y aller' })) : null));
  }
  let sheetSig = '';
  const sheetSignature = () => `${signature()}|${R.fresh}|${R.feed.length}|${awayPayload?.rent || 0}|${store.objective?.id || ''}`;
  function paint() { sheetSig = sheetSignature(); paintSheet(); env.repaint?.(); }

  return {
    tab, signature, hasReward,
    /** Fiche du matin : élément du panneau, ouverture (données de net:return), touche E, rafraîchissement. */
    sheet,
    show(data) {
      R.fresh = !!data?.fresh; R.feed = Array.isArray(data?.feed) ? data.feed : []; R.t0 = performance.now();
      awayPayload = data?.away && data.away.rent > 0 ? data.away : null;
      sheet.hidden = false; sheetBody.scrollTop = 0; sheetSig = sheetSignature(); paintSheet();
    },
    hide() { sheet.hidden = true; },
    openedAt: () => R.t0,
    go,
    /** 2 Hz : ne reconstruit la fiche que si ses données ont changé. */
    refresh() { if (sheet.hidden) return; const s = sheetSignature(); if (s !== sheetSig) { sheetSig = s; paintSheet(); } },
    isOpen: () => !sheet.hidden,
  };
}

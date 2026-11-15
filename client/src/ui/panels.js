// Téléphone à onglets + panneaux contextuels (concession, fiche de bien, fiche du matin) — module interface.
// Contrat v6 : chaque entrée qui dépend d'une capacité du serveur (store.feat : 'fun1', 'taxi', 'dare', 'heat', 'paint')
// est masquée quand elle manque ; tout lecteur de ctx.store / ctx.gameplay tolère undefined.
import { h, fill, icon, zc, fmtInt, fmtDist, fmtClock, fmtHour, fmtTime, fmtRecord, copyText, lsGet, lsSet, confirmButton, carSilhouette, clamp, badge, starTodoId, de } from './util.js';
import { createCarnet } from './carnet.js';
import { VEHICLES, VEHICLE_BY_ID, STARTING_MONEY } from '@shared/catalog.js';
import * as CAT from '@shared/catalog.js';
import * as PROPS from '@shared/properties.js';
import * as MIS from '@shared/missions.js';

const SELL_RATIO = PROPS.SELL_BACK_RATIO ?? 0.7;
const PAINTS = CAT.PAINTS || [], HORNS = CAT.HORNS || [];
const starsFor = MIS.starsFor || ((n) => Math.max(0, Math.floor((n - 40) / 20)));
const USED_BRAND = 'G7';       // le coin des occasions (Garage ▸ Occasions) : la première voiture à soi
const STOCK_PAINT_PRICE = 500; // repeindre dans une teinte du catalogue du modèle (les teintes du nuancier portent leur prix)
const AWAY_NIGHT_H = 12, AWAY_RATIO = 0.5; // relevé du matin : 50 % du loyer, 12 h au plus par absence (règle serveur)
const DARE_STAKES = [0, 500, 2000], DARE_JOIN_M = 80;
const TYPE_LABEL = { delivery: 'Livraison', taxi: 'Taxi', race: 'Course', chase: 'Poursuite', vip: 'Chauffeur VIP', heist: 'Coup', tour: 'Visite', timetrial: 'Contre-la-montre', collect: 'Collecte', courier: 'Coursier', escort: 'Escorte', stunt: 'Cascade', photo: 'Photo', valet: 'Voiturier' };
const KIND_LABEL = { studio: 'Studio', appartement: 'Appartement', penthouse: 'Penthouse', loft: 'Loft', hotel: 'Hôtel particulier', commerce: 'Commerce', boutique: 'Boutique', garage: 'Garage', bureau: 'Bureaux', cafe: 'Café', restaurant: 'Restaurant', maison: 'Maison', villa: 'Villa', immeuble: 'Immeuble', peniche: 'Péniche', club: 'Club', galerie: 'Galerie' };
// Statistiques du profil : clé -> [libellé, format, toujours affichée ?]. L'ordre de la table est celui de l'affichage ;
// les statistiques de la boucle fun (taxi, style, képis, Chiche) n'apparaissent qu'une fois non nulles.
const STATS = {
  missionsDone: ['Missions réussies', 'int', 1], earned: ['Total gagné', 'zc', 1], playSeconds: ['Temps de jeu', 'dur', 1],
  distance: ['Distance parcourue', 'dist', 1], topSpeed: ['Vitesse record', 'speed'], collectibles: ['Objets trouvés', 'raw', 1], landmarksSeen: ['Monuments découverts', 'raw', 1],
  dailyDone: ['Défis du jour réussis', 'int'], fares: ['Courses de taxi', 'int'], fareBestChain: ['Meilleure série de courses', 'chain'], fareEarned: ['Gains de taxi', 'zc'],
  bestCombo: ['Meilleur combo de style', 'pts'], bestDrift: ['Plus longue dérive', 'sec'], bestAir: ['Plus long saut', 'sec'], nearMisses: ['Frôlements', 'int'], propsBroken: ['Objets fauchés', 'int'],
  escapes: ['Cavales réussies', 'int'], bestEscapeSec: ['Cavale la plus rapide', 'clock'], fines: ['Amendes', 'int'], daresWon: ['Chiches gagnés', 'int'],
  bumpsGiven: ['Amis bousculés', 'int'], bumpsTaken: ['Bousculades reçues', 'int'],
};
// anciennes clés (profils et bancs d'essai antérieurs au contrat v6)
const STAT_LABEL = { missions: 'Missions réussies', missionsCompleted: 'Missions réussies', missionsFailed: 'Missions échouées', totalEarned: 'Total gagné', spent: 'Total dépensé', totalSpent: 'Total dépensé', distanceM: 'Distance parcourue', km: 'Distance parcourue', playTime: 'Temps de jeu', playTimeSec: 'Temps de jeu', timePlayed: 'Temps de jeu', crashes: 'Accrochages', rentEarned: 'Loyers encaissés', xp: 'Expérience', transfersSent: 'Virements envoyés', transfersReceived: 'Virements reçus' };
const STAT_SKIP = { level: 1, collectibleName: 1, collectiblesTotal: 1, landmarksTotal: 1 };
const cap = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const label = (map, k) => (map === TYPE_LABEL && MIS.MISSION_TYPES?.[k]?.label) || (map === KIND_LABEL && (PROPS.PROPERTY_KINDS || PROPS.KINDS)?.[k]?.label) || map[k] || cap(k);
const dec1 = (v) => (Number(v) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const hm = (sec) => { const H = Math.floor(sec / 3600), M = Math.floor((sec % 3600) / 60); return H ? `${H} h ${String(M).padStart(2, '0')}` : `${M} min`; };
/** Nom de collection au pluriel, d'après l'objet de la ville : « Macaron doré » → « Macarons dorés », « Violette de Toulouse » → « Violettes ». */
function collectionLabel(name) {
  const out = [];
  for (const w of String(name || '').trim().split(/\s+/).filter(Boolean)) {
    if (/^(de|du|des|à|au|aux|en|d['’].*)$/i.test(w)) break;
    out.push(/[sxz]$/i.test(w) ? w : w + 's');
  }
  return out.join(' ') || 'Objets trouvés';
}
// Conditions de déblocage de l'Atelier (teintes exclusives, klaxons) : le serveur tranche, l'interface affiche.
const UNLOCK_TEXT = {
  level: (n) => `Niveau ${n}${(MIS.LEVELS || []).find((l) => l.level === n)?.title ? ` · ${(MIS.LEVELS || []).find((l) => l.level === n).title}` : ''}`,
  streak: (n) => `Série de ${n} jours de défis`, fares: (n) => `${n} courses de taxi`,
  escapes: (n) => (n > 1 ? `${n} cavales réussies` : 'Une cavale réussie'), dares: (n) => (n > 1 ? `${n} Chiches gagnés` : 'Un Chiche gagné'),
  combo: (n) => `Combo de ${fmtInt(n)} points`, stars: (n) => (n > 1 ? `${n} étoiles de Légende` : 'Une étoile de Légende'),
};
const unlockLabel = (rule) => Object.keys(rule || {}).map((k) => (UNLOCK_TEXT[k] ? UNLOCK_TEXT[k](rule[k]) : 'Condition à découvrir')).join(' · ');

// [touche, action, capacité requise (store.feat) ou rien]
export const CONTROLS = [
  ['ZQSD', 'Se déplacer · conduire'], ['Souris', 'Orienter la caméra'], ['Maj', 'Courir'], ['Espace', 'Sauter · frein à main'],
  ['F', 'Monter · descendre'], ['E', 'Interagir · suivre l’objectif'], ['H', 'Klaxon'], ['G', 'Lancer un « Chiche ! »', 'dare'], ['1 – 4', 'Bulles express', 'fun1'],
  ['C', 'Changer de caméra'], ['M', 'Carte'], ['T', 'Chat'], ['Tab', 'Téléphone'],
];
/**
 * Aide des commandes. `has` : prédicat de capacité du serveur (les lignes « Chiche » et « bulles » disparaissent quand elle
 * manque) ; absent = toutes les lignes (écran d'accueil, avant la connexion). `touch` : légende des boutons à l'écran.
 */
export function controlsGrid(has, touch) {
  const ok = (c) => !c || !has || has(c);
  if (touch) return h('div', { class: 'mz-keys mz-keys--touch' }, TOUCH_CONTROLS.filter((c) => ok(c[2])).map(([ic, t]) => h('div', { class: 'mz-keyrow' }, h('span', { class: 'mz-keyico' }, icon(ic, 16)), h('span', { text: t }))));
  return h('div', { class: 'mz-keys' }, CONTROLS.filter((c) => ok(c[2])).map(([k, t]) => h('div', { class: 'mz-keyrow' }, h('kbd', { text: k }), h('span', { text: t }))));
}
// Écran tactile : la légende des boutons à l'écran, jamais de touche du clavier. [icône, action, capacité requise ou null]
const TOUCH_CONTROLS = [
  ['stick', 'Manette, à gauche : se déplacer · diriger', null], ['swipe', 'Glisser sur l’image : orienter la caméra', null],
  ['up', 'Accélérer · courir', null], ['down', 'Freiner · reculer', null], ['jump', 'Sauter · frein à main', null],
  ['car', 'Monter · descendre', null], ['hand', 'Interagir · suivre l’objectif', null],
  ['horn', 'Klaxon', null], ['horn', 'Klaxon, appui long : bulles express', 'fun1'],
  ['phone', 'Téléphone', null], ['map', 'Carte', null], ['chat', 'Chat', null],
];

// [id, libellé, icône, capacité requise (store.feat) ou null]
const TABS = [
  ['carnet', 'Carnet', 'book', 'fun1'], ['missions', 'Missions', 'mission', null], ['immo', 'Immobilier', 'home', null], ['garage', 'Garage', 'car', null],
  ['joueurs', 'Joueurs', 'users', null], ['classement', 'Classement', 'trophy', null], ['profil', 'Profil', 'user', null], ['reglages', 'Réglages', 'settings', null],
];
const TAB_ALIAS = { carnet: 'carnet', journal: 'carnet', daily: 'carnet', defis: 'carnet', missions: 'missions', property: 'immo', properties: 'immo', immobilier: 'immo', immo: 'immo', garage: 'garage', players: 'joueurs', joueurs: 'joueurs', leaderboard: 'classement', classement: 'classement', profile: 'profil', profil: 'profil', settings: 'reglages', reglages: 'reglages' };

export function createPanels(ctx, api) {
  const { bus, store } = ctx;
  const me = () => store.me || {};
  const money = () => Number(me().money) || 0;
  /** Capacité annoncée par le serveur (S.WELCOME.feat) ; absente = entrée masquée. */
  const has = (c) => Array.isArray(store.feat) && store.feat.includes(c);
  const CLOSE_TITLE = api.touch ? 'Fermer' : 'Fermer (Échap)';
  const carId = (c) => (typeof c === 'string' ? c : c?.typeId || c?.id);
  const myCars = () => (me().cars || []).map(carId).filter(Boolean);
  const myDone = () => Number(ctx.gameplay?.missionsDone ?? me().stats?.missionsDone) || 0;
  const myLevel = () => Number(ctx.gameplay?.level ?? me().level ?? me().stats?.level ?? MIS.levelForMissionsDone?.(myDone()) ?? 1) || 1;
  const levelTitle = () => { const l = (ctx.gameplay?.levels || MIS.LEVELS || []).find((x) => x.level === myLevel()); return l?.title ? ` · ${l.title}` : ''; };
  const owner = (id) => (store.propertyOwners || {})[id] || null;
  const isMine = (id) => (me().properties || []).includes(id) || (owner(id)?.id != null && owner(id).id === me().id);
  const curMissionId = () => store.mission?.id ?? store.mission?.mission?.id ?? null;
  const maxOf = (k) => Math.max(...VEHICLES.map((v) => v[k] || 0));
  const MAXV = { maxSpeed: maxOf('maxSpeed'), accel: maxOf('accel'), brake: maxOf('brake'), grip: maxOf('grip') };
  const cityName = ctx.city?.name || 'Paris', cityId = ctx.city?.id || 'paris';
  const roomName = () => store.room || ctx.params?.get('room') || cityId;
  // lien d'invitation : la ville ET la salle
  const inviteUrl = () => api.inviteUrl?.() || `${location.origin}${location.pathname}?city=${encodeURIComponent(cityId)}&room=${encodeURIComponent(roomName())}`;
  /** Longues listes (Toulouse) : affichage par tranches, le reste à la demande. */
  const PAGE = 60;
  function paged(key, items, render) {
    const max = st.more[key] || PAGE, rest = items.length - max;
    return [
      h('div', { class: 'mz-list' }, items.slice(0, max).map(render)),
      rest > 0 ? h('button', { class: 'mz-btn mz-btn--ghost mz-more', type: 'button', text: `Afficher la suite · ${rest} de plus`, onclick: () => { st.more[key] = max + PAGE; render0(); } }) : null,
    ];
  }
  const render0 = () => render(true);
  function dealerRows() {
    const list = (api.maps.dealerList?.() || []).filter((d) => d && isFinite(d.x) && isFinite(d.z)).sort((a, b) => distTo(a) - distTo(b));
    if (!list.length) return null;
    return [h('h4', { class: 'mz-h4', text: `Concessions à ${cityName}` }),
      h('div', { class: 'mz-list' }, list.map((d) => h('article', { class: 'mz-card' },
        h('div', { class: 'mz-card-main' }, h('h3', { text: d.name || (d.brand ? `Concession ${d.brand}` : 'Concession') }), h('div', { class: 'mz-tags' }, d.brand ? badge(d.brand) : null, badge(fmtDist(distTo(d)), '', 'pin'))),
        h('div', { class: 'mz-card-side' }, h('div', { class: 'mz-row' },
          h('button', { class: 'mz-btn mz-btn--ghost mz-btn--sm', type: 'button', onclick: () => { gpsTo(d, d.name || 'Concession'); api.close(); } }, icon('pin', 14), 'GPS'),
          h('button', { class: 'mz-btn mz-btn--sm', type: 'button', text: 'Catalogue', onclick: () => api.open('dealer', { brand: d.brand }) }))))))];
  }
  const pos = () => ctx.player?.pos || { x: 0, z: 0 };
  const distTo = (o) => (o && isFinite(o.x) && isFinite(o.z) ? Math.hypot(o.x - pos().x, o.z - pos().z) : NaN);
  /** Pendant une mission, une course ou un Chiche, le GPS reste réglé sur l'activité : le gameplay refuse la destination et le dit
   *  lui-même (« Terminez d'abord… ») ; l'interface n'annonce donc pas d'itinéraire. L'activité est lue AVANT la demande. */
  const gpsBusy = () => { let k = null; try { k = ctx.gameplay?.activity?.kind; } catch { k = null; } return k === 'mission' || k === 'job' || k === 'dare'; };
  const gpsTo = (o, lbl) => { const busy = gpsBusy(); api.maps.setGps(o.x, o.z, lbl); if (!busy) bus.emit('toast', { text: `Itinéraire vers ${lbl}`, kind: 'info' }); };
  const players = () => { const out = []; const P = store.players; if (P && typeof P.forEach === 'function') P.forEach((p, id) => { if (p && (p.id ?? id) !== me().id) out.push({ ...p, id: p.id ?? id }); }); return out; };
  const stars = (n) => (n > 0 ? h('span', { class: 'mz-stars', title: `${n} étoile${n > 1 ? 's' : ''} de Légende`, text: `★${n}` }) : null);

  const empty = (ico, title, text, extra) => h('div', { class: 'mz-empty' }, icon(ico, 30), h('strong', { text: title }), h('p', { text }), extra);
  const chips = (items, cur, on) => h('div', { class: 'mz-chips' }, items.map(([k, t]) => h('button', { class: 'mz-chip' + (k === cur ? ' is-on' : ''), type: 'button', text: t, onclick: () => on(k) })));
  function perfBars(v, compact) {
    const rows = [['Vitesse max', v.maxSpeed / MAXV.maxSpeed, `${Math.round(v.maxSpeed * 3.6)} km/h`], ['Accélération', v.accel / MAXV.accel, null], ['Freinage', v.brake / MAXV.brake, null], ['Tenue de route', v.grip / MAXV.grip, null]];
    return h('div', { class: 'mz-perfs' + (compact ? ' mz-perfs--sm' : '') }, rows.map(([t, f, val]) => h('div', { class: 'mz-perf' },
      h('span', { class: 'mz-perf-l', text: t }), h('span', { class: 'mz-perf-b' }, h('i', { style: `width:${Math.round(clamp(f, 0.04, 1) * 100)}%` })),
      compact ? null : h('span', { class: 'mz-perf-v', text: val || `${Math.round(f * 100)}` }))));
  }
  /** Loyers d'une nuit d'absence (relevé du matin) pour un revenu horaire donné. */
  const nightRent = (perHour) => Math.round((Number(perHour) || 0) * AWAY_NIGHT_H * AWAY_RATIO);

  // Temps de jeu : le serveur ne l'envoie qu'avec un S.PROFILE (gain, achat, loyers) ; entre deux, il avance ici.
  const PT = { base: null, at: 0 };
  function playSeconds() {
    const v = Number(me().stats?.playSeconds);
    if (!isFinite(v)) return null;
    if (v !== PT.base) { PT.base = v; PT.at = performance.now(); }
    return PT.base + (performance.now() - PT.at) / 1000;
  }
  playSeconds();
  bus.on('store:change', (p) => { if (p?.me) playSeconds(); });

  // Révisions des données poussées par le réseau (le rafraîchissement à 2 Hz ne reconstruit que si elles bougent).
  const rev = { records: 0, dare: 0, look: 0 };
  bus.on('records:change', () => { rev.records++; });
  bus.on('dare:state', () => { rev.dare++; });
  bus.on('dare:end', () => { rev.dare++; });
  bus.on('net:look', () => { rev.look++; });

  // =====================================================================
  // Téléphone
  // =====================================================================
  const st = { tab: lsGet('mz.tab', 'missions'), mFilter: 'all', pFilter: 'all', sendTo: null, sig: '', more: {}, paintFor: null, paintColor: null, stake: 0, lbView: 'worth' };
  if (!TABS.some((t) => t[0] === st.tab)) st.tab = 'missions';
  const body = h('div', { class: 'mz-phone-body' });
  const nav = h('nav', { class: 'mz-phone-nav' });
  const clock = h('span', { class: 'mz-phone-clock' });
  const net = h('span', { class: 'mz-phone-net' });
  const wallet = h('strong', { class: 'mz-phone-wallet' });
  const titleEl = h('h2', { class: 'mz-phone-title' });
  const phone = h('div', { class: 'mz-modal mz-phone', hidden: true, onpointerdown: (e) => { if (e.target === phone) api.close(); } },
    h('div', { class: 'mz-sheet mz-phone-sheet' },
      h('aside', { class: 'mz-phone-side' },
        h('div', { class: 'mz-phone-brand' }, h('em', { text: 'Mission' }), h('b', { text: 'Zéro' })),
        nav,
        h('button', { class: 'mz-navbtn mz-navbtn--map', type: 'button', 'aria-label': 'Carte', onclick: () => api.open('map') }, icon('map'), h('span', { text: 'Carte' }), api.touch ? null : h('kbd', { text: 'M' }))),
      h('section', { class: 'mz-phone-main' },
        h('header', { class: 'mz-phone-head' }, titleEl, h('div', { class: 'mz-phone-status' }, net, clock, wallet),
          h('button', { class: 'mz-iconbtn', type: 'button', title: CLOSE_TITLE, 'aria-label': 'Fermer', onclick: () => api.close() }, icon('close'))),
        body)));
  const navBtns = {};
  TABS.forEach(([id, t, ic]) => nav.appendChild(navBtns[id] = h('button', { class: 'mz-navbtn', type: 'button', title: t, dataset: { tab: id }, onclick: () => setTab(id) }, icon(ic), h('span', { text: t }))));
  const tabOk = (id) => { const t = TABS.find((x) => x[0] === id); return !!t && (!t[3] || has(t[3])); };

  const carnet = createCarnet(ctx, { touch: !!api.touch, has, open: (p, d) => api.open(p, d), close: () => api.close(), distTo, repaint: () => { if (!phone.hidden && st.tab === 'carnet') render(true); } });

  function setTab(id) { st.tab = id; st.sendTo = null; lsSet('mz.tab', id); render(true); body.scrollTop = 0; }
  function header() {
    clock.textContent = fmtHour(store.timeOfDay);
    wallet.textContent = zc(money());
    const s = api.netState();
    net.className = 'mz-phone-net is-' + s;
    net.textContent = `${cityName} · ` + (s === 'online' ? `salle ${store.room || '—'}` : s === 'offline' ? 'hors ligne' : 'connexion…');
  }

  // ----- Missions -----
  /** Activité en cours (mission, course de taxi, Chiche, guidage) : lue dans ctx.gameplay.activity, abandon unique. */
  function activity() {
    let a = null;
    try { a = ctx.gameplay?.activity || null; } catch { a = null; }
    if (!a && curMissionId()) a = { kind: 'mission', id: curMissionId(), title: store.mission?.title || store.mission?.mission?.title || 'Mission', canAbort: true };
    return a;
  }
  function abortActivity() {
    const g = ctx.gameplay;
    try { if (g?.abortActivity) g.abortActivity(); else g?.abortMission?.(); } catch (e) { console.warn('[ui] abandon', e); }
    api.close();
  }
  const ACT = { mission: ['Mission en cours', 'Abandonner'], job: ['Course de taxi en cours', 'Abandonner la course'], dare: ['Chiche ! en cours', 'Me retirer'], track: ['Guidage en cours', 'Arrêter le guidage'] };
  function activityCard(a) {
    if (!a) return null;
    const L = ACT[a.kind] || ACT.mission;
    return h('article', { class: 'mz-card mz-activity is-active' },
      h('div', { class: 'mz-card-main' }, h('span', { class: 'mz-eyebrow', text: L[0] }), h('h3', { text: a.title || L[0] })),
      h('div', { class: 'mz-card-side' }, h('button', { class: 'mz-btn mz-btn--sm', type: 'button', disabled: a.canAbort === false, title: a.canAbort === false ? 'Impossible pour l’instant' : null, dataset: { act: 'abort' }, text: L[1], onclick: abortActivity })));
  }
  /** Records de la mission par catégorie de voiture : le mien et celui de la salle. */
  function recordsRow(id) {
    if (!has('fun1')) return null;
    const R = store.records || {}, mine = R.mine?.[id] || {}, room = R.room?.[id] || {};
    const cell = (cls, name) => {
      const my = Number(mine[cls]) || 0;
      let r = room[cls]; if (Array.isArray(r)) r = r[0];
      const rs = Number(r?.sec) || 0;
      if (!my && !rs) return null;
      const holder = rs > 0 && r.id != null && r.id === me().id;
      return h('span', { class: 'mz-rec' + (holder ? ' is-mine' : '') }, h('small', { text: name }),
        my ? h('b', { text: `vous ${fmtRecord(my)}` }) : null,
        rs ? h('span', { text: holder ? 'record de salle' : `salle : ${r.name || '…'} ${fmtRecord(rs)}` }) : null);
    };
    const cells = [cell('v', 'Ville'), cell('s', 'Sport')].filter(Boolean);
    return cells.length ? h('div', { class: 'mz-recs' }, icon('trophy', 13), cells) : null;
  }
  /** Mission vedette du jour encore à faire (payée double) : son id, sinon null. */
  const starId = () => starTodoId(store.journal);
  function tabMissions() {
    const list = api.maps.missionList().filter((m) => m && m.id);
    const types = [...new Set(list.map((m) => m.type).filter(Boolean))];
    if (st.mFilter !== 'all' && !types.includes(st.mFilter)) st.mFilter = 'all';
    const act = activity();
    const cur = act?.kind === 'mission' ? act.id : curMissionId();
    const states = {};
    try { for (const s of ctx.gameplay?.getMissionStates?.() || []) if (s?.mission?.id) states[s.mission.id] = s; } catch { /* états indisponibles */ }
    const star = starId();
    // tri : en cours, mission vedette du jour, puis disponibles de la plus proche à la plus lointaine, puis en attente, puis verrouillées par niveau
    const info = {};
    for (const m of list) {
      const stt = states[m.id], cd = Number(stt?.cooldownLeft) || 0;
      const locked = stt ? !!stt.locked : (m.level || 1) > myLevel(), s = stt?.start || m.start, d = distTo(s);
      const isStar = !locked && (stt?.star != null ? !!stt.star : m.id === star);
      info[m.id] = { stt, cd, locked, s, d, isStar, rank: m.id === cur ? 0 : locked ? 3 : cd > 0 ? 2 : isStar ? 0.5 : 1 };
    }
    const far = (d) => (isFinite(d) ? d : 1e9);
    const shown = list.filter((m) => st.mFilter === 'all' || m.type === st.mFilter).sort((a, b) => {
      const A = info[a.id], B = info[b.id];
      return A.rank - B.rank || (A.rank === 3 ? (a.level || 1) - (b.level || 1) : 0) || far(A.d) - far(B.d) || (a.reward || 0) - (b.reward || 0);
    });
    const out = [activityCard(act)];
    if (types.length > 1) out.push(chips([['all', `Toutes · ${list.length}`], ...types.map((t) => [t, label(TYPE_LABEL, t)])], st.mFilter, (k) => { st.mFilter = k; render(true); }));
    if (!shown.length) out.push(empty('mission', 'Aucune mission', `Pas encore de mission à ${cityName} : elles arrivent bientôt. En attendant, la ville est à vous.`));
    out.push(paged('missions:' + st.mFilter, shown, (m) => {
      const { stt, cd, locked, s, d, isStar } = info[m.id], active = m.id === cur;
      return h('article', { class: 'mz-card mz-mission' + (active ? ' is-active' : '') + (locked ? ' is-locked' : '') + (isStar ? ' is-star' : ''), dataset: { mission: m.id } },
        h('div', { class: 'mz-card-main' },
          h('div', { class: 'mz-card-top' }, h('h3', { text: m.title || m.id }), active ? badge('En cours', 'mz-badge--gold') : null, isStar ? badge('×2 aujourd’hui', 'mz-badge--gold mz-badge--star', 'star') : null),
          m.description ? h('p', { class: 'mz-dim', text: m.description }) : null,
          h('div', { class: 'mz-tags' },
            m.type ? badge(label(TYPE_LABEL, m.type)) : null,
            m.giver ? badge(typeof m.giver === 'string' ? m.giver : m.giver.name || 'Contact', '', 'user') : null,
            m.level > 1 || locked ? badge(`Niveau ${m.level}`, locked ? 'mz-badge--rouge' : '', locked ? 'lock' : null) : null,
            m.timeLimitSec ? badge(fmtClock(m.timeLimitSec), '', 'clock') : null,
            stt?.done > 0 ? badge(`Réussie ×${stt.done}`, 'mz-badge--vert', 'check') : null,
            cd > 0 && !active ? badge(`Disponible dans ${fmtClock(cd)}`, 'mz-badge--mute', 'clock') : null,
            isFinite(d) ? badge(fmtDist(d), '', 'pin') : null),
          recordsRow(m.id)),
        h('div', { class: 'mz-card-side' },
          h('div', { class: 'mz-price', text: m.reward != null ? `+${zc(isStar ? m.reward * 2 : m.reward)}` : '' }),
          h('div', { class: 'mz-row' },
            s && isFinite(s.x) ? h('button', { class: 'mz-btn mz-btn--ghost mz-btn--sm', type: 'button', onclick: () => { gpsTo(s, m.title || 'Mission'); api.close(); } }, icon('pin', 14), 'GPS') : null,
            active
              ? h('button', { class: 'mz-btn mz-btn--sm', type: 'button', text: 'Abandonner', disabled: act?.canAbort === false, onclick: abortActivity })
              // canStart (gameplay) : disponible ET aucune mission en cours ; le bouton grisé dit pourquoi
              : h('button', { class: 'mz-btn mz-btn--gold mz-btn--sm', type: 'button', disabled: locked || cd > 0 || !ctx.gameplay?.startMission || (stt && stt.canStart === false),
                title: !locked && !(cd > 0) && stt && stt.canStart === false && cur ? 'Une mission est déjà en cours' : null,
                onclick: () => { ctx.gameplay?.startMission?.(m.id); api.close(); } }, icon(locked ? 'lock' : cd > 0 ? 'clock' : 'play', 14), locked ? 'Verrouillée' : cd > 0 ? 'En attente' : 'Démarrer'))));
    }));
    return out;
  }

  // ----- Immobilier -----
  function propertyActions(p, small) {
    const cls = small ? ' mz-btn--sm' : '';
    const mine = isMine(p.id), o = owner(p.id), out = [];
    if (isFinite(p.x) && isFinite(p.z)) out.push(h('button', { class: 'mz-btn mz-btn--ghost' + cls, type: 'button', onclick: () => { gpsTo(p, p.name); api.close(); } }, icon('pin', 14), 'GPS'));
    if (mine) out.push(confirmButton(`Vendre ${zc(p.price * SELL_RATIO)}`, 'Confirmer la vente', () => bus.emit('intent:sellProperty', { id: p.id }), 'mz-btn' + cls));
    else if (!o) {
      const b = confirmButton('Acheter', `Confirmer ${zc(p.price)}`, () => bus.emit('intent:buyProperty', { id: p.id }), 'mz-btn mz-btn--gold' + cls);
      if (money() < p.price) { b.disabled = true; b.title = `Il vous manque ${zc(p.price - money())}`; }
      out.push(b);
    }
    return out;
  }
  function ownerBadge(p) {
    const o = owner(p.id);
    return isMine(p.id) ? badge('À vous', 'mz-badge--vert', 'check') : o ? badge(`Propriété ${de(o.name || 'un joueur')}`, 'mz-badge--mute', 'lock') : badge('À vendre', 'mz-badge--gold');
  }
  function tabImmo() {
    const list = api.maps.propertyList().filter((p) => p && p.id);
    const mine = list.filter((p) => isMine(p.id));
    const rent = mine.reduce((s, p) => s + (p.income || 0), 0);
    const away = has('fun1');
    const shown = list.filter((p) => (st.pFilter === 'mine' ? isMine(p.id) : st.pFilter === 'free' ? !owner(p.id) && !isMine(p.id) : true)).sort((a, b) => (a.price || 0) - (b.price || 0));
    return [
      h('div', { class: 'mz-kpis' },
        h('div', { class: 'mz-kpi' }, h('span', { text: 'Vos biens' }), h('strong', { text: `${mine.length}` }), h('small', { text: `sur ${list.length}` })),
        h('div', { class: 'mz-kpi' }, h('span', { text: 'Loyers' }), h('strong', { text: zc(rent) }), h('small', { text: away && rent > 0 ? `par heure connectée · environ +${zc(nightRent(rent))} par nuit d’absence` : 'par heure connectée' })),
        h('div', { class: 'mz-kpi' }, h('span', { text: 'Patrimoine' }), h('strong', { text: zc(mine.reduce((s, p) => s + (p.price || 0), 0)) }), h('small', { text: `revente à ${Math.round(SELL_RATIO * 100)} %` }))),
      chips([['all', 'Tous'], ['free', 'À vendre'], ['mine', 'Les miens']], st.pFilter, (k) => { st.pFilter = k; render(true); }),
      shown.length ? null : empty('home', 'Rien ici', !list.length ? `Aucun bien n’est encore en vente à ${cityName}.` : st.pFilter === 'mine' ? 'Vous ne possédez encore aucun bien. Un premier studio rapporte vite.' : 'Aucun bien ne correspond.'),
      paged('immo:' + st.pFilter, shown, (p) => h('article', { class: 'mz-card' + (isMine(p.id) ? ' is-active' : '') },
        h('div', { class: 'mz-card-main' },
          h('div', { class: 'mz-card-top' }, h('h3', { text: p.name }), ownerBadge(p)),
          h('div', { class: 'mz-tags' }, badge(label(KIND_LABEL, p.kind)), badge(`Loyer ${zc(p.income)}/h`, '', 'bolt'),
            p.garageSlots ? badge(`${p.garageSlots} place${p.garageSlots > 1 ? 's' : ''}`, '', 'car') : null, isFinite(distTo(p)) ? badge(fmtDist(distTo(p)), '', 'pin') : null)),
        h('div', { class: 'mz-card-side' }, h('div', { class: 'mz-price', text: zc(p.price) }), h('div', { class: 'mz-row' }, propertyActions(p, true))))),
    ];
  }

  // ----- Garage -----
  function takeOut(typeId) {
    bus.emit('intent:setActiveCar', { typeId });
    bus.emit('intent:spawnCar', { typeId });
    api.close();
  }
  const colorOf = (v) => me().carColors?.[v.id] || v.colors?.[0] || '#c8ccd0';
  /** Valeur du joueur lue par une condition de déblocage (toutes monotones : rien ne se reverrouille). */
  function unlockValue(k) {
    const s = me().stats || {};
    switch (k) {
      case 'level': return myLevel();
      case 'streak': return Number(store.journal?.streak?.best) || 0;
      case 'fares': return Number(s.fares) || 0;
      case 'escapes': return Number(s.escapes) || 0;
      case 'dares': return Number(s.daresWon) || 0;
      case 'combo': return Number(s.bestCombo) || 0;
      case 'stars': return starsFor(myDone());
      default: return 0;
    }
  }
  const isUnlocked = (rule) => !rule || Object.keys(rule).every((k) => unlockValue(k) >= rule[k]);
  /** Première voiture à portée : l'occasion la moins chère est payable et aucune voiture n'a encore été achetée. */
  function firstCarReady() {
    const v = VEHICLES.filter((x) => x.brand === USED_BRAND && x.price > 0).sort((a, b) => a.price - b.price)[0];
    return !!v && money() >= v.price && !myCars().some((id) => VEHICLE_BY_ID[id]?.price > 0);
  }
  // Récompenses débloquées en jouant (klaxons, teintes exclusives) : un bandeau chacune, au moment où la condition est remplie.
  // Rien au premier profil reçu : l'ensemble de départ est relevé en silence pendant 5 s après chaque connexion (profil, journal
  // et niveau n'arrivent pas dans le même message). L'ensemble ne fait que grandir : rien n'est annoncé deux fois.
  const UNL = { id: null, seen: new Set(), quietUntil: 0 };
  bus.on('net:welcome', () => { UNL.quietUntil = performance.now() + 5000; });
  function watchUnlocks() {
    const id = me().id;
    if (id == null) return;
    const now = performance.now();
    if (id !== UNL.id) { UNL.id = id; UNL.seen = new Set(); UNL.quietUntil = Math.max(UNL.quietUntil, now + 5000); }
    const silent = now < UNL.quietUntil;
    if (!silent && api.idle && !api.idle()) return; // sous un panneau le bandeau passerait sans être vu : on attend sa fermeture
    const where = api.touch ? 'Téléphone' : 'Tab';
    const check = (key, rule, payload) => {
      if (UNL.seen.has(key) || !isUnlocked(rule)) return;
      UNL.seen.add(key);
      if (!silent) api.banner?.(payload());
    };
    if (has('fun1')) for (const k of HORNS) if (k.unlock) check(`h:${k.id}`, k.unlock, () => ({ kind: 'ok', eyebrow: 'Nouveau klaxon débloqué', title: k.name, sub: `${where} ▸ Garage pour le monter`, ms: 3600 }));
    if (has('paint')) for (const p of PAINTS) if (p.unlock) check(`p:${p.id}`, p.unlock, () => ({ kind: 'ok', eyebrow: 'Teinte exclusive débloquée', title: p.name, sub: `${where} ▸ Garage ▸ Atelier`, ms: 3600 }));
  }
  /** Coin des occasions : la voiture la moins chère de la marque d'occasion (Taxi Parisien), 3 clics depuis le HUD. */
  function usedCard() {
    const v = VEHICLES.filter((x) => x.brand === USED_BRAND && x.price > 0).sort((a, b) => a.price - b.price)[0];
    if (!v) return null;
    const owned = myCars().includes(v.id);
    return h('article', { class: 'mz-card mz-used' },
      h('div', { class: 'mz-used-car' }, carSilhouette(v, colorOf(v))),
      h('div', { class: 'mz-card-main' }, h('span', { class: 'mz-eyebrow', text: 'Le coin des occasions' }), h('h3', { text: v.name }),
        h('p', { class: 'mz-dim', text: owned ? (has('taxi') ? 'Il dort dans votre garage : à son volant, vos courses de taxi rapportent un quart de plus.' : 'Il dort dans votre garage, prêt à reprendre du service.') : has('taxi') ? 'La première voiture à soi : pas la plus vive, mais elle fait le taxi mieux que personne.' : 'La première voiture à soi : pas la plus vive, mais c’est la vôtre.' })),
      h('div', { class: 'mz-card-side' }, owned ? badge('Au garage', 'mz-badge--vert', 'check') : h('div', { class: 'mz-price', text: zc(v.price) }),
        h('button', { class: 'mz-btn mz-btn--gold mz-btn--sm', type: 'button', dataset: { act: 'used' }, text: 'Occasions', onclick: () => api.open('dealer', { brand: USED_BRAND }) })));
  }
  /** L'Atelier d'une voiture : teintes du catalogue, nuancier, exclusives cadenassées. */
  function atelier(v) {
    const cur = colorOf(v).toLowerCase();
    const sel = st.paintFor === v.id && st.paintColor ? st.paintColor : cur;
    const P = PAINTS.find((p) => p.color === sel);
    const locked = !!P && !isUnlocked(P.unlock);
    const price = P ? Number(P.price) || 0 : STOCK_PAINT_PRICE;
    const swatch = (c, name, lock) => h('button', { class: 'mz-swatch' + (c === sel ? ' is-on' : '') + (lock ? ' is-locked' : '') + (c === cur ? ' is-cur' : ''), type: 'button', style: `--c:${c}`, title: name, 'aria-label': `Teinte ${name}${lock ? ' (verrouillée)' : ''}`, dataset: { color: c },
      onclick: () => { st.paintFor = v.id; st.paintColor = c; render(true); } }, lock ? icon('lock', 11) : null);
    const group = (title, kids) => (kids.length ? h('div', { class: 'mz-swatches' }, h('span', { class: 'mz-eyebrow', text: title }), kids) : null);
    const paid = PAINTS.filter((p) => !p.unlock), excl = PAINTS.filter((p) => p.unlock);
    let action;
    if (sel === cur) action = h('span', { class: 'mz-dim', text: 'C’est sa teinte actuelle.' });
    else if (locked) action = h('span', { class: 'mz-lockline' }, icon('lock', 14), unlockLabel(P.unlock));
    else {
      action = confirmButton(price > 0 ? `Repeindre · ${zc(price)}` : 'Repeindre · offerte', price > 0 ? `Confirmer ${zc(price)}` : 'Confirmer', () => bus.emit('intent:paintCar', { typeId: v.id, color: sel }), 'mz-btn mz-btn--gold mz-btn--sm');
      action.dataset.act = 'paint';
      if (money() < price) { action.disabled = true; action.title = `Il vous manque ${zc(price - money())}`; }
    }
    const name = P ? P.name : (v.colors || []).map((c) => c.toLowerCase()).includes(sel) ? 'Teinte du catalogue' : 'Teinte actuelle';
    return h('div', { class: 'mz-atelier' },
      group(`Catalogue · ${zc(STOCK_PAINT_PRICE)}`, (v.colors || []).map((c) => swatch(c.toLowerCase(), 'du catalogue', false))),
      group('Nuancier', paid.map((p) => swatch(p.color, `${p.name} · ${zc(p.price)}`, false))),
      group('Exclusives', excl.map((p) => swatch(p.color, `${p.name} — ${unlockLabel(p.unlock)}`, !isUnlocked(p.unlock)))),
      h('div', { class: 'mz-atelier-foot' }, h('span', null, h('b', { text: name }), P && !locked && price > 0 ? h('small', { text: ` · ${zc(price)}` }) : P && !locked ? h('small', { text: ' · débloquée' }) : null), action));
  }
  const HP = { id: null, end: 0 }; // aperçu de klaxon en cours : lequel, et jusqu'à quand (ms)
  /** Choix du klaxon : ceux qui sont débloqués se montent d'un clic, les autres annoncent leur condition. */
  function hornBlock() {
    if (!has('fun1') || !HORNS.length) return null;
    const cur = me().look?.h || 'std';
    return [h('h4', { class: 'mz-h4', text: 'Klaxon' }),
      h('div', { class: 'mz-horns' }, HORNS.map((k) => {
        const ok = isUnlocked(k.unlock);
        return h('button', { class: 'mz-horn' + (k.id === cur ? ' is-on' : '') + (ok ? '' : ' is-locked'), type: 'button', dataset: { horn: k.id }, title: ok ? (k.id === cur ? 'Klaxon monté' : 'Monter ce klaxon') : unlockLabel(k.unlock),
          onclick: () => {
            // aperçu sonore : le MÊME klaxon ne se relance pas par-dessus lui-même (clics rapides) ; passer d'un klaxon à l'autre reste immédiat
            const now = performance.now(), again = HP.id === k.id && now < HP.end;
            if (!again) {
              HP.id = k.id; HP.end = now + 1000 * (k.notes || []).reduce((s, n) => s + (Number(n?.[1]) || 0), 0);
              try { ctx.audio?.play?.('honk', { h: k.id }); } catch { /* aperçu sonore indisponible */ }
            }
            if (!ok) { if (!again) bus.emit('toast', { text: `« ${k.name} » — à débloquer : ${unlockLabel(k.unlock)}.`, kind: 'info' }); return; }
            if (k.id !== cur) bus.emit('intent:setLook', { horn: k.id });
          } }, icon(ok ? 'horn' : 'lock', 15), h('span', null, h('b', { text: k.name }), h('small', { text: k.id === cur ? 'Monté' : ok ? 'Débloqué' : unlockLabel(k.unlock) })));
      }))];
  }
  function tabGarage() {
    const cars = [...new Set(myCars())].map((id) => VEHICLE_BY_ID[id]).filter(Boolean);
    if (!cars.length) return [empty('car', 'Garage vide', 'Passez au coin des occasions ou dans une concession pour acheter votre première voiture.'), usedCard(), dealerRows()];
    const active = carId(me().activeCar), paint = has('paint');
    if (!paint) st.paintFor = null;
    const usedOwned = VEHICLES.some((x) => x.brand === USED_BRAND && x.price > 0 && myCars().includes(x.id));
    return [
      usedOwned ? null : usedCard(), // tant qu'elle n'est pas au garage, la première voiture abordable passe en tête
      h('p', { class: 'mz-lead', text: paint ? 'Sortez une voiture : elle apparaît près de vous, prête à démarrer. L’Atelier la repeint, et vos amis la voient.' : 'Sortez une voiture : elle apparaît près de vous, prête à démarrer.' }),
      h('div', { class: 'mz-grid' }, cars.map((v) => {
        const open = paint && st.paintFor === v.id;
        return h('article', { class: 'mz-card mz-carcard' + (v.id === active ? ' is-active' : '') + (open ? ' is-atelier' : ''), dataset: { car: v.id } },
          carSilhouette(v, open && st.paintColor ? st.paintColor : colorOf(v)),
          h('div', { class: 'mz-card-top' }, h('div', null, h('span', { class: 'mz-eyebrow', text: v.brand }), h('h3', { text: v.name })), v.id === active ? badge('Active', 'mz-badge--gold') : v.electric ? badge('Électrique', '', 'bolt') : null),
          open ? atelier(v) : perfBars(v, true),
          h('div', { class: 'mz-row mz-row--end' },
            paint ? h('button', { class: 'mz-btn mz-btn--ghost mz-btn--sm', type: 'button', dataset: { act: 'atelier' }, onclick: () => { st.paintFor = open ? null : v.id; st.paintColor = null; render(true); } }, icon('drop', 14), open ? 'Fermer l’Atelier' : 'Atelier') : null,
            v.id === active || open ? null : h('button', { class: 'mz-btn mz-btn--ghost mz-btn--sm', type: 'button', text: 'Par défaut', onclick: () => bus.emit('intent:setActiveCar', { typeId: v.id }) }),
            h('button', { class: 'mz-btn mz-btn--gold mz-btn--sm', type: 'button', onclick: () => takeOut(v.id) }, icon('key', 14), 'Sortir')));
      })),
      hornBlock(),
      usedOwned ? [h('h4', { class: 'mz-h4', text: 'Le coin des occasions' }), usedCard()] : null,
      dealerRows(),
    ];
  }

  // ----- Joueurs -----
  function sendForm(p) {
    const input = h('input', { class: 'mz-input', type: 'number', min: '1', step: '1', placeholder: 'Montant', inputmode: 'numeric' });
    const err = h('span', { class: 'mz-err' });
    const go = () => {
      const a = Math.floor(Number(input.value));
      if (!(a > 0)) { err.textContent = 'Indiquez un montant.'; return; }
      if (a > money()) { err.textContent = `Solde insuffisant (${zc(money())}).`; return; }
      bus.emit('intent:transfer', { toPlayerId: p.id, amount: a });
      st.sendTo = null; render(true);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    setTimeout(() => input.focus(), 30);
    return h('div', { class: 'mz-send' },
      h('span', { class: 'mz-dim', text: `Envoyer à ${p.name || 'ce joueur'}` }),
      h('div', { class: 'mz-row' }, input, [100, 1000, 10000].filter((v) => v <= money()).map((v) => h('button', { class: 'mz-chip', type: 'button', text: fmtInt(v), onclick: () => { input.value = v; err.textContent = ''; } })),
        h('button', { class: 'mz-btn mz-btn--gold mz-btn--sm', type: 'button', onclick: go }, icon('send', 14), 'Envoyer'),
        h('button', { class: 'mz-btn mz-btn--ghost mz-btn--sm', type: 'button', text: 'Annuler', onclick: () => { st.sendTo = null; render(true); } })),
      err);
  }
  const inviteBtn = () => {
    const b = h('button', { class: 'mz-btn mz-btn--sm', type: 'button' }, icon('copy', 14), h('span', { text: 'Copier le lien d’invitation' }));
    b.addEventListener('click', async () => { const ok = await copyText(inviteUrl()); b.lastChild.textContent = ok ? 'Lien copié' : inviteUrl(); });
    return b;
  };
  /** « Chiche ! » : lancer (mise 0 / 500 / 2 000), donner le départ, rejoindre ou se retirer. */
  function dareCard(others) {
    if (!has('dare')) return null;
    const d = store.dare && store.dare.id != null ? store.dare : null;
    if (d) {
      const byMe = d.by?.id != null && d.by.id === me().id, n = Array.isArray(d.players) ? d.players.length : 0, open = d.phase === 'open';
      const dist = distTo(d.origin), near = isFinite(dist) && dist <= DARE_JOIN_M;
      const acts = [];
      if (byMe && open) acts.push(h('button', { class: 'mz-btn mz-btn--gold mz-btn--sm', type: 'button', dataset: { act: 'dare-go' }, disabled: n < 2, title: n < 2 ? 'Il faut au moins un adversaire au départ' : null, onclick: () => { bus.emit('intent:dareGo', {}); api.close(); } }, icon('flag', 14), 'Donner le départ'));
      if (d.mine) acts.push(h('button', { class: 'mz-btn mz-btn--sm', type: 'button', dataset: { act: 'dare-leave' }, text: byMe && open ? 'Annuler' : 'Me retirer', onclick: () => { const a = activity(); if (a?.kind === 'dare' && ctx.gameplay?.abortActivity) ctx.gameplay.abortActivity(); else bus.emit('intent:dareLeave', {}); api.close(); } }));
      else if (open && near) acts.push(h('button', { class: 'mz-btn mz-btn--gold mz-btn--sm', type: 'button', dataset: { act: 'dare-join' }, disabled: money() < (d.stake || 0), onclick: () => {
        // même garde que le lancement (et que la touche G, qui passe par le gameplay) : pas de Chiche pour lever une poursuite
        if (store.heat?.wanted) { bus.emit('toast', { text: 'Semez d’abord les képis.', kind: 'error' }); return; }
        bus.emit('intent:dareJoin', { id: d.id }); api.close();
      } }, icon('flag', 14), d.stake > 0 ? `Relever le défi · mise ${zc(d.stake)}` : 'Relever le défi'));
      else if (open && d.origin && isFinite(d.origin.x)) acts.push(h('button', { class: 'mz-btn mz-btn--gold mz-btn--sm', type: 'button', dataset: { act: 'dare-gps' }, onclick: () => { gpsTo(d.origin, d.origin.label || 'Départ du Chiche'); api.close(); } }, icon('pin', 14), 'Rejoindre le départ'));
      return h('article', { class: 'mz-card mz-dare is-active' },
        h('div', { class: 'mz-card-main' }, h('span', { class: 'mz-eyebrow', text: open ? 'Chiche ! — on attend les pilotes' : 'Chiche ! — c’est parti' }),
          h('h3', { text: byMe ? 'Votre Chiche' : `Chiche ${de(d.by?.name || 'la salle')}` }),
          h('div', { class: 'mz-tags' }, badge(d.stake > 0 ? `Mise ${zc(d.stake)}` : 'Pour la gloire', 'mz-badge--gold'), badge(`${n} pilote${n > 1 ? 's' : ''}`, '', 'users'),
            d.origin?.label ? badge(`Départ : ${d.origin.label}`, '', 'flag') : null, d.to?.label ? badge(`Arrivée : ${d.to.label}`, '', 'pin') : null,
            open && isFinite(dist) && !d.mine ? badge(fmtDist(dist), '', 'pin') : null)),
        h('div', { class: 'mz-card-side' }, h('div', { class: 'mz-row' }, acts)));
    }
    if (!others) return null;
    if (!DARE_STAKES.includes(st.stake) || st.stake > money()) st.stake = 0;
    const a = activity(), busy = a && (a.kind === 'mission' || a.kind === 'job');
    return h('article', { class: 'mz-card mz-dare' },
      h('div', { class: 'mz-card-main' }, h('span', { class: 'mz-eyebrow', text: 'Chiche !' }), h('h3', { text: 'La course express entre amis' }),
        h('p', { class: 'mz-dim', text: busy ? 'Terminez d’abord votre activité en cours : le Chiche se lance les mains libres.' : 'Le serveur tire une arrivée à un ou deux kilomètres : vos amis rejoignent votre point de départ, vous donnez le signal, le premier arrivé rafle les mises.' })),
      h('div', { class: 'mz-card-side' },
        h('div', { class: 'mz-seg', role: 'group', 'aria-label': 'Mise' }, DARE_STAKES.map((s) => h('button', { class: s === st.stake ? 'is-on' : '', type: 'button', dataset: { stake: String(s) }, disabled: s > money(), text: s > 0 ? zc(s) : 'Sans mise', onclick: () => { st.stake = s; render(true); } }))),
        h('button', { class: 'mz-btn mz-btn--gold mz-btn--sm', type: 'button', dataset: { act: 'dare' }, disabled: !!busy, onclick: () => {
          if (store.heat?.wanted) { bus.emit('toast', { text: 'Semez d’abord les képis.', kind: 'error' }); return; }
          bus.emit('intent:dare', { stake: st.stake }); api.close();
        } }, icon('flag', 14), 'Chiche !')));
  }
  function tabJoueurs() {
    const list = players().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (!list.length) return [dareCard(false), empty('users', 'Personne d’autre pour l’instant', `Partagez le code de salle « ${roomName()} » pour jouer à ${cityName} avec vos amis.`, inviteBtn())];
    return [
      h('div', { class: 'mz-row mz-row--between' }, h('p', { class: 'mz-lead', text: `${list.length + 1} joueurs à ${cityName}, salle « ${roomName()} »` }), inviteBtn()),
      dareCard(true),
      h('div', { class: 'mz-list' }, list.map((p) => {
        const veh = p.mode === 'vehicle' ? VEHICLE_BY_ID[p.vehicleType]?.name || 'En voiture' : 'À pied';
        const lv = Number(p.lvl) || 0, lvT = lv > 0 ? (MIS.LEVELS || []).find((l) => l.level === lv)?.title : null;
        return h('article', { class: 'mz-card mz-player' },
          h('div', { class: 'mz-avatar', text: (p.name || '?').slice(0, 1).toUpperCase() }),
          h('div', { class: 'mz-card-main' }, h('h3', null, p.name || 'Joueur', stars(Number(p.st) || 0)),
            h('div', { class: 'mz-tags' }, lv > 0 ? badge(lvT ? `Niv. ${lv} · ${lvT}` : `Niveau ${lv}`) : null, badge(veh, '', p.mode === 'vehicle' ? 'car' : 'user'), isFinite(distTo(p)) ? badge(fmtDist(distTo(p)), '', 'pin') : null)),
          h('div', { class: 'mz-card-side' }, p.money != null ? h('div', { class: 'mz-price', text: zc(p.money) }) : null,
            h('div', { class: 'mz-row' },
              isFinite(p.x) ? h('button', { class: 'mz-btn mz-btn--ghost mz-btn--sm', type: 'button', onclick: () => { gpsTo(p, p.name || 'Joueur'); api.close(); } }, icon('pin', 14), 'Rejoindre') : null,
              h('button', { class: 'mz-btn mz-btn--sm', type: 'button', onclick: () => { st.sendTo = p.id; render(true); } }, icon('send', 14), 'Envoyer'))),
          st.sendTo === p.id ? sendForm(p) : null);
      })),
    ];
  }

  // ----- Classement -----
  /** Fortune réelle = liquidités + voitures + biens de la salle (calcul local, pour la ligne du joueur sans classement serveur). */
  function myWorth() {
    const props = api.maps.propertyList().filter((p) => isMine(p.id)).reduce((s, p) => s + (p.price || 0), 0);
    const cars = [...new Set(myCars())].reduce((s, id) => s + (VEHICLE_BY_ID[id]?.price || 0), 0);
    return money() + props + cars;
  }
  function tabClassement() {
    const lb = Array.isArray(store.leaderboard) && store.leaderboard.length ? store.leaderboard : null;
    let rows = lb ? lb.map((r) => ({ name: r.name, money: Number(r.money) || 0, worth: Number(r.worth ?? r.money) || 0, online: !!r.online, st: Number(r.st) || 0, lvl: Number(r.lvl) || 0, rec: Number(r.rec) || 0, me: r.id != null ? r.id === me().id : r.name === me().name })) : null;
    if (!rows) rows = [{ name: me().name || 'Vous', money: money(), worth: myWorth(), online: true, st: starsFor(myDone()), lvl: myLevel(), rec: 0, me: true }, ...players().filter((p) => p.money != null).map((p) => ({ name: p.name, money: p.money, worth: p.money, online: true, st: Number(p.st) || 0, lvl: Number(p.lvl) || 0, rec: 0 }))];
    const canRec = has('fun1');
    if (!canRec) st.lbView = 'worth';
    const recView = st.lbView === 'records';
    const key = recView ? 'rec' : 'worth';
    if (recView) rows = rows.filter((r) => r.rec > 0);
    rows.sort((a, b) => b[key] - a[key] || b.worth - a.worth);
    const top = rows[0]?.[key] || 1;
    return [
      canRec ? chips([['worth', 'Fortune réelle'], ['records', 'Records détenus']], st.lbView, (k) => { st.lbView = k; render(true); }) : null,
      h('p', { class: 'mz-lead', text: recView ? 'Les records de salle détenus, toutes missions et catégories confondues. Ils ne rapportent rien : ils se voient.' : 'La vraie fortune de chacun : liquidités, voitures et biens de la salle. Investir ne fait plus reculer.' }),
      rows.length ? h('ol', { class: 'mz-rank' }, rows.slice(0, 50).map((r, i) => h('li', { class: 'mz-rankrow' + (r.me ? ' is-me' : '') + (i < 3 ? ' is-top' : '') },
        h('span', { class: 'mz-rank-n', text: String(i + 1).padStart(2, '0') }),
        h('span', { class: 'mz-rank-name' }, h('i', { class: 'mz-online' + (r.online ? ' is-on' : ''), title: r.online ? 'En ligne' : 'Hors ligne' }), h('span', { class: 'mz-rank-nm', text: r.name || 'Joueur' }), stars(r.st), r.me ? badge('Vous', 'mz-badge--gold') : null),
        h('span', { class: 'mz-rank-bar' }, h('i', { style: `width:${Math.max(2, Math.round((r[key] / top) * 100))}%` })),
        h('strong', { class: 'mz-rank-v' }, recView ? `${r.rec} record${r.rec > 1 ? 's' : ''}` : zc(r.worth), !recView && r.worth !== r.money ? h('small', { text: `dont ${zc(r.money)} en poche` }) : null))))
        : empty('trophy', 'Aucun record pour l’instant', 'Le premier chrono officiel d’une mission prend la place : à vous de jouer.'),
    ];
  }

  // ----- Profil -----
  function fmtStat(k, v) {
    if (typeof v !== 'number') return String(v);
    switch (STATS[k]?.[1]) {
      case 'zc': return zc(v);
      case 'dur': return hm(v);
      case 'dist': return fmtDist(v);
      case 'speed': return `${Math.round(v * 3.6)} km/h`;
      case 'chain': return `${fmtInt(v)} d’affilée`;
      case 'pts': return `${fmtInt(v)} pts`;
      case 'sec': return `${dec1(v)} s`;
      case 'clock': return fmtTime(v);
      case 'int': return fmtInt(v);
      default: break;
    }
    // anciennes clés : format deviné d'après le nom
    if (/distance|^km$/i.test(k)) return k === 'km' ? `${fmtInt(v)} km` : fmtDist(v);
    if (/time|sec/i.test(k)) return hm(v);
    if (/earned|spent|money|rent/i.test(k)) return zc(v);
    if (/speed/i.test(k)) return `${Math.round(v * (v < 120 ? 3.6 : 1))} km/h`;
    return fmtInt(v);
  }
  function tabProfil() {
    const props = api.maps.propertyList().filter((p) => isMine(p.id));
    const cars = [...new Set(myCars())].map((id) => VEHICLE_BY_ID[id]).filter(Boolean);
    const vProps = props.reduce((s, p) => s + (p.price || 0), 0), vCars = cars.reduce((s, v) => s + (v.price || 0), 0);
    const total = money() + vProps + vCars;
    const gs = (() => { try { return ctx.gameplay?.stats || {}; } catch { return {}; } })();
    const merged = { ...(me().stats || {}), ...gs };
    const play = playSeconds();
    if (play != null) merged.playSeconds = play;
    if (merged.collectiblesTotal != null) merged.collectibles = `${merged.collectibles || 0} / ${merged.collectiblesTotal}`;
    if (merged.landmarksSeen != null) merged.landmarksSeen = `${merged.landmarksSeen} / ${merged.landmarksTotal ?? ((ctx.LANDMARKS || []).filter((l) => !l.hidden).length || 12)}`;
    // libellé de la collection propre à la ville (macarons à Paris, violettes à Toulouse)
    const labelOf = (k) => (k === 'collectibles' ? collectionLabel(gs.collectibleName) : STATS[k]?.[0] || label(STAT_LABEL, k));
    const keys = [...Object.keys(STATS).filter((k) => k in merged), ...Object.keys(merged).filter((k) => !(k in STATS))];
    const seen = new Set();
    const stats = keys.filter((k) => {
      const v = merged[k];
      if (STAT_SKIP[k] || v == null || typeof v === 'object') return false;
      if (STATS[k] && !STATS[k][2] && !(Number(v) > 0)) return false; // statistique de la boucle fun encore vierge
      const l = labelOf(k);
      if (seen.has(l)) return false; // deux clés historiques pour la même mesure
      seen.add(l);
      return true;
    }).map((k) => [labelOf(k), fmtStat(k, merged[k])]);
    const seg = (v, cls) => (v > 0 ? h('i', { class: cls, style: `flex:${v}` }) : null);
    const nStars = starsFor(myDone());
    return [
      h('div', { class: 'mz-profile' },
        h('div', { class: 'mz-avatar mz-avatar--lg', text: (me().name || '?').slice(0, 1).toUpperCase() }),
        h('div', null, h('span', { class: 'mz-eyebrow', text: `${cityName} · salle ${store.room || '—'} · niveau ${myLevel()}${levelTitle()}` }), h('h3', { class: 'mz-profile-name' }, me().name || 'Joueur', stars(nStars))),
        h('div', { class: 'mz-profile-fortune' }, h('span', { class: 'mz-eyebrow', text: 'Fortune totale' }), h('strong', { text: zc(total) }))),
      h('div', { class: 'mz-split' }, seg(money(), 'a'), seg(vProps, 'b'), seg(vCars, 'c')),
      h('div', { class: 'mz-kpis' },
        h('div', { class: 'mz-kpi' }, h('span', null, h('i', { class: 'mz-dot a' }), 'Liquidités'), h('strong', { text: zc(money()) }), h('small', { text: `capital de départ ${zc(STARTING_MONEY)}` })),
        h('div', { class: 'mz-kpi' }, h('span', null, h('i', { class: 'mz-dot b' }), 'Immobilier'), h('strong', { text: zc(vProps) }), h('small', { text: `${props.length} bien${props.length > 1 ? 's' : ''} · ${zc(props.reduce((s, p) => s + (p.income || 0), 0))}/h` })),
        h('div', { class: 'mz-kpi' }, h('span', null, h('i', { class: 'mz-dot c' }), 'Véhicules'), h('strong', { text: zc(vCars) }), h('small', { text: `${cars.length} voiture${cars.length > 1 ? 's' : ''}` }))),
      h('h4', { class: 'mz-h4', text: 'Statistiques' }),
      stats.length ? h('dl', { class: 'mz-stats' }, stats.map(([l, v]) => h('div', null, h('dt', { text: l }), h('dd', { text: v }))))
        : h('p', { class: 'mz-dim', text: 'Vos statistiques apparaîtront ici après vos premières missions.' }),
    ];
  }

  // ----- Réglages -----
  function tabReglages() {
    const q = ctx.quality || 'high';
    const vol = Number(lsGet('mz.volume', '0.7'));
    const volV = h('span', { class: 'mz-perf-v', text: `${Math.round(vol * 100)} %` });
    const slider = h('input', { class: 'mz-range', type: 'range', min: '0', max: '100', value: String(Math.round(vol * 100)), 'aria-label': 'Volume' });
    slider.addEventListener('input', () => { const v = Number(slider.value) / 100; volV.textContent = `${slider.value}\u00a0%`; lsSet('mz.volume', String(v)); bus.emit('audio:volume', { value: v }); });
    const others = api.otherCities?.() || [];
    const setQ = (k) => { if (k === q) return; const u = new URL(location.href); u.searchParams.set('quality', k); if (store.room) u.searchParams.set('room', store.room); location.href = u.toString(); };
    // préférences du HUD (ctx.ui.prefs : quiet, fx, hideObjective) — enregistrées et diffusées par api.setPref (ui:prefs)
    const P = api.prefs || {};
    const pref = (key, items) => h('div', { class: 'mz-seg', dataset: { pref: key } }, items.map(([k, t]) => h('button', { class: k === P[key] ? 'is-on' : '', type: 'button', text: t, onclick: () => { api.setPref?.(key, k); render(true); } })));
    // le mode tranquille ne porte que sur les klaxons, les bulles ('fun1') et les invitations au Chiche ('dare')
    const social = has('fun1') || has('dare');
    return [
      h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Qualité graphique' }), h('p', { class: 'mz-dim', text: 'Le jeu se recharge pour appliquer le changement.' })),
        h('div', { class: 'mz-seg' }, [['low', 'Légère'], ['medium', 'Équilibrée'], ['high', 'Haute']].map(([k, t]) => h('button', { class: k === q ? 'is-on' : '', type: 'button', text: t, onclick: () => setQ(k) })))),
      h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Volume' }), h('p', { class: 'mz-dim', text: 'Moteurs, ville et ambiance.' })), h('div', { class: 'mz-row' }, slider, volV)),
      api.setPref ? [
        h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Effets' }), h('p', { class: 'mz-dim', text: 'Traits de vitesse, liseré de combo, secousses de caméra et vibrations.' })), pref('fx', [['full', 'Complets'], ['soft', 'Discrets'], ['off', 'Coupés']])),
        h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Prochain objectif' }), h('p', { class: 'mz-dim', text: 'L’encart en haut à gauche et la jauge de niveau sous le portefeuille.' })), pref('hideObjective', [[false, 'Affichés'], [true, 'Masqués']])),
        social ? h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Mode tranquille' }), h('p', { class: 'mz-dim', text: has('dare') ? 'Coupe les klaxons et les bulles des autres joueurs et masque les invitations « Chiche ! ».' : 'Coupe les klaxons et les bulles des autres joueurs.' })), pref('quiet', [[false, 'Non'], [true, 'Oui']])) : null,
      ] : null,
      h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Coincé ?' }), h('p', { class: 'mz-dim', text: 'Vous replace sur la chaussée la plus proche ou à votre domicile.' })),
        h('button', { class: 'mz-btn', type: 'button', onclick: () => { bus.emit('intent:respawn', {}); api.close(); } }, icon('locate', 14), 'Me débloquer')),
      h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Inviter des amis' }), h('p', { class: 'mz-dim', text: `${cityName}, salle « ${roomName()} » — le lien ouvre directement cette ville et cette salle.` })), inviteBtn()),
      others.length ? h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Changer de ville' }), h('p', { class: 'mz-dim', text: `Vous êtes à ${cityName}. Changer de ville recharge le jeu : votre argent et vos voitures vous suivent, les biens restent dans leur ville.` })),
        h('div', { class: 'mz-row' }, others.map((c) => confirmButton(`Aller à ${c.name}`, `Quitter ${cityName} ?`, () => api.switchCity?.(c.id), 'mz-btn')))) : null,
      // capacités inconnues (pas encore de S.WELCOME) : toutes les lignes ; sinon seules celles que le serveur sait servir
      h('h4', { class: 'mz-h4', text: 'Commandes' }), controlsGrid(Array.isArray(store.feat) ? has : null, !!api.touch),
      h('p', { class: 'mz-credits' }, h('b', { text: `Données cartographiques de ${cityName}` }), ` ${api.maps.sources || ''}`,
        (api.maps.sourceDetails || []).map((t) => h('small', { text: t }))),
    ];
  }

  const RENDER = { carnet: () => carnet.tab(), missions: tabMissions, immo: tabImmo, garage: tabGarage, joueurs: tabJoueurs, classement: tabClassement, profil: tabProfil, reglages: tabReglages };
  function signature() {
    const m = me(), s = m.stats || {};
    const base = `${st.tab}|${m.money}|${(m.properties || []).join()}|${myCars().join()}|${carId(m.activeCar)}|${curMissionId()}|${(store.feat || []).join()}`;
    switch (st.tab) {
      case 'carnet': return base + carnet.signature();
      case 'missions': { const a = activity(); return `${base}|${a ? `${a.kind}:${a.id}:${a.canAbort}` : ''}|${rev.records}|${Object.keys(store.records?.room || {}).length}:${Object.keys(store.records?.mine || {}).length}|${starId()}|${myLevel()}`; }
      case 'immo': return base + JSON.stringify(store.propertyOwners || {});
      case 'garage': return `${base}|${JSON.stringify(m.carColors || 0)}|${m.look?.h}|${st.paintFor}|${st.paintColor}|${myLevel()}|${store.journal?.streak?.best}|${s.fares}|${s.escapes}|${s.daresWon}|${s.bestCombo}|${myDone()}`;
      case 'joueurs': { const d = store.dare; return base + players().map((p) => `${p.id}:${p.name}:${p.money}:${p.mode}:${p.lvl}:${p.st}`).join() + `|${rev.dare}|${d ? `${d.id}:${d.phase}:${d.players?.length}:${d.mine}` : ''}|${st.stake}|${rev.look}`; }
      case 'classement': return base + players().map((p) => `${p.id}:${p.money}`).join() + (store.leaderboard || []).map((r) => `${r.name}:${r.money}:${r.worth}:${r.online}:${r.st}:${r.rec}`).join() + st.lbView;
      case 'profil': { const t = playSeconds(); return `${base}${JSON.stringify(s)}|${t == null ? '' : Math.floor(t / 60)}`; }
      default: return base;
    }
  }
  /** Le joueur est-il en train de saisir ou de confirmer quelque chose dans le panneau ? (seul cas où l'on diffère le rafraîchissement) */
  function busy() {
    const a = document.activeElement;
    if (!(a instanceof HTMLElement) || !body.contains(a)) return false;
    return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.classList.contains('is-armed');
  }
  function render(force) {
    if (phone.hidden) return;
    header();
    if (!tabOk(st.tab)) st.tab = 'missions';
    const sig = signature();
    // un bouton qui garde le focus après un achat ne bloque plus la mise à jour : seules une saisie ou une confirmation armée la diffèrent
    if (!force && (sig === st.sig || busy())) return;
    st.sig = sig;
    const keep = body.scrollTop;
    titleEl.textContent = TABS.find((t) => t[0] === st.tab)?.[1] || '';
    for (const [id, , , need] of TABS) {
      const b = navBtns[id], ok = !need || has(need);
      if (b.hidden === ok) b.hidden = !ok;
      b.classList.toggle('is-on', id === st.tab);
    }
    navBtns.carnet.classList.toggle('has-dot', carnet.hasReward());
    navBtns.garage.classList.toggle('has-dot', firstCarReady());
    let kids;
    try { kids = RENDER[st.tab](); } catch (e) { console.warn('[ui] onglet', st.tab, e); kids = [empty('help', 'Indisponible', 'Cet onglet n’a pas pu être affiché.')]; }
    fill(body, kids);
    body.scrollTop = keep;
  }

  // =====================================================================
  // Concession
  // =====================================================================
  const dl = { brand: null, sel: null, color: null };
  const dealerBody = h('div', { class: 'mz-dealer-body' });
  const dealer = h('div', { class: 'mz-modal mz-dealer', hidden: true, onpointerdown: (e) => { if (e.target === dealer) api.close(); } }, h('div', { class: 'mz-sheet mz-dealer-sheet' }, dealerBody));
  function renderDealer() {
    if (dealer.hidden) return;
    const brands = [...new Set(VEHICLES.filter((v) => v.price > 0).map((v) => v.brand))];
    let list = VEHICLES.filter((v) => dl.brand && v.brand.toLowerCase() === dl.brand.toLowerCase());
    const single = list.length > 0;
    if (!single) { dl.brandTab = dl.brandTab && brands.includes(dl.brandTab) ? dl.brandTab : brands[0]; list = VEHICLES.filter((v) => v.brand === dl.brandTab); }
    list.sort((a, b) => a.price - b.price);
    if (!list.some((v) => v.id === dl.sel)) { dl.sel = list[0]?.id; dl.color = null; }
    const v = VEHICLE_BY_ID[dl.sel]; if (!v) return;
    const color = dl.color && v.colors?.includes(dl.color) ? dl.color : v.colors?.[0];
    const owned = myCars().includes(v.id), miss = v.price - money();
    const used = single && list[0].brand === USED_BRAND;
    const buy = confirmButton(`Acheter · ${zc(v.price)}`, `Confirmer ${zc(v.price)}`, () => bus.emit('intent:buyCar', { typeId: v.id, color }), 'mz-btn mz-btn--gold mz-btn--lg');
    buy.dataset.act = 'buy';
    if (miss > 0) buy.disabled = true;
    fill(dealerBody,
      h('header', { class: 'mz-dealer-head' },
        h('div', null, h('span', { class: 'mz-eyebrow', text: used ? 'Garage' : 'Concession' }), h('h2', { class: 'mz-display', text: used ? 'Le coin des occasions' : single ? list[0].brand : 'Showroom' })),
        single ? null : chips(brands.map((b) => [b, b]), dl.brandTab, (b) => { dl.brandTab = b; dl.sel = null; renderDealer(); }),
        h('div', { class: 'mz-phone-status' }, h('strong', { class: 'mz-phone-wallet', text: zc(money()) })),
        h('button', { class: 'mz-iconbtn', type: 'button', title: CLOSE_TITLE, 'aria-label': 'Fermer', onclick: () => api.close() }, icon('close'))),
      h('div', { class: 'mz-dealer-cols' },
        h('div', { class: 'mz-dealer-list' }, list.map((c) => h('button', { class: 'mz-model' + (c.id === v.id ? ' is-on' : ''), type: 'button', onclick: () => { dl.sel = c.id; dl.color = null; renderDealer(); } },
          carSilhouette(c), h('span', { class: 'mz-model-txt' }, h('b', { text: c.name.replace(new RegExp('^' + c.brand + '\\s+', 'i'), '') }), h('small', { class: myCars().includes(c.id) ? 'is-owned' : '', text: myCars().includes(c.id) ? 'Au garage' : zc(c.price) })),
          myCars().includes(c.id) ? icon('check', 16) : null))),
        h('div', { class: 'mz-dealer-detail' },
          h('div', { class: 'mz-stage' }, carSilhouette(v, owned ? colorOf(v) : color)),
          h('div', { class: 'mz-dealer-info' },
            h('div', { class: 'mz-card-top' }, h('h3', { class: 'mz-display mz-display--sm', text: v.name }), v.electric ? badge('Électrique', '', 'bolt') : badge('Thermique'), used ? badge('Occasion', 'mz-badge--gold') : null),
            owned ? null : h('div', { class: 'mz-swatches' }, h('span', { class: 'mz-eyebrow', text: 'Teinte' }), (v.colors || []).map((c) => h('button', { class: 'mz-swatch' + (c === color ? ' is-on' : ''), type: 'button', style: `--c:${c}`, title: c, 'aria-label': `Teinte ${c}`, onclick: () => { dl.color = c; renderDealer(); } }))),
            perfBars(v),
            h('div', { class: 'mz-dealer-buy' },
              owned ? h('div', { class: 'mz-owned' }, icon('check', 16), 'Déjà dans votre garage')
                : miss > 0 ? h('div', { class: 'mz-err', text: `Il vous manque ${zc(miss)}` }) : h('div', { class: 'mz-dim', text: `Solde après achat : ${zc(-miss)}` }),
              owned ? h('button', { class: 'mz-btn mz-btn--lg', type: 'button', onclick: () => takeOut(v.id) }, icon('key', 16), 'Sortir du garage') : buy)))));
  }

  // =====================================================================
  // Fiche de bien
  // =====================================================================
  let propId = null;
  const propBody = h('div', { class: 'mz-prop-body' });
  const prop = h('div', { class: 'mz-modal mz-prop', hidden: true, onpointerdown: (e) => { if (e.target === prop) api.close(); } }, h('div', { class: 'mz-sheet mz-prop-sheet' }, propBody));
  function renderProp() {
    if (prop.hidden) return;
    const p = api.maps.propertyList().find((x) => x.id === propId) || PROPS.PROPERTY_BY_ID?.[propId];
    if (!p) { fill(propBody, empty('home', 'Bien introuvable', 'Ce bien n’existe plus.'), h('button', { class: 'mz-btn', type: 'button', text: 'Fermer', onclick: () => api.close() })); return; }
    const mine = isMine(p.id), o = owner(p.id), miss = p.price - money();
    const hours = p.income > 0 ? p.price / p.income : 0;
    const night = has('fun1') && p.income > 0 ? ` · environ +${zc(nightRent(p.income))} par nuit d’absence` : '';
    fill(propBody,
      h('header', { class: 'mz-prop-head' },
        h('div', null, h('span', { class: 'mz-eyebrow', text: label(KIND_LABEL, p.kind) }), h('h2', { class: 'mz-display mz-display--sm', text: p.name })),
        h('button', { class: 'mz-iconbtn', type: 'button', title: CLOSE_TITLE, 'aria-label': 'Fermer', onclick: () => api.close() }, icon('close'))),
      h('div', { class: 'mz-tags' }, ownerBadge(p), p.address ? badge(p.address) : null, p.garageSlots ? badge(`Garage ${p.garageSlots} place${p.garageSlots > 1 ? 's' : ''}`, '', 'car') : null, isFinite(distTo(p)) ? badge(fmtDist(distTo(p)), '', 'pin') : null),
      h('div', { class: 'mz-kpis' },
        h('div', { class: 'mz-kpi' }, h('span', { text: 'Prix' }), h('strong', { text: zc(p.price) }), h('small', { text: `revente ${zc(p.price * SELL_RATIO)}` })),
        h('div', { class: 'mz-kpi' }, h('span', { text: 'Loyer' }), h('strong', { text: zc(p.income) }), h('small', { text: 'par heure connectée' + night })),
        h('div', { class: 'mz-kpi' }, h('span', { text: 'Amorti en' }), h('strong', { text: hours ? `${fmtInt(hours)} h` : '—' }), h('small', { text: 'de jeu connecté' }))),
      h('p', { class: 'mz-dim', text: p.description || (mine ? 'Ce bien vous appartient : il sert de point de réapparition et vous verse son loyer tant que vous êtes connecté.' : 'Un bien vous verse son loyer tant que vous êtes connecté et devient votre point de réapparition.') }),
      !mine && !o && miss > 0 ? h('div', { class: 'mz-err', text: `Il vous manque ${zc(miss)}` }) : null,
      h('div', { class: 'mz-row mz-row--end' }, propertyActions(p, false)));
  }

  // ---------- API ----------
  const hideAll = () => { phone.hidden = dealer.hidden = prop.hidden = true; carnet.hide(); };
  return {
    els: [phone, dealer, prop, carnet.sheet],
    show(panel, data) {
      hideAll();
      if (panel === 'return') carnet.show(data);
      else if (panel === 'dealer') { dl.brand = data?.brand || data?.dealer?.brand || null; dl.sel = data?.typeId || null; dl.color = null; dealer.hidden = false; renderDealer(); }
      else if (panel === 'property') { propId = data?.id || data?.propertyId || data?.property?.id || null; prop.hidden = false; renderProp(); }
      else {
        const t = TAB_ALIAS[data?.tab] || TAB_ALIAS[panel], prev = st.tab;
        if (t) st.tab = t;
        if (data?.view === 'records' || data?.view === 'worth') st.lbView = data.view;
        st.sendTo = null; phone.hidden = false; render(true);
        if (st.tab !== prev) body.scrollTop = 0; // un autre onglet s'ouvre en haut de page
      }
    },
    hide: hideAll,
    /** Rafraîchissement lent (2 Hz) : ne reconstruit que si les données affichées ont changé. */
    refresh() {
      if (!phone.hidden) render(false);
      carnet.refresh();
      const sig = `${money()}|${myCars().join()}|${JSON.stringify(store.propertyOwners || {})}|${(me().properties || []).join()}|${JSON.stringify(me().carColors || 0)}`;
      if (sig !== st.ctxSig) { st.ctxSig = sig; renderDealer(); renderProp(); }
    },
    /** 1 Hz, panneau ouvert ou non : annonce les klaxons et teintes exclusives qui viennent de se débloquer. */
    slow: watchUnlocks,
    /** Fiche du matin : instant d'ouverture (ms) et action « Y aller » (touche E). */
    returnOpenedAt: () => carnet.openedAt(),
    returnGo: () => carnet.go(),
    inviteUrl,
  };
}

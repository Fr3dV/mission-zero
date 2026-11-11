// Téléphone à onglets + panneaux contextuels (concession, fiche de bien) — module interface.
import { h, fill, icon, zc, fmtInt, fmtDist, fmtClock, fmtHour, copyText, lsGet, lsSet, confirmButton, carSilhouette, clamp } from './util.js';
import { VEHICLES, VEHICLE_BY_ID, STARTING_MONEY } from '@shared/catalog.js';
import * as PROPS from '@shared/properties.js';
import * as MIS from '@shared/missions.js';

const SELL_RATIO = PROPS.SELL_BACK_RATIO ?? 0.7;
const TYPE_LABEL = { delivery: 'Livraison', taxi: 'Taxi', race: 'Course', chase: 'Poursuite', vip: 'Chauffeur VIP', heist: 'Coup', tour: 'Visite', timetrial: 'Contre-la-montre', collect: 'Collecte', courier: 'Coursier', escort: 'Escorte', stunt: 'Cascade', photo: 'Photo', valet: 'Voiturier' };
const KIND_LABEL = { studio: 'Studio', appartement: 'Appartement', penthouse: 'Penthouse', loft: 'Loft', hotel: 'Hôtel particulier', commerce: 'Commerce', boutique: 'Boutique', garage: 'Garage', bureau: 'Bureaux', cafe: 'Café', restaurant: 'Restaurant', maison: 'Maison', villa: 'Villa', immeuble: 'Immeuble', peniche: 'Péniche', club: 'Club', galerie: 'Galerie' };
const STAT_LABEL = { missions: 'Missions réussies', missionsDone: 'Missions réussies', missionsCompleted: 'Missions réussies', missionsFailed: 'Missions échouées', earned: 'Total gagné', totalEarned: 'Total gagné', spent: 'Total dépensé', totalSpent: 'Total dépensé', distance: 'Distance parcourue', distanceM: 'Distance parcourue', km: 'Distance parcourue', playTime: 'Temps de jeu', playTimeSec: 'Temps de jeu', playSeconds: 'Temps de jeu', collectibles: 'Macarons dorés', landmarksSeen: 'Monuments découverts', timePlayed: 'Temps de jeu', crashes: 'Accrochages', topSpeed: 'Vitesse record', rentEarned: 'Loyers encaissés', level: 'Niveau', xp: 'Expérience', transfersSent: 'Virements envoyés', transfersReceived: 'Virements reçus' };
const cap = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const label = (map, k) => (map === TYPE_LABEL && MIS.MISSION_TYPES?.[k]?.label) || (map === KIND_LABEL && (PROPS.PROPERTY_KINDS || PROPS.KINDS)?.[k]?.label) || map[k] || cap(k);

export const CONTROLS = [
  ['ZQSD', 'Se déplacer · conduire'], ['Souris', 'Orienter la caméra'], ['Maj', 'Courir'], ['Espace', 'Sauter · frein à main'],
  ['F', 'Monter · descendre'], ['E', 'Interagir'], ['C', 'Changer de caméra'], ['M', 'Carte'], ['T', 'Chat'], ['Tab', 'Téléphone'],
];
export function controlsGrid() {
  return h('div', { class: 'mz-keys' }, CONTROLS.map(([k, t]) => h('div', { class: 'mz-keyrow' }, h('kbd', { text: k }), h('span', { text: t }))));
}

const TABS = [
  ['missions', 'Missions', 'mission'], ['immo', 'Immobilier', 'home'], ['garage', 'Garage', 'car'], ['joueurs', 'Joueurs', 'users'],
  ['classement', 'Classement', 'trophy'], ['profil', 'Profil', 'user'], ['reglages', 'Réglages', 'settings'],
];
const TAB_ALIAS = { missions: 'missions', property: 'immo', properties: 'immo', immobilier: 'immo', immo: 'immo', garage: 'garage', players: 'joueurs', joueurs: 'joueurs', leaderboard: 'classement', classement: 'classement', profile: 'profil', profil: 'profil', settings: 'reglages', reglages: 'reglages' };

export function createPanels(ctx, api) {
  const { bus, store } = ctx;
  const me = () => store.me || {};
  const money = () => Number(me().money) || 0;
  const carId = (c) => (typeof c === 'string' ? c : c?.typeId || c?.id);
  const myCars = () => (me().cars || []).map(carId).filter(Boolean);
  const myLevel = () => Number(ctx.gameplay?.level ?? me().level ?? me().stats?.level ?? 1) || 1;
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
  const gpsTo = (o, lbl) => { api.maps.setGps(o.x, o.z, lbl); bus.emit('toast', { text: `Itinéraire vers ${lbl}`, kind: 'info' }); };
  const players = () => { const out = []; const P = store.players; if (P && typeof P.forEach === 'function') P.forEach((p, id) => { if (p && (p.id ?? id) !== me().id) out.push({ ...p, id: p.id ?? id }); }); return out; };

  const empty = (ico, title, text, extra) => h('div', { class: 'mz-empty' }, icon(ico, 30), h('strong', { text: title }), h('p', { text }), extra);
  const badge = (text, cls = '', ico) => h('span', { class: 'mz-badge ' + cls }, ico ? icon(ico, 12) : null, text);
  const chips = (items, cur, on) => h('div', { class: 'mz-chips' }, items.map(([k, t]) => h('button', { class: 'mz-chip' + (k === cur ? ' is-on' : ''), type: 'button', text: t, onclick: () => on(k) })));
  function perfBars(v, compact) {
    const rows = [['Vitesse max', v.maxSpeed / MAXV.maxSpeed, `${Math.round(v.maxSpeed * 3.6)} km/h`], ['Accélération', v.accel / MAXV.accel, null], ['Freinage', v.brake / MAXV.brake, null], ['Tenue de route', v.grip / MAXV.grip, null]];
    return h('div', { class: 'mz-perfs' + (compact ? ' mz-perfs--sm' : '') }, rows.map(([t, f, val]) => h('div', { class: 'mz-perf' },
      h('span', { class: 'mz-perf-l', text: t }), h('span', { class: 'mz-perf-b' }, h('i', { style: `width:${Math.round(clamp(f, 0.04, 1) * 100)}%` })),
      compact ? null : h('span', { class: 'mz-perf-v', text: val || `${Math.round(f * 100)}` }))));
  }

  // =====================================================================
  // Téléphone
  // =====================================================================
  const st = { tab: lsGet('mz.tab', 'missions'), mFilter: 'all', pFilter: 'all', sendTo: null, sig: '', more: {} };
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
        h('button', { class: 'mz-navbtn mz-navbtn--map', type: 'button', onclick: () => api.open('map') }, icon('map'), h('span', { text: 'Carte' }), h('kbd', { text: 'M' }))),
      h('section', { class: 'mz-phone-main' },
        h('header', { class: 'mz-phone-head' }, titleEl, h('div', { class: 'mz-phone-status' }, net, clock, wallet),
          h('button', { class: 'mz-iconbtn', type: 'button', title: 'Fermer (Échap)', onclick: () => api.close() }, icon('close'))),
        body)));
  TABS.forEach(([id, t, ic]) => nav.appendChild(h('button', { class: 'mz-navbtn', type: 'button', dataset: { tab: id }, onclick: () => setTab(id) }, icon(ic), h('span', { text: t }))));

  function setTab(id) { st.tab = id; st.sendTo = null; lsSet('mz.tab', id); render(true); body.scrollTop = 0; }
  function header() {
    clock.textContent = fmtHour(store.timeOfDay);
    wallet.textContent = zc(money());
    const s = api.netState();
    net.className = 'mz-phone-net is-' + s;
    net.textContent = `${cityName} · ` + (s === 'online' ? `salle ${store.room || '—'}` : s === 'offline' ? 'hors ligne' : 'connexion…');
  }

  // ----- Missions -----
  function tabMissions() {
    const list = api.maps.missionList().filter((m) => m && m.id);
    const types = [...new Set(list.map((m) => m.type).filter(Boolean))];
    if (st.mFilter !== 'all' && !types.includes(st.mFilter)) st.mFilter = 'all';
    const cur = curMissionId();
    const states = {};
    try { for (const s of ctx.gameplay?.getMissionStates?.() || []) if (s?.mission?.id) states[s.mission.id] = s; } catch { /* états indisponibles */ }
    const shown = list.filter((m) => st.mFilter === 'all' || m.type === st.mFilter).sort((a, b) => (a.level || 1) - (b.level || 1) || (a.reward || 0) - (b.reward || 0));
    const out = [];
    if (types.length > 1) out.push(chips([['all', `Toutes · ${list.length}`], ...types.map((t) => [t, label(TYPE_LABEL, t)])], st.mFilter, (k) => { st.mFilter = k; render(true); }));
    if (!shown.length) out.push(empty('mission', 'Aucune mission', `Pas encore de mission à ${cityName} : elles arrivent bientôt. En attendant, la ville est à vous.`));
    out.push(paged('missions:' + st.mFilter, shown, (m) => {
      const stt = states[m.id], cd = Number(stt?.cooldownLeft) || 0;
      const locked = stt ? !!stt.locked : (m.level || 1) > myLevel(), active = m.id === cur, s = stt?.start || m.start;
      const d = distTo(s);
      return h('article', { class: 'mz-card mz-mission' + (active ? ' is-active' : '') + (locked ? ' is-locked' : '') },
        h('div', { class: 'mz-card-main' },
          h('div', { class: 'mz-card-top' }, h('h3', { text: m.title || m.id }), active ? badge('En cours', 'mz-badge--gold') : null),
          m.description ? h('p', { class: 'mz-dim', text: m.description }) : null,
          h('div', { class: 'mz-tags' },
            m.type ? badge(label(TYPE_LABEL, m.type)) : null,
            m.giver ? badge(typeof m.giver === 'string' ? m.giver : m.giver.name || 'Contact', '', 'user') : null,
            m.level > 1 || locked ? badge(`Niveau ${m.level}`, locked ? 'mz-badge--rouge' : '', locked ? 'lock' : null) : null,
            m.timeLimitSec ? badge(fmtClock(m.timeLimitSec), '', 'clock') : null,
            stt?.done > 0 ? badge(`Réussie ×${stt.done}`, 'mz-badge--vert', 'check') : null,
            cd > 0 && !active ? badge(`Disponible dans ${fmtClock(cd)}`, 'mz-badge--mute', 'clock') : null,
            isFinite(d) ? badge(fmtDist(d), '', 'pin') : null)),
        h('div', { class: 'mz-card-side' },
          h('div', { class: 'mz-price', text: m.reward != null ? `+${zc(m.reward)}` : '' }),
          h('div', { class: 'mz-row' },
            s && isFinite(s.x) ? h('button', { class: 'mz-btn mz-btn--ghost mz-btn--sm', type: 'button', onclick: () => { gpsTo(s, m.title || 'Mission'); api.close(); } }, icon('pin', 14), 'GPS') : null,
            active
              ? h('button', { class: 'mz-btn mz-btn--sm', type: 'button', text: 'Abandonner', onclick: () => { ctx.gameplay?.abortMission?.(); api.close(); } })
              : h('button', { class: 'mz-btn mz-btn--gold mz-btn--sm', type: 'button', disabled: locked || cd > 0 || !ctx.gameplay?.startMission, onclick: () => { ctx.gameplay?.startMission?.(m.id); api.close(); } }, icon(locked ? 'lock' : 'play', 14), locked ? 'Verrouillée' : 'Démarrer'))));
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
    return isMine(p.id) ? badge('À vous', 'mz-badge--vert', 'check') : o ? badge(`Propriété de ${o.name || 'un joueur'}`, 'mz-badge--mute', 'lock') : badge('À vendre', 'mz-badge--gold');
  }
  function tabImmo() {
    const list = api.maps.propertyList().filter((p) => p && p.id);
    const mine = list.filter((p) => isMine(p.id));
    const rent = mine.reduce((s, p) => s + (p.income || 0), 0);
    const shown = list.filter((p) => (st.pFilter === 'mine' ? isMine(p.id) : st.pFilter === 'free' ? !owner(p.id) && !isMine(p.id) : true)).sort((a, b) => (a.price || 0) - (b.price || 0));
    return [
      h('div', { class: 'mz-kpis' },
        h('div', { class: 'mz-kpi' }, h('span', { text: 'Vos biens' }), h('strong', { text: `${mine.length}` }), h('small', { text: `sur ${list.length}` })),
        h('div', { class: 'mz-kpi' }, h('span', { text: 'Loyers' }), h('strong', { text: zc(rent) }), h('small', { text: 'par heure connectée' })),
        h('div', { class: 'mz-kpi' }, h('span', { text: 'Patrimoine' }), h('strong', { text: zc(mine.reduce((s, p) => s + (p.price || 0), 0)) }), h('small', { text: `revente à ${Math.round(SELL_RATIO * 100)} %` }))),
      chips([['all', 'Tous'], ['free', 'À vendre'], ['mine', 'Les miens']], st.pFilter, (k) => { st.pFilter = k; render(true); }),
      shown.length ? null : empty('home', 'Rien ici', !list.length ? `Aucun bien n’est encore en vente à ${cityName}.` : st.pFilter === 'mine' ? 'Vous ne possédez encore aucun bien. Un premier studio rapporte vite.' : 'Aucun bien ne correspond.'),
      paged('immo:' + st.pFilter, shown, (p) => h('article', { class: 'mz-card' + (isMine(p.id) ? ' is-active' : '') },
        h('div', { class: 'mz-card-main' },
          h('div', { class: 'mz-card-top' }, h('h3', { text: p.name }), ownerBadge(p)),
          h('div', { class: 'mz-tags' }, badge(label(KIND_LABEL, p.kind)), badge(`Loyer ${zc(p.income)}/h`, '', 'bolt'), p.garageSlots ? badge(`${p.garageSlots} place${p.garageSlots > 1 ? 's' : ''}`, '', 'car') : null, isFinite(distTo(p)) ? badge(fmtDist(distTo(p)), '', 'pin') : null)),
        h('div', { class: 'mz-card-side' }, h('div', { class: 'mz-price', text: zc(p.price) }), h('div', { class: 'mz-row' }, propertyActions(p, true))))),
    ];
  }

  // ----- Garage -----
  function takeOut(typeId) {
    bus.emit('intent:setActiveCar', { typeId });
    bus.emit('intent:spawnCar', { typeId });
    api.close();
  }
  function tabGarage() {
    const cars = [...new Set(myCars())].map((id) => VEHICLE_BY_ID[id]).filter(Boolean);
    if (!cars.length) return [empty('car', 'Garage vide', 'Passez dans une concession pour acheter votre première voiture.'), dealerRows()];
    const active = carId(me().activeCar);
    return [
      h('p', { class: 'mz-lead', text: 'Sortez une voiture : elle apparaît près de vous, prête à démarrer.' }),
      h('div', { class: 'mz-grid' }, cars.map((v) => h('article', { class: 'mz-card mz-carcard' + (v.id === active ? ' is-active' : '') },
        carSilhouette(v),
        h('div', { class: 'mz-card-top' }, h('div', null, h('span', { class: 'mz-eyebrow', text: v.brand }), h('h3', { text: v.name })), v.id === active ? badge('Active', 'mz-badge--gold') : v.electric ? badge('Électrique', '', 'bolt') : null),
        perfBars(v, true),
        h('div', { class: 'mz-row mz-row--end' },
          v.id === active ? null : h('button', { class: 'mz-btn mz-btn--ghost mz-btn--sm', type: 'button', text: 'Par défaut', onclick: () => bus.emit('intent:setActiveCar', { typeId: v.id }) }),
          h('button', { class: 'mz-btn mz-btn--gold mz-btn--sm', type: 'button', onclick: () => takeOut(v.id) }, icon('key', 14), 'Sortir'))))),
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
  function tabJoueurs() {
    const list = players().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (!list.length) return [empty('users', 'Personne d’autre pour l’instant', `Partagez le code de salle « ${roomName()} » pour jouer à ${cityName} avec vos amis.`, inviteBtn())];
    return [
      h('div', { class: 'mz-row mz-row--between' }, h('p', { class: 'mz-lead', text: `${list.length + 1} joueurs à ${cityName}, salle « ${roomName()} »` }), inviteBtn()),
      h('div', { class: 'mz-list' }, list.map((p) => {
        const veh = p.mode === 'vehicle' ? VEHICLE_BY_ID[p.vehicleType]?.name || 'En voiture' : 'À pied';
        return h('article', { class: 'mz-card mz-player' },
          h('div', { class: 'mz-avatar', text: (p.name || '?').slice(0, 1).toUpperCase() }),
          h('div', { class: 'mz-card-main' }, h('h3', { text: p.name || 'Joueur' }),
            h('div', { class: 'mz-tags' }, badge(veh, '', p.mode === 'vehicle' ? 'car' : 'user'), isFinite(distTo(p)) ? badge(fmtDist(distTo(p)), '', 'pin') : null)),
          h('div', { class: 'mz-card-side' }, p.money != null ? h('div', { class: 'mz-price', text: zc(p.money) }) : null,
            h('div', { class: 'mz-row' },
              isFinite(p.x) ? h('button', { class: 'mz-btn mz-btn--ghost mz-btn--sm', type: 'button', onclick: () => { gpsTo(p, p.name || 'Joueur'); api.close(); } }, icon('pin', 14), 'Rejoindre') : null,
              h('button', { class: 'mz-btn mz-btn--sm', type: 'button', onclick: () => { st.sendTo = p.id; render(true); } }, icon('send', 14), 'Envoyer'))),
          st.sendTo === p.id ? sendForm(p) : null);
      })),
    ];
  }

  // ----- Classement -----
  function tabClassement() {
    let rows = Array.isArray(store.leaderboard) && store.leaderboard.length ? store.leaderboard.map((r) => ({ name: r.name, money: r.money, me: r.id != null ? r.id === me().id : r.name === me().name })) : null;
    if (!rows) rows = [{ name: me().name || 'Vous', money: money(), me: true }, ...players().filter((p) => p.money != null).map((p) => ({ name: p.name, money: p.money }))];
    rows.sort((a, b) => (b.money || 0) - (a.money || 0));
    const top = rows[0]?.money || 1;
    return [
      h('p', { class: 'mz-lead', text: 'Les plus grandes fortunes de la salle.' }),
      h('ol', { class: 'mz-rank' }, rows.slice(0, 50).map((r, i) => h('li', { class: 'mz-rankrow' + (r.me ? ' is-me' : '') + (i < 3 ? ' is-top' : '') },
        h('span', { class: 'mz-rank-n', text: String(i + 1).padStart(2, '0') }),
        h('span', { class: 'mz-rank-name' }, r.name || 'Joueur', r.me ? badge('Vous', 'mz-badge--gold') : null),
        h('span', { class: 'mz-rank-bar' }, h('i', { style: `width:${Math.max(2, Math.round(((r.money || 0) / top) * 100))}%` })),
        h('strong', { class: 'mz-rank-v', text: zc(r.money) })))),
    ];
  }

  // ----- Profil -----
  function fmtStat(k, v) {
    if (typeof v !== 'number') return String(v);
    if (/distance|^km$/i.test(k)) return k === 'km' ? `${fmtInt(v)} km` : fmtDist(v);
    if (/time|sec/i.test(k)) { const H = Math.floor(v / 3600), M = Math.floor((v % 3600) / 60); return H ? `${H} h ${String(M).padStart(2, '0')}` : `${M} min`; }
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
    if (merged.collectiblesTotal != null) { merged.collectibles = `${merged.collectibles || 0} / ${merged.collectiblesTotal}`; delete merged.collectiblesTotal; }
    if (merged.landmarksSeen != null) merged.landmarksSeen = `${merged.landmarksSeen} / ${(ctx.LANDMARKS || []).filter((l) => !l.hidden).length || 12}`;
    delete merged.level;
    const stats = Object.entries(merged).filter(([, v]) => v != null && typeof v !== 'object');
    const seg = (v, cls) => (v > 0 ? h('i', { class: cls, style: `flex:${v}` }) : null);
    return [
      h('div', { class: 'mz-profile' },
        h('div', { class: 'mz-avatar mz-avatar--lg', text: (me().name || '?').slice(0, 1).toUpperCase() }),
        h('div', null, h('span', { class: 'mz-eyebrow', text: `${cityName} · salle ${store.room || '—'} · niveau ${myLevel()}${levelTitle()}` }), h('h3', { class: 'mz-profile-name', text: me().name || 'Joueur' })),
        h('div', { class: 'mz-profile-fortune' }, h('span', { class: 'mz-eyebrow', text: 'Fortune totale' }), h('strong', { text: zc(total) }))),
      h('div', { class: 'mz-split' }, seg(money(), 'a'), seg(vProps, 'b'), seg(vCars, 'c')),
      h('div', { class: 'mz-kpis' },
        h('div', { class: 'mz-kpi' }, h('span', null, h('i', { class: 'mz-dot a' }), 'Liquidités'), h('strong', { text: zc(money()) }), h('small', { text: `capital de départ ${zc(STARTING_MONEY)}` })),
        h('div', { class: 'mz-kpi' }, h('span', null, h('i', { class: 'mz-dot b' }), 'Immobilier'), h('strong', { text: zc(vProps) }), h('small', { text: `${props.length} bien${props.length > 1 ? 's' : ''} · ${zc(props.reduce((s, p) => s + (p.income || 0), 0))}/h` })),
        h('div', { class: 'mz-kpi' }, h('span', null, h('i', { class: 'mz-dot c' }), 'Véhicules'), h('strong', { text: zc(vCars) }), h('small', { text: `${cars.length} voiture${cars.length > 1 ? 's' : ''}` }))),
      h('h4', { class: 'mz-h4', text: 'Statistiques' }),
      stats.length ? h('dl', { class: 'mz-stats' }, stats.map(([k, v]) => h('div', null, h('dt', { text: label(STAT_LABEL, k) }), h('dd', { text: fmtStat(k, v) }))))
        : h('p', { class: 'mz-dim', text: 'Vos statistiques apparaîtront ici après vos premières missions.' }),
    ];
  }

  // ----- Réglages -----
  function tabReglages() {
    const q = ctx.quality || 'high';
    const vol = Number(lsGet('mz.volume', '0.7'));
    const volV = h('span', { class: 'mz-perf-v', text: `${Math.round(vol * 100)} %` });
    const slider = h('input', { class: 'mz-range', type: 'range', min: '0', max: '100', value: String(Math.round(vol * 100)), 'aria-label': 'Volume' });
    slider.addEventListener('input', () => { const v = Number(slider.value) / 100; volV.textContent = `${slider.value} %`; lsSet('mz.volume', String(v)); bus.emit('audio:volume', { value: v }); });
    const others = api.otherCities?.() || [];
    const setQ = (k) => { if (k === q) return; const u = new URL(location.href); u.searchParams.set('quality', k); if (store.room) u.searchParams.set('room', store.room); location.href = u.toString(); };
    return [
      h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Qualité graphique' }), h('p', { class: 'mz-dim', text: 'Le jeu se recharge pour appliquer le changement.' })),
        h('div', { class: 'mz-seg' }, [['low', 'Légère'], ['medium', 'Équilibrée'], ['high', 'Haute']].map(([k, t]) => h('button', { class: k === q ? 'is-on' : '', type: 'button', text: t, onclick: () => setQ(k) })))),
      h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Volume' }), h('p', { class: 'mz-dim', text: 'Moteurs, ville et ambiance.' })), h('div', { class: 'mz-row' }, slider, volV)),
      h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Coincé ?' }), h('p', { class: 'mz-dim', text: 'Vous replace sur la chaussée la plus proche ou à votre domicile.' })),
        h('button', { class: 'mz-btn', type: 'button', onclick: () => { bus.emit('intent:respawn', {}); api.close(); } }, icon('locate', 14), 'Me débloquer')),
      h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Inviter des amis' }), h('p', { class: 'mz-dim', text: `${cityName}, salle « ${roomName()} » — le lien ouvre directement cette ville et cette salle.` })), inviteBtn()),
      others.length ? h('div', { class: 'mz-setting' }, h('div', null, h('h3', { text: 'Changer de ville' }), h('p', { class: 'mz-dim', text: `Vous êtes à ${cityName}. Changer de ville recharge le jeu : votre argent et vos voitures vous suivent, les biens restent dans leur ville.` })),
        h('div', { class: 'mz-row' }, others.map((c) => confirmButton(`Aller à ${c.name}`, `Quitter ${cityName} ?`, () => api.switchCity?.(c.id), 'mz-btn')))) : null,
      h('h4', { class: 'mz-h4', text: 'Commandes' }), controlsGrid(),
      h('p', { class: 'mz-credits' }, h('b', { text: `Données cartographiques de ${cityName}` }), ` ${api.maps.sources || ''}`,
        (api.maps.sourceDetails || []).map((t) => h('small', { text: t }))),
    ];
  }

  const RENDER = { missions: tabMissions, immo: tabImmo, garage: tabGarage, joueurs: tabJoueurs, classement: tabClassement, profil: tabProfil, reglages: tabReglages };
  function signature() {
    const m = me();
    const base = `${st.tab}|${m.money}|${(m.properties || []).join()}|${myCars().join()}|${carId(m.activeCar)}|${curMissionId()}`;
    if (st.tab === 'immo') return base + JSON.stringify(store.propertyOwners || {});
    if (st.tab === 'joueurs' || st.tab === 'classement') return base + players().map((p) => `${p.id}:${p.name}:${p.money}:${p.mode}`).join() + (store.leaderboard || []).map((r) => r.name + r.money).join();
    if (st.tab === 'profil') return base + JSON.stringify(m.stats || {});
    return base;
  }
  function render(force) {
    if (phone.hidden) return;
    header();
    const sig = signature();
    if (!force && (sig === st.sig || body.contains(document.activeElement))) return;
    st.sig = sig;
    const keep = body.scrollTop;
    titleEl.textContent = TABS.find((t) => t[0] === st.tab)?.[1] || '';
    nav.querySelectorAll('.mz-navbtn').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === st.tab));
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
    const buy = confirmButton(`Acheter · ${zc(v.price)}`, `Confirmer ${zc(v.price)}`, () => bus.emit('intent:buyCar', { typeId: v.id, color }), 'mz-btn mz-btn--gold mz-btn--lg');
    if (miss > 0) buy.disabled = true;
    fill(dealerBody, 
      h('header', { class: 'mz-dealer-head' },
        h('div', null, h('span', { class: 'mz-eyebrow', text: 'Concession' }), h('h2', { class: 'mz-display', text: single ? list[0].brand : 'Showroom' })),
        single ? null : chips(brands.map((b) => [b, b]), dl.brandTab, (b) => { dl.brandTab = b; dl.sel = null; renderDealer(); }),
        h('div', { class: 'mz-phone-status' }, h('strong', { class: 'mz-phone-wallet', text: zc(money()) })),
        h('button', { class: 'mz-iconbtn', type: 'button', title: 'Fermer (Échap)', onclick: () => api.close() }, icon('close'))),
      h('div', { class: 'mz-dealer-cols' },
        h('div', { class: 'mz-dealer-list' }, list.map((c) => h('button', { class: 'mz-model' + (c.id === v.id ? ' is-on' : ''), type: 'button', onclick: () => { dl.sel = c.id; dl.color = null; renderDealer(); } },
          carSilhouette(c), h('span', { class: 'mz-model-txt' }, h('b', { text: c.name.replace(new RegExp('^' + c.brand + '\\s+', 'i'), '') }), h('small', { class: myCars().includes(c.id) ? 'is-owned' : '', text: myCars().includes(c.id) ? 'Au garage' : zc(c.price) })),
          myCars().includes(c.id) ? icon('check', 16) : null))),
        h('div', { class: 'mz-dealer-detail' },
          h('div', { class: 'mz-stage' }, carSilhouette(v, color)),
          h('div', { class: 'mz-dealer-info' },
            h('div', { class: 'mz-card-top' }, h('h3', { class: 'mz-display mz-display--sm', text: v.name }), v.electric ? badge('Électrique', '', 'bolt') : badge('Thermique')),
            h('div', { class: 'mz-swatches' }, h('span', { class: 'mz-eyebrow', text: 'Teinte' }), (v.colors || []).map((c) => h('button', { class: 'mz-swatch' + (c === color ? ' is-on' : ''), type: 'button', style: `--c:${c}`, title: c, 'aria-label': `Teinte ${c}`, onclick: () => { dl.color = c; renderDealer(); } }))),
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
    fill(propBody,
      h('header', { class: 'mz-prop-head' },
        h('div', null, h('span', { class: 'mz-eyebrow', text: label(KIND_LABEL, p.kind) }), h('h2', { class: 'mz-display mz-display--sm', text: p.name })),
        h('button', { class: 'mz-iconbtn', type: 'button', title: 'Fermer (Échap)', onclick: () => api.close() }, icon('close'))),
      h('div', { class: 'mz-tags' }, ownerBadge(p), p.address ? badge(p.address) : null, p.garageSlots ? badge(`Garage ${p.garageSlots} place${p.garageSlots > 1 ? 's' : ''}`, '', 'car') : null, isFinite(distTo(p)) ? badge(fmtDist(distTo(p)), '', 'pin') : null),
      h('div', { class: 'mz-kpis' },
        h('div', { class: 'mz-kpi' }, h('span', { text: 'Prix' }), h('strong', { text: zc(p.price) }), h('small', { text: `revente ${zc(p.price * SELL_RATIO)}` })),
        h('div', { class: 'mz-kpi' }, h('span', { text: 'Loyer' }), h('strong', { text: zc(p.income) }), h('small', { text: 'par heure connectée' })),
        h('div', { class: 'mz-kpi' }, h('span', { text: 'Amorti en' }), h('strong', { text: hours ? `${fmtInt(hours)} h` : '—' }), h('small', { text: 'de jeu connecté' }))),
      h('p', { class: 'mz-dim', text: p.description || (mine ? 'Ce bien vous appartient : il sert de point de réapparition et vous verse son loyer tant que vous êtes connecté.' : 'Un bien vous verse son loyer tant que vous êtes connecté et devient votre point de réapparition.') }),
      !mine && !o && miss > 0 ? h('div', { class: 'mz-err', text: `Il vous manque ${zc(miss)}` }) : null,
      h('div', { class: 'mz-row mz-row--end' }, propertyActions(p, false)));
  }

  // ---------- API ----------
  const hideAll = () => { phone.hidden = dealer.hidden = prop.hidden = true; };
  return {
    els: [phone, dealer, prop],
    show(panel, data) {
      hideAll();
      if (panel === 'dealer') { dl.brand = data?.brand || data?.dealer?.brand || null; dl.sel = data?.typeId || null; dl.color = null; dealer.hidden = false; renderDealer(); }
      else if (panel === 'property') { propId = data?.id || data?.propertyId || data?.property?.id || null; prop.hidden = false; renderProp(); }
      else { const t = TAB_ALIAS[data?.tab] || TAB_ALIAS[panel]; if (t) st.tab = t; st.sendTo = null; phone.hidden = false; render(true); }
    },
    hide: hideAll,
    /** Rafraîchissement lent (2 Hz) : ne reconstruit que si les données affichées ont changé. */
    refresh() {
      if (!phone.hidden) render(false);
      const sig = `${money()}|${myCars().join()}|${JSON.stringify(store.propertyOwners || {})}|${(me().properties || []).join()}`;
      if (sig !== st.ctxSig) { st.ctxSig = sig; renderDealer(); renderProp(); }
    },
    inviteUrl,
  };
}

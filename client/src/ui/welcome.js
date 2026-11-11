// Écran de chargement + accueil + choix de la ville.
// Ce module agit DÈS SON IMPORT (avant createUI) : main.js émet `boot:progress {step:'data'}` pendant le
// téléchargement des données, bien avant la création des modules — l'écran doit déjà être là pour l'afficher.
// La ville est lue une fois dans `?city=` : choisir une autre ville = recharger la page avec le bon paramètre.
import { bus as coreBus } from '../core/bus.js';
import { CITY, CITY_ID, CITIES, DEFAULT_CITY } from '@shared/cities.js';
import { h, icon, lsGet, lsSet, copyText, clamp } from './util.js';
import { cityArt, cityLine } from './cityart.js';
import { controlsGrid } from './panels.js';

const STEP_LABEL = { env: 'Ciel et lumière', world: 'Rues et immeubles', monuments: 'Monuments', vehicles: 'Véhicules', player: 'Personnage', traffic: 'Circulation', gameplay: 'Missions et immobilier', net: 'Connexion', ui: 'Interface', audio: 'Ambiance sonore' };
const STEPS = Object.keys(STEP_LABEL);
const FILE_LABEL = { roads: 'réseau de rues', buildings: 'bâtiments', pois: 'lieux et espaces verts', buildingsMeta: 'façades', buildingsMetaBin: 'façades', terrain: 'relief' };
const DROP_ON_SWITCH = ['city', 'tp', 'autostart', 'name']; // paramètres propres à une ville ou à un lancement
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* indisponible */ } };
export const cleanRoom = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9-]/g, '').slice(0, 20);

function createShell() {
  const params = new URLSearchParams(location.search);
  const autostart = !!params.get('autostart');
  const city = CITY, cityIds = Object.keys(CITIES);
  const coarse = (window.matchMedia?.('(pointer: coarse)').matches) || 'ontouchstart' in window || params.get('touch') === '1';
  const isCompact = () => coarse || window.innerHeight < 520 || window.innerWidth < 720;

  // ---- Ville mémorisée : en arrivant sur `/` sans ville ni salle, on rejoint la dernière ville jouée.
  // Une seule redirection (l'URL porte ensuite ?city=, la condition ne peut plus être vraie) + garde-fou de session
  // (pas deux redirections en moins de 3 s dans le même onglet) : jamais de boucle.
  let redirecting = false;
  const saved = lsGet('mz.city');
  if (!params.has('city') && !params.has('room') && !autostart && saved && CITIES[saved] && saved !== CITY_ID && Date.now() - Number(ssGet('mz.redirect') || 0) > 3000) {
    ssSet('mz.redirect', String(Date.now()));
    const u = new URL(location.href);
    u.searchParams.set('city', saved);
    redirecting = true;
    location.replace(u.toString());
  }

  const ui = h('div', { class: 'mz', dataset: { city: redirecting ? saved : city.id } });
  const applyCompact = () => { ui.classList.toggle('mz-compact', isCompact()); ui.classList.toggle('mz-touch', !!coarse); };
  applyCompact();
  window.addEventListener('resize', applyCompact);
  document.getElementById('ui-root')?.appendChild(ui);

  /** URL de la même page pour une autre ville : garde quality, time, offline… et la salle. */
  function cityUrl(id, room) {
    const u = new URL(location.href);
    for (const k of DROP_ON_SWITCH) u.searchParams.delete(k);
    u.searchParams.set('city', id);
    // la salle publique par défaut porte le nom de la ville : elle suit le changement ; une salle privée est conservée
    const r = cleanRoom(room);
    if (r && !CITIES[r]) u.searchParams.set('room', r); else u.searchParams.delete('room');
    return u.toString();
  }
  let switching = false;
  function switchCity(id, room) {
    if (switching || !CITIES[id] || id === CITY_ID) return;
    switching = true;
    lsSet('mz.city', id);
    const n = nameIn.value.trim();
    if (n) lsSet('mz.name', n.slice(0, 16));
    const veil = h('div', { class: 'mz-switch', dataset: { theme: id } }, h('span', { class: 'mz-eyebrow', text: 'Changement de ville' }), h('strong', { text: CITIES[id].name }), h('span', { class: 'mz-switch-sub', text: `Cap sur ${CITIES[id].name}…` }), h('div', { class: 'mz-bar is-busy' }, h('i')));
    ui.appendChild(veil);
    setTimeout(() => location.assign(cityUrl(id, room ?? roomIn.value ?? params.get('room'))), 260);
  }

  // ---- Progression du chargement
  const bootBar = h('i');
  const bootStep = h('span', { class: 'mz-boot-step', text: `${city.name} · préparation` });
  const bootPct = h('span', { class: 'mz-boot-pct', text: '0 %' });
  const bootWait = h('p', { class: 'mz-boot-wait', hidden: true });
  const boot = h('div', { class: 'mz-boot' }, h('div', { class: 'mz-boot-row' }, bootStep, bootPct), h('div', { class: 'mz-bar' }, bootBar), bootWait);
  const prog = { sawData: false, done: 0, total: 0, mod: 0, frac: 0, t: performance.now(), ready: false, failed: false };
  const cardState = new Map();
  function paintProgress(label) {
    const f = prog.ready ? 1 : prog.sawData ? 0.5 * (prog.total ? prog.done / prog.total : 0) + 0.5 * (prog.mod / STEPS.length) : prog.mod / STEPS.length;
    if (f > prog.frac || prog.ready) { prog.frac = f; prog.t = performance.now(); bootWait.hidden = true; }
    const pct = `${Math.round(clamp(prog.frac, 0, 1) * 100)} %`;
    bootBar.style.transform = `scaleX(${clamp(prog.frac, 0.02, 1)})`;
    bootPct.textContent = pct;
    if (label) bootStep.textContent = label;
    const cs = cardState.get(CITY_ID);
    if (cs && !prog.ready && !prog.failed) cs.textContent = `Chargement ${pct}`;
  }
  function onProgress(p) {
    if (redirecting || !p) return;
    if (p.step === 'data') {
      prog.sawData = true; prog.done = p.done || 0; prog.total = p.total || prog.total;
      const got = p.file && FILE_LABEL[p.file] ? ` — reçu : ${FILE_LABEL[p.file]}` : '';
      paintProgress(`${city.name} · données ${prog.done}/${prog.total}${got}`);
    } else {
      const i = STEPS.indexOf(p.step);
      prog.modStarted = true;
      if (prog.sawData) { prog.done = prog.total; }
      prog.mod = i >= 0 ? i : Math.min(STEPS.length - 1, prog.mod + 1);
      paintProgress(`${city.name} · ${STEP_LABEL[p.step] || 'chargement'}`);
    }
  }
  const attached = new Set();
  function attach(b) { if (!b || attached.has(b)) return; attached.add(b); b.on('boot:progress', onProgress); }
  attach(coreBus);
  // message d'attente honnête si rien n'avance depuis un moment (les données d'une grande ville pèsent des dizaines de Mo)
  const waitTimer = setInterval(() => {
    if (prog.ready || prog.failed) { clearInterval(waitTimer); return; }
    const idle = performance.now() - prog.t;
    if (idle < 7000) return;
    const heavy = prog.sawData && prog.done < prog.total;
    bootWait.textContent = heavy
      ? `Les données de ${city.name} sont volumineuses : le premier chargement peut prendre une à deux minutes selon la connexion. Les suivants seront bien plus rapides.`
      : `${city.name} se construit, encore un instant…`;
    bootWait.hidden = false;
  }, 1000);
  const notice = h('p', { class: 'mz-notice', hidden: true });
  function fail(text) {
    if (prog.ready) return;
    prog.failed = true; bootWait.hidden = true;
    notice.textContent = text; notice.hidden = false; boot.classList.add('is-failed');
    const cs = cardState.get(CITY_ID); if (cs) cs.textContent = 'Indisponible';
  }
  // Seul un rejet pendant le téléchargement des données (avant le premier module) est tenu pour un échec du chargement :
  // main.js isole déjà les erreurs de modules, et un rejet tardif (son, pointeur…) n'empêche pas de jouer.
  const onReject = () => !prog.modStarted && fail(`Le chargement de ${city.name} a échoué. Rechargez la page${cityIds.length > 1 ? ' ou choisissez une autre ville' : ''}.`);
  window.addEventListener('unhandledrejection', onReject);

  // ---- Grille des villes (générée depuis CITIES : une nouvelle ville y apparaît d'elle-même)
  const cards = cityIds.map((id) => {
    const c = CITIES[id], cur = id === CITY_ID;
    const state = h('span', { class: 'mz-city-state', text: cur ? 'Chargement…' : 'Y aller' });
    cardState.set(id, state);
    return h('button', { class: 'mz-city' + (cur ? ' is-on' : ''), type: 'button', dataset: { theme: id }, 'aria-pressed': cur ? 'true' : 'false', title: cur ? `${c.name} — ville actuelle` : `Jouer à ${c.name}`, onclick: () => switchCity(id) },
      h('span', { class: 'mz-city-art', html: cityArt(id) }), state,
      h('span', { class: 'mz-city-txt' }, h('strong', { text: c.name }), h('small', { text: c.tagline || '' })));
  });
  const cityGrid = h('section', { class: 'mz-cities', hidden: autostart },
    h('span', { class: 'mz-steplabel' }, h('b', { text: '1' }), 'Choisissez votre ville'),
    h('div', { class: 'mz-citygrid', dataset: { n: String(cityIds.length) } }, cards));

  // ---- Formulaire d'entrée
  const nameIn = h('input', { class: 'mz-input', id: 'mz-name', type: 'text', maxlength: '16', autocomplete: 'off', spellcheck: 'false', placeholder: 'Votre pseudo', value: lsGet('mz.name', '') });
  const lastRoom = lsGet('mz.room', '');
  const roomIn = h('input', { class: 'mz-input', id: 'mz-room', type: 'text', maxlength: '20', autocomplete: 'off', spellcheck: 'false', placeholder: city.id, value: cleanRoom(params.get('room')) || (lastRoom && !CITIES[lastRoom] ? lastRoom : '') || city.id });
  roomIn.addEventListener('input', () => { const c = cleanRoom(roomIn.value); if (c !== roomIn.value) roomIn.value = c; copyLbl.textContent = 'Copier le lien d’invitation'; });
  const playLbl = h('span', { text: `Jouer à ${city.name}` });
  const playBtn = h('button', { class: 'mz-btn mz-btn--gold mz-btn--lg mz-play', type: 'submit' }, playLbl);
  const copyLbl = h('span', { text: 'Copier le lien d’invitation' });
  const netPill = h('span', { class: 'mz-pill is-connecting' }, h('i'), h('span', { text: 'Connexion au serveur…' }));
  const room = () => cleanRoom(roomIn.value) || city.id;
  /** Lien d'invitation : la ville ET la salle. */
  const inviteUrl = (r) => `${location.origin}${location.pathname}?city=${encodeURIComponent(CITY_ID)}&room=${encodeURIComponent(cleanRoom(r) || room())}`;
  const WORDS = { paris: ['lutece', 'pigalle', 'bastille', 'odeon', 'rivoli', 'vendome', 'belleville', 'chatelet'], toulouse: ['capitole', 'garonne', 'violette', 'carmes', 'daurade', 'matabiau', 'pastel', 'minimes'] };
  let onPlay = null;
  const form = h('form', { class: 'mz-login', hidden: true, onsubmit: (e) => { e.preventDefault(); play(); } },
    h('span', { class: 'mz-steplabel' }, h('b', { text: '2' }), 'Entrez dans la partie'),
    h('label', { class: 'mz-field', for: 'mz-name' }, h('span', { text: 'Pseudo' }), nameIn),
    h('label', { class: 'mz-field', for: 'mz-room' }, h('span', { text: 'Code de salle', title: 'Même code = même partie. Partagez-le avec vos amis.' }),
      h('div', { class: 'mz-inputrow' }, roomIn,
        h('button', { class: 'mz-iconbtn', type: 'button', title: 'Créer une salle privée', onclick: () => { const w = WORDS[city.id] || WORDS.paris; roomIn.value = `${w[Math.floor(Math.random() * w.length)]}-${100 + Math.floor(Math.random() * 900)}`; copyLbl.textContent = 'Copier le lien d’invitation'; } }, icon('dice')))),
    playBtn,
    h('div', { class: 'mz-login-foot' },
      h('button', { class: 'mz-btn mz-btn--ghost mz-btn--sm mz-copy', type: 'button', onclick: async () => { const ok = await copyText(inviteUrl()); copyLbl.textContent = ok ? 'Lien copié' : inviteUrl(); } }, icon('copy', 14), copyLbl),
      netPill));
  function play() {
    if (!prog.ready || playBtn.disabled) return;
    const name = nameIn.value.trim().slice(0, 16) || `Flâneur${100 + Math.floor(Math.random() * 900)}`;
    lsSet('mz.name', name); lsSet('mz.room', room()); lsSet('mz.city', CITY_ID);
    playBtn.disabled = true; playLbl.textContent = 'Connexion…';
    onPlay?.(name, room());
  }

  const howto = h('aside', { class: 'mz-howto', hidden: true }, h('span', { class: 'mz-eyebrow', text: 'Commandes' }), controlsGrid(),
    h('p', { class: 'mz-hint', text: 'Sur mobile : joystick à gauche, boutons à droite, en mode paysage.' }));
  const n = cityIds.length;
  const welcome = h('div', { class: 'mz-welcome' + (autostart ? ' is-auto' : '') },
    h('div', { html: cityLine(redirecting ? saved : city.id), class: 'mz-skywrap' }),
    h('div', { class: 'mz-welcome-in' },
      h('div', { class: 'mz-hero' },
        h('span', { class: 'mz-eyebrow', text: autostart ? `${city.name} · monde ouvert · multijoueur` : `Monde ouvert · multijoueur · ${n} ville${n > 1 ? 's' : ''}` }),
        h('h1', { class: 'mz-title' }, h('em', { text: 'Mission' }), h('b', { text: 'Zéro' })),
        h('p', { class: 'mz-tagline', text: `Partez de rien. Roulez, livrez, investissez — et offrez-vous ${city.name}.` }),
        cityGrid, boot, notice, form),
      howto));
  if (redirecting) welcome.replaceChildren(h('div', { class: 'mz-switch', dataset: { theme: saved } }, h('span', { class: 'mz-eyebrow', text: 'Mission Zéro' }), h('strong', { text: CITIES[saved].name }), h('span', { class: 'mz-switch-sub', text: `Retour à ${CITIES[saved].name}…` }), h('div', { class: 'mz-bar is-busy' }, h('i'))));
  ui.appendChild(welcome);
  paintProgress();

  return {
    ui, welcome, autostart, coarse, isCompact, applyCompact, city, redirecting,
    nameIn, roomIn, playBtn, attach, switchCity, cityUrl, inviteUrl, room,
    set onPlay(fn) { onPlay = fn; },
    /** Chargement terminé : le formulaire remplace la barre de progression. */
    ready() {
      prog.ready = true; paintProgress(`${city.name} · prêt`);
      window.removeEventListener('unhandledrejection', onReject);
      const cs = cardState.get(CITY_ID); if (cs) cs.textContent = 'Ville actuelle';
      if (autostart) return;
      boot.hidden = true; form.hidden = false; howto.hidden = false;
      welcome.classList.add('is-ready');
      if (!coarse) setTimeout(() => (nameIn.value ? playBtn : nameIn).focus(), 50);
    },
    /** Avertissement lisible sous les cartes (données manquantes, repli…). */
    notice(text) { notice.textContent = text; notice.hidden = !text; },
    fail,
    setNet(state) {
      const txt = { online: 'Serveur en ligne', offline: 'Hors ligne — progression enregistrée sur cet appareil', connecting: 'Connexion au serveur…', reconnecting: 'Reconnexion…' }[state] || state;
      netPill.className = 'mz-pill is-' + state; netPill.lastChild.textContent = txt;
    },
    hide() { welcome.classList.add('is-out'); setTimeout(() => { welcome.hidden = true; }, 650); },
    otherCities: () => cityIds.filter((id) => id !== CITY_ID).map((id) => CITIES[id]),
    defaultCity: DEFAULT_CITY,
  };
}

/** Coquille de l'interface, créée à l'import du module. */
export const shell = createShell();

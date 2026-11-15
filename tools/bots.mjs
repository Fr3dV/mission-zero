// Robots de test multijoueur : N clients qui rejoignent une salle et tournent en rond (voiture ou à pied).
// Usage : node tools/bots.mjs --url ws://localhost:8080/ws --room test --n 5 [--city toulouse]
//   [--city paris]     ville des robots (shared/cities.js) : ils rejoignent la salle de CETTE ville et ne sont vus
//                      que par les joueurs de la même ville. Leurs pseudos portent l'initiale de la ville hors Paris
//                      (Robot-T1…) : une flotte par ville peut tourner en même temps sans partager ses comptes.
//   [--x 0 --z 0]      centre des trajectoires, dans le repère de la ville (défaut : un espace dégagé près de son
//                      origine — 40 m au sud de l'obélisque de la Concorde à Paris, milieu de la place du Capitole
//                      à Toulouse, l'origine elle-même ailleurs)
//   [--name Robot]     préfixe des pseudos
//   [--radius 25]      rayon du premier cercle (chaque robot ajoute 6 m)
//   [--foot 1]         nombre de robots à pied (défaut : 1 robot sur 4)
//   [--points "x,z;x,z;…"]  parcours fermé à suivre à la place des cercles
//   [--chat 20]        un message de chat toutes les N secondes (0 = jamais)
//   [--secs 0]         durée avant arrêt automatique (0 = jusqu'à Ctrl+C)
// Essais à plusieurs (contrat v6) — chaque option n'envoie rien si le serveur n'annonce pas la capacité voulue :
//   [--emote 6]        un klaxon ou une bulle express toutes les N secondes par robot (0 = jamais)
//   [--dare 0]         le premier robot lance un « Chiche ! » (mise 0, 500 ou 2000) 3 s après son arrivée, donne le
//                      départ 2 s après l'inscription d'un adversaire, puis file vers l'arrivée ; il relance un défi
//                      20 s après la fin du précédent
//   [--join]           les autres robots rejoignent tout Chiche ouvert dans la salle (ils se rendent au point de
//                      départ, s'inscrivent, puis font la course) ; lancé par un joueur ou par --dare
//   [--race 0]         vitesse des robots pendant un Chiche, en m/s (0 = 12 à 24 m/s selon le robot : un joueur peut gagner)
//   [--anim lying]     les robots à pied jouent cette animation 3 s toutes les 8 s (lying est suivie de getup) : pour
//                      voir un ami tomber et se relever. Sans --foot, un robot au moins est à pied.
// Les jetons des robots sont gardés dans .data/bots.json pour réutiliser les mêmes comptes d'un lancement à l'autre.
import WebSocket from 'ws';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { C, S, PROTOCOL_VERSION, CLIENT_SEND_HZ, ANIMS, EMOTES, encode, decode, encodeState } from '../shared/protocol.js';
import { VEHICLES } from '../shared/catalog.js';
import { fmtMoney } from '../shared/economy.js';
import { CITIES, DEFAULT_CITY } from '../shared/cities.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const url = opt('url', 'ws://localhost:8080/ws'), room = opt('room', 'test');
const n = Math.max(1, Math.min(31, +opt('n', 5)));
const city = opt('city', DEFAULT_CITY);
if (!CITIES[city]) { console.error(`Ville inconnue : ${city} (villes : ${Object.keys(CITIES).join(', ')})`); process.exit(2); }
const prefix = opt('name', 'Robot') + '-' + (city === DEFAULT_CITY ? '' : city[0].toUpperCase());
// Autour de l'origine de la ville, décalé vers l'espace dégagé le plus proche : l'origine de Paris est l'obélisque de
// la Concorde, celle de Toulouse tombe dans le bâtiment du Capitole (la place est juste à l'ouest de la façade).
const CENTERS = { paris: [0, 40], toulouse: [-85, 20] };
const [dcx, dcz] = CENTERS[city] || [0, 0];
const cx = +opt('x', dcx), cz = +opt('z', dcz), radius0 = +opt('radius', 25);
const flag = (name) => args.includes('--' + name);
const chatEvery = +opt('chat', 0), secs = +opt('secs', 0);
const emoteEvery = Math.max(0, +opt('emote', 0) || 0);
const dareOn = flag('dare'), joinOn = flag('join');
const raceOpt = Math.max(0, Math.min(90, +opt('race', 0) || 0));
const dareStake = [0, 500, 2000].includes(+opt('dare', 0)) ? +opt('dare', 0) : 0; // « --dare » seul ou suivi d'une autre option : mise 0
const animArg = opt('anim');
const animName = flag('anim') ? (animArg && !animArg.startsWith('--') ? animArg : 'lying') : null; // « --anim » seul : chute
if (animName != null && !ANIMS.includes(animName)) { console.error(`Animation inconnue : ${animName} (animations : ${ANIMS.join(', ')})`); process.exit(2); }
const footCount = opt('foot') != null ? +opt('foot') : Math.max(animName ? 1 : 0, Math.floor(n / 4));
const ANIM_EVERY_S = 8, ANIM_FOR_S = 3, GETUP_S = 1.2;
const DARE_FIRST_MS = 3000, DARE_GO_MS = 2000, DARE_AGAIN_MS = 20000, JOIN_MS = 1800;
const points = opt('points', '').split(';').filter(Boolean).map((p) => p.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));

const TOKENS_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '.data', 'bots.json');
let tokens = {};
try { tokens = JSON.parse(readFileSync(TOKENS_FILE, 'utf8')); } catch { /* premier lancement */ }
const saveTokens = () => { try { mkdirSync(dirname(TOKENS_FILE), { recursive: true }); writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 1)); } catch { /* sans importance */ } };

const PHRASES = ['Salut Paris !', 'Qui fait la course ?', 'Belle journée pour rouler.', 'Je tourne en rond…', 'Rendez-vous à la Concorde !'];

/** Trajectoire : position et cap à l'instant t (s). Cap : 0 = Nord (−Z), avant = (−sin, −cos). */
function makePath(i, foot) {
  const speed = foot ? 1.6 + (i % 3) * 1.2 : 9 + (i % 5) * 3.5;
  if (points.length >= 2) {
    const segs = points.map((p, k) => { const q = points[(k + 1) % points.length]; return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) }; });
    const total = segs.reduce((s, g) => s + g.len, 0), start = (i / n) * total;
    return (t) => {
      let d = (start + t * speed) % total;
      for (const g of segs) {
        if (d > g.len) { d -= g.len; continue; }
        const k = g.len ? d / g.len : 0, dx = g.q[0] - g.p[0], dz = g.q[1] - g.p[1];
        return { x: g.p[0] + dx * k, z: g.p[1] + dz * k, yaw: Math.atan2(-dx, -dz), speed };
      }
      return { x: points[0][0], z: points[0][1], yaw: 0, speed };
    };
  }
  const r = foot ? 6 + i * 2 : radius0 + i * 6, dir = i % 2 ? -1 : 1, phase = (i / n) * Math.PI * 2;
  return (t) => {
    const a = phase + dir * (speed / r) * t;
    // tangente du cercle : (−sin a, cos a)·dir = (−sin yaw, −cos yaw)
    const tx = -Math.sin(a) * dir, tz = Math.cos(a) * dir;
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, yaw: Math.atan2(-tx, -tz), speed };
  };
}

function startBot(i) {
  const name = `${prefix}${i + 1}`, key = `${url}|${name}`;
  const foot = i < footCount;
  const car = VEHICLES[(i * 3 + 1) % VEHICLES.length];
  const color = car.colors[i % car.colors.length];
  const path = makePath(i, foot);
  const launcher = dareOn && i === Math.min(footCount, n - 1); // le premier robot en voiture lance les Chiches
  const raceSpeed = raceOpt ? raceOpt * (1 + (i % 5) * 0.05) : foot ? 5 : 12 + (i % 5) * 3; // m/s vers l'arrivée d'un Chiche
  let ws, timer, chatTimer, emoteTimer, dareTimer, goTimer, joinTimer, stopped = false, retry = 500;
  let id = null, feat = [], logged = false;
  let tPath = 0; // horloge du parcours (s) : elle s'arrête pendant une chute, une attente ou une course
  let cur = path(tPath); // dernière position envoyée
  let hold = null; // { x, z } : immobile à cet endroit (point de départ d'un Chiche)
  let race = null; // { id, to: { x, z }, startAt (ms), from: { x, z } | null } : Chiche en cours pour ce robot
  let emoteK = i % 5;

  const can = (cap) => feat.includes(cap);
  const send = (type, payload) => { if (ws && ws.readyState === 1) ws.send(encode(type, payload)); };
  const clearTimers = () => { for (const h of [timer, chatTimer, emoteTimer]) clearInterval(h); for (const h of [dareTimer, goTimer, joinTimer]) clearTimeout(h); goTimer = joinTimer = null; };

  /** Position, cap, vitesse et animation à envoyer maintenant. */
  function step(dt) {
    const now = Date.now();
    if (race && now >= race.startAt) {
      // Chiche lancé : tout droit vers l'arrivée (les robots traversent les immeubles sans état d'âme)
      if (!race.from) race.from = { x: cur.x, z: cur.z };
      const dx = race.to.x - race.from.x, dz = race.to.z - race.from.z, dist = Math.hypot(dx, dz) || 1;
      const k = Math.min(1, (((now - race.startAt) / 1000) * raceSpeed) / dist);
      cur = { x: race.from.x + dx * k, z: race.from.z + dz * k, yaw: Math.atan2(-dx, -dz), speed: k < 1 ? raceSpeed : 0 };
      return foot ? 'run' : 'sit';
    }
    if (hold) { cur = { x: hold.x, z: hold.z, yaw: cur.yaw, speed: 0 }; return foot ? 'idle' : 'sit'; }
    if (foot && animName) {
      const ph = (now / 1000 + i * 2.5) % ANIM_EVERY_S;
      if (ph < ANIM_FOR_S) { cur = { ...cur, speed: 0 }; return animName; }
      if (animName === 'lying' && ph < ANIM_FOR_S + GETUP_S) { cur = { ...cur, speed: 0 }; return 'getup'; }
    }
    tPath += dt;
    cur = path(tPath);
    return foot ? (cur.speed > 3 ? 'run' : 'walk') : 'sit';
  }

  function launchDare() {
    if (stopped || !launcher || !can('dare')) return;
    hold = { x: cur.x, z: cur.z }; // le lanceur attend ses adversaires là où il est
    send(C.DARE, { stake: dareStake });
  }
  const dareAgain = (ms) => { clearTimeout(dareTimer); if (launcher) dareTimer = setTimeout(launchDare, ms); };
  const leaveDare = () => { race = null; hold = null; clearTimeout(goTimer); clearTimeout(joinTimer); goTimer = joinTimer = null; };

  function onDare(m) {
    const players = Array.isArray(m.players) ? m.players : [], mine = players.some((p) => p.id === id);
    if (m.phase === 'open') {
      if (launcher && m.by?.id === id) {
        if (!hold) hold = { x: m.origin.x, z: m.origin.z };
        if (players.length >= 2 && !goTimer) goTimer = setTimeout(() => { goTimer = null; send(C.DARE_GO); }, DARE_GO_MS);
      } else if (joinOn && !foot && !mine && !joinTimer && can('dare')) {
        // on se rend au point de départ (à moins de 80 m), puis on s'inscrit une fois la position connue du serveur
        hold = { x: m.origin.x + 4 + 3 * i, z: m.origin.z + 3 };
        joinTimer = setTimeout(() => { joinTimer = null; send(C.DARE_JOIN, { id: m.id }); }, JOIN_MS);
        console.log(`${name} rejoint le Chiche de ${m.by?.name} (départ : ${m.origin.label}, arrivée : ${m.to.label}, mise ${fmtMoney(m.stake)})`);
      }
      return;
    }
    if (!mine) { if (race || hold) leaveDare(); return; } // pas inscrit, disqualifié ou forfait
    if (!race || race.id !== m.id) {
      race = { id: m.id, to: { x: m.to.x, z: m.to.z }, startAt: Date.now() + (+m.startsIn || 0), from: null };
      hold = hold || { x: cur.x, z: cur.z };
      console.log(`${name} : départ du Chiche dans ${Math.max(0, Math.round(m.startsIn / 100) / 10)} s vers ${m.to.label} (${players.length} participants)`);
    }
  }

  function connect() {
    ws = new WebSocket(url);
    ws.on('open', () => ws.send(encode(C.HELLO, { v: PROTOCOL_VERSION, name, room, city, token: tokens[key] })));
    ws.on('message', (raw) => {
      const m = decode(raw);
      if (!m) return;
      if (m.t === S.WELCOME) {
        retry = 500;
        id = m.id;
        feat = Array.isArray(m.feat) ? m.feat : []; // serveur d'avant le contrat v6 : aucun message nouveau ne lui est envoyé
        leaveDare();
        if (m.token) { tokens[key] = m.token; saveTokens(); }
        if ((m.city || DEFAULT_CITY) !== city) console.warn(`${name} : le serveur a répondu pour « ${m.city || DEFAULT_CITY} » au lieu de « ${city} » (serveur d'avant le multi-villes ?)`);
        console.log(`${m.me.name} connecté dans « ${m.room} » à ${CITIES[m.city || DEFAULT_CITY]?.name} (${foot ? 'à pied' : car.name}) — ${m.players.length} autre(s) joueur(s)`);
        if (!logged && (emoteEvery || dareOn || joinOn) && !feat.length) console.warn(`${name} : ce serveur n'annonce aucune capacité (welcome.feat) : --emote, --dare et --join sont sans effet`);
        logged = true;
        clearTimers();
        timer = setInterval(() => {
          if (ws.readyState !== 1) return;
          const anim = step(1 / CLIENT_SEND_HZ);
          ws.send(encode(C.STATE, { s: encodeState({ x: cur.x, y: 0, z: cur.z, yaw: cur.yaw, speed: cur.speed, mode: foot ? 'foot' : 'vehicle', anim, vehicleType: car.id, vehicleColor: color }) }));
        }, 1000 / CLIENT_SEND_HZ);
        if (chatEvery > 0) chatTimer = setInterval(() => send(C.CHAT, { text: PHRASES[Math.floor(Math.random() * PHRASES.length)] }), chatEvery * 1000 * (1 + i * 0.3));
        // klaxon (0) puis les quatre bulles, à tour de rôle ; décalés d'un robot à l'autre
        if (emoteEvery > 0 && can('fun1')) emoteTimer = setInterval(() => { send(C.EMOTE, { k: emoteK }); emoteK = (emoteK + 1) % 5; }, emoteEvery * 1000 * (1 + i * 0.13));
        if (m.dare) onDare(m.dare);
        if (launcher && !m.dare) dareAgain(DARE_FIRST_MS);
      } else if (m.t === S.DARE) onDare(m);
      else if (m.t === S.DARE_END) {
        const mine = !!race || (launcher && !!hold);
        leaveDare();
        if (i === 0 || mine) {
          const why = m.reason === 'solo' ? 'personne ne l\'a relevé' : m.reason === 'timeout' ? 'temps écoulé' : m.reason === 'left' ? 'forfaits' : m.reason === 'restart' ? 'serveur redémarré : annulé sans débit' : 'arrivée franchie';
          console.log(`${name} : fin du Chiche — ${m.winner ? `${m.winner.name} gagne en ${m.sec} s (+${fmtMoney(m.pot)})` : 'pas de vainqueur'} (${why})`);
        }
        dareAgain(DARE_AGAIN_MS);
      } else if (m.t === S.EMOTE) {
        if (i === 0) console.log(`${name} reçoit de ${m.id} : ${m.k === 0 ? `klaxon « ${m.h} »` : `bulle « ${EMOTES[m.k] || m.k} »`}`);
      } else if (m.t === S.ERROR) {
        console.log(`${name} : erreur « ${m.text} »${m.code ? ` (${m.op} / ${m.code})` : ''}`);
        if (m.op === C.DARE) { leaveDare(); dareAgain(DARE_AGAIN_MS); } // défi refusé (un autre est en cours, débit…) : nouvel essai plus tard
        else if (m.op === C.DARE_JOIN) leaveDare();
      }
    });
    ws.on('error', () => {});
    ws.on('close', (code) => {
      clearTimers();
      if (stopped || code === 4001 || code === 4002) return;
      setTimeout(connect, retry); retry = Math.min(8000, retry * 2); // reconnexion automatique (redémarrage du serveur)
    });
  }
  connect();
  return () => { stopped = true; clearTimers(); try { ws.close(); } catch { /* déjà fermée */ } };
}

const stops = [];
for (let i = 0; i < n; i++) setTimeout(() => stops.push(startBot(i)), i * 60);
const quit = () => { for (const s of stops) s(); setTimeout(() => process.exit(0), 300); };
process.on('SIGINT', quit); process.on('SIGTERM', quit);
if (secs > 0) setTimeout(quit, secs * 1000);

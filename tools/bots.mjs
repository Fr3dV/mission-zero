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
// Les jetons des robots sont gardés dans .data/bots.json pour réutiliser les mêmes comptes d'un lancement à l'autre.
import WebSocket from 'ws';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { C, S, PROTOCOL_VERSION, CLIENT_SEND_HZ, encode, decode, encodeState } from '../shared/protocol.js';
import { VEHICLES } from '../shared/catalog.js';
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
const footCount = opt('foot') != null ? +opt('foot') : Math.floor(n / 4);
const chatEvery = +opt('chat', 0), secs = +opt('secs', 0);
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
  const t0 = Date.now();
  let ws, timer, chatTimer, stopped = false, retry = 500;

  function connect() {
    ws = new WebSocket(url);
    ws.on('open', () => ws.send(encode(C.HELLO, { v: PROTOCOL_VERSION, name, room, city, token: tokens[key] })));
    ws.on('message', (raw) => {
      const m = decode(raw);
      if (!m) return;
      if (m.t === S.WELCOME) {
        retry = 500;
        if (m.token) { tokens[key] = m.token; saveTokens(); }
        if ((m.city || DEFAULT_CITY) !== city) console.warn(`${name} : le serveur a répondu pour « ${m.city || DEFAULT_CITY} » au lieu de « ${city} » (serveur d'avant le multi-villes ?)`);
        console.log(`${m.me.name} connecté dans « ${m.room} » à ${CITIES[m.city || DEFAULT_CITY]?.name} (${foot ? 'à pied' : car.name}) — ${m.players.length} autre(s) joueur(s)`);
        clearInterval(timer);
        timer = setInterval(() => {
          if (ws.readyState !== 1) return;
          const p = path((Date.now() - t0) / 1000);
          ws.send(encode(C.STATE, { s: encodeState({ x: p.x, y: 0, z: p.z, yaw: p.yaw, speed: p.speed, mode: foot ? 'foot' : 'vehicle', anim: foot ? (p.speed > 3 ? 'run' : 'walk') : 'sit', vehicleType: car.id, vehicleColor: color }) }));
        }, 1000 / CLIENT_SEND_HZ);
        if (chatEvery > 0) { clearInterval(chatTimer); chatTimer = setInterval(() => ws.readyState === 1 && ws.send(encode(C.CHAT, { text: PHRASES[Math.floor(Math.random() * PHRASES.length)] })), chatEvery * 1000 * (1 + i * 0.3)); }
      } else if (m.t === S.ERROR) console.log(`${name} : erreur « ${m.text} »`);
    });
    ws.on('error', () => {});
    ws.on('close', (code) => {
      clearInterval(timer); clearInterval(chatTimer);
      if (stopped || code === 4001 || code === 4002) return;
      setTimeout(connect, retry); retry = Math.min(8000, retry * 2); // reconnexion automatique (redémarrage du serveur)
    });
  }
  connect();
  return () => { stopped = true; clearInterval(timer); clearInterval(chatTimer); try { ws.close(); } catch { /* déjà fermée */ } };
}

const stops = [];
for (let i = 0; i < n; i++) setTimeout(() => stops.push(startBot(i)), i * 60);
const quit = () => { for (const s of stops) s(); setTimeout(() => process.exit(0), 300); };
process.on('SIGINT', quit); process.on('SIGTERM', quit);
if (secs > 0) setTimeout(quit, secs * 1000);

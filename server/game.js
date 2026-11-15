// Cœur multijoueur de Mission Zéro : comptes invités, salles, synchronisation, économie autoritaire, chat.
// Indépendant du transport HTTP : createGame({ store }) puis game.attach(serveurHttp).
//
// Contrat v6 (boucle fun et rétention) : records de salle par catégorie, carnet de bord et relevé du matin,
// gazette, classement par fortune, taxi libre, « Chiche ! », style, képis, émotes, apparence. Les règles sont
// dans les modules purs (shared/economy.js, journal.js, jobs.js) ; ici : validation, états volatils, diffusion.
import { WebSocketServer } from 'ws';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  PROTOCOL_VERSION, WS_PATH, C, S, CLOSE, ANIMS, FEATS, SERVER_TICK_HZ, HEARTBEAT_MS, MAX_MESSAGE_BYTES,
  MAX_PLAYERS_PER_ROOM, MAX_SPEED, encode, decode, normColor,
} from '../shared/protocol.js';
import * as eco from '../shared/economy.js';
import * as J from '../shared/journal.js';
import * as jobs from '../shared/jobs.js';
import * as CORE from '../shared/content-core.js';
import * as MISSIONS from '../shared/missions.js';
import { CITIES, DEFAULT_CITY, sanitizeCity, geoFor } from '../shared/cities.js';
import { VEHICLES, VEHICLE_BY_ID, STARTER_VEHICLE } from '../shared/catalog.js';
import { filterText, hasProfanity } from './chat-filter.js';

const BOUNDS_MARGIN = 300; // tolérance autour de l'emprise jouable de la ville (m)
// Vitesse plausible : au moins 130 m/s (468 km/h), et toujours 30 % au-dessus de la voiture la plus rapide du catalogue
// (97 m/s = 350 km/h aujourd'hui) : un joueur honnête lancé sur la rocade reste très en dessous.
const SPEED_CAP = Math.max(MAX_SPEED, 1.3 * Math.max(0, ...VEHICLES.map((v) => +v.maxSpeed || 0)));
const MOVE_BUDGET_MAX = SPEED_CAP * 2; // crédit de déplacement accumulable (m) : absorbe ~2 s de gel réseau à pleine vitesse
const TELEPORT_MIN_MS = 1500; // au plus une téléportation (réapparition, garage, GPS rapide) par intervalle
const FLOOD_DROPS = 300; // messages consécutifs au-delà du débit autorisé avant de couper la connexion
const HELLO_TIMEOUT_MS = 10000;
const ACCOUNT_KEEP_MS = 5 * 60 * 1000; // compte gardé en mémoire après déconnexion (reprise de session, mission en cours)
const LEADERBOARD_SIZE = 20; // lignes du classement (plus tout joueur connecté absent du top)
const MEMBERS_KEPT = 60; // membres mémorisés par salle pour le classement

// ---- contrat v6
const CLASSES = ['v', 's']; // catégories de records : Ville, Sport
const RECORDS_KEPT = 3; // podium de salle par mission et par catégorie
const FEED_KEPT = 40, FEED_WELCOME = 12; // gazette : entrées gardées par salle, entrées envoyées à l'accueil
const JOURNAL_TICK_MS = 15000; // S.JOURNAL pour les kilomètres : au plus toutes les 15 s par connexion
const DIST_FLUSH_M = 20; // la distance mesurée est reportée dans le profil par paquets (jamais de sauvegarde par état)
const DARE_STAKES = [0, 500, 2000];
const DARE_OPEN_MS = 90000, DARE_COUNTDOWN_MS = 4000, DARE_RUN_MS = 240000, DARE_TICK_MS = 500;
const DARE_MIN_M = 900, DARE_MAX_M = 2000, DARE_FINISH_R = 35, DARE_JOIN_M = 80, DARE_START_M = 120;
const HEAT_KEEP_MS = 10 * 60 * 1000; // un avis de recherche vaut 10 min
const HEAT_ANNOUNCE_MS = 3 * 60 * 1000; // au plus une annonce par joueur toutes les 3 min
const ESCAPE_MIN_SEC = 8, ESCAPE_MAX_SEC = 600, ESCAPE_SLACK_SEC = 2;
// record de cavale de la SALLE : en plus, chemin mesuré par le serveur depuis l'avis de recherche >= 110 m, et durée du
// serveur qui couvre la durée déclarée (à 0,5 s près : gigue réseau entre les deux messages) ; il tient 7 jours.
const ESCAPE_RECORD_MIN_M = 110, ESCAPE_RECORD_SLACK_SEC = 0.5, CAVALE_KEEP_MS = 7 * 24 * 3600 * 1000;
const BUMP_RANGE_M = 15, BUMP_MIN_SPEED = 2, BUMP_PAIR_MS = 20000;
const STYLE_DAY_MIN = 2000; // combo minimal pour prendre le « combo du jour » de la salle
const STYLE_DAY_PER_SEC = 600; // combo retenu pour le « combo du jour » : au plus 600 points par seconde de fenêtre serveur
const STYLE_FEED_MS = 10 * 60 * 1000; // au plus une entrée de gazette 'style' par salle sur cette durée
const COMBO_ANNOUNCE_MIN = 5000, COMBO_ANNOUNCE_MS = 60000;
// hello par adresse : rafale d'une salle pleine (toute une classe derrière la même adresse), puis un toutes les 2 s
const HELLO_BURST = 40, HELLO_PER_SEC = 0.5;
const DARE_HOLD_TEXT = "Terminez d'abord votre Chiche.";
// Salles publiques (sans code d'invitation) : la salle de la ville (« paris », « toulouse ») déborde dans « paris-2 »,
// « paris-3 »… au lieu de refuser le 33e joueur. Au-delà de la dernière instance, refus 'server_full'.
const ROOM_INSTANCES_MAX = 99;
const SERVER_FULL_TEXT = 'Serveur complet pour le moment : réessayez dans quelques minutes.';
// Connexions au-delà de maxConnections : jusqu'à cette marge, la socket est acceptée le temps de dire « serveur complet »
// (un refus HTTP 503 est indiscernable d'un serveur éteint pour le navigateur) ; au-delà, 503 brut.
const FULL_NOTICE_MAX = 64;
// Chat : 5 messages d'affilée puis 1 toutes les 2 s (seau du COMPTE), même message répété refusé pendant 15 s,
// 3 messages filtrés en 2 min = chat coupé 2 min.
const CHAT_REPEAT_MS = 15000, CHAT_STRIKES = 3, CHAT_STRIKE_MS = 120000, CHAT_MUTE_MS = 120000;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
/** Nom de remplacement d'un pseudo refusé : « JoueurNNNN » dérivé de l'id du compte, donc le même à chaque connexion. */
const stableGuestName = (id) => 'Joueur' + (1000 + (parseInt(sha256(String(id)).slice(0, 8), 16) % 9000));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const r1 = (v) => Math.round(v * 10) / 10;
const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const fmt = eco.fmtMoney; // « Ƶ 1 234 » (un gain s'écrit « +Ƶ 1 234 »)
/** « d'Alice », « de Bob », « d'Yvan », « de Yann » : élision devant un pseudo (même règle que les lots gameplay et ui). */
const ofName = (name) => (/^([aeiouàâäéèêëîïôöùûüh]|y(?![aeiouéè]))/i.test(name) ? "d'" : 'de ') + name;
/** Erreur en UNE ligne pour le journal : message et premier appel de la pile (jamais la pile entière). */
const oneLine = (e) => `${e?.name || 'Erreur'}: ${e?.message ?? e}` + (typeof e?.stack === 'string' ? ` ${(e.stack.split('\n')[1] || '').trim()}` : '');
/** Durée « 2:14,3 » (dixièmes) pour les lignes système et la gazette. */
function fmtSec(sec) {
  const d = Math.max(0, Math.round(sec * 10)), s = Math.floor(d / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')},${d % 10}`;
}

// « près de la Tour Eiffel », « près de l'Arc de Triomphe » : article deviné sur le premier mot du nom du monument
// (table générique, aucune ville supposée). Nom inconnu : « près de <nom> ».
const GENDER = {
  f: ['Tour', 'Pyramide', 'Cour', 'Colonne', 'Conciergerie', 'Gare', 'Bourse', 'Flamme', 'Statue', 'Place', 'Basilique', 'Cathédrale', 'Médiathèque', 'Halle', 'Cité', 'Fontaine'],
  m: ['Panthéon', 'Grand', 'Trocadéro', 'Centre', 'Musée', 'Palais', 'Palais-Royal', 'Petit', 'Printemps', 'Moulin', 'Capitole', 'Couvent', 'Dôme', 'Stadium', 'Zénith', 'Stade', 'Château', 'Tarmac', 'Monument', 'Jardin', 'Sacré-Cœur'],
  e: ['Arc', 'Obélisque', 'Opéra', 'Hôtel', 'Hôtel-Dieu', 'Institut', 'Aéroport', 'École', 'Église'],
  p: ['Galeries'],
};
const ARTICLE = { f: 'de la ', m: 'du ', e: "de l'", p: 'des ' };
const FIRST_WORD = new Map(Object.entries(GENDER).flatMap(([g, words]) => words.map((w) => [w, g])));
function ofPlace(name) {
  const s = String(name);
  if (s.startsWith('La ')) return 'de la ' + s.slice(3);
  if (s.startsWith('Le ')) return 'du ' + s.slice(3);
  if (s.startsWith('Les ')) return 'des ' + s.slice(4);
  if (s.startsWith("L'")) return "de l'" + s.slice(2);
  const g = FIRST_WORD.get(s.split(/[ ,(]/)[0]);
  if (g) return ARTICLE[g] + s;
  return (/^[AEIOUYÀÂÉÈÊÎÔÛ]/.test(s) ? "d'" : 'de ') + s;
}
const MASCULINE_CARS = new Set(['taxi', 'tesla_cybertruck', 'porsche_cayenne', 'lambo_urus']);
const carArticle = (typeId) => (MASCULINE_CARS.has(typeId) ? 'un' : 'une');
const missionTitle = (id) => (MISSIONS.ALL_MISSION_BY_ID || MISSIONS.MISSION_BY_ID || {})[id]?.title || id;
const levelTitle = (lv) => (CORE.LEVELS || [])[lv - 1]?.title || `niveau ${lv}`;
const nth = (n) => (n > 1 ? `${n}e` : 'première');

/** Phrase prête à afficher d'une entrée de gazette (champ `x` ajouté à l'envoi, jamais stocké). */
export function feedText(e) {
  switch (e.k) {
    case 'record': {
      const tail = `sur « ${missionTitle(e.m)} » (${fmtSec(e.d)}, ${e.c === 's' ? 'Sport' : 'Ville'})`; // la catégorie : un temps Sport ne se bat pas en Ville
      return e.pn ? `${e.n} bat le record ${ofName(e.pn)} ${tail}` : `${e.n} signe le record de salle ${tail}`;
    }
    case 'buy': return `${e.n} a acheté « ${e.d} »`;
    case 'sell': return `${e.n} a vendu « ${e.d} »`;
    case 'car': return `${e.n} s'offre ${carArticle(e.m)} ${e.d}`;
    case 'level': return e.st ? `${e.n} décroche sa ${nth(e.st)} étoile de Légende` : `${e.n} passe niveau ${e.d} — ${levelTitle(e.d)}`;
    case 'dare': return `${e.n} gagne un Chiche` + (e.d > 0 ? ` (+${fmt(e.d)})` : '');
    case 'cavale': return `${e.n} sème les képis en ${fmtSec(e.d)} : record de cavale`;
    case 'streak': return `${e.n} enchaîne ${e.d} jours de défis`;
    case 'style': return `Combo du jour : ${e.n}, ${fmtInt(e.d)} points`;
    default: return '';
  }
}
const feedOut = (e) => ({ ...e, x: feedText(e) });

/**
 * Clé d'une salle, en mémoire comme en persistance. Une salle appartient à une ville : Paris garde le code nu
 * (compatibilité avec les salles enregistrées avant le multi-villes), les autres villes sont préfixées
 * (« toulouse:<code> »). Un code de salle ne contient jamais « : » (sanitizeRoom) : aucune collision possible.
 */
export const roomKey = (city, code) => (city === DEFAULT_CITY ? code : `${city}:${code}`);

/**
 * Numéro d'instance d'une salle PUBLIQUE : 1 pour la salle de la ville (code = id de la ville : « paris »,
 * « toulouse »), n pour « <ville>-n » (2 ≤ n ≤ 99) ; 0 pour une salle privée (code d'invitation saisi).
 */
export function roomInstance(city, code) {
  if (code === city) return 1;
  const m = /^(.+)-([2-9]|[1-9][0-9])$/.exec(code);
  return m && m[1] === city ? +m[2] : 0;
}
export const instanceCode = (city, n) => (n === 1 ? city : `${city}-${n}`);

/** Podium lu en persistance -> liste saine [{ id, name, sec, at }], triée, une entrée par joueur, 3 au plus. */
function cleanTop(list) {
  const out = [], seen = new Set();
  for (const e of Array.isArray(list) ? list : []) {
    if (!isObj(e) || typeof e.id !== 'string' || !Number.isFinite(e.sec) || !(e.sec > 0) || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ id: e.id, name: String(e.name ?? '').slice(0, eco.NAME_MAX), sec: r1(e.sec), at: Number.isFinite(e.at) ? e.at : 0 });
  }
  out.sort((a, b) => a.sec - b.sec || a.at - b.at);
  return out.slice(0, RECORDS_KEPT);
}

/**
 * Défauts d'un document de salle (rooms/<clé>) : une salle enregistrée avant le contrat v6 n'a ni records, ni gazette,
 * ni record de cavale, ni combo du jour, et ses membres sont { name, money } (lus tels quels : worth absent = money).
 */
export function normalizeRoomRecord(rec, t) {
  rec.owners = isObj(rec.owners) ? rec.owners : {};
  rec.members = isObj(rec.members) ? rec.members : {};
  const records = {};
  for (const [id, r] of Object.entries(isObj(rec.records) ? rec.records : {})) {
    if (!eco.missionTimed(id) || !isObj(r)) continue; // mission retirée du contenu, ou mission photo
    const out = {};
    for (const cls of CLASSES) { const top = cleanTop(r[cls]); if (top.length) out[cls] = top; }
    if (out.v || out.s) records[id] = out;
  }
  rec.records = records;
  rec.feed = (Array.isArray(rec.feed) ? rec.feed : []).filter((e) => isObj(e) && Number.isFinite(e.t) && typeof e.k === 'string').slice(-FEED_KEPT);
  const c = rec.cavale;
  // le record de cavale tient 7 jours : une valeur plancher (8,0 s) ne gèle pas la salle à vie
  rec.cavale = isObj(c) && typeof c.id === 'string' && Number.isFinite(c.sec) && c.sec >= ESCAPE_MIN_SEC && t - (+c.at || 0) < CAVALE_KEEP_MS
    ? { id: c.id, name: String(c.name ?? ''), sec: c.sec, at: +c.at || 0 } : null;
  const d = rec.styleDay;
  rec.styleDay = isObj(d) && d.k === J.dayKey(t) && typeof d.id === 'string' && d.pts > 0 ? { k: d.k, id: d.id, name: String(d.name ?? ''), pts: Math.floor(d.pts) } : null;
  return rec;
}

/**
 * @param {{ store, now?, log?, rentIntervalMs?, maxConnections?, rand?, helloBurst?: number }} opts
 *   helloBurst : hello admis en rafale depuis une même adresse (puis un toutes les 2 s) ; 0 ou Infinity = sans limite
 *   (variable HELLO_BURST ; à désactiver derrière un répartiteur qui présenterait tous les joueurs sous une seule adresse).
 */
export function createGame({ store, now = Date.now, log = () => {}, rentIntervalMs = 60000, maxConnections = +(process.env.MAX_CONNECTIONS || 1000), rand = Math.random,
  helloBurst = +(process.env.HELLO_BURST || HELLO_BURST) } = {}) {
  // clé (roomKey) -> { key, code, city, bounds, record: { code: clé, city, room, owners, members, records, feed, cavale, styleDay },
  //                    conns: Map(playerId -> conn), lbDirty, dare (volatil), bumps: Map(paire -> ms),
  //                    keep (la salle vaut d'être écrite : déjà enregistrée, ou un compte y a fait quelque chose) }
  const rooms = new Map();
  const roomLoads = new Map();
  // id -> { profile, session: { mission, job, jobLast, heat, hold }, limits: { dareBucket, heatAnnAt, comboAnnAt }, conn, evictAt, fresh }
  //   session.heat = avis de recherche { k, at, moved } ; session.hold = mise retenue par un Chiche en cours (0 sinon)
  //   limits = débits et délais d'annonce qui suivent le COMPTE (une reconnexion ne les remet pas à neuf)
  //   fresh = compte créé à ce hello et qui n'a encore rien fait : pas écrit dans le store
  const accounts = new Map();
  const accountLoads = new Map();
  const conns = new Set();
  const helloBuckets = new Map(); // adresse -> { bucket, at } : débit des hello par adresse (comptes invités créés à la chaîne)
  const helloLimited = Number.isFinite(helloBurst) && helloBurst > 0;
  let wss = null, stopped = false, dareSeq = 0;
  const timers = [];
  const newSession = () => ({ mission: null, job: null, jobLast: null, heat: null, hold: 0 });
  const newLimits = () => ({ dareBucket: eco.createBucket(2, 1 / 30), heatAnnAt: -Infinity, comboAnnAt: -Infinity,
    chatBucket: eco.createBucket(5, 0.5), chatLast: '', chatLastAt: -Infinity, chatHits: [], chatMuteUntil: 0 });
  let fullNotices = 0; // sockets acceptées au-delà de maxConnections, le temps de dire « serveur complet »

  // ------------------------------------------------------------------ comptes

  function tokenMatches(profile, secret) {
    const a = Buffer.from(sha256(secret)), b = Buffer.from(String(profile.tokenHash || ''));
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async function fetchAccount(id) {
    if (accounts.has(id)) return accounts.get(id);
    if (!accountLoads.has(id)) {
      accountLoads.set(id, (async () => {
        try {
          const rec = await store.getPlayer(id);
          if (!rec) return null;
          if (accounts.has(id)) return accounts.get(id);
          const account = { profile: eco.normalizeProfile(rec), session: newSession(), limits: newLimits(), conn: null, evictAt: now() + ACCOUNT_KEEP_MS, fresh: false };
          accounts.set(id, account);
          return account;
        } finally { accountLoads.delete(id); }
      })());
    }
    return accountLoads.get(id);
  }

  /** Jeton « id.secret » -> compte existant, sinon nouveau compte invité (le secret n'est stocké que haché). */
  async function resolveAccount(token, name) {
    if (typeof token === 'string' && token.length <= 128) {
      const m = /^(p[0-9a-f]{16})\.([A-Za-z0-9_-]{20,64})$/.exec(token);
      if (m) {
        const account = await fetchAccount(m[1]);
        if (account && tokenMatches(account.profile, m[2])) {
          // compte sans connexion rendu à un hello : son expiration repart de maintenant. Sans cela le balayage de
          // tickHeartbeat pouvait le retirer de la table PENDANT ce hello (lecture de la salle en cours) ; le hello
          // suivant relisait alors le profil dans le store : deux copies vivantes du même compte, deux soldes.
          if (!account.conn) account.evictAt = now() + ACCOUNT_KEEP_MS;
          return { account, token: null };
        }
      }
    }
    const id = 'p' + randomBytes(8).toString('hex');
    const secret = randomBytes(24).toString('base64url');
    const profile = eco.newProfile(id, name);
    profile.tokenHash = sha256(secret);
    profile.createdAt = now();
    const account = { profile, session: newSession(), limits: newLimits(), conn: null, evictAt: now() + ACCOUNT_KEEP_MS, fresh: true };
    accounts.set(id, account);
    return { account, token: `${id}.${secret}` };
  }

  /**
   * Fiche du joueur dans le classement de la salle : { name, money, worth, lvl, st, seenAt }. Le classement n'est
   * rediffusé (lbDirty) que si une valeur affichée a changé. seenAt (dernière présence) est posé au hello et au départ.
   */
  function touchMember(room, p) {
    const worth = eco.worth(p, room.record.owners), lvl = eco.levelOf(p), st = eco.starsOf(p);
    const m = room.record.members[p.id];
    if (!m) { room.record.members[p.id] = { name: p.name, money: p.money, worth, lvl, st, seenAt: 0 }; room.lbDirty = true; return; }
    if (m.money === p.money && m.name === p.name && m.worth === worth && m.lvl === lvl && m.st === st) return;
    m.name = p.name; m.money = p.money; m.worth = worth; m.lvl = lvl; m.st = st;
    room.lbDirty = true;
  }

  /**
   * Sauvegarde le profil. `op` = false au hello et au départ d'un compte qui n'a rien fait : un compte tout neuf
   * (`fresh`) n'est écrit dans le store qu'à sa première vraie opération (mission, achat, virement, course, distance
   * reportée…), sinon chaque hello sans jeton laisserait un profil pour toujours.
   */
  function saveAccount(account, op = true) {
    account.profile.lastSeen = now();
    const conn = account.conn;
    if (op && account.fresh) { account.fresh = false; if (conn?.room) conn.room.keep = true; }
    if (!account.fresh) store.putPlayer(account.profile);
    if (!conn) return;
    if (!account.fresh) conn.statsDirty = false;
    if (conn.room) touchMember(conn.room, account.profile);
  }

  // ------------------------------------------------------------------ salles

  async function fetchRoom(city, code) {
    const key = roomKey(city, code);
    if (rooms.has(key)) return rooms.get(key);
    if (!roomLoads.has(key)) {
      roomLoads.set(key, (async () => {
        try {
          const stored = await store.getRoom(key);
          const rec = stored || { code: key, createdAt: now() };
          if (rooms.has(key)) return rooms.get(key);
          rec.code = key; // clé de persistance (inchangée pour les salles de Paris déjà enregistrées)
          rec.city = city; rec.room = code; // ajouts : ville de la salle et code saisi par les joueurs
          normalizeRoomRecord(rec, now());
          const room = { key, code, city, bounds: geoFor(city).BOUNDS, record: rec, conns: new Map(), lbDirty: false, dare: null, bumps: new Map(), keep: !!stored };
          rooms.set(key, room);
          return room;
        } finally { roomLoads.delete(key); }
      })());
    }
    return roomLoads.get(key);
  }

  /** Salle chargée pour rien (vide, pas retenue) : rendue à la mémoire (un hello concurrent qui l'a retenue la remet). */
  function dropIfEmpty(room) { if (!room.conns.size && rooms.get(room.key) === room) rooms.delete(room.key); }

  /**
   * Instance publique où placer ce joueur (`want` = numéro demandé par le client). Ordre de préférence :
   *   1. la salle de sa connexion encore ouverte (reconnexion avant détection de la coupure) : sa place y est déjà ;
   *   2. l'instance demandée (le client renvoie celle de son accueil à chaque reconnexion ; lien d'un ami), puis la
   *      dernière instance jouée (profile.inst), si elle a de la place ET qu'elle est animée ou que le joueur y
   *      possède des biens (ses loyers y courent) : on ne renvoie personne seul dans une instance vide ;
   *   3. l'instance animée (au moins un joueur) la plus basse qui a de la place ; à défaut la première instance vide :
   *      paris, paris-2, paris-3… (une instance non chargée est vide).
   * Charge au plus 3 salles. null : toutes les instances sont pleines. Le résultat est à revérifier par l'appelant
   * (d'autres hello ont pu s'y glisser pendant la lecture du store).
   */
  async function pickPublicRoom(city, want, account) {
    const p = account.profile, cur = account.conn?.room;
    const fits = (r) => r.conns.size < MAX_PLAYERS_PER_ROOM || r === cur;
    if (cur && cur.city === city && roomInstance(city, cur.code)) return cur;
    const last = Math.floor(+(isObj(p.inst) ? p.inst[city] : 0) || 0);
    const tried = new Set([1]);
    for (const n of [want, last]) {
      if (!(n >= 2 && n <= ROOM_INSTANCES_MAX) || tried.has(n)) continue;
      tried.add(n);
      const r = await fetchRoom(city, instanceCode(city, n));
      if (fits(r) && (r.conns.size > 0 || eco.ownedProperties(r.record.owners, p.id).length > 0)) return r;
      dropIfEmpty(r);
    }
    // d'abord l'instance animée la plus basse qui a de la place (paris pleine, paris-2 vidée, paris-3 à 20 : paris-3,
    // pas seul en paris-2) ; sinon la première instance vide, chargée ou non
    for (let n = 1; n <= ROOM_INSTANCES_MAX; n++) {
      const r = rooms.get(roomKey(city, instanceCode(city, n)));
      if (r && r.conns.size > 0 && fits(r)) return r;
    }
    for (let n = 1; n <= ROOM_INSTANCES_MAX; n++) {
      const r = rooms.get(roomKey(city, instanceCode(city, n)));
      if (!r) return fetchRoom(city, instanceCode(city, n));
      if (fits(r)) return r;
    }
    return null;
  }

  const memberWorth = (m) => (Number.isFinite(m.worth) ? m.worth : +m.money || 0); // fiche d'avant le contrat v6 : worth absent = money

  /** Écrit la salle, sauf si elle n'a jamais rien contenu (code inédit où ne sont passés que des comptes tout neufs). */
  function saveRoom(room) {
    if (!room.keep) return;
    const members = room.record.members, ids = Object.keys(members);
    if (ids.length > MEMBERS_KEPT) {
      ids.sort((a, b) => memberWorth(members[b]) - memberWorth(members[a]));
      for (const id of ids.slice(MEMBERS_KEPT)) if (!room.conns.has(id)) delete members[id];
    }
    store.putRoom(room.record);
  }

  /** Classement par fortune totale : les 20 premières lignes PLUS tout joueur connecté absent du top. rec = records de salle détenus. */
  function leaderboard(room) {
    const held = new Map();
    for (const r of Object.values(room.record.records)) {
      for (const cls of CLASSES) { const top = r[cls]?.[0]; if (top) held.set(top.id, (held.get(top.id) || 0) + 1); }
    }
    const rows = Object.entries(room.record.members).map(([id, m]) => ({
      id, name: m.name, money: m.money, online: room.conns.has(id), worth: memberWorth(m), lvl: m.lvl || 1, st: m.st || 0, rec: held.get(id) || 0,
    }));
    rows.sort((a, b) => b.worth - a.worth);
    return rows.filter((r, i) => i < LEADERBOARD_SIZE || r.online);
  }

  // ------------------------------------------------------------------ envois

  function send(conn, type, payload) { if (conn.ws.readyState === 1) conn.ws.send(encode(type, payload)); }
  function broadcast(room, type, payload, except = null) {
    const msg = encode(type, payload);
    for (const c of room.conns.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(msg);
  }
  const system = (room, text, except = null) => broadcast(room, S.CHAT, { from: 'Système', text, system: true }, except);
  const sendError = (conn, op, res) => send(conn, S.ERROR, { op, code: res.code, text: res.text });
  function sendProfile(conn, delta, reason) {
    const p = conn.account.profile, room = conn.room;
    const payload = { me: eco.publicProfile(p, eco.ownedProperties(room.record.owners, p.id), room.city) };
    if (delta) { payload.delta = delta; payload.reason = reason; }
    send(conn, S.PROFILE, payload);
  }
  function reject(conn, code, text) {
    send(conn, S.ERROR, { op: C.HELLO, code, text, fatal: true });
    conn.ws.close(CLOSE.REJECTED, code);
  }
  /** Ce que la salle voit d'un joueur au-delà du pseudo : niveau, étoiles de Légende, klaxon. */
  const lookOf = (p) => ({ id: p.id, lvl: eco.levelOf(p), st: eco.starsOf(p), look: { h: p.look?.h || eco.DEFAULT_HORN } });
  const sendLook = (room, p) => broadcast(room, S.LOOK, lookOf(p));

  // ------------------------------------------------------------------ gazette

  /** Ajoute un fait à la gazette de la salle (40 gardés), le diffuse en direct et sauvegarde la salle. Retourne l'entrée. */
  function feed(room, fact) {
    const e = { t: now(), ...fact };
    const list = room.record.feed;
    room.keep = true;
    list.push(e);
    if (list.length > FEED_KEPT) list.splice(0, list.length - FEED_KEPT);
    broadcast(room, S.FEED, { e: feedOut(e) });
    saveRoom(room);
    return e;
  }
  /** Gazette de l'accueil : faits des AUTRES depuis la dernière présence du joueur, 12 au plus (les plus récents). */
  function feedSince(room, playerId, seenAt) {
    const out = [];
    for (const e of room.record.feed) if (e.id !== playerId && e.t > seenAt) out.push(feedOut(e));
    return out.slice(-FEED_WELCOME);
  }

  // ------------------------------------------------------------------ carnet de bord

  function kmHave(j) { for (const e of j.list) if (e.kind === 'km') return e.have; return -1; }
  function noteJournal(conn, j) { conn.journalDirty = false; conn.daySent = j.day; conn.kmSent = kmHave(j); }
  const journalOf = (conn, t) => J.publicJournal(conn.account.profile, t, conn.room.city, conn.room.record.owners, conn.room.key);
  function sendJournal(conn) {
    const j = journalOf(conn, now());
    noteJournal(conn, j);
    send(conn, S.JOURNAL, { j });
  }

  /**
   * Défis de la veille : réussis mais pas réclamés avant 4 h, ils ont été soldés d'office à la bascule (journal.rollDay).
   * Crédit, S.PROFILE (motif 'défis de la veille') ; la série qui avance est annoncée comme pour une réclamation.
   */
  function payDue(conn) {
    const p = conn.account.profile;
    if (!(p.journal?.due > 0)) return false;
    const res = eco.settleDue(p);
    if (!res.ok) return false;
    saveAccount(conn.account);
    sendProfile(conn, res.delta, res.reason);
    announceStreak(conn, res);
    return true;
  }
  function announceStreak(conn, res) {
    if (!res.streakUp || !(res.streak.n >= 2)) return;
    const p = conn.account.profile;
    system(conn.room, `${p.name} enchaîne ${res.streak.n} jours de défis !`, conn);
    feed(conn.room, { k: 'streak', id: p.id, n: p.name, d: res.streak.n });
  }

  /** Reporte dans le profil la distance mesurée depuis le dernier report (statistique et compteur du jour). */
  function flushDistance(conn, t) {
    const d = conn.distAcc;
    if (!(d > 0)) return;
    conn.distAcc = 0;
    const p = conn.account.profile;
    p.stats.distance = (p.stats.distance || 0) + d;
    J.count(p, 'km', d, t);
    conn.journalDirty = true; conn.statsDirty = true;
  }

  // ------------------------------------------------------------------ records de salle

  const holder = (e) => (e ? { id: e.id, name: e.name, sec: e.sec } : null);
  /** Détenteurs par mission et par catégorie : { missionId: { v?: { id, name, sec }, s?: … } } (S.WELCOME.records). */
  function recordsView(room) {
    const out = {};
    for (const [id, r] of Object.entries(room.record.records)) {
      const row = {};
      for (const cls of CLASSES) if (r[cls]?.[0]) row[cls] = holder(r[cls][0]);
      out[id] = row;
    }
    return out;
  }
  /**
   * Inscrit un temps au podium de salle (une entrée par joueur et par catégorie, tri croissant, 3 gardés).
   * @returns {{ changed, rank (place de CE temps, 0 s'il n'entre pas), prev (détenteur détrôné | null), top }}
   */
  function roomRecord(room, missionId, cls, p, sec, t) {
    const all = room.record.records, row = all[missionId] || {}, top = row[cls] || [];
    const before = top[0] || null, mine = top.findIndex((e) => e.id === p.id);
    const entry = { id: p.id, name: p.name, sec, at: t };
    let changed = false;
    if (mine >= 0) { if (sec < top[mine].sec) { top[mine] = entry; changed = true; } }
    else if (top.length < RECORDS_KEPT || sec < top[top.length - 1].sec) { top.push(entry); changed = true; }
    if (!changed) return { changed, rank: 0, prev: null, top };
    top.sort((a, b) => a.sec - b.sec || a.at - b.at);
    if (top.length > RECORDS_KEPT) top.length = RECORDS_KEPT;
    row[cls] = top; all[missionId] = row;
    const rank = top.indexOf(entry) + 1;
    return { changed, rank, prev: rank === 1 && before && before.id !== p.id ? holder(before) : null, top };
  }
  /** Un joueur qui change de pseudo garde ses records, son record de cavale et son combo du jour à son nouveau nom. */
  function renameInRoom(room, id, name) {
    const rec = room.record;
    for (const k of eco.ownedProperties(rec.owners, id)) rec.owners[k].name = name;
    for (const r of Object.values(rec.records)) for (const cls of CLASSES) for (const e of r[cls] || []) if (e.id === id) e.name = name;
    if (rec.cavale?.id === id) rec.cavale.name = name;
    if (rec.styleDay?.id === id) rec.styleDay.name = name;
  }
  /** Record de cavale de la salle : il tient 7 jours (à la lecture). */
  function cavaleOf(room, t) {
    const c = room.record.cavale;
    if (c && t - c.at >= CAVALE_KEEP_MS) room.record.cavale = null;
    return room.record.cavale;
  }
  /** Combo du jour de la salle, remis à zéro au changement de jour (à la lecture). */
  function styleDayOf(room, t) {
    const d = room.record.styleDay;
    if (d && d.k !== J.dayKey(t)) room.record.styleDay = null;
    return room.record.styleDay;
  }

  // ------------------------------------------------------------------ connexion

  /** Débit des hello par adresse. Refus NON fatal (code 4003) : le client réessaie de lui-même un peu plus tard. */
  function helloAllowed(conn, t) {
    if (!helloLimited || !conn.ip) return true;
    let e = helloBuckets.get(conn.ip);
    if (!e) helloBuckets.set(conn.ip, (e = { bucket: eco.createBucket(helloBurst, HELLO_PER_SEC), at: t }));
    e.at = t;
    return e.bucket.take(t);
  }

  async function onHello(conn, m) {
    if (!helloAllowed(conn, now())) {
      send(conn, S.ERROR, { op: C.HELLO, code: 'rate', text: 'Trop de connexions depuis cette adresse : nouvel essai dans un instant.' });
      conn.ws.close(CLOSE.FLOOD, 'rate');
      return;
    }
    if (m.v !== PROTOCOL_VERSION) return reject(conn, 'version', 'Version du jeu obsolète : rechargez la page.');
    const city = sanitizeCity(m.city); // absent (client d'avant le multi-villes) ou inconnu : Paris
    const want = eco.sanitizeRoom(m.room);
    const inst = roomInstance(city, want); // 0 = salle privée (code d'invitation) ; sinon salle publique, à répartir
    let name = eco.sanitizeName(m.name);
    const badName = hasProfanity(name);
    if (badName) name = 'Joueur'; // provisoire : remplacé ci-dessous par un nom stable une fois le compte connu
    const { account, token } = await resolveAccount(m.token, name);
    // pseudo injurieux : nom déjà en profil s'il est propre, sinon JoueurNNNN dérivé de l'id (le même à chaque
    // connexion : le client renvoie son pseudo enregistré à chaque hello, le joueur ne doit pas changer de nom)
    if (badName) name = account.profile.name !== 'Joueur' && !hasProfanity(account.profile.name) ? account.profile.name : stableGuestName(account.profile.id);
    let room = null;
    if (!inst) room = await fetchRoom(city, want);
    else {
      // répartiteur : la salle retenue est revérifiée ici, sans attente jusqu'à l'inscription du joueur
      // rafale de hello (pic d'arrivées pendant une lecture du store) : chaque passe ne fait entrer que la place libre
      // de la salle choisie ; les suivants repassent et vont plus loin (paris pleine → paris-2 → paris-3…). On boucle
      // tant que le répartiteur propose une autre salle, borné par le nombre d'instances.
      let prev = null;
      for (let tries = 0; tries <= ROOM_INSTANCES_MAX + 1 && !room; tries++) {
        const r = await pickPublicRoom(city, inst, account);
        if (conn.closed || stopped) return;
        if (!r || r === prev) break; // tout est plein, ou plus de progrès
        if (r.conns.size < MAX_PLAYERS_PER_ROOM || r === account.conn?.room) room = r;
        prev = r;
      }
      if (!room) return reject(conn, 'server_full', SERVER_FULL_TEXT);
    }
    if (conn.closed || stopped) return;
    const code = room.code, key = room.key;
    // ceinture : le compte de CE hello doit être celui de la table (jamais deux copies vivantes du même compte)
    const known = accounts.get(account.profile.id);
    if (!known) accounts.set(account.profile.id, account);
    else if (known !== account) return reject(conn, 'server', 'Erreur du serveur, réessayez.');

    // même compte déjà connecté (autre onglet, reconnexion avant détection de la coupure) : l'ancien est remplacé
    if (account.conn) {
      const old = account.conn;
      send(old, S.ERROR, { op: C.HELLO, code: 'replaced', text: 'Session ouverte ailleurs avec ce compte.', fatal: true });
      detach(old);
      old.ws.close(CLOSE.REPLACED, 'replaced');
    }
    if (!rooms.has(key)) rooms.set(key, room); // la salle a pu être libérée entre-temps (chargement, remplacement)
    if (room.conns.size >= MAX_PLAYERS_PER_ROOM) {
      if (!room.conns.size) rooms.delete(key);
      if (inst) return reject(conn, 'server_full', SERVER_FULL_TEXT);
      return reject(conn, 'room_full', `La salle « ${code} » est pleine (${MAX_PLAYERS_PER_ROOM} joueurs) : choisissez un autre code, ou jouez sans code.`);
    }
    // unicité du pseudo dans la salle
    const taken = new Set([...room.conns.values()].map((c) => c.account.profile.name.toLowerCase()));
    if (taken.has(name.toLowerCase())) {
      for (let i = 2; i < 100; i++) {
        const cand = name.slice(0, eco.NAME_MAX - String(i).length) + i;
        if (!taken.has(cand.toLowerCase())) { name = cand; break; }
      }
    }
    const p = account.profile, t = now(), owners = room.record.owners;
    p.name = name;
    renameInRoom(room, p.id, name);
    account.session.job = null; // une course de taxi ne survit pas à une coupure (le client l'annonce)
    if (account.session.mission) account.session.mission.moved = null; // mission conservée : le chemin de la coupure n'a pas été mesuré
    if (!account.fresh) room.keep = true;
    if (inst) p.inst = { ...(isObj(p.inst) ? p.inst : {}), [city]: roomInstance(city, code) }; // dernière instance publique jouée

    // carnet de bord : bascule de jour, puis relevé du matin calculé AVANT toute réécriture de rentAt
    const fresh = J.rollDay(p, t) || !!token;
    const away = J.awayRent(p, owners, room.key, t);
    const seenAt = +room.record.members[p.id]?.seenAt || 0;

    conn.account = account; conn.room = room; conn.accrueAt = t; conn.styleAt = t;
    account.conn = conn; account.evictAt = 0;
    room.conns.set(p.id, conn);
    saveAccount(account, false);
    room.record.members[p.id].seenAt = t;
    room.lbDirty = true; // un membre qui revient, même avec le même solde, repasse « en ligne » chez les autres
    clearTimeout(conn.helloTimer);

    const journal = journalOf(conn, t), cavale = cavaleOf(room, t), day = styleDayOf(room, t), best = {};
    noteJournal(conn, journal);
    for (const id of Object.keys(p.best)) if (eco.cityOfMission(id) === city) best[id] = p.best[id];
    const payload = {
      v: PROTOCOL_VERSION, id: p.id, room: code, city, ts: t,
      me: eco.publicProfile(p, eco.ownedProperties(owners, p.id), city),
      players: [...room.conns.values()].filter((c) => c !== conn).map((c) => ({ name: c.account.profile.name, ...lookOf(c.account.profile) })),
      owners, lb: leaderboard(room),
      mission: account.session.mission?.id || null,
      feat: FEATS, fresh, best, records: recordsView(room), journal,
      // relevé annoncé seulement quand CE hello y a ajouté quelque chose (une simple reconnexion ne le rouvre pas ;
      // le relevé non encaissé reste visible dans journal.away)
      away: away && away.added > 0 ? { sec: away.sec, rent: away.rent, props: away.props } : null,
      feed: feedSince(room, p.id, seenAt),
      dare: dareView(room, t),
      cavale: cavale ? { id: cavale.id, name: cavale.name, sec: cavale.sec } : null,
      styleDay: day ? { id: day.id, name: day.name, pts: day.pts } : null,
    };
    if (token) payload.token = token;
    send(conn, S.WELCOME, payload);
    broadcast(room, S.JOIN, { name, ...lookOf(p) }, conn);
    payDue(conn); // défis de la veille soldés à la bascule : crédités APRÈS l'accueil, pour que le client annonce le gain
    log(`[salle ${key}] + ${name} (${room.conns.size} joueur(s))`);
  }

  /** Retire une connexion de sa salle (fermeture, remplacement). */
  function detach(conn, silent = false) {
    if (conn.closed) return;
    conn.closed = true;
    clearTimeout(conn.helloTimer);
    conns.delete(conn);
    const { account, room } = conn;
    if (!account || account.conn !== conn) return;
    const p = account.profile, t = now();
    flushDistance(conn, t);
    eco.accrue(p, room.record.owners, (t - conn.accrueAt) / 1000, { now: t, roomKey: room.key });
    const facts = room.record.feed, lastFact = facts[facts.length - 1];
    dareDrop(room, p.id, t); // retrait d'un Chiche ouvert, forfait d'un Chiche lancé
    account.session.job = null;
    saveAccount(account, conn.statsDirty); // un compte tout neuf qui n'a rien fait n'est pas écrit
    // dernière présence. Si ce départ a lui-même écrit un fait (forfait : « X gagne un Chiche », horodaté t), elle est
    // posée une milliseconde plus tôt : la gazette du retour ne garde que les faits postérieurs à seenAt, et le
    // perdant doit y trouver celui-là.
    if (room.record.members[p.id]) room.record.members[p.id].seenAt = facts[facts.length - 1] !== lastFact ? t - 1 : t;
    account.conn = null;
    account.evictAt = t + ACCOUNT_KEEP_MS;
    room.conns.delete(p.id);
    room.lbDirty = true;
    if (!silent) broadcast(room, S.LEAVE, { id: p.id, name: p.name }); // l'annonce « X est parti » est affichée par le client
    saveRoom(room);
    if (!room.conns.size) { dareClear(room); rooms.delete(room.key); }
    log(`[salle ${room.key}] - ${p.name} (${room.conns.size} joueur(s))`);
  }

  // ------------------------------------------------------------------ synchronisation

  function onState(conn, m) {
    const s = m.s;
    if (!Array.isArray(s) || s.length < 7 || s.length > 9) return;
    for (let i = 0; i < 7; i++) if (typeof s[i] !== 'number' || !Number.isFinite(s[i])) return;
    const B = conn.room.bounds; // emprise de la ville de la salle
    const x = clamp(s[0], B.minX - BOUNDS_MARGIN, B.maxX + BOUNDS_MARGIN);
    const z = clamp(s[2], B.minZ - BOUNDS_MARGIN, B.maxZ + BOUNDS_MARGIN);
    const t = now();
    let teleported = false;
    if (conn.pos) {
      // Crédit de déplacement : SPEED_CAP mètres par seconde écoulée, plafonné. On borne ainsi la vitesse MOYENNE et
      // non l'écart entre deux messages : les états arrivent souvent groupés (gel réseau, onglet ralenti) puis à
      // quelques millisecondes d'intervalle, ce qui ne doit pas faire rejeter une voiture lancée à 350 km/h.
      conn.moveBudget = Math.min(MOVE_BUDGET_MAX, conn.moveBudget + (SPEED_CAP * Math.max(0, t - conn.moveAt)) / 1000);
      conn.moveAt = t;
      const d = Math.hypot(x - conn.pos.x, z - conn.pos.z);
      if (d > conn.moveBudget) {
        // déplacement implausible : toléré comme téléportation (réapparition, garage), mais pas en rafale
        if (t - conn.teleportAt < TELEPORT_MIN_MS) return;
        conn.teleportAt = t;
        conn.moveBudget = MOVE_BUDGET_MAX / 2;
        teleported = true;
        conn.spdAt = t; conn.spdD = 0; // une téléportation ne compte ni dans la distance ni dans la vitesse de pointe
      } else {
        conn.moveBudget -= d;
        // chemin parcouru, mesuré par le serveur : distance du profil, kilomètres du jour, fenêtre de style
        conn.distAcc += d; conn.styleMoved += d; conn.spdD += d;
        // … et chemin de la mission en cours (borne des records) et de la poursuite (record de cavale)
        const ses = conn.account.session;
        if (ses.mission && ses.mission.moved != null) ses.mission.moved += d;
        if (ses.heat) ses.heat.moved += d;
      }
      conn.pos.x = x; conn.pos.z = z;
    } else {
      conn.pos = { x, z };
      conn.moveAt = t; conn.moveBudget = MOVE_BUDGET_MAX;
      conn.spdAt = t; conn.spdD = 0;
    }
    const mode = s[5] === 1 ? 1 : 0;
    const st = [conn.account.profile.id, x, clamp(s[1], -60, 500), z, Math.round(Math.atan2(Math.sin(s[3]), Math.cos(s[3])) * 100) / 100,
      clamp(s[4], -SPEED_CAP, SPEED_CAP), mode, Number.isInteger(s[6]) && s[6] >= 0 && s[6] < ANIMS.length ? s[6] : 0];
    if (mode === 1) st.push(typeof s[7] === 'string' && Object.hasOwn(VEHICLE_BY_ID, s[7]) ? s[7] : STARTER_VEHICLE, normColor(s[8]));
    conn.state = st;

    // ---- contrat v6 : rien de ce qui suit ne sauvegarde ni n'alloue au rythme des états
    if (mode === 1) {
      // catégorie des records : un état au volant d'une voiture de sport pendant la mission la classe en Sport
      const mission = conn.account.session.mission;
      if (mission && !mission.sport && eco.classOf(st[8]) === 's') mission.sport = true;
    }
    if (t - conn.spdAt >= 1000) {
      // vitesse de pointe : min(vitesse déclarée, distance mesurée / temps, lissée sur 1 s), au volant seulement
      if (mode === 1) {
        const v = Math.min(Math.abs(st[5]), (conn.spdD * 1000) / (t - conn.spdAt)), stats = conn.account.profile.stats;
        if (v > (stats.topSpeed || 0)) { stats.topSpeed = v; conn.statsDirty = true; }
      }
      conn.spdAt = t; conn.spdD = 0;
    }
    if (conn.distAcc >= DIST_FLUSH_M) flushDistance(conn, t);
    if (conn.room.dare) dareTrack(conn, t, teleported);
  }

  function tickSnapshots() {
    const ts = now();
    for (const room of rooms.values()) {
      const p = [];
      for (const c of room.conns.values()) if (c.state) p.push(c.state);
      if (!p.length) continue;
      const msg = encode(S.SNAPSHOT, { ts, p });
      for (const c of room.conns.values()) {
        // connexion saturée : on saute l'instantané (le suivant le remplace)
        if (c.ws.readyState === 1 && c.ws.bufferedAmount < 262144) c.ws.send(msg);
      }
    }
  }

  // ------------------------------------------------------------------ Chiche
  // room.dare = { id, by: { id, name }, origin: { x, z, label }, to: { x, z, label, r }, stake,
  //               players: Map(id -> { id, name, account, out }), phase: 'open' | 'run', openUntil, startsAt, endsAt, started }
  // Un seul par salle, volatil (un redémarrage l'annule sans débit). Rien n'est débité avant la fin ; mais dès qu'un
  // joueur lance ou rejoint un Chiche à mise, la mise est RETENUE sur son compte (session.hold) jusqu'à la fin du défi
  // ou son retrait avant le départ : virement, achat de voiture ou de bien et peinture sont refusés ('busy'), pour
  // qu'il ne puisse pas vider son compte et ne rien payer s'il perd. La retenue suit le compte d'une salle à l'autre.

  function dareView(room, t) {
    const d = room.dare;
    if (!d) return null;
    const players = [];
    for (const pl of d.players.values()) if (!pl.out) players.push({ id: pl.id, name: pl.name });
    // phase 'open' : départ au plus tard à la clôture automatique + 4 s ; phase 'run' : valeurs réelles (négatives après le départ)
    const startsAt = d.phase === 'open' ? d.openUntil + DARE_COUNTDOWN_MS : d.startsAt;
    return { id: d.id, by: d.by, origin: d.origin, to: d.to, stake: d.stake, players, phase: d.phase, startsIn: Math.round(startsAt - t), endsIn: Math.round(startsAt + DARE_RUN_MS - t) };
  }
  const dareSend = (room, t) => broadcast(room, S.DARE, dareView(room, t));
  const inDare = (room, id) => { const pl = room.dare?.players.get(id); return !!pl && !pl.out; };

  /** Oublie le Chiche de la salle et libère les mises retenues. */
  function dareClear(room) {
    const d = room.dare;
    room.dare = null;
    if (d) for (const pl of d.players.values()) pl.account.session.hold = 0;
    return d;
  }
  /** Refuse (code 'busy') une opération qui sortirait de l'argent du compte tant qu'une mise de Chiche y est retenue. */
  function held(conn, op) {
    if (!(conn.account.session.hold > 0)) return false;
    sendError(conn, op, { code: 'busy', text: DARE_HOLD_TEXT });
    return true;
  }

  /** Fin du Chiche. Avec un vainqueur : règlement à somme nulle (settleDare), annonce, et gazette si le pot est > 0. Sans : aucun débit. */
  function dareEnd(room, t, winner, reason) {
    const d = dareClear(room);
    if (!d) return;
    const payload = { id: d.id, winner: null, sec: 0, pot: 0 };
    if (reason) payload.reason = reason;
    if (!winner) { broadcast(room, S.DARE_END, payload); return; }
    const losers = [];
    for (const pl of d.players.values()) if (pl !== winner) losers.push(pl);
    const wp = winner.account.profile;
    const res = eco.settleDare(wp, losers.map((l) => l.account.profile), d.stake);
    payload.winner = { id: wp.id, name: wp.name };
    payload.sec = d.started ? Math.max(0, r1((t - d.startsAt) / 1000)) : 0;
    payload.pot = res.pot;
    broadcast(room, S.DARE_END, payload);
    for (const pl of d.players.values()) {
      const delta = pl === winner ? res.pot : -(res.paid.find((x) => x.id === pl.id)?.amount || 0);
      const c = pl.account.conn;
      if (c && c.room === room) { saveAccount(pl.account); if (!c.closed) sendProfile(c, delta, res.reason); }
      else {
        // perdant déjà parti : son profil est sauvegardé et sa fiche de classement mise à jour sans connexion
        pl.account.profile.lastSeen = t;
        pl.account.fresh = false;
        store.putPlayer(pl.account.profile);
        if (room.record.members[pl.id]) touchMember(room, pl.account.profile);
      }
    }
    system(room, `${wp.name} gagne le Chiche !` + (res.pot > 0 ? ` +${fmt(res.pot)}` : ''));
    // gazette : seulement un Chiche qui a rapporté quelque chose (à pot nul, la ligne du chat suffit)
    if (res.pot > 0) feed(room, { k: 'dare', id: wp.id, n: wp.name, d: res.pot });
  }

  /** Course lancée : s'il ne reste qu'un participant en lice, il gagne ; s'il n'en reste aucun, le défi s'arrête. */
  function dareJudge(room, t) {
    let left = null, n = 0;
    for (const pl of room.dare.players.values()) if (!pl.out) { left = pl; n++; }
    if (n >= 2) dareSend(room, t);
    else dareEnd(room, t, n === 1 ? left : null, 'left');
  }

  /** Un participant quitte le Chiche : retrait sans frais en phase 'open' (le lanceur l'annule), forfait en phase 'run'. */
  function dareDrop(room, id, t) {
    const d = room.dare, pl = d?.players.get(id);
    if (!pl || pl.out) return false;
    if (d.phase === 'open') {
      if (d.by.id === id) dareEnd(room, t, null, 'left');
      else { pl.account.session.hold = 0; d.players.delete(id); dareSend(room, t); }
      return true;
    }
    pl.out = true;
    dareJudge(room, t);
    return true;
  }

  /** Clôture des inscriptions : départ dans 4 s, ou fin 'solo' sans débit s'il y a moins de 2 participants. */
  function dareClose(room, t) {
    const d = room.dare;
    if (d.players.size < 2) return dareEnd(room, t, null, 'solo');
    d.phase = 'run'; d.startsAt = t + DARE_COUNTDOWN_MS; d.endsAt = d.startsAt + DARE_RUN_MS; d.started = false;
    dareSend(room, t);
  }

  /** Transitions dues à l'horloge : clôture automatique à 90 s, contrôle des positions au départ, durée maximale. */
  function dareStep(room, t) {
    const d = room.dare;
    if (!d) return;
    if (d.phase === 'open') { if (t >= d.openUntil) dareClose(room, t); return; }
    if (!d.started && t >= d.startsAt) {
      d.started = true;
      let changed = false;
      for (const pl of d.players.values()) {
        if (pl.out) continue;
        const c = room.conns.get(pl.id);
        // au départ, un participant à plus de 120 m du point de départ est disqualifié
        if (!c || !c.pos || Math.hypot(c.pos.x - d.origin.x, c.pos.z - d.origin.z) > DARE_START_M) { pl.out = true; changed = true; }
      }
      if (changed) { dareJudge(room, t); if (room.dare !== d) return; }
    }
    if (t >= d.endsAt) dareEnd(room, t, null, 'timeout');
  }

  /** Arbitrage au rythme des états : téléportation = forfait ; premier arrivé dans le rayon de l'arrivée = vainqueur. */
  function dareTrack(conn, t, teleported) {
    const room = conn.room;
    dareStep(room, t);
    const d = room.dare;
    if (!d || d.phase !== 'run') return;
    const pl = d.players.get(conn.account.profile.id);
    if (!pl || pl.out) return;
    if (teleported) { dareDrop(room, pl.id, t); return; }
    if (d.started && Math.hypot(conn.pos.x - d.to.x, conn.pos.z - d.to.z) <= d.to.r) dareEnd(room, t, pl);
  }

  function tickDares() {
    const t = now();
    for (const room of rooms.values()) if (room.dare) dareStep(room, t);
  }

  // ------------------------------------------------------------------ économie

  /** Applique le résultat d'une opération d'économie : profil mis à jour ou erreur explicite. */
  function settle(conn, op, res) {
    if (!res.ok) { sendError(conn, op, res); return false; }
    saveAccount(conn.account);
    sendProfile(conn, res.delta, res.reason);
    return true;
  }

  /** Montée de niveau ou nouvelle étoile de Légende : la salle voit l'étiquette changer (S.LOOK), la gazette le note. */
  function announceLevel(conn, res) {
    const room = conn.room, p = conn.account.profile;
    sendLook(room, p);
    if (res.levelUp) {
      system(room, `${p.name} passe niveau ${res.level} — ${levelTitle(res.level)} !`, conn);
      feed(room, { k: 'level', id: p.id, n: p.name, d: res.level });
    }
    if (res.starUp) {
      system(room, `${p.name} décroche sa ${nth(res.stars)} étoile de Légende !`, conn);
      feed(room, { k: 'level', id: p.id, n: p.name, d: res.level, st: res.stars });
    }
  }

  const jobRefused = (conn, id, res) => send(conn, S.JOB_RESULT, { ok: false, id, fare: 0, tip: 0, chain: 0, capped: false, code: res.code, reason: res.text });
  const nearText = (city, pos) => { const l = jobs.nearestLandmark(city, pos); return l ? `, près ${ofPlace(l.name)}` : ''; };

  const handlers = {
    [C.PING](conn, m) { send(conn, S.PONG, { c: typeof m.c === 'number' ? m.c : 0, ts: now() }); },
    [C.STATE]: onState,

    [C.CHAT](conn, m) {
      const clean = eco.sanitizeChat(m.text); // caractères de contrôle, chevrons, MAX_CHAT_LEN (200)
      if (!clean) return;
      const L = conn.account.limits, t = now(); // débits du COMPTE : une reconnexion ne les remet pas à neuf
      const muted = () => sendError(conn, C.CHAT, { code: 'muted', text: `Chat coupé pour langage injurieux (encore ${Math.ceil((L.chatMuteUntil - t) / 1000)} s).` });
      if (L.chatMuteUntil > t) return muted();
      if (!L.chatBucket.take(t)) return sendError(conn, C.CHAT, { code: 'rate', text: 'Vous écrivez trop vite, patientez un instant.' });
      const { text, hits, strikes } = filterText(clean); // strikes : insultes (écarts) ; hits : tout mot masqué
      const same = text.toLowerCase();
      if (same === L.chatLast && t - L.chatLastAt < CHAT_REPEAT_MS) return sendError(conn, C.CHAT, { code: 'repeat', text: 'Message déjà envoyé.' });
      L.chatLast = same; L.chatLastAt = t;
      if (hits) {
        if (strikes) { // seuls les messages avec une insulte comptent comme écarts (un mot cru est masqué sans plus)
          L.chatHits = L.chatHits.filter((at) => t - at < CHAT_STRIKE_MS);
          L.chatHits.push(t);
          if (L.chatHits.length >= CHAT_STRIKES) { L.chatHits = []; L.chatMuteUntil = t + CHAT_MUTE_MS; muted(); }
        }
        // rien d'autre que des injures : rien n'est diffusé
        if (!/[\p{L}\p{N}]/u.test(text.replace(/\*\*\*/g, ''))) return sendError(conn, C.CHAT, { code: 'filtered', text: 'Message bloqué par le filtre du chat.' });
      }
      const p = conn.account.profile;
      broadcast(conn.room, S.CHAT, { from: p.name, id: p.id, text });
    },

    [C.MISSION_START](conn, m) {
      // refus (cooldown, mission inconnue, verrouillée ou d'une autre ville) : signalé par mission_result { ok: false } — c'est le gameplay qui l'affiche
      const id = eco.text(m.id).slice(0, 64), p = conn.account.profile, t = now();
      const res = eco.missionStart(p, conn.account.session, id, t, conn.room.city);
      if (!res.ok) return send(conn, S.MISSION_RESULT, { id, ok: false, reward: 0, code: res.code, reason: res.text });
      dareDrop(conn.room, p.id, t); // une mission retire d'un Chiche ouvert et vaut forfait pendant la course
    },
    [C.MISSION_ABORT](conn) { eco.missionAbort(conn.account.session); },
    [C.MISSION_COMPLETE](conn, m) {
      const p = conn.account.profile, room = conn.room, id = eco.text(m.id).slice(0, 64), t = now();
      flushDistance(conn, t);
      // moved = chemin mesuré par le serveur depuis mission_start (lu AVANT que missionComplete ne close la mission)
      const res = eco.missionComplete(p, conn.account.session, id, t, room.city, { pos: conn.pos, moved: conn.account.session.mission?.moved });
      if (!res.ok) return send(conn, S.MISSION_RESULT, { id, ok: false, reward: 0, code: res.code, reason: res.text });
      // podium de salle : exige une arrivée plausible (finishOk) ; jamais pour les missions photo
      const rec = res.timed && res.finishOk ? roomRecord(room, id, res.cls, p, res.sec, t) : null;
      const roomBest = res.timed ? holder(room.record.records[id]?.[res.cls]?.[0]) : null;
      saveAccount(conn.account);
      send(conn, S.MISSION_RESULT, {
        id, ok: true, reward: res.reward, sec: res.sec, cls: res.cls, best: res.best, pb: res.pb, rank: rec?.rank || 0, prev: rec?.prev || null, roomBest,
        first: res.first, star: res.star, done: res.done,
      });
      sendProfile(conn, res.delta, res.reason);
      sendJournal(conn);
      if (rec?.changed) {
        room.lbDirty = true; // le classement compte les records détenus
        broadcast(room, S.RECORDS, { id, cls: res.cls, top: rec.top.map(holder) });
      }
      if (rec?.rank === 1) {
        // le premier de la catégorie change : annonce à toute la salle et gazette (qui sauvegarde la salle)
        const cat = res.cls === 's' ? 'Sport' : 'Ville';
        system(room, `Record de salle ! ${p.name} boucle « ${res.title} » en ${fmtSec(res.sec)} (catégorie ${cat})` + (rec.prev ? ` — ${rec.prev.name} perd son record.` : '.'));
        const fact = { k: 'record', id: p.id, n: p.name, d: res.sec, m: id, c: res.cls };
        if (rec.prev) { fact.p = rec.prev.id; fact.pn = rec.prev.name; }
        feed(room, fact);
      } else {
        system(room, `${p.name} a réussi la mission « ${res.title} » (+${fmt(res.reward)}).`, conn);
        if (rec?.changed) saveRoom(room);
      }
      if (res.levelUp || res.starUp) announceLevel(conn, res);
    },

    [C.BUY_CAR](conn, m) {
      const room = conn.room, p = conn.account.profile;
      if (held(conn, C.BUY_CAR)) return;
      const res = eco.buyCar(p, eco.text(m.typeId), m.color);
      if (!settle(conn, C.BUY_CAR, res)) return;
      system(room, `${p.name} s'offre ${carArticle(res.typeId)} ${res.name} !`);
      feed(room, { k: 'car', id: p.id, n: p.name, d: res.name, m: res.typeId });
    },
    [C.SET_ACTIVE_CAR](conn, m) { settle(conn, C.SET_ACTIVE_CAR, eco.setActiveCar(conn.account.profile, eco.text(m.typeId))); },
    [C.PAINT_CAR](conn, m) { if (!held(conn, C.PAINT_CAR)) settle(conn, C.PAINT_CAR, eco.paintCar(conn.account.profile, eco.text(m.typeId), m.color)); },
    [C.SET_LOOK](conn, m) {
      const p = conn.account.profile, res = eco.setLook(p, { horn: m.horn });
      if (!settle(conn, C.SET_LOOK, res)) return;
      if (res.changed) sendLook(conn.room, p);
    },

    [C.BUY_PROPERTY](conn, m) {
      const room = conn.room, p = conn.account.profile, id = eco.text(m.id);
      if (held(conn, C.BUY_PROPERTY)) return;
      const res = eco.buyProperty(p, room.record.owners, id, room.city);
      if (!settle(conn, C.BUY_PROPERTY, res)) return;
      broadcast(room, S.OWNERS, { owners: room.record.owners });
      system(room, `${p.name} a acheté « ${res.name} ».`);
      feed(room, { k: 'buy', id: p.id, n: p.name, d: res.name, m: id });
    },
    [C.SELL_PROPERTY](conn, m) {
      const room = conn.room, p = conn.account.profile, id = eco.text(m.id);
      const res = eco.sellProperty(p, room.record.owners, id, room.city);
      if (!settle(conn, C.SELL_PROPERTY, res)) return;
      broadcast(room, S.OWNERS, { owners: room.record.owners });
      system(room, `${p.name} a vendu « ${res.name} ».`);
      feed(room, { k: 'sell', id: p.id, n: p.name, d: res.name, m: id });
    },

    [C.TRANSFER](conn, m) {
      if (!conn.transferBucket.take(now())) return sendError(conn, C.TRANSFER, { code: 'rate', text: 'Trop de virements : patientez quelques secondes.' });
      if (held(conn, C.TRANSFER)) return;
      const from = conn.account.profile;
      const target = typeof m.to === 'string' ? conn.room.conns.get(m.to) : null;
      const res = eco.transfer(from, target?.account.profile, m.amount);
      if (!res.ok) return sendError(conn, C.TRANSFER, res);
      const to = target.account.profile;
      saveAccount(conn.account); saveAccount(target.account);
      sendProfile(conn, -res.amount, `virement à ${to.name}`);
      sendProfile(target, res.amount, `virement ${ofName(from.name)}`);
      send(target, S.CHAT, { from: 'Système', system: true, text: `${from.name} vous a envoyé ${fmt(res.amount)}.` });
      send(conn, S.CHAT, { from: 'Système', system: true, text: `Vous avez envoyé ${fmt(res.amount)} à ${to.name}.` });
    },

    // ---------------- carnet de bord : défis du jour, journée complète, relevé du matin
    [C.CLAIM](conn, m) {
      const p = conn.account.profile, t = now();
      flushDistance(conn, t); // les kilomètres du jour sont à jour avant de juger un défi
      const res = eco.claim(p, { kind: m.kind, id: m.id }, { now: t, roomKey: conn.room.key, city: conn.room.city });
      if (!settle(conn, C.CLAIM, res)) return;
      sendJournal(conn);
      announceStreak(conn, res);
    },

    // ---------------- taxi libre
    [C.JOB_START](conn, m) {
      const room = conn.room, p = conn.account.profile, t = now(), st = conn.state;
      dareStep(room, t);
      const dare = inDare(room, p.id);
      const res = jobs.jobStart(p, conn.account.session, {
        kind: m.kind, pos: conn.pos, city: room.city, now: t, rand, vehicleType: st && st[6] === 1 ? st[8] : null,
        busy: dare && room.dare.phase === 'open', // inscrit à un Chiche : 'busy' ; pendant la course, prendre un client vaut forfait
      });
      if (!res.ok) return jobRefused(conn, null, res);
      if (dare) dareDrop(room, p.id, t);
      send(conn, S.JOB, res.job);
    },
    [C.JOB_DONE](conn, m) {
      const p = conn.account.profile, t = now(), id = m.id == null ? undefined : eco.text(m.id).slice(0, 32);
      const res = jobs.jobComplete(p, conn.account.session, { pos: conn.pos, now: t, hits: m.hits, id });
      if (!res.ok) return jobRefused(conn, id ?? null, res);
      saveAccount(conn.account);
      send(conn, S.JOB_RESULT, { ok: true, id: res.id, fare: res.fare, tip: res.tip, chain: res.chain, capped: res.capped, total: res.total });
      sendProfile(conn, res.delta, res.reason);
      sendJournal(conn);
    },
    [C.JOB_ABORT](conn) { jobs.jobAbort(conn.account.session); },

    // ---------------- Chiche
    [C.DARE](conn, m) {
      const room = conn.room, p = conn.account.profile, session = conn.account.session, t = now();
      const no = (code, text) => sendError(conn, C.DARE, { code, text });
      if (!conn.account.limits.dareBucket.take(t)) return no('rate', 'Un Chiche à la fois : patientez un instant.');
      dareStep(room, t);
      if (room.dare) return no('busy', 'Un Chiche est déjà en cours dans la salle.');
      if (session.hold > 0) return no('busy', DARE_HOLD_TEXT); // encore engagé dans le Chiche d'une autre salle
      if (session.mission || session.job) return no('busy', "Terminez d'abord votre mission ou votre course.");
      if (!conn.pos) return no('no_pos', 'Position inconnue : bougez un instant puis réessayez.');
      const stake = m.stake == null ? 0 : m.stake;
      if (!DARE_STAKES.includes(stake)) return no('bad_stake', `Mise invalide : ${fmt(0)}, ${fmt(500)} ou ${fmt(2000)}.`);
      if (stake > p.money) return no('no_funds', `Fonds insuffisants pour miser ${fmt(stake)}.`);
      const origin = { x: r1(conn.pos.x), z: r1(conn.pos.z), label: jobs.nearestLandmark(room.city, conn.pos)?.name || CITIES[room.city]?.name || '' };
      const spot = jobs.pickSpot(room.city, origin, DARE_MIN_M, DARE_MAX_M, rand);
      if (!spot) return no('no_spot', "Aucune arrivée possible d'ici : essayez un peu plus loin.");
      room.dare = {
        id: `d${Math.floor(t).toString(36)}${(++dareSeq % 1296).toString(36)}`, by: { id: p.id, name: p.name }, origin,
        to: { x: r1(spot.x), z: r1(spot.z), label: spot.label, r: DARE_FINISH_R }, stake,
        players: new Map([[p.id, { id: p.id, name: p.name, account: conn.account, out: false }]]),
        phase: 'open', openUntil: t + DARE_OPEN_MS, startsAt: 0, endsAt: 0, started: false,
      };
      session.hold = stake;
      dareSend(room, t);
    },
    [C.DARE_JOIN](conn, m) {
      const room = conn.room, p = conn.account.profile, session = conn.account.session, t = now();
      const no = (code, text) => sendError(conn, C.DARE_JOIN, { code, text });
      dareStep(room, t);
      const d = room.dare;
      if (!d || d.id !== m.id) return no('no_dare', "Ce Chiche n'existe plus.");
      if (d.players.has(p.id)) return; // déjà inscrit
      if (d.phase !== 'open') return no('closed', 'Le départ de ce Chiche est déjà donné.');
      if (session.mission || session.job) return no('busy', "Terminez d'abord votre mission ou votre course.");
      if (session.hold > 0) return no('busy', DARE_HOLD_TEXT); // encore engagé dans le Chiche d'une autre salle
      if (!conn.pos || Math.hypot(conn.pos.x - d.origin.x, conn.pos.z - d.origin.z) > DARE_JOIN_M) return no('too_far', `Rejoignez le point de départ (à moins de ${DARE_JOIN_M} m).`);
      if (p.money < d.stake) return no('no_funds', `Fonds insuffisants pour la mise de ${fmt(d.stake)}.`);
      d.players.set(p.id, { id: p.id, name: p.name, account: conn.account, out: false });
      session.hold = d.stake;
      dareSend(room, t);
    },
    [C.DARE_GO](conn) {
      const room = conn.room, t = now();
      dareStep(room, t);
      const d = room.dare;
      if (!d || d.phase !== 'open' || d.by.id !== conn.account.profile.id) return; // seul le lanceur donne le départ
      if (d.players.size < 2) return sendError(conn, C.DARE_GO, { code: 'solo', text: 'Attendez au moins un adversaire.' });
      dareClose(room, t);
    },
    [C.DARE_LEAVE](conn) {
      const room = conn.room, t = now();
      dareStep(room, t);
      dareDrop(room, conn.account.profile.id, t);
    },

    // ---------------- style, képis, klaxon, chute : seaux propres, dépassement ignoré sans erreur
    [C.STYLE](conn, m) {
      const t = now();
      if (!conn.styleBucket.take(t)) return;
      const room = conn.room, p = conn.account.profile, st = conn.state;
      flushDistance(conn, t);
      // fenêtre SERVEUR : temps depuis le dernier rapport accepté (ou le hello), chemin mesuré par onState
      const winSec = (t - conn.styleAt) / 1000;
      const res = eco.styleReport(p, m, { winSec, movedM: conn.styleMoved, inVehicle: !!st && st[6] === 1, now: t });
      if (!res.ok) return; // à pied, ou moins de 50 m parcourus : ignoré
      conn.styleAt = t; conn.styleMoved = 0;
      saveAccount(conn.account);
      sendProfile(conn);
      sendJournal(conn);
      const day = styleDayOf(room, t);
      // combo du jour de la SALLE : au plus 600 points par seconde de fenêtre (un rapport au plafond, 60 000 points
      // déclarés d'un seul message, ne ferme plus la journée à tout le monde) ; le record personnel n'est pas touché
      const combo = Math.min(res.combo, Math.floor(STYLE_DAY_PER_SEC * Math.min(eco.STYLE_LIMITS.WIN_MAX_SEC, Math.max(0, winSec))));
      if (combo >= STYLE_DAY_MIN && combo > (day?.pts || 0)) {
        room.record.styleDay = { k: J.dayKey(t), id: p.id, name: p.name, pts: combo };
        // gazette : au plus une entrée 'style' par salle et par 10 min ; dans l'intervalle, l'entrée existante est
        // mise à jour sur place et rediffusée avec le MÊME horodatage (le client la remplace au lieu d'en ajouter une)
        const list = room.record.feed;
        let last = null;
        for (let i = list.length - 1; i >= 0 && !last; i--) if (list[i].k === 'style') last = list[i];
        if (last && t - last.t < STYLE_FEED_MS) {
          last.id = p.id; last.n = p.name; last.d = combo;
          broadcast(room, S.FEED, { e: feedOut(last) });
          saveRoom(room);
        } else feed(room, { k: 'style', id: p.id, n: p.name, d: combo });
      }
      const lim = conn.account.limits;
      if (res.record && res.best >= COMBO_ANNOUNCE_MIN && t - lim.comboAnnAt >= COMBO_ANNOUNCE_MS) {
        lim.comboAnnAt = t;
        system(room, `${p.name} encaisse un combo de ${fmtInt(res.best)} points de style !`);
      }
    },
    [C.HEAT](conn, m) {
      const t = now();
      if (!conn.heatBucket.take(t)) return;
      // l'avis de recherche vit dans la SESSION du compte (comme la mission) : il survit à une coupure de connexion
      const room = conn.room, p = conn.account.profile, session = conn.account.session, lim = conn.account.limits, h = session.heat;
      if (m.ev === 'wanted') {
        const k = m.k === 3 ? 3 : 2;
        if (h && t - h.at < HEAT_KEEP_MS) { if (k > h.k) h.k = k; return; } // même poursuite : pas de nouvelle annonce
        session.heat = { k, at: t, moved: 0 }; // moved = chemin mesuré depuis l'avis (record de cavale)
        if (t - lim.heatAnnAt >= HEAT_ANNOUNCE_MS) {
          lim.heatAnnAt = t;
          system(room, `Avis de recherche : ${p.name}, ${k} képis${nearText(room.city, conn.pos)}.`);
        }
        return;
      }
      if ((m.ev !== 'bust' && m.ev !== 'escape') || !h) return; // sans avis de recherche : ignoré
      session.heat = null;
      if (t - h.at >= HEAT_KEEP_MS) return;
      if (m.ev === 'bust') {
        // le niveau a pu monter en cours de poursuite (un seul 'wanted' par poursuite) : le client le redit au contrôle,
        // et seul le plus élevé compte (il ne peut que relever sa propre amende)
        const res = eco.fine(p, Math.max(h.k, m.k === 3 ? 3 : 2), t); // compte lui-même stats.fines
        if (!res.ok) return;
        saveAccount(conn.account);
        sendProfile(conn, res.delta, res.reason);
        return;
      }
      // fuite réussie : durée déclarée bornée par l'horloge du serveur ; aucun argent
      const sec = r1(+m.sec), dur = (t - h.at) / 1000;
      if (!(sec >= ESCAPE_MIN_SEC) || sec > ESCAPE_MAX_SEC || sec > dur + ESCAPE_SLACK_SEC) return;
      const stats = p.stats;
      stats.escapes = (stats.escapes || 0) + 1;
      stats.bestEscapeSec = stats.bestEscapeSec > 0 ? Math.min(stats.bestEscapeSec, sec) : sec; // 0 = aucune cavale
      saveAccount(conn.account);
      sendProfile(conn);
      // record de SALLE : semés à distance, après un vrai trajet mesuré par le serveur, sur une durée qu'il a vue passer
      const record = cavaleOf(room, t);
      if (m.how === 'dist' && h.moved >= ESCAPE_RECORD_MIN_M && sec <= dur + ESCAPE_RECORD_SLACK_SEC && (!record || sec < record.sec)) {
        room.record.cavale = { id: p.id, name: p.name, sec, at: t };
        system(room, `${p.name} sème les képis en ${fmtSec(sec)} : record de cavale de la salle !`);
        feed(room, { k: 'cavale', id: p.id, n: p.name, d: sec });
      }
    },
    [C.EMOTE](conn, m) {
      if (!conn.emoteBucket.take(now())) return;
      const k = m.k;
      if (!Number.isInteger(k) || k < 0 || k > 4) return;
      const p = conn.account.profile, out = { id: p.id, k };
      if (k === 0) out.h = p.look?.h || eco.DEFAULT_HORN; // le klaxon vient du profil : jamais d'identifiant accepté du client
      broadcast(conn.room, S.EMOTE, out, conn);
    },
    [C.BUMP](conn, m) {
      const t = now();
      if (!conn.bumpBucket.take(t)) return;
      const room = conn.room, p = conn.account.profile;
      const by = typeof m.by === 'string' ? room.conns.get(m.by) : null;
      if (!by || by === conn || !conn.pos || !by.pos || !by.state) return;
      if (Math.hypot(conn.pos.x - by.pos.x, conn.pos.z - by.pos.z) > BUMP_RANGE_M) return;
      if (by.state[6] !== 1 || Math.abs(by.state[5]) <= BUMP_MIN_SPEED) return; // le fautif doit rouler
      const driver = by.account.profile, key = driver.id < p.id ? `${driver.id}|${p.id}` : `${p.id}|${driver.id}`, last = room.bumps.get(key);
      if (last != null && t - last < BUMP_PAIR_MS) return;
      if (room.bumps.size > 256) for (const [k, at] of room.bumps) if (t - at >= BUMP_PAIR_MS) room.bumps.delete(k);
      room.bumps.set(key, t);
      p.stats.bumpsTaken = (p.stats.bumpsTaken || 0) + 1;
      driver.stats.bumpsGiven = (driver.stats.bumpsGiven || 0) + 1;
      conn.statsDirty = true; by.statsDirty = true; // écrits avec la prochaine sauvegarde (tickRents, départ)
      system(room, `${driver.name} a renversé ${p.name} — ${p.name} se relève en râlant.`);
    },
  };
  const ECONOMY_OPS = new Set([C.MISSION_START, C.MISSION_COMPLETE, C.BUY_CAR, C.SET_ACTIVE_CAR, C.BUY_PROPERTY, C.SELL_PROPERTY, C.TRANSFER,
    C.PAINT_CAR, C.SET_LOOK, C.CLAIM, C.JOB_START, C.JOB_DONE, C.JOB_ABORT, C.DARE, C.DARE_JOIN, C.DARE_GO, C.DARE_LEAVE]);

  function onMessage(conn, raw, isBinary) {
    if (conn.closed) return;
    conn.alive = true;
    if (isBinary) { conn.ws.close(CLOSE.FLOOD, 'binary'); return; }
    // Débit dépassé : le message est ignoré. Une rafale ponctuelle (états mis en tampon pendant un gel réseau puis
    // livrés d'un coup) ne coupe pas un joueur honnête ; seul un dépassement prolongé ferme la connexion.
    if (!conn.bucket.take(now())) { if (++conn.dropped > FLOOD_DROPS) conn.ws.close(CLOSE.FLOOD, 'flood'); return; }
    conn.dropped = 0;
    const m = decode(raw);
    if (!m) { if (++conn.strikes > 5) conn.ws.close(CLOSE.FLOOD, 'invalid'); return; }
    if (!conn.account) {
      // tant que le hello n'a pas abouti, rien d'autre n'est accepté
      if (m.t !== C.HELLO || conn.helloPending) return;
      conn.helloPending = true;
      onHello(conn, m).catch((e) => { log('[hello] ' + oneLine(e)); reject(conn, 'server', 'Erreur du serveur, réessayez.'); });
      return;
    }
    const h = Object.hasOwn(handlers, m.t) ? handlers[m.t] : null;
    if (!h) { if (++conn.strikes > 20) conn.ws.close(CLOSE.FLOOD, 'invalid'); return; }
    if (ECONOMY_OPS.has(m.t) && !conn.opBucket.take(now())) return sendError(conn, m.t, { code: 'rate', text: "Trop d'opérations à la suite : patientez un instant." });
    try { h(conn, m); } catch (e) {
      // une ligne par erreur (jamais la pile : un client écrit à la main noierait les journaux) et un strike, comme
      // pour un type inconnu : le flot s'arrête au 21e message
      log(`[msg ${m.t}] ` + oneLine(e));
      sendError(conn, m.t, { code: 'server', text: 'Erreur du serveur.' });
      if (++conn.strikes > 20) conn.ws.close(CLOSE.FLOOD, 'invalid');
    }
  }

  function onConnection(ws, req) {
    // adresse du client : derrière Cloud Run, le DERNIER élément de x-forwarded-for est posé par l'infrastructure
    // (les premiers viennent du client, donc falsifiables) ; sans en-tête, l'adresse de la socket
    const fwd = req?.headers?.['x-forwarded-for'];
    const ip = (typeof fwd === 'string' && fwd ? fwd.split(',').pop() : String(req?.socket?.remoteAddress || '')).trim();
    const conn = {
      ws, account: null, room: null, state: null, pos: null, moveAt: 0, moveBudget: 0, teleportAt: 0, accrueAt: 0, alive: true, closed: false,
      helloPending: false, strikes: 0, dropped: 0,
      bucket: eco.createBucket(90, 45), // tous messages (15 états/s + pings en régime normal)
      opBucket: eco.createBucket(12, 2), // opérations d'économie
      transferBucket: eco.createBucket(3, 0.2),
      // contrat v6 : un seau par famille de messages, dépassement ignoré sans erreur ni strike (sauf DARE : erreur 'rate').
      // Le seau des Chiche et les délais d'annonce (avis de recherche, combo) sont dans le COMPTE (account.limits).
      emoteBucket: eco.createBucket(4, 1),
      bumpBucket: eco.createBucket(2, 0.05),
      styleBucket: eco.createBucket(3, 0.05),
      heatBucket: eco.createBucket(3, 0.05),
      distAcc: 0, // mètres mesurés pas encore reportés dans le profil
      styleAt: 0, styleMoved: 0, // fenêtre de style : début (dernier rapport accepté ou hello) et chemin parcouru
      spdAt: 0, spdD: 0, // fenêtre d'une seconde de la vitesse de pointe
      journalDirty: false, statsDirty: false, daySent: '', kmSent: -1,
      ip,
    };
    conns.add(conn);
    conn.helloTimer = setTimeout(() => { if (!conn.account) ws.close(CLOSE.REJECTED, 'hello'); }, HELLO_TIMEOUT_MS);
    ws.on('message', (raw, isBinary) => onMessage(conn, raw, isBinary));
    ws.on('pong', () => { conn.alive = true; });
    ws.on('close', () => detach(conn));
    ws.on('error', () => { /* 'close' suit toujours */ });
  }

  // ------------------------------------------------------------------ tâches périodiques

  function tickRents() {
    const t = now();
    for (const conn of conns) {
      if (!conn.account || conn.closed) continue;
      const delta = eco.accrue(conn.account.profile, conn.room.record.owners, (t - conn.accrueAt) / 1000, { now: t, roomKey: conn.room.key });
      conn.accrueAt = t;
      flushDistance(conn, t);
      if (delta > 0) { saveAccount(conn.account); sendProfile(conn, delta, 'loyers'); }
      // distance, vitesse de pointe, chutes : écrites ici (et au départ), jamais au rythme des états
      else if (conn.statsDirty) { saveAccount(conn.account); sendProfile(conn); }
    }
  }
  /** S.JOURNAL pour les compteurs continus (kilomètres) et la bascule de 4 h : seulement si ce que le joueur voit a changé. */
  function tickJournal() {
    const t = now(), today = J.dayKey(t);
    for (const conn of conns) {
      if (!conn.account || conn.closed) continue;
      flushDistance(conn, t);
      // bascule de 4 h vécue en session : la veille est soldée d'office, ses défis réussis sont crédités ici
      if (J.rollDay(conn.account.profile, t)) conn.journalDirty = true;
      if (payDue(conn)) conn.journalDirty = true;
      if (!conn.journalDirty && conn.daySent === today) continue;
      const j = journalOf(conn, t), km = kmHave(j);
      conn.journalDirty = false;
      if (j.day === conn.daySent && km === conn.kmSent) continue;
      noteJournal(conn, j);
      send(conn, S.JOURNAL, { j });
    }
  }
  function tickLeaderboards() {
    for (const room of rooms.values()) {
      if (!room.lbDirty) continue;
      room.lbDirty = false;
      broadcast(room, S.LEADERBOARD, { list: leaderboard(room) });
    }
  }
  function tickHeartbeat() {
    for (const conn of conns) {
      if (!conn.alive) { conn.ws.terminate(); continue; } // 'close' -> detach
      conn.alive = false;
      try { conn.ws.ping(); } catch { /* socket déjà fermée */ }
    }
    const t = now();
    for (const [id, a] of accounts) if (!a.conn && a.evictAt && a.evictAt < t) accounts.delete(id);
    // seaux de hello : oubliés une fois remplis de nouveau (adresse silencieuse depuis burst / débit secondes)
    if (helloLimited) for (const [ip, e] of helloBuckets) if (t - e.at > (helloBurst / HELLO_PER_SEC) * 1000) helloBuckets.delete(ip);
  }

  // ------------------------------------------------------------------ cycle de vie

  function attach(server) {
    wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
    wss.on('connection', onConnection);
    server.on('upgrade', (req, socket, head) => {
      let path = '';
      try { path = new URL(req.url, 'http://x').pathname; } catch { /* URL invalide */ }
      if (path !== WS_PATH || stopped) { socket.destroy(); return; }
      if (conns.size >= maxConnections) {
        if (fullNotices >= FULL_NOTICE_MAX) { socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
        // serveur complet : la socket est acceptée le temps de le DIRE (refus fatal, le client joue alors en solo et
        // l'annonce), sans jamais entrer dans `conns` ni lire un message
        fullNotices++;
        wss.handleUpgrade(req, socket, head, (ws) => {
          let done = false;
          const release = () => { if (!done) { done = true; fullNotices--; } };
          ws.on('close', release);
          ws.on('error', () => { /* 'close' suit */ });
          ws.send(encode(S.ERROR, { op: C.HELLO, code: 'server_full', text: SERVER_FULL_TEXT, fatal: true }));
          ws.close(CLOSE.REJECTED, 'server_full');
          setTimeout(() => { if (!done) ws.terminate(); }, 5000).unref?.();
        });
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    const every = (fn, ms) => { const h = setInterval(fn, ms); h.unref?.(); timers.push(h); };
    every(tickSnapshots, Math.round(1000 / SERVER_TICK_HZ));
    every(tickRents, rentIntervalMs);
    every(tickJournal, JOURNAL_TICK_MS);
    every(tickDares, DARE_TICK_MS);
    every(tickLeaderboards, 3000);
    every(tickHeartbeat, HEARTBEAT_MS);
  }

  /** Arrêt propre : loyers soldés, tout est sauvegardé, clients invités à se reconnecter (code 1012). */
  async function shutdown() {
    if (stopped) return;
    stopped = true;
    for (const h of timers) clearInterval(h);
    // un redémarrage annule le Chiche en cours, sans débit — et le DIT (S.DARE_END reason 'restart', avant la fermeture) :
    // sans cette annonce, un client qui se reconnecte ne peut pas distinguer l'annulation d'un forfait par coupure
    for (const room of rooms.values()) dareEnd(room, now(), null, 'restart');
    for (const conn of [...conns]) {
      const ws = conn.ws;
      detach(conn, true);
      try { ws.close(CLOSE.RESTART, 'restart'); } catch { /* déjà fermée */ }
    }
    for (const a of accounts.values()) if (!a.fresh) store.putPlayer(a.profile);
    await store.close();
    wss?.close();
  }

  return {
    attach, shutdown, tickRents, tickSnapshots, tickLeaderboards, tickHeartbeat, tickJournal, tickDares,
    stats: () => ({ connections: conns.size, rooms: rooms.size, accounts: accounts.size,
      players: Object.fromEntries([...rooms.values()].map((r) => [r.key, r.conns.size])) }),
  };
}

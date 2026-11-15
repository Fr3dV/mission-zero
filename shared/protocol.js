// Protocole réseau Mission Zéro — partagé client / serveur / robots (aucune dépendance).
// Transport : WebSocket texte, un objet JSON compact par message : { t: <type>, ... }.
// Les états de position sont des tableaux numériques arrondis (voir encodeState).
//
// Multi-villes : `hello` porte la ville du client (`city`, voir shared/cities.js). Champ OPTIONNEL : un client
// qui ne l'envoie pas (onglet ouvert avant la mise à jour) est à Paris. Une salle appartient à une ville : le
// même code de salle dans deux villes désigne deux salles distinctes. `welcome` renvoie la ville retenue.
// La version de protocole reste 1 : l'ajout est rétrocompatible dans les deux sens.
export const PROTOCOL_VERSION = 1;
export const WS_PATH = '/ws';

export const CLIENT_SEND_HZ = 15; // états envoyés par le client
export const SERVER_TICK_HZ = 12; // instantanés diffusés par le serveur
export const INTERP_DELAY_MS = 120; // tampon d'interpolation côté client
export const HEARTBEAT_MS = 25000;
export const MAX_MESSAGE_BYTES = 2048;
export const MAX_PLAYERS_PER_ROOM = 32;
export const DEFAULT_ROOM = 'paris';
export const MAX_CHAT_LEN = 200;
export const MAX_SPEED = 130; // m/s (468 km/h) — vitesse moyenne au-delà de laquelle un déplacement est traité comme une téléportation

// ---- Boucle fun et rétention (contrat v6) -------------------------------------------------------
// PROTOCOL_VERSION reste 1 : tout champ ajouté est OPTIONNEL. Un client plus ancien ignore tout S.* inconnu
// (onServer[m.t]?.(m)). Un serveur plus ancien, lui, compte chaque C.* inconnu comme un message invalide (coupure
// au-delà de 20) : le serveur annonce donc ce qu'il sait faire dans welcome.feat, le client range store.feat et
// n'envoie AUCUN message nouveau dont la capacité manque.
//   'fun1'  records, journal, relevé du matin, gazette, émotes, chutes, style, apparence (klaxons)
//   'taxi'  courses de taxi libre (job_start / job_done / job_abort)
//   'dare'  « Chiche ! » (dare / dare_join / dare_go / dare_leave)
//   'heat'  képis côté serveur (annonce, amende, record de cavale)
//   'paint' Atelier de peinture (paint_car)
// Hors-ligne : FEATS_OFFLINE (pas de Chiche ; 'offline' signale le repli local).
export const FEATS = ['fun1', 'taxi', 'dare', 'heat', 'paint'];
export const FEATS_OFFLINE = ['fun1', 'taxi', 'heat', 'paint', 'offline'];

// Messages client -> serveur
export const C = {
  HELLO: 'hello', //            { v, name, room, city?, token? }   (city absent = 'paris')
  STATE: 'st', //               { s: [x, y, z, yaw, speed, mode, anim, vehicleType, vehicleColor] }
  PING: 'ping', //              { c: horloge client }
  CHAT: 'chat', //              { text }
  MISSION_START: 'mission_start', //       { id }   refusé (mission_result ok:false) : unknown_mission, wrong_city, locked, cooldown
  MISSION_COMPLETE: 'mission_complete', // { id, durationSec? }   (durationSec ignoré : seule l'horloge du serveur compte)
  MISSION_ABORT: 'mission_abort', //       {}
  BUY_CAR: 'buy_car', //        { typeId, color? }   color validée contre spec.colors du catalogue, sinon ignorée
  SET_ACTIVE_CAR: 'set_car', // { typeId }
  BUY_PROPERTY: 'buy_prop', //  { id }
  SELL_PROPERTY: 'sell_prop', // { id }
  TRANSFER: 'transfer', //      { to, amount }
  // ---- contrat v6 (chacun derrière sa capacité de welcome.feat)
  PAINT_CAR: 'paint_car', //    { typeId, color }   'paint' — teinte de spec.colors (500 Ƶ) ou du nuancier CAT.PAINTS
  SET_LOOK: 'set_look', //      { horn }            'fun1' — klaxon signature (id de CAT.HORNS, débloqué)
  CLAIM: 'claim', //            { kind: 'away' | 'daily', id?: 'd1' | 'd2' | 'd3' | 'full' }   'fun1'
  JOB_START: 'job_start', //    { kind: 'taxi' }    'taxi' — la destination et le client sont tirés par le serveur
  JOB_DONE: 'job_done', //      { id, hits: 0..5 }  'taxi' — hits = chocs subis pendant la course (ne peut que réduire le pourboire)
  JOB_ABORT: 'job_abort', //    {}                  'taxi'
  DARE: 'dare', //              { stake: 0 | 500 | 2000 }   'dare' — lance un Chiche depuis sa position
  DARE_JOIN: 'dare_join', //    { id }              'dare' — à 80 m au plus du point de départ
  DARE_GO: 'dare_go', //        {}                  'dare' — le lanceur donne le départ (dès 2 participants)
  DARE_LEAVE: 'dare_leave', //  {}                  'dare' — retrait en phase 'open', forfait en phase 'run'
  EMOTE: 'emote', //            { k: 0..4 }         'fun1' — 0 klaxon, 1 « Chiche ? », 2 « Bravo ! », 3 « Oups… », 4 « Suis-moi »
  BUMP: 'bump', //              { by: <id du joueur au volant> }   'fun1' — envoyé par la VICTIME renversée
  // HEAT : UN 'wanted' par poursuite ; l'avis de recherche vit dans la session du compte (il survit à une reconnexion).
  //   'bust' redit le niveau atteint (k) : s'il a monté en cours de poursuite, c'est lui qui fixe le plafond de l'amende.
  //   'escape' de moins de 8 s (le client envoie sec: 0) : l'avis est levé sans rien compter — c'est ainsi que le client
  //   clôt une poursuite finie sans cavale méritée (minuteur avec l'unité au pare-chocs, activité commencée entre-temps).
  HEAT: 'heat', //              { ev: 'wanted' | 'bust' | 'escape', k: 2 | 3, sec?, how?: 'dist' | 'time' }   'heat'
  // Rapport de style 'fun1' : agrégat de la fenêtre écoulée depuis le rapport précédent, au plus toutes les 20 s et
  // seulement s'il y a eu un encaissement. Unités FIXES : pts = points ENCAISSÉS (multiplicateur inclus) ;
  // combo = plus gros encaissement unique (<= pts) ; drift = plus longue dérive en SECONDES (0,1 près) ;
  // air = plus long saut en SECONDES ; near = NOMBRE de frôlements ; props = NOMBRE d'objets fauchés.
  // Aucune durée n'est déclarée par le client : le serveur rogne selon SA fenêtre et le chemin qu'il a mesuré.
  STYLE: 'style', //            { pts, combo, drift, air, near, props }
};

// Messages serveur -> client
export const S = {
  // WELCOME : { v, id, token?, room, city, me, players: [{ id, name, lvl?, st?, look? }], owners, lb, ts, mission }
  //   mission = id de la mission conservée côté serveur à la reconnexion, ou null
  //   + contrat v6 : feat: [capacités], fresh: bool (le jour du journal a basculé à ce hello, ou compte neuf),
  //     best: { missionId: { v?: sec, s?: sec } } (records personnels, missions de la ville de la salle),
  //     records: { missionId: { v?: { id, name, sec }, s?: { id, name, sec } } } (détenteurs de la salle),
  //     journal: <vue publique, voir JOURNAL>, away: { sec, rent, props: [{ id, name, rent }] } | null (relevé du matin :
  //     non nul seulement quand CE hello y a ajouté des loyers ; le relevé non encaissé reste dans journal.away),
  //     feed: [12 entrées de gazette au plus, voir FEED : faits des AUTRES depuis la dernière présence], dare: <état, voir DARE> | null,
  //     cavale: { id, name, sec } | null (record de cavale de la salle : il tient 7 jours), styleDay: { id, name, pts } | null
  WELCOME: 'welcome',
  // ERROR : fatal = le hello est refusé pour de bon (fermeture 4002). Hello trop fréquents depuis une même adresse :
  //   { op: 'hello', code: 'rate' } NON fatal, fermeture 4003 (le client réessaie de lui-même, à la première connexion
  //   aussi : ce refus ne compte pas parmi les essais qui font basculer hors-ligne). Mise de Chiche retenue :
  //   code 'busy' sur transfer, buy_car, buy_prop et paint_car, du lancer (ou de l'inscription) à la fin du défi.
  ERROR: 'error', //      { op, code, text, fatal? }
  // PROFILE : me = { id, name, money, properties, cars, activeCar, stats, cooldowns, carColors, look: { h } }
  //   cooldowns ne contient que les missions de la VILLE de la salle (présence de la clé = mission déjà réussie).
  //   reason : 'mission', 'loyers', 'achat véhicule', 'achat immobilier', 'vente immobilière', 'course de taxi',
  //   'défi du jour', 'journée complète', 'défis de la veille' (défis réussis mais pas réclamés avant 4 h, soldés d'office
  //   à la bascule), 'amende', 'peinture', 'chiche' (+ « virement à X », « virement de X » / « virement d'X »).
  PROFILE: 'profile', //  { me, delta?, reason? }
  SNAPSHOT: 'snap', //    { ts, p: [[id, x, y, z, yaw, speed, mode, anim, vehicleType, vehicleColor], ...] }
  JOIN: 'join', //        { id, name, lvl?, st?, look? }   lvl = niveau, st = étoiles de Légende, look = { h: klaxon }
  LEAVE: 'leave', //      { id, name }
  CHAT: 'chat', //        { from, id?, text, system? }
  // MISSION_RESULT : { id, ok, reward, code?, reason? } — aussi envoyé si mission_start est refusé.
  //   Réussite, contrat v6 : + { sec (durée horloge serveur), cls: 'v' | 's' (catégorie Ville / Sport de la voiture),
  //     best: <ancien record personnel de la catégorie | null>, pb: bool, rank: 0 | 1 | 2 | 3 (place au podium de salle),
  //     prev: { id, name, sec } | null (détenteur détrôné), roomBest: { id, name, sec } | null,
  //     first: <prime de première réussite Ƶ>, star: <prime de mission vedette Ƶ>, done: <stats.missionsDone après réussite> }
  //   reward = total crédité (base + first + star). `done` est aussi renvoyé hors-ligne. La réussite n'est jamais refusée
  //   pour la position ni pour le temps ; mais record (pb, rank) et primes (first, star) exigent une arrivée plausible ET un
  //   temps physiquement tenable pour la catégorie (economy.recordFloorSec) avec un trajet réellement mesuré par le serveur.
  MISSION_RESULT: 'mission_result',
  OWNERS: 'owners', //    { owners: { propertyId: { id, name } } }
  // LEADERBOARD : lignes { id, name, money, online, worth, lvl, st, rec } triées par worth (fortune totale)
  //   décroissant : les 20 premières PLUS tout joueur connecté absent du top. rec = records de salle détenus.
  LEADERBOARD: 'lb', //   { list }
  PONG: 'pong', //        { c, ts }
  // ---- contrat v6
  LOOK: 'look', //        { id, lvl, st, look: { h } }   à la salle quand le niveau, les étoiles ou le klaxon d'un joueur changent
  RECORDS: 'records', //  { id: missionId, cls: 'v' | 's', top: [{ id, name, sec } x3] }   à la salle à chaque changement
  // JOURNAL : j = { day, lv, star: missionId | null, list: [{ id, kind, goal, have, reward, claimed, label }],
  //   full: { reward, ready, claimed }, streak: { n, best }, resetAt (ms, horloge serveur),
  //   away: { rent, sec, props: [{ id, name, rent }] } | null }
  JOURNAL: 'journal', //  { j }
  // FEED : e = { t (ms), k: 'record' | 'buy' | 'sell' | 'car' | 'level' | 'dare' | 'cavale' | 'streak' | 'style', id, n, d, m?, x }
  //   id, n = joueur concerné (id, pseudo) ; d = la donnée du fait ; m = l'objet concerné ; x = phrase française prête à afficher
  //   (record : « Bob bat le record d'Alice sur « Titre » (0:17,3, Ville) » — élision devant le pseudo, catégorie dans la parenthèse).
  //     record : d = temps (s), m = id de mission, c = catégorie 'v' | 's', p / pn = id et pseudo du détenteur détrôné (absents sinon)
  //     buy, sell : d = nom du bien, m = id du bien          car : d = nom du véhicule, m = typeId
  //     level : d = niveau atteint ; avec st = n, c'est la n-ième étoile de Légende
  //     dare : d = pot gagné (Ƶ)      cavale : d = durée (s)      streak : d = jours de série      style : d = points du combo du jour
  //   Diffusé à toute la salle, auteur compris. Le combo du jour ('style') n'a qu'une entrée par salle et par 10 min : battu
  //   entre-temps, il est rediffusé avec le MÊME t (le client remplace l'entrée de même k et de même t, sans nouvelle annonce).
  FEED: 'feed', //        { e }
  // JOB : course de taxi acceptée. mood: 'normal' | 'presse' | 'touriste' | 'fragile' ; to = { x, z, label, r } ;
  //   fare = prix de base Ƶ ; parSec = délai au-delà duquel le pourboire fond ; chain = rang dans la série ; taxi = bonus Taxi Parisien.
  JOB: 'job', //          { id, kind: 'taxi', mood, to, fare, parSec, chain, taxi }
  // JOB_RESULT : code = 'too_far' (course conservée) | 'too_fast' | 'no_spot' | 'no_job' | 'busy' | 'no_pos' | 'no_vehicle' | 'bad_kind'
  //   Refus de job_start : { ok: false, id: null, fare: 0, tip: 0, chain: 0, capped: false, code, reason }. total = montant crédité
  //   (au quart au-delà du plafond horaire, et 0 une fois 2 × ce plafond encaissés dans l'heure : capped: true dans les deux cas).
  JOB_RESULT: 'job_result', // { ok, id, fare, tip, chain, capped, total?, code?, reason? }
  // DARE : état du Chiche, diffusé à TOUTE la salle à chaque changement. phase: 'open' | 'run' ;
  //   startsIn / endsIn = millisecondes restantes (le client les convertit dans son horloge locale). Phase 'open' : départ au
  //   plus tard (clôture automatique + 4 s) ; phase 'run' : valeurs réelles, startsIn négatif une fois le départ donné.
  //   players = participants encore en lice. Le seau des lancers (2, puis 1 par 30 s) suit le COMPTE, pas la connexion.
  //   Refus (S.ERROR) — op 'dare' : rate, busy, no_pos, bad_stake, no_funds, no_spot ;
  //   op 'dare_join' : no_dare, closed, busy, too_far, no_funds ; op 'dare_go' : solo (le lanceur est encore seul).
  DARE: 'dare', //        { id, by: { id, name }, origin: { x, z, label }, to: { x, z, label, r }, stake, players: [{ id, name }], phase, startsIn, endsIn }
  // DARE_END : reason absent = arrivée franchie ; 'left' = dernier en lice (forfaits), ou défi annulé par le retrait du lanceur
  //   avant le départ (winner null) ; 'solo' = moins de 2 participants à la clôture ; 'timeout' = 240 s sans arrivée. pot = gain net.
  DARE_END: 'dare_end', // { id, winner: { id, name } | null, sec, pot, reason?: 'solo' | 'timeout' | 'left' | 'restart' (arrêt du serveur : annulé sans débit) }
  EMOTE: 'emote', //      { id, k, h? }   jamais renvoyé à l'émetteur ; h = klaxon de l'émetteur (lu dans SON profil par le serveur)
};

// Codes de fermeture WebSocket applicatifs
export const CLOSE = {
  REPLACED: 4001, // même compte connecté ailleurs : ne pas se reconnecter
  REJECTED: 4002, // hello refusé (salle pleine, version…) : ne pas se reconnecter
  FLOOD: 4003, // débit dépassé
  RESTART: 1012, // redémarrage du serveur : se reconnecter
};

export const MODES = ['foot', 'vehicle'];
// Animations : l'index voyage dans les états. Ajouts v6 EN FIN de tableau (8 à 10) : un pair plus ancien décode
// un index inconnu en 'idle' (ANIMS[i] || 'idle') et un serveur plus ancien le ramène à 0.
export const ANIMS = ['idle', 'walk', 'run', 'sit', 'jump', 'fall', 'swim', 'drive', 'lying', 'getup', 'stumble'];
// Émotes (C.EMOTE.k) : 0 = klaxon, 1 à 4 = bulles au-dessus du pseudo.
export const EMOTES = ['', 'Chiche ?', 'Bravo !', 'Oups…', 'Suis-moi'];

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (Number.isFinite(+v) ? +v : 0);

/** Couleur (nombre 0xrrggbb, '#rgb', '#rrggbb', THREE.Color) -> '#rrggbb' ou null. */
export function normColor(c) {
  if (c == null) return null;
  if (typeof c === 'number' && Number.isFinite(c)) return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  if (typeof c === 'object' && typeof c.getHexString === 'function') return '#' + c.getHexString();
  if (typeof c !== 'string') return null;
  let s = c.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

/** État du joueur (contrat ctx.player.getNetState()) -> tableau compact. */
export function encodeState(st) {
  const mode = Math.max(0, MODES.indexOf(st.mode));
  const anim = Math.max(0, ANIMS.indexOf(st.anim));
  const out = [r1(num(st.x)), r1(num(st.y)), r1(num(st.z)), r2(num(st.yaw)), r1(num(st.speed)), mode, anim];
  if (mode === 1) out.push(st.vehicleType || null, normColor(st.vehicleColor));
  return out;
}

/** Tableau compact (à partir de l'index `o`) -> objet état. */
export function decodeState(a, o = 0) {
  return {
    x: a[o], y: a[o + 1], z: a[o + 2], yaw: a[o + 3], speed: a[o + 4],
    mode: MODES[a[o + 5]] || 'foot', anim: ANIMS[a[o + 6]] || 'idle',
    vehicleType: a[o + 7] || null, vehicleColor: a[o + 8] || null,
  };
}

export const encode = (type, payload) => JSON.stringify(payload ? { t: type, ...payload } : { t: type });

/** Décodage tolérant : retourne null si le message n'est pas un objet JSON { t: string }. */
export function decode(raw) {
  try {
    const m = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    return m && typeof m === 'object' && !Array.isArray(m) && typeof m.t === 'string' ? m : null;
  } catch { return null; }
}

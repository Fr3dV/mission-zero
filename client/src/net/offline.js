// Repli hors-ligne : un « mini-serveur » local qui applique EXACTEMENT les règles du serveur (shared/economy.js)
// et répond avec les mêmes messages de protocole. Profil et biens sauvegardés dans localStorage.
//
// Comme sur le serveur, le profil (argent, voitures, statistiques, cooldowns) est commun à toutes les villes, et
// les biens sont propres à la ville (là-bas : à la salle, qui appartient à une ville). Stockage :
//   mz.offline.v1                 { profile, owners }  — `owners` = biens de PARIS (format d'origine, inchangé)
//   mz.offline.v1.owners.<ville>  { propertyId: { id, name } } pour chaque autre ville
// Une version plus ancienne du jeu, encore ouverte dans un onglet, ne lit et n'écrit que la première clé :
// elle ne peut donc ni voir ni écraser les biens des autres villes.
import { C, S, PROTOCOL_VERSION } from '@shared/protocol.js';
import * as eco from '@shared/economy.js';
import { DEFAULT_CITY, sanitizeCity } from '@shared/cities.js';

const KEY = 'mz.offline.v1';
const RENT_INTERVAL_SEC = 60;
const fmt = (n) => Math.round(n).toLocaleString('fr-FR') + ' Ƶ';

function read(key) { try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : null; } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage plein ou interdit */ } }

/** @param {{name: string, room: string, city?: string, emit: (msg: object) => void}} opts — emit reçoit des messages serveur { t, ... } */
export function createOffline({ name, room, city: rawCity, emit }) {
  const city = sanitizeCity(rawCity);
  const paris = city === DEFAULT_CITY;
  const ownersKey = `${KEY}.owners.${city}`;
  const saved = read(KEY);
  const profile = eco.normalizeProfile(saved?.profile?.id === 'local' ? saved.profile : eco.newProfile('local', name));
  const owners = (paris ? saved?.owners && typeof saved.owners === 'object' && saved.owners : read(ownersKey)) || {};
  const session = { mission: null };
  profile.name = name;
  for (const id of eco.ownedProperties(owners, 'local')) owners[id].name = name;
  let sinceRent = 0;

  function save() {
    if (paris) { write(KEY, { profile, owners }); return; }
    // autre ville : les biens de Paris rangés sous la clé principale sont relus et reportés tels quels
    write(KEY, { profile, owners: read(KEY)?.owners || {} });
    write(ownersKey, owners);
  }
  const me = () => eco.publicProfile(profile, eco.ownedProperties(owners, 'local'));
  const out = (t, payload) => emit({ t, ...payload });
  const lb = () => out(S.LEADERBOARD, { list: [{ id: 'local', name: profile.name, money: profile.money, online: true }] });
  function settle(op, res) {
    if (!res.ok) { out(S.ERROR, { op, code: res.code, text: res.text }); return false; }
    save();
    out(S.PROFILE, res.delta ? { me: me(), delta: res.delta, reason: res.reason } : { me: me() });
    if (res.delta) lb();
    return true;
  }

  const handlers = {
    [C.CHAT](m) { const text = eco.sanitizeChat(m.text); if (text) out(S.CHAT, { from: profile.name, id: 'local', text }); },
    [C.MISSION_START](m) { const id = String(m.id), r = eco.missionStart(profile, session, id, Date.now(), city); if (!r.ok) out(S.MISSION_RESULT, { id, ok: false, reward: 0, code: r.code, reason: r.text }); },
    [C.MISSION_ABORT]() { eco.missionAbort(session); },
    [C.MISSION_COMPLETE](m) {
      const id = String(m.id), r = eco.missionComplete(profile, session, id, Date.now(), city);
      if (!r.ok) return out(S.MISSION_RESULT, { id, ok: false, reward: 0, code: r.code, reason: r.text });
      out(S.MISSION_RESULT, { id, ok: true, reward: r.reward });
      settle(C.MISSION_COMPLETE, r);
    },
    [C.BUY_CAR](m) { settle(C.BUY_CAR, eco.buyCar(profile, String(m.typeId))); },
    [C.SET_ACTIVE_CAR](m) { settle(C.SET_ACTIVE_CAR, eco.setActiveCar(profile, String(m.typeId))); },
    [C.BUY_PROPERTY](m) { if (settle(C.BUY_PROPERTY, eco.buyProperty(profile, owners, String(m.id), city))) out(S.OWNERS, { owners: { ...owners } }); },
    [C.SELL_PROPERTY](m) { if (settle(C.SELL_PROPERTY, eco.sellProperty(profile, owners, String(m.id), city))) out(S.OWNERS, { owners: { ...owners } }); },
    [C.TRANSFER]() { out(S.ERROR, { op: C.TRANSFER, code: 'offline', text: 'Les virements nécessitent une connexion au serveur.' }); },
  };

  function accrue(seconds) {
    const delta = eco.accrue(profile, owners, seconds);
    save();
    if (delta > 0) { out(S.PROFILE, { me: me(), delta, reason: 'loyers' }); lb(); }
  }
  const onHide = () => save();
  addEventListener('pagehide', onHide);

  return {
    /** Message de bienvenue (même forme que le serveur). */
    welcome() {
      save();
      return { t: S.WELCOME, v: PROTOCOL_VERSION, id: 'local', room, city, ts: Date.now(), me: me(), players: [], owners: { ...owners }, lb: [{ id: 'local', name: profile.name, money: profile.money, online: true }], mission: null };
    },
    send(type, payload = {}) { const h = handlers[type]; if (!h) return false; try { h(payload); } catch (e) { console.error('[net hors-ligne]', type, e); } return true; },
    update(dt) { sinceRent += dt; if (sinceRent >= RENT_INTERVAL_SEC) { accrue(sinceRent); sinceRent = 0; } },
    dispose() { removeEventListener('pagehide', onHide); accrue(sinceRent); sinceRent = 0; },
    fmt,
  };
}

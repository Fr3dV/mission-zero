// Outils de test : serveur éphémère (port libre, horloge pilotable) et client WebSocket minimal.
import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { startServer } from './app.js';
import { createStatic } from './static.js';
import { MemoryStore } from './store/memory.js';
import { newProfile } from '../shared/economy.js';
import { PROTOCOL_VERSION, encode, decode } from '../shared/protocol.js';

export async function boot({ store = new MemoryStore(), staticHandler = createStatic({ cacheDir: null }), ...opts } = {}) {
  const clock = { t: Date.now() };
  // statique : cache en mémoire seulement, les tests n'écrivent rien dans .data/
  const app = await startServer({ port: 0, store, staticHandler, now: () => clock.t, ...opts });
  return { ...app, clock, advance(sec) { clock.t += sec * 1000; } };
}

let seq = 0;
/** Crée directement un compte dans le store (avec un solde choisi) et retourne son jeton. */
export function seedPlayer(store, { name = 'Riche', money = 1_000_000 } = {}) {
  const id = 'p' + String(++seq).padStart(16, '0');
  const secret = 'secret-de-test-' + String(seq).padStart(8, '0');
  const p = newProfile(id, name);
  p.money = money;
  p.tokenHash = createHash('sha256').update(secret).digest('hex');
  store.putPlayer(p);
  return { id, token: `${id}.${secret}` };
}

export class Client {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.msgs = []; this.waiters = []; this.closed = null;
    this.ws.on('message', (raw) => { const m = decode(raw); this.msgs.push(m); this.pump(); });
    this.ws.on('close', (code) => { this.closed = code; for (const w of this.waiters) w.ko(new Error(`socket fermée (${code}) en attendant ${w.type}`)); this.waiters = []; });
    this.ws.on('error', () => {});
  }
  open() { return new Promise((ok, ko) => { this.ws.once('open', ok); this.ws.once('error', ko); }); }
  send(type, payload) { this.ws.send(encode(type, payload)); }
  pump() {
    for (const w of [...this.waiters]) {
      const i = this.msgs.findIndex((m) => m.t === w.type && (!w.pred || w.pred(m)));
      if (i < 0) continue;
      this.waiters.splice(this.waiters.indexOf(w), 1);
      clearTimeout(w.timer);
      w.ok(this.msgs.splice(i, 1)[0]);
    }
  }
  /** Attend (et consomme) le prochain message du type donné. */
  next(type, pred, ms = 2000) {
    return new Promise((ok, ko) => {
      const w = { type, pred, ok, ko };
      w.timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); ko(new Error(`délai dépassé en attendant « ${type} »`)); }, ms);
      this.waiters.push(w);
      this.pump();
    });
  }
  /** Envoie une requête et attend la réponse du type donné. */
  ask(type, payload, replyType, pred) { this.msgs = this.msgs.filter((m) => m.t !== replyType); this.send(type, payload); return this.next(replyType, pred); }
  /** Aller-retour ping/pong : garantit que le serveur a traité tout ce qui a été envoyé avant. */
  sync() { return this.ask('ping', { c: 1 }, 'pong'); }
  waitClose() { return this.closed != null ? Promise.resolve(this.closed) : new Promise((ok) => this.ws.once('close', ok)); }
  async close() { if (this.closed != null) return; this.ws.close(); await this.waitClose(); }
}

/** `city` absent = client d'avant le multi-villes (le champ n'est pas envoyé du tout). */
export async function join(app, { name = 'Alice', room = 'test', token, city } = {}) {
  const c = new Client(app.wsUrl);
  await c.open();
  c.send('hello', { v: PROTOCOL_VERSION, name, room, token, city });
  c.welcome = await c.next('welcome');
  return c;
}

/** État du joueur tel que le serveur le diffuse : [id, x, y, z, yaw, speed, mode, anim, …] (après traitement de tout ce qui a été envoyé). */
export async function serverState(app, c) {
  await c.sync();
  c.msgs = c.msgs.filter((m) => m.t !== 'snap');
  app.game.tickSnapshots();
  const snap = await c.next('snap');
  return snap.p.find((p) => p[0] === c.welcome.id) || null;
}

/** Requête HTTP brute (sans décompression automatique) : { status, headers, body: Buffer }. */
export function raw(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((ok, ko) => {
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', ko);
    });
    req.on('error', ko);
    req.end();
  });
}

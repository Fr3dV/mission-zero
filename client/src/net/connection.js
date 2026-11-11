// Connexion WebSocket avec reconnexion automatique (backoff exponentiel + gigue) et chien de garde.
// Cloud Run coupe les WebSocket au bout du timeout de requête (3600 s max) : la reconnexion est le fonctionnement normal.
import { CLOSE, decode, encode } from '@shared/protocol.js';

const BACKOFF_MIN = 500, BACKOFF_MAX = 8000;
const SILENCE_MS = 9000; // aucun message reçu pendant ce délai = connexion morte
const OPEN_TIMEOUT_MS = 6000;

/**
 * @param {{url: string, onOpen: Function, onMessage: Function, onDown: Function, onGiveUp: Function}} h
 *   onOpen() : socket ouverte (envoyer le hello) — onMessage(msg) — onDown({fatal, code, attempts}) : coupure
 */
export function createConnection({ url, onOpen, onMessage, onDown }) {
  let ws = null, timer = null, openTimer = null, attempts = 0, stopped = false, lastRx = 0;

  function connect() {
    clearTimeout(timer);
    if (stopped) return;
    let sock;
    try { sock = new WebSocket(url); } catch { return scheduleRetry(0); }
    ws = sock;
    openTimer = setTimeout(() => { if (sock.readyState !== 1) sock.close(); }, OPEN_TIMEOUT_MS);
    sock.onopen = () => { clearTimeout(openTimer); lastRx = performance.now(); onOpen(); };
    sock.onmessage = (ev) => {
      lastRx = performance.now();
      const m = typeof ev.data === 'string' ? decode(ev.data) : null;
      if (m) { try { onMessage(m); } catch (e) { console.error('[net] message', m.t, e); } }
    };
    sock.onerror = () => { /* 'close' suit */ };
    sock.onclose = (ev) => {
      clearTimeout(openTimer);
      if (ws !== sock) return;
      ws = null;
      if (stopped) return;
      scheduleRetry(ev.code);
    };
  }

  function scheduleRetry(code) {
    const fatal = code === CLOSE.REPLACED || code === CLOSE.REJECTED;
    attempts++;
    const keep = onDown({ fatal, code, attempts }) !== false && !fatal;
    if (!keep) { stopped = true; return; }
    const delay = Math.min(BACKOFF_MAX, BACKOFF_MIN * 1.8 ** (attempts - 1)) * (0.7 + Math.random() * 0.6);
    timer = setTimeout(connect, delay);
  }

  connect();
  return {
    get open() { return !!ws && ws.readyState === 1; },
    send(type, payload) { if (ws && ws.readyState === 1) { ws.send(encode(type, payload)); return true; } return false; },
    /** À appeler quand la session est établie (welcome reçu) : remet le backoff à zéro. */
    established() { attempts = 0; },
    /** Chien de garde, appelé à chaque frame. */
    watchdog() { if (ws && ws.readyState === 1 && performance.now() - lastRx > SILENCE_MS) { lastRx = performance.now(); ws.close(); } },
    close() { stopped = true; clearTimeout(timer); clearTimeout(openTimer); const s = ws; ws = null; try { s?.close(); } catch { /* déjà fermée */ } },
  };
}

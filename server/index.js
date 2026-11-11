// Serveur Mission Zéro : fichiers statiques + WebSocket multijoueur (/ws) sur le même port.
// PROPRIÉTAIRE : agent "serveur/réseau".
// Variables d'environnement : PORT (8080), STORE (file | memory | firestore), DATA_DIR / DATA_FILE (store fichier),
// FIRESTORE_PROJECT / FIRESTORE_DATABASE / FIRESTORE_PREFIX (store Firestore), MAX_CONNECTIONS (1000).
import { startServer } from './app.js';
import { createStore, MemoryStore } from './store/index.js';
import { ROOT } from './static.js';
export { serveStatic } from './static.js';

const PORT = +(process.env.PORT || 8080);
const kind = process.env.STORE || 'file';

let store;
try { store = await createStore({ kind, root: ROOT, port: PORT }); }
catch (e) {
  if (kind === 'firestore') throw e; // en production, pas de repli silencieux vers un stockage volatil
  console.error(`[store] ${kind} indisponible (${e.message}) — repli en mémoire, rien ne sera conservé`);
  store = new MemoryStore();
}

const app = await startServer({ port: PORT, store, log: console.log });
console.log(`Mission Zéro sur http://localhost:${app.port}  (stockage : ${store.kind})`);

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} : sauvegarde et arrêt…`);
  const force = setTimeout(() => { try { store.flushSync?.(); } catch { /* tant pis */ } process.exit(1); }, 8000);
  try { await app.close(); } catch (e) { console.error('[arrêt]', e); process.exitCode = 1; }
  clearTimeout(force);
  process.exit();
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

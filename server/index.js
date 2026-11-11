// Serveur Mission Zéro : fichiers statiques + WebSocket multijoueur (/ws) sur le même port.
// PROPRIÉTAIRE : agent "serveur/réseau".
// Variables d'environnement : PORT (8080), STORE (file | memory | firestore), DATA_DIR / DATA_FILE (store fichier),
// FIRESTORE_PROJECT / FIRESTORE_DATABASE / FIRESTORE_PREFIX (store Firestore), MAX_CONNECTIONS (1000),
// STATIC_CACHE_DIR (.data/static-cache), STATIC_CACHE_MAX_MB (256), STATIC_PREWARM (0 = pas de pré-compression).
import { startServer } from './app.js';
import { createStore, MemoryStore } from './store/index.js';
import { ROOT, PREWARM, defaultStatic } from './static.js';
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

// Pré-compression des gros fichiers (données des villes, Three.js) en tâche de fond, un à la fois : le premier joueur
// n'attend pas la compression d'un fichier de 10 Mo. Sans effet quand le cache est déjà rempli (image Docker, redémarrage).
if (process.env.STATIC_PREWARM !== '0') {
  setTimeout(() => {
    defaultStatic().prewarm({ ...PREWARM, minBytes: 256 * 1024 })
      .then((r) => { if (r.ms > 1000) console.log(`[statique] ${r.files} gros fichiers pré-compressés en ${(r.ms / 1000).toFixed(1)} s`); })
      .catch((e) => console.warn(`[statique] pré-compression : ${e.message}`));
  }, 300).unref();
}

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

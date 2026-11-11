// Assemble le serveur : HTTP statique + WebSocket de jeu sur le même port. Utilisé par index.js et par les tests.
import http from 'node:http';
import { serveStatic, ROOT } from './static.js';
import { createGame } from './game.js';
import { createStore } from './store/index.js';

/**
 * @param {{port?: number, store?: object, storeKind?: string, log?: Function, rentIntervalMs?: number, staticHandler?: Function}} opts
 *   staticHandler : gestionnaire (req, res) des fichiers statiques (défaut : serveStatic ; les tests passent le leur)
 * @returns {Promise<{server, game, store, port, url, wsUrl, close}>}
 */
export async function startServer({ port = 8080, store = null, storeKind, log = () => {}, staticHandler = serveStatic, ...gameOpts } = {}) {
  if (!store) store = await createStore({ kind: storeKind, root: ROOT, port });
  const game = createGame({ store, log, ...gameOpts });
  const server = http.createServer(staticHandler);
  game.attach(server);
  await new Promise((ok, ko) => { server.once('error', ko); server.listen(port, ok); });
  const actual = server.address().port;
  let closing = null;
  const close = () => (closing ||= (async () => {
    await game.shutdown();
    server.closeAllConnections?.();
    await new Promise((ok) => server.close(ok));
  })());
  return { server, game, store, port: actual, url: `http://localhost:${actual}`, wsUrl: `ws://localhost:${actual}/ws`, close };
}

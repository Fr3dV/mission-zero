// Choix du stockage par variable d'environnement STORE = file (défaut) | memory | firestore.
import { join } from 'node:path';
import { MemoryStore } from './memory.js';
import { FileStore } from './file.js';

export async function createStore({ kind = process.env.STORE || 'file', root = process.cwd(), port = 8080 } = {}) {
  let store;
  if (kind === 'memory') store = new MemoryStore();
  else if (kind === 'firestore') {
    const { FirestoreStore } = await import('./firestore.js');
    store = new FirestoreStore({
      prefix: process.env.FIRESTORE_PREFIX || '',
      projectId: process.env.FIRESTORE_PROJECT || undefined,
      databaseId: process.env.FIRESTORE_DATABASE || undefined,
    });
  } else if (kind === 'file') {
    // un fichier par port : plusieurs serveurs de test peuvent tourner dans le même dossier sans s'écraser
    const file = process.env.DATA_FILE || join(process.env.DATA_DIR || join(root, '.data'), `store-${port}.json`);
    store = new FileStore({ file });
  } else throw new Error(`STORE inconnu : ${kind} (attendu : file, memory ou firestore)`);
  await store.init();
  return store;
}
export { MemoryStore, FileStore };

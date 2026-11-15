// Stockage Firestore (Cloud Run) : collections `players` et `rooms`.
// Écritures différées et groupées (WriteBatch) : le jeu écrit souvent, Firestore reçoit au plus un
// lot toutes les `intervalMs`. Authentification par les identifiants par défaut de l'environnement
// (compte de service Cloud Run) : aucun secret dans le code.
const BATCH_MAX = 400; // limite Firestore : 500 opérations par lot

export class FirestoreStore {
  /** @param {{db?: object, prefix?: string, intervalMs?: number, projectId?: string, databaseId?: string}} opts — `db` injectable pour les tests. */
  constructor({ db = null, prefix = '', intervalMs = 5000, projectId, databaseId } = {}) {
    this.kind = 'firestore';
    this.db = db; this.prefix = prefix; this.intervalMs = intervalMs;
    this.projectId = projectId; this.databaseId = databaseId;
    this.pending = { players: new Map(), rooms: new Map() };
    this.flushing = null;
  }
  async init() {
    if (!this.db) {
      const { Firestore } = await import('@google-cloud/firestore');
      const opts = { ignoreUndefinedProperties: true };
      if (this.projectId) opts.projectId = this.projectId;
      if (this.databaseId) opts.databaseId = this.databaseId;
      this.db = new Firestore(opts);
    }
    this.timer = setInterval(() => this.flush().catch((e) => console.error('[firestore] écriture', e.message)), this.intervalMs);
    this.timer.unref?.();
  }
  col(name) { return this.db.collection(this.prefix + name); }
  /**
   * Lecture COHÉRENTE avec les écritures différées : une écriture en attente fait foi ; sinon, tant qu'un lot est en
   * vol, on attend sa fin avant de lire la base. flush() vide `pending` au DÉPART du commit : sans cette attente, une
   * lecture pendant le commit rendrait le document d'avant (salle relue périmée : bien vendu encore possédé, puis
   * revendu). Après un commit raté les enregistrements sont remis dans `pending` ; après un commit réussi la base est
   * à jour. La boucle couvre aussi deux lots enchaînés (une écriture arrivée pendant l'attente fait foi à son tour).
   */
  async get(name, id) {
    for (;;) {
      const p = this.pending[name].get(id);
      if (p) return JSON.parse(JSON.stringify(p)); // écriture pas encore partie : elle fait foi
      if (!this.flushing) break;
      await this.flushing.catch(() => {});
    }
    const snap = await this.col(name).doc(id).get();
    return snap.exists ? snap.data() : null;
  }
  getPlayer(id) { return this.get('players', id); }
  getRoom(code) { return this.get('rooms', code); }
  putPlayer(rec) { this.pending.players.set(rec.id, JSON.parse(JSON.stringify(rec))); }
  putRoom(rec) { this.pending.rooms.set(rec.code, JSON.parse(JSON.stringify(rec))); }
  async flush() {
    // un seul lot en vol à la fois : `flushing` désigne toujours LE commit en cours (get() s'y fie)
    while (this.flushing) await this.flushing.catch(() => {});
    const ops = [];
    for (const name of ['players', 'rooms']) {
      for (const [id, rec] of this.pending[name]) ops.push([name, id, rec]);
      this.pending[name] = new Map();
    }
    if (!ops.length) return;
    this.flushing = (async () => {
      for (let i = 0; i < ops.length; i += BATCH_MAX) {
        const chunk = ops.slice(i, i + BATCH_MAX);
        try {
          const batch = this.db.batch();
          for (const [name, id, rec] of chunk) batch.set(this.col(name).doc(id), rec);
          await batch.commit();
        } catch (e) {
          // échec : on remet en file ce qui n'a pas été remplacé entre-temps par une version plus récente
          for (const [name, id, rec] of ops.slice(i)) if (!this.pending[name].has(id)) this.pending[name].set(id, rec);
          throw e;
        }
      }
    })().finally(() => { this.flushing = null; });
    await this.flushing;
  }
  async close() { clearInterval(this.timer); await this.flush(); }
}

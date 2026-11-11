// Stockage en mémoire (tests, ou base du stockage fichier). Interface commune des stores :
//   init(), getPlayer(id), putPlayer(rec), getRoom(code), putRoom(rec), flush(), close()
// Les enregistrements sont clonés à l'entrée et à la sortie (aucun partage de référence avec le jeu).
const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));

export class MemoryStore {
  constructor() { this.players = new Map(); this.rooms = new Map(); this.dirty = false; this.kind = 'memory'; }
  async init() {}
  async getPlayer(id) { return clone(this.players.get(id)); }
  putPlayer(rec) { this.players.set(rec.id, clone(rec)); this.dirty = true; }
  async getRoom(code) { return clone(this.rooms.get(code)); }
  putRoom(rec) { this.rooms.set(rec.code, clone(rec)); this.dirty = true; }
  async flush() { this.dirty = false; }
  async close() { await this.flush(); }
}

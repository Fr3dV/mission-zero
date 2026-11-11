// Stockage local : mémoire + fichier JSON (écriture atomique tmp + rename, périodique et à l'arrêt).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MemoryStore } from './memory.js';

export class FileStore extends MemoryStore {
  constructor({ file, intervalMs = 15000 } = {}) {
    super();
    this.kind = 'file';
    this.file = file;
    this.intervalMs = intervalMs;
    this.writing = null;
  }
  async init() {
    await mkdir(dirname(this.file), { recursive: true });
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      for (const p of data.players || []) if (p?.id) this.players.set(p.id, p);
      for (const r of data.rooms || []) if (r?.code) this.rooms.set(r.code, r);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // fichier illisible : on le met de côté plutôt que de l'écraser
        console.error(`[store] ${this.file} illisible (${e.message}) — mis de côté`);
        await rename(this.file, `${this.file}.corrompu-${Date.now()}`).catch(() => {});
      }
    }
    this.timer = setInterval(() => this.flush().catch((e) => console.error('[store] écriture', e.message)), this.intervalMs);
    this.timer.unref?.();
  }
  serialize() { return JSON.stringify({ version: 1, savedAt: new Date().toISOString(), players: [...this.players.values()], rooms: [...this.rooms.values()] }); }
  async flush() {
    if (this.writing) await this.writing;
    if (!this.dirty) return;
    this.dirty = false;
    const tmp = `${this.file}.${process.pid}.tmp`;
    this.writing = writeFile(tmp, this.serialize()).then(() => rename(tmp, this.file))
      .catch((e) => { this.dirty = true; throw e; }).finally(() => { this.writing = null; });
    await this.writing;
  }
  /** Sauvegarde synchrone de dernier recours (arrêt brutal). */
  flushSync() {
    if (!this.dirty) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, this.serialize());
    renameSync(tmp, this.file);
    this.dirty = false;
  }
  async close() { clearInterval(this.timer); await this.flush(); }
}

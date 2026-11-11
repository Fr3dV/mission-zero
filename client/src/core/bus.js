// Bus d'événements global (pub/sub synchrone).
const handlers = new Map();
export const bus = {
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type)?.delete(fn);
  },
  off(type, fn) { handlers.get(type)?.delete(fn); },
  emit(type, payload) {
    const set = handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (e) { console.error(`[bus] ${type}`, e); }
    }
  },
};

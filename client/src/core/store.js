import { bus } from './bus.js';

// État partagé côté client. Écrit par net (profil, joueurs, propriétaires) et gameplay (mission).
// Lu par l'UI. Toujours modifier via store.set(patch) pour émettre 'store:change'.
export const store = {
  online: false,
  room: null,
  me: { id: null, name: '', money: 0, properties: [], cars: [], activeCar: null, stats: {} },
  players: new Map(), // id -> { id, name, x, y, z, yaw, mode, vehicleType, money }
  propertyOwners: {}, // propertyId -> { id, name }
  mission: null, // mission active (géré par gameplay)
  timeOfDay: 14, // heure 0..24
  set(patch) {
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (k === 'me') Object.assign(store.me, v);
      else store[k] = v;
    }
    bus.emit('store:change', patch);
  },
};

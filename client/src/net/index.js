// STUB — à remplacer par l'agent "serveur/réseau" : économie locale minimale pour tester hors-ligne.
import { STARTING_MONEY, STARTER_VEHICLE, VEHICLE_BY_ID } from '@shared/catalog.js';
import { PROPERTY_BY_ID } from '@shared/properties.js';
import { MISSION_BY_ID } from '@shared/missions.js';
export function createNet(ctx) {
  const { bus, store } = ctx;
  const pay = (delta, reason) => { store.set({ me: { money: store.me.money + delta } }); bus.emit('money:change', { delta, reason, balance: store.me.money }); };
  bus.on('intent:login', ({ name, room }) => { store.set({ online: false, room, me: { id: 'local', name, money: STARTING_MONEY, properties: [], cars: [STARTER_VEHICLE], activeCar: STARTER_VEHICLE } }); bus.emit('net:welcome', { offline: true }); });
  bus.on('intent:missionComplete', ({ id }) => { const m = MISSION_BY_ID[id]; if (m) { pay(m.reward, 'mission'); bus.emit('mission:result', { id, ok: true, reward: m.reward }); } });
  bus.on('intent:buyProperty', ({ id }) => { const p = PROPERTY_BY_ID[id]; if (!p || store.me.money < p.price) return bus.emit('toast', { text: 'Fonds insuffisants', kind: 'error' }); store.set({ me: { properties: [...store.me.properties, id] }, propertyOwners: { ...store.propertyOwners, [id]: { id: 'local', name: store.me.name } } }); pay(-p.price, 'achat immobilier'); });
  bus.on('intent:buyCar', ({ typeId }) => { const v = VEHICLE_BY_ID[typeId]; if (!v || store.me.money < v.price) return bus.emit('toast', { text: 'Fonds insuffisants', kind: 'error' }); store.set({ me: { cars: [...store.me.cars, typeId] } }); pay(-v.price, 'achat véhicule'); });
  return { update() {} };
}

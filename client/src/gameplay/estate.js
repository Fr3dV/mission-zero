// Immobilier, garages, concessions et voiture personnelle du joueur.
// Aucun achat n'est décidé ici : on ouvre les panneaux de l'UI, qui émet les intent:* vers le module net.
import { PROPERTIES, PROPERTY_BY_ID, PROPERTY_KINDS } from '@shared/properties.js';
import { VEHICLE_BY_ID, STARTER_VEHICLE } from '@shared/catalog.js';
import { DEALERS, PUBLIC_GARAGES } from './places.js';
import { ICON } from './markers.js';

const COLOR = { free: '#3ddc84', mine: '#4cc9f0', other: '#ff6b6b', garage: '#ff9f1c' };
const fmtZ = (n) => `${Math.round(n).toLocaleString('fr-FR')} Ƶ`;

export function createEstate(g) {
  const { ctx, bus, store, markers } = g;
  const { THREE, scene } = ctx;

  // ---- points d'accès (trottoir le plus proche de l'adresse réelle) ----
  const props = PROPERTIES.map((def) => {
    const a = g.accessPoint(def.x, def.z);
    // marqueur de garage décalé de quelques mètres le long de la rue
    return { def, x: a.x, z: a.z, yaw: a.yaw, gx: a.x + (a.dirX ?? 1) * 8, gz: a.z + (a.dirZ ?? 0) * 8 };
  });
  const propById = Object.fromEntries(props.map((p) => [p.def.id, p]));
  const garages = PUBLIC_GARAGES.map((def) => ({ def, ...g.accessPoint(def.x, def.z) }));
  const dealers = DEALERS.map((def) => {
    const onStreet = def.street ? (r) => !!r.name && r.name.includes(def.street) : null;
    const a = g.accessPoint(def.x, def.z, onStreet);
    return { def, x: a.x, z: a.z, yaw: a.yaw ?? 0, dirX: a.dirX ?? 1, dirZ: a.dirZ ?? 0, perpX: a.perpX ?? 0, perpZ: a.perpZ ?? 1, half: a.half ?? 4, ax: a.ax ?? a.x, az: a.az ?? a.z, showroom: null, podiums: [] };
  });

  const myId = () => store.me?.id;
  const ownerOf = (id) => {
    if (store.me?.properties?.includes(id)) return 'mine';
    const o = store.propertyOwners?.[id];
    if (!o) return 'free';
    return o.id != null && o.id === myId() ? 'mine' : 'other';
  };

  // ---------------------------------------------------------------- marqueurs
  let sig = '';
  function refreshMarkers(force) {
    const s = props.map((p) => ownerOf(p.def.id)[0]).join('') + (store.me?.cars?.length || 0);
    if (!force && s === sig) return;
    sig = s;
    const list = [];
    for (const p of props) {
      const o = ownerOf(p.def.id);
      if (o === 'mine') {
        list.push({ x: p.x, z: p.z, color: COLOR.mine, icon: ICON.key, radius: 3, beamH: 75, beamR: 0.8, range: 3000, iconSize: 2.2, iconY: 4.4 });
        if (p.def.garageSlots > 0) list.push({ x: p.gx, z: p.gz, color: COLOR.garage, icon: ICON.garage, radius: 2.6, beamH: 22, beamR: 0.5, range: 500, iconSize: 1.8, iconY: 3.6 });
      } else if (o === 'free') {
        list.push({ x: p.x, z: p.z, color: COLOR.free, icon: ICON.house, radius: 3, beamH: 42, beamR: 0.65, range: 750, iconSize: 2.1, iconY: 4.2 });
      } else {
        list.push({ x: p.x, z: p.z, color: COLOR.other, icon: ICON.lock, radius: 3, beamH: 26, beamR: 0.5, range: 420, iconSize: 1.9, iconY: 4.0 });
      }
    }
    for (const k of garages) list.push({ x: k.x, z: k.z, color: COLOR.garage, icon: ICON.garage, radius: 2.8, beamH: 30, beamR: 0.6, range: 650, iconSize: 2, iconY: 4 });
    for (const d of dealers) list.push({ x: d.x, z: d.z, color: d.def.color, icon: ICON.dealer, radius: 3.4, beamH: 90, beamR: 1.0, range: 2600, iconSize: 2.5, iconY: 5 });
    markers.set('estate', list);
  }
  bus.on('store:change', (patch) => { if (!patch || patch.me || patch.propertyOwners) refreshMarkers(); });

  // ---------------------------------------------------------------- interaction (touche E)
  function collect(px, pz, out) {
    for (const p of props) {
      const o = ownerOf(p.def.id);
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d < 5.5) {
        const kind = PROPERTY_KINDS[p.def.kind]?.label || p.def.kind;
        const text = o === 'free' ? `Visiter : ${p.def.name} — ${fmtZ(p.def.price)}`
          : o === 'mine' ? `Gérer votre bien : ${p.def.name}`
            : `${p.def.name} — propriété de ${store.propertyOwners?.[p.def.id]?.name || 'un autre joueur'}`;
        out.push({ d, key: true, text, sub: `${kind}${p.def.address ? ' · ' + p.def.address : ''} · loyer ${fmtZ(p.def.income)}/h`, action: () => bus.emit('ui:open', { panel: 'property', data: { id: p.def.id } }) });
      }
      if (o === 'mine' && p.def.garageSlots > 0) {
        const dg = Math.hypot(p.gx - px, p.gz - pz);
        if (dg < 5) out.push({ d: dg, key: true, text: `Ouvrir le garage — ${p.def.name}`, sub: `${p.def.garageSlots} place${p.def.garageSlots > 1 ? 's' : ''}`, action: () => bus.emit('ui:open', { panel: 'garage', data: { propertyId: p.def.id } }) });
      }
    }
    for (const k of garages) {
      const d = Math.hypot(k.x - px, k.z - pz);
      if (d < 5.5) out.push({ d, key: true, text: `Ouvrir le garage — ${k.def.name}`, sub: 'Sortez une de vos voitures', action: () => bus.emit('ui:open', { panel: 'garage', data: { garageId: k.def.id } }) });
    }
    for (const dl of dealers) {
      const d = Math.hypot(dl.x - px, dl.z - pz);
      if (d < 6.5) out.push({ d, key: true, text: `Entrer chez ${dl.def.name}`, sub: 'Concession — achat de véhicules', action: () => bus.emit('ui:open', { panel: 'dealer', data: { brand: dl.def.brand, dealerId: dl.def.id } }) });
    }
  }

  // ---------------------------------------------------------------- concessions : podiums et voitures d'exposition
  const podiumGeo = new THREE.CylinderGeometry(3.0, 3.25, 0.35, 28);
  const podiumMat = new THREE.MeshStandardMaterial({ color: 0x1b1e24, metalness: 0.7, roughness: 0.3 });
  const rimGeo = new THREE.TorusGeometry(3.02, 0.06, 6, 40);
  rimGeo.rotateX(Math.PI / 2);

  for (const d of dealers) {
    // Podiums alignés le long de la rue, côté trottoir. Si des immeubles gênent, on essaie plus près de la
    // chaussée, puis le trottoir d'en face ; un podium sans place libre n'est pas posé.
    const n = d.def.show.length;
    const layout = (side, depth) => d.def.show.map((typeId, i) => {
      const along = (i - (n - 1) / 2) * 8.2, off = side * (d.half + depth);
      return { typeId, x: d.ax + d.dirX * along + d.perpX * off, z: d.az + d.dirZ * along + d.perpZ * off };
    });
    let best = null, bestFree = -1;
    for (const [side, depth] of [[1, 6.7], [1, 4.4], [-1, 6.7], [-1, 4.4]]) {
      const l = layout(side, depth).map((p) => ({ ...p, free: g.freeSpot(p.x, p.z, 3.0) }));
      const free = l.filter((p) => p.free).length;
      if (free > bestFree) { best = l; bestFree = free; d.side = side; d.depth = depth; }
      if (free === n) break;
    }
    d.podiums = best.filter((p) => p.free);
    for (const p of d.podiums) {
      try { ctx.collision?.addCircle?.({ x: p.x, z: p.z, r: 3.1, bottom: -1, top: 3, tag: 'dealer' }); } catch { /* collision indisponible */ }
    }
  }

  function makeTotem(d) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 512;
    const c = cv.getContext('2d');
    c.fillStyle = '#0d0f13'; c.fillRect(0, 0, 128, 512);
    c.fillStyle = d.def.color; c.fillRect(0, 0, 128, 14); c.fillRect(0, 498, 128, 14);
    c.save(); c.translate(64, 256); c.rotate(-Math.PI / 2);
    c.fillStyle = '#ffffff'; c.font = '700 64px system-ui, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(d.def.brand.toUpperCase(), 0, 4, 440);
    c.restore();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 0.35), mat);
    mesh.position.y = 3;
    return mesh;
  }

  function buildShowroom(d) {
    const grp = new THREE.Group();
    grp.name = 'dealer-' + d.def.id;
    const rimMat = new THREE.MeshBasicMaterial({ color: d.def.color, toneMapped: false });
    const cars = [];
    for (const p of d.podiums) {
      const y = ctx.heightAt?.(p.x, p.z) ?? 0;
      const pod = new THREE.Mesh(podiumGeo, podiumMat);
      pod.position.set(p.x, y + 0.175, p.z); pod.receiveShadow = true;
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.set(p.x, y + 0.36, p.z);
      grp.add(pod, rim);
      try {
        const spec = VEHICLE_BY_ID[p.typeId];
        const car = ctx.vehicles?.createMesh?.(p.typeId, spec?.colors?.[0]);
        if (car) { car.position.set(p.x, y + 0.35, p.z); car.rotation.y = d.yaw + Math.PI / 2; grp.add(car); cars.push(car); }
      } catch (e) { console.warn('[gameplay] voiture d\'exposition', e); }
    }
    const totem = makeTotem(d);
    const along = (d.def.show.length / 2) * 8.2 + 2.5, off = (d.side ?? 1) * (d.half + Math.max(1.5, (d.depth ?? 6.7) - 3.2));
    const tx = d.ax - d.dirX * along + d.perpX * off, tz = d.az - d.dirZ * along + d.perpZ * off;
    totem.position.x = tx; totem.position.z = tz; totem.position.y += ctx.heightAt?.(tx, tz) ?? 0;
    totem.rotation.y = d.yaw + Math.PI / 2;
    grp.add(totem);
    scene.add(grp);
    d.showroom = { grp, cars, own: [rimMat, totem.material, totem.material.map, totem.geometry] };
  }
  function disposeShowroom(d) {
    const s = d.showroom;
    if (!s) return;
    scene.remove(s.grp);
    for (const o of s.own) o.dispose?.(); // les maillages de voitures appartiennent au module véhicules : on ne les libère pas
    d.showroom = null;
  }

  // ---------------------------------------------------------------- voiture personnelle
  let personal = null;
  function spawnPersonalCar(typeId, opts = {}) {
    if (!ctx.vehicles?.spawn || !VEHICLE_BY_ID[typeId]) return null;
    const p = opts.near || g.playerPos();
    const sp = g.lanePoint(p.x, p.z, 6);
    if (personal) {
      try { if (ctx.player?.vehicle === personal) ctx.player.exitVehicle?.(); ctx.vehicles.remove?.(personal); } catch { /* ignore */ }
      personal = null;
    }
    const color = store.me?.carColors?.[typeId] || opts.color;
    try {
      personal = ctx.vehicles.spawn(typeId, sp.x, sp.z, sp.yaw, color ? { color } : {});
      personal.owner = myId() || 'local';
      personal.personal = true;
    } catch (e) { console.warn('[gameplay] apparition de la voiture', e); }
    return personal;
  }
  function ensurePersonalCar() {
    const typeId = store.me?.activeCar || store.me?.cars?.[0] || STARTER_VEHICLE;
    if (personal && ctx.vehicles?.list?.includes(personal) && personal.typeId === typeId) return personal;
    // adopte une voiture libre du bon modèle déjà garée à côté (évite les doublons avec le module joueur)
    const p = g.playerPos();
    const near = ctx.vehicles?.nearest?.(p.x, p.z, 40, (v) => v.typeId === typeId && !v.driver && !v.remote && !v.mission);
    if (near) { personal = near; near.personal = true; near.owner = myId() || 'local'; return near; }
    return spawnPersonalCar(typeId);
  }

  bus.on('net:welcome', () => { refreshMarkers(true); try { ensurePersonalCar(); } catch (e) { console.warn('[gameplay] voiture personnelle', e); } });

  bus.on('intent:spawnCar', (e) => {
    const typeId = e?.typeId;
    if (!typeId || !store.me?.cars?.includes(typeId)) { g.toast('Vous ne possédez pas ce véhicule.', 'error'); return; }
    if (g.missions?.active?.vehicle && ctx.player?.vehicle === g.missions.active.vehicle) { g.toast('Terminez d\'abord le convoyage en cours.', 'error'); return; }
    const v = spawnPersonalCar(typeId);
    if (v) {
      g.toast(`${v.spec?.name || 'Votre voiture'} vous attend juste à côté.`, 'success');
      bus.emit('gameplay:carSpawned', { typeId, vehicle: v });
    }
  });

  // achat d'une voiture : elle est livrée devant la concession (ou près du joueur)
  let knownCars = null;
  bus.on('store:change', (patch) => {
    if (!patch?.me?.cars) return;
    const cars = store.me.cars || [];
    if (knownCars) {
      const added = cars.find((c) => !knownCars.includes(c));
      if (added && VEHICLE_BY_ID[added]) {
        const v = spawnPersonalCar(added);
        if (v) g.toast(`Votre ${VEHICLE_BY_ID[added].name} est livrée : elle vous attend dehors !`, 'success');
      }
    }
    knownCars = [...cars];
  });
  bus.on('net:welcome', () => { knownCars = [...(store.me?.cars || [])]; });

  // ---------------------------------------------------------------- réapparition
  function homeProperty(preferId) {
    const mine = (store.me?.properties || []).map((id) => propById[id]).filter(Boolean);
    if (!mine.length) return null;
    if (preferId && propById[preferId] && mine.includes(propById[preferId])) return propById[preferId];
    return mine[mine.length - 1]; // dernier bien acquis
  }
  bus.on('intent:respawn', (e = {}) => {
    const player = ctx.player;
    if (!player?.teleport) return;
    const home = e?.home || e?.propertyId ? homeProperty(e.propertyId) : null;
    try {
      if (home) {
        if (player.vehicle) player.exitVehicle?.();
        player.teleport(home.x, home.z, home.yaw ?? 0);
        g.toast(`De retour chez vous : ${home.def.name}.`, 'info');
      } else {
        const p = g.playerPos();
        const sp = g.lanePoint(p.x, p.z, 0);
        player.teleport(sp.x, sp.z, sp.yaw ?? 0);
        g.toast('Vous voilà de retour sur la route.', 'info');
      }
      bus.emit('player:respawn', { home: !!home });
    } catch (err) { console.warn('[gameplay] réapparition', err); }
  });

  refreshMarkers(true);

  let t = 0;
  return {
    props, dealers, garages,
    collect, refreshMarkers, spawnPersonalCar, ensurePersonalCar, homeProperty,
    get personalCar() { return personal; },
    update(dt) {
      // voitures d'exposition : construites seulement à proximité (budget draw calls)
      t += dt;
      if (t > 0.5) {
        t = 0;
        const p = g.playerPos();
        for (const d of dealers) {
          const dist = Math.hypot(d.x - p.x, d.z - p.z);
          if (!d.showroom && dist < 380) buildShowroom(d);
          else if (d.showroom && dist > 520) disposeShowroom(d);
        }
      }
      for (const d of dealers) if (d.showroom) for (const c of d.showroom.cars) c.rotation.y += dt * 0.3;
    },
  };
}

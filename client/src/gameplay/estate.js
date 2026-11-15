// Immobilier, garages, concessions et voiture personnelle du joueur.
// Aucun achat n'est décidé ici : on ouvre les panneaux de l'UI, qui émet les intent:* vers le module net.
import { PROPERTIES, PROPERTY_KINDS } from '@shared/properties.js';
import { VEHICLE_BY_ID, STARTER_VEHICLE } from '@shared/catalog.js';
import { DEALERS, PUBLIC_GARAGES } from './places.js';
import { ICON } from './markers.js';
import { fmtZ } from './text.js';

const COLOR = { free: '#3ddc84', mine: '#4cc9f0', other: '#ff6b6b', garage: '#ff9f1c' };

export function createEstate(g) {
  const { ctx, bus, store, markers } = g;
  const { THREE, scene } = ctx;

  // ---- points d'accès (trottoir le plus proche de l'adresse réelle) ----
  const props = PROPERTIES.map((def) => {
    const a = g.accessPoint(def.x, def.z);
    // marqueur de garage décalé de quelques mètres le long de la rue
    const gx = a.x + (a.dirX ?? 1) * 8, gz = a.z + (a.dirZ ?? 0) * 8;
    return { def, x: a.x, z: a.z, y: a.y, ele: a.ele, yaw: a.yaw, gx, gz, gy: g.groundY(gx, gz, a.ele) };
  });
  const propById = Object.fromEntries(props.map((p) => [p.def.id, p]));
  const garages = PUBLIC_GARAGES.map((def) => ({ def, ...g.accessPoint(def.x, def.z) }));
  const dealers = DEALERS.map((def) => {
    // `street` : nom (partiel) de la voie où se trouve la concession, si elle existe dans les données
    const onStreet = def.street ? (r) => g.isWalkable(r) && !!r.name && r.name.includes(def.street) : g.isWalkable;
    const a = g.accessPoint(def.x, def.z, onStreet);
    return { def, x: a.x, z: a.z, y: a.y, ele: a.ele, yaw: a.yaw ?? 0, dirX: a.dirX ?? 1, dirZ: a.dirZ ?? 0, perpX: a.perpX ?? 0, perpZ: a.perpZ ?? 1, half: a.half ?? 4, ax: a.ax ?? a.x, az: a.az ?? a.z, showroom: null, podiums: [] };
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
        list.push({ x: p.x, z: p.z, y: p.y, color: COLOR.mine, icon: ICON.key, radius: 3, beamH: 75, beamR: 0.8, range: 3000, iconSize: 2.2, iconY: 4.4 });
        if (p.def.garageSlots > 0) list.push({ x: p.gx, z: p.gz, y: p.gy, color: COLOR.garage, icon: ICON.garage, radius: 2.6, beamH: 22, beamR: 0.5, range: 500, iconSize: 1.8, iconY: 3.6 });
      } else if (o === 'free') {
        list.push({ x: p.x, z: p.z, y: p.y, color: COLOR.free, icon: ICON.house, radius: 3, beamH: 42, beamR: 0.65, range: 750, iconSize: 2.1, iconY: 4.2 });
      } else {
        list.push({ x: p.x, z: p.z, y: p.y, color: COLOR.other, icon: ICON.lock, radius: 3, beamH: 26, beamR: 0.5, range: 420, iconSize: 1.9, iconY: 4.0 });
      }
    }
    for (const k of garages) list.push({ x: k.x, z: k.z, y: k.y, color: COLOR.garage, icon: ICON.garage, radius: 2.8, beamH: 30, beamR: 0.6, range: 650, iconSize: 2, iconY: 4 });
    for (const d of dealers) list.push({ x: d.x, z: d.z, y: d.y, color: d.def.color, icon: ICON.dealer, radius: 3.4, beamH: 90, beamR: 1.0, range: 2600, iconSize: 2.5, iconY: 5 });
    markers.set('estate', list);
  }
  bus.on('store:change', (patch) => { if (!patch || patch.me || patch.propertyOwners) refreshMarkers(); });

  // ---------------------------------------------------------------- interaction (touche E)
  function collect(px, pz, out, py) {
    const lvl = (y) => g.sameLevel(py, y, 4, px, pz);
    for (const p of props) {
      const o = ownerOf(p.def.id);
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d < 5.5 && lvl(p.y)) {
        const kind = PROPERTY_KINDS[p.def.kind]?.label || p.def.kind;
        const text = o === 'free' ? `Visiter : ${p.def.name} — ${fmtZ(p.def.price)}`
          : o === 'mine' ? `Gérer votre bien : ${p.def.name}`
            : `${p.def.name} — propriété de ${store.propertyOwners?.[p.def.id]?.name || 'un autre joueur'}`;
        out.push({ d, key: true, text, sub: `${kind}${p.def.address ? ' · ' + p.def.address : ''} · loyer ${fmtZ(p.def.income)}/h`, action: () => bus.emit('ui:open', { panel: 'property', data: { id: p.def.id } }) });
      }
      if (o === 'mine' && p.def.garageSlots > 0) {
        const dg = Math.hypot(p.gx - px, p.gz - pz);
        if (dg < 5 && lvl(p.gy)) out.push({ d: dg, key: true, text: `Ouvrir le garage — ${p.def.name}`, sub: `${p.def.garageSlots} place${p.def.garageSlots > 1 ? 's' : ''}`, action: () => bus.emit('ui:open', { panel: 'garage', data: { propertyId: p.def.id } }) });
      }
    }
    for (const k of garages) {
      const d = Math.hypot(k.x - px, k.z - pz);
      if (d < 5.5 && lvl(k.y)) out.push({ d, key: true, text: `Ouvrir le garage — ${k.def.name}`, sub: 'Sortez une de vos voitures', action: () => bus.emit('ui:open', { panel: 'garage', data: { garageId: k.def.id } }) });
    }
    for (const dl of dealers) {
      const d = Math.hypot(dl.x - px, dl.z - pz);
      if (d < 6.5 && lvl(dl.y)) out.push({ d, key: true, text: `Entrer chez ${dl.def.name}`, sub: 'Concession — achat de véhicules', action: () => bus.emit('ui:open', { panel: 'dealer', data: { brand: dl.def.brand, dealerId: dl.def.id } }) });
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
      const l = layout(side, depth).map((p) => ({ ...p, y: g.groundY(p.x, p.z, d.ele), free: g.freeSpot(p.x, p.z, 3.0, d.y) }));
      const free = l.filter((p) => p.free).length;
      if (free > bestFree) { best = l; bestFree = free; d.side = side; d.depth = depth; }
      if (free === n) break;
    }
    d.podiums = best.filter((p) => p.free);
    for (const p of d.podiums) {
      try { ctx.collision?.addCircle?.({ x: p.x, z: p.z, r: 3.1, bottom: p.y - 1, top: p.y + 3, tag: 'dealer' }); } catch { /* collision indisponible */ }
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
      const y = p.y;
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
    totem.position.x = tx; totem.position.z = tz; totem.position.y += g.groundY(tx, tz, d.ele);
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
  // Une seule voiture personnelle est sortie à la fois. Règle d'or : on ne retire JAMAIS une voiture occupée par
  // le joueur — l'ancienne est mise de côté (`retired`) et ne disparaît qu'une fois qu'il en est descendu.
  let personal = null;
  const RETIRE_SEC = 1; // s après la descente : l'ancienne voiture personnelle s'en va
  const retired = []; // anciennes voitures personnelles encore occupées : { v, t (s depuis que le joueur en est descendu) }
  const wanted = {}; // typeId -> teinte demandée à l'achat (repli si le profil ne porte pas encore carColors)
  const colorOf = (typeId, fallback) => store.me?.carColors?.[typeId] || wanted[typeId] || fallback || undefined;
  const sameColor = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  const inMission = () => !!g.missions?.active;
  const speedOf = () => Math.abs((ctx.player?.vehicle ? ctx.player.vehicle.speed : ctx.player?.speed) || 0);

  /** Retire l'ancienne voiture personnelle, ou la met de côté si le joueur est dedans. */
  function retire(v) {
    if (!v) return;
    if (ctx.player?.vehicle === v) { if (!retired.some((r) => r.v === v)) retired.push({ v, t: 0 }); return; }
    try { ctx.vehicles?.remove?.(v); } catch { /* déjà retirée */ }
  }
  /**
   * Les voitures mises de côté s'en vont une fois le joueur descendu : dès qu'il s'éloigne, remonte ailleurs, ou après
   * 1 s (plus longtemps, F proposait de remonter dans l'ancienne voiture au lieu d'aller à la nouvelle).
   */
  function updateRetired(dt) {
    const p = g.playerPos();
    for (let i = retired.length - 1; i >= 0; i--) {
      const r = retired[i];
      if (ctx.player?.vehicle === r.v) { r.t = 0; continue; }
      r.t += dt;
      if (r.t < RETIRE_SEC && !ctx.player?.vehicle && Math.hypot(r.v.pos.x - p.x, r.v.pos.z - p.z) < 25) continue;
      try { ctx.vehicles?.remove?.(r.v); } catch { /* déjà retirée */ }
      retired.splice(i, 1);
    }
  }
  /** opts = { near, at, color, ahead } ; ahead = mètres le long de la voie, à pied (défaut 6). */
  function spawnPersonalCar(typeId, opts = {}) {
    if (!ctx.vehicles?.spawn || !VEHICLE_BY_ID[typeId]) return null;
    const p = opts.near || g.playerPos();
    let px = p.x, pz = p.z, ahead = opts.ahead ?? 6;
    const pv = opts.near ? null : ctx.player?.vehicle;
    if (pv) {
      ahead = 8; // au volant : un peu plus loin que le capot
      // en roulant : derrière soi, jamais en travers de la route
      if (Math.abs(pv.speed || 0) > 1) { px += Math.sin(pv.yaw) * 12; pz += Math.cos(pv.yaw) * 12; ahead = 0; }
    }
    // sur la chaussée du niveau où se trouve le joueur (pas sur le pont au-dessus de lui)
    const sp = opts.at || g.lanePoint(px, pz, ahead, g.eleOf(p.x, p.z, p.y));
    const old = personal;
    personal = null;
    const color = colorOf(typeId, opts.color);
    try {
      personal = ctx.vehicles.spawn(typeId, sp.x, sp.z, sp.yaw, color ? { color, y: sp.y } : { y: sp.y });
      personal.owner = myId() || 'local';
      personal.personal = true;
    } catch (e) { console.warn('[gameplay] apparition de la voiture', e); personal = old; return null; }
    if (old && old !== personal) { old.personal = false; retire(old); }
    markSig = '';
    return personal;
  }
  function ensurePersonalCar() {
    const typeId = store.me?.activeCar || store.me?.cars?.[0] || STARTER_VEHICLE;
    if (personal && ctx.vehicles?.list?.includes(personal) && personal.typeId === typeId) return personal;
    // adopte une voiture libre du bon modèle déjà garée à côté (évite les doublons avec le module joueur)
    const p = g.playerPos();
    const want = colorOf(typeId);
    const near = ctx.vehicles?.nearest?.(p.x, p.z, 40, (v) => v.typeId === typeId && !v.driver && !v.remote && !v.mission && (!want || sameColor(v.color, want)));
    if (near) { personal = near; near.personal = true; near.owner = myId() || 'local'; markSig = ''; return near; }
    return spawnPersonalCar(typeId);
  }
  /**
   * Ramène la voiture personnelle près du joueur s'il est à pied et qu'elle est loin (fin d'un convoyage).
   * Sans mise en scène : c'est SA voiture, pas une livraison.
   */
  function bringPersonalCar(maxDist = 60) {
    if (!store.me?.id && !store.me?.cars?.length) return null; // pas encore de profil
    if (ctx.player?.mode === 'vehicle') return null;
    const p = g.playerPos();
    const here = personal && ctx.vehicles?.list?.includes(personal) ? personal : null;
    if (here && Math.hypot(here.pos.x - p.x, here.pos.z - p.z) <= maxDist) return here;
    const v = spawnPersonalCar(here?.typeId || store.me?.activeCar || store.me?.cars?.[0] || STARTER_VEHICLE);
    if (v) g.toast(`Votre ${v.spec?.name || 'voiture'} vous attend juste à côté.`, 'info');
    return v;
  }

  // ---- teinte : celle du profil (store.me.carColors), réappliquée après un passage à l'Atelier ----
  let repaint = false;
  function applyPaint() {
    const v = personal;
    if (!v || !ctx.vehicles?.list?.includes(v)) { repaint = false; return; }
    const want = store.me?.carColors?.[v.typeId];
    if (!want || sameColor(v.color, want)) { repaint = false; return; }
    const inside = ctx.player?.vehicle === v;
    // au volant et en mouvement : on attend l'arrêt (une voiture ne change pas de robe en roulant)
    if (inside && Math.abs(v.speed || 0) > 1) { repaint = true; return; }
    repaint = false;
    // pas de changement de teinte à chaud dans le module véhicules : même voiture, même place, robe neuve
    const at = { x: v.pos.x, z: v.pos.z, y: v.pos.y, yaw: v.yaw };
    try {
      if (inside) ctx.player.exitVehicle?.(true);
      ctx.vehicles.remove?.(v);
      personal = null;
      const n = spawnPersonalCar(v.typeId, { at });
      if (n && inside) ctx.player.enterVehicle?.(n);
    } catch (e) { console.warn('[gameplay] peinture', e); }
  }

  // ---- marqueur « Votre voiture » (à pied) et indice violet de la première session ----
  let hint = false, markSig = '', markT = 0;
  let deliveredT = 0; // s restantes du faisceau forcé sur une voiture qui vient d'être livrée
  function refreshCarMarker() {
    const v = personal && ctx.vehicles?.list?.includes(personal) ? personal : null;
    const p = g.playerPos();
    const onFoot = ctx.player?.mode !== 'vehicle';
    const far = v ? Math.hypot(v.pos.x - p.x, v.pos.z - p.z) : 0;
    const show = !!v && onFoot && !v.driver && (hint || far > 14 || deliveredT > 0);
    const sig = show ? `${hint ? 1 : 0}:${Math.round(v.pos.x / 2)}:${Math.round(v.pos.z / 2)}` : '';
    if (sig === markSig) return;
    markSig = sig;
    if (!show) { markers.clear('personal'); return; }
    markers.set('personal', [hint
      // première session : faisceau violet visible de partout (« F — Montez »)
      ? { x: v.pos.x, z: v.pos.z, y: v.pos.y, color: '#c77dff', icon: ICON.car, radius: 0, beamH: 45, beamR: 0.5, range: 1e5, iconSize: 1.4, iconY: 3.4 }
      : { x: v.pos.x, z: v.pos.z, y: v.pos.y, color: COLOR.mine, icon: ICON.car, radius: 0, beamH: 16, beamR: 0.35, range: 900, iconSize: 1.7, iconY: 3.6 }]);
  }
  /** Indice violet sur la voiture personnelle (première session) ; s'éteint dès qu'on monte dans une voiture. */
  function setCarHint(on) { hint = !!on; markSig = '\0'; }
  bus.on('player:enterVehicle', (e) => { if (e?.vehicle === personal) deliveredT = 0; if (hint) setCarHint(false); else markSig = '\0'; });
  bus.on('player:exitVehicle', () => { markSig = '\0'; });

  bus.on('net:welcome', () => { refreshMarkers(true); try { ensurePersonalCar(); } catch (e) { console.warn('[gameplay] voiture personnelle', e); } });

  bus.on('intent:spawnCar', (e) => {
    const typeId = e?.typeId;
    if (!typeId || !store.me?.cars?.includes(typeId)) { g.toast('Vous ne possédez pas ce véhicule.', 'error'); return; }
    const why = g.guard?.('spawnCar', typeId);
    if (why) { g.toast(why, 'error'); return; }
    if (g.missions?.active?.vehicle && ctx.player?.vehicle === g.missions.active.vehicle) { g.toast('Terminez d\'abord le convoyage en cours.', 'error'); return; }
    if (personal && personal.typeId === typeId && ctx.player?.vehicle === personal) { g.toast('Vous êtes déjà à son volant.', 'info'); return; }
    const v = spawnPersonalCar(typeId);
    if (v) {
      g.toast(`${v.spec?.name || 'Votre voiture'} vous attend juste à côté.`, 'success');
      bus.emit('gameplay:carSpawned', { typeId, vehicle: v });
    }
  });

  // ---- achat d'une voiture : livraison en fanfare, tout de suite à pied, sinon au prochain arrêt ----
  const FANFARE_ORBIT = 3.2; // s (la caméra rend la main à la première touche)
  const DELIVER_AHEAD = 3.6; // m devant un joueur à pied : à portée de portière (F porte à 4 m)
  const DELIVER_REACH = 3.95; // m : en deçà, « F pour monter » est vrai sans faire un pas (F porte à 4 m, 5 cm de marge)
  const DELIVER_BEAM = 20;   // s de faisceau « Votre voiture » sur la voiture livrée
  let delivery = null; // { typeId, still } : livraison en attente d'un arrêt
  /** La teinte choisie à l'achat (l'UI l'émet avec intent:buyCar) sert de repli tant que le profil ne la porte pas. */
  bus.on('intent:buyCar', (e) => { if (e?.typeId && typeof e.color === 'string') wanted[e.typeId] = e.color; });
  /** Hors mission, hors course de taxi, hors Chiche (g.busy est fourni par index.js). */
  const free = () => !inMission() && !g.busy?.();
  const uiOpen = () => { try { return !!ctx.ui?.isOpen?.(); } catch { return false; } };
  function fanfare(typeId, closePanel) {
    const driving = ctx.player?.mode === 'vehicle';
    const v = spawnPersonalCar(typeId, driving ? {} : { ahead: DELIVER_AHEAD });
    if (!v) return null;
    const name = v.spec?.name || VEHICLE_BY_ID[typeId]?.name || 'Votre voiture';
    if (closePanel) bus.emit('ui:close', { panel: 'dealer' }); // commande : le panneau de la concession se ferme, place au spectacle
    try { ctx.player?.camera?.orbit?.({ x: v.pos.x, z: v.pos.z, y: v.pos.y, dur: FANFARE_ORBIT }); } catch { /* caméra sans orbite */ }
    // le sous-titre dit ce que F fera vraiment : la voiture est recalée sur la voie, donc parfois à plus de 4 m du joueur ;
    // au volant, F fait d'abord descendre. Au tactile : aucun libellé de touche.
    const p = g.playerPos(), d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z), tactile = !!g.touch?.();
    // même test que la touche F (player/index.js, vehicleTarget) : SA voiture à 4 m centre à centre, sinon la voiture libre
    // la plus proche à moins de 4 m de son FLANC (une voiture longue se prend jusqu'à ~5 m du centre), sauf si une voiture
    // du trafic à l'arrêt, plus proche, prendrait la touche (vol) ; les voitures d'un autre niveau (pont, trémie) ne comptent pas
    const reach = (ok) => ctx.vehicles?.nearest?.(p.x, p.z, DELIVER_REACH, (c) => ok(c) && Math.abs((c.pos?.y ?? p.y) - p.y) <= 2.5) || null;
    const thief = () => { const a = reach((c) => c.driver === 'ai' && Math.abs(c.speed || 0) <= 4.2); return !!a && Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < d; };
    const inReach = d <= DELIVER_REACH || (reach((c) => !c.driver && !c.remote) === v && !thief());
    // (formules sans genre : le titre du bandeau est le nom du modèle — « Taxi Parisien », « Citadine »…)
    const sub = driving ? (tactile ? 'Juste devant vous — descendez pour en prendre le volant' : 'Juste devant vous — descendez (F) pour en prendre le volant')
      : inReach ? (tactile ? 'Juste à côté de vous — montez !' : 'Juste à côté de vous — F pour monter')
        : tactile ? 'À quelques pas devant vous — approchez et montez' : 'À quelques pas devant vous — approchez, puis F';
    deliveredT = DELIVER_BEAM; markSig = '\0'; // faisceau « Votre voiture » dès la descente, même à quelques mètres
    bus.emit('ui:banner', { kind: 'gold', eyebrow: 'Nouvelle voiture', title: name, sub, ms: 4200 });
    bus.emit('gameplay:carDelivered', { typeId, name, color: v.color, vehicle: v });
    return v;
  }
  function deliver(typeId) {
    // à pied et hors activité : tout de suite ; au volant, en mission ou en course : rien ne bouge avant le prochain arrêt
    if (ctx.player?.mode !== 'vehicle' && free()) fanfare(typeId, true);
    else delivery = { typeId, still: 0 };
  }
  let knownCars = null;
  bus.on('store:change', (patch) => {
    if (patch?.me?.carColors) applyPaint();
    if (!patch?.me?.cars) return;
    const cars = store.me.cars || [];
    if (knownCars) {
      const added = cars.find((c) => !knownCars.includes(c));
      if (added && VEHICLE_BY_ID[added]) deliver(added);
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
    const why = g.guard?.('respawn');
    if (why) { g.toast(why, 'error'); return; }
    const home = e?.home || e?.propertyId ? homeProperty(e.propertyId) : null;
    try {
      if (home) {
        if (player.vehicle) player.exitVehicle?.();
        player.teleport(home.x, home.z, home.yaw ?? 0, home.y);
        g.toast(`De retour chez vous : ${home.def.name}.`, 'info');
      } else {
        // la rue la plus proche, au niveau de la rue : on ne replace jamais le joueur sous un pont ni dans une trémie,
        // et le 4e paramètre de teleport porte la hauteur de la chaussée choisie
        const p = g.playerPos();
        const sp = g.lanePoint(p.x, p.z, 0);
        player.teleport(sp.x, sp.z, sp.yaw ?? 0, sp.y);
        g.toast('Vous voilà de retour sur la route.', 'info');
      }
      bus.emit('player:respawn', { home: !!home });
    } catch (err) { console.warn('[gameplay] réapparition', err); }
  });

  refreshMarkers(true);

  let t = 0;
  return {
    props, dealers, garages,
    collect, refreshMarkers, spawnPersonalCar, ensurePersonalCar, bringPersonalCar, setCarHint, homeProperty,
    get personalCar() { return personal; },
    /** true si une livraison attend le prochain arrêt du joueur. */
    get deliveryPending() { return !!delivery; },
    update(dt) {
      if (retired.length) updateRetired(dt);
      // livraison différée : au prochain arrêt (moins de 1 m/s pendant 1 s), hors activité et hors menu
      if (delivery) {
        delivery.still = free() && speedOf() < 1 && !uiOpen() ? delivery.still + dt : 0;
        if (delivery.still >= 1) { const typeId = delivery.typeId; delivery = null; fanfare(typeId, false); }
      }
      if (repaint) applyPaint();
      if (deliveredT > 0) { deliveredT -= dt; if (deliveredT <= 0) markSig = '\0'; }
      markT += dt;
      if (markT > 0.4) { markT = 0; refreshCarMarker(); }
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

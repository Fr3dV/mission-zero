// Joueurs distants : tampon d'instantanés, interpolation (~120 ms de retard), rendu des avatars,
// de leurs voitures et des étiquettes de pseudo. N'utilise que les contrats de player (createCharacter)
// et vehicles (spawn / setTransform / remove), importés ou appelés défensivement.
import * as playerModule from '../player/index.js';
import { INTERP_DELAY_MS, decodeState } from '@shared/protocol.js';

const MAX_EXTRAPOLATION_MS = 220;
const STALE_MS = 3000; // plus d'instantané depuis ce délai : avatar masqué
const TELEPORT_DIST = 45; // saut entre deux échantillons : pas d'interpolation
const LABEL_MAX_DIST = 260;
const PALETTE = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff924c', '#52a675', '#4267ac', '#c75d9b', '#36c9c6'];

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }

export function createRemotes(ctx, players) {
  const { THREE, scene } = ctx;
  const entries = new Map(); // id -> entrée de rendu
  let offset = null; // horloge serveur - horloge locale (ms), lissée

  // ------------------------------------------------------------------ étiquette de pseudo (sprite canvas)
  // Les étiquettes sont rangées sous une THREE.Line vide et invisible : les passes d'occlusion ambiante (GTAO)
  // masquent lignes et points pendant leur G-buffer, ce qui évite un rectangle d'ombre autour de chaque sprite.
  const labelRoot = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ visible: false }));
  labelRoot.name = 'net:étiquettes';
  labelRoot.frustumCulled = false;
  scene.add(labelRoot);
  function makeLabel(name, color) {
    const H = 64, font = '700 36px system-ui, -apple-system, "Segoe UI", sans-serif';
    const canvas = document.createElement('canvas');
    let g = canvas.getContext('2d');
    g.font = font;
    const W = Math.ceil(Math.min(420, g.measureText(name).width + 64));
    canvas.width = W; canvas.height = H; // redimensionner réinitialise le contexte
    g = canvas.getContext('2d');
    g.font = font;
    g.fillStyle = 'rgba(8, 11, 18, 0.78)';
    g.beginPath();
    if (g.roundRect) g.roundRect(2, 6, W - 4, H - 12, 26); else g.rect(2, 6, W - 4, H - 12);
    g.fill();
    g.fillStyle = color;
    g.beginPath(); g.arc(24, H / 2, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(name, 42, H / 2 + 2, W - 58);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; // texte net même réduit
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 10;
    sprite.name = 'pseudo:' + name;
    sprite.userData.aspect = W / H;
    return sprite;
  }
  function disposeLabel(e) {
    if (!e.label) return;
    e.label.removeFromParent();
    e.label.material.map?.dispose(); e.label.material.dispose();
    e.label = null;
  }

  // ------------------------------------------------------------------ avatar à pied
  function fallbackCharacter(color) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color }));
    mesh.position.y = 0.85; group.add(mesh);
    return { group, setState() {}, update() {}, dispose() { mesh.geometry.dispose(); mesh.material.dispose(); } };
  }
  function ensureCharacter(e) {
    if (e.char) return e.char;
    try { e.char = playerModule.createCharacter?.(ctx, { color: e.color, name: e.name }) || null; }
    catch (err) { if (!ensureCharacter.warned) { ensureCharacter.warned = true; console.warn('[net] createCharacter indisponible', err); } }
    if (!e.char?.group) e.char = fallbackCharacter(e.color);
    if (!e.char.group.parent) scene.add(e.char.group);
    return e.char;
  }
  function dropCharacter(e) {
    if (!e.char) return;
    try { e.char.dispose?.(); } catch { /* module joueur en cours de réécriture */ }
    e.char.group?.removeFromParent();
    e.char = null;
  }

  // ------------------------------------------------------------------ voiture
  function ensureVehicle(e, s) {
    const key = `${s.vehicleType}|${s.vehicleColor || ''}`;
    if (e.vehicle && e.vehicleKey === key) return e.vehicle;
    dropVehicle(e);
    if (!ctx.vehicles?.spawn) return null;
    try {
      const opts = { remote: true, id: 'net:' + e.id };
      if (s.vehicleColor) opts.color = s.vehicleColor;
      e.vehicle = ctx.vehicles.spawn(s.vehicleType, s.x, s.z, s.yaw, opts) || null;
      if (e.vehicle) { e.vehicle.driver = e.id; e.vehicleKey = key; }
    } catch (err) { console.warn('[net] spawn véhicule distant', err); e.vehicle = null; }
    return e.vehicle;
  }
  function dropVehicle(e) {
    if (!e.vehicle) return;
    try { ctx.vehicles?.remove?.(e.vehicle); } catch (err) { console.warn('[net] remove véhicule distant', err); }
    e.vehicle = null; e.vehicleKey = null;
  }

  function entry(id) {
    let e = entries.get(id);
    if (!e) {
      const name = players.get(id)?.name || 'Joueur';
      e = { id, name, color: PALETTE[hash(id) % PALETTE.length], buf: [], char: null, vehicle: null, vehicleKey: null, label: null, lastRx: 0 };
      entries.set(id, e);
    }
    return e;
  }
  function remove(id) {
    const e = entries.get(id);
    if (!e) return;
    dropVehicle(e); dropCharacter(e); disposeLabel(e);
    entries.delete(id);
  }

  /** Instantané serveur : { ts, p: [[id, ...état], ...] }. */
  function onSnapshot(m, selfId) {
    if (!Array.isArray(m.p) || typeof m.ts !== 'number') return;
    const local = performance.now();
    const sample = m.ts - local;
    offset = offset == null || Math.abs(sample - offset) > 400 ? sample : offset + (sample - offset) * 0.05;
    for (const row of m.p) {
      const id = row[0];
      if (id === selfId || typeof id !== 'string') continue;
      const e = entry(id);
      const s = decodeState(row, 1);
      s.t = m.ts;
      e.buf.push(s);
      if (e.buf.length > 24) e.buf.splice(0, e.buf.length - 24);
      e.lastRx = local;
    }
  }

  /** État interpolé à l'instant serveur `t` (ou null si rien d'exploitable). */
  function sample(e, t) {
    const buf = e.buf;
    if (!buf.length) return null;
    while (buf.length > 2 && buf[1].t <= t) buf.shift(); // garde un échantillon avant t
    const a = buf[0], b = buf[1];
    if (!b || t <= a.t) return a;
    const far = Math.hypot(b.x - a.x, b.z - a.z) > TELEPORT_DIST;
    if (t >= b.t) {
      // tampon à sec : courte extrapolation le long du dernier segment
      const over = Math.min(t - b.t, MAX_EXTRAPOLATION_MS), span = b.t - a.t;
      if (far || span <= 0 || over <= 0) return b;
      const k = over / span;
      return { ...b, x: b.x + (b.x - a.x) * k, z: b.z + (b.z - a.z) * k };
    }
    if (far) return b;
    const k = (t - a.t) / (b.t - a.t);
    const near = k < 0.5 ? a : b;
    return {
      x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), yaw: lerpAngle(a.yaw, b.yaw, k), speed: lerp(a.speed, b.speed, k),
      mode: near.mode, anim: near.anim, vehicleType: near.vehicleType, vehicleColor: near.vehicleColor,
    };
  }

  function update(dt) {
    if (offset == null) return;
    const local = performance.now();
    const t = local + offset - INTERP_DELAY_MS;
    const cam = ctx.camera.position;
    for (const e of entries.values()) {
      const info = players.get(e.id);
      if (!info) { remove(e.id); continue; } // le joueur a quitté la salle
      if (info.name && info.name !== e.name) { e.name = info.name; disposeLabel(e); }
      const s = local - e.lastRx > STALE_MS ? null : sample(e, t);
      if (!s) {
        dropVehicle(e);
        if (e.char) e.char.group.visible = false;
        if (e.label) e.label.visible = false;
        continue;
      }
      let top = 1.95, y = s.y;
      const inCar = s.mode === 'vehicle' && s.vehicleType;
      const v = inCar ? ensureVehicle(e, s) : (dropVehicle(e), null);
      if (v) {
        try { v.setTransform(s.x, s.z, s.yaw, s.speed); } catch { /* module véhicules en cours de réécriture */ }
        y = v.pos?.y ?? ctx.heightAt?.(s.x, s.z) ?? s.y;
        top = (v.spec?.height || 1.5) + 0.35;
        if (e.char) e.char.group.visible = false;
      } else {
        const ch = ensureCharacter(e);
        ch.group.visible = true;
        ch.group.position.set(s.x, s.y, s.z);
        ch.group.rotation.y = s.yaw;
        try { ch.setState?.({ anim: inCar ? 'sit' : s.anim, speed: Math.abs(s.speed) }); ch.update?.(dt); } catch { /* idem */ }
      }
      // étiquette : taille compensée par la distance, masquée au loin
      const dist = Math.hypot(cam.x - s.x, cam.y - y, cam.z - s.z);
      if (dist < LABEL_MAX_DIST) {
        if (!e.label) { e.label = makeLabel(e.name, e.color); labelRoot.add(e.label); }
        const k = Math.max(0.42, Math.min(10, dist * 0.042)); // hauteur en mètres : taille apparente constante au-delà de ~12 m
        e.label.visible = true;
        e.label.scale.set(k * e.label.userData.aspect, k, 1);
        e.label.position.set(s.x, y + top + k * 0.5, s.z);
      } else if (e.label) e.label.visible = false;
      // état lisible par l'UI (minicarte, liste des joueurs)
      info.x = s.x; info.y = y; info.z = s.z; info.yaw = s.yaw; info.speed = s.speed; info.mode = s.mode; info.vehicleType = inCar ? s.vehicleType : null;
    }
  }

  function clear() { for (const id of [...entries.keys()]) remove(id); offset = null; }

  return { onSnapshot, update, remove, clear, entries };
}

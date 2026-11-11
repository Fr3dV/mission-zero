// Module « joueur » : entrées, personnage animé, contrôleur à pied, montée/descente de véhicule, caméra 3e personne.
// Contrat : voir docs/ARCHITECTURE.md (ctx.player + export createCharacter).
import { STARTER_VEHICLE } from '@shared/catalog.js';
import { createCharacter, SIT_ROOT_Y } from './character.js';
import { createInput } from './input.js';
import { createCameraRig, CAMERA_VIEWS } from './camera.js';

export { createCharacter };

const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const WALK_SPEED = 2.5, RUN_SPEED = 6.4, RADIUS = 0.32;
const JUMP_SPEED = 4.9, GRAVITY = 14;
const ENTER_DIST = 4, EXIT_MAX_SPEED = 15 / 3.6;
const VIEW_LABEL = { proche: 'Caméra proche', loin: 'Caméra éloignée', capot: 'Caméra capot' };

export function createPlayer(ctx) {
  const { scene, heightAt, collision, bus, params } = ctx;
  const input = createInput(ctx);

  // --- position de départ : sur une chaussée près de la Concorde
  let start = { x: 30, z: 60, yaw: 0 };
  try {
    const rp = ctx.world?.nearestRoadPoint?.(30, 60);
    if (rp && Number.isFinite(rp.x) && Number.isFinite(rp.z)) start = { x: rp.x, z: rp.z, yaw: rp.yaw || 0 };
  } catch { /* monde pas prêt : position par défaut */ }

  let character = createCharacter(ctx, { name: params?.get?.('name') || 'Joueur', lod: false });
  scene.add(character.group);

  const p = {
    pos: { x: start.x, y: heightAt(start.x, start.z), z: start.z },
    yaw: start.yaw, speed: 0, mode: 'foot', vehicle: null, character, enabled: true, input,
    anim: 'idle', grounded: true,
    /** true = affiche la pastille d'indication intégrée (inutile si l'interface écoute `player:prompt`, ce qui est le cas) */
    promptUI: params?.get?.('promptui') === '1',
    /** true = le conducteur local est visible, assis dans la voiture */
    showDriver: true,
    camera: null,
    teleport, enterVehicle, exitVehicle, getNetState, update, setAppearance,
  };
  const cam = createCameraRig(ctx, p, input);
  p.camera = cam;
  cam.snap(p.yaw);

  let vx = 0, vz = 0, vy = 0;
  let promptText = null, promptTimer = 0, lastExitToast = -10;

  // ------------------------------------------------------------------ pastille d'indication (repli si l'UI ne gère pas player:prompt)
  let chip = null;
  function showChip(text) {
    if (!ctx.uiRoot) return;
    if (!p.promptUI || !text) { if (chip) chip.style.opacity = '0'; return; }
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'mz-player-prompt';
      chip.style.cssText = 'position:absolute;left:50%;bottom:17%;transform:translateX(-50%);padding:9px 16px 9px 10px;border-radius:12px;background:rgba(12,16,24,.72);color:#fff;font:600 15px/1.2 system-ui,sans-serif;letter-spacing:.01em;backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 24px rgba(0,0,0,.35);transition:opacity .18s;pointer-events:none;white-space:nowrap;display:flex;align-items:center;gap:10px';
      ctx.uiRoot.appendChild(chip);
    }
    const m = /^(\S+)\s+—\s+(.*)$/.exec(text);
    chip.textContent = '';
    if (m) {
      const key = document.createElement('span');
      key.textContent = m[1];
      key.style.cssText = 'display:inline-flex;min-width:26px;height:26px;padding:0 6px;box-sizing:border-box;align-items:center;justify-content:center;border-radius:7px;background:#fff;color:#10141c;font-weight:800;font-size:14px';
      chip.append(key, document.createTextNode(m[2]));
    } else chip.textContent = text;
    chip.style.opacity = '1';
  }
  function setPrompt(text) {
    if (text === promptText) return;
    promptText = text;
    bus.emit('player:prompt', { text });
    showChip(text);
  }

  // ------------------------------------------------------------------ véhicules
  const vehicleName = (v) => v.spec?.name || 'le véhicule';
  function nearestFreeVehicle() {
    return ctx.vehicles?.nearest?.(p.pos.x, p.pos.z, ENTER_DIST, (v) => !v.driver && !v.remote) || null;
  }
  /** Installe le personnage dans le siège conducteur (vehicle.seat = {x, y = hauteur du bassin, z} si fourni). */
  function seatCharacter(v) {
    const st = v.seat || v.spec?.seat, spec = v.spec || {};
    const h = spec.height || 1.45, w = spec.width || 1.8, sc = character.scale || 1;
    let hips = st?.y ?? clamp(h * 0.62 - 0.46, 0.2, 0.7);
    // garde au toit : on incline le dossier (et on abaisse un peu le bassin) si la tête dépasserait
    const torso = 0.87 * sc, room = h - 0.05 - hips;
    let recline = 0.3;
    if (room < torso * Math.cos(recline)) recline = Math.min(0.72, Math.acos(clamp(room / torso, 0.3, 1)));
    if (room < torso * Math.cos(recline)) hips -= Math.min(0.12, torso * Math.cos(recline) - room);
    const gy = hips - SIT_ROOT_Y * sc;
    v.group.add(character.group);
    character.group.position.set(st?.x ?? -w * 0.2, gy, st?.z ?? 0.12);
    character.group.rotation.set(0, 0, 0);
    // volant : même convention que le module véhicules (0,36 m devant et au-dessus du bassin)
    const wh = v.wheelPos || { x: 0, y: (st?.y ?? hips) + 0.36 - gy, z: -0.36 - 0.02, r: 0.175 };
    character.setState({ anim: 'sit', speed: 0, recline, wheel: wh, steer: 0 });
    character.snap();
    character.setShadow(false);
  }
  function unseatCharacter() {
    scene.add(character.group);
    character.group.rotation.set(0, p.yaw, 0);
    character.group.visible = true;
    character.setShadow(true);
    character.setState({ anim: 'idle', speed: 0, wheel: null });
    character.snap();
  }

  function enterVehicle(v) {
    if (!v || p.vehicle === v) return false;
    if (p.vehicle) exitVehicle(true);
    p.vehicle = v; v.driver = 'local'; p.mode = 'vehicle'; p.anim = 'sit';
    vx = vz = vy = 0; p.grounded = true;
    if (v.group) seatCharacter(v); else character.group.visible = false;
    cam.transition();
    setPrompt(null);
    bus.emit('player:enterVehicle', { vehicle: v });
    return true;
  }

  /** Cherche un emplacement libre autour du véhicule (côté conducteur d'abord). */
  function findExitSpot(v) {
    const spec = v.spec || {};
    const side = (spec.width || 1.8) / 2 + 0.75, half = (spec.length || 4.2) / 2 + 0.8;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw); // avant
    const lx = -Math.cos(v.yaw), lz = Math.sin(v.yaw);  // gauche (côté conducteur)
    const tries = [[side, 0.1], [side, -1.1], [side, 1.2], [-side, 0.1], [-side, -1.1], [-side, 1.2], [0, -half], [0, half], [side + 0.8, 0], [-side - 0.8, 0]];
    for (const [l, f] of tries) {
      const x = v.pos.x + lx * l + fx * f, z = v.pos.z + lz * l + fz * f;
      const y = heightAt(x, z);
      if (collision?.test?.(x, z, RADIUS + 0.05, y + 0.9)) continue;
      if (ctx.world?.isWater?.(x, z)) continue;
      if (hitsVehicle(x, z, v)) continue;
      return { x, z };
    }
    return null;
  }
  function hitsVehicle(x, z, except) {
    const list = ctx.vehicles?.list; if (!list) return false;
    for (const o of list) {
      if (o === except || !o.pos) continue;
      const dx = x - o.pos.x, dz = z - o.pos.z;
      if (dx * dx + dz * dz > 36) continue;
      const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < (o.spec?.width || 1.8) / 2 + RADIUS && Math.abs(lz) < (o.spec?.length || 4.2) / 2 + RADIUS) return true;
    }
    return false;
  }

  function exitVehicle(force = false) {
    const v = p.vehicle;
    if (!v) return false;
    if (!force && Math.abs(v.speed || 0) > EXIT_MAX_SPEED) {
      if ((ctx.time || 0) - lastExitToast > 2) { lastExitToast = ctx.time || 0; bus.emit('toast', { text: 'Ralentis pour descendre du véhicule', kind: 'info' }); }
      return false;
    }
    const spot = findExitSpot(v);
    if (!spot && !force) {
      if ((ctx.time || 0) - lastExitToast > 2) { lastExitToast = ctx.time || 0; bus.emit('toast', { text: 'Pas assez de place pour descendre ici', kind: 'error' }); }
      return false;
    }
    if (v.driver === 'local') v.driver = null;
    v.setControls?.({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    const s = spot || { x: v.pos.x - Math.cos(v.yaw) * 2, z: v.pos.z + Math.sin(v.yaw) * 2 };
    p.pos.x = s.x; p.pos.z = s.z; p.pos.y = heightAt(s.x, s.z);
    p.yaw = v.yaw; p.speed = 0; vx = vz = vy = 0; p.grounded = true;
    p.vehicle = null; p.mode = 'foot'; p.anim = 'idle';
    unseatCharacter();
    character.group.position.set(p.pos.x, p.pos.y, p.pos.z);
    cam.transition();
    bus.emit('player:exitVehicle', { vehicle: v });
    return true;
  }

  function toggleVehicle() {
    if (p.vehicle) return exitVehicle();
    const v = nearestFreeVehicle();
    if (v) enterVehicle(v);
  }

  // ------------------------------------------------------------------ API
  function teleport(x, z, yaw = p.yaw) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (p.vehicle) p.vehicle.setTransform?.(x, z, yaw, 0);
    p.pos.x = x; p.pos.z = z; p.pos.y = heightAt(x, z); p.yaw = yaw; p.speed = 0;
    vx = vz = vy = 0; p.grounded = true;
    if (!p.vehicle) { character.group.position.set(x, p.pos.y, z); character.group.rotation.y = yaw; }
    cam.snap(yaw);
  }

  function getNetState() {
    const v = p.vehicle;
    // anim limitée aux valeurs du contrat (les sauts sont transmis comme « run »/« idle »)
    const anim = v ? 'sit' : p.anim === 'jump' || p.anim === 'fall' ? (p.speed > 3.6 ? 'run' : 'idle') : p.anim;
    return {
      x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, speed: p.speed, mode: p.mode, anim,
      vehicleType: v?.typeId || null, vehicleColor: v?.color || null,
    };
  }

  /** Change l'apparence du personnage local ({ color, skin, name }). */
  function setAppearance(opts = {}) {
    const old = character;
    const parent = old.group.parent || scene;
    character = createCharacter(ctx, opts);
    character.group.position.copy(old.group.position);
    character.group.rotation.copy(old.group.rotation);
    character.group.visible = old.group.visible;
    parent.add(character.group);
    character.setState({ anim: p.anim, speed: p.speed });
    character.snap();
    old.dispose();
    p.character = character;
    if (p.vehicle?.group) seatCharacter(p.vehicle);
  }

  // ------------------------------------------------------------------ événements
  input.on('vehicle', toggleVehicle);
  input.on('interact', () => bus.emit('player:interact', {}));
  input.on('camera', () => {
    const name = cam.nextView();
    if (p.vehicle) bus.emit('toast', { text: VIEW_LABEL[name] || name, kind: 'info' });
    else cam.footDist = [3.2, 4.6, 6.5][cam.view];
  });
  bus.on('vehicle:crash', (e) => { if (e?.vehicle && e.vehicle === p.vehicle) cam.shake(clamp((e.impact || 5) / 25, 0.15, 0.9)); });
  bus.on('net:welcome', () => {
    const me = ctx.store?.me;
    if (me?.name && character.group.name !== 'personnage:' + me.name) setAppearance({ name: me.name, color: me.color, skin: me.skin, lod: false });
  });

  // ------------------------------------------------------------------ boucle
  function updateFoot(dt) {
    const st = input.state;
    // direction voulue, relative à la caméra
    const cy = cam.yaw;
    let mx = -Math.sin(cy) * st.moveY + Math.cos(cy) * st.moveX;
    let mz = -Math.cos(cy) * st.moveY - Math.sin(cy) * st.moveX;
    const mag = Math.min(1, Math.hypot(mx, mz));
    const top = (st.sprint ? RUN_SPEED : WALK_SPEED) * mag;
    if (mag > 0.01) { const l = Math.hypot(mx, mz); mx = (mx / l) * top; mz = (mz / l) * top; } else { mx = 0; mz = 0; }
    // accélération / décélération douces (moins de contrôle en l'air)
    const rate = (mag > 0.01 ? 9 : 11) * (p.grounded ? 1 : 0.25);
    const k = 1 - Math.exp(-rate * dt);
    vx += (mx - vx) * k; vz += (mz - vz) * k;
    const sp = Math.hypot(vx, vz);
    // le corps se tourne vers la direction du mouvement
    if (mag > 0.05 && sp > 0.15) {
      const want = Math.atan2(-vx, -vz);
      p.yaw = wrap(p.yaw + wrap(want - p.yaw) * (1 - Math.exp(-11 * dt)));
    }
    let nx = p.pos.x + vx * dt, nz = p.pos.z + vz * dt;
    // pas dans la Seine
    const isWater = ctx.world?.isWater;
    if (isWater && sp > 0 && isWater.call(ctx.world, nx, nz)) {
      if (!isWater.call(ctx.world, nx, p.pos.z)) { nz = p.pos.z; vz = 0; }
      else if (!isWater.call(ctx.world, p.pos.x, nz)) { nx = p.pos.x; vx = 0; }
      else { nx = p.pos.x; nz = p.pos.z; vx = vz = 0; }
    }
    // véhicules (boîtes orientées) puis obstacles statiques
    const list = ctx.vehicles?.list;
    if (list) for (const o of list) {
      if (!o.pos) continue;
      const dx = nx - o.pos.x, dzz = nz - o.pos.z;
      if (dx * dx + dzz * dzz > 25) continue;
      if (p.pos.y > o.pos.y + (o.spec?.height || 1.4)) continue;
      const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
      const lx = dx * c - dzz * s, lz = dx * s + dzz * c;
      const hw = (o.spec?.width || 1.8) / 2 + RADIUS, hd = (o.spec?.length || 4.2) / 2 + RADIUS;
      const ex = hw - Math.abs(lx), ez = hd - Math.abs(lz);
      if (ex <= 0 || ez <= 0) continue;
      let px = 0, pz = 0;
      if (ex < ez) px = Math.sign(lx || 1) * ex; else pz = Math.sign(lz || 1) * ez;
      nx += px * c + pz * s; nz += -px * s + pz * c;
    }
    if (collision?.resolveCircle) {
      const r = collision.resolveCircle(nx, nz, RADIUS, p.pos.y + 0.9);
      if (r.hit) { // glisse le long du mur : on retire la composante de vitesse vers l'obstacle
        const d = vx * r.nx + vz * r.nz;
        if (d < 0) { vx -= d * r.nx; vz -= d * r.nz; }
      }
      nx = r.x; nz = r.z;
    }
    if (Number.isFinite(nx) && Number.isFinite(nz)) { p.pos.x = nx; p.pos.z = nz; }
    // vertical : saut, gravité, suivi du relief
    const g = heightAt(p.pos.x, p.pos.z);
    if (p.grounded) {
      if (input.pressed('jump')) { vy = JUMP_SPEED; p.grounded = false; }
      else if (p.pos.y - g > 0.35) { p.grounded = false; vy = 0; }
      else p.pos.y = g;
    }
    if (!p.grounded) {
      vy -= GRAVITY * dt; p.pos.y += vy * dt;
      if (p.pos.y <= g) { p.pos.y = g; vy = 0; p.grounded = true; }
    }
    p.speed = Math.hypot(vx, vz);
    p.anim = !p.grounded ? (vy > 0.5 ? 'jump' : 'fall') : p.speed > 3.9 ? 'run' : p.speed > 0.25 ? 'walk' : 'idle';
    character.setState({ anim: p.anim, speed: p.speed });
    character.group.position.set(p.pos.x, p.pos.y, p.pos.z);
    character.group.rotation.y = p.yaw;
  }

  function updateVehicle(dt) {
    const v = p.vehicle, st = input.state;
    // véhicule supprimé (garage, réseau...) : on redevient piéton sur place
    if (ctx.vehicles?.list && !ctx.vehicles.list.includes(v)) { exitVehicle(true); return updateFoot(dt); }
    if (v.driver !== 'local') v.driver = 'local';
    v.setControls?.({ throttle: st.throttle, brake: st.brake, steer: st.steer, handbrake: !!st.handbrake });
    p.pos.x = v.pos.x; p.pos.y = v.pos.y ?? heightAt(v.pos.x, v.pos.z); p.pos.z = v.pos.z;
    p.yaw = v.yaw; p.speed = v.speed || 0; p.anim = 'sit';
    character.setState({ steer: v.controls?.steer ?? st.steer });
  }

  function updatePrompt(dt) {
    promptTimer -= dt;
    if (promptTimer > 0) return;
    promptTimer = 0.12;
    if (!p.enabled || ctx.ui?.isOpen?.()) return setPrompt(null);
    if (p.vehicle) return setPrompt(Math.abs(p.vehicle.speed || 0) < 0.6 && input.state.throttle < 0.05 && !input.isTouch ? 'F — Descendre' : null);
    const v = nearestFreeVehicle();
    setPrompt(v ? `F — Monter dans ${vehicleName(v)}` : null);
  }

  function update(dt) {
    input.update(dt);
    if (p.vehicle) updateVehicle(dt); else updateFoot(dt);
    cam.update(dt);
    // le conducteur est masqué en vue capot (ou si showDriver est désactivé)
    if (p.vehicle) character.group.visible = p.showDriver && cam.viewName !== 'capot';
    else character.group.visible = !cam.tooClose;
    character.update(dt);
    updatePrompt(dt);
    input.endFrame();
  }

  // Voiture de test uniquement (?debugcar=1) : en jeu normal c'est le gameplay qui sort la voiture du joueur.
  if (params?.get?.('debugcar') === '1' && ctx.vehicles?.spawn) {
    try {
      const type = params.get('debugcartype') || STARTER_VEHICLE;
      ctx.vehicles.spawn(type, start.x + Math.cos(start.yaw) * 3, start.z - Math.sin(start.yaw) * 3, start.yaw);
    } catch (e) { console.warn('[player] debugcar', e); }
  }

  character.group.position.set(p.pos.x, p.pos.y, p.pos.z);
  character.group.rotation.y = p.yaw;
  return p;
}

export { CAMERA_VIEWS };

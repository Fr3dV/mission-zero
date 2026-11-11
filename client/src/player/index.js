// STUB — à remplacer par l'agent "joueur" en gardant le contrat (voir docs/ARCHITECTURE.md).
import { STARTER_VEHICLE } from '@shared/catalog.js';
export function createCharacter(ctx, opts = {}) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color: opts.color || 0x3a86ff }));
  m.position.y = 0.85; group.add(m);
  return { group, setState() {}, update() {}, dispose() { group.removeFromParent(); } };
}
export function createPlayer(ctx) {
  const { scene, camera, heightAt, collision, bus } = ctx;
  const keys = new Set();
  addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; keys.add(e.code); if (e.code === 'KeyF') toggleVehicle(); });
  addEventListener('keyup', (e) => keys.delete(e.code));
  const character = createCharacter(ctx); scene.add(character.group);
  const p = {
    pos: { x: 30, y: 0, z: 60 }, yaw: 0, speed: 0, mode: 'foot', vehicle: null, character, enabled: true,
    teleport(x, z, yaw = 0) { if (p.vehicle) p.vehicle.setTransform(x, z, yaw); p.pos.x = x; p.pos.z = z; p.yaw = yaw; },
    enterVehicle(v) { p.vehicle = v; v.driver = 'local'; p.mode = 'vehicle'; character.group.visible = false; bus.emit('player:enterVehicle', { vehicle: v }); },
    exitVehicle() { const v = p.vehicle; if (!v) return; v.driver = null; v.setControls({ throttle: 0, brake: 0, steer: 0 }); p.pos.x = v.pos.x + Math.cos(v.yaw) * 2; p.pos.z = v.pos.z - Math.sin(v.yaw) * 2; p.vehicle = null; p.mode = 'foot'; character.group.visible = true; bus.emit('player:exitVehicle', { vehicle: v }); },
    getNetState() { const v = p.vehicle; return { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, speed: p.speed, mode: p.mode, anim: p.speed > 0.2 ? 'walk' : 'idle', vehicleType: v?.typeId || null, vehicleColor: v?.color || null }; },
    update(dt) {
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      if (!p.enabled) { /* menus ouverts */ }
      else if (p.vehicle) {
        const v = p.vehicle;
        v.setControls({ throttle: Math.max(0, f), brake: Math.max(0, -f), steer: s, handbrake: keys.has('Space') });
        p.pos.x = v.pos.x; p.pos.y = v.pos.y; p.pos.z = v.pos.z; p.yaw = v.yaw; p.speed = v.speed;
      } else {
        p.yaw -= s * 2.5 * dt; p.speed = f * (keys.has('ShiftLeft') ? 7 : 3.5);
        const r = collision.resolveCircle(p.pos.x - Math.sin(p.yaw) * p.speed * dt, p.pos.z - Math.cos(p.yaw) * p.speed * dt, 0.4, 1);
        p.pos.x = r.x; p.pos.z = r.z; p.pos.y = heightAt(r.x, r.z);
        character.group.position.set(p.pos.x, p.pos.y, p.pos.z); character.group.rotation.y = p.yaw;
      }
      const d = p.vehicle ? 9 : 5, h = p.vehicle ? 3.5 : 2.6;
      camera.position.lerp({ x: p.pos.x + Math.sin(p.yaw) * d, y: p.pos.y + h, z: p.pos.z + Math.cos(p.yaw) * d }, 1 - Math.exp(-6 * dt));
      camera.lookAt(p.pos.x, p.pos.y + 1.4, p.pos.z);
    },
  };
  function toggleVehicle() { if (p.vehicle) return p.exitVehicle(); const v = ctx.vehicles.nearest(p.pos.x, p.pos.z, 5, (v) => !v.driver); if (v) p.enterVehicle(v); }
  ctx.vehicles.spawn(STARTER_VEHICLE, 36, 60, 0);
  return p;
}

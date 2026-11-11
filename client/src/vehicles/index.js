// STUB — à remplacer par l'agent "véhicules" en gardant le contrat (voir docs/ARCHITECTURE.md).
import { VEHICLE_BY_ID } from '@shared/catalog.js';
export function createVehicles(ctx) {
  const { THREE, scene, collision, heightAt } = ctx;
  const list = [];
  let nextId = 1;
  function createMesh(typeId, color) {
    const s = VEHICLE_BY_ID[typeId] || VEHICLE_BY_ID.citadine;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(s.width, s.height * 0.6, s.length), new THREE.MeshStandardMaterial({ color: color || s.colors[0], metalness: 0.6, roughness: 0.35 }));
    body.position.y = s.height * 0.5; g.add(body);
    return g;
  }
  function spawn(typeId, x, z, yaw = 0, opts = {}) {
    const spec = VEHICLE_BY_ID[typeId] || VEHICLE_BY_ID.citadine;
    const color = opts.color || spec.colors[0];
    const v = {
      id: opts.id || 'v' + nextId++, typeId: spec.id, spec, color, group: createMesh(spec.id, color),
      pos: { x, y: heightAt(x, z), z }, yaw, speed: 0, driver: null, remote: !!opts.remote,
      controls: { throttle: 0, brake: 0, steer: 0, handbrake: false },
      setControls(c) { Object.assign(v.controls, c); },
      setTransform(nx, nz, nyaw, speed = 0) { v.pos.x = nx; v.pos.z = nz; v.yaw = nyaw; v.speed = speed; v.pos.y = heightAt(nx, nz); sync(v); },
      update(dt) {
        if (v.remote) return;
        const c = v.driver ? v.controls : { throttle: 0, brake: 0.3, steer: 0 };
        v.speed += (c.throttle * spec.accel - c.brake * spec.brake * Math.sign(v.speed || 1)) * dt;
        if (c.brake > 0 && c.throttle === 0 && Math.abs(v.speed) < 0.5 && v.driver) v.speed -= c.brake * spec.accel * 0.5 * dt; // marche arrière
        v.speed -= v.speed * 0.25 * dt;
        v.speed = Math.max(-12, Math.min(spec.maxSpeed, v.speed));
        v.yaw -= c.steer * Math.min(1, Math.abs(v.speed) / 6) * 1.6 * dt * Math.sign(v.speed || 1);
        const nx = v.pos.x - Math.sin(v.yaw) * v.speed * dt, nz = v.pos.z - Math.cos(v.yaw) * v.speed * dt;
        const r = collision.resolveCircle(nx, nz, spec.width * 0.6, 0.5);
        if (r.hit) v.speed *= 0.4;
        v.pos.x = r.x; v.pos.z = r.z; v.pos.y = heightAt(r.x, r.z); sync(v);
      },
    };
    sync(v); scene.add(v.group); list.push(v); return v;
  }
  function sync(v) { v.group.position.set(v.pos.x, v.pos.y, v.pos.z); v.group.rotation.y = v.yaw; }
  function remove(v) { scene.remove(v.group); const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); }
  function nearest(x, z, maxDist = 5, filter) {
    let best = null, bd = maxDist;
    for (const v of list) { if (filter && !filter(v)) continue; const d = Math.hypot(v.pos.x - x, v.pos.z - z); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  return { list, spawn, remove, nearest, createMesh, update(dt) { for (const v of list) v.update(dt); } };
}

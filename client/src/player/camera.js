// Caméra 3e personne : orbite à pied, poursuite à ressort en voiture (recul + FOV avec la vitesse,
// tremblement, regard arrière, 3 vues), anti-traversée des murs, jamais sous le sol.
const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const dampAngle = (cur, target, rate, dt) => cur + wrap(target - cur) * (1 - Math.exp(-rate * dt));

export const CAMERA_VIEWS = ['proche', 'loin', 'capot'];
const BASE_FOV = 60;

export function createCameraRig(ctx, player, input) {
  const { camera, collision, heightAt } = ctx;
  const rig = {
    yaw: 0, pitch: 0.22,          // orbite (yaw = direction regardée, même convention que le joueur)
    footDist: 4.6,
    view: 0,                      // index dans CAMERA_VIEWS (en voiture)
    fov: BASE_FOV,
    trauma: 0,                    // secousse (0..1), décroît seule
    tooClose: false,              // caméra collée au personnage (on le masque)
    get viewName() { return CAMERA_VIEWS[rig.view]; },
    nextView() { rig.view = (rig.view + 1) % CAMERA_VIEWS.length; return rig.viewName; },
    setView(v) { const i = typeof v === 'number' ? v : CAMERA_VIEWS.indexOf(v); if (i >= 0) rig.view = i % CAMERA_VIEWS.length; },
    shake(amount = 0.5) { rig.trauma = Math.min(1, rig.trauma + amount); },
    /** Replace instantanément la caméra derrière le joueur. */
    snap(yaw = player.yaw) { rig.yaw = yaw; orbitYaw = 0; orbitPitch = 0; chaseYaw = yaw; limit = 99; blend = 1; hasPos = false; },
    /** Démarre un fondu depuis la position actuelle (changement de mode). */
    transition() { blend = 0; fromPos.copy(camera.position); fromLook.copy(look); },
    update,
  };
  const V3 = ctx.THREE.Vector3;
  const look = new V3(), fromPos = new V3(), fromLook = new V3(), want = new V3(), target = new V3();
  let orbitYaw = 0, orbitPitch = 0, chaseYaw = 0, limit = 99, blend = 1, hasPos = false;
  let distV = 7, spSmooth = 0, accSmooth = 0, lastSpeed = 0, reverseT = 0, shakeT = 0, backSmooth = 0;

  /** Distance maximale libre entre la cible et la caméra (obstacles statiques). */
  function freeDistance(tx, ty, tz, dx, dy, dz, dist) {
    if (!collision?.test) return dist;
    const N = 10;
    for (let i = 1; i <= N; i++) {
      const d = (dist * i) / N;
      if (collision.test(tx + dx * d, tz + dz * d, 0.28, ty + dy * d)) return Math.max(0.7, (dist * (i - 1)) / N - 0.1);
    }
    return dist;
  }

  function update(dt) {
    const st = input.state;
    const sens = 0.0024;
    const v = player.vehicle;
    let fovTarget = BASE_FOV, dist, hideCharacter = false;
    let shakeAmp = 0;

    if (!v) {
      // ---------------- à pied : orbite libre
      rig.yaw = wrap(rig.yaw - st.lookDX * sens);
      rig.pitch = clamp(rig.pitch + st.lookDY * sens, -0.5, 1.25);
      rig.footDist = clamp(rig.footDist + st.zoom * 0.5, 2.2, 9);
      // sans action sur la souris, la caméra revient doucement derrière le personnage en mouvement
      const moving = Math.hypot(st.moveX, st.moveY) > 0.1;
      if (moving && st.moveY > -0.3 && (!input.locked || input.idleLook > 1.6)) {
        const k = input.locked ? 0.9 : 1.7;
        rig.yaw = dampAngle(rig.yaw, player.yaw, k * Math.min(1, player.speed / 2), dt);
      }
      target.set(player.pos.x, player.pos.y + 0.855 * (player.character?.look?.height || 1.78), player.pos.z);
      dist = rig.footDist;
      const cp = Math.cos(rig.pitch), sp = Math.sin(rig.pitch);
      const dx = Math.sin(rig.yaw) * cp, dy = sp, dz = Math.cos(rig.yaw) * cp;
      const free = freeDistance(target.x, target.y, target.z, dx, dy, dz, dist);
      limit = free < limit ? free : Math.min(free, limit + 5 * dt); // se rapproche d'un coup, s'éloigne en douceur
      const d = Math.min(dist, limit);
      rig.tooClose = d < 0.95;
      // léger décalage d'épaule quand la caméra est proche
      const sh = 0.28 * clamp(d / 3, 0, 1);
      want.set(target.x + dx * d + Math.cos(rig.yaw) * sh, target.y + dy * d, target.z + dz * d - Math.sin(rig.yaw) * sh);
      look.set(target.x + Math.cos(rig.yaw) * sh, target.y + 0.05, target.z - Math.sin(rig.yaw) * sh);
      fovTarget = BASE_FOV + (player.speed > 4.5 ? 4 : 0);
      chaseYaw = rig.yaw; orbitYaw = 0; orbitPitch = 0; spSmooth = 0; lastSpeed = 0; accSmooth = 0;
    } else {
      // ---------------- en voiture : poursuite
      rig.tooClose = false;
      const spec = v.spec || {};
      const len = spec.length || 4.2, hgt = spec.height || 1.45;
      const speed = v.speed || 0, abs = Math.abs(speed);
      const sp = clamp(abs / 55, 0, 1);
      spSmooth = damp(spSmooth, sp, 3, dt);
      const acc = dt > 0 ? (speed - lastSpeed) / dt : 0; lastSpeed = speed;
      accSmooth = damp(accSmooth, clamp(acc, -25, 25), 4, dt);
      // orbite manuelle temporaire (revient derrière après un moment)
      orbitYaw = wrap(orbitYaw - st.lookDX * sens);
      orbitPitch = clamp(orbitPitch + st.lookDY * sens, -0.25, 0.9);
      if (input.idleLook > 1.8) { const r = 2.2 + abs * 0.08; orbitYaw = dampAngle(orbitYaw, 0, r, dt); orbitPitch = damp(orbitPitch, 0, r, dt); }
      // marche arrière prolongée ou touche de regard arrière : la caméra passe devant
      reverseT = speed < -1.5 && st.brake > 0.1 ? reverseT + dt : 0;
      const back = st.lookBack || reverseT > 0.7;
      backSmooth = st.lookBack ? (back ? 1 : 0) : damp(backSmooth, back ? 1 : 0, 6, dt);
      const yawTarget = v.yaw + backSmooth * Math.PI;
      chaseYaw = dampAngle(chaseYaw, yawTarget, st.lookBack ? 30 : 4.2 + spSmooth * 3, dt);
      const yaw = chaseYaw + orbitYaw;
      rig.yaw = yaw;
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
      const vy = v.pos.y ?? player.pos.y;
      if (CAMERA_VIEWS[rig.view] === 'capot') {
        // vue capot : caméra fixée à l'avant du toit, regarde la route
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        const off = backSmooth > 0.5 ? -len * 0.2 : len * 0.16;
        want.set(v.pos.x + fx * off, vy + hgt + 0.1, v.pos.z + fz * off);
        look.set(want.x - sy * 20, want.y - 1.1 + orbitPitch * -14, want.z - cy * 20);
        fovTarget = 70 + 18 * spSmooth;
        shakeAmp = 0.012 * clamp((spSmooth - 0.45) / 0.55, 0, 1);
        limit = 99; hideCharacter = false;
        dist = 0;
      } else {
        const far = CAMERA_VIEWS[rig.view] === 'loin';
        const k = len / 4.4;
        const base = (far ? 8.4 : 5.3) * k;
        // recul avec la vitesse + inertie à l'accélération / au freinage
        distV = damp(distV, base * (1 + 0.2 * spSmooth) + clamp(accSmooth * 0.045, -0.6, 0.8), 5, dt);
        const pitch = (far ? 0.27 : 0.19) + orbitPitch - 0.04 * spSmooth;
        target.set(v.pos.x, vy + hgt * 0.8 + 0.25, v.pos.z);
        const cp = Math.cos(pitch), sp2 = Math.sin(pitch);
        const dx = Math.sin(yaw) * cp, dy = sp2, dz = Math.cos(yaw) * cp;
        const free = freeDistance(target.x, target.y, target.z, dx, dy, dz, distV);
        limit = free < limit ? Math.max(free, limit - 30 * dt) : Math.min(free, limit + 6 * dt);
        const d = Math.min(distV, Math.max(limit, 1.6));
        want.set(target.x + dx * d, target.y + dy * d, target.z + dz * d);
        // on regarde un peu en avant de la voiture
        const ahead = (1.2 + 2.2 * spSmooth) * (1 - 2 * backSmooth);
        look.set(v.pos.x + fx * ahead, vy + hgt * 0.75, v.pos.z + fz * ahead);
        fovTarget = BASE_FOV + 19 * Math.pow(spSmooth, 0.9);
        shakeAmp = 0.035 * clamp((spSmooth - 0.5) / 0.5, 0, 1);
      }
    }

    // secousses (vitesse + chocs)
    rig.trauma = Math.max(0, rig.trauma - dt * 1.6);
    shakeAmp += rig.trauma * rig.trauma * 0.22;
    if (shakeAmp > 0) {
      shakeT += dt * 38;
      want.x += (Math.sin(shakeT * 1.31) + Math.sin(shakeT * 2.77 + 1.3)) * 0.5 * shakeAmp;
      want.y += (Math.sin(shakeT * 1.73 + 0.6) + Math.sin(shakeT * 3.19)) * 0.5 * shakeAmp;
      want.z += (Math.sin(shakeT * 1.57 + 2.1) + Math.sin(shakeT * 2.31 + 0.4)) * 0.5 * shakeAmp;
    }

    // fondu lors d'un changement de mode (montée / descente de voiture)
    if (blend < 1 && hasPos) {
      blend = Math.min(1, blend + dt / 0.55);
      const e = blend * blend * (3 - 2 * blend);
      camera.position.lerpVectors(fromPos, want, e);
      fromLook.lerp(look, e * 0.5 + 0.02); // suit la nouvelle cible
      look.lerpVectors(fromLook, look, e);
    } else { camera.position.copy(want); blend = 1; }
    hasPos = true;

    // jamais sous le sol
    const ground = heightAt ? heightAt(camera.position.x, camera.position.z) : 0;
    const minY = (Number.isFinite(ground) ? ground : 0) + 0.35;
    if (camera.position.y < minY) camera.position.y = minY;

    camera.lookAt(look);
    rig.fov = damp(rig.fov, fovTarget, 3.5, dt);
    if (Math.abs(camera.fov - rig.fov) > 0.02) { camera.fov = rig.fov; camera.updateProjectionMatrix(); }
    return hideCharacter;
  }
  return rig;
}

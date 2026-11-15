// Caméra 3e personne : orbite à pied, poursuite à ressort en voiture (recul + FOV avec la vitesse,
// tremblement, regard arrière, 3 vues), anti-traversée des murs, jamais sous le sol.
// Niveaux superposés : ctx.heightAt reçoit la hauteur de la caméra ; elle reste SOUS un tablier ou une dalle
// quand le joueur est dessous (jamais « posée » dessus), et sur le tablier quand il est dessus.
// Effets « fun » (contrat v6) : kick(deg) = coup de champ bref, sway = décalage latéral en dérive (lecture de
// vehicle.driftAngle), orbit({x, z, y, dur}) = tour de présentation interrompu par toute entrée. Les préférences
// (ctx.ui.prefs.fx, prefers-reduced-motion) sont lues au moment de chaque effet, jamais à la création.
import { STEP_UP } from '@shared/terrain.js';
const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const dampAngle = (cur, target, rate, dt) => cur + wrap(target - cur) * (1 - Math.exp(-rate * dt));

export const CAMERA_VIEWS = ['proche', 'loin', 'capot'];
const BASE_FOV = 60;
const KICK_MAX = 8;                        // degrés de champ ajoutés au plus par les coups cumulés
const SWAY_MAX = 0.6, SWAY_MIN = 0.08, SWAY_FULL = 0.55; // m ; angle de dérive (rad) où le décalage commence / est complet
const ORBIT_MAX = 3.4, ORBIT_SWEEP = 2.6;  // s (le contrat dit 3,5 au plus, image de fin comprise) ; rad parcourus par une orbite de durée maximale
const ORBIT_MIN = 3.4;                     // m : distance minimale de la caméra au centre de la voiture pendant l'orbite (jamais dans la carrosserie)

export function createCameraRig(ctx, player, input) {
  const { camera, collision, heightAt } = ctx;
  const rig = {
    yaw: 0, pitch: 0.22,          // orbite (yaw = direction regardée, même convention que le joueur)
    footDist: 4.6,
    view: 0,                      // index dans CAMERA_VIEWS (en voiture)
    fov: BASE_FOV,
    trauma: 0,                    // secousse (0..1), décroît seule
    /** point d'intérêt temporaire (vol de voiture) : la caméra à pied se recadre dessus */
    focus: null,
    tooClose: false,              // caméra collée au personnage (on le masque)
    get viewName() { return CAMERA_VIEWS[rig.view]; },
    nextView() { rig.view = (rig.view + 1) % CAMERA_VIEWS.length; return rig.viewName; },
    setView(v) { const i = typeof v === 'number' ? v : CAMERA_VIEWS.indexOf(v); if (i >= 0) rig.view = i % CAMERA_VIEWS.length; },
    shake(amount = 0.5) { rig.trauma = Math.min(1, rig.trauma + amount); },
    /** Coup de champ : +deg degrés d'un coup, retombés à moins de 0,2° en 0,6 s. Sans effet si les effets sont coupés. */
    kick(deg = 4) {
      const k = fxScale();
      if (k > 0 && Number.isFinite(deg)) kickAmt = clamp(kickAmt + deg * k, -KICK_MAX, KICK_MAX);
    },
    /** décalage latéral courant (m, signé, <= 0,6) dû à la dérive ; 0 en ligne droite, à pied et effets coupés */
    get sway() { return swayS; },
    /** true pendant un tour de présentation */
    get orbiting() { return O.on; },
    /**
     * Tour de présentation autour d'un point (voiture livrée…) : { x, z, y?, dur <= 3,5 s, r? }.
     * Toute entrée du joueur l'interrompt ; la main est rendue par transition(). Effets coupés : plan fixe, sans rotation.
     */
    orbit(o = {}) {
      if (!Number.isFinite(o.x) || !Number.isFinite(o.z)) return false;
      const y = Number.isFinite(o.y) ? o.y : heightAt ? heightAt(o.x, o.z, player.pos.y) : player.pos.y;
      O.x = o.x; O.z = o.z; O.y = Number.isFinite(y) ? y : player.pos.y;
      O.dur = clamp(Number.isFinite(o.dur) ? o.dur : 3, 0.4, ORBIT_MAX); O.t = 0;
      const dx = camera.position.x - o.x, dz = camera.position.z - o.z, d = Math.hypot(dx, dz);
      O.a0 = d > 0.5 ? Math.atan2(dx, dz) : rig.yaw;
      O.r = clamp(Number.isFinite(o.r) ? o.r : d, 6, 9);
      O.sweep = ORBIT_SWEEP * (O.dur / ORBIT_MAX) * fxScale();
      O.act0 = input.activity; O.lim = 99; O.on = true;
      rig.transition();
      return true;
    },
    /** Replace instantanément la caméra derrière le joueur. */
    snap(yaw = player.yaw) { rig.yaw = yaw; orbitYaw = 0; orbitPitch = 0; chaseYaw = yaw; limit = 99; blend = 1; hasPos = false; O.on = false; swayS = 0; },
    /** Démarre un fondu depuis la position actuelle (changement de mode). */
    transition() { blend = 0; fromPos.copy(camera.position); fromLook.copy(look); },
    update,
  };
  const V3 = ctx.THREE.Vector3;
  const look = new V3(), fromPos = new V3(), fromLook = new V3(), want = new V3(), target = new V3();
  let focusS = 0, fx0 = 0, fz0 = 0, downS = 0, orbitYaw = 0, orbitPitch = 0, chaseYaw = 0, limit = 99, blend = 1, hasPos = false;
  let distV = 7, spSmooth = 0, accSmooth = 0, lastSpeed = 0, reverseT = 0, shakeT = 0, backSmooth = 0;
  let kickAmt = 0, swayS = 0, motion = null;
  const O = { on: false, x: 0, y: 0, z: 0, t: 0, dur: 3, a0: 0, r: 7, sweep: 0, act0: 0, lim: 99 };

  /** Intensité des effets de caméra : 1 = complets, 0,5 = discrets, 0 = coupés (réglage ou prefers-reduced-motion). */
  function fxScale() {
    const fx = ctx.ui?.prefs?.fx;
    if (fx === 'off') return 0;
    if (motion === null) { try { motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : false; } catch { motion = false; } }
    if (motion && motion.matches) return 0;
    return fx === 'soft' ? 0.5 : 1;
  }
  // figures et réceptions : seules celles de MA voiture comptent (les événements style:* ne concernent que le joueur local)
  ctx.bus?.on?.('style:trick', (e) => { if (e?.kind === 'near') rig.kick(4); });
  ctx.bus?.on?.('style:bank', (e) => { rig.kick(clamp(1 + (e?.pts || 0) / 4000, 1, 2.5)); });
  ctx.bus?.on?.('vehicle:landed', (e) => {
    if (!e?.vehicle || e.vehicle !== player.vehicle) return;
    const k = fxScale();
    if (k > 0) rig.shake(clamp((e.landV || 0) / 14, 0.08, 0.7) * k); // secousse proportionnelle à la vitesse de réception
  });

  /** Distance maximale libre entre la cible et la caméra (obstacles statiques). */
  function freeDistance(tx, ty, tz, dx, dy, dz, dist) {
    const N = 10;
    let sPrev = heightAt ? heightAt(tx, tz, ty) : 0;
    for (let i = 1; i <= N; i++) {
      const d = (dist * i) / N, x = tx + dx * d, y = ty + dy * d, z = tz + dz * d;
      if (collision?.test && collision.test(x, z, 0.28, y)) return Math.max(0.7, (dist * (i - 1)) / N - 0.1);
      if (heightAt) {
        // un niveau supérieur apparaît au-dessus du rayon (tablier de pont, dalle de trémie) : la caméra reste dessous
        const s = heightAt(x, z, y);
        if (s - sPrev > STEP_UP * 0.9 && y < s + 0.35) return Math.max(0.7, (dist * (i - 1)) / N - 0.1);
        sPrev = s;
      }
    }
    return dist;
  }

  function update(dt) {
    const st = input.state;
    const sens = 0.0024;
    const v = player.vehicle;
    let fovTarget = BASE_FOV, dist, hideCharacter = false;
    let shakeAmp = 0;

    // tour de présentation : toute entrée (touche, bouton, manette, doigt, souris) rend la main
    if (O.on) {
      O.t += dt;
      if (O.t >= O.dur || input.activity !== O.act0 || st.moveX !== 0 || st.moveY !== 0 || st.throttle > 0.05 || st.brake > 0.05
        || st.lookDX !== 0 || st.lookDY !== 0 || st.zoom !== 0 || st.jump || st.handbrake) { O.on = false; rig.transition(); }
    }
    if (O.on) {
      rig.tooClose = false;
      const u = O.t / O.dur, a = O.a0 + O.sweep * u * u * (3 - 2 * u), pitch = 0.3;
      const cp = Math.cos(pitch), dx = Math.sin(a) * cp, dy = Math.sin(pitch), dz = Math.cos(a) * cp;
      target.set(O.x, O.y + 0.85, O.z);
      let free = freeDistance(target.x, target.y, target.z, dx, dy, dz, O.r);
      if (free < ORBIT_MIN) {
        // obstacle tout près de la voiture. Fin (réverbère, tronc, poteau : la voie est de nouveau libre 1,6 m plus loin, jusqu'au
        // bout du rayon) : la caméra garde son rayon et le laisse passer devant elle. Épais (façade) : plancher ci-dessous.
        const s = free + 1.6, rest = O.r - s;
        if (rest > 0.5 && freeDistance(target.x + dx * s, target.y + dy * s, target.z + dz * s, dx, dy, dz, rest) >= rest) free = O.r;
      }
      O.lim = free < O.lim ? free : Math.min(free, O.lim + 5 * dt);
      // plancher juste hors carrosserie (demi-diagonale du plus gros véhicule : 3,05 m) : jamais de plan dans l'habitacle ;
      // un mur proche n'est dépassé que de quelques décimètres
      const d = Math.min(O.r, Math.max(O.lim, ORBIT_MIN));
      want.set(target.x + dx * d, target.y + dy * d, target.z + dz * d);
      look.copy(target);
      swayS = 0;
    } else if (!v) {
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
      // la cible descend en douceur quand le personnage est à terre
      downS = damp(downS, player.character?.down || 0, 5, dt);
      target.set(player.pos.x, player.pos.y + 0.855 * (player.character?.look?.height || 1.78) * (1 - 0.6 * downS), player.pos.z);
      focusS = damp(focusS, rig.focus ? 1 : 0, 5, dt);
      if (rig.focus) { fx0 = rig.focus.x; fz0 = rig.focus.z; }
      if (focusS > 0.01) { target.x += (fx0 - target.x) * 0.45 * focusS; target.z += (fz0 - target.z) * 0.45 * focusS; target.y -= 0.2 * focusS; }
      dist = rig.footDist * (1 - 0.18 * focusS);
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
      chaseYaw = rig.yaw; orbitYaw = 0; orbitPitch = 0; spSmooth = 0; lastSpeed = 0; accSmooth = 0; swayS = 0;
    } else {
      // ---------------- en voiture : poursuite
      rig.tooClose = false;
      const spec = v.spec || {};
      const len = spec.length || 4.2, hgt = spec.height || 1.45;
      const speed = v.speed || 0, abs = Math.abs(speed);
      // 0..1 sans palier : ≈ 0,3 à 50 km/h, 0,6 à 130, 0,77 à 200, 0,84 à 250 (lisible sur rocade)
      const sp = 1 - Math.exp(-abs / 38);
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
        shakeAmp = 0.006 * clamp((spSmooth - 0.5) / 0.4, 0, 1);
        limit = 99; hideCharacter = false;
        dist = 0; swayS = 0;
      } else {
        const far = CAMERA_VIEWS[rig.view] === 'loin';
        const k = len / 4.4;
        const base = (far ? 8.4 : 5.3) * k;
        // recul avec la vitesse + inertie à l'accélération / au freinage
        distV = damp(distV, base * (1 + 0.26 * spSmooth) + clamp(accSmooth * 0.045, -0.6, 0.8), 5, dt);
        const pitch = (far ? 0.27 : 0.19) + orbitPitch - 0.04 * spSmooth;
        target.set(v.pos.x, vy + hgt * 0.8 + 0.25, v.pos.z);
        const cp = Math.cos(pitch), sp2 = Math.sin(pitch);
        const dx = Math.sin(yaw) * cp, dy = sp2, dz = Math.cos(yaw) * cp;
        const free = freeDistance(target.x, target.y, target.z, dx, dy, dz, distV);
        limit = free < limit ? Math.max(free, limit - 30 * dt) : Math.min(free, limit + 6 * dt);
        const d = Math.min(distV, Math.max(limit, 1.6));
        want.set(target.x + dx * d, target.y + dy * d, target.z + dz * d);
        // dérive : la caméra glisse du côté opposé à la glisse (elle passe derrière la trajectoire), 0,6 m au plus
        const da = v.driftAngle || 0, am = Math.abs(da);
        let sw = 0;
        if (am > SWAY_MIN) { const u = Math.min(1, (am - SWAY_MIN) / (SWAY_FULL - SWAY_MIN)); sw = -Math.sign(da) * SWAY_MAX * u * u * (3 - 2 * u) * fxScale(); }
        swayS = damp(swayS, sw, 4, dt); if (sw === 0 && Math.abs(swayS) < 1e-3) swayS = 0;
        if (swayS !== 0) { want.x += Math.cos(yaw) * swayS; want.z -= Math.sin(yaw) * swayS; }
        // on regarde un peu en avant de la voiture
        const ahead = (1.2 + 3.2 * spSmooth) * (1 - 2 * backSmooth);
        look.set(v.pos.x + fx * ahead, vy + hgt * 0.75, v.pos.z + fz * ahead);
        fovTarget = BASE_FOV + 21 * Math.pow(spSmooth, 0.9);
        shakeAmp = 0.014 * clamp((spSmooth - 0.5) / 0.4, 0, 1);
      }
    }

    // secousses (vitesse + chocs)
    rig.trauma = Math.max(0, rig.trauma - dt * 1.6);
    shakeAmp += rig.trauma * rig.trauma * 0.22;
    if (shakeAmp > 0 && fxScale() === 0) shakeAmp = 0; // effets coupés : image stable
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

    // jamais sous le sol — sol du niveau de la caméra (on passe SA hauteur)
    if (heightAt) {
      const cx = camera.position.x, cz = camera.position.z;
      let cy = camera.position.y, ground = heightAt(cx, cz, cy);
      const feet = v ? (v.pos.y ?? player.pos.y) : player.pos.y;
      if (ground > cy + 0.5 && ground > feet + STEP_UP) {
        // la surface trouvée est AU-DESSUS de la caméra alors que le joueur est à un niveau inférieur : c'est un plafond
        // (dessous de tablier, dalle). On reste dessous au lieu de se poser dessus.
        cy = Math.min(cy, ground - 1.3);
        ground = heightAt(cx, cz, feet);
      }
      const minY = (Number.isFinite(ground) ? ground : 0) + 0.35;
      camera.position.y = cy < minY ? minY : cy;
    }

    camera.lookAt(look);
    rig.fov = damp(rig.fov, fovTarget, 3.5, dt);
    // coup de champ : franc à l'impact, il retombe seul (4° -> moins de 0,1° en 0,6 s) sans toucher au champ de base
    const fov = rig.fov + kickAmt;
    if (kickAmt !== 0) { kickAmt *= Math.exp(-6.5 * dt); if (Math.abs(kickAmt) < 0.02) kickAmt = 0; }
    if (Math.abs(camera.fov - fov) > 0.02) { camera.fov = fov; camera.updateProjectionMatrix(); }
    return hideCharacter;
  }
  return rig;
}

// Personnage procédural articulé et habillé (voir body.js pour la géométrie, anim.js pour les poses, atlas.js pour
// les matières). Un seul SkinnedMesh par personnage (1 draw call), matériau et atlas partagés par tous, couleurs
// par sommet. Deux niveaux de détail (complet / simplifié) partagent le même squelette ; le passage est automatique
// selon la distance à la caméra (ctx.camera) sauf si { lod: true | false } est imposé.
// Utilisé pour le joueur local, les joueurs distants (net) et les piétons (traffic).
import * as THREE from 'three';
import { makeLook } from './look.js';
import { buildBody, BONE, NB, BONE_PARENT, SHOULDER_Y, ELBOW_Y, WRIST_Y } from './body.js';
import { getAtlas } from './atlas.js';
import { POSES, ANIMS, PN, DX, DY, DZ, phaseRate, SIT_ROOT_Y, liePose } from './anim.js';
import { Ragdoll } from './ragdoll.js';

export { SIT_ROOT_Y };
export const CHARACTER_ANIMS = ANIMS;
const REF_HEIGHT = 1.78;
const LOD_FAR = 34, LOD_NEAR = 28;
/** seuil (m/s) entre simple déséquilibre et chute : ~8 km/h */
export const KNOCK_SPEED = 2.2; // m (hystérésis)
const PAL = ['skin', 'top', 'bottom', 'shoes', 'hair', 'bag', 'inner', null, 'sole', null, 'scarf', 'legs', 'hat', 'belt', null, null];

let material = null;
function getMaterial() {
  if (material) return material;
  const a = getAtlas();
  material = new THREE.MeshStandardMaterial({
    map: a.map, normalMap: a.normalMap, roughnessMap: a.roughnessMap, normalScale: new THREE.Vector2(0.9, 0.9),
    vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, shadowSide: THREE.BackSide, alphaTest: 0.5,
  });
  material.name = 'personnages';
  return material;
}

/** Attributs GPU partagés entre tous les personnages de même forme. */
function sharedAttrs(base) {
  if (!base.attrs) base.attrs = {
    position: new THREE.BufferAttribute(base.position, 3), normal: new THREE.BufferAttribute(base.normal, 3), uv: new THREE.BufferAttribute(base.uv, 2),
    skinIndex: new THREE.BufferAttribute(base.skinIndex, 4), skinWeight: new THREE.BufferAttribute(base.skinWeight, 4), index: new THREE.BufferAttribute(base.index, 1),
  };
  return base.attrs;
}
const _c = new THREE.Color();
const BS = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4), BB = new THREE.Box3(new THREE.Vector3(-1, -0.3, -1), new THREE.Vector3(1, 2.1, 1));
function makeGeometry(base, palette) {
  const n = base.count, color = new Float32Array(n * 3), part = base.part;
  for (let i = 0; i < n; i++) { const p = part[i] * 3; color[i * 3] = palette[p]; color[i * 3 + 1] = palette[p + 1]; color[i * 3 + 2] = palette[p + 2]; }
  const g = new THREE.BufferGeometry(), a = sharedAttrs(base);
  g.setAttribute('position', a.position); g.setAttribute('normal', a.normal); g.setAttribute('uv', a.uv);
  g.setAttribute('skinIndex', a.skinIndex); g.setAttribute('skinWeight', a.skinWeight);
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setIndex(a.index);
  g.boundingSphere = BS; g.boundingBox = BB;
  return g;
}
function disposeGeometry(g) {
  // on détache les attributs partagés avant dispose() pour ne libérer que la couleur propre au personnage
  for (const k of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) g.deleteAttribute(k);
  g.setIndex(null);
  g.dispose();
}
function makePalette(look) {
  const pal = new Float32Array(16 * 3), c = look.colors;
  const put = (i, hex, k = 1) => { _c.set(hex); pal[i * 3] = _c.r * k; pal[i * 3 + 1] = _c.g * k; pal[i * 3 + 2] = _c.b * k; };
  PAL.forEach((name, i) => { if (name) put(i, c[name]); });
  put(7, '#131316'); put(9, '#ffffff'); put(14, c.skin, 0.72); put(15, '#b9bbc0');
  return pal;
}

// temporaires (aucune allocation par frame)
const _tmp = new Float32Array(PN);
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _d = new THREE.Vector3(), _pole = new THREE.Vector3(), _E = new THREE.Vector3(), _u1 = new THREE.Vector3(), _u2 = new THREE.Vector3();
const _qU = new THREE.Quaternion(), _qF = new THREE.Quaternion(), _qi = new THREE.Quaternion(), DOWN = new THREE.Vector3(0, -1, 0), XAXIS = new THREE.Vector3(1, 0, 0);
const L_UP = SHOULDER_Y - ELBOW_Y, L_FORE = ELBOW_Y - WRIST_Y + 0.075;
const { H, SP, CH, HD, AL, FL, AR, FR, LID } = BONE;
let counter = 0;

/**
 * Crée un personnage.
 * @param ctx contexte du jeu (ctx.camera sert au niveau de détail automatique ; facultatif)
 * @param opts { color (haut), skin, name (graine des variations), lod (true = toujours simplifié, false = toujours complet,
 *               défaut : automatique), shadow, gender 'm'|'f', age, height (m), build (−1..1), outfit {top, bottom, shoes, hair, hat, bag, ...} }
 */
export function createCharacter(ctx, opts = {}) {
  const look = makeLook(opts);
  const lodMode = opts.lod === true ? 'lod' : opts.lod === false ? 'full' : 'auto';
  const camera = ctx?.camera || null;
  const scale = look.height / REF_HEIGHT;
  const palette = makePalette(look);
  const id = counter++;

  const group = new THREE.Group();
  group.name = 'personnage:' + (opts.name ?? '');
  const rig = new THREE.Group();
  rig.scale.setScalar(scale);
  group.add(rig);

  // --- squelette (positions de repos propres à la morphologie)
  const full0 = lodMode === 'lod' ? null : buildBody(look, false);
  const lod0 = lodMode === 'lod' ? buildBody(look, true) : null;
  const bonePos = (full0 || lod0).bonePos;
  const bones = [], rest = [];
  for (let i = 0; i < NB; i++) {
    const b = new THREE.Bone(), p = BONE_PARENT[i], bp = bonePos[i];
    rest.push(p < 0 ? bp : [bp[0] - bonePos[p][0], bp[1] - bonePos[p][1], bp[2] - bonePos[p][2]]);
    b.position.set(rest[i][0], rest[i][1], rest[i][2]);
    if (p >= 0) bones[p].add(b);
    bones.push(b);
  }
  rig.add(bones[0]);
  const skeleton = new THREE.Skeleton(bones);
  rig.updateMatrixWorld(true);
  const shx = bonePos[AR][0], armOff = SHOULDER_Y - bonePos[CH][1];

  let castShadow = opts.shadow ?? true, seenAt = -1e9, bindMatrix = null;
  const meshes = { full: null, lod: null };
  function makeMesh(kind, base) {
    const m = new THREE.SkinnedMesh(makeGeometry(base || buildBody(look, kind === 'lod'), palette), getMaterial());
    m.frustumCulled = true; m.receiveShadow = false;
    m.castShadow = castShadow && (kind === 'full' || lodMode === 'lod' && opts.shadow === true);
    m.boundingSphere = BS; m.boundingBox = BB;
    m.onBeforeRender = () => { seenAt = performance.now(); };
    rig.add(m);
    if (bindMatrix) m.bind(skeleton, bindMatrix); else { m.bind(skeleton); bindMatrix = m.bindMatrix; }
    meshes[kind] = m;
    return m;
  }
  let current = lodMode === 'lod' ? makeMesh('lod', lod0) : makeMesh('full', full0);
  // (après la liaison au squelette) les petites tailles gardent une tête proportionnellement un peu plus grande
  bones[HD].scale.setScalar(Math.pow(scale, -0.55));
  bones[LID].scale.y = 0.1;
  function show(kind) {
    const m = meshes[kind] || makeMesh(kind);
    if (m === current) return;
    current.visible = false; m.visible = true; current = m;
  }

  const weights = {}; for (const a of ANIMS) weights[a] = a === 'idle' ? 1 : 0;
  const P = new Float32Array(PN);
  // état partagé avec les poses : assis (recline, steer), déséquilibre (stS, stX, stZ), au sol (lie, lieT, face), relevé (gu)
  const g = look.gait, st = { recline: 0.3, steer: 0, stS: 0, stX: 0, stZ: -1, lie: null, lieT: 0, face: 'back', gu: 0, grT: 0 };
  let anim = 'idle', after = null, speed = 0, vSmooth = 0, phi = g.phase, t = g.phase * 3, acc = 0, frame = id, first = true;
  let wheel = null, steer = 0;
  let lastYaw = null, yawRate = 0, lean = 0, pitchLean = 0, lastV = 0;
  let blinkT = 1 + (g.phase % 3), blink = 0, lodT = (id % 10) * 0.03;
  // chute / position au sol : down = 0 debout .. 1 couché (orientation qDown autour du bassin)
  let rd = null, down = 0, knocks = 0;
  const qDown = new THREE.Quaternion().setFromAxisAngle(XAXIS, Math.PI / 2);
  const ragdoll = { active: false, settled: false, air: false, face: null };
  const falling = () => ragdoll.active && !ragdoll.settled;
  function ensureLie() { if (!st.lie) { st.lie = new Float32Array(PN); liePose(st.lie, 'back', (g.phase * 0.37) % 1, (g.phase * 0.61) % 1, 0.118); st.face = 'back'; } }

  /** Bras tendu vers le volant (cinématique inverse à deux segments, dans le repère du squelette). */
  function armIK(side, w, a3, rootY) {
    const A = side < 0 ? AL : AR, F = side < 0 ? FL : FR;
    const a1 = P[H * 3], a2 = a1 + P[SP * 3];
    // épaule : cinématique directe (le buste ne tourne qu'autour de X en pose assise)
    _S.set(side * shx, rootY + 0.12 * Math.cos(a1) + 0.16 * Math.cos(a2) + armOff * Math.cos(a3), 0.12 * Math.sin(a1) + 0.16 * Math.sin(a2) + armOff * Math.sin(a3));
    const al = (side * 78 + steer * 75) * Math.PI / 180, r = wheel.r;
    _T.set(wheel.x + Math.sin(al) * r, wheel.y + Math.cos(al) * r * 0.913, wheel.z - Math.cos(al) * r * 0.408 + 0.02);
    _d.subVectors(_T, _S);
    const D = Math.min(L_UP + L_FORE - 0.004, Math.max(0.12, _d.length()));
    _d.normalize();
    const a = (L_UP * L_UP - L_FORE * L_FORE + D * D) / (2 * D), h = Math.sqrt(Math.max(0, L_UP * L_UP - a * a));
    _pole.set(side * 0.35, -1, 0.25); _pole.addScaledVector(_d, -_pole.dot(_d)).normalize();
    _E.copy(_S).addScaledVector(_d, a).addScaledVector(_pole, h);
    _u1.subVectors(_E, _S).normalize();
    _u2.copy(_S).addScaledVector(_d, D).sub(_E).normalize();
    _qi.setFromAxisAngle(XAXIS, -a3); // vers le repère de la poitrine
    _u1.applyQuaternion(_qi); _u2.applyQuaternion(_qi);
    _qU.setFromUnitVectors(DOWN, _u1);
    _qi.copy(_qU).invert(); _u2.applyQuaternion(_qi);
    _qF.setFromUnitVectors(DOWN, _u2);
    bones[A].quaternion.slerp(_qU, w); bones[F].quaternion.slerp(_qF, w);
  }

  /** Oriente le corps entier autour du bassin (chute, position couchée, relevé). */
  function poseRig(q, px, py, pz) {
    rig.quaternion.copy(q);
    _S.set(px, py, pz); _T.copy(_S).applyQuaternion(q);
    rig.position.set((_S.x - _T.x) * scale, (_S.y - _T.y) * scale, (_S.z - _T.z) * scale);
  }

  function apply() {
    if (falling()) { // chute physique : la pose vient entièrement du ragdoll
      const a = rd.a;
      for (let i = 0; i < NB - 1; i++) bones[i].rotation.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
      bones[0].position.set(rest[0][0] + rd.dx, rd.h, rest[0][2] + rd.dz);
      poseRig(rd.q, rest[0][0] + rd.dx, rd.h, rest[0][2] + rd.dz);
      bones[LID].scale.y = 0.75; // yeux fermés sous le choc
      return;
    }
    P.fill(0);
    let total = 0;
    const v = vSmooth / scale;
    st.steer = steer;
    for (const a of ANIMS) {
      const w = weights[a];
      if (w < 0.004) continue;
      POSES[a](_tmp, t, g, phi, v, st);
      for (let i = 0; i < PN; i++) P[i] += _tmp[i] * w;
      total += w;
    }
    const k = total > 0 ? 1 / total : 0;
    for (let i = 0; i < PN; i++) P[i] *= k;
    for (let i = 0; i < NB - 1; i++) bones[i].rotation.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    bones[0].position.set(rest[0][0] + P[DX], rest[0][1] + P[DY], rest[0][2] + P[DZ]);
    // regard vers l'intérieur du virage
    if (yawRate) { bones[HD].rotation.y += Math.max(-0.35, Math.min(0.35, yawRate * 0.12)) * (1 - weights.sit); }
    const ws = weights.sit;
    if (ws > 0.02 && wheel) { const a3 = P[H * 3] + P[SP * 3] + P[CH * 3], ry = rest[0][1] + P[DY]; armIK(-1, ws, a3, ry); armIK(1, ws, a3, ry); }
    if (down > 0.001) {
      const e = down * down * (3 - 2 * down);
      _qU.identity().slerp(qDown, e);
      poseRig(_qU, rest[0][0] + P[DX], rest[0][1] + P[DY], rest[0][2] + P[DZ]);
    } else {
      rig.position.set(0, 0, 0);
      rig.rotation.set(pitchLean * (1 - ws), 0, lean * (1 - ws));
    }
    bones[LID].scale.y = 0.1 + 0.9 * Math.max(blink, weights.lying * 0.45);
  }

  const api = {
    group, bones, look, lodMode,
    get mesh() { return current; },
    /** hauteur du sommet de la tête (m) — pratique pour placer une étiquette de nom */
    height: look.height + 0.02,
    /** échelle du squelette (taille / 1,78) */
    scale,
    /** état de la chute : active (du choc jusqu'à la fin du relevé), settled (corps au repos au sol), air (pas encore touché le sol), face */
    ragdoll,
    /** 0 = debout .. 1 = allongé */
    get down() { return falling() ? 1 : down; },
    get anim() { return anim; },
    /**
     * Choc (voiture) : dirX/dirZ = direction du choc dans le monde, speed = vitesse de fermeture en m/s.
     * < ~2,2 m/s (8 km/h) : simple déséquilibre ('stumble') ; au-delà : chute physique puis 'lying'.
     * La trajectoire du groupe dans le monde reste pilotée par l'appelant. Retourne 'stumble' | 'knockdown'.
     */
    knock(o = {}) {
      let dx = o.dirX || 0, dz = o.dirZ || 0; const l = Math.hypot(dx, dz);
      if (l < 1e-4) { dx = 0; dz = -1; } else { dx /= l; dz /= l; }
      const yaw = group.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c, sp = Math.abs(o.speed || 0);
      if (falling() || down > 0.5) return 'knockdown'; // déjà à terre
      if (sp < KNOCK_SPEED && down < 0.01) {
        st.stS = 0; st.stX = lx; st.stZ = lz; anim = 'stumble'; after = null;
        return 'stumble';
      }
      if (!rd) rd = new Ragdoll();
      rd.start(lx, lz, sp / scale, P, (id * 7919 + (knocks++) * 104729 + Math.round(g.phase * 1000)) | 0);
      ragdoll.active = true; ragdoll.settled = false; ragdoll.air = true; ragdoll.face = rd.face;
      anim = 'lying'; after = null; st.gu = 0; down = 1; lean = pitchLean = 0; lastYaw = null; wheel = null;
      first = true; // la pose est recalculée même hors champ au prochain update
      return 'knockdown';
    },
    /**
     * @param s { anim: 'idle'|'walk'|'run'|'sit'|'jump'|'fall'|'stumble'|'lying'|'getup'|'limp'|'flee'|'cower', speed (m/s),
     *            steer (−1..1, assis), recline (rad, assis), wheel: {x, y, z, r} | null (centre du volant, repère du groupe) }
     * Pendant une chute (knock) les changements d'animation sont ignorés ; depuis 'lying', toute autre animation passe
     * d'abord par 'getup'.
     */
    setState(s = {}) {
      if (s.speed != null) speed = Math.abs(s.speed);
      else if (s.anim) speed = s.anim === 'run' || s.anim === 'flee' ? 5.5 : s.anim === 'walk' ? 1.4 : s.anim === 'limp' ? 0.8 : 0;
      if (s.steer != null) steer += (Math.max(-1, Math.min(1, s.steer)) - steer) * 0.25;
      if (s.recline != null) st.recline = s.recline;
      if (s.wheel !== undefined) wheel = s.wheel ? { x: s.wheel.x / scale, y: s.wheel.y / scale, z: s.wheel.z / scale, r: (s.wheel.r || 0.175) / scale } : null;
      const a = s.anim;
      if (!a || !POSES[a] || a === anim || falling()) { if (a && anim === 'getup' && a !== 'lying' && a !== 'getup') after = a; return; }
      if (anim === 'getup' && st.gu > 0) { if (a === 'lying') { anim = 'lying'; st.gu = 0; down = 1; } else after = a; return; }
      if (a === 'getup') { if (down < 0.5) return; ensureLie(); st.gu = 0; anim = 'getup'; after = null; return; }
      if (a === 'lying') { ensureLie(); st.lieT = 0; anim = 'lying'; return; }
      if (down > 0.5) { ensureLie(); st.gu = 0; anim = 'getup'; after = a; return; } // on ne se téléporte pas debout
      if (a === 'stumble') { st.stS = 0; st.stX = 0; st.stZ = -1; }
      if (a === 'grab') st.grT = 0;
      anim = a;
    },
    setShadow(on) { castShadow = !!on; if (meshes.full) meshes.full.castShadow = castShadow; },
    /** Force la pose immédiatement (sans fondu) ; annule une chute en cours. */
    snap() {
      ragdoll.active = ragdoll.settled = ragdoll.air = false;
      if (anim === 'lying') { ensureLie(); down = 1; } else if (anim !== 'getup') { down = 0; st.gu = 0; }
      for (const a of ANIMS) weights[a] = a === anim ? 1 : 0; vSmooth = speed; lean = pitchLean = 0; lastYaw = null; apply();
    },
    update(dt) {
      // --- niveau de détail automatique
      if (lodMode === 'auto' && camera) {
        lodT -= dt;
        if (lodT <= 0) {
          lodT = 0.3;
          const e = group.matrixWorld.elements, c = camera.position;
          const d2 = (e[12] - c.x) ** 2 + (e[13] - c.y) ** 2 + (e[14] - c.z) ** 2;
          if (current === meshes.full ? d2 > LOD_FAR * LOD_FAR : d2 < LOD_NEAR * LOD_NEAR) show(current === meshes.full ? 'lod' : 'full');
        }
      }
      // --- chute physique (ne coûte que pendant la chute)
      if (falling()) {
        t += dt;
        rd.step(dt);
        ragdoll.air = !rd.touched;
        if (rd.settled) {
          ragdoll.settled = true; ragdoll.air = false;
          qDown.copy(rd.q); st.lie = rd.lie; st.face = rd.face; st.lieT = 0; down = 1; anim = 'lying';
          for (const a of ANIMS) weights[a] = a === 'lying' ? 1 : 0;
          speed = vSmooth = 0;
        }
        if (first || performance.now() - seenAt <= 300) { first = false; apply(); }
        return;
      }
      const far = current === meshes.lod;
      if (far) { // au loin : pose recalculée une frame sur deux
        acc += dt; frame++;
        if (frame & 1 && !first) return;
        dt = acc; acc = 0;
      }
      t += dt;
      // --- au sol / relevé / déséquilibre
      const special = anim === 'lying' || anim === 'getup';
      if (anim === 'lying') { down = Math.min(1, down + dt / 0.45); st.lieT += dt; }
      else if (anim === 'getup') {
        st.gu += dt / (g.stoop > 0.06 ? 2.5 : 2.0);
        down = 1 - Math.min(1, Math.max(0, (st.gu - 0.14) / 0.4));
        if (st.gu >= 1) { st.gu = 0; down = 0; anim = after || 'idle'; after = null; ragdoll.active = ragdoll.settled = false; for (const a of ANIMS) weights[a] = a === 'idle' ? 1 : 0; }
      } else if (down > 0) { down = Math.max(0, down - dt / 0.4); if (down === 0) ragdoll.active = ragdoll.settled = false; }
      if (anim === 'grab') st.grT = Math.min(1, st.grT + dt / 0.75);
      if (anim === 'stumble') { st.stS += dt / 1.15; if (st.stS >= 1) { st.stS = 1; anim = after || 'idle'; after = null; } }
      const k = first ? 1 : 1 - Math.exp(-(special ? 16 : 9) * dt);
      for (const a of ANIMS) weights[a] += ((a === anim ? 1 : 0) - weights[a]) * k;
      // vitesse lissée (démarrages / arrêts progressifs) et cadence calée sur la vitesse réelle
      vSmooth += (speed - vSmooth) * (first ? 1 : 1 - Math.exp(-7 * dt));
      const runW = weights.run + weights.flee, moving = weights.walk + weights.limp + runW;
      if (moving > 0.01) phi += phaseRate(Math.max(vSmooth / scale, 0.35), runW / moving, g.cadence) * dt;
      if (phi > 1e4) phi -= Math.PI * 2 * 1000;
      // inclinaison dans les virages et à l'accélération (déduites du mouvement du groupe)
      const yaw = group.rotation.y;
      if (lastYaw !== null && dt > 0 && down <= 0) {
        let dy = yaw - lastYaw; if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
        const kk = 1 - Math.exp(-6 * dt);
        yawRate += (Math.max(-4, Math.min(4, dy / dt)) - yawRate) * kk;
        lean += (Math.max(-0.22, Math.min(0.22, yawRate * vSmooth * 0.022)) - lean) * kk;
        pitchLean += (Math.max(-0.1, Math.min(0.1, -((vSmooth - lastV) / dt) * 0.012)) - pitchLean) * kk;
      }
      lastYaw = yaw; lastV = vSmooth;
      // clignement des yeux
      if (!far) { blinkT -= dt; if (blinkT < 0) { blink = 1; if (blinkT < -0.11) { blink = 0; blinkT = 2 + ((phi * 7.3 + t) % 4); } } }
      // hors champ depuis un moment : on ne recalcule pas la pose
      if (!first && performance.now() - seenAt > 300) return;
      first = false;
      apply();
    },
    dispose() {
      group.removeFromParent();
      for (const kind of ['full', 'lod']) if (meshes[kind]) disposeGeometry(meshes[kind].geometry);
      skeleton.dispose();
    },
  };
  apply();
  seenAt = performance.now();
  return api;
}

/** Précharge l'atlas et le matériau (évite un à-coup à la première apparition). */
export function warmupCharacters() { getMaterial(); }

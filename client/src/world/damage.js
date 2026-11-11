// Dégâts du décor (contrat v2) : ctx.world.onImpact, chute physique de ce qui cède, effets en pool, réparation discrète.
// Rien ne tourne tant qu'il ne se passe rien : les listes actives sont vides et les maillages d'effets invisibles.
//
// Seuils (énergie cinétique ½·m·v² nécessaire pour faire céder l'objet) :
//   banc 4,5 kJ (≈ 11 km/h pour 1 t) · feu tricolore 6 kJ (12,5 km/h) · lampadaire et arbres 6,5 kJ (13 km/h)
//   table de terrasse 0,25 kJ (absorb 0,015) · colonne Morris, kiosque, bouche de métro, parapet, immeuble, monument : ne cèdent jamais.
import { createGlowTexture } from './textures.js';
import { createPropMaterial } from './props.js';

const G = 9.81;
// Tout le petit décor s'arrache dès ~12-13 km/h pour une voiture d'une tonne (en dessous : obstacle fixe, pour ne pas
// le faucher en manœuvrant) et ne coûte presque pas de vitesse : la conduite n'est pas interrompue.
export const BREAK_ENERGY = { banc: 4500, feu: 6000, lamp: 6500, tree: 6500 };
export const ABSORB = { banc: 0.03, feu: 0.04, lamp: 0.06 }; // arbre : 0,08 (jeune) à 0,15 (gros platane)
const MAX_DYN = 40, MAX_BROKEN = 60, REPAIR_DIST = 300, REPAIR_AGE = 40;
const FIXED = Object.freeze({ broke: false, absorb: 1 });
const GONE = Object.freeze({ broke: true, absorb: 0 });

export function createDamage(ctx, { props, veg, uniforms, terraces }) {
  const { THREE, scene, collision, bus, heightAt } = ctx;
  const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const V = new THREE.Vector3(), Q1 = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), AX = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let night = 0;

  // ------------------------------------------------------------ particules (feuilles, étincelles, éclats)
  const PCAP = 420;
  const pGeo = new THREE.PlaneGeometry(1, 1);
  const pMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const pMesh = new THREE.InstancedMesh(pGeo, pMat, PCAP);
  pMesh.frustumCulled = false; pMesh.visible = false; pMesh.count = 0; pMesh.name = 'degats-particules';
  pMesh.setColorAt(0, new THREE.Color(1, 1, 1));
  scene.add(pMesh);
  // px,py,pz, vx,vy,vz, vie, vieMax, taille, type, phase, sol
  const P = new Float32Array(PCAP * 12); let pN = 0;
  const pCol = new THREE.Color();
  function emit(type, x, y, z, n, spread, vx, vy, vz) {
    for (let i = 0; i < n && pN < PCAP; i++) {
      const o = pN * 12, r = Math.random;
      P[o] = x + (r() - 0.5) * spread; P[o + 1] = y + (r() - 0.5) * spread * (type === 0 ? 0.7 : 0.3); P[o + 2] = z + (r() - 0.5) * spread;
      if (type === 0) { // feuille : tombe en voletant
        P[o + 3] = vx * 0.15 + (r() - 0.5) * 1.5; P[o + 4] = -0.3 - r() * 0.8; P[o + 5] = vz * 0.15 + (r() - 0.5) * 1.5;
        P[o + 6] = P[o + 7] = 2.5 + r() * 3; P[o + 8] = 0.07 + r() * 0.06;
        const k = (0.6 + r() * 0.6) * (1 - 0.8 * night); pCol.setRGB(0.1 * k, 0.17 * k, 0.045 * k);
      } else if (type === 1) { // étincelle électrique
        P[o + 3] = vx * 0.2 + (r() - 0.5) * 5; P[o + 4] = 1 + r() * 4; P[o + 5] = vz * 0.2 + (r() - 0.5) * 5;
        P[o + 6] = P[o + 7] = 0.35 + r() * 0.6; P[o + 8] = 0.035 + r() * 0.03;
        pCol.setRGB(7, 3.5 + r() * 2, 0.8 + r());
      } else { // éclat (2 bois / écorce, 3 pierre / poussière, 4 métal / verre)
        P[o + 3] = vx * 0.3 + (r() - 0.5) * 4; P[o + 4] = 1.5 + r() * 3.5; P[o + 5] = vz * 0.3 + (r() - 0.5) * 4;
        P[o + 6] = P[o + 7] = 0.9 + r() * 1.2; P[o + 8] = 0.04 + r() * 0.07;
        const k = (0.6 + r() * 0.5) * (1 - 0.7 * night);
        if (type === 2) pCol.setRGB(0.28 * k, 0.2 * k, 0.11 * k); else if (type === 3) pCol.setRGB(0.5 * k, 0.47 * k, 0.4 * k); else pCol.setRGB(0.12 * k, 0.14 * k, 0.15 * k);
      }
      P[o + 9] = type; P[o + 10] = r() * 6.28; P[o + 11] = heightAt(P[o], P[o + 2]) + 0.03;
      pMesh.setColorAt(pN, pCol); pN++;
    }
    pMesh.instanceColor.needsUpdate = true; pMesh.visible = true;
  }
  function updateParticles(dt) {
    for (let i = 0; i < pN; i++) {
      const o = i * 12;
      P[o + 6] -= dt;
      if (P[o + 6] <= 0) { // supprime : remplace par la dernière
        pN--; if (i < pN) { P.copyWithin(o, pN * 12, pN * 12 + 12); pMesh.getColorAt(pN, pCol); pMesh.setColorAt(i, pCol); pMesh.instanceColor.needsUpdate = true; i--; }
        continue;
      }
      const type = P[o + 9], ground = P[o + 11];
      if (type === 0) { P[o + 4] = Math.max(P[o + 4] - 1.5 * dt, -1.6); P[o + 3] *= 1 - 1.2 * dt; P[o + 5] *= 1 - 1.2 * dt; P[o + 10] += dt * 5; P[o] += Math.sin(P[o + 10]) * 0.6 * dt; }
      else P[o + 4] -= G * dt;
      P[o] += P[o + 3] * dt; P[o + 1] += P[o + 4] * dt; P[o + 2] += P[o + 5] * dt;
      if (P[o + 1] < ground) { P[o + 1] = ground; if (type === 0) { P[o + 3] = P[o + 5] = 0; P[o + 4] = 0; } else { P[o + 4] *= -0.3; P[o + 3] *= 0.5; P[o + 5] *= 0.5; } }
      const s = P[o + 8] * (type === 1 ? P[o + 6] / P[o + 7] : Math.min(1, P[o + 6] * 3));
      const lying = type !== 1 && P[o + 1] <= ground + 0.001;
      V.set(P[o], P[o + 1], P[o + 2]);
      if (lying) Q1.setFromAxisAngle(AX.set(1, 0, 0), -Math.PI / 2); else Q1.setFromEuler(EUL.set(P[o + 10], P[o + 10] * 1.7, P[o + 10] * 0.6));
      pMesh.setMatrixAt(i, M.compose(V, Q1, S1.set(s, s * (type === 1 ? 3 : 1), s)));
    }
    S1.set(1, 1, 1);
    pMesh.count = pN; pMesh.instanceMatrix.needsUpdate = true;
    if (!pN) pMesh.visible = false;
  }
  const EUL = new THREE.Euler();

  // ------------------------------------------------------------ marques d'impact (décalques sombres, tampon circulaire)
  const DCAP = 40;
  const dMat = new THREE.MeshBasicMaterial({ map: createGlowTexture(THREE), color: 0x0a0806, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, side: THREE.DoubleSide });
  const dMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), dMat, DCAP);
  dMesh.frustumCulled = false; dMesh.visible = false; dMesh.count = 0; dMesh.name = 'degats-marques';
  scene.add(dMesh);
  let dNext = 0;
  /** Décalque vertical en (x,y,z), tourné vers la normale (nx,nz). */
  function mark(x, y, z, nx, nz, size) {
    V.set(x + nx * 0.03, y, z + nz * 0.03);
    Q1.setFromAxisAngle(UP, Math.atan2(nx, nz));
    dMesh.setMatrixAt(dNext % DCAP, M.compose(V, Q1, S1.set(size * 1.5, size, 1))); S1.set(1, 1, 1);
    dNext++; dMesh.count = Math.min(dNext, DCAP); dMesh.instanceMatrix.needsUpdate = true; dMesh.visible = true;
  }
  /** Marque sur la face touchée d'un obstacle (boîte orientée ou cercle). */
  function markShape(s, e, size) {
    const y = heightAt(e.x, e.z) + 0.65;
    if (s && s.kind === 'box') {
      const dx = e.x - s.x, dz = e.z - s.z, lx = dx * s.cos - dz * s.sin, lz = dx * s.sin + dz * s.cos;
      let nx = 0, nz = 0, px = lx, pz = lz;
      if (s.hw - Math.abs(lx) < s.hd - Math.abs(lz)) { nx = Math.sign(lx) || 1; px = nx * s.hw; pz = Math.max(-s.hd, Math.min(s.hd, lz)); }
      else { nz = Math.sign(lz) || 1; pz = nz * s.hd; px = Math.max(-s.hw, Math.min(s.hw, lx)); }
      mark(s.x + px * s.cos + pz * s.sin, y, s.z - px * s.sin + pz * s.cos, nx * s.cos + nz * s.sin, -nx * s.sin + nz * s.cos, size);
    } else if (s && s.kind === 'circle') mark(s.x - e.dirX * (s.r + 0.01), y, s.z - e.dirZ * (s.r + 0.01), -e.dirX, -e.dirZ, size);
  }

  // ------------------------------------------------------------ souches des arbres arrachés (1 draw call, sans collision)
  const SCAP = MAX_BROKEN + 4;
  const sGeo = new THREE.CylinderGeometry(0.24, 0.3, 0.34, 7); sGeo.translate(0, 0.17, 0);
  const sMesh = new THREE.InstancedMesh(sGeo, new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.95 }), SCAP);
  sMesh.frustumCulled = false; sMesh.visible = false; sMesh.count = 0; sMesh.receiveShadow = true; sMesh.name = 'degats-souches';
  scene.add(sMesh);
  const stumps = [];
  function writeStumps() {
    stumps.forEach((st, i) => sMesh.setMatrixAt(i, M.compose(V.set(st.x, st.y, st.z), Q1.identity(), S1.set(st.s, 1, st.s))));
    S1.set(1, 1, 1); sMesh.count = stumps.length; sMesh.visible = stumps.length > 0; sMesh.instanceMatrix.needsUpdate = true;
  }
  function addStump(d) { const st = { x: d.x, y: d.y, z: d.z, s: d.scale }; if (stumps.length < SCAP) { stumps.push(st); writeStumps(); } return st; }
  function removeStump(st) { const i = stumps.indexOf(st); if (i >= 0) { stumps.splice(i, 1); writeStumps(); } }

  // ------------------------------------------------------------ instances : masquer / rétablir / faire vibrer
  const wobbles = []; // { mesh, i, m0, ax, az, amp, lean, t, x, y, z }
  function instM0(d, mesh, i) { if (!d.m0) { d.m0 = new THREE.Matrix4(); mesh.getMatrixAt(i, d.m0); } return d.m0; }
  function setInst(mesh, i, m) { mesh.setMatrixAt(i, m); mesh.instanceMatrix.needsUpdate = true; }
  /** Vibration amortie (+ inclinaison résiduelle `lean` rad) d'une instance autour de son pied. */
  function wobble(d, mesh, i, e, amp, lean) {
    const m0 = instM0(d, mesh, i);
    d.lean = Math.min(0.09, (d.lean || 0) + lean); d.lx = e.dirX; d.lz = e.dirZ;
    let w = wobbles.find((w) => w.d === d);
    if (!w) wobbles.push((w = { d, mesh, i, m0 }));
    w.amp = amp; w.t = 0; w.ax = e.dirZ; w.az = -e.dirX;
  }
  function tiltMatrix(d, m0, ax, az, ang) {
    // rotation autour de l'axe horizontal (ax,0,az) passant par le pied (d.x, d.y, d.z)
    Q1.setFromAxisAngle(AX.set(ax, 0, az), ang);
    M.makeRotationFromQuaternion(Q1);
    M2.makeTranslation(d.x, d.y, d.z); M.premultiply(M2); M2.makeTranslation(-d.x, -d.y, -d.z); M.multiply(M2);
    return M.multiply(m0);
  }
  function updateWobbles(dt) {
    for (let k = wobbles.length - 1; k >= 0; k--) {
      const w = wobbles[k], d = w.d; w.t += dt;
      if (d.broken) { wobbles.splice(k, 1); continue; }
      const a = w.amp * Math.exp(-3.2 * w.t) * Math.sin(w.t * 26) + (d.lean || 0);
      const done = w.t > 1.6;
      setInst(w.mesh, w.i, tiltMatrix(d, w.m0, d.lean ? d.lz : w.ax, d.lean ? -d.lx : w.az, done ? d.lean || 0 : a));
      if (done) wobbles.splice(k, 1);
    }
  }

  // ------------------------------------------------------------ objets dynamiques (chute)
  const deadMat = createPropMaterial(THREE, { uLampOn: { value: 0 }, uSig: { value: 0 } }); // lanternes et feux éteints
  const active = [];  // en mouvement
  const broken = [];  // tout ce qui est cassé : { d, tag, x, z, r, t, obj, restore }
  function spawn(mesh, d, e, o) {
    mesh.position.set(d.x, d.y, d.z); mesh.castShadow = true; mesh.name = 'degats-objet';
    scene.add(mesh);
    const dyn = Object.assign({ mesh, x: d.x, y: d.y, z: d.z, dx: e.dirX, dz: e.dirZ, th: 0, w: 0, vx: 0, vy: 0, vz: 0, yaw: 0, hit: false, t: 0, tumble: false, L: 4, thMax: 1.52, tipY: 5 }, o);
    active.push(dyn);
    return dyn;
  }
  function updateDyn(dt) {
    for (let k = active.length - 1; k >= 0; k--) {
      const o = active[k]; o.t += dt;
      let settled = false;
      if (o.tumble) {
        // projeté : translation balistique + culbute, rebonds amortis
        o.vy -= G * dt; o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt; o.th += o.w * dt;
        const gy = heightAt(o.x, o.z) + o.rest;
        if (o.y < gy) {
          o.y = gy;
          if (o.vy < -1.2) { o.vy *= -0.32; if (!o.hit) { o.hit = true; emit(o.chip, o.x, o.y + 0.2, o.z, 6, 0.6, o.vx, 0, o.vz); } } else o.vy = 0;
          const f = Math.max(0, 1 - 5 * dt); o.vx *= f; o.vz *= f; o.w *= Math.max(0, 1 - 4 * dt);
          if (Math.hypot(o.vx, o.vz) < 0.25 && Math.abs(o.vy) < 0.1) { o.th = (Math.round(o.th / Math.PI - 0.5) + 0.5) * Math.PI; settled = true; }
        }
      } else {
        // bascule autour du pied : tige rigide (θ'' = 3g/2L·sinθ), rebond amorti au sol, léger glissement
        o.w += ((1.5 * G) / o.L) * Math.sin(Math.max(o.th, 0.02)) * dt; o.th += o.w * dt;
        const sp = Math.hypot(o.vx, o.vz);
        if (sp > 0.01) { const f = Math.max(0, sp - 5 * dt) / sp; o.vx *= f; o.vz *= f; o.x += o.vx * dt; o.z += o.vz * dt; }
        if (o.th >= o.thMax) {
          o.th = o.thMax;
          if (!o.hit) { o.hit = true; o.onGround?.(o); }
          if (o.w > 0.5) o.w *= -0.28; else { o.w = 0; if (sp < 0.05) settled = true; }
        }
      }
      Q1.setFromAxisAngle(AX.set(o.dz, 0, -o.dx), o.th); Q2.setFromAxisAngle(UP, o.yaw);
      o.mesh.quaternion.copy(Q1).multiply(Q2); o.mesh.position.set(o.x, o.y, o.z);
      if (settled || o.t > 12) active.splice(k, 1);
    }
  }
  /** Extrait la plage de sommets d'un mobilier fusionné vers un maillage autonome centré sur son pied, puis la masque. */
  function extractRange(d) {
    const src = d.geo.mesh.geometry, n = d.v1 - d.v0;
    const g = new THREE.BufferGeometry();
    const pos = src.attributes.position.array.slice(d.v0 * 3, d.v1 * 3);
    if (!d.saved) d.saved = pos.slice();
    for (let i = 0; i < n; i++) { pos[i * 3] -= d.x; pos[i * 3 + 1] -= d.y; pos[i * 3 + 2] -= d.z; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(src.attributes.normal.array.slice(d.v0 * 3, d.v1 * 3), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(src.attributes.color.array.slice(d.v0 * 3, d.v1 * 3), 3, true));
    g.setAttribute('aGlow', new THREE.BufferAttribute(src.attributes.aGlow.array.slice(d.v0, d.v1), 1, false));
    src.attributes.position.array.fill(0, d.v0 * 3, d.v1 * 3); // triangles dégénérés = invisibles
    src.attributes.position.needsUpdate = true;
    return g;
  }
  function restoreRange(d) {
    if (!d.saved) return;
    const a = d.geo.mesh.geometry.attributes.position; a.array.set(d.saved, d.v0 * 3); a.needsUpdate = true; d.saved = null; d.tilt = 0;
  }
  /** Incline (définitivement, jusqu'à réparation) un mobilier fusionné : Morris / kiosque cabossé. */
  function tiltRange(d, e, ang) {
    const a = d.geo.mesh.geometry.attributes.position;
    if (!d.saved) d.saved = a.array.slice(d.v0 * 3, d.v1 * 3);
    d.tilt = Math.min(0.1, (d.tilt || 0) + ang);
    if (!d.tx) { d.tx = e.dirX; d.tz = e.dirZ; }
    Q1.setFromAxisAngle(AX.set(d.tz, 0, -d.tx), d.tilt);
    for (let i = 0, n = d.v1 - d.v0; i < n; i++) {
      V.set(d.saved[i * 3] - d.x, d.saved[i * 3 + 1] - d.y, d.saved[i * 3 + 2] - d.z).applyQuaternion(Q1);
      a.array[(d.v0 + i) * 3] = V.x + d.x; a.array[(d.v0 + i) * 3 + 1] = V.y + d.y; a.array[(d.v0 + i) * 3 + 2] = V.z + d.z;
    }
    a.needsUpdate = true;
  }

  function register(d, shape, tag, obj, restore, r, e, E) {
    d.broken = true;
    collision.remove(shape);
    broken.push({ d, shape, tag, x: d.x, z: d.z, r, t: ctx.time, obj, restore });
    // plafonds : objets dynamiques et objets cassés simultanés
    let nd = 0; for (const b of broken) if (b.obj) nd++;
    for (let i = 0; nd > MAX_DYN && i < broken.length; i++) if (broken[i].obj) { dropObj(broken[i]); nd--; }
    while (broken.length > MAX_BROKEN) repair(0);
    bus.emit('world:propBroken', { tag, x: d.x, z: d.z, energy: E });
  }
  function dropObj(b) {
    if (!b.obj) return;
    const i = active.indexOf(b.obj); if (i >= 0) active.splice(i, 1);
    scene.remove(b.obj.mesh); if (b.obj.ownGeo) b.obj.mesh.geometry.dispose(); b.obj.mesh.dispose?.();
    b.obj = null;
  }
  function repair(i) {
    const b = broken[i]; broken.splice(i, 1);
    dropObj(b); b.restore();
    const d = b.d, s = b.shape; d.broken = false; d.lean = 0; d.m0 = null; d.t = -9; d.last = null;
    // la collision revient ; pour un objet de tuile, seulement si les collisions de sa tuile sont actives (elle la gère ensuite)
    if (d.tileRef) { if (d.tileRef.shapes) d.tileRef.shapes.push(collision.addCircle({ x: s.x, z: s.z, r: s.r, bottom: s.bottom, top: s.top, tag: s.tag, data: d })); }
    else collision.addCircle({ x: s.x, z: s.z, r: s.r, bottom: s.bottom, top: s.top, tag: s.tag, data: d });
  }
  /** Une tuile perd ses collisions ou est libérée : on oublie ses objets cassés (remis en place) et ses vibrations. */
  function releaseTile(t) {
    for (let i = broken.length - 1; i >= 0; i--) {
      const b = broken[i]; if (b.d.tileRef !== t) continue;
      broken.splice(i, 1); dropObj(b);
      try { b.restore(); } catch { /* maillage déjà libéré */ }
      const d = b.d; d.broken = false; d.lean = 0; d.m0 = null; d.t = -9; d.last = null; d.dented = false;
    }
    for (let k = wobbles.length - 1; k >= 0; k--) if (wobbles[k].d.tileRef === t) { const w = wobbles[k]; wobbles.splice(k, 1); try { setInst(w.mesh, w.i, w.m0); } catch { /* libéré */ } w.d.m0 = null; w.d.lean = 0; }
  }

  // ------------------------------------------------------------ onImpact
  let lastWall = -9, lastHitEvt = -9;
  function hitEvent(tag, e, E) { if (ctx.time - lastHitEvt > 0.25) { lastHitEvt = ctx.time; bus.emit('world:propHit', { tag, x: e.x, z: e.z, energy: E }); } }
  function onImpact(e) {
    if (!e) return FIXED;
    const s = e.shape, d = s?.data, tag = e.tag || s?.tag || '';
    const speed = Math.abs(e.speed) || 0, E = 0.5 * (e.mass || 1200) * speed * speed, now = ctx.time;
    if (!d || !d.type || d.type === 'metro') {
      // murs, parapets, bouches de métro, monuments : fixes ; trace d'impact et éclats si le choc est franc
      if (speed > 3.5 && now - lastWall > 0.35 && (tag === 'building' || tag === 'parapet' || tag === 'metro' || tag === 'monument')) {
        lastWall = now; markShape(s, e, Math.min(1.3, 0.4 + speed * 0.05));
        emit(tag === 'metro' ? 4 : 3, e.x, heightAt(e.x, e.z) + 0.7, e.z, Math.min(14, 3 + speed), 0.5, -e.dirX * speed, 0, -e.dirZ * speed);
        hitEvent(tag, e, E);
      }
      return FIXED;
    }
    if (d.broken) return GONE;
    // frottement : réponse mémorisée, aucun effet rejoué (sauf si le nouveau choc est nettement plus violent)
    if (now - (d.t ?? -9) < 0.3 && E <= (d.lastE || 0) * 1.5) return d.last || FIXED;
    d.t = now; d.lastE = E;
    let res = FIXED;
    let ux = +e.dirX || 0, uz = +e.dirZ || 0; const ul = Math.hypot(ux, uz);
    if (ul > 1e-4) { ux /= ul; uz /= ul; } else { ux = (s.x - e.x) || 0; uz = (s.z - e.z) || 1; const l2 = Math.hypot(ux, uz) || 1; ux /= l2; uz /= l2; }
    const dir = { dirX: ux, dirZ: uz, x: e.x, z: e.z };

    if (d.type === 'lamp') {
      const mesh = d.tile.mesh, Eb = BREAK_ENERGY.lamp;
      if (E >= Eb) {
        const m0 = instM0(d, mesh, d.i); setInst(mesh, d.i, ZERO);
        const obj = spawn(new THREE.Mesh(props.lampGeo, deadMat), d, dir, { L: 5.6, thMax: 1.5, w: Math.min(3.2, 0.5 + speed * 0.16), vx: dir.dirX * speed * 0.22, vz: dir.dirZ * speed * 0.22, yaw: d.tile[d.i * 4 + 3], tipY: 4.9,
          onGround(o) { const tx = o.x + o.dx * 4.9, tz = o.z + o.dz * 4.9; emit(1, tx, heightAt(tx, tz) + 0.3, tz, 14, 0.3, 0, 0, 0); emit(4, tx, heightAt(tx, tz) + 0.2, tz, 8, 0.5, o.dx * 3, 0, o.dz * 3); } });
        emit(1, d.x, d.y + 4.9, d.z, 16, 0.3, dir.dirX * 3, 0, dir.dirZ * 3);
        emit(4, d.x, d.y + 0.5, d.z, 6, 0.3, dir.dirX * speed, 0, dir.dirZ * speed);
        register(d, s, tag, obj, () => setInst(mesh, d.i, m0), 2.6, e, E);
        res = { broke: true, absorb: ABSORB.lamp };
      } else {
        wobble(d, mesh, d.i, dir, 0.02 + 0.05 * (E / Eb), E > Eb * 0.35 ? 0.05 * (E / Eb) : 0);
        if (E > Eb * 0.5) emit(1, d.x, d.y + 4.9, d.z, 4, 0.2, 0, 0, 0);
        hitEvent(tag, e, E);
        res = { broke: false, absorb: Math.min(1, E / Eb) };
      }
    } else if (d.type === 'tree') {
      const grp = d.group, Eb = BREAK_ENERGY.tree;
      if (!grp) return FIXED;
      const top = d.y + 9 * d.scale;
      if (E >= Eb) {
        // l'arbre est arraché : le tronc se brise au ras du sol et l'arbre bascule dans le sens du choc ; il reste une souche
        const m0 = instM0(d, grp.near, d.j); setInst(grp.near, d.j, ZERO);
        const im = new THREE.InstancedMesh(veg.geoFar[d.variant], veg.mat, 1);
        m0.decompose(V, Q1, S1); const sc = S1.x; S1.set(1, 1, 1);
        im.setMatrixAt(0, M.makeScale(sc, sc, sc)); grp.near.getColorAt(d.j, pCol); im.setColorAt(0, pCol); im.frustumCulled = false;
        const obj = spawn(im, d, dir, { L: 11 * d.scale, thMax: 1.22, w: Math.min(1.9, 0.35 + speed * 0.07), vx: dir.dirX * speed * 0.12, vz: dir.dirZ * speed * 0.12,
          onGround(o) { const tx = o.x + o.dx * 8 * d.scale, tz = o.z + o.dz * 8 * d.scale; emit(0, tx, heightAt(tx, tz) + 2, tz, 40, 5 * d.scale, o.dx * 4, 0, o.dz * 4); emit(2, tx, heightAt(tx, tz) + 0.5, tz, 6, 2, 0, 0, 0); } });
        obj.y += 0.3; // le fût repose sur la souche
        emit(2, d.x, d.y + 0.6, d.z, 14, 0.4, dir.dirX * speed, 0, dir.dirZ * speed);
        emit(0, d.x, top, d.z, 26, 5 * d.scale, 0, 0, 0);
        const st = addStump(d);
        register(d, s, tag, obj, () => { setInst(grp.near, d.j, m0); removeStump(st); }, 3, e, E);
        res = { broke: true, absorb: 0.08 + 0.07 * Math.min(1, Math.max(0, (d.scale - 0.65) / 0.55)) };
      } else {
        if (speed > 1.2) { wobble(d, grp.near, d.j, dir, 0.012 * (0.4 + E / Eb), 0); emit(0, d.x, top, d.z, 8, 6 * d.scale, 0, 0, 0); hitEvent(tag, e, E); }
        res = FIXED;
      }
    } else if (d.type === 'terrasse') {
      // mobilier de terrasse : très léger, il valse sans ralentir la voiture
      const T = terraces; if (!T || !T.mTables) return FIXED;
      if (E >= 250) {
        T.setBroken(d, true);
        const mesh = new THREE.Mesh(T.tGeo, deadMat);
        for (const o of [-0.42, 0.42]) { const c = new THREE.Mesh(T.cGeo, deadMat); c.position.set(o, 0, 0.36); c.rotation.set(o * 2, 0, o); mesh.add(c); }
        const obj = spawn(mesh, d, dir, { tumble: true, rest: 0.3, chip: 4, vx: dir.dirX * speed * 0.7, vz: dir.dirZ * speed * 0.7, vy: 2 + Math.min(3, speed * 0.2), w: Math.min(8, 1 + speed * 0.7) });
        register(d, s, tag, obj, () => T.setBroken(d, false), 0.8, e, E);
        res = { broke: true, absorb: 0.015 };
      } else res = { broke: false, absorb: Math.min(1, E / 250) };
    } else if (d.geo && d.geo.mesh) {
      // mobilier fusionné : feu tricolore, banc (cèdent) ; colonne Morris, kiosque (se cabossent, ne cèdent pas)
      const Eb = BREAK_ENERGY[d.type];
      if (Eb && E >= Eb) {
        const g = extractRange(d);
        const mesh = new THREE.Mesh(g, deadMat);
        let obj;
        if (d.type === 'banc') obj = spawn(mesh, d, dir, { tumble: true, ownGeo: true, rest: 0.25, chip: 2, vx: dir.dirX * speed * 0.6, vz: dir.dirZ * speed * 0.6, vy: 1.5 + Math.min(3, speed * 0.2), w: Math.min(7, speed * 0.6) });
        else obj = spawn(mesh, d, dir, { ownGeo: true, L: 3.5, thMax: 1.5, w: Math.min(3.5, 0.6 + speed * 0.2), vx: dir.dirX * speed * 0.25, vz: dir.dirZ * speed * 0.25,
          onGround(o) { const tx = o.x + o.dx * 3, tz = o.z + o.dz * 3; emit(1, tx, heightAt(tx, tz) + 0.3, tz, 8, 0.3, 0, 0, 0); } });
        if (d.type === 'feu') emit(1, d.x, d.y + 3, d.z, 12, 0.3, dir.dirX * 3, 0, dir.dirZ * 3);
        emit(d.type === 'banc' ? 2 : 4, d.x, d.y + 0.5, d.z, 8, 0.5, dir.dirX * speed, 0, dir.dirZ * speed);
        register(d, s, tag, obj, () => restoreRange(d), 1.5, e, E);
        res = { broke: true, absorb: ABSORB[d.type] || 0.04 };
      } else if (Eb) {
        hitEvent(tag, e, E);
        res = { broke: false, absorb: Math.min(1, E / Eb) };
      } else {
        if (E > 60000) { tiltRange(d, dir, 0.012 + 0.03 * Math.min(1, E / 250000)); emit(4, e.x, d.y + 0.9, e.z, 8, 0.5, -dir.dirX * speed, 0, -dir.dirZ * speed); markShape(s, dir, 0.6); if (!d.dented) { d.dented = true; broken.push({ d, shape: null, tag, x: d.x, z: d.z, r: 0, t: now, obj: null, restore: () => { restoreRange(d); d.tx = 0; d.dented = false; } }); } }
        if (speed > 3) hitEvent(tag, e, E);
        res = FIXED;
      }
    }
    d.last = res.broke ? null : res;
    return res;
  }

  // ------------------------------------------------------------ réparation discrète + mise à jour
  let repairT = 0;
  const camDir = new THREE.Vector3();
  function tryRepairs() {
    const p = ctx.player?.pos || ctx.camera.position;
    ctx.camera.getWorldDirection(camDir);
    for (let i = broken.length - 1; i >= 0; i--) {
      const b = broken[i]; if (ctx.time - b.t < REPAIR_AGE) continue;
      const dx = b.x - p.x, dz = b.z - p.z, dist = Math.hypot(dx, dz);
      // loin ET hors du champ de vision (derrière la caméra ou très loin)
      if (dist > REPAIR_DIST && (dx * camDir.x + dz * camDir.z < 0.2 * dist || dist > REPAIR_DIST * 2.5)) {
        if (b.shape) repair(i); else { broken.splice(i, 1); b.restore(); }
      }
    }
  }
  return {
    onImpact, releaseTile,
    /** Objets tombés au sol près de (x,z) : [{x, z, r, tag}] (pour l'évitement par le trafic / les piétons). */
    propsNear(x, z, r) {
      const out = [];
      for (const b of broken) if (b.obj && Math.hypot(b.obj.x + b.obj.dx * (b.obj.tumble ? 0 : b.r) - x, b.obj.z + b.obj.dz * (b.obj.tumble ? 0 : b.r) - z) < r + b.r) out.push({ x: b.obj.x + b.obj.dx * (b.obj.tumble ? 0 : b.r), z: b.obj.z + b.obj.dz * (b.obj.tumble ? 0 : b.r), r: b.r, tag: b.tag });
      return out;
    },
    stats: () => ({ broken: broken.length, active: active.length, particles: pN, wobbles: wobbles.length }),
    repairAll() { while (broken.length) { const b = broken[0]; if (b.shape) repair(0); else { broken.shift(); b.restore(); } } },
    update(dt, n) {
      night = n;
      if (active.length) updateDyn(dt);
      if (wobbles.length) updateWobbles(dt);
      if (pN) updateParticles(dt);
      if (broken.length && (repairT += dt) > 1) { repairT = 0; tryRepairs(); }
    },
  };
}

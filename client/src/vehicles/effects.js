// Effets des véhicules : fumée de pneus (particules), traces de dérapage (ruban), ombres de contact
// et halos de phares instanciés, projecteur réel pour la voiture du joueur local.
import * as THREE from 'three';

export function createEffects(ctx) {
  const { scene } = ctx;
  const low = ctx.quality === 'low';

  // ------------------------------------------------------------------ fumée
  const MAXP = low ? 160 : 420;
  const pPos = new Float32Array(MAXP * 3), pData = new Float32Array(MAXP * 4); // âge 0..1, taille, opacité, teinte
  const pVel = new Float32Array(MAXP * 3), pLife = new Float32Array(MAXP), pAge = new Float32Array(MAXP).fill(1e9), pGrow = new Float32Array(MAXP);
  let pHead = 0, pAlive = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('pdata', new THREE.BufferAttribute(pData, 4).setUsage(THREE.DynamicDrawUsage));
  pGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 }, uLight: { value: 1 } }]),
    vertexShader: /* glsl */`
      attribute vec4 pdata; uniform float uScale; varying vec4 vData;
      #include <fog_pars_vertex>
      void main() {
        vData = pdata;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = pdata.y * uScale / max(0.1, -mvPosition.z);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying vec4 vData; uniform float uLight;
      #include <fog_pars_fragment>
      void main() {
        vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;
        float a = smoothstep(1.0, 0.15, r) * vData.z * (1.0 - vData.x) * smoothstep(0.0, 0.08, vData.x);
        if (a < 0.004) discard;
        gl_FragColor = vData.w > 1.5 ? vec4(vec3(1.0, 0.6, 0.2) * 3.0, min(1.0, a * 3.0)) : vec4(vec3(vData.w) * uLight, a);
        #include <fog_fragment>
      }`,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false; points.renderOrder = 5; points.visible = false;
  scene.add(points);

  function smoke(x, y, z, vx, vy, vz, size, life, alpha, tint = 0.85) {
    const i = pHead; pHead = (pHead + 1) % MAXP;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
    pLife[i] = life; pAge[i] = 0; pGrow[i] = size * 1.6;
    pData[i * 4] = 0; pData[i * 4 + 1] = size; pData[i * 4 + 2] = alpha; pData[i * 4 + 3] = tint;
  }

  // ------------------------------------------------------------------ débris au sol (éclats de verre, plastique, tôle)
  const MAXD = low ? 120 : 320;
  const dGeo = new THREE.TetrahedronGeometry(1, 0);
  const debris = new THREE.InstancedMesh(dGeo, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.3 }), MAXD);
  debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage); debris.frustumCulled = false; debris.count = MAXD; debris.visible = false; debris.castShadow = false;
  const dS = []; let dHead = 0, dAlive = 0;
  const _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dp = new THREE.Vector3(), _ds = new THREE.Vector3(), _de = new THREE.Euler(), _dc = new THREE.Color();
  for (let i = 0; i < MAXD; i++) { dS.push({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, w: 0, s: 0, sx: 1, sy: 1, sz: 1, rest: false }); debris.setMatrixAt(i, _dm.makeScale(0, 0, 0)); debris.setColorAt(i, _dc.set(0xffffff)); }
  scene.add(debris);
  /** Projette n débris depuis (x,y,z). color : teinte ; big : gros morceau (pare-chocs, rétroviseur). */
  function spawnDebris(x, y, z, vx, vz, n, color, big) {
    for (let k = 0; k < n; k++) {
      const i = dHead; dHead = (dHead + 1) % MAXD; const d = dS[i];
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 4;
      d.x = x + (Math.random() - 0.5) * 0.5; d.y = y + Math.random() * 0.3; d.z = z + (Math.random() - 0.5) * 0.5;
      d.vx = vx * (0.3 + Math.random() * 0.5) + Math.cos(a) * sp; d.vz = vz * (0.3 + Math.random() * 0.5) + Math.sin(a) * sp; d.vy = 1.5 + Math.random() * 3.5;
      d.rx = Math.random() * 6; d.ry = Math.random() * 6; d.rz = Math.random() * 6; d.w = (Math.random() - 0.5) * 20;
      d.s = big ? 1 : 0.012 + Math.random() * 0.03; d.sx = big ? big[0] : 1 + Math.random() * 2; d.sy = big ? big[1] : 0.3 + Math.random() * 0.6; d.sz = big ? big[2] : 1 + Math.random();
      d.life = (low ? 12 : 24) + Math.random() * 8; d.rest = false;
      debris.setColorAt(i, _dc.set(color));
    }
    debris.instanceColor.needsUpdate = true; debris.visible = true;
  }
  function updateDebris(dt) {
    if (!debris.visible) return;
    dAlive = 0; let moved = false;
    for (let i = 0; i < MAXD; i++) {
      const d = dS[i];
      if (d.life <= 0) continue;
      d.life -= dt; dAlive++;
      if (d.life <= 0) { debris.setMatrixAt(i, _dm.makeScale(0, 0, 0)); moved = true; continue; }
      if (d.rest && d.life > 1) continue;
      if (!d.rest) {
        d.vy -= 9.81 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.rx += d.w * dt; d.rz += d.w * 0.7 * dt;
        const g = ctx.heightAt(d.x, d.z, d.y + 0.3) + d.s * d.sy * 0.5 + 0.01;   // sol du niveau où tombe le débris
        if (d.y < g) { d.y = g; if (Math.abs(d.vy) < 1.2) { d.rest = true; d.rx = 0; d.rz = 0; } d.vy = -d.vy * 0.3; d.vx *= 0.55; d.vz *= 0.55; d.w *= 0.5; }
      }
      const k = Math.min(1, d.life);
      _de.set(d.rx, d.ry, d.rz); _dq.setFromEuler(_de); _dp.set(d.x, d.y, d.z); _ds.set(d.s * d.sx * k, d.s * d.sy * k, d.s * d.sz * k);
      debris.setMatrixAt(i, _dm.compose(_dp, _dq, _ds)); moved = true;
    }
    if (moved) debris.instanceMatrix.needsUpdate = true;
    if (!dAlive) debris.visible = false;
  }
  /** Gerbe d'étincelles (frottement métal/pierre). */
  function sparks(x, y, z, vx, vz, n) {
    for (let k = 0; k < n; k++) smoke(x, y + Math.random() * 0.3, z, vx * 0.4 + (Math.random() - 0.5) * 5, 1 + Math.random() * 3, vz * 0.4 + (Math.random() - 0.5) * 5, 0.05 + Math.random() * 0.05, 0.2 + Math.random() * 0.3, 1, 2);
  }

  // ------------------------------------------------------------------ traces de pneus
  const MAXS = low ? 600 : 2400;
  const sPos = new Float32Array(MAXS * 12), sCol = new Float32Array(MAXS * 16);
  const sIdx = new Uint16Array(MAXS * 6);
  for (let i = 0; i < MAXS; i++) sIdx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 4).setUsage(THREE.DynamicDrawUsage));
  sGeo.setIndex(new THREE.BufferAttribute(sIdx, 1));
  sGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const sMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const skids = new THREE.Mesh(sGeo, sMat);
  skids.frustumCulled = false; skids.renderOrder = 1;
  scene.add(skids);
  let sHead = 0, sDirty = false;
  /** Ajoute un tronçon de trace entre deux positions de roue. */
  function skid(x0, y0, z0, x1, y1, z1, width, alpha0, alpha1) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
    if (l < 0.02 || l > 6) return;
    const px = (-dz / l) * width * 0.5, pz = (dx / l) * width * 0.5;
    const i = sHead; sHead = (sHead + 1) % MAXS;
    const o = i * 12;
    sPos[o] = x0 - px; sPos[o + 1] = y0 + 0.03; sPos[o + 2] = z0 - pz;
    sPos[o + 3] = x0 + px; sPos[o + 4] = y0 + 0.03; sPos[o + 5] = z0 + pz;
    sPos[o + 6] = x1 - px; sPos[o + 7] = y1 + 0.03; sPos[o + 8] = z1 - pz;
    sPos[o + 9] = x1 + px; sPos[o + 10] = y1 + 0.03; sPos[o + 11] = z1 + pz;
    const c = i * 16;
    for (let k = 0; k < 4; k++) { sCol[c + k * 4] = 1; sCol[c + k * 4 + 1] = 1; sCol[c + k * 4 + 2] = 1; sCol[c + k * 4 + 3] = k < 2 ? alpha0 : alpha1; }
    sDirty = true;
  }

  // ------------------------------------------------------------------ ombres de contact + halos de phares (instanciés)
  const MAXI = 96;
  function radialTexture(draw) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const shadowTex = radialTexture((g) => {
    // rectangle arrondi flou
    g.clearRect(0, 0, 128, 128);
    g.filter = 'blur(9px)'; g.fillStyle = '#000';
    g.beginPath(); if (g.roundRect) g.roundRect(22, 14, 84, 100, 18); else g.rect(22, 14, 84, 100); g.fill();
  });
  const plane = new THREE.PlaneGeometry(1, 1); plane.rotateX(-Math.PI / 2);
  const shadows = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x000000, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), MAXI);
  shadows.frustumCulled = false; shadows.count = 0; shadows.renderOrder = 0; scene.add(shadows);
  const beamTex = radialTexture((g) => {
    g.clearRect(0, 0, 128, 128);
    for (const cx of [48, 80]) {
      const gr = g.createRadialGradient(cx, 96, 2, cx, 70, 62);
      gr.addColorStop(0, 'rgba(255,246,225,0.55)'); gr.addColorStop(0.5, 'rgba(255,240,210,0.16)'); gr.addColorStop(1, 'rgba(255,240,210,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
  });
  const beams = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), MAXI);
  beams.frustumCulled = false; beams.count = 0; beams.renderOrder = 2; scene.add(beams);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
  let nShadow = 0, nBeam = 0;
  function beginFrame() { nShadow = 0; nBeam = 0; }
  function addShadow(x, y, z, yaw, pitch, roll, w, l) {
    if (nShadow >= MAXI) return;
    _e.set(pitch, yaw, roll); _q.setFromEuler(_e); _p.set(x, y + 0.045, z); _s.set(w, 1, l);
    shadows.setMatrixAt(nShadow++, _m.compose(_p, _q, _s));
  }
  function addBeam(x, y, z, yaw, pitch, w) {
    if (nBeam >= MAXI) return;
    const d = 6.2; // centre du halo devant le nez
    _e.set(pitch, yaw, 0); _q.setFromEuler(_e); _p.set(x - Math.sin(yaw) * d, y + 0.06, z - Math.cos(yaw) * d); _s.set(w * 3.4, 1, 13);
    beams.setMatrixAt(nBeam++, _m.compose(_p, _q, _s));
  }

  // ------------------------------------------------------------------ projecteur du joueur local (toujours dans la scène : pas de recompilation)
  const spot = new THREE.SpotLight(0xfff1d6, 0, 85, 0.62, 0.7, 1.6);
  spot.castShadow = false;
  scene.add(spot); scene.add(spot.target);
  function setSpot(v, on, info) {
    if (!on || !v) { spot.intensity = 0; return; }
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), nose = v.spec.length * 0.5;
    spot.position.set(v.pos.x + fx * (nose - 0.3), v.pos.y + (info?.headY ?? 0.7), v.pos.z + fz * (nose - 0.3));
    spot.target.position.set(v.pos.x + fx * (nose + 28), v.pos.y - 0.6, v.pos.z + fz * (nose + 28));
    spot.intensity = 190;
  }

  function update(dt, night) {
    // particules
    pAlive = 0;
    for (let i = 0; i < MAXP; i++) {
      if (pAge[i] >= pLife[i]) { if (pData[i * 4 + 2] !== 0) { pData[i * 4 + 2] = 0; } continue; }
      pAge[i] += dt; pAlive++;
      const k = Math.exp(-1.6 * dt);
      pVel[i * 3] *= k; pVel[i * 3 + 2] *= k; pVel[i * 3 + 1] += (0.55 - pVel[i * 3 + 1]) * Math.min(1, dt * 1.5);
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      pData[i * 4] = Math.min(1, pAge[i] / pLife[i]); pData[i * 4 + 1] += pGrow[i] * dt;
    }
    updateDebris(dt);
    points.visible = pAlive > 0;
    if (pAlive > 0 || points.userData.wasAlive) { pGeo.attributes.position.needsUpdate = true; pGeo.attributes.pdata.needsUpdate = true; }
    points.userData.wasAlive = pAlive > 0;
    pMat.uniforms.uScale.value = ctx.renderer.domElement.height / (2 * Math.tan((ctx.camera.fov * Math.PI) / 360));
    pMat.uniforms.uLight.value = night ? 0.35 : 1;
    if (sDirty) { sGeo.attributes.position.needsUpdate = true; sGeo.attributes.color.needsUpdate = true; sDirty = false; }
    shadows.count = nShadow; shadows.instanceMatrix.needsUpdate = true;
    beams.count = night ? nBeam : 0; beams.instanceMatrix.needsUpdate = true;
  }

  return { objects: { points, skids, shadows, beams, debris, spot }, spawnDebris, sparks, get debrisCount() { return dAlive; }, smoke, skid, beginFrame, addShadow, addBeam, setSpot, update, get particles() { return pAlive; } };
}

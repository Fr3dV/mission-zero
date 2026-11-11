// Marqueurs 3D du monde : colonnes lumineuses, anneaux au sol et icônes flottantes.
// Trois InstancedMesh (3 draw calls) pour TOUS les marqueurs, plus le ruban GPS (1 draw call).

export const ICON = {
  mission: 0, flag: 1, house: 2, key: 3, car: 4, garage: 5, lock: 6, camera: 7,
  star: 8, person: 9, parcel: 10, coin: 11, clock: 12, pin: 13, dealer: 14, wait: 15,
};

const CAP = 256;
const ATLAS_N = 4; // 4 x 4 cases

/** Atlas d'icônes dessiné au canvas. Rouge = pastille (teintée), noir = pictogramme, alpha = couverture. */
function makeAtlas(THREE) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * ATLAS_N;
  const g = cv.getContext('2d');
  const cell = (i, draw) => {
    const cx = (i % ATLAS_N) * S + S / 2, cy = Math.floor(i / ATLAS_N) * S + S / 2;
    g.save();
    g.translate(cx, cy);
    // pastille + liseré sombre
    g.fillStyle = '#000'; g.beginPath(); g.arc(0, 0, 60, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f00'; g.beginPath(); g.arc(0, 0, 53, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
    draw();
    g.restore();
  };
  const text = (t, size = 78, dy = 4) => { g.font = `900 ${size}px system-ui, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 0, dy); };
  const poly = (pts, fill = true) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); fill ? g.fill() : g.stroke(); };
  const red = () => { g.fillStyle = '#f00'; g.strokeStyle = '#f00'; };

  cell(ICON.mission, () => text('!', 88));
  cell(ICON.flag, () => { g.beginPath(); g.moveTo(-20, -34); g.lineTo(-20, 36); g.stroke(); poly([[-16, -34], [30, -20], [-16, -4]]); });
  cell(ICON.house, () => { poly([[-36, -4], [0, -36], [36, -4]]); g.fillRect(-26, -6, 52, 38); red(); g.fillRect(-8, 8, 16, 24); });
  cell(ICON.key, () => { g.beginPath(); g.arc(-16, -8, 16, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(-4, 2); g.lineTo(30, 30); g.moveTo(18, 20); g.lineTo(28, 10); g.moveTo(26, 28); g.lineTo(34, 20); g.stroke(); });
  cell(ICON.car, () => { poly([[-38, 14], [-38, -2], [-24, -6], [-14, -24], [16, -24], [26, -6], [38, -2], [38, 14]]); g.beginPath(); g.arc(-20, 16, 9, 0, Math.PI * 2); g.arc(20, 16, 9, 0, Math.PI * 2); g.fill(); red(); poly([[-16, -8], [-9, -18], [12, -18], [18, -8]]); });
  cell(ICON.garage, () => text('P', 80));
  cell(ICON.lock, () => { g.fillRect(-24, -6, 48, 38); g.beginPath(); g.arc(0, -8, 16, Math.PI, 0); g.stroke(); });
  cell(ICON.camera, () => { g.fillRect(-36, -18, 72, 46); g.fillRect(-14, -30, 28, 14); red(); g.beginPath(); g.arc(0, 5, 14, 0, Math.PI * 2); g.fill(); });
  cell(ICON.star, () => { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 17 : 40; p.push([Math.cos(a) * r, Math.sin(a) * r + 2]); } poly(p); });
  cell(ICON.person, () => { g.beginPath(); g.arc(0, -22, 13, 0, Math.PI * 2); g.fill(); poly([[-22, 34], [-18, 0], [0, -6], [18, 0], [22, 34]]); });
  cell(ICON.parcel, () => { g.fillRect(-30, -24, 60, 52); red(); g.fillRect(-5, -24, 10, 52); g.fillRect(-30, -4, 60, 8); });
  cell(ICON.coin, () => text('Ƶ', 76));
  cell(ICON.clock, () => { g.beginPath(); g.arc(0, 2, 32, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(0, 2); g.lineTo(0, -18); g.moveTo(0, 2); g.lineTo(14, 10); g.stroke(); });
  cell(ICON.pin, () => { poly([[-24, -10], [0, 40], [24, -10]]); g.beginPath(); g.arc(0, -12, 25, 0, Math.PI * 2); g.fill(); red(); g.beginPath(); g.arc(0, -12, 10, 0, Math.PI * 2); g.fill(); });
  cell(ICON.dealer, () => { g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill(); for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i * Math.PI * 2) / 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 30, Math.sin(a) * 30); g.stroke(); } });
  cell(ICON.wait, () => text('…', 70, -8));

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const COMMON_VS = /* glsl */ `
  attribute vec3 aColor;
  attribute vec4 aData; // x = icône, y = portée (m), z = phase, w = taille
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vFade;
  varying float vPhase;
`;

/**
 * @param opts.yAt  (x, z, ele?) => hauteur du sol au niveau voulu (ele = élévation relative de la chaussée : ponts, trémies)
 */
export function createMarkers(ctx, opts = {}) {
  const { THREE, scene } = ctx;
  const yAt = opts.yAt || ((x, z) => ctx.heightAt?.(x, z) ?? 0);
  const uTime = { value: 0 };
  const group = new THREE.Group();
  group.name = 'gameplay-markers';
  scene.add(group);

  const aColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  const aData = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  aColor.setUsage(THREE.DynamicDrawUsage); aData.setUsage(THREE.DynamicDrawUsage);

  const mk = (geo, mat, order) => {
    geo.setAttribute('aColor', aColor);
    geo.setAttribute('aData', aData);
    const m = new THREE.InstancedMesh(geo, mat, CAP);
    m.count = 0; m.frustumCulled = false; m.renderOrder = order;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
  };
  const matOpts = { transparent: true, depthWrite: false, toneMapped: false, fog: false };

  // --- colonnes lumineuses ---
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
  beamGeo.translate(0, 0.5, 0);
  const beams = mk(beamGeo, new THREE.ShaderMaterial({
    ...matOpts, side: THREE.DoubleSide, uniforms: { uTime },
    vertexShader: COMMON_VS + /* glsl */ `
      void main() {
        vUv = uv; vColor = aColor; vPhase = aData.z;
        vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float d = distance(cameraPosition.xz, c.xz);
        vFade = 1.0 - smoothstep(aData.y * 0.75, aData.y, d);
        vec3 p = position;
        p.xz *= 1.0 + d * 0.0035; // reste lisible de loin
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying vec3 vColor; varying float vFade; varying float vPhase;
      void main() {
        float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.7) * 0.62; // clamp : pow(x<0) = NaN, fatal avec le bloom HDR
        a *= 0.82 + 0.18 * sin(uTime * 2.2 + vPhase + vUv.y * 9.0);
        a *= vFade;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor * 1.25, a);
      }`,
  }), 20);

  // --- anneaux au sol ---
  const ringGeo = new THREE.PlaneGeometry(2, 2);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = mk(ringGeo, new THREE.ShaderMaterial({
    ...matOpts, side: THREE.DoubleSide, uniforms: { uTime }, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    vertexShader: COMMON_VS + /* glsl */ `
      void main() {
        vUv = uv; vColor = aColor; vPhase = aData.z;
        vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float d = distance(cameraPosition.xz, c.xz);
        vFade = 1.0 - smoothstep(aData.y * 0.75, aData.y, d);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying vec3 vColor; varying float vFade; varying float vPhase;
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        if (r > 1.0) discard;
        float ring = smoothstep(0.80, 0.86, r) * (1.0 - smoothstep(0.95, 1.0, r));
        float fill = 0.16 * (1.0 - smoothstep(0.80, 0.86, r));
        float p = fract(uTime * 0.45 + vPhase * 0.16);
        float pulse = (1.0 - smoothstep(0.0, 0.05, abs(r - p * 0.84))) * (1.0 - p) * 0.55;
        float a = (ring * 0.95 + fill + pulse) * vFade;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor * 1.2, a);
      }`,
  }), 19);

  // --- icônes flottantes (billboards) ---
  const atlas = makeAtlas(THREE);
  const icons = mk(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    ...matOpts, uniforms: { uTime, uMap: { value: atlas } },
    vertexShader: COMMON_VS + /* glsl */ `
      void main() {
        vColor = aColor;
        float idx = floor(aData.x + 0.5);
        float col = mod(idx, ${ATLAS_N}.0), row = floor(idx / ${ATLAS_N}.0);
        vUv = vec2((col + uv.x) / ${ATLAS_N}.0, 1.0 - (row + 1.0 - uv.y) / ${ATLAS_N}.0);
        vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float d = distance(cameraPosition, c.xyz);
        vFade = 1.0 - smoothstep(aData.y * 0.75, aData.y, d);
        float size = aData.w * clamp(d / 38.0, 1.0, 16.0); // taille apparente minimale
        c.y += (size - aData.w) * 0.55 + sin(uTime * 1.6 + aData.z) * 0.25;
        vec4 mv = viewMatrix * c;
        mv.xy += position.xy * size;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; varying vec2 vUv; varying vec3 vColor; varying float vFade;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        float a = t.a * vFade;
        if (a < 0.02) discard;
        gl_FragColor = vec4(mix(vec3(0.05, 0.06, 0.08), vColor, t.r), a);
      }`,
  }), 22);

  const layers = new Map(); // nom -> liste de marqueurs
  let dirty = true;
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  function rebuild() {
    dirty = false;
    let n = 0;
    for (const list of layers.values()) {
      for (const k of list) {
        if (n >= CAP) break;
        const y = Number.isFinite(k.y) ? k.y : yAt(k.x, k.z);
        col.set(k.color ?? 0xffffff);
        aColor.setXYZ(n, col.r, col.g, col.b);
        const phase = (k.x * 0.37 + k.z * 0.71) % 6.283;
        aData.setXYZW(n, k.icon ?? 0, k.range ?? 1500, phase, k.iconSize ?? 2.2);
        const bh = k.beamH ?? 60, br = k.beamR ?? 0.9;
        if (bh > 0) { m4.makeScale(br, bh, br); m4.setPosition(k.x, y, k.z); beams.setMatrixAt(n, m4); } else beams.setMatrixAt(n, zero);
        const rr = k.radius ?? 4;
        if (rr > 0) { m4.makeScale(rr, 1, rr); m4.setPosition(k.x, y + 0.14, k.z); rings.setMatrixAt(n, m4); } else rings.setMatrixAt(n, zero);
        if (k.icon != null) { m4.identity(); m4.setPosition(k.x, y + (k.iconY ?? 4.5), k.z); icons.setMatrixAt(n, m4); } else icons.setMatrixAt(n, zero);
        n++;
      }
    }
    beams.count = rings.count = icons.count = n;
    beams.instanceMatrix.needsUpdate = rings.instanceMatrix.needsUpdate = icons.instanceMatrix.needsUpdate = true;
    aColor.needsUpdate = aData.needsUpdate = true;
  }

  // ---------------- ruban GPS au sol ----------------
  const MAXQ = 160;
  const ribGeo = new THREE.BufferGeometry();
  const ribPos = new THREE.BufferAttribute(new Float32Array(MAXQ * 4 * 3), 3);
  const ribUv = new THREE.BufferAttribute(new Float32Array(MAXQ * 4 * 2), 2);
  ribPos.setUsage(THREE.DynamicDrawUsage); ribUv.setUsage(THREE.DynamicDrawUsage);
  const idx = [];
  for (let i = 0; i < MAXQ; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3);
  ribGeo.setIndex(idx);
  ribGeo.setAttribute('position', ribPos);
  ribGeo.setAttribute('uv', ribUv);
  ribGeo.setDrawRange(0, 0);
  const ribColor = { value: new THREE.Color(0x35d0ff) };
  const ribbon = new THREE.Mesh(ribGeo, new THREE.ShaderMaterial({
    ...matOpts, side: THREE.DoubleSide, uniforms: { uTime, uColor: ribColor }, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main() {
        float x = abs(vUv.x - 0.5) * 2.0;
        // chevrons qui avancent vers l'objectif (vUv.y = distance en mètres, vUv.x = travers)
        float c = fract((vUv.y - x * 1.6) / 7.0 - uTime * 0.9);
        float chev = smoothstep(0.0, 0.08, c) * (1.0 - smoothstep(0.42, 0.5, c));
        float edge = 1.0 - smoothstep(0.75, 1.0, x);
        float a = (0.16 + chev * 0.5) * edge;
        gl_FragColor = vec4(uColor * 1.15, a);
      }`,
  }));
  ribbon.frustumCulled = false; ribbon.renderOrder = 18; ribbon.visible = false;
  group.add(ribbon);

  /**
   * Trace le ruban le long de `path` ([[x,z],...]) à partir de la distance curviligne `from`, sur `length` mètres.
   */
  function setRibbon(path, startIndex = 0, startT = 0, length = 320, width = 2.6) {
    if (!path || path.length < 2) { ribbon.visible = false; ribGeo.setDrawRange(0, 0); return; }
    const hw = width / 2;
    let q = 0, left = length, travelled = 0;
    for (let i = startIndex; i < path.length - 1 && q < MAXQ && left > 0; i++) {
      let ax = path[i][0], az = path[i][1];
      const bx0 = path[i + 1][0], bz0 = path[i + 1][1];
      // élévation de la chaussée (3e composante des points d'itinéraire) : le ruban suit les ponts et les trémies
      let e0 = path[i][2], e1 = path[i + 1][2];
      if (!Number.isFinite(e0)) e0 = e1;
      if (!Number.isFinite(e1)) e1 = e0;
      if (i === startIndex) { ax += (bx0 - ax) * startT; az += (bz0 - az) * startT; if (Number.isFinite(e0)) e0 += (e1 - e0) * startT; }
      let segLen = Math.hypot(bx0 - ax, bz0 - az);
      if (segLen < 0.05) continue;
      const dx = (bx0 - ax) / segLen, dz = (bz0 - az) / segLen;
      const use = Math.min(segLen, left);
      // découpe en tronçons de 25 m max pour épouser le relief
      const parts = Math.max(1, Math.ceil(use / 25));
      for (let p = 0; p < parts && q < MAXQ; p++) {
        const s0 = (use * p) / parts, s1 = (use * (p + 1)) / parts;
        const x0 = ax + dx * s0, z0 = az + dz * s0, x1 = ax + dx * s1, z1 = az + dz * s1;
        const y0 = yAt(x0, z0, Number.isFinite(e0) ? e0 + ((e1 - e0) * s0) / segLen : undefined) + 0.22;
        const y1 = yAt(x1, z1, Number.isFinite(e0) ? e0 + ((e1 - e0) * s1) / segLen : undefined) + 0.22;
        const o = q * 12, u = q * 8;
        const a = ribPos.array, uv = ribUv.array;
        a[o] = x0 - dz * hw; a[o + 1] = y0; a[o + 2] = z0 + dx * hw;
        a[o + 3] = x0 + dz * hw; a[o + 4] = y0; a[o + 5] = z0 - dx * hw;
        a[o + 6] = x1 - dz * hw; a[o + 7] = y1; a[o + 8] = z1 + dx * hw;
        a[o + 9] = x1 + dz * hw; a[o + 10] = y1; a[o + 11] = z1 - dx * hw;
        uv[u] = 0; uv[u + 1] = travelled + s0; uv[u + 2] = 1; uv[u + 3] = travelled + s0;
        uv[u + 4] = 0; uv[u + 5] = travelled + s1; uv[u + 6] = 1; uv[u + 7] = travelled + s1;
        q++;
      }
      travelled += use; left -= use;
    }
    ribPos.needsUpdate = true; ribUv.needsUpdate = true;
    ribGeo.setDrawRange(0, q * 6);
    ribbon.visible = q > 0;
  }

  return {
    group,
    /** Remplace la liste de marqueurs d'une couche. item = { x, z, y?, color, icon?, radius?, beamH?, beamR?, range?, iconSize?, iconY? } */
    set(layer, list) { layers.set(layer, list || []); dirty = true; },
    clear(layer) { if (layers.get(layer)?.length) { layers.set(layer, []); dirty = true; } },
    setRibbon,
    clearRibbon() { ribbon.visible = false; ribGeo.setDrawRange(0, 0); },
    setRibbonColor(c) { ribColor.value.set(c); },
    get count() { return beams.count; },
    update(dt) { uTime.value += dt; if (dirty) rebuild(); },
  };
}

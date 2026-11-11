// Boîte à outils des monuments : palette de matériaux, textures procédurales (canvas),
// matériau PBR partagé (couleur/rugosité/métal/lueur par sommet) et constructeur de géométrie fusionnée.
// Convention locale de chaque monument : façade principale vers +Z, sol à y = 0, mètres.
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const TEX = 4; // une tuile de texture de pierre = 4 m (assises de 50 cm)

// ---------- palette : c = couleur, r = rugosité, m = métal, t = force de la texture de pierre, g = lueur nocturne ----------
// g <= 1.5 : façade éclairée par projecteurs (proportionnelle à la couleur) ; g = 2 : fenêtre allumée.
const mk = (c, r, m, t, g) => { const col = new THREE.Color(c); return { c: [col.r, col.g, col.b], r, m, t, g }; };
export const mat = mk;
export const P = {
  stone: mk(0xcdc1a4, 0.92, 0, 1, 1),
  stoneL: mk(0xdbd2ba, 0.9, 0, 1, 1),
  stoneD: mk(0xab9f86, 0.95, 0, 1, 0.9),
  stoneW: mk(0xe3ded2, 0.86, 0, 0.75, 1),     // travertin blanc (Sacré-Cœur)
  stoneG: mk(0xc2bcab, 0.92, 0, 1, 1),        // pierre grise (Notre-Dame)
  deco: mk(0xc3b596, 0.95, 0, 0.3, 1),        // reliefs sculptés
  shadow: mk(0x1d1a16, 1, 0, 0, 0.05),        // creux sombres (baies, portails)
  glass: mk(0x18222c, 0.1, 0.15, 0, 0),
  glassLit: mk(0x2a2a22, 0.3, 0, 0, 2),
  vitrail: mk(0x26304a, 0.25, 0.1, 0, 2),
  zinc: mk(0x7a858f, 0.42, 0.55, 0, 0.35),
  slate: mk(0x4d5761, 0.55, 0.3, 0, 0.3),
  lead: mk(0x8d9498, 0.5, 0.45, 0, 0.5),
  copper: mk(0x5f9482, 0.7, 0.2, 0, 0.8),
  verdigris: mk(0x4c7466, 0.65, 0.3, 0, 0.6),
  gold: mk(0xe2b23a, 0.3, 0.75, 0, 1.4),
  bronze: mk(0x3a463d, 0.5, 0.5, 0, 0.5),
  iron: mk(0x6d5840, 0.6, 0.4, 0, 1.3),
  ironD: mk(0x4a3c2e, 0.65, 0.4, 0, 0.8),
  granite: mk(0xb98d7c, 0.5, 0.05, 0.5, 1),
  water: mk(0x1f3d46, 0.08, 0.1, 0, 0.25),
  foam: mk(0xe8f2f5, 0.4, 0, 0, 0.9),
  pave: mk(0xc6bfae, 0.9, 0, 1, 0),
  paveD: mk(0x9a958a, 0.9, 0, 1, 0),
  steel: mk(0x8fa39a, 0.5, 0.5, 0, 0.6),      // charpente vert réséda (Grand Palais)
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- textures ----------
function tileNoise(S, cell, seed) {
  // bruit de valeur périodique (période S)
  const n = S / cell, r = rng(seed), g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[(iy % n) * n + (ix % n)], b = g[(iy % n) * n + ((ix + 1) % n)];
    const c = g[((iy + 1) % n) * n + (ix % n)], d = g[((iy + 1) % n) * n + ((ix + 1) % n)];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function makeStone(aniso) {
  const S = 512, COURSE = 64, BLOCK = 128;
  const n1 = tileNoise(S, 64, 11), n2 = tileNoise(S, 16, 23), n3 = tileNoise(S, 4, 37);
  const hgt = new Float32Array(S * S);
  const col = new Uint8Array(S * S * 4), nor = new Uint8Array(S * S * 4);
  const br = rng(5);
  const tints = []; for (let i = 0; i < 64; i++) tints.push(0.9 + 0.1 * br());
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = Math.floor(y / COURSE), xo = (x + (row % 2) * BLOCK / 2) % S;
    const bx = Math.floor(xo / BLOCK), fy = y % COURSE, fx = xo % BLOCK;
    const dj = Math.min(fy, COURSE - 1 - fy, fx, BLOCK - 1 - fx);
    const joint = smooth(0, 3, dj);
    const n = n1(x, y) * 0.5 + n2(x, y) * 0.3 + n3(x, y) * 0.2;
    hgt[y * S + x] = joint * 0.8 + n * 0.25;
    const c = (0.94 + 0.06 * tints[(row * 4 + bx) % 64]) * (0.9 + 0.12 * n) * (0.8 + 0.2 * joint);
    const i = (y * S + x) * 4;
    col[i] = Math.min(255, c * 262); col[i + 1] = Math.min(255, c * 258); col[i + 2] = Math.min(255, c * 250); col[i + 3] = 255;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const h = (xx, yy) => hgt[((yy + S) % S) * S + ((xx + S) % S)];
    const dx = (h(x + 1, y) - h(x - 1, y)) * 2.2, dy = (h(x, y + 1) - h(x, y - 1)) * 2.2;
    const l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    nor[i] = (-dx / l * 0.5 + 0.5) * 255; nor[i + 1] = (-dy / l * 0.5 + 0.5) * 255; nor[i + 2] = (1 / l * 0.5 + 0.5) * 255; nor[i + 3] = 255;
  }
  const mkTex = (data, srgb) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
    return t;
  };
  return { map: mkTex(col, true), normalMap: mkTex(nor, false) };
}

// Masque dessiné en canvas 2D (blanc = matière) -> DataTexture RGBA de couleur uniforme (pas de franges sombres).
function maskTexture(w, h, draw, color, aniso, opts = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'butt';
  draw(g, w, h);
  const src = g.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h * 4);
  const r = rng(77), c = new THREE.Color(color).convertLinearToSRGB();
  const aMin = opts.alphaMin ?? 0;
  for (let i = 0; i < w * h; i++) {
    const k = 0.88 + 0.2 * r(), m = src[i * 4] / 255;
    const c2 = opts.fill && m < 0.5 ? opts.fill : null;
    out[i * 4] = Math.min(255, (c2 ? c2[0] : c.r * k) * 255); out[i * 4 + 1] = Math.min(255, (c2 ? c2[1] : c.g * k) * 255); out[i * 4 + 2] = Math.min(255, (c2 ? c2[2] : c.b * k) * 255);
    out[i * 4 + 3] = Math.max(aMin, m) * 255;
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  t.wrapS = opts.wrapS ?? THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = aniso; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

// Atlas de treillis de la Tour Eiffel : 4 colonnes de 256 px, chaque motif se répète verticalement (v).
function drawLattice(g) {
  const C = 256, line = (x0, y0, x1, y1, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  const col = (i, fn) => { g.save(); g.beginPath(); g.rect(i * C, 0, C, C); g.clip(); g.translate(i * C, 0); fn(); g.restore(); };
  // 0 : panneau de pilier (membrures, traverses, croix de Saint-André, treillis secondaire)
  col(0, () => {
    g.fillRect(0, 0, 22, C); g.fillRect(C - 22, 0, 22, C);
    g.fillRect(0, 0, C, 8); g.fillRect(0, C - 8, C, 8);
    line(12, 0, C - 12, C, 15); line(C - 12, 0, 12, C, 15);
    line(C / 2, 0, 12, C / 2, 8); line(12, C / 2, C / 2, C, 8); line(C / 2, 0, C - 12, C / 2, 8); line(C - 12, C / 2, C / 2, C, 8);
    g.fillRect(0, C / 2 - 4, C, 8);
    for (const y of [C / 4, 3 * C / 4]) g.fillRect(0, y - 2.5, C, 5);
    line(C / 4, 0, C / 4, C, 5); line(3 * C / 4, 0, 3 * C / 4, C, 5);
  });
  // 1 : poutre-treillis dense (arches, frises)
  col(1, () => {
    g.fillRect(0, 0, 34, C); g.fillRect(C - 34, 0, 34, C);
    for (let k = 0; k < 2; k++) { const y = k * 128; line(20, y, C - 20, y + 128, 18); line(C - 20, y, 20, y + 128, 18); g.fillRect(0, y - 6, C, 12); }
    g.fillRect(0, C - 6, C, 6);
  });
  // 2 : barreaux (écoinçons des arches) — lignes le long de u, répétées en v
  col(2, () => {
    for (let k = 0; k < 4; k++) g.fillRect(0, k * 64 + 20, C, 24);
    g.fillRect(0, 0, 14, C); g.fillRect(C - 14, 0, 14, C); g.fillRect(C / 2 - 6, 0, 12, C);
  });
  // 3 : garde-corps à arcades (u = vertical, v = horizontal)
  col(3, () => {
    g.fillRect(0, 0, 40, C); g.fillRect(C - 46, 0, 46, C);
    for (let k = 0; k < 4; k++) { g.fillRect(0, k * 64, C, 12); g.beginPath(); g.arc(C - 46, k * 64 + 38, 40, 0, Math.PI * 2); g.lineWidth = 14; g.stroke(); }
    g.fillRect(118, 0, 14, C);
  });
}

// Verrière du Louvre (losanges) et du Grand Palais (fermes + pannes).
function drawLozenge(g, w, h) {
  g.lineWidth = 7;
  for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w + w, h); g.stroke(); g.beginPath(); g.moveTo(i * w + w, 0); g.lineTo(i * w, h); g.stroke(); }
  g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
}
function drawGlassRoof(g, w, h) {
  g.fillRect(0, 0, 12, h); g.fillRect(w - 12, 0, 12, h); g.fillRect(0, 0, w, 8); g.fillRect(0, h - 8, w, 8);
  for (let i = 1; i < 4; i++) g.fillRect(i * w / 4 - 3, 0, 6, h);
  g.fillRect(0, h / 2 - 2, w, 4);
}

// ---------- matériau partagé ----------
function makeMainMaterial(tex, uNight) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMat;\nvarying vec4 vMat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vMat;\nuniform float uNight;')
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n diffuseColor.rgb *= mix(vec3(1.0), texture2D(map, vMapUv).rgb, vMat.z);\n#endif')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vMat.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMat.y;')
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * vMat.z;'))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += uNight * (vMat.w > 1.5 ? vec3(1.0, 0.66, 0.3) * 0.85 : diffuseColor.rgb * vec3(1.0, 0.84, 0.58) * vMat.w * 0.5);');
  };
  mat.customProgramCacheKey = () => 'mz-monument-v1';
  return mat;
}

export function createKit(ctx) {
  const aniso = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  const uNight = { value: 0 };
  const stone = makeStone(aniso);
  const main = makeMainMaterial(stone, uNight);
  // Tour Eiffel
  const latticeMap = maskTexture(1024, 256, drawLattice, 0x7b6348, aniso);
  const lattice = new THREE.MeshStandardMaterial({ map: latticeMap, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.62, metalness: 0.35, emissive: 0xffa838, emissiveIntensity: 0 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x7b6348, roughness: 0.6, metalness: 0.35, emissive: 0xffa838, emissiveIntensity: 0 });
  // verrières
  const glassOf = (draw, color, tint, aMin) => {
    const map = maskTexture(256, 256, draw, color, aniso, { alphaMin: aMin, fill: tint, wrapS: THREE.RepeatWrapping });
    return new THREE.MeshStandardMaterial({ map, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.08, metalness: 0.25, emissive: 0xffc070, emissiveIntensity: 0, envMapIntensity: 1.6 });
  };
  const glassLouvre = glassOf(drawLozenge, 0x4e565c, [0.6, 0.72, 0.78], 0.36);
  const glassPalais = glassOf(drawGlassRoof, 0x5f7469, [0.7, 0.8, 0.82], 0.62);
  // eau animée (jets, nappes, cascades) : non éclairée, stries défilant le long de v
  const uTime = { value: 0 };
  const water = new THREE.ShaderMaterial({
    uniforms: { uTime, uNight }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime, uNight;
      float h(float n) { return fract(sin(n) * 43758.5453); }
      void main() { float c = floor(vUv.x * 28.0), r = h(c + 1.7); float s = fract(vUv.y * 0.3 - uTime * (1.1 + r) + r * 7.0);
        float streak = smoothstep(0.0, 0.3, s) * smoothstep(1.0, 0.45, s), fine = 0.65 + 0.35 * sin(vUv.x * 170.0 + r * 6.0);
        vec3 col = mix(vec3(0.62, 0.76, 0.84), vec3(0.97), streak) * (1.0 - 0.6 * uNight) + uNight * vec3(0.5, 0.4, 0.25);
        gl_FragColor = vec4(col, (0.3 + 0.6 * streak) * fine);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return { THREE, P, uNight, uTime, main, lattice, iron, water, glassLouvre, glassPalais, quality: ctx.quality || 'high' };
}

// ---------- géométries de base ----------
function flatGeom(tris) {
  // tris : tableau plat de sommets [x,y,z, ...] (3 par triangle), normales plates
  const pos = new Float32Array(tris), nor = new Float32Array(pos.length), uv = new Float32Array(pos.length / 3 * 2);
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
    const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 9; k += 3) { nor[i + k] = nx; nor[i + k + 1] = ny; nor[i + k + 2] = nz; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const quadT = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();

export class Builder {
  constructor({ far = false, seg = 1, seed = 1 } = {}) {
    this.far = far; this.hi = !far; this.seg = seg;
    this.chunks = []; this.M = new THREE.Matrix4(); this.stack = [];
    this.cols = new Map(); this.rnd = rng(seed);
  }
  n(s) { return Math.max(6, Math.round(s * (this.far ? 0.45 : this.seg))); }
  group(x, y, z, ry, fn) {
    this.stack.push(this.M.clone());
    this.M.multiply(_m.makeRotationY(ry).setPosition(x, y, z));
    fn(this); this.M.copy(this.stack.pop());
    return this;
  }
  // Ajoute une géométrie « taille réelle » : UV calculés avant rotation, puis placement (x,y,z,ry) dans le groupe courant.
  add(geom, mat, x = 0, y = 0, z = 0, ry = 0, o = {}) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv ? g.attributes.uv.array : null;
    const nv = p.length / 3;
    const Pp = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), Uu = new Float32Array(nv * 2), Cc = new Float32Array(nv * 3), Aa = new Float32Array(nv * 4);
    const s = 1 / TEX;
    if (o.uv === 'cyl' && uv) {
      const rep = Math.max(1, Math.round(2 * Math.PI * (o.r || 1) / TEX));
      for (let i = 0; i < nv; i++) { Uu[i * 2] = uv[i * 2] * rep; Uu[i * 2 + 1] = (p[i * 3 + 1] + y) * s; }
    } else {
      for (let i = 0; i < nv; i += 3) {
        const a = i * 3;
        const ax = p[a + 3] - p[a], ay = p[a + 4] - p[a + 1], az = p[a + 5] - p[a + 2], bx = p[a + 6] - p[a], by = p[a + 7] - p[a + 1], bz = p[a + 8] - p[a + 2];
        const nx = Math.abs(ay * bz - az * by), ny = Math.abs(az * bx - ax * bz), nz = Math.abs(ax * by - ay * bx);
        for (let k = 0; k < 3; k++) {
          const q = (i + k) * 3, px = p[q] + x, py = p[q + 1] + y, pz = p[q + 2] + z;
          if (ny >= nx && ny >= nz) { Uu[(i + k) * 2] = px * s; Uu[(i + k) * 2 + 1] = pz * s; }
          else if (nx >= nz) { Uu[(i + k) * 2] = pz * s; Uu[(i + k) * 2 + 1] = py * s; }
          else { Uu[(i + k) * 2] = px * s; Uu[(i + k) * 2 + 1] = py * s; }
        }
      }
    }
    _m2.makeRotationY(ry).setPosition(x, y, z); _m.multiplyMatrices(this.M, _m2);
    const e = _m.elements, jit = 1 + (this.rnd() - 0.5) * (o.jit ?? 0.05);
    const cr = mat.c[0] * jit, cg = mat.c[1] * jit, cb = mat.c[2] * jit;
    for (let i = 0; i < nv; i++) {
      const q = i * 3, px = p[q], py = p[q + 1], pz = p[q + 2], nx = n[q], ny = n[q + 1], nz = n[q + 2];
      Pp[q] = e[0] * px + e[4] * py + e[8] * pz + e[12]; Pp[q + 1] = e[1] * px + e[5] * py + e[9] * pz + e[13]; Pp[q + 2] = e[2] * px + e[6] * py + e[10] * pz + e[14];
      Nn[q] = e[0] * nx + e[4] * ny + e[8] * nz; Nn[q + 1] = e[1] * nx + e[5] * ny + e[9] * nz; Nn[q + 2] = e[2] * nx + e[6] * ny + e[10] * nz;
      Cc[q] = cr; Cc[q + 1] = cg; Cc[q + 2] = cb;
      const a = i * 4; Aa[a] = mat.r; Aa[a + 1] = mat.m; Aa[a + 2] = mat.t; Aa[a + 3] = mat.g;
    }
    this.chunks.push({ P: Pp, N: Nn, U: Uu, C: Cc, A: Aa });
    return this;
  }
  // --- primitives (y = base de l'objet) ---
  box(mat, w, h, d, x = 0, y = 0, z = 0, ry = 0, o) { return this.add(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), mat, x, y, z, ry, o); }
  cyl(mat, rt, rb, h, x = 0, y = 0, z = 0, seg = 24, o = {}) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, this.n(seg), 1, !!o.open, o.t0 ?? 0, o.tl ?? Math.PI * 2).translate(0, h / 2, 0), mat, x, y, z, o.ry || 0, { uv: 'cyl', r: Math.max(rt, rb), ...o });
  }
  dome(mat, r, h, x = 0, y = 0, z = 0, seg = 32, o = {}) {
    const g = new THREE.SphereGeometry(r, this.n(seg), this.n(seg / 2), o.p0 ?? 0, o.pl ?? Math.PI * 2, 0, o.tl ?? Math.PI / 2); g.scale(1, h / r, 1);
    g.computeVertexNormals();
    return this.add(g, mat, x, y, z, o.ry || 0, { uv: 'cyl', r, ...o });
  }
  sphere(mat, r, x, y, z, seg = 12, sx = 1, sy = 1, sz = 1) {
    const g = new THREE.SphereGeometry(r, this.n(seg), this.n(seg * 0.7)); g.scale(sx, sy, sz);
    return this.add(g, mat, x, y, z, 0, { uv: 'cyl', r });
  }
  lathe(mat, pts, x = 0, y = 0, z = 0, seg = 32, o = {}) {
    let rm = 0; const v = pts.map(([r, h]) => { rm = Math.max(rm, r); return new THREE.Vector2(r, h); });
    return this.add(new THREE.LatheGeometry(v, this.n(seg)), mat, x, y, z, 0, { uv: 'cyl', r: rm, ...o });
  }
  torus(mat, R, r, x, y, z, seg = 24) { return this.add(new THREE.TorusGeometry(R, r, 6, this.n(seg)).rotateX(Math.PI / 2), mat, x, y, z); }
  // prisme triangulaire (fronton / toit à deux pans) : triangle (w × h) dans XY, profondeur d selon Z, centré.
  gable(wall, roof, w, h, d, x = 0, y = 0, z = 0, ry = 0) {
    const a = w / 2, b = d / 2, t1 = [], t2 = [];
    t1.push(-a, 0, b, a, 0, b, 0, h, b, a, 0, -b, -a, 0, -b, 0, h, -b);
    quadT(t2, [a, 0, b], [a, 0, -b], [0, h, -b], [0, h, b]); quadT(t2, [-a, 0, -b], [-a, 0, b], [0, h, b], [0, h, -b]);
    if (wall) this.add(flatGeom(t1), wall, x, y, z, ry);
    if (roof) this.add(flatGeom(t2), roof, x, y, z, ry);
    return this;
  }
  // tronc de pyramide rectangulaire (toit en pavillon, mansarde, pyramide si w1 = d1 = 0)
  frustum(mat, w0, d0, w1, d1, h, x = 0, y = 0, z = 0, ry = 0, o) {
    const a = w0 / 2, b = d0 / 2, c = w1 / 2, e = d1 / 2, t = [];
    quadT(t, [-a, 0, b], [a, 0, b], [c, h, e], [-c, h, e]); quadT(t, [a, 0, -b], [-a, 0, -b], [-c, h, -e], [c, h, -e]);
    quadT(t, [a, 0, b], [a, 0, -b], [c, h, -e], [c, h, e]); quadT(t, [-a, 0, -b], [-a, 0, b], [-c, h, e], [-c, h, -e]);
    if (c > 0 && e > 0) quadT(t, [-c, h, e], [c, h, e], [c, h, -e], [-c, h, -e]);
    return this.add(flatGeom(t), mat, x, y, z, ry, o);
  }
  // triangles libres (9 nombres par triangle) ; o.up : retourne ceux dont la normale pointe vers le bas (toitures)
  tris(mat, t, x = 0, y = 0, z = 0, ry = 0, o) {
    if (o?.up) for (let i = 0; i < t.length; i += 9) {
      const ny = (t[i + 5] - t[i + 2]) * (t[i + 6] - t[i]) - (t[i + 3] - t[i]) * (t[i + 8] - t[i + 2]);
      if (ny < 0) for (let k = 0; k < 3; k++) { const v = t[i + 3 + k]; t[i + 3 + k] = t[i + 6 + k]; t[i + 6 + k] = v; }
    }
    return this.add(flatGeom(t), mat, x, y, z, ry, o);
  }
  // extrusion d'une THREE.Shape (plan XY) le long de +Z, de z à z + depth
  extrude(mat, shape, depth, x = 0, y = 0, z = 0, ry = 0, curve = 12) {
    return this.add(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: this.n(curve) }), mat, x, y, z, ry);
  }
  // fenêtre plaquée sur un mur faisant face à +Z (dans le groupe courant) ; y = appui.
  win(x, y, z, w, h, o = {}) {
    if (this.far && w * h < (o.farMin ?? 9)) return this;
    const lit = this.rnd() < (o.lit ?? 0.3), pane = o.mat || (lit ? P.glassLit : P.glass), ry = o.ry || 0;
    const c = Math.cos(ry), s = Math.sin(ry), off = (d) => [x + s * d, z + c * d];
    if (this.hi && o.frame !== false) { const [fx, fz] = off(0.02); this.box(o.frameMat || P.stoneL, w + 0.5, h + 0.45, 0.16, fx, y - 0.2, fz, ry, { jit: 0 }); }
    const [px, pz] = off(0.06);
    this.box(pane, w, h, 0.14, px, y, pz, ry, { jit: 0 });
    if (o.arch) {
      const [ax, az] = off(0.132);
      if (this.hi && o.frame !== false) { const [fx, fz] = off(0.1); this.add(new THREE.CircleGeometry(w / 2 + 0.25, 10, 0, Math.PI), o.frameMat || P.stoneL, fx, y + h, fz, ry, { jit: 0 }); }
      this.add(new THREE.CircleGeometry(w / 2, 10, 0, Math.PI), pane, ax, y + h, az, ry, { jit: 0 });
    }
    return this;
  }
  // rangée de fenêtres sur un mur face à +Z, de x0 à x1
  winRow(x0, x1, y, z, n, w, h, o) { for (let i = 0; i < n; i++) this.win(x0 + (x1 - x0) * (i + 0.5) / n, y, z, w, h, o); return this; }
  // silhouette de statue drapée (pieds à y, hauteur s)
  statue(mat, x, y, z, s = 2, ry = 0) {
    if (this.far) return this.box(mat, s * 0.3, s, s * 0.25, x, y, z, ry);
    const o = { jit: 0.04 };
    this.add(new THREE.CylinderGeometry(s * 0.1, s * 0.15, s * 0.5, 7).translate(0, s * 0.25, 0), mat, x, y, z, ry, o);
    this.add(new THREE.CylinderGeometry(s * 0.14, s * 0.095, s * 0.33, 7).scale(1, 1, 0.7).translate(0, s * 0.655, 0), mat, x, y, z, ry, o);
    this.add(new THREE.SphereGeometry(s * 0.07, 7, 5).scale(1, 1.2, 1).translate(0, s * 0.92, 0), mat, x, y, z, ry, o);
    this.add(new THREE.BoxGeometry(s * 0.06, s * 0.36, s * 0.07).rotateZ(0.16).translate(s * 0.17, s * 0.62, 0), mat, x, y, z, ry, o);
    this.add(new THREE.BoxGeometry(s * 0.06, s * 0.36, s * 0.07).rotateZ(-0.5).translate(-s * 0.21, s * 0.68, s * 0.03), mat, x, y, z, ry, o);
    return this;
  }
  // groupe sculpté (statuaire, haut-relief) : figures serrées dans une boîte w × h × d centrée en x,z, base y
  lump(mat, x, y, z, w, h, d, n = 8, seed = 1) {
    if (this.far) return this.box(mat, w * 0.8, h * 0.8, d * 0.8, x, y, z);
    const r = rng(seed * 7919 + 13);
    for (let i = 0; i < n; i++) {
      const fh = h * (0.5 + 0.5 * r()), fx = x + ((i + 0.5) / n - 0.5) * w * 0.9 + (r() - 0.5) * w / n, fz = z + (r() - 0.5) * d * 0.5, fy = y + r() * (h - fh) * 0.6;
      const k = Math.min(fh, w / Math.max(2, n) * 3.2);
      this.add(new THREE.CylinderGeometry(k * 0.09, k * 0.17, fh * 0.74, 6).translate(0, fh * 0.37, 0), mat, fx, fy, fz, 0, { jit: 0.1 });
      this.add(new THREE.SphereGeometry(k * 0.16, 6, 4).scale(1.3, 0.9, 0.8), mat, fx, fy + fh * 0.7, fz, 0, { jit: 0.1 });
      this.add(new THREE.SphereGeometry(k * 0.095, 6, 4), mat, fx, fy + fh * 0.88, fz, 0, { jit: 0.1 });
      if (r() < 0.6) this.add(new THREE.BoxGeometry(k * 0.07, fh * 0.4, k * 0.07).rotateZ((r() - 0.5) * 2.2), mat, fx + (r() - 0.5) * k * 0.4, fy + fh * 0.75, fz, 0, { jit: 0.1 });
    }
    this.box(mat, w * 0.85, h * 0.12, Math.min(d, w) * 0.7, x, y, z, 0, { jit: 0.05 });
    return this;
  }
  // colonne : instanciée en haute définition, cylindre fusionné en version lointaine.
  column(x, y, z, r, h, style = 'cor', mat = P.stone) {
    if (this.far) { this.add(new THREE.CylinderGeometry(r * 0.88, r, h, 6).translate(0, h / 2, 0), mat, x, y, z, 0, { uv: 'cyl', r }); return this; }
    const key = `${style}|${r}|${h}`;
    let c = this.cols.get(key); if (!c) this.cols.set(key, (c = { style, r, h, mat, list: [] }));
    c.list.push(this.M.clone().multiply(_m.makeTranslation(x, y, z)));
    return this;
  }
  colonnade(x0, z0, x1, z1, n, y, r, h, style, mat) {
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); this.column(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, r, h, style, mat); }
    return this;
  }
  appendChunk(c, m) {
    const e = m.elements, nv = c.P.length / 3, Pp = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      const q = i * 3, px = c.P[q], py = c.P[q + 1], pz = c.P[q + 2], nx = c.N[q], ny = c.N[q + 1], nz = c.N[q + 2];
      Pp[q] = e[0] * px + e[4] * py + e[8] * pz + e[12]; Pp[q + 1] = e[1] * px + e[5] * py + e[9] * pz + e[13]; Pp[q + 2] = e[2] * px + e[6] * py + e[10] * pz + e[14];
      Nn[q] = e[0] * nx + e[4] * ny + e[8] * nz; Nn[q + 1] = e[1] * nx + e[5] * ny + e[9] * nz; Nn[q + 2] = e[2] * nx + e[6] * ny + e[10] * nz;
    }
    this.chunks.push({ P: Pp, N: Nn, U: c.U, C: c.C, A: c.A });
  }
  // Fusionne tout ; bake = dégradé de l'éclairage par projecteurs (plus fort en bas, faible sur les faces tournées vers le ciel).
  geometry(bake = true) {
    let nv = 0; for (const c of this.chunks) nv += c.P.length / 3;
    const Pp = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), Uu = new Float32Array(nv * 2), Cc = new Float32Array(nv * 3), Aa = new Float32Array(nv * 4);
    let o = 0, H = 1;
    for (const c of this.chunks) { Pp.set(c.P, o * 3); Nn.set(c.N, o * 3); Uu.set(c.U, o * 2); Cc.set(c.C, o * 3); Aa.set(c.A, o * 4); o += c.P.length / 3; }
    if (bake) {
      for (let i = 0; i < nv; i++) H = Math.max(H, Pp[i * 3 + 1]);
      for (let i = 0; i < nv; i++) {
        const g = Aa[i * 4 + 3]; if (g > 1.5) continue;
        const y = Math.max(0, Pp[i * 3 + 1]) / H, ny = Nn[i * 3 + 1];
        Aa[i * 4 + 3] = g * (1.0 - 0.5 * y) * (ny > 0.75 ? 0.3 : 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(Uu, 2)); g.setAttribute('color', new THREE.BufferAttribute(Cc, 3)); g.setAttribute('aMat', new THREE.BufferAttribute(Aa, 4));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  // Construit les meshes : [mesh fusionné, ...InstancedMesh de colonnes]
  meshes(material, name) {
    const out = [];
    for (const c of this.cols.values()) {
      const cb = new Builder({ seg: this.seg }); columnParts(cb, c.r, c.h, c.style, c.mat);
      if (c.list.length < 12) { const chunk = cb.raw(); for (const m of c.list) this.appendChunk(chunk, m); continue; }
      const im = new THREE.InstancedMesh(cb.geometry(false), material, c.list.length);
      c.list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.computeBoundingBox();
      im.name = `${name}:colonnes`; out.push(im);
    }
    const mesh = new THREE.Mesh(this.geometry(), material); mesh.name = `${name}:corps`;
    out.unshift(mesh);
    return out;
  }
  raw() {
    const g = this.geometry(false);
    return { P: g.attributes.position.array, N: g.attributes.normal.array, U: g.attributes.uv.array, C: g.attributes.color.array, A: g.attributes.aMat.array };
  }
}

// Colonne détaillée : base attique, fût cannelé galbé, chapiteau (cor = corinthien, ion = ionique, dor = dorique).
function columnParts(b, r, h, style, mat) {
  const m = { ...mat, g: mat.g * 0.8 };
  const flutes = style === 'dor' ? 16 : 20, ns = Math.round(flutes * (b.seg < 0.8 || r < 0.7 ? 2 : 4));
  const baseH = style === 'dor' ? 0 : r * 1.0, capH = style === 'cor' ? r * 2.3 : style === 'ion' ? r * 1.0 : r * 0.9;
  if (baseH) {
    b.box(m, r * 2.7, r * 0.34, r * 2.7, 0, 0, 0, 0, { jit: 0 });
    b.lathe(m, [[r * 1.3, r * 0.34], [r * 1.36, r * 0.5], [r * 1.3, r * 0.64], [r * 1.12, r * 0.72], [r * 1.2, r * 0.86], [r * 1.04, r * 1.0]], 0, 0, 0, 20, { jit: 0 });
  }
  // fût
  const y0 = baseH, y1 = h - capH, rings = 6, pos = [], idx = [], uv = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings, rr = r * (1 - 0.14 * t * t);
    for (let i = 0; i <= ns; i++) {
      const a = i / ns * Math.PI * 2, f = 1 - 0.05 * (0.5 + 0.5 * Math.cos(a * flutes));
      pos.push(Math.sin(a) * rr * f, y0 + (y1 - y0) * t, Math.cos(a) * rr * f); uv.push(i / ns, t);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < ns; i++) { const a = j * (ns + 1) + i, c = a + ns + 1; idx.push(a, a + 1, c, a + 1, c + 1, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  b.add(g, m, 0, 0, 0, 0, { uv: 'cyl', r, jit: 0 });
  const rt = r * 0.86;
  if (style === 'cor') {
    b.lathe(m, [[rt, 0], [rt * 1.12, capH * 0.05], [rt * 1.05, capH * 0.12], [rt * 1.12, capH * 0.45], [rt * 1.3, capH * 0.5], [rt * 1.16, capH * 0.56], [rt * 1.35, capH * 0.8], [rt * 1.62, capH * 0.86]], 0, y1, 0, 16, { jit: 0 });
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; b.add(new THREE.SphereGeometry(r * 0.3, 6, 4), m, Math.sin(a) * rt * 1.55, y1 + capH * 0.76, Math.cos(a) * rt * 1.55, 0, { jit: 0 }); }
    b.box(m, r * 2.75, capH * 0.14, r * 2.75, 0, y1 + capH * 0.86, 0, 0, { jit: 0 });
  } else if (style === 'ion') {
    b.lathe(m, [[rt, 0], [rt * 1.1, capH * 0.2], [rt * 1.25, capH * 0.6]], 0, y1, 0, 16, { jit: 0 });
    for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(r * 0.42, r * 0.42, r * 2.3, 10).rotateX(Math.PI / 2), m, sx * r * 1.12, y1 + capH * 0.5, 0, 0, { jit: 0 });
    b.box(m, r * 2.7, capH * 0.25, r * 2.5, 0, y1 + capH * 0.75, 0, 0, { jit: 0 });
  } else {
    b.lathe(m, [[rt, 0], [rt * 1.08, capH * 0.15], [rt * 1.4, capH * 0.6]], 0, y1, 0, 16, { jit: 0 });
    b.box(m, r * 2.7, capH * 0.4, r * 2.7, 0, y1 + capH * 0.6, 0, 0, { jit: 0 });
  }
}

// ---------- éléments d'architecture réutilisables ----------
// Contour rectangulaire percé d'arcades en plein cintre posées au sol : arches = [{x, w, h}] (h = hauteur totale sous clé).
export function arcadeShape(x0, x1, H, arches) {
  const s = new THREE.Shape(); s.moveTo(x0, 0);
  for (const a of [...arches].sort((p, q) => p.x - q.x)) {
    const r = a.w / 2;
    s.lineTo(a.x - r, 0); s.lineTo(a.x - r, a.h - r); s.absarc(a.x, a.h - r, r, Math.PI, 0, true); s.lineTo(a.x + r, 0);
  }
  s.lineTo(x1, 0); s.lineTo(x1, H); s.lineTo(x0, H); s.closePath();
  return s;
}
// Arc brisé (ogive) : contour fermé posé sur y = 0, largeur w, hauteur totale h.
export function ogiveShape(w, h, x = 0, y = 0) {
  const s = new THREE.Shape(), r = w / 2, hs = Math.max(0.01, h - w * 0.8);
  s.moveTo(x - r, y); s.lineTo(x + r, y); s.lineTo(x + r, y + hs);
  s.quadraticCurveTo(x + r, y + hs + (h - hs) * 0.62, x, y + h); s.quadraticCurveTo(x - r, y + hs + (h - hs) * 0.62, x - r, y + hs);
  s.closePath();
  return s;
}

// Aile de palais le long de X (centrée), façades avant (+Z) et arrière (-Z) rythmées de fenêtres.
// o = { len, dep, floors: [{h, w, wh, arch, sill}], bay, roof: 'mansard'|'hip'|'flat', roofH, roofMat, wall, back, pil }
export function palaceWing(b, o) {
  const wall = o.wall || P.stone, len = o.len, dep = o.dep, bay = o.bay || 5, nb = Math.max(1, Math.floor((len - 2) / bay));
  let H = 0; for (const f of o.floors) H += f.h;
  b.box(wall, len, H + 3, dep, 0, -3, 0);
  if (b.hi) b.box(P.stoneD, len + 0.5, 1.1, dep + 0.5, 0, 0, 0);
  let y = 0;
  for (const f of o.floors) {
    const sill = f.sill ?? f.h * 0.22, wh = f.wh ?? f.h * 0.6, w = f.w ?? bay * 0.42;
    for (const side of [1, -1]) {
      if (side < 0 && o.back === false) continue;
      b.group(0, 0, side * dep / 2, side > 0 ? 0 : Math.PI, () => {
        if (b.hi) b.winRow(-nb * bay / 2, nb * bay / 2, y + sill, 0, nb, w, wh, { arch: f.arch, lit: f.lit ?? 0.3 });
        else if (y === 0 && nb > 2) b.box(P.glass, nb * bay * 0.96, H * 0.72, 0.1, 0, H * 0.12, 0.02, 0, { jit: 0 });   // version lointaine : une seule bande sombre suggère les baies
        if (b.hi && o.pil) for (let i = 0; i <= nb; i++) b.box(P.stoneL, 0.7, f.h - 0.5, 0.35, -nb * bay / 2 + i * bay, y + 0.2, 0.1, 0, { jit: 0.02 });
      });
    }
    y += f.h;
    if (b.hi) b.box(P.stoneL, len + 0.6, 0.45, dep + 0.6, 0, y - 0.45, 0, 0, { jit: 0.02 });
  }
  b.box(P.stoneL, len + 1.3, 0.8, dep + 1.3, 0, H, 0, 0, { jit: 0.02 });
  const rh = o.roofH ?? 5, rm = o.roofMat || P.zinc;
  if (o.roof === 'mansard') {
    b.frustum(rm, len + 0.4, dep + 0.4, len - 3.2, dep - 3.2, rh * 0.75, 0, H + 0.8, 0);
    b.frustum(rm, len - 3.2, dep - 3.2, len - 3.2 - dep * 0.5, dep * 0.3, rh * 0.25, 0, H + 0.8 + rh * 0.75, 0);
    if (b.hi && o.dormers !== false) for (const side of [1, -1]) for (let i = 0; i < nb; i += 2) {
      const x = -nb * bay / 2 + (i + 0.5) * bay, z = side * (dep / 2 - 0.9);
      b.box(P.stoneL, 1.9, 2.3, 1.6, x, H + 0.9, z, 0, { jit: 0.02 }); b.gable(P.stoneL, rm, 2.3, 0.9, 1.8, x, H + 3.2, z);
      b.group(x, 0, z + side * 0.8, side > 0 ? 0 : Math.PI, () => b.win(0, H + 1.3, 0, 1.1, 1.5, { frame: false }));
    }
    if (b.hi && o.chimneys !== false) for (let i = 1; i < nb; i += 4) b.box(P.stoneD, 1.2, rh + 1.5, 2.6, -nb * bay / 2 + i * bay, H + 0.8, 0, 0);
  } else if (o.roof === 'hip') {
    b.frustum(rm, len + 0.4, dep + 0.4, Math.max(0.2, len - dep), 0.2, rh, 0, H + 0.8, 0);
  } else {
    b.box(wall, len - 0.6, 1.1, dep - 0.6, 0, H + 0.8, 0);
  }
  return H;
}

// Courbe d'interpolation cubique (Hermite) passant par une table [[x, y], ...] croissante en x.
export function curve(tbl) {
  const n = tbl.length, m = [];
  for (let i = 0; i < n; i++) {
    const a = tbl[Math.max(0, i - 1)], c = tbl[Math.min(n - 1, i + 1)];
    m.push((c[1] - a[1]) / (c[0] - a[0]));
  }
  return (x) => {
    if (x <= tbl[0][0]) return tbl[0][1];
    if (x >= tbl[n - 1][0]) return tbl[n - 1][1];
    let i = 0; while (x > tbl[i + 1][0]) i++;
    const h = tbl[i + 1][0] - tbl[i][0], t = (x - tbl[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * tbl[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * tbl[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

// Escalier droit descendant vers +Z : n marches (rise × run), palier haut à y0 + n·rise, nez de la 1re marche en z0.
export function stairs(b, mat, w, n, rise, run, x, y0, z0, ry = 0) {
  b.group(x, y0, z0, ry, () => {
    if (b.far) { b.tris(mat, wedge(w, n * rise, n * run)); return; }
    for (let i = 0; i < n; i++) b.box(mat, w, rise * (n - i), run, 0, 0, run * (i + 0.5), 0, { jit: 0.03 });
  });
}
function wedge(w, h, d) {
  const a = w / 2, t = [];
  quadT(t, [-a, h, 0], [-a, 0, d], [a, 0, d], [a, h, 0]);
  t.push(-a, 0, 0, -a, 0, d, -a, h, 0, a, 0, 0, a, h, 0, a, 0, d);
  return t;
}
// Dalle polygonale horizontale : pts = [[x, z], ...], de y à y + h.
export function slab(b, mat, pts, y, h, o) {
  const s = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z))); s.closePath();
  return b.add(new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2), mat, 0, y, 0, 0, o);
}
// Dôme ovoïde (profil surhaussé) par révolution.
export function ovoid(b, mat, r, h, x, y, z, seg = 28, pw = 2.3, o) {
  const pts = []; const n = b.far ? 6 : 12;
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([Math.max(0.01, r * Math.pow(1 - Math.pow(t, pw), 0.62)), h * t]); }
  return b.lathe(mat, pts, x, y, z, seg, o);
}
// Rosace : disque de vitrail + remplage de pierre, plaquée sur un mur face à +Z.
export function rose(b, x, y, z, r, mat = P.stoneL, spokes = 12) {
  b.add(new THREE.CircleGeometry(r + 0.6, b.n(24)), P.shadow, x, y, z + 0.05, 0, { jit: 0 });
  b.add(new THREE.CircleGeometry(r, b.n(24)), P.vitrail, x, y, z + 0.1, 0, { jit: 0 });
  b.add(new THREE.RingGeometry(r, r + 0.7, b.n(24)), mat, x, y, z + 0.2, 0, { jit: 0 });
  if (b.far) return;
  b.add(new THREE.RingGeometry(r * 0.48, r * 0.56, 20), mat, x, y, z + 0.2, 0, { jit: 0 });
  b.add(new THREE.CircleGeometry(r * 0.14, 10), mat, x, y, z + 0.2, 0, { jit: 0 });
  for (let i = 0; i < spokes; i++) b.add(new THREE.PlaneGeometry(0.22, r).translate(0, r / 2, 0).rotateZ(i * Math.PI * 2 / spokes), mat, x, y, z + 0.18, 0, { jit: 0 });
  for (let i = 0; i < spokes; i++) { const a = (i + 0.5) * Math.PI * 2 / spokes; b.add(new THREE.RingGeometry(r * 0.13, r * 0.19, 8), mat, x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78, z + 0.18, 0, { jit: 0 }); }
}

// fuseau de dôme entre deux méridiens (a0, largeur da) et deux hauteurs relatives (t0..t1 de la base au sommet)
export function domeLune(r, h, a0, da, t0, t1, n) {
  const pos = [], idx = [], uv = [], m = 3;
  for (let j = 0; j <= n; j++) {
    const t = t0 + (t1 - t0) * j / n, th = (1 - t) * Math.PI / 2, rr = r * Math.sin(th), y = h * Math.cos(th), shrink = 1 - 0.25 * (j / n);
    for (let i = 0; i <= m; i++) { const a = a0 + da / 2 + (i / m - 0.5) * da * shrink; pos.push(Math.sin(a) * rr, y, Math.cos(a) * rr); uv.push(i / m, t); }
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < m; i++) { const a = j * (m + 1) + i, c = a + m + 1; idx.push(a, a + 1, c, a + 1, c + 1, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Géométrie d'eau animée : tubes (jets, arcs) et nappes coniques ; u = tour, v = distance parcourue (m).
export class Water {
  constructor() { this.p = []; this.u = []; this.i = []; }
  tube(pts, r0, r1 = r0, seg = 5) {
    const base = this.p.length / 3; let v = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], p = pts[k];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let sx = -tz, sz = tx, sl = Math.hypot(sx, sz); if (sl < 0.01) { sx = 1; sz = 0; sl = 1; } sx /= sl; sz /= sl;
      const ux = ty * sz, uy = tz * sx - tx * sz, uz = -ty * sx, r = r0 + (r1 - r0) * k / (pts.length - 1);
      if (k) v += Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1], p[2] - pts[k - 1][2]);
      for (let j = 0; j <= seg; j++) { const an = j / seg * Math.PI * 2, c = Math.cos(an) * r, s = Math.sin(an) * r; this.p.push(p[0] + sx * c + ux * s, p[1] + uy * s, p[2] + sz * c + uz * s); this.u.push(j / seg * 0.2 + (base % 97) * 0.13, v); }
    }
    for (let k = 0; k < pts.length - 1; k++) for (let j = 0; j < seg; j++) { const a = base + k * (seg + 1) + j, c = a + seg + 1; this.i.push(a, a + 1, c, a + 1, c + 1, c); }
    return this;
  }
  // jet parabolique de p0 à p1 culminant à `rise` au-dessus du point le plus haut
  arc(p0, p1, rise, r = 0.12, n = 9) {
    const pts = []; for (let k = 0; k <= n; k++) { const t = k / n; pts.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t + 4 * rise * t * (1 - t), p0[2] + (p1[2] - p0[2]) * t]); }
    return this.tube(pts, r, r * 2.2);
  }
  jet(x, y, z, h, r = 0.1) { return this.tube([[x, y, z], [x, y + h * 0.5, z], [x, y + h, z]], r, r * 2.5); }
  // nappe tombant d'un cercle (rTop à y + h) vers un cercle (rBot à y)
  fall(x, y, z, rTop, rBot, h, seg = 24) {
    const base = this.p.length / 3;
    for (let k = 0; k < 2; k++) for (let j = 0; j <= seg; j++) { const an = j / seg * Math.PI * 2, r = k ? rBot : rTop; this.p.push(x + Math.sin(an) * r, y + (k ? 0 : h), z + Math.cos(an) * r); this.u.push(j / seg, k ? h * 2 : 0); }
    for (let j = 0; j < seg; j++) { const a = base + j, c = a + seg + 1; this.i.push(a, a + 1, c, a + 1, c + 1, c); }
    return this;
  }
  // rideau vertical (cascade) de largeur w entre (x0,z0) et (x1,z1)
  sheet(x0, z0, x1, z1, yTop, yBot, cells = 6) {
    const base = this.p.length / 3; this.p.push(x0, yTop, z0, x1, yTop, z1, x0, yBot, z0, x1, yBot, z1); this.u.push(0, 0, cells / 28, 0, 0, (yTop - yBot) * 2, cells / 28, (yTop - yBot) * 2);
    this.i.push(base, base + 1, base + 2, base + 1, base + 3, base + 2); return this;
  }
  mesh(kit, name) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setIndex(this.i);
    const me = new THREE.Mesh(g, kit.water); me.name = name; me.renderOrder = 3; return me;
  }
}

// Aile de palais placée dans le monument (x, z, ry) avec collisions ; o.gates = [{ x, w, h }] : porches traversants
// (x le long de l'aile) sous lesquels on passe à pied ou en voiture.
export function wing(m, x, z, ry, o) {
  const B = m.B, gates = (o.gates || []).slice().sort((a, b) => a.x - b.x), wall = o.wall || P.stone;
  let H = 0; for (const f of o.floors) H += f.h;
  const segs = []; let x0 = -o.len / 2;
  for (const g of gates) { segs.push([x0, g.x - g.w / 2]); x0 = g.x + g.w / 2; }
  segs.push([x0, o.len / 2]);
  const c = Math.cos(ry), s = Math.sin(ry);
  B.group(x, 0, z, ry, () => {
    for (const [a, b] of segs) if (b - a > 1.5) B.group((a + b) / 2, 0, 0, 0, () => palaceWing(B, { ...o, len: b - a, gates: null }));
    for (const g of gates) {
      const gh = g.h || 9, top = Math.max(H + 4, gh + 6);
      B.extrude(wall, arcadeShape(-g.w / 2, g.w / 2, gh + 0.01, [{ x: 0, w: g.w - 1.8, h: gh - 0.4 }]), o.dep, g.x, 0, -o.dep / 2);
      B.box(wall, g.w, top - gh, o.dep + 1.2, g.x, gh, 0); B.box(P.stoneL, g.w + 1.2, 0.9, o.dep + 2.4, g.x, top, 0);
      B.frustum(o.roofMat || P.zinc, g.w + 0.6, o.dep + 1.8, g.w * 0.45, o.dep * 0.4, 6.5, g.x, top + 0.9, 0);
      if (B.hi) for (const sd of [1, -1]) B.group(g.x, 0, sd * (o.dep / 2 + 0.6), sd > 0 ? 0 : Math.PI, () => { B.win(0, gh + 2, 0.02, Math.min(3, g.w * 0.4), Math.max(2, top - gh - 4.5), { arch: true, lit: 0.7 }); B.extrude(P.stoneL, archRing(g.w / 2 - 0.9, 0.7), 0.3, 0, gh - 0.4 - (g.w / 2 - 0.9), 0); });
    }
  });
  for (const [a, b] of segs) if (b - a > 1.5) { const cx = (a + b) / 2; m.collide.box(x + cx * c, z - cx * s, (b - a) / 2 + 0.3, o.dep / 2 + 0.3, ry); }
  for (const g of gates) m.collide.box(x + g.x * c, z - g.x * s, g.w / 2, o.dep / 2, ry, (g.h || 9) - 0.5);
  return H;
}
export function archRing(r, t) { const s = new THREE.Shape(); s.absarc(0, 0, r + t, 0, Math.PI, false); s.lineTo(-r, 0); s.absarc(0, 0, r, Math.PI, 0, true); s.closePath(); return s; }
// Bâtiment sur cour : quatre ailes autour d'un rectangle w × d (dimensions extérieures), centré en (cx, cz).
// o.gatesN/S/E/W : porches de chaque côté (N = -Z, S = +Z, E = +X, W = -X).
export function court(m, cx, cz, w, d, o) {
  const dp = o.dep;
  wing(m, cx, cz + d / 2 - dp / 2, 0, { ...o, len: w, gates: o.gatesS });
  wing(m, cx, cz - d / 2 + dp / 2, 0, { ...o, len: w, gates: o.gatesN });
  wing(m, cx + w / 2 - dp / 2, cz, Math.PI / 2, { ...o, len: d - 2 * dp + 0.4, gates: o.gatesE });
  wing(m, cx - w / 2 + dp / 2, cz, Math.PI / 2, { ...o, len: d - 2 * dp + 0.4, gates: o.gatesW });
}
// Pavillon à toit « à l'impériale » (Louvre, Hôtel de Ville…), façades avant/arrière ornées ; centré, face +Z.
export function pavilion(B, x, z, ry, o = {}) {
  const w = o.w || 27, d = o.d || 25, H = o.h || 28, rm = o.roofMat || P.slate, wall = o.wall || P.stone;
  B.group(x, 0, z, ry, () => {
    B.box(wall, w, H + 3, d, 0, -3, 0); B.box(P.stoneL, w + 1.4, 1, d + 1.4, 0, H, 0); B.box(P.stoneD, w + 0.5, 1.2, d + 0.5, 0, 0, 0);
    const rh = o.roofH || 9;
    B.frustum(rm, w, d, w * 0.55, d * 0.5, rh, 0, H + 1, 0); B.frustum(rm, w * 0.55, d * 0.5, w * 0.3, d * 0.2, rh * 0.28, 0, H + 1 + rh, 0);
    B.box(P.lead, w * 0.32, 0.8, d * 0.22, 0, H + 1 + rh * 1.28, 0);
    for (const s of [1, -1]) B.group(0, 0, s * d / 2, s > 0 ? 0 : Math.PI, () => {
      if (!o.gate) B.win(0, 1.2, 0, w * 0.16, 6, { arch: true, lit: 0.8, farMin: 0 });
      B.win(0, H * 0.41, 0, w * 0.13, H * 0.25, { arch: true, lit: 0.8, farMin: 0 });
      for (const sx of [-1, 1]) { B.win(sx * w * 0.32, 1.4, 0, 2.6, 5, { arch: true }); B.win(sx * w * 0.32, H * 0.41, 0, 2.2, 5); B.win(sx * w * 0.32, H * 0.72, 0, 1.9, 3); }
      B.win(0, H * 0.78, 0, 2.4, 3.4);
      if (B.hi) {
        for (const sx of [-1, 1]) for (const q of [0.135, 0.195]) { B.cyl(P.stoneL, 0.5, 0.55, H * 0.3, sx * w * q, 1.2, 0.9, 10); B.cyl(P.stoneL, 0.45, 0.5, H * 0.27, sx * w * q, H * 0.39, 0.9, 10); }
        B.box(P.stoneL, w * 0.46, 0.9, 2.2, 0, H * 0.35, 0.6); B.box(P.stoneL, w * 0.46, 0.9, 2.2, 0, H * 0.665, 0.6);
        B.gable(P.deco, rm, w * 0.48, 3.2, 1.6, 0, H + 0.1, 0.6); B.lump(P.deco, 0, H * 0.71, 0.9, w * 0.37, 5, 0.8, 8, Math.round(x + z));
      }
    });
  });
}

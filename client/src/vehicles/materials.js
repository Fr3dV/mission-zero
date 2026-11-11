// Matériaux partagés des véhicules : peinture (clearcoat + paillettes), "divers" (couleur/rugosité/métal par sommet),
// optiques (émissif par canal), atlas de textures procédural (plaques, lumineux TAXI).
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Atlas (canvas 512×512) : texel blanc, plaques d'immatriculation françaises, lumineux « TAXI ».
const ATLAS = 512;
const rectUV = (x, y, w, h) => [x / ATLAS, 1 - (y + h) / ATLAS, (x + w) / ATLAS, 1 - y / ATLAS]; // [u0,v0,u1,v1]
export const ATLAS_UV = {
  plates: [rectUV(8, 48, 376, 80), rectUV(8, 136, 376, 80), rectUV(8, 224, 376, 80)],
  taxi: rectUV(8, 320, 256, 96),
  taxiBack: rectUV(272, 320, 96, 96),
};
let _atlas = null;
function plateText(seed) {
  const L = 'ABCDEFGHJKLMNPQRSTVWXYZ';
  let s = seed * 9301 + 49297;
  const r = (n) => { s = (s * 233280 + 12345) % 2147483647; return Math.abs(s) % n; };
  return `${L[r(23)]}${L[r(23)]}-${r(10)}${r(10)}${r(10)}-${L[r(23)]}${L[r(23)]}`;
}
export function getAtlas() {
  if (_atlas) return _atlas;
  const c = document.createElement('canvas'); c.width = c.height = ATLAS;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, ATLAS, 44);
  // plaques : fond blanc réfléchissant, bandes bleues (F à gauche, département à droite)
  [48, 136, 224].forEach((y, i) => {
    const x = 8, w = 376, h = 80;
    g.fillStyle = '#f4f4f1'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#15151a'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    g.fillStyle = '#123a9c'; g.fillRect(x + 4, y + 4, 34, h - 8); g.fillRect(x + w - 38, y + 4, 34, h - 8);
    g.fillStyle = '#f5d20a'; for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.fillRect(x + 21 + Math.cos(a) * 9 - 1, y + 24 + Math.sin(a) * 9 - 1, 2.4, 2.4); }
    g.fillStyle = '#fff'; g.font = 'bold 22px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('F', x + 21, y + 58); g.font = 'bold 20px Arial, sans-serif'; g.fillText('75', x + w - 21, y + 56);
    g.fillStyle = '#101014'; g.font = 'bold 54px "Arial Narrow", Arial, sans-serif';
    g.fillText(plateText(i + 3), x + w / 2, y + h / 2 + 3, w - 96);
  });
  // lumineux TAXI
  g.fillStyle = '#f6f3e6'; g.fillRect(8, 320, 256, 96);
  g.fillStyle = '#111'; g.font = 'bold 74px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('TAXI', 136, 372, 230);
  g.fillStyle = '#f6f3e6'; g.fillRect(272, 320, 96, 96);
  _atlas = new THREE.CanvasTexture(c);
  _atlas.colorSpace = THREE.SRGBColorSpace; _atlas.anisotropy = 8;
  return _atlas;
}

// ---------------------------------------------------------------------------------------------
// Textures de normales procédurales : paillettes (peinture métallisée) et brossage (inox).
let _flakes = null, _brushed = null, _peel = null;
// peau d'orange du vernis : bruit lisse basse fréquence
function peelTexture() {
  const size = 64, c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const img = g.createImageData(size, size); const d = img.data;
  const hgt = new Float32Array(size * size);
  for (let k = 0; k < 5; k++) { const fx = 1 + ((k * 3) % 5), fy = 1 + ((k * 2 + 1) % 5), ph = k * 1.7; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) hgt[y * size + x] += Math.sin((x / size) * fx * 6.2832 + ph) * Math.cos((y / size) * fy * 6.2832 + ph * 1.3); }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, dx = hgt[y * size + ((x + 1) % size)] - hgt[i], dy = hgt[((y + 1) % size) * size + x] - hgt[i];
    d[i * 4] = 128 + dx * 90; d[i * 4 + 1] = 128 + dy * 90; d[i * 4 + 2] = 255; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function noiseNormalTexture(size, stretch) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const img = g.createImageData(size, size); const d = img.data;
  let s = 1234567;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  if (!stretch) {
    for (let i = 0; i < size * size; i++) {
      const a = rnd() * Math.PI * 2, m = rnd() * rnd();
      d[i * 4] = 128 + Math.cos(a) * m * 127; d[i * 4 + 1] = 128 + Math.sin(a) * m * 127; d[i * 4 + 2] = 255; d[i * 4 + 3] = 255;
    }
  } else {
    // stries horizontales : la normale ne varie que perpendiculairement au brossage
    for (let y = 0; y < size; y++) {
      const base = (rnd() - 0.5) * 2;
      for (let x = 0; x < size; x++) {
        const i = y * size + x, v = base * 0.7 + (rnd() - 0.5) * 0.25;
        d[i * 4] = 128; d[i * 4 + 1] = 128 + v * 110; d[i * 4 + 2] = 255; d[i * 4 + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------------------------
const registry = new Set(); // tous les matériaux sensibles à l'environnement (repli envMap)
const paints = new Map();

/** Peinture carrosserie (mise en cache par couleur + finition). finish : 'metal' | 'solid' | 'steel' | 'matte' */
export function getPaint(color, finish = 'metal') {
  const key = finish + ':' + new THREE.Color(color).getHexString();
  let m = paints.get(key);
  if (m) return m;
  const col = new THREE.Color(color);
  const hsl = col.getHSL({});
  if (finish === 'steel') {
    // inox brossé : métal pur, reflets étirés (anisotropie le long de la caisse) + micro-stries
    _brushed ||= noiseNormalTexture(256, true);
    m = new THREE.MeshPhysicalMaterial({ color: col, metalness: 1, roughness: 0.3, normalMap: _brushed, normalScale: new THREE.Vector2(0.06, 0.06), clearcoat: 0 });
  } else {
    _flakes ||= noiseNormalTexture(256, false);
    _peel ||= peelTexture();
    // couleurs vives/claires : moins de métal pour garder la saturation ; sombres : plus de profondeur
    const vivid = hsl.s > 0.55 && hsl.l > 0.3, light = hsl.l > 0.75;
    const metal = finish === 'solid' ? 0.0 : finish === 'pearl' ? 0.3 : light ? 0.25 : vivid ? 0.4 : 0.75;
    m = new THREE.MeshPhysicalMaterial({
      color: col, metalness: metal, roughness: finish === 'solid' ? 0.5 : finish === 'matte' ? 0.6 : 0.34,
      clearcoat: finish === 'matte' ? 0.15 : 1, clearcoatRoughness: finish === 'matte' ? 0.6 : 0.03,
      normalMap: _flakes, normalScale: new THREE.Vector2(finish === 'solid' ? 0.02 : finish === 'pearl' ? 0.1 : 0.075, finish === 'solid' ? 0.02 : 0.075),
      clearcoatNormalMap: _peel, clearcoatNormalScale: new THREE.Vector2(0.012, 0.012),
    });
  }
  // masque de dégâts par sommet (attribut `dmg`, absent = 0) : rayures, peinture arrachée, pièce tombée (dmg > 1,5)
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float dmg;\nvarying float vDmg;\nvarying vec3 vOP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDmg = dmg; vOP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDmg;\nvarying vec3 vOP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float mzM = 0.0;
        if (vDmg > 1.5) discard;
        if (vDmg > 0.02) {
          // écailles de peinture : taches organiques (bruit sinusoïdal déformé) + fines rayures horizontales
          float n1 = 0.5 + 0.5 * sin(vOP.x * 37.0 + sin(vOP.y * 29.0 + vOP.z * 23.0) * 2.0) * sin(vOP.z * 31.0 + sin(vOP.x * 17.0 + vOP.y * 41.0) * 2.0);
          float stri = step(0.8, fract(sin(dot(floor(vec2(vOP.y * 300.0, vOP.z * 9.0 + vOP.x * 9.0)), vec2(3.1, 7.7))) * 91.7));
          float lvl = smoothstep(0.1, 0.95, vDmg);
          float thr = 1.0 - lvl * 0.6;
          mzM = clamp(smoothstep(thr, thr + 0.06, n1) * step(0.5, vDmg) + stri * lvl * 0.7, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.13, 0.14), mzM);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, mzM);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= (1.0 - mzM);\n#endif');
  };
  m.customProgramCacheKey = () => 'mz-veh-paint';
  m.envMapIntensity = 1;
  m.userData.vehicleMat = true;
  paints.set(key, m); registry.add(m);
  if (_fallbackOn) m.envMap = _fallbackEnv;
  return m;
}

// Matériau "divers" : couleur, rugosité et métal portés par les sommets → une seule passe pour
// vitrage, plastiques, chromes, pneus, jantes, plaques.
let _misc = null;
// pbr = (rugosité, métal, fx) ; fx : 1 = grille nid d'abeille, 2 = carbone sergé, 3 = flanc de pneu (inscriptions)
const MISC_FRAG = /* glsl */`
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vPbr.z > 0.5 ? vec2(0.03, 0.97) : vMapUv );
  diffuseColor *= sampledDiffuseColor;
#endif
  float mzRoughAdd = 0.0;
  if (vPbr.z > 0.5 && vPbr.z < 1.5) {
    vec2 p = vMapUv * 62.0; vec2 r = vec2(1.0, 1.7320508); vec2 hh = r * 0.5;
    vec2 a = mod(p, r) - hh; vec2 b = mod(p - hh, r) - hh;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    float d = max(abs(g.x), dot(abs(g), normalize(r)));
    float web = smoothstep(0.33, 0.42, d);
    float fw = clamp((fwidth(p.x) + fwidth(p.y)) * 1.2 - 0.3, 0.0, 1.0);
    web = mix(web, 0.35, fw);
    diffuseColor.rgb *= mix(0.06, 1.0, web);
  } else if (vPbr.z > 1.5 && vPbr.z < 2.5) {
    vec2 p = vMapUv * 210.0; vec2 c = floor(p); vec2 f = fract(p);
    float t = mod(c.x + c.y, 4.0) < 2.0 ? 1.0 : 0.0;
    float sh = t > 0.5 ? 0.55 + 0.45 * sin(f.y * 3.1416) : 0.16 + 0.22 * sin(f.x * 3.1416);
    float fw = clamp((fwidth(p.x) + fwidth(p.y)) * 0.9 - 0.3, 0.0, 1.0);
    diffuseColor.rgb *= mix(0.35 + 1.5 * sh, 0.9, fw);
  } else if (vPbr.z > 2.5) {
    // flanc de pneu : uv = (angle/2π, position radiale 0..1) ; lettrage suggéré par blocs
    float ang = vMapUv.x * 48.0; float cell = floor(ang); float fa = fract(ang);
    float rnd = fract(sin(cell * 12.9898) * 43758.5453);
    float inBand = step(0.42, vMapUv.y) * step(vMapUv.y, 0.66);
    float sector = step(0.5, fract(vMapUv.x * 2.0 + 0.1)) ;
    float letter = inBand * step(0.18, fa) * step(fa, 0.82) * step(0.25, rnd) * step(fract(vMapUv.x * 2.0 + 0.1), 0.38);
    float ring = smoothstep(0.02, 0.0, abs(vMapUv.y - 0.3)) + smoothstep(0.02, 0.0, abs(vMapUv.y - 0.78));
    float fw = clamp(fwidth(ang) * 2.0 - 0.4, 0.0, 1.0);
    diffuseColor.rgb *= 1.0 + (letter * 1.6 + ring * 0.8) * (1.0 - fw);
    mzRoughAdd = -0.25 * letter * (1.0 - fw);
  }
`;
export function getMisc() {
  if (_misc) return _misc;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: getAtlas(), roughness: 1, metalness: 1 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 pbr;\nvarying vec3 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPbr;')
      .replace('#include <map_fragment>', MISC_FRAG)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(vPbr.x + mzRoughAdd, 0.03, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vPbr.y;');
  };
  m.customProgramCacheKey = () => 'mz-veh-misc2';
  registry.add(m);
  if (_fallbackOn) m.envMap = _fallbackEnv;
  return (_misc = m);
}

// Vitrage transparent teinté : couleur = teinte (sommets), pbr.x = opacité ; les reflets restent francs
// (l'alpha est remonté là où le spéculaire est fort).
let _glass = null;
export function getGlass() {
  if (_glass) return _glass;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.04, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: 1.3 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 pbr;\nvarying vec3 vPbr;\nvarying vec3 vOP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr; vOP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPbr;\nvarying vec3 vOP;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        vec3 mzSpec = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
        gl_FragColor.a = clamp(vPbr.x + max(mzSpec.r, max(mzSpec.g, mzSpec.b)) * 1.6, 0.0, 1.0);
        if (vPbr.y > 0.5) {
          // étoilement : arêtes d'un diagramme de Voronoï dans le plan du vitrage
          vec2 gp = vec2(vOP.z + vOP.x * 0.6, vOP.y + vOP.x * 0.3) * 13.0;
          vec2 ip = floor(gp), fp = fract(gp); float d1 = 9.0, d2 = 9.0; float cid = 0.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 o = vec2(float(i), float(j)); vec2 h = fract(sin(vec2(dot(ip + o, vec2(127.1, 311.7)), dot(ip + o, vec2(269.5, 183.3)))) * 43758.5453);
            float dd = length(o + h - fp); if (dd < d1) { d2 = d1; d1 = dd; cid = h.x; } else if (dd < d2) d2 = dd;
          }
          float edge = 1.0 - smoothstep(0.0, 0.045, d2 - d1);
          if (vPbr.y > 1.5) { if (cid < 0.86) discard; edge = max(edge, 0.5); }
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.85, 0.9, 0.92), edge * 0.8);
          gl_FragColor.a = max(gl_FragColor.a, edge * 0.9);
        }`);
  };
  m.customProgramCacheKey = () => 'mz-veh-glass2';
  registry.add(m);
  if (_fallbackOn) m.envMap = _fallbackEnv;
  return (_glass = m);
}

// Canaux lumineux des optiques.
export const CH = { HEAD: 0, TAIL: 1, BRAKE: 2, REVERSE: 3, BLINK_L: 4, BLINK_R: 5, DRL: 6, SIGN: 7 };
/** Matériau des optiques : un par voiture (uniform d'intensité par canal), programme partagé. */
export function createLightsMaterial() {
  const lint = { value: new Float32Array(8) };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: getAtlas(), roughness: 0.22, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.lint = lint;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float lch;\nuniform float lint[8];\nvarying float vLi;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLi = lint[int(lch + 0.5)];');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLi;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vLi;');
  };
  m.customProgramCacheKey = () => 'mz-veh-lights';
  m.userData.lint = lint.value;
  m.envMapIntensity = 0.6;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Repli d'environnement : tant que scene.environment est nul (module env absent), on fournit un petit
// ciel dégradé pré-filtré aux matériaux véhicules pour que peintures et chromes aient des reflets.
let _fallbackEnv = null, _fallbackOn = false;
export function updateEnvFallback(renderer, scene) {
  const need = !scene.environment;
  if (need === _fallbackOn) return;
  if (need && !_fallbackEnv) {
    const s = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 32, 16);
    const col = [];
    const p = geo.attributes.position, c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 50;
      if (y > 0) c.setRGB(lerpN(1.0, 0.25, Math.pow(y, 0.5)), lerpN(1.0, 0.45, Math.pow(y, 0.5)), lerpN(1.05, 0.85, Math.pow(y, 0.5)));
      else c.setRGB(lerpN(0.55, 0.12, Math.min(1, -y * 3)), lerpN(0.55, 0.12, Math.min(1, -y * 3)), lerpN(0.55, 0.13, Math.min(1, -y * 3)));
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const sun = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(30, 28, 24) }));
    sun.position.set(20, 35, 15); s.add(sun);
    const pm = new THREE.PMREMGenerator(renderer);
    _fallbackEnv = pm.fromScene(s, 0.02).texture; pm.dispose(); geo.dispose();
  }
  _fallbackOn = need;
  for (const m of registry) { m.envMap = need ? _fallbackEnv : null; m.needsUpdate = true; }
}
const lerpN = (a, b, t) => a + (b - a) * t;

/** Atténue les reflets de repli la nuit (sans effet si le module env fournit son propre environnement). */
export function setFallbackEnvIntensity(k) {
  if (!_fallbackOn) return;
  for (const m of registry) m.envMapIntensity = k;
}

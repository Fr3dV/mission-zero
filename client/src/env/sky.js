// Ciel procédural : dégradé atmosphérique, soleil, lune, étoiles, nuages fbm, lueur urbaine.
// Les couleurs (zénith/horizon/…) sont calculées côté JS (index.js) pour que le brouillard,
// la lumière hémisphérique et le ciel restent parfaitement accordés.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.999999; // toujours au fond
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir, uMoonDir;
uniform vec3 uZenith, uHorizon, uGround, uSunColor, uCloudLit, uCloudDark, uCityGlow;
uniform float uSunDisk, uSunGlow, uNight, uMoon, uCloudCover, uTime;

float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
  return s / (1.0 - a * 2.0 * 0.5);
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  // dégradé de base
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));
  // lueur de la ville près de l'horizon (nuit)
  col += uCityGlow * exp(-h * 7.0);

  float sd = max(dot(d, uSunDir), 0.0);
  float above = smoothstep(-0.03, 0.02, d.y);
  // halo du soleil (diffusion vers l'avant)
  vec3 glow = uSunColor * (pow(sd, 6.0) * 0.10 + pow(sd, 40.0) * 0.22 + pow(sd, 400.0) * 0.6) * uSunGlow;
  col += glow * above;

  // étoiles
  if (uNight > 0.01 && d.y > 0.0) {
    vec3 p = d * 190.0; vec3 ip = floor(p); vec3 fp = fract(p) - 0.5;
    float r = hash31(ip);
    float star = step(0.9955, r) * smoothstep(0.32, 0.0, length(fp));
    star *= 0.55 + 0.45 * sin(uTime * 2.5 + r * 400.0);
    col += vec3(0.9, 0.95, 1.0) * star * uNight * smoothstep(0.02, 0.3, d.y) * (0.6 + 2.0 * fract(r * 71.0));
  }
  // lune
  float md = dot(d, uMoonDir);
  if (uMoon > 0.01) {
    float disk = smoothstep(0.99968, 0.99978, md);
    vec2 mp = d.xz * 90.0;
    float tex = 0.8 + 0.2 * vnoise(mp * 3.0);
    col += vec3(0.95, 0.96, 1.0) * disk * tex * 2.2 * uMoon;
    col += vec3(0.25, 0.32, 0.5) * (pow(max(md, 0.0), 300.0) * 0.5 + pow(max(md, 0.0), 30.0) * 0.06) * uMoon;
  }

  // nuages (projection plane)
  float cloud = 0.0;
  if (d.y > 0.005) {
    vec2 uv = d.xz / (d.y + 0.10) * 0.55 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv);
    float lo = 1.0 - uCloudCover;
    cloud = smoothstep(lo - 0.08, lo + 0.34, n + 0.18 * uCloudCover);
    float n2 = fbm(uv + uSunDir.xz * 0.12 + 0.03);
    float lit = clamp(0.55 + (n - n2) * 2.2, 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, lit);
    cc += uSunColor * pow(sd, 10.0) * 0.12 * uSunGlow; // frange lumineuse vers le soleil
    cloud *= smoothstep(0.005, 0.11, d.y);
    col = mix(col, cc, cloud * 0.92);
  }

  // disque solaire (par-dessus, masqué par les nuages)
  float sun = smoothstep(0.99990, 0.99996, dot(d, uSunDir));
  col += uSunColor * sun * uSunDisk * above * (1.0 - cloud);

  // sous l'horizon
  col = mix(col, uGround, smoothstep(0.0, -0.06, d.y));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSkyUniforms() {
  const c = (r, g, b) => ({ value: new THREE.Color(r, g, b) });
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uZenith: c(0.2, 0.4, 0.8), uHorizon: c(0.6, 0.75, 0.95), uGround: c(0.3, 0.3, 0.3),
    uSunColor: c(1, 0.95, 0.9), uCloudLit: c(1, 1, 1), uCloudDark: c(0.6, 0.65, 0.7), uCityGlow: c(0, 0, 0),
    uSunDisk: { value: 30 }, uSunGlow: { value: 1 }, uNight: { value: 0 }, uMoon: { value: 0 },
    uCloudCover: { value: 0.35 }, uTime: { value: 0 },
  };
}

// Crée une sphère de ciel. `ground` : uniform de couleur propre (sous l'horizon), le reste est partagé.
export function createSkyMesh(shared, groundUniform, radius, octaves) {
  const uniforms = { ...shared, uGround: groundUniform };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, defines: { OCTAVES: octaves },
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -1000; mesh.name = 'env:sky';
  mesh.matrixAutoUpdate = true;
  return mesh;
}

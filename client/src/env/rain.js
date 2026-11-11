// Pluie : traits instanciés dans une boîte qui suit la caméra (enroulement modulo dans le vertex shader).
import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec3 aSeed;
uniform vec3 uCenter, uCam, uVel;
uniform float uTime;
varying float vAlpha;
const vec3 BOX = vec3(44.0, 26.0, 44.0);
void main() {
  float k = 0.8 + 0.4 * fract(aSeed.x * 17.31);
  vec3 p = aSeed * BOX + uVel * uTime * k;
  p = mod(p - uCenter, BOX) - BOX * 0.5 + uCenter;
  vec3 dir = normalize(uVel);
  vec3 toCam = p - uCam;
  float dist = length(toCam);
  vec3 side = normalize(cross(dir, toCam));
  float w = max(0.006, dist * 0.0011);
  float len = 0.55 * k;
  p += dir * (position.y * len) + side * (position.x * w);
  vAlpha = smoothstep(22.0, 12.0, dist) * smoothstep(1.2, 3.5, dist) * (0.5 + 0.5 * fract(aSeed.z * 31.7));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createRain(max) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(max * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
  g.instanceCount = 0;
  const uniforms = {
    uCenter: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(1.5, -11, 0.8) },
    uTime: { value: 0 }, uColor: { value: new THREE.Color(0.7, 0.75, 0.85) }, uOpacity: { value: 0.4 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 900; mesh.visible = false; mesh.name = 'env:rain';
  mesh.castShadow = false; mesh.receiveShadow = false;
  const fwd = new THREE.Vector3();
  return {
    mesh, uniforms, max,
    update(dt, camera, amount, light) {
      mesh.visible = amount > 0.01;
      if (!mesh.visible) return;
      g.instanceCount = Math.floor(max * Math.min(1, amount));
      uniforms.uTime.value = (uniforms.uTime.value + dt) % 3600;
      camera.getWorldDirection(fwd);
      uniforms.uCam.value.copy(camera.position);
      uniforms.uCenter.value.copy(camera.position).addScaledVector(fwd, 10);
      uniforms.uColor.value.copy(light);
      uniforms.uOpacity.value = 0.42 * Math.min(1, amount * 1.5);
    },
    dispose() { g.dispose(); mat.dispose(); },
  };
}

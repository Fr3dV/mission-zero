// Matériau « surface » : un seul MeshStandardMaterial (éclairage, ombres et brouillard de la scène)
// dont l'albédo/normales/rugosité viennent d'une texture en couches choisie par sommet (aSurf.x).
// aSurf = (couche, biais de profondeur, mode, -)
//   mode 0 : texture plaquée en coordonnées monde (xz) ; 1 : coordonnées uv (murs, en mètres)
//   mode 2 : pointillés de peinture le long de uv.y (période 1) ; 3 : bandes de passage piéton le long de uv.x
// couche 8 = sol générique : le masque (Seine / pelouse / allée / place) choisit la matière, la Seine est découpée.
import { LAYER_SIZE } from './textures.js';

export function createSurfaceMaterial(THREE, tex, masks, uniforms) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const inv = LAYER_SIZE.map((s) => (1 / s).toFixed(5)).join(', ');
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSurfAlb = { value: tex.albedo };
    sh.uniforms.uSurfNrm = { value: tex.normal };
    sh.uniforms.uMask = { value: masks.texture };
    sh.uniforms.uMaskRect = { value: masks.rect };
    sh.uniforms.uNight = uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aSurf;
varying vec3 vSurf;
varying vec2 vSUv;
varying vec3 vWPos;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
gl_Position.z -= aSurf.y * 1.0e-6 * gl_Position.w;
vSurf = aSurf.xyz; vSUv = uv;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2DArray uSurfAlb;
uniform sampler2DArray uSurfNrm;
uniform sampler2D uMask;
uniform vec4 uMaskRect;
uniform float uNight;
varying vec3 vSurf;
varying vec2 vSUv;
varying vec3 vWPos;
const float S_INV[8] = float[8](${inv});
const float S_ROUGH[8] = float[8](0.88, 0.86, 0.72, 1.0, 1.0, 0.62, 0.86, 0.8);
float sStripe(float x, float duty) {
  float w = fwidth(x), f = fract(x);
  float c = smoothstep(0.0, w, f) * (1.0 - smoothstep(duty, duty + w, f));
  return mix(c, duty, clamp(w * 2.5 - 0.5, 0.0, 1.0));
}`)
      .replace('#include <map_fragment>', `
float sLayer = floor(vSurf.x + 0.5);
float sMode = floor(vSurf.z + 0.5);
vec2 sUv = sMode == 1.0 ? vSUv : vWPos.xz;
vec3 sAlb; vec3 sN; float sRough;
float sMacro = texture(uSurfAlb, vec3(vWPos.xz * 0.0041, 7.0)).g * texture(uSurfAlb, vec3(vWPos.zx * 0.019, 7.0)).g;
sMacro = clamp(0.62 + sMacro * 0.6, 0.75, 1.15);
if (sLayer > 7.5) {
  vec4 m = textureLod(uMask, (vWPos.xz - uMaskRect.xy) * uMaskRect.zw, 0.0);
  if (m.r > 0.42) discard;
  float mg = smoothstep(0.38, 0.62, m.g), mb = smoothstep(0.38, 0.62, m.b);
  float wGrass = mg * (1.0 - mb), wGrav = mg * mb, wPlaza = mb * (1.0 - mg), wBase = (1.0 - mg) * (1.0 - mb);
  vec2 u1 = sUv * S_INV[1], u2 = sUv * S_INV[2], u3 = sUv * S_INV[3], u4 = sUv * S_INV[4];
  sAlb = texture(uSurfAlb, vec3(u1, 1.0)).rgb * vec3(0.9, 0.9, 0.9) * wBase + texture(uSurfAlb, vec3(u2, 2.0)).rgb * wPlaza
       + texture(uSurfAlb, vec3(u3, 3.0)).rgb * wGrass + texture(uSurfAlb, vec3(u4, 4.0)).rgb * wGrav;
  sN = texture(uSurfNrm, vec3(u1, 1.0)).xyz * wBase + texture(uSurfNrm, vec3(u2, 2.0)).xyz * wPlaza
     + texture(uSurfNrm, vec3(u3, 3.0)).xyz * wGrass + texture(uSurfNrm, vec3(u4, 4.0)).xyz * wGrav;
  sRough = 0.86 * wBase + 0.72 * wPlaza + 1.0 * (wGrass + wGrav);
  // herbe : variation large échelle supplémentaire
  sAlb *= mix(1.0, 0.8 + 0.4 * texture(uSurfAlb, vec3(vWPos.xz * 0.011, 7.0)).g, wGrass);
} else {
  int li = int(sLayer);
  vec3 tc = vec3(sUv * S_INV[li], sLayer);
  sAlb = texture(uSurfAlb, tc).rgb;
  sN = texture(uSurfNrm, tc).xyz;
  sRough = S_ROUGH[li];
}
sAlb *= sMacro;
sN = sN * 2.0 - 1.0;
`)
      .replace('#include <color_fragment>', `
if (sMode > 1.5) {
  float cov = sMode < 2.5 ? sStripe(vSUv.y, 0.46) : sStripe(vSUv.x, 0.5);
  if (sMode > 3.5) cov = 1.0;
  vec3 paint = texture(uSurfAlb, vec3(vWPos.xz * S_INV[5], 5.0)).rgb * vColor.rgb;
  diffuseColor.rgb *= mix(sAlb, paint, cov);
  sRough = mix(sRough, 0.6, cov);
} else {
  diffuseColor.rgb *= sAlb * vColor.rgb;
}
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = sRough;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.72, 0.45) * (0.075 * uNight);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  vec2 st0 = dFdx(sUv), st1 = dFdy(sUv);
  vec3 q1p = cross(q1, normal), q0p = cross(normal, q0);
  vec3 sT = q1p * st0.x + q0p * st1.x, sB = q1p * st0.y + q0p * st1.y;
  float det = max(dot(sT, sT), dot(sB, sB));
  float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  normal = normalize(mat3(sT * sc, sB * sc, normal) * sN);
}`);
  };
  mat.customProgramCacheKey = () => 'mz-surface';
  return mat;
}

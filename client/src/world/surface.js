// Matériau « surface » : un seul MeshStandardMaterial (éclairage, ombres et brouillard de la scène)
// dont l'albédo/normales/rugosité viennent d'une texture en couches choisie par sommet (aSurf.x).
// aSurf = (couche, biais de profondeur, mode, -)
//   mode 0 : texture plaquée en coordonnées monde (xz) ; 1 : coordonnées uv (murs, en mètres)
//   mode 2 : pointillés de peinture le long de uv.y (période 1) ; 3 : bandes de passage piéton le long de uv.x
//   mode 4 : peinture pleine ; 5 : peinture pleine émissive (éclairage de tunnel, balisage)
// couche 8 = sol générique : le masque choisit la matière et découpe le sol (fleuve, tranchées). Deux formats de
// masque (voir masks.js) : 'legacy' (poids V/B lissés) et 'classes' (indice de classe par texel, mélange bilinéaire).
import { LAYER_SIZE } from './textures.js';
import { CLASSES } from './masks.js';

/**
 * @param mask { texture, rect (Vector4 x0, z0, 1/tailleX, 1/tailleZ), size (texels) }
 * @param opts { classes: bool } format du masque
 */
export function createSurfaceMaterial(THREE, tex, mask, uniforms, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const inv = LAYER_SIZE.map((s) => (1 / s).toFixed(5)).join(', ');
  const classes = !!opts.classes;
  const f = (v) => (+v).toFixed(3);
  const clLayer = CLASSES.map((c) => c[0]).join(', '), clTint = CLASSES.map((c) => `vec3(${f(c[1])}, ${f(c[2])}, ${f(c[3])})`).join(', '), clRough = CLASSES.map((c) => f(c[4])).join(', ');
  const uMask = { value: mask.texture }, uMaskRect = { value: mask.rect }, uMaskSize = { value: mask.size || 1 };
  mat.userData.mask = { uMask, uMaskRect, uMaskSize };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSurfAlb = { value: tex.albedo };
    sh.uniforms.uSurfNrm = { value: tex.normal };
    sh.uniforms.uMask = uMask;
    sh.uniforms.uMaskRect = uMaskRect;
    sh.uniforms.uMaskSize = uMaskSize;
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
${classes ? '#define MZ_MASK_CLASSES' : ''}
uniform sampler2DArray uSurfAlb;
uniform sampler2DArray uSurfNrm;
uniform sampler2D uMask;
uniform vec4 uMaskRect;
uniform float uMaskSize;
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
}
#ifdef MZ_MASK_CLASSES
const int S_CL_LAYER[16] = int[16](${clLayer});
const vec3 S_CL_TINT[16] = vec3[16](${clTint});
const float S_CL_ROUGH[16] = float[16](${clRough});
void sClass(int c, float w, vec2 uv, vec2 gx, vec2 gy, inout vec3 alb, inout vec3 nrm, inout float rough) {
  if (w < 0.004) return;
  int li = S_CL_LAYER[c]; float k = S_INV[li];
  vec3 tc = vec3(uv * k, float(li));
  alb += w * textureGrad(uSurfAlb, tc, gx * k, gy * k).rgb * S_CL_TINT[c];
  nrm += w * textureGrad(uSurfNrm, tc, gx * k, gy * k).xyz;
  rough += w * S_CL_ROUGH[c];
}
int sClassAt(ivec2 p, ivec2 mx) { return int(texelFetch(uMask, clamp(p, ivec2(0), mx), 0).g * 255.0 + 0.5); }
#endif`)
      .replace('#include <map_fragment>', `
float sLayer = floor(vSurf.x + 0.5);
float sMode = floor(vSurf.z + 0.5);
vec2 sUv = sMode == 1.0 ? vSUv : vWPos.xz;
vec3 sAlb; vec3 sN; float sRough;
float sMacro = texture(uSurfAlb, vec3(vWPos.xz * 0.0041, 7.0)).g * texture(uSurfAlb, vec3(vWPos.zx * 0.019, 7.0)).g;
sMacro = clamp(0.62 + sMacro * 0.6, 0.75, 1.15);
if (sLayer > 7.5) {
  vec2 mUv = (vWPos.xz - uMaskRect.xy) * uMaskRect.zw;
#ifdef MZ_MASK_CLASSES
  if (textureLod(uMask, mUv, 0.0).r > 0.42) discard;
  vec2 mp = mUv * uMaskSize - 0.5, mf = smoothstep(0.18, 0.82, fract(mp));
  ivec2 mi = ivec2(floor(mp)), mx = ivec2(int(uMaskSize) - 1);
  int c00 = sClassAt(mi, mx), c10 = sClassAt(mi + ivec2(1, 0), mx), c01 = sClassAt(mi + ivec2(0, 1), mx), c11 = sClassAt(mi + ivec2(1, 1), mx);
  vec2 gx = dFdx(sUv), gy = dFdy(sUv);
  sAlb = vec3(0.0); sN = vec3(0.0); sRough = 0.0;
  if (c00 == c10 && c00 == c01 && c00 == c11) sClass(c00, 1.0, sUv, gx, gy, sAlb, sN, sRough);
  else {
    sClass(c00, (1.0 - mf.x) * (1.0 - mf.y), sUv, gx, gy, sAlb, sN, sRough); sClass(c10, mf.x * (1.0 - mf.y), sUv, gx, gy, sAlb, sN, sRough);
    sClass(c01, (1.0 - mf.x) * mf.y, sUv, gx, gy, sAlb, sN, sRough); sClass(c11, mf.x * mf.y, sUv, gx, gy, sAlb, sN, sRough);
    float ws = max(sRough, 0.05); // les poids ignorés (< 0,004) sont renormalisés via la rugosité cumulée ≈ somme des poids
    if (sN.z < 0.2) sN = vec3(0.5, 0.5, 1.0);
  }
  // végétation et champs : variation à grande échelle supplémentaire
  sAlb *= 0.84 + 0.32 * texture(uSurfAlb, vec3(vWPos.xz * 0.011, 7.0)).g;
#else
  vec4 m = textureLod(uMask, mUv, 0.0);
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
#endif
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
totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.72, 0.45) * (0.075 * uNight);
if (sMode > 4.5) totalEmissiveRadiance += vColor.rgb * 2.2;`)
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
  mat.customProgramCacheKey = () => 'mz-surface' + (classes ? '-c' : '');
  return mat;
}

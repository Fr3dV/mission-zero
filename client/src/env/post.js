// Chaîne de post-traitement : rendu HDR (MSAA) -> [GTAO] -> bloom à seuil -> passe finale
// (tone mapping + étalonnage + vignettage + sRGB + tramage).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const FINAL_VERT = /* glsl */`
precision highp float;
uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
attribute vec3 position; attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FINAL_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform float uVignette, uSaturation, uContrast, uTime;
uniform vec3 uTint;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
varying vec2 vUv;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  // vignettage doux (en linéaire, avant tone mapping)
  vec2 q = vUv - 0.5;
  float v = 1.0 - uVignette * smoothstep(0.25, 1.0, dot(q, q) * 2.2);
  c.rgb *= v * uTint;
  c.rgb = ACESFilmicToneMapping(c.rgb);
  c = sRGBTransferOETF(vec4(clamp(c.rgb, 0.0, 1.0), 1.0));
  // étalonnage léger (en espace d'affichage)
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(l), c.rgb, uSaturation);
  c.rgb = clamp((c.rgb - 0.5) * uContrast + 0.5, 0.0, 1.0);
  c.rgb += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0; // anti-bandes
  gl_FragColor = vec4(c.rgb, 1.0);
}`;

class FinalPass extends Pass {
  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null }, toneMappingExposure: { value: 1 },
      uVignette: { value: 0.32 }, uSaturation: { value: 1.06 }, uContrast: { value: 1.04 }, uTime: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
    };
    this.material = new THREE.RawShaderMaterial({ name: 'env:final', uniforms: this.uniforms, vertexShader: FINAL_VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    if (this.renderToScreen) { renderer.setRenderTarget(null); this.fsQuad.render(renderer); }
    else { renderer.setRenderTarget(writeBuffer); if (this.clear) renderer.clear(); this.fsQuad.render(renderer); }
  }
  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}

// opts : { samples, ao }
// Tampons : le RenderPass écrit toujours dans renderTarget2 (MSAA + texture de profondeur) ;
// renderTarget1 ne reçoit que des passes plein écran (sans MSAA).
export function createPost(renderer, scene, camera, opts) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr); composer.setSize(size.x, size.y);
  const sceneRT = composer.renderTarget2;
  sceneRT.samples = opts.samples;
  if (opts.ao) sceneRT.depthTexture = new THREE.DepthTexture(sceneRT.width, sceneRT.height);

  composer.addPass(new RenderPass(scene, camera));

  let gtao = null;
  if (opts.ao) {
    // AO calculée à partir de la profondeur du rendu principal (normales reconstruites) :
    // pas de second rendu de la scène, donc coût indépendant du nombre de draw calls.
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.setGBuffer(sceneRT.depthTexture, undefined); // (après construction : contourne un bug de l'addon r170)
    gtao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.2, thickness: 1.2, scale: 1.1, samples: 8, distanceFallOff: 1, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    gtao.blendIntensity = 0.8;
    // fondu de l'AO avec la distance (la précision de profondeur à 9 km crée sinon des bandes sombres)
    gtao.gtaoMaterial.fragmentShader = gtao.gtaoMaterial.fragmentShader.replace(
      'ao = pow(ao, scale);', 'ao = pow(ao, scale); ao = mix(ao, 1.0, smoothstep(55.0, 130.0, -viewPos.z));');
    gtao.gtaoMaterial.needsUpdate = true;
    composer.addPass(gtao);
  }

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x * pr, size.y * pr), 0.35, 0.55, 1.2);
  composer.addPass(bloom);
  const final = new FinalPass();
  final.needsSwap = false;
  composer.addPass(final);

  function resizePasses(w, h, ratio) {
    // l'AO travaille au plus à la résolution CSS (coût maîtrisé sur écran haute densité)
    const aoScale = Math.min(1, 1 / ratio);
    if (gtao) gtao.setSize(Math.round(w * ratio * aoScale), Math.round(h * ratio * aoScale));
  }
  resizePasses(size.x, size.y, pr);

  return {
    composer, bloom, gtao, final,
    setSize(w, h, ratio) { composer.setPixelRatio(ratio); composer.setSize(w, h); resizePasses(w, h, ratio); },
    setAO(on) { if (gtao) gtao.enabled = on; },
    setBloom(on) { bloom.enabled = on; },
    render(dt) {
      final.uniforms.uTime.value += dt;
      // ordre des tampons déterministe à chaque image
      composer.readBuffer = composer.renderTarget2; composer.writeBuffer = composer.renderTarget1;
      composer.render(dt);
    },
    dispose() { composer.passes.forEach((p) => p.dispose?.()); composer.dispose(); sceneRT.depthTexture?.dispose(); },
  };
}

// Environnement : ciel, soleil/lune, ombres, brouillard, cycle jour/nuit, météo, IBL, post-traitement.
// Contrat : ctx.env = { update(dt), render(dt), setTimeOfDay(h), sun, isNight(), setWeather(name), setQuality(q) }.
// Paramètres d'URL : time=H (fige l'heure), weather=clear|overcast|rain, quality=low|medium|high,
//                    daylen=<minutes réelles par journée, défaut 24>, dynres=0 (désactive la résolution dynamique).
import * as THREE from 'three';
import { createSkyUniforms, createSkyMesh } from './sky.js';
import { createPost } from './post.js';
import { createRain } from './rain.js';

const DEG = Math.PI / 180;
const LAT = 48.85 * DEG;      // latitude de Paris
const SOLAR_NOON = 13.5;      // midi solaire (heure d'été)
const SUN_DECL = 8 * DEG;     // coucher vers 20 h 10, lever vers 6 h 50
const MOON_DECL = 18 * DEG;
const SKY_GAIN = 1.35;      // radiance du ciel relative à l'exposition

// Paliers de qualité.
const QUALITY = {
  low:    { composer: false, shadow: 1024, shadowR: 70,  soft: false, pr: 1,   samples: 0, ao: false, octaves: 3, rain: 1500, envEvery: 8 },
  medium: { composer: true,  shadow: 2048, shadowR: 120, soft: true,  pr: 1.5, samples: 4, ao: false, octaves: 4, rain: 3500, envEvery: 4 },
  high:   { composer: true,  shadow: 4096, shadowR: 170, soft: true,  pr: 2,   samples: 4, ao: true,  octaves: 5, rain: 6000, envEvery: 2.5 },
};
// Résolution dynamique : niveaux de dégradation successifs.
const DYN_LEVELS = [
  { scale: 1.0, ao: true, bloom: true }, { scale: 0.85, ao: false, bloom: true }, { scale: 0.72, ao: false, bloom: true },
  { scale: 0.6, ao: false, bloom: true }, { scale: 0.5, ao: false, bloom: false },
];
const WEATHER = {
  clear:    { cover: 0.34, overcast: 0.0, rain: 0.0 },
  overcast: { cover: 0.95, overcast: 0.85, rain: 0.0 },
  rain:     { cover: 1.0,  overcast: 1.0, rain: 1.0 },
};

// --- tables d'interpolation en fonction de la hauteur du soleil (degrés) ---
const K_ZENITH = [[-14, 0.010, 0.016, 0.045], [-6, 0.030, 0.050, 0.130], [-1, 0.070, 0.100, 0.270], [4, 0.095, 0.170, 0.420], [9, 0.140, 0.270, 0.620], [14, 0.190, 0.360, 0.740], [40, 0.170, 0.350, 0.760]];
const K_HORIZON = [[-14, 0.045, 0.045, 0.070], [-6, 0.220, 0.170, 0.240], [-1, 0.560, 0.230, 0.110], [4, 0.620, 0.350, 0.170], [9, 0.660, 0.540, 0.440], [14, 0.720, 0.800, 0.930], [40, 0.600, 0.760, 0.960]];
const K_SUNCOL = [[-2, 1.0, 0.30, 0.08], [1, 1.0, 0.42, 0.14], [6, 1.0, 0.58, 0.28], [14, 1.0, 0.82, 0.60], [32, 1.0, 0.95, 0.87]];
const K_SUNI = [[-2, 0], [0, 1.1], [4, 3.4], [14, 4.8], [40, 5.5]];
const K_HEMI_SKY = [[-12, 0.32, 0.38, 0.62], [-3, 0.50, 0.46, 0.62], [4, 0.66, 0.66, 0.84], [16, 0.92, 0.94, 1.0]];
const K_HEMI_GND = [[-12, 0.38, 0.26, 0.16], [-3, 0.42, 0.30, 0.24], [4, 0.46, 0.34, 0.26], [16, 0.44, 0.40, 0.35]];
const K_HEMI_I = [[-12, 1.3], [-3, 0.95], [4, 1.2], [16, 1.7]];
const K_EXPOSURE = [[-12, 1.2], [-4, 0.95], [3, 0.68], [8, 0.64], [16, 0.62]];
const K_DAYLUM = [[-12, 0.035], [-3, 0.22], [5, 0.7], [20, 1.0]];
const K_GLOW = [[-8, 0], [-2, 1.0], [6, 0.9], [20, 0.6]];
const K_BLOOM_T = [[-10, 1.0], [-2, 1.4], [6, 2.0]];
const K_BLOOM_S = [[-10, 0.5], [-2, 0.4], [6, 0.22]];
const K_ENV_I = [[-10, 1.0], [5, 0.8]];

function seg(table, x) {
  let i = 0; const n = table.length;
  if (x <= table[0][0]) return [table[0], table[0], 0];
  if (x >= table[n - 1][0]) return [table[n - 1], table[n - 1], 0];
  while (x > table[i + 1][0]) i++;
  return [table[i], table[i + 1], (x - table[i][0]) / (table[i + 1][0] - table[i][0])];
}
function keyS(table, x) { const [a, b, t] = seg(table, x); return a[1] + (b[1] - a[1]) * t; }
function keyC(out, table, x) { const [a, b, t] = seg(table, x); return out.setRGB(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t); }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Direction d'un astre (vers l'astre) : +X est, +Z sud, +Y haut.
function celestial(out, hour, decl) {
  const H = (hour - SOLAR_NOON) * 15 * DEG;
  return out.set(
    -Math.cos(decl) * Math.sin(H),
    Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H),
    Math.cos(decl) * Math.cos(H) * Math.sin(LAT) - Math.sin(decl) * Math.cos(LAT),
  ).normalize();
}

export function createEnvironment(ctx) {
  const { renderer, scene, camera, bus, store, params } = ctx;
  let qName = QUALITY[ctx.quality] ? ctx.quality : 'high';
  let q = QUALITY[qName];

  // ---------- rendu ----------
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  scene.background = null;
  scene.fog = new THREE.FogExp2(0x9fc4e8, 0.00011);

  // ---------- ciel ----------
  const skyU = createSkyUniforms();
  const fogColor = new THREE.Color();
  let sky = createSkyMesh(skyU, { value: fogColor }, 1, q.octaves);
  sky.scale.setScalar(4000);
  scene.add(sky);
  // scène séparée pour l'IBL (même ciel, sol sombre sous l'horizon)
  const envScene = new THREE.Scene();
  const envGround = new THREE.Color(0.1, 0.1, 0.1);
  const envSky = createSkyMesh(skyU, { value: envGround }, 10, 3);
  envScene.add(envSky);
  const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(0.1, 100, cubeRT);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  const envState = { dir: new THREE.Vector3(0, -1, 0), oc: -1, t: -100 };

  // ---------- lumières ----------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x554433, 0.8);
  hemi.name = 'env:hemi';
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 3);
  sun.name = 'env:sun';
  sun.castShadow = true;
  sun.shadow.bias = -0.0002;
  scene.add(sun, sun.target);
  function setupShadow() {
    const s = sun.shadow, R = q.shadowR;
    s.mapSize.set(q.shadow, q.shadow);
    s.camera.left = -R; s.camera.right = R; s.camera.top = R; s.camera.bottom = -R;
    s.camera.near = 10; s.camera.far = 3000;
    s.camera.updateProjectionMatrix();
    s.normalBias = Math.max(0.04, (2 * R / q.shadow) * 0.9);
    s.radius = 1.4;
    if (s.map) { s.map.dispose(); s.map = null; }
  }
  setupShadow();

  // ---------- pluie ----------
  let rain = createRain(q.rain);
  scene.add(rain.mesh);

  // ---------- post-traitement ----------
  let post = null;
  const dyn = { level: 0, lowT: 0, highT: 0, cool: 6, banLevel: -1, banUntil: 0, enabled: params.get('dynres') !== '0' };
  function currentPixelRatio() {
    const levels = DYN_LEVELS, lv = levels[Math.min(dyn.level, levels.length - 1)];
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, q.pr) * lv.scale);
  }
  function applyResolution() {
    const pr = currentPixelRatio();
    const w = window.innerWidth, h = window.innerHeight;
    if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
    if (post) {
      post.setSize(w, h, pr);
      const lv = DYN_LEVELS[dyn.level];
      post.setAO(q.ao && lv.ao); post.setBloom(lv.bloom);
    }
  }
  function buildPost() {
    if (post) { post.dispose(); post = null; }
    renderer.setPixelRatio(currentPixelRatio());
    if (q.composer) {
      try { post = createPost(renderer, scene, camera, { samples: q.samples, ao: q.ao }); }
      catch (e) { console.warn('[env] post-traitement indisponible', e); post = null; }
    }
    applyResolution();
  }
  buildPost();
  bus.on('resize', applyResolution);

  // ---------- état temps / météo ----------
  const t0 = parseFloat(params.get('time'));
  let hour = Number.isFinite(t0) ? ((t0 % 24) + 24) % 24 : 14;
  let frozen = Number.isFinite(t0);
  const dayMinutes = Math.max(0.2, parseFloat(params.get('daylen')) || 24);
  let hoursPerSec = 24 / (dayMinutes * 60);
  let lastHourInt = -1, lastNight = null, storeT = 1, firstFrame = true;

  const forced = params.get('weather');
  let weatherName = WEATHER[forced] ? forced : 'clear';
  let weatherLocked = !!WEATHER[forced];
  let weatherTimer = 200 + Math.random() * 300;
  const wx = { ...WEATHER[weatherName] };      // facteurs courants (interpolés)
  let wetness = wx.rain;
  let lastWeatherEmitted = null;
  const uniforms = { uWetness: { value: wetness }, uRain: { value: wx.rain } };

  // ---------- temporaires ----------
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), lightDir = new THREE.Vector3();
  const cZen = new THREE.Color(), cHor = new THREE.Color(), cSun = new THREE.Color(), cGrey = new THREE.Color(), cTmp = new THREE.Color();
  const cRain = new THREE.Color();
  const vRight = new THREE.Vector3(), vUp = new THREE.Vector3(), vC = new THREE.Vector3(), vF = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let elev = 45, night = false;

  function applyLighting() {
    celestial(sunDir, hour, SUN_DECL);
    celestial(moonDir, hour + 12, MOON_DECL);
    elev = Math.asin(sunDir.y) / DEG;
    night = elev < -2;
    const oc = wx.overcast, dayLum = keyS(K_DAYLUM, elev);
    const nightF = sstep(-3, -11, elev);

    // couleurs du ciel
    keyC(cZen, K_ZENITH, elev).multiplyScalar(SKY_GAIN); keyC(cHor, K_HORIZON, elev).multiplyScalar(SKY_GAIN); keyC(cSun, K_SUNCOL, elev);
    cGrey.setRGB(0.46, 0.49, 0.54).multiplyScalar(dayLum * SKY_GAIN).add(cTmp.setRGB(0.05, 0.035, 0.025).multiplyScalar(nightF)); // nuages éclairés par la ville
    cZen.lerp(cTmp.copy(cGrey).multiplyScalar(0.85), oc * 0.92);
    cHor.lerp(cTmp.copy(cGrey).multiplyScalar(1.25), oc * 0.88);
    skyU.uZenith.value.copy(cZen); skyU.uHorizon.value.copy(cHor);
    skyU.uSunDir.value.copy(sunDir); skyU.uMoonDir.value.copy(moonDir);
    skyU.uSunColor.value.copy(cSun);
    skyU.uSunDisk.value = 45 * sstep(-2.5, 0.5, elev) * (1 - oc);
    skyU.uSunGlow.value = keyS(K_GLOW, elev) * (1 - 0.85 * oc);
    skyU.uNight.value = nightF * (1 - oc);
    skyU.uMoon.value = nightF * sstep(0.0, 0.12, moonDir.y) * (1 - oc * 0.9);
    skyU.uCityGlow.value.setRGB(0.15, 0.08, 0.035).multiplyScalar(nightF * (1 + 0.6 * oc));
    skyU.uCloudCover.value = wx.cover;
    // nuages : éclairés par le soleil (teinte chaude à l'heure dorée), assombris sous couvert
    const sunK = sstep(-4, 6, elev);
    skyU.uCloudLit.value.copy(cSun).multiplyScalar(0.95 * sunK).add(cTmp.copy(cHor).multiplyScalar(0.35)).add(cTmp.setRGB(0.07, 0.055, 0.05).multiplyScalar(nightF));
    skyU.uCloudLit.value.lerp(cTmp.copy(cGrey).multiplyScalar(1.5 - 0.35 * wx.rain), oc * 0.9);
    skyU.uCloudDark.value.copy(cZen).multiplyScalar(0.5).add(cTmp.copy(cHor).multiplyScalar(0.4)).add(cTmp.setRGB(0.05, 0.035, 0.025).multiplyScalar(nightF));
    skyU.uCloudDark.value.lerp(cTmp.copy(cGrey).multiplyScalar(0.8 - 0.25 * wx.rain), oc * 0.9);

    // brouillard = couleur d'horizon (+ lueur urbaine)
    fogColor.copy(cHor).add(cTmp.copy(skyU.uCityGlow.value).multiplyScalar(0.55));
    scene.fog.color.copy(fogColor);
    scene.fog.density = 0.000105 * (1 + 0.9 * oc + 2.4 * wx.rain);

    // soleil / lune (une seule DirectionalLight)
    if (elev > -3) {
      lightDir.copy(sunDir);
      sun.color.copy(cSun);
      sun.intensity = keyS(K_SUNI, elev) * (1 - 0.9 * oc);
    } else {
      lightDir.copy(moonDir);
      sun.color.setRGB(0.55, 0.68, 1.0);
      sun.intensity = 0.8 * sstep(-3, -8, elev) * sstep(0.0, 0.15, moonDir.y) * (1 - 0.75 * oc);
    }
    if (lightDir.y < 0.03) { lightDir.y = 0.03; lightDir.normalize(); }
    sun.castShadow = sun.intensity > 0.02;

    // ambiance
    keyC(hemi.color, K_HEMI_SKY, elev); keyC(hemi.groundColor, K_HEMI_GND, elev);
    hemi.color.lerp(cTmp.setRGB(0.80, 0.83, 0.88), oc * dayLum * 0.9);
    hemi.intensity = keyS(K_HEMI_I, elev) * (1 + 0.45 * oc * dayLum);

    renderer.toneMappingExposure = keyS(K_EXPOSURE, elev) * (1 + 0.12 * oc * dayLum);
    scene.environmentIntensity = keyS(K_ENV_I, elev) + 0.7 * wetness;
    if (post) {
      post.bloom.threshold = keyS(K_BLOOM_T, elev);
      post.bloom.strength = keyS(K_BLOOM_S, elev) + 0.08 * wx.rain;
      // étalonnage : très légère dominante chaude le jour, froide la nuit
      post.final.uniforms.uTint.value.setRGB(1.0 + 0.015 * (1 - nightF), 1.0, 1.0 + 0.03 * nightF);
    }
    // couleur des gouttes : suit l'éclairage ambiant
    cRain.copy(hemi.color).multiplyScalar(0.55 * hemi.intensity + 0.25).add(cTmp.copy(skyU.uCityGlow.value));
  }

  // Ombre unique recentrée devant la caméra, accrochée au texel (pas de scintillement en translation).
  function updateShadow() {
    const R = q.shadowR, texel = (2 * R) / q.shadow;
    camera.getWorldDirection(vF); vF.y = 0;
    if (vF.lengthSq() < 1e-6) vF.set(0, 0, -1); vF.normalize();
    vC.copy(camera.position).addScaledVector(vF, R * 0.55);
    vC.y = Math.max(0, camera.position.y * 0.4);
    vRight.crossVectors(UP, lightDir).normalize();
    vUp.crossVectors(lightDir, vRight).normalize();
    const x = Math.round(vC.dot(vRight) / texel) * texel, y = Math.round(vC.dot(vUp) / texel) * texel, z = vC.dot(lightDir);
    sun.target.position.set(0, 0, 0).addScaledVector(vRight, x).addScaledVector(vUp, y).addScaledVector(lightDir, z);
    sun.position.copy(sun.target.position).addScaledVector(lightDir, 1500);
    sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
  }

  // IBL : cube du ciel -> PMREM, régénéré seulement quand l'éclairage a sensiblement changé.
  function updateEnvMap(force) {
    const now = ctx.time || 0;
    const moved = envState.dir.angleTo(sunDir) > 1.5 * DEG || Math.abs(envState.oc - wx.overcast) > 0.04;
    if (!force && (!moved || now - envState.t < q.envEvery)) return;
    envState.dir.copy(sunDir); envState.oc = wx.overcast; envState.t = now;
    // sol vu dans les reflets : albédo sombre × éclairement
    envGround.copy(hemi.groundColor).multiplyScalar(hemi.intensity * 0.35).add(cTmp.copy(sun.color).multiplyScalar(sun.intensity * 0.05 * Math.max(0, lightDir.y)));
    const disk = skyU.uSunDisk.value; skyU.uSunDisk.value = Math.min(disk, 4); // le spéculaire du soleil vient déjà de la DirectionalLight
    const prevRT = renderer.getRenderTarget();
    cubeCam.update(renderer, envScene);
    const rt = pmrem.fromCubemap(cubeRT.texture);
    renderer.setRenderTarget(prevRT);
    skyU.uSunDisk.value = disk;
    scene.environment = rt.texture;
    if (envRT) envRT.dispose();
    envRT = rt;
  }

  function emitTime() {
    const hi = Math.floor(hour);
    if (hi !== lastHourInt || night !== lastNight) {
      lastHourInt = hi; lastNight = night;
      bus.emit('env:time', { hour: hi, night });
    }
  }

  function updateWeather(dt) {
    if (!weatherLocked) {
      weatherTimer -= dt;
      if (weatherTimer <= 0) {
        weatherTimer = 240 + Math.random() * 300;
        const r = Math.random();
        const next = r < 0.55 ? 'clear' : r < 0.85 ? 'overcast' : 'rain';
        if (next !== weatherName) weatherName = next;
      }
    }
    if (weatherName !== lastWeatherEmitted) { lastWeatherEmitted = weatherName; bus.emit('env:weather', { name: weatherName }); }
    const target = WEATHER[weatherName], k = 1 - Math.exp(-dt / 14);
    wx.cover += (target.cover - wx.cover) * k;
    wx.overcast += (target.overcast - wx.overcast) * k;
    // la pluie n'arrive qu'une fois le ciel couvert
    const rainTarget = target.rain * sstep(0.6, 0.95, wx.overcast);
    wx.rain += (rainTarget - wx.rain) * (1 - Math.exp(-dt / 8));
    wetness += ((wx.rain > 0.15 ? 1 : 0) - wetness) * (1 - Math.exp(-dt / (wx.rain > 0.15 ? 20 : 90)));
    uniforms.uWetness.value = wetness; uniforms.uRain.value = wx.rain;
  }

  function updateDynRes(dt) {
    if (!dyn.enabled || document.hidden) return;
    if (dyn.cool > 0) { dyn.cool -= dt; dyn.lowT = dyn.highT = 0; return; }
    const fps = ctx.fps ?? 60;
    const maxLevel = q.composer ? DYN_LEVELS.length - 1 : 3;
    dyn.lowT = fps < 40 ? dyn.lowT + dt : 0;
    dyn.highT = fps > 58 ? dyn.highT + dt : 0;
    if (dyn.lowT > 3 && dyn.level < maxLevel) {
      // une remontée récente a échoué : ne pas retenter avant un moment
      if (ctx.time - dyn.lastUp < 12) { dyn.banLevel = dyn.level; dyn.banUntil = ctx.time + 90; }
      dyn.level++; dyn.cool = 3; applyResolution();
    } else if (dyn.highT > 6 && dyn.level > 0 && !(dyn.level - 1 === dyn.banLevel && ctx.time < dyn.banUntil)) {
      dyn.level--; dyn.cool = 4; dyn.lastUp = ctx.time; applyResolution();
    }
  }

  const api = {
    sun, hemi, sunDir, moonDir, lightDir, uniforms,
    get weather() { return weatherName; },
    get rain() { return wx.rain; },
    get wetness() { return wetness; },
    get overcast() { return wx.overcast; },
    get hour() { return hour; },
    get sunElevation() { return elev; },
    get pixelRatio() { return renderer.getPixelRatio(); },
    get dynLevel() { return dyn.level; },
    get post() { return post; },
    isNight() { return night; },
    setTimeOfDay(h, opts) {
      if (!Number.isFinite(+h)) return;
      hour = ((+h % 24) + 24) % 24;
      if (opts && opts.freeze !== undefined) frozen = !!opts.freeze;
      store.timeOfDay = hour; storeT = 1;
      applyLighting(); updateEnvMap(true); emitTime();
    },
    setDayLength(minutes) { hoursPerSec = 24 / (Math.max(0.2, minutes) * 60); },
    // name : 'clear' | 'overcast' | 'rain' | 'auto' (rend la main à la météo aléatoire). opts.instant : sans transition.
    setWeather(name, opts) {
      if (name === 'auto') { weatherLocked = false; return; }
      if (!WEATHER[name]) return;
      weatherName = name; weatherLocked = !(opts && opts.lock === false);
      if (opts && opts.instant) { Object.assign(wx, WEATHER[name]); wetness = wx.rain; applyLighting(); updateEnvMap(true); }
    },
    setQuality(name) {
      if (!QUALITY[name] || name === qName) return;
      qName = name; q = QUALITY[name]; ctx.quality = name;
      dyn.level = 0; dyn.cool = 5;
      renderer.shadowMap.type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      renderer.shadowMap.needsUpdate = true;
      setupShadow();
      scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
      const old = sky; scene.remove(old);
      sky = createSkyMesh(skyU, { value: fogColor }, 1, q.octaves); sky.scale.copy(old.scale); scene.add(sky);
      old.geometry.dispose(); old.material.dispose();
      scene.remove(rain.mesh); rain.dispose(); rain = createRain(q.rain); scene.add(rain.mesh);
      buildPost();
    },
    update(dt) {
      if (!frozen) hour = (hour + dt * hoursPerSec) % 24;
      store.timeOfDay = hour;
      storeT += dt;
      if (storeT >= 1 && !frozen) { storeT = 0; store.set({ timeOfDay: hour }); }
      else if (firstFrame) store.set({ timeOfDay: hour });
      updateWeather(dt);
      applyLighting();
      emitTime();
      skyU.uTime.value += dt;
      // le ciel suit la caméra ; rayon < far
      sky.position.copy(camera.position);
      sky.scale.setScalar(Math.min(8000, camera.far * 0.9));
      updateShadow();
      rain.update(dt, camera, wx.rain, cRain);
      updateEnvMap(firstFrame);
      firstFrame = false;
    },
    render(dt) {
      updateDynRes(dt || 0.016);
      if (post) post.render(dt || 0.016);
      else renderer.render(scene, camera);
    },
  };

  applyLighting();
  updateShadow();
  store.timeOfDay = hour;
  return api;
}

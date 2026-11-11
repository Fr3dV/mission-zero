// Monuments de Paris : construction procédurale, LOD, collisions, éclairage nocturne.
// Contrat : ctx.monuments = { update(dt), get(id), list, stats() }.
// Chaque édifice est construit dans un repère local (façade principale vers +Z), posé à heightAt et tourné de
// `rot` (shared/landmarks.js). La version lointaine (légère) et les collisions sont créées au démarrage ;
// la version détaillée n'est construite qu'à l'approche du joueur (une par image au plus).
import * as THREE from 'three';
import { createKit, Builder, DEG } from './kit.js';
import { buildEiffel } from './eiffel.js';
import { buildArc } from './arc.js';
import { buildNotreDame } from './notredame.js';
import { buildLouvre, buildCourCarree, buildCarrousel } from './louvre.js';
import { buildSacreCoeur } from './sacrecoeur.js';
import { buildInvalides, buildHotelInvalides } from './invalides.js';
import { buildConcorde } from './concorde.js';
import { buildPantheon } from './pantheon.js';
import { buildOpera } from './opera.js';
import { buildGrandPalais } from './grandpalais.js';
import { buildMadeleine } from './madeleine.js';
import { buildTrocadero } from './trocadero.js';
import * as civic from './civic.js';
import * as culture from './culture.js';
import * as churches from './churches.js';
import * as city from './city.js';

// id de shared/landmarks.js -> fonction de construction. Les ids absents sont de simples compléments d'emprise.
export const DEFS = {
  eiffel: buildEiffel, arc: buildArc, notredame: buildNotreDame, louvre: buildLouvre, courcarree: buildCourCarree, carrousel: buildCarrousel,
  sacrecoeur: buildSacreCoeur, invalides: buildInvalides, hotelinvalides: buildHotelInvalides, concorde: buildConcorde, pantheon: buildPantheon,
  opera: buildOpera, grandpalais: buildGrandPalais, madeleine: buildMadeleine, trocadero: buildTrocadero,
  ...civic.DEFS, ...culture.DEFS, ...churches.DEFS, ...city.DEFS,
};

export function createMonuments(ctx, opts = {}) {
  const { scene, camera, bus, LANDMARKS, heightAt, collision, store } = ctx;
  const q = ctx.quality || 'high';
  const kit = createKit(ctx);
  const lodDist = opts.lodDist ?? (q === 'low' ? 600 : q === 'medium' ? 950 : 1300);
  const seg = q === 'low' ? 0.6 : q === 'medium' ? 0.8 : 1;
  const st = { night: 0, isNight: false, hour: 12, time: 0, sparkle: false, pxScale: 1000, camera };
  const items = new Map(), updaters = [];
  const noCollide = { box() {}, circle() {} };

  function buildLevel(item, far) {
    const l = item.landmark, g = new THREE.Group(); g.name = far ? 'loin' : 'pres';
    const B = new Builder({ far, seg, seed: l.id.length * 131 + l.id.charCodeAt(0) });
    const m = {
      B, far, hi: !far, kit, quality: q, landmark: l, root: item.root,
      add: (o) => { g.add(o); return o; },
      collide: far ? item.collide : noCollide,
      onUpdate: (fn) => updaters.push({ fn, g, item }),
      // hauteur du terrain relative au pied du monument, en coordonnées locales
      ground: (x, z) => { const [wx, wz] = item.toWorld(x, z); return heightAt(wx, wz) - item.y0; },
    };
    const res = item.build(m) || {};
    if (res.height) item.height = res.height;
    for (const mesh of B.meshes(kit.main, l.id)) { mesh.castShadow = !far; mesh.receiveShadow = true; g.add(mesh); }
    item.root.add(g); g.updateMatrixWorld(true);
    return g;
  }

  for (const l of LANDMARKS) {
    const build = DEFS[l.id];
    if (!build || (opts.only && opts.only !== l.id)) continue;
    const yaw = l.rot, y0 = heightAt(l.x, l.z), cs = Math.cos(yaw), sn = Math.sin(yaw);
    const root = new THREE.Group(); root.name = `monument:${l.id}`;
    root.position.set(l.x, y0, l.z); root.rotation.y = yaw;
    const toWorld = (x, z) => [l.x + x * cs + z * sn, l.z - x * sn + z * cs];
    const handles = [];
    const item = { id: l.id, landmark: l, root, yaw, y0, levels: [null, null], near: false, height: 50, reach: l.radius, collisions: handles, toWorld, build };
    item.collide = {
      // coordonnées locales ; bottom/top relatifs au pied du monument
      box(x, z, hw, hd, ry = 0, bottom = -1e3, top = 1e4) { const [wx, wz] = toWorld(x, z); item.reach = Math.max(item.reach, Math.hypot(x, z) + Math.hypot(hw, hd)); handles.push(collision.addBox({ x: wx, z: wz, hw, hd, rot: yaw + ry, bottom: y0 + bottom, top: y0 + top, tag: 'monument' })); },
      circle(x, z, r, bottom = -1e3, top = 1e4) { const [wx, wz] = toWorld(x, z); item.reach = Math.max(item.reach, Math.hypot(x, z) + r); handles.push(collision.addCircle({ x: wx, z: wz, r, bottom: y0 + bottom, top: y0 + top, tag: 'monument' })); },
    };
    scene.add(root); root.updateMatrixWorld(true);
    item.levels[1] = buildLevel(item, true);
    items.set(l.id, item);
  }

  bus?.on?.('env:time', (e) => { if (e && typeof e.night === 'boolean') st.isNight = e.night; });
  const sparkleForce = ctx.params?.get?.('sparkle');

  function countStats(visibleOnly = true) {
    let calls = 0, tris = 0;
    for (const it of items.values()) it.root.traverse((o) => {
      if (!(o.isMesh || o.isPoints) || !o.geometry) return;
      if (visibleOnly) { for (let p = o; p && p !== it.root.parent; p = p.parent) if (!p.visible) return; }
      const n = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
      calls++; tris += (o.isPoints ? 0 : n / 3) * (o.isInstancedMesh ? o.count : 1);
    });
    return { calls, tris: Math.round(tris) };
  }

  return {
    list: [...items.values()],
    kit,
    get(id) { return items.get(id) || null; },
    stats: countStats,
    update(dt) {
      st.time += dt;
      // heure et nuit : événement env:time, sinon repli sur ctx.env / store
      const h = store?.timeOfDay;
      if (Number.isFinite(h)) st.hour = h;
      if (ctx.env?.isNight) st.isNight = !!ctx.env.isNight();
      st.night += ((st.isNight ? 1 : 0) - st.night) * (1 - Math.exp(-dt / 1.2));
      if (st.night < 0.002) st.night = 0;
      kit.uNight.value = st.night; kit.uTime.value = st.time;
      // scintillement de la Tour Eiffel : 5 premières minutes de chaque heure de nuit
      st.sparkle = sparkleForce != null ? sparkleForce !== '0' : (st.hour - Math.floor(st.hour)) * 60 < 5;
      st.pxScale = (ctx.renderer?.domElement?.height || 720) / (2 * Math.tan((camera.fov || 60) * DEG / 2));
      // LOD (avec hystérésis) ; distance mesurée au bord de l'emprise pour les grands ensembles
      const cx = camera.position.x, cz = camera.position.z;
      let todo = null, todoD = Infinity;
      for (const it of items.values()) {
        const d = Math.hypot(cx - it.landmark.x, cz - it.landmark.z) - Math.max(0, it.reach - 80);
        if (!it.levels[0]) {
          if (d < lodDist * 1.2 && d < todoD) { todo = it; todoD = d; }
          continue;
        }
        const near = d < lodDist * (it.near ? 1.06 : 0.94);
        if (near !== it.near) { it.near = near; it.levels[0].visible = near; it.levels[1].visible = !near; }
      }
      // construction paresseuse de la version détaillée du monument le plus proche qui en est dépourvu
      if (todo) { todo.levels[0] = buildLevel(todo, false); todo.levels[0].visible = false; }
      for (const u of updaters) u.fn(dt, st, u.g.visible);
    },
  };
}

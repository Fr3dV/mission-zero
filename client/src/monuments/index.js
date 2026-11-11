// Monuments de Paris : construction procédurale, LOD, collisions, éclairage nocturne.
// Contrat : ctx.monuments = { update(dt), get(id), list, stats() }.
// Chaque monument est construit dans un repère local (façade principale vers +Z) puis orienté selon son
// azimut réel `facing` (degrés, sens horaire depuis le nord) — plus fiable que le `rot` approximatif de landmarks.js.
import * as THREE from 'three';
import { createKit, Builder, DEG } from './kit.js';
import { buildEiffel } from './eiffel.js';
import { buildArc } from './arc.js';
import { buildNotreDame } from './notredame.js';
import { buildLouvre } from './louvre.js';
import { buildSacreCoeur } from './sacrecoeur.js';
import { buildInvalides } from './invalides.js';
import { buildConcorde } from './concorde.js';
import { buildPantheon } from './pantheon.js';
import { buildOpera } from './opera.js';
import { buildGrandPalais } from './grandpalais.js';
import { buildMadeleine } from './madeleine.js';
import { buildTrocadero } from './trocadero.js';

// facing = direction vers laquelle regarde la façade principale (local +Z).
export const DEFS = {
  eiffel: { build: buildEiffel, facing: 133 },        // côté Champ-de-Mars (symétrie d'ordre 4)
  arc: { build: buildArc, facing: 115.5 },            // axe des Champs-Élysées
  notredame: { build: buildNotreDame, facing: 295 },  // façade occidentale sur le parvis
  louvre: { build: buildLouvre, facing: 296 },        // la cour Napoléon s'ouvre vers les Tuileries
  sacrecoeur: { build: buildSacreCoeur, facing: 172 },// façade sud, vers Paris
  invalides: { build: buildInvalides, facing: 185 },  // façade sud du Dôme
  concorde: { build: buildConcorde, facing: 206 },    // axe rue Royale – pont de la Concorde (fontaines)
  pantheon: { build: buildPantheon, facing: 288 },    // péristyle vers la rue Soufflot
  opera: { build: buildOpera, facing: 186 },          // façade sur la place de l'Opéra
  grandpalais: { build: buildGrandPalais, facing: 116 }, // avenue Winston-Churchill
  madeleine: { build: buildMadeleine, facing: 206 },  // vers la rue Royale / Concorde
  trocadero: { build: buildTrocadero, facing: 133.7 },// parvis ouvert vers la Tour Eiffel
};

export function createMonuments(ctx, opts = {}) {
  const { scene, camera, bus, LANDMARKS, heightAt, collision, store } = ctx;
  const q = ctx.quality || 'high';
  const kit = createKit(ctx);
  const lodDist = opts.lodDist ?? (q === 'low' ? 700 : q === 'medium' ? 1100 : 1500);
  const seg = q === 'low' ? 0.6 : q === 'medium' ? 0.8 : 1;
  const st = { night: 0, isNight: false, hour: 12, time: 0, sparkle: false, pxScale: 1000, camera };
  const items = new Map(), updaters = [];
  const noCollide = { box() {}, circle() {} };

  for (const l of LANDMARKS) {
    const def = DEFS[l.id];
    if (!def || (opts.only && opts.only !== l.id)) continue;
    const yaw = Math.PI - def.facing * DEG, y0 = heightAt(l.x, l.z), cs = Math.cos(yaw), sn = Math.sin(yaw);
    const root = new THREE.Group(); root.name = `monument:${l.id}`;
    root.position.set(l.x, y0, l.z); root.rotation.y = yaw;
    const toWorld = (x, z) => [l.x + x * cs + z * sn, l.z - x * sn + z * cs];
    const handles = [];
    const collide = {
      // coordonnées locales ; bottom/top relatifs au pied du monument
      box(x, z, hw, hd, ry = 0, bottom = -1e3, top = 1e4) { const [wx, wz] = toWorld(x, z); handles.push(collision.addBox({ x: wx, z: wz, hw, hd, rot: yaw + ry, bottom: y0 + bottom, top: y0 + top, tag: 'monument' })); },
      circle(x, z, r, bottom = -1e3, top = 1e4) { const [wx, wz] = toWorld(x, z); handles.push(collision.addCircle({ x: wx, z: wz, r, bottom: y0 + bottom, top: y0 + top, tag: 'monument' })); },
    };
    const item = { id: l.id, landmark: l, root, yaw, y0, levels: [], near: true, height: 50, collisions: handles, toWorld };
    for (const far of [false, true]) {
      const g = new THREE.Group(); g.name = far ? 'loin' : 'pres';
      const B = new Builder({ far, seg, seed: l.id.length * 131 + l.id.charCodeAt(0) });
      const m = {
        B, far, hi: !far, kit, quality: q, landmark: l, root,
        add: (o) => { g.add(o); return o; },
        collide: far ? noCollide : collide,
        onUpdate: (fn) => updaters.push({ fn, g, item }),
        // hauteur du terrain relative au pied du monument, en coordonnées locales
        ground: (x, z) => { const [wx, wz] = toWorld(x, z); return heightAt(wx, wz) - y0; },
      };
      const res = def.build(m) || {};
      if (res.height) item.height = res.height;
      for (const mesh of B.meshes(kit.main, l.id)) { mesh.castShadow = !far; mesh.receiveShadow = true; g.add(mesh); }
      g.visible = !far; root.add(g); item.levels.push(g);
    }
    scene.add(root); root.updateMatrixWorld(true);
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
      kit.uNight.value = st.night;
      // scintillement de la Tour Eiffel : 5 premières minutes de chaque heure de nuit
      st.sparkle = sparkleForce != null ? sparkleForce !== '0' : (st.hour - Math.floor(st.hour)) * 60 < 5;
      st.pxScale = (ctx.renderer?.domElement?.height || 720) / (2 * Math.tan((camera.fov || 60) * DEG / 2));
      // LOD (avec hystérésis)
      const cx = camera.position.x, cz = camera.position.z;
      for (const it of items.values()) {
        const d = Math.hypot(cx - it.landmark.x, cz - it.landmark.z);
        const near = d < lodDist * (it.near ? 1.06 : 0.94);
        if (near !== it.near) { it.near = near; it.levels[0].visible = near; it.levels[1].visible = !near; }
      }
      for (const u of updaters) u.fn(dt, st, u.g.visible);
    },
  };
}

// Téléo : téléphérique urbain de 3 km (Oncopole – hôpital Rangueil – université Paul-Sabatier).
// Stations, cinq pylônes aux hauteurs réelles, câbles, et cabines instanciées qui circulent réellement sur la ligne.
// Tout est placé d'après les relevés (latitude / longitude) ; l'ensemble reste affiché quelle que soit la distance
// (repère visible depuis la rocade sud) : il est donc construit une seule fois, hors bascule de LOD.
import * as THREE from 'three';
import { P, Builder } from '../kit.js';

const mk = (hex, r = 0.5, mt = 0.3, g = 0.6) => { const c = new THREE.Color(hex); return { c: [c.r, c.g, c.b], r, m: mt, t: 0, g }; };
const STATIONS = [['Université Paul-Sabatier', 43.56023, 1.46467], ['Hôpital Rangueil', 43.55833, 1.45293], ['Oncopole', 43.55430, 1.42827]];
const PYLONS = [[43.55995, 1.46287, 47], [43.55883, 1.45598, 63.5], [43.55799, 1.45086, 42.25], [43.55717, 1.44580, 30], [43.55517, 1.43357, 70.5]];   // P5 … P1
const SPEED = 6.5, NCAB = 14, GAUGE = 5.4, HST = 9;                         // vitesse (m/s), cabines, écartement des deux voies, hauteur du câble en station

function buildTeleo(m) {
  if (!m.far) return { height: 75 };                                        // tout est créé avec la version « lointaine » (toujours visible)
  const { kit } = m, B = new Builder({ far: false, seg: kit.quality === 'low' ? 0.6 : 1, seed: 7 });
  const white = mk(0xe9ebec, 0.4, 0.3, 0.9), steel = mk(0x9aa3a9, 0.45, 0.6), dark = mk(0x2c3136, 0.5, 0.4, 0.2);
  // points de passage du câble : station, pylônes, station… (x, y, z locaux)
  const node = (lat, lon, h) => { const [x, z] = m.ll(lat, lon); return new THREE.Vector3(x, m.ground(x, z) + h, z); };
  const st = STATIONS.map(([, la, lo]) => node(la, lo, HST)), py = PYLONS.map(([la, lo, h]) => node(la, lo, h));
  const path = [st[0], py[0], py[1], st[1], py[2], py[3], py[4], st[2]];
  // ---- stations ----
  st.forEach((p, i) => {
    const a = i === 0 ? path[1] : i === 1 ? path[2] : path[6], ry = Math.atan2(a.x - p.x, a.z - p.z), gy = p.y - HST;
    B.group(p.x, gy, p.z, ry, () => {
      B.box(P.beton, 16, 5 + 3, 34, 0, -3, 0); B.box(P.verreLit, 16.3, 2.6, 30, 0, 1.4, 0, 0, { jit: 0 });
      B.box(white, 19, 1.1, 40, 0, HST + 3.2, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl(steel, 0.4, 0.5, HST + 3.2, sx * 8.4, 0, sz * 17, 8);
      B.add(new THREE.CylinderGeometry(4.6, 4.6, 0.5, 20), steel, 0, HST + 1.2, -8, 0, { jit: 0 }); B.box(mk(0xb3261c, 0.5, 0.1, 1), 19.2, 0.5, 0.3, 0, HST + 3.5, 20, 0, { jit: 0 });
    });
    m.collide.box(p.x, p.z, 8.3, 17.3, ry, -100, gy + 6);
  });
  // ---- pylônes tubulaires, traverse en tête ----
  py.forEach((p, i) => {
    const h = PYLONS[i][2], prev = path[path.indexOf(p) - 1], next = path[path.indexOf(p) + 1], ry = Math.atan2(next.x - prev.x, next.z - prev.z), gy = p.y - h;
    B.cyl(white, 1.1, 2 + h * 0.012, h - 1, p.x, gy, p.z, 12); B.cyl(P.beton, 3.4, 3.6, 1.2, p.x, gy - 0.2, p.z, 12);
    B.box(white, GAUGE * 2 + 3, 1.3, 2.2, p.x, p.y - 1.4, p.z, ry); for (const sx of [-1, 1]) B.box(steel, 1.4, 0.8, 7, p.x + Math.cos(ry) * sx * GAUGE, p.y - 0.5, p.z - Math.sin(ry) * sx * GAUGE, ry, { jit: 0 });
    m.collide.circle(p.x, p.z, 3.4, -100, gy + 8);
  });
  for (const mesh of B.meshes(kit.main, 'tls_teleo')) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; m.root.add(mesh); }
  // ---- câbles : deux voies (3 câbles chacune, fondus en un ruban), en chaînette légère ----
  const segs = [], cum = [0];
  for (let i = 0; i < path.length - 1; i++) { segs.push(path[i].distanceTo(path[i + 1])); cum.push(cum[i] + segs[i]); }
  const LT = cum[cum.length - 1];
  const at = (s, out) => {                                                   // position sur la ligne à l'abscisse s (0..LT), flèche comprise
    let i = 0; while (i < segs.length - 1 && s > cum[i + 1]) i++;
    const t = Math.min(1, Math.max(0, (s - cum[i]) / segs[i])); out.lerpVectors(path[i], path[i + 1], t); out.y -= 4 * (segs[i] * 0.012) * t * (1 - t); return i;
  };
  const cp = [], ci = [], tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const side = (i) => { const d = tmp2.subVectors(path[i + 1], path[i]); const l = Math.hypot(d.x, d.z) || 1; return [d.z / l, -d.x / l]; };
  for (const off of [-GAUGE, GAUGE]) for (let i = 0; i < segs.length; i++) {
    const n = Math.max(2, Math.round(segs[i] / 60)), [sx, sz] = side(i), base = cp.length / 3;
    for (let k = 0; k <= n; k++) { at(cum[i] + segs[i] * k / n, tmp); for (const w of [-0.35, 0.35]) cp.push(tmp.x + sx * (off + w), tmp.y, tmp.z + sz * (off + w)); }
    for (let k = 0; k < n; k++) { const a = base + k * 2; ci.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cg.setIndex(ci); cg.computeVertexNormals();
  const cables = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0x2a2d31, side: THREE.DoubleSide })); cables.name = 'tls_teleo:cables'; cables.frustumCulled = false; m.root.add(cables);
  // ---- cabines instanciées (une boucle : aller sur une voie, retour sur l'autre) ----
  const CB = new Builder({ far: false, seed: 3 });
  CB.box(white, 2.8, 2.5, 3.6, 0, -3.9, 0, 0, { jit: 0 }); CB.box(mk(0x35505f, 0.12, 0.4, 2), 2.86, 1.25, 3.3, 0, -3.1, 0, 0, { jit: 0 }); CB.box(mk(0xb3261c, 0.5, 0.1, 1), 2.86, 0.4, 3.66, 0, -3.8, 0, 0, { jit: 0 });
  CB.box(steel, 0.25, 1.5, 0.25, 0, -1.5, 0, 0, { jit: 0 }); CB.box(dark, 1.6, 0.35, 1.9, 0, -0.1, 0, 0, { jit: 0 });
  const cabins = new THREE.InstancedMesh(CB.geometry(false), kit.main, NCAB); cabins.name = 'tls_teleo:cabines'; cabins.frustumCulled = false; cabins.castShadow = true; m.root.add(cabins);
  const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const place = (time) => {
    for (let c = 0; c < NCAB; c++) {
      let u = ((time * SPEED + c * 2 * LT / NCAB) % (2 * LT) + 2 * LT) % (2 * LT); const back = u > LT; if (back) u = 2 * LT - u;
      const i = at(u, tmp), [sx, sz] = side(i), off = back ? -GAUGE : GAUGE;
      tmp.x += sx * off; tmp.z += sz * off; q.setFromAxisAngle(UP, Math.atan2(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z)); mt.compose(tmp, q, one); cabins.setMatrixAt(c, mt);
    }
    cabins.instanceMatrix.needsUpdate = true;
  };
  place(0);
  m.onUpdate((dt, s) => place(s.time));
  return { height: 75 };
}

export const DEFS = { tls_teleo: buildTeleo };

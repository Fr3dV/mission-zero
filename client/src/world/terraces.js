// Terrasses de café : guéridons, chaises bistrot, bacs à buis, store banne au nom de l'établissement, guirlandes,
// ardoise-menu, et quelques clients attablés. Tout est instancié (6 draw calls au total), visible à courte distance.
// Les établissements viennent de pois.json (kind 'cafe' / 'restaurant') ; chaque terrasse est rattachée à la façade
// la plus proche, parallèle à elle, en laissant un passage côté chaussée.
import { Geo, createPropMaterial } from './props.js';
import { hash2 } from './util.js';

const VIEW = 125;

function tableGeo(THREE) {
  const g = new Geo();
  g.cyl(0, 0, 0, 0.03, 0.2, 0.2, 10, [0.05, 0.055, 0.05], 0, true);       // pied en fonte
  g.cyl(0, 0, 0.03, 0.7, 0.035, 0.03, 6, [0.05, 0.055, 0.05]);
  g.cyl(0, 0, 0.7, 0.715, 0.335, 0.335, 14, [0.62, 0.48, 0.2], 0, true);  // cerclage laiton
  g.cyl(0, 0, 0.715, 0.735, 0.32, 0.32, 14, [0.86, 0.85, 0.82], 0, true); // plateau de marbre
  return g.build(THREE);
}
function chairGeo(THREE) {
  // chaise bistrot en rotin tressé : damier deux tons sur l'assise et le dossier (la teinte d'instance donne la couleur)
  const g = new Geo(), A = [1, 1, 1], B = [0.36, 0.34, 0.3], W = [0.5, 0.36, 0.2];
  for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.19], [0.19, 0.19]]) g.box(x, 0.225, z, 0.03, 0.45, 0.03, W);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) g.box(-0.147 + i * 0.147, 0.465, -0.13 + j * 0.147, 0.145, 0.03, 0.145, (i + j) % 2 ? A : B);
  for (const x of [-0.2, 0.2]) g.box(x, 0.68, 0.2, 0.03, 0.46, 0.03, W);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) g.box(-0.147 + i * 0.147, 0.66 + j * 0.15, 0.2, 0.145, 0.148, 0.022, (i + j) % 2 ? B : A);
  g.box(0, 0.92, 0.2, 0.44, 0.035, 0.035, W);
  return g.build(THREE);
}
function planterGeo(THREE) {
  const g = new Geo();
  g.box(0, 0.24, 0, 1.25, 0.48, 0.42, [0.07, 0.075, 0.07], 0, true);
  g.box(0, 0.7, 0, 1.18, 0.46, 0.36, [0.07, 0.2, 0.08]);
  g.box(0, 0.95, 0, 1.0, 0.1, 0.26, [0.09, 0.26, 0.1]);
  return g.build(THREE);
}
function garlandGeo(THREE) {
  // 2 m de guirlande : fil + 5 ampoules (lueur nocturne) + un poteau fin
  const g = new Geo();
  g.box(0, 2.16, 0, 2.0, 0.012, 0.012, [0.03, 0.03, 0.03]);
  for (let i = 0; i < 5; i++) g.box(-0.8 + i * 0.4, 2.1, 0, 0.08, 0.1, 0.08, [1.0, 0.72, 0.36], 1);
  g.box(-1.0, 1.2, 0, 0.035, 2.4, 0.035, [0.04, 0.045, 0.04]);
  return g.build(THREE);
}
function boardGeo(THREE) {
  // ardoise-menu sur chevalet
  const g = new Geo();
  g.quad([-0.28, 0, -0.2], [0.28, 0, -0.2], [0.28, 0.95, 0], [-0.28, 0.95, 0], [0.03, 0.035, 0.03]);
  g.quad([0.28, 0, 0.2], [-0.28, 0, 0.2], [-0.28, 0.95, 0], [0.28, 0.95, 0], [0.03, 0.035, 0.03]);
  for (let i = 0; i < 5; i++) g.quad([-0.2, 0.25 + i * 0.13, -0.155 + i * 0.027], [0.12 + (i % 2) * 0.08, 0.25 + i * 0.13, -0.155 + i * 0.027], [0.12 + (i % 2) * 0.08, 0.29 + i * 0.13, -0.147 + i * 0.027], [-0.2, 0.29 + i * 0.13, -0.147 + i * 0.027], [0.8, 0.8, 0.76]);
  g.box(0, 0.97, 0, 0.6, 0.04, 0.06, [0.3, 0.2, 0.1]);
  return g.build(THREE);
}

const AWN = [['#7a1620', '#f3e7c8'], ['#14402a', '#f1e9cf'], ['#15254d', '#f0ead8'], ['#17181a', '#e9d9a8'], ['#6b3a12', '#f4ead0'], ['#8a1a1a', '#ffffff'], ['#2a4a5e', '#f0ead8']];
const TINT = [[0.75, 0.12, 0.12], [0.12, 0.38, 0.2], [0.14, 0.22, 0.5], [0.16, 0.16, 0.17], [0.62, 0.42, 0.18], [0.7, 0.2, 0.16], [0.2, 0.36, 0.46]];

export function buildTerraces(ctx, net, bld, river, masks, Q, uniforms) {
  const { THREE, scene, collision } = ctx;
  const heightAt = ctx.heightAt;
  const empty = { count: 0, seats: [], update() {}, sets: null };
  const list = Array.isArray(ctx.worldData.pois?.pois) ? ctx.worldData.pois.pois.filter((p) => p && (p.kind === 'cafe' || p.kind === 'restaurant') && Number.isFinite(p.x) && Number.isFinite(p.z)) : [];
  if (!list.length) return empty;
  const COLS = Q.maskSize >= 4096 ? 16 : 8, ROWS = 32, CW = 256, CH = 64, CAP = COLS * ROWS;
  const low = Q.texSize < 512;

  // ---------- 1. choix des emplacements
  const terr = [], used = new Map(), gk = (x, z) => (Math.floor(x / 13) + 2048) * 4096 + Math.floor(z / 13) + 2048;
  for (const p of list) {
    if (terr.length >= CAP) break;
    const np = net.nearestRoadPoint(p.x, p.z, { drivable: false });
    if (!np || np.dist > 32 || !np.road) continue;
    const r = np.road, dx = -Math.sin(np.yaw), dz = -Math.cos(np.yaw);
    const side = (p.x - np.x) * dz - (p.z - np.z) * dx >= 0 ? 1 : -1;
    const nx = side * dz, nz = -side * dx; // de la chaussée vers la façade
    // première façade rencontrée depuis le bord de chaussée
    const e0 = r._ped ? 0.5 : r._hw + 0.3;
    let df = -1;
    for (let t = 0; t < 26; t += 0.25) if (bld.inBuilding(np.x + nx * (e0 + t), np.z + nz * (e0 + t), 0)) { df = t; break; }
    if (df < 0) continue;
    const avail = r._ped ? Math.min(3.2, e0 + df + r._hw - 2.2) : df;          // profondeur de trottoir disponible
    if (avail < 2.5) continue;
    let rows = avail < 4 ? 1 : avail < 7.5 ? 2 : 3;
    while (rows > 1 && avail - (rows * 1.45 + 0.5) < 1.3) rows--;
    const fx = np.x + nx * (e0 + df), fz = np.z + nz * (e0 + df);                // pied de façade
    const h = hash2(Math.round(fx * 2), Math.round(fz * 2)), h2 = hash2(Math.round(fz * 3) + 7, Math.round(fx * 3));
    let width = (p.kind === 'restaurant' ? 5.5 : 4.2) + h * (rows > 1 ? 6 : 3.5);
    // la façade doit exister derrière toute la largeur, et rien ne doit gêner (chaussée, autre immeuble, eau, monument)
    const wallAt = (s) => bld.inBuilding(fx + dx * s + nx * 0.5, fz + dz * s + nz * 0.5, 0);
    while (width > 3.6 && !(wallAt(-width / 2) && wallAt(width / 2))) width -= 1;
    if (width <= 3.6) continue;
    const depth = rows * 1.45 + 0.35;
    let ok = true;
    for (const s of [-width / 2, 0, width / 2]) for (const d of [0.5, depth]) { const x = fx + dx * s - nx * d, z = fz + dz * s - nz * d; if (bld.inBuilding(x, z, 0.1) || (!r._ped && net.edgeDistance(x, z, false) < 0.9) || masks.isWater(x, z) || net.inZone(x, z)) ok = false; }
    if (!ok) continue;
    for (const l of ctx.LANDMARKS) if ((fx - l.x) ** 2 + (fz - l.z) ** 2 < (l.radius + 6) ** 2) ok = false;
    const key = gk(fx, fz); let near = false;
    for (let ix = -1; ix <= 1 && !near; ix++) for (let iz = -1; iz <= 1; iz++) { const a = used.get(gk(fx + ix * 13, fz + iz * 13)); if (a) for (const q of a) if ((q.fx - fx) ** 2 + (q.fz - fz) ** 2 < (q.width / 2 + width / 2 + 1.5) ** 2) { near = true; break; } }
    if (!ok || near) continue;
    const t = { name: (p.name || (p.kind === 'cafe' ? 'Café' : 'Restaurant')).slice(0, 26), kind: p.kind, fx, fz, nx, nz, dx, dz, width, rows, depth, y: heightAt(fx, fz) + (r._ped ? 0.01 : 0.11), style: Math.floor(h2 * AWN.length), id: terr.length, yaw: Math.atan2(-nx, -nz) /* face avant du mobilier vers la chaussée (-n) */ };
    t.yaw = Math.atan2(nx, nz);
    terr.push(t); let a = used.get(key); if (!a) used.set(key, (a = [])); a.push(t);
  }
  if (!terr.length) return empty;

  // ---------- 2. atlas des lambrequins (nom de l'établissement, répété le long du store)
  const cv = document.createElement('canvas'); cv.width = COLS * CW; cv.height = ROWS * CH;
  const g2 = cv.getContext('2d'); g2.textAlign = 'center'; g2.textBaseline = 'middle';
  terr.forEach((t, i) => {
    const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH, [bg, fg] = AWN[t.style];
    g2.fillStyle = bg; g2.fillRect(cx, cy, CW, CH);
    g2.fillStyle = fg; let fs = 30; const txt = t.name.toUpperCase();
    g2.font = `700 ${fs}px Georgia, 'Times New Roman', serif`;
    while (fs > 12 && g2.measureText(txt).width > CW - 44) { fs--; g2.font = `700 ${fs}px Georgia, 'Times New Roman', serif`; }
    g2.fillText(txt, cx + CW / 2 + 6, cy + CH / 2 + 1);
    t.cell = [i % COLS, ROWS - 1 - Math.floor(i / COLS)];
  });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(Q.aniso, ctx.renderer.capabilities.getMaxAnisotropy());

  // ---------- 3. instances
  const D = new THREE.Object3D(), C = new THREE.Color();
  const mk = (x, y, z, yaw, sx = 1, sy = 1, sz = 1) => { D.position.set(x, y, z); D.rotation.set(0, yaw, 0); D.scale.set(sx, sy, sz); D.updateMatrix(); return D.matrix.clone(); };
  const tables = [], chairs = [], chairCol = [], planters = [], garlands = [], boards = [], awn = [], awnCell = [], awnRep = [];
  const seats = [];
  for (const t of terr) {
    const { fx, fz, nx, nz, dx, dz, yaw } = t, tint = TINT[t.style];
    const cols = Math.max(1, Math.floor((t.width - 0.6) / 1.75));
    t.tables = [];
    for (let j = 0; j < t.rows; j++) for (let i = 0; i < cols; i++) {
      const s = (i - (cols - 1) / 2) * ((t.width - 0.9) / cols), d = 1.05 + j * 1.45;
      const x = fx + dx * s - nx * d, z = fz + dz * s - nz * d, y = heightAt(x, z) + (t.y - heightAt(fx, fz));
      const ti = tables.length; tables.push(mk(x, y, z, yaw)); if (t.t0 === undefined) t.t0 = ti; t.t1 = ti + 1;
      const ch = [];
      for (const o of [-0.42, 0.42]) { // deux chaises côté façade, tournées vers la rue
        const cx = x + dx * o + nx * 0.36, cz = z + dz * o + nz * 0.36;
        ch.push(chairs.length); chairs.push(mk(cx, y, cz, yaw)); chairCol.push(tint);
        seats.push({ x: cx, y, z: cz, yaw, t });
      }
      const data = { type: 'terrasse', x, y, z, ti, ch, broken: false };
      if (!low) collision.addCircle({ x, z, r: 0.5, top: y + 0.78, tag: 'terrasse', data }); // sous la hauteur testée par les piétons : seuls les véhicules la touchent
      t.tables.push(data);
    }
    // bacs à buis : côté rue et aux deux bouts
    const dOut = t.depth + 0.25, nP = Math.max(2, Math.round(t.width / 1.45));
    if (t.rows > 1 || t.style % 2 === 0) for (let i = 0; i < nP; i++) { if (i === Math.floor(nP / 2)) continue; const s = (i - (nP - 1) / 2) * (t.width / nP); planters.push(mk(fx + dx * s - nx * dOut, t.y, fz + dz * s - nz * dOut, yaw)); }
    for (const e of [-1, 1]) if (t.rows > 1) planters.push(mk(fx + dx * e * (t.width / 2 + 0.1) - nx * (t.depth * 0.5), t.y, fz + dz * e * (t.width / 2 + 0.1) - nz * (t.depth * 0.5), yaw + Math.PI / 2));
    // store banne (largeur × avancée) et guirlande sous son bord
    const out = Math.min(t.depth + 0.2, 3.6);
    awn.push(mk(fx - nx * 0.05, t.y, fz - nz * 0.05, yaw, t.width, 1, out)); awnCell.push(t.cell[0], t.cell[1]); awnRep.push(Math.max(1, Math.round(t.width / 2.4)));
    for (let s = -t.width / 2 + 1; s < t.width / 2 - 0.2; s += 2) garlands.push(mk(fx + dx * s - nx * (out + 0.05), t.y, fz + dz * s - nz * (out + 0.05), yaw));
    boards.push(mk(fx + dx * (t.width / 2 + 0.55) - nx * (t.depth * 0.8), t.y, fz + dz * (t.width / 2 + 0.55) - nz * (t.depth * 0.8), yaw + 0.5));
  }
  // matériau du mobilier : celui des accessoires (couleurs par sommet, ampoules allumées la nuit) + coupure à distance
  const mat = createPropMaterial(THREE, uniforms);
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh) => { base(sh); sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\nif (length(mvPosition.xyz) > ${VIEW.toFixed(1)}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`); };
  mat.customProgramCacheKey = () => 'mz-terrasse';
  const inst = (geo, mats, name, material = mat) => {
    const m = new THREE.InstancedMesh(geo, material, Math.max(1, mats.length)); m.count = mats.length;
    mats.forEach((mm, i) => m.setMatrixAt(i, mm));
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.castShadow = false; m.receiveShadow = true; m.name = name; m.visible = mats.length > 0;
    scene.add(m); return m;
  };
  let mTables = null, mChairs = null;
  const tGeo = tableGeo(THREE), cGeo = chairGeo(THREE);
  if (!low) {
    // tables et chaises : seules celles des terrasses proches sont envoyées au GPU (tampon d'instances réécrit quand la caméra bouge)
    mTables = new THREE.InstancedMesh(tGeo, mat, 700); mChairs = new THREE.InstancedMesh(cGeo, mat, 1400);
    for (const m of [mTables, mChairs]) { m.count = 0; m.frustumCulled = false; m.matrixAutoUpdate = false; m.receiveShadow = true; m.name = 'terrasse-mobilier'; scene.add(m); }
    mChairs.setColorAt(0, C.setRGB(1, 1, 1));
    inst(planterGeo(THREE), planters, 'terrasse-bacs');
    inst(garlandGeo(THREE), garlands, 'terrasse-guirlandes');
    inst(boardGeo(THREE), boards, 'terrasse-ardoises');
  }
  // stores : toile en pente (unie) + lambrequin (nom répété)
  const ag = new THREE.BufferGeometry();
  const P = [-0.5, 2.95, 0, 0.5, 2.95, 0, 0.5, 2.5, -1, -0.5, 2.5, -1, /* lambrequin */ -0.5, 2.2, -1, 0.5, 2.2, -1, 0.5, 2.5, -1, -0.5, 2.5, -1];
  ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  ag.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0.04, 1, 0.04, 1, 0.96, 0, 0.96]), 2));
  ag.setAttribute('aPlain', new THREE.BufferAttribute(new Float32Array([1, 1, 1, 1, 0, 0, 0, 0]), 1));
  ag.setIndex([0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7]);
  ag.computeVertexNormals();
  ag.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(awnCell), 2));
  ag.setAttribute('aRep', new THREE.InstancedBufferAttribute(new Float32Array(awnRep), 1));
  const amat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, side: THREE.DoubleSide });
  amat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCell;\nattribute float aRep;\nattribute float aPlain;\nvarying vec3 vAw;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAw = vec3(uv.x * aRep, uv.y, aPlain); vMapUv = aCell;')
      .replace('#include <project_vertex>', `#include <project_vertex>\nif (length(mvPosition.xyz) > ${(low ? 80 : VIEW + 40).toFixed(1)}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vAw;')
      .replace('#include <map_fragment>', `
{
  // toile unie = bord gauche de la case ; lambrequin = nom répété, avec feston découpé en bas
  vec2 cuv = vAw.z > 0.5 ? vec2(0.02, 0.5) : vec2(0.03 + 0.94 * (1.0 - fract(vAw.x)), vAw.y);
  if (vAw.z < 0.5 && vAw.y < 0.1 + 0.07 * abs(sin(vAw.x * 3.14159 * 7.0))) discard;
  vec4 tc = texture2D(map, (vMapUv + cuv) * vec2(${(1 / COLS).toFixed(6)}, ${(1 / ROWS).toFixed(6)}), vAw.z > 0.5 ? 0.0 : -0.5);
  diffuseColor *= tc;
}`);
  };
  amat.customProgramCacheKey = () => 'mz-store' + COLS + (low ? 'l' : '');
  inst(ag, awn, 'terrasse-stores', amat);

  const cam = ctx.camera.position;
  // ---------- 4. clients attablés : petit pool de personnages, seulement sur les terrasses proches
  const POOL = low ? 0 : 16, chars = [];
  let createCharacter = null, tAcc = 9, failed = false;
  if (POOL) import('../player/index.js').then((m) => { createCharacter = m.createCharacter; }).catch(() => { failed = true; });
  const hidden = new Uint8Array(tables.length); let instDirty = true, lcx = Infinity, lcz = Infinity;
  function refreshInst() {
    if (!mTables) return;
    let n = 0;
    for (const t of terr) {
      if (t.t0 === undefined || (t.fx - cam.x) ** 2 + (t.fz - cam.z) ** 2 > (VIEW + 20) ** 2) continue;
      for (let ti = t.t0; ti < t.t1 && n < 700; ti++) { if (hidden[ti]) continue; mTables.setMatrixAt(n, tables[ti]); for (let k = 0; k < 2; k++) { mChairs.setMatrixAt(n * 2 + k, chairs[ti * 2 + k]); const c = chairCol[ti * 2 + k]; mChairs.setColorAt(n * 2 + k, C.setRGB(c[0], c[1], c[2])); } n++; }
    }
    mTables.count = n; mChairs.count = n * 2; mTables.instanceMatrix.needsUpdate = mChairs.instanceMatrix.needsUpdate = true; mChairs.instanceColor.needsUpdate = true;
    instDirty = false; lcx = cam.x; lcz = cam.z;
  }
  const occupied = seats.filter((s, i) => hash2(i * 7 + 3, s.t.id * 13) < 0.42);
  const cand = [];
  function refresh() {
    cand.length = 0;
    for (const s of occupied) { if (s.t.gone) continue; const d = (s.x - cam.x) ** 2 + (s.z - cam.z) ** 2; if (d < 36 * 36 && !s.empty) cand.push([d, s]); }
    cand.sort((a, b) => a[0] - b[0]); cand.length = Math.min(cand.length, POOL);
    const want = new Set(cand.map((c) => c[1]));
    for (const c of chars) if (c.seat && !want.has(c.seat)) { c.seat = null; c.ch.group.visible = false; }
    for (const [, s] of cand) {
      if (chars.some((c) => c.seat === s)) continue;
      let c = chars.find((q) => !q.seat);
      if (!c) { if (chars.length >= POOL) break; const k = chars.length; const ch = createCharacter(ctx, { lod: true, shadow: false, name: 'terrasse' + k, gender: k % 2 ? 'f' : 'm' }); scene.add(ch.group); c = { ch, seat: null }; chars.push(c); }
      c.seat = s; c.ch.group.visible = true;
      c.ch.group.position.set(s.x, s.y - 0.04, s.z); c.ch.group.rotation.y = s.yaw;
      c.ch.setState?.({ anim: 'sit', speed: 0 });
    }
  }
  return {
    count: terr.length, tables: tables.length, chairs: chairs.length, seats, terr, mTables, mChairs, tGeo, cGeo, mat,
    clients: () => chars.filter((c) => c.seat).length, clientsFailed: () => failed,
    /** Une table renversée : ses clients s'en vont. */
    /** Table renversée (hide = true) ou remise en place : masque l'instance et libère ses chaises. */
    setBroken(data, hide) { hidden[data.ti] = hide ? 1 : 0; instDirty = true; for (const ci of data.ch) if (seats[ci]) seats[ci].empty = hide; tAcc = 9; },
    update(dt) {
      if (instDirty || Math.abs(cam.x - lcx) + Math.abs(cam.z - lcz) > 8) refreshInst();
      if (!POOL || !createCharacter) return;
      if ((tAcc += dt) > 0.7) { tAcc = 0; try { refresh(); } catch (e) { failed = true; createCharacter = null; console.warn('[ville] clients de terrasse désactivés', e); } }
      for (const c of chars) if (c.seat) c.ch.update?.(dt);
    },
  };
}

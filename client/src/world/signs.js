// Plaques de rue parisiennes (émail bleu, liseré vert) avec le vrai nom de la voie, posées sur les façades aux
// carrefours. Un atlas de texte (canvas) + un seul InstancedMesh ; les plaques ne sont dessinées qu'à courte distance.
export function buildSigns(ctx, net, bld, Q) {
  const { THREE, scene, heightAt } = ctx;
  if (Q.texSize < 512) return { count: 0, names: 0 }; // qualité basse : pas de plaques
  // --- noms retenus : les voies les plus longues d'abord
  const len = new Map();
  for (const r of net.roads) { const n = (r.name || '').trim(); if (n && n.length <= 34) len.set(n, (len.get(n) || 0) + r._len); }
  const COLS = Q.maskSize >= 4096 ? 16 : 8, ROWS = 32, CW = 256, CH = 64;
  const names = [...len.entries()].sort((a, b) => b[1] - a[1]).slice(0, COLS * ROWS).map((e) => e[0]);
  if (!names.length) return { count: 0, names: 0 };
  const cv = document.createElement('canvas'); cv.width = COLS * CW; cv.height = ROWS * CH;
  const g = cv.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const cellOf = new Map();
  names.forEach((name, i) => {
    const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
    cellOf.set(name, [i % COLS, ROWS - 1 - Math.floor(i / COLS)]);
    g.fillStyle = '#2f6b4c'; g.fillRect(cx, cy, CW, CH);                 // liseré vert
    g.fillStyle = '#e9eef5'; g.fillRect(cx + 5, cy + 5, CW - 10, CH - 10); // filet blanc
    g.fillStyle = '#1d3f8c'; g.fillRect(cx + 7, cy + 7, CW - 14, CH - 14); // émail bleu
    const sp = name.indexOf(' '), kind = sp > 0 ? name.slice(0, sp).toUpperCase() : '', rest = (sp > 0 ? name.slice(sp + 1) : name).toUpperCase();
    g.fillStyle = '#f4f6fa';
    g.font = '600 13px Helvetica, Arial, sans-serif'; g.fillText(kind, cx + CW / 2, cy + 19);
    let fs = 24; g.font = `700 ${fs}px Helvetica, Arial, sans-serif`;
    while (fs > 11 && g.measureText(rest).width > CW - 26) { fs--; g.font = `700 ${fs}px Helvetica, Arial, sans-serif`; }
    g.fillText(rest, cx + CW / 2, cy + 41);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(Q.aniso, ctx.renderer.capabilities.getMaxAnisotropy()); tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;

  // --- emplacements : aux extrémités des tronçons (carrefours), sur le premier mur rencontré de chaque côté
  const mats = [], cells = [], o = { _k: 0 };
  const dummy = new THREE.Object3D();
  const place = (r, s, sg, cell) => {
    net.pointAt(r, s, sg * (r._hw + Math.max(0.6, r._sw - 0.6)), o);
    // normale latérale (vers l'extérieur de la chaussée)
    const nx = sg * o.dz, nz = -sg * o.dx;
    let x = o.x, z = o.z, hit = false;
    for (let t = 0; t < 16; t += 0.25) { if (bld.inBuilding(x + nx * 0.25, z + nz * 0.25, 0)) { hit = true; break; } x += nx * 0.25; z += nz * 0.25; }
    if (!hit || net.edgeDistance(x, z, true) < 0.3) return;
    dummy.position.set(x - nx * 0.05, heightAt(x, z) + 3.25, z - nz * 0.05);
    dummy.rotation.set(0, Math.atan2(-nx, -nz), 0); dummy.updateMatrix();
    mats.push(dummy.matrix.clone()); cells.push(cell[0], cell[1]);
  };
  for (const r of net.roads) {
    const cell = cellOf.get((r.name || '').trim()); if (!cell) continue;
    for (const [s0, s1, cutA, cutB] of net.freeRuns(r)) {
      if (s1 - s0 < 14) continue;
      if (cutA || s0 < 0.01) for (const sg of [1, -1]) place(r, s0 + 5, sg, cell);
      if (cutB || s1 > r._len - 0.01) for (const sg of [1, -1]) place(r, s1 - 5, sg, cell);
    }
  }
  if (!mats.length) return { count: 0, names: names.length };
  const geo = new THREE.PlaneGeometry(0.92, 0.46);
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cells), 2));
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.1 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = (uv + aCell) * vec2(${(1 / COLS).toFixed(6)}, ${(1 / ROWS).toFixed(6)});`)
      .replace('#include <project_vertex>', `#include <project_vertex>\nif (length(mvPosition.xyz) > ${Q.detailLod[1] > 0 ? '130.0' : '70.0'}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
  };
  mat.customProgramCacheKey = () => 'mz-plaques' + COLS;
  const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.receiveShadow = true; mesh.name = 'plaques-de-rue';
  scene.add(mesh);
  return { count: mats.length, names: names.length, mesh };
}

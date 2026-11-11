// STUB — à remplacer par l'agent "ville" en gardant la signature.
export function createWorld(ctx) {
  const { THREE, scene, worldData, BOUNDS } = ctx;
  const g = new THREE.Mesh(new THREE.PlaneGeometry(BOUNDS.maxX - BOUNDS.minX + 2000, BOUNDS.maxZ - BOUNDS.minZ + 2000), new THREE.MeshStandardMaterial({ color: 0x6f7a6a }));
  g.rotation.x = -Math.PI / 2; g.position.set((BOUNDS.minX + BOUNDS.maxX) / 2, -0.05, (BOUNDS.minZ + BOUNDS.maxZ) / 2); scene.add(g);
  const mat = new THREE.MeshStandardMaterial({ color: 0x33363b });
  for (const r of worldData.roads) for (let i = 0; i < r.points.length - 1; i++) {
    const [ax, az] = r.points[i], [bx, bz] = r.points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.width, len), mat);
    m.rotation.set(-Math.PI / 2, 0, Math.atan2(bx - ax, bz - az) * -1, 'YXZ'); m.rotation.order = 'YXZ';
    m.rotation.y = Math.atan2(bx - ax, bz - az); m.rotation.x = -Math.PI / 2; m.rotation.z = 0;
    m.position.set((ax + bx) / 2, 0.02, (az + bz) / 2); scene.add(m);
  }
  return { update() {} };
}

// STUB — à remplacer par l'agent "monuments" en gardant la signature.
export function createMonuments(ctx) {
  const { THREE, scene, LANDMARKS, heightAt, collision } = ctx;
  for (const l of LANDMARKS) {
    const h = l.id === 'eiffel' ? 330 : 50;
    const m = new THREE.Mesh(new THREE.BoxGeometry(l.radius, h, l.radius), new THREE.MeshStandardMaterial({ color: 0xcbb994 }));
    m.position.set(l.x, heightAt(l.x, l.z) + h / 2, l.z); m.rotation.y = l.rot; scene.add(m);
    collision.addBox({ x: l.x, z: l.z, hw: l.radius / 2, hd: l.radius / 2, rot: l.rot, tag: 'monument' });
  }
  return { update() {} };
}

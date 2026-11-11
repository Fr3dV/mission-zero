// STUB — à remplacer par l'agent "environnement" en gardant la signature.
export function createEnvironment(ctx) {
  const { THREE, scene } = ctx;
  scene.background = new THREE.Color(0x9fc4e8);
  scene.fog = new THREE.Fog(0x9fc4e8, 400, 4500);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.2));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2); sun.position.set(300, 600, 200); scene.add(sun);
  return { sun, update() {}, setTimeOfDay(h) { ctx.store.timeOfDay = h; } };
}

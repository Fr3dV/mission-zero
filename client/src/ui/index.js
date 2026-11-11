// STUB — à remplacer par l'agent "interface" en gardant la signature.
export function createUI(ctx) {
  const { bus, store, uiRoot } = ctx;
  const hud = document.createElement('div');
  hud.style.cssText = 'position:absolute;top:12px;right:16px;color:#fff;font:600 20px system-ui;text-shadow:0 1px 3px #000';
  uiRoot.appendChild(hud);
  const draw = () => { hud.textContent = `Ƶ ${store.me.money.toLocaleString('fr-FR')}`; };
  bus.on('store:change', draw); draw();
  bus.on('boot:done', () => { if (!ctx.params.get('autostart')) bus.emit('intent:login', { name: 'Joueur', room: 'paris' }); });
  return { update() {} };
}

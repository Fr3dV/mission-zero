// Capture d'écran headless du jeu (utilise le Chrome installé, WebGL activé).
// Usage : node tools/shot.mjs <url> <sortie.png> [--wait 4000] [--w 1280] [--h 720]
//                              [--keys "KeyW:2000,KeyF:100"] [--pre "js avant les touches"] [--eval "js à exécuter avant la capture"]
// Affiche les erreurs console/page sur stdout. Code de sortie 1 s'il y a des erreurs JS.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const url = args[0], out = args[1] || 'tools/out/shot.png';
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const wait = +opt('wait', 4000), w = +opt('w', 1280), h = +opt('h', 720);
const keys = opt('keys', ''), ev = opt('eval', ''), pre = opt('pre', '');
if (!url) { console.error('url manquante'); process.exit(2); }

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); else if (m.type() === 'warning') console.log('warn:', m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(wait);
if (pre) { try { console.log('pre ->', JSON.stringify(await page.evaluate(pre))); } catch (e) { errors.push('pre: ' + e.message); } await page.waitForTimeout(300); }
for (const k of keys.split(',').filter(Boolean)) {
  const [code, ms] = k.split(':');
  await page.keyboard.down(code); await page.waitForTimeout(+ms || 100); await page.keyboard.up(code);
}
if (ev) { try { console.log('eval ->', JSON.stringify(await page.evaluate(ev))); } catch (e) { errors.push('eval: ' + e.message); } await page.waitForTimeout(500); }
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });
const fps = await page.evaluate(() => window.__game?.fps ?? null).catch(() => null);
console.log(`capture -> ${out}` + (fps != null ? `  (fps≈${Math.round(fps)})` : ''));
await browser.close();
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }

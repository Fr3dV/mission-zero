// Pré-compression des fichiers statiques — lancée au build de l'image (voir Dockerfile).
// Remplit le cache du serveur statique (STATIC_CACHE_DIR) : en production aucun fichier n'est compressé à la
// volée, le premier joueur ne paie rien, et les versions compressées vivent dans l'image (pas en mémoire).
// Usage : node server/precompress.js [--best] [--require-data]
//   --best          compression maximale (brotli 11, gzip 9) : ~1 Mo/s, réservée au build
//   --require-data  échoue si le fichier de routes d'une ville de shared/cities.js manque (seul fichier obligatoire)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createStatic, PREWARM, ROOT } from './static.js';
import { CITIES } from '../shared/cities.js';

const args = new Set(process.argv.slice(2));
const mo = (n) => (n / 1048576).toFixed(2) + ' Mo';

let missing = 0;
for (const city of Object.values(CITIES)) {
  for (const [kind, url] of Object.entries(city.files || {})) {
    if (!url || existsSync(join(ROOT, url))) continue;
    const required = kind === 'roads';
    console.warn(`[données] ${city.name} : ${url} absent${required ? ' (OBLIGATOIRE)' : ' (optionnel)'}`);
    if (required) missing++;
  }
}
if (missing && args.has('--require-data')) {
  console.error(`Données de ville manquantes : l'image serait incomplète. Vérifiez que shared/world/** est bien dans le contexte de build (.dockerignore, .gcloudignore, .gitignore).`);
  process.exit(1);
}

try {
  const serve = createStatic({ best: args.has('--best'), log: (m) => console.warn(m) });
  const r = await serve.prewarm(PREWARM);
  const s = serve.stats();
  console.log(`Pré-compression : ${r.files} fichiers, ${mo(r.bytes)} -> brotli ${mo(r.br)}, gzip ${mo(r.gzip)} en ${(r.ms / 1000).toFixed(1)} s (cache : ${s.disk === 'ok' ? s.cacheDir : 'indisponible'})`);
} catch (e) {
  // sans gravité : le serveur compressera à la demande
  console.warn(`Pré-compression interrompue : ${e.message}`);
}

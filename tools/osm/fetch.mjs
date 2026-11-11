// Télécharge les données brutes OpenStreetMap (API Overpass) sur l'emprise BBOX de shared/geo.js.
// Résultat mis en cache dans .data/osm/*.json (un fichier par couche / tuile). Relancer ne retélécharge
// que ce qui manque (option --force pour tout reprendre).
// Usage : node tools/osm/fetch.mjs [--force] [--only roads,water,green,buildings,trees,pois,paths,grass,bridges]
import { mkdirSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BBOX } from '../../shared/geo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.data', 'osm');
mkdirSync(CACHE, { recursive: true });
const FORCE = process.argv.includes('--force');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1].split(',') : null;

const MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const UA = 'osm-extract-script/1.0';
const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, label) {
  let lastErr;
  for (let attempt = 0; attempt < 12; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      // curl plutôt que fetch() de Node : certains miroirs refusent (403) les en-têtes du client HTTP de Node.
      const { stdout: text } = await run('curl', ['-sS', '--fail', '-m', '200', '-A', UA, '--data-urlencode', 'data=' + query, url], { maxBuffer: 1 << 30 });
      const json = JSON.parse(text);
      if (json.remark && /error|timed out/i.test(json.remark)) throw new Error('remark: ' + json.remark);
      console.log(`  ${label}: ${json.elements.length} éléments (${(text.length / 1e6).toFixed(1)} Mo) via ${new URL(url).host}`);
      return json;
    } catch (e) {
      lastErr = e;
      console.log(`  ${label}: échec (${String(e.message).trim().split('\n').pop()}) sur ${new URL(url).host}, nouvel essai…`);
      await sleep(4000 + attempt * 3000);
    }
  }
  throw lastErr;
}

async function layer(name, query) {
  const file = join(CACHE, name + '.json');
  if (existsSync(file) && !FORCE) { console.log(`  ${name}: en cache`); return; }
  const json = await overpass(query, name);
  writeFileSync(file + '.tmp', JSON.stringify(json));
  renameSync(file + '.tmp', file);
  await sleep(2500); // politesse envers le serveur
}

// Marge de ~150 m autour de la bbox pour que les rues / polygones ne s'arrêtent pas net au bord.
const M = 0.0015;
const bb = (b) => `(${b.minLat},${b.minLon},${b.maxLat},${b.maxLon})`;
const full = { minLat: BBOX.minLat - M, minLon: BBOX.minLon - M * 1.5, maxLat: BBOX.maxLat + M, maxLon: BBOX.maxLon + M * 1.5 };
const want = (n) => !ONLY || ONLY.includes(n);

if (want('roads')) {
  await layer('roads', `[out:json][timeout:180];
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|living_street|unclassified|pedestrian)$"]${bb(full)};
out body geom;`);
}
if (want('water')) {
  await layer('water', `[out:json][timeout:180];
(
  way["natural"="water"]${bb(full)};
  relation["natural"="water"]${bb(full)};
  way["waterway"="riverbank"]${bb(full)};
  relation["waterway"="riverbank"]${bb(full)};
  way["place"~"^(island|islet)$"]${bb(full)};
  relation["place"~"^(island|islet)$"]${bb(full)};
);
out body geom;`);
}
if (want('green')) {
  await layer('green', `[out:json][timeout:180];
(
  way["leisure"~"^(park|garden)$"]${bb(full)};
  relation["leisure"~"^(park|garden)$"]${bb(full)};
  way["highway"="pedestrian"]["area"="yes"]${bb(full)};
  relation["highway"="pedestrian"]${bb(full)};
  way["place"="square"]${bb(full)};
  relation["place"="square"]${bb(full)};
);
out body geom;`);
}
if (want('buildings')) {
  // Les bâtiments sont volumineux : découpage en tuiles NX × NZ (sur la bbox stricte, sans marge).
  const NX = 4, NY = 4;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    const t = {
      minLon: BBOX.minLon + ((BBOX.maxLon - BBOX.minLon) * i) / NX, maxLon: BBOX.minLon + ((BBOX.maxLon - BBOX.minLon) * (i + 1)) / NX,
      minLat: BBOX.minLat + ((BBOX.maxLat - BBOX.minLat) * j) / NY, maxLat: BBOX.minLat + ((BBOX.maxLat - BBOX.minLat) * (j + 1)) / NY,
    };
    await layer(`buildings_${i}_${j}`, `[out:json][timeout:180];
way["building"]${bb(t)};
out tags geom;`);
  }
  // Bâtiments multipolygones (cours intérieures) : une seule requête, avec la géométrie des membres.
  await layer('buildings_rel', `[out:json][timeout:240];
relation["building"]["type"="multipolygon"]${bb(BBOX)};
out body geom;`);
}

// ───── Contrat v3 « fidélité des lieux » : arbres, points d'intérêt, allées, pelouses, ponts ─────
if (want('trees')) {
  await layer('trees', `[out:json][timeout:180];
node["natural"="tree"]${bb(BBOX)};
out skel qt;`);
  await layer('treerows', `[out:json][timeout:120];
way["natural"="tree_row"]${bb(BBOX)};
out tags geom;`);
}
if (want('pois')) {
  await layer('pois', `[out:json][timeout:240];
(
  node["railway"="subway_entrance"]${bb(BBOX)};
  node["railway"="station"]${bb(full)};
  nwr["amenity"~"^(cafe|restaurant|bar|pharmacy|fountain|drinking_water|theatre|place_of_worship|school|bicycle_rental)$"]${bb(BBOX)};
  nwr["shop"~"^(bakery|kiosk|newsagent|books)$"]${bb(BBOX)};
  nwr["historic"~"^(memorial|monument)$"]${bb(BBOX)};
  nwr["tourism"~"^(artwork|museum|hotel)$"]${bb(BBOX)};
  node["highway"="bus_stop"]${bb(BBOX)};
);
out tags center;`);
  await layer('fountains', `[out:json][timeout:120];
way["amenity"="fountain"]${bb(BBOX)};
out tags geom;`);
}
if (want('paths')) {
  await layer('paths', `[out:json][timeout:240];
way["highway"~"^(footway|path|steps)$"]["footway"!~"^(sidewalk|crossing|traffic_island|link)$"]["tunnel"!~"."]["indoor"!~"."]${bb(BBOX)};
out tags geom;`);
}
if (want('grass')) {
  await layer('grass', `[out:json][timeout:180];
(
  way["landuse"~"^(grass|village_green)$"]${bb(BBOX)};
  relation["landuse"~"^(grass|village_green)$"]${bb(BBOX)};
);
out body geom;`);
}
if (want('bridges')) {
  await layer('bridges', `[out:json][timeout:120];
(
  way["man_made"="bridge"]${bb(full)};
  relation["man_made"="bridge"]${bb(full)};
);
out body geom;`);
}
console.log('Terminé. Cache :', CACHE);

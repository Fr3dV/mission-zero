// Téléchargements bruts pour une ville du contrat v5 (Toulouse) → cache .data/osm-<ville>/.
//   OSM (API Overpass) : routes, rails, eau, espaces verts, occupation du sol, points d'intérêt, arbres, chemins.
//   IGN Géoplateforme  : bâtiments BD TOPO (WFS), altimétrie RGE ALTI (WMS raster BIL 32 bits).
//   Toulouse Métropole : arbres d'alignement (open data), si disponible.
// Relancer ne retélécharge que ce qui manque (--force pour tout reprendre). --only a,b,c pour choisir.
// Usage : node tools/osm/fetch.mjs --city toulouse [--only roads,rails,water,green,landuse,pois,trees,paths,ign-buildings,dem,metro-trees]
import { BBOX, BOUNDS, lonLatToXZ, xzToLonLat, CITY_ID, curl, sleep, cached, saveCache, cachePath, argOpt, argFlag } from './common.mjs';

const FORCE = argFlag('force');
const ONLY = argOpt('only', null)?.split(',');
const want = (n) => !ONLY || ONLY.includes(n);
const MIRRORS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

async function overpass(query, label) {
  let last;
  for (let a = 0; a < 12; a++) {
    const url = MIRRORS[a % MIRRORS.length];
    try {
      const text = await curl(url, { post: { data: query }, timeout: 280 });
      const json = JSON.parse(text);
      if (json.remark && /error|timed out/i.test(json.remark)) throw new Error('remark: ' + json.remark);
      console.log(`  ${label}: ${json.elements.length} éléments (${(text.length / 1e6).toFixed(1)} Mo) via ${new URL(url).host}`);
      return text;
    } catch (e) { last = e; console.log(`  ${label}: échec (${String(e.message).trim().split('\n').pop().slice(0, 120)}) sur ${new URL(url).host}`); await sleep(3000 + a * 3000); }
  }
  throw last;
}
/** Une couche Overpass découpée en nx × ny tuiles. body(bb) = corps de la requête pour la bbox « (s,w,n,e) ». */
async function layer(name, nx, ny, body) {
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const file = nx * ny === 1 ? `${name}.json` : `${name}_${i}_${j}.json`;
    if (cached(file) && !FORCE) continue;
    const w = BBOX.minLon + ((BBOX.maxLon - BBOX.minLon) * i) / nx, e = BBOX.minLon + ((BBOX.maxLon - BBOX.minLon) * (i + 1)) / nx;
    const s = BBOX.minLat + ((BBOX.maxLat - BBOX.minLat) * j) / ny, n = BBOX.minLat + ((BBOX.maxLat - BBOX.minLat) * (j + 1)) / ny;
    const bb = `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`;
    saveCache(file, await overpass(`[out:json][timeout:240];\n${body(bb)}`, file.replace('.json', '')));
    await sleep(1500);
  }
}

if (want('roads')) {
  await layer('roads', 3, 3, (bb) => `way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|living_street|unclassified|pedestrian|busway)$"]${bb};\nout body geom;`);
  await layer('service', 3, 3, (bb) => `way["highway"="service"]["service"!~"^(driveway|parking_aisle|alley|drive-through|emergency_access|slipway)$"]["access"!~"^(private|no)$"]${bb};\nout body geom;`);
}
if (want('rails')) {
  await layer('rails', 1, 1, (bb) => `(way["railway"~"^(rail|tram|subway|light_rail)$"]${bb};way["aerialway"]${bb};node["aerialway"~"^(pylon|station)$"]${bb};);\nout body geom;`);
}
if (want('water')) {
  await layer('water', 2, 2, (bb) => `(way["natural"="water"]${bb};relation["natural"="water"]${bb};way["waterway"~"^(river|canal|stream|ditch|drain|riverbank|dock|weir|dam|lock_gate)$"]${bb};relation["waterway"="riverbank"]${bb};node["waterway"~"^(lock_gate|weir)$"]${bb};node["lock"="yes"]${bb};way["place"~"^(island|islet)$"]${bb};relation["place"~"^(island|islet)$"]${bb};);\nout body geom;`);
}
if (want('green')) {
  await layer('green', 2, 2, (bb) => `(way["leisure"~"^(park|garden|nature_reserve)$"]${bb};relation["leisure"~"^(park|garden|nature_reserve)$"]${bb};way["highway"="pedestrian"]["area"="yes"]${bb};relation["highway"="pedestrian"]${bb};way["place"="square"]${bb};relation["place"="square"]${bb};);\nout body geom;`);
}
if (want('landuse')) {
  await layer('landuse', 4, 4, (bb) => `(
  way["landuse"~"^(forest|farmland|meadow|orchard|vineyard|industrial|commercial|retail|residential|cemetery|railway|construction|grass|village_green|allotments|recreation_ground|military|quarry|brownfield|greenfield|plant_nursery)$"]${bb};
  relation["landuse"~"^(forest|farmland|meadow|orchard|vineyard|industrial|commercial|retail|residential|cemetery|railway|construction|grass|village_green|allotments|recreation_ground|military|quarry)$"]${bb};
  way["natural"~"^(wood|scrub|grassland|heath)$"]${bb};relation["natural"~"^(wood|scrub)$"]${bb};
  way["amenity"~"^(parking|school|university|college|hospital|grave_yard|marketplace|kindergarten)$"]${bb};relation["amenity"~"^(parking|school|university|college|hospital|grave_yard)$"]${bb};
  way["leisure"~"^(pitch|sports_centre|stadium|golf_course|track|playground|swimming_pool)$"]${bb};relation["leisure"~"^(pitch|sports_centre|stadium|golf_course)$"]${bb};
  way["aeroway"]${bb};relation["aeroway"]${bb};
);
out body geom;`);
}
if (want('pois')) {
  await layer('pois', 2, 2, (bb) => `(
  node["railway"~"^(subway_entrance|station|tram_stop|halt)$"]${bb};
  node["public_transport"="station"]${bb};
  nwr["amenity"~"^(cafe|restaurant|bar|pub|fast_food|pharmacy|fountain|drinking_water|theatre|cinema|place_of_worship|school|university|college|bicycle_rental|marketplace|townhall|hospital|fuel|post_office|bank|library|police|fire_station)$"]${bb};
  nwr["shop"~"^(bakery|kiosk|newsagent|supermarket|mall|department_store|convenience|butcher|florist)$"]${bb};
  nwr["historic"~"^(memorial|monument|castle|city_gate)$"]${bb};
  nwr["tourism"~"^(artwork|museum|hotel|attraction|viewpoint)$"]${bb};
  node["highway"="bus_stop"]${bb};
  node["waterway"="lock_gate"]${bb};nwr["lock"="yes"]${bb};
  node["man_made"~"^(water_tower|tower|chimney|mast|crane)$"]${bb};
  node["power"="tower"]${bb};
);
out tags center;`);
  await layer('fountains', 1, 1, (bb) => `way["amenity"="fountain"]${bb};\nout tags geom;`);
}
if (want('trees')) {
  await layer('trees', 2, 2, (bb) => `node["natural"="tree"]${bb};\nout skel qt;`);
  await layer('treerows', 1, 1, (bb) => `way["natural"="tree_row"]${bb};\nout tags geom;`);
}
if (want('paths')) {
  await layer('paths', 3, 3, (bb) => `way["highway"~"^(footway|path|steps|cycleway|track)$"]["footway"!~"^(sidewalk|crossing|traffic_island|link)$"]["tunnel"!~"."]["indoor"!~"."]${bb};\nout tags geom;`);
}

// ───────────────── IGN : bâtiments de la BD TOPO (WFS Géoplateforme, licence ouverte Etalab 2.0) ─────────────────
// Tuiles d'environ 1 km ; chaque tuile est stockée de façon compacte (emprises projetées, attributs utiles).
if (want('ign-buildings')) {
  const WFS = 'https://data.geopf.fr/wfs/ows';
  const PROPS = 'geometrie,nature,usage_1,usage_2,construction_legere,etat_de_l_objet,hauteur,nombre_d_etages,nombre_de_logements,materiaux_des_murs,materiaux_de_la_toiture,date_d_apparition,altitude_minimale_sol';
  const NX = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / 1000), NZ = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / 1000);
  let total = 0, done = 0;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
    const file = `ign_bat_${i}_${j}.json`;
    if (cached(file) && !FORCE) { done++; continue; }
    const x0 = BOUNDS.minX + ((BOUNDS.maxX - BOUNDS.minX) * i) / NX, x1 = BOUNDS.minX + ((BOUNDS.maxX - BOUNDS.minX) * (i + 1)) / NX;
    const z0 = BOUNDS.minZ + ((BOUNDS.maxZ - BOUNDS.minZ) * j) / NZ, z1 = BOUNDS.minZ + ((BOUNDS.maxZ - BOUNDS.minZ) * (j + 1)) / NZ;
    const [w, n] = xzToLonLat(x0, z0), [e, s] = xzToLonLat(x1, z1);
    const feats = [];
    for (let start = 0; ; start += 5000) {
      const url = `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment&SRSNAME=EPSG:4326&BBOX=${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)},urn:ogc:def:crs:EPSG::4326&OUTPUTFORMAT=application/json&PROPERTYNAME=${PROPS}&SORTBY=cleabs&COUNT=5000&STARTINDEX=${start}`;
      let json = null;
      for (let a = 0; a < 6 && !json; a++) { try { json = JSON.parse(await curl(url, { timeout: 120 })); } catch (err) { console.log(`  ${file}: échec (${String(err.message).trim().split('\n').pop().slice(0, 100)}), nouvel essai`); await sleep(3000 + a * 4000); } }
      if (!json) throw new Error('WFS injoignable pour ' + file);
      for (const f of json.features) {
        const p = f.properties, g = f.geometry; if (!g) continue;
        const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
        const rings = polys.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => { const [x, z] = lonLatToXZ(lon, lat); return [Math.round(x * 100) / 100, Math.round(z * 100) / 100]; })));
        feats.push({ id: f.id.replace('batiment.', ''), n: p.nature, u1: p.usage_1, u2: p.usage_2, lg: p.construction_legere ? 1 : 0, st: p.etat_de_l_objet, h: p.hauteur, e: p.nombre_d_etages, nl: p.nombre_de_logements, mm: p.materiaux_des_murs, mt: p.materiaux_de_la_toiture, d: (p.date_d_apparition || '').slice(0, 4), zs: p.altitude_minimale_sol, polys: rings });
      }
      if (json.features.length < 5000) break;
    }
    saveCache(file, { features: feats }); total += feats.length; done++;
    if (done % 10 === 0) console.log(`  ign-buildings: ${done}/${NX * NZ} tuiles, ${total} bâtiments téléchargés dans cette session`);
    await sleep(250);
  }
  console.log(`  ign-buildings: ${done}/${NX * NZ} tuiles en cache`);
}

// ───────────────── IGN : altimétrie RGE ALTI (WMS raster, BIL float32) ─────────────────
// Grille régulière en lon/lat = régulière dans le repère local (projection linéaire). Pas de 10 m, marge 400 m.
if (want('dem')) {
  const CELL = 10, MARGIN = 400, T = 500; // tuiles de 500 × 500 pixels
  const x0 = BOUNDS.minX - MARGIN, z0 = BOUNDS.minZ - MARGIN;
  const nx = Math.ceil((BOUNDS.maxX - BOUNDS.minX + 2 * MARGIN) / CELL) + 1, nz = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ + 2 * MARGIN) / CELL) + 1;
  if (!cached('dem.bin') || FORCE) {
    const data = new Float32Array(nx * nz);
    for (let tz = 0; tz < nz; tz += T) for (let tx = 0; tx < nx; tx += T) {
      const w = Math.min(T, nx - tx), h = Math.min(T, nz - tz);
      // le pixel (ix, iz) est centré sur le point (x0 + ix·CELL, z0 + iz·CELL) : la bbox déborde d'un demi-pixel
      const [lonW, latN] = xzToLonLat(x0 + (tx - 0.5) * CELL, z0 + (tz - 0.5) * CELL), [lonE, latS] = xzToLonLat(x0 + (tx + w - 0.5) * CELL, z0 + (tz + h - 0.5) * CELL);
      const url = `https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&STYLES=&FORMAT=image/x-bil;bits=32&CRS=EPSG:4326&BBOX=${latS},${lonW},${latN},${lonE}&WIDTH=${w}&HEIGHT=${h}`;
      let buf = null;
      for (let a = 0; a < 6 && !buf; a++) { try { const b = await curl(url, { binary: true, timeout: 120 }); if (b.length !== w * h * 4) throw new Error('taille inattendue ' + b.length); buf = b; } catch (err) { console.log('  dem: échec (' + String(err.message).slice(0, 100) + ')'); await sleep(3000 + a * 4000); } }
      if (!buf) throw new Error('altimétrie injoignable');
      const f = new Float32Array(buf.buffer, buf.byteOffset, w * h);
      for (let r = 0; r < h; r++) data.set(f.subarray(r * w, (r + 1) * w), (tz + r) * nx + tx);
      console.log(`  dem: tuile ${tx / T},${tz / T}`); await sleep(400);
    }
    saveCache('dem.bin', Buffer.from(data.buffer));
    saveCache('dem.json', { x0, z0, cell: CELL, nx, nz, source: 'IGN RGE ALTI (WMS ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES)' });
  }
  console.log(`  dem: ${nx} × ${nz} points en cache`);
}

// ───────────────── Toulouse Métropole : « Arbres urbains » (open data, Licence Ouverte 2.0) ─────────────────
if (want('metro-trees') && CITY_ID === 'toulouse') {
  if (!cached('metro_trees.json') || FORCE) {
    const url = 'https://data.toulouse-metropole.fr/api/explore/v2.1/catalog/datasets/arbres-urbains/exports/csv?select=longitude,latitude,genre,hauteur_approx_forestry&delimiter=%3B';
    try {
      const csv = await curl(url, { timeout: 280 });
      const rows = csv.split('\n').slice(1), trees = [];
      for (const row of rows) { const c = row.split(';'); const lon = parseFloat(c[0]), lat = parseFloat(c[1]); if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue; trees.push([lon, lat, (c[2] || '').replace(/"/g, '').trim(), parseFloat(c[3]) || 0]); }
      if (trees.length < 1000) throw new Error('réponse inattendue (' + trees.length + ' lignes)');
      saveCache('metro_trees.json', { source: 'Toulouse Métropole — Arbres urbains (Licence Ouverte 2.0)', trees });
      console.log(`  metro-trees: ${trees.length} arbres`);
    } catch (err) { console.log('  metro-trees: indisponible (' + String(err.message).slice(0, 120) + ') — on utilisera les arbres OSM'); }
  } else console.log('  metro-trees: en cache');
}
console.log('Terminé. Cache :', cachePath(''));

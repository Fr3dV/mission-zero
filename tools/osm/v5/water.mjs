// Eau (fleuve, lacs, canaux, ruisseaux), parcs et places d'une ville du contrat v5.
import { loadLayer, num, inBounds } from './common.mjs';
import { xz, CLIP, ringsOf, cleanPoly, perimeter, polyIndex } from './shapes.mjs';
import { r1, polyArea, centroid, pointInPoly, polylineLength, simplify, clipPolyline } from '../geom.mjs';
import { mergePieces } from './merge.mjs';

// Largeur (m) des cours d'eau connus, quand OSM ne la donne pas.
const WIDTHS = [[/canal du midi/i, 20], [/canal de brienne/i, 18], [/canal lat[ée]ral/i, 20], [/saint-martory/i, 6], [/touch/i, 14], [/hers/i, 12], [/saudrune/i, 6], [/sausse/i, 6], [/marcaissonne/i, 5], [/saune/i, 6], [/aussonnelle/i, 8], [/garonne/i, 120]];

export function buildWater(log = console.log) {
  const els = loadLayer('water');
  const big = [], narrow = [], small = [], islands = [], inners = [];
  for (const e of els) {
    const t = e.tags || {};
    if (t.place === 'island' || t.place === 'islet') { for (const o of ringsOf(e).outers) { const p = cleanPoly(o, 1.5); if (p && polyArea(p) >= 200) islands.push({ name: t.name || '', polygon: p }); } continue; }
    if (t.natural !== 'water' && t.waterway !== 'riverbank' && t.waterway !== 'dock') continue;
    if (t.location === 'underground' || t.covered === 'yes' || t.tunnel) continue;
    const kind = t.waterway === 'riverbank' ? 'river' : t.water || '';
    const { outers, inners: holes } = ringsOf(e);
    for (const o of outers) {
      const p = cleanPoly(o, kind === 'river' ? 2 : 1); if (!p) continue;
      const area = polyArea(p), mw = (2 * area) / perimeter(p); // largeur moyenne
      const item = { name: t.name || '', kind, polygon: p, area, meanWidth: mw };
      if (/^(river|canal|stream|ditch|drain|lock)$/.test(kind)) { if (mw >= (kind === 'river' ? 22 : 35) && area >= 3000) big.push(item); else narrow.push(item); }
      else if (area >= 400) big.push(item);
      else if (area >= 10 && kind !== 'wastewater') small.push(item);
    }
    if (kind === 'river') for (const h of holes) { const p = cleanPoly(h, 1.5); if (p && polyArea(p) >= 300) inners.push(p); }
  }
  // îles sans nom : trous du multipolygone du fleuve non couverts par une île nommée
  for (const p of inners) { const c = centroid(p); if (!islands.some((i) => pointInPoly(c[0], c[1], i.polygon))) islands.push({ name: '', polygon: p }); }
  big.sort((a, b) => b.area - a.area);
  const bigIdx = polyIndex(big), narrowIdx = polyIndex(narrow);

  // axes des cours d'eau
  const pieces = [], axesForLevels = []; let culverts = 0;
  for (const e of els) {
    const t = e.tags || {};
    if (e.type !== 'way' || !/^(river|canal|stream|ditch|drain)$/.test(t.waterway || '') || !e.geometry) continue;
    const pts = e.geometry.map((g, i) => { const [x, z] = xz(g); return { x, z, id: e.nodes[i] }; });
    if (t.tunnel && t.tunnel !== 'no') { culverts++; continue; }
    const name = t.name || '';
    if ((t.waterway === 'ditch' || t.waterway === 'drain') && !name) continue;
    const kind = t.waterway === 'canal' ? 'canal' : t.waterway === 'river' ? 'river' : 'stream';
    const aqueduct = t.bridge === 'aqueduct' || (kind === 'canal' && !!t.bridge && t.bridge !== 'no');
    let width = num(t.width); if (!(width >= 1 && width <= 300)) { const m = WIDTHS.find(([re]) => re.test(name)); width = m ? m[1] : kind === 'canal' ? 5 : kind === 'river' ? 8 : t.waterway === 'stream' ? 3 : 2; }
    for (const run of clipPolyline(pts, CLIP)) {
      if (kind !== 'stream') axesForLevels.push({ name: name || kind, aqueduct, width, points: simplify(run.map((p) => [p.x, p.z]), 1).map(([x, z]) => [r1(x), r1(z)]) });
      pieces.push({ name, kind, width, aqueduct, oneway: false, pts: run, parts: [] });
    }
  }
  const merged = mergePieces(pieces, (p) => [p.name, p.kind, p.width].join('|'), (p) => !p.name);
  const waterways = [];
  for (const w of merged) {
    // on ne garde que les portions hors des plans d'eau larges (qui sont dans river.polygons)
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        const pts = simplify(run, 1.2).map(([x, z]) => [r1(x), r1(z)]);
        if (polylineLength(pts) >= 30) { const mid = pts[pts.length >> 1], np = narrowIdx.find(mid[0], mid[1]); const width = np && np.meanWidth >= 2 ? Math.min(60, r1(np.meanWidth)) : w.width; waterways.push({ name: w.name, kind: w.kind, width, points: pts }); }
      }
      run = [];
    };
    for (const p of w.pts) { if (bigIdx.find(p.x, p.z)) flush(); else run.push([p.x, p.z]); }
    flush();
  }
  const kinds = waterways.reduce((a, w) => ((a[w.kind] = (a[w.kind] || 0) + 1), a), {});
  log(`eau : ${big.length} plans d'eau larges (${(big.reduce((s, b) => s + b.area, 0) / 1e4).toFixed(0)} ha), ${islands.length} îles (${islands.filter((i) => i.name).map((i) => i.name).join(', ')}), ${waterways.length} cours d'eau ${JSON.stringify(kinds)} (${(waterways.reduce((s, w) => s + polylineLength(w.points), 0) / 1000).toFixed(0)} km), ${culverts} tronçons busés ignorés, ${axesForLevels.filter((a) => a.aqueduct).length} ponts-canaux`);
  return { polygons: big.map((b) => b.polygon), bigInfo: big, islands, waterways, axesForLevels, smallWater: small.map(({ name, polygon }) => ({ name, polygon })), narrowPolys: narrow };
}

export function buildGreen(log = console.log) {
  const parks = [], plazas = [];
  for (const e of loadLayer('green')) {
    const t = e.tags || {};
    if (t.access === 'private' || t.access === 'no' || t.access === 'customers') continue;
    if (t.tunnel || t.location === 'underground' || t.indoor === 'yes' || num(t.layer) < 0 || num(t.level) < 0) continue;
    const isPark = t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'nature_reserve';
    const isPlaza = !isPark && (t.highway === 'pedestrian' || t.place === 'square');
    if (!isPark && !isPlaza) continue;
    const name = t.name || '';
    for (const o of ringsOf(e).outers) {
      const p = cleanPoly(o, 1.5); if (!p) continue;
      const area = polyArea(p);
      if (isPark) { if (area >= (name ? 3000 : 6000)) parks.push({ name, polygon: p, area }); } else if (area >= (name ? 800 : 4000)) plazas.push({ name, polygon: p, area });
    }
  }
  const dedupe = (list) => {
    list.sort((a, b) => b.area - a.area);
    const out = [];
    for (const it of list) { const [cx, cz] = centroid(it.polygon); if (out.some((o) => pointInPoly(cx, cz, o.polygon) && pointInPoly(it.polygon[0][0], it.polygon[0][1], o.polygon))) continue; out.push(it); }
    return out.map(({ name, polygon }) => ({ name, polygon }));
  };
  const res = { parks: dedupe(parks), plazas: dedupe(plazas) };
  log(`parcs : ${res.parks.length}, places : ${res.plazas.length}`);
  return res;
}

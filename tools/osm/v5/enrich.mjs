// Champs « fidélité » des routes (contrats v3 et v5) pour une ville v5 : largeur de façade à façade mesurée sur
// les emprises de la BD TOPO, trottoir, terre-plein, arbres d'alignement, revêtement, vitesse, voies bus/vélo.
import { CITY_ID, loadLayer } from './common.mjs';
import { loadTrees, xz } from './shapes.mjs';
import { polylineLength, distPointSeg, r1 } from '../geom.mjs';

// Largeur TOTALE de chaussée (m) des grands axes, de mémoire (± 2 à 3 m). Pour un axe cartographié en deux
// chaussées séparées, chaque chaussée reçoit la moitié.
const MANUAL = {
  toulouse: [
    [/^Boulevard de Strasbourg$/, 16], [/^Boulevard (Lazare )?Carnot$/, 16], [/^Boulevard Lascrosses$/, 16], [/^Boulevard d'Arcole$/, 14],
    [/^Boulevard Armand Duportal$/, 14], [/^Boulevard de la Marquette$/, 10], [/^Boulevard de l'Embouchure$/, 10], [/^Boulevard des Minimes$/, 10],
    [/^Boulevard (Pierre[- ]Paul )?Riquet$/, 12], [/^Boulevard Bonrepos$/, 10], [/^Boulevard de la Gare$/, 12], [/^Boulevard Matabiau$/, 10],
    [/^Boulevard (du Maréchal )?Leclerc$/, 14], [/^Boulevard des Récollets$/, 14], [/^Boulevard Déodat de Séverac$/, 14], [/^Boulevard Jean Brunhes$/, 14],
    [/^Boulevard Silvio Trentin$/, 14], [/^Boulevard de Suisse$/, 12], [/^Boulevard Koenigs$/, 12], [/^Boulevard Monplaisir$/, 9], [/^Boulevard Griffoul[- ]Dorval$/, 9],
    [/^Allées Jean Jaurès$/, 14], [/^Allées Charles de Fitte$/, 14], [/^Allées Jules Guesde$/, 14], [/^Allées? Paul Sabatier$/, 10], [/^Allées Frédéric Mistral$/, 10],
    [/^Allées? François Verdier$/, 14], [/^Allées? Forain[- ]François Verdier$/, 14], [/^Allées? de Brienne$/, 9], [/^Allées? de Barcelone$/, 9], [/^Allées Paul Feuga$/, 12],
    [/^Rue de Metz$/, 8], [/^Rue d'Alsace[- ]Lorraine$/, 9], [/^Rue de la République$/, 9], [/^Rue du Languedoc$/, 9], [/^Rue Ozenne$/, 9], [/^Rue de Rémusat$/, 8], [/^Rue Bayard$/, 9],
    [/^Avenue de Grande[- ]Bretagne$/, 14], [/^Route d'Espagne$/, 14], [/^Avenue de Muret$/, 12], [/^Avenue Étienne Billières$/, 12], [/^Avenue Honoré Serres$/, 12],
    [/^Avenue des États[- ]Unis$/, 14], [/^Avenue des Minimes$/, 12], [/^Avenue de Lyon$/, 10], [/^Avenue Camille Pujol$/, 9], [/^Avenue Jean Rieux$/, 9],
    [/^Grande Rue Saint[- ]Michel$/, 9], [/^Avenue de l'U\.?R\.?S\.?S\.?$/, 9], [/^Avenue Crampel$/, 9], [/^Avenue Paul Séjourné$/, 12], [/^Avenue de Lombez$/, 12],
    [/^Avenue de Lardenne$/, 10], [/^Avenue Saint[- ]Exupéry$/, 10], [/^Avenue de Castres$/, 10], [/^Route de Narbonne$/, 12], [/^Avenue du Général Eisenhower$/, 14],
    [/^Avenue Édouard Belin$/, 12], [/^Route de Revel$/, 10], [/^Avenue de Fronton$/, 10], [/^Route de Launaguet$/, 9], [/^Avenue de Toulouse$/, 10], [/^Route de Bayonne$/, 12],
    [/^Pont Neuf$/, 12], [/^Pont Saint[- ]Michel$/, 16], [/^Pont des Catalans$/, 14], [/^Pont Saint[- ]Pierre$/, 8], [/^Pont (Pierre[- ]de[- ])?Coubertin$/, 14],
  ],
};
const SPEED = { motorway: 110, trunk: 90, link: 50, primary: 50, secondary: 50, tertiary: 50, residential: 30, unclassified: 50, living_street: 20, service: 20, busway: 50, connector: 30 };
const SW_CAP = { residential: 2.5, living_street: 2, unclassified: 2.5, service: 2, tertiary: 3.5, secondary: 7, primary: 7 };
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

export function enrichRoads(roads, footprints, water, log = console.log) {
  const stats = {}; const inc = (k) => { stats[k] = (stats[k] || 0) + 1; };
  const manual = MANUAL[CITY_ID] || [];
  // murs : tous les anneaux des emprises BD TOPO (hors constructions légères), grille de 20 m
  const G = 20, walls = new Map();
  if (footprints) for (const b of footprints) {
    if (b.lg || (b.h !== null && b.h !== undefined && b.h < 2.2)) continue;
    for (const poly of b.polys) { const o = poly[0]; for (let i = 0; i + 1 < o.length; i++) { const p = o[i], q = o[i + 1];
      for (let gx = Math.floor(Math.min(p[0], q[0]) / G); gx <= Math.floor(Math.max(p[0], q[0]) / G); gx++) for (let gz = Math.floor(Math.min(p[1], q[1]) / G); gz <= Math.floor(Math.max(p[1], q[1]) / G); gz++) { const k = gx * 100003 + gz; let c = walls.get(k); if (!c) walls.set(k, (c = [])); c.push(p[0], p[1], q[0], q[1]); } } }
  }
  const RAY = 60;
  const cast = (x, z, dx, dz) => {
    let best = Infinity; const seen = new Set();
    for (let s = 0; s <= RAY + G; s += G / 2) {
      const k = Math.floor((x + dx * s) / G) * 100003 + Math.floor((z + dz * s) / G); if (seen.has(k)) continue; seen.add(k);
      const c = walls.get(k); if (c) for (let i = 0; i < c.length; i += 4) {
        const ex = c[i + 2] - c[i], ez = c[i + 3] - c[i + 1], den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
        const t = ((c[i] - x) * ez - (c[i + 1] - z) * ex) / den, u = ((c[i] - x) * dz - (c[i + 1] - z) * dx) / den;
        if (t > 0.3 && t < best && u >= 0 && u <= 1) best = t;
      }
      if (best < s - G) break;
    }
    return best <= RAY ? best : Infinity;
  };
  // arbres + alignements
  const TG = 20, tgrid = new Map(); let nT = 0;
  const addTree = (x, z) => { const k = Math.floor(x / TG) * 100003 + Math.floor(z / TG); let c = tgrid.get(k); if (!c) tgrid.set(k, (c = [])); c.push(x, z, nT++); };
  const trees = loadTrees(); for (const [x, z] of trees.list) addTree(x, z);
  for (const e of loadLayer('treerows')) { if (!e.geometry) continue; const p = e.geometry.map(xz); for (let i = 1; i < p.length; i++) { const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]), n = Math.max(1, Math.round(L / 8)); for (let k = 0; k < n; k++) addTree(p[i - 1][0] + ((p[i][0] - p[i - 1][0]) * k) / n, p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * k) / n); } }
  stats.treesUsed = nT;
  const twins = new Map();
  for (const o of roads) { const r = o._r; if (r.oneway && r.name && !r.roundabout && !r.service && (r.kind === 'avenue' || r.kind === 'boulevard' || r.kind === 'quay' || /^(primary|secondary|tertiary)$/.test(r.hw))) { if (!twins.has(r.name)) twins.set(r.name, []); twins.get(r.name).push(o); } }

  for (const o of roads) {
    const r = o._r, a = r.a || {}, hw = r.cls === 'link' ? 'link' : r.hw;
    const fast = r.kind === 'motorway' || r.kind === 'trunk' || r.kind === 'ramp';
    const plain = fast || r.service || r.busway || r.roundabout || r.uturn; // pas de mesure de façade
    const len = polylineLength(o.points);
    const samples = [];
    { const n = Math.max(1, Math.floor(len / 10)); let acc = 0, next = len / n / 2;
      for (let i = 1; i < o.points.length; i++) { const [ax, az] = o.points[i - 1], [bx, bz] = o.points[i], L = Math.hypot(bx - ax, bz - az); if (L < 1e-6) continue; while (next <= acc + L) { const t = (next - acc) / L; samples.push([ax + (bx - ax) * t, az + (bz - az) * t, (bx - ax) / L, (bz - az) / L]); next += len / n; } acc += L; } }
    let twinGap = 0;
    if (!plain && r.oneway && r.name && !r.bridge && !r.tunnel && twins.get(r.name)?.includes(o)) {
      const gaps = [];
      for (const [x, z, tx, tz] of samples) { let bd = Infinity; for (const p of twins.get(r.name) || []) { if (p === o) continue; for (let i = 1; i < p.points.length; i++) { const u = p.points[i - 1], v = p.points[i], L = Math.hypot(v[0] - u[0], v[1] - u[1]); if (L < 1e-6 || ((v[0] - u[0]) * tx + (v[1] - u[1]) * tz) / L > -0.6) continue; const d = distPointSeg(x, z, u[0], u[1], v[0], v[1]); if (d < bd) bd = d; } } if (bd >= 4 && bd <= 45) gaps.push(bd); }
      if (len >= 40 && gaps.length >= Math.max(3, samples.length * 0.7)) twinGap = median(gaps);
    }
    let dL = Infinity, dR = Infinity;
    if (footprints && !plain && !r.bridge && !r.tunnel && len >= 12) {
      const L = [], R = [];
      for (const [x, z, tx, tz] of samples) { const l = cast(x, z, tz, -tx), rr = cast(x, z, -tz, tx); if (l < Infinity) L.push(l); if (rr < Infinity) R.push(rr); }
      if (L.length >= samples.length * 0.5) dL = median(L);
      if (R.length >= samples.length * 0.5) dR = median(R);
    }
    const both = dL < Infinity && dR < Infinity, facade = both ? dL + dR : 0;
    const centred = both && Math.abs(dL - dR) < 0.3 * facade;
    // ── largeur de chaussée
    let width = o.width, src = a.widthSrc || 'default';
    if (!plain && r.kind !== 'pedestrian') {
      const man = manual.find(([re]) => re.test(r.name));
      if (man && (twinGap || r.lanes >= 2 || centred || !r.oneway)) { const w = twinGap ? man[1] / 2 : man[1]; if (!facade || w <= facade - 3) { width = w; src = 'manual'; } }
    }
    if (src !== 'tag' && src !== 'manual' && both && !twinGap) {
      if (r.kind === 'pedestrian') { if (facade <= 16) { width = Math.max(2.5, facade - 0.6); src = 'facade'; } } // rue piétonne du centre : pavée de mur à mur
      else if (width > facade - 2.4) { width = Math.max(2.5, facade - 2.4); src = 'facade'; } // rue étroite : la chaussée ne dépasse pas l'espace entre façades
    }
    o.width = r1(width); inc('width_' + src);
    // ── trottoir
    if (!plain && r.kind !== 'pedestrian' && a.sidewalkTag !== 'no') {
      const cap = src === 'manual' ? 15 : r.kind === 'avenue' || r.kind === 'boulevard' || r.kind === 'quay' ? 7 : SW_CAP[hw] || 2.5;
      let sw = 0, how = '';
      if (twinGap && Math.min(dL, dR) < Infinity) { sw = Math.min(dL, dR) - width / 2; how = 'facade'; }
      else if (both) { sw = centred || src === 'manual' ? (facade - width) / 2 : Math.min(dL, dR) - width / 2; how = 'facade'; }
      else if (Math.min(dL, dR) < Infinity) { sw = Math.min(dL, dR) - width / 2; how = 'facade1'; }
      else if (a.sidewalkTag === 'yes' || /^(residential|living_street|tertiary|secondary|primary)$/.test(hw)) { sw = hw === 'residential' || hw === 'living_street' ? 1.5 : 2; how = 'default'; }
      if (how) { o.sidewalk = r1(Math.max(0.5, Math.min(cap, sw))); inc('sidewalk_' + how); }
    }
    if (facade) { o.facadeWidth = r1(facade); inc('facadeWidth'); }
    if (twinGap) { o.median = r1(Math.max(0, twinGap - width)); inc('median'); }
    // ── arbres d'alignement
    { const lo = Math.max(1.5, width / 2 - 1.5), hi = Math.min(30, facade ? Math.max(dL, dR) + 1 : twinGap ? twinGap + width / 2 + 8 : width / 2 + 8);
      const found = new Set();
      if (!r.tunnel && !r.uturn) for (const [x, z, tx, tz] of samples) for (let gx = Math.floor((x - hi) / TG); gx <= Math.floor((x + hi) / TG); gx++) for (let gz = Math.floor((z - hi) / TG); gz <= Math.floor((z + hi) / TG); gz++) { const c = tgrid.get(gx * 100003 + gz); if (c) for (let i = 0; i < c.length; i += 3) { if (found.has(c[i + 2])) continue; const along = (c[i] - x) * tx + (c[i + 1] - z) * tz, across = Math.abs(-(c[i] - x) * tz + (c[i + 1] - z) * tx); if (Math.abs(along) <= 6 && across >= lo && across <= hi) found.add(c[i + 2]); } }
      o.treeLined = r.kind !== 'pedestrian' && !r.bridge && len >= 40 && found.size / (len / 100) >= 5;
      if (o.treeLined) inc('treeLined');
    }
    if (a.surface) { o.surface = a.surface; inc('surface'); }
    if (r.kind !== 'pedestrian') { o.maxspeed = a.maxspeed || (r.roundabout ? 30 : SPEED[hw] || 50); inc(a.maxspeed ? 'maxspeed_tag' : 'maxspeed_default'); }
    if (a.busLane) { o.busLane = true; inc('busLane'); }
    if (a.cycleway) { o.cycleway = a.cycleway; inc('cycleway'); }
    if (r.bridge) { const bn = a.bridgeName || (/^(Pont|Passerelle|Viaduc)/.test(r.name) ? r.name : ''); if (bn) { o.bridgeName = bn; inc('bridgeName'); } }
  }
  stats.treeSources = trees.sources;
  return stats;
}

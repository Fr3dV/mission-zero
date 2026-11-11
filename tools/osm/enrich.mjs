// Enrichissement « fidélité des lieux » (contrat v3) : largeur de façade à façade, trottoirs, terre-pleins,
// alignements d'arbres, revêtement, vitesse, nom des ponts — et métadonnées des bâtiments.
import { pointInPoly, polylineLength, distPointSeg, r1 } from './geom.mjs';

// Largeur TOTALE de chaussée (m) des grands axes, d'après les profils en travers connus (valeurs approchées,
// ± 2 m). Utilisée quand OSM ne porte pas de tag width. Pour un axe cartographié en deux chaussées séparées,
// chaque chaussée reçoit la moitié.
export const MANUAL_WIDTHS = [
  [/^Avenue des Champs-Élysées$/, 27], [/^Avenue Foch$/, 28], [/^Avenue de la Grande Armée$/i, 26], [/^Avenue de l'Opéra$/, 18],
  [/^Rue de Rivoli$/, 12], [/^Rue Royale$/, 14], [/^Rue de la Paix$/, 12], [/^Rue La Fayette$/, 12], [/^Rue de Rennes$/, 13],
  [/^Boulevard (des Capucines|des Italiens|Montmartre|Poissonnière|de Bonne Nouvelle|de la Madeleine|Saint-Denis|Saint-Martin)$/, 19],
  [/^Boulevard Haussmann$/, 16], [/^Boulevard Saint-Germain$/, 16], [/^Boulevard Saint-Michel$/, 16], [/^Boulevard de Sébastopol$/, 16],
  [/^Boulevard de Strasbourg$/, 16], [/^Boulevard de Magenta$/, 16], [/^Boulevard Malesherbes$/, 18], [/^Boulevard Raspail$/, 16],
  [/^Boulevard du Montparnasse$/, 18], [/^Boulevard des Invalides$/, 16], [/^Boulevard de Courcelles$/, 16], [/^Boulevard des Batignolles$/, 16],
  [/^Boulevard de Clichy$/, 16], [/^Boulevard (de Rochechouart|Marguerite de Rochechouart)$/, 16], [/^Boulevard de la Tour-Maubourg$/, 14], [/^Boulevard de Grenelle$/, 20],
  [/^Boulevard du Palais$/, 14], [/^Boulevard Pereire$/, 14],
  [/^Avenue d'Iéna$/, 16], [/^Avenue Kléber$/, 18], [/^Avenue Marceau$/, 16], [/^Avenue Montaigne$/, 14], [/^Avenue George V$/, 16],
  [/^Avenue de Friedland$/, 18], [/^Avenue de Wagram$/, 16], [/^Avenue Hoche$/, 16], [/^Avenue Victor Hugo$/, 14], [/^Avenue Bosquet$/, 14],
  [/^Avenue de la Bourdonnais$/i, 14], [/^Avenue Rapp$/, 14], [/^Avenue de Suffren$/, 14], [/^Avenue de la Motte-Picquet$/, 16], [/^Avenue de Breteuil$/, 14],
  [/^Avenue Carnot$/, 14], [/^Avenue Mac-Mahon$/, 16], [/^Avenue Niel$/, 14], [/^Avenue de Villiers$/, 16], [/^Avenue des Ternes$/, 16],
  [/^Avenue Franklin D\. Roosevelt$/i, 16], [/^Avenue Matignon$/, 14], [/^Avenue de Messine$/, 14], [/^Avenue du Président Wilson$/, 18],
  [/^Avenue Winston Churchill$/, 20], [/^Avenue de Tourville$/, 14], [/^Avenue Duquesne$/, 14], [/^Avenue de Ségur$/, 14], [/^Avenue de Saxe$/, 14],
  [/^Avenue de New York$/i, 14], [/^Cours la Reine$/, 14], [/^Cours Albert 1er$/i, 14],
  [/^Quai (d'Orsay|Anatole France|Voltaire|Malaquais|de Conti|des Grands Augustins|Saint-Michel|de Montebello|de la Tournelle|Branly|Jacques Chirac|François Mitterrand|du Louvre|de la Mégisserie|de Gesvres|de l'Hôtel de Ville|des Célestins|des Tuileries|Aimé Césaire)$/, 13],
];

function segGrid(G) {
  const m = new Map();
  return {
    add(a, b, v) { // segment a-b : inscrit dans toutes les cellules de sa boîte englobante
      for (let gx = Math.floor(Math.min(a[0], b[0]) / G); gx <= Math.floor(Math.max(a[0], b[0]) / G); gx++) for (let gz = Math.floor(Math.min(a[1], b[1]) / G); gz <= Math.floor(Math.max(a[1], b[1]) / G); gz++) {
        const k = gx + ',' + gz; if (!m.has(k)) m.set(k, []); m.get(k).push([a[0], a[1], b[0], b[1], v]);
      }
    },
    cell(gx, gz) { return m.get(gx + ',' + gz) || []; },
    G,
  };
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

export function enrichRoads(roads, footprints, load) {
  const stats = { roads: roads.length };
  // ── façades : tous les murs des emprises OSM (anneaux extérieurs), indexés dans une grille de 20 m
  const walls = segGrid(20);
  if (footprints) for (const it of footprints) {
    const t = it.tags; if (t.building === 'roof' || t.building === 'no' || t.location === 'underground') continue;
    const o = it.outer; for (let i = 0; i < o.length; i++) walls.add(o[i], o[(i + 1) % o.length], 0);
  }
  const RAY = 70;
  // distance du point (x,z) au premier mur rencontré dans la direction (dx,dz) ; Infinity si rien avant RAY
  const cast = (x, z, dx, dz) => {
    let best = Infinity; const G = walls.G, seen = new Set();
    for (let s = 0; s <= RAY + G; s += G / 2) {
      const gx = Math.floor((x + dx * s) / G), gz = Math.floor((z + dz * s) / G), k = gx + ',' + gz;
      if (seen.has(k)) continue; seen.add(k);
      for (const [ax, az, bx, bz] of walls.cell(gx, gz)) {
        const ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - x) * ez - (az - z) * ex) / den, u = ((ax - x) * dz - (az - z) * dx) / den;
        if (t > 0.3 && t < best && u >= 0 && u <= 1) best = t;
      }
      if (best < s - G) break;
    }
    return best <= RAY ? best : Infinity;
  };
  // ── arbres (points + alignements échantillonnés) dans une grille de 20 m
  const TG = 20, tgrid = new Map(); let nTrees = 0;
  const addTree = (x, z) => { const k = Math.floor(x / TG) + ',' + Math.floor(z / TG); if (!tgrid.has(k)) tgrid.set(k, []); tgrid.get(k).push([x, z, nTrees++]); };
  for (const e of load('trees')) addTree(...e.xz);
  for (const e of load('treerows')) { const p = e.pts; for (let i = 1; i < p.length; i++) { const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]), n = Math.max(1, Math.round(L / 8)); for (let k = 0; k < n; k++) addTree(p[i - 1][0] + ((p[i][0] - p[i - 1][0]) * k) / n, p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * k) / n); } }
  // ── chaussées jumelles : échantillons des routes à sens unique, par nom
  const twins = new Map();
  for (const r of roads) if (r.oneway && r.name && r.kind !== 'pedestrian') { if (!twins.has(r.name)) twins.set(r.name, []); twins.get(r.name).push(r); }
  const bridges = load('bridges');

  for (const r of roads) {
    const a = r._a || {}; delete r._a;
    const len = polylineLength(r.points);
    // échantillons le long de l'axe : [x, z, tx, tz] tous les 8 m (au moins 1, au milieu)
    const samples = [];
    { const n = Math.max(1, Math.floor(len / 8)); let acc = 0, next = len / n / 2;
      for (let i = 1; i < r.points.length; i++) {
        const [ax, az] = r.points[i - 1], [bx, bz] = r.points[i], L = Math.hypot(bx - ax, bz - az); if (L < 1e-6) continue;
        while (next <= acc + L) { const t = (next - acc) / L; samples.push([ax + (bx - ax) * t, az + (bz - az) * t, (bx - ax) / L, (bz - az) / L]); next += len / n; }
        acc += L;
      } }
    // ── chaussée jumelle (même nom, sens unique, à peu près antiparallèle, à 4–60 m) → terre-plein
    let twinGap = 0;
    if (r.oneway && r.name && r.kind !== 'pedestrian' && !r.bridge) {
      const gaps = [];
      for (const [x, z, tx, tz] of samples) {
        let bd = Infinity;
        for (const o of twins.get(r.name) || []) { if (o === r) continue;
          for (let i = 1; i < o.points.length; i++) { const p = o.points[i - 1], q = o.points[i]; const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 1e-6) continue;
            if (((q[0] - p[0]) * tx + (q[1] - p[1]) * tz) / L > -0.6) continue;
            const d = distPointSeg(x, z, p[0], p[1], q[0], q[1]); if (d < bd) bd = d; } }
        if (bd >= 4 && bd <= 60) gaps.push(bd);
      }
      if (gaps.length >= Math.max(2, samples.length * 0.6)) twinGap = median(gaps);
    }
    // ── façade à façade
    let dL = Infinity, dR = Infinity;
    if (footprints && !r.bridge && len >= 12) {
      const L = [], R = [];
      for (const [x, z, tx, tz] of samples) { const l = cast(x, z, tz, -tx), rr = cast(x, z, -tz, tx); if (l < Infinity) L.push(l); if (rr < Infinity) R.push(rr); }
      if (L.length >= samples.length * 0.5) dL = median(L);
      if (R.length >= samples.length * 0.5) dR = median(R);
    }
    const both = dL < Infinity && dR < Infinity;
    const facade = both ? dL + dR : 0;
    // ── largeur de chaussée
    let width = r.width, src = a.widthSrc || 'default';
    const centred = both && Math.abs(dL - dR) < 0.3 * facade; // l'axe est au milieu de la rue (pas une contre-allée)
    if (r.kind !== 'pedestrian') { // la table manuelle prime aussi sur le tag width (souvent limité aux seules voies auto)
      const man = MANUAL_WIDTHS.find(([re]) => re.test(r.name));
      if (man && (twinGap || r.lanes >= 3 || (both && (facade <= 45 || Math.abs(dL - dR) < 0.45 * facade)))) { // exclut les contre-allées des très larges avenues
        const w = twinGap ? man[1] / 2 : man[1];
        if (!facade || w <= facade - 4) { width = w; src = 'manual'; }
      }
    }
    if (src !== 'tag' && src !== 'manual' && both && !twinGap) {
      if (r.kind === 'pedestrian') { if (facade <= 14) { width = Math.max(2.5, facade - 0.6); src = 'facade'; } } // rue piétonne : pavée de mur à mur
      else if (centred && facade >= 8 && facade <= 45) {
        // Profil parisien type : la chaussée (stationnement et bandes cyclables compris) occupe environ 55 % de
        // l'espace entre façades (rue de 12 m : 7 m ; 20 m : 11 m ; 30 m : 16,5 m), jamais moins que les voies OSM.
        const w = Math.min(facade - 2.4, Math.max(width, 0.55 * facade));
        if (Math.abs(w - width) > 0.05) { width = w; src = 'facade'; }
      } else if (width > facade - 2.4) { width = Math.max(2.5, facade - 2.4); src = 'facade'; } // la chaussée ne peut pas dépasser l'espace entre façades
    }
    if (src !== 'tag' && twinGap && Math.min(dL, dR) < Infinity && width / 2 > Math.min(dL, dR) - 1.2) { width = Math.max(2.5, (Math.min(dL, dR) - 1.2) * 2); src = 'facade'; }
    r.width = r1(width);
    // ── trottoir
    let sidewalk = 0, swSrc = '';
    if (a.sidewalkTag) { sidewalk = a.sidewalkTag; swSrc = 'tag'; }
    else if (r.kind === 'pedestrian') { /* pas de trottoir */ }
    else if (twinGap && Math.min(dL, dR) < Infinity) { sidewalk = Math.min(dL, dR) - width / 2; swSrc = 'facade'; }
    else if (both) { sidewalk = centred || src === 'manual' ? (facade - width) / 2 : Math.min(dL, dR) - width / 2; swSrc = 'facade'; } // axe excentré (place, contre-allée) : trottoir du côté le plus proche
    else if (Math.min(dL, dR) < Infinity) { sidewalk = Math.min(dL, dR) - width / 2; swSrc = 'facade1'; }
    if (swSrc) { r.sidewalk = r1(Math.max(0.5, Math.min(swSrc === 'facade1' ? 8 : 25, sidewalk))); stats['sidewalk_' + swSrc] = (stats['sidewalk_' + swSrc] || 0) + 1; }
    if (facade) { r.facadeWidth = r1(facade); stats.facadeWidth = (stats.facadeWidth || 0) + 1; }
    if (twinGap) { r.median = r1(Math.max(0, twinGap - width)); stats.median = (stats.median || 0) + 1; }
    stats['width_' + src] = (stats['width_' + src] || 0) + 1;
    // ── arbres d'alignement : arbres situés entre le bord de chaussée et la façade (ou 9 m au-delà du bord)
    { const lo = Math.max(1.5, width / 2 - 1.5), hi = Math.min(45, facade ? Math.max(dL, dR) + 1 : twinGap ? twinGap + width / 2 + 9 : width / 2 + 9);
      const found = new Set();
      for (const [x, z, tx, tz] of samples) for (let gx = Math.floor((x - hi) / TG); gx <= Math.floor((x + hi) / TG); gx++) for (let gz = Math.floor((z - hi) / TG); gz <= Math.floor((z + hi) / TG); gz++) for (const [px, pz, id] of tgrid.get(gx + ',' + gz) || []) {
        if (found.has(id)) continue;
        const along = (px - x) * tx + (pz - z) * tz, across = Math.abs(-(px - x) * tz + (pz - z) * tx);
        if (Math.abs(along) <= 5 && across >= lo && across <= hi) found.add(id);
      }
      const density = len > 0 ? found.size / (len / 100) : 0;
      r.treeLined = r.kind !== 'pedestrian' && !r.bridge && len >= 40 && density >= 5;
      if (r.treeLined) stats.treeLined = (stats.treeLined || 0) + 1;
    }
    if (a.surface) { r.surface = a.surface; stats.surface = (stats.surface || 0) + 1; }
    if (a.maxspeed) { r.maxspeed = a.maxspeed; stats.maxspeed = (stats.maxspeed || 0) + 1; }
    if (r.bridge) {
      let bn = a.bridgeName || (/^(Pont|Passerelle|Viaduc|Petit-Pont)/.test(r.name) ? r.name : '');
      if (!bn) { const m = r.points[r.points.length >> 1], m2 = [(r.points[0][0] + r.points[r.points.length - 1][0]) / 2, (r.points[0][1] + r.points[r.points.length - 1][1]) / 2];
        const hit = bridges.find((b) => b.name && b.rings.some((p) => pointInPoly(m[0], m[1], p) || pointInPoly(m2[0], m2[1], p))); if (hit) bn = hit.name; }
      if (bn) { r.bridgeName = bn; stats.bridgeName = (stats.bridgeName || 0) + 1; }
      stats.bridges = (stats.bridges || 0) + 1;
    }
  }
  return stats;
}

// Métadonnées de bâtiments, alignées sur l'ordre de buildings.json. rects[i][7] = emprise OSM d'origine.
export const BUILDING_KINDS = ['', 'church', 'train_station', 'school', 'civic', 'retail', 'hotel', 'museum', 'theatre', 'hospital', 'office'];
export const ROOF_SHAPES = ['', 'flat', 'mansard', 'gabled', 'hipped', 'dome', 'pyramidal', 'skillion', 'round', 'onion', 'gambrel'];
const NAMED = { white: 'ffffff', black: '222222', grey: '808080', gray: '808080', red: 'b03a2e', brown: '7b5b3a', beige: 'd9cdb4', yellow: 'e3c565', cream: 'efe6d0', blue: '4a6fa5', green: '4f7f52', orange: 'd9843b', pink: 'e3b7b0', silver: 'c0c0c0', sandstone: 'd8c9a3', limestone: 'e4dcc8' };
export function buildingsMeta(rects) {
  const byIndex = {}; const n = { kind: 0, roof: 0, colour: 0 };
  rects.forEach((rc, i) => {
    const t = rc[7]?.tags; if (!t) return;
    const b = t.building || '';
    let kind = '';
    if (/^(church|cathedral|chapel|basilica|temple|synagogue|mosque)$/.test(b) || t.amenity === 'place_of_worship') kind = 'church';
    else if (b === 'train_station' || t.railway === 'station') kind = 'train_station';
    else if (/^(school|university|college|kindergarten)$/.test(b) || /^(school|university|college)$/.test(t.amenity || '')) kind = 'school';
    else if (/^(civic|government|public|townhall)$/.test(b) || /^(townhall|courthouse|embassy|police)$/.test(t.amenity || '') || t.office === 'government') kind = 'civic';
    else if (b === 'hotel' || t.tourism === 'hotel') kind = 'hotel';
    else if (b === 'museum' || t.tourism === 'museum') kind = 'museum';
    else if (b === 'theatre' || t.amenity === 'theatre') kind = 'theatre';
    else if (b === 'hospital' || t.amenity === 'hospital') kind = 'hospital';
    else if (/^(retail|commercial|supermarket)$/.test(b) || t.shop === 'department_store' || t.shop === 'mall') kind = 'retail';
    else if (b === 'office') kind = 'office';
    const roof = ROOF_SHAPES.indexOf(t['roof:shape'] || ''); const lv = Math.round(parseFloat(t['building:levels'])) || 0;
    let col = (t['building:colour'] || t['building:color'] || '').toLowerCase().trim();
    col = /^#[0-9a-f]{6}$/.test(col) ? col.slice(1) : /^#[0-9a-f]{3}$/.test(col) ? col.slice(1).replace(/./g, '$&$&') : NAMED[col] || '';
    if (!kind && roof <= 0 && !col) return;
    if (kind) n.kind++; if (roof > 0) n.roof++; if (col) n.colour++;
    const e = [BUILDING_KINDS.indexOf(kind), lv, Math.max(0, roof)]; if (col) e.push('#' + col);
    byIndex[i] = e;
  });
  return { byIndex, counts: n };
}

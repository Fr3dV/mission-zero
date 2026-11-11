// Réseaux d'essai du module trafic (page client/debug/traffic.html, ?net=test | ?net=big).
// Même format que shared/world/<ville>/roads.json : graphe ORIENTÉ (une arête par sens), graph.nodeEle,
// routes kind motorway / ramp / avenue / street / pedestrian avec maxspeed, roundabout, ele, lanes.

/**
 * Petit réseau à niveaux superposés :
 *  - une voie rapide 2 × 3 voies à 110 km/h, sinueuse, de x = −1500 à +1500, bouclée par deux raquettes ;
 *  - une avenue nord-sud qui la franchit par un pont (ele +6,5 m), avec un échangeur en losange (4 bretelles) ;
 *  - au sud, un giratoire à quatre branches ; au nord, un quartier pavillonnaire (30 km/h), un parking,
 *    une rue piétonne et une place.
 */
export function makeTestNet() {
  const nodes = [], nodeEle = [], edges = [], roads = [];
  const key = new Map();
  const node = (x, z, ele = 0) => {
    const k = Math.round(x * 10) + ',' + Math.round(z * 10) + ',' + Math.round(ele);
    let i = key.get(k);
    if (i === undefined) { i = nodes.length; nodes.push([+x.toFixed(1), +z.toFixed(1)]); nodeEle.push(+ele.toFixed(2)); key.set(k, i); }
    return i;
  };
  let rid = 0;
  /** Ajoute une route et ses arêtes (dans le sens des points ; les deux sens si !oneway). */
  const road = (props, pts, ele) => {
    const id = ++rid;
    roads.push({ id, name: props.name || 'Route ' + id, kind: 'street', width: 6, lanes: 2, oneway: false, bridge: false, ...props, points: pts.map((p) => [+p[0].toFixed(1), +p[1].toFixed(1)]), ...(ele ? { ele } : {}) });
    if (props.kind === 'pedestrian') return id;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = node(pts[i][0], pts[i][1], ele ? ele[i] : 0), b = node(pts[i + 1][0], pts[i + 1][1], ele ? ele[i + 1] : 0);
      edges.push([a, b, id]);
      if (!props.oneway) edges.push([b, a, id]);
    }
    return id;
  };

  // ---- voie rapide : axe sinueux, chaussée est (vers +X) au sud de l'axe, chaussée ouest au nord
  const mz = (x) => 60 * Math.sin(x / 700);
  const MW = { kind: 'motorway', width: 10.5, lanes: 3, oneway: true, maxspeed: 110, ref: 'A0' };
  const east = [], west = [];
  for (let x = -1500; x <= 1500; x += 50) { east.push([x, mz(x) + 7.5]); west.unshift([x, mz(x) - 7.5]); }
  // les bretelles se raccordent sur des nœuds de la voie rapide : on coupe les chaussées en tronçons à x = ±250
  const cut = (pts, xs) => { const out = [[]]; for (const p of pts) { out[out.length - 1].push(p); if (xs.includes(p[0]) && out[out.length - 1].length > 1) out.push([p]); } return out.filter((a) => a.length > 1); };
  for (const part of cut(east, [-250, 250])) road({ ...MW, name: 'Rocade (vers l\'est)' }, part);
  for (const part of cut(west, [250, -250])) road({ ...MW, name: 'Rocade (vers l\'ouest)' }, part);
  // raquettes de retournement aux deux bouts (pour que le réseau soit fortement connexe)
  const loop = (cx, sgn) => {
    const cz = mz(cx - sgn * 100), pts = [[cx - sgn * 100, cz + sgn * 7.5], [cx - sgn * 40, cz + sgn * 40]];
    for (let a = 70; a >= -70; a -= 20) pts.push([cx + sgn * 55 * Math.cos((a * Math.PI) / 180), cz + sgn * 55 * Math.sin((a * Math.PI) / 180)]);
    pts.push([cx - sgn * 40, cz - sgn * 40], [cx - sgn * 100, cz - sgn * 7.5]);
    road({ ...MW, maxspeed: 50, name: 'Raquette' }, pts);
  };
  loop(1600, 1); loop(-1600, -1);

  // ---- avenue nord-sud, en pont au-dessus de la voie rapide (rampes à 8 %)
  const av = [], avEle = [];
  for (let z = -300; z <= 260; z += 20) { av.push([0, z]); const d = Math.abs(z - mz(0)); avEle.push(d <= 40 ? 6.5 : d >= 120 ? 0 : 6.5 * (120 - d) / 80); }
  road({ kind: 'avenue', name: 'Avenue du Pont', width: 9, lanes: 2, maxspeed: 50, bridge: true, bridgeName: 'Pont de l\'échangeur' }, av, avEle);

  // ---- échangeur en losange : quatre bretelles à sens unique, raccordées à l'avenue là où elle est au sol
  const RAMP = { kind: 'ramp', width: 4.5, lanes: 1, oneway: true, maxspeed: 70 };
  const bez = (a, b, c, d, n = 8) => { const out = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]]); } return out; };
  const E = (x) => [x, mz(x) + 7.5], W = (x) => [x, mz(x) - 7.5];
  road({ ...RAMP, name: 'Sortie vers le sud' }, bez(E(-250), [-150, mz(-150) + 16], [-60, 125], [0, 140]));     // quitte la chaussée est
  road({ ...RAMP, name: 'Entrée vers l\'est' }, bez([0, 140], [60, 125], [150, mz(150) + 16], E(250)));          // rejoint la chaussée est
  road({ ...RAMP, name: 'Sortie vers le nord' }, bez(W(250), [150, mz(150) - 16], [60, -125], [0, -140]));       // quitte la chaussée ouest
  road({ ...RAMP, name: 'Entrée vers l\'ouest' }, bez([0, -140], [-60, -125], [-150, mz(-150) - 16], W(-250)));  // rejoint la chaussée ouest

  // ---- giratoire au sud (anneau à sens unique, sens inverse des aiguilles d'une montre vu de dessus)
  const RC = [0, 300], RR = 20, ring = [];
  for (let k = 0; k <= 16; k++) { const a = -Math.PI / 2 - (k / 16) * Math.PI * 2; ring.push([RC[0] + RR * Math.cos(a), RC[1] + RR * Math.sin(a)]); }
  // l'avenue arrive sur le sommet nord de l'anneau
  road({ kind: 'avenue', name: 'Avenue du Pont', width: 9, lanes: 2, maxspeed: 50 }, [[0, 260], ring[0]]);
  road({ kind: 'street', name: 'Giratoire', width: 7.5, lanes: 2, oneway: true, roundabout: true, maxspeed: 30 }, ring);
  road({ kind: 'street', name: 'Rue de l\'Est', width: 7, lanes: 2, maxspeed: 50 }, [ring[12], [120, 300], [320, 300]]);
  road({ kind: 'street', name: 'Rue du Sud', width: 7, lanes: 2, maxspeed: 50 }, [ring[8], [0, 420], [0, 560]]);
  road({ kind: 'street', name: 'Rue de l\'Ouest', width: 7, lanes: 2, maxspeed: 50 }, [ring[4], [-120, 300], [-320, 300]]);

  // ---- quartier pavillonnaire au nord (rues étroites à 30 km/h)
  for (const z of [-300, -380, -460]) road({ kind: 'street', name: 'Rue des Pavillons ' + -z, width: 6, lanes: 2, maxspeed: 30 }, [[-240, z], [-160, z], [-80, z], [0, z], [80, z], [160, z], [240, z]]);
  for (const x of [-240, -160, -80, 0, 80, 160, 240]) road({ kind: 'street', name: 'Allée ' + x, width: 5.5, lanes: 2, maxspeed: 30 }, [[x, -300], [x, -380], [x, -460]]);
  // rue piétonne (hors graphe) et place
  road({ kind: 'pedestrian', name: 'Rue piétonne', width: 8, lanes: 0 }, [[20, -280], [60, -250], [140, -240], [220, -260]]);

  const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  return {
    meta: { source: 'essai', graphDirected: true, note: 'réseau d\'essai du module trafic (échangeur, pont, giratoire)' },
    roads, graph: { nodes, edges, nodeEle },
    river: { polygons: [] }, parks: [], plazas: [{ name: 'Place d\'essai', polygon: rect(100, -230, 180, -150) }],
    rails: [{ kind: 'tram', name: 'T1', points: [[-320, 330], [-120, 330], [-30, 345], [0, 420], [10, 560]] }],
    pois: {
      areas: [
        { kind: 'residential', name: 'Pavillons', polygon: rect(-260, -480, 260, -290) },
        { kind: 'parking', name: 'Parking', polygon: rect(40, -360, 150, -310) },
        { kind: 'industrial', name: 'Zone d\'activités', polygon: rect(60, 240, 340, 400) },
      ],
    },
    buildings: null,
  };
}

/** Grand réseau quadrillé (~n nœuds, ~2,5 n arêtes orientées) pour mesurer la construction du graphe à l'échelle d'une grande ville. */
export function makeBigNet(n = 100000) {
  const side = Math.round(Math.sqrt(n)), step = 15200 / side, x0 = -7600, z0 = -7600;
  const nodes = new Array(side * side), edges = [], roads = [];
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) nodes[j * side + i] = [+(x0 + i * step).toFixed(1), +(z0 + j * step).toFixed(1)];
  let rid = 0;
  for (let j = 0; j < side; j++) { // rues est-ouest à sens unique alterné
    const id = ++rid, pts = [];
    for (let i = 0; i < side; i++) pts.push(nodes[j * side + (j & 1 ? side - 1 - i : i)]);
    roads.push({ id, name: 'Rue ' + j, kind: 'street', width: 6, lanes: 1, oneway: true, bridge: false, maxspeed: 30, points: pts });
    for (let i = 0; i < side - 1; i++) { const a = j * side + (j & 1 ? side - 1 - i : i), b = j * side + (j & 1 ? side - 2 - i : i + 1); edges.push([a, b, id]); }
  }
  for (let i = 0; i < side; i++) { // avenues nord-sud : une sur deux à double sens
    const id = ++rid, two = (i & 1) === 0, pts = [];
    for (let j = 0; j < side; j++) pts.push(nodes[j * side + i]);
    roads.push({ id, name: 'Avenue ' + i, kind: two ? 'avenue' : 'street', width: two ? 12 : 6, lanes: two ? 4 : 1, oneway: !two, bridge: false, maxspeed: 50, points: pts });
    for (let j = 0; j < side - 1; j++) { const a = j * side + i, b = (j + 1) * side + i; edges.push([a, b, id]); if (two) edges.push([b, a, id]); }
  }
  return { meta: { source: 'essai-grand', graphDirected: true }, roads, graph: { nodes, edges, nodeEle: new Array(nodes.length).fill(0) }, river: { polygons: [] }, parks: [], plazas: [], pois: { areas: [] }, buildings: null };
}

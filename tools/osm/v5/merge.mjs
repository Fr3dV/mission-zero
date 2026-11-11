// Fusion de tronçons contigus (routes, rails, cours d'eau) partageant une même clé.
// Chaque tronçon : { pts: [{x, z, id}], oneway?, parts: [] }. Deux tronçons d'un même groupe sont fusionnés quand
// exactement deux de leurs extrémités se rencontrent en un nœud. En mode strict (voies sans nom), le nœud ne doit
// en plus être touché par aucun autre tronçon (degré 2).
export function mergePieces(pieces, keyOf, strictOf) {
  // degré de chaque nœud (extrémité = 1, passage = 2) pour la fusion « stricte » des voies sans nom
  const deg = new Map();
  for (const p of pieces) p.pts.forEach((q, i) => deg.set(q.id, (deg.get(q.id) || 0) + (i === 0 || i === p.pts.length - 1 ? 1 : 2)));
  const groups = new Map();
  for (const p of pieces) { const k = keyOf(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const merged = [];
  for (const list of groups.values()) {
    const strict = strictOf(list[0]);
    const alive = new Set(list), ends = new Map();
    const reg = (p) => { for (const [id, s] of [[p.pts[0].id, true], [p.pts[p.pts.length - 1].id, false]]) { if (!ends.has(id)) ends.set(id, []); ends.get(id).push({ p, atStart: s }); } };
    const unreg = (p) => { for (const id of [p.pts[0].id, p.pts[p.pts.length - 1].id]) ends.set(id, (ends.get(id) || []).filter((e) => e.p !== p)); };
    list.forEach(reg);
    const queue = [...ends.keys()];
    while (queue.length) {
      const id = queue.pop(), es = ends.get(id);
      if (!es || es.length !== 2 || es[0].p === es[1].p) continue;
      if (strict && deg.get(id) !== 2) continue;
      let [a, b] = es;
      if (a.atStart && !b.atStart) [a, b] = [b, a];
      if (a.atStart === b.atStart) {
        if (list[0].oneway) continue;
        unreg(a.p); unreg(b.p);
        if (a.atStart) a.p.pts.reverse(); else b.p.pts.reverse();
      } else { unreg(a.p); unreg(b.p); }
      const A = a.p, B = b.p;
      A.pts = A.pts.concat(B.pts.slice(1)); A.parts = A.parts.concat(B.parts);
      alive.delete(B); reg(A); queue.push(A.pts[0].id, A.pts[A.pts.length - 1].id);
    }
    for (const p of alive) merged.push(p);
  }
  return merged;
}

// Trafic — frôlements (contrat v6 « style ») : `traffic:nearMiss {vehicle, other, gap, rel, side, x, z}`.
//
// Pour le véhicule du joueur local seulement : chaque voiture IA en circulation (ni garée, ni accidentée, ni unité de
// police — elles ne sont pas dans la liste parcourue) est suivie tant qu'elle passe à moins de 1,2 m de sa carrosserie
// (distance entre les deux rectangles orientés) avec une vitesse relative de plus de 8 m/s et moins de 2,5 m d'écart
// vertical (une voiture sur un pont au-dessus de nous ne compte pas). On retient le point le plus proche ; quand
// l'écart se rouvre, l'événement part 0,4 s plus tard, sauf si un `vehicle:crash` / `vehicle:hit` a impliqué la paire
// entre-temps (un vrai contact n'est jamais un frôlement). Un frôlement par voiture toutes les 3 s.
//   gap  : plus petit écart mesuré (m) ; rel : vitesse relative à cet instant (m/s) ;
//   side : 1 si l'autre voiture est passée à DROITE du joueur, −1 à gauche ; x, z : milieu entre les deux voitures.
// Le joueur doit lui-même rouler (plus de 6 m/s) : à l'arrêt dans un bouchon, être doublé de près n'est pas une figure.
const GAP = 1.2;        // flanc à flanc (m)
const REL = 8;          // vitesse relative minimale (m/s)
const OWN = 6;          // vitesse minimale du joueur (m/s)
const DY = 2.5;         // écart vertical maximal (m)
const DELAY = 0.4;      // délai avant l'émission (s)
const COOLDOWN = 3;     // un frôlement par voiture toutes les 3 s
const RANGE = 10;       // au-delà (m, par axe), la voiture n'est pas examinée
const REOPEN = 0.3;     // l'écart s'est rouvert d'autant : le point le plus proche est passé (m)

/** @param T contexte du trafic ; @param states états des voitures IA (cars.states : champs nm* posés par newCar). */
export function createNearMiss(T, states) {
  const { ctx } = T;
  function emit(c) {
    // charge neuve à chaque émission (rare) : l'auditeur peut la garder
    ctx.bus.emit('traffic:nearMiss', { vehicle: c.nmV, other: c.v, gap: c.nmGap < 0.05 ? 0.05 : c.nmGap, rel: c.nmRel, side: c.nmSide, x: c.nmX, z: c.nmZ });
  }
  function clear(c) { c.nmArm = false; c.nmT = 0; c.nmV = null; }

  function update(dt) {
    const pl = ctx.player, pv = pl && pl.mode === 'vehicle' ? pl.vehicle : null;
    const on = !!pv && !!pv.pos;
    let px = 0, py = 0, pz = 0, afx = 0, afz = -1, pvx = 0, pvz = 0, ahl = 2.2, ahw = 0.95, fast = false;
    if (on) {
      px = pv.pos.x; py = pv.pos.y; pz = pv.pos.z;
      afx = -Math.sin(pv.yaw); afz = -Math.cos(pv.yaw);
      const sp = pv.speed || 0;
      if (pv.vel) { pvx = pv.vel.x; pvz = pv.vel.z; } else { pvx = afx * sp; pvz = afz * sp; }
      fast = pvx * pvx + pvz * pvz > OWN * OWN;
      if (pv.spec) { ahl = pv.spec.length * 0.5; ahw = pv.spec.width * 0.5; }
    }
    for (let i = 0; i < states.length; i++) {
      const c = states[i];
      if (c.nmCd > 0) c.nmCd -= dt;
      if (c.nmT > 0) {
        // point le plus proche passé : émission différée (annulée par onContact)
        c.nmT -= dt;
        if (c.nmT <= 0) { if (c.active && c.nmV === pv && on) emit(c); clear(c); c.nmCd = COOLDOWN; }
        continue;
      }
      if (!on || !c.active || c.mode !== 0 || c.nmCd > 0) { if (c.nmArm) clear(c); continue; }
      const dx = c.x - px, dz = c.z - pz;
      if (dx > RANGE || dx < -RANGE || dz > RANGE || dz < -RANGE || c.y - py > DY || py - c.y > DY) {
        if (c.nmArm) { c.nmArm = false; c.nmT = DELAY; } // elle s'éloigne pour de bon
        continue;
      }
      // écart entre les deux rectangles orientés (axes séparateurs ; coin contre coin : distance euclidienne)
      const bfx = c.fx, bfz = c.fz, bhl = c.halfLen, bhw = c.halfWid;
      let cs = afx * bfx + afz * bfz, sn = afx * bfz - afz * bfx;
      if (cs < 0) cs = -cs; if (sn < 0) sn = -sn;
      let f = dx * afx + dz * afz, r = dz * afx - dx * afz; // position de l'autre dans notre repère (r > 0 : à droite)
      const side = r >= 0 ? 1 : -1;
      if (f < 0) f = -f; if (r < 0) r = -r;
      const sAf = f - ahl - (bhl * cs + bhw * sn), sAr = r - ahw - (bhl * sn + bhw * cs);
      let g = sAf > 0 && sAr > 0 ? Math.sqrt(sAf * sAf + sAr * sAr) : sAf > sAr ? sAf : sAr;
      f = dx * bfx + dz * bfz; r = dz * bfx - dx * bfz;
      if (f < 0) f = -f; if (r < 0) r = -r;
      const sBf = f - bhl - (ahl * cs + ahw * sn), sBr = r - bhw - (ahl * sn + ahw * cs);
      const g2 = sBf > 0 && sBr > 0 ? Math.sqrt(sBf * sBf + sBr * sBr) : sBf > sBr ? sBf : sBr;
      if (g2 > g) g = g2;
      const rvx = pvx - bfx * c.speed, rvz = pvz - bfz * c.speed, rel2 = rvx * rvx + rvz * rvz;
      if (g < GAP && rel2 > REL * REL && fast && (!c.nmArm || g < c.nmGap)) {
        c.nmArm = true; c.nmGap = g; c.nmRel = Math.sqrt(rel2); c.nmSide = side; c.nmV = pv;
        c.nmX = px + dx * 0.5; c.nmZ = pz + dz * 0.5;
      } else if (c.nmArm && g > c.nmGap + REOPEN) { c.nmArm = false; c.nmT = DELAY; }
    }
  }

  /** `vehicle:crash` / `vehicle:hit` entre a et b : s'il s'agit du joueur et d'une de nos voitures, pas de frôlement pour elle. */
  function onContact(a, b) {
    if (!a || !b) return;
    const pl = ctx.player, pv = pl && pl.vehicle;
    if (!pv) return;
    const o = a === pv ? b : b === pv ? a : null;
    if (!o) return;
    const c = T.owner.get(o);
    if (!c || c.nmCd === undefined) return; // voiture garée, étrangère au trafic…
    clear(c); c.nmCd = COOLDOWN;
  }

  return { update, onContact };
}

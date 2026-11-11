// Trafic — piétons. Trois façons de se promener :
//   - sur les trottoirs du graphe routier (décalés de l'axe : milieu du trottoir), en tournant aux coins sans quitter
//     son trottoir, avec parfois un demi-tour ou une traversée ; jamais sur autoroute, voie rapide, bretelle ou tunnel ;
//   - le long des rues piétonnes (routes kind 'pedestrian', absentes du graphe), au milieu de la chaussée ;
//   - sur les places et zones piétonnes (pois.areas / plazas) : flânerie de point en point, avec des pauses.
// Quelques-uns restent immobiles près des monuments. Tous esquivent les voitures (avec un temps de réaction : certains
// sont distraits) et peuvent être bousculés ou renversés — sans gore : ils tombent, restent au sol quelques secondes,
// se relèvent et s'éloignent.
//
// Niveaux superposés : chaque piéton passe sa hauteur à ctx.heightAt et à ctx.collision ; sur un ouvrage (pont de rue
// au-dessus d'une rocade) la hauteur vient de l'élévation de son arête. Véhicules et alertes situés à plus de 3 m
// au-dessus ou au-dessous sont ignorés.
//
// Machine à états (p.mode) :
//   0 NORMAL  marche / attente / traversée / flânerie / immobile (idle) / esquive
//   1 À TERRE projeté (balistique), glisse, puis allongé pendant downT
//   2 RELÈVE  anim 'getup' (1,6 s)
//   3 FUITE   s'éloigne en courant ('flee', sinon 'run'), ou en boitant s'il a été heurté fort ; puis retour à sa promenade
//   4 BADAUD  s'arrête et regarde un accident à distance (ou proteste, tourné vers sa voiture volée)
//   5 ÉJECTÉ  conducteur sorti de sa voiture (vol) : titube 1,2 s, puis proteste (4) ou s'enfuit (3)
import { createCharacter } from '../player/index.js';
import { baseHeightAt } from '@shared/terrain.js';
import { F_WALK, F_ELEV, KIND_STREET, KIND_QUAY } from './graph.js';
import { A_RESIDENTIAL, A_COMMERCIAL, A_INDUSTRIAL, A_PEDESTRIAN, A_GREEN, A_NOGO } from './areas.js';

const CLOTHES = ['#2b3a55', '#6b1f2a', '#30475e', '#3d5a45', '#8a6d3b', '#1f1f24', '#7a7f8a', '#b04a3a', '#3f6a8a', '#d9d2c5', '#5b4a6e', '#c9a227', '#2f4f4f', '#a8324a'];
const SKINS = ['#f1c9a5', '#e0ac7e', '#c68d5e', '#9a6a44', '#6e4a2f', '#f6d7bd'];
const pick = (a) => a[(Math.random() * a.length) | 0];

const BUMP_SPEED = 2.2;   // m/s (≈ 8 km/h) : en dessous on est bousculé, au-dessus renversé
const HURT_SPEED = 10;    // m/s : au-delà, on repart en boitant
const PED_MASS = 75;      // kg, pour l'impulsion rendue à la voiture
const GRAV = 9.8, SLIDE = 7;
const MAXV = 128;
const LEVEL = 3;          // écart vertical (m) au-delà duquel on s'ignore
const PCELL = 64;

export function createPedestrians(T) {
  const { ctx, G } = T;
  const { hTo, hUx, hUz, hLen, hDrive, hWalk, hWidth, hFlag, hKind, outStart, outList, nodeCtl } = G;
  const peds = [];
  T.peds = peds;
  const tmp = { e: 0, s: 0, x: 0, z: 0 };
  const tmpN = { h: -1, s: 0, d: 0, lat: 0 };
  let target = 0, activeCount = 0, frame = 0, lastAlarm = -9;

  // ---- rues piétonnes (routes kind 'pedestrian', hors graphe) : petit index spatial de leurs segments
  const proms = [];
  const promGrid = new Map(); // case → [route * 4096 + segment, …]
  {
    const roads = (ctx.worldData && ctx.worldData.roads) || [];
    for (let r = 0; r < roads.length; r++) {
      const road = roads[r];
      if (road.kind !== 'pedestrian' || !road.points || road.points.length < 2 || road.tunnel) continue;
      const pi = proms.length; proms.push(road);
      const pts = road.points;
      for (let k = 0; k < pts.length - 1 && k < 4095; k++) {
        const ax = pts[k][0], az = pts[k][1], bx = pts[k + 1][0], bz = pts[k + 1][1];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (PCELL * 0.5)));
        let last = null;
        for (let q = 0; q <= steps; q++) {
          const key = Math.floor((ax + (bx - ax) * q / steps) / PCELL) * 65536 + Math.floor((az + (bz - az) * q / steps) / PCELL);
          if (key === last) continue; last = key;
          let a = promGrid.get(key); if (!a) promGrid.set(key, (a = []));
          a.push(pi * 4096 + k);
        }
      }
    }
  }

  // Véhicules proches, mis à plat une fois par frame (pas de trigonométrie par piéton).
  const vX = new Float32Array(MAXV), vZ = new Float32Array(MAXV), vY = new Float32Array(MAXV), vFx = new Float32Array(MAXV), vFz = new Float32Array(MAXV);
  const vHl = new Float32Array(MAXV), vHw = new Float32Array(MAXV), vSp = new Float32Array(MAXV), vVx = new Float32Array(MAXV), vVz = new Float32Array(MAXV);
  const vAI = new Uint8Array(MAXV), vRef = new Array(MAXV).fill(null);
  let nV = 0;
  function gatherVehicles() {
    nV = 0;
    const list = ctx.vehicles && ctx.vehicles.list;
    if (!list) return;
    const R = T.PED_RADIUS + 70, fx = T.fx, fz = T.fz;
    for (let i = 0; i < list.length && nV < MAXV; i++) {
      const v = list[i];
      const dx = v.pos.x - fx, dz = v.pos.z - fz;
      if (dx > R || dx < -R || dz > R || dz < -R) continue;
      const k = nV++, sp = v.speed || 0, f1 = -Math.sin(v.yaw), f2 = -Math.cos(v.yaw);
      vX[k] = v.pos.x; vZ[k] = v.pos.z; vY[k] = v.pos.y; vFx[k] = f1; vFz[k] = f2; vSp[k] = sp;
      vHl[k] = v.spec ? v.spec.length * 0.5 : 2.2; vHw[k] = v.spec ? v.spec.width * 0.5 : 0.95;
      if (v.vel && !v.remote) { vVx[k] = v.vel.x; vVz[k] = v.vel.z; } else { vVx[k] = f1 * sp; vVz[k] = f2 * sp; }
      const own = T.owner.get(v);
      vAI[k] = own && !own.parked && own.mode === 0 ? 1 : 0;
      vRef[k] = v;
    }
    // caisses de tramway : vues comme des véhicules que l'on esquive (jamais de choc : on est simplement repoussé)
    const tr = T.trams;
    if (tr) for (let i = 0; i < tr.length && nV < MAXV; i++) {
      const s = tr[i];
      if (!s.active) continue;
      const dx = s.x - fx, dz = s.z - fz;
      if (dx > R || dx < -R || dz > R || dz < -R) continue;
      const k = nV++;
      vX[k] = s.x; vZ[k] = s.z; vY[k] = s.y; vFx[k] = s.fx; vFz[k] = s.fz; vSp[k] = s.speed; vHl[k] = s.halfLen; vHw[k] = s.halfWid;
      vVx[k] = s.fx * s.speed; vVz[k] = s.fz * s.speed; vAI[k] = 2; vRef[k] = null;
    }
  }

  /** Décalage latéral de marche sur l'arête h : milieu du trottoir ± la fantaisie du piéton (jamais vers la chaussée si le trottoir est étroit). */
  const walkOff = (h, jit) => hWalk[h] + (hFlag[h] & F_ELEV ? Math.min(0.3, Math.max(0, jit)) : hWalk[h] - hWidth[h] / 2 < 1.1 ? Math.max(0.2, jit) : jit);
  const sx = (h, s, p) => G.pointX(h, s, p.side * walkOff(h, p.jit));
  const sz = (h, s, p) => G.pointZ(h, s, p.side * walkOff(h, p.jit));

  /** Choisit la suite au bout de la demi-arête courante : on reste sur le même trottoir en tournant au coin. */
  function choose(p) {
    const h = p.h, node = hTo[h], ux = hUx[h], uz = hUz[h], len = hLen[h];
    let best = -1, bestPhi = -9, blocked = false, xPhi = -9, xW = 0;
    p.xing = false;
    for (let k = outStart[node]; k < outStart[node + 1]; k++) {
      const o = outList[k];
      if (o === (h ^ 1)) continue;
      // angle signé du virage, positif = vers le côté du trottoir suivi
      const phi = Math.atan2(ux * hUz[o] - uz * hUx[o], ux * hUx[o] + uz * hUz[o]) * p.side;
      if (!(hFlag[o] & F_WALK)) { // voie rapide, bretelle, tunnel : on n'y va pas
        blocked = true;
        if (hDrive[o] || hDrive[o ^ 1]) { if (phi > xPhi) xPhi = phi; if (hWidth[o] > xW) xW = hWidth[o]; }
        continue;
      }
      if (phi > bestPhi) { bestPhi = phi; best = o; }
    }
    if (best < 0 && !blocked) { p.nextH = h ^ 1; p.nextSide = p.side; p.tEnd = Math.min(0.5, len * 0.3); p.nextT = p.tEnd; return; } // cul-de-sac : on contourne le bout
    if (best < 0 || (nodeCtl[node] && Math.random() < 0.1)) { // demi-tour sur le même trottoir
      p.nextH = h ^ 1; p.nextSide = -p.side; p.tEnd = Math.min(1, len * 0.3); p.nextT = p.tEnd; return;
    }
    p.nextH = best; p.nextSide = p.side;
    let tA = 0.3, tB = 0.3;
    if (bestPhi > 0.1) { // coin intérieur : on coupe à l'intersection des deux lignes de trottoir
      const offA = hWalk[h] + p.jit, offB = hWalk[best] + p.jit, c = Math.cos(bestPhi), s = Math.max(Math.sin(bestPhi), 0.3);
      tA = (offB + offA * c) / s; tB = (offA + offB * c) / s;
    }
    p.tEnd = Math.max(0.3, Math.min(tA, 14, len * 0.45));
    p.nextT = Math.max(0.3, Math.min(tB, 14, hLen[best] * 0.45));
    if (xPhi > bestPhi) {
      // une bretelle débouche de notre côté : on s'arrête au bord, on la franchit, et l'on reprend le trottoir au-delà
      const w = xW / 2 + 1.5;
      p.xing = true; p.tEnd = Math.max(p.tEnd, Math.min(w, len * 0.45)); p.nextT = Math.max(p.nextT, Math.min(w, hLen[best] * 0.45));
    }
  }
  function goEnd(p) { const s = hLen[p.h] - p.tEnd; p.stage = 1; p.tx = sx(p.h, s, p); p.tz = sz(p.h, s, p); }
  function advance(p) {
    p.h = p.nextH; p.side = p.nextSide;
    const s0 = p.nextT;
    const cross = p.xing; // (choose() ci-dessous prépare le nœud d'après)
    choose2(p, s0, cross);
  }
  function choose2(p, s0, cross) {
    choose(p);
    if (s0 < hLen[p.h] - p.tEnd - 0.5) { p.stage = 0; p.tx = sx(p.h, s0, p); p.tz = sz(p.h, s0, p); if (cross) p.onRoad = true; }
    else goEnd(p);
  }
  /** Le point est-il sur une chaussée ouverte aux voitures (du niveau de la rue) ? */
  const onRoadAt = (x, z) => G.onCarriageway(x, z, 0, -1);
  /** Flânerie (rue piétonne ou place) : prochain point à rejoindre. */
  function freeTarget(p) {
    p.stage = 4;
    if (p.free === 1) {
      // rue piétonne : sommet suivant de la polyligne, demi-tour au bout
      const pts = proms[p.fi].points;
      let k = p.fk + p.fdir;
      if (k < 0 || k >= pts.length) { p.fdir = -p.fdir; k = p.fk + p.fdir; p.fo = -p.fo; }
      if (k < 0 || k >= pts.length) k = p.fk;
      const a = pts[p.fk], b = pts[k], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      p.fk = k;
      p.tx = b[0] - (dz / l) * p.fo; p.tz = b[1] + (dx / l) * p.fo;
    } else {
      // place : point au hasard à moins de 30 m, à l'intérieur de l'emprise
      for (let t = 0; t < 6; t++) {
        const a = Math.random() * 6.283, r = 6 + Math.random() * 24, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        // à l'intérieur de la place, et sans mettre les pieds sur une chaussée qui la traverse
        if (T.areas.inside(p.fi, x, z) && !onRoadAt(x, z) && !onRoadAt((x + p.x) / 2, (z + p.z) / 2)) { p.tx = x; p.tz = z; return; }
      }
      p.stage = 5; p.waitT = 2 + Math.random() * 4; // pas trouvé : petite pause
    }
  }
  function arrive(p) {
    if (p.stage === 4) {
      if (p.free === 2 && Math.random() < 0.45) { p.stage = 5; p.waitT = 2 + Math.random() * 7; setAnim(p, 'idle', 0); } else freeTarget(p);
      return;
    }
    if (p.stage === 0) { p.onRoad = false; goEnd(p); return; }
    if (p.stage === 3) { p.onRoad = false; p.cur = p.speed; choose(p); advance(p); return; }
    // bout d'arête : parfois on traverse la rue
    const h = p.h;
    if (p.xing && p.carNear && p.waited < 6) { p.stage = 6; setAnim(p, 'idle', 0); return; } // bretelle à franchir : on laisse passer
    if (!p.xing && p.crossCd <= 0 && Math.random() < 0.1 && (hDrive[h] || hDrive[h ^ 1]) && hWidth[h] < 24 && !(hFlag[h] & F_ELEV)) {
      p.stage = 2; p.waitT = 0.4 + Math.random() * 1.5; p.waited = 0; p.crossCd = 25;
      return;
    }
    p.waited = 0;
    advance(p);
  }
  /** Change d'animation ; si le personnage ne connaît pas `anim` (module en cours d'écriture), utilise `fallback`. */
  function setAnim(p, anim, speed, fallback) {
    if (p.anim === anim && Math.abs(p.animSpeed - speed) < 0.05) return;
    p.anim = anim; p.animSpeed = speed;
    p.ch.setState({ anim, speed });
    if (fallback && p.ch.anim !== undefined && p.ch.anim !== anim) p.ch.setState({ anim: fallback, speed });
  }
  const walkAnim = (p) => setAnim(p, p.jog ? 'run' : 'walk', p.cur || p.speed);
  function turnBack(p) { p.h ^= 1; p.side = -p.side; choose(p); goEnd(p); }

  // ---------------------------------------------------------------- chocs
  function knock(p, i, l, rvx, rvz, rel) {
    const v = vRef[i], dirX = rvx / rel, dirZ = rvz / rel;
    const rx = -vFz[i], rz = vFx[i], side = l >= 0 ? 1 : -1, lat = (0.25 + 0.5 * Math.min(1, Math.abs(l) / vHw[i])) * 0.5 * rel;
    const first = p.mode !== 1;
    p.mode = 1; p.onRoad = true; p.dodgeT = 0; p.hitCd = 0.6; p.threatT = 0;
    // projeté un peu plus vite que la voiture, vers l'avant et sur le côté où il a été pris
    p.vx = vVx[i] * 1.05 + rx * side * lat; p.vz = vVz[i] * 1.05 + rz * side * lat;
    p.vy = Math.min(1.2 + rel * 0.22, 5.5); if (p.hy < 0.05) p.hy = 0.05;
    p.downT = Math.max(p.downT, 2.5 + Math.min(rel, 25) * 0.28); // plus le choc est violent, plus il reste au sol
    p.hurt = p.hurt || rel > HURT_SPEED;
    p.srcX = vX[i]; p.srcZ = vZ[i];
    if (p.hasKnock) { try { p.ch.knock({ dirX, dirZ, speed: rel }); } catch (e) { p.hasKnock = false; } }
    if (!p.hasKnock) { // repli : le groupe bascule au sol, dos vers la direction du choc
      p.group.rotation.order = 'YXZ'; p.tiltTarget = 1.45; p.yaw = Math.atan2(dirX, dirZ);
      setAnim(p, 'lying', 0, 'idle');
      if (p.ch.anim === 'lying') p.tiltTarget = 0; // le personnage sait déjà s'allonger
    } else { p.anim = 'lying'; p.animSpeed = 0; }
    if (first || rel > 4) {
      ctx.bus.emit('pedestrian:hit', { x: p.x, y: p.y, z: p.z, speed: rel, vehicle: v, severity: 'knockdown', pedestrian: p });
      if (v && !v.remote && v.applyImpulse) v.applyImpulse(-dirX * PED_MASS * rel * 0.6, -dirZ * PED_MASS * rel * 0.6, p.x, p.z);
    }
    const own = T.owner.get(v);
    if (own && own.emergT !== undefined) own.emergT = 1.5; // une IA qui touche un piéton pile
    alarm(p.x, p.z, rel, false, p.y);
  }
  function bump(p, i, l, rel) {
    const v = vRef[i], rx = -vFz[i], rz = vFx[i], side = l >= 0 ? 1 : -1;
    p.hitCd = 1.5; p.ddx = rx * side; p.ddz = rz * side; p.dodgeT = 0.9; p.threatT = 9; // il s'écarte vivement
    if (p.mode === 4) p.mode = 0;
    setAnim(p, 'stumble', 3, 'run');
    ctx.bus.emit('pedestrian:hit', { x: p.x, y: p.y, z: p.z, speed: rel, vehicle: v, severity: 'bump', pedestrian: p });
    if (v && !v.remote && v.applyImpulse) v.applyImpulse(-vFx[i] * Math.sign(vSp[i] || 1) * PED_MASS * rel * 0.3, -vFz[i] * Math.sign(vSp[i] || 1) * PED_MASS * rel * 0.3, p.x, p.z);
    const own = T.owner.get(v);
    if (own && own.emergT !== undefined) own.emergT = 1;
  }
  function startFlee(p, fromX, fromZ, dur, limp) {
    let dx = p.x - fromX, dz = p.z - fromZ; const d = Math.hypot(dx, dz);
    if (d < 0.1) { const a = Math.random() * 6.28; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= d; dz /= d; }
    p.mode = 3; p.fdx = dx; p.fdz = dz; p.fleeT = dur; p.dodgeT = 0; p.onRoad = true; p.tiltTarget = 0;
    p.cur = limp ? 0.9 : 4.6 + Math.random() * 0.8;
    if (limp) setAnim(p, 'limp', p.cur, 'walk'); else setAnim(p, 'flee', p.cur, 'run');
  }
  /** Retour à la vie normale : on reprend sa flânerie, ou le trottoir le plus proche (de son niveau). */
  function resnap(p) {
    p.mode = 0; p.hurt = false; p.downT = 0; p.tiltTarget = 0;
    p.cur = p.speed;
    if (p.free === 2 && T.areas.inside(p.fi, p.x, p.z)) { p.onRoad = false; walkAnim(p); freeTarget(p); return; }
    if (p.free === 1) { p.onRoad = false; walkAnim(p); p.fk = Math.max(0, p.fk - p.fdir); freeTarget(p); return; }
    p.free = 0;
    if (!G.nearest(p.x, p.z, 45, tmpN, false, 0, 0, p.y - baseHeightAt(p.x, p.z), F_WALK)) { p.idle = true; p.onRoad = false; setAnim(p, 'idle', 0); return; }
    let h = tmpN.h, lat = tmpN.lat, s = tmpN.s;
    if (Math.random() < 0.5) { h ^= 1; lat = -lat; s = hLen[h] - s; }
    p.idle = false; p.h = h; p.side = lat >= 0 ? 1 : -1;
    choose(p);
    // d'abord rejoindre le trottoir à sa hauteur (on est peut-être sur la chaussée), puis reprendre la marche
    s = Math.min(s, Math.max(0, hLen[h] - p.tEnd - 0.6));
    p.stage = 0; p.tx = sx(h, s, p); p.tz = sz(h, s, p);
    p.onRoad = Math.abs(lat) < hWidth[h] / 2 + 0.5;
    walkAnim(p);
  }
  /** Accident ou voiture folle en (x, z) : les proches (du même niveau) s'enfuient, certains plus loin s'arrêtent pour regarder. */
  function alarm(x, z, power, noWatch, y) {
    if (T.now - lastAlarm < 0.3) return;
    lastAlarm = T.now;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p.active || (p.mode !== 0 && p.mode !== 4) || p.needSnap) continue;
      if (y !== undefined && (p.y - y > LEVEL + 2 || y - p.y > LEVEL + 2)) continue;
      const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
      if (d2 < 14 * 14) { if (d2 > 0.5) startFlee(p, x, z, 3 + Math.random() * 3, false); }
      else if (!noWatch && d2 < 38 * 38 && p.mode === 0 && !p.jog && p.stage !== 3 && Math.random() < 0.4) {
        p.mode = 4; p.watchT = 4 + Math.random() * 6; p.wx = x; p.wz = z; p.dodgeT = 0;
        setAnim(p, 'idle', 0);
      }
    }
  }
  T.alarm = alarm;
  /** Conducteur éjecté de sa voiture (vol) : piéton à part entière, qui titube, puis proteste ou s'enfuit. */
  T.spawnEjected = (x, z, yaw, carX, carZ, look, y) => {
    const p = newPed(look);
    if (!p) return null;
    activate(p, x, z);
    p.y = p.gy = y !== undefined ? y : ctx.heightAt(x, z);
    p.idle = false; p.free = 0; p.yaw = yaw; p.mode = 5; p.getT = 1.15; p.srcX = carX; p.srcZ = carZ; p.needSnap = true; p.onRoad = true; p.cur = 0;
    setAnim(p, 'stumble', 0, 'idle');
    place(p);
    // les passants proches regardent, quelques-uns s'éloignent
    for (let i = 0; i < peds.length; i++) {
      const q = peds[i];
      if (!q.active || q === p || q.mode !== 0 || q.y - p.y > LEVEL || p.y - q.y > LEVEL) continue;
      const dx = q.x - x, dz = q.z - z, d2 = dx * dx + dz * dz;
      if (d2 > 26 * 26) continue;
      if (d2 < 10 * 10 && Math.random() < 0.3) startFlee(q, x, z, 2.5 + Math.random() * 2, false);
      else if (!q.jog && q.stage !== 3 && Math.random() < 0.6) { q.mode = 4; q.watchT = 3 + Math.random() * 5; q.wx = carX; q.wz = carZ; q.dodgeT = 0; setAnim(q, 'idle', 0); }
    }
    return p;
  };

  /** Contacts (balayés, donc sans effet tunnel) et menaces pour un piéton ; `full` = avec la partie esquive. */
  function vehicles(p, dt, full) {
    let threat = false, tdx = 0, tdz = 0, near = false;
    const down = p.mode === 1, py = p.y;
    for (let i = 0; i < nV; i++) {
      const dx = p.x - vX[i], dz = p.z - vZ[i];
      if (dx > 75 || dx < -75 || dz > 75 || dz < -75) continue;
      if (py - vY[i] > LEVEL || vY[i] - py > LEVEL) continue; // autre niveau : la voiture passe au-dessus ou au-dessous
      if (full) { // une voiture approche-t-elle ? (pour traverser : d'autant plus loin qu'elle roule vite)
        const a = vSp[i] < 0 ? -vSp[i] : vSp[i], r = 12 + a * 3.5;
        if (a > 1 && dx * dx + dz * dz < r * r && (dx * vVx[i] + dz * vVz[i] > 0 || dx * dx + dz * dz < 144)) near = true;
      }
      if (dx > 34 || dx < -34 || dz > 34 || dz < -34) continue;
      const fx = vFx[i], fz = vFz[i], f = dx * fx + dz * fz, l = dx * -fz + dz * fx, al = l < 0 ? -l : l;
      const hl = vHl[i], hw = vHw[i], sp = vSp[i];
      if (al < hw + 0.3 && p.hy < 1.1 && f < hl + 0.3 + 3 && f > -hl - 0.3 - 3) {
        // vitesse relative voiture → piéton (un piéton déjà projeté par cette voiture ne la « subit » plus)
        const rvx = vVx[i] - (down ? p.vx : 0), rvz = vVz[i] - (down ? p.vz : 0);
        const rf = rvx * fx + rvz * fz, rel = Math.hypot(rvx, rvz), sw = rf * dt;
        // le piéton, vu de la voiture, a parcouru [f, f + sw] pendant ce pas : contact si ce segment touche la caisse
        const lo = sw > 0 ? f : f + sw, hi = sw > 0 ? f + sw : f;
        if (hi > -hl - 0.3 && lo < hl + 0.3) {
          // une IA en conduite normale roule prudemment : en dessous de 6 m/s elle ne fait que bousculer
          if (vAI[i] !== 2) {
            if (rel >= (vAI[i] ? 6 : BUMP_SPEED) && p.hitCd <= 0 && (rf > 0 ? f > -hl * 0.5 : f < hl * 0.5)) { knock(p, i, l, rvx, rvz, rel); continue; }
            if (rel >= 0.5 && p.hitCd <= 0 && !down && p.mode !== 2) bump(p, i, l, rel);
          }
          if (p.hy <= 0 && f < hl + 0.3 && f > -hl - 0.3) { // jamais sous la caisse : repoussé sur le côté
            const sign = l >= 0 ? 1 : -1, shift = hw + 0.4 - al;
            p.x += -fz * sign * shift; p.z += fx * sign * shift;
          }
        }
      }
      if (!full) continue;
      const asp = sp < 0 ? -sp : sp;
      if (asp > 1) {
        // les IA freinent d'elles-mêmes ; on fuit surtout les autres (horizon ≈ 1 s de trajet)
        const ahead = vAI[i] === 1 ? 2 + asp * 0.35 : 2.5 + asp;
        const ff = sp > 0 ? f : -f;
        if (ff > -1 && ff < hl + ahead && al < hw + (asp > 8 && !vAI[i] ? 1.4 : 0.9)) {
          const sign = al < 0.15 ? (p.idx & 1 ? 1 : -1) : (l >= 0 ? 1 : -1);
          threat = true; tdx = -fz * sign; tdz = fx * sign;
          // voiture lancée sur le trottoir : panique autour
          if (asp > 8 && !vAI[i] && !p.onRoad && al < hw + 0.9) alarm(p.x, p.z, asp, true, py);
        }
      }
    }
    if (!full) return;
    p.carNear = near;
    if (threat) {
      p.threatT += 0.12;
      if (p.threatT >= p.react && (p.mode === 0 || p.mode === 4)) { p.mode = 0; p.ddx = tdx; p.ddz = tdz; p.dodgeT = 0.7; }
    } else p.threatT = 0;
  }

  // ---------------------------------------------------------------- pool
  function newPed(look) {
    const ch = createCharacter(ctx, look ? { color: look.color, skin: look.skin, name: look.name } : { color: pick(CLOTHES), skin: pick(SKINS) });
    if (!ch || !ch.group) return null;
    ctx.scene.add(ch.group);
    const jog = Math.random() < 0.06;
    const p = {
      ch, group: ch.group, active: false, idle: false, x: 0, y: 0, z: 0, yaw: 0, h: 0, side: 1, nextH: 0, nextSide: 1, nextT: 0, tEnd: 0,
      stage: 1, tx: 0, tz: 0, speed: jog ? 3 + Math.random() : 1.05 + Math.random() * 0.8, jog, cur: 0, anim: '', animSpeed: -1,
      jit: Math.random() * 1.3 - 0.5, onRoad: false, dodgeT: 0, ddx: 0, ddz: 0, waitT: 0, waited: 0, crossCd: 0, carNear: false,
      scanT: Math.random() * 0.12, colT: Math.random() * 0.25, stallT: 0, stalls: 0, animAcc: 0, idx: peds.length,
      // réaction au danger : délai avant d'esquiver (les distraits réagissent trop tard)
      react: Math.random() < 0.25 ? 0.7 + Math.random() * 0.6 : 0.12 + Math.random() * 0.3, threatT: 0,
      mode: 0, vx: 0, vz: 0, vy: 0, hy: 0, downT: 0, getT: 0, hitCd: 0, hurt: false, srcX: 0, srcZ: 0,
      needSnap: false, fdx: 0, fdz: 0, fleeT: 0, watchT: 0, wx: 0, wz: 0, tilt: 0, tiltTarget: 0, yOff: 0, hasKnock: typeof ch.knock === 'function',
      // flânerie : 0 = trottoirs du graphe, 1 = rue piétonne (fi = indice, fk = sommet visé, fdir, fo = décalage), 2 = place (fi = zone)
      free: 0, fi: 0, fk: 0, fdir: 1, fo: 0, gy: 0, xing: false, roadT: 0,
    };
    peds.push(p);
    return p;
  }
  function activate(p, x, z) {
    p.x = x; p.z = z; p.active = true; activeCount++;
    p.onRoad = false; p.dodgeT = 0; p.stallT = 0; p.stalls = 0; p.crossCd = 5 + Math.random() * 20;
    p.mode = 0; p.vx = p.vz = p.vy = p.hy = 0; p.downT = 0; p.hitCd = 0; p.hurt = false; p.threatT = 0;
    p.tilt = p.tiltTarget = 0; p.group.rotation.x = 0; p.yOff = 0; p.needSnap = false; p.free = 0; p.idle = false; p.roadT = 0;
    p.hasKnock = typeof p.ch.knock === 'function';
    p.group.visible = true;
  }
  function deactivate(p) {
    if (!p.active) return;
    p.active = false; activeCount--; p.onRoad = false; p.mode = 0;
    p.group.visible = false;
  }
  /** Affluence piétonne en un point d'un trottoir : type de rue, distance au centre, zone. */
  function pedWeight(h, x, z) {
    const k = hKind[h], tu = T.tune;
    let w = k === KIND_STREET ? (hWidth[h] < 7 ? 0.8 : 1) : k === KIND_QUAY ? 0.6 : 1;
    const d = Math.hypot(x, z);
    if (d > tu.pedCentreR) w *= Math.max(tu.outerPeds, 1 - (1 - tu.outerPeds) * (d - tu.pedCentreR) / (tu.outerR - tu.pedCentreR));
    const a = T.areas.kindAt(x, z);
    if (a === A_INDUSTRIAL || a === A_COMMERCIAL || a === A_NOGO) w *= 0.03;  // zones d'activités : personne à pied
    else if (a === A_RESIDENTIAL && d > tu.pedCentreR * 1.5) w *= 0.5;     // zone pavillonnaire (hors centre) : rares passants
    else if (a === A_PEDESTRIAN) w = Math.min(1, w * 1.4);
    else if (a === A_GREEN) w *= 0.8;
    return w;
  }
  /** Affluence piétonne autour de (x, z) : 1 dans une rue piétonne ou sur une place, sinon celle du trottoir le plus proche. */
  function probe(x, z) {
    if (promGrid.has(Math.floor(x / PCELL) * 65536 + Math.floor(z / PCELL))) return 1;
    if (T.areas.pedZones && T.areas.kindAt(x, z) === A_PEDESTRIAN) return 1;
    if (!G.nearest(x, z, 40, tmpN, false, 0, 0, undefined, F_WALK)) return 0;
    return pedWeight(tmpN.h, x, z);
  }
  const spawnOk = (x, z, y, burst) => {
    const d2 = (x - T.fx) * (x - T.fx) + (z - T.fz) * (z - T.fz);
    if (d2 < 100 || d2 > T.PED_RADIUS * T.PED_RADIUS) return false;
    if (!burst && d2 < 75 * 75 && T.inView(x, z, y)) return false;
    return !(ctx.collision && ctx.collision.test(x, z, 0.4, y + 1));
  };
  function trySpawn(p, burst) {
    const fx = T.fx, fz = T.fz, r0 = Math.random();
    // immobiles près d'un monument
    if (r0 < 0.2) {
      const lms = ctx.LANDMARKS || [];
      for (let i = 0; i < lms.length; i++) {
        const L = lms[i], d = Math.hypot(L.x - fx, L.z - fz);
        if (d > 150 + L.radius) continue;
        const a = Math.random() * Math.PI * 2, r = L.radius + 2 + Math.random() * 12;
        const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r, y = ctx.heightAt(x, z);
        const d2 = (x - fx) * (x - fx) + (z - fz) * (z - fz);
        if (d2 > T.PED_RADIUS * T.PED_RADIUS || d2 < 144) return false;
        if (!burst && d2 < 70 * 70 && T.inView(x, z, y)) return false;
        if (ctx.collision && ctx.collision.test(x, z, 0.5, y + 1)) return false;
        if (ctx.world && ctx.world.roadAt && ctx.world.roadAt(x, z)) return false;
        if (!p) p = newPed();
        if (!p) return false;
        activate(p, x, z);
        p.idle = true; p.y = p.gy = y;
        p.yaw = Math.atan2(-(L.x - x), -(L.z - z)) + (Math.random() - 0.5) * 1.6;
        setAnim(p, 'idle', 0);
        place(p);
        return true;
      }
    }
    // rues piétonnes et places : le cœur de ville
    if (r0 > 0.2 && r0 < 0.55 && (promGrid.size || T.areas.pedZones)) {
      const a = Math.random() * 6.283, r = (burst ? 10 : 28) + Math.random() * (T.PED_RADIUS - 28);
      const px = fx + Math.cos(a) * r, pz = fz + Math.sin(a) * r;
      const cell = promGrid.get(Math.floor(px / PCELL) * 65536 + Math.floor(pz / PCELL));
      if (cell) {
        const it = cell[(Math.random() * cell.length) | 0], pi = (it / 4096) | 0, k = it % 4096, road = proms[pi], pts = road.points;
        const t = Math.random(), ax = pts[k][0], az = pts[k][1], bx = pts[k + 1][0], bz = pts[k + 1][1], l = Math.hypot(bx - ax, bz - az) || 1;
        const fo = (Math.random() * 2 - 1) * Math.max(0.3, (road.width || 6) / 2 - 1), dir = Math.random() < 0.5 ? 1 : -1;
        const x = ax + (bx - ax) * t - ((bz - az) / l) * fo * dir, z = az + (bz - az) * t + ((bx - ax) / l) * fo * dir, y = ctx.heightAt(x, z);
        if (!spawnOk(x, z, y, burst)) return false;
        if (!p) p = newPed();
        if (!p) return false;
        activate(p, x, z);
        p.y = p.gy = y; p.free = 1; p.fi = pi; p.fdir = dir; p.fk = dir > 0 ? k : k + 1; p.fo = fo;
        p.cur = p.speed; p.yaw = G.yawOf((bx - ax) * dir / l, (bz - az) * dir / l);
        freeTarget(p); walkAnim(p); place(p);
        return true;
      }
      const zi = T.areas.pedZones ? T.areas.randomOfKind(px, pz, A_PEDESTRIAN) : -1;
      if (zi >= 0 && T.areas.inside(zi, px, pz)) {
        const y = ctx.heightAt(px, pz);
        if (!spawnOk(px, pz, y, burst)) return false;
        if (onRoadAt(px, pz) || (ctx.world && ctx.world.roadAt && ctx.world.roadAt(px, pz))) return false;
        if (!p) p = newPed();
        if (!p) return false;
        activate(p, px, pz);
        p.y = p.gy = y; p.free = 2; p.fi = zi; p.cur = p.speed; p.yaw = Math.random() * 6.283;
        if (Math.random() < 0.35) { p.stage = 5; p.waitT = 2 + Math.random() * 8; setAnim(p, 'idle', 0); } else { freeTarget(p); if (p.stage === 4) walkAnim(p); else setAnim(p, 'idle', 0); }
        place(p);
        return true;
      }
    }
    if (!G.randomEdgeNear(fx, fz, burst ? 10 : 28, T.PED_RADIUS, tmp, 4)) return false;
    const h = 2 * tmp.e + (Math.random() < 0.5 ? 1 : 0), side = Math.random() < 0.5 ? 1 : -1;
    if (!(hFlag[h] & F_WALK)) return false; // ni autoroute, ni bretelle, ni tunnel
    const w = pedWeight(h, tmp.x, tmp.z);
    if (Math.random() > w + 0.02) return false;
    const s = h & 1 ? hLen[h] - tmp.s : tmp.s;
    const jit = p ? p.jit : 0, off = side * walkOff(h, jit);
    const x = G.pointX(h, s, off), z = G.pointZ(h, s, off);
    // (grandes places : le « trottoir » d'une chaussée peut tomber sur les voies d'une autre — on n'y fait naître personne)
    if (G.onCarriageway(x, z, G.eleAt(h, s), tmp.e)) return false;
    // hauteur : celle de l'arête (pont de rue), recalée sur la surface du module ville
    const ye = baseHeightAt(x, z) + G.eleAt(h, s), yh = ctx.heightAt(x, z, ye + 0.4), y = Math.abs(yh - ye) < 1.5 ? yh : ye;
    if (!spawnOk(x, z, y, burst)) return false;
    if (!p) p = newPed();
    if (!p) return false;
    activate(p, x, z);
    p.y = p.gy = y; p.h = h; p.side = side;
    choose(p);
    if (s < hLen[h] - p.tEnd - 0.5) goEnd(p); else advance(p);
    p.cur = p.speed;
    p.yaw = G.yawOf(hUx[h], hUz[h]);
    walkAnim(p);
    place(p);
    return true;
  }
  /** Pose le personnage : hauteur du sol de SON niveau (y courant passé à heightAt ; sur un ouvrage, élévation de l'arête). */
  function place(p) {
    let hint = p.gy, elev = false;
    if (p.free === 0 && !p.idle && p.mode === 0 && (hFlag[p.h] & F_ELEV)) {
      const h = p.h, s = (p.x - G.nx[G.hFrom[h]]) * hUx[h] + (p.z - G.nz[G.hFrom[h]]) * hUz[h];
      hint = baseHeightAt(p.x, p.z) + G.eleAt(h, s); elev = true;
    }
    let g = ctx.heightAt(p.x, p.z, hint + 0.3);
    if (elev && (g - hint > 1.5 || hint - g > 1.5)) g = hint;
    const k = p.tilt / 1.45;
    p.gy = g;
    p.y = g + p.hy;
    p.group.position.set(p.x, g + p.yOff * (1 - k) + p.hy + 0.2 * k, p.z);
    p.group.rotation.y = p.yaw;
    if (p.tilt > 0.002 || p.tiltTarget > 0) p.group.rotation.x = p.tilt;
  }

  // ---------------------------------------------------------------- boucle
  function step(p, dt) {
    if (p.hitCd > 0) p.hitCd -= dt;
    p.scanT -= dt;
    const full = p.scanT <= 0;
    if (full) p.scanT = p.dodgeT > 0 ? 0 : 0.12;
    vehicles(p, dt, full);
    if (p.crossCd > 0) p.crossCd -= dt;
    let mx = 0, mz = 0, moving = false, resolve = false;

    if (p.mode === 1) {
      // projeté : vol balistique, glissade, puis allongé
      if (p.hy > 0 || p.vy > 0) { p.vy -= GRAV * dt; p.hy += p.vy * dt; if (p.hy <= 0) { p.hy = 0; p.vy = 0; } }
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0.08) {
        p.x += p.vx * dt; p.z += p.vz * dt; resolve = true;
        if (p.hy <= 0) { const k = Math.max(0, sp - SLIDE * dt) / sp; p.vx *= k; p.vz *= k; }
      } else {
        p.vx = p.vz = 0;
        if (p.hy <= 0) {
          p.downT -= dt;
          if (p.downT <= 0) { p.mode = 2; p.getT = 1.6; p.tiltTarget = 0; setAnim(p, 'getup', 0, 'idle'); }
        }
      }
    } else if (p.mode === 2) {
      p.getT -= dt;
      if (p.getT <= 0) startFlee(p, p.srcX, p.srcZ, p.hurt ? 9 : 5 + Math.random() * 3, p.hurt);
    } else if (p.mode === 3) {
      mx = p.fdx; mz = p.fdz; moving = true; resolve = true;
      p.x += mx * p.cur * dt; p.z += mz * p.cur * dt;
      p.fleeT -= dt;
      if (p.fleeT <= 0) resnap(p);
    } else if (p.mode === 5) {
      // éjecté de sa voiture : il titube, puis proteste sur place (tourné vers la voiture) ou s'enfuit
      p.getT -= dt;
      if (p.getT <= 0) {
        if (Math.random() < 0.5) { p.mode = 4; p.watchT = 3 + Math.random() * 4; p.wx = p.srcX; p.wz = p.srcZ; setAnim(p, 'idle', 0); }
        else { p.needSnap = false; startFlee(p, p.srcX, p.srcZ, 4 + Math.random() * 3, false); }
      }
    } else if (p.mode === 4) {
      // badaud : tourné vers l'accident
      mx = p.wx - p.x; mz = p.wz - p.z; moving = true;
      p.watchT -= dt;
      if (p.watchT <= 0) {
        if (p.needSnap) { p.needSnap = false; resnap(p); }
        else { p.mode = 0; if (p.idle || p.stage === 2 || p.stage === 5 || p.stage === 6) setAnim(p, 'idle', 0); else walkAnim(p); }
      }
    } else if (p.dodgeT > 0) {
      p.dodgeT -= dt;
      mx = p.ddx; mz = p.ddz; moving = true; resolve = true;
      p.x += mx * 4.6 * dt; p.z += mz * 4.6 * dt;
      if (p.anim !== 'stumble' || p.dodgeT < 0.5) setAnim(p, 'run', 4.6);
      if (p.dodgeT <= 0) { if (p.idle || p.stage === 2 || p.stage === 5 || p.stage === 6) setAnim(p, 'idle', 0); else walkAnim(p); }
    } else if (p.idle) {
      /* immobile */
    } else if (p.stage === 5) {
      // pause sur la place
      p.waitT -= dt;
      if (p.waitT <= 0) { freeTarget(p); if (p.stage === 4) walkAnim(p); }
    } else if (p.stage === 6) {
      // au bord d'une bretelle : repart dès qu'aucune voiture n'approche (6 s au plus)
      p.waited += dt;
      if (!p.carNear || p.waited >= 6) { p.stage = 1; walkAnim(p); arrive(p); }
    } else if (p.stage === 2) {
      // attend au bord du trottoir que la voie soit libre
      setAnim(p, 'idle', 0);
      p.waitT -= dt; p.waited += dt;
      if (p.waited > 7) { p.cur = p.speed; walkAnim(p); advance(p); }
      else if (p.waitT <= 0 && !p.carNear) {
        const s = hLen[p.h] - p.tEnd;
        p.side = -p.side; p.stage = 3; p.onRoad = true;
        p.tx = sx(p.h, s, p); p.tz = sz(p.h, s, p);
        p.cur = Math.max(p.speed, 1.7);
        walkAnim(p);
      }
    } else {
      const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz), st = p.cur * dt;
      if (d <= st + 0.15) arrive(p);
      else { mx = dx / d; mz = dz / d; p.x += mx * st; p.z += mz * st; moving = true; }
    }
    if (moving) {
      // rotation douce vers la direction de marche (ou vers ce que l'on regarde)
      let da = Math.atan2(-mx, -mz) - p.yaw;
      da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
      p.yaw += da * Math.min(1, dt * 9);
    }
    if (p.tilt !== p.tiltTarget) { // repli sans character.knock : bascule du groupe
      p.tilt += (p.tiltTarget - p.tilt) * Math.min(1, dt * (p.tiltTarget > 0 ? 9 : 3));
      if (Math.abs(p.tilt - p.tiltTarget) < 0.01) { p.tilt = p.tiltTarget; if (p.tilt === 0) p.group.rotation.x = 0; }
    }
    // obstacles statiques (murs, mobilier, parapets de SON niveau) : on glisse ; si on piétine, demi-tour
    p.colT -= dt;
    if (ctx.collision && (p.colT <= 0 || resolve)) {
      const slow = p.colT <= 0;
      if (slow) p.colT = 0.25;
      const r = ctx.collision.resolveCircle(p.x, p.z, 0.35, p.gy + 1);
      if (r.hit) {
        p.x = r.x; p.z = r.z;
        if (p.mode === 1) { p.vx *= 0.3; p.vz *= 0.3; }
        else if (p.mode === 3) { // mur : on longe
          const t = p.fdx * -r.nz + p.fdz * r.nx, s = t >= 0 ? 1 : -1;
          p.fdx = -r.nz * s; p.fdz = r.nx * s;
        } else if (slow && !p.idle && p.dodgeT <= 0 && p.mode === 0 && (p.stage < 2 || p.stage === 4)) {
          p.stallT += 0.25;
          if (p.stallT > 2) { p.stallT = 0; p.stalls++; if (p.free) { if (p.free === 1) p.fdir = -p.fdir; freeTarget(p); } else turnBack(p); }
        }
      } else if (slow && p.stallT > 0) p.stallT -= 0.125;
      if (slow) {
        // flâneur : sur une chaussée (rue piétonne qui croise une rue ouverte aux voitures) ? les voitures doivent le voir
        if (p.free && p.mode === 0) p.onRoad = onRoadAt(p.x, p.z);
        else if (p.mode === 0 && !p.idle && p.stage === 1 && !p.xing) {
          // marcheur dont le trottoir empiète sur une autre chaussée (grandes places) : signalé aux voitures, puis demi-tour
          const on = G.onCarriageway(p.x, p.z, p.gy - baseHeightAt(p.x, p.z), p.h >> 1);
          p.onRoad = on;
          if (on) { p.roadT += 0.25; if (p.roadT > 2.5) { p.roadT = -6; p.stalls++; turnBack(p); } } else if (p.roadT > 0) p.roadT = 0; else if (p.roadT < 0) p.roadT += 0.25;
        }
        const w = ctx.world;
        if (w) {
          // surélévation du trottoir, objets tombés à contourner (extras facultatifs du module ville)
          if (w.surfaceHeightAt && p.hy <= 0) p.yOff = Math.max(0, Math.min(0.3, w.surfaceHeightAt(p.x, p.z, p.gy) - p.gy));
          if (w.propsNear && p.mode !== 1) {
            const near = w.propsNear(p.x, p.z, 1.6);
            if (near && near.length) for (let i = 0; i < near.length; i++) {
              const o = near[i]; if (!o || !isFinite(o.x) || !isFinite(o.z)) continue;
              const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = (o.r || 0.5) + 0.4;
              if (d < min && d > 1e-3) { p.x += (dx / d) * (min - d); p.z += (dz / d) * (min - d); }
            }
          }
        }
      }
    }
    place(p);
  }

  function update(dt, burst) {
    frame++;
    gatherVehicles();
    const fx = T.fx, fz = T.fz, D2 = (T.PED_RADIUS + 20) * (T.PED_RADIUS + 20);
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p.active) continue;
      step(p, dt);
      const dx = p.x - fx, dz = p.z - fz, d2 = dx * dx + dz * dz;
      // un piéton renversé n'est jamais recyclé tant qu'il est dans le champ
      const busy = p.mode === 1 || p.mode === 2;
      if ((d2 > D2 || p.stalls >= 3) && !T.inView(p.x, p.z, p.y) || (d2 > D2 && !busy)) { deactivate(p); continue; }
      // animation : chaque frame de près ou en pleine chute, 1 frame sur 3 de loin
      if (d2 < 60 * 60 || busy) p.ch.update(dt);
      else { p.animAcc += dt; if ((frame + i) % 3 === 0) { p.ch.update(p.animAcc); p.animAcc = 0; } }
    }
    const want = Math.min(target, T.MAX_PEDS);
    for (let n = burst ? 3 : 1; n > 0 && activeCount < want; n--) {
      let spare = null;
      for (let i = 0; i < peds.length; i++) if (!peds[i].active) { spare = peds[i]; break; }
      trySpawn(spare, burst);
    }
    if (peds.length > want + 6) { // réserve trop grande (conducteurs éjectés, densité en baisse) : on libère un personnage inactif
      for (let i = peds.length - 1; i >= 0; i--) if (!peds[i].active) { const q = peds[i]; q.group.removeFromParent(); if (q.ch.dispose) q.ch.dispose(); peds.splice(i, 1); break; }
      for (let i = 0; i < peds.length; i++) peds[i].idx = i;
    }
    if (activeCount > want) {
      for (let i = peds.length - 1; i >= 0; i--) {
        const p = peds[i];
        if (p.active && p.mode === 0 && !T.inView(p.x, p.z, p.y)) { deactivate(p); break; }
      }
    }
  }

  return {
    update, list: peds, alarm, probe, promenades: proms.length,
    setTarget(n) { target = n; },
    get activeCount() { return activeCount; },
    dispose() { for (const p of peds) { p.group.removeFromParent(); p.ch.dispose && p.ch.dispose(); } peds.length = 0; activeCount = 0; },
  };
}

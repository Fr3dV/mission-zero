// « Ragdoll » léger procédural : chute d'un personnage percuté.
// Le corps (rig) bascule autour d'un axe horizontal perpendiculaire au choc, avec éventuellement une vrille autour
// de son axe ; le bassin suit une trajectoire balistique contrainte par le sol (aucune extrémité ne passe dessous) ;
// chaque articulation est un ressort amorti avec butées (inertie des membres, pas de membre retourné) qui tend vers
// une pose « en l'air » puis vers la pose allongée finale (dos / ventre / côté). Ne coûte que pendant la chute.
import * as THREE from 'three';
import { BONE, NB } from './body.js';
import { PN, DY, DX, DZ, liePose } from './anim.js';

const { H, SP, CH, NK, HD, AL, FL, HL, AR, FR, HR, TL, SL, FTL, TR, SR, FTR } = BONE;
// butées articulaires [xmin, xmax, ymin, ymax, zmin, zmax]
const LIM = new Float32Array(NB * 6);
const lim = (b, x0, x1, y0, y1, z0, z1) => LIM.set([x0, x1, y0, y1, z0, z1], b * 6);
lim(H, -0.3, 0.3, -0.3, 0.3, -0.25, 0.25); lim(SP, -0.55, 0.3, -0.35, 0.35, -0.3, 0.3); lim(CH, -0.4, 0.25, -0.35, 0.35, -0.25, 0.25);
lim(NK, -0.45, 0.5, -0.6, 0.6, -0.3, 0.3); lim(HD, -0.4, 0.45, -0.6, 0.6, -0.25, 0.25);
lim(AL, -0.9, 2.8, -0.5, 0.5, -2.7, 0.25); lim(AR, -0.9, 2.8, -0.5, 0.5, -0.25, 2.7);
lim(FL, 0, 2.4, 0, 0, -0.1, 0.4); lim(FR, 0, 2.4, 0, 0, -0.4, 0.1); lim(HL, -0.7, 0.7, 0, 0, -0.3, 0.3); lim(HR, -0.7, 0.7, 0, 0, -0.3, 0.3);
lim(TL, -0.45, 1.9, -0.4, 0.5, -0.75, 0.3); lim(TR, -0.45, 1.9, -0.5, 0.4, -0.3, 0.75);
lim(SL, -2.4, 0, 0, 0, 0, 0); lim(SR, -2.4, 0, 0, 0, 0, 0); lim(FTL, -0.9, 0.5, -0.2, 0.2, 0, 0); lim(FTR, -0.9, 0.5, -0.2, 0.2, 0, 0);
// raideur relative (les extrémités sont plus souples que le tronc)
const STIFF = new Float32Array(NB).fill(1);
for (const b of [H, SP, CH]) STIFF[b] = 2.2;
for (const b of [NK, HD]) STIFF[b] = 1.5;
for (const b of [FL, FR, SL, SR]) STIFF[b] = 0.8;

const N3 = NB * 3, GRAV = 12.5, HEADLEN = 0.8;
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _ax = new THREE.Vector3(), _v = new THREE.Vector3(), YAX = new THREE.Vector3(0, 1, 0);
function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Ragdoll {
  constructor() {
    this.a = new Float32Array(N3); this.v = new Float32Array(N3); this.air = new Float32Array(PN); this.lie = new Float32Array(PN);
    this.q = new THREE.Quaternion(); this.axis = new THREE.Vector3(1, 0, 0);
    this.h = 0.94; this.floor = 0.12; this.face = 'back'; this.touched = false; this.settled = true; this.t = 0;
  }

  /**
   * @param lx, lz direction du choc dans le repère du personnage (normalisée) ; speed en m/s (échelle du squelette)
   * @param pose pose courante (angles + bassin) ; seed : graine des variations
   */
  start(lx, lz, speed, pose, seed) {
    const r = rng(seed), sp = Math.min(speed, 40);
    this.axis.set(-lz, 0, lx).normalize();
    // faible vitesse : on tombe dans le sens de la poussée ; plus vite : les jambes sont fauchées, le buste bascule vers la voiture
    const forward = sp < 4.2 + r() * 1.2;
    const vy0 = Math.min(4.7, 0.7 + sp * 0.2) * (0.85 + 0.3 * r());
    let w0 = Math.min(13, 1.8 + sp * 0.5) * (0.8 + 0.4 * r());
    const tAir = (2 * vy0) / GRAV + 0.18, total = w0 * tAir;
    const n = forward ? 0 : Math.max(0, Math.round((total - Math.PI / 2) / Math.PI));
    this.thF = (Math.PI / 2 + n * Math.PI) * (forward ? -1 : 1);
    this.w = forward ? -w0 * 0.8 : n > 0 ? (Math.abs(this.thF) - 0.3) / tAir : w0;
    this.th = 0;
    // vrille autour de l'axe du corps (plus probable quand ça va vite ou que le choc est de biais)
    const tw = r(), spin = sp > 7 ? 0.55 : 0.3;
    this.phF = tw < 1 - spin ? 0 : (tw < 1 - spin * 0.45 ? (r() < 0.5 ? 1 : -1) * Math.PI / 2 : Math.PI) + (sp > 14 && r() < 0.5 ? Math.PI * 2 : 0);
    this.ph = 0; this.wp = this.phF / Math.max(0.35, tAir);
    this.r1 = r(); this.r2 = r();
    this._rest();
    // pose « en l'air » : membres écartés, désordonnés
    const A = this.air; A.fill(0);
    const s1 = r() < 0.5 ? -1 : 1, e = Math.min(1, sp / 12);
    A[SP * 3] = -0.25 * e; A[CH * 3] = -0.15 * e; A[NK * 3] = 0.25 * (forward ? -1 : 1); A[HD * 3] = 0.15 * (forward ? -1 : 1); A[HD * 3 + 1] = 0.3 * s1;
    A[AL * 3] = 0.6 + 1.2 * r(); A[AL * 3 + 2] = -(0.5 + 1.1 * r()); A[AR * 3] = 0.5 + 1.3 * r(); A[AR * 3 + 2] = 0.5 + 1.1 * r();
    A[FL * 3] = 0.3 + 0.9 * r(); A[FR * 3] = 0.3 + 0.9 * r();
    A[TL * 3] = 0.2 + 0.9 * r(); A[TL * 3 + 2] = -0.35 * r(); A[TR * 3] = 0.1 + 0.9 * r(); A[TR * 3 + 2] = 0.4 * r();
    A[SL * 3] = -0.3 - 1.0 * r(); A[SR * 3] = -0.3 - 1.0 * r(); A[FTL * 3] = -0.3; A[FTR * 3] = -0.3;
    // état initial : pose courante + impulsions (les jambes partent dans le sens du choc)
    for (let i = 0; i < N3; i++) { this.a[i] = pose[i]; this.v[i] = (r() - 0.5) * Math.min(9, 1.5 + sp * 0.5); }
    const kick = Math.min(10, sp * 0.9) * (forward ? -0.4 : 1);
    this.v[SL * 3] -= 4 + 5 * r(); this.v[SR * 3] -= 4 + 5 * r(); this.v[TL * 3] += 2 + 3 * r(); this.v[TR * 3] += 2 + 3 * r(); // les genoux cèdent
    this.v[TL * 3] += -lz * kick * (0.6 + 0.5 * r()); this.v[TR * 3] += -lz * kick * (0.6 + 0.5 * r());
    this.v[TL * 3 + 2] += lx * kick * 0.5; this.v[TR * 3 + 2] += lx * kick * 0.5;
    this.v[SP * 3] += lz * kick * 0.25; this.v[NK * 3] += lz * kick * 0.35; this.v[NK * 3 + 2] -= lx * kick * 0.3;
    this.h = 0.94 + pose[DY]; this.vh = vy0; this.dx = pose[DX]; this.dz = pose[DZ];
    this.touched = false; this.bounced = false; this.settled = false; this.t = 0; this.tTouch = 0; this.rnd = r; this.impact = 0;
    this._setQ(0, 0);
  }

  /** Face finale (dos / ventre / côté) et pose allongée correspondant à l'orientation de repos visée. */
  _rest() {
    this._setQ(this.thF, this.phF);
    const up = _v.set(0, 0, -1).applyQuaternion(this.q).y;
    this.face = up > 0.5 ? 'back' : up < -0.5 ? 'front' : 'side';
    this.floor = this.face === 'side' ? 0.165 : 0.118;
    liePose(this.lie, this.face, this.r1, this.r2, this.floor);
  }

  _setQ(th, ph) { _qa.setFromAxisAngle(this.axis, th); _qb.setFromAxisAngle(YAX, ph); this.q.copy(_qa).multiply(_qb); }

  step(dt) {
    if (this.settled) return;
    const n = dt > 0.022 ? 2 : 1, h = dt / n;
    for (let s = 0; s < n; s++) this._sub(h);
  }

  _sub(dt) {
    this.t += dt;
    const remain = (this.thF - this.th) * Math.sign(this.thF);
    const springMode = this.touched || remain < 0.45;
    if (springMode) {
      // au contact du sol (ou en fin de rotation) : le corps s'aplatit vers son orientation de repos
      this.w += (42 * (this.thF - this.th) - 10.5 * this.w) * dt;
      this.wp += (40 * (this.phF - this.ph) - 10.5 * this.wp) * dt;
    }
    this.th += this.w * dt; this.ph += this.wp * dt;
    this.vh -= GRAV * dt; this.h += this.vh * dt;
    // contrainte de sol : ni les pieds ni la tête ne passent dessous
    const c = Math.cos(this.th), hmin = this.floor + Math.abs(c) * (c > 0 ? 0.94 - this.floor : HEADLEN);
    if (this.h <= hmin) {
      if (!this.touched && this.t > 0.06) {
        this.touched = true; this.tTouch = this.t;
        // premier contact : on vise l'orientation de repos la plus proche dans le sens de la rotation (pas de salto « réussi »)
        const la = this.th + this.w * 0.22, m = Math.round((la - Math.PI / 2) / Math.PI);
        this.thF = Math.PI / 2 + m * Math.PI;
        this.phF = Math.round((this.ph + this.wp * 0.2) / (Math.PI / 2)) * (Math.PI / 2);
        this._rest();
      }
      if (this.vh < -1.6 && Math.abs(c) < 0.45 && !this.bounced) { // impact à plat : petit rebond amorti + secousse des membres
        this.bounced = true; this.impact = -this.vh;
        const r = this.rnd, k = Math.min(6, -this.vh * 1.4);
        for (let i = 0; i < N3; i++) this.v[i] += (r() - 0.5) * k;
        this.vh = -this.vh * 0.24; this.h = hmin + 0.001;
      } else { this.h = hmin; if (this.vh < 0) this.vh = 0; }
    }
    this._setQ(this.th, this.ph);
    // articulations : ressorts amortis vers la pose cible, avec traînée due à la rotation du corps
    const tgt = springMode ? this.lie : this.air, K = springMode ? 85 : 34, C = springMode ? 15 : 5.5;
    const lag = springMode ? 0 : this.w * 0.05, a = this.a, v = this.v;
    let vmax = 0;
    for (let b = 0; b < NB - 1; b++) {
      const kb = K * STIFF[b], cb = C * (0.7 + 0.3 * STIFF[b]);
      for (let j = 0; j < 3; j++) {
        const i = b * 3 + j, lo = LIM[b * 6 + j * 2], hi = LIM[b * 6 + j * 2 + 1];
        let t = tgt[i];
        if (j === 0 && lag && (b === AL || b === AR || b === TL || b === TR)) t -= lag * this.axis.x * 6;
        v[i] += (kb * (t - a[i]) - cb * v[i]) * dt;
        a[i] += v[i] * dt;
        const av = v[i] < 0 ? -v[i] : v[i]; if (av > vmax) vmax = av;
        if (a[i] < lo) { a[i] = lo; if (v[i] < 0) v[i] *= -0.2; } else if (a[i] > hi) { a[i] = hi; if (v[i] > 0) v[i] *= -0.2; }
      }
    }
    this.dx += (0 - this.dx) * Math.min(1, dt * 5); this.dz += (0 - this.dz) * Math.min(1, dt * 5);
    // repos
    if (this.touched && this.t - this.tTouch > 0.75 && Math.abs(this.thF - this.th) < 0.03 && Math.abs(this.w) < 0.25 && this.h - this.floor < 0.012 && (vmax < 0.5 || this.t - this.tTouch > 2.2)) {
      this.settled = true; this.th = this.thF; this.ph = this.phF; this._setQ(this.th, this.ph); this.h = this.floor;
      for (let i = 0; i < N3; i++) this.lie[i] = a[i];
      this.lie[DX] = 0; this.lie[DY] = this.floor - 0.94; this.lie[DZ] = 0;
    }
  }
}

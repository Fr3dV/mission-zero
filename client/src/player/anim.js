// Animations procédurales. Chaque pose remplit P = [NB × 3 angles d'Euler XYZ] + [dx, dy, dz] du bassin.
// Conventions : rotation X > 0 = le membre part vers l'avant (−Z) ; buste X < 0 = penché en avant ; gauche = −X.
// Les jambes en marche/course sont résolues par cinématique inverse sur une trajectoire de cheville calée sur la
// vitesse réelle (le pied d'appui ne glisse pas).
import { BONE, NB, HIP_Y, KNEE_Y, ANKLE_Y } from './body.js';

const { H, SP, CH, NK, HD, AL, FL, HL, AR, FR, HR, TL, SL, FTL, TR, SR, FTR } = BONE;
export const PN = NB * 3 + 3, DX = NB * 3, DY = NB * 3 + 1, DZ = NB * 3 + 2;
export const SIT_ROOT_Y = 0.5; // hauteur du bassin (os racine) au-dessus de l'origine du groupe en pose assise
const L1 = HIP_Y - KNEE_Y, L2 = KNEE_Y - ANKLE_Y, REACH = (L1 + L2) * 0.995;
const TAU = Math.PI * 2;
const set = (P, b, x, y = 0, z = 0) => { P[b * 3] = x; P[b * 3 + 1] = y; P[b * 3 + 2] = z; };
const pos = (v) => (v > 0 ? v : 0);
const fr = (v) => v - Math.floor(v);
const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Jambe : phase p (0 = pose du talon), fraction d'appui beta, course d'appui Sh, hauteur de levée, hauteur de hanche. */
function leg(P, T, S, F, p, beta, Sh, lift, hipY, pelvisPitch, run) {
  let f, fp, ya; const shift = run ? 0.1 : 0.04;
  if (p < beta) { // appui : le pied reste au sol, la hanche avance
    const u = p / beta;
    fp = u < 0.16 ? 0.3 * (1 - u / 0.16) * (run ? 0.3 : 1) : u > 0.62 ? -0.8 * Math.pow((u - 0.62) / 0.38, 1.6) : 0;
    f = Sh * (0.5 - u) - shift;
    if (fp < 0) { const a = -fp; f += 0.08 * Math.sin(a) + 0.14 * (1 - Math.cos(a)); ya = ANKLE_Y + 0.14 * Math.sin(a); }
    else ya = ANKLE_Y + 0.05 * Math.sin(fp);
  } else { // balancement
    const q = (p - beta) / (1 - beta), e = sm(q), a0 = 0.8;
    const f0 = -Sh * 0.5 - shift + 0.08 * Math.sin(a0) + 0.14 * (1 - Math.cos(a0)), y0 = ANKLE_Y + 0.14 * Math.sin(a0);
    const hs = run ? 0.09 : 0.3;
    f = f0 + (Sh * 0.5 - shift - f0) * e;
    fp = -a0 * (1 - sm(Math.min(1, q * 1.5))) + hs * sm((q - 0.55) / 0.45);
    ya = y0 + (ANKLE_Y + 0.05 * Math.sin(hs) - y0) * e + lift * Math.pow(Math.sin(Math.PI * Math.pow(q, 0.75)), 1.2);
  }
  const dy = hipY - ya;
  let d = Math.hypot(f, dy);
  if (d > REACH) d = REACH;
  const th = Math.atan2(f, dy) + Math.acos(Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
  const k = Math.PI - Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
  P[T * 3] = th - pelvisPitch; P[S * 3] = -k; P[F * 3] = fp - (th - k);
}

export const POSES = {
  idle(P, t, g) {
    const ph = g.phase, br = Math.sin(t * 1.55 + ph), w = Math.sin(t * 0.33 + ph * 2), w2 = Math.sin(t * 0.21 + ph);
    const sh = (w + 0.4 * w2) * 0.7; // transfert de poids d'une jambe sur l'autre
    const lookY = (Math.sin(t * 0.27 + ph * 3) + 0.6 * Math.sin(t * 0.61 + ph)) * 0.2 * g.look, lookX = Math.sin(t * 0.19 + ph * 5) * 0.05;
    set(P, H, -g.stoop * 0.3, 0.04 * sh, 0.045 * sh);
    set(P, SP, 0.012 * br - g.stoop * 0.5, -0.02 * sh, -0.028 * sh);
    set(P, CH, -0.025 + 0.028 * br - g.stoop * 0.6, lookY * 0.15, -0.014 * sh);
    set(P, NK, 0.04 + g.stoop * 0.6 + lookX, lookY * 0.35, -0.003 * sh);
    set(P, HD, -0.03 - 0.012 * br, lookY * 0.5, 0);
    set(P, AL, 0.05 + 0.01 * br - 0.02 * sh, 0.1, -0.055 - 0.012 * br);
    set(P, AR, 0.05 + 0.01 * br + 0.02 * sh, -0.1, 0.055 + 0.012 * br);
    set(P, FL, 0.24 + 0.02 * br, 0, 0.03); set(P, FR, 0.24 + 0.02 * br, 0, -0.03);
    set(P, HL, 0.1, 0, 0.06); set(P, HR, 0.1, 0, -0.06);
    // jambe d'appui tendue, l'autre légèrement fléchie
    const fl = pos(sh) * 0.14, frr = pos(-sh) * 0.14;
    set(P, TL, 0.03 + fl, g.toeOut, -0.03 - 0.045 * sh); set(P, TR, 0.03 + frr, -g.toeOut, 0.03 - 0.045 * sh);
    set(P, SL, -0.05 - fl * 2); set(P, SR, -0.05 - frr * 2);
    set(P, FTL, 0.02 + fl, 0, 0); set(P, FTR, 0.02 + frr, 0, 0);
    P[DX] = -0.022 * sh; P[DY] = -0.003 + 0.002 * br - 0.004 * Math.abs(sh); P[DZ] = 0;
  },

  walk(P, t, g, phi, v) {
    const stride = (0.68 + 0.44 * v) / g.cadence;
    const beta = Math.min(0.57, 0.8 / stride), Sh = beta * stride;
    const pL = fr(phi / TAU), pR = fr(pL + 0.5), k = Math.min(1.2, Sh / 0.8);
    const r = Sh / 2 - 0.04, base = ANKLE_Y + 0.015 + Math.sqrt(Math.max(0.3, REACH * REACH - r * r));
    const mid = Math.cos(TAU * 2 * (pL - beta / 2));
    const hipY = Math.min(HIP_Y - 0.004, base + Math.max(0, Math.min(0.03 * g.bounce, HIP_Y - 0.006 - base)) * (0.5 + 0.5 * mid));
    const lat = Math.cos(TAU * (pL - beta / 2)), c = Math.cos(TAU * pL);
    const pitch = -0.025 - g.stoop * 0.3 - 0.012 * v;
    set(P, H, pitch, -0.085 * k * c, -0.045 * g.sway * lat);
    set(P, SP, -0.015 - g.stoop * 0.5, 0.05 * k * c, 0.026 * g.sway * lat);
    set(P, CH, -0.01 - g.stoop * 0.6, 0.09 * k * c, 0.014 * g.sway * lat);
    set(P, NK, 0.03 + g.stoop * 0.6, -0.03 * k * c, 0);
    set(P, HD, 0.015, -0.025 * k * c, 0.004 * lat);
    const a = 0.34 * g.arm * k, sw = Math.cos(TAU * pL - 0.25);
    set(P, AL, -a * sw + 0.03, 0.08, -0.06); set(P, AR, a * sw + 0.03, -0.08, 0.06);
    set(P, FL, 0.2 + 0.26 * g.arm * pos(-sw) + 0.05 * v, 0, 0.04); set(P, FR, 0.2 + 0.26 * g.arm * pos(sw) + 0.05 * v, 0, -0.04);
    set(P, HL, 0.12, 0, 0.05); set(P, HR, 0.12, 0, -0.05);
    set(P, TL, 0, g.toeOut, -0.015 + 0.03 * g.sway * lat); set(P, TR, 0, -g.toeOut, 0.015 + 0.03 * g.sway * lat);
    set(P, SL, 0); set(P, SR, 0); set(P, FTL, 0); set(P, FTR, 0);
    leg(P, TL, SL, FTL, pL, beta, Sh, 0.05, hipY, pitch, false);
    leg(P, TR, SR, FTR, pR, beta, Sh, 0.05, hipY, pitch, false);
    P[DX] = -0.02 * g.sway * lat; P[DY] = hipY - HIP_Y; P[DZ] = 0;
  },

  run(P, t, g, phi, v) {
    const stride = (1.25 + 0.34 * v) / g.cadence, Sh = Math.min(0.78, 0.46 + 0.05 * v), beta = Sh / stride;
    const pL = fr(phi / TAU), pR = fr(pL + 0.5);
    const r = Sh / 2 - 0.1, base = Math.min(0.868, ANKLE_Y + 0.015 + Math.sqrt(Math.max(0.3, REACH * REACH - r * r)));
    const osc = Math.cos(TAU * 2 * (pL - beta / 2)); // +1 au milieu de l'appui, −1 en suspension
    const hipY = Math.min(HIP_Y, base - 0.028 * (0.5 + 0.5 * osc) + 0.03 * g.bounce * (0.5 - 0.5 * osc));
    const lat = Math.cos(TAU * (pL - beta / 2)), c = Math.cos(TAU * pL);
    const pitch = -0.13 - 0.012 * v - g.stoop * 0.3;
    set(P, H, pitch, -0.15 * c, -0.04 * lat);
    set(P, SP, -0.07, 0.1 * c, 0.02 * lat);
    set(P, CH, -0.05, 0.19 * c, 0.012 * lat);
    set(P, NK, 0.1, -0.07 * c, 0);
    set(P, HD, 0.12, -0.07 * c, 0);
    const a = 0.72 * (0.8 + 0.2 * g.arm), sw = Math.cos(TAU * pL - 0.2);
    set(P, AL, -a * sw + 0.1, 0.15, -0.1); set(P, AR, a * sw + 0.1, -0.15, 0.1);
    set(P, FL, 1.45 - 0.3 * sw, 0, 0.3); set(P, FR, 1.45 + 0.3 * sw, 0, -0.3);
    set(P, HL, 0.15, 0, 0.1); set(P, HR, 0.15, 0, -0.1);
    set(P, TL, 0, 0.03, -0.015); set(P, TR, 0, -0.03, 0.015);
    set(P, SL, 0); set(P, SR, 0); set(P, FTL, 0); set(P, FTR, 0);
    leg(P, TL, SL, FTL, pL, beta, Sh, 0.3, hipY, pitch, true);
    leg(P, TR, SR, FTR, pR, beta, Sh, 0.3, hipY, pitch, true);
    P[DX] = -0.012 * lat; P[DY] = hipY - HIP_Y; P[DZ] = 0;
  },

  sit(P, t, g, phi, v, st) {
    const br = Math.sin(t * 1.5 + g.phase), r = st.recline, steer = st.steer || 0;
    set(P, H, r, 0, 0);
    set(P, SP, -0.05, 0, -0.03 * steer);
    set(P, CH, -0.04 + 0.014 * br, -0.04 * steer, -0.03 * steer);
    set(P, NK, -r * 0.45, -0.1 * steer, 0);
    set(P, HD, -r * 0.4, -0.12 * steer + 0.04 * Math.sin(t * 0.4 + g.phase), 0.04 * steer);
    set(P, AL, 1.0 - r * 0.5, 0, 0.1); set(P, AR, 1.0 - r * 0.5, 0, -0.1);
    set(P, FL, 0.6, 0, 0.1); set(P, FR, 0.6, 0, -0.1);
    set(P, HL, 0.25, 0, 0); set(P, HR, 0.25, 0, 0);
    set(P, TL, 1.36 - r, 0, -0.1); set(P, TR, 1.4 - r, 0, 0.09);
    set(P, SL, -1.0); set(P, SR, -0.82);
    set(P, FTL, 0.2); set(P, FTR, 0.05);
    P[DX] = 0; P[DY] = SIT_ROOT_Y - 0.94; P[DZ] = 0;
  },

  jump(P) {
    set(P, H, -0.08); set(P, SP, -0.04); set(P, CH, -0.04); set(P, NK, 0.05); set(P, HD, 0.05);
    set(P, AL, 0.75, 0, -0.3); set(P, AR, -0.35, 0, 0.3);
    set(P, FL, 0.8); set(P, FR, 0.5); set(P, HL, 0.1); set(P, HR, 0.1);
    set(P, TL, 0.95); set(P, TR, -0.1);
    set(P, SL, -1.25); set(P, SR, -0.5);
    set(P, FTL, -0.1); set(P, FTR, -0.5);
    P[DX] = 0; P[DY] = 0; P[DZ] = 0;
  },

  fall(P, t) {
    const w = Math.sin(t * 9) * 0.05;
    set(P, H, 0.02); set(P, SP, 0.02); set(P, CH, 0.03); set(P, NK, 0); set(P, HD, -0.08);
    set(P, AL, 0.15 + w, 0, -0.95); set(P, AR, 0.15 - w, 0, 0.95);
    set(P, FL, 0.35); set(P, FR, 0.35); set(P, HL, 0.1); set(P, HR, 0.1);
    set(P, TL, 0.4, 0, -0.08); set(P, TR, 0.05, 0, 0.08);
    set(P, SL, -0.55); set(P, SR, -0.3);
    set(P, FTL, -0.3); set(P, FTR, -0.3);
    P[DX] = 0; P[DY] = 0; P[DZ] = 0;
  },
};
export const ANIMS = Object.keys(POSES);

/** Vitesse de phase (rad/s) pour une vitesse v (m/s, à l'échelle du squelette de référence). */
export function phaseRate(v, runW, cadence) {
  const sw = (0.68 + 0.44 * v) / cadence, sr = (1.25 + 0.34 * v) / cadence;
  return (TAU * v) / (sw + (sr - sw) * runW);
}

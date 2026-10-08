// ============================================================
// coachAvatar — the virtual coach (male / female) standing at the side of the screen (owner, 2026-10-08)
//
// PURE pose logic + a canvas drawer. The coach is a real character (skin, tracksuit, hair, face,
// whistle), drawn with the same body engine as the Ghost (warmupGhost.drawFigure), so when it
// demonstrates it performs EXACTLY the Ghost's movement (the same profile, the same striking
// surface and shadow ball). Between demonstrations it stands, breathes, talks (its mouth moves
// and the head nods while the coach's voice speaks) and claps after a finished set.
// ============================================================

import { ghostPose, drawFigure, drawShadowBall, drawStrikeSurface, shadowBallAt, periodOf, phaseOf } from './warmupGhost.js';

export const COACH_IDS = ['male', 'female'];

const t = (he, en) => ({ he, en });
export const COACH_INFO = Object.freeze({
  male: { label: t('המאמן שלך', 'Your coach'), choice: t('מאמן', 'Male coach'), icon: '🧔' },
  female: { label: t('המאמנת שלך', 'Your coach'), choice: t('מאמנת', 'Female coach'), icon: '👩' },
});

const LOOKS = {
  male: {
    palette: {
      skin: ['#f2c29b', '#d39a72'], jersey: ['#2563eb', '#1e3a8a'], pants: '#111827', stripe: 'rgba(255,255,255,0.85)',
      boot: '#f8fafc', outline: 'rgba(15, 23, 42, 0.8)', far: 'rgba(15, 23, 42, 0.25)', shorts: '#111827',
    },
    hair: '#3b2a1d',
  },
  female: {
    palette: {
      skin: ['#f6d0b1', '#dca27c'], jersey: ['#db2777', '#9d174d'], pants: '#1f2937', stripe: 'rgba(255,255,255,0.85)',
      boot: '#f8fafc', outline: 'rgba(15, 23, 42, 0.8)', far: 'rgba(15, 23, 42, 0.25)', shorts: '#1f2937',
    },
    hair: '#5b3a29',
  },
};

/**
 * The coach's look for drawFigure: tracksuit (sleeves + long pants with a stripe), white shoes,
 * hair, a face that talks, and a whistle on a lanyard.
 * @param {'male'|'female'} coach
 * @param {{ talk?: number }} [state] - talk 0..1 = how open the mouth is right now
 */
export function coachLook(coach, state = {}) {
  const L = LOOKS[coach] || LOOKS.male;
  const female = coach === 'female';
  return {
    palette: L.palette,
    pants: true,
    sleeves: true,
    head(ctx, h, rx, ry, layer, turn) {
      const side = turn || 0;                         // the face turns with a 3/4 view
      if (layer === 'behind') {
        if (!female) return;
        // ponytail + volume behind the head
        ctx.fillStyle = L.hair;
        ctx.beginPath();
        ctx.ellipse(h.x - side * rx * 0.55, h.y - ry * 0.1, rx * 1.12, ry * 1.08, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(h.x - (side || 1) * rx * 1.05, h.y + ry * 0.55, rx * 0.36, ry * 0.85, (side || 1) * -0.35, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      // hair on top
      ctx.fillStyle = L.hair;
      ctx.beginPath();
      ctx.ellipse(h.x, h.y - ry * (female ? 0.28 : 0.38), rx * (female ? 1.04 : 1.02), ry * (female ? 0.78 : 0.66), 0, Math.PI, Math.PI * 2);
      ctx.fill();
      // face (turned with the body in a 3/4 view)
      const fx = h.x + side * rx * 0.28;
      const eyeY = h.y + ry * 0.02, eyeDx = rx * 0.34, eyeR = Math.max(1, rx * 0.09);
      ctx.fillStyle = '#1f2937';
      for (const k of [-1, 1]) {
        ctx.beginPath(); ctx.arc(fx + k * eyeDx, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = female ? 'rgba(91, 58, 41, 0.9)' : 'rgba(59, 42, 29, 0.95)';
      ctx.lineWidth = Math.max(1, rx * 0.07);
      for (const k of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(fx + k * eyeDx - rx * 0.13, eyeY - ry * 0.2); ctx.lineTo(fx + k * eyeDx + rx * 0.13, eyeY - ry * 0.23); ctx.stroke();
      }
      // mouth: a smile at rest, opening while the coach talks
      const talk = Math.max(0, Math.min(1, state.talk || 0));
      const my = h.y + ry * 0.48;
      ctx.fillStyle = '#7f1d1d';
      ctx.strokeStyle = '#7f1d1d';
      if (talk > 0.08) {
        ctx.beginPath(); ctx.ellipse(fx, my, rx * 0.2, ry * (0.05 + 0.13 * talk), 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.lineWidth = Math.max(1, rx * 0.07);
        ctx.beginPath(); ctx.arc(fx, my - ry * 0.1, rx * 0.24, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
      }
    },
    torsoExtras(ctx, pts, scale) {
      // whistle on a lanyard
      const cx = (pts.ls.x + pts.rs.x) / 2, cy = pts.ls.y + (pts.lh.y - pts.ls.y) * 0.32;
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.9)';
      ctx.lineWidth = Math.max(1, scale * 0.02);
      ctx.beginPath();
      ctx.moveTo(pts.ls.x + (pts.rs.x - pts.ls.x) * 0.3, pts.ls.y);
      ctx.lineTo(cx, cy);
      ctx.lineTo(pts.ls.x + (pts.rs.x - pts.ls.x) * 0.7, pts.rs.y);
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath(); ctx.ellipse(cx, cy + scale * 0.03, scale * 0.07, scale * 0.045, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = Math.max(1, scale * 0.012); ctx.stroke();
    },
  };
}

/**
 * What the coach does in a training phase:
 *   demo  — performs the current exercise / warm-up move with the Ghost
 *   cheer — claps / encourages (right after a finished set, at the start of a rest)
 *   idle  — stands ready, breathing, talking when it speaks
 */
export function coachMode({ phase, hasSpec, justFinished = false }) {
  if (justFinished) return 'cheer';
  if (hasSpec && ['warm_up', 'briefing', 'checking_equipment', 'calibrating', 'exercising'].includes(phase)) return 'demo';
  return 'idle';
}

/** Body pose of the coach at animation time `ms`. */
export function coachPose(mode, spec, lp, ms, talking = false) {
  if (mode === 'demo' && spec) return ghostPose(spec, phaseOf(ms, periodOf(spec)), lp);
  if (mode === 'cheer') {
    // celebrating: arms up in a V, fists pumping
    return ghostPose({ move: 'arm_circles', targetDeg: 165 }, phaseOf(ms, 650), lp);
  }
  // idle: standing, breathing (shoulders / head rise a little), a nod while talking
  const pose = ghostPose({ move: 'idle' }, 0, lp);
  const breath = 0.025 * Math.sin((2 * Math.PI * ms) / 3800);
  const nod = talking ? 0.03 * Math.sin((2 * Math.PI * ms) / 420) : 0;
  const up = (p, k = 1) => (p && typeof p.y === 'number' && p.y < -0.3 ? { ...p, y: p.y + breath * k } : p);
  return {
    ...pose,
    segments: pose.segments.map(sg => ({ ...sg, from: up(sg.from), to: up(sg.to) })),
    torso: Object.fromEntries(Object.entries(pose.torso).map(([k, v]) => [k, up(v)])),
    neck: up(pose.neck),
    head: { ...pose.head, y: pose.head.y + breath + nod },
  };
}

/**
 * Draw the coach in its own panel canvas (raw coords; the canvas is mirrored on screen like the
 * camera, so the coach moves like the trainee's reflection).
 */
export function drawCoach(ctx, coach, { mode, spec, lp, ms, talk = 0 }, w, h) {
  const pose = coachPose(mode, spec, lp, ms, talk > 0);
  // a light "studio" card so the coach stands out from the camera picture
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, 'rgba(15, 23, 42, 0.55)');
  bg.addColorStop(1, 'rgba(30, 41, 59, 0.35)');
  ctx.fillStyle = bg;
  ctx.beginPath();
  const rad = Math.min(16, w * 0.1);
  if (ctx.roundRect) ctx.roundRect(1, 1, w - 2, h - 2, rad); else ctx.rect(1, 1, w - 2, h - 2);
  ctx.fill();
  const scale = Math.min(h / 4.6, w / 3.4);
  const ox = w / 2, oy = h * 0.5;
  const P = (p) => ({ x: ox + p.x * scale, y: oy + p.y * scale });
  drawFigure(ctx, pose, P, scale, { floorShadow: true, glow: false, look: coachLook(coach, { talk }) });
  if (mode === 'demo' && spec) {
    const t = phaseOf(ms, periodOf(spec));
    drawShadowBall(ctx, shadowBallAt(spec, t, lp), pose, P, scale, true);
    drawStrikeSurface(ctx, pose, P, scale, true);
  }
}

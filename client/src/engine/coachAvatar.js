// ============================================================
// coachAvatar — the virtual coach (male / female) standing at the side of the screen (owner, 2026-10-08)
//
// PURE pose logic + a canvas drawer. The coach is a real character (skin, tracksuit, hair, face,
// a clean athletic silhouette with the coach's body type), drawn with the same body engine as the
// Ghost (warmupGhost.drawFigure), so when it
// demonstrates it performs EXACTLY the Ghost's movement (the same profile, the same striking
// surface and shadow ball). Between demonstrations it stands, breathes, nods while the coach's voice
// speaks (a sound wave shows it talking) and celebrates a finished set.
// ============================================================

import { ghostPose, drawFigure, drawShadowBall, drawStrikeSurface, shadowBallAt, periodOf, phaseOf } from './warmupGhost.js';

export const COACH_IDS = ['male', 'female'];

const t = (he, en) => ({ he, en });
export const COACH_INFO = Object.freeze({
  male: { label: t('המאמן שלך', 'Your coach'), choice: t('מאמן', 'Male coach'), icon: '🧔' },
  female: { label: t('המאמנת שלך', 'Your coach'), choice: t('מאמנת', 'Female coach'), icon: '👩' },
});

// A clean, professional look (owner, field test: "the cartoon coach looks like a joke"): an athletic
// silhouette like the figures of professional training apps — no cartoon face, a monochrome
// performance tracksuit with ONE accent colour, a real body type per coach (shoulders / waist /
// hips, limb build) and a hair silhouette. Talking is shown outside the figure (a sound wave).
const LOOKS = {
  male: {
    palette: {
      skin: ['#475569', '#1e293b'], jersey: ['#334155', '#0f172a'], pants: '#111827', stripe: '#38bdf8',
      boot: '#f8fafc', outline: 'rgba(2, 6, 23, 0.85)', far: 'rgba(148, 163, 184, 0.28)', shorts: '#111827',
    },
    accent: '#38bdf8',
    hair: '#0b1220',
    torsoShape: { shoulder: 1.08, waist: 0.96, hip: 0.94 },
    limbScale: 1.36,
  },
  female: {
    palette: {
      skin: ['#4b5563', '#1f2937'], jersey: ['#374151', '#111827'], pants: '#111827', stripe: '#fb7185',
      boot: '#f8fafc', outline: 'rgba(2, 6, 23, 0.85)', far: 'rgba(148, 163, 184, 0.28)', shorts: '#111827',
    },
    accent: '#fb7185',
    hair: '#0b1220',
    torsoShape: { shoulder: 0.9, waist: 0.8, hip: 1.1 },
    limbScale: 1.18,
  },
};

/**
 * The coach's look for drawFigure: a performance tracksuit (sleeves + long pants with an accent
 * stripe), white shoes, a hair silhouette, the body type of the coach, and a zip line + collar.
 * @param {'male'|'female'} coach
 */
export function coachLook(coach) {
  const L = LOOKS[coach] || LOOKS.male;
  const female = coach === 'female';
  return {
    palette: L.palette,
    pants: true,
    sleeves: true,
    torsoShape: L.torsoShape,
    limbScale: L.limbScale,
    outlineScale: 0.6,
    stripeSide: true,
    head(ctx, h, rx, ry, layer, turn) {
      const side = turn || 0;
      ctx.fillStyle = L.hair;
      if (layer === 'behind') {
        if (!female) return;
        // a low bun / ponytail behind the head
        ctx.beginPath();
        ctx.ellipse(h.x - (side || 0.6) * rx * 0.85, h.y + ry * 0.2, rx * 0.42, ry * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      // hair line: short for the coach, pulled back for the female coach (no face — a clean figure)
      ctx.beginPath();
      ctx.ellipse(h.x - side * rx * 0.08, h.y - ry * (female ? 0.22 : 0.3), rx * 1.02, ry * (female ? 0.82 : 0.72), 0, Math.PI, Math.PI * 2);
      ctx.fill();
    },
    torsoExtras(ctx, pts, scale) {
      // collar + a zip line in the accent colour
      const top = { x: (pts.ls.x + pts.rs.x) / 2, y: (pts.ls.y + pts.rs.y) / 2 };
      const bottom = { x: (pts.lh.x + pts.rh.x) / 2, y: (pts.lh.y + pts.rh.y) / 2 };
      ctx.strokeStyle = L.accent;
      ctx.lineWidth = Math.max(1, scale * 0.028);
      ctx.beginPath(); ctx.moveTo(top.x, top.y + scale * 0.05); ctx.lineTo(bottom.x, bottom.y - scale * 0.08); ctx.stroke();
      ctx.lineWidth = Math.max(1, scale * 0.035);
      ctx.beginPath();
      ctx.moveTo(top.x - scale * 0.12, top.y - scale * 0.01);
      ctx.lineTo(top.x, top.y + scale * 0.07);
      ctx.lineTo(top.x + scale * 0.12, top.y - scale * 0.01);
      ctx.stroke();
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
  // a light studio card (soft gradient + floor line): the dark athletic figure stands out cleanly
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, 'rgba(248, 250, 252, 0.94)');
  bg.addColorStop(1, 'rgba(203, 213, 225, 0.94)');
  ctx.fillStyle = bg;
  ctx.beginPath();
  const rad = Math.min(16, w * 0.1);
  if (ctx.roundRect) ctx.roundRect(1, 1, w - 2, h - 2, rad); else ctx.rect(1, 1, w - 2, h - 2);
  ctx.fill();
  const scale = Math.min(h / 4.6, w / 3.4);
  const ox = w / 2, oy = h * 0.5;
  const P = (p) => ({ x: ox + p.x * scale, y: oy + p.y * scale });
  drawFigure(ctx, pose, P, scale, { floorShadow: true, glow: false, look: coachLook(coach) });
  if (mode === 'demo' && spec) {
    const t = phaseOf(ms, periodOf(spec));
    drawShadowBall(ctx, shadowBallAt(spec, t, lp), pose, P, scale, true);
    drawStrikeSurface(ctx, pose, P, scale, true);
  }
}

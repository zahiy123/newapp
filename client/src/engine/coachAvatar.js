// ============================================================
// coachAvatar — the virtual coach (male / female) standing at the side of the screen (owner, 2026-10-08)
//
// PURE pose logic + a canvas drawer. The coach is a realistic person — skin with volume, a calm face,
// real hair, a short-sleeved training top, long pants and sneakers — drawn with the same body engine
// as the Ghost (warmupGhost.drawFigure), so when it demonstrates it performs EXACTLY the Ghost's
// movement (the same profile, the same striking surface and shadow ball). Between demonstrations it
// stands and breathes, talks (the mouth moves, a sound wave by its name) and celebrates a finished set.
// ============================================================

import { ghostPose, drawFigure, drawShadowBall, drawStrikeSurface, shadowBallAt, periodOf, phaseOf } from './warmupGhost.js';

export const COACH_IDS = ['male', 'female'];

const t = (he, en) => ({ he, en });
export const COACH_INFO = Object.freeze({
  male: { label: t('המאמן שלך', 'Your coach'), choice: t('מאמן', 'Male coach'), icon: '🧔' },
  female: { label: t('המאמנת שלך', 'Your coach'), choice: t('מאמנת', 'Female coach'), icon: '👩' },
});

// A realistic coach (owner, 2026-10-12: "not a cartoon, not a cardboard silhouette — a real, clean,
// respectable person who clearly demonstrates"): real skin tones with volume (every limb shaded
// like a cylinder lit from the upper left), a calm face with natural proportions (eyes, brows, a
// soft nose shadow, ears, a mouth that moves while the coach talks), real hair, and real training
// clothes — a short-sleeved top, long training pants with a side stripe, white sneakers.
const LOOKS = {
  male: {
    palette: {
      skin: ['#e9b993', '#c98f68'], jersey: ['#1d4ed8', '#1e3a8a'], pants: '#111827', stripe: '#e2e8f0',
      boot: '#f8fafc', outline: 'rgba(30, 20, 15, 0.55)', far: 'rgba(15, 23, 42, 0.22)', shorts: '#111827',
    },
    hair: ['#3a2a1e', '#1f150e'],
    torsoShape: { shoulder: 1.08, waist: 0.96, hip: 0.94 },
    limbScale: 1.3,
    lips: '#a5615a',
  },
  female: {
    palette: {
      skin: ['#f1c6a5', '#d39b78'], jersey: ['#be185d', '#831843'], pants: '#111827', stripe: '#fbcfe8',
      boot: '#f8fafc', outline: 'rgba(30, 20, 15, 0.5)', far: 'rgba(15, 23, 42, 0.22)', shorts: '#111827',
    },
    hair: ['#4a2f20', '#2b1a10'],
    torsoShape: { shoulder: 0.9, waist: 0.8, hip: 1.1 },
    limbScale: 1.12,
    lips: '#b5575d',
  },
};

/**
 * The coach's look for drawFigure.
 * @param {'male'|'female'} coach
 * @param {{ talk?: number }} [state] - talk 0..1 = how open the mouth is right now
 */
export function coachLook(coach, state = {}) {
  const L = LOOKS[coach] || LOOKS.male;
  const female = coach === 'female';
  return {
    palette: L.palette,
    pants: true,
    sleeves: false,
    sleeveShort: true,
    shade: true,
    stripeSide: true,
    torsoShape: L.torsoShape,
    limbScale: L.limbScale,
    outlineScale: 0.5,
    head(ctx, h, rx, ry, layer, turn) {
      const side = turn || 0;
      const hairG = (y0, y1) => { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, L.hair[0]); g.addColorStop(1, L.hair[1]); return g; };
      if (layer === 'behind') {
        // ears (behind the face edge) + the female coach's hair falling behind the head and a ponytail
        ctx.fillStyle = L.palette.skin[1];
        for (const k of [-1, 1]) { ctx.beginPath(); ctx.ellipse(h.x + k * rx * 0.98 + side * rx * 0.2, h.y + ry * 0.08, rx * 0.16, ry * 0.22, 0, 0, Math.PI * 2); ctx.fill(); }
        if (female) {
          ctx.fillStyle = hairG(h.y - ry, h.y + ry * 1.4);
          // the hair volume stays above the jaw line (no dark ring under the chin)
          ctx.beginPath(); ctx.ellipse(h.x - side * rx * 0.3, h.y - ry * 0.18, rx * 1.1, ry * 0.95, 0, 0, Math.PI * 2); ctx.fill();
          // a ponytail at the back of the head
          ctx.beginPath(); ctx.ellipse(h.x - (side || 0.6) * rx * 1.05, h.y + ry * 0.35, rx * 0.3, ry * 0.7, (side || 0.6) * -0.35, 0, Math.PI * 2); ctx.fill();
        }
        return;
      }
      // the face's volume: a soft light from the upper left
      const g = ctx.createRadialGradient(h.x - rx * 0.35, h.y - ry * 0.35, rx * 0.1, h.x, h.y, rx * 1.2);
      g.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
      g.addColorStop(0.6, 'rgba(255, 255, 255, 0)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(h.x, h.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      // hair on top (a short crop / pulled-back hair with a side part)
      ctx.fillStyle = hairG(h.y - ry * 1.05, h.y);
      ctx.beginPath();
      ctx.ellipse(h.x - side * rx * 0.06, h.y - ry * (female ? 0.24 : 0.34), rx * (female ? 1.05 : 1.03), ry * (female ? 0.8 : 0.68), 0, Math.PI, Math.PI * 2);
      ctx.fill();
      if (!female) {
        // the hairline over the temples
        for (const k of [-1, 1]) { ctx.beginPath(); ctx.ellipse(h.x + k * rx * 0.8, h.y - ry * 0.3, rx * 0.22, ry * 0.3, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      // the face — natural proportions, calm expression
      const fx = h.x + side * rx * 0.25;
      const eyeY = h.y + ry * 0.05, dx = rx * 0.36;
      for (const k of [-1, 1]) {
        // the eye: white, iris, a soft lid line
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath(); ctx.ellipse(fx + k * dx, eyeY, rx * 0.15, ry * 0.075, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3b2a20';
        ctx.beginPath(); ctx.arc(fx + k * dx, eyeY, Math.max(1, rx * 0.065), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(40, 25, 18, 0.7)'; ctx.lineWidth = Math.max(1, rx * 0.035);
        ctx.beginPath(); ctx.ellipse(fx + k * dx, eyeY, rx * 0.15, ry * 0.075, 0, Math.PI, Math.PI * 2); ctx.stroke();
        // the brow
        ctx.strokeStyle = L.hair[1]; ctx.lineWidth = Math.max(1, rx * (female ? 0.045 : 0.06));
        ctx.beginPath(); ctx.moveTo(fx + k * dx - rx * 0.17, eyeY - ry * 0.2); ctx.quadraticCurveTo(fx + k * dx, eyeY - ry * 0.27, fx + k * dx + rx * 0.17, eyeY - ry * 0.2); ctx.stroke();
      }
      // the nose: a soft shadow line + the nostril base
      ctx.strokeStyle = 'rgba(120, 70, 45, 0.45)'; ctx.lineWidth = Math.max(1, rx * 0.04);
      ctx.beginPath(); ctx.moveTo(fx + rx * 0.04, eyeY + ry * 0.05); ctx.lineTo(fx + rx * 0.08, h.y + ry * 0.36); ctx.lineTo(fx - rx * 0.08, h.y + ry * 0.4); ctx.stroke();
      // the mouth: a calm closed line, opening while the coach talks
      const talk = Math.max(0, Math.min(1, state.talk || 0));
      const my = h.y + ry * 0.58;
      if (talk > 0.08) {
        ctx.fillStyle = '#5b2a26';
        ctx.beginPath(); ctx.ellipse(fx, my, rx * 0.17, ry * (0.03 + 0.09 * talk), 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = L.lips; ctx.lineWidth = Math.max(1, rx * 0.055);
        ctx.beginPath(); ctx.moveTo(fx - rx * 0.17, my); ctx.quadraticCurveTo(fx, my + ry * 0.05, fx + rx * 0.17, my); ctx.stroke();
      }
    },
    torsoExtras(ctx, pts, scale) {
      // a round collar and a small chest logo stripe (a real training top)
      const top = { x: (pts.ls.x + pts.rs.x) / 2, y: (pts.ls.y + pts.rs.y) / 2 };
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = Math.max(1, scale * 0.03);
      ctx.beginPath(); ctx.ellipse(top.x, top.y + scale * 0.01, scale * 0.13, scale * 0.07, 0, 0, Math.PI); ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      const lx = top.x + (pts.ls.x - top.x) * 0.45, ly = top.y + scale * 0.22;
      ctx.beginPath(); ctx.ellipse(lx, ly, scale * 0.05, scale * 0.025, -0.3, 0, Math.PI * 2); ctx.fill();
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
  drawFigure(ctx, pose, P, scale, { floorShadow: true, glow: false, look: coachLook(coach, { talk }) });
  if (mode === 'demo' && spec) {
    const t = phaseOf(ms, periodOf(spec));
    drawShadowBall(ctx, shadowBallAt(spec, t, lp), pose, P, scale, true);
    drawStrikeSurface(ctx, pose, P, scale, true);
  }
}

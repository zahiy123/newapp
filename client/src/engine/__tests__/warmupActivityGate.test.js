import { describe, it, expect } from 'vitest';
import { detectActivity, requiredPointsFor, pointsInView } from '../warmupActivity.js';
import { getLimbProfile } from '../limbProfile.js';

let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** Full standing body in frame (normalized), small jitter. */
function body({ legsOut = false } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const set = (i, x, y, v = 0.9) => { lm[i] = { x: x + (rnd() - 0.5) * 0.004, y: y + (rnd() - 0.5) * 0.004, visibility: v }; };
  set(11, 0.56, 0.3); set(12, 0.44, 0.3); set(13, 0.6, 0.42); set(14, 0.4, 0.42); set(15, 0.6, 0.52); set(16, 0.4, 0.52);
  set(23, 0.54, 0.6); set(24, 0.46, 0.6);
  if (legsOut) {
    // Typical out-of-frame legs: MediaPipe still outputs points, below the frame / low confidence
    set(25, 0.54, 1.15, 0.3); set(26, 0.46, 1.15, 0.3); set(27, 0.54, 1.5, 0.1); set(28, 0.46, 1.5, 0.1);
  } else {
    set(25, 0.54, 0.75); set(26, 0.46, 0.75); set(27, 0.54, 0.92); set(28, 0.46, 0.92);
  }
  return lm;
}

const owner = getLimbProfile({ visionDiagnosis: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left',
  limbs: { left_leg: { status: 'prosthetic', level: 'below_knee', evidence: 'pylon visible' }, right_leg: { status: 'intact' }, left_arm: { status: 'intact' }, right_arm: { status: 'intact' } } } });

describe('required limbs in view', () => {
  it('leg exercises need the working leg; arm exercises need the arms; twists the shoulders', () => {
    expect(requiredPointsFor({ move: 'single_knee', side: 'right' }, owner)).toEqual({ part: 'legs', points: [24, 26, 28] });
    expect(requiredPointsFor({ move: 'high_knees' }, owner).points).toEqual([24, 26, 28]);   // prosthetic leg not required
    expect(requiredPointsFor({ move: 'arm_circles' }, owner).part).toBe('arms');
    expect(requiredPointsFor({ move: 'twist' }, owner)).toEqual({ part: 'upper', points: [11, 12] });
  });

  it('points below the frame or with low confidence are NOT in view', () => {
    expect(pointsInView(body({ legsOut: true }), [26, 28])).toBe(false);
    expect(pointsInView(body(), [26, 28])).toBe(true);
  });

  it('LEGS OUT OF FRAME: a knee-raise never counts, even with "movement" of the guessed legs', () => {
    let st = {}; let counted = 0; let inView = true;
    for (let i = 0; i < 60; i++) {
      const lm = body({ legsOut: true });
      lm[26] = { ...lm[26], y: 1.15 - 0.1 * Math.max(0, Math.sin(i / 3)) };   // guessed knee "moving"
      const r = detectActivity(st, lm, { move: 'single_knee', side: 'right' }, owner);
      st = r.state; if (r.moving) counted++; inView = r.inView;
    }
    expect(counted).toBe(0);
    expect(inView).toBe(false);
  });

  it('arm exercise with arms in view → counts', () => {
    let st = {}; let counted = 0;
    for (let i = 0; i < 40; i++) {
      const lm = body(); const a = (2 * Math.PI * i) / 20;
      lm[15] = { x: 0.66 + 0.04 * Math.cos(a), y: 0.3 + 0.04 * Math.sin(a), visibility: 0.9 };
      const r = detectActivity(st, lm, { move: 'arm_circles' }, owner); st = r.state; if (r.moving) counted++;
    }
    expect(counted).toBeGreaterThan(30);
  });

  it('visibility does not flicker: a single bad frame keeps "in view"', () => {
    let st = {};
    for (let i = 0; i < 10; i++) st = detectActivity(st, body(), { move: 'single_knee', side: 'right' }, owner).state;
    const r = detectActivity(st, body({ legsOut: true }), { move: 'single_knee', side: 'right' }, owner);
    expect(r.inView).toBe(true);
  });
});

describe('fast start', () => {
  it('movement is detected within ~200 ms (4 samples at 20 Hz) of starting', () => {
    let st = {};
    for (let i = 0; i < 20; i++) st = detectActivity(st, body(), { move: 'arm_circles' }, owner).state;   // still
    let firstMovingAt = null;
    for (let i = 0; i < 20 && firstMovingAt === null; i++) {
      const lm = body(); const a = (2 * Math.PI * i) / 20;
      lm[15] = { x: 0.6 + 0.06 * Math.sin(a), y: 0.52 - 0.06 * (1 - Math.cos(a)), visibility: 0.9 };   // arm starts lifting
      const r = detectActivity(st, lm, { move: 'arm_circles' }, owner); st = r.state;
      if (r.moving) firstMovingAt = i;
    }
    expect(firstMovingAt).not.toBeNull();
    expect(firstMovingAt).toBeLessThanOrEqual(4);
  });

  it('still with camera jitter → not moving (no false start)', () => {
    let st = {}; let counted = 0;
    for (let i = 0; i < 60; i++) { const r = detectActivity(st, body(), { move: 'arm_circles' }, owner); st = r.state; if (r.moving) counted++; }
    expect(counted).toBe(0);
  });
});

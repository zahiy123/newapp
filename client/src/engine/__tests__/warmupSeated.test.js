import { describe, it, expect } from 'vitest';
import {
  analyzeArmCircles,
  analyzeArmPunches,
  analyzeSingleArmRotation,
  analyzeCoreTwists,
  detectPosture,
} from '../../utils/exerciseAnalysis.js';

/** Seated person: hips at knee height, knees forward, feet below. Arms set by the caller. */
function seated() {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  const set = (i, x, y) => { lm[i] = { x, y, z: 0, visibility: 0.95 }; };
  set(0, 0.5, 0.18);                                     // nose
  set(11, 0.58, 0.32); set(12, 0.42, 0.32);              // shoulders
  set(13, 0.6, 0.45); set(14, 0.4, 0.45);                // elbows
  set(15, 0.6, 0.56); set(16, 0.4, 0.56);                // wrists
  set(23, 0.55, 0.62); set(24, 0.45, 0.62);              // hips
  set(25, 0.56, 0.64); set(26, 0.44, 0.64);              // knees (thighs horizontal → sitting)
  set(27, 0.56, 0.86); set(28, 0.44, 0.86);              // ankles
  return lm;
}

/** Run an analyzer over n frames produced by frameAt(i). Returns the final state + all feedback. */
function run(analyze, frameAt, n = 60) {
  let state = {};
  const feedback = [];
  for (let i = 0; i < n; i++) {
    state = analyze(frameAt(i), state);
    if (state.feedback) feedback.push(state.feedback);
  }
  return { state, feedback };
}

const circle = (i, cx, cy, r) => ({ x: cx + r * Math.cos(i / 4), y: cy + r * Math.sin(i / 4) });

describe('warm-up analyzers work while SEATED', () => {
  it('the fixture really is a seated posture', () => {
    expect(detectPosture(seated())).toBe('sitting');
  });

  it('seated arm circles are detected as movement with good feedback (was ignored before)', () => {
    const { state, feedback } = run(analyzeArmCircles, (i) => {
      const lm = seated();
      const l = circle(i, 0.7, 0.32, 0.1), r = circle(i, 0.3, 0.32, 0.1);
      lm[15] = { ...lm[15], ...l }; lm[16] = { ...lm[16], ...r };
      return lm;
    });
    expect(state.moving).toBe(true);
    expect(feedback.some(f => f.type === 'good')).toBe(true);
    expect(feedback.some(f => f.text === 'notMoving')).toBe(false);
  });

  it('seated single-arm circles are detected', () => {
    const { state } = run(analyzeSingleArmRotation, (i) => {
      const lm = seated();
      lm[16] = { ...lm[16], ...circle(i, 0.3, 0.32, 0.1) };
      return lm;
    });
    expect(state.moving).toBe(true);
  });

  it('seated punches are detected', () => {
    const { state } = run(analyzeArmPunches, (i) => {
      const lm = seated();
      const ext = (Math.sin(i / 3) + 1) / 2;
      lm[15] = { ...lm[15], x: 0.6 + 0.12 * ext, y: 0.4 };
      lm[16] = { ...lm[16], x: 0.4 - 0.12 * (1 - ext), y: 0.4 };
      return lm;
    });
    expect(state.moving).toBe(true);
  });

  it('seated trunk twists are detected from the shoulders alone (hips may be out of frame)', () => {
    const { state, feedback } = run(analyzeCoreTwists, (i) => {
      const lm = seated();
      const half = 0.08 * (0.6 + 0.4 * Math.cos(i / 4));   // shoulder width shrinks/grows as the trunk turns
      lm[11] = { ...lm[11], x: 0.5 + half }; lm[12] = { ...lm[12], x: 0.5 - half };
      lm[23] = { ...lm[23], visibility: 0.1 }; lm[24] = { ...lm[24], visibility: 0.1 };  // hips not visible
      return lm;
    });
    expect(feedback.some(f => f.type === 'visibility')).toBe(false);
    expect(state.moving).toBe(true);
  });

  it('sitting still is still "not moving" (no false progress)', () => {
    const { state } = run(analyzeArmCircles, () => seated());
    expect(state.moving).toBe(false);
  });
});

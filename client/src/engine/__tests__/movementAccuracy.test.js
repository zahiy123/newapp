import { describe, it, expect } from 'vitest';
import {
  createAccuracyTracker, retargetAccuracyTracker, updateAccuracy, accuracyLevel, rangeIoU, ghostRanges, signalFor,
} from '../movementAccuracy.js';
import { getLimbProfile } from '../limbProfile.js';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });

/** Trainee landmarks with both arms at shoulder angle `deg` (anatomical: left arm toward +x). */
function armsAt(deg, { shoulderY = 0.3, hipY = 0.6 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const a = deg * Math.PI / 180;
  lm[11] = { x: 0.56, y: shoulderY, visibility: 0.9 }; lm[12] = { x: 0.44, y: shoulderY, visibility: 0.9 };
  lm[23] = { x: 0.55, y: hipY, visibility: 0.9 }; lm[24] = { x: 0.45, y: hipY, visibility: 0.9 };
  lm[13] = { x: 0.56 + 0.12 * Math.sin(a), y: shoulderY + 0.12 * Math.cos(a), visibility: 0.9 };
  lm[14] = { x: 0.44 - 0.12 * Math.sin(a), y: shoulderY + 0.12 * Math.cos(a), visibility: 0.9 };
  return lm;
}

/** Feed `n` frames of a sinusoidal arm angle between lo and hi; returns the last accuracy. */
function run(tracker, lo, hi, n = 80) {
  let tr = tracker, acc = null;
  for (let i = 0; i < n; i++) {
    const deg = lo + (hi - lo) * (1 - Math.cos((2 * Math.PI * i) / 20)) / 2;
    const r = updateAccuracy(tr, armsAt(deg)); tr = r.tracker; acc = r.accuracy;
  }
  return { tracker: tr, acc };
}

describe('movementAccuracy', () => {
  const spec = { move: 'arm_circles', targetDeg: 120 };     // Ghost circles between ~70° and 120°

  it('the Ghost range comes from the drawn Ghost (target included)', () => {
    const g = ghostRanges(spec, lpOk, signalFor(spec, lpOk));
    expect(g.left.hi).toBeGreaterThan(115); expect(g.left.hi).toBeLessThanOrEqual(120.5);
    expect(g.left.lo).toBeLessThan(75);
  });

  it('matching the Ghost range → high accuracy (green)', () => {
    const { acc } = run(createAccuracyTracker(spec, lpOk), 70, 120);
    expect(acc).toBeGreaterThanOrEqual(90);
    expect(accuracyLevel(acc)).toBe('good');
  });

  it('half the range → mid / low accuracy', () => {
    const { acc } = run(createAccuracyTracker(spec, lpOk), 85, 105);
    expect(acc).toBeLessThan(60);
  });

  it('right range size but too low (circles below the shoulder) → red', () => {
    const { acc } = run(createAccuracyTracker(spec, lpOk), 20, 70);
    expect(accuracyLevel(acc)).toBe('low');
  });

  it('overshooting the Ghost lowers the score too', () => {
    const { acc } = run(createAccuracyTracker(spec, lpOk), 50, 150);
    expect(acc).toBeLessThan(ACC_FULL);
  });

  it('not moving → no accuracy shown (null)', () => {
    const { acc } = run(createAccuracyTracker(spec, lpOk), 90, 91);
    expect(acc).toBeNull();
  });

  it('when the range target widens, the Ghost range is recomputed and the samples are kept', () => {
    const t1 = run(createAccuracyTracker(spec, lpOk), 70, 120).tracker;
    const t2 = retargetAccuracyTracker(t1, { move: 'arm_circles', targetDeg: 140 }, lpOk);
    expect(t2.ghost.left.hi).toBeGreaterThan(t1.ghost.left.hi + 15);
    expect(t2.samples.left.length).toBe(t1.samples.left.length);
  });

  it('a non-trainable arm is not measured; side steps have no accuracy measure', () => {
    const lp = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL', armAssessment: { left_arm: { status: 'no_movement' } } } });
    expect(signalFor(spec, lp).sides).toEqual(['right']);
    expect(createAccuracyTracker({ move: 'side_steps' }, lpOk)).toBeNull();
  });

  it('levels: ≥85 green, 60-84 yellow, <60 red', () => {
    expect(accuracyLevel(85)).toBe('good');
    expect(accuracyLevel(84)).toBe('mid');
    expect(accuracyLevel(60)).toBe('mid');
    expect(accuracyLevel(59)).toBe('low');
    expect(rangeIoU({ lo: 0, hi: 10 }, { lo: 0, hi: 10 })).toBe(1);
  });

  it('is light: 2000 frame updates take well under 200 ms', () => {
    let tr = createAccuracyTracker(spec, lpOk);
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) tr = updateAccuracy(tr, armsAt(70 + (i % 20) * 2.5)).tracker;
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

const ACC_FULL = 85;

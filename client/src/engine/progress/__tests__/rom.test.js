import { describe, it, expect } from 'vitest';
import {
  measurableJoints, createRomTracker, addRomFrame, summarizeRom, scanRom, romReference, romProgress, ROM_MIN_SAMPLES,
} from '../rom.js';

// a frame with the left knee bent to `deg` of flexion (hip 23 above the knee 25, the ankle 27 swung back)
function kneeFrame(deg) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const rad = (deg * Math.PI) / 180;
  lm[23] = { x: 0.5, y: 0.3, visibility: 0.9 };
  lm[25] = { x: 0.5, y: 0.5, visibility: 0.9 };
  lm[27] = { x: 0.5 + 0.2 * Math.sin(rad), y: 0.5 + 0.2 * Math.cos(rad), visibility: 0.9 };
  return lm;
}

describe('ROM — measured during the workout', () => {
  it('never a missing limb, never a mechanical (above-knee) knee; a below-knee residual knee IS measured', () => {
    const below = measurableJoints({ left_leg: { state: 'prosthetic', level: 'below_knee' } });
    expect(below).toContain('left_knee');
    const above = measurableJoints({ left_leg: { state: 'prosthetic', level: 'above_knee' } });
    expect(above).not.toContain('left_knee');
    expect(above).toContain('left_hip');
    const absent = measurableJoints({ right_arm: { state: 'absent' } });
    expect(absent).not.toContain('right_elbow');
    expect(absent).not.toContain('right_shoulder');
  });
  it('the session value = the 95th percentile of the clearly-seen frames; too few frames → nothing', () => {
    const t = createRomTracker(['left_knee']);
    for (let i = 0; i < 100; i++) addRomFrame(t, kneeFrame(i < 95 ? 40 : 90));
    addRomFrame(t, kneeFrame(170).map((p, i) => (i === 27 ? { ...p, visibility: 0.2 } : p)));  // unseen → ignored
    const r = summarizeRom(t);
    expect(r.left_knee).toBeGreaterThanOrEqual(39);
    expect(r.left_knee).toBeLessThanOrEqual(91);
    const few = createRomTracker(['left_knee']);
    for (let i = 0; i < ROM_MIN_SAMPLES - 1; i++) addRomFrame(few, kneeFrame(60));
    expect(summarizeRom(few).left_knee).toBeUndefined();
  });
  it('the scan gives degrees for the arms only', () => {
    const s = scanRom({ romBaseline: { arms: { right_arm: { shoulderFlexionDeg: 150, shoulderAbductionDeg: 160, elbowFlexionMinDeg: 40 } } } });
    expect(s).toEqual({ right_shoulder: 160, right_elbow: 140 });
  });
});

describe('ROM — the owner rule for the reference', () => {
  it('compared with the initial scan until at least 6 workouts — the best is kept meanwhile', () => {
    const r = romReference(100, [105, 110, 120, 115, 118], 180);
    expect(r).toMatchObject({ initial: 100, initialSource: 'scan', reference: 100, best: 120, latest: 118 });
    expect(r.stages).toEqual([]);
  });
  it('after 6 workouts → the highest of them becomes the new reference', () => {
    const r = romReference(100, [105, 110, 120, 115, 118, 112], 180);
    expect(r.reference).toBe(120);
    expect(r.stages).toEqual([{ value: 120, afterWorkout: 6, reason: 'six_workouts' }]);
    // the next stage again only after 6 more
    const r2 = romReference(100, [105, 110, 120, 115, 118, 112, 130, 131, 129, 128, 133], 180);
    expect(r2.reference).toBe(120);
    const r3 = romReference(100, [105, 110, 120, 115, 118, 112, 130, 131, 129, 128, 133, 127], 180);
    expect(r3.reference).toBe(133);
  });
  it('the exception: an especially low start + an extreme jump in 2 workouts → moves early', () => {
    // shoulder: 60° is under 50 % of 180°; two workouts at 85 / 90 (≥ 30 % and ≥ 15° above) → reference 85
    const r = romReference(60, [70, 85, 90], 180);
    expect(r.reference).toBe(85);
    expect(r.stages[0]).toMatchObject({ value: 85, afterWorkout: 3, reason: 'early_jump' });
  });
  it('no exception when the start was not especially low, or the jump is only once', () => {
    expect(romReference(120, [160, 170], 180).reference).toBe(120);       // 120 is not low
    expect(romReference(60, [90, 70, 72], 180).reference).toBe(60);       // one jump only
    expect(romReference(60, [70, 74], 180).reference).toBe(60);           // not extreme
  });
  it('no scan degrees (the knee) → the first workout is the start', () => {
    const r = romReference(null, [80, 85, 90], 135);
    expect(r).toMatchObject({ initial: 80, initialSource: 'first_workout', reference: 80 });
  });
  it('the whole picture from the workout history', () => {
    const p = romProgress({ romBaseline: { arms: { left_arm: { shoulderFlexionDeg: 140 } } } },
      [{ at: 1, rom: { left_shoulder: 150, left_knee: 70 } }, { at: 2, rom: { left_knee: 80 } }]);
    expect(p.left_shoulder).toMatchObject({ initial: 140, initialSource: 'scan', latest: 150 });
    expect(p.left_knee).toMatchObject({ initial: 70, latest: 80, series: [{ at: 1, value: 70 }, { at: 2, value: 80 }] });
  });
});

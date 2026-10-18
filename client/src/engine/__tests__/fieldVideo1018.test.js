// The owner's field video, 2026-10-18 (a laptop camera, the "מסירה בצל · בעוצמה" drill, a prosthesis)
import { describe, it, expect } from 'vitest';
import { calibratedLean, uprightLeanProfile } from '../exercise/kinematics';
import { createExecutionTracker, calibrateUpright } from '../exercise/profileEvaluator';
import { applySportContext } from '../sports/sportLibrary';
import { getExerciseProfile } from '../exercise/exerciseProfiles';

describe('the trunk lean is calibrated to THIS camera, once, on the upright trainee', () => {
  it('a tilted camera that sees the upright trainee at 38°: an upright stance reads 0, a real lean still shows', () => {
    expect(calibratedLean(38, 38)).toBe(0);
    expect(calibratedLean(75, 38)).toBeCloseTo(37, 6);
  });
  it('only drills whose rules are "do not lean" maxima are calibrated; a drill that REQUIRES a lean never is', () => {
    expect(uprightLeanProfile(getExerciseProfile('kick', 'בעיטה'))).toBe(true);
    expect(uprightLeanProfile({ rules: [{ metric: 'trunkLean', op: '<', value: 15 }] })).toBe(false);
    expect(uprightLeanProfile({ rules: [{ metric: 'knee', op: '<', value: 90 }] })).toBe(false);
  });
  it('the calibration happens once, from the trainee verified upright, and is capped', () => {
    const tr = createExecutionTracker(getExerciseProfile('kick', 'בעיטה'), {});
    tr.leanRaw = 38;
    expect(calibrateUpright(tr)).toBe(38);
    tr.leanRaw = 80;
    expect(calibrateUpright(tr)).toBe(45);                  // never more than a camera can tilt
  });
});

describe('amputee football: crutch cues ONLY to a trainee on crutches today', () => {
  const base = getExerciseProfile('kick', 'בעיטה');
  const words = (p) => JSON.stringify([p.sportEmphasis, p.dynamics]);
  it('on a prosthesis (no crutches): no "קביים" anywhere in the cues', () => {
    const p = applySportContext(base, ['footballAmputee'], { crutches: false });
    expect(words(p)).not.toContain('קביים');
    expect(words(p)).toContain('רגל התמיכה');
  });
  it('on crutches: the crutch cues stay (the real amputee-football technique)', () => {
    const p = applySportContext(base, ['footballAmputee'], { crutches: true });
    expect(words(p)).toContain('קביים');
  });
});

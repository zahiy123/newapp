import { describe, it, expect } from 'vitest';
import { startedTired, qualityDropped, lighterFrom, easyWorkout, decideLoadStep, applyLoadStep } from '../loadAdaptation.js';

const ex = (name, reps = 10, sets = 3, extra = {}) => ({ name, reps, sets, restSeconds: 60, ...extra });

describe('Rule 1 — tired at the start: lighter only AFTER the warm-up and the first exercise', () => {
  it('readiness 1–2 is "tired"', () => {
    expect(startedTired(1)).toBe(true); expect(startedTired(2)).toBe(true);
    expect(startedTired(3)).toBe(false); expect(startedTired(0)).toBe(false);
  });
  it('the first exercise stays as planned; the rest are lighter', () => {
    const out = lighterFrom([ex('a'), ex('b'), ex('c', '12')], 1, 1);
    expect(out[0]).toEqual(ex('a'));
    expect(out[1]).toMatchObject({ reps: 8, restSeconds: 75, autoLighter: { level: 1 } });
    expect(out[2].reps).toBe('10');
  });
  it('a second reason raises the level from the ORIGINAL numbers (never compounding), never below 3 reps', () => {
    const once = lighterFrom([ex('a'), ex('b', 10)], 1, 1);
    const twice = lighterFrom(once, 1, 2);
    expect(twice[1]).toMatchObject({ reps: 7, restSeconds: 90, autoLighter: { level: 2 } });
    expect(lighterFrom(twice, 1, 1)[1].reps).toBe(7);              // a lower level never undoes
    expect(lighterFrom([ex('a', 3)], 0, 2)[0].reps).toBe(3);
  });
});

describe('Rule 2 — a real quality drop across a whole exercise', () => {
  const s = (...a) => a.map(accuracy => ({ accuracy }));
  it('steady and ≥ 15 points → drop', () => {
    expect(qualityDropped(s(88, 80, 70))).toBe(true);
    expect(qualityDropped(s(85, 70))).toBe(true);
  });
  it('a small dip, a recovery, or one set → no drop', () => {
    expect(qualityDropped(s(88, 84, 80))).toBe(false);          // only 8
    expect(qualityDropped(s(90, 70, 85))).toBe(false);          // recovered
    expect(qualityDropped(s(90))).toBe(false);
    expect(qualityDropped(s(90, 91, 72))).toBe(true);           // +1 is noise, then a fall of 18
  });
});

describe('Rule 3 — graded progress after 2 easy, fully accurate workouts in a row', () => {
  const easy = (step = 0, extra = {}) => ({ dataVersion: 2, status: 'completed', readiness: 4, loadStep: step,
    exercises: [{ repsTarget: 10, repsActual: 10, setsTarget: 3, setsCompleted: 3, accuracy: 94, sets: [{ accuracy: 94 }] }], ...extra });
  it('what counts as easy', () => {
    expect(easyWorkout(easy())).toBe(true);
    expect(easyWorkout(easy(0, { status: 'partial' }))).toBe(false);
    expect(easyWorkout(easy(0, { readiness: 2 }))).toBe(false);
    expect(easyWorkout(easy(0, { painReports: [{ level: 4 }] }))).toBe(false);
    expect(easyWorkout(easy(0, { exercises: [{ repsTarget: 10, repsActual: 10, accuracy: 85, sets: [] }] }))).toBe(false);
    expect(easyWorkout(easy(0, { exercises: [{ repsTarget: 10, repsActual: 8, accuracy: 95, sets: [] }] }))).toBe(false);
    expect(easyWorkout(easy(0, { exercises: [{ repsTarget: 10, repsActual: 10, accuracy: 95, sets: [{ safeMode: true }] }] }))).toBe(false);
  });
  it('2 in a row → one step up; the next step needs 2 NEW workouts at the new step', () => {
    expect(decideLoadStep([easy()])).toEqual({ step: 0, raised: false });
    expect(decideLoadStep([easy(), easy()])).toEqual({ step: 1, raised: true });
    expect(decideLoadStep([easy(), easy(), easy(1)])).toEqual({ step: 1, raised: false });
    expect(decideLoadStep([easy(), easy(), easy(1), easy(1)])).toEqual({ step: 2, raised: true });
    expect(decideLoadStep([easy(), easy(0, { painReports: [{ level: 5 }] })])).toEqual({ step: 0, raised: false });
    expect(decideLoadStep([easy(2), { dataVersion: 2, status: 'completed', loadStep: 2, exercises: [] }])).toEqual({ step: 2, raised: false });
  });
  it('the step: +10 % reps (at least +1), never on a pain-protected exercise, never twice', () => {
    const out = applyLoadStep([ex('a', 10), ex('b', '5'), ex('c', 10, 3, { painProtected: { level: 7 } }), { name: 'd', reps: '30s' }], 1);
    expect(out[0]).toMatchObject({ reps: 11, loadStep: 1 });
    expect(out[1].reps).toBe('6');
    expect(out[2].reps).toBe(10);
    expect(applyLoadStep(out, 1)[0].reps).toBe(11);
    expect(applyLoadStep([ex('a', 10)], 0)[0].reps).toBe(10);
  });
});

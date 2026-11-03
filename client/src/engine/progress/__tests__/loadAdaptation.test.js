import { describe, it, expect } from 'vitest';
import { startedTired, qualityDropped, lighterFrom, easyWorkout, decideLoadStep } from '../loadAdaptation.js';

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
    expect(decideLoadStep([easy()])).toMatchObject({ step: 0, raised: false });
    expect(decideLoadStep([easy(), easy()])).toMatchObject({ step: 1, raised: true });
    expect(decideLoadStep([easy(), easy(), easy(1)])).toMatchObject({ step: 1, raised: false });
    expect(decideLoadStep([easy(), easy(), easy(1), easy(1)])).toMatchObject({ step: 2, raised: true });
    expect(decideLoadStep([easy(), easy(0, { painReports: [{ level: 5 }] })])).toMatchObject({ step: 0, raised: false });
    expect(decideLoadStep([easy(2), { dataVersion: 2, status: 'completed', loadStep: 2, exercises: [] }])).toMatchObject({ step: 2, raised: false });
  });
});

describe('Symmetric — one step DOWN after 2 hard workouts in a row', async () => {
  const { hardWorkout, decideLoadStep: decide, MIN_STEP } = await import('../loadAdaptation.js');
  const W = (accuracy, step = 0, extra = {}) => ({ dataVersion: 2, status: 'completed', loadStep: step,
    exercises: [{ name: 'סקוואט', repsTarget: 10, repsActual: 10, setsTarget: 3, setsCompleted: 3, accuracy, sets: [{ accuracy }] }], ...extra });
  it('a struggle = mean accuracy under 65 %, or under 65 % of the reps', () => {
    expect(hardWorkout(W(60))).toBe(true);
    expect(hardWorkout(W(70))).toBe(false);
    expect(hardWorkout(W(80, 0, { exercises: [{ name: 'x', repsTarget: 10, repsActual: 5, setsTarget: 3, setsCompleted: 1, accuracy: 80, sets: [] }] }))).toBe(true);
    // pain has its own graded handling — an exercise with pain 4+ does not count here
    expect(hardWorkout(W(50, 0, { painReports: [{ level: 5, exercise: 'סקוואט' }] }))).toBe(false);
    expect(hardWorkout(W(null))).toBe(false);                    // nothing measured → never a reason to go down
  });
  it('2 hard in a row → one step down; the next move needs 2 NEW workouts; never below the floor', () => {
    expect(decide([W(60), W(55)])).toEqual({ step: -1, raised: false, lowered: true });
    expect(decide([W(60), W(55), W(50, -1)])).toEqual({ step: -1, raised: false, lowered: false });
    expect(decide([W(60), W(80)])).toEqual({ step: 0, raised: false, lowered: false });
    expect(decide([W(95, -1), W(96, -1)])).toEqual({ step: 0, raised: true, lowered: false });   // back up, one step
    expect(decide([W(50, MIN_STEP), W(50, MIN_STEP)]).step).toBe(MIN_STEP);
  });
});

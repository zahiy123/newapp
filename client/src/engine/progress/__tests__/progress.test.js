import { describe, it, expect } from 'vitest';
import { workoutReport, exerciseTrends, painHistory } from '../progress.js';

const set = (accuracy, problems = [], fixed = []) => ({ accuracy, problems, fixed, reps: 10 });
const P = (key, times = 2, critical = false) => ({ key, what: `w-${key}`, times, critical });
const W = (at, exercises, painReports = []) => ({ at, dataVersion: 2, exercises, painReports });

describe('The workout report', () => {
  it('per exercise: accuracy per set, the problems over the sets, what was fixed, the pain', () => {
    const r = workoutReport(W(1, [{ key: 'pass', name: 'מסירה', sets: [set(70, [P('toe', 3, true)]), set(85, [P('toe', 1, true), P('arms', 2)], [{ key: 'chest', what: 'w-chest' }])], accuracy: 78 }],
      [{ level: 5, zone: 'knee', exercise: 'מסירה' }]));
    const e = r.exercises[0];
    expect(e.setAccuracy).toEqual([70, 85]);
    expect(e.trend).toBe(15);
    expect(e.problems[0]).toMatchObject({ key: 'toe', times: 4, sets: 2, critical: true });
    expect(e.fixed).toEqual([{ key: 'chest', what: 'w-chest' }]);
    expect(e.pain).toHaveLength(1);
    expect(r.detailed).toBe(true);
  });
  it('an old workout (no per-set data) is marked as not detailed', () => {
    expect(workoutReport({ exercises: [{ name: 'x', repsActual: 5 }] }).detailed).toBe(false);
  });
});

describe('Progress across workouts', () => {
  it('the accuracy line + a problem is FIXED after 3 workouts without it, RECURRING while it still shows', () => {
    const ws = [
      W(1, [{ key: 'pass', name: 'מסירה', accuracy: 60, sets: [set(60, [P('toe'), P('arms')])] }]),
      W(2, [{ key: 'pass', name: 'מסירה', accuracy: 70, sets: [set(70, [P('arms')])] }]),
      W(3, [{ key: 'pass', name: 'מסירה', accuracy: 75, sets: [set(75)] }]),
      W(4, [{ key: 'pass', name: 'מסירה', accuracy: 80, sets: [set(80, [P('arms')])] }]),
      W(5, [{ key: 'pass', name: 'מסירה', accuracy: 85, sets: [set(85)] }]),
      { at: 6, exercises: [{ name: 'מסירה', repsActual: 10 }] },          // an old-format workout: skipped
    ];
    const [t] = exerciseTrends(ws);
    expect(t.workouts).toBe(5);
    expect(t.series.map(s => s.accuracy)).toEqual([60, 70, 75, 80, 85]);
    expect(t.firstAccuracy).toBe(60);
    expect(t.lastAccuracy).toBe(85);
    const toe = t.problems.find(p => p.key === 'toe');
    const arms = t.problems.find(p => p.key === 'arms');
    expect(toe).toMatchObject({ status: 'fixed', workoutsSinceLast: 4, count: 1 });
    expect(arms).toMatchObject({ status: 'recurring', count: 3 });
    expect(t.problems[0].key).toBe('arms');                              // the recurring first
  });
  it('the pain history, newest first', () => {
    const h = painHistory([W(1, [], [{ level: 3, at: 10 }]), W(2, [], [{ level: 7, at: 20 }])]);
    expect(h.map(p => p.level)).toEqual([7, 3]);
  });
});

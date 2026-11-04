import { describe, it, expect } from 'vitest';
import { patternGroup, planCatalog, buildManualExercise, mergeClinicianPlan, choiceId } from '../clinicianPlan.js';

const ok = {};
const crutches = { left_leg: { state: 'absent' }, crutches: true };

describe('The clinician’s plan — the catalog grouped by joint / area', () => {
  it('each movement in its main joint / area', () => {
    expect(patternGroup('squat')).toBe('knee');
    expect(patternGroup('gluteBridge')).toBe('hip');
    expect(patternGroup('shoulderPress')).toBe('shoulder');
    expect(patternGroup('bicepCurl')).toBe('elbow');
    expect(patternGroup('plank')).toBe('core');
    expect(patternGroup('runInPlace')).toBe('conditioning');
    expect(patternGroup('shadowPass')).toBe('sport');
  });
  it('a movement the body cannot do / the limits block is shown but not choosable', () => {
    const groups = planCatalog(crutches, { blockedPatterns: ['bicepCurl'] });
    const knee = groups.find(g => g.id === 'knee').patterns;
    expect(knee.find(p => p.id === 'lunge').fits).toBe(false);
    expect(groups.find(g => g.id === 'elbow').patterns.find(p => p.id === 'bicepCurl').verdict).toBe('blocked');
    expect(groups.find(g => g.id === 'core').patterns.find(p => p.id === 'plank').unit).toBe('sec');
  });
});

describe('The clinician’s plan — into the app', () => {
  it('the clinician’s numbers and version become the exercise (the Ghost follows the catalog id)', () => {
    const e = buildManualExercise({ pattern: 'squat', variation: 'partial', sets: 4, reps: 6, rest: 90, note: 'לאט' }, ok);
    expect(e.catalogId).toBe('squat|standard|partial|both|s4r5');
    expect(e).toMatchObject({ sets: 4, reps: '6', restSeconds: 90, byClinician: true, clinicianNote: 'לאט' });
    expect(choiceId('pushUp', 'slow', ok)).toBe('pushUp|controlled|full|both|s4r5');
  });
  it('never a movement the body cannot do or the limits block', () => {
    expect(buildManualExercise({ pattern: 'lunge', variation: 'standard' }, crutches)).toBe(null);
    expect(buildManualExercise({ pattern: 'squat', variation: 'standard' }, ok, true, { blockedPatterns: ['squat'] })).toBe(null);
  });
  it('the modes: auto keeps the system plan; manual replaces it (the automatic plan = the backup); manual + auto', () => {
    const auto = [{ name: 'auto-1', catalogId: 'plank|standard|full|both|h30' }, { name: 'auto-2', catalogId: 'squat|standard|full|both|s3r12' }];
    const plan = (mode) => ({ mode, exercises: [{ pattern: 'squat', variation: 'standard', sets: 3, reps: 8 }] });
    expect(mergeClinicianPlan(auto, plan('auto'))).toBe(auto);
    const manual = mergeClinicianPlan(auto, plan('manual'));
    expect(manual).toHaveLength(1);
    expect(manual[0].byClinician).toBe(true);
    const both = mergeClinicianPlan(auto, plan('manual_plus_auto'));
    expect(both.map(e => e.name)).toEqual([manual[0].name, 'auto-1']);      // no squat twice
    // nothing of the plan can run → the automatic plan (the backup)
    expect(mergeClinicianPlan(auto, { mode: 'manual', exercises: [{ pattern: 'lunge' }] }, crutches)).toBe(auto);
  });
});

describe('The clinician’s own (custom) exercises', async () => {
  const { buildCustomExercise, mergeClinicianPlan: merge } = await import('../clinicianPlan.js');
  it('based on a catalog movement → measured (its Ghost / analyzer), the clinician’s name and instructions', () => {
    const e = buildCustomExercise({ custom: true, name: 'סקוואט על כרית', instructions: 'עמוד על כרית רכה. רד לאט.', basedOn: 'miniSquat', variation: 'standard', sets: 3, reps: 10, rest: 60 }, {});
    expect(e.name).toBe('סקוואט על כרית');
    expect(e.catalogId.split('|')[0]).toBe('miniSquat');
    expect(e.customSteps).toEqual(['עמוד על כרית רכה.', 'רד לאט.']);
    expect(e.manual).toBeUndefined();
  });
  it('free → manual: no Ghost / counting (a "done" tap), seconds → a timer; never a body-unfit base', () => {
    const m = buildCustomExercise({ custom: true, name: 'מתיחת גדם עם מגבת', instructions: 'משוך בעדינות.', unit: 'sec', sets: 2, reps: 30, rest: 30 }, {});
    expect(m).toMatchObject({ manual: true, timed: true, reps: '30', sets: 2, byClinician: true });
    expect(m.catalogId).toBeUndefined();
    expect(buildCustomExercise({ custom: true, name: 'x' }, {})).toBe(null);                       // a name is needed
    expect(buildCustomExercise({ custom: true, name: 'לאנג׳ קל', basedOn: 'lunge' }, { left_leg: { state: 'absent' }, crutches: true })).toBe(null);
  });
  it('custom exercises join the plan with the catalog choices, in order', () => {
    const list = merge([], { mode: 'manual', exercises: [{ custom: true, name: 'הליכה על קו', unit: 'sec', sets: 2, reps: 45 }, { pattern: 'plank', variation: 'standard', sets: 3, reps: 30 }] }, {});
    expect(list.map(e => e.name)).toEqual(['הליכה על קו', list[1].name]);
    expect(list[0].manual).toBe(true);
  });
});

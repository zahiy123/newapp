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

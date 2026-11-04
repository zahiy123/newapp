import { describe, it, expect } from 'vitest';
import { activeConstraints, patternDemand, exerciseVerdict, applyClinicalLimits, createLimitMonitor } from '../clinicalLimits.js';
import { catalogItem, toExercise } from '../../catalog/catalog.js';

const ex = (id) => toExercise(catalogItem(id), true);

describe('Clinical limits — what is in force', () => {
  it('expired or empty limits do nothing', () => {
    expect(activeConstraints({ romLimits: { left_knee: 90 }, expiresAt: 10 }, 20)).toBe(null);
    expect(activeConstraints({ romLimits: {} })).toBe(null);
    expect(activeConstraints({ blockedPatterns: ['jumpSquat'] })).not.toBe(null);
  });
  it('a pattern’s demand per joint in the rom.js measure (knee flexion = 180 − the angle)', () => {
    expect(patternDemand('squat').knee).toEqual({ least: 75, most: 115 });
    expect(patternDemand('miniSquat').knee).toEqual({ least: 30, most: 60 });
  });
});

describe('Clinical limits — the plan', () => {
  it('a forbidden movement → the nearest easier allowed version', () => {
    const c = { blockedPatterns: ['squat'] };
    expect(exerciseVerdict('squat|standard|full|both|s3r12', c).verdict).toBe('blocked');
    const { exercises, changes } = applyClinicalLimits([ex('squat|standard|full|both|s3r12')], c);
    expect(exercises[0].catalogId.split('|')[0]).toBe('miniSquat');
    expect(changes[0]).toMatchObject({ why: 'easier' });
  });
  it('a range limit: the normal range passes it → the partial range; even the least passes it → easier / removed', () => {
    // knee ≤ 100: a squat asks 75–115 → partial
    const c = { romLimits: { left_knee: 100, right_knee: 120 } };
    expect(exerciseVerdict('squat|standard|full|both|s3r12', c)).toMatchObject({ verdict: 'partial', joint: 'knee', limit: 100 });
    const { exercises } = applyClinicalLimits([ex('squat|standard|full|both|s3r12')], c);
    expect(exercises[0].catalogId).toBe('squat|standard|partial|both|s3r12');
    // knee ≤ 70: a squat asks at least 75 → down to the mini squat (30–60) which fits
    const tight = applyClinicalLimits([ex('squat|standard|full|both|s3r12')], { romLimits: { left_knee: 70 } });
    expect(tight.exercises[0].catalogId.split('|')[0]).toBe('miniSquat');
  });
  it('a blocked joint removes every movement of that joint that has no allowed version; others stay', () => {
    const { exercises, changes } = applyClinicalLimits([ex('miniSquat|standard|full|both|s3r12'), ex('bicepCurl|standard|full|both|s3r12')], { blockedJoints: ['left_knee'] });
    expect(exercises.map(e => e.catalogId.split('|')[0])).toEqual(['bicepCurl']);
    expect(changes[0]).toMatchObject({ to: null, why: 'joint' });
  });
});

describe('Clinical limits — the live monitor', () => {
  // the left knee (23 hip, 25 knee, 27 ankle) bent to `deg` of flexion
  const frame = (deg) => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    const r = (deg * Math.PI) / 180;
    lm[23] = { x: 0.5, y: 0.3, visibility: 0.9 }; lm[25] = { x: 0.5, y: 0.5, visibility: 0.9 };
    lm[27] = { x: 0.5 + 0.2 * Math.sin(r), y: 0.5 + 0.2 * Math.cos(r), visibility: 0.9 };
    return lm;
  };
  it('a crossing = above the limit + 5° held 0.3 s; one per excursion; re-armed under the limit', () => {
    const m = createLimitMonitor({ romLimits: { left_knee: 90 } });
    expect(m.update(frame(93), 0)).toBe(null);                 // within the tolerance
    expect(m.update(frame(100), 100)).toBe(null);              // not held yet
    const hit = m.update(frame(100), 450);
    expect(hit).toMatchObject({ joint: 'left_knee', limit: 90 });
    expect(m.update(frame(101), 900)).toBe(null);              // the same excursion
    m.update(frame(80), 1000);                                 // back under → re-armed
    m.update(frame(100), 1100);
    expect(m.update(frame(100), 1500)).not.toBe(null);         // a second crossing
  });
  it('no limits → no monitor', () => {
    expect(createLimitMonitor({ blockedPatterns: ['x'] }).active).toBe(false);
  });
});

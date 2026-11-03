import { describe, it, expect } from 'vitest';
import { harderId, upgradeExercise, applyComplexityStep } from '../complexity.js';
import { catalogItem, toExercise } from '../../catalog/catalog.js';

const ok = {};                                                            // a trainee with every limb working
const belowKnee = { left_leg: { state: 'prosthetic', level: 'below_knee' } };
const crutches = { left_leg: { state: 'absent' }, crutches: true };
const ex = (id) => toExercise(catalogItem(id), true);

describe('Complexity — the next, harder version', () => {
  it('range first: partial → full', () => {
    expect(harderId('squat|standard|partial|both|s3r12', ok)).toEqual({ id: 'squat|standard|full|both|s3r12', how: 'range' });
  });
  it('then the next movement on the ladder the body allows', () => {
    expect(harderId('miniSquat|standard|full|both|s3r12', ok)?.id.split('|')[0]).toBe('squat');
    expect(harderId('squat|standard|full|both|s3r12', ok)?.id.split('|')[0]).toBe('lunge');
    expect(harderId('squat|standard|full|both|s3r12', belowKnee)?.id.split('|')[0]).toBe('lunge');   // an active below-knee prosthesis can lunge
    expect(harderId('rehabFrontRaise|standard|full|both|s3r12', ok)?.id.split('|')[0]).toBe('frontRaise');
    expect(harderId('rehabElbowFlex|standard|full|both|s3r12', ok)?.id.split('|')[0]).toBe('bicepCurl');
  });
  it('then a slow controlled tempo when no harder movement exists', () => {
    expect(harderId('pushUp|standard|full|both|s3r12', ok)).toEqual({ id: 'pushUp|controlled|full|both|s3r12', how: 'tempo' });
    expect(harderId('pushUp|controlled|full|both|s3r12', ok)).toBe(null);
  });
  it('never a movement the body cannot do', () => {
    const h = harderId('squat|standard|full|both|s3r12', crutches);
    expect(h?.id.split('|')[0]).not.toBe('lunge');
  });
  it('the upgraded exercise: a new catalog id (the Ghost + the measurement follow), the dose kept, the history noted', () => {
    const base = ex('squat|standard|partial|both|s3r12');
    const up = upgradeExercise(base, ok);
    expect(up.catalogId).toBe('squat|standard|full|both|s3r12');
    expect(up.reps).toBe(base.reps);
    expect(up.sets).toBe(base.sets);
    expect(up.upgradedFrom).toMatchObject({ name: base.name, how: ['range'] });
    expect(upgradeExercise({ ...base, painProtected: { level: 7 } }, ok)).toBe(null);            // pain first
    expect(upgradeExercise({ name: 'free AI exercise', reps: 10 }, ok)).toBe(null);
  });
  it('a step upgrades every exercise once; step 2 goes two levels; never applied twice', () => {
    const list = [ex('miniSquat|standard|partial|both|s3r12'), ex('plank|standard|full|both|h30')];
    const one = applyComplexityStep(list, 1, ok);
    expect(one[0].catalogId).toBe('miniSquat|standard|full|both|s3r12');
    expect(one[1]).toBe(list[1]);                                         // a hold with no harder version stays
    const two = applyComplexityStep(list, 2, ok);
    expect(two[0].catalogId.split('|')[0]).toBe('squat');
    expect(two[0].upgradedFrom.how).toEqual(['range', 'pattern']);
    expect(applyComplexityStep(one, 1, ok)[0]).toBe(one[0]);
  });
});

describe('Complexity — the easier version (the exact inverse)', async () => {
  const { easierId, applyComplexityStep: apply } = await import('../complexity.js');
  it('slow tempo → standard; then the previous movement the body allows; then full → partial range', () => {
    expect(easierId('pushUp|controlled|full|both|s3r12', ok)).toEqual({ id: 'pushUp|standard|full|both|s3r12', how: 'tempo' });
    expect(easierId('squat|standard|full|both|s3r12', ok)?.id.split('|')[0]).toBe('miniSquat');
    expect(easierId('miniSquat|standard|full|both|s3r12', ok)).toEqual({ id: 'miniSquat|standard|partial|both|s3r12', how: 'range' });
    expect(easierId('miniSquat|standard|partial|both|s3r12', ok)).toBe(null);
  });
  it('step -1 eases every exercise one level (a pain-protected one too — easier is safe); +1 then -1 is symmetric', () => {
    const base = ex('squat|standard|full|both|s3r12');
    const down = apply([base, { ...ex('frontRaise|standard|full|both|s3r12'), painProtected: { level: 6 } }], -1, ok);
    expect(down[0].catalogId.split('|')[0]).toBe('miniSquat');
    expect(down[0].easedFrom).toMatchObject({ name: base.name, how: ['pattern'] });
    expect(down[1].catalogId.split('|')[0]).toBe('rehabFrontRaise');
    expect(down[1].painProtected).toEqual({ level: 6 });
    const up = apply([ex('miniSquat|standard|full|both|s3r12')], 1, ok)[0];
    expect(up.catalogId.split('|')[0]).toBe('squat');
  });
});

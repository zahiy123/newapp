// ============================================================
// AnatomyProfile — Unit Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  DISABILITY_TYPE,
  LIMB_CONDITION,
  MOBILITY_AID,
  AMPUTATION_LEVEL,
  SKILL_LEVEL,
  REQUIRED_FIELDS,
  validateAnatomyProfile,
  inferDisabilityFromScan,
  mergeWithExistingProfile,
} from '../AnatomyProfile.js';


// ---- Helper ----

function validProfile(overrides = {}) {
  return {
    name: 'Test User',
    age: 25,
    height: 175,
    weight: 70,
    skillLevel: 'beginner',
    trainingDays: 3,
    trainingLocation: 'home',
    equipment: 'none',
    disability: 'none',
    ...overrides,
  };
}


// ============================================================
// Tests
// ============================================================

describe('AnatomyProfile', () => {

  // ---- validateAnatomyProfile ----

  describe('validateAnatomyProfile', () => {

    it('valid profile passes', () => {
      const result = validateAnatomyProfile(validProfile());
      expect(result.valid).toBe(true);
      expect(result.missingFields).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('null profile is invalid', () => {
      const result = validateAnatomyProfile(null);
      expect(result.valid).toBe(false);
      expect(result.missingFields).toEqual(REQUIRED_FIELDS);
    });

    it('missing required fields are reported', () => {
      const result = validateAnatomyProfile({ name: 'Test' });
      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('age');
      expect(result.missingFields).toContain('height');
      expect(result.missingFields).not.toContain('name');
    });

    it('empty string counts as missing', () => {
      const result = validateAnatomyProfile(validProfile({ name: '' }));
      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('name');
    });

    it('age out of range is an error', () => {
      const result = validateAnatomyProfile(validProfile({ age: 3 }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('age_invalid');
    });

    it('age > 99 is an error', () => {
      const result = validateAnatomyProfile(validProfile({ age: 100 }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('age_invalid');
    });

    it('negative height is an error', () => {
      const result = validateAnatomyProfile(validProfile({ height: -5 }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('height_invalid');
    });

    it('negative weight is an error', () => {
      const result = validateAnatomyProfile(validProfile({ weight: 0 }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('weight_invalid');
    });

    it('one_leg requires amputationSide and amputationLevel', () => {
      const result = validateAnatomyProfile(validProfile({
        disability: 'one_leg',
        mobilityAid: 'prosthesis',
      }));
      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('amputationSide');
      expect(result.missingFields).toContain('amputationLevel');
    });

    it('one_leg with all fields is valid', () => {
      const result = validateAnatomyProfile(validProfile({
        disability: 'one_leg',
        amputationSide: 'left',
        amputationLevel: 'above_knee',
        mobilityAid: 'prosthesis',
      }));
      expect(result.valid).toBe(true);
    });

    it('one_arm requires amputationSide and amputationLevel', () => {
      const result = validateAnatomyProfile(validProfile({
        disability: 'one_arm',
        mobilityAid: 'prosthesis',
      }));
      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('amputationSide');
      expect(result.missingFields).toContain('amputationLevel');
    });

    it('wheelchair disability requires mobilityAid', () => {
      const result = validateAnatomyProfile(validProfile({
        disability: 'wheelchair',
      }));
      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('mobilityAid');
    });

    it('wheelchair with mobilityAid is valid', () => {
      const result = validateAnatomyProfile(validProfile({
        disability: 'wheelchair',
        mobilityAid: 'wheelchair',
      }));
      expect(result.valid).toBe(true);
    });

    it('disability none does not require mobilityAid', () => {
      const result = validateAnatomyProfile(validProfile({ disability: 'none' }));
      expect(result.valid).toBe(true);
    });
  });


  // ---- inferDisabilityFromScan ----

  describe('inferDisabilityFromScan', () => {

    it('null postureDecision → disability none', () => {
      const result = inferDisabilityFromScan(null);
      expect(result.disability).toBe('none');
    });

    it('wheelchair posture → wheelchair disability + aid', () => {
      const result = inferDisabilityFromScan({
        posture: 'wheelchair',
        detectedAids: { wheelchair: true },
        limbStates: {},
      });
      expect(result.disability).toBe(DISABILITY_TYPE.WHEELCHAIR);
      expect(result.mobilityAid).toBe(MOBILITY_AID.WHEELCHAIR);
    });

    it('crutches detected → mobilityAid crutches', () => {
      const result = inferDisabilityFromScan({
        posture: 'standing',
        detectedAids: { crutches: true },
        limbStates: {},
      });
      expect(result.mobilityAid).toBe(MOBILITY_AID.CRUTCHES);
    });

    it('left leg absent → one_leg + left side', () => {
      const result = inferDisabilityFromScan({
        posture: 'standing',
        detectedAids: {},
        limbStates: {
          left_leg: { status: 'absent_confirmed' },
          right_leg: { status: 'present_confirmed' },
          left_arm: { status: 'present_confirmed' },
          right_arm: { status: 'present_confirmed' },
        },
      });
      expect(result.disability).toBe(DISABILITY_TYPE.ONE_LEG);
      expect(result.amputationSide).toBe('left');
    });

    it('both legs absent → two_legs', () => {
      const result = inferDisabilityFromScan({
        posture: 'standing',
        detectedAids: {},
        limbStates: {
          left_leg: { status: 'absent_confirmed' },
          right_leg: { status: 'absent_confirmed' },
          left_arm: { status: 'present_confirmed' },
          right_arm: { status: 'present_confirmed' },
        },
      });
      expect(result.disability).toBe(DISABILITY_TYPE.TWO_LEGS);
    });

    it('right arm absent → one_arm + right side', () => {
      const result = inferDisabilityFromScan({
        posture: 'standing',
        detectedAids: {},
        limbStates: {
          left_leg: { status: 'present_confirmed' },
          right_leg: { status: 'present_confirmed' },
          left_arm: { status: 'present_confirmed' },
          right_arm: { status: 'absent_confirmed' },
        },
      });
      expect(result.disability).toBe(DISABILITY_TYPE.ONE_ARM);
      expect(result.amputationSide).toBe('right');
    });

    it('all limbs present → disability none', () => {
      const result = inferDisabilityFromScan({
        posture: 'standing',
        detectedAids: {},
        limbStates: {
          left_leg: { status: 'present_confirmed' },
          right_leg: { status: 'present_confirmed' },
          left_arm: { status: 'present_confirmed' },
          right_arm: { status: 'present_confirmed' },
        },
      });
      expect(result.disability).toBe(DISABILITY_TYPE.NONE);
    });

    it('ambiguous limb treated as absent', () => {
      const result = inferDisabilityFromScan({
        posture: 'standing',
        detectedAids: {},
        limbStates: {
          left_leg: { status: 'ambiguous' },
          right_leg: { status: 'present_confirmed' },
          left_arm: { status: 'present_confirmed' },
          right_arm: { status: 'present_confirmed' },
        },
      });
      expect(result.disability).toBe(DISABILITY_TYPE.ONE_LEG);
      expect(result.amputationSide).toBe('left');
    });
  });


  // ---- mergeWithExistingProfile ----

  describe('mergeWithExistingProfile', () => {

    it('scan-detected disability overrides existing', () => {
      const scan = { disability: 'wheelchair', mobilityAid: 'wheelchair' };
      const existing = { disability: 'none', name: 'Test' };
      const merged = mergeWithExistingProfile(scan, existing);
      expect(merged.disability).toBe('wheelchair');
      expect(merged.mobilityAid).toBe('wheelchair');
    });

    it('existing training fields preserved', () => {
      const scan = { disability: 'none' };
      const existing = { name: 'User', age: 30, skillLevel: 'pro' };
      const merged = mergeWithExistingProfile(scan, existing);
      expect(merged.name).toBe('User');
      expect(merged.age).toBe(30);
      expect(merged.skillLevel).toBe('pro');
    });

    it('missing fields default to empty string', () => {
      const scan = { disability: 'none' };
      const merged = mergeWithExistingProfile(scan, null);
      expect(merged.name).toBe('');
      expect(merged.height).toBe('');
      expect(merged.equipment).toBe('');
    });

    it('null inputs handled gracefully', () => {
      const merged = mergeWithExistingProfile(null, null);
      expect(merged.disability).toBe('none');
      expect(merged.name).toBe('');
    });
  });
});

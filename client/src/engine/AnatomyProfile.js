// ============================================================
// AnatomyProfile — Pure-Logic Anatomy & Training Profile
//
// Defines the UserAnatomyProfile schema, validation, and
// inference from scan detection data. No React, no Firebase.
//
// Used by ScanSequencer to gate PHASE_A advancement and by
// the UI to pre-fill the anatomy questionnaire.
// ============================================================


// ---- Enums ----

const DISABILITY_TYPE = Object.freeze({
  NONE:       'none',
  ONE_LEG:    'one_leg',
  ONE_ARM:    'one_arm',
  TWO_LEGS:   'two_legs',
  TWO_ARMS:   'two_arms',
  PARALYZED:  'paralyzed',
  WHEELCHAIR: 'wheelchair',
  OTHER:      'other',
});

const LIMB_CONDITION = Object.freeze({
  PRESENT:    'present',
  MISSING:    'missing',
  PARALYZED:  'paralyzed',
  PROSTHETIC: 'prosthetic',
});

const MOBILITY_AID = Object.freeze({
  NONE:       'none',
  CRUTCHES:   'crutches',
  PROSTHESIS: 'prosthesis',
  WHEELCHAIR: 'wheelchair',
});

const AMPUTATION_LEVEL = Object.freeze({
  ABOVE_KNEE:  'above_knee',
  BELOW_KNEE:  'below_knee',
  ABOVE_ELBOW: 'above_elbow',
  BELOW_ELBOW: 'below_elbow',
});

const SKILL_LEVEL = Object.freeze({
  BEGINNER:     'beginner',
  INTERMEDIATE: 'intermediate',
  PRO:          'pro',
});


// ---- Required Fields ----

const REQUIRED_FIELDS = [
  'name', 'age', 'height', 'weight',
  'skillLevel', 'trainingDays', 'trainingLocation', 'equipment',
];

// Disability types that require amputationSide + amputationLevel
const AMPUTATION_DISABILITIES = ['one_leg', 'one_arm'];

// Disability types that require mobilityAid
const AID_REQUIRING_DISABILITIES = [
  'one_leg', 'one_arm', 'two_legs', 'two_arms',
  'paralyzed', 'wheelchair', 'other',
];


// ---- Training-Only Fields (no anatomy) ----

const TRAINING_REQUIRED_FIELDS = [
  'name', 'age', 'height', 'weight',
  'skillLevel', 'trainingDays', 'trainingLocation', 'equipment',
];


// ---- Validation ----

/**
 * Validate only training fields (no disability/amputation checks).
 * Used when anatomy is auto-inferred by KineticAnalyzer.
 *
 * @param {Object} profile - The profile to validate
 * @returns {{ valid: boolean, missingFields: string[], errors: string[] }}
 */
function validateTrainingProfile(profile) {
  if (!profile) {
    return { valid: false, missingFields: [...TRAINING_REQUIRED_FIELDS], errors: ['profile_null'] };
  }

  const missingFields = [];
  const errors = [];

  for (const field of TRAINING_REQUIRED_FIELDS) {
    const val = profile[field];
    if (val === undefined || val === null || val === '') {
      missingFields.push(field);
    }
  }

  if (profile.age !== undefined && profile.age !== null && profile.age !== '') {
    const age = Number(profile.age);
    if (isNaN(age) || age < 5 || age > 99) {
      errors.push('age_invalid');
    }
  }

  if (profile.height !== undefined && profile.height !== '') {
    if (Number(profile.height) <= 0) errors.push('height_invalid');
  }
  if (profile.weight !== undefined && profile.weight !== '') {
    if (Number(profile.weight) <= 0) errors.push('weight_invalid');
  }

  return {
    valid: missingFields.length === 0 && errors.length === 0,
    missingFields,
    errors,
  };
}


/**
 * Validate an anatomy profile for completeness.
 *
 * @param {Object} profile - The profile to validate
 * @returns {{ valid: boolean, missingFields: string[], errors: string[] }}
 */
function validateAnatomyProfile(profile) {
  if (!profile) {
    return { valid: false, missingFields: [...REQUIRED_FIELDS], errors: ['profile_null'] };
  }

  const missingFields = [];
  const errors = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    const val = profile[field];
    if (val === undefined || val === null || val === '') {
      missingFields.push(field);
    }
  }

  // Age range check
  if (profile.age !== undefined && profile.age !== null && profile.age !== '') {
    const age = Number(profile.age);
    if (isNaN(age) || age < 5 || age > 99) {
      errors.push('age_invalid');
    }
  }

  // Height/weight positivity
  if (profile.height !== undefined && profile.height !== '') {
    if (Number(profile.height) <= 0) errors.push('height_invalid');
  }
  if (profile.weight !== undefined && profile.weight !== '') {
    if (Number(profile.weight) <= 0) errors.push('weight_invalid');
  }

  // Disability-conditional requirements
  const disability = profile.disability || 'none';

  if (AMPUTATION_DISABILITIES.includes(disability)) {
    if (!profile.amputationSide || profile.amputationSide === 'none') {
      missingFields.push('amputationSide');
    }
    if (!profile.amputationLevel) {
      missingFields.push('amputationLevel');
    }
  }

  if (AID_REQUIRING_DISABILITIES.includes(disability)) {
    if (!profile.mobilityAid) {
      missingFields.push('mobilityAid');
    }
  }

  return {
    valid: missingFields.length === 0 && errors.length === 0,
    missingFields,
    errors,
  };
}


// ---- Inference from Scan Detection ----

/**
 * Infer disability fields from scan's postureDecision.
 * Returns a partial profile with scan-detected values.
 *
 * @param {Object} postureDecision - From ScanSequencer._postureDecision
 * @returns {Object} Partial profile fields
 */
function inferDisabilityFromScan(postureDecision) {
  if (!postureDecision) return { disability: 'none' };

  const result = {};
  const { posture, detectedAids, limbStates } = postureDecision;

  // Wheelchair detection
  if (posture === 'wheelchair' || detectedAids?.wheelchair) {
    result.disability = DISABILITY_TYPE.WHEELCHAIR;
    result.mobilityAid = MOBILITY_AID.WHEELCHAIR;
    return result;
  }

  // Crutches detection
  if (detectedAids?.crutches) {
    result.mobilityAid = MOBILITY_AID.CRUTCHES;
  }

  // Prosthetic detection
  if (detectedAids?.prosthetic) {
    result.mobilityAid = MOBILITY_AID.PROSTHESIS;
  }

  // Per-limb analysis
  if (limbStates) {
    const leftLegAbsent = isLimbAbsent(limbStates.left_leg);
    const rightLegAbsent = isLimbAbsent(limbStates.right_leg);
    const leftArmAbsent = isLimbAbsent(limbStates.left_arm);
    const rightArmAbsent = isLimbAbsent(limbStates.right_arm);

    if (leftLegAbsent && rightLegAbsent) {
      result.disability = DISABILITY_TYPE.TWO_LEGS;
    } else if (leftLegAbsent) {
      result.disability = DISABILITY_TYPE.ONE_LEG;
      result.amputationSide = 'left';
    } else if (rightLegAbsent) {
      result.disability = DISABILITY_TYPE.ONE_LEG;
      result.amputationSide = 'right';
    } else if (leftArmAbsent && rightArmAbsent) {
      result.disability = DISABILITY_TYPE.TWO_ARMS;
    } else if (leftArmAbsent) {
      result.disability = DISABILITY_TYPE.ONE_ARM;
      result.amputationSide = 'left';
    } else if (rightArmAbsent) {
      result.disability = DISABILITY_TYPE.ONE_ARM;
      result.amputationSide = 'right';
    }
  }

  // Default if nothing detected
  if (!result.disability) {
    result.disability = DISABILITY_TYPE.NONE;
  }

  return result;
}

/** @private */
function isLimbAbsent(limbState) {
  if (!limbState) return false;
  return limbState.status === 'absent_confirmed' ||
         limbState.status === 'absent_aided' ||
         limbState.status === 'ambiguous';
}


// ---- Profile Merging ----

/**
 * Merge scan-inferred data with existing user profile.
 * Priority: scan-detected > existing profile > empty.
 *
 * @param {Object} scanInferred - From inferDisabilityFromScan()
 * @param {Object} existingProfile - From AuthContext.userProfile
 * @returns {Object} Complete profile with all fields
 */
function mergeWithExistingProfile(scanInferred, existingProfile) {
  const existing = existingProfile || {};
  const scan = scanInferred || {};

  return {
    // Disability fields — scan detection takes priority
    disability: scan.disability || existing.disability || 'none',
    amputationSide: scan.amputationSide || existing.amputationSide || '',
    amputationLevel: scan.amputationLevel || existing.amputationLevel || '',
    mobilityAid: scan.mobilityAid || existing.mobilityAid || '',
    // Training profile — existing profile takes priority
    name: existing.name || '',
    age: existing.age || '',
    gender: existing.gender || '',
    height: existing.height || '',
    weight: existing.weight || '',
    skillLevel: existing.skillLevel || '',
    trainingDays: existing.trainingDays || '',
    trainingLocation: existing.trainingLocation || '',
    equipment: existing.equipment || '',
  };
}


// ---- Exports ----

export {
  DISABILITY_TYPE,
  LIMB_CONDITION,
  MOBILITY_AID,
  AMPUTATION_LEVEL,
  SKILL_LEVEL,
  REQUIRED_FIELDS,
  TRAINING_REQUIRED_FIELDS,
  validateAnatomyProfile,
  validateTrainingProfile,
  inferDisabilityFromScan,
  mergeWithExistingProfile,
};

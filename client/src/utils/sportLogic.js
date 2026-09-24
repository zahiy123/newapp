// ============================================================
// Sport Logic — Iron Rule Enforcement
//
// Hard filtering: scanData drives which sports are available.
// Limb-aware: muscle group options adapt to limbStatus.
// Fallback: if no scanData, uses legacy disability field.
// ============================================================

export const SPORTS = {
  football: { key: 'football', icon: '\u26BD' },
  basketball: { key: 'basketball', icon: '\uD83C\uDFC0' },
  tennis: { key: 'tennis', icon: '\uD83C\uDFBE' },
  footballAmputee: { key: 'footballAmputee', icon: '\u26BD' },
  basketballWheelchair: { key: 'basketballWheelchair', icon: '\uD83C\uDFC0' },
  tennisWheelchair: { key: 'tennisWheelchair', icon: '\uD83C\uDFBE' },
  footballAmputeeGK: { key: 'footballAmputeeGK', icon: '\uD83E\uDDE4' },
  fitness: { key: 'fitness', icon: '\uD83D\uDCAA' },
  rehab: { key: 'rehab', icon: '\uD83C\uDFE5' },
};

export const GOALS = [
  'technique', 'aerobic', 'strength', 'weightLoss', 'speed', 'flexibility',
];

// ---- Sport Physical Requirements ----
// Each sport declares which limbs must be functional (canTrain: true)
const SPORT_REQUIREMENTS = {
  football:             { requires: ['left_leg', 'right_leg'] },
  basketball:           { requires: ['left_leg', 'right_leg', 'left_arm', 'right_arm'] },
  tennis:               { requires: ['left_leg', 'right_leg'] },  // one arm ok (dominant arm)
  footballAmputee:      { requires: [] },  // designed for leg amputees
  footballAmputeeGK:    { requires: [] },  // designed for arm amputees
  basketballWheelchair: { requires: [] },  // designed for wheelchair users
  tennisWheelchair:     { requires: [] },  // designed for wheelchair users
  fitness:              { requires: [] },  // always available, adapted
  rehab:                { requires: [] },  // always available
};

// ---- Muscle Group → Required Limbs ----
// Maps muscle group focus to the limbs that must be trainable
const MUSCLE_GROUP_LIMB_REQUIREMENTS = {
  full_body:       [],  // always available
  upper_body:      ['left_arm', 'right_arm'],
  lower_body:      ['left_leg', 'right_leg'],
  core:            [],  // always available
  shoulders_arms:  ['left_arm', 'right_arm'],
};


// ============================================================
// Primary API: scanData-driven sport filtering
// ============================================================

/**
 * Get available sports based on scanData (Iron Rule enforcement).
 * Falls back to legacy disability field if no scanData.
 *
 * @param {string} disability - Legacy disability field ('none', 'one_leg', etc.)
 * @param {Object|null} scanData - From Firestore: { limbStatus, classification, specialProtocol }
 * @returns {Object[]} Array of available sport objects
 */
export function getAvailableSports(disability, scanData) {
  // If scanData with limbStatus exists, use Iron Rule filtering
  if (scanData?.limbStatus) {
    return getAvailableSportsFromScan(scanData);
  }

  // Legacy fallback: disability string
  return getAvailableSportsLegacy(disability);
}

/**
 * Iron Rule sport filtering based on scanData.limbStatus.
 */
function getAvailableSportsFromScan(scanData) {
  const limbStatus = scanData.limbStatus;
  const classification = (scanData.classification || '').toUpperCase();
  const protocol = scanData.specialProtocol;

  const available = [];

  for (const [sportKey, sport] of Object.entries(SPORTS)) {
    const reqs = SPORT_REQUIREMENTS[sportKey];
    if (!reqs) continue;

    // Check if all required limbs are trainable
    const meetsRequirements = reqs.requires.every(limbKey => {
      const limb = limbStatus[limbKey];
      return limb && limb.canTrain;
    });

    if (meetsRequirements) {
      available.push(sport);
    }
  }

  // Special protocol overrides: wheelchair users get wheelchair sports prioritized
  if (protocol === 'wheelchair' || classification.includes('WHEELCHAIR')) {
    // Ensure wheelchair sports are included even if not matched by limb requirements
    if (!available.find(s => s.key === 'basketballWheelchair')) {
      available.push(SPORTS.basketballWheelchair);
    }
    if (!available.find(s => s.key === 'tennisWheelchair')) {
      available.push(SPORTS.tennisWheelchair);
    }
  }

  // Amputee-specific: if leg amputee, ensure amputee football is available
  if (classification.includes('TRANSFEMORAL') || classification.includes('TRANSTIBIAL')) {
    if (!available.find(s => s.key === 'footballAmputee')) {
      available.push(SPORTS.footballAmputee);
    }
  }

  // Arm amputee: ensure amputee GK is available
  if (classification.includes('ARM_AMPUTEE') || classification.includes('ARM')) {
    if (!available.find(s => s.key === 'footballAmputeeGK')) {
      available.push(SPORTS.footballAmputeeGK);
    }
  }

  // Fitness and rehab are always available
  if (!available.find(s => s.key === 'fitness')) {
    available.push(SPORTS.fitness);
  }
  if (!available.find(s => s.key === 'rehab')) {
    available.push(SPORTS.rehab);
  }

  return available;
}

/**
 * Legacy fallback: disability-string-based filtering.
 */
function getAvailableSportsLegacy(disability) {
  switch (disability) {
    case 'none':
      return [SPORTS.football, SPORTS.basketball, SPORTS.tennis, SPORTS.fitness, SPORTS.rehab];
    case 'one_leg':
      return [SPORTS.footballAmputee, SPORTS.basketballWheelchair, SPORTS.tennisWheelchair, SPORTS.fitness, SPORTS.rehab];
    case 'one_arm':
      return [SPORTS.footballAmputeeGK, SPORTS.basketball, SPORTS.tennis, SPORTS.fitness, SPORTS.rehab];
    case 'two_legs':
      return [SPORTS.basketballWheelchair, SPORTS.tennisWheelchair, SPORTS.fitness, SPORTS.rehab];
    default:
      return [SPORTS.football, SPORTS.basketball, SPORTS.tennis,
              SPORTS.footballAmputee, SPORTS.basketballWheelchair, SPORTS.tennisWheelchair, SPORTS.fitness, SPORTS.rehab];
  }
}


// ============================================================
// Muscle Group Filtering — Limb-Aware
// ============================================================

/**
 * Filter muscle group options based on limbStatus.
 * Blocks groups that target limbs the user cannot train.
 *
 * Example: if right_leg canTrain=false AND left_leg canTrain=false,
 * 'lower_body' is blocked. But if only one leg is affected,
 * 'lower_body' remains available (the healthy leg can still train).
 *
 * @param {Object|null} scanData - { limbStatus }
 * @returns {{ key: string, blocked: boolean, reason: string|null }[]}
 */
export function getAvailableMuscleGroups(scanData) {
  const ALL_GROUPS = [
    { key: 'full_body' },
    { key: 'upper_body' },
    { key: 'lower_body' },
    { key: 'core' },
    { key: 'shoulders_arms' },
  ];

  if (!scanData?.limbStatus) {
    return ALL_GROUPS.map(g => ({ ...g, blocked: false, reason: null }));
  }

  const limbStatus = scanData.limbStatus;

  return ALL_GROUPS.map(group => {
    const requiredLimbs = MUSCLE_GROUP_LIMB_REQUIREMENTS[group.key] || [];
    if (requiredLimbs.length === 0) {
      return { ...group, blocked: false, reason: null };
    }

    // Block only if ALL required limbs are non-trainable
    const allBlocked = requiredLimbs.every(limbKey => {
      const limb = limbStatus[limbKey];
      return limb && !limb.canTrain;
    });

    if (allBlocked) {
      return {
        ...group,
        blocked: true,
        reason: group.key === 'lower_body' ? 'legs_unavailable' : 'arms_unavailable',
      };
    }

    return { ...group, blocked: false, reason: null };
  });
}


// ============================================================
// Goal Filtering — Speed requires functional legs
// ============================================================

/**
 * Filter goals based on scanData. Most goals are always available.
 * 'speed' requires at least one functional leg.
 *
 * @param {Object|null} scanData - { limbStatus, specialProtocol }
 * @returns {{ key: string, blocked: boolean }[]}
 */
export function getAvailableGoals(scanData) {
  return GOALS.map(goal => {
    // Speed requires at least one functional leg
    if (goal === 'speed' && scanData?.specialProtocol === 'wheelchair') {
      return { key: goal, blocked: true };
    }
    if (goal === 'speed' && scanData?.limbStatus) {
      const leftLeg = scanData.limbStatus.left_leg;
      const rightLeg = scanData.limbStatus.right_leg;
      if (leftLeg && !leftLeg.canTrain && rightLeg && !rightLeg.canTrain) {
        return { key: goal, blocked: true };
      }
    }
    // Strength requires at least one functional arm
    if (goal === 'strength' && scanData?.limbStatus) {
      const leftArm = scanData.limbStatus.left_arm;
      const rightArm = scanData.limbStatus.right_arm;
      if (leftArm && !leftArm.canTrain && rightArm && !rightArm.canTrain) {
        return { key: goal, blocked: true };
      }
    }
    return { key: goal, blocked: false };
  });
}

// ============================================================
// KineticAnalyzer — Real-Time Joint Angle Analysis
//
// PURE LOGIC — no React, no DOM, no side effects.
// Analyzes landmark frames collected during Phase A to detect:
//   - Joint angle patterns per limb
//   - Prosthetic vs natural limb classification
//   - Overall kinetic profile
//
// Prosthetic detection heuristic:
//   Natural limbs exhibit micro-sway (high angle variance)
//   Prosthetic limbs are rigid (low angle variance)
//   The threshold is calibrated for standing/static Phase A data.
// ============================================================


// ---- MediaPipe Landmark Indices ----

const LM = {
  NOSE: 0,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
};


// ---- Joint Definitions ----
// Each joint is defined by three landmarks: [proximal, joint, distal]
// The angle is measured at the middle landmark.
//
// MIRROR CORRECTION: The front-facing camera feed is mirrored.
// MediaPipe LEFT_* landmarks appear on screen-right (= person's actual LEFT).
// MediaPipe RIGHT_* landmarks appear on screen-left (= person's actual RIGHT).
// We swap LEFT↔RIGHT here so that "left_knee" in our analysis
// refers to the person's ACTUAL left knee.

const JOINT_DEFS = Object.freeze({
  left_knee:  [LM.RIGHT_HIP,      LM.RIGHT_KNEE,   LM.RIGHT_ANKLE],
  right_knee: [LM.LEFT_HIP,       LM.LEFT_KNEE,    LM.LEFT_ANKLE],
  left_elbow: [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW,  LM.RIGHT_WRIST],
  right_elbow:[LM.LEFT_SHOULDER,  LM.LEFT_ELBOW,   LM.LEFT_WRIST],
  left_hip:   [LM.RIGHT_SHOULDER, LM.RIGHT_HIP,    LM.RIGHT_KNEE],
  right_hip:  [LM.LEFT_SHOULDER,  LM.LEFT_HIP,     LM.LEFT_KNEE],
});

// Maps joint keys to limb keys used elsewhere in the system
const JOINT_TO_LIMB = Object.freeze({
  left_knee:   'left_leg',
  right_knee:  'right_leg',
  left_elbow:  'left_arm',
  right_elbow: 'right_arm',
  left_hip:    'left_leg',
  right_hip:   'right_leg',
});


// ---- Thresholds ----

// Minimum visibility for a landmark to be considered valid
const MIN_VISIBILITY = 0.3;

// Angle variance threshold (degrees^2) for prosthetic detection
// Below this → likely prosthetic (too rigid)
// Above this → natural micro-sway
const PROSTHETIC_VARIANCE_THRESHOLD = 4.0;

// Minimum number of valid angle samples needed for analysis
const MIN_SAMPLES_FOR_ANALYSIS = 30; // ~1 second at 30fps

// Limb classification labels
const LIMB_KINETIC = Object.freeze({
  NATURAL:     'natural',
  PROSTHETIC:  'prosthetic',
  RIGID:       'rigid',       // Detected as rigid but could be bracing/cast
  INSUFFICIENT:'insufficient', // Not enough data
});


// ============================================================
// Core Analysis Functions
// ============================================================

/**
 * Compute the angle (in degrees) at point B, formed by points A-B-C.
 * Uses the dot product method.
 *
 * @param {{ x: number, y: number }} a - Proximal point
 * @param {{ x: number, y: number }} b - Joint point (vertex)
 * @param {{ x: number, y: number }} c - Distal point
 * @returns {number} Angle in degrees (0-180)
 */
function computeAngle(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };

  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
  const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);

  if (magBA === 0 || magBC === 0) return 0;

  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return Math.acos(cosAngle) * (180 / Math.PI);
}


/**
 * Check if all three landmarks for a joint are sufficiently visible.
 *
 * @param {Object[]} landmarks - 33-landmark array
 * @param {number[]} indices - [proximal, joint, distal] indices
 * @returns {boolean}
 */
function areJointLandmarksVisible(landmarks, indices) {
  return indices.every(idx => {
    const lm = landmarks[idx];
    return lm && lm.visibility >= MIN_VISIBILITY;
  });
}


/**
 * Extract angle time-series for a joint from a set of frames.
 *
 * @param {Object[][]} frames - Array of 33-landmark arrays
 * @param {number[]} indices - [proximal, joint, distal] indices
 * @returns {number[]} Array of angle values (degrees), only for valid frames
 */
function extractAngleSeries(frames, indices) {
  const angles = [];
  for (const landmarks of frames) {
    if (!areJointLandmarksVisible(landmarks, indices)) continue;
    const angle = computeAngle(
      landmarks[indices[0]],
      landmarks[indices[1]],
      landmarks[indices[2]],
    );
    angles.push(angle);
  }
  return angles;
}


/**
 * Compute mean and variance of an array of numbers.
 *
 * @param {number[]} values
 * @returns {{ mean: number, variance: number, stdDev: number }}
 */
function computeStats(values) {
  if (values.length === 0) return { mean: 0, variance: 0, stdDev: 0 };

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;

  return {
    mean,
    variance,
    stdDev: Math.sqrt(variance),
  };
}


// ============================================================
// Main Analysis
// ============================================================

/**
 * Analyze landmark frames from Phase A to produce a kinetic profile.
 *
 * @param {Object[][]} frames - Array of 33-landmark arrays from Phase A
 * @returns {KineticProfile}
 *
 * @typedef {Object} KineticProfile
 * @property {Object<string, JointAnalysis>} joints - Per-joint analysis
 * @property {Object<string, LimbKinetic>} limbs - Per-limb classification
 * @property {string} overallPosture - 'natural' | 'prosthetic_detected' | 'insufficient'
 * @property {string[]} detectedProsthetics - Array of limb keys detected as prosthetic
 * @property {number} totalFramesAnalyzed - How many frames had valid data
 */
function analyzeKinetics(frames) {
  if (!frames || frames.length === 0) {
    return {
      joints: {},
      limbs: {},
      overallPosture: 'insufficient',
      detectedProsthetics: [],
      totalFramesAnalyzed: 0,
    };
  }

  const joints = {};
  const limbs = {};
  const detectedProsthetics = [];
  let maxSamples = 0;

  for (const [jointKey, indices] of Object.entries(JOINT_DEFS)) {
    const angleSeries = extractAngleSeries(frames, indices);
    const stats = computeStats(angleSeries);
    const limbKey = JOINT_TO_LIMB[jointKey];

    joints[jointKey] = {
      sampleCount: angleSeries.length,
      meanAngle: Math.round(stats.mean * 10) / 10,
      variance: Math.round(stats.variance * 100) / 100,
      stdDev: Math.round(stats.stdDev * 100) / 100,
    };

    maxSamples = Math.max(maxSamples, angleSeries.length);

    // Classify this joint's contribution to the limb
    let classification;
    if (angleSeries.length < MIN_SAMPLES_FOR_ANALYSIS) {
      classification = LIMB_KINETIC.INSUFFICIENT;
    } else if (stats.variance < PROSTHETIC_VARIANCE_THRESHOLD) {
      classification = LIMB_KINETIC.RIGID;
    } else {
      classification = LIMB_KINETIC.NATURAL;
    }

    // Only update limb if this joint provides a more informative classification
    // Priority: RIGID > NATURAL > INSUFFICIENT (keep most decisive result)
    const existing = limbs[limbKey];
    const priority = { [LIMB_KINETIC.RIGID]: 2, [LIMB_KINETIC.NATURAL]: 1, [LIMB_KINETIC.INSUFFICIENT]: 0 };
    if (!existing || priority[classification] > priority[existing.classification]) {
      if (classification === LIMB_KINETIC.RIGID && !detectedProsthetics.includes(limbKey)) {
        detectedProsthetics.push(limbKey);
      }
      limbs[limbKey] = {
        classification,
        jointKey,
        sampleCount: angleSeries.length,
        variance: joints[jointKey].variance,
      };
    }
  }

  // Overall posture
  let overallPosture;
  if (maxSamples < MIN_SAMPLES_FOR_ANALYSIS) {
    overallPosture = 'insufficient';
  } else if (detectedProsthetics.length > 0) {
    overallPosture = 'prosthetic_detected';
  } else {
    overallPosture = 'natural';
  }

  return {
    joints,
    limbs,
    overallPosture,
    detectedProsthetics,
    totalFramesAnalyzed: frames.length,
  };
}


/**
 * Infer disability profile fields from kinetic analysis results.
 * Used to auto-populate anatomy profile from movement data.
 *
 * @param {KineticProfile} kineticProfile
 * @param {Object} postureDecision - From ScanSequencer posture detection
 * @returns {Object} Partial profile fields (disability, amputationSide, mobilityAid)
 */
function inferProfileFromKinetics(kineticProfile, postureDecision) {
  const result = { disability: 'none' };

  if (!kineticProfile || kineticProfile.overallPosture === 'insufficient') {
    // Fall back to posture detection only
    if (postureDecision?.posture === 'wheelchair') {
      result.disability = 'wheelchair';
      result.mobilityAid = 'wheelchair';
    } else if (postureDecision?.detectedAids?.crutches) {
      result.mobilityAid = 'crutches';
    } else if (postureDecision?.detectedAids?.prosthetic) {
      result.mobilityAid = 'prosthesis';
    }
    return result;
  }

  // Wheelchair takes priority (from posture detection)
  if (postureDecision?.posture === 'wheelchair') {
    result.disability = 'wheelchair';
    result.mobilityAid = 'wheelchair';
    return result;
  }

  // Crutches from posture detection
  if (postureDecision?.detectedAids?.crutches) {
    result.mobilityAid = 'crutches';
  }

  // Prosthetic detection from kinetic analysis
  const rigidLimbs = kineticProfile.detectedProsthetics || [];

  if (rigidLimbs.length === 0) {
    // No rigid limbs detected — natural
    if (postureDecision?.detectedAids?.prosthetic) {
      result.mobilityAid = 'prosthesis';
    }
    return result;
  }

  // Classify based on which limbs are rigid
  const rigidLegs = rigidLimbs.filter(l => l.includes('leg'));
  const rigidArms = rigidLimbs.filter(l => l.includes('arm'));

  if (rigidLegs.length === 2) {
    result.disability = 'two_legs';
    result.mobilityAid = result.mobilityAid || 'prosthesis';
  } else if (rigidLegs.length === 1) {
    result.disability = 'one_leg';
    result.amputationSide = rigidLegs[0].includes('left') ? 'left' : 'right';
    result.mobilityAid = result.mobilityAid || 'prosthesis';
  } else if (rigidArms.length === 2) {
    result.disability = 'two_arms';
  } else if (rigidArms.length === 1) {
    result.disability = 'one_arm';
    result.amputationSide = rigidArms[0].includes('left') ? 'left' : 'right';
  }

  return result;
}


// ============================================================
// Gait Analysis — March-in-Place Detection
// ============================================================

/**
 * Analyze gait pattern from march-in-place frames.
 * Measures alternating ankle vertical displacement to detect:
 * - Natural gait (symmetric, regular stride)
 * - Prosthetic gait (asymmetric, irregular)
 *
 * @param {Object[][]} frames - Landmark frames from march-in-place segment
 * @param {number} sampleRate - Camera FPS
 * @returns {GaitProfile}
 *
 * @typedef {Object} GaitProfile
 * @property {string} status - 'natural' | 'asymmetric' | 'insufficient'
 * @property {number|null} symmetryRatio - 0-1, ratio of weaker/stronger ankle amplitude
 * @property {number|null} stepFrequency - Steps per second
 * @property {number} leftAmplitude - Left ankle Y stdDev
 * @property {number} rightAmplitude - Right ankle Y stdDev
 * @property {string|null} weakerSide - 'left' | 'right' | null
 * @property {number} totalSteps - Estimated step count
 */
function analyzeGait(frames, sampleRate = 30) {
  if (!frames || frames.length < MIN_SAMPLES_FOR_ANALYSIS) {
    return { status: 'insufficient', symmetryRatio: null, stepFrequency: null };
  }

  // Extract ankle Y positions over time (mirror-corrected: person's left = RIGHT landmark)
  const leftAnkleY = [];
  const rightAnkleY = [];
  for (const frame of frames) {
    const la = frame[LM.RIGHT_ANKLE];
    const ra = frame[LM.LEFT_ANKLE];
    leftAnkleY.push(la?.visibility > MIN_VISIBILITY ? la.y : null);
    rightAnkleY.push(ra?.visibility > MIN_VISIBILITY ? ra.y : null);
  }

  // Filter nulls and compute stats
  const leftValid = leftAnkleY.filter(v => v !== null);
  const rightValid = rightAnkleY.filter(v => v !== null);

  if (leftValid.length < 20 || rightValid.length < 20) {
    return { status: 'insufficient', symmetryRatio: null, stepFrequency: null };
  }

  const leftStats = computeStats(leftValid);
  const rightStats = computeStats(rightValid);

  // Amplitude: stdDev of Y-position (how much ankle moves up/down)
  const leftAmplitude = leftStats.stdDev;
  const rightAmplitude = rightStats.stdDev;

  // Symmetry: ratio of smaller to larger amplitude (1.0 = perfect symmetry)
  const maxAmp = Math.max(leftAmplitude, rightAmplitude);
  const minAmp = Math.min(leftAmplitude, rightAmplitude);
  const symmetryRatio = maxAmp > 0 ? Math.round((minAmp / maxAmp) * 100) / 100 : 1.0;

  // Zero-crossing count for step frequency estimation
  const leftZC = countZeroCrossings(leftValid, leftStats.mean);
  const rightZC = countZeroCrossings(rightValid, rightStats.mean);
  const totalSteps = Math.round((leftZC + rightZC) / 2);
  const durationSec = frames.length / sampleRate;
  const stepFrequency = durationSec > 0
    ? Math.round((totalSteps / durationSec) * 100) / 100
    : 0;

  // Classification
  const status = symmetryRatio >= 0.7 ? 'natural' : 'asymmetric';

  // Which side is weaker?
  let weakerSide = null;
  if (symmetryRatio < 0.7) {
    weakerSide = leftAmplitude < rightAmplitude ? 'left' : 'right';
  }

  return {
    status,
    symmetryRatio,
    stepFrequency,
    leftAmplitude: Math.round(leftAmplitude * 10000) / 10000,
    rightAmplitude: Math.round(rightAmplitude * 10000) / 10000,
    weakerSide,
    totalSteps,
  };
}

/**
 * Count zero-crossings around the mean in a value series.
 * Used to estimate step count from ankle oscillation.
 */
function countZeroCrossings(values, mean) {
  let crossings = 0;
  for (let i = 1; i < values.length; i++) {
    if ((values[i - 1] - mean) * (values[i] - mean) < 0) {
      crossings++;
    }
  }
  return crossings;
}


// ============================================================
// Anatomical Profiler — Automatic Classification
// ============================================================

// Classification labels for anatomical profiling
const ANATOMY = Object.freeze({
  NATURAL:              'natural',
  TRANSFEMORAL:         'transfemoral',   // above-knee amputation: hip moves, knee+ankle frozen
  TRANSTIBIAL:          'transtibial',    // below-knee amputation: hip+knee move, ankle frozen
  BILATERAL:            'bilateral',      // both legs prosthetic
  ARM_AMPUTEE:          'arm_amputee',    // missing arm
  INSUFFICIENT:         'insufficient',
});

// Thresholds for joint variance classification
// Hierarchical depth diagnosis:
//   Step 1: knee_variance < 0.1 → TRANSFEMORAL (above-knee, knee frozen)
//   Step 2: knee_variance >= 0.1 AND (ankle frozen OR ankle/knee ratio < 0.1) → TRANSTIBIAL
const KNEE_FROZEN_THRESHOLD = 0.1;         // deg² — knee variance below = frozen (above-knee)
const KNEE_MOVING_THRESHOLD = 0.5;         // deg² — knee variance above = moving (below-knee)
const ANKLE_FROZEN_THRESHOLD = 0.00005;    // Y-position variance — ankle frozen if below this
const ANKLE_KNEE_RATIO_THRESHOLD = 0.1;    // ankle/knee variance ratio below this = ankle frozen relative to knee
const JOINT_FROZEN_VARIANCE = 1.0;         // deg² — generic frozen threshold (used by mid-diag)
const JOINT_MOVING_VARIANCE = 2.0;         // deg² — above this = natural movement
const POSITION_FROZEN_VARIANCE = 0.0001;   // Y-position variance — below = frozen
const POSITION_MOVING_VARIANCE = 0.0005;   // Y-position variance — above = moving
const ARM_VISIBILITY_RATIO = 0.2;          // below this = arm likely absent
const MIN_JOINT_SAMPLES_RATIO = 0.5;       // need >= 50% of frames visible to classify a joint
const HIP_DEVIATION_THRESHOLD = 0.015;     // ~1.5% frame width — hip center offset from nose

/**
 * Add arm analysis to an anatomy result (shared by bilateral and unilateral paths).
 * @param {Object} result - The anatomy result object to mutate
 * @param {Object[][]} frames - Landmark frames
 * @private
 */
function _addArmAnalysis(result, frames) {
  const armDefs = [
    // Mirror-corrected: person's left = RIGHT landmark
    { side: 'left', limbKey: 'left_arm', elbowIdx: LM.RIGHT_ELBOW, wristIdx: LM.RIGHT_WRIST },
    { side: 'right', limbKey: 'right_arm', elbowIdx: LM.LEFT_ELBOW, wristIdx: LM.LEFT_WRIST },
  ];
  for (const arm of armDefs) {
    let visibleCount = 0;
    for (const frame of frames) {
      const elbow = frame[arm.elbowIdx];
      const wrist = frame[arm.wristIdx];
      if (elbow?.visibility >= MIN_VISIBILITY && wrist?.visibility >= MIN_VISIBILITY) {
        visibleCount++;
      }
    }
    const ratio = frames.length > 0 ? visibleCount / frames.length : 1;
    result.arms[arm.side].visibilityRatio = ratio;
    if (ratio < ARM_VISIBILITY_RATIO) {
      result.arms[arm.side].classification = ANATOMY.ARM_AMPUTEE;
      result.affectedLimbs.push(arm.limbKey);
    }
  }
}

/**
 * Compute average hip-center deviation from nose vertical axis.
 * Camera is mirrored, so screen-right = person's LEFT.
 * Positive deviation (hips right of nose on screen) = person leans LEFT → prosthetic is RIGHT.
 * Negative deviation (hips left of nose on screen) = person leans RIGHT → prosthetic is LEFT.
 *
 * @param {Object[][]} frames
 * @returns {number|null}
 */
function computeHipCenterDeviation(frames) {
  const deviations = [];
  for (const frame of frames) {
    const nose = frame[LM.NOSE];
    const lh = frame[LM.LEFT_HIP];
    const rh = frame[LM.RIGHT_HIP];
    if (!nose || nose.visibility < MIN_VISIBILITY) continue;
    if (!lh || lh.visibility < MIN_VISIBILITY) continue;
    if (!rh || rh.visibility < MIN_VISIBILITY) continue;
    const hipCenterX = (lh.x + rh.x) / 2;
    // Negate to correct for mirror: screen-right offset → person's left offset
    deviations.push(-(hipCenterX - nose.x));
  }
  if (deviations.length < MIN_SAMPLES_FOR_ANALYSIS) return null;
  return deviations.reduce((s, v) => s + v, 0) / deviations.length;
}

/**
 * Compute center-of-gravity bias from hip+shoulder midpoints.
 * Returns { biasX, biasDirection } where biasDirection is 'left'|'right'|null.
 * Body shifts CoG TOWARD the healthy side (away from prosthetic).
 *
 * @param {Object[][]} frames
 * @returns {{ biasX: number, biasDirection: string|null }|null}
 */
function computeCenterOfGravity(frames) {
  const COG_BIAS_THRESHOLD = 0.01; // 1% frame width
  const biases = [];
  for (const frame of frames) {
    const lh = frame[LM.LEFT_HIP], rh = frame[LM.RIGHT_HIP];
    const ls = frame[LM.LEFT_SHOULDER], rs = frame[LM.RIGHT_SHOULDER];
    if (!lh || !rh || !ls || !rs) continue;
    if (lh.visibility < MIN_VISIBILITY || rh.visibility < MIN_VISIBILITY) continue;
    if (ls.visibility < MIN_VISIBILITY || rs.visibility < MIN_VISIBILITY) continue;
    const hipMidX = (lh.x + rh.x) / 2;
    const shoulderMidX = (ls.x + rs.x) / 2;
    const cogX = (hipMidX + shoulderMidX) / 2;
    // Negate to correct for mirror: screen-right = person's left
    biases.push(-(cogX - 0.5));
  }
  if (biases.length < MIN_SAMPLES_FOR_ANALYSIS) return null;
  const meanBias = biases.reduce((s, v) => s + v, 0) / biases.length;
  return {
    biasX: meanBias,
    biasDirection: Math.abs(meanBias) >= COG_BIAS_THRESHOLD ? (meanBias > 0 ? 'right' : 'left') : null,
  };
}

/**
 * Profile the anatomical structure from landmark frames.
 *
 * BILATERAL DETECTION (checked first):
 *   If both knees AND both ankles are frozen → BILATERAL (both legs prosthetic)
 *
 * COMPARATIVE SIDE DETECTION (unilateral):
 *   Computes knee and ankle variance for BOTH legs simultaneously.
 *   The side with MORE asymmetrically frozen joints is the prosthetic side.
 *
 * HIERARCHICAL DEPTH DIAGNOSIS:
 *   Step 1: knee frozen (< 0.1) → TRANSFEMORAL (above-knee)
 *   Step 2: knee moves (>= 0.1) + ankle frozen (absolute OR relative to knee) → TRANSTIBIAL
 *
 * @param {Object[][]} frames - Landmark frames from detection phase
 * @returns {AnatomyProfile}
 *
 * @typedef {Object} AnatomyProfile
 * @property {string} classification - Overall: ANATOMY value
 * @property {Object} legs - Per-leg data (kneeVariance, ankleVariance, classification)
 * @property {Object} arms - Per-arm data (visibilityRatio, classification)
 * @property {string|null} affectedSide - 'left' | 'right' | null
 * @property {string|null} adaptedTrack - Suggested diagnostic track key
 * @property {string[]} affectedLimbs - Limbs with non-natural classification
 */
function profileAnatomy(frames, options = {}) {
  const result = {
    classification: ANATOMY.NATURAL,
    legs: {
      left:  { classification: ANATOMY.NATURAL, hipVariance: 0, kneeVariance: 0, ankleVariance: 0, kneeSampleCount: 0, ankleSampleCount: 0 },
      right: { classification: ANATOMY.NATURAL, hipVariance: 0, kneeVariance: 0, ankleVariance: 0, kneeSampleCount: 0, ankleSampleCount: 0 },
    },
    arms: {
      left:  { classification: ANATOMY.NATURAL, visibilityRatio: 1 },
      right: { classification: ANATOMY.NATURAL, visibilityRatio: 1 },
    },
    affectedSide: null,
    adaptedTrack: null,
    affectedLimbs: [],
    untrackedJoints: [],
  };

  if (!frames || frames.length < MIN_SAMPLES_FOR_ANALYSIS) {
    result.classification = ANATOMY.INSUFFICIENT;
    return result;
  }

  // ── Collect variance data for both legs ──
  // Mirror-corrected: person's left uses RIGHT_ANKLE landmark, and vice versa
  const legDefs = [
    {
      side: 'left',
      limbKey: 'left_leg',
      hipJoint: JOINT_DEFS.left_hip,
      kneeJoint: JOINT_DEFS.left_knee,
      ankleIdx: LM.RIGHT_ANKLE,
    },
    {
      side: 'right',
      limbKey: 'right_leg',
      hipJoint: JOINT_DEFS.right_hip,
      kneeJoint: JOINT_DEFS.right_knee,
      ankleIdx: LM.LEFT_ANKLE,
    },
  ];

  for (const leg of legDefs) {
    const hipAngles = extractAngleSeries(frames, leg.hipJoint);
    const hipStats = computeStats(hipAngles);

    const kneeAngles = extractAngleSeries(frames, leg.kneeJoint);
    const kneeStats = computeStats(kneeAngles);

    // Ankle Y-position variance — measures if the ankle physically moves
    // Scale: ~0.0001-0.001 for natural sway, ~0 for frozen prosthetic
    const ankleYValues = [];
    for (const frame of frames) {
      const ankle = frame[leg.ankleIdx];
      if (ankle && ankle.visibility >= MIN_VISIBILITY) ankleYValues.push(ankle.y);
    }
    const ankleYStats = computeStats(ankleYValues);

    result.legs[leg.side].hipVariance = hipStats.variance;
    result.legs[leg.side].kneeVariance = kneeStats.variance;
    result.legs[leg.side].ankleVariance = ankleYStats.variance;
    result.legs[leg.side].kneeSampleCount = kneeAngles.length;
    result.legs[leg.side].ankleSampleCount = ankleYValues.length;
  }

  // ── Visibility guard: joints need >= 50% visibility to be classified ──
  const left = result.legs.left;
  const right = result.legs.right;
  const totalFrames = frames.length;
  const minRequired = Math.floor(totalFrames * MIN_JOINT_SAMPLES_RATIO);

  const leftKneeTracked = left.kneeSampleCount >= minRequired;
  const leftAnkleTracked = left.ankleSampleCount >= minRequired;
  const rightKneeTracked = right.kneeSampleCount >= minRequired;
  const rightAnkleTracked = right.ankleSampleCount >= minRequired;

  // Populate untrackedJoints
  if (!leftKneeTracked) result.untrackedJoints.push('left_knee');
  if (!leftAnkleTracked) result.untrackedJoints.push('left_ankle');
  if (!rightKneeTracked) result.untrackedJoints.push('right_knee');
  if (!rightAnkleTracked) result.untrackedJoints.push('right_ankle');

  // UNTRACKED GUARD: A joint can only be "frozen" if it was actually tracked
  const leftKneeFrozen = leftKneeTracked && left.kneeVariance < KNEE_FROZEN_THRESHOLD;
  const leftAnkleFrozen = leftAnkleTracked && left.ankleVariance < ANKLE_FROZEN_THRESHOLD;
  const rightKneeFrozen = rightKneeTracked && right.kneeVariance < KNEE_FROZEN_THRESHOLD;
  const rightAnkleFrozen = rightAnkleTracked && right.ankleVariance < ANKLE_FROZEN_THRESHOLD;

  // ── Bilateral detection: both legs frozen (requires all 4 tracked) ──
  const bothKneesFrozen = leftKneeFrozen && rightKneeFrozen;
  const bothAnklesFrozen = leftAnkleFrozen && rightAnkleFrozen;

  if (bothKneesFrozen && bothAnklesFrozen) {
    // Both legs fully frozen → bilateral
    result.legs.left.classification = ANATOMY.TRANSFEMORAL;
    result.legs.right.classification = ANATOMY.TRANSFEMORAL;
    result.classification = ANATOMY.BILATERAL;
    result.adaptedTrack = 'BILATERAL_AMPUTEE';
    result.affectedSide = 'both';
    result.affectedLimbs.push('left_leg', 'right_leg');
    _addArmAnalysis(result, frames);
    return result;
  }

  // ── Comparative side detection: compare left vs right ──
  // Determine prosthetic side by comparing which side has frozen joints
  let prostheticSide = null;
  let prostheticLeg = null;
  let healthySide = null;

  // Count asymmetrically frozen joints per side
  const leftFrozenCount =
    (leftKneeFrozen && !rightKneeFrozen ? 1 : 0) +
    (leftAnkleFrozen && !rightAnkleFrozen ? 1 : 0);
  const rightFrozenCount =
    (rightKneeFrozen && !leftKneeFrozen ? 1 : 0) +
    (rightAnkleFrozen && !leftAnkleFrozen ? 1 : 0);

  // The side with more asymmetrically frozen joints is the prosthetic side
  if (leftFrozenCount > rightFrozenCount) {
    prostheticSide = 'left';
    prostheticLeg = left;
    healthySide = 'right';
  } else if (rightFrozenCount > leftFrozenCount) {
    prostheticSide = 'right';
    prostheticLeg = right;
    healthySide = 'left';
  }

  // ── Hip-center deviation: absolute side detection ──
  // The body leans TOWARD the healthy leg → hip center shifts toward healthy side
  // Positive deviation = hips right of nose → prosthetic is LEFT
  // Negative deviation = hips left of nose → prosthetic is RIGHT
  const hipDeviation = computeHipCenterDeviation(frames);
  if (hipDeviation !== null && Math.abs(hipDeviation) >= HIP_DEVIATION_THRESHOLD) {
    const deviationSide = hipDeviation > 0 ? 'left' : 'right';
    if (prostheticSide && prostheticSide !== deviationSide) {
      // Conflict: frozen-joint says one side, hip-deviation says another → trust hip-deviation
      prostheticSide = deviationSide;
      prostheticLeg = result.legs[deviationSide];
      healthySide = deviationSide === 'left' ? 'right' : 'left';
    } else if (!prostheticSide) {
      // Frozen joints couldn't determine side, use hip deviation
      prostheticSide = deviationSide;
      prostheticLeg = result.legs[deviationSide];
      healthySide = deviationSide === 'left' ? 'right' : 'left';
    }
  }

  if (prostheticSide) {
    // ─── HIERARCHICAL DEPTH DIAGNOSIS ───
    // Step 1: Check knee as PRIMARY discriminator
    // Step 2: If knee moves, check ankle (absolute + relative ratio) for TRANSTIBIAL
    const pKneeTracked = prostheticSide === 'left' ? leftKneeTracked : rightKneeTracked;
    const pAnkleTracked = prostheticSide === 'left' ? leftAnkleTracked : rightAnkleTracked;
    const pKneeVar = prostheticLeg.kneeVariance;
    const pAnkleVar = prostheticLeg.ankleVariance;

    if (pKneeTracked && pKneeVar < KNEE_FROZEN_THRESHOLD) {
      // Knee is frozen → TRANSFEMORAL (above-knee amputation)
      // No need to check ankle — if knee doesn't move, everything below is prosthetic
      result.legs[prostheticSide].classification = ANATOMY.TRANSFEMORAL;
      result.affectedLimbs.push(`${prostheticSide}_leg`);
      result.affectedSide = prostheticSide;
      result.classification = ANATOMY.TRANSFEMORAL;
      result.adaptedTrack = 'TRANSFEMORAL_AMPUTEE';
    } else if (pKneeTracked && pKneeVar >= KNEE_FROZEN_THRESHOLD) {
      // Knee has movement — check ankle for TRANSTIBIAL confirmation
      const ankleFrozenAbsolute = pAnkleTracked && pAnkleVar < ANKLE_FROZEN_THRESHOLD;
      const ankleKneeRatio = pKneeVar > 0 ? pAnkleVar / pKneeVar : 0;
      const ankleFrozenRelative = pAnkleTracked && ankleKneeRatio < ANKLE_KNEE_RATIO_THRESHOLD;

      if (ankleFrozenAbsolute || ankleFrozenRelative) {
        // Ankle doesn't move despite knee moving → TRANSTIBIAL (below-knee)
        result.legs[prostheticSide].classification = ANATOMY.TRANSTIBIAL;
        result.affectedLimbs.push(`${prostheticSide}_leg`);
        result.affectedSide = prostheticSide;
        result.classification = ANATOMY.TRANSTIBIAL;
        result.adaptedTrack = 'TRANSTIBIAL_AMPUTEE';
        result.depthConfirmation = 'ankle_frozen_relative_to_knee';
      }
    }
  }

  // ── Integrative analysis gate (opt-in via options.integrativeAnalysis) ──
  // Require ALL 3 signals to confirm prosthetic side:
  // (1) Frozen joints, (2) Hip deviation, (3) CoG bias
  if (options.integrativeAnalysis && prostheticSide && result.adaptedTrack) {
    const effectiveHipThreshold = options.strictMode ? HIP_DEVIATION_THRESHOLD / 2 : HIP_DEVIATION_THRESHOLD;

    const hipConfirms = hipDeviation !== null &&
      Math.abs(hipDeviation) >= effectiveHipThreshold &&
      (hipDeviation > 0 ? 'left' : 'right') === prostheticSide;

    const cog = computeCenterOfGravity(frames);
    result.cogBias = cog;
    const cogConfirms = cog !== null &&
      cog.biasDirection !== null &&
      cog.biasDirection !== prostheticSide; // CoG shifts TOWARD healthy side

    const frozenConfirms = true; // already established by frozen-joint logic

    // Optional 4th signal: calf raise result from motion calibration
    const calfRaiseConfirms = options.calfRaiseResult
      ? (prostheticSide === 'left' ? !options.calfRaiseResult.leftAnkleMoved : !options.calfRaiseResult.rightAnkleMoved)
      : null;

    const signals = [frozenConfirms, hipConfirms, cogConfirms];
    if (calfRaiseConfirms !== null) signals.push(calfRaiseConfirms);
    const confirmCount = signals.filter(Boolean).length;
    const requiredCount = 3; // all 3 core signals must agree
    result.integrativeConfidence = confirmCount / signals.length;

    if (confirmCount < requiredCount) {
      // Integrative analysis failed — reset classification
      result.legs[prostheticSide].classification = ANATOMY.NATURAL;
      result.classification = ANATOMY.NATURAL;
      result.adaptedTrack = null;
      result.affectedSide = null;
      result.affectedLimbs = result.affectedLimbs.filter(l => l !== `${prostheticSide}_leg`);
      result.insufficientConfidence = true;
    }
  }

  // ── Arm analysis ──
  _addArmAnalysis(result, frames);

  // ── ARM_AMPUTEE override (only if no leg classification) ──
  if (!result.adaptedTrack) {
    const hasArmAmputee = Object.values(result.arms).some(a => a.classification === ANATOMY.ARM_AMPUTEE);
    if (hasArmAmputee) {
      result.classification = ANATOMY.ARM_AMPUTEE;
      result.adaptedTrack = 'ARM_AMPUTEE';
    }
  }

  return result;
}


// ---- Exports ----

export {
  analyzeKinetics,
  inferProfileFromKinetics,
  analyzeGait,
  profileAnatomy,
  computeHipCenterDeviation,
  computeCenterOfGravity,
  computeAngle,
  computeStats,
  extractAngleSeries,
  JOINT_DEFS,
  JOINT_TO_LIMB,
  LIMB_KINETIC,
  ANATOMY,
  PROSTHETIC_VARIANCE_THRESHOLD,
  MIN_SAMPLES_FOR_ANALYSIS,
  JOINT_FROZEN_VARIANCE,
  JOINT_MOVING_VARIANCE,
  KNEE_FROZEN_THRESHOLD,
  KNEE_MOVING_THRESHOLD,
  ANKLE_FROZEN_THRESHOLD,
  ARM_VISIBILITY_RATIO,
  MIN_JOINT_SAMPLES_RATIO,
  HIP_DEVIATION_THRESHOLD,
  ANKLE_KNEE_RATIO_THRESHOLD,
};

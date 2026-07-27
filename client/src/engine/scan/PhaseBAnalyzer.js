// ============================================================
// PhaseBAnalyzer — Dynamic Scan Analysis (Phase B)
//
// PURE LOGIC — receives all data as parameters.
// Zero external dependencies except DampingAnalyzer (sibling module).
//
// What it does:
//   Takes the landmark data collected during each guided movement
//   and produces a per-limb kinetic analysis using DampingAnalyzer.
//
// Four analysis types (one per movement type):
//   1. damping       — FFT damping ratio per target limb
//   2. stability     — single-leg stand sway + tremor
//   3. compensation  — lateral weight shift asymmetry
//   4. rhythm_baseline — walking rhythm symmetry
//
// Output: per-limb summary with damping, stability, compensation,
//         rhythm data — ready for CertaintyGate validation.
// ============================================================

import {
  analyzeDamping,
  compareSymmetry,
  analyzeStability,
} from './DampingAnalyzer.js';
import { LM } from './movements.js';


// ---- Constants ----

// Minimum frames to attempt any analysis
const MIN_MOVEMENT_FRAMES = 20;

// Landmark indices that belong to each limb (for extracting trajectories)
const LIMB_PRIMARY_LANDMARKS = Object.freeze({
  left_leg:  [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE],
  right_leg: [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  left_arm:  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST],
  right_arm: [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
});

// The distal (tip) landmark for each limb — most informative for damping
const LIMB_DISTAL_LANDMARK = Object.freeze({
  left_leg:  LM.LEFT_ANKLE,
  right_leg: LM.RIGHT_ANKLE,
  left_arm:  LM.LEFT_WRIST,
  right_arm: LM.RIGHT_WRIST,
});

// The proximal (root) landmark for stability reference
const LIMB_PROXIMAL_LANDMARK = Object.freeze({
  left_leg:  LM.LEFT_HIP,
  right_leg: LM.RIGHT_HIP,
  left_arm:  LM.LEFT_SHOULDER,
  right_arm: LM.RIGHT_SHOULDER,
});

// Opposite limbs for symmetry comparison
const OPPOSITE_LIMB = Object.freeze({
  left_leg:  'right_leg',
  right_leg: 'left_leg',
  left_arm:  'right_arm',
  right_arm: 'left_arm',
});

// Compensation detection thresholds
const COMPENSATION_THRESHOLDS = Object.freeze({
  // Hip drop: vertical asymmetry between left/right hip during weight shift
  HIP_DROP_RATIO: 0.15,
  // Trunk lean: lateral shift of shoulder midpoint relative to hip midpoint
  TRUNK_LEAN_THRESHOLD: 0.03,
  // Shoulder elevation: vertical difference between shoulders
  SHOULDER_ELEVATION_THRESHOLD: 0.02,
});


// ============================================================
// Trajectory Extraction — pull time series from landmark frames
// ============================================================

/**
 * Extract the Y (vertical) trajectory of a specific landmark across frames.
 *
 * @param {Object[]} frames - Array of landmark arrays (each frame = landmarks[33])
 * @param {number} landmarkIndex - MediaPipe landmark index
 * @returns {number[]} - Y values per frame
 */
function extractTrajectoryY(frames, landmarkIndex) {
  const values = [];
  for (const frame of frames) {
    if (!frame || !frame[landmarkIndex]) {
      values.push(0);
    } else {
      values.push(frame[landmarkIndex].y ?? 0);
    }
  }
  return values;
}

/**
 * Extract the X (lateral) trajectory of a specific landmark across frames.
 */
function extractTrajectoryX(frames, landmarkIndex) {
  const values = [];
  for (const frame of frames) {
    if (!frame || !frame[landmarkIndex]) {
      values.push(0);
    } else {
      values.push(frame[landmarkIndex].x ?? 0);
    }
  }
  return values;
}


// ============================================================
// Analysis Type Handlers
// ============================================================

/**
 * Damping analysis — compute damping ratio for each target limb.
 * Uses the distal landmark's Y trajectory (most movement amplitude).
 *
 * @param {Object[]} frames - Landmark frames for this movement
 * @param {string[]} targetLimbs - Which limbs to analyze
 * @param {number} sampleRate - FPS
 * @returns {Object.<string, Object>} - Per-limb damping results
 */
function analyzeDampingMovement(frames, targetLimbs, sampleRate) {
  const results = {};

  for (const limb of targetLimbs) {
    const distalIdx = LIMB_DISTAL_LANDMARK[limb];
    if (distalIdx === undefined) continue;

    const yValues = extractTrajectoryY(frames, distalIdx);
    const dampingResult = analyzeDamping(yValues, sampleRate);

    results[limb] = {
      type: 'damping',
      ...dampingResult,
    };
  }

  // Add symmetry comparison for limb pairs
  const pairs = findLimbPairs(targetLimbs);
  for (const [limbA, limbB] of pairs) {
    if (results[limbA] && results[limbB]) {
      const symmetry = compareSymmetry(results[limbA], results[limbB]);
      results[limbA].symmetry = symmetry;
      results[limbB].symmetry = symmetry;
    }
  }

  return results;
}


/**
 * Stability analysis — single-leg stand sway and tremor detection.
 * Analyzes the standing leg's ankle in both X and Y.
 *
 * @param {Object[]} frames - Landmark frames for this movement
 * @param {string[]} targetLimbs - The leg being stood on
 * @param {number} sampleRate - FPS
 * @returns {Object.<string, Object>} - Per-limb stability results
 */
function analyzeStabilityMovement(frames, targetLimbs, sampleRate) {
  const results = {};

  for (const limb of targetLimbs) {
    const distalIdx = LIMB_DISTAL_LANDMARK[limb];
    if (distalIdx === undefined) continue;

    const xValues = extractTrajectoryX(frames, distalIdx);
    const yValues = extractTrajectoryY(frames, distalIdx);
    const stabilityResult = analyzeStability(xValues, yValues, sampleRate);

    results[limb] = {
      type: 'stability',
      ...stabilityResult,
    };
  }

  return results;
}


/**
 * Compensation analysis — detect weight shift asymmetry.
 * During lateral weight shift, looks for:
 *   - Hip drop (one hip drops more than the other)
 *   - Trunk lean (shoulders shift laterally to compensate)
 *   - Shoulder elevation (one shoulder raises to balance)
 *
 * @param {Object[]} frames - Landmark frames for this movement
 * @param {string[]} targetLimbs - Limbs being analyzed
 * @param {number} sampleRate - FPS
 * @returns {Object.<string, Object>} - Per-limb compensation results
 */
function analyzeCompensationMovement(frames, targetLimbs, sampleRate) {
  if (frames.length < MIN_MOVEMENT_FRAMES) {
    return createEmptyCompensationResult(targetLimbs);
  }

  // Extract hip and shoulder trajectories
  const leftHipY  = extractTrajectoryY(frames, LM.LEFT_HIP);
  const rightHipY = extractTrajectoryY(frames, LM.RIGHT_HIP);
  const leftHipX  = extractTrajectoryX(frames, LM.LEFT_HIP);
  const rightHipX = extractTrajectoryX(frames, LM.RIGHT_HIP);

  const leftShoulderY  = extractTrajectoryY(frames, LM.LEFT_SHOULDER);
  const rightShoulderY = extractTrajectoryY(frames, LM.RIGHT_SHOULDER);
  const leftShoulderX  = extractTrajectoryX(frames, LM.LEFT_SHOULDER);
  const rightShoulderX = extractTrajectoryX(frames, LM.RIGHT_SHOULDER);

  // Hip drop: compare vertical range of motion between hips
  const leftHipRange  = rangeOf(leftHipY);
  const rightHipRange = rangeOf(rightHipY);
  const hipRangeMax = Math.max(leftHipRange, rightHipRange, 0.001);
  const hipDropRatio = Math.abs(leftHipRange - rightHipRange) / hipRangeMax;
  const hipDropSide = leftHipRange > rightHipRange ? 'left' : 'right';

  // Trunk lean: lateral shift of shoulder midpoint vs hip midpoint
  const trunkLeans = [];
  for (let i = 0; i < frames.length; i++) {
    const shoulderMidX = (leftShoulderX[i] + rightShoulderX[i]) / 2;
    const hipMidX = (leftHipX[i] + rightHipX[i]) / 2;
    trunkLeans.push(shoulderMidX - hipMidX);
  }
  const trunkLeanRange = rangeOf(trunkLeans);
  const trunkLeanMean = mean(trunkLeans);
  const trunkLeanSide = trunkLeanMean > 0 ? 'right' : 'left';

  // Shoulder elevation: vertical difference between shoulders
  const shoulderDiffs = [];
  for (let i = 0; i < frames.length; i++) {
    shoulderDiffs.push(leftShoulderY[i] - rightShoulderY[i]);
  }
  const shoulderElevationMean = Math.abs(mean(shoulderDiffs));
  const shoulderElevationSide = mean(shoulderDiffs) < 0 ? 'left' : 'right';

  // Detect compensation patterns
  const patterns = [];

  if (hipDropRatio > COMPENSATION_THRESHOLDS.HIP_DROP_RATIO) {
    patterns.push({
      type: 'hip_drop',
      side: hipDropSide,
      magnitude: round4(hipDropRatio),
    });
  }

  if (trunkLeanRange > COMPENSATION_THRESHOLDS.TRUNK_LEAN_THRESHOLD) {
    patterns.push({
      type: 'trunk_lean',
      side: trunkLeanSide,
      magnitude: round4(trunkLeanRange),
    });
  }

  if (shoulderElevationMean > COMPENSATION_THRESHOLDS.SHOULDER_ELEVATION_THRESHOLD) {
    patterns.push({
      type: 'shoulder_elevation',
      side: shoulderElevationSide,
      magnitude: round4(shoulderElevationMean),
    });
  }

  // Weight distribution: how much time spent on each side
  const hipMidXValues = leftHipX.map((v, i) => (v + rightHipX[i]) / 2);
  const hipCenter = mean(hipMidXValues);
  let leftCount = 0;
  for (const v of hipMidXValues) {
    if (v < hipCenter) leftCount++;
  }
  const leftRatio = leftCount / hipMidXValues.length;

  // Build per-limb results
  const results = {};
  for (const limb of targetLimbs) {
    results[limb] = {
      type: 'compensation',
      patterns,
      weight_distribution: {
        left_ratio: round4(leftRatio),
        right_ratio: round4(1 - leftRatio),
        is_symmetric: Math.abs(leftRatio - 0.5) < 0.1,
      },
      sufficient_data: true,
    };
  }

  return results;
}


/**
 * Rhythm baseline analysis — establish natural movement rhythm.
 * During walking-in-place, measures:
 *   - Step frequency (dominant oscillation)
 *   - Left/right rhythm symmetry
 *   - Arm swing coupling
 *
 * @param {Object[]} frames - Landmark frames for this movement
 * @param {string[]} targetLimbs - Limbs being analyzed
 * @param {number} sampleRate - FPS
 * @returns {Object.<string, Object>} - Per-limb rhythm results
 */
function analyzeRhythmMovement(frames, targetLimbs, sampleRate) {
  if (frames.length < MIN_MOVEMENT_FRAMES) {
    return createEmptyRhythmResult(targetLimbs);
  }

  const results = {};

  // Analyze each target limb's rhythm via damping analysis (gives us frequency)
  for (const limb of targetLimbs) {
    const distalIdx = LIMB_DISTAL_LANDMARK[limb];
    if (distalIdx === undefined) continue;

    const yValues = extractTrajectoryY(frames, distalIdx);
    const dampingResult = analyzeDamping(yValues, sampleRate);

    results[limb] = {
      type: 'rhythm',
      step_frequency_hz: dampingResult.dominant_freq_hz,
      tremor_index: dampingResult.tremor_index,
      variance: dampingResult.variance,
      sufficient_data: dampingResult.sufficient_data,
      // Preserve damping data as secondary signal — rhythm movements
      // also reveal damping characteristics even though that's not their
      // primary purpose. This is critical for tracks (like α) where no
      // dedicated damping movement targets certain limbs.
      _damping_secondary: dampingResult.sufficient_data ? {
        damping_factor: dampingResult.damping_factor,
        damping_class: dampingResult.damping_class,
        dominant_freq_hz: dampingResult.dominant_freq_hz,
        tremor_index: dampingResult.tremor_index,
        variance: dampingResult.variance,
        spectrum_peaks: dampingResult.spectrum_peaks,
        sufficient_data: dampingResult.sufficient_data,
      } : null,
    };
  }

  // Cross-limb rhythm comparison for legs and arms
  const legPair = findSpecificPair(targetLimbs, 'left_leg', 'right_leg');
  const armPair = findSpecificPair(targetLimbs, 'left_arm', 'right_arm');

  if (legPair) {
    const [left, right] = legPair;
    // Only compare symmetry when BOTH sides have real movement data.
    // If one side has freq=0 (absent/no movement), comparison is meaningless.
    if (results[left] && results[right] &&
        results[left].sufficient_data && results[right].sufficient_data &&
        results[left].step_frequency_hz > 0 && results[right].step_frequency_hz > 0) {
      const freqDelta = Math.abs(
        results[left].step_frequency_hz - results[right].step_frequency_hz
      );
      const rhythmSymmetry = {
        frequency_delta_hz: round4(freqDelta),
        is_symmetric: freqDelta < 0.3,
      };
      results[left].rhythm_symmetry = rhythmSymmetry;
      results[right].rhythm_symmetry = rhythmSymmetry;
    }
  }

  if (armPair) {
    const [left, right] = armPair;
    if (results[left] && results[right] &&
        results[left].sufficient_data && results[right].sufficient_data &&
        results[left].step_frequency_hz > 0 && results[right].step_frequency_hz > 0) {
      const freqDelta = Math.abs(
        results[left].step_frequency_hz - results[right].step_frequency_hz
      );
      const swingSymmetry = {
        frequency_delta_hz: round4(freqDelta),
        is_symmetric: freqDelta < 0.3,
      };
      results[left].swing_symmetry = swingSymmetry;
      results[right].swing_symmetry = swingSymmetry;
    }
  }

  return results;
}


// ============================================================
// Movement Dispatcher — routes each movement to its handler
// ============================================================

/**
 * Analyze a single movement's collected data.
 *
 * @param {Object} movement - Movement definition from movements.js
 * @param {Object[]} frames - Landmark frames collected during this movement
 * @param {number} sampleRate - FPS (typically 30)
 * @returns {Object.<string, Object>} - Per-limb results for this movement
 */
export function analyzeMovement(movement, frames, sampleRate) {
  if (!frames || frames.length < MIN_MOVEMENT_FRAMES) {
    return createInsufficientDataResult(movement.target_limbs);
  }

  switch (movement.analysis_type) {
    case 'damping':
      return analyzeDampingMovement(frames, movement.target_limbs, sampleRate);
    case 'stability':
      return analyzeStabilityMovement(frames, movement.target_limbs, sampleRate);
    case 'compensation':
      return analyzeCompensationMovement(frames, movement.target_limbs, sampleRate);
    case 'rhythm_baseline':
      return analyzeRhythmMovement(frames, movement.target_limbs, sampleRate);
    default:
      return createInsufficientDataResult(movement.target_limbs);
  }
}


// ============================================================
// Full Phase B Pipeline — process all movements, aggregate
// ============================================================

/**
 * Run the complete Phase B analysis pipeline.
 *
 * Takes all movement results collected during Phase B and produces
 * a unified per-limb assessment.
 *
 * @param {MovementData[]} movementDataList - Array of collected movement data
 *   Each entry: { movement: MovementDef, frames: LandmarkFrame[], sampleRate: number }
 * @returns {PhaseBResult}
 *
 * @typedef {Object} PhaseBResult
 * @property {Object.<string, LimbAssessment>} limbs - Per-limb aggregated assessment
 * @property {number} movements_analyzed - How many movements were successfully analyzed
 * @property {number} movements_total - Total movements attempted
 *
 * @typedef {Object} LimbAssessment
 * @property {Object|null} damping - Best damping result (from damping movements)
 * @property {Object|null} stability - Best stability result (from stability movements)
 * @property {Object|null} compensation - Compensation patterns detected
 * @property {Object|null} rhythm - Rhythm baseline data
 * @property {string} overall_damping_class - Consensus damping classification
 * @property {number|null} overall_damping_factor - Consensus damping factor (ξ)
 * @property {string[]} evidence_sources - Which movement IDs contributed data
 */
export function analyzePhaseB(movementDataList) {
  if (!movementDataList || movementDataList.length === 0) {
    return {
      limbs: createEmptyLimbAssessments(),
      movements_analyzed: 0,
      movements_total: 0,
    };
  }

  // Step 1: Analyze each movement independently
  const perMovementResults = [];
  let analyzedCount = 0;

  for (const entry of movementDataList) {
    const { movement, frames, sampleRate = 30 } = entry;
    const result = analyzeMovement(movement, frames, sampleRate);
    perMovementResults.push({
      movementId: movement.id,
      analysisType: movement.analysis_type,
      targetLimbs: movement.target_limbs,
      result,
    });

    // Count if any limb got sufficient data
    const hasData = Object.values(result).some(r => r.sufficient_data !== false);
    if (hasData) analyzedCount++;
  }

  // Step 2: Aggregate per-limb across all movements
  const limbs = aggregateLimbResults(perMovementResults);

  return {
    limbs,
    movements_analyzed: analyzedCount,
    movements_total: movementDataList.length,
  };
}


/**
 * Aggregate all per-movement results into unified per-limb assessments.
 */
function aggregateLimbResults(perMovementResults) {
  const limbs = {};

  // Initialize all 4 limbs
  for (const limbKey of Object.keys(LIMB_PRIMARY_LANDMARKS)) {
    limbs[limbKey] = {
      damping: null,
      stability: null,
      compensation: null,
      rhythm: null,
      overall_damping_class: 'inconclusive',
      overall_damping_factor: null,
      evidence_sources: [],
    };
  }

  // Collect results per limb, grouped by analysis type
  for (const entry of perMovementResults) {
    for (const [limbKey, limbResult] of Object.entries(entry.result)) {
      if (!limbs[limbKey]) continue;

      const limb = limbs[limbKey];
      limb.evidence_sources.push(entry.movementId);

      switch (limbResult.type) {
        case 'damping':
          // Keep the result with the best (most confident) data
          if (!limb.damping || betterDampingResult(limbResult, limb.damping)) {
            limb.damping = stripType(limbResult);
          }
          break;

        case 'stability':
          if (!limb.stability || limbResult.sufficient_data) {
            limb.stability = stripType(limbResult);
          }
          break;

        case 'compensation':
          // Merge compensation patterns from multiple movements
          if (!limb.compensation) {
            limb.compensation = stripType(limbResult);
          } else {
            mergeCompensation(limb.compensation, limbResult);
          }
          break;

        case 'rhythm':
          if (!limb.rhythm || limbResult.sufficient_data) {
            limb.rhythm = stripType(limbResult);
          }
          // If no dedicated damping movement targeted this limb,
          // use the secondary damping data from rhythm analysis.
          // This is the fallback path for tracks like α where legs
          // only get compensation + rhythm movements, not damping.
          if (!limb.damping && limbResult._damping_secondary) {
            limb.damping = limbResult._damping_secondary;
          }
          break;
      }
    }
  }

  // Step 3: Compute overall damping consensus per limb
  for (const limbKey of Object.keys(limbs)) {
    const limb = limbs[limbKey];
    limb.evidence_sources = [...new Set(limb.evidence_sources)];

    if (limb.damping && limb.damping.damping_factor !== null) {
      limb.overall_damping_factor = limb.damping.damping_factor;
      limb.overall_damping_class = limb.damping.damping_class;
    }

    // Step 4: Cross-validation — apply clinical rules
    limb.cross_validation = applyCrossValidationRules(limb);
  }

  return limbs;
}


// ============================================================
// Cross-Validation Rules Engine
//
// Each rule is a pure function that receives a limb assessment
// and returns { triggered, override, reason } or null.
//
// Rules are applied in order. If a rule triggers, it can:
//   - Override overall_damping_class
//   - Add a reason string to the audit trail
//
// To add a new clinical rule, add a function to CROSS_VALIDATION_RULES.
// ============================================================

/**
 * @typedef {Object} CrossValidationResult
 * @property {string[]} applied_rules - Names of rules that fired
 * @property {string[]} reasons - Human-readable explanations
 * @property {string|null} original_class - Class before cross-validation (null if unchanged)
 */

const CROSS_VALIDATION_RULES = [
  // Rule 1: Tremor contradicts healthy damping
  // If stability analysis detected tremor but damping says healthy,
  // the limb is weak — tremor indicates neuromuscular instability.
  {
    id: 'tremor_overrides_healthy',
    apply(limb) {
      if (!limb.stability) return null;
      if (limb.stability.stability_class !== 'unstable_tremor') return null;
      if (limb.overall_damping_class !== 'organic_healthy') return null;

      return {
        override_class: 'organic_weak',
        reason: 'Stability test detected tremor (4-8Hz) — contradicts healthy damping classification',
      };
    },
  },

  // Rule 2: Asymmetric rhythm suggests compensation
  // If one leg's step frequency is significantly different from the other,
  // and damping says healthy, downgrade to inconclusive.
  {
    id: 'rhythm_asymmetry_flags_compensation',
    apply(limb) {
      if (!limb.rhythm) return null;
      if (!limb.rhythm.rhythm_symmetry) return null;
      if (limb.rhythm.rhythm_symmetry.is_symmetric) return null;
      if (limb.overall_damping_class !== 'organic_healthy') return null;

      // Only flag if the frequency difference is large (>0.5 Hz)
      if (limb.rhythm.rhythm_symmetry.frequency_delta_hz <= 0.5) return null;

      return {
        override_class: 'inconclusive',
        reason: `Rhythm asymmetry detected (Δf=${limb.rhythm.rhythm_symmetry.frequency_delta_hz}Hz) — healthy classification needs verification`,
      };
    },
  },

  // Rule 3: Sway during stability + compensation pattern = weak
  // If the limb shows lateral sway AND compensation patterns were detected,
  // the convergence of evidence points to weakness.
  {
    id: 'sway_plus_compensation_implies_weak',
    apply(limb) {
      if (!limb.stability || !limb.compensation) return null;
      if (limb.stability.stability_class !== 'unstable_sway') return null;
      if (!limb.compensation.patterns || limb.compensation.patterns.length === 0) return null;
      if (limb.overall_damping_class === 'mechanical') return null; // don't downgrade mechanical

      return {
        override_class: 'organic_weak',
        reason: `Lateral sway + ${limb.compensation.patterns.length} compensation pattern(s) detected — converging evidence of weakness`,
      };
    },
  },
];

/**
 * Apply all cross-validation rules to a single limb assessment.
 * Returns an audit trail of which rules fired and why.
 *
 * @param {LimbAssessment} limb - The limb to validate (mutated in place for override)
 * @returns {CrossValidationResult}
 */
function applyCrossValidationRules(limb) {
  const result = {
    applied_rules: [],
    reasons: [],
    original_class: null,
  };

  for (const rule of CROSS_VALIDATION_RULES) {
    const outcome = rule.apply(limb);
    if (!outcome) continue;

    // Record the original class on first override
    if (result.original_class === null) {
      result.original_class = limb.overall_damping_class;
    }

    limb.overall_damping_class = outcome.override_class;
    result.applied_rules.push(rule.id);
    result.reasons.push(outcome.reason);
  }

  return result;
}


// ============================================================
// Helper Functions
// ============================================================

/**
 * Determine if newResult is a better damping measurement than existing.
 * Prefers: sufficient_data > not, lower tremor_index, more spectrum peaks.
 */
function betterDampingResult(newResult, existing) {
  if (newResult.sufficient_data && !existing.sufficient_data) return true;
  if (!newResult.sufficient_data) return false;
  // Prefer the result with a non-null damping factor
  if (newResult.damping_factor !== null && existing.damping_factor === null) return true;
  // Prefer higher variance (more movement = better signal)
  return newResult.variance > existing.variance;
}

/**
 * Remove the 'type' field from a result (already tracked by the slot it's in).
 */
function stripType(result) {
  const { type, ...rest } = result;
  return rest;
}

/**
 * Merge compensation patterns from a new result into an existing one.
 * Keeps unique patterns and updates weight distribution.
 */
function mergeCompensation(existing, newResult) {
  if (!newResult.patterns) return;

  // Add any new pattern types not already detected
  const existingTypes = new Set(existing.patterns.map(p => p.type));
  for (const pattern of newResult.patterns) {
    if (!existingTypes.has(pattern.type)) {
      existing.patterns.push(pattern);
    }
  }

  // Average the weight distributions
  if (newResult.weight_distribution && existing.weight_distribution) {
    existing.weight_distribution.left_ratio = round4(
      (existing.weight_distribution.left_ratio + newResult.weight_distribution.left_ratio) / 2
    );
    existing.weight_distribution.right_ratio = round4(
      1 - existing.weight_distribution.left_ratio
    );
    existing.weight_distribution.is_symmetric =
      Math.abs(existing.weight_distribution.left_ratio - 0.5) < 0.1;
  }
}

/**
 * Find left/right limb pairs in a target list.
 * Returns array of [limbA, limbB] pairs.
 */
function findLimbPairs(targetLimbs) {
  const pairs = [];
  const seen = new Set();
  for (const limb of targetLimbs) {
    if (seen.has(limb)) continue;
    const opp = OPPOSITE_LIMB[limb];
    if (opp && targetLimbs.includes(opp) && !seen.has(opp)) {
      pairs.push([limb, opp]);
      seen.add(limb);
      seen.add(opp);
    }
  }
  return pairs;
}

/**
 * Find a specific pair if both exist in targetLimbs.
 */
function findSpecificPair(targetLimbs, a, b) {
  if (targetLimbs.includes(a) && targetLimbs.includes(b)) {
    return [a, b];
  }
  return null;
}

/**
 * Compute range (max - min) of an array.
 */
function rangeOf(arr) {
  if (arr.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of arr) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

/**
 * Compute arithmetic mean.
 */
function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Round to 4 decimal places.
 */
function round4(v) {
  return Math.round(v * 10000) / 10000;
}


// ---- Empty result factories ----

function createInsufficientDataResult(targetLimbs) {
  const results = {};
  for (const limb of targetLimbs) {
    results[limb] = {
      type: 'insufficient_data',
      sufficient_data: false,
    };
  }
  return results;
}

function createEmptyCompensationResult(targetLimbs) {
  const results = {};
  for (const limb of targetLimbs) {
    results[limb] = {
      type: 'compensation',
      patterns: [],
      weight_distribution: { left_ratio: 0.5, right_ratio: 0.5, is_symmetric: true },
      sufficient_data: false,
    };
  }
  return results;
}

function createEmptyRhythmResult(targetLimbs) {
  const results = {};
  for (const limb of targetLimbs) {
    results[limb] = {
      type: 'rhythm',
      step_frequency_hz: 0,
      tremor_index: 0,
      variance: 0,
      sufficient_data: false,
    };
  }
  return results;
}

function createEmptyLimbAssessments() {
  const limbs = {};
  for (const limbKey of Object.keys(LIMB_PRIMARY_LANDMARKS)) {
    limbs[limbKey] = {
      damping: null,
      stability: null,
      compensation: null,
      rhythm: null,
      overall_damping_class: 'inconclusive',
      overall_damping_factor: null,
      evidence_sources: [],
    };
  }
  return limbs;
}


// ---- Export constants for testing ----
export {
  MIN_MOVEMENT_FRAMES,
  LIMB_PRIMARY_LANDMARKS,
  LIMB_DISTAL_LANDMARK,
  OPPOSITE_LIMB,
  COMPENSATION_THRESHOLDS,
};

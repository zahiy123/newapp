// ============================================================
// PhaseAAnalyzer — Static Scan Analysis (15 seconds)
//
// PURE LOGIC — receives all data as parameters.
//
// Two parallel channels:
//   Channel 1: Object Detection — identifies mobility aids
//   Channel 2: Landmark Integrity — checks body structure
//
// Output: preliminary hypotheses per limb + routing decision
// ============================================================

import { LM } from './movements.js';


// ---- Constants ----

// What percentage of frames an object must appear in to be "detected"
const OBJECT_PRESENCE_THRESHOLD = 0.80;

// Landmark visibility must be below this to be considered "missing"
const VISIBILITY_MISSING_THRESHOLD = 0.3;

// Proportion asymmetry beyond this triggers "needs_verification"
const PROPORTION_ASYMMETRY_THRESHOLD = 0.25;

// Positional variance above this indicates instability
const VARIANCE_INSTABILITY_THRESHOLD = 0.002;

// Minimum frames needed for reliable analysis
const MIN_FRAMES = 30;


// ---- Landmark groups per limb ----

const LIMB_LANDMARKS = Object.freeze({
  left_leg: [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.LEFT_HEEL, LM.LEFT_FOOT],
  right_leg: [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_HEEL, LM.RIGHT_FOOT],
  left_arm: [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST],
  right_arm: [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
});

// Which limbs are "opposite" (for symmetry comparison)
const OPPOSITE_LIMB = Object.freeze({
  left_leg: 'right_leg',
  right_leg: 'left_leg',
  left_arm: 'right_arm',
  right_arm: 'left_arm',
});

// Object detection labels that map to mobility aids
// These are the labels we expect from COCO/MediaPipe object detection
const MOBILITY_AID_LABELS = Object.freeze({
  crutches: ['crutch', 'crutches', 'walking_stick', 'walking stick', 'cane'],
  wheelchair: ['wheelchair', 'wheel chair', 'mobility scooter'],
  prosthetic: ['prosthetic', 'artificial limb', 'prosthesis'],
  brace: ['brace', 'splint', 'orthotic', 'support'],
});


// ============================================================
// Channel 1: Object Detection Analysis
// ============================================================

/**
 * Analyze object detection results across multiple frames
 * to identify mobility aids.
 *
 * @param {ObjectFrame[]} objectFrames - Array of per-frame detection results
 *   Each frame: { objects: [{ label: string, confidence: number, bbox: {x,y,w,h} }] }
 * @returns {AidDetection}
 *
 * @typedef {Object} AidDetection
 * @property {Object} crutches - { detected, confidence, side }
 * @property {Object} wheelchair - { detected, confidence, type }
 * @property {Object} prosthetic - { detected, confidence, location }
 * @property {Object} brace - { detected, confidence, location }
 */
export function analyzeObjectDetections(objectFrames) {
  if (!objectFrames || objectFrames.length === 0) {
    return emptyAidDetection();
  }

  const totalFrames = objectFrames.length;
  const counts = {
    crutches: 0,
    wheelchair: 0,
    prosthetic: 0,
    brace: 0,
  };

  // Count frames where each aid type was detected
  for (const frame of objectFrames) {
    if (!frame.objects) continue;
    for (const obj of frame.objects) {
      const label = (obj.label || '').toLowerCase().trim();
      for (const [aidType, labels] of Object.entries(MOBILITY_AID_LABELS)) {
        if (labels.some(l => label.includes(l))) {
          counts[aidType]++;
          break;
        }
      }
    }
  }

  // Only mark as "detected" if present in ≥80% of frames
  const result = {
    crutches: {
      detected: (counts.crutches / totalFrames) >= OBJECT_PRESENCE_THRESHOLD,
      frame_ratio: Math.round((counts.crutches / totalFrames) * 100) / 100,
    },
    wheelchair: {
      detected: (counts.wheelchair / totalFrames) >= OBJECT_PRESENCE_THRESHOLD,
      frame_ratio: Math.round((counts.wheelchair / totalFrames) * 100) / 100,
    },
    prosthetic: {
      detected: (counts.prosthetic / totalFrames) >= OBJECT_PRESENCE_THRESHOLD,
      frame_ratio: Math.round((counts.prosthetic / totalFrames) * 100) / 100,
    },
    brace: {
      detected: (counts.brace / totalFrames) >= OBJECT_PRESENCE_THRESHOLD,
      frame_ratio: Math.round((counts.brace / totalFrames) * 100) / 100,
    },
  };

  return result;
}

function emptyAidDetection() {
  return {
    crutches:   { detected: false, frame_ratio: 0 },
    wheelchair: { detected: false, frame_ratio: 0 },
    prosthetic: { detected: false, frame_ratio: 0 },
    brace:      { detected: false, frame_ratio: 0 },
  };
}


// ============================================================
// Channel 2: Landmark Integrity Analysis
// ============================================================

/**
 * Analyze landmark data across multiple frames to assess
 * structural integrity of each limb.
 *
 * @param {LandmarkFrame[]} landmarkFrames - Array of per-frame landmark data
 *   Each frame: landmarks[33] where each landmark has { x, y, z, visibility }
 * @returns {Object.<string, LimbIntegrity>} - Per-limb analysis
 *
 * @typedef {Object} LimbIntegrity
 * @property {boolean} landmarks_present - Are all landmarks consistently visible?
 * @property {number} avg_visibility - Mean visibility score (0-1)
 * @property {number} proportion_ratio - Ratio vs opposite limb (1.0 = symmetric)
 * @property {number} positional_variance - How much the landmarks move (instability)
 * @property {string} preliminary_status - Initial hypothesis
 * @property {string} certainty - 'high' or 'needs_verification'
 */
export function analyzeLandmarkIntegrity(landmarkFrames) {
  if (!landmarkFrames || landmarkFrames.length < MIN_FRAMES) {
    return createEmptyIntegrityResult('insufficient_frames');
  }

  const result = {};

  // Analyze each limb
  for (const [limbKey, landmarkIndices] of Object.entries(LIMB_LANDMARKS)) {
    result[limbKey] = analyzeSingleLimb(limbKey, landmarkIndices, landmarkFrames);
  }

  // Cross-limb analysis: compute proportion ratios
  for (const [limbKey, oppKey] of Object.entries(OPPOSITE_LIMB)) {
    result[limbKey].proportion_ratio = computeProportionRatio(
      limbKey, oppKey, landmarkFrames
    );
  }

  return result;
}

/**
 * Analyze a single limb's landmarks across all frames
 */
function analyzeSingleLimb(limbKey, landmarkIndices, frames) {
  // Collect visibility scores per landmark across all frames
  const visibilityPerLandmark = landmarkIndices.map(() => []);
  const positionsY = landmarkIndices.map(() => []);
  const positionsX = landmarkIndices.map(() => []);

  for (const frame of frames) {
    if (!frame || !frame.length) continue;
    for (let i = 0; i < landmarkIndices.length; i++) {
      const lmIdx = landmarkIndices[i];
      const lm = frame[lmIdx];
      if (lm) {
        visibilityPerLandmark[i].push(lm.visibility ?? 0);
        positionsY[i].push(lm.y ?? 0);
        positionsX[i].push(lm.x ?? 0);
      }
    }
  }

  // Average visibility across all landmarks in this limb
  const avgVisibilities = visibilityPerLandmark.map(arr => {
    if (arr.length === 0) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  });
  const overallAvgVisibility = avgVisibilities.length > 0
    ? avgVisibilities.reduce((s, v) => s + v, 0) / avgVisibilities.length
    : 0;

  // Are landmarks consistently present?
  const landmarksPresent = overallAvgVisibility >= VISIBILITY_MISSING_THRESHOLD;

  // Positional variance (how much the limb moves while standing still)
  const variances = positionsY.map(arr => {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  });
  const avgVariance = variances.length > 0
    ? variances.reduce((s, v) => s + v, 0) / variances.length
    : 0;

  // Preliminary status
  let status;
  let certainty;

  if (!landmarksPresent) {
    // Landmarks consistently missing → likely absent limb
    status = 'likely_absent';
    certainty = 'high';
  } else if (avgVariance > VARIANCE_INSTABILITY_THRESHOLD) {
    // High positional variance while standing → unstable/weak OR prosthetic
    status = 'needs_investigation';
    certainty = 'needs_verification';
  } else {
    // Present and stable → likely healthy
    status = 'likely_healthy';
    certainty = 'high';
  }

  return {
    landmarks_present: landmarksPresent,
    avg_visibility: Math.round(overallAvgVisibility * 1000) / 1000,
    proportion_ratio: 1.0,    // will be updated in cross-limb analysis
    positional_variance: Math.round(avgVariance * 100000) / 100000,
    preliminary_status: status,
    certainty,
  };
}


/**
 * Compute proportion ratio between a limb and its opposite.
 * Measures the average distance between connected landmarks
 * and compares left vs right.
 *
 * Returns ratio: 1.0 = identical proportions
 *                <1.0 = this limb is shorter
 *                >1.0 = this limb is longer
 */
function computeProportionRatio(limbKey, oppKey, frames) {
  const limbIndices = LIMB_LANDMARKS[limbKey];
  const oppIndices = LIMB_LANDMARKS[oppKey];

  // Use only the shared number of landmarks
  const count = Math.min(limbIndices.length, oppIndices.length);
  if (count < 2) return 1.0;

  let limbTotalDist = 0;
  let oppTotalDist = 0;
  let validFrames = 0;

  for (const frame of frames) {
    if (!frame || !frame.length) continue;

    let limbDist = 0;
    let oppDist = 0;
    let segmentValid = true;

    // Sum distances between consecutive landmarks
    for (let i = 0; i < count - 1; i++) {
      const la = frame[limbIndices[i]];
      const lb = frame[limbIndices[i + 1]];
      const oa = frame[oppIndices[i]];
      const ob = frame[oppIndices[i + 1]];

      if (!la || !lb || !oa || !ob) { segmentValid = false; break; }
      if ((la.visibility ?? 0) < 0.3 || (lb.visibility ?? 0) < 0.3 ||
          (oa.visibility ?? 0) < 0.3 || (ob.visibility ?? 0) < 0.3) {
        segmentValid = false; break;
      }

      limbDist += Math.sqrt((lb.x - la.x) ** 2 + (lb.y - la.y) ** 2);
      oppDist += Math.sqrt((ob.x - oa.x) ** 2 + (ob.y - oa.y) ** 2);
    }

    if (segmentValid && oppDist > 0) {
      limbTotalDist += limbDist;
      oppTotalDist += oppDist;
      validFrames++;
    }
  }

  if (validFrames === 0 || oppTotalDist === 0) return 1.0;

  const avgLimb = limbTotalDist / validFrames;
  const avgOpp = oppTotalDist / validFrames;

  return Math.round((avgLimb / avgOpp) * 1000) / 1000;
}

function createEmptyIntegrityResult(reason) {
  const empty = {
    landmarks_present: false,
    avg_visibility: 0,
    proportion_ratio: 1.0,
    positional_variance: 0,
    preliminary_status: reason,
    certainty: 'needs_verification',
  };
  return {
    left_leg: { ...empty },
    right_leg: { ...empty },
    left_arm: { ...empty },
    right_arm: { ...empty },
  };
}


// ============================================================
// Routing Decision — combines both channels
// ============================================================

/**
 * Determine which Phase B track to use based on Phase A results.
 *
 * @param {AidDetection} aidDetection - From analyzeObjectDetections()
 * @param {Object.<string, LimbIntegrity>} landmarkIntegrity - From analyzeLandmarkIntegrity()
 * @returns {RoutingDecision}
 *
 * @typedef {Object} RoutingDecision
 * @property {string} track - 'missing_limb' | 'deep_analysis' | 'full_body'
 * @property {boolean} is_wheelchair - Wheelchair detected
 * @property {Object.<string, string>} hypotheses - Per-limb preliminary status
 * @property {string[]} verification_needed - Limbs that need Phase B verification
 * @property {string} reasoning - Human-readable explanation of the decision
 */
export function determineTrack(aidDetection, landmarkIntegrity) {
  const hypotheses = {};
  const verificationNeeded = [];
  const reasons = [];

  const isWheelchair = aidDetection.wheelchair.detected;
  const hasCrutches = aidDetection.crutches.detected;

  // Evaluate each limb
  for (const limbKey of Object.keys(LIMB_LANDMARKS)) {
    const integrity = landmarkIntegrity[limbKey];

    if (!integrity.landmarks_present) {
      // Landmarks missing → limb is absent
      hypotheses[limbKey] = 'absent';
      reasons.push(`${limbKey}: landmarks consistently absent`);
    } else if (integrity.certainty === 'needs_verification') {
      // Something suspicious but not conclusive
      hypotheses[limbKey] = 'needs_investigation';
      verificationNeeded.push(limbKey);
      reasons.push(`${limbKey}: variance=${integrity.positional_variance}, needs damping analysis`);
    } else if (integrity.proportion_ratio < (1 - PROPORTION_ASYMMETRY_THRESHOLD)) {
      // Significantly shorter than opposite side
      hypotheses[limbKey] = 'possibly_prosthetic';
      verificationNeeded.push(limbKey);
      reasons.push(`${limbKey}: proportion ratio ${integrity.proportion_ratio} vs opposite`);
    } else {
      hypotheses[limbKey] = 'likely_healthy';
    }
  }

  // If wheelchair detected, mark legs accordingly
  if (isWheelchair) {
    hypotheses.left_leg = 'wheelchair_user';
    hypotheses.right_leg = 'wheelchair_user';
    reasons.push('Wheelchair detected — leg assessment adapted');
  }

  // Cross-reference: crutches detected but no limb flagged?
  if (hasCrutches && !Object.values(hypotheses).some(h =>
    h === 'absent' || h === 'needs_investigation' || h === 'possibly_prosthetic'
  )) {
    // Crutches visible but all limbs look present — need deeper look
    verificationNeeded.push('left_leg', 'right_leg');
    reasons.push('Crutches detected but all limbs appear present — need damping verification');
  }

  // Determine track
  let track;
  if (isWheelchair) {
    track = 'missing_limb';
  } else if (Object.values(hypotheses).some(h => h === 'absent')) {
    track = 'missing_limb';
  } else if (verificationNeeded.length > 0) {
    track = 'deep_analysis';
  } else {
    track = 'full_body';
  }

  return {
    track,
    is_wheelchair: isWheelchair,
    hypotheses,
    verification_needed: [...new Set(verificationNeeded)],
    reasoning: reasons.join('; ') || 'All limbs present and stable — standard assessment',
  };
}


// ---- Export constants for testing ----
export {
  OBJECT_PRESENCE_THRESHOLD,
  VISIBILITY_MISSING_THRESHOLD,
  PROPORTION_ASYMMETRY_THRESHOLD,
  VARIANCE_INSTABILITY_THRESHOLD,
  MIN_FRAMES,
  LIMB_LANDMARKS,
};

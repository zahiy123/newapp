// ============================================================
// ArmAssessment — Per-Arm (Right / Left) Measurement
//
// PURE LOGIC — no React, no DOM, no side effects.
//
// Measures each upper limb SEPARATELY during the motion
// calibration movements of the onboarding scan:
//   - shoulder flexion   (raise forward + overhead)
//   - shoulder abduction (raise to the side)
//   - elbow flexion/extension
//
// Landmark convention: same as the motion calibration in
// ScanSequencer — frames are already mirror-corrected, so
// MediaPipe RIGHT_* = the person's right arm (verified by the
// raise_right_hand / raise_left_hand calibration steps).
//
// All angles are 2D estimates from a frontal camera view.
// ============================================================

import { computeAngle, computeStats } from '../KineticAnalyzer.js';


// ---- Landmarks per side ----

export const ARM_LANDMARKS = Object.freeze({
  right: Object.freeze({ shoulder: 12, elbow: 14, wrist: 16, hip: 24 }),
  left:  Object.freeze({ shoulder: 11, elbow: 13, wrist: 15, hip: 23 }),
});

export const ARM_TESTS = Object.freeze({
  FLEXION:   'flexion',    // shoulder: raise forward and overhead
  ABDUCTION: 'abduction',  // shoulder: raise to the side
  ELBOW:     'elbow',      // elbow: bend and straighten
});


// ---- Thresholds ----

// Angle variance (deg²) that counts as real movement — same bar as the diagnostic segments
export const ARM_MOVEMENT_VARIANCE = 12.0;
// Landmark visibility required for a frame to be measured
const ARM_VISIBILITY_MIN = 0.5;
// Below this average visibility the arm is treated as not visible (absent / out of frame)
const ARM_PRESENT_VISIBILITY = 0.3;
// Minimum measurable frames for a result
const MIN_VALID_FRAMES = 10;
// Compensation flags (ratios relative to torso length)
const TRUNK_LEAN_RATIO = 0.15;
const SHOULDER_ELEVATION_RATIO = 0.10;


// ============================================================
// Helpers
// ============================================================

function isVisible(lm) {
  return !!lm && (lm.visibility === undefined || lm.visibility >= ARM_VISIBILITY_MIN);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Angle series used by a test: shoulder angle (hip-shoulder-elbow) or elbow angle (shoulder-elbow-wrist). */
function angleSeries(frames, side, test) {
  const lm = ARM_LANDMARKS[side];
  const angles = [];
  const validFrames = [];
  for (const frame of frames) {
    if (!frame) continue;
    const shoulder = frame[lm.shoulder];
    const elbow = frame[lm.elbow];
    const wrist = frame[lm.wrist];
    const hip = frame[lm.hip];
    if (test === ARM_TESTS.ELBOW) {
      if (!isVisible(shoulder) || !isVisible(elbow) || !isVisible(wrist)) continue;
      angles.push(computeAngle(shoulder, elbow, wrist));
    } else {
      if (!isVisible(hip) || !isVisible(shoulder) || !isVisible(elbow)) continue;
      angles.push(computeAngle(hip, shoulder, elbow));
    }
    validFrames.push(frame);
  }
  return { angles, validFrames };
}


// ============================================================
// Public API
// ============================================================

/**
 * True if the arm on this side is visible enough to be instructed and measured.
 * Iron Rule support: an arm that is not visible (absent / out of frame) is skipped.
 */
export function isArmPresent(frames, side) {
  const lm = ARM_LANDMARKS[side];
  if (!frames || frames.length === 0) return true; // no evidence — assume present
  let sum = 0;
  let count = 0;
  for (const frame of frames) {
    if (!frame) continue;
    const e = frame[lm.elbow];
    const w = frame[lm.wrist];
    sum += ((e?.visibility ?? 1) + (w?.visibility ?? 1)) / 2;
    count++;
  }
  if (count === 0) return true;
  return sum / count >= ARM_PRESENT_VISIBILITY;
}

/**
 * True if the tested joint of this arm moved enough to count as real movement.
 */
export function detectArmMovement(frames, side, test) {
  const { angles } = angleSeries(frames, side, test);
  if (angles.length < MIN_VALID_FRAMES) return false;
  return computeStats(angles).variance >= ARM_MOVEMENT_VARIANCE;
}

/**
 * Measure one arm test from the collected frames.
 *
 * @param {Object[][]} frames - mirror-corrected landmark frames of this movement
 * @param {'right'|'left'} side
 * @param {'flexion'|'abduction'|'elbow'} test
 * @returns {Object} measurement
 */
export function analyzeArmMovement(frames, side, test) {
  const { angles, validFrames } = angleSeries(frames, side, test);
  const total = frames?.length || 0;
  const base = {
    side,
    test,
    framesTotal: total,
    framesAnalyzed: angles.length,
    visibilityRatio: total > 0 ? round1((angles.length / total) * 100) / 100 : 0,
  };

  if (angles.length < MIN_VALID_FRAMES) {
    return { ...base, status: 'insufficient_data', moved: false };
  }

  const moved = computeStats(angles).variance >= ARM_MOVEMENT_VARIANCE;
  const sorted = [...angles].sort((a, b) => a - b);

  // Smoothness: mean absolute second difference of the angle (deg/frame²) — lower is smoother
  let jitterSum = 0;
  for (let i = 1; i < angles.length - 1; i++) {
    jitterSum += Math.abs(angles[i + 1] - 2 * angles[i] + angles[i - 1]);
  }
  const jitterDeg = angles.length > 2 ? round1(jitterSum / (angles.length - 2)) : 0;

  const result = {
    ...base,
    status: moved ? 'assessed' : 'no_movement',
    moved,
    jitterDeg,
  };

  if (test === ARM_TESTS.ELBOW) {
    result.elbowMinDeg = round1(percentile(sorted, 5));   // most flexed
    result.elbowMaxDeg = round1(percentile(sorted, 95));  // most extended
    result.rangeDeg = round1(result.elbowMaxDeg - result.elbowMinDeg);
    return result;
  }

  result.restDeg = round1(percentile(sorted, 5));
  result.peakDeg = round1(percentile(sorted, 95));
  result.rangeDeg = round1(result.peakDeg - result.restDeg);
  result.compensation = measureCompensation(validFrames, side);
  return result;
}

/**
 * Trunk lean and shoulder hiking while one arm is raised, relative to torso length.
 * @private
 */
function measureCompensation(frames, side) {
  const lm = ARM_LANDMARKS[side];
  const usable = frames.filter(f =>
    isVisible(f[11]) && isVisible(f[12]) && isVisible(f[23]) && isVisible(f[24]));
  if (usable.length < MIN_VALID_FRAMES) {
    return { trunkLeanRatio: null, shoulderElevationRatio: null, trunkLean: false, shoulderElevation: false };
  }

  const first = usable[0];
  const shMid0 = midpoint(first[11], first[12]);
  const hipMid0 = midpoint(first[23], first[24]);
  const torso = Math.hypot(shMid0.x - hipMid0.x, shMid0.y - hipMid0.y) || 1;
  const baseOffset = shMid0.x - hipMid0.x;
  const baseShoulderY = first[lm.shoulder].y;

  let maxLean = 0;
  let maxRise = 0;
  for (const f of usable) {
    const shMid = midpoint(f[11], f[12]);
    const hipMid = midpoint(f[23], f[24]);
    maxLean = Math.max(maxLean, Math.abs((shMid.x - hipMid.x) - baseOffset));
    maxRise = Math.max(maxRise, baseShoulderY - f[lm.shoulder].y);
  }

  const trunkLeanRatio = Math.round((maxLean / torso) * 100) / 100;
  const shoulderElevationRatio = Math.round((Math.max(0, maxRise) / torso) * 100) / 100;
  return {
    trunkLeanRatio,
    shoulderElevationRatio,
    trunkLean: trunkLeanRatio >= TRUNK_LEAN_RATIO,
    shoulderElevation: shoulderElevationRatio >= SHOULDER_ELEVATION_RATIO,
  };
}

/**
 * Combine the raw per-test measurements into one summary per arm.
 *
 * @param {{ right: Object, left: Object }} raw - raw[side][test] = analyzeArmMovement() result
 *   or { status: 'not_visible' }
 * @returns {{ method: string, right_arm: Object, left_arm: Object }}
 */
export function summarizeArmAssessment(raw) {
  const summary = { method: '2d_frontal_estimate' };
  for (const side of ['right', 'left']) {
    const tests = raw?.[side] || {};
    const entries = Object.values(tests);
    let status;
    if (entries.length === 0) status = 'not_tested';
    else if (entries.every(t => t.status === 'not_visible')) status = 'not_visible';
    else if (entries.some(t => t.moved)) status = 'assessed';
    else status = 'no_movement';

    const flex = tests[ARM_TESTS.FLEXION];
    const abd = tests[ARM_TESTS.ABDUCTION];
    const elbow = tests[ARM_TESTS.ELBOW];

    const compensations = [];
    for (const t of [flex, abd]) {
      if (t?.compensation?.trunkLean && !compensations.includes('trunk_lean')) compensations.push('trunk_lean');
      if (t?.compensation?.shoulderElevation && !compensations.includes('shoulder_elevation')) compensations.push('shoulder_elevation');
    }

    summary[`${side}_arm`] = {
      status,
      shoulderFlexionDeg: flex?.moved ? flex.peakDeg : null,
      shoulderAbductionDeg: abd?.moved ? abd.peakDeg : null,
      elbowFlexionMinDeg: elbow?.moved ? elbow.elbowMinDeg : null,
      elbowExtensionMaxDeg: elbow?.moved ? elbow.elbowMaxDeg : null,
      elbowRangeDeg: elbow?.moved ? elbow.rangeDeg : null,
      compensations,
      tests,
    };
  }
  return summary;
}

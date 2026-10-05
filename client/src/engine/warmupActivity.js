// ============================================================
// warmupActivity — direct "is the trainee moving?" for the warm-up
//
// PURE LOGIC. Runs on the RAW pose landmarks at ~20 Hz (Training.jsx reads the
// pose ref directly), independent of React state throttling, posture detection,
// smoothing and the per-exercise analyzers. It only watches the body parts the
// current movement uses, with path-based detection (recentMotion): small seated
// movements count, still-camera jitter does not.
// ============================================================

import { recentMotion } from '../utils/exerciseAnalysis.js';

const ARM_POINTS = [15, 16, 13, 14];              // wrists + elbows
const SHOULDER_POINTS = [11, 12];
const LEG_POINTS = [25, 26, 27, 28];              // knees + ankles

/** Landmark indices to watch for a Ghost move. */
export function motionPointsFor(move) {
  switch (move) {
    case 'twist': return SHOULDER_POINTS;
    case 'high_knees': case 'single_knee': case 'kick': case 'side_steps': return LEG_POINTS;
    default: return ARM_POINTS;                      // circles, punches, passes
  }
}

/**
 * @param {Object} state - previous activity state ({} initially)
 * @param {Object[]} landmarks - raw pose landmarks
 * @param {string} move - exercise.ghost.move
 * @returns {{ state: Object, moving: boolean }}
 */
export function detectActivity(state, landmarks, move) {
  if (!landmarks) return { state, moving: false };
  const idx = motionPointsFor(move);
  const opts = move === 'twist'
    ? { window: 20, minPath: 0.025, minSpan: 0.01 }
    : { window: 12, minPath: 0.05, minSpan: 0.025 };
  const r = recentMotion(state, '_trail', idx.map(i => landmarks[i]), opts);
  return { state: { _trail: r.trail }, moving: r.moving };
}

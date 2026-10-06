// ============================================================
// confidence — "silence when unsure" (Stage 3.1, owner-approved coaching principle)
//
// PURE. Decides per frame whether the measurement is trustworthy enough to coach:
//   1. TRACKING — the profile's measured points are confidently detected
//      (mean visibility) and the primary joint does not jump implausibly (jitter).
//   2. VIEW     — the camera view suits the profile's measurements: a side-view profile
//      (sagittal angles: squat depth, hinge, push-up) cannot be judged while the trainee
//      faces the camera, and a front-view profile (arm abduction) not from the side.
// When unsure, the coach does NOT correct — it asks to fix the camera instead.
// ============================================================

import { P, torsoLength } from './kinematics.js';

const FRONT_RATIO = 0.5;      // shoulder width / torso length ≥ this → facing the camera
const SIDE_RATIO = 0.28;      // ≤ this → side-on
export const MIN_TRACKING = 0.65;   // mean visibility of the measured points
const MAX_JUMP_DEG = 45;      // primary-joint change between two 50 ms samples (≈ 900°/s) = a tracking glitch

/** Detected camera view: 'front' | 'side' | 'oblique' | null (no shoulders / torso). */
export function detectView(landmarks) {
  const l = landmarks?.[P.LEFT_SHOULDER], r = landmarks?.[P.RIGHT_SHOULDER];
  const t = torsoLength(landmarks);
  if (!l || !r || !t) return null;
  const ratio = Math.abs(l.x - r.x) / t;
  if (ratio >= FRONT_RATIO) return 'front';
  if (ratio <= SIDE_RATIO) return 'side';
  return 'oblique';
}

/** Does the detected view suit the profile? (oblique is accepted for both) */
export function viewSuits(profileView, view) {
  if (!view || !profileView) return true;
  if (profileView === 'side') return view !== 'front';
  if (profileView === 'front') return view !== 'side';
  return true;
}

const SIDE_POINTS = {
  knee: [[23, 25, 27], [24, 26, 28]], hip: [[11, 23, 25], [12, 24, 26]], elbow: [[11, 13, 15], [12, 14, 16]],
  shoulder: [[13, 11, 23], [14, 12, 24]], bodyLine: [[11, 23, 27], [12, 24, 28]], trunkLean: [[11, 23], [12, 24]],
  pelvisDrop: [[23], [24]],
};

/** Mean visibility of the best side of every metric the profile measures (0..1). */
export function trackingScore(profile, landmarks) {
  if (!landmarks) return 0;
  const metrics = new Set([...Object.keys(profile?.joints || {}), ...(profile?.rules || []).map(r => r.metric)]);
  const scores = [];
  for (const m of metrics) {
    const sides = SIDE_POINTS[m];
    if (!sides) continue;
    const best = Math.max(...sides.map(pts => pts.reduce((s, i) => s + (landmarks[i]?.visibility ?? 0), 0) / pts.length));
    scores.push(best);
  }
  return scores.length ? Math.min(...scores) : 1;
}

/**
 * Per-frame confidence with hysteresis (~0.5 s to lose it, ~0.25 s to regain it).
 * @param {Object} state - mutable { ok, okStreak, badStreak, lastPrimary }
 * @returns {{ confident: boolean, reason: null|'view'|'tracking', view: string|null }}
 */
export function updateConfidence(state, profile, landmarks, primaryValue) {
  const view = detectView(landmarks);
  const tracking = trackingScore(profile, landmarks);
  const jump = typeof primaryValue === 'number' && typeof state.lastPrimary === 'number'
    && Math.abs(primaryValue - state.lastPrimary) > MAX_JUMP_DEG;
  state.lastPrimary = primaryValue;
  let reason = null;
  if (!viewSuits(profile?.cameraView, view)) reason = 'view';
  else if (tracking < MIN_TRACKING || jump) reason = 'tracking';

  if (reason) { state.badStreak = (state.badStreak || 0) + 1; state.okStreak = 0; }
  else { state.okStreak = (state.okStreak || 0) + 1; state.badStreak = 0; }
  if (state.ok === undefined) state.ok = !reason;
  if (state.ok && state.badStreak >= 10) state.ok = false;
  if (!state.ok && state.okStreak >= 5) state.ok = true;
  if (state.ok) state.reason = null;
  else if (reason) state.reason = reason;
  return { confident: state.ok, reason: state.ok ? null : (state.reason || reason), view };
}

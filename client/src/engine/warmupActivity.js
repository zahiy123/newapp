// ============================================================
// warmupActivity — direct "is the trainee moving?" for the warm-up
//
// PURE LOGIC. Runs on the RAW pose landmarks at ~20 Hz (Training.jsx reads the
// pose ref directly), independent of React state throttling, posture detection,
// smoothing and the per-exercise analyzers. It only watches the body parts the
// current movement uses, with path-based detection (recentMotion): small seated
// movements count, still-camera jitter does not.
//
// Two gates for an honest timer:
//   1. REQUIRED LIMBS IN VIEW — the body parts the movement needs (arms / shoulders /
//      the working leg) must be visible AND inside the frame; otherwise nothing counts
//      and the UI asks the trainee to step into the frame.
//   2. FAST START — a short burst (~200 ms) of real movement already counts, so the
//      timer reacts within a fraction of a second.
// ============================================================

import { recentMotion } from '../utils/exerciseAnalysis.js';

const ARM_POINTS = [15, 16, 13, 14];              // wrists + elbows
const SHOULDER_POINTS = [11, 12];
const LEG_POINTS = [25, 26, 27, 28];              // knees + ankles
const LEG_MOVES = new Set(['high_knees', 'single_knee', 'kick', 'side_steps']);

// Visibility hysteresis (samples at 20 Hz)
const VISIBLE_ON_SAMPLES = 3;     // ~150 ms in view → visible
const VISIBLE_OFF_SAMPLES = 10;   // ~500 ms out of view → not visible
const MIN_VISIBILITY = 0.5;
const FRAME_MARGIN = 0.02;

/** Landmark indices to watch for a Ghost move. */
export function motionPointsFor(move) {
  switch (move) {
    case 'twist': return SHOULDER_POINTS;
    case 'high_knees': case 'single_knee': case 'kick': case 'side_steps': return LEG_POINTS;
    default: return ARM_POINTS;                      // circles, punches, passes
  }
}

/**
 * Which body part the movement needs and the landmark indices that must be in view.
 * Legs: only the WORKING leg(s) (a prosthetic / absent leg is not required).
 * Arms: only trainable arms (or the single arm of a single-arm move).
 * @returns {{ part: 'legs'|'arms'|'upper', points: number[] }}
 */
export function requiredPointsFor(spec, lp = {}) {
  const move = spec?.move;
  const leg = (side) => (side === 'left' ? [23, 25, 27] : [24, 26, 28]);     // hip, knee, ankle
  const arm = (side) => (side === 'left' ? [11, 13, 15] : [12, 14, 16]);     // shoulder, elbow, wrist
  if (LEG_MOVES.has(move)) {
    const sides = spec.side
      ? [spec.side]
      : ['left', 'right'].filter(s => !['absent', 'prosthetic'].includes(lp[`${s}_leg`]?.state));
    return { part: 'legs', points: (sides.length ? sides : ['left', 'right']).flatMap(leg) };
  }
  if (move === 'twist') return { part: 'upper', points: SHOULDER_POINTS };
  const sides = move === 'single_arm_circle'
    ? [spec.side || 'right']
    : ['left', 'right'].filter(s => lp[`${s}_arm`]?.trainable !== false);
  return { part: 'arms', points: (sides.length ? sides : ['left', 'right']).flatMap(arm) };
}

/** True if every required landmark is confidently detected AND inside the camera frame. */
export function pointsInView(landmarks, points) {
  if (!landmarks) return false;
  return points.every((i) => {
    const p = landmarks[i];
    return p && (p.visibility ?? 1) >= MIN_VISIBILITY &&
      p.x >= -FRAME_MARGIN && p.x <= 1 + FRAME_MARGIN && p.y >= -FRAME_MARGIN && p.y <= 1 + FRAME_MARGIN;
  });
}

/**
 * @param {Object} state - previous activity state ({} initially)
 * @param {Object[]} landmarks - raw pose landmarks
 * @param {Object|string} spec - exercise.ghost (or just the move name)
 * @param {Object} [lp] - limbProfile
 * @returns {{ state: Object, moving: boolean, inView: boolean, part: 'legs'|'arms'|'upper' }}
 */
export function detectActivity(state, landmarks, spec, lp = {}) {
  const sp = typeof spec === 'string' ? { move: spec } : (spec || {});
  const req = requiredPointsFor(sp, lp);
  const prev = state || {};

  // 1. Required limbs in view (with hysteresis so it does not flicker)
  const seen = pointsInView(landmarks, req.points);
  let inStreak = seen ? (prev._inStreak || 0) + 1 : 0;
  let outStreak = seen ? 0 : (prev._outStreak || 0) + 1;
  let inView = !!prev._inView;
  if (!inView && inStreak >= VISIBLE_ON_SAMPLES) inView = true;
  if (inView && outStreak >= VISIBLE_OFF_SAMPLES) inView = false;

  // 2. Movement of the watched body parts (fast-start burst + rolling window)
  let moving = false;
  let trail = prev._trail;
  if (landmarks) {
    const idx = motionPointsFor(sp.move);
    const opts = sp.move === 'twist'
      ? { window: 20, minPath: 0.025, minSpan: 0.01, burst: { window: 4, minPath: 0.02, minSpan: 0.012 } }
      : { window: 12, minPath: 0.05, minSpan: 0.025, burst: { window: 4, minPath: 0.03, minSpan: 0.02 } };
    const r = recentMotion(prev, '_trail', idx.map(i => landmarks[i]), opts);
    trail = r.trail;
    moving = r.moving;
  }

  return {
    state: { _trail: trail, _inStreak: inStreak, _outStreak: outStreak, _inView: inView },
    moving: moving && inView,          // movement only counts when the required limbs are in view
    inView,
    part: req.part,
  };
}

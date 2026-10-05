// ============================================================
// rangeProgression — Progressive Range Challenge (Ghost overlay, warm-up)
//
// PURE LOGIC — no React, no DOM.
//
// The Ghost demonstrates the movement at a TARGET range. The target starts at the
// range measured in the scan (or a comfortable default), and:
//   - grows by RANGE_STEP_DEG after HITS_TO_EXPAND consecutive reps that reach it,
//   - eases back one step after MISSES_TO_EASE consecutive reps far below it,
//   - never exceeds the scanned range + RANGE_MAX_ABOVE_SCAN_DEG in a session,
//     nor RANGE_ABSOLUTE_MAX_DEG, and never goes below the starting range.
// Reps are detected from the trainee's real shoulder angle (peak per movement cycle).
// ============================================================

import { computeAngle } from './KineticAnalyzer.js';

export const RANGE_STEP_DEG = 5;
export const RANGE_MAX_ABOVE_SCAN_DEG = 20;
export const RANGE_ABSOLUTE_MAX_DEG = 170;
export const RANGE_DEFAULT_START_DEG = 110;   // no scan measurement → a comfortable start (circles just above the shoulder)
const RANGE_UNMEASURED_CEILING_DEG = 150;      // base for the max when the scan has no value
const HITS_TO_EXPAND = 3;
const HIT_RATIO = 0.95;
const MISS_RATIO = 0.7;
const MISSES_TO_EASE = 3;

/** Moves the range challenge applies to (shoulder range demonstrated by the Ghost). */
export const CHALLENGE_MOVES = new Set(['arm_circles', 'single_arm_circle']);

export function createRangeChallenge({ scanCapDeg = null } = {}) {
  const measured = typeof scanCapDeg === 'number' && scanCapDeg > 0;
  const start = measured ? Math.round(scanCapDeg) : RANGE_DEFAULT_START_DEG;
  const max = Math.min(RANGE_ABSOLUTE_MAX_DEG, (measured ? start : RANGE_UNMEASURED_CEILING_DEG) + RANGE_MAX_ABOVE_SCAN_DEG);
  return { start, max: Math.max(start, max), target: start, hits: 0, misses: 0, reps: [] };
}

/**
 * Feed one completed rep's peak shoulder angle.
 * @returns {{ state: Object, event: 'expanded'|'eased'|null }}
 */
export function updateRangeChallenge(state, repPeakDeg) {
  const s = { ...state, reps: [...state.reps, Math.round(repPeakDeg)].slice(-20) };
  let event = null;
  if (repPeakDeg >= s.target * HIT_RATIO) {
    s.hits += 1;
    s.misses = 0;
    if (s.hits >= HITS_TO_EXPAND && s.target < s.max) {
      s.target = Math.min(s.max, s.target + RANGE_STEP_DEG);
      s.hits = 0;
      event = 'expanded';
    }
  } else if (repPeakDeg < s.target * MISS_RATIO) {
    s.misses += 1;
    s.hits = 0;
    if (s.misses >= MISSES_TO_EASE && s.target > s.start) {
      s.target = Math.max(s.start, s.target - RANGE_STEP_DEG);
      s.misses = 0;
      event = 'eased';
    }
  }
  return { state: s, event };
}

// ---- Rep peak detection from a stream of angles ----
// Cycle-based with hysteresis: a rep = the angle rises ≥ PEAK_SWING_DEG from a local low,
// peaks, and falls ≥ PEAK_SWING_DEG. The arm does NOT need to return to rest, so arm
// circles at shoulder height count every cycle. A peak must be above PEAK_MIN_DEG (arm raised).
const PEAK_SWING_DEG = 15;
const PEAK_MIN_DEG = 35;

export function createPeakTracker() {
  return { phase: 'idle', min: null, max: null };
}

/** @returns {{ tracker: Object, peak: number|null }} - peak is set when a rep completes */
export function trackPeak(tracker, angleDeg) {
  if (typeof angleDeg !== 'number' || Number.isNaN(angleDeg)) return { tracker, peak: null };
  const t = { ...tracker };
  if (t.phase === 'idle') {
    t.min = t.min === null ? angleDeg : Math.min(t.min, angleDeg);
    if (angleDeg > t.min + PEAK_SWING_DEG) { t.phase = 'rising'; t.max = angleDeg; }
    return { tracker: t, peak: null };
  }
  if (t.phase === 'rising') {
    if (angleDeg > t.max) { t.max = angleDeg; return { tracker: t, peak: null }; }
    if (angleDeg < t.max - PEAK_SWING_DEG) {
      const peak = t.max > PEAK_MIN_DEG ? t.max : null;
      return { tracker: { phase: 'falling', min: angleDeg, max: null }, peak };
    }
    return { tracker: t, peak: null };
  }
  // falling
  if (angleDeg < t.min) t.min = angleDeg;
  else if (angleDeg > t.min + PEAK_SWING_DEG) { t.phase = 'rising'; t.max = angleDeg; }
  return { tracker: t, peak: null };
}

/**
 * Shoulder angle (hip-shoulder-elbow, 2D) for 'left' | 'right' | 'both' (average of visible sides).
 * Landmarks are anatomical: MediaPipe LEFT_* = the trainee's left.
 */
export function shoulderAngle(landmarks, side) {
  if (!landmarks) return null;
  const one = (s) => {
    const [hip, sh, el] = s === 'left' ? [23, 11, 13] : [24, 12, 14];
    const a = landmarks[hip], b = landmarks[sh], c = landmarks[el];
    if (!a || !b || !c || (b.visibility ?? 1) < 0.5 || (c.visibility ?? 1) < 0.5) return null;
    return computeAngle(a, b, c);
  };
  if (side === 'left' || side === 'right') return one(side);
  const vals = [one('left'), one('right')].filter(v => v !== null);
  return vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
}

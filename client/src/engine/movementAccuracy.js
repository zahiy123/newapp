// ============================================================
// movementAccuracy — real-time "how close are you to the Ghost?" (warm-up)
//
// PURE LOGIC, light enough for the 20 Hz activity loop.
//
// The Ghost animates on its own clock, so an instant-by-instant position
// comparison would punish a trainee who is simply out of phase. Instead we
// compare the RANGE and its POSITION over a short rolling window:
//   trainee signal range (p5-p95 over ~2.5 s)  vs  Ghost signal range (same
//   percentiles over one Ghost cycle)  →  accuracy = overlap / union (0-100%).
// Too small, too large, or shifted (e.g. circles too low) all lower the score.
//
// Signals per move (same definition for trainee and Ghost):
//   - arm moves → shoulder angle (trunk → upper arm), per trainable arm
//   - twist     → apparent shoulder width, relative to its recent maximum
//   - knee/kick → thigh vertical extent (knee below hip), relative to thigh length
// ============================================================

import { ghostPose } from './warmupGhost.js';
import { shoulderAngle } from './rangeProgression.js';

const WINDOW = 50;            // ~2.5 s at 20 Hz
const MIN_SAMPLES = 20;
const GHOST_SAMPLES = 64;
const P_LO = 0.05;
const P_HI = 0.95;
const MIN_TRAINEE_SPAN = { shoulder: 6, twist: 0.04, knee: 0.08 };   // below → not really moving
const TWIST_MAX_WINDOW = 100; // ~5 s for the shoulder-width reference
const THIGH_PER_TORSO = 0.9 / 1.4;   // Ghost proportions: thigh 0.9, torso 1.4 body units

export const ACCURACY_GOOD = 85;
export const ACCURACY_MID = 60;

/** 'good' (≥85) | 'mid' (60-84) | 'low' (<60) */
export function accuracyLevel(pct) {
  if (pct >= ACCURACY_GOOD) return 'good';
  if (pct >= ACCURACY_MID) return 'mid';
  return 'low';
}

/** Which signal a Ghost move is measured with, and on which sides. */
export function signalFor(spec, lp = {}) {
  const move = spec?.move;
  if (['arm_circles', 'punches', 'chest_pass'].includes(move)) {
    const sides = ['left', 'right'].filter(s => lp[`${s}_arm`]?.trainable !== false);
    return { kind: 'shoulder', sides };
  }
  if (move === 'single_arm_circle') return { kind: 'shoulder', sides: [spec.side || 'right'] };
  if (move === 'twist') return { kind: 'twist', sides: ['both'] };
  if (move === 'single_knee' || (move === 'kick' && spec.side)) return { kind: 'knee', sides: [spec.side] };
  if (move === 'high_knees' || move === 'kick') {
    const sides = ['left', 'right'].filter(s => !['absent', 'prosthetic'].includes(lp[`${s}_leg`]?.state));
    return { kind: 'knee', sides };
  }
  return null;   // side steps etc.: no accuracy
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

function range(values) {
  const s = [...values].sort((a, b) => a - b);
  return { lo: percentile(s, P_LO), hi: percentile(s, P_HI) };
}

/** Overlap / union of two ranges, 0..1 */
export function rangeIoU(a, b) {
  const inter = Math.max(0, Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo));
  const union = Math.max(a.hi, b.hi) - Math.min(a.lo, b.lo);
  return union > 1e-9 ? inter / union : 0;
}

// ---- Ghost signal (from the drawn geometry, so it always matches what is shown) ----
function ghostSignal(kind, pose, side) {
  if (kind === 'shoulder') {
    const seg = pose.segments.find(s => s.limb === `${side}_arm` && s.part === 'upperArm');
    if (!seg) return null;
    return Math.atan2(Math.abs(seg.to.x - seg.from.x), seg.to.y - seg.from.y) * 180 / Math.PI;
  }
  if (kind === 'knee') {
    const seg = pose.segments.find(s => s.limb === `${side}_leg` && s.part === 'thigh');
    return seg ? (seg.to.y - seg.from.y) / 0.9 : null;
  }
  if (kind === 'twist') {
    const seg = pose.segments.find(s => s.part === 'shoulders');
    return seg ? Math.abs(seg.to.x - seg.from.x) / 0.84 : null;   // relative to the rest width
  }
  return null;
}

/** Ghost range per side for a spec (sampled over one animation cycle). */
export function ghostRanges(spec, lp, sig) {
  const out = {};
  for (const side of sig.sides) {
    const vals = [];
    for (let i = 0; i < GHOST_SAMPLES; i++) {
      const v = ghostSignal(sig.kind, ghostPose(spec, i / GHOST_SAMPLES, lp), side);
      if (typeof v === 'number') vals.push(v);
    }
    if (vals.length) out[side] = range(vals);
  }
  return out;
}

// ---- Trainee signal (raw anatomical landmarks) ----
function traineeSignal(kind, lm, side, tracker) {
  if (kind === 'shoulder') return shoulderAngle(lm, side);
  const ok = (p) => p && (p.visibility ?? 1) >= 0.5;
  if (kind === 'knee') {
    const [hip, knee] = side === 'left' ? [lm[23], lm[25]] : [lm[24], lm[26]];
    const ls = lm[11], rs = lm[12], lh = lm[23], rh = lm[24];
    if (!ok(hip) || !ok(knee) || !ok(ls) || !ok(rs) || !ok(lh) || !ok(rh)) return null;
    const torso = Math.abs((lh.y + rh.y) / 2 - (ls.y + rs.y) / 2);
    if (torso < 0.03) return null;
    return (knee.y - hip.y) / (torso * THIGH_PER_TORSO);
  }
  if (kind === 'twist') {
    const ls = lm[11], rs = lm[12];
    if (!ok(ls) || !ok(rs)) return null;
    const w = Math.abs(ls.x - rs.x);
    tracker.widths.push(w);
    if (tracker.widths.length > TWIST_MAX_WINDOW) tracker.widths.shift();
    const maxW = Math.max(...tracker.widths);
    return maxW > 0 ? w / maxW : null;
  }
  return null;
}

/**
 * @param {Object} spec - the Ghost spec shown (incl. range-challenge targetDeg)
 * @param {Object} lp - limbProfile
 * @returns {Object|null} tracker, or null if this move has no accuracy measure
 */
export function createAccuracyTracker(spec, lp) {
  const sig = signalFor(spec, lp);
  if (!sig || !sig.sides.length) return null;
  return { sig, ghost: ghostRanges(spec, lp, sig), samples: {}, widths: [] };
}

/** Recompute the Ghost range when the spec changes (e.g. the range target widened), keep the samples. */
export function retargetAccuracyTracker(tracker, spec, lp) {
  if (!tracker) return createAccuracyTracker(spec, lp);
  return { ...tracker, ghost: ghostRanges(spec, lp, tracker.sig) };
}

/**
 * Feed one frame of raw landmarks.
 * @returns {{ tracker: Object, accuracy: number|null }} - accuracy 0-100, null when not moving / not enough data
 */
export function updateAccuracy(tracker, landmarks) {
  if (!tracker || !landmarks) return { tracker, accuracy: null };
  const t = { ...tracker, samples: { ...tracker.samples }, widths: tracker.widths };
  const scores = [];
  for (const side of t.sig.sides) {
    const v = traineeSignal(t.sig.kind, landmarks, side, t);
    const arr = (t.samples[side] || []).slice();
    if (typeof v === 'number' && !Number.isNaN(v)) arr.push(v);
    while (arr.length > WINDOW) arr.shift();
    t.samples[side] = arr;
    const g = t.ghost[side];
    if (!g || arr.length < MIN_SAMPLES) continue;
    const r = range(arr);
    if (r.hi - r.lo < MIN_TRAINEE_SPAN[t.sig.kind]) continue;   // not really moving this side
    scores.push(rangeIoU(r, g));
  }
  if (!scores.length) return { tracker: t, accuracy: null };
  return { tracker: t, accuracy: Math.round(100 * scores.reduce((a, b) => a + b, 0) / scores.length) };
}

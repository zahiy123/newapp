// ============================================================
// rom — range of motion across workouts (Stage 4 #7, built 2026-11-03)
//
// PURE. Two parts:
//  1. romTracker — during the workout, every frame's joint angles (only where all three landmarks are
//     clearly seen); at the end, each joint's session value = its 95th percentile (the highest range
//     reached, robust to a single glitchy frame). Never a missing limb; never a mechanical knee.
//  2. romReference — THE OWNER'S RULE (2026-11-03) for what each joint is compared with:
//     • by default, the INITIAL SCAN (the arms have measured degrees in the scan; a joint the scan did not
//       measure in degrees — the knee, the hip — starts from its first measured workout);
//     • the highest values are kept, but the reference moves only after at least 6 workouts (then: the
//       highest value reached in those workouts — a new stage);
//     • the exception: the initial range was especially LOW (< 50 % of the normal range) and in at least 2
//       workouts the trainee jumped far beyond it (≥ 30 % AND ≥ 15° above) → the reference moves early
//       (to the lower of those values — the level reached reliably, not a single peak).
// All angles are 2D estimates from one camera (as in the scan).
// ============================================================

import { computeAngle } from '../KineticAnalyzer.js';

// joint → [a, b(vertex), c] landmark triplets per side, and how the angle becomes a range
export const ROM_JOINTS = {
  shoulder: { he: 'כתף', en: 'Shoulder', norm: 180, sides: { left: [23, 11, 13], right: [24, 12, 14] }, flex: false },
  elbow: { he: 'מרפק', en: 'Elbow', norm: 145, sides: { left: [11, 13, 15], right: [12, 14, 16] }, flex: true },
  hip: { he: 'ירך', en: 'Hip', norm: 120, sides: { left: [11, 23, 25], right: [12, 24, 26] }, flex: true },
  knee: { he: 'ברך', en: 'Knee', norm: 135, sides: { left: [23, 25, 27], right: [24, 26, 28] }, flex: true },
};
const LIMB_OF = { shoulder: 'arm', elbow: 'arm', hip: 'leg', knee: 'leg' };
export const ROM_VISIBILITY_MIN = 0.6;
export const ROM_MIN_SAMPLES = 60;          // ≈ 6 s of clearly-seen movement at 10 Hz
const MAX_SAMPLES = 6000;

/** The joint keys ('left_knee' …) this trainee can be measured on (never an absent limb / a mechanical knee). */
export function measurableJoints(limbProfile = {}) {
  const out = [];
  for (const side of ['left', 'right']) {
    for (const j of Object.keys(ROM_JOINTS)) {
      const limb = limbProfile?.[`${side}_${LIMB_OF[j]}`] || {};
      if (limb.state === 'absent') continue;
      if (j === 'knee' && limb.state === 'prosthetic' && /above/i.test(String(limb.level || ''))) continue;
      if (j === 'elbow' && limb.state === 'prosthetic' && /above/i.test(String(limb.level || ''))) continue;
      out.push(`${side}_${j}`);
    }
  }
  return out;
}

export function createRomTracker(joints) {
  return { joints: new Set(joints), values: {} };
}

const seen = (p) => !!p && (p.visibility === undefined || p.visibility >= ROM_VISIBILITY_MIN);

/** Add one frame (MediaPipe landmarks). */
export function addRomFrame(tracker, lm) {
  if (!tracker || !Array.isArray(lm)) return;
  for (const key of tracker.joints) {
    const [side, j] = key.split('_');
    const def = ROM_JOINTS[j];
    const [a, b, c] = def.sides[side].map(i => lm[i]);
    if (!seen(a) || !seen(b) || !seen(c)) continue;
    const ang = computeAngle(a, b, c);
    if (!Number.isFinite(ang)) continue;
    const v = def.flex ? 180 - ang : ang;
    const arr = tracker.values[key] || (tracker.values[key] = []);
    if (arr.length < MAX_SAMPLES) arr.push(v);
  }
}

function p95(arr) {
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.round(0.95 * (s.length - 1)))];
}

/** The session's range per joint { left_knee: 92, … } (only joints with enough clear samples). */
export function summarizeRom(tracker) {
  const out = {};
  for (const [key, arr] of Object.entries(tracker?.values || {})) {
    if (arr.length >= ROM_MIN_SAMPLES) out[key] = Math.round(p95(arr));
  }
  return out;
}

/** The scan's measured degrees per joint (the arms only — the legs have no degrees in the scan). */
export function scanRom(scanData) {
  const arms = scanData?.romBaseline?.arms || {};
  const out = {};
  for (const side of ['left', 'right']) {
    const a = arms[`${side}_arm`];
    if (!a) continue;
    const sh = Math.max(Number(a.shoulderFlexionDeg) || 0, Number(a.shoulderAbductionDeg) || 0);
    if (sh > 0) out[`${side}_shoulder`] = Math.round(sh);
    if (Number.isFinite(Number(a.elbowFlexionMinDeg)) && a.elbowFlexionMinDeg != null) out[`${side}_elbow`] = Math.round(180 - Number(a.elbowFlexionMinDeg));
  }
  return out;
}

export const REFERENCE_AFTER = 6;            // workouts before the reference may move
export const EARLY_MIN_WORKOUTS = 2;         // the exception: at least 2 workouts with an extreme jump
export const LOW_INITIAL = 0.5;              // "especially low" = under 50 % of the joint's normal range
export const JUMP_RATIO = 1.3;               // "extreme" = ≥ 30 % above the reference …
export const JUMP_MIN_DEG = 15;              // … and at least 15° above it

/**
 * The reference of ONE joint after the given workouts (oldest first).
 * @param {number|null} scanValue - the initial scan's degrees (null when the scan did not measure it)
 * @param {number[]} values - this joint's value per workout (workouts that measured it), oldest first
 * @param {number} norm - the joint's normal range
 * @returns {{ initial, initialSource: 'scan'|'first_workout', reference, referenceSince, best, latest, stages: [{value, afterWorkout, reason}] } | null}
 */
export function romReference(scanValue, values, norm) {
  const vals = (values || []).filter(v => Number.isFinite(v));
  const hasScan = Number.isFinite(scanValue) && scanValue > 0;
  if (!hasScan && !vals.length) return null;
  const initial = hasScan ? scanValue : vals[0];
  const initialSource = hasScan ? 'scan' : 'first_workout';
  const veryLowInitial = initial < LOW_INITIAL * norm;
  let reference = initial;
  let since = hasScan ? 0 : 1;             // the workout index the current reference starts after
  const stages = [];
  for (let i = since; i < vals.length; i++) {
    const window = vals.slice(since, i + 1);
    // the exception: an especially low start + an extreme jump in ≥ 2 workouts → move early
    if (veryLowInitial && stages.length === 0) {
      const jumps = window.filter(v => v >= reference * JUMP_RATIO && v >= reference + JUMP_MIN_DEG);
      if (jumps.length >= EARLY_MIN_WORKOUTS && window.length < REFERENCE_AFTER) {
        const sorted = [...jumps].sort((a, b) => b - a);
        reference = sorted[EARLY_MIN_WORKOUTS - 1];          // the level reached at least twice
        stages.push({ value: reference, afterWorkout: i + 1, reason: 'early_jump' });
        since = i + 1;
        continue;
      }
    }
    // the rule: after at least 6 workouts the reference moves to the highest value reached in them
    if (window.length >= REFERENCE_AFTER) {
      const top = Math.max(...window);
      if (top > reference) { reference = top; stages.push({ value: top, afterWorkout: i + 1, reason: 'six_workouts' }); }
      since = i + 1;
    }
  }
  return {
    initial, initialSource, reference, referenceSince: since,
    best: vals.length ? Math.max(initial, ...vals) : initial, latest: vals.length ? vals[vals.length - 1] : null, stages,
  };
}

/**
 * Every joint's picture from the workout history (oldest first): { left_knee: { …romReference, series: [{at, value}] } }.
 */
export function romProgress(scanData, workouts) {
  const scan = scanRom(scanData);
  const series = {};
  for (const w of workouts || []) {
    for (const [k, v] of Object.entries(w?.rom || {})) (series[k] = series[k] || []).push({ at: w.at ?? null, value: v });
  }
  const out = {};
  for (const key of new Set([...Object.keys(scan), ...Object.keys(series)])) {
    const j = key.split('_')[1];
    const def = ROM_JOINTS[j];
    if (!def) continue;
    const r = romReference(scan[key] ?? null, (series[key] || []).map(x => x.value), def.norm);
    if (r) out[key] = { ...r, series: series[key] || [], norm: def.norm };
  }
  return out;
}

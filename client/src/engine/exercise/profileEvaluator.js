// ============================================================
// profileEvaluator — live evaluation of an exercise against its Expert Execution Profile
//
// PURE LOGIC, fed with RAW pose landmarks at ~20 Hz (like the warm-up activity loop).
//   setup              — setupCoach: the trainee must be positioned right (head to toe when the
//                        legs matter, centred, right distance, side-on / facing as the profile
//                        measures) — until then nothing counts and `setup` says exactly what to fix
//   requiredRegions()  — which landmarks must be in the frame for this profile & trainee
//   createExecutionTracker / updateExecution — per frame:
//       inView    (hysteresis)          → nothing counts while the required limbs are out of frame
//       metrics   (kinematics.js)       → the profile's joints + trunk lean
//       phase     'rest' | 'mid' | 'peak' (from the primary joint)
//       issues    rules that held ≥ RULE_HOLD_MS (no single-frame noise), error / danger
//       accuracy  % — reps / cyclic: overlap of the trainee's primary-joint range with the
//                 target range; holds: share of time inside the hold range; strikes: share of
//                 clean strikes; errors cost points
//       events    TEMPORAL events from motionFeatures (rep tempo, landing, strike, window),
//                 judged by the profile's + the sport's `dynamics` rules; a violated dynamic
//                 rule stays on screen for DYNAMIC_SHOW_MS, and `coaching` reports a rule that
//                 was violated COACH_AFTER times in a row (the coach explains it once)
//       quality   "silence when unsure" (confidence.js): with low tracking confidence or a
//                 camera view that does not suit the profile, NO rule is judged, no coaching,
//                 no accuracy samples — the UI asks to fix the camera instead
// ============================================================

import { JOINTS, measureMetric, sideUsable } from './kinematics.js';
import { createMotionState, updateMotion } from './motionFeatures.js';
import { updateConfidence } from './confidence.js';
import { assessSetup, SETUP } from './setupCoach.js';

const MIN_VISIBILITY = 0.5;
const FRAME_MARGIN = 0.02;
const VISIBLE_ON_SAMPLES = 3;      // ~150 ms in view → visible
const VISIBLE_OFF_SAMPLES = 10;    // ~500 ms out of view → not visible
export const RULE_HOLD_MS = 400;   // a rule must hold this long before it is reported
const WINDOW_MS = 8000;            // accuracy window (a few reps) — at least 2 Ghost cycles at slow tempos
const MIN_ACCURACY_SAMPLES = 20;   // ~1 s of in-view frames before a % is shown
export const DYNAMIC_SHOW_MS = 2500;  // a violated dynamic rule stays on screen this long
export const COACH_AFTER = 3;         // consecutive violations before the coach explains the rule
const STRIKE_WINDOW = 5;              // accuracy of strike exercises: the last N strikes

const SIDE_POINTS = {
  legs: { left: [23, 25, 27], right: [24, 26, 28] },     // hip, knee, ankle
  arms: { left: [11, 13, 15], right: [12, 14, 16] },     // shoulder, elbow, wrist
  torso: { left: [11, 23], right: [12, 24] },             // shoulder, hip
  body: { left: [11, 23, 27], right: [12, 24, 28] },      // shoulder, hip, ankle (floor exercises)
};
const REGION_LIMB = { legs: 'leg', arms: 'arm', torso: null, body: 'leg' };

/** True if every landmark is confidently detected AND inside the camera frame. */
export function pointsInView(landmarks, points) {
  if (!landmarks) return false;
  return points.every((i) => {
    const p = landmarks[i];
    return p && (p.visibility ?? 1) >= MIN_VISIBILITY &&
      p.x >= -FRAME_MARGIN && p.x <= 1 + FRAME_MARGIN && p.y >= -FRAME_MARGIN && p.y <= 1 + FRAME_MARGIN;
  });
}

/**
 * Required regions for a profile and trainee. Each region lists candidate sides; a region is
 * satisfied when ALL its listed sides are in view ('all') or ANY one is ('any').
 * Side views see one side clearly (the far side is occluded) → 'any'. Front views → every
 * usable arm. Absent / non-trainable limbs are never required (Iron Rule).
 * @returns {Array<{ region: string, mode: 'any'|'all', sides: Array<number[]> }>}
 */
export function requiredRegions(profile, lp = {}) {
  const out = [];
  for (const region of profile?.require || []) {
    const limb = REGION_LIMB[region];
    let sides = ['left', 'right'];
    if (limb) sides = sides.filter(s => sideUsable(limb, s, lp));
    if (!sides.length) continue;     // no usable limb of this kind → not required
    const mode = region === 'arms' && profile.cameraView === 'front' ? 'all' : 'any';
    out.push({ region, mode, sides: sides.map(s => SIDE_POINTS[region][s]) });
  }
  return out;
}

/** First region that is not in view (null = all in view). */
export function missingRegion(landmarks, regions) {
  for (const r of regions) {
    const seen = r.sides.map(pts => pointsInView(landmarks, pts));
    const okRegion = r.mode === 'all' ? seen.every(Boolean) : seen.some(Boolean);
    if (!okRegion) return r.region;
  }
  return null;
}

const mid = (r) => (r[0] + r[1]) / 2;

/** Rep progress 0 (rest) … 1 (peak) of the primary joint; null for holds / basic profiles. */
export function repProgress(profile, value) {
  const j = profile?.joints?.[profile.primary];
  if (!j?.peak || typeof value !== 'number') return null;
  const a = mid(j.rest), b = mid(j.peak);
  if (Math.abs(b - a) < 1e-6) return null;
  return Math.max(0, Math.min(1, (value - a) / (b - a)));
}

function phaseOf(progress) {
  if (progress === null) return 'any';
  if (progress >= 0.6) return 'peak';
  if (progress <= 0.3) return 'rest';
  return 'mid';
}

/** All metrics a profile uses (joints + rule metrics), measured on the given landmarks. */
export function measureProfile(profile, landmarks, lp = {}) {
  const names = new Set([...Object.keys(profile?.joints || {}), ...(profile?.rules || []).map(r => r.metric)]);
  const out = {};
  for (const m of names) out[m] = measureMetric(landmarks, m, lp, profile.joints?.[m]?.combine || 'min');
  return out;
}

/** Rules violated by one set of metrics (instantaneous, no persistence). */
export function violatedRules(profile, metrics, phase) {
  const hits = [];
  for (const r of profile?.rules || []) {
    if (r.when === 'peak' && phase !== 'peak') continue;
    if (r.when === 'rest' && phase !== 'rest') continue;
    const v = metrics[r.metric];
    if (typeof v !== 'number') continue;
    if ((r.op === '>' && v > r.value) || (r.op === '<' && v < r.value)) hits.push(r);
  }
  return hits;
}

/**
 * @param {Object} profile - personalized profile (exerciseProfiles.personalizeProfile)
 * @param {Object} [lp] - limbProfile
 */
export function createExecutionTracker(profile, lp = {}) {
  return {
    profile, lp,
    regions: requiredRegions(profile, lp),
    inView: false, inStreak: 0, outStreak: 0,
    ruleSince: {},          // rule id → first ms it held continuously
    samples: [],            // { t, v, err } for the accuracy window
    motion: createMotionState(profile, lp),
    dynActive: {},          // rule id → { rule, until, value }
    dynStreak: {},          // rule id → consecutive violating events
    coached: {},            // rule id → true once explained
    strikes: [],            // { ok } of recent strikes
    conf: {},               // confidence hysteresis state
  };
}

/** Value of a dynamic rule's feature in an event violates the rule? */
export function dynamicViolation(rule, event) {
  const v = event?.[rule.feature];
  if (typeof v !== 'number') return false;
  return (rule.op === '>' && v > rule.value) || (rule.op === '<' && v < rule.value);
}

/** Accuracy (0..100) from the window samples; null until there is enough data. */
export function accuracyOf(profile, samples, strikes = []) {
  if (profile?.kind === 'strike') {
    if (strikes.length < 2) return null;
    return Math.round(100 * strikes.filter(x => x.ok).length / strikes.length);
  }
  if (samples.length < MIN_ACCURACY_SAMPLES) return null;
  const j = profile?.joints?.[profile.primary];
  if (!j) return null;
  const vals = samples.map(s => s.v).sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
  const errShare = samples.filter(s => s.err).length / samples.length;
  let base;
  if (!j.peak) {
    base = samples.filter(s => s.v >= j.rest[0] && s.v <= j.rest[1]).length / samples.length;
  } else {
    // Target range: from the middle of the rest range to the middle of the peak range
    const tLo = Math.min(mid(j.rest), mid(j.peak));
    const tHi = Math.max(mid(j.rest), mid(j.peak));
    const lo = q(0.05), hi = q(0.95);
    const inter = Math.max(0, Math.min(hi, tHi) - Math.max(lo, tLo));
    const union = Math.max(hi, tHi) - Math.min(lo, tLo);
    base = union > 1e-6 ? inter / union : 0;
  }
  return Math.round(100 * base * (1 - 0.5 * errShare));
}

/**
 * One frame.
 * @returns {{ tracker, inView: boolean, missing: string|null, setup: Object|null, metrics: Object, phase: string,
 *             issues: Object[], danger: Object|null, accuracy: number|null,
 *             events: Object[], coaching: Object[], live: { cadence?: number|null },
 *             quality: { confident: boolean, reason: null|'limbs'|'view'|'tracking', view: string|null } }}
 */
export function updateExecution(tracker, landmarks, nowMs) {
  const tr = tracker;
  const { profile } = tr;

  // 1. Positioned right + required limbs in view (hysteresis). Like a coach: one precise fix at a time
  const setupNow = assessSetup(landmarks, profile, tr.lp);
  let issueNow = setupNow.ok ? null : setupNow.issue;
  if (!issueNow) {
    const region = missingRegion(landmarks, tr.regions);
    if (region) issueNow = region === 'arms' ? SETUP.arms : region === 'legs' ? SETUP.feetStepBack : { ...SETUP.noBody, region };
  }
  if (issueNow) tr.lastSetupIssue = issueNow;
  if (issueNow === null) { tr.inStreak += 1; tr.outStreak = 0; } else { tr.outStreak += 1; tr.inStreak = 0; }
  if (!tr.inView && tr.inStreak >= VISIBLE_ON_SAMPLES) tr.inView = true;
  if (tr.inView && tr.outStreak >= VISIBLE_OFF_SAMPLES) tr.inView = false;
  const setup = tr.inView ? null : (issueNow || tr.lastSetupIssue || SETUP.noBody);
  const missing = setup ? setup.region : null;

  const quiet = (quality) => ({
    tracker: tr, inView: tr.inView, missing, setup, metrics: {}, phase: 'any', issues: [], danger: null,
    accuracy: accuracyOf(profile, tr.samples, tr.strikes), events: [], coaching: [], live: {}, quality,
  });
  if (!tr.inView || !landmarks || profile.precision !== 'expert') {
    tr.ruleSince = {};
    if (!tr.inView) tr.motion = createMotionState(profile, tr.lp);   // no motion history across a gap
    return quiet({ confident: profile.precision === 'expert' ? false : true, reason: tr.inView ? null : 'limbs', view: null });
  }

  // 2. Kinematics
  const metrics = measureProfile(profile, landmarks, tr.lp);
  const phase = phaseOf(repProgress(profile, metrics[profile.primary]));

  // 2b. Silence when unsure — no judging on an untrustworthy measurement
  const quality = updateConfidence(tr.conf, profile, landmarks, metrics[profile.primary]);
  if (!quality.confident) {
    tr.ruleSince = {};
    tr.dynActive = {};
    tr.motion = createMotionState(profile, tr.lp);
    return { ...quiet(quality), metrics, phase };
  }

  // 3. Rules with persistence
  const hits = violatedRules(profile, metrics, phase);
  const hitIds = new Set(hits.map(r => r.id));
  for (const id of Object.keys(tr.ruleSince)) if (!hitIds.has(id)) delete tr.ruleSince[id];
  const issues = [];
  for (const r of hits) {
    if (tr.ruleSince[r.id] === undefined) tr.ruleSince[r.id] = nowMs;
    if (nowMs - tr.ruleSince[r.id] >= RULE_HOLD_MS) issues.push(r);
  }

  // 3b. Temporal analysis: events judged by the dynamic rules (profile + sport)
  const { events, live } = updateMotion(tr.motion, landmarks, metrics, nowMs);
  const coaching = [];
  for (const ev of events) {
    let clean = true;
    for (const r of profile.dynamics || []) {
      if (r.on !== ev.type) continue;
      if (dynamicViolation(r, ev)) {
        clean = false;
        tr.dynActive[r.id] = { rule: r, until: nowMs + DYNAMIC_SHOW_MS, value: ev[r.feature] };
        tr.dynStreak[r.id] = (tr.dynStreak[r.id] || 0) + 1;
        if (tr.dynStreak[r.id] >= COACH_AFTER && !tr.coached[r.id]) { tr.coached[r.id] = true; coaching.push(r); }
      } else if (typeof ev[r.feature] === 'number') {
        tr.dynStreak[r.id] = 0;
      }
    }
    if (ev.type === 'strike') {
      tr.strikes.push({ ok: clean && issues.length === 0 });
      if (tr.strikes.length > STRIKE_WINDOW) tr.strikes.shift();
    }
  }
  for (const [id, d] of Object.entries(tr.dynActive)) {
    if (d.until < nowMs) delete tr.dynActive[id];
    else if (!issues.some(i => i.id === id)) issues.push(d.rule);
  }

  issues.sort((a, b) => (a.severity === 'danger' ? 0 : 1) - (b.severity === 'danger' ? 0 : 1));
  const danger = issues.find(r => r.severity === 'danger') || null;

  // 4. Accuracy window
  const v = metrics[profile.primary];
  if (typeof v === 'number') {
    tr.samples.push({ t: nowMs, v, err: issues.length > 0 });
    const windowMs = Math.max(WINDOW_MS, 2 * (profile.ghost?.periodMs || 0));
    while (tr.samples.length && nowMs - tr.samples[0].t > windowMs) tr.samples.shift();
  }

  return {
    tracker: tr, inView: true, missing: null, setup: null, metrics, phase, issues, danger,
    accuracy: accuracyOf(profile, tr.samples, tr.strikes), events, coaching, live, quality,
  };
}

/** Joint names the profile measures (for UI / tests). */
export function profileJointNames(profile) {
  return Object.keys(profile?.joints || {}).filter(j => JOINTS[j]);
}

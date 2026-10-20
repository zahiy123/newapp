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

import { JOINTS, measureMetric, sideUsable, trunkLean, uprightLeanProfile, calibratedLean, MAX_CAMERA_TILT_DEG } from './kinematics.js';
import { createMotionState, updateMotion } from './motionFeatures.js';
import { updateConfidence, detectView } from './confidence.js';

// measures that live in DEPTH when the trainee faces the camera (owner field video, 2026-10-18: "start
// the movement from the hip" on every pass, seen from the front)
const SAGITTAL = new Set(['chainLeadMs', 'trunkLean', 'trunkRange']);
import { assessSetup, SETUP } from './setupCoach.js';

// (0.4: a prosthesis / a foot at the frame's edge reads lower — the measurement's own confidence gate still judges)
const MIN_VISIBILITY = 0.4;
const FRAME_MARGIN = 0.02;
const VISIBLE_ON_SAMPLES = 3;      // ~150 ms in view → visible
const VISIBLE_OFF_SAMPLES = 20;    // ~1 s out of view → not visible (a flicker never drops the trainee)
export const RULE_HOLD_MS = 400;   // a rule must hold this long before it is reported
const WINDOW_MS = 8000;            // accuracy window (a few reps) — at least 2 Ghost cycles at slow tempos
const MIN_ACCURACY_SAMPLES = 20;   // ~1 s of in-view frames before a % is shown
export const DYNAMIC_SHOW_MS = 2500;  // a violated dynamic rule stays on screen this long
export const COACH_AFTER = 2;         // consecutive violations before the coach cues a TEMPO / flow rule
// A position error (a static rule: depth, knee line, body line, elbow, trunk) is a technique error of
// the movement itself (owner, 2026-10-18: "a short, immediate cue during the set — the full analysis in
// the rest"): cued RIGHT AFTER the first rep it was seen in; in a hold / running, after it held
// HOLD_COACH_MS. A rule is cued again (MAX_COACH_PER_RULE per exercise) only after a longer streak
// (1 → 3 → 5 reps) — never nagging every rep. Every attempt is LOGGED (tr.log) for the rest's debrief.
export const STATIC_COACH_AFTER = 1;
export const HOLD_COACH_MS = 1500;
export const MAX_COACH_PER_RULE = 30;      // (practically no cap: a repeated error is corrected again)
const HOLD_RECOACH_GAP_MS = 8000;
// THE CORRECTION POLICY (owner, 2026-10-20): a CRITICAL / dangerous / significantly harmful technique error is said
// at once, every time it happens; a minor one is forgiven ONCE (said from its 2nd time in a row); any error that
// keeps repeating is corrected again (the coach brain's gap keeps it from being every second)
export const MAJOR_RULES = new Set(['knee_valgus', 'knee_in', 'lean_back', 'trunk_collapse', 'over_bend', 'hip_sag',
  'too_deep', 'kick_toe', 'pass_toe', 'pass_laces', 'strike_balance']);
export const isMajor = (r) => r?.severity === 'danger' || r?.major === true || MAJOR_RULES.has(r?.id);
const REP_ERR_FRAMES = 4;            // ~200 ms of a rep in the wrong position = an error of that rep
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
    coached: {},            // rule id → how many times it was explained
    coachedAt: {},          // rule id → when it was last explained
    repErr: {},             // static error rule id → frames it was violated since the last rep / strike
    repJudged: {},          // static rule id → frames it could be judged since the last rep / strike
    repWorst: {},           // static rule id → the worst value in this rep
    log: createSetLog(profile),   // the set's attempts, per rule (the rest's debrief)
    strikes: [],            // { ok } of recent strikes
    conf: {},               // confidence hysteresis state
    cameraTilt: 0,          // the camera's tilt, measured on the upright trainee (calibrateUpright)
    tiltReady: false,       // calibrated (until then a "don't lean" rule is not judged — on the live camera: requireTilt)
    requireTilt: false,
    leanRaw: null,
  };
}

/** A new, empty set log. unit: 'reps' (reps / kicks) or 'sec' (holds, running: one entry per second). */
export function createSetLog(profile) {
  return { attempts: 0, partial: 0, unit: profile?.kind === 'hold' || profile?.kind === 'cyclic' ? 'sec' : 'reps', rules: {} };
}
/** Has anything at all been JUDGED in this set (a measured rule / a vision finding)? */
export const logJudgedCount = (log) => Object.values(log?.rules || {}).reduce((s, e) => s + (e.judged || 0), 0);

/** Start a new set's log (a new set starts from zero). */
export function resetSetLog(tr) { if (tr) { tr.log = createSetLog(tr.profile); tr.occ = {}; } return tr?.log; }
/** Is this side's leg a prosthesis (or absent) for this trainee? */
export const isProstheticLeg = (lp, side) => (side === 'left' || side === 'right')
  && ['prosthetic', 'absent'].includes(lp?.[`${side}_leg`]?.state);

export function logRule(log, r, violated, value) {
  const e = log.rules[r.id] || (log.rules[r.id] = { rule: r, judged: 0, n: 0, values: [] });
  e.judged += 1;
  if (violated) { e.n += 1; if (typeof value === 'number') e.values.push(value); }
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
  let setupNow = assessSetup(landmarks, profile, tr.lp);
  const region = missingRegion(landmarks, tr.regions);
  // a small room: a framing fix while the measured joints ARE in the picture is a tip, not a block —
  // look past it for a real problem (orientation, light, distance)
  let hint = null;
  if (setupNow.issue?.soft && !region) {
    hint = setupNow.issue;
    setupNow = assessSetup(landmarks, profile, tr.lp, { skipSoft: true });
  }
  let issueNow = setupNow.ok ? null : setupNow.issue;
  if (!issueNow && region) issueNow = region === 'arms' ? SETUP.arms : region === 'legs' ? SETUP.feetStepBack : { ...SETUP.noBody, region };
  // a room fix while the measured joints really ARE out: the instruction a small room can do for THAT part
  // (the legs: tilt the screen down) — never "step back so I see you head to toe"
  if (issueNow?.code === 'step_back' && region) issueNow = region === 'arms' ? SETUP.arms : region === 'legs' ? SETUP.feetStepBack : issueNow;
  if (issueNow) tr.lastSetupIssue = issueNow;
  if (issueNow === null) { tr.inStreak += 1; tr.outStreak = 0; } else { tr.outStreak += 1; tr.inStreak = 0; }
  if (!tr.inView && tr.inStreak >= VISIBLE_ON_SAMPLES) tr.inView = true;
  if (tr.inView && tr.outStreak >= VISIBLE_OFF_SAMPLES) tr.inView = false;
  const setup = tr.inView ? null : (issueNow || tr.lastSetupIssue || SETUP.noBody);
  const missing = setup ? setup.region : null;

  const quiet = (quality) => ({
    tracker: tr, inView: tr.inView, missing, setup, hint, metrics: {}, phase: 'any', issues: [], danger: null,
    accuracy: accuracyOf(profile, tr.samples, tr.strikes), events: [], coaching: [], live: {}, quality,
  });
  if (!tr.inView || !landmarks || profile.precision !== 'expert') {
    tr.ruleSince = {};
    tr.repErr = {}; tr.repJudged = {}; tr.repWorst = {};
    if (!tr.inView) tr.motion = createMotionState(profile, tr.lp);   // no motion history across a gap
    return quiet({ confident: profile.precision === 'expert' ? false : true, reason: tr.inView ? null : 'limbs', view: null });
  }

  // 2. Kinematics — the trunk lean calibrated to this camera (the trainee's own upright = 0)
  const metrics = measureProfile(profile, landmarks, tr.lp);
  const leanRaw = trunkLean(landmarks);
  tr.leanRaw = leanRaw;
  const upright = uprightLeanProfile(profile);
  const lean = upright ? calibratedLean(leanRaw, tr.cameraTilt) : leanRaw;
  if ('trunkLean' in metrics) metrics.trunkLean = lean;
  metrics.__lean = lean;
  const phase = phaseOf(repProgress(profile, metrics[profile.primary]));

  // 2b. Silence when unsure — no judging on an untrustworthy measurement
  const quality = updateConfidence(tr.conf, profile, landmarks, metrics[profile.primary]);
  if (!quality.confident) {
    tr.ruleSince = {};
    tr.repErr = {}; tr.repJudged = {}; tr.repWorst = {};
    tr.dynActive = {};
    tr.motion = createMotionState(profile, tr.lp);
    return { ...quiet(quality), metrics, phase };
  }

  // 3. Rules with persistence. Facing the camera, a forward / backward measure (the hip leading the
  // kick, the trunk leaning toward / away from the camera) is in DEPTH — it cannot be judged reliably
  // from the front: those error rules are not judged in a frontal view (dangers always are)
  const frontal = detectView(landmarks) === 'front';
  // (the hip-first chain: never from the front; the trunk lean: not in kick / pass drills from the front
  // — a squat's forward lean stays judged, it was designed for the frontal depth)
  const judged = (r) => {
    if (r.view === 'front' && !frontal) return false;          // a frontal-only measure (the foot's turn-out, the knee line)
    if (r.view === 'side' && frontal) return false;            // a side-only measure
    // the trunk lean of an upright drill is judged only once THIS camera's tilt was calibrated on the
    // trainee standing still (a laptop looking down reads an upright trainee as leaning) — dangers always
    if ((r.metric || r.feature) === 'trunkLean' && r.severity !== 'danger' && tr.requireTilt && uprightLeanProfile(profile) && !tr.tiltReady) return false;
    if (!frontal || r.severity === 'danger') return true;
    const m = r.metric || r.feature;
    if (m === 'chainLeadMs') return false;
    return !(profile.kind === 'strike' && SAGITTAL.has(m));
  };
  const hits = violatedRules(profile, metrics, phase).filter(judged);
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
  const canCoach = (id) => (tr.coached[id] || 0) < MAX_COACH_PER_RULE;
  // a repeat explanation needs a LONGER streak each time (2 → 6 → 10 reps): the coach is patient
  // major → at once; minor → forgiven once: said when it happens AGAIN in this set (not necessarily in a row),
  // and once corrected, said again at each repeat
  if (!tr.occ) tr.occ = {};
  const sayNow = (r) => { tr.occ[r.id] = (tr.occ[r.id] || 0) + 1; return isMajor(r) || r.coachNow || (tr.coached[r.id] || 0) > 0 || tr.occ[r.id] >= 2; };
  // (with what was MEASURED — the AI coach words the correction from it: the value, the side)
  const coachIt = (r, measured = null, side = null) => { tr.coached[r.id] = (tr.coached[r.id] || 0) + 1; tr.coachedAt[r.id] = nowMs; tr.dynStreak[r.id] = 0; coaching.push({ ...r, measured, side }); };
  // (a peak is short: ≥ REP_ERR_FRAMES frames in this rep, not the full hold time)
  for (const r of hits) {
    tr.repErr[r.id] = (tr.repErr[r.id] || 0) + 1;
    const v = metrics[r.metric], w = tr.repWorst[r.id];
    if (typeof v === 'number') tr.repWorst[r.id] = w === undefined ? v : (r.op === '>' ? Math.max(w, v) : Math.min(w, v));
  }
  for (const r of profile.rules || []) {
    if (r.when === 'peak' && phase !== 'peak') continue;
    if (r.when === 'rest' && phase !== 'rest') continue;
    if (typeof metrics[r.metric] === 'number' && judged(r)) tr.repJudged[r.id] = (tr.repJudged[r.id] || 0) + 1;
  }
  for (const ev of events) {
    // the position errors of this rep / kick (static rules), judged per attempt
    // a partial rep (turned back before the target): its range rules ("go deeper") are violated by definition
    if (ev.type === 'partialRep') {
      const j = profile.joints?.[profile.primary];
      const down = j?.peak && (j.peak[0] + j.peak[1]) < (j.rest[0] + j.rest[1]);
      for (const r of profile.rules || []) {
        if (r.when === 'peak' && r.metric === profile.primary && r.severity === 'error' && r.op === (down ? '>' : '<') && judged(r)) {
          tr.repErr[r.id] = REP_ERR_FRAMES;
          tr.repJudged[r.id] = REP_ERR_FRAMES;
          if (typeof ev.primaryPeak === 'number') tr.repWorst[r.id] = ev.primaryPeak;
          tr.dynActive[r.id] = { rule: r, until: nowMs + DYNAMIC_SHOW_MS, value: ev.primaryPeak };
        }
      }
    }
    const attempt = ev.type === 'rep' || ev.type === 'strike' || ev.type === 'partialRep';
    if (attempt && tr.log.unit === 'reps') {
      tr.log.attempts += 1;
      if (ev.type === 'partialRep') tr.log.partial += 1;
      for (const r of profile.rules || []) {
        if ((tr.repJudged[r.id] || 0) >= REP_ERR_FRAMES) logRule(tr.log, r, (tr.repErr[r.id] || 0) >= REP_ERR_FRAMES, tr.repWorst[r.id]);
      }
    }
    // a hold / running: one log entry per second of work
    if (ev.type === 'window' && tr.log.unit === 'sec') {
      tr.log.attempts += 1;
      for (const r of profile.rules || []) {
        if ((tr.repJudged[r.id] || 0) >= 5) logRule(tr.log, r, (tr.repErr[r.id] || 0) >= 0.5 * tr.repJudged[r.id], tr.repWorst[r.id]);
      }
      tr.repErr = {}; tr.repJudged = {}; tr.repWorst = {};
    }
    if (attempt) {
      for (const r of profile.rules || []) {
        if (r.severity !== 'error' || !judged(r)) continue;
        if ((tr.repErr[r.id] || 0) >= REP_ERR_FRAMES) {
          tr.dynStreak[r.id] = (tr.dynStreak[r.id] || 0) + 1;
          if (sayNow(r) && canCoach(r.id)) coachIt(r, tr.repWorst[r.id] ?? null, ev.side || null);
        } else tr.dynStreak[r.id] = 0;
      }
      tr.repErr = {}; tr.repJudged = {}; tr.repWorst = {};
    }
    let clean = true;
    for (const r of profile.dynamics || []) {
      if (r.on !== ev.type || !judged(r)) continue;
      // a foot rule (the ankle lock, the contact surface) never judges a PROSTHETIC foot — its ankle is fixed
      // (owner, 2026-10-20); the kicking leg = the leg the set is for, else the strike's side
      if (r.naturalFoot && isProstheticLeg(tr.lp, tr.activeLeg || ev.side)) continue;
      if (dynamicViolation(r, ev)) {
        tr.dynStreak[r.id] = (tr.dynStreak[r.id] || 0) + 1;
        // a rule that needs CONFIRMATION (the foot / ankle — a fine measure) shows, counts and is coached only
        // when seen in `confirm` attempts in a row: one doubtful reading never raises an alarm
        if (r.confirm && tr.dynStreak[r.id] < r.confirm) continue;
        if (typeof ev[r.feature] === 'number') logRule(tr.log, r, true, ev[r.feature]);
        clean = false;
        tr.dynActive[r.id] = { rule: r, until: nowMs + DYNAMIC_SHOW_MS, value: ev[r.feature] };
        // a technique error of the movement itself (coachNow) is corrected RIGHT AFTER the first time
        if (sayNow(r) && canCoach(r.id)) coachIt(r, ev[r.feature], ev.side || null);
      } else if (typeof ev[r.feature] === 'number') {
        logRule(tr.log, r, false, ev[r.feature]);
        tr.dynStreak[r.id] = 0;
      }
    }
    if (ev.type === 'strike') {
      tr.strikes.push({ ok: clean && issues.length === 0 });
      if (tr.strikes.length > STRIKE_WINDOW) tr.strikes.shift();
    }
  }
  // a hold / running: a position error that HELD is explained (no reps to wait for)
  if (profile.kind === 'hold' || profile.kind === 'cyclic') {
    for (const r of issues) {
      if (r.severity !== 'error' || !(profile.rules || []).includes(r)) continue;
      const heldMs = nowMs - (tr.ruleSince[r.id] ?? nowMs);
      if (heldMs >= HOLD_COACH_MS && canCoach(r.id) && nowMs - (tr.coachedAt[r.id] ?? -1e9) >= HOLD_RECOACH_GAP_MS) coachIt(r, metrics[r.metric] ?? null);
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
    tracker: tr, inView: true, missing: null, setup: null, hint, metrics, phase, issues, danger,
    accuracy: accuracyOf(profile, tr.samples, tr.strikes), events, coaching, live, quality,
  };
}

/** Joint names the profile measures (for UI / tests). */
export function profileJointNames(profile) {
  return Object.keys(profile?.joints || {}).filter(j => JOINTS[j]);
}


/**
 * Calibrate the camera's tilt ONCE, on the trainee verified UPRIGHT and STILL in the start position of
 * an upright drill: the median of the raw trunk lean over a stable stretch (`samples`, ~1.5 s with
 * < 4° spread) is the camera's tilt. Only for drills whose trunk rules are "don't lean" maxima.
 * @param {number[]} [samples] - raw leans of the stable stretch (default: the current frame)
 * @returns {number} the tilt in use
 */
export function calibrateUpright(tr, samples = null) {
  if (!tr || !uprightLeanProfile(tr.profile)) return tr?.cameraTilt ?? 0;
  const v = (samples && samples.length ? samples : [tr.leanRaw]).filter(x => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return tr.cameraTilt ?? 0;
  tr.cameraTilt = Math.max(0, Math.min(MAX_CAMERA_TILT_DEG, v[Math.floor(v.length / 2)]));
  tr.tiltReady = true;
  return tr.cameraTilt;
}

/** A stretch of raw leans is a stable upright stance (enough samples, a small spread)? */
export function stableUpright(samples, n = 30, spreadDeg = 4) {
  if (!samples || samples.length < n) return false;
  const last = samples.slice(-n);
  return Math.max(...last) - Math.min(...last) < spreadDeg;
}

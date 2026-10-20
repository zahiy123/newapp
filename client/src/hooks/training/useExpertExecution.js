// useExpertExecution — runs the current exercise against its Expert Execution Profile (Stage 3.1)
//
// Isolated module behind FEATURES.EXPERT_PROFILE. Reads the RAW pose landmarks at 20 Hz
// (landmarksRef, no React-state throttling) and exposes:
//   inViewRef   — false while the exercise's required limbs are out of the frame; the exercise
//                 page blocks rep counting and nudges while it is false
//   missingPart — which body region is out of view (legs / arms / body)
//   setup       — the ONE positioning fix to say now ({ code, he, en }) or null; readyFlash — "now I can see you"
//   issue       — the most important persisting execution error / danger (UI)
//   accuracy    — % execution accuracy vs. the profile (UI)
//   ghostSpec   — { profile } → the Ghost demonstrates exactly this profile
//   cadence     — live steps/min for gait profiles
// The profile is layered with the trainee's SPORT contexts (sportLibrary): sport-specific rules,
// explanations, emphasis and tempo.
// Positioning like a real coach (setupCoach): while the trainee is not positioned right, the
// coach says EXACTLY what to fix ("step back so I see you head to toe", "tilt the camera down",
// "move a little to the left", "turn side-on") — immediately, then every few seconds — and
// nothing counts. Once positioned right: "Great, now I can see you — let's start!".
// Voice (critical-only policy): positioning (the precise measured instruction only — no generic drive),
// DANGER alerts, and a technique error that repeated COACH_AFTER times in a row is explained
// ONCE per exercise (correction + why).
// Start gate (coachFlow): startReadyRef opens only when positioned + measured reliably + in the
// exercise's START POSITION continuously — the calibration / exercise start waits for it.
// Counting: repCountRef counts only full, real reps of the profile (rest → peak → rest with real
// durations) while `counting`; workingRef tells timed exercises whether the trainee is working.
// Early start (owner): the trainee may start working while the coach is still explaining —
// `quiet` runs the module silently (briefing: no positioning voice over the explanation) and
// earlyRef turns true on the first REAL work (a full rep, a kick, running strides), so the page
// starts the exercise at once; reps done meanwhile are already counted (repCountRef / strikeCountRef).
// SAFETY: any runtime error disables the module for the session and re-opens the gates,
// so the exercise falls back to the previous pipeline.

import { useEffect, useMemo, useRef, useState } from 'react';
import { getExerciseProfile, personalizeProfile } from '../../engine/exercise/exerciseProfiles';
import { variationProfile } from '../../engine/catalog/catalog';
import { applySportContext } from '../../engine/sports/sportLibrary';
import { createExecutionTracker, updateExecution, calibrateUpright, stableUpright, resetSetLog } from '../../engine/exercise/profileEvaluator';
import { liveCue } from '../../engine/coachBrain/policy';
import { jointAngleSide, torsoLength } from '../../engine/exercise/kinematics';
import { cueFacts } from '../../engine/coachBrain/aiFacts';
import { aiCue, aiLine, aiPassVision, aiBodyVision } from '../../utils/aiCoach';
import { logRule, logJudgedCount } from '../../engine/exercise/profileEvaluator';

// one kick / pass = one count: after a COUNTED kick nothing counts for COUNT_LOCK_MS (its back-swing / return);
// a FLOOD (FLOOD_N strikes within FLOOD_MS — wild, endless kicking) counts and answers nothing until calm
export const COUNT_LOCK_MS = 1000;
export const FLOOD_N = 3, FLOOD_MS = 2500, FLOOD_CALM_MS = 1500;
// agility / endurance / speed drills: the data is collected during the set, the feedback is given in the REST
export const REST_ONLY_IDS = new Set(['runInPlace', 'highKnees', 'buttKicks', 'aSkip', 'accelMarch', 'lateralShuffle', 'jumpSquat']);
export const restOnlyFeedback = (profile) => !!profile && (profile.kind === 'cyclic' || REST_ONLY_IDS.has(profile.id));
// the vision model's verdict on a pass, mapped to the pass's own rules (confident findings only)
export const VISION_CONFIDENCE = 0.75;
export const VISION_MINOR_CONFIDENCE = 0.6;
export const VISION_GOOD_CONFIDENCE = 0.65;
export function visionRuleHits(v, profile) {
  const rule = (id) => [...(profile?.rules || []), ...(profile?.dynamics || [])].find(r => r.id === id) || null;
  const out = [];
  const ok = (f) => f && typeof f.confidence === 'number' && f.confidence >= VISION_CONFIDENCE;
  if (ok(v?.contact)) {
    if (v.contact.value === 'toe' && rule('pass_toe')) out.push({ rule: rule('pass_toe'), violated: true });
    else if (v.contact.value === 'laces' && rule('pass_laces')) out.push({ rule: rule('pass_laces'), violated: true });
    else if (v.contact.value === 'inside') { if (rule('pass_toe')) out.push({ rule: rule('pass_toe'), violated: false }); }
  }
  if (ok(v?.ankleLocked) && typeof v.ankleLocked.value === 'boolean' && rule('pass_ankle')) out.push({ rule: rule('pass_ankle'), violated: !v.ankleLocked.value });
  return out;
}
import { bodyText } from '../../engine/coachBrain/aiFacts';
import {
  createStartGate, updateStartGate, isStartPosition, feetStill, openingKickAllowed, isValidRep, updateWork, withDrive, startPositionPrompt, READY_DRIVE,
} from '../../engine/training/coachFlow';
import { createClipRecorder, recordFrame } from '../../engine/validation/clipRecorder';
import { createRepEvidence, evidenceFrame, evidenceOk, evidenceAccept, evidenceGroupFor, explainStrike,
  KICK_MAX_WIDTH_CHANGE, KICK_MAX_TRAVEL, KICK_ANCHOR_MAX, STRIKE_MIN_RANGE, STRIKE_MIN_VEL, STRIKE_MIN_PATH } from '../../engine/training/repEvidence';
import { holdSpeech } from '../useSpeech';
import { ROOM_TIP } from '../../engine/exercise/setupCoach';

// a small room: the framing tip is said ONCE per session (then the coach adapts and stays quiet)
let roomTipGiven = false;
const ROOM_TIP_AFTER_MS = 3000;

/** How long a line takes to say (Hebrew TTS ≈ 14 characters / s at rate 1). */
const estimateSpeechMs = (text, rate = 1) => Math.round((String(text || '').length / 14) * 1000 / (rate || 1)) + 400;
import { createCoachBrain, brainFrame, brainAttempt, brainOfferCorrection, brainDecide, brainPolicyToSave } from '../../engine/coachBrain/brain';

// The coach brain's learned correction styles, per trainee, on this device
const POLICY_KEY = 'coachPolicy.v1';
const loadPolicy = () => { try { return JSON.parse(localStorage.getItem(POLICY_KEY) || 'null'); } catch { return null; } };
const savePolicy = (p) => { try { localStorage.setItem(POLICY_KEY, JSON.stringify(p)); } catch { /* storage blocked */ } };

const TICK_MS = 50;
// Positioning with AUTHORITY, not nagging (owner, 2026-10-18): a fix is shown / said only when a
// positioning problem lasted SETUP_SETTLE_MS in a row; the same instruction never again within
// SETUP_REPEAT_MS; the card leaves only after SETUP_CLEAR_MS of good positioning (no flicker)
const SETUP_SETTLE_MS = 3000;
const SETUP_REPEAT_MS = 20000;
const SETUP_CLEAR_MS = 1500;
const SETUP_ANY_GAP_MS = 10000;           // at most ONE positioning line (of any kind) this often
const READY_AGAIN_GAP_MS = 20000;          // "I see you again" at most this often
const READY_SETTLE_MS = 700;               // positioned right this long → "now I can see you"
const READY_FLASH_MS = 2500;
const DANGER_VOICE_EVERY_MS = 6000;
const ACCURACY_EVERY_MS = 1000;
const COACH_VOICE_GAP_MS = 8000;           // a coaching explanation never follows another / a danger alert within this
const UNSURE_NOTICE_MS = 2000;             // low confidence this long → show / say what to fix
const START_PROMPT_AFTER_MS = 1500;        // positioned but not in the start position this long → prompt
const START_PROMPT_REPEAT_MS = 7000;

/**
 * The execution profile of an exercise for this trainee: exercise profile → personalized
 * (scanned ranges) → layered with the sport contexts. Shared by the live evaluation and the
 * demo Ghost shown before the exercise, so both are exactly the same profile.
 */
export function buildExecutionProfile(cueKey, exerciseName, limbProfile, sportContexts, catalogId = null) {
  if (!cueKey && !catalogId) return null;
  const ctx = sportContexts?.length ? sportContexts : ['fitness'];
  // A catalog exercise carries its exact pattern + variation profile (tempo / range / side)
  const base = (catalogId && variationProfile(catalogId)) || getExerciseProfile(cueKey, exerciseName);
  // crutch cues only to a trainee who really trains on crutches today (a prosthesis user: the support-leg version)
  return applySportContext(personalizeProfile(base, limbProfile || {}), ctx, { crutches: !!limbProfile?.crutches });
}

export function useExpertExecution({
  enabled, counting = false, quiet = false, cueKey, exerciseName, catalogId = null, sportContexts, limbProfile, landmarksRef,
  isHe, playerName = '', speakPriority, recordClips = false, onClips,
  brainEnabled = false, effortRef = null, onStrikeSide = null, captureFrameRef = null, bodyFrameRef = null, keyPoints = null,
}) {
  const keyPointsRef = useRef(keyPoints);
  keyPointsRef.current = keyPoints;
  const onStrikeSideRef = useRef(onStrikeSide);
  onStrikeSideRef.current = onStrikeSide;
  const [failed, setFailed] = useState(false);
  const contextsKey = (sportContexts || []).join('+');
  const profile = useMemo(
    () => (enabled ? buildExecutionProfile(cueKey, exerciseName, limbProfile, contextsKey ? contextsKey.split('+') : null, catalogId) : null),
    [enabled, cueKey, exerciseName, catalogId, contextsKey, limbProfile],
  );
  const active = !!profile && !failed;

  const inViewRef = useRef(true);            // open by default: an inactive module never blocks anything
  const startReadyRef = useRef(true);        // the start gate (open by default when inactive)
  const countOpenRef = useRef(true);         // counting allowed: the start position was reached + positioned now
  const repCountRef = useRef(0);             // real reps of this set (profile-based)
  const workingRef = useRef(true);           // the trainee is working right now (timed exercises)
  const countingRef = useRef(counting);
  countingRef.current = counting;
  const quietRef = useRef(quiet);
  quietRef.current = quiet;
  const earlyRef = useRef(false);            // real work seen (rep / kick / strides) — start now
  const strikeCountRef = useRef(0);          // kicks seen while counting (legacy-counted exercises)
  const nameRef = useRef(playerName);
  nameRef.current = playerName;
  const statsRef = useRef({ dangers: 0, errors: {} });
  const setLogRef = useRef(null);            // the current set's measured log (the rest's debrief)
  const restNotesRef = useRef([]);           // the brain's notes kept for the rest's analysis (never said in the set)
  const lastRepCleanRef = useRef(null);      // the last counted kick / pass was measured clean (the ball's "Nice!")
  const brainRef = useRef(null);             // the coach brain of this exercise (Layers 1–4)
  const brainOnRef = useRef(brainEnabled);
  brainOnRef.current = brainEnabled;
  const effortSrcRef = useRef(effortRef);
  effortSrcRef.current = effortRef;
  const [missingPart, setMissingPart] = useState(null);
  const [issue, setIssue] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  // the set's REAL accuracy: the mean over the reps actually counted (null = no rep yet → "—")
  const [repAccuracy, setRepAccuracy] = useState(null);
  const [cadence, setCadence] = useState(null);
  const [unsure, setUnsure] = useState(null);   // null | 'view' | 'tracking' — measurement not reliable
  const [setup, setSetup] = useState(null);     // positioning fix { code, he, en } or null
  const [readyFlash, setReadyFlash] = useState(null);   // READY message shown briefly
  const [startPrompt, setStartPrompt] = useState(false); // positioned, but not in the start position

  // Latest callbacks without restarting the loop; silent while `quiet` (the coach is explaining)
  const speakRef = useRef(speakPriority);
  speakRef.current = (...args) => { if (!quietRef.current) speakPriority?.(...args); };
  const speakAlwaysRef = useRef(speakPriority);       // safety (danger) is never silenced
  speakAlwaysRef.current = speakPriority;
  const isHeRef = useRef(isHe);
  isHeRef.current = isHe;
  const onClipsRef = useRef(onClips);
  onClipsRef.current = onClips;

  useEffect(() => {
    if (!active) {
      inViewRef.current = true;
      startReadyRef.current = true;
      countOpenRef.current = true;
      workingRef.current = true;
      setStartPrompt(false);
      setMissingPart(null); setIssue(null); setAccuracy(null); setCadence(null); setUnsure(null);
      setSetup(null); setReadyFlash(null);
      return undefined;
    }
    const tracker = createExecutionTracker(profile, limbProfile || {});
    tracker.requireTilt = true;                // the live camera: no "don't lean" verdict before its tilt is calibrated
    setLogRef.current = tracker.log;
    inViewRef.current = false;
    startReadyRef.current = false;
    repCountRef.current = 0;
    strikeCountRef.current = 0;
    earlyRef.current = false;
    const gate = createStartGate();
    const feetHist = [];                       // the feet's positions (the ready stance of a kick / pass)
    let lastStance = null;
    let lastStillAt = -1e9;                    // when the feet were last still (the opening pass needs it)
    let startedOnce = false;                   // no rep counts before the trainee first reached the start position
    countOpenRef.current = false;
    let tiltCalibrated = false;
    const tiltSamples = [];
    const work = {};
    let wasCounting = countingRef.current;
    let notStartSince = null; let startSpokenAt = 0; let lastStartPrompt = false;
    let driveK = Math.floor(Math.random() * 6);
    // reps: a full rest → peak → rest cycle; kicks / passes: a real strike (hip → knee chain) — both only
    // in view and measured reliably (honest counting: no strike, no count)
    const countsReps = profile.precision === 'expert' && (profile.kind === 'reps' || profile.kind === 'strike');
    statsRef.current = { dangers: 0, errors: {}, coached: [] };
    let lastMissing; let lastIssueId; let lastDanger = 0; let lastAccuracyAt = 0; let lastVoice = 0;
    let lastCadence = null;
    let unsureSince = null; let lastUnsure = null;
    // Positioning state
    let setupCode = null; let setupSince = 0; let spokenCode = null; let spokenAt = 0;
    let problemSince = null; let okSince = null; let shownCode = null; let shownSetup = null;
    const spokenByCode = {}; let hadProblemShown = false; let lastReadyAt = -1e9; let lastSetupSpokenAt = -1e9; let setupRepeats = 0;
    let hintSince = null;
    let readySince = null; let announcedReady = false; let everReady = false; let flashUntil = 0;
    const recorder = recordClips ? createClipRecorder(profile) : null;
    const brain = brainOnRef.current ? createCoachBrain({ profile, exerciseName, savedPolicy: loadPolicy() }) : null;
    // KINETIC COUNTING (IRON RULE): every count also needs the movement's kinetic evidence in space
    // (range out-and-back + velocity + the end point's trajectory + one flowing movement)
    const kinetic = createRepEvidence(evidenceGroupFor({ profile, cueKey }));   // a kick: only the legs prove it
    // each counted rep's accuracy (the profile's measure at that rep, an error in it = lower)
    const repScores = [];
    // HONEST accuracy (owner, 2026-10-20: "100%" on a set nothing was judged in): a rep counts toward the
    // accuracy only if something was really JUDGED in it (a measured rule, or the vision model's verdict)
    let judgedBefore = 0;
    const repVerdicts = [];                     // per counted rep: { judged, error }
    const refreshAccuracy = () => {
      const j = repVerdicts.filter(v => v.judged);
      setRepAccuracy(j.length ? Math.round(j.reduce((s, v) => s + (v.error ? 50 : 100), 0) / j.length) : null);
    };
    const noteRepScore = (res) => {
      const judgedNow = logJudgedCount(tracker.log);
      const judged = judgedNow > judgedBefore || profile.kind !== 'strike';
      judgedBefore = judgedNow;
      if (profile.kind !== 'strike') {
        repVerdicts.push({ judged: true, error: (res.issues || []).some(i => i.severity === 'error' || i.severity === 'danger') });
        const a = typeof res.accuracy === 'number' ? res.accuracy : null;
        if (a === null) return;
        repScores.push((res.issues || []).length ? Math.min(a, 60) : a);
        setRepAccuracy(Math.round(repScores.reduce((x, y) => x + y, 0) / repScores.length));
        return;
      }
      repVerdicts.push({ judged, error: judged && (res.issues || []).some(i => i.severity === 'error' || i.severity === 'danger') });
      refreshAccuracy();
    };
    const restOnly = restOnlyFeedback(profile);
    let lastCountAt = -1e9; const strikeTimes = []; let floodUntil = -1e9;
    // the EYES: one frame at the contact of a counted pass → the vision model's verdict (contact surface,
    // ankle lock, …) → the set log, the accuracy and a live cue (confident findings only)
    // THE WHOLE-BODY EYES (owner, 2026-10-20): at each counted rep (a hold: every few seconds) the coach LOOKS —
    // the full raw camera frame (+ a legs close-up in a kick / pass) → a vision model reports what stops a correct
    // execution anywhere in the body (posture, arms, trunk, head, balance, legs, feet) with severity + confidence.
    // Confident findings (≥ VISION_CONFIDENCE): a MAJOR one is said at once, every time; a minor one is forgiven once
    // and said when it comes back; ALL go into the set log → the rest's full analysis. Rest-only drills: logged only.
    let visionBusy = false; let lastLookAt = -1e9; const visOcc = {}; const visCoached = {};
    let cleanStreak = 0; let lastPraiseAt = -1e9;
    const visionRule = (f) => ({
      id: `vis_${f.code}`, severity: 'error', major: f.severity === 'major', vision: true,
      msg: { he: f.what, en: f.what }, why: f.why ? { he: f.why, en: f.why } : null, how: f.how ? { he: f.how, en: f.how } : null, cue: { he: f.cue, en: f.cue },
    });
    const lookAtRep = (repIdx, side) => {
      const now0 = performance.now();
      if (visionBusy || now0 - lastLookAt < 2000) return;
      const frame = bodyFrameRef?.current?.();
      if (!frame) return;
      const isPass = profile.id === 'shadowPass';
      const legsFrame = profile.kind === 'strike' ? captureFrameRef?.current?.() : null;
      visionBusy = true; lastLookAt = now0;
      const he0 = isHeRef.current;
      aiBodyVision({ frame, legsFrame, isPass, lang: he0 ? 'he' : 'en', side, exercise: exerciseName, sport: contextsKey,
        body: bodyText(limbProfile || {}), keyPoints: keyPointsRef.current || [], name: nameRef.current }).then((v) => {
        visionBusy = false;
        if (disposed || !v) return;
        // the pass's own rules from the contact surface / the ankle (as before)
        const hits = isPass ? visionRuleHits(v, profile) : [];
        for (const h of hits) logRule(tracker.log, h.rule, h.violated, null);
        // a MAJOR finding needs high confidence (said at once); a minor one 0.6 — and it is said only when it comes
        // back (the repetition confirms it, a one-off reading never speaks)
        const found = (v.findings || []).filter(f => f.confidence >= (f.severity === 'major' ? VISION_CONFIDENCE : VISION_MINOR_CONFIDENCE));
        for (const f of found) logRule(tracker.log, visionRule(f), true, null);
        const goods = (v.good || []).filter(g => g.confidence >= VISION_GOOD_CONFIDENCE);
        const judged = hits.length > 0 || found.length > 0 || goods.length > 0;
        judgedBefore = logJudgedCount(tracker.log);
        const rec = repVerdicts[repIdx];
        const anyBad = hits.some(h => h.violated) || found.length > 0;
        if (rec && judged) { rec.judged = true; rec.error = rec.error || anyBad; refreshAccuracy(); }
        console.info(`[Vision] rep #${repIdx + 1}: ${found.map(f => `${f.severity}:${f.code}(${f.confidence})`).join(', ') || 'no finding'} | good: ${goods.map(g => g.text).join(' / ') || '-'}`);
        if (restOnly || !countingRef.current || performance.now() < floodUntil) return;
        // what to SAY now: the pass's own rule first, then the most important vision finding — the policy decides
        const passBad = hits.find(h => h.violated);
        if (passBad) { sayCorrection({ ...passBad.rule, side }, liveCue(passBad.rule, he0), 1.1, he0); cleanStreak = 0; return; }
        for (const f of found) {
          visOcc[f.code] = (visOcc[f.code] || 0) + 1;
          if (f.severity === 'major' || visCoached[f.code] || visOcc[f.code] >= 2) {
            visCoached[f.code] = true; cleanStreak = 0;
            holdSpeech(estimateSpeechMs(f.cue, 1.1));
            speakRef.current?.(f.cue, { rate: 1.1 });                 // the vision model's own short, specific words
            return;
          }
        }
        // POSITIVE FEEDBACK (owner, 2026-10-20): measured-good reps earn a genuine, specific praise — sparingly
        if (!anyBad && judged) cleanStreak += 1; else if (anyBad) cleanStreak = 0;
        const t = performance.now();
        if (cleanStreak >= 3 && t - lastPraiseAt > 20000 && goods.length) {
          lastPraiseAt = t; cleanStreak = 0;
          sayLine('praise', goods[0].text, 1.1, he0);
        }
      });
    };
    // a HOLD (a plank, a wall sit): the coach looks every few seconds of the hold
    let lastHoldLook = -1e9;
    brainRef.current = brain;
    // THE COACH'S WORDS BY THE AI (owner, 2026-10-19): a correction is worded by the AI coach from the
    // measured facts (the value, the side, the rep, how often); the device's own measured line only when
    // the AI is late / unreachable. One cue at a time; never after the set ended; never the same words twice
    let disposed = false; let cueInFlight = false;
    const recentCues = [];
    const sayCorrection = (rule, localText, rate, he, tone = null) => {
      const local = () => { holdSpeech(estimateSpeechMs(localText, rate)); speakRef.current?.(localText, { rate }); recentCues.push(localText); };
      if (!rule || cueInFlight) { local(); return; }
      cueInFlight = true;
      const facts = cueFacts({
        rule, profile, lp: limbProfile || {}, exercise: exerciseName, sport: contextsKey,
        name: nameRef.current, he, rep: repCountRef.current || null, times: tracker.log?.rules?.[rule.id]?.n ?? null, recent: recentCues,
      });
      if (tone) facts.tone = tone;
      aiCue(facts).then((ai) => {
        cueInFlight = false;
        if (disposed || !countingRef.current) return;
        const text = ai || localText;
        recentCues.push(text);
        if (recentCues.length > 8) recentCues.shift();
        holdSpeech(estimateSpeechMs(text, rate));
        speakRef.current?.(text, { rate });
      });
    };
    // positioning / start / ready lines are worded by the AI too (the device decides WHAT; the line is
    // the AI's); the device's own line only when the AI is late — one line at a time
    let lineInFlight = false;
    const recentLines = [];
    const sayLine = (mode, localText, rate, he) => {
      if (lineInFlight) return;
      lineInFlight = true;
      aiLine({
        mode, lang: he ? 'he' : 'en', name: nameRef.current, exercise: exerciseName, sport: contextsKey,
        body: bodyText(limbProfile || {}), error: { what: localText }, recent: recentLines,
      }).then((ai) => {
        lineInFlight = false;
        if (disposed) return;
        const text = ai || localText;
        recentLines.push(text); if (recentLines.length > 6) recentLines.shift();
        holdSpeech(estimateSpeechMs(text, rate));
        speakRef.current?.(text, { rate });
      });
    };
    setIssue(null); setAccuracy(null); setCadence(null); setUnsure(null); setSetup(null); setReadyFlash(null);

    const id = setInterval(() => {
      try {
        const now = performance.now();
        const lm = landmarksRef?.current || null;
        const r = updateExecution(tracker, lm, now);
        inViewRef.current = r.inView;
        if (recorder) recordFrame(recorder, lm, r, now);
        if (brain) brainFrame(brain, lm, now);
        evidenceFrame(kinetic, lm, now);

        // (dev only — the local harness traces why positioning / the start gate decide what they decide; stripped in production)
        if (import.meta.env.DEV && lm) {
          const tr0 = (window.__execTrace ||= []);
          if (!tr0.length || now - tr0[tr0.length - 1].now > 200) {
            const v = (i) => (lm[i] ? [Math.round(lm[i].y * 100) / 100, Math.round((lm[i].visibility ?? 0) * 100) / 100] : null);
            tr0.push({ now: Math.round(now), inView: r.inView, setup: r.setup?.code || null, hint: r.hint?.code || null, missing: r.missing,
              conf: r.quality?.confident, reason: r.quality?.reason || null, ankL: v(27), ankR: v(28), kneeL: v(25), kneeR: v(26), nose: v(0),
              inStart: null, stance: lastStance, fl: feetHist.length ? [feetHist[feetHist.length-1].l && Math.round(feetHist[feetHist.length-1].l.y*100), feetHist[feetHist.length-1].r && Math.round(feetHist[feetHist.length-1].r.y*100)] : null, gate: startReadyRef.current, knee: r.metrics?.knee != null ? Math.round(r.metrics.knee) : null, kL: Math.round(jointAngleSide(lm, 'knee', 'left') ?? -1), kR: Math.round(jointAngleSide(lm, 'knee', 'right') ?? -1), lean: Math.round(tracker.leanRaw ?? -1) });
          }
        }
        // ---- Start gate: positioned + reliable + in the START POSITION, held ----
        let stance = null;
        if (profile.kind === 'strike') {
          const foot = (i) => (lm?.[i] && (lm[i].visibility ?? 0) >= 0.4 ? { x: lm[i].x, y: lm[i].y } : null);
          feetHist.push({ t: now, l: foot(27), r: foot(28), torso: lm ? torsoLength(lm) : null });
          while (feetHist.length && now - feetHist[0].t > 1500) feetHist.shift();
          // standing: the hips above the knees on a side that is seen (never crouched / sitting)
          const stand = lm && [[23, 25], [24, 26]].some(([h, k]) => lm[h] && lm[k] && (lm[k].visibility ?? 0) >= 0.4 && lm[h].y < lm[k].y);
          stance = { still: feetStill(feetHist, now), standing: !!stand };
          lastStance = stance;
          if (stance.still) lastStillAt = now;
        }
        const inStart = r.inView && isStartPosition(profile, r.metrics, stance);
        startReadyRef.current = updateStartGate(gate, { positioned: r.inView, confident: r.quality?.confident, inStart }, now);
        if (startReadyRef.current) startedOnce = true;
        // a coach starts when you START: a real kick / pass IN PLACE (one leg, the pelvis still, with its
        // kinetic evidence) while seen clearly opens the exercise at once — and that kick counts
        if (!startedOnce && profile.kind === 'strike' && r.inView && !r.setup && r.quality?.confident !== false
          && openingKickAllowed(lastStillAt, now)
          && r.events.some(ev => ev.type === 'strike') && evidenceOk(kinetic, now, { strike: true, kick: true })) {
          startedOnce = true;
        }
        // walking in / out of the picture, adjusting the camera: nothing counts (the positioning card is up)
        countOpenRef.current = startedOnce && !r.setup && r.inView;
        // movement before / outside never carries into a rep — except a kick drill BEFORE its first start: the
        // first real pass must be able to prove itself (kickInPlace still rejects walking in / adjusting)
        if (!countOpenRef.current && (startedOnce || profile.kind !== 'strike' || r.setup || !r.inView)) evidenceAccept(kinetic, now);
        // the camera's tilt (a laptop on a desk), measured ONCE on the trainee upright and STILL in the
        // start position: the median of a stable ~1.5 s stretch (a lean / a glitch never calibrates it)
        if (!tiltCalibrated) {
          // (the start gate — or, in a kick / pass, the trainee standing still at the ball: the exercise may
          // start on the first pass, the camera is still calibrated from the quiet standing moments)
          if ((startReadyRef.current || (stance?.still && stance.standing)) && typeof tracker.leanRaw === 'number') {
            tiltSamples.push(tracker.leanRaw);
            if (tiltSamples.length > 60) tiltSamples.shift();
            if (stableUpright(tiltSamples)) { calibrateUpright(tracker, tiltSamples.slice(-30)); tiltCalibrated = true; }
          } else tiltSamples.length = 0;
        }
        workingRef.current = updateWork(work, profile, r, now);

        // ---- Exact rep counting (a new set starts from zero) ----
        if (countingRef.current && !wasCounting) { restNotesRef.current = []; repVerdicts.length = 0; judgedBefore = 0; lastCountAt = -1e9; floodUntil = -1e9; setLogRef.current = resetSetLog(tracker); repCountRef.current = 0; strikeCountRef.current = 0; earlyRef.current = false; repScores.length = 0; setRepAccuracy(null); }
        wasCounting = countingRef.current;
        if (countingRef.current && r.inView && countOpenRef.current) {
          for (const ev of r.events) {
            // the coach brain learns from every real attempt and the errors seen in it
            if (brain && (ev.type === 'rep' || ev.type === 'strike' || ev.type === 'partialRep')) {
              brainAttempt(brain, ev, { now, accuracy: r.accuracy, errorIds: (r.issues || []).map(i => i.id) });
            }
            // a rep counts only when it was measured RELIABLY (anti-ghost counting) — like a strike
            if (countsReps && profile.kind === 'reps' && isValidRep(ev) && r.quality?.confident !== false && evidenceOk(kinetic, now)) {
              evidenceAccept(kinetic, now); repCountRef.current += 1; earlyRef.current = true;
              noteRepScore(r);
              lookAtRep(repVerdicts.length ? repVerdicts.length - 1 : 0, null);
            }
            // the reason of every detected kick, in the console (the owner's videos show exactly why it did or did not count)
            if (ev.type === 'strike' && profile.kind === 'strike') {
              strikeTimes.push(now); while (strikeTimes.length && now - strikeTimes[0] > FLOOD_MS) strikeTimes.shift();
              if (strikeTimes.length >= FLOOD_N) floodUntil = now + FLOOD_CALM_MS;
              const why = explainStrike(kinetic, now);
              const counts = countsReps && r.quality?.confident !== false && evidenceOk(kinetic, now, { strike: true, kick: true })
                && now - lastCountAt >= COUNT_LOCK_MS && now >= floodUntil;
              // the EXACT reason (never a guess): walking toward / away (the shoulders' width), walking across (the
              // pelvis travel), both legs moving, a too-small swing (range / speed / path), too soon, unsure tracking
              const P = why.place, S = why.swing;
              const reason = now - lastCountAt < COUNT_LOCK_MS ? `locked — ${Math.round(now - lastCountAt)} ms after the last count (one pass = one count)`
                : now < floodUntil ? `flood — ${strikeTimes.length} kicks in ${FLOOD_MS / 1000} s: wild pace, not counted`
                : counts ? 'ok'
                : !P.ok ? (P.reason === 'walk-depth' ? `walking toward/away — shoulders width changed ${Math.round((P.widthChange || 0) * 100)}% (max ${Math.round(KICK_MAX_WIDTH_CHANGE * 100)}%)`
                  : P.reason === 'walk-across' ? `walking across — pelvis moved ${P.travel} torso (max ${KICK_MAX_TRAVEL})`
                  : `support foot not planted — moved ${P.anchor} torso (max ${KICK_ANCHOR_MAX}), kicking foot path ${P.kick}`)
                : !S.ok ? `swing too small — range ${S.range}° (min ${STRIKE_MIN_RANGE}), speed ${S.peakVel}°/s (min ${STRIKE_MIN_VEL}), path ${S.path} (min ${STRIKE_MIN_PATH})`
                : why.since < 450 ? `too soon after the last count (${why.since} ms)`
                : r.quality?.confident === false ? 'tracking unsure' : 'unknown';
              console.info(`[Kick] ${counts ? 'COUNTED' : 'REJECTED'} | side=${P.side || ev.side} | ${reason} | swing ${S.range}° ${S.peakVel}°/s path ${S.path} | width ${P.widthChange ?? '-'} travel ${P.travel ?? '-'}`);
            }
            // a kick / pass: a real strike, IN PLACE, by ONE leg (walking is never a pass)
            const locked = now - lastCountAt < COUNT_LOCK_MS;
            const flooding = now < floodUntil;
            if (countsReps && profile.kind === 'strike' && ev.type === 'strike' && !locked && !flooding && r.quality?.confident !== false && evidenceOk(kinetic, now, { strike: true, kick: true })) {
              const kickSide = explainStrike(kinetic, now).place.side || ev.side;
              evidenceAccept(kinetic, now); repCountRef.current += 1; strikeCountRef.current += 1; earlyRef.current = true;
              lastCountAt = now;
              noteRepScore(r);
              lastRepCleanRef.current = !(r.issues || []).some(i => i.severity === 'error' || i.severity === 'danger');
              if (kickSide === 'left' || kickSide === 'right') onStrikeSideRef.current?.(kickSide);   // the leg of a REAL counted kick
              lookAtRep(repVerdicts.length - 1, kickSide);
            }
          }
          if (profile.kind === 'cyclic' && workingRef.current) earlyRef.current = true;
          if (profile.kind === 'hold' && r.inView && now - lastHoldLook > 6000) { lastHoldLook = now; repVerdicts.push({ judged: false, error: false }); lookAtRep(repVerdicts.length - 1, null); }
        } else if (profile.kind === 'strike' && r.events.some(ev => ev.type === 'strike')) {
          console.info(`[Kick] not counted: counting closed | set running=${!!countingRef.current} inView=${r.inView} started=${startedOnce} positioning=${r.setup?.code || 'ok'}`);
        }

        // ---- Positioning: one precise instruction at a time, then "now I can see you" ----
        const he = isHeRef.current;
        const code = r.setup?.code || null;
        // the persistence of ANY positioning problem (a change of its kind / a short flicker never restarts it)
        if (code) { okSince = null; if (problemSince === null) problemSince = now; }
        else if (okSince === null) okSince = now;
        if (!code && okSince !== null && now - okSince >= SETUP_CLEAR_MS) { problemSince = null; setupRepeats = 0; }
        const problemSettled = !!code && problemSince !== null && now - problemSince >= SETUP_SETTLE_MS;
        // the card: shown once settled, kept until the positioning is good for SETUP_CLEAR_MS
        const showCode = problemSettled ? code : (shownCode && !(okSince !== null && now - okSince >= SETUP_CLEAR_MS) ? shownCode : null);
        if (showCode !== shownCode) { shownCode = showCode; setSetup(showCode ? r.setup || shownSetup : null); if (showCode) shownSetup = r.setup; }
        if (code) {
          readySince = null;
          announcedReady = false;
          if (problemSettled && !quietRef.current && now - (spokenByCode[code] || -1e9) >= SETUP_REPEAT_MS
            && now - lastSetupSpokenAt >= Math.min(60000, SETUP_ANY_GAP_MS * 2 ** setupRepeats) && now - lastVoice > 4000) {
            spokenByCode[code] = now; spokenCode = code; spokenAt = now; lastVoice = now; hadProblemShown = true; lastSetupSpokenAt = now;
            setupRepeats += 1;                       // not fixed → the next reminder comes later (10 → 20 → 40 → 60 s)
            // the precise instruction only — said once, with authority
            sayLine('setup', he ? r.setup.he : r.setup.en, 1.05, he);
          }
        } else {
          if (readySince === null) readySince = now;
          // "now I can see you" once; "I see you again" only after an instruction was really given, and rarely
          const sayReady = !everReady || (hadProblemShown && now - lastReadyAt >= READY_AGAIN_GAP_MS);
          // (never during a running set: "I can see you again" over the work is noise — the count is the coach's voice)
          if (!announcedReady && !quietRef.current && now - readySince >= READY_SETTLE_MS && (!sayReady || countingRef.current && everReady)) announcedReady = true;
          if (!announcedReady && !quietRef.current && now - readySince >= READY_SETTLE_MS) {
            announcedReady = true;
            hadProblemShown = false; lastReadyAt = now;
            const msg = everReady ? READY_DRIVE.again : READY_DRIVE.first;
            everReady = true;
            spokenCode = null; lastVoice = now;
            flashUntil = now + READY_FLASH_MS;
            setReadyFlash(msg);
            sayLine('ready', he ? msg.he : msg.en, 1.12, he);
          }
        }
        if (flashUntil && now > flashUntil) { flashUntil = 0; setReadyFlash(null); }

        // A small room: a framing fix while everything measured IS in the picture → one tip per session,
        // never during a set, never blocking (the measurement adapts to what the camera sees)
        if (r.hint && !code) { if (hintSince === null) hintSince = now; } else hintSince = null;
        if (!roomTipGiven && hintSince !== null && now - hintSince >= ROOM_TIP_AFTER_MS && !countingRef.current
          && !quietRef.current && now - lastVoice > 4000) {
          roomTipGiven = true; lastVoice = now;
          sayLine('setup', he ? ROOM_TIP.he : ROOM_TIP.en, 1.05, he);
        }

        // Positioned, but not in the start position (before the start / between reps of a hold):
        // tell them to take it, with drive — never "start" before they are in it
        const needStart = !code && r.inView && !inStart && !startReadyRef.current && !countingRef.current;
        if (needStart) { if (notStartSince === null) notStartSince = now; } else notStartSince = null;
        const showStart = notStartSince !== null && now - notStartSince >= START_PROMPT_AFTER_MS;
        if (showStart !== lastStartPrompt) { lastStartPrompt = showStart; setStartPrompt(showStart); }
        if (showStart && !quietRef.current && now - startSpokenAt >= START_PROMPT_REPEAT_MS && now - lastVoice > 2500) {
          startSpokenAt = now; lastVoice = now;
          sayLine('start', startPositionPrompt(driveK++, '', he, profile.kind), 1.12, he);
        }

        // Positioned right but the measurement is momentarily unreliable (tracking glitch)
        const reason = r.inView && r.quality && !r.quality.confident ? r.quality.reason : null;
        if (reason) { if (unsureSince === null) unsureSince = now; } else unsureSince = null;
        const shown = unsureSince !== null && now - unsureSince >= UNSURE_NOTICE_MS ? reason : null;
        if (shown !== lastUnsure) { lastUnsure = shown; setUnsure(shown); }

        if (r.missing !== lastMissing) { lastMissing = r.missing; setMissingPart(r.missing); }
        const top = r.issues[0] || null;
        if ((top?.id || null) !== lastIssueId) {
          lastIssueId = top?.id || null;
          setIssue(top);
          if (top) statsRef.current.errors[top.id] = (statsRef.current.errors[top.id] || 0) + 1;
        }
        if (now - lastAccuracyAt >= ACCURACY_EVERY_MS) {
          lastAccuracyAt = now;
          setAccuracy(r.accuracy);
          const c = r.live?.cadence ?? null;
          if (c !== lastCadence) { lastCadence = c; setCadence(c); }
        }

        if (r.danger && now - lastDanger > DANGER_VOICE_EVERY_MS) {
          lastDanger = now;
          lastVoice = now;
          statsRef.current.dangers += 1;
          speakAlwaysRef.current?.(isHeRef.current ? r.danger.msg.he : r.danger.msg.en, { rate: 1.1 });
        }
        // A repeated technique error: the coach corrects AND explains it, once per exercise. With the
        // coach brain: it is held for the right moment (between attempts) and said in the style that
        // works for this trainee; the brain also forecasts errors, reads intent and adapts to the state
        // corrections only for real attempts: after the start position, during a set (never while walking
        // into place / adjusting the camera)
        const coach = countOpenRef.current && countingRef.current && !restOnly && now >= floodUntil ? r.coaching?.[0] : null;
        if (brain) {
          if (coach && !r.danger) brainOfferCorrection(brain, coach);
          if (!quietRef.current && !r.danger) {
            const say = brainDecide(brain, {
              now, sinceVoiceMs: now - lastVoice, coachSpeaking: !!window.speechSynthesis?.speaking,
              effort: effortSrcRef.current?.current ?? null, he, name: nameRef.current,
            });
            // the brain's fixed long lines (an intent mismatch / a mental cue) are never said over the work — the
            // REST's analysis weaves them in; a rest-only drill gets no live correction at all
            if (say && (say.kind === 'intent' || say.kind === 'mental' || restOnly)) {
              if (say.kind === 'intent' || say.kind === 'mental') { const n = restNotesRef.current; n.push(say.text); if (n.length > 4) n.shift(); }
            } else if (say) {
              lastVoice = now;
              if (say.kind === 'correction') statsRef.current.coached.push(coach?.id || say.kind);
              // a correction is never cut in the middle (field video: the rep count cut it) — the count
              // waits in the queue and plays right after it; a technique line is worded by the AI coach
              if (say.rule && (say.kind === 'correction' || say.kind === 'forecast')) sayCorrection(say.rule, say.text, say.rate, he, say.style === 'calm' ? 'calm' : null);
              else { holdSpeech(estimateSpeechMs(say.text, say.rate)); speakRef.current?.(say.text, { rate: say.rate }); }
            }
          }
          const learned = brainPolicyToSave(brain);
          if (learned) savePolicy(learned);
        } else if (coach && !r.danger && now - lastVoice > COACH_VOICE_GAP_MS) {
          lastVoice = now;
          statsRef.current.coached.push(coach.id);
          // during the set: the short sideline cue, worded by the AI (the full why / how is the rest's debrief)
          sayCorrection(coach, liveCue(coach, he), 1.1, he);
        }
      } catch (err) {
        console.error('[ExpertExecution] disabled after a runtime error — falling back to the previous pipeline:', err);
        clearInterval(id);
        inViewRef.current = true;
        setFailed(true);
      }
    }, TICK_MS);

    return () => {
      disposed = true;
      clearInterval(id);
      inViewRef.current = true;
      startReadyRef.current = true;
      workingRef.current = true;
      // Validation mode: hand the set's clips over for labelling
      if (recorder?.clips.length) onClipsRef.current?.(recorder.clips, profile);
    };
  }, [active, profile, limbProfile, landmarksRef, recordClips, exerciseName]);

  const ghostSpec = useMemo(() => (active && profile?.ghost ? { profile } : null), [active, profile]);

  return {
    active, profile, setLogRef, restNotesRef, lastRepCleanRef, inViewRef, startReadyRef, countOpenRef, repCountRef, workingRef, earlyRef, strikeCountRef, brainRef,
    missingPart, setup, readyFlash, startPrompt, issue, accuracy, repAccuracy, cadence, unsure, ghostSpec, statsRef,
  };
}

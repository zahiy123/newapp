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
// Voice (critical-only policy): positioning (with DRIVE — energy words, rotated, with the name),
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
import { createExecutionTracker, updateExecution } from '../../engine/exercise/profileEvaluator';
import {
  createStartGate, updateStartGate, isStartPosition, isValidRep, updateWork, withDrive, startPositionPrompt, READY_DRIVE,
} from '../../engine/training/coachFlow';
import { createClipRecorder, recordFrame } from '../../engine/validation/clipRecorder';
import { createCoachBrain, brainFrame, brainAttempt, brainOfferCorrection, brainDecide, brainPolicyToSave } from '../../engine/coachBrain/brain';

// The coach brain's learned correction styles, per trainee, on this device
const POLICY_KEY = 'coachPolicy.v1';
const loadPolicy = () => { try { return JSON.parse(localStorage.getItem(POLICY_KEY) || 'null'); } catch { return null; } };
const savePolicy = (p) => { try { localStorage.setItem(POLICY_KEY, JSON.stringify(p)); } catch { /* storage blocked */ } };

const TICK_MS = 50;
const SETUP_SETTLE_MS = 500;               // a positioning fix is spoken once it is stable this long
const SETUP_REPEAT_MS = 7000;              // …and repeated while it is not fixed
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
  return applySportContext(personalizeProfile(base, limbProfile || {}), ctx);
}

export function useExpertExecution({
  enabled, counting = false, quiet = false, cueKey, exerciseName, catalogId = null, sportContexts, limbProfile, landmarksRef,
  isHe, playerName = '', speakPriority, recordClips = false, onClips,
  brainEnabled = false, effortRef = null,
}) {
  const [failed, setFailed] = useState(false);
  const contextsKey = (sportContexts || []).join('+');
  const profile = useMemo(
    () => (enabled ? buildExecutionProfile(cueKey, exerciseName, limbProfile, contextsKey ? contextsKey.split('+') : null, catalogId) : null),
    [enabled, cueKey, exerciseName, catalogId, contextsKey, limbProfile],
  );
  const active = !!profile && !failed;

  const inViewRef = useRef(true);            // open by default: an inactive module never blocks anything
  const startReadyRef = useRef(true);        // the start gate (open by default when inactive)
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
  const brainRef = useRef(null);             // the coach brain of this exercise (Layers 1–4)
  const brainOnRef = useRef(brainEnabled);
  brainOnRef.current = brainEnabled;
  const effortSrcRef = useRef(effortRef);
  effortSrcRef.current = effortRef;
  const [missingPart, setMissingPart] = useState(null);
  const [issue, setIssue] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
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
      workingRef.current = true;
      setStartPrompt(false);
      setMissingPart(null); setIssue(null); setAccuracy(null); setCadence(null); setUnsure(null);
      setSetup(null); setReadyFlash(null);
      return undefined;
    }
    const tracker = createExecutionTracker(profile, limbProfile || {});
    inViewRef.current = false;
    startReadyRef.current = false;
    repCountRef.current = 0;
    strikeCountRef.current = 0;
    earlyRef.current = false;
    const gate = createStartGate();
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
    let readySince = null; let announcedReady = false; let everReady = false; let flashUntil = 0;
    const recorder = recordClips ? createClipRecorder(profile) : null;
    const brain = brainOnRef.current ? createCoachBrain({ profile, exerciseName, savedPolicy: loadPolicy() }) : null;
    brainRef.current = brain;
    setIssue(null); setAccuracy(null); setCadence(null); setUnsure(null); setSetup(null); setReadyFlash(null);

    const id = setInterval(() => {
      try {
        const now = performance.now();
        const lm = landmarksRef?.current || null;
        const r = updateExecution(tracker, lm, now);
        inViewRef.current = r.inView;
        if (recorder) recordFrame(recorder, lm, r, now);
        if (brain) brainFrame(brain, lm, now);

        // ---- Start gate: positioned + reliable + in the START POSITION, held ----
        const inStart = r.inView && isStartPosition(profile, r.metrics);
        startReadyRef.current = updateStartGate(gate, { positioned: r.inView, confident: r.quality?.confident, inStart }, now);
        workingRef.current = updateWork(work, profile, r, now);

        // ---- Exact rep counting (a new set starts from zero) ----
        if (countingRef.current && !wasCounting) { repCountRef.current = 0; strikeCountRef.current = 0; earlyRef.current = false; }
        wasCounting = countingRef.current;
        if (countingRef.current && r.inView) {
          for (const ev of r.events) {
            // the coach brain learns from every real attempt and the errors seen in it
            if (brain && (ev.type === 'rep' || ev.type === 'strike')) {
              brainAttempt(brain, ev, { now, accuracy: r.accuracy, errorIds: (r.issues || []).map(i => i.id) });
            }
            if (countsReps && profile.kind === 'reps' && isValidRep(ev)) { repCountRef.current += 1; earlyRef.current = true; }
            if (countsReps && profile.kind === 'strike' && ev.type === 'strike' && r.quality?.confident !== false) {
              repCountRef.current += 1; strikeCountRef.current += 1; earlyRef.current = true;
            }
          }
          if (profile.kind === 'cyclic' && workingRef.current) earlyRef.current = true;
        }

        // ---- Positioning: one precise instruction at a time, then "now I can see you" ----
        const he = isHeRef.current;
        const code = r.setup?.code || null;
        if (code !== setupCode) { setupCode = code; setupSince = now; setSetup(r.setup || null); }
        if (code) {
          readySince = null;
          announcedReady = false;
          const settled = now - setupSince >= SETUP_SETTLE_MS;
          if (settled && !quietRef.current && (code !== spokenCode || now - spokenAt >= SETUP_REPEAT_MS)) {
            spokenCode = code; spokenAt = now; lastVoice = now;
            // drive + the precise instruction, a different energy line every time
            speakRef.current?.(withDrive(he ? r.setup.he : r.setup.en, driveK++, nameRef.current, he), { rate: 1.12 });
          }
        } else {
          if (readySince === null) readySince = now;
          if (!announcedReady && !quietRef.current && now - readySince >= READY_SETTLE_MS) {
            announcedReady = true;
            const msg = everReady ? READY_DRIVE.again : READY_DRIVE.first;
            everReady = true;
            spokenCode = null; lastVoice = now;
            flashUntil = now + READY_FLASH_MS;
            setReadyFlash(msg);
            speakRef.current?.(he ? msg.he : msg.en, { rate: 1.12 });
          }
        }
        if (flashUntil && now > flashUntil) { flashUntil = 0; setReadyFlash(null); }

        // Positioned, but not in the start position (before the start / between reps of a hold):
        // tell them to take it, with drive — never "start" before they are in it
        const needStart = !code && r.inView && !inStart && !startReadyRef.current && !countingRef.current;
        if (needStart) { if (notStartSince === null) notStartSince = now; } else notStartSince = null;
        const showStart = notStartSince !== null && now - notStartSince >= START_PROMPT_AFTER_MS;
        if (showStart !== lastStartPrompt) { lastStartPrompt = showStart; setStartPrompt(showStart); }
        if (showStart && !quietRef.current && now - startSpokenAt >= START_PROMPT_REPEAT_MS && now - lastVoice > 2500) {
          startSpokenAt = now; lastVoice = now;
          speakRef.current?.(startPositionPrompt(driveK++, nameRef.current, he), { rate: 1.12 });
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
        const coach = r.coaching?.[0];
        if (brain) {
          if (coach && !r.danger) brainOfferCorrection(brain, coach);
          if (!quietRef.current && !r.danger) {
            const say = brainDecide(brain, {
              now, sinceVoiceMs: now - lastVoice, coachSpeaking: !!window.speechSynthesis?.speaking,
              effort: effortSrcRef.current?.current ?? null, he,
            });
            if (say) {
              lastVoice = now;
              if (say.kind === 'correction') statsRef.current.coached.push(coach?.id || say.kind);
              speakRef.current?.(say.text, { rate: say.rate });
            }
          }
          const learned = brainPolicyToSave(brain);
          if (learned) savePolicy(learned);
        } else if (coach && !r.danger && now - lastVoice > COACH_VOICE_GAP_MS) {
          lastVoice = now;
          statsRef.current.coached.push(coach.id);
          const text = `${he ? coach.msg.he : coach.msg.en}. ${coach.why ? (he ? coach.why.he : coach.why.en) : ''}`;
          speakRef.current?.(text, { rate: 1.0 });
        }
      } catch (err) {
        console.error('[ExpertExecution] disabled after a runtime error — falling back to the previous pipeline:', err);
        clearInterval(id);
        inViewRef.current = true;
        setFailed(true);
      }
    }, TICK_MS);

    return () => {
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
    active, profile, inViewRef, startReadyRef, repCountRef, workingRef, earlyRef, strikeCountRef, brainRef,
    missingPart, setup, readyFlash, startPrompt, issue, accuracy, cadence, unsure, ghostSpec, statsRef,
  };
}

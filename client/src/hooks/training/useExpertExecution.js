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
// Voice (critical-only policy): positioning, DANGER alerts, and a technique error that
// repeated COACH_AFTER times in a row is explained ONCE per exercise (correction + why).
// SAFETY: any runtime error disables the module for the session and re-opens the gates,
// so the exercise falls back to the previous pipeline.

import { useEffect, useMemo, useRef, useState } from 'react';
import { getExerciseProfile, personalizeProfile } from '../../engine/exercise/exerciseProfiles';
import { variationProfile } from '../../engine/catalog/catalog';
import { applySportContext } from '../../engine/sports/sportLibrary';
import { createExecutionTracker, updateExecution } from '../../engine/exercise/profileEvaluator';
import { READY } from '../../engine/exercise/setupCoach';
import { createClipRecorder, recordFrame } from '../../engine/validation/clipRecorder';

const TICK_MS = 50;
const SETUP_SETTLE_MS = 500;               // a positioning fix is spoken once it is stable this long
const SETUP_REPEAT_MS = 7000;              // …and repeated while it is not fixed
const READY_SETTLE_MS = 700;               // positioned right this long → "now I can see you"
const READY_FLASH_MS = 2500;
const DANGER_VOICE_EVERY_MS = 6000;
const ACCURACY_EVERY_MS = 1000;
const COACH_VOICE_GAP_MS = 8000;           // a coaching explanation never follows another / a danger alert within this
const UNSURE_NOTICE_MS = 2000;             // low confidence this long → show / say what to fix

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

export function useExpertExecution({ enabled, cueKey, exerciseName, catalogId = null, sportContexts, limbProfile, landmarksRef, isHe, speakPriority, recordClips = false, onClips }) {
  const [failed, setFailed] = useState(false);
  const contextsKey = (sportContexts || []).join('+');
  const profile = useMemo(
    () => (enabled ? buildExecutionProfile(cueKey, exerciseName, limbProfile, contextsKey ? contextsKey.split('+') : null, catalogId) : null),
    [enabled, cueKey, exerciseName, catalogId, contextsKey, limbProfile],
  );
  const active = !!profile && !failed;

  const inViewRef = useRef(true);            // open by default: an inactive module never blocks anything
  const statsRef = useRef({ dangers: 0, errors: {} });
  const [missingPart, setMissingPart] = useState(null);
  const [issue, setIssue] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [cadence, setCadence] = useState(null);
  const [unsure, setUnsure] = useState(null);   // null | 'view' | 'tracking' — measurement not reliable
  const [setup, setSetup] = useState(null);     // positioning fix { code, he, en } or null
  const [readyFlash, setReadyFlash] = useState(null);   // READY message shown briefly

  // Latest callbacks without restarting the loop
  const speakRef = useRef(speakPriority);
  speakRef.current = speakPriority;
  const isHeRef = useRef(isHe);
  isHeRef.current = isHe;
  const onClipsRef = useRef(onClips);
  onClipsRef.current = onClips;

  useEffect(() => {
    if (!active) {
      inViewRef.current = true;
      setMissingPart(null); setIssue(null); setAccuracy(null); setCadence(null); setUnsure(null);
      setSetup(null); setReadyFlash(null);
      return undefined;
    }
    const tracker = createExecutionTracker(profile, limbProfile || {});
    inViewRef.current = false;
    statsRef.current = { dangers: 0, errors: {}, coached: [] };
    let lastMissing; let lastIssueId; let lastDanger = 0; let lastAccuracyAt = 0; let lastVoice = 0;
    let lastCadence = null;
    let unsureSince = null; let lastUnsure = null;
    // Positioning state
    let setupCode = null; let setupSince = 0; let spokenCode = null; let spokenAt = 0;
    let readySince = null; let announcedReady = false; let everReady = false; let flashUntil = 0;
    const recorder = recordClips ? createClipRecorder(profile) : null;
    setIssue(null); setAccuracy(null); setCadence(null); setUnsure(null); setSetup(null); setReadyFlash(null);

    const id = setInterval(() => {
      try {
        const now = performance.now();
        const lm = landmarksRef?.current || null;
        const r = updateExecution(tracker, lm, now);
        inViewRef.current = r.inView;
        if (recorder) recordFrame(recorder, lm, r, now);

        // ---- Positioning: one precise instruction at a time, then "now I can see you" ----
        const he = isHeRef.current;
        const code = r.setup?.code || null;
        if (code !== setupCode) { setupCode = code; setupSince = now; setSetup(r.setup || null); }
        if (code) {
          readySince = null;
          announcedReady = false;
          const settled = now - setupSince >= SETUP_SETTLE_MS;
          if (settled && (code !== spokenCode || now - spokenAt >= SETUP_REPEAT_MS)) {
            spokenCode = code; spokenAt = now; lastVoice = now;
            speakRef.current?.(he ? r.setup.he : r.setup.en, { rate: 1.0 });
          }
        } else {
          if (readySince === null) readySince = now;
          if (!announcedReady && now - readySince >= READY_SETTLE_MS) {
            announcedReady = true;
            const msg = everReady ? READY.again : READY.first;
            everReady = true;
            spokenCode = null; lastVoice = now;
            flashUntil = now + READY_FLASH_MS;
            setReadyFlash(msg);
            speakRef.current?.(he ? msg.he : msg.en, { rate: 1.05 });
          }
        }
        if (flashUntil && now > flashUntil) { flashUntil = 0; setReadyFlash(null); }

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
          speakRef.current?.(isHeRef.current ? r.danger.msg.he : r.danger.msg.en, { rate: 1.1 });
        }
        // A repeated technique error: the coach corrects AND explains it, once per exercise
        const coach = r.coaching?.[0];
        if (coach && !r.danger && now - lastVoice > COACH_VOICE_GAP_MS) {
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
      // Validation mode: hand the set's clips over for labelling
      if (recorder?.clips.length) onClipsRef.current?.(recorder.clips, profile);
    };
  }, [active, profile, limbProfile, landmarksRef, recordClips]);

  const ghostSpec = useMemo(() => (active && profile?.ghost ? { profile } : null), [active, profile]);

  return { active, profile, inViewRef, missingPart, setup, readyFlash, issue, accuracy, cadence, unsure, ghostSpec, statsRef };
}

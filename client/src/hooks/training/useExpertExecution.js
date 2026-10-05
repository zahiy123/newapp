// useExpertExecution — runs the current exercise against its Expert Execution Profile (Stage 3.1)
//
// Isolated module behind FEATURES.EXPERT_PROFILE. Reads the RAW pose landmarks at 20 Hz
// (landmarksRef, no React-state throttling) and exposes:
//   inViewRef   — false while the exercise's required limbs are out of the frame; the exercise
//                 page blocks rep counting and nudges while it is false
//   missingPart — which body part to bring into the frame (UI + voice prompt)
//   issue       — the most important persisting execution error / danger (UI)
//   accuracy    — % execution accuracy vs. the profile (UI)
//   ghostSpec   — { profile } → the Ghost demonstrates exactly this profile
//   cadence     — live steps/min for gait profiles
// The profile is layered with the trainee's SPORT contexts (sportLibrary): sport-specific rules,
// explanations, emphasis and tempo.
// Voice (critical-only policy): "step into the frame", DANGER alerts, and a technique error that
// repeated COACH_AFTER times in a row is explained ONCE per exercise (correction + why).
// SAFETY: any runtime error disables the module for the session and re-opens the gates,
// so the exercise falls back to the previous pipeline.

import { useEffect, useMemo, useRef, useState } from 'react';
import { getExerciseProfile, personalizeProfile } from '../../engine/exercise/exerciseProfiles';
import { applySportContext } from '../../engine/sports/sportLibrary';
import { createExecutionTracker, updateExecution } from '../../engine/exercise/profileEvaluator';
import { viewPromptText } from '../../engine/training/viewPrompts';

const TICK_MS = 50;
const FIRST_PROMPT_DELAY_MS = 1500;
const VIEW_PROMPT_EVERY_MS = 10000;
const DANGER_VOICE_EVERY_MS = 6000;
const ACCURACY_EVERY_MS = 1000;
const COACH_VOICE_GAP_MS = 8000;           // a coaching explanation never follows another / a danger alert within this

export function useExpertExecution({ enabled, cueKey, exerciseName, sportContexts, limbProfile, landmarksRef, isHe, speakPriority }) {
  const [failed, setFailed] = useState(false);
  const contextsKey = (sportContexts || []).join('+');
  const profile = useMemo(
    () => (enabled && cueKey
      ? applySportContext(personalizeProfile(getExerciseProfile(cueKey, exerciseName), limbProfile || {}), contextsKey ? contextsKey.split('+') : ['fitness'])
      : null),
    [enabled, cueKey, exerciseName, contextsKey, limbProfile],
  );
  const active = !!profile && !failed;

  const inViewRef = useRef(true);            // open by default: an inactive module never blocks anything
  const statsRef = useRef({ dangers: 0, errors: {} });
  const [missingPart, setMissingPart] = useState(null);
  const [issue, setIssue] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [cadence, setCadence] = useState(null);

  // Latest callbacks without restarting the loop
  const speakRef = useRef(speakPriority);
  speakRef.current = speakPriority;
  const isHeRef = useRef(isHe);
  isHeRef.current = isHe;

  useEffect(() => {
    if (!active) {
      inViewRef.current = true;
      setMissingPart(null); setIssue(null); setAccuracy(null); setCadence(null);
      return undefined;
    }
    const tracker = createExecutionTracker(profile, limbProfile || {});
    const startedAt = performance.now();
    inViewRef.current = false;
    statsRef.current = { dangers: 0, errors: {}, coached: [] };
    let lastMissing; let lastIssueId; let lastPrompt = 0; let lastDanger = 0; let lastAccuracyAt = 0; let lastVoice = 0;
    let lastCadence = null;
    setIssue(null); setAccuracy(null); setCadence(null);

    const id = setInterval(() => {
      try {
        const now = performance.now();
        const r = updateExecution(tracker, landmarksRef?.current || null, now);
        inViewRef.current = r.inView;

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

        if (!r.inView && r.missing && now - startedAt > FIRST_PROMPT_DELAY_MS && now - lastPrompt > VIEW_PROMPT_EVERY_MS) {
          lastPrompt = now;
          speakRef.current?.(viewPromptText(r.missing, isHeRef.current), { rate: 1.0 });
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
          const he = isHeRef.current;
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

    return () => { clearInterval(id); inViewRef.current = true; };
  }, [active, profile, limbProfile, landmarksRef]);

  const ghostSpec = useMemo(() => (active && profile?.ghost ? { profile } : null), [active, profile]);

  return { active, profile, inViewRef, missingPart, issue, accuracy, cadence, ghostSpec, statsRef };
}

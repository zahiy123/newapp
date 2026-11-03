// ============================================================
// loadAdaptation — the automatic load adaptation (Stage 4 #3–#5; the owner's rules, 2026-11-03)
//
// PURE. Four rules, in priority order:
//  0. PAIN FIRST — the Pain Traffic Light / safe mode act at once on the exercise and above everything here:
//     a pain-protected exercise is never raised, and pain ≥ 4 in a workout disqualifies it as "easy".
//  1. FATIGUE AT THE START — "tired" / "exhausted" in the start rating (readiness 1–2): a controlled reduction
//     that starts only AFTER the warm-up and the first exercise (both as planned) — for the rest of the workout.
//  2. A REAL QUALITY DROP ACROSS A WHOLE EXERCISE — over its sets (≥ 2) the accuracy falls steadily (never
//     rises by more than the noise) and by ≥ 15 points in total → the NEXT exercises run lighter.
//  3. GRADED PROGRESS — 2 workouts in a row done easily and fully accurately (every exercise completed, every
//     measured accuracy ≥ 90, no pain ≥ 4, no lighter / safe exercise, not started tired) → the next workout
//     runs one small step heavier (+10 % reps, at least +1). The next step needs 2 NEW such workouts at the
//     new level (the step is saved with every workout).
// A workout's reductions are levels, not compounding: level 1 = reps × 0.8 + 15 s rest; level 2 (a second
// reason in the same workout) = reps × 0.65 + 30 s rest. Never below 3 reps / 1 set.
// ============================================================

export const LIGHTER = { 1: { reps: 0.8, rest: 15 }, 2: { reps: 0.65, rest: 30 } };
export const STEP_UP = 0.1;
export const MAX_STEP = 5;
export const DROP_MIN = 15;          // points of accuracy lost over the exercise
export const DROP_NOISE = 3;         // a set may rise this much and the fall still counts as steady
export const EASY_ACCURACY = 90;
export const MIN_REPS = 3;

const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const keepType = (orig, n) => (typeof orig === 'string' ? String(n) : n);

/** Rule 1: did the trainee start tired? */
export const startedTired = (readiness) => readiness >= 1 && readiness <= 2;

/** Rule 2: a steady, significant drop of accuracy across the exercise's sets. */
export function qualityDropped(sets) {
  const acc = (sets || []).map(s => s?.accuracy).filter(a => typeof a === 'number');
  if (acc.length < 2) return false;
  for (let i = 1; i < acc.length; i++) if (acc[i] > acc[i - 1] + DROP_NOISE) return false;
  return acc[0] - acc[acc.length - 1] >= DROP_MIN;
}

/** One exercise at a lighter level (never the pain light's own numbers — those act separately, on top). */
export function lighterExercise(ex, level) {
  const l = LIGHTER[Math.min(2, Math.max(1, level))];
  const r = num(ex?.reps);
  const out = { ...ex, autoLighter: { level: Math.min(2, level) } };
  if (r != null) out.reps = keepType(ex.reps, Math.min(r, Math.max(MIN_REPS, Math.round(r * l.reps))));
  out.restSeconds = (num(ex?.restSeconds) || 60) + l.rest;
  return out;
}

/**
 * The workout's exercises after a lighter level from `fromIdx` on (the earlier ones untouched). The level of an
 * exercise is raised, never compounded: an exercise already at level 1 goes to 2 from its ORIGINAL numbers.
 */
export function lighterFrom(exercises, fromIdx, level, reason = null) {
  return (exercises || []).map((ex, i) => {
    if (i < fromIdx) return ex;
    const base = ex.autoLighter?.base || ex;
    const cur = ex.autoLighter?.level || 0;
    if (cur >= level) return ex;
    const out = lighterExercise(base, level);
    out.autoLighter = { level, reason: reason || ex.autoLighter?.reason || null, base: { ...base, autoLighter: undefined } };
    if (ex.painProtected) out.painProtected = ex.painProtected;
    return out;
  });
}

/** Rule 3: was this workout easy and fully accurate? */
export function easyWorkout(w) {
  if (!w || w.dataVersion < 2 || w.status !== 'completed') return false;
  if (startedTired(Number(w.readiness) || 0)) return false;
  if ((w.painReports || []).some(p => Number(p?.level) >= 4)) return false;
  const ex = w.exercises || [];
  if (!ex.length) return false;
  for (const e of ex) {
    if ((e.sets || []).some(s => s.safeMode || s.lighter)) return false;
    if (num(e.setsTarget) != null && (Number(e.setsCompleted) || 0) < num(e.setsTarget)) return false;
    if (num(e.repsTarget) != null && (Number(e.repsActual) || 0) < num(e.repsTarget)) return false;
    if (typeof e.accuracy === 'number' && e.accuracy < EASY_ACCURACY) return false;
  }
  return ex.some(e => typeof e.accuracy === 'number');        // at least one exercise really measured
}

/**
 * Rule 3: today's load step from the history (newest LAST). The step of the last workout carries on; it rises
 * by one when the last 2 workouts were both done at that step and both easy + fully accurate.
 * @returns {{ step, raised: boolean }}
 */
export function decideLoadStep(history) {
  const ws = (history || []).filter(w => w && w.dataVersion >= 2);
  const last = ws[ws.length - 1];
  const step = Number(last?.loadStep) || 0;
  if (ws.length < 2) return { step, raised: false };
  const pair = ws.slice(-2);
  const sameStep = pair.every(w => (Number(w.loadStep) || 0) === step);
  if (sameStep && pair.every(easyWorkout) && step < MAX_STEP) return { step: step + 1, raised: true };
  return { step, raised: false };
}

/** Today's exercises at the load step (+10 % reps per step, at least +1 per step); a pain-protected one is never raised. */
export function applyLoadStep(exercises, step) {
  if (!(step > 0)) return exercises;
  return (exercises || []).map((ex) => {
    if (ex.painProtected || ex.loadStep) return ex;
    const r = num(ex.reps);
    if (r == null) return ex;
    const up = Math.max(step, Math.round(r * STEP_UP * step));
    return { ...ex, reps: keepType(ex.reps, r + up), loadStep: step };
  });
}

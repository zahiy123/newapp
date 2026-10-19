// ============================================================
// brain — the COACH BRAIN: the four cognitive / behavioral layers on top of the kinematic analysis
// (owner, 2026-10-14: "a real coach for every sport")
//
// PURE. Fed by the expert module (useExpertExecution) every tick and on every attempt (a rep, a
// kick), it decides the ONE thing the coach says next — or nothing:
//   1. Behavioral AI   (behavior.js) — fatigue / frustration / readiness → pace, rest, a mental cue
//   2. Intent          (intent.js)   — a kick's intent over its frames; an error forecast BEFORE it repeats
//   3. RLEF            (policy.js)   — the expert way + learned style for each correction, with timing
//   4. Voice prosody   (prosody.js, via the effort number) — the audible effort feeds 1 and 3
// Order of priority (expert): a danger is handled before the brain (never delayed); then a
// correction of a repeated error; then an intent mismatch; then a forecast cue; then a mental cue.
// Honesty: the brain never praises — it corrects, forecasts, calms or adapts the pace.
// ============================================================

import { createBehavior, behaviorAttempt, behaviorState, behaviorAdaptation, behaviorCueAnswered, behaviorCueUnanswered } from './behavior.js';
import { createIntentWindow, intentFrame, intentStrike, intentResolve, drillIntent, intentFeedback, createForecast, forecastAttempt, forecastNext } from './intent.js';
import { createPolicy, situationOf, chooseStyle, timingOk, renderCorrection, policyGiven, policyAttempt, policySnapshot } from './policy.js';

// External-focus cues (attention on the effect / the environment, not the body part — the way expert
// coaches cue), by the measure a rule judges
export const EXTERNAL_CUES = Object.freeze({
  knee: { he: 'דחוף את הרצפה ממך, כאילו אתה מרחיק אותה', en: 'Push the floor away from you' },
  trunkLean: { he: 'החזה מסתכל על הקיר שמולך', en: 'Show your chest to the wall in front of you' },
  hip: { he: 'שלח את הירכיים אחורה אל כיסא דמיוני', en: 'Send your hips back to an imaginary chair' },
  shoulder: { he: 'דחוף את הידיים אל התקרה', en: 'Push your hands toward the ceiling' },
  elbow: { he: 'קרב את כפות הידיים אל הכתפיים', en: 'Bring your palms to your shoulders' },
  bodyLine: { he: 'גוף ישר כמו קרש, מהראש ועד העקבים', en: 'A straight plank from head to heels' },
  absorptionDeg: { he: 'נחת שקט, כמו על רצפה של זכוכית', en: 'Land quietly, as on a glass floor' },
  chainLeadMs: { he: 'הירך מושכת ראשונה, הרגל מצליפה אחריה כמו שוט', en: 'The hip pulls first, the leg whips after it' },
  balance: { he: 'רגל העמידה ננעצת ברצפה ליד הכדור', en: 'Plant the standing foot into the floor beside the ball' },
  swayRatio: { he: 'הראש שקט, כאילו הוא נושא כוס מים', en: 'Keep your head still, as if carrying a glass of water' },
  cadence: { he: 'צעדים קצרים ומהירים, שקטים על הרצפה', en: 'Short, quick, quiet steps' },
  kneeTrack: { he: 'פתח את הרצפה עם הרגליים, כאילו אתה קורע אותה לשניים', en: 'Spread the floor apart with your feet, as if tearing it in two' },
  footOpen: { he: 'פנים כף הרגל פוגש את הכדור כמו מחבט', en: 'The inside of your foot meets the ball like a paddle' },
});

const BETWEEN_MIN_MS = 250, BETWEEN_MAX_MS = 3500;   // "between attempts" = right after an attempt ended
const MENTAL_EVERY_MS = 45000;
const FORECAST_EVERY_ATTEMPTS = 2;

/**
 * A brain for one exercise.
 * @param {{ profile, exerciseName?: string, savedPolicy?: Object }} o
 */
export function createCoachBrain({ profile, exerciseName = '', savedPolicy = null } = {}) {
  return {
    profile,
    rules: indexRules(profile),
    behavior: createBehavior(),
    intentW: createIntentWindow(),
    forecast: createForecast(),
    policy: createPolicy(savedPolicy),
    wanted: profile?.kind === 'strike' ? drillIntent('', `${exerciseName} ${profile?.id || ''}`) : null,
    lastAttemptAt: null, attempts: 0,
    candidate: null,                // a correction waiting for its moment
    intentNote: null,               // an intent mismatch waiting for its moment
    lastForecastId: null, lastForecastAttempt: -99,
    lastMentalAt: -1e9,
    lastIntent: null,
    policyDirty: false,
  };
}

function indexRules(profile) {
  const out = {};
  for (const r of [...(profile?.rules || []), ...(profile?.dynamics || [])]) if (r?.id) out[r.id] = r;
  return out;
}

const withExternal = (rule) => {
  const ext = EXTERNAL_CUES[rule?.metric] || EXTERNAL_CUES[rule?.feature] || null;
  return ext ? { ...rule, external: ext } : rule;
};

/** Every frame: the legs window for the intent layer. */
export function brainFrame(brain, lm, now) {
  if (brain && lm) intentFrame(brain.intentW, lm, now);
  return brain;
}

/** A repeated error the evaluator wants corrected → it waits for the right moment. */
export function brainOfferCorrection(brain, rule) {
  if (!brain || !rule?.id || rule.severity === 'danger') return brain;
  // one correction at a time, the foundation first: a POSITION error (a static rule) before a tempo /
  // flow error (a dynamic rule) — a waiting position correction is never replaced by a finer one
  const rank = (r) => ((brain.profile?.rules || []).some(x => x.id === r.id) ? 1 : 2);
  if (!brain.candidate || rank(rule) <= rank(brain.candidate)) brain.candidate = withExternal(rule);
  return brain;
}

/**
 * One attempt (a rep / a kick) ended.
 * @param {string[]} errorIds - the errors seen in it
 */
export function brainAttempt(brain, ev, { now, accuracy = null, errorIds = [] } = {}) {
  if (!brain || !ev) return brain;
  brain.attempts += 1;
  brain.lastAttemptAt = now;
  const durationMs = ev.type === 'rep' ? (ev.toPeakMs || 0) + (ev.peakHoldMs || 0) + (ev.returnMs || 0) : null;
  behaviorAttempt(brain.behavior, { t: now, ok: errorIds.length === 0, accuracy, durationMs });
  forecastAttempt(brain.forecast, errorIds);
  const outcome = policyAttempt(brain.policy, errorIds);
  if (outcome) {
    brain.policyDirty = true;
    if (outcome.reward) behaviorCueAnswered(brain.behavior); else behaviorCueUnanswered(brain.behavior);
  }
  if (ev.type === 'strike') intentStrike(brain.intentW, ev, now);
  return brain;
}

/** A ball met / missed (the virtual ball) — an attempt for the behavior layer. */
export function brainBall(brain, { now, hit }) {
  if (brain) behaviorAttempt(brain.behavior, { t: now, ok: !!hit });
  return brain;
}

/**
 * What the coach says NOW (or null).
 * @param {{ now, sinceVoiceMs, coachSpeaking?, effort?: number|null, he?: boolean, rnd? }} c
 * @returns {null | { text: string, kind: 'correction'|'intent'|'forecast'|'mental', rate: number }}
 */
export function brainDecide(brain, c) {
  if (!brain) return null;
  const he = c.he !== false;
  // resolve finished kicks (their follow-through is in)
  for (const r of intentResolve(brain.intentW, c.now)) {
    brain.lastIntent = r;
    const fb = intentFeedback(brain.wanted, r);
    if (fb) brain.intentNote = fb;
  }
  // a hold / running has no attempts to wait between: the moment is any quiet moment
  const continuous = brain.profile?.kind === 'hold' || brain.profile?.kind === 'cyclic';
  const between = continuous || brain.lastAttemptAt != null && c.now - brain.lastAttemptAt >= BETWEEN_MIN_MS && c.now - brain.lastAttemptAt <= BETWEEN_MAX_MS;
  if (!timingOk({ sinceVoiceMs: c.sinceVoiceMs, betweenAttempts: between, coachSpeaking: c.coachSpeaking })) return null;
  const state = behaviorState(brain.behavior, c.effort ?? null);
  const situation = situationOf(state);

  if (brain.candidate) {
    const rule = brain.candidate;
    brain.candidate = null;
    // DURING THE SET: a short, warm, immediate cue (the sideline shout) — the full why / how is the rest's
    // debrief. The learned style picks between the cue, an external-focus cue and a calm single cue
    const style0 = chooseStyle(brain.policy, situation, { hasWhy: false, hasExternal: !!rule.external }, c.rnd);
    const style = style0 === 'direct' ? 'cue' : style0;
    policyGiven(brain.policy, { ruleId: rule.id, style: style0, situation });
    brain.cues = (brain.cues || 0) + 1;
    // warm: the trainee's name on every third cue
    const named = c.name && brain.cues % 3 === 1 && style !== 'calm' ? `${c.name}, ` : '';
    return { text: named + renderCorrection(rule, style, he), kind: 'correction', rate: situation === 'frustrated' ? 0.95 : 1.1, style, rule };
  }
  if (brain.intentNote) {
    const n = brain.intentNote;
    brain.intentNote = null;
    return { text: he ? n.he : n.en, kind: 'intent', rate: 1.0 };
  }
  const fid = forecastNext(brain.forecast);
  if (fid && (fid !== brain.lastForecastId || brain.attempts - brain.lastForecastAttempt >= FORECAST_EVERY_ATTEMPTS * 2)
    && brain.attempts - brain.lastForecastAttempt >= FORECAST_EVERY_ATTEMPTS && brain.rules[fid]) {
    brain.lastForecastId = fid; brain.lastForecastAttempt = brain.attempts;
    const rule = withExternal(brain.rules[fid]);
    const cue = rule.external ? (he ? rule.external.he : rule.external.en) : (he ? rule.msg?.he : rule.msg?.en);
    return { text: he ? `בחזרה הבאה — ${cue}` : `Next one — ${cue}`, kind: 'forecast', rate: 1.05, rule };
  }
  if ((state.frustration >= 0.5 || state.fatigue >= 0.5) && c.now - brain.lastMentalAt >= MENTAL_EVERY_MS) {
    const top = topError(brain);
    const ad = behaviorAdaptation(state, top ? { focusHe: top.msg?.he, focusEn: top.msg?.en } : {});
    if (ad.mental) { brain.lastMentalAt = c.now; return { text: he ? ad.mental.he : ad.mental.en, kind: 'mental', rate: 0.95 }; }
  }
  return null;
}

function topError(brain) {
  const counts = {};
  for (const s of brain.forecast.attempts) for (const id of s) counts[id] = (counts[id] || 0) + 1;
  const id = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return id ? brain.rules[id] || null : null;
}

/** The set / exercise summary for the page: the state and the adaptation for the next set. */
export function brainSummary(brain, effort = null) {
  if (!brain) return null;
  const state = behaviorState(brain.behavior, effort);
  const top = topError(brain);
  return { state, adaptation: behaviorAdaptation(state, top ? { focusHe: top.msg?.he, focusEn: top.msg?.en } : {}), lastIntent: brain.lastIntent };
}

/** The learned policy to save for this trainee (or null when unchanged). */
export function brainPolicyToSave(brain) {
  if (!brain?.policyDirty) return null;
  brain.policyDirty = false;
  return policySnapshot(brain.policy);
}

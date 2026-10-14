// ============================================================
// behavior — Layer 1 of the coach brain: BEHAVIORAL AI (owner, 2026-10-14)
//
// PURE. The coach reads the trainee like a real coach does — from what is really MEASURED (never
// guessed): the tempo of the reps, the accuracy trend, a streak of failed attempts / missed balls,
// a correction that did not help, and the audible effort (voice prosody, Layer 4).
//   state:      fatigue 0..1, frustration 0..1, readiness (good + fresh = ready for more)
//   adaptation: the pace of the training NOW (ease / normal / push), extra rest, fewer reps next
//               set, and ONE mental cue (focus, breathing, quality before quantity)
// Honesty rule: a mental cue is never praise for an unverified execution — "push" is offered only
// after a measured good streak.
// ============================================================

const RECENT = 6;                     // the last attempts the state is judged on
const EARLY = 3;                      // the first attempts of the exercise = the trainee's baseline

/** A fresh behavior record for one exercise. */
export function createBehavior() {
  return { attempts: [], cuesUnanswered: 0, lastAt: null, idleMs: 0 };
}

/**
 * One measured attempt (a rep, a kick, a ball met / missed).
 * @param {{ t: number, ok: boolean, accuracy?: number|null, durationMs?: number|null }} a
 *   ok = done right (no error, the ball met); durationMs = how long the rep took
 */
export function behaviorAttempt(b, a) {
  if (!b || !a) return b;
  if (b.lastAt != null) {
    const gap = a.t - b.lastAt;
    if (gap > 6000) b.idleMs += gap - 6000;          // long breaks between attempts = tiring / hesitating
  }
  b.lastAt = a.t;
  b.attempts.push({ t: a.t, ok: !!a.ok, accuracy: typeof a.accuracy === 'number' ? a.accuracy : null, durationMs: a.durationMs ?? null });
  if (b.attempts.length > 60) b.attempts.shift();
  return b;
}

/** A correction was given and the SAME error came back (the coach's cue did not land yet). */
export function behaviorCueUnanswered(b) { if (b) b.cuesUnanswered += 1; return b; }
export function behaviorCueAnswered(b) { if (b) b.cuesUnanswered = Math.max(0, b.cuesUnanswered - 1); return b; }

const mean = (v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * The trainee's state now.
 * @param {number|null} [effort] - the audible effort 0..1 (voice prosody), when measured
 * @returns {{ fatigue: number, frustration: number, readiness: number, signals: string[] }}
 */
export function behaviorState(b, effort = null) {
  const at = b?.attempts || [];
  const signals = [];
  if (at.length < 2) return { fatigue: clamp01((effort ?? 0) - 0.3), frustration: 0, readiness: 0, signals };
  const early = at.slice(0, EARLY), recent = at.slice(-RECENT);

  // ---- fatigue: slower reps, falling accuracy, loud effort, long breaks ----
  let fatigue = 0;
  const d0 = mean(early.map(a => a.durationMs).filter(Number.isFinite));
  const d1 = mean(recent.map(a => a.durationMs).filter(Number.isFinite));
  if (d0 && d1 && at.length > EARLY + 1) {
    const slow = d1 / d0;
    if (slow > 1.2) { fatigue += clamp01((slow - 1.2) / 0.5) * 0.4; signals.push('slowing'); }
  }
  const a0 = mean(early.map(a => a.accuracy).filter(Number.isFinite));
  const a1 = mean(recent.map(a => a.accuracy).filter(Number.isFinite));
  if (a0 != null && a1 != null && at.length > EARLY + 1 && a0 - a1 > 8) {
    fatigue += clamp01((a0 - a1 - 8) / 20) * 0.3; signals.push('accuracyDrop');
  }
  if (typeof effort === 'number' && effort > 0.55) { fatigue += clamp01((effort - 0.55) / 0.35) * 0.3; signals.push('effortHigh'); }
  if (b.idleMs > 8000) { fatigue += 0.15; signals.push('pauses'); }

  // ---- frustration: failing again and again, a cue that does not land ----
  let streak = 0;
  for (let i = at.length - 1; i >= 0 && !at[i].ok; i--) streak += 1;
  let frustration = 0;
  if (streak >= 3) { frustration += clamp01((streak - 2) / 4) * 0.6; signals.push('failStreak'); }
  if (b.cuesUnanswered >= 2) { frustration += 0.3; signals.push('cueNotLanding'); }
  const failRate = recent.filter(a => !a.ok).length / recent.length;
  if (failRate >= 0.67 && recent.length >= 4) frustration += 0.15;

  // ---- readiness: a measured good streak at low effort ----
  const goodRun = recent.length >= 4 && recent.every(a => a.ok) && (a1 == null || a1 >= 80);
  const readiness = goodRun && (effort == null || effort < 0.45) && fatigue < 0.2 ? 0.8 : 0;
  if (readiness) signals.push('goodRun');

  return { fatigue: clamp01(fatigue), frustration: clamp01(frustration), readiness, signals };
}

/**
 * How the training adapts to the state, NOW and for the next set.
 * @param {{ focusHe?: string, focusEn?: string }} [focus] - the one thing to focus on (the top error)
 * @returns {{ pace: 'ease'|'normal'|'push', restBonusSec: number, repsFactor: number, mental: {he,en}|null }}
 */
export function behaviorAdaptation(state, focus = {}) {
  const f = state?.fatigue ?? 0, fr = state?.frustration ?? 0;
  const fHe = focus.focusHe ? ` מתמקדים בדבר אחד: ${focus.focusHe}.` : ' מתמקדים בתנועה אחת נקייה.';
  const fEn = focus.focusEn ? ` One thing only: ${focus.focusEn}.` : ' One clean movement at a time.';
  if (fr >= 0.5) {
    return {
      pace: 'ease', restBonusSec: 20, repsFactor: 0.8,
      mental: {
        he: `עצור שנייה. נשימה עמוקה פנימה, ולאט החוצה.${fHe} איכות לפני כמות — זה בדיוק השלב שבו לומדים.`,
        en: `Stop for a second. Deep breath in, slowly out.${fEn} Quality before quantity — this is exactly where you learn.`,
      },
    };
  }
  if (f >= 0.5) {
    return {
      pace: 'ease', restBonusSec: 30, repsFactor: 0.8,
      mental: {
        he: 'אני רואה שהגוף מתעייף — מורידים קצב ושומרים על טכניקה. כל חזרה נקייה שווה יותר משלוש מהירות.',
        en: 'I can see your body getting tired — we slow down and keep the technique. One clean rep beats three fast ones.',
      },
    };
  }
  if (f >= 0.3 || fr >= 0.3) {
    return {
      pace: 'normal', restBonusSec: 10, repsFactor: 1,
      mental: {
        he: `נושמים, מתרכזים.${fHe}`,
        en: `Breathe, focus.${fEn}`,
      },
    };
  }
  if ((state?.readiness ?? 0) >= 0.8) {
    return {
      pace: 'push', restBonusSec: -10, repsFactor: 1.15,
      mental: { he: 'החזרות האחרונות נמדדו נקיות והגוף רענן — בסט הבא נעלה את הקצב.', en: 'Your last reps measured clean and you are fresh — next set we raise the pace.' },
    };
  }
  return { pace: 'normal', restBonusSec: 0, repsFactor: 1, mental: null };
}

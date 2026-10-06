// ============================================================
// planBuilder — turns the AI week plan into COHERENT catalog sessions (Stage 3.1)
//
// The AI decides the week's structure (which days, each day's focus); this builder fills
// every day from the catalog for that day's goal — so every exercise has a Ghost, fits the
// trainee's body, and serves the session goal. Deterministic: the same user / week / day
// always gets the same session (the dashboard and the training screen agree), while days and
// weeks vary (the seed includes them, and a week avoids repeating exercises).
// ============================================================

import { buildSession, inferGoal, familyOf, GOALS } from './sessionPlanner.js';
import { toExercise } from './catalog.js';
import { sportContextsFor } from '../sports/sportLibrary.js';

/** Contexts for the builder from the profile. */
export function planContext(userProfile, lp = {}, seedBase = null) {
  const contexts = sportContextsFor(userProfile);
  const track = userProfile?.trainingTrack || (userProfile?.sport === 'rehab' ? 'rehab_only' : 'sport_only');
  const sportId = contexts[contexts.length - 1];
  return {
    track,
    family: familyOf(sportId === 'rehab' ? 'rehab' : sportId),
    sportFamily: familyOf(sportId),
    lp,
    seedBase: seedBase || userProfile?.uid || userProfile?.email || userProfile?.name || 'trainee',
  };
}

/**
 * Rebuild every day of a plan from the catalog. Days keep their metadata (focus, name…) and
 * gain { goal, goalName, coherence }. Returns a new plan; the input is untouched.
 */
export function rebuildPlanFromCatalog(plan, ctx, isHe = true) {
  if (!plan?.weeks) return plan;
  return {
    ...plan,
    weeks: plan.weeks.map((w, wi) => {
      const avoid = new Set();
      return {
        ...w,
        days: (w?.days || []).map((d, di) => {
          if (!d) return d;
          const goal = inferGoal(d, { track: ctx.track, sportFamily: ctx.sportFamily, dayIndex: di });
          const s = buildSession({ goal, family: ctx.family, sportFamily: ctx.sportFamily, lp: ctx.lp, seed: `${ctx.seedBase}|w${wi}|d${di}`, avoid });
          s.items.forEach(x => avoid.add(x.item.id));
          return {
            ...d,
            goal: s.goal,
            goalName: GOALS[s.goal].name,
            coherence: s.coherence,
            exercises: s.items.map(x => ({ ...toExercise(x.item, isHe), block: x.role })),
          };
        }),
      };
    }),
  };
}

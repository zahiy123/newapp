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
import { trackOf, sportFamilyOf, selectedSessionGoals, patternsFor } from './trackGoals.js';

/** Contexts for the builder from the profile. */
export function planContext(userProfile, lp = {}, seedBase = null) {
  const track = trackOf(userProfile);
  const sportFamily = sportFamilyOf(userProfile);
  return {
    track,
    // rehab tracks build from the generic (rehab) family; the sport family feeds rehab + sport's support
    family: track === 'sport_only' ? sportFamily : familyOf('rehab'),
    sportFamily: track === 'rehab_only' ? familyOf('rehab') : sportFamily,
    allowed: selectedSessionGoals(userProfile, lp),  // the locked chain: only the trainee's goals
    patterns: patternsFor(userProfile, lp),           // only functional patterns for the sport / limitation
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
  // goals rotate over the whole plan (not per week): with 3 days a week and 4 goals, every goal still gets its days
  let dayCounter = 0;
  return {
    ...plan,
    weeks: plan.weeks.map((w, wi) => {
      const avoid = new Set();
      return {
        ...w,
        days: (w?.days || []).map((d, di) => {
          if (!d) return d;
          const goal = inferGoal(d, { allowed: ctx.allowed, dayIndex: dayCounter++ });
          const s = buildSession({ goal, family: ctx.family, sportFamily: ctx.sportFamily, lp: ctx.lp, seed: `${ctx.seedBase}|w${wi}|d${di}`, avoid, patterns: ctx.patterns });
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

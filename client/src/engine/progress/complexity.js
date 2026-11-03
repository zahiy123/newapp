// ============================================================
// complexity — graded progress by a HARDER VERSION of the exercise (the owner, 2026-11-03: rule 3 of the
// load adaptation — never "more reps" or "shorter rest": the next workout does a more demanding exercise)
//
// PURE. One upgrade of a catalog exercise, in this order (the first that applies):
//   1. range   partial → full                       (the full range of motion)
//   2. pattern the next movement on its biomechanical LADDER that this trainee's body allows
//              (more stability demand, a longer lever, a smaller base of support)
//   3. tempo   standard → controlled (slow 3-1-1)   (more time under tension and control)
// The dose (sets × reps, rest) stays. The Ghost and the coach's measurement follow the new catalog id.
// A pain-protected exercise is never upgraded (pain first). No harder version → the exercise stays.
// ============================================================

import { PATTERNS, patternFitsBody } from '../catalog/patterns.js';
import { parseCatalogId, variationAxes, catalogItem, toExercise, sideFitsBody, canSplitLegs } from '../catalog/catalog.js';

// easier → harder, same kind of exercise (reps), the same muscles and purpose
export const LADDERS = [
  ['miniSquat', 'squat', 'lunge', 'singleLegSquat'],     // depth → split stance → one leg (stability, base of support)
  ['lunge', 'singleLegLunge'],
  ['rehabFrontRaise', 'frontRaise', 'shoulderPress'],    // controlled → full raise → overhead (lever, range)
  ['rehabElbowFlex', 'bicepCurl'],
];

const nextOnLadder = (pattern, lp) => {
  for (const ladder of LADDERS) {
    const i = ladder.indexOf(pattern);
    if (i < 0) continue;
    for (const next of ladder.slice(i + 1)) if (PATTERNS[next] && patternFitsBody(PATTERNS[next], lp)) return next;
  }
  return null;
};

const sideFor = (pattern, lp) => {
  const ax = variationAxes(pattern);
  return ax.sides.find(s => sideFitsBody(pattern, s, lp)) || ax.sides[0];
};

/** The next catalog id (one step harder) and how, or null. */
export function harderId(catalogId, lp = {}) {
  const v = parseCatalogId(catalogId);
  if (!v) return null;
  const ax = variationAxes(v.pattern);
  if (v.range === 'partial' && ax.ranges.includes('full')) {
    return { id: [v.pattern, v.tempo, 'full', v.side, v.dose].join('|'), how: 'range' };
  }
  const next = nextOnLadder(v.pattern, lp);
  if (next) {
    const nx = variationAxes(next);
    const tempo = nx.tempos.includes(v.tempo) ? v.tempo : 'standard';
    const dose = nx.doses.includes(v.dose) ? v.dose : nx.doses[0];
    const id = [next, tempo, 'full', sideFor(next, lp), dose].join('|');
    if (parseCatalogId(id)) return { id, how: 'pattern' };
  }
  if (v.tempo === 'standard' && ax.tempos.includes('controlled')) {
    return { id: [v.pattern, 'controlled', v.range, v.side, v.dose].join('|'), how: 'tempo' };
  }
  return null;
}

/** One exercise one step harder (a new exercise object), or null when there is no harder version. */
export function upgradeExercise(ex, lp = {}, isHe = true) {
  if (!ex?.catalogId || ex.painProtected) return null;
  const h = harderId(ex.catalogId, lp);
  if (!h) return null;
  const item = catalogItem(h.id);
  if (!item) return null;
  const built = toExercise(item, isHe, null, { canSplit: canSplitLegs(lp) });
  // the same movement (range / tempo): keep its name (a sport label stays); a new movement: its own name
  const same = h.how !== 'pattern';
  return {
    ...ex, ...built,
    ...(same ? { name: ex.name, nameEn: ex.nameEn } : {}),
    // the dose stays: never more reps / shorter rest (a unilateral split doubles the set as before)
    ...(same ? { sets: ex.sets, reps: ex.reps, restSeconds: ex.restSeconds } : {}),
    upgradedFrom: { name: ex.upgradedFrom?.name || ex.name, how: [...(ex.upgradedFrom?.how || []), h.how] },
  };
}

/** Today's exercises `step` complexity levels up (each exercise as far as its harder versions go). */
export function applyComplexityStep(exercises, step, lp = {}, isHe = true) {
  if (!(step > 0)) return exercises;
  return (exercises || []).map((ex) => {
    if (ex.complexityStep) return ex;                        // never twice
    let cur = ex;
    for (let i = 0; i < step; i++) { const up = upgradeExercise(cur, lp, isHe); if (!up) break; cur = up; }
    return cur === ex ? ex : { ...cur, complexityStep: step };
  });
}

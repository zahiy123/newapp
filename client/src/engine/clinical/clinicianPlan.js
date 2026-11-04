// ============================================================
// clinicianPlan — the physiotherapist builds the patient's plan by hand (Stage 4B step 5, owner 2026-11-04)
//
// PURE. users/{uid}/clinicianPlans/current (server-written, the trainee reads only):
//   { mode: 'auto' | 'manual' | 'manual_plus_auto', exercises: [{ pattern, variation, sets, reps, rest, note }] }
//   auto              the system's own plan (the default)
//   manual            ONLY the clinician's exercises; the automatic plan is the BACKUP when none of them can
//                     run today (the body / the limits / the equipment)
//   manual_plus_auto  the clinician's exercises first, then the automatic plan
// The portal shows the catalog GROUPED BY JOINT / AREA (shoulder, elbow, hip, knee, core, conditioning,
// sport skill); a movement the patient's body cannot do, or that the clinician's own limits block, is shown
// but cannot be chosen. In the app: pain protection and the clinical limits apply to the clinician's
// exercises too (pain first); the automatic complexity step never changes them (the clinician decided).
// ============================================================

import { PATTERNS, patternFitsBody } from '../catalog/patterns.js';
import { patternProfile, variationAxes, catalogItem, toExercise, sideFitsBody, canSplitLegs, parseCatalogId } from '../catalog/catalog.js';
import { exerciseVerdict } from './clinicalLimits.js';

export const PLAN_MODES = ['auto', 'manual', 'manual_plus_auto'];
export const PLAN_GROUPS = [
  { id: 'shoulder', he: 'כתף', en: 'Shoulder' },
  { id: 'elbow', he: 'מרפק', en: 'Elbow' },
  { id: 'hip', he: 'ירך / אגן', en: 'Hip / pelvis' },
  { id: 'knee', he: 'ברך', en: 'Knee' },
  { id: 'core', he: 'ליבה ויציבה', en: 'Core & stability' },
  { id: 'conditioning', he: 'כושר וקואורדינציה', en: 'Conditioning & coordination' },
  { id: 'sport', he: 'מיומנות ענף', en: 'Sport skill' },
];
const MOVE_GROUP = { armCircles: 'shoulder', trunkRotation: 'core', kneeLiftMarch: 'hip', lateralShuffle: 'conditioning' };

/** The group of a pattern (its main joint / area). */
export function patternGroup(id) {
  const p = PATTERNS[id];
  const prof = patternProfile(id);
  if (!p) return null;
  if ((p.qualities || []).includes('sportSkill') || prof?.kind === 'strike') return 'sport';
  if (MOVE_GROUP[id]) return MOVE_GROUP[id];
  if (prof?.kind === 'cyclic') return 'conditioning';
  if (!prof) return (p.qualities || []).includes('core') ? 'core' : 'conditioning';
  if (['shoulder', 'elbow', 'hip', 'knee'].includes(prof.primary)) return prof.primary;
  return 'core';
}

// the versions a clinician picks from (the catalog's tempo × range)
export const VARIATIONS = [
  { id: 'standard', tempo: 'standard', range: 'full', he: 'רגיל', en: 'Standard' },
  { id: 'partial', tempo: 'standard', range: 'partial', he: 'טווח חלקי', en: 'Partial range' },
  { id: 'slow', tempo: 'controlled', range: 'full', he: 'קצב איטי 3-1-1', en: 'Slow 3-1-1' },
  { id: 'slow_partial', tempo: 'controlled', range: 'partial', he: 'טווח חלקי + איטי', en: 'Partial + slow' },
  { id: 'explosive', tempo: 'explosive', range: 'full', he: 'מתפרץ', en: 'Explosive' },
];
export function variationsOf(pattern) {
  const ax = variationAxes(pattern);
  return VARIATIONS.filter(v => ax.tempos.includes(v.tempo) && ax.ranges.includes(v.range));
}

const sideFor = (pattern, lp) => { const ax = variationAxes(pattern); return ax.sides.find(s => sideFitsBody(pattern, s, lp)) || ax.sides[0]; };
const unitOf = (pattern) => { const k = patternProfile(pattern)?.kind; return k === 'reps' || k === 'strike' ? 'reps' : 'sec'; };

/** The catalog id of a clinician's choice (the dose comes from the clinician's numbers). */
export function choiceId(pattern, variation, lp = {}) {
  const v = VARIATIONS.find(x => x.id === variation) || VARIATIONS[0];
  const ax = variationAxes(pattern);
  const tempo = ax.tempos.includes(v.tempo) ? v.tempo : 'standard';
  const range = ax.ranges.includes(v.range) ? v.range : 'full';
  return [pattern, tempo, range, sideFor(pattern, lp), ax.doses[0]].join('|');
}

/** The portal's view: every group with its patterns — can it be chosen, and why not; the default numbers. */
export function planCatalog(lp = {}, constraints = null, isHe = true) {
  const groups = PLAN_GROUPS.map(g => ({ ...g, patterns: [] }));
  for (const [id, p] of Object.entries(PATTERNS)) {
    const g = groups.find(x => x.id === patternGroup(id));
    if (!g) continue;
    const fits = patternFitsBody(p, lp);
    const base = catalogItem(choiceId(id, 'standard', lp));
    const verdict = fits && constraints ? exerciseVerdict(base?.id, constraints) : { verdict: 'ok' };
    g.patterns.push({
      id, name: isHe ? p.name.he : p.name.en, unit: unitOf(id), fits, verdict: verdict.verdict, verdictJoint: verdict.joint || null,
      variations: variationsOf(id).map(v => ({ id: v.id, label: isHe ? v.he : v.en })),
      defaults: base ? { sets: Number(base.dose.sets), reps: Number(base.dose.reps), rest: Number(base.dose.rest) } : { sets: 3, reps: 10, rest: 60 },
    });
  }
  return groups.filter(g => g.patterns.length);
}

/** One clinician's choice → an exercise of the app (or null when it cannot run for this body / limits). */
export function buildManualExercise(choice, lp = {}, isHe = true, constraints = null) {
  if (!PATTERNS[choice?.pattern] || !patternFitsBody(PATTERNS[choice.pattern], lp)) return null;
  const id = choiceId(choice.pattern, choice.variation, lp);
  const item = catalogItem(id);
  if (!item) return null;
  if (constraints && exerciseVerdict(id, constraints).verdict === 'blocked') return null;
  const sets = Math.min(10, Math.max(1, Number(choice.sets) || Number(item.dose.sets)));
  const reps = Math.min(300, Math.max(1, Number(choice.reps) || Number(item.dose.reps)));
  const rest = Math.min(600, Math.max(0, Number(choice.rest ?? item.dose.rest)));
  const unitHe = unitOf(choice.pattern) === 'sec' ? ' שניות' : '';
  const unitEn = unitOf(choice.pattern) === 'sec' ? ' s' : '';
  // the clinician's numbers become the dose (a one-sided movement still splits / doubles as the catalog does)
  const custom = { ...item, dose: { ...item.dose, sets, reps: String(reps), rest, label: { he: `${sets}×${reps}${unitHe}`, en: `${sets}×${reps}${unitEn}` } } };
  const ex = toExercise(custom, isHe, null, { canSplit: canSplitLegs(lp) });
  return { ...ex, byClinician: true, clinicianNote: String(choice.note || '').slice(0, 200) || null };
}

/** Today's exercises with the clinician's plan (the automatic list is the backup in 'manual'). */
export function mergeClinicianPlan(autoList, plan, lp = {}, isHe = true, constraints = null) {
  if (!plan || !PLAN_MODES.includes(plan.mode) || plan.mode === 'auto') return autoList;
  const manual = (plan.exercises || []).map(c => buildManualExercise(c, lp, isHe, constraints)).filter(Boolean);
  if (!manual.length) return autoList;                                   // the backup: nothing of the plan can run
  if (plan.mode === 'manual') return manual;
  const used = new Set(manual.map(e => parseCatalogId(e.catalogId)?.pattern));
  return [...manual, ...(autoList || []).filter(e => !used.has(parseCatalogId(e.catalogId)?.pattern))];
}

// ============================================================
// catalog — the exercise catalog: MOVEMENT PATTERN × VARIATION (Stage 3.1)
//
// Every catalog exercise is generated from a pattern that has a Ghost, so no exercise can
// exist without a live demonstration. Variations change the exercise AND its Ghost / profile:
//   tempo   standard | controlled (slow, 3-1-1) | explosive          → Ghost period ×1 / ×1.6; explosive = fast drive, controlled lowering
//   range   full | partial (rehab, early stages)                      → Ghost peak + target halfway
//   side    left | right | alternating (unilateral patterns)          → Ghost works that side
//   dose    the prescription (sets × reps / seconds, rest), chosen by the session goal
//
// id = "pattern|tempo|range|side|dose" — deterministic, parsed back by catalogItem().
// ============================================================

import { PATTERNS, patternsForFamily, patternFitsBody } from './patterns.js';
import { EXPERT_PROFILES } from '../exercise/exerciseProfiles.js';

const t = (he, en) => ({ he, en });

export const TEMPOS = Object.freeze({
  standard: { factor: 1, label: null, fit: ['strength', 'endurance', 'conditioning', 'technique', 'stability'] },
  // a slow tempo makes it CONTROLLED strength work (rehab-safe) — it does not turn it into a stability / mobility drill
  controlled: { factor: 1.6, label: t('קצב איטי 3-1-1', 'slow tempo 3-1-1'), fit: ['rehab', 'strength'] },
  explosive: { factor: 0.85, label: t('שלב הדחיפה מתפרץ', 'explosive drive'), fit: ['power', 'plyometric'] },
});
export const RANGES = Object.freeze({
  full: { label: null, fit: null },
  partial: { label: t('טווח חלקי', 'partial range'), fit: ['rehab'] },
});
export const SIDES = Object.freeze({
  both: { label: null },
  left: { label: t('צד שמאל', 'left side') },
  right: { label: t('צד ימין', 'right side') },
  alternating: { label: t('לסירוגין', 'alternating') },
  bothSides: { label: t('שתי הרגליים — חצי סט לכל רגל', 'both legs — half a set each') },
});

// Prescriptions per pattern kind; `fit` = the session qualities it serves
const DOSES = Object.freeze({
  reps: {
    s4r5: { sets: 4, reps: '5', rest: 120, label: t('4×5', '4×5'), fit: ['power', 'plyometric', 'strength'] },
    s3r8: { sets: 3, reps: '8', rest: 90, label: t('3×8', '3×8'), fit: ['strength', 'power'] },
    s3r12: { sets: 3, reps: '12', rest: 60, label: t('3×12', '3×12'), fit: ['strength', 'endurance', 'rehab', 'stability'] },
    s2r15: { sets: 2, reps: '15', rest: 45, label: t('2×15', '2×15'), fit: ['rehab', 'endurance', 'activation', 'mobility'] },
  },
  hold: {
    h20: { sets: 3, reps: '20', rest: 40, label: t('3×20 שניות', '3×20 s'), fit: ['rehab', 'stability', 'balance', 'activation'] },
    h30: { sets: 3, reps: '30', rest: 45, label: t('3×30 שניות', '3×30 s'), fit: ['stability', 'core', 'strength', 'balance'] },
    h45: { sets: 2, reps: '45', rest: 60, label: t('2×45 שניות', '2×45 s'), fit: ['endurance', 'core', 'strength'] },
  },
  timed: {
    i10: { sets: 6, reps: '10', rest: 50, label: t('6×10 שניות', '6×10 s'), fit: ['speed', 'acceleration', 'power', 'agility'] },
    i20: { sets: 4, reps: '20', rest: 40, label: t('4×20 שניות', '4×20 s'), fit: ['agility', 'conditioning', 'coordination', 'activation', 'speed'] },
    i30: { sets: 3, reps: '30', rest: 30, label: t('3×30 שניות', '3×30 s'), fit: ['endurance', 'conditioning', 'mobility', 'activation', 'technique'] },
    i45: { sets: 3, reps: '45', rest: 45, label: t('3×45 שניות', '3×45 s'), fit: ['endurance', 'conditioning', 'mobility'] },
  },
  strike: {
    // a kick set is either POWER (few, full force) or ACCURACY (more, controlled) — named in the exercise
    k6: { sets: 3, reps: '6', rest: 60, label: t('3×6', '3×6'), focus: t('בעוצמה', 'power'), fit: ['technique', 'power', 'sportSkill'] },
    k10: { sets: 3, reps: '10', rest: 45, label: t('3×10', '3×10'), focus: t('בדיוק', 'accuracy'), fit: ['technique', 'sportSkill', 'balance'] },
  },
});

/** The pattern's measured profile (expert) or null for move-based patterns. */
export function patternProfile(patternId) {
  const p = PATTERNS[patternId];
  return p?.source.profile ? EXPERT_PROFILES[p.source.profile] : null;
}

function doseKind(patternId) {
  const prof = patternProfile(patternId);
  if (!prof) return 'timed';
  if (prof.kind === 'hold') return 'hold';
  if (prof.kind === 'strike') return 'strike';
  if (prof.kind === 'cyclic') return 'timed';
  return 'reps';
}

/** Which variation axes a pattern supports. */
export function variationAxes(patternId) {
  const p = PATTERNS[patternId];
  const prof = patternProfile(patternId);
  const repsWithPeak = prof && prof.kind === 'reps' && !prof.ghost.keyframes;
  return {
    tempos: prof && prof.kind === 'reps' ? Object.keys(TEMPOS) : ['standard'],
    ranges: repsWithPeak ? Object.keys(RANGES) : ['full'],
    // a unilateral movement is ONE exercise whose sets are split between the legs ('bothSides');
    // a trainee who cannot switch (crutches / above-knee) gets the working-leg-only version
    sides: p.unilateral || p.splitSides ? ['bothSides', 'left', 'right'] : ['both'],
    doses: Object.keys(DOSES[doseKind(patternId)]),
  };
}

/** Parse / validate a catalog id. */
export function parseCatalogId(id) {
  const [pattern, tempo, range, side, dose] = String(id || '').split('|');
  if (!PATTERNS[pattern]) return null;
  const ax = variationAxes(pattern);
  if (!ax.tempos.includes(tempo) || !ax.ranges.includes(range) || !ax.sides.includes(side) || !ax.doses.includes(dose)) return null;
  return { pattern, tempo, range, side, dose };
}

/**
 * The profile of a catalog exercise (pattern profile with the variation applied) — the Ghost
 * and the live measurement use exactly this. Null for move-based patterns.
 */
export function variationProfile(id) {
  const v = parseCatalogId(id);
  if (!v) return null;
  const base = patternProfile(v.pattern);
  if (!base) return null;
  let p = base;
  const tempo = TEMPOS[v.tempo];
  if (v.tempo === 'explosive' && p.ghost.peak) {
    // Explosive = the CONCENTRIC phase is fast, the lowering stays controlled:
    // squat / push / hinge / lunge lower toward the peak → fast return; press / raise / curl / bridge → fast to the peak
    const lowersToPeak = (p.tags || []).some(tg => ['squatPattern', 'hinge', 'push', 'singleLeg'].includes(tg));
    p = { ...p, ghost: { ...p.ghost, periodMs: Math.round(p.ghost.periodMs * 0.85), toPeakShare: lowersToPeak ? 0.68 : 0.32 } };
  } else if (tempo.factor !== 1) {
    p = { ...p, ghost: { ...p.ghost, periodMs: Math.round(p.ghost.periodMs * tempo.factor) } };
  }
  if (v.range === 'partial' && p.ghost.peak) {
    const half = (a, b) => a + (b - a) * 0.5;
    const peakGhost = Object.fromEntries(Object.entries(p.ghost.peak).map(([k, val]) => [k, half(p.ghost.rest[k] ?? val, val)]));
    const joints = Object.fromEntries(Object.entries(p.joints).map(([k, j]) => {
      if (!j.peak) return [k, j];
      const c = peakGhost[k] ?? half((j.rest[0] + j.rest[1]) / 2, (j.peak[0] + j.peak[1]) / 2);
      const w = (j.peak[1] - j.peak[0]) / 2;
      // a shorter movement: centre the rest target on the Ghost's start too, so the accuracy
      // target is exactly the demonstrated partial range
      const g = p.ghost.rest?.[k];
      const rest = typeof g === 'number' ? [Math.max(j.rest[0], g - 10), Math.min(j.rest[1], g + 10)] : j.rest;
      return [k, { ...j, rest, peak: [c - w, c + w] }];
    }));
    // depth rules belong to the full range
    const rules = p.rules.filter(r => !(r.when === 'peak' && /shallow|low|partial/.test(r.id)));
    p = { ...p, joints, rules, ghost: { ...p.ghost, peak: peakGhost } };
  }
  if (v.side === 'left' || v.side === 'right') p = { ...p, ghost: { ...p.ghost, workingSide: v.side } };
  return { ...p, catalogId: id };
}

/** Ghost spec of a catalog exercise (for WarmupGhostPanel / GhostOverlay). */
export function catalogGhostSpec(id, profile = null) {
  const v = parseCatalogId(id);
  if (!v) return null;
  const pat = PATTERNS[v.pattern];
  if (pat.source.profile) {
    const spec = { profile: profile || variationProfile(id) };
    // a shadow kick / pass has no real ball → the Ghost kicks a shadow ball (depth, realism)
    if (KICK_PATTERNS.has(v.pattern)) spec.ball = v.pattern === 'shadowPass' ? 'pass' : 'kick';
    return spec;
  }
  return { move: pat.source.move, ...(v.side === 'left' || v.side === 'right' ? { side: v.side } : {}) };
}

const joinLabels = (parts, lang) => parts.filter(Boolean).map(x => x[lang]).join(' · ');

/** Full catalog item for an id (null if invalid). */
export function catalogItem(id) {
  const v = parseCatalogId(id);
  if (!v) return null;
  const pat = PATTERNS[v.pattern];
  const dose = DOSES[doseKind(v.pattern)][v.dose];
  const labels = [dose.focus || null, TEMPOS[v.tempo].label, RANGES[v.range].label, SIDES[v.side].label];
  const variantHe = joinLabels(labels, 'he');
  const variantEn = joinLabels(labels, 'en');
  const qualities = new Set(pat.qualities);
  for (const q of TEMPOS[v.tempo].fit || []) if (v.tempo !== 'standard') qualities.add(q);
  if (v.range === 'partial') qualities.add('rehab');
  return {
    id,
    patternId: v.pattern,
    variation: v,
    qualities: [...qualities],
    doseFit: dose.fit,
    name: { he: [pat.name.he, variantHe].filter(Boolean).join(' — '), en: [pat.name.en, variantEn].filter(Boolean).join(' — ') },
    dose,
    cue: pat.cue,
  };
}

export const KICK_PATTERNS = new Set(['shadowKick', 'shadowPass']);
const legAffectedSide = (lp, s) => ['prosthetic', 'absent'].includes(lp?.[`${s}_leg`]?.state);

/** Can this trainee work on EACH leg (split sets)? An active below-knee prosthesis can; absent / above-knee / crutches / wheelchair cannot. */
export function canSplitLegs(lp = {}) {
  const ok = (s) => {
    const l = lp[`${s}_leg`];
    return !(l?.state === 'absent' || (l?.state === 'prosthetic' && l?.level !== 'below_knee'));
  };
  return ok('left') && ok('right') && !lp.wheelchair && !lp.crutches;
}

/**
 * Variation-level body fit for unilateral movements:
 *   can switch legs → ONLY the split version (both legs, half the set each — never one side shown alone)
 *   cannot switch   → ONLY the working leg (never the absent / prosthetic side)
 */
export function sideFitsBody(patternId, side, lp = {}) {
  if (side === 'both') return true;
  if (canSplitLegs(lp)) return side === 'bothSides';
  if (side === 'bothSides' || side === 'alternating') return false;
  const affected = ['left', 'right'].filter(s => legAffectedSide(lp, s));
  return affected.length ? !affected.includes(side) : side === 'right';
}

/** Every catalog item of a sport family that this trainee's body allows. */
export function buildCatalog(family, lp = {}) {
  const items = [];
  for (const pid of patternsForFamily(family)) {
    if (!patternFitsBody(PATTERNS[pid], lp)) continue;
    const ax = variationAxes(pid);
    for (const tempo of ax.tempos) for (const range of ax.ranges) for (const side of ax.sides) for (const dose of ax.doses) {
      if (!sideFitsBody(pid, side, lp)) continue;
      if (range === 'partial' && tempo === 'explosive') continue;     // partial range is for controlled work
      items.push(catalogItem([pid, tempo, range, side, dose].join('|')));
    }
  }
  return items;
}

/** Catalog item → an exercise object for the training screen / plan views. */
export function toExercise(item, isHe = true, label = null, { canSplit = true } = {}) {
  const d = item.dose;
  const timed = doseKind(item.patternId) !== 'reps' && doseKind(item.patternId) !== 'strike';
  // a sport label renames the movement in the sport's language; the variation part is kept
  const variant = (lang) => item.name[lang].split(' — ').slice(PATTERNS[item.patternId].name[lang].split(' — ').length).join(' — ');
  const name = label ? { he: [label.name.he, variant('he')].filter(Boolean).join(' · '), en: [label.name.en, variant('en')].filter(Boolean).join(' · ') } : item.name;
  const cue = label?.cue || item.cue;
  // Split sets: the target covers BOTH legs (each leg gets the full dose → the set is twice as long).
  // splitMode: 'kick' = the working (kicking) leg alternates; 'stand' = the leg you stand / work on
  const split = item.variation.side === 'bothSides' && canSplit;
  const splitMode = KICK_PATTERNS.has(item.patternId) ? 'kick' : 'stand';
  // Kicks / passes (owner): a FULL, separate set per leg (base leg set, then the other leg's set) →
  // twice the sets, the reps per set unchanged. Balance / one-leg work: the leg switches mid-set.
  const perSet = split && splitMode === 'kick';
  const reps = split && !perSet ? String(Number(d.reps) * 2) : d.reps;
  const sets = perSet ? Number(d.sets) * 2 : d.sets;
  const perSetName = (s, he) => (perSet ? s.replace(he ? 'חצי סט לכל רגל' : 'half a set each', he ? 'סט נפרד לכל רגל' : 'a separate set per leg') : s);
  return {
    name: perSetName(name.he, true),
    nameEn: perSetName(name.en, false),
    description: `${cue.he}. ${d.label.he}${perSet ? ' — סט נפרד לכל רגל' : split ? ' — לכל רגל' : ''}`,
    descriptionEn: `${cue.en}. ${d.label.en}${perSet ? ' — a separate set for each leg' : split ? ' — each leg' : ''}`,
    sets,
    reps,
    sideSwitch: split,
    splitMode: split ? splitMode : null,
    splitBy: perSet ? 'set' : split ? 'half' : null,
    restSeconds: d.rest,
    tips: isHe ? cue.he : cue.en,
    catalogId: item.id,
    timed,
  };
}

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
  controlled: { factor: 1.6, label: t('קצב איטי 3-1-1', 'slow tempo 3-1-1'), fit: ['rehab', 'strength', 'stability', 'mobility'] },
  explosive: { factor: 0.85, label: t('שלב הדחיפה מתפרץ', 'explosive drive'), fit: ['power', 'speed', 'plyometric', 'acceleration'] },
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
    k6: { sets: 3, reps: '6', rest: 60, label: t('3×6 לכל רגל', '3×6 each'), fit: ['technique', 'power', 'sportSkill'] },
    k10: { sets: 3, reps: '10', rest: 45, label: t('3×10 לכל רגל', '3×10 each'), fit: ['technique', 'sportSkill', 'balance'] },
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
    sides: p.unilateral ? ['left', 'right', 'alternating'] : ['both'],
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
  if (pat.source.profile) return { profile: profile || variationProfile(id) };
  return { move: pat.source.move, ...(v.side === 'left' || v.side === 'right' ? { side: v.side } : {}) };
}

const joinLabels = (parts, lang) => parts.filter(Boolean).map(x => x[lang]).join(' · ');

/** Full catalog item for an id (null if invalid). */
export function catalogItem(id) {
  const v = parseCatalogId(id);
  if (!v) return null;
  const pat = PATTERNS[v.pattern];
  const dose = DOSES[doseKind(v.pattern)][v.dose];
  const labels = [TEMPOS[v.tempo].label, RANGES[v.range].label, SIDES[v.side].label];
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

/** Every catalog item of a sport family that this trainee's body allows. */
export function buildCatalog(family, lp = {}) {
  const items = [];
  for (const pid of patternsForFamily(family)) {
    if (!patternFitsBody(PATTERNS[pid], lp)) continue;
    const ax = variationAxes(pid);
    for (const tempo of ax.tempos) for (const range of ax.ranges) for (const side of ax.sides) for (const dose of ax.doses) {
      if (range === 'partial' && tempo === 'explosive') continue;     // partial range is for controlled work
      items.push(catalogItem([pid, tempo, range, side, dose].join('|')));
    }
  }
  return items;
}

/** Catalog item → an exercise object for the training screen / plan views. */
export function toExercise(item, isHe = true) {
  const d = item.dose;
  const timed = doseKind(item.patternId) !== 'reps' && doseKind(item.patternId) !== 'strike';
  return {
    name: item.name.he,
    nameEn: item.name.en,
    description: `${item.cue.he}. ${d.label.he}${timed ? '' : ''}`,
    descriptionEn: `${item.cue.en}. ${d.label.en}`,
    sets: d.sets,
    reps: d.reps,
    restSeconds: d.rest,
    tips: isHe ? item.cue.he : item.cue.en,
    catalogId: item.id,
    timed,
  };
}

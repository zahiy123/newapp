// ============================================================
// relevance — only FUNCTIONAL exercises for the trainee's sport and limitation (Stage 3.1)
//
// The owner's rule (hard): no generic "morning-exercise" filler — no arm circles, no knee-lift
// marches — in any sport or rehab track. Every exercise of a session speaks the sport's
// professional language. Amputee football (rehab or sport) is built ONLY from:
//   core · single-leg balance · upper-body strength for the crutches · kicks / football movements
//
//   SPORT_PATTERNS            per sport: the functional movement patterns
//   SPORT_LABELS              per sport: each pattern's name + cue in the sport's language
//   relevantPatterns(...)     the allowed set for a trainee
//   sportLabel(sport, pattern) the sport's name / cue for a pattern (or null)
// ============================================================

const LOWER_STRENGTH = ['squat', 'miniSquat', 'lunge', 'wallSit', 'hipHinge', 'gluteBridge'];
const SPEED = ['runInPlace', 'highKnees', 'buttKicks', 'aSkip', 'accelMarch'];
const ARM_ISOLATION = ['lateralRaise', 'frontRaise', 'rehabFrontRaise', 'bicepCurl', 'rehabElbowFlex'];
// Generic mobility drills — never in a sport or rehab track (only in general fitness, or as
// real range-of-motion work for a limited arm)
export const GENERIC_DRILLS = ['armCircles', 'kneeLiftMarch'];

// Amputee football: the four functional categories, nothing else
export const AMPUTEE_FOOTBALL_CATEGORIES = Object.freeze({
  core: ['plank', 'gluteBridge', 'trunkRotation'],
  singleLegBalance: ['kneeUpBalance'],
  crutchUpperBody: ['pushUp', 'shoulderPress'],
  kicks: ['shadowKick'],
});
const AMPUTEE_FOOTBALL = Object.values(AMPUTEE_FOOTBALL_CATEGORIES).flat();

export const SPORT_PATTERNS = Object.freeze({
  football: [...LOWER_STRENGTH, ...SPEED, 'jumpSquat', 'lateralShuffle', 'kneeUpBalance', 'plank', 'pushUp', 'trunkRotation', 'shadowKick'],
  footballAmputee: AMPUTEE_FOOTBALL,
  // Amputee goalkeeper (arm amputees): low stance, lateral power, reactions, core
  footballAmputeeGK: [...LOWER_STRENGTH, 'jumpSquat', 'lateralShuffle', 'kneeUpBalance', 'plank', 'shoulderPress', 'highKnees', 'accelMarch', 'trunkRotation'],
  basketball: [...LOWER_STRENGTH, ...SPEED, 'jumpSquat', 'lateralShuffle', 'kneeUpBalance', 'plank', 'pushUp', 'shoulderPress', 'trunkRotation', 'shadowChestPass'],
  tennis: [...LOWER_STRENGTH, ...SPEED, 'jumpSquat', 'lateralShuffle', 'kneeUpBalance', 'plank', 'lateralRaise', 'trunkRotation', 'shadowStroke'],
  // Wheelchair sports: shoulders (protect them), pushing strength, trunk, the sport motion
  basketballWheelchair: ['trunkRotation', 'shoulderPress', 'lateralRaise', 'frontRaise', 'bicepCurl', 'shadowChestPass'],
  tennisWheelchair: ['trunkRotation', 'shoulderPress', 'lateralRaise', 'frontRaise', 'bicepCurl', 'shadowStroke'],
  running: [...LOWER_STRENGTH, ...SPEED, 'jumpSquat', 'kneeUpBalance', 'plank'],
  fitness: null,     // general fitness: all generic patterns
});

const t = (he, en) => ({ he, en });
// The sport's professional language (the Hebrew name keeps the movement's own word first)
export const SPORT_LABELS = Object.freeze({
  footballAmputee: {
    plank: { name: t('פלאנק — ליבה לבעיטה ולקביים', 'Plank — core for the kick and the crutches'), cue: t('גוף אחד ישר — הליבה מחזיקה אותך על הקביים', 'One straight line — your core holds you on the crutches') },
    gluteBridge: { name: t('גשר ישבן — יציבות אגן', 'Glute bridge — pelvic stability'), cue: t('דחוף את הרצפה עם העקב והרם את האגן — אגן יציב = בעיטה יציבה', 'Drive the floor with the heel, hips up — a stable pelvis = a stable kick') },
    trunkRotation: { name: t('רוטציות גו — כוח סיבובי לבעיטה', 'Trunk rotations — rotational power for the kick'), cue: t('הסתובב מהבטן, האגן יציב — מכאן מגיע הכוח לבעיטה', 'Turn from the middle, hips still — that is where the kick gets its power') },
    kneeUpBalance: { name: t('יציבות על רגל אחת — בסיס לבעיטה', 'Single-leg stability — the base of the kick'), cue: t('על הרגל העומדת, ברך למעלה, גו זקוף — כמו רגע לפני בעיטה', 'On the standing leg, knee up, tall trunk — like the moment before a kick') },
    pushUp: { name: t('שכיבות סמיכה — כוח לקביים', 'Push-ups — strength for the crutches'), cue: t('דחוף את הרצפה הרחק ממך — אותו כוח שדוחף אותך על הקביים', 'Push the floor away — the same push that drives you on the crutches') },
    shoulderPress: { name: t('לחיצת כתפיים — דחיפה על הקביים', 'Shoulder press — pushing on the crutches'), cue: t('דחוף את התקרה — כתפיים חזקות נושאות אותך במגרש', 'Push the ceiling — strong shoulders carry you on the pitch') },
    shadowKick: { name: t('בעיטה בצל — טכניקת בעיטה', 'Shadow kick — kicking technique'), cue: t('הירך מובילה, הרגל מצליפה, החזה מעל הכדור הדמיוני', 'The hip leads, the leg whips through, chest over the imaginary ball') },
  },
});

const legAffected = (lp) => ['left_leg', 'right_leg'].some(k => ['prosthetic', 'absent'].includes(lp?.[k]?.state));
const armLimited = (lp) => ['left_arm', 'right_arm'].some(k => ['limited', 'absent', 'prosthetic', 'no_movement'].includes(lp?.[k]?.state) || typeof lp?.[k]?.romCapDeg === 'number');

/**
 * @param {{ track: string, sport: string|null, lp?: Object }} p
 * @returns {Set<string>|null} allowed pattern ids (null = no restriction)
 */
export function relevantPatterns({ track, sport, lp = {} }) {
  if (track !== 'rehab_only') {
    const list = SPORT_PATTERNS[sport];
    return list ? new Set(list) : null;
  }
  // rehab only: functional for the limitation
  if (armLimited(lp)) {
    // a limited arm: arm range-of-motion work IS the rehab (arm circles here are real ROM work)
    return null;
  }
  const base = ['squat', 'miniSquat', 'lunge', 'wallSit', 'hipHinge', 'gluteBridge', 'pushUp', 'plank', 'kneeUpBalance', 'trunkRotation'];
  return new Set(legAffected(lp) ? base : [...base, ...ARM_ISOLATION]);
}

/** The sport's own name / cue for a pattern (null when the sport has no special language for it). */
export function sportLabel(sport, patternId) {
  return SPORT_LABELS[sport]?.[patternId] || null;
}

export { ARM_ISOLATION };

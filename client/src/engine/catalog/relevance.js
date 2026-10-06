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
  // one-leg strength — on crutches it is crutch-supported (owner, 2026-10-06)
  singleLegStrength: ['singleLegSquat', 'singleLegLunge'],
  crutchUpperBody: ['pushUp', 'shoulderPress'],
  kicks: ['shadowKick', 'shadowPass'],
});
const AMPUTEE_FOOTBALL = Object.values(AMPUTEE_FOOTBALL_CATEGORIES).flat();

export const SPORT_PATTERNS = Object.freeze({
  football: [...LOWER_STRENGTH, ...SPEED, 'jumpSquat', 'lateralShuffle', 'kneeUpBalance', 'singleLegSquat', 'singleLegLunge', 'plank', 'pushUp', 'trunkRotation', 'shadowKick', 'shadowPass'],
  footballAmputee: AMPUTEE_FOOTBALL,
  // Amputee goalkeeper (arm amputees): low stance, lateral power, reactions, core
  // Amputee goalkeeper (often an arm amputee): ready stance, lateral power, reactions, core,
  // the working arm / shoulder; the distribution kick
  footballAmputeeGK: [...LOWER_STRENGTH, 'gkStance', 'jumpSquat', 'lateralShuffle', 'kneeUpBalance', 'singleLegSquat', 'plank', 'shoulderPress', 'lateralRaise', 'highKnees', 'accelMarch', 'trunkRotation', 'shadowKick'],
  basketball: [...LOWER_STRENGTH, ...SPEED, 'jumpSquat', 'lateralShuffle', 'kneeUpBalance', 'singleLegSquat', 'singleLegLunge', 'plank', 'pushUp', 'shoulderPress', 'trunkRotation', 'shadowChestPass'],
  tennis: [...LOWER_STRENGTH, ...SPEED, 'jumpSquat', 'lateralShuffle', 'kneeUpBalance', 'singleLegSquat', 'singleLegLunge', 'plank', 'lateralRaise', 'trunkRotation', 'shadowStroke'],
  // Wheelchair sports: shoulders (protect them), pushing strength, trunk, the sport motion
  basketballWheelchair: ['trunkRotation', 'shoulderPress', 'lateralRaise', 'frontRaise', 'bicepCurl', 'shadowChestPass'],
  tennisWheelchair: ['trunkRotation', 'shoulderPress', 'lateralRaise', 'frontRaise', 'bicepCurl', 'shadowStroke'],
  running: [...LOWER_STRENGTH, ...SPEED, 'jumpSquat', 'kneeUpBalance', 'singleLegSquat', 'singleLegLunge', 'plank'],
  fitness: null,     // general fitness: all generic patterns
});

const t = (he, en) => ({ he, en });
// The sport's professional language (the Hebrew name keeps the movement's own word first)
export const SPORT_LABELS = Object.freeze({
  footballAmputee: {
    plank: { name: t('פלאנק — ליבה לבעיטה', 'Plank — core for the kick'), cue: t('גוף אחד ישר — ליבה חזקה היא הבסיס של כל בעיטה', 'One straight line — a strong core is the base of every kick') },
    gluteBridge: { name: t('גשר ישבן — יציבות אגן', 'Glute bridge — pelvic stability'), cue: t('דחוף את הרצפה עם העקב והרם את האגן — אגן יציב = בעיטה יציבה', 'Drive the floor with the heel, hips up — a stable pelvis = a stable kick') },
    trunkRotation: { name: t('רוטציות גו — כוח סיבובי לבעיטה', 'Trunk rotations — rotational power for the kick'), cue: t('הסתובב מהבטן, האגן יציב — מכאן מגיע הכוח לבעיטה', 'Turn from the middle, hips still — that is where the kick gets its power') },
    kneeUpBalance: { name: t('יציבות על רגל אחת — בסיס לבעיטה', 'Single-leg stability — the base of the kick'), cue: t('על הרגל העומדת, ברך למעלה, גו זקוף — כמו רגע לפני בעיטה', 'On the standing leg, knee up, tall trunk — like the moment before a kick') },
    pushUp: { name: t('שכיבות סמיכה — כוח פלג גוף עליון', 'Push-ups — upper-body strength'), cue: t('דחוף את הרצפה הרחק ממך — גוף ישר', 'Push the floor away — body straight') },
    shoulderPress: { name: t('לחיצת כתפיים — כוח כתפיים', 'Shoulder press — shoulder strength'), cue: t('דחוף את התקרה — כתפיים חזקות ויציבות', 'Push the ceiling — strong, stable shoulders') },
    shadowKick: { name: t('בעיטה בצל — טכניקת בעיטה', 'Shadow kick — kicking technique'), cue: t('הירך מובילה, הרגל מצליפה, החזה מעל הכדור הדמיוני', 'The hip leads, the leg whips through, chest over the imaginary ball') },
    shadowPass: { name: t('מסירה בצל — פנים כף הרגל', 'Shadow pass — inside of the foot'), cue: t('כף רגל פתוחה, תנופה קצרה ומדויקת — כמו מסירה לחבר', 'Foot open, a short accurate swing — like a pass to a teammate') },
    singleLegSquat: { name: t('סקוואט על רגל אחת — כוח לרגל הבעיטה', 'Single-leg squat — strength for the kicking leg'), cue: t('רד לאט על הרגל המתפקדת והתרומם בכוח', 'Lower slowly on the working leg, drive back up') },
    singleLegLunge: { name: t("לאנג' על רגל אחת — כוח ויציבות", 'Single-leg lunge — strength and stability'), cue: t('רד ישר למטה על הרגל הקדמית, הגו זקוף', 'Drop straight down on the front leg, tall trunk') },
  },
  footballAmputeeGK: {
    gkStance: { name: t('עמידת מוכנות שוער', 'Goalkeeper ready stance'), cue: t('נמוך, משקל על כריות כפות הרגליים, ידיים מוכנות לזינוק', 'Low, weight on the balls of the feet, hands ready to spring') },
    lateralShuffle: { name: t('צעדי שוער לצדדים', 'Goalkeeper side steps'), cue: t('נמוך, צעדים קצרים מעמוד לעמוד, בלי להצליב', 'Low, short steps post to post, never crossing') },
    jumpSquat: { name: t('קפיצת שוער — זינוק למעלה', 'Goalkeeper jump — spring up'), cue: t('דחוף את הרצפה וזנק — נחיתה רכה ומוכנה', 'Drive the floor and spring — land soft and ready') },
    shoulderPress: { name: t('לחיצת כתפיים — כוח לתפיסה ולזריקה', 'Shoulder press — strength for catching and throwing'), cue: t('דחוף את התקרה — כתף חזקה ויציבה', 'Push the ceiling — a strong, stable shoulder') },
    shadowKick: { name: t('בעיטת הוצאה בצל', 'Shadow goal kick'), cue: t('תנופה מהירך, מעקב גבוה — הוצאה ארוכה', 'Swing from the hip, high follow-through — a long clearance') },
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
  const base = ['squat', 'miniSquat', 'lunge', 'wallSit', 'hipHinge', 'gluteBridge', 'pushUp', 'plank', 'kneeUpBalance', 'singleLegSquat', 'singleLegLunge', 'trunkRotation'];
  return new Set(legAffected(lp) ? base : [...base, ...ARM_ISOLATION]);
}

// Sports whose every session carries a dedicated block of the sport's skill (owner: kick volume)
export const SPORT_SKILL_BLOCK = Object.freeze({
  footballAmputee: { n: 3, want: ['technique', 'sportSkill'] },
  football: { n: 2, want: ['technique', 'sportSkill'] },
});

// On crutches (no prosthesis): the working leg only, crutch support allowed — said explicitly.
// The crutch wording lives ONLY here: a trainee with a prosthesis never hears "crutches".
const CRUTCH_LABELS = {
  plank: { name: t('פלאנק — ליבה לבעיטה ולקביים', 'Plank — core for the kick and the crutches'), cue: t('גוף אחד ישר — הליבה מחזיקה אותך על הקביים', 'One straight line — your core holds you on the crutches') },
  pushUp: { name: t('שכיבות סמיכה — כוח לקביים', 'Push-ups — strength for the crutches'), cue: t('דחוף את הרצפה הרחק ממך — אותו כוח שדוחף אותך על הקביים', 'Push the floor away — the same push that drives you on the crutches') },
  shoulderPress: { name: t('לחיצת כתפיים — דחיפה על הקביים', 'Shoulder press — pushing on the crutches'), cue: t('דחוף את התקרה — כתפיים חזקות נושאות אותך על הקביים', 'Push the ceiling — strong shoulders carry you on the crutches') },
  kneeUpBalance: { name: t('עמידה על הרגל המתפקדת — יציבות', 'Standing on the working leg — stability'), cue: t('עמוד על הרגל המתפקדת, אפשר להיעזר בקביים — גו זקוף ויציב', 'Stand on your working leg, crutch support allowed — tall and steady') },
  shadowKick: { name: t('בעיטה בצל על הקביים', 'Shadow kick on the crutches'), cue: t('משקל מעל הקביים, הרגל המתפקדת מצליפה מהירך', 'Weight over the crutches, the working leg whips from the hip') },
  shadowPass: { name: t('מסירה בצל על הקביים — פנים כף הרגל', 'Shadow pass on the crutches — inside of the foot'), cue: t('משקל מעל הקביים, תנופה קצרה ומדויקת', 'Weight over the crutches, a short accurate swing') },
  singleLegSquat: { name: t('סקוואט על רגל אחת — בתמיכת קביים', 'Single-leg squat — crutch-supported'), cue: t('קביים בצדדים לייצוב, רד לאט על הרגל המתפקדת והתרומם בשליטה', 'Crutches at your sides for support, lower slowly on the working leg, rise with control') },
  singleLegLunge: { name: t("לאנג' על רגל אחת — בתמיכת קביים", 'Single-leg lunge — crutch-supported'), cue: t('הקביים מייצבות, רד ישר למטה על הרגל המתפקדת', 'The crutches stabilize, drop straight down on the working leg') },
};

// WITH a ball today: the kick / pass become real ball work — same motion, same Ghost — with a
// location-specific set-up (home: soft control kicks; yard / field: to a wall or a goal)
const BALL_LABELS = {
  shadowKick: {
    home: { name: t('בעיטה בכדור לקיר — שליטה', 'Kick a ball to the wall — control'), cue: t('בעיטות שליטה רכות לקיר מ-2 מטר, החזה מעל הכדור', 'Soft control kicks to the wall from 2 m, chest over the ball') },
    out: { name: t('בעיטה בכדור — טכניקת בעיטה', 'Ball kick — kicking technique'), cue: t('לקיר או לשער מ-5–10 מטר: הירך מובילה, הקרסול נעול', 'To a wall or goal from 5–10 m: the hip leads, ankle locked') },
  },
  shadowPass: {
    home: { name: t('מסירה בכדור לקיר — פנים כף הרגל', 'Pass a ball to the wall — inside of the foot'), cue: t('מסירות קצרות לקיר מ-2 מטר וקבלת הכדור בחזרה', 'Short passes to the wall from 2 m and receive it back') },
    out: { name: t('מסירה בכדור — פנים כף הרגל', 'Ball pass — inside of the foot'), cue: t('מסירות לקיר או לשותף מ-5 מטר, כף רגל פתוחה', 'Passes to a wall or partner from 5 m, foot open') },
  },
};

/**
 * Today's ball work for a kick / pass pattern: { name, cue } or null (no ball / not a kick).
 * On crutches the line keeps the crutch wording.
 */
export function ballLabel({ hasBall, location, crutches }, patternId) {
  const b = hasBall === true ? BALL_LABELS[patternId] : null;
  if (!b) return null;
  const v = location === 'home' ? b.home : b.out;
  if (!crutches) return v;
  return { name: t(`${v.name.he} — על הקביים`, `${v.name.en} — on the crutches`), cue: t(`משקל מעל הקביים. ${v.cue.he}`, `Weight over the crutches. ${v.cue.en}`) };
}

/** Crutch-user wording for a pattern (null when not on crutches / no special wording). */
export function crutchLabel(lp, patternId) {
  return lp?.crutches ? (CRUTCH_LABELS[patternId] || null) : null;
}

/** The sport's own name / cue for a pattern (null when the sport has no special language for it). */
export function sportLabel(sport, patternId) {
  return SPORT_LABELS[sport]?.[patternId] || null;
}

export { ARM_ISOLATION };

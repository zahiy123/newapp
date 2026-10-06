// ============================================================
// patterns — the MOVEMENT PATTERNS of the exercise catalog (Stage 3.1)
//
// A pattern is a distinct movement the app can DEMONSTRATE (a Ghost) and, for expert
// patterns, MEASURE (an Expert Execution Profile). Every catalog exercise is a pattern ×
// a variation (variations.js) — so no exercise can exist without a Ghost.
//
//   source     { profile: <expert profile id> } (Ghost + full measurement)
//              { move: <warm-up Ghost move> }   (Ghost + required-limbs coverage)
//   qualities  what it trains — matched against the session goal (coherence)
//   sports     'all' or the sport families it belongs to
//   needs      body requirements: 'standing' (not from a wheelchair), 'twoLegs' (jumps / landings
//              on both legs), 'floor' (down on the floor), 'arms' (needs a working arm)
//   unilateral the variation names a side (left / right / alternating)
//   names      Hebrew / English (the Hebrew name keeps the analyzer keyword of the movement)
// ============================================================

const t = (he, en) => ({ he, en });

/** @type {Object<string, Object>} */
export const PATTERNS = Object.freeze({
  // ---- Strength / lower body ----
  squat: { source: { profile: 'squat' }, qualities: ['strength', 'lowerBody'], sports: 'all', needs: ['standing'],
    name: t('סקוואט', 'Squat'), cue: t('דחוף את הרצפה למטה ועלה', 'Push the floor away and stand up') },
  miniSquat: { source: { profile: 'miniSquat' }, qualities: ['rehab', 'strength', 'stability', 'activation'], sports: 'all', needs: ['standing'],
    name: t('מיני סקוואט', 'Mini squat'), cue: t('ירידה קטנה ומבוקרת, ברכיים מעל האצבעות', 'A small controlled dip, knees over the toes') },
  lunge: { source: { profile: 'lunge' }, qualities: ['strength', 'balance', 'lowerBody'], sports: 'all', needs: ['standing', 'twoLegs'], unilateral: true,
    name: t("לאנג'", 'Lunge'), cue: t('רד ישר למטה כמו מעלית', 'Drop straight down like an elevator') },
  wallSit: { source: { profile: 'wallSit' }, qualities: ['strength', 'endurance', 'rehab'], sports: 'all', needs: ['standing'],
    name: t('ישיבה על הקיר', 'Wall sit'), cue: t('הצמד את הגב לקיר ודחוף את הרצפה', 'Back to the wall, push the floor') },
  hipHinge: { source: { profile: 'hipHinge' }, qualities: ['strength', 'posteriorChain'], sports: 'all', needs: ['standing'],
    name: t('גוד מורנינג — הטיית אגן', 'Good morning — hip hinge'), cue: t('שלח את הישבן אחורה אל הקיר', 'Send your hips back to the wall') },
  gluteBridge: { source: { profile: 'gluteBridge' }, qualities: ['strength', 'rehab', 'posteriorChain', 'activation'], sports: 'all', needs: ['floor'],
    name: t('גשר ישבן', 'Glute bridge'), cue: t('דחוף את הרצפה עם העקבים והרם את האגן לתקרה', 'Drive the floor with your heels, hips to the ceiling') },
  // ---- Upper body ----
  pushUp: { source: { profile: 'pushUp' }, qualities: ['strength', 'core', 'upperBody'], sports: 'all', needs: ['floor', 'arms'],
    name: t('שכיבות סמיכה', 'Push-ups'), cue: t('דחוף את הרצפה הרחק ממך', 'Push the floor away from you') },
  plank: { source: { profile: 'plank' }, qualities: ['core', 'stability', 'rehab'], sports: 'all', needs: ['floor'],
    name: t('פלאנק', 'Plank'), cue: t('גוף אחד ישר כמו קרש', 'One straight line, like a board') },
  shoulderPress: { source: { profile: 'shoulderPress' }, qualities: ['strength', 'upperBody'], sports: 'all', needs: ['arms'],
    name: t('לחיצת כתפיים', 'Shoulder press'), cue: t('דחוף את התקרה למעלה', 'Push the ceiling up') },
  lateralRaise: { source: { profile: 'lateralRaise' }, qualities: ['strength', 'upperBody', 'rehab'], sports: 'all', needs: ['arms'],
    name: t('הרמה צידית', 'Lateral raise'), cue: t('שלח את הידיים לקירות שבצדדים', 'Reach your hands to the side walls') },
  frontRaise: { source: { profile: 'frontRaise' }, qualities: ['strength', 'upperBody'], sports: 'all', needs: ['arms'],
    name: t('הרמה קדמית', 'Front raise'), cue: t('הצבע עם הידיים על הקיר שמולך', 'Point your hands at the wall in front') },
  rehabFrontRaise: { source: { profile: 'rehabFrontRaise' }, qualities: ['rehab', 'mobility', 'upperBody'], sports: 'all', needs: ['arms'],
    name: t('הרמת יד קדמית מבוקרת', 'Controlled front raise'), cue: t('לאט, כאילו מרימים כוס מלאה', 'Slowly, as if lifting a full glass') },
  bicepCurl: { source: { profile: 'bicepCurl' }, qualities: ['strength', 'upperBody'], sports: 'all', needs: ['arms'],
    name: t('כפיפות מרפק ביספס', 'Bicep curl'), cue: t('הבא את כף היד אל הכתף', 'Bring your palm to your shoulder') },
  rehabElbowFlex: { source: { profile: 'rehabElbowFlex' }, qualities: ['rehab', 'mobility', 'upperBody'], sports: 'all', needs: ['arms'],
    name: t('כיפוף מרפק אקטיבי', 'Active elbow flexion'), cue: t('תנועה חלקה ומלאה, בלי כאב', 'A smooth full movement, pain-free') },
  // ---- Speed / running / coordination ----
  runInPlace: { source: { profile: 'runInPlace' }, qualities: ['endurance', 'speed', 'conditioning'], sports: 'all', needs: ['standing', 'twoLegs'],
    name: t('ריצה במקום', 'Running in place'), cue: t('צעדים קלים ומהירים, דחוף את הקרקע', 'Light quick steps, push the ground') },
  highKnees: { source: { profile: 'highKnees' }, qualities: ['speed', 'coordination', 'conditioning', 'activation'], sports: 'all', needs: ['standing', 'twoLegs'],
    name: t('ברכיים גבוהות', 'High knees'), cue: t('הרם את הברך אל כף היד', 'Drive your knee up to your hand') },
  buttKicks: { source: { profile: 'buttKicks' }, qualities: ['coordination', 'activation', 'speed'], sports: 'all', needs: ['standing', 'twoLegs'],
    name: t('בעיטות ישבן', 'Butt kicks'), cue: t('העקב פוגש את הישבן', 'Heel meets the glutes') },
  aSkip: { source: { profile: 'aSkip' }, qualities: ['coordination', 'speed', 'activation'], sports: 'all', needs: ['standing', 'twoLegs'],
    name: t('צעדי A — ברכיים גבוהות בקפיצה', 'A-skip — high-knee skip'), cue: t('ברך למעלה, כף רגל דורכת מתחת לגוף', 'Knee up, the foot strikes under the body') },
  accelMarch: { source: { profile: 'accelMarch' }, qualities: ['acceleration', 'speed', 'power'], sports: 'all', needs: ['standing', 'twoLegs'],
    name: t('האצה בהטיה — צעדת קיר', 'Acceleration lean — wall march'), cue: t('דחוף את הקיר ואת הקרקע אחורה', 'Push the wall and the ground back') },
  kneeUpBalance: { source: { profile: 'kneeUpBalance' }, qualities: ['balance', 'stability', 'rehab'], sports: 'all', needs: ['standing'], unilateral: true,
    name: t('עמידה על רגל אחת — ברך למעלה', 'Single-leg balance — knee up'), cue: t('צמח מהרגל העומדת אל התקרה', 'Grow tall from the standing leg') },
  jumpSquat: { source: { profile: 'jumpSquat' }, qualities: ['plyometric', 'power'], sports: 'all', needs: ['standing', 'twoLegs'],
    name: t('קפיצת סקוואט', 'Squat jump'), cue: t('דחוף את הרצפה ונחת שקט כמו חתול', 'Push the floor away, land quietly like a cat') },
  lateralShuffle: { source: { move: 'side_steps' }, qualities: ['agility', 'conditioning', 'activation'], sports: 'all', needs: ['standing', 'twoLegs'],
    name: t('החלקת הגנה — צעדי צד', 'Defensive slide — side steps'), cue: t('נמוך, רגליים לא נוגעות אחת בשנייה', 'Stay low, feet never touch') },
  kneeLiftMarch: { source: { move: 'single_knee' }, qualities: ['activation', 'balance', 'rehab', 'mobility'], sports: 'all', needs: ['standing'], unilateral: true,
    name: t('הרמת ברך בצעידה', 'Knee-lift march'), cue: t('הרם את הברך לאט והורד בשליטה', 'Lift the knee slowly, lower with control') },
  armCircles: { source: { move: 'arm_circles' }, qualities: ['mobility', 'activation'], sports: 'all', needs: ['arms'],
    name: t('סיבובי ידיים', 'Arm circles'), cue: t('מעגלים גדולים וחלקים מהכתף', 'Big smooth circles from the shoulder') },
  trunkRotation: { source: { move: 'twist' }, qualities: ['mobility', 'core'], sports: 'all', needs: [],
    name: t('סיבובי גו', 'Trunk rotations'), cue: t('הסתובב מהבטן, האגן יציב', 'Turn from the middle, hips stay still') },
  // ---- Sport skills (shadow drills) ----
  shadowKick: { source: { profile: 'footballKick' }, qualities: ['technique', 'power', 'sportSkill'], sports: ['field'], needs: ['standing'], unilateral: true,
    name: t('בעיטה בצל — תנועת בעיטה באוויר', 'Shadow kick — kicking motion in the air'), cue: t('הירך מובילה, הרגל מצליפה קדימה', 'The hip leads, the leg whips through') },
  shadowChestPass: { source: { move: 'chest_pass' }, qualities: ['technique', 'sportSkill', 'upperBody'], sports: ['court', 'seated'], needs: ['arms'],
    name: t('תנועת מסירת חזה בצל', 'Shadow chest pass'), cue: t('דחוף את הכדור הדמיוני אל חזה השותף', "Push the imaginary ball to your partner's chest") },
  shadowStroke: { source: { move: 'twist' }, qualities: ['technique', 'sportSkill', 'core'], sports: ['racket', 'seated'], needs: [],
    name: t('פורהנד בצל — תנועת מכה באוויר', 'Shadow forehand — stroke in the air'), cue: t('הכתפיים מסתובבות, הזרוע עוקבת', 'The shoulders turn, the arm follows') },
});

/** Pattern ids usable for a sport family (+ the generic 'all' patterns). */
export function patternsForFamily(family) {
  return Object.entries(PATTERNS)
    .filter(([, p]) => p.sports === 'all' || p.sports.includes(family))
    .map(([id]) => id);
}

/** Can this trainee do the pattern? (limbProfile + mobility aid) */
export function patternFitsBody(pattern, lp = {}) {
  const needs = new Set(pattern.needs || []);
  const leg = (s) => lp[`${s}_leg`] || { state: 'ok' };
  const legWorks = (s) => !(leg(s).state === 'absent' || (leg(s).state === 'prosthetic' && leg(s).level !== 'below_knee'));
  if (lp.wheelchair && (needs.has('standing') || needs.has('floor') || needs.has('twoLegs'))) return false;
  if (needs.has('twoLegs') && !(legWorks('left') && legWorks('right'))) return false;
  if (needs.has('standing') && !legWorks('left') && !legWorks('right')) return false;
  if (needs.has('arms') && lp.trainableArms && lp.trainableArms.length === 0) return false;
  return true;
}

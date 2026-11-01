// ============================================================
// basketball — the basketball movement library (owner, 2026-11-01), built like the football library: each entry
// is an Expert Execution Profile from the skill's biomechanics on the field-proven profiles (the shoulder press,
// the raises, the squat jump, the knee lift, the GK stance). The automatic gate (exerciseProfiles.test +
// sportLibraryCount.test) proves every one: its Ghost through the live evaluator, counted once per correct cycle.
//
// The arm movements measure the WORKING arm (combine 'max': a one-handed shot / dribble — the guide hand stays
// bent); they need only the arms + the torso, so the wheelchair player gets them too (posture by the trainee).
// ============================================================

const msg = (he, en) => ({ he, en });

export function basketballProfiles(base) {
  const { jumpSquat, runInPlace, gkStance, UPRIGHT_TORSO } = base;
  const ARMS_REQ = ['arms', 'torso'];
  const ELBOW_THROUGH = (value, he, en) => ({
    id: 'partial_push', metric: 'elbow', op: '<', value, severity: 'error', when: 'peak',
    msg: msg(he, en),
    why: msg('יישור מלא של המרפק הוא מה שנותן למסירה / לזריקה מהירות וכיוון — חצי תנועה זה חצי כוח', 'A full elbow extension is what gives the pass / the shot its speed and direction — half a movement is half the power'),
  });
  const STILL = UPRIGHT_TORSO(35);
  const armGhost = (rest, peak, periodMs = 1600) => ({ view: 'side', base: 'stand', periodMs, rest: { knee: 172, hip: 172, ...rest }, peak: { knee: 172, hip: 172, ...peak } });
  const JUMP = (id, he, en, kf, keyPoints, extraRules = []) => ({
    ...jumpSquat, id, name: msg(he, en),
    joints: { knee: { rest: [165, 180], peak: [92, 135] } },
    rules: [UPRIGHT_TORSO(58), ...extraRules],
    ghost: { view: 'side', base: 'stand', periodMs: 2000, restT: 0, peakT: 0.3, keyframes: kf },
    keyPoints,
  });

  const profiles = {
    // ---------- 1. Chest pass ----------
    chestPass: {
      id: 'chestPass', name: msg('מסירת חזה', 'Chest pass'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ARMS_REQ, primary: 'elbow',
      joints: { elbow: { rest: [55, 105], peak: [150, 180], combine: 'max' }, shoulder: { rest: [55, 105], peak: [65, 110], combine: 'max' } },
      rules: [ELBOW_THROUGH(124, 'דחוף עד הסוף — מרפקים ישרים, אגודלים למטה', 'Push all the way — elbows straight, thumbs down'), STILL],
      ghost: armGhost({ shoulder: 78, elbow: 78 }, { shoulder: 88, elbow: 170 }),
      keyPoints: ['הכדור מול החזה, מרפקים צמודים לגוף', 'צעד קדימה לכיוון המסירה בזמן הדחיפה', 'דחיפה מהירה ויישור מלא של המרפקים', 'בסוף — אגודלים למטה וכפות ידיים החוצה', 'הכדור נוסע ישר לחזה של המקבל'],
    },
    // ---------- 2. Bounce pass ----------
    bouncePass: {
      id: 'bouncePass', name: msg('מסירת ניתור', 'Bounce pass'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ARMS_REQ, primary: 'elbow',
      joints: { elbow: { rest: [55, 105], peak: [150, 180], combine: 'max' }, shoulder: { rest: [55, 105], peak: [25, 70], combine: 'max' } },
      rules: [ELBOW_THROUGH(124, 'דחוף עד הסוף, למטה ולפנים', 'Push all the way, down and forward'), STILL],
      ghost: armGhost({ shoulder: 75, elbow: 78 }, { shoulder: 45, elbow: 170 }),
      keyPoints: ['הכדור מול החזה, ברכיים כפופות', 'דחיפה למטה וקדימה — הכדור פוגע ברצפה בשני שליש מהדרך', 'יישור מלא של המרפקים, אגודלים למטה', 'צעד לכיוון המסירה', 'הכדור עולה לגובה המותן של המקבל'],
    },
    // ---------- 3. Overhead pass ----------
    overheadPass: {
      id: 'overheadPass', name: msg('מסירה מעל הראש', 'Overhead pass'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ARMS_REQ, primary: 'elbow',
      joints: { elbow: { rest: [50, 105], peak: [150, 180], combine: 'max' }, shoulder: { rest: [140, 180], peak: [140, 180], combine: 'max' } },
      rules: [ELBOW_THROUGH(124, 'הצלף קדימה עד יישור מלא — מהמרפקים, לא מאחורי הראש', 'Snap forward to a full extension — from the elbows, not behind the head'), STILL],
      ghost: armGhost({ shoulder: 162, elbow: 80 }, { shoulder: 160, elbow: 170 }),
      keyPoints: ['הכדור מעל המצח — לא מאחורי הראש', 'מרפקים מעט כפופים ומכוונים קדימה', 'הצלפה של שורשי כף היד קדימה', 'צעד לכיוון המסירה', 'מסירה מעל שחקן ההגנה, לכתפי המקבל'],
    },
    // ---------- 4. Set shot / form shooting ----------
    setShot: {
      id: 'setShot', name: msg('זריקה לסל — טכניקת זריקה', 'Set shot — shooting form'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ARMS_REQ, primary: 'elbow',
      joints: { elbow: { rest: [60, 110], peak: [150, 180], combine: 'max' }, shoulder: { rest: [75, 125], peak: [140, 180], combine: 'max' } },
      rules: [ELBOW_THROUGH(126, 'יישר את יד הזריקה עד הסוף — "יד בתוך הסל"', 'Fully extend the shooting arm — "hand in the basket"'), STILL],
      ghost: armGhost({ shoulder: 100, elbow: 85 }, { shoulder: 158, elbow: 172 }, 1800),
      keyPoints: ['המרפק של יד הזריקה מתחת לכדור, בקו עם הסל', 'יד העזר רק בצד הכדור — לא דוחפת', 'הכוח עולה מהרגליים ליד', 'יישור מלא ו"צוואר ברבור" — שורש כף היד מתקפל למטה', 'העיניים על הטבעת לאורך כל הזריקה'],
    },
    // ---------- 5. Jump shot (shadow) ----------
    jumpShot: JUMP('jumpShot', 'זריקה בניתור', 'Jump shot', [
      { t: 0, a: { knee: 172, hip: 170, shoulder: 100, elbow: 85, rise: 0 } },
      { t: 0.3, a: { knee: 112, hip: 115, shoulder: 100, elbow: 80, rise: 0 } },
      { t: 0.45, a: { knee: 178, hip: 176, shoulder: 150, elbow: 120, rise: 0.22 } },
      { t: 0.55, a: { knee: 176, hip: 174, shoulder: 160, elbow: 172, rise: 0.3 } },
      { t: 0.63, a: { knee: 166, hip: 164, shoulder: 140, elbow: 165, rise: 0 } },
      { t: 0.74, a: { knee: 146, hip: 145, shoulder: 110, elbow: 140, rise: 0 } },
    ], ['ירידה קלה בברכיים — הכוח מגיע מהרגליים', 'הקפיצה ישר למעלה, נחיתה באותו מקום', 'השחרור בשיא הקפיצה', 'מרפק מתחת לכדור, יישור מלא וצוואר ברבור', 'נחיתה רכה על כריות כפות הרגליים']),
    // ---------- 6. Rebound jump ----------
    reboundJump: JUMP('reboundJump', 'קפיצה לריבאונד', 'Rebound jump', [
      { t: 0, a: { knee: 170, hip: 165, shoulder: 60, elbow: 120, rise: 0 } },
      { t: 0.3, a: { knee: 110, hip: 110, shoulder: 30, elbow: 130, rise: 0 } },
      { t: 0.45, a: { knee: 178, hip: 176, shoulder: 168, elbow: 165, rise: 0.3 } },
      { t: 0.55, a: { knee: 176, hip: 174, shoulder: 170, elbow: 168, rise: 0.36 } },
      { t: 0.63, a: { knee: 166, hip: 164, shoulder: 120, elbow: 150, rise: 0 } },
      { t: 0.74, a: { knee: 145, hip: 142, shoulder: 80, elbow: 120, rise: 0 } },
    ], ['עמידה רחבה וברכיים כפופות לפני הקפיצה', 'שתי ידיים מושטות למעלה בשיא', 'תפיסת הכדור בנקודה הגבוהה ביותר', 'נחיתה רכה ורחבה, מרפקים החוצה להגנה על הכדור', 'הכדור מוצמד לסנטר אחרי הנחיתה']),
    // ---------- 7. Block jump ----------
    blockJump: JUMP('blockJump', 'קפיצה לחסימה', 'Block jump', [
      { t: 0, a: { knee: 168, hip: 165, shoulder: 150, elbow: 160, rise: 0 } },
      { t: 0.3, a: { knee: 106, hip: 108, shoulder: 140, elbow: 160, rise: 0 } },
      { t: 0.45, a: { knee: 178, hip: 176, shoulder: 172, elbow: 172, rise: 0.25 } },
      { t: 0.55, a: { knee: 176, hip: 175, shoulder: 172, elbow: 172, rise: 0.3 } },
      { t: 0.63, a: { knee: 168, hip: 166, shoulder: 160, elbow: 165, rise: 0 } },
      { t: 0.74, a: { knee: 146, hip: 145, shoulder: 150, elbow: 160, rise: 0 } },
    ], ['ידיים כבר למעלה לפני הקפיצה', 'קפיצה ישר למעלה — לא קדימה (עבירה)', 'שתי ידיים ישרות מעל הראש, כפות פתוחות', 'נחיתה רכה באותו מקום', 'חזרה מיד לעמדת הגנה']),
    // ---------- 8. Layup drive (the knee drive of the take-off) ----------
    layupDrive: {
      id: 'layupDrive', name: msg('עליה לסל — הנעת הברך', 'Layup — the knee drive'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'hip',
      joints: { hip: { rest: [155, 180], peak: [80, 122] } },
      rules: [
        { id: 'knee_low', metric: 'hip', op: '>', value: 128, severity: 'error', when: 'peak',
          msg: msg('הברך גבוה — ירך מקבילה לרצפה', 'Knee up — thigh parallel to the floor'),
          why: msg('הנעת הברך מעבירה את המהירות של הריצה לגובה של הקפיצה', 'The knee drive turns the run\'s speed into the jump\'s height') },
        UPRIGHT_TORSO(30),
      ],
      dynamics: [],
      ghost: {
        view: 'side', base: 'stride', periodMs: 1800, restT: 0, peakT: 0.5, supportMustBear: true,
        keyframes: [
          { t: 0, a: { 'A.knee': 168, 'B.thigh': 4, 'B.knee': 165, trunk: 4, armA: 20, armB: 20, elbow: 140 } },
          { t: 0.4, a: { 'A.knee': 170, 'B.thigh': 80, 'B.knee': 85, trunk: 4, armA: 150, armB: 30, elbow: 165 } },
          { t: 0.6, a: { 'A.knee': 170, 'B.thigh': 80, 'B.knee': 85, trunk: 4, armA: 150, armB: 30, elbow: 165 } },
        ],
      },
      keyPoints: ['שני צעדים: ימין־שמאל לעליה מימין', 'הברך של הרגל הנגדית ליד הזריקה עולה גבוה', 'היד מושטת לטבעת, הכדור מוגן ביד השנייה', 'הקפיצה למעלה — לא קדימה', 'הכדור משתחרר בשיא, לקרש מעל הטבעת'],
    },
    // ---------- 9. Dribble pound ----------
    dribblePound: {
      id: 'dribblePound', name: msg('כדרור חזק במקום', 'Pound dribble'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ARMS_REQ, primary: 'elbow',
      joints: { elbow: { rest: [70, 115], peak: [145, 180], combine: 'max' } },
      rules: [UPRIGHT_TORSO(60)],
      dynamics: [],
      ghost: { view: 'side', base: 'stand', periodMs: 700, rest: { knee: 140, hip: 135, shoulder: 35, elbow: 95 }, peak: { knee: 140, hip: 135, shoulder: 25, elbow: 165 } },
      keyPoints: ['כדרור בכריות האצבעות — לא בכף היד', 'הכדור לא עולה מעל גובה המותן', 'ברכיים כפופות, עמידה נמוכה', 'העיניים למעלה — לא על הכדור', 'היד השנייה מגינה על הכדור'],
    },
    // ---------- 10. Defensive stance (hold) ----------
    defensiveStance: {
      ...gkStance, id: 'defensiveStance', name: msg('עמידת הגנה', 'Defensive stance'),
      joints: { knee: { rest: [115, 152] }, hip: { rest: [100, 148] } },
      rules: [
        { id: 'too_high', metric: 'knee', op: '>', value: 158, severity: 'error', when: 'any',
          msg: msg('נמוך יותר — ישבן למטה, ברכיים כפופות', 'Lower — hips down, knees bent'),
          why: msg('מגן גבוה מגיב לאט — עמידה נמוכה נותנת צעד ראשון מהיר לכל כיוון', 'A tall defender reacts slowly — a low stance gives a quick first step in any direction') },
        UPRIGHT_TORSO(45),
      ],
      ghost: { view: 'side', base: 'stand', periodMs: 4000, rest: { knee: 132, hip: 122, shoulder: 60, elbow: 140 } },
      keyPoints: ['רגליים רחבות מהכתפיים, משקל על כריות כפות הרגליים', 'ברכיים כפופות, ישבן למטה', 'גב זקוף, ראש מעל הבסיס', 'ידיים פעילות — אחת על הכדור, אחת על קו המסירה', 'מוכן לזוז לכל כיוון בלי להצליב רגליים'],
    },
    // ---------- 11. Box out (hold) ----------
    boxOut: {
      ...gkStance, id: 'boxOut', name: msg('חסימת ריבאונד — בוקס אאוט', 'Box out'),
      joints: { knee: { rest: [112, 152] }, hip: { rest: [108, 155] } },
      rules: [
        { id: 'too_high', metric: 'knee', op: '>', value: 158, severity: 'error', when: 'any',
          msg: msg('נמוך ורחב — ישבן אחורה אל היריב', 'Low and wide — hips back into the opponent'),
          why: msg('מרכז כובד נמוך ובסיס רחב הם מה שמחזיק את היריב מאחוריך', 'A low center of mass and a wide base are what keep the opponent behind you') },
        UPRIGHT_TORSO(45),
      ],
      ghost: { view: 'side', base: 'stand', periodMs: 4000, rest: { knee: 130, hip: 132, shoulder: 85, elbow: 95 } },
      keyPoints: ['פנים אל הסל, גב אל היריב', 'עמידה רחבה, ברכיים כפופות, ישבן אחורה', 'מרפקים החוצה, ידיים למעלה מוכנות לכדור', 'מגע עם היריב — דוחפים אחורה עם הישבן', 'קופצים לכדור רק אחרי שהיריב חסום'],
    },
    // ---------- 12. Triple threat (hold) ----------
    tripleThreat: {
      ...gkStance, id: 'tripleThreat', name: msg('עמידת שלושת האיומים', 'Triple-threat stance'),
      joints: { knee: { rest: [128, 165] }, hip: { rest: [118, 162] } },
      rules: [
        { id: 'too_high', metric: 'knee', op: '>', value: 168, severity: 'error', when: 'any',
          msg: msg('ברכיים כפופות — מוכן לזרוק, למסור או לכדרר', 'Knees bent — ready to shoot, pass or drive'),
          why: msg('ברכיים כפופות הן מה שמאפשר את שלושת האיומים מהר', 'Bent knees are what make all three threats quick') },
        UPRIGHT_TORSO(40),
      ],
      ghost: { view: 'side', base: 'stand', periodMs: 4000, rest: { knee: 148, hip: 142, shoulder: 35, elbow: 85 } },
      keyPoints: ['הכדור בצד המותן של יד הזריקה, מוגן', 'ברכיים כפופות, משקל מאוזן', 'רגל הציר יציבה', 'מבט על הסל ועל ההגנה', 'מוכן לזרוק, למסור או לכדרר'],
    },
    // ---------- 13. Quick feet ----------
    quickFeet: {
      ...runInPlace, id: 'quickFeet', name: msg('רגליים מהירות', 'Quick feet'),
      joints: { hip: { rest: [158, 180], peak: [125, 160] }, elbow: { rest: [60, 130], peak: [60, 130] } },
      ghost: {
        view: 'side', base: 'stride', alternate: true, periodMs: 600, restT: 0, peakT: 0.175,
        keyframes: [
          { t: 0, a: { 'A.knee': 166, 'B.thigh': 4, 'B.knee': 168, trunk: 5, armA: 10, armB: 10, elbow: 95 } },
          { t: 0.35, a: { 'A.knee': 160, 'B.thigh': 34, 'B.knee': 118, trunk: 5, armA: 24, armB: -14, elbow: 95 } },
          { t: 0.7, a: { 'A.knee': 164, 'B.thigh': 16, 'B.knee': 145, trunk: 5, armA: 14, armB: -4, elbow: 95 } },
        ],
      },
      keyPoints: ['על כריות כפות הרגליים, עקבים לא נוגעים', 'צעדים קטנים ומהירים מאוד', 'ברכיים כפופות, עמידה אתלטית', 'ידיים עובדות בקצב הרגליים', 'גו יציב, מבט קדימה'],
    },
  };
  const tags = {
    chestPass: ['strength', 'upperBody', 'ballSkill'], bouncePass: ['strength', 'upperBody', 'ballSkill'],
    overheadPass: ['upperBody', 'ballSkill', 'power'], setShot: ['upperBody', 'ballSkill'],
    jumpShot: ['plyometric', 'landing', 'ballSkill'], reboundJump: ['plyometric', 'landing', 'bilateral'], blockJump: ['plyometric', 'landing', 'bilateral'],
    layupDrive: ['ballSkill', 'singleLegStance', 'power'], dribblePound: ['ballSkill', 'upperBody'],
    defensiveStance: ['hold', 'isometric', 'lowerBody'], boxOut: ['hold', 'isometric', 'lowerBody'], tripleThreat: ['hold', 'isometric', 'lowerBody'],
    quickFeet: ['cyclic', 'coordination', 'agility'],
  };
  const how = {
    'chestPass.partial_push': msg('דמיין שאתה דוחף קיר — המרפקים מתיישרים עד הסוף והאגודלים מסתובבים למטה', 'Imagine pushing a wall — the elbows straighten fully and the thumbs turn down'),
    'setShot.partial_push': msg('יישר את היד עד שהיא מצביעה על הטבעת, ושורש כף היד מתקפל כאילו אתה מכניס יד לצנצנת עוגיות', 'Extend until the arm points at the rim, the wrist folding as if reaching into a cookie jar'),
    'layupDrive.knee_low': msg('דחוף את הרצפה ברגל העמידה ומשוך את הברך השנייה למעלה כאילו היא מושכת אותך לטבעת', 'Drive the floor with the take-off leg and pull the other knee up as if it lifts you to the rim'),
  };
  return { profiles, tags, how };
}

/** The basketball patterns (+ the shadow chest pass now on the expert chest pass). */
export function basketballPatterns(t) {
  const arms = (id, he, en, cueHe, cueEn, q = ['technique', 'sportSkill', 'upperBody']) => ({ source: { profile: id }, qualities: q, sports: ['court', 'seated'], needs: ['arms'], name: t(he, en), cue: t(cueHe, cueEn) });
  const legs = (id, he, en, cueHe, cueEn, q, needs = ['standing', 'twoLegs'], extra = {}) => ({ source: { profile: id }, qualities: q, sports: ['court'], needs, name: t(he, en), cue: t(cueHe, cueEn), ...extra });
  return {
    bouncePass: arms('bouncePass', 'מסירת ניתור', 'Bounce pass', 'למטה וקדימה, שני שליש מהדרך', 'Down and forward, two-thirds of the way'),
    overheadPass: arms('overheadPass', 'מסירה מעל הראש', 'Overhead pass', 'מעל המצח, הצלפה קדימה', 'Above the forehead, snap forward'),
    setShot: arms('setShot', 'זריקה לסל — טכניקת זריקה', 'Set shot — shooting form', 'מרפק מתחת לכדור, יד בתוך הסל', 'Elbow under the ball, hand in the basket'),
    dribblePound: arms('dribblePound', 'כדרור חזק במקום', 'Pound dribble', 'חזק, נמוך, עיניים למעלה', 'Hard, low, eyes up', ['technique', 'sportSkill', 'coordination']),
    jumpShot: legs('jumpShot', 'זריקה בניתור', 'Jump shot', 'מהרגליים ליד, שחרור בשיא', 'Legs to the hand, release at the top', ['technique', 'sportSkill', 'power']),
    reboundJump: legs('reboundJump', 'קפיצה לריבאונד', 'Rebound jump', 'רחב, למעלה בשתי ידיים, נחיתה רכה', 'Wide, up with both hands, a soft landing', ['plyometric', 'power', 'sportSkill']),
    blockJump: legs('blockJump', 'קפיצה לחסימה', 'Block jump', 'ידיים למעלה, ישר למעלה', 'Hands up, straight up', ['plyometric', 'power', 'sportSkill']),
    layupDrive: legs('layupDrive', 'עליה לסל — הנעת הברך', 'Layup — the knee drive', 'ברך למעלה, יד לטבעת', 'Knee up, hand to the rim', ['technique', 'sportSkill', 'power'], ['standing'], { unilateral: true }),
    defensiveStance: legs('defensiveStance', 'עמידת הגנה', 'Defensive stance', 'נמוך ורחב, ידיים פעילות', 'Low and wide, active hands', ['stability', 'strength', 'sportSkill'], ['standing', 'bilateralStance']),
    boxOut: legs('boxOut', 'חסימת ריבאונד — בוקס אאוט', 'Box out', 'ישבן אחורה, מרפקים החוצה', 'Hips back, elbows out', ['stability', 'strength', 'sportSkill'], ['standing', 'bilateralStance']),
    tripleThreat: legs('tripleThreat', 'עמידת שלושת האיומים', 'Triple-threat stance', 'כדור במותן, ברכיים כפופות', 'Ball at the hip, knees bent', ['stability', 'technique', 'sportSkill'], ['standing', 'bilateralStance']),
    quickFeet: legs('quickFeet', 'רגליים מהירות', 'Quick feet', 'על הכריות, צעדים זעירים ומהירים', 'On the balls of the feet, tiny fast steps', ['agility', 'speed', 'conditioning']),
  };
}

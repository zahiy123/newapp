// ============================================================
// tennis — the tennis movement library (owner, 2026-11-01), built like the football / basketball libraries on the
// field-proven profiles (the press / raise arms, the squat jump, the mini squat, the GK stance) and proven by the
// automatic gate (its Ghost through the live evaluator; counted once per correct cycle).
//
// The strokes measure the RACKET arm (combine 'max') and need only the arms + the torso — the wheelchair player
// gets every stroke. A stroke's rotation is not measurable from one camera; its measured part is the arm's path
// (back → through → the finish) and the extension, the rest is the coach's eyes on the stroke's peak frame.
// ============================================================

const msg = (he, en) => ({ he, en });

export function tennisProfiles(base) {
  const { jumpSquat, gkStance, UPRIGHT_TORSO } = base;
  const ARMS_REQ = ['arms', 'torso'];
  const STILL = UPRIGHT_TORSO(35);
  const armGhost = (rest, peak, periodMs = 1700) => ({ view: 'side', base: 'stand', periodMs, rest: { knee: 168, hip: 168, ...rest }, peak: { knee: 168, hip: 168, ...peak } });
  const FINISH = (value, he, en) => ({
    id: 'partial_swing', metric: 'shoulder', op: '<', value, severity: 'error', when: 'peak',
    msg: msg(he, en),
    why: msg('סיום מלא של התנועה הוא מה שנותן למכה עומק ושליטה — עצירה באמצע מאיטה את המחבט לפני הכדור', 'A full finish is what gives the stroke depth and control — stopping halfway slows the racket before the ball'),
  });
  const EXTEND = (value, he, en) => ({
    id: 'partial_reach', metric: 'elbow', op: '<', value, severity: 'error', when: 'peak',
    msg: msg(he, en),
    why: msg('פגיעה בנקודה הגבוהה ביותר עם יד ישרה נותנת זווית, כוח ושליטה', 'Striking at the highest point with a straight arm gives angle, power and control'),
  });
  const stroke = (id, he, en, keyPoints, finishHe, finishEn) => ({
    id, name: msg(he, en), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ARMS_REQ, primary: 'shoulder',
    joints: { shoulder: { rest: [15, 65], peak: [95, 140], combine: 'max' }, elbow: { rest: [110, 180], peak: [110, 180], combine: 'max' } },
    rules: [FINISH(80, finishHe, finishEn), STILL],
    ghost: armGhost({ shoulder: 35, elbow: 150 }, { shoulder: 118, elbow: 155 }),
    keyPoints,
  });
  const overhead = (id, he, en, keyPoints) => ({
    id, name: msg(he, en), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ARMS_REQ, primary: 'elbow',
    joints: { elbow: { rest: [55, 105], peak: [150, 180], combine: 'max' }, shoulder: { rest: [140, 180], peak: [145, 180], combine: 'max' } },
    rules: [EXTEND(124, 'פגע בנקודה הגבוהה ביותר — יד ישרה למעלה', 'Strike at the highest point — the arm straight up'), STILL],
    ghost: armGhost({ shoulder: 160, elbow: 80 }, { shoulder: 165, elbow: 172 }, 1900),
    keyPoints,
  });
  const volley = (id, he, en, keyPoints) => ({
    id, name: msg(he, en), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ARMS_REQ, primary: 'elbow',
    joints: { elbow: { rest: [95, 135], peak: [145, 178], combine: 'max' }, shoulder: { rest: [45, 100], peak: [50, 105], combine: 'max' } },
    rules: [
      { id: 'big_swing', metric: 'shoulder', op: '>', value: 118, severity: 'error', when: 'any',
        msg: msg('בלי תנופה — חבטה קצרה מול הגוף', 'No backswing — a short punch in front of the body'),
        why: msg('ברשת אין זמן לתנופה — תנופה גדולה מאחרת את הכדור ומאבדת שליטה', 'At the net there is no time for a backswing — a big swing is late and loses control') },
      STILL,
    ],
    ghost: armGhost({ shoulder: 70, elbow: 115 }, { shoulder: 80, elbow: 162 }, 1300),
    keyPoints,
  });

  const profiles = {
    forehand: stroke('forehand', 'פורהנד בצל', 'Shadow forehand', [
      'הכנה מוקדמת — הכתפיים מסתובבות והמחבט אחורה', 'הצעד ורגל העמידה מתחת לכדור, ברכיים כפופות', 'פגיעה לפני הגוף, בגובה המותן',
      'הכוח מהרגליים והגו — לא רק מהיד', 'סיום מעל הכתף הנגדית'], 'סיים את התנועה מעל הכתף הנגדית', 'Finish over the opposite shoulder'),
    backhand: stroke('backhand', 'בקהנד בצל', 'Shadow backhand', [
      'סיבוב כתפיים מוקדם, הגב כמעט אל הרשת', 'פגיעה לפני הרגל הקדמית', 'הזרוע מתיישרת בפגיעה, שורש כף היד יציב',
      'משקל עובר מהרגל האחורית לקדמית', 'סיום גבוה לכיוון המטרה'], 'סיים גבוה לכיוון המטרה', 'Finish high toward the target'),
    shadowServe: overhead('shadowServe', 'הגשה בצל', 'Shadow serve', [
      'עמדת הגביע: מרפק היד המכה בגובה הכתף, הזריקה ישרה למעלה', 'כיפוף ברכיים ודחיפה מהרגליים למעלה', 'פגיעה בנקודה הגבוהה ביותר עם יד ישרה',
      'פרונציה — כף היד מסתובבת החוצה בפגיעה', 'סיום לצד הנגדי של הגוף']),
    shadowSmash: overhead('shadowSmash', 'סמאש בצל', 'Shadow smash', [
      'סיבוב לצד, היד הנגדית מצביעה על הכדור', 'צעדי התאמה מתחת לכדור', 'המחבט מאחורי הראש בעמדת גביע',
      'פגיעה מעל ולפני הראש עם יד ישרה', 'סיום כלפי מטה לכיוון המגרש']),
    forehandVolley: volley('forehandVolley', 'וולה פורהנד', 'Forehand volley', [
      'עמדת מוכנות נמוכה, המחבט לפני הגוף', 'בלי תנופה — חבטה קצרה מול הגוף', 'צעד לכיוון הכדור עם הרגל הנגדית',
      'שורש כף היד נעול, ראש המחבט מעל היד', 'עצירה של התנועה מיד אחרי הפגיעה']),
    backhandVolley: volley('backhandVolley', 'וולה בקהנד', 'Backhand volley', [
      'סיבוב כתפיים קצר, המחבט ליד הכתף', 'חבטה קצרה ומבוקרת מול הגוף', 'צעד באלכסון קדימה עם הרגל הקרובה לכדור',
      'שורש כף היד נעול', 'החזרה מהירה לעמדת מוכנות']),
    // ---------- the serve's trophy position (hold) ----------
    trophyHold: {
      ...gkStance, id: 'trophyHold', name: msg('עמדת הגביע — הגשה', 'Serve trophy position'), require: ARMS_REQ, primary: 'shoulder',
      joints: { shoulder: { rest: [135, 180], combine: 'max' }, elbow: { rest: [65, 115], combine: 'max' } },
      rules: [
        { id: 'elbow_low', metric: 'shoulder', op: '<', value: 128, severity: 'error', when: 'any',
          msg: msg('מרפק היד המכה למעלה — לפחות בגובה הכתף', 'The hitting elbow up — at least at shoulder height'),
          why: msg('מרפק נמוך בגביע מעמיס על הכתף ומוריד את נקודת הפגיעה', 'A low elbow in the trophy loads the shoulder and lowers the contact point') },
        STILL,
      ],
      ghost: { view: 'side', base: 'stand', periodMs: 4000, rest: { knee: 150, hip: 158, shoulder: 158, elbow: 90 } },
      keyPoints: ['היד הזורקת ישרה למעלה, מצביעה על הכדור', 'מרפק היד המכה בגובה הכתף או מעליה', 'ברכיים כפופות, משקל על הרגל הקדמית', 'הכתפיים מוטות — הכתף הזורקת גבוהה', 'גו יציב, מבט על הכדור'],
    },
    // ---------- split step ----------
    splitStep: {
      ...jumpSquat, id: 'splitStep', name: msg('צעד פיצול', 'Split step'),
      joints: { knee: { rest: [162, 180], peak: [122, 152] } },
      rules: [UPRIGHT_TORSO(45)],
      dynamics: [],
      ghost: {
        view: 'side', base: 'stand', periodMs: 1400, restT: 0, peakT: 0.5,
        keyframes: [
          { t: 0, a: { knee: 170, hip: 165, shoulder: 40, elbow: 110, rise: 0 } },
          { t: 0.25, a: { knee: 175, hip: 172, shoulder: 40, elbow: 110, rise: 0.06 } },
          { t: 0.5, a: { knee: 136, hip: 135, shoulder: 40, elbow: 110, rise: 0 } },
          { t: 0.75, a: { knee: 165, hip: 160, shoulder: 40, elbow: 110, rise: 0 } },
        ],
      },
      keyPoints: ['קפיצה קטנה ממש ברגע שהיריב פוגע בכדור', 'נחיתה על כריות כפות הרגליים, רגליים ברוחב הכתפיים', 'ברכיים כפופות בנחיתה — מוכן לזנק', 'המחבט לפני הגוף', 'מיד אחרי הנחיתה — צעד ראשון לכיוון הכדור'],
    },
    // ---------- ready position (hold) ----------
    readyPosition: {
      ...gkStance, id: 'readyPosition', name: msg('עמדת מוכנות', 'Ready position'),
      joints: { knee: { rest: [128, 165] }, hip: { rest: [118, 162] } },
      rules: [
        { id: 'too_high', metric: 'knee', op: '>', value: 168, severity: 'error', when: 'any',
          msg: msg('ברכיים כפופות — משקל על כריות כפות הרגליים', 'Knees bent — weight on the balls of the feet'),
          why: msg('עמידה כפופה היא מה שנותן צעד ראשון מהיר לכדור', 'A bent stance is what gives a quick first step to the ball') },
        UPRIGHT_TORSO(40),
      ],
      ghost: { view: 'side', base: 'stand', periodMs: 4000, rest: { knee: 146, hip: 140, shoulder: 40, elbow: 100 } },
      keyPoints: ['רגליים מעט רחבות מהכתפיים', 'ברכיים כפופות, משקל על כריות כפות הרגליים', 'המחבט לפני הגוף, שתי ידיים עליו', 'גו מעט קדימה, מבט על היריב', 'מוכן לצעד פיצול'],
    },
    // ---------- open-stance load (the legs of a modern forehand) ----------
    openStanceLoad: {
      id: 'openStanceLoad', name: msg('טעינת רגליים בעמידה פתוחה', 'Open-stance load'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
      joints: { knee: { rest: [160, 180], peak: [112, 145] } },
      rules: [
        { id: 'too_shallow', metric: 'knee', op: '>', value: 150, severity: 'error', when: 'peak',
          msg: msg('טען עמוק יותר על הרגל החיצונית', 'Load deeper on the outside leg'),
          why: msg('הטעינה ברגל היא מקור הכוח של המכה — בלעדיה היד עושה את כל העבודה ונפצעת', 'The leg load is the stroke\'s power source — without it the arm does all the work and gets hurt') },
        UPRIGHT_TORSO(40),
      ],
      dynamics: [],
      ghost: { view: 'side', base: 'stand', periodMs: 2200, rest: { knee: 172, hip: 170, shoulder: 35, elbow: 140 }, peak: { knee: 128, hip: 132, shoulder: 45, elbow: 140 } },
      keyPoints: ['רגליים רחבות, המשקל יורד על הרגל החיצונית', 'הברך מעל האצבעות — לא נופלת פנימה', 'הכתפיים מסתובבות יחד עם הטעינה', 'דחיפה מהרגל למעלה וקדימה לתוך המכה', 'חזרה מהירה לעמדת מוכנות'],
    },
  };
  const tags = {
    forehand: ['upperBody', 'ballSkill'], backhand: ['upperBody', 'ballSkill'], shadowServe: ['upperBody', 'ballSkill', 'power'],
    shadowSmash: ['upperBody', 'ballSkill', 'power'], forehandVolley: ['upperBody', 'ballSkill'], backhandVolley: ['upperBody', 'ballSkill'],
    trophyHold: ['hold', 'isometric', 'upperBody'], splitStep: ['agility', 'ballSkill'], readyPosition: ['hold', 'isometric', 'lowerBody'],
    openStanceLoad: ['lowerBody', 'ballSkill'],
  };
  const how = {
    'forehand.partial_swing': msg('תן למחבט להמשיך דרך הכדור עד שהמרפק מגיע מול הסנטר והמחבט מעל הכתף הנגדית', 'Let the racket keep going through the ball until the elbow is at the chin and the racket over the opposite shoulder'),
    'backhand.partial_swing': msg('המשך את התנועה גבוה לכיוון המטרה, עד שהיד מעל גובה הכתף', 'Continue high toward the target, until the arm is above shoulder height'),
    'shadowServe.partial_reach': msg('דחוף מהרגליים למעלה ופגוש את הכדור עם יד ישרה לגמרי, כאילו אתה נוגע בתקרה', 'Drive up from the legs and meet the ball with a fully straight arm, as if touching the ceiling'),
    'openStanceLoad.too_shallow': msg('שב לתוך הרגל החיצונית כמו בסקוואט על רגל אחת, ואז דחוף ממנה לתוך המכה', 'Sit into the outside leg like a one-leg squat, then drive from it into the stroke'),
  };
  return { profiles, tags, how };
}

export function tennisPatterns(t) {
  const arms = (id, he, en, cueHe, cueEn, q = ['technique', 'sportSkill', 'upperBody']) => ({ source: { profile: id }, qualities: q, sports: ['racket', 'seated'], needs: ['arms'], name: t(he, en), cue: t(cueHe, cueEn) });
  const legs = (id, he, en, cueHe, cueEn, q, needs = ['standing', 'twoLegs']) => ({ source: { profile: id }, qualities: q, sports: ['racket'], needs, name: t(he, en), cue: t(cueHe, cueEn) });
  return {
    backhand: arms('backhand', 'בקהנד בצל', 'Shadow backhand', 'סיבוב כתפיים, סיום גבוה למטרה', 'Turn the shoulders, finish high to the target'),
    shadowServe: arms('shadowServe', 'הגשה בצל', 'Shadow serve', 'גביע, דחיפה מהרגליים, יד ישרה בפגיעה', 'Trophy, drive from the legs, a straight arm at contact', ['technique', 'sportSkill', 'power']),
    shadowSmash: arms('shadowSmash', 'סמאש בצל', 'Shadow smash', 'לצד, יד מצביעה, פגיעה מעל הראש', 'Side-on, point, strike above the head', ['technique', 'sportSkill', 'power']),
    forehandVolley: arms('forehandVolley', 'וולה פורהנד', 'Forehand volley', 'בלי תנופה, חבטה קצרה מול הגוף', 'No backswing, a short punch in front'),
    backhandVolley: arms('backhandVolley', 'וולה בקהנד', 'Backhand volley', 'קצר ומבוקר, שורש כף יד נעול', 'Short and controlled, wrist locked'),
    trophyHold: arms('trophyHold', 'עמדת הגביע — הגשה', 'Serve trophy position', 'מרפק למעלה, יד זורקת ישרה', 'Elbow up, tossing arm straight', ['technique', 'sportSkill', 'stability']),
    splitStep: legs('splitStep', 'צעד פיצול', 'Split step', 'קפיצה קטנה ונחיתה מוכנה', 'A small hop, land ready', ['agility', 'technique', 'sportSkill']),
    readyPosition: legs('readyPosition', 'עמדת מוכנות', 'Ready position', 'כפוף, על הכריות, מחבט לפנים', 'Bent, on the balls of the feet, racket in front', ['stability', 'technique', 'sportSkill'], ['standing', 'bilateralStance']),
    openStanceLoad: legs('openStanceLoad', 'טעינת רגליים בעמידה פתוחה', 'Open-stance load', 'שב לתוך הרגל החיצונית ודחוף', 'Sit into the outside leg and drive', ['technique', 'sportSkill', 'strength']),
  };
}

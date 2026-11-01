// ============================================================
// strength — the strength library (owner, 2026-11-01): general strength + adaptive / rehab strength.
//
// Many strength exercises share one MEASURED movement with a proven profile (a goblet / sumo squat measures like a
// squat, a split squat like a lunge, a Romanian deadlift like a hip hinge, a hammer curl like a curl) — they get
// that measurement (counting, ranges, danger rules) and their OWN name, cues, key points and why / how. The new
// movements (row, overhead triceps, upright row, sit-to-stand, wall push-up, band row, wall slide, rehab march,
// supported split squat) get new profiles. All pass the automatic gate (exerciseProfiles.test + the count test).
// ============================================================

const msg = (he, en) => ({ he, en });

export function strengthProfiles(base) {
  const { squat, lunge, hipHinge, pushUp, bicepCurl, shoulderPress, UPRIGHT_TORSO, KNEE_VALGUS } = base;
  const STILL = UPRIGHT_TORSO(25);
  const like = (parent, id, he, en, keyPoints, extra = {}) => ({ ...parent, id, name: msg(he, en), keyPoints, ...extra });
  const armGhost = (rest, peak, periodMs = 2800) => ({ view: 'side', base: 'stand', periodMs, rest: { knee: 174, hip: 174, ...rest }, peak: { knee: 174, hip: 174, ...peak } });

  const profiles = {
    // ================= General strength =================
    gobletSquat: like(squat, 'gobletSquat', 'סקוואט גביע', 'Goblet squat', ['הידיים צמודות לחזה כמו מחזיקות גביע, מרפקים למטה', 'ירידה בין הברכיים, החזה זקוף', 'ברכיים בכיוון האצבעות', 'עקבים על הרצפה לאורך כל התנועה', 'דחיפה מהעקבים למעלה']),
    sumoSquat: like(squat, 'sumoSquat', 'סקוואט סומו', 'Sumo squat', ['עמידה רחבה, אצבעות החוצה', 'הברכיים נדחפות החוצה בכיוון האצבעות', 'גו זקוף, ירידה ישר למטה', 'הישבן והירך הפנימית עובדים', 'עקבים על הרצפה']),
    splitSquat: like(lunge, 'splitSquat', 'ספליט סקוואט', 'Split squat', ['עמידת צעד קבועה — הרגליים לא זזות', 'ירידה ישר למטה עד 90 מעלות בברך הקדמית', 'המשקל על העקב הקדמי', 'גו זקוף, אגן ישר', 'הברך הקדמית מעל הקרסול']),
    reverseLunge: like(lunge, 'reverseLunge', "לאנג' אחורי", 'Reverse lunge', ['צעד ארוך אחורה, המשקל נשאר על הרגל הקדמית', 'הברך האחורית יורדת ישר לרצפה', 'גו זקוף, בטן מהודקת', 'דחיפה מהעקב הקדמי לחזרה', 'ברך קדמית מעל הקרסול — ידידותי לברך']),
    romanianDeadlift: like(hipHinge, 'romanianDeadlift', 'דדליפט רומני', 'Romanian deadlift', ['ברכיים רכות ונעולות במקום', 'הישבן נשלח אחורה — הגב ישר', 'הידיים קרובות לרגליים לאורך כל התנועה', 'ירידה עד מתיחה באחורי הירך', 'עלייה בדחיפת האגן קדימה, הישבן מכווץ']),
    hammerCurl: like(bicepCurl, 'hammerCurl', 'כפיפות פטיש', 'Hammer curl', ['אגודלים למעלה לאורך כל התנועה', 'מרפקים צמודים לגוף', 'בלי נדנוד של הגו', 'עלייה מבוקרת וירידה איטית', 'יישור מלא למטה']),
    arnoldPress: like(shoulderPress, 'arnoldPress', 'לחיצת ארנולד', 'Arnold press', ['כפות הידיים פונות אליך בתחתית', 'סיבוב כפות הידיים החוצה תוך כדי הלחיצה', 'יישור מלא למעלה', 'בטן מהודקת, בלי קשת בגב', 'ירידה מבוקרת עם סיבוב חזרה']),
    diamondPushUp: like(pushUp, 'diamondPushUp', 'שכיבות סמיכה יהלום', 'Diamond push-up', ['כפות הידיים צמודות מתחת לחזה — יהלום', 'מרפקים צמודים לגוף', 'גוף בקו ישר מהראש לעקבים', 'החזה יורד אל הידיים', 'הטרייספס עושה את העבודה']),
    widePushUp: like(pushUp, 'widePushUp', 'שכיבות סמיכה רחבות', 'Wide push-up', ['ידיים רחבות מהכתפיים', 'מרפקים בזווית של 45 מעלות — לא לצדדים', 'גוף בקו ישר', 'החזה יורד עד אגרוף מהרצפה', 'החזה עושה את העבודה']),
    // ---------- bent-over row ----------
    bentOverRow: {
      id: 'bentOverRow', name: msg('חתירה בהטיה', 'Bent-over row'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ['arms', 'torso', 'legs'], primary: 'elbow',
      joints: { elbow: { rest: [145, 180], peak: [60, 105] }, hip: { rest: [85, 135], peak: [85, 135] } },
      rules: [
        { id: 'too_shallow', metric: 'elbow', op: '>', value: 128, severity: 'error', when: 'peak',
          msg: msg('משוך עד הסוף — המרפקים מאחורי הגב', 'Pull all the way — the elbows behind the back'),
          why: msg('משיכה מלאה מכווצת את שרירי הגב בין השכמות — חצי תנועה עובדת רק על הזרוע', 'A full pull squeezes the back between the shoulder blades — half a pull works only the arm') },
        { id: 'over_bend', metric: 'trunkLean', op: '>', value: 100, severity: 'danger', when: 'any',
          msg: msg('עצור! הגב נופל — סכנה לגב התחתון', 'Stop! Your back is dropping — lower-back risk'),
          why: msg('גב שמתעגל תחת משקל מעמיס על הדיסקים בגב התחתון', 'A back rounding under load stresses the lower-back discs') },
      ],
      dynamics: [],
      ghost: { view: 'side', base: 'stand', periodMs: 2800, armsHang: true, rest: { knee: 160, hip: 110, elbow: 172, shank: 5 }, peak: { knee: 160, hip: 110, elbow: 80, shank: 5 } },
      keyPoints: ['הטיה מהאגן עם גב ישר, ברכיים רכות', 'משיכת המרפקים אחורה, צמודים לגוף', 'כיווץ השכמות למעלה', 'ירידה מבוקרת עד יישור מלא', 'הצוואר בקו הגב, מבט לרצפה'],
    },
    // ---------- overhead triceps extension ----------
    overheadTricep: {
      id: 'overheadTricep', name: msg('פשיטת מרפקים מעל הראש', 'Overhead triceps extension'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ['arms', 'torso'], primary: 'elbow',
      joints: { elbow: { rest: [35, 90], peak: [148, 180], combine: 'max' }, shoulder: { rest: [140, 180], peak: [140, 180], combine: 'max' } },
      rules: [
        { id: 'partial_ext', metric: 'elbow', op: '<', value: 115, severity: 'error', when: 'peak',
          msg: msg('יישר את המרפקים עד הסוף למעלה', 'Straighten the elbows fully overhead'),
          why: msg('יישור מלא מפעיל את הטרייספס בכל הטווח', 'A full extension works the triceps through its whole range') },
        STILL,
      ],
      dynamics: [],
      ghost: armGhost({ shoulder: 165, elbow: 60 }, { shoulder: 165, elbow: 170 }),
      keyPoints: ['המרפקים מצביעים לתקרה וקרובים לראש', 'רק האמה זזה — הכתף נשארת במקום', 'יישור מלא למעלה', 'ירידה איטית מאחורי הראש', 'בטן מהודקת, בלי קשת בגב'],
    },
    // ---------- upright row ----------
    uprightRow: {
      id: 'uprightRow', name: msg('חתירה זקופה', 'Upright row'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ['arms', 'torso'], primary: 'shoulder',
      joints: { shoulder: { rest: [0, 35], peak: [65, 105], combine: 'max' }, elbow: { rest: [145, 180], peak: [60, 115], combine: 'min' } },
      rules: [
        { id: 'too_high', metric: 'shoulder', op: '>', value: 115, severity: 'error', when: 'any',
          msg: msg('המרפקים עד גובה הכתפיים — לא מעל', 'Elbows up to shoulder height — not above'),
          why: msg('הרמה מעל גובה הכתף צובטת את גידי הכתף', 'Lifting above shoulder height pinches the shoulder tendons') },
        STILL,
      ],
      dynamics: [],
      ghost: armGhost({ shoulder: 12, elbow: 168 }, { shoulder: 85, elbow: 85 }),
      keyPoints: ['אחיזה ברוחב הכתפיים', 'המרפקים מובילים למעלה — גבוהים מכפות הידיים', 'עד גובה הכתפיים, לא מעל', 'גו זקוף, בלי נדנוד', 'ירידה מבוקרת'],
    },

    // ================= Adaptive / rehab strength =================
    // ---------- sit to stand ----------
    sitToStand: {
      id: 'sitToStand', name: msg('קימה מכיסא', 'Sit to stand'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
      joints: { knee: { rest: [150, 180], peak: [80, 115] }, hip: { rest: [150, 180], peak: [75, 120] } },
      rules: [UPRIGHT_TORSO(62), KNEE_VALGUS('peak')],
      dynamics: [],
      ghost: { view: 'side', base: 'stand', periodMs: 3800, rest: { knee: 174, hip: 172, shoulder: 70, elbow: 170 }, peak: { knee: 96, hip: 92, shoulder: 75, elbow: 170 } },
      keyPoints: ['כפות הרגליים מעט מאחורי הברכיים', 'הגו נוטה קדימה — "האף מעל האצבעות"', 'דחיפה מהעקבים לעמידה מלאה', 'ירידה איטית ומבוקרת אל הכיסא', 'ברכיים בכיוון האצבעות — לא פנימה'],
    },
    // ---------- wall push-up ----------
    wallPushUp: {
      id: 'wallPushUp', name: msg('שכיבות סמיכה על הקיר', 'Wall push-up'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ['arms', 'torso'], primary: 'elbow',
      joints: { elbow: { rest: [148, 180], peak: [80, 118] }, shoulder: { rest: [65, 105], peak: [55, 105] } },
      rules: [
        { id: 'too_shallow', metric: 'elbow', op: '>', value: 132, severity: 'error', when: 'peak',
          msg: msg('קרב את החזה לקיר — מרפקים ל-90 מעלות', 'Bring the chest to the wall — elbows to 90°'),
          why: msg('טווח מלא בונה כוח בחזה ובכתף בלי עומס על הפרקים', 'A full range builds chest and shoulder strength without loading the joints') },
        STILL,
      ],
      dynamics: [],
      ghost: armGhost({ shoulder: 85, elbow: 168 }, { shoulder: 80, elbow: 95 }, 3000),
      keyPoints: ['ידיים על הקיר בגובה הכתפיים', 'הגוף בקו ישר מהראש לעקבים', 'החזה יורד אל הקיר במרפקים כפופים', 'דחיפה חזרה עד יישור', 'נשימה רגועה — נשיפה בדחיפה'],
    },
    // ---------- scapular row (bodyweight, seated or standing) ----------
    scapularRow: {
      id: 'scapularRow', name: msg('חתירה — כיווץ שכמות', 'Scapular row'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ['arms', 'torso'], primary: 'elbow',
      joints: { elbow: { rest: [145, 180], peak: [60, 110] }, shoulder: { rest: [60, 105], peak: [15, 65] } },
      rules: [
        { id: 'too_shallow', metric: 'elbow', op: '>', value: 128, severity: 'error', when: 'peak',
          msg: msg('משוך עד הסוף — המרפקים ליד הצלעות', 'Pull all the way — the elbows by the ribs'),
          why: msg('משיכה מלאה מכווצת את שרירי הגב והשכמות — היציבה של הכתף', 'A full pull works the back and shoulder blades — the shoulder\'s posture') },
        STILL,
      ],
      dynamics: [],
      ghost: armGhost({ shoulder: 85, elbow: 168 }, { shoulder: 35, elbow: 82 }, 3000),
      keyPoints: ['ידיים ישרות קדימה בתחילת התנועה, כאילו אוחזות במשוט', 'משיכת המרפקים אחורה ליד הצלעות', 'כיווץ השכמות זו אל זו', 'גו זקוף — בלי להישען אחורה', 'שחרור איטי קדימה'],
    },
    // ---------- wall slide ----------
    wallSlide: {
      ...shoulderPress, id: 'wallSlide', name: msg('החלקת ידיים על הקיר', 'Wall slide'),
      ghost: { ...shoulderPress.ghost, periodMs: 3600 },
      keyPoints: ['הגב, האמות והגב של כפות הידיים צמודים לקיר', 'החלקה איטית למעלה עד יישור', 'השכמות יורדות ונצמדות', 'בלי לנתק את הגב התחתון מהקיר', 'ירידה איטית לזווית 90 במרפקים'],
    },
    // ---------- rehab march ----------
    rehabMarch: {
      id: 'rehabMarch', name: msg('הרמת ברך שיקומית', 'Rehab knee march'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'hip',
      joints: { hip: { rest: [155, 180], peak: [98, 140] } },
      rules: [UPRIGHT_TORSO(20)],
      dynamics: [],
      ghost: {
        view: 'side', base: 'stride', periodMs: 3000, restT: 0, peakT: 0.5, supportMustBear: true,
        keyframes: [
          { t: 0, a: { 'A.knee': 172, 'B.thigh': 2, 'B.knee': 172, trunk: 2, armA: 20, armB: 20, elbow: 160 } },
          { t: 0.4, a: { 'A.knee': 172, 'B.thigh': 60, 'B.knee': 95, trunk: 2, armA: 25, armB: 25, elbow: 160 } },
          { t: 0.6, a: { 'A.knee': 172, 'B.thigh': 60, 'B.knee': 95, trunk: 2, armA: 25, armB: 25, elbow: 160 } },
        ],
      },
      keyPoints: ['עמידה זקופה, אחיזה במשענת אם צריך', 'הרמת הברך לאט עד גובה נוח', 'האגן ישר — לא נוטה לצד', 'הורדה איטית ומבוקרת', 'נשימה רגועה לאורך התנועה'],
    },
    // ---------- supported split squat ----------
    supportedSplitSquat: {
      ...lunge, id: 'supportedSplitSquat', name: msg('ספליט סקוואט נתמך', 'Supported split squat'),
      joints: { knee: { rest: [140, 180], peak: [100, 128] } },
      rules: [
        { id: 'too_shallow', metric: 'knee', op: '>', value: 136, severity: 'error', when: 'peak',
          msg: msg('רד עוד קצת — בטווח שנוח לך', 'A little lower — within your comfortable range'),
          why: msg('טווח הדרגתי בונה כוח בברך ובירך בלי כאב', 'A gradual range builds knee and thigh strength without pain') },
        UPRIGHT_TORSO(35),
      ],
      ghost: { ...lunge.ghost, periodMs: 3800, peak: { ...lunge.ghost.peak, knee: 112, hip: 118 } },
      keyPoints: ['אחיזה בקיר או במשענת לאיזון', 'עמידת צעד קבועה', 'ירידה ישר למטה בטווח נוח', 'המשקל על העקב הקדמי', 'עלייה איטית ומבוקרת'],
    },
  };
  const tags = {
    gobletSquat: ['strength', 'lowerBody', 'bilateral', 'squatPattern'], sumoSquat: ['strength', 'lowerBody', 'bilateral', 'squatPattern'],
    splitSquat: ['strength', 'lowerBody', 'singleLeg'], reverseLunge: ['strength', 'lowerBody', 'singleLeg'],
    romanianDeadlift: ['strength', 'lowerBody', 'hinge'], hammerCurl: ['strength', 'upperBody', 'arm'],
    arnoldPress: ['strength', 'upperBody', 'overhead'], diamondPushUp: ['strength', 'upperBody', 'push', 'core'], widePushUp: ['strength', 'upperBody', 'push', 'core'],
    bentOverRow: ['strength', 'upperBody', 'pull'], overheadTricep: ['strength', 'upperBody', 'arm'], uprightRow: ['strength', 'upperBody', 'shoulder'],
    sitToStand: ['strength', 'lowerBody', 'bilateral', 'squatPattern', 'rehab'], wallPushUp: ['strength', 'upperBody', 'rehab'],
    scapularRow: ['strength', 'upperBody', 'pull', 'rehab'], wallSlide: ['strength', 'upperBody', 'shoulder', 'rehab'],
    rehabMarch: ['rehab', 'balance', 'activation'], supportedSplitSquat: ['strength', 'lowerBody', 'singleLeg', 'rehab'],
  };
  const how = {
    'bentOverRow.too_shallow': msg('דמיין שאתה מכניס את המרפקים לכיסים האחוריים ומכווץ אגוז בין השכמות', 'Imagine driving the elbows into your back pockets and cracking a nut between the shoulder blades'),
    'overheadTricep.partial_ext': msg('השאר את המרפקים צמודים לראש ויישר רק את האמות עד הסוף', 'Keep the elbows by your head and straighten only the forearms all the way'),
    'wallPushUp.too_shallow': msg('התקרב לקיר עד שהאף כמעט נוגע, ודחוף את הקיר הרחק ממך', 'Come close until your nose almost touches, then push the wall away'),
    'scapularRow.too_shallow': msg('משוך את המרפקים אחורה עד שהם עוברים את הגב, וכווץ את השכמות שנייה', 'Pull the elbows back past the torso and squeeze the shoulder blades for a second'),
  };
  return { profiles, tags, how };
}

export function strengthPatterns(t) {
  const P = (id, he, en, cueHe, cueEn, qualities, needs, extra = {}) => ({ source: { profile: id }, qualities, sports: 'all', needs, name: t(he, en), cue: t(cueHe, cueEn), ...extra });
  return {
    gobletSquat: P('gobletSquat', 'סקוואט גביע', 'Goblet squat', 'ידיים לחזה, ירידה בין הברכיים', 'Hands at the chest, sit between the knees', ['strength', 'lowerBody'], ['standing', 'bilateralStance']),
    sumoSquat: P('sumoSquat', 'סקוואט סומו', 'Sumo squat', 'רחב, ברכיים החוצה', 'Wide, knees out', ['strength', 'lowerBody'], ['standing', 'bilateralStance']),
    splitSquat: P('splitSquat', 'ספליט סקוואט', 'Split squat', 'ישר למטה כמו מעלית', 'Straight down like an elevator', ['strength', 'balance', 'lowerBody'], ['standing', 'twoLegs'], { unilateral: true }),
    reverseLunge: P('reverseLunge', "לאנג' אחורי", 'Reverse lunge', 'צעד אחורה, משקל על הרגל הקדמית', 'Step back, weight on the front leg', ['strength', 'balance', 'lowerBody'], ['standing', 'twoLegs'], { unilateral: true }),
    romanianDeadlift: P('romanianDeadlift', 'דדליפט רומני', 'Romanian deadlift', 'ישבן אחורה, גב ישר', 'Hips back, back flat', ['strength', 'posteriorChain'], ['standing', 'bilateralStance']),
    hammerCurl: P('hammerCurl', 'כפיפות פטיש', 'Hammer curl', 'אגודלים למעלה, מרפקים צמודים', 'Thumbs up, elbows pinned', ['strength', 'upperBody'], ['arms']),
    arnoldPress: P('arnoldPress', 'לחיצת ארנולד', 'Arnold press', 'סובב ולחץ למעלה', 'Rotate and press up', ['strength', 'upperBody'], ['arms']),
    diamondPushUp: P('diamondPushUp', 'שכיבות סמיכה יהלום', 'Diamond push-up', 'ידיים צמודות, מרפקים לגוף', 'Hands together, elbows in', ['strength', 'upperBody', 'core'], ['floor', 'arms', 'twoArms']),
    widePushUp: P('widePushUp', 'שכיבות סמיכה רחבות', 'Wide push-up', 'ידיים רחבות, גוף ישר', 'Hands wide, body straight', ['strength', 'upperBody', 'core'], ['floor', 'arms', 'twoArms']),
    bentOverRow: P('bentOverRow', 'חתירה בהטיה', 'Bent-over row', 'גב ישר, מרפקים אחורה', 'Back flat, elbows back', ['strength', 'upperBody', 'posteriorChain'], ['standing', 'arms']),
    overheadTricep: P('overheadTricep', 'פשיטת מרפקים מעל הראש', 'Overhead triceps extension', 'מרפקים לתקרה, יישור מלא', 'Elbows to the ceiling, full extension', ['strength', 'upperBody'], ['arms']),
    uprightRow: P('uprightRow', 'חתירה זקופה', 'Upright row', 'מרפקים מובילים עד הכתפיים', 'Elbows lead to shoulder height', ['strength', 'upperBody'], ['arms']),
    sitToStand: P('sitToStand', 'קימה מכיסא', 'Sit to stand', 'אף מעל האצבעות, דחיפה מהעקבים', 'Nose over the toes, drive from the heels', ['rehab', 'strength', 'lowerBody', 'activation'], ['standing', 'bilateralStance']),
    wallPushUp: P('wallPushUp', 'שכיבות סמיכה על הקיר', 'Wall push-up', 'גוף ישר, חזה לקיר', 'Body straight, chest to the wall', ['rehab', 'strength', 'upperBody'], ['standing', 'arms']),
    scapularRow: P('scapularRow', 'חתירה — כיווץ שכמות', 'Scapular row', 'מרפקים לצלעות, שכמות יחד', 'Elbows to the ribs, blades together', ['rehab', 'strength', 'upperBody'], ['arms']),
    wallSlide: P('wallSlide', 'החלקת ידיים על הקיר', 'Wall slide', 'צמוד לקיר, החלקה איטית למעלה', 'Flat to the wall, slide slowly up', ['rehab', 'mobility', 'upperBody'], ['arms']),
    rehabMarch: P('rehabMarch', 'הרמת ברך שיקומית', 'Rehab knee march', 'לאט, אגן ישר', 'Slowly, pelvis level', ['rehab', 'balance', 'activation'], ['standing'], { unilateral: true, splitSides: true }),
    supportedSplitSquat: P('supportedSplitSquat', 'ספליט סקוואט נתמך', 'Supported split squat', 'אחיזה לאיזון, טווח נוח', 'Hold for balance, a comfortable range', ['rehab', 'strength', 'lowerBody'], ['standing', 'twoLegs'], { unilateral: true }),
  };
}

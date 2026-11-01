// ============================================================
// adaptive — movements for the WHEELCHAIR and the CRUTCHES (owner, 2026-11-01): seated arm work for wheelchair
// basketball / tennis, and crutch-supported upper-body work for amputee football. Arm-only measurement (the
// working arm, combine 'max'), so a seated or a crutch-supported trainee is measured by what really moves.
// All pass the automatic gate (the Ghost through the live evaluator; counted once per correct cycle).
// ============================================================

const msg = (he, en) => ({ he, en });

export function adaptiveProfiles(base) {
  const { UPRIGHT_TORSO } = base;
  const STILL = UPRIGHT_TORSO(30);
  const ARMS = ['arms', 'torso'];
  const armGhost = (rest, peak, periodMs = 2000) => ({ view: 'side', base: 'stand', periodMs, rest: { knee: 174, hip: 174, ...rest }, peak: { knee: 174, hip: 174, ...peak } });
  const reps = (id, he, en, joints, rules, ghost, keyPoints) => ({
    id, name: msg(he, en), precision: 'expert', kind: 'reps', posture: 'standing', cameraView: 'front', require: ARMS,
    primary: Object.keys(joints)[0], joints, rules: [...rules, STILL], dynamics: [], ghost, keyPoints,
  });
  const EXT = (value, he, en, whyHe, whyEn) => ({ id: 'partial_ext', metric: 'elbow', op: '<', value, severity: 'error', when: 'peak', msg: msg(he, en), why: msg(whyHe, whyEn) });

  const profiles = {
    // ================= Wheelchair (seated) =================
    wheelchairPush: reps('wheelchairPush', 'דחיפת כיסא בצל', 'Shadow wheelchair push',
      { elbow: { rest: [65, 112], peak: [150, 180], combine: 'max' }, shoulder: { rest: [10, 60], peak: [20, 70], combine: 'max' } },
      [EXT(124, 'דחוף עד יישור מלא — הידיים עוזבות את הגלגל למטה וקדימה', 'Push to a full extension — the hands leave the rim low and forward',
        'דחיפה ארוכה ומלאה מניעה את הכיסא רחוק יותר בכל דחיפה ומחסכת בכתף', 'A long, full push drives the chair further each stroke and spares the shoulder')],
      armGhost({ shoulder: 25, elbow: 90 }, { shoulder: 45, elbow: 170 }, 1400),
      ['הידיים תופסות את הגלגל מאחור, בשעה 11', 'דחיפה ארוכה עד שעה 2–3, יישור מלא של המרפקים', 'הגו נוטה מעט קדימה בדחיפה', 'חזרה רפויה של הידיים מתחת לגלגל', 'קצב אחיד — כוח מהכתפיים והחזה']),
    oneArmPass: reps('oneArmPass', 'מסירה ביד אחת', 'One-arm pass',
      { elbow: { rest: [55, 105], peak: [150, 180], combine: 'max' }, shoulder: { rest: [95, 150], peak: [95, 150], combine: 'max' } },
      [EXT(124, 'הצלף קדימה עד יישור מלא של המרפק', 'Snap forward to a full elbow extension',
        'יישור מלא נותן למסירה מרחק וכיוון — חצי תנועה נופלת קצרה', 'A full extension gives the pass distance and direction — half a movement falls short')],
      armGhost({ shoulder: 125, elbow: 75 }, { shoulder: 115, elbow: 170 }, 1600),
      ['הכדור ליד האוזן, המרפק מאחור ולמעלה', 'סיבוב גו קל לכיוון המסירה', 'הצלפה קדימה ויישור מלא', 'שורש כף היד מתקפל בסוף — הכדור מסתובב אחורה', 'מבט על המקבל']),
    seatedPunch: reps('seatedPunch', 'אגרופים ישרים', 'Straight punches',
      { elbow: { rest: [55, 105], peak: [150, 180], combine: 'max' }, shoulder: { rest: [55, 105], peak: [65, 110], combine: 'max' } },
      [EXT(124, 'יישר את היד עד הסוף בכל אגרוף', 'Straighten the arm fully on every punch',
        'יישור מלא מפעיל את החזה, הכתף והטרייספס ומעלה את הדופק', 'A full extension works the chest, shoulder and triceps and lifts the heart rate')],
      armGhost({ shoulder: 75, elbow: 70 }, { shoulder: 88, elbow: 170 }, 900),
      ['אגרופים ליד הסנטר, מרפקים צמודים', 'הוצאה מהירה ויישור מלא קדימה', 'חזרה מהירה להגנה', 'הגו יציב, נשימה בכל אגרוף', 'קצב מהיר — אימון לב-ריאה']),
    armrestLift: reps('armrestLift', 'הרמת גוף מהמשענות', 'Armrest lift',
      { elbow: { rest: [65, 115], peak: [150, 180], combine: 'max' }, shoulder: { rest: [0, 45], peak: [0, 45], combine: 'max' } },
      [EXT(128, 'דחוף עד יישור המרפקים — הגוף מתרומם מהכיסא', 'Press until the elbows are straight — the body lifts off the seat',
        'יישור מלא מחזק את הטרייספס והכתף שנושאים את כל ההעברות מהכיסא', 'A full press strengthens the triceps and shoulders that carry every transfer from the chair')],
      armGhost({ shoulder: 18, elbow: 90 }, { shoulder: 12, elbow: 170 }, 2600),
      ['ידיים על המשענות ליד הירכיים', 'דחיפה למטה עד יישור המרפקים', 'הכתפיים למטה — רחוקות מהאוזניים', 'החזקה של שנייה למעלה', 'ירידה איטית ומבוקרת']),
    overheadReach: reps('overheadReach', 'הושטת יד למעלה', 'Overhead reach',
      { shoulder: { rest: [0, 45], peak: [140, 180], combine: 'max' }, elbow: { rest: [135, 180], peak: [135, 180], combine: 'max' } },
      [{ id: 'partial_reach', metric: 'shoulder', op: '<', value: 105, severity: 'error', when: 'peak',
        msg: msg('הושט את היד עד הסוף למעלה, ליד האוזן', 'Reach all the way up, by the ear'),
        why: msg('טווח מלא בכתף שומר על התנועה הדרושה להגשה, לזריקה ולהעברות', 'A full shoulder range keeps the motion needed for the serve, the shot and the transfers') }],
      armGhost({ shoulder: 18, elbow: 165 }, { shoulder: 165, elbow: 168 }, 2600),
      ['יד ישרה עולה מלפנים עד ליד האוזן', 'הגו זקוף — לא נשען אחורה', 'הכתף למטה, רחוקה מהאוזן', 'עלייה וירידה מבוקרות', 'יד אחרי יד או שתיהן יחד']),
    facePull: reps('facePull', 'משיכה אל הפנים', 'Face pull',
      { elbow: { rest: [145, 180], peak: [60, 110] }, shoulder: { rest: [70, 115], peak: [70, 125] } },
      [{ id: 'too_shallow', metric: 'elbow', op: '>', value: 128, severity: 'error', when: 'peak',
        msg: msg('משוך עד הסוף — הידיים ליד האוזניים, המרפקים גבוהים', 'Pull all the way — the hands by the ears, the elbows high'),
        why: msg('הכתף האחורית והשכמות מאזנות את כל הדחיפות — הן מגינות על הכתף', 'The rear shoulder and the blades balance all the pushing — they protect the shoulder') }],
      armGhost({ shoulder: 90, elbow: 168 }, { shoulder: 95, elbow: 80 }, 2600),
      ['ידיים ישרות קדימה בגובה הכתפיים', 'משיכה לכיוון הפנים, המרפקים גבוהים והחוצה', 'כיווץ השכמות בסוף', 'הגו זקוף', 'שחרור איטי קדימה']),
    // ================= Crutches =================
    crutchPress: reps('crutchPress', 'לחיצת קביים — הרמת גוף', 'Crutch press',
      { elbow: { rest: [110, 150], peak: [155, 180], combine: 'max' }, shoulder: { rest: [0, 40], peak: [0, 40], combine: 'max' } },
      [EXT(150, 'דחוף את הקביים עד יישור המרפקים', 'Press the crutches until the elbows are straight',
        'הלחיצה הזאת היא מה שמניע אותך על הקביים — טרייספס וכתף חזקים', 'This press is what moves you on the crutches — strong triceps and shoulders')],
      armGhost({ shoulder: 15, elbow: 128 }, { shoulder: 12, elbow: 172 }, 2200),
      ['ידיות הקביים בגובה שורש כף היד', 'דחיפה למטה עד יישור המרפקים — הגוף מתרומם', 'הכתפיים למטה, החזה פתוח', 'רגל העבודה מורמת מעט', 'ירידה איטית בשליטה']),
    crutchHold: {
      id: 'crutchHold', name: msg('החזקה על הקביים', 'Crutch support hold'), precision: 'expert', kind: 'hold',
      posture: 'standing', cameraView: 'front', require: ARMS, primary: 'elbow',
      joints: { elbow: { rest: [150, 180], combine: 'max' } },
      rules: [
        { id: 'elbows_bent', metric: 'elbow', op: '<', value: 145, severity: 'error', when: 'any',
          msg: msg('מרפקים כמעט ישרים — הגוף נתמך על הידיים', 'Elbows nearly straight — the body supported on the hands'),
          why: msg('מרפקים קורסים מעמיסים על הכתף — יישור נותן תמיכה יציבה', 'Collapsing elbows load the shoulder — a straight arm gives a stable support') },
        STILL,
      ],
      dynamics: [],
      ghost: { view: 'side', base: 'stand', periodMs: 4000, rest: { knee: 174, hip: 174, shoulder: 12, elbow: 168 } },
      keyPoints: ['שתי הקביים מעט לפנים ולצדדים', 'מרפקים כמעט ישרים, הכתפיים למטה', 'הגוף זקוף, הבטן מהודקת', 'רגל העבודה מורמת מהרצפה', 'נשימה רגועה לאורך ההחזקה'],
    },
  };
  const tags = {
    wheelchairPush: ['strength', 'upperBody', 'conditioning'], oneArmPass: ['upperBody', 'ballSkill', 'power'], seatedPunch: ['upperBody', 'conditioning'],
    armrestLift: ['strength', 'upperBody', 'rehab'], overheadReach: ['upperBody', 'shoulder', 'rehab'], facePull: ['strength', 'upperBody', 'pull'],
    crutchPress: ['strength', 'upperBody'], crutchHold: ['hold', 'isometric', 'upperBody'],
  };
  return { profiles, tags, how: {} };
}

export function adaptivePatterns(t) {
  const P = (id, he, en, cueHe, cueEn, qualities, sports, needs = ['arms']) => ({ source: { profile: id }, qualities, sports, needs, name: t(he, en), cue: t(cueHe, cueEn) });
  return {
    wheelchairPush: P('wheelchairPush', 'דחיפת כיסא בצל', 'Shadow wheelchair push', 'מאחור עד יישור מלא', 'From the back to a full extension', ['strength', 'upperBody', 'conditioning'], ['seated']),
    oneArmPass: P('oneArmPass', 'מסירה ביד אחת', 'One-arm pass', 'ליד האוזן, הצלפה ויישור', 'By the ear, snap and extend', ['technique', 'sportSkill', 'upperBody'], ['seated', 'court']),
    seatedPunch: P('seatedPunch', 'אגרופים ישרים', 'Straight punches', 'מהר, יישור מלא, חזרה להגנה', 'Fast, full extension, back to guard', ['conditioning', 'endurance', 'upperBody'], ['seated']),
    armrestLift: P('armrestLift', 'הרמת גוף מהמשענות', 'Armrest lift', 'דחוף למטה, כתפיים רחוקות מהאוזניים', 'Press down, shoulders away from the ears', ['strength', 'upperBody', 'rehab'], ['seated']),
    overheadReach: P('overheadReach', 'הושטת יד למעלה', 'Overhead reach', 'יד ישרה עד האוזן, גו זקוף', 'A straight arm to the ear, trunk tall', ['mobility', 'upperBody', 'rehab'], ['seated']),
    facePull: P('facePull', 'משיכה אל הפנים', 'Face pull', 'מרפקים גבוהים, שכמות יחד', 'Elbows high, blades together', ['strength', 'upperBody', 'stability'], ['seated', 'field']),
    crutchPress: P('crutchPress', 'לחיצת קביים — הרמת גוף', 'Crutch press', 'דחוף את הקביים, הגוף עולה', 'Press the crutches, the body rises', ['strength', 'upperBody'], ['field'], ['arms', 'standing']),
    crutchHold: P('crutchHold', 'החזקה על הקביים', 'Crutch support hold', 'מרפקים ישרים, גוף זקוף', 'Elbows straight, body tall', ['strength', 'stability', 'upperBody'], ['field'], ['arms', 'standing']),
  };
}

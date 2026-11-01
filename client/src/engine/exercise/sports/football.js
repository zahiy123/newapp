// ============================================================
// football — the football movement library (owner, 2026-11-01: "15 base movements per sport, every one with a
// full profile — counting, the skeleton, the peak frame — the smart stop and the coach's voice on all of them")
//
// Each entry is an Expert Execution Profile built from the biomechanics of the skill and from the profiles
// already proven in the field (the shadow pass, the kick, the squat jump, the single-leg squat). The automatic
// gate — exerciseProfiles.test.js — runs every profile's own Ghost through the live evaluator: in view, the joints
// inside their target ranges at rest and at the peak, no rule firing on a correct execution, and counted reps.
//
// kind 'strike' → counted by the kick detector (the foot's speed / the knee snap), judged at the contact;
// kind 'reps'   → counted rest → peak → rest on the primary joint; the eyes get the rep's deepest moment;
// kind 'cyclic' → timed, judged by landings / cadence; kind 'hold' → timed, judged by the window.
// keyPoints: the professional key points the coach's eyes judge (and the briefing teaches).
// ============================================================

const msg = (he, en) => ({ he, en });

/**
 * @param {object} base  { footballKick, shadowPass, jumpSquat, singleLegSquat, gkStance, UPRIGHT_TORSO, KNEE_VALGUS, KNEE_IN }
 * @returns {{ profiles: Object, tags: Object, how: Object }}
 */
export function footballProfiles(base) {
  const { footballKick, shadowPass, UPRIGHT_TORSO, KNEE_VALGUS, KNEE_IN } = base;
  const LEAN_BACK = footballKick.rules.find(r => r.id === 'lean_back');
  const BALANCE = footballKick.dynamics.find(d => d.id === 'strike_balance');
  const SOFT_LANDING = (value) => ({
    id: 'soft_landing', on: 'landing', feature: 'absorptionDeg', op: '<', value, severity: 'error',
    msg: msg('נחיתה רכה — הברך מתכופפת ברגע המגע', 'Land soft — the knee bends as you touch down'),
    why: msg('הברך והירך הן בולמי הזעזועים — נחיתה על רגל ישרה מעבירה את המכה לברך ולגב', 'The knee and hip are the shock absorbers — a straight-leg landing sends the impact into the knee and back'),
  });
  // a foot that strikes the ball with its TIP (the device measures the contact from the foot's landmarks)
  const TOE = (id, he, en, cueHe, cueEn) => ({
    id, on: 'strike', feature: 'contactToe', op: '>', value: 0.5, severity: 'error', view: 'front', confirm: 2, only: [id.split('_')[0]], naturalFoot: true,
    cue: msg(cueHe, cueEn), msg: msg(he, en),
    why: msg('קצה הנעל הוא נקודה קטנה ועגולה — הכדור עף לכיוון לא צפוי והאצבעות סופגות את המכה', 'The tip of the boot is a small round point — the ball flies off unpredictably and the toes take the hit'),
  });
  const strikeGhost = (foot, kf) => ({ view: 'side', base: 'stride', periodMs: 1900, restT: 0, contactT: 0.48, foot, keyframes: kf });
  const PASS_KF = shadowPass.ghost.keyframes;
  const KICK_KF = footballKick.ghost.keyframes;

  const profiles = {
    // ---------- 1. Instep (laces) pass — a driven pass along the ground ----------
    instepPass: {
      ...shadowPass, id: 'instepPass', name: msg('מסירה בגב כף הרגל', 'Instep pass'),
      strikeByFoot: true,
      dynamics: [BALANCE,
        TOE('instepPass_toe', 'פגעת עם קצה הנעל — במסירה בגב כף הרגל האצבעות מכוונות למטה', 'You struck with the tip — in an instep pass the toes point down',
          'אצבעות למטה — שרוכים לכדור!', 'Toes down — laces through the ball!')],
      ghost: strikeGhost('laces', PASS_KF),
      keyPoints: ['ברך הרגל הבועטת מעל הכדור ברגע המגע', 'כף הרגל מתוחה, אצבעות מכוונות למטה, קרסול נעול', 'פגיעה בשרוכים במרכז הכדור — הכדור נשאר נמוך', 'חזה מעל הכדור, רגל העמידה ליד הכדור', 'המשך תנועה קצר לכיוון המטרה'],
    },
    // ---------- 2. Outside-foot pass ----------
    outsidePass: {
      ...shadowPass, id: 'outsidePass', name: msg('מסירה בצד החיצוני', 'Outside-foot pass'),
      strikeByFoot: true,
      dynamics: [BALANCE,
        TOE('outsidePass_toe', 'פגעת עם קצה הנעל — במסירה בחוץ כף הרגל מסתובבת פנימה ופוגעת בצד החיצוני', 'You struck with the tip — in an outside pass the foot turns in and meets the ball with its outside',
          'סובב את כף הרגל פנימה — צד חיצוני!', 'Turn the foot in — the outside!')],
      ghost: strikeGhost('laces', PASS_KF),
      keyPoints: ['כף הרגל מסתובבת פנימה, האצבעות מכוונות למטה ופנימה', 'פגיעה בצד החיצוני של כף הרגל, בחצי הפנימי של הכדור', 'תנופה קצרה מהברך, הקרסול נעול', 'רגל העמידה קצת רחוקה מהכדור, גוף מעל הכדור', 'המשך תנועה החוצה לכיוון המסירה'],
    },
    // ---------- 3. Lofted pass / chip ----------
    loftedPass: {
      ...footballKick, id: 'loftedPass', name: msg('מסירה מוגבהת', 'Lofted pass'),
      rules: [{ ...LEAN_BACK, value: 42 }],
      dynamics: [BALANCE,
        TOE('loftedPass_toe', 'פגעת עם קצה הנעל — במסירה מוגבהת פוגעים בחלק התחתון של הכדור עם גב כף הרגל', 'You struck with the tip — a lofted pass meets the bottom of the ball with the instep',
          'מתחת לכדור — גב כף הרגל!', 'Under the ball — the instep!')],
      ghost: strikeGhost('laces', KICK_KF),
      keyPoints: ['רגל העמידה מעט מאחורי הכדור ולצדו', 'הגוף נשען מעט אחורה — לא יותר מדי', 'פגיעה בחלק התחתון של הכדור עם גב כף הרגל', 'הקרסול נעול, המשך תנועה גבוה', 'הידיים פתוחות לשיווי משקל'],
    },
    // ---------- 4. Volley (shadow) ----------
    shadowVolley: {
      ...footballKick, id: 'shadowVolley', name: msg('וולה בצל', 'Shadow volley'),
      rules: [{ ...LEAN_BACK, value: 30 }],
      dynamics: [BALANCE],
      ghost: strikeGhost('laces', KICK_KF.map(k => (k.t >= 0.43 && k.t <= 0.64 ? { ...k, a: { ...k.a, 'B.thigh': Math.max(k.a['B.thigh'], k.t === 0.43 ? 30 : 55) } } : k))),
      keyPoints: ['העין על הכדור עד המגע', 'הברך עולה מעל הכדור לפני הפגיעה', 'כף הרגל מתוחה, קרסול נעול, פגיעה במרכז הכדור', 'החזה מעל הכדור — לא נשען אחורה', 'ידיים פתוחות לשיווי משקל'],
    },
    // ---------- 5. Header (shadow) — from the hips, the trunk drives the forehead through ----------
    shadowHeader: {
      id: 'shadowHeader', name: msg('נגיחה בצל', 'Shadow header'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'hip',
      joints: { hip: { rest: [150, 180], peak: [118, 150] }, knee: { rest: [150, 180], peak: [140, 172] } },
      rules: [
        { id: 'stiff_knees', metric: 'knee', op: '>', value: 175, severity: 'error', when: 'peak',
          msg: msg('ברכיים רכות — הכוח לנגיחה מגיע מהרגליים', 'Soft knees — the header\'s power comes from the legs'),
          why: msg('ברכיים נעולות לא מעבירות כוח — הנגיחה הופכת לתנועת צוואר שמסכנת את הצוואר', 'Locked knees pass no power on — the header becomes a neck movement that risks the neck') },
        { id: 'trunk_collapse', metric: 'trunkLean', op: '>', value: 62, severity: 'danger', when: 'any',
          msg: msg('אל תצלול קדימה — הגו מוביל, הראש בקו הגוף', "Don't dive forward — the trunk leads, the head in line with the body"),
          why: msg('צלילה קדימה מעמיסה על הגב והצוואר בלי להוסיף כוח', 'Diving forward loads the back and neck without adding power') },
      ],
      dynamics: [],
      ghost: { view: 'side', base: 'stand', periodMs: 1600, rest: { knee: 168, hip: 170, shoulder: 45, elbow: 110 }, peak: { knee: 158, hip: 134, shoulder: 35, elbow: 110 } },
      keyPoints: ['מכה במצח — לא בקודקוד', 'הגו נמתח אחורה ומשתחרר קדימה מהבטן והירכיים', 'עיניים פתוחות, הצוואר נעול בקו הגוף', 'ברכיים רכות, הכוח מגיע מהרגליים', 'ידיים לפנים לשיווי משקל והגנה'],
    },
    // ---------- 6. Chest control — absorb by giving with the knees ----------
    chestControl: {
      id: 'chestControl', name: msg('עצירה בחזה', 'Chest control'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
      joints: { knee: { rest: [158, 180], peak: [120, 152] } },
      rules: [
        { id: 'stiff_legs', metric: 'knee', op: '>', value: 156, severity: 'error', when: 'peak',
          msg: msg('תן לברכיים לבלום — הגוף יורד עם הכדור', 'Let the knees absorb — the body gives with the ball'),
          why: msg('גוף נוקשה מקפיץ את הכדור הרחק — בלימה בברכיים מרככת אותו והוא נופל לרגליים', 'A stiff body bounces the ball away — giving at the knees cushions it and it drops to your feet') },
        UPRIGHT_TORSO(40),
      ],
      dynamics: [],
      ghost: { view: 'side', base: 'stand', periodMs: 2000, rest: { knee: 170, hip: 172, shoulder: 35, elbow: 120 }, peak: { knee: 136, hip: 150, shoulder: 45, elbow: 120 } },
      keyPoints: ['החזה פתוח וקשת קלה בגב העליון ברגע המגע', 'הברכיים מתכופפות ובולמות את הכדור', 'הידיים פתוחות לצדדים — לא נוגעות בכדור', 'העיניים על הכדור עד שהוא נופל לרגליים', 'אחרי הבלימה — הכדור קדימה להמשך המשחק'],
    },
    // ---------- 7. Sole trap — the foot lifts onto the ball and stops it ----------
    soleTrap: {
      id: 'soleTrap', name: msg('עצירה בסוליה', 'Sole trap'), precision: 'expert', kind: 'reps',
      posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'hip',
      joints: { hip: { rest: [155, 180], peak: [118, 152] } },
      rules: [UPRIGHT_TORSO(30)],
      dynamics: [],
      ghost: {
        view: 'side', base: 'stride', periodMs: 1800, restT: 0, peakT: 0.5, supportMustBear: true,
        keyframes: [
          { t: 0, a: { 'A.knee': 170, 'B.thigh': 2, 'B.knee': 170, trunk: 4, armA: 15, armB: 15, elbow: 150 } },
          { t: 0.4, a: { 'A.knee': 162, 'B.thigh': 38, 'B.knee': 120, trunk: 6, armA: 25, armB: 20, elbow: 150 } },
          { t: 0.6, a: { 'A.knee': 162, 'B.thigh': 38, 'B.knee': 120, trunk: 6, armA: 25, armB: 20, elbow: 150 } },
        ],
      },
      keyPoints: ['רגל העמידה יציבה וברך רכה', 'הסוליה עולה על החלק העליון של הכדור', 'לחיצה עדינה — לא דריכה חזקה', 'הגוף מעל הכדור, העיניים מרימות למשחק', 'הכדור נעצר במקום ומוכן לנגיעה הבאה'],
    },
    // ---------- 8. Toe taps — alternating touches on top of the ball ----------
    toeTaps: {
      ...base.runInPlace, id: 'toeTaps', name: msg('נגיעות לסירוגין על הכדור', 'Toe taps'),
      joints: { hip: { rest: [158, 180], peak: [125, 160] }, elbow: { rest: [60, 130], peak: [60, 130] } },
      rules: base.runInPlace.rules,
      ghost: {
        view: 'side', base: 'stride', alternate: true, periodMs: 600, restT: 0, peakT: 0.175,
        keyframes: [
          { t: 0, a: { 'A.knee': 166, 'B.thigh': 4, 'B.knee': 168, trunk: 5, armA: 8, armB: 8, elbow: 95 } },
          { t: 0.35, a: { 'A.knee': 160, 'B.thigh': 34, 'B.knee': 118, trunk: 5, armA: 20, armB: -12, elbow: 95 } },
          { t: 0.7, a: { 'A.knee': 164, 'B.thigh': 16, 'B.knee': 145, trunk: 5, armA: 12, armB: -4, elbow: 95 } },
        ],
      },
      keyPoints: ['נגיעה קלה בחלק העליון של הכדור עם כריות האצבעות', 'החלפת רגליים מהירה וקצבית', 'על כריות כפות הרגליים, ברכיים רכות', 'הכדור לא זז ממקומו', 'ידיים עובדות כמו בריצה'],
    },
    // ---------- 9. Juggling ----------
    juggling: {
      ...base.runInPlace, id: 'juggling', name: msg("ג'אגלינג", 'Juggling'),
      joints: { hip: { rest: [158, 180], peak: [115, 155] }, elbow: { rest: [60, 160], peak: [60, 160] } },
      rules: [base.runInPlace.rules.find(r => r.id === 'trunk_lean')],
      dynamics: [],
      ghost: {
        view: 'side', base: 'stride', alternate: true, periodMs: 900, restT: 0, peakT: 0.175,
        keyframes: [
          { t: 0, a: { 'A.knee': 166, 'B.thigh': 4, 'B.knee': 166, trunk: 4, armA: 30, armB: 30, elbow: 140 } },
          { t: 0.35, a: { 'A.knee': 160, 'B.thigh': 42, 'B.knee': 150, trunk: 4, armA: 34, armB: 28, elbow: 140 } },
          { t: 0.7, a: { 'A.knee': 164, 'B.thigh': 16, 'B.knee': 160, trunk: 4, armA: 32, armB: 30, elbow: 140 } },
        ],
      },
      keyPoints: ['פגיעה בכדור עם גב כף הרגל, קרסול נעול', 'הכדור עולה עד גובה המותן — לא יותר', 'ברך רכה של רגל העמידה, על כריות הרגל', 'נגיעות קטנות ומבוקרות, עיניים על הכדור', 'ידיים פתוחות לשיווי משקל'],
    },
    // ---------- 10. Stepover ----------
    stepOver: {
      ...base.runInPlace, id: 'stepOver', name: msg('הטעיה — צעד מעל הכדור', 'Stepover'),
      joints: { hip: { rest: [158, 180], peak: [115, 152] }, elbow: { rest: [60, 160], peak: [60, 160] } },
      rules: [base.runInPlace.rules.find(r => r.id === 'trunk_lean')],
      dynamics: [],
      ghost: {
        view: 'side', base: 'stride', alternate: true, periodMs: 1100, restT: 0, peakT: 0.175,
        keyframes: [
          { t: 0, a: { 'A.knee': 164, 'B.thigh': 4, 'B.knee': 164, trunk: 4, armA: 30, armB: 24, elbow: 140 } },
          { t: 0.35, a: { 'A.knee': 160, 'B.thigh': 42, 'B.knee': 112, trunk: 4, armA: 36, armB: 20, elbow: 140 } },
          { t: 0.7, a: { 'A.knee': 162, 'B.thigh': 14, 'B.knee': 150, trunk: 4, armA: 32, armB: 22, elbow: 140 } },
        ],
      },
      keyPoints: ['הרגל מקיפה את הכדור מבפנים החוצה, מעל הכדור', 'הכתפיים והגוף מוכרים את ההטעיה לצד', 'ברכיים כפופות, מרכז כובד נמוך', 'אחרי ההטעיה — יציאה מהירה לצד השני', 'הקצב: איטי בהטעיה, מהיר ביציאה'],
    },
    // ---------- 11. Defensive jockey stance (hold) ----------
    jockeyStance: {
      ...base.gkStance, id: 'jockeyStance', name: msg("עמידת הגנה — ג'וקי", 'Defensive jockey stance'),
      joints: { knee: { rest: [118, 155] }, hip: { rest: [105, 150] } },
      rules: [
        { id: 'too_high', metric: 'knee', op: '>', value: 160, severity: 'error', when: 'any',
          msg: msg('נמוך יותר — ברכיים כפופות, מוכן לזוז לכל כיוון', 'Lower — knees bent, ready to move any way'),
          why: msg('מגן גבוה איטי בתגובה — עמידה נמוכה נותנת צעד ראשון מהיר', 'A tall defender reacts slowly — a low stance gives a quick first step') },
        UPRIGHT_TORSO(45),
      ],
      ghost: { view: 'side', base: 'stand', periodMs: 4000, rest: { knee: 138, hip: 128, shoulder: 35, elbow: 120 } },
      keyPoints: ['עמידה בזווית — רגל אחת קדימה, לא ישר מול היריב', 'ברכיים כפופות, משקל על כריות כפות הרגליים', 'עיניים על הכדור, לא על הגוף של היריב', 'גב זקוף, ידיים מעט פתוחות', 'צעדים קטנים — אף פעם לא להצליב רגליים'],
    },
    // ---------- 12. Lateral bounds ----------
    lateralBounds: {
      ...base.jumpSquat, id: 'lateralBounds', name: msg('ניתורים לצדדים', 'Lateral bounds'),
      joints: { knee: { rest: [160, 180], peak: [100, 140] } },
      rules: [UPRIGHT_TORSO(55)],
      dynamics: [SOFT_LANDING(12)],
      ghost: {
        view: 'side', base: 'stand', periodMs: 1600, restT: 0, peakT: 0.3,
        keyframes: [
          { t: 0, a: { knee: 170, hip: 168, shoulder: 20, elbow: 120, rise: 0 } },
          { t: 0.3, a: { knee: 118, hip: 120, shoulder: -15, elbow: 120, rise: 0 } },
          { t: 0.45, a: { knee: 176, hip: 174, shoulder: 60, elbow: 120, rise: 0.18 } },
          { t: 0.6, a: { knee: 164, hip: 162, shoulder: 40, elbow: 120, rise: 0 } },
          { t: 0.72, a: { knee: 132, hip: 135, shoulder: 25, elbow: 120, rise: 0 } },
        ],
      },
      keyPoints: ['דחיפה מהרגל החיצונית לצד, לא למעלה', 'נחיתה רכה על כרית כף הרגל והברך מתכופפת', 'הברך מעל האצבעות — לא נופלת פנימה', 'עצירה של שנייה בנחיתה — יציבות לפני הניתור הבא', 'הגו מעט קדימה, ידיים עוזרות לתנופה'],
    },
    // ---------- 13. Single-leg hops ----------
    singleLegHop: {
      ...base.singleLegSquat, id: 'singleLegHop', name: msg('ניתורים על רגל אחת', 'Single-leg hops'),
      joints: { knee: { rest: [155, 180], peak: [115, 140] } },
      // (the landing's softness IS the rep's depth here: a stiff hop never reaches the peak range)
      rules: [UPRIGHT_TORSO(45), KNEE_IN(),
        { id: 'stiff_landing', metric: 'knee', op: '>', value: 150, severity: 'error', when: 'peak',
          msg: msg('נחיתה רכה — כופף את הברך ברגע הנחיתה', 'Land soft — bend the knee as you land'),
          why: msg('נחיתה על רגל ישרה מעבירה את המכה לברך ולגב — הברך היא בולם הזעזועים', 'Landing on a straight leg sends the impact to the knee and back — the knee is the shock absorber') }],
      dynamics: [],
      ghost: {
        view: 'side', base: 'stride', periodMs: 2400, restT: 0, peakT: 0.5, supportMustBear: true,
        keyframes: [
          { t: 0, a: { 'A.knee': 172, 'A.shank': 4, 'B.thigh': 30, 'B.knee': 175, trunk: 8, armA: 40, armB: 40, elbow: 140 } },
          { t: 0.5, a: { 'A.knee': 126, 'A.shank': 22, 'B.thigh': 38, 'B.knee': 175, trunk: 20, armA: 50, armB: 50, elbow: 140 } },
        ],
      },
      keyPoints: ['נחיתה על כרית כף הרגל וברך שמתכופפת', 'הברך מעל האצבעות — לא נופלת פנימה', 'האגן ישר, לא צונח לצד', 'ניתורים קטנים ומבוקרים לפני גובה', 'מבט קדימה, ידיים לשיווי משקל'],
    },
    // ---------- 14. Stick landing (knee-injury prevention) ----------
    stickLanding: {
      ...base.jumpSquat, id: 'stickLanding', name: msg('נחיתה ויציבות', 'Stick landing'),
      joints: { knee: { rest: [165, 180], peak: [100, 130] } },
      rules: [UPRIGHT_TORSO(55), KNEE_VALGUS('peak')],
      dynamics: [SOFT_LANDING(18)],
      ghost: {
        view: 'side', base: 'stand', periodMs: 2600, restT: 0, peakT: 0.62,
        keyframes: [
          { t: 0, a: { knee: 172, hip: 170, shoulder: 15, elbow: 160, rise: 0 } },
          { t: 0.2, a: { knee: 130, hip: 128, shoulder: -20, elbow: 160, rise: 0 } },
          { t: 0.34, a: { knee: 178, hip: 176, shoulder: 120, elbow: 160, rise: 0.28 } },
          { t: 0.46, a: { knee: 174, hip: 172, shoulder: 90, elbow: 160, rise: 0.05 } },
          { t: 0.62, a: { knee: 112, hip: 115, shoulder: 60, elbow: 160, rise: 0 } },
          { t: 0.82, a: { knee: 118, hip: 120, shoulder: 55, elbow: 160, rise: 0 } },
        ],
      },
      keyPoints: ['נחיתה על שתי הרגליים בו זמנית, על כריות כפות הרגליים', 'הברכיים מתכופפות ובולמות — מעל האצבעות, לא פנימה', 'הישבן אחורה, החזה מעל הברכיים', 'עצירה מלאה של שתי שניות — בלי צעד נוסף', 'נחיתה שקטה — רעש גדול זה נחיתה נוקשה'],
    },
  };
  const tags = {
    instepPass: ['strike', 'singleLegStance', 'ballSkill'], outsidePass: ['strike', 'singleLegStance', 'ballSkill'],
    loftedPass: ['strike', 'chain', 'singleLegStance', 'ballSkill'], shadowVolley: ['strike', 'chain', 'singleLegStance', 'ballSkill'],
    shadowHeader: ['ballSkill', 'power'], chestControl: ['ballSkill', 'lowerBody'],
    soleTrap: ['ballSkill', 'singleLegStance'], toeTaps: ['cyclic', 'coordination', 'ballSkill'],
    juggling: ['cyclic', 'coordination', 'ballSkill'], stepOver: ['cyclic', 'agility', 'ballSkill'],
    jockeyStance: ['hold', 'isometric', 'lowerBody'], lateralBounds: ['plyometric', 'landing', 'agility'],
    singleLegHop: ['balance', 'agility', 'singleLegStance'], stickLanding: ['plyometric', 'landing', 'lowerBody', 'bilateral'],
  };
  const how = {
    'shadowHeader.stiff_knees': msg('כופף מעט את הברכיים, משוך את הגו אחורה ושחרר אותו קדימה מהבטן — המצח פוגע, הצוואר נעול', 'Bend the knees a little, pull the trunk back and release it forward from the abs — the forehead strikes, the neck locked'),
    'chestControl.stiff_legs': msg('כשהכדור מגיע — כופף את הברכיים ומשוך את החזה מעט אחורה, כאילו אתה תופס ביצה', 'As the ball arrives — bend the knees and draw the chest slightly back, as if catching an egg'),
    'jockeyStance.too_high': msg('רד לגובה של כיסא — ברכיים כפופות, משקל על כריות הרגליים, ישבן מעט אחורה', 'Drop to chair height — knees bent, weight on the balls of the feet, hips slightly back'),
  };
  return { profiles, tags, how };
}

/** The football patterns of the catalog (+ the existing shadowPass / shadowKick / gkStance). */
export function footballPatterns(t) {
  return {
    instepPass: { source: { profile: 'instepPass' }, qualities: ['technique', 'sportSkill', 'balance'], sports: ['field'], needs: ['standing'], unilateral: true,
      name: t('מסירה בגב כף הרגל', 'Instep pass'), cue: t('אצבעות למטה, שרוכים במרכז הכדור', 'Toes down, laces through the middle of the ball') },
    outsidePass: { source: { profile: 'outsidePass' }, qualities: ['technique', 'sportSkill', 'balance'], sports: ['field'], needs: ['standing'], unilateral: true,
      name: t('מסירה בצד החיצוני', 'Outside-foot pass'), cue: t('כף הרגל פנימה, צד חיצוני לכדור', 'Foot turned in, the outside to the ball') },
    loftedPass: { source: { profile: 'loftedPass' }, qualities: ['technique', 'sportSkill', 'power'], sports: ['field'], needs: ['standing'], unilateral: true,
      name: t('מסירה מוגבהת', 'Lofted pass'), cue: t('מתחת לכדור עם גב כף הרגל, המשך תנועה גבוה', 'Under the ball with the instep, a high follow-through') },
    shadowVolley: { source: { profile: 'shadowVolley' }, qualities: ['technique', 'sportSkill', 'power'], sports: ['field'], needs: ['standing'], unilateral: true,
      name: t('וולה בצל', 'Shadow volley'), cue: t('ברך מעל הכדור, קרסול נעול', 'Knee over the ball, ankle locked') },
    shadowHeader: { source: { profile: 'shadowHeader' }, qualities: ['technique', 'sportSkill', 'power'], sports: ['field'], needs: ['standing'],
      name: t('נגיחה בצל', 'Shadow header'), cue: t('מהירכיים והבטן — המצח פוגע', 'From the hips and abs — the forehead strikes') },
    chestControl: { source: { profile: 'chestControl' }, qualities: ['technique', 'sportSkill'], sports: ['field'], needs: ['standing'],
      name: t('עצירה בחזה', 'Chest control'), cue: t('החזה פתוח, הברכיים בולמות', 'Chest open, the knees cushion') },
    soleTrap: { source: { profile: 'soleTrap' }, qualities: ['technique', 'sportSkill', 'balance'], sports: ['field'], needs: ['standing'], unilateral: true,
      name: t('עצירה בסוליה', 'Sole trap'), cue: t('הסוליה על הכדור, לחיצה עדינה', 'The sole on the ball, a gentle press') },
    toeTaps: { source: { profile: 'toeTaps' }, qualities: ['coordination', 'sportSkill', 'activation'], sports: ['field'], needs: ['standing', 'twoLegs'],
      name: t('נגיעות לסירוגין על הכדור', 'Toe taps'), cue: t('נגיעות קלות ומהירות, על כריות הרגליים', 'Light quick touches, on the balls of the feet') },
    juggling: { source: { profile: 'juggling' }, qualities: ['coordination', 'technique', 'sportSkill'], sports: ['field'], needs: ['standing'],
      name: t("ג'אגלינג", 'Juggling'), cue: t('גב כף הרגל, קרסול נעול, עד גובה המותן', 'The instep, ankle locked, up to the waist') },
    stepOver: { source: { profile: 'stepOver' }, qualities: ['agility', 'technique', 'sportSkill'], sports: ['field'], needs: ['standing', 'twoLegs'],
      name: t('הטעיה — צעד מעל הכדור', 'Stepover'), cue: t('הרגל מקיפה את הכדור, הכתפיים מוכרות', 'The leg circles the ball, the shoulders sell it') },
    jockeyStance: { source: { profile: 'jockeyStance' }, qualities: ['stability', 'strength', 'technique', 'sportSkill'], sports: ['field'], needs: ['standing', 'bilateralStance'],
      name: t("עמידת הגנה — ג'וקי", 'Defensive jockey stance'), cue: t('נמוך, בזווית, עיניים על הכדור', 'Low, side-on, eyes on the ball') },
    lateralBounds: { source: { profile: 'lateralBounds' }, qualities: ['plyometric', 'agility', 'power'], sports: ['field', 'court'], needs: ['standing', 'twoLegs'],
      name: t('ניתורים לצדדים', 'Lateral bounds'), cue: t('דחוף לצד, נחת רך ועצור', 'Push sideways, land soft and stick it') },
    singleLegHop: { source: { profile: 'singleLegHop' }, qualities: ['plyometric', 'balance', 'singleLegStrength'], sports: ['field', 'court'], needs: ['standing'], unilateral: true, splitSides: true,
      name: t('ניתורים על רגל אחת', 'Single-leg hops'), cue: t('נחיתה רכה, הברך מעל האצבעות', 'A soft landing, the knee over the toes') },
    stickLanding: { source: { profile: 'stickLanding' }, qualities: ['plyometric', 'stability', 'rehab'], sports: ['field', 'court'], needs: ['standing', 'twoLegs'],
      name: t('נחיתה ויציבות', 'Stick landing'), cue: t('נחת על שתי הרגליים ועצור שתי שניות', 'Land on both feet and hold for two seconds') },
  };
}

/** The football strike patterns (per-leg sets, a ball at the foot). */
export const FOOTBALL_STRIKES = ['instepPass', 'outsidePass', 'loftedPass', 'shadowVolley'];
/** The passes among them (the pass's words: never "kick"). */
export const FOOTBALL_PASSES = ['instepPass', 'outsidePass', 'loftedPass'];

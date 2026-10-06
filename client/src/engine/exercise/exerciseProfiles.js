// ============================================================
// exerciseProfiles — Expert Execution Profiles (Stage 3.1)
//
// PURE DATA + lookups. One profile per exercise family answers three questions:
//   1. KINEMATICS  — which joints are measured, the target range at rest and at the peak
//                    of the rep (or the hold range), and which deviations are an error
//                    (coaching) or DANGER (stop / critical voice alert).
//   2. LIMBS       — which body parts must be inside the camera frame before anything
//                    counts (no leg exercise without the legs in view).
//   3. GHOST       — the joint angles the Ghost demonstrates. The Ghost is generated
//                    from these numbers (profileGhost.js), and tests assert that every
//                    Ghost angle lies inside the profile's own target ranges and that the
//                    evaluator raises no error on the Ghost — the Ghost IS the profile.
//
// TEMPORAL knowledge (motionFeatures.js): `dynamics` rules judge how the movement FLOWS —
// tempo, landing / shock absorption, proximal-to-distal sequencing, weight transfer, cadence,
// pelvic stability. `tags` describe the movement pattern; the sport library
// (engine/sports/sportLibrary.js) layers sport-specific rules + explanations on matching tags.
// Every rule has a correction (msg) and may carry a WHY explanation the coach can give.
// kind: 'reps' (rest ↔ peak), 'hold', 'cyclic' (running — rest/peak per stride), 'strike' (kicks).
//
// precision 'expert': full kinematic model + Ghost.
// precision 'basic' : family coverage (required limbs + posture) for exercises that do not
//                     have an expert model yet — every exercise the coach can give has one.
//
// Metric names: see kinematics.js (knee, hip, elbow, shoulder, bodyLine, trunkLean).
// Ranges are [lo, hi] in degrees. Angles are the 2D/3D inner angles MediaPipe yields
// (the same angleCosine the rep counters use).
// ============================================================

const msg = (he, en) => ({ he, en });

// ---- Shared rules ----
const UPRIGHT_TORSO = (value, severity = 'error') => ({
  id: 'trunk_lean', metric: 'trunkLean', op: '>', value, severity, when: 'any',
  msg: msg('שמור על גב זקוף — חזה למעלה', 'Keep your back upright — chest up'),
  why: msg('גב זקוף מחלק את העומס בין הירכיים לברכיים ושומר על עמוד השדרה ניטרלי',
    'An upright back shares the load between hips and knees and keeps the spine neutral'),
});
const WHY_BACK = msg('קריסת הגב קדימה תחת עומס מעמיסה על הדיסקים בגב התחתון',
  'A back collapsing forward under load stresses the lower-back discs');
const WHY_HIPS = msg('אגן שקורס מכופף את הגב התחתון לאחור ומעביר את העומס מהבטן לחוליות',
  'Sagging hips arch the lower back and move the load from the abs onto the vertebrae');

const RAW_EXPERT = {
  // ---------------- Lower body ----------------
  squat: {
    id: 'squat', name: msg('סקוואט', 'Squat'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'side', require: ['legs', 'torso'], primary: 'knee',
    joints: {
      knee: { rest: [155, 180], peak: [65, 105] },
      hip: { rest: [150, 180], peak: [55, 110] },
    },
    rules: [
      { id: 'too_shallow', metric: 'knee', op: '>', value: 125, severity: 'error', when: 'peak',
        msg: msg('רד עמוק יותר — ירכיים לכיוון מקביל לרצפה', 'Go deeper — thighs toward parallel') },
      { id: 'too_deep', metric: 'knee', op: '<', value: 45, severity: 'error', when: 'any',
        msg: msg('עמוק מדי — עצור במקביל לרצפה', 'Too deep — stop at parallel') },
      UPRIGHT_TORSO(58),
      { id: 'trunk_collapse', metric: 'trunkLean', op: '>', value: 72, severity: 'danger', when: 'any',
        msg: msg('עצור! הגב נופל קדימה — סכנה לגב התחתון', 'Stop! Your back is collapsing forward — lower-back risk'), why: WHY_BACK },
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 3200,
      rest: { knee: 175, hip: 172, shoulder: 20, elbow: 170 },
      peak: { knee: 85, hip: 80, shoulder: 80, elbow: 170 },
    },
  },

  miniSquat: {
    id: 'miniSquat', name: msg('מיני סקוואט', 'Mini squat'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'side', require: ['legs', 'torso'], primary: 'knee',
    joints: {
      knee: { rest: [160, 180], peak: [120, 150] },
      hip: { rest: [155, 180], peak: [120, 155] },
    },
    rules: [
      { id: 'too_deep', metric: 'knee', op: '<', value: 105, severity: 'error', when: 'any',
        msg: msg('זה מיני סקוואט — אל תרד יותר מרבע', 'This is a mini squat — only a quarter of the way down') },
      UPRIGHT_TORSO(40),
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 3200,
      rest: { knee: 175, hip: 174, shoulder: 15, elbow: 170 },
      peak: { knee: 135, hip: 140, shoulder: 45, elbow: 170 },
    },
  },

  lunge: {
    id: 'lunge', name: msg("לאנג'", 'Lunge'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'side', require: ['legs', 'torso'], primary: 'knee',
    joints: {
      knee: { rest: [140, 180], peak: [75, 110] },
    },
    rules: [
      { id: 'too_shallow', metric: 'knee', op: '>', value: 130, severity: 'error', when: 'peak',
        msg: msg('רד עד שהברך הקדמית ב-90 מעלות', 'Lower until the front knee is at 90 degrees') },
      { id: 'too_deep', metric: 'knee', op: '<', value: 60, severity: 'error', when: 'any',
        msg: msg('אל תקרוס — עצור ב-90 מעלות', "Don't collapse — stop at 90 degrees") },
      UPRIGHT_TORSO(35),
    ],
    ghost: {
      view: 'side', base: 'lunge', periodMs: 3400,
      rest: { knee: 165, hip: 168, shoulder: 10, elbow: 170, shank: 3 },
      peak: { knee: 92, hip: 100, shoulder: 10, elbow: 170, shank: 8 },
    },
  },

  wallSit: {
    id: 'wallSit', name: msg('ישיבה על הקיר', 'Wall sit'), precision: 'expert', kind: 'hold',
    posture: 'standing', cameraView: 'side', require: ['legs', 'torso'], primary: 'knee',
    joints: {
      knee: { rest: [75, 110] },
      hip: { rest: [75, 115] },
    },
    rules: [
      { id: 'too_high', metric: 'knee', op: '>', value: 125, severity: 'error', when: 'any',
        msg: msg('רד נמוך יותר — ברכיים ב-90 מעלות', 'Slide lower — knees at 90 degrees') },
      UPRIGHT_TORSO(30),
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 4000,
      rest: { knee: 92, hip: 92, shoulder: 10, elbow: 170, shank: 2 },
    },
  },

  hipHinge: {
    id: 'hipHinge', name: msg('הטיית אגן (דדליפט)', 'Hip hinge (deadlift)'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'side', require: ['legs', 'torso'], primary: 'hip',
    joints: {
      hip: { rest: [155, 180], peak: [70, 115] },
      knee: { rest: [145, 180], peak: [135, 180] },
    },
    rules: [
      { id: 'squatting', metric: 'knee', op: '<', value: 120, severity: 'error', when: 'any',
        msg: msg('זו הטיה מהאגן, לא סקוואט — ברכיים כמעט ישרות', "It's a hinge, not a squat — knees almost straight") },
      { id: 'over_bend', metric: 'trunkLean', op: '>', value: 100, severity: 'danger', when: 'any',
        msg: msg('עצור! ירדת נמוך מדי — סכנה לגב', 'Stop! Too low — back risk'), why: WHY_BACK },
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 3600, armsHang: true,
      rest: { knee: 172, hip: 172, elbow: 172, shank: 2 },
      peak: { knee: 155, hip: 92, elbow: 172, shank: 5 },
    },
  },

  // ---------------- Floor ----------------
  pushUp: {
    id: 'pushUp', name: msg('שכיבות סמיכה', 'Push-up'), precision: 'expert', kind: 'reps',
    posture: 'prone', cameraView: 'side', require: ['arms', 'body'], primary: 'elbow',
    joints: {
      elbow: { rest: [150, 180], peak: [70, 105] },
      bodyLine: { rest: [160, 180], peak: [160, 180] },
    },
    rules: [
      { id: 'body_line', metric: 'bodyLine', op: '<', value: 158, severity: 'error', when: 'any',
        msg: msg('גוף בקו ישר — הדק בטן וישבן', 'Straight body line — brace abs and glutes') },
      { id: 'hip_sag', metric: 'bodyLine', op: '<', value: 140, severity: 'danger', when: 'any',
        msg: msg('עצור! האגן קורס — סכנה לגב התחתון', 'Stop! Hips are sagging — lower-back risk'), why: WHY_HIPS },
      { id: 'too_shallow', metric: 'elbow', op: '>', value: 125, severity: 'error', when: 'peak',
        msg: msg('רד נמוך יותר — מרפקים ל-90 מעלות', 'Go lower — elbows to 90 degrees') },
    ],
    ghost: {
      view: 'side', base: 'prone', support: 'hands', periodMs: 2800,
      rest: { elbow: 172 },
      peak: { elbow: 85 },
    },
  },

  plank: {
    id: 'plank', name: msg('פלאנק', 'Plank'), precision: 'expert', kind: 'hold',
    posture: 'prone', cameraView: 'side', require: ['body'], primary: 'bodyLine',
    joints: {
      bodyLine: { rest: [160, 180] },
    },
    rules: [
      { id: 'body_line', metric: 'bodyLine', op: '<', value: 158, severity: 'error', when: 'any',
        msg: msg('גוף בקו ישר — אל תוריד ואל תרים את האגן', "Straight line — don't drop or lift your hips") },
      { id: 'hip_sag', metric: 'bodyLine', op: '<', value: 140, severity: 'danger', when: 'any',
        msg: msg('עצור! האגן קורס — סכנה לגב התחתון', 'Stop! Hips are sagging — lower-back risk'), why: WHY_HIPS },
    ],
    ghost: {
      view: 'side', base: 'prone', support: 'forearm', periodMs: 4000,
      rest: {},
    },
  },

  gluteBridge: {
    id: 'gluteBridge', name: msg('גשר ישבן', 'Glute bridge'), precision: 'expert', kind: 'reps',
    posture: 'supine', cameraView: 'side', require: ['legs', 'torso'], primary: 'hip',
    joints: {
      hip: { rest: [105, 145], peak: [160, 180] },
    },
    rules: [
      { id: 'too_low', metric: 'hip', op: '<', value: 150, severity: 'error', when: 'peak',
        msg: msg('הרם את האגן עד קו ישר מהכתפיים לברכיים', 'Lift your hips to a straight line from shoulders to knees') },
    ],
    ghost: {
      view: 'side', base: 'supine', periodMs: 3000,
      rest: { hip: 128 },
      peak: { hip: 172 },
    },
  },

  // ---------------- Upper body ----------------
  shoulderPress: {
    id: 'shoulderPress', name: msg('לחיצת כתפיים', 'Shoulder press'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ['arms', 'torso'], primary: 'shoulder',
    joints: {
      shoulder: { rest: [70, 110], peak: [150, 180], combine: 'max' },
      elbow: { rest: [70, 115], peak: [145, 180], combine: 'max' },
    },
    rules: [
      { id: 'partial', metric: 'elbow', op: '<', value: 135, severity: 'error', when: 'peak',
        msg: msg('יישר את הידיים עד הסוף למעלה', 'Fully extend your arms overhead') },
      UPRIGHT_TORSO(15),
    ],
    ghost: {
      view: 'front', base: 'stand', periodMs: 2800,
      rest: { shoulder: 92, elbow: 90 },
      peak: { shoulder: 168, elbow: 168 },
    },
  },

  lateralRaise: {
    id: 'lateralRaise', name: msg('הרמה צידית', 'Lateral raise'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ['arms', 'torso'], primary: 'shoulder',
    joints: {
      shoulder: { rest: [0, 35], peak: [75, 105], combine: 'max' },
      elbow: { rest: [140, 180], peak: [140, 180], combine: 'min' },
    },
    rules: [
      { id: 'too_high', metric: 'shoulder', op: '>', value: 118, severity: 'error', when: 'any',
        msg: msg('רק עד גובה הכתפיים', 'Only up to shoulder height') },
      { id: 'bent_arms', metric: 'elbow', op: '<', value: 125, severity: 'error', when: 'any',
        msg: msg('ידיים כמעט ישרות', 'Keep your arms almost straight') },
      UPRIGHT_TORSO(15),
    ],
    ghost: {
      view: 'front', base: 'stand', periodMs: 3000,
      rest: { shoulder: 15, elbow: 165 },
      peak: { shoulder: 90, elbow: 165 },
    },
  },

  frontRaise: {
    id: 'frontRaise', name: msg('הרמה קדמית', 'Front raise'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'side', require: ['arms', 'torso'], primary: 'shoulder',
    joints: {
      shoulder: { rest: [0, 35], peak: [75, 105], combine: 'max' },
      elbow: { rest: [140, 180], peak: [140, 180] },
    },
    rules: [
      { id: 'too_high', metric: 'shoulder', op: '>', value: 120, severity: 'error', when: 'any',
        msg: msg('רק עד גובה הכתפיים', 'Only up to shoulder height') },
      UPRIGHT_TORSO(18),
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 3000,
      rest: { knee: 175, hip: 175, shoulder: 12, elbow: 165 },
      peak: { knee: 175, hip: 175, shoulder: 90, elbow: 165 },
    },
  },

  rehabFrontRaise: {
    id: 'rehabFrontRaise', name: msg('הרמת יד קדמית מבוקרת', 'Controlled front raise'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'side', require: ['arms', 'torso'], primary: 'shoulder',
    joints: {
      shoulder: { rest: [0, 35], peak: [65, 100], combine: 'max' },
    },
    rules: [
      { id: 'too_high', metric: 'shoulder', op: '>', value: 110, severity: 'error', when: 'any',
        msg: msg('לאט ורק עד גובה הכתף', 'Slowly, and only up to shoulder height') },
      UPRIGHT_TORSO(15),
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 4000,
      rest: { knee: 175, hip: 175, shoulder: 10, elbow: 168 },
      peak: { knee: 175, hip: 175, shoulder: 82, elbow: 168 },
    },
  },

  bicepCurl: {
    id: 'bicepCurl', name: msg('כפיפת מרפק (ביספס)', 'Bicep curl'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'side', require: ['arms', 'torso'], primary: 'elbow',
    joints: {
      elbow: { rest: [145, 180], peak: [30, 75] },
      shoulder: { rest: [0, 35], peak: [0, 35], combine: 'max' },
    },
    rules: [
      { id: 'elbow_drift', metric: 'shoulder', op: '>', value: 42, severity: 'error', when: 'any',
        msg: msg('מרפקים צמודים לגוף — אל תזיז את הכתף', 'Elbows pinned to your sides — keep the shoulder still') },
      UPRIGHT_TORSO(18),
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 2600,
      rest: { knee: 175, hip: 175, shoulder: 8, elbow: 165 },
      peak: { knee: 175, hip: 175, shoulder: 16, elbow: 45 },
    },
  },

  rehabElbowFlex: {
    id: 'rehabElbowFlex', name: msg('כיפוף מרפק אקטיבי', 'Active elbow flexion'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'side', require: ['arms'], primary: 'elbow',
    joints: {
      elbow: { rest: [140, 180], peak: [30, 85] },
    },
    rules: [],
    ghost: {
      view: 'side', base: 'stand', periodMs: 3600,
      rest: { knee: 175, hip: 175, shoulder: 8, elbow: 165 },
      peak: { knee: 175, hip: 175, shoulder: 12, elbow: 55 },
    },
  },

  // ---------------- Dynamic / sport movements ----------------
  runInPlace: {
    id: 'runInPlace', name: msg('ריצה במקום', 'Running in place'), precision: 'expert', kind: 'cyclic',
    posture: 'standing', cameraView: 'side', require: ['legs', 'torso'], primary: 'hip',
    joints: {
      hip: { rest: [158, 180], peak: [95, 130] },
      elbow: { rest: [60, 125], peak: [60, 125] },
    },
    rules: [
      { id: 'trunk_lean', metric: 'trunkLean', op: '>', value: 25, severity: 'error', when: 'any',
        msg: msg('גו זקוף — הטיה קלה קדימה בלבד', 'Tall trunk — only a slight forward lean'),
        why: msg('גו זקוף משאיר את מרכז הכובד מעל כף הרגל הנוחתת ומקל על הנשימה', 'A tall trunk keeps the center of mass over the landing foot and eases breathing') },
      { id: 'arm_swing', metric: 'elbow', op: '>', value: 150, severity: 'error', when: 'any',
        msg: msg('מרפקים ב-90 מעלות, הידיים מתנדנדות מהכתף', 'Elbows at 90°, swing from the shoulder'),
        why: msg('תנופת ידיים נכונה מאזנת את סיבוב האגן ונותנת קצב לרגליים', 'A proper arm swing balances the pelvic rotation and drives the leg rhythm') },
    ],
    dynamics: [
      { id: 'cadence', on: 'landing', feature: 'cadence', op: '<', value: 150, severity: 'error',
        msg: msg('צעדים קצרים ומהירים יותר', 'Shorter, quicker steps'),
        why: msg('קצב צעדים גבוה מקטין את הזעזוע בכל נחיתה', 'A higher cadence lowers the impact of every landing') },
      { id: 'soft_landing', on: 'landing', feature: 'absorptionDeg', op: '<', value: 8, severity: 'error',
        msg: msg('נחיתה רכה — כופף את הברך ברגע המגע', 'Land soft — bend the knee as the foot touches'),
        why: msg('הברך היא בולם הזעזועים — נחיתה על רגל ישרה מעבירה את המכה לברך ולגב', 'The knee is the shock absorber — landing on a straight leg sends the impact to the knee and back') },
    ],
    ghost: {
      view: 'side', base: 'stride', alternate: true, periodMs: 700, restT: 0, peakT: 0.175,
      // Half cycle: A = landing / support leg, B = knee drive. Sides swap every half cycle.
      keyframes: [
        { t: 0, a: { 'A.knee': 168, 'B.thigh': 5, 'B.knee': 165, trunk: 5, armA: 5, armB: 5, elbow: 90 } },
        { t: 0.25, a: { 'A.knee': 150, 'B.thigh': 50, 'B.knee': 95, trunk: 5, armA: 25, armB: -20, elbow: 90 } },
        { t: 0.35, a: { 'A.knee': 155, 'B.thigh': 65, 'B.knee': 80, trunk: 5, armA: 40, armB: -30, elbow: 90 } },
        { t: 0.7, a: { 'A.knee': 166, 'B.thigh': 30, 'B.knee': 110, trunk: 5, armA: 20, armB: -15, elbow: 90 } },
        { t: 0.95, a: { 'A.knee': 170, 'B.thigh': 5, 'B.knee': 165, trunk: 5, armA: 5, armB: 5, elbow: 90 } },
      ],
    },
  },

  footballKick: {
    id: 'footballKick', name: msg('בעיטה', 'Kick'), precision: 'expert', kind: 'strike',
    posture: 'standing', cameraView: 'side', require: ['legs', 'torso'], primary: 'knee',
    joints: {
      knee: { rest: [60, 180] },
    },
    chain: [{ metric: 'hip', dir: -1 }, { metric: 'knee', dir: 1 }],   // hip flexion leads, knee extension follows
    rules: [
      { id: 'lean_back', metric: 'trunkLean', op: '>', value: 35, severity: 'error', when: 'any',
        msg: msg('אל תישען אחורה — חזה מעל הכדור', "Don't lean back — chest over the ball"),
        why: msg('נטייה אחורה מרימה את הכדור לגובה ומוציאה את המשקל מרגל התמיכה', 'Leaning back lifts the ball high and takes the weight off the support foot') },
    ],
    dynamics: [
      { id: 'strike_chain', on: 'strike', feature: 'chainLeadMs', op: '<', value: 15, severity: 'error',
        msg: msg('התחל את התנועה מהירך — ואז הברך', 'Start the swing from the hip — then the knee'),
        why: msg('הכוח עובר בשרשרת ירך → ברך → כף רגל', 'Power flows hip → knee → foot') },
      { id: 'strike_balance', on: 'strike', feature: 'balance', op: '>', value: 0.45, severity: 'error',
        msg: msg('משקל מעל רגל התמיכה', 'Weight over the support foot'),
        why: msg('בלי משקל מעל רגל התמיכה הבעיטה לא מדויקת והגוף נופל', 'Without weight over the support foot the kick is inaccurate and you lose balance') },
    ],
    ghost: {
      view: 'side', base: 'stride', periodMs: 2000, restT: 0,
      // A = support leg (the prosthetic side if there is one), B = kicking leg
      keyframes: [
        { t: 0, a: { 'A.knee': 168, 'B.thigh': 0, 'B.knee': 168, trunk: 4, armA: 10, armB: 10, elbow: 160 } },
        { t: 0.3, a: { 'A.knee': 160, 'B.thigh': -30, 'B.knee': 75, trunk: 3, armA: 35, armB: -20, elbow: 150 } },
        { t: 0.42, a: { 'A.knee': 156, 'B.thigh': 25, 'B.knee': 85, trunk: 5, armA: 40, armB: -25, elbow: 150 } },
        { t: 0.5, a: { 'A.knee': 152, 'B.thigh': 45, 'B.knee': 162, trunk: 6, armA: 45, armB: -25, elbow: 150 } },
        { t: 0.62, a: { 'A.knee': 158, 'B.thigh': 60, 'B.knee': 170, trunk: 6, armA: 30, armB: -15, elbow: 155 } },
        { t: 0.85, a: { 'A.knee': 166, 'B.thigh': 10, 'B.knee': 160, trunk: 4, armA: 12, armB: 8, elbow: 160 } },
      ],
    },
  },
};

// ---------------- Speed / power / balance patterns (Stage 3.1 catalog) ----------------
const STRIDE_ARMS = { armA: 5, armB: 5, elbow: 90, trunk: 5 };

RAW_EXPERT.buttKicks = {
  id: 'buttKicks', name: msg('בעיטות ישבן', 'Butt kicks'), precision: 'expert', kind: 'cyclic',
  posture: 'standing', cameraView: 'side', require: ['legs', 'torso'], primary: 'knee',
  joints: { knee: { rest: [150, 180], peak: [30, 75] } },
  rules: [
    { id: 'heel_low', metric: 'knee', op: '>', value: 95, severity: 'error', when: 'peak',
      msg: msg('עקב לכיוון הישבן — כופף את הברך עד הסוף', 'Heel to the glutes — bend the knee fully'),
      why: msg('כפיפת ברך מלאה מקצרת את מנוף הרגל ומאיצה את חזרתה קדימה בריצה', 'A full knee bend shortens the leg lever and speeds its recovery in running') },
  ],
  dynamics: [
    { id: 'soft_landing', on: 'landing', feature: 'absorptionDeg', op: '<', value: 6, severity: 'error',
      msg: msg('נחיתה רכה על כריות כף הרגל', 'Land softly on the balls of the feet'),
      why: msg('נחיתה רכה מגינה על הברך ומאפשרת קצב מהיר', 'A soft landing protects the knee and allows a fast rhythm') },
  ],
  ghost: {
    view: 'side', base: 'stride', alternate: true, periodMs: 700, restT: 0, peakT: 0.125,
    keyframes: [
      { t: 0, a: { 'A.knee': 168, 'B.thigh': 0, 'B.knee': 165, ...STRIDE_ARMS } },
      { t: 0.25, a: { 'A.knee': 152, 'B.thigh': -8, 'B.knee': 45, ...STRIDE_ARMS, armA: 30, armB: -20 } },
      { t: 0.6, a: { 'A.knee': 162, 'B.thigh': -2, 'B.knee': 90, ...STRIDE_ARMS, armA: 15, armB: -10 } },
      { t: 0.95, a: { 'A.knee': 170, 'B.thigh': 0, 'B.knee': 165, ...STRIDE_ARMS } },
    ],
  },
};

RAW_EXPERT.aSkip = {
  ...RAW_EXPERT.runInPlace,
  id: 'aSkip', name: msg('צעדי A (A-skip)', 'A-skip'),
  joints: { ...RAW_EXPERT.runInPlace.joints, hip: { rest: [158, 180], peak: [80, 110] } },
  dynamics: [...RAW_EXPERT.runInPlace.dynamics.filter(d => d.id !== 'cadence'),
    // judged on the deepest point of every stride (temporal), not on a single frame
    { id: 'knee_drive', on: 'rep', feature: 'primaryPeak', op: '>', value: 112, severity: 'error',
      msg: msg('ברך למעלה עד גובה הירך, כף רגל מכוונת למעלה', 'Knee up to hip height, toes pulled up'),
      why: msg('צעד A מלמד את תנועת הברך והדריכה של ריצה מהירה', 'The A-skip teaches the knee drive and foot strike of fast running') }],
  ghost: {
    ...RAW_EXPERT.runInPlace.ghost, periodMs: 1000,
    keyframes: [
      // contact → absorb on the support knee → small hop at the knee drive → land
      { t: 0, a: { 'A.knee': 168, 'B.thigh': 5, 'B.knee': 168, trunk: 4, armA: 5, armB: 5, elbow: 90, rise: 0 } },
      { t: 0.2, a: { 'A.knee': 145, 'B.thigh': 55, 'B.knee': 95, trunk: 4, armA: 30, armB: -20, elbow: 90, rise: 0 } },
      { t: 0.35, a: { 'A.knee': 172, 'B.thigh': 85, 'B.knee': 85, trunk: 4, armA: 45, armB: -30, elbow: 90, rise: 0.06 } },
      { t: 0.6, a: { 'A.knee': 166, 'B.thigh': 35, 'B.knee': 140, trunk: 4, armA: 20, armB: -15, elbow: 90, rise: 0 } },
      { t: 0.75, a: { 'A.knee': 168, 'B.thigh': 15, 'B.knee': 162, trunk: 4, armA: 10, armB: -5, elbow: 90, rise: 0 } },
      { t: 0.95, a: { 'A.knee': 170, 'B.thigh': 5, 'B.knee': 168, trunk: 4, armA: 5, armB: 5, elbow: 90, rise: 0 } },
    ],
  },
};

RAW_EXPERT.accelMarch = {
  id: 'accelMarch', name: msg('האצה בהטיה — צעדת קיר', 'Acceleration lean — wall march'), precision: 'expert', kind: 'cyclic',
  posture: 'standing', cameraView: 'side', require: ['legs', 'torso'], primary: 'hip',
  joints: { hip: { rest: [150, 180], peak: [75, 115] } },
  rules: [
    { id: 'lean_more', metric: 'trunkLean', op: '<', value: 25, severity: 'error', when: 'any',
      msg: msg('הטה את כל הגוף קדימה מהקרסוליים — קו ישר מהראש לעקב', 'Lean the whole body forward from the ankles — a straight line head to heel'),
      why: msg('בהאצה הגוף נוטה קדימה כדי לדחוף את הקרקע אחורה — עמידה זקופה בולמת את ההאצה', 'Accelerating, the body leans forward to push the ground back — standing tall brakes the acceleration') },
    { id: 'lean_too_much', metric: 'trunkLean', op: '>', value: 65, severity: 'error', when: 'any',
      msg: msg('אל תתקפל במותניים — הגוף נוטה כקו אחד', "Don't fold at the waist — the body leans as one line"),
      why: msg('קיפול במותן מנתק את הכוח מהרגליים', 'Folding at the waist disconnects the force from the legs') },
  ],
  dynamics: [],
  ghost: {
    view: 'side', base: 'stride', alternate: true, periodMs: 900, restT: 0, peakT: 0.175,
    keyframes: [
      // B.thigh is from vertical: with a 45° body lean, −35 = in line with the body, 50 = ~90° to the trunk
      { t: 0, a: { 'A.knee': 172, 'A.shank': 40, 'B.thigh': -35, 'B.knee': 160, trunk: 45, armA: 0, armB: 20, elbow: 90 } },
      { t: 0.35, a: { 'A.knee': 170, 'A.shank': 42, 'B.thigh': 50, 'B.knee': 75, trunk: 45, armA: 60, armB: -10, elbow: 90 } },
      { t: 0.7, a: { 'A.knee': 172, 'A.shank': 40, 'B.thigh': 10, 'B.knee': 110, trunk: 45, armA: 30, armB: 5, elbow: 90 } },
      { t: 0.95, a: { 'A.knee': 172, 'A.shank': 40, 'B.thigh': -35, 'B.knee': 160, trunk: 45, armA: 0, armB: 20, elbow: 90 } },
    ],
  },
};

RAW_EXPERT.kneeUpBalance = {
  id: 'kneeUpBalance', name: msg('עמידה על רגל אחת — ברך למעלה', 'Single-leg balance — knee up'), precision: 'expert', kind: 'hold',
  posture: 'standing', cameraView: 'side', require: ['legs', 'torso'], primary: 'hip',
  joints: { hip: { rest: [75, 115] } },
  rules: [
    { id: 'knee_drop', metric: 'hip', op: '>', value: 130, severity: 'error', when: 'any',
      msg: msg('ברך למעלה — ירך מקבילה לרצפה', 'Knee up — thigh parallel to the floor'),
      why: msg('ההחזקה בגובה מפעילה את מייצבי האגן של רגל התמיכה', 'Holding it high works the pelvic stabilizers of the support leg') },
    { id: 'trunk_lean', metric: 'trunkLean', op: '>', value: 15, severity: 'error', when: 'any',
      msg: msg('גו זקוף — דחוף את הראש לתקרה', 'Stand tall — push the top of your head to the ceiling'),
      why: msg('גו זקוף משאיר את מרכז הכובד מעל רגל התמיכה', 'A tall trunk keeps the center of mass over the support foot') },
  ],
  dynamics: [
    { id: 'hold_steady', on: 'window', feature: 'swayRatio', op: '>', value: 0.1, severity: 'error',
      msg: msg('יציב — מבט לנקודה קבועה', 'Steady — fix your eyes on one point'),
      why: msg('שליטה בהתנדנדות היא האימון של הקרסול והאגן', 'Controlling the sway is what trains the ankle and the hip') },
  ],
  ghost: {
    view: 'side', base: 'stride', periodMs: 4000, restT: 0,
    keyframes: [{ t: 0, a: { 'A.knee': 172, 'B.thigh': 80, 'B.knee': 90, trunk: 2, armA: 20, armB: 20, elbow: 160 } }],
  },
};

RAW_EXPERT.jumpSquat = {
  id: 'jumpSquat', name: msg('קפיצת סקוואט', 'Squat jump'), precision: 'expert', kind: 'reps',
  posture: 'standing', cameraView: 'side', require: ['legs', 'torso'], primary: 'knee',
  joints: { knee: { rest: [165, 180], peak: [80, 115] } },   // rest includes the full extension of the take-off / flight
  rules: [
    UPRIGHT_TORSO(60),
  ],
  dynamics: [
    { id: 'soft_landing', on: 'landing', feature: 'absorptionDeg', op: '<', value: 15, severity: 'error',
      msg: msg('נחיתה רכה — ברכיים מתכופפות בנחיתה', 'Land soft — knees bend as you land'),
      why: msg('בנחיתה הרגליים הן בולם הזעזועים — נחיתה נוקשה מעמיסה על הברכיים והגב', 'On landing the legs are the shock absorbers — a stiff landing loads the knees and back') },
  ],
  ghost: {
    view: 'side', base: 'stand', periodMs: 2000, restT: 0, peakT: 0.3,
    keyframes: [
      { t: 0, a: { knee: 172, hip: 170, shoulder: 15, elbow: 165, rise: 0 } },
      { t: 0.3, a: { knee: 95, hip: 90, shoulder: -30, elbow: 165, rise: 0 } },
      { t: 0.42, a: { knee: 178, hip: 176, shoulder: 150, elbow: 165, rise: 0.25 } },
      { t: 0.5, a: { knee: 176, hip: 174, shoulder: 160, elbow: 165, rise: 0.38 } },
      { t: 0.62, a: { knee: 160, hip: 160, shoulder: 60, elbow: 165, rise: 0 } },
      { t: 0.72, a: { knee: 128, hip: 125, shoulder: 40, elbow: 165, rise: 0 } },
    ],
  },
};

// Movement-pattern tags (matched by the sport library)
const TAGS = {
  squat: ['strength', 'lowerBody', 'bilateral', 'squatPattern'],
  miniSquat: ['strength', 'lowerBody', 'bilateral', 'squatPattern', 'rehab'],
  lunge: ['strength', 'lowerBody', 'singleLeg'],
  wallSit: ['hold', 'isometric', 'lowerBody'],
  hipHinge: ['strength', 'lowerBody', 'hinge'],
  pushUp: ['strength', 'upperBody', 'push', 'core'],
  plank: ['hold', 'isometric', 'core'],
  gluteBridge: ['strength', 'lowerBody', 'hipExtension'],
  shoulderPress: ['strength', 'upperBody', 'overhead'],
  lateralRaise: ['strength', 'upperBody', 'shoulder'],
  frontRaise: ['strength', 'upperBody', 'shoulder'],
  rehabFrontRaise: ['strength', 'upperBody', 'shoulder', 'rehab'],
  bicepCurl: ['strength', 'upperBody', 'arm'],
  rehabElbowFlex: ['strength', 'upperBody', 'arm', 'rehab'],
  runInPlace: ['gait', 'cyclic', 'landing', 'conditioning'],
  footballKick: ['strike', 'chain', 'singleLegStance', 'ballSkill'],
  buttKicks: ['gait', 'cyclic', 'landing', 'conditioning'],
  aSkip: ['cyclic', 'landing', 'coordination', 'drill'],
  accelMarch: ['cyclic', 'acceleration'],
  kneeUpBalance: ['hold', 'isometric', 'balance', 'singleLegStance', 'lowerBody'],
  jumpSquat: ['plyometric', 'landing', 'lowerBody', 'bilateral'],
};

// High knees = running in place with a higher knee drive
RAW_EXPERT.highKnees = {
  ...RAW_EXPERT.runInPlace,
  id: 'highKnees', name: msg('ברכיים גבוהות', 'High knees'),
  joints: { ...RAW_EXPERT.runInPlace.joints, hip: { rest: [158, 180], peak: [75, 110] } },
  rules: [...RAW_EXPERT.runInPlace.rules,
    { id: 'knees_low', metric: 'hip', op: '>', value: 120, severity: 'error', when: 'peak',
      msg: msg('ברכיים גבוה יותר — ירך מקבילה לרצפה', 'Knees higher — thigh parallel to the floor'),
      why: msg('הרמת ברך גבוהה מפעילה את מכופפי הירך ומשפרת את דחיפת הצעד', 'A high knee drive works the hip flexors and improves the push of each stride') }],
  ghost: {
    ...RAW_EXPERT.runInPlace.ghost, periodMs: 700,
    keyframes: RAW_EXPERT.runInPlace.ghost.keyframes.map(k => ({
      ...k, a: { ...k.a, 'B.thigh': k.t === 0.35 ? 85 : k.t === 0.25 ? 65 : k.a['B.thigh'] },
    })),
  },
};
TAGS.highKnees = TAGS.runInPlace;

/** @type {Object<string, Object>} */
export const EXPERT_PROFILES = Object.freeze(Object.fromEntries(
  Object.entries(RAW_EXPERT).map(([id, p]) => [id, Object.freeze({ dynamics: [], ...p, tags: TAGS[id] || [] })]),
));

// ---- Family coverage (precision 'basic'): required limbs only, no Ghost yet ----
const basic = (id, he, en, require, posture = 'standing') => Object.freeze({
  id, name: msg(he, en), precision: 'basic', kind: 'reps', posture, cameraView: 'front',
  require, primary: null, joints: {}, rules: [], dynamics: [], tags: [], ghost: null,
});

export const FAMILY_PROFILES = Object.freeze({
  legsStanding: basic('legsStanding', 'תרגיל רגליים בעמידה', 'Standing leg drill', ['legs']),
  armsStanding: basic('armsStanding', 'תרגיל ידיים', 'Arm exercise', ['arms', 'torso']),
  fullBody: basic('fullBody', 'תרגיל גוף מלא', 'Full-body drill', ['legs', 'torso']),
  floorCore: basic('floorCore', 'תרגיל ליבה על הרצפה', 'Floor core exercise', ['body'], 'floor'),
  seatedArms: basic('seatedArms', 'תרגיל ידיים בישיבה', 'Seated arm drill', ['arms'], 'seated'),
  upperBody: basic('upperBody', 'תרגיל פלג גוף עליון', 'Upper-body drill', ['torso']),
});

// cueKey (exerciseAnalysis ANALYZER_MAP) → profile id. Every cueKey the coach can produce is listed.
const CUE_TO_PROFILE = {
  // expert
  squat: 'squat', rehabMiniSquat: 'miniSquat', lunge: 'lunge', wallsit: 'wallSit', deadlift: 'hipHinge',
  push: 'pushUp', plank: 'plank', bridge: 'gluteBridge',
  shoulder: 'shoulderPress', lateral: 'lateralRaise', frontRaise: 'frontRaise', rehabFrontRaise: 'rehabFrontRaise',
  bicep: 'bicepCurl', rehabElbowFlex: 'rehabElbowFlex',
  // legs (standing)
  running: 'runInPlace', highKnees: 'highKnees', kick: 'footballKick', buttKicks: 'buttKicks',
  calfRaise: 'legsStanding',
  amputeeKick: 'legsStanding', pass: 'legsStanding', firstTouch: 'legsStanding', juggle: 'legsStanding',
  dribbling: 'legsStanding', footwork: 'legsStanding', splitStep: 'legsStanding', coneDrill: 'legsStanding',
  quickTurns: 'legsStanding', shieldBall: 'legsStanding', crossover: 'legsStanding', defensiveSlide: 'legsStanding',
  crutchPass: 'legsStanding', crutchDribble: 'legsStanding', crutchAgility: 'legsStanding', crutchPivot: 'legsStanding',
  crutchShield: 'legsStanding', crutchBalance: 'legsStanding', rehabWeightShift: 'legsStanding',
  rehabKneeFlex: 'legsStanding', rehabSitToStand: 'legsStanding', gkPositioning: 'legsStanding',
  // full body (standing)
  jump: 'fullBody', amputeeSprint: 'fullBody', layup: 'fullBody', spinMove: 'fullBody',
  postMoves: 'fullBody', gkDive: 'fullBody', gkReaction: 'fullBody', headers: 'fullBody', crutchHeader: 'fullBody',
  chestControl: 'fullBody', crutchChestControl: 'fullBody',
  // arms (standing)
  pull: 'armsStanding', tricep: 'armsStanding', row: 'armsStanding', pullApart: 'armsStanding', shrug: 'armsStanding',
  dip: 'armsStanding', shooting: 'armsStanding', handDribble: 'armsStanding', stroke: 'armsStanding',
  volley: 'armsStanding', serve: 'armsStanding', bouncePass: 'armsStanding', chestPass: 'armsStanding',
  overheadPass: 'armsStanding', hookShot: 'armsStanding', smash: 'armsStanding', gkDistribution: 'armsStanding',
  rehabPendulum: 'armsStanding', rehabExtRot: 'armsStanding', rehabElbowExt: 'armsStanding',
  rehabPronSup: 'armsStanding', rehabWallAngel: 'armsStanding', rehabReach: 'armsStanding',
  // floor
  mountain: 'floorCore', crunch: 'floorCore', sideplank: 'floorCore', superman: 'floorCore', deadbug: 'floorCore',
  birddog: 'floorCore', russianTwist: 'floorCore', legRaise: 'floorCore', flutter: 'floorCore', vups: 'floorCore',
  donkeyKick: 'floorCore', hollowBody: 'floorCore', plankTap: 'floorCore', rehabCatCow: 'floorCore',
  rehabPelvicTilt: 'floorCore', rehabSLR: 'floorCore',
  // seated (wheelchair)
  wheelchairShooting: 'seatedArms', wheelchairDribble: 'seatedArms', wheelchairPass: 'seatedArms',
  wheelchairStroke: 'seatedArms', wheelchairServe: 'seatedArms', wcBouncePass: 'seatedArms',
  wcPushSprint: 'seatedArms', wcSmash: 'seatedArms',
};

/** Every profile by id (expert + family). */
export function getProfileById(id) {
  return EXPERT_PROFILES[id] || FAMILY_PROFILES[id] || null;
}

// Exercise names whose analyzer cueKey describes a different movement (e.g. a bear crawl is
// analysed with the 'running' cueKey, but it is a floor exercise)
const NAME_OVERRIDES = [
  { keywords: ['זחילת דוב', 'bear crawl', 'תולעת', 'inch worm', 'inchworm'], profile: 'floorCore' },
  { keywords: ['ספרינט', 'sprint', 'אינטרוול', 'interval'], profile: 'fullBody' },   // sprints are not done in place
];

/**
 * The execution profile for an analyzer cueKey (+ the exercise name for overrides). Never null:
 * unknown keys fall back to the upper-body family (at least the trainee's torso must be in view).
 */
export function getExerciseProfile(cueKey, exerciseName = '') {
  const name = String(exerciseName || '').toLowerCase();
  const override = name && NAME_OVERRIDES.find(o => o.keywords.some(k => name.includes(k)));
  if (override) return getProfileById(override.profile);
  return getProfileById(CUE_TO_PROFILE[cueKey]) || FAMILY_PROFILES.upperBody;
}

/** True if the cueKey is mapped explicitly (used by the coverage test). */
export function isCueKeyMapped(cueKey) {
  return Object.prototype.hasOwnProperty.call(CUE_TO_PROFILE, cueKey);
}

/**
 * Personalize a profile for the trainee (limbProfile):
 * a shoulder limited in the scan (romCapDeg) caps the shoulder target ranges and the Ghost,
 * so the target is always reachable and the Ghost never demonstrates beyond the measured range.
 */
export function personalizeProfile(profile, lp = {}) {
  if (!profile || profile.precision !== 'expert') return profile;
  const caps = ['left_arm', 'right_arm']
    .map(k => lp[k])
    .filter(l => l && l.trainable !== false && typeof l.romCapDeg === 'number')
    .map(l => l.romCapDeg);
  if (!caps.length || !profile.joints.shoulder) return profile;
  const cap = Math.min(...caps);
  const capRange = (r) => (r ? [Math.min(r[0], cap - 15), Math.min(r[1], cap)] : r);
  const capGhost = (g) => (g && typeof g.shoulder === 'number' ? { ...g, shoulder: Math.min(g.shoulder, cap - 5) } : g);
  const sh = profile.joints.shoulder;
  return {
    ...profile,
    personalCapDeg: cap,
    joints: { ...profile.joints, shoulder: { ...sh, rest: capRange(sh.rest), peak: capRange(sh.peak) } },
    ghost: profile.ghost && { ...profile.ghost, rest: capGhost(profile.ghost.rest), peak: capGhost(profile.ghost.peak) },
  };
}

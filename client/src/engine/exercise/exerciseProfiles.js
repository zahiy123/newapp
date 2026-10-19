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
  how: msg('הדק את הבטן לפני הירידה, הסתכל קדימה ולא לרצפה, ושלח את הישבן אחורה במקום את החזה קדימה', 'Brace your abs before you go down, look ahead not at the floor, and send the hips back instead of the chest forward'),
});
// upper-body drills: the trunk stays still (no swing / no arching) — its own words, not the squat's
const STILL_TORSO = (value) => ({
  id: 'trunk_lean', metric: 'trunkLean', op: '>', value, severity: 'error', when: 'any',
  msg: msg('בלי לנדנד את הגוף — גב זקוף, בטן מהודקת', 'No swinging — back tall, abs braced'),
  why: msg('תנופה או קשת בגב מרימות את המשקל במקום השריר שאתה מאמן, ודוחסות את החוליות בגב התחתון',
    'Swinging or arching lifts the weight instead of the muscle you train, and compresses the lower-back vertebrae'),
  how: msg('עמוד עם ברכיים רכות, הדק בטן וישבן לפני כל חזרה, ואם צריך לנדנד — המשקל כבד מדי', 'Stand with soft knees, brace abs and glutes before each rep — if you need to swing, the weight is too heavy'),
});
// the heels stay down (side / oblique view): the weight on the whole foot
const HEEL_LIFT = (when = 'peak') => ({
  id: 'heel_lift', metric: 'heelLift', op: '>', value: 0.07, severity: 'error', when, view: 'side',
  cue: msg('עקבים לרצפה!', 'Heels down!'),
  msg: msg('העקבים עולים מהרצפה — לחץ את הרצפה דרך העקבים', 'Your heels lift — press the floor through your heels'),
  why: msg('עקב שעולה מעביר את המשקל לאצבעות ודוחף את הברך קדימה — העומס עובר מהישבן לגיד הפיקה והאיזון נפגע', 'A lifting heel shifts the weight onto the toes and drives the knee forward — the load moves from the glutes to the patellar tendon and balance suffers'),
  how: msg('הרגש את כל כף הרגל על הרצפה, את המשקל באמצע ועד העקב; שלח את הישבן אחורה לפני שהברכיים מתכופפות', 'Feel the whole foot on the floor, the weight from mid-foot to heel; send the hips back before the knees bend'),
});
// single leg (frontal): the standing knee drifting toward the midline
const KNEE_IN = () => ({
  id: 'knee_in', metric: 'kneeIn', op: '>', value: 0.1, severity: 'error', when: 'peak', view: 'front',
  cue: msg('ברך מעל האצבעות!', 'Knee over the toes!'),
  msg: msg('הברך של רגל העמידה נופלת פנימה — כוון אותה מעל האצבע השנייה', 'Your standing knee caves in — aim it over your second toe'),
  why: msg('ברך שנופלת פנימה על רגל אחת היא המנגנון של קרע ברצועה הצולבת — היא סימן לישבן צדדי חלש', 'A knee caving in on one leg is the ACL injury mechanism — a sign of a weak side glute'),
  how: msg('הדק את הישבן של רגל העמידה, האגן ישר, ודחוף את הברך קלות החוצה לאורך כל הירידה', 'Squeeze the standing-side glute, keep the pelvis level, and push the knee slightly out all the way down'),
});
// knees over the toes (frontal view): a knee caving inward
const KNEE_VALGUS = (when = 'peak') => ({
  id: 'knee_valgus', metric: 'kneeTrack', op: '<', value: 0.75, severity: 'error', when, view: 'front',
  msg: msg('הברכיים נופלות פנימה — דחוף אותן החוצה, בכיוון האצבעות', 'Your knees cave in — push them out, over your toes'),
  why: msg('ברך שקורסת פנימה מסובבת את המפרק ומעמיסה על הרצועה הצולבת ועל המניסקוס — ברך בקו האצבעות מעבירה את הכוח ישר',
    'A knee caving inward twists the joint and loads the ACL and meniscus — a knee over the toes sends the force straight'),
  how: msg('כפות הרגליים ברוחב הכתפיים, אצבעות מעט החוצה; בירידה ובעלייה דחוף את הברכיים לכיוון האצבע השנייה', 'Feet shoulder-width, toes slightly out; going down and up, push the knees toward the second toe'),
});
const WHY_BACK = msg('קריסת הגב קדימה תחת עומס מעמיסה על הדיסקים בגב התחתון',
  'A back collapsing forward under load stresses the lower-back discs');
const WHY_HIPS = msg('אגן שקורס מכופף את הגב התחתון לאחור ומעביר את העומס מהבטן לחוליות',
  'Sagging hips arch the lower back and move the load from the abs onto the vertebrae');

const RAW_EXPERT = {
  // ---------------- Lower body ----------------
  squat: {
    id: 'squat', name: msg('סקוואט', 'Squat'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
    joints: {
      knee: { rest: [155, 180], peak: [65, 105] },
      hip: { rest: [150, 180], peak: [55, 110] },
    },
    rules: [
      { id: 'too_shallow', metric: 'knee', op: '>', value: 125, severity: 'error', when: 'peak',
        msg: msg('רד עמוק יותר — ירכיים לכיוון מקביל לרצפה', 'Go deeper — thighs toward parallel'),
        why: msg('בעומק של מקביל הישבן והארבע ראשי עובדים בטווח המלא — חצי תנועה בונה חצי כוח', 'At parallel the glutes and quads work through the full range — half a movement builds half the strength') },
      { id: 'too_deep', metric: 'knee', op: '<', value: 45, severity: 'error', when: 'any',
        msg: msg('עמוק מדי — עצור במקביל לרצפה', 'Too deep — stop at parallel'),
        why: msg('מתחת למקביל האגן מתגלגל פנימה והגב התחתון מתעגל — העומס עובר מהשרירים לרצועות ולדיסקים', 'Below parallel the pelvis tucks and the lower back rounds — the load moves from the muscles to the ligaments and discs') },
      UPRIGHT_TORSO(58),
      { id: 'trunk_collapse', metric: 'trunkLean', op: '>', value: 72, severity: 'danger', when: 'any',
        msg: msg('עצור! הגב נופל קדימה — סכנה לגב התחתון', 'Stop! Your back is collapsing forward — lower-back risk'), why: WHY_BACK },
      KNEE_VALGUS('peak'),
      HEEL_LIFT('peak'),
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 3200,
      rest: { knee: 175, hip: 172, shoulder: 20, elbow: 170 },
      peak: { knee: 85, hip: 80, shoulder: 80, elbow: 170 },
    },
  },

  miniSquat: {
    id: 'miniSquat', name: msg('מיני סקוואט', 'Mini squat'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
    joints: {
      knee: { rest: [160, 180], peak: [120, 150] },
      hip: { rest: [155, 180], peak: [120, 155] },
    },
    rules: [
      { id: 'too_deep', metric: 'knee', op: '<', value: 105, severity: 'error', when: 'any',
        msg: msg('זה מיני סקוואט — אל תרד יותר מרבע', 'This is a mini squat — only a quarter of the way down'),
        why: msg('כאן עובדים בטווח קצר ובטוח לברך — ירידה עמוקה מוסיפה בדיוק את העומס שהתרגיל נועד לחסוך', 'This drill works a short, knee-safe range — going deep adds exactly the load it is meant to spare') },
      UPRIGHT_TORSO(40),
      KNEE_VALGUS('peak'),
      HEEL_LIFT('peak'),
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 3200,
      rest: { knee: 175, hip: 174, shoulder: 15, elbow: 170 },
      peak: { knee: 135, hip: 140, shoulder: 45, elbow: 170 },
    },
  },

  lunge: {
    id: 'lunge', name: msg("לאנג'", 'Lunge'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
    joints: {
      knee: { rest: [140, 180], peak: [75, 110] },
    },
    rules: [
      { id: 'too_shallow', metric: 'knee', op: '>', value: 130, severity: 'error', when: 'peak',
        msg: msg('רד עד שהברך הקדמית ב-90 מעלות', 'Lower until the front knee is at 90 degrees'),
        why: msg('ב-90 מעלות הירך הקדמית מקבילה לרצפה — שם הישבן והארבע ראשי מקבלים את העבודה המלאה', 'At 90 degrees the front thigh is parallel to the floor — that is where the glutes and quads get the full work') },
      { id: 'too_deep', metric: 'knee', op: '<', value: 60, severity: 'error', when: 'any',
        msg: msg('אל תקרוס — עצור ב-90 מעלות', "Don't collapse — stop at 90 degrees"),
        why: msg('קריסה מתחת ל-90 דוחפת את הברך קדימה מעבר לאצבעות ומעמיסה על גיד הפיקה', 'Collapsing below 90 drives the knee past the toes and loads the patellar tendon') },
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
    posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
    joints: {
      knee: { rest: [75, 110] },
      hip: { rest: [75, 115] },
    },
    rules: [
      { id: 'too_high', metric: 'knee', op: '>', value: 125, severity: 'error', when: 'any',
        msg: msg('רד נמוך יותר — ברכיים ב-90 מעלות', 'Slide lower — knees at 90 degrees'),
        why: msg('ב-90 מעלות הארבע ראשי מחזיק את כל המשקל — גבוה יותר זו מנוחה, לא אימון', 'At 90 degrees the quads hold your whole weight — higher is resting, not training') },
      UPRIGHT_TORSO(30),
      KNEE_VALGUS('any'),
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 4000,
      rest: { knee: 92, hip: 92, shoulder: 10, elbow: 170, shank: 2 },
    },
  },

  hipHinge: {
    id: 'hipHinge', name: msg('הטיית אגן (דדליפט)', 'Hip hinge (deadlift)'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'hip',
    joints: {
      hip: { rest: [155, 180], peak: [70, 115] },
      knee: { rest: [145, 180], peak: [135, 180] },
    },
    rules: [
      { id: 'squatting', metric: 'knee', op: '<', value: 120, severity: 'error', when: 'any',
        msg: msg('זו הטיה מהאגן, לא סקוואט — ברכיים כמעט ישרות', "It's a hinge, not a squat — knees almost straight"),
        why: msg('בהטיה מהאגן העבודה של הירך האחורית והישבן — כיפוף ברכיים מעביר אותה לארבע ראשי ומפספס את מטרת התרגיל', 'In a hinge the hamstrings and glutes do the work — bending the knees hands it to the quads and misses the point') },
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
    posture: 'prone', cameraView: 'any', require: ['arms', 'body'], primary: 'elbow',
    joints: {
      elbow: { rest: [150, 180], peak: [70, 105] },
      bodyLine: { rest: [160, 180], peak: [160, 180] },
    },
    rules: [
      { id: 'body_line', metric: 'bodyLine', op: '<', value: 158, severity: 'error', when: 'any',
        msg: msg('גוף בקו ישר — הדק בטן וישבן', 'Straight body line — brace abs and glutes'),
        why: msg('בטן וישבן מהודקים הופכים את הגוף ליחידה אחת — הכוח עובר מהידיים לרצפה בלי לקרוס בגב התחתון', 'Braced abs and glutes make the body one unit — the force goes from the hands to the floor without the lower back sagging') },
      { id: 'hip_sag', metric: 'bodyLine', op: '<', value: 140, severity: 'danger', when: 'any',
        msg: msg('עצור! האגן קורס — סכנה לגב התחתון', 'Stop! Hips are sagging — lower-back risk'), why: WHY_HIPS },
      { id: 'too_shallow', metric: 'elbow', op: '>', value: 125, severity: 'error', when: 'peak',
        msg: msg('רד נמוך יותר — מרפקים ל-90 מעלות', 'Go lower — elbows to 90 degrees'),
        why: msg('ב-90 מעלות החזה והטרייספס עובדים בטווח המלא — ירידה חלקית מחזקת רק חצי מהתנועה', 'At 90 degrees the chest and triceps work the full range — a partial rep strengthens only half the movement') },
    ],
    ghost: {
      view: 'side', base: 'prone', support: 'hands', periodMs: 2800,
      rest: { elbow: 172 },
      peak: { elbow: 85 },
    },
  },

  plank: {
    id: 'plank', name: msg('פלאנק', 'Plank'), precision: 'expert', kind: 'hold',
    posture: 'prone', cameraView: 'any', require: ['body'], primary: 'bodyLine',
    joints: {
      bodyLine: { rest: [160, 180] },
    },
    rules: [
      { id: 'body_line', metric: 'bodyLine', op: '<', value: 158, severity: 'error', when: 'any',
        msg: msg('גוף בקו ישר — אל תוריד ואל תרים את האגן', "Straight line — don't drop or lift your hips"),
        why: msg('אגן נמוך מעמיס על הגב התחתון ואגן גבוה מוריד את העבודה מהבטן — רק קו ישר מחזק את שרירי הליבה', 'Low hips load the lower back and high hips take the work off the abs — only a straight line trains the core') },
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
    posture: 'supine', cameraView: 'any', require: ['legs', 'torso'], primary: 'hip',
    joints: {
      hip: { rest: [105, 145], peak: [160, 180] },
    },
    rules: [
      { id: 'too_low', metric: 'hip', op: '<', value: 150, severity: 'error', when: 'peak',
        msg: msg('הרם את האגן עד קו ישר מהכתפיים לברכיים', 'Lift your hips to a straight line from shoulders to knees'),
        why: msg('רק בקו ישר מהכתפיים לברכיים הישבן מתכווץ עד הסוף — חצי גובה משאיר את העבודה לגב התחתון', 'Only at a straight shoulder-to-knee line do the glutes contract fully — half height leaves the work to the lower back') },
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
        msg: msg('יישר את הידיים עד הסוף למעלה', 'Fully extend your arms overhead'),
        why: msg('יישור מלא מפעיל את הכתף בכל הטווח ומחזק את המייצבים של השכמה', 'Full lockout works the shoulder through its whole range and strengthens the shoulder-blade stabilizers') },
      STILL_TORSO(15),
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
        msg: msg('רק עד גובה הכתפיים', 'Only up to shoulder height'),
        why: msg('מעל גובה הכתף הטרפז משתלט על התנועה ויש לחץ על גידי הכתף — הדלתא עובדת עד הגובה הזה', 'Above shoulder height the traps take over and the shoulder tendons get pinched — the deltoid works up to this height') },
      { id: 'bent_arms', metric: 'elbow', op: '<', value: 125, severity: 'error', when: 'any',
        msg: msg('ידיים כמעט ישרות', 'Keep your arms almost straight'),
        why: msg('יד כמעט ישרה מרחיקה את המשקל מהכתף וכך הדלתא עובדת באמת — יד כפופה מקצרת את המנוף ומקלה מדי', 'A nearly straight arm keeps the load away from the shoulder so the deltoid really works — a bent arm shortens the lever and makes it too easy') },
      STILL_TORSO(15),
    ],
    ghost: {
      view: 'front', base: 'stand', periodMs: 3000,
      rest: { shoulder: 15, elbow: 165 },
      peak: { shoulder: 90, elbow: 165 },
    },
  },

  frontRaise: {
    id: 'frontRaise', name: msg('הרמה קדמית', 'Front raise'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ['arms', 'torso'], primary: 'shoulder',
    joints: {
      shoulder: { rest: [0, 35], peak: [75, 105], combine: 'max' },
      elbow: { rest: [140, 180], peak: [140, 180] },
    },
    rules: [
      { id: 'too_high', metric: 'shoulder', op: '>', value: 120, severity: 'error', when: 'any',
        msg: msg('רק עד גובה הכתפיים', 'Only up to shoulder height'),
        why: msg('מעל גובה הכתף הטרפז משתלט על התנועה ויש לחץ על גידי הכתף — הדלתא עובדת עד הגובה הזה', 'Above shoulder height the traps take over and the shoulder tendons get pinched — the deltoid works up to this height') },
      STILL_TORSO(18),
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 3000,
      rest: { knee: 175, hip: 175, shoulder: 12, elbow: 165 },
      peak: { knee: 175, hip: 175, shoulder: 90, elbow: 165 },
    },
  },

  rehabFrontRaise: {
    id: 'rehabFrontRaise', name: msg('הרמת יד קדמית מבוקרת', 'Controlled front raise'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ['arms', 'torso'], primary: 'shoulder',
    joints: {
      shoulder: { rest: [0, 35], peak: [65, 100], combine: 'max' },
    },
    rules: [
      { id: 'too_high', metric: 'shoulder', op: '>', value: 110, severity: 'error', when: 'any',
        msg: msg('לאט ורק עד גובה הכתף', 'Slowly, and only up to shoulder height'),
        why: msg('בשיקום הכתף בונים טווח בהדרגה — מעל גובה הכתף העומס על הגידים עולה לפני שהם מוכנים', 'In shoulder rehab the range is built gradually — above shoulder height the tendon load rises before they are ready') },
      STILL_TORSO(15),
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 4000,
      rest: { knee: 175, hip: 175, shoulder: 10, elbow: 168 },
      peak: { knee: 175, hip: 175, shoulder: 82, elbow: 168 },
    },
  },

  bicepCurl: {
    id: 'bicepCurl', name: msg('כפיפת מרפק (ביספס)', 'Bicep curl'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ['arms', 'torso'], primary: 'elbow',
    joints: {
      elbow: { rest: [145, 180], peak: [30, 75] },
      shoulder: { rest: [0, 35], peak: [0, 35], combine: 'max' },
    },
    rules: [
      { id: 'elbow_drift', metric: 'shoulder', op: '>', value: 42, severity: 'error', when: 'any',
        msg: msg('מרפקים צמודים לגוף — אל תזיז את הכתף', 'Elbows pinned to your sides — keep the shoulder still'),
        why: msg('כשהמרפק צמוד הדו-ראשי עושה את כל העבודה — מרפק שזז מעביר אותה לכתף ומקצר את הטווח', 'With the elbow pinned the biceps does all the work — a moving elbow hands it to the shoulder and shortens the range') },
      STILL_TORSO(18),
    ],
    ghost: {
      view: 'side', base: 'stand', periodMs: 2600,
      rest: { knee: 175, hip: 175, shoulder: 8, elbow: 165 },
      peak: { knee: 175, hip: 175, shoulder: 16, elbow: 45 },
    },
  },

  rehabElbowFlex: {
    id: 'rehabElbowFlex', name: msg('כיפוף מרפק אקטיבי', 'Active elbow flexion'), precision: 'expert', kind: 'reps',
    posture: 'standing', cameraView: 'front', require: ['arms'], primary: 'elbow',
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
    posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'hip',
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
    posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
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
      { id: 'kick_toe', on: 'strike', feature: 'contactToe', op: '>', value: 0.5, severity: 'error', view: 'front', coachNow: true,
        cue: msg('קצה הנעל — כוון את האצבעות למטה!', 'Toe-poke — point the toes down!'),
        msg: msg('בעטת עם קצה הנעל. כוון את האצבעות למטה, נעל את הקרסול ופגע עם השרוכים', 'You kicked with the tip of the boot. Point the toes down, lock the ankle, strike with the laces'),
        why: msg('קצה הנעל הוא נקודה קטנה — הכדור עף לכיוון אקראי והאצבעות סופגות מכה. השרוכים נותנים משטח קשיח, כוח וכיוון', 'The tip of the boot is a tiny point — the ball flies off at random and the toes take the hit. The laces give a firm surface, power and direction'),
        how: msg('הברך מעל הכדור ברגע המגע, כף הרגל מתוחה למטה כמו בלרינה, והשרוכים פוגעים במרכז הכדור', 'The knee over the ball at contact, the foot pointed down like a ballerina, the laces through the middle of the ball') },
      { id: 'strike_balance', on: 'strike', feature: 'balance', op: '>', value: 0.45, severity: 'error',
        msg: msg('משקל מעל רגל התמיכה', 'Weight over the support foot'),
        why: msg('בלי משקל מעל רגל התמיכה הבעיטה לא מדויקת והגוף נופל', 'Without weight over the support foot the kick is inaccurate and you lose balance') },
    ],
    ghost: {
      view: 'side', base: 'stride', periodMs: 2000, restT: 0, contactT: 0.48, foot: 'laces',
      // A = support leg (the prosthetic side if there is one), B = kicking leg.
      // A real instep drive: plant (support knee soft) -> cocking (hip back, heel to the seat) ->
      // the THIGH drives first while the knee stays bent -> contact with the foot low, laces through
      // the ball's middle, chest over the ball -> the knee snaps straight -> a high follow-through.
      // The arm on the support side opens for balance, the other swings back. Timing like a real
      // kick: a slow, loaded backswing, then an EXPLOSIVE drive -> contact -> snap (~0.2 s).
      keyframes: [
        { t: 0, a: { 'A.knee': 168, 'B.thigh': 0, 'B.knee': 168, trunk: 4, armA: 10, armB: 10, elbow: 160 } },
        { t: 0.16, a: { 'A.knee': 162, 'B.thigh': -12, 'B.knee': 128, trunk: 5, armA: 30, armB: -8, elbow: 152 } },
        { t: 0.36, a: { 'A.knee': 154, 'B.thigh': -32, 'B.knee': 72, trunk: 3, armA: 62, armB: -30, elbow: 145 } },
        { t: 0.43, a: { 'A.knee': 152, 'B.thigh': 10, 'B.knee': 84, trunk: 8, armA: 58, armB: -26, elbow: 145 } },
        { t: 0.48, a: { 'A.knee': 152, 'B.thigh': 26, 'B.knee': 130, trunk: 9, armA: 52, armB: -20, elbow: 148 } },
        { t: 0.53, a: { 'A.knee': 156, 'B.thigh': 46, 'B.knee': 166, trunk: 7, armA: 40, armB: -6, elbow: 152 } },
        { t: 0.64, a: { 'A.knee': 162, 'B.thigh': 64, 'B.knee': 172, trunk: 5, armA: 26, armB: 6, elbow: 156 } },
        { t: 0.84, a: { 'A.knee': 166, 'B.thigh': 12, 'B.knee': 152, trunk: 4, armA: 12, armB: 8, elbow: 160 } },
      ],
    },
  },
};

// ---------------- Speed / power / balance patterns (Stage 3.1 catalog) ----------------
const STRIDE_ARMS = { armA: 5, armB: 5, elbow: 90, trunk: 5 };

RAW_EXPERT.buttKicks = {
  id: 'buttKicks', name: msg('בעיטות ישבן', 'Butt kicks'), precision: 'expert', kind: 'cyclic',
  posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
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
  posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'hip',
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
  posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'hip',
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
    view: 'side', base: 'stride', periodMs: 4000, restT: 0, supportMustBear: true,
    keyframes: [{ t: 0, a: { 'A.knee': 172, 'B.thigh': 80, 'B.knee': 90, trunk: 2, armA: 20, armB: 20, elbow: 160 } }],
  },
};

RAW_EXPERT.jumpSquat = {
  id: 'jumpSquat', name: msg('קפיצת סקוואט', 'Squat jump'), precision: 'expert', kind: 'reps',
  posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
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

// Inside-foot pass: a shorter, controlled swing (accuracy over power)
RAW_EXPERT.shadowPass = {
  ...RAW_EXPERT.footballKick,
  id: 'shadowPass', name: msg('מסירה בצל', 'Shadow pass'),
  // the pass's own technique check (owner, 2026-10-18): a toe-poke instead of the inside of the foot is
  // told RIGHT AFTER the rep (frontal view only — there the foot's turn-out is visible)
  dynamics: [...(RAW_EXPERT.footballKick.dynamics || []),
    { id: 'pass_toe', on: 'strike', feature: 'contactToe', op: '>', value: 0.5, severity: 'error', view: 'front', coachNow: true,
      cue: msg('מסרת עם האצבעות — פתח את כף הרגל!', 'Toes — open the foot!'),
      msg: msg('שים לב — מסרת עם האצבעות. פתח את כף הרגל החוצה ופגע עם הפנים', 'Careful — you passed with your toes. Turn the foot out and strike with the inside'),
      why: msg('פנים כף הרגל הוא המשטח הרחב והשטוח — הוא נותן למסירה כיוון מדויק; האצבעות הן נקודה קטנה ועגולה, והכדור בורח לצדדים', 'The inside of the foot is the wide, flat surface — it gives the pass an accurate direction; the toes are a small round point, and the ball skews off'),
      how: msg('הסובב את הרגל מהירך החוצה עוד לפני הבעיטה, כך שהקשת של כף הרגל עומדת מול הכדור', 'Turn the leg out from the hip before the swing, so the arch of the foot faces the ball') },
    { id: 'pass_laces', on: 'strike', feature: 'contactLaces', op: '>', value: 0.5, severity: 'error', view: 'front', coachNow: true,
      cue: msg('זה היה עם השרוכים — מסירה עם הפנים!', 'That was the laces — pass with the inside!'),
      msg: msg('פגעת עם החלק המלא של כף הרגל — השרוכים. במסירה פותחים את כף הרגל ופוגשים עם הפנים', 'You struck with the full instep — the laces. In a pass, open the foot and meet the ball with the inside'),
      why: msg('השרוכים נותנים כוח, לא כיוון — הכדור יוצא חזק אבל לא מדויק. פנים כף הרגל נותן משטח רחב וכיוון שליטה', 'The laces give power, not direction — the ball goes hard but off target. The inside of the foot gives a wide surface and control'),
      how: msg('ברך הרגל הבועטת פונה החוצה, כף הרגל בזווית ישרה לכיוון המסירה, והתנועה קצרה — כמו מטוטלת', 'The kicking knee turns out, the foot square to the pass direction, and a short swing — like a pendulum') },
    { id: 'pass_ankle', on: 'strike', feature: 'ankleDeg', op: '>', value: 140, severity: 'error', view: 'front', coachNow: true,
      cue: msg('נעל את הקרסול — אצבעות למעלה!', 'Lock the ankle — toes up!'),
      msg: msg('הקרסול לא נעול — האצבעות צנחו למטה ברגע המגע. נעל את הקרסול, אצבעות למעלה', 'The ankle is not locked — the toes dropped at contact. Lock the ankle, toes up'),
      why: msg('קרסול רפוי בולע את המכה — הכדור יוצא חלש ובכיוון לא צפוי. קרסול נעול הופך את כף הרגל למשטח קשיח ויציב', 'A loose ankle absorbs the strike — the ball comes off weak and unpredictable. A locked ankle makes the foot a firm, stable surface'),
      how: msg('משוך את האצבעות אל השוק והחזק אותן כך עד אחרי המגע; העקב קצת נמוך מהאצבעות', 'Pull the toes toward the shin and hold them there until after contact; the heel slightly lower than the toes') }],
  ghost: {
    view: 'side', base: 'stride', periodMs: 1800, restT: 0, contactT: 0.48, foot: 'inside',
    // A real side-foot pass: the leg turns out from the hip so the INSIDE of the foot faces the
    // target, a short backswing, the foot low and the ankle locked, the chest over the ball, and a
    // short follow-through toward the target (accuracy, not power).
    keyframes: [
      { t: 0, a: { 'A.knee': 168, 'B.thigh': 0, 'B.knee': 168, trunk: 4, armA: 10, armB: 10, elbow: 160 } },
      { t: 0.18, a: { 'A.knee': 162, 'B.thigh': -8, 'B.knee': 142, trunk: 5, armA: 24, armB: -8, elbow: 155 } },
      { t: 0.34, a: { 'A.knee': 158, 'B.thigh': -22, 'B.knee': 112, trunk: 6, armA: 34, armB: -14, elbow: 152 } },
      { t: 0.43, a: { 'A.knee': 156, 'B.thigh': 4, 'B.knee': 118, trunk: 7, armA: 32, armB: -12, elbow: 152 } },
      { t: 0.48, a: { 'A.knee': 156, 'B.thigh': 14, 'B.knee': 152, trunk: 7, armA: 30, armB: -10, elbow: 154 } },
      { t: 0.56, a: { 'A.knee': 158, 'B.thigh': 30, 'B.knee': 166, trunk: 6, armA: 24, armB: -4, elbow: 156 } },
      { t: 0.7, a: { 'A.knee': 162, 'B.thigh': 22, 'B.knee': 164, trunk: 5, armA: 18, armB: 2, elbow: 158 } },
      { t: 0.86, a: { 'A.knee': 166, 'B.thigh': 6, 'B.knee': 162, trunk: 4, armA: 12, armB: 8, elbow: 160 } },
    ],
  },
};

// ---------------- One-leg strength (crutch-supported for a one-legged trainee) ----------------
RAW_EXPERT.singleLegSquat = {
  id: 'singleLegSquat', name: msg('סקוואט על רגל אחת', 'Single-leg squat'), precision: 'expert', kind: 'reps',
  posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
  joints: { knee: { rest: [150, 180], peak: [85, 125] } },
  rules: [
    { id: 'too_shallow', metric: 'knee', op: '>', value: 140, severity: 'error', when: 'peak',
      msg: msg('רד עוד קצת — לאט ובשליטה', 'A little lower — slowly, with control'),
      why: msg('הטווח בונה את הכוח של רגל התמיכה', 'The range builds the support leg\'s strength') },
    UPRIGHT_TORSO(50),
    KNEE_IN(),
  ],
  dynamics: [],
  ghost: {
    view: 'side', base: 'stride', periodMs: 3600, restT: 0, peakT: 0.5, supportMustBear: true,
    keyframes: [
      { t: 0, a: { 'A.knee': 172, 'A.shank': 4, 'B.thigh': 30, 'B.knee': 160, trunk: 8, armA: 45, armB: 45, elbow: 150 } },
      { t: 0.5, a: { 'A.knee': 105, 'A.shank': 30, 'B.thigh': 45, 'B.knee': 165, trunk: 28, armA: 55, armB: 55, elbow: 150 } },
    ],
  },
};

RAW_EXPERT.singleLegLunge = {
  id: 'singleLegLunge', name: msg("לאנג' על רגל אחת", 'Single-leg lunge'), precision: 'expert', kind: 'reps',
  posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
  joints: { knee: { rest: [150, 180], peak: [80, 120] } },
  rules: [
    { id: 'too_shallow', metric: 'knee', op: '>', value: 135, severity: 'error', when: 'peak',
      msg: msg('רד עד שהברך קרובה ל-90 מעלות', 'Lower until the knee is near 90 degrees'),
      why: msg('ירידה מלאה מחזקת את הירך והישבן של הרגל העובדת', 'A full descent strengthens the working leg\'s thigh and glutes') },
    UPRIGHT_TORSO(40),
    KNEE_IN(),
  ],
  dynamics: [],
  ghost: {
    view: 'side', base: 'stride', periodMs: 3600, restT: 0, peakT: 0.5, supportMustBear: true,
    keyframes: [
      { t: 0, a: { 'A.knee': 170, 'A.shank': 4, 'B.thigh': -12, 'B.knee': 170, trunk: 5, armA: 40, armB: 40, elbow: 150 } },
      { t: 0.5, a: { 'A.knee': 98, 'A.shank': 18, 'B.thigh': -35, 'B.knee': 128, trunk: 16, armA: 50, armB: 50, elbow: 150 } },
    ],
  },
};

// ---------------- Goalkeeper (incl. arm-amputee keepers) ----------------
RAW_EXPERT.gkStance = {
  id: 'gkStance', name: msg('עמידת מוכנות שוער', 'Goalkeeper ready stance'), precision: 'expert', kind: 'hold',
  posture: 'standing', cameraView: 'front', require: ['legs', 'torso'], primary: 'knee',
  joints: { knee: { rest: [115, 150] }, hip: { rest: [95, 140] } },
  rules: [
    { id: 'too_high', metric: 'knee', op: '>', value: 158, severity: 'error', when: 'any',
      msg: msg('נמוך יותר — ברכיים כפופות, מוכן לזנק', 'Lower — knees bent, ready to spring'),
      why: msg('עמידה נמוכה היא מה שנותן לשוער לזנק מהר לשני הצדדים', 'A low stance is what lets the keeper spring fast to both sides') },
    UPRIGHT_TORSO(45),
  ],
  dynamics: [],
  ghost: {
    view: 'side', base: 'stand', periodMs: 4000,
    rest: { knee: 132, hip: 118, shoulder: 60, elbow: 120 },
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
  shadowPass: ['strike', 'chain', 'singleLegStance', 'ballSkill'],
  singleLegSquat: ['strength', 'lowerBody', 'singleLeg'],
  singleLegLunge: ['strength', 'lowerBody', 'singleLeg'],
  gkStance: ['hold', 'isometric', 'lowerBody'],
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
// HOW to fix — the coach's practical instruction for the rest's analysis (the what + the why are in the rule)
const HOW = {
  'squat.too_shallow': msg('שלח את הישבן אחורה ולמטה כאילו אתה מתיישב על כיסא נמוך, החזה למעלה, ועצור רק כשהירכיים מקבילות לרצפה', 'Send the hips back and down as if sitting on a low chair, chest up, and stop only when the thighs are parallel'),
  'squat.too_deep': msg('דמיין כיסא בגובה הברכיים — גע בו בישבן וקום, בלי לשקוע מתחתיו', 'Imagine a knee-height chair — touch it with your hips and stand, without sinking below it'),
  'miniSquat.too_deep': msg('רד רק כמו שמתחילים להתיישב, רבע מהדרך, ועלה מיד', 'Go down only as if starting to sit, a quarter of the way, and come straight up'),
  'lunge.too_shallow': msg('צעד ארוך מספיק, והורד את הברך האחורית ישר למטה עד שהיא כמעט נוגעת ברצפה', 'Take a long enough step and lower the back knee straight down until it almost touches the floor'),
  'lunge.too_deep': msg('עצור כשהברך האחורית במרחק כף יד מהרצפה, והמשקל על העקב הקדמי', 'Stop with the back knee a hand above the floor, the weight on the front heel'),
  'wallSit.too_high': msg('החלק את הגב במורד הקיר עד שהירכיים מקבילות לרצפה, הברכיים מעל הקרסוליים', 'Slide your back down the wall until the thighs are parallel, knees over the ankles'),
  'hipHinge.squatting': msg('ברכיים רכות ונעולות במקום, ושלח את הישבן אחורה אל הקיר שמאחוריך — הגב ישר, החזה יורד מעצמו', 'Soft, fixed knees; push the hips back toward the wall behind you — back flat, the chest lowers by itself'),
  'pushUp.body_line': msg('לפני כל חזרה כווץ את הישבן ומשוך את הטבור פנימה, וחשוב על קרש אחד מהראש עד העקבים', 'Before each rep squeeze the glutes and pull the navel in — one board from head to heels'),
  'pushUp.too_shallow': msg('רד עד שהחזה במרחק אגרוף מהרצפה; אם זה קשה — שכיבות סמיכה על הברכיים בטווח מלא', 'Lower until your chest is a fist from the floor; if that is hard — knee push-ups through the full range'),
  'plank.body_line': msg('מרפקים מתחת לכתפיים, ישבן מכווץ, טבור פנימה — והסתכל על הרצפה בין כפות הידיים', 'Elbows under the shoulders, glutes squeezed, navel in — and look at the floor between your hands'),
  'gluteBridge.too_low': msg('דחוף דרך העקבים והעלה את האגן עד קו ישר, החזק שנייה למעלה עם ישבן מכווץ', 'Drive through the heels up to a straight line, hold a second at the top with the glutes squeezed'),
  'shoulderPress.partial': msg('דחוף עד שהמרפקים ישרים והידיים מעל האוזניים, הבטן מהודקת', 'Press until the elbows are straight and the hands above the ears, abs braced'),
  'lateralRaise.too_high': msg('עצור כשהידיים בגובה הכתפיים, כאילו אתה נוגע בקירות משני הצדדים', 'Stop with the hands at shoulder height, as if touching the walls on both sides'),
  'lateralRaise.bent_arms': msg('מרפק כמעט ישר ונעול לאורך כל התנועה — הרם עם המרפקים ולא עם כפות הידיים', 'A nearly straight elbow locked through the movement — lift with the elbows, not the hands'),
  'frontRaise.too_high': msg('עצור כשהידיים בגובה הכתפיים, מול העיניים', 'Stop with the hands at shoulder height, at eye level'),
  'rehabFrontRaise.too_high': msg('עלה לאט עד גובה הכתף ולא מעבר, ספור שתיים למעלה ושלוש למטה', 'Rise slowly to shoulder height and no more — two counts up, three down'),
  'bicepCurl.elbow_drift': msg('הצמד את המרפקים לצלעות כאילו אתה מחזיק עיתון מתחת לבית השחי', 'Pin the elbows to your ribs as if holding a newspaper under each armpit'),
  'singleLegSquat.too_shallow': msg('רד לאט, עם שליטה, עד שהברך בכ-90 מעלות — אחוז במשהו יציב אם צריך', 'Lower slowly, under control, to about 90° at the knee — hold something steady if needed'),
  'singleLegLunge.too_shallow': msg('הורד את האגן ישר למטה עד שהברך הקדמית קרובה ל-90 מעלות', 'Lower the hips straight down until the front knee is near 90°'),
};
export const EXPERT_PROFILES = Object.freeze(Object.fromEntries(
  Object.entries(RAW_EXPERT).map(([id, p]) => [id, Object.freeze({
    dynamics: [], ...p, tags: TAGS[id] || [],
    rules: (p.rules || []).map(r => (HOW[`${id}.${r.id}`] && !r.how ? { ...r, how: HOW[`${id}.${r.id}`] } : r)),
  })]),
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

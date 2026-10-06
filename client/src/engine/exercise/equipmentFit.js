// ============================================================
// equipmentFit — HARD match between the trainee's equipment and the exercises shown
//
// PURE. The owner's rule: an exercise that needs equipment the trainee does not have (e.g. a
// "ball stop against the wall" for a trainee who said "no ball") must NEVER be offered.
// Applied as the last line of defence wherever exercises reach the trainee (plan view,
// training screen, live plan adaptation), and mirrored on the server after plan generation.
//
//   requiredEquipment(exercise) → Set('ball' | 'dumbbells' | 'bands')
//   availableEquipment(profile, session) → { ball: true|false|null, dumbbells, bands }
//       ball null = not answered yet → the training screen asks before the workout
//   fitExercises(list, available) → { exercises, substitutions }
//       a missing item → the movement-pattern substitute WITHOUT that equipment (a shadow
//       kick instead of a kick, footwork instead of dribbling, a bodyweight squat instead of a
//       goblet squat…), keeping sets / reps / rest, and recording what was replaced and why.
// ============================================================

import { getAnalyzer } from '../../utils/exerciseAnalysis.js';

// Analyzer cueKeys whose drill is done WITH a ball
const BALL_CUES = new Set([
  'kick', 'amputeeKick', 'pass', 'firstTouch', 'juggle', 'dribbling', 'shooting', 'handDribble', 'layup',
  'crossover', 'spinMove', 'postMoves', 'hookShot', 'bouncePass', 'chestPass', 'overheadPass', 'headers',
  'chestControl', 'shieldBall', 'crutchPass', 'crutchDribble', 'crutchShield', 'crutchHeader', 'crutchChestControl',
  'gkDistribution', 'gkReaction', 'wheelchairShooting', 'wheelchairDribble', 'wheelchairPass', 'wcBouncePass',
  'serve', 'volley', 'stroke', 'smash', 'wheelchairServe', 'wheelchairStroke', 'wcSmash',
]);
// Words that name a ball in the exercise itself (any cueKey)
const BALL_WORDS = ['כדור', ' ball', 'ball ', 'כדורגל', 'כדורסל'];
// The exercise explicitly says it is done without a ball (a shadow / air drill)
const NO_BALL_WORDS = ['ללא כדור', 'בלי כדור', 'without ball', 'without a ball', 'no ball', 'צל', 'shadow', 'באוויר', 'air '];
// Not a ball even though the word looks like one
const FALSE_BALL = ['כדור הארץ', 'כדורית', 'balls of the feet', 'balls of feet', 'ball of the foot', 'ball of foot', 'כרית כף הרגל'];

const DUMBBELL_WORDS = ['משקולת', 'משקולות', 'dumbbell', 'גובלט', 'goblet', 'kettlebell', 'קטלבל', 'מוט', 'barbell'];
const BAND_WORDS = ['גומייה', 'גומיה', 'גומי התנגדות', 'רצועת התנגדות', 'resistance band', ' band', 'band '];

const textOf = (ex) => ` ${[ex?.name, ex?.nameEn, ex?.description].filter(Boolean).join(' ')} `.toLowerCase();
const has = (text, words) => words.some(w => text.includes(w));

/** Equipment an exercise needs. */
export function requiredEquipment(ex) {
  const need = new Set();
  if (!ex) return need;
  // Catalog exercises are equipment-free by construction (shadow / bodyweight patterns)
  if (ex.catalogId) return need;
  const nameText = ` ${[ex.name, ex.nameEn].filter(Boolean).join(' ')} `.toLowerCase();
  const text = textOf(ex);
  const cleaned = FALSE_BALL.reduce((t, w) => t.split(w).join(' '), text);
  const noBall = has(nameText, NO_BALL_WORDS);
  if (!noBall) {
    const cue = getAnalyzer(ex.name || ex.nameEn || '').cueKey;
    if (BALL_CUES.has(cue) || has(FALSE_BALL.reduce((t, w) => t.split(w).join(' '), nameText), BALL_WORDS)) need.add('ball');
    else if (has(cleaned, [' עם כדור', ' with a ball', ' with ball'])) need.add('ball');
  }
  if (has(text, DUMBBELL_WORDS) && !has(nameText, ['ללא משקולות', 'בלי משקולות', 'without weights', 'משקל גוף', 'bodyweight'])) need.add('dumbbells');
  if (has(text, BAND_WORDS)) need.add('bands');
  return need;
}

/**
 * What the trainee has. Ball: the session answer wins over the profile; null = unknown.
 * Dumbbells / bands: the profile equipment choice (a gym has both).
 */
export function availableEquipment(profile, session = {}) {
  const p = profile || {};
  const gym = p.location === 'gym' || session.location === 'gym';
  const eq = session.equipment || p.equipment || 'none';
  const ball = typeof session.hasBall === 'boolean' ? session.hasBall : (typeof p.hasBall === 'boolean' ? p.hasBall : null);
  return { ball, dumbbells: gym || eq === 'dumbbells', bands: gym || eq === 'resistance_bands' };
}

const sub = (he, en, descHe, descEn) => ({ name: he, nameEn: en, description: descHe, descriptionEn: descEn });

// Ball drills → the same movement pattern without a ball. The Hebrew NAME never contains the word
// 'כדור' (the analyzer map treats any name with it as dribbling) — the descriptions say "no ball".
function ballSubstitute(cue) {
  switch (cue) {
    case 'kick': case 'pass': case 'firstTouch':
      return sub('בעיטה בצל — תנועת בעיטה באוויר', 'Shadow kick — kicking motion without a ball',
        'תנועת בעיטה מלאה באוויר: רגל תמיכה יציבה, תנופה מהירך, מעקב רגל. בלי כדור.',
        'Full kicking motion in the air: stable support leg, swing from the hip, follow-through. No ball.');
    case 'amputeeKick': case 'crutchPass':
      return sub('בעיטה בקביים — תנועת צל באוויר', 'Crutch kick — no ball (shadow motion)',
        'על הקביים, משקל מעליהן, תנופת רגל מהירך באוויר — בלי כדור.',
        'On the crutches with your weight over them, swing the leg from the hip in the air — no ball.');
    case 'crutchDribble': case 'crutchShield': case 'crutchChestControl': case 'crutchHeader':
      return sub('זריזות בקביים — צעדים מהירים', 'Crutch agility — no ball',
        'צעדים קצרים ומהירים על הקביים לכל הכיוונים, גו יציב.',
        'Short, quick crutch steps in every direction with a stable trunk.');
    case 'headers':
      return sub('קפיצות טאק — תזמון נגיחה', 'Tuck jumps — heading timing without a ball',
        'קפיצה אנכית עם הרמת ברכיים ונחיתה רכה, כמו עלייה לנגיחה.',
        'Vertical jump with a knee tuck and a soft landing, like rising for a header.');
    case 'shooting': case 'hookShot': case 'layup':
      return sub('תנועת זריקה בצל', 'Shooting motion without a ball (shadow)',
        'תנועת זריקה מלאה: מרפק מתחת לכף היד, הארכה ומעקב — בלי כדור.',
        'Full shooting motion: elbow under the hand, extension and follow-through — no ball.');
    case 'wheelchairShooting':
      return sub('זריקה כיסא גלגלים — בצל', 'Wheelchair shooting — no ball (shadow)',
        'תנועת זריקה מלאה מהכיסא, גו יציב — בלי כדור.', 'Full shooting motion from the chair with a stable trunk — no ball.');
    case 'bouncePass': case 'chestPass': case 'overheadPass':
      return sub('תנועת מסירת חזה בצל', 'Chest-pass motion without a ball',
        'צעד קדימה, הושטת שתי הידיים קדימה והצלפת כפות — בלי כדור.', 'Step forward, push both arms out and snap the wrists — no ball.');
    case 'wheelchairPass': case 'wcBouncePass':
      return sub('מסירה כיסא גלגלים — בצל', 'Wheelchair pass — no ball (shadow)',
        'תנועת מסירה מהכיסא, שתי ידיים קדימה — בלי כדור.', 'Passing motion from the chair, both arms forward — no ball.');
    case 'handDribble': case 'crossover': case 'spinMove': case 'postMoves':
      return sub('החלקת הגנה — עבודת רגליים', 'Defensive slide — footwork without a ball',
        'עמידה נמוכה, צעדי החלקה לצדדים בלי להצליב רגליים.', 'Low stance, side slides without crossing the feet.');
    case 'wheelchairDribble':
      return sub('ספרינט כיסא — דחיפות קצרות', 'Wheelchair sprint — short pushes without a ball',
        'דחיפות קצרות וחזקות של הגלגלים, גו יציב.', 'Short, strong wheel pushes with a stable trunk.');
    case 'serve': case 'wheelchairServe':
      return sub('הגשה בצל — תנועת הגשה באוויר', 'Shadow serve — serving motion without a ball',
        'תנוחת גביע, הארכה מלאה למעלה ומעקב — בלי כדור.', 'Trophy position, full extension up and follow-through — no ball.');
    case 'stroke': case 'volley': case 'smash': case 'wheelchairStroke': case 'wcSmash':
      return sub('פורהנד בצל — תנועת מכה באוויר', 'Shadow forehand — stroke motion without a ball',
        'סיבוב גו, תנופה ומעקב מלא — בלי כדור.', 'Trunk rotation, swing and full follow-through — no ball.');
    case 'gkDistribution': case 'gkReaction':
      return sub('מיקום שוער — עמדת מוכנות', 'Goalkeeper positioning — ready stance',
        'עמידה נמוכה ומוכנה, משקל על כריות כפות הרגליים, ידיים מוכנות.', 'Low ready stance, weight on the balls of the feet, hands ready.');
    default:
      return sub('עבודת רגליים במקום', 'Footwork in place — no ball',
        'צעדים קצרים ומהירים במקום ולצדדים, מבט קדימה.', 'Short, quick steps in place and to the sides, eyes forward.');
  }
}

// Weighted / banded exercises → the bodyweight version of the same movement pattern
function loadSubstitute(cue) {
  switch (cue) {
    case 'squat': return sub('סקוואט — משקל גוף', 'Squat — bodyweight', 'סקוואט מלא במשקל גוף, ירידה מבוקרת.', 'Full bodyweight squat, controlled descent.');
    case 'lunge': return sub("לאנג' — משקל גוף", 'Lunge — bodyweight', "לאנג' במשקל גוף, ברך קדמית ב-90 מעלות.", 'Bodyweight lunge, front knee at 90°.');
    case 'deadlift': return sub('גשר ישבן', 'Glute bridge', 'שכיבה על הגב, הרמת אגן עד קו ישר.', 'Lying on your back, lift the hips to a straight line.');
    case 'shoulder': case 'tricep': return sub('שכיבות סמיכה', 'Push-ups', 'שכיבות סמיכה בגוף ישר (אפשר על הברכיים).', 'Push-ups with a straight body (knees allowed).');
    case 'lateral': case 'shrug': return sub('הרמה צידית ללא משקל — שליטה איטית', 'Lateral raise without weights — slow control', 'הרמת ידיים לצדדים עד גובה הכתפיים, לאט.', 'Raise the arms sideways to shoulder height, slowly.');
    case 'frontRaise': return sub('הרמה קדמית ללא משקל — שליטה איטית', 'Front raise without weights — slow control', 'הרמת ידיים קדימה עד גובה הכתפיים, לאט.', 'Raise the arms forward to shoulder height, slowly.');
    case 'bicep': return sub('כיפוף מרפק אקטיבי', 'Active elbow flexion', 'כיפוף מרפק מלא לאט, מרפקים צמודים לגוף.', 'Full slow elbow flexion, elbows by your sides.');
    case 'row': case 'pullApart': case 'pull': return sub('סופרמן', 'Superman', 'שכיבה על הבטן והרמת ידיים ורגליים, החזקה קצרה.', 'Lying face down, lift arms and legs, short hold.');
    default: return sub('סקוואט — משקל גוף', 'Squat — bodyweight', 'סקוואט מלא במשקל גוף, ירידה מבוקרת.', 'Full bodyweight squat, controlled descent.');
  }
}

/**
 * Fit one exercise to the available equipment.
 * @returns {{ exercise: Object, substitution: null | { from, to, missing: string[] } }}
 */
export function fitExercise(ex, available) {
  const need = requiredEquipment(ex);
  const missing = [...need].filter(item => available?.[item] === false || (item !== 'ball' && !available?.[item]));
  if (!missing.length) return { exercise: ex, substitution: null };
  const cue = getAnalyzer(ex.name || ex.nameEn || '').cueKey;
  // A ball is replaced by its no-ball pattern; weights / bands by the bodyweight pattern
  let s = missing.includes('ball') ? ballSubstitute(cue) : loadSubstitute(cue);
  // A ball substitute that still needs missing load equipment → bodyweight substitute
  if ([...requiredEquipment(s)].some(i => missing.includes(i))) s = loadSubstitute(cue);
  const exercise = {
    ...ex, ...s,
    instructions: undefined, tips: ex.tips && !requiredEquipment({ name: ex.tips }).size ? ex.tips : '',
    substitutedFor: ex.name, substitutionReason: missing,
  };
  return { exercise, substitution: { from: ex.name, to: s.name, missing } };
}

/** Fit a list; keeps order and training parameters. */
export function fitExercises(list, available) {
  const substitutions = [];
  const exercises = (list || []).map((ex) => {
    const r = fitExercise(ex, available);
    if (r.substitution) substitutions.push(r.substitution);
    return r.exercise;
  });
  return { exercises, substitutions };
}

/** A whole plan with every day's exercises fitted (returns a new plan; the input is untouched). */
export function fitPlan(plan, available) {
  if (!plan?.weeks) return plan;
  return {
    ...plan,
    weeks: plan.weeks.map(w => ({
      ...w,
      days: (w?.days || []).map(d => (d?.exercises ? { ...d, exercises: fitExercises(d.exercises, available).exercises } : d)),
    })),
  };
}

/** True if any exercise of the list needs a ball (to ask "do you have a ball?" before the workout). */
export function needsBall(list) {
  return (list || []).some(ex => requiredEquipment(ex).has('ball'));
}

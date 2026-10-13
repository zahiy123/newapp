// Server-side equipment guard for generated plans (mirror of client/src/engine/exercise/equipmentFit.js).
// The owner's rule: never offer an exercise that needs equipment the trainee does not have — except a
// ball: without one, ball drills are kept and done with the app's virtual ball.
// The prompt states the constraint; this post-filter enforces it on every generated week. The
// client re-fits again at display / training time (the authoritative last line of defence).

const BALL_WORDS = ['כדור', 'ball', 'דריבל', 'dribbl', 'מסירה', 'מסירת', 'pass', 'קליעה', 'זריקה לסל', 'shoot',
  "ג'אגלינג", 'juggl', 'ליפטינג', 'נגיחה', 'נגיחות', 'header', 'שליטה ראשונית', 'first touch', 'לייאפ', 'layup', 'עליה לסל',
  'פורהנד', 'בקהנד', 'forehand', 'backhand', 'הגשה', 'serve', 'ווליי', 'volley', 'סמאש', 'smash', 'קרוסאובר', 'crossover'];
const KICK_WORDS = ['בעיטה לקיר', 'בעיטה לשער', 'בעיטה בכדור', 'בעיטות לקיר', 'kick the ball', 'shot on goal'];
const NO_BALL_WORDS = ['ללא כדור', 'בלי כדור', 'without ball', 'without a ball', 'no ball', 'צל', 'shadow', 'באוויר'];
// Not ball drills despite a look-alike word
const FALSE_BALL = ['כדור הארץ', 'balls of the feet', 'balls of feet', 'ball of the foot', 'ball of foot',
  'בעיטות פרפר', 'בעיטות ישבן', 'בעיטות חמור', 'flutter kick', 'butt kick', 'donkey kick'];

const lower = (s) => String(s || '').toLowerCase();

/** True if the exercise is done with a ball. */
export function needsBall(ex) {
  let name = lower(ex?.name);
  if (NO_BALL_WORDS.some(w => name.includes(w))) return false;
  for (const w of FALSE_BALL) name = name.split(w).join(' ');
  return BALL_WORDS.some(w => name.includes(w)) || KICK_WORDS.some(w => name.includes(w));
}


/**
 * NO REAL BALL (hasBall === false): every ball drill of a generated week is KEPT and marked
 * `virtualBall: true` — the app shows a virtual ball at the trainee's body and the drill is trained
 * fully at home (owner, 2026-10-13; this replaced the old rule that swapped them for shadow drills).
 */
export function fitWeekToEquipment(week, { hasBall } = {}) {
  if (hasBall !== false || !week?.days) return week;
  for (const day of week.days) {
    if (!Array.isArray(day?.exercises)) continue;
    day.exercises = day.exercises.map(ex => (needsBall(ex) ? { ...ex, virtualBall: true } : ex));
  }
  return week;
}

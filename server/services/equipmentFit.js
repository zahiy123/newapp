// Server-side equipment guard for generated plans (mirror of client/src/engine/exercise/equipmentFit.js).
// The owner's rule: never offer an exercise that needs equipment the trainee does not have.
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

const SUBS = [
  { test: /בעיט|kick|shot|מסיר|pass|שליטה|first touch/, name: 'בעיטה בצל — תנועת בעיטה באוויר', description: 'תנועת בעיטה מלאה באוויר: רגל תמיכה יציבה, תנופה מהירך, מעקב רגל. בלי כדור.' },
  { test: /זריק|קליע|shoot|layup|לייאפ|עליה לסל/, name: 'תנועת זריקה בצל', description: 'תנועת זריקה מלאה: מרפק מתחת לכף היד, הארכה ומעקב — בלי כדור.' },
  { test: /פורהנד|בקהנד|forehand|backhand|ווליי|volley|סמאש|smash/, name: 'פורהנד בצל — תנועת מכה באוויר', description: 'סיבוב גו, תנופה ומעקב מלא — בלי כדור.' },
  { test: /הגשה|serve/, name: 'הגשה בצל — תנועת הגשה באוויר', description: 'תנוחת גביע, הארכה מלאה למעלה ומעקב — בלי כדור.' },
  { test: /נגיח|header/, name: 'קפיצות טאק — תזמון נגיחה', description: 'קפיצה אנכית עם הרמת ברכיים ונחיתה רכה, כמו עלייה לנגיחה.' },
];
const DEFAULT_SUB = { name: 'עבודת רגליים במקום', description: 'צעדים קצרים ומהירים במקום ולצדדים, מבט קדימה — בלי כדור.' };

/** Replace every ball drill of a generated week when the trainee has NO ball (hasBall === false). */
export function fitWeekToEquipment(week, { hasBall } = {}) {
  if (hasBall !== false || !week?.days) return week;
  for (const day of week.days) {
    if (!Array.isArray(day?.exercises)) continue;
    day.exercises = day.exercises.map((ex) => {
      if (!needsBall(ex)) return ex;
      const n = lower(ex.name);
      const s = SUBS.find(x => x.test.test(n)) || DEFAULT_SUB;
      console.warn(`[Equipment Filter] no ball → "${ex.name}" replaced by "${s.name}"`);
      const { instructions, ...rest } = ex;
      return { ...rest, name: s.name, description: s.description, substitutedFor: ex.name, substitutionReason: ['ball'] };
    });
  }
  return week;
}

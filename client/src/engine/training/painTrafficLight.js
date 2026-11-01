// ============================================================
// painTrafficLight — the Pain Traffic Light (owner decision 2026-09-28, Stage 3 #15; built 2026-11-01)
//
// PURE. The trainee reports pain at any moment (a button on the screen, or by voice: "כואב לי").
// The DEVICE decides what happens (safety never waits for the AI); the AI only words the coach's line.
//   0–3  green  → continue, the coach keeps an eye on it
//   4–5  yellow → continue with a LOWER load (fewer reps, one set less, no range challenge)
//   6–10 red    → the exercise STOPS; the report goes into the injury log; next exercise or end the workout
// Every report (any colour) is saved with the workout and in the trainee's pain log.
// ============================================================

export const PAIN_GREEN_MAX = 3;
export const PAIN_YELLOW_MAX = 5;

/** 'green' | 'yellow' | 'red' for a 0–10 level (null for an invalid level). */
export function painLight(level) {
  const n = Number(level);
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  if (n <= PAIN_GREEN_MAX) return 'green';
  if (n <= PAIN_YELLOW_MAX) return 'yellow';
  return 'red';
}

/** What the workout does for this level: 'continue' | 'reduce' | 'stop'. */
export function painAction(level) {
  const l = painLight(level);
  return l === 'green' ? 'continue' : l === 'yellow' ? 'reduce' : l === 'red' ? 'stop' : null;
}

export const LOAD_REDUCTION = 0.6;   // yellow: the reps (or seconds) left = 60 % of the target
export const MIN_REPS = 3;

/**
 * The lower load for a yellow report: reps × 0.6 (at least 3, never above the target), one set less
 * (never below the set in progress). Returns { reps, sets } — unchanged numbers when nothing to lower.
 */
export function reducedLoad({ reps, sets, currentSet = 1 }) {
  const r = parseInt(reps, 10);
  const s = parseInt(sets, 10);
  const newReps = Number.isFinite(r) && r > 0 ? Math.min(r, Math.max(MIN_REPS, Math.round(r * LOAD_REDUCTION))) : reps;
  const newSets = Number.isFinite(s) && s > 0 ? Math.max(Math.min(s, currentSet), s - 1) : sets;
  return { reps: newReps, sets: newSets };
}

// Where it hurts — the trainee taps one (or says it). 'stump' only for an amputee.
export const PAIN_ZONES = [
  { id: 'knee', he: 'ברך', en: 'Knee', words: ['ברך', 'בברך', 'הברך', 'knee'] },
  { id: 'stump', he: 'גדם', en: 'Residual limb', words: ['גדם', 'בגדם', 'הגדם', 'stump', 'residual'], amputeeOnly: true },
  { id: 'back', he: 'גב', en: 'Back', words: ['גב', 'בגב', 'הגב', 'גב תחתון', 'back'] },
  { id: 'hip', he: 'ירך / אגן', en: 'Hip', words: ['ירך', 'בירך', 'אגן', 'באגן', 'מפשעה', 'hip', 'groin'] },
  { id: 'ankle', he: 'קרסול / כף רגל', en: 'Ankle / foot', words: ['קרסול', 'בקרסול', 'כף רגל', 'בכף הרגל', 'ankle', 'foot'] },
  { id: 'shoulder', he: 'כתף', en: 'Shoulder', words: ['כתף', 'בכתף', 'הכתף', 'shoulder'] },
  { id: 'arm', he: 'יד / מרפק / שורש כף יד', en: 'Arm / elbow / wrist', words: ['מרפק', 'במרפק', 'שורש', 'יד', 'ביד', 'elbow', 'wrist', 'arm'] },
  { id: 'other', he: 'מקום אחר', en: 'Somewhere else', words: [] },
];

export function zonesFor({ amputee = false } = {}) {
  return PAIN_ZONES.filter(z => !z.amputeeOnly || amputee);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[.,!?'"״׳]/g, ' ').replace(/\s+/g, ' ').trim();

// "כואב לי" / "יש לי כאב" / "it hurts" — the trainee's own words that open the traffic light
const PAIN_PHRASES = ['כואב לי', 'כואב', 'כאב', 'יש לי כאב', 'זה כואב', 'it hurts', 'hurts', 'pain', 'in pain'];
export const PAIN_ECHO_RE = /כואב|כאב|pain|hurt/i;   // the coach's own line with these words may echo back
export const PAIN_TAIL_WORDS = 8;

const NUMBER_WORDS = {
  'אפס': 0, 'אחת': 1, 'אחד': 1, 'שתיים': 2, 'שניים': 2, 'שתים': 2, 'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4,
  'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9, 'עשר': 10, 'עשרה': 10,
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** The pain level said in the text (a digit or a number word, 0–10), or null. The LAST number heard wins. */
export function spokenLevel(text) {
  const words = norm(text).split(' ');
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i].replace(/^ב/, '');      // "בשש" → "שש"
    if (/^\d{1,2}$/.test(words[i])) { const n = Number(words[i]); if (n >= 0 && n <= 10) return n; }
    if (NUMBER_WORDS[words[i]] != null) return NUMBER_WORDS[words[i]];
    if (NUMBER_WORDS[w] != null) return NUMBER_WORDS[w];
  }
  return null;
}

/** The zone id said in the text, or null. */
export function spokenZone(text, { amputee = false } = {}) {
  const n = ` ${norm(text)} `;
  for (const z of zonesFor({ amputee })) {
    if (z.words.some(w => n.includes(` ${w} `))) return z.id;
  }
  return null;
}

/** Does the trainee report pain? (a pain phrase among the last words heard) */
export function isPainReport(text) {
  const n = norm(text);
  if (!n) return false;
  const tail = ` ${n.split(' ').slice(-PAIN_TAIL_WORDS).join(' ')} `;
  return PAIN_PHRASES.some(p => tail.includes(` ${p} `));
}

/**
 * One report as saved in the workout and the pain log (pure — tested).
 * { level, light, action, zone, exercise, set, rep, phase, at }
 */
export function painEntry({ level, zone = null, exercise = null, set = null, rep = null, phase = null, at = Date.now() }) {
  return {
    level: Number(level), light: painLight(level), action: painAction(level),
    zone: zone || null, exercise: exercise || null, set: set ?? null, rep: rep ?? null, phase: phase || null, at,
  };
}

/**
 * The facts the AI words the coach's line from (the device already decided the action).
 * `what` is a plain description; the AI never adds a medical claim or a number.
 */
export function painFacts({ level, zone, exercise, isHe = true }) {
  const action = painAction(level);
  const z = PAIN_ZONES.find(x => x.id === zone);
  const where = z ? (isHe ? z.he : z.en) : (isHe ? 'לא צוין' : 'not given');
  const what = isHe
    ? `המתאמן דיווח על כאב ב${where}. ההחלטה: ${action === 'continue' ? 'ממשיכים כרגיל ושמים לב לכאב' : action === 'reduce' ? 'ממשיכים בעומס נמוך יותר — פחות חזרות וסט אחד פחות' : 'עוצרים את התרגיל עכשיו; הכאב נרשם ביומן'}`
    : `The trainee reported pain in: ${where}. The decision: ${action === 'continue' ? 'continue as usual and watch the pain' : action === 'reduce' ? 'continue with a lower load — fewer reps and one set less' : 'stop the exercise now; the pain is logged'}`;
  return { mode: 'pain', light: painLight(level), action, zone: zone || null, exercise: exercise || '', error: { what } };
}

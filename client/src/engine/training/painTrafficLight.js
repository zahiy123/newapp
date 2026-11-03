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

// SAFE MODE (owner, 2026-11-01): on a red report the trainee may choose to go on at a MINIMAL load instead
// of stopping — only this set, a few more reps (30 % of the target, at least 2), very slow and small, the coach
// close by, and a pain re-check at the set's end. Offered once per exercise: a second red there → only stop.
export const MICRO_LOAD = 0.3;
export const MICRO_MIN_REPS = 2;
/** The minimal load: { reps (the set's new target = done + the few left), sets (this set is the last) }. */
export function microLoad({ reps, currentSet = 1, done = 0 }) {
  const r = parseInt(reps, 10);
  if (!(Number.isFinite(r) && r > 0)) return { reps, sets: currentSet };
  const left = Math.max(MICRO_MIN_REPS, Math.round(r * MICRO_LOAD));
  return { reps: Math.min(r, Math.max(0, done) + left), sets: Math.max(1, currentSet) };
}
/** May the trainee choose safe mode now? (red, and not already in safe mode on this exercise) */
export function canSafeMode(level, { alreadySafe = false } = {}) {
  return painLight(level) === 'red' && !alreadySafe;
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

/** A zone's name for the screen. */
export function zoneName(id, isHe = true) {
  const z = PAIN_ZONES.find(x => x.id === id);
  return z ? (isHe ? z.he : z.en) : (isHe ? 'לא צוין' : 'not given');
}

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

/** The AI facts when the trainee chose safe mode (the device already set the minimal load). */
export function safeModeFacts({ zone, exercise, isHe = true }) {
  const z = PAIN_ZONES.find(x => x.id === zone);
  const where = z ? (isHe ? z.he : z.en) : (isHe ? 'לא צוין' : 'not given');
  const what = isHe
    ? `המתאמן דיווח על כאב חזק ב${where} ובחר להמשיך במצב בטוח: עומס מינימלי — רק עוד כמה חזרות בסט הזה, קצב איטי מאוד, טווח תנועה קטן ונוח; לעצור מיד אם הכאב עולה; בסוף הסט בודקים שוב את הכאב`
    : `The trainee reported strong pain in: ${where} and chose to go on in SAFE MODE: a minimal load — only a few more reps in this set, a very slow pace, a small comfortable range; stop at once if the pain rises; the pain is re-checked at the set's end`;
  return { mode: 'pain', light: 'red', action: 'safe', zone: zone || null, exercise: exercise || '', error: { what } };
}

// ---- Recurrence prevention (the approved spec): the pain log protects the next workouts ----
export const PAIN_MEMORY_DAYS = 14;

/**
 * The exercises a recent pain report protects: a RED report on an exercise in the last 14 days, or two
 * YELLOW reports on it → that exercise runs at the lower load next time. Returns Map(name → { level, zone }).
 */
export function painProtected(entries, { now = Date.now(), days = PAIN_MEMORY_DAYS } = {}) {
  const since = now - days * 864e5;
  const byEx = new Map();
  for (const e of entries || []) {
    const at = Number(e?.at) || 0;
    if (!e?.exercise || e.exercise === 'warm-up' || at < since) continue;
    const l = painLight(e.level);
    const cur = byEx.get(e.exercise) || { red: 0, yellow: 0, level: 0, zone: null, safeMode: false };
    if (e.choice === 'safe_mode') cur.safeMode = true;
    if (l === 'red') cur.red += 1;
    if (l === 'yellow') cur.yellow += 1;
    if (Number(e.level) > cur.level) { cur.level = Number(e.level); cur.zone = e.zone || null; }
    byEx.set(e.exercise, cur);
  }
  const out = new Map();
  for (const [name, c] of byEx) if (c.red > 0 || c.yellow >= 2) out.set(name, { level: c.level, zone: c.zone, ...(c.safeMode ? { safeMode: true } : {}) });
  return out;
}

/** Today's exercises with the protected ones at the lower load (pure — the list is copied, never mutated). */
export function protectFromPain(exercises, entries, opts) {
  const prot = painProtected(entries, opts);
  if (!prot.size) return exercises;
  return (exercises || []).map((ex) => {
    const p = prot.get(ex?.name);
    if (!p || ex.painProtected) return ex;
    const r = reducedLoad({ reps: ex.reps, sets: ex.sets, currentSet: 1 });
    return { ...ex, reps: typeof ex.reps === 'string' ? String(r.reps) : r.reps, sets: r.sets, painProtected: p };
  });
}

// ============================================================
// voiceCommands — "next exercise" by voice (owner, 2026-10-08)
//
// PURE. The move to the next exercise is MANUAL only: a tap, or the trainee EXPLICITLY saying
// "תרגיל הבא" / "next exercise". Field test: single words ("הבא", "ממשיכים", "עבור") were also
// heard in the coach's OWN speech (the phone's recognizer returns the text ~1 s after the audio,
// after the old 0.9 s echo guard) — the app skipped by itself. So:
//   • only the explicit phrase counts, in a FINAL result, as a short utterance;
//   • (2026-10-14) the microphone stays OPEN; a command is rejected only when the coach itself said
//     "הבא" / "next" in the last ECHO_WINDOW_MS — the precise guard against its own echo.
// ============================================================

const NEXT = ['תרגיל הבא', 'התרגיל הבא', 'לתרגיל הבא', 'next exercise'];

const norm = (s) => String(s || '').toLowerCase().replace(/[.,!?'"״׳]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Does this recognized text explicitly ask for the next exercise? The phrase must be among the LAST
 * words heard (owner field video, 2026-10-18: on a laptop the mic also hears the coach from the
 * speakers, so one result = the coach's words + the trainee's "תרגיל הבא" — a ≤ 5-words rule rejected it).
 */
export const COMMAND_TAIL_WORDS = 6;
export function isNextCommand(text) {
  const n = norm(text);
  if (!n) return false;
  const tail = n.split(' ').slice(-COMMAND_TAIL_WORDS).join(' ');
  return NEXT.some(p => ` ${tail} `.includes(` ${p} `));
}

export const MIC_REOPEN_MS = 1500;           // (legacy) the old mic re-open delay after the coach spoke
export const ECHO_WINDOW_MS = 5000;          // a coach line with "הבא" this recent may be echoing back

/** The command PHRASE that could come back as an echo of the coach's own line ("עוברים לתרגיל הבא").
 *  Only the phrase — "בסט הבא" / "החזרה הבאה" in the coach's words never block the trainee. */
export const COMMAND_ECHO_RE = /תרגיל הבא|next exercise/i;

/**
 * Accept a command (owner, 2026-10-14: "the voice command must work"): the mic stays OPEN through the
 * whole workout (it used to close on every coach line + 1.5 s — while the coach counted every rep it
 * was almost never open). A command is accepted when it is FINAL, and the coach did NOT say "הבא" /
 * "next" in the last ECHO_WINDOW_MS (its own words can never move the trainee); everything else the
 * coach says (counting, corrections) does not block the trainee's command.
 */
export function acceptCommand({ isFinal = true, coachSaidCommandWord = false }) {
  return isFinal && !coachSaidCommandWord;
}

// ============================================================
// TWO-WAY VOICE (Stage 3 #13, owner decision 2026-09-28; built 2026-11-03)
// Beyond "תרגיל הבא" and "כואב לי" (painTrafficLight): a break, stop, continue, one more, repeat — and a free
// QUESTION to the coach ("למה?", "איך עושים…?") that Claude answers live. Parsed locally; the coach's own
// words never count (the echo guard compares the heard text with the coach's recent lines).
// Short words ("עצור", "חזור", "הפסקה") count only as the WHOLE utterance (≤ 3 words) — inside a longer
// sentence they are everyday words ("חזור לעמידה" is the coach's own instruction).
// ============================================================

const WHOLE = (n) => n.split(' ').length <= 3;
const INTENTS = [
  { type: 'stop', phrases: ['עצור', 'תעצור', 'עצור את התרגיל', 'תעצור את התרגיל', 'stop', 'stop the exercise'], whole: true },
  { type: 'pause', phrases: ['הפסקה', 'אני צריך הפסקה', 'אני צריכה הפסקה', 'צריך הפסקה', 'רגע הפסקה', 'break', 'i need a break', 'pause'], whole: false },
  { type: 'resume', phrases: ['ממשיכים', 'נמשיך', 'המשך', 'תמשיך', 'אני מוכן', 'אני מוכנה', 'continue', 'resume', "let's go", 'lets go'], whole: true },
  { type: 'oneMore', phrases: ['עוד אחת', 'עוד אחד', 'עוד חזרה', 'עוד חזרה אחת', 'one more', 'one more rep'], whole: false },
  { type: 'repeat', phrases: ['חזור', 'תחזור', 'תחזור על זה', 'חזור על זה', 'מה אמרת', 'לא שמעתי', 'תגיד שוב', 'repeat', 'say again', 'say that again', 'what did you say'], whole: true },
];
const QUESTION_START = ['למה', 'איך', 'מה', 'כמה', 'איפה', 'מתי', 'האם', 'אפשר', 'מותר', 'why', 'how', 'what', 'when', 'where', 'should', 'can', 'is', 'do'];

/** The command in the text: { type: 'stop'|'pause'|'resume'|'oneMore'|'repeat'|'question', text } or null. */
export function parseVoiceCommand(text) {
  const n = norm(text);
  if (!n) return null;
  for (const it of INTENTS) {
    if (it.whole) {
      if (WHOLE(n) && it.phrases.some(p => n === p || n === `${p} בבקשה` || n.endsWith(` ${p}`) && WHOLE(n))) return { type: it.type, text: n };
    } else {
      const tail = ` ${n.split(' ').slice(-COMMAND_TAIL_WORDS).join(' ')} `;
      if (it.phrases.some(p => tail.includes(` ${p} `))) return { type: it.type, text: n };
    }
  }
  const words = n.split(' ');
  if (words.length >= 2 && words.length <= 25 && QUESTION_START.includes(words[0])) return { type: 'question', text: String(text).trim() };
  return null;
}

/** Is the heard text (mostly) the coach's own line coming back through the mic? (≥ 60 % of its words in one line) */
export function isEchoOf(text, coachLines) {
  const w = norm(text).split(' ').filter(x => x.length > 1);
  if (!w.length) return false;
  return (coachLines || []).some((line) => {
    const set = new Set(norm(line).split(' '));
    return w.filter(x => set.has(x)).length / w.length >= 0.6;
  });
}

/** Which commands make sense in which phase (anything else is ignored, never a surprise). */
export function commandAllowed(type, phase) {
  switch (type) {
    case 'stop': case 'pause': return ['warm_up', 'exercising', 'briefing', 'calibrating', 'checking_equipment'].includes(phase);
    case 'resume': return phase === 'paused';
    case 'oneMore': return phase === 'exercising';
    case 'repeat': case 'question': return phase !== 'environment_scan';
    default: return false;
  }
}

/**
 * THE TRAINEE'S OWN WORDS in one recognizer result (owner, 2026-11-03, on a LAPTOP: "I say it and it does not
 * hear / does not react"). The laptop's mic also hears the coach from the speakers, so ONE result = the coach's
 * words + the trainee's. The coach's part is cut off: everything up to the LAST pair of consecutive words that is
 * a consecutive pair of one of the coach's recent lines. Returns the trainee's part ('' = only the coach).
 */
export function stripCoachEcho(text, coachLines) {
  const words = norm(text).split(' ').filter(Boolean);
  if (!words.length) return '';
  const pairs = new Set();
  for (const line of coachLines || []) {
    const w = norm(line).split(' ').filter(Boolean);
    for (let i = 1; i < w.length; i++) pairs.add(`${w[i - 1]} ${w[i]}`);
  }
  let cut = -1;
  for (let i = words.length - 1; i >= 1; i--) {
    if (pairs.has(`${words[i - 1]} ${words[i]}`)) { cut = i; break; }
  }
  return words.slice(cut + 1).join(' ');
}

/** The command in the trainee's own words (after the coach's echo is cut): parse, and find a question inside. */
export function commandFromHeard(text, coachLines) {
  const own = stripCoachEcho(text, coachLines);
  if (!own) return null;
  const direct = parseVoiceCommand(own);
  if (direct) return direct;
  // a question may follow a few leftover (misheard) coach words: start at its question word
  const w = own.split(' ');
  const q = w.findIndex(x => QUESTION_START.includes(x));
  if (q > 0) return parseVoiceCommand(w.slice(q).join(' '));
  // a short command after a few leftover words: its last 3 words
  if (w.length > 3) return parseVoiceCommand(w.slice(-3).join(' ')) || parseVoiceCommand(w.slice(-2).join(' ')) || parseVoiceCommand(w.slice(-1).join(' '));
  return null;
}

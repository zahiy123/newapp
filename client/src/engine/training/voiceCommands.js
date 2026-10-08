// ============================================================
// voiceCommands — "next exercise" by voice (owner, 2026-10-08)
//
// PURE. The move to the next exercise is MANUAL only: a tap, or the trainee saying it. The
// recognizer's text is matched against short phrases (Hebrew + English). The coach's own voice
// must never trigger it: results heard while the coach speaks, or right after, are ignored.
// ============================================================

const NEXT = [
  'תרגיל הבא', 'התרגיל הבא', 'הבא', 'הלאה', 'ממשיכים', 'נמשיך', 'תעביר', 'עבור',
  'next exercise', 'next', 'go on', 'continue',
];

const norm = (s) => String(s || '').toLowerCase().replace(/[.,!?'"״׳]/g, ' ').replace(/\s+/g, ' ').trim();

/** Does this recognized text ask for the next exercise? */
export function isNextCommand(text) {
  const n = ` ${norm(text)} `;
  if (n.trim().length === 0 || n.trim().split(' ').length > 6) return false;   // a short command, not a sentence
  return NEXT.some(p => n.includes(` ${p} `));
}

export const ECHO_GUARD_MS = 900;            // ignore what is heard this soon after the coach spoke

/** Accept a command only when the coach is silent (no echo of its own voice). */
export function acceptCommand({ coachSpeaking, lastCoachSpeechAt, now }) {
  if (coachSpeaking) return false;
  return !(typeof lastCoachSpeechAt === 'number' && now - lastCoachSpeechAt < ECHO_GUARD_MS);
}

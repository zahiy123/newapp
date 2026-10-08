// ============================================================
// voiceCommands — "next exercise" by voice (owner, 2026-10-08)
//
// PURE. The move to the next exercise is MANUAL only: a tap, or the trainee EXPLICITLY saying
// "תרגיל הבא" / "next exercise". Field test: single words ("הבא", "ממשיכים", "עבור") were also
// heard in the coach's OWN speech (the phone's recognizer returns the text ~1 s after the audio,
// after the old 0.9 s echo guard) — the app skipped by itself. So:
//   • only the explicit phrase counts, in a FINAL result, as a short utterance;
//   • the microphone is OFF while the coach speaks and for MIC_REOPEN_MS after it (useVoiceCommand),
//     and nothing heard in a session that overlapped the coach's speech is accepted.
// ============================================================

const NEXT = ['תרגיל הבא', 'התרגיל הבא', 'לתרגיל הבא', 'next exercise'];

const norm = (s) => String(s || '').toLowerCase().replace(/[.,!?'"״׳]/g, ' ').replace(/\s+/g, ' ').trim();

/** Does this recognized text explicitly ask for the next exercise? */
export function isNextCommand(text) {
  const n = norm(text);
  if (!n || n.split(' ').length > 5) return false;          // a short command, not a sentence
  return NEXT.some(p => ` ${n} `.includes(` ${p} `));
}

export const MIC_REOPEN_MS = 1500;           // the mic re-opens this long after the coach stops speaking

/** Accept a command only from a listening session that never overlapped the coach's speech. */
export function acceptCommand({ coachSpeaking, sessionHeardCoach, isFinal = true }) {
  return !coachSpeaking && !sessionHeardCoach && isFinal;
}

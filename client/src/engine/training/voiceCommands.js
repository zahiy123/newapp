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

/** Does this recognized text explicitly ask for the next exercise? */
export function isNextCommand(text) {
  const n = norm(text);
  if (!n || n.split(' ').length > 5) return false;          // a short command, not a sentence
  return NEXT.some(p => ` ${n} `.includes(` ${p} `));
}

export const MIC_REOPEN_MS = 1500;           // (legacy) the old mic re-open delay after the coach spoke
export const ECHO_WINDOW_MS = 5000;          // a coach line with "הבא" this recent may be echoing back

/** The words of the command that could come back as an echo of the coach's own line. */
export const COMMAND_ECHO_RE = /הבא|next/i;

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

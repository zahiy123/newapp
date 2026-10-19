// The AI coach's words, from the server (server/services/liveCoach.js). Every call has a hard deadline:
// when the AI is late / unreachable the caller says the device's own measured line — never silence.
import { apiUrl, fetchWithTimeout } from './api';

export const CUE_DEADLINE_MS = 4000;       // a sideline cue must land right after the rep
export const DEBRIEF_DEADLINE_MS = 27000;  // the rest's analysis (Opus: ~8–12 s measured; the card says it is analysing)

async function post(path, body, timeoutMs) {
  try {
    const res = await fetchWithTimeout(apiUrl(path), { method: 'POST', body: JSON.stringify(body) }, timeoutMs);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;                            // timeout / offline → the device's own words
  }
}

/** One short live cue worded by the AI, or null. */
export async function aiCue(facts) {
  const j = await post('/api/coach/live-cue', facts, CUE_DEADLINE_MS);
  const cue = typeof j?.cue === 'string' ? j.cue.trim() : '';
  return cue && cue.length <= 90 ? cue : null;
}

/** The rest's analysis { speech, card: [{ kind, title, detail[] }] } by the AI, or null. */
export async function aiDebrief(facts) {
  const j = await post('/api/coach/set-debrief', facts, DEBRIEF_DEADLINE_MS);
  const d = j?.debrief;
  return d && typeof d.speech === 'string' && d.speech.length > 20 ? d : null;
}

export const BRIEFING_DEADLINE_MS = 9500;

/** A short coach line (positioning / start / ready / motivation) worded by the AI from the facts, or null. */
export async function aiLine(facts) {
  return aiCue(facts);
}

/** The exercise briefing worded by the AI for this exercise and trainee, or null. */
export async function aiBriefing(facts) {
  const j = await post('/api/coach/briefing', facts, BRIEFING_DEADLINE_MS);
  const b = typeof j?.briefing === 'string' ? j.briefing.trim() : '';
  return b.length > 40 ? b : null;
}

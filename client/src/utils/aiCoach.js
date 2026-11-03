// The AI coach's words, from the server (server/services/liveCoach.js). Every call has a hard deadline:
// when the AI is late / unreachable the caller says the device's own measured line — never silence.
import { apiUrl, fetchWithTimeout } from './api';

export const CUE_DEADLINE_MS = 4000;       // a sideline cue (Sonnet 5, thinking off ~1.0–1.3 s; hedged at 1.3 s; the server gives up at 2.5 s)
export const DEBRIEF_DEADLINE_MS = 30000;  // the rest's analysis (Opus: ~8–12 s measured; the card says it is analysing)

// The AI coach's health, shown on the screen (owner, 2026-10-20: the credit ran out and the coach silently fell
// back to fixed lines). 'ok' | 'credit' | 'auth' | 'rate' | 'overloaded' | 'error' | 'unreachable'
let aiStatus = 'ok';
let failsInRow = 0;
const listeners = new Set();
export const getAiStatus = () => aiStatus;
export function onAiStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setAiStatus(s) {
  if (s === aiStatus) return;
  aiStatus = s;
  if (s !== 'ok') console.error(`[AI] the AI coach is NOT available (${s}) — the device's own lines are used`);
  else console.info('[AI] the AI coach is available again');
  for (const fn of listeners) { try { fn(s); } catch { /* a listener's error never breaks the call */ } }
}

// The coach's style right now (Stage 3 #12): 'energetic' (the #74 coach) | 'balanced' | 'calm' — sent with every
// AI call (the server adds the tone line; energetic = the prompt unchanged)
let coachStyleNow = 'energetic';
export function setCoachStyleAI(style) { coachStyleNow = style || 'energetic'; }
// The coach notebook's last notes (Stage 3 #17): the last set's analysis may connect to them
let notebookNow = '';
export function setNotebookContext(text) { notebookNow = String(text || '').slice(0, 600); }

async function post(path, body, timeoutMs, { background = false } = {}) {
  try {
    const res = await fetchWithTimeout(apiUrl(path), { method: 'POST', body: JSON.stringify({ style: coachStyleNow, ...body }) }, timeoutMs);
    if (!res.ok) { if (++failsInRow >= 2) setAiStatus('unreachable'); return null; }
    const j = await res.json();
    // a SLOW background call (the briefing, prepared ahead) is not an outage: only a real failure shows the banner
    if (j?.aiError && background && (j.aiError === 'timeout' || j.aiError === 'overloaded')) { console.warn(`[AI] ${path}: ${j.aiError} (background — the written text is used)`); return j; }
    if (j?.aiError) setAiStatus(j.aiError);
    else { failsInRow = 0; const got = Object.values(j || {}).some(v => v); if (got || aiStatus === 'unreachable') setAiStatus('ok'); }
    return j;
  } catch {
    if (++failsInRow >= 2) setAiStatus('unreachable');      // timeout / offline → the device's own words, and SAY so
    return null;
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
  const j = await post('/api/coach/set-debrief', notebookNow ? { notebook: notebookNow, ...facts } : facts, DEBRIEF_DEADLINE_MS);
  const d = j?.debrief;
  return d && typeof d.speech === 'string' && d.speech.length > 20 ? d : null;
}

export const BRIEFING_DEADLINE_MS = 20000;   // prepared ahead in the background (the speech waits at most 4.5 s)
export const VISION_DEADLINE_MS = 6000;

/** The whole-body eyes: { findings:[{code,severity,confidence,cue,what,why,how}], good:[{text,confidence}], contact?, ankleLocked? } or null. */
export async function aiBodyVision(facts) {
  const j = await post('/api/coach/body-vision', facts, VISION_DEADLINE_MS + 1000);
  return j?.vision && typeof j.vision === 'object' ? j.vision : null;
}

/** The vision model's verdict on one pass frame { contact, ankleLocked, … each { value, confidence } }, or null. */
export async function aiPassVision(facts) {
  const j = await post('/api/coach/pass-vision', facts, VISION_DEADLINE_MS);
  return j?.vision && typeof j.vision === 'object' ? j.vision : null;
}

/** The smart stop's short explanation (18–30 words) worded live by the AI, or null. */
export async function aiStop(facts) {
  const j = await post('/api/coach/live-cue', { ...facts, mode: 'stop' }, 8500);
  const t = typeof j?.cue === 'string' ? j.cue.trim() : '';
  return t && t.length <= 240 ? t : null;
}

/** The coach's words on a pain report (the device already decided the action), or null. */
export async function aiPain(facts) {
  const j = await post('/api/coach/live-cue', { ...facts, mode: 'pain' }, 8500);
  const t = typeof j?.cue === 'string' ? j.cue.trim() : '';
  return t && t.length <= 240 ? t : null;
}

/** The coach's spoken answer to the trainee's question (two-way voice), or null. */
export async function aiAnswer(facts) {
  // (one retry: the trainee asked — a guarded-out first answer must not leave them without one)
  for (let i = 0; i < 2; i++) {
    const j = await post('/api/coach/live-cue', { ...facts, mode: 'answer' }, 9000);
    const t = typeof j?.cue === 'string' ? j.cue.trim() : '';
    if (t && t.length <= 240) return t;
  }
  return null;
}

/** The coach's opening line of a workout, worded live from the last notebook entry, or null. */
export async function aiOpening(facts) {
  const j = await post('/api/coach/live-cue', { ...facts, mode: 'opening' }, 8500);
  const t = typeof j?.cue === 'string' ? j.cue.trim() : '';
  return t && t.length <= 240 ? t : null;
}

/** The coach's notebook notes about the workout that just ended (Opus), or null. */
export async function aiNotebook(facts) {
  const j = await post('/api/coach/notebook', facts, 35000, { background: true });
  return j?.notebook && typeof j.notebook.summary === 'string' ? j.notebook : null;
}

/** A short coach line (positioning / start / ready / motivation) worded by the AI from the facts, or null. */
export async function aiLine(facts) {
  return aiCue(facts);
}

/** The exercise briefing worded by the AI for this exercise and trainee, or null. */
export async function aiBriefing(facts) {
  const j = await post('/api/coach/briefing', facts, BRIEFING_DEADLINE_MS, { background: true });
  const b = typeof j?.briefing === 'string' ? j.briefing.trim() : '';
  return b.length > 40 ? b : null;
}

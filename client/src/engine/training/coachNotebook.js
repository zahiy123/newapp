// ============================================================
// coachNotebook — the Coach Notebook, long-term memory (Stage 3 #17, owner decision 2026-09-28; built 2026-11-01)
//
// PURE. After every workout the AI coach (Opus) writes its own short notes → users/{uid}/coachNotebook/{workoutId}.
// The next workout opens with ONE personal line + question worded LIVE from the last notes (never a stored
// sentence); a pain noted last time gets a direct check of that area. The last set's analysis may refer to them.
// ============================================================

import { PAIN_ZONES } from './painTrafficLight.js';

const DAY = 864e5;

/** The facts the notebook is written from (the workout's own record). */
export function notebookFacts({ exercises = [], painReports = [], status = 'completed', durationSec = 0, readiness = 0, previous = null, profile = {}, lang = 'he' }) {
  return {
    lang, name: profile?.name || '', track: profile?.trainingTrack || '', sport: profile?.sport || '',
    exercises: exercises.slice(0, 12), painReports: painReports.slice(0, 8),
    status, minutes: Math.round((durationSec || 0) / 60), readiness: readiness || null,
    previousNotes: previous ? notesText(previous, { isHe: lang !== 'en' }) : '',
  };
}

/** The strongest pain of a workout's reports (or null). */
export function worstPain(painReports) {
  let w = null;
  for (const p of painReports || []) if (Number(p?.level) > (w ? w.level : -1)) w = { level: Number(p.level), zone: p.zone || null, exercise: p.exercise || null, choice: p.choice || p.action || null };
  return w && w.level >= 1 ? w : null;
}

/** A compact text of one notebook entry. */
export function notesText(entry, { isHe = true } = {}) {
  if (!entry) return '';
  return [entry.summary, entry.performance, entry.pain, entry.focusNext && `${isHe ? 'המיקוד הבא' : 'Next focus'}: ${entry.focusNext}`,
    entry.followUp && `${isHe ? 'לשאול' : 'Ask'}: ${entry.followUp}`].filter(Boolean).join(' · ').slice(0, 600);
}

/** Days since the entry (a whole number, at least 0), or null. */
export function daysSince(entry, now = Date.now()) {
  const at = Number(entry?.at) || (entry?.date?.toMillis ? entry.date.toMillis() : 0);
  return at ? Math.max(0, Math.floor((now - at) / DAY)) : null;
}

/** The facts of the opening line (the AI words it live). Null when there is nothing to open with. */
export function openingFacts(entry, { now = Date.now(), isHe = true } = {}) {
  const text = notesText(entry, { isHe });
  if (!text) return null;
  const d = daysSince(entry, now);
  const when = d == null ? '' : d === 0 ? (isHe ? 'היום, מוקדם יותר' : 'earlier today') : d === 1 ? (isHe ? 'אתמול' : 'yesterday') : (isHe ? `לפני ${d} ימים` : `${d} days ago`);
  const p = entry.worstPain;
  const z = p ? PAIN_ZONES.find(x => x.id === p.zone) : null;
  const painLine = p && p.level >= 4 ? (isHe ? `כאב ${p.level} ב${z ? z.he : 'מקום לא ידוע'}${p.exercise ? ` בתרגיל ${p.exercise}` : ''}` : `pain ${p.level} in the ${z ? z.en : 'body'}${p.exercise ? ` in ${p.exercise}` : ''}`) : '';
  const painArea = p && p.level >= 4 && z ? (isHe ? z.he.split(' /')[0] : z.en.split(' /')[0].toLowerCase()) : null;
  return { mode: 'opening', ...(painArea ? { painArea } : {}), error: { what: `${when ? `${when}: ` : ''}${text}${painLine ? ` · ${painLine}` : ''}` } };
}

/** Did the last workout end with a pain worth checking at the start (4+)? */
export function painToCheck(entry) {
  const p = entry?.worstPain;
  return p && p.level >= 4 ? p : null;
}

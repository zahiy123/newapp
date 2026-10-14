// ============================================================
// motivation — warm, human encouragement in a SMART DOSE (owner, 2026-10-14)
//
// PURE. "Yalla, let's do it" / "let's start" are welcome — like a real coach — but never a flood:
//   moments   only at natural moments: the exercise starts, a set starts, back after the rest
//   spacing   at most one line every MIN_GAP_MS (never every second)
//   variety   never one of the last NO_REPEAT lines again (rotated, never tiresome)
//   tone      a frustrated / tired trainee (the coach brain) gets a calm line, not hype
// Motivation is never praise of an execution (honesty rule) — it is the coach's energy and warmth.
// ============================================================

export const MIN_GAP_MS = 45000;
export const NO_REPEAT = 4;

const POOL = {
  start: {
    he: ['יאללה {name}, בוא נעשה את זה!', 'בוא נתחיל!', 'יאללה, מתחילים — נקי ומדויק.', '{name}, בוא נראה עבודה טובה!', 'קדימה, בוא נתחיל חזק.'],
    en: ["Come on {name}, let's do it!", "Let's start!", "Here we go — clean and precise.", "{name}, let's see good work!", "Come on, let's start strong."],
  },
  set: {
    he: ['יאללה, בוא נעשה את הסט הזה!', 'סט חדש — מתחילים.', '{name}, יאללה, עוד סט אחד טוב.', 'בוא נעשה אותו נקי.'],
    en: ["Come on, let's do this set!", 'A new set — here we go.', '{name}, one more good set.', "Let's make it clean."],
  },
  resume: {
    he: ['חזרנו — יאללה, ממשיכים.', '{name}, בוא נמשיך.', 'מנוחה נגמרה — בוא נעשה את זה.'],
    en: ["We're back — let's go on.", "{name}, let's continue.", "Rest is over — let's do it."],
  },
  calm: {
    he: ['בנחת, {name} — תנועה אחת נקייה בכל פעם.', 'לאט ובשליטה — בוא ננסה שוב.', 'נשימה, ומתחילים בשקט.'],
    en: ['Easy, {name} — one clean movement at a time.', "Slow and controlled — let's try again.", 'Breathe, and start calmly.'],
  },
};

/** A motivation record for the session. */
export function createMotivation() {
  return { lastAt: -Infinity, recent: [], k: 0 };
}

/**
 * The line for this moment — or null (too soon / nothing fits).
 * @param {{ now: number, moment: 'start'|'set'|'resume', name?: string, he?: boolean, strained?: boolean }} c
 *   strained = the coach brain reads frustration / fatigue → a calm line instead
 */
export function motivationLine(m, c) {
  if (!m || !c) return null;
  if (c.now - m.lastAt < MIN_GAP_MS) return null;
  const pool = (c.strained ? POOL.calm : POOL[c.moment]) || null;
  if (!pool) return null;
  const lines = c.he === false ? pool.en : pool.he;
  const fresh = lines.filter(l => !m.recent.includes(l));
  const options = fresh.length ? fresh : lines;
  const line = options[m.k++ % options.length];
  m.lastAt = c.now;
  m.recent = [...m.recent, line].slice(-NO_REPEAT);
  const name = (c.name || '').trim();
  return line.replace(/\{name\}/g, name).replace(/^,\s*/, '').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
}

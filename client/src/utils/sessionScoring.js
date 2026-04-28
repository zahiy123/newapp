const SESSION_SCORES_KEY = 'session_scores';

export function saveSessionAvg(score) {
  const scores = loadSessionScores();
  scores.push({ score, date: Date.now() });
  // Keep last 10 sessions
  if (scores.length > 10) scores.shift();
  try {
    localStorage.setItem(SESSION_SCORES_KEY, JSON.stringify(scores));
  } catch {}
}

export function loadSessionScores() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_SCORES_KEY) || '[]');
  } catch { return []; }
}

/**
 * Check if the last 3 sessions average > 8.5 → eligible for level up.
 * Returns { eligible: true, avg } or null.
 */
export function checkLevelUpEligibility() {
  const scores = loadSessionScores();
  if (scores.length < 3) return null;
  const last3 = scores.slice(-3);
  const avg = last3.reduce((s, e) => s + e.score, 0) / 3;
  if (avg > 8.5) return { eligible: true, avg: Math.round(avg * 10) / 10 };
  return null;
}

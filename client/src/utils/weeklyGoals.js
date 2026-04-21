const WEEKLY_KEY = 'weekly_goals';

/** Returns Sunday 00:00:00 timestamp of the current week */
export function getWeekStart() {
  const now = new Date();
  const day = now.getDay(); // 0=Sunday
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - day);
  sunday.setHours(0, 0, 0, 0);
  return sunday.getTime();
}

export function loadWeeklyProgress() {
  try {
    const raw = localStorage.getItem(WEEKLY_KEY);
    if (!raw) return { weekStart: getWeekStart(), sessions: 0 };
    const data = JSON.parse(raw);
    // Auto-reset if new week started
    if (data.weekStart !== getWeekStart()) {
      return { weekStart: getWeekStart(), sessions: 0 };
    }
    return data;
  } catch {
    return { weekStart: getWeekStart(), sessions: 0 };
  }
}

export function incrementWeeklySession() {
  const progress = loadWeeklyProgress();
  progress.sessions += 1;
  try {
    localStorage.setItem(WEEKLY_KEY, JSON.stringify(progress));
  } catch {}
  return progress;
}

/**
 * Returns a reminder message if it's Thursday and user is behind pace.
 * @param {number} target - weekly session target (e.g. 3)
 */
export function checkWeeklyReminder(target) {
  const today = new Date().getDay(); // 0=Sun, 4=Thu
  if (today !== 4) return null;
  const progress = loadWeeklyProgress();
  const remaining = target - progress.sessions;
  if (remaining <= 0) return null;
  return `נשארו ${remaining} אימונים להשלמת המטרה השבועית! בוא נדביק פער 💪`;
}

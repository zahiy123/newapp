// ============================================================
// progress — the workout report and the progress across workouts (Stage 4 #1, #2, #9, #10; built 2026-11-03)
//
// PURE. Reads the workout records (users/{uid}/workouts, dataVersion 2 carries every set's measured result).
//   workoutReport  — one workout: per exercise, the accuracy per set, the main problems, what was fixed, pain
//   exerciseTrends — per exercise across workouts: the accuracy line, every problem → fixed / still there
//   painHistory    — every pain report over time
// A problem counts as FIXED when it appeared in an earlier workout of that exercise and not in its last
// FIXED_AFTER workouts; it is RECURRING while it still appears in one of them.
// ============================================================

export const FIXED_AFTER = 3;

const atOf = (w) => Number(w?.at) || (w?.date?.toMillis ? w.date.toMillis() : (w?.date?.seconds ? w.date.seconds * 1000 : Number(w?.date) || 0));

/** One workout's report. */
export function workoutReport(w) {
  const exercises = (w?.exercises || []).map((e) => {
    const sets = e.sets || [];
    const problems = new Map();
    for (const s of sets) {
      for (const p of s.problems || []) {
        const k = p.key || p.what;
        const cur = problems.get(k) || { key: k, what: p.what, times: 0, sets: 0, critical: false };
        cur.times += Number(p.times) || 0; cur.sets += 1; cur.critical = cur.critical || !!p.critical;
        problems.set(k, cur);
      }
    }
    const fixed = [];
    for (const s of sets) for (const f of s.fixed || []) if (!fixed.some(x => (x.key || x.what) === (f.key || f.what))) fixed.push(f);
    const accs = sets.map(s => s.accuracy).filter(a => typeof a === 'number');
    const trend = accs.length >= 2 ? accs[accs.length - 1] - accs[0] : null;
    return {
      key: e.key || e.name, name: e.name, reps: e.repsActual ?? null, repsTarget: e.repsTarget ?? null,
      setsDone: e.setsCompleted ?? sets.length, setsTarget: e.setsTarget ?? null,
      accuracy: typeof e.accuracy === 'number' ? e.accuracy : (accs.length ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length) : null),
      setAccuracy: accs, trend,
      problems: [...problems.values()].sort((a, b) => (b.critical - a.critical) || (b.times - a.times)),
      fixed, safeMode: sets.some(s => s.safeMode), lighter: sets.some(s => s.lighter), upgradedFrom: e.upgradedFrom || null, easedFrom: e.easedFrom || null,
      pain: (w?.painReports || []).filter(p => p.exercise === e.name),
      measured: sets.length > 0,
    };
  });
  return {
    at: atOf(w), status: w?.status || null, minutes: Math.round((w?.totalDuration || 0) / 60),
    exercises, pain: w?.painReports || [], detailed: w?.dataVersion >= 2,
  };
}

/** Per exercise across workouts (oldest first in the series). */
export function exerciseTrends(workouts) {
  const sorted = [...(workouts || [])].filter(w => w?.dataVersion >= 2).sort((a, b) => atOf(a) - atOf(b));
  const byEx = new Map();
  for (const w of sorted) {
    const at = atOf(w);
    for (const e of w.exercises || []) {
      if (!(e.sets || []).length) continue;
      const key = e.key || e.name;
      const cur = byEx.get(key) || { key, name: e.name, series: [], sessions: [] };
      const accs = e.sets.map(s => s.accuracy).filter(a => typeof a === 'number');
      cur.series.push({ at, accuracy: typeof e.accuracy === 'number' ? e.accuracy : (accs.length ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length) : null) });
      const keys = new Map();
      for (const s of e.sets) for (const p of s.problems || []) keys.set(p.key || p.what, p.what);
      cur.sessions.push({ at, problems: keys });
      byEx.set(key, cur);
    }
  }
  const out = [];
  for (const ex of byEx.values()) {
    const all = new Map();
    ex.sessions.forEach((s, i) => { for (const [k, what] of s.problems) { const c = all.get(k) || { key: k, what, first: i, last: i, count: 0 }; c.last = i; c.count += 1; c.what = what; all.set(k, c); } });
    const n = ex.sessions.length;
    const problems = [...all.values()].map((p) => {
      const sinceLast = n - 1 - p.last;
      const status = sinceLast >= FIXED_AFTER ? 'fixed' : 'recurring';
      return { ...p, status, workoutsSinceLast: sinceLast };
    }).sort((a, b) => (a.status === b.status ? b.count - a.count : a.status === 'recurring' ? -1 : 1));
    const acc = ex.series.map(s => s.accuracy).filter(a => typeof a === 'number');
    out.push({
      key: ex.key, name: ex.name, workouts: n, series: ex.series, problems,
      firstAccuracy: acc.length ? acc[0] : null, lastAccuracy: acc.length ? acc[acc.length - 1] : null,
    });
  }
  return out.sort((a, b) => b.workouts - a.workouts);
}

/** Every pain report over time (newest first), with the workout's date. */
export function painHistory(workouts) {
  const out = [];
  for (const w of workouts || []) for (const p of w?.painReports || []) out.push({ ...p, at: Number(p.at) || atOf(w) });
  return out.sort((a, b) => b.at - a.at);
}

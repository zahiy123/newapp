// Exact rep counting for expert-profile exercises: the COUNT comes from the profile's rep
// detector (full rest → peak → rest cycles with real durations, in view, measured reliably —
// useExpertExecution.repCountRef); the exercise's own analyzer still runs for posture / form /
// visibility feedback, but its own rep count and "count" voice are replaced. When the source is
// not active (no expert profile / module off) the analyzer is returned unchanged.

export function makeProfileRepAnalyzer(base, sourceRef) {
  return (landmarks, prev = {}, ball) => {
    const st = base(landmarks, prev, ball);
    const src = sourceRef?.current;
    if (!src?.active || !src.countRef) return st;
    const count = src.countRef.current || 0;
    const before = prev.reps || 0;
    const counted = count > before;
    const own = st.feedback?.type === 'count' ? st.feedback : null;
    return {
      ...st,
      reps: count,
      lastRepTime: counted ? Date.now() : prev.lastRepTime,
      firstRepStarted: !!st.firstRepStarted || count > 0,
      feedback: counted
        ? { type: 'count', text: `${count}!`, count, coaching: own?.coaching || null }
        : (own ? null : st.feedback),
    };
  };
}

/**
 * Reps done BEFORE the analyzer started (the trainee began while the coach was still explaining —
 * kicks seen by the execution module) are carried into the analyzer's own count: the base runs
 * on its own reps, the trainee sees and hears the total.
 */
export function withRepOffset(base, offsetRef) {
  return (landmarks, prev = {}, ball) => {
    const off = offsetRef?.current || 0;
    if (!off) return base(landmarks, prev, ball);
    const st = base(landmarks, { ...prev, reps: Math.max(0, (prev.reps || 0) - off) }, ball);
    const reps = (st.reps || 0) + off;
    const fb = st.feedback?.type === 'count' ? { ...st.feedback, count: reps, text: `${reps}!` } : st.feedback;
    return { ...st, reps, feedback: fb };
  };
}

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

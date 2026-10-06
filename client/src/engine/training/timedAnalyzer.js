// Timed catalog exercises (intervals "6×10 s", holds "3×30 s"): the set's "reps" are SECONDS of
// work. Wraps the exercise's analyzer (posture / visibility / form feedback stay) and counts work
// time only between analyzed frames — when the positioning gate pauses the analysis (trainee out
// of position), no frames arrive and the clock stops. With `isWorking` (useExpertExecution.workingRef),
// it also stops while the trainee is in view but not working (standing / sitting idle).
// Emits a 'count' every new second.

const MAX_FRAME_GAP_MS = 250;   // a longer gap = the analysis was paused → not counted

export function makeTimedAnalyzer(base, isWorking = null) {
  return (landmarks, prev = {}, ball) => {
    const st = base ? base(landmarks, prev, ball) : { ...prev };
    const now = Date.now();
    const gap = typeof prev._timedLast === 'number' ? now - prev._timedLast : 0;
    const working = !isWorking || isWorking();
    const workMs = (prev._timedMs || 0) + (working && gap > 0 && gap <= MAX_FRAME_GAP_MS ? gap : 0);
    const before = prev.reps || 0;
    const reps = Math.floor(workMs / 1000);
    const counted = reps > before;
    return {
      ...st,
      reps: Math.max(before, reps),
      _timedMs: workMs,
      _timedLast: now,
      lastRepTime: counted ? now : prev.lastRepTime,
      firstRepStarted: true,
      feedback: counted ? { type: 'count', text: `${reps}`, count: reps } : (st.feedback?.type === 'visibility' ? st.feedback : null),
    };
  };
}

// ============================================================
// incomingBall — a ball that comes TO the trainee in kick / pass drills (owner, 2026-10-12)
//
// PURE timing + geometry. Even without a real ball at home, a ball rolls in from the distance toward
// the trainee's kicking foot on the screen and arrives on the beat: that moment is the cue to strike
// ("בעט!" / "מסור!" + a short beep). Then the next ball comes.
//
//   approach  the ball is passed to the trainee from the front: it enters near the camera (big, at
//             the bottom of the picture) and rolls to just in front of the kicking foot
//   strike    a short window around the arrival: the cue, a ring at the foot
//   gone      the ball is played away; a short pause before the next one
// ============================================================

export const BALL_TIMING = Object.freeze({
  pass: { cycleMs: 3400, approachMs: 2300, strikeMs: 450 },
  kick: { cycleMs: 3000, approachMs: 2000, strikeMs: 400 },
});

/**
 * Where we are in the cycle.
 * @param {number} ms - time since the drill started
 * @param {'kick'|'pass'} kind
 * @returns {{ phase: 'approach'|'strike'|'gone', u: number, n: number, sinceArrival: number }}
 *   u = approach progress 0..1, n = the ball's number (0, 1, …)
 */
export function ballCycle(ms, kind = 'kick') {
  const T = BALL_TIMING[kind] || BALL_TIMING.kick;
  const t = Math.max(0, ms);
  const n = Math.floor(t / T.cycleMs);
  const tc = t - n * T.cycleMs;
  if (tc < T.approachMs) return { phase: 'approach', u: tc / T.approachMs, n, sinceArrival: tc - T.approachMs };
  const since = tc - T.approachMs;
  return { phase: since <= T.strikeMs ? 'strike' : 'gone', u: 1, n, sinceArrival: since };
}

/**
 * The ball on the screen. It is passed TO the trainee from the front (the camera's side): it starts
 * big near the camera (the bottom of the picture, across from the kicking foot), rolls on the floor
 * to just in front of the kicking foot, getting smaller with the distance and slowing down.
 * @param {{x,y}} foot - the kicking foot on the floor (view px)
 * @param {{x,y}} start - where the ball enters (view px, near the camera)
 * @param {number} bodyPx - the trainee's height in px (sizes the ball)
 * @returns {{ x, y, r, alpha, shadowY } | null}
 */
export function ballOnScreen(cycle, foot, start, bodyPx) {
  if (!foot || !start || !(bodyPx > 0)) return null;
  const rFoot = bodyPx * 0.07;                 // a size-5 ball next to the body
  const rStart = rFoot * 2.2;                  // closer to the camera → bigger
  if (cycle.phase === 'approach') {
    const e = 1 - (1 - cycle.u) ** 1.6;        // a rolling ball slows down as it arrives
    const r = rStart + (rFoot - rStart) * e;
    const x = start.x + (foot.x - start.x) * e;
    const groundY = start.y + (foot.y - start.y) * e;
    return { x, y: groundY - r, r, alpha: Math.min(1, cycle.u * 5), shadowY: groundY };
  }
  if (cycle.phase === 'strike') return { x: foot.x, y: foot.y - rFoot, r: rFoot, alpha: 1, shadowY: foot.y };
  return null;
}

/** The kicking side for this set: a split kick set names it; else the working (non-prosthetic) leg. */
export function kickingSide(lp = {}, splitSide = null) {
  if (splitSide === 'left' || splitSide === 'right') return splitSide;
  const affected = ['left', 'right'].filter(s => ['prosthetic', 'absent'].includes(lp?.[`${s}_leg`]?.state));
  if (affected.length === 1) return affected[0] === 'left' ? 'right' : 'left';
  return 'right';
}

// ============================================================
// incomingBall — a ball passed TO the trainee in kick / pass drills (owner, 2026-10-12)
//
// PURE timing + geometry + hit detection. The ball flows continuously to the trainee's kicking foot
// (wherever it is now) and arrives on the beat; the trainee kicks it in real time:
//   approach  the ball enters near the camera (big, the bottom of the picture) and rolls to the foot
//   window    around the arrival: "בעט!" / "מסור!" — a fast move of the kicking foot here = a HIT
//   hit       the ball flies away (a kick lifts it, a pass keeps it low), growing and fading — "יפה!"
//   miss      no kick in the window: the ball rolls on past the foot and fades — "פספסת"
// It never stops and floats in place.
// ============================================================

export const BALL_TIMING = Object.freeze({
  pass: { cycleMs: 3600, approachMs: 2300, windowBeforeMs: 350, windowAfterMs: 450, outMs: 650 },
  kick: { cycleMs: 3200, approachMs: 2000, windowBeforeMs: 300, windowAfterMs: 400, outMs: 650 },
});

/** A kicking foot that moves at least this many body heights per second is a strike. */
export const HIT_SPEED = 1.0;

/**
 * Where we are in the cycle.
 * @returns {{ phase: 'approach'|'after'|'gone', u: number, n: number, sinceArrival: number, inWindow: boolean }}
 *   u = approach progress 0..1, n = the ball's number, sinceArrival < 0 while approaching
 */
export function ballCycle(ms, kind = 'kick') {
  const T = BALL_TIMING[kind] || BALL_TIMING.kick;
  const t = Math.max(0, ms);
  const n = Math.floor(t / T.cycleMs);
  const tc = t - n * T.cycleMs;
  const since = tc - T.approachMs;
  const inWindow = since >= -T.windowBeforeMs && since <= T.windowAfterMs;
  if (tc < T.approachMs) return { phase: 'approach', u: tc / T.approachMs, n, sinceArrival: since, inWindow };
  return { phase: since <= T.windowAfterMs + T.outMs ? 'after' : 'gone', u: 1, n, sinceArrival: since, inWindow };
}

/** Is the window for this ball over (a miss if there was no hit)? */
export function windowOver(cycle, kind = 'kick') {
  const T = BALL_TIMING[kind] || BALL_TIMING.kick;
  return cycle.sinceArrival > T.windowAfterMs;
}

/**
 * The ball on the screen.
 * @param {{x,y}} foot - the kicking foot on the floor now (view px)
 * @param {{x,y}} start - where the ball enters (view px, near the camera)
 * @param {number} bodyPx - the trainee's height in px (sizes the ball)
 * @param {'hit'|'miss'|null} outcome - this ball's result so far
 * @param {number} [hitAt] - sinceArrival (ms) when it was hit
 * @returns {{ x, y, r, alpha, shadowY } | null}
 */
export function ballOnScreen(cycle, foot, start, bodyPx, outcome = null, kind = 'kick', hitAt = 0) {
  if (!foot || !start || !(bodyPx > 0)) return null;
  const T = BALL_TIMING[kind] || BALL_TIMING.kick;
  const rFoot = bodyPx * 0.07;                 // a size-5 ball next to the body
  const rStart = rFoot * 2.2;                  // closer to the camera → bigger
  const dx = foot.x - start.x, dy = foot.y - start.y;
  // e = progress along the line camera → foot (1 = at the foot, > 1 = rolling on past it)
  const at = (e) => {
    const groundY = start.y + dy * e;
    const r = e <= 1 ? rStart + (rFoot - rStart) * e : rFoot * Math.max(0.5, 1 - 0.35 * (e - 1));
    return { x: start.x + dx * e, y: groundY - r, r, shadowY: groundY };
  };
  if (outcome === 'hit') {
    // kicked away from the foot: back toward the camera, lifted (kick) / low (pass), growing, fading
    const v = Math.min(1, Math.max(0, (cycle.sinceArrival - hitAt) / T.outMs));
    if (v >= 1) return null;
    const lift = kind === 'pass' ? 0 : Math.sin(Math.PI * Math.min(1, v * 1.1)) * bodyPx * 0.35;
    const groundY = foot.y - dy * v * 0.9;
    const r = rFoot * (1 + 1.4 * v);
    return { x: foot.x - dx * v * 0.9, y: groundY - r - lift, r, alpha: 1 - v * v, shadowY: groundY };
  }
  if (cycle.phase === 'approach') {
    const e = 1 - (1 - cycle.u) ** 1.6;      // rolling, slowing down as it arrives
    return { ...at(e), alpha: Math.min(1, cycle.u * 5) };
  }
  if (cycle.phase === 'gone') return null;
  // not kicked: it keeps rolling past the foot (never parked), fading once the window is over
  const since = cycle.sinceArrival;
  const e = 1 + 0.6 * (since / (T.windowAfterMs + T.outMs));
  const fade = since <= T.windowAfterMs ? 1 : 1 - (since - T.windowAfterMs) / T.outMs;
  return { ...at(e), alpha: Math.max(0, fade) };
}

/**
 * Did the kicking foot strike? Its speed (body heights per second) over the recent samples.
 * @param {Array<{t, x, y}>} samples - the kicking ankle's recent positions (normalized), oldest first
 * @param {number} bodyH - the trainee's height in normalized y (shoulder → ankle is enough)
 */
export function footStrikeSpeed(samples, bodyH) {
  if (!samples || samples.length < 2 || !(bodyH > 0)) return 0;
  const a = samples[0], b = samples[samples.length - 1];
  const dt = (b.t - a.t) / 1000;
  if (!(dt > 0.03)) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y) / bodyH / dt;
}

/** The kicking side for this set: a split kick set names it; else the working (non-prosthetic) leg. */
export function kickingSide(lp = {}, splitSide = null) {
  if (splitSide === 'left' || splitSide === 'right') return splitSide;
  const affected = ['left', 'right'].filter(s => ['prosthetic', 'absent'].includes(lp?.[`${s}_leg`]?.state));
  if (affected.length === 1) return affected[0] === 'left' ? 'right' : 'left';
  return 'right';
}

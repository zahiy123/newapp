// ============================================================
// landmarkFilter — steady, lag-free pose landmarks (One Euro filter, per coordinate)
//
// PURE. MediaPipe landmarks tremble a few pixels every frame even when the body is still, and a
// frame without a detection used to drop the skeleton (and everything that follows it) to null.
//   • One Euro filter (Casiez et al., CHI 2012): a low-pass whose cutoff RISES with the speed —
//     heavy smoothing when still (no trembling), almost none in fast moves (no lag, a kick stays
//     a kick). Time-based, so the same at any frame rate.
//   • Gap bridging: a missed detection keeps the last body for HOLD_MS (marked `held`), so the
//     skeleton / Ghost / counting do not flicker; a longer gap really is "no body".
//   • A sudden jump of the whole body (another person, a mis-detection) resets the filter instead
//     of dragging the skeleton slowly across the screen.
// ============================================================

const XY = { minCutoff: 1.0, beta: 9, dCutoff: 1.0 };   // normalized image coords
// the FEET (ankles, heels, toes) tremble most (small, far, often a prosthesis): smoother when still, as
// responsive in a kick (a higher beta) — field video 2026-10-19
const FEET = new Set([27, 28, 29, 30, 31, 32]);
const XY_FEET = { minCutoff: 0.6, beta: 14, dCutoff: 1.0 };
// a point seen with low confidence jumps the most: smoothed more while it stays doubtful
const LOW_VIS = 0.6;
// a ONE-frame jump of a single point (not the body) is a glitch: held one frame; a real move continues
export const SPIKE = 0.12;
const Z = { minCutoff: 0.5, beta: 4, dCutoff: 1.0 };    // depth is noisier → smoother
const VIS_ALPHA = 0.45;                                   // visibility: simple EMA
export const HOLD_MS = 280;                               // bridge a missed detection this long
const JUMP_RESET = 0.35;                                  // whole-body jump (normalized) → restart

const alphaOf = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

function oneEuro(state, x, dt, p) {
  if (!state) return { x, dx: 0 };
  const dx = (x - state.x) / dt;
  const edx = state.dx + alphaOf(p.dCutoff, dt) * (dx - state.dx);
  const cutoff = p.minCutoff + p.beta * Math.abs(edx);
  return { x: state.x + alphaOf(cutoff, dt) * (x - state.x), dx: edx };
}

export function createLandmarkFilter() {
  return { pts: null, last: null, lastAt: null, out: null };
}

const center = (lm) => {
  const ids = [11, 12, 23, 24].filter(i => lm?.[i]);
  if (!ids.length) return null;
  return { x: ids.reduce((a, i) => a + lm[i].x, 0) / ids.length, y: ids.reduce((a, i) => a + lm[i].y, 0) / ids.length };
};

/**
 * Filter one detection.
 * @param {Object} f - filter state (createLandmarkFilter)
 * @param {Array|null} lm - raw landmarks of this detection (null = no body found)
 * @param {number} now - ms
 * @returns {Array|null} filtered landmarks (a held copy during a short gap; null after it)
 */
export function filterLandmarks(f, lm, now) {
  if (!lm) {
    if (f.out && f.lastAt !== null && now - f.lastAt <= HOLD_MS) return f.out.held ? f.out : Object.assign(f.out.slice(), { held: true });
    f.pts = null; f.out = null;
    return null;
  }
  const dt = f.lastAt === null ? 1 / 30 : Math.min(0.2, Math.max(0.004, (now - f.lastAt) / 1000));
  // a jump of the whole body → start over (no slow slide across the screen)
  const c0 = center(f.last), c1 = center(lm);
  if (f.pts && c0 && c1 && Math.hypot(c1.x - c0.x, c1.y - c0.y) > JUMP_RESET) f.pts = null;
  const prev = f.pts || [];
  const pts = [];
  const out = lm.map((p, i) => {
    const s = prev[i];
    let par = FEET.has(i) ? XY_FEET : XY;
    if ((p.visibility ?? 1) < LOW_VIS) par = { ...par, minCutoff: par.minCutoff * 0.5 };
    // spike guard: this point alone jumped far in one frame → keep its last position once (if it is real,
    // the next frame confirms it and it moves on)
    let px = p.x, py = p.y;
    if (s && Math.hypot(p.x - s.x.x, p.y - s.y.x) > SPIKE && !s.spiked) { px = s.x.x; py = s.y.x; }
    const fx = oneEuro(s?.x, px, dt, par);
    const fy = oneEuro(s?.y, py, dt, par);
    const fz = oneEuro(s?.z, p.z ?? 0, dt, Z);
    const vis = s ? s.v + VIS_ALPHA * ((p.visibility ?? 1) - s.v) : (p.visibility ?? 1);
    pts[i] = { x: fx, y: fy, z: fz, v: vis, spiked: !!s && px !== p.x };
    return { ...p, x: fx.x, y: fy.x, z: fz.x, visibility: vis };
  });
  f.pts = pts; f.last = lm; f.lastAt = now; f.out = out;
  return out;
}

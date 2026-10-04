// ============================================================
// frameThrottle — feed the ScanSequencer at a fixed rate
//
// PURE LOGIC — no React, no DOM.
//
// The scan loop runs on requestAnimationFrame, which ticks at the
// screen refresh rate (60 / 120 / 144 Hz). ScanSequencer measures all
// of its time windows in frames at a fixed sampleRate (30 fps), so
// feeding it every rAF tick makes every window run 2-5× too fast.
// This throttle lets through exactly `fps` frames per second of real
// time, regardless of the refresh rate.
// ============================================================

/**
 * @param {number} fps - target frames per second (must match ScanSequencer sampleRate)
 * @returns {(nowMs: number) => boolean} call on every tick; true = feed this frame
 */
export function createFrameThrottle(fps) {
  const intervalMs = 1000 / fps;
  let nextDue = null;

  return function shouldFeed(nowMs) {
    if (nextDue === null) {
      nextDue = nowMs + intervalMs;
      return true;
    }
    if (nowMs < nextDue) return false;
    // Keep an exact average rate; if we fell far behind (tab hidden, slow device), resync
    nextDue = nowMs - nextDue > intervalMs ? nowMs + intervalMs : nextDue + intervalMs;
    return true;
  };
}

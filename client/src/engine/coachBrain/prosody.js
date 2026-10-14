// ============================================================
// prosody — Layer 4 of the coach brain: VOICE PROSODY / AUDIBLE EFFORT (owner, 2026-10-14)
//
// PURE. From the microphone's short frames (loudness, zero-crossings) the coach hears the trainee's
// physiological effort the way a real coach does: effort bursts (an exhale on the push, a grunt),
// heavy breathing (frequent bursts), and how loud they are over the room's own noise.
//   effort 0..1 — feeds the behavior layer (fatigue) and the coach's response.
// Only frames while the coach is SILENT are used (it never hears itself); nothing is recorded or
// sent — only these numbers exist, on the device.
// ============================================================

const FLOOR_UP_TAU_MS = 4000;        // the room's noise floor rises slowly…
const FLOOR_DOWN_TAU_MS = 300;       // …and follows quiet fast
const BURST_K = 2.6;                 // a burst = louder than the floor by this factor
const BURST_MIN_MS = 70, BURST_MAX_MS = 900;   // an effort sound / an exhale (longer = talking / music)
const WINDOW_MS = 10000;             // effort is judged on the last 10 s

/** A new prosody state. */
export function createProsody() {
  return { floor: null, burst: null, bursts: [], lastT: null };
}

/**
 * One audio frame.
 * @param {number} rms - the frame's loudness (0..1)
 * @param {number} t - ms
 * @param {boolean} coachSpeaking - the coach's own voice is playing → the frame is ignored
 */
export function prosodyFrame(p, rms, t, coachSpeaking = false) {
  if (!p || !Number.isFinite(rms)) return p;
  const dt = p.lastT == null ? 20 : Math.max(1, Math.min(200, t - p.lastT));
  p.lastT = t;
  if (coachSpeaking) { p.burst = null; return p; }
  if (p.floor == null) p.floor = Math.max(1e-4, rms);
  const loud = rms > p.floor * BURST_K && rms > 0.01;
  if (!loud) {
    const tau = rms < p.floor ? FLOOR_DOWN_TAU_MS : FLOOR_UP_TAU_MS;
    p.floor += (rms - p.floor) * (1 - Math.exp(-dt / tau));
    p.floor = Math.max(1e-4, p.floor);
  }
  if (loud) {
    if (!p.burst) p.burst = { start: t, peak: rms };
    else p.burst.peak = Math.max(p.burst.peak, rms);
  } else if (p.burst) {
    const dur = t - p.burst.start;
    if (dur >= BURST_MIN_MS && dur <= BURST_MAX_MS) p.bursts.push({ t, dur, level: p.burst.peak / p.floor });
    p.burst = null;
  }
  while (p.bursts.length && t - p.bursts[0].t > WINDOW_MS) p.bursts.shift();
  return p;
}

/**
 * The audible effort now, 0..1: how many effort sounds in the last 10 s (heavy breathing / grunts on
 * every rep) and how loud they are over the room.
 */
export function effortLevel(p, t) {
  const b = (p?.bursts || []).filter(x => t - x.t <= WINDOW_MS);
  if (!b.length) return 0;
  const rate = Math.min(1, b.length / 12);                          // 12 per 10 s = breathing hard on every move
  const lvl = Math.min(1, (b.reduce((s, x) => s + x.level, 0) / b.length - BURST_K) / 6);
  return Math.round(Math.max(0, 0.6 * rate + 0.4 * Math.max(0, lvl)) * 100) / 100;
}

/** RMS of a float time-domain frame (-1..1). */
export function frameRms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, buf.length));
}

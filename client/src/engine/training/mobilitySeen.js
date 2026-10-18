// ============================================================
// mobilitySeen — today's mobility as the CAMERA sees it (owner field video, 2026-10-18)
//
// PURE. A trainee whose profile says "crutches" may train on a prosthesis today. When the app assumed
// crutches it treated the amputated leg as absent (no prosthesis): crutch cues, a crutch start
// position that never matched — the exercise waited ~40 s for a start position. The camera decides:
// the AMPUTATED side's foot confidently seen ON THE FLOOR, level with the sound foot, while standing,
// for SEEN_MS in a row = standing on a prosthesis → today is a prosthesis day.
// ============================================================

export const SEEN_MS = 2000;
const CONF = 0.75;
const LEVEL = 0.05;            // both ankles at the same height (normalized) = both feet on the floor

const ANKLE = { left: 27, right: 28 }, KNEE = { left: 25, right: 26 }, HIP = { left: 23, right: 24 };
const ok = (p) => p && Math.min(p.visibility ?? 1, p.presence ?? 1) >= CONF && p.y >= 0 && p.y <= 1;

/** One frame: is the trainee standing on BOTH feet, the amputated side included? */
export function standingOnBothFeet(lm, affectedSide) {
  if (!lm || (affectedSide !== 'left' && affectedSide !== 'right')) return false;
  const other = affectedSide === 'left' ? 'right' : 'left';
  const a = lm[ANKLE[affectedSide]], b = lm[ANKLE[other]];
  if (!ok(a) || !ok(b) || Math.abs(a.y - b.y) > LEVEL) return false;
  // standing: the hips above the knees above the ankles on both sides
  return [affectedSide, other].every(s => ok(lm[HIP[s]]) && ok(lm[KNEE[s]]) && lm[HIP[s]].y < lm[KNEE[s]].y && lm[KNEE[s]].y < lm[ANKLE[s]].y);
}

/** A tracker: { since } — feed frames; `prosthesisSeen` turns true after SEEN_MS standing on both feet. */
export function createMobilitySeen() { return { since: null, seen: false }; }

export function mobilityFrame(ms, lm, affectedSide, now) {
  if (!ms || ms.seen) return ms;
  if (standingOnBothFeet(lm, affectedSide)) {
    if (ms.since == null) ms.since = now;
    if (now - ms.since >= SEEN_MS) ms.seen = true;
  } else ms.since = null;
  return ms;
}

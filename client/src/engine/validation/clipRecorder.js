// ============================================================
// clipRecorder — validation dataset recorder (Stage 3.1, owner-approved: "no guessing")
//
// PURE. While validation mode is on, the exercise is cut into CLIPS — one per rep (reps),
// one per strike (kicks), or a fixed window (holds, running) — each with the compact raw
// landmarks (13 points used by the profiles; NO video, NO image) and the system's verdict
// (the issues it raised). After the set, a person labels each clip "good / fault"; the
// labelled clips are the ground truth every threshold is tuned against (agreement.js).
// Clips recorded while the measurement was not trustworthy (limbs out of view / low
// confidence) are dropped — they would teach nothing.
// ============================================================

export const KEEP_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const WINDOW_MS = 5000;            // clip length for holds / running
const STRIKE_TAIL_MS = 500;        // follow-through kept after a strike
const MAX_FRAMES = 240;            // ~12 s at 20 Hz: a safety cap per clip
const r3 = (v) => Math.round((v ?? 0) * 1000) / 1000;

/** One frame → a compact string "x,y,z,v;x,y,z,v;…" over KEEP_POINTS (Firestore-safe, no nested arrays). */
export function encodeFrame(landmarks) {
  return KEEP_POINTS.map((i) => {
    const p = landmarks?.[i];
    return p ? `${r3(p.x)},${r3(p.y)},${r3(p.z)},${r3(p.visibility ?? 1)}` : '';
  }).join(';');
}

/** Inverse of encodeFrame → a 33-point landmark array (missing points have visibility 0). */
export function decodeFrame(str) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  String(str || '').split(';').forEach((part, k) => {
    if (!part) return;
    const [x, y, z, v] = part.split(',').map(Number);
    lm[KEEP_POINTS[k]] = { x, y, z, visibility: v };
  });
  return lm;
}

/**
 * @param {Object} profile - the execution profile in use (with sport contexts)
 * @param {{ maxClips?: number }} [opts]
 */
export function createClipRecorder(profile, { maxClips = 12 } = {}) {
  return {
    profile,
    maxClips,
    clips: [],
    cur: null,           // { t0, frames, issues:Set, events:[] }
    closeAt: null,       // strike: close after the follow-through
    seq: 0,
  };
}

function startClip(rec, t) {
  rec.cur = { t0: t, frames: [], issues: new Set(), events: [] };
  rec.closeAt = null;
}

function closeClip(rec, t, accuracy) {
  const c = rec.cur;
  rec.cur = null;
  rec.closeAt = null;
  if (!c || c.frames.length < 6) return;
  const p = rec.profile;
  rec.seq += 1;
  rec.clips.push({
    id: `${Date.now().toString(36)}-${rec.seq}`,
    index: rec.seq,
    profileId: p.id,
    sportContexts: p.sportContexts || [],
    kind: p.kind,
    durationMs: t - c.t0,
    frames: c.frames,
    verdict: { issues: [...c.issues], accuracy: accuracy ?? null, events: c.events },
  });
  if (rec.clips.length > rec.maxClips) rec.clips.shift();
}

/**
 * Feed one evaluated frame.
 * @param {Object} rec - recorder
 * @param {Object[]|null} landmarks - raw landmarks
 * @param {Object} result - updateExecution() result
 * @param {number} t - ms
 */
export function recordFrame(rec, landmarks, result, t) {
  const trusted = result?.inView && result?.quality?.confident !== false && landmarks;
  if (!trusted) { rec.cur = null; rec.closeAt = null; return; }      // untrustworthy stretch → no clip
  if (!rec.cur) startClip(rec, t);
  const c = rec.cur;
  c.frames.push({ t: t - c.t0, f: encodeFrame(landmarks) });
  for (const i of result.issues || []) c.issues.add(i.id);

  const kind = rec.profile.kind;
  for (const ev of result.events || []) {
    if (ev.type === 'window') continue;
    c.events.push(Object.fromEntries(Object.entries(ev).filter(([, v]) => typeof v !== 'object')));
    if (kind === 'reps' && ev.type === 'rep') { closeClip(rec, t, result.accuracy); startClip(rec, t); return; }
    if (kind === 'strike' && ev.type === 'strike' && rec.closeAt === null) rec.closeAt = t + STRIKE_TAIL_MS;
  }
  if (rec.closeAt !== null && t >= rec.closeAt) { closeClip(rec, t, result.accuracy); return; }
  if ((kind === 'hold' || kind === 'cyclic') && t - c.t0 >= WINDOW_MS) { closeClip(rec, t, result.accuracy); return; }
  if (c.frames.length >= MAX_FRAMES) closeClip(rec, t, result.accuracy);
}

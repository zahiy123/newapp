// ============================================================
// repEvidence — KINETIC MOTION COUNTING / ANTI-GHOST COUNTING (owner IRON RULES, 2026-10-14)
//
// PURE. No repetition is counted or shown unless the body REALLY performed one — judged as a full
// KINETIC movement in space over the frames, never by a static joint angle:
//   range       a joint (elbow / shoulder / hip / knee, either side), CONFIDENTLY seen inside the
//               picture, moved through ≥ MIN_RANGE_DEG …
//   out & back  … and came back toward where it started (half a movement is not a rep)
//   velocity    with a real peak angular speed ≥ MIN_PEAK_DEG_S (a drift / a tracking jump is not)
//   trajectory  its END POINT (the wrist / the elbow / the knee / the ankle) travelled a real path
//               in space ≥ MIN_PATH_TORSO torso lengths
//   flow        ONE continuous out-and-back: at most MAX_REVERSALS direction changes (shaking /
//               jitter flips direction all the time)
//   duration    ≥ MIN_REP_MS
// Used by EVERY counter: the exact expert counter (full profile range) AND the older analyzers.
// A still trainee, a person out of the picture or tracking noise never count. Timed exercises count
// seconds only while the body is really in the picture. All in the camera's real proportions.
// ============================================================

import { angleCosine, frameAspect } from '../../utils/motionEngine.js';

export const MIN_RANGE_DEG = 25;
export const MIN_REP_MS = 450;
export const MIN_PEAK_DEG_S = 45;
export const MIN_PATH_TORSO = 0.25;
export const MAX_REVERSALS = 3;
const MIN_SAMPLES = 4;
const WINDOW_MS = 8000;
const CONF = 0.65;
const RETURN_SHARE = 0.45;     // back within this share of the range = the rep returned
const STRIKE_RETURN_SHARE = 0.65;   // a kick / strike: judged at the contact, mid-swing
const REVERSAL_DEG = 6;        // a direction change counts only past this (hysteresis)

// [a, vertex, c] — c is the moving END POINT whose trajectory is followed
const JOINTS = [
  [11, 13, 15], [12, 14, 16],      // elbows   (the wrist moves)
  [23, 11, 13], [24, 12, 14],      // shoulders (the elbow moves)
  [11, 23, 25], [12, 24, 26],      // hips     (the knee moves)
  [23, 25, 27], [24, 26, 28],      // knees    (the ankle moves)
];

const seen = (p) => p && Math.min(p.visibility ?? 1, p.presence ?? 1) >= CONF && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

// Which joints may prove a rep: a kick / pass / leg drill only by the LEGS (a hand swing or a small
// shift in place never counts a kick — owner field video, 2026-10-18); an arm drill only by the arms
const GROUPS = { arms: [0, 1, 2, 3], legs: [4, 5, 6, 7], all: [0, 1, 2, 3, 4, 5, 6, 7] };
const LEG_CUES = new Set(['kick', 'amputeeKick', 'pass', 'crutchPass', 'firstTouch', 'dribbling', 'crutchDribble', 'shieldBall',
  'squat', 'miniSquat', 'lunge', 'highKnees', 'singleLegHighKnee', 'forwardKicks', 'running', 'amputeeSprint', 'jump', 'jumpSquat',
  'balanceHops', 'march', 'footwork', 'sideSteps', 'defensiveSlide', 'stepUp', 'bridge', 'deadlift', 'calfRaise', 'wallSit', 'juggle', 'headers']);
const ARM_CUES = new Set(['push', 'pushUp', 'bicep', 'tricep', 'shoulder', 'lateral', 'frontRaise', 'row', 'punches', 'armCircles',
  'chestPass', 'bouncePass', 'overheadPass', 'shooting', 'layup', 'hookShot', 'handDribble', 'crossover', 'stroke', 'serve', 'volley', 'smash',
  'wheelchairShooting', 'wheelchairPass', 'wheelchairDribble', 'wheelchairStroke', 'wheelchairServe', 'rehabElbowFlex', 'rehabFrontRaise', 'dip']);

/**
 * The joints that may prove a rep of this exercise: from its profile (a strike / leg joints → legs;
 * arm joints → arms) or its analyzer cue.
 */
export function evidenceGroupFor({ profile = null, cueKey = null } = {}) {
  if (profile?.kind === 'strike') return 'legs';
  const js = Object.keys(profile?.joints || {});
  if (js.length) {
    const legs = js.some(j => j === 'knee' || j === 'hip' || j === 'bodyLine'), arms = js.some(j => j === 'elbow' || j === 'shoulder');
    if (legs && !arms) return 'legs';
    if (arms && !legs) return 'arms';
  }
  if (LEG_CUES.has(cueKey)) return 'legs';
  if (ARM_CUES.has(cueKey)) return 'arms';
  return 'all';
}

/** A new evidence record for one exercise / set; `group` = the joints that may prove a rep. */
export function createRepEvidence(group = 'all') {
  return { frames: [], lastAt: null, joints: GROUPS[group] || GROUPS.all };
}

/** One frame: per joint — its angle and its end point (real proportions), when really seen; the torso. */
export function evidenceFrame(ev, lm, t) {
  if (!ev || !lm) return ev;
  const k = frameAspect();
  const a = [], e = [];
  for (const [x, y, z] of JOINTS) {
    const ok = seen(lm[x]) && seen(lm[y]) && seen(lm[z]);
    a.push(ok ? angleCosine(lm[x], lm[y], lm[z]) : null);
    e.push(ok ? { x: lm[z].x * k, y: lm[z].y } : null);
  }
  const sh = [lm[11], lm[12]].filter(seen), hp = [lm[23], lm[24]].filter(seen);
  const avg = (ps) => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length * k, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });
  const torso = sh.length && hp.length ? Math.hypot(avg(sh).x - avg(hp).x, avg(sh).y - avg(hp).y) : null;
  ev.frames.push({ t, a, e, torso });
  while (ev.frames.length && t - ev.frames[0].t > WINDOW_MS) ev.frames.shift();
  return ev;
}

/**
 * The kinetic analysis of one joint since the last counted rep.
 * @returns {{ range, back, peakVel, path, reversals } | null}
 */
export function jointKinetics(ev, j, returnShare = RETURN_SHARE) {
  const fr = ev.frames.filter(f => typeof f.a[j] === 'number');
  if (fr.length < MIN_SAMPLES) return null;
  const v = fr.map(f => f.a[j]);
  const range = Math.max(...v) - Math.min(...v);
  const back = Math.abs(v[v.length - 1] - v[0]) <= returnShare * range;
  let peakVel = 0, path = 0, reversals = 0, dir = 0, ext = v[0];
  for (let i = 1; i < fr.length; i++) {
    const dt = (fr[i].t - fr[i - 1].t) / 1000;
    if (dt > 0 && dt < 0.5) peakVel = Math.max(peakVel, Math.abs(v[i] - v[i - 1]) / dt);
    const p0 = fr[i - 1].e[j], p1 = fr[i].e[j];
    if (p0 && p1) path += Math.hypot(p1.x - p0.x, p1.y - p0.y);
    // the flow: direction changes of the angle past REVERSAL_DEG (a clean out-and-back = 1)
    if (dir === 0) {
      if (v[i] > ext + REVERSAL_DEG) { dir = 1; ext = v[i]; } else if (v[i] < ext - REVERSAL_DEG) { dir = -1; ext = v[i]; }
    } else if (dir === 1) {
      if (v[i] > ext) ext = v[i]; else if (v[i] < ext - REVERSAL_DEG) { reversals += 1; dir = -1; ext = v[i]; }
    } else if (v[i] < ext) ext = v[i]; else if (v[i] > ext + REVERSAL_DEG) { reversals += 1; dir = 1; ext = v[i]; }
  }
  const torsos = fr.map(f => f.torso).filter(Number.isFinite);
  const torso = torsos.length ? torsos.reduce((s, x) => s + x, 0) / torsos.length : null;
  return { range, back, peakVel, path: torso ? path / torso : 0, reversals };
}

/** Is this joint's movement a real, complete kinetic rep? */
export function kineticRep(k) {
  return !!k && k.range >= MIN_RANGE_DEG && k.back && k.peakVel >= MIN_PEAK_DEG_S
    && k.path >= MIN_PATH_TORSO && k.reversals <= MAX_REVERSALS;
}

/** The largest joint range that is a REAL kinetic rep since the last counted one (degrees; 0 = none). */
export function evidenceRange(ev, returnShare = RETURN_SHARE) {
  let best = 0;
  for (const j of ev.joints || GROUPS.all) {
    const k = jointKinetics(ev, j, returnShare);
    if (kineticRep(k)) best = Math.max(best, k.range);
  }
  return best;
}

/** Does the movement since the last counted rep prove a real rep (range + velocity + trajectory + flow)? */
export function evidenceOk(ev, t, { strike = false } = {}) {
  if (!ev) return false;
  const first = ev.frames[0]?.t ?? t;
  const since = ev.lastAt == null ? t - first : t - ev.lastAt;
  // a strike is judged at the contact, while the leg still swings through — a partial return is enough
  return since >= MIN_REP_MS && evidenceRange(ev, strike ? STRIKE_RETURN_SHARE : RETURN_SHARE) >= MIN_RANGE_DEG;
}

/** A rep was counted: the next one needs its OWN evidence. */
export function evidenceAccept(ev, t) {
  if (ev) { ev.lastAt = t; ev.frames = ev.frames.slice(-1); }
  return ev;
}

/** Is the body really in the picture (shoulders + hips confidently seen)? — timed exercises. */
export function bodyInPicture(lm) {
  return !!lm && seen(lm[11]) && seen(lm[12]) && (seen(lm[23]) || seen(lm[24]));
}

/**
 * Gate a rep analyzer: its count goes up ONLY with kinematic evidence; otherwise the rep (and its
 * "count" feedback) is dropped.
 * @param {(lm, prev, ball) => Object} base
 * @param {{ current: Object }} evRef - holds the evidence record (reset per set by the page)
 */
export function makeEvidenceGatedAnalyzer(base, evRef, now = () => Date.now(), group = 'all') {
  return (lm, prev = {}, ball) => {
    const t = now();
    if (!evRef.current) evRef.current = createRepEvidence(group);
    evidenceFrame(evRef.current, lm, t);
    const st = base(lm, prev, ball);
    const before = prev.reps || 0;
    if ((st.reps || 0) <= before) return st;
    if (evidenceOk(evRef.current, t)) { evidenceAccept(evRef.current, t); return st; }
    return { ...st, reps: before, lastRepTime: prev.lastRepTime, feedback: st.feedback?.type === 'count' ? null : st.feedback, ghostRepBlocked: true };
  };
}

/**
 * Gate a HOLD / timed analyzer: its seconds go up ONLY while the body is really in the picture
 * (a hold does not move — but nobody in the picture is not a hold).
 */
export function makePresenceGatedAnalyzer(base, getLandmarks = null) {
  return (lm, prev = {}, ball) => {
    const st = base(lm, prev, ball);
    const before = prev.reps || 0;
    if ((st.reps || 0) <= before) return st;
    const body = getLandmarks ? getLandmarks() : lm;
    if (bodyInPicture(body)) return st;
    return { ...st, reps: before, lastRepTime: prev.lastRepTime, feedback: st.feedback?.type === 'count' ? null : st.feedback, ghostRepBlocked: true };
  };
}

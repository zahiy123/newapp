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
  const hip = hp.length ? avg(hp) : null;                       // the pelvis (does the body travel?)
  // the shoulders' width in the picture: steady in a pass, it grows / shrinks when walking toward / away
  const shoulderW = seen(lm[11]) && seen(lm[12]) ? Math.abs(lm[11].x - lm[12].x) * k : null;
  ev.frames.push({ t, a, e, torso, hip, shoulderW });
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

/**
 * A KICK / PASS stands in place: the pelvis stays put (≤ KICK_MAX_TRAVEL torsos) and ONE leg kicks —
 * the other leg's knee stays steady (≤ KICK_OTHER_KNEE_DEG). Walking moves the pelvis and both legs.
 */
// Field video 2026-10-19: judged over the whole evidence window (up to 8 s) with "the support knee moves
// ≤ 20°", every pass was rejected — a foot adjusted seconds before, the support knee's natural bend and the
// prosthetic knee's measurement noise. A coach judges THE kick: the last KICK_WINDOW_MS, robust ranges
// (10th–90th percentile, no single-frame spike), the kicking knee clearly dominating; walking still fails
// (the pelvis travels, both legs alternate with similar ranges).
export const KICK_WINDOW_MS = 1200;
export const KICK_MAX_TRAVEL = 0.35;
export const KICK_MAX_TRAVEL_FAST = 0.45;
export const KICK_MAX_TRAVEL_SLOW = 0.38;     // a FAST strong pass (>= 350 deg/s) moves the pelvis more (owner, 2026-10-21)
export const KICK_OTHER_KNEE_DEG = 25;
export const KICK_DOMINANCE = 0.6;
export const KICK_MAX_WIDTH_CHANGE = 0.18;
export const KICK_MAX_TORSO_CHANGE = 0.18;   // the shoulder→hip length changes more → walking toward / away
export const KICK_ANCHOR_MAX = 0.3;
// a FAST, strong pass (>= 350 deg/s) moves the whole body a little - the support foot may shift up to this (owner, 2026-10-21)
export const KICK_ANCHOR_MAX_FAST = 0.5;
export const KICK_FAST_SWING_DEG_S = 350;
export const KICK_MID_SWING_DEG_S = 250;
export const KICK_ANCHOR_MAX_MID = 0.45;
// a SLOW move (< 150 °/s) of the leg that is NOT the set's leg is a step / a stance adjustment — never a pass
export const SLOW_OTHER_LEG_DEG_S = Infinity;   // (owner, 2026-10-25: blocked — fast steps of the other leg counted at 375–479 °/s)     // (owner, 2026-10-22: was 150 — a 283 °/s prosthesis move counted in a right-leg set)
export function slowOtherLeg(why, setLeg) {
  const side = why?.place?.side;
  return !!setLeg && !!side && side !== setLeg && (why?.swing?.peakVel || 0) < SLOW_OTHER_LEG_DEG_S;
}         // the support foot moves ≤ this many torso lengths (planted)  // the shoulders' width in the picture changes ≤ this share (no walking in depth)
// A KICK / PASS is proven by ITS OWN swing, judged in the kick's short window AT the contact (field video
// 2026-10-20: a controlled inside-foot pass is a pendulum from the hip with an almost straight knee — "the
// leg came back over 8 s of history" failed on every pass, 0 counts while the passes were seen)
export const STRIKE_MIN_RANGE = 20;         // ° — the kicking leg's hip OR knee swing
export const STRIKE_MIN_VEL = 60;           // °/s
export const STRIKE_MIN_PATH = 0.2;         // torso lengths — the moving end point's path          // the support knee's range ≤ this share of the kicking knee's
const spread = (v) => { if (v.length < 2) return 0; const s2 = [...v].sort((a, b) => a - b); const q = (p) => s2[Math.round(p * (s2.length - 1))]; return q(0.9) - q(0.1); };
export function kickInPlace(ev) { return inPlaceCheck(ev).ok; }

/**
 * Why a kick is (not) in place: { ok, reason: 'ok'|'walk-depth'|'walk-across'|'both-legs', widthChange, travel, kick, other }
 * (widthChange / travel as shares of their limits' basis; kick / other: the legs' swing in °)
 */
export function inPlaceCheck(ev) {
  const out = { ok: false, reason: 'ok', widthChange: null, travel: null, kick: null, other: null };
  const all = ev?.frames || [];
  const tEnd = all.length ? all[all.length - 1].t : 0;
  const fr = all.filter(f => tEnd - f.t <= KICK_WINDOW_MS);
  // walking toward / away from the camera: the shoulders' width changes (field video 2026-10-20)
  const sw = fr.map(f => f.shoulderW).filter(Number.isFinite);
  if (sw.length >= 3) {
    const med = [...sw].sort((x, y) => x - y)[Math.floor(sw.length / 2)];
    if (med > 0) out.widthChange = Math.round((spread(sw) / med) * 100) / 100;
    // (measured for the log only — NOT a rejection: a pass rotates the body and the shoulders' width changes
    // with it; field video 2026-10-21: real passes rejected for 14 s. Walking is caught by the anchor + the pelvis)
  }
  const hips = fr.map(f => f.hip).filter(Boolean);
  const torsos = fr.map(f => f.torso).filter(Number.isFinite);
  const torso = torsos.length ? torsos.reduce((a, b) => a + b, 0) / torsos.length : null;
  if (torsos.length >= 3) {
    const tmed = [...torsos].sort((x, y) => x - y)[Math.floor(torsos.length / 2)];
    if (tmed > 0) out.torsoChange = Math.round((spread(torsos) / tmed) * 100) / 100;
    if (out.torsoChange > KICK_MAX_TORSO_CHANGE) return { ...out, reason: 'walk-depth' };
  }
  if (hips.length >= 2 && torso) {
    const travel = Math.hypot(spread(hips.map(h => h.x)), spread(hips.map(h => h.y)));
    out.travel = Math.round((travel / torso) * 100) / 100;
    // graded by the pass's speed (owner, 2026-10-25): < 250 °/s 0.38 · ≥ 250 °/s 0.45 (a natural body shift in a real pass)
    out.travelMax = strikeSwing(ev).peakVel >= KICK_MID_SWING_DEG_S ? KICK_MAX_TRAVEL_FAST : KICK_MAX_TRAVEL_SLOW;
    if (travel > out.travelMax * torso) return { ...out, reason: 'walk-across' };
  }
  // THE SUPPORT ANCHOR (owner, 2026-10-20): the support leg is judged by its FOOT staying planted on the floor —
  // never by its joint angles (a prosthetic knee reads noisy, the hip turns in every real pass: "both legs moved"
  // rejected real passes). The kicking foot = the one that travelled most; the other foot must stay put. A support
  // the camera does not see as a foot (crutches, an absent limb) is not judged — the pelvis guard above still is.
  const footPath = (j) => { let p = 0, prev = null; for (const f of fr) { const e = f.e[j]; if (e && prev) p += Math.hypot(e.x - prev.x, e.y - prev.y); if (e) prev = e; } return p; };
  const footSpread = (j) => { const pts = fr.map(f => f.e[j]).filter(Boolean); return pts.length >= 3 ? Math.hypot(spread(pts.map(p => p.x)), spread(pts.map(p => p.y))) : null; };
  // the kicking leg: the SET's leg (ev.activeLeg - a whole set per leg by plan) unless the other foot clearly
  // travelled more (>= 1.6x: really the other leg kicked); else the foot that travelled most (field video
  // 2026-10-21: a right-leg pass logged "left" - the support foot shifted, then the kicking foot was judged as the anchor)
  const pathL = footPath(6), pathR = footPath(7);
  const setJ = ev?.activeLeg === 'left' ? 6 : ev?.activeLeg === 'right' ? 7 : null;
  const kickJ = setJ !== null ? ((setJ === 6 ? pathR : pathL) >= 1.6 * (setJ === 6 ? pathL : pathR) ? (setJ === 6 ? 7 : 6) : setJ)
    : (pathL >= pathR ? 6 : 7);
  const supportJ = kickJ === 6 ? 7 : 6;
  const anchor = footSpread(supportJ);
  out.kick = torso ? Math.round((footPath(kickJ) / torso) * 100) / 100 : null;
  out.side = kickJ === 6 ? 'left' : 'right';             // the kicking leg = the foot that travelled (never a jumping label)
  out.anchor = anchor !== null && torso ? Math.round((anchor / torso) * 100) / 100 : null;
  // the support foot may shift more in a faster pass: < 250 °/s 0.3 · 250–350 °/s 0.45 · ≥ 350 °/s 0.5 (owner, 2026-10-21)
  const pv = strikeSwing(ev).peakVel;
  out.anchorMax = pv >= KICK_FAST_SWING_DEG_S ? KICK_ANCHOR_MAX_FAST : pv >= KICK_MID_SWING_DEG_S ? KICK_ANCHOR_MAX_MID : KICK_ANCHOR_MAX;
  if (anchor !== null && torso && anchor > out.anchorMax * torso) return { ...out, reason: 'both-legs' };
  return { ...out, ok: true };
}

/**
 * The swing of a kick / pass in its own short window: the best leg joint's { range, peakVel, path }; ok when a
 * hip or knee swung ≥ STRIKE_MIN_RANGE at ≥ STRIKE_MIN_VEL with its end point travelling ≥ STRIKE_MIN_PATH.
 */
export function strikeSwing(ev) {
  const all = ev?.frames || [];
  const tEnd = all.length ? all[all.length - 1].t : 0;
  const fr = all.filter(f => tEnd - f.t <= KICK_WINDOW_MS);
  const torsos = fr.map(f => f.torso).filter(Number.isFinite);
  const torso = torsos.length ? torsos.reduce((a, b) => a + b, 0) / torsos.length : null;
  let best = { ok: false, range: 0, peakVel: 0, path: 0 };
  for (const j of [4, 5, 6, 7]) {
    const rows = fr.filter(f => typeof f.a[j] === 'number');
    if (rows.length < 3) continue;
    const v = rows.map(f => f.a[j]);
    const range = Math.max(...v) - Math.min(...v);
    let peakVel = 0, path = 0;
    for (let i = 1; i < rows.length; i++) {
      const dt = (rows[i].t - rows[i - 1].t) / 1000;
      if (dt > 0 && dt < 0.5) peakVel = Math.max(peakVel, Math.abs(v[i] - v[i - 1]) / dt);
      const p0 = rows[i - 1].e[j], p1 = rows[i].e[j];
      if (p0 && p1) path += Math.hypot(p1.x - p0.x, p1.y - p0.y);
    }
    // (a hip pendulum moves the knee little but the FOOT a lot: the leg's path = the longer of the two)
    const footJ = j === 4 ? 6 : j === 5 ? 7 : j;
    if (footJ !== j) {
      let fp = 0;
      for (let i = 1; i < fr.length; i++) { const p0 = fr[i - 1].e[footJ], p1 = fr[i].e[footJ]; if (p0 && p1) fp += Math.hypot(p1.x - p0.x, p1.y - p0.y); }
      path = Math.max(path, fp);
    }
    path = torso ? path / torso : 0;
    const ok = range >= STRIKE_MIN_RANGE && peakVel >= STRIKE_MIN_VEL && path >= STRIKE_MIN_PATH;
    if (ok && !best.ok || (ok === best.ok && range > best.range)) best = { ok, range: Math.round(range), peakVel: Math.round(peakVel), path: Math.round(path * 100) / 100 };
  }
  return best;
}

/** The moment of the strike's PEAK (the kicking foot at its fastest ≈ the contact), in the frames' time base. */
export function strikePeakTime(ev) {
  const all = ev?.frames || [];
  if (all.length < 3) return null;
  const tEnd = all[all.length - 1].t;
  const fr = all.filter(f => tEnd - f.t <= KICK_WINDOW_MS);
  const side = inPlaceCheck(ev).side;
  const order = side === 'left' ? [6] : side === 'right' ? [7] : [6, 7];
  let best = null, bestV = 0;
  for (const j of order) for (let i = 1; i < fr.length; i++) {
    const p0 = fr[i - 1].e[j], p1 = fr[i].e[j], dt = fr[i].t - fr[i - 1].t;
    if (!p0 || !p1 || dt <= 0) continue;
    const v = Math.hypot(p1.x - p0.x, p1.y - p0.y) / dt;
    if (v > bestV) { bestV = v; best = (fr[i].t + fr[i - 1].t) / 2; }
  }
  return best;
}

/** Why a kick / pass is (not) proven — for the console (the owner's videos show the exact reason). */
export function explainStrike(ev, t) {
  const first = ev?.frames?.[0]?.t ?? t;
  const since = ev?.lastAt == null ? t - first : t - ev.lastAt;
  return { since: Math.round(since), place: inPlaceCheck(ev), inPlace: kickInPlace(ev), swing: strikeSwing(ev) };
}

/** Does the movement since the last counted rep prove a real rep (range + velocity + trajectory + flow)? */
export function evidenceOk(ev, t, { strike = false, kick = false } = {}) {
  if (!ev) return false;
  const first = ev.frames[0]?.t ?? t;
  const since = ev.lastAt == null ? t - first : t - ev.lastAt;
  if (kick && !kickInPlace(ev)) return false;                    // walking is not a pass
  if (strike) return since >= MIN_REP_MS && strikeSwing(ev).ok;   // a kick / pass: its own swing, at the contact
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
/**
 * @param {{ kick?: boolean, canCount?: () => boolean }} [opts] - kick = a kick / pass drill (in place, one
 *   leg); canCount = the trainee is in the exercise (the start position was reached, positioned now)
 */
export function makeEvidenceGatedAnalyzer(base, evRef, now = () => Date.now(), group = 'all', opts = {}) {
  return (lm, prev = {}, ball) => {
    const t = now();
    if (!evRef.current) evRef.current = createRepEvidence(group);
    evidenceFrame(evRef.current, lm, t);
    const st = base(lm, prev, ball);
    const before = prev.reps || 0;
    if ((st.reps || 0) <= before) return st;
    const open = !opts.canCount || opts.canCount();
    if (open && evidenceOk(evRef.current, t, { strike: !!opts.kick, kick: !!opts.kick })) { evidenceAccept(evRef.current, t); return st; }
    if (!open) evidenceAccept(evRef.current, t);                   // movement before the start never carries over
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

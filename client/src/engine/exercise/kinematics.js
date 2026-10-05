// ============================================================
// kinematics — the joint-angle vocabulary of the Expert Execution Profiles (Stage 3.1)
//
// PURE. One definition of every measured joint, used by BOTH the live evaluator
// (trainee landmarks) and the profile Ghost (its generated landmarks), so what the
// Ghost demonstrates and what the trainee is measured against are the same numbers.
//
// Landmarks are MediaPipe Pose indices in the anatomical convention
// (LEFT_* = the person's left). Angles use the same angleCosine as the rep analyzers.
// ============================================================

import { angleCosine } from '../../utils/motionEngine.js';

export const P = Object.freeze({
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
});

const side3 = (l, r) => ({ left: l, right: r });

/**
 * Joint metrics: three landmarks [a, vertex, c] per side → the inner angle at the vertex (0..180°).
 *   knee     — hip / knee / ankle       (180 = straight leg)
 *   hip      — shoulder / hip / knee    (180 = standing tall, 90 = thigh ⟂ trunk)
 *   elbow    — shoulder / elbow / wrist (180 = straight arm)
 *   shoulder — elbow / shoulder / hip   (0 = arm along the body, 90 = horizontal, 180 = overhead)
 *   bodyLine — shoulder / hip / ankle   (180 = straight body line, plank / push-up)
 */
export const JOINTS = Object.freeze({
  knee: { limb: 'leg', points: side3([P.LEFT_HIP, P.LEFT_KNEE, P.LEFT_ANKLE], [P.RIGHT_HIP, P.RIGHT_KNEE, P.RIGHT_ANKLE]) },
  hip: { limb: 'leg', points: side3([P.LEFT_SHOULDER, P.LEFT_HIP, P.LEFT_KNEE], [P.RIGHT_SHOULDER, P.RIGHT_HIP, P.RIGHT_KNEE]) },
  elbow: { limb: 'arm', points: side3([P.LEFT_SHOULDER, P.LEFT_ELBOW, P.LEFT_WRIST], [P.RIGHT_SHOULDER, P.RIGHT_ELBOW, P.RIGHT_WRIST]) },
  shoulder: { limb: 'arm', points: side3([P.LEFT_ELBOW, P.LEFT_SHOULDER, P.LEFT_HIP], [P.RIGHT_ELBOW, P.RIGHT_SHOULDER, P.RIGHT_HIP]) },
  bodyLine: { limb: 'leg', points: side3([P.LEFT_SHOULDER, P.LEFT_HIP, P.LEFT_ANKLE], [P.RIGHT_SHOULDER, P.RIGHT_HIP, P.RIGHT_ANKLE]) },
});

/** Every metric name a profile may use (the joints + trunk lean + pelvic drop). */
export const METRICS = Object.freeze([...Object.keys(JOINTS), 'trunkLean', 'pelvisDrop']);

const MIN_VIS = 0.5;
export const ok = (p) => p && (p.visibility ?? 1) >= MIN_VIS;

/** Midpoint of the confidently detected points among `indices` (null if none). */
export function midOf(landmarks, indices) {
  const pts = indices.map(i => landmarks?.[i]).filter(ok);
  if (!pts.length) return null;
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

/** Torso length (shoulder mid ↔ hip mid): the body scale that makes features distance-independent. */
export function torsoLength(landmarks) {
  const sh = midOf(landmarks, [P.LEFT_SHOULDER, P.RIGHT_SHOULDER]);
  const hp = midOf(landmarks, [P.LEFT_HIP, P.RIGHT_HIP]);
  return sh && hp ? Math.hypot(sh.x - hp.x, sh.y - hp.y) : null;
}

// Approximate segment mass shares (Dempster-style, lumped on landmarks)
const COM_WEIGHTS = [
  [0, 0.08],                                    // head
  [P.LEFT_SHOULDER, 0.13], [P.RIGHT_SHOULDER, 0.13],
  [P.LEFT_HIP, 0.15], [P.RIGHT_HIP, 0.15],      // trunk + pelvis
  [P.LEFT_KNEE, 0.1], [P.RIGHT_KNEE, 0.1],      // thighs
  [P.LEFT_ANKLE, 0.045], [P.RIGHT_ANKLE, 0.045], // shanks + feet
  [P.LEFT_ELBOW, 0.03], [P.RIGHT_ELBOW, 0.03], [P.LEFT_WRIST, 0.02], [P.RIGHT_WRIST, 0.02],
];

/**
 * Whole-body center of mass estimate (image coords). Needs the shoulders and hips;
 * missing distal points are dropped and the weights renormalized.
 */
export function centerOfMass(landmarks) {
  if (!landmarks || !midOf(landmarks, [P.LEFT_HIP, P.RIGHT_HIP]) || !midOf(landmarks, [P.LEFT_SHOULDER, P.RIGHT_SHOULDER])) return null;
  let x = 0, y = 0, w = 0;
  for (const [i, wi] of COM_WEIGHTS) {
    const p = landmarks[i];
    if (!ok(p)) continue;
    x += p.x * wi; y += p.y * wi; w += wi;
  }
  return w > 0 ? { x: x / w, y: y / w } : null;
}

/**
 * Pelvic drop: tilt of the hip line from horizontal (deg) — frontal view only (hip stability /
 * Trendelenburg sign). Null in a side view, where the hips overlap and the tilt is meaningless.
 */
export function pelvisDrop(landmarks) {
  const l = landmarks?.[P.LEFT_HIP], r = landmarks?.[P.RIGHT_HIP];
  if (!ok(l) || !ok(r)) return null;
  const scale = torsoLength(landmarks);
  const dx = Math.abs(l.x - r.x);
  if (!scale || dx < 0.3 * scale) return null;
  return Math.atan2(Math.abs(l.y - r.y), dx) * 180 / Math.PI;
}

/**
 * Can this side's limb be measured for a joint? Absent / above-knee prosthetic legs and
 * absent / non-trainable arms are never measured (Iron Rule). A below-knee prosthesis keeps
 * a real knee and hip → measured.
 */
export function sideUsable(jointLimb, side, lp = {}) {
  const limb = lp[`${side}_${jointLimb}`];
  if (!limb) return true;
  if (limb.state === 'absent') return false;
  if (jointLimb === 'leg') return !(limb.state === 'prosthetic' && limb.level === 'above_knee');
  return limb.trainable !== false;
}

/** Angle of one joint on one side, or null when a point is missing / not confident. */
export function jointAngleSide(landmarks, joint, side) {
  const def = JOINTS[joint];
  if (!def || !landmarks) return null;
  const [a, b, c] = def.points[side].map(i => landmarks[i]);
  if (!ok(a) || !ok(b) || !ok(c)) return null;
  return angleCosine(a, b, c);
}

/**
 * Trunk lean: angle of the hip→shoulder line from vertical (0 = upright, 90 = horizontal,
 * >90 = shoulders below the hips). Uses the midpoints of whatever sides are visible.
 */
export function trunkLean(landmarks) {
  if (!landmarks) return null;
  const sh = midOf(landmarks, [P.LEFT_SHOULDER, P.RIGHT_SHOULDER]);
  const hp = midOf(landmarks, [P.LEFT_HIP, P.RIGHT_HIP]);
  if (!sh || !hp) return null;
  const dx = sh.x - hp.x;
  const dy = sh.y - hp.y;           // image y grows downward → upright trunk has dy < 0
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return Math.atan2(Math.abs(dx), -dy) * 180 / Math.PI;
}

/**
 * Value of a metric for the trainee. A joint combines the usable, visible sides
 * ('min' = the most bent side, the default; 'max' = the most extended).
 * @returns {number|null}
 */
export function measureMetric(landmarks, metric, lp = {}, combine = 'min') {
  if (metric === 'trunkLean') return trunkLean(landmarks);
  if (metric === 'pelvisDrop') return pelvisDrop(landmarks);
  const def = JOINTS[metric];
  if (!def) return null;
  const vals = ['left', 'right']
    .filter(s => sideUsable(def.limb, s, lp))
    .map(s => jointAngleSide(landmarks, metric, s))
    .filter(v => typeof v === 'number');
  if (!vals.length) return null;
  return combine === 'max' ? Math.max(...vals) : Math.min(...vals);
}

// ============================================================
// profileGhost — the Ghost generated FROM an Expert Execution Profile (Stage 3.1)
//
// PURE pose math. The Ghost's joints are placed by forward / inverse kinematics so that
// the joint angles measured on the Ghost (with the same kinematics.js definitions the
// live evaluator uses) are exactly the profile's Ghost angles. Tests sample the cycle and
// assert: Ghost angles ∈ the profile's target ranges, and zero evaluator errors on the Ghost.
//
// Output has the same shape as warmupGhost.ghostPose (segments / torso / neck / head),
// so the existing drawers (demo panel + full overlay) draw it unchanged, plus:
//   landmarks — a 33-point MediaPipe-like array (for the sync tests)
//   floorY    — floor line in body units (shadow)
//
// Coordinates: "body units", y grows downward, the standing hip center is the origin
// (so the overlay / panel anchoring of the warm-up Ghost applies). Side views face +x.
// Iron Rule: absent / non-trainable limbs are not drawn; a below-knee prosthesis is a
// dashed pylon (shin).
// ============================================================

import { GHOST_BODY as B } from '../ghostBody.js';
import { P } from './kinematics.js';

const TRUNK = -B.shoulderY;               // hip → shoulder length
const FLOOR_Y = B.thigh + B.shin;         // ankle height when standing (hip at 0)
const rad = (d) => (d * Math.PI) / 180;

/** Direction for an angle measured from "up" (0 = up, 90 = forward +x, 180 = down). */
const dir = (a) => ({ x: Math.sin(rad(a)), y: -Math.cos(rad(a)) });
const step = (p, len, a) => { const d = dir(a); return { x: p.x + d.x * len, y: p.y + d.y * len }; };
const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Two-link IK: the joint between `a` (link la) and `b` (link lb). Picks the solution with the
 * larger `prefer(point)` score. Out of reach → the joint on the straight line.
 */
function ikJoint(a, la, b, lb, prefer) {
  const d = dist(a, b);
  if (d >= la + lb - 1e-9 || d < 1e-9) return lerp(a, b, la / (la + lb));
  const x = (la * la - lb * lb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, la * la - x * x));
  const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
  const base = { x: a.x + ux * x, y: a.y + uy * x };
  const s1 = { x: base.x - uy * h, y: base.y + ux * h };
  const s2 = { x: base.x + uy * h, y: base.y - ux * h };
  return prefer(s1) >= prefer(s2) ? s1 : s2;
}

/**
 * Cyclic keyframe interpolation — a MONOTONE CUBIC (Fritsch–Carlson) through the keyframes:
 * the motion flows through each keyframe with a continuous speed (no stop-and-go at every
 * keyframe, which looked mechanical), and never overshoots a keyframe value (the Ghost stays
 * inside the profile ranges). The last keyframe wraps to the first.
 */
function keyframeAngles(keyframes, u) {
  const n = keyframes.length;
  if (n === 1) return { ...keyframes[0].a };
  let i = n - 1;
  for (let k = 0; k < n; k++) if (keyframes[k].t <= u) i = k;
  const ta = keyframes[i].t > u ? keyframes[i].t - 1 : keyframes[i].t;
  const tb = i === n - 1 ? keyframes[0].t + 1 : keyframes[i + 1].t;
  const h = tb - ta;
  const s = h > 0 ? Math.min(1, Math.max(0, (u - ta) / h)) : 0;
  // neighbours (cyclic) with their unwrapped times
  const at = (k) => {
    const m = ((k % n) + n) % n;
    const wrap = Math.floor(k / n);
    return { t: keyframes[m].t + wrap, a: keyframes[m].a };
  };
  const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
  const t1 = ta, t2 = tb;
  const t0 = p0.t - (p1.t - ta), t3 = p3.t - (p2.t - tb);
  const out = {};
  for (const key of Object.keys(p1.a)) {
    const v0 = p0.a[key] ?? p1.a[key], v1 = p1.a[key], v2 = p2.a[key] ?? v1, v3 = p3.a[key] ?? v2;
    const d0 = (v1 - v0) / Math.max(1e-6, t1 - t0);
    const d1 = (v2 - v1) / Math.max(1e-6, t2 - t1);
    const d2 = (v3 - v2) / Math.max(1e-6, t3 - t2);
    // tangents: 0 at a turning point (no overshoot), else the harmonic mean of the slopes
    const tan = (a, b) => (a * b <= 0 ? 0 : (2 * a * b) / (a + b));
    const m1 = tan(d0, d1), m2 = tan(d1, d2);
    const s2 = s * s, s3 = s2 * s;
    out[key] = (2 * s3 - 3 * s2 + 1) * v1 + (s3 - 2 * s2 + s) * h * m1 + (-2 * s3 + 3 * s2) * v2 + (s3 - s2) * h * m2;
  }
  return out;
}

/**
 * Interpolated Ghost angles at phase t (0..1).
 *   rest/peak ghosts: 0 = rest, 0.5 = peak (cosine); holds stay at rest.
 *   keyframe ghosts:  ghost.keyframes over the cycle; with ghost.alternate the keyframes describe
 *                     HALF a cycle (A = support leg, B = swinging leg) and the sides swap in the
 *                     second half (running) — the swap is applied in profileGhostPose.
 */
export function ghostAnglesAt(ghost, t) {
  if (ghost.keyframes) {
    const u = ghost.alternate ? ((t % 0.5) + 0.5) % 0.5 * 2 : ((t % 1) + 1) % 1;
    return keyframeAngles(ghost.keyframes, u);
  }
  const rest = ghost.rest || {};
  const peak = ghost.peak;
  if (!peak) return { ...rest };
  // toPeakShare: the share of the cycle spent going rest → peak (0.5 = symmetric). An explosive
  // variation keeps the controlled phase and makes the other one fast.
  const s = ghost.toPeakShare ?? 0.5;
  const tc = ((t % 1) + 1) % 1;
  const u = tc < s ? (1 - Math.cos(Math.PI * tc / s)) / 2 : (1 + Math.cos(Math.PI * (tc - s) / (1 - s))) / 2;
  const out = {};
  for (const k of new Set([...Object.keys(rest), ...Object.keys(peak)])) {
    const a = rest[k] ?? peak[k];
    const b = peak[k] ?? rest[k];
    out[k] = a + (b - a) * u;
  }
  return out;
}

// ---------------- Skeletons per base ----------------

/** Standing, side view (squat, hinge, curls, raises, wall sit). */
function standSide(a, ghost) {
  const K = a.knee ?? 175, H = a.hip ?? 175, E = a.elbow ?? 170;
  const shank = a.shank ?? 0.45 * (180 - K);      // shin leans forward with knee bend (balance over the feet)
  const ankle = { x: 0, y: FLOOR_Y };
  const knee = step(ankle, B.shin, shank);
  const aThigh = shank - (180 - K);
  const hip = step(knee, B.thigh, aThigh);
  const aTrunk = aThigh + (180 - H);
  const shoulder = step(hip, TRUNK, aTrunk);
  const S = ghost.armsHang ? aTrunk : (a.shoulder ?? 10);       // hanging arms: vertical to the floor
  const aUpper = aTrunk + 180 - S;
  const elbow = step(shoulder, B.upperArm, aUpper);
  const wrist = step(elbow, B.forearm, aUpper - (180 - E));
  const leg = { hip, knee, ankle };
  return { shoulder, hip, aTrunk, legs: { front: leg, back: leg }, arm: { shoulder, elbow, wrist } };
}

/** Split stance, side view: front leg by FK, back foot planted (IK). */
function lungeSide(a) {
  const K = a.knee ?? 165, H = a.hip ?? 170, E = a.elbow ?? 170;
  const frontAnkle = { x: 0.55, y: FLOOR_Y };
  const knee = step(frontAnkle, B.shin, a.shank ?? 5);
  const aThigh = (a.shank ?? 5) - (180 - K);
  const hip = step(knee, B.thigh, aThigh);
  const aTrunk = aThigh + (180 - H);
  const shoulder = step(hip, TRUNK, aTrunk);
  const backAnkle = { x: -0.95, y: FLOOR_Y - 0.08 };          // on the toes
  const backKnee = ikJoint(hip, B.thigh, backAnkle, B.shin, (p) => p.y);   // back knee points to the floor
  const aUpper = aTrunk + 180 - (a.shoulder ?? 10);
  const elbow = step(shoulder, B.upperArm, aUpper);
  const wrist = step(elbow, B.forearm, aUpper - (180 - E));
  return {
    shoulder, hip, aTrunk,
    legs: { front: { hip, knee, ankle: frontAnkle }, back: { hip, knee: backKnee, ankle: backAnkle } },
    arm: { shoulder, elbow, wrist },
  };
}

/**
 * Stride, side view (running in place, kicks): leg A stands on the floor (FK from the ankle),
 * leg B swings from the hip. B.thigh = thigh angle from straight down (+ forward / − behind).
 * Arms swing per side: armA / armB = shoulder flexion (+ forward / − back), elbow bend shared.
 */
function strideSide(a) {
  const KA = a['A.knee'] ?? 170;
  const shank = a['A.shank'] ?? 0.45 * (180 - KA);
  const ankleA = { x: 0, y: FLOOR_Y };
  const kneeA = step(ankleA, B.shin, shank);
  const hip = step(kneeA, B.thigh, shank - (180 - KA));
  const aTrunk = a.trunk ?? 4;
  const shoulder = step(hip, TRUNK, aTrunk);
  const dThighB = 180 - (a['B.thigh'] ?? 0);
  const kneeB = step(hip, B.thigh, dThighB);
  const ankleB = step(kneeB, B.shin, dThighB + (180 - (a['B.knee'] ?? 170)));
  const E = a.elbow ?? 170;
  const armOf = (flex) => {
    const aUpper = aTrunk + 180 - flex;
    const elbow = step(shoulder, B.upperArm, aUpper);
    return { shoulder, elbow, wrist: step(elbow, B.forearm, aUpper - (180 - E)) };
  };
  return {
    shoulder, hip, aTrunk,
    legs: { A: { hip, knee: kneeA, ankle: ankleA }, B: { hip, knee: kneeB, ankle: ankleB } },
    arms: { A: armOf(a.armA ?? 10), B: armOf(a.armB ?? 10) },
  };
}

/** Prone, side view (push-up on the hands, plank on the forearms): straight body line. */
function proneSide(a, ghost) {
  let shoulder, elbow, wrist;
  if (ghost.support === 'forearm') {
    elbow = { x: 0.75, y: FLOOR_Y - 0.05 };
    wrist = { x: elbow.x + B.forearm, y: elbow.y };
    shoulder = { x: elbow.x, y: elbow.y - B.upperArm };
  } else {
    const E = a.elbow ?? 172;
    wrist = { x: 0.9, y: FLOOR_Y };
    const d = Math.sqrt(B.upperArm ** 2 + B.forearm ** 2 - 2 * B.upperArm * B.forearm * Math.cos(rad(E)));
    shoulder = { x: wrist.x, y: wrist.y - d };
    elbow = ikJoint(shoulder, B.upperArm, wrist, B.forearm, (p) => -p.x);   // elbows point back
  }
  const len = TRUNK + B.thigh + B.shin;
  const ankleY = FLOOR_Y - 0.1;
  const ankle = { x: shoulder.x - Math.sqrt(Math.max(0, len * len - (ankleY - shoulder.y) ** 2)), y: ankleY };
  const hip = lerp(shoulder, ankle, TRUNK / len);
  const knee = lerp(shoulder, ankle, (TRUNK + B.thigh) / len);
  const aTrunk = Math.atan2(shoulder.x - hip.x, -(shoulder.y - hip.y)) * 180 / Math.PI;
  const leg = { hip, knee, ankle };
  return { shoulder, hip, aTrunk, legs: { front: leg, back: leg }, arm: { shoulder, elbow, wrist } };
}

/** Supine, side view (glute bridge): shoulders and feet on the floor, the hips rise. */
function supineSide(a) {
  const shoulder = { x: -1.3, y: FLOOR_Y - 0.12 };
  const ankle = { x: 1.05, y: FLOOR_Y - 0.06 };
  const pose = (beta) => {
    const hip = { x: shoulder.x + TRUNK * Math.cos(rad(beta)), y: shoulder.y - TRUNK * Math.sin(rad(beta)) };
    const knee = ikJoint(hip, B.thigh, ankle, B.shin, (p) => -p.y);   // knees up
    return { hip, knee };
  };
  const hipAngle = ({ hip, knee }) => {
    const v1 = { x: shoulder.x - hip.x, y: shoulder.y - hip.y };
    const v2 = { x: knee.x - hip.x, y: knee.y - hip.y };
    const c = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
    return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  };
  // Hip angle grows with the hip lift β (up to the straight bridge) → scan up, then refine
  const target = a.hip ?? 130;
  let lo = 0, hi = 0;
  for (let b = 0.5, prev = hipAngle(pose(0)); b <= 60; b += 0.5) {
    const v = hipAngle(pose(b));
    if (v < prev) break;                 // past the straight bridge — angle would fall again
    hi = b; prev = v;
    if (v >= target) break;
    lo = b;
  }
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (hipAngle(pose(m)) < target) lo = m; else hi = m;
  }
  const { hip, knee } = pose(hi);
  const elbow = { x: shoulder.x + B.upperArm, y: FLOOR_Y - 0.05 };   // arms resting on the floor
  const wrist = { x: elbow.x + B.forearm, y: FLOOR_Y - 0.05 };
  const aTrunk = Math.atan2(shoulder.x - hip.x, -(shoulder.y - hip.y)) * 180 / Math.PI;
  const leg = { hip, knee, ankle };
  return { shoulder, hip, aTrunk, headDir: -1, legs: { front: leg, back: leg }, arm: { shoulder, elbow, wrist } };
}

/** Standing, front view (shoulder press, lateral raise). Returns per-side points. */
function standFront(a) {
  const S = a.shoulder ?? 15, E = a.elbow ?? 170;
  const sides = {};
  for (const side of ['left', 'right']) {
    const out = side === 'left' ? 1 : -1;                    // the figure's LEFT is at +x (raw image)
    const shoulder = { x: out * B.shoulderX, y: B.shoulderY };
    const hip = { x: out * B.hipX, y: 0 };
    const fdir = (phi) => ({ x: out * Math.sin(rad(phi)), y: Math.cos(rad(phi)) });   // 0 = down, 90 = out, 180 = up
    const phiHip = 0;     // the trunk axis is vertical when standing facing the camera (shoulder angle = vs. the trunk axis)
    const phiUpper = phiHip + S;
    const du = fdir(phiUpper);
    const elbow = { x: shoulder.x + du.x * B.upperArm, y: shoulder.y + du.y * B.upperArm };
    const df = fdir(phiUpper + (180 - E));
    const wrist = { x: elbow.x + df.x * B.forearm, y: elbow.y + df.y * B.forearm };
    const knee = { x: hip.x, y: B.thigh };
    const ankle = { x: hip.x, y: FLOOR_Y };
    sides[side] = { shoulder, hip, elbow, wrist, knee, ankle };
  }
  return sides;
}

// ---------------- Assembly ----------------

function legDrawable(limb) {
  const l = limb || { state: 'ok' };
  return !(l.state === 'absent' || (l.state === 'prosthetic' && l.level !== 'below_knee'));
}
function armDrawable(limb) {
  return !limb || (limb.trainable !== false && limb.state !== 'absent');
}

/**
 * Ghost pose for a profile at phase t (0..1).
 * @param {Object} profile - an expert profile (personalized)
 * @param {number} t
 * @param {Object} [lp] - limbProfile
 * @returns {{ segments, torso, neck, head, landmarks: Object[], floorY: number } | null}
 */
export function profileGhostPose(profile, t, lp = {}) {
  const pose = buildPose(profile, t, lp);
  if (!pose) return null;
  // Flight (jumps): the whole body rises by `rise` body units — the feet leave the floor
  const rise = ghostAnglesAt(profile.ghost, t).rise || 0;
  return rise > 0 ? shiftPose(pose, -rise) : pose;
}

/** Copy of a pose moved vertically by dy (every point, landmarks included). */
function shiftPose(pose, dy) {
  const mv = (p) => (p && typeof p.y === 'number' ? { ...p, y: p.y + dy } : p);
  return {
    ...pose,
    segments: pose.segments.map(sg => ({ ...sg, from: mv(sg.from), to: mv(sg.to) })),
    landmarks: pose.landmarks.map(l => (l.visibility ? mv(l) : l)),
    neck: mv(pose.neck),
    head: mv(pose.head),
    torso: Object.fromEntries(Object.entries(pose.torso).map(([k, v]) => [k, mv(v)])),
  };
}

function buildPose(profile, t, lp = {}) {
  const ghost = profile?.ghost;
  if (!ghost) return null;
  const a = ghostAnglesAt(ghost, t);
  const segments = [];
  const add = (from, to, limb, part, dashed = false) => segments.push({ from, to, limb, part, dashed });
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  const put = (i, p) => { lm[i] = { x: p.x, y: p.y, z: 0, visibility: 1 }; };
  const NOSE = 0;

  if (ghost.view === 'front') {
    const s = standFront(a);
    for (const side of ['left', 'right']) {
      const q = s[side];
      const L = side === 'left';
      put(L ? P.LEFT_SHOULDER : P.RIGHT_SHOULDER, q.shoulder);
      put(L ? P.LEFT_HIP : P.RIGHT_HIP, q.hip);
      put(L ? P.LEFT_KNEE : P.RIGHT_KNEE, q.knee);
      put(L ? P.LEFT_ANKLE : P.RIGHT_ANKLE, q.ankle);
      if (legDrawable(lp[`${side}_leg`])) {
        add(q.hip, q.knee, `${side}_leg`, 'thigh');
        add(q.knee, q.ankle, `${side}_leg`, 'shin', lp[`${side}_leg`]?.state === 'prosthetic');
      }
      if (armDrawable(lp[`${side}_arm`])) {
        put(L ? P.LEFT_ELBOW : P.RIGHT_ELBOW, q.elbow);
        put(L ? P.LEFT_WRIST : P.RIGHT_WRIST, q.wrist);
        add(q.shoulder, q.elbow, `${side}_arm`, 'upperArm');
        add(q.elbow, q.wrist, `${side}_arm`, 'forearm');
      }
    }
    const neck = { x: 0, y: B.shoulderY - 0.05 };
    put(NOSE, { x: 0, y: B.headY });
    return {
      segments, landmarks: lm, floorY: FLOOR_Y + 0.05, neck,
      head: { x: 0, y: B.headY, r: B.headR },
      torso: {
        ls: s.left.shoulder, rs: s.right.shoulder, lh: s.left.hip, rh: s.right.hip,
        lw: { x: B.waistX, y: B.waistY }, rw: { x: -B.waistX, y: B.waistY },
      },
    };
  }

  // Side views
  const k = ghost.base === 'lunge' ? lungeSide(a)
    : ghost.base === 'prone' ? proneSide(a, ghost)
      : ghost.base === 'supine' ? supineSide(a)
        : ghost.base === 'stride' ? strideSide(a)
          : standSide(a, ghost);
  const { shoulder, hip, aTrunk } = k;
  // Front (working) leg: a leg without a prosthesis when there is one
  const affectedLeft = lp.left_leg?.state === 'prosthetic' || lp.left_leg?.state === 'absent';
  const frontSide = affectedLeft ? 'right' : 'left';
  const backSide = frontSide === 'left' ? 'right' : 'left';
  let legPairs;
  let armPairs;
  if (ghost.base === 'stride') {
    // A = support leg: the affected side when there is one (plant on the prosthesis, kick with the
    // working leg); alternating ghosts (running) swap A/B every half cycle
    let sideA = affectedLeft || lp.right_leg?.state === 'prosthetic' || lp.right_leg?.state === 'absent'
      ? (affectedLeft ? 'left' : 'right') : 'left';
    // A variation may name the working (moving) leg; the support leg is the other one —
    // unless that would put the trainee on an absent / above-knee leg (Iron Rule wins)
    if (ghost.workingSide === 'left' || ghost.workingSide === 'right') {
      const support = ghost.workingSide === 'left' ? 'right' : 'left';
      const st = lp[`${support}_leg`];
      if (!(st?.state === 'absent' || (st?.state === 'prosthetic' && st?.level !== 'below_knee'))) sideA = support;
    }
    if (ghost.alternate && (((t % 1) + 1) % 1) >= 0.5) sideA = sideA === 'left' ? 'right' : 'left';
    // A balance hold stands ONLY on a weight-bearing leg (never on an absent / above-knee side)
    if (ghost.supportMustBear) {
      const bears = (s) => { const l = lp[`${s}_leg`]; return !(l?.state === 'absent' || (l?.state === 'prosthetic' && l?.level !== 'below_knee')); };
      if (!bears(sideA)) sideA = sideA === 'left' ? 'right' : 'left';
    }
    const sideB = sideA === 'left' ? 'right' : 'left';
    legPairs = [[sideA, k.legs.A], [sideB, k.legs.B]];
    armPairs = [[sideA, k.arms.A], [sideB, k.arms.B]];
  } else {
    legPairs = [[backSide, k.legs.back], [frontSide, k.legs.front]];
    armPairs = [['left', k.arm], ['right', k.arm]];
  }
  for (const [side, leg] of legPairs) {
    const L = side === 'left';
    put(L ? P.LEFT_HIP : P.RIGHT_HIP, leg.hip);
    put(L ? P.LEFT_KNEE : P.RIGHT_KNEE, leg.knee);
    put(L ? P.LEFT_ANKLE : P.RIGHT_ANKLE, leg.ankle);
    if (!legDrawable(lp[`${side}_leg`])) continue;
    add(leg.hip, leg.knee, `${side}_leg`, 'thigh');
    add(leg.knee, leg.ankle, `${side}_leg`, 'shin', lp[`${side}_leg`]?.state === 'prosthetic');
  }
  for (const [side, arm] of armPairs) {
    const L = side === 'left';
    put(L ? P.LEFT_SHOULDER : P.RIGHT_SHOULDER, shoulder);
    if (!armDrawable(lp[`${side}_arm`])) continue;
    put(L ? P.LEFT_ELBOW : P.RIGHT_ELBOW, arm.elbow);
    put(L ? P.LEFT_WRIST : P.RIGHT_WRIST, arm.wrist);
    add(shoulder, arm.elbow, `${side}_arm`, 'upperArm');
    add(arm.elbow, arm.wrist, `${side}_arm`, 'forearm');
  }

  // Torso with depth (chest / back) — side view
  const fwd = dir(aTrunk + 90);
  const off = (p, d) => ({ x: p.x + fwd.x * d, y: p.y + fwd.y * d });
  const waist = lerp(hip, shoulder, (0 - B.waistY) / TRUNK);
  const up = dir(aTrunk);
  const neck = { x: shoulder.x + up.x * 0.05, y: shoulder.y + up.y * 0.05 };
  const headC = { x: shoulder.x + up.x * 0.4 + fwd.x * 0.06, y: shoulder.y + up.y * 0.4 + fwd.y * 0.06 };
  put(NOSE, { x: headC.x + fwd.x * 0.15, y: headC.y + fwd.y * 0.15 });
  const sidePose = {
    segments, landmarks: lm, floorY: FLOOR_Y + 0.05, neck,
    head: { x: headC.x, y: headC.y, r: B.headR },
    torso: { ls: off(shoulder, 0.16), rs: off(shoulder, -0.14), lw: off(waist, 0.13), rw: off(waist, -0.15), lh: off(hip, 0.14), rh: off(hip, -0.16) },
  };
  // Standing exercises are shown and measured FACING the camera (owner, 2026-10-06): the sagittal
  // movement goes into depth (z), so every joint angle stays exactly the profile's
  if (profile.posture !== 'standing') return sidePose;
  // Drawn in a 3/4 view (the measurement stays frontal): the depth of the movement — the kick's
  // swing, the squat's hips back / knees forward — is visible. A kick turns toward the kicking leg.
  let out = 1;
  let feet = {};
  let armAbd = {};
  if (ghost.base === 'stride' && !ghost.alternate) {
    const kickSide = legPairs[1][0];
    out = kickSide === 'left' ? 1 : -1;
    if (ghost.foot) feet = { [kickSide]: strikingFoot(ghost.foot, t, ghost.contactT ?? 0.5) };
    // a kicker's balance arm: the arm on the support side opens out to the side through the swing
    if (ghost.foot) armAbd = { [kickSide === 'left' ? 'right' : 'left']: 38 * bump(t, 0.12, 0.84, 0.14) };
  }
  // depth is measured from the planted feet, so the feet stay put and the hips move (squat: back)
  return toFront(sidePose, { yaw: profile.kind === 'strike' ? 55 : 26, out, refX: ghost.base === 'lunge' ? -0.2 : 0, feet, armAbd });
}

/** Smooth 0 -> 1 -> 0 window over [a, b] with ramps of r (phase units). */
function bump(t, a, b, r = 0.08) {
  const u = ((t % 1) + 1) % 1;
  if (u <= a || u >= b) return 0;
  const x = Math.min(1, (u - a) / r, (b - u) / r);
  return x * x * (3 - 2 * x);
}

/**
 * The kicking foot through the swing, as a real player does it:
 *   laces (instep drive): the ankle locked with the toes pointed (plantar flexion) through the
 *     swing — the LACES strike the ball;
 *   inside (side-foot pass): the leg turned out from the hip (the foot ~80° outward), the ankle
 *     locked with the toes up — the INSIDE of the foot faces the target and strikes.
 * glow: the striking surface is always marked, and flashes at the moment of contact.
 */
function strikingFoot(style, t, contactT) {
  const swing = style === 'inside' ? bump(t, 0.2, 0.78) : bump(t, 0.26, 0.72);
  const u = ((t % 1) + 1) % 1;
  const flash = Math.exp(-(((u - contactT) / 0.045) ** 2));
  return {
    style,
    plantar: style === 'inside' ? -8 * swing : 32 * swing,
    turnout: style === 'inside' ? 80 * swing : 0,
    glow: 0.4 + 0.6 * flash,
    contact: flash,
  };
}

const FOOT_LEN = 0.46;        // heel -> toe, body units (~ a 26 cm boot)

/**
 * 3D foot of a leg (front-view coords: x lateral, y down, z depth; forward = -z) from its knee and
 * ankle: perpendicular to the shin (neutral), pointed by `plantar` degrees, turned out by
 * `turnout` degrees. The STRIKING SURFACE (laces / inside) and its normal (where the ball sits).
 */
export function footGeometry(knee, ankle, side, opts = {}) {
  const out = side === 'left' ? 1 : -1;
  const sx = ankle.x - knee.x, sy = ankle.y - knee.y, sz = (ankle.z ?? 0) - (knee.z ?? 0);
  const L = Math.hypot(sx, sy, sz) || 1;
  const sf = -sz / L, sv = sy / L;                 // shin direction in the sagittal plane (forward, down)
  const phi = ((opts.plantar ?? 0) * Math.PI) / 180;
  // in the air: perpendicular to the shin, pointing forward (plantar flexion turns it toward the
  // shin); on the floor: FLAT (the ankle bends, the sole stays on the ground) — blended by height
  const air = Math.min(1, Math.max(0, (FLOOR_Y - ankle.y) / 0.22));
  let df = (Math.cos(phi) * sv + Math.sin(phi) * sf) * air + (1 - air);
  let dv = (Math.cos(phi) * -sf + Math.sin(phi) * sv) * air;
  const n = Math.hypot(df, dv) || 1; df /= n; dv /= n;
  const psi = ((opts.turnout ?? 0) * Math.PI) / 180;
  const dir = { x: out * Math.sin(psi) * Math.abs(df), y: dv, z: -df * Math.cos(psi) };
  const at = (k, e = { x: 0, y: 0, z: 0 }) => ({
    x: ankle.x + dir.x * k + e.x, y: ankle.y + dir.y * k + e.y, z: (ankle.z ?? 0) + dir.z * k + e.z,
  });
  const toe = at(FOOT_LEN, { x: 0, y: 0.03, z: 0 });
  const heel = at(-0.1, { x: 0, y: 0.05, z: 0 });
  let patch = null, normal = null;
  if (opts.style === 'inside') {
    // the medial face: toward the body midline, facing forward when the foot is turned out
    normal = { x: -out * Math.cos(psi), y: 0, z: -Math.sin(psi) };
    patch = at(FOOT_LEN * 0.42, { x: normal.x * 0.06, y: 0.01, z: normal.z * 0.06 });
  } else if (opts.style === 'laces') {
    // the top of the foot (the laces): away from the sole, i.e. against the shin direction
    const top = { x: -sx / L, y: -sv, z: -sz / L };
    patch = at(FOOT_LEN * 0.5, { x: top.x * 0.05, y: top.y * 0.05, z: top.z * 0.05 });
    normal = { x: 0, y: 0, z: -1 };               // the ball is struck forward
  }
  return { ankle, heel, toe, dir, patch, normal, style: opts.style || null, glow: opts.glow ?? 0, contact: opts.contact ?? 0 };
}

// Lateral position (body units, the figure's LEFT at +x) of each landmark in the front view
const LATERAL = {
  [P.LEFT_SHOULDER]: B.shoulderX, [P.RIGHT_SHOULDER]: -B.shoulderX,
  // each limb stays in its own sagittal plane, so every angle is exactly the side view's
  [P.LEFT_ELBOW]: B.shoulderX, [P.RIGHT_ELBOW]: -B.shoulderX,
  [P.LEFT_WRIST]: B.shoulderX, [P.RIGHT_WRIST]: -B.shoulderX,
  [P.LEFT_HIP]: B.hipX, [P.RIGHT_HIP]: -B.hipX,
  [P.LEFT_KNEE]: B.hipX, [P.RIGHT_KNEE]: -B.hipX,
  [P.LEFT_ANKLE]: B.hipX, [P.RIGHT_ANKLE]: -B.hipX,
  0: 0,
};
const SEG_POINTS = {
  left_leg: { thigh: [P.LEFT_HIP, P.LEFT_KNEE], shin: [P.LEFT_KNEE, P.LEFT_ANKLE] },
  right_leg: { thigh: [P.RIGHT_HIP, P.RIGHT_KNEE], shin: [P.RIGHT_KNEE, P.RIGHT_ANKLE] },
  left_arm: { upperArm: [P.LEFT_SHOULDER, P.LEFT_ELBOW], forearm: [P.LEFT_ELBOW, P.LEFT_WRIST] },
  right_arm: { upperArm: [P.RIGHT_SHOULDER, P.RIGHT_ELBOW], forearm: [P.RIGHT_ELBOW, P.RIGHT_WRIST] },
};

/**
 * Side-view pose → the same pose seen from the FRONT: lateral x per body side, the same height y,
 * and the side view's forward axis as depth z (toward the camera = negative z, like MediaPipe).
 */
function toFront(pose, view = {}) {
  // depth reference: the planted feet (the side view's forward offset is depth now)
  const hipX = typeof view.refX === 'number' ? view.refX : (pose.landmarks[P.LEFT_HIP].x + pose.landmarks[P.RIGHT_HIP].x) / 2;
  const lm = pose.landmarks.map((p, i) => (p.visibility
    ? { x: LATERAL[i] ?? 0, y: p.y, z: -(p.x - hipX), visibility: 1 }
    : p));
  // Arm abduction (out to the side, about the shoulder's front-back axis) — drawn only
  for (const side of ['left', 'right']) {
    const abd = view.armAbd?.[side];
    if (!abd) continue;
    const s = lm[side === 'left' ? P.LEFT_SHOULDER : P.RIGHT_SHOULDER];
    const outX = side === 'left' ? 1 : -1;
    const a = (abd * Math.PI) / 180;
    for (const i of side === 'left' ? [P.LEFT_ELBOW, P.LEFT_WRIST] : [P.RIGHT_ELBOW, P.RIGHT_WRIST]) {
      const q = lm[i];
      if (!q?.visibility) continue;
      const dy = q.y - s.y;
      lm[i] = { ...q, x: q.x + outX * dy * Math.sin(a), y: s.y + dy * Math.cos(a) };
    }
  }
  const pt = (i) => ({ x: lm[i].x, y: lm[i].y, z: lm[i].z });
  const zOf = (p) => -(p.x - hipX);
  const segments = pose.segments.map((sg) => {
    const idx = SEG_POINTS[sg.limb]?.[sg.part];
    return idx ? { ...sg, from: pt(idx[0]), to: pt(idx[1]) } : sg;
  });
  // Feet with a direction (a boot, not a blob) — and the striking surface of a kick / pass
  const feet = {};
  for (const side of ['left', 'right']) {
    const kn = lm[side === 'left' ? P.LEFT_KNEE : P.RIGHT_KNEE];
    const an = lm[side === 'left' ? P.LEFT_ANKLE : P.RIGHT_ANKLE];
    if (kn?.visibility && an?.visibility) feet[side] = footGeometry(kn, an, side, view.feet?.[side] || {});
  }
  const sh = (lm[P.LEFT_SHOULDER].y + lm[P.RIGHT_SHOULDER].y) / 2;
  const hp = (lm[P.LEFT_HIP].y + lm[P.RIGHT_HIP].y) / 2;
  const shZ = lm[P.LEFT_SHOULDER].z, hpZ = lm[P.LEFT_HIP].z;
  const waistY = hp + (sh - hp) * 0.4;
  const waistZ = hpZ + (shZ - hpZ) * 0.4;
  const headY = pose.head.y;
  const headZ = zOf(pose.head);
  lm[0] = { x: 0, y: headY + 0.12, z: headZ - 0.15, visibility: 1 };
  return {
    ...pose,
    landmarks: lm,
    segments,
    view: 'front',
    depth: true,                                  // points carry z → drawn in a 3/4 view
    feet,
    yaw: view.yaw ?? 0,
    yawOut: view.out ?? 1,
    neck: { x: 0, y: sh - 0.05, z: zOf(pose.neck) },
    head: { x: 0, y: headY, z: headZ, r: pose.head.r },
    torso: {
      ls: pt(P.LEFT_SHOULDER), rs: pt(P.RIGHT_SHOULDER), lh: pt(P.LEFT_HIP), rh: pt(P.RIGHT_HIP),
      lw: { x: B.waistX, y: waistY, z: waistZ }, rw: { x: -B.waistX, y: waistY, z: waistZ },
    },
  };
}

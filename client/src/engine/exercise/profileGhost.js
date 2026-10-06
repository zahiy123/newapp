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

const smooth = (x) => x * x * (3 - 2 * x);

/** Cyclic keyframe interpolation (smoothstep between keyframes; the last wraps to the first). */
function keyframeAngles(keyframes, u) {
  const n = keyframes.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (keyframes[k].t <= u) i = k;
  const a = keyframes[i];
  const b = keyframes[(i + 1) % n];
  const tb = i === n - 1 ? b.t + 1 : b.t;
  const ta = a.t > u ? a.t - 1 : a.t;
  const x = tb > ta ? smooth(Math.min(1, Math.max(0, (u - ta) / (tb - ta)))) : 0;
  const out = {};
  for (const k of Object.keys(a.a)) out[k] = a.a[k] + ((b.a[k] ?? a.a[k]) - a.a[k]) * x;
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
  return profile.posture === 'standing' ? toFront(sidePose) : sidePose;
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
function toFront(pose) {
  // the figure stands where its hips are (the side view's forward offset is depth now)
  const hipX = (pose.landmarks[P.LEFT_HIP].x + pose.landmarks[P.RIGHT_HIP].x) / 2;
  const lm = pose.landmarks.map((p, i) => (p.visibility
    ? { x: LATERAL[i] ?? 0, y: p.y, z: -(p.x - hipX), visibility: 1 }
    : p));
  const pt = (i) => ({ x: lm[i].x, y: lm[i].y });
  const segments = pose.segments.map((sg) => {
    const idx = SEG_POINTS[sg.limb]?.[sg.part];
    return idx ? { ...sg, from: pt(idx[0]), to: pt(idx[1]) } : sg;
  });
  const sh = (lm[P.LEFT_SHOULDER].y + lm[P.RIGHT_SHOULDER].y) / 2;
  const hp = (lm[P.LEFT_HIP].y + lm[P.RIGHT_HIP].y) / 2;
  const waistY = hp + (sh - hp) * 0.4;
  const headY = pose.head.y;
  lm[0] = { x: 0, y: headY + 0.12, z: -0.15, visibility: 1 };
  return {
    ...pose,
    landmarks: lm,
    segments,
    view: 'front',
    neck: { x: 0, y: sh - 0.05 },
    head: { x: 0, y: headY, r: pose.head.r },
    torso: {
      ls: pt(P.LEFT_SHOULDER), rs: pt(P.RIGHT_SHOULDER), lh: pt(P.LEFT_HIP), rh: pt(P.RIGHT_HIP),
      lw: { x: B.waistX, y: waistY }, rw: { x: -B.waistX, y: waistY },
    },
  };
}

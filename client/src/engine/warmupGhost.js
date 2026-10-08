// ============================================================
// warmupGhost — animated demo figure for the warm-up (Stage 2.3, basic Ghost)
//
// PURE pose math (ghostPose) + a small canvas drawer (drawWarmupGhost).
//
// The figure faces the camera like the trainee, drawn in RAW image coordinates
// (the canvas is CSS-mirrored together with the video): the figure's LEFT limbs
// are at +x, exactly like MediaPipe's LEFT_* landmarks of the trainee.
//
// Iron Rule: limbs that are absent / not trainable (limbProfile) are NOT drawn;
// a below-knee prosthesis is drawn as a dashed, non-animated shank. Arm angles
// are capped at the range measured in the scan (romCapDeg).
// Animation is time-based (ms), so the speed is the same on every screen.
// ============================================================

import { GHOST_BODY } from './ghostBody.js';
import { profileGhostPose } from './exercise/profileGhost.js';

const PERIOD_MS = 1600;
// Elbow flex range during arm circles (makes the hand path elliptical → direction visible)
const CIRCLE_BEND_DEG = 30;
// Motion trail: how far back (ms of animation time) the faded hand trail reaches
const TRAIL_MS = 420;
const TRAIL_STEPS = 7;

/** Animation period: an exercise profile sets its own tempo. */
export function periodOf(spec) {
  return spec?.profile?.ghost?.periodMs || PERIOD_MS;
}

/** Directional moves animate in reverse when spec.direction === 'backward'. */
export function directionSign(spec) {
  return spec?.direction === 'backward' ? -1 : 1;
}

/** Animation phase 0..1 for an animation time in ms (may be negative when running backward). */
export function phaseOf(animMs, period = PERIOD_MS) {
  const t = (animMs % period) / period;
  return t < 0 ? t + 1 : t;
}

// Body model in "body units" (hip center = origin, y grows downward) — shared with the profile Ghost
const B = GHOST_BODY;

const deg = (d) => (d * Math.PI) / 180;

/** Point at angle (0 = straight down, 90 = sideways outward, 180 = up) from origin. */
function limbPoint(origin, angleDeg, length, outward) {
  const a = deg(angleDeg);
  return { x: origin.x + outward * Math.sin(a) * length, y: origin.y + Math.cos(a) * length };
}

function canDraw(limb) {
  return limb && limb.trainable !== false && limb.state !== 'absent';
}

/**
 * Pose of the demo figure for a warm-up move at phase t (0..1).
 * @param {{ move: string, side?: 'left'|'right'|null, romCapDeg?: number|null, small?: boolean }} spec
 * @param {number} t - animation phase 0..1
 * @param {Object} lp - limbProfile (getLimbProfile)
 * @returns {{ segments: Array<{ from, to, dashed?: boolean, limb: string }>, head: { x, y, r } }}
 */
export function ghostPose(spec, t, lp = {}) {
  // Stage 3.1: an exercise Ghost is generated from its Expert Execution Profile
  if (spec?.profile?.ghost) {
    const pp = profileGhostPose(spec.profile, t, lp);
    if (pp) return pp;
  }
  const wave = Math.sin(2 * Math.PI * t);          // -1..1
  const up = (1 - Math.cos(2 * Math.PI * t)) / 2;  // 0..1..0
  const cap = typeof spec?.romCapDeg === 'number' ? spec.romCapDeg : 180;
  const clampArm = (a) => Math.min(a, cap);

  let shiftX = 0;
  let twist = 0;
  if (spec?.move === 'side_steps') shiftX = 0.25 * wave;
  if (spec?.move === 'twist') twist = wave;

  const shoulderSpread = B.shoulderX * (1 - 0.35 * Math.abs(twist));
  const L = { shoulder: { x: shiftX + shoulderSpread + 0.08 * twist, y: B.shoulderY }, hip: { x: shiftX + B.hipX, y: 0 } };
  const R = { shoulder: { x: shiftX - shoulderSpread + 0.08 * twist, y: B.shoulderY }, hip: { x: shiftX - B.hipX, y: 0 } };
  const neck = { x: shiftX + 0.08 * twist, y: B.shoulderY - 0.05 };

  // ---- Arm angles (shoulder angle from hanging; elbow bend) ----
  const arm = { left: { a: 8, bend: 0 }, right: { a: 8, bend: 0 } };
  switch (spec?.move) {
    case 'arm_circles':
      arm.left.a = arm.right.a = typeof spec.targetDeg === 'number'
        ? clampArm(spec.targetDeg - 25 + 25 * wave)   // range challenge: peak exactly at the target
        : clampArm(85 + 25 * wave);
      // The elbow flexes a little out of phase → the hand traces an ELLIPSE, so the rotation
      // direction is visible (time running backward = the opposite rotation)
      arm.left.bend = arm.right.bend = CIRCLE_BEND_DEG * (1 + Math.cos(2 * Math.PI * t)) / 2;
      break;
    case 'single_arm_circle': {
      const s = spec.side || 'right';
      arm[s].a = typeof spec.targetDeg === 'number'
        ? clampArm(spec.targetDeg - 45 + 45 * wave)
        : clampArm(80 + 45 * wave);
      arm[s].bend = CIRCLE_BEND_DEG * (1 + Math.cos(2 * Math.PI * t)) / 2;
      break;
    }
    case 'punches':
      arm.left.a = clampArm(20 + 60 * Math.max(0, wave)); arm.left.bend = 90 * (1 - Math.max(0, wave));
      arm.right.a = clampArm(20 + 60 * Math.max(0, -wave)); arm.right.bend = 90 * (1 - Math.max(0, -wave));
      break;
    case 'chest_pass':
      arm.left.a = arm.right.a = clampArm(30 + 50 * up);
      arm.left.bend = arm.right.bend = 100 * (1 - up);
      break;
    case 'twist':
      arm.left.a = arm.right.a = clampArm(70);
      arm.left.bend = arm.right.bend = 110;
      break;
    default:
      break;
  }

  // ---- Leg lift (0 = standing) ----
  const lift = { left: 0, right: 0 };
  if (spec?.move === 'high_knees') { lift.left = Math.max(0, wave); lift.right = Math.max(0, -wave); }
  if (spec?.move === 'single_knee' && spec.side) lift[spec.side] = up;
  if (spec?.move === 'kick') {
    const amount = spec.small ? 0.35 : 1;
    if (spec.side) lift[spec.side] = up * amount;
    else { lift.left = Math.max(0, wave) * amount; lift.right = Math.max(0, -wave) * amount; }
  }
  if (spec?.move === 'side_steps') { lift.left = 0.15 * Math.max(0, wave); lift.right = 0.15 * Math.max(0, -wave); }

  const segments = [];
  const add = (from, to, limb, dashed = false, part = null) => segments.push({ from, to, limb, dashed, part });

  // Torso + head (always)
  const hipMid = { x: shiftX, y: 0 };
  add(neck, hipMid, 'torso', false, 'spine');
  add(L.shoulder, R.shoulder, 'torso', false, 'shoulders');
  add(L.hip, R.hip, 'torso', false, 'hips');

  // Arms
  for (const side of ['left', 'right']) {
    const key = `${side}_arm`;
    if (!canDraw(lp[key])) continue;          // Iron Rule: absent / not trainable → not drawn
    const S = side === 'left' ? L : R;
    const out = side === 'left' ? 1 : -1;
    const elbow = limbPoint(S.shoulder, arm[side].a, B.upperArm, out);
    const wrist = limbPoint(elbow, arm[side].a + arm[side].bend, B.forearm, out);
    add(S.shoulder, elbow, key, false, 'upperArm');
    add(elbow, wrist, key, false, 'forearm');
  }

  // Legs
  for (const side of ['left', 'right']) {
    const key = `${side}_leg`;
    const limb = lp[key] || { trainable: true, state: 'ok' };
    if (limb.state === 'absent' || (limb.state === 'prosthetic' && limb.level !== 'below_knee')) continue;
    const S = side === 'left' ? L : R;
    const isProsthetic = limb.state === 'prosthetic';
    const l = isProsthetic ? 0 : lift[side];       // the prosthetic side is the stable support
    // Knee raise: thigh rotates forward → in a frontal view the knee rises
    const out = side === 'left' ? 1 : -1;
    const kicking = spec?.move === 'kick';
    const knee = { x: S.hip.x + (kicking ? out * 0.04 * l : 0), y: S.hip.y + B.thigh * Math.cos(deg((kicking ? 55 : 85) * l)) };
    const ankle = kicking
      ? { x: knee.x + out * 0.1 * l, y: knee.y + B.shin * (1 - 0.85 * l) }   // shin swings forward (foreshortened)
      : { x: S.hip.x, y: knee.y + B.shin * (1 - 0.55 * l) };
    add(S.hip, knee, key, false, 'thigh');
    add(knee, ankle, key, isProsthetic, 'shin');   // prosthetic shank: drawn as a pylon, not animated
  }

  return {
    segments,
    head: { x: neck.x, y: B.headY, r: B.headR },
    neck,
    torso: {
      ls: L.shoulder, rs: R.shoulder, lh: L.hip, rh: R.hip,
      lw: { x: shiftX + B.waistX * (1 - 0.2 * Math.abs(twist)) + 0.05 * twist, y: B.waistY },
      rw: { x: shiftX - B.waistX * (1 - 0.2 * Math.abs(twist)) + 0.05 * twist, y: B.waistY },
    },
  };
}

// ---- Figure drawing: a professional coach silhouette ----
// Tapered limbs with a crisp outline, a jersey torso, shorts, boots; in a 3/4 view for profile
// Ghosts with depth (the far limbs behind the body and a shade darker, the near ones in front).

// Limb widths in body units at the proximal / distal end (natural, athletic proportions)
const TAPER = {
  thigh: [0.30, 0.2], shin: [0.2, 0.12], upperArm: [0.19, 0.14], forearm: [0.145, 0.105],
};
const FLOOR_ANKLE_Y = B.thigh + B.shin;           // ankle height when standing (hip center = 0)

const PALETTE = {
  skin: ['#f0f9ff', '#7dd3fc'],                   // limbs: light → sky
  jersey: ['#38bdf8', '#0284c7'],                 // torso
  shorts: '#1e3a8a',
  boot: '#0f172a',
  outline: 'rgba(8, 47, 73, 0.75)',
  far: 'rgba(8, 47, 73, 0.28)',                   // shade over the far-side limbs
};

/** Body → view-plane projection: a 3/4 turn (yaw about the vertical axis) when the pose has depth. */
export function figureProjection(pose) {
  const yaw = pose?.depth && pose.yaw ? (pose.yaw * Math.PI) / 180 : 0;
  const out = pose?.yawOut ?? 1;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  if (!yaw) return { proj: (p) => ({ x: p.x, y: p.y }), depthOf: () => 0, yaw: 0 };
  // forward (toward the camera) = -z; it turns toward `out` on the screen
  return {
    proj: (p) => ({ x: p.x * c + out * -(p.z ?? 0) * s, y: p.y }),
    depthOf: (p) => -(p.z ?? 0) * c - out * p.x * s,          // larger = nearer to the viewer
    yaw,
  };
}

/** A tapered limb: a quad from width w1 at a to w2 at b, closed with round ends. */
function taperPath(ctx, a, b, w1, w2) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1e-6;
  const nx = -dy / L, ny = dx / L;
  ctx.beginPath();
  ctx.moveTo(a.x + nx * w1 / 2, a.y + ny * w1 / 2);
  ctx.lineTo(b.x + nx * w2 / 2, b.y + ny * w2 / 2);
  ctx.arc(b.x, b.y, w2 / 2, Math.atan2(ny, nx), Math.atan2(-ny, -nx));
  ctx.lineTo(a.x - nx * w1 / 2, a.y - ny * w1 / 2);
  ctx.arc(a.x, a.y, w1 / 2, Math.atan2(-ny, -nx), Math.atan2(ny, nx));
  ctx.closePath();
}

/**
 * Draw the Ghost figure with a mapping P0(viewPoint) → canvas point.
 * Shared by the demo panel and the full-size overlay.
 * @private
 */
export function drawFigure(ctx, pose, P0, scale, { floorShadow = true, glow = true, look = null } = {}) {
  // `look`: a character (the virtual coach) instead of the Ghost — its palette, tracksuit pants,
  // sleeves, hair / face / whistle drawn by the look's own hooks
  const pal = look ? { ...PALETTE, ...look.palette } : PALETTE;
  const fillFor = (part, skinFill) => (look?.pants && (part === 'thigh' || part === 'shin') ? pal.pants
    : look?.sleeves && part === 'upperArm' ? pal.jersey[1] : skinFill);
  const { proj, depthOf, yaw } = figureProjection(pose);
  const P = (p) => P0(proj(p));
  const ow = Math.max(1, scale * 0.022);          // outline width
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (floorShadow) {
    const feet = P0({ x: 0, y: pose.floorY ?? FLOOR_ANKLE_Y + 0.05 });
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(feet.x, feet.y, 0.55 * scale, 0.09 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const top = P0({ x: 0, y: B.headY - B.headR }).y;
  const bottom = P0({ x: 0, y: FLOOR_ANKLE_Y }).y;
  const skin = ctx.createLinearGradient(0, top, 0, bottom);
  skin.addColorStop(0, pal.skin[0]);
  skin.addColorStop(1, pal.skin[1]);
  const glowOn = () => {
    if (!glow) return;
    ctx.shadowColor = 'rgba(56, 189, 248, 0.5)';
    ctx.shadowBlur = Math.max(4, scale * 0.16);
  };
  const glowOff = () => { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; };

  // ---- one limb segment (+ boot / hand) ----
  const drawLimb = (seg, far) => {
    const a = P(seg.from), b = P(seg.to);
    if (seg.dashed) {
      // Below-knee prosthesis: socket under the knee + slim pylon + foot, static
      const socketEnd = { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 };
      taperPath(ctx, a, b, 0.075 * scale, 0.06 * scale);
      ctx.fillStyle = '#cbd5e1'; ctx.fill();
      ctx.lineWidth = ow; ctx.strokeStyle = pal.outline; ctx.stroke();
      taperPath(ctx, a, socketEnd, 0.22 * scale, 0.17 * scale);
      ctx.fillStyle = '#94a3b8'; ctx.fill(); ctx.stroke();
    } else {
      const [w1, w2] = TAPER[seg.part] || [0.15, 0.12];
      taperPath(ctx, a, b, w1 * scale, w2 * scale);
      ctx.fillStyle = fillFor(seg.part, skin);
      glowOn(); ctx.fill(); glowOff();
      ctx.lineWidth = ow; ctx.strokeStyle = pal.outline; ctx.stroke();
      if (look?.pants && (seg.part === 'thigh' || seg.part === 'shin') && pal.stripe) {
        // the tracksuit's side stripe
        ctx.strokeStyle = pal.stripe; ctx.lineWidth = Math.max(1, scale * 0.025);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      // shorts over the upper thigh
      if (seg.part === 'thigh' && !look?.pants) {
        const end = { x: a.x + (b.x - a.x) * 0.42, y: a.y + (b.y - a.y) * 0.42 };
        taperPath(ctx, a, end, w1 * scale * 1.08, (w1 * 0.6 + w2 * 0.4) * scale * 1.08);
        ctx.fillStyle = pal.shorts; ctx.fill(); ctx.stroke();
      }
      if (far) { taperPath(ctx, a, b, w1 * scale, w2 * scale); ctx.fillStyle = pal.far; ctx.fill(); }
    }
    const side = seg.limb === 'left_leg' ? 'left' : seg.limb === 'right_leg' ? 'right' : null;
    const foot = seg.part === 'shin' && side ? pose.feet?.[side] : null;
    if (foot) {
      drawBoot(foot, seg.dashed);
    } else if (seg.part === 'shin') {
      // boot: along the foot (forward in depth shows on the screen in the 3/4 view)
      const toe = P({ x: seg.to.x, y: seg.to.y + 0.04, z: (seg.to.z ?? 0) - 0.2 });
      const ang = yaw ? Math.atan2(toe.y - b.y, toe.x - b.x) : 0;
      const len = yaw ? Math.max(0.12 * scale, Math.hypot(toe.x - b.x, toe.y - b.y) * 0.75) : 0.15 * scale;
      const bx = yaw ? (b.x + toe.x) / 2 : b.x;
      const by = (yaw ? (b.y + toe.y) / 2 : b.y) + 0.02 * scale;
      ctx.beginPath();
      ctx.ellipse(bx, by, len, 0.065 * scale, ang, 0, Math.PI * 2);
      ctx.fillStyle = seg.dashed ? '#cbd5e1' : pal.boot;
      ctx.fill();
      ctx.lineWidth = ow; ctx.strokeStyle = 'rgba(148, 163, 184, 0.9)'; ctx.stroke();
    }
    if (seg.part === 'forearm') {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 0.085 * scale, 0, Math.PI * 2);
      ctx.fillStyle = pal.skin[0]; ctx.fill();
      ctx.lineWidth = ow; ctx.strokeStyle = pal.outline; ctx.stroke();
    }
  };

  // ---- a boot from the heel to the toe; the striking surface (laces / inside) glows ----
  function drawBoot(foot, prosthetic) {
    const h = P(foot.heel), tt = P(foot.toe);
    const minLen = 0.11 * scale;
    let toe = tt;
    const len = Math.hypot(tt.x - h.x, tt.y - h.y);
    if (len < minLen) {
      // pointing at the viewer: foreshortened, but still a visible boot
      const k = minLen / Math.max(len, 1e-6);
      toe = len < 1e-6 ? { x: h.x + minLen, y: h.y } : { x: h.x + (tt.x - h.x) * k, y: h.y + (tt.y - h.y) * k };
    }
    taperPath(ctx, h, toe, 0.15 * scale, 0.1 * scale);
    ctx.fillStyle = prosthetic ? '#cbd5e1' : pal.boot;
    ctx.fill();
    ctx.lineWidth = ow; ctx.strokeStyle = 'rgba(148, 163, 184, 0.9)'; ctx.stroke();
  }

  // ---- torso: a jersey, tapered shoulders → waist → hips ----
  const drawTorso = () => {
    const { ls, rs, lh, rh, lw, rw } = pose.torso;
    const T = [P(ls), P(rs), P(rw), P(rh), P(lh), P(lw)];
    const jersey = ctx.createLinearGradient(0, Math.min(T[0].y, T[1].y), 0, Math.max(T[3].y, T[4].y) + 1);
    jersey.addColorStop(0, pal.jersey[0]);
    jersey.addColorStop(1, pal.jersey[1]);
    ctx.beginPath();
    ctx.moveTo(T[0].x, T[0].y);
    for (let i = 1; i < T.length; i++) ctx.lineTo(T[i].x, T[i].y);
    ctx.closePath();
    ctx.fillStyle = jersey;
    ctx.strokeStyle = jersey;
    ctx.lineWidth = 0.16 * scale;                 // rounds the corners
    glowOn(); ctx.fill(); ctx.stroke(); glowOff();
    // waistband of the shorts
    const hl = P(lh), hr = P(rh);
    ctx.lineWidth = 0.12 * scale;
    ctx.strokeStyle = pal.shorts;
    ctx.beginPath(); ctx.moveTo(hl.x, hl.y); ctx.lineTo(hr.x, hr.y); ctx.stroke();
    // shoulder caps (sleeves) so the arm joins the jersey
    for (const sp of [T[0], T[1]]) {
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 0.11 * scale, 0, Math.PI * 2);
      ctx.fillStyle = pal.jersey[0]; ctx.fill();
    }
    look?.torsoExtras?.(ctx, { ls: T[0], rs: T[1], lh: hl, rh: hr, neck: P(pose.neck) }, scale);
  };

  const drawHead = () => {
    const n = P(pose.neck);
    const h = P(pose.head);
    taperPath(ctx, n, { x: h.x, y: h.y + pose.head.r * scale * 0.7 }, 0.15 * scale, 0.12 * scale);
    ctx.fillStyle = skin; ctx.fill();
    const rx = pose.head.r * scale * 0.95, ry = pose.head.r * scale * 1.12;
    look?.head?.(ctx, h, rx, ry, 'behind', yaw ? (pose.yawOut ?? 1) : 0);
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = pal.skin[0];
    glowOn(); ctx.fill(); glowOff();
    ctx.lineWidth = ow; ctx.strokeStyle = pal.outline; ctx.stroke();
    look?.head?.(ctx, h, rx, ry, 'front', yaw ? (pose.yawOut ?? 1) : 0);
  };

  // ---- depth order: far limbs → torso → head → near limbs (no depth: legs, torso, arms, head) ----
  const limbs = pose.segments.filter(sg => TAPER[sg.part]);
  if (yaw) {
    const tz = depthOf({ x: 0, y: 0, z: pose.torso.lh.z ?? 0 });
    const d = (sg) => (depthOf(sg.from) + depthOf(sg.to)) / 2;
    const sorted = limbs.map(sg => ({ sg, d: d(sg) })).sort((a, b) => a.d - b.d);
    for (const { sg, d: dd } of sorted) if (dd < tz) drawLimb(sg, true);
    drawTorso();
    drawHead();
    for (const { sg, d: dd } of sorted) if (dd >= tz) drawLimb(sg, false);
  } else {
    for (const sg of limbs.filter(x => x.part === 'thigh' || x.part === 'shin')) drawLimb(sg, false);
    drawTorso();
    for (const sg of limbs.filter(x => x.part === 'upperArm' || x.part === 'forearm')) drawLimb(sg, false);
    drawHead();
  }
  ctx.restore();
}

// ---- Shadow ball (owner): in a shadow kick / pass (no real ball) a ball leaves the Ghost's foot ----
const BALL_R = 0.22;                              // body units (a size-5 ball next to a ~1.75 m body)
const CONTACT_T = 0.5;                            // the kick profiles strike at mid-cycle
const FLIGHT_T = 0.36;                            // share of the cycle the ball is in flight

/**
 * The shadow ball at phase t: resting in front of the kicking foot, struck at contact, then
 * flying toward the camera (kick: in an arc; pass: rolling low) while it grows and fades.
 * @returns {{ x, y, z, r, alpha, spin, floorY } | null} - body units (x, y, z like the pose)
 */
export function shadowBallAt(spec, t, lp = {}) {
  const kind = spec?.ball;
  if (!kind || !spec?.profile?.ghost) return null;
  const contactT = spec.profile.ghost.contactT ?? CONTACT_T;
  const contact = profileGhostPose(spec.profile, contactT, lp);
  if (!contact?.landmarks) return null;
  const floor = FLOOR_ANKLE_Y + 0.06;
  // the ball sits exactly where the striking surface (laces / inside of the foot) meets it
  const foot = Object.values(contact.feet || {}).find(f => f.patch);
  let rest;
  if (foot) {
    rest = { x: foot.patch.x + foot.normal.x * BALL_R * 0.95, y: floor - BALL_R, z: foot.patch.z + foot.normal.z * BALL_R * 0.95 };
  } else {
    // the kicking foot = the ankle furthest forward at contact
    const ank = [contact.landmarks[27], contact.landmarks[28]].filter(a => a?.visibility)
      .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))[0];
    if (!ank) return null;
    rest = { x: ank.x, y: floor - BALL_R, z: (ank.z ?? 0) - 0.12 };
  }
  const tc = ((t % 1) + 1) % 1;
  const appear = Math.min(1, tc / 0.12);           // fades in at the start of the cycle
  if (tc < contactT) return { ...rest, r: BALL_R, alpha: appear, spin: 0, floorY: floor };
  const u = (tc - contactT) / FLIGHT_T;
  if (u >= 1) return null;
  const travel = kind === 'pass' ? 2.6 : 3.4;
  const lift = kind === 'pass' ? 0 : Math.sin(Math.PI * Math.min(1, u * 1.1)) * 1.3;
  return {
    x: rest.x,
    y: rest.y - lift,
    z: rest.z - travel * u,                        // toward the camera
    r: BALL_R * (1 + 1.1 * u),                     // perspective: it grows as it comes closer
    alpha: 1 - u * u,
    spin: u * (kind === 'pass' ? 9 : 14),
    floorY: floor,
  };
}

/**
 * The STRIKING SURFACE of a kick / pass (laces / inside of the foot): an amber patch on the boot,
 * with a burst ring at the moment of contact. Drawn LAST (over the ball) so the trainee always
 * sees exactly which part of the foot meets the ball.
 */
export function drawStrikeSurface(ctx, pose, P0, scale, lite = false) {
  const feet = Object.values(pose?.feet || {}).filter(f => f.patch);
  if (!feet.length) return;
  const { proj } = figureProjection(pose);
  const P = (p) => P0(proj(p));
  for (const foot of feet) {
    const p = P(foot.patch);
    const h = P(foot.heel), toe = P(foot.toe);
    const ang = Math.atan2(toe.y - h.y, toe.x - h.x);
    const r = 0.08 * scale;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, foot.glow);
    ctx.shadowColor = 'rgba(251, 191, 36, 0.95)';
    ctx.shadowBlur = lite ? 0 : Math.max(4, scale * 0.14 * foot.glow);
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = 'rgba(120, 53, 15, 0.85)';
    ctx.lineWidth = Math.max(1, scale * 0.015);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * 1.5, r * 0.8, ang, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();
    if (foot.contact > 0.12) {
      ctx.save();
      ctx.globalAlpha *= foot.contact;
      ctx.strokeStyle = 'rgba(253, 230, 138, 0.95)';
      ctx.lineWidth = Math.max(1.5, scale * 0.028);
      for (const k of [1, 1.7]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * k * (1.4 + 1.8 * (1 - foot.contact)), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/** Draw the shadow ball (+ its shadow on the floor) with the figure's projection. */
export function drawShadowBall(ctx, ball, pose, P0, scale, lite = false) {
  if (!ball || !(ball.alpha > 0.02)) return;
  const { proj } = figureProjection(pose);
  const c = P0(proj(ball));
  const g = P0(proj({ ...ball, y: ball.floorY }));
  const r = ball.r * scale;
  const height = Math.max(0, ball.floorY - (ball.y + ball.r));
  ctx.save();
  // shadow on the floor: smaller and lighter the higher the ball
  ctx.globalAlpha *= ball.alpha * Math.max(0.25, 0.6 - height * 0.25);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  ctx.ellipse(g.x, g.y, r * Math.max(0.5, 1 - height * 0.3), r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha *= ball.alpha * 0.92;
  ctx.shadowColor = 'rgba(186, 230, 253, 0.9)';
  ctx.shadowBlur = lite ? 0 : Math.max(4, r * 0.6);
  const body = ctx.createRadialGradient(c.x - r * 0.35, c.y - r * 0.35, r * 0.1, c.x, c.y, r);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(1, '#bae6fd');
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // classic panels: a centre pentagon + five around it, spinning in flight
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  const penta = (cx, cy, rr, rot) => {
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = rot + (k * 2 * Math.PI) / 5 - Math.PI / 2;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  };
  ctx.save();
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.clip();
  penta(c.x, c.y, r * 0.32, ball.spin);
  for (let k = 0; k < 5; k++) {
    const a = ball.spin + (k * 2 * Math.PI) / 5 - Math.PI / 2;
    penta(c.x + Math.cos(a) * r * 0.86, c.y + Math.sin(a) * r * 0.86, r * 0.3, ball.spin + Math.PI / 5);
  }
  ctx.restore();
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.strokeStyle = 'rgba(8, 47, 73, 0.6)';
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/**
 * Hand positions over the last TRAIL_MS of animation time (oldest → newest), per moving arm.
 * Exported for tests: the trail shows which way the hand is travelling.
 */
export function handTrail(spec, lp, nowMs) {
  const sign = directionSign(spec);
  const trails = {};
  for (let k = TRAIL_STEPS; k >= 0; k--) {
    const ms = nowMs - sign * (k * TRAIL_MS) / TRAIL_STEPS;   // "the past" in animation time
    const pose = ghostPose(spec, phaseOf(ms), lp);
    for (const seg of pose.segments) {
      if (seg.part !== 'forearm') continue;
      (trails[seg.limb] || (trails[seg.limb] = [])).push(seg.to);
    }
  }
  return trails;
}

/** Faded trail + arrowhead at the hand: shows the circle's direction (forward / backward). */
function drawMotionTrail(ctx, spec, lp, nowMs, P, scale) {
  const trails = handTrail(spec, lp, nowMs);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pts of Object.values(trails)) {
    if (pts.length < 3) continue;
    const q = pts.map(P);
    for (let i = 1; i < q.length; i++) {
      ctx.strokeStyle = `rgba(250, 204, 21, ${(0.15 + 0.75 * i / (q.length - 1)).toFixed(2)})`;   // amber, fading
      ctx.lineWidth = Math.max(2, scale * 0.06);
      ctx.beginPath();
      ctx.moveTo(q[i - 1].x, q[i - 1].y);
      ctx.lineTo(q[i].x, q[i].y);
      ctx.stroke();
    }
    // Arrowhead at the newest point, pointing along the motion
    const a = q[q.length - 2], b = q[q.length - 1];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const L = Math.max(8, scale * 0.16);
    ctx.fillStyle = 'rgba(250, 204, 21, 0.95)';
    ctx.beginPath();
    ctx.moveTo(b.x + Math.cos(ang) * L, b.y + Math.sin(ang) * L);
    ctx.lineTo(b.x + Math.cos(ang + 2.5) * L, b.y + Math.sin(ang + 2.5) * L);
    ctx.lineTo(b.x + Math.cos(ang - 2.5) * L, b.y + Math.sin(ang - 2.5) * L);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw the Ghost as a soft, filled silhouette in a panel
 * (raw coordinates; the canvas is mirrored on screen, so no text is drawn here).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} spec - exercise.ghost (+ optional targetDeg for the range challenge)
 * @param {Object} lp - limbProfile
 * @param {number} nowMs - performance.now()
 * @param {number} w / h - canvas size
 * @param {{ fill?: boolean }} [opts] - fill: the panel fills the whole canvas (dedicated ghost canvas)
 */
export function drawWarmupGhost(ctx, spec, lp, nowMs, w, h, opts = {}) {
  if (!spec) return;
  const t = phaseOf(nowMs, periodOf(spec));
  const pose = ghostPose(spec, t, lp);

  const panelH = opts.fill ? h : h * 0.42;
  const panelW = opts.fill ? w : panelH * 0.72;
  const margin = opts.fill ? 0 : h * 0.03;
  const px = margin;                // raw top-left → appears top-right on the mirrored screen
  const py = margin;
  const scale = Math.min(panelH / 4.5, panelW / 3.7);
  const ox = px + panelW / 2;
  const oy = py + panelH * 0.5;
  const P = (p) => ({ x: ox + p.x * scale, y: oy + p.y * scale });

  const ball = shadowBallAt(spec, t, lp);
  if (opts.bare) {
    // Large mode: no dark box — a glowing, slightly transparent figure that never hides the trainee
    ctx.save();
    ctx.globalAlpha = 0.85;
    drawFigure(ctx, pose, P, scale, { floorShadow: true, glow: true });
    drawShadowBall(ctx, ball, pose, P, scale);
    drawStrikeSurface(ctx, pose, P, scale);
    ctx.restore();
    return;
  }
  ctx.save();
  // Panel: rounded, soft dark gradient with a light border
  const bg = ctx.createLinearGradient(px, py, px, py + panelH);
  bg.addColorStop(0, 'rgba(15, 23, 42, 0.62)');
  bg.addColorStop(1, 'rgba(30, 41, 59, 0.48)');
  ctx.fillStyle = bg;
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const radius = Math.min(16, panelW * 0.12);
  if (ctx.roundRect) ctx.roundRect(px + 1, py + 1, panelW - 2, panelH - 2, radius); else ctx.rect(px, py, panelW, panelH);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  drawFigure(ctx, pose, P, scale);
  drawShadowBall(ctx, ball, pose, P, scale);
  drawStrikeSurface(ctx, pose, P, scale);
  if (spec.directional) drawMotionTrail(ctx, spec, lp, nowMs, P, scale);
}

/**
 * Draw the Ghost FULL-SIZE and semi-transparent on the trainee's body (overlay canvas).
 * @param {{x,y}} origin - canvas point of the trainee's hip center
 * @param {number} scale - canvas px per Ghost body unit (from the trainee's torso length)
 * @param {number} [alpha=0.42] - transparency so the trainee stays visible through the Ghost
 * @param {number|null} [feetY] - canvas y of the trainee's feet (ankles) when seen
 */
export function drawGhostOverlay(ctx, spec, lp, nowMs, origin, scale, alpha = 0.55, feetY = null) {
  if (!spec || !origin || !(scale > 0)) return;
  const t = phaseOf(nowMs, periodOf(spec));
  const pose = ghostPose(spec, t, lp);
  const lying = pose.landmarks && !pose.depth && pose.view !== 'front' && spec.profile?.posture !== 'standing';
  let P;
  if (!lying && typeof feetY === 'number') {
    // Standing: the Ghost STANDS where the trainee stands — its feet on the trainee's feet, so it
    // never bobs up and down with the trainee's hips (steady, like a real demonstrator)
    P = (p) => ({ x: origin.x + p.x * scale, y: feetY + (p.y - FLOOR_ANKLE_Y) * scale });
  } else {
    // Lying down (or feet not seen): the Ghost's hips sit on the trainee's hips
    let hx = 0, hy = 0;
    const lh = pose.landmarks?.[23], rh = pose.landmarks?.[24];
    if (lh?.visibility && rh?.visibility) { hx = (lh.x + rh.x) / 2; hy = (lh.y + rh.y) / 2; }
    P = (p) => ({ x: origin.x + (p.x - hx) * scale, y: origin.y + (p.y - hy) * scale });
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  // Full-screen on a phone: NO blur (a canvas blur per body part at this size cost ~40 ms a frame
  // and starved the pose detection — the big Ghost seemed not to load / froze)
  drawFigure(ctx, pose, P, scale, { floorShadow: false, glow: false });
  drawShadowBall(ctx, shadowBallAt(spec, t, lp), pose, P, scale, true);
  drawStrikeSurface(ctx, pose, P, scale, true);
  ctx.restore();
  if (spec.directional) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha + 0.35);
    drawMotionTrail(ctx, spec, lp, nowMs, P, scale);
    ctx.restore();
  }
}

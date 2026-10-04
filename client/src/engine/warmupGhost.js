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

const PERIOD_MS = 1600;

// Body model in "body units" (hip center = origin, y grows downward)
const B = {
  shoulderY: -1.4, shoulderX: 0.34, hipX: 0.17,
  upperArm: 0.6, forearm: 0.55, thigh: 0.9, shin: 0.88,
  headY: -1.78, headR: 0.2,
};

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
      arm.left.a = arm.right.a = clampArm(85 + 25 * wave);
      break;
    case 'single_arm_circle': {
      const s = spec.side || 'right';
      arm[s].a = clampArm(80 + 45 * wave);
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
  const add = (from, to, limb, dashed = false) => segments.push({ from, to, limb, dashed });

  // Torso + head (always)
  const hipMid = { x: shiftX, y: 0 };
  add(neck, hipMid, 'torso');
  add(L.shoulder, R.shoulder, 'torso');
  add(L.hip, R.hip, 'torso');

  // Arms
  for (const side of ['left', 'right']) {
    const key = `${side}_arm`;
    if (!canDraw(lp[key])) continue;          // Iron Rule: absent / not trainable → not drawn
    const S = side === 'left' ? L : R;
    const out = side === 'left' ? 1 : -1;
    const elbow = limbPoint(S.shoulder, arm[side].a, B.upperArm, out);
    const wrist = limbPoint(elbow, arm[side].a + arm[side].bend, B.forearm, out);
    add(S.shoulder, elbow, key);
    add(elbow, wrist, key);
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
    const knee = { x: S.hip.x, y: S.hip.y + B.thigh * Math.cos(deg(85 * l)) };
    const ankle = { x: S.hip.x, y: knee.y + B.shin * (1 - 0.55 * l) };
    add(S.hip, knee, key);
    add(knee, ankle, key, isProsthetic);           // prosthetic shank: dashed, not animated
  }

  return { segments, head: { x: neck.x, y: B.headY, r: B.headR } };
}

/**
 * Draw the ghost in a corner panel of the pose canvas (raw coordinates; the canvas is mirrored on screen).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} spec - exercise.ghost
 * @param {Object} lp - limbProfile
 * @param {number} nowMs - performance.now()
 * @param {number} w / h - canvas size
 */
export function drawWarmupGhost(ctx, spec, lp, nowMs, w, h) {
  if (!spec) return;
  const t = (nowMs % PERIOD_MS) / PERIOD_MS;
  const pose = ghostPose(spec, t, lp);

  const panelH = h * 0.42;
  const panelW = panelH * 0.7;
  const margin = h * 0.03;
  const px = margin;                // raw top-left → appears top-right on the mirrored screen
  const py = margin;
  const scale = panelH / 4.2;
  const ox = px + panelW / 2;
  const oy = py + panelH * 0.52;
  const P = (p) => ({ x: ox + p.x * scale, y: oy + p.y * scale });

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(px, py, panelW, panelH, 12); else ctx.rect(px, py, panelW, panelH);
  ctx.fill();

  ctx.strokeStyle = '#7dd3fc';
  ctx.lineWidth = Math.max(3, scale * 0.12);
  ctx.lineCap = 'round';

  const head = P(pose.head);
  ctx.beginPath();
  ctx.arc(head.x, head.y, pose.head.r * scale, 0, Math.PI * 2);
  ctx.stroke();

  for (const seg of pose.segments) {
    const a = P(seg.from);
    const b = P(seg.to);
    ctx.setLineDash(seg.dashed ? [6, 6] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

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
  shoulderY: -1.4, shoulderX: 0.42, hipX: 0.21, waistY: -0.55, waistX: 0.27,
  upperArm: 0.6, forearm: 0.55, thigh: 0.9, shin: 0.88,
  headY: -1.8, headR: 0.22,
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

// Limb thickness in body units (natural proportions)
const THICK = { upperArm: 0.19, forearm: 0.15, thigh: 0.27, shin: 0.2, spine: 0, shoulders: 0, hips: 0 };

/**
 * Draw the ghost as a soft, filled silhouette in a corner panel of the pose canvas
 * (raw coordinates; the canvas is mirrored on screen, so no text is drawn here).
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
  const panelW = panelH * 0.72;
  const margin = h * 0.03;
  const px = margin;                // raw top-left → appears top-right on the mirrored screen
  const py = margin;
  const scale = panelH / 4.4;
  const ox = px + panelW / 2;
  const oy = py + panelH * 0.5;
  const P = (p) => ({ x: ox + p.x * scale, y: oy + p.y * scale });

  ctx.save();

  // Panel: rounded, soft dark gradient with a light border
  const bg = ctx.createLinearGradient(px, py, px, py + panelH);
  bg.addColorStop(0, 'rgba(15, 23, 42, 0.62)');
  bg.addColorStop(1, 'rgba(30, 41, 59, 0.48)');
  ctx.fillStyle = bg;
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(px, py, panelW, panelH, 16); else ctx.rect(px, py, panelW, panelH);
  ctx.fill();
  ctx.stroke();

  // Floor shadow under the feet
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(ox, oy + (B.thigh + B.shin + 0.05) * scale, 0.55 * scale, 0.09 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body colour: light-to-sky gradient + soft glow
  const top = oy + (B.headY - B.headR) * scale;
  const bottom = oy + (B.thigh + B.shin) * scale;
  const body = ctx.createLinearGradient(0, top, 0, bottom);
  body.addColorStop(0, '#f0f9ff');
  body.addColorStop(1, '#38bdf8');
  ctx.shadowColor = 'rgba(56, 189, 248, 0.55)';
  ctx.shadowBlur = 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const capsule = (seg) => {
    const a = P(seg.from);
    const b = P(seg.to);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  const dot = (p, r, color) => {
    const q = P(p);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r * scale, 0, Math.PI * 2);
    ctx.fill();
  };

  // 1. Legs (behind the torso)
  for (const seg of pose.segments.filter(sg => sg.part === 'thigh' || sg.part === 'shin')) {
    if (seg.dashed) {
      // Below-knee prosthesis: socket under the knee + slim grey pylon + foot, static
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 0.07 * scale;
      capsule(seg);
      const socketEnd = { x: seg.from.x + (seg.to.x - seg.from.x) * 0.3, y: seg.from.y + (seg.to.y - seg.from.y) * 0.3 };
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 0.2 * scale;
      capsule({ from: seg.from, to: socketEnd });
      const foot = P(seg.to);
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, 0.13 * scale, 0.05 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = body;
      ctx.lineWidth = THICK[seg.part] * scale;
      capsule(seg);
      if (seg.part === 'shin') {
        const foot = P(seg.to);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.ellipse(foot.x, foot.y, 0.14 * scale, 0.06 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 2. Torso: filled, slightly tapered shape from the shoulders to the hips
  const { ls, rs, lh, rh, lw, rw } = pose.torso;
  const T = [P(ls), P(rs), P(rw), P(rh), P(lh), P(lw)];   // shoulders → waist → hips
  ctx.fillStyle = body;
  ctx.strokeStyle = body;
  ctx.lineWidth = 0.16 * scale;     // rounds the corners
  ctx.beginPath();
  ctx.moveTo(T[0].x, T[0].y);
  for (let i = 1; i < T.length; i++) ctx.lineTo(T[i].x, T[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 3. Arms + hands
  for (const seg of pose.segments.filter(sg => sg.part === 'upperArm' || sg.part === 'forearm')) {
    ctx.strokeStyle = body;
    ctx.lineWidth = THICK[seg.part] * scale;
    capsule(seg);
    if (seg.part === 'forearm') dot(seg.to, 0.09, '#e0f2fe');
  }

  // 4. Neck + head
  ctx.strokeStyle = body;
  ctx.lineWidth = 0.12 * scale;
  capsule({ from: pose.neck, to: { x: pose.head.x, y: pose.head.y + pose.head.r * 0.8 } });
  dot(pose.head, pose.head.r * 1.05, '#f0f9ff');

  ctx.restore();
}

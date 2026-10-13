// ============================================================
// virtualBall — a smart virtual ball for EVERY ball drill, in every sport (owner, 2026-10-13)
//
// PURE. A trainee without a real ball still trains every ball drill: a virtual ball appears in the
// camera view at their body and reacts to their skeleton. One model, by drill type:
//
//   incoming   the ball comes TO a body point on the beat and is struck / met there
//              (kick, pass, first touch → the foot; header → the head; chest control → the chest;
//               goalkeeper catch → the hands; racket strokes / serve → the racket hand)
//   dribble    the ball rolls at the feet: every foot touch pushes it, it keeps close to the body
//              (football dribbling, ball carry, shielding — also on crutches)
//   juggle     the ball bounces up from the foot on every touch, falls by gravity (keepy-uppy)
//   handDribble the ball bounces between the hand and the floor (basketball dribble, crossover,
//              wheelchair dribble): a push down sends it, it comes back up to the hand
//   throw      the ball is held in the hands; a fast arm extension releases it (chest / bounce /
//              overhead pass, shooting, layup, goalkeeper distribution), a new one comes back
//
// Units: view px (the camera view canvas), times in ms. Body points come in as px from the live
// skeleton; `bodyPx` = the trainee's height in px (sizes the ball and the speeds).
// ============================================================

/** cueKey → ball mode (+ target body point for incoming balls). */
const CUE_MODE = {
  kick: ['incoming', 'foot'], amputeeKick: ['incoming', 'foot'], pass: ['incoming', 'foot'],
  crutchPass: ['incoming', 'foot'], firstTouch: ['incoming', 'foot'],
  headers: ['incoming', 'head'], crutchHeader: ['incoming', 'head'],
  chestControl: ['incoming', 'chest'], crutchChestControl: ['incoming', 'chest'],
  gkReaction: ['incoming', 'hands'],
  serve: ['incoming', 'hand'], volley: ['incoming', 'hand'], stroke: ['incoming', 'hand'], smash: ['incoming', 'hand'],
  wheelchairServe: ['incoming', 'hand'], wheelchairStroke: ['incoming', 'hand'], wcSmash: ['incoming', 'hand'],
  dribbling: ['dribble', 'feet'], crutchDribble: ['dribble', 'feet'], shieldBall: ['dribble', 'feet'], crutchShield: ['dribble', 'feet'],
  juggle: ['juggle', 'foot'],
  handDribble: ['handDribble', 'hand'], crossover: ['handDribble', 'hand'], spinMove: ['handDribble', 'hand'],
  postMoves: ['handDribble', 'hand'], wheelchairDribble: ['handDribble', 'hand'],
  chestPass: ['throw', 'hands'], bouncePass: ['throw', 'hands'], overheadPass: ['throw', 'hands'],
  shooting: ['throw', 'hands'], layup: ['throw', 'hands'], hookShot: ['throw', 'hands'],
  wheelchairShooting: ['throw', 'hands'], wheelchairPass: ['throw', 'hands'], wcBouncePass: ['throw', 'hands'],
  gkDistribution: ['throw', 'hands'],
};
const PATTERN_MODE = {
  shadowKick: ['incoming', 'foot', 'kick'], shadowPass: ['incoming', 'foot', 'pass'], shadowChestPass: ['throw', 'hands', null],
};
// by the name (exercises from any source): the most specific first
const NAME_MODE = [
  [/ג'אגל|ג׳אגל|ליפטינג|juggl|keepy/, ['juggle', 'foot']],
  [/נגיח|header/, ['incoming', 'head']],
  [/שליטה בחזה|עצירה בחזה|chest control|chest trap/, ['incoming', 'chest']],
  [/כדרור|כדרור כדורסל|crossover|קרוסאובר|דריבל כדורסל|basketball dribbl|hand dribbl/, ['handDribble', 'hand']],
  [/מסירת חזה|מסירת ניתור|מסירה מעל הראש|chest pass|bounce pass|overhead pass|זריק|קליע|לייאפ|עליה לסל|layup|shoot|free throw/, ['throw', 'hands']],
  [/הגשה|serve|פורהנד|בקהנד|forehand|backhand|ווליי|volley|סמאש|smash/, ['incoming', 'hand']],
  [/דריבל|הובלת כדור|הובלה|שליטה בכדור|הגנה על הכדור|dribbl|ball carry|ball control|shield/, ['dribble', 'feet']],
  [/מסיר|מסור|pass/, ['incoming', 'foot', 'pass']],
  [/בעיט|בעט|שער|kick|shot|שליטה ראשונית|first touch/, ['incoming', 'foot', 'kick']],
  // any other ball drill: the ball comes to the foot (stops, wall-ball, reaction drills)
  [/כדור|ball/, ['incoming', 'foot', 'pass']],
];
// not a ball despite the word
const FALSE_BALL = /כדור הארץ|כדורית|balls? of (the )?feet|balls? of (the )?foot|כרית כף הרגל/g;

/**
 * The virtual ball's behaviour for a drill, or null when it is not a ball drill.
 * @returns {{ mode: 'incoming'|'dribble'|'juggle'|'handDribble'|'throw', target: string, kind: 'kick'|'pass' } | null}
 *   kind = the incoming timing (a pass comes slower than a kick)
 */
export function ballModeFor({ cueKey = null, pattern = null, name = '', nameEn = '' } = {}) {
  const mk = ([mode, target, kind], fallbackKind) => ({ mode, target, kind: kind || fallbackKind || (cueKey === 'pass' || cueKey === 'crutchPass' ? 'pass' : 'kick') });
  if (pattern && PATTERN_MODE[pattern]) return mk(PATTERN_MODE[pattern]);
  const text = `${name || ''} ${nameEn || ''}`.toLowerCase().replace(FALSE_BALL, ' ');
  // an explicit no-ball drill that is NOT one of our shadow ball patterns stays without a ball
  if (/ללא כדור|בלי כדור|without (a )?ball|no ball/.test(text)) return null;
  if (cueKey && CUE_MODE[cueKey]) return mk(CUE_MODE[cueKey]);
  const hit = NAME_MODE.find(([re]) => re.test(text));
  return hit ? mk(hit[1]) : null;
}

/**
 * Show the virtual ball? Shadow ball patterns: always (the drill IS a virtual ball drill). A real-ball
 * drill: when the trainee has no real ball (hasBall !== true), and never while a real ball is seen.
 */
export function virtualBallWanted({ mode, pattern = null, hasBall = null, realBallSeen = false }) {
  if (!mode) return false;
  if (realBallSeen) return false;
  if (pattern && PATTERN_MODE[pattern]) return true;
  return hasBall !== true;
}

// ---------------- the body points (view px) ----------------

const vis = (p) => p && (p.visibility ?? 1) >= 0.5 && p.y >= -0.05 && p.y <= 1.05;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The body points the ball uses, in view px. `map(nx, ny)` = the camera → view mapping.
 * @returns {{ head, chest, hands, handL, handR, footL, footR, floorY, centerX, bodyPx } | null}
 */
export function bodyPoints(lm, map) {
  if (!lm || !map) return null;
  const P = (i) => (vis(lm[i]) ? map(lm[i].x, lm[i].y) : null);
  const ls = P(11), rs = P(12), lh = P(23), rh = P(24);
  const foot = (hip, knee, ankle) => {
    const a = P(ankle);
    if (a) return a;
    const k = P(knee), h = P(hip);
    return k && h ? { x: k.x + (k.x - h.x) * 0.95, y: k.y + (k.y - h.y) * 0.95 } : null;
  };
  const footL = foot(23, 25, 27), footR = foot(24, 26, 28);
  const head = P(0) || (ls && rs ? { x: (ls.x + rs.x) / 2, y: Math.min(ls.y, rs.y) - Math.abs(ls.x - rs.x) * 0.6 } : null);
  const chest = ls && rs ? { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 + Math.abs(ls.x - rs.x) * 0.35 } : null;
  const handL = P(15), handR = P(16);
  const hands = handL && handR ? mid(handL, handR) : handL || handR;
  const shoulders = ls && rs ? mid(ls, rs) : ls || rs;
  if (!shoulders && !footL && !footR) return null;
  const feetY = [footL, footR].filter(Boolean).map(f => f.y);
  const hipY = lh && rh ? (lh.y + rh.y) / 2 : null;
  const floorY = feetY.length ? Math.max(...feetY) : hipY != null && shoulders ? hipY + (hipY - shoulders.y) * 1.6 : null;
  const top = head ? head.y : shoulders ? shoulders.y - 0.3 * Math.abs((hipY ?? shoulders.y + 1) - shoulders.y) : null;
  const bodyPx = floorY != null && top != null ? Math.max(40, floorY - top) : null;
  const centerX = lh && rh ? (lh.x + rh.x) / 2 : shoulders ? shoulders.x : (footL || footR).x;
  return { head, chest, hands, handL, handR, footL, footR, shoulders, floorY, centerX, bodyPx };
}

/** The body point an incoming ball goes to. */
export function targetPoint(pts, target, side = 'right') {
  if (!pts) return null;
  if (target === 'foot') return side === 'left' ? pts.footL || pts.footR : pts.footR || pts.footL;
  if (target === 'hand') return side === 'left' ? pts.handL || pts.handR : pts.handR || pts.handL;
  if (target === 'hands') return pts.hands;
  if (target === 'head') return pts.head;
  if (target === 'chest') return pts.chest;
  return null;
}

// ---------------- continuous modes: one physics step ----------------

/** A recent point speed in body heights per second ({x,y} samples [{t,x,y}], oldest first). */
export function pointVelocity(samples, bodyPx) {
  if (!samples || samples.length < 2 || !(bodyPx > 0)) return { vx: 0, vy: 0, speed: 0 };
  const a = samples[0], b = samples[samples.length - 1];
  const dt = (b.t - a.t) / 1000;
  if (!(dt > 0.03)) return { vx: 0, vy: 0, speed: 0 };
  const vx = (b.x - a.x) / bodyPx / dt, vy = (b.y - a.y) / bodyPx / dt;
  return { vx, vy, speed: Math.hypot(vx, vy) };
}

export const BALL_R = 0.07;                  // ball radius vs. the body height (a size-5 ball)
const TOUCH_SPEED = 0.55;                    // a foot moving at least this fast (bodies/s) touches the ball
const DRIBBLE_REACH = 0.42;                  // the ball stays within this (× body height) of the body center
const FRICTION = 2.2;                        // rolling friction (1/s)

/** A new dribble ball, resting in front of the feet. */
export function dribbleInit(pts) {
  const x = pts?.centerX ?? 0;
  return { x, vx: 0, touches: 0, lastTouchAt: -1e9 };
}

/**
 * Dribble: the ball rolls on the floor line. A foot that reaches it and moves sideways pushes it
 * (a touch); rolling friction slows it; the trainee keeps it close (a soft pull to the body center
 * beyond the reach, as when they move with the ball); it never leaves the view.
 * @param {{ footL, footR, centerX, bodyPx }} pts
 * @param {{ L: {vx}, R: {vx} }} footVel - the feet's velocities (bodies/s)
 * @param {{ x0, x1 }} frame - the view's picture box (px)
 */
export function dribbleStep(st, pts, footVel, dtMs, nowMs, frame) {
  if (!st || !pts?.bodyPx) return st;
  const B = pts.bodyPx, r = BALL_R * B;
  const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
  let { x, vx, touches, lastTouchAt } = st;
  let touched = false;
  for (const [f, v] of [[pts.footL, footVel?.L], [pts.footR, footVel?.R]]) {
    if (!f || !v) continue;
    const near = Math.abs(f.x - x) < r * 1.9 && (pts.floorY == null || f.y > pts.floorY - B * 0.12);
    if (near && Math.abs(v.vx) >= TOUCH_SPEED && nowMs - lastTouchAt > 180 && Math.sign(v.vx) === Math.sign(x - f.x || v.vx)) {
      vx = v.vx * B * 1.25;                   // pushed along the foot's direction, a bit faster than it
      touches += 1; lastTouchAt = nowMs; touched = true;
    }
  }
  vx *= Math.exp(-FRICTION * dt);
  x += vx * dt;
  // kept close to the body (they move with the ball)
  const reach = DRIBBLE_REACH * B, off = x - pts.centerX;
  if (Math.abs(off) > reach) { x = pts.centerX + Math.sign(off) * reach; vx = -vx * 0.3; }
  if (frame) {
    if (x < frame.x0 + r) { x = frame.x0 + r; vx = Math.abs(vx) * 0.5; }
    if (x > frame.x1 - r) { x = frame.x1 - r; vx = -Math.abs(vx) * 0.5; }
  }
  return { x, vx, touches, lastTouchAt, touched };
}

const GRAVITY = 3.2;                          // bodies/s² — a juggled ball up and down in ~0.9 s

/** A new juggling ball, resting on the foot. */
export function juggleInit() {
  return { h: 0, vy: 0, up: false, touches: 0, drops: 0, restUntil: 0, lastTouchAt: -1e9 };
}

/**
 * Juggling: the ball's height above the floor (bodies), resting on the kicking foot until flicked. An UPWARD foot move while the ball is
 * low (or resting on the foot) bounces it up; gravity brings it down; a ball that falls past the foot
 * to the floor is a drop (it rests on the foot again after a short pause).
 * @param {number} footVy - the kicking foot's vertical speed (bodies/s, + = down on the screen)
 * @param {number} footLift - how high the foot is above the floor now (bodies)
 */
export function juggleStep(st, footVy, footLift, dtMs, nowMs) {
  if (!st) return st;
  const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
  let { h, vy, up, touches, drops, restUntil, lastTouchAt } = st;
  let touched = false, dropped = false;
  const lowEnough = h <= Math.max(0.12, (footLift || 0) + 0.08);
  if (lowEnough && footVy <= -TOUCH_SPEED && (vy <= 0 || !up) && nowMs - lastTouchAt > 250 && nowMs >= restUntil) {
    vy = Math.min(2.6, 1.3 + -footVy * 0.5);   // a harder flick → higher
    up = true; touches += 1; lastTouchAt = nowMs; touched = true;
  }
  if (!up) h = Math.max(0, footLift || 0);          // resting on the foot, it moves with it
  else {
    vy -= GRAVITY * dt;
    h += vy * dt;
    if (h <= 0) { h = 0; vy = 0; up = false; drops += 1; dropped = true; restUntil = nowMs + 700; }
  }
  return { h, vy, up, touches, drops, restUntil, lastTouchAt, touched, dropped };
}

/** A new hand-dribble ball, in the hand. */
export function handDribbleInit() {
  return { u: 0, vu: 0, inHand: true, bounces: 0, lastPushAt: -1e9 };
}

/**
 * Hand dribble: u = the ball's place on the line hand (0) → floor (1). A downward push of the hand
 * sends it down; the floor bounces it back up (0.85) to the hand, which holds it until the next push.
 * @param {number} handVy - the dribbling hand's vertical speed (bodies/s, + = down)
 * @param {number} lineBodies - the hand → floor distance (bodies)
 */
export function handDribbleStep(st, handVy, lineBodies, dtMs, nowMs) {
  if (!st) return st;
  const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
  const L = Math.max(0.15, lineBodies || 0.5);
  let { u, vu, inHand, bounces, lastPushAt } = st;
  let pushed = false, bounced = false;
  if (inHand && handVy >= TOUCH_SPEED && nowMs - lastPushAt > 200) {
    inHand = false; vu = Math.max(2.4, handVy * 1.6) / L; lastPushAt = nowMs; pushed = true;
  }
  if (!inHand) {
    u += vu * dt;
    if (u >= 1) { u = 1 - (u - 1); vu = -Math.abs(vu) * 0.85; bounces += 1; bounced = true; }
    if (u <= 0 && vu < 0) { u = 0; vu = 0; inHand = true; }
  }
  return { u, vu, inHand, bounces, lastPushAt, pushed, bounced };
}

/** A new held ball (throw mode). */
export function throwInit() {
  return { held: true, releasedAt: 0, dir: { x: 0, y: -1 }, throws: 0, from: null };
}

const THROW_SPEED = 1.1;                     // the hands extending this fast (bodies/s) release the ball
export const THROW_FLIGHT_MS = 850;

/**
 * Throw: the ball is held at the hands; a fast hand move releases it along the hands' direction
 * (up = a shot, sideways / still = toward the camera = a pass), it flies and fades; a new ball is
 * back in the hands after the flight.
 */
export function throwStep(st, hands, handsVel, nowMs) {
  if (!st) return st;
  let { held, releasedAt, dir, throws, from } = st;
  let released = false;
  if (held && hands && handsVel && handsVel.speed >= THROW_SPEED) {
    held = false; releasedAt = nowMs; throws += 1; released = true;
    const n = Math.hypot(handsVel.vx, handsVel.vy) || 1;
    dir = { x: handsVel.vx / n, y: handsVel.vy / n };
    from = { x: hands.x, y: hands.y };
  }
  if (!held && nowMs - releasedAt > THROW_FLIGHT_MS + 250) held = true;
  return { held, releasedAt, dir, throws, from, released };
}

/** The flying ball of a throw (view px), or null. */
export function throwFlight(st, nowMs, bodyPx) {
  if (!st || st.held || !st.from) return null;
  const v = (nowMs - st.releasedAt) / THROW_FLIGHT_MS;
  if (v >= 1) return null;
  const r0 = BALL_R * bodyPx;
  const upward = st.dir.y < -0.5;
  // a shot rises (an arc up); a pass comes toward the camera (it grows)
  const dist = bodyPx * (upward ? 0.9 : 0.35) * v;
  return {
    x: st.from.x + st.dir.x * dist,
    y: st.from.y + (upward ? st.dir.y * dist - Math.sin(Math.PI * v) * bodyPx * 0.15 : st.dir.y * dist * 0.4),
    r: r0 * (upward ? 1 - 0.35 * v : 1 + 1.6 * v),
    alpha: 1 - v * v,
  };
}

/** The ball for the analysis engine (normalized like a real detection) from a view-px ball. */
export function toDetection(ball, map) {
  if (!ball || !map?.box?.w) return { detected: false };
  const b = map.box;
  return {
    detected: true, virtual: true,
    x: (ball.x - b.x) / b.w, y: (ball.y - b.y) / b.h,
    w: (2 * ball.r) / b.w, h: (2 * ball.r) / b.h, confidence: 1,
  };
}

/** The dribbling / throwing hand: the right one unless it is absent / limited and the left is not. */
export function handSide(lp = {}) {
  const bad = (s) => ['absent', 'prosthetic', 'limited'].includes(lp?.[`${s}_arm`]?.state);
  return bad('right') && !bad('left') ? 'left' : 'right';
}

/** The ball's look for the trainee's sport. */
export function ballLook(sport = '') {
  const s = String(sport || '').toLowerCase();
  if (s.includes('basket')) return 'basketball';
  if (s.includes('tennis')) return 'tennis';
  return 'football';
}

/**
 * Is a REAL ball in play? Detections over the last 2 s (a few frames, not one stray box).
 * @param {number[]} hits - times (ms) a real ball was detected
 */
export function realBallInPlay(hits, nowMs) {
  return (hits || []).filter(t => nowMs - t <= 2000).length >= 4;
}

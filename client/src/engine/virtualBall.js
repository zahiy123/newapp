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
  [/דריבל|הובלת כדור|הובלה|שליטה בכדור|הגנה על הכדור|סלאלום|קונוס|dribbl|ball carry|ball control|shield|slalom|cone/, ['dribble', 'feet']],
  [/מסיר|מסור|pass/, ['incoming', 'foot', 'pass']],
  [/בעיט|בעט|שער|kick|shot|שליטה ראשונית|first touch/, ['incoming', 'foot', 'kick']],
  // any other ball drill: the ball comes to the foot (stops, wall-ball, reaction drills)
  [/כדור|ball/, ['incoming', 'foot', 'pass']],
];
// not a ball despite the word
const FALSE_BALL = /כדור הארץ|כדורית|balls? of (the )?feet|balls? of (the )?foot|כרית כף הרגל|בעיטות ישבן|בעיטות פרפר|בעיטות חמור|בעיטות אחורה|בעיטת ישבן|butt kicks?|flutter kicks?|donkey kicks?|glute kicks?/g;

/**
 * The virtual ball's behaviour for a drill, or null when it is not a ball drill.
 * @returns {{ mode: 'incoming'|'dribble'|'juggle'|'handDribble'|'throw', target: string, kind: 'kick'|'pass' } | null}
 *   kind = the incoming timing (a pass comes slower than a kick)
 */
export function ballModeFor({ cueKey = null, pattern = null, name = '', nameEn = '', sport = null } = {}) {
  return fitToSport(ballModeRaw({ cueKey, pattern, name, nameEn }), sport);
}

/**
 * The ball's behaviour follows the SPORT the trainee chose (a safety net over the drill's analyzer):
 * a hand sport never gets a foot ball (basketball: a pass = a throw, dribbling = a hand dribble;
 * tennis: the ball comes to the racket hand); football never gets a hand dribble.
 */
export function fitToSport(m, sport) {
  if (!m || !sport) return m;
  const s = String(sport);
  const footBall = m.mode === 'dribble' || m.mode === 'juggle' || (m.mode === 'incoming' && m.target === 'foot');
  if (s.startsWith('basketball') && footBall) return m.mode === 'dribble' || m.mode === 'juggle' ? { ...m, mode: 'handDribble', target: 'hand' } : { ...m, mode: 'throw', target: 'hands' };
  if (s.startsWith('tennis') && (footBall || m.mode === 'handDribble' || m.mode === 'throw')) return { ...m, mode: 'incoming', target: 'hand' };
  if (s.startsWith('football') && m.mode === 'handDribble') return { ...m, mode: 'dribble', target: 'feet' };
  return m;
}

function ballModeRaw({ cueKey = null, pattern = null, name = '', nameEn = '' } = {}) {
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
 * The FEET are only what is really seen (no guess from the knee — a guessed foot made the ball float):
 *   footL / footR  the ball's contact point — the toe (foot index) when seen, else the ankle
 *   soleL / soleR  where that foot meets the floor — the lowest of the heel / toe (the ankle joint is a
 *                  foot-height ABOVE the floor: a ball on the ankle line floated)
 *   floorY         the floor under the trainee (the lowest sole); `floorReal` = a foot really seen
 * @returns {{ head, chest, hands, handL, handR, footL, footR, soleL, soleR, floorY, floorReal, centerX, bodyPx } | null}
 */
export function bodyPoints(lm, map) {
  if (!lm || !map) return null;
  const P = (i) => (vis(lm[i]) ? map(lm[i].x, lm[i].y) : null);
  const ls = P(11), rs = P(12), lh = P(23), rh = P(24);
  const head = P(0) || (ls && rs ? { x: (ls.x + rs.x) / 2, y: Math.min(ls.y, rs.y) - Math.abs(ls.x - rs.x) * 0.6 } : null);
  const shoulders = ls && rs ? mid(ls, rs) : ls || rs;
  const hipY = lh && rh ? (lh.y + rh.y) / 2 : null;
  const top = head ? head.y : shoulders ? shoulders.y - 0.3 * Math.abs((hipY ?? shoulders.y + 1) - shoulders.y) : null;
  const side = (ankle, heel, toe) => {
    const A = P(ankle), H = P(heel), T = P(toe);
    if (!A && !H && !T) return { foot: null, sole: null };
    const footH = A && top != null ? Math.max(4, (A.y - top) * 0.045) : 8;   // the ankle's height above the floor
    const soles = [H?.y, T?.y, A ? A.y + footH : null].filter(v => v != null);
    return { foot: T || A || H, sole: Math.max(...soles) };
  };
  const L = side(27, 29, 31), R = side(28, 30, 32);
  const footL = L.foot, footR = R.foot;
  // a foot out of detection for a moment: its SIDEWAYS place from the hip → knee line (only the x is
  // used — the ball stays on the last MEASURED floor, never on a guessed height)
  const guess = (hip, knee) => { const k = P(knee), h = P(hip); return k && h ? { x: k.x + (k.x - h.x) * 0.95, y: k.y + (k.y - h.y) * 0.95 } : null; };
  const footGuessL = footL ? null : guess(23, 25), footGuessR = footR ? null : guess(24, 26);
  const chest = ls && rs ? { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 + Math.abs(ls.x - rs.x) * 0.35 } : null;
  const handL = P(15), handR = P(16);
  const hands = handL && handR ? mid(handL, handR) : handL || handR;
  if (!shoulders && !footL && !footR) return null;
  const soles = [L.sole, R.sole].filter(v => v != null);
  const floorReal = soles.length > 0;
  // no foot in the picture: an ESTIMATE (for the hand drills only — a foot ball is not drawn on it)
  const floorY = floorReal ? Math.max(...soles) : hipY != null && shoulders ? hipY + (hipY - shoulders.y) * 1.6 : null;
  const bodyPx = floorY != null && top != null ? Math.max(40, floorY - top) : null;
  const centerX = lh && rh ? (lh.x + rh.x) / 2 : shoulders ? shoulders.x : (footL || footR).x;
  return { head, chest, hands, handL, handR, footL, footR, footGuessL, footGuessR, soleL: L.sole, soleR: R.sole, shoulders, floorY, floorReal, centerX, bodyPx };
}

/**
 * A STEADY floor line (view px): it follows a lower floor quickly but rises only slowly — a lifted
 * foot (a kick, a juggle, a hop) never lifts the floor, so the ball never rises with it.
 */
export function steadyFloor(prev, floorY, dtMs) {
  if (floorY == null) return prev;
  if (prev == null) return floorY;
  const dt = Math.min(100, Math.max(0, dtMs || 16));
  const k = floorY > prev ? 1 - Math.exp(-dt / 60) : 1 - Math.exp(-dt / 3000);   // a hop of 0.5 s lifts it < 15 %
  return prev + (floorY - prev) * k;
}

/** The body point an incoming ball goes to. */
export function targetPoint(pts, target, side = 'right') {
  if (!pts) return null;
  if (target === 'foot') {
    return side === 'left' ? pts.footL || pts.footGuessL || pts.footR || pts.footGuessR
      : pts.footR || pts.footGuessR || pts.footL || pts.footGuessL;
  }
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
 * Dribble / slalom / ball carry: the ball rolls on the floor line like a real ball at the feet.
 *   touch   a foot that reaches it and moves (sideways OR a tap toward the camera) pushes it — along
 *           the foot's sideways direction, or away from the foot for a forward tap
 *   carry   when the trainee MOVES sideways (a slalom, a carry), the ball travels with them, just
 *           ahead of the feet in the direction of movement — like a ball kept close while dribbling
 *   free    rolling friction slows it; it stays within reach of the body and inside the view
 * @param {{ footL, footR, centerX, bodyPx, floorY }} pts
 * @param {{ L: {vx, speed}, R: {vx, speed} }} footVel - the feet's velocities (bodies/s)
 * @param {{ x0, x1 }} frame - the view's picture box (px)
 * @param {number} [bodyVx] - the trainee's own sideways speed (bodies/s)
 */
export function dribbleStep(st, pts, footVel, dtMs, nowMs, frame, bodyVx = 0) {
  if (!st || !pts?.bodyPx) return st;
  const B = pts.bodyPx, r = BALL_R * B;
  const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
  let { x, vx, touches, lastTouchAt } = st;
  let touched = false;
  for (const [f, v] of [[pts.footL, footVel?.L], [pts.footR, footVel?.R]]) {
    if (!f || !v) continue;
    const near = Math.abs(f.x - x) < r * 1.9 && (pts.floorY == null || f.y > pts.floorY - B * 0.12);
    if (!near || nowMs - lastTouchAt <= 180) continue;
    const side = Math.abs(v.vx) >= TOUCH_SPEED && Math.sign(v.vx) === Math.sign(x - f.x || v.vx);
    const tap = !side && (v.speed ?? Math.abs(v.vx)) >= TOUCH_SPEED * 1.4;     // a forward tap (toward the camera)
    if (side || tap) {
      vx = side ? v.vx * B * 1.25 : Math.sign(x - f.x || 1) * B * 0.45;
      touches += 1; lastTouchAt = nowMs; touched = true;
    }
  }
  vx *= Math.exp(-FRICTION * dt);
  x += vx * dt;
  // carried with the trainee: moving sideways → the ball goes with them, a step ahead of the feet
  if (Math.abs(bodyVx) > 0.15 && nowMs - lastTouchAt > 150) {
    const carryX = pts.centerX + Math.sign(bodyVx) * B * 0.16;
    x += (carryX - x) * (1 - Math.exp(-dt / 0.12));
  }
  // kept close to the body
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

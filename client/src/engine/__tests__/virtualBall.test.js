import { describe, it, expect } from 'vitest';
import {
  ballModeFor, virtualBallWanted, bodyPoints, steadyFloor, targetPoint, dribbleInit, dribbleStep, juggleInit, juggleStep,
  handDribbleInit, handDribbleStep, throwInit, throwStep, throwFlight, toDetection, handSide, ballLook, realBallInPlay,
} from '../virtualBall';
import { frameTransform } from '../ghostOverlay';

describe('every ball drill in every sport gets its ball behaviour', () => {
  const m = (args) => { const r = ballModeFor(args); return r && `${r.mode}:${r.target}`; };
  it('by the analyzer cue', () => {
    expect(m({ cueKey: 'kick' })).toBe('incoming:foot');
    expect(m({ cueKey: 'dribbling' })).toBe('dribble:feet');
    expect(m({ cueKey: 'juggle' })).toBe('juggle:foot');
    expect(m({ cueKey: 'headers' })).toBe('incoming:head');
    expect(m({ cueKey: 'chestControl' })).toBe('incoming:chest');
    expect(m({ cueKey: 'handDribble' })).toBe('handDribble:hand');
    expect(m({ cueKey: 'wheelchairDribble' })).toBe('handDribble:hand');
    expect(m({ cueKey: 'chestPass' })).toBe('throw:hands');
    expect(m({ cueKey: 'shooting' })).toBe('throw:hands');
    expect(m({ cueKey: 'serve' })).toBe('incoming:hand');
    expect(m({ cueKey: 'gkReaction' })).toBe('incoming:hands');
    expect(m({ cueKey: 'crutchDribble' })).toBe('dribble:feet');
  });
  it('by the catalog pattern and by the name (any source)', () => {
    expect(ballModeFor({ pattern: 'shadowPass' })).toMatchObject({ mode: 'incoming', target: 'foot', kind: 'pass' });
    expect(m({ pattern: 'shadowChestPass' })).toBe('throw:hands');
    expect(m({ name: 'הובלת כדור בין קונוסים' })).toBe('dribble:feet');
    expect(m({ name: "ג'אגלינג ברגל ימין" })).toBe('juggle:foot');
    expect(m({ name: 'נגיחות ראש' })).toBe('incoming:head');
    expect(m({ name: 'קרוסאובר במקום' })).toBe('handDribble:hand');
    expect(m({ name: 'עצירת כדור עם קיר' })).toBe('incoming:foot');
    expect(ballModeFor({ name: 'מסירה בצל · בדיוק' })).toMatchObject({ mode: 'incoming', kind: 'pass' });
  });
  it('not a ball drill → no ball', () => {
    expect(ballModeFor({ name: 'סקוואט', cueKey: 'squat' })).toBe(null);
    expect(ballModeFor({ name: 'עמידה על כריות כף הרגל' })).toBe(null);
    expect(ballModeFor({ name: 'Calf raise on the balls of the feet' })).toBe(null);
    expect(ballModeFor({ name: 'עבודת רגליים — ללא כדור', cueKey: 'kick' })).toBe(null);
  });
  it('shown without a real ball; a shadow drill always; never while a real ball is in play', () => {
    expect(virtualBallWanted({ mode: 'dribble', hasBall: false })).toBe(true);
    expect(virtualBallWanted({ mode: 'dribble', hasBall: null })).toBe(true);
    expect(virtualBallWanted({ mode: 'dribble', hasBall: true })).toBe(false);
    expect(virtualBallWanted({ mode: 'incoming', pattern: 'shadowKick', hasBall: true })).toBe(true);
    expect(virtualBallWanted({ mode: 'incoming', pattern: 'shadowKick', realBallSeen: true })).toBe(false);
    expect(virtualBallWanted({ mode: null })).toBe(false);
    expect(realBallInPlay([0, 100, 200], 500)).toBe(false);
    expect(realBallInPlay([0, 100, 200, 300], 500)).toBe(true);
    expect(realBallInPlay([0, 100, 200, 300], 5000)).toBe(false);
  });
  it('the hand and the ball look', () => {
    expect(handSide({ right_arm: { state: 'absent' } })).toBe('left');
    expect(handSide({})).toBe('right');
    expect(ballLook('wheelchairBasketball')).toBe('basketball');
    expect(ballLook('tennis')).toBe('tennis');
    expect(ballLook('footballAmputee')).toBe('football');
  });
});

// a standing trainee (normalized), 1000×1000 view, square video
const stand = () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const set = (i, x, y) => { lm[i] = { x, y, visibility: 1 }; };
  set(0, 0.5, 0.1); set(11, 0.42, 0.25); set(12, 0.58, 0.25); set(15, 0.4, 0.5); set(16, 0.6, 0.5);
  set(23, 0.45, 0.5); set(24, 0.55, 0.5); set(25, 0.45, 0.7); set(26, 0.55, 0.7); set(27, 0.45, 0.9); set(28, 0.55, 0.9);
  return lm;
};
const map = frameTransform(1000, 1000, 1000, 1000, 'contain');

describe('the ball is AT the trainee body (skeleton sync)', () => {
  it('body points in view px', () => {
    const p = bodyPoints(stand(), map);
    // only ankles seen: the floor is a foot-height BELOW the ankle joint (not on it — that floated)
    expect(p.floorY).toBeGreaterThan(925);
    expect(p.floorY).toBeLessThan(950);
    expect(p.floorReal).toBe(true);
    expect(p.centerX).toBeCloseTo(500, 0);
    expect(targetPoint(p, 'foot', 'right')).toMatchObject({ x: 550, y: 900 });
    expect(targetPoint(p, 'head').y).toBeCloseTo(100, 0);
    expect(targetPoint(p, 'hands')).toMatchObject({ x: 500, y: 500 });
    expect(bodyPoints(null, map)).toBe(null);
  });
  it('the detection the analysis engine reads matches the drawn ball', () => {
    const d = toDetection({ x: 550, y: 860, r: 40 }, map);
    expect(d).toMatchObject({ detected: true, virtual: true });
    expect(d.x).toBeCloseTo(0.55, 3); expect(d.y).toBeCloseTo(0.86, 3);
    expect(toDetection(null, map).detected).toBe(false);
  });
});

describe('the floor: the real soles, steady', () => {
  it('heel / toe seen → the floor is the lowest sole; the contact point is the toe', () => {
    const lm = stand();
    lm[30] = { x: 0.55, y: 0.93, visibility: 1 }; lm[32] = { x: 0.57, y: 0.94, visibility: 1 };
    const p = bodyPoints(lm, map);
    expect(p.floorY).toBeCloseTo(940, 0);
    expect(p.footR).toMatchObject({ x: 570, y: 940 });
  });
  it('no foot in the picture → no real floor (a foot ball is not drawn on a guess)', () => {
    const lm = stand();
    for (const i of [27, 28, 29, 30, 31, 32]) lm[i] = { x: 0.5, y: 1.2, visibility: 0.1 };
    const p = bodyPoints(lm, map);
    expect(p.floorReal).toBe(false);
    expect(p.footL).toBe(null); expect(p.footR).toBe(null);
  });
  it('a lifted foot never lifts the floor; a lower floor is followed fast', () => {
    let g = steadyFloor(null, 900, 16);
    for (let i = 0; i < 30; i++) g = steadyFloor(g, 800, 16);        // ~0.5 s with both soles up (a hop)
    expect(g).toBeGreaterThan(880);
    for (let i = 0; i < 20; i++) g = steadyFloor(g, 950, 16);
    expect(g).toBeGreaterThan(945);
  });
});

describe('dribble: the ball rolls with the feet', () => {
  it('a touch (and its green ring) ONLY on a real contact: the toe at the ball, the sole on the floor', () => {
    const p = { ...pts, soleR: pts.floorY };
    let st = { ...dribbleInit(p), x: 560 };
    // the toe far from the ball → no touch even with a fast foot
    st = dribbleStep({ ...st, x: 700 }, p, { R: { vx: 1.5, vy: 0, speed: 1.5 }, L: { vx: 0, vy: 0, speed: 0 } }, 16, 1000, frame);
    expect(st.touches).toBe(0);
    // the foot in the air (sole well above the floor) → no touch
    st = dribbleStep({ ...dribbleInit(p), x: 560 }, { ...p, soleR: p.floorY - 0.2 * p.bodyPx }, { R: { vx: 1.5, vy: 0, speed: 1.5 }, L: { vx: 0, vy: 0, speed: 0 } }, 16, 2000, frame);
    expect(st.touches).toBe(0);
    // toe at the ball, sole down, a real push → a touch
    st = dribbleStep({ ...dribbleInit(p), x: 560 }, p, { R: { vx: 1.5, vy: 0, speed: 1.5 }, L: { vx: 0, vy: 0, speed: 0 } }, 16, 3000, frame);
    expect(st.touches).toBe(1);
  });
  const pts = bodyPoints(stand(), map);
  const frame = { x0: 0, x1: 1000 };
  it('a foot touch pushes it the foot\'s way; friction stops it; it stays close to the body', () => {
    let st = { ...dribbleInit(pts), x: 560 };
    // the right foot (x 550) sweeps right fast at the ball
    st = dribbleStep(st, pts, { R: { vx: 1.5, vy: 0 }, L: { vx: 0, vy: 0 } }, 16, 1000, frame);
    expect(st.touches).toBe(1);
    expect(st.vx).toBeGreaterThan(0);
    for (let i = 0; i < 300; i++) st = dribbleStep(st, pts, { R: { vx: 0, vy: 0 }, L: { vx: 0, vy: 0 } }, 16, 1100 + i * 16, frame);
    expect(Math.abs(st.vx)).toBeLessThan(5);
    expect(Math.abs(st.x - pts.centerX)).toBeLessThanOrEqual(0.42 * pts.bodyPx + 1e-6);
    expect(st.touches).toBe(1);
  });
  it('slalom / carry: the trainee moving sideways takes the ball along, a step ahead of the feet', () => {
    let st = dribbleInit(pts);
    const moving = { ...pts };
    for (let i = 0; i < 60; i++) {
      // walking right ~3 px / frame: the body AND the feet move
      moving.centerX = pts.centerX + i * 3;
      moving.footL = { ...pts.footL, x: pts.footL.x + i * 3 };
      moving.footR = { ...pts.footR, x: pts.footR.x + i * 3 };
      st = dribbleStep(st, moving, { R: { vx: 0, vy: 0, speed: 0 }, L: { vx: 0, vy: 0, speed: 0 } }, 16, i * 16, frame, 0.6);
    }
    // glued just in front of the LEADING (right) foot's toe, in the direction of movement
    const r = 0.07 * pts.bodyPx;
    expect(st.x).toBeGreaterThan(moving.footR.x);
    expect(st.x - moving.footR.x).toBeLessThan(r * 1.6);
  });
  it('a forward tap (toward the camera, no sideways move) touches it too', () => {
    let st = { ...dribbleInit(pts), x: 560 };
    st = dribbleStep(st, pts, { R: { vx: 0.1, vy: 1.2, speed: 1.2 }, L: { vx: 0, vy: 0, speed: 0 } }, 16, 1000, frame);
    expect(st.touches).toBe(1);
  });
  it('a slalom / cones drill is a dribble drill', () => {
    expect(ballModeFor({ name: 'סלאלום בין קונוסים' })?.mode).toBe('dribble');
    expect(ballModeFor({ name: 'Cone slalom' })?.mode).toBe('dribble');
  });
  it('a still foot never moves it', () => {
    let st = dribbleInit(pts);
    for (let i = 0; i < 60; i++) st = dribbleStep(st, pts, { R: { vx: 0.1, vy: 0 }, L: { vx: 0, vy: 0 } }, 16, i * 16, frame);
    expect(st.touches).toBe(0);
    expect(st.x).toBeCloseTo(pts.centerX, 6);
  });
});

describe('juggling: flicks keep it up, gravity brings it down', () => {
  it('a flick sends it up, it falls back; no new flick → a drop, then it rests on the foot', () => {
    let st = juggleInit();
    st = juggleStep(st, -1.5, 0, 16, 1000);
    expect(st.touched).toBe(true);
    let maxH = 0, t = 1016;
    for (; t < 3000 && !st.dropped; t += 16) { st = juggleStep(st, 0, 0, 16, t); maxH = Math.max(maxH, st.h); }
    expect(maxH).toBeGreaterThan(0.2);
    expect(st.dropped).toBe(true);
    expect(st.drops).toBe(1);
    expect(st.h).toBe(0);
  });
  it('a resting ball moves with the raised foot', () => {
    const st = juggleStep(juggleInit(), 0, 0.15, 16, 0);
    expect(st.h).toBeCloseTo(0.15, 6);
  });
});

describe('hand dribble: hand → floor → hand', () => {
  it('a push down sends it, it bounces and comes back up to the hand', () => {
    let st = handDribbleInit();
    st = handDribbleStep(st, 1.2, 0.5, 16, 0);
    expect(st.pushed).toBe(true);
    let bounced = false, t = 16;
    for (; t < 2000 && !(bounced && st.inHand); t += 16) { st = handDribbleStep(st, 0, 0.5, 16, t); bounced = bounced || st.bounced; }
    expect(bounced).toBe(true);
    expect(st.inHand).toBe(true);
    expect(st.bounces).toBe(1);
  });
  it('no push → it stays in the hand', () => {
    let st = handDribbleInit();
    for (let t = 0; t < 500; t += 16) st = handDribbleStep(st, 0.2, 0.5, 16, t);
    expect(st.inHand).toBe(true);
    expect(st.u).toBe(0);
  });
});

describe('throw: held, released by a fast extension, back in the hands', () => {
  it('a fast upward move shoots it up; a new ball comes back', () => {
    let st = throwInit();
    st = throwStep(st, { x: 500, y: 500 }, { vx: 0, vy: -2, speed: 2 }, 1000);
    expect(st.released).toBe(true);
    const f = throwFlight(st, 1300, 800);
    expect(f.y).toBeLessThan(500);
    st = throwStep(st, { x: 500, y: 500 }, { vx: 0, vy: 0, speed: 0 }, 2200);
    expect(st.held).toBe(true);
    expect(st.throws).toBe(1);
  });
  it('a slow move does not release it', () => {
    const st = throwStep(throwInit(), { x: 500, y: 500 }, { vx: 0.3, vy: 0, speed: 0.3 }, 0);
    expect(st.held).toBe(true);
  });
});

import { createIncoming, incomingStep, incomingBallAt, atBall, INCOMING_ROLL_MS, INCOMING_FLY_MS, INCOMING_GAP_MS } from '../virtualBall';

describe('REAL ball physics: it comes, WAITS, and moves only when the trainee acts (every sport)', () => {
  const foot = { x: 500, y: 900 }, start = { x: 400, y: 1000 };
  it('it rolls to the foot and then waits — for as long as it takes, never "missed" by a clock', () => {
    let st = createIncoming(0);
    let r = incomingStep(st, { now: INCOMING_ROLL_MS.kick + 1, kind: 'kick', contact: false, speed: 0, threshold: 1 });
    expect(r.event).toBe('arrived');
    st = r.st;
    for (let t = 2000; t < 30000; t += 500) { r = incomingStep(st, { now: t, kind: 'kick', contact: false, speed: 0, threshold: 1 }); st = r.st; }
    expect(st.phase).toBe('waiting');                         // 30 s later: still waiting at the foot
    const b = incomingBallAt(st, 30000, foot, start, 800);
    expect(b.x).toBe(500);
    expect(b.y + b.r).toBeCloseTo(900, 6);                    // resting ON the floor at the foot
  });
  it('a fast foot that is NOT at the ball does not move it; a fast foot AT the ball kicks it away', () => {
    let st = { ...createIncoming(0), phase: 'waiting', at: 0 };
    let r = incomingStep(st, { now: 100, kind: 'kick', contact: false, speed: 3, threshold: 1 });
    expect(r.st.phase).toBe('waiting');
    r = incomingStep(st, { now: 100, kind: 'kick', contact: true, speed: 3, threshold: 1, moveDir: { x: 1, y: -1 } });
    expect(r.event).toBe('hit');
    const fly = incomingBallAt(r.st, 100 + INCOMING_FLY_MS / 2, foot, start, 800);
    expect(fly.x).toBeGreaterThan(500);                        // along the foot's own movement
    // after its flight and a short gap the next ball comes
    st = incomingStep(r.st, { now: 100 + INCOMING_FLY_MS + 1, kind: 'kick', contact: false, speed: 0, threshold: 1 }).st;
    st = incomingStep(st, { now: 100 + INCOMING_FLY_MS + INCOMING_GAP_MS + 2, kind: 'kick', contact: false, speed: 0, threshold: 1 }).st;
    expect(st.phase).toBe('rolling');
    expect(st.n).toBe(1);
  });
  it('contact = the body point at the ball', () => {
    expect(atBall({ x: 510, y: 880 }, { x: 500, y: 870, r: 56 }, 'foot')).toBe(true);
    expect(atBall({ x: 800, y: 880 }, { x: 500, y: 870, r: 56 }, 'foot')).toBe(false);
  });
});

import { createKickSide, kickSideStep, KICK_BURST } from '../virtualBall';

describe('The kicking leg is DETECTED from the real movement (owner, 2026-10-18)', () => {
  it('starts from the plan\'s guess; a fast swing of the OTHER foot switches to it', () => {
    let ks = createKickSide('right');
    expect(ks.active).toBe('right');
    const r = kickSideStep(ks, { now: 1000, speedL: KICK_BURST + 0.5, speedR: 0.1 });
    expect(r.burst).toBe('left');
    expect(r.ks.active).toBe('left');
    ks = r.ks;
    // and back again when the right leg kicks
    expect(kickSideStep(ks, { now: 2000, speedL: 0.1, speedR: KICK_BURST + 1 }).ks.active).toBe('right');
  });
  it('a hop / running (both feet fast) or a slow move is not a kick', () => {
    const ks = createKickSide('right');
    expect(kickSideStep(ks, { now: 1000, speedL: 2, speedR: 1.8 }).burst).toBe(null);
    expect(kickSideStep(ks, { now: 1000, speedL: 0.4, speedR: 0.1 }).burst).toBe(null);
  });
});

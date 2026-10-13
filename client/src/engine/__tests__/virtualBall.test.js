import { describe, it, expect } from 'vitest';
import {
  ballModeFor, virtualBallWanted, bodyPoints, targetPoint, dribbleInit, dribbleStep, juggleInit, juggleStep,
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
    expect(p.floorY).toBeCloseTo(900, 0);
    expect(p.bodyPx).toBeCloseTo(800, 0);
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

describe('dribble: the ball rolls with the feet', () => {
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

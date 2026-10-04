import { describe, it, expect } from 'vitest';
import { createFrameThrottle } from '../frameThrottle.js';
import { ScanSequencer, MOTION_CAL_MOVEMENTS } from '../ScanSequencer.js';
import { LM } from '../movements.js';

/** Full-body frame where the person performs the current calibration movement at time t (ms). */
function frameFor(movement, t) {
  const lm = [];
  for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
  const set = (i, x, y) => { lm[i] = { x, y, z: 0, visibility: 0.95 }; };
  const wave = (Math.sin((2 * Math.PI * t) / 1500) + 1) / 2; // 0..1, 1.5 s period
  set(LM.LEFT_SHOULDER, 0.60, 0.30); set(LM.RIGHT_SHOULDER, 0.40, 0.30);
  set(LM.LEFT_HIP, 0.57, 0.55); set(LM.RIGHT_HIP, 0.43, 0.55);
  set(LM.LEFT_KNEE, 0.57, 0.72); set(LM.RIGHT_KNEE, 0.43, 0.72);
  set(LM.LEFT_ANKLE, 0.57, 0.88); set(LM.RIGHT_ANKLE, 0.43, 0.88);
  set(LM.LEFT_HEEL, 0.57, 0.90); set(LM.RIGHT_HEEL, 0.43, 0.90);
  set(LM.LEFT_ELBOW, 0.62, 0.45); set(LM.RIGHT_ELBOW, 0.38, 0.45);
  set(LM.LEFT_WRIST, 0.63, 0.58); set(LM.RIGHT_WRIST, 0.37, 0.58);
  const side = movement.armSide || (movement.id === 'raise_left_hand' ? 'left' : movement.id === 'raise_right_hand' ? 'right' : null);
  if (side) {
    const s = side === 'right' ? -1 : 1;
    const sh = side === 'right' ? LM.RIGHT_SHOULDER : LM.LEFT_SHOULDER;
    const a = (5 + 165 * wave) * Math.PI / 180;
    const ex = lm[sh].x + s * Math.sin(a) * 0.15, ey = 0.30 + Math.cos(a) * 0.15;
    const flex = movement.armTest === 'elbow' ? (5 + 130 * wave) * Math.PI / 180 : 0;
    const a2 = movement.armTest === 'elbow' ? (5 * Math.PI / 180) + flex : a;
    const ex2 = movement.armTest === 'elbow' ? lm[sh].x + s * Math.sin(5 * Math.PI / 180) * 0.15 : ex;
    const ey2 = movement.armTest === 'elbow' ? 0.30 + Math.cos(5 * Math.PI / 180) * 0.15 : ey;
    set(side === 'right' ? LM.RIGHT_ELBOW : LM.LEFT_ELBOW, ex2, ey2);
    set(side === 'right' ? LM.RIGHT_WRIST : LM.LEFT_WRIST, ex2 + s * Math.sin(a2) * 0.13, ey2 + Math.cos(a2) * 0.13);
  }
  if (movement.id === 'slight_bend') { set(LM.LEFT_ANKLE, 0.57 + 0.06 * wave, 0.88 - 0.04 * wave); set(LM.RIGHT_ANKLE, 0.43 + 0.06 * wave, 0.88 - 0.04 * wave); }
  if (movement.id === 'pelvis_rotation') { set(LM.LEFT_HIP, 0.57 + 0.03 * wave, 0.55); set(LM.RIGHT_HIP, 0.43 - 0.03 * wave, 0.55); }
  if (movement.id === 'calf_raise') { set(LM.LEFT_ANKLE, 0.57, 0.88 - 0.03 * wave); set(LM.RIGHT_ANKLE, 0.43, 0.88 - 0.03 * wave); }
  if (movement.id === 'march_in_place_cal') { set(LM.LEFT_ANKLE, 0.57, 0.88 - 0.08 * wave); set(LM.RIGHT_ANKLE, 0.43, 0.80 + 0.08 * wave); }
  return lm;
}

/** Simulate `seconds` of rAF ticks at `hz` and count how many frames are fed. */
function feedsOver(hz, seconds, fps = 30) {
  const shouldFeed = createFrameThrottle(fps);
  let fed = 0;
  const ticks = Math.round(hz * seconds);
  for (let i = 0; i < ticks; i++) {
    if (shouldFeed(1000 + (i * 1000) / hz)) fed++;
  }
  return fed;
}

describe('frameThrottle', () => {
  for (const hz of [60, 75, 120, 144, 165]) {
    it(`feeds ~30 frames per second on a ${hz} Hz screen`, () => {
      const fed = feedsOver(hz, 10);
      expect(fed).toBeGreaterThanOrEqual(295);
      expect(fed).toBeLessThanOrEqual(305);
    });
  }

  it('feeds every tick when the screen is slower than the target rate', () => {
    expect(feedsOver(20, 10)).toBe(200);
  });

  it('end to end on a 144 Hz screen: the scan runs ALL calibration steps in order, in real time', () => {
    const seq = new ScanSequencer({ sampleRate: 30 });
    const shouldFeed = createFrameThrottle(30);
    seq.start();

    const order = [];
    const measureStartAt = {};
    let endAt = null;
    const hz = 144;
    for (let i = 0; i < hz * 400 && endAt === null; i++) {
      const t = (i * 1000) / hz;
      if (!shouldFeed(t)) continue;
      const movement = MOTION_CAL_MOVEMENTS[seq._motionCalIndex];
      const change = seq.feedFrame(frameFor(movement, t));
      if (change?.motionCalPhase === 'prep') order.push(MOTION_CAL_MOVEMENTS[change.motionCalStep].id);
      if (change?.measureStart) measureStartAt[MOTION_CAL_MOVEMENTS[change.motionCalStep].id] = t;
      if (change?.subState === 'detection') endAt = t;
    }

    // Every step, in order, with no skips
    expect(order).toEqual(MOTION_CAL_MOVEMENTS.map(m => m.id));
    expect(Object.keys(measureStartAt)).toHaveLength(MOTION_CAL_MOVEMENTS.length);
    // Real time: each step ≥ get-ready (2.5 s) + measurement (4 s)
    expect(endAt / 1000).toBeGreaterThanOrEqual(MOTION_CAL_MOVEMENTS.length * (2.5 + 4));
    expect(endAt / 1000).toBeLessThanOrEqual(MOTION_CAL_MOVEMENTS.length * (6.5 + 8) + 2);
  });

  it('resyncs after a long pause instead of bursting', () => {
    const shouldFeed = createFrameThrottle(30);
    shouldFeed(0);
    expect(shouldFeed(5000)).toBe(true);   // after a 5 s gap
    expect(shouldFeed(5010)).toBe(false);  // no burst of catch-up frames
  });
});

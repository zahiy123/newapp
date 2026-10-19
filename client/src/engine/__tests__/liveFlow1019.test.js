// The owner, 2026-10-19: the count AT the kick, a steady skeleton, one natural flow
import { describe, it, expect } from 'vitest';
import { createRepEvidence, evidenceFrame, evidenceOk } from '../training/repEvidence';
import { createLandmarkFilter, filterLandmarks, SPIKE } from '../landmarkFilter';

function legBody(thighDeg) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const set = (i, x, y) => { lm[i] = { x, y, visibility: 0.95 }; };
  set(11, 0.42, 0.25); set(12, 0.58, 0.25); set(23, 0.45, 0.5); set(24, 0.55, 0.5);
  set(25, 0.45, 0.7); set(27, 0.45, 0.9);                                 // the support leg, still
  const a = (thighDeg * Math.PI) / 180;                                   // the kicking leg swings from the hip, knee straight
  set(26, 0.55 + 0.2 * Math.sin(a), 0.5 + 0.2 * Math.cos(a));
  set(28, 0.55 + 0.4 * Math.sin(a), 0.5 + 0.4 * Math.cos(a));
  return lm;
}

describe('the count AT the contact of a pass', () => {
  it('a pendulum pass is proven at the contact — the leg has NOT come back yet', () => {
    const ev = createRepEvidence('legs');
    let t = 0;
    for (const d of [0, -12, -25, -10, 15, 32]) evidenceFrame(ev, legBody(d), (t += 100));   // back-swing → through the ball
    expect(evidenceOk(ev, t, { strike: true, kick: true })).toBe(true);
    expect(evidenceOk(ev, t)).toBe(false);                                // a REP (not a strike) still needs the return
  });
  it('a small twitch is never a pass', () => {
    const ev = createRepEvidence('legs');
    let t = 0;
    for (const d of [0, -3, -5, -2, 2, 4]) evidenceFrame(ev, legBody(d), (t += 100));
    expect(evidenceOk(ev, t, { strike: true, kick: true })).toBe(false);
  });
});

describe('a steady skeleton', () => {
  const frame = (ax, vis = 0.95) => Array.from({ length: 33 }, (_, i) => ({ x: i === 28 ? ax : 0.5, y: i === 28 ? 0.9 : 0.5, z: 0, visibility: i === 28 ? vis : 0.95 }));
  it('a ONE-frame jump of the ankle (a glitch) is held back; a real move continues on the next frame', () => {
    const f = createLandmarkFilter();
    let t = 0;
    for (let i = 0; i < 10; i++) filterLandmarks(f, frame(0.5), (t += 33));
    const glitch = filterLandmarks(f, frame(0.5 + SPIKE + 0.1), (t += 33));
    expect(Math.abs(glitch[28].x - 0.5)).toBeLessThan(0.02);              // held
    const back = filterLandmarks(f, frame(0.5), (t += 33));
    expect(Math.abs(back[28].x - 0.5)).toBeLessThan(0.02);                // the glitch never showed
    const f2 = createLandmarkFilter();
    t = 0;
    for (let i = 0; i < 10; i++) filterLandmarks(f2, frame(0.5), (t += 33));
    filterLandmarks(f2, frame(0.75), (t += 33));
    const moved = filterLandmarks(f2, frame(0.75), (t += 33));
    expect(moved[28].x).toBeGreaterThan(0.6);                              // a real move follows
  });
  it('a still foot trembling ±0.6% reads steady', () => {
    const f = createLandmarkFilter();
    let t = 0;
    const xs = [];
    for (let i = 0; i < 60; i++) xs.push(filterLandmarks(f, frame(0.5 + (i % 2 ? 0.006 : -0.006), 0.5), (t += 33))[28].x);
    const tail = xs.slice(30);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.004);
  });
});

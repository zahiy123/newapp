// The owner, 2026-10-19: the count AT the kick, a steady skeleton, one natural flow
import { describe, it, expect } from 'vitest';
import { createRepEvidence, evidenceFrame, evidenceOk } from '../training/repEvidence';
import { createLandmarkFilter, filterLandmarks } from '../landmarkFilter';

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

describe('field video 2026-10-20: never block a real kick, never count walking in', () => {
  const frame = (ax) => Array.from({ length: 33 }, (_, i) => ({ x: i === 28 ? ax : 0.5, y: i === 28 ? 0.9 : 0.5, z: 0, visibility: 0.95 }));
  it('a laptop camera at ~12 fps: a fast kick moves the foot 0.15 per frame — the skeleton follows it (no "glitch" hold)', () => {
    const f = createLandmarkFilter();
    let t = 0;
    for (let i = 0; i < 6; i++) filterLandmarks(f, frame(0.5), (t += 83));
    const xs = [0.65, 0.8, 0.95].map(x => filterLandmarks(f, frame(x), (t += 83))[28].x);
    expect(xs[0]).toBeGreaterThan(0.58);                                  // moving on the FIRST fast frame
    expect(xs[2]).toBeGreaterThan(0.85);
  });
  it('walking TOWARD the camera (the body grows in the picture) with a leg swinging is not a pass', () => {
    const ev = createRepEvidence('legs');
    let t = 0;
    [0, -12, -25, -10, 15, 32].forEach((d, i) => {
      const k = 1 + i * 0.06;                                             // the body grows 6% per frame
      const lm = legBody(d).map(p => ({ ...p, x: 0.5 + (p.x - 0.5) * k, y: 0.5 + (p.y - 0.5) * k }));
      evidenceFrame(ev, lm, (t += 100));
    });
    expect(evidenceOk(ev, t, { strike: true, kick: true })).toBe(false);
  });
});

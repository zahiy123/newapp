import { describe, it, expect } from 'vitest';
import { bodyAnchor, overlayPlacement } from '../ghostOverlay.js';

const SH_TO_ANKLE = (1.4 + 1.78) / 1.4;
const lm = (pts) => {
  const out = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.05 }));
  for (const [i, x, y, v = 0.95] of pts) out[i] = { x, y, z: 0, visibility: v };
  return out;
};
// where the Ghost's standing shoulders land (normalized y), from the anchor
const ghostShoulderY = (a) => a.footY - SH_TO_ANKLE * a.torso;

describe('The big Ghost is locked to the camera picture', () => {
  it('close to the phone (upper body only): guessed hips / feet BELOW the picture are ignored — the Ghost sits on the shoulders', () => {
    // shoulders in the picture at y .55; MediaPipe guesses hips at 1.25 and ankles at 2.0 with high confidence
    const close = lm([[0, 0.5, 0.32], [11, 0.62, 0.55], [12, 0.38, 0.55], [23, 0.57, 1.25, 0.9], [24, 0.43, 1.25, 0.9], [27, 0.56, 2.0, 0.8], [28, 0.44, 2.0, 0.8]]);
    const a = bodyAnchor(close, null, 0.25, 3 / 4);
    expect(Math.abs(ghostShoulderY(a) - 0.55)).toBeLessThan(0.03);
    expect(a.footReal).toBe(false);
    // the size comes from the shoulder width with real proportions (not the guessed hips)
    expect(a.torso).toBeCloseTo(0.24 * 0.75 * 1.3, 2);
  });

  it('the whole body in the picture: feet on the feet, shoulders on the shoulders', () => {
    const full = lm([[11, 0.56, 0.3], [12, 0.44, 0.3], [23, 0.54, 0.55], [24, 0.46, 0.55], [27, 0.54, 0.9], [28, 0.46, 0.9]]);
    const a = bodyAnchor(full, null, 0.25, 3 / 4);
    expect(a.footY).toBeCloseTo(0.9, 3);
    expect(Math.abs(ghostShoulderY(a) - 0.3)).toBeLessThan(0.6 * a.torso);
  });

  it('the placement maps the anchor into the displayed (cropped) view and the Ghost is not enlarged beyond the body', () => {
    const close = lm([[11, 0.62, 0.55], [12, 0.38, 0.55], [23, 0.57, 1.25, 0.9], [24, 0.43, 1.25, 0.9]]);
    const a = bodyAnchor(close, null, 0.25, 3 / 4);
    const pl = overlayPlacement(a, 960, 1280, 390, 338);
    // the Ghost's shoulders (feetY − 3.18 units) are inside the view, where the trainee's shoulders are
    const sY = pl.feetY - 3.18 * pl.scale;
    // the WHOLE frame is shown (contain) — the picture's height is the view's height here
    const s = Math.min(390 / 960, 338 / 1280), dh = 1280 * s, oy = (338 - dh) / 2;
    expect(Math.abs(sY - (oy + 0.55 * dh))).toBeLessThan(3);
    expect(sY).toBeGreaterThan(0);
    expect(sY).toBeLessThan(338);
  });

  it('what the camera sees is what is shown: a full body in the frame is fully inside the view (no cut-off feet / head)', () => {
    const full = lm([[0, 0.5, 0.12], [11, 0.56, 0.22], [12, 0.44, 0.22], [23, 0.54, 0.5], [24, 0.46, 0.5], [27, 0.54, 0.94], [28, 0.46, 0.94]]);
    const a = bodyAnchor(full, null, 0.25, 3 / 4);
    for (const [W, H] of [[390, 464], [390, 338], [800, 600]]) {
      const pl = overlayPlacement(a, 960, 1280, W, H);
      const headTop = pl.feetY - (1.78 + 2.02) * pl.scale;
      expect(pl.feetY, `${W}x${H}`).toBeLessThanOrEqual(H);
      expect(headTop, `${W}x${H}`).toBeGreaterThan(-0.08 * H);
    }
  });
});

describe('Floor exercises: the big Ghost lies on the trainee (no standing rules)', () => {
  // lying on the floor across the picture: shoulders on the left, hips in the middle, feet on the right
  const lyingBody = (flip = false) => {
    const X = (x) => (flip ? 1 - x : x);
    return lm([[0, X(0.12), 0.72], [11, X(0.22), 0.74], [12, X(0.22), 0.73], [23, X(0.5), 0.76], [24, X(0.5), 0.75],
      [25, X(0.66), 0.78], [26, X(0.66), 0.77], [27, X(0.82), 0.8], [28, X(0.82), 0.79]]);
  };

  it('detects lying and keeps the Ghost\'s hips ON the trainee\'s hips (inside the picture)', () => {
    let a = null;
    for (let i = 0; i < 12; i++) a = bodyAnchor(lyingBody(), a, 0.25, 4 / 3);
    expect(a.lying).toBe(true);
    expect(a.seated).toBe(false);
    expect(a.hipY).toBeCloseTo(0.755, 2);          // the standing shoulder lock used to push this a torso lower
    expect(a.hipX).toBeCloseTo(0.5, 2);
    const pl = overlayPlacement(a, 1280, 960, 390, 293);
    expect(pl.origin.y).toBeGreaterThan(0);
    expect(pl.origin.y).toBeLessThan(293);
    expect(pl.feetY).toBeNull();
    expect(pl.body.lying).toBe(true);
  });

  it('knows which side the head is (the Ghost lies the same way round)', () => {
    let a = null, b = null;
    for (let i = 0; i < 12; i++) { a = bodyAnchor(lyingBody(false), a, 0.25, 4 / 3); b = bodyAnchor(lyingBody(true), b, 0.25, 4 / 3); }
    expect(a.headDir).toBe(-1);
    expect(b.headDir).toBe(1);
  });

  it('getting back up returns to the standing rules', () => {
    let a = null;
    for (let i = 0; i < 12; i++) a = bodyAnchor(lyingBody(), a, 0.25, 4 / 3);
    const standing = lm([[11, 0.56, 0.22], [12, 0.44, 0.22], [23, 0.54, 0.5], [24, 0.46, 0.5], [27, 0.54, 0.94], [28, 0.46, 0.94]]);
    for (let i = 0; i < 12; i++) a = bodyAnchor(standing, a, 0.25, 3 / 4);
    expect(a.lying).toBe(false);
  });
});

describe('Kick / pass: a steady Ghost on the whole body', () => {
  const stand = (shY, footY = 0.9) => lm([[0, 0.5, shY - 0.1], [11, 0.56, shY], [12, 0.44, shY], [23, 0.54, shY + 0.28], [24, 0.46, shY + 0.28], [27, 0.54, footY], [28, 0.46, footY]]);

  it('with the feet in the picture, leaning into the pass never re-anchors the Ghost (no jump)', () => {
    let a = null;
    for (let i = 0; i < 20; i++) a = bodyAnchor(stand(0.22), a, 0.25, 3 / 4, 16);
    const before = a.footY;
    // a deep lean: the shoulders drop by more than half a torso — the feet stay where they are
    for (let i = 0; i < 20; i++) a = bodyAnchor(stand(0.38), a, 0.25, 3 / 4, 16);
    expect(a.shoulderLocked).toBe(false);
    expect(Math.abs(a.footY - before)).toBeLessThan(0.01);
  });

  it('knows how the trainee faces: straight at the camera vs. side-on', () => {
    let front = null, side = null;
    const sideOn = lm([[11, 0.505, 0.22], [12, 0.495, 0.22], [23, 0.505, 0.5], [24, 0.495, 0.5], [27, 0.5, 0.9], [28, 0.5, 0.9]]);
    const frontal = lm([[11, 0.6, 0.22], [12, 0.4, 0.22], [23, 0.55, 0.5], [24, 0.45, 0.5], [27, 0.55, 0.9], [28, 0.45, 0.9]]);
    for (let i = 0; i < 40; i++) { front = bodyAnchor(frontal, front, 0.25, 3 / 4); side = bodyAnchor(sideOn, side, 0.25, 3 / 4); }
    expect(front.facing).toBeGreaterThan(0.6);
    expect(side.facing).toBeLessThan(0.25);
  });
});

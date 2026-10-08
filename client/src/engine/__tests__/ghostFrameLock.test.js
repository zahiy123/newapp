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
    const s = Math.max(390 / 960, 338 / 1280), dh = 1280 * s, oy = (338 - dh) / 2;
    expect(Math.abs(sY - (oy + 0.55 * dh))).toBeLessThan(12);
    expect(sY).toBeGreaterThan(0);
    expect(sY).toBeLessThan(338);
  });
});

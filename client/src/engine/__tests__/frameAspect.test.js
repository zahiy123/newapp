import { describe, it, expect, afterEach } from 'vitest';
import { angleCosine, setFrameAspect, frameAspect } from '../../utils/motionEngine';
import { trunkLean } from '../exercise/kinematics';

// a point in REAL pixels of a W×H camera frame → MediaPipe-normalized
const norm = (W, H) => (x, y) => ({ x: x / W, y: y / H, visibility: 1 });

describe('the analysis measures in the real proportions of the device camera', () => {
  afterEach(() => setFrameAspect(1));

  it('a real 90° knee in a PORTRAIT phone frame (960×1280) is measured as 90°', () => {
    const n = norm(960, 1280);
    // the hip above the knee, the shin going sideways: a real right angle (in px)
    const hip = n(480, 500), knee = n(480, 800), ankle = n(780, 800);
    setFrameAspect(960 / 1280);
    expect(angleCosine(hip, knee, ankle)).toBeCloseTo(90, 1);
  });

  it('a real 45° line is 45° (it was ~53° before — the camera aspect was ignored)', () => {
    const n = norm(960, 1280);
    const a = n(480, 300), b = n(480, 600), c = n(780, 300);   // b→a straight up, b→c up-right at 45°
    setFrameAspect(1);
    expect(Math.abs(angleCosine(a, b, c) - 45)).toBeGreaterThan(5);   // the old, distorted reading
    setFrameAspect(960 / 1280);
    expect(angleCosine(a, b, c)).toBeCloseTo(45, 1);
  });

  it('landscape too (1280×720)', () => {
    const n = norm(1280, 720);
    setFrameAspect(1280 / 720);
    expect(angleCosine(n(400, 100), n(400, 400), n(700, 400))).toBeCloseTo(90, 1);
  });

  it('the trunk lean is the real lean (a 20° forward lean in a portrait frame)', () => {
    const n = norm(960, 1280);
    const t = (20 * Math.PI) / 180, L = 400;
    const hip = { x: 480, y: 800 }, sh = { x: 480 + L * Math.sin(t), y: 800 - L * Math.cos(t) };
    const lm = [];
    lm[11] = n(sh.x, sh.y); lm[12] = n(sh.x, sh.y); lm[23] = n(hip.x, hip.y); lm[24] = n(hip.x, hip.y);
    setFrameAspect(960 / 1280);
    expect(trunkLean(lm)).toBeCloseTo(20, 1);
  });

  it('ignores a broken aspect (keeps the last real one)', () => {
    setFrameAspect(0.75); setFrameAspect(NaN); setFrameAspect(0);
    expect(frameAspect()).toBe(0.75);
  });
});

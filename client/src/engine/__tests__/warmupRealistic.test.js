import { describe, it, expect } from 'vitest';
import { analyzeArmCircles, analyzeSingleArmRotation, analyzeArmPunches, analyzeCoreTwists } from '../../utils/exerciseAnalysis.js';
import { LandmarkStabilizer } from '../../utils/motionEngine.js';
import { WARMUP_STABILIZER_CONFIG } from '../../utils/exerciseAnalysis.js';

// Deterministic jitter (camera noise) so the tests are stable
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const jit = (a = 0.004) => (rand() - 0.5) * a;

/** Seated person, arms by default resting near the thighs. */
function seated() {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  const set = (i, x, y) => { lm[i] = { x, y, z: 0, visibility: 0.95 }; };
  set(0, 0.5, 0.18);
  set(11, 0.58, 0.32); set(12, 0.42, 0.32);
  set(13, 0.6, 0.45); set(14, 0.4, 0.45);
  set(15, 0.6, 0.56); set(16, 0.4, 0.56);
  set(23, 0.55, 0.62); set(24, 0.45, 0.62);
  set(25, 0.56, 0.64); set(26, 0.44, 0.64);
  set(27, 0.56, 0.86); set(28, 0.44, 0.86);
  return lm;
}

const noisy = (lm) => lm.map(p => ({ ...p, x: p.x + jit(), y: p.y + jit() }));

/**
 * Feed `seconds` of frames at 20 fps (the warm-up analysis rate) through a stabilizer, like Training.jsx.
 * Returns the fraction of the last half of frames reported as "moving".
 */
function movingRatio(analyze, frameAt, { stabilizer, seconds = 6, fps = 20 } = {}) {
  const st = stabilizer || new LandmarkStabilizer(WARMUP_STABILIZER_CONFIG);
  let state = {};
  const n = seconds * fps;
  let moving = 0, counted = 0;
  for (let i = 0; i < n; i++) {
    const tSec = i / fps;
    state = analyze(st.stabilize(noisy(frameAt(tSec))), state);
    if (i >= n / 2) { counted++; if (state.moving) moving++; }
  }
  return moving / counted;
}

/** Small seated arm circles: radius r (normalized), 1 circle per second, both wrists in sync. */
const smallCircles = (r) => (t) => {
  const lm = seated();
  const a = 2 * Math.PI * t;
  lm[15] = { ...lm[15], x: 0.66 + r * Math.cos(a), y: 0.32 + r * Math.sin(a) };
  lm[16] = { ...lm[16], x: 0.34 - r * Math.cos(a), y: 0.32 + r * Math.sin(a) };
  lm[13] = { ...lm[13], x: 0.63, y: 0.32 }; lm[14] = { ...lm[14], x: 0.37, y: 0.32 };
  return lm;
};

describe('warm-up movement detection with REAL smoothing + camera noise (seated)', () => {
  it('small seated arm circles (r = 4% of the frame) are detected almost continuously', () => {
    expect(movingRatio(analyzeArmCircles, smallCircles(0.04))).toBeGreaterThan(0.9);
  });

  it('robustness: with the heavy exercise stabilizer, normal-size circles are still detected', () => {
    const heavy = new LandmarkStabilizer();  // default (exercise) config — the warm-up uses the light one
    expect(movingRatio(analyzeArmCircles, smallCircles(0.08), { stabilizer: heavy })).toBeGreaterThan(0.8);
  });

  it('single-arm small circles are detected', () => {
    const ratio = movingRatio(analyzeSingleArmRotation, (t) => {
      const lm = seated();
      const a = 2 * Math.PI * t;
      lm[16] = { ...lm[16], x: 0.34 - 0.04 * Math.cos(a), y: 0.32 + 0.04 * Math.sin(a) };
      lm[14] = { ...lm[14], x: 0.37, y: 0.32 };
      return lm;
    });
    expect(ratio).toBeGreaterThan(0.9);
  });

  it('short seated punches are detected', () => {
    const ratio = movingRatio(analyzeArmPunches, (t) => {
      const lm = seated();
      const e = (Math.sin(2 * Math.PI * t) + 1) / 2;
      lm[15] = { ...lm[15], x: 0.6 + 0.06 * e, y: 0.4 };
      lm[16] = { ...lm[16], x: 0.4 - 0.06 * (1 - e), y: 0.4 };
      return lm;
    });
    expect(ratio).toBeGreaterThan(0.9);
  });

  it('gentle seated trunk twists are detected', () => {
    const ratio = movingRatio(analyzeCoreTwists, (t) => {
      const lm = seated();
      const half = 0.08 * (0.75 + 0.25 * Math.cos(2 * Math.PI * t * 0.7));
      lm[11] = { ...lm[11], x: 0.5 + half }; lm[12] = { ...lm[12], x: 0.5 - half };
      return lm;
    });
    expect(ratio).toBeGreaterThan(0.85);
  });

  it('sitting still with camera noise is NOT moving (no false progress)', () => {
    for (const analyze of [analyzeArmCircles, analyzeSingleArmRotation, analyzeArmPunches, analyzeCoreTwists]) {
      expect(movingRatio(analyze, () => seated())).toBeLessThan(0.1);
    }
  });
});

describe('no false movement with strong camera noise', () => {
  it('sitting still with DOUBLE camera noise is still not moving', () => {
    for (const analyze of [analyzeArmCircles, analyzeSingleArmRotation, analyzeArmPunches, analyzeCoreTwists]) {
      const st = new LandmarkStabilizer(WARMUP_STABILIZER_CONFIG);
      let state = {}, moving = 0;
      for (let i = 0; i < 120; i++) {
        const lm = seated().map(p => ({ ...p, x: p.x + jit(0.008), y: p.y + jit(0.008) }));
        state = analyze(st.stabilize(lm), state);
        if (i >= 60 && state.moving) moving++;
      }
      expect(moving / 60).toBeLessThan(0.15);
    }
  });
});

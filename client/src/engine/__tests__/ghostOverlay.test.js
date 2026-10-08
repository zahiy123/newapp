import { describe, it, expect } from 'vitest';
import {
  createRangeChallenge, updateRangeChallenge, createPeakTracker, trackPeak, shoulderAngle,
  RANGE_STEP_DEG, RANGE_MAX_ABOVE_SCAN_DEG, RANGE_ABSOLUTE_MAX_DEG, RANGE_DEFAULT_START_DEG,
} from '../rangeProgression.js';
import { coverTransform, bodyAnchor, overlayPlacement } from '../ghostOverlay.js';
import { ghostPose } from '../warmupGhost.js';

const reps = (state, peaks) => {
  let s = state; const events = [];
  for (const p of peaks) { const r = updateRangeChallenge(s, p); s = r.state; if (r.event) events.push(r.event); }
  return { s, events };
};

describe('Progressive Range Challenge', () => {
  it('starts at the scanned range', () => {
    expect(createRangeChallenge({ scanCapDeg: 112 }).target).toBe(112);
    expect(createRangeChallenge({}).target).toBe(RANGE_DEFAULT_START_DEG);
  });

  it('expands by one step after 3 consecutive reps that reach the target', () => {
    const { s, events } = reps(createRangeChallenge({ scanCapDeg: 100 }), [99, 101, 100]);
    expect(events).toEqual(['expanded']);
    expect(s.target).toBe(100 + RANGE_STEP_DEG);
  });

  it('a missed rep in between resets the streak (needs 3 in a row)', () => {
    const { s, events } = reps(createRangeChallenge({ scanCapDeg: 100 }), [100, 100, 60, 100, 100]);
    expect(events).toEqual([]);
    expect(s.target).toBe(100);
  });

  it('never exceeds the scanned range + 20° in a session, nor 170°', () => {
    const { s } = reps(createRangeChallenge({ scanCapDeg: 100 }), Array(60).fill(180));
    expect(s.target).toBe(100 + RANGE_MAX_ABOVE_SCAN_DEG);
    const high = reps(createRangeChallenge({ scanCapDeg: 160 }), Array(60).fill(180)).s;
    expect(high.target).toBe(RANGE_ABSOLUTE_MAX_DEG);
  });

  it('eases back one step after 3 reps far below the target, but never below the start', () => {
    let { s } = reps(createRangeChallenge({ scanCapDeg: 100 }), [100, 100, 100]);   // → 105
    ({ s } = reps(s, [50, 50, 50]));
    expect(s.target).toBe(100);
    ({ s } = reps(s, [40, 40, 40, 40, 40, 40]));
    expect(s.target).toBe(100);
  });
});

describe('rep peak tracker', () => {
  it('emits one peak per up-and-down arm cycle', () => {
    let tr = createPeakTracker(); const peaks = [];
    const series = [10, 30, 60, 90, 110, 118, 115, 100, 80, 60, 30, 15, 40, 80, 120, 125, 110, 90, 20];
    for (const a of series) { const r = trackPeak(tr, a); tr = r.tracker; if (r.peak) peaks.push(r.peak); }
    expect(peaks).toEqual([118, 125]);
  });
});

describe('shoulderAngle', () => {
  it('measures the arm angle from the trunk (anatomical sides)', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    lm[23] = { x: 0.55, y: 0.6, visibility: 0.9 }; lm[11] = { x: 0.55, y: 0.3, visibility: 0.9 };
    lm[13] = { x: 0.75, y: 0.3, visibility: 0.9 };                 // left arm horizontal → 90°
    lm[24] = { x: 0.45, y: 0.6, visibility: 0.9 }; lm[12] = { x: 0.45, y: 0.3, visibility: 0.9 };
    lm[14] = { x: 0.45, y: 0.5, visibility: 0.9 };                 // right arm hanging → 0°
    expect(shoulderAngle(lm, 'left')).toBeCloseTo(90, 0);
    expect(shoulderAngle(lm, 'right')).toBeCloseTo(0, 0);
  });
});

describe('Ghost overlay placement', () => {
  it('maps camera coords through object-fit: cover (portrait phone, 4:3 camera)', () => {
    // 640x480 camera shown in a 400x800 portrait view → scale 800/480, cropped left/right
    const map = coverTransform(640, 480, 400, 800);
    const c = map(0.5, 0.5);
    expect(c.x).toBeCloseTo(200); expect(c.y).toBeCloseTo(400);
    const top = map(0.5, 0);
    expect(top.y).toBeCloseTo(0);
  });

  it('anchors at the hips and scales with the torso (closer to the camera → bigger ghost)', () => {
    const body = (torso) => {
      const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
      lm[23] = { x: 0.55, y: 0.6, visibility: 0.9 }; lm[24] = { x: 0.45, y: 0.6, visibility: 0.9 };
      lm[11] = { x: 0.56, y: 0.6 - torso, visibility: 0.9 }; lm[12] = { x: 0.44, y: 0.6 - torso, visibility: 0.9 };
      return lm;
    };
    const far = overlayPlacement(bodyAnchor(body(0.2)), 640, 480, 640, 480);
    const near = overlayPlacement(bodyAnchor(body(0.4)), 640, 480, 640, 480);
    expect(near.scale / far.scale).toBeCloseTo(2, 1);
    expect(far.origin.x).toBeCloseTo(320); expect(far.origin.y).toBeCloseTo(288);
  });

  it('turning side-on (shoulders overlap, hips hidden) does NOT shrink the Ghost', () => {
    const front = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    front[23] = { x: 0.55, y: 0.65, visibility: 0.9 }; front[24] = { x: 0.45, y: 0.65, visibility: 0.9 };
    front[11] = { x: 0.58, y: 0.35, visibility: 0.9 }; front[12] = { x: 0.42, y: 0.35, visibility: 0.9 };
    let a = bodyAnchor(front);
    const startTorso = a.torso;
    // side-on: shoulders on top of each other, hips not detected
    const side = front.map(p => ({ ...p }));
    side[11] = { x: 0.505, y: 0.35, visibility: 0.9 }; side[12] = { x: 0.495, y: 0.35, visibility: 0.6 };
    side[23] = { ...side[23], visibility: 0.1 }; side[24] = { ...side[24], visibility: 0.1 };
    for (let i = 0; i < 60; i++) a = bodyAnchor(side, a);
    expect(a.torso).toBeGreaterThan(startTorso * 0.95);
  });

  it('side-on with one visible side measures the torso from that side', () => {
    const side = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    side[11] = { x: 0.5, y: 0.35, visibility: 0.9 }; side[23] = { x: 0.5, y: 0.65, visibility: 0.9 };
    expect(bodyAnchor(side).torso).toBeCloseTo(0.3, 2);
  });

  it('bending toward the camera does not shrink the Ghost (the size uses depth too)', () => {
    const upright = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    upright[23] = { x: 0.55, y: 0.65, z: 0, visibility: 0.9 }; upright[24] = { x: 0.45, y: 0.65, z: 0, visibility: 0.9 };
    upright[11] = { x: 0.58, y: 0.35, z: 0, visibility: 0.9 }; upright[12] = { x: 0.42, y: 0.35, z: 0, visibility: 0.9 };
    const a0 = bodyAnchor(upright, null, 1, 1);
    // leaning 60° forward: the shoulders come toward the camera (z) and down — the 2D torso halves
    const bent = upright.map(p => ({ ...p }));
    for (const i of [11, 12]) bent[i] = { ...bent[i], y: 0.65 - 0.3 * Math.cos(Math.PI / 3), z: -0.3 * Math.sin(Math.PI / 3) };
    const a1 = bodyAnchor(bent, null, 1, 1);
    expect(a1.torso / a0.torso).toBeGreaterThan(0.95);
  });

  it('the size changes gradually and never collapses to a microscopic Ghost', () => {
    const prev = { hipX: 0.5, hipY: 0.6, torso: 0.3 };
    const tiny = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    tiny[11] = { x: 0.5, y: 0.55, visibility: 0.9 }; tiny[23] = { x: 0.5, y: 0.6, visibility: 0.9 };
    tiny[12] = { x: 0.5, y: 0.55, visibility: 0.9 }; tiny[24] = { x: 0.5, y: 0.6, visibility: 0.9 };
    expect(bodyAnchor(tiny, prev).torso).toBeGreaterThan(0.29);        // one update: at most a few % change
    // the size matches the trainee's body (owner: locked to the picture) — only a microscopic Ghost is prevented
    expect(overlayPlacement({ hipX: 0.5, hipY: 0.6, torso: 0.02 }, 640, 480, 640, 480).scale).toBeGreaterThanOrEqual(480 / 18 - 0.01);
  });

  it('keeps the previous anchor when the body is not visible, and smooths movement', () => {
    const prev = { hipX: 0.5, hipY: 0.6, torso: 0.2 };
    expect(bodyAnchor(null, prev)).toBe(prev);
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    lm[23] = { x: 0.75, y: 0.6, visibility: 0.9 }; lm[24] = { x: 0.65, y: 0.6, visibility: 0.9 };
    lm[11] = { x: 0.75, y: 0.4, visibility: 0.9 }; lm[12] = { x: 0.65, y: 0.4, visibility: 0.9 };
    const next = bodyAnchor(lm, prev, 0.25);
    expect(next.hipX).toBeGreaterThan(0.5);
    expect(next.hipX).toBeLessThan(0.7);            // moves toward the body, not jumping
  });
});

describe('Ghost demonstrates the target range', () => {
  it('arm circles peak at the challenge target', () => {
    const lp = { left_arm: { state: 'ok', trainable: true }, right_arm: { state: 'ok', trainable: true } };
    let peak = 0;
    for (let i = 0; i <= 40; i++) {
      const seg = ghostPose({ move: 'arm_circles', targetDeg: 125 }, i / 40, lp).segments.find(s => s.limb === 'left_arm');
      const ang = Math.atan2(Math.abs(seg.to.x - seg.from.x), seg.to.y - seg.from.y) * 180 / Math.PI;
      peak = Math.max(peak, ang);
    }
    expect(peak).toBeGreaterThan(123);
    expect(peak).toBeLessThan(127);
  });
});

// ============================================================
// Device-test regressions (owner report 2026-10-05)
// ============================================================
import { defaultPlacement } from '../ghostOverlay.js';
import { detectActivity, motionPointsFor } from '../warmupActivity.js';

describe('regression: arm circles at shoulder height count EVERY cycle', () => {
  it('one peak per circle while the arm never returns to rest', () => {
    let tr = createPeakTracker(); const peaks = [];
    for (let i = 0; i < 200; i++) {                       // 5 circles, 40 samples each
      const angle = 90 + 18 * Math.sin((2 * Math.PI * i) / 40);
      const r = trackPeak(tr, angle); tr = r.tracker; if (r.peak) peaks.push(Math.round(r.peak));
    }
    expect(peaks.length).toBeGreaterThanOrEqual(4);
    expect(peaks.every(p => p >= 105 && p <= 108)).toBe(true);
  });

  it('3 circles reaching the target → the target (and the Ghost) widen by 5°', () => {
    let tr = createPeakTracker();
    let ch = createRangeChallenge({});                    // default start 110
    const events = [];
    for (let i = 0; i < 160; i++) {
      const angle = 95 + 18 * Math.sin((2 * Math.PI * i) / 40);   // peaks ≈ 113 ≥ 95% of 110
      const r = trackPeak(tr, angle); tr = r.tracker;
      if (r.peak) { const u = updateRangeChallenge(ch, r.peak); ch = u.state; if (u.event) events.push(u.event); }
    }
    expect(events[0]).toBe('expanded');
    expect(ch.target).toBe(115);
  });
});

describe('regression: the big Ghost always shows', () => {
  const shouldersOnly = () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    lm[11] = { x: 0.6, y: 0.4, visibility: 0.9 }; lm[12] = { x: 0.4, y: 0.4, visibility: 0.9 };
    return lm;
  };
  it('seated close to the camera (hips not visible): anchored from the shoulders', () => {
    const a = bodyAnchor(shouldersOnly());
    expect(a).not.toBeNull();
    expect(a.hipX).toBeCloseTo(0.5);
    expect(a.hipY).toBeGreaterThan(0.4);
    expect(a.torso).toBeGreaterThan(0.2);
  });
  it('no body yet: centered default placement at full height', () => {
    const d = defaultPlacement(400, 800);
    expect(d.origin.x).toBe(200);
    expect(d.scale * 4.4).toBeGreaterThan(600);           // figure ≈ 4.4 body units tall
  });
});

describe('regression: direct activity detection (raw landmarks)', () => {
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const base = () => Array.from({ length: 33 }, () => ({ x: 0.5 + (rnd() - 0.5) * 0.006, y: 0.5 + (rnd() - 0.5) * 0.006, visibility: 0.9 }));

  it('watches the right body parts per move', () => {
    expect(motionPointsFor('arm_circles')).toContain(15);
    expect(motionPointsFor('twist')).toEqual([11, 12]);
    expect(motionPointsFor('single_knee')).toContain(25);
  });

  it('seated small arm circles → moving; sitting still with jitter → not moving', () => {
    let st = {}; let moving = 0;
    for (let i = 0; i < 80; i++) {
      const lm = base(); const a = (2 * Math.PI * i) / 20;   // 1 circle/s at 20 Hz, r = 4%
      lm[15] = { x: 0.66 + 0.04 * Math.cos(a), y: 0.32 + 0.04 * Math.sin(a), visibility: 0.9 };
      const r = detectActivity(st, lm, 'arm_circles'); st = r.state; if (i >= 20 && r.moving) moving++;
    }
    expect(moving / 60).toBeGreaterThan(0.9);

    st = {}; moving = 0;
    for (let i = 0; i < 80; i++) { const r = detectActivity(st, base(), 'arm_circles'); st = r.state; if (i >= 20 && r.moving) moving++; }
    expect(moving / 60).toBeLessThan(0.1);
  });
});

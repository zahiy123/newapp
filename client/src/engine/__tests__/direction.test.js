import { describe, it, expect } from 'vitest';
import { ghostPose, handTrail } from '../warmupGhost.js';
import { planWarmUp } from '../warmupPlanner.js';
import { createAccuracyTracker, retargetAccuracyTracker, updateAccuracy } from '../movementAccuracy.js';
import { getLimbProfile } from '../limbProfile.js';

const lp = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const fwd = { move: 'arm_circles', directional: true, direction: 'forward' };
const bwd = { ...fwd, direction: 'backward' };

/** Signed area of the left hand's path over one Ghost cycle (sign = rotation sense). */
function signedArea(spec, reverse = false) {
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const t = reverse ? 1 - i / 64 : i / 64;
    pts.push(ghostPose(spec, t, lp).segments.find(s => s.limb === 'left_arm' && s.part === 'forearm').to);
  }
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}

describe('direction swapping (arm circles)', () => {
  it('arm circles are directional in the plan (forward first, switch halfway)', () => {
    const circles = planWarmUp({ disability: 'none', scanData: { classification: 'NATURAL' }, sport: 'rehab', trainingTrack: 'rehab_only' })
      .find(e => e.ghost.move === 'arm_circles');
    expect(circles.ghost.directional).toBe(true);
    expect(circles.spokenSteps.he.join(' ')).toContain('אחורה');
  });

  it('the Ghost hand traces an ellipse (not a line), so the rotation direction is visible', () => {
    expect(Math.abs(signedArea(fwd))).toBeGreaterThan(0.01);
  });

  it('running the animation backward reverses the rotation sense', () => {
    expect(Math.sign(signedArea(fwd))).toBe(-Math.sign(signedArea(fwd, true)));
  });

  it('the motion trail points the opposite way after the switch', () => {
    for (const ms of [100, 500, 900, 1300]) {
      const a = handTrail(fwd, lp, ms).left_arm, b = handTrail(bwd, lp, ms).left_arm;
      const va = { x: a[a.length - 1].x - a[a.length - 2].x, y: a[a.length - 1].y - a[a.length - 2].y };
      const vb = { x: b[b.length - 1].x - b[b.length - 2].x, y: b[b.length - 1].y - b[b.length - 2].y };
      expect(va.x * vb.x + va.y * vb.y).toBeLessThan(0);
    }
  });

  it('no jump at the switch: at the same animation time the pose is identical in both directions', () => {
    expect(ghostPose(fwd, 0.37, lp)).toEqual(ghostPose(bwd, 0.37, lp));
  });
});

describe('accuracy adapts to the direction switch (does not crash)', () => {
  function armsAt(deg) {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    const a = deg * Math.PI / 180;
    lm[11] = { x: 0.56, y: 0.3, visibility: 0.9 }; lm[12] = { x: 0.44, y: 0.3, visibility: 0.9 };
    lm[23] = { x: 0.56, y: 0.6, visibility: 0.9 }; lm[24] = { x: 0.44, y: 0.6, visibility: 0.9 };
    lm[13] = { x: 0.56 + 0.12 * Math.sin(a), y: 0.3 + 0.12 * Math.cos(a), visibility: 0.9 };
    lm[14] = { x: 0.44 - 0.12 * Math.sin(a), y: 0.3 + 0.12 * Math.cos(a), visibility: 0.9 };
    return lm;
  }

  it('the trainee follows the Ghost forward, then backward after the switch → accuracy stays high', () => {
    let tr = createAccuracyTracker({ ...fwd, targetDeg: 120 }, lp);
    const angle = (i, dir) => 95 + 25 * Math.sin(dir * (2 * Math.PI * i) / 20);
    let before = null;
    for (let i = 0; i < 80; i++) { const r = updateAccuracy(tr, armsAt(angle(i, 1))); tr = r.tracker; before = r.accuracy; }
    // Direction switch: the Ghost spec changes, the tracker is re-targeted (samples kept), the trainee reverses
    tr = retargetAccuracyTracker(tr, { ...bwd, targetDeg: 120 }, lp);
    const after = [];
    for (let i = 80; i < 160; i++) { const r = updateAccuracy(tr, armsAt(angle(i, -1))); tr = r.tracker; if (r.accuracy !== null) after.push(r.accuracy); }
    expect(before).toBeGreaterThanOrEqual(85);
    expect(after.length).toBeGreaterThan(70);              // never disappears during the switch
    expect(Math.min(...after)).toBeGreaterThanOrEqual(80);  // and never "crashes"
  });
});

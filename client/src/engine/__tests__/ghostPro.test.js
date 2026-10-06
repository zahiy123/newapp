import { describe, it, expect } from 'vitest';
import { bodyAnchor, overlayPlacement } from '../ghostOverlay.js';
import { shadowBallAt, figureProjection, ghostPose, drawWarmupGhost } from '../warmupGhost.js';
import { ghostAnglesAt, profileGhostPose } from '../exercise/profileGhost.js';
import { EXPERT_PROFILES } from '../exercise/exerciseProfiles.js';
import { catalogGhostSpec, buildCatalog, toExercise } from '../catalog/catalog.js';
import { setLegHalf, legSetStartText, legSetNextText } from '../training/coachFlow.js';
import { withRepOffset } from '../training/profileRepAnalyzer.js';
import { getLimbProfile } from '../limbProfile.js';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const lpBK = getLimbProfile({ scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } });

// A standing body in normalized camera coords (+ optional noise)
const body = (dx = 0, dy = 0, noise = () => 0) => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  const put = (i, x, y) => { lm[i] = { x: x + dx + noise(), y: y + dy + noise(), z: 0, visibility: 0.95 }; };
  put(11, 0.55, 0.3); put(12, 0.45, 0.3); put(23, 0.53, 0.55); put(24, 0.47, 0.55);
  put(27, 0.53, 0.9); put(28, 0.47, 0.9);
  return lm;
};

describe('Steady Ghost — no trembling, glides with the body', () => {
  it('landmark noise does not shake the Ghost (time-based smoothing + dead-band)', () => {
    let a = bodyAnchor(body(), null, 0.25, 4 / 3, 16);
    const start = { ...a };
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.008; };   // ±0.4% jitter
    let maxDev = 0;
    for (let i = 0; i < 300; i++) {
      a = bodyAnchor(body(0, 0, rnd), a, 0.25, 4 / 3, 16);
      maxDev = Math.max(maxDev, Math.abs(a.hipX - start.hipX), Math.abs(a.hipY - start.hipY), Math.abs(a.footY - start.footY));
    }
    expect(maxDev).toBeLessThan(0.002);      // the Ghost stays put
  });

  it('a real move is followed smoothly (no jump), and reached within ~1 s', () => {
    let a = bodyAnchor(body(), null, 0.25, 4 / 3, 16);
    const x0 = a.hipX;
    let maxStep = 0;
    for (let i = 0; i < 60; i++) {
      const prev = a.hipX;
      a = bodyAnchor(body(0.1, 0), a, 0.25, 4 / 3, 16);
      maxStep = Math.max(maxStep, Math.abs(a.hipX - prev));
    }
    expect(a.hipX - x0).toBeGreaterThan(0.09);
    expect(maxStep).toBeLessThan(0.01);
  });

  it('standing: the Ghost stands on the trainee\'s feet (feet line in the placement)', () => {
    const a = bodyAnchor(body(), null);
    const pl = overlayPlacement(a, 640, 480, 640, 480);
    expect(pl.feetY).toBeCloseTo(0.9 * 480, 0);
  });
});

describe('Professional Ghost motion', () => {
  it('keyframe motion flows through the keyframes with no overshoot', () => {
    const g = EXPERT_PROFILES.footballKick.ghost;
    for (const kf of g.keyframes) {
      const a = ghostAnglesAt(g, kf.t);
      for (const k of Object.keys(kf.a)) expect(a[k]).toBeCloseTo(kf.a[k], 6);
    }
    for (const k of Object.keys(g.keyframes[0].a)) {
      const vals = g.keyframes.map(f => f.a[k]);
      for (let t = 0; t < 1; t += 0.01) {
        const v = ghostAnglesAt(g, t)[k];
        expect(v).toBeGreaterThanOrEqual(Math.min(...vals) - 1e-6);
        expect(v).toBeLessThanOrEqual(Math.max(...vals) + 1e-6);
      }
    }
    // no stop at a mid-swing keyframe: the thigh keeps moving through t=0.42
    const v = (t) => ghostAnglesAt(g, t)['B.thigh'];
    expect(Math.abs(v(0.43) - v(0.41))).toBeGreaterThan(0.5);
  });

  it('standing profile Ghosts are drawn in a 3/4 view; a kick turns toward the kicking leg', () => {
    const kick = profileGhostPose(EXPERT_PROFILES.footballKick, 0.5, lpBK);
    expect(kick.depth).toBe(true);
    expect(kick.yaw).toBeGreaterThan(30);
    // left prosthesis → kicks with the right leg (figure's right = -x) → turns toward -x
    expect(kick.yawOut).toBe(-1);
    const { proj } = figureProjection(kick);
    const ankleR = kick.landmarks[28];
    expect(proj(ankleR).x).toBeLessThan(ankleR.x);       // the forward swing shows on the screen
    // floor exercises: unchanged side view
    expect(profileGhostPose(EXPERT_PROFILES.pushUp, 0, lpOk).depth).toBeUndefined();
  });

  it('the figure draws in its panel with the new look (tapered limbs, boots, jersey)', () => {
    const pts = []; let fills = 0;
    const g = { addColorStop() {} };
    const ctx = {
      save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {},
      createLinearGradient: () => g, createRadialGradient: () => g,
      moveTo: (x, y) => pts.push([x, y]), lineTo: (x, y) => pts.push([x, y]),
      arc: (x, y, r) => pts.push([x - r, y - r], [x + r, y + r]),
      ellipse: (x, y) => pts.push([x, y]), roundRect() {}, rect() {},
      fill: () => { fills++; }, stroke() {},
    };
    drawWarmupGhost(ctx, { profile: EXPERT_PROFILES.squat }, lpOk, 800, 224, 320, { fill: true });
    expect(fills).toBeGreaterThan(10);
    for (const [x, y] of pts) { expect(x).toBeGreaterThan(-2); expect(x).toBeLessThan(226); expect(y).toBeGreaterThan(-2); expect(y).toBeLessThan(322); }
  });
});

describe('Shadow ball in shadow kicks / passes', () => {
  const kickId = buildCatalog('field', lpOk).find(i => i.patternId === 'shadowKick').id;
  const passId = buildCatalog('field', lpOk).find(i => i.patternId === 'shadowPass').id;

  it('only the shadow kick / pass Ghost gets a ball', () => {
    expect(catalogGhostSpec(kickId).ball).toBe('kick');
    expect(catalogGhostSpec(passId).ball).toBe('pass');
    const squatId = buildCatalog('field', lpOk).find(i => i.patternId === 'squat').id;
    expect(catalogGhostSpec(squatId).ball).toBeUndefined();
    expect(shadowBallAt(catalogGhostSpec(squatId), 0.6, lpOk)).toBeNull();
  });

  it('rests at the kicking foot, then flies toward the camera — growing, fading; a kick rises, a pass rolls', () => {
    const spec = catalogGhostSpec(kickId);
    const rest = shadowBallAt(spec, 0.3, lpOk);
    const fly = shadowBallAt(spec, 0.6, lpOk);
    expect(rest.alpha).toBe(1);
    expect(fly.z).toBeLessThan(rest.z - 0.5);          // toward the camera
    expect(fly.r).toBeGreaterThan(rest.r);              // perspective
    expect(fly.alpha).toBeLessThan(1);
    expect(fly.y).toBeLessThan(rest.y);                 // a kick lifts the ball
    const pass = shadowBallAt(catalogGhostSpec(passId), 0.6, lpOk);
    expect(pass.y).toBeCloseTo(shadowBallAt(catalogGhostSpec(passId), 0.3, lpOk).y, 6);   // a pass rolls
    expect(shadowBallAt(spec, 0.95, lpOk)).toBeNull();  // gone until the next kick
  });
});

describe('Kicks / passes: a full separate set per leg', () => {
  it('a split kick exercise doubles the SETS (one set per leg), not the reps; balance still switches mid-set', () => {
    const kick = buildCatalog('field', lpBK).find(i => i.patternId === 'shadowKick' && i.variation.side === 'bothSides');
    const e = toExercise(kick, true, null, { canSplit: true });
    expect(e.splitBy).toBe('set');
    expect(Number(e.sets)).toBe(Number(kick.dose.sets) * 2);
    expect(String(e.reps)).toBe(String(kick.dose.reps));
    expect(e.description).toContain('סט נפרד לכל רגל');
    const bal = buildCatalog('field', lpBK).find(i => i.patternId === 'kneeUpBalance' && i.variation.side === 'bothSides');
    expect(toExercise(bal, true, null, { canSplit: true }).splitBy).toBe('half');
  });

  it('odd sets = base leg, even sets = the prosthesis; the coach announces each leg clearly', () => {
    expect([1, 2, 3, 4].map(setLegHalf)).toEqual([1, 2, 1, 2]);
    expect(legSetStartText(lpBK, true, 'kick', 1)).toContain('בעיטות ברגל ימין');
    expect(legSetStartText(lpBK, true, 'kick', 2)).toMatch(/^החלפנו רגל! סט מלא: בעיטות ברגל שמאל — הפרוטזה/);
    expect(legSetNextText(lpBK, true, 'kick', 2)).toBe('בסט הבא מחליפים רגל: בעיטות ברגל שמאל — הפרוטזה.');
  });
});

describe('Counting from the first kick', () => {
  it('kicks done before the exercise phase are added to the analyzer count', () => {
    const base = (lm, prev) => {
      const reps = (prev.reps || 0) + (lm.kick ? 1 : 0);
      return { reps, feedback: lm.kick ? { type: 'count', text: `${reps}!`, count: reps } : null };
    };
    const off = { current: 2 };
    const a = withRepOffset(base, off);
    let st = { reps: 0 };
    st = a({ kick: false }, st);
    expect(st.reps).toBe(2);
    st = a({ kick: true }, st);
    expect(st.reps).toBe(3);
    expect(st.feedback.count).toBe(3);
  });
});

describe('Warm-up figure keeps working', () => {
  it('warm-up moves have no depth / ball', () => {
    expect(ghostPose({ move: 'arm_circles' }, 0.3, lpOk).depth).toBeUndefined();
    expect(shadowBallAt({ move: 'kick' }, 0.6, lpOk)).toBeNull();
  });
});

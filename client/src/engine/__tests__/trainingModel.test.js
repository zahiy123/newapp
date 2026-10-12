import { describe, it, expect } from 'vitest';
import { ballCycle, ballOnScreen, kickingSide, BALL_TIMING } from '../incomingBall.js';
import { bodyAnchor } from '../ghostOverlay.js';
import { fitPoseToBody, seatPose, ghostPose } from '../warmupGhost.js';
import { profileGhostPose } from '../exercise/profileGhost.js';
import { EXPERT_PROFILES } from '../exercise/exerciseProfiles.js';
import { buildCatalog, toExercise } from '../catalog/catalog.js';
import { getLimbProfile } from '../limbProfile.js';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const lpBK = getLimbProfile({ scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } });
const lm = (pts) => {
  const out = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.05 }));
  for (const [i, x, y] of pts) out[i] = { x, y, z: 0, visibility: 0.95 };
  return out;
};
const ang = (a, b, c) => {
  const v1 = [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)], v2 = [c.x - b.x, c.y - b.y, (c.z ?? 0) - (b.z ?? 0)];
  const d = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  return Math.acos(d / (Math.hypot(...v1) * Math.hypot(...v2))) * 180 / Math.PI;
};

describe('The incoming ball gives the strike timing', () => {
  it('approaches, arrives on the beat (the cue), then the next ball comes', () => {
    const T = BALL_TIMING.kick;
    expect(ballCycle(0, 'kick').phase).toBe('approach');
    expect(ballCycle(T.approachMs + 10, 'kick').phase).toBe('strike');
    expect(ballCycle(T.approachMs + T.strikeMs + 50, 'kick').phase).toBe('gone');
    expect(ballCycle(T.cycleMs + 10, 'kick')).toMatchObject({ phase: 'approach', n: 1 });
  });

  it('is passed from the front: big near the camera, smaller as it reaches the foot, ending at the foot', () => {
    const foot = { x: 200, y: 600 }, start = { x: 300, y: 690 };
    const a = ballOnScreen(ballCycle(100, 'kick'), foot, start, 500);
    const b = ballOnScreen(ballCycle(1900, 'kick'), foot, start, 500);
    expect(a.r).toBeGreaterThan(b.r);
    expect(Math.abs(b.x - foot.x)).toBeLessThan(Math.abs(a.x - foot.x));
    const hit = ballOnScreen(ballCycle(BALL_TIMING.kick.approachMs + 50, 'kick'), foot, start, 500);
    expect(hit.x).toBe(foot.x);
  });

  it('comes to the kicking leg: the leg of this set, or the working leg (never the prosthesis)', () => {
    expect(kickingSide(lpBK)).toBe('right');
    expect(kickingSide(lpBK, 'left')).toBe('left');
    expect(kickingSide(lpOk)).toBe('right');
  });
});

describe('The big Ghost is a training model fitted to the trainee', () => {
  it('measures the trainee\'s limb proportions (vs. the Ghost\'s)', () => {
    // long shins: knee→ankle 0.4 vs a torso of 0.25 (the Ghost's shin is 0.63 torso)
    const body = lm([[11, 0.56, 0.2], [12, 0.44, 0.2], [23, 0.54, 0.45], [24, 0.46, 0.45], [25, 0.54, 0.6], [26, 0.46, 0.6], [27, 0.54, 0.95], [28, 0.46, 0.95]]);
    let a = null;
    for (let i = 0; i < 80; i++) a = bodyAnchor(body, a, 0.25, 1);
    expect(a.limbs.shin).toBeGreaterThan(1.15);
    expect(a.limbs.thigh).toBeLessThan(1);
  });

  it('fitting keeps every joint angle — the same correct movement on the trainee\'s proportions', () => {
    const pose = profileGhostPose(EXPERT_PROFILES.squat, 0.5, lpOk);
    const { pose: fit, floorY } = fitPoseToBody(pose, { thigh: 1.2, shin: 0.85, upperArm: 1.1, forearm: 0.9 });
    const seg = (p, limb, part) => p.segments.find(s => s.limb === limb && s.part === part);
    const knee = (p) => ang(seg(p, 'left_leg', 'thigh').from, seg(p, 'left_leg', 'thigh').to, seg(p, 'left_leg', 'shin').to);
    expect(Math.abs(knee(fit) - knee(pose))).toBeLessThan(0.5);
    expect(floorY).toBeCloseTo(0.9 * 1.2 + 0.88 * 0.85, 6);
  });

  it('seated: the Ghost sits (thighs forward, shins down) and keeps the arms\' demonstration', () => {
    const pose = ghostPose({ move: 'arm_circles' }, 0.25, lpOk);
    const sat = seatPose(pose);
    const th = sat.segments.find(s => s.part === 'thigh');
    const sh = sat.segments.find(s => s.part === 'shin');
    expect(th.to.y - th.from.y).toBeLessThan(0.3);          // the thigh no longer hangs down
    expect(sh.to.y - sh.from.y).toBeGreaterThan(0.8);       // the shin hangs down
    expect(sat.segments.filter(s => s.part === 'forearm')).toEqual(pose.segments.filter(s => s.part === 'forearm'));
  });

  it('detects a seated trainee (knees at about hip height)', () => {
    const seated = lm([[11, 0.56, 0.3], [12, 0.44, 0.3], [23, 0.54, 0.55], [24, 0.46, 0.55], [25, 0.55, 0.6], [26, 0.45, 0.6]]);
    let a = null;
    for (let i = 0; i < 12; i++) a = bodyAnchor(seated, a, 0.25, 1);
    expect(a.seated).toBe(true);
    const standing = lm([[11, 0.56, 0.2], [12, 0.44, 0.2], [23, 0.54, 0.45], [24, 0.46, 0.45], [25, 0.54, 0.7], [26, 0.46, 0.7]]);
    for (let i = 0; i < 20; i++) a = bodyAnchor(standing, a, 0.25, 1);
    expect(a.seated).toBe(false);
  });
});

describe('Short exercise names', () => {
  it('only the movement\'s name (+ the leg when one-sided); the details move to the description', () => {
    for (const item of buildCatalog('field', lpBK)) {
      const e = toExercise(item, true);
      expect(e.name.includes(' — '), e.name).toBe(false);
      expect(e.name.split(' · ').length <= 3, e.name).toBe(true);
      if (item.variation.side === 'left' || item.variation.side === 'right') expect(e.name).toMatch(/רגל (ימין|שמאל)/);
      expect(e.analyzerName.length).toBeGreaterThan(2);
    }
  });

  it('two drills of a session never share a name (a kick for accuracy vs. for power)', () => {
    const kicks = buildCatalog('field', lpBK).filter(i => i.patternId === 'shadowPass' && i.variation.tempo === 'standard' && i.variation.side === 'bothSides' && i.variation.range === 'full');
    const names = new Set(kicks.map(i => toExercise(i, true).name));
    expect(names.size).toBe(kicks.length);
  });
});

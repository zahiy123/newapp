import { describe, it, expect } from 'vitest';
import { ballCycle, ballOnScreen, kickingSide, BALL_TIMING, footStrikeSpeed, HIT_SPEED } from '../incomingBall.js';
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

describe('The incoming ball: flows to the foot, kicked in real time', () => {
  const foot = { x: 200, y: 600 }, start = { x: 300, y: 690 };
  const T = BALL_TIMING.kick;

  it('the timing: an approach, a strike window around the arrival, then the next ball', () => {
    expect(ballCycle(0, 'kick').phase).toBe('approach');
    expect(ballCycle(T.approachMs - 100, 'kick').inWindow).toBe(true);     // the window opens before the arrival
    expect(ballCycle(T.approachMs + 100, 'kick')).toMatchObject({ phase: 'after', inWindow: true });
    expect(ballCycle(T.approachMs + T.windowAfterMs + 50, 'kick').inWindow).toBe(false);
    expect(ballCycle(T.cycleMs + 10, 'kick')).toMatchObject({ phase: 'approach', n: 1 });
  });

  it('is passed from the front: big near the camera, smaller at the foot, and it reaches the foot', () => {
    const a = ballOnScreen(ballCycle(100, 'kick'), foot, start, 500);
    const b = ballOnScreen(ballCycle(T.approachMs - 20, 'kick'), foot, start, 500);
    expect(a.r).toBeGreaterThan(b.r);
    expect(Math.abs(b.x - foot.x)).toBeLessThan(3);
  });

  it('never parks: without a kick it keeps rolling past the foot and fades (a miss)', () => {
    const p1 = ballOnScreen(ballCycle(T.approachMs + 100, 'kick'), foot, start, 500, null);
    const p2 = ballOnScreen(ballCycle(T.approachMs + 400, 'kick'), foot, start, 500, null);
    expect(p2.x).not.toBeCloseTo(p1.x, 3);                                   // still moving
    expect(Math.sign(p2.x - foot.x)).toBe(Math.sign(foot.x - start.x));     // past the foot, away from the camera
    const late = ballOnScreen(ballCycle(T.approachMs + T.windowAfterMs + 400, 'kick'), foot, start, 500, 'miss');
    expect(late.alpha).toBeLessThan(0.6);
  });

  it('a hit: the ball flies away from the foot toward the camera, a kick lifts it', () => {
    const at = 50;
    const h = ballOnScreen(ballCycle(T.approachMs + at + 250, 'kick'), foot, start, 500, 'hit', 'kick', at);
    expect(h.y).toBeLessThan(foot.y - 50);                                  // lifted
    expect(Math.sign(h.x - foot.x)).toBe(Math.sign(start.x - foot.x));      // back toward the camera
  });

  it('a hit is a FAST move of the kicking foot (a still / slow foot is not)', () => {
    const fast = [{ t: 0, x: 0.5, y: 0.9 }, { t: 150, x: 0.5, y: 0.7 }];
    const slow = [{ t: 0, x: 0.5, y: 0.9 }, { t: 150, x: 0.5, y: 0.88 }];
    expect(footStrikeSpeed(fast, 0.6)).toBeGreaterThanOrEqual(HIT_SPEED);
    expect(footStrikeSpeed(slow, 0.6)).toBeLessThan(HIT_SPEED);
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

describe('Floor exercises: the big Ghost lies on the trainee INSIDE the camera picture', () => {
  // record every point the drawing uses
  const drawPts = async (body) => {
    const { drawGhostOverlay } = await import('../warmupGhost.js');
    const pts = [];
    const ctx = new Proxy({}, {
      get: (t, k) => (k === 'moveTo' || k === 'lineTo' ? (x, y) => pts.push({ x, y })
        : k === 'arc' || k === 'ellipse' ? (x, y) => pts.push({ x, y })
          : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}),
      set: () => true,
    });
    drawGhostOverlay(ctx, { profile: EXPERT_PROFILES.pushUp }, lpOk, 0, { x: 300, y: 300 }, 50, 0.9, null, body);
    return pts;
  };
  // a portrait phone picture inside a 585×696 view (contain): x 31…554, y 0…696
  const F = { x: 31, y: 0, w: 522, h: 696 };
  const inside = (pts) => pts.every(p => p.x >= F.x - 2 && p.x <= F.x + F.w + 2 && p.y >= F.y - 2 && p.y <= F.y + F.h + 2);

  it('the trainee lying at the bottom of the picture → the Ghost lies there, inside the picture', async () => {
    const box = { x0: 60, x1: 540, y0: 560, y1: 650, headDir: -1 };
    const pts = await drawPts({ box, frame: F });
    expect(inside(pts)).toBe(true);
    const ys = pts.map(p => p.y);
    expect(Math.max(...ys)).toBeGreaterThan(600);           // on the floor where the trainee is
    expect(Math.min(...ys)).toBeGreaterThan(400);
  });

  it('the head / feet outside the narrow frame → squeezed into the picture, never below it', async () => {
    const box = { x0: 31, x1: 553, y0: 600, y1: 696, headDir: 1 };   // the body cut by both edges and the bottom
    expect(inside(await drawPts({ box, frame: F }))).toBe(true);
  });

  it('nobody detected (or still standing) → the bottom strip of the picture, inside', async () => {
    expect(inside(await drawPts({ box: null, frame: F }))).toBe(true);
    expect(inside(await drawPts({ box: { x0: 250, x1: 330, y0: 100, y1: 650, headDir: null }, frame: F }))).toBe(true);
  });

  it('lies the same way round as the trainee (the head side)', async () => {
    const cx = (pts) => pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const box = { x0: 60, x1: 540, y0: 560, y1: 650 };
    const a = await drawPts({ box: { ...box, headDir: 1 }, frame: F });
    const b = await drawPts({ box: { ...box, headDir: -1 }, frame: F });
    expect(Math.sign(cx(a) - 300)).not.toBe(Math.sign(cx(b) - 300));
  });
});

describe('MIRROR mode: the big Ghost drawn from the trainee\'s own skeleton', () => {
  const map = (x, y) => ({ x: x * 600, y: y * 800 });
  const standing = lm([[0, 0.5, 0.15], [11, 0.56, 0.25], [12, 0.44, 0.25], [13, 0.6, 0.38], [14, 0.4, 0.38], [15, 0.62, 0.5], [16, 0.38, 0.5],
    [23, 0.54, 0.52], [24, 0.46, 0.52], [25, 0.55, 0.7], [26, 0.45, 0.7], [27, 0.55, 0.9], [28, 0.45, 0.9]]);

  it('every joint of the Ghost is exactly on the trainee\'s skeleton point', async () => {
    const { mirrorPoseFromSkeleton } = await import('../warmupGhost.js');
    const m = mirrorPoseFromSkeleton(standing, map, lpOk);
    const knee = m.pose.segments.find(s => s.limb === 'left_leg' && s.part === 'thigh').to;
    expect(knee).toEqual(map(0.55, 0.7));
    const wrist = m.pose.segments.find(s => s.limb === 'right_arm' && s.part === 'forearm').to;
    expect(wrist).toEqual(map(0.38, 0.5));
    expect(m.pose.torso.ls).toEqual(map(0.56, 0.25));
    expect(m.pose.head.x).toBeCloseTo(300, 6);
    // a head of a real size (drawFigure scales the radius): never a giant circle over the picture
    expect(m.pose.head.r * m.scale).toBeLessThan(0.6 * Math.abs(m.pose.torso.ls.y - m.pose.torso.lh.y));
  });

  it('an absent leg is not drawn; a below-knee prosthesis is a pylon', async () => {
    const { mirrorPoseFromSkeleton } = await import('../warmupGhost.js');
    const m = mirrorPoseFromSkeleton(standing, map, lpBK);
    expect(m.pose.segments.find(s => s.limb === 'left_leg' && s.part === 'shin').dashed).toBe(true);
    const lpAK = getLimbProfile({ scanData: { classification: 'TRANSFEMORAL_AMPUTEE', prostheticSide: 'left' } });
    const lpNoLeft = { ...lpAK, left_leg: { ...lpAK.left_leg, state: 'absent' } };
    expect(mirrorPoseFromSkeleton(standing, map, lpNoLeft).pose.segments.some(s => s.limb === 'left_leg')).toBe(false);
  });

  it('no skeleton (no shoulders in the picture) → no Ghost at all (it never floats)', async () => {
    const { mirrorPoseFromSkeleton, drawGhostMirror } = await import('../warmupGhost.js');
    expect(mirrorPoseFromSkeleton(lm([[23, 0.5, 0.5], [24, 0.4, 0.5]]), map, lpOk)).toBeNull();
    expect(mirrorPoseFromSkeleton(null, map, lpOk)).toBeNull();
    expect(drawGhostMirror({}, null, map, lpOk)).toBe(false);
  });
});

describe('The guide faces the way the trainee faces', () => {
  it('a trainee facing the camera gets a FRONTAL kick Ghost (no sideways 3/4 turn); a turned trainee a turned one', async () => {
    const { drawGhostOverlay } = await import('../warmupGhost.js');
    const spread = (facing) => {
      const xs = [];
      const ctx = new Proxy({}, { get: (t, k) => (k === 'moveTo' || k === 'lineTo' ? (x) => xs.push(x) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
      // the follow-through: the kicking leg far forward (toward the camera)
      drawGhostOverlay(ctx, { profile: EXPERT_PROFILES.footballKick }, lpOk, 0.64 * 2000, { x: 300, y: 300 }, 60, 0.9, 500, { facing });
      return Math.max(...xs) - Math.min(...xs);
    };
    // frontal: the forward swing goes INTO the screen (no sideways spread); turned: it shows sideways
    expect(spread(1)).toBeLessThan(spread(0.3) * 0.8);
  });
});

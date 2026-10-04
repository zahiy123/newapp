import { describe, it, expect } from 'vitest';
import { getLimbProfile } from '../limbProfile.js';
import { planWarmUp, needsBallQuestion, WARM_UP_EXERCISE_SEC } from '../warmupPlanner.js';
import { ghostPose } from '../warmupGhost.js';

// ---- Profiles ----
const intact = { status: 'intact', level: null, evidence: '' };

/** The owner: LEFT below-knee amputation with a prosthesis (current per-limb vision format). */
const leftBelowKnee = (extra = {}) => ({
  sport: 'rehab',
  trainingTrack: 'rehab_only',
  disability: 'one_leg', amputationSide: 'left', amputationLevel: 'below_knee', mobilityAid: 'none',
  visionDiagnosis: {
    classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left',
    limbs: { left_leg: { status: 'prosthetic', level: 'below_knee', evidence: 'pylon visible' }, right_leg: intact, left_arm: intact, right_arm: intact },
  },
  scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left', limbStatus: {} },
  ...extra,
});

const noDisability = (extra = {}) => ({
  sport: 'fitness', disability: 'none', mobilityAid: 'none',
  scanData: { classification: 'NATURAL' }, ...extra,
});

const allText = (plan) => plan.map(e => [e.name.he, ...e.instructions.he, ...e.spokenSteps.he].join(' ')).join(' | ');

// ============================================================
describe('limbProfile', () => {
  it('left below-knee prosthesis: left leg prosthetic but trainable (knee works), everything else ok', () => {
    const lp = getLimbProfile(leftBelowKnee());
    expect(lp.left_leg).toMatchObject({ state: 'prosthetic', level: 'below_knee', trainable: true });
    expect(lp.right_leg.state).toBe('ok');
    expect(lp.affectedLegs).toEqual(['left_leg']);
    expect(lp.trainableArms).toEqual(['left_arm', 'right_arm']);
    expect(lp.crutches).toBe(false);
  });

  it('falls back to classification + side when there is no per-limb data', () => {
    const p = leftBelowKnee();
    delete p.visionDiagnosis.limbs;
    expect(getLimbProfile(p).left_leg.state).toBe('prosthetic');
  });

  it('falls back to legacy profile fields when there is no scan', () => {
    const lp = getLimbProfile({ disability: 'one_leg', amputationSide: 'right', amputationLevel: 'above_knee' });
    expect(lp.right_leg).toMatchObject({ state: 'prosthetic', level: 'above_knee', trainable: false });
  });

  it('arm measured as limited → state limited with the measured cap; no movement → not trainable', () => {
    const lp = getLimbProfile(noDisability({
      scanData: {
        classification: 'NATURAL',
        armAssessment: {
          right_arm: { status: 'assessed', shoulderFlexionDeg: 165, shoulderAbductionDeg: 160 },
          left_arm: { status: 'assessed', shoulderFlexionDeg: 95, shoulderAbductionDeg: 88 },
        },
      },
    }));
    expect(lp.right_arm.state).toBe('ok');
    expect(lp.left_arm).toMatchObject({ state: 'limited', romCapDeg: 88, trainable: true });

    const lp2 = getLimbProfile(noDisability({ scanData: { classification: 'NATURAL', armAssessment: { left_arm: { status: 'no_movement' } } } }));
    expect(lp2.left_arm).toMatchObject({ state: 'no_movement', trainable: false });
    expect(lp2.trainableArms).toEqual(['right_arm']);
  });

  it('wheelchair from the profile or the scan', () => {
    expect(getLimbProfile({ mobilityAid: 'wheelchair' }).wheelchair).toBe(true);
    expect(getLimbProfile({ scanData: { classification: 'WHEELCHAIR' } }).wheelchair).toBe(true);
  });
});

// ============================================================
describe('warmupPlanner', () => {
  it('always ~2.5 minutes: 3 exercises × 45 s', () => {
    for (const p of [leftBelowKnee(), noDisability(), { mobilityAid: 'wheelchair', sport: 'basketballWheelchair' }]) {
      const plan = planWarmUp(p);
      expect(plan).toHaveLength(3);
      expect(plan.every(e => e.duration === WARM_UP_EXERCISE_SEC)).toBe(true);
    }
  });

  it('owner (left BK prosthesis, no crutches): right-knee raise, NO crutch instructions, left leg never instructed to move', () => {
    const plan = planWarmUp(leftBelowKnee());
    const text = allText(plan);
    expect(text).not.toContain('קביים');
    const knee = plan.find(e => e.ghost.move === 'single_knee');
    expect(knee).toBeDefined();
    expect(knee.ghost.side).toBe('right');
    expect(knee.name.he).toContain('ימין');
    expect(text).not.toMatch(/ברך רגל שמאל|ברגל שמאל/);
  });

  it('crutch user gets crutch instructions', () => {
    const plan = planWarmUp(leftBelowKnee({ mobilityAid: 'crutches' }));
    expect(allText(plan)).toContain('קביים');
  });

  it('rehab only: no sport drill; rehab + football: an air-kick drill with the intact leg', () => {
    const rehabOnly = planWarmUp(leftBelowKnee());
    expect(rehabOnly.some(e => e.ghost.move === 'kick')).toBe(false);

    const withFootball = planWarmUp(leftBelowKnee({ trainingTrack: 'rehab_sport', rehabSport: 'footballAmputee' }));
    const kick = withFootball.find(e => e.ghost.move === 'kick');
    expect(kick.id).toBe('air_kicks');
    expect(kick.ghost.side).toBe('right');
    expect(kick.usesBall).toBe(false);
  });

  it('ball available → ball touches instead of air kicks (and no "kick higher" push)', () => {
    const plan = planWarmUp(leftBelowKnee({ trainingTrack: 'rehab_sport', rehabSport: 'footballAmputee' }), { hasBall: true });
    const drill = plan.find(e => e.ghost.move === 'kick');
    expect(drill.id).toBe('ball_touches');
    expect(drill.usesBall).toBe(true);
    expect(drill.suppressCorrections).toContain('kickHigher');
  });

  it('ball question only for the rehab + ball-sport track', () => {
    expect(needsBallQuestion(leftBelowKnee({ trainingTrack: 'rehab_sport', rehabSport: 'footballAmputee' }))).toBe(true);
    expect(needsBallQuestion(leftBelowKnee())).toBe(false);
    expect(needsBallQuestion(leftBelowKnee({ trainingTrack: 'rehab_sport', rehabSport: 'tennis' }))).toBe(false);
  });

  it('limited arm: circles stay "within your comfortable range" and "bigger circles" is suppressed', () => {
    const plan = planWarmUp(noDisability({
      scanData: { classification: 'NATURAL', armAssessment: { left_arm: { status: 'assessed', shoulderFlexionDeg: 90, shoulderAbductionDeg: 85 } } },
    }));
    const circles = plan.find(e => e.ghost.move === 'arm_circles');
    expect(circles.suppressCorrections).toContain('armCirclesSmall');
    expect(circles.instructions.he.join(' ')).toContain('בטווח שנוח לך');
    expect(circles.ghost.romCapDeg).toBe(85);
  });

  it('one arm cannot move: single-arm circles on the working arm only', () => {
    const plan = planWarmUp(noDisability({ scanData: { classification: 'NATURAL', armAssessment: { left_arm: { status: 'no_movement' } } } }));
    const arm = plan.find(e => e.ghost.move === 'single_arm_circle');
    expect(arm.ghost.side).toBe('right');
    expect(plan.some(e => e.ghost.move === 'arm_circles' || e.ghost.move === 'punches')).toBe(false);
  });

  it('wheelchair: seated upper-body warm-up, no leg exercises', () => {
    const plan = planWarmUp({ mobilityAid: 'wheelchair', sport: 'basketballWheelchair', trainingTrack: 'sport_only' });
    expect(plan.some(e => ['high_knees', 'single_knee', 'side_steps', 'kick'].includes(e.ghost.move))).toBe(false);
    expect(plan.some(e => e.ghost.move === 'chest_pass')).toBe(true);
  });

  it('every planned exercise keeps a movement analyzer', () => {
    for (const e of planWarmUp(leftBelowKnee({ trainingTrack: 'rehab_sport', rehabSport: 'footballAmputee' }))) {
      expect(typeof e.analyze).toBe('function');
    }
  });
});

// ============================================================
describe('warmupGhost', () => {
  const limbsDrawn = (pose) => new Set(pose.segments.map(s => s.limb));

  it('owner: the left prosthetic shank is dashed and never animated; the right knee lifts', () => {
    const lp = getLimbProfile(leftBelowKnee());
    const spec = { move: 'single_knee', side: 'right' };
    const rest = ghostPose(spec, 0, lp);
    const top = ghostPose(spec, 0.5, lp);
    const leftShank = (p) => p.segments.filter(s => s.limb === 'left_leg')[1];
    const rightKnee = (p) => p.segments.filter(s => s.limb === 'right_leg')[0].to;
    expect(leftShank(top).dashed).toBe(true);
    expect(leftShank(top).to).toEqual(leftShank(rest).to);     // prosthetic side does not move
    expect(rightKnee(top).y).toBeLessThan(rightKnee(rest).y);  // right knee rises
  });

  it('absent / non-trainable limbs are not drawn', () => {
    const lp = getLimbProfile(noDisability({ scanData: { classification: 'NATURAL', armAssessment: { left_arm: { status: 'no_movement' } } } }));
    const pose = ghostPose({ move: 'single_arm_circle', side: 'right' }, 0.3, lp);
    expect(limbsDrawn(pose).has('left_arm')).toBe(false);
    expect(limbsDrawn(pose).has('right_arm')).toBe(true);

    const ak = getLimbProfile({ disability: 'one_leg', amputationSide: 'right', amputationLevel: 'above_knee' });
    expect(limbsDrawn(ghostPose({ move: 'single_knee', side: 'left' }, 0.5, ak)).has('right_leg')).toBe(false);
  });

  it('arm angle never exceeds the scanned range', () => {
    const lp = getLimbProfile(noDisability());
    const shoulderAngle = (pose) => {
      const seg = pose.segments.find(s => s.limb === 'left_arm');
      const dx = seg.to.x - seg.from.x, dy = seg.to.y - seg.from.y;
      return Math.atan2(Math.abs(dx), dy) * 180 / Math.PI; // 0 = down, 90 = sideways
    };
    for (let i = 0; i <= 20; i++) {
      const a = shoulderAngle(ghostPose({ move: 'arm_circles', romCapDeg: 70 }, i / 20, lp));
      expect(a).toBeLessThanOrEqual(70.5);
    }
  });

  it("the figure's left side is at +x (same convention as the trainee's landmarks)", () => {
    const pose = ghostPose({ move: 'arm_circles' }, 0.25, getLimbProfile(noDisability()));
    const leftArm = pose.segments.find(s => s.limb === 'left_arm');
    const rightArm = pose.segments.find(s => s.limb === 'right_arm');
    expect(leftArm.to.x).toBeGreaterThan(0);
    expect(rightArm.to.x).toBeLessThan(0);
  });
});

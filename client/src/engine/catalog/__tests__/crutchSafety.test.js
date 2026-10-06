import { describe, it, expect } from 'vitest';
import { getLimbProfile, trainingLimbs } from '../../limbProfile.js';
import { rebuildPlanFromCatalog, planContext, canSplitLegs } from '../planBuilder.js';
import { parseCatalogId, catalogGhostSpec, variationProfile } from '../catalog.js';
import { PATTERNS } from '../patterns.js';
import { profileGhostPose } from '../../exercise/profileGhost.js';
import { planWarmUp } from '../../warmupPlanner.js';

// A left below-knee amputee who moves on CRUTCHES (no prosthesis while training)
const crutchProfile = (extra = {}) => ({ mobilityAid: 'crutches', scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' }, ...extra });
const crutchLp = trainingLimbs(getLimbProfile(crutchProfile()));
// The same amputation with an ACTIVE prosthesis (no crutches)
const prosthesisLp = trainingLimbs(getLimbProfile({ scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } }));

const plan = { weeks: Array.from({ length: 4 }, () => ({ days: [{}, {}, {}] })) };
const exercises = (profile, lp) => rebuildPlanFromCatalog(plan, planContext(profile, lp, 's')).weeks.flatMap(w => w.days.flatMap(d => d.exercises));

describe('Crutches without a prosthesis — never stand on the missing leg', () => {
  it('training limbs: on crutches the prosthetic leg is absent while training; with an active prosthesis it stays', () => {
    expect(crutchLp.left_leg.state).toBe('absent');
    expect(crutchLp.trainsOnCrutches).toBe(true);
    expect(prosthesisLp.left_leg.state).toBe('prosthetic');
    expect(canSplitLegs(crutchLp)).toBe(false);
    expect(canSplitLegs(prosthesisLp)).toBe(true);
  });

  for (const profile of [
    crutchProfile({ sport: 'footballAmputee' }),
    crutchProfile({ sport: 'rehab', trainingTrack: 'rehab_sport', rehabSport: 'footballAmputee' }),
    crutchProfile({ sport: 'rehab', trainingTrack: 'rehab_only' }),
  ]) {
    it(`no split, no two-leg standing, working leg only — ${profile.trainingTrack || profile.sport}`, () => {
      const exs = exercises(profile, crutchLp);
      expect(exs.length).toBeGreaterThan(10);
      for (const e of exs) {
        const v = parseCatalogId(e.catalogId);
        const needs = PATTERNS[v.pattern].needs;
        expect(e.sideSwitch, e.name).toBe(false);
        expect(needs.includes('twoLegs') || needs.includes('bilateralStance'), `${e.name}`).toBe(false);
        if (v.pattern === 'kneeUpBalance') expect(e.name).toContain('הרגל המתפקדת');
        if (v.pattern === 'shadowKick' || v.pattern === 'shadowPass') {
          expect(v.side).toBe('right');
          expect(e.name).toContain('על הקביים');
        }
      }
    });
  }

  it('the balance Ghost stands on the working leg and draws no prosthesis', () => {
    const id = 'kneeUpBalance|standard|full|bothSides|h30';
    const pose = profileGhostPose(variationProfile(id), 0, crutchLp);
    expect(pose.segments.some(s => s.limb === 'left_leg')).toBe(false);          // the missing leg is not drawn
    expect(pose.segments.some(s => s.dashed)).toBe(false);                        // no prosthesis drawn
    const right = pose.segments.filter(s => s.limb === 'right_leg');
    expect(right.length).toBe(2);
    // the right leg is the support: its ankle is on the floor line, not lifted
    const ankle = pose.landmarks[28];
    expect(Math.abs(ankle.y - (0.9 + 0.88))).toBeLessThan(0.05);
    expect(catalogGhostSpec(id)).toBeTruthy();
  });

  it('crutch warm-up: no knee raise of the only leg, no switching legs, crutch support stated', () => {
    for (const p of [crutchProfile({ sport: 'footballAmputee' }), crutchProfile({ sport: 'rehab', trainingTrack: 'rehab_only' })]) {
      const w = planWarmUp(p, { hasBall: false });
      expect(w.some(e => e.ghost?.move === 'single_knee' || e.ghost?.move === 'high_knees'), JSON.stringify(w.map(e => e.id))).toBe(false);
      const text = w.flatMap(e => e.spokenSteps.he).join(' ');
      expect(text).not.toContain('החלף רגל');
    }
  });

  it('an ACTIVE prosthesis keeps the split balance sets (base leg, then the prosthesis)', () => {
    const exs = exercises({ sport: 'rehab', trainingTrack: 'rehab_sport', rehabSport: 'footballAmputee', scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } }, prosthesisLp);
    const balance = exs.filter(e => parseCatalogId(e.catalogId).pattern === 'kneeUpBalance');
    expect(balance.length).toBeGreaterThan(0);
    for (const e of balance) expect(e.sideSwitch).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { checkInQuestions, checkInDefaults, checkInComplete, applyCheckIn } from '../dailyCheckIn.js';
import { getLimbProfile, trainingLimbs } from '../../limbProfile.js';
import { rebuildPlanFromCatalog, planContext } from '../../catalog/planBuilder.js';
import { parseCatalogId } from '../../catalog/catalog.js';
import { PATTERNS } from '../../catalog/patterns.js';
import { planWarmUp } from '../../warmupPlanner.js';
import { requiredEquipment } from '../../exercise/equipmentFit.js';

// The owner's profile: left below-knee amputee, amputee football, rehab + sport
const owner = { sport: 'rehab', trainingTrack: 'rehab_sport', rehabSport: 'footballAmputee', scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } };
const plan = { weeks: Array.from({ length: 2 }, () => ({ days: [{}, {}, {}] })) };
const today = (profile, status) => {
  const eff = applyCheckIn(profile, status);
  const lp = trainingLimbs(getLimbProfile(eff), eff.todayMobility);
  return rebuildPlanFromCatalog(plan, planContext(eff, lp, 's')).weeks.flatMap(w => w.days.flatMap(d => d.exercises));
};

describe('Daily check-in — questions and defaults', () => {
  it('asks where, ball (ball sports) and prosthesis / crutches (leg amputees only)', () => {
    expect(checkInQuestions(owner)).toEqual({ location: true, ball: true, mobility: true });
    expect(checkInQuestions({ sport: 'fitness' })).toEqual({ location: true, ball: false, mobility: false });
    expect(checkInQuestions({ sport: 'footballAmputeeGK', scanData: { classification: 'ARM_AMPUTEE', prostheticSide: 'left' } }).mobility).toBe(false);
  });
  it('prefills with the last answers; complete only when every applicable question is answered', () => {
    expect(checkInDefaults({ ...owner, lastCheckIn: { location: 'field', hasBall: true, mobility: 'crutches' } }))
      .toEqual({ location: 'field', hasBall: true, mobility: 'crutches' });
    expect(checkInComplete(owner, { location: 'home', hasBall: null, mobility: 'prosthesis' })).toBe(false);
    expect(checkInComplete(owner, { location: 'home', hasBall: false, mobility: 'prosthesis' })).toBe(true);
  });
  it('today\'s answer wins over the profile / scan (crutches today, or an active prosthesis today)', () => {
    const crutchToday = applyCheckIn(owner, { location: 'home', hasBall: false, mobility: 'crutches' });
    expect(trainingLimbs(getLimbProfile(crutchToday), crutchToday.todayMobility).left_leg.state).toBe('absent');
    const usuallyCrutches = { ...owner, mobilityAid: 'crutches' };
    const prosToday = applyCheckIn(usuallyCrutches, { location: 'home', hasBall: false, mobility: 'prosthesis' });
    const lp = trainingLimbs(getLimbProfile(prosToday), prosToday.todayMobility);
    expect(lp.left_leg.state).toBe('prosthetic');
    expect(lp.crutches).toBe(false);
  });
});

describe('The workout is built from TODAY\'s answers', () => {
  it('prosthesis today → split balance sets; crutches today → working leg only, crutch-supported', () => {
    const pros = today(owner, { location: 'home', hasBall: false, mobility: 'prosthesis' });
    expect(pros.some(e => e.sideSwitch)).toBe(true);
    const crutch = today(owner, { location: 'home', hasBall: false, mobility: 'crutches' });
    expect(crutch.some(e => e.sideSwitch)).toBe(false);
    for (const e of crutch) {
      const needs = PATTERNS[parseCatalogId(e.catalogId).pattern].needs;
      expect(needs.includes('twoLegs') || needs.includes('bilateralStance'), e.name).toBe(false);
    }
    // one-leg squats / lunges ARE in, crutch-supported
    const oneLeg = crutch.filter(e => ['singleLegSquat', 'singleLegLunge'].includes(parseCatalogId(e.catalogId).pattern));
    expect(oneLeg.length).toBeGreaterThan(0);
    for (const e of oneLeg) expect(e.name).toContain('בתמיכת קביים');
  });

  it('ball today → real ball kicks / passes for the place (home: soft control to a wall); no ball → shadow', () => {
    const home = today(owner, { location: 'home', hasBall: true, mobility: 'prosthesis' });
    const kicks = home.filter(e => ['shadowKick', 'shadowPass'].includes(parseCatalogId(e.catalogId).pattern));
    expect(kicks.length).toBeGreaterThan(0);
    for (const e of kicks) {
      expect(e.requiresBall).toBe(true);
      expect(e.name).toMatch(/בכדור לקיר/);
      expect(requiredEquipment(e).has('ball')).toBe(true);
    }
    const field = today(owner, { location: 'field', hasBall: true, mobility: 'crutches' });
    const fk = field.filter(e => parseCatalogId(e.catalogId).pattern === 'shadowKick');
    for (const e of fk) expect(e.name).toMatch(/בעיטה בכדור — טכניקת בעיטה — על הקביים/);
    const noBall = today(owner, { location: 'home', hasBall: false, mobility: 'prosthesis' });
    expect(noBall.some(e => e.requiresBall)).toBe(false);
  });

  it('the warm-up follows today too (crutches today → no knee raise)', () => {
    const w = planWarmUp(applyCheckIn(owner, { location: 'home', hasBall: false, mobility: 'crutches' }), { hasBall: false });
    expect(w.some(e => e.ghost?.move === 'single_knee')).toBe(false);
  });
});

describe('Arm amputees (e.g. amputee goalkeepers)', () => {
  const gk = { sport: 'footballAmputeeGK', scanData: { classification: 'ARM_AMPUTEE', prostheticSide: 'left' } };
  it('no weight on both arms (push-ups / planks); goalkeeper work and one-arm shoulder work instead', () => {
    const lp = trainingLimbs(getLimbProfile(gk));
    const exs = rebuildPlanFromCatalog(plan, planContext(gk, lp, 's')).weeks.flatMap(w => w.days.flatMap(d => d.exercises));
    const pats = exs.map(e => parseCatalogId(e.catalogId).pattern);
    expect(pats).not.toContain('pushUp');
    expect(pats).not.toContain('plank');
    expect(pats.some(p => ['gkStance', 'lateralShuffle', 'jumpSquat'].includes(p))).toBe(true);
    expect(exs.some(e => e.name.includes('שוער'))).toBe(true);
  });
});

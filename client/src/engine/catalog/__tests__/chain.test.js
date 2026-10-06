import { describe, it, expect } from 'vitest';
import { goalOptions, selectedSessionGoals, trackOf, sportFamilyOf, PROFILE_GOALS } from '../trackGoals.js';
import { rebuildPlanFromCatalog, planContext } from '../planBuilder.js';
import { catalogGhostSpec, parseCatalogId } from '../catalog.js';
import { PATTERNS } from '../patterns.js';
import { SPORT_LIBRARY } from '../../sports/sportLibrary.js';
import { getLimbProfile } from '../../limbProfile.js';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const lpBK = getLimbProfile({ scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } });
const lpAK = getLimbProfile({ scanData: { classification: 'TRANSFEMORAL_AMPUTEE', prostheticSide: 'left' } });
const lpChair = { ...lpOk, wheelchair: true };

const APP_SPORTS = ['football', 'basketball', 'tennis', 'footballAmputee', 'basketballWheelchair', 'tennisWheelchair', 'footballAmputeeGK', 'fitness'];
const SEATED = new Set(['basketballWheelchair', 'tennisWheelchair']);

const CASES = [
  ...APP_SPORTS.map(sport => ({ label: `sport ${sport}`, profile: { sport, trainingTrack: 'sport_only' }, lp: SEATED.has(sport) ? lpChair : sport === 'footballAmputee' ? lpAK : lpOk })),
  { label: 'rehab only', profile: { sport: 'rehab', trainingTrack: 'rehab_only' }, lp: lpOk },
  { label: 'rehab only / BK', profile: { sport: 'rehab', trainingTrack: 'rehab_only' }, lp: lpBK },
  { label: 'rehab only / AK', profile: { sport: 'rehab', trainingTrack: 'rehab_only' }, lp: lpAK },
  { label: 'rehab only / wheelchair', profile: { sport: 'rehab', trainingTrack: 'rehab_only' }, lp: lpChair },
  ...['football', 'footballAmputee', 'tennis', 'basketball'].map(rs => ({ label: `rehab + ${rs}`, profile: { sport: 'rehab', trainingTrack: 'rehab_sport', rehabSport: rs }, lp: rs === 'footballAmputee' ? lpBK : lpOk })),
];

const fourWeeks = { weeks: Array.from({ length: 4 }, () => ({ days: [{ focus: 'אימון מהירות' }, { focus: 'כוח' }, { focus: '' }] })) };
const SPORT_GOALS = new Set(['speed', 'power', 'technique', 'agility', 'strength', 'endurance', 'mobility']);
const REHAB_GOALS = new Set(['rehabStrength', 'rehabStability', 'rehabMobility', 'rehabSport']);

describe('Only the app\'s sports (no unrelated sports)', () => {
  it('the sport library holds the app sports + rehab / fitness + running only', () => {
    expect(Object.keys(SPORT_LIBRARY).sort()).toEqual([...APP_SPORTS, 'rehab', 'running'].sort());
  });

  it('no pattern belongs to a family outside the app', () => {
    const families = new Set(['field', 'court', 'racket', 'seated']);
    for (const p of Object.values(PATTERNS)) if (p.sports !== 'all') for (const f of p.sports) expect(families.has(f), f).toBe(true);
  });
});

describe('Goals follow the track', () => {
  it('rehab only → only rehab goals', () => {
    expect(goalOptions({ sport: 'rehab', trainingTrack: 'rehab_only' })).toEqual(['rehabStrength', 'rehabStability', 'rehabMobility']);
  });
  it('sport → only sport goals (speed, power, technique, agility)', () => {
    expect(goalOptions({ sport: 'football' })).toEqual(['speed', 'power', 'technique', 'agility']);
    expect(goalOptions({ sport: 'fitness' })).toEqual(['strength', 'endurance', 'power', 'mobility']);
  });
  it('rehab + sport → the rehab goals + the sport tools in rehab', () => {
    expect(goalOptions({ sport: 'rehab', trainingTrack: 'rehab_sport', rehabSport: 'football' })).toEqual(['rehabStrength', 'rehabStability', 'rehabMobility', 'rehabSport']);
  });
  it('selected goals are kept; goals of another track are dropped; legacy ids are mapped', () => {
    expect(selectedSessionGoals({ sport: 'football', goals: ['speed', 'rehabMobility'] })).toEqual(['speed']);
    expect(selectedSessionGoals({ sport: 'rehab', trainingTrack: 'rehab_only', goals: ['speed', 'weightLoss'] })).toEqual(['rehabStrength', 'rehabStability', 'rehabMobility']);
    expect(selectedSessionGoals({ sport: 'rehab', trainingTrack: 'rehab_only', goals: ['flexibility'] })).toEqual(['rehabMobility']);
    expect(selectedSessionGoals({ sport: 'fitness', goals: ['aerobic', 'weightLoss'] })).toEqual(['endurance']);
  });
  it('every offered goal has a name in Hebrew and English', () => {
    for (const id of Object.keys(PROFILE_GOALS)) expect(PROFILE_GOALS[id].name.he && PROFILE_GOALS[id].name.en).toBeTruthy();
  });
});

describe('The locked chain: track → goals → day goal → exercises → Ghost', () => {
  for (const c of CASES) {
    it(c.label, () => {
      const track = trackOf(c.profile);
      for (const selected of [undefined, goalOptions(c.profile).slice(0, 2)]) {
        const profile = { ...c.profile, goals: selected };
        const allowed = selectedSessionGoals(profile);
        // the offered goals belong to the track only
        for (const g of goalOptions(profile)) {
          expect(track === 'sport_only' ? SPORT_GOALS.has(g) : REHAB_GOALS.has(g), `${c.label}: offered ${g}`).toBe(true);
        }
        const built = rebuildPlanFromCatalog(fourWeeks, planContext(profile, c.lp, 'seed'));
        const family = sportFamilyOf(profile);
        for (const w of built.weeks) for (const d of w.days) {
          expect(allowed, `${c.label}: day goal ${d.goal}`).toContain(d.goal);
          expect(d.coherence.pct, `${c.label}/${d.goal} off ${d.coherence.offGoal}`).toBe(100);
          expect(d.coherence.mainOnGoal, `${c.label}/${d.goal}`).toBe(true);
          expect(d.exercises.length, `${c.label}/${d.goal}`).toBeGreaterThanOrEqual(5);
          for (const e of d.exercises) {
            const v = parseCatalogId(e.catalogId);
            expect(v, e.name).toBeTruthy();
            expect(catalogGhostSpec(e.catalogId), e.name).toBeTruthy();                // every exercise has its Ghost
            const pat = PATTERNS[v.pattern];
            expect(pat.sports === 'all' || pat.sports.includes(family), `${c.label}: ${v.pattern} not of ${family}`).toBe(true);
            if (track !== 'sport_only') {
              expect(v.tempo, `${c.label}: explosive in rehab`).not.toBe('explosive');
              expect(pat.qualities.includes('plyometric'), `${c.label}: plyometric in rehab`).toBe(false);
            }
          }
        }
      }
    });
  }
});

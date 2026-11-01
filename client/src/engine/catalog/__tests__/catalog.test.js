import { describe, it, expect } from 'vitest';
import { PATTERNS, patternFitsBody } from '../patterns.js';
import { buildCatalog, catalogItem, variationProfile, catalogGhostSpec, variationAxes, parseCatalogId } from '../catalog.js';
import { buildSession, coherenceReport, inferGoal, GOALS } from '../sessionPlanner.js';
import { rebuildPlanFromCatalog, planContext } from '../planBuilder.js';
import { ghostPose } from '../../warmupGhost.js';
import { profileGhostPose } from '../../exercise/profileGhost.js';
import { createExecutionTracker, updateExecution } from '../../exercise/profileEvaluator.js';
import { applySportContext } from '../../sports/sportLibrary.js';
import { getLimbProfile } from '../../limbProfile.js';
import { requiredEquipment } from '../../exercise/equipmentFit.js';
import { toExercise } from '../catalog.js';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const lpLeftAK = getLimbProfile({ scanData: { classification: 'TRANSFEMORAL_AMPUTEE', prostheticSide: 'left' } });
const lpLeftBK = getLimbProfile({ scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } });
const lpChair = { ...lpOk, wheelchair: true };
const FAMILIES = ['field', 'court', 'racket', 'endurance', 'rehab', 'strength', 'seated'];

const frame = (p, t) => profileGhostPose(p, t, lpOk).landmarks
  .map(q => (q.visibility ? { ...q, x: 0.5 + q.x * 0.17, y: 0.5 + q.y * 0.17, z: (q.z ?? 0) * 0.17 } : q));

describe('Catalog — every exercise has a live Ghost', () => {
  it('every catalog item in every family has a drawable Ghost', () => {
    for (const fam of FAMILIES) {
      for (const it of buildCatalog(fam, lpOk)) {
        const spec = catalogGhostSpec(it.id);
        expect(spec, it.id).toBeTruthy();
        expect(ghostPose(spec, 0.3, lpOk).segments.length, it.id).toBeGreaterThan(4);
      }
    }
  });

  it('every variation Ghost of a measured pattern is a clean, ≥85% demonstration (tempo / range / side)', () => {
    const seen = new Set();
    for (const it of buildCatalog('field', lpOk).concat(buildCatalog('court', lpOk), buildCatalog('racket', lpOk))) {
      const v = it.variation;
      const key = [v.pattern, v.tempo, v.range, v.side].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const p0 = variationProfile(it.id);
      if (!p0) continue;
      const p = applySportContext(p0, ['fitness']);
      const tr = createExecutionTracker(p, lpOk);
      let r; const issues = new Set();
      for (let ms = 0; ms <= 3 * p.ghost.periodMs; ms += 50) {
        r = updateExecution(tr, frame(p, (ms % p.ghost.periodMs) / p.ghost.periodMs), ms);
        r.issues.forEach(i => issues.add(i.id));
      }
      expect([...issues], key).toEqual([]);
      expect(r.accuracy, key).toBeGreaterThanOrEqual(85);
    }
    expect(seen.size).toBeGreaterThan(60);
  });

  it('a working-side variation moves that leg in the Ghost', () => {
    const left = catalogGhostSpec('shadowKick|standard|full|left|k6');
    const right = catalogGhostSpec('shadowKick|standard|full|right|k6');
    // facing the camera, "forward" is toward the camera (more negative depth z)
    const kneeZ = (spec, side) => ghostPose(spec, 0.5, lpOk).landmarks[side === 'left' ? 25 : 26].z;
    // the working knee is forward at the strike, the support knee stays over the foot
    expect(kneeZ(left, 'left')).toBeLessThan(kneeZ(left, 'right'));
    expect(kneeZ(right, 'right')).toBeLessThan(kneeZ(right, 'left'));
  });

  it('ids round-trip; invalid ids are rejected', () => {
    const it = buildCatalog('field', lpOk)[17];
    expect(catalogItem(it.id).name).toEqual(it.name);
    expect(parseCatalogId('nope|x|y|z|w')).toBeNull();
    expect(parseCatalogId('squat|standard|full|left|s3r8')).toBeNull();     // squat is not unilateral
  });

  it('catalog size per sport family (variations of real patterns)', () => {
    const sizes = Object.fromEntries(FAMILIES.map(f => [f, buildCatalog(f, lpOk).length]));
    const patterns = Object.fromEntries(FAMILIES.map(f => [f, new Set(buildCatalog(f, lpOk).map(i => i.patternId)).size]));
    console.log('catalog sizes', JSON.stringify(sizes), 'patterns', JSON.stringify(patterns));
    for (const f of ['field', 'court', 'racket', 'strength', 'endurance', 'rehab']) expect(sizes[f], f).toBeGreaterThanOrEqual(300);
  });
});

describe('Equipment', () => {
  it('no catalog exercise needs equipment (the equipment fit never replaces a catalog exercise)', () => {
    for (const fam of FAMILIES) for (const it of buildCatalog(fam, lpOk)) {
      expect([...requiredEquipment(toExercise(it))], it.id).toEqual([]);
      // and the pattern itself names no equipment (shadow / bodyweight by construction)
      expect(/משקול|dumbbell|גומי|band/i.test(it.name.he + it.name.en), it.id).toBe(false);
    }
  });
});

describe('Body fit', () => {
  it('above-knee amputee: no two-leg jumps / runs; wheelchair: nothing standing or on the floor', () => {
    const ak = buildCatalog('field', lpLeftAK);
    expect(ak.some(i => PATTERNS[i.patternId].needs.includes('twoLegs'))).toBe(false);
    expect(ak.length).toBeGreaterThan(50);
    const chair = buildCatalog('seated', lpChair);
    expect(chair.every(i => !PATTERNS[i.patternId].needs.some(n => ['standing', 'floor', 'twoLegs'].includes(n)))).toBe(true);
    expect(chair.length).toBeGreaterThan(20);
    expect(patternFitsBody(PATTERNS.jumpSquat, lpLeftBK)).toBe(true);     // a below-knee prosthesis keeps both legs working
  });
});

describe('Coherent sessions — one goal, every exercise serves it', () => {
  it('football speed session: the main block is entirely speed / acceleration, 100% coherent', () => {
    for (let k = 0; k < 10; k++) {
      const s = buildSession({ goal: 'speed', family: 'field', lp: lpOk, seed: `u${k}` });
      expect(s.coherence.pct, `seed ${k}`).toBe(100);
      expect(s.coherence.mainOnGoal).toBe(true);
      const main = s.items.filter(x => x.role === 'main');
      expect(main.length).toBe(4);
      for (const x of main) expect(x.item.qualities.some(q => ['speed', 'acceleration'].includes(q)), x.item.id).toBe(true);
      expect(new Set(s.items.map(x => x.item.patternId)).size).toBe(s.items.length);    // no pattern twice (speed)
    }
  });

  it('every goal in every family is 100% coherent', () => {
    for (const fam of ['field', 'court', 'racket', 'strength', 'endurance']) {
      for (const goal of Object.keys(GOALS)) {
        if (goal === 'technique' && ['strength', 'endurance'].includes(fam)) continue;
        if (['balanceCore', 'upperBody'].includes(goal)) continue;      // adapted-sport goals: covered by the chain tests
        const s = buildSession({ goal, family: fam, sportFamily: fam, lp: lpOk, seed: 'x' });
        expect(s.items.length, `${fam}/${goal}`).toBeGreaterThanOrEqual(6);
        expect(s.coherence.pct, `${fam}/${goal} off: ${s.coherence.offGoal}`).toBe(100);
      }
    }
  });

  it('rehab + sport: rehab first (main = rehab / stability, controlled), the sport only as safe technique, no plyometrics', () => {
    const s = buildSession({ goal: 'rehabSport', family: 'rehab', sportFamily: 'field', lp: lpLeftBK, seed: 'r1' });
    const main = s.items.filter(x => x.role === 'main');
    for (const x of main) expect(x.item.qualities.some(q => ['rehab', 'stability'].includes(q)), x.item.id).toBe(true);
    for (const x of s.items) {
      expect(x.item.qualities.includes('plyometric'), x.item.id).toBe(false);
      expect(x.item.variation.tempo, x.item.id).not.toBe('explosive');
    }
    expect(s.items.filter(x => x.role === 'support').some(x => x.item.qualities.includes('technique'))).toBe(true);
    expect(s.coherence.pct).toBe(100);
  });

  it('variety: different days differ, the same day is stable, a week does not repeat exercises', () => {
    const a = buildSession({ goal: 'strength', family: 'field', lp: lpOk, seed: 'w0|d0' });
    const a2 = buildSession({ goal: 'strength', family: 'field', lp: lpOk, seed: 'w0|d0' });
    const b = buildSession({ goal: 'strength', family: 'field', lp: lpOk, seed: 'w1|d0' });
    expect(a.items.map(x => x.item.id)).toEqual(a2.items.map(x => x.item.id));
    expect(a.items.map(x => x.item.id)).not.toEqual(b.items.map(x => x.item.id));
    const plan = { weeks: [{ days: [{ focus: 'כוח' }, { focus: 'כוח' }, { focus: 'כוח' }] }] };
    const built = rebuildPlanFromCatalog(plan, { track: 'sport_only', family: 'field', sportFamily: 'field', lp: lpOk, seedBase: 'u' });
    const ids = built.weeks[0].days.flatMap(d => d.exercises.map(e => e.catalogId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('coherenceReport flags an exercise thrown in from another track', () => {
    const s = buildSession({ goal: 'speed', family: 'field', lp: lpOk, seed: 'z' });
    const intruder = { item: catalogItem('bicepCurl|standard|full|both|s3r12'), role: 'main' };
    const rep = coherenceReport([...s.items, intruder], 'speed');
    expect(rep.pct).toBeLessThan(100);
    expect(rep.mainOnGoal).toBe(false);
    expect(rep.offGoal).toContain('bicepCurl|standard|full|both|s3r12');
  });
});

describe('Day goal + plan rebuild', () => {
  it('the day goal is always one of the allowed goals (the AI focus only picks among them)', () => {
    const sport = ['speed', 'power', 'technique', 'agility'];
    expect(inferGoal({ focus: 'אימון מהירות והאצות' }, { allowed: sport })).toBe('speed');
    expect(inferGoal({ focus: 'Explosive power' }, { allowed: sport })).toBe('power');
    expect(inferGoal({ focus: 'אימון מהירות' }, { allowed: ['rehabStrength', 'rehabStability'] })).toBe('rehabStrength');
    expect(inferGoal({ focus: 'יציבות' }, { allowed: ['rehabStrength', 'rehabStability'] })).toBe('rehabStability');
    expect(inferGoal({ focus: 'כוח' }, { allowed: ['rehabStrength', 'rehabMobility'] })).toBe('rehabStrength');
    expect(inferGoal({}, { allowed: sport, dayIndex: 1 })).toBe('power');
  });

  it('a whole plan: each day coherent, each exercise with a catalog id (Ghost), training parameters set', () => {
    const profile = { sport: 'football', trainingTrack: 'sport_only', uid: 'u1' };
    const plan = { weeks: [{ days: [{ focus: 'מהירות' }, { focus: 'כוח' }, { focus: 'טכניקה' }] }, { days: [{ focus: 'זריזות' }] }] };
    const built = rebuildPlanFromCatalog(plan, planContext(profile, lpOk));
    for (const w of built.weeks) for (const d of w.days) {
      expect(d.coherence.pct).toBe(100);
      for (const e of d.exercises) {
        expect(catalogGhostSpec(e.catalogId), e.name).toBeTruthy();
        expect(e.sets).toBeGreaterThan(0);
        expect(Number(e.reps)).toBeGreaterThan(0);
      }
    }
    expect(built.weeks[0].days[0].goal).toBe('speed');
    expect(built.weeks[0].days[2].exercises.some(e => e.catalogId.startsWith('shadowKick'))).toBe(true);
  });

  it('every variation axis set is non-empty', () => {
    for (const id of Object.keys(PATTERNS)) {
      const ax = variationAxes(id);
      for (const k of ['tempos', 'ranges', 'sides', 'doses']) expect(ax[k].length, `${id}.${k}`).toBeGreaterThan(0);
    }
  });
});

// The owner's list after the 3rd field video, 2026-10-18: a professional coach in EVERY exercise and
// sport (a full technical explanation of every wrong movement), and a small room is never nagged
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { EXPERT_PROFILES, FAMILY_PROFILES } from '../exercise/exerciseProfiles';
import { SPORT_LIBRARY, applySportContext } from '../sports/sportLibrary';
import { profileGhostPose } from '../exercise/profileGhost';
import { createExecutionTracker, updateExecution, STATIC_COACH_AFTER } from '../exercise/profileEvaluator';
import { kneeTrack } from '../exercise/kinematics';
import { assessSetup, SOFT_CODES, ROOM_TIP } from '../exercise/setupCoach';
import { createCoachBrain, brainOfferCorrection, brainDecide, brainAttempt } from '../coachBrain/brain';
import { renderCorrection } from '../coachBrain/policy';
import { TECHNIQUE_WHY, techniqueWhy } from '../../utils/techniqueWhy';
import { getLimbProfile } from '../limbProfile';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const frameAt = (p, ms, lp = lpOk) => profileGhostPose(p, (ms % p.ghost.periodMs) / p.ghost.periodMs, lp).landmarks
  .map(q => (q.visibility ? { ...q, x: 0.5 + q.x * 0.17, y: 0.5 + q.y * 0.17, z: (q.z ?? 0) * 0.17, visibility: 0.95 } : q));

describe('every correction in every exercise and sport carries its professional explanation', () => {
  it('every rule (position + flow) of every profile, in every sport, on crutches or not, has a why', () => {
    const missing = [];
    for (const base of [...Object.values(EXPERT_PROFILES), ...Object.values(FAMILY_PROFILES)]) {
      for (const ctx of Object.keys(SPORT_LIBRARY)) {
        for (const crutches of [false, true]) {
          const p = applySportContext(base, [ctx], { crutches });
          for (const r of [...(p.rules || []), ...(p.dynamics || [])]) {
            if (!(r.why?.he?.length > 15 && r.why?.en?.length > 15)) missing.push(`${p.id}/${ctx}/${r.id}`);
          }
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('every correction of the older analyzers has its why (no slogan without the reason)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../utils/exerciseAnalysis.js'), 'utf8');
    const texts = [...src.matchAll(/type: 'warning', text: '([^']+)'/g)].map(m => m[1]).filter(t => !/^[A-Za-z]+$/.test(t));
    expect(texts.length).toBeGreaterThan(30);
    expect([...new Set(texts)].filter(t => !techniqueWhy(t))).toEqual([]);
    for (const w of Object.values(TECHNIQUE_WHY)) expect(w.he.length > 20 && w.en.length > 20).toBe(true);
  });

  it('the first correction of an error is said in FULL: what to do + why + how it feels', () => {
    const rule = { id: 'x', msg: { he: 'רד נמוך יותר', en: 'Go lower' }, why: { he: 'כך השריר עובד בטווח המלא', en: 'so the muscle works the full range' }, external: { he: 'דחוף את הרצפה', en: 'Push the floor' } };
    const t = renderCorrection(rule, 'full', true);
    expect(t).toContain('רד נמוך יותר');
    expect(t).toContain('כך השריר עובד');
    expect(t).toContain('טיפ: דחוף את הרצפה');
  });

  it('the coach brain explains in full the first time, and a position error comes before a tempo error', () => {
    const p = EXPERT_PROFILES.squat;
    const brain = createCoachBrain({ profile: p, savedPolicy: null });
    const shallow = p.rules.find(r => r.id === 'too_shallow');
    brainOfferCorrection(brain, shallow);
    brainOfferCorrection(brain, { id: 'tempo_lowering', severity: 'error', msg: { he: 'לאט', en: 'slow' }, feature: 'lowerMs' });
    brainAttempt(brain, { type: 'rep' }, { now: 1000, errorIds: ['too_shallow'] });
    const say = brainDecide(brain, { now: 1500, sinceVoiceMs: 99999, he: true });
    expect(say.kind).toBe('correction');
    expect(say.style).toBe('full');
    expect(say.text).toContain(shallow.msg.he);
    expect(say.text).toContain(shallow.why.he);
  });

  it('a HOLD (plank) is coached too — there are no reps to wait between', () => {
    const p = EXPERT_PROFILES.plank;
    const brain = createCoachBrain({ profile: p, savedPolicy: null });
    brainOfferCorrection(brain, p.rules.find(r => r.severity === 'error'));
    const say = brainDecide(brain, { now: 5000, sinceVoiceMs: 99999, he: true });
    expect(say?.kind).toBe('correction');
  });
});

describe('position errors are coached by voice (not only shown) — patiently', () => {
  // a squat that never reaches depth: the Ghost's peak knee at 135° (too shallow)
  const p = EXPERT_PROFILES.squat;
  const shallow = { ...p, ghost: { ...p.ghost, peak: { ...p.ghost.peak, knee: 135, hip: 120 } } };
  it(`a squat too shallow in ${STATIC_COACH_AFTER} reps in a row → explained once; not every rep`, () => {
    const tr = createExecutionTracker(p, lpOk);
    const coached = [];
    for (let ms = 0; ms <= 7 * p.ghost.periodMs; ms += 50) coached.push(...updateExecution(tr, frameAt(shallow, ms), ms).coaching.map(r => r.id));
    expect(coached.filter(id => id === 'too_shallow').length).toBe(1);
  });
  it('a clean squat is never coached', () => {
    const tr = createExecutionTracker(p, lpOk);
    const coached = [];
    for (let ms = 0; ms <= 6 * p.ghost.periodMs; ms += 50) coached.push(...updateExecution(tr, frameAt(p, ms), ms).coaching);
    expect(coached).toEqual([]);
  });
});

describe('knees caving in (frontal view) — measured only when it can be measured', () => {
  const front = (kneeGap, ankleGap = 0.2) => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    const set = (i, x, y) => { lm[i] = { x, y, z: 0, visibility: 0.95 }; };
    set(11, 0.42, 0.3); set(12, 0.58, 0.3); set(23, 0.45, 0.55); set(24, 0.55, 0.55);
    set(25, 0.5 - kneeGap / 2, 0.72); set(26, 0.5 + kneeGap / 2, 0.72);
    set(27, 0.5 - ankleGap / 2, 0.9); set(28, 0.5 + ankleGap / 2, 0.9);
    return lm;
  };
  it('knees over the feet ≈ 1; caving in < 0.75', () => {
    expect(kneeTrack(front(0.2))).toBeCloseTo(1, 1);
    expect(kneeTrack(front(0.1))).toBeLessThan(0.75);
  });
  it('feet together / a prosthetic leg → not judged', () => {
    expect(kneeTrack(front(0.02, 0.03))).toBeNull();
    expect(kneeTrack(front(0.1), { left_leg: { state: 'prosthetic', level: 'below_knee' } })).toBeNull();
  });
  it('the squat judges it from the front only', () => {
    const r = EXPERT_PROFILES.squat.rules.find(x => x.id === 'knee_valgus');
    expect(r).toMatchObject({ metric: 'kneeTrack', view: 'front', severity: 'error' });
    expect(r.why.he).toContain('הרצועה הצולבת');
  });
});

describe('a small room is never nagged: only a body really out of the picture blocks', () => {
  const squat = EXPERT_PROFILES.squat;
  const base = () => frameAt(squat, 0);
  it('the framing fixes are ROOM fixes (soft); a missing body / the light / the orientation are not', () => {
    expect(SOFT_CODES).toEqual(expect.arrayContaining(['step_back', 'feet_step_back', 'tilt_down', 'tilt_up']));
    expect(assessSetup(null, squat, lpOk).issue.soft).toBeFalsy();
    expect(ROOM_TIP.he).toContain('החדר קטן');
  });
  it('too close but every measured joint in the picture → counting stays open, a tip only', () => {
    const lm = base().map(p => (p.visibility ? { ...p, x: 0.5 + (p.x - 0.5) * 1.75, y: 0.42 + (p.y - 0.5) * 1.75 } : p));
    const soft = assessSetup(lm, squat, lpOk).issue;
    const tr = createExecutionTracker(squat, lpOk);
    let r;
    for (let ms = 0; ms < 1000; ms += 50) r = updateExecution(tr, lm, ms);
    expect(soft?.soft).toBe(true);                       // the old coach: "step back" — blocking
    expect(r.inView).toBe(true);
    expect(r.setup).toBeNull();
    expect(r.hint?.code).toBe(soft.code);
  });
  it('the legs really out of the picture → blocked, with a fix a small room can do (tilt the screen)', () => {
    const lm = base().map((p, i) => ([25, 26, 27, 28, 29, 30, 31, 32].includes(i) ? { ...p, y: 1.4, visibility: 0.05 } : p));
    const tr = createExecutionTracker(squat, lpOk);
    let r;
    for (let ms = 0; ms < 1000; ms += 50) r = updateExecution(tr, lm, ms);
    expect(r.inView).toBe(false);
    expect(r.setup).not.toBeNull();
    expect(r.setup.he).toMatch(/הטה|התרחק/);
  });
});

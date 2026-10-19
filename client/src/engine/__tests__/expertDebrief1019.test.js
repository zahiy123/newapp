// The owner's core requirement, 2026-10-18: a top coach + physio in every exercise — fine nuances
// detected precisely, a SHORT immediate cue during the set, a full expert analysis in the rest
import { describe, it, expect } from 'vitest';
import { strikeContact } from '../exercise/motionFeatures';
import { heelLift, kneeIn } from '../exercise/kinematics';
import { EXPERT_PROFILES } from '../exercise/exerciseProfiles';
import { profileGhostPose } from '../exercise/profileGhost';
import { createExecutionTracker, updateExecution, resetSetLog } from '../exercise/profileEvaluator';
import { liveCue } from '../coachBrain/policy';
import { buildDebrief, measuredLine } from '../coachBrain/debrief';
import { techniqueWhy } from '../../utils/techniqueWhy';
import { getLimbProfile } from '../limbProfile';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const blank = () => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
const put = (lm, i, x, y) => { lm[i] = { x, y, z: 0, visibility: 0.95 }; };

// a frontal right leg: hip (0.55, 0.5), knee (0.55, 0.7), ankle (0.55, 0.9); the foot set per case
function leg(heel, toe) {
  const lm = blank();
  put(lm, 23, 0.45, 0.5); put(lm, 24, 0.55, 0.5); put(lm, 26, 0.55, 0.7); put(lm, 28, 0.55, 0.9);
  put(lm, 30, ...heel); put(lm, 32, ...toe);
  return lm;
}

describe('the contact surface of a pass / kick — told precisely', () => {
  it('foot turned out, toes up (a locked ankle): the inside of the foot — the ankle ≈ 90°', () => {
    const c = strikeContact(leg([0.53, 0.91], [0.63, 0.9]), 'right');
    expect(c.footOpen).toBeGreaterThan(0.45);
    expect(c.ankleDeg).toBeLessThan(120);
    expect(c.contactToe).toBeNull();
  });
  it('foot turned out but the toes dropped (a loose / pointed ankle): > 140°', () => {
    const c = strikeContact(leg([0.53, 0.88], [0.6, 0.98]), 'right');
    expect(c.footOpen).toBeGreaterThan(0.45);
    expect(c.ankleDeg).toBeGreaterThan(140);
  });
  it('foot pointing at the camera: toes level = a toe-poke; toes dropped = the laces', () => {
    const toe = strikeContact(leg([0.55, 0.9], [0.555, 0.91]), 'right');
    expect(toe.contactToe).toBe(1);
    expect(toe.contactLaces).toBe(0);
    const laces = strikeContact(leg([0.55, 0.89], [0.556, 0.99]), 'right');
    expect(laces.contactLaces).toBe(1);
    expect(laces.contactToe).toBe(0);
  });
  it('the pass judges toes / laces / the ankle; the laces kick judges a toe-poke — frontal, right after the rep', () => {
    const ids = EXPERT_PROFILES.shadowPass.dynamics.map(d => d.id);
    expect(ids).toEqual(expect.arrayContaining(['pass_toe', 'pass_laces', 'pass_ankle']));
    expect(EXPERT_PROFILES.footballKick.dynamics.some(d => d.id === 'kick_toe')).toBe(true);
    for (const id of ['pass_toe', 'pass_laces', 'pass_ankle']) {
      const r = EXPERT_PROFILES.shadowPass.dynamics.find(d => d.id === id);
      expect(r).toMatchObject({ view: 'front', coachNow: true });
      expect(r.why && r.how && r.cue).toBeTruthy();
    }
  });
});

describe('physio-level joint checks', () => {
  it('heel lift: heels down ≈ 0; a heel 0.1 leg-lengths above the toes is flagged; a prosthetic foot never', () => {
    const lm = blank();
    put(lm, 23, 0.5, 0.5); put(lm, 27, 0.5, 0.9); put(lm, 29, 0.48, 0.92); put(lm, 31, 0.56, 0.92);
    expect(heelLift(lm)).toBeCloseTo(0, 5);
    put(lm, 29, 0.48, 0.88);
    expect(heelLift(lm)).toBeGreaterThan(0.07);
    expect(heelLift(lm, { left_leg: { state: 'prosthetic', level: 'below_knee' } })).toBeNull();
  });
  it('single-leg knee collapse: the standing knee drifting to the midline is measured', () => {
    const lm = blank();
    put(lm, 23, 0.45, 0.5); put(lm, 24, 0.55, 0.5);
    put(lm, 25, 0.45, 0.7); put(lm, 27, 0.45, 0.92);          // the standing (left) leg, straight
    put(lm, 26, 0.6, 0.65); put(lm, 28, 0.62, 0.75);          // the free leg, lifted
    expect(Math.abs(kneeIn(lm))).toBeLessThan(0.02);
    put(lm, 25, 0.5, 0.7);                                     // the knee drifts toward the midline
    expect(kneeIn(lm)).toBeGreaterThan(0.1);
  });
});

describe('during the set: a short sideline cue', () => {
  it('the cue is the rule\'s own short words, never the explanation', () => {
    const r = EXPERT_PROFILES.shadowPass.dynamics.find(d => d.id === 'pass_ankle');
    expect(liveCue(r, true)).toBe('נעל את הקרסול — אצבעות למעלה!');
    const sq = EXPERT_PROFILES.squat.rules.find(x => x.id === 'too_shallow');
    expect(liveCue(sq, true)).toBe('רד עמוק יותר');
  });
});

describe('in the rest: the expert analysis, from what was measured', () => {
  const frameAt = (p, ms) => profileGhostPose(p, (ms % p.ghost.periodMs) / p.ghost.periodMs, lpOk).landmarks
    .map(q => (q.visibility ? { ...q, x: 0.5 + q.x * 0.17, y: 0.5 + q.y * 0.17, z: (q.z ?? 0) * 0.17, visibility: 0.95 } : q));
  const p = EXPERT_PROFILES.squat;
  const shallow = { ...p, ghost: { ...p.ghost, peak: { ...p.ghost.peak, knee: 135, hip: 120 } } };

  it('a set of shallow squats → the set log, then: what, how often, the measured value vs. the target, why, how, one goal', () => {
    const tr = createExecutionTracker(p, lpOk);
    for (let ms = 0; ms <= 5 * p.ghost.periodMs; ms += 50) updateExecution(tr, frameAt(shallow, ms), ms);
    const e = tr.log.rules.too_shallow;
    expect(tr.log.attempts).toBeGreaterThanOrEqual(4);
    expect(e.n).toBeGreaterThanOrEqual(4);
    const d = buildDebrief({ log: tr.log, profile: p, reps: 0, accuracy: null, setNo: 1, he: true, name: 'זהי' });
    expect(d.speech).toContain('זהי, סט 1');
    expect(d.speech).not.toContain('אחוז');                         // no accuracy invented
    expect(d.speech).toContain('נעצרו לפני הטווח המלא');
    expect(d.speech).toContain('הדבר המרכזי לתיקון: רד עמוק יותר');
    expect(d.speech).toMatch(/מדדתי בממוצע 1[2-4]\d מעלות; היעד: בין 65 ל-105 מעלות/);
    expect(d.speech).toContain('למה זה חשוב:');
    expect(d.speech).toContain('איך מתקנים:');
    expect(d.speech).toContain('איך מתקנים: שלח את הישבן אחורה');      // the practical how, not a generic cue
    expect(d.speech).not.toContain('הטווח בברך היה מלא');               // never praise a measure that was wrong
    expect(d.speech).toContain('בסט הבא — מטרה אחת: רד עמוק יותר');
    expect(d.card.items.find(i => i.kind === 'fix').detail.length).toBeGreaterThanOrEqual(3);
  });

  it('a clean set → no fix invented; only what was MEASURED clean is praised', () => {
    const tr = createExecutionTracker(p, lpOk);
    for (let ms = 0; ms <= 5 * p.ghost.periodMs; ms += 50) updateExecution(tr, frameAt(p, ms), ms);
    const d = buildDebrief({ log: tr.log, profile: p, reps: 5, accuracy: 92, setNo: 2, he: true });
    expect(d.card.items.some(i => i.kind === 'fix')).toBe(false);
    expect(d.speech).toContain('דיוק 92 אחוז');
    expect(d.speech).toContain('מה היה טוב:');
    expect(d.speech).toContain('אותה איכות');
  });

  it('a new set starts a new log', () => {
    const tr = createExecutionTracker(p, lpOk);
    tr.log.attempts = 9;
    expect(resetSetLog(tr).attempts).toBe(0);
  });

  it('the older analyzers: their own correction + its why in the rest', () => {
    const d = buildDebrief({ reps: 8, accuracy: null, setNo: 1, he: true, legacy: { counts: { 'הברכיים קורסות פנימה! תפתח אותן החוצה לרוחב כתפיים': 3 } }, whyOf: techniqueWhy });
    expect(d.speech).toContain('הדבר המרכזי לתיקון: הברכיים קורסות פנימה');
    expect(d.speech).toContain('למה זה חשוב:');
    expect(d.speech).toContain('מטרה אחת: הברכיים קורסות פנימה');
  });

  it('numbers only for measures in degrees (never a made-up unit)', () => {
    const r = EXPERT_PROFILES.shadowPass.dynamics.find(d => d.id === 'pass_toe');
    expect(measuredLine(r, [1, 1], EXPERT_PROFILES.shadowPass, true)).toBeNull();
  });
});

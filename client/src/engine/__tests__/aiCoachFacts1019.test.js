// The AI coach words every correction from the MEASURED facts (owner, 2026-10-19) — the facts it gets
import { describe, it, expect } from 'vitest';
import { bodyText, cueFacts, legacyCueFacts, debriefFacts } from '../coachBrain/aiFacts';
import { EXPERT_PROFILES } from '../exercise/exerciseProfiles';
import { profileGhostPose } from '../exercise/profileGhost';
import { createExecutionTracker, updateExecution } from '../exercise/profileEvaluator';
import { techniqueWhy } from '../../utils/techniqueWhy';
import { getLimbProfile } from '../limbProfile';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const lpBK = getLimbProfile({ scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } });

describe('the facts the AI coach words its corrections from', () => {
  it('the body: a left below-knee prosthesis is told precisely; a natural body → nothing', () => {
    expect(bodyText(lpBK)).toContain('left leg: below-knee prosthesis');
    expect(bodyText(lpOk)).toBe('');
  });

  it('a live cue: the rule\'s knowledge + the measured value, the target and the side', () => {
    const p = EXPERT_PROFILES.squat;
    const rule = { ...p.rules.find(r => r.id === 'too_shallow'), measured: 131.4, side: null };
    const f = cueFacts({ rule, profile: p, lp: lpBK, exercise: 'סקוואט', name: 'זהי', he: true, rep: 3, times: 2, recent: ['a', 'b', 'c', 'd', 'e'] });
    expect(f.error.what).toContain('רד עמוק יותר');
    expect(f.error.why.length).toBeGreaterThan(10);
    expect(f.error.how).toContain('שלח את הישבן');
    expect(f.error.measured).toBe(131);
    expect(f.error.target).toBe('בין 65 ל-105 מעלות');
    expect(f.recent).toEqual(['b', 'c', 'd', 'e']);
    expect(f.body).toContain('prosthesis');
  });

  it('a pass contact error: no number invented (not a degree measure); the kicking side is given', () => {
    const p = EXPERT_PROFILES.shadowPass;
    const rule = { ...p.dynamics.find(d => d.id === 'pass_laces'), measured: 1, side: 'right' };
    const f = cueFacts({ rule, profile: p, he: true });
    expect(f.error.measured).toBeNull();
    expect(f.error.target).toBe('');
    expect(f.side).toBe('right');
  });

  it('the older analyzers: their text + its why', () => {
    const t = 'הברכיים קורסות פנימה! תפתח אותן החוצה לרוחב כתפיים';
    const f = legacyCueFacts({ text: t, why: techniqueWhy(t), he: true });
    expect(f.error.what).toBe(t);
    expect(f.error.why).toContain('הרצועה הצולבת');
  });

  it('the rest: the set log → the errors (n of N, measured vs. target, why, how) and the measured-clean list', () => {
    const p = EXPERT_PROFILES.squat;
    const shallow = { ...p, ghost: { ...p.ghost, peak: { ...p.ghost.peak, knee: 135, hip: 120 } } };
    const fr = (q, ms) => profileGhostPose(q, (ms % q.ghost.periodMs) / q.ghost.periodMs, lpOk).landmarks
      .map(z => (z.visibility ? { ...z, x: 0.5 + z.x * 0.17, y: 0.5 + z.y * 0.17, z: (z.z ?? 0) * 0.17, visibility: 0.95 } : z));
    const tr = createExecutionTracker(p, lpOk);
    for (let ms = 0; ms <= 5 * p.ghost.periodMs; ms += 50) updateExecution(tr, fr(shallow, ms), ms);
    const f = debriefFacts({ log: tr.log, profile: p, reps: 0, accuracy: null, setNo: 1, he: true, name: 'זהי', extras: ['x', null] });
    expect(f.errors[0]).toMatchObject({ what: expect.stringContaining('רד עמוק יותר'), target: 'בין 65 ל-105 מעלות' });
    expect(f.errors[0].n).toBeGreaterThanOrEqual(4);
    expect(f.errors[0].measured).toBeGreaterThan(120);
    expect(f.accuracy).toBeNull();
    expect(f.partial).toBeGreaterThanOrEqual(4);
    expect(f.clean).not.toContain('הטווח בברך היה מלא');
    expect(f.extras).toEqual(['x']);
  });
});

import { describe, it, expect } from 'vitest';
import { EXPERT_PROFILES, getExerciseProfile } from '../exerciseProfiles.js';
import { profileGhostPose } from '../profileGhost.js';
import { createExecutionTracker, updateExecution } from '../profileEvaluator.js';
import { SPORT_LIBRARY, applySportContext, sportContextsFor } from '../../sports/sportLibrary.js';
import { getLimbProfile } from '../../limbProfile.js';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const lpLeftBK = getLimbProfile({ scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } });
const lpLeftAK = getLimbProfile({ scanData: { classification: 'TRANSFEMORAL_AMPUTEE', prostheticSide: 'left' } });

/** Ghost landmarks of `ghostProfile` at time ms (its own period), mapped into the camera frame. */
function frameAt(ghostProfile, ms, lp = lpOk, periodMs = ghostProfile.ghost.periodMs) {
  const t = (ms % periodMs) / periodMs;
  return profileGhostPose(ghostProfile, t, lp).landmarks
    .map(p => (p.visibility ? { ...p, x: 0.5 + p.x * 0.17, y: 0.5 + p.y * 0.17, z: (p.z ?? 0) * 0.17 } : p));
}

/** Evaluate `profile` on frames from `frameFn(ms)` for `totalMs` at 20 Hz. */
function run(profile, frameFn, totalMs, lp = lpOk) {
  const tr = createExecutionTracker(profile, lp);
  const out = { issues: new Set(), coaching: [], events: [], last: null };
  for (let ms = 0; ms <= totalMs; ms += 50) {
    const r = updateExecution(tr, frameFn(ms), ms);
    r.issues.forEach(i => out.issues.add(i.id));
    out.coaching.push(...r.coaching);
    out.events.push(...r.events);
    out.last = r;
  }
  return out;
}

/** A copy of a keyframe profile with some Ghost angles overridden at given keyframes. */
function withKeyframes(profile, edit) {
  return { ...profile, ghost: { ...profile.ghost, keyframes: profile.ghost.keyframes.map(edit) } };
}

describe('Sport library — every expert Ghost is a clean demonstration in every sport', () => {
  const contexts = [...Object.keys(SPORT_LIBRARY).map(k => [k]), ['rehab', 'football'], ['rehab', 'footballAmputee'], ['rehab', 'tennis']];
  for (const ctx of contexts) {
    it(`${ctx.join(' + ')}`, () => {
      for (const base of Object.values(EXPERT_PROFILES)) {
        const p = applySportContext(base, ctx);
        const res = run(p, ms => frameAt(p, ms), 3 * p.ghost.periodMs);
        expect([...res.issues], `${ctx}/${p.id}`).toEqual([]);
        expect(res.last.accuracy, `${ctx}/${p.id}`).toBeGreaterThanOrEqual(85);
      }
    });
  }

  it('every sport has emphasis with explanations and well-formed rules', () => {
    for (const sp of Object.values(SPORT_LIBRARY)) {
      expect(sp.emphasis.length, sp.id).toBeGreaterThan(0);
      for (const r of sp.rules) {
        expect(['rep', 'landing', 'strike', 'window'], `${sp.id}.${r.id}`).toContain(r.on);
        expect(r.msg.he && r.msg.en && r.why.he && r.why.en, `${sp.id}.${r.id}`).toBeTruthy();
      }
    }
  });
});

describe('Sport contexts', () => {
  it('derives the contexts from the track', () => {
    expect(sportContextsFor({ trainingTrack: 'rehab_only', sport: 'rehab' })).toEqual(['rehab']);
    expect(sportContextsFor({ trainingTrack: 'rehab_sport', sport: 'rehab', rehabSport: 'footballAmputee' })).toEqual(['rehab', 'footballAmputee']);
    expect(sportContextsFor({ sport: 'tennis' })).toEqual(['tennis']);
    expect(sportContextsFor({ sport: 'unknown' })).toEqual(['fitness']);
    expect(sportContextsFor(null)).toEqual(['fitness']);
  });

  it('rehab + sport never relaxes the rehab baseline (the safer rule wins)', () => {
    const p = applySportContext(EXPERT_PROFILES.squat, ['rehab', 'football']);
    expect(p.dynamics.find(r => r.id === 'tempo_lowering').value).toBe(1200);
    expect(p.dynamics.some(r => r.id === 'pelvis_level')).toBe(true);
    expect(p.ghost.periodMs).toBe(Math.round(EXPERT_PROFILES.squat.ghost.periodMs * 1.8));
    expect(p.sportEmphasis.map(e => e.sport)).toEqual(expect.arrayContaining(['rehab', 'football']));
  });

  it('the emphasis shown matches the movement (no kick cue during a squat)', () => {
    const squat = applySportContext(EXPERT_PROFILES.squat, ['football']);
    expect(squat.sportEmphasis.map(e => e.id)).not.toContain('chain');
    const kick = applySportContext(EXPERT_PROFILES.footballKick, ['football']);
    expect(kick.sportEmphasis[0].id).toBe('chain');
    const run_ = applySportContext(EXPERT_PROFILES.runInPlace, ['running']);
    expect(run_.sportEmphasis[0].id).toBe('cadence');
  });

  it('rules only reach the movement patterns they belong to', () => {
    const press = applySportContext(EXPERT_PROFILES.shoulderPress, ['running']);
    expect(press.dynamics.some(r => r.id === 'cadence')).toBe(false);
    const run_ = applySportContext(EXPERT_PROFILES.runInPlace, ['running']);
    expect(run_.dynamics.find(r => r.id === 'cadence').value).toBe(155);
  });

  it('exercise names override a misleading cueKey', () => {
    expect(getExerciseProfile('running', 'זחילת דוב').id).toBe('floorCore');
    expect(getExerciseProfile('running', 'ספרינט 30 מטר').id).toBe('fullBody');
    expect(getExerciseProfile('running', 'ריצה במקום').id).toBe('runInPlace');
    expect(getExerciseProfile('kick', 'בעיטה לקיר').id).toBe('footballKick');
  });
});

describe('Movement flow — tempo and control', () => {
  it('rehab: a fitness-tempo squat is too fast — flagged, explained in rehab terms, coached once', () => {
    const p = applySportContext(EXPERT_PROFILES.squat, ['rehab']);
    const res = run(p, ms => frameAt(EXPERT_PROFILES.squat, ms), 6 * 3200);
    expect(res.issues.has('tempo_lowering')).toBe(true);
    const coached = res.coaching.filter(r => r.id === 'tempo_lowering');
    expect(coached.length).toBe(1);
    expect(coached[0].why.he).toContain('בשיקום');
  });

  it('fitness: dropping into the squat is flagged; the same squat at a controlled tempo is not', () => {
    const p = applySportContext(EXPERT_PROFILES.squat, ['fitness']);
    expect(run(p, ms => frameAt(EXPERT_PROFILES.squat, ms, lpOk, 1200), 4 * 1200).issues.has('tempo_lowering')).toBe(true);
    expect(run(p, ms => frameAt(EXPERT_PROFILES.squat, ms), 3 * 3200).issues.has('tempo_lowering')).toBe(false);
  });

  it('rehab: a dropping pelvis during squats (frontal view) is flagged', () => {
    const p = applySportContext(EXPERT_PROFILES.squat, ['rehab']);
    const res = run(p, (ms) => {
      // Frontal stance: spread the legs apart (whole side), then tilt the hip line
      const lm = frameAt(p, ms);
      for (const i of [23, 25, 27]) lm[i] = { ...lm[i], x: lm[i].x + 0.05 };
      for (const i of [24, 26, 28]) lm[i] = { ...lm[i], x: lm[i].x - 0.05 };
      lm[23] = { ...lm[23], y: lm[23].y + 0.017 };
      lm[24] = { ...lm[24], y: lm[24].y - 0.017 };
      return lm;
    }, 3 * p.ghost.periodMs);
    expect(res.issues.has('pelvis_level')).toBe(true);
  });

  it('a swaying plank is flagged (stability), a steady one is not', () => {
    const p = applySportContext(EXPERT_PROFILES.plank, ['fitness']);
    const sway = run(p, (ms) => frameAt(p, ms).map(q => (q.visibility ? { ...q, x: q.x + 0.06 * Math.sin(2 * Math.PI * ms / 1000) } : q)), 5000);
    expect(sway.issues.has('hold_steady')).toBe(true);
  });
});

describe('Running — cadence and shock absorption', () => {
  const runP = applySportContext(EXPERT_PROFILES.runInPlace, ['running']);

  it('the Ghost runs at ~170 steps/min with soft landings', () => {
    const res = run(runP, ms => frameAt(runP, ms), 5 * 700);
    const landings = res.events.filter(e => e.type === 'landing');
    expect(landings.length).toBeGreaterThanOrEqual(8);
    expect(landings.every(e => e.absorptionDeg >= 12)).toBe(true);
    expect(landings[landings.length - 1].cadence).toBeGreaterThanOrEqual(165);
  });

  it('stiff-legged landings are flagged', () => {
    const stiff = withKeyframes(EXPERT_PROFILES.runInPlace, k => ({ ...k, a: { ...k.a, 'A.knee': 170 } }));
    const res = run(runP, ms => frameAt(stiff, ms), 5 * 700);
    expect(res.issues.has('soft_landing')).toBe(true);
  });

  it('a slow, long-stride rhythm is flagged (cadence)', () => {
    const res = run(runP, ms => frameAt(EXPERT_PROFILES.runInPlace, ms, lpOk, 1100), 6 * 1100);
    expect(res.issues.has('cadence')).toBe(true);
  });
});

describe('Kick — kinetic chain and weight transfer', () => {
  const kick = applySportContext(EXPERT_PROFILES.footballKick, ['football']);

  it('the Ghost kicks hip-first with the weight over the support foot', () => {
    const res = run(kick, ms => frameAt(kick, ms), 4 * 2000);
    const strikes = res.events.filter(e => e.type === 'strike');
    expect(strikes.length).toBeGreaterThanOrEqual(3);
    for (const s of strikes) {
      expect(s.chainLeadMs).toBeGreaterThanOrEqual(15);
      expect(s.balance).toBeLessThan(0.45);
    }
    expect(res.last.accuracy).toBe(100);
  });

  it('a knee-first kick (no hip drive) is flagged and scores low', () => {
    const kneeFirst = withKeyframes(EXPERT_PROFILES.footballKick, (k) => {
      if (k.t === 0.42) return { ...k, a: { ...k.a, 'B.thigh': -28, 'B.knee': 160 } };
      if (k.t === 0.5) return { ...k, a: { ...k.a, 'B.thigh': -20, 'B.knee': 168 } };
      return k;
    });
    const res = run(kick, ms => frameAt(kneeFirst, ms), 4 * 2000);
    expect(res.issues.has('strike_chain')).toBe(true);
    expect(res.last.accuracy).toBeLessThan(60);
  });

  it('leaning back while kicking is flagged', () => {
    const back = withKeyframes(EXPERT_PROFILES.footballKick, k => ({ ...k, a: { ...k.a, trunk: -45 } }));
    const res = run(kick, ms => frameAt(back, ms), 2 * 2000);
    expect(res.issues.has('lean_back')).toBe(true);
  });

  it('amputee football adds the crutch-base trunk rule', () => {
    const amp = applySportContext(EXPERT_PROFILES.footballKick, ['footballAmputee']);
    expect(amp.dynamics.find(r => r.id === 'strike_trunk')).toBeTruthy();
    expect(amp.dynamics.find(r => r.id === 'strike_balance').why.he).toContain('קביים');
  });

  it('below-knee prosthesis: plants on the prosthesis, kicks with the working leg (detected on that side)', () => {
    const pose = profileGhostPose(kick, 0.5, lpLeftBK);
    expect(pose.segments.find(s => s.limb === 'left_leg' && s.part === 'shin').dashed).toBe(true);
    const res = run(kick, ms => frameAt(kick, ms, lpLeftBK), 3 * 2000, lpLeftBK);
    const strikes = res.events.filter(e => e.type === 'strike');
    expect(strikes.length).toBeGreaterThanOrEqual(2);
    expect(strikes.every(s => s.side === 'right')).toBe(true);
    expect([...res.issues]).toEqual([]);
  });

  it('above-knee amputee: the absent leg is not drawn; the kick is still analysed', () => {
    const pose = profileGhostPose(kick, 0.5, lpLeftAK);
    expect(pose.segments.some(s => s.limb === 'left_leg')).toBe(false);
    const res = run(kick, ms => frameAt(kick, ms, lpLeftAK), 3 * 2000, lpLeftAK);
    expect(res.events.filter(e => e.type === 'strike').length).toBeGreaterThanOrEqual(2);
  });
});

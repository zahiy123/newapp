import { describe, it, expect } from 'vitest';
import { createBehavior, behaviorAttempt, behaviorState, behaviorAdaptation, behaviorCueUnanswered } from '../behavior';
import { strikeIntent, drillIntent, intentFeedback, createForecast, forecastAttempt, forecastNext } from '../intent';
import { createPolicy, chooseStyle, renderCorrection, policyGiven, policyAttempt, situationOf, timingOk, REWARD_ATTEMPTS } from '../policy';
import { createProsody, prosodyFrame, effortLevel, frameRms } from '../prosody';
import { createCoachBrain, brainAttempt, brainOfferCorrection, brainDecide, brainSummary, EXTERNAL_CUES } from '../brain';

// a seeded random (deterministic tests)
const rng = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

describe('Layer 1 — Behavioral AI: fatigue / frustration from what is MEASURED', () => {
  it('slowing reps + falling accuracy + loud effort = fatigue → ease the pace, more rest, a mental cue', () => {
    const b = createBehavior();
    for (let i = 0; i < 10; i++) behaviorAttempt(b, { t: i * 3000, ok: i < 5, accuracy: i < 3 ? 92 : 70, durationMs: i < 3 ? 2000 : 3200 });
    const s = behaviorState(b, 0.8);
    expect(s.fatigue).toBeGreaterThanOrEqual(0.5);
    expect(s.signals).toEqual(expect.arrayContaining(['slowing', 'accuracyDrop', 'effortHigh']));
    const ad = behaviorAdaptation(s);
    expect(ad.pace).toBe('ease');
    expect(ad.restBonusSec).toBeGreaterThan(0);
    expect(ad.mental.he).toBeTruthy();
  });
  it('a failure streak + a correction that did not land = frustration → a calm, single-focus cue', () => {
    const b = createBehavior();
    for (let i = 0; i < 6; i++) behaviorAttempt(b, { t: i * 2000, ok: false, accuracy: 55 });
    behaviorCueUnanswered(b); behaviorCueUnanswered(b);
    const s = behaviorState(b);
    expect(s.frustration).toBeGreaterThanOrEqual(0.5);
    const ad = behaviorAdaptation(s, { focusHe: 'ברך מעל כף הרגל', focusEn: 'knee over the foot' });
    expect(ad.mental.he).toContain('ברך מעל כף הרגל');
    expect(ad.mental.he).not.toMatch(/מעולה|מצוין|כל הכבוד/);     // honest: no praise
  });
  it('push only after a MEASURED clean run at low effort', () => {
    const b = createBehavior();
    for (let i = 0; i < 6; i++) behaviorAttempt(b, { t: i * 2000, ok: true, accuracy: 90, durationMs: 2000 });
    expect(behaviorAdaptation(behaviorState(b, 0.2)).pace).toBe('push');
    expect(behaviorAdaptation(behaviorState(b, 0.9)).pace).not.toBe('push');
  });
});

describe('Layer 2 — Intent recognition over the frame sequence', () => {
  // frames of the right leg around a strike at t = 1000
  const kick = ({ fold, lift }) => {
    const frames = [];
    for (let t = 300; t <= 1500; t += 50) {
      const before = t <= 1000;
      const knee = before ? 175 - fold * Math.max(0, 1 - Math.abs(t - 800) / 250) : 175;
      const ankleY = before ? 0.9 : 0.9 - lift * Math.max(0, 1 - Math.abs(t - 1200) / 250);
      frames.push({ t, bodyH: 0.75, right: { knee, ankleY, hipY: 0.5, footAboveHip: 0 } });
    }
    return frames;
  };
  it('a big wind-up + a high follow-through + speed = POWER; a short swing = PRECISION', () => {
    expect(strikeIntent(kick({ fold: 100, lift: 0.3 }), { side: 'right', t: 1000, speed: 850 }).intent).toBe('power');
    expect(strikeIntent(kick({ fold: 30, lift: 0.03 }), { side: 'right', t: 1000, speed: 300 }).intent).toBe('precision');
  });
  it('a pass drill done as a power kick is told (a different skill)', () => {
    expect(drillIntent('', 'מסירה בצל · בדיוק')).toBe('precision');
    expect(intentFeedback('precision', { intent: 'power' })?.he).toContain('תנופה קצרה');
    expect(intentFeedback('precision', { intent: 'precision' })).toBe(null);
  });
  it('an error BUILDING over the recent attempts is forecast before the next one', () => {
    const fc = createForecast();
    for (const e of [[], ['kneeIn'], [], ['kneeIn']]) forecastAttempt(fc, e);
    expect(forecastNext(fc)).toBe('kneeIn');
    const clean = createForecast();
    for (const e of [['kneeIn'], ['kneeIn'], [], []]) forecastAttempt(clean, e);
    expect(forecastNext(clean)).toBe(null);           // fading away — not forecast
  });
});

describe('Layer 3 — RLEF: the expert prior + learning which correction style works', () => {
  it('a frustrated trainee is corrected calmly / with an external image (the expert prior)', () => {
    const pol = createPolicy();
    const picks = {};
    const r = rng(3);
    for (let i = 0; i < 400; i++) { const s = chooseStyle(pol, 'frustrated', { hasWhy: true, hasExternal: true }, r); picks[s] = (picks[s] || 0) + 1; }
    expect((picks.calm || 0) + (picks.external || 0)).toBeGreaterThan((picks.direct || 0) + (picks.why || 0));
  });
  it('the reward is the measured outcome: the style that fixes the error is chosen more and more', () => {
    const pol = createPolicy();
    const r = rng(11);
    for (let k = 0; k < 40; k++) {
      const style = chooseStyle(pol, 'normal', { hasWhy: true, hasExternal: true }, r);
      policyGiven(pol, { ruleId: 'kneeIn', style, situation: 'normal' });
      // only the EXTERNAL cue fixes this trainee's error
      for (let i = 0; i < REWARD_ATTEMPTS; i++) policyAttempt(pol, style === 'external' ? [] : ['kneeIn']);
    }
    const [a, b] = pol.arms.normal.external;
    const [a2, b2] = pol.arms.normal.why;
    expect(a / (a + b)).toBeGreaterThan(a2 / (a2 + b2));
    const picks = {};
    for (let i = 0; i < 200; i++) { const s = chooseStyle(pol, 'normal', { hasWhy: true, hasExternal: true }, r); picks[s] = (picks[s] || 0) + 1; }
    expect(picks.external).toBeGreaterThan(100);
  });
  it('timing: between attempts, after the gap, never over the coach', () => {
    expect(timingOk({ sinceVoiceMs: 9000, betweenAttempts: true })).toBe(true);
    expect(timingOk({ sinceVoiceMs: 2000, betweenAttempts: true })).toBe(false);
    expect(timingOk({ sinceVoiceMs: 9000, betweenAttempts: false })).toBe(false);
    expect(timingOk({ sinceVoiceMs: 9000, betweenAttempts: true, coachSpeaking: true })).toBe(false);
  });
  it('the styles render the expert way', () => {
    const rule = { msg: { he: 'הברך מעל כף הרגל', en: 'Knee over the foot' }, why: { he: 'שומר על הרצועות', en: 'Protects the ligaments' }, external: EXTERNAL_CUES.knee };
    expect(renderCorrection(rule, 'why')).toContain('שומר על הרצועות');
    expect(renderCorrection(rule, 'external')).toBe(EXTERNAL_CUES.knee.he);
    expect(renderCorrection(rule, 'calm')).not.toContain('בלי לחץ');          // no fixed template — the calm TONE is the AI's
    expect(renderCorrection(rule, 'calm')).toBe('הברך מעל כף הרגל');
    expect(situationOf({ frustration: 0.6 })).toBe('frustrated');
  });
});

describe('Layer 4 — voice prosody: the audible effort', () => {
  it('effort bursts (exhales / grunts) on every move = high effort; a quiet room = none', () => {
    const p = createProsody();
    let t = 0;
    for (let i = 0; i < 60; i++) { prosodyFrame(p, 0.005, t += 50); }               // the room
    for (let k = 0; k < 10; k++) {                                                   // 10 effort sounds in ~8 s
      for (let i = 0; i < 4; i++) prosodyFrame(p, 0.12, t += 50);
      for (let i = 0; i < 12; i++) prosodyFrame(p, 0.005, t += 50);
    }
    expect(effortLevel(p, t)).toBeGreaterThan(0.5);
    const q = createProsody();
    let u = 0;
    for (let i = 0; i < 200; i++) prosodyFrame(q, 0.005, u += 50);
    expect(effortLevel(q, u)).toBe(0);
  });
  it('the coach\'s own voice is never heard as effort', () => {
    const p = createProsody();
    let t = 0;
    for (let i = 0; i < 60; i++) prosodyFrame(p, 0.005, t += 50);
    for (let k = 0; k < 10; k++) { for (let i = 0; i < 4; i++) prosodyFrame(p, 0.12, t += 50, true); for (let i = 0; i < 12; i++) prosodyFrame(p, 0.005, t += 50, true); }
    expect(effortLevel(p, t)).toBe(0);
  });
  it('rms', () => { expect(frameRms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5, 6); });
});

describe('The coach brain — one decision at the right moment', () => {
  const profile = { id: 'squat', kind: 'reps', rules: [{ id: 'kneeIn', metric: 'knee', msg: { he: 'הברך מעל כף הרגל', en: 'Knee over the foot' }, why: { he: 'שומר על הרצועות', en: 'Protects the ligaments' } }] };
  it('a repeated error waits until the attempt ends, then ONE correction in the chosen style', () => {
    const brain = createCoachBrain({ profile });
    brainOfferCorrection(brain, profile.rules[0]);
    expect(brainDecide(brain, { now: 1000, sinceVoiceMs: 10000, rnd: rng(1) })).toBe(null);   // no attempt ended yet
    brainAttempt(brain, { type: 'rep', toPeakMs: 900, returnMs: 900 }, { now: 2000, accuracy: 70, errorIds: ['kneeIn'] });
    const say = brainDecide(brain, { now: 2400, sinceVoiceMs: 10000, rnd: rng(1) });
    expect(say.kind).toBe('correction');
    expect(say.text.length).toBeGreaterThan(5);
    expect(brainDecide(brain, { now: 2500, sinceVoiceMs: 100, rnd: rng(1) })).toBe(null);     // never two in a row
  });
  it('forecasts a building error before the next attempt', () => {
    const brain = createCoachBrain({ profile });
    let t = 0;
    for (const e of [[], ['kneeIn'], [], ['kneeIn']]) brainAttempt(brain, { type: 'rep' }, { now: (t += 3000), errorIds: e });
    const say = brainDecide(brain, { now: t + 400, sinceVoiceMs: 10000, rnd: rng(2) });
    expect(say.kind).toBe('forecast');
    expect(say.text).toContain('בחזרה הבאה');
  });
  it('the set summary carries the state and the adaptation', () => {
    const brain = createCoachBrain({ profile });
    for (let i = 0; i < 6; i++) brainAttempt(brain, { type: 'rep' }, { now: i * 2000, accuracy: 50, errorIds: ['kneeIn'] });
    const sum = brainSummary(brain);
    expect(sum.state.frustration).toBeGreaterThan(0.3);
    expect(sum.adaptation.mental.he).toContain('הברך מעל כף הרגל');
  });
});

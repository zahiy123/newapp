import { describe, it, expect } from 'vitest';
import { createRepEvidence, evidenceFrame, evidenceOk, evidenceAccept, makeEvidenceGatedAnalyzer, makePresenceGatedAnalyzer, bodyInPicture, MIN_RANGE_DEG } from '../repEvidence';
import { behaviorAdaptation } from '../../coachBrain/behavior';

// a standing body; `kneeDeg` bends both knees (a squat)
function body(kneeDeg = 180, vis = 0.95) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const set = (i, x, y) => { lm[i] = { x, y, visibility: vis }; };
  set(11, 0.42, 0.25); set(12, 0.58, 0.25); set(13, 0.4, 0.38); set(14, 0.6, 0.38); set(15, 0.4, 0.5); set(16, 0.6, 0.5);
  set(23, 0.45, 0.5); set(24, 0.55, 0.5); set(25, 0.45, 0.7); set(26, 0.55, 0.7);
  const t = ((180 - kneeDeg) * Math.PI) / 180;           // the shin swings back as the knee bends
  set(27, 0.45 - 0.2 * Math.sin(t), 0.7 + 0.2 * Math.cos(t)); set(28, 0.55 - 0.2 * Math.sin(t), 0.7 + 0.2 * Math.cos(t));
  return lm;
}

describe('ANTI-GHOST COUNTING (IRON RULE): no count without real kinematics', () => {
  it('standing still / tracking jitter = NO rep, ever', () => {
    const ev = createRepEvidence();
    for (let t = 0; t < 4000; t += 50) evidenceFrame(ev, body(180 - (t % 100 === 0 ? 3 : 0)), t);
    expect(evidenceOk(ev, 4000)).toBe(false);
  });
  it('a real squat (a knee range far past the minimum, over a real duration) = a rep; the next one needs its own', () => {
    const ev = createRepEvidence();
    let t = 0;
    for (const k of [180, 160, 130, 100, 90, 110, 140, 170, 180]) evidenceFrame(ev, body(k), (t += 120));
    expect(evidenceOk(ev, t)).toBe(true);
    evidenceAccept(ev, t);
    evidenceFrame(ev, body(180), (t += 120));
    expect(evidenceOk(ev, t)).toBe(false);                   // no new movement → no second count
  });
  it('a twitch too fast to be a rep does not count', () => {
    const ev = createRepEvidence();
    evidenceFrame(ev, body(180), 0); evidenceFrame(ev, body(120), 60); evidenceFrame(ev, body(180), 120); evidenceFrame(ev, body(180), 180);
    expect(evidenceOk(ev, 200)).toBe(false);
  });
  it('KINETIC: a slow drift through the same range (no real velocity) is not a rep', () => {
    const ev = createRepEvidence();
    let t = 0;
    for (let k = 180; k >= 150; k -= 1) evidenceFrame(ev, body(k), (t += 1500));     // 30° over 45 s
    for (let k = 150; k <= 180; k += 1) evidenceFrame(ev, body(k), (t += 1500));
    expect(evidenceOk(ev, t)).toBe(false);
  });
  it('KINETIC: shaking back and forth (no flowing out-and-back) is not a rep', () => {
    const ev = createRepEvidence();
    let t = 0;
    for (let i = 0; i < 16; i++) evidenceFrame(ev, body(i % 2 ? 140 : 175), (t += 80));
    expect(evidenceOk(ev, t)).toBe(false);
  });
  it('KINETIC: one flowing squat — range, velocity, the ankle travels, one out-and-back — is a rep', () => {
    const ev = createRepEvidence();
    let t = 0;
    for (const k of [180, 165, 145, 120, 100, 95, 105, 130, 155, 175, 180]) evidenceFrame(ev, body(k), (t += 100));
    expect(evidenceOk(ev, t)).toBe(true);
  });
  it('joints not confidently seen give no evidence', () => {
    const ev = createRepEvidence();
    let t = 0;
    for (const k of [180, 130, 90, 130, 180]) evidenceFrame(ev, body(k, 0.4), (t += 200));
    expect(evidenceOk(ev, t)).toBe(false);
  });
  it('a loose analyzer that counts by itself is blocked unless the body really moved', () => {
    // an analyzer that "counts" on every call (the worst case of a noisy legacy counter)
    const loose = (lm, prev) => ({ ...prev, reps: (prev.reps || 0) + 1, feedback: { type: 'count', count: (prev.reps || 0) + 1 } });
    const evRef = { current: null };
    let clock = 0;
    const gated = makeEvidenceGatedAnalyzer(loose, evRef, () => clock);
    let st = {};
    for (let i = 0; i < 40; i++) { clock += 100; st = gated(body(180), st); }
    expect(st.reps || 0).toBe(0);                            // 40 "counts" while standing → 0
    for (const k of [160, 130, 100, 90, 110, 150, 180]) { clock += 120; st = gated(body(k), st); }
    expect(st.reps).toBe(1);                                 // one real squat → exactly one
    expect(MIN_RANGE_DEG).toBeGreaterThanOrEqual(20);
  });
  it('timed / hold seconds only while the body is really in the picture', () => {
    const ticking = (lm, prev) => ({ ...prev, reps: (prev.reps || 0) + 1 });
    const gated = makePresenceGatedAnalyzer(ticking);
    expect(gated(body(180), {}).reps).toBe(1);
    expect(gated(null, { reps: 5 }).reps).toBe(5);
    expect(gated(body(180, 0.3), { reps: 5 }).reps).toBe(5);
    expect(bodyInPicture(body(180))).toBe(true);
  });
});

describe('The coach brain is professional: every line cites what was measured', () => {
  it('fatigue: the measured slowdown and the accuracy drop are said', () => {
    const ad = behaviorAdaptation({ fatigue: 0.6, frustration: 0, measured: { slowPct: 35, accFrom: 90, accTo: 72 } });
    expect(ad.mental.he).toContain('35 אחוז');
    expect(ad.mental.he).toContain('מ-90 ל-72');
  });
  it('frustration: the failed attempts in a row are said; nothing measured → no generic line', () => {
    expect(behaviorAdaptation({ frustration: 0.6, measured: { failStreak: 4 } }, { focusHe: 'הברך מעל כף הרגל' }).mental.he).toContain('4 ניסיונות ברצף');
    expect(behaviorAdaptation({ fatigue: 0.35, frustration: 0, measured: {} }).mental).toBe(null);
  });
});

// The owner's field video, 2026-10-18 (a laptop camera, the "מסירה בצל · בעוצמה" drill, a prosthesis)
import { describe, it, expect } from 'vitest';
import { calibratedLean, uprightLeanProfile } from '../exercise/kinematics';
import { createExecutionTracker, calibrateUpright, stableUpright } from '../exercise/profileEvaluator';
import { applySportContext } from '../sports/sportLibrary';
import { getExerciseProfile } from '../exercise/exerciseProfiles';

describe('the trunk lean is calibrated to THIS camera, once, on the upright trainee', () => {
  it('a tilted camera that sees the upright trainee at 38°: an upright stance reads 0, a real lean still shows', () => {
    expect(calibratedLean(38, 38)).toBe(0);
    expect(calibratedLean(75, 38)).toBeCloseTo(37, 6);
  });
  it('only drills whose rules are "do not lean" maxima are calibrated; a drill that REQUIRES a lean never is', () => {
    expect(uprightLeanProfile(getExerciseProfile('kick', 'בעיטה'))).toBe(true);
    expect(uprightLeanProfile({ rules: [{ metric: 'trunkLean', op: '<', value: 15 }] })).toBe(false);
    expect(uprightLeanProfile({ rules: [{ metric: 'knee', op: '<', value: 90 }] })).toBe(false);
  });
  it('the calibration happens once, from the trainee verified upright, and is capped', () => {
    const tr = createExecutionTracker(getExerciseProfile('kick', 'בעיטה'), {});
    tr.leanRaw = 38;
    expect(calibrateUpright(tr)).toBe(38);
    tr.leanRaw = 80;
    expect(calibrateUpright(tr)).toBe(45);                  // never more than a camera can tilt
  });
  it('the tilt is the median of a STABLE upright stretch — a lean / a glitch never calibrates it', () => {
    const tr = createExecutionTracker(getExerciseProfile('kick', 'בעיטה'), {});
    const stable = Array.from({ length: 30 }, (_, i) => 37 + (i % 3));
    expect(stableUpright(stable)).toBe(true);
    expect(calibrateUpright(tr, stable)).toBe(38);
    const moving = Array.from({ length: 30 }, (_, i) => (i % 2 ? 20 : 50));
    expect(stableUpright(moving)).toBe(false);
    expect(stableUpright(stable.slice(0, 10))).toBe(false);  // too short
  });
});

describe('amputee football: crutch cues ONLY to a trainee on crutches today', () => {
  const base = getExerciseProfile('kick', 'בעיטה');
  const words = (p) => JSON.stringify([p.sportEmphasis, p.dynamics]);
  it('on a prosthesis (no crutches): no "קביים" anywhere in the cues', () => {
    const p = applySportContext(base, ['footballAmputee'], { crutches: false });
    expect(words(p)).not.toContain('קביים');
    expect(words(p)).toContain('רגל התמיכה');
  });
  it('on crutches: the crutch cues stay (the real amputee-football technique)', () => {
    const p = applySportContext(base, ['footballAmputee'], { crutches: true });
    expect(words(p)).toContain('קביים');
  });
});

import { createRepEvidence, evidenceFrame, evidenceOk, evidenceGroupFor } from '../training/repEvidence';
import { standingOnBothFeet, createMobilitySeen, mobilityFrame, SEEN_MS } from '../training/mobilitySeen';

// a frontal standing body; `elbowDeg` swings the arms, `kneeDeg` bends the knees
function body({ elbowDeg = 170, kneeDeg = 178, vis = 0.95 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const set = (i, x, y) => { lm[i] = { x, y, visibility: vis }; };
  set(11, 0.42, 0.25); set(12, 0.58, 0.25);
  const e = ((180 - elbowDeg) * Math.PI) / 180;
  set(13, 0.4, 0.38); set(14, 0.6, 0.38); set(15, 0.4 + 0.12 * Math.sin(e), 0.38 + 0.12 * Math.cos(e)); set(16, 0.6 - 0.12 * Math.sin(e), 0.38 + 0.12 * Math.cos(e));
  set(23, 0.45, 0.5); set(24, 0.55, 0.5); set(25, 0.45, 0.7); set(26, 0.55, 0.7);
  const k = ((180 - kneeDeg) * Math.PI) / 180;
  set(27, 0.45 - 0.2 * Math.sin(k), 0.7 + 0.2 * Math.cos(k)); set(28, 0.55 - 0.2 * Math.sin(k), 0.7 + 0.2 * Math.cos(k));
  return lm;
}

describe('a kick / pass is proven ONLY by the legs — a hand swing never counts (field video)', () => {
  it('the joint group follows the exercise', () => {
    expect(evidenceGroupFor({ profile: { kind: 'strike' } })).toBe('legs');
    expect(evidenceGroupFor({ cueKey: 'pass' })).toBe('legs');
    expect(evidenceGroupFor({ cueKey: 'chestPass' })).toBe('arms');
    expect(evidenceGroupFor({ profile: { kind: 'reps', joints: { elbow: {} } } })).toBe('arms');
  });
  it('standing still while swinging the arms: NO pass is counted', () => {
    const ev = createRepEvidence('legs');
    let t = 0;
    for (const e of [170, 140, 100, 70, 100, 140, 170]) evidenceFrame(ev, body({ elbowDeg: e }), (t += 100));
    expect(evidenceOk(ev, t, { strike: true })).toBe(false);
    const any = createRepEvidence('all');
    t = 0;
    for (const e of [170, 140, 100, 70, 100, 140, 170]) evidenceFrame(any, body({ elbowDeg: e }), (t += 100));
    expect(evidenceOk(any, t, { strike: true })).toBe(true);   // (what used to count it)
  });
  it('a real leg swing IS counted', () => {
    const ev = createRepEvidence('legs');
    let t = 0;
    for (const k of [178, 150, 115, 90, 120, 160, 178]) evidenceFrame(ev, body({ kneeDeg: k }), (t += 100));
    expect(evidenceOk(ev, t, { strike: true })).toBe(true);
  });
});

describe('today\'s mobility as the camera sees it (a crutch profile standing on a prosthesis)', () => {
  it('standing on both feet for 2 s = a prosthesis day; one foot in the air never', () => {
    expect(standingOnBothFeet(body(), 'left')).toBe(true);
    const oneFoot = body(); oneFoot[27] = { x: 0.45, y: 0.78, visibility: 0.95 };
    expect(standingOnBothFeet(oneFoot, 'left')).toBe(false);
    const ms = createMobilitySeen();
    for (let t = 0; t <= SEEN_MS + 200; t += 200) mobilityFrame(ms, body(), 'left', t);
    expect(ms.seen).toBe(true);
    const no = createMobilitySeen();
    for (let t = 0; t <= SEEN_MS + 200; t += 200) mobilityFrame(no, oneFoot, 'left', t);
    expect(no.seen).toBe(false);
  });
});

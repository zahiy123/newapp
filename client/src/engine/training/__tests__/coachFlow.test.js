import { describe, it, expect } from 'vitest';
import {
  isStartPosition, createStartGate, updateStartGate, isValidRep, updateWork, driveLine, withDrive, startPositionPrompt, START_HOLD_MS,
} from '../coachFlow.js';
import { EXPERT_PROFILES, FAMILY_PROFILES } from '../../exercise/exerciseProfiles.js';
import { profileGhostPose } from '../../exercise/profileGhost.js';
import { createExecutionTracker, updateExecution, measureProfile } from '../../exercise/profileEvaluator.js';

const frame = (p, t) => profileGhostPose(p, t, {}).landmarks
  .map(q => (q.visibility ? { ...q, x: 0.5 + q.x * 0.17, y: 0.5 + q.y * 0.17, z: (q.z ?? 0) * 0.17, visibility: 0.95 } : q));

describe('Start position', () => {
  it('squat: standing tall = start; the bottom of the squat is not', () => {
    const p = EXPERT_PROFILES.squat;
    expect(isStartPosition(p, measureProfile(p, frame(p, 0)))).toBe(true);
    expect(isStartPosition(p, measureProfile(p, frame(p, 0.5)))).toBe(false);
  });
  it('plank: only in the plank position; family profiles: positioning is enough', () => {
    const p = EXPERT_PROFILES.plank;
    expect(isStartPosition(p, measureProfile(p, frame(p, 0)))).toBe(true);
    expect(isStartPosition(p, { bodyLine: 110 })).toBe(false);
    expect(isStartPosition(FAMILY_PROFILES.armsStanding, {})).toBe(true);
  });
});

describe('Start gate — no false "let\'s start"', () => {
  it('opens only after the start position is held continuously', () => {
    const g = createStartGate();
    let open = false;
    for (let t = 0; t < START_HOLD_MS - 50; t += 50) open = updateStartGate(g, { positioned: true, confident: true, inStart: true }, t);
    expect(open).toBe(false);
    open = updateStartGate(g, { positioned: true, confident: true, inStart: true }, START_HOLD_MS + 10);
    expect(open).toBe(true);
  });
  it('noise (flickering detection) never opens it', () => {
    const g = createStartGate();
    let open = false;
    for (let t = 0; t < 5000; t += 50) open = updateStartGate(g, { positioned: (t / 50) % 3 !== 0, confident: true, inStart: true }, t);
    expect(open).toBe(false);
  });
  it('positioned but not in the start position (or an unreliable measurement) keeps it closed', () => {
    const g = createStartGate();
    let open = false;
    for (let t = 0; t < 3000; t += 50) open = updateStartGate(g, { positioned: true, confident: true, inStart: false }, t);
    expect(open).toBe(false);
    for (let t = 3000; t < 6000; t += 50) open = updateStartGate(g, { positioned: true, confident: false, inStart: true }, t);
    expect(open).toBe(false);
  });
});

describe('Exact rep counting', () => {
  it('real reps of the Ghost count, one per cycle', () => {
    const p = EXPERT_PROFILES.squat;
    const tr = createExecutionTracker(p, {});
    let valid = 0;
    for (let ms = 0; ms <= 5 * 3200; ms += 50) {
      for (const ev of updateExecution(tr, frame(p, (ms % 3200) / 3200), ms).events) if (isValidRep(ev)) valid += 1;
    }
    expect(valid).toBe(5);
  });
  it('standing still or sitting still counts nothing', () => {
    const p = EXPERT_PROFILES.squat;
    for (const t of [0, 0.5]) {                       // standing tall / sitting at the bottom
      const tr = createExecutionTracker(p, {});
      let valid = 0;
      for (let ms = 0; ms <= 10000; ms += 50) {
        const lm = frame(p, t).map(q => (q.visibility ? { ...q, x: q.x + (Math.random() - 0.5) * 0.004, y: q.y + (Math.random() - 0.5) * 0.004 } : q));
        for (const ev of updateExecution(tr, lm, ms).events) if (isValidRep(ev)) valid += 1;
      }
      expect(valid, `t=${t}`).toBe(0);
    }
  });
  it('a twitch (too fast to be a rep) does not count', () => {
    expect(isValidRep({ type: 'repCount', toPeakMs: 100, returnMs: 100 })).toBe(false);
    expect(isValidRep({ type: 'repCount', toPeakMs: 600, returnMs: 300 })).toBe(true);
    expect(isValidRep({ type: 'rep', toPeakMs: 600, returnMs: 500 })).toBe(false);      // the tempo event is not the count
  });
});

describe('Instant counting', () => {
  it('the count fires mid-return — before the trainee is back at rest', () => {
    const p = EXPERT_PROFILES.squat;
    const tr = createExecutionTracker(p, {});
    let countAt = null; let restAt = null;
    for (let ms = 0; ms <= 3200; ms += 50) {
      for (const ev of updateExecution(tr, frame(p, (ms % 3200) / 3200), ms).events) {
        if (isValidRep(ev) && countAt === null) countAt = ms;
        if (ev.type === 'rep' && restAt === null) restAt = ms;
      }
    }
    expect(countAt).not.toBeNull();
    expect(countAt).toBeLessThan(2900);           // well before the end of the 3.2 s rep
    expect(restAt === null || countAt < restAt).toBe(true);
  });
});

describe('Timed work: only real work counts', () => {
  it('running in place: working while striding, not while standing', () => {
    const p = EXPERT_PROFILES.runInPlace;
    const tr = createExecutionTracker(p, {});
    const st = {};
    let working = false;
    for (let ms = 0; ms <= 3000; ms += 50) working = updateWork(st, p, updateExecution(tr, frame(p, (ms % 700) / 700), ms), ms);
    expect(working).toBe(true);
    for (let ms = 3050; ms <= 6000; ms += 50) working = updateWork(st, p, updateExecution(tr, frame(p, 0), ms), ms);
    expect(working).toBe(false);
  });
});

describe('Drive voice', () => {
  it('rotates energetic lines with the name, never the same twice in a row', () => {
    const a = driveLine(0, 'זאהי', true);
    const b = driveLine(1, 'זאהי', true);
    expect(a).not.toBe(b);
    expect(a).toContain('זאהי');
    expect(withDrive('התרחק קצת מהמצלמה', 2, 'זאהי', true)).toMatch(/התרחק קצת מהמצלמה$/);
    expect(startPositionPrompt(3, null, false)).toContain('start position');
  });
});

import { splitLegOrder, legLabel, liftedLeg, splitStartText, splitSwitchText } from '../coachFlow.js';
import { getLimbProfile } from '../../limbProfile.js';

describe('Split balance sets — both legs, the coach calls the switch', () => {
  const bk = getLimbProfile({ scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } });
  it('starts on the base leg, then the prosthesis', () => {
    expect(splitLegOrder(bk)).toEqual({ first: 'right', second: 'left' });
    expect(splitLegOrder({})).toEqual({ first: 'right', second: 'left' });
    expect(legLabel('left', bk, true)).toBe('רגל שמאל — הפרוטזה');
    expect(liftedLeg('right')).toBe('left');
  });
  it('clear spoken start and switch lines', () => {
    expect(splitStartText(bk, true)).toContain('רגל ימין');
    expect(splitStartText(bk, true)).toContain('נחליף רגל');
    expect(splitSwitchText(bk, true)).toMatch(/^החלף רגל! עכשיו עמידה על רגל שמאל — הפרוטזה/);
  });
});

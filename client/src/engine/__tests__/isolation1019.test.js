// Owner, 2026-10-19: every exercise works ONLY by its own rules — nothing leaks from one exercise into another
// (the field video: "strike with the laces" was told in a PASS — a kick rule inherited by the pass)
import { describe, it, expect } from 'vitest';
import { EXPERT_PROFILES } from '../exercise/exerciseProfiles';
import { SPORT_LIBRARY, applySportContext } from '../sports/sportLibrary';
import { createExecutionTracker, updateExecution, calibrateUpright } from '../exercise/profileEvaluator';

const ids = (p) => [...(p.rules || []), ...(p.dynamics || [])];

describe('rule isolation between exercises', () => {
  it('a rule that belongs to one exercise appears in no other — in every sport, on crutches or not', () => {
    const leaks = [];
    for (const [id, base] of Object.entries(EXPERT_PROFILES)) {
      for (const ctx of Object.keys(SPORT_LIBRARY)) {
        for (const crutches of [false, true]) {
          for (const r of ids(applySportContext(base, [ctx], { crutches }))) if (r.only && !r.only.includes(id)) leaks.push(`${id}/${ctx}/${r.id}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });
  it('the pass never tells a laces strike; the kick never tells an inside-foot pass', () => {
    const pass = ids(EXPERT_PROFILES.shadowPass).map(r => r.id);
    const kick = ids(EXPERT_PROFILES.footballKick).map(r => r.id);
    expect(pass).not.toContain('kick_toe');
    expect(pass).toEqual(expect.arrayContaining(['pass_toe', 'pass_laces', 'pass_ankle', 'strike_balance']));
    expect(kick).toContain('kick_toe');
    expect(kick.some(x => x.startsWith('pass_'))).toBe(false);
  });
});

describe('the live camera: no lean verdict before the tilt was calibrated on the trainee standing still', () => {
  it('a laptop looking down (raw lean ~50°) — nothing judged before calibration; judged correctly after it', () => {
    const tr = createExecutionTracker(EXPERT_PROFILES.footballKick, {});
    tr.requireTilt = true;
    expect(tr.tiltReady).toBe(false);
    calibrateUpright(tr, Array.from({ length: 30 }, () => 50));
    expect(tr.tiltReady).toBe(true);
    expect(tr.cameraTilt).toBe(45);
  });
});

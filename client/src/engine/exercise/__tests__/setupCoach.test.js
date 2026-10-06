import { describe, it, expect } from 'vitest';
import { EXPERT_PROFILES, FAMILY_PROFILES } from '../exerciseProfiles.js';
import { profileGhostPose } from '../profileGhost.js';
import { assessSetup, SETUP, READY } from '../setupCoach.js';
import { createExecutionTracker, updateExecution } from '../profileEvaluator.js';
import { getLimbProfile } from '../../limbProfile.js';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const lpLeftBK = getLimbProfile({ scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } });
const squat = EXPERT_PROFILES.squat;
const press = EXPERT_PROFILES.shoulderPress;

const frame = (p, t = 0) => profileGhostPose(p, t, lpOk).landmarks
  .map(q => (q.visibility ? { ...q, x: 0.5 + q.x * 0.17, y: 0.5 + q.y * 0.17, visibility: 0.95 } : q));
const shift = (lm, dx, dy) => lm.map(p => (p.visibility ? { ...p, x: p.x + dx, y: p.y + dy } : p));
const zoom = (lm, k, cx = 0.5, cy = 0.5) => lm.map(p => (p.visibility ? { ...p, x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k } : p));
const code = (lm, p = squat, lp = lpOk) => assessSetup(lm, p, lp).issue?.code ?? 'ok';

describe('Setup coach — tells the trainee exactly how to stand', () => {
  it('well positioned → ok (standing side-on, facing, and lying on the floor)', () => {
    expect(code(frame(squat))).toBe('ok');
    expect(code(frame(press), press)).toBe('ok');
    expect(code(frame(EXPERT_PROFILES.pushUp), EXPERT_PROFILES.pushUp)).toBe('ok');
    expect(code(frame(EXPERT_PROFILES.footballKick, 0.5), EXPERT_PROFILES.footballKick)).toBe('ok');
  });

  it('nobody in view → "stand in front of the camera"', () => {
    expect(code(null)).toBe('no_body');
    expect(code(frame(squat).map(p => ({ ...p, visibility: 0 })))).toBe('no_body');
  });

  it('feet cut with room above the head → tilt the camera down', () => {
    expect(code(shift(frame(squat), 0, 0.25))).toBe('tilt_down');
  });

  it('feet cut and no room above → step back (head to toe)', () => {
    expect(code(zoom(frame(squat), 1.5, 0.5, 0.3))).toBe('feet_step_back');
  });

  it('head cut with room below the feet → tilt the camera up', () => {
    expect(code(shift(frame(squat), 0, -0.2))).toBe('tilt_up');
  });

  it('too close (head and feet cut) → step back', () => {
    expect(code(zoom(frame(squat), 2.2))).toBe('step_back');
  });

  it('leaving the frame → move left / right as the trainee sees the mirrored screen', () => {
    // raw x near 0 = the right side of the mirrored screen → move left
    expect(code(shift(frame(squat), -0.4, 0))).toBe('move_left');
    expect(code(shift(frame(squat), 0.4, 0))).toBe('move_right');
  });

  it('too far → come closer', () => {
    expect(code(zoom(frame(squat), 0.4))).toBe('step_closer');
  });

  it('wrong orientation for the measurement → turn side-on / face the camera', () => {
    const facing = frame(squat).map((p, i) => {
      if (!p.visibility) return p;
      if ([11, 13, 15, 23, 25, 27].includes(i)) return { ...p, x: p.x + 0.07 };
      if ([12, 14, 16, 24, 26, 28].includes(i)) return { ...p, x: p.x - 0.07 };
      return p;
    });
    expect(code(facing, squat)).toBe('turn_side');
    expect(code(frame(squat), press)).toBe('turn_front');
  });

  it('unclear tracking → add light / remove what hides you', () => {
    expect(code(frame(squat).map(p => (p.visibility ? { ...p, visibility: 0.55 } : p)))).toBe('light');
  });

  it('upper-body exercises do not need the feet in the frame', () => {
    const lm = frame(press).map((p, i) => ([25, 26, 27, 28].includes(i) ? { ...p, y: 1.3, visibility: 0.1 } : p));
    expect(code(lm, press)).toBe('ok');
    expect(code(lm, FAMILY_PROFILES.armsStanding)).toBe('ok');
  });

  it('below-knee prosthesis: one foot in the frame is enough (side view hides the other)', () => {
    const lm = frame(squat).map((p, i) => (i === 27 ? { ...p, visibility: 0.2 } : p));
    expect(code(lm, squat, lpLeftBK)).toBe('ok');
  });

  it('every instruction has precise Hebrew and English wording', () => {
    for (const s of Object.values(SETUP)) expect(s.he.length > 10 && s.en.length > 10, s.code).toBe(true);
    expect(READY.first.he).toContain('אני רואה אותך');
  });
});

describe('Setup gate in the evaluator — nothing counts until positioned right', () => {
  it('guides, then opens as soon as the trainee is positioned right', () => {
    const tr = createExecutionTracker(squat, lpOk);
    let r;
    for (let ms = 0; ms < 1000; ms += 50) r = updateExecution(tr, shift(frame(squat), 0, 0.25), ms);
    expect(r.inView).toBe(false);
    expect(r.setup.code).toBe('tilt_down');
    expect(r.issues).toEqual([]);
    expect(r.accuracy).toBeNull();
    for (let ms = 1000; ms < 1300; ms += 50) r = updateExecution(tr, frame(squat), ms);
    expect(r.inView).toBe(true);
    expect(r.setup).toBeNull();
  });

  it('hidden arms in a front-view arm exercise → a precise arms instruction', () => {
    const tr = createExecutionTracker(press, lpOk);
    let r;
    for (let ms = 0; ms < 800; ms += 50) r = updateExecution(tr, frame(press).map((p, i) => (i === 15 ? { ...p, visibility: 0 } : p)), ms);
    expect(r.setup.code).toBe('arms');
    expect(r.missing).toBe('arms');
  });
});

// Field video 2026-10-20 (0 counts in a minute while the passes were seen): a controlled inside-foot pass
// is a pendulum from the hip — proven by its own swing at the contact; walking never; twitches never
import { describe, it, expect } from 'vitest';
import { createRepEvidence, evidenceFrame, evidenceOk, strikeSwing, kickInPlace } from '../training/repEvidence';
import { openingKickAllowed, OPENING_STILL_WINDOW_MS } from '../training/coachFlow';

function legBody(thighDeg, { dx = 0, scale = 1 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const set = (i, x, y) => { lm[i] = { x: 0.5 + (x - 0.5) * scale + dx, y: 0.5 + (y - 0.5) * scale, visibility: 0.95 }; };
  set(11, 0.42, 0.25); set(12, 0.58, 0.25); set(23, 0.45, 0.5); set(24, 0.55, 0.5);
  set(25, 0.45, 0.7); set(27, 0.45, 0.9);
  const a = (thighDeg * Math.PI) / 180;
  set(26, 0.55 + 0.2 * Math.sin(a), 0.5 + 0.2 * Math.cos(a));
  set(28, 0.55 + 0.4 * Math.sin(a), 0.5 + 0.4 * Math.cos(a));
  return lm;
}
const run = (frames, dt = 100) => { const ev = createRepEvidence('legs'); let t = 0; for (const lm of frames) evidenceFrame(ev, lm, (t += dt)); return { ev, t }; };

describe('a controlled inside-foot pass counts AT the contact', () => {
  it('standing a while, then a pendulum swing from the hip (straight knee) — counted at the contact', () => {
    const still = Array.from({ length: 30 }, () => legBody(0));                // 3 s standing before (old history)
    const { ev, t } = run([...still, ...[-10, -22, -12, 8, 25].map(d => legBody(d))]);
    expect(strikeSwing(ev).ok).toBe(true);
    expect(evidenceOk(ev, t, { strike: true, kick: true })).toBe(true);
  });
  it('the same at a laptop camera frame rate (~12 fps)', () => {
    const { ev, t } = run([0, 0, 0, -15, -25, 5, 28].map(d => legBody(d)), 83);
    expect(evidenceOk(ev, t, { strike: true, kick: true })).toBe(true);
  });
  it('a small twitch / a weight shift is never a pass', () => {
    const { ev, t } = run([0, -3, -6, -2, 3, 5].map(d => legBody(d)));
    expect(evidenceOk(ev, t, { strike: true, kick: true })).toBe(false);
  });
  it('walking across the room is never a pass', () => {
    const { ev, t } = run([-10, -22, -12, 8, 25].map((d, i) => legBody(d, { dx: i * 0.04 })));
    expect(kickInPlace(ev)).toBe(false);
    expect(evidenceOk(ev, t, { strike: true, kick: true })).toBe(false);
  });
  it('walking TOWARD the camera (the shoulders widen in the picture) is never a pass', () => {
    const { ev, t } = run([-10, -22, -12, 8, 25].map((d, i) => legBody(d, { scale: 1 + i * 0.08 })));
    expect(evidenceOk(ev, t, { strike: true, kick: true })).toBe(false);
  });
});

describe('the opening pass needs the trainee standing still at the ball just before', () => {
  it('walking back to the spot cannot open the exercise', () => {
    expect(openingKickAllowed(-1e9, 10000)).toBe(false);
    expect(openingKickAllowed(9000, 10000)).toBe(true);
    expect(openingKickAllowed(9000, 9000 + OPENING_STILL_WINDOW_MS + 1)).toBe(false);
  });
});

import { inPlaceCheck } from '../training/repEvidence';
import { EXPERT_PROFILES } from '../exercise/exerciseProfiles';
import { SPORT_LIBRARY, applySportContext } from '../sports/sportLibrary';

describe('the exact reason of a rejected kick (the console line)', () => {
  it('walking across → walk-across; toward the camera → walk-depth; a pass in place → ok', () => {
    expect(inPlaceCheck(run([-10, -22, -12, 8, 25].map((d, i) => legBody(d, { dx: i * 0.04 }))).ev).reason).toBe('walk-across');
    expect(inPlaceCheck(run([-10, -22, -12, 8, 25].map((d, i) => legBody(d, { scale: 1 + i * 0.08 }))).ev).reason).toBe('walk-depth');
    const ok = inPlaceCheck(run([0, -10, -22, -12, 8, 25].map(d => legBody(d))).ev);
    expect(ok.ok).toBe(true);
    expect(ok.kick).toBeGreaterThan(0.3);                                   // the kicking foot's path (torso lengths)
  });
});

describe('the hip → knee whip is a POWER-KICK rule only (never a pass, in any sport)', () => {
  it('no pass profile judges strike_chain; the kick does', () => {
    for (const ctx of Object.keys(SPORT_LIBRARY)) {
      const pass = applySportContext(EXPERT_PROFILES.shadowPass, [ctx], { crutches: false });
      expect((pass.dynamics || []).some(r => r.id === 'strike_chain'), ctx).toBe(false);
    }
    expect(EXPERT_PROFILES.footballKick.dynamics.some(r => r.id === 'strike_chain')).toBe(true);
  });
});

describe('the support ANCHOR: the planted foot decides, not the support leg joint angles', () => {
  it('a real pass whose support hip / knee angles change a lot (a turning pelvis, a noisy prosthesis) — the foot planted → in place', () => {
    const frames = [0, -10, -22, -12, 8, 25].map((d, i) => {
      const lm = legBody(d);
      lm[25] = { x: 0.45 + (i % 2 ? 0.06 : -0.06), y: 0.7, visibility: 0.95 };   // the support knee point swings in the picture
      return lm;
    });
    const c = inPlaceCheck(run(frames).ev);
    expect(c.ok).toBe(true);
    expect(c.anchor).toBeLessThan(0.3);
  });
  it('both feet travel (stepping) → not in place, with the reason', () => {
    const frames = [0, -10, -22, -12, 8, 25].map((d, i) => { const lm = legBody(d); lm[27] = { x: 0.45 + i * 0.03, y: 0.9, visibility: 0.95 }; return lm; });
    expect(inPlaceCheck(run(frames).ev).reason).toBe('both-legs');
  });
  it('crutches / a support the camera does not see as a foot → the anchor is not judged (the pelvis guard still is)', () => {
    const frames = [0, -10, -22, -12, 8, 25].map(d => { const lm = legBody(d); lm[27] = { x: 0.5, y: 0.5, visibility: 0.1 }; return lm; });
    expect(inPlaceCheck(run(frames).ev).ok).toBe(true);
  });
  it('a hip pendulum (the knee hardly moves) is a real swing — the FOOT path counts', () => {
    const { ev } = run([0, 0, 0, -10, -18, 4, 20].map(d => legBody(d)));
    expect(strikeSwing(ev).ok).toBe(true);
  });
});

import { visionRuleHits, restOnlyFeedback, COUNT_LOCK_MS, VISION_CONFIDENCE } from '../../hooks/training/useExpertExecution';

describe('the coach eyes: only a CONFIDENT vision finding becomes a correction', () => {
  const p = EXPERT_PROFILES.shadowPass;
  it('toe / laces / a loose ankle seen confidently → the pass rule; unsure → nothing', () => {
    expect(visionRuleHits({ contact: { value: 'toe', confidence: 0.9 } }, p).map(h => [h.rule.id, h.violated])).toEqual([['pass_toe', true]]);
    expect(visionRuleHits({ contact: { value: 'laces', confidence: 0.8 } }, p)[0].rule.id).toBe('pass_laces');
    expect(visionRuleHits({ ankleLocked: { value: false, confidence: 0.85 } }, p)[0]).toMatchObject({ violated: true });
    expect(visionRuleHits({ contact: { value: 'toe', confidence: VISION_CONFIDENCE - 0.05 } }, p)).toEqual([]);
    expect(visionRuleHits({ contact: { value: 'inside', confidence: 0.9 } }, p)[0]).toMatchObject({ violated: false });   // judged clean
  });
});

describe('agility / endurance / speed drills: feedback in the rest; one pass = one count', () => {
  it('running in place / high knees / shuffles are rest-only; a pass / a squat are live', () => {
    expect(restOnlyFeedback(EXPERT_PROFILES.runInPlace)).toBe(true);
    expect(restOnlyFeedback(EXPERT_PROFILES.highKnees)).toBe(true);
    expect(restOnlyFeedback(EXPERT_PROFILES.shadowPass)).toBe(false);
    expect(restOnlyFeedback(EXPERT_PROFILES.squat)).toBe(false);
    expect(COUNT_LOCK_MS).toBe(1000);
  });
  it('the kicking side comes from the feet (the anchor), not a jumping label', () => {
    const c = inPlaceCheck(run([0, -10, -22, -12, 8, 25].map(d => legBody(d))).ev);
    expect(c.side).toBe('right');
  });
});

import { isMajor } from '../exercise/profileEvaluator';
describe('the correction policy: major at once, minor forgiven once', () => {
  it('knees caving in / a toe-poke / a danger are major; too shallow is minor', () => {
    const sq = EXPERT_PROFILES.squat.rules;
    expect(isMajor(sq.find(r => r.id === 'knee_valgus'))).toBe(true);
    expect(isMajor(sq.find(r => r.id === 'trunk_collapse'))).toBe(true);
    expect(isMajor(sq.find(r => r.id === 'too_shallow'))).toBe(false);
    expect(isMajor(EXPERT_PROFILES.shadowPass.dynamics.find(r => r.id === 'pass_toe'))).toBe(true);
  });
});

import { createExecutionTracker } from '../exercise/profileEvaluator';
describe('a minor error that comes back — not in a row — is said', () => {
  it('shallow, clean, shallow → said at the 2nd shallow rep (forgiven only once)', async () => {
    const { profileGhostPose } = await import('../exercise/profileGhost');
    const { updateExecution } = await import('../exercise/profileEvaluator');
    const { getLimbProfile } = await import('../limbProfile');
    const lp = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
    const p = EXPERT_PROFILES.squat;
    const shallow = { ...p, ghost: { ...p.ghost, peak: { ...p.ghost.peak, knee: 135, hip: 120 } } };
    const fr = (q, ms) => profileGhostPose(q, (ms % q.ghost.periodMs) / q.ghost.periodMs, lp).landmarks
      .map(z => (z.visibility ? { ...z, x: 0.5 + z.x * 0.17, y: 0.5 + z.y * 0.17, z: (z.z ?? 0) * 0.17, visibility: 0.95 } : z));
    const tr = createExecutionTracker(p, lp);
    const P = p.ghost.periodMs, said = [];
    const seq = [shallow, p, shallow];
    for (let ms = 0; ms < 3 * P; ms += 50) {
      const g = seq[Math.floor(ms / P)];
      if (updateExecution(tr, fr(g, ms), ms).coaching.some(r => r.id === 'too_shallow')) said.push(Math.floor(ms / P));
    }
    expect(said).toEqual([2]);
  });
});

import { isProstheticLeg } from '../exercise/profileEvaluator';
import { footSettled, kickLockOpen, RELEASE_MS } from '../training/coachFlow';

describe('the prosthetic kicking leg: no ankle / foot-surface judgement', () => {
  it('the foot rules are marked natural-foot only; a prosthetic leg is recognised', () => {
    for (const id of ['pass_toe', 'pass_laces', 'pass_ankle']) expect(EXPERT_PROFILES.shadowPass.dynamics.find(r => r.id === id).naturalFoot).toBe(true);
    expect(EXPERT_PROFILES.footballKick.dynamics.find(r => r.id === 'kick_toe').naturalFoot).toBe(true);
    expect(isProstheticLeg({ left_leg: { state: 'prosthetic', level: 'below_knee' } }, 'left')).toBe(true);
    expect(isProstheticLeg({ left_leg: { state: 'prosthetic' } }, 'right')).toBe(false);
  });
  it('a prosthetic kicking leg: the evaluator never raises a foot rule on its strike', async () => {
    const { createExecutionTracker } = await import('../exercise/profileEvaluator');
    const tr = createExecutionTracker(EXPERT_PROFILES.shadowPass, { left_leg: { state: 'prosthetic', level: 'below_knee' } });
    tr.activeLeg = 'left';
    const r = EXPERT_PROFILES.shadowPass.dynamics.find(x => x.id === 'pass_ankle');
    expect(r.naturalFoot && isProstheticLeg(tr.lp, tr.activeLeg)).toBe(true);
  });
});

describe('one pass = ONE count: the lock opens only when the kicking foot settled (or after 1.8 s)', () => {
  const hist = (moving) => Array.from({ length: 30 }, (_, i) => ({ t: 1000 + i * 50, r: { x: 0.5 + (moving ? (i % 2) * 0.05 : 0), y: 0.9 }, l: { x: 0.4, y: 0.9 }, torso: 0.3 }));
  it('the foot still → settled; the foot swinging back → not', () => {
    expect(footSettled(hist(false), 'right', 1000, 2400)).toBe(true);
    expect(footSettled(hist(true), 'right', 1000, 2400)).toBe(false);
  });
  it('locked before 1 s always; between 1 and 1.8 s only if settled; open after 1.8 s', () => {
    expect(kickLockOpen({ now: 1900, lastCountAt: 1000, settledSinceCount: true })).toBe(false);
    expect(kickLockOpen({ now: 2200, lastCountAt: 1000, settledSinceCount: false })).toBe(false);
    expect(kickLockOpen({ now: 2200, lastCountAt: 1000, settledSinceCount: true })).toBe(true);
    expect(kickLockOpen({ now: 1000 + RELEASE_MS, lastCountAt: 1000, settledSinceCount: false })).toBe(true);
  });
});

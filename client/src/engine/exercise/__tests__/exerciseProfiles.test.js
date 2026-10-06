import { describe, it, expect } from 'vitest';
import {
  EXPERT_PROFILES, FAMILY_PROFILES, getExerciseProfile, isCueKeyMapped, personalizeProfile,
} from '../exerciseProfiles.js';
import { profileGhostPose, ghostAnglesAt } from '../profileGhost.js';
import {
  measureProfile, violatedRules, repProgress, createExecutionTracker, updateExecution, requiredRegions, RULE_HOLD_MS,
} from '../profileEvaluator.js';
import { METRICS, JOINTS } from '../kinematics.js';
import { ghostPose } from '../../warmupGhost.js';
import { listAnalyzerCueKeys } from '../../../utils/exerciseAnalysis.js';
import { getLimbProfile } from '../../limbProfile.js';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const lpLeftBK = getLimbProfile({ scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } });
const lpLeftAK = getLimbProfile({ scanData: { classification: 'TRANSFEMORAL_AMPUTEE', prostheticSide: 'left' } });
const lpNoLeftArm = getLimbProfile({ scanData: { classification: 'ARM_AMPUTEE', prostheticSide: 'left' } });

const EXPERTS = Object.values(EXPERT_PROFILES);
const inRange = (v, r) => v >= r[0] - 0.5 && v <= r[1] + 0.5;

/** Ghost landmarks mapped into the camera frame (uniform scale → same angles). */
function ghostFrame(profile, t, lp = lpOk) {
  const pose = profileGhostPose(profile, t, lp);
  return pose.landmarks.map(p => (p.visibility ? { ...p, x: 0.5 + p.x * 0.17, y: 0.5 + p.y * 0.17 } : p));
}

/** Run the evaluator on the Ghost for `cycles` animation cycles at 20 Hz. */
function runGhost(profile, lp = lpOk, cycles = 3) {
  const tr = createExecutionTracker(profile, lp);
  const period = profile.ghost.periodMs;
  const results = [];
  for (let ms = 0; ms <= cycles * period; ms += 50) {
    results.push(updateExecution(tr, ghostFrame(profile, (ms % period) / period, lp), ms));
  }
  return results;
}

describe('Expert Execution Profiles — coverage', () => {
  it('every exercise the coach can give resolves to a profile', () => {
    const keys = listAnalyzerCueKeys();
    expect(keys.length).toBeGreaterThan(50);
    const unmapped = keys.filter(k => !isCueKeyMapped(k));
    expect(unmapped).toEqual([]);
    for (const k of keys) expect(getExerciseProfile(k)).toBeTruthy();
  });

  it('the core strength / rehab exercises have an EXPERT profile', () => {
    for (const k of ['squat', 'lunge', 'push', 'plank', 'shoulder', 'lateral', 'frontRaise', 'bicep', 'deadlift', 'wallsit', 'bridge', 'rehabMiniSquat', 'rehabFrontRaise', 'rehabElbowFlex', 'running', 'highKnees', 'kick']) {
      expect(getExerciseProfile(k).precision, k).toBe('expert');
    }
  });

  it('unknown cueKeys fall back to a profile that still requires the torso in view', () => {
    expect(getExerciseProfile('no_such_key').require).toContain('torso');
  });

  it('every expert profile is well formed', () => {
    for (const p of EXPERTS) {
      expect(p.joints[p.primary], p.id).toBeTruthy();
      expect(p.require.length, p.id).toBeGreaterThan(0);
      for (const [name, j] of Object.entries(p.joints)) {
        expect(JOINTS[name], `${p.id}.${name}`).toBeTruthy();
        expect(j.rest[0]).toBeLessThan(j.rest[1]);
        if (j.peak) expect(j.peak[0]).toBeLessThan(j.peak[1]);
      }
      for (const r of p.rules) {
        expect(METRICS, `${p.id}.${r.id}`).toContain(r.metric);
        expect(['error', 'danger']).toContain(r.severity);
        expect(r.msg.he && r.msg.en).toBeTruthy();
      }
      if (p.ghost.keyframes) {
        expect(['cyclic', 'strike', 'hold', 'reps'], p.id).toContain(p.kind);
        const keys = Object.keys(p.ghost.keyframes[0].a).sort();
        for (const k of p.ghost.keyframes) expect(Object.keys(k.a).sort(), p.id).toEqual(keys);
      } else {
        expect(p.kind === 'hold' ? !p.ghost.peak : !!p.ghost.peak, p.id).toBe(true);
      }
      expect(p.tags.length, p.id).toBeGreaterThan(0);
      for (const r of p.dynamics) expect(['rep', 'landing', 'strike', 'window'], `${p.id}.${r.id}`).toContain(r.on);
    }
  });

  it('family profiles cover limbs only (no Ghost, no rules)', () => {
    for (const p of Object.values(FAMILY_PROFILES)) {
      expect(p.precision).toBe('basic');
      expect(p.ghost).toBeNull();
      expect(p.require.length).toBeGreaterThan(0);
    }
  });
});

describe('Ghost ⇄ profile sync — the Ghost demonstrates exactly the profile', () => {
  it('the Ghost joint angles measured like the trainee equal the profile Ghost angles', () => {
    for (const p of EXPERTS.filter(x => !x.ghost.keyframes)) {   // keyframe Ghosts: checked by ranges + evaluator
      for (const t of [0, 0.25, 0.5]) {
        const want = ghostAnglesAt(p.ghost, t);
        const got = measureProfile(p, profileGhostPose(p, t, lpOk).landmarks, lpOk);
        for (const j of Object.keys(p.joints)) {
          if (typeof want[j] !== 'number' || typeof got[j] !== 'number') continue;
          if (p.id === 'lunge' && j === 'knee') continue;   // min of both knees (back knee by IK) — range checked below
          if (p.id === 'gluteBridge' && t === 0) continue;  // rest = hips on the floor (closest reachable angle)
          expect(Math.abs(got[j] - want[j]), `${p.id}.${j}@${t}`).toBeLessThan(1);
        }
      }
    }
  });

  it('at rest and at the peak the Ghost is inside the profile target ranges', () => {
    for (const p of EXPERTS) {
      const rest = measureProfile(p, profileGhostPose(p, p.ghost.restT ?? 0, lpOk).landmarks, lpOk);
      for (const [j, r] of Object.entries(p.joints)) {
        expect(inRange(rest[j], r.rest), `${p.id}.${j} rest=${rest[j]}`).toBe(true);
      }
      if (!Object.values(p.joints).some(j => j.peak)) continue;
      const peak = measureProfile(p, profileGhostPose(p, p.ghost.peakT ?? 0.5, lpOk).landmarks, lpOk);
      for (const [j, r] of Object.entries(p.joints)) {
        expect(inRange(peak[j], r.peak), `${p.id}.${j} peak=${peak[j]}`).toBe(true);
      }
    }
  });

  it('no rule ever fires on the Ghost over a whole cycle', () => {
    for (const p of EXPERTS) {
      for (let i = 0; i < 40; i++) {
        const m = measureProfile(p, profileGhostPose(p, i / 40, lpOk).landmarks, lpOk);
        const prog = repProgress(p, m[p.primary]);
        const phase = prog === null ? 'any' : prog >= 0.6 ? 'peak' : prog <= 0.3 ? 'rest' : 'mid';
        const hits = violatedRules(p, m, phase).map(r => r.id);
        expect(hits, `${p.id}@${i / 40}`).toEqual([]);
      }
    }
  });

  it('the live evaluator scores the Ghost as an expert (in view, no issues, accuracy ≥ 85%)', () => {
    for (const p of EXPERTS) {
      const res = runGhost(p);
      expect(res.some(r => r.issues.length > 0), p.id).toBe(false);
      const last = res[res.length - 1];
      expect(last.inView, p.id).toBe(true);
      expect(last.accuracy, p.id).toBeGreaterThanOrEqual(85);
    }
  });

  it('warmupGhost.ghostPose draws the profile Ghost for an exercise spec', () => {
    const p = EXPERT_PROFILES.squat;
    expect(ghostPose({ profile: p }, 0.5, lpOk)).toEqual(profileGhostPose(p, 0.5, lpOk));
  });

  it('a personalized (limited shoulder) Ghost stays inside the personalized ranges', () => {
    const lp = { ...lpOk, left_arm: { ...lpOk.left_arm, state: 'limited', romCapDeg: 80 } };
    const p = personalizeProfile(EXPERT_PROFILES.lateralRaise, lp);
    expect(p.joints.shoulder.peak[1]).toBe(80);
    expect(p.ghost.peak.shoulder).toBe(75);
    const res = runGhost(p, lp);
    expect(res.some(r => r.issues.length > 0)).toBe(false);
    expect(res[res.length - 1].accuracy).toBeGreaterThanOrEqual(85);
  });
});

describe('Ghost — Iron Rule (limb profile)', () => {
  it('below-knee prosthesis: dashed shin, knee still drawn', () => {
    const pose = profileGhostPose(EXPERT_PROFILES.squat, 0.5, lpLeftBK);
    const left = pose.segments.filter(s => s.limb === 'left_leg');
    expect(left.map(s => s.part)).toEqual(['thigh', 'shin']);
    expect(left.find(s => s.part === 'shin').dashed).toBe(true);
  });

  it('above-knee prosthesis: that leg is not drawn', () => {
    const pose = profileGhostPose(EXPERT_PROFILES.squat, 0.5, lpLeftAK);
    expect(pose.segments.some(s => s.limb === 'left_leg')).toBe(false);
    expect(pose.segments.some(s => s.limb === 'right_leg')).toBe(true);
  });

  it('absent arm: not drawn (front and side views)', () => {
    for (const p of [EXPERT_PROFILES.shoulderPress, EXPERT_PROFILES.bicepCurl]) {
      const pose = profileGhostPose(p, 0.5, lpNoLeftArm);
      expect(pose.segments.some(s => s.limb === 'left_arm'), p.id).toBe(false);
      expect(pose.segments.some(s => s.limb === 'right_arm'), p.id).toBe(true);
    }
  });
});

describe('Required limbs in view', () => {
  const squat = EXPERT_PROFILES.squat;

  it('a leg exercise is never approved without the legs in the frame', () => {
    const tr = createExecutionTracker(squat, lpOk);
    let r;
    for (let i = 0; i < 20; i++) {
      const lm = ghostFrame(squat, 0);
      for (const k of [25, 26, 27, 28]) lm[k] = { ...lm[k], y: 1.2 };   // knees + ankles below the frame
      r = updateExecution(tr, lm, i * 50);
    }
    expect(r.inView).toBe(false);
    expect(r.missing).toBe('legs');
    expect(r.issues).toEqual([]);
    expect(r.accuracy).toBeNull();
  });

  it('low-confidence (guessed) legs do not count either', () => {
    const tr = createExecutionTracker(squat, lpOk);
    let r;
    for (let i = 0; i < 20; i++) {
      const lm = ghostFrame(squat, 0);
      for (const k of [27, 28]) lm[k] = { ...lm[k], visibility: 0.2 };
      r = updateExecution(tr, lm, i * 50);
    }
    expect(r.missing).toBe('legs');
  });

  it('upper-body exercise: the legs are not required', () => {
    const p = EXPERT_PROFILES.shoulderPress;
    const tr = createExecutionTracker(p, lpOk);
    let r;
    for (let i = 0; i < 10; i++) {
      const lm = ghostFrame(p, 0);
      for (const k of [25, 26, 27, 28]) lm[k] = { ...lm[k], y: 1.4, visibility: 0.1 };
      r = updateExecution(tr, lm, i * 50);
    }
    expect(r.inView).toBe(true);
  });

  it('front view needs every usable arm; an absent arm is never required', () => {
    const p = EXPERT_PROFILES.shoulderPress;
    const both = requiredRegions(p, lpOk).find(r => r.region === 'arms');
    expect(both.mode).toBe('all');
    expect(both.sides.length).toBe(2);
    const one = requiredRegions(p, lpNoLeftArm).find(r => r.region === 'arms');
    expect(one.sides).toEqual([[12, 14, 16]]);
  });

  it('above-knee amputee: only the working leg is required (side view: any side)', () => {
    const legs = requiredRegions(squat, lpLeftAK).find(r => r.region === 'legs');
    expect(legs.sides).toEqual([[24, 26, 28]]);
  });

  it('in-view hysteresis: a single dropped frame does not stop the exercise', () => {
    const tr = createExecutionTracker(squat, lpOk);
    for (let i = 0; i < 6; i++) updateExecution(tr, ghostFrame(squat, 0), i * 50);
    const r = updateExecution(tr, null, 300);
    expect(r.inView).toBe(true);
  });
});

describe('Errors and danger', () => {
  /** Squat frame with the trunk pitched forward by `lean` degrees (around the hips). */
  function leaning(lean) {
    const lm = ghostFrame(EXPERT_PROFILES.squat, 0.5);
    const hip = lm[23];
    const L = Math.hypot(lm[11].x - hip.x, lm[11].y - hip.y);
    const a = lean * Math.PI / 180;
    for (const k of [11, 12]) lm[k] = { ...lm[k], x: hip.x + Math.sin(a) * L, y: hip.y - Math.cos(a) * L };
    return lm;
  }

  it('a collapsing back during a squat raises DANGER after it persists', () => {
    const tr = createExecutionTracker(EXPERT_PROFILES.squat, lpOk);
    for (let i = 0; i < 6; i++) updateExecution(tr, ghostFrame(EXPERT_PROFILES.squat, 0.5), i * 50);
    let r;
    for (let ms = 300; ms <= 300 + RULE_HOLD_MS + 100; ms += 50) r = updateExecution(tr, leaning(80), ms);
    expect(r.danger?.id).toBe('trunk_collapse');
    expect(r.issues[0].severity).toBe('danger');
  });

  it('a one-frame spike is ignored (no false alarm)', () => {
    const tr = createExecutionTracker(EXPERT_PROFILES.squat, lpOk);
    for (let i = 0; i < 6; i++) updateExecution(tr, ghostFrame(EXPERT_PROFILES.squat, 0.5), i * 50);
    updateExecution(tr, leaning(80), 300);
    const r = updateExecution(tr, ghostFrame(EXPERT_PROFILES.squat, 0.5), 350);
    expect(r.issues).toEqual([]);
  });

  it('push-up: sagging hips are dangerous', () => {
    const p = EXPERT_PROFILES.pushUp;
    const tr = createExecutionTracker(p, lpOk);
    let r;
    for (let ms = 0; ms <= 1000; ms += 50) {
      const lm = ghostFrame(p, 0);
      for (const k of [23, 24]) lm[k] = { ...lm[k], y: lm[k].y + 0.13 };   // hips drop toward the floor (~135°)
      r = updateExecution(tr, lm, ms);
    }
    expect(r.danger?.id).toBe('hip_sag');
  });

  it('a shallow squat is an error only at the bottom of the rep, never at rest', () => {
    const p = EXPERT_PROFILES.squat;
    const restMetrics = measureProfile(p, ghostFrame(p, 0), lpOk);
    expect(violatedRules(p, restMetrics, 'rest').map(r => r.id)).not.toContain('too_shallow');
    expect(violatedRules(p, { knee: 140, hip: 150, trunkLean: 10 }, 'peak').map(r => r.id)).toContain('too_shallow');
  });

  it('a partial range scores lower accuracy than the full range', () => {
    const p = EXPERT_PROFILES.squat;
    const tr = createExecutionTracker(p, lpOk);
    let r;
    // Only the top half of the squat: t in [0, 0.15] ∪ [0.85, 1]
    for (let ms = 0; ms <= 9000; ms += 50) {
      const u = (ms % 2000) / 2000;
      const t = u < 0.5 ? u * 0.3 : 1 - (1 - u) * 0.3;
      r = updateExecution(tr, ghostFrame(p, t), ms);
    }
    expect(r.accuracy).toBeLessThan(60);
  });
});

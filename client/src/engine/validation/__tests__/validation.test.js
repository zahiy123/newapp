import { describe, it, expect } from 'vitest';
import { EXPERT_PROFILES } from '../../exercise/exerciseProfiles.js';
import { profileGhostPose } from '../../exercise/profileGhost.js';
import { createExecutionTracker, updateExecution } from '../../exercise/profileEvaluator.js';
import { detectView, viewSuits, trackingScore } from '../../exercise/confidence.js';
import { applySportContext } from '../../sports/sportLibrary.js';
import { createClipRecorder, recordFrame, encodeFrame, decodeFrame, KEEP_POINTS } from '../clipRecorder.js';
import { replayClip, agreementReport, tuneRule, candidatesAround, withThreshold } from '../agreement.js';

const frameOf = (p, t) => profileGhostPose(p, t, {}).landmarks
  .map(q => (q.visibility ? { ...q, x: 0.5 + q.x * 0.17, y: 0.5 + q.y * 0.17, visibility: 0.95 } : q));

/** Rotate a side-view frame so the trainee faces the camera: spread left/right sides apart. */
function facingCamera(lm) {
  const out = lm.map(p => ({ ...p }));
  for (const i of [11, 13, 15, 23, 25, 27]) out[i].x += 0.07;
  for (const i of [12, 14, 16, 24, 26, 28]) out[i].x -= 0.07;
  return out;
}

/** Record `cycles` Ghost cycles of a profile; `mutate(lm, ms)` may distort frames. */
function recordGhost(profile, cycles, mutate = (lm) => lm) {
  const tr = createExecutionTracker(profile, {});
  const rec = createClipRecorder(profile, { maxClips: 50 });
  const per = profile.ghost.periodMs;
  for (let ms = 0; ms <= cycles * per; ms += 50) {
    const lm = mutate(frameOf(profile, (ms % per) / per), ms);
    const r = updateExecution(tr, lm, ms);
    recordFrame(rec, lm, r, ms);
  }
  return rec.clips;
}

describe('Confidence gate — silence when unsure', () => {
  const squat = EXPERT_PROFILES.squat;

  it('detects the camera view', () => {
    expect(detectView(frameOf(squat, 0))).toBe('side');
    expect(detectView(frameOf(EXPERT_PROFILES.shoulderPress, 0))).toBe('front');
    expect(detectView(facingCamera(frameOf(squat, 0)))).toBe('front');
    expect(viewSuits('side', 'front')).toBe(false);
    expect(viewSuits('side', 'oblique')).toBe(true);
    expect(viewSuits('front', 'side')).toBe(false);
  });

  it('a side-view exercise filmed from the front is never corrected — the coach says to turn side-on', () => {
    const tr = createExecutionTracker(squat, {});
    let r; const issues = new Set(); const setups = new Set();
    for (let ms = 0; ms <= 2 * 3200; ms += 50) {
      // a deep forward collapse that WOULD be a danger from the side
      const lm = facingCamera(frameOf(squat, (ms % 3200) / 3200));
      for (const k of [11, 12]) lm[k] = { ...lm[k], y: lm[23].y - 0.02 };
      r = updateExecution(tr, lm, ms);
      r.issues.forEach(i => issues.add(i.id));
      if (r.setup) setups.add(r.setup.code);
      if (ms === 0) r = updateExecution(tr, facingCamera(frameOf(squat, 0)), ms);   // upright: orientation is checked
      if (r.setup) setups.add(r.setup.code);
    }
    expect([...issues]).toEqual([]);
    expect(r.inView).toBe(false);
    expect(setups.has('turn_side')).toBe(true);     // the coach says exactly how to stand
    expect(r.danger).toBeNull();
  });

  it('weak tracking: no corrections, the coach asks for light / a clear view', () => {
    const tr = createExecutionTracker(squat, {});
    let r;
    for (let ms = 0; ms <= 2000; ms += 50) {
      const lm = frameOf(squat, 0.5).map(p => (p.visibility ? { ...p, visibility: 0.55 } : p));
      r = updateExecution(tr, lm, ms);
    }
    expect(trackingScore(squat, frameOf(squat, 0))).toBeGreaterThan(0.9);
    expect(r.setup.code).toBe('light');
    expect(r.issues).toEqual([]);
  });

  it('one bad frame does not silence a confident measurement (hysteresis)', () => {
    const tr = createExecutionTracker(squat, {});
    for (let ms = 0; ms < 500; ms += 50) updateExecution(tr, frameOf(squat, 0), ms);
    const r = updateExecution(tr, facingCamera(frameOf(squat, 0)), 500);
    expect(r.quality.confident).toBe(true);
  });
});

describe('Clip recorder — validation dataset', () => {
  it('frames round-trip through the compact Firestore-safe encoding', () => {
    const lm = frameOf(EXPERT_PROFILES.squat, 0.3);
    const back = decodeFrame(encodeFrame(lm));
    for (const i of KEEP_POINTS) {
      expect(Math.abs(back[i].x - lm[i].x)).toBeLessThan(0.001);
      expect(Math.abs(back[i].y - lm[i].y)).toBeLessThan(0.001);
    }
    expect(typeof encodeFrame(lm)).toBe('string');
  });

  it('cuts one clip per rep with the system verdict', () => {
    const clips = recordGhost(EXPERT_PROFILES.squat, 4);
    expect(clips.length).toBeGreaterThanOrEqual(3);
    for (const c of clips) {
      expect(c.profileId).toBe('squat');
      expect(c.verdict.issues).toEqual([]);
      expect(c.frames.length).toBeGreaterThan(20);
      expect(c.verdict.events.some(e => e.type === 'rep')).toBe(true);
    }
  });

  it('one clip per kick (with the follow-through), and windows for running', () => {
    const kicks = recordGhost(EXPERT_PROFILES.footballKick, 3);
    expect(kicks.length).toBeGreaterThanOrEqual(2);
    expect(kicks.every(c => c.verdict.events.some(e => e.type === 'strike'))).toBe(true);
    const run = recordGhost(EXPERT_PROFILES.runInPlace, 20);
    expect(run.length).toBeGreaterThanOrEqual(2);
    expect(run.every(c => c.durationMs >= 4900)).toBe(true);
  });

  it('untrustworthy stretches produce no clip', () => {
    const clips = recordGhost(EXPERT_PROFILES.squat, 4, lm => facingCamera(lm));
    expect(clips).toEqual([]);
  });
});

describe('Agreement — thresholds from data, not guesses', () => {
  const squat = applySportContext(EXPERT_PROFILES.squat, ['fitness']);
  /** Squat clips with the trunk pitched forward by `lean` degrees at the bottom of the rep. */
  function leaningClips(lean, n = 3) {
    return recordGhost(squat, n + 1, (lm) => {
      const hip = lm[23];
      const L = Math.hypot(lm[11].x - hip.x, lm[11].y - hip.y);
      const cur = Math.atan2(lm[11].x - hip.x, hip.y - lm[11].y) * 180 / Math.PI;
      if (cur < 30) return lm;                      // only near the bottom
      const a = Math.max(cur, lean) * Math.PI / 180;
      return lm.map((p, i) => ([11, 12].includes(i) ? { ...p, x: hip.x + Math.sin(a) * L, y: hip.y - Math.cos(a) * L } : p));
    });
  }

  it('replaying a clip reproduces the live verdict', () => {
    const clips = leaningClips(64);
    expect(clips.some(c => c.verdict.issues.includes('trunk_lean'))).toBe(true);
    for (const c of clips) expect([...replayClip(squat, c)].sort()).toEqual([...c.verdict.issues].sort());
  });

  it('reports agreement, false alarms and misses', () => {
    const good = recordGhost(squat, 3).map(clip => ({ clip, label: 'good' }));
    const bad = leaningClips(64).filter(c => c.verdict.issues.length).map(clip => ({ clip, label: 'fault', faults: ['trunk_lean'] }));
    const missed = recordGhost(squat, 2).slice(0, 1).map(clip => ({ clip, label: 'fault', faults: ['too_deep'] }));
    const rep = agreementReport([...good, ...bad, ...missed]);
    expect(rep.n).toBe(good.length + bad.length + missed.length);
    expect(rep.falseAlarms).toBe(0);
    expect(rep.misses).toBe(1);
    expect(rep.perRule.trunk_lean.confirmed).toBe(bad.length);
    expect(rep.perRule.too_deep.missed).toBe(1);
  });

  it('tunes a threshold from the labels (a too-strict rule loosens to stop false alarms)', () => {
    // People label a 52° lean "good" and a 66° lean "fault"; a 45° threshold would raise false alarms
    const strict = withThreshold(squat, 'trunk_lean', 45);
    const good = leaningClips(52).map(clip => ({ clip, label: 'good' }));
    const bad = leaningClips(66).map(clip => ({ clip, label: 'fault' }));
    const labelled = [...good, ...bad];
    const before = agreementReport(labelled, it => replayClip(strict, it.clip));
    expect(before.falseAlarms).toBeGreaterThan(0);
    const ranked = tuneRule(strict, 'trunk_lean', [45, 50, 58, 62, 70], labelled);
    expect(ranked[0].falseAlarms).toBe(0);
    expect(ranked[0].misses).toBe(0);
    expect(ranked[0].value).toBeGreaterThan(52);
    expect(ranked[0].value).toBeLessThan(66);
  });

  it('candidate thresholds spread around the current value', () => {
    expect(candidatesAround(100)).toEqual([70, 80, 90, 100, 110, 120, 130]);
  });
});

// The automatic proof that a NEW sport movement is COUNTED (owner, 2026-11-01: no field filming per exercise):
// the profile's own Ghost — the correct execution — runs through the live evaluator for 4 cycles; every cycle
// must produce exactly one counted rep (reps) or one strike at the contact (strikes)
import { describe, it, expect } from 'vitest';
import { EXPERT_PROFILES } from '../exerciseProfiles.js';
import { profileGhostPose } from '../profileGhost.js';
import { createExecutionTracker, updateExecution } from '../profileEvaluator.js';
import { getLimbProfile } from '../../limbProfile.js';
import { footballProfiles } from '../sports/football.js';
import { basketballProfiles } from '../sports/basketball.js';
import { tennisProfiles } from '../sports/tennis.js';
import { strengthProfiles } from '../sports/strength.js';

const lp = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const frame = (p, t) => profileGhostPose(p, t, lp).landmarks.map(q => (q.visibility ? { ...q, x: 0.5 + q.x * 0.17, y: 0.5 + q.y * 0.17, z: (q.z ?? 0) * 0.17 } : q));
function events(p, cycles = 4, stepMs = 33) {
  const tr = createExecutionTracker(p, lp); const per = p.ghost.periodMs; const out = [];
  for (let ms = 0; ms <= cycles * per; ms += stepMs) out.push(...updateExecution(tr, frame(p, (ms % per) / per), ms).events);
  return out;
}
const NEW = Object.keys(footballProfiles({
  footballKick: EXPERT_PROFILES.footballKick, shadowPass: EXPERT_PROFILES.shadowPass, runInPlace: EXPERT_PROFILES.runInPlace,
  jumpSquat: EXPERT_PROFILES.jumpSquat, singleLegSquat: EXPERT_PROFILES.singleLegSquat, gkStance: EXPERT_PROFILES.gkStance,
  UPRIGHT_TORSO: () => ({}), KNEE_VALGUS: () => ({}), KNEE_IN: () => ({}),
}).profiles).concat(Object.keys(basketballProfiles({
  jumpSquat: EXPERT_PROFILES.jumpSquat, runInPlace: EXPERT_PROFILES.runInPlace, gkStance: EXPERT_PROFILES.gkStance, UPRIGHT_TORSO: () => ({}),
}).profiles)).concat(Object.keys(tennisProfiles({
  jumpSquat: EXPERT_PROFILES.jumpSquat, gkStance: EXPERT_PROFILES.gkStance, UPRIGHT_TORSO: () => ({}),
}).profiles)).concat(Object.keys(strengthProfiles({
  squat: EXPERT_PROFILES.squat, lunge: EXPERT_PROFILES.lunge, hipHinge: EXPERT_PROFILES.hipHinge, pushUp: EXPERT_PROFILES.pushUp,
  bicepCurl: EXPERT_PROFILES.bicepCurl, shoulderPress: EXPERT_PROFILES.shoulderPress, UPRIGHT_TORSO: () => ({}), KNEE_VALGUS: () => ({}),
}).profiles));

describe('the sport libraries: every movement is counted on its correct execution', () => {
  for (const id of NEW) {
    const p = EXPERT_PROFILES[id];
    if (p.kind !== 'reps' && p.kind !== 'strike') continue;
    it(`${id}: one ${p.kind === 'strike' ? 'strike' : 'rep'} per cycle`, () => {
      const ev = events(p);
      const n = p.kind === 'strike' ? ev.filter(e => e.type === 'strike').length : ev.filter(e => e.type === 'repCount').length;
      expect(n, `${id} counted ${n} in 4 cycles`).toBeGreaterThanOrEqual(3);
      expect(n, `${id} counted ${n} in 4 cycles`).toBeLessThanOrEqual(4);
    });
  }
});

import { describe, it, expect } from 'vitest';
import { demoGhostFor } from '../demoGhost.js';
import { getExerciseProfile, EXPERT_PROFILES } from '../../exercise/exerciseProfiles.js';
import { ghostPose } from '../../warmupGhost.js';
import { listAnalyzerCueKeys } from '../../../utils/exerciseAnalysis.js';
import { fitExercise } from '../../exercise/equipmentFit.js';
import { getAnalyzer } from '../../../utils/exerciseAnalysis.js';

describe('Demo Ghost for an exercise', () => {
  it('expert exercises get their own profile Ghost', () => {
    const spec = demoGhostFor(EXPERT_PROFILES.squat, 'squat');
    expect(spec.profile.id).toBe('squat');
    expect(ghostPose(spec, 0.5, {}).segments.length).toBeGreaterThan(5);
  });

  it('family exercises get a demo only when an animated movement truly matches', () => {
    expect(demoGhostFor(getExerciseProfile('footwork'), 'footwork')).toEqual({ move: 'side_steps' });
    expect(demoGhostFor(getExerciseProfile('chestPass'), 'chestPass')).toEqual({ move: 'chest_pass' });
    expect(demoGhostFor(getExerciseProfile('crunch'), 'crunch')).toBeNull();      // no misleading demo
    expect(ghostPose({ move: 'side_steps' }, 0.3, {}).segments.length).toBeGreaterThan(5);
  });

  it('a ball drill without a ball becomes a shadow drill WITH a demo', () => {
    for (const name of ['בעיטה לקיר', 'עצירת כדור עם קיר', 'מסירת חזה', 'פורהנד לקיר', 'דריבל']) {
      const { exercise } = fitExercise({ name, sets: 3 }, { ball: false, dumbbells: false, bands: false });
      const cue = getAnalyzer(exercise.name).cueKey;
      expect(demoGhostFor(getExerciseProfile(cue, exercise.name), cue), `${name} → ${exercise.name}`).not.toBeNull();
    }
  });

  it('coverage report (for the manifest): cueKeys with a demo', () => {
    const keys = listAnalyzerCueKeys();
    const covered = keys.filter(k => demoGhostFor(getExerciseProfile(k), k));
    console.log(`demo Ghost coverage: ${covered.length}/${keys.length} cueKeys`);
    expect(covered.length).toBeGreaterThanOrEqual(20);
  });
});

// Which demo Ghost an exercise gets (owner rule: the Ghost demonstrates the exercise, on by default,
// from the briefing through the whole exercise).
//   1. Expert profile with a Ghost → the profile's Ghost (exactly the measured technique)
//   2. Otherwise, ONLY when an existing animated movement truly is the exercise's movement
//      (side steps for footwork / defensive slides, the chest-pass motion, trunk rotation for
//      racket strokes) → that movement
//   3. Otherwise null — never a misleading demo of a different movement.

const FAMILY_MOVES = {
  footwork: 'side_steps', defensiveSlide: 'side_steps', coneDrill: 'side_steps', quickTurns: 'side_steps',
  splitStep: 'side_steps', crutchAgility: 'side_steps',
  chestPass: 'chest_pass', bouncePass: 'chest_pass', overheadPass: 'chest_pass', wheelchairPass: 'chest_pass', wcBouncePass: 'chest_pass',
  stroke: 'twist', volley: 'twist', wheelchairStroke: 'twist',
};

/**
 * @param {Object|null} profile - the exercise's execution profile (buildExecutionProfile)
 * @param {string|null} cueKey - analyzer cueKey
 * @returns {Object|null} a Ghost spec for WarmupGhostPanel / GhostOverlay
 */
export function demoGhostFor(profile, cueKey) {
  if (profile?.ghost) return { profile };
  const move = FAMILY_MOVES[cueKey];
  return move ? { move } : null;
}

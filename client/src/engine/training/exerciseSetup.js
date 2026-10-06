// Does an exercise need the location's equipment set-up ("place two chairs 2 m apart")?
// Only drills that really use markers / targets do. Catalog exercises (bodyweight / shadow
// patterns) never do — the coach must not tell someone to set up chairs for a plank.

import { getAnalyzer } from '../../utils/exerciseAnalysis.js';

const SETUP_CUES = new Set([
  'dribbling', 'coneDrill', 'crossover', 'pass', 'kick', 'shooting', 'firstTouch', 'juggle', 'quickTurns',
  'shieldBall', 'crutchDribble', 'crutchAgility', 'crutchPass', 'amputeeKick', 'layup', 'handDribble',
  'stroke', 'volley', 'serve', 'smash', 'defensiveSlide', 'footwork', 'gkDistribution',
]);

export function exerciseNeedsSetup(ex) {
  if (!ex || ex.catalogId) return false;
  return SETUP_CUES.has(getAnalyzer(ex.name || '').cueKey);
}

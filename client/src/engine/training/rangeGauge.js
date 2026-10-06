// When does the ROM (range-of-motion) gauge belong on screen?
// Only in DYNAMIC exercises whose repetitions move a joint through a real range (squat,
// push-up, press, curl…). Never in static holds (plank, wall sit, a static ball stop against
// the wall), technique / ball drills, kicks or running — there it measures nothing real.

const STATIC_WORDS = ['סטטי', 'סטטית', 'החזקה', 'החזק', 'עצירה', 'עצירת', 'static', 'hold', 'isometric', 'איזומטרי'];

/**
 * @param {{ analyzerType?: string, profileKind?: string, exerciseName?: string }} p
 *   analyzerType: exerciseAnalysis getAnalyzer().type ('reps' | 'hold' | 'form')
 *   profileKind:  execution profile kind ('reps' | 'hold' | 'cyclic' | 'strike')
 */
export function showsRangeGauge({ analyzerType, profileKind, exerciseName } = {}) {
  if (analyzerType !== 'reps') return false;
  if (profileKind && profileKind !== 'reps') return false;
  const name = String(exerciseName || '').toLowerCase();
  return !STATIC_WORDS.some(w => name.includes(w));
}

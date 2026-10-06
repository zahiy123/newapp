import { describe, it, expect } from 'vitest';
import { showsRangeGauge } from '../rangeGauge.js';
import { getAnalyzer } from '../../../utils/exerciseAnalysis.js';
import { getExerciseProfile } from '../../exercise/exerciseProfiles.js';

const forName = (name) => {
  const a = getAnalyzer(name);
  return showsRangeGauge({ analyzerType: a.type, profileKind: getExerciseProfile(a.cueKey, name).kind, exerciseName: name });
};

describe('ROM gauge only in dynamic range-of-motion exercises', () => {
  it('shown for dynamic rep exercises', () => {
    for (const n of ['סקוואט', 'שכיבות סמיכה', 'לחיצת כתפיים', 'כפיפות מרפק ביספס', "לאנג'", 'הרמה צידית']) expect(forName(n), n).toBe(true);
  });

  it('hidden for static holds and stops', () => {
    for (const n of ['פלאנק', 'ישיבה על הקיר', 'עצירת כדור סטטית עם קיר', 'החזקת גוף חלול', 'סקוואט סטטי']) expect(forName(n), n).toBe(false);
  });

  it('hidden for technique / ball drills, kicks and running', () => {
    for (const n of ['דריבל', 'בעיטה לקיר', 'ריצה במקום', 'מסירה', 'שליטה ראשונית בכדור']) expect(forName(n), n).toBe(false);
  });
});

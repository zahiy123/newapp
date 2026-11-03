import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import WorkoutReport from '../WorkoutReport';

describe('The workout report renders', () => {
  it('sets, problems, what was fixed, safe mode, pain', () => {
    const html = renderToString(<WorkoutReport isHe workout={{ dataVersion: 2, exercises: [
      { key: 'pass', name: 'מסירה בצל', repsActual: 12, repsTarget: 12, setsCompleted: 2, setsTarget: 3, accuracy: 78,
        sets: [{ accuracy: 70, problems: [{ key: 'toe', what: 'מגע באצבעות', times: 3, critical: true }], fixed: [] },
          { accuracy: 86, problems: [], fixed: [{ key: 'chest', what: 'החזה מעל הכדור' }], safeMode: true }] },
      { key: 'squat', name: 'סקוואט', repsActual: 8, repsTarget: 10, sets: [{ accuracy: 90, problems: [], fixed: [] }] },
    ], painReports: [{ level: 7, zone: 'stump', exercise: 'מסירה בצל', choice: 'safe_mode' }] }} />);
    for (const s of ['מסירה בצל', 'מגע באצבעות', 'תוקן אחרי עצירה', 'החזה מעל הכדור', 'מצב בטוח', 'גדם', '86%', 'בלי טעויות חוזרות']) expect(html).toContain(s);
  });
  it('an old workout says it has no detailed data', () => {
    expect(renderToString(<WorkoutReport isHe={false} workout={{ exercises: [{ name: 'x', repsActual: 5 }] }} />)).toContain('before the detailed data');
  });
});

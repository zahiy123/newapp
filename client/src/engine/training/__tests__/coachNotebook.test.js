import { describe, it, expect } from 'vitest';
import { notebookFacts, worstPain, notesText, daysSince, openingFacts, painToCheck } from '../coachNotebook.js';

const DAY = 864e5;
const entry = { summary: 'אימון טוב.', performance: 'עומק טוב בסקוואט', pain: 'כאב בברך', focusNext: 'יציבות הברך', followUp: 'איך הברך?', at: 10 * DAY, worstPain: { level: 5, zone: 'knee', exercise: 'סקוואט' } };

describe('The coach notebook', () => {
  it('the facts come from the workout record', () => {
    const f = notebookFacts({ exercises: [{ name: 'סקוואט' }], painReports: [{ level: 5 }], durationSec: 1830, readiness: 3, profile: { name: 'זהי', trainingTrack: 'rehab_sport' } });
    expect(f).toMatchObject({ name: 'זהי', track: 'rehab_sport', minutes: 31, readiness: 3, lang: 'he' });
    expect(f.previousNotes).toBe('');
  });
  it('the worst pain of a workout', () => {
    expect(worstPain([{ level: 2, zone: 'back' }, { level: 6, zone: 'knee', exercise: 'x', choice: 'safe_mode' }])).toEqual({ level: 6, zone: 'knee', exercise: 'x', choice: 'safe_mode' });
    expect(worstPain([])).toBe(null);
    expect(worstPain([{ level: 0 }])).toBe(null);
  });
  it('the opening facts: when, the notes, and a pain of 4+ by name', () => {
    expect(daysSince(entry, 12 * DAY + 5)).toBe(2);
    const f = openingFacts(entry, { now: 12 * DAY });
    expect(f.mode).toBe('opening');
    expect(f.error.what).toContain('לפני 2 ימים');
    expect(f.error.what).toContain('כאב 5 בברך');
    expect(f.error.what).toContain('יציבות הברך');
    expect(openingFacts(null)).toBe(null);
    expect(notesText({})).toBe('');
  });
  it('a pain to check at the start only from 4 up', () => {
    expect(painToCheck(entry)).toMatchObject({ level: 5, zone: 'knee' });
    expect(painToCheck({ worstPain: { level: 3 } })).toBe(null);
    expect(painToCheck(null)).toBe(null);
  });
});

import { describe, it, expect } from 'vitest';
import { keywordIn, sanitizePlan } from '../../utils/workoutStorage';

describe('the cross-sport filter never removes a real drill by a look-alike word', () => {
  it('a short keyword is a whole word (a Hebrew one-letter prefix allowed)', () => {
    expect(keywordIn('סלאלום בין קונוסים', 'סל')).toBe(false);      // slalom ≠ basket
    expect(keywordIn('כדור סל', 'סל')).toBe(true);
    expect(keywordIn('זריקה לסל', 'סל')).toBe(true);
    expect(keywordIn('גולגולת', 'גול')).toBe(false);
    expect(keywordIn('גול מהיר', 'גול')).toBe(true);
  });
  it('a longer keyword keeps the substring match (inflected forms are still caught)', () => {
    expect(keywordIn('כדורגל', 'כדור')).toBe(true);
    expect(keywordIn('wheelchair push', 'wheelchair')).toBe(true);
  });
  it('a football plan keeps its slalom drill; a basketball shot is still removed', () => {
    const plan = { weeks: [{ days: [{ exercises: [{ name: 'סלאלום בין קונוסים עם כדור' }, { name: 'קליעה לסל' }, { name: 'דריבל במקום' }] }] }] };
    const out = sanitizePlan(plan, 'footballAmputee', 30);
    expect(out.weeks[0].days[0].exercises.map(e => e.name)).toEqual(['סלאלום בין קונוסים עם כדור', 'דריבל במקום']);
  });
});

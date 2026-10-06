import { describe, it, expect } from 'vitest';
import { exerciseNeedsSetup } from '../exerciseSetup.js';

describe('Equipment set-up instructions only where equipment is used', () => {
  it('cone / ball drills: yes; catalog bodyweight exercises: never ("two chairs" for a plank)', () => {
    expect(exerciseNeedsSetup({ name: 'דריבל בין קונוסים' })).toBe(true);
    expect(exerciseNeedsSetup({ name: 'סיבובי ידיים', catalogId: 'armCircles|standard|full|both|i30' })).toBe(false);
    expect(exerciseNeedsSetup({ name: 'פלאנק', catalogId: 'plank|standard|full|both|h30' })).toBe(false);
    expect(exerciseNeedsSetup({ name: 'סקוואט' })).toBe(false);
  });
});

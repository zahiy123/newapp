import { describe, it, expect } from 'vitest';
import { requiredEquipment, needsEquipmentCheck } from '../equipmentNeed';

describe('equipment finder — opt-in only', () => {
  it('never for ball / shadow drills or bodyweight', () => {
    expect(needsEquipmentCheck({ name: 'מסירה בצל · בדיוק', description: 'מסירה עם פנים הרגל לכדור' })).toBe(false);
    expect(needsEquipmentCheck({ name: 'בעיטה לשער', tips: ['עקב הרגל התומכת ליד הכדור'] })).toBe(false);
    expect(needsEquipmentCheck({ name: 'סקוואט' })).toBe(false);
    expect(needsEquipmentCheck({ name: 'Dribbling slalom', description: 'cones and a ball' })).toBe(false);
    expect(needsEquipmentCheck(null)).toBe(false);
  });
  it('only when a chair / bottle / can is named', () => {
    expect(requiredEquipment({ name: 'דיפס על כיסא' })).toBe('chair');
    expect(requiredEquipment({ name: 'הרמה צידית', description: 'עם בקבוק מים בכל יד' })).toBe('bottle');
    expect(requiredEquipment({ name: 'כפיפות מרפק', instructions: 'החזק פחית בכל יד' })).toBe('can');
    expect(requiredEquipment({ name: 'Step-ups', description: 'onto a sturdy chair' })).toBe('chair');
  });
  it('a wheelchair is not equipment', () => {
    expect(needsEquipmentCheck({ name: 'אגרוף ישיבה', description: 'יושבים בכיסא גלגלים' })).toBe(false);
    expect(needsEquipmentCheck({ name: 'Seated punches', description: 'in your wheelchair' })).toBe(false);
  });
});

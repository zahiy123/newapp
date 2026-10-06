import { describe, it, expect } from 'vitest';
import { requiredEquipment, availableEquipment, fitExercises, fitExercise, needsBall } from '../equipmentFit.js';
import { getAnalyzer, listAnalyzerCueKeys } from '../../../utils/exerciseAnalysis.js';
import { getExerciseProfile } from '../exerciseProfiles.js';

const ex = (name, extra = {}) => ({ name, sets: 3, reps: '10', restSeconds: 45, ...extra });
const noBall = { ball: false, dumbbells: false, bands: false };

describe('Equipment requirements', () => {
  it('ball drills need a ball', () => {
    for (const n of ['עצירת כדור עם קיר', 'בעיטה לקיר', 'מסירה לקיר', 'דריבל בין קונוסים', 'שליטה ראשונית', 'ג\'אגלינג', 'נגיחות ראש', 'זריקה לסל', 'כדרור ביד', 'פורהנד לקיר', 'הגשה', 'מסירת חזה', 'בעיטה בקביים'])
      expect(requiredEquipment(ex(n)).has('ball'), n).toBe(true);
  });

  it('look-alikes are NOT ball drills', () => {
    for (const n of ['בעיטות פרפר', 'בעיטות ישבן', 'בעיטות חמור', 'סקוואט', 'שכיבות סמיכה', 'עבודת רגליים', 'בעיטה בצל — תנועת בעיטה באוויר', 'תנועת זריקה בצל'])
      expect(requiredEquipment(ex(n)).has('ball'), n).toBe(false);
    expect(requiredEquipment(ex('הרמות עקב', { description: 'עלייה על כריות כף הרגל' })).size).toBe(0);
  });

  it('weights and bands', () => {
    expect(requiredEquipment(ex('סקוואט גובלט')).has('dumbbells')).toBe(true);
    expect(requiredEquipment(ex('כפיפות מרפק עם משקולות')).has('dumbbells')).toBe(true);
    expect(requiredEquipment(ex('מתיחת גומייה')).has('bands')).toBe(true);
    expect(requiredEquipment(ex('סקוואט — משקל גוף')).size).toBe(0);
  });
});

describe('Available equipment', () => {
  it('the session answer wins; unknown stays null', () => {
    expect(availableEquipment({ equipment: 'none' }).ball).toBeNull();
    expect(availableEquipment({ hasBall: true }, { hasBall: false }).ball).toBe(false);
    expect(availableEquipment({ hasBall: false }).ball).toBe(false);
    expect(availableEquipment({ equipment: 'dumbbells' }).dumbbells).toBe(true);
    expect(availableEquipment({ equipment: 'none', location: 'gym' }).bands).toBe(true);
  });
});

describe('Hard fit — never offer an exercise the trainee cannot do', () => {
  it('"no ball" removes every ball drill (owner case: ball stop against the wall)', () => {
    const plan = ['עצירת כדור עם קיר', 'סקוואט', 'בעיטה לקיר', 'דריבל', 'נגיחות ראש', 'זריקה לסל', 'פלאנק'].map(n => ex(n));
    const { exercises, substitutions } = fitExercises(plan, noBall);
    expect(needsBall(exercises)).toBe(false);
    expect(substitutions.length).toBe(5);
    expect(exercises.map(e => e.name)).toContain('סקוואט');
    expect(exercises.map(e => e.name)).toContain('פלאנק');
    for (const e of exercises) expect(e.sets).toBe(3);
  });

  it('a ball is kept when the trainee has one; unknown ball is not decided here', () => {
    expect(fitExercise(ex('בעיטה לקיר'), { ball: true }).substitution).toBeNull();
    expect(fitExercise(ex('בעיטה לקיר'), { ball: null }).substitution).toBeNull();
  });

  it('every ball / load substitute maps to a real analyzer of the same pattern and needs nothing missing', () => {
    const expectCue = { 'בעיטה לקיר': 'kick', 'זריקה לסל': 'shooting', 'פורהנד לקיר': 'stroke', 'הגשה': 'serve', 'מסירת חזה': 'chestPass', 'דריבל': 'footwork', 'נגיחות ראש': 'jump', 'עצירת כדור עם קיר': 'footwork', 'בעיטה בקביים': 'kick' };
    for (const [name, cue] of Object.entries(expectCue)) {
      const r = fitExercise(ex(name), noBall);
      expect(requiredEquipment(r.exercise).size, name).toBe(0);
      expect(getAnalyzer(r.exercise.name).cueKey, `${name} → ${r.exercise.name}`).toBe(cue);
      expect(r.exercise.name.includes('כדור'), r.exercise.name).toBe(false);
    }
  });

  it('a shadow kick keeps the expert kick profile (and its Ghost)', () => {
    const r = fitExercise(ex('בעיטה לקיר'), noBall);
    expect(getExerciseProfile(getAnalyzer(r.exercise.name).cueKey, r.exercise.name).id).toBe('footballKick');
  });

  it('no dumbbells → bodyweight version of the same pattern', () => {
    const { exercises } = fitExercises([ex('סקוואט גובלט'), ex('כפיפות מרפק עם משקולות'), ex('לחיצת כתפיים עם משקולות')], noBall);
    expect(exercises.map(e => getAnalyzer(e.name).cueKey)).toEqual(['squat', 'rehabElbowFlex', 'push']);
    for (const e of exercises) expect(requiredEquipment(e).size).toBe(0);
  });
});

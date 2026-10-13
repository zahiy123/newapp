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
  it('"no ball" KEEPS every ball drill, done with the virtual ball (owner, 2026-10-13 — replaces the old removal rule)', () => {
    const plan = ['עצירת כדור עם קיר', 'סקוואט', 'בעיטה לקיר', 'דריבל', 'נגיחות ראש', 'זריקה לסל', 'פלאנק'].map(n => ex(n));
    const { exercises, substitutions } = fitExercises(plan, noBall);
    expect(substitutions.length).toBe(0);
    expect(exercises.map(e => e.name)).toEqual(plan.map(e => e.name));
    expect(exercises.filter(e => e.virtualBall).map(e => e.name))
      .toEqual(['עצירת כדור עם קיר', 'בעיטה לקיר', 'דריבל', 'נגיחות ראש', 'זריקה לסל']);
    for (const e of exercises) expect(e.sets).toBe(3);
  });

  it('a ball is kept when the trainee has one; unknown ball is not decided here', () => {
    expect(fitExercise(ex('בעיטה לקיר'), { ball: true }).substitution).toBeNull();
    expect(fitExercise(ex('בעיטה לקיר'), { ball: null }).substitution).toBeNull();
    expect(fitExercise(ex('בעיטה לקיר'), { ball: true }).exercise.virtualBall).toBeUndefined();
  });

  it('every kept ball drill keeps its own analyzer (the same movement, now on the virtual ball)', () => {
    const expectCue = { 'בעיטה לקיר': 'kick', 'זריקה לסל': 'shooting', 'פורהנד לקיר': 'stroke', 'הגשה': 'serve', 'מסירת חזה': 'chestPass', 'בעיטה בקביים': 'kick' };
    for (const [name, cue] of Object.entries(expectCue)) {
      const r = fitExercise(ex(name), noBall);
      expect(r.exercise.virtualBall, name).toBe(true);
      expect(getAnalyzer(r.exercise.name).cueKey, name).toBe(cue);
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

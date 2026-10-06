import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsBall, fitWeekToEquipment } from '../equipmentFit.js';

test('ball drills are detected; look-alikes are not', () => {
  for (const n of ['עצירת כדור עם קיר', 'דריבל בין קונוסים', 'מסירה לקיר', 'נגיחות ראש', 'פורהנד לקיר', 'בעיטה לקיר']) {
    assert.equal(needsBall({ name: n }), true, n);
  }
  for (const n of ['בעיטות פרפר', 'בעיטות ישבן', 'סקוואט', 'בעיטה בצל — תנועת בעיטה באוויר', 'תנועת זריקה בצל']) {
    assert.equal(needsBall({ name: n }), false, n);
  }
});

test('no ball → no ball drill survives; unknown / has ball → unchanged', () => {
  const week = () => ({ days: [{ exercises: [{ name: 'עצירת כדור עם קיר', sets: 3 }, { name: 'סקוואט', sets: 3 }, { name: 'בעיטה לקיר', sets: 4 }] }] });
  const fitted = fitWeekToEquipment(week(), { hasBall: false });
  assert.equal(fitted.days[0].exercises.some(needsBall), false);
  assert.equal(fitted.days[0].exercises[1].name, 'סקוואט');
  assert.equal(fitted.days[0].exercises[2].name, 'בעיטה בצל — תנועת בעיטה באוויר');
  assert.equal(fitted.days[0].exercises[2].sets, 4);
  assert.deepEqual(fitWeekToEquipment(week(), { hasBall: true }), week());
  assert.deepEqual(fitWeekToEquipment(week(), {}), week());
});

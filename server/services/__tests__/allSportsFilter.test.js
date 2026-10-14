import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCrossSportLeakage, keywordIn } from '../claude.js';

// The AI's generated plans are filtered on the SERVER by the chosen sport — the same expectations
// as the client (client/src/engine/__tests__/allSports.test.js), for every sport
const SPORT_DRILLS = {
  football: { keep: ['דריבל בין קונוסים', 'סלאלום עם כדור', 'מסירה לקיר', 'בעיטה לשער', "ג'אגלינג", 'נגיחות ראש'], drop: ['קליעה לסל', 'פורהנד לקיר'] },
  footballAmputee: { keep: ['דריבל בקביים', 'מסירה בקביים', 'סלאלום בקביים עם כדור'], drop: ['קליעה לסל'] },
  basketball: { keep: ['כדרור כדורסל במקום', 'קליעה לסל', 'מסירת חזה', 'קרוסאובר'], drop: ['בעיטה לשער', 'נגיחות ראש'] },
  tennis: { keep: ['פורהנד לקיר', 'בקהנד', 'הגשה'], drop: ['בעיטה לשער', 'קליעה לסל'] },
};

for (const [sport, { keep, drop }] of Object.entries(SPORT_DRILLS)) {
  test(`server filter — ${sport}: keeps its own drills, removes the other sports'`, () => {
    const week = { weekNumber: 1, days: [{ exercises: [...keep, ...drop].map(name => ({ name, sets: 3 })) }] };
    const names = filterCrossSportLeakage(week, sport).days[0].exercises.map(e => e.name);
    for (const n of keep) assert.ok(names.includes(n), `${sport} must keep "${n}" — got ${names.join(', ')}`);
    for (const n of drop) assert.ok(!names.includes(n), `${sport} must drop "${n}"`);
  });
}

test('short keywords are whole words (slalom is not basketball)', () => {
  assert.equal(keywordIn('סלאלום', 'סל'), false);
  assert.equal(keywordIn('קליעה לסל', 'סל'), true);
});

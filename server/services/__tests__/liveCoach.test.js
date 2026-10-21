import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCuePrompt, buildDebriefPrompt, numbersGrounded, directionsKept, readable, generateCue, generateDebrief, CUE_MODEL, DEBRIEF_MODELS } from '../liveCoach.js';

const cueFacts = {
  lang: 'he', name: 'זהי', exercise: 'מסירה בצל', sport: 'footballAmputee', body: 'left below-knee prosthesis',
  rep: 4, error: { what: 'הקרסול לא נעול ברגע המגע', why: 'קרסול רפוי בולע את המכה', how: 'משוך את האצבעות אל השוק', measured: 152, target: 'עד 140 מעלות', times: 3 },
  recent: ['נעל את הקרסול — אצבעות למעלה!'],
};

test('the cue prompt carries the measured facts and forbids invented numbers', () => {
  const { system, user } = buildCuePrompt(cueFacts);
  assert.match(system, /ONLY the measured facts/);
  assert.match(system, /3 to 6 words, ONE COMPLETE short sentence, NO name/);
  const u = JSON.parse(user);
  assert.equal(u.error.measured, 152);
  assert.equal(u.rep, 4);
  assert.deepEqual(u.recentCues, cueFacts.recent);
});

test('numbers: only measured ones (and small counting words) pass', () => {
  assert.equal(numbersGrounded('הקרסול ב-152 מעלות, היעד עד 140', cueFacts), true);
  assert.equal(numbersGrounded('הקרסול ב-165 מעלות', cueFacts), false);
  assert.equal(numbersGrounded('עוד 2 חזרות ככה', cueFacts), true);
});

test('a generated cue is used; an invented number / too long / a repeat → null (the device speaks its own)', async () => {
  const say = (t) => async () => t;
  assert.equal(await generateCue(cueFacts, { askFn: say('זהי, נעל את הקרסול חזק ברגע המגע!') }), 'זהי, נעל את הקרסול חזק ברגע המגע!');
  assert.equal(await generateCue(cueFacts, { askFn: say('הקרסול ב-170 מעלות — נעל אותו') }), null);
  assert.equal(await generateCue(cueFacts, { askFn: say('א'.repeat(120)) }), null);
  assert.equal(await generateCue(cueFacts, { askFn: say('נעל את הקרסול — אצבעות למעלה!') }), null);
});

test('the coach never reverses the measured direction or swaps the working side', () => {
  const f = { side: 'right', error: { what: 'הברכיים נופלות פנימה — דחוף אותן החוצה', how: 'דחוף את הברך החוצה' } };
  assert.equal(directionsKept('זהי, ברכיים החוצה!', f), true);
  const g = { side: 'right', error: { what: 'ברך הרגל הבועטת פונה החוצה', how: 'ברך החוצה' } };
  assert.equal(directionsKept('ברך פנימה לפני המגע', g), false);         // the real error Haiku made
  assert.equal(directionsKept('ברך ימין החוצה!', g), true);
  assert.equal(directionsKept('ברך שמאל החוצה!', g), false);             // the prosthetic side — never
  assert.equal(directionsKept('ברך שמאל החוצה!', { error: { what: 'x' } }), false);   // no side given → none said
  assert.equal(directionsKept('בסט הבא אתה מוסר ברגל שמאל', { errors: [], extras: ['בסט הבא מחליפים רגל: מסירות ברגל שמאל'] }), true);   // the facts said it
});

test('the cue uses the fast model', async () => {
  let used = null;
  await generateCue(cueFacts, { askFn: async (m) => { used = m; return 'נעל קרסול!'; } });
  assert.equal(used, CUE_MODEL);
});

const setFacts = {
  lang: 'he', name: 'זהי', exercise: 'סקוואט', setNo: 1, reps: 6, accuracy: 72, attempts: 8, partial: 2, unit: 'reps',
  errors: [{ what: 'רד עמוק יותר', n: 5, judged: 8, severity: 'error', measured: 131, target: 'בין 65 ל-105 מעלות', why: 'w', how: 'h' }],
  clean: ['הגב נשאר יציב וזקוף'], extras: [],
};

test('the debrief prompt has the log; the answer is parsed into speech + card, grounded', async () => {
  const u = JSON.parse(buildDebriefPrompt(setFacts).user);
  assert.equal(u.errors[0].times, 5);
  assert.deepEqual(u.measuredClean, ['הגב נשאר יציב וזקוף']);
  const good = JSON.stringify({ speech: 'זהי, שש חזרות ודיוק 72 אחוז. הברך הגיעה ל-131 מעלות בחמש מתוך שמונה — ...', card: [{ kind: 'fix', title: 'עומק: 131 מול 65 עד 105', detail: ['ישבן אחורה'] }, { kind: 'good', title: 'הגב יציב', detail: [] }] });
  const d = await generateDebrief(setFacts, { askFn: async () => good });
  assert.match(d.speech, /131/);
  assert.equal(d.card.length, 2);
  assert.equal(d.card[0].kind, 'fix');
  const lie = JSON.stringify({ speech: 'הברך הגיעה ל-118 מעלות, כמעט מושלם', card: [] });
  assert.equal(await generateDebrief(setFacts, { askFn: async () => lie }), null);
});

test('a model this key cannot use → the next model', async () => {
  const tried = [];
  const d = await generateDebrief(setFacts, { askFn: async (m) => { tried.push(m); if (m === DEBRIEF_MODELS[0]) throw new Error('404 not_found_error: model'); return JSON.stringify({ speech: 'זהי, סט טוב עם דיוק 72 אחוז ונקודה אחת לעומק.', card: [] }); } });
  assert.deepEqual(tried, DEBRIEF_MODELS);
  assert.ok(d.speech.includes('72'));
});

test('garbled facts (a broken encoding) never reach the AI; SKIP is honoured', async () => {
  assert.equal(readable('הקרסול לא נעול'), true);
  assert.equal(readable('??? ?? ????'), false);
  let called = false;
  const garbled = { ...cueFacts, error: { ...cueFacts.error, what: '??? ?? ???? — ?????' } };
  assert.equal(await generateCue(garbled, { askFn: async () => { called = true; return 'x'; } }), null);
  assert.equal(called, false);
  assert.equal(await generateCue(cueFacts, { askFn: async () => 'SKIP' }), null);
  const g2 = { ...setFacts, errors: [{ ...setFacts.errors[0], what: '?????' }] };
  assert.equal(await generateDebrief(g2, { askFn: async () => { called = true; return '{}'; } }), null);
  assert.equal(called, false);
});

import { aiErrorKind } from '../liveCoach.js';
test('an Anthropic failure is classified for the log and the screen (credit / auth / rate / overloaded / timeout)', () => {
  assert.equal(aiErrorKind(new Error('400 {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}')), 'credit');
  assert.equal(aiErrorKind(Object.assign(new Error('invalid x-api-key'), { status: 401 })), 'auth');
  assert.equal(aiErrorKind(Object.assign(new Error('rate limited'), { status: 429 })), 'rate');
  assert.equal(aiErrorKind(Object.assign(new Error('Overloaded'), { status: 529 })), 'overloaded');
  assert.equal(aiErrorKind(new Error('Request timed out.')), 'timeout');
});

import { generateBodyVision } from '../liveCoach.js';
const bigFrame = 'x'.repeat(5000);
test('the whole-body eyes: findings parsed with guards — no numbers, readable words, at most 3; a broken reply is no finding', async () => {
  const reply = JSON.stringify({ findings: [
    { code: 'Arms-Locked!', severity: 'minor', confidence: 0.7, cue: 'פתח ידיים לאיזון', what: 'הידיים צמודות לגוף' },
    { code: 'bad_num', severity: 'major', confidence: 0.9, cue: 'כופף 30 מעלות', what: 'הברך ב-30 מעלות' },
  ], good: [{ text: 'רגל התמיכה יציבה', confidence: 0.8 }] });
  const v = await generateBodyVision({ frame: bigFrame, lang: 'he', exercise: 'מסירה' }, { askFn: async () => reply });
  assert.equal(v.findings.length, 1);                                  // the one with a number is dropped
  assert.equal(v.findings[0].code, 'armslocked');
  assert.equal(v.good[0].text, 'רגל התמיכה יציבה');
  assert.equal(await generateBodyVision({ frame: bigFrame }, { askFn: async () => '{"findings":[{"code":"x",}]' }), null);
  assert.equal(await generateBodyVision({ frame: 'tiny' }, { askFn: async () => reply }), null);
});

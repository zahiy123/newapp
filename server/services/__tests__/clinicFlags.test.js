import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patientFlags } from '../clinicFlags.js';

const DAY = 864e5;
const now = 100 * DAY;
const codes = (f) => f.map(x => x.code);

test('red pain, repeated yellow, safe mode — only in the last 7 days; red first', () => {
  const f = patientFlags({ now, pains: [{ level: 7, at: now - DAY }, { level: 4, at: now - DAY }, { level: 5, at: now - 2 * DAY }, { level: 8, at: now - 20 * DAY }], workouts: [{ at: now - DAY }] });
  assert.deepEqual(codes(f), ['red_pain', 'repeated_yellow']);
  assert.equal(patientFlags({ now, pains: [{ level: 7, at: now - 9 * DAY }], workouts: [{ at: now - DAY }] }).length, 0);
  assert.ok(codes(patientFlags({ now, pains: [{ level: 7, at: now - DAY, choice: 'safe_mode' }], workouts: [{ at: now - DAY }] })).includes('safe_mode'));
});
test('a ROM drop of 15+ degrees in the last 2 workouts; a step down; inactivity', () => {
  const ws = [{ at: now - 5 * DAY, rom: { left_knee: 100 } }, { at: now - 3 * DAY, rom: { left_knee: 80 } }, { at: now - DAY, rom: { left_knee: 82 } }];
  assert.deepEqual(codes(patientFlags({ now, workouts: ws })), ['rom_drop']);
  assert.deepEqual(codes(patientFlags({ now, workouts: [{ at: now - 2 * DAY, dataVersion: 2, loadStep: 0 }, { at: now - DAY, dataVersion: 2, loadStep: -1 }] })), ['stepped_down']);
  assert.deepEqual(codes(patientFlags({ now, workouts: [{ at: now - 10 * DAY }] })), ['inactive']);
  assert.deepEqual(patientFlags({ now, workouts: [] }), []);
});

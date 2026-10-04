// Run: node --test services/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnatomyDiagnosis, applySideCorrection } from '../anatomyDiagnosis.js';

const intact = { status: 'intact', level: null, evidence: '' };

test('left below-knee prosthesis only → TRANSTIBIAL, side left, clean summary', () => {
  const d = normalizeAnatomyDiagnosis({
    limbs: {
      left_leg: { status: 'prosthetic', level: 'below_knee', evidence: 'carbon pylon and socket visible below the left knee' },
      right_leg: intact, left_arm: intact, right_arm: intact,
    },
    confidence: 0.9,
  });
  assert.equal(d.classification, 'TRANSTIBIAL_AMPUTEE');
  assert.equal(d.adaptedTrack, 'TRANSTIBIAL_AMPUTEE');
  assert.equal(d.prostheticSide, 'left');
  assert.equal(d.description_he, 'רגל שמאל: קטיעה מתחת לברך עם פרוטזה. תקינות: רגל ימין, יד שמאל, יד ימין.');
  assert.ok(!d.description_he.includes('ימין:'), 'no finding on the right side');
});

test('an "amputation" without visual evidence is NOT reported (no invented limbs)', () => {
  const d = normalizeAnatomyDiagnosis({
    limbs: {
      left_leg: { status: 'prosthetic', level: 'below_knee', evidence: 'pylon and socket visible below the left knee' },
      right_leg: { status: 'prosthetic', level: 'above_knee', evidence: '' },   // no evidence
      left_arm: { status: 'absent', evidence: 'maybe' },                         // too short
      right_arm: intact,
    },
  });
  assert.equal(d.classification, 'TRANSTIBIAL_AMPUTEE');
  assert.equal(d.prostheticSide, 'left');
  assert.equal(d.limbs.right_leg.status, 'unclear');
  assert.equal(d.limbs.left_arm.status, 'unclear');
  assert.ok(!d.description_he.includes('רגל ימין: קטיעה'));
  assert.ok(d.description_he.includes('לא נראו בבירור: רגל ימין, יד שמאל'));
});

test('above-knee level → TRANSFEMORAL', () => {
  const d = normalizeAnatomyDiagnosis({
    limbs: { left_leg: intact, right_leg: { status: 'prosthetic', level: 'above_knee', evidence: 'mechanical knee joint visible' }, left_arm: intact, right_arm: intact },
  });
  assert.equal(d.classification, 'TRANSFEMORAL_AMPUTEE');
  assert.equal(d.prostheticSide, 'right');
});

test('both legs with evidence → BILATERAL', () => {
  const ev = { status: 'prosthetic', level: 'below_knee', evidence: 'running blade visible on this leg' };
  const d = normalizeAnatomyDiagnosis({ limbs: { left_leg: ev, right_leg: ev, left_arm: intact, right_arm: intact } });
  assert.equal(d.classification, 'BILATERAL_AMPUTEE');
  assert.equal(d.prostheticSide, 'bilateral');
  assert.equal(d.specialProtocol, 'bilateral');
});

test('all intact → NATURAL', () => {
  const d = normalizeAnatomyDiagnosis({ limbs: { left_leg: intact, right_leg: intact, left_arm: intact, right_arm: intact } });
  assert.equal(d.classification, 'NATURAL');
  assert.equal(d.adaptedTrack, 'NORMAL');
  assert.equal(d.prostheticSide, null);
  assert.equal(d.description_he, 'לא זוהו קטיעות או פרוטזות.');
});

test('garbage / missing model output → safe NATURAL with all limbs unclear', () => {
  const d = normalizeAnatomyDiagnosis(null);
  assert.equal(d.classification, 'NATURAL');
  assert.equal(d.description_he, 'לא ניתן היה לראות את הגפיים בבירור.');
  assert.ok(d.confidence <= 0.7);
});

test('only known aids are kept', () => {
  const d = normalizeAnatomyDiagnosis({ limbs: {}, aids: ['crutches', 'jetpack'] });
  assert.deepEqual(d.aids, ['crutches']);
  assert.equal(d.mobilityAid, 'crutches');
});

test('side correction moves the leg finding to the corrected side and rebuilds the summary', () => {
  const wrong = normalizeAnatomyDiagnosis({
    limbs: { left_leg: intact, right_leg: { status: 'prosthetic', level: 'below_knee', evidence: 'socket and pylon visible' }, left_arm: intact, right_arm: intact },
  });
  assert.equal(wrong.prostheticSide, 'right');
  const fixed = applySideCorrection(wrong, 'left');
  assert.equal(fixed.prostheticSide, 'left');
  assert.equal(fixed.classification, 'TRANSTIBIAL_AMPUTEE');
  assert.equal(fixed.limbs.right_leg.status, 'intact');
  assert.ok(fixed.description_he.startsWith('רגל שמאל: קטיעה מתחת לברך'));
  assert.equal(fixed.correctedByUser, true);
});

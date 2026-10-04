import { describe, it, expect } from 'vitest';
import {
  ARM_LANDMARKS,
  ARM_TESTS,
  isArmPresent,
  detectArmMovement,
  analyzeArmMovement,
  summarizeArmAssessment,
} from '../ArmAssessment.js';
import {
  ScanSequencer,
  STATE,
  MOTION_CAL_MOVEMENTS,
  MOTION_CAL_MEASURE_MIN_SEC,
  MOTION_CAL_MEASURE_MAX_SEC,
  MOTION_CAL_MAX_ATTEMPTS,
  motionCalPrepSec,
} from '../ScanSequencer.js';
import { LM } from '../movements.js';


// ---- Synthetic body ----
// Shoulders at y=0.30, hips at y=0.55. Each arm is driven by:
//   shoulderDeg — angle between trunk and upper arm (0 = hanging, 180 = overhead)
//   elbowFlexDeg — elbow flexion (0 = straight arm)
const UPPER_ARM = 0.15;
const FOREARM = 0.13;

function baseBody() {
  const lm = [];
  for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
  lm[LM.LEFT_SHOULDER] = { x: 0.60, y: 0.30, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_SHOULDER] = { x: 0.40, y: 0.30, z: 0, visibility: 0.95 };
  lm[LM.LEFT_HIP] = { x: 0.57, y: 0.55, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_HIP] = { x: 0.43, y: 0.55, z: 0, visibility: 0.95 };
  lm[LM.LEFT_KNEE] = { x: 0.57, y: 0.72, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_KNEE] = { x: 0.43, y: 0.72, z: 0, visibility: 0.95 };
  lm[LM.LEFT_ANKLE] = { x: 0.57, y: 0.88, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_ANKLE] = { x: 0.43, y: 0.88, z: 0, visibility: 0.95 };
  lm[LM.LEFT_HEEL] = { x: 0.57, y: 0.90, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_HEEL] = { x: 0.43, y: 0.90, z: 0, visibility: 0.95 };
  setArm(lm, 'right', 5, 0);
  setArm(lm, 'left', 5, 0);
  return lm;
}

/** Position one arm. Right arm extends toward smaller x, left toward larger x. */
function setArm(lm, side, shoulderDeg, elbowFlexDeg, visibility = 0.95) {
  const idx = ARM_LANDMARKS[side];
  const dir = side === 'right' ? -1 : 1;
  const sh = lm[idx.shoulder];
  const a = (shoulderDeg * Math.PI) / 180;
  const elbow = { x: sh.x + dir * Math.sin(a) * UPPER_ARM, y: sh.y + Math.cos(a) * UPPER_ARM, z: 0, visibility };
  const b = ((shoulderDeg + elbowFlexDeg) * Math.PI) / 180;
  const wrist = { x: elbow.x + dir * Math.sin(b) * FOREARM, y: elbow.y + Math.cos(b) * FOREARM, z: 0, visibility };
  lm[idx.elbow] = elbow;
  lm[idx.wrist] = wrist;
}

/** Oscillating series of frames: value goes min → max → min over `period` frames. */
function oscillate(n, min, max, period, build) {
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = (1 - Math.cos((2 * Math.PI * i) / period)) / 2;
    frames.push(build(min + (max - min) * t));
  }
  return frames;
}


// ============================================================
// ArmAssessment module
// ============================================================

describe('ArmAssessment', () => {
  it('measures shoulder flexion peak for a healthy arm', () => {
    const frames = oscillate(90, 5, 170, 45, deg => { const lm = baseBody(); setArm(lm, 'right', deg, 0); return lm; });
    const r = analyzeArmMovement(frames, 'right', ARM_TESTS.FLEXION);
    expect(r.status).toBe('assessed');
    expect(r.moved).toBe(true);
    expect(r.peakDeg).toBeGreaterThan(150);
    expect(r.restDeg).toBeLessThan(20);
  });

  it('measures a limited arm separately from the healthy arm', () => {
    const right = oscillate(90, 5, 170, 45, deg => { const lm = baseBody(); setArm(lm, 'right', deg, 0); return lm; });
    const left = oscillate(90, 5, 80, 45, deg => { const lm = baseBody(); setArm(lm, 'left', deg, 0); return lm; });
    const r = analyzeArmMovement(right, 'right', ARM_TESTS.FLEXION);
    const l = analyzeArmMovement(left, 'left', ARM_TESTS.FLEXION);
    expect(r.peakDeg).toBeGreaterThan(150);
    expect(l.peakDeg).toBeLessThan(90);
    expect(l.peakDeg).toBeGreaterThan(60);
  });

  it('measures elbow flexion range', () => {
    const frames = oscillate(90, 0, 130, 45, flex => { const lm = baseBody(); setArm(lm, 'left', 5, flex); return lm; });
    const r = analyzeArmMovement(frames, 'left', ARM_TESTS.ELBOW);
    expect(r.moved).toBe(true);
    expect(r.elbowMaxDeg).toBeGreaterThan(170);   // straight
    expect(r.elbowMinDeg).toBeLessThan(60);       // flexed to ~50°
    expect(r.rangeDeg).toBeGreaterThan(110);
  });

  it('reports no movement for a still arm', () => {
    const frames = Array.from({ length: 90 }, () => baseBody());
    expect(detectArmMovement(frames, 'right', ARM_TESTS.FLEXION)).toBe(false);
    const r = analyzeArmMovement(frames, 'right', ARM_TESTS.FLEXION);
    expect(r.status).toBe('no_movement');
    expect(r.moved).toBe(false);
  });

  it('flags shoulder elevation when the shoulder hikes during the raise', () => {
    const frames = oscillate(90, 5, 120, 45, deg => {
      const lm = baseBody();
      lm[LM.RIGHT_SHOULDER].y = 0.30 - (deg / 120) * 0.05; // hikes up to 0.05 (torso ≈ 0.25)
      setArm(lm, 'right', deg, 0);
      return lm;
    });
    const r = analyzeArmMovement(frames, 'right', ARM_TESTS.ABDUCTION);
    expect(r.compensation.shoulderElevation).toBe(true);
    expect(r.compensation.trunkLean).toBe(false);
  });

  it('isArmPresent is false when the arm landmarks are not visible', () => {
    const frames = Array.from({ length: 30 }, () => { const lm = baseBody(); setArm(lm, 'left', 5, 0, 0.05); return lm; });
    expect(isArmPresent(frames, 'left')).toBe(false);
    expect(isArmPresent(frames, 'right')).toBe(true);
  });

  it('summarizes each arm separately', () => {
    const right = oscillate(90, 5, 170, 45, deg => { const lm = baseBody(); setArm(lm, 'right', deg, 0); return lm; });
    const summary = summarizeArmAssessment({
      right: { [ARM_TESTS.FLEXION]: analyzeArmMovement(right, 'right', ARM_TESTS.FLEXION) },
      left: { [ARM_TESTS.FLEXION]: { side: 'left', test: 'flexion', status: 'not_visible', moved: false } },
    });
    expect(summary.right_arm.status).toBe('assessed');
    expect(summary.right_arm.shoulderFlexionDeg).toBeGreaterThan(150);
    expect(summary.left_arm.status).toBe('not_visible');
    expect(summary.left_arm.shoulderFlexionDeg).toBeNull();
  });
});


// ============================================================
// ScanSequencer integration — per-arm calibration
// ============================================================

describe('ScanSequencer per-arm calibration', () => {
  const idx = (id) => MOTION_CAL_MOVEMENTS.findIndex(m => m.id === id);

  /**
   * Drive the motion calibration with a frame generator per movement id.
   * Returns the detection transition (end of calibration) or null.
   */
  function runCalibration(seq, frameForMovement, maxFrames = 20000) {
    seq.start();
    seq.feedFrame(baseBody()); // CALIBRATING → PHASE_A (motionCalibration)
    expect(seq.state).toBe(STATE.PHASE_A);
    const counters = {};
    for (let i = 0; i < maxFrames; i++) {
      if (seq._phaseASubState !== 'motionCalibration') break;
      const movement = MOTION_CAL_MOVEMENTS[seq._motionCalIndex];
      counters[movement.id] = (counters[movement.id] || 0) + 1;
      const change = seq.feedFrame(frameForMovement(movement, counters[movement.id]));
      if ((change?.subState === 'detection' || change?.subState === 'visionDiagnosis')) return change;
    }
    return null;
  }

  function wave(i, min, max) {
    return min + (max - min) * (1 - Math.cos((2 * Math.PI * i) / 45)) / 2;
  }

  /** Healthy right arm, limited left arm (shoulder up to 80°, elbow up to 60° flexion). */
  function healthyRightLimitedLeft(movement, i) {
    const lm = baseBody();
    // Hand raises: first frame of the step is the resting baseline, then the hand goes up
    if (movement.id === 'raise_right_hand' && i > 1) setArm(lm, 'right', 175, 0);
    if (movement.id === 'raise_left_hand' && i > 1) setArm(lm, 'left', 80, 0);
    if (movement.armSide === 'right' && movement.armTest !== ARM_TESTS.ELBOW) setArm(lm, 'right', wave(i, 5, 170), 0);
    if (movement.armSide === 'right' && movement.armTest === ARM_TESTS.ELBOW) setArm(lm, 'right', 5, wave(i, 0, 140));
    if (movement.armSide === 'left' && movement.armTest !== ARM_TESTS.ELBOW) setArm(lm, 'left', wave(i, 5, 80), 0);
    if (movement.armSide === 'left' && movement.armTest === ARM_TESTS.ELBOW) setArm(lm, 'left', 5, wave(i, 0, 60));
    return lm;
  }

  it('assesses the right and left arm separately (one healthy, one limited)', () => {
    const seq = new ScanSequencer({ sampleRate: 30 });
    const end = runCalibration(seq, healthyRightLimitedLeft);
    expect(end).not.toBeNull();

    const arms = end.armAssessment;
    expect(arms.right_arm.status).toBe('assessed');
    expect(arms.left_arm.status).toBe('assessed');
    expect(arms.right_arm.shoulderFlexionDeg).toBeGreaterThan(150);
    expect(arms.left_arm.shoulderFlexionDeg).toBeLessThan(90);
    expect(arms.right_arm.elbowRangeDeg).toBeGreaterThan(110);
    expect(arms.left_arm.elbowRangeDeg).toBeLessThan(70);
    // The limited arm does not hide behind the healthy one
    expect(arms.left_arm.shoulderFlexionDeg).toBeLessThan(arms.right_arm.shoulderFlexionDeg - 50);
  });

  it('records both hand raises in the calibration results', () => {
    const seq = new ScanSequencer({ sampleRate: 30 });
    const end = runCalibration(seq, healthyRightLimitedLeft);
    expect(end.calibrationResults.handRaise.right.raised).toBe(true);
    expect(end.calibrationResults.handRaise.left.raised).toBe(true);
  });

  it('a still (e.g. paralyzed) arm never blocks the scan — it is recorded as no_movement', () => {
    const seq = new ScanSequencer({ sampleRate: 30 });
    const end = runCalibration(seq, (movement, i) => {
      const lm = baseBody();
      if (movement.armSide === 'right') setArm(lm, 'right', wave(i, 5, 170), 0);
      // left arm never moves
      return lm;
    });
    expect(end).not.toBeNull();
    expect(end.armAssessment.left_arm.status).toBe('no_movement');
    expect(end.armAssessment.right_arm.status).toBe('assessed');
  });

  it('walking in place is skipped (never instructed) when a wheelchair is detected', () => {
    const seq = new ScanSequencer({ sampleRate: 30 });
    seq.start();
    seq.feedFrame(baseBody());
    seq.setImageContext({ wheelchair: true, prosthetic: false, confidence: 0.9 });

    const instructions = [];
    let end = null;
    const counters = {};
    for (let i = 0; i < 20000 && seq._phaseASubState === 'motionCalibration'; i++) {
      const movement = MOTION_CAL_MOVEMENTS[seq._motionCalIndex];
      counters[movement.id] = (counters[movement.id] || 0) + 1;
      const change = seq.feedFrame(healthyRightLimitedLeft(movement, counters[movement.id]));
      if (change?.instruction) instructions.push(change.instruction);
      if (seq._phaseASubState !== 'motionCalibration') { end = change; break; }  // first change after calibration
    }
    expect(end).not.toBeNull();
    expect(end.calibrationResults.marchInPlace.status).toBe('skipped_wheelchair');
    expect(instructions).not.toContain(MOTION_CAL_MOVEMENTS[idx('march_in_place_cal')].instruction);
  });

  it('an arm that is not visible is skipped without emitting its instruction (Iron Rule)', () => {
    const seq = new ScanSequencer({ sampleRate: 30 });
    seq.start();
    seq.feedFrame(baseBody());
    // Recent frames: left arm not visible
    for (let i = 0; i < 30; i++) {
      const lm = baseBody();
      setArm(lm, 'left', 5, 0, 0.05);
      seq._landmarkFrames.push(lm);
    }
    // Jump to the end of the right-arm block and advance into the left-arm block
    seq._motionCalIndex = idx('right_elbow_flex');
    const change = seq._advanceMotionCalibration();

    expect(change.instruction).toBe(MOTION_CAL_MOVEMENTS[idx('slight_bend')].instruction);
    expect(seq._armTests.left.flexion.status).toBe('not_visible');
    expect(seq._armTests.left.abduction.status).toBe('not_visible');
    expect(seq._armTests.left.elbow.status).toBe('not_visible');
    expect(seq.armAssessment.left_arm.status).toBe('not_visible');
  });

  it('raise_left_hand detects a mirrored camera when the right-hand step was missed', () => {
    const seq = new ScanSequencer({ sampleRate: 30 });
    seq.start();
    seq.feedFrame(baseBody());
    // raise_right_hand: nothing happens → times out
    for (let i = 0; i < 2000 && seq._motionCalIndex === idx('raise_right_hand'); i++) seq.feedFrame(baseBody());
    expect(seq._motionCalIndex).toBe(idx('raise_left_hand'));
    expect(seq._handRaiseResult.right.raised).toBe(false);

    // raise_left_hand: baseline, then the RIGHT wrist rises instead → mirrored
    seq.feedFrame(baseBody());
    for (let i = 0; i < 2000 && !seq._mirrored; i++) {
      const lm = baseBody();
      setArm(lm, 'right', 175, 0);
      seq.feedFrame(lm);
    }
    expect(seq._mirrored).toBe(true);
  });
});


// ============================================================
// Timing — get-ready phase + minimum measurement window
// ============================================================

describe('ScanSequencer calibration timing', () => {
  const RATE = 30;
  const idx = (id) => MOTION_CAL_MOVEMENTS.findIndex(m => m.id === id);

  function startAtFirstMovement() {
    const seq = new ScanSequencer({ sampleRate: RATE });
    seq.start();
    const first = seq.feedFrame(baseBody());
    expect(first.motionCalPhase).toBe('prep');
    return seq;
  }

  function raisedRight() {
    const lm = baseBody();
    setArm(lm, 'right', 175, 0);
    return lm;
  }

  it('get-ready time scales with the instruction and stays within 1.5-4 s', () => {
    for (const m of MOTION_CAL_MOVEMENTS) {
      const sec = motionCalPrepSec(m);
      expect(sec).toBeGreaterThanOrEqual(1.5);
      expect(sec).toBeLessThanOrEqual(4);
    }
    // Longer instruction → longer get-ready
    expect(motionCalPrepSec({ instruction: 'a b c d e f g h' }))
      .toBeGreaterThan(motionCalPrepSec({ instruction: 'a b c d' }));
  });

  it('does not advance immediately when the hand is raised — waits get-ready + a full measurement window', () => {
    const seq = startAtFirstMovement();
    const prepFrames = Math.ceil(motionCalPrepSec(MOTION_CAL_MOVEMENTS[0]) * RATE);
    const minFrames = Math.ceil(MOTION_CAL_MEASURE_MIN_SEC * RATE);

    // Hand goes up right away (frame 1 = rest baseline, then raised)
    seq.feedFrame(baseBody());
    let advancedAt = null;
    for (let i = 2; i <= prepFrames + minFrames + 5; i++) {
      const change = seq.feedFrame(raisedRight());
      if (change?.motionCalStep === idx('raise_left_hand')) { advancedAt = i; break; }
    }
    expect(advancedAt).not.toBeNull();
    // Never earlier than get-ready + the minimum measurement window
    expect(advancedAt).toBeGreaterThanOrEqual(prepFrames + minFrames);
    expect(MOTION_CAL_MEASURE_MIN_SEC).toBeGreaterThanOrEqual(2);
    expect(seq._handRaiseResult.right.raised).toBe(true);
  });

  it('emits a measureStart cue exactly when the get-ready phase ends', () => {
    const seq = startAtFirstMovement();
    const prepFrames = Math.ceil(motionCalPrepSec(MOTION_CAL_MOVEMENTS[0]) * RATE);
    let cueAt = null;
    for (let i = 1; i <= prepFrames + 10; i++) {
      const change = seq.feedFrame(i === 1 ? baseBody() : raisedRight());
      if (change?.measureStart) { cueAt = i; expect(change.motionCalPhase).toBe('measure'); break; }
    }
    expect(cueAt).toBe(prepFrames + 1);
  });

  it('movement during get-ready alone does not count — the window must still be completed', () => {
    const seq = startAtFirstMovement();
    const prepFrames = Math.ceil(motionCalPrepSec(MOTION_CAL_MOVEMENTS[0]) * RATE);
    seq.feedFrame(baseBody());
    for (let i = 2; i <= prepFrames; i++) {
      const change = seq.feedFrame(raisedRight());
      expect(change?.motionCalStep).not.toBe(idx('raise_left_hand'));
    }
    expect(seq._motionCalIndex).toBe(0);
  });

  it('hermetic lock: no movement → the SAME movement is repeated with a spoken nudge (never skipped)', () => {
    const seq = startAtFirstMovement();
    const prepFrames = Math.ceil(motionCalPrepSec(MOTION_CAL_MOVEMENTS[0]) * RATE);
    const maxFrames = Math.ceil(MOTION_CAL_MEASURE_MAX_SEC * RATE);
    let retry = null;
    let retryAt = null;
    for (let i = 1; i <= prepFrames + maxFrames + 5; i++) {
      const change = seq.feedFrame(baseBody());
      if (change?.nudge) { retry = change; retryAt = i; break; }
    }
    expect(retryAt).toBe(prepFrames + maxFrames);
    expect(retry.motionCalStep).toBe(idx('raise_right_hand'));   // same step, not the next one
    expect(retry.motionCalAttempt).toBe(2);
    expect(retry.motionCalPhase).toBe('prep');
    expect(retry.instruction_he).toContain('לא זיהיתי את התנועה');
    expect(retry.instruction_he).toContain(MOTION_CAL_MOVEMENTS[0].instruction_he);
    expect(seq._motionCalIndex).toBe(idx('raise_right_hand'));
  });

  it('a movement is recorded as not performed only after MOTION_CAL_MAX_ATTEMPTS, and the user is told', () => {
    const seq = startAtFirstMovement();
    const changes = [];
    for (let i = 0; i < 5000 && seq._motionCalIndex === idx('raise_right_hand'); i++) {
      const change = seq.feedFrame(baseBody());
      if (change) changes.push(change);
    }
    const nudges = changes.filter(c => c.nudge);
    expect(nudges).toHaveLength(MOTION_CAL_MAX_ATTEMPTS - 1);
    const next = changes[changes.length - 1];
    expect(next.motionCalStep).toBe(idx('raise_left_hand'));
    expect(next.instruction_he).toContain('ממשיכים לתנועה הבאה');
    expect(seq.calibrationResults.incompleteSteps).toEqual(['raise_right_hand']);
    expect(seq._handRaiseResult.right.raised).toBe(false);
  });

  it('a movement performed on a retry counts as performed', () => {
    const seq = startAtFirstMovement();
    // Attempt 1: nothing
    let i = 0;
    for (; i < 5000 && seq._motionCalAttempt === 1; i++) seq.feedFrame(baseBody());
    // Attempt 2: baseline, then the hand goes up
    seq.feedFrame(baseBody());
    for (let k = 0; k < 5000 && seq._motionCalIndex === idx('raise_right_hand'); k++) seq.feedFrame(raisedRight());
    expect(seq._motionCalIndex).toBe(idx('raise_left_hand'));
    expect(seq._handRaiseResult.right.raised).toBe(true);
    expect(seq.calibrationResults.incompleteSteps).toEqual([]);
  });
});


// ============================================================
// Detection sensitivity — real movements are caught, noise is not
// ============================================================

describe('ScanSequencer calibration sensitivity', () => {
  const RATE = 30;
  const idx = (id) => MOTION_CAL_MOVEMENTS.findIndex(m => m.id === id);

  /** Start the scan and jump to the given calibration step. */
  function atStep(id) {
    const seq = new ScanSequencer({ sampleRate: RATE });
    seq.start();
    seq.feedFrame(baseBody());
    seq._motionCalIndex = idx(id);
    seq._motionCalFrames = [];
    return seq;
  }

  /** Feed frames from gen(i) until the step changes; returns { advancedTo, nudged }. */
  function runStep(seq, gen, maxFrames = 2000) {
    const start = seq._motionCalIndex;
    let nudged = false;
    for (let i = 1; i <= maxFrames && seq._motionCalIndex === start; i++) {
      const change = seq.feedFrame(gen(i));
      if (change?.nudge) nudged = true;
      if (seq._phaseASubState !== 'motionCalibration') break;
    }
    return { advancedTo: seq._motionCalIndex, nudged };
  }

  /** Tiny random jitter like MediaPipe at rest. */
  function jitter(lm, amount = 0.004) {
    return lm.map(p => ({ ...p, x: p.x + (Math.random() - 0.5) * amount, y: p.y + (Math.random() - 0.5) * amount }));
  }

  it('a hand raised and lowered DURING the get-ready phase still counts (no retry)', () => {
    const seq = atStep('raise_right_hand');
    const r = runStep(seq, i => {
      const lm = baseBody();
      if (i > 5 && i < 25) setArm(lm, 'right', 175, 0);   // quick raise while the instruction plays
      return lm;
    });
    expect(r.nudged).toBe(false);
    expect(r.advancedTo).toBe(idx('raise_left_hand'));
    expect(seq._handRaiseResult.right.raised).toBe(true);
  });

  it('a hand that is already up at the start of the step is still detected after lowering and raising', () => {
    const seq = atStep('raise_left_hand');
    const r = runStep(seq, i => {
      const lm = baseBody();
      setArm(lm, 'left', i < 20 ? 170 : i < 50 ? 5 : 170, 0);
      return lm;
    });
    expect(r.nudged).toBe(false);
    expect(seq._handRaiseResult.left.raised).toBe(true);
  });

  it('a moderate hand raise (to shoulder height) is enough', () => {
    const seq = atStep('raise_right_hand');
    const r = runStep(seq, i => { const lm = baseBody(); if (i > 10) setArm(lm, 'right', 80, 0); return lm; });
    expect(r.nudged).toBe(false);
  });

  it('knee bend on the RIGHT knee only (left prosthetic side stiff) is detected', () => {
    const seq = atStep('slight_bend');
    const r = runStep(seq, i => {
      const lm = baseBody();
      const bend = (1 - Math.cos((2 * Math.PI * i) / 60)) / 2;
      lm[LM.RIGHT_KNEE] = { ...lm[LM.RIGHT_KNEE], x: 0.43 + 0.03 * bend };
      lm[LM.RIGHT_ANKLE] = { ...lm[LM.RIGHT_ANKLE], x: 0.43 - 0.01 * bend };
      return lm;
    });
    expect(r.nudged).toBe(false);
    expect(r.advancedTo).toBe(idx('pelvis_rotation'));
  });

  it('a short walking-in-place step (2.5% of frame height) is detected', () => {
    const seq = atStep('march_in_place_cal');
    let end = null;
    for (let i = 1; i < 2000 && seq._phaseASubState === 'motionCalibration'; i++) {
      const lm = baseBody();
      const lift = Math.max(0, Math.sin((2 * Math.PI * i) / 30)) * 0.025;
      lm[LM.RIGHT_ANKLE] = { ...lm[LM.RIGHT_ANKLE], y: 0.88 - lift };
      const change = seq.feedFrame(lm);
      if ((change?.subState === 'detection' || change?.subState === 'visionDiagnosis')) end = change;
    }
    expect(end?.calibrationResults.marchInPlace.status).toBe('assessed');
    expect(end.calibrationResults.incompleteSteps).toEqual([]);
  });

  it('standing still with camera jitter is NOT counted as a movement (no false positives)', () => {
    for (const id of ['raise_right_hand', 'slight_bend', 'calf_raise', 'right_arm_flexion']) {
      const seq = atStep(id);
      const r = runStep(seq, () => jitter(baseBody()));
      expect(r.nudged, id).toBe(true);
    }
  });

  it('an arm going out of frame (wrist not visible) does not freeze the calibration', () => {
    const seq = atStep('right_arm_flexion');
    for (let i = 0; i < 60; i++) {
      const lm = baseBody();
      setArm(lm, 'right', 175, 0);
      lm[LM.RIGHT_WRIST] = { ...lm[LM.RIGHT_WRIST], visibility: 0.0 };
      seq.feedFrame(lm);
    }
    expect(seq._fullBodyGatePaused).toBeFalsy();
    expect(seq._motionCalFrames.length).toBe(60);
  });
});

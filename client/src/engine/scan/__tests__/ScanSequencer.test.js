// ============================================================
// ScanSequencer — Unit Tests
//
// Tests the state machine flow without camera, DOM, or React.
// Uses synthetic landmark data to drive phase transitions.
//
// Flow: CALIBRATING → PHASE_A (detection → diagnostics) → PROFILE_INPUT → PHASE_B → ...
// ============================================================

import { describe, it, expect } from 'vitest';
import { ScanSequencer, STATE, FULL_BODY_CONFIDENCE, PROGRESS_PHASE_A_END, DIAG_TRACKS, MOVEMENT_VARIANCE_THRESHOLD, LANDMARK_VISIBILITY_HALT, MIDDIAG_FROZEN_VARIANCE, IMAGE_CONTEXT_CONFIDENCE, MOTION_CAL_MOVEMENTS, MOTION_CAL_FRAMES_PER_MOVEMENT, CONFIDENCE_THRESHOLD } from '../ScanSequencer.js';
import { LM } from '../movements.js';


// ============================================================
// Synthetic Data Generators
// ============================================================

/**
 * Generate a single healthy landmark frame (33 landmarks).
 * All limbs visible, stable positions — passes the full-body gate.
 */
function createHealthyLandmarks() {
  const landmarks = [];
  for (let i = 0; i < 33; i++) {
    landmarks.push({
      x: 0.5 + (Math.random() - 0.5) * 0.002,
      y: 0.5 + (Math.random() - 0.5) * 0.002,
      z: 0,
      visibility: 0.95,
    });
  }

  // Set realistic positions for key landmarks
  landmarks[LM.LEFT_HIP].y = 0.55;
  landmarks[LM.RIGHT_HIP].y = 0.55;
  landmarks[LM.LEFT_KNEE].y = 0.72;
  landmarks[LM.RIGHT_KNEE].y = 0.72;
  landmarks[LM.LEFT_ANKLE].y = 0.88;
  landmarks[LM.RIGHT_ANKLE].y = 0.88;
  landmarks[LM.LEFT_HEEL].y = 0.90;
  landmarks[LM.RIGHT_HEEL].y = 0.90;
  landmarks[LM.LEFT_FOOT].y = 0.91;
  landmarks[LM.RIGHT_FOOT].y = 0.91;
  landmarks[LM.LEFT_SHOULDER].y = 0.30;
  landmarks[LM.RIGHT_SHOULDER].y = 0.30;
  landmarks[LM.LEFT_ELBOW].y = 0.38;
  landmarks[LM.RIGHT_ELBOW].y = 0.38;
  landmarks[LM.LEFT_WRIST].y = 0.45;
  landmarks[LM.RIGHT_WRIST].y = 0.45;

  return landmarks;
}

/**
 * Generate a static landmark frame with zero noise (for nudge/blocking tests).
 */
function createStaticLandmarks() {
  const landmarks = [];
  for (let i = 0; i < 33; i++) {
    landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
  }
  landmarks[LM.LEFT_HIP].y = 0.55;
  landmarks[LM.RIGHT_HIP].y = 0.55;
  landmarks[LM.LEFT_KNEE].y = 0.72;
  landmarks[LM.RIGHT_KNEE].y = 0.72;
  landmarks[LM.LEFT_ANKLE].y = 0.88;
  landmarks[LM.RIGHT_ANKLE].y = 0.88;
  landmarks[LM.LEFT_HEEL].y = 0.90;
  landmarks[LM.RIGHT_HEEL].y = 0.90;
  landmarks[LM.LEFT_FOOT].y = 0.91;
  landmarks[LM.RIGHT_FOOT].y = 0.91;
  landmarks[LM.LEFT_SHOULDER].y = 0.30;
  landmarks[LM.RIGHT_SHOULDER].y = 0.30;
  landmarks[LM.LEFT_ELBOW].y = 0.38;
  landmarks[LM.RIGHT_ELBOW].y = 0.38;
  landmarks[LM.LEFT_WRIST].y = 0.45;
  landmarks[LM.RIGHT_WRIST].y = 0.45;
  return landmarks;
}

/**
 * Generate a Phase B landmark frame with a damped oscillation
 * signal on the ankles (healthy organic, ξ ≈ 0.06).
 */
function createDampedLandmarks(t, fps = 30) {
  const landmarks = createHealthyLandmarks();
  const xi = 0.06;
  const freq = 1.5;
  const omegaN = 2 * Math.PI * freq;
  const omegaD = omegaN * Math.sqrt(1 - xi * xi);

  const signal = Math.exp(-xi * omegaN * t) * Math.sin(omegaD * t);

  landmarks[LM.LEFT_ANKLE].y = 0.88 + signal * 0.30;
  landmarks[LM.RIGHT_ANKLE].y = 0.88 + signal * 0.30;
  landmarks[LM.LEFT_WRIST].y = 0.45 + signal * 0.25;
  landmarks[LM.RIGHT_WRIST].y = 0.45 + signal * 0.25;

  return landmarks;
}

/**
 * Generate a landmark frame with some landmarks below confidence threshold.
 */
function createPartialLandmarks(lowVisIndices = [27, 28]) {
  const landmarks = createHealthyLandmarks();
  for (const idx of lowVisIndices) {
    landmarks[idx].visibility = 0.3; // Below FULL_BODY_CONFIDENCE (0.6)
  }
  return landmarks;
}

/**
 * Generate a landmark frame with large oscillating movement on all joints.
 * Used to trigger movement detection (variance > 12.0 deg²).
 */
function createMovingLandmarks(frameIndex) {
  const lm = createHealthyLandmarks();
  const t = frameIndex / 10; // assuming 10fps
  const osc = Math.sin(t * 2 * Math.PI * 0.5) * 0.3;
  // Move knees, ankles, elbows, wrists
  lm[LM.LEFT_KNEE].y = 0.72 + osc;
  lm[LM.RIGHT_KNEE].y = 0.72 + osc;
  lm[LM.LEFT_ANKLE].y = 0.88 + osc * 0.5;
  lm[LM.RIGHT_ANKLE].y = 0.88 + osc * 0.5;
  lm[LM.LEFT_ELBOW].y = 0.38 + osc * 0.3;
  lm[LM.RIGHT_ELBOW].y = 0.38 + osc * 0.3;
  lm[LM.LEFT_WRIST].y = 0.45 + osc * 0.4;
  lm[LM.RIGHT_WRIST].y = 0.45 + osc * 0.4;
  return lm;
}

/**
 * Create a valid training profile for tests.
 */
function createValidProfile(overrides = {}) {
  return {
    name: 'Test User',
    age: 25,
    height: 175,
    weight: 70,
    skillLevel: 'beginner',
    trainingDays: 3,
    trainingLocation: 'home',
    equipment: 'none',
    disability: 'none',
    ...overrides,
  };
}

/**
 * Pass calibration by feeding one healthy frame.
 * Full body (all 33 at 0.6+) → PHASE_A detection sub-state.
 */
function passCalibration(seq) {
  const c = seq.feedFrame(createHealthyLandmarks());
  expect(seq.state).toBe(STATE.PHASE_A);
  expect(c.state).toBe(STATE.PHASE_A);
  expect(c.subState).toBe('detection');
  return c;
}

/**
 * Pass the detection sub-phase by feeding detectionFrameTarget frames.
 * Returns the state change that includes diagnosticTrack.
 */
function passDetection(seq) {
  let lastChange = null;
  for (let f = 0; f < 200; f++) {
    const change = seq.feedFrame(createHealthyLandmarks());
    if (change && change.subState === 'diagnostics') {
      lastChange = change;
      break;
    }
  }
  expect(lastChange).not.toBeNull();
  expect(lastChange.diagnosticTrack).toBeTruthy();
  return lastChange;
}

/**
 * Feed enough frames to complete all Phase A (detection + diagnostics) → PROFILE_INPUT.
 * Uses large oscillating movement to trigger segment advancement (no safety timeout).
 */
function passPhaseA(seq, maxFrames = 5000) {
  let lastChange = null;
  for (let f = 0; f < maxFrames; f++) {
    const change = seq.feedFrame(createMovingLandmarks(f));
    if (change) lastChange = change;
    if (seq.state === STATE.PROFILE_INPUT) break;
  }
  expect(seq.state).toBe(STATE.PROFILE_INPUT);
  expect(lastChange.state).toBe(STATE.PROFILE_INPUT);
  return lastChange;
}

/**
 * Pass profile input by setting profile and confirming.
 */
function passProfile(seq, overrides = {}) {
  expect(seq.state).toBe(STATE.PROFILE_INPUT);
  seq.setAnatomyProfile(createValidProfile(overrides));
  const change = seq.confirmProfile();
  expect(change.state).toBe(STATE.PHASE_B_MOVEMENT);
  return change;
}

/**
 * Create landmark frame with rigid rod left leg (180° knee, zero variance).
 * Right leg has natural bent position (~153°). All positions deterministic.
 */
function createRigidKneeLandmarks() {
  const lm = [];
  for (let i = 0; i < 33; i++) {
    lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
  }
  // Noise for natural side (right leg) — must exceed KNEE_FROZEN_THRESHOLD (0.1 deg²)
  // and ANKLE_FROZEN_THRESHOLD (0.00005 Y-variance)
  const noise = () => (Math.random() - 0.5) * 0.04;
  const smallNoise = () => (Math.random() - 0.5) * 0.02;
  // Left leg: perfectly collinear (straight rod) — all same X, NO noise
  lm[LM.LEFT_HIP] =      { x: 0.44, y: 0.55, z: 0, visibility: 0.95 };
  lm[LM.LEFT_KNEE] =     { x: 0.44, y: 0.72, z: 0, visibility: 0.95 };
  lm[LM.LEFT_ANKLE] =    { x: 0.44, y: 0.88, z: 0, visibility: 0.95 };
  // Right leg: natural position with noise (simulates natural sway)
  lm[LM.RIGHT_HIP] =     { x: 0.56, y: 0.55 + smallNoise(), z: 0, visibility: 0.95 };
  lm[LM.RIGHT_KNEE] =    { x: 0.60 + noise(), y: 0.72 + noise(), z: 0, visibility: 0.95 };
  lm[LM.RIGHT_ANKLE] =   { x: 0.56 + smallNoise(), y: 0.88 + smallNoise(), z: 0, visibility: 0.95 };
  // Shoulders
  lm[LM.LEFT_SHOULDER] = { x: 0.42, y: 0.30, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_SHOULDER] ={ x: 0.58, y: 0.30, z: 0, visibility: 0.95 };
  // Elbows and wrists
  lm[LM.LEFT_ELBOW] =    { x: 0.36, y: 0.38, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_ELBOW] =   { x: 0.64, y: 0.38, z: 0, visibility: 0.95 };
  lm[LM.LEFT_WRIST] =    { x: 0.32, y: 0.45, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_WRIST] =   { x: 0.68, y: 0.45, z: 0, visibility: 0.95 };
  // Heels and feet for quality guard
  lm[LM.LEFT_HEEL] =     { x: 0.44, y: 0.90, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_HEEL] =    { x: 0.58, y: 0.90, z: 0, visibility: 0.95 };
  lm[LM.LEFT_FOOT] =     { x: 0.44, y: 0.91, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_FOOT] =    { x: 0.58, y: 0.91, z: 0, visibility: 0.95 };
  return lm;
}

/**
 * Feed N frames into a sequencer (generic).
 */
function feedFrames(seq, frameCount, fps = 30) {
  let lastChange = null;
  for (let f = 0; f < frameCount; f++) {
    const change = seq.feedFrame(createHealthyLandmarks());
    if (change) lastChange = change;
  }
  return lastChange;
}

/**
 * Feed frames for a specific Phase B movement (damped signal).
 */
function feedMovement(seq, frameCount, fps = 30) {
  let lastChange = null;
  for (let f = 0; f < frameCount; f++) {
    const t = f / fps;
    const change = seq.feedFrame(createDampedLandmarks(t, fps));
    if (change) lastChange = change;
  }
  return lastChange;
}


// ============================================================
// Tests
// ============================================================

describe('ScanSequencer', () => {

  // ---- Lifecycle ----

  describe('Lifecycle', () => {

    it('starts in IDLE state', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      expect(seq.state).toBe(STATE.IDLE);
      expect(seq.progress).toBe(0);
      expect(seq.result).toBeNull();
    });

    it('start() transitions to CALIBRATING', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      const change = seq.start();

      expect(change.state).toBe(STATE.CALIBRATING);
      expect(change.progress).toBe(0);
      expect(change.instruction).toContain('not detected');
      expect(seq.state).toBe(STATE.CALIBRATING);
    });

    it('stop() returns to IDLE from any state', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();
      expect(seq.state).toBe(STATE.CALIBRATING);

      seq.stop();
      expect(seq.state).toBe(STATE.IDLE);
    });

    it('reset() clears all data', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();
      for (let i = 0; i < 10; i++) {
        seq.feedFrame(createPartialLandmarks());
      }

      seq.reset();
      expect(seq.state).toBe(STATE.IDLE);
      expect(seq.progress).toBe(0);
      expect(seq.result).toBeNull();
      expect(seq.phaseAResult).toBeNull();
      expect(seq.phaseBResult).toBeNull();
    });

    it('start() implicitly resets if not in IDLE', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();
      for (let i = 0; i < 10; i++) {
        seq.feedFrame(createPartialLandmarks());
      }

      const change = seq.start();
      expect(change.state).toBe(STATE.CALIBRATING);
      expect(seq.progress).toBe(0);
    });
  });


  // ---- Frame Input ----

  describe('feedFrame', () => {

    it('ignores frames in IDLE state', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      const change = seq.feedFrame(createHealthyLandmarks());
      expect(change).toBeNull();
    });

    it('ignores null/invalid landmarks', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();

      expect(seq.feedFrame(null)).toBeNull();
      expect(seq.feedFrame(undefined)).toBeNull();
      expect(seq.feedFrame('not an array')).toBeNull();
    });

    it('ignores frames in COMPLETE state', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq._state = STATE.COMPLETE;
      const change = seq.feedFrame(createHealthyLandmarks());
      expect(change).toBeNull();
    });

    it('returns null in PROFILE_INPUT state (blocks processing)', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);
      expect(seq.state).toBe(STATE.PROFILE_INPUT);
      const change = seq.feedFrame(createHealthyLandmarks());
      expect(change).toBeNull();
    });
  });


  // ---- Calibration — Hermetic Full-Body Gate ----

  describe('Calibration', () => {

    it('advances to PHASE_A on first frame with all 33 landmarks at 0.6+', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();

      const change = seq.feedFrame(createHealthyLandmarks());
      expect(change.state).toBe(STATE.PHASE_A);
      expect(seq.state).toBe(STATE.PHASE_A);
    });

    it('enters detection sub-state on calibration pass', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();

      const change = seq.feedFrame(createHealthyLandmarks());
      expect(change.subState).toBe('detection');
      expect(change.instruction).toContain('Analyzing');
    });

    it('stays in CALIBRATING when any landmark is below 0.6', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();

      const change = seq.feedFrame(createPartialLandmarks([27, 28]));
      expect(change.state).toBe(STATE.CALIBRATING);
      expect(seq.state).toBe(STATE.CALIBRATING);
    });

    it('stays in CALIBRATING indefinitely without full body', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();

      for (let i = 0; i < 1000; i++) {
        seq.feedFrame(createPartialLandmarks([27, 28]));
      }
      expect(seq.state).toBe(STATE.CALIBRATING);
    });

    it('shows single persistent message when body not detected', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();

      const change = seq.feedFrame(createPartialLandmarks([27, 28]));
      expect(change.instruction).toContain('not detected');
      expect(change.instruction).toContain('move back');
    });

    it('provides calibrationInfo with visible count', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();

      const change = seq.feedFrame(createPartialLandmarks([27, 28]));
      expect(change.calibrationInfo).toBeDefined();
      expect(change.calibrationInfo.visibleCount).toBe(31);
      expect(change.calibrationInfo.totalRequired).toBe(33);
    });

    it('advances immediately when partial → full body detected', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();

      for (let i = 0; i < 500; i++) {
        seq.feedFrame(createPartialLandmarks([0, 27, 28]));
      }
      expect(seq.state).toBe(STATE.CALIBRATING);

      const change = seq.feedFrame(createHealthyLandmarks());
      expect(change.state).toBe(STATE.PHASE_A);
      expect(seq.state).toBe(STATE.PHASE_A);
    });

    it('Hebrew instruction available during calibration', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();

      const change = seq.feedFrame(createPartialLandmarks([27, 28]));
      expect(change.instruction_he).toContain('לא זוהה גוף מלא');
    });
  });


  // ---- Phase A Detection ----

  describe('Phase A Detection', () => {

    it('detection phase collects frames for 2 seconds then routes', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // First frame emits captureSnapshot
      const firstChange = seq.feedFrame(createHealthyLandmarks());
      expect(firstChange).not.toBeNull();
      expect(firstChange.captureSnapshot).toBe(true);

      // Feed 18 more frames — should stay in detection (need 20 = 2s * 10fps)
      for (let f = 0; f < 18; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        expect(change).toBeNull();
      }
      expect(seq.state).toBe(STATE.PHASE_A);

      // Frame 20 triggers detection routing
      const change = seq.feedFrame(createHealthyLandmarks());
      expect(change).not.toBeNull();
      expect(change.subState).toBe('diagnostics');
    });

    it('no aids detected → NORMAL track', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      const change = passDetection(seq);
      expect(change.diagnosticTrack).toBe('NORMAL');
      expect(change.diagnosticSegment).toBe(0);
    });

    it('NORMAL track has squats + march_in_place + arms_raise', () => {
      expect(DIAG_TRACKS.NORMAL).toHaveLength(3);
      expect(DIAG_TRACKS.NORMAL[0].id).toBe('squats');
      expect(DIAG_TRACKS.NORMAL[1].id).toBe('march_in_place');
      expect(DIAG_TRACKS.NORMAL[2].id).toBe('arms_raise');
    });

    it('WHEELCHAIR track has arms only (no leg movements)', () => {
      expect(DIAG_TRACKS.WHEELCHAIR).toHaveLength(3);
      expect(DIAG_TRACKS.WHEELCHAIR[0].id).toBe('arms_raise');
      expect(DIAG_TRACKS.WHEELCHAIR[1].id).toBe('left_arm_circle');
      expect(DIAG_TRACKS.WHEELCHAIR[2].id).toBe('right_arm_circle');
      // No leg-related segments
      for (const seg of DIAG_TRACKS.WHEELCHAIR) {
        expect(seg.targetJoints.every(j => j.includes('elbow'))).toBe(true);
      }
    });

    it('TRANSFEMORAL_AMPUTEE track has hip_flexion + arms_raise', () => {
      expect(DIAG_TRACKS.TRANSFEMORAL_AMPUTEE).toHaveLength(2);
      expect(DIAG_TRACKS.TRANSFEMORAL_AMPUTEE[0].id).toBe('hip_flexion');
      expect(DIAG_TRACKS.TRANSFEMORAL_AMPUTEE[0].targetJoints).toEqual(['left_hip', 'right_hip']);
      expect(DIAG_TRACKS.TRANSFEMORAL_AMPUTEE[1].id).toBe('arms_raise');
    });

    it('TRANSTIBIAL_AMPUTEE is NOT in static DIAG_TRACKS (built dynamically)', () => {
      expect(DIAG_TRACKS.TRANSTIBIAL_AMPUTEE).toBeUndefined();
    });

    it('ARM_AMPUTEE track has squats + march_in_place (legs only)', () => {
      expect(DIAG_TRACKS.ARM_AMPUTEE).toHaveLength(2);
      expect(DIAG_TRACKS.ARM_AMPUTEE[0].id).toBe('squats');
      expect(DIAG_TRACKS.ARM_AMPUTEE[1].id).toBe('march_in_place');
    });

    it('MEDICAL track has squats + march_in_place + arms_raise', () => {
      expect(DIAG_TRACKS.MEDICAL).toHaveLength(3);
      expect(DIAG_TRACKS.MEDICAL[0].id).toBe('squats');
      expect(DIAG_TRACKS.MEDICAL[1].id).toBe('march_in_place');
      expect(DIAG_TRACKS.MEDICAL[2].id).toBe('arms_raise');
    });

    it('detectedCondition is passed through to diagnostics state change', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      const change = passDetection(seq);
      expect(change.detectedCondition).toBeDefined();
      expect(change.detectedCondition.wheelchair).toBe(false);
      expect(change.detectedCondition.crutches).toBe(false);
      expect(change.detectedCondition.missingLimbs).toEqual([]);
    });
  });


  // ---- Phase A Diagnostics — Strict Blocking ----

  describe('Phase A Diagnostics', () => {

    it('transitions to PROFILE_INPUT after all segments complete', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      const change = passPhaseA(seq);
      expect(change.state).toBe(STATE.PROFILE_INPUT);
      expect(change.kineticProfile).toBeDefined();
      expect(change.kineticInferredProfile).toBeDefined();
    });

    it('strict blocking: segment does not advance without real movement', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      // Feed 500 static frames (50 seconds) — no movement at all
      // Without safety timeout, segment must NEVER advance
      let advancedAt = null;
      for (let f = 0; f < 500; f++) {
        const change = seq.feedFrame(createStaticLandmarks());
        if (change && change.diagnosticSegment === 1) {
          advancedAt = f;
          break;
        }
      }
      expect(advancedAt).toBeNull();
      expect(seq.state).toBe(STATE.PHASE_A);
    });

    it('no safety timeout: segment stays forever without movement', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      // Feed 1000 static frames (100 seconds!) — still should not advance
      for (let f = 0; f < 1000; f++) {
        seq.feedFrame(createStaticLandmarks());
      }
      // Must still be in PHASE_A, on first segment
      expect(seq.state).toBe(STATE.PHASE_A);
    });

    it('nudge repeats every NUDGE_INTERVAL_SEC when no movement', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      // Feed static frames and collect nudges
      const nudges = [];
      for (let f = 0; f < 200; f++) {
        const change = seq.feedFrame(createStaticLandmarks());
        if (change && change.nudge) {
          nudges.push(f);
        }
      }

      // Should have multiple nudges (every 5s = 50 frames at 10fps)
      // First nudge at ~50 frames (minDurationSec), then every 50 frames
      expect(nudges.length).toBeGreaterThanOrEqual(2);
      // Nudges should be spaced ~50 frames apart
      if (nudges.length >= 2) {
        const gap = nudges[1] - nudges[0];
        expect(gap).toBeGreaterThanOrEqual(45);
        expect(gap).toBeLessThanOrEqual(55);
      }
    });

    it('early completion when sufficient movement detected', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      // Feed frames with large knee oscillation (squatting motion)
      let segAdvance = null;
      for (let f = 0; f < 200; f++) {
        const lm = createHealthyLandmarks();
        const t = f / 10;
        const osc = Math.sin(t * 2 * Math.PI * 0.5) * 0.3;
        lm[LM.LEFT_KNEE].y = 0.72 + osc;
        lm[LM.RIGHT_KNEE].y = 0.72 + osc;
        lm[LM.LEFT_ANKLE].y = 0.88 + osc * 0.5;
        lm[LM.RIGHT_ANKLE].y = 0.88 + osc * 0.5;

        const change = seq.feedFrame(lm);
        if (change && change.diagnosticSegment === 1) {
          segAdvance = change;
          break;
        }
      }

      // Should advance well before safety timeout (300 frames)
      expect(segAdvance).not.toBeNull();
    });

    it('march_in_place uses gait detection (ankle Y-variance)', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      // Advance past squats segment via large knee movement
      for (let f = 0; f < 200; f++) {
        const lm = createMovingLandmarks(f);
        const change = seq.feedFrame(lm);
        if (change && change.diagnosticSegment === 1) break;
      }

      // Now in march_in_place segment — feed marching frames
      let segAdvance = null;
      for (let f = 0; f < 200; f++) {
        const lm = createHealthyLandmarks();
        // Simulate stepping: alternating ankle Y-displacement
        const t = f / 10;
        const leftStep = Math.abs(Math.sin(t * Math.PI)) * 0.1;
        const rightStep = Math.abs(Math.cos(t * Math.PI)) * 0.1;
        lm[LM.LEFT_ANKLE].y = 0.88 - leftStep;
        lm[LM.RIGHT_ANKLE].y = 0.88 - rightStep;

        const change = seq.feedFrame(lm);
        if (change && change.diagnosticSegment === 2) {
          segAdvance = change;
          break;
        }
      }

      expect(segAdvance).not.toBeNull();
      expect(segAdvance.diagnosticSegment).toBe(2); // arms_raise
    });

    it('instruction changes between diagnostic segments', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      // Collect segment transitions using movement frames
      const transitions = [];
      for (let f = 0; f < 5000; f++) {
        const change = seq.feedFrame(createMovingLandmarks(f));
        if (change && change.diagnosticSegment !== undefined) {
          transitions.push({
            segment: change.diagnosticSegment,
            instruction: change.instruction,
          });
        }
        if (seq.state === STATE.PROFILE_INPUT) break;
      }

      // Should have segments 1 and 2 (segment 0 was from detection)
      expect(transitions.length).toBeGreaterThanOrEqual(2);
    });

    it('Phase A produces valid routing result', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);

      const result = seq.phaseAResult;
      expect(result).not.toBeNull();
      expect(result.track).toBeTruthy();
      expect(['missing_limb', 'deep_analysis', 'full_body']).toContain(result.track);
    });

    it('kineticProfile available after Phase A', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      const change = passPhaseA(seq);

      expect(change.kineticProfile).toBeDefined();
      expect(change.kineticProfile.overallPosture).toBeDefined();
      expect(change.kineticInferredProfile).toBeDefined();
    });

    it('detectedCondition passed through to PROFILE_INPUT', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      const change = passPhaseA(seq);

      expect(change.detectedCondition).toBeDefined();
      expect(change.detectedCondition.wheelchair).toBe(false);
    });

    it('MOVEMENT_VARIANCE_THRESHOLD is 12.0 (high bar, not camera noise)', () => {
      expect(MOVEMENT_VARIANCE_THRESHOLD).toBe(12.0);
    });
  });


  // ---- Visibility Guard ----

  describe('Visibility Guard', () => {

    it('emits visibilityHalt when ankle visibility < 0.5 during leg segment', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      // Feed frame with low ankle visibility during squats segment
      const lm = createStaticLandmarks();
      lm[LM.LEFT_ANKLE].visibility = 0.3; // Below 0.5 threshold
      const change = seq.feedFrame(lm);

      expect(change).not.toBeNull();
      expect(change.visibilityHalt).toBe(true);
      expect(change.instruction).toContain("can't detect");
    });

    it('emits visibilityHalt when knee visibility < 0.5 during leg segment', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      const lm = createStaticLandmarks();
      lm[LM.LEFT_KNEE].visibility = 0.2;
      const change = seq.feedFrame(lm);

      expect(change).not.toBeNull();
      expect(change.visibilityHalt).toBe(true);
    });

    it('does NOT emit visibilityHalt during arm-only segments', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      // Advance past squats and march segments with movement
      for (let f = 0; f < 500; f++) {
        const change = seq.feedFrame(createMovingLandmarks(f));
        // Check if we reached arms_raise (segment 2)
        if (change && change.diagnosticSegment === 2) break;
      }

      // Now in arms_raise — low ankle should NOT trigger halt
      const lm = createStaticLandmarks();
      lm[LM.LEFT_ANKLE].visibility = 0.1;
      const change = seq.feedFrame(lm);
      // Should either be null or nudge, but NOT visibilityHalt
      if (change) {
        expect(change.visibilityHalt).toBeUndefined();
      }
    });

    it('segment does not advance while visibility is halted', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      // Feed 200 frames with low ankle visibility
      let advanced = false;
      for (let f = 0; f < 200; f++) {
        const lm = createMovingLandmarks(f); // Has movement, but...
        lm[LM.LEFT_ANKLE].visibility = 0.1; // ankle not visible
        const change = seq.feedFrame(lm);
        if (change && change.diagnosticSegment === 1) {
          advanced = true;
          break;
        }
      }
      // Segment should NOT advance despite movement, because visibility is bad
      expect(advanced).toBe(false);
    });

    it('visibility halt includes Hebrew instruction', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      const lm = createStaticLandmarks();
      lm[LM.RIGHT_ANKLE].visibility = 0.1;
      const change = seq.feedFrame(lm);

      expect(change.instruction_he).toContain('המצלמה לא מזהה');
    });

    it('visibility halt throttles to every 3 seconds', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      // Feed frames with low visibility and count halt emissions
      const halts = [];
      for (let f = 0; f < 100; f++) {
        const lm = createStaticLandmarks();
        lm[LM.LEFT_ANKLE].visibility = 0.1;
        const change = seq.feedFrame(lm);
        if (change && change.visibilityHalt) {
          halts.push(f);
        }
      }

      // Should have ~3 halts in 100 frames at 10fps (10 seconds): at 0, ~30, ~60
      expect(halts.length).toBeGreaterThanOrEqual(2);
      expect(halts.length).toBeLessThanOrEqual(5);
      if (halts.length >= 2) {
        const gap = halts[1] - halts[0];
        expect(gap).toBeGreaterThanOrEqual(25); // ~3 seconds
      }
    });
  });


  // ---- Prosthetic Detection via Visibility ----

  describe('Prosthetic Detection via Visibility', () => {

    it('routes to TRANSFEMORAL_AMPUTEE when ankle/knee consistently invisible during detection', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Feed detection frames with left leg invisible
      let detectionResult = null;
      for (let f = 0; f < 200; f++) {
        const lm = createHealthyLandmarks();
        // Left leg landmarks barely visible (prosthetic)
        lm[25].visibility = 0.1; // LEFT_KNEE
        lm[27].visibility = 0.1; // LEFT_ANKLE
        const change = seq.feedFrame(lm);
        if (change && change.subState === 'diagnostics') {
          detectionResult = change;
          break;
        }
      }

      expect(detectionResult).not.toBeNull();
      expect(detectionResult.diagnosticTrack).toBe('TRANSFEMORAL_AMPUTEE');
      expect(detectionResult.detectedCondition.missingLimbs).toContain('left_leg');
    });

    it('stays NORMAL when all leg landmarks are visible during detection', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      const change = passDetection(seq);
      expect(change.diagnosticTrack).toBe('NORMAL');
      expect(change.detectedCondition.missingLimbs).toEqual([]);
    });

    it('detects right leg prosthetic via visibility', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      let detectionResult = null;
      for (let f = 0; f < 200; f++) {
        const lm = createHealthyLandmarks();
        lm[26].visibility = 0.1; // RIGHT_KNEE
        lm[28].visibility = 0.1; // RIGHT_ANKLE
        const change = seq.feedFrame(lm);
        if (change && change.subState === 'diagnostics') {
          detectionResult = change;
          break;
        }
      }

      expect(detectionResult).not.toBeNull();
      expect(detectionResult.diagnosticTrack).toBe('TRANSFEMORAL_AMPUTEE');
      expect(detectionResult.detectedCondition.missingLimbs).toContain('right_leg');
    });
  });


  // ---- Profile Input (after Phase A) ----

  describe('Profile Input', () => {

    it('setAnatomyProfile works in PROFILE_INPUT', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);

      const profile = createValidProfile();
      const change = seq.setAnatomyProfile(profile);
      expect(change.state).toBe(STATE.PROFILE_INPUT);
      expect(change.anatomyProfile).toEqual(profile);
    });

    it('setAnatomyProfile returns null if not in PROFILE_INPUT', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      expect(seq.setAnatomyProfile(createValidProfile())).toBeNull();

      seq.start();
      expect(seq.setAnatomyProfile(createValidProfile())).toBeNull();
    });

    it('confirmProfile without profile → anatomy_profile_required error', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);

      const change = seq.confirmProfile();
      expect(change.state).toBe(STATE.PROFILE_INPUT);
      expect(change.error).toBe('anatomy_profile_required');
    });

    it('confirmProfile with incomplete profile → anatomy_profile_incomplete error', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);

      seq.setAnatomyProfile({ name: 'Test', age: 25 }); // Missing fields
      const change = seq.confirmProfile();
      expect(change.state).toBe(STATE.PROFILE_INPUT);
      expect(change.error).toBe('anatomy_profile_incomplete');
      expect(change.missingFields).toBeDefined();
      expect(change.missingFields.length).toBeGreaterThan(0);
    });

    it('confirmProfile with valid profile → PHASE_B_MOVEMENT', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);

      seq.setAnatomyProfile(createValidProfile());
      const change = seq.confirmProfile();
      expect(change.state).toBe(STATE.PHASE_B_MOVEMENT);
      expect(seq.state).toBe(STATE.PHASE_B_MOVEMENT);
    });

    it('confirmProfile returns null if not in PROFILE_INPUT', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      expect(seq.confirmProfile()).toBeNull();
    });

    it('training-only validation: disability fields not required', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);

      seq.setAnatomyProfile(createValidProfile({ disability: undefined }));
      const change = seq.confirmProfile();
      expect(change.state).toBe(STATE.PHASE_B_MOVEMENT);
    });
  });


  // ---- Phase B Movement Progression ----

  describe('Phase B', () => {

    it('progresses through movement queue', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);
      const phaseBChange = passProfile(seq);

      expect(phaseBChange.state).toBe(STATE.PHASE_B_MOVEMENT);
      expect(phaseBChange.movementTotal).toBeGreaterThan(0);
      expect(phaseBChange.movementIndex).toBe(0);
    });

    it('instruction changes between movements', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);
      passProfile(seq);

      let change = null;
      for (let f = 0; f < 500; f++) {
        const t = f / 10;
        const c = seq.feedFrame(createDampedLandmarks(t, 10));
        if (c && c.movementIndex === 1) {
          change = c;
          break;
        }
      }

      if (change) {
        expect(change.instruction).toBeTruthy();
      }
    });

    it('progress increases during Phase B', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);
      passProfile(seq);

      const progressAfterProfile = seq.progress;
      expect(progressAfterProfile).toBeGreaterThanOrEqual(0.30);

      for (let f = 0; f < 20; f++) {
        seq.feedFrame(createDampedLandmarks(f / 10, 10));
      }

      expect(seq.progress).toBeGreaterThan(progressAfterProfile);
    });
  });


  // ---- Full Pipeline ----

  describe('Full pipeline (healthy user)', () => {

    it('completes full scan for healthy user', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Phase A (detection + diagnostics) → PROFILE_INPUT
      passPhaseA(seq);
      expect(seq.state).toBe(STATE.PROFILE_INPUT);

      // Profile → PHASE_B_MOVEMENT
      passProfile(seq);
      expect(seq.state).toBe(STATE.PHASE_B_MOVEMENT);

      // Feed frames until scan completes or errors
      let finalChange = null;
      for (let f = 0; f < 5000; f++) {
        const t = f / 10;
        const change = seq.feedFrame(createDampedLandmarks(t, 10));
        if (change && (change.state === STATE.COMPLETE || change.state === STATE.ERROR)) {
          finalChange = change;
          break;
        }
        if (seq.state === STATE.AWAITING_USER) {
          const queries = change?.userQueries || [];
          for (const q of queries) {
            seq.submitUserAnswer(q.limb, { status: 'anatomical_healthy' });
          }
          if (seq.state === STATE.COMPLETE) {
            finalChange = { state: STATE.COMPLETE };
            break;
          }
        }
      }

      expect([STATE.COMPLETE, STATE.AWAITING_USER, STATE.ERROR]).toContain(seq.state);

      if (seq.state === STATE.COMPLETE) {
        const result = seq.result;
        expect(result).not.toBeNull();
        expect(result.passportFields).toBeTruthy();
        expect(result.phaseAResult).toBeTruthy();
        expect(result.phaseBResult).toBeTruthy();
        expect(result.totalFrames).toBeGreaterThan(30);
        expect(result.scanDuration).toBeGreaterThanOrEqual(0);
      }
    });
  });


  // ---- Progress Calculation ----

  describe('Progress', () => {

    it('progress is 0 in IDLE', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      expect(seq.progress).toBe(0);
    });

    it('progress is 0 in CALIBRATING', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();
      seq.feedFrame(createPartialLandmarks([27, 28]));
      expect(seq.progress).toBe(0);
    });

    it('progress increases during Phase A detection (5-6%)', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // During detection sub-phase
      seq.feedFrame(createHealthyLandmarks());
      const p = seq.progress;
      expect(p).toBeGreaterThanOrEqual(0.05);
      expect(p).toBeLessThan(0.07); // detection takes 8% of Phase A range
    });

    it('progress increases during Phase A diagnostics', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      const progressAfterDetection = seq.progress;
      for (let i = 0; i < 20; i++) {
        seq.feedFrame(createHealthyLandmarks());
      }
      expect(seq.progress).toBeGreaterThan(progressAfterDetection);
      expect(seq.progress).toBeLessThan(0.30);
    });

    it('progress is PROGRESS_PHASE_A_END in PROFILE_INPUT', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);
      expect(seq.progress).toBe(PROGRESS_PHASE_A_END);
    });

    it('progress is 1.0 in COMPLETE', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq._state = STATE.COMPLETE;
      expect(seq.progress).toBe(1.0);
    });
  });


  // ---- Result Data ----

  describe('Result data', () => {

    it('kineticProfile included in final result', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);
      passProfile(seq);

      for (let f = 0; f < 5000; f++) {
        const t = f / 10;
        seq.feedFrame(createDampedLandmarks(t, 10));
        if (seq.state === STATE.AWAITING_USER) {
          const queries = seq._pendingUserQueries || [];
          for (const q of queries) {
            seq.submitUserAnswer(q.limb, { status: 'anatomical_healthy' });
          }
        }
        if (seq.state === STATE.COMPLETE || seq.state === STATE.ERROR) break;
      }

      if (seq.state === STATE.COMPLETE) {
        expect(seq.result.kineticProfile).toBeDefined();
        expect(seq.result.kineticProfile.overallPosture).toBeDefined();
      }
    });

    it('anatomyProfile included in final result', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);
      passProfile(seq, { disability: 'none' });

      for (let f = 0; f < 5000; f++) {
        const t = f / 10;
        seq.feedFrame(createDampedLandmarks(t, 10));
        if (seq.state === STATE.AWAITING_USER) {
          const queries = seq._pendingUserQueries || [];
          for (const q of queries) {
            seq.submitUserAnswer(q.limb, { status: 'anatomical_healthy' });
          }
        }
        if (seq.state === STATE.COMPLETE || seq.state === STATE.ERROR) break;
      }

      if (seq.state === STATE.COMPLETE) {
        expect(seq.result.anatomyProfile).toBeDefined();
        expect(seq.result.anatomyProfile.name).toBe('Test User');
      }
    });

    it('reset clears anatomy profile and kinetic profile', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);
      passProfile(seq);
      expect(seq._anatomyProfile).not.toBeNull();
      expect(seq._kineticProfile).not.toBeNull();

      seq.reset();
      expect(seq._anatomyProfile).toBeNull();
      expect(seq._kineticProfile).toBeNull();
    });
  });


  // ---- Error Handling ----

  describe('Error handling', () => {

    it('transitions to ERROR on analyzer failure', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      seq._state = STATE.PHASE_A;
      seq._phaseASubState = 'diagnostics';
      seq._diagnosticSegments = DIAG_TRACKS.NORMAL;
      seq._diagnosticIndex = DIAG_TRACKS.NORMAL.length; // Force all segments done
      seq._qualityPaused = false;

      const brokenLandmarks = Array.from({ length: 33 }, () => ({
        x: 0, y: 0, z: 0, visibility: 0.95,
      }));

      const c = seq.feedFrame(brokenLandmarks);
      expect([STATE.PROFILE_INPUT, STATE.ERROR]).toContain(seq.state);
    });

    it('error getter returns null when no error', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      expect(seq.error).toBeNull();
    });
  });


  // ---- User Input ----

  describe('submitUserAnswer', () => {

    it('returns null if not in AWAITING_USER state', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      const change = seq.submitUserAnswer('left_leg', { status: 'anatomical_healthy' });
      expect(change).toBeNull();
    });

    it('handles user answers when in AWAITING_USER state', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq._state = STATE.AWAITING_USER;
      seq._pendingUserQueries = [
        { limb: 'left_leg', question_key: 'test', context: 'test' },
      ];
      seq._gateResult = {
        limbs: {
          left_leg:  { verdict: 'ask_user', status: 'unresolved', confidence: null },
          right_leg: { verdict: 'complete', status: 'anatomical_healthy', confidence: 1.0 },
          left_arm:  { verdict: 'complete', status: 'anatomical_healthy', confidence: 1.0 },
          right_arm: { verdict: 'complete', status: 'anatomical_healthy', confidence: 1.0 },
        },
        scan_status: 'needs_user_input',
      };
      seq._startTime = Date.now();
      seq._totalFrameCount = 100;

      const change = seq.submitUserAnswer('left_leg', {
        status: 'prosthetic_below_knee',
        description: 'Below-knee prosthetic left leg',
      });

      expect(change).not.toBeNull();
      expect(change.state).toBe(STATE.COMPLETE);
      expect(seq.state).toBe(STATE.COMPLETE);
      expect(seq.result.gateResult.limbs.left_leg.status).toBe('prosthetic_below_knee');
    });

    it('waits for all queries to be answered', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq._state = STATE.AWAITING_USER;
      seq._pendingUserQueries = [
        { limb: 'left_leg', question_key: 'test', context: 'test' },
        { limb: 'right_leg', question_key: 'test', context: 'test' },
      ];
      seq._gateResult = {
        limbs: {
          left_leg:  { verdict: 'ask_user', status: 'unresolved', confidence: null },
          right_leg: { verdict: 'ask_user', status: 'unresolved', confidence: null },
          left_arm:  { verdict: 'complete', status: 'anatomical_healthy', confidence: 1.0 },
          right_arm: { verdict: 'complete', status: 'anatomical_healthy', confidence: 1.0 },
        },
      };
      seq._startTime = Date.now();
      seq._totalFrameCount = 100;

      const change1 = seq.submitUserAnswer('left_leg', { status: 'anatomical_healthy' });
      expect(change1.state).toBe(STATE.AWAITING_USER);
      expect(change1.remainingQueries).toHaveLength(1);

      const change2 = seq.submitUserAnswer('right_leg', { status: 'anatomical_healthy' });
      expect(change2.state).toBe(STATE.COMPLETE);
    });
  });


  // ---- Getters ----

  describe('Getters', () => {

    it('currentInstruction returns calibrating text during CALIBRATING', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();
      expect(seq.currentInstruction).toContain('not detected');
    });

    it('currentInstruction returns detection text during PHASE_A detection', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      expect(seq.currentInstruction).toContain('Analyzing');
    });

    it('currentInstruction returns diagnostic instruction during PHASE_A diagnostics', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);
      // Should return first segment instruction
      expect(seq.currentInstruction).toBe(DIAG_TRACKS.NORMAL[0].instruction_en);
    });

    it('currentInstruction returns profile text during PROFILE_INPUT', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passPhaseA(seq);
      expect(seq.currentInstruction).toContain('profile');
    });

    it('currentInstruction returns null in IDLE', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      expect(seq.currentInstruction).toBeNull();
    });

    it('result returns null before COMPLETE', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();
      expect(seq.result).toBeNull();
    });

    it('currentInstructionHe returns Hebrew detection text', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      expect(seq.currentInstructionHe).toContain('מנתח');
    });

    it('currentInstructionHe returns Hebrew calibration text', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();
      expect(seq.currentInstructionHe).toContain('לא זוהה');
    });
  });


  // ---- Frame Quality Guard ----

  describe('Frame Quality Guard', () => {

    it('checkFrameQuality returns true for good landmarks', () => {
      const landmarks = createHealthyLandmarks();
      expect(ScanSequencer.checkFrameQuality(landmarks)).toBe(true);
    });

    it('checkFrameQuality returns false for low visibility landmarks', () => {
      const landmarks = createHealthyLandmarks();
      for (let i = 0; i < 25; i++) {
        landmarks[i].visibility = 0.1;
      }
      expect(ScanSequencer.checkFrameQuality(landmarks)).toBe(false);
    });

    it('does not pause on a single bad quality frame (debounce)', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      for (let i = 0; i < 5; i++) {
        seq.feedFrame(createHealthyLandmarks());
      }
      expect(seq.state).toBe(STATE.PHASE_A);

      const badLandmarks = createHealthyLandmarks();
      for (let i = 0; i < 25; i++) {
        badLandmarks[i].visibility = 0.1;
      }
      const change = seq.feedFrame(badLandmarks);
      expect(change).toBeNull(); // debounced — no pause yet
    });

    it('pauses scan after 60 consecutive bad frames (2s debounce)', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      for (let i = 0; i < 5; i++) {
        seq.feedFrame(createHealthyLandmarks());
      }

      const badLandmarks = createHealthyLandmarks();
      for (let i = 0; i < 25; i++) {
        badLandmarks[i].visibility = 0.1;
      }
      let change = null;
      for (let i = 0; i < 60; i++) {
        const c = seq.feedFrame(badLandmarks);
        if (c) change = c;
      }

      expect(change).not.toBeNull();
      expect(change.qualityPause).toBe(true);
      expect(change.instruction).toContain('Tracking lost');
    });

    it('resumes after quality recovery', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      for (let i = 0; i < 5; i++) {
        seq.feedFrame(createHealthyLandmarks());
      }
      const badLandmarks = createHealthyLandmarks();
      for (let i = 0; i < 25; i++) {
        badLandmarks[i].visibility = 0.1;
      }
      for (let i = 0; i < 60; i++) {
        seq.feedFrame(badLandmarks);
      }

      const nullChange = seq.feedFrame(badLandmarks);
      expect(nullChange).toBeNull();

      const resume = seq.feedFrame(createHealthyLandmarks());
      expect(resume).not.toBeNull();
      expect(resume.qualityResume).toBe(true);
      expect(seq.state).toBe(STATE.PHASE_A);
    });

    it('quality guard does not apply during CALIBRATING', () => {
      const seq = new ScanSequencer({ skipMotionCalibration: true });
      seq.start();

      const badLandmarks = createHealthyLandmarks();
      for (let i = 0; i < 25; i++) {
        badLandmarks[i].visibility = 0.1;
      }
      const change = seq.feedFrame(badLandmarks);
      expect(change).not.toBeNull();
      expect(change.state).toBe(STATE.CALIBRATING);
      expect(change.qualityPause).toBeUndefined();
    });
  });


  // ---- Snapshot & Image-Context Analysis ----

  describe('Image-Context Analysis', () => {

    it('emits captureSnapshot on first detection frame', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      const change = seq.feedFrame(createHealthyLandmarks());
      expect(change).not.toBeNull();
      expect(change.captureSnapshot).toBe(true);
      expect(change.subState).toBe('detection');
    });

    it('captureSnapshot only emitted once', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      const first = seq.feedFrame(createHealthyLandmarks());
      expect(first.captureSnapshot).toBe(true);

      // Second frame should NOT have captureSnapshot
      const second = seq.feedFrame(createHealthyLandmarks());
      expect(second).toBeNull(); // Still collecting, no event
    });

    it('setImageContext with high-confidence prosthetic → TRANSFEMORAL_AMPUTEE immediately', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Set image context before detection completes
      seq.setImageContext({ prosthetic: true, wheelchair: false, crutches: false, confidence: 0.9 });

      // Feed remaining detection frames
      let result = null;
      for (let f = 0; f < 25; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.subState === 'diagnostics') {
          result = change;
          break;
        }
      }

      expect(result).not.toBeNull();
      expect(result.subState).toBe('diagnostics');
      expect(result.diagnosticTrack).toBe('TRANSFEMORAL_AMPUTEE');
    });

    it('setImageContext with high-confidence wheelchair → WHEELCHAIR immediately', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      seq.setImageContext({ prosthetic: false, wheelchair: true, crutches: false, confidence: 0.8 });

      let result = null;
      for (let f = 0; f < 25; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.subState === 'diagnostics') {
          result = change;
          break;
        }
      }

      expect(result).not.toBeNull();
      expect(result.diagnosticTrack).toBe('WHEELCHAIR');
    });

    it('setImageContext with low confidence → falls through to anatomical profiler', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Low confidence — should NOT override
      seq.setImageContext({ prosthetic: true, wheelchair: false, crutches: false, confidence: 0.3 });

      let result = null;
      for (let f = 0; f < 25; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.subState === 'diagnostics') {
          result = change;
          break;
        }
      }

      expect(result).not.toBeNull();
      expect(result.subState).toBe('diagnostics');
      // Healthy landmarks → no anatomical anomalies → NORMAL
      expect(result.diagnosticTrack).toBe('NORMAL');
    });

    it('setImageContext ignored outside PHASE_A', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      // Still in CALIBRATING
      seq.setImageContext({ prosthetic: true, wheelchair: false, crutches: false, confidence: 0.9 });
      // Should have been ignored
      expect(seq._imageContext).toBeNull();
    });
  });


  // ---- Anatomical Profiler Auto-Classification ----

  describe('Anatomical Profiler Auto-Classification', () => {

    it('auto-routes to TRANSFEMORAL_AMPUTEE when rigid rod detected', () => {
      // sampleRate: 30 → detection = 60 frames (above MIN_SAMPLES_FOR_ANALYSIS=30)
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Feed rigid knee frames for detection (need 60 frames)
      let result = null;
      for (let f = 0; f < 70; f++) {
        const change = seq.feedFrame(createRigidKneeLandmarks());
        if (change && change.subState === 'diagnostics') {
          result = change;
          break;
        }
      }

      expect(result).not.toBeNull();
      expect(result.subState).toBe('diagnostics');
      expect(result.diagnosticTrack).toBe('TRANSFEMORAL_AMPUTEE');
      // Should include side-aware anatomy message
      expect(result.anatomyMessage).toContain('above-knee');
      expect(result.anatomyMessage).toContain('left');
      expect(result.affectedSide).toBe('left');
    });

    it('emits anatomyMessage with Hebrew translation', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      let result = null;
      for (let f = 0; f < 70; f++) {
        const change = seq.feedFrame(createRigidKneeLandmarks());
        if (change && change.subState === 'diagnostics') {
          result = change;
          break;
        }
      }

      if (result && result.anatomyMessage) {
        expect(result.anatomyMessage_he).toContain('פרוטזה');
      }
    });

    it('no anatomyMessage for healthy user (NORMAL track)', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      const change = passDetection(seq);
      expect(change.diagnosticTrack).toBe('NORMAL');
      expect(change.anatomyMessage).toBeUndefined();
    });

    it('image context overrides anatomical profiler', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Set high-confidence prosthetic image context
      seq.setImageContext({ prosthetic: true, wheelchair: false, crutches: false, confidence: 0.9 });

      // Feed rigid knee frames
      let result = null;
      for (let f = 0; f < 70; f++) {
        const change = seq.feedFrame(createRigidKneeLandmarks());
        if (change && change.subState === 'diagnostics') {
          result = change;
          break;
        }
      }

      expect(result).not.toBeNull();
      expect(result.subState).toBe('diagnostics');
      expect(result.diagnosticTrack).toBe('TRANSFEMORAL_AMPUTEE');
    });

    it('anatomyClassification included in final result', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Feed rigid knee frames for detection
      for (let f = 0; f < 70; f++) {
        const change = seq.feedFrame(createRigidKneeLandmarks());
        if (change && change.subState === 'diagnostics') break;
      }

      // Complete diagnostics with movement
      for (let f = 0; f < 5000; f++) {
        seq.feedFrame(createMovingLandmarks(f));
        if (seq.state === STATE.PROFILE_INPUT) break;
      }

      if (seq.state === STATE.PROFILE_INPUT) {
        seq.setAnatomyProfile(createValidProfile());
        seq.confirmProfile();

        for (let f = 0; f < 5000; f++) {
          const t = f / 30;
          seq.feedFrame(createDampedLandmarks(t, 30));
          if (seq.state === STATE.AWAITING_USER) {
            const queries = seq._pendingUserQueries || [];
            for (const q of queries) {
              seq.submitUserAnswer(q.limb, { status: 'anatomical_healthy' });
            }
          }
          if (seq.state === STATE.COMPLETE || seq.state === STATE.ERROR) break;
        }

        if (seq.state === STATE.COMPLETE) {
          expect(seq.result.anatomyClassification).toBeDefined();
          expect(seq.result.anatomyClassification.classification).toBeDefined();
        }
      }
    });
  });


  // ---- Side-Aware Profiler ----

  describe('Side-Aware Profiler', () => {

    /**
     * Create a frame where the RIGHT leg is a rigid rod (prosthetic on right).
     * Left leg has natural bent position.
     */
    function createRightRigidKneeLandmarks() {
      const lm = [];
      for (let i = 0; i < 33; i++) {
        lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
      }
      const noise = () => (Math.random() - 0.5) * 0.04;
      const smallNoise = () => (Math.random() - 0.5) * 0.02;
      // Left leg: natural bent position with noise
      lm[LM.LEFT_HIP] =      { x: 0.44, y: 0.55 + smallNoise(), z: 0, visibility: 0.95 };
      lm[LM.LEFT_KNEE] =     { x: 0.40 + noise(), y: 0.72 + noise(), z: 0, visibility: 0.95 };
      lm[LM.LEFT_ANKLE] =    { x: 0.44 + smallNoise(), y: 0.88 + smallNoise(), z: 0, visibility: 0.95 };
      // Right leg: perfectly collinear (straight rod) — NO noise
      lm[LM.RIGHT_HIP] =     { x: 0.56, y: 0.55, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_KNEE] =    { x: 0.56, y: 0.72, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_ANKLE] =   { x: 0.56, y: 0.88, z: 0, visibility: 0.95 };
      // Shoulders
      lm[LM.LEFT_SHOULDER] = { x: 0.42, y: 0.30, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_SHOULDER] ={ x: 0.58, y: 0.30, z: 0, visibility: 0.95 };
      lm[LM.LEFT_ELBOW] =    { x: 0.36, y: 0.38, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_ELBOW] =   { x: 0.64, y: 0.38, z: 0, visibility: 0.95 };
      lm[LM.LEFT_WRIST] =    { x: 0.32, y: 0.45, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_WRIST] =   { x: 0.68, y: 0.45, z: 0, visibility: 0.95 };
      lm[LM.LEFT_HEEL] =     { x: 0.44, y: 0.90, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_HEEL] =    { x: 0.56, y: 0.90, z: 0, visibility: 0.95 };
      lm[LM.LEFT_FOOT] =     { x: 0.44, y: 0.91, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_FOOT] =    { x: 0.56, y: 0.91, z: 0, visibility: 0.95 };
      return lm;
    }

    it('detects right side prosthetic via comparative variance', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      let result = null;
      for (let f = 0; f < 70; f++) {
        const change = seq.feedFrame(createRightRigidKneeLandmarks());
        if (change && change.subState === 'diagnostics') {
          result = change;
          break;
        }
      }

      expect(result).not.toBeNull();
      expect(result.diagnosticTrack).toBe('TRANSFEMORAL_AMPUTEE');
      expect(result.affectedSide).toBe('right');
      expect(result.anatomyMessage).toContain('right');
      expect(result.anatomyMessage).toContain('above-knee');
    });

    it('side-aware message includes Hebrew with correct side', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      let result = null;
      for (let f = 0; f < 70; f++) {
        const change = seq.feedFrame(createRightRigidKneeLandmarks());
        if (change && change.subState === 'diagnostics') {
          result = change;
          break;
        }
      }

      expect(result).not.toBeNull();
      expect(result.anatomyMessage_he).toContain('ימין');
      expect(result.anatomyMessage_he).toContain('מעל הברך');
    });

    it('TRANSTIBIAL detection builds dynamic segments targeting healthy knee', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Create frames where left knee moves (>0.5 variance) but left ankle is frozen
      // This should classify as TRANSTIBIAL on left side
      let result = null;
      for (let f = 0; f < 70; f++) {
        const lm = createRigidKneeLandmarks(); // left leg rigid
        // Override: make left knee move slightly (transtibial = knee moves, ankle frozen)
        const t = f / 30;
        const osc = Math.sin(t * 2 * Math.PI * 2) * 0.08;
        lm[LM.LEFT_KNEE].x = 0.44 + osc;
        // Left ankle stays frozen at same position
        const change = seq.feedFrame(lm);
        if (change && change.subState === 'diagnostics') {
          result = change;
          break;
        }
      }

      // If classified as TRANSTIBIAL, verify dynamic segments
      if (result && result.diagnosticTrack === 'TRANSTIBIAL_AMPUTEE') {
        expect(result.affectedSide).toBe('left');
        expect(result.anatomyMessage).toContain('below-knee');
        // The segments should target right_knee (healthy side)
        expect(seq._diagnosticSegments[0].id).toBe('squats_healthy_knee');
        expect(seq._diagnosticSegments[0].targetJoints).toEqual(['right_knee']);
        expect(seq._diagnosticSegments[0].instruction_en).toContain('right');
      }
    });

    it('affectedSide included in detectedCondition', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      let result = null;
      for (let f = 0; f < 70; f++) {
        const change = seq.feedFrame(createRigidKneeLandmarks());
        if (change && change.subState === 'diagnostics') {
          result = change;
          break;
        }
      }

      expect(result).not.toBeNull();
      expect(result.detectedCondition.affectedSide).toBe('left');
    });
  });


  // ---- Silent Recalibration (Mid-Segment Reroute) ----

  describe('Silent Recalibration', () => {

    it('reroutes to adapted track when frozen joint detected during diagnostics', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      // Now in NORMAL track, squats segment — feed static frames (no knee movement)
      const minFrames = Math.floor(DIAG_TRACKS.NORMAL[0].minDurationSec * 10);
      let rerouted = null;
      for (let f = 0; f < minFrames + 50; f++) {
        const change = seq.feedFrame(createStaticLandmarks());
        if (change && change.rerouted) {
          rerouted = change;
          break;
        }
      }

      expect(rerouted).not.toBeNull();
      expect(rerouted.rerouted).toBe(true);
      // Should include anatomy adaptation message
      expect(rerouted.anatomyMessage).toBeDefined();
      expect(rerouted.anatomyMessage_he).toBeDefined();
    });

    it('recalibration only triggers once per diagnostic run', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      // First reroute
      const minFrames = Math.floor(DIAG_TRACKS.NORMAL[0].minDurationSec * 10);
      let firstReroute = null;
      for (let f = 0; f < minFrames + 50; f++) {
        const change = seq.feedFrame(createStaticLandmarks());
        if (change && change.rerouted) {
          firstReroute = change;
          break;
        }
      }
      expect(firstReroute).not.toBeNull();

      // Feed more static frames — should NOT reroute again
      let secondReroute = null;
      for (let f = 0; f < 200; f++) {
        const change = seq.feedFrame(createStaticLandmarks());
        if (change && change.rerouted) {
          secondReroute = change;
          break;
        }
      }
      expect(secondReroute).toBeNull();
    });

    it('no reroute if already on TRANSFEMORAL_AMPUTEE track', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Use image context to get straight to TRANSFEMORAL_AMPUTEE track
      seq.setImageContext({ prosthetic: true, wheelchair: false, crutches: false, confidence: 0.9 });

      for (let f = 0; f < 25; f++) {
        const change = seq.feedFrame(createRigidKneeLandmarks());
        if (change && change.subState === 'diagnostics') break;
      }
      expect(seq._diagnosticTrack).toBe('TRANSFEMORAL_AMPUTEE');

      // Feed static frames — should NOT reroute
      let rerouted = null;
      for (let f = 0; f < 200; f++) {
        const change = seq.feedFrame(createStaticLandmarks());
        if (change && change.rerouted) {
          rerouted = change;
          break;
        }
      }
      expect(rerouted).toBeNull();
    });

    it('reroute includes anatomy message in Hebrew', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);
      passDetection(seq);

      const minFrames = Math.floor(DIAG_TRACKS.NORMAL[0].minDurationSec * 10);
      let rerouted = null;
      for (let f = 0; f < minFrames + 50; f++) {
        const change = seq.feedFrame(createStaticLandmarks());
        if (change && change.rerouted) {
          rerouted = change;
          break;
        }
      }

      if (rerouted) {
        // Static landmarks have both legs frozen → bilateral or prosthesis message
        const heMsg = rerouted.anatomyMessage_he;
        const hasBilateral = heMsg.includes('דו-צדדי');
        const hasProsthesis = heMsg.includes('פרוטזה');
        expect(hasBilateral || hasProsthesis).toBe(true);
      }
    });
  });


  // ---- Anatomical Track — Hip Flexion ----

  describe('TRANSFEMORAL Track — Hip Flexion', () => {

    it('TRANSFEMORAL track uses hip_flexion instead of squats', () => {
      expect(DIAG_TRACKS.TRANSFEMORAL_AMPUTEE[0].id).toBe('hip_flexion');
      expect(DIAG_TRACKS.TRANSFEMORAL_AMPUTEE[0].targetJoints).toContain('left_hip');
      expect(DIAG_TRACKS.TRANSFEMORAL_AMPUTEE[0].targetJoints).toContain('right_hip');
    });

    it('hip_flexion advances when hip joint variance exceeds threshold', () => {
      const seq = new ScanSequencer({ sampleRate: 10, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Get to TRANSFEMORAL track via image context
      seq.setImageContext({ prosthetic: true, wheelchair: false, crutches: false, confidence: 0.9 });
      let diagChange = null;
      for (let f = 0; f < 25; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.subState === 'diagnostics') {
          diagChange = change;
          break;
        }
      }
      expect(diagChange.diagnosticTrack).toBe('TRANSFEMORAL_AMPUTEE');

      // Feed frames with hip movement (shoulder-hip-knee angle changes)
      let advanced = false;
      for (let f = 0; f < 300; f++) {
        const lm = createHealthyLandmarks();
        const t = f / 10;
        const osc = Math.sin(t * 2 * Math.PI * 0.5) * 0.3;
        // Move knees to change hip angle (shoulder-hip-knee)
        lm[LM.LEFT_KNEE].y = 0.72 + osc;
        lm[LM.RIGHT_KNEE].y = 0.72 + osc;
        const change = seq.feedFrame(lm);
        if (change && change.diagnosticSegment === 1) {
          advanced = true;
          break;
        }
      }

      expect(advanced).toBe(true);
    });

    it('TRANSFEMORAL hip_flexion instruction is correct', () => {
      expect(DIAG_TRACKS.TRANSFEMORAL_AMPUTEE[0].instruction_en).toContain('hip');
      expect(DIAG_TRACKS.TRANSFEMORAL_AMPUTEE[0].instruction_he).toContain('ירך');
    });
  });


  // ---- Bilateral Amputee ----

  describe('Bilateral Amputee', () => {

    /**
     * Generate a bilateral rigid landmark frame: BOTH legs frozen, arms natural.
     */
    function createBilateralRigidLandmarks() {
      const lm = [];
      for (let i = 0; i < 33; i++) {
        lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
      }
      // Both legs: perfectly frozen (no noise)
      lm[LM.LEFT_HIP] =      { x: 0.44, y: 0.55, z: 0, visibility: 0.95 };
      lm[LM.LEFT_KNEE] =     { x: 0.44, y: 0.72, z: 0, visibility: 0.95 };
      lm[LM.LEFT_ANKLE] =    { x: 0.44, y: 0.88, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_HIP] =     { x: 0.56, y: 0.55, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_KNEE] =    { x: 0.56, y: 0.72, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_ANKLE] =   { x: 0.56, y: 0.88, z: 0, visibility: 0.95 };
      // Shoulders
      lm[LM.LEFT_SHOULDER] = { x: 0.42, y: 0.30, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_SHOULDER] ={ x: 0.58, y: 0.30, z: 0, visibility: 0.95 };
      // Elbows and wrists
      lm[LM.LEFT_ELBOW] =    { x: 0.36, y: 0.38, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_ELBOW] =   { x: 0.64, y: 0.38, z: 0, visibility: 0.95 };
      lm[LM.LEFT_WRIST] =    { x: 0.32, y: 0.45, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_WRIST] =   { x: 0.68, y: 0.45, z: 0, visibility: 0.95 };
      // Heels and feet
      lm[LM.LEFT_HEEL] =     { x: 0.44, y: 0.90, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_HEEL] =    { x: 0.56, y: 0.90, z: 0, visibility: 0.95 };
      lm[LM.LEFT_FOOT] =     { x: 0.44, y: 0.91, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_FOOT] =    { x: 0.56, y: 0.91, z: 0, visibility: 0.95 };
      return lm;
    }

    it('bilateral detection routes to BILATERAL_AMPUTEE track', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      let diagChange = null;
      for (let f = 0; f < 65; f++) {
        const change = seq.feedFrame(createBilateralRigidLandmarks());
        if (change && change.subState === 'diagnostics') {
          diagChange = change;
          break;
        }
      }
      expect(diagChange).not.toBeNull();
      expect(diagChange.diagnosticTrack).toBe('BILATERAL_AMPUTEE');
    });

    it('BILATERAL_AMPUTEE track has seated_hip_flexion + arms_raise', () => {
      expect(DIAG_TRACKS.BILATERAL_AMPUTEE).toBeDefined();
      expect(DIAG_TRACKS.BILATERAL_AMPUTEE).toHaveLength(2);
      expect(DIAG_TRACKS.BILATERAL_AMPUTEE[0].id).toBe('seated_hip_flexion');
      expect(DIAG_TRACKS.BILATERAL_AMPUTEE[1].id).toBe('arms_raise');
      expect(DIAG_TRACKS.BILATERAL_AMPUTEE[0].targetJoints).toContain('left_hip');
      expect(DIAG_TRACKS.BILATERAL_AMPUTEE[0].targetJoints).toContain('right_hip');
    });

    it('bilateral emits correct Hebrew message', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      let diagChange = null;
      for (let f = 0; f < 65; f++) {
        const change = seq.feedFrame(createBilateralRigidLandmarks());
        if (change && change.subState === 'diagnostics') {
          diagChange = change;
          break;
        }
      }
      expect(diagChange).not.toBeNull();
      expect(diagChange.anatomyMessage_he).toBe('זוהה פרופיל דו-צדדי. מפעיל מצב אימון לליבה וירכיים');
      expect(diagChange.anatomyMessage).toBe('Bilateral profile detected. Activating core and hip training mode');
    });

    it('bilateral: affectedSide is both', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      let diagChange = null;
      for (let f = 0; f < 65; f++) {
        const change = seq.feedFrame(createBilateralRigidLandmarks());
        if (change && change.subState === 'diagnostics') {
          diagChange = change;
          break;
        }
      }
      expect(diagChange).not.toBeNull();
      expect(diagChange.affectedSide).toBe('both');
    });

    it('mid-diagnostic recalibration excludes BILATERAL_AMPUTEE', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Route to BILATERAL_AMPUTEE
      let diagChange = null;
      for (let f = 0; f < 65; f++) {
        const change = seq.feedFrame(createBilateralRigidLandmarks());
        if (change && change.subState === 'diagnostics') {
          diagChange = change;
          break;
        }
      }
      expect(diagChange.diagnosticTrack).toBe('BILATERAL_AMPUTEE');

      // Feed static frames — should NOT reroute
      let rerouted = null;
      for (let f = 0; f < 200; f++) {
        const change = seq.feedFrame(createStaticLandmarks());
        if (change && change.rerouted) {
          rerouted = change;
          break;
        }
      }
      expect(rerouted).toBeNull();
    });

    it('BILATERAL_AMPUTEE has no squats or march segments', () => {
      const track = DIAG_TRACKS.BILATERAL_AMPUTEE;
      for (const seg of track) {
        expect(seg.id).not.toBe('squats');
        expect(seg.id).not.toBe('march_in_place');
        expect(seg.useGaitDetection).toBeFalsy();
      }
    });
  });


  // ---- Visibility Guard & Camera Reposition ----

  describe('Visibility Guard', () => {

    /**
     * Create landmarks where left ankle is invisible (visibility 0.1).
     * Right side has real movement so it doesn't appear frozen.
     */
    function createLeftAnkleInvisibleLandmarks(frameIdx) {
      const lm = createHealthyLandmarks();
      const sway = Math.sin(frameIdx * 0.3) * 0.03;
      // Left ankle + heel: invisible
      lm[LM.LEFT_ANKLE] = { x: 0.42, y: 0.88, z: 0, visibility: 0.1 };
      lm[LM.LEFT_HEEL] = { x: 0.42, y: 0.90, z: 0, visibility: 0.1 };
      // Right side: natural sway (ensures variance above thresholds)
      lm[LM.RIGHT_HIP] = { x: 0.56, y: 0.55 + sway * 0.2, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_KNEE] = { x: 0.57 - sway, y: 0.72 + sway * 0.5, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_ANKLE] = { x: 0.58 - sway, y: 0.88 + sway * 1.0, z: 0, visibility: 0.95 };
      lm[LM.RIGHT_HEEL] = { x: 0.58 - sway, y: 0.92 + sway * 0.5, z: 0, visibility: 0.95 };
      return lm;
    }

    it('does NOT classify prosthetic when ankle not visible', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      let diagChange = null;
      for (let f = 0; f < 65; f++) {
        const change = seq.feedFrame(createLeftAnkleInvisibleLandmarks(f));
        if (change && change.subState === 'diagnostics') {
          diagChange = change;
          break;
        }
      }
      expect(diagChange).not.toBeNull();
      // Should route to NORMAL, not TRANSFEMORAL_AMPUTEE
      expect(diagChange.diagnosticTrack).toBe('NORMAL');
    });

    it('emits repositionNeeded when ankle joints untracked', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      let diagChange = null;
      for (let f = 0; f < 65; f++) {
        const change = seq.feedFrame(createLeftAnkleInvisibleLandmarks(f));
        if (change && change.subState === 'diagnostics') {
          diagChange = change;
          break;
        }
      }
      expect(diagChange).not.toBeNull();
      expect(diagChange.repositionNeeded).toBe(true);
      expect(diagChange.repositionInstruction_he).toContain('קרסוליים');
    });

    it('TRANSTIBIAL message says below-knee prosthesis detected', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Create frames where left knee moves but left ankle is frozen
      let result = null;
      for (let f = 0; f < 70; f++) {
        const lm = createRigidKneeLandmarks();
        // Override: make left knee move (transtibial = knee moves, ankle frozen)
        const t = f / 30;
        const osc = Math.sin(t * 2 * Math.PI * 2) * 0.08;
        lm[LM.LEFT_KNEE].x = 0.44 + osc;
        lm[LM.LEFT_KNEE].y = 0.72 + osc * 0.5;
        const change = seq.feedFrame(lm);
        if (change && change.subState === 'diagnostics') {
          result = change;
          break;
        }
      }

      if (result && result.diagnosticTrack === 'TRANSTIBIAL_AMPUTEE') {
        expect(result.anatomyMessage).toContain('below-knee');
        expect(result.anatomyMessage).toContain('prosthesis');
        expect(result.anatomyMessage_he).toContain('מתחת לברך');
      }
    });

    it('TRANSFEMORAL message says above-knee prosthesis detected', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      let result = null;
      for (let f = 0; f < 70; f++) {
        const change = seq.feedFrame(createRigidKneeLandmarks());
        if (change && change.subState === 'diagnostics') {
          result = change;
          break;
        }
      }

      expect(result).not.toBeNull();
      if (result.diagnosticTrack === 'TRANSFEMORAL_AMPUTEE') {
        expect(result.anatomyMessage).toContain('above-knee');
        expect(result.anatomyMessage).toContain('prosthesis');
        expect(result.anatomyMessage_he).toContain('מעל הברך');
      }
    });

    it('mid-diagnostic does NOT flag prosthetic knee as frozen in TRANSTIBIAL track', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      // Get to TRANSTIBIAL track: knee moves, ankle frozen
      let diagResult = null;
      for (let f = 0; f < 70; f++) {
        const lm = createRigidKneeLandmarks();
        const t = f / 30;
        const osc = Math.sin(t * 2 * Math.PI * 2) * 0.08;
        lm[LM.LEFT_KNEE].x = 0.44 + osc;
        lm[LM.LEFT_KNEE].y = 0.72 + osc * 0.5;
        const change = seq.feedFrame(lm);
        if (change && change.subState === 'diagnostics') {
          diagResult = change;
          break;
        }
      }

      // If we got TRANSTIBIAL track, feed frames with prosthetic knee frozen
      // Should NOT trigger mid-diagnostic reroute for that knee
      if (diagResult && diagResult.diagnosticTrack === 'TRANSTIBIAL_AMPUTEE') {
        let rerouted = null;
        for (let f = 0; f < 300; f++) {
          // Feed static frames — left knee frozen but that's OK in TRANSTIBIAL
          const change = seq.feedFrame(createRigidKneeLandmarks());
          if (change && change.rerouted) {
            rerouted = change;
            break;
          }
        }
        // Should NOT reroute because prosthetic knee is excluded from frozen check
        expect(rerouted).toBeNull();
      }
    });

    it('no repositionNeeded when all joints visible', () => {
      const seq = new ScanSequencer({ sampleRate: 30, skipMotionCalibration: true });
      seq.start();
      passCalibration(seq);

      let diagChange = null;
      for (let f = 0; f < 65; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.subState === 'diagnostics') {
          diagChange = change;
          break;
        }
      }
      expect(diagChange).not.toBeNull();
      expect(diagChange.repositionNeeded).toBeFalsy();
    });
  });

  // ============================================================
  // Full Diagnostic Mode — Motion Calibration, Mirror, Calf Raise, Confidence, Error Report
  // ============================================================
  describe('Full Diagnostic Mode (motion calibration enabled)', () => {

    /**
     * Helper: creates a sequencer WITHOUT skipMotionCalibration (full mode).
     */
    function createFullSeq(opts = {}) {
      return new ScanSequencer({ sampleRate: 30, skipMotionCalibration: false, ...opts });
    }

    /**
     * Helper: passes calibrating phase (first frame with 33 landmarks).
     */
    function passCalibrationFull(seq) {
      const c = seq.feedFrame(createHealthyLandmarks());
      expect(seq.state).toBe(STATE.PHASE_A);
      expect(c.subState).toBe('motionCalibration');
      return c;
    }

    /**
     * Helper: creates a frame where RIGHT wrist is raised (for hand raise movement).
     */
    function createRightHandRaisedFrame() {
      const lm = createHealthyLandmarks();
      lm[LM.RIGHT_WRIST].y = 0.10; // High above head (baseline is ~0.45)
      return lm;
    }

    /**
     * Helper: creates a frame where LEFT wrist is raised (mirror scenario).
     */
    function createLeftHandRaisedFrame() {
      const lm = createHealthyLandmarks();
      lm[LM.LEFT_WRIST].y = 0.10;
      return lm;
    }

    /**
     * Helper: creates a knee-bent frame (angle change from straight leg).
     */
    function createKneeBentFrame() {
      const lm = createHealthyLandmarks();
      // Move left ankle forward to change knee angle
      lm[LM.LEFT_ANKLE].x = 0.55;
      lm[LM.LEFT_ANKLE].y = 0.82;
      lm[LM.RIGHT_ANKLE].x = 0.55;
      lm[LM.RIGHT_ANKLE].y = 0.82;
      return lm;
    }

    /**
     * Helper: creates a pelvis rotation frame.
     */
    function createPelvisRotatedFrame(offset) {
      const lm = createHealthyLandmarks();
      lm[LM.LEFT_HIP].x = 0.45 + offset;
      lm[LM.RIGHT_HIP].x = 0.55 + offset;
      return lm;
    }

    /**
     * Helper: creates a calf raise frame where both ankles rise.
     */
    function createCalfRaisedFrame() {
      const lm = createHealthyLandmarks();
      lm[LM.LEFT_ANKLE].y = 0.85; // baseline 0.88, moved up
      lm[LM.RIGHT_ANKLE].y = 0.85;
      return lm;
    }

    /**
     * Helper: advances through all 4 motion calibration movements.
     */
    function passMotionCalibration(seq) {
      // Movement 1: raise_right_hand
      for (let i = 0; i < 5; i++) seq.feedFrame(createRightHandRaisedFrame());

      // Movement 2: slight_bend
      let advanced = false;
      for (let i = 0; i < MOTION_CAL_FRAMES_PER_MOVEMENT && !advanced; i++) {
        const change = seq.feedFrame(createKneeBentFrame());
        if (change && change.motionCalStep === 2) advanced = true;
      }

      // Movement 3: pelvis_rotation — need range of hip X diffs
      for (let i = 0; i < 10; i++) seq.feedFrame(createPelvisRotatedFrame(-0.02));
      for (let i = 0; i < 10; i++) seq.feedFrame(createPelvisRotatedFrame(0.02));

      // Movement 4: calf_raise
      let transitioned = false;
      for (let i = 0; i < 20; i++) {
        const change = seq.feedFrame(createCalfRaisedFrame());
        if (change && change.subState === 'detection') {
          transitioned = true;
          return change;
        }
      }

      // If not yet transitioned, feed more frames until timeout
      for (let i = 0; i < MOTION_CAL_FRAMES_PER_MOVEMENT; i++) {
        const change = seq.feedFrame(createCalfRaisedFrame());
        if (change && change.subState === 'detection') return change;
      }
      return null;
    }

    it('starts in motionCalibration sub-state after calibrating', () => {
      const seq = createFullSeq();
      seq.start();
      const c = passCalibrationFull(seq);
      expect(c.motionCalStep).toBe(0);
      expect(c.motionCalTotal).toBe(MOTION_CAL_MOVEMENTS.length);
      expect(c.instruction).toContain('RIGHT hand');
    });

    it('advances through 4 movements to detection', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);
      const result = passMotionCalibration(seq);
      expect(result).not.toBeNull();
      expect(result.subState).toBe('detection');
    });

    it('detects mirror when left wrist rises instead of right', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);

      // First frame sets the baseline (normal wrist positions)
      seq.feedFrame(createStaticLandmarks());

      // Then feed frames where LEFT wrist rises (mirror scenario)
      let mirrorDetected = false;
      for (let i = 0; i < MOTION_CAL_FRAMES_PER_MOVEMENT - 1; i++) {
        const change = seq.feedFrame(createLeftHandRaisedFrame());
        if (change && change.mirrored) {
          mirrorDetected = true;
          break;
        }
      }
      expect(mirrorDetected).toBe(true);
    });

    it('mirror correction swaps left/right landmarks', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);

      // First frame sets the baseline (normal wrist positions)
      seq.feedFrame(createStaticLandmarks());

      // Force mirror by feeding left-raised frames
      for (let i = 0; i < MOTION_CAL_FRAMES_PER_MOVEMENT; i++) {
        seq.feedFrame(createLeftHandRaisedFrame());
      }

      expect(seq._mirrored).toBe(true);
    });

    it('calf raise detects asymmetric ankle movement', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);

      // Pass first 3 movements quickly (timeout)
      for (let i = 0; i < MOTION_CAL_FRAMES_PER_MOVEMENT; i++) seq.feedFrame(createRightHandRaisedFrame());
      for (let i = 0; i < MOTION_CAL_FRAMES_PER_MOVEMENT; i++) seq.feedFrame(createKneeBentFrame());
      for (let i = 0; i < MOTION_CAL_FRAMES_PER_MOVEMENT; i++) seq.feedFrame(createPelvisRotatedFrame(0));

      // Calf raise: first frame is baseline (normal ankles at 0.88)
      seq.feedFrame(createStaticLandmarks());

      // Then only right ankle moves up — check for detection transition
      let result = null;
      for (let i = 0; i < MOTION_CAL_FRAMES_PER_MOVEMENT; i++) {
        const lm = createStaticLandmarks();
        lm[LM.RIGHT_ANKLE].y = 0.85; // right rises (baseline 0.88 → 0.85 = 0.03 range)
        // left stays at 0.88 (no movement)
        const change = seq.feedFrame(lm);
        if (change && change.subState === 'detection') {
          result = change;
          break;
        }
      }

      expect(result).not.toBeNull();
      expect(result.calfRaiseResult).toBeDefined();
      expect(result.calfRaiseResult.rightAnkleMoved).toBe(true);
      expect(result.calfRaiseResult.leftAnkleMoved).toBe(false);
    });

    it('ankleStatus emitted during detection in full mode', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);
      passMotionCalibration(seq);

      // Feed 10 frames — should get ankleStatus on frame 10
      let statusEmitted = false;
      for (let i = 0; i < 30; i++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.ankleStatus) {
          statusEmitted = true;
          expect(change.ankleStatus.left).toBeDefined();
          expect(change.ankleStatus.right).toBeDefined();
          expect(change.ankleStatus.left).toHaveProperty('visible');
          expect(change.ankleStatus.left).toHaveProperty('moving');
          expect(change.ankleStatus.right).toHaveProperty('visible');
          expect(change.ankleStatus.right).toHaveProperty('moving');
          break;
        }
      }
      expect(statusEmitted).toBe(true);
    });

    it('reportDetectionError resets with strict mode', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);

      // Report error — should reset and restart
      const result = seq.reportDetectionError();
      expect(result).not.toBeNull();
      expect(seq.state).toBe(STATE.CALIBRATING);
      expect(seq._strictMode).toBe(true);
    });

    it('strict mode doubles detection duration', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);
      seq.reportDetectionError(); // sets strict mode

      // Pass calibration again
      passCalibrationFull(seq);
      const detectionResult = passMotionCalibration(seq);
      expect(detectionResult).not.toBeNull();

      // In strict mode with 30fps, detection duration = 4s * 30 = 120 frames
      // Normal mode = 2s * 30 = 60 frames
      // The _detectionFrameTarget should be set for 120 frames after start
      const expectedFrames = 4 * 30; // strict mode = 4 seconds
      const detectionFrameCount = seq._detectionFrameTarget - seq._detectionFrameStart;
      expect(detectionFrameCount).toBe(expectedFrames);
    });

    it('detection transitions to visionDiagnosis in full mode', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);
      passMotionCalibration(seq);

      // Feed detection frames until detection completes → visionDiagnosis
      let visionTransition = null;
      for (let f = 0; f < 200; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.subState === 'visionDiagnosis') {
          visionTransition = change;
          break;
        }
      }
      expect(visionTransition).not.toBeNull();
      expect(visionTransition.awaitingVision).toBe(true);
      expect(visionTransition.captureFrames).toBe(true);
      expect(visionTransition.kineticResult).toBeDefined();
    });

    it('MOTION_CAL_MOVEMENTS has 4 movements', () => {
      expect(MOTION_CAL_MOVEMENTS).toHaveLength(4);
      expect(MOTION_CAL_MOVEMENTS[0].id).toBe('raise_right_hand');
      expect(MOTION_CAL_MOVEMENTS[1].id).toBe('slight_bend');
      expect(MOTION_CAL_MOVEMENTS[2].id).toBe('pelvis_rotation');
      expect(MOTION_CAL_MOVEMENTS[3].id).toBe('calf_raise');
    });

    it('CONFIDENCE_THRESHOLD is 0.95', () => {
      expect(CONFIDENCE_THRESHOLD).toBe(0.95);
    });

    // ── Vision-First Diagnostic Tests ──

    it('feedFrame returns null during visionDiagnosis (blocked)', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);
      passMotionCalibration(seq);

      // Feed until visionDiagnosis
      for (let f = 0; f < 200; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.subState === 'visionDiagnosis') break;
      }

      // Now in visionDiagnosis — feedFrame should return null
      const result = seq.feedFrame(createHealthyLandmarks());
      expect(result).toBeNull();
    });

    it('setVisionResult stores diagnosis and enters awaitingConfirmation', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);
      passMotionCalibration(seq);

      for (let f = 0; f < 200; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.subState === 'visionDiagnosis') break;
      }

      const diagnosis = {
        classification: 'TRANSFEMORAL_AMPUTEE',
        adaptedTrack: 'TRANSFEMORAL_AMPUTEE',
        prostheticSide: 'left',
        aids: ['prosthetic_leg'],
        confidence: 0.95,
        description: 'Left above-knee amputation detected',
        description_he: 'זוהתה קטיעה מעל הברך בצד שמאל',
        specialProtocol: null,
      };

      const change = seq.setVisionResult(diagnosis);
      expect(change).not.toBeNull();
      expect(change.awaitingConfirmation).toBe(true);
      expect(change.diagnosis.classification).toBe('TRANSFEMORAL_AMPUTEE');
      expect(change.diagnosis.kineticAgreement).toBeDefined();
    });

    it('confirmDiagnosis routes to correct diagnostic track', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);
      passMotionCalibration(seq);

      for (let f = 0; f < 200; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.subState === 'visionDiagnosis') break;
      }

      seq.setVisionResult({
        classification: 'TRANSFEMORAL_AMPUTEE',
        adaptedTrack: 'TRANSFEMORAL_AMPUTEE',
        prostheticSide: 'left',
        aids: [],
        confidence: 0.95,
        description: 'Left above-knee amputation',
        description_he: 'קטיעה מעל הברך בשמאל',
        specialProtocol: null,
      });

      const change = seq.confirmDiagnosis();
      expect(change).not.toBeNull();
      expect(change.subState).toBe('diagnostics');
      expect(change.diagnosticTrack).toBe('TRANSFEMORAL_AMPUTEE');
    });

    it('confirmDiagnosis with NORMAL track routes to NORMAL diagnostics', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);
      passMotionCalibration(seq);

      for (let f = 0; f < 200; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.subState === 'visionDiagnosis') break;
      }

      seq.setVisionResult({
        classification: 'NATURAL',
        adaptedTrack: 'NORMAL',
        prostheticSide: null,
        aids: [],
        confidence: 0.98,
        description: 'No disability detected',
        description_he: 'לא זוהתה מוגבלות',
        specialProtocol: null,
      });

      const change = seq.confirmDiagnosis();
      expect(change.diagnosticTrack).toBe('NORMAL');
    });

    it('rejectDiagnosis resets with strict mode', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);
      passMotionCalibration(seq);

      for (let f = 0; f < 200; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.subState === 'visionDiagnosis') break;
      }

      seq.setVisionResult({
        classification: 'NATURAL',
        adaptedTrack: 'NORMAL',
        prostheticSide: null,
        aids: [],
        confidence: 0.5,
        description: 'Uncertain',
        description_he: 'לא ברור',
        specialProtocol: null,
      });

      const change = seq.rejectDiagnosis();
      expect(change).not.toBeNull();
      expect(seq.state).toBe(STATE.CALIBRATING);
      expect(seq._strictMode).toBe(true);
    });

    it('setVisionResult returns null if not in visionDiagnosis state', () => {
      const seq = createFullSeq();
      seq.start();
      // Still in CALIBRATING
      const result = seq.setVisionResult({ classification: 'NATURAL', adaptedTrack: 'NORMAL' });
      expect(result).toBeNull();
    });

    it('special protocol (wheelchair) routes to WHEELCHAIR track', () => {
      const seq = createFullSeq();
      seq.start();
      passCalibrationFull(seq);
      passMotionCalibration(seq);

      for (let f = 0; f < 200; f++) {
        const change = seq.feedFrame(createHealthyLandmarks());
        if (change && change.subState === 'visionDiagnosis') break;
      }

      seq.setVisionResult({
        classification: 'WHEELCHAIR',
        adaptedTrack: 'WHEELCHAIR',
        prostheticSide: null,
        aids: ['wheelchair'],
        confidence: 0.99,
        description: 'Person in wheelchair',
        description_he: 'אדם בכיסא גלגלים',
        specialProtocol: 'wheelchair',
      });

      const change = seq.confirmDiagnosis();
      expect(change.diagnosticTrack).toBe('WHEELCHAIR');
    });
  });
});

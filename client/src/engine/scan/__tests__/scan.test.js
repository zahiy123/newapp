// ============================================================
// Scan Engine Tests — Steps 1-4
//
// Tests for: movements.js, DampingAnalyzer.js, PhaseAAnalyzer.js,
//            PhaseBAnalyzer.js
// Uses synthetic but realistic data to validate correctness.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  TRACK_ALPHA, TRACK_BETA, TRACK_GAMMA,
  WHEELCHAIR_OVERRIDES,
  getMovementQueue,
  LM,
} from '../movements.js';
import {
  analyzeDamping,
  classifyDamping,
  compareSymmetry,
  analyzeStability,
  DAMPING_THRESHOLDS,
  MIN_SAMPLES,
} from '../DampingAnalyzer.js';
import {
  analyzeObjectDetections,
  analyzeLandmarkIntegrity,
  determineTrack,
  LIMB_LANDMARKS,
  MIN_FRAMES,
} from '../PhaseAAnalyzer.js';
import {
  analyzeMovement,
  analyzePhaseB,
  MIN_MOVEMENT_FRAMES,
  LIMB_DISTAL_LANDMARK,
  COMPENSATION_THRESHOLDS,
} from '../PhaseBAnalyzer.js';
import {
  evaluateCertainty,
  extractPassportFields,
  MAX_RETRIES_PER_MOVEMENT,
  VERDICT,
} from '../CertaintyGate.js';


// ============================================================
// Synthetic Data Generators
// ============================================================

/**
 * Generate a physically correct damped sinusoidal signal.
 * Uses the underdamped oscillator equation:
 *   A(t) = A₀ * e^(-ξ*ωₙ*t) * sin(ωd*t)
 *   where ωd = ωₙ * √(1 - ξ²)
 *
 * This ensures the logarithmic decrement between consecutive peaks
 * correctly maps back to the input damping ratio ξ.
 *
 * @param {number} dampingRatio - ξ (0 = no damping, <1 = underdamped)
 * @param {number} freqHz - natural frequency ωₙ/(2π)
 * @param {number} durationSec - signal length
 * @param {number} sampleRate - samples per second
 * @param {number} amplitude - initial amplitude
 * @returns {number[]}
 */
function generateDampedSignal(dampingRatio, freqHz, durationSec, sampleRate, amplitude = 1.0) {
  const omegaN = 2 * Math.PI * freqHz;
  // Damped frequency: ωd = ωₙ√(1-ξ²) — only valid for ξ < 1
  const xi = Math.min(dampingRatio, 0.99);
  const omegaD = omegaN * Math.sqrt(1 - xi * xi);
  const samples = Math.floor(durationSec * sampleRate);
  const signal = [];
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const value = amplitude * Math.exp(-xi * omegaN * t) * Math.sin(omegaD * t);
    signal.push(value);
  }
  return signal;
}

/**
 * Generate a signal with added noise (more realistic)
 */
function generateNoisyDampedSignal(dampingRatio, freqHz, durationSec, sampleRate, noiseLevel = 0.01) {
  const clean = generateDampedSignal(dampingRatio, freqHz, durationSec, sampleRate);
  return clean.map(v => v + (Math.random() - 0.5) * 2 * noiseLevel);
}

/**
 * Generate synthetic landmark frames for Phase A testing.
 * Creates 33 landmarks with specified properties per limb.
 */
function generateLandmarkFrames(frameCount, config = {}) {
  // config: { left_leg: { visible: true, variance: 0.001 }, ... }
  const frames = [];

  for (let f = 0; f < frameCount; f++) {
    const landmarks = [];
    for (let i = 0; i < 33; i++) {
      landmarks.push({
        x: 0.5 + (Math.random() - 0.5) * 0.001,
        y: 0.5 + (Math.random() - 0.5) * 0.001,
        z: 0,
        visibility: 0.95,
      });
    }

    // Apply per-limb configurations
    for (const [limbKey, limbConfig] of Object.entries(config)) {
      const indices = LIMB_LANDMARKS[limbKey];
      if (!indices) continue;
      for (const idx of indices) {
        if (limbConfig.visible === false) {
          landmarks[idx].visibility = 0.1;
          landmarks[idx].x = 0;
          landmarks[idx].y = 0;
        } else {
          landmarks[idx].visibility = limbConfig.visibility ?? 0.95;
          const variance = limbConfig.variance ?? 0.001;
          landmarks[idx].x = 0.5 + (Math.random() - 0.5) * Math.sqrt(variance);
          landmarks[idx].y = (limbKey.includes('leg') ? 0.8 : 0.4)
            + (Math.random() - 0.5) * Math.sqrt(variance);
        }
        if (limbConfig.shorterBy) {
          // Make this limb shorter by reducing distance between landmarks
          landmarks[idx].y *= (1 - limbConfig.shorterBy);
        }
      }
    }

    frames.push(landmarks);
  }

  return frames;
}

/**
 * Generate synthetic object detection frames
 */
function generateObjectFrames(frameCount, objects = [], presentRatio = 1.0) {
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    if (i / frameCount < presentRatio) {
      frames.push({ objects: objects.map(o => ({ ...o })) });
    } else {
      frames.push({ objects: [] });
    }
  }
  return frames;
}


// ============================================================
// movements.js Tests
// ============================================================

describe('movements.js', () => {
  it('TRACK_ALPHA has 3 movements', () => {
    expect(TRACK_ALPHA).toHaveLength(3);
    expect(TRACK_ALPHA.every(m => m.id && m.duration_ms && m.instruction_he)).toBe(true);
  });

  it('TRACK_BETA has 4 movements', () => {
    expect(TRACK_BETA).toHaveLength(4);
  });

  it('TRACK_GAMMA has 3 movements', () => {
    expect(TRACK_GAMMA).toHaveLength(3);
  });

  it('all movements have required fields', () => {
    const allMovements = [...TRACK_ALPHA, ...TRACK_BETA, ...TRACK_GAMMA];
    for (const m of allMovements) {
      expect(m.id).toBeTruthy();
      expect(m.instruction_he).toBeTruthy();
      expect(m.instruction_en).toBeTruthy();
      expect(m.duration_ms).toBeGreaterThan(0);
      expect(m.target_limbs.length).toBeGreaterThan(0);
      expect(m.analysis_type).toBeTruthy();
      expect(m.landmarks_of_interest.length).toBeGreaterThan(0);
    }
  });

  it('all movement IDs are unique', () => {
    const allMovements = [...TRACK_ALPHA, ...TRACK_BETA, ...TRACK_GAMMA];
    const ids = allMovements.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getMovementQueue returns correct track', () => {
    expect(getMovementQueue('missing_limb')).toHaveLength(3);
    expect(getMovementQueue('deep_analysis')).toHaveLength(4);
    expect(getMovementQueue('full_body')).toHaveLength(3);
  });

  it('getMovementQueue throws on unknown track', () => {
    expect(() => getMovementQueue('unknown')).toThrow();
  });

  it('wheelchair overrides skip leg movements', () => {
    const queue = getMovementQueue('deep_analysis', true);
    // beta_step_right_left, beta_single_leg_right, beta_single_leg_left → null (skipped)
    // beta_mini_squat → replaced with upper body
    expect(queue.length).toBeLessThan(TRACK_BETA.length);
    expect(queue.every(m => m.id.includes('wheelchair') || m.id.includes('upper_body'))).toBe(true);
  });

  it('wheelchair overrides keep correct structure', () => {
    const queue = getMovementQueue('full_body', true);
    for (const m of queue) {
      expect(m.id).toBeTruthy();
      expect(m.instruction_he).toBeTruthy();
      expect(m.duration_ms).toBeGreaterThan(0);
      // Wheelchair movements should not reference leg landmarks
      const legLandmarks = [LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE];
      const hasLegLandmark = m.landmarks_of_interest.some(l => legLandmarks.includes(l));
      expect(hasLegLandmark).toBe(false);
    }
  });

  it('LM constants map to valid MediaPipe indices', () => {
    expect(LM.NOSE).toBe(0);
    expect(LM.LEFT_SHOULDER).toBe(11);
    expect(LM.RIGHT_FOOT).toBe(32);
  });
});


// ============================================================
// DampingAnalyzer Tests
// ============================================================

describe('DampingAnalyzer', () => {
  describe('analyzeDamping()', () => {
    it('returns insufficient_data for short signals', () => {
      const result = analyzeDamping([1, 2, 3], 30);
      expect(result.sufficient_data).toBe(false);
      expect(result.damping_class).toBe('inconclusive');
    });

    it('detects organic_healthy from low-damping signal', () => {
      // Low damping ratio = healthy muscle tissue
      const signal = generateDampedSignal(0.05, 2.0, 3, 30);
      const result = analyzeDamping(signal, 30);

      expect(result.sufficient_data).toBe(true);
      expect(result.damping_class).toBe('organic_healthy');
      expect(result.damping_factor).toBeLessThan(DAMPING_THRESHOLDS.HEALTHY_MAX);
    });

    it('detects mechanical from high-damping signal', () => {
      // High damping ratio = prosthetic/rigid
      // Use lower frequency and longer duration for more measurable peaks
      const signal = generateDampedSignal(0.7, 1.0, 5, 30);
      const result = analyzeDamping(signal, 30);

      expect(result.sufficient_data).toBe(true);
      expect(result.damping_class).toBe('mechanical');
      expect(result.damping_factor).toBeGreaterThan(DAMPING_THRESHOLDS.INCONCLUSIVE_MAX);
    });

    it('detects organic_weak from medium-damping signal', () => {
      const signal = generateDampedSignal(0.25, 1.5, 4, 30);
      const result = analyzeDamping(signal, 30);

      expect(result.sufficient_data).toBe(true);
      expect(result.damping_class).toBe('organic_weak');
    });

    it('returns non-healthy for ambiguous damping zone', () => {
      // Damping ratio in 0.35-0.50 zone
      const signal = generateDampedSignal(0.42, 1.5, 4, 30);
      const result = analyzeDamping(signal, 30);

      expect(result.sufficient_data).toBe(true);
      // Should NOT classify as healthy — that's the key safety requirement
      expect(result.damping_class).not.toBe('organic_healthy');
    });

    it('detects dominant frequency correctly', () => {
      const signal = generateDampedSignal(0.1, 3.0, 3, 30);
      const result = analyzeDamping(signal, 30);

      // Should find dominant frequency near 3.0 Hz
      expect(result.dominant_freq_hz).toBeGreaterThan(2.0);
      expect(result.dominant_freq_hz).toBeLessThan(4.0);
    });

    it('handles noisy signals robustly', () => {
      const signal = generateNoisyDampedSignal(0.08, 2.0, 3, 30, 0.05);
      const result = analyzeDamping(signal, 30);

      expect(result.sufficient_data).toBe(true);
      // Should still classify as healthy despite noise
      expect(['organic_healthy', 'organic_weak']).toContain(result.damping_class);
    });

    it('handles null/empty input', () => {
      expect(analyzeDamping(null, 30).sufficient_data).toBe(false);
      expect(analyzeDamping([], 30).sufficient_data).toBe(false);
    });
  });

  describe('classifyDamping()', () => {
    it('classifies correctly across all zones', () => {
      expect(classifyDamping(0.05)).toBe('organic_healthy');
      expect(classifyDamping(0.14)).toBe('organic_healthy');
      expect(classifyDamping(0.20)).toBe('organic_weak');
      expect(classifyDamping(0.34)).toBe('organic_weak');
      expect(classifyDamping(0.42)).toBe('inconclusive');
      expect(classifyDamping(0.55)).toBe('mechanical');
      expect(classifyDamping(0.90)).toBe('mechanical');
      expect(classifyDamping(null)).toBe('inconclusive');
    });

    it('upgrades healthy to weak when tremor is high', () => {
      // Low damping but high tremor → weak, not healthy
      expect(classifyDamping(0.10, 0.35)).toBe('organic_weak');
    });
  });

  describe('compareSymmetry()', () => {
    it('detects symmetric limbs', () => {
      const left = analyzeDamping(generateDampedSignal(0.08, 2.0, 3, 30), 30);
      const right = analyzeDamping(generateDampedSignal(0.09, 2.0, 3, 30), 30);
      const sym = compareSymmetry(left, right);

      expect(sym.is_symmetric).toBe(true);
      expect(sym.symmetry_index).toBeGreaterThan(0.8);
    });

    it('detects asymmetric limbs (healthy vs mechanical)', () => {
      const healthy = analyzeDamping(generateDampedSignal(0.08, 1.5, 4, 30), 30);
      const prosthetic = analyzeDamping(generateDampedSignal(0.7, 1.0, 5, 30), 30);
      const sym = compareSymmetry(healthy, prosthetic);

      expect(sym.is_symmetric).toBe(false);
      expect(sym.damping_delta).toBeGreaterThan(0.05);
    });

    it('handles insufficient data gracefully', () => {
      const valid = analyzeDamping(generateDampedSignal(0.1, 2.0, 3, 30), 30);
      const invalid = analyzeDamping([1, 2, 3], 30);
      const sym = compareSymmetry(valid, invalid);

      expect(sym.is_symmetric).toBe(false);
      expect(sym.asymmetry_type).toBe('insufficient_data');
    });
  });

  describe('analyzeStability()', () => {
    it('detects stable stance', () => {
      // Deterministic low-frequency gentle sway (< 4Hz) = stable, not tremor
      // Use a slow 0.3Hz sine to simulate natural body sway
      const x = Array.from({ length: 150 }, (_, i) =>
        0.5 + 0.002 * Math.sin(2 * Math.PI * 0.3 * i / 30)
      );
      const y = Array.from({ length: 150 }, (_, i) =>
        0.8 + 0.001 * Math.sin(2 * Math.PI * 0.5 * i / 30)
      );
      const result = analyzeStability(x, y, 30);

      expect(result.sufficient_data).toBe(true);
      expect(result.stability_class).toBe('stable');
    });

    it('detects tremor (high-frequency instability)', () => {
      // Add 6Hz tremor to base position
      const x = Array.from({ length: 150 }, (_, i) =>
        0.5 + 0.03 * Math.sin(2 * Math.PI * 6 * i / 30)
      );
      const y = Array.from({ length: 150 }, () => 0.8);
      const result = analyzeStability(x, y, 30);

      expect(result.sufficient_data).toBe(true);
      expect(result.stability_class).toBe('unstable_tremor');
    });

    it('returns inconclusive for insufficient data', () => {
      const result = analyzeStability([1, 2], [1, 2], 30);
      expect(result.sufficient_data).toBe(false);
    });
  });
});


// ============================================================
// PhaseAAnalyzer Tests
// ============================================================

describe('PhaseAAnalyzer', () => {
  describe('analyzeObjectDetections()', () => {
    it('detects crutches present in 90% of frames', () => {
      const frames = generateObjectFrames(30,
        [{ label: 'crutch', confidence: 0.95 }], 0.9);
      const result = analyzeObjectDetections(frames);
      expect(result.crutches.detected).toBe(true);
    });

    it('does NOT detect crutches present in only 50% of frames', () => {
      const frames = generateObjectFrames(30,
        [{ label: 'crutch', confidence: 0.95 }], 0.5);
      const result = analyzeObjectDetections(frames);
      expect(result.crutches.detected).toBe(false);
    });

    it('detects wheelchair', () => {
      const frames = generateObjectFrames(30,
        [{ label: 'wheelchair', confidence: 0.98 }], 0.95);
      const result = analyzeObjectDetections(frames);
      expect(result.wheelchair.detected).toBe(true);
    });

    it('returns empty detection for no objects', () => {
      const frames = generateObjectFrames(30, []);
      const result = analyzeObjectDetections(frames);
      expect(result.crutches.detected).toBe(false);
      expect(result.wheelchair.detected).toBe(false);
      expect(result.prosthetic.detected).toBe(false);
    });

    it('handles empty/null input', () => {
      expect(analyzeObjectDetections(null).crutches.detected).toBe(false);
      expect(analyzeObjectDetections([]).crutches.detected).toBe(false);
    });
  });

  describe('analyzeLandmarkIntegrity()', () => {
    it('detects healthy limbs (all visible, low variance)', () => {
      const frames = generateLandmarkFrames(60);
      const result = analyzeLandmarkIntegrity(frames);

      for (const limbKey of ['left_leg', 'right_leg', 'left_arm', 'right_arm']) {
        expect(result[limbKey].landmarks_present).toBe(true);
        expect(result[limbKey].preliminary_status).toBe('likely_healthy');
        expect(result[limbKey].certainty).toBe('high');
      }
    });

    it('detects absent left leg (landmarks invisible)', () => {
      const frames = generateLandmarkFrames(60, {
        left_leg: { visible: false },
      });
      const result = analyzeLandmarkIntegrity(frames);

      expect(result.left_leg.landmarks_present).toBe(false);
      expect(result.left_leg.preliminary_status).toBe('likely_absent');
      expect(result.left_leg.certainty).toBe('high');

      // Other limbs should still be healthy
      expect(result.right_leg.landmarks_present).toBe(true);
    });

    it('flags high-variance limb for investigation', () => {
      const frames = generateLandmarkFrames(60, {
        right_leg: { visible: true, variance: 0.05 },
      });
      const result = analyzeLandmarkIntegrity(frames);

      expect(result.right_leg.landmarks_present).toBe(true);
      expect(result.right_leg.preliminary_status).toBe('needs_investigation');
      expect(result.right_leg.certainty).toBe('needs_verification');
    });

    it('returns insufficient_frames for too few frames', () => {
      const frames = generateLandmarkFrames(5);
      const result = analyzeLandmarkIntegrity(frames);
      expect(result.left_leg.preliminary_status).toBe('insufficient_frames');
    });

    it('computes proportion ratios between opposite limbs', () => {
      const frames = generateLandmarkFrames(60);
      const result = analyzeLandmarkIntegrity(frames);

      // Both sides roughly equal → ratio near 1.0
      for (const limbKey of ['left_leg', 'right_leg', 'left_arm', 'right_arm']) {
        expect(result[limbKey].proportion_ratio).toBeGreaterThan(0.5);
        expect(result[limbKey].proportion_ratio).toBeLessThan(1.5);
      }
    });
  });

  describe('determineTrack()', () => {
    it('routes to missing_limb when limb is absent', () => {
      const aids = analyzeObjectDetections(
        generateObjectFrames(30, [{ label: 'crutch', confidence: 0.95 }], 0.95)
      );
      const integrity = analyzeLandmarkIntegrity(
        generateLandmarkFrames(60, { left_leg: { visible: false } })
      );
      const routing = determineTrack(aids, integrity);

      expect(routing.track).toBe('missing_limb');
      expect(routing.hypotheses.left_leg).toBe('absent');
    });

    it('routes to deep_analysis when limb is suspicious', () => {
      const aids = analyzeObjectDetections(generateObjectFrames(30, []));
      const integrity = analyzeLandmarkIntegrity(
        generateLandmarkFrames(60, {
          right_leg: { visible: true, variance: 0.05 },
        })
      );
      const routing = determineTrack(aids, integrity);

      expect(routing.track).toBe('deep_analysis');
      expect(routing.verification_needed).toContain('right_leg');
    });

    it('routes to full_body when everything looks healthy', () => {
      const aids = analyzeObjectDetections(generateObjectFrames(30, []));
      const integrity = analyzeLandmarkIntegrity(generateLandmarkFrames(60));
      const routing = determineTrack(aids, integrity);

      expect(routing.track).toBe('full_body');
      expect(routing.verification_needed).toHaveLength(0);
    });

    it('routes to deep_analysis when crutches seen but limbs look present', () => {
      const aids = analyzeObjectDetections(
        generateObjectFrames(30, [{ label: 'crutch', confidence: 0.95 }], 0.95)
      );
      const integrity = analyzeLandmarkIntegrity(generateLandmarkFrames(60));
      const routing = determineTrack(aids, integrity);

      expect(routing.track).toBe('deep_analysis');
      expect(routing.reasoning).toContain('Crutches detected but all limbs appear present');
    });

    it('detects wheelchair and adapts routing', () => {
      const aids = analyzeObjectDetections(
        generateObjectFrames(30, [{ label: 'wheelchair', confidence: 0.98 }], 0.95)
      );
      const integrity = analyzeLandmarkIntegrity(generateLandmarkFrames(60));
      const routing = determineTrack(aids, integrity);

      expect(routing.is_wheelchair).toBe(true);
      expect(routing.track).toBe('missing_limb');
      expect(routing.hypotheses.left_leg).toBe('wheelchair_user');
      expect(routing.hypotheses.right_leg).toBe('wheelchair_user');
    });

    it('provides reasoning string for all decisions', () => {
      const aids = analyzeObjectDetections(generateObjectFrames(30, []));
      const integrity = analyzeLandmarkIntegrity(generateLandmarkFrames(60));
      const routing = determineTrack(aids, integrity);

      expect(routing.reasoning).toBeTruthy();
      expect(typeof routing.reasoning).toBe('string');
    });
  });
});


// ============================================================
// PhaseBAnalyzer Tests
// ============================================================

/**
 * Generate landmark frames with a damped oscillation on specific landmarks.
 * Simulates a limb moving with specific damping characteristics.
 */
function generateDampedLandmarkFrames(frameCount, sampleRate, limbKey, dampingRatio, freqHz) {
  const omegaN = 2 * Math.PI * freqHz;
  const xi = Math.min(dampingRatio, 0.99);
  const omegaD = omegaN * Math.sqrt(1 - xi * xi);

  const distalIdx = LIMB_DISTAL_LANDMARK[limbKey];

  const frames = [];
  for (let f = 0; f < frameCount; f++) {
    const landmarks = [];
    for (let i = 0; i < 33; i++) {
      landmarks.push({
        x: 0.5,
        y: 0.5,
        z: 0,
        visibility: 0.95,
      });
    }

    // Apply damped oscillation to the distal landmark
    const t = f / sampleRate;
    const dampedValue = Math.exp(-xi * omegaN * t) * Math.sin(omegaD * t);
    landmarks[distalIdx].y = 0.5 + dampedValue * 0.3;

    frames.push(landmarks);
  }
  return frames;
}

/**
 * Generate landmark frames for compensation testing.
 * Simulates asymmetric weight shift with configurable hip drop.
 */
function generateCompensationFrames(frameCount, sampleRate, hipDropSide = 'left', dropMagnitude = 0.05) {
  const frames = [];
  for (let f = 0; f < frameCount; f++) {
    const landmarks = [];
    for (let i = 0; i < 33; i++) {
      landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
    }

    const t = f / sampleRate;
    const shiftPhase = Math.sin(2 * Math.PI * 0.5 * t); // 0.5 Hz weight shift

    // Hips shift laterally
    landmarks[LM.LEFT_HIP].x = 0.45 + shiftPhase * 0.05;
    landmarks[LM.RIGHT_HIP].x = 0.55 + shiftPhase * 0.05;

    // Hip drop on one side
    if (hipDropSide === 'left') {
      landmarks[LM.LEFT_HIP].y = 0.6 + Math.abs(shiftPhase) * dropMagnitude;
      landmarks[LM.RIGHT_HIP].y = 0.6;
    } else {
      landmarks[LM.LEFT_HIP].y = 0.6;
      landmarks[LM.RIGHT_HIP].y = 0.6 + Math.abs(shiftPhase) * dropMagnitude;
    }

    // Shoulders (trunk lean for compensation)
    landmarks[LM.LEFT_SHOULDER].x = 0.43 + shiftPhase * 0.06;
    landmarks[LM.RIGHT_SHOULDER].x = 0.57 + shiftPhase * 0.06;
    landmarks[LM.LEFT_SHOULDER].y = 0.3;
    landmarks[LM.RIGHT_SHOULDER].y = 0.3;

    // Knees and ankles for leg landmarks
    landmarks[LM.LEFT_KNEE].x = 0.45;
    landmarks[LM.LEFT_KNEE].y = 0.75;
    landmarks[LM.RIGHT_KNEE].x = 0.55;
    landmarks[LM.RIGHT_KNEE].y = 0.75;
    landmarks[LM.LEFT_ANKLE].x = 0.45;
    landmarks[LM.LEFT_ANKLE].y = 0.9;
    landmarks[LM.RIGHT_ANKLE].x = 0.55;
    landmarks[LM.RIGHT_ANKLE].y = 0.9;

    frames.push(landmarks);
  }
  return frames;
}


describe('PhaseBAnalyzer', () => {

  // ---- analyzeMovement() ----

  describe('analyzeMovement()', () => {

    it('returns insufficient_data for too few frames', () => {
      const movement = {
        id: 'test_move',
        analysis_type: 'damping',
        target_limbs: ['left_leg'],
      };
      const result = analyzeMovement(movement, [], 30);
      expect(result.left_leg.sufficient_data).toBe(false);
    });

    it('routes damping analysis correctly', () => {
      const movement = {
        id: 'test_damping',
        analysis_type: 'damping',
        target_limbs: ['left_leg', 'right_leg'],
        landmarks_of_interest: [LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
      };
      const frames = generateDampedLandmarkFrames(90, 30, 'left_leg', 0.05, 2.0);
      const result = analyzeMovement(movement, frames, 30);

      expect(result.left_leg).toBeDefined();
      expect(result.left_leg.type).toBe('damping');
      expect(result.left_leg.sufficient_data).toBe(true);
      expect(result.left_leg.damping_class).toBe('organic_healthy');
    });

    it('routes stability analysis correctly', () => {
      const movement = {
        id: 'test_stability',
        analysis_type: 'stability',
        target_limbs: ['right_leg'],
        landmarks_of_interest: [LM.RIGHT_ANKLE],
      };

      // Stable signal: tiny oscillations
      const frames = [];
      for (let f = 0; f < 90; f++) {
        const landmarks = [];
        for (let i = 0; i < 33; i++) {
          landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
        }
        // Small deterministic sway at 1Hz (below tremor band)
        const t = f / 30;
        landmarks[LM.RIGHT_ANKLE].x = 0.5 + Math.sin(2 * Math.PI * 1.0 * t) * 0.005;
        landmarks[LM.RIGHT_ANKLE].y = 0.9;
        frames.push(landmarks);
      }

      const result = analyzeMovement(movement, frames, 30);

      expect(result.right_leg).toBeDefined();
      expect(result.right_leg.type).toBe('stability');
      expect(result.right_leg.sufficient_data).toBe(true);
      expect(result.right_leg.stability_class).toBe('stable');
    });

    it('routes compensation analysis correctly', () => {
      const movement = {
        id: 'test_comp',
        analysis_type: 'compensation',
        target_limbs: ['left_leg', 'right_leg'],
        landmarks_of_interest: [LM.LEFT_HIP, LM.RIGHT_HIP],
      };
      const frames = generateCompensationFrames(90, 30, 'left', 0.05);
      const result = analyzeMovement(movement, frames, 30);

      expect(result.left_leg).toBeDefined();
      expect(result.left_leg.type).toBe('compensation');
      expect(result.left_leg.sufficient_data).toBe(true);
      expect(result.left_leg.weight_distribution).toBeDefined();
    });

    it('routes rhythm_baseline analysis correctly', () => {
      const movement = {
        id: 'test_rhythm',
        analysis_type: 'rhythm_baseline',
        target_limbs: ['left_leg', 'right_leg'],
        landmarks_of_interest: [LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
      };

      // Generate frames with 2Hz walking rhythm on both ankles
      const frames = [];
      for (let f = 0; f < 120; f++) {
        const landmarks = [];
        for (let i = 0; i < 33; i++) {
          landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
        }
        const t = f / 30;
        landmarks[LM.LEFT_ANKLE].y = 0.9 + Math.sin(2 * Math.PI * 2.0 * t) * 0.1;
        landmarks[LM.RIGHT_ANKLE].y = 0.9 + Math.sin(2 * Math.PI * 2.0 * t + Math.PI) * 0.1;
        frames.push(landmarks);
      }

      const result = analyzeMovement(movement, frames, 30);

      expect(result.left_leg).toBeDefined();
      expect(result.left_leg.type).toBe('rhythm');
      expect(result.left_leg.sufficient_data).toBe(true);
      expect(result.left_leg.step_frequency_hz).toBeGreaterThan(1.0);
    });

    it('detects hip drop compensation pattern', () => {
      const movement = {
        id: 'test_hip_drop',
        analysis_type: 'compensation',
        target_limbs: ['left_leg', 'right_leg'],
      };
      // Large hip drop on left side
      const frames = generateCompensationFrames(90, 30, 'left', 0.15);
      const result = analyzeMovement(movement, frames, 30);

      const patterns = result.left_leg.patterns;
      expect(patterns.length).toBeGreaterThan(0);

      const hipDrop = patterns.find(p => p.type === 'hip_drop');
      expect(hipDrop).toBeDefined();
      expect(hipDrop.side).toBe('left');
    });

    it('adds symmetry comparison for damping on limb pairs', () => {
      const movement = {
        id: 'test_sym',
        analysis_type: 'damping',
        target_limbs: ['left_leg', 'right_leg'],
      };

      // Left leg healthy, right leg gets different damping (via different data)
      const frames = generateDampedLandmarkFrames(150, 30, 'left_leg', 0.05, 2.0);
      // Also add damped signal to right leg
      const omegaN = 2 * Math.PI * 2.0;
      const xi = 0.05;
      const omegaD = omegaN * Math.sqrt(1 - xi * xi);
      for (let f = 0; f < frames.length; f++) {
        const t = f / 30;
        frames[f][LM.RIGHT_ANKLE].y = 0.5 + Math.exp(-xi * omegaN * t) * Math.sin(omegaD * t) * 0.3;
      }

      const result = analyzeMovement(movement, frames, 30);

      expect(result.left_leg.symmetry).toBeDefined();
      expect(result.right_leg.symmetry).toBeDefined();
      expect(result.left_leg.symmetry.symmetry_index).toBeDefined();
    });
  });

  // ---- analyzePhaseB() — Full pipeline ----

  describe('analyzePhaseB()', () => {

    it('returns empty assessments for empty input', () => {
      const result = analyzePhaseB([]);
      expect(result.movements_analyzed).toBe(0);
      expect(result.limbs.left_leg).toBeDefined();
      expect(result.limbs.left_leg.overall_damping_class).toBe('inconclusive');
    });

    it('aggregates damping results from multiple movements', () => {
      const movements = [
        {
          movement: {
            id: 'move_1',
            analysis_type: 'damping',
            target_limbs: ['left_arm', 'right_arm'],
          },
          frames: generateDampedLandmarkFrames(120, 30, 'left_arm', 0.08, 2.0),
          sampleRate: 30,
        },
      ];

      // Also add right arm signal to frames
      const omegaN = 2 * Math.PI * 2.0;
      const xi = 0.08;
      const omegaD = omegaN * Math.sqrt(1 - xi * xi);
      for (let f = 0; f < movements[0].frames.length; f++) {
        const t = f / 30;
        movements[0].frames[f][LM.RIGHT_WRIST].y =
          0.5 + Math.exp(-xi * omegaN * t) * Math.sin(omegaD * t) * 0.3;
      }

      const result = analyzePhaseB(movements);

      expect(result.movements_analyzed).toBe(1);
      expect(result.limbs.left_arm.damping).not.toBeNull();
      expect(result.limbs.left_arm.overall_damping_class).toBe('organic_healthy');
      expect(result.limbs.left_arm.evidence_sources).toContain('move_1');
    });

    it('produces full pipeline result with multiple movement types', () => {
      // Simulate a Track β with 3 movements
      const dampingFrames = generateDampedLandmarkFrames(90, 30, 'left_leg', 0.05, 1.5);
      // Add right leg signal
      const omegaN = 2 * Math.PI * 1.5;
      const xi = 0.05;
      const omegaD = omegaN * Math.sqrt(1 - xi * xi);
      for (let f = 0; f < dampingFrames.length; f++) {
        const t = f / 30;
        dampingFrames[f][LM.RIGHT_ANKLE].y =
          0.5 + Math.exp(-xi * omegaN * t) * Math.sin(omegaD * t) * 0.3;
      }

      // Stability frames for right leg
      const stabilityFrames = [];
      for (let f = 0; f < 90; f++) {
        const landmarks = [];
        for (let i = 0; i < 33; i++) {
          landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
        }
        const t = f / 30;
        landmarks[LM.RIGHT_ANKLE].x = 0.5 + Math.sin(2 * Math.PI * 1.0 * t) * 0.003;
        landmarks[LM.RIGHT_ANKLE].y = 0.9;
        stabilityFrames.push(landmarks);
      }

      const compFrames = generateCompensationFrames(90, 30);

      const movements = [
        {
          movement: { id: 'step', analysis_type: 'damping', target_limbs: ['left_leg', 'right_leg'] },
          frames: dampingFrames,
          sampleRate: 30,
        },
        {
          movement: { id: 'stand', analysis_type: 'stability', target_limbs: ['right_leg'] },
          frames: stabilityFrames,
          sampleRate: 30,
        },
        {
          movement: { id: 'shift', analysis_type: 'compensation', target_limbs: ['left_leg', 'right_leg'] },
          frames: compFrames,
          sampleRate: 30,
        },
      ];

      const result = analyzePhaseB(movements);

      expect(result.movements_analyzed).toBe(3);
      expect(result.movements_total).toBe(3);

      // Left leg should have damping + compensation
      expect(result.limbs.left_leg.damping).not.toBeNull();
      expect(result.limbs.left_leg.compensation).not.toBeNull();
      expect(result.limbs.left_leg.evidence_sources.length).toBeGreaterThan(0);

      // Right leg should have damping + stability + compensation
      expect(result.limbs.right_leg.damping).not.toBeNull();
      expect(result.limbs.right_leg.stability).not.toBeNull();
      expect(result.limbs.right_leg.compensation).not.toBeNull();
    });

    it('cross-validates: tremor overrides healthy damping (Rule 1)', () => {
      const dampingFrames = generateDampedLandmarkFrames(120, 30, 'left_leg', 0.05, 2.0);

      // Stability frames with 6Hz tremor in X
      const tremorFrames = [];
      for (let f = 0; f < 120; f++) {
        const landmarks = [];
        for (let i = 0; i < 33; i++) {
          landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
        }
        const t = f / 30;
        landmarks[LM.LEFT_ANKLE].x = 0.5 + Math.sin(2 * Math.PI * 6.0 * t) * 0.04;
        landmarks[LM.LEFT_ANKLE].y = 0.9;
        tremorFrames.push(landmarks);
      }

      const movements = [
        {
          movement: { id: 'damp', analysis_type: 'damping', target_limbs: ['left_leg'] },
          frames: dampingFrames,
          sampleRate: 30,
        },
        {
          movement: { id: 'stab', analysis_type: 'stability', target_limbs: ['left_leg'] },
          frames: tremorFrames,
          sampleRate: 30,
        },
      ];

      const result = analyzePhaseB(movements);

      // Cross-validation should override healthy → organic_weak
      expect(result.limbs.left_leg.stability.stability_class).toBe('unstable_tremor');
      expect(result.limbs.left_leg.overall_damping_class).toBe('organic_weak');

      // Audit trail should record what happened
      const cv = result.limbs.left_leg.cross_validation;
      expect(cv.applied_rules).toContain('tremor_overrides_healthy');
      expect(cv.original_class).toBe('organic_healthy');
      expect(cv.reasons.length).toBeGreaterThan(0);
    });

    it('cross-validation: no rules fire when data is consistent', () => {
      // Healthy damping + stable stability → no override needed
      const dampingFrames = generateDampedLandmarkFrames(120, 30, 'left_leg', 0.05, 2.0);

      const stableFrames = [];
      for (let f = 0; f < 120; f++) {
        const landmarks = [];
        for (let i = 0; i < 33; i++) {
          landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
        }
        const t = f / 30;
        landmarks[LM.LEFT_ANKLE].x = 0.5 + Math.sin(2 * Math.PI * 1.0 * t) * 0.003;
        landmarks[LM.LEFT_ANKLE].y = 0.9;
        stableFrames.push(landmarks);
      }

      const movements = [
        {
          movement: { id: 'damp', analysis_type: 'damping', target_limbs: ['left_leg'] },
          frames: dampingFrames,
          sampleRate: 30,
        },
        {
          movement: { id: 'stab', analysis_type: 'stability', target_limbs: ['left_leg'] },
          frames: stableFrames,
          sampleRate: 30,
        },
      ];

      const result = analyzePhaseB(movements);

      // Should stay healthy — no contradictions
      expect(result.limbs.left_leg.overall_damping_class).toBe('organic_healthy');
      const cv = result.limbs.left_leg.cross_validation;
      expect(cv.applied_rules).toHaveLength(0);
      expect(cv.original_class).toBeNull();
    });

    it('cross-validation audit trail is present on every limb', () => {
      const movements = [
        {
          movement: { id: 'test', analysis_type: 'damping', target_limbs: ['left_arm'] },
          frames: generateDampedLandmarkFrames(90, 30, 'left_arm', 0.08, 2.0),
          sampleRate: 30,
        },
      ];

      const result = analyzePhaseB(movements);

      // Every limb should have cross_validation, even if no rules fired
      for (const limbKey of ['left_leg', 'right_leg', 'left_arm', 'right_arm']) {
        const cv = result.limbs[limbKey].cross_validation;
        expect(cv).toBeDefined();
        expect(Array.isArray(cv.applied_rules)).toBe(true);
        expect(Array.isArray(cv.reasons)).toBe(true);
      }
    });

    it('tracks evidence sources correctly per limb', () => {
      const movements = [
        {
          movement: { id: 'move_a', analysis_type: 'damping', target_limbs: ['left_arm'] },
          frames: generateDampedLandmarkFrames(90, 30, 'left_arm', 0.08, 2.0),
          sampleRate: 30,
        },
        {
          movement: { id: 'move_b', analysis_type: 'damping', target_limbs: ['left_arm', 'right_arm'] },
          frames: generateDampedLandmarkFrames(90, 30, 'left_arm', 0.06, 2.0),
          sampleRate: 30,
        },
      ];

      const result = analyzePhaseB(movements);

      expect(result.limbs.left_arm.evidence_sources).toContain('move_a');
      expect(result.limbs.left_arm.evidence_sources).toContain('move_b');
      // Right arm only in move_b
      expect(result.limbs.right_arm.evidence_sources).toContain('move_b');
      expect(result.limbs.right_arm.evidence_sources).not.toContain('move_a');
    });

    it('defaults sampleRate to 30 if not provided', () => {
      const movements = [
        {
          movement: { id: 'test', analysis_type: 'damping', target_limbs: ['left_leg'] },
          frames: generateDampedLandmarkFrames(90, 30, 'left_leg', 0.05, 2.0),
          // no sampleRate specified
        },
      ];

      const result = analyzePhaseB(movements);
      expect(result.limbs.left_leg.damping).not.toBeNull();
      expect(result.limbs.left_leg.damping.sufficient_data).toBe(true);
    });
  });
});


// ============================================================
// CertaintyGate Tests
// ============================================================

// ---- Test Data Factories ----

/**
 * Create a minimal Phase A result with specified hypotheses.
 */
function makePhaseAResult(hypotheses = {}, isWheelchair = false) {
  return {
    track: 'full_body',
    is_wheelchair: isWheelchair,
    hypotheses: {
      left_leg: 'likely_healthy',
      right_leg: 'likely_healthy',
      left_arm: 'likely_healthy',
      right_arm: 'likely_healthy',
      ...hypotheses,
    },
    verification_needed: [],
    reasoning: 'test',
  };
}

/**
 * Create a Phase B result with specified per-limb damping classes.
 */
function makePhaseBResult(limbConfigs = {}) {
  const limbs = {};
  for (const limbKey of ['left_leg', 'right_leg', 'left_arm', 'right_arm']) {
    const config = limbConfigs[limbKey] || {};
    limbs[limbKey] = {
      damping: config.damping !== undefined ? config.damping : {
        damping_factor: config.dampingFactor ?? 0.08,
        damping_class: config.dampingClass ?? 'organic_healthy',
        sufficient_data: config.sufficient ?? true,
      },
      stability: config.stability ?? null,
      compensation: config.compensation ?? null,
      rhythm: config.rhythm ?? null,
      overall_damping_class: config.dampingClass ?? 'organic_healthy',
      overall_damping_factor: config.dampingFactor ?? 0.08,
      evidence_sources: config.evidence ?? ['test_movement'],
      cross_validation: config.crossValidation ?? {
        applied_rules: [],
        reasons: [],
        original_class: null,
      },
    };
  }
  return { limbs, movements_analyzed: 3, movements_total: 3 };
}


describe('CertaintyGate', () => {

  describe('evaluateCertainty() — Complete verdicts', () => {

    it('returns COMPLETE for all healthy limbs', () => {
      const phaseA = makePhaseAResult();
      const phaseB = makePhaseBResult();

      const result = evaluateCertainty(phaseA, phaseB);

      expect(result.scan_status).toBe('complete');
      expect(result.retries).toHaveLength(0);
      expect(result.user_queries).toHaveLength(0);

      for (const limbKey of ['left_leg', 'right_leg', 'left_arm', 'right_arm']) {
        const v = result.limbs[limbKey];
        expect(v.verdict).toBe('complete');
        expect(v.status).toBe('anatomical_healthy');
        expect(v.confidence).toBe(1.0);
        expect(v.detection_method).toBe('damping_analysis');
      }
    });

    it('returns COMPLETE with absent status for missing limb', () => {
      const phaseA = makePhaseAResult({ left_leg: 'absent' });
      const phaseB = makePhaseBResult();

      const result = evaluateCertainty(phaseA, phaseB);

      const v = result.limbs.left_leg;
      expect(v.verdict).toBe('complete');
      expect(v.status).toBe('absent');
      expect(v.confidence).toBe(1.0);
      expect(v.damping_factor).toBeNull();
      expect(v.damping_class).toBeNull();
    });

    it('returns COMPLETE with organic_weak status', () => {
      const phaseA = makePhaseAResult();
      const phaseB = makePhaseBResult({
        right_arm: { dampingClass: 'organic_weak', dampingFactor: 0.25 },
      });

      const result = evaluateCertainty(phaseA, phaseB);

      const v = result.limbs.right_arm;
      expect(v.verdict).toBe('complete');
      expect(v.status).toBe('anatomical_weak');
      expect(v.confidence).toBe(1.0);
      expect(v.damping_class).toBe('organic_weak');
    });

    it('returns COMPLETE with mechanical/prosthetic status', () => {
      const phaseA = makePhaseAResult();
      const phaseB = makePhaseBResult({
        left_leg: { dampingClass: 'mechanical', dampingFactor: 0.65 },
      });

      const result = evaluateCertainty(phaseA, phaseB);

      const v = result.limbs.left_leg;
      expect(v.verdict).toBe('complete');
      expect(v.status).toBe('prosthetic_below_knee');
      expect(v.confidence).toBe(1.0);
      expect(v.damping_class).toBe('mechanical');
      expect(v.damping_factor).toBe(0.65);
    });

    it('includes cross-validation info in reasoning', () => {
      const phaseA = makePhaseAResult();
      const phaseB = makePhaseBResult({
        left_leg: {
          dampingClass: 'organic_weak',
          dampingFactor: 0.10,
          crossValidation: {
            applied_rules: ['tremor_overrides_healthy'],
            reasons: ['Tremor detected in stability test'],
            original_class: 'organic_healthy',
          },
        },
      });

      const result = evaluateCertainty(phaseA, phaseB);

      const v = result.limbs.left_leg;
      expect(v.reasoning).toContain('cross-validated');
      expect(v.reasoning).toContain('Tremor');
    });
  });


  describe('evaluateCertainty() — Retry verdicts', () => {

    it('returns RETRY when damping is inconclusive', () => {
      const phaseA = makePhaseAResult();
      const phaseB = makePhaseBResult({
        right_leg: {
          dampingClass: 'inconclusive',
          dampingFactor: 0.42,
          evidence: ['beta_mini_squat'],
        },
      });

      const result = evaluateCertainty(phaseA, phaseB);

      expect(result.scan_status).toBe('needs_retry');
      expect(result.retries).toHaveLength(1);

      const v = result.limbs.right_leg;
      expect(v.verdict).toBe('retry');
      expect(v.status).toBe('unresolved');
      expect(v.confidence).toBeNull();

      const retry = result.retries[0];
      expect(retry.movement_id).toBe('beta_mini_squat');
      expect(retry.limb).toBe('right_leg');
      expect(retry.attempt).toBe(1);
    });

    it('increments retry attempt counter correctly', () => {
      const phaseA = makePhaseAResult();
      const phaseB = makePhaseBResult({
        right_leg: {
          dampingClass: 'inconclusive',
          dampingFactor: 0.40,
          evidence: ['beta_mini_squat'],
        },
      });

      // First retry already happened
      const retryCounts = { beta_mini_squat: 1 };
      const result = evaluateCertainty(phaseA, phaseB, retryCounts);

      expect(result.retries[0].attempt).toBe(2);
    });

    it('falls back to ASK_USER when retries exhausted', () => {
      const phaseA = makePhaseAResult();
      const phaseB = makePhaseBResult({
        right_leg: {
          dampingClass: 'inconclusive',
          dampingFactor: 0.42,
          evidence: ['beta_mini_squat'],
        },
      });

      // All retries used
      const retryCounts = { beta_mini_squat: MAX_RETRIES_PER_MOVEMENT };
      const result = evaluateCertainty(phaseA, phaseB, retryCounts);

      expect(result.scan_status).toBe('needs_user_input');
      expect(result.retries).toHaveLength(0);
      expect(result.user_queries).toHaveLength(1);

      const v = result.limbs.right_leg;
      expect(v.verdict).toBe('ask_user');
      expect(v.status).toBe('unresolved');
      expect(v.confidence).toBeNull();

      const query = result.user_queries[0];
      expect(query.limb).toBe('right_leg');
      expect(query.question_key).toBe('inconclusive_damping');
      expect(query.context).toContain('right leg');
    });

    it('tries next evidence source if first is exhausted', () => {
      const phaseA = makePhaseAResult();
      const phaseB = makePhaseBResult({
        left_leg: {
          dampingClass: 'inconclusive',
          dampingFactor: 0.38,
          evidence: ['beta_step_right_left', 'beta_mini_squat'],
        },
      });

      // First movement exhausted, second still has retries
      const retryCounts = { beta_step_right_left: MAX_RETRIES_PER_MOVEMENT };
      const result = evaluateCertainty(phaseA, phaseB, retryCounts);

      expect(result.retries).toHaveLength(1);
      expect(result.retries[0].movement_id).toBe('beta_mini_squat');
      expect(result.retries[0].attempt).toBe(1);
    });
  });


  describe('evaluateCertainty() — Wheelchair & ASK_USER verdicts', () => {

    it('returns ASK_USER for wheelchair user legs', () => {
      const phaseA = makePhaseAResult({
        left_leg: 'wheelchair_user',
        right_leg: 'wheelchair_user',
      }, true);
      const phaseB = makePhaseBResult();

      const result = evaluateCertainty(phaseA, phaseB);

      expect(result.user_queries.length).toBeGreaterThanOrEqual(2);

      const v = result.limbs.left_leg;
      expect(v.verdict).toBe('ask_user');
      expect(v.detection_method).toBe('visual_only');

      const query = result.user_queries.find(q => q.limb === 'left_leg');
      expect(query.question_key).toBe('wheelchair_leg_status');
    });

    it('wheelchair user arms are still analyzed normally', () => {
      const phaseA = makePhaseAResult({
        left_leg: 'wheelchair_user',
        right_leg: 'wheelchair_user',
      }, true);
      const phaseB = makePhaseBResult();

      const result = evaluateCertainty(phaseA, phaseB);

      // Arms should be complete (healthy by default in our test data)
      expect(result.limbs.left_arm.verdict).toBe('complete');
      expect(result.limbs.right_arm.verdict).toBe('complete');
    });
  });


  describe('evaluateCertainty() — Edge cases', () => {

    it('handles null Phase B result gracefully', () => {
      const phaseA = makePhaseAResult();

      const result = evaluateCertainty(phaseA, null);

      // All limbs should be retry or ask_user, not crash
      for (const limbKey of ['left_leg', 'right_leg', 'left_arm', 'right_arm']) {
        const v = result.limbs[limbKey];
        expect(['retry', 'ask_user']).toContain(v.verdict);
        expect(v.confidence).toBeNull();
      }
    });

    it('handles missing Phase B data for one limb', () => {
      const phaseA = makePhaseAResult();
      const phaseB = makePhaseBResult({
        left_arm: { damping: null, dampingClass: 'inconclusive', dampingFactor: null },
      });
      // Override the damping to null
      phaseB.limbs.left_arm.damping = null;

      const result = evaluateCertainty(phaseA, phaseB);

      // Left arm should be retry, others complete
      expect(result.limbs.left_arm.verdict).not.toBe('complete');
      expect(result.limbs.right_arm.verdict).toBe('complete');
    });

    it('mixed scenario: some complete, some retry, some ask_user', () => {
      const phaseA = makePhaseAResult({ left_leg: 'absent' });
      const phaseB = makePhaseBResult({
        right_leg: {
          dampingClass: 'inconclusive',
          dampingFactor: 0.42,
          evidence: ['beta_mini_squat'],
        },
        left_arm: { dampingClass: 'organic_healthy', dampingFactor: 0.06 },
        right_arm: { dampingClass: 'mechanical', dampingFactor: 0.60 },
      });

      const result = evaluateCertainty(phaseA, phaseB);

      expect(result.limbs.left_leg.verdict).toBe('complete');     // absent
      expect(result.limbs.right_leg.verdict).toBe('retry');       // inconclusive
      expect(result.limbs.left_arm.verdict).toBe('complete');     // healthy
      expect(result.limbs.right_arm.verdict).toBe('complete');    // mechanical

      expect(result.scan_status).toBe('needs_retry');
      expect(result.retries).toHaveLength(1);
    });

    it('scan_status is complete only when ALL limbs are resolved', () => {
      const phaseA = makePhaseAResult();
      const phaseB = makePhaseBResult();

      const result = evaluateCertainty(phaseA, phaseB);

      expect(result.scan_status).toBe('complete');
      for (const v of Object.values(result.limbs)) {
        expect(v.verdict).toBe('complete');
        expect(v.confidence).toBe(1.0);
      }
    });
  });


  describe('extractPassportFields()', () => {

    it('extracts correct fields for healthy limb', () => {
      const verdict = {
        verdict: 'complete',
        status: 'anatomical_healthy',
        confidence: 1.0,
        detection_method: 'damping_analysis',
        damping_factor: 0.08,
        damping_class: 'organic_healthy',
        reasoning: 'test',
      };

      const fields = extractPassportFields(verdict);

      expect(fields).not.toBeNull();
      expect(fields.status).toBe('anatomical_healthy');
      expect(fields.confidence).toBe(1.0);
      expect(fields.range_of_motion).toBe('full');
      expect(fields.stiffness_profile).toBe('organic');
    });

    it('extracts correct fields for absent limb', () => {
      const verdict = {
        verdict: 'complete',
        status: 'absent',
        confidence: 1.0,
        detection_method: 'landmark_only',
        damping_factor: null,
        damping_class: null,
        reasoning: 'test',
      };

      const fields = extractPassportFields(verdict);

      expect(fields.range_of_motion).toBe('none');
      expect(fields.stiffness_profile).toBeNull();
      expect(fields.damping_factor).toBeNull();
    });

    it('extracts correct fields for prosthetic limb', () => {
      const verdict = {
        verdict: 'complete',
        status: 'prosthetic_below_knee',
        confidence: 1.0,
        detection_method: 'damping_analysis',
        damping_factor: 0.65,
        damping_class: 'mechanical',
        reasoning: 'test',
      };

      const fields = extractPassportFields(verdict);

      expect(fields.range_of_motion).toBe('limited_mechanical');
      expect(fields.stiffness_profile).toBe('mechanical');
    });

    it('returns null for non-complete verdicts', () => {
      const verdict = {
        verdict: 'retry',
        status: 'unresolved',
        confidence: null,
      };

      expect(extractPassportFields(verdict)).toBeNull();
    });
  });
});

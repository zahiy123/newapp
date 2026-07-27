// ============================================================
// KineticAnalyzer — Unit Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  analyzeKinetics,
  inferProfileFromKinetics,
  analyzeGait,
  profileAnatomy,
  computeHipCenterDeviation,
  computeCenterOfGravity,
  computeAngle,
  computeStats,
  LIMB_KINETIC,
  PROSTHETIC_VARIANCE_THRESHOLD,
  JOINT_DEFS,
  ANATOMY,
  KNEE_FROZEN_THRESHOLD,
  KNEE_MOVING_THRESHOLD,
  ANKLE_FROZEN_THRESHOLD,
  MIN_JOINT_SAMPLES_RATIO,
  HIP_DEVIATION_THRESHOLD,
  ANKLE_KNEE_RATIO_THRESHOLD,
} from '../KineticAnalyzer.js';


// ---- Helpers ----

function createLandmarks(overrides = {}) {
  const base = [];
  for (let i = 0; i < 33; i++) {
    base.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
  }
  // Realistic positions
  base[11] = { x: 0.42, y: 0.30, z: 0, visibility: 0.95 }; // left shoulder
  base[12] = { x: 0.58, y: 0.30, z: 0, visibility: 0.95 }; // right shoulder
  base[13] = { x: 0.36, y: 0.38, z: 0, visibility: 0.95 }; // left elbow
  base[14] = { x: 0.64, y: 0.38, z: 0, visibility: 0.95 }; // right elbow
  base[15] = { x: 0.32, y: 0.48, z: 0, visibility: 0.95 }; // left wrist
  base[16] = { x: 0.68, y: 0.48, z: 0, visibility: 0.95 }; // right wrist
  base[23] = { x: 0.44, y: 0.55, z: 0, visibility: 0.95 }; // left hip
  base[24] = { x: 0.56, y: 0.55, z: 0, visibility: 0.95 }; // right hip
  base[25] = { x: 0.43, y: 0.72, z: 0, visibility: 0.95 }; // left knee
  base[26] = { x: 0.57, y: 0.72, z: 0, visibility: 0.95 }; // right knee
  base[27] = { x: 0.42, y: 0.88, z: 0, visibility: 0.95 }; // left ankle
  base[28] = { x: 0.58, y: 0.88, z: 0, visibility: 0.95 }; // right ankle
  base[29] = { x: 0.42, y: 0.92, z: 0, visibility: 0.95 }; // left heel
  base[30] = { x: 0.58, y: 0.92, z: 0, visibility: 0.95 }; // right heel

  for (const [idx, lm] of Object.entries(overrides)) {
    base[Number(idx)] = { ...base[Number(idx)], ...lm };
  }
  return base;
}

/**
 * Create N frames with micro-sway (natural movement).
 */
function createNaturalFrames(count = 60) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    const sway = Math.sin(i * 0.3) * 0.02;
    // Heel sway out of phase — simulates natural ankle dorsiflexion/plantarflexion
    const heelSway = Math.sin(i * 0.3 + 1.0) * 0.015;
    frames.push(createLandmarks({
      25: { x: 0.43 + sway, y: 0.72 + sway * 0.5, z: 0, visibility: 0.95 },
      26: { x: 0.57 - sway, y: 0.72 + sway * 0.5, z: 0, visibility: 0.95 },
      27: { x: 0.42 + sway, y: 0.88 + sway * 1.0, z: 0, visibility: 0.95 },
      28: { x: 0.58 - sway, y: 0.88 + sway * 1.0, z: 0, visibility: 0.95 },
      // Heels: independent sway (out of phase) creates ankle angle variation
      29: { x: 0.42 + heelSway, y: 0.92 + heelSway * 1.5, z: 0, visibility: 0.95 },
      30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 1.5, z: 0, visibility: 0.95 },
      13: { x: 0.36 + sway, y: 0.38 + sway * 0.3, z: 0, visibility: 0.95 },
      14: { x: 0.64 - sway, y: 0.38 + sway * 0.3, z: 0, visibility: 0.95 },
      15: { x: 0.32 + sway * 1.2, y: 0.48 + sway * 0.4, z: 0, visibility: 0.95 },
      16: { x: 0.68 - sway * 1.2, y: 0.48 + sway * 0.4, z: 0, visibility: 0.95 },
    }));
  }
  return frames;
}

/**
 * Create N frames with one rigid limb (prosthetic-like).
 * Left knee has zero variance.
 */
function createRigidLeftLegFrames(count = 60) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    const sway = Math.sin(i * 0.3) * 0.02;
    const heelSway = Math.sin(i * 0.3 + 1.0) * 0.015;
    frames.push(createLandmarks({
      // Left leg: completely rigid (no sway) — including heel
      25: { x: 0.43, y: 0.72, z: 0, visibility: 0.95 },
      27: { x: 0.42, y: 0.88, z: 0, visibility: 0.95 },
      29: { x: 0.42, y: 0.92, z: 0, visibility: 0.95 },
      // Right leg: natural sway — heel independent for ankle angle variance
      26: { x: 0.57 - sway, y: 0.72 + sway * 0.5, z: 0, visibility: 0.95 },
      28: { x: 0.58 - sway, y: 0.88 + sway * 1.0, z: 0, visibility: 0.95 },
      30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 0.5, z: 0, visibility: 0.95 },
      // Arms: natural sway
      13: { x: 0.36 + sway, y: 0.38 + sway * 0.3, z: 0, visibility: 0.95 },
      14: { x: 0.64 - sway, y: 0.38 + sway * 0.3, z: 0, visibility: 0.95 },
      15: { x: 0.32 + sway * 1.2, y: 0.48 + sway * 0.4, z: 0, visibility: 0.95 },
      16: { x: 0.68 - sway * 1.2, y: 0.48 + sway * 0.4, z: 0, visibility: 0.95 },
    }));
  }
  return frames;
}


// ============================================================
// Tests
// ============================================================

describe('KineticAnalyzer', () => {

  describe('computeAngle', () => {

    it('returns 180 for collinear points', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 0.5, y: 0 };
      const c = { x: 1, y: 0 };
      const angle = computeAngle(a, b, c);
      expect(angle).toBeCloseTo(180, 0);
    });

    it('returns 90 for perpendicular points', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 0, y: 1 };
      const c = { x: 1, y: 1 };
      const angle = computeAngle(a, b, c);
      expect(angle).toBeCloseTo(90, 0);
    });

    it('returns 0 for coincident points', () => {
      const a = { x: 1, y: 0 };
      const b = { x: 0, y: 0 };
      const c = { x: 0, y: 0 };
      const angle = computeAngle(a, b, c);
      expect(angle).toBe(0);
    });
  });


  describe('computeStats', () => {

    it('returns zeros for empty array', () => {
      const stats = computeStats([]);
      expect(stats.mean).toBe(0);
      expect(stats.variance).toBe(0);
    });

    it('computes correct mean and variance', () => {
      const stats = computeStats([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(stats.mean).toBe(5);
      expect(stats.variance).toBe(4);
      expect(stats.stdDev).toBe(2);
    });
  });


  describe('analyzeKinetics', () => {

    it('returns insufficient for empty frames', () => {
      const result = analyzeKinetics([]);
      expect(result.overallPosture).toBe('insufficient');
      expect(result.detectedProsthetics).toHaveLength(0);
    });

    it('returns insufficient for null frames', () => {
      const result = analyzeKinetics(null);
      expect(result.overallPosture).toBe('insufficient');
    });

    it('classifies natural movement correctly', () => {
      const frames = createNaturalFrames(60);
      const result = analyzeKinetics(frames);

      expect(result.overallPosture).toBe('natural');
      expect(result.detectedProsthetics).toHaveLength(0);
      expect(result.totalFramesAnalyzed).toBe(60);

      // All limbs should be natural
      for (const [, limb] of Object.entries(result.limbs)) {
        expect(limb.classification).toBe(LIMB_KINETIC.NATURAL);
      }
    });

    it('detects rigid limb as prosthetic', () => {
      const frames = createRigidLeftLegFrames(60);
      const result = analyzeKinetics(frames);

      expect(result.overallPosture).toBe('prosthetic_detected');
      expect(result.detectedProsthetics).toContain('left_leg');
      expect(result.limbs.left_leg.classification).toBe(LIMB_KINETIC.RIGID);
      // Other limbs should be natural
      expect(result.limbs.right_leg.classification).toBe(LIMB_KINETIC.NATURAL);
    });

    it('returns insufficient for too few frames', () => {
      const frames = createNaturalFrames(10); // Less than MIN_SAMPLES_FOR_ANALYSIS
      const result = analyzeKinetics(frames);

      expect(result.overallPosture).toBe('insufficient');
    });

    it('includes joint statistics', () => {
      const frames = createNaturalFrames(60);
      const result = analyzeKinetics(frames);

      expect(result.joints.left_knee).toBeDefined();
      expect(result.joints.right_knee).toBeDefined();
      expect(result.joints.left_elbow).toBeDefined();
      expect(result.joints.right_elbow).toBeDefined();

      expect(result.joints.left_knee.sampleCount).toBeGreaterThan(0);
      expect(result.joints.left_knee.meanAngle).toBeGreaterThan(0);
      expect(typeof result.joints.left_knee.variance).toBe('number');
    });
  });


  describe('inferProfileFromKinetics', () => {

    it('returns none disability for natural movement', () => {
      const kineticProfile = {
        overallPosture: 'natural',
        detectedProsthetics: [],
      };
      const result = inferProfileFromKinetics(kineticProfile, null);
      expect(result.disability).toBe('none');
    });

    it('infers one_leg for single rigid leg', () => {
      const kineticProfile = {
        overallPosture: 'prosthetic_detected',
        detectedProsthetics: ['left_leg'],
      };
      const result = inferProfileFromKinetics(kineticProfile, null);
      expect(result.disability).toBe('one_leg');
      expect(result.amputationSide).toBe('left');
      expect(result.mobilityAid).toBe('prosthesis');
    });

    it('infers two_legs for two rigid legs', () => {
      const kineticProfile = {
        overallPosture: 'prosthetic_detected',
        detectedProsthetics: ['left_leg', 'right_leg'],
      };
      const result = inferProfileFromKinetics(kineticProfile, null);
      expect(result.disability).toBe('two_legs');
    });

    it('infers one_arm for single rigid arm', () => {
      const kineticProfile = {
        overallPosture: 'prosthetic_detected',
        detectedProsthetics: ['right_arm'],
      };
      const result = inferProfileFromKinetics(kineticProfile, null);
      expect(result.disability).toBe('one_arm');
      expect(result.amputationSide).toBe('right');
    });

    it('uses posture detection for wheelchair', () => {
      const postureDecision = {
        posture: 'wheelchair',
        detectedAids: { wheelchair: true },
      };
      const result = inferProfileFromKinetics(null, postureDecision);
      expect(result.disability).toBe('wheelchair');
      expect(result.mobilityAid).toBe('wheelchair');
    });

    it('uses posture detection for crutches', () => {
      const postureDecision = {
        posture: 'crutches',
        detectedAids: { crutches: true },
      };
      const kineticProfile = {
        overallPosture: 'natural',
        detectedProsthetics: [],
      };
      const result = inferProfileFromKinetics(kineticProfile, postureDecision);
      expect(result.mobilityAid).toBe('crutches');
    });

    it('returns none disability for insufficient kinetic data', () => {
      const kineticProfile = {
        overallPosture: 'insufficient',
        detectedProsthetics: [],
      };
      const result = inferProfileFromKinetics(kineticProfile, null);
      expect(result.disability).toBe('none');
    });
  });


  describe('analyzeGait', () => {

    /**
     * Create gait frames simulating march-in-place.
     * Left/right ankles oscillate vertically in anti-phase.
     * @param {number} count - Number of frames
     * @param {number} leftAmp - Left ankle Y amplitude
     * @param {number} rightAmp - Right ankle Y amplitude
     */
    function createGaitFrames(count, leftAmp = 0.03, rightAmp = 0.03) {
      const frames = [];
      for (let i = 0; i < count; i++) {
        const base = createLandmarks();
        // Oscillate ankles in anti-phase to simulate stepping
        base[27] = {
          x: 0.42, y: 0.88 + Math.sin(i * 0.5) * leftAmp,
          z: 0, visibility: 0.95,
        };
        base[28] = {
          x: 0.58, y: 0.88 + Math.sin(i * 0.5 + Math.PI) * rightAmp,
          z: 0, visibility: 0.95,
        };
        frames.push(base);
      }
      return frames;
    }

    it('returns insufficient for too few frames', () => {
      const frames = createGaitFrames(10);
      const result = analyzeGait(frames);
      expect(result.status).toBe('insufficient');
      expect(result.symmetryRatio).toBeNull();
      expect(result.stepFrequency).toBeNull();
    });

    it('returns insufficient for null frames', () => {
      const result = analyzeGait(null);
      expect(result.status).toBe('insufficient');
    });

    it('detects symmetric gait as natural', () => {
      // Both ankles oscillate with equal amplitude
      const frames = createGaitFrames(60, 0.03, 0.03);
      const result = analyzeGait(frames, 30);

      expect(result.status).toBe('natural');
      expect(result.symmetryRatio).toBeGreaterThanOrEqual(0.7);
      expect(result.weakerSide).toBeNull();
      expect(result.totalSteps).toBeGreaterThan(0);
      expect(result.stepFrequency).toBeGreaterThan(0);
    });

    it('detects asymmetric gait (prosthetic)', () => {
      // Left ankle barely moves, right oscillates normally
      const frames = createGaitFrames(60, 0.002, 0.04);
      const result = analyzeGait(frames, 30);

      expect(result.status).toBe('asymmetric');
      expect(result.symmetryRatio).toBeLessThan(0.7);
      expect(result.weakerSide).toBe('left');
    });

    it('reports weaker side correctly for right weakness', () => {
      const frames = createGaitFrames(60, 0.04, 0.002);
      const result = analyzeGait(frames, 30);

      expect(result.status).toBe('asymmetric');
      expect(result.weakerSide).toBe('right');
    });

    it('returns amplitude values for both ankles', () => {
      const frames = createGaitFrames(60, 0.03, 0.03);
      const result = analyzeGait(frames, 30);

      expect(result.leftAmplitude).toBeGreaterThan(0);
      expect(result.rightAmplitude).toBeGreaterThan(0);
    });

    it('returns insufficient when ankle visibility is too low', () => {
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const lm = createLandmarks();
        // Set ankles to low visibility
        lm[27] = { x: 0.42, y: 0.88, z: 0, visibility: 0.1 };
        lm[28] = { x: 0.58, y: 0.88, z: 0, visibility: 0.1 };
        frames.push(lm);
      }
      const result = analyzeGait(frames, 30);
      expect(result.status).toBe('insufficient');
    });
  });


  describe('profileAnatomy', () => {

    it('returns INSUFFICIENT for null/empty frames', () => {
      expect(profileAnatomy(null).classification).toBe(ANATOMY.INSUFFICIENT);
      expect(profileAnatomy([]).classification).toBe(ANATOMY.INSUFFICIENT);
    });

    it('returns INSUFFICIENT for too few frames', () => {
      const frames = createNaturalFrames(10);
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.INSUFFICIENT);
      expect(result.affectedLimbs).toHaveLength(0);
    });

    it('classifies natural standing posture correctly', () => {
      const frames = createNaturalFrames(60);
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.NATURAL);
      expect(result.adaptedTrack).toBeNull();
      expect(result.affectedSide).toBeNull();
      expect(result.affectedLimbs).toHaveLength(0);
      expect(result.legs.left.classification).toBe(ANATOMY.NATURAL);
      expect(result.legs.right.classification).toBe(ANATOMY.NATURAL);
    });

    it('classifies TRANSFEMORAL: left knee+ankle frozen, right moves', () => {
      // Left: knee+ankle+heel completely frozen. Right: natural sway.
      // Comparative: left total variance < right → left is prosthetic
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.04;
        const heelSway = Math.sin(i * 0.3 + 1.0) * 0.03;
        frames.push(createLandmarks({
          // Left: frozen knee, ankle, and heel
          23: { x: 0.44, y: 0.55 + sway, z: 0, visibility: 0.95 },
          25: { x: 0.44, y: 0.72, z: 0, visibility: 0.95 },
          27: { x: 0.44, y: 0.88, z: 0, visibility: 0.95 },
          29: { x: 0.44, y: 0.92, z: 0, visibility: 0.95 },
          // Right: natural sway (heel independent for ankle angle variance)
          24: { x: 0.56, y: 0.55 + sway, z: 0, visibility: 0.95 },
          26: { x: 0.57 - sway * 0.5, y: 0.72 + sway * 0.8, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway * 0.3, y: 0.88 + sway * 0.5, z: 0, visibility: 0.95 },
          30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 0.8, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.TRANSFEMORAL);
      expect(result.adaptedTrack).toBe('TRANSFEMORAL_AMPUTEE');
      expect(result.affectedSide).toBe('left');
      expect(result.affectedLimbs).toContain('left_leg');
      expect(result.legs.left.classification).toBe(ANATOMY.TRANSFEMORAL);
      expect(result.legs.right.classification).toBe(ANATOMY.NATURAL);
    });

    it('detects right side prosthetic via comparative variance', () => {
      // Right: frozen. Left: natural.
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.04;
        const heelSway = Math.sin(i * 0.3 + 1.0) * 0.03;
        frames.push(createLandmarks({
          // Left: natural (heel independent for ankle angle variance)
          23: { x: 0.44, y: 0.55 + sway, z: 0, visibility: 0.95 },
          25: { x: 0.43 + sway * 0.5, y: 0.72 + sway * 0.8, z: 0, visibility: 0.95 },
          27: { x: 0.42 + sway * 0.3, y: 0.88 + sway * 0.5, z: 0, visibility: 0.95 },
          29: { x: 0.42 + heelSway, y: 0.92 + heelSway * 0.8, z: 0, visibility: 0.95 },
          // Right: frozen (including heel)
          24: { x: 0.56, y: 0.55 + sway, z: 0, visibility: 0.95 },
          26: { x: 0.56, y: 0.72, z: 0, visibility: 0.95 },
          28: { x: 0.56, y: 0.88, z: 0, visibility: 0.95 },
          30: { x: 0.56, y: 0.92, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.TRANSFEMORAL);
      expect(result.affectedSide).toBe('right');
      expect(result.affectedLimbs).toContain('right_leg');
    });

    it('classifies TRANSTIBIAL: knee moves (>0.5) but ankle frozen (<0.1)', () => {
      // Left: knee has variance > 0.5 but ankle+heel frozen. Right: natural.
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.04;
        const heelSway = Math.sin(i * 0.3 + 1.0) * 0.03;
        frames.push(createLandmarks({
          // Left hip moves
          23: { x: 0.44, y: 0.55 + sway, z: 0, visibility: 0.95 },
          // Left knee moves significantly (large sway → variance > 0.5)
          25: { x: 0.43 + sway * 0.8, y: 0.72 + sway * 1.5, z: 0, visibility: 0.95 },
          // Left ankle+heel: frozen (prosthetic below knee)
          27: { x: 0.42, y: 0.88, z: 0, visibility: 0.95 },
          29: { x: 0.42, y: 0.92, z: 0, visibility: 0.95 },
          // Right side: full natural movement (heel independent for ankle angle)
          24: { x: 0.56, y: 0.55 + sway, z: 0, visibility: 0.95 },
          26: { x: 0.57 - sway * 0.5, y: 0.72 + sway * 0.8, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway * 0.3, y: 0.88 + sway * 0.5, z: 0, visibility: 0.95 },
          30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 0.8, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.TRANSTIBIAL);
      expect(result.adaptedTrack).toBe('TRANSTIBIAL_AMPUTEE');
      expect(result.affectedSide).toBe('left');
      expect(result.affectedLimbs).toContain('left_leg');
      expect(result.legs.left.classification).toBe(ANATOMY.TRANSTIBIAL);
    });

    it('classifies ARM_AMPUTEE when arm landmarks invisible', () => {
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.02;
        const heelSway = Math.sin(i * 0.3 + 1.0) * 0.015;
        frames.push(createLandmarks({
          // Left arm invisible
          13: { x: 0.36, y: 0.38, z: 0, visibility: 0.05 },
          15: { x: 0.32, y: 0.48, z: 0, visibility: 0.05 },
          // Legs fully natural — both move symmetrically (including heels with independent sway)
          25: { x: 0.43 + sway, y: 0.72 + sway * 0.5, z: 0, visibility: 0.95 },
          26: { x: 0.57 - sway, y: 0.72 + sway * 0.5, z: 0, visibility: 0.95 },
          27: { x: 0.42 + sway, y: 0.88 + sway * 1.0, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway, y: 0.88 + sway * 1.0, z: 0, visibility: 0.95 },
          29: { x: 0.42 + heelSway, y: 0.92 + heelSway * 1.5, z: 0, visibility: 0.95 },
          30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 1.5, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.ARM_AMPUTEE);
      expect(result.adaptedTrack).toBe('ARM_AMPUTEE');
      expect(result.affectedLimbs).toContain('left_arm');
      expect(result.arms.left.classification).toBe(ANATOMY.ARM_AMPUTEE);
      expect(result.arms.right.classification).toBe(ANATOMY.NATURAL);
    });

    it('hip joint definitions are correct in JOINT_DEFS', () => {
      expect(JOINT_DEFS.left_hip).toBeDefined();
      expect(JOINT_DEFS.right_hip).toBeDefined();
      expect(JOINT_DEFS.left_hip).toEqual([11, 23, 25]); // shoulder, hip, knee
      expect(JOINT_DEFS.right_hip).toEqual([12, 24, 26]);
    });

    it('includes per-leg variance data', () => {
      const frames = createNaturalFrames(60);
      const result = profileAnatomy(frames);
      expect(typeof result.legs.left.hipVariance).toBe('number');
      expect(typeof result.legs.left.kneeVariance).toBe('number');
      expect(typeof result.legs.left.ankleVariance).toBe('number');
      expect(typeof result.legs.right.hipVariance).toBe('number');
    });

    it('thresholds match expected values', () => {
      expect(KNEE_FROZEN_THRESHOLD).toBe(0.1);
      expect(KNEE_MOVING_THRESHOLD).toBe(0.5);
      expect(ANKLE_FROZEN_THRESHOLD).toBe(0.00005);
    });

    it('affectedSide is null for symmetric natural posture', () => {
      const frames = createNaturalFrames(60);
      const result = profileAnatomy(frames);
      expect(result.affectedSide).toBeNull();
    });

    // ── Bilateral detection ──

    it('bilateral: both knees and ankles frozen → BILATERAL', () => {
      // Both legs completely frozen (no sway on any leg landmark)
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.02;
        frames.push(createLandmarks({
          // Both legs frozen (no variance)
          25: { x: 0.43, y: 0.72, z: 0, visibility: 0.95 },
          26: { x: 0.57, y: 0.72, z: 0, visibility: 0.95 },
          27: { x: 0.42, y: 0.88, z: 0, visibility: 0.95 },
          28: { x: 0.58, y: 0.88, z: 0, visibility: 0.95 },
          29: { x: 0.42, y: 0.92, z: 0, visibility: 0.95 },
          30: { x: 0.58, y: 0.92, z: 0, visibility: 0.95 },
          // Arms: natural sway
          13: { x: 0.36 + sway, y: 0.38 + sway * 0.3, z: 0, visibility: 0.95 },
          14: { x: 0.64 - sway, y: 0.38 + sway * 0.3, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.BILATERAL);
      expect(result.adaptedTrack).toBe('BILATERAL_AMPUTEE');
      expect(result.affectedSide).toBe('both');
      expect(result.affectedLimbs).toContain('left_leg');
      expect(result.affectedLimbs).toContain('right_leg');
      expect(result.legs.left.classification).toBe(ANATOMY.TRANSFEMORAL);
      expect(result.legs.right.classification).toBe(ANATOMY.TRANSFEMORAL);
    });

    it('bilateral: arm analysis still runs', () => {
      // Both legs frozen + left arm invisible
      const frames = [];
      for (let i = 0; i < 60; i++) {
        frames.push(createLandmarks({
          25: { x: 0.43, y: 0.72, z: 0, visibility: 0.95 },
          26: { x: 0.57, y: 0.72, z: 0, visibility: 0.95 },
          27: { x: 0.42, y: 0.88, z: 0, visibility: 0.95 },
          28: { x: 0.58, y: 0.88, z: 0, visibility: 0.95 },
          29: { x: 0.42, y: 0.92, z: 0, visibility: 0.95 },
          30: { x: 0.58, y: 0.92, z: 0, visibility: 0.95 },
          13: { x: 0.36, y: 0.38, z: 0, visibility: 0.05 },
          15: { x: 0.32, y: 0.48, z: 0, visibility: 0.05 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.BILATERAL);
      expect(result.adaptedTrack).toBe('BILATERAL_AMPUTEE');
      expect(result.affectedLimbs).toContain('left_leg');
      expect(result.affectedLimbs).toContain('right_leg');
      expect(result.affectedLimbs).toContain('left_arm');
      expect(result.arms.left.classification).toBe(ANATOMY.ARM_AMPUTEE);
    });

    it('bilateral: NOT triggered when only one side frozen', () => {
      // Left frozen, right natural → unilateral (TRANSFEMORAL), not bilateral
      const frames = createRigidLeftLegFrames(60);
      const result = profileAnatomy(frames);
      expect(result.classification).not.toBe(ANATOMY.BILATERAL);
      expect(result.adaptedTrack).not.toBe('BILATERAL_AMPUTEE');
    });

    // ── Visibility guard (UNTRACKED) ──

    it('UNTRACKED: returns NATURAL when ankle not visible', () => {
      // Left ankle invisible → system must NOT classify as frozen/prosthetic
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.02;
        frames.push(createLandmarks({
          // Both legs have natural sway on knee
          25: { x: 0.43 + sway, y: 0.72 + sway * 0.5, z: 0, visibility: 0.95 },
          26: { x: 0.57 - sway, y: 0.72 + sway * 0.5, z: 0, visibility: 0.95 },
          // Left ankle: INVISIBLE (visibility below 0.3)
          27: { x: 0.42, y: 0.88, z: 0, visibility: 0.1 },
          // Right ankle: visible and moving
          28: { x: 0.58 - sway, y: 0.88 + sway * 1.0, z: 0, visibility: 0.95 },
          29: { x: 0.42, y: 0.92, z: 0, visibility: 0.1 },
          30: { x: 0.58 - sway, y: 0.92 + sway, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      // Must NOT classify as prosthetic — ankle was not visible
      expect(result.classification).toBe(ANATOMY.NATURAL);
      expect(result.adaptedTrack).toBeNull();
      expect(result.untrackedJoints).toContain('left_ankle');
    });

    it('UNTRACKED: returns NATURAL when knee not visible', () => {
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.02;
        frames.push(createLandmarks({
          // Left knee invisible
          25: { x: 0.43, y: 0.72, z: 0, visibility: 0.1 },
          // Right knee visible and moving
          26: { x: 0.57 - sway, y: 0.72 + sway * 0.5, z: 0, visibility: 0.95 },
          27: { x: 0.42 + sway, y: 0.88 + sway, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway, y: 0.88 + sway, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.NATURAL);
      expect(result.untrackedJoints).toContain('left_knee');
    });

    it('untrackedJoints is empty when all joints visible', () => {
      const frames = createNaturalFrames(60);
      const result = profileAnatomy(frames);
      expect(result.untrackedJoints).toHaveLength(0);
    });

    it('sample counts are reported per leg', () => {
      const frames = createNaturalFrames(60);
      const result = profileAnatomy(frames);
      expect(result.legs.left.kneeSampleCount).toBeGreaterThan(0);
      expect(result.legs.left.ankleSampleCount).toBeGreaterThan(0);
      expect(result.legs.right.kneeSampleCount).toBeGreaterThan(0);
      expect(result.legs.right.ankleSampleCount).toBeGreaterThan(0);
    });

    // ── Hip-center deviation ──

    it('hip center deviation: detects left prosthetic from positive deviation', () => {
      // Simulate: hips shifted RIGHT of nose → prosthetic is LEFT
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.02;
        frames.push(createLandmarks({
          // Nose centered
          0: { x: 0.50, y: 0.15, z: 0, visibility: 0.95 },
          // Hips shifted RIGHT (toward healthy right leg)
          23: { x: 0.47, y: 0.55, z: 0, visibility: 0.95 },
          24: { x: 0.59, y: 0.55, z: 0, visibility: 0.95 },
          // Left knee+ankle frozen (prosthetic)
          25: { x: 0.44, y: 0.72, z: 0, visibility: 0.95 },
          27: { x: 0.44, y: 0.88, z: 0, visibility: 0.95 },
          29: { x: 0.44, y: 0.92, z: 0, visibility: 0.95 },
          // Right knee+ankle moving (healthy)
          26: { x: 0.57 - sway, y: 0.72 + sway * 0.5, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway, y: 0.88 + sway * 1.0, z: 0, visibility: 0.95 },
          30: { x: 0.58 - sway, y: 0.92 + sway, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.affectedSide).toBe('left');
    });

    it('hip center deviation: detects right prosthetic from negative deviation', () => {
      // Hips shifted LEFT of nose → prosthetic is RIGHT
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.02;
        frames.push(createLandmarks({
          0: { x: 0.50, y: 0.15, z: 0, visibility: 0.95 },
          // Hips shifted LEFT
          23: { x: 0.41, y: 0.55, z: 0, visibility: 0.95 },
          24: { x: 0.53, y: 0.55, z: 0, visibility: 0.95 },
          // Left knee+ankle moving (healthy)
          25: { x: 0.43 + sway, y: 0.72 + sway * 0.5, z: 0, visibility: 0.95 },
          27: { x: 0.42 + sway, y: 0.88 + sway * 1.0, z: 0, visibility: 0.95 },
          29: { x: 0.42 + sway, y: 0.92 + sway, z: 0, visibility: 0.95 },
          // Right knee+ankle frozen (prosthetic)
          26: { x: 0.56, y: 0.72, z: 0, visibility: 0.95 },
          28: { x: 0.56, y: 0.88, z: 0, visibility: 0.95 },
          30: { x: 0.56, y: 0.92, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.affectedSide).toBe('right');
    });

    it('hip center deviation overrides wrong frozen-joint side', () => {
      // Frozen joints suggest RIGHT (right frozen), but hip deviation says LEFT
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.02;
        frames.push(createLandmarks({
          0: { x: 0.50, y: 0.15, z: 0, visibility: 0.95 },
          // Hips shifted RIGHT → prosthetic should be LEFT
          23: { x: 0.47, y: 0.55, z: 0, visibility: 0.95 },
          24: { x: 0.59, y: 0.55, z: 0, visibility: 0.95 },
          // Left knee+ankle frozen
          25: { x: 0.44, y: 0.72, z: 0, visibility: 0.95 },
          27: { x: 0.44, y: 0.88, z: 0, visibility: 0.95 },
          29: { x: 0.44, y: 0.92, z: 0, visibility: 0.95 },
          // Right knee+ankle also frozen (to force wrong side via asymmetric count)
          // Actually: to test override, make right ALSO frozen but left has MORE frozen joints
          // Simpler: right ankle frozen too → both ankles frozen → asymmetric says "right knee frozen"
          26: { x: 0.57 - sway, y: 0.72 + sway * 0.5, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway, y: 0.88 + sway * 1.0, z: 0, visibility: 0.95 },
          30: { x: 0.58 - sway, y: 0.92 + sway, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      // Hip deviation (positive = hips right) should confirm LEFT side
      expect(result.affectedSide).toBe('left');
    });

    it('computeHipCenterDeviation returns null when nose not visible', () => {
      const frames = [];
      for (let i = 0; i < 60; i++) {
        frames.push(createLandmarks({
          0: { x: 0.50, y: 0.15, z: 0, visibility: 0.1 }, // nose not visible
        }));
      }
      expect(computeHipCenterDeviation(frames)).toBeNull();
    });

    it('MIN_JOINT_SAMPLES_RATIO is 0.5', () => {
      expect(MIN_JOINT_SAMPLES_RATIO).toBe(0.5);
    });

    it('HIP_DEVIATION_THRESHOLD is 0.015', () => {
      expect(HIP_DEVIATION_THRESHOLD).toBe(0.015);
    });

    it('ANKLE_KNEE_RATIO_THRESHOLD is 0.1', () => {
      expect(ANKLE_KNEE_RATIO_THRESHOLD).toBe(0.1);
    });
  });

  describe('Hierarchical depth diagnosis', () => {
    it('knee frozen → TRANSFEMORAL regardless of ankle state', () => {
      // Left knee frozen (variance near 0), ankle has SOME movement
      // Hierarchical: knee frozen = above-knee, don't even check ankle
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.04;
        const heelSway = Math.sin(i * 0.3 + 1.0) * 0.03;
        frames.push(createLandmarks({
          // Left: knee frozen, but ankle has tiny movement (irrelevant)
          23: { x: 0.44, y: 0.55 + sway, z: 0, visibility: 0.95 },
          25: { x: 0.44, y: 0.72, z: 0, visibility: 0.95 },       // frozen knee
          27: { x: 0.44, y: 0.88 + sway * 0.01, z: 0, visibility: 0.95 }, // tiny ankle move
          29: { x: 0.44, y: 0.92 + sway * 0.01, z: 0, visibility: 0.95 },
          // Right: natural sway
          24: { x: 0.56, y: 0.55 + sway, z: 0, visibility: 0.95 },
          26: { x: 0.57 - sway * 0.5, y: 0.72 + sway * 0.8, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway * 0.3, y: 0.88 + sway * 0.5, z: 0, visibility: 0.95 },
          30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 0.8, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.TRANSFEMORAL);
      expect(result.adaptedTrack).toBe('TRANSFEMORAL_AMPUTEE');
      expect(result.affectedSide).toBe('left');
    });

    it('knee in gap zone (0.1–0.5) with frozen ankle → TRANSTIBIAL', () => {
      // Left knee has moderate movement (variance ~0.2, between 0.1 and 0.5)
      // Left ankle frozen → should now classify as TRANSTIBIAL (closes the gap)
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.04;
        const heelSway = Math.sin(i * 0.3 + 1.0) * 0.03;
        frames.push(createLandmarks({
          // Left: hip moves, knee has moderate movement
          23: { x: 0.44, y: 0.55 + sway, z: 0, visibility: 0.95 },
          25: { x: 0.43 + sway * 0.4, y: 0.72 + sway * 0.6, z: 0, visibility: 0.95 },
          // Left ankle: frozen (prosthetic below knee)
          27: { x: 0.42, y: 0.88, z: 0, visibility: 0.95 },
          29: { x: 0.42, y: 0.92, z: 0, visibility: 0.95 },
          // Right: full natural movement
          24: { x: 0.56, y: 0.55 + sway, z: 0, visibility: 0.95 },
          26: { x: 0.57 - sway * 0.5, y: 0.72 + sway * 0.8, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway * 0.3, y: 0.88 + sway * 0.5, z: 0, visibility: 0.95 },
          30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 0.8, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.TRANSTIBIAL);
      expect(result.adaptedTrack).toBe('TRANSTIBIAL_AMPUTEE');
      expect(result.affectedSide).toBe('left');
    });

    it('relative ratio: ankle slightly moves but ratio < 0.1 → TRANSTIBIAL', () => {
      // Left knee moves significantly, left ankle has tiny movement
      // ankle/knee ratio < 0.1 → classified as TRANSTIBIAL via relative check
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.04;
        const heelSway = Math.sin(i * 0.3 + 1.0) * 0.03;
        frames.push(createLandmarks({
          // Left: knee moves significantly
          23: { x: 0.44, y: 0.55 + sway, z: 0, visibility: 0.95 },
          25: { x: 0.43 + sway * 0.8, y: 0.72 + sway * 1.5, z: 0, visibility: 0.95 },
          // Left ankle: very tiny movement (above absolute threshold but ratio < 0.1)
          27: { x: 0.42, y: 0.88 + sway * 0.002, z: 0, visibility: 0.95 },
          29: { x: 0.42, y: 0.92 + sway * 0.002, z: 0, visibility: 0.95 },
          // Right: natural
          24: { x: 0.56, y: 0.55 + sway, z: 0, visibility: 0.95 },
          26: { x: 0.57 - sway * 0.5, y: 0.72 + sway * 0.8, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway * 0.3, y: 0.88 + sway * 0.5, z: 0, visibility: 0.95 },
          30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 0.8, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.TRANSTIBIAL);
      expect(result.adaptedTrack).toBe('TRANSTIBIAL_AMPUTEE');
      expect(result.depthConfirmation).toBe('ankle_frozen_relative_to_knee');
    });

    it('relative ratio: ankle moves proportionally → no prosthetic classification', () => {
      // Both sides have similar movement patterns → NATURAL
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.04;
        const heelSway = Math.sin(i * 0.3 + 1.0) * 0.03;
        frames.push(createLandmarks({
          // Left: knee and ankle both move proportionally
          23: { x: 0.44, y: 0.55 + sway, z: 0, visibility: 0.95 },
          25: { x: 0.43 + sway * 0.5, y: 0.72 + sway * 0.8, z: 0, visibility: 0.95 },
          27: { x: 0.42 + sway * 0.3, y: 0.88 + sway * 0.5, z: 0, visibility: 0.95 },
          29: { x: 0.42 + heelSway, y: 0.92 + heelSway * 0.8, z: 0, visibility: 0.95 },
          // Right: similar movement
          24: { x: 0.56, y: 0.55 + sway, z: 0, visibility: 0.95 },
          26: { x: 0.57 - sway * 0.5, y: 0.72 + sway * 0.8, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway * 0.3, y: 0.88 + sway * 0.5, z: 0, visibility: 0.95 },
          30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 0.8, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.NATURAL);
      expect(result.adaptedTrack).toBeNull();
    });

    it('depthConfirmation field set for TRANSTIBIAL', () => {
      // Standard TRANSTIBIAL case — verify depthConfirmation is set
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.04;
        const heelSway = Math.sin(i * 0.3 + 1.0) * 0.03;
        frames.push(createLandmarks({
          23: { x: 0.44, y: 0.55 + sway, z: 0, visibility: 0.95 },
          25: { x: 0.43 + sway * 0.8, y: 0.72 + sway * 1.5, z: 0, visibility: 0.95 },
          27: { x: 0.42, y: 0.88, z: 0, visibility: 0.95 },
          29: { x: 0.42, y: 0.92, z: 0, visibility: 0.95 },
          24: { x: 0.56, y: 0.55 + sway, z: 0, visibility: 0.95 },
          26: { x: 0.57 - sway * 0.5, y: 0.72 + sway * 0.8, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway * 0.3, y: 0.88 + sway * 0.5, z: 0, visibility: 0.95 },
          30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 0.8, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames);
      expect(result.classification).toBe(ANATOMY.TRANSTIBIAL);
      expect(result.depthConfirmation).toBe('ankle_frozen_relative_to_knee');
    });
  });

  describe('Integrative analysis', () => {
    // Helper: create frames with all 3 signals for left prosthetic (TRANSFEMORAL)
    // Left hip is ALSO frozen so that knee angle has zero variance
    function createIntegrativeFrames() {
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.04;
        const heelSway = Math.sin(i * 0.3 + 1.0) * 0.03;
        frames.push(createLandmarks({
          // Nose centered
          0: { x: 0.50, y: 0.15, z: 0, visibility: 0.95 },
          // Shoulders+Hips shifted RIGHT → CoG bias right, hip deviation positive → left prosthetic
          11: { x: 0.45, y: 0.30, z: 0, visibility: 0.95 }, // left shoulder
          12: { x: 0.57, y: 0.30, z: 0, visibility: 0.95 }, // right shoulder
          23: { x: 0.47, y: 0.55, z: 0, visibility: 0.95 }, // left hip FROZEN
          24: { x: 0.59, y: 0.55 + sway, z: 0, visibility: 0.95 }, // right hip moves
          // Left: hip+knee+ankle all frozen (TRANSFEMORAL)
          25: { x: 0.44, y: 0.72, z: 0, visibility: 0.95 },
          27: { x: 0.44, y: 0.88, z: 0, visibility: 0.95 },
          29: { x: 0.44, y: 0.92, z: 0, visibility: 0.95 },
          // Right: natural sway (healthy)
          26: { x: 0.57 - sway * 0.5, y: 0.72 + sway * 0.8, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway * 0.3, y: 0.88 + sway * 0.5, z: 0, visibility: 0.95 },
          30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 0.8, z: 0, visibility: 0.95 },
        }));
      }
      return frames;
    }

    it('requires all 3 signals to confirm prosthetic (all present → passes)', () => {
      const frames = createIntegrativeFrames();
      const result = profileAnatomy(frames, { integrativeAnalysis: true });
      expect(result.classification).toBe(ANATOMY.TRANSFEMORAL);
      expect(result.adaptedTrack).toBe('TRANSFEMORAL_AMPUTEE');
      expect(result.integrativeConfidence).toBeGreaterThanOrEqual(1.0);
      expect(result.insufficientConfidence).toBeUndefined();
    });

    it('rejects when hip deviation missing (only frozen joints + no CoG/hip)', () => {
      // Symmetric hips/shoulders → no hip deviation, no CoG bias
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.04;
        const heelSway = Math.sin(i * 0.3 + 1.0) * 0.03;
        frames.push(createLandmarks({
          0: { x: 0.50, y: 0.15, z: 0, visibility: 0.95 },
          // Symmetric hips (no deviation)
          23: { x: 0.47, y: 0.55 + sway, z: 0, visibility: 0.95 },
          24: { x: 0.53, y: 0.55 + sway, z: 0, visibility: 0.95 },
          11: { x: 0.47, y: 0.30, z: 0, visibility: 0.95 },
          12: { x: 0.53, y: 0.30, z: 0, visibility: 0.95 },
          // Left: frozen
          25: { x: 0.44, y: 0.72, z: 0, visibility: 0.95 },
          27: { x: 0.44, y: 0.88, z: 0, visibility: 0.95 },
          29: { x: 0.44, y: 0.92, z: 0, visibility: 0.95 },
          // Right: moves
          26: { x: 0.57 - sway * 0.5, y: 0.72 + sway * 0.8, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway * 0.3, y: 0.88 + sway * 0.5, z: 0, visibility: 0.95 },
          30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 0.8, z: 0, visibility: 0.95 },
        }));
      }
      const result = profileAnatomy(frames, { integrativeAnalysis: true });
      expect(result.classification).toBe(ANATOMY.NATURAL);
      expect(result.insufficientConfidence).toBe(true);
      expect(result.integrativeConfidence).toBeLessThan(1.0);
    });

    it('calf raise result used as 4th signal', () => {
      const frames = createIntegrativeFrames();
      // Calf raise confirms left ankle didn't move
      const result = profileAnatomy(frames, {
        integrativeAnalysis: true,
        calfRaiseResult: { leftAnkleMoved: false, rightAnkleMoved: true, leftAnkleRange: 0.001, rightAnkleRange: 0.02 },
      });
      expect(result.classification).toBe(ANATOMY.TRANSFEMORAL);
      expect(result.integrativeConfidence).toBe(1.0); // 4/4 signals
    });

    it('strict mode uses tighter hip deviation threshold', () => {
      // Hip deviation = hipCenter - nose = (0.495+0.505)/2 - 0.50 = 0.50 - 0.50 = 0.
      // Need hip deviation exactly between 0.0075 and 0.015:
      // hipCenter = (leftHip.x + rightHip.x) / 2. nose.x = 0.50
      // Want deviation = 0.01: hipCenter = 0.51, so leftHip=0.48, rightHip=0.54
      // CoG: shoulderMid + hipMid / 2. shoulders at 0.48/0.54 → shoulderMid=0.51, hipMid=0.51 → CoG=0.51 → bias=0.01 → 'right'
      const frames = [];
      for (let i = 0; i < 60; i++) {
        const sway = Math.sin(i * 0.3) * 0.04;
        const heelSway = Math.sin(i * 0.3 + 1.0) * 0.03;
        frames.push(createLandmarks({
          0: { x: 0.50, y: 0.15, z: 0, visibility: 0.95 },
          // Slight hip+shoulder shift right: hipCenter=0.51, deviation=0.01
          11: { x: 0.48, y: 0.30, z: 0, visibility: 0.95 },
          12: { x: 0.54, y: 0.30, z: 0, visibility: 0.95 },
          23: { x: 0.48, y: 0.55, z: 0, visibility: 0.95 }, // left hip FROZEN
          24: { x: 0.54, y: 0.55 + sway, z: 0, visibility: 0.95 },
          // Left: frozen (hip+knee+ankle)
          25: { x: 0.44, y: 0.72, z: 0, visibility: 0.95 },
          27: { x: 0.44, y: 0.88, z: 0, visibility: 0.95 },
          29: { x: 0.44, y: 0.92, z: 0, visibility: 0.95 },
          // Right: moves
          26: { x: 0.57 - sway * 0.5, y: 0.72 + sway * 0.8, z: 0, visibility: 0.95 },
          28: { x: 0.58 - sway * 0.3, y: 0.88 + sway * 0.5, z: 0, visibility: 0.95 },
          30: { x: 0.58 - heelSway, y: 0.92 + heelSway * 0.8, z: 0, visibility: 0.95 },
        }));
      }
      // Normal mode: hip deviation 0.01 < threshold 0.015 → hipConfirms=false → rejected
      const normalResult = profileAnatomy(frames, { integrativeAnalysis: true });
      expect(normalResult.insufficientConfidence).toBe(true);

      // Strict mode: hip deviation 0.01 > threshold 0.0075 → hipConfirms=true
      const strictResult = profileAnatomy(frames, { integrativeAnalysis: true, strictMode: true });
      expect(strictResult.classification).toBe(ANATOMY.TRANSFEMORAL);
    });

    it('computeCenterOfGravity returns bias direction', () => {
      // Frames with hips+shoulders shifted right
      const frames = [];
      for (let i = 0; i < 60; i++) {
        frames.push(createLandmarks({
          11: { x: 0.47, y: 0.30, z: 0, visibility: 0.95 },
          12: { x: 0.59, y: 0.30, z: 0, visibility: 0.95 },
          23: { x: 0.47, y: 0.55, z: 0, visibility: 0.95 },
          24: { x: 0.59, y: 0.55, z: 0, visibility: 0.95 },
        }));
      }
      const cog = computeCenterOfGravity(frames);
      expect(cog).not.toBeNull();
      expect(cog.biasDirection).toBe('right');
      expect(cog.biasX).toBeGreaterThan(0);
    });
  });
});

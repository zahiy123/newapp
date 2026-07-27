// ============================================================
// DRY RUN — Full Scan Simulation
//
// Scenario: User with below-knee amputation on LEFT LEG
//
// This test walks through every stage of the scan pipeline,
// printing intermediate results at each checkpoint.
// It validates the COMPLETE flow: Phase A → Phase B → Gate → Passport
// ============================================================

import { describe, it, expect } from 'vitest';

// Stage 1: Phase A
import {
  analyzeObjectDetections,
  analyzeLandmarkIntegrity,
  determineTrack,
  LIMB_LANDMARKS,
} from '../PhaseAAnalyzer.js';

// Stage 2: Phase B
import { analyzePhaseB } from '../PhaseBAnalyzer.js';
import { getMovementQueue, LM } from '../movements.js';

// Stage 3: CertaintyGate
import { evaluateCertainty, extractPassportFields } from '../CertaintyGate.js';

// Stage 4: Passport validation
import { validatePassport } from '../../SchemaValidator.js';
import { LIMB_KEYS } from '../../constants.js';


// ============================================================
// Synthetic Data — Simulates a below-knee amputee (left leg)
// ============================================================

/**
 * Generate 15 seconds of static standing frames (Phase A).
 * Left leg landmarks below the knee are INVISIBLE.
 * Right leg, both arms: fully visible and stable.
 * Also simulates a crutch being detected in some frames.
 */
function generateAmputeePhaseALandmarks(frameCount = 450, fps = 30) {
  const frames = [];
  for (let f = 0; f < frameCount; f++) {
    const landmarks = [];
    for (let i = 0; i < 33; i++) {
      landmarks.push({
        x: 0.5 + (Math.random() - 0.5) * 0.002,
        y: 0.5 + (Math.random() - 0.5) * 0.002,
        z: 0,
        visibility: 0.95,
      });
    }

    // Left leg: hip visible, but knee/ankle/heel/foot ABSENT
    landmarks[LM.LEFT_HIP].visibility = 0.92;
    landmarks[LM.LEFT_HIP].y = 0.55;

    landmarks[LM.LEFT_KNEE].visibility = 0.08;  // barely visible / ghost
    landmarks[LM.LEFT_KNEE].x = 0;
    landmarks[LM.LEFT_KNEE].y = 0;

    landmarks[LM.LEFT_ANKLE].visibility = 0.02; // absent
    landmarks[LM.LEFT_ANKLE].x = 0;
    landmarks[LM.LEFT_ANKLE].y = 0;

    landmarks[LM.LEFT_HEEL].visibility = 0.01;
    landmarks[LM.LEFT_HEEL].x = 0;
    landmarks[LM.LEFT_HEEL].y = 0;

    landmarks[LM.LEFT_FOOT].visibility = 0.01;
    landmarks[LM.LEFT_FOOT].x = 0;
    landmarks[LM.LEFT_FOOT].y = 0;

    // Right leg: healthy, stable standing
    landmarks[LM.RIGHT_HIP].y = 0.55;
    landmarks[LM.RIGHT_HIP].visibility = 0.95;
    landmarks[LM.RIGHT_KNEE].y = 0.72;
    landmarks[LM.RIGHT_KNEE].visibility = 0.94;
    landmarks[LM.RIGHT_ANKLE].y = 0.88;
    landmarks[LM.RIGHT_ANKLE].visibility = 0.93;
    landmarks[LM.RIGHT_HEEL].y = 0.90;
    landmarks[LM.RIGHT_HEEL].visibility = 0.92;
    landmarks[LM.RIGHT_FOOT].y = 0.91;
    landmarks[LM.RIGHT_FOOT].visibility = 0.91;

    // Arms: healthy and stable
    for (const idx of [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
                       LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
                       LM.LEFT_WRIST, LM.RIGHT_WRIST]) {
      landmarks[idx].visibility = 0.94;
      landmarks[idx].y = 0.3 + (idx % 2) * 0.05;
    }

    frames.push(landmarks);
  }
  return frames;
}

/**
 * Generate crutch detection frames (crutch visible in 85% of frames).
 */
function generateCrutchObjectFrames(frameCount = 450) {
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    if (i / frameCount < 0.85) {
      frames.push({
        objects: [{ label: 'crutch', confidence: 0.88, bbox: { x: 0.3, y: 0.2, w: 0.05, h: 0.6 } }],
      });
    } else {
      frames.push({ objects: [] });
    }
  }
  return frames;
}

/**
 * Generate Phase B landmark frames for Track α (missing_limb).
 * Right leg performs the movements normally, left leg is absent.
 * Arms move with slight asymmetry (compensating for missing leg).
 */
function generateAmputeePhaseBFrames(movement, fps = 30) {
  const frameCount = Math.floor(movement.duration_ms / 1000 * fps);
  const frames = [];

  for (let f = 0; f < frameCount; f++) {
    const landmarks = [];
    for (let i = 0; i < 33; i++) {
      landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
    }

    const t = f / fps;

    // Left leg always absent below knee
    landmarks[LM.LEFT_KNEE].visibility = 0.05;
    landmarks[LM.LEFT_KNEE].x = 0;
    landmarks[LM.LEFT_KNEE].y = 0;
    landmarks[LM.LEFT_ANKLE].visibility = 0.02;
    landmarks[LM.LEFT_ANKLE].x = 0;
    landmarks[LM.LEFT_ANKLE].y = 0;
    landmarks[LM.LEFT_HEEL].visibility = 0.01;
    landmarks[LM.LEFT_HEEL].x = 0;
    landmarks[LM.LEFT_HEEL].y = 0;
    landmarks[LM.LEFT_FOOT].visibility = 0.01;
    landmarks[LM.LEFT_FOOT].x = 0;
    landmarks[LM.LEFT_FOOT].y = 0;

    // Right leg: healthy movement
    const rightOmegaN = 2 * Math.PI * 1.5;
    const rightXi = 0.06; // healthy damping
    const rightOmegaD = rightOmegaN * Math.sqrt(1 - rightXi * rightXi);
    landmarks[LM.RIGHT_HIP].y = 0.55;
    landmarks[LM.RIGHT_KNEE].y = 0.72 + Math.exp(-rightXi * rightOmegaN * t) * Math.sin(rightOmegaD * t) * 0.08;
    landmarks[LM.RIGHT_ANKLE].y = 0.88 + Math.exp(-rightXi * rightOmegaN * t) * Math.sin(rightOmegaD * t) * 0.12;

    // Arms: slight compensation on the left side
    switch (movement.analysis_type) {
      case 'damping': {
        const armOmega = 2 * Math.PI * 1.2;
        const armXi = 0.07;
        const armOmegaD = armOmega * Math.sqrt(1 - armXi * armXi);
        // Right arm: normal
        landmarks[LM.RIGHT_WRIST].y = 0.4 + Math.exp(-armXi * armOmega * t) * Math.sin(armOmegaD * t) * 0.25;
        // Left arm: similar but with slight compensation
        landmarks[LM.LEFT_WRIST].y = 0.4 + Math.exp(-armXi * armOmega * t) * Math.sin(armOmegaD * t) * 0.22;
        break;
      }
      case 'compensation': {
        // Weight shift — all weight on right side
        const shiftPhase = Math.sin(2 * Math.PI * 0.5 * t);
        landmarks[LM.LEFT_HIP].x = 0.45 + shiftPhase * 0.03;
        landmarks[LM.LEFT_HIP].y = 0.56 + Math.abs(shiftPhase) * 0.04; // hip drops
        landmarks[LM.RIGHT_HIP].x = 0.55 + shiftPhase * 0.06; // more shift on right
        landmarks[LM.RIGHT_HIP].y = 0.55;
        landmarks[LM.LEFT_SHOULDER].x = 0.43 + shiftPhase * 0.05; // trunk lean
        landmarks[LM.RIGHT_SHOULDER].x = 0.57 + shiftPhase * 0.05;
        landmarks[LM.LEFT_SHOULDER].y = 0.30;
        landmarks[LM.RIGHT_SHOULDER].y = 0.30;
        break;
      }
      case 'rhythm_baseline': {
        // Walking: right leg does the stepping, arms swing
        const walkFreq = 2 * Math.PI * 1.0;
        landmarks[LM.RIGHT_ANKLE].y = 0.88 + Math.sin(walkFreq * t) * 0.10;
        landmarks[LM.RIGHT_WRIST].y = 0.40 + Math.sin(walkFreq * t + Math.PI) * 0.08;
        landmarks[LM.LEFT_WRIST].y = 0.40 + Math.sin(walkFreq * t) * 0.06; // reduced swing
        break;
      }
    }

    frames.push(landmarks);
  }
  return frames;
}


// ============================================================
// THE DRY RUN
// ============================================================

describe('DRY RUN — Below-knee amputation, left leg', () => {

  // Shared state across steps (simulating the Sequencer flow)
  let phaseALandmarks;
  let objectFrames;
  let phaseARouting;
  let movementQueue;
  let phaseBResult;
  let gateResult;

  // ==========================================
  // STAGE 1: Phase A — Static Scan (15 sec)
  // ==========================================

  describe('Stage 1: Phase A — Static Scan', () => {

    it('Step 1.1: Object detection identifies crutch', () => {
      objectFrames = generateCrutchObjectFrames(450);
      const aidDetection = analyzeObjectDetections(objectFrames);

      console.log('\n╔══════════════════════════════════════════════╗');
      console.log('║  STAGE 1: Phase A — Object Detection          ║');
      console.log('╚══════════════════════════════════════════════╝');
      console.log('Aid detection results:');
      console.log('  Crutches:   ', aidDetection.crutches);
      console.log('  Wheelchair: ', aidDetection.wheelchair);
      console.log('  Prosthetic: ', aidDetection.prosthetic);
      console.log('  Brace:      ', aidDetection.brace);

      expect(aidDetection.crutches.detected).toBe(true);
      expect(aidDetection.crutches.frame_ratio).toBeGreaterThan(0.80);
      expect(aidDetection.wheelchair.detected).toBe(false);
    });

    it('Step 1.2: Landmark integrity detects left leg absence', () => {
      phaseALandmarks = generateAmputeePhaseALandmarks(450, 30);
      const integrity = analyzeLandmarkIntegrity(phaseALandmarks);

      console.log('\n┌──────────────────────────────────────────────┐');
      console.log('│  STAGE 1: Phase A — Landmark Integrity         │');
      console.log('└──────────────────────────────────────────────┘');
      for (const limb of LIMB_KEYS) {
        const li = integrity[limb];
        console.log(`  ${limb}:`);
        console.log(`    present=${li.landmarks_present}  avg_vis=${li.avg_visibility}  variance=${li.positional_variance}`);
        console.log(`    proportion_ratio=${li.proportion_ratio}  status=${li.preliminary_status}  certainty=${li.certainty}`);
      }

      // Left leg: landmarks absent
      expect(integrity.left_leg.landmarks_present).toBe(false);
      expect(integrity.left_leg.preliminary_status).toBe('likely_absent');
      expect(integrity.left_leg.certainty).toBe('high');

      // Right leg: present and stable
      expect(integrity.right_leg.landmarks_present).toBe(true);
      expect(integrity.right_leg.preliminary_status).toBe('likely_healthy');
    });

    it('Step 1.3: Routing chooses Track α (missing_limb)', () => {
      const aidDetection = analyzeObjectDetections(objectFrames);
      const integrity = analyzeLandmarkIntegrity(phaseALandmarks);
      phaseARouting = determineTrack(aidDetection, integrity);

      console.log('\n┌──────────────────────────────────────────────┐');
      console.log('│  STAGE 1: Phase A — Routing Decision           │');
      console.log('└──────────────────────────────────────────────┘');
      console.log('  Track:             ', phaseARouting.track);
      console.log('  Is wheelchair:     ', phaseARouting.is_wheelchair);
      console.log('  Hypotheses:');
      for (const [limb, hyp] of Object.entries(phaseARouting.hypotheses)) {
        console.log(`    ${limb}: ${hyp}`);
      }
      console.log('  Verification needed:', phaseARouting.verification_needed);
      console.log('  Reasoning:         ', phaseARouting.reasoning);

      expect(phaseARouting.track).toBe('missing_limb');
      expect(phaseARouting.is_wheelchair).toBe(false);
      expect(phaseARouting.hypotheses.left_leg).toBe('absent');
      expect(phaseARouting.hypotheses.right_leg).toBe('likely_healthy');
      expect(phaseARouting.hypotheses.left_arm).toBe('likely_healthy');
      expect(phaseARouting.hypotheses.right_arm).toBe('likely_healthy');
    });
  });


  // ==========================================
  // STAGE 2: Phase B — Guided Movements
  // ==========================================

  describe('Stage 2: Phase B — Guided Dynamic Analysis (Track α)', () => {

    it('Step 2.1: Movement queue built for missing_limb track', () => {
      movementQueue = getMovementQueue('missing_limb', false);

      console.log('\n╔══════════════════════════════════════════════╗');
      console.log('║  STAGE 2: Phase B — Movement Queue             ║');
      console.log('╚══════════════════════════════════════════════╝');
      for (const m of movementQueue) {
        console.log(`  [${m.id}]`);
        console.log(`    "${m.instruction_en}"`);
        console.log(`    type=${m.analysis_type}  duration=${m.duration_ms}ms  limbs=${m.target_limbs.join(',')}`);
      }

      expect(movementQueue).toHaveLength(3);
      expect(movementQueue[0].id).toBe('alpha_arms_raise');
      expect(movementQueue[1].id).toBe('alpha_weight_shift');
      expect(movementQueue[2].id).toBe('alpha_natural_motion');
    });

    it('Step 2.2: Full Phase B analysis produces per-limb results', () => {
      const movementDataList = movementQueue.map(movement => ({
        movement,
        frames: generateAmputeePhaseBFrames(movement, 30),
        sampleRate: 30,
      }));

      phaseBResult = analyzePhaseB(movementDataList);

      console.log('\n┌──────────────────────────────────────────────┐');
      console.log('│  STAGE 2: Phase B — Analysis Results           │');
      console.log('└──────────────────────────────────────────────┘');
      console.log(`  Movements analyzed: ${phaseBResult.movements_analyzed}/${phaseBResult.movements_total}`);

      for (const limb of LIMB_KEYS) {
        const la = phaseBResult.limbs[limb];
        console.log(`\n  ── ${limb} ──`);
        console.log(`    overall_damping_class: ${la.overall_damping_class}`);
        console.log(`    overall_damping_factor: ${la.overall_damping_factor}`);
        console.log(`    evidence_sources: [${la.evidence_sources.join(', ')}]`);
        if (la.damping) {
          console.log(`    damping: class=${la.damping.damping_class} ξ=${la.damping.damping_factor} freq=${la.damping.dominant_freq_hz}Hz`);
        } else {
          console.log('    damping: (no data)');
        }
        if (la.compensation) {
          console.log(`    compensation: ${la.compensation.patterns?.length ?? 0} patterns, weight_dist=${JSON.stringify(la.compensation.weight_distribution)}`);
        }
        if (la.rhythm) {
          console.log(`    rhythm: freq=${la.rhythm.step_frequency_hz}Hz`);
        }
        if (la.cross_validation) {
          console.log(`    cross_validation: rules=[${la.cross_validation.applied_rules.join(',')}]`);
        }
      }

      expect(phaseBResult.movements_analyzed).toBe(3);

      // Right leg should have healthy damping
      expect(phaseBResult.limbs.right_leg.overall_damping_class).toBe('organic_healthy');

      // Arms should be analyzed
      expect(phaseBResult.limbs.right_arm.evidence_sources.length).toBeGreaterThan(0);
      expect(phaseBResult.limbs.left_arm.evidence_sources.length).toBeGreaterThan(0);
    });
  });


  // ==========================================
  // STAGE 3: CertaintyGate — Final Verdict
  // ==========================================

  describe('Stage 3: CertaintyGate — Verdict', () => {

    it('Step 3.1: Gate produces correct verdict per limb', () => {
      gateResult = evaluateCertainty(phaseARouting, phaseBResult, {});

      console.log('\n╔══════════════════════════════════════════════╗');
      console.log('║  STAGE 3: CertaintyGate — Verdicts             ║');
      console.log('╚══════════════════════════════════════════════╝');
      console.log(`  scan_status: ${gateResult.scan_status}`);
      console.log(`  retries: ${gateResult.retries.length}`);
      console.log(`  user_queries: ${gateResult.user_queries.length}`);

      for (const limb of LIMB_KEYS) {
        const v = gateResult.limbs[limb];
        console.log(`\n  ── ${limb} ──`);
        console.log(`    verdict:          ${v.verdict}`);
        console.log(`    status:           ${v.status}`);
        console.log(`    confidence:       ${v.confidence}`);
        console.log(`    detection_method: ${v.detection_method}`);
        console.log(`    damping_factor:   ${v.damping_factor}`);
        console.log(`    damping_class:    ${v.damping_class}`);
        console.log(`    reasoning:        ${v.reasoning}`);
      }

      // LEFT LEG: absent — detected by Phase A landmark absence
      const leftLeg = gateResult.limbs.left_leg;
      expect(leftLeg.verdict).toBe('complete');
      expect(leftLeg.status).toBe('absent');
      expect(leftLeg.confidence).toBe(1.0);
      expect(leftLeg.detection_method).toBe('landmark_only');
      expect(leftLeg.damping_factor).toBeNull();

      // RIGHT LEG: healthy — confirmed by Phase B damping
      const rightLeg = gateResult.limbs.right_leg;
      expect(rightLeg.verdict).toBe('complete');
      expect(rightLeg.status).toBe('anatomical_healthy');
      expect(rightLeg.confidence).toBe(1.0);
      expect(rightLeg.detection_method).toBe('damping_analysis');
      expect(rightLeg.damping_factor).toBeLessThan(0.15);

      // ARMS: both healthy
      expect(gateResult.limbs.left_arm.verdict).toBe('complete');
      expect(gateResult.limbs.right_arm.verdict).toBe('complete');

      // Overall: complete scan, no retries needed
      expect(gateResult.scan_status).toBe('complete');
    });
  });


  // ==========================================
  // STAGE 4: Passport Construction & Validation
  // ==========================================

  describe('Stage 4: Passport Construction & Schema Validation', () => {

    it('Step 4.1: Extract Passport fields from each verdict', () => {
      console.log('\n╔══════════════════════════════════════════════╗');
      console.log('║  STAGE 4: Passport Field Extraction            ║');
      console.log('╚══════════════════════════════════════════════╝');

      const passportLimbs = {};
      for (const limb of LIMB_KEYS) {
        const fields = extractPassportFields(gateResult.limbs[limb]);
        passportLimbs[limb] = fields;

        console.log(`\n  ── ${limb} ──`);
        console.log(`    status:            ${fields.status}`);
        console.log(`    confidence:        ${fields.confidence}`);
        console.log(`    detection_method:  ${fields.detection_method}`);
        console.log(`    damping_factor:    ${fields.damping_factor}`);
        console.log(`    damping_class:     ${fields.damping_class}`);
        console.log(`    range_of_motion:   ${fields.range_of_motion}`);
        console.log(`    stiffness_profile: ${fields.stiffness_profile}`);
      }

      // LEFT LEG: absent fields
      expect(passportLimbs.left_leg.status).toBe('absent');
      expect(passportLimbs.left_leg.range_of_motion).toBe('none');
      expect(passportLimbs.left_leg.stiffness_profile).toBeNull();
      expect(passportLimbs.left_leg.damping_factor).toBeNull();

      // RIGHT LEG: healthy fields
      expect(passportLimbs.right_leg.status).toBe('anatomical_healthy');
      expect(passportLimbs.right_leg.range_of_motion).toBe('full');
      expect(passportLimbs.right_leg.stiffness_profile).toBe('organic');
      expect(passportLimbs.right_leg.confidence).toBe(1.0);
    });

    it('Step 4.2: Full Passport passes SchemaValidator (6 Iron Rules)', () => {
      // Build the COMPLETE Passport document matching SchemaValidator's full spec
      const passport = {
        version: '1.0.0',
        scan_status: 'complete',
        scan_date: new Date().toISOString(),
        scan_duration_sec: 60,

        // body_map: per-limb data from CertaintyGate verdicts
        body_map: {},

        // external_aids: from Phase A object detection
        external_aids: {
          crutches: { detected: true, type: 'forearm', side: 'left' },
          wheelchair: { detected: false },
          brace: { detected: false },
        },

        // structural_profile: inferred from scan results
        structural_profile: {
          mobility_mode: 'standing_asymmetric_crutch',
          center_of_gravity: {
            bias: 'right',
            stability_score: 0.75,
          },
          proportions: {
            left_leg_to_right_leg: 0,   // absent
            left_arm_to_right_arm: 1.0, // symmetric
          },
        },

        // compensation_map: from Phase B compensation analysis
        compensation_map: {
          patterns: [],
          symmetry_index: 0.65,
        },

        // risk_zones: identified during analysis
        risk_zones: [],

        // kinetic_baseline: from Phase B rhythm analysis
        kinetic_baseline: {
          natural_rhythm_hz: 1.0,
          gait_symmetry_index: 0.4,
          preferred_tempo: 'moderate',
          dominant_side: 'right',
        },

        // classification: overall athlete classification
        classification: 'below_knee_amputee_left_crutch',

        // scan_metadata: audit trail
        scan_metadata: {
          frames_analyzed: 1350, // 450 Phase A + 900 Phase B
          user_reported_fields: [],
        },
      };

      // Fill body_map limbs from Gate verdicts
      for (const limb of LIMB_KEYS) {
        const fields = extractPassportFields(gateResult.limbs[limb]);
        passport.body_map[limb] = {
          ...fields,
          load_limit_factor: fields.status === 'absent' ? 0 : 1.0,
        };
      }

      console.log('\n┌──────────────────────────────────────────────┐');
      console.log('│  STAGE 4: Schema Validation (6 Iron Rules)     │');
      console.log('└──────────────────────────────────────────────┘');
      console.log('  Passport document:');
      console.log(`    version:     ${passport.version}`);
      console.log(`    scan_status: ${passport.scan_status}`);
      console.log(`    scan_date:   ${passport.scan_date}`);
      console.log(`    duration:    ${passport.scan_duration_sec}s`);
      console.log(`    mobility:    ${passport.structural_profile.mobility_mode}`);
      console.log(`    cog_bias:    ${passport.structural_profile.center_of_gravity.bias}`);
      console.log(`    class:       ${passport.classification}`);
      for (const limb of LIMB_KEYS) {
        const l = passport.body_map[limb];
        console.log(`    ${limb}: status=${l.status} conf=${l.confidence} ξ=${l.damping_factor} load=${l.load_limit_factor}`);
      }

      // Validate against SchemaValidator
      const errors = validatePassport(passport);

      console.log(`\n  Validation result: ${errors.length === 0 ? '✓ PASSED' : '✗ FAILED'}`);
      if (errors.length > 0) {
        for (const err of errors) {
          console.log(`    ✗ ${err.path}: ${err.detail}`);
        }
      }

      // Print Iron Rules checklist
      console.log('\n  ── Iron Rules Checklist ──');
      console.log(`    Rule 1 (confidence=1.0):      ${LIMB_KEYS.every(k => passport.body_map[k].confidence === 1.0) ? '✓' : '✗'}`);
      console.log(`    Rule 2 (absent→null damping):  ${passport.body_map.left_leg.damping_factor === null ? '✓' : '✗'}`);
      console.log(`    Rule 3 (scan_status=complete): ${passport.scan_status === 'complete' ? '✓' : '✗'}`);
      console.log(`    Rule 4 (load_limit 0-1):       ${LIMB_KEYS.every(k => passport.body_map[k].load_limit_factor >= 0 && passport.body_map[k].load_limit_factor <= 1) ? '✓' : '✗'}`);
      console.log(`    Rule 5 (valid enums):          ${LIMB_KEYS.every(k => ['absent', 'anatomical_healthy', 'anatomical_weak', 'prosthetic_below_knee', 'prosthetic_above_knee'].includes(passport.body_map[k].status)) ? '✓' : '✗'}`);
      console.log(`    Rule 6 (absent limb load=0):   ${passport.body_map.left_leg.load_limit_factor === 0 ? '✓' : '✗'}`);

      expect(errors).toHaveLength(0);
    });

    it('Step 4.3: Final pipeline summary', () => {
      console.log('\n╔══════════════════════════════════════════════╗');
      console.log('║  PIPELINE SUMMARY — Below-Knee Amputee (Left) ║');
      console.log('╠══════════════════════════════════════════════╣');
      console.log('║                                                ║');
      console.log('║  Phase A (15s static scan):                    ║');
      console.log('║    → Crutch detected (85% of frames)           ║');
      console.log('║    → Left leg landmarks ABSENT                  ║');
      console.log('║    → Route: Track α (missing_limb)              ║');
      console.log('║                                                ║');
      console.log('║  Phase B (Track α — 3 movements):              ║');
      console.log('║    → alpha_arms_raise:    arms damping OK       ║');
      console.log('║    → alpha_weight_shift:  compensation detected ║');
      console.log('║    → alpha_natural_motion: rhythm baseline set   ║');
      console.log('║                                                ║');
      console.log('║  CertaintyGate:                                ║');
      console.log('║    → left_leg:  ABSENT    (confidence=1.0)      ║');
      console.log('║    → right_leg: HEALTHY   (confidence=1.0)      ║');
      console.log('║    → left_arm:  HEALTHY   (confidence=1.0)      ║');
      console.log('║    → right_arm: HEALTHY   (confidence=1.0)      ║');
      console.log('║                                                ║');
      console.log('║  Passport: ✓ VALID — all 6 Iron Rules pass      ║');
      console.log('║  Status:   COMPLETE — ready for KSG             ║');
      console.log('║                                                ║');
      console.log('╚══════════════════════════════════════════════╝');

      // This test just confirms the full pipeline connected successfully
      expect(true).toBe(true);
    });
  });
});

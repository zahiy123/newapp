// ============================================================
// KSG + SchemaValidator — Unit Tests
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { KineticStateGraph } from '../KineticStateGraph.js';
import { validatePassport, ValidationError } from '../SchemaValidator.js';
import { KSG_EVENT, LIMB_STATUS } from '../constants.js';

// --- Factory: create a valid passport for testing ---

function createValidPassport(overrides = {}) {
  const base = {
    version: '1.0',
    scan_date: '2026-07-06T14:32:00Z',
    scan_duration_sec: 58.3,
    scan_status: 'complete',

    body_map: {
      left_leg: {
        status: 'prosthetic_below_knee',
        detection_method: 'visual+landmark_absence',
        confidence: 1.0,
        damping_factor: 0.71,
        damping_class: 'mechanical',
        range_of_motion: 'limited_mechanical',
        stiffness_profile: 'mechanical',
        notes: 'crutch_detected',
      },
      right_leg: {
        status: 'anatomical_healthy',
        detection_method: 'damping_analysis',
        confidence: 1.0,
        damping_factor: 0.22,
        damping_class: 'organic_healthy',
        range_of_motion: 'full',
        stiffness_profile: 'organic',
        notes: null,
      },
      left_arm: {
        status: 'anatomical_healthy',
        detection_method: 'damping_analysis',
        confidence: 1.0,
        damping_factor: 0.19,
        damping_class: 'organic_healthy',
        range_of_motion: 'full',
        stiffness_profile: 'organic',
        notes: null,
      },
      right_arm: {
        status: 'anatomical_healthy',
        detection_method: 'damping_analysis',
        confidence: 1.0,
        damping_factor: 0.20,
        damping_class: 'organic_healthy',
        range_of_motion: 'full',
        stiffness_profile: 'organic',
        notes: null,
      },
    },

    external_aids: {
      crutches: { detected: true, type: 'forearm', side: 'left' },
      wheelchair: { detected: false, type: null },
      brace: { detected: false, location: null },
      other: [],
    },

    structural_profile: {
      mobility_mode: 'standing_asymmetric_crutch',
      center_of_gravity: {
        bias: 'right',
        stability_score: 0.74,
        vertical_axis_deviation: 0.03,
      },
      proportions: {
        left_arm_to_torso: 0.87,
        right_arm_to_torso: 0.88,
        left_leg_to_torso: 0.0,
        right_leg_to_torso: 1.02,
        shoulder_width_to_hip: 1.21,
      },
    },

    compensation_map: {
      patterns: [
        {
          type: 'hip_drop',
          side: 'left',
          severity: 'moderate',
          cause: 'absent left leg below knee',
        },
      ],
      symmetry_index: 0.58,
    },

    risk_zones: [
      {
        zone: 'right_hip',
        risk_type: 'overload',
        reason: 'compensates for absent left leg',
        monitoring_priority: 'high',
        load_limit_factor: 0.7,
      },
    ],

    kinetic_baseline: {
      natural_rhythm_hz: 1.4,
      gait_symmetry_index: 0.58,
      preferred_tempo: 'moderate',
      dominant_side: 'right',
      damping_spectrum: {
        left_leg: [0.71, 0.68, 0.73],
        right_leg: [0.22, 0.24, 0.21],
        left_arm: [0.19, 0.20, 0.18],
        right_arm: [0.20, 0.19, 0.21],
      },
    },

    classification: 'amputee_below_knee_left_crutch_user',

    scan_metadata: {
      frames_analyzed: 1800,
      retries: { phase_a: 0, phase_b: 0, movements_repeated: [] },
      user_reported_fields: [],
      scan_environment: 'indoor',
      camera_quality: 'hd',
      lighting_quality: 'good',
    },
  };

  return { ...base, ...overrides };
}


// =============================================
// Schema Validator Tests
// =============================================

describe('SchemaValidator', () => {
  it('accepts a fully valid passport', () => {
    const errors = validatePassport(createValidPassport());
    expect(errors).toHaveLength(0);
  });

  it('rejects confidence !== 1.0 (IRON RULE)', () => {
    const passport = createValidPassport();
    passport.body_map.left_leg.confidence = 0.95;
    const errors = validatePassport(passport);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].path).toContain('confidence');
    expect(errors[0].detail).toContain('exactly 1.0');
  });

  it('rejects incomplete scan status', () => {
    const passport = createValidPassport({ scan_status: 'incomplete' });
    const errors = validatePassport(passport);
    expect(errors.some(e => e.path.includes('scan_status'))).toBe(true);
  });

  it('rejects damping_factor on absent limb', () => {
    const passport = createValidPassport();
    passport.body_map.left_leg.status = 'absent';
    passport.body_map.left_leg.damping_factor = 0.5;
    const errors = validatePassport(passport);
    expect(errors.some(e => e.detail.includes('null when limb is absent'))).toBe(true);
  });

  it('accepts null confidence on unresolved limb', () => {
    const passport = createValidPassport();
    passport.body_map.left_leg.status = 'unresolved';
    passport.body_map.left_leg.confidence = undefined;
    passport.body_map.left_leg.damping_factor = undefined;
    passport.body_map.left_leg.damping_class = undefined;
    passport.body_map.left_leg.stiffness_profile = undefined;
    const errors = validatePassport(passport);
    // Should not have confidence errors for unresolved
    expect(errors.some(e => e.path.includes('confidence'))).toBe(false);
  });

  it('requires user_reported audit trail', () => {
    const passport = createValidPassport();
    passport.body_map.right_arm.detection_method = 'user_reported';
    // user_reported_fields does NOT include right_arm → error
    const errors = validatePassport(passport);
    expect(errors.some(e => e.path.includes('user_reported_fields'))).toBe(true);
  });

  it('rejects missing limb in body_map', () => {
    const passport = createValidPassport();
    delete passport.body_map.right_arm;
    const errors = validatePassport(passport);
    expect(errors.some(e => e.path.includes('right_arm') && e.detail.includes('missing'))).toBe(true);
  });

  it('rejects invalid enum values', () => {
    const passport = createValidPassport();
    passport.body_map.left_leg.status = 'robot_leg';
    const errors = validatePassport(passport);
    expect(errors.some(e => e.path.includes('status'))).toBe(true);
  });

  it('rejects risk zone with load_limit_factor > 1', () => {
    const passport = createValidPassport();
    passport.risk_zones[0].load_limit_factor = 1.5;
    const errors = validatePassport(passport);
    expect(errors.some(e => e.path.includes('load_limit_factor'))).toBe(true);
  });
});


// =============================================
// KSG Tests
// =============================================

describe('KineticStateGraph', () => {
  let ksg;

  beforeEach(() => {
    ksg = new KineticStateGraph();
  });

  // --- Passport ---

  it('loads a valid passport and emits event', () => {
    let emitted = null;
    ksg.on(KSG_EVENT.PASSPORT_LOADED, (data) => { emitted = data; });

    ksg.loadPassport(createValidPassport());

    expect(ksg.hasPassport()).toBe(true);
    expect(emitted).not.toBeNull();
    expect(emitted.classification).toBe('amputee_below_knee_left_crutch_user');
  });

  it('rejects invalid passport and throws', () => {
    expect(() => {
      ksg.loadPassport({ version: '1.0' }); // missing everything
    }).toThrow();
    expect(ksg.hasPassport()).toBe(false);
  });

  it('returns deep clone from getPassport (prevents mutation)', () => {
    ksg.loadPassport(createValidPassport());
    const p1 = ksg.getPassport();
    p1.classification = 'HACKED';
    const p2 = ksg.getPassport();
    expect(p2.classification).toBe('amputee_below_knee_left_crutch_user');
  });

  it('clears passport and emits event', () => {
    ksg.loadPassport(createValidPassport());
    let cleared = false;
    ksg.on(KSG_EVENT.PASSPORT_CLEARED, () => { cleared = true; });
    ksg.clearPassport();
    expect(ksg.hasPassport()).toBe(false);
    expect(cleared).toBe(true);
  });

  // --- Session / Runtime ---

  it('starts and ends a session', () => {
    let started = null;
    let ended = null;
    ksg.on(KSG_EVENT.SESSION_STARTED, (d) => { started = d; });
    ksg.on(KSG_EVENT.SESSION_ENDED, (d) => { ended = d; });

    const sessionId = ksg.startSession();
    expect(ksg.hasActiveSession()).toBe(true);
    expect(started.session_id).toBe(sessionId);

    const summary = ksg.endSession();
    expect(ksg.hasActiveSession()).toBe(false);
    expect(summary.session_id).toBe(sessionId);
    expect(ended.summary).toBeTruthy();
  });

  it('updates runtime with valid data', () => {
    ksg.startSession();
    ksg.updateRuntime('fatigue.index', 0.3);
    const runtime = ksg.getRuntime();
    expect(runtime.fatigue.index).toBe(0.3);
  });

  it('rejects invalid runtime update', () => {
    ksg.startSession();
    expect(() => {
      ksg.updateRuntime('fatigue.index', 1.5); // > 1
    }).toThrow();
  });

  it('rejects runtime update without active session', () => {
    expect(() => {
      ksg.updateRuntime('fatigue.index', 0.3);
    }).toThrow(/no active session/);
  });

  // --- Auto-alerts ---

  it('auto-generates fatigue alert when index > 0.8', () => {
    ksg.loadPassport(createValidPassport());
    ksg.startSession();

    let alert = null;
    ksg.on(KSG_EVENT.RUNTIME_FATIGUE_ALERT, (a) => { alert = a; });

    ksg.updateRuntime('fatigue.index', 0.85);
    expect(alert).not.toBeNull();
    expect(alert.severity).toBe('critical');
  });

  it('auto-generates compensation alert when drift > 0.10', () => {
    ksg.loadPassport(createValidPassport());
    ksg.startSession();

    let alert = null;
    ksg.on(KSG_EVENT.RUNTIME_COMPENSATION_ALERT, (a) => { alert = a; });

    ksg.updateRuntime('compensation_drift.right_hip', {
      baseline: 0.15,
      current: 0.30,
      delta: 0.15,
    });
    expect(alert).not.toBeNull();
    expect(alert.zone).toBe('right_hip');
  });

  it('auto-generates risk alert when cumulative load > 90%', () => {
    ksg.loadPassport(createValidPassport());
    ksg.startSession();

    let alert = null;
    ksg.on(KSG_EVENT.RUNTIME_RISK_ALERT, (a) => { alert = a; });

    ksg.updateRuntime('cumulative_load.right_hip', {
      units: 460,
      limit: 500,
      percentage: 0.92,
    });
    expect(alert).not.toBeNull();
    expect(alert.severity).toBe('critical');
  });

  // --- Generic get ---

  it('reads nested values with get()', () => {
    ksg.loadPassport(createValidPassport());
    const status = ksg.get('passport.body_map.left_leg.status');
    expect(status).toBe('prosthetic_below_knee');
  });

  it('returns undefined for non-existent path', () => {
    expect(ksg.get('passport.body_map.third_arm')).toBeUndefined();
  });

  // --- Ontology ---

  it('loads ontology and emits event', () => {
    let emitted = null;
    ksg.on(KSG_EVENT.ONTOLOGY_LOADED, (d) => { emitted = d; });

    ksg.loadOntology({
      sport: 'football',
      actions: {
        kick: { intent_sequence: ['load', 'rotate', 'release'] },
      },
    });

    expect(ksg.hasOntology()).toBe(true);
    expect(emitted.sport).toBe('football');
    expect(emitted.actions).toContain('kick');
  });

  // --- Twin ---

  it('sets twin and emits event', () => {
    let emitted = null;
    ksg.on(KSG_EVENT.TWIN_READY, (d) => { emitted = d; });

    ksg.setTwin({
      exercise: 'kick',
      phases: { load: {}, release: {} },
    });

    expect(ksg.hasTwin()).toBe(true);
    expect(emitted.exercise).toBe('kick');
    expect(emitted.phases).toContain('load');
  });

  // --- Snapshot ---

  it('produces a readable snapshot', () => {
    ksg.loadPassport(createValidPassport());
    ksg.startSession();
    const snap = ksg.getSnapshot();
    expect(snap.passport).toBe('✓ loaded');
    expect(snap.runtime).toBe('✓ active');
    expect(snap.ontology).toBe('✗ empty');
  });

  // --- Reset ---

  it('resets everything', () => {
    ksg.loadPassport(createValidPassport());
    ksg.startSession();
    ksg.reset();
    expect(ksg.hasPassport()).toBe(false);
    expect(ksg.hasActiveSession()).toBe(false);
    expect(ksg.getSnapshot().passport).toBe('✗ empty');
  });

  // --- Event unsubscribe ---

  it('unsubscribes correctly', () => {
    let count = 0;
    const unsub = ksg.on(KSG_EVENT.SESSION_STARTED, () => { count++; });

    ksg.startSession();
    expect(count).toBe(1);

    ksg.endSession();
    unsub();

    ksg.startSession();
    expect(count).toBe(1); // should not increment
  });
});

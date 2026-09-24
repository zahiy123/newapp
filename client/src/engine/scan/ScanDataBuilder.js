// ============================================================
// ScanDataBuilder — Assembles scanData for Training Engine
//
// PURE LOGIC — no React, no DOM, no side effects.
//
// Takes ScanSequencer.result + visionDiagnosis and produces
// the unified scanData object consumed by the server's
// buildWeekPrompt() (server/services/claude.js:1872-1894).
//
// Output shape:
//   { classification, adaptedTrack, prostheticSide, aids,
//     bodyMap, compensationMap, riskZones, specialProtocol,
//     limbStatus }
// ============================================================

import { LIMB_STATUS, DAMPING_CLASS } from '../constants.js';


// ---- Constants ----

const LIMB_KEYS = ['left_leg', 'right_leg', 'left_arm', 'right_arm'];

// Map limb keys to joint keys for bodyMap
const LIMB_TO_JOINTS = {
  left_leg:  ['left_knee', 'left_hip', 'left_ankle'],
  right_leg: ['right_knee', 'right_hip', 'right_ankle'],
  left_arm:  ['left_elbow', 'left_shoulder', 'left_wrist'],
  right_arm: ['right_elbow', 'right_shoulder', 'right_wrist'],
};

// ROM percentage by damping class
const ROM_BY_DAMPING = {
  [DAMPING_CLASS.ORGANIC_HEALTHY]: { min: 80, max: 100 },
  [DAMPING_CLASS.ORGANIC_WEAK]:    { min: 40, max: 70 },
  [DAMPING_CLASS.MECHANICAL]:      { min: 20, max: 40 },
};

// Statuses that cannot train
const NO_TRAIN_STATUSES = new Set([
  LIMB_STATUS.ABSENT,
  LIMB_STATUS.PROSTHETIC_ABOVE_KNEE,
  LIMB_STATUS.PROSTHETIC_ABOVE_ELBOW,
]);

// Statuses that are risk zones
const RISK_STATUSES = new Set([
  LIMB_STATUS.ANATOMICAL_WEAK,
  LIMB_STATUS.PROSTHETIC_BELOW_KNEE,
  LIMB_STATUS.PROSTHETIC_ABOVE_KNEE,
  LIMB_STATUS.PROSTHETIC_BELOW_ELBOW,
  LIMB_STATUS.PROSTHETIC_ABOVE_ELBOW,
]);

// Classification to specialProtocol mapping
const PROTOCOL_MAP = {
  WHEELCHAIR: 'wheelchair',
  BILATERAL: 'bilateral',
  PARALYSIS: 'paralysis',
};


// ============================================================
// Main Public API
// ============================================================

/**
 * Build the unified scanData object from scan pipeline outputs.
 *
 * @param {Object} scanResult - ScanSequencer.result
 *   { gateResult, passportFields, phaseAResult, phaseBResult,
 *     kineticProfile, anatomyClassification }
 * @param {Object|null} visionDiagnosis - From Haiku Vision API
 *   { classification, adaptedTrack, prostheticSide, aids,
 *     confidence, specialProtocol }
 * @returns {Object} scanData matching server consumption shape
 */
export function buildScanData(scanResult, visionDiagnosis) {
  if (!scanResult) return null;

  const vision = visionDiagnosis || {};
  const gateResult = scanResult.gateResult || {};
  const phaseAResult = scanResult.phaseAResult || {};
  const phaseBResult = scanResult.phaseBResult || {};
  const passportFields = scanResult.passportFields || {};
  const kineticProfile = scanResult.kineticProfile || {};

  // 1. Classification — prefer vision diagnosis, fallback to kinetic
  const classification = vision.classification
    || scanResult.anatomyClassification
    || 'NATURAL';

  // 2. Adapted track
  const adaptedTrack = vision.adaptedTrack
    || phaseAResult.track
    || 'NORMAL';

  // 3. Prosthetic side
  const prostheticSide = extractProstheticSide(vision, kineticProfile, gateResult);

  // 4. Aids
  const aids = extractAids(vision, phaseAResult);

  // 5. Body map — per-joint ROM from CertaintyGate verdicts
  const bodyMap = buildBodyMap(gateResult, passportFields);

  // 6. Compensation map — from Phase B analyzer
  const compensationMap = buildCompensationMap(phaseBResult);

  // 7. Risk zones — convergence of weak/prosthetic + compensation
  const riskZones = buildRiskZones(bodyMap, compensationMap, gateResult);

  // 8. Special protocol
  const specialProtocol = extractSpecialProtocol(vision, classification, phaseAResult);

  // 9. Limb status — for Iron Rule enforcement
  const limbStatus = buildLimbStatus(gateResult, passportFields);

  return {
    classification,
    adaptedTrack,
    prostheticSide,
    aids,
    bodyMap,
    compensationMap,
    riskZones,
    specialProtocol,
    limbStatus,
  };
}


// ============================================================
// Internal Builders
// ============================================================

function extractProstheticSide(vision, kineticProfile, gateResult) {
  if (vision.prostheticSide) return vision.prostheticSide.toLowerCase();

  // Infer from kineticProfile detected prosthetics
  const prosthetics = kineticProfile.detectedProsthetics || [];
  if (prosthetics.length > 0) {
    const first = prosthetics[0];
    if (first.limb) {
      return first.limb.includes('left') ? 'left' : 'right';
    }
  }

  // Infer from gate verdicts
  const limbs = gateResult.limbs || {};
  for (const key of LIMB_KEYS) {
    const v = limbs[key];
    if (v && (v.status === LIMB_STATUS.PROSTHETIC_BELOW_KNEE ||
              v.status === LIMB_STATUS.PROSTHETIC_ABOVE_KNEE)) {
      return key.startsWith('left') ? 'left' : 'right';
    }
  }

  return null;
}

function extractAids(vision, phaseAResult) {
  if (vision.aids && vision.aids.length > 0) return [...vision.aids];

  // From Phase A object detection
  const objAnalysis = phaseAResult.objectAnalysis;
  if (!objAnalysis) return [];

  const aids = [];
  if (objAnalysis.crutches?.detected) aids.push('crutch');
  if (objAnalysis.wheelchair?.detected) aids.push('wheelchair');
  if (objAnalysis.prosthetic?.detected) aids.push('prosthetic');
  if (objAnalysis.brace?.detected) aids.push('brace');
  return aids;
}

function buildBodyMap(gateResult, passportFields) {
  const bodyMap = {};
  const limbs = gateResult.limbs || {};

  for (const limbKey of LIMB_KEYS) {
    const verdict = limbs[limbKey];
    const passport = passportFields[limbKey];
    const joints = LIMB_TO_JOINTS[limbKey];
    if (!joints) continue;

    const status = verdict?.status || passport?.status || LIMB_STATUS.UNRESOLVED;
    const dampingClass = verdict?.damping_class || passport?.damping_class || null;
    const rom = computeRomPercent(status, dampingClass, verdict?.damping_factor);

    // Assign the same ROM to all joints in this limb
    for (const jointKey of joints) {
      bodyMap[jointKey] = { rom, status };
    }
  }

  return bodyMap;
}

function computeRomPercent(status, dampingClass, dampingFactor) {
  if (status === LIMB_STATUS.ABSENT) return 0;

  const range = ROM_BY_DAMPING[dampingClass];
  if (range) {
    // Use damping factor to interpolate within range if available
    if (typeof dampingFactor === 'number' && dampingFactor > 0) {
      // Higher damping factor in healthy range = better ROM
      // Clamp to the range boundaries
      const t = Math.min(1, Math.max(0, (dampingFactor - 0.1) / 0.5));
      return Math.round(range.min + t * (range.max - range.min));
    }
    return Math.round((range.min + range.max) / 2);
  }

  // Fallback based on status alone
  switch (status) {
    case LIMB_STATUS.ANATOMICAL_HEALTHY: return 90;
    case LIMB_STATUS.ANATOMICAL_WEAK: return 55;
    case LIMB_STATUS.PROSTHETIC_BELOW_KNEE: return 30;
    case LIMB_STATUS.PROSTHETIC_ABOVE_KNEE: return 20;
    case LIMB_STATUS.PROSTHETIC_BELOW_ELBOW: return 30;
    case LIMB_STATUS.PROSTHETIC_ABOVE_ELBOW: return 15;
    default: return 70; // unresolved — conservative
  }
}

function buildCompensationMap(phaseBResult) {
  const compensationMap = {
    hip_drop: false,
    trunk_lean: false,
    shoulder_elevation: false,
  };

  const limbs = phaseBResult.limbs || {};
  for (const limbKey of LIMB_KEYS) {
    const assessment = limbs[limbKey];
    if (!assessment?.compensation?.patterns) continue;

    for (const pattern of assessment.compensation.patterns) {
      const type = pattern.type || pattern;
      if (type === 'hip_drop') compensationMap.hip_drop = true;
      if (type === 'trunk_lean') compensationMap.trunk_lean = true;
      if (type === 'shoulder_elevation') compensationMap.shoulder_elevation = true;
    }
  }

  return compensationMap;
}

function buildRiskZones(bodyMap, compensationMap, gateResult) {
  const riskSet = new Set();

  // From bodyMap: joints with weak/prosthetic status
  for (const [jointKey, data] of Object.entries(bodyMap)) {
    if (RISK_STATUSES.has(data.status)) {
      riskSet.add(jointKey);
    }
    // Low ROM is also a risk
    if (data.rom < 50) {
      riskSet.add(jointKey);
    }
  }

  // From compensation patterns: affected side joints
  if (compensationMap.hip_drop) {
    // Hip drop typically affects the weaker side — add both hips and knees
    const limbs = gateResult.limbs || {};
    for (const key of ['left_leg', 'right_leg']) {
      const v = limbs[key];
      if (v && RISK_STATUSES.has(v.status)) {
        riskSet.add(key.replace('_leg', '_hip'));
        riskSet.add(key.replace('_leg', '_knee'));
      }
    }
  }

  if (compensationMap.trunk_lean) {
    // Trunk lean affects shoulders on the compensating side
    riskSet.add('left_shoulder');
    riskSet.add('right_shoulder');
  }

  if (compensationMap.shoulder_elevation) {
    // Shoulder elevation: arms with risk status → add elbows + wrists
    const armLimbs = gateResult.limbs || {};
    for (const key of ['left_arm', 'right_arm']) {
      const v = armLimbs[key];
      if (v && RISK_STATUSES.has(v.status)) {
        riskSet.add(key.replace('_arm', '_elbow'));
        riskSet.add(key.replace('_arm', '_wrist'));
        riskSet.add(key.replace('_arm', '_shoulder'));
      }
    }
  }

  // From inconclusive verdicts
  const limbs = gateResult.limbs || {};
  for (const limbKey of LIMB_KEYS) {
    const v = limbs[limbKey];
    if (v?.damping_class === 'inconclusive') {
      const joints = LIMB_TO_JOINTS[limbKey] || [];
      for (const j of joints) riskSet.add(j);
    }
  }

  return [...riskSet];
}

function extractSpecialProtocol(vision, classification, phaseAResult) {
  if (vision.specialProtocol) return vision.specialProtocol;

  const cls = (classification || '').toUpperCase();
  if (cls.includes('WHEELCHAIR') || phaseAResult.is_wheelchair) return 'wheelchair';
  if (cls.includes('BILATERAL')) return 'bilateral';

  return null;
}

function buildLimbStatus(gateResult, passportFields) {
  const limbStatus = {};
  const limbs = gateResult.limbs || {};

  for (const limbKey of LIMB_KEYS) {
    const verdict = limbs[limbKey];
    const passport = passportFields[limbKey];
    const status = verdict?.status || passport?.status || LIMB_STATUS.UNRESOLVED;

    limbStatus[limbKey] = {
      status,
      canTrain: !NO_TRAIN_STATUSES.has(status),
    };
  }

  return limbStatus;
}

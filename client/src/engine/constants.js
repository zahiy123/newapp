// ============================================================
// Universal Coaching Architecture — Constants & Enums
// Clinical-grade: every value is explicit, no magic strings
// ============================================================

// --- Limb Status ---
export const LIMB_STATUS = Object.freeze({
  PROSTHETIC_BELOW_KNEE: 'prosthetic_below_knee',
  PROSTHETIC_ABOVE_KNEE: 'prosthetic_above_knee',
  ANATOMICAL_HEALTHY: 'anatomical_healthy',
  ANATOMICAL_WEAK: 'anatomical_weak',
  ABSENT: 'absent',
  UNRESOLVED: 'unresolved',
});

export const LIMB_STATUS_VALUES = Object.freeze(Object.values(LIMB_STATUS));

// --- Detection Methods ---
export const DETECTION_METHOD = Object.freeze({
  VISUAL_AND_LANDMARK: 'visual+landmark_absence',
  DAMPING_ANALYSIS: 'damping_analysis',
  VISUAL_ONLY: 'visual_only',
  LANDMARK_ONLY: 'landmark_only',
  USER_REPORTED: 'user_reported',
});

export const DETECTION_METHOD_VALUES = Object.freeze(Object.values(DETECTION_METHOD));

// --- Damping Classification ---
export const DAMPING_CLASS = Object.freeze({
  MECHANICAL: 'mechanical',
  ORGANIC_HEALTHY: 'organic_healthy',
  ORGANIC_WEAK: 'organic_weak',
});

export const DAMPING_CLASS_VALUES = Object.freeze(Object.values(DAMPING_CLASS));

// --- Range of Motion ---
export const ROM = Object.freeze({
  FULL: 'full',
  LIMITED_MECHANICAL: 'limited_mechanical',
  LIMITED_ORGANIC: 'limited_organic',
  NONE: 'none',
});

export const ROM_VALUES = Object.freeze(Object.values(ROM));

// --- Stiffness Profile ---
export const STIFFNESS = Object.freeze({
  MECHANICAL: 'mechanical',
  ORGANIC: 'organic',
  MIXED: 'mixed',
});

export const STIFFNESS_VALUES = Object.freeze(Object.values(STIFFNESS));

// --- Mobility Modes ---
export const MOBILITY_MODE = Object.freeze({
  STANDING_SYMMETRIC: 'standing_symmetric',
  STANDING_ASYMMETRIC: 'standing_asymmetric',
  STANDING_ASYMMETRIC_CRUTCH: 'standing_asymmetric_crutch',
  WHEELCHAIR_MANUAL: 'wheelchair_manual',
  WHEELCHAIR_POWERED: 'wheelchair_powered',
});

export const MOBILITY_MODE_VALUES = Object.freeze(Object.values(MOBILITY_MODE));

// --- Center of Gravity Bias ---
export const COG_BIAS = Object.freeze({
  CENTER: 'center',
  LEFT: 'left',
  RIGHT: 'right',
});

export const COG_BIAS_VALUES = Object.freeze(Object.values(COG_BIAS));

// --- Compensation Types ---
export const COMPENSATION_TYPE = Object.freeze({
  HIP_DROP: 'hip_drop',
  TRUNK_LEAN: 'trunk_lean',
  SHOULDER_ELEVATION: 'shoulder_elevation',
  PELVIC_TILT: 'pelvic_tilt',
  HEAD_TILT: 'head_tilt',
});

export const COMPENSATION_TYPE_VALUES = Object.freeze(Object.values(COMPENSATION_TYPE));

// --- Severity ---
export const SEVERITY = Object.freeze({
  MILD: 'mild',
  MODERATE: 'moderate',
  SEVERE: 'severe',
});

export const SEVERITY_VALUES = Object.freeze(Object.values(SEVERITY));

// --- Risk Types ---
export const RISK_TYPE = Object.freeze({
  OVERLOAD: 'overload',
  REPETITIVE_STRAIN: 'repetitive_strain',
  INSTABILITY: 'instability',
  IMPACT: 'impact',
});

export const RISK_TYPE_VALUES = Object.freeze(Object.values(RISK_TYPE));

// --- Monitoring Priority ---
export const PRIORITY = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});

export const PRIORITY_VALUES = Object.freeze(Object.values(PRIORITY));

// --- Body Side ---
export const SIDE = Object.freeze({
  LEFT: 'left',
  RIGHT: 'right',
  BOTH: 'both',
});

export const SIDE_VALUES = Object.freeze(Object.values(SIDE));

// --- External Aid Types ---
export const CRUTCH_TYPE = Object.freeze({
  FOREARM: 'forearm',
  AXILLARY: 'axillary',
});

export const WHEELCHAIR_TYPE = Object.freeze({
  MANUAL: 'manual',
  POWERED: 'powered',
  SPORT: 'sport',
});

// --- Scan Status ---
export const SCAN_STATUS = Object.freeze({
  COMPLETE: 'complete',
  INCOMPLETE: 'incomplete',
  FAILED: 'failed',
});

// --- Tempo ---
export const TEMPO = Object.freeze({
  SLOW: 'slow',
  MODERATE: 'moderate',
  FAST: 'fast',
});

export const TEMPO_VALUES = Object.freeze(Object.values(TEMPO));

// --- Dominant Side ---
export const DOMINANT_SIDE = Object.freeze({
  LEFT: 'left',
  RIGHT: 'right',
  AMBIDEXTROUS: 'ambidextrous',
});

export const DOMINANT_SIDE_VALUES = Object.freeze(Object.values(DOMINANT_SIDE));

// --- KSG Cell Names ---
export const KSG_CELL = Object.freeze({
  PASSPORT: 'passport',
  ONTOLOGY: 'ontology',
  TWIN: 'twin',
  RUNTIME: 'runtime',
});

// --- KSG Events ---
export const KSG_EVENT = Object.freeze({
  PASSPORT_LOADED: 'passport:loaded',
  PASSPORT_CLEARED: 'passport:cleared',
  ONTOLOGY_LOADED: 'ontology:loaded',
  TWIN_READY: 'twin:ready',
  TWIN_UPDATED: 'twin:updated',
  RUNTIME_UPDATED: 'runtime:updated',
  RUNTIME_COMPENSATION_ALERT: 'runtime:compensation_alert',
  RUNTIME_FATIGUE_ALERT: 'runtime:fatigue_alert',
  RUNTIME_RISK_ALERT: 'runtime:risk_alert',
  SESSION_STARTED: 'session:started',
  SESSION_ENDED: 'session:ended',
  VALIDATION_ERROR: 'validation:error',
});

// --- Limb Keys (the 4 limbs we track) ---
export const LIMB_KEYS = Object.freeze([
  'left_leg', 'right_leg', 'left_arm', 'right_arm'
]);

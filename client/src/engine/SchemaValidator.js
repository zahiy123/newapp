// ============================================================
// SchemaValidator — Clinical-grade validation for KSG writes
//
// Every piece of data entering the KSG must pass validation.
// The system NEVER stores uncertain data. If validation fails,
// the write is rejected and a validation:error event is emitted.
// ============================================================

import {
  LIMB_STATUS, LIMB_STATUS_VALUES,
  DETECTION_METHOD_VALUES,
  DAMPING_CLASS_VALUES,
  ROM_VALUES,
  STIFFNESS_VALUES,
  MOBILITY_MODE_VALUES,
  COG_BIAS_VALUES,
  COMPENSATION_TYPE_VALUES,
  SEVERITY_VALUES,
  RISK_TYPE_VALUES,
  PRIORITY_VALUES,
  SIDE_VALUES,
  TEMPO_VALUES,
  DOMINANT_SIDE_VALUES,
  SCAN_STATUS,
  LIMB_KEYS,
  KSG_CELL,
} from './constants.js';


// ---- Utility helpers ----

function isNumber(v) { return typeof v === 'number' && !Number.isNaN(v); }
function isString(v) { return typeof v === 'string'; }
function isBool(v)   { return typeof v === 'boolean'; }
function isArray(v)  { return Array.isArray(v); }
function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function oneOf(v, allowed) { return allowed.includes(v); }
function inRange(v, min, max) { return isNumber(v) && v >= min && v <= max; }


// ---- Validation Error ----

export class ValidationError extends Error {
  constructor(path, message, value) {
    super(`[SchemaValidator] ${path}: ${message} (got: ${JSON.stringify(value)})`);
    this.name = 'ValidationError';
    this.path = path;
    this.detail = message;
    this.rejectedValue = value;
  }
}


// ---- Limb Validation ----

function validateLimb(limb, path) {
  const errors = [];

  if (!isObject(limb)) {
    return [new ValidationError(path, 'must be an object', limb)];
  }

  // status — required, must be valid enum
  if (!oneOf(limb.status, LIMB_STATUS_VALUES)) {
    errors.push(new ValidationError(`${path}.status`, `must be one of: ${LIMB_STATUS_VALUES.join(', ')}`, limb.status));
  }

  // IRON RULE: confidence must be exactly 1.0 — unless status is "unresolved"
  if (limb.status === LIMB_STATUS.UNRESOLVED) {
    // unresolved limbs don't require confidence
    if (limb.confidence !== undefined && limb.confidence !== null) {
      errors.push(new ValidationError(`${path}.confidence`, 'must be null/undefined when status is "unresolved"', limb.confidence));
    }
  } else {
    if (limb.confidence !== 1.0) {
      errors.push(new ValidationError(`${path}.confidence`, 'must be exactly 1.0 — no guessing allowed', limb.confidence));
    }
  }

  // detection_method — required
  if (!oneOf(limb.detection_method, DETECTION_METHOD_VALUES)) {
    errors.push(new ValidationError(`${path}.detection_method`, `must be one of: ${DETECTION_METHOD_VALUES.join(', ')}`, limb.detection_method));
  }

  // damping_factor — must be null if absent, number otherwise
  if (limb.status === LIMB_STATUS.ABSENT) {
    if (limb.damping_factor !== null && limb.damping_factor !== undefined) {
      errors.push(new ValidationError(`${path}.damping_factor`, 'must be null when limb is absent', limb.damping_factor));
    }
  } else if (limb.status !== LIMB_STATUS.UNRESOLVED) {
    if (!inRange(limb.damping_factor, 0, 1)) {
      errors.push(new ValidationError(`${path}.damping_factor`, 'must be a number between 0 and 1', limb.damping_factor));
    }
  }

  // damping_class — required if damping_factor exists
  if (limb.damping_factor !== null && limb.damping_factor !== undefined) {
    if (!oneOf(limb.damping_class, DAMPING_CLASS_VALUES)) {
      errors.push(new ValidationError(`${path}.damping_class`, `must be one of: ${DAMPING_CLASS_VALUES.join(', ')}`, limb.damping_class));
    }
  }

  // range_of_motion — required
  if (!oneOf(limb.range_of_motion, ROM_VALUES)) {
    errors.push(new ValidationError(`${path}.range_of_motion`, `must be one of: ${ROM_VALUES.join(', ')}`, limb.range_of_motion));
  }

  // stiffness_profile — required if not absent
  if (limb.status !== LIMB_STATUS.ABSENT && limb.status !== LIMB_STATUS.UNRESOLVED) {
    if (!oneOf(limb.stiffness_profile, STIFFNESS_VALUES)) {
      errors.push(new ValidationError(`${path}.stiffness_profile`, `must be one of: ${STIFFNESS_VALUES.join(', ')}`, limb.stiffness_profile));
    }
  }

  // notes — optional, string or null
  if (limb.notes !== null && limb.notes !== undefined && !isString(limb.notes)) {
    errors.push(new ValidationError(`${path}.notes`, 'must be a string or null', limb.notes));
  }

  return errors;
}


// ---- Compensation Pattern Validation ----

function validateCompensationPattern(pattern, path) {
  const errors = [];
  if (!isObject(pattern)) {
    return [new ValidationError(path, 'must be an object', pattern)];
  }
  if (!oneOf(pattern.type, COMPENSATION_TYPE_VALUES)) {
    errors.push(new ValidationError(`${path}.type`, `must be one of: ${COMPENSATION_TYPE_VALUES.join(', ')}`, pattern.type));
  }
  if (!oneOf(pattern.side, SIDE_VALUES)) {
    errors.push(new ValidationError(`${path}.side`, `must be one of: ${SIDE_VALUES.join(', ')}`, pattern.side));
  }
  if (!oneOf(pattern.severity, SEVERITY_VALUES)) {
    errors.push(new ValidationError(`${path}.severity`, `must be one of: ${SEVERITY_VALUES.join(', ')}`, pattern.severity));
  }
  if (!isString(pattern.cause) || pattern.cause.length === 0) {
    errors.push(new ValidationError(`${path}.cause`, 'must be a non-empty string', pattern.cause));
  }
  return errors;
}


// ---- Risk Zone Validation ----

function validateRiskZone(zone, path) {
  const errors = [];
  if (!isObject(zone)) {
    return [new ValidationError(path, 'must be an object', zone)];
  }
  if (!isString(zone.zone) || zone.zone.length === 0) {
    errors.push(new ValidationError(`${path}.zone`, 'must be a non-empty string', zone.zone));
  }
  if (!oneOf(zone.risk_type, RISK_TYPE_VALUES)) {
    errors.push(new ValidationError(`${path}.risk_type`, `must be one of: ${RISK_TYPE_VALUES.join(', ')}`, zone.risk_type));
  }
  if (!isString(zone.reason) || zone.reason.length === 0) {
    errors.push(new ValidationError(`${path}.reason`, 'must be a non-empty string', zone.reason));
  }
  if (!oneOf(zone.monitoring_priority, PRIORITY_VALUES)) {
    errors.push(new ValidationError(`${path}.monitoring_priority`, `must be one of: ${PRIORITY_VALUES.join(', ')}`, zone.monitoring_priority));
  }
  if (!inRange(zone.load_limit_factor, 0, 1)) {
    errors.push(new ValidationError(`${path}.load_limit_factor`, 'must be a number between 0 and 1', zone.load_limit_factor));
  }
  return errors;
}


// ---- Full Passport Validation ----

export function validatePassport(passport) {
  const errors = [];
  const p = 'passport';

  if (!isObject(passport)) {
    return [new ValidationError(p, 'must be an object', passport)];
  }

  // version
  if (!isString(passport.version)) {
    errors.push(new ValidationError(`${p}.version`, 'must be a string', passport.version));
  }

  // scan_status — must be "complete" to be loadable
  if (passport.scan_status !== SCAN_STATUS.COMPLETE) {
    errors.push(new ValidationError(`${p}.scan_status`, 'must be "complete" — incomplete scans cannot enter KSG', passport.scan_status));
  }

  // scan_date
  if (!isString(passport.scan_date)) {
    errors.push(new ValidationError(`${p}.scan_date`, 'must be an ISO date string', passport.scan_date));
  }

  // scan_duration_sec
  if (!isNumber(passport.scan_duration_sec) || passport.scan_duration_sec <= 0) {
    errors.push(new ValidationError(`${p}.scan_duration_sec`, 'must be a positive number', passport.scan_duration_sec));
  }

  // body_map — all 4 limbs required
  if (!isObject(passport.body_map)) {
    errors.push(new ValidationError(`${p}.body_map`, 'must be an object', passport.body_map));
  } else {
    for (const key of LIMB_KEYS) {
      if (!passport.body_map[key]) {
        errors.push(new ValidationError(`${p}.body_map.${key}`, 'missing — all 4 limbs must be defined', undefined));
      } else {
        errors.push(...validateLimb(passport.body_map[key], `${p}.body_map.${key}`));
      }
    }

    // Cross-validation: if detection_method is "user_reported",
    // scan_metadata.user_reported_fields must include that limb
    if (isObject(passport.scan_metadata)) {
      const reported = passport.scan_metadata.user_reported_fields || [];
      for (const key of LIMB_KEYS) {
        const limb = passport.body_map[key];
        if (limb && limb.detection_method === 'user_reported' && !reported.includes(key)) {
          errors.push(new ValidationError(
            `${p}.scan_metadata.user_reported_fields`,
            `must include "${key}" because its detection_method is "user_reported"`,
            reported
          ));
        }
      }
    }
  }

  // external_aids
  if (!isObject(passport.external_aids)) {
    errors.push(new ValidationError(`${p}.external_aids`, 'must be an object', passport.external_aids));
  } else {
    if (!isObject(passport.external_aids.crutches) || !isBool(passport.external_aids.crutches.detected)) {
      errors.push(new ValidationError(`${p}.external_aids.crutches`, 'must have a boolean "detected" field', passport.external_aids.crutches));
    }
    if (!isObject(passport.external_aids.wheelchair) || !isBool(passport.external_aids.wheelchair.detected)) {
      errors.push(new ValidationError(`${p}.external_aids.wheelchair`, 'must have a boolean "detected" field', passport.external_aids.wheelchair));
    }
    if (!isObject(passport.external_aids.brace) || !isBool(passport.external_aids.brace.detected)) {
      errors.push(new ValidationError(`${p}.external_aids.brace`, 'must have a boolean "detected" field', passport.external_aids.brace));
    }
  }

  // structural_profile
  if (!isObject(passport.structural_profile)) {
    errors.push(new ValidationError(`${p}.structural_profile`, 'must be an object', passport.structural_profile));
  } else {
    const sp = passport.structural_profile;
    if (!oneOf(sp.mobility_mode, MOBILITY_MODE_VALUES)) {
      errors.push(new ValidationError(`${p}.structural_profile.mobility_mode`, `must be one of: ${MOBILITY_MODE_VALUES.join(', ')}`, sp.mobility_mode));
    }
    if (!isObject(sp.center_of_gravity)) {
      errors.push(new ValidationError(`${p}.structural_profile.center_of_gravity`, 'must be an object', sp.center_of_gravity));
    } else {
      if (!oneOf(sp.center_of_gravity.bias, COG_BIAS_VALUES)) {
        errors.push(new ValidationError(`${p}.structural_profile.center_of_gravity.bias`, `must be one of: ${COG_BIAS_VALUES.join(', ')}`, sp.center_of_gravity.bias));
      }
      if (!inRange(sp.center_of_gravity.stability_score, 0, 1)) {
        errors.push(new ValidationError(`${p}.structural_profile.center_of_gravity.stability_score`, 'must be 0-1', sp.center_of_gravity.stability_score));
      }
    }
    if (!isObject(sp.proportions)) {
      errors.push(new ValidationError(`${p}.structural_profile.proportions`, 'must be an object', sp.proportions));
    }
  }

  // compensation_map
  if (!isObject(passport.compensation_map)) {
    errors.push(new ValidationError(`${p}.compensation_map`, 'must be an object', passport.compensation_map));
  } else {
    if (!isArray(passport.compensation_map.patterns)) {
      errors.push(new ValidationError(`${p}.compensation_map.patterns`, 'must be an array', passport.compensation_map.patterns));
    } else {
      passport.compensation_map.patterns.forEach((pat, i) => {
        errors.push(...validateCompensationPattern(pat, `${p}.compensation_map.patterns[${i}]`));
      });
    }
    if (!inRange(passport.compensation_map.symmetry_index, 0, 1)) {
      errors.push(new ValidationError(`${p}.compensation_map.symmetry_index`, 'must be 0-1', passport.compensation_map.symmetry_index));
    }
  }

  // risk_zones
  if (!isArray(passport.risk_zones)) {
    errors.push(new ValidationError(`${p}.risk_zones`, 'must be an array', passport.risk_zones));
  } else {
    passport.risk_zones.forEach((rz, i) => {
      errors.push(...validateRiskZone(rz, `${p}.risk_zones[${i}]`));
    });
  }

  // kinetic_baseline
  if (!isObject(passport.kinetic_baseline)) {
    errors.push(new ValidationError(`${p}.kinetic_baseline`, 'must be an object', passport.kinetic_baseline));
  } else {
    const kb = passport.kinetic_baseline;
    if (!isNumber(kb.natural_rhythm_hz) || kb.natural_rhythm_hz <= 0) {
      errors.push(new ValidationError(`${p}.kinetic_baseline.natural_rhythm_hz`, 'must be a positive number', kb.natural_rhythm_hz));
    }
    if (!inRange(kb.gait_symmetry_index, 0, 1)) {
      errors.push(new ValidationError(`${p}.kinetic_baseline.gait_symmetry_index`, 'must be 0-1', kb.gait_symmetry_index));
    }
    if (!oneOf(kb.preferred_tempo, TEMPO_VALUES)) {
      errors.push(new ValidationError(`${p}.kinetic_baseline.preferred_tempo`, `must be one of: ${TEMPO_VALUES.join(', ')}`, kb.preferred_tempo));
    }
    if (!oneOf(kb.dominant_side, DOMINANT_SIDE_VALUES)) {
      errors.push(new ValidationError(`${p}.kinetic_baseline.dominant_side`, `must be one of: ${DOMINANT_SIDE_VALUES.join(', ')}`, kb.dominant_side));
    }
  }

  // classification
  if (!isString(passport.classification) || passport.classification.length === 0) {
    errors.push(new ValidationError(`${p}.classification`, 'must be a non-empty string', passport.classification));
  }

  // scan_metadata
  if (!isObject(passport.scan_metadata)) {
    errors.push(new ValidationError(`${p}.scan_metadata`, 'must be an object', passport.scan_metadata));
  } else {
    if (!isNumber(passport.scan_metadata.frames_analyzed) || passport.scan_metadata.frames_analyzed <= 0) {
      errors.push(new ValidationError(`${p}.scan_metadata.frames_analyzed`, 'must be a positive number', passport.scan_metadata.frames_analyzed));
    }
    if (!isArray(passport.scan_metadata.user_reported_fields)) {
      errors.push(new ValidationError(`${p}.scan_metadata.user_reported_fields`, 'must be an array', passport.scan_metadata.user_reported_fields));
    }
  }

  return errors;
}


// ---- Runtime Layer Validation (lighter, runs frequently) ----

export function validateRuntimeUpdate(path, value) {
  const errors = [];

  switch (path) {
    case 'runtime.fatigue.index':
      if (!inRange(value, 0, 1)) {
        errors.push(new ValidationError(path, 'must be 0-1', value));
      }
      break;

    case 'runtime.fatigue.trend':
      if (!oneOf(value, ['stable', 'rising', 'falling'])) {
        errors.push(new ValidationError(path, 'must be stable|rising|falling', value));
      }
      break;

    case 'runtime.current_movement.phase':
      if (!oneOf(value, ['load', 'rotate', 'release', 'follow_through', 'rest', 'idle'])) {
        errors.push(new ValidationError(path, 'invalid movement phase', value));
      }
      break;

    case 'runtime.current_movement.intent_confidence':
    case 'runtime.current_movement.rhythm_match':
    case 'runtime.current_movement.last_rep_quality':
      if (!inRange(value, 0, 1)) {
        errors.push(new ValidationError(path, 'must be 0-1', value));
      }
      break;

    case 'runtime.current_movement.rep_count':
      if (!Number.isInteger(value) || value < 0) {
        errors.push(new ValidationError(path, 'must be a non-negative integer', value));
      }
      break;

    default:
      // For paths under runtime.compensation_drift and runtime.cumulative_load,
      // we allow flexible keys but validate the value structure
      if (path.startsWith('runtime.compensation_drift.')) {
        if (!isObject(value) || !isNumber(value.baseline) || !isNumber(value.current) || !isNumber(value.delta)) {
          errors.push(new ValidationError(path, 'must have numeric baseline, current, delta', value));
        }
      } else if (path.startsWith('runtime.cumulative_load.')) {
        if (!isObject(value) || !isNumber(value.units) || !isNumber(value.limit) || !isNumber(value.percentage)) {
          errors.push(new ValidationError(path, 'must have numeric units, limit, percentage', value));
        }
        if (value && isNumber(value.percentage) && !inRange(value.percentage, 0, 2)) {
          errors.push(new ValidationError(path, 'percentage should be 0-2 range', value.percentage));
        }
      } else if (path.startsWith('runtime.fatigue.per_zone.')) {
        if (!inRange(value, 0, 1)) {
          errors.push(new ValidationError(path, 'zone fatigue must be 0-1', value));
        }
      }
      break;
  }

  return errors;
}


// ---- Validate which KSG cell a path belongs to ----

export function getCellFromPath(path) {
  if (path.startsWith('passport')) return KSG_CELL.PASSPORT;
  if (path.startsWith('ontology')) return KSG_CELL.ONTOLOGY;
  if (path.startsWith('twin'))     return KSG_CELL.TWIN;
  if (path.startsWith('runtime'))  return KSG_CELL.RUNTIME;
  return null;
}

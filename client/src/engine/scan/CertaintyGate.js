// ============================================================
// CertaintyGate — Final Validation & Verdict per Limb
//
// PURE LOGIC — receives Phase A + Phase B results as parameters,
// returns a verdict per limb. Zero side effects.
//
// The Certainty Gate enforces the clinical-grade confidence policy:
//   - Confidence is BINARY: 1.0 or "unresolved". No partial values.
//   - Every limb must reach 100% confidence or the system retries.
//   - After max retries, falls back to ASK_USER (never guesses).
//
// Three possible verdicts per limb:
//   COMPLETE    — confident diagnosis, ready for Passport
//   RETRY       — inconclusive, need to repeat a specific movement
//   ASK_USER    — retries exhausted, must ask the user
//
// Input:
//   - Phase A routing decision (hypotheses per limb)
//   - Phase B limb assessments (damping, stability, compensation, etc.)
//   - Retry state (how many times each movement has been retried)
//
// Output:
//   - Per-limb verdict with Passport-ready field values
// ============================================================

import { LIMB_STATUS, DETECTION_METHOD, DAMPING_CLASS } from '../constants.js';


// ---- Constants ----

// Maximum retry attempts per movement before falling back to ASK_USER
const MAX_RETRIES_PER_MOVEMENT = 2;

// Limb keys (must match Passport schema)
const LIMB_KEYS = ['left_leg', 'right_leg', 'left_arm', 'right_arm'];

// Verdict types
const VERDICT = Object.freeze({
  COMPLETE:  'complete',
  RETRY:     'retry',
  ASK_USER:  'ask_user',
});


// ============================================================
// Main Public API
// ============================================================

/**
 * Evaluate all 4 limbs and produce a verdict for each.
 *
 * @param {Object} phaseAResult - Output from determineTrack()
 *   { track, is_wheelchair, hypotheses, verification_needed, reasoning }
 * @param {Object} phaseBResult - Output from analyzePhaseB()
 *   { limbs: { [limbKey]: LimbAssessment }, movements_analyzed, movements_total }
 * @param {Object.<string, number>} retryCounts - Map of movementId → retry count
 *   e.g. { 'beta_mini_squat': 1 }
 * @returns {GateResult}
 *
 * @typedef {Object} GateResult
 * @property {Object.<string, LimbVerdict>} limbs - Per-limb verdicts
 * @property {string} scan_status - 'complete' | 'needs_retry' | 'needs_user_input'
 * @property {RetryRequest[]} retries - Movements that need to be repeated
 * @property {UserQuery[]} user_queries - Questions to ask the user
 *
 * @typedef {Object} LimbVerdict
 * @property {string} verdict - 'complete' | 'retry' | 'ask_user'
 * @property {string} status - LIMB_STATUS value (for Passport)
 * @property {number|null} confidence - 1.0 or null
 * @property {string} detection_method - DETECTION_METHOD value
 * @property {number|null} damping_factor - ξ value or null
 * @property {string|null} damping_class - DAMPING_CLASS value or null
 * @property {string} reasoning - Why this verdict was reached
 *
 * @typedef {Object} RetryRequest
 * @property {string} movement_id - Which movement to retry
 * @property {string} limb - Which limb this is for
 * @property {string} reason - Why retry is needed
 * @property {number} attempt - Which attempt this will be (1-based)
 *
 * @typedef {Object} UserQuery
 * @property {string} limb - Which limb to ask about
 * @property {string} question_key - Machine-readable question type
 * @property {string} context - What we know so far
 */
export function evaluateCertainty(phaseAResult, phaseBResult, retryCounts = {}) {
  const limbVerdicts = {};
  const retries = [];
  const userQueries = [];

  for (const limbKey of LIMB_KEYS) {
    const hypothesis = phaseAResult?.hypotheses?.[limbKey] ?? null;
    const assessment = phaseBResult?.limbs?.[limbKey] ?? null;

    const verdict = evaluateSingleLimb(
      limbKey,
      hypothesis,
      assessment,
      phaseAResult?.is_wheelchair ?? false,
      retryCounts,
    );

    limbVerdicts[limbKey] = verdict;

    if (verdict.verdict === VERDICT.RETRY) {
      retries.push(...verdict._retryRequests);
    }
    if (verdict.verdict === VERDICT.ASK_USER) {
      userQueries.push(verdict._userQuery);
    }
  }

  // Determine overall scan status
  const hasRetries = retries.length > 0;
  const hasQueries = userQueries.length > 0;
  let scanStatus;
  if (!hasRetries && !hasQueries) {
    scanStatus = 'complete';
  } else if (hasRetries) {
    scanStatus = 'needs_retry';
  } else {
    scanStatus = 'needs_user_input';
  }

  // Clean internal fields from verdicts
  for (const v of Object.values(limbVerdicts)) {
    delete v._retryRequests;
    delete v._userQuery;
  }

  return {
    limbs: limbVerdicts,
    scan_status: scanStatus,
    retries,
    user_queries: userQueries,
  };
}


// ============================================================
// Single-Limb Evaluation
// ============================================================

/**
 * Produce a verdict for a single limb based on all available evidence.
 */
function evaluateSingleLimb(limbKey, hypothesis, assessment, isWheelchair, retryCounts) {
  // ---- Path 1: Phase A already determined absence ----
  if (hypothesis === 'absent') {
    return completeVerdict(
      LIMB_STATUS.ABSENT,
      DETECTION_METHOD.LANDMARK_ONLY,
      null,          // no damping for absent limb
      null,
      'Landmarks consistently absent during Phase A static scan',
    );
  }

  // ---- Path 2: Wheelchair user — legs get special status ----
  if (hypothesis === 'wheelchair_user') {
    return completeVerdict(
      LIMB_STATUS.UNRESOLVED,
      DETECTION_METHOD.VISUAL_ONLY,
      null,
      null,
      'Wheelchair detected — leg status deferred to user confirmation',
      // Wheelchair users need ASK_USER for legs since we can't assess them
      VERDICT.ASK_USER,
      {
        limb: limbKey,
        question_key: 'wheelchair_leg_status',
        context: 'Wheelchair detected. Cannot assess leg function from video. Please describe your leg condition.',
      },
    );
  }

  // ---- Path 3: No Phase B data available ----
  if (!assessment || !assessment.damping) {
    return unresolvedVerdict(limbKey, 'No Phase B analysis data available', retryCounts);
  }

  // ---- Path 4: Phase B produced a confident classification ----
  const dampingClass = assessment.overall_damping_class;
  const dampingFactor = assessment.overall_damping_factor;
  const crossValidation = assessment.cross_validation;

  switch (dampingClass) {
    case 'organic_healthy':
      return completeVerdict(
        LIMB_STATUS.ANATOMICAL_HEALTHY,
        DETECTION_METHOD.DAMPING_ANALYSIS,
        dampingFactor,
        DAMPING_CLASS.ORGANIC_HEALTHY,
        buildReasoning('Healthy organic damping response', dampingFactor, crossValidation),
      );

    case 'organic_weak':
      return completeVerdict(
        LIMB_STATUS.ANATOMICAL_WEAK,
        DETECTION_METHOD.DAMPING_ANALYSIS,
        dampingFactor,
        DAMPING_CLASS.ORGANIC_WEAK,
        buildReasoning('Weak organic damping — reduced neuromuscular control', dampingFactor, crossValidation),
      );

    case 'mechanical':
      return completeVerdict(
        LIMB_STATUS.PROSTHETIC_BELOW_KNEE,
        DETECTION_METHOD.DAMPING_ANALYSIS,
        dampingFactor,
        DAMPING_CLASS.MECHANICAL,
        buildReasoning('Mechanical damping profile — prosthetic characteristics', dampingFactor, crossValidation),
      );

    case 'inconclusive':
      return inconclusiveVerdict(limbKey, dampingFactor, assessment, retryCounts);

    default:
      return unresolvedVerdict(limbKey, `Unknown damping class: ${dampingClass}`, retryCounts);
  }
}


// ============================================================
// Verdict Builders
// ============================================================

/**
 * Build a COMPLETE verdict — confident diagnosis.
 */
function completeVerdict(status, detectionMethod, dampingFactor, dampingClass, reasoning, overrideVerdict, userQuery) {
  return {
    verdict: overrideVerdict ?? VERDICT.COMPLETE,
    status,
    confidence: overrideVerdict === VERDICT.ASK_USER ? null : 1.0,
    detection_method: detectionMethod,
    damping_factor: dampingFactor,
    damping_class: dampingClass,
    reasoning,
    _retryRequests: [],
    _userQuery: userQuery ?? null,
  };
}

/**
 * Build an INCONCLUSIVE verdict — decide between RETRY and ASK_USER.
 *
 * Strategy:
 *   1. Find the damping movement that produced this limb's data
 *   2. If retry count < MAX_RETRIES → RETRY that movement
 *   3. If retries exhausted → ASK_USER
 */
function inconclusiveVerdict(limbKey, dampingFactor, assessment, retryCounts) {
  // Find the best movement to retry — prefer the damping movement
  // that contributed to this limb's evidence
  const evidenceSources = assessment.evidence_sources || [];
  const retryMovementId = pickRetryMovement(evidenceSources, retryCounts);

  if (retryMovementId) {
    const attempt = (retryCounts[retryMovementId] ?? 0) + 1;
    return {
      verdict: VERDICT.RETRY,
      status: LIMB_STATUS.UNRESOLVED,
      confidence: null,
      detection_method: DETECTION_METHOD.DAMPING_ANALYSIS,
      damping_factor: dampingFactor,
      damping_class: null,
      reasoning: `Damping ratio ξ=${formatXi(dampingFactor)} falls in inconclusive zone (0.35-0.50) — retrying movement "${retryMovementId}" (attempt ${attempt}/${MAX_RETRIES_PER_MOVEMENT})`,
      _retryRequests: [{
        movement_id: retryMovementId,
        limb: limbKey,
        reason: `Inconclusive damping (ξ=${formatXi(dampingFactor)})`,
        attempt,
      }],
      _userQuery: null,
    };
  }

  // All retries exhausted → ask the user
  return {
    verdict: VERDICT.ASK_USER,
    status: LIMB_STATUS.UNRESOLVED,
    confidence: null,
    detection_method: DETECTION_METHOD.DAMPING_ANALYSIS,
    damping_factor: dampingFactor,
    damping_class: null,
    reasoning: `Damping ratio ξ=${formatXi(dampingFactor)} remains inconclusive after all retries — requesting user input`,
    _retryRequests: [],
    _userQuery: {
      limb: limbKey,
      question_key: 'inconclusive_damping',
      context: `We detected movement in your ${formatLimbName(limbKey)} but couldn't determine its exact condition. The damping analysis was inconclusive (ξ=${formatXi(dampingFactor)}). Do you have a prosthetic, brace, or known condition on this limb?`,
    },
  };
}

/**
 * Build an UNRESOLVED verdict when no damping data exists at all.
 */
function unresolvedVerdict(limbKey, reason, retryCounts) {
  // Check if there's ANY movement we can retry for this limb
  const allExhausted = allRetriesExhausted(retryCounts);

  if (!allExhausted) {
    return {
      verdict: VERDICT.RETRY,
      status: LIMB_STATUS.UNRESOLVED,
      confidence: null,
      detection_method: DETECTION_METHOD.DAMPING_ANALYSIS,
      damping_factor: null,
      damping_class: null,
      reasoning: `${reason} — will retry data collection`,
      _retryRequests: [{
        movement_id: null, // Sequencer should pick appropriate movement
        limb: limbKey,
        reason,
        attempt: 1,
      }],
      _userQuery: null,
    };
  }

  return {
    verdict: VERDICT.ASK_USER,
    status: LIMB_STATUS.UNRESOLVED,
    confidence: null,
    detection_method: DETECTION_METHOD.DAMPING_ANALYSIS,
    damping_factor: null,
    damping_class: null,
    reasoning: `${reason} — retries exhausted, requesting user input`,
    _retryRequests: [],
    _userQuery: {
      limb: limbKey,
      question_key: 'no_data',
      context: `We couldn't collect enough data to assess your ${formatLimbName(limbKey)}. Do you have any known conditions on this limb?`,
    },
  };
}


// ============================================================
// Retry Logic
// ============================================================

/**
 * Pick the best movement to retry from a list of evidence sources.
 * Returns movementId if retries available, null if all exhausted.
 */
function pickRetryMovement(evidenceSources, retryCounts) {
  // Try each evidence source — pick the first one with retries remaining
  for (const movementId of evidenceSources) {
    const count = retryCounts[movementId] ?? 0;
    if (count < MAX_RETRIES_PER_MOVEMENT) {
      return movementId;
    }
  }
  return null;
}

/**
 * Check if we should consider all retries exhausted (conservative fallback).
 * Used when there are no evidence sources to check.
 */
function allRetriesExhausted(retryCounts) {
  // If there are any retry counts recorded, and all are at max, we're done
  const counts = Object.values(retryCounts);
  if (counts.length === 0) return false; // No retries happened yet
  return counts.every(c => c >= MAX_RETRIES_PER_MOVEMENT);
}


// ============================================================
// Passport Field Builders
//
// These functions prepare the exact field values that will go
// into the Anatomic Passport. They ensure correctness before
// the data ever touches the Passport CRUD layer.
// ============================================================

/**
 * Extract Passport-ready limb data from a COMPLETE verdict.
 * Only call this on verdicts where verdict === 'complete'.
 *
 * @param {LimbVerdict} verdict - A complete verdict
 * @returns {Object} - Fields matching the Passport limb schema
 */
export function extractPassportFields(verdict) {
  if (verdict.verdict !== VERDICT.COMPLETE) {
    return null;
  }

  return {
    status: verdict.status,
    confidence: verdict.confidence,
    detection_method: verdict.detection_method,
    damping_factor: verdict.damping_factor,
    damping_class: verdict.damping_class,
    range_of_motion: inferRangeOfMotion(verdict),
    stiffness_profile: inferStiffnessProfile(verdict),
    notes: verdict.reasoning,
  };
}

/**
 * Infer range_of_motion from verdict data.
 */
function inferRangeOfMotion(verdict) {
  switch (verdict.status) {
    case LIMB_STATUS.ABSENT:
      return 'none';
    case LIMB_STATUS.ANATOMICAL_HEALTHY:
      return 'full';
    case LIMB_STATUS.ANATOMICAL_WEAK:
      return 'limited_organic';
    case LIMB_STATUS.PROSTHETIC_BELOW_KNEE:
    case LIMB_STATUS.PROSTHETIC_ABOVE_KNEE:
      return 'limited_mechanical';
    default:
      return 'full';
  }
}

/**
 * Infer stiffness_profile from verdict data.
 */
function inferStiffnessProfile(verdict) {
  switch (verdict.status) {
    case LIMB_STATUS.ABSENT:
      return null;
    case LIMB_STATUS.ANATOMICAL_HEALTHY:
    case LIMB_STATUS.ANATOMICAL_WEAK:
      return 'organic';
    case LIMB_STATUS.PROSTHETIC_BELOW_KNEE:
    case LIMB_STATUS.PROSTHETIC_ABOVE_KNEE:
      return 'mechanical';
    default:
      return 'organic';
  }
}


// ============================================================
// Formatting Helpers
// ============================================================

function formatXi(xi) {
  if (xi === null || xi === undefined) return 'N/A';
  return xi.toFixed(3);
}

function formatLimbName(limbKey) {
  const names = {
    left_leg: 'left leg',
    right_leg: 'right leg',
    left_arm: 'left arm',
    right_arm: 'right arm',
  };
  return names[limbKey] || limbKey;
}

/**
 * Build a reasoning string that includes cross-validation info.
 */
function buildReasoning(baseReason, dampingFactor, crossValidation) {
  let reason = `${baseReason} (ξ=${formatXi(dampingFactor)})`;
  if (crossValidation && crossValidation.applied_rules.length > 0) {
    reason += ` [cross-validated: ${crossValidation.reasons.join('; ')}]`;
  }
  return reason;
}


// ---- Export constants for testing ----
export { MAX_RETRIES_PER_MOVEMENT, VERDICT };

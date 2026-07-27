// ============================================================
// ScanSequencer — Scan Pipeline State Machine
//
// PURE LOGIC — no React, no DOM, no side effects.
// Receives pose frames via feedFrame(), manages the scan
// pipeline progression, calls analyzers at phase transitions.
//
// State machine (Smart Detection-First):
//   IDLE → CALIBRATING → PHASE_A → PROFILE_INPUT → PHASE_B_MOVEMENT → CERTAINTY → COMPLETE
//                                                                       → RETRY → CERTAINTY
//                                                                       → AWAITING_USER → COMPLETE
//
// Phase A sub-states:
//   DETECTION (2s) → Anatomical Profiler classifies joints automatically
//   DIAGNOSTICS    → track-specific guided movements
//
// Anatomical Profiler (automatic, no user input):
//   1. Image-Context Analysis (Prior) — visual analysis of first frame
//   2. Joint-by-joint variance analysis during detection
//   3. Silent re-calibration during diagnostics if classification was wrong
//
// Classification logic (comparative — both legs analyzed simultaneously):
//   Asymmetrically frozen joints determine prosthetic side (no guessing)
//   knee_var < 0.1 AND ankle_Yvar < 0.00005 → TRANSFEMORAL_AMPUTEE (above-knee)
//   knee_var > 0.5 AND ankle_Yvar < 0.00005 → TRANSTIBIAL_AMPUTEE (below-knee)
//   arm landmarks consistently invisible → ARM_AMPUTEE
//
// Diagnostic tracks:
//   WHEELCHAIR:           arms_raise → left_arm_circle → right_arm_circle
//   TRANSFEMORAL_AMPUTEE: hip_flexion → arms_raise
//   TRANSTIBIAL_AMPUTEE:  squats_healthy_knee (side-specific) → arms_raise
//   ARM_AMPUTEE:          squats → march_in_place
//   MEDICAL:              squats → march_in_place → arms_raise
//   NORMAL:               squats → march_in_place → arms_raise
//
// Strict blocking: segments advance ONLY on detected movement.
// No safety timeout — segments never advance without real movement.
// Visibility guard: halts if ankle/knee visibility < 0.5.
// ============================================================

import {
  analyzeObjectDetections,
  analyzeLandmarkIntegrity,
  determineTrack,
} from './PhaseAAnalyzer.js';
import { analyzePhaseB } from './PhaseBAnalyzer.js';
import { evaluateCertainty, extractPassportFields } from './CertaintyGate.js';
import { getMovementQueue, LM } from './movements.js';
import { LIMB_STATUS, DETECTION_METHOD } from '../constants.js';
import { validateTrainingProfile } from '../AnatomyProfile.js';
import {
  analyzeKinetics,
  inferProfileFromKinetics,
  analyzeGait,
  profileAnatomy,
  computeAngle,
  computeStats,
  JOINT_DEFS,
  ANATOMY,
  JOINT_FROZEN_VARIANCE,
} from '../KineticAnalyzer.js';


// ---- States ----

const STATE = Object.freeze({
  IDLE:                   'IDLE',
  CALIBRATING:            'CALIBRATING',
  PHASE_A:                'PHASE_A',
  PROFILE_INPUT:          'PROFILE_INPUT',
  PHASE_B_MOVEMENT:       'PHASE_B_MOVEMENT',
  CERTAINTY:              'CERTAINTY',
  RETRY:                  'RETRY',
  AWAITING_USER:          'AWAITING_USER',
  COMPLETE:               'COMPLETE',
  ERROR:                  'ERROR',
});


// ---- Progress Weights ----
// Calibration = 0-5%, Phase A = 5-30%, Phase B = 30-85%, Certainty/Retry = 85-100%

const PROGRESS_CALIBRATION_END = 0.05;
const PROGRESS_PHASE_A_START = 0.05;
const PROGRESS_PHASE_A_END = 0.30;
const PROGRESS_PHASE_A_RANGE = PROGRESS_PHASE_A_END - PROGRESS_PHASE_A_START;
const PROGRESS_PHASE_B_START = 0.30;
const PROGRESS_PHASE_B_END = 0.85;
const PROGRESS_PHASE_B_RANGE = PROGRESS_PHASE_B_END - PROGRESS_PHASE_B_START;


// ---- Calibration ----
// ALL 33 landmarks must have visibility >= this threshold to advance
const FULL_BODY_CONFIDENCE = 0.6;
const TOTAL_LANDMARKS = 33;

// Quality guard: minimum landmarks visible (visibility > 0.3) to continue scanning
const QUALITY_MIN_VISIBLE = 10;
const QUALITY_VISIBILITY_THRESHOLD = 0.3;
// Debounce: require N consecutive bad frames before declaring quality lost (2s at 30fps)
const QUALITY_DEBOUNCE_FRAMES = 60;


// ---- Instructions (bilingual) ----
const NOT_DETECTED_INSTRUCTION = 'Full body not detected. Please move back from the camera.';
const NOT_DETECTED_INSTRUCTION_HE = 'לא זוהה גוף מלא. אנא התרחק מהמצלמה';
const PROFILE_INPUT_INSTRUCTION = 'Complete your profile to continue';
const PROFILE_INPUT_INSTRUCTION_HE = 'מלא את הפרופיל שלך כדי להמשיך';
const QUALITY_LOST_INSTRUCTION = 'Tracking lost — hold still';
const QUALITY_LOST_INSTRUCTION_HE = 'מעקב אבד — עמוד במקום';
const COMPLETE_INSTRUCTION = 'Scan complete!';
const COMPLETE_INSTRUCTION_HE = 'הסריקה הושלמה!';
const AWAITING_USER_INSTRUCTION = 'Please answer a few questions about your body';
const AWAITING_USER_INSTRUCTION_HE = 'אנא ענה על כמה שאלות לגבי גופך';
const DETECTION_INSTRUCTION = 'Analyzing your body, please stand still...';
const DETECTION_INSTRUCTION_HE = 'מנתח את גופך, אנא עמוד במקום...';


// ---- Phase A Detection ----
const DETECTION_DURATION_SEC = 2;

// ---- Phase A Strict Blocking ----
// Movement must exceed this variance to advance (high bar — must be real movement, not noise)
const MOVEMENT_VARIANCE_THRESHOLD = 12.0;  // deg²
// Nudge repeat interval
const NUDGE_INTERVAL_SEC = 5;
// NO safety timeout — segments NEVER advance without real movement
// Gait detection: ankle Y-variance threshold for stepping motion
const GAIT_Y_VARIANCE_THRESHOLD = 0.001;

// ---- Landmark Visibility Guard ----
// If ankle/knee visibility drops below this, halt measurement and instruct user
const LANDMARK_VISIBILITY_HALT = 0.5;
// How often to re-emit visibility halt instruction (seconds)
const VISIBILITY_HALT_INTERVAL_SEC = 3;
const VISIBILITY_HALT_INSTRUCTION = "Camera can't detect your leg. Please move back or adjust the camera.";
const VISIBILITY_HALT_INSTRUCTION_HE = 'המצלמה לא מזהה את הרגל. אנא התרחק או כוון מחדש את המצלמה.';
// Prosthetic detection: if a limb's landmarks are visible in less than this ratio of frames, it's prosthetic
const PROSTHETIC_VISIBILITY_RATIO = 0.2;

// ---- Anatomical Profiler ----
// Image context confidence threshold
const IMAGE_CONTEXT_CONFIDENCE = 0.7;

// Side-aware anatomical adaptation messages
// Built dynamically via _buildAnatomyMessage(classification, side)
const SIDE_LABELS = { left: 'left', right: 'right' };
const SIDE_LABELS_HE = { left: 'שמאל', right: 'ימין' };

/**
 * Build a detection message like:
 * "Prosthesis detected on left leg (above-knee). Switching to adapted training"
 */
function _buildAnatomyMessage(classification, side) {
  const sideLabel = SIDE_LABELS[side] || side;
  if (classification === 'transfemoral') {
    return `above-knee prosthesis detected on ${sideLabel} leg. Switching to adapted training`;
  }
  return `below-knee prosthesis detected on ${sideLabel} leg. Switching to adapted training`;
}
function _buildAnatomyMessageHe(classification, side) {
  const sideLabel = SIDE_LABELS_HE[side] || side;
  if (classification === 'transfemoral') {
    return `זוהתה פרוטזה מעל הברך ברגל ${sideLabel}. עובר לאימון מותאם`;
  }
  return `זוהתה פרוטזה מתחת לברך ברגל ${sideLabel}. עובר לאימון מותאם`;
}
// Fallback for arm amputee (no side-specific message needed)
const ARM_AMPUTEE_MESSAGE = 'Arm prosthesis detected. Switching to adapted training';
const ARM_AMPUTEE_MESSAGE_HE = 'זוהתה פרוטזת יד. עובר לאימון מותאם';
// Bilateral amputee messages
const BILATERAL_MESSAGE = 'Bilateral profile detected. Activating core and hip training mode';
const BILATERAL_MESSAGE_HE = 'זוהה פרופיל דו-צדדי. מפעיל מצב אימון לליבה וירכיים';
// Mid-diagnostic recalibration variance threshold
const MIDDIAG_FROZEN_VARIANCE = 1.0; // deg² — same as JOINT_FROZEN_VARIANCE
// Camera reposition message (when joints untracked)
const REPOSITION_CAMERA_INSTRUCTION = 'Please position the camera so your feet and ankles are visible';
const REPOSITION_CAMERA_INSTRUCTION_HE = 'נא למקם את המצלמה כך שניתן יהיה לראות את כפות הרגליים והקרסוליים';

// ---- Motion Calibration ----
const MOTION_CAL_MOVEMENTS = [
  { id: 'raise_right_hand',
    instruction: 'Please raise your RIGHT hand above your head',
    instruction_he: 'אנא הרם את יד ימין מעל הראש' },
  { id: 'slight_bend',
    instruction: 'Please do a slight knee bend',
    instruction_he: 'אנא בצע כפיפת ברכיים קלה' },
  { id: 'pelvis_rotation',
    instruction: 'Please rotate your pelvis left and right',
    instruction_he: 'אנא סובב את האגן ימינה ושמאלה' },
  { id: 'calf_raise',
    instruction: 'Please stand on your tiptoes (calf raise)',
    instruction_he: 'אנא בצע עמידה קלה על קצות האצבעות' },
];
const MOTION_CAL_FRAMES_PER_MOVEMENT = 90; // 3 seconds at 30fps
const MOTION_CAL_WRIST_THRESHOLD = 0.12;   // Y decrease for hand raise
const MOTION_CAL_KNEE_THRESHOLD = 3.0;     // degrees angle change
const MOTION_CAL_HIP_THRESHOLD = 0.015;    // hip X difference range
const MOTION_CAL_ANKLE_THRESHOLD = 0.008;  // ankle Y range for calf raise

// ---- Confidence Gate ----
const CONFIDENCE_THRESHOLD = 0.95;

// ---- Detection Blocked ----
const DETECTION_BLOCKED_INSTRUCTION = 'Detection inconclusive. Please ensure full body is visible and stand naturally.';
const DETECTION_BLOCKED_INSTRUCTION_HE = 'הזיהוי לא חד-משמעי. אנא ודא שכל הגוף נראה ועמוד בצורה טבעית.';

const VISION_ANALYZING_INSTRUCTION = 'Analyzing your body with AI vision...';
const VISION_ANALYZING_INSTRUCTION_HE = 'מנתח את גופך באמצעות ראייה ממוחשבת...';


// ---- Diagnostic Tracks ----
// Each track is an array of segments tailored to the detected condition.

const DIAG_TRACKS = Object.freeze({
  WHEELCHAIR: [
    {
      id: 'arms_raise',
      instruction_en: 'Raise both arms above your head and lower them',
      instruction_he: 'הרם את שתי הידיים מעל הראש והורד אותן',
      durationSec: 8,
      minDurationSec: 4,
      targetJoints: ['left_elbow', 'right_elbow'],
      nudge_en: 'Please try to raise your arms, no movement detected',
      nudge_he: 'אנא נסה להרים את הידיים, לא זוהתה תנועה',
    },
    {
      id: 'left_arm_circle',
      instruction_en: 'Circle your left arm slowly',
      instruction_he: 'סובב את יד שמאל לאט',
      durationSec: 6,
      minDurationSec: 3,
      targetJoints: ['left_elbow'],
      nudge_en: 'Please try to move your left arm, no movement detected',
      nudge_he: 'אנא נסה להניע את יד שמאל, לא זוהתה תנועה',
    },
    {
      id: 'right_arm_circle',
      instruction_en: 'Circle your right arm slowly',
      instruction_he: 'סובב את יד ימין לאט',
      durationSec: 6,
      minDurationSec: 3,
      targetJoints: ['right_elbow'],
      nudge_en: 'Please try to move your right arm, no movement detected',
      nudge_he: 'אנא נסה להניע את יד ימין, לא זוהתה תנועה',
    },
  ],

  TRANSFEMORAL_AMPUTEE: [
    {
      id: 'hip_flexion',
      instruction_en: 'Swing your leg forward and back from the hip',
      instruction_he: 'נדנד את הרגל קדימה ואחורה מהירך',
      durationSec: 10,
      minDurationSec: 5,
      targetJoints: ['left_hip', 'right_hip'],
      nudge_en: 'Please try to swing your leg from the hip, no movement detected',
      nudge_he: 'אנא נסה לנדנד את הרגל מהירך, לא זוהתה תנועה',
    },
    {
      id: 'arms_raise',
      instruction_en: 'Raise both arms above your head and lower them',
      instruction_he: 'הרם את שתי הידיים מעל הראש והורד אותן',
      durationSec: 6,
      minDurationSec: 3,
      targetJoints: ['left_elbow', 'right_elbow'],
      nudge_en: 'Please try to raise your arms, no movement detected',
      nudge_he: 'אנא נסה להרים את הידיים, לא זוהתה תנועה',
    },
  ],

  BILATERAL_AMPUTEE: [
    {
      id: 'seated_hip_flexion',
      instruction_en: 'While seated, lift each knee toward your chest alternately',
      instruction_he: 'בישיבה, הרם כל ברך לכיוון החזה לסירוגין',
      durationSec: 10,
      minDurationSec: 5,
      targetJoints: ['left_hip', 'right_hip'],
      nudge_en: 'Please try to lift your knees while seated, no movement detected',
      nudge_he: 'אנא נסה להרים את הברכיים בישיבה, לא זוהתה תנועה',
    },
    {
      id: 'arms_raise',
      instruction_en: 'Raise both arms above your head and lower them',
      instruction_he: 'הרם את שתי הידיים מעל הראש והורד אותן',
      durationSec: 6,
      minDurationSec: 3,
      targetJoints: ['left_elbow', 'right_elbow'],
      nudge_en: 'Please try to raise your arms, no movement detected',
      nudge_he: 'אנא נסה להרים את הידיים, לא זוהתה תנועה',
    },
  ],

  ARM_AMPUTEE: [
    {
      id: 'squats',
      instruction_en: 'Please do 5 slow knee bends',
      instruction_he: 'אנא בצע 5 כפיפות ברכיים איטיות',
      durationSec: 10,
      minDurationSec: 5,
      targetJoints: ['left_knee', 'right_knee'],
      nudge_en: 'Please try to bend your knees, no movement detected',
      nudge_he: 'אנא נסה לכופף את הברכיים, לא זוהתה תנועה',
    },
    {
      id: 'march_in_place',
      instruction_en: 'Please do 5 steps in place',
      instruction_he: 'אנא בצע 5 צעדים במקום',
      durationSec: 10,
      minDurationSec: 5,
      useGaitDetection: true,
      nudge_en: 'Please try to march in place, no movement detected',
      nudge_he: 'אנא נסה לצעוד במקום, לא זוהתה תנועה',
    },
  ],

  MEDICAL: [
    {
      id: 'squats',
      instruction_en: 'Please do 5 slow knee bends',
      instruction_he: 'אנא בצע 5 כפיפות ברכיים איטיות',
      durationSec: 10,
      minDurationSec: 5,
      targetJoints: ['left_knee', 'right_knee'],
      nudge_en: 'Please try to bend your knees, no movement detected',
      nudge_he: 'אנא נסה לכופף את הברכיים, לא זוהתה תנועה',
    },
    {
      id: 'march_in_place',
      instruction_en: 'Please do 5 steps in place',
      instruction_he: 'אנא בצע 5 צעדים במקום',
      durationSec: 10,
      minDurationSec: 5,
      useGaitDetection: true,
      nudge_en: 'Please try to march in place, no movement detected',
      nudge_he: 'אנא נסה לצעוד במקום, לא זוהתה תנועה',
    },
    {
      id: 'arms_raise',
      instruction_en: 'Raise both arms above your head and lower them',
      instruction_he: 'הרם את שתי הידיים מעל הראש והורד אותן',
      durationSec: 6,
      minDurationSec: 3,
      targetJoints: ['left_elbow', 'right_elbow'],
      nudge_en: 'Please try to raise your arms, no movement detected',
      nudge_he: 'אנא נסה להרים את הידיים, לא זוהתה תנועה',
    },
  ],

  NORMAL: [
    {
      id: 'squats',
      instruction_en: 'Please do 5 slow knee bends',
      instruction_he: 'אנא בצע 5 כפיפות ברכיים איטיות',
      durationSec: 10,
      minDurationSec: 5,
      targetJoints: ['left_knee', 'right_knee'],
      nudge_en: 'Please try to bend your knees, no movement detected',
      nudge_he: 'אנא נסה לכופף את הברכיים, לא זוהתה תנועה',
    },
    {
      id: 'march_in_place',
      instruction_en: 'Please do 5 steps in place',
      instruction_he: 'אנא בצע 5 צעדים במקום',
      durationSec: 10,
      minDurationSec: 5,
      useGaitDetection: true,
      nudge_en: 'Please try to march in place, no movement detected',
      nudge_he: 'אנא נסה לצעוד במקום, לא זוהתה תנועה',
    },
    {
      id: 'arms_raise',
      instruction_en: 'Raise both arms above your head and lower them',
      instruction_he: 'הרם את שתי הידיים מעל הראש והורד אותן',
      durationSec: 6,
      minDurationSec: 3,
      targetJoints: ['left_elbow', 'right_elbow'],
      nudge_en: 'Please try to raise your arms, no movement detected',
      nudge_he: 'אנא נסה להרים את הידיים, לא זוהתה תנועה',
    },
  ],
});


// ============================================================
// ScanSequencer Class
// ============================================================

export class ScanSequencer {

  /**
   * @param {Object} options
   * @param {number} [options.sampleRate=30] - Camera FPS
   */
  constructor({ sampleRate = 30, skipMotionCalibration = false } = {}) {
    this._sampleRate = sampleRate;
    this._skipMotionCalibration = skipMotionCalibration;
    this._reset();
  }


  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Start the scan. Transitions IDLE → CALIBRATING.
   * @returns {StateChange}
   */
  start() {
    if (this._state !== STATE.IDLE) {
      this._reset();
    }

    this._state = STATE.CALIBRATING;
    this._startTime = Date.now();

    return {
      state: STATE.CALIBRATING,
      progress: 0,
      instruction: NOT_DETECTED_INSTRUCTION,
      instruction_he: NOT_DETECTED_INSTRUCTION_HE,
    };
  }

  /**
   * Abort the scan. Returns to IDLE.
   */
  stop() {
    this._state = STATE.IDLE;
  }

  /**
   * Full reset — clears all data and returns to IDLE.
   */
  reset() {
    this._reset();
  }

  /**
   * Report a detection error — resets scan with stricter criteria.
   * Call this when the user indicates the system detected wrong.
   * @returns {StateChange}
   */
  reportDetectionError() {
    this._reset();
    this._strictMode = true; // Preserved: _reset sets IDLE, start() won't re-reset
    return this.start();
  }

  /**
   * Feed vision diagnosis result from external API (Claude Vision).
   * Called by the UI hook after the server responds.
   * @param {Object} diagnosis - { classification, adaptedTrack, prostheticSide, aids, confidence, description, description_he, specialProtocol }
   * @returns {StateChange|null}
   */
  setVisionResult(diagnosis) {
    if (this._state !== STATE.PHASE_A || this._phaseASubState !== 'visionDiagnosis') return null;
    this._visionResult = diagnosis;
    this._awaitingVision = false;
    this._awaitingConfirmation = true;

    // Multi-layer comparison: compare vision with kinetic
    if (this._kineticResult && this._kineticResult.adaptedTrack) {
      diagnosis.kineticAgreement = (this._kineticResult.adaptedTrack === diagnosis.adaptedTrack);
    } else {
      diagnosis.kineticAgreement = diagnosis.adaptedTrack === 'NORMAL' || diagnosis.adaptedTrack === null;
    }

    return {
      state: STATE.PHASE_A,
      subState: 'visionDiagnosis',
      awaitingConfirmation: true,
      diagnosis,
      instruction: `Diagnosed: ${diagnosis.description}. Is this accurate?`,
      instruction_he: `אבחנתי: ${diagnosis.description_he}. האם זה מדויק?`,
      progress: this.progress,
    };
  }

  /**
   * User confirms the vision diagnosis — proceed to diagnostics with the determined track.
   * @returns {StateChange|null}
   */
  confirmDiagnosis() {
    if (!this._awaitingConfirmation || this._phaseASubState !== 'visionDiagnosis') return null;
    this._visionConfirmed = true;
    this._awaitingConfirmation = false;

    const diagnosis = this._visionResult;
    const trackKey = diagnosis.adaptedTrack || 'NORMAL';

    // Update detected condition from vision result
    this._detectedCondition = this._detectedCondition || {};
    if (diagnosis.prostheticSide) {
      this._detectedCondition.affectedSide = diagnosis.prostheticSide;
    }
    if (diagnosis.aids && diagnosis.aids.length > 0) {
      this._detectedCondition.aids = diagnosis.aids;
    }
    if (diagnosis.specialProtocol) {
      this._detectedCondition.specialProtocol = diagnosis.specialProtocol;
    }

    // Store anatomy classification from vision
    this._anatomyClassification = {
      ...(this._anatomyClassification || {}),
      visionClassification: diagnosis.classification,
      visionConfidence: diagnosis.confidence,
      visionConfirmed: true,
    };

    return this._transitionToDiagnostics(
      trackKey,
      diagnosis.description,
      diagnosis.description_he,
      diagnosis.prostheticSide !== 'bilateral' ? diagnosis.prostheticSide : null,
    );
  }

  /**
   * User rejects the vision diagnosis — restart scan with strict mode.
   * @returns {StateChange}
   */
  rejectDiagnosis() {
    if (!this._awaitingConfirmation || this._phaseASubState !== 'visionDiagnosis') return null;
    this._reset();
    this._strictMode = true;
    return this.start();
  }


  // ============================================================
  // Frame Input — the core method
  // ============================================================

  /**
   * Feed one camera frame into the sequencer.
   *
   * @param {Object[]} landmarks - MediaPipe 33-landmark array
   * @param {Object[]|null} objectDetections - COCO object detections (Phase A only)
   * @returns {StateChange|null} - Non-null when something meaningful changed
   */
  feedFrame(landmarks, objectDetections = null) {
    // Skip in terminal, waiting, or input states
    if (
      this._state === STATE.IDLE ||
      this._state === STATE.COMPLETE ||
      this._state === STATE.ERROR ||
      this._state === STATE.AWAITING_USER ||
      this._state === STATE.PROFILE_INPUT
    ) {
      return null;
    }

    // Skip null/invalid frames — don't error, just ignore
    if (!landmarks || !Array.isArray(landmarks)) {
      return null;
    }

    this._totalFrameCount++;

    // Calibrating — check for full body visibility
    if (this._state === STATE.CALIBRATING) {
      return this._handleCalibrating(landmarks, objectDetections);
    }

    // Frame quality guard (applies to PHASE_A, PHASE_B_MOVEMENT, RETRY)
    const qualityScanStates = [STATE.PHASE_A, STATE.PHASE_B_MOVEMENT, STATE.RETRY];
    if (qualityScanStates.includes(this._state)) {
      const quality = ScanSequencer.checkFrameQuality(landmarks);

      if (this._qualityPaused) {
        if (quality) {
          // Recovered — resume scanning
          this._qualityPaused = false;
          this._qualityBadFrames = 0;
          return {
            state: this._state,
            progress: this.progress,
            qualityResume: true,
            instruction: this.currentInstruction,
            instruction_he: this._getCurrentInstructionHe(),
          };
        }
        // Still paused — skip this frame
        return null;
      }

      if (!quality) {
        // Bad frame — increment debounce counter
        this._qualityBadFrames++;
        if (this._qualityBadFrames >= QUALITY_DEBOUNCE_FRAMES) {
          // 2 seconds of bad frames — pause
          this._qualityPaused = true;
          return {
            state: this._state,
            progress: this.progress,
            qualityPause: true,
            instruction: QUALITY_LOST_INSTRUCTION,
            instruction_he: QUALITY_LOST_INSTRUCTION_HE,
          };
        }
        // Still within debounce window — continue scanning but skip this frame's data
        return null;
      }

      // Good frame — reset debounce counter
      this._qualityBadFrames = 0;
    }

    switch (this._state) {
      case STATE.PHASE_A:
        return this._handlePhaseA(landmarks, objectDetections);
      case STATE.PHASE_B_MOVEMENT:
        return this._handlePhaseBMovement(landmarks);
      case STATE.RETRY:
        return this._handleRetry(landmarks);
      default:
        return null;
    }
  }


  // ============================================================
  // User Input — for ASK_USER verdicts
  // ============================================================

  /**
   * Submit a user answer for an ASK_USER verdict.
   *
   * @param {string} limbKey - 'left_leg', 'right_leg', 'left_arm', 'right_arm'
   * @param {Object} answer - { status: LIMB_STATUS value, description?: string }
   * @returns {StateChange|null}
   */
  submitUserAnswer(limbKey, answer) {
    if (this._state !== STATE.AWAITING_USER) return null;

    this._userAnswers[limbKey] = answer;

    // Check if all queries answered
    const allAnswered = this._pendingUserQueries.every(
      q => this._userAnswers[q.limb] !== undefined,
    );

    if (!allAnswered) {
      return {
        state: STATE.AWAITING_USER,
        progress: 0.95,
        remainingQueries: this._pendingUserQueries.filter(
          q => this._userAnswers[q.limb] === undefined,
        ),
      };
    }

    // All answered — apply to gate result and finalize
    return this._finalizeWithUserInput();
  }


  // ============================================================
  // Image Context — Visual Analysis Prior
  // ============================================================

  /**
   * Set the image context from visual analysis of the captured snapshot.
   * Called by UI after analyzing the first detection frame.
   * Can arrive asynchronously during detection phase.
   *
   * @param {{ prosthetic: boolean, wheelchair: boolean, crutches: boolean, confidence: number }} context
   */
  setImageContext(context) {
    if (this._state !== STATE.PHASE_A) return;
    this._imageContext = context;
  }


  // ============================================================
  // Getters
  // ============================================================

  get state()              { return this._state; }
  get phaseAResult()       { return this._phaseAResult; }
  get phaseBResult()       { return this._phaseBResult; }
  get error()              { return this._error; }

  get currentInstruction() {
    if (this._state === STATE.CALIBRATING) return NOT_DETECTED_INSTRUCTION;
    if (this._state === STATE.PHASE_A) {
      if (this._phaseASubState === 'detection') return DETECTION_INSTRUCTION;
      const diag = this._diagnosticSegments?.[this._diagnosticIndex];
      return diag?.instruction_en ?? null;
    }
    if (this._state === STATE.PROFILE_INPUT) return PROFILE_INPUT_INSTRUCTION;
    if (this._state === STATE.PHASE_B_MOVEMENT || this._state === STATE.RETRY) {
      const movement = this._getCurrentMovement();
      return movement?.instruction_en ?? null;
    }
    if (this._state === STATE.COMPLETE) return COMPLETE_INSTRUCTION;
    return null;
  }

  get currentInstructionHe() {
    return this._getCurrentInstructionHe();
  }

  get progress() {
    switch (this._state) {
      case STATE.IDLE:
        return 0;
      case STATE.CALIBRATING:
        return 0;
      case STATE.PHASE_A: {
        if (this._phaseASubState === 'detection') {
          const detProgress = this._detectionFrameTarget > 0
            ? Math.min(this._landmarkFrames.length / this._detectionFrameTarget, 1)
            : 0;
          return PROGRESS_PHASE_A_START + detProgress * PROGRESS_PHASE_A_RANGE * 0.08;
        }
        // diagnostics sub-phase
        const totalSegments = this._diagnosticSegments.length;
        if (totalSegments === 0) return PROGRESS_PHASE_A_START;
        const segFrames = this._landmarkFrames.length - this._diagnosticSegmentStart;
        const diagIdx = Math.min(this._diagnosticIndex, totalSegments - 1);
        const diag = this._diagnosticSegments[diagIdx];
        const segMax = Math.floor(diag.durationSec * this._sampleRate);
        const segProgress = Math.min(segFrames / segMax, 1);
        const overallSegProgress = (this._diagnosticIndex + segProgress) / totalSegments;
        return PROGRESS_PHASE_A_START + 0.08 * PROGRESS_PHASE_A_RANGE
          + overallSegProgress * PROGRESS_PHASE_A_RANGE * 0.92;
      }
      case STATE.PROFILE_INPUT:
        return PROGRESS_PHASE_A_END;
      case STATE.PHASE_B_MOVEMENT: {
        if (this._movementQueue.length === 0) return PROGRESS_PHASE_B_START;
        const perMovement = PROGRESS_PHASE_B_RANGE / this._movementQueue.length;
        const movementProgress = this._currentMovementFrameTarget > 0
          ? this._currentMovementFrames.length / this._currentMovementFrameTarget
          : 0;
        return PROGRESS_PHASE_B_START
          + (this._movementIndex * perMovement)
          + (movementProgress * perMovement);
      }
      case STATE.CERTAINTY:
      case STATE.RETRY:
        return 0.88;
      case STATE.AWAITING_USER:
        return 0.95;
      case STATE.COMPLETE:
        return 1.0;
      default:
        return 0;
    }
  }

  get result() {
    if (this._state !== STATE.COMPLETE) return null;
    const result = {
      gateResult: this._gateResult,
      passportFields: this._passportFields,
      phaseAResult: this._phaseAResult,
      phaseBResult: this._phaseBResult,
      scanDuration: (Date.now() - this._startTime) / 1000,
      totalFrames: this._totalFrameCount,
    };
    if (this._anatomyProfile) {
      result.anatomyProfile = { ...this._anatomyProfile };
    }
    if (this._anatomyClassification) {
      result.anatomyClassification = this._anatomyClassification;
    }
    if (this._kineticProfile) {
      result.kineticProfile = this._kineticProfile;
    }
    return result;
  }


  // ============================================================
  // Calibration — Hermetic Full-Body Gate
  //
  // RULES:
  //   1. ALL 33 landmarks must have visibility >= 0.6
  //   2. No guessing, no questions, no limb queries
  //   3. Single message if not detected
  //   4. Immediate advance to PHASE_A detection sub-phase
  // ============================================================

  /** @private */
  _handleCalibrating(landmarks, objectDetections) {
    this._calibrationFrameCount++;

    // Check if ALL 33 landmarks have visibility >= 0.6
    const allVisible = landmarks.length >= TOTAL_LANDMARKS &&
      landmarks.every(lm => lm && lm.visibility >= FULL_BODY_CONFIDENCE);

    if (allVisible) {
      this._state = STATE.PHASE_A;

      if (this._skipMotionCalibration) {
        // Skip motion calibration — go straight to detection (for legacy/testing)
        this._phaseASubState = 'detection';
        this._detectionFrameStart = 0;
        this._detectionFrameTarget = Math.floor(
          (this._strictMode ? 4 : DETECTION_DURATION_SEC) * this._sampleRate);
        return {
          state: STATE.PHASE_A,
          progress: PROGRESS_PHASE_A_START,
          instruction: DETECTION_INSTRUCTION,
          instruction_he: DETECTION_INSTRUCTION_HE,
          subState: 'detection',
        };
      }

      // Full body detected — advance to motion calibration sub-phase
      this._phaseASubState = 'motionCalibration';
      this._motionCalIndex = 0;
      this._motionCalFrames = [];
      this._motionCalBaseline = null;
      this._calfRaiseResult = null;
      const first = MOTION_CAL_MOVEMENTS[0];
      return {
        state: STATE.PHASE_A,
        progress: PROGRESS_PHASE_A_START,
        instruction: first.instruction,
        instruction_he: first.instruction_he,
        subState: 'motionCalibration',
        motionCalStep: 0,
        motionCalTotal: MOTION_CAL_MOVEMENTS.length,
      };
    }

    // Count visible landmarks for UI feedback
    let visibleCount = 0;
    for (let i = 0; i < Math.min(landmarks.length, TOTAL_LANDMARKS); i++) {
      if (landmarks[i] && landmarks[i].visibility >= FULL_BODY_CONFIDENCE) {
        visibleCount++;
      }
    }

    // Not detected — single persistent message
    return {
      state: STATE.CALIBRATING,
      progress: 0,
      instruction: NOT_DETECTED_INSTRUCTION,
      instruction_he: NOT_DETECTED_INSTRUCTION_HE,
      calibrationInfo: {
        visibleCount,
        totalRequired: TOTAL_LANDMARKS,
        framesCollected: this._calibrationFrameCount,
      },
    };
  }


  // ============================================================
  // Profile Input — Training form AFTER Phase A
  // Anatomy is auto-inferred by KineticAnalyzer during Phase A.
  // Only training fields are collected here.
  // ============================================================

  /**
   * Set the anatomy/training profile data during PROFILE_INPUT.
   * Must be called before confirmProfile() will succeed.
   *
   * @param {Object} profileData - Training profile fields + kinetic-inferred anatomy
   * @returns {StateChange|null}
   */
  setAnatomyProfile(profileData) {
    if (this._state !== STATE.PROFILE_INPUT) return null;
    this._anatomyProfile = profileData;
    return {
      state: STATE.PROFILE_INPUT,
      progress: PROGRESS_PHASE_A_END,
      anatomyProfile: this._anatomyProfile,
    };
  }

  /**
   * Confirm the profile and advance to PHASE_B_MOVEMENT.
   * Validates only training fields (anatomy is auto-inferred).
   *
   * @returns {StateChange|null}
   */
  confirmProfile() {
    if (this._state !== STATE.PROFILE_INPUT) return null;

    // Profile gate — must be set and training fields valid
    if (!this._anatomyProfile) {
      return {
        state: STATE.PROFILE_INPUT,
        progress: PROGRESS_PHASE_A_END,
        error: 'anatomy_profile_required',
      };
    }
    const validation = validateTrainingProfile(this._anatomyProfile);
    if (!validation.valid) {
      return {
        state: STATE.PROFILE_INPUT,
        progress: PROGRESS_PHASE_A_END,
        error: 'anatomy_profile_incomplete',
        missingFields: validation.missingFields,
        validationErrors: validation.errors,
      };
    }

    // Advance to first Phase B movement
    return this._startNextMovement();
  }


  // ============================================================
  // Frame Quality Check (static)
  // ============================================================

  /**
   * Check if a landmark frame has sufficient quality to continue scanning.
   * Returns true if >= 10 of 33 landmarks have visibility > 0.3.
   *
   * @param {Object[]} landmarks - MediaPipe 33-landmark array
   * @returns {boolean}
   */
  static checkFrameQuality(landmarks) {
    if (!landmarks || !Array.isArray(landmarks)) return false;
    let visible = 0;
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (lm && lm.visibility > QUALITY_VISIBILITY_THRESHOLD) {
        visible++;
      }
    }
    return visible >= QUALITY_MIN_VISIBLE;
  }


  // ============================================================
  // Phase A — Smart Detection + Guided Diagnostics
  //
  // Sub-state 1: DETECTION (2 seconds)
  //   Collect frames, run object detection + landmark integrity +
  //   anatomical profiler → auto-determine track
  //
  // Sub-state 2: DIAGNOSTICS (track-specific segments)
  //   Strict blocking: segments advance only on detected movement.
  //   Nudge repeats every 5s if no movement. No safety timeout.
  //   Silent recalibration if frozen joints detected mid-segment.
  // ============================================================

  /** @private */
  _handlePhaseA(landmarks, objectDetections) {
    // Apply mirror correction if detected
    const correctedLandmarks = this._correctMirror(landmarks);

    this._landmarkFrames.push(correctedLandmarks);
    if (objectDetections) {
      this._objectFrames.push(objectDetections);
    }

    if (this._phaseASubState === 'motionCalibration') {
      return this._handleMotionCalibration(correctedLandmarks);
    }
    if (this._phaseASubState === 'detection') {
      return this._handleDetection();
    }
    if (this._phaseASubState === 'visionDiagnosis') {
      // Blocked — waiting for external vision result or user confirmation
      return null;
    }
    return this._handleDiagnostics();
  }

  /**
   * Mirror correction: swap left/right landmarks if camera is mirrored.
   * @private
   */
  _correctMirror(landmarks) {
    if (!this._mirrored) return landmarks;
    const corrected = [...landmarks];
    const pairs = [
      [LM.LEFT_HIP, LM.RIGHT_HIP],
      [LM.LEFT_KNEE, LM.RIGHT_KNEE],
      [LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
      [LM.LEFT_HEEL, LM.RIGHT_HEEL],
      [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
      [LM.LEFT_ELBOW, LM.RIGHT_ELBOW],
      [LM.LEFT_WRIST, LM.RIGHT_WRIST],
    ];
    for (const [l, r] of pairs) {
      const temp = corrected[l];
      corrected[l] = corrected[r];
      corrected[r] = temp;
    }
    return corrected;
  }

  /**
   * Motion calibration sub-phase: 4 test movements to verify body orientation.
   * Detects mirror (flipped camera) and measures per-leg ankle function.
   * @private
   */
  _handleMotionCalibration(landmarks) {
    const movement = MOTION_CAL_MOVEMENTS[this._motionCalIndex];

    // Capture baseline on first frame
    if (this._motionCalFrames.length === 0) {
      this._motionCalBaseline = landmarks;
    }
    this._motionCalFrames.push(landmarks);

    // Check if movement threshold met
    let detected = false;

    if (movement.id === 'raise_right_hand') {
      // Check if RIGHT wrist Y decreased significantly (raised)
      const baseY = this._motionCalBaseline[LM.RIGHT_WRIST]?.y || 0;
      const currY = landmarks[LM.RIGHT_WRIST]?.y || 0;
      const rightDelta = baseY - currY;
      // Also check LEFT wrist to detect mirror
      const leftBaseY = this._motionCalBaseline[LM.LEFT_WRIST]?.y || 0;
      const leftCurrY = landmarks[LM.LEFT_WRIST]?.y || 0;
      const leftDelta = leftBaseY - leftCurrY;

      if (rightDelta >= MOTION_CAL_WRIST_THRESHOLD) {
        detected = true;
      } else if (leftDelta >= MOTION_CAL_WRIST_THRESHOLD && rightDelta < MOTION_CAL_WRIST_THRESHOLD * 0.3) {
        // LEFT wrist rose instead of RIGHT → camera is mirrored
        this._mirrored = true;
        detected = true;
      }
    } else if (movement.id === 'slight_bend') {
      // Check knee angle change (any side)
      const baseAngle = this._computeKneeAngle(this._motionCalBaseline);
      const currAngle = this._computeKneeAngle(landmarks);
      if (baseAngle !== null && currAngle !== null && Math.abs(currAngle - baseAngle) >= MOTION_CAL_KNEE_THRESHOLD) {
        detected = true;
      }
    } else if (movement.id === 'pelvis_rotation') {
      // Check hip X difference range across collected frames
      const hipXDiffs = this._motionCalFrames.map(f => {
        const lh = f[LM.LEFT_HIP], rh = f[LM.RIGHT_HIP];
        if (!lh || !rh) return null;
        return Math.abs(lh.x - rh.x);
      }).filter(v => v !== null);
      if (hipXDiffs.length >= 10) {
        const range = Math.max(...hipXDiffs) - Math.min(...hipXDiffs);
        if (range >= MOTION_CAL_HIP_THRESHOLD) detected = true;
      }
    } else if (movement.id === 'calf_raise') {
      // Measure both ankles' Y range
      const leftAnkleY = this._motionCalFrames.map(f => f[LM.LEFT_ANKLE]?.y).filter(v => v != null);
      const rightAnkleY = this._motionCalFrames.map(f => f[LM.RIGHT_ANKLE]?.y).filter(v => v != null);
      if (leftAnkleY.length >= 15 && rightAnkleY.length >= 15) {
        const leftRange = Math.max(...leftAnkleY) - Math.min(...leftAnkleY);
        const rightRange = Math.max(...rightAnkleY) - Math.min(...rightAnkleY);
        // Any ankle moved = detected
        if (leftRange >= MOTION_CAL_ANKLE_THRESHOLD || rightRange >= MOTION_CAL_ANKLE_THRESHOLD) {
          detected = true;
        }
        // Store calf raise result regardless
        this._calfRaiseResult = {
          leftAnkleRange: leftRange,
          rightAnkleRange: rightRange,
          leftAnkleMoved: leftRange >= MOTION_CAL_ANKLE_THRESHOLD,
          rightAnkleMoved: rightRange >= MOTION_CAL_ANKLE_THRESHOLD,
        };
      }
    }

    // Timeout: auto-advance after max frames even if not detected
    if (detected || this._motionCalFrames.length >= MOTION_CAL_FRAMES_PER_MOVEMENT) {
      // Store calf raise result if this was the last movement and not yet stored
      if (movement.id === 'calf_raise' && !this._calfRaiseResult) {
        const leftAnkleY = this._motionCalFrames.map(f => f[LM.LEFT_ANKLE]?.y).filter(v => v != null);
        const rightAnkleY = this._motionCalFrames.map(f => f[LM.RIGHT_ANKLE]?.y).filter(v => v != null);
        const leftRange = leftAnkleY.length > 0 ? Math.max(...leftAnkleY) - Math.min(...leftAnkleY) : 0;
        const rightRange = rightAnkleY.length > 0 ? Math.max(...rightAnkleY) - Math.min(...rightAnkleY) : 0;
        this._calfRaiseResult = {
          leftAnkleRange: leftRange,
          rightAnkleRange: rightRange,
          leftAnkleMoved: leftRange >= MOTION_CAL_ANKLE_THRESHOLD,
          rightAnkleMoved: rightRange >= MOTION_CAL_ANKLE_THRESHOLD,
        };
      }

      // Advance to next movement or transition to detection
      this._motionCalIndex++;
      this._motionCalFrames = [];
      this._motionCalBaseline = null;

      if (this._motionCalIndex >= MOTION_CAL_MOVEMENTS.length) {
        // All calibration movements done — transition to detection
        this._phaseASubState = 'detection';
        this._detectionFrameStart = this._landmarkFrames.length;
        this._detectionFrameTarget = this._landmarkFrames.length +
          Math.floor((this._strictMode ? 4 : DETECTION_DURATION_SEC) * this._sampleRate);
        return {
          state: STATE.PHASE_A,
          subState: 'detection',
          progress: this.progress,
          instruction: DETECTION_INSTRUCTION,
          instruction_he: DETECTION_INSTRUCTION_HE,
          mirrored: this._mirrored,
          calfRaiseResult: this._calfRaiseResult,
        };
      }

      // Next movement
      const next = MOTION_CAL_MOVEMENTS[this._motionCalIndex];
      return {
        state: STATE.PHASE_A,
        subState: 'motionCalibration',
        progress: this.progress,
        instruction: next.instruction,
        instruction_he: next.instruction_he,
        motionCalStep: this._motionCalIndex,
        motionCalTotal: MOTION_CAL_MOVEMENTS.length,
        mirrored: this._mirrored,
      };
    }

    // Still collecting — emit ankle status during calf raise for visualization
    if (movement.id === 'calf_raise') {
      return {
        state: STATE.PHASE_A,
        subState: 'motionCalibration',
        progress: this.progress,
        instruction: movement.instruction,
        instruction_he: movement.instruction_he,
        motionCalStep: this._motionCalIndex,
        motionCalTotal: MOTION_CAL_MOVEMENTS.length,
        ankleStatus: this._computeAnkleStatus(),
      };
    }

    return null; // Still collecting, no state change
  }

  /** @private */
  _computeKneeAngle(frame) {
    const hip = frame[LM.LEFT_HIP];
    const knee = frame[LM.LEFT_KNEE];
    const ankle = frame[LM.LEFT_ANKLE];
    if (!hip || !knee || !ankle) return null;
    return computeAngle(hip, knee, ankle);
  }

  /** @private — compute per-frame ankle visibility/motion status */
  _computeAnkleStatus() {
    const windowSize = Math.min(30, this._landmarkFrames.length);
    const recent = this._landmarkFrames.slice(-windowSize);

    const computeSide = (ankleIdx) => {
      const visible = recent.length > 0 && recent[recent.length - 1][ankleIdx]?.visibility >= 0.5;
      const yValues = recent.map(f => f[ankleIdx]?.y).filter(v => v != null);
      let moving = false;
      if (yValues.length >= 5) {
        const mean = yValues.reduce((s, v) => s + v, 0) / yValues.length;
        const variance = yValues.reduce((s, v) => s + (v - mean) ** 2, 0) / yValues.length;
        moving = variance > 0.00005; // ANKLE_FROZEN_THRESHOLD
      }
      return { visible, moving };
    };

    return {
      left: computeSide(LM.LEFT_ANKLE),
      right: computeSide(LM.RIGHT_ANKLE),
    };
  }

  /**
   * Detection sub-phase: collect frames for DETECTION_DURATION_SEC,
   * then analyze to determine diagnostic track automatically.
   *
   * Priority cascade:
   *   1. Image Context (Prior) — visual analysis of first frame
   *   2. Anatomical Profiler — joint-by-joint variance analysis
   *   3. Object detection + landmark integrity + limb visibility
   *   4. Default → NORMAL
   *
   * No user confirmation — auto-routes and shows adaptation message.
   * @private
   */
  _handleDetection() {
    // Emit captureSnapshot on the first detection frame
    if (!this._snapshotEmitted) {
      this._snapshotEmitted = true;
      if (this._landmarkFrames.length < this._detectionFrameTarget) {
        return {
          state: STATE.PHASE_A,
          subState: 'detection',
          captureSnapshot: true,
          progress: this.progress,
          instruction: DETECTION_INSTRUCTION,
          instruction_he: DETECTION_INSTRUCTION_HE,
        };
      }
    }

    if (this._landmarkFrames.length < this._detectionFrameTarget) {
      // Emit ankle status during collection for UI visualization (only in full diagnostic mode)
      if (!this._skipMotionCalibration && this._landmarkFrames.length % 10 === 0) {
        return {
          state: STATE.PHASE_A,
          subState: 'detection',
          progress: this.progress,
          ankleStatus: this._computeAnkleStatus(),
        };
      }
      return null; // Still collecting
    }

    // Run detection analyzers
    const aidDetection = analyzeObjectDetections(this._objectFrames);
    const integrity = analyzeLandmarkIntegrity(this._landmarkFrames);

    // Standard track determination
    let trackKey;
    const missingLimbs = [];

    if (aidDetection.wheelchair.detected) {
      trackKey = 'WHEELCHAIR';
    } else if (aidDetection.crutches.detected) {
      for (const [limbKey, limbData] of Object.entries(integrity)) {
        if (limbData.preliminary_status === 'likely_absent') {
          missingLimbs.push(limbKey);
        }
      }
      trackKey = missingLimbs.length > 0 ? 'TRANSFEMORAL_AMPUTEE' : 'MEDICAL';
    } else {
      trackKey = 'NORMAL';
    }

    // Prosthetic detection via visibility
    const limbVisibility = this._analyzeLimbVisibility(
      this._landmarkFrames.slice(this._detectionFrameStart || 0, this._detectionFrameTarget),
    );
    for (const [limbKey, ratio] of Object.entries(limbVisibility)) {
      if (ratio < PROSTHETIC_VISIBILITY_RATIO) {
        if (!missingLimbs.includes(limbKey)) {
          missingLimbs.push(limbKey);
        }
      }
    }
    if (missingLimbs.length > 0 && trackKey === 'NORMAL') {
      trackKey = 'TRANSFEMORAL_AMPUTEE';
    }

    // Store detection results
    this._detectedCondition = {
      wheelchair: aidDetection.wheelchair.detected,
      crutches: aidDetection.crutches.detected,
      missingLimbs,
      aidDetection,
      integrity,
    };

    // ── LAYER 1: Image Context (Prior) — highest priority ──
    if (this._imageContext && this._imageContext.confidence >= IMAGE_CONTEXT_CONFIDENCE) {
      if (this._imageContext.prosthetic) {
        trackKey = 'TRANSFEMORAL_AMPUTEE';
      } else if (this._imageContext.wheelchair) {
        trackKey = 'WHEELCHAIR';
      }
      return this._transitionToDiagnostics(trackKey);
    }

    // ── LAYER 2: Anatomical Profiler — auto-classify joints ──
    const detectionFrames = this._landmarkFrames.slice(this._detectionFrameStart || 0, this._detectionFrameTarget);
    const anatomyResult = profileAnatomy(detectionFrames, {
      integrativeAnalysis: !this._skipMotionCalibration,
      strictMode: this._strictMode || false,
      calfRaiseResult: this._calfRaiseResult || undefined,
    });
    this._anatomyClassification = anatomyResult;

    // ── VISION-FIRST DIAGNOSTIC ──
    // In full diagnostic mode (motion calibration enabled), transition to visionDiagnosis.
    // In legacy/test mode (skipMotionCalibration), go directly to diagnostics.
    if (!this._skipMotionCalibration) {
      this._kineticResult = anatomyResult;
      this._phaseASubState = 'visionDiagnosis';
      this._awaitingVision = true;
      this._awaitingConfirmation = false;

      return {
        state: STATE.PHASE_A,
        subState: 'visionDiagnosis',
        awaitingVision: true,
        captureFrames: true,
        kineticResult: {
          adaptedTrack: anatomyResult.adaptedTrack || null,
          classification: anatomyResult.classification || null,
          affectedSide: anatomyResult.affectedSide || null,
          frozenJoints: anatomyResult.affectedLimbs || [],
          hipDeviation: anatomyResult.hipDeviation || null,
          cogBias: anatomyResult.cogBias || null,
        },
        progress: this.progress,
        instruction: VISION_ANALYZING_INSTRUCTION,
        instruction_he: VISION_ANALYZING_INSTRUCTION_HE,
      };
    }

    // ── Legacy path: direct to diagnostics (skipMotionCalibration mode) ──
    if (anatomyResult.insufficientConfidence) {
      return {
        state: STATE.PHASE_A,
        subState: 'detection',
        blocked: true,
        confidence: anatomyResult.integrativeConfidence || 0,
        instruction: DETECTION_BLOCKED_INSTRUCTION,
        instruction_he: DETECTION_BLOCKED_INSTRUCTION_HE,
        progress: this.progress,
      };
    }

    if (anatomyResult.adaptedTrack) {
      trackKey = anatomyResult.adaptedTrack;
      this._detectedCondition.missingLimbs = anatomyResult.affectedLimbs;
      this._detectedCondition.affectedSide = anatomyResult.affectedSide;

      let msg, msgHe;
      if (anatomyResult.classification === 'bilateral') {
        msg = BILATERAL_MESSAGE;
        msgHe = BILATERAL_MESSAGE_HE;
      } else if (anatomyResult.classification === 'arm_amputee') {
        msg = ARM_AMPUTEE_MESSAGE;
        msgHe = ARM_AMPUTEE_MESSAGE_HE;
      } else {
        msg = _buildAnatomyMessage(anatomyResult.classification, anatomyResult.affectedSide);
        msgHe = _buildAnatomyMessageHe(anatomyResult.classification, anatomyResult.affectedSide);
      }

      return this._transitionToDiagnostics(trackKey, msg, msgHe, anatomyResult.affectedSide);
    }

    const untrackedLegs = (anatomyResult.untrackedJoints || []).filter(
      j => j.includes('ankle') || j.includes('knee'),
    );
    const repositionNeeded = untrackedLegs.length > 0;
    if (repositionNeeded && trackKey !== 'WHEELCHAIR') {
      trackKey = 'NORMAL';
    }

    const diagResult = this._transitionToDiagnostics(trackKey);
    if (repositionNeeded) {
      diagResult.repositionNeeded = true;
      diagResult.repositionInstruction = REPOSITION_CAMERA_INSTRUCTION;
      diagResult.repositionInstruction_he = REPOSITION_CAMERA_INSTRUCTION_HE;
      diagResult.untrackedJoints = anatomyResult.untrackedJoints;
    }
    return diagResult;
  }

  /**
   * Transition from detection to diagnostics sub-phase with the given track.
   * For TRANSTIBIAL_AMPUTEE, builds side-specific segments that measure
   * only the healthy knee.
   *
   * @param {string} trackKey - DIAG_TRACKS key
   * @param {string} [anatomyMessage] - optional anatomy adaptation message (English)
   * @param {string} [anatomyMessageHe] - optional anatomy adaptation message (Hebrew)
   * @param {string} [affectedSide] - 'left' | 'right' — the prosthetic side
   * @private
   */
  _transitionToDiagnostics(trackKey, anatomyMessage, anatomyMessageHe, affectedSide) {
    this._phaseASubState = 'diagnostics';
    this._diagnosticTrack = trackKey;

    // Build side-specific segments for TRANSTIBIAL (always dynamic)
    if (trackKey === 'TRANSTIBIAL_AMPUTEE') {
      this._diagnosticSegments = _buildTranstibialSegments(affectedSide || 'left');
    } else {
      this._diagnosticSegments = DIAG_TRACKS[trackKey];
    }

    this._diagnosticIndex = 0;
    this._diagnosticSegmentStart = this._landmarkFrames.length;
    this._lastNudgeFrame = this._diagnosticSegmentStart;

    const first = this._diagnosticSegments[0];
    const result = {
      state: STATE.PHASE_A,
      progress: this.progress,
      instruction: first.instruction_en,
      instruction_he: first.instruction_he,
      subState: 'diagnostics',
      diagnosticTrack: trackKey,
      diagnosticSegment: 0,
      detectedCondition: this._detectedCondition,
    };
    if (anatomyMessage) {
      result.anatomyMessage = anatomyMessage;
      result.anatomyMessage_he = anatomyMessageHe;
    }
    if (affectedSide) {
      result.affectedSide = affectedSide;
    }
    return result;
  }

  /**
   * Diagnostics sub-phase: strict blocking movement checks.
   * Segments advance ONLY when real movement detected.
   * NO safety timeout — segments never advance without movement.
   * Visibility guard halts if ankle/knee landmarks not visible.
   * Silent recalibration: detects frozen joints → reroutes to adapted track.
   * @private
   */
  _handleDiagnostics() {
    // All segments done?
    if (this._diagnosticIndex >= this._diagnosticSegments.length) {
      return this._completePhaseA();
    }

    const diag = this._diagnosticSegments[this._diagnosticIndex];
    const currentFrame = this._landmarkFrames[this._landmarkFrames.length - 1];

    // ── Visibility guard: halt if target leg landmarks not visible ──
    if (this._hasLowLegVisibility(currentFrame, diag)) {
      const haltInterval = Math.floor(VISIBILITY_HALT_INTERVAL_SEC * this._sampleRate);
      const sinceLastHalt = this._landmarkFrames.length - this._lastVisibilityHaltFrame;
      if (sinceLastHalt >= haltInterval || this._lastVisibilityHaltFrame === 0) {
        this._lastVisibilityHaltFrame = this._landmarkFrames.length;
        return {
          state: STATE.PHASE_A,
          progress: this.progress,
          instruction: VISIBILITY_HALT_INSTRUCTION,
          instruction_he: VISIBILITY_HALT_INSTRUCTION_HE,
          visibilityHalt: true,
        };
      }
      return null; // Still halted, throttled
    }

    const segmentFrames = this._landmarkFrames.length - this._diagnosticSegmentStart;
    const minFrames = Math.floor(diag.minDurationSec * this._sampleRate);
    const nudgeInterval = Math.floor(NUDGE_INTERVAL_SEC * this._sampleRate);

    // Get segment frames for analysis
    const segFrameSlice = this._landmarkFrames.slice(this._diagnosticSegmentStart);

    // ── Silent recalibration: detect frozen joints → reroute to adapted track ──
    if (!this._recalibratedMidDiag &&
        this._diagnosticTrack !== 'TRANSFEMORAL_AMPUTEE' &&
        this._diagnosticTrack !== 'TRANSTIBIAL_AMPUTEE' &&
        this._diagnosticTrack !== 'BILATERAL_AMPUTEE' &&
        this._diagnosticTrack !== 'ARM_AMPUTEE' &&
        segmentFrames >= minFrames &&
        diag.targetJoints) {
      for (const jointKey of diag.targetJoints) {
        // In TRANSTIBIAL track, prosthetic knee moves normally — never flag it as frozen
        if (this._diagnosticTrack === 'TRANSTIBIAL_AMPUTEE') {
          const affSide = this._anatomyClassification?.affectedSide;
          if (affSide && jointKey === `${affSide}_knee`) continue;
        }
        const indices = JOINT_DEFS[jointKey];
        if (!indices) continue;
        const angles = _extractAnglesFromFrames(segFrameSlice, indices);
        if (angles.length >= minFrames) {
          const stats = computeStats(angles);
          if (stats.variance < MIDDIAG_FROZEN_VARIANCE) {
            // Frozen joint detected — silent recalibration
            this._recalibratedMidDiag = true;

            // Re-profile anatomy with all frames collected so far
            const anatomyResult = profileAnatomy(this._landmarkFrames);
            this._anatomyClassification = anatomyResult;

            const newTrack = anatomyResult.adaptedTrack || 'TRANSFEMORAL_AMPUTEE';
            this._diagnosticTrack = newTrack;
            const affSide = anatomyResult.affectedSide;

            // Build side-specific segments for TRANSTIBIAL (always dynamic)
            if (newTrack === 'TRANSTIBIAL_AMPUTEE') {
              this._diagnosticSegments = _buildTranstibialSegments(affSide || 'left');
            } else {
              this._diagnosticSegments = DIAG_TRACKS[newTrack];
            }
            this._diagnosticIndex = 0;
            this._diagnosticSegmentStart = this._landmarkFrames.length;
            this._lastNudgeFrame = this._diagnosticSegmentStart;

            const first = this._diagnosticSegments[0];
            let msg, msgHe;
            if (anatomyResult.classification === 'bilateral') {
              msg = BILATERAL_MESSAGE;
              msgHe = BILATERAL_MESSAGE_HE;
            } else if (anatomyResult.classification === 'arm_amputee') {
              msg = ARM_AMPUTEE_MESSAGE;
              msgHe = ARM_AMPUTEE_MESSAGE_HE;
            } else if (affSide) {
              msg = _buildAnatomyMessage(anatomyResult.classification, affSide);
              msgHe = _buildAnatomyMessageHe(anatomyResult.classification, affSide);
            } else {
              msg = _buildAnatomyMessage('transfemoral', 'left');
              msgHe = _buildAnatomyMessageHe('transfemoral', 'left');
            }
            return {
              state: STATE.PHASE_A,
              subState: 'diagnostics',
              diagnosticTrack: newTrack,
              diagnosticSegment: 0,
              instruction: first.instruction_en,
              instruction_he: first.instruction_he,
              anatomyMessage: msg,
              anatomyMessage_he: msgHe,
              affectedSide: affSide,
              progress: this.progress,
              rerouted: true,
            };
          }
        }
      }
    }

    // 1. Movement check — advance ONLY when real movement detected + min time passed
    if (segmentFrames >= minFrames) {
      const hasMoved = diag.useGaitDetection
        ? this._hasGaitMovement(segFrameSlice)
        : this._hasEnoughMovement(segFrameSlice, diag.targetJoints);

      if (hasMoved) {
        return this._advanceDiagnostic();
      }
    }

    // 2. NO safety timeout — segment stays here until movement is detected

    // 3. Repeat nudge every NUDGE_INTERVAL_SEC if no movement
    const framesSinceLastNudge = this._landmarkFrames.length - this._lastNudgeFrame;
    if (framesSinceLastNudge >= nudgeInterval && segmentFrames >= minFrames) {
      const isStatic = diag.useGaitDetection
        ? !this._hasGaitMovement(segFrameSlice)
        : this._isJointStatic(segFrameSlice, diag.targetJoints);

      if (isStatic) {
        this._lastNudgeFrame = this._landmarkFrames.length;
        return {
          state: STATE.PHASE_A,
          progress: this.progress,
          instruction: diag.nudge_en,
          instruction_he: diag.nudge_he,
          nudge: true,
        };
      }
    }

    return null;
  }

  /**
   * Advance to next diagnostic segment or complete Phase A.
   * @private
   */
  _advanceDiagnostic() {
    this._diagnosticIndex++;
    this._diagnosticSegmentStart = this._landmarkFrames.length;
    this._lastNudgeFrame = this._landmarkFrames.length;

    if (this._diagnosticIndex >= this._diagnosticSegments.length) {
      return this._completePhaseA();
    }

    const next = this._diagnosticSegments[this._diagnosticIndex];
    return {
      state: STATE.PHASE_A,
      progress: this.progress,
      instruction: next.instruction_en,
      instruction_he: next.instruction_he,
      diagnosticSegment: this._diagnosticIndex,
    };
  }

  /**
   * Complete Phase A — run kinetic + gait analysis, transition to PROFILE_INPUT.
   * @private
   */
  _completePhaseA() {
    try {
      // Use detection results already collected
      if (this._detectedCondition) {
        this._aidDetection = this._detectedCondition.aidDetection;
        const integrity = this._detectedCondition.integrity;
        this._phaseAResult = determineTrack(this._aidDetection, integrity);
      } else {
        this._aidDetection = analyzeObjectDetections(this._objectFrames);
        const integrity = analyzeLandmarkIntegrity(this._landmarkFrames);
        this._phaseAResult = determineTrack(this._aidDetection, integrity);
      }

      // Kinetic analysis on ALL Phase A frames (detection + diagnostics)
      this._kineticProfile = analyzeKinetics(this._landmarkFrames);

      // Gait analysis if march_in_place was performed
      if (this._diagnosticSegments?.some(s => s.id === 'march_in_place')) {
        this._gaitProfile = analyzeGait(this._landmarkFrames, this._sampleRate);
        this._kineticProfile.gait = this._gaitProfile;
      }

      // Auto-infer disability profile from kinetics
      this._kineticInferredProfile = inferProfileFromKinetics(
        this._kineticProfile,
        null,
      );

      // Build movement queue for Phase B
      this._movementQueue = getMovementQueue(
        this._phaseAResult.track,
        this._phaseAResult.is_wheelchair,
      );
      this._movementIndex = 0;

      // Transition to PROFILE_INPUT
      this._state = STATE.PROFILE_INPUT;
      return {
        state: STATE.PROFILE_INPUT,
        progress: PROGRESS_PHASE_A_END,
        instruction: PROFILE_INPUT_INSTRUCTION,
        instruction_he: PROFILE_INPUT_INSTRUCTION_HE,
        kineticProfile: this._kineticProfile,
        kineticInferredProfile: this._kineticInferredProfile,
        detectedCondition: this._detectedCondition,
      };
    } catch (err) {
      return this._setError(err);
    }
  }

  /**
   * Returns true if ALL target joints have variance below MOVEMENT_VARIANCE_THRESHOLD.
   * @private
   */
  _isJointStatic(frames, targetJoints) {
    if (!targetJoints) return true;
    for (const jointKey of targetJoints) {
      const indices = JOINT_DEFS[jointKey];
      if (!indices) continue;
      const angles = _extractAnglesFromFrames(frames, indices);
      if (angles.length >= 10) {
        const stats = computeStats(angles);
        if (stats.variance >= MOVEMENT_VARIANCE_THRESHOLD) return false;
      }
    }
    return true;
  }

  /**
   * Returns true if ANY target joint has variance above MOVEMENT_VARIANCE_THRESHOLD.
   * High threshold (12.0 deg²) ensures only real movement passes, not camera noise.
   * @private
   */
  _hasEnoughMovement(frames, targetJoints) {
    if (!targetJoints) return false;
    for (const jointKey of targetJoints) {
      const indices = JOINT_DEFS[jointKey];
      if (!indices) continue;
      const angles = _extractAnglesFromFrames(frames, indices);
      if (angles.length >= 10) {
        const stats = computeStats(angles);
        if (stats.variance >= MOVEMENT_VARIANCE_THRESHOLD) return true;
      }
    }
    return false;
  }

  /**
   * Detect stepping motion via ankle Y-variance (for march_in_place segments).
   * @private
   */
  _hasGaitMovement(frames) {
    if (frames.length < 10) return false;
    const leftAnkleY = [];
    const rightAnkleY = [];
    for (const frame of frames) {
      const la = frame[27]; // LEFT_ANKLE
      const ra = frame[28]; // RIGHT_ANKLE
      if (la?.visibility > 0.3) leftAnkleY.push(la.y);
      if (ra?.visibility > 0.3) rightAnkleY.push(ra.y);
    }
    const leftStats = computeStats(leftAnkleY);
    const rightStats = computeStats(rightAnkleY);
    return leftStats.variance >= GAIT_Y_VARIANCE_THRESHOLD
        || rightStats.variance >= GAIT_Y_VARIANCE_THRESHOLD;
  }


  /**
   * Check if the current frame has low visibility on leg landmarks
   * required by the current diagnostic segment.
   * Returns true if ANY target leg landmark has visibility < LANDMARK_VISIBILITY_HALT.
   * Only applies to leg segments (knee/ankle targets or gait detection).
   * @private
   */
  _hasLowLegVisibility(frame, diag) {
    const indicesToCheck = [];

    if (diag.useGaitDetection) {
      // Gait segments: check ankles
      indicesToCheck.push(27, 28); // LEFT_ANKLE, RIGHT_ANKLE
    } else if (diag.targetJoints) {
      // Joint-based segments: only check leg joints (knee)
      for (const jointKey of diag.targetJoints) {
        if (jointKey.includes('knee')) {
          const indices = JOINT_DEFS[jointKey];
          if (indices) {
            indicesToCheck.push(indices[1]); // knee landmark
            indicesToCheck.push(indices[2]); // ankle landmark
          }
        }
      }
    }

    if (indicesToCheck.length === 0) return false; // Not a leg segment

    for (const idx of indicesToCheck) {
      const lm = frame[idx];
      if (!lm || lm.visibility < LANDMARK_VISIBILITY_HALT) {
        return true;
      }
    }

    return false;
  }

  /**
   * Analyze limb visibility across detection frames.
   * Returns ratio of frames where each leg's knee+ankle are both visible (>= 0.5).
   * Low ratio = likely prosthetic (not temporary occlusion).
   * @private
   */
  _analyzeLimbVisibility(frames) {
    const counts = { left_leg: 0, right_leg: 0 };
    for (const frame of frames) {
      const lk = frame[25]; // LEFT_KNEE
      const la = frame[27]; // LEFT_ANKLE
      if (lk?.visibility >= LANDMARK_VISIBILITY_HALT &&
          la?.visibility >= LANDMARK_VISIBILITY_HALT) {
        counts.left_leg++;
      }
      const rk = frame[26]; // RIGHT_KNEE
      const ra = frame[28]; // RIGHT_ANKLE
      if (rk?.visibility >= LANDMARK_VISIBILITY_HALT &&
          ra?.visibility >= LANDMARK_VISIBILITY_HALT) {
        counts.right_leg++;
      }
    }
    const total = frames.length || 1;
    return {
      left_leg: counts.left_leg / total,
      right_leg: counts.right_leg / total,
    };
  }


  // ============================================================
  // Phase B — Guided Movements
  // ============================================================

  /** @private */
  _handlePhaseBMovement(landmarks) {
    this._currentMovementFrames.push(landmarks);

    if (this._currentMovementFrames.length < this._currentMovementFrameTarget) {
      return null; // Still collecting
    }

    // Movement complete — stash data and advance
    const movement = this._movementQueue[this._movementIndex];
    this._movementDataList.push({
      movement,
      frames: this._currentMovementFrames,
      sampleRate: this._sampleRate,
    });

    this._movementIndex++;
    return this._startNextMovement();
  }

  /**
   * Advance to the next movement, or transition to Certainty if done.
   * @private
   */
  _startNextMovement() {
    if (this._movementIndex >= this._movementQueue.length) {
      // All movements done — evaluate
      return this._runCertaintyGate();
    }

    const movement = this._movementQueue[this._movementIndex];
    this._currentMovementFrames = [];
    this._currentMovementFrameTarget = Math.floor(
      (movement.duration_ms / 1000) * this._sampleRate,
    );
    this._state = STATE.PHASE_B_MOVEMENT;

    return {
      state: STATE.PHASE_B_MOVEMENT,
      progress: this.progress,
      instruction: movement.instruction_en,
      instruction_he: movement.instruction_he,
      movementId: movement.id,
      movementIndex: this._movementIndex,
      movementTotal: this._movementQueue.length,
    };
  }


  // ============================================================
  // Certainty Gate
  // ============================================================

  /** @private */
  _runCertaintyGate() {
    this._state = STATE.CERTAINTY;

    try {
      this._phaseBResult = analyzePhaseB(this._movementDataList);
      this._gateResult = evaluateCertainty(
        this._phaseAResult,
        this._phaseBResult,
        this._retryCounts,
      );

      const { scan_status } = this._gateResult;

      if (scan_status === 'complete') {
        return this._finalize();
      }

      if (scan_status === 'needs_retry') {
        this._retryQueue = this._gateResult.retries;
        this._retryIndex = 0;
        return this._startNextRetry();
      }

      if (scan_status === 'needs_user_input') {
        this._pendingUserQueries = this._gateResult.user_queries;
        this._state = STATE.AWAITING_USER;
        return {
          state: STATE.AWAITING_USER,
          progress: 0.95,
          instruction: AWAITING_USER_INSTRUCTION,
          instruction_he: AWAITING_USER_INSTRUCTION_HE,
          userQueries: this._pendingUserQueries,
        };
      }

      // Unexpected scan_status — treat as error
      return this._setError(new Error(`Unexpected scan_status: ${scan_status}`));
    } catch (err) {
      return this._setError(err);
    }
  }


  // ============================================================
  // Retry Logic
  // ============================================================

  /** @private */
  _startNextRetry() {
    if (this._retryIndex >= this._retryQueue.length) {
      // All retries done — re-evaluate
      return this._runCertaintyGate();
    }

    const retry = this._retryQueue[this._retryIndex];

    // Find the movement definition
    const movement = retry.movement_id
      ? this._movementQueue.find(m => m.id === retry.movement_id)
      : null;

    if (!movement) {
      // Can't find movement to retry — skip
      this._retryIndex++;
      return this._startNextRetry();
    }

    // Increment retry count
    this._retryCounts[movement.id] = (this._retryCounts[movement.id] || 0) + 1;

    this._currentMovementFrames = [];
    this._currentMovementFrameTarget = Math.floor(
      (movement.duration_ms / 1000) * this._sampleRate,
    );
    this._currentRetryMovement = movement;
    this._state = STATE.RETRY;

    return {
      state: STATE.RETRY,
      progress: 0.88,
      instruction: movement.instruction_en,
      instruction_he: movement.instruction_he,
      movementId: movement.id,
      retryAttempt: this._retryCounts[movement.id],
    };
  }

  /** @private */
  _handleRetry(landmarks) {
    this._currentMovementFrames.push(landmarks);

    if (this._currentMovementFrames.length < this._currentMovementFrameTarget) {
      return null;
    }

    // Retry movement complete — stash and advance
    this._movementDataList.push({
      movement: this._currentRetryMovement,
      frames: this._currentMovementFrames,
      sampleRate: this._sampleRate,
    });

    this._retryIndex++;
    return this._startNextRetry();
  }


  // ============================================================
  // Finalization
  // ============================================================

  /** @private */
  _finalize() {
    this._state = STATE.COMPLETE;

    // Extract passport-ready fields for each limb
    this._passportFields = {};
    for (const [limbKey, verdict] of Object.entries(this._gateResult.limbs)) {
      this._passportFields[limbKey] = extractPassportFields(verdict);
    }

    return {
      state: STATE.COMPLETE,
      progress: 1.0,
      instruction: COMPLETE_INSTRUCTION,
      instruction_he: COMPLETE_INSTRUCTION_HE,
      result: this.result,
    };
  }

  /**
   * Apply user answers to unresolved limbs and finalize.
   * @private
   */
  _finalizeWithUserInput() {
    for (const [limbKey, answer] of Object.entries(this._userAnswers)) {
      const limb = this._gateResult.limbs[limbKey];
      if (!limb) continue;

      limb.status = answer.status || LIMB_STATUS.UNRESOLVED;
      limb.confidence = 1.0;
      limb.detection_method = DETECTION_METHOD.USER_REPORTED;
      limb.verdict = 'complete';
      limb.reasoning = `User reported: ${answer.description || answer.status}`;
    }

    return this._finalize();
  }


  // ============================================================
  // Internal Helpers
  // ============================================================

  /** @private */
  _getCurrentInstructionHe() {
    if (this._state === STATE.CALIBRATING) return NOT_DETECTED_INSTRUCTION_HE;
    if (this._state === STATE.PHASE_A) {
      if (this._phaseASubState === 'detection') return DETECTION_INSTRUCTION_HE;
      const diag = this._diagnosticSegments?.[this._diagnosticIndex];
      return diag?.instruction_he ?? null;
    }
    if (this._state === STATE.PROFILE_INPUT) return PROFILE_INPUT_INSTRUCTION_HE;
    if (this._state === STATE.PHASE_B_MOVEMENT || this._state === STATE.RETRY) {
      const movement = this._getCurrentMovement();
      return movement?.instruction_he ?? null;
    }
    if (this._state === STATE.COMPLETE) return COMPLETE_INSTRUCTION_HE;
    return null;
  }

  /** @private */
  _getCurrentMovement() {
    if (this._state === STATE.RETRY) return this._currentRetryMovement;
    if (this._movementIndex < this._movementQueue.length) {
      return this._movementQueue[this._movementIndex];
    }
    return null;
  }

  /** @private */
  _setError(err) {
    this._error = err.message || String(err);
    this._state = STATE.ERROR;
    return { state: STATE.ERROR, progress: 0, error: this._error };
  }

  /** @private */
  _reset() {
    this._state = STATE.IDLE;
    this._startTime = null;
    this._totalFrameCount = 0;

    // Calibration
    this._calibrationFrameCount = 0;

    // Profile
    this._anatomyProfile = null;
    this._kineticProfile = null;
    this._kineticInferredProfile = null;

    // Quality guard
    this._qualityPaused = false;
    this._qualityBadFrames = 0;

    // Phase A — detection + diagnostics
    this._landmarkFrames = [];
    this._objectFrames = [];
    this._aidDetection = null;
    this._phaseAResult = null;
    this._phaseASubState = 'idle';
    this._detectionFrameStart = 0;
    this._detectionFrameTarget = 0;
    this._diagnosticTrack = null;
    this._diagnosticSegments = [];
    this._diagnosticIndex = 0;
    this._diagnosticSegmentStart = 0;
    this._lastNudgeFrame = 0;
    this._lastVisibilityHaltFrame = 0;
    this._detectedCondition = null;
    this._gaitProfile = null;
    this._anatomyClassification = null;
    this._recalibratedMidDiag = false;
    this._imageContext = null;
    this._snapshotEmitted = false;

    // Motion calibration
    this._motionCalIndex = 0;
    this._motionCalFrames = [];
    this._motionCalBaseline = null;
    this._mirrored = false;
    this._calfRaiseResult = null;
    this._strictMode = false;

    // Vision diagnosis
    this._visionResult = null;
    this._visionConfirmed = false;
    this._awaitingVision = false;
    this._awaitingConfirmation = false;
    this._kineticResult = null;

    // Phase B
    this._movementQueue = [];
    this._movementIndex = 0;
    this._currentMovementFrames = [];
    this._currentMovementFrameTarget = 0;
    this._movementDataList = [];

    // Certainty / Retry
    this._phaseBResult = null;
    this._gateResult = null;
    this._retryCounts = {};
    this._retryQueue = [];
    this._retryIndex = 0;
    this._currentRetryMovement = null;

    // User input
    this._pendingUserQueries = [];
    this._userAnswers = {};

    // Results
    this._passportFields = null;
    this._error = null;
  }
}


// ---- Module-level helpers ----

/**
 * Build TRANSTIBIAL_AMPUTEE segments that target only the HEALTHY knee.
 * @param {string} affectedSide - 'left' | 'right' — the prosthetic side
 * @returns {Object[]} - Diagnostic segments
 */
function _buildTranstibialSegments(affectedSide) {
  const healthySide = affectedSide === 'left' ? 'right' : 'left';
  const healthyKnee = `${healthySide}_knee`;
  const sideLabel = healthySide === 'left' ? 'left' : 'right';
  const sideLabelHe = healthySide === 'left' ? 'שמאל' : 'ימין';

  return [
    {
      id: 'squats_healthy_knee',
      instruction_en: `Please do 5 slow knee bends (${sideLabel} leg)`,
      instruction_he: `אנא בצע 5 כפיפות ברכיים איטיות (רגל ${sideLabelHe})`,
      durationSec: 10,
      minDurationSec: 5,
      targetJoints: [healthyKnee],
      nudge_en: 'Please try to bend your knee, no movement detected',
      nudge_he: 'אנא נסה לכופף את הברך, לא זוהתה תנועה',
    },
    {
      id: 'arms_raise',
      instruction_en: 'Raise both arms above your head and lower them',
      instruction_he: 'הרם את שתי הידיים מעל הראש והורד אותן',
      durationSec: 6,
      minDurationSec: 3,
      targetJoints: ['left_elbow', 'right_elbow'],
      nudge_en: 'Please try to raise your arms, no movement detected',
      nudge_he: 'אנא נסה להרים את הידיים, לא זוהתה תנועה',
    },
  ];
}


/**
 * Extract angle series from frames for given joint landmark indices.
 * Used by diagnostic segment movement detection.
 */
function _extractAnglesFromFrames(frames, indices) {
  const angles = [];
  for (const frame of frames) {
    const a = frame[indices[0]], b = frame[indices[1]], c = frame[indices[2]];
    if (a?.visibility > 0.3 && b?.visibility > 0.3 && c?.visibility > 0.3) {
      angles.push(computeAngle(a, b, c));
    }
  }
  return angles;
}


// ---- Export state constants for testing ----
export {
  STATE,
  FULL_BODY_CONFIDENCE,
  PROGRESS_PHASE_A_END,
  DIAG_TRACKS,
  MOVEMENT_VARIANCE_THRESHOLD,
  LANDMARK_VISIBILITY_HALT,
  MIDDIAG_FROZEN_VARIANCE,
  IMAGE_CONTEXT_CONFIDENCE,
  MOTION_CAL_MOVEMENTS,
  MOTION_CAL_FRAMES_PER_MOVEMENT,
  CONFIDENCE_THRESHOLD,
};

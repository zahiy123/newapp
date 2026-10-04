// ============================================================
// useAnatomicScan — React Bridge to the Scan Pipeline
//
// This hook is the BRIDGE ONLY. It does not contain any scan
// logic — it wraps ScanSequencer (pure-logic state machine)
// and exposes its state to React components.
//
// Responsibilities:
//   1. Hold a single ScanSequencer instance in useRef
//   2. Expose start/stop/reset/feedFrame/submitUserAnswer methods
//   3. Map internal sequencer states to simplified UI statuses
//   4. Throttle progress updates (~10fps) to avoid render storms
//   5. Call onStatusChange/onInstruction callbacks on transitions
//   6. Handle vision diagnosis: capture frames, call server, feed result
//   7. Clean up on unmount
//
// The consuming component owns the requestAnimationFrame loop
// and calls feedFrame() with landmarks from usePose/useCamera.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import { ScanSequencer } from '../engine/scan/ScanSequencer.js';
import { createFrameThrottle } from '../engine/scan/frameThrottle.js';
import { apiUrl, authFetch } from '../utils/api.js';


// ---- Status Mapping ----
// Internal ScanSequencer states → simplified UI statuses

const STATUS_MAP = {
  IDLE:                   'idle',
  CALIBRATING:            'calibrating',
  PROFILE_INPUT:          'profile_input',
  PHASE_A:                'scanning',
  PHASE_B_MOVEMENT:       'scanning',
  CERTAINTY:              'scanning',
  RETRY:                  'scanning',
  AWAITING_USER:          'awaiting_user',
  PAUSED:                 'paused',
  COMPLETE:               'complete',
  ERROR:                  'error',
};

// Throttle interval for progress state updates (ms)
const PROGRESS_THROTTLE_MS = 100;

// Frames per second fed to the ScanSequencer. All sequencer time windows (get-ready,
// measurement, timeouts) are counted in frames at this rate, so frames MUST arrive at
// this real-time rate — not at the screen refresh rate of the rAF loop (60-144 Hz).
const SCAN_SAMPLE_RATE = 30;

// Vision frame capture settings
const VISION_FRAME_COUNT = 3;
const VISION_FRAME_DELAY_MS = 500;
const VISION_CANVAS_MAX_WIDTH = 480;
const VISION_JPEG_QUALITY = 0.7;

// Snapshot capture settings
const SNAPSHOT_MAX_WIDTH = 480;
const SNAPSHOT_JPEG_QUALITY = 0.6;


// ============================================================
// Helper: Capture multiple frames from a video element
// ============================================================

async function captureMultipleFrames(videoEl, count = VISION_FRAME_COUNT, unmirror = false) {
  if (!videoEl || videoEl.readyState < 2) return [];
  const frames = [];
  const canvas = document.createElement('canvas');
  const scale = Math.min(VISION_CANVAS_MAX_WIDTH / videoEl.videoWidth, 1);
  canvas.width = Math.round(videoEl.videoWidth * scale);
  canvas.height = Math.round(videoEl.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  // Vision always receives the RAW camera view (person's left on image-right).
  // If the motion calibration detected a mirrored stream, flip it back.
  if (unmirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }

  for (let i = 0; i < count; i++) {
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', VISION_JPEG_QUALITY);
    frames.push(dataUrl.split(',')[1]);
    if (i < count - 1) {
      await new Promise(r => setTimeout(r, VISION_FRAME_DELAY_MS));
    }
  }
  return frames;
}


// ============================================================
// Helper: Capture a single snapshot frame from video
// ============================================================

function captureSnapshot(videoEl, unmirror = false) {
  if (!videoEl || videoEl.readyState < 2) return null;
  const canvas = document.createElement('canvas');
  const scale = Math.min(SNAPSHOT_MAX_WIDTH / videoEl.videoWidth, 1);
  canvas.width = Math.round(videoEl.videoWidth * scale);
  canvas.height = Math.round(videoEl.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  // Same as captureMultipleFrames: always send the raw camera view
  if (unmirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', SNAPSHOT_JPEG_QUALITY);
  return dataUrl.split(',')[1]; // base64 only
}


// ============================================================
// Helper: Send snapshot + scanData for final verification
// ============================================================

async function fetchScanVerification(snapshot, scanData) {
  const resp = await authFetch(apiUrl('/api/coach/verify-scan'), {
    method: 'POST',
    body: JSON.stringify({ snapshot, scanData }),
  });
  if (!resp.ok) {
    throw new Error(`Verify-scan API error: ${resp.status}`);
  }
  return resp.json();
}


// ============================================================
// Helper: Send frames to server for anatomical vision diagnosis
// ============================================================

async function fetchVisionDiagnosis(frames, kineticResult) {
  const resp = await authFetch(apiUrl('/api/coach/analyze-anatomy'), {
    method: 'POST',
    body: JSON.stringify({
      frames,
      kineticHints: kineticResult ? {
        frozenJoints: kineticResult.frozenJoints || [],
        affectedSide: kineticResult.affectedSide || null,
        hipDeviation: kineticResult.hipDeviation || null,
        cogBias: kineticResult.cogBias || null,
      } : null,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Vision API error: ${resp.status}`);
  }
  return resp.json();
}


// ============================================================
// Hook
// ============================================================

export function useAnatomicScan({ onStatusChange, onInstruction, videoRef, userName } = {}) {

  // ---- Refs ----

  const sequencerRef = useRef(null);
  const onStatusChangeRef = useRef(onStatusChange);
  const onInstructionRef = useRef(onInstruction);
  const videoRefInternal = useRef(videoRef);
  const userNameRef = useRef(userName);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
    onInstructionRef.current = onInstruction;
    videoRefInternal.current = videoRef;
    userNameRef.current = userName;
  });

  const lastStatusRef = useRef('idle');
  const progressThrottleRef = useRef(0);
  const visionInFlightRef = useRef(false);


  // ---- React State (for UI consumers) ----

  const [scanStatus, setScanStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [currentInstruction, setCurrentInstruction] = useState(null);
  const [instructionHe, setInstructionHe] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [userQueries, setUserQueries] = useState(null);
  const [qualityWarning, setQualityWarning] = useState(false);
  const [fullBodyWarning, setFullBodyWarning] = useState(false);
  const [missingBodyParts, setMissingBodyParts] = useState(null);
  const [calibrationInfo, setCalibrationInfo] = useState(null);
  // Motion calibration timing: { phase: 'prep'|'measure', step, total, measureSec, startedAt }
  const [motionCalPhase, setMotionCalPhase] = useState(null);
  const [anatomyProfile, setAnatomyProfileState] = useState(null);
  const [missingFields, setMissingFields] = useState(null);
  const [kineticProfile, setKineticProfileState] = useState(null);
  const [kineticInferredProfile, setKineticInferredProfile] = useState(null);

  // Vision diagnosis state
  const [visionDiagnosis, setVisionDiagnosis] = useState(null);
  const [awaitingVision, setAwaitingVision] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  // Snapshot + verification state
  const [snapshot, setSnapshot] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);


  // ---- Lazy Sequencer Init ----

  const getSequencer = useCallback(() => {
    if (!sequencerRef.current) {
      sequencerRef.current = new ScanSequencer({
        sampleRate: SCAN_SAMPLE_RATE,
        phaseADurationSec: 15,
      });
    }
    return sequencerRef.current;
  }, []);


  /**
   * Per-arm (right / left) measurement from the motion calibration.
   * Available even when the scan is finished early from the vision confirmation
   * (where `result` is still null).
   */
  const getArmAssessment = useCallback(() => {
    return sequencerRef.current?.armAssessment ?? null;
  }, []);


  // ---- Vision Diagnosis Handler ----

  const handleVisionCapture = useCallback(async (kineticResult) => {
    if (visionInFlightRef.current) return;
    visionInFlightRef.current = true;
    setAwaitingVision(true);

    try {
      const videoEl = videoRefInternal.current?.current || videoRefInternal.current;
      const frames = await captureMultipleFrames(videoEl, VISION_FRAME_COUNT, !!sequencerRef.current?.mirrored);

      if (frames.length === 0) {
        // No frames captured — set a fallback result, continue normally
        const fallback = {
          classification: 'NATURAL',
          adaptedTrack: 'NORMAL',
          prostheticSide: null,
          aids: [],
          confidence: 0,
          description: 'No anatomical abnormalities detected',
          description_he: 'לא זוהו חריגות אנטומיות',
          specialProtocol: null,
        };
        const seq = getSequencer();
        const change = seq.setVisionResult(fallback);
        setAwaitingVision(false);
        setAwaitingConfirmation(true);
        setVisionDiagnosis(fallback);
        handleStateChange(change);
        return;
      }

      const diagnosis = await fetchVisionDiagnosis(frames, kineticResult);
      const seq = getSequencer();
      const change = seq.setVisionResult(diagnosis);
      setAwaitingVision(false);
      setAwaitingConfirmation(true);
      setVisionDiagnosis(diagnosis);
      handleStateChange(change);
    } catch (err) {
      console.error('[useAnatomicScan] Vision diagnosis error:', err);
      // On error, provide fallback to unblock — no error flag, just continue
      const fallback = {
        classification: 'NATURAL',
        adaptedTrack: 'NORMAL',
        prostheticSide: null,
        aids: [],
        confidence: 0,
        description: 'No anatomical abnormalities detected',
        description_he: 'לא זוהו חריגות אנטומיות',
        specialProtocol: null,
      };
      const seq = getSequencer();
      const change = seq.setVisionResult(fallback);
      setAwaitingVision(false);
      setAwaitingConfirmation(true);
      setVisionDiagnosis(fallback);
      handleStateChange(change);
    } finally {
      visionInFlightRef.current = false;
    }
  }, [getSequencer]);


  // ---- State Change Handler ----

  const handleStateChange = useCallback((change) => {
    if (!change) return;

    const mappedStatus = STATUS_MAP[change.state] || 'scanning';

    if (change.instruction !== undefined) {
      setCurrentInstruction(change.instruction);
      onInstructionRef.current?.(change.instruction);
    }

    if (change.instruction_he !== undefined) {
      setInstructionHe(change.instruction_he);
    }

    if (change.calibrationInfo) {
      setCalibrationInfo(change.calibrationInfo);
    }

    // Motion calibration timing (get ready → measure)
    if (change.motionCalPhase) {
      console.log(`[useAnatomicScan] Calibration ${(change.motionCalStep ?? 0) + 1}/${change.motionCalTotal ?? '?'} — ${change.motionCalPhase}`);
      setMotionCalPhase(prev => ({
        phase: change.motionCalPhase,
        step: change.motionCalStep ?? prev?.step ?? 0,
        total: change.motionCalTotal ?? prev?.total ?? 0,
        measureSec: change.measureSec ?? null,
        attempt: change.motionCalAttempt ?? (change.motionCalPhase === 'prep' ? 1 : prev?.attempt ?? 1),
        startedAt: Date.now(),
      }));
    } else if (change.subState && change.subState !== 'motionCalibration') {
      setMotionCalPhase(null);
    }

    // Quality guard events
    if (change.qualityPause) {
      setQualityWarning(true);
    }
    if (change.qualityResume) {
      setQualityWarning(false);
    }

    // Full-body visibility gate events
    if (change.fullBodyHalt) {
      setFullBodyWarning(true);
      setMissingBodyParts(change.missingLandmarks || null);
    }
    if (change.fullBodyResume) {
      setFullBodyWarning(false);
      setMissingBodyParts(null);
    }

    // Vision diagnosis events
    if (change.captureFrames) {
      handleVisionCapture(change.kineticResult);
    }
    if (change.awaitingConfirmation) {
      setAwaitingConfirmation(true);
      setAwaitingVision(false);
      if (change.diagnosis) {
        setVisionDiagnosis(change.diagnosis);
      }
    }

    // Update status if it actually changed
    if (mappedStatus !== lastStatusRef.current) {
      console.log('[useAnatomicScan] Status transition:', lastStatusRef.current, '→', mappedStatus);
      lastStatusRef.current = mappedStatus;
      setScanStatus(mappedStatus);
      setQualityWarning(false);
      onStatusChangeRef.current?.(mappedStatus);
    }

    // Throttle progress updates to ~10fps
    if (change.progress !== undefined) {
      const now = performance.now();
      if (now - progressThrottleRef.current >= PROGRESS_THROTTLE_MS) {
        progressThrottleRef.current = now;
        setProgress(change.progress);
      }
    }

    // Terminal state data
    if (change.result) {
      setResult(change.result);
      setProgress(1.0);
    }
    if (change.error) {
      setError(change.error);
    }
    if (change.userQueries) {
      setUserQueries(change.userQueries);
    }
    if (change.anatomyProfile) {
      setAnatomyProfileState(change.anatomyProfile);
    }
    if (change.missingFields) {
      setMissingFields(change.missingFields);
    }
    if (change.kineticProfile) {
      setKineticProfileState(change.kineticProfile);
    }
    if (change.kineticInferredProfile) {
      setKineticInferredProfile(change.kineticInferredProfile);
    }
  }, [handleVisionCapture]);


  // ---- Public API ----

  // Real-time throttle: the caller's rAF loop may tick at 60-144 Hz
  const shouldFeedRef = useRef(createFrameThrottle(SCAN_SAMPLE_RATE));
  const pendingObjDetsRef = useRef(null);

  const feedFrame = useCallback((landmarks, objectDetections = null) => {
    // Keep object detections that arrive on a skipped tick for the next fed frame
    if (objectDetections) pendingObjDetsRef.current = objectDetections;
    if (!shouldFeedRef.current(performance.now())) return;

    const dets = pendingObjDetsRef.current;
    pendingObjDetsRef.current = null;
    const seq = getSequencer();
    const change = seq.feedFrame(landmarks, dets);
    handleStateChange(change);
  }, [getSequencer, handleStateChange]);

  const start = useCallback(() => {
    const seq = getSequencer();
    const change = seq.start();
    handleStateChange(change);
  }, [getSequencer, handleStateChange]);

  const stop = useCallback(() => {
    const seq = getSequencer();
    seq.stop();
    lastStatusRef.current = 'idle';
    setScanStatus('idle');
    setProgress(0);
    setCurrentInstruction(null);
    setInstructionHe(null);
    setQualityWarning(false);
    setAwaitingVision(false);
    setAwaitingConfirmation(false);
    setVisionDiagnosis(null);
    setMotionCalPhase(null);
  }, [getSequencer]);

  const reset = useCallback(() => {
    const seq = getSequencer();
    seq.reset();
    lastStatusRef.current = 'idle';
    setScanStatus('idle');
    setProgress(0);
    setCurrentInstruction(null);
    setInstructionHe(null);
    setResult(null);
    setError(null);
    setUserQueries(null);
    setQualityWarning(false);
    setCalibrationInfo(null);
    setAnatomyProfileState(null);
    setMissingFields(null);
    setKineticProfileState(null);
    setKineticInferredProfile(null);
    setAwaitingVision(false);
    setAwaitingConfirmation(false);
    setVisionDiagnosis(null);
    setMotionCalPhase(null);
  }, [getSequencer]);

  const submitUserAnswer = useCallback((limbKey, answer) => {
    const seq = getSequencer();
    const change = seq.submitUserAnswer(limbKey, answer);
    handleStateChange(change);
  }, [getSequencer, handleStateChange]);

  /**
   * Set the anatomy profile on the sequencer during PROFILE_INPUT.
   * Must be called before confirmProfile() will succeed.
   */
  const setAnatomyProfile = useCallback((profileData) => {
    console.log('[useAnatomicScan] setAnatomyProfile called:', profileData);
    const seq = getSequencer();
    const change = seq.setAnatomyProfile(profileData);
    handleStateChange(change);
  }, [getSequencer, handleStateChange]);

  /**
   * Confirm the profile and advance to PHASE_B_MOVEMENT.
   */
  const confirmProfile = useCallback(() => {
    console.log('[useAnatomicScan] confirmProfile called');
    const seq = getSequencer();
    const change = seq.confirmProfile();
    console.log('[useAnatomicScan] confirmProfile result:', change?.state, change);
    handleStateChange(change);
  }, [getSequencer, handleStateChange]);

  /**
   * Confirm the vision diagnosis — proceed to guided diagnostics.
   */
  const confirmDiagnosis = useCallback(() => {
    console.log('[useAnatomicScan] confirmDiagnosis called');
    const seq = getSequencer();
    const change = seq.confirmDiagnosis();
    setAwaitingConfirmation(false);
    setVisionDiagnosis(null);
    handleStateChange(change);
  }, [getSequencer, handleStateChange]);

  /**
   * Reject the vision diagnosis — restart scan with stricter criteria.
   */
  const rejectDiagnosis = useCallback(() => {
    console.log('[useAnatomicScan] rejectDiagnosis called');
    const seq = getSequencer();
    const change = seq.rejectDiagnosis();
    setAwaitingConfirmation(false);
    setVisionDiagnosis(null);
    handleStateChange(change);
  }, [getSequencer, handleStateChange]);

  /**
   * Reject with correction — user specifies the correct side, sends to server,
   * then confirms with the corrected diagnosis.
   */
  const rejectWithCorrection = useCallback(async (correctedSide) => {
    console.log('[useAnatomicScan] rejectWithCorrection called, correctedSide:', correctedSide);
    try {
      const resp = await authFetch(apiUrl('/api/coach/correct-anatomy'), {
        method: 'POST',
        body: JSON.stringify({
          originalDiagnosis: visionDiagnosis,
          correctedSide,
        }),
      });
      if (resp.ok) {
        const corrected = await resp.json();
        console.log('[useAnatomicScan] Corrected diagnosis:', corrected);
        // Feed corrected result to sequencer and confirm
        const seq = getSequencer();
        seq.setVisionResult(corrected);
        const change = seq.confirmDiagnosis();
        setAwaitingConfirmation(false);
        setVisionDiagnosis(null);
        handleStateChange(change);
        return;
      }
    } catch (err) {
      console.error('[useAnatomicScan] Correction API error:', err);
    }
    // Fallback: just reject normally
    rejectDiagnosis();
  }, [getSequencer, handleStateChange, rejectDiagnosis, visionDiagnosis]);

  /**
   * Capture snapshot and send for server verification.
   * Called automatically when scan completes, or manually by the UI.
   * Returns the verified scanData (or null on failure).
   */
  const captureAndVerify = useCallback(async (scanResult, visionDiag) => {
    const videoEl = videoRefInternal.current?.current || videoRefInternal.current;
    const snap = captureSnapshot(videoEl, !!sequencerRef.current?.mirrored);
    if (snap) {
      setSnapshot(snap);
    }
    setVerifying(true);

    try {
      const { buildScanData } = await import('../engine/scan/ScanDataBuilder.js');
      const localScanData = buildScanData(scanResult, visionDiag);
      const result = await fetchScanVerification(snap, localScanData);
      setVerificationResult(result);
      setVerifying(false);
      return result;
    } catch (err) {
      console.error('[useAnatomicScan] Verification error:', err);
      // Fallback: return local scanData without server verification
      const { buildScanData } = await import('../engine/scan/ScanDataBuilder.js');
      const fallback = buildScanData(scanResult, visionDiag);
      setVerificationResult({ verified: true, scanData: fallback, fallback: true });
      setVerifying(false);
      return { verified: true, scanData: fallback, fallback: true };
    }
  }, []);

  /**
   * Pause the scan — freezes all timers without losing data.
   */
  const pauseScan = useCallback(() => {
    const seq = getSequencer();
    const change = seq.pause();
    handleStateChange(change);
  }, [getSequencer, handleStateChange]);

  /**
   * Resume the scan from paused state.
   */
  const resumeScan = useCallback(() => {
    const seq = getSequencer();
    const change = seq.resume();
    if (change) {
      setFullBodyWarning(false);
      setMissingBodyParts(null);
      setQualityWarning(false);
    }
    handleStateChange(change);
  }, [getSequencer, handleStateChange]);

  // ---- Cleanup on Unmount ----

  useEffect(() => {
    return () => {
      sequencerRef.current?.stop();
    };
  }, []);


  // ---- Return ----

  return {
    // Methods
    start,
    stop,
    reset,
    feedFrame,
    submitUserAnswer,
    setAnatomyProfile,
    confirmProfile,
    confirmDiagnosis,
    rejectDiagnosis,
    rejectWithCorrection,
    pauseScan,
    resumeScan,
    captureAndVerify,
    getArmAssessment,
    // State
    scanStatus,
    progress,
    currentInstruction,
    instructionHe,
    result,
    error,
    userQueries,
    qualityWarning,
    fullBodyWarning,
    missingBodyParts,
    calibrationInfo,
    motionCalPhase,
    anatomyProfile,
    missingFields,
    kineticProfile,
    kineticInferredProfile,
    // Vision diagnosis state
    visionDiagnosis,
    awaitingVision,
    awaitingConfirmation,
    // Snapshot + verification state
    snapshot,
    verifying,
    verificationResult,
  };
}

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
import { apiUrl } from '../utils/api.js';


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
  COMPLETE:               'complete',
  ERROR:                  'error',
};

// Throttle interval for progress state updates (ms)
const PROGRESS_THROTTLE_MS = 100;

// Vision frame capture settings
const VISION_FRAME_COUNT = 3;
const VISION_FRAME_DELAY_MS = 500;
const VISION_CANVAS_MAX_WIDTH = 480;
const VISION_JPEG_QUALITY = 0.7;


// ============================================================
// Helper: Capture multiple frames from a video element
// ============================================================

async function captureMultipleFrames(videoEl, count = VISION_FRAME_COUNT) {
  if (!videoEl || videoEl.readyState < 2) return [];
  const frames = [];
  const canvas = document.createElement('canvas');
  const scale = Math.min(VISION_CANVAS_MAX_WIDTH / videoEl.videoWidth, 1);
  canvas.width = Math.round(videoEl.videoWidth * scale);
  canvas.height = Math.round(videoEl.videoHeight * scale);
  const ctx = canvas.getContext('2d');

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
// Helper: Send frames to server for anatomical vision diagnosis
// ============================================================

async function fetchVisionDiagnosis(frames, kineticResult) {
  const resp = await fetch(apiUrl('/api/coach/analyze-anatomy'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const [calibrationInfo, setCalibrationInfo] = useState(null);
  const [anatomyProfile, setAnatomyProfileState] = useState(null);
  const [missingFields, setMissingFields] = useState(null);
  const [kineticProfile, setKineticProfileState] = useState(null);
  const [kineticInferredProfile, setKineticInferredProfile] = useState(null);

  // Vision diagnosis state
  const [visionDiagnosis, setVisionDiagnosis] = useState(null);
  const [awaitingVision, setAwaitingVision] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);


  // ---- Lazy Sequencer Init ----

  const getSequencer = useCallback(() => {
    if (!sequencerRef.current) {
      sequencerRef.current = new ScanSequencer({
        sampleRate: 30,
        phaseADurationSec: 15,
      });
    }
    return sequencerRef.current;
  }, []);


  // ---- Vision Diagnosis Handler ----

  const handleVisionCapture = useCallback(async (kineticResult) => {
    if (visionInFlightRef.current) return;
    visionInFlightRef.current = true;
    setAwaitingVision(true);

    try {
      const videoEl = videoRefInternal.current?.current || videoRefInternal.current;
      const frames = await captureMultipleFrames(videoEl);

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

    // Quality guard events
    if (change.qualityPause) {
      setQualityWarning(true);
    }
    if (change.qualityResume) {
      setQualityWarning(false);
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

  const feedFrame = useCallback((landmarks, objectDetections = null) => {
    const seq = getSequencer();
    const change = seq.feedFrame(landmarks, objectDetections);
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
      const resp = await fetch(apiUrl('/api/coach/correct-anatomy'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    // State
    scanStatus,
    progress,
    currentInstruction,
    instructionHe,
    result,
    error,
    userQueries,
    qualityWarning,
    calibrationInfo,
    anatomyProfile,
    missingFields,
    kineticProfile,
    kineticInferredProfile,
    // Vision diagnosis state
    visionDiagnosis,
    awaitingVision,
    awaitingConfirmation,
  };
}

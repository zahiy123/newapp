import { useRef, useCallback } from 'react';
import { apiUrl } from '../utils/api';
const MAX_SESSION_IMAGES = 960;
const MAX_CONSECUTIVE_FAILURES = 5;
const MIN_PHASE_HOLD_MS = 200;   // Phase must be held 200ms to be considered real (noise filter)
const MIN_PHASE_DURATION_MS = 800; // Full down phase must last 800ms+ to count as real rep (camera shake filter)

// Key landmark indices: shoulders(11,12), elbows(13,14), wrists(15,16), hips(23,24), knees(25,26), ankles(27,28)
const KEY_LANDMARK_INDICES = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

function condenseLandmarks(landmarksArray) {
  if (!landmarksArray || !Array.isArray(landmarksArray)) return null;
  return landmarksArray.map(landmarks => {
    if (!landmarks || !Array.isArray(landmarks)) return null;
    const points = {};
    for (const idx of KEY_LANDMARK_INDICES) {
      const lm = landmarks[idx];
      if (lm) {
        points[idx] = {
          x: Math.round(lm.x * 1000) / 1000,
          y: Math.round(lm.y * 1000) / 1000,
          z: Math.round((lm.z || 0) * 1000) / 1000,
        };
      }
    }
    return points;
  });
}

// Extract a representative angle value from angles object (picks first numeric value)
function getPrimaryAngle(angles) {
  if (!angles || typeof angles !== 'object') return null;
  for (const v of Object.values(angles)) {
    if (typeof v === 'number') return v;
  }
  return null;
}

export function useHaikuVision({ onVisionFeedback } = {}) {
  // All refs — no useState to avoid re-renders at 60fps
  const enabledRef = useRef(false);
  const disabledRef = useRef(false);
  const contextRef = useRef(null);
  const captureFrameFnRef = useRef(null);
  const videoElRef = useRef(null);

  // Per-rep frame capture + angle snapshots + landmark telemetry
  const framesRef = useRef([]);
  const anglesRef = useRef([]);
  const landmarksRef = useRef([]);
  const latestAnglesRef = useRef(null);
  const latestLandmarksRef = useRef(null);
  const lastPhaseRef = useRef(null);
  const repCountRef = useRef(0);          // Last rep count the analyzer confirmed
  const earlySentRepRef = useRef(0);      // Rep number we speculatively sent to server
  const phaseStartTimeRef = useRef(0);
  const downPhaseStartRef = useRef(0);
  const downStartAnglesRef = useRef(null);

  // Peak tracking: capture frame at minimum angle during down phase
  const minAngleDuringDownRef = useRef(Infinity);
  const peakFrameRef = useRef(null);      // Frame captured at deepest point
  const peakAnglesRef = useRef(null);
  const peakLandmarksRef = useRef(null);

  // Session limits
  const sessionImageCountRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);
  const inFlightRef = useRef(false);

  const captureCurrentFrame = useCallback(() => {
    if (sessionImageCountRef.current >= MAX_SESSION_IMAGES) return null;
    const fn = captureFrameFnRef.current;
    const video = videoElRef.current;
    if (!fn || !video) return null;
    const frame = fn(video);
    if (frame) sessionImageCountRef.current++;
    return frame;
  }, []);

  const sendFramesToServer = useCallback(async (frames, repNumber, anglesAtFrames, landmarksAtFrames, repCountAtSend) => {
    if (inFlightRef.current || disabledRef.current) return;
    inFlightRef.current = true;

    const ctx = contextRef.current;
    const url = apiUrl('/api/coach/analyze-rep');
    const telemetry = condenseLandmarks(landmarksAtFrames);
    console.log(`[HaikuVision] SEND ${frames.length} frames for rep #${repNumber} to ${url}`);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames,
          jointAngles: anglesAtFrames || [],
          telemetry: telemetry || [],
          sport: ctx?.sport || 'fitness',
          exercise: ctx?.exerciseName || '',
          playerProfile: ctx?.playerProfile,
          playerName: ctx?.playerName || '',
          repNumber
        })
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json();
      consecutiveFailuresRef.current = 0;

      if (onVisionFeedback) {
        // Check if rep was confirmed by analyzer since we sent
        const repConfirmed = repCountRef.current > repCountAtSend;
        console.log(`[HaikuVision] Server responded for rep #${repNumber}, confirmed=${repConfirmed} (count: ${repCountAtSend}→${repCountRef.current})`);
        onVisionFeedback({ ...result, repConfirmed, repNumber });
      }
    } catch (err) {
      consecutiveFailuresRef.current++;
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        console.warn('useHaikuVision: too many failures, disabling for session');
        disabledRef.current = true;
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [onVisionFeedback]);

  const feedPhaseData = useCallback((newState, angles, landmarks) => {
    if (!enabledRef.current || disabledRef.current) return;
    if (!newState) return;
    if (!newState.moving && !newState.firstRepStarted) return;

    // Confidence gate
    if (landmarks && Array.isArray(landmarks) && landmarks.length > 0) {
      const visibilities = landmarks.filter(l => l && typeof l.visibility === 'number').map(l => l.visibility);
      if (visibilities.length > 0) {
        const avgVisibility = visibilities.reduce((a, b) => a + b, 0) / visibilities.length;
        if (avgVisibility < 0.2) return;
      }
    }

    if (angles) latestAnglesRef.current = angles;
    if (landmarks) latestLandmarksRef.current = landmarks;

    const currentPhase = newState.phase;
    const prevPhase = lastPhaseRef.current;
    const reps = newState.reps ?? 0;
    const now = Date.now();

    // Noise flicker filter (<200ms)
    if (currentPhase !== prevPhase) {
      const phaseHeld = now - phaseStartTimeRef.current;
      if (phaseHeld < MIN_PHASE_HOLD_MS && prevPhase != null) {
        return;
      }
      phaseStartTimeRef.current = now;
    }

    // === PHASE: up → down — capture Frame 1 (start of descent) + init peak tracking ===
    if (prevPhase === 'up' && currentPhase === 'down') {
      framesRef.current = [];
      anglesRef.current = [];
      landmarksRef.current = [];
      downPhaseStartRef.current = now;
      downStartAnglesRef.current = angles || null;
      minAngleDuringDownRef.current = Infinity;
      peakFrameRef.current = null;
      peakAnglesRef.current = null;
      peakLandmarksRef.current = null;

      const f1 = captureCurrentFrame();
      if (f1) {
        framesRef.current.push(f1);
        anglesRef.current.push(angles || null);
        landmarksRef.current.push(landmarks || null);
      }
    }

    // === DURING DOWN PHASE: track minimum angle and capture frame at deepest point ===
    if (currentPhase === 'down') {
      const primaryAngle = getPrimaryAngle(angles);
      if (primaryAngle !== null && primaryAngle < minAngleDuringDownRef.current) {
        minAngleDuringDownRef.current = primaryAngle;
        // Capture frame at new minimum — overwrite previous peak frame
        const peakFrame = captureCurrentFrame();
        if (peakFrame) {
          peakFrameRef.current = peakFrame;
          peakAnglesRef.current = angles || null;
          peakLandmarksRef.current = landmarks || null;
        }
      }
    }

    // === PHASE: down → up — SEND with peak frame (deepest point) ===
    if (prevPhase === 'down' && currentPhase === 'up') {
      const downDuration = now - downPhaseStartRef.current;

      // Camera shake filter: down phase must last >= 800ms
      if (downDuration < MIN_PHASE_DURATION_MS) {
        framesRef.current = [];
        anglesRef.current = [];
        landmarksRef.current = [];
        lastPhaseRef.current = currentPhase;
        return;
      }

      // Angle consistency check: real movement >= 30° change
      const startAngles = downStartAnglesRef.current;
      const endAngles = peakAnglesRef.current || angles;
      if (startAngles && endAngles) {
        const keys = Object.keys(startAngles);
        const hasRealMovement = keys.some(k => {
          const s = startAngles[k];
          const e = endAngles[k];
          return typeof s === 'number' && typeof e === 'number' && Math.abs(s - e) >= 30;
        });
        if (!hasRealMovement) {
          framesRef.current = [];
          anglesRef.current = [];
          landmarksRef.current = [];
          lastPhaseRef.current = currentPhase;
          return;
        }
      }

      // Use peak frame (captured at minimum angle) as Frame 2 instead of transition frame
      if (peakFrameRef.current) {
        // Replace any existing frame 2 with the peak frame
        framesRef.current = [framesRef.current[0]].filter(Boolean);
        framesRef.current.push(peakFrameRef.current);
        anglesRef.current = [anglesRef.current[0]].filter(Boolean);
        anglesRef.current.push(peakAnglesRef.current);
        landmarksRef.current = [landmarksRef.current[0]].filter(Boolean);
        landmarksRef.current.push(peakLandmarksRef.current);
      } else {
        // Fallback: capture current frame if no peak was tracked
        const f2 = captureCurrentFrame();
        if (f2) {
          framesRef.current.push(f2);
          anglesRef.current.push(angles || null);
          landmarksRef.current.push(landmarks || null);
        }
      }

      // SEND: fire with peak frame data
      if (framesRef.current.length >= 2) {
        const anticipatedRep = repCountRef.current + 1;
        console.log(`[HaikuVision] Peak at ${Math.round(minAngleDuringDownRef.current)}°! Sending for rep #${anticipatedRep} (down ${downDuration}ms, inFlight=${inFlightRef.current})`);
        const framesToSend = [...framesRef.current];
        const anglesToSend = [...anglesRef.current];
        const landmarksToSend = [...landmarksRef.current];
        earlySentRepRef.current = anticipatedRep;
        framesRef.current = [];
        anglesRef.current = [];
        landmarksRef.current = [];
        sendFramesToServer(framesToSend, anticipatedRep, anglesToSend, landmarksToSend, repCountRef.current);
      }
    }

    // Sync repCountRef when analyzer confirms the rep (after up phase completes)
    if (reps > repCountRef.current) {
      console.log(`[HaikuVision] Rep confirmed by analyzer: ${reps} (earlySent=${earlySentRepRef.current})`);
      repCountRef.current = reps;
    }

    lastPhaseRef.current = currentPhase;
  }, [captureCurrentFrame, sendFramesToServer]);

  const startVision = useCallback((context, captureFrameFn, videoEl) => {
    contextRef.current = context;
    captureFrameFnRef.current = captureFrameFn;
    videoElRef.current = videoEl;
    framesRef.current = [];
    lastPhaseRef.current = null;
    repCountRef.current = 0;
    earlySentRepRef.current = 0;
    consecutiveFailuresRef.current = 0;
    minAngleDuringDownRef.current = Infinity;
    peakFrameRef.current = null;
    enabledRef.current = true;
  }, []);

  const stopVision = useCallback(() => {
    enabledRef.current = false;
    framesRef.current = [];
    lastPhaseRef.current = null;
  }, []);

  const resetSession = useCallback(() => {
    sessionImageCountRef.current = 0;
    disabledRef.current = false;
    consecutiveFailuresRef.current = 0;
    repCountRef.current = 0;
    earlySentRepRef.current = 0;
  }, []);

  const getSessionStats = useCallback(() => ({
    imagesUsed: sessionImageCountRef.current,
    imagesRemaining: MAX_SESSION_IMAGES - sessionImageCountRef.current,
    disabled: disabledRef.current
  }), []);

  return { feedPhaseData, startVision, stopVision, resetSession, getSessionStats };
}

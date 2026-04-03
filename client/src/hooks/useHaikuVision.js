import { useRef, useCallback } from 'react';
import { apiUrl } from '../utils/api';
const MAX_SESSION_IMAGES = 960;
const MAX_CONSECUTIVE_FAILURES = 5;
const FRAME2_DELAY_MS = 150;
const MIN_PHASE_HOLD_MS = 200;   // Phase must be held 200ms to be considered real (noise filter)
const MIN_PHASE_DURATION_MS = 800; // Full down phase must last 800ms+ to count as real rep (camera shake filter)

export function useHaikuVision({ onVisionFeedback } = {}) {
  // All refs — no useState to avoid re-renders at 60fps
  const enabledRef = useRef(false);
  const disabledRef = useRef(false);
  const contextRef = useRef(null);
  const captureFrameFnRef = useRef(null);
  const videoElRef = useRef(null);

  // Per-rep frame capture + angle snapshots
  const framesRef = useRef([]);
  const anglesRef = useRef([]);          // Joint angle snapshots alongside frames
  const latestAnglesRef = useRef(null);  // Most recent angles from feedPhaseData
  const lastPhaseRef = useRef(null);
  const frame2TimerRef = useRef(null);
  const repCountRef = useRef(0);
  const phaseStartTimeRef = useRef(0);   // When current phase started (noise filter)
  const downPhaseStartRef = useRef(0);   // When down phase started (duration gate)
  const downStartAnglesRef = useRef(null); // Angles at down phase start (consistency check)

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

  const sendFramesToServer = useCallback(async (frames, repNumber, anglesAtFrames) => {
    if (inFlightRef.current || disabledRef.current) return;
    inFlightRef.current = true;

    const ctx = contextRef.current;
    const url = apiUrl('/api/coach/analyze-rep');
    console.log(`[HaikuVision] Sending ${frames.length} frames for rep #${repNumber} to ${url}`);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames,
          jointAngles: anglesAtFrames || [],
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

      if (result.feedback && onVisionFeedback) {
        onVisionFeedback(result);
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
    // Only process when athlete is actually moving (ignore idle phase flickers)
    if (!newState.moving && !newState.firstRepStarted) return;

    // Confidence gate: if landmarks are provided, check average visibility
    // Skip processing when pose detection confidence is too low (camera shake/occlusion)
    if (landmarks && Array.isArray(landmarks) && landmarks.length > 0) {
      const visibilities = landmarks.filter(l => l && typeof l.visibility === 'number').map(l => l.visibility);
      if (visibilities.length > 0) {
        const avgVisibility = visibilities.reduce((a, b) => a + b, 0) / visibilities.length;
        if (avgVisibility < 0.2) {
          // Low confidence pose — likely camera noise or partial occlusion
          return;
        }
      }
    }

    // Always store latest angles for Frame 2 capture (happens in setTimeout)
    if (angles) latestAnglesRef.current = angles;

    const currentPhase = newState.phase;
    const prevPhase = lastPhaseRef.current;
    const reps = newState.reps ?? 0;
    const now = Date.now();

    // Track phase timing — filter out noise flickers (<200ms)
    if (currentPhase !== prevPhase) {
      const phaseHeld = now - phaseStartTimeRef.current;
      if (phaseHeld < MIN_PHASE_HOLD_MS && prevPhase != null) {
        // Phase flip too fast — likely noise, ignore
        return;
      }
      phaseStartTimeRef.current = now;
    }

    // Phase transition: up → down → capture Frame 1 (start of movement)
    if (prevPhase === 'up' && currentPhase === 'down') {
      framesRef.current = [];
      anglesRef.current = [];
      clearTimeout(frame2TimerRef.current);
      downPhaseStartRef.current = now;
      downStartAnglesRef.current = angles || null;

      const f1 = captureCurrentFrame();
      if (f1) {
        framesRef.current.push(f1);
        anglesRef.current.push(angles || null);

        // Schedule Frame 2 capture after delay (peak effort)
        frame2TimerRef.current = setTimeout(() => {
          if (!enabledRef.current || disabledRef.current) return;
          const f2 = captureCurrentFrame();
          if (f2) {
            framesRef.current.push(f2);
            anglesRef.current.push(latestAnglesRef.current || null);
          }
        }, FRAME2_DELAY_MS);
      }
    }

    // Phase transition: down → up → capture Frame 3 (return)
    if (prevPhase === 'down' && currentPhase === 'up') {
      const downDuration = now - downPhaseStartRef.current;

      // Camera shake filter: down phase must last >= 800ms to be a real rep
      if (downDuration < MIN_PHASE_DURATION_MS) {
        // Too fast — camera noise, not a real rep. Discard frames.
        framesRef.current = [];
        anglesRef.current = [];
        lastPhaseRef.current = currentPhase;
        return;
      }

      // Angle consistency check: ensure real angle change occurred (not just camera movement)
      const startAngles = downStartAnglesRef.current;
      const endAngles = angles;
      if (startAngles && endAngles) {
        // Check if any key joint angle changed by >= 30° (real movement)
        const keys = Object.keys(startAngles);
        const hasRealMovement = keys.some(k => {
          const s = startAngles[k];
          const e = endAngles[k];
          return typeof s === 'number' && typeof e === 'number' && Math.abs(s - e) >= 30;
        });
        if (!hasRealMovement) {
          // Angles barely changed — camera shift, not a real rep
          framesRef.current = [];
          anglesRef.current = [];
          lastPhaseRef.current = currentPhase;
          return;
        }
      }

      const f3 = captureCurrentFrame();
      if (f3) {
        framesRef.current.push(f3);
        anglesRef.current.push(angles || null);
      }

      // If we have 3 frames and reps increased, fire analysis
      if (framesRef.current.length === 3 && reps > repCountRef.current) {
        const framesToSend = [...framesRef.current];
        const anglesToSend = [...anglesRef.current];
        repCountRef.current = reps;
        framesRef.current = [];
        anglesRef.current = [];
        // Fire and forget — with angle snapshots
        sendFramesToServer(framesToSend, reps, anglesToSend);
      }
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
    consecutiveFailuresRef.current = 0;
    enabledRef.current = true;
  }, []);

  const stopVision = useCallback(() => {
    enabledRef.current = false;
    clearTimeout(frame2TimerRef.current);
    framesRef.current = [];
    lastPhaseRef.current = null;
  }, []);

  const resetSession = useCallback(() => {
    sessionImageCountRef.current = 0;
    disabledRef.current = false;
    consecutiveFailuresRef.current = 0;
    repCountRef.current = 0;
  }, []);

  const getSessionStats = useCallback(() => ({
    imagesUsed: sessionImageCountRef.current,
    imagesRemaining: MAX_SESSION_IMAGES - sessionImageCountRef.current,
    disabled: disabledRef.current
  }), []);

  return { feedPhaseData, startVision, stopVision, resetSession, getSessionStats };
}

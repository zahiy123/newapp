import { useRef, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const MAX_SESSION_IMAGES = 960;
const MAX_CONSECUTIVE_FAILURES = 5;
const FRAME2_DELAY_MS = 150;
const MIN_PHASE_HOLD_MS = 200; // Phase must be held 200ms to be considered real (noise filter)

export function useHaikuVision({ onVisionFeedback } = {}) {
  // All refs — no useState to avoid re-renders at 60fps
  const enabledRef = useRef(false);
  const disabledRef = useRef(false);
  const contextRef = useRef(null);
  const captureFrameFnRef = useRef(null);
  const videoElRef = useRef(null);

  // Per-rep frame capture
  const framesRef = useRef([]);
  const lastPhaseRef = useRef(null);
  const frame2TimerRef = useRef(null);
  const repCountRef = useRef(0);
  const phaseStartTimeRef = useRef(0); // When current phase started (noise filter)

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

  const sendFramesToServer = useCallback(async (frames, repNumber) => {
    if (inFlightRef.current || disabledRef.current) return;
    inFlightRef.current = true;

    const ctx = contextRef.current;
    try {
      const resp = await fetch(`${API_BASE}/api/coach/analyze-rep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames,
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

  const feedPhaseData = useCallback((newState) => {
    if (!enabledRef.current || disabledRef.current) return;
    if (!newState) return;
    // Only process when athlete is actually moving (ignore idle phase flickers)
    if (!newState.moving && !newState.firstRepStarted) return;

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
      clearTimeout(frame2TimerRef.current);

      const f1 = captureCurrentFrame();
      if (f1) {
        framesRef.current.push(f1);

        // Schedule Frame 2 capture after delay (peak effort)
        frame2TimerRef.current = setTimeout(() => {
          if (!enabledRef.current || disabledRef.current) return;
          const f2 = captureCurrentFrame();
          if (f2) framesRef.current.push(f2);
        }, FRAME2_DELAY_MS);
      }
    }

    // Phase transition: down → up → capture Frame 3 (return)
    if (prevPhase === 'down' && currentPhase === 'up') {
      const f3 = captureCurrentFrame();
      if (f3) framesRef.current.push(f3);

      // If we have 3 frames and reps increased, fire analysis
      if (framesRef.current.length === 3 && reps > repCountRef.current) {
        const framesToSend = [...framesRef.current];
        repCountRef.current = reps;
        framesRef.current = [];
        // Fire and forget
        sendFramesToServer(framesToSend, reps);
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

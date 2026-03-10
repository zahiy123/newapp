import { useRef, useCallback, useEffect } from 'react';

const AI_INTERVAL_MS = 20000; // Send to Claude every 20s
const MAX_FAILURES = 3;
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * useAICoach — Accumulates pose/form data over ~20s windows,
 * sends compact summary to Claude for personalized Hebrew coaching.
 *
 * Uses refs only (no state) to avoid re-render storms at 60fps.
 * Gracefully degrades: if API fails 3 times, disables for session.
 */
export function useAICoach({ onCoaching }) {
  const accRef = useRef(null);
  const intervalRef = useRef(null);
  const failureCountRef = useRef(0);
  const disabledRef = useRef(false);
  const contextRef = useRef(null);
  const inFlightRef = useRef(false);

  // Reset accumulator
  function resetAccumulator() {
    accRef.current = {
      totalFrames: 0,
      goodFormFrames: 0,
      badFormFrames: 0,
      formIssues: {},
      reps: 0,
      movingFrames: 0,
      headDownFrames: 0,
      ballDetections: 0,
      windowStartTime: Date.now(),
    };
  }

  /**
   * feedPoseData — Called every frame from Training.jsx coaching loop.
   * O(1), no state updates, no re-renders.
   */
  const feedPoseData = useCallback((data) => {
    if (!accRef.current || disabledRef.current) return;
    const acc = accRef.current;

    acc.totalFrames++;
    if (data.moving) acc.movingFrames++;
    if (data.headDown) acc.headDownFrames++;

    if (data.feedback) {
      if (data.feedback.type === 'good') acc.goodFormFrames++;
      else if (data.feedback.type === 'warning') acc.badFormFrames++;
    }

    if (data.feedback?.type === 'count') {
      acc.reps = data.feedback.count || acc.reps;
    }

    // Accumulate form issues
    if (data.formIssues) {
      for (const [key, count] of Object.entries(data.formIssues)) {
        acc.formIssues[key] = (acc.formIssues[key] || 0) + (typeof count === 'number' ? 1 : 0);
      }
    }

    if (data.ballDetected) acc.ballDetections++;
  }, []);

  /**
   * sendToAPI — Builds compact payload, sends to server, calls onCoaching.
   * Smart skip: if goodFormPct > 90% and no issues, skip the call.
   */
  const sendToAPI = useCallback(async () => {
    if (disabledRef.current || inFlightRef.current) return;
    if (!accRef.current || !contextRef.current) return;

    const acc = accRef.current;
    const ctx = contextRef.current;

    // Skip if almost no data
    if (acc.totalFrames < 30) return;

    const totalWithFeedback = acc.goodFormFrames + acc.badFormFrames;
    const goodFormPct = totalWithFeedback > 0 ? Math.round((acc.goodFormFrames / totalWithFeedback) * 100) : 50;
    const badFormPct = 100 - goodFormPct;

    // Smart skip: form is great and no issues — save the API call
    if (goodFormPct > 90 && Object.keys(acc.formIssues).length === 0) {
      resetAccumulator();
      return;
    }

    // Top 3 issues
    const topIssues = Object.entries(acc.formIssues)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key]) => key);

    const payload = {
      exercise: ctx.exerciseName,
      sport: ctx.sport,
      duration: Math.round((Date.now() - acc.windowStartTime) / 1000),
      reps: acc.reps,
      targetReps: ctx.targetReps,
      sets: ctx.currentSet,
      targetSets: ctx.targetSets,
      goodFormPct,
      badFormPct,
      topIssues,
      age: ctx.age,
      disability: ctx.disability,
      playerName: ctx.playerName,
      skillLevel: ctx.skillLevel,
    };

    // Reset accumulator before async call
    resetAccumulator();
    inFlightRef.current = true;

    try {
      const resp = await fetch(`${API_BASE}/api/coach/realtime-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      failureCountRef.current = 0;

      if (data.feedback && onCoaching) {
        onCoaching(data.feedback, data.isUrgent || false);
      }
    } catch (err) {
      console.warn('[AICoach] API error:', err.message);
      failureCountRef.current++;

      if (failureCountRef.current >= MAX_FAILURES) {
        console.warn('[AICoach] Too many failures, disabling for this session');
        disabledRef.current = true;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [onCoaching]);

  /**
   * startAICoaching — Call when entering EXERCISING phase.
   */
  const startAICoaching = useCallback((context) => {
    contextRef.current = context;
    failureCountRef.current = 0;
    disabledRef.current = false;
    resetAccumulator();

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(sendToAPI, AI_INTERVAL_MS);
  }, [sendToAPI]);

  /**
   * stopAICoaching — Call when leaving EXERCISING phase.
   */
  const stopAICoaching = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    accRef.current = null;
    contextRef.current = null;
    inFlightRef.current = false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return { startAICoaching, stopAICoaching, feedPoseData };
}

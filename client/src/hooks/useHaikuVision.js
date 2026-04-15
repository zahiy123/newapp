import { useRef, useCallback } from 'react';
const ANALYZE_REP_URL = 'https://newapp-nujg.onrender.com/api/coach/analyze-rep';
const MAX_SESSION_IMAGES = 960;
const MAX_CONSECUTIVE_FAILURES = 10;

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

function getPrimaryAngle(angles) {
  if (!angles || typeof angles !== 'object') return null;
  for (const v of Object.values(angles)) {
    if (typeof v === 'number') return v;
  }
  return null;
}

export function useHaikuVision({ onVisionFeedback } = {}) {
  const enabledRef = useRef(false);
  const disabledRef = useRef(false);
  const contextRef = useRef(null);
  const captureFrameFnRef = useRef(null);
  const videoElRef = useRef(null);

  // Frame buffers
  const startFrameRef = useRef(null);       // Frame 1: captured at descent start
  const startAnglesRef = useRef(null);
  const startLandmarksRef = useRef(null);

  // Peak tracking
  const minAngleDuringDownRef = useRef(Infinity);
  const peakFrameRef = useRef(null);
  const peakAnglesRef = useRef(null);
  const peakLandmarksRef = useRef(null);
  const peakSentRef = useRef(false);
  const prevAngleRef = useRef(null);
  const lastPhaseRef = useRef(null);

  // Rep tracking
  const repCountRef = useRef(0);
  const earlySentRepRef = useRef(0);
  const sessionImageCountRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);
  const inFlightRef = useRef(false);

  // Capture a frame from the video element
  const captureFrame = useCallback(() => {
    if (sessionImageCountRef.current >= MAX_SESSION_IMAGES) {
      console.warn(`[HaikuVision] NOT CAPTURING: session limit reached (${MAX_SESSION_IMAGES})`);
      return null;
    }
    const fn = captureFrameFnRef.current;
    const video = videoElRef.current;
    if (!fn) { console.warn('[HaikuVision] NOT CAPTURING: no captureFrameFn'); return null; }
    if (!video) { console.warn('[HaikuVision] NOT CAPTURING: no video element'); return null; }
    const frame = fn(video);
    if (!frame) { console.warn('[HaikuVision] NOT CAPTURING: captureFrameFn returned null (black frame?)'); return null; }
    sessionImageCountRef.current++;
    return frame;
  }, []);

  // === FORCE SEND: no inFlight gate, no confidence gate ===
  const sendToServer = useCallback(async (frame1, frame2, repNumber, angles1, angles2, landmarks1, landmarks2, triggerTs) => {
    if (disabledRef.current) {
      console.warn(`[HaikuVision] NOT SENDING: disabled after ${MAX_CONSECUTIVE_FAILURES} failures`);
      return;
    }
    // Log inFlight but DON'T block — queue will naturally serialize via async
    if (inFlightRef.current) {
      console.warn(`[HaikuVision] SEND CONCURRENT: previous request still in-flight, sending anyway`);
    }
    inFlightRef.current = true;

    const ctx = contextRef.current;
    const url = ANALYZE_REP_URL;
    const frames = [frame1, frame2].filter(Boolean);
    const jointAngles = [angles1, angles2].filter(Boolean);
    const telemetry = condenseLandmarks([landmarks1, landmarks2].filter(Boolean));

    // Log the photo proof
    const f1Size = frame1 ? Math.round(frame1.length / 1024) : 0;
    const f2Size = frame2 ? Math.round(frame2.length / 1024) : 0;
    console.log(`[HaikuVision] 📸 PHOTO CAPTURED at peak angle: ${Math.round(minAngleDuringDownRef.current)}° | frame1=${f1Size}KB, frame2=${f2Size}KB`);
    if (frame2) {
      console.log(`[HaikuVision] 📸 Peak frame preview (first 80 chars): ${frame2.substring(0, 80)}...`);
    }

    const sendTs = Date.now();
    const peakToSendMs = triggerTs ? sendTs - triggerTs : 0;
    console.log(`[HaikuVision] 🚀 Sending REAL camera frames to server... rep #${repNumber} | exercise=${ctx?.exerciseName} | sport=${ctx?.sport} | peakToSend=${peakToSendMs}ms`);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames,
          jointAngles,
          telemetry: telemetry || [],
          sport: ctx?.sport || 'fitness',
          exercise: ctx?.exerciseName || '',
          playerProfile: ctx?.playerProfile,
          playerName: ctx?.playerName || '',
          repNumber
        })
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
      }

      const result = await resp.json();
      const responseTs = Date.now();
      const roundTripMs = responseTs - sendTs;
      const totalLatencyMs = triggerTs ? responseTs - triggerTs : roundTripMs;
      consecutiveFailuresRef.current = 0;

      if (!result.feedback && !result.instruction) {
        console.warn(`[HaikuVision] ⚠️ EMPTY RESPONSE for rep #${repNumber}:`, JSON.stringify(result));
      }

      if (onVisionFeedback) {
        const repConfirmed = repCountRef.current > (repNumber - 1);
        console.log(`[HaikuVision] ✅ Rep #${repNumber} | score=${result.score} | roundTrip=${roundTripMs}ms | peakToResponse=${totalLatencyMs}ms | confirmed=${repConfirmed} | feedback="${(result.feedback || '').slice(0, 80)}"`);
        onVisionFeedback({ ...result, repConfirmed, repNumber, _latency: { roundTripMs, totalLatencyMs } });
      }
    } catch (err) {
      const errorMs = Date.now() - sendTs;
      console.error(`[HaikuVision] ❌ FETCH ERROR for rep #${repNumber} after ${errorMs}ms:`, err.message);
      consecutiveFailuresRef.current++;
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        console.warn('[HaikuVision] Too many failures, disabling');
        disabledRef.current = true;
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [onVisionFeedback]);

  // === MAIN LOOP: called every frame from Training.jsx ===
  const feedPhaseData = useCallback((newState, angles, landmarks) => {
    if (!enabledRef.current || disabledRef.current) return;
    if (!newState) return;

    const currentPhase = newState.phase;
    const prevPhase = lastPhaseRef.current;
    const reps = newState.reps ?? 0;
    const primaryAngle = getPrimaryAngle(angles);

    // === ANY down phase start (from up OR from null) — capture Frame 1 ===
    if (currentPhase === 'down' && prevPhase !== 'down') {
      const f1 = captureFrame();
      startFrameRef.current = f1;
      startAnglesRef.current = angles || null;
      startLandmarksRef.current = landmarks || null;
      minAngleDuringDownRef.current = Infinity;
      peakFrameRef.current = null;
      peakAnglesRef.current = null;
      peakLandmarksRef.current = null;
      peakSentRef.current = false;
      prevAngleRef.current = primaryAngle;
      console.log(`[HaikuVision] ⬇️ DOWN START | angle=${primaryAngle !== null ? Math.round(primaryAngle) : '?'}° | frame1=${f1 ? Math.round(f1.length/1024)+'KB' : 'FAILED'}`);
      lastPhaseRef.current = currentPhase;
      return;
    }

    // === DURING DOWN: track deepest angle + detect trend reversal ===
    if (currentPhase === 'down' && primaryAngle !== null) {
      // Track minimum
      if (primaryAngle < minAngleDuringDownRef.current) {
        minAngleDuringDownRef.current = primaryAngle;
        const pf = captureFrame();
        if (pf) {
          peakFrameRef.current = pf;
          peakAnglesRef.current = angles || null;
          peakLandmarksRef.current = landmarks || null;
        }
      }

      // === TREND REVERSAL: angle rising by 3°+ → FORCE SEND ===
      const prev = prevAngleRef.current;
      if (!peakSentRef.current && prev !== null && primaryAngle > prev + 3 && peakFrameRef.current) {
        peakSentRef.current = true;
        const triggerTs = Date.now();
        const anticipatedRep = repCountRef.current + 1;
        earlySentRepRef.current = anticipatedRep;
        console.log(`[HaikuVision] 🎯 PEAK REVERSAL at ${Math.round(minAngleDuringDownRef.current)}° (now ${Math.round(primaryAngle)}°, was ${Math.round(prev)}°) → FORCE SEND rep #${anticipatedRep}`);

        // Use start frame if available, otherwise use peak frame for both
        const f1 = startFrameRef.current || peakFrameRef.current;
        const f2 = peakFrameRef.current;
        sendToServer(f1, f2, anticipatedRep, startAnglesRef.current, peakAnglesRef.current, startLandmarksRef.current, peakLandmarksRef.current, triggerTs);
      }

      prevAngleRef.current = primaryAngle;
    }

    // === PHASE: down → up — fallback if peak send didn't fire ===
    if (prevPhase === 'down' && currentPhase === 'up') {
      if (peakSentRef.current) {
        console.log(`[HaikuVision] ⬆️ UP | already sent at peak`);
      } else {
        // Fallback: send whatever we have
        const f1 = startFrameRef.current;
        const f2 = peakFrameRef.current || captureFrame();
        if (f1 && f2) {
          const anticipatedRep = repCountRef.current + 1;
          const fallbackTs = Date.now();
          earlySentRepRef.current = anticipatedRep;
          console.log(`[HaikuVision] ⬆️ FALLBACK SEND at down→up for rep #${anticipatedRep} (peak=${Math.round(minAngleDuringDownRef.current)}°)`);
          sendToServer(f1, f2, anticipatedRep, startAnglesRef.current, peakAnglesRef.current, startLandmarksRef.current, peakLandmarksRef.current, fallbackTs);
        } else {
          console.warn(`[HaikuVision] ⬆️ NOT SENDING at down→up: f1=${!!f1}, f2=${!!f2}`);
        }
      }
    }

    // Sync rep count
    if (reps > repCountRef.current) {
      console.log(`[HaikuVision] Rep confirmed: ${reps} (earlySent=${earlySentRepRef.current})`);
      repCountRef.current = reps;
    }

    lastPhaseRef.current = currentPhase;
  }, [captureFrame, sendToServer]);

  const startVision = useCallback((context, captureFrameFn, videoEl) => {
    contextRef.current = context;
    captureFrameFnRef.current = captureFrameFn;
    videoElRef.current = videoEl;
    startFrameRef.current = null;
    lastPhaseRef.current = null;
    repCountRef.current = 0;
    earlySentRepRef.current = 0;
    consecutiveFailuresRef.current = 0;
    minAngleDuringDownRef.current = Infinity;
    peakFrameRef.current = null;
    peakSentRef.current = false;
    prevAngleRef.current = null;
    enabledRef.current = true;
    disabledRef.current = false;
    console.log(`[HaikuVision] 🟢 Vision STARTED | exercise=${context?.exerciseName} | sport=${context?.sport} | captureFrameFn=${!!captureFrameFn} | videoEl=${!!videoEl}`);
  }, []);

  const stopVision = useCallback(() => {
    enabledRef.current = false;
    startFrameRef.current = null;
    lastPhaseRef.current = null;
    console.log(`[HaikuVision] 🔴 Vision STOPPED`);
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

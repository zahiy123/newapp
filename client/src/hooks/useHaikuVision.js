import { useRef, useCallback } from 'react';
const ANALYZE_REP_URL = 'https://newapp-nujg.onrender.com/api/coach/analyze-rep';
const MAX_SESSION_IMAGES = 960;
const MAX_CONSECUTIVE_FAILURES = 10;

// Relative ROM: a rep counts if the athlete dropped at least this % from starting angle
const MIN_ROM_PERCENT = 0.15; // 15%
// Absolute fallback: never require deeper than this (rehabilitation safety)
const ABSOLUTE_MIN_ANGLE = 140;
// Shoulder Y displacement threshold (normalized 0-1 coords): confirms movement even with noisy angles
const SHOULDER_Y_MIN_DISPLACEMENT = 0.03; // 3% of frame height

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

// Get average shoulder Y from landmarks (indices 11, 12)
function getShoulderY(landmarks) {
  if (!landmarks || !Array.isArray(landmarks)) return null;
  const l = landmarks[11];
  const r = landmarks[12];
  if (!l && !r) return null;
  if (l && r) return (l.y + r.y) / 2;
  return (l || r).y;
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

  // Best-frame buffer: holds the frame at the deepest angle during "down" phase
  const minAngleDuringDownRef = useRef(Infinity);
  const bestFrameRef = useRef(null);
  const bestAnglesRef = useRef(null);
  const bestLandmarksRef = useRef(null);
  const peakSentRef = useRef(false);
  const prevAngleRef = useRef(null);
  const lastPhaseRef = useRef(null);

  // Relative thresholding: learned from calibration + adaptive during set
  const startingAngleRef = useRef(null);       // Angle at "up" position (from calibration or first up phase)
  const startShoulderYRef = useRef(null);       // Shoulder Y at start of down phase
  const bestShoulderYRef = useRef(null);        // Deepest shoulder Y during down phase
  const adaptiveMinAngleRef = useRef(null);     // Best observed peak across the set (tightens over time)
  const calibrationBaselineRef = useRef(null);  // Calibration data passed from Training.jsx

  // Rep tracking
  const repCountRef = useRef(0);
  const earlySentRepRef = useRef(0);
  const sessionImageCountRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);
  const inFlightRef = useRef(false);
  const warmUpSentRef = useRef(false);
  // Duplicate prevention: set of rep numbers already confirmed by AI
  const confirmedRepsRef = useRef(new Set());

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

  // === SEND WITH REQUEST LOCKING: block concurrent requests ===
  const sendToServer = useCallback(async (frame1, frame2, repNumber, angles1, angles2, landmarks1, landmarks2, triggerTs) => {
    if (disabledRef.current) {
      console.warn(`[HaikuVision] NOT SENDING: disabled after ${MAX_CONSECUTIVE_FAILURES} failures`);
      return;
    }
    if (inFlightRef.current) {
      console.warn(`[HaikuVision] BLOCKED: previous request still in-flight, skipping rep #${repNumber}`);
      return;
    }
    // Pre-send duplicate check: if this rep was already confirmed, skip entirely
    if (confirmedRepsRef.current.has(repNumber)) {
      console.warn(`[HaikuVision] SKIPPED: rep #${repNumber} already confirmed, not sending again`);
      return;
    }
    inFlightRef.current = true;

    // Notify UI immediately that we're analyzing
    if (onVisionFeedback) {
      onVisionFeedback({ _analyzing: true, repNumber });
    }

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

    const payloadKB = Math.round((frames.reduce((s, f) => s + (f?.length || 0), 0)) / 1024);
    console.log(`[Speed-Check] Payload size: ${payloadKB} KB`);

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
        // AI-driven confirmation: score > 2 means the rep counts
        const aiScore = result.score ?? 0;
        const isDuplicate = confirmedRepsRef.current.has(repNumber);

        // Silently drop duplicate responses — don't call onVisionFeedback at all
        if (isDuplicate) {
          console.warn(`[HaikuVision] ⚠️ Rep #${repNumber} DUPLICATE — already confirmed, silently dropping`);
          return;
        }

        const repConfirmed = aiScore > 2;

        if (repConfirmed) {
          confirmedRepsRef.current.add(repNumber);
          // Advance repCountRef so next anticipatedRep = repNumber + 1
          repCountRef.current = Math.max(repCountRef.current, repNumber);
          console.log(`[HaikuVision] ✅ Rep #${repNumber} CONFIRMED by AI | score=${aiScore} | repCountRef→${repCountRef.current} | roundTrip=${roundTripMs}ms | peakToResponse=${totalLatencyMs}ms`);
        } else {
          console.log(`[HaikuVision] ❌ Rep #${repNumber} NOT confirmed | score=${aiScore} (<=2) | roundTrip=${roundTripMs}ms`);
        }

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

  // Compute the dynamic rep threshold based on starting angle + adaptive learning
  const getRepThreshold = useCallback(() => {
    const base = startingAngleRef.current;
    if (base !== null) {
      // Relative: 15% drop from starting angle
      const relativeThreshold = base * (1 - MIN_ROM_PERCENT);
      // If we've seen deeper reps, adapt: require at least 80% of best observed ROM
      if (adaptiveMinAngleRef.current !== null) {
        const adaptiveRange = base - adaptiveMinAngleRef.current; // e.g. 160-90 = 70
        const adaptiveThreshold = base - adaptiveRange * 0.8;    // e.g. 160-56 = 104
        const threshold = Math.max(relativeThreshold, adaptiveThreshold);
        return Math.min(threshold, ABSOLUTE_MIN_ANGLE);
      }
      return Math.min(relativeThreshold, ABSOLUTE_MIN_ANGLE);
    }
    return ABSOLUTE_MIN_ANGLE; // absolute fallback
  }, []);

  // Check if the current down phase qualifies as a rep
  const isRepQualified = useCallback((minAngle, shoulderDisplacement) => {
    const threshold = getRepThreshold();
    // Angle-based: did the athlete go deep enough?
    const angleQualified = minAngle <= threshold;
    // Shoulder Y displacement: confirms real movement even with noisy angles
    const yQualified = shoulderDisplacement !== null && shoulderDisplacement >= SHOULDER_Y_MIN_DISPLACEMENT;
    return angleQualified || (yQualified && minAngle <= ABSOLUTE_MIN_ANGLE);
  }, [getRepThreshold]);

  // === MAIN LOOP: called every frame from Training.jsx ===
  const feedPhaseData = useCallback((newState, angles, landmarks) => {
    if (!enabledRef.current || disabledRef.current) return;
    if (!newState) return;

    const currentPhase = newState.phase;
    const prevPhase = lastPhaseRef.current;
    const reps = newState.reps ?? 0;
    const primaryAngle = getPrimaryAngle(angles);
    const shoulderY = getShoulderY(landmarks);

    // === Learn starting angle from "up" phase or calibration ===
    if (currentPhase === 'up' && primaryAngle !== null && startingAngleRef.current === null) {
      startingAngleRef.current = primaryAngle;
      console.log(`[HaikuVision] 📐 Starting angle learned: ${Math.round(primaryAngle)}° | threshold=${Math.round(getRepThreshold())}°`);
    }

    // === ANY down phase start (from up OR from null) — capture Frame 1, reset bestFrame ===
    if (currentPhase === 'down' && prevPhase !== 'down') {
      const f1 = captureFrame();
      startFrameRef.current = f1;
      startAnglesRef.current = angles || null;
      startLandmarksRef.current = landmarks || null;
      // Reset best-frame buffer for this new rep
      minAngleDuringDownRef.current = Infinity;
      bestFrameRef.current = null;
      bestAnglesRef.current = null;
      bestLandmarksRef.current = null;
      peakSentRef.current = false;
      prevAngleRef.current = primaryAngle;
      startShoulderYRef.current = shoulderY;
      bestShoulderYRef.current = null;
      console.log(`[HaikuVision] ⬇️ DOWN START | angle=${primaryAngle !== null ? Math.round(primaryAngle) : '?'}° | shoulderY=${shoulderY !== null ? shoulderY.toFixed(3) : '?'} | threshold=${Math.round(getRepThreshold())}° | frame1=${f1 ? Math.round(f1.length/1024)+'KB' : 'FAILED'}`);
      lastPhaseRef.current = currentPhase;
      return;
    }

    // === DURING DOWN: continuously update bestFrame at the deepest angle ===
    if (currentPhase === 'down' && primaryAngle !== null) {
      // Update best frame whenever we reach a new minimum angle
      if (primaryAngle < minAngleDuringDownRef.current) {
        minAngleDuringDownRef.current = primaryAngle;
        const bf = captureFrame();
        if (bf) {
          bestFrameRef.current = bf;
          bestAnglesRef.current = angles || null;
          bestLandmarksRef.current = landmarks || null;
        }
      }
      // Track shoulder Y displacement
      if (shoulderY !== null) {
        if (bestShoulderYRef.current === null || shoulderY > bestShoulderYRef.current) {
          bestShoulderYRef.current = shoulderY; // In normalized coords, Y increases downward
        }
      }

      // === TREND REVERSAL: angle rising by 2°+ → send the BUFFERED best frame ===
      const prev = prevAngleRef.current;
      if (!peakSentRef.current && prev !== null && primaryAngle > prev + 2 && bestFrameRef.current) {
        const shoulderDisp = (startShoulderYRef.current !== null && bestShoulderYRef.current !== null)
          ? bestShoulderYRef.current - startShoulderYRef.current : null;
        const qualified = isRepQualified(minAngleDuringDownRef.current, shoulderDisp);

        if (!qualified) {
          console.log(`[HaikuVision] ⚠️ PEAK at ${Math.round(minAngleDuringDownRef.current)}° | threshold=${Math.round(getRepThreshold())}° | shoulderDY=${shoulderDisp !== null ? shoulderDisp.toFixed(3) : '?'} — too shallow, skipping`);
        } else {
          peakSentRef.current = true;
          const triggerTs = Date.now();
          const anticipatedRep = repCountRef.current + 1;
          earlySentRepRef.current = anticipatedRep;

          // Adaptive: update best observed peak for this set
          if (adaptiveMinAngleRef.current === null || minAngleDuringDownRef.current < adaptiveMinAngleRef.current) {
            adaptiveMinAngleRef.current = minAngleDuringDownRef.current;
            console.log(`[HaikuVision] 📊 Adaptive ROM updated: best peak=${Math.round(adaptiveMinAngleRef.current)}° | new threshold=${Math.round(getRepThreshold())}°`);
          }

          console.log(`[HaikuVision] 🎯 PEAK REVERSAL at ${Math.round(minAngleDuringDownRef.current)}° (now ${Math.round(primaryAngle)}°) | shoulderDY=${shoulderDisp !== null ? shoulderDisp.toFixed(3) : '?'} → sending BEST FRAME rep #${anticipatedRep}`);

          const f1 = startFrameRef.current || bestFrameRef.current;
          const f2 = bestFrameRef.current;
          sendToServer(f1, f2, anticipatedRep, startAnglesRef.current, bestAnglesRef.current, startLandmarksRef.current, bestLandmarksRef.current, triggerTs);
        }
      }

      prevAngleRef.current = primaryAngle;
    }

    // === PHASE: down → up — fallback using BUFFERED best frame only ===
    if (prevPhase === 'down' && currentPhase === 'up') {
      if (peakSentRef.current) {
        console.log(`[HaikuVision] ⬆️ UP | already sent best frame at peak`);
      } else {
        const shoulderDisp = (startShoulderYRef.current !== null && bestShoulderYRef.current !== null)
          ? bestShoulderYRef.current - startShoulderYRef.current : null;
        const qualified = bestFrameRef.current && isRepQualified(minAngleDuringDownRef.current, shoulderDisp);

        if (qualified) {
          const f1 = startFrameRef.current || bestFrameRef.current;
          const f2 = bestFrameRef.current;
          const anticipatedRep = repCountRef.current + 1;
          const fallbackTs = Date.now();
          earlySentRepRef.current = anticipatedRep;

          // Adaptive update
          if (adaptiveMinAngleRef.current === null || minAngleDuringDownRef.current < adaptiveMinAngleRef.current) {
            adaptiveMinAngleRef.current = minAngleDuringDownRef.current;
          }

          console.log(`[HaikuVision] ⬆️ FALLBACK SEND best frame for rep #${anticipatedRep} (peak=${Math.round(minAngleDuringDownRef.current)}°, threshold=${Math.round(getRepThreshold())}°)`);
          sendToServer(f1, f2, anticipatedRep, startAnglesRef.current, bestAnglesRef.current, startLandmarksRef.current, bestLandmarksRef.current, fallbackTs);
        } else {
          console.warn(`[HaikuVision] ⬆️ NOT SENDING: bestFrame=${!!bestFrameRef.current}, minAngle=${Math.round(minAngleDuringDownRef.current)}°, threshold=${Math.round(getRepThreshold())}°, shoulderDY=${(startShoulderYRef.current !== null && bestShoulderYRef.current !== null) ? (bestShoulderYRef.current - startShoulderYRef.current).toFixed(3) : '?'}`);
        }
      }

      // Update starting angle from "up" position for better accuracy
      if (primaryAngle !== null) {
        startingAngleRef.current = primaryAngle;
      }
    }

    // Sync rep count
    if (reps > repCountRef.current) {
      console.log(`[HaikuVision] Rep confirmed: ${reps} (earlySent=${earlySentRepRef.current})`);
      repCountRef.current = reps;
    }

    lastPhaseRef.current = currentPhase;
  }, [captureFrame, sendToServer, getRepThreshold, isRepQualified]);

  // === SERVER WARM-UP: fire once during calibration to open SSL + wake AI ===
  const performWarmUpCalibration = useCallback((captureFrameFn, videoEl) => {
    if (warmUpSentRef.current) return;
    if (!captureFrameFn || !videoEl) return;
    const frame = captureFrameFn(videoEl);
    if (!frame) return;
    warmUpSentRef.current = true;
    const frameKB = Math.round(frame.length / 1024);
    console.log(`[WarmUp] Sending calibration frame to wake server (${frameKB} KB)...`);
    const t0 = Date.now();
    fetch(ANALYZE_REP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frames: [frame],
        exercise: 'calibration',
        sport: 'warmup',
        playerName: 'calibration',
        repNumber: 0
      })
    })
      .then(r => r.json())
      .then(data => {
        console.log(`[WarmUp] Server ready in ${Date.now() - t0}ms | status=${data.status || 'ok'}`);
      })
      .catch(err => {
        console.warn(`[WarmUp] Warm-up failed (${Date.now() - t0}ms):`, err.message);
      });
  }, []);

  const startVision = useCallback((context, captureFrameFn, videoEl, calibration) => {
    contextRef.current = context;
    captureFrameFnRef.current = captureFrameFn;
    videoElRef.current = videoEl;
    startFrameRef.current = null;
    lastPhaseRef.current = null;
    repCountRef.current = 0;
    earlySentRepRef.current = 0;
    consecutiveFailuresRef.current = 0;
    minAngleDuringDownRef.current = Infinity;
    bestFrameRef.current = null;
    bestAnglesRef.current = null;
    bestLandmarksRef.current = null;
    peakSentRef.current = false;
    prevAngleRef.current = null;
    enabledRef.current = true;
    disabledRef.current = false;
    warmUpSentRef.current = false;
    confirmedRepsRef.current = new Set();
    // Relative thresholding: seed from calibration if available
    calibrationBaselineRef.current = calibration || null;
    startShoulderYRef.current = null;
    bestShoulderYRef.current = null;
    adaptiveMinAngleRef.current = null;
    // Use calibration max angle as starting angle if available
    if (calibration) {
      const calMax = Object.entries(calibration)
        .filter(([k]) => !k.startsWith('_'))
        .reduce((best, [, v]) => v.max > best ? v.max : best, 0);
      startingAngleRef.current = calMax > 0 ? calMax : null;
      console.log(`[HaikuVision] 🟢 Vision STARTED | exercise=${context?.exerciseName} | startAngle=${calMax > 0 ? Math.round(calMax) : 'auto'}° | calibration=${!!calibration}`);
    } else {
      startingAngleRef.current = null;
      console.log(`[HaikuVision] 🟢 Vision STARTED | exercise=${context?.exerciseName} | startAngle=auto (will learn from first up phase)`);
    }
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
    confirmedRepsRef.current = new Set();
  }, []);

  const getSessionStats = useCallback(() => ({
    imagesUsed: sessionImageCountRef.current,
    imagesRemaining: MAX_SESSION_IMAGES - sessionImageCountRef.current,
    disabled: disabledRef.current
  }), []);

  return { feedPhaseData, startVision, stopVision, resetSession, getSessionStats, performWarmUpCalibration };
}

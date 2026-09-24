import { useRef, useCallback } from 'react';
import { apiUrl, authFetch } from '../utils/api';
import { PeakDetector, getPeakTriggers } from '../utils/kineticEngine';
const ANALYZE_REP_URL = apiUrl('/api/coach/analyze-rep');
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
  const lastPhaseRef = useRef(null);

  // Kinetic Engine: schema-driven peak detector
  const peakDetectorRef = useRef(null);

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
  const sendToServer = useCallback(async (frame1, frame2, repNumber, angles1, angles2, landmarks1, landmarks2, triggerTs, equipmentSnapshot) => {
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
    console.log(`[HaikuVision] 📸 PHOTO CAPTURED | frame1=${f1Size}KB, frame2=${f2Size}KB`);

    const payloadKB = Math.round((frames.reduce((s, f) => s + (f?.length || 0), 0)) / 1024);
    console.log(`[Speed-Check] Payload size: ${payloadKB} KB`);

    const sendTs = Date.now();
    const peakToSendMs = triggerTs ? sendTs - triggerTs : 0;
    console.log(`[HaikuVision] 🚀 Sending REAL camera frames to server... rep #${repNumber} | exercise=${ctx?.exerciseName} | sport=${ctx?.sport} | peakToSend=${peakToSendMs}ms`);

    try {
      const resp = await authFetch(url, {
        method: 'POST',
        body: JSON.stringify({
          frames,
          jointAngles,
          telemetry: telemetry || [],
          sport: ctx?.sport || 'fitness',
          exercise: ctx?.exerciseName || '',
          playerProfile: ctx?.playerProfile,
          playerName: ctx?.playerName || '',
          repNumber,
          previousScore: ctx?.previousScore || null,
          equipment: equipmentSnapshot?.length > 0
            ? equipmentSnapshot.map(e => ({ class: e.className, x: e.x, y: e.y, confidence: e.confidence }))
            : undefined
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

  // === MAIN LOOP: called every frame from Training.jsx ===
  const feedPhaseData = useCallback((newState, angles, landmarks, ballData, equipmentData) => {
    if (!enabledRef.current || disabledRef.current) return;
    if (!newState) return;

    const currentPhase = newState.phase;
    const prevPhase = lastPhaseRef.current;
    const reps = newState.reps ?? 0;

    // === Capture "start frame" when entering down/active phase ===
    if (currentPhase === 'down' && prevPhase !== 'down') {
      const f1 = captureFrame();
      startFrameRef.current = f1;
      startAnglesRef.current = angles || null;
      startLandmarksRef.current = landmarks || null;
      // Reset detector for new rep
      peakDetectorRef.current?.resetForNewRep();
      const primaryAngle = getPrimaryAngle(angles);
      console.log(`[HaikuVision] ⬇️ DOWN START | angle=${primaryAngle !== null ? Math.round(primaryAngle) : '?'}° | frame1=${f1 ? Math.round(f1.length/1024)+'KB' : 'FAILED'}`);
      lastPhaseRef.current = currentPhase;
      return;
    }

    // === Feed frame data to the PeakDetector ===
    if (peakDetectorRef.current) {
      peakDetectorRef.current.feed({
        angles,
        landmarks,
        ballData: ballData || null,
        equipmentData: equipmentData || null,
        analyzerState: newState,
        captureFrame,
      });
    }

    // Sync rep count
    if (reps > repCountRef.current) {
      console.log(`[HaikuVision] Rep confirmed: ${reps} (earlySent=${earlySentRepRef.current})`);
      repCountRef.current = reps;
    }

    lastPhaseRef.current = currentPhase;
  }, [captureFrame, sendToServer]);

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
    authFetch(ANALYZE_REP_URL, {
      method: 'POST',
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
    enabledRef.current = true;
    disabledRef.current = false;
    warmUpSentRef.current = false;
    confirmedRepsRef.current = new Set();

    // Instantiate PeakDetector with exercise-specific triggers
    const cueKey = context?.cueKey || 'default';
    const triggers = (context?.peakTrigger) || getPeakTriggers(cueKey);
    peakDetectorRef.current = new PeakDetector(triggers, {
      onPeak: (snapshot) => {
        const anticipatedRep = repCountRef.current + 1;
        earlySentRepRef.current = anticipatedRep;
        console.log(`[HaikuVision] 🎯 KINETIC PEAK: trigger=${snapshot.triggerId} | type=${snapshot.triggerType} | rep #${anticipatedRep}${snapshot.extremeValue != null ? ' | value=' + (typeof snapshot.extremeValue === 'number' ? snapshot.extremeValue.toFixed(1) : snapshot.extremeValue) : ''}`);
        const f1 = startFrameRef.current || snapshot.frame;
        const f2 = snapshot.frame;
        sendToServer(f1, f2, anticipatedRep, startAnglesRef.current, snapshot.angles, startLandmarksRef.current, snapshot.landmarks, snapshot.timestamp, snapshot.equipmentData);
      }
    });

    const triggerIds = triggers.map(t => t.id || t.type).join(',');
    console.log(`[HaikuVision] 🟢 Vision STARTED | exercise=${context?.exerciseName} | cueKey=${cueKey} | triggers=[${triggerIds}]`);
  }, [sendToServer]);

  const stopVision = useCallback(() => {
    enabledRef.current = false;
    startFrameRef.current = null;
    lastPhaseRef.current = null;
    if (peakDetectorRef.current) {
      peakDetectorRef.current.destroy();
      peakDetectorRef.current = null;
    }
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

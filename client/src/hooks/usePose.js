import { useRef, useState, useCallback, useEffect } from 'react';
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import { angleCosine } from '../utils/motionEngine';

// Key landmark indices
const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28
};

// Law of cosines — unused in this file but kept for consistency
function angle(a, b, c) {
  return angleCosine(a, b, c);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

// Returns Set of landmark indices to hide for the amputated limb
function getAmputatedIndices(profile) {
  if (!profile || profile.disability === 'none') return new Set();
  const { disability, amputationSide, amputationLevel } = profile;
  if (!amputationSide || amputationSide === 'none') return new Set();
  const indices = new Set();

  if (disability === 'one_leg') {
    if (amputationSide === 'left') {
      indices.add(25); indices.add(27); indices.add(29); indices.add(31); // knee, ankle, foot landmarks
      if (amputationLevel === 'above_knee') indices.add(23); // hip hidden for above-knee
    } else if (amputationSide === 'right') {
      indices.add(26); indices.add(28); indices.add(30); indices.add(32);
      if (amputationLevel === 'above_knee') indices.add(24);
    }
  } else if (disability === 'one_arm') {
    if (amputationSide === 'left') {
      indices.add(15); indices.add(17); indices.add(19); indices.add(21); // wrist, hand landmarks
      if (amputationLevel === 'above_elbow') indices.add(13); // elbow
    } else if (amputationSide === 'right') {
      indices.add(16); indices.add(18); indices.add(20); indices.add(22);
      if (amputationLevel === 'above_elbow') indices.add(14);
    }
  }
  return indices;
}

export function usePose(canvasRef, beforeDrawRef, amputationProfile) {
  const landmarkerRef = useRef(null);
  const animFrameRef = useRef(null);
  const [ready, setReady] = useState(false);
  // Landmarks: ref for 60fps canvas drawing, state throttled for React consumers
  const landmarksRef = useRef(null);
  const [landmarks, setLandmarks] = useState(null);
  const lastStateUpdateRef = useRef(0);
  const ANALYSIS_INTERVAL_MS = 50; // Push to React state at ~20fps (every 50ms)

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );
      if (cancelled) return;
      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.2,
        minPosePresenceConfidence: 0.2,
        minTrackingConfidence: 0.2
      });
      if (cancelled) return;
      landmarkerRef.current = landmarker;
      setReady(true);
    }
    init();
    return () => { cancelled = true; };
  }, []);

  const detect = useCallback((videoEl) => {
    if (!landmarkerRef.current || !videoEl || videoEl.readyState < 2) return;

    const result = landmarkerRef.current.detectForVideo(videoEl, performance.now());
    const lm = result.landmarks?.[0] || null;

    // Always update ref immediately (60fps — for canvas drawing)
    landmarksRef.current = lm;

    // Throttle React state updates to ~20fps (analysis doesn't need 60fps)
    const now = performance.now();
    if (now - lastStateUpdateRef.current >= ANALYSIS_INTERVAL_MS) {
      lastStateUpdateRef.current = now;
      setLandmarks(lm);
    }

    // Draw on canvas at full 60fps — uses ref, not state
    if (canvasRef?.current && lm) {
      const canvas = canvasRef.current;
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (beforeDrawRef?.current) {
        beforeDrawRef.current(ctx, lm, canvas.width, canvas.height);
      }
      const drawingUtils = new DrawingUtils(ctx);
      const hiddenIndices = getAmputatedIndices(amputationProfile);
      if (hiddenIndices.size === 0) {
        drawingUtils.drawLandmarks(lm, { radius: 4, color: '#00FF00' });
        drawingUtils.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: '#00FFFF', lineWidth: 2 });
      } else {
        const visibleLm = lm.filter((_, i) => !hiddenIndices.has(i));
        drawingUtils.drawLandmarks(visibleLm, { radius: 4, color: '#00FF00' });
        const filteredConnections = PoseLandmarker.POSE_CONNECTIONS.filter(
          c => !hiddenIndices.has(c.start) && !hiddenIndices.has(c.end)
        );
        const mappedLm = lm.map((pt, i) => hiddenIndices.has(i) ? { ...pt, visibility: 0 } : pt);
        drawingUtils.drawConnectors(mappedLm, filteredConnections, { color: '#00FFFF', lineWidth: 2 });
      }
    }
  }, [canvasRef]);

  const startLoop = useCallback((videoEl) => {
    function loop() {
      detect(videoEl);
      animFrameRef.current = requestAnimationFrame(loop);
    }
    loop();
  }, [detect]);

  const stopLoop = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  return { ready, landmarks, landmarksRef, detect, startLoop, stopLoop, LM, angle, midpoint };
}

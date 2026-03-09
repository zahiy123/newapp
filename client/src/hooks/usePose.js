import { useRef, useState, useCallback, useEffect } from 'react';
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';

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

function angle(a, b, c) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let deg = Math.abs(radians * 180 / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export function usePose(canvasRef) {
  const landmarkerRef = useRef(null);
  const animFrameRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [landmarks, setLandmarks] = useState(null);

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
        numPoses: 1
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
    setLandmarks(lm);

    // Draw on canvas
    if (canvasRef?.current && lm) {
      const canvas = canvasRef.current;
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const drawingUtils = new DrawingUtils(ctx);
      drawingUtils.drawLandmarks(lm, { radius: 4, color: '#00FF00' });
      drawingUtils.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: '#00FFFF', lineWidth: 2 });
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

  return { ready, landmarks, detect, startLoop, stopLoop, LM, angle, midpoint };
}

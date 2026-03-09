import { useRef, useState, useCallback, useEffect } from 'react';
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';

// Colors for different detected players
const PLAYER_COLORS = ['#FF0000', '#0000FF', '#00FF00', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080'];

export function useMultiPose(canvasRef) {
  const landmarkerRef = useRef(null);
  const animFrameRef = useRef(null);
  const frameCountRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [allPoses, setAllPoses] = useState([]);
  const [playerCount, setPlayerCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        if (cancelled) return;
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numPoses: 8
        });
        if (cancelled) return;
        landmarkerRef.current = landmarker;
        setReady(true);
      } catch (err) {
        console.warn('MultiPose init failed:', err);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  const detect = useCallback((videoEl) => {
    if (!landmarkerRef.current || !videoEl || videoEl.readyState < 2) return;

    const result = landmarkerRef.current.detectForVideo(videoEl, performance.now());
    const poses = (result.landmarks || []).map((lm, i) => ({
      id: i,
      landmarks: lm,
      // Compute bounding box from landmarks
      bbox: computeBBox(lm),
      // Center position for tracking
      center: computeCenter(lm),
    }));

    setAllPoses(poses);
    setPlayerCount(poses.length);

    // Draw all players on canvas
    if (canvasRef?.current && poses.length > 0) {
      const canvas = canvasRef.current;
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const drawingUtils = new DrawingUtils(ctx);

      poses.forEach((pose, i) => {
        const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
        drawingUtils.drawLandmarks(pose.landmarks, { radius: 3, color });
        drawingUtils.drawConnectors(pose.landmarks, PoseLandmarker.POSE_CONNECTIONS, { color, lineWidth: 2 });

        // Draw player number label
        if (pose.landmarks[0]) {
          const nose = pose.landmarks[0];
          const x = nose.x * canvas.width;
          const y = nose.y * canvas.height - 20;
          ctx.fillStyle = color;
          ctx.font = 'bold 16px Arial';
          ctx.fillText(`P${i + 1}`, x - 10, y);
        }
      });
    }
  }, [canvasRef]);

  const startLoop = useCallback((videoEl) => {
    frameCountRef.current = 0;
    function loop() {
      frameCountRef.current++;
      // Detect every 3 frames (~20fps) to manage multi-person load
      if (frameCountRef.current % 3 === 0) {
        detect(videoEl);
      }
      animFrameRef.current = requestAnimationFrame(loop);
    }
    loop();
  }, [detect]);

  const stopLoop = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setAllPoses([]);
    setPlayerCount(0);
  }, []);

  return { ready, allPoses, playerCount, startLoop, stopLoop };
}

function computeBBox(landmarks) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const lm of landmarks) {
    if (lm.visibility > 0.3) {
      minX = Math.min(minX, lm.x);
      maxX = Math.max(maxX, lm.x);
      minY = Math.min(minY, lm.y);
      maxY = Math.max(maxY, lm.y);
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function computeCenter(landmarks) {
  const hips = [landmarks[23], landmarks[24]].filter(l => l?.visibility > 0.3);
  if (hips.length > 0) {
    return {
      x: hips.reduce((s, h) => s + h.x, 0) / hips.length,
      y: hips.reduce((s, h) => s + h.y, 0) / hips.length,
    };
  }
  // Fallback to nose
  return { x: landmarks[0]?.x || 0.5, y: landmarks[0]?.y || 0.5 };
}

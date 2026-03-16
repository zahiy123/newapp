import { useRef, useState, useCallback, useEffect } from 'react';
// onnxruntime-web is dynamically imported to avoid WASM compile errors at module load

// Ball diameter in cm by sport (for distance estimation)
const BALL_DIAMETERS = {
  football: 22,
  footballAmputee: 22,
  basketball: 24,
  basketballWheelchair: 24,
  tennis: 6.7,
  tennisWheelchair: 6.7,
  default: 22,
};

// Approximate focal length constant (calibrated for typical webcam)
const FOCAL_LENGTH = 700;

const MODEL_PATHS = [
  '/models/ball_yolov8n.onnx',
  '/models/ball_yolov8_uc.onnx',
  '/models/soccana_best.onnx',
];

const INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.4;
const NMS_IOU_THRESHOLD = 0.5;

// Module-level flag: once WASM/ONNX runtime fails, don't retry
let runtimeBroken = false;
// Module-level ort reference (set after successful dynamic import)
let ortModule = null;

export function useBallDetection(sport = 'football') {
  const sessionRef = useRef(null);
  const animFrameRef = useRef(null);
  const frameCountRef = useRef(0);
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const ballDataRef = useRef(null);
  const [ballData, setBallData] = useState(null);
  const sportRef = useRef(sport);

  useEffect(() => { sportRef.current = sport; }, [sport]);

  // Try to load ONNX models — graceful failure with no console spam
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // If WASM runtime already failed in a previous mount, skip entirely
      if (runtimeBroken) return;

      // Fitness doesn't need ball detection
      if (sport === 'fitness') return;

      try {
        ortModule = await import('onnxruntime-web');
        ortModule.env.wasm.numThreads = 1;
        // Suppress ONNX runtime logs
        ortModule.env.logLevel = 'error';
      } catch {
        runtimeBroken = true;
        return; // ONNX runtime import failed — safe mode
      }
      const ort = ortModule;

      // Create offscreen canvas for preprocessing
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = INPUT_SIZE;
      canvasRef.current.height = INPUT_SIZE;

      let bestSession = null;
      let bestTime = Infinity;
      let bestPath = '';
      let loadAttempts = 0;

      // Try each model — stop on first success to minimize noise
      for (const path of MODEL_PATHS) {
        if (cancelled) return;
        try {
          // First verify the file exists and is actually an ONNX file (not an HTML 404 page)
          const probe = await fetch(path, { method: 'HEAD' });
          if (!probe.ok) continue; // 404 — skip silently
          const contentType = probe.headers.get('content-type') || '';
          if (contentType.includes('text/html')) continue; // Server returned HTML error page

          loadAttempts++;
          const session = await ort.InferenceSession.create(path, {
            executionProviders: ['webgl', 'wasm'],
          });

          // Warmup inference to measure time
          const dummyInput = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE);
          const tensor = new ort.Tensor('float32', dummyInput, [1, 3, INPUT_SIZE, INPUT_SIZE]);

          const inputName = session.inputNames[0];
          const start = performance.now();
          await session.run({ [inputName]: tensor });
          const elapsed = performance.now() - start;

          if (elapsed < bestTime) {
            if (bestSession) bestSession.release();
            bestSession = session;
            bestTime = elapsed;
            bestPath = path;
          } else {
            session.release();
          }
        } catch {
          // Silent — don't pollute console
        }
      }

      if (cancelled) {
        bestSession?.release();
        return;
      }

      if (bestSession) {
        sessionRef.current = bestSession;
        console.log(`[BallDetection] Ready: ${bestPath} (${bestTime.toFixed(0)}ms)`);
        setReady(true);
      } else {
        // All models failed — mark runtime as broken to prevent retries
        if (loadAttempts > 0) runtimeBroken = true;
        // No console spam — just silently fall back to pose-only mode
      }
    }

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Preprocess video frame to tensor
  const preprocess = useCallback((videoEl) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const { data } = imageData;

    if (!ortModule) return null;

    // Convert to CHW float32 normalized [0, 1]
    const float32 = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
    const area = INPUT_SIZE * INPUT_SIZE;
    for (let i = 0; i < area; i++) {
      float32[i] = data[i * 4] / 255;              // R
      float32[area + i] = data[i * 4 + 1] / 255;   // G
      float32[2 * area + i] = data[i * 4 + 2] / 255; // B
    }

    return new ortModule.Tensor('float32', float32, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  }, []);

  // NMS: Non-Maximum Suppression
  function nms(boxes, scores, iouThreshold) {
    const indices = Array.from({ length: scores.length }, (_, i) => i);
    indices.sort((a, b) => scores[b] - scores[a]);

    const kept = [];
    const suppressed = new Set();

    for (const i of indices) {
      if (suppressed.has(i)) continue;
      kept.push(i);

      for (const j of indices) {
        if (suppressed.has(j) || j === i) continue;
        const iou = computeIoU(boxes[i], boxes[j]);
        if (iou > iouThreshold) suppressed.add(j);
      }
    }
    return kept;
  }

  function computeIoU(a, b) {
    const x1 = Math.max(a.x - a.w / 2, b.x - b.w / 2);
    const y1 = Math.max(a.y - a.h / 2, b.y - b.h / 2);
    const x2 = Math.min(a.x + a.w / 2, b.x + b.w / 2);
    const y2 = Math.min(a.y + a.h / 2, b.y + b.h / 2);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = a.w * a.h;
    const areaB = b.w * b.h;
    return inter / (areaA + areaB - inter + 1e-6);
  }

  // Post-process YOLOv8 output
  const postprocess = useCallback((output) => {
    const data = output.data;
    const dims = output.dims;

    let numDetections, numValues;
    let transposed = false;

    if (dims.length === 3) {
      if (dims[1] < dims[2]) {
        numValues = dims[1];
        numDetections = dims[2];
        transposed = true;
      } else {
        numDetections = dims[1];
        numValues = dims[2];
      }
    } else {
      return null;
    }

    const boxes = [];
    const scores = [];

    for (let i = 0; i < numDetections; i++) {
      let x, y, w, h, conf;

      if (transposed) {
        x = data[0 * numDetections + i];
        y = data[1 * numDetections + i];
        w = data[2 * numDetections + i];
        h = data[3 * numDetections + i];
        if (numValues === 5) {
          conf = data[4 * numDetections + i];
        } else {
          conf = 0;
          for (let c = 4; c < numValues; c++) {
            conf = Math.max(conf, data[c * numDetections + i]);
          }
        }
      } else {
        const offset = i * numValues;
        x = data[offset];
        y = data[offset + 1];
        w = data[offset + 2];
        h = data[offset + 3];
        if (numValues === 5) {
          conf = data[offset + 4];
        } else {
          conf = 0;
          for (let c = 4; c < numValues; c++) {
            conf = Math.max(conf, data[offset + c]);
          }
        }
      }

      if (conf > CONFIDENCE_THRESHOLD) {
        boxes.push({ x: x / INPUT_SIZE, y: y / INPUT_SIZE, w: w / INPUT_SIZE, h: h / INPUT_SIZE });
        scores.push(conf);
      }
    }

    if (boxes.length === 0) return null;

    const kept = nms(boxes, scores, NMS_IOU_THRESHOLD);
    if (kept.length === 0) return null;

    const best = kept[0];
    const box = boxes[best];
    const ballDiameter = BALL_DIAMETERS[sportRef.current] || BALL_DIAMETERS.default;
    const bboxHeightPx = box.h * INPUT_SIZE;
    const distanceEstimate = bboxHeightPx > 5 ? (ballDiameter * FOCAL_LENGTH) / bboxHeightPx : null;

    return {
      detected: true,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      confidence: scores[best],
      distanceEstimate,
    };
  }, []);

  // Run detection on a single frame
  const detect = useCallback(async (videoEl) => {
    if (!sessionRef.current || !videoEl || videoEl.readyState < 2) return null;

    try {
      const inputTensor = preprocess(videoEl);
      if (!inputTensor) return null;

      const inputName = sessionRef.current.inputNames[0];
      const results = await sessionRef.current.run({ [inputName]: inputTensor });

      const outputName = sessionRef.current.outputNames[0];
      const result = postprocess(results[outputName]);

      ballDataRef.current = result || { detected: false };

      if (frameCountRef.current % 5 === 0) {
        setBallData(ballDataRef.current);
      }

      return result;
    } catch {
      return null;
    }
  }, [preprocess, postprocess]);

  // Detection loop: runs every 10th rAF frame (~6fps at 60fps camera)
  const startLoop = useCallback((videoEl) => {
    // Don't start loop if no model loaded (safe mode — pose-only)
    if (!sessionRef.current) return;
    frameCountRef.current = 0;

    function loop() {
      frameCountRef.current++;
      if (frameCountRef.current % 10 === 0) {
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
    ballDataRef.current = null;
    setBallData(null);
  }, []);

  // Get latest ball data without causing re-render (for 60fps analyzer loop)
  const getBallData = useCallback(() => ballDataRef.current, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      sessionRef.current?.release();
    };
  }, []);

  return { ready, ballData, getBallData, detect, startLoop, stopLoop };
}

import { useRef, useState, useCallback, useEffect } from 'react';
import * as ort from 'onnxruntime-web';

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

  // Benchmark all models and pick fastest
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Set ONNX runtime to use WebGL (fastest in browser)
      ort.env.wasm.numThreads = 1;

      // Create offscreen canvas for preprocessing
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = INPUT_SIZE;
      canvasRef.current.height = INPUT_SIZE;

      let bestSession = null;
      let bestTime = Infinity;
      let bestPath = '';

      // Benchmark each model
      for (const path of MODEL_PATHS) {
        if (cancelled) return;
        try {
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

          console.log(`[BallDetection] ${path}: ${elapsed.toFixed(0)}ms warmup`);

          if (elapsed < bestTime) {
            // Release previous best if any
            if (bestSession) bestSession.release();
            bestSession = session;
            bestTime = elapsed;
            bestPath = path;
          } else {
            session.release();
          }
        } catch (err) {
          console.warn(`[BallDetection] Failed to load ${path}:`, err.message);
        }
      }

      if (cancelled) {
        bestSession?.release();
        return;
      }

      if (bestSession) {
        sessionRef.current = bestSession;
        console.log(`[BallDetection] Selected: ${bestPath} (${bestTime.toFixed(0)}ms)`);
        setReady(true);
      } else {
        console.warn('[BallDetection] No models could be loaded');
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Preprocess video frame to tensor
  const preprocess = useCallback((videoEl) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const { data } = imageData;

    // Convert to CHW float32 normalized [0, 1]
    const float32 = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
    const area = INPUT_SIZE * INPUT_SIZE;
    for (let i = 0; i < area; i++) {
      float32[i] = data[i * 4] / 255;              // R
      float32[area + i] = data[i * 4 + 1] / 255;   // G
      float32[2 * area + i] = data[i * 4 + 2] / 255; // B
    }

    return new ort.Tensor('float32', float32, [1, 3, INPUT_SIZE, INPUT_SIZE]);
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
    // YOLOv8 output shape: [1, 5+numClasses, 8400] or [1, 8400, 5+numClasses]
    // For single-class ball: [1, 5, 8400] → x, y, w, h, conf
    const data = output.data;
    const dims = output.dims;

    let numDetections, numValues;
    let transposed = false;

    if (dims.length === 3) {
      if (dims[1] < dims[2]) {
        // Shape [1, 5+, 8400] — need to interpret columns as detections
        numValues = dims[1];
        numDetections = dims[2];
        transposed = true;
      } else {
        // Shape [1, 8400, 5+]
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
        // For single-class: confidence is at index 4
        // For multi-class: take max of class scores starting at 4
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

    // NMS
    const kept = nms(boxes, scores, NMS_IOU_THRESHOLD);
    if (kept.length === 0) return null;

    // Return best detection
    const best = kept[0];
    const box = boxes[best];
    const ballDiameter = BALL_DIAMETERS[sportRef.current] || BALL_DIAMETERS.default;
    // Distance in cm from apparent size
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

      // Only update state every 5th detection to avoid excessive re-renders
      if (frameCountRef.current % 5 === 0) {
        setBallData(ballDataRef.current);
      }

      return result;
    } catch (err) {
      // Silent failure — don't break the training loop
      return null;
    }
  }, [preprocess, postprocess]);

  // Detection loop: runs every 10th rAF frame (~6fps at 60fps camera)
  const startLoop = useCallback((videoEl) => {
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

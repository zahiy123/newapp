import { useRef, useState, useCallback, useEffect } from 'react';

// Equipment model: 16 classes trained on adaptive sports gear
const EQUIPMENT_MODEL_PATH = '/models/equipment_yolov8n_q.onnx';
const INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.4;
const NMS_IOU_THRESHOLD = 0.5;

// Class labels must match training dataset order
const CLASS_LABELS = [
  'ball', 'crutch', 'wheelchair', 'dumbbell', 'kettlebell', 'barbell',
  'resistance_band', 'stability_ball', 'foam_roller', 'balance_pad',
  'bench', 'cone', 'agility_ladder', 'water_bottle', 'prosthetic', 'medicine_ball',
];

// Ball diameter in cm by sport (for backward-compatible distance estimation)
const BALL_DIAMETERS = {
  football: 22, footballAmputee: 22,
  basketball: 24, basketballWheelchair: 24,
  tennis: 6.7, tennisWheelchair: 6.7,
  default: 22,
};
const FOCAL_LENGTH = 700;

// Module-level ONNX state
let runtimeBroken = false;
let ortModule = null;

// ─── Centroid Tracker ───
// Simple ID-persistent tracker for slow-moving equipment objects

class CentroidTracker {
  constructor(maxDisappeared = 15, matchThreshold = 0.15) {
    this.nextId = 0;
    this.objects = new Map(); // id → tracked object
    this.maxDisappeared = maxDisappeared;
    this.matchThreshold = matchThreshold;
    this.smoothAlpha = 0.6;
  }

  update(detections) {
    // detections: [{ classId, className, confidence, x, y, w, h }]
    if (detections.length === 0) {
      // Increment disappeared count for all tracked objects
      for (const [id, obj] of this.objects) {
        obj.disappeared++;
        if (obj.disappeared > this.maxDisappeared) {
          this.objects.delete(id);
        }
      }
      return this._getResult();
    }

    if (this.objects.size === 0) {
      // Register all detections as new objects
      for (const det of detections) {
        this._register(det);
      }
      return this._getResult();
    }

    // Greedy centroid matching
    const existingIds = [...this.objects.keys()];
    const existingObjects = existingIds.map(id => this.objects.get(id));
    const usedDetections = new Set();
    const matchedIds = new Set();

    // Build distance matrix and match greedily
    const pairs = [];
    for (let i = 0; i < existingObjects.length; i++) {
      for (let j = 0; j < detections.length; j++) {
        const dist = Math.sqrt(
          (existingObjects[i].x - detections[j].x) ** 2 +
          (existingObjects[i].y - detections[j].y) ** 2
        );
        pairs.push({ i, j, dist });
      }
    }
    pairs.sort((a, b) => a.dist - b.dist);

    for (const { i, j, dist } of pairs) {
      if (matchedIds.has(existingIds[i]) || usedDetections.has(j)) continue;
      if (dist > this.matchThreshold) continue;
      // Must be same class
      if (existingObjects[i].classId !== detections[j].classId) continue;

      const id = existingIds[i];
      const obj = this.objects.get(id);
      const det = detections[j];

      // Compute velocity before smoothing
      const vx = det.x - obj.x;
      const vy = det.y - obj.y;

      // EMA smooth position
      obj.x = obj.x + this.smoothAlpha * (det.x - obj.x);
      obj.y = obj.y + this.smoothAlpha * (det.y - obj.y);
      obj.w = obj.w + this.smoothAlpha * (det.w - obj.w);
      obj.h = obj.h + this.smoothAlpha * (det.h - obj.h);
      obj.confidence = det.confidence;
      obj.disappeared = 0;
      obj.frameCount++;
      // Smooth velocity
      obj.velocity.vx = obj.velocity.vx + 0.4 * (vx - obj.velocity.vx);
      obj.velocity.vy = obj.velocity.vy + 0.4 * (vy - obj.velocity.vy);

      matchedIds.add(id);
      usedDetections.add(j);
    }

    // Increment disappeared for unmatched existing objects
    for (const id of existingIds) {
      if (!matchedIds.has(id)) {
        const obj = this.objects.get(id);
        obj.disappeared++;
        if (obj.disappeared > this.maxDisappeared) {
          this.objects.delete(id);
        }
      }
    }

    // Register unmatched detections as new objects
    for (let j = 0; j < detections.length; j++) {
      if (!usedDetections.has(j)) {
        this._register(detections[j]);
      }
    }

    return this._getResult();
  }

  _register(det) {
    const id = this.nextId++;
    this.objects.set(id, {
      trackId: id,
      classId: det.classId,
      className: det.className,
      confidence: det.confidence,
      x: det.x,
      y: det.y,
      w: det.w,
      h: det.h,
      velocity: { vx: 0, vy: 0 },
      firstSeen: Date.now(),
      frameCount: 1,
      disappeared: 0,
    });
  }

  _getResult() {
    return [...this.objects.values()].filter(o => o.disappeared === 0);
  }

  getByClass(className) {
    return this._getResult()
      .filter(o => o.className === className)
      .sort((a, b) => b.confidence - a.confidence);
  }

  reset() {
    this.objects.clear();
    this.nextId = 0;
  }
}

// ─── NMS helpers ───

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

function nms(boxes, scores, classIds, iouThreshold) {
  const indices = Array.from({ length: scores.length }, (_, i) => i);
  indices.sort((a, b) => scores[b] - scores[a]);
  const kept = [];
  const suppressed = new Set();
  for (const i of indices) {
    if (suppressed.has(i)) continue;
    kept.push(i);
    for (const j of indices) {
      if (suppressed.has(j) || j === i) continue;
      // Only suppress same class
      if (classIds[i] !== classIds[j]) continue;
      if (computeIoU(boxes[i], boxes[j]) > iouThreshold) suppressed.add(j);
    }
  }
  return kept;
}

// ─── Hook ───

export function useEquipmentDetection(sport = 'football') {
  const sessionRef = useRef(null);
  const animFrameRef = useRef(null);
  const frameCountRef = useRef(0);
  const canvasRef = useRef(null);
  const trackerRef = useRef(new CentroidTracker());
  const [ready, setReady] = useState(false);
  const equipmentDataRef = useRef([]);
  const [equipmentData, setEquipmentData] = useState([]);
  const sportRef = useRef(sport);

  useEffect(() => { sportRef.current = sport; }, [sport]);

  // Load equipment model
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (runtimeBroken) return;

      try {
        if (!ortModule) {
          ortModule = await import('onnxruntime-web');
          ortModule.env.wasm.numThreads = 1;
          ortModule.env.logLevel = 'error';
        }
      } catch {
        runtimeBroken = true;
        return;
      }
      const ort = ortModule;

      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = INPUT_SIZE;
      canvasRef.current.height = INPUT_SIZE;

      // Check if equipment model exists
      try {
        const probe = await fetch(EQUIPMENT_MODEL_PATH, { method: 'HEAD' });
        if (!probe.ok) {
          console.log('[Equipment] Model not found, falling back to ball-only detection');
          return;
        }
        const contentType = probe.headers.get('content-type') || '';
        if (contentType.includes('text/html')) return;
      } catch {
        return;
      }

      if (cancelled) return;

      try {
        const session = await ort.InferenceSession.create(EQUIPMENT_MODEL_PATH, {
          executionProviders: ['webgl', 'wasm'],
        });

        // Warmup benchmark
        const dummyInput = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE);
        const tensor = new ort.Tensor('float32', dummyInput, [1, 3, INPUT_SIZE, INPUT_SIZE]);
        const inputName = session.inputNames[0];
        const start = performance.now();
        await session.run({ [inputName]: tensor });
        const elapsed = performance.now() - start;

        if (cancelled) { session.release(); return; }

        // If too slow (>40ms), fall back to ball-only model
        if (elapsed > 40) {
          console.warn(`[Equipment] Model too slow (${elapsed.toFixed(0)}ms), falling back`);
          session.release();
          return;
        }

        sessionRef.current = session;
        console.log(`[Equipment] Ready: ${EQUIPMENT_MODEL_PATH} (${elapsed.toFixed(0)}ms, ${CLASS_LABELS.length} classes)`);
        setReady(true);
      } catch {
        // Silent failure
      }
    }

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Preprocess video frame to tensor
  const preprocess = useCallback((videoEl) => {
    const canvas = canvasRef.current;
    if (!canvas || !ortModule) return null;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const { data } = imageData;

    const float32 = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
    const area = INPUT_SIZE * INPUT_SIZE;
    for (let i = 0; i < area; i++) {
      float32[i] = data[i * 4] / 255;
      float32[area + i] = data[i * 4 + 1] / 255;
      float32[2 * area + i] = data[i * 4 + 2] / 255;
    }

    return new ortModule.Tensor('float32', float32, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  }, []);

  // Post-process YOLOv8 output (multi-class)
  const postprocess = useCallback((output) => {
    const data = output.data;
    const dims = output.dims;

    let numDetections, numValues, transposed = false;

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
      return [];
    }

    const numClasses = numValues - 4; // first 4 are x,y,w,h
    const boxes = [];
    const scores = [];
    const classIds = [];

    for (let i = 0; i < numDetections; i++) {
      let x, y, w, h;
      if (transposed) {
        x = data[0 * numDetections + i];
        y = data[1 * numDetections + i];
        w = data[2 * numDetections + i];
        h = data[3 * numDetections + i];
      } else {
        const offset = i * numValues;
        x = data[offset];
        y = data[offset + 1];
        w = data[offset + 2];
        h = data[offset + 3];
      }

      // Find best class
      let bestClassId = 0;
      let bestScore = 0;
      for (let c = 0; c < numClasses; c++) {
        const score = transposed
          ? data[(4 + c) * numDetections + i]
          : data[i * numValues + 4 + c];
        if (score > bestScore) {
          bestScore = score;
          bestClassId = c;
        }
      }

      if (bestScore > CONFIDENCE_THRESHOLD) {
        boxes.push({ x: x / INPUT_SIZE, y: y / INPUT_SIZE, w: w / INPUT_SIZE, h: h / INPUT_SIZE });
        scores.push(bestScore);
        classIds.push(bestClassId);
      }
    }

    if (boxes.length === 0) return [];

    const kept = nms(boxes, scores, classIds, NMS_IOU_THRESHOLD);
    return kept.map(idx => ({
      classId: classIds[idx],
      className: CLASS_LABELS[classIds[idx]] || `class_${classIds[idx]}`,
      confidence: scores[idx],
      x: boxes[idx].x,
      y: boxes[idx].y,
      w: boxes[idx].w,
      h: boxes[idx].h,
    }));
  }, []);

  // Run detection on a single frame
  const detect = useCallback(async (videoEl) => {
    if (!sessionRef.current || !videoEl || videoEl.readyState < 2) return [];

    try {
      const inputTensor = preprocess(videoEl);
      if (!inputTensor) return [];

      const inputName = sessionRef.current.inputNames[0];
      const results = await sessionRef.current.run({ [inputName]: inputTensor });
      const outputName = sessionRef.current.outputNames[0];
      const detections = postprocess(results[outputName]);

      // Update tracker
      const tracked = trackerRef.current.update(detections);
      equipmentDataRef.current = tracked;

      // Throttle React state updates
      if (frameCountRef.current % 8 === 0) {
        setEquipmentData(tracked);
      }

      return tracked;
    } catch {
      return [];
    }
  }, [preprocess, postprocess]);

  // Detection loop: every 8th rAF frame (~7.5fps)
  const startLoop = useCallback((videoEl) => {
    if (!sessionRef.current) return;
    frameCountRef.current = 0;
    trackerRef.current.reset();

    function loop() {
      frameCountRef.current++;
      if (frameCountRef.current % 8 === 0) {
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
    trackerRef.current.reset();
    equipmentDataRef.current = [];
    setEquipmentData([]);
  }, []);

  // Ref-based access (no re-render, for 60fps analysis loop)
  const getEquipmentData = useCallback(() => equipmentDataRef.current, []);

  // Scan-compatible detection: returns { objects: [{ label, confidence, bbox }] }
  // for PhaseAAnalyzer.analyzeObjectDetections()
  const detectForScan = useCallback(async (videoEl) => {
    const tracked = await detect(videoEl);
    return {
      objects: (tracked || []).map(d => ({
        label: d.className,
        confidence: d.confidence,
        bbox: { x: d.x, y: d.y, w: d.w, h: d.h },
      })),
    };
  }, [detect]);

  // Backward-compatible ball data extraction
  const getBallData = useCallback(() => {
    const balls = trackerRef.current.getByClass('ball');
    if (balls.length === 0) return { detected: false };
    const best = balls[0];
    const ballDiameter = BALL_DIAMETERS[sportRef.current] || BALL_DIAMETERS.default;
    const bboxHeightPx = best.h * INPUT_SIZE;
    const distanceEstimate = bboxHeightPx > 5 ? (ballDiameter * FOCAL_LENGTH) / bboxHeightPx : null;
    return {
      detected: true,
      x: best.x,
      y: best.y,
      w: best.w,
      h: best.h,
      confidence: best.confidence,
      distanceEstimate,
    };
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      sessionRef.current?.release();
    };
  }, []);

  return { ready, equipmentData, getEquipmentData, getBallData, detect, detectForScan, startLoop, stopLoop };
}

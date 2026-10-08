import { useRef, useState, useCallback, useEffect } from 'react';

// ─── Configuration ───
const MODEL_PATH = '/models/yolov8s_seg.onnx';
const INPUT_SIZE = 640;
const MASK_SIZE = 160; // prototype mask resolution (model output1)
const CONFIDENCE_THRESHOLD = 0.45;
const NMS_IOU_THRESHOLD = 0.5;
const NUM_CLASSES = 10;
const NUM_MASK_COEFFS = 32;

// Class labels — must match data.yaml order
const CLASS_LABELS = [
  'prosthetic_leg', 'prosthetic_arm', 'crutches',
  'agility_ladder', 'balance_pad', 'dumbbell',
  'kettlebell', 'barbell', 'bench', 'ball',
];

// Semantic grouping for downstream consumers
const CLASS_GROUPS = {
  mobility_aid: ['prosthetic_leg', 'prosthetic_arm', 'crutches'],
  equipment: ['dumbbell', 'kettlebell', 'barbell', 'bench'],
  training_gear: ['agility_ladder', 'balance_pad'],
  ball: ['ball'],
};

// Module-level ONNX state (shared across hook instances)
let runtimeBroken = false;
let ortModule = null;

// ─── NMS ───

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
      if (classIds[i] !== classIds[j]) continue;
      if (computeIoU(boxes[i], boxes[j]) > iouThreshold) suppressed.add(j);
    }
  }
  return kept;
}

// ─── Mask Processing ───

/**
 * Generate a binary segmentation mask for one detection.
 * mask = sigmoid(coefficients @ prototypes) cropped to bounding box.
 *
 * @param {Float32Array} coeffs - 32 mask coefficients for this detection
 * @param {Float32Array} protos - [32, 160, 160] mask prototypes
 * @param {{x,y,w,h}} box - normalized bounding box (0-1 range)
 * @returns {Uint8Array} - MASK_SIZE x MASK_SIZE binary mask (0 or 255)
 */
function generateMask(coeffs, protos, box) {
  const mask = new Float32Array(MASK_SIZE * MASK_SIZE);

  // Matrix multiply: coeffs[32] @ protos[32, 160*160] → mask[160*160]
  const protoArea = MASK_SIZE * MASK_SIZE;
  for (let c = 0; c < NUM_MASK_COEFFS; c++) {
    const coeff = coeffs[c];
    const protoOffset = c * protoArea;
    for (let px = 0; px < protoArea; px++) {
      mask[px] += coeff * protos[protoOffset + px];
    }
  }

  // Sigmoid + crop to bbox + threshold
  const binary = new Uint8Array(MASK_SIZE * MASK_SIZE);
  const x1 = Math.max(0, Math.floor((box.x - box.w / 2) * MASK_SIZE));
  const y1 = Math.max(0, Math.floor((box.y - box.h / 2) * MASK_SIZE));
  const x2 = Math.min(MASK_SIZE, Math.ceil((box.x + box.w / 2) * MASK_SIZE));
  const y2 = Math.min(MASK_SIZE, Math.ceil((box.y + box.h / 2) * MASK_SIZE));

  for (let row = y1; row < y2; row++) {
    for (let col = x1; col < x2; col++) {
      const idx = row * MASK_SIZE + col;
      const sigmoid = 1 / (1 + Math.exp(-mask[idx]));
      if (sigmoid > 0.5) {
        binary[idx] = 255;
      }
    }
  }

  return binary;
}

// ─── Centroid Tracker ───
// Persistent ID tracker for stable object tracking across frames

class CentroidTracker {
  constructor(maxDisappeared = 15, matchThreshold = 0.15) {
    this.nextId = 0;
    this.objects = new Map();
    this.maxDisappeared = maxDisappeared;
    this.matchThreshold = matchThreshold;
    this.smoothAlpha = 0.6;
  }

  update(detections) {
    if (detections.length === 0) {
      for (const [id, obj] of this.objects) {
        obj.disappeared++;
        if (obj.disappeared > this.maxDisappeared) {
          this.objects.delete(id);
        }
      }
      return this._getResult();
    }

    if (this.objects.size === 0) {
      for (const det of detections) this._register(det);
      return this._getResult();
    }

    const existingIds = [...this.objects.keys()];
    const existingObjects = existingIds.map(id => this.objects.get(id));
    const usedDetections = new Set();
    const matchedIds = new Set();

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
      if (existingObjects[i].classId !== detections[j].classId) continue;

      const id = existingIds[i];
      const obj = this.objects.get(id);
      const det = detections[j];

      obj.x = obj.x + this.smoothAlpha * (det.x - obj.x);
      obj.y = obj.y + this.smoothAlpha * (det.y - obj.y);
      obj.w = obj.w + this.smoothAlpha * (det.w - obj.w);
      obj.h = obj.h + this.smoothAlpha * (det.h - obj.h);
      obj.confidence = det.confidence;
      obj.disappeared = 0;
      obj.frameCount++;
      obj.mask = det.mask; // update mask each frame

      matchedIds.add(id);
      usedDetections.add(j);
    }

    for (const id of existingIds) {
      if (!matchedIds.has(id)) {
        const obj = this.objects.get(id);
        obj.disappeared++;
        if (obj.disappeared > this.maxDisappeared) {
          this.objects.delete(id);
        }
      }
    }

    for (let j = 0; j < detections.length; j++) {
      if (!usedDetections.has(j)) this._register(detections[j]);
    }

    return this._getResult();
  }

  _register(det) {
    const id = this.nextId++;
    this.objects.set(id, {
      trackId: id,
      classId: det.classId,
      className: det.className,
      group: det.group,
      confidence: det.confidence,
      x: det.x, y: det.y, w: det.w, h: det.h,
      mask: det.mask,
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

  getByGroup(groupName) {
    const classes = CLASS_GROUPS[groupName] || [];
    return this._getResult()
      .filter(o => classes.includes(o.className))
      .sort((a, b) => b.confidence - a.confidence);
  }

  reset() {
    this.objects.clear();
    this.nextId = 0;
  }
}

// ─── Hook ───

export function useSegmentationModel() {
  const sessionRef = useRef(null);
  const animFrameRef = useRef(null);
  const frameCountRef = useRef(0);
  const canvasRef = useRef(null);
  const trackerRef = useRef(new CentroidTracker());
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const detectionsRef = useRef([]);
  const [detections, setDetections] = useState([]);

  // Load model
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (runtimeBroken) return;
      setLoading(true);

      // Load ONNX Runtime
      try {
        if (!ortModule) {
          ortModule = await import('onnxruntime-web');
          ortModule.env.wasm.numThreads = 1;
          ortModule.env.logLevel = 'error';
        }
      } catch {
        runtimeBroken = true;
        setLoading(false);
        return;
      }

      // Prepare offscreen canvas for preprocessing
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = INPUT_SIZE;
      canvasRef.current.height = INPUT_SIZE;

      // Check model availability
      try {
        const probe = await fetch(MODEL_PATH, { method: 'HEAD' });
        if (!probe.ok) {
          console.warn('[Seg] Model not found at', MODEL_PATH);
          setLoading(false);
          return;
        }
        const ct = probe.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
          console.warn('[Seg] Model path returned HTML (likely 404 fallback)');
          setLoading(false);
          return;
        }
      } catch {
        setLoading(false);
        return;
      }

      if (cancelled) { setLoading(false); return; }

      // Create inference session
      try {
        const session = await ortModule.InferenceSession.create(MODEL_PATH, {
          executionProviders: ['webgl', 'wasm'],
        });

        // Warmup
        const dummy = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE);
        const tensor = new ortModule.Tensor('float32', dummy, [1, 3, INPUT_SIZE, INPUT_SIZE]);
        const inputName = session.inputNames[0];
        const start = performance.now();
        await session.run({ [inputName]: tensor });
        const warmupMs = performance.now() - start;

        if (cancelled) { session.release(); setLoading(false); return; }

        sessionRef.current = session;
        console.log(`[Seg] Ready: ${MODEL_PATH} (warmup ${warmupMs.toFixed(0)}ms, ${NUM_CLASSES} classes, outputs: ${session.outputNames.join(', ')})`);
        setReady(true);
      } catch (err) {
        console.error('[Seg] Failed to load model:', err.message);
      }
      setLoading(false);
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Preprocess: video frame → [1, 3, 640, 640] float32 tensor
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
      float32[i] = data[i * 4] / 255;           // R
      float32[area + i] = data[i * 4 + 1] / 255; // G
      float32[2 * area + i] = data[i * 4 + 2] / 255; // B
    }

    return new ortModule.Tensor('float32', float32, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  }, []);

  // Postprocess: parse detections + segmentation masks
  const postprocess = useCallback((output0, output1) => {
    // output0: [1, 46, 8400] — 4 bbox + 10 classes + 32 mask coefficients
    // output1: [1, 32, 160, 160] — mask prototypes
    const detData = output0.data;
    const detDims = output0.dims;
    const protoData = output1.data;

    const numValues = detDims[1]; // 46
    const numDetections = detDims[2]; // 8400
    const numClasses = numValues - 4 - NUM_MASK_COEFFS; // 10

    if (numClasses !== NUM_CLASSES) {
      console.warn(`[Seg] Unexpected class count: ${numClasses} (expected ${NUM_CLASSES})`);
    }

    const boxes = [];
    const scores = [];
    const classIds = [];
    const maskCoeffs = [];

    // output0 is transposed: [1, 46, 8400] — values × detections
    for (let i = 0; i < numDetections; i++) {
      const x = detData[0 * numDetections + i];
      const y = detData[1 * numDetections + i];
      const w = detData[2 * numDetections + i];
      const h = detData[3 * numDetections + i];

      // Find best class
      let bestClassId = 0;
      let bestScore = 0;
      for (let c = 0; c < numClasses; c++) {
        const score = detData[(4 + c) * numDetections + i];
        if (score > bestScore) {
          bestScore = score;
          bestClassId = c;
        }
      }

      if (bestScore > CONFIDENCE_THRESHOLD) {
        boxes.push({ x: x / INPUT_SIZE, y: y / INPUT_SIZE, w: w / INPUT_SIZE, h: h / INPUT_SIZE });
        scores.push(bestScore);
        classIds.push(bestClassId);

        // Extract 32 mask coefficients
        const coeffs = new Float32Array(NUM_MASK_COEFFS);
        for (let m = 0; m < NUM_MASK_COEFFS; m++) {
          coeffs[m] = detData[(4 + numClasses + m) * numDetections + i];
        }
        maskCoeffs.push(coeffs);
      }
    }

    if (boxes.length === 0) return [];

    // NMS
    const kept = nms(boxes, scores, classIds, NMS_IOU_THRESHOLD);

    // Generate masks for kept detections
    return kept.map(idx => {
      const className = CLASS_LABELS[classIds[idx]] || `class_${classIds[idx]}`;
      const group = Object.entries(CLASS_GROUPS).find(([, classes]) =>
        classes.includes(className)
      )?.[0] || 'unknown';

      return {
        classId: classIds[idx],
        className,
        group,
        confidence: scores[idx],
        x: boxes[idx].x,
        y: boxes[idx].y,
        w: boxes[idx].w,
        h: boxes[idx].h,
        mask: generateMask(maskCoeffs[idx], protoData, boxes[idx]),
      };
    });
  }, []);

  // Single-frame detection
  const detect = useCallback(async (videoEl) => {
    if (!sessionRef.current || !videoEl || videoEl.readyState < 2) return [];

    try {
      const inputTensor = preprocess(videoEl);
      if (!inputTensor) return [];

      const inputName = sessionRef.current.inputNames[0];
      const results = await sessionRef.current.run({ [inputName]: inputTensor });

      // YOLOv8-seg outputs: output0 (detections) and output1 (mask prototypes)
      const outputNames = sessionRef.current.outputNames;
      const output0 = results[outputNames[0]];
      const output1 = results[outputNames[1]];

      const dets = postprocess(output0, output1);
      const tracked = trackerRef.current.update(dets);
      detectionsRef.current = tracked;

      // Throttle state updates (every 8 frames)
      if (frameCountRef.current % 8 === 0) {
        setDetections(tracked);
      }

      return tracked;
    } catch (err) {
      console.error('[Seg] Detection error:', err.message);
      return [];
    }
  }, [preprocess, postprocess]);

  // Detection loop: every 6th rAF frame (~10fps)
  const startLoop = useCallback((videoEl) => {
    if (!sessionRef.current) return;
    frameCountRef.current = 0;
    trackerRef.current.reset();

    function loop() {
      frameCountRef.current++;
      if (frameCountRef.current % 6 === 0) {
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
    detectionsRef.current = [];
    setDetections([]);
  }, []);

  // Ref-based access (no re-render, for realtime loops)
  const getDetections = useCallback(() => detectionsRef.current, []);

  // Query helpers
  const getByClass = useCallback((className) => {
    return trackerRef.current.getByClass(className);
  }, []);

  const getByGroup = useCallback((groupName) => {
    return trackerRef.current.getByGroup(groupName);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      sessionRef.current?.release();
    };
  }, []);

  return {
    ready,
    loading,
    detections,
    getDetections,
    getByClass,
    getByGroup,
    detect,
    startLoop,
    stopLoop,
    CLASS_LABELS,
    CLASS_GROUPS,
    MASK_SIZE,
  };
}

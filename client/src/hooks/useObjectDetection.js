import { useRef, useState, useCallback, useEffect } from 'react';
import { ObjectDetector, FilesetResolver } from '@mediapipe/tasks-vision';

// COCO labels we care about for training equipment
const EQUIPMENT_LABELS = ['chair', 'bottle', 'cup', 'sports ball'];

// Full COCO scan classifications for environment analysis
const COCO_CLASSIFICATIONS = {
  equipment: ['chair', 'couch', 'bench', 'sports ball', 'bottle', 'cup', 'backpack'],
  hazard: ['knife', 'scissors', 'vase', 'potted plant', 'dining table', 'tv', 'laptop', 'cell phone'],
  furniture: ['bed', 'dining table', 'couch', 'chair', 'bench'],
};

export function classifyDetectedObjects(detections) {
  const equipment = [];
  const hazards = [];
  const other = [];

  for (const d of detections) {
    if (COCO_CLASSIFICATIONS.equipment.includes(d.label)) equipment.push(d);
    else if (COCO_CLASSIFICATIONS.hazard.includes(d.label)) hazards.push(d);
    else other.push(d);
  }
  return { equipment, hazards, other };
}

export function useObjectDetection() {
  const detectorRef = useRef(null);
  const animFrameRef = useRef(null);
  const frameCountRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [detectedObjects, setDetectedObjects] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        if (cancelled) return;
        const detector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          maxResults: 10, // Increased for environment scan
          scoreThreshold: 0.35
        });
        if (cancelled) return;
        detectorRef.current = detector;
        setReady(true);
      } catch (err) {
        console.warn('ObjectDetector init failed:', err);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  const detect = useCallback((videoEl) => {
    if (!detectorRef.current || !videoEl || videoEl.readyState < 2) return [];

    const result = detectorRef.current.detectForVideo(videoEl, performance.now());
    const filtered = (result.detections || [])
      .filter(d => d.categories?.some(c => EQUIPMENT_LABELS.includes(c.categoryName)))
      .map(d => ({
        label: d.categories[0].categoryName,
        score: d.categories[0].score,
        bbox: d.boundingBox
      }));

    setDetectedObjects(filtered);
    return filtered;
  }, []);

  // Full COCO scan — returns ALL detections, not just equipment
  const scanEnvironment = useCallback((videoEl) => {
    if (!detectorRef.current || !videoEl || videoEl.readyState < 2) return [];

    const result = detectorRef.current.detectForVideo(videoEl, performance.now());
    return (result.detections || [])
      .map(d => ({
        label: d.categories[0].categoryName,
        score: d.categories[0].score,
        bbox: d.boundingBox
      }))
      .filter(d => d.score > 0.3);
  }, []);

  // Capture a video frame as base64 JPEG for Claude Vision
  const captureFrame = useCallback((videoEl) => {
    if (!videoEl || videoEl.readyState < 2) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(videoEl.videoWidth, 640); // Cap at 640px to save bandwidth
    canvas.height = Math.min(videoEl.videoHeight, 480);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7); // 70% quality JPEG
  }, []);

  const startLoop = useCallback((videoEl) => {
    frameCountRef.current = 0;
    function loop() {
      frameCountRef.current++;
      // Only detect every 5 frames (~12fps) to save GPU
      if (frameCountRef.current % 5 === 0) {
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
    setDetectedObjects([]);
  }, []);

  const hasEquipment = useCallback((type) => {
    if (!type) return detectedObjects.length > 0;
    return detectedObjects.some(d => d.label === type);
  }, [detectedObjects]);

  return { ready, detectedObjects, detect, startLoop, stopLoop, hasEquipment, scanEnvironment, captureFrame };
}

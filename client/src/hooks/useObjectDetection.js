import { useRef, useState, useCallback, useEffect } from 'react';
import { ObjectDetector, FilesetResolver } from '@mediapipe/tasks-vision';

// COCO labels we care about for training equipment
const EQUIPMENT_LABELS = ['chair', 'bottle', 'cup', 'sports ball'];

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
          maxResults: 5,
          scoreThreshold: 0.4
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

  return { ready, detectedObjects, detect, startLoop, stopLoop, hasEquipment };
}

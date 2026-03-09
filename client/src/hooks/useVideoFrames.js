import { useState, useRef, useCallback } from 'react';

const FRAME_INTERVAL = 2; // seconds between frames
const BATCH_SIZE = 10;
const CANVAS_WIDTH = 640;
const JPEG_QUALITY = 0.7;

export function useVideoFrames() {
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const abortRef = useRef(false);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  const extractBatch = useCallback((file, batchIndex) => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      video.onloadedmetadata = () => {
        const dur = video.duration;
        const total = Math.floor(dur / FRAME_INTERVAL);
        setDuration(dur);
        setTotalFrames(total);

        const startFrame = batchIndex * BATCH_SIZE;
        const endFrame = Math.min(startFrame + BATCH_SIZE, total);

        if (startFrame >= total) {
          resolve({ frames: [], done: true });
          return;
        }

        const frames = [];
        let currentFrame = startFrame;

        // Scale canvas
        const scale = CANVAS_WIDTH / video.videoWidth;
        canvas.width = CANVAS_WIDTH;
        canvas.height = Math.round(video.videoHeight * scale);

        function seekNext() {
          if (abortRef.current) {
            resolve({ frames, done: true, aborted: true });
            return;
          }
          if (currentFrame >= endFrame) {
            resolve({ frames, done: endFrame >= total });
            return;
          }

          const timestamp = currentFrame * FRAME_INTERVAL;
          video.currentTime = timestamp;
        }

        video.onseeked = () => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          // Strip the data:image/jpeg;base64, prefix
          const base64 = dataUrl.split(',')[1];
          const timestamp = currentFrame * FRAME_INTERVAL;

          frames.push({ data: base64, timestamp });

          const overallProgress = ((batchIndex * BATCH_SIZE + frames.length) / Math.max(1, Math.floor(video.duration / FRAME_INTERVAL))) * 100;
          setProgress(Math.min(100, overallProgress));

          currentFrame++;
          seekNext();
        };

        seekNext();
      };

      video.onerror = () => {
        reject(new Error('Failed to load video. Format may not be supported.'));
      };

      video.src = URL.createObjectURL(file);
    });
  }, []);

  const getTotalBatches = useCallback((file) => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const dur = video.duration;
        const total = Math.floor(dur / FRAME_INTERVAL);
        const batches = Math.ceil(total / BATCH_SIZE);
        setDuration(dur);
        setTotalFrames(total);
        URL.revokeObjectURL(video.src);
        resolve({ totalBatches: batches, duration: dur, totalFrames: total });
      };
      video.onerror = () => reject(new Error('Failed to load video'));
      video.src = URL.createObjectURL(file);
    });
  }, []);

  const reset = useCallback(() => {
    setProgress(0);
    setDuration(0);
    setTotalFrames(0);
    setExtracting(false);
    abortRef.current = false;
  }, []);

  return {
    extractBatch,
    getTotalBatches,
    progress,
    duration,
    totalFrames,
    extracting,
    setExtracting,
    abort,
    reset,
  };
}

// GhostOverlay — full-size, semi-transparent Ghost on the trainee's body (warm-up).
//
// Opt-in and isolated (FEATURES.GHOST_OVERLAY): its own canvas over the camera view,
// mirrored and `object-fit: cover`-mapped exactly like the video, so the Ghost stands
// where the trainee stands and scales with their distance from the camera.
// SAFETY: any runtime error stops this component and calls onError → the parent falls
// back to the stable Ghost demo panel (checkpoint-stage2-stable behaviour).

import { useEffect, useRef } from 'react';
import { drawGhostOverlay } from '../engine/warmupGhost';
import { bodyAnchor, overlayPlacement } from '../engine/ghostOverlay';

export default function GhostOverlay({ spec, limbProfile, landmarksRef, videoRef, onError }) {
  const canvasRef = useRef(null);
  const anchorRef = useRef(null);

  useEffect(() => {
    let raf;
    let stopped = false;
    const draw = () => {
      if (stopped) return;
      try {
        const c = canvasRef.current;
        const v = videoRef?.current;
        if (c && v && v.videoWidth) {
          const dpr = window.devicePixelRatio || 1;
          const w = Math.round(c.clientWidth * dpr);
          const h = Math.round(c.clientHeight * dpr);
          if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
          const ctx = c.getContext('2d');
          ctx.clearRect(0, 0, w, h);
          anchorRef.current = bodyAnchor(landmarksRef?.current, anchorRef.current);
          if (anchorRef.current) {
            const { origin, scale } = overlayPlacement(anchorRef.current, v.videoWidth, v.videoHeight, w, h);
            drawGhostOverlay(ctx, spec, limbProfile, performance.now(), origin, scale);
          }
        }
      } catch (err) {
        stopped = true;
        console.error('[GhostOverlay] disabled after a runtime error — falling back to the demo panel:', err);
        onError?.(err);
        return;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [spec, limbProfile, landmarksRef, videoRef, onError]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-[2]"
      style={{ transform: 'scaleX(-1)' }}
    />
  );
}

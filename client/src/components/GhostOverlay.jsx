// GhostOverlay — full-size, semi-transparent Ghost on the trainee's body (warm-up).
//
// Opt-in and isolated (FEATURES.GHOST_OVERLAY): its own canvas over the camera view,
// mirrored and `object-fit: cover`-mapped exactly like the video, so the Ghost stands
// where the trainee stands and scales with their distance from the camera.
// SAFETY: any runtime error stops this component and calls onError → the parent falls
// back to the stable Ghost demo panel (checkpoint-stage2-stable behaviour).

import { useEffect, useRef } from 'react';
import { drawGhostOverlay } from '../engine/warmupGhost';
import { bodyAnchor, overlayPlacement, defaultPlacement } from '../engine/ghostOverlay';

export default function GhostOverlay({ spec, limbProfile, landmarksRef, videoRef, onError }) {
  const canvasRef = useRef(null);
  const anchorRef = useRef(null);
  // Animation clock that runs backward for a "backward" direction — continuous, no jump on the switch
  const clockRef = useRef({ last: null, ms: 0 });

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
          anchorRef.current = bodyAnchor(landmarksRef?.current, anchorRef.current, 0.25, v.videoWidth / v.videoHeight);
          // On the trainee's body when seen (hips, or estimated from the shoulders when seated);
          // centered at full height before a body has been seen — the big Ghost is always visible
          const { origin, scale } = anchorRef.current
            ? overlayPlacement(anchorRef.current, v.videoWidth, v.videoHeight, w, h)
            : defaultPlacement(w, h);
          const now = performance.now();
          const clk = clockRef.current;
          if (clk.last !== null) clk.ms += (now - clk.last) * (spec?.direction === 'backward' ? -1 : 1);
          clk.last = now;
          drawGhostOverlay(ctx, spec, limbProfile, clk.ms, origin, scale);
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

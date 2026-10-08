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
  const lastAnchorAt = useRef(null);
  const shownAtRef = useRef(null);       // fade-in start (the Ghost appears softly, at once)
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
        if (c) {
          const dpr = window.devicePixelRatio || 1;
          const w = Math.round(c.clientWidth * dpr);
          const h = Math.round(c.clientHeight * dpr);
          if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
          const ctx = c.getContext('2d');
          ctx.clearRect(0, 0, w, h);
          // time-based smoothing with a noise dead-band: the Ghost glides with the body, never trembles
          const tNow = performance.now();
          const dt = lastAnchorAt.current === null ? null : tNow - lastAnchorAt.current;
          lastAnchorAt.current = tNow;
          // Drawn from the very first frame: centered at full height until the camera / a body is
          // there, then on the trainee's body
          const camReady = !!(v && v.videoWidth && v.videoHeight);
          if (camReady) anchorRef.current = bodyAnchor(landmarksRef?.current, anchorRef.current, 0.25, v.videoWidth / v.videoHeight, dt);
          const { origin, scale, feetY = null } = camReady && anchorRef.current
            ? overlayPlacement(anchorRef.current, v.videoWidth, v.videoHeight, w, h)
            : defaultPlacement(w, h);
          if (shownAtRef.current === null) shownAtRef.current = tNow;
          const fade = Math.min(1, (tNow - shownAtRef.current) / 250);
          const now = performance.now();
          const clk = clockRef.current;
          if (clk.last !== null) clk.ms += (now - clk.last) * (spec?.direction === 'backward' ? -1 : 1);
          clk.last = now;
          drawGhostOverlay(ctx, spec, limbProfile, clk.ms, origin, scale, 0.55 * fade, feetY);
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

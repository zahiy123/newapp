// GhostOverlay — the big Ghost, drawn on the trainee's body inside the camera view.
//
// Its own canvas exactly over the camera view (same box, mirrored like the video). The mapping is the
// one the video uses (`object-fit: contain`, engine/ghostOverlay.js), so the Ghost stands where the
// trainee stands and has the trainee's size. Drawn from the very first frame (centered in the picture
// until a body is seen), fading in over 0.25 s.
// SAFETY: a runtime error stops only this component; the parent shows the small Ghost instead.
// Debug: `?ghostdebug=1` shows the anchor numbers (for a field report screenshot).

import { useEffect, useRef, useState } from 'react';
import { drawGhostOverlay } from '../engine/warmupGhost';
import { bodyAnchor, overlayPlacement, defaultPlacement } from '../engine/ghostOverlay';

const OVERLAY_ALPHA = 0.9;          // the outline's opacity; the body fill is lighter (a see-through model)
const FADE_IN_MS = 250;
const MAX_DPR = 1.5;               // a full-view canvas at 3× density is ~9× the work — 1.5× is sharp enough

const debugOn = () => {
  try { return typeof window !== 'undefined' && (window.__GHOST_DEBUG || new URLSearchParams(window.location.search).get('ghostdebug') === '1'); } catch { return false; }
};

export default function GhostOverlay({ spec, limbProfile, landmarksRef, videoRef, onError }) {
  const canvasRef = useRef(null);
  const anchorRef = useRef(null);
  const lastAnchorAtRef = useRef(null);
  const shownAtRef = useRef(null);
  // animation clock (runs backward for a "backward" direction — continuous, no jump on the switch)
  const clockRef = useRef({ last: null, ms: 0 });
  const [debug] = useState(debugOn);
  const debugRef = useRef(null);

  useEffect(() => {
    let raf;
    let stopped = false;
    let lastDebugAt = 0;
    const draw = () => {
      if (stopped) return;
      try {
        const c = canvasRef.current;
        if (c) {
          const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
          const w = Math.round(c.clientWidth * dpr);
          const h = Math.round(c.clientHeight * dpr);
          if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
          const ctx = c.getContext('2d');
          ctx.clearRect(0, 0, w, h);

          const now = performance.now();
          const v = videoRef?.current;
          const vw = v?.videoWidth || 0, vh = v?.videoHeight || 0;
          // the body anchor (time-based smoothing), once the camera picture exists
          if (vw && vh) {
            const dt = lastAnchorAtRef.current === null ? null : now - lastAnchorAtRef.current;
            anchorRef.current = bodyAnchor(landmarksRef?.current, anchorRef.current, 0.25, vw / vh, dt);
          }
          lastAnchorAtRef.current = now;
          const place = vw && vh && anchorRef.current
            ? overlayPlacement(anchorRef.current, vw, vh, w, h)
            : defaultPlacement(w, h, vw || null, vh || null);

          if (shownAtRef.current === null) shownAtRef.current = now;
          const fade = Math.min(1, (now - shownAtRef.current) / FADE_IN_MS);
          const clk = clockRef.current;
          if (clk.last !== null) clk.ms += (now - clk.last) * (spec?.direction === 'backward' ? -1 : 1);
          clk.last = now;
          drawGhostOverlay(ctx, spec, limbProfile, clk.ms, place.origin, place.scale, OVERLAY_ALPHA * fade, place.feetY, place.body);

          if (debug && debugRef.current && now - lastDebugAt > 400) {
            lastDebugAt = now;
            const a = anchorRef.current;
            debugRef.current.textContent = `video ${vw}×${vh} · view ${w}×${h} · ` + (a
              ? `hip ${a.hipX.toFixed(2)},${a.hipY.toFixed(2)} torso ${a.torso.toFixed(3)} feet ${a.footY?.toFixed(2)}${a.footReal ? '✓' : '~'} · scale ${place.scale.toFixed(0)} feetY ${place.feetY?.toFixed(0)}`
              : 'no body yet');
          }
          if (window.__GHOST_DEBUG) window.__ghostDebug = { lm: landmarksRef?.current, anchor: anchorRef.current, ...place, w, h, vw, vh };
        }
      } catch (err) {
        stopped = true;
        console.error('[GhostOverlay] stopped after a runtime error — showing the small Ghost:', err);
        onError?.(err);
        return;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [spec, limbProfile, landmarksRef, videoRef, onError, debug]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-[2]"
        style={{ transform: 'scaleX(-1)' }}
      />
      {debug && (
        <div ref={debugRef} dir="ltr" className="absolute bottom-1 left-1 right-1 z-[40] pointer-events-none text-[10px] font-mono text-yellow-300 bg-black/70 rounded px-1" />
      )}
    </>
  );
}

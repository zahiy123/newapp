// WarmupGhostPanel — the warm-up demo figure (Stage 2.3 Ghost) in its OWN canvas.
//
// It used to be drawn into the pose canvas, which is CSS-stretched to the screen (a 4:3 camera
// frame squeezed into a portrait phone made the figure thin), is drawn only while a body is
// detected, and sat under the warm-up feedback banner. A dedicated, fixed-size, high-DPI canvas
// in a free spot of the screen always shows the full silhouette.

import { useEffect, useRef } from 'react';
import { drawWarmupGhost } from '../engine/warmupGhost';

export default function WarmupGhostPanel({ spec, limbProfile, isHe }) {
  const canvasRef = useRef(null);
  // Animation clock that runs backward for a "backward" direction — continuous, no jump on the switch
  const clockRef = useRef({ last: null, ms: 0 });

  useEffect(() => {
    let raf;
    const draw = () => {
      const c = canvasRef.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(c.clientWidth * dpr);
        const h = Math.round(c.clientHeight * dpr);
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        const now = performance.now();
        const clk = clockRef.current;
        if (clk.last !== null) clk.ms += (now - clk.last) * (spec?.direction === 'backward' ? -1 : 1);
        clk.last = now;
        drawWarmupGhost(ctx, spec, limbProfile, clk.ms, w, h, { fill: true });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [spec, limbProfile]);

  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-[15] pointer-events-none flex flex-col items-center gap-1">
      {/* Mirrored like the camera view, so the figure moves like the trainee's reflection */}
      <canvas ref={canvasRef} className="w-28 h-40 sm:w-36 sm:h-52 rounded-2xl shadow-xl" style={{ transform: 'scaleX(-1)' }} />
      <div className="text-[11px] font-semibold text-white bg-black/55 rounded-full px-2 py-0.5">
        {isHe ? 'הדגמה' : 'Demo'}
      </div>
    </div>
  );
}

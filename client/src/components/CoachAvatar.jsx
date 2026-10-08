// CoachAvatar — the chosen virtual coach (male / female) at the side of the screen.
// It demonstrates the current movement together with the Ghost, stands and talks between
// demonstrations (mouth + nod while its voice speaks) and claps after a finished set.
// SAFETY: a runtime error hides only the coach (the training continues unchanged).

import { useEffect, useRef, useState } from 'react';
import { drawCoach, COACH_INFO } from '../engine/coachAvatar';

export default function CoachAvatar({ coach, mode, spec, limbProfile, isHe, isSpeaking, bubble = null }) {
  const canvasRef = useRef(null);
  const clockRef = useRef({ last: null, ms: 0 });
  const [failed, setFailed] = useState(false);
  const [talking, setTalking] = useState(false);
  const speakingRef = useRef(isSpeaking);
  speakingRef.current = isSpeaking;

  useEffect(() => {
    if (failed) return undefined;
    let raf;
    let lastTalk = false;
    const draw = () => {
      try {
        const c = canvasRef.current;
        if (c) {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          const w = Math.round(c.clientWidth * dpr);
          const h = Math.round(c.clientHeight * dpr);
          if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
          const ctx = c.getContext('2d');
          ctx.clearRect(0, 0, w, h);
          const now = performance.now();
          const clk = clockRef.current;
          if (clk.last !== null) clk.ms += now - clk.last;
          clk.last = now;
          const isTalking = !!speakingRef.current?.();
          if (isTalking !== lastTalk) { lastTalk = isTalking; setTalking(isTalking); }
          const talk = isTalking ? 0.5 + 0.5 * Math.sin(now / 55) * Math.sin(now / 130) : 0;
          drawCoach(ctx, coach, { mode, spec, lp: limbProfile, ms: clk.ms, talk }, w, h);
        }
      } catch (err) {
        console.error('[CoachAvatar] hidden after a runtime error:', err);
        setFailed(true);
        return;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [coach, mode, spec, limbProfile, failed]);

  if (failed || !COACH_INFO[coach]) return null;
  const info = COACH_INFO[coach];
  return (
    <div className="absolute right-2 top-1/2 -translate-y-1/2 z-[14] pointer-events-none flex flex-col items-center gap-1">
      {talking && bubble && (
        <div className="absolute right-full mr-2 top-4 w-max max-w-[42vw] sm:max-w-[260px] bg-white/95 text-gray-800 text-xs font-semibold rounded-2xl rounded-tr-sm px-3 py-2 shadow-lg line-clamp-3"
          dir={isHe ? 'rtl' : 'ltr'}>
          {bubble}
        </div>
      )}
      <canvas ref={canvasRef} className="w-28 h-44 sm:w-36 sm:h-56 rounded-2xl shadow-xl" style={{ transform: 'scaleX(-1)' }} />
      <div className={`text-[11px] font-semibold text-white rounded-full px-2 py-0.5 ${coach === 'female' ? 'bg-pink-600/80' : 'bg-blue-700/80'}`}>
        {info.icon} {isHe ? info.label.he : info.label.en}
      </div>
    </div>
  );
}

// CoachAvatar — the chosen virtual coach (male / female) at the side of the screen.
// It demonstrates the current movement together with the Ghost, stands and talks between
// demonstrations (mouth + nod while its voice speaks) and claps after a finished set.
// SAFETY: a runtime error hides only the coach (the training continues unchanged).

import { useEffect, useRef, useState } from 'react';
import { drawCoach, COACH_INFO } from '../engine/coachAvatar';
import { genderizeCoachText } from '../engine/coachVoiceText';

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
          {genderizeCoachText(bubble, coach)}
        </div>
      )}
      <canvas ref={canvasRef} className="w-28 h-44 sm:w-36 sm:h-56 rounded-2xl shadow-xl ring-1 ring-white/40" style={{ transform: 'scaleX(-1)' }} />
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white rounded-full px-2.5 py-0.5 bg-slate-900/85 ring-1 ring-white/15">
        <span className={`w-1.5 h-1.5 rounded-full ${coach === 'female' ? 'bg-rose-400' : 'bg-sky-400'}`} />
        {isHe ? info.label.he : info.label.en}
        {talking && (
          <span className="flex items-end gap-[2px] h-3" aria-label={isHe ? 'מדבר' : 'talking'}>
            {[0, 1, 2, 3].map(i => (
              <span key={i} className={`w-[2px] rounded-full animate-pulse ${coach === 'female' ? 'bg-rose-300' : 'bg-sky-300'}`}
                style={{ height: `${[60, 100, 75, 45][i]}%`, animationDelay: `${i * 120}ms`, animationDuration: '600ms' }} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** A small still preview of a coach (the selection screen). */
export function CoachPreview({ coach, className = 'w-24 h-36' }) {
  const ref = useRef(null);
  useEffect(() => {
    let raf;
    const t0 = performance.now();
    const draw = () => {
      const c = ref.current;
      if (c) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        try { drawCoach(ctx, coach, { mode: 'idle', spec: null, lp: {}, ms: performance.now() - t0, talk: 0 }, w, h); } catch { return; }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [coach]);
  return <canvas ref={ref} className={`${className} rounded-xl`} />;
}

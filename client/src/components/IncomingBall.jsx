// IncomingBall — in kick / pass drills a ball flows to the trainee's kicking foot inside the camera
// view, on the beat. The trainee kicks it in REAL time: a fast move of the kicking foot in the window
// around the arrival is a HIT (the ball flies away, "יפה!"); no kick → it rolls on past (a MISS,
// "פספסת"). The hits / balls score is shown. Same box + mapping as the video (contain, mirrored).
// SAFETY: any runtime error hides only the ball.

import { useEffect, useRef, useState } from 'react';
import { frameTransform } from '../engine/ghostOverlay';
import { ballCycle, ballOnScreen, windowOver, footStrikeSpeed, HIT_SPEED, BALL_TIMING } from '../engine/incomingBall';

const ANKLE = { left: 27, right: 28 };
const seen = (p) => p && (p.visibility ?? 1) >= 0.5 && p.y >= 0 && p.y <= 1;
const SAMPLE_MS = 160;                       // the foot's speed over this recent span

function beep(ctxRef, freq = 880) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctxRef.current) ctxRef.current = new AC();
    const ac = ctxRef.current;
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.16);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.18);
  } catch { /* no audio — the visual cue is enough */ }
}

function drawBall(ctx, ball, spin) {
  ctx.globalAlpha = 0.35 * ball.alpha;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(ball.x, ball.shadowY, ball.r * 0.9, ball.r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = ball.alpha;
  const g = ctx.createRadialGradient(ball.x - ball.r * 0.35, ball.y - ball.r * 0.35, ball.r * 0.1, ball.x, ball.y, ball.r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#cbd5e1');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = Math.max(1, ball.r * 0.06); ctx.strokeStyle = '#0f172a'; ctx.stroke();
  ctx.fillStyle = '#0f172a';
  const penta = (cx, cy, rr, rot) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) { const a = rot + (i * 2 * Math.PI) / 5; const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fill();
  };
  ctx.save(); ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.clip();
  penta(ball.x, ball.y, ball.r * 0.3, spin);
  for (let i = 0; i < 5; i++) { const a = spin + (i * 2 * Math.PI) / 5; penta(ball.x + Math.cos(a) * ball.r * 0.85, ball.y + Math.sin(a) * ball.r * 0.85, ball.r * 0.28, spin + 0.6); }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawText(ctx, text, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);                                  // the canvas is mirrored on screen → un-mirror the text
  ctx.font = `bold ${Math.round(size)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = Math.max(3, size * 0.16);
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export default function IncomingBall({ kind = 'kick', side = 'right', landmarksRef, videoRef, isHe }) {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [score, setScore] = useState({ hits: 0, balls: 0 });

  useEffect(() => {
    if (failed) return undefined;
    let raf;
    const t0 = performance.now();
    let foot = null, start = null, bodyPx = null;          // smoothed screen targets
    const samples = [];                                   // the kicking ankle's recent positions
    const results = new Map();                            // ball n → { outcome, at }
    let lastCueN = -1;
    const draw = () => {
      try {
        const c = canvasRef.current;
        const v = videoRef?.current;
        if (c && v?.videoWidth) {
          const dpr = Math.min(1.5, window.devicePixelRatio || 1);
          const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
          if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
          const ctx = c.getContext('2d');
          ctx.clearRect(0, 0, w, h);
          const now = performance.now();
          const map = frameTransform(v.videoWidth, v.videoHeight, w, h, 'contain');
          const lm = landmarksRef?.current;
          const ank = lm && seen(lm[ANKLE[side]]) ? lm[ANKLE[side]] : null;
          const sh = lm ? [lm[11], lm[12]].filter(seen) : [];
          // the kicking foot NOW (lightly smoothed, so the ball flows to wherever the foot is)
          const footT = ank ? map(ank.x, Math.min(1, ank.y + 0.02)) : { x: map.box.x + map.box.w * (side === 'left' ? 0.58 : 0.42), y: map.box.y + map.box.h * 0.95 };
          const topY = sh.length ? map(0.5, sh.reduce((a, p) => a + p.y, 0) / sh.length).y : map.box.y + map.box.h * 0.3;
          const cx = map.box.x + map.box.w / 2;
          const startT = { x: cx + (cx - footT.x) * 0.9, y: map.box.y + map.box.h * 0.99 };
          const bodyT = Math.max(map.box.h * 0.35, footT.y - topY + map.box.h * 0.12);
          const k = 0.35;
          foot = foot ? { x: foot.x + (footT.x - foot.x) * k, y: foot.y + (footT.y - foot.y) * k } : footT;
          start = start ? { x: start.x + (startT.x - start.x) * 0.1, y: start.y + (startT.y - start.y) * 0.1 } : startT;
          bodyPx = bodyPx ? bodyPx + (bodyT - bodyPx) * 0.1 : bodyT;

          // the kicking foot's speed (body heights per second)
          if (ank) {
            samples.push({ t: now, x: ank.x, y: ank.y });
            while (samples.length && now - samples[0].t > SAMPLE_MS) samples.shift();
          }
          const bodyH = sh.length && ank ? Math.max(0.1, ank.y - sh.reduce((a, p) => a + p.y, 0) / sh.length) : 0.5;
          const speed = footStrikeSpeed(samples, bodyH);

          const cyc = ballCycle(now - t0, kind);
          let res = results.get(cyc.n);
          if (!res) { res = { outcome: null, at: 0 }; results.set(cyc.n, res); results.delete(cyc.n - 3); }
          // a HIT: the kicking foot moves fast inside the window
          if (!res.outcome && cyc.inWindow && speed >= HIT_SPEED) {
            res.outcome = 'hit'; res.at = cyc.sinceArrival;
            beep(audioRef, 1180);
            setScore(s => ({ hits: s.hits + 1, balls: s.balls + 1 }));
          } else if (!res.outcome && windowOver(cyc, kind)) {
            res.outcome = 'miss';
            setScore(s => ({ ...s, balls: s.balls + 1 }));
          }
          const ball = ballOnScreen(cyc, foot, start, bodyPx, res.outcome, kind, res.at);
          if (ball) drawBall(ctx, ball, cyc.u * 9 + Math.max(0, cyc.sinceArrival) / 80);

          // the cue: "בעט!" / "מסור!" as it arrives (+ a beep), then the result
          const size = bodyPx * 0.07;
          if (cyc.inWindow && !res.outcome) {
            if (cyc.n !== lastCueN) { lastCueN = cyc.n; beep(audioRef, 880); }
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
            ctx.lineWidth = Math.max(3, bodyPx * 0.012);
            ctx.beginPath(); ctx.arc(foot.x, foot.y - bodyPx * 0.07, bodyPx * 0.12, 0, Math.PI * 2); ctx.stroke();
            drawText(ctx, kind === 'pass' ? (isHe ? 'מסור!' : 'Pass!') : (isHe ? 'בעט!' : 'Kick!'), foot.x, foot.y - bodyPx * 0.22, size, '#facc15');
          } else if (res.outcome === 'hit' && cyc.sinceArrival - res.at < BALL_TIMING[kind].outMs) {
            drawText(ctx, isHe ? 'יפה!' : 'Nice!', foot.x, foot.y - bodyPx * 0.22, size, '#4ade80');
          } else if (res.outcome === 'miss' && cyc.phase === 'after') {
            drawText(ctx, isHe ? 'פספסת — תזמן לפי הכדור' : 'Missed — time it with the ball', foot.x, foot.y - bodyPx * 0.22, size * 0.8, '#f87171');
          }
        }
      } catch (err) {
        console.error('[IncomingBall] hidden after a runtime error:', err);
        setFailed(true);
        return;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [kind, side, landmarksRef, videoRef, isHe, failed]);

  if (failed) return null;
  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-[3]" style={{ transform: 'scaleX(-1)' }} />
      {score.balls > 0 && (
        <div className="absolute bottom-14 left-2 z-[18] pointer-events-none rounded-full bg-black/65 text-white text-xs font-bold px-2.5 py-1" dir={isHe ? 'rtl' : 'ltr'}>
          {'⚽'} {isHe ? `פגיעות בכדור: ${score.hits}/${score.balls}` : `Ball hits: ${score.hits}/${score.balls}`}
        </div>
      )}
    </>
  );
}

// IncomingBall — in kick / pass drills a ball rolls toward the trainee's kicking foot inside the
// camera view and arrives on the beat ("בעט!" / "מסור!" + a short beep): the timing of every strike.
// Same box + mapping as the video (contain, mirrored), so the ball comes to the REAL foot.
// SAFETY: any runtime error hides only the ball.

import { useEffect, useRef, useState } from 'react';
import { frameTransform } from '../engine/ghostOverlay';
import { ballCycle, ballOnScreen } from '../engine/incomingBall';

const ANKLE = { left: 27, right: 28 };
const seen = (p) => p && (p.visibility ?? 1) >= 0.5 && p.y >= 0 && p.y <= 1;

function beep(ctxRef) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctxRef.current) ctxRef.current = new AC();
    const ac = ctxRef.current;
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.16);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.18);
  } catch { /* no audio — the visual cue is enough */ }
}

export default function IncomingBall({ kind = 'kick', side = 'right', landmarksRef, videoRef, isHe }) {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed) return undefined;
    let raf;
    const t0 = performance.now();
    let lastCue = -1;
    let foot = null, far = null, bodyPx = null;           // smoothed screen targets (far = where the ball enters)
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
          const map = frameTransform(v.videoWidth, v.videoHeight, w, h, 'contain');
          const lm = landmarksRef?.current;
          // targets: the kicking ankle (the floor in front of it), the head / shoulder height far away
          const ank = lm && seen(lm[ANKLE[side]]) ? lm[ANKLE[side]] : null;
          const sh = lm && [lm[11], lm[12]].filter(seen);
          const footT = ank ? map(ank.x, Math.min(1, ank.y + 0.02)) : { x: map.box.x + map.box.w * (side === 'left' ? 0.58 : 0.42), y: map.box.y + map.box.h * 0.95 };
          const topY = sh?.length ? map(0.5, sh.reduce((a, p) => a + p.y, 0) / sh.length).y : map.box.y + map.box.h * 0.3;
          // the ball enters near the camera: the bottom of the picture, across from the kicking foot
          const cx = map.box.x + map.box.w / 2;
          const farT = { x: cx + (cx - footT.x) * 0.9, y: map.box.y + map.box.h * 0.99 };
          const bodyT = Math.max(map.box.h * 0.35, footT.y - topY + map.box.h * 0.12);
          const k = 0.15;
          foot = foot ? { x: foot.x + (footT.x - foot.x) * k, y: foot.y + (footT.y - foot.y) * k } : footT;
          far = far ? { x: far.x + (farT.x - far.x) * k, y: far.y + (farT.y - far.y) * k } : farT;
          bodyPx = bodyPx ? bodyPx + (bodyT - bodyPx) * k : bodyT;

          const cyc = ballCycle(performance.now() - t0, kind);
          const ball = ballOnScreen(cyc, foot, far, bodyPx);
          if (ball) {
            // shadow on the floor
            ctx.globalAlpha = 0.35 * ball.alpha;
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.ellipse(ball.x, ball.shadowY, ball.r * 0.9, ball.r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
            // the ball (white with dark panels)
            ctx.globalAlpha = ball.alpha;
            const g = ctx.createRadialGradient(ball.x - ball.r * 0.35, ball.y - ball.r * 0.35, ball.r * 0.1, ball.x, ball.y, ball.r);
            g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#cbd5e1');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
            ctx.lineWidth = Math.max(1, ball.r * 0.06); ctx.strokeStyle = '#0f172a'; ctx.stroke();
            const spin = cyc.u * 9;
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
          // the cue: a ring at the foot + "בעט!" / "מסור!" (+ a beep once per ball)
          if (cyc.phase === 'strike') {
            const p = cyc.sinceArrival / 450;
            ctx.strokeStyle = `rgba(250, 204, 21, ${1 - p})`;
            ctx.lineWidth = Math.max(3, bodyPx * 0.012);
            ctx.beginPath(); ctx.arc(foot.x, foot.y - bodyPx * 0.07, bodyPx * (0.09 + 0.08 * p), 0, Math.PI * 2); ctx.stroke();
            ctx.save();
            ctx.translate(foot.x, foot.y - bodyPx * 0.22);
            ctx.scale(-1, 1);                                  // the canvas is mirrored on screen → un-mirror the text
            ctx.font = `bold ${Math.round(bodyPx * 0.07)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.lineWidth = Math.max(3, bodyPx * 0.012);
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            const text = kind === 'pass' ? (isHe ? 'מסור!' : 'Pass!') : (isHe ? 'בעט!' : 'Kick!');
            ctx.strokeText(text, 0, 0);
            ctx.fillStyle = '#facc15';
            ctx.fillText(text, 0, 0);
            ctx.restore();
            if (cyc.n !== lastCue) { lastCue = cyc.n; beep(audioRef); }
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
    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-[3]" style={{ transform: 'scaleX(-1)' }} />
  );
}

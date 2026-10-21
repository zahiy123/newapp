// VirtualBall — the smart virtual ball for EVERY ball drill, in every sport (engine/virtualBall.js).
// A trainee without a real ball trains every ball drill: the ball appears at their body in the
// camera view and reacts to their live skeleton —
//   incoming     comes to the foot / head / chest / hands, WAITS there, and moves only when the trainee
//                acts on it (kick / pass / head / catch / strike) — "יפה!", a hits / balls score
//   dribble      rolls at the feet, every foot touch pushes it — a touches count
//   juggle       bounces up from the foot on each flick, falls by gravity — touches / drops
//   handDribble  bounces between the hand and the floor — a dribbles count
//   throw        held in the hands, a fast extension releases it — a throws count
// Before the exercise (the run-up) the ball is already there (at the foot / in the hands) — no
// counting. Same box + mapping as the video (contain, mirrored). It writes its position, like a
// detected ball, to `ballOutRef` (the analysis engine reads the ball from there).
// SAFETY: any runtime error hides only the ball.

import { useEffect, useRef, useState } from 'react';
import { frameTransform } from '../engine/ghostOverlay';
import { HIT_SPEED } from '../engine/incomingBall';
import {
  bodyPoints, steadyFloor, targetPoint, pointVelocity, BALL_R, toDetection,
  dribbleInit, dribbleStep, juggleInit, juggleStep, handDribbleInit, handDribbleStep,
  throwInit, throwStep, throwFlight, createIncoming, incomingStep, incomingBallAt, atBall, INCOMING_FLY_MS,
  createKickSide, kickSideStep,
} from '../engine/virtualBall';

const SAMPLE_MS = 160;                       // a body point's speed over this recent span
const LOST_GRACE_MS = 1100;                  // the ball stays with the last skeleton through a detection drop
const FEET_GRACE_MS = 4000;                  // the feet flicker out of detection: the ball stays on the last MEASURED floor this long
const MEET_SPEED = 0.6;                      // a head / chest / hands meeting the ball (slower than a kick)

function beep(ctxRef, freq = 880, len = 0.16) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctxRef.current) ctxRef.current = new AC();
    const ac = ctxRef.current;
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.22, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + len);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + len + 0.02);
  } catch { /* no audio — the visual cue is enough */ }
}

// the ball of the trainee's sport: a football, a basketball (orange, seams) or a tennis ball
function drawBall(ctx, ball, spin, look = 'football') {
  if (look === 'basketball' || look === 'tennis') { drawRoundBall(ctx, ball, spin, look, look); return; }
  if (ball.shadowY != null) {
    ctx.globalAlpha = 0.35 * ball.alpha;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(ball.x, ball.shadowY, ball.r * 0.9, ball.r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
  }
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

function drawRoundBall(ctx, ball, spin, look) {
  if (ball.shadowY != null) {
    ctx.globalAlpha = 0.35 * ball.alpha;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(ball.x, ball.shadowY, ball.r * 0.9, ball.r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = ball.alpha;
  const [c0, c1, seam] = look === 'basketball' ? ['#fdba74', '#c2410c', '#1c1917'] : ['#f7fee7', '#a3e635', '#ffffff'];
  const g = ctx.createRadialGradient(ball.x - ball.r * 0.35, ball.y - ball.r * 0.35, ball.r * 0.1, ball.x, ball.y, ball.r);
  g.addColorStop(0, c0); g.addColorStop(1, c1);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = Math.max(1, ball.r * 0.07); ctx.strokeStyle = look === 'basketball' ? seam : '#3f6212'; ctx.stroke();
  ctx.save(); ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.clip();
  ctx.translate(ball.x, ball.y); ctx.rotate(spin);
  ctx.strokeStyle = seam; ctx.lineWidth = Math.max(1, ball.r * (look === 'basketball' ? 0.07 : 0.1));
  if (look === 'basketball') {
    ctx.beginPath(); ctx.moveTo(-ball.r, 0); ctx.lineTo(ball.r, 0); ctx.moveTo(0, -ball.r); ctx.lineTo(0, ball.r); ctx.stroke();
    ctx.beginPath(); ctx.arc(-ball.r * 1.25, 0, ball.r * 0.95, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(ball.r * 1.25, 0, ball.r * 0.95, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(-ball.r * 0.95, 0, ball.r * 0.75, -1.1, 1.1); ctx.stroke();
    ctx.beginPath(); ctx.arc(ball.r * 0.95, 0, ball.r * 0.75, Math.PI - 1.1, Math.PI + 1.1); ctx.stroke();
  }
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

const scoreText = (mode, s, isHe) => {
  if (mode === 'incoming') return isHe ? `כדורים ששוחקו: ${s.hits}/${s.balls}` : `Balls played: ${s.hits}/${s.balls}`;
  if (mode === 'dribble') return isHe ? `נגיעות בכדור: ${s.touches}` : `Ball touches: ${s.touches}`;
  if (mode === 'juggle') return isHe ? `נגיעות: ${s.touches} · נפילות: ${s.drops}` : `Touches: ${s.touches} · drops: ${s.drops}`;
  if (mode === 'handDribble') return isHe ? `כדרורים: ${s.touches}` : `Dribbles: ${s.touches}`;
  if (mode === 'throw') return isHe ? `זריקות: ${s.touches}` : `Throws: ${s.touches}`;
  return '';
};

/**
 * @param {'incoming'|'dribble'|'juggle'|'handDribble'|'throw'} mode
 * @param {'foot'|'head'|'chest'|'hand'|'hands'|'feet'} target - the incoming ball's body point
 * @param {'kick'|'pass'} kind - the incoming timing
 * @param {'left'|'right'} side - the kicking foot / the dribbling hand
 * @param {boolean} live - the exercise runs (counting, incoming balls on the beat)
 * @param {{ current }} [ballOutRef] - receives the ball like a detection ({ detected, x, y, w, h })
 */
export default function VirtualBall({ mode = 'incoming', target = 'foot', kind = 'kick', side = 'right', look = 'football', landmarksRef, videoRef, isHe, live = true, ballOutRef = null, onBall = null, onKickSide = null, strikeCountRef = null, repShownRef = null, hidden = false, cleanRef = null, praise = true }) {
  const onBallRef = useRef(onBall);
  onBallRef.current = onBall;
  const onKickSideRef = useRef(onKickSide);
  onKickSideRef.current = onKickSide;
  // not positioned right (too close / out of the picture — the coach's positioning card is up): no ball
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [score, setScore] = useState({ hits: 0, balls: 0, touches: 0, drops: 0 });

  useEffect(() => {
    if (failed) return undefined;
    let raf;
    let last = null;
    let anchor = null, start = null, bodyPx = null;        // smoothed screen targets
    const samples = {};                                   // body point → recent [{t,x,y}]
    let lastLm = null;
    let st = null, spin = 0, heldSince = 0, bothAt = -1e9;
    let ground = null, feetAt = -1e9, touchFlashAt = -1e9, hitShownAt = -1e9;
    let ks = createKickSide(side);                         // the kicking leg — detected, the plan's is a guess
    let trackedSide = side;
    let strikesSeen = strikeCountRef?.current ?? 0;      // the expert module's REAL kicks (kinetic, counted)
    let repsSeen = repShownRef?.current ?? 0;              // THE COUNTER ON THE SCREEN — every rep plays a ball
    let owedKicks = 0;                                     // reps counted while no ball was waiting                      // the steady floor line; when the feet were last seen
    const track = (name, p, now) => {
      const a = samples[name] || (samples[name] = []);
      // a lost point → no speed across the gap (a jump back is not a fast move)
      if (!p) { a.length = 0; return { vx: 0, vy: 0, speed: 0 }; }
      a.push({ t: now, x: p.x, y: p.y });
      while (a.length && now - a[0].t > SAMPLE_MS) a.shift();
      return pointVelocity(a, bodyPx);
    };
    const out = (ball, map) => { if (ballOutRef) ballOutRef.current = ball ? toDetection(ball, map) : { detected: false }; };
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
          const dt = last == null ? 16 : now - last;
          last = now;
          const map = frameTransform(v.videoWidth, v.videoHeight, w, h, 'contain');
          let lm = landmarksRef?.current;
          if (lm) lastLm = { lm, at: now }; else if (lastLm && now - lastLm.at < LOST_GRACE_MS) lm = lastLm.lm;
          const pts = lm ? bodyPoints(lm, map) : null;
          // no trainee in the picture → no ball (it never floats unrelated to the body)
          if (!pts?.bodyPx || pts.floorY == null) { out(null, map); raf = requestAnimationFrame(draw); return; }
          bodyPx = bodyPx ? bodyPx + (pts.bodyPx - bodyPx) * 0.1 : pts.bodyPx;
          const r = BALL_R * bodyPx * (look === 'tennis' ? 0.5 : look === 'basketball' ? 1.1 : 1);
          // THE FLOOR: under the trainee's real soles, steady (a lifted foot never lifts it). A foot ball
          // is drawn ONLY with the feet really in the picture — never guessed, never floating
          const footMode = mode === 'dribble' || mode === 'juggle' || (mode === 'incoming' && target === 'foot');
          if (pts.floorReal) feetAt = now;
          ground = steadyFloor(ground, pts.floorReal || !footMode ? pts.floorY : null, dt);
          // no ball without the real feet / while the trainee is not positioned (the coach's card says
          // what to fix — no second text over the body)
          if ((footMode && (now - feetAt > FEET_GRACE_MS || ground == null)) || hiddenRef.current) {
            if (window.__GHOST_DEBUG) window.__ballDebug = { mode, live, hidden: hiddenRef.current ? 'not-positioned' : 'no-feet', at: now };
            out(null, map); raf = requestAnimationFrame(draw); return;
          }
          const floorY = Math.min(map.box.y + map.box.h - r * 0.3, ground);
          const size = bodyPx * 0.07;
          const cueAt = (p) => ({ x: p.x, y: Math.max(map.box.y + size * 1.4, p.y - bodyPx * 0.22) });
          let ball = null;

          if (mode === 'incoming') {
            const isFoot = target === 'foot';
            // a foot ball: the leg the trainee REALLY kicks with (a swing of the other leg moves the ball to it)
            let footV = null;
            if (isFoot) {
              footV = { L: track('kfootL', pts.footL, now), R: track('kfootR', pts.footR, now) };
              const kd = kickSideStep(ks, { now, speedL: footV.L.speed, speedR: footV.R.speed });
              ks = kd.ks;
              if (kd.burst) onKickSideRef.current?.(kd.burst);
            }
            const kSide = isFoot ? ks.active : side;
            if (kSide !== trackedSide) { trackedSide = kSide; samples.target = []; }   // no speed across a switch of feet
            const tp = targetPoint(pts, target, kSide);
            // a foot ball meets the foot ON THE FLOOR, just in front of the toe (toward the camera)
            const tT = tp ? { x: tp.x, y: isFoot ? floorY + r * 0.2 : tp.y } : anchor;
            if (!tT) { out(null, map); raf = requestAnimationFrame(draw); return; }
            anchor = anchor ? { x: anchor.x + (tT.x - anchor.x) * 0.35, y: anchor.y + (tT.y - anchor.y) * 0.35 } : tT;
            const cx = map.box.x + map.box.w / 2;
            const sT = isFoot
              ? { x: cx + (cx - tT.x) * 0.9, y: map.box.y + map.box.h * 0.99 }
              : { x: cx + (cx - tT.x) * 0.9, y: Math.min(map.box.y + map.box.h * 0.97, tT.y + bodyPx * 0.3) };
            start = start ? { x: start.x + (sT.x - start.x) * 0.1, y: start.y + (sT.y - start.y) * 0.1 } : sT;
            const tv = track('target', tp, now);
            const word = target === 'head' ? (isHe ? 'נגח!' : 'Head it!') : target === 'chest' ? (isHe ? 'עצור בחזה!' : 'Chest it!')
              : target === 'hands' ? (isHe ? 'תפוס!' : 'Catch!') : target === 'hand' ? (isHe ? 'הכה!' : 'Hit!')
              : kind === 'pass' ? (isHe ? 'מסור!' : 'Pass!') : (isHe ? 'בעט!' : 'Kick!');
            if (!live) {
              // the run-up: the ball rests at the kicking foot / is held in the hands / waits at the feet
              ball = isFoot ? { x: anchor.x, y: anchor.y - r, r, alpha: 1, shadowY: anchor.y }
                : target === 'hand' || target === 'hands' ? { x: anchor.x, y: anchor.y + r * 0.3, r, alpha: 1, shadowY: null }
                : { x: pts.centerX + r * 1.5, y: floorY - r, r, alpha: 1, shadowY: floorY };
              drawBall(ctx, ball, 0, look);
            } else {
              // REAL ball physics (every sport): it comes to the trainee, WAITS in place, and moves only
              // when the trainee acts on it (the body point AT the ball, moving fast) — never on a clock
              if (!st) st = createIncoming(now);
              const rScale = r / (BALL_R * bodyPx);
              const before = incomingBallAt(st, now, anchor, start, bodyPx, { kind, onFloor: isFoot, rScale });
              // contact with EITHER foot (a kick with the "other" leg plays the ball too)
              // with the screen counter linked, IT is the only authority (balls played = reps counted);
              // without it, a body point at the ball and moving fast plays it
              const byCounter = !!repShownRef;
              let contact = !byCounter && st.phase === 'waiting' && atBall(tp, before, target);
              let hitV = tv;
              if (!byCounter && isFoot && st.phase === 'waiting' && footV) {
                // a real foot, or — when the foot is below the picture — the foot from the knee line
                for (const [f, v] of [[pts.footL || pts.footGuessL, footV.L], [pts.footR || pts.footGuessR, footV.R]]) {
                  if (f && atBall(f, before, 'foot') && v.speed >= HIT_SPEED && v.speed >= hitV.speed) { contact = true; hitV = v; }
                }
              }
              // THE SAME KICK THAT COUNTS THE REP plays the ball (field video: reps 3/6 but balls 0/1 —
              // the feet were below the picture, so no foot was "at" the ball)
              // ONE TRUTH (owner, 2026-10-18): EVERY rep counted on the screen plays a ball — the ball never
              // waits while the counter runs on. A rep while the ball still rolls in → it arrives and goes;
              // a rep while a ball flies / between balls → the next ball is played on arrival
              const strikes = strikeCountRef?.current ?? 0;
              if (strikes < strikesSeen) strikesSeen = strikes;           // a new set counts from zero
              const shown = repShownRef?.current ?? 0;
              if (shown < repsSeen) repsSeen = shown;
              let newReps = Math.max(0, shown - repsSeen);
              if (!repShownRef && strikes > strikesSeen) newReps = strikes - strikesSeen;   // (no screen counter given)
              strikesSeen = strikes; repsSeen = shown;
              owedKicks += newReps;
              if (owedKicks > 0 && (st.phase === 'waiting' || st.phase === 'rolling')) {
                owedKicks -= 1;
                if (st.phase === 'rolling') {
                  // it arrives now (counted as an arrival — the score is always played ≤ arrived)
                  st = { ...st, phase: 'waiting', at: now, arrived: st.arrived + 1 };
                  setScore(sc => ({ ...sc, balls: sc.balls + 1 }));
                }
                const v = footV ? (ks.active === 'left' ? footV.L : footV.R) : tv;
                contact = true;
                hitV = { speed: Math.max(isFoot ? HIT_SPEED : MEET_SPEED, v?.speed || 0), vx: v?.vx || 0, vy: v && Math.hypot(v.vx, v.vy) > 0.2 ? v.vy : -1 };
              }
              const step = incomingStep(st, { now, kind, contact, speed: hitV.speed, threshold: isFoot ? HIT_SPEED : MEET_SPEED, moveDir: { x: hitV.vx, y: hitV.vy } });
              st = step.st;
              if (step.event === 'arrived') { beep(audioRef, 880); setScore(s => ({ ...s, balls: s.balls + 1 })); }
              if (step.event === 'hit') {
                beep(audioRef, 1180);
                hitShownAt = now;
                setScore(s => ({ ...s, hits: s.hits + 1 }));
                onBallRef.current?.(true);
              }
              ball = incomingBallAt(st, now, anchor, start, bodyPx, { kind, onFloor: isFoot, rScale });
              if (ball && !isFoot) ball = { ...ball, shadowY: floorY };
              if (ball) drawBall(ctx, ball, st.phase === 'rolling' ? (now - st.at) / 90 : st.phase === 'flying' ? (now - st.at) / 60 : 0, look);
              if (st.phase === 'waiting') {
                // waiting for the trainee: the cue at the ball until they act
                ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
                ctx.lineWidth = Math.max(3, bodyPx * 0.012);
                ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r * 1.7, 0, Math.PI * 2); ctx.stroke();
                const at = cueAt(anchor);
                drawText(ctx, word, at.x, at.y, size, '#facc15');
              } else if (praise && now - hitShownAt < INCOMING_FLY_MS && cleanRef?.current !== false) {
                // "Nice!" only for a pass the coach measured clean (never over "the ankle was not locked")
                const at = cueAt(anchor);
                drawText(ctx, isHe ? 'יפה!' : 'Nice!', at.x, at.y, size, '#4ade80');
              }
            }
          } else if (mode === 'dribble') {
            const vL = track('footL', pts.footL, now), vR = track('footR', pts.footR, now);
            const vBody = track('center', { x: pts.centerX, y: 0 }, now);       // the trainee moving sideways
            if (!st) st = dribbleInit(pts);
            const prevTouches = st.touches;
            st = dribbleStep(st, { ...pts, bodyPx, floorY }, { L: vL, R: vR }, dt, now, { x0: map.box.x, x1: map.box.x + map.box.w }, vBody.vx);
            if (st.touched) touchFlashAt = now;
            if (st.touches > prevTouches) { beep(audioRef, 660, 0.08); if (live) setScore(s => ({ ...s, touches: s.touches + 1 })); }
            spin += (st.vx * dt / 1000) / Math.max(1, r);
            ball = { x: st.x, y: floorY + r * 0.2 - r, r, alpha: 1, shadowY: floorY + r * 0.2 };
            drawBall(ctx, ball, spin, look);
            // the touch is SEEN: a short ring around the ball (the movement reacted to the ball)
            const since = now - touchFlashAt;
            if (since < 260) {
              ctx.strokeStyle = `rgba(74, 222, 128, ${1 - since / 260})`;
              ctx.lineWidth = Math.max(2, r * 0.18);
              ctx.beginPath(); ctx.arc(ball.x, ball.y, r * (1.15 + since / 600), 0, Math.PI * 2); ctx.stroke();
            }
          } else if (mode === 'juggle') {
            const foot = targetPoint(pts, 'foot', side);
            const fv = track('foot', foot, now);
            if (foot) anchor = anchor ? { x: anchor.x + (foot.x - anchor.x) * 0.4, y: anchor.y + (foot.y - anchor.y) * 0.4 } : foot;
            if (!anchor) { out(null, map); raf = requestAnimationFrame(draw); return; }
            if (!st) st = juggleInit();
            const prev = st;
            // how high the kicking foot's SOLE is above the floor (the ball rests on it)
            const sole = side === 'left' ? pts.soleL ?? pts.soleR : pts.soleR ?? pts.soleL;
            st = juggleStep(st, fv.vy, sole == null ? 0 : Math.max(0, (floorY - sole) / bodyPx), dt, now);
            if (st.touched) { beep(audioRef, 760, 0.08); if (live) setScore(s => ({ ...s, touches: s.touches + 1 })); }
            if (st.dropped && live) setScore(s => ({ ...s, drops: s.drops + 1 }));
            if (prev.up || st.up) spin += dt / 120;
            ball = { x: anchor.x, y: floorY - st.h * bodyPx - r, r, alpha: 1, shadowY: floorY };
            drawBall(ctx, ball, spin, look);
          } else if (mode === 'handDribble') {
            const hand = targetPoint(pts, 'hand', side);
            const hv = track('hand', hand, now);
            if (hand) anchor = anchor ? { x: anchor.x + (hand.x - anchor.x) * 0.5, y: anchor.y + (hand.y - anchor.y) * 0.5 } : hand;
            if (!anchor) { out(null, map); raf = requestAnimationFrame(draw); return; }
            if (!st) st = handDribbleInit();
            const top = anchor.y + r, bottom = floorY - r;
            st = handDribbleStep(st, hv.vy, Math.max(0.15, (bottom - top) / bodyPx), dt, now);
            if (st.bounced) { beep(audioRef, 520, 0.06); if (live) setScore(s => ({ ...s, touches: s.touches + 1 })); }
            ball = { x: anchor.x, y: top + st.u * Math.max(0, bottom - top), r, alpha: 1, shadowY: floorY };
            drawBall(ctx, ball, st.u * 6, look);
          } else if (mode === 'throw') {
            // the ball sits at the hands (one seen hand is enough for its place); a THROW is measured
            // only with both hands seen (a one-hand point jumps between the hands — a false throw)
            // one hand lost for a moment (< 0.4 s) → the ball stays put; longer → it follows the one
            // seen hand, smoothed more (no jump between the hands)
            const both = pts.handL && pts.handR;
            if (both) bothAt = now;
            const hands = both || !anchor || now - bothAt > 400 ? pts.hands : null;
            const hv = track('hands', both ? pts.hands : null, now);
            const k = both ? 0.5 : 0.15;
            if (hands) anchor = anchor ? { x: anchor.x + (hands.x - anchor.x) * k, y: anchor.y + (hands.y - anchor.y) * k } : hands;
            if (!anchor) { out(null, map); raf = requestAnimationFrame(draw); return; }
            if (!st) st = throwInit();
            const wasHeld = st.held;
            // released only in the exercise (in the run-up the trainee holds the ball, ready)
            st = throwStep(st, anchor, live ? hv : null, now);
            if (st.released) { beep(audioRef, 980, 0.1); if (live) setScore(s => ({ ...s, touches: s.touches + 1 })); }
            if (st.held && !wasHeld) heldSince = now;
            ball = st.held
              ? { x: anchor.x, y: anchor.y + r * 0.3, r, alpha: Math.min(1, (now - heldSince) / 250 + (heldSince ? 0 : 1)), shadowY: null }
              : throwFlight(st, now, bodyPx);
            if (ball) drawBall(ctx, ball, (now - st.releasedAt) / 90, look);
          }
          out(ball, map);
          if (window.__GHOST_DEBUG) window.__ballDebug = { mode, live, ball, floorY, centerX: pts.centerX, foot: targetPoint(pts, 'foot', side), hand: targetPoint(pts, 'hand', side), hands: pts.hands, head: pts.head, st };
        }
      } catch (err) {
        console.error('[VirtualBall] hidden after a runtime error:', err);
        if (ballOutRef) ballOutRef.current = { detected: false };
        setFailed(true);
        return;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); if (ballOutRef) ballOutRef.current = { detected: false }; };
  }, [mode, target, kind, side, look, landmarksRef, videoRef, isHe, failed, live, ballOutRef, strikeCountRef, repShownRef]);

  if (failed) return null;
  const shown = mode === 'incoming' ? score.balls > 0 : score.touches > 0 || score.drops > 0;
  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-[3]" style={{ transform: 'scaleX(-1)' }} />
      {live && shown && (
        <div className="absolute bottom-14 left-2 z-[18] pointer-events-none rounded-full bg-black/65 text-white text-xs font-bold px-2.5 py-1" dir={isHe ? 'rtl' : 'ltr'}>
          {look === 'basketball' ? '🏀' : look === 'tennis' ? '🎾' : '⚽'} {scoreText(mode, score, isHe)}
        </div>
      )}
    </>
  );
}

// GhostOverlay — the big Ghost, drawn on the trainee's body inside the camera view.
//
// MIRROR → GUIDE: it mirrors the trainee (drawn from the skeleton) until they are in the start
// position, then it performs the exercise on them. Its own canvas exactly over the camera view (same box, mirrored like the video). The mapping is the
// one the video uses (`object-fit: contain`, engine/ghostOverlay.js), so the Ghost stands where the
// trainee stands and has the trainee's size. Drawn from the very first frame (centered in the picture
// until a body is seen), fading in over 0.25 s.
// SAFETY: a runtime error stops only this component; the parent shows the small Ghost instead.
// Debug: `?ghostdebug=1` shows the anchor numbers (for a field report screenshot).

import { useEffect, useRef, useState } from 'react';
import { drawGhostOverlay, drawGhostMirror } from '../engine/warmupGhost';
import { bodyAnchor, overlayPlacement, defaultPlacement, bodyBox, frameTransform } from '../engine/ghostOverlay';

const OVERLAY_ALPHA = 0.9;          // the outline's opacity; the body fill is lighter (a see-through model)
const FADE_IN_MS = 250;
const MODE_FADE_MS = 300;          // a soft switch between the mirror and the guide
const LOST_GRACE_MS = 1100;        // the Ghost stays this long through a detection drop
const GHOST_TORSO_UNITS = 1.4;     // the Ghost's hip center → shoulders, in body units
const GHOST_FULL_HEIGHT_UNITS = 3.9;   // the Ghost's head top → floor, in body units

/** px per Ghost body unit that makes the Ghost's torso equal the trainee's real torso (or null). */
function traineeTorsoScale(lm, map) {
  const ok = (p) => p && Math.min(p.visibility ?? 1, p.presence ?? 1) >= 0.65 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  const ls = lm?.[11], rs = lm?.[12], lh = lm?.[23], rh = lm?.[24];
  if (!map || !ok(ls) || !ok(rs) || !(ok(lh) || ok(rh))) return null;
  const hips = [lh, rh].filter(ok);
  const sh = map((ls.x + rs.x) / 2, (ls.y + rs.y) / 2);
  const hp = map(hips.reduce((a, p) => a + p.x, 0) / hips.length, hips.reduce((a, p) => a + p.y, 0) / hips.length);
  const torsoPx = Math.hypot(sh.x - hp.x, sh.y - hp.y);
  return torsoPx > 10 ? torsoPx / GHOST_TORSO_UNITS : null;
}
const MAX_DPR = 1.5;               // a full-view canvas at 3× density is ~9× the work — 1.5× is sharp enough

const debugOn = () => {
  try { return typeof window !== 'undefined' && (window.__GHOST_DEBUG || new URLSearchParams(window.location.search).get('ghostdebug') === '1'); } catch { return false; }
};

/**
 * @param {() => boolean} [isGuide] - true = the GUIDE (performs the exercise on the trainee);
 *   false = the MIRROR (drawn from the trainee's own skeleton). Default: always the guide.
 */
export default function GhostOverlay({ spec, limbProfile, landmarksRef, videoRef, onError, isGuide = null }) {
  const canvasRef = useRef(null);
  const anchorRef = useRef(null);
  const boxRef = useRef(null);              // the trainee's body box in the picture (floor exercises)
  const scaleRef = useRef(null);            // the guide's smoothed size (px per body unit)
  const heightKRef = useRef(null);          // the trainee's height vs. the torso estimate (kept between readings)
  const lastLmRef = useRef(null);           // the last skeleton (bridges a short detection drop)
  const pinRef = useRef(null);              // the trainee's pelvis x on the screen (the guide is pinned to it)
  const pinVelRef = useRef(0);              // its smoothed speed (adaptive smoothing)
  const hipOffRef = useRef(null);           // hips − shoulders (x), kept for a moment the hips are not seen
  const hipOffYRef = useRef(null);          // hips − shoulders (y), likewise
  const pinYRef = useRef(null);             // the trainee's pelvis height on the screen
  const feetWRef = useRef(1);               // 1 = the Ghost stands on the real feet, 0 = hangs on the pelvis
  const torsoSeenRef = useRef(false);       // the trainee's real torso measured at least once (sizes the guide)
  const lastAnchorAtRef = useRef(null);
  const shownAtRef = useRef(null);
  const modeRef = useRef({ mode: null, since: 0 });   // mirror / guide / none, and since when (fade on a switch)
  // animation clock (runs backward for a "backward" direction — continuous, no jump on the switch)
  const clockRef = useRef({ last: null, ms: 0 });
  const [debug] = useState(debugOn);
  const debugRef = useRef(null);
  // the mode reader for the draw loop (updated after render, not during it)
  const isGuideRef = useRef(isGuide);
  useEffect(() => { isGuideRef.current = isGuide; }, [isGuide]);

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
          const dt = lastAnchorAtRef.current === null ? null : now - lastAnchorAtRef.current;
          if (vw && vh) anchorRef.current = bodyAnchor(landmarksRef?.current, anchorRef.current, 0.25, vw / vh, dt);
          lastAnchorAtRef.current = now;
          const place = vw && vh && anchorRef.current
            ? overlayPlacement(anchorRef.current, vw, vh, w, h)
            : defaultPlacement(w, h, vw || null, vh || null);
          // the displayed picture + the trainee's body box in it: floor exercises are fitted INTO it
          const map = vw && vh ? frameTransform(vw, vh, w, h, 'contain') : null;
          if (map) boxRef.current = bodyBox(landmarksRef?.current, map, boxRef.current, dt);
          place.body = { ...(place.body || {}), box: boxRef.current, frame: map ? map.box : { x: 0, y: 0, w, h } };

          // ---- MIRROR or GUIDE (owner): before the start position the Ghost mirrors the trainee
          // (drawn from the skeleton itself); in the start position it performs the exercise on them.
          // No skeleton → no Ghost (it never floats in the picture unrelated to the body).
          // a skeleton dropped for a moment (a fast kick): keep the last one ~1 s — no blinking
          let lm = landmarksRef?.current;
          if (lm) { lastLmRef.current = { lm, at: now }; } else if (lastLmRef.current && now - lastLmRef.current.at < LOST_GRACE_MS) lm = lastLmRef.current.lm;
          const box = boxRef.current;
          const floorSpec = !!spec?.profile && spec.profile.posture !== 'standing' && spec.profile.posture !== 'seated';
          // lying = the TORSO is horizontal (the anchor's shoulder → hip test, with hysteresis) — never
          // a wide body box alone: a standing trainee with spread arms / a close-up made a wide box and
          // the floor guide lay across the whole screen, huge and flat (field report, 2026-10-14)
          const lyingNow = !!box && !!anchorRef.current?.lying;
          let mode = !lm || !map ? 'none' : (isGuideRef.current ? isGuideRef.current() : true) ? 'guide' : 'mirror';
          if (mode === 'guide' && floorSpec && !lyingNow) mode = 'mirror';     // a floor guide only on a lying body
          // no guide before its size is MEASURED from the trainee's real torso (field video: a huge guide
          // flashed on the very first frame) — the mirror of the skeleton until then
          if (map && traineeTorsoScale(lm, map)) torsoSeenRef.current = true;
          if (mode === 'guide' && !floorSpec && !torsoSeenRef.current) mode = 'mirror';
          if (mode !== modeRef.current.mode) modeRef.current = { mode, since: now };
          if (shownAtRef.current === null) shownAtRef.current = now;
          const fade = Math.min(1, (now - shownAtRef.current) / FADE_IN_MS, (now - modeRef.current.since) / MODE_FADE_MS);
          const clk = clockRef.current;
          if (clk.last !== null) clk.ms += (now - clk.last) * (spec?.direction === 'backward' ? -1 : 1);
          clk.last = now;
          if (mode === 'guide') {
            // the whole trainee: when the head and the feet are both in the picture, the Ghost's height
            // follows the body's real height there (a drifting torso estimate never shrinks it to the legs)
            const nose = lm?.[0], la = lm?.[27], ra = lm?.[28];
            const vis = (p) => p && (p.visibility ?? 1) >= 0.5 && p.y >= 0 && p.y <= 1;
            // (continuous and smoothed: a threshold switch made the size jump)
            // the measured height ratio is KEPT while the nose / an ankle flickers (no switch between estimates)
            if (!floorSpec && vis(nose) && (vis(la) || vis(ra)) && place.feetY != null) {
              const footN = Math.max(vis(la) ? la.y : 0, vis(ra) ? ra.y : 0);
              const bodyPx = (footN - nose.y) * map.scaleY;                    // nose → ankle in the picture
              if (bodyPx > 0) {
                const k = Math.min(1.6, Math.max(0.6, bodyPx / 3.46 / place.scale));
                heightKRef.current = heightKRef.current == null ? k : heightKRef.current + 0.08 * (k - heightKRef.current);
              }
            }
            let target = place.scale * (heightKRef.current ?? 1);
            // ABSOLUTE proportion guard (owner, 2026-10-18 — "the Ghost still shows huge"): the guide's
            // size is locked to the trainee's REAL torso in the picture (shoulders ↔ hips, from the
            // skeleton): 0.85 … 1.2 of it — and its full height never exceeds the picture
            const tScale = traineeTorsoScale(lm, map);
            if (tScale) target = Math.min(Math.max(target, tScale * 0.85), tScale * 1.2);
            target = Math.min(target, map.box.h / GHOST_FULL_HEIGHT_UNITS);
            const sm = scaleRef.current;
            scaleRef.current = sm == null || dt == null ? target : sm + (1 - Math.exp(-Math.min(dt, 100) / 400)) * (target - sm);
            place.scale = scaleRef.current;
            // the pelvis pin: the trainee's hip center NOW (the landmarks are already One-Euro filtered;
            // a 60 ms touch only removes the last pixel jitter) — no lag, no sideways drift
            // hips lost for a moment → the shoulders + the hip offset measured last (never a jump to
            // a different point)
            const lh = lm?.[23], rh = lm?.[24], ls = lm?.[11], rs = lm?.[12];
            const hipN = vis(lh) && vis(rh) ? (lh.x + rh.x) / 2 : null;
            const shN = vis(ls) && vis(rs) ? (ls.x + rs.x) / 2 : null;
            if (hipN != null && shN != null) hipOffRef.current = hipN - shN;
            const pinN = hipN != null ? hipN : shN != null ? shN + (hipOffRef.current ?? 0) : null;
            // the pelvis HEIGHT too (the same hips → shoulders fallback): the Ghost hangs on the real pelvis
            // whenever the feet are not really seen (a guessed floor put the Ghost too low — field video)
            const hipYN = vis(lh) && vis(rh) ? (lh.y + rh.y) / 2 : null;
            const shYN = vis(ls) && vis(rs) ? (ls.y + rs.y) / 2 : null;
            if (hipYN != null && shYN != null) hipOffYRef.current = hipYN - shYN;
            const pinYN = hipYN != null ? hipYN : shYN != null && hipOffYRef.current != null ? shYN + hipOffYRef.current : null;
            if (pinYN != null && pinN != null) {
              const py = map(pinN, pinYN).y;
              pinYRef.current = pinYRef.current == null || dt == null ? py : pinYRef.current + (1 - Math.exp(-Math.max(1, Math.min(dt, 100)) / 70)) * (py - pinYRef.current);
            }
            // the feet weight: 1 = stand on the REAL feet, 0 = hang on the pelvis — eased, never a jump
            const feetReal = !!anchorRef.current?.footReal && place.feetY != null;
            feetWRef.current += (1 - Math.exp(-Math.max(1, Math.min(dt ?? 16, 100)) / 350)) * ((feetReal ? 1 : 0) - feetWRef.current);
            if (pinN != null) {
              // One-Euro smoothing: strong while still (no jitter), light while moving fast (no lag)
              const px = map(pinN, 0.5).x;
              const prev = pinRef.current;
              if (prev == null || dt == null) { pinRef.current = px; pinVelRef.current = 0; }
              else {
                const d = Math.max(1, Math.min(dt, 100));
                const v = (px - prev) / d;                                         // px / ms
                pinVelRef.current += (1 - Math.exp(-d / 80)) * (v - pinVelRef.current);
                const speed = Math.abs(pinVelRef.current) * 1000 / Math.max(1, place.scale);   // body units / s
                const tau = Math.max(25, 140 / (1 + 6 * speed));                  // ms
                pinRef.current = prev + (1 - Math.exp(-d / tau)) * (px - prev);
              }
            }
            if (pinRef.current != null) place.body = { ...place.body, pinX: pinRef.current };
            if (pinYRef.current != null) place.body = { ...place.body, pinY: pinYRef.current, feetW: feetWRef.current };
            drawGhostOverlay(ctx, spec, limbProfile, clk.ms, place.origin, place.scale, OVERLAY_ALPHA * fade, place.feetY, place.body);
          } else if (mode === 'mirror') {
            drawGhostMirror(ctx, lm, map, limbProfile, OVERLAY_ALPHA * fade);
          }
          place.mode = mode;

          if (debug && debugRef.current && now - lastDebugAt > 400) {
            lastDebugAt = now;
            const a = anchorRef.current;
            debugRef.current.textContent = `${place.mode} · video ${vw}×${vh} · view ${w}×${h} · ` + (a
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

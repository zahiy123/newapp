// ============================================================
// ghostOverlay — place the full-size Ghost on the trainee's body (warm-up overlay)
//
// PURE math. The camera <video> uses `object-fit: cover` (cropped to fill the
// view), so normalized MediaPipe coordinates must be mapped through the same
// cover transform to land on the trainee in the displayed video.
// The Ghost is anchored at the trainee's hip center and scaled by their torso
// length, so its size follows the distance from the camera.
// ============================================================

// Ghost body model: shoulders are 1.4 body units above the hip center (warmupGhost.js)
const GHOST_TORSO_UNITS = 1.4;

/**
 * Normalized (0-1) camera coords → displayed element coords for `object-fit: cover`.
 * @returns {(nx: number, ny: number) => { x: number, y: number }} plus .scaleY (px per normalized unit)
 */
export function coverTransform(videoW, videoH, viewW, viewH) {
  const s = Math.max(viewW / videoW, viewH / videoH);
  const dw = videoW * s;
  const dh = videoH * s;
  const ox = (viewW - dw) / 2;
  const oy = (viewH - dh) / 2;
  const map = (nx, ny) => ({ x: ox + nx * dw, y: oy + ny * dh });
  map.scaleY = dh;
  return map;
}

// Ghost shoulders are 0.84 body units wide vs. a 1.4-unit torso
const TORSO_PER_SHOULDER_WIDTH = 1.4 / 0.84;

/**
 * Hip center + torso length from landmarks (normalized), smoothed with the previous anchor.
 * Robust to turning sideways (the Ghost must keep a steady, proportional size):
 *   • the torso is measured shoulder → hip on whichever side is visible (one side is enough);
 *   • the shoulder-width estimate (hips hidden, e.g. seated close) is used ONLY when facing the
 *     camera — side-on, the shoulders overlap and the width says nothing about the body size,
 *     so the previous size is kept;
 *   • the size changes at most ±MAX_SIZE_STEP per update (no sudden shrink / jump).
 * Keeps the previous anchor if the body is lost.
 * @param {number} [aspect=4/3] - video width / height (normalized x and y have different px scales)
 * @returns {{ hipX, hipY, torso } | null}
 */
const MAX_SIZE_STEP = 0.06;          // relative torso change allowed per update
// Steady Ghost (owner: "it jumps and trembles"): with the frame time `dtMs` the smoothing is
// time-based (the same on every screen / frame rate) and tiny landmark noise is ignored
const POS_TAU_MS = 220;              // position follows the body with this time constant
const SIZE_TAU_MS = 650;             // the size changes slower still
const POS_DEADBAND = 0.012;          // hip noise below ~1% of the frame is not followed (soft)
const SIZE_DEADBAND = 0.04;          // relative torso noise below 4% is not followed (soft)
const FOOT_KEEP_UPDATES = 30;        // ~0.5 s of frames
const LEG_PER_TORSO = 1.78 / 1.4;     // Ghost hip→ankle vs. shoulder→hip
const follow = (prev, target, a, band) => {
  const d = target - prev;
  const k = band > 0 ? Math.min(1, Math.abs(d) / band) : 1;   // quadratic below the band → no tremble
  return prev + d * a * k;
};
export function bodyAnchor(landmarks, prev = null, alpha = 0.25, aspect = 4 / 3, dtMs = null) {
  const ok = (p) => p && (p.visibility ?? 1) >= 0.5;
  const ls = landmarks?.[11], rs = landmarks?.[12], lh = landmarks?.[23], rh = landmarks?.[24];
  const shoulders = [ls, rs].filter(ok);
  if (!shoulders.length) return prev;
  const mid = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
  const sh = mid(shoulders);
  // in y-normalized units; with depth (MediaPipe z is in x units) so bending toward the camera
  // does not shrink the Ghost — its size follows the body size / the distance only
  const len = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y, ((a.z ?? 0) - (b.z ?? 0)) * aspect);
  // torso from the best visible same-side pair (works side-on), else from the midpoints
  const sidePairs = [[ls, lh], [rs, rh]].filter(([s, h]) => ok(s) && ok(h)).map(([s, h]) => len(s, h));
  const hips = [lh, rh].filter(ok);
  let hipX, hipY, torso;
  if (sidePairs.length && hips.length) {
    torso = Math.max(...sidePairs);
    const hp = mid(hips);
    hipX = hp.x; hipY = hp.y;
  } else if (ok(ls) && ok(rs)) {
    const width = Math.abs(ls.x - rs.x) * aspect;
    const facing = !prev || width * TORSO_PER_SHOULDER_WIDTH > prev.torso * 0.75;
    torso = facing ? width * TORSO_PER_SHOULDER_WIDTH : prev.torso;
    hipX = sh.x; hipY = sh.y + torso;
  } else {
    if (!prev) return null;
    torso = prev.torso;
    hipX = sh.x; hipY = sh.y + torso;
  }
  if (!(torso > 0.03)) return prev;
  // Feet line (the lower ankle = the standing foot) — only a REAL one: inside the frame and at a
  // plausible leg length below the hips. MediaPipe also "guesses" ankles below the picture when the
  // feet are out of view; a Ghost stood on those was drawn off-screen (it seemed not to load).
  // Otherwise the feet are predicted from the hips + torso, so the feet line always exists and
  // changes smoothly between the two sources.
  const legLen = torso * LEG_PER_TORSO;
  const ankles = [landmarks?.[27], landmarks?.[28]]
    .filter(a => ok(a) && a.y >= 0 && a.y <= 1 && a.y - hipY > legLen * 0.55 && a.y - hipY < legLen * 1.6);
  const footReal = ankles.length ? Math.max(...ankles.map(a => a.y)) : null;
  const footSeen = footReal ?? (hipY + legLen);
  const footMiss = footReal === null ? (prev?.footMiss ?? 0) + 1 : 0;
  // a real feet line flickering out briefly is kept (no jump to the prediction and back)
  const keepFoot = footReal === null && prev?.footY != null && footMiss <= FOOT_KEEP_UPDATES && prev.footReal;
  const footTarget = keepFoot ? prev.footY : footSeen;
  const footIsReal = footReal !== null || keepFoot;
  if (!prev) return { hipX, hipY, torso, footY: footSeen, footMiss, footReal: footIsReal };
  // no sudden shrink / growth (turning, a dropped landmark)
  const bounded = Math.min(prev.torso * (1 + MAX_SIZE_STEP), Math.max(prev.torso * (1 - MAX_SIZE_STEP), torso));
  if (typeof dtMs === 'number' && dtMs > 0) {
    const dt = Math.min(dtMs, 100);
    const aPos = 1 - Math.exp(-dt / POS_TAU_MS);
    const aSize = 1 - Math.exp(-dt / SIZE_TAU_MS);
    return {
      hipX: follow(prev.hipX, hipX, aPos, POS_DEADBAND),
      hipY: follow(prev.hipY, hipY, aPos, POS_DEADBAND),
      torso: follow(prev.torso, bounded, aSize, SIZE_DEADBAND * prev.torso),
      footY: prev.footY == null ? footTarget : follow(prev.footY, footTarget, aPos, POS_DEADBAND),
      footMiss,
      footReal: footIsReal,
    };
  }
  return {
    hipX: prev.hipX + alpha * (hipX - prev.hipX),
    hipY: prev.hipY + alpha * (hipY - prev.hipY),
    torso: prev.torso + alpha * (bounded - prev.torso),
    footY: prev.footY == null ? footTarget : prev.footY + alpha * (footTarget - prev.footY),
    footMiss,
    footReal: footIsReal,
  };
}

/** Placement when no body has been seen yet: centered, full height of the view. */
export function defaultPlacement(viewW, viewH) {
  return { origin: { x: viewW / 2, y: viewH * 0.55 }, scale: viewH / 5.2 };
}

/**
 * Where and how big to draw the Ghost on the overlay canvas.
 * @returns {{ origin: {x,y}, scale: number }} - scale = canvas px per Ghost body unit
 */
export function overlayPlacement(anchor, videoW, videoH, viewW, viewH) {
  const map = coverTransform(videoW, videoH, viewW, viewH);
  // Always clearly visible: never smaller than ~45% of the view height (body ≈ 3.8 units)
  const minScale = viewH / 8.5;
  return {
    origin: map(anchor.hipX, anchor.hipY),
    scale: Math.max(minScale, (anchor.torso * map.scaleY) / GHOST_TORSO_UNITS),
    feetY: typeof anchor.footY === 'number' ? map(anchor.hipX, anchor.footY).y : null,
  };
}

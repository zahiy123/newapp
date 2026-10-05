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
 * If the hips are not visible (seated close to the camera), they are estimated from the
 * shoulders (torso ≈ 1.67 × shoulder width). Keeps the previous anchor if the body is lost.
 * @param {number} [aspect=4/3] - video width / height (normalized x and y have different px scales)
 * @returns {{ hipX, hipY, torso } | null}
 */
export function bodyAnchor(landmarks, prev = null, alpha = 0.25, aspect = 4 / 3) {
  const ok = (p) => p && (p.visibility ?? 1) >= 0.5;
  const ls = landmarks?.[11], rs = landmarks?.[12], lh = landmarks?.[23], rh = landmarks?.[24];
  if (!ok(ls) || !ok(rs)) return prev;
  const shX = (ls.x + rs.x) / 2;
  const shY = (ls.y + rs.y) / 2;
  let hipX, hipY, torso;
  if (ok(lh) && ok(rh)) {
    hipX = (lh.x + rh.x) / 2;
    hipY = (lh.y + rh.y) / 2;
    torso = Math.hypot(shX - hipX, shY - hipY);
  } else {
    const widthInY = Math.abs(ls.x - rs.x) * aspect;      // shoulder width in y-normalized units
    torso = widthInY * TORSO_PER_SHOULDER_WIDTH;
    hipX = shX;
    hipY = shY + torso;
  }
  if (!(torso > 0.03)) return prev;
  if (!prev) return { hipX, hipY, torso };
  return {
    hipX: prev.hipX + alpha * (hipX - prev.hipX),
    hipY: prev.hipY + alpha * (hipY - prev.hipY),
    torso: prev.torso + alpha * (torso - prev.torso),
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
  return {
    origin: map(anchor.hipX, anchor.hipY),
    scale: (anchor.torso * map.scaleY) / GHOST_TORSO_UNITS,
  };
}

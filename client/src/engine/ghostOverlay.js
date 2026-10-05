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

/**
 * Hip center + torso length from landmarks (normalized), smoothed with the previous anchor.
 * @returns {{ hipX, hipY, torso } | null}
 */
export function bodyAnchor(landmarks, prev = null, alpha = 0.25) {
  const ok = (p) => p && (p.visibility ?? 1) >= 0.5;
  const ls = landmarks?.[11], rs = landmarks?.[12], lh = landmarks?.[23], rh = landmarks?.[24];
  if (!ok(ls) || !ok(rs) || !ok(lh) || !ok(rh)) return prev;
  const hipX = (lh.x + rh.x) / 2;
  const hipY = (lh.y + rh.y) / 2;
  const torso = Math.hypot((ls.x + rs.x) / 2 - hipX, (ls.y + rs.y) / 2 - hipY);
  if (torso < 0.03) return prev;
  if (!prev) return { hipX, hipY, torso };
  return {
    hipX: prev.hipX + alpha * (hipX - prev.hipX),
    hipY: prev.hipY + alpha * (hipY - prev.hipY),
    torso: prev.torso + alpha * (torso - prev.torso),
  };
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

// ============================================================
// pitch — the camera ↔ the pitch (Stage 5, Game Mode)
//
// PURE. The referee taps 4 known points of the pitch on the video once (a calibration); a homography then maps
// any point ON THE GROUND (a foot, a crutch tip, the ball's contact point) from the image to pitch metres.
// Amputee football (WAFF Law 1): 60 × 40 m; the goal 5 m wide; the goal area 10 m wide × 8 m deep (the goalkeeper
// must stay inside it); the penalty mark 8 m out. x = along the pitch (0 = the left goal line), y = across (0 = the
// far touch line as filmed).
// ============================================================

export const AMPUTEE_PITCH = { length: 60, width: 40, goalWidth: 5, goalAreaWidth: 10, goalAreaDepth: 8, penaltyMark: 8, centreCircle: 6 };

/** The calibration presets — which 4 pitch points the referee taps (in this order on the screen). */
export function calibrationTargets(preset, P = AMPUTEE_PITCH) {
  const L = P.length; const W = P.width; const h = L / 2;
  switch (preset) {
    case 'leftHalf': return [[0, 0], [h, 0], [h, W], [0, W]];
    case 'rightHalf': return [[h, 0], [L, 0], [L, W], [h, W]];
    default: return [[0, 0], [L, 0], [L, W], [0, W]];        // the whole pitch: the 4 corners
  }
}

// Solve the 8×8 linear system for the homography (DLT with h33 = 1), Gaussian elimination
function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** The homography from 4 image points (any units) to 4 pitch points (metres). Null when degenerate. */
export function homography(imagePts, pitchPts) {
  if (imagePts?.length !== 4 || pitchPts?.length !== 4) return null;
  const A = []; const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = imagePts[i]; const [u, v] = pitchPts[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

/** An image point → pitch metres { x, y } (null when the point is behind the camera's horizon). */
export function toPitch(H, x, y) {
  if (!H || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-9) return null;
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

/** Which goal a team defends: 'left' (x = 0) or 'right' (x = length). The sides swap at half time. */
export const defendedSide = (sides, team) => sides?.[team] || (team === 'A' ? 'left' : 'right');
export const goalLineX = (side, P = AMPUTEE_PITCH) => (side === 'left' ? 0 : P.length);

/** Is a pitch point inside the goal area of `side`? (margin in metres — positive = a little tolerance) */
export function inGoalArea(pt, side, P = AMPUTEE_PITCH, margin = 0) {
  if (!pt) return false;
  const halfW = P.goalAreaWidth / 2 + margin;
  const inY = Math.abs(pt.y - P.width / 2) <= halfW;
  const inX = side === 'left' ? pt.x >= -margin && pt.x <= P.goalAreaDepth + margin : pt.x <= P.length + margin && pt.x >= P.length - P.goalAreaDepth - margin;
  return inX && inY;
}

/** Between the posts (across the pitch)? */
export const betweenPosts = (y, P = AMPUTEE_PITCH) => Math.abs(y - P.width / 2) <= P.goalWidth / 2;

/** Where a ball that left the pitch crossed: 'goal_line_left' | 'goal_line_right' | 'touch_line' | null (inside). */
export function exitOf(pt, P = AMPUTEE_PITCH, margin = 0.3) {
  if (!pt) return null;
  if (pt.x < -margin) return 'goal_line_left';
  if (pt.x > P.length + margin) return 'goal_line_right';
  if (pt.y < -margin || pt.y > P.width + margin) return 'touch_line';
  return null;
}

export const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

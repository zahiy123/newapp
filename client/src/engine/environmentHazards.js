// ============================================================
// environmentHazards — which detected objects are obstacles in the
// trainee's MOVEMENT ZONE (pre-workout environment scan, Stage 2.2)
//
// PURE LOGIC — no React, no DOM.
//
// Inputs are MediaPipe ObjectDetector detections (bounding boxes in
// PIXELS: { originX, originY, width, height }) and MediaPipe Pose
// landmarks (normalized 0-1). Everything is converted to normalized
// frame coordinates before comparing — mixing the two was the bug
// that made every object look "far away".
// ============================================================

// COCO labels that can be in the way (tripping / collision / falling onto)
export const OBSTACLE_LABELS = Object.freeze([
  'chair', 'couch', 'bench', 'dining table', 'bed', 'potted plant', 'toilet',
  'backpack', 'handbag', 'suitcase', 'umbrella',
  'bottle', 'cup', 'wine glass', 'bowl', 'vase',
  'tv', 'laptop', 'bicycle', 'skateboard', 'dog', 'cat',
]);

// Things you can sit on (the "chair you are sitting on" case)
const SEAT_LABELS = new Set(['chair', 'couch', 'bench', 'bed']);

export const LABEL_HE = Object.freeze({
  chair: 'כיסא', couch: 'ספה', bench: 'ספסל', 'dining table': 'שולחן', bed: 'מיטה',
  'potted plant': 'עציץ', toilet: 'אסלה', backpack: 'תיק גב', handbag: 'תיק', suitcase: 'מזוודה',
  umbrella: 'מטריה', bottle: 'בקבוק', cup: 'כוס', 'wine glass': 'כוס זכוכית', bowl: 'קערה',
  vase: 'אגרטל', tv: 'טלוויזיה', laptop: 'מחשב נייד', bicycle: 'אופניים', skateboard: 'סקייטבורד',
  dog: 'כלב', cat: 'חתול',
});

// Minimum number of frames an object must be seen in (filters one-frame false detections)
const MIN_HITS = 2;
const MIN_SCORE = 0.35;
// Movement zone = the person's body box widened by this fraction of body height on each side
// (≈ arm's reach), scaled up for sports that need more clearance.
const ZONE_SIDE_FRACTION = 0.5;
const ZONE_TOP_FRACTION = 0.15;
// An object counts as "in the zone" if at least this fraction of its box overlaps the zone
const MIN_OVERLAP_FRACTION = 0.15;

/** Pixel bbox (MediaPipe) or already-normalized bbox → normalized { x0, y0, x1, y1 }. */
export function normalizeBox(bbox, frameW, frameH) {
  if (!bbox) return null;
  const x = bbox.originX ?? bbox.x ?? bbox.minX;
  const y = bbox.originY ?? bbox.y ?? bbox.minY;
  const w = bbox.width ?? (bbox.maxX != null && x != null ? bbox.maxX - x : null);
  const h = bbox.height ?? (bbox.maxY != null && y != null ? bbox.maxY - y : null);
  if ([x, y, w, h].some(v => typeof v !== 'number' || Number.isNaN(v))) return null;
  // Pixel coordinates if anything exceeds 1.5 (normalized boxes are ≤ 1)
  const isPixels = Math.max(x + w, y + h) > 1.5;
  const sx = isPixels ? (frameW || 1) : 1;
  const sy = isPixels ? (frameH || 1) : 1;
  return { x0: x / sx, y0: y / sy, x1: (x + w) / sx, y1: (y + h) / sy };
}

/** Body box from visible pose landmarks, or null. */
export function personBox(landmarks) {
  if (!landmarks) return null;
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0, n = 0;
  for (const lm of landmarks) {
    if (!lm || (lm.visibility ?? 1) < 0.5) continue;
    x0 = Math.min(x0, lm.x); x1 = Math.max(x1, lm.x);
    y0 = Math.min(y0, lm.y); y1 = Math.max(y1, lm.y);
    n++;
  }
  return n >= 8 ? { x0, y0, x1, y1 } : null;
}

function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Movement zone around the body: arm's reach to the sides, a bit above the head, down to the floor. */
export function movementZone(body, clearanceZone = 1) {
  const height = body.y1 - body.y0;
  const side = height * ZONE_SIDE_FRACTION * Math.max(1, clearanceZone / 2);
  return {
    x0: Math.max(0, body.x0 - side),
    x1: Math.min(1, body.x1 + side),
    y0: Math.max(0, body.y0 - height * ZONE_TOP_FRACTION),
    y1: 1, // the floor under and around the feet
  };
}

/**
 * Find obstacles in the movement zone.
 *
 * @param {Array<{label, score, bbox}>} detections - all detections collected during the scan (many frames)
 * @param {Object[]|null} landmarks - current pose landmarks (normalized)
 * @param {Object} options
 * @param {number} options.frameW / options.frameH - video size in pixels (for pixel bboxes)
 * @param {number} [options.clearanceZone=1] - sport profile clearance (bigger = wider zone)
 * @param {boolean} [options.seatedUser=false] - wheelchair / seated trainee: a seat is not an obstacle
 * @returns {Array<{ label, kind: 'seat'|'obstacle', score, hits }>}
 */
export function findObstacles(detections, landmarks, { frameW, frameH, clearanceZone = 1, seatedUser = false } = {}) {
  // Aggregate per label: number of frames seen + best detection
  const byLabel = new Map();
  for (const d of detections || []) {
    if (!d || !OBSTACLE_LABELS.includes(d.label) || (d.score ?? 0) < MIN_SCORE) continue;
    const box = normalizeBox(d.bbox, frameW, frameH);
    if (!box) continue;
    const entry = byLabel.get(d.label) || { hits: 0, best: null };
    entry.hits++;
    if (!entry.best || d.score > entry.best.score) entry.best = { ...d, box };
    byLabel.set(d.label, entry);
  }

  const body = personBox(landmarks);
  const zone = body ? movementZone(body, clearanceZone) : null;
  const hipY = body && landmarks?.[23] && landmarks?.[24] ? (landmarks[23].y + landmarks[24].y) / 2 : null;
  const hipX = body && landmarks?.[23] && landmarks?.[24] ? (landmarks[23].x + landmarks[24].x) / 2 : null;

  const result = [];
  for (const [label, { hits, best }] of byLabel) {
    if (hits < MIN_HITS) continue;
    const box = best.box;
    const area = Math.max(1e-6, (box.x1 - box.x0) * (box.y1 - box.y0));

    // No person visible → any repeatedly seen obstacle in view is reported (better safe)
    if (!zone) { result.push({ label, kind: 'obstacle', score: best.score, hits }); continue; }

    if (overlapArea(box, zone) / area < MIN_OVERLAP_FRACTION) continue; // outside the movement zone

    // The seat the person is sitting on: it contains the hips
    const isSeat = SEAT_LABELS.has(label) && hipX != null &&
      hipX >= box.x0 && hipX <= box.x1 && hipY >= box.y0 - 0.05 && hipY <= box.y1;
    if (isSeat && seatedUser) continue;
    result.push({ label, kind: isSeat ? 'seat' : 'obstacle', score: best.score, hits });
  }
  return result;
}

/** User-facing warning for an obstacle. */
export function obstacleMessage(obstacle, isHe) {
  const he = LABEL_HE[obstacle.label] || obstacle.label;
  if (obstacle.kind === 'seat') {
    return isHe
      ? `אתה יושב על ${he}. החימום נעשה בעמידה — קום והזז את ה${he} מחוץ לאזור התנועה`
      : `You're sitting on a ${obstacle.label}. The warm-up is done standing — stand up and move it out of your movement area`;
  }
  return isHe
    ? `${he} בתוך אזור התנועה שלך`
    : `${obstacle.label} inside your movement area`;
}

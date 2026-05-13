// === Visual Form Correction: Colored Angle Arcs on Canvas ===
// Draws real-time feedback arcs on joints during exercise.
// Green = good form, Yellow = needs adjustment, Red = poor form.

import { angleCosine } from './motionEngine';

// MediaPipe landmark indices
const LM = {
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
};

// Color based on how close angle is to ideal range
function getArcColor(angle, idealMin, idealMax) {
  if (angle >= idealMin && angle <= idealMax) return '#00FF00'; // green — perfect
  const dist = angle < idealMin ? idealMin - angle : angle - idealMax;
  if (dist <= 15) return '#FFD700'; // yellow — close
  return '#FF4444'; // red — needs correction
}

// Draw an arc at the vertex point (B) of angle A-B-C
function drawAngleArc(ctx, lm, idxA, idxB, idxC, w, h, idealMin, idealMax) {
  const a = lm[idxA], b = lm[idxB], c = lm[idxC];
  if (!a || !b || !c) return;

  const angle = angleCosine(a, b, c);
  if (angle == null || isNaN(angle)) return;

  const color = getArcColor(angle, idealMin, idealMax);

  // Convert normalized coords to canvas pixels
  const bx = b.x * w, by = b.y * h;
  const ax = a.x * w, ay = a.y * h;
  const cx = c.x * w, cy = c.y * h;

  // Calculate angles for arc drawing
  const startAngle = Math.atan2(ay - by, ax - bx);
  const endAngle = Math.atan2(cy - by, cx - bx);

  const radius = Math.min(w, h) * 0.04; // arc radius proportional to canvas

  ctx.beginPath();
  ctx.arc(bx, by, radius, startAngle, endAngle, false);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Draw angle text
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.round(w * 0.018)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(angle)}°`, bx, by - radius - 4);
}

// Per-exercise joint configurations: which joints to highlight and their ideal ranges
const EXERCISE_JOINTS = {
  // Squat family
  squat: [
    { a: LM.RIGHT_HIP, b: LM.RIGHT_KNEE, c: LM.RIGHT_ANKLE, idealMin: 80, idealMax: 100 },
    { a: LM.LEFT_HIP, b: LM.LEFT_KNEE, c: LM.LEFT_ANKLE, idealMin: 80, idealMax: 100 },
  ],
  // Push-up family
  push: [
    { a: LM.RIGHT_SHOULDER, b: LM.RIGHT_ELBOW, c: LM.RIGHT_WRIST, idealMin: 80, idealMax: 100 },
    { a: LM.LEFT_SHOULDER, b: LM.LEFT_ELBOW, c: LM.LEFT_WRIST, idealMin: 80, idealMax: 100 },
  ],
  // Dips
  dip: [
    { a: LM.RIGHT_SHOULDER, b: LM.RIGHT_ELBOW, c: LM.RIGHT_WRIST, idealMin: 80, idealMax: 100 },
    { a: LM.LEFT_SHOULDER, b: LM.LEFT_ELBOW, c: LM.LEFT_WRIST, idealMin: 80, idealMax: 100 },
  ],
  // Lunges
  lunge: [
    { a: LM.RIGHT_HIP, b: LM.RIGHT_KNEE, c: LM.RIGHT_ANKLE, idealMin: 85, idealMax: 105 },
    { a: LM.LEFT_HIP, b: LM.LEFT_KNEE, c: LM.LEFT_ANKLE, idealMin: 85, idealMax: 105 },
  ],
  // Shoulder press
  shoulder: [
    { a: LM.RIGHT_ELBOW, b: LM.RIGHT_SHOULDER, c: LM.RIGHT_HIP, idealMin: 160, idealMax: 180 },
    { a: LM.LEFT_ELBOW, b: LM.LEFT_SHOULDER, c: LM.LEFT_HIP, idealMin: 160, idealMax: 180 },
  ],
  // Bicep curl
  bicep: [
    { a: LM.RIGHT_SHOULDER, b: LM.RIGHT_ELBOW, c: LM.RIGHT_WRIST, idealMin: 30, idealMax: 50 },
    { a: LM.LEFT_SHOULDER, b: LM.LEFT_ELBOW, c: LM.LEFT_WRIST, idealMin: 30, idealMax: 50 },
  ],
  // Tricep extension
  tricep: [
    { a: LM.RIGHT_SHOULDER, b: LM.RIGHT_ELBOW, c: LM.RIGHT_WRIST, idealMin: 160, idealMax: 180 },
    { a: LM.LEFT_SHOULDER, b: LM.LEFT_ELBOW, c: LM.LEFT_WRIST, idealMin: 160, idealMax: 180 },
  ],
  // Bridge
  bridge: [
    { a: LM.RIGHT_SHOULDER, b: LM.RIGHT_HIP, c: LM.RIGHT_KNEE, idealMin: 160, idealMax: 180 },
    { a: LM.LEFT_SHOULDER, b: LM.LEFT_HIP, c: LM.LEFT_KNEE, idealMin: 160, idealMax: 180 },
  ],
  // Plank — body alignment
  plank: [
    { a: LM.RIGHT_SHOULDER, b: LM.RIGHT_HIP, c: LM.RIGHT_ANKLE, idealMin: 170, idealMax: 180 },
    { a: LM.LEFT_SHOULDER, b: LM.LEFT_HIP, c: LM.LEFT_ANKLE, idealMin: 170, idealMax: 180 },
  ],
  // Lateral raise
  lateral: [
    { a: LM.RIGHT_ELBOW, b: LM.RIGHT_SHOULDER, c: LM.RIGHT_HIP, idealMin: 80, idealMax: 100 },
    { a: LM.LEFT_ELBOW, b: LM.LEFT_SHOULDER, c: LM.LEFT_HIP, idealMin: 80, idealMax: 100 },
  ],
  // Row
  row: [
    { a: LM.RIGHT_SHOULDER, b: LM.RIGHT_ELBOW, c: LM.RIGHT_WRIST, idealMin: 80, idealMax: 100 },
    { a: LM.LEFT_SHOULDER, b: LM.LEFT_ELBOW, c: LM.LEFT_WRIST, idealMin: 80, idealMax: 100 },
  ],
  // Crunch — hip angle
  crunch: [
    { a: LM.RIGHT_SHOULDER, b: LM.RIGHT_HIP, c: LM.RIGHT_KNEE, idealMin: 60, idealMax: 80 },
    { a: LM.LEFT_SHOULDER, b: LM.LEFT_HIP, c: LM.LEFT_KNEE, idealMin: 60, idealMax: 80 },
  ],
  // Wall sit — knee angle
  wallsit: [
    { a: LM.RIGHT_HIP, b: LM.RIGHT_KNEE, c: LM.RIGHT_ANKLE, idealMin: 85, idealMax: 95 },
    { a: LM.LEFT_HIP, b: LM.LEFT_KNEE, c: LM.LEFT_ANKLE, idealMin: 85, idealMax: 95 },
  ],
  // Mountain climber — hip angle
  mountain: [
    { a: LM.RIGHT_SHOULDER, b: LM.RIGHT_HIP, c: LM.RIGHT_KNEE, idealMin: 90, idealMax: 130 },
  ],
  // Side plank
  sideplank: [
    { a: LM.RIGHT_SHOULDER, b: LM.RIGHT_HIP, c: LM.RIGHT_ANKLE, idealMin: 170, idealMax: 180 },
  ],
};

/**
 * Main drawing function — called at 60fps via beforeDrawRef.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} landmarks - MediaPipe normalized landmarks
 * @param {number} w - canvas width
 * @param {number} h - canvas height
 * @param {string} cueKey - exercise cue key (e.g., 'squat', 'push', 'plank')
 */
export function drawFormCorrection(ctx, landmarks, w, h, cueKey) {
  if (!landmarks || !cueKey) return;

  const joints = EXERCISE_JOINTS[cueKey];
  if (!joints) return; // no visual feedback for this exercise type

  for (const joint of joints) {
    drawAngleArc(ctx, landmarks, joint.a, joint.b, joint.c, w, h, joint.idealMin, joint.idealMax);
  }
}

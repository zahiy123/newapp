// === Motion Engine: Kalman Filter + Biomechanics + Coaching Report ===
// Professional-grade movement analysis pipeline for real-time pose tracking

// ─── Layer 1: Kalman Filter Stabilization ─────────────────────────

/**
 * 1D Kalman Filter for smoothing noisy measurements.
 * Applied independently to each coordinate (x, y, z) of each landmark.
 *
 * processNoise (Q): How much we expect the true state to change per frame.
 *   Lower = smoother but more lag. Higher = more responsive but noisier.
 * measurementNoise (R): How noisy the sensor (MediaPipe) is.
 *   Higher = trusts prediction more. Lower = trusts measurement more.
 */
export class KalmanFilter {
  constructor({ processNoise = 0.001, measurementNoise = 0.05, estimate = 0, errorCovariance = 1 } = {}) {
    this.Q = processNoise;
    this.R = measurementNoise;
    this.x = estimate;
    this.P = errorCovariance;
  }

  update(measurement) {
    // Predict step (constant velocity model simplified to constant position)
    const xPred = this.x;
    const pPred = this.P + this.Q;

    // Update step
    const K = pPred / (pPred + this.R); // Kalman gain
    this.x = xPred + K * (measurement - xPred);
    this.P = (1 - K) * pPred;

    return this.x;
  }
}

/**
 * Manages a bank of Kalman filters for all 33 MediaPipe pose landmarks.
 * Each landmark gets 3 independent filters (x, y, z).
 * Filters are created lazily on first observation to handle visibility changes.
 */
export class LandmarkStabilizer {
  constructor(config = {}) {
    this.filters = {};
    this.prevSmoothed = {};
    this.config = {
      processNoise: config.processNoise || 0.001,
      // Increased from 0.05 → 0.12: trust Kalman prediction more on noisy mobile cameras
      measurementNoise: config.measurementNoise || 0.12,
    };
    // EMA alpha: 0 = full smoothing (all previous), 1 = no smoothing (all current)
    // 0.4 provides a good balance for real-world mobile jitter
    this.emaAlpha = config.emaAlpha || 0.4;
  }

  /**
   * Stabilize a full frame of raw MediaPipe landmarks.
   * Two-layer smoothing: Kalman filter → Exponential Moving Average
   * @param {Array} rawLandmarks - Array of 33 landmarks from MediaPipe
   * @returns {Array} Stabilized landmarks with the same structure
   */
  stabilize(rawLandmarks) {
    if (!rawLandmarks) return null;

    return rawLandmarks.map((lm, idx) => {
      // Skip low-visibility landmarks — don't waste filter state on noise
      if (!lm || lm.visibility < 0.2) return lm;

      // Lazily create filters on first observation
      if (!this.filters[idx]) {
        this.filters[idx] = {
          x: new KalmanFilter({ ...this.config, estimate: lm.x }),
          y: new KalmanFilter({ ...this.config, estimate: lm.y }),
          z: new KalmanFilter({ ...this.config, estimate: lm.z || 0 }),
        };
        this.prevSmoothed[idx] = { x: lm.x, y: lm.y, z: lm.z || 0 };
      }

      // Layer 1: Kalman filter
      const kx = this.filters[idx].x.update(lm.x);
      const ky = this.filters[idx].y.update(lm.y);
      const kz = this.filters[idx].z.update(lm.z || 0);

      // Layer 2: Exponential Moving Average on Kalman output
      // Visibility-adaptive alpha: lower visibility → more smoothing (less trust)
      const visAlpha = this.emaAlpha * Math.min(lm.visibility / 0.7, 1.0);
      const prev = this.prevSmoothed[idx];
      const sx = prev.x + visAlpha * (kx - prev.x);
      const sy = prev.y + visAlpha * (ky - prev.y);
      const sz = prev.z + visAlpha * (kz - prev.z);
      this.prevSmoothed[idx] = { x: sx, y: sy, z: sz };

      return { x: sx, y: sy, z: sz, visibility: lm.visibility };
    });
  }

  /** Reset all filters (call when exercise changes or calibration starts) */
  reset() {
    this.filters = {};
    this.prevSmoothed = {};
  }
}

// ─── Layer 2: Biomechanics Engine ──────────────────────────────────

/** 3D Euclidean distance between two landmarks */
function dist3D(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = (p1.z || 0) - (p2.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Calculate the angle at vertex B in triangle A-B-C using the Law of Cosines.
 * θ = arccos((AB² + BC² - AC²) / (2·AB·BC))
 *
 * This is more stable than atan2-based calculation because it uses
 * distances rather than coordinate differences, making it invariant
 * to camera rotation and less sensitive to single-axis jitter.
 *
 * @param {Object} a - First point {x, y, z?}
 * @param {Object} b - Vertex point {x, y, z?}
 * @param {Object} c - Third point {x, y, z?}
 * @returns {number} Angle in degrees (0-180)
 */
export function angleCosine(a, b, c) {
  const ab = dist3D(a, b);
  const bc = dist3D(b, c);
  const ac = dist3D(a, c);

  // Degenerate case: two points overlap
  if (ab < 1e-6 || bc < 1e-6) return 0;

  const cosTheta = (ab * ab + bc * bc - ac * ac) / (2 * ab * bc);
  // Clamp to [-1, 1] to avoid NaN from floating point errors
  return Math.acos(Math.max(-1, Math.min(1, cosTheta))) * 180 / Math.PI;
}

// MediaPipe Pose landmark indices
const LM = {
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
};

/**
 * Compute all relevant joint angles from stabilized landmarks in a single pass.
 * Returns an object with named angles (all in degrees, 0-180).
 */
export function computeJointAngles(landmarks) {
  if (!landmarks) return {};

  const lm = (idx) => landmarks[idx];
  const v = (idx) => lm(idx) && lm(idx).visibility > 0.3;

  const angles = {};

  // Elbows (shoulder-elbow-wrist)
  if (v(LM.LEFT_SHOULDER) && v(LM.LEFT_ELBOW) && v(LM.LEFT_WRIST)) {
    angles.leftElbow = angleCosine(lm(LM.LEFT_SHOULDER), lm(LM.LEFT_ELBOW), lm(LM.LEFT_WRIST));
  }
  if (v(LM.RIGHT_SHOULDER) && v(LM.RIGHT_ELBOW) && v(LM.RIGHT_WRIST)) {
    angles.rightElbow = angleCosine(lm(LM.RIGHT_SHOULDER), lm(LM.RIGHT_ELBOW), lm(LM.RIGHT_WRIST));
  }

  // Knees (hip-knee-ankle)
  if (v(LM.LEFT_HIP) && v(LM.LEFT_KNEE) && v(LM.LEFT_ANKLE)) {
    angles.leftKnee = angleCosine(lm(LM.LEFT_HIP), lm(LM.LEFT_KNEE), lm(LM.LEFT_ANKLE));
  }
  if (v(LM.RIGHT_HIP) && v(LM.RIGHT_KNEE) && v(LM.RIGHT_ANKLE)) {
    angles.rightKnee = angleCosine(lm(LM.RIGHT_HIP), lm(LM.RIGHT_KNEE), lm(LM.RIGHT_ANKLE));
  }

  // Shoulders (elbow-shoulder-hip)
  if (v(LM.LEFT_ELBOW) && v(LM.LEFT_SHOULDER) && v(LM.LEFT_HIP)) {
    angles.leftShoulder = angleCosine(lm(LM.LEFT_ELBOW), lm(LM.LEFT_SHOULDER), lm(LM.LEFT_HIP));
  }
  if (v(LM.RIGHT_ELBOW) && v(LM.RIGHT_SHOULDER) && v(LM.RIGHT_HIP)) {
    angles.rightShoulder = angleCosine(lm(LM.RIGHT_ELBOW), lm(LM.RIGHT_SHOULDER), lm(LM.RIGHT_HIP));
  }

  // Hips (shoulder-hip-knee)
  if (v(LM.LEFT_SHOULDER) && v(LM.LEFT_HIP) && v(LM.LEFT_KNEE)) {
    angles.leftHip = angleCosine(lm(LM.LEFT_SHOULDER), lm(LM.LEFT_HIP), lm(LM.LEFT_KNEE));
  }
  if (v(LM.RIGHT_SHOULDER) && v(LM.RIGHT_HIP) && v(LM.RIGHT_KNEE)) {
    angles.rightHip = angleCosine(lm(LM.RIGHT_SHOULDER), lm(LM.RIGHT_HIP), lm(LM.RIGHT_KNEE));
  }

  // Spine angle (neck midpoint → hip midpoint → knee midpoint)
  if (v(LM.LEFT_SHOULDER) && v(LM.RIGHT_SHOULDER) &&
      v(LM.LEFT_HIP) && v(LM.RIGHT_HIP) &&
      v(LM.LEFT_KNEE) && v(LM.RIGHT_KNEE)) {
    const neck = {
      x: (lm(LM.LEFT_SHOULDER).x + lm(LM.RIGHT_SHOULDER).x) / 2,
      y: (lm(LM.LEFT_SHOULDER).y + lm(LM.RIGHT_SHOULDER).y) / 2,
      z: ((lm(LM.LEFT_SHOULDER).z || 0) + (lm(LM.RIGHT_SHOULDER).z || 0)) / 2,
    };
    const midHip = {
      x: (lm(LM.LEFT_HIP).x + lm(LM.RIGHT_HIP).x) / 2,
      y: (lm(LM.LEFT_HIP).y + lm(LM.RIGHT_HIP).y) / 2,
      z: ((lm(LM.LEFT_HIP).z || 0) + (lm(LM.RIGHT_HIP).z || 0)) / 2,
    };
    const midKnee = {
      x: (lm(LM.LEFT_KNEE).x + lm(LM.RIGHT_KNEE).x) / 2,
      y: (lm(LM.LEFT_KNEE).y + lm(LM.RIGHT_KNEE).y) / 2,
      z: ((lm(LM.LEFT_KNEE).z || 0) + (lm(LM.RIGHT_KNEE).z || 0)) / 2,
    };
    angles.spine = angleCosine(neck, midHip, midKnee);
  }

  return angles;
}

// ─── Sport Profiles ────────────────────────────────────────────────

export const SPORT_PROFILES = {
  fitness: {
    keyJoints: ['leftKnee', 'rightKnee', 'leftElbow', 'rightElbow', 'spine'],
    targetMetrics: {
      squat: { knee: { min: 70, max: 170, ideal: 90 }, hip: { min: 80, max: 175, ideal: 100 } },
      pushup: { elbow: { min: 60, max: 170, ideal: 90 } },
      lunge: { knee: { min: 75, max: 170, ideal: 90 } },
      bicepCurl: { elbow: { min: 30, max: 165, ideal: 40 } },
      shoulderPress: { elbow: { min: 60, max: 175, ideal: 170 }, shoulder: { min: 60, max: 170, ideal: 160 } },
      plank: { spine: { min: 160, max: 180, ideal: 175 } },
    },
    isAdaptive: false,
    safetyRequirements: { requiresFloorContact: false, clearanceZone: 1.0 },
  },
  football: {
    keyJoints: ['leftKnee', 'rightKnee', 'leftHip', 'rightHip', 'spine'],
    targetMetrics: {
      kick: { hip: { min: 120, max: 180, ideal: 150 }, knee: { min: 90, max: 180, ideal: 160 } },
      dribbling: { knee: { min: 100, max: 150, ideal: 120 }, spine: { min: 150, max: 175, ideal: 160 } },
    },
    isAdaptive: false,
    safetyRequirements: { requiresFloorContact: true, clearanceZone: 2.0 },
  },
  footballAmputee: {
    keyJoints: ['leftKnee', 'rightKnee', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow'],
    targetMetrics: {
      amputeeKick: { hip: { min: 110, max: 180, ideal: 145 }, shoulder: { min: 60, max: 160, ideal: 100 } },
      amputeeSprint: { knee: { min: 90, max: 175, ideal: 140 }, shoulder: { min: 70, max: 160, ideal: 110 } },
    },
    isAdaptive: true,
    safetyRequirements: { requiresFloorContact: true, clearanceZone: 2.5, requiresCrutchClearance: true },
  },
  basketball: {
    keyJoints: ['leftElbow', 'rightElbow', 'leftShoulder', 'rightShoulder', 'leftKnee', 'rightKnee'],
    targetMetrics: {
      shooting: { elbow: { min: 60, max: 175, ideal: 90 }, shoulder: { min: 80, max: 170, ideal: 140 } },
      handDribble: { elbow: { min: 80, max: 160, ideal: 110 } },
    },
    isAdaptive: false,
    safetyRequirements: { requiresFloorContact: false, clearanceZone: 2.0 },
  },
  basketballWheelchair: {
    keyJoints: ['leftElbow', 'rightElbow', 'leftShoulder', 'rightShoulder'],
    targetMetrics: {
      wheelchairShooting: { elbow: { min: 50, max: 175, ideal: 90 }, shoulder: { min: 70, max: 170, ideal: 140 } },
      wheelchairDribble: { elbow: { min: 70, max: 155, ideal: 100 } },
      wheelchairPass: { elbow: { min: 80, max: 170, ideal: 160 }, shoulder: { min: 60, max: 140, ideal: 100 } },
    },
    isAdaptive: true,
    safetyRequirements: { requiresFloorContact: false, clearanceZone: 2.5, requiresWheelchairSpace: true },
  },
  tennis: {
    keyJoints: ['leftElbow', 'rightElbow', 'leftShoulder', 'rightShoulder', 'leftKnee', 'rightKnee'],
    targetMetrics: {
      stroke: { elbow: { min: 70, max: 175, ideal: 165 }, shoulder: { min: 60, max: 170, ideal: 150 } },
      serve: { shoulder: { min: 100, max: 180, ideal: 170 }, elbow: { min: 80, max: 175, ideal: 170 } },
    },
    isAdaptive: false,
    safetyRequirements: { requiresFloorContact: false, clearanceZone: 3.0 },
  },
  tennisWheelchair: {
    keyJoints: ['leftElbow', 'rightElbow', 'leftShoulder', 'rightShoulder'],
    targetMetrics: {
      wheelchairStroke: { elbow: { min: 60, max: 175, ideal: 165 }, shoulder: { min: 50, max: 170, ideal: 150 } },
      wheelchairServe: { shoulder: { min: 90, max: 180, ideal: 170 }, elbow: { min: 70, max: 175, ideal: 170 } },
    },
    isAdaptive: true,
    safetyRequirements: { requiresFloorContact: false, clearanceZone: 3.0, requiresWheelchairSpace: true },
  },
  footballAmputeeGK: {
    keyJoints: ['leftKnee', 'rightKnee', 'leftHip', 'rightHip', 'spine'],
    targetMetrics: {
      kick: { hip: { min: 110, max: 180, ideal: 145 }, knee: { min: 90, max: 180, ideal: 160 } },
    },
    isAdaptive: true,
    safetyRequirements: { requiresFloorContact: true, clearanceZone: 2.5 },
  },
};

export function getSportProfile(sport) {
  return SPORT_PROFILES[sport] || SPORT_PROFILES.fitness;
}

export function getTargetMetrics(sport, cueKey) {
  const profile = getSportProfile(sport);
  return profile.targetMetrics[cueKey] || null;
}

// ─── Layer 3: Coaching Analysis ────────────────────────────────────

/**
 * Compute symmetry score: how balanced left vs right side movements are.
 * 1.0 = perfectly symmetric, 0.0 = 45°+ difference between sides.
 */
export function computeSymmetryScore(angles) {
  const pairs = [
    ['leftElbow', 'rightElbow'],
    ['leftKnee', 'rightKnee'],
    ['leftShoulder', 'rightShoulder'],
    ['leftHip', 'rightHip'],
  ];

  let totalDiff = 0;
  let count = 0;

  for (const [l, r] of pairs) {
    if (angles[l] != null && angles[r] != null) {
      totalDiff += Math.abs(angles[l] - angles[r]);
      count++;
    }
  }

  if (count === 0) return 1.0;
  const avgDiff = totalDiff / count;
  // Scale: 0° diff → 1.0, 45°+ diff → 0.0
  return Math.max(0, Math.round((1 - avgDiff / 45) * 100) / 100);
}

/**
 * Compute stability score from a rolling window of angle snapshots.
 * Measures how steady the user holds position (low variance = high stability).
 * 1.0 = rock-solid, 0.0 = shaking violently (20°+ std dev).
 *
 * @param {Array} anglesHistory - Last N frames of computeJointAngles() results
 */
export function computeStabilityScore(anglesHistory) {
  if (!anglesHistory || anglesHistory.length < 10) return 1.0;

  const keys = Object.keys(anglesHistory[0] || {});
  if (keys.length === 0) return 1.0;

  let totalVariance = 0;
  let count = 0;

  for (const key of keys) {
    const values = anglesHistory.map(a => a[key]).filter(v => v != null);
    if (values.length < 5) continue;

    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    totalVariance += variance;
    count++;
  }

  if (count === 0) return 1.0;
  const avgStdDev = Math.sqrt(totalVariance / count);
  // Scale: <1° std → 0.95+, >20° std → 0.0
  return Math.max(0, Math.round((1 - avgStdDev / 20) * 100) / 100);
}

/**
 * Detect movement phase based on change in a primary joint angle.
 * @param {Object} currentAngles - Current frame's joint angles
 * @param {Object} prevAngles - Previous frame's joint angles
 * @param {string} primaryJoint - The joint to track (e.g., 'leftKnee')
 * @returns {'flexing'|'extending'|'hold'|'unknown'}
 */
export function detectMovementPhase(currentAngles, prevAngles, primaryJoint) {
  if (!currentAngles || !prevAngles) return 'unknown';
  if (currentAngles[primaryJoint] == null || prevAngles[primaryJoint] == null) return 'unknown';

  const delta = currentAngles[primaryJoint] - prevAngles[primaryJoint];

  // Within Kalman-filtered noise floor — treat as hold
  if (Math.abs(delta) < 1.5) return 'hold';

  return delta > 0 ? 'extending' : 'flexing';
}

/**
 * Build a JSON performance report ready for LLM coaching analysis.
 * Call this periodically (e.g., every ~1 second or after each rep).
 */
export function buildPerformanceReport(angles, phase, stabilityScore, symmetryScore, repData = {}) {
  return {
    timestamp: Date.now(),
    jointAngles: angles,
    movementPhase: phase,
    stabilityScore,
    symmetryScore,
    repCount: repData.reps || 0,
    romPercentage: repData.romPct != null ? Math.round(repData.romPct) : null,
    formIssues: repData.formIssues || [],
  };
}

/**
 * Evaluate a completed set's performance metrics for level-up eligibility.
 * Used by the longevity (51+) level-up progression system.
 */
export function evaluateSetPerformance(stabilityScore, symmetryScore, romPct, avgRepTimeMs) {
  const highVelocity = avgRepTimeMs != null && avgRepTimeMs > 0 && avgRepTimeMs < 2500;
  const perfectForm = stabilityScore > 0.85 && symmetryScore > 0.85 && (romPct == null || romPct > 80);
  return { highVelocity, perfectForm, qualifiesForLevelUp: highVelocity && perfectForm };
}

// ─── Layer 4: Floor Plane & Spatial Safety ─────────────────────────

/**
 * Detect the floor plane from visible ankle/foot landmarks.
 * In normalized coords, higher Y = lower in frame (closer to floor).
 */
export function detectFloorPlane(landmarks) {
  if (!landmarks) return { floorY: 1.0, contactPoints: [], isGrounded: false };

  const ankleIndices = [LM.LEFT_ANKLE, LM.RIGHT_ANKLE];
  const contactPoints = [];
  let floorY = 0;

  for (const idx of ankleIndices) {
    const lm = landmarks[idx];
    if (lm && lm.visibility > 0.3) {
      contactPoints.push(lm);
      if (lm.y > floorY) floorY = lm.y;
    }
  }

  return {
    floorY: contactPoints.length > 0 ? floorY : 1.0,
    contactPoints,
    isGrounded: contactPoints.length > 0,
  };
}

/**
 * Check if required joints are in contact with the floor plane.
 * A joint "contacts" floor if its Y is within 0.03 of floorY.
 */
export function checkFloorContact(landmarks, requiredJoints = ['leftAnkle', 'rightAnkle']) {
  if (!landmarks) return { hasContact: false, contactJoints: [], floorY: 1.0 };

  const jointToIndex = {
    leftAnkle: LM.LEFT_ANKLE, rightAnkle: LM.RIGHT_ANKLE,
    leftKnee: LM.LEFT_KNEE, rightKnee: LM.RIGHT_KNEE,
    leftHip: LM.LEFT_HIP, rightHip: LM.RIGHT_HIP,
    leftShoulder: LM.LEFT_SHOULDER, rightShoulder: LM.RIGHT_SHOULDER,
  };

  const floor = detectFloorPlane(landmarks);
  const contactJoints = [];

  for (const joint of requiredJoints) {
    const idx = jointToIndex[joint];
    if (idx == null) continue;
    const lm = landmarks[idx];
    if (lm && lm.visibility > 0.3 && Math.abs(lm.y - floor.floorY) < 0.03) {
      contactJoints.push(joint);
    }
  }

  return {
    hasContact: contactJoints.length > 0,
    contactJoints,
    floorY: floor.floorY,
  };
}

function getUserBoundingBox(landmarks) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const lm of landmarks) {
    if (!lm || lm.visibility < 0.3) continue;
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.y > maxY) maxY = lm.y;
  }
  return { minX, maxX, minY, maxY };
}

function bboxProximity(userBbox, objectBbox) {
  // Compute center-to-center distance normalized to frame size
  const userCx = (userBbox.minX + userBbox.maxX) / 2;
  const userCy = (userBbox.minY + userBbox.maxY) / 2;
  const objCx = (objectBbox.x + objectBbox.width / 2) || objectBbox.minX || 0;
  const objCy = (objectBbox.y + objectBbox.height / 2) || objectBbox.minY || 0;
  return Math.sqrt((userCx - objCx) ** 2 + (userCy - objCy) ** 2);
}

function translateObject(label) {
  const HE = {
    chair: 'כיסא', 'dining table': 'שולחן', couch: 'ספה',
    bottle: 'בקבוק', tv: 'טלוויזיה', laptop: 'מחשב נייד', vase: 'אגרטל',
  };
  return HE[label] || label;
}

/**
 * Run safety checks against the sport profile requirements.
 * Uses existing object detection results from useObjectDetection.
 */
export function runSafetyCheck(detectedObjects, sportProfile, landmarks) {
  const issues = [];
  const clearance = sportProfile.safetyRequirements.clearanceZone;

  // 1. Hazardous objects nearby
  const hazardLabels = ['chair', 'dining table', 'couch', 'tv', 'laptop', 'vase', 'bottle'];
  if (landmarks) {
    const userBbox = getUserBoundingBox(landmarks);
    for (const obj of detectedObjects) {
      if (hazardLabels.includes(obj.label)) {
        const bbox = obj.bbox || obj;
        const proximity = bboxProximity(userBbox, bbox);
        if (proximity < clearance * 0.3) {
          issues.push({
            type: 'obstacle',
            severity: 'warning',
            object: obj.label,
            message_he: `יש ${translateObject(obj.label)} קרוב מדי! הזז אותו לפני שנתחיל`,
            message_en: `${obj.label} is too close! Move it before we start`,
          });
        }
      }
    }
  }

  // 2. Floor contact verification
  if (sportProfile.safetyRequirements.requiresFloorContact && landmarks) {
    const floor = checkFloorContact(landmarks);
    if (!floor.hasContact) {
      issues.push({
        type: 'floor',
        severity: 'info',
        message_he: 'ודא שהרגליים על הרצפה ויציבות',
        message_en: 'Make sure feet are on the floor and stable',
      });
    }
  }

  // 3. Wheelchair space check
  if (sportProfile.safetyRequirements.requiresWheelchairSpace && landmarks) {
    const lShoul = landmarks[LM.LEFT_SHOULDER];
    const rShoul = landmarks[LM.RIGHT_SHOULDER];
    const lWrist = landmarks[LM.LEFT_WRIST];
    const rWrist = landmarks[LM.RIGHT_WRIST];
    if (lShoul && rShoul && lWrist && rWrist) {
      const shoulderWidth = Math.abs(lShoul.x - rShoul.x);
      const armSpan = Math.abs(lWrist.x - rWrist.x);
      if (armSpan < shoulderWidth * 1.5) {
        issues.push({
          type: 'wheelchair_space',
          severity: 'warning',
          message_he: 'נראה שאין מספיק מרחב לתנועת הידיים. פנה מקום',
          message_en: 'Not enough arm clearance detected. Clear some space',
        });
      }
    }
  }

  // 4. Crutch clearance
  if (sportProfile.safetyRequirements.requiresCrutchClearance && landmarks) {
    const userBbox = getUserBoundingBox(landmarks);
    const lateralSpace = userBbox.maxX - userBbox.minX;
    if (lateralSpace > 0.8) {
      issues.push({
        type: 'crutch_clearance',
        severity: 'warning',
        message_he: 'ודא שיש מרחב מספיק לתנועת הקביים',
        message_en: 'Make sure there is enough space for crutch movement',
      });
    }
  }

  return {
    safe: issues.filter(i => i.severity === 'warning' || i.severity === 'danger').length === 0,
    issues,
  };
}

// ─── Layer 5: Calibration & Target Evaluation ──────────────────────

/**
 * Calibrate joint ranges from a history of angle snapshots, aware of sport profile.
 * For adaptive profiles (Paralympic), uses personal calibration instead of textbook targets.
 */
export function calibrate(anglesHistory, sportProfile) {
  const calibration = {};

  for (const joint of sportProfile.keyJoints) {
    const values = anglesHistory.map(a => a[joint]).filter(v => v != null);
    if (values.length < 5) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    calibration[joint] = { min, max, range: max - min };
  }

  return {
    ...calibration,
    isAdaptive: sportProfile.isAdaptive,
    sport: sportProfile,
    timestamp: Date.now(),
  };
}

/**
 * Compare current angles to calibration (adaptive) or textbook targets.
 * Returns a 0-1 score and a list of deviations exceeding 15°.
 */
export function evaluateAgainstTargets(currentAngles, calibrationData, cueKey) {
  // For adaptive athletes, use their personal calibration ranges
  // For standard athletes, use sport-specific textbook targets
  const targets = calibrationData.isAdaptive
    ? calibrationData
    : getTargetMetrics(calibrationData.sport, cueKey);

  if (!targets) return { score: 1.0, deviations: [] };

  const deviations = [];
  for (const [joint, target] of Object.entries(targets)) {
    if (!target?.ideal || currentAngles[joint] == null) continue;
    const deviation = Math.abs(currentAngles[joint] - target.ideal);
    if (deviation > 15) {
      deviations.push({ joint, current: currentAngles[joint], ideal: target.ideal, deviation });
    }
  }

  const score = deviations.length === 0 ? 1.0
    : Math.max(0, 1 - deviations.reduce((s, d) => s + d.deviation, 0) / (deviations.length * 45));

  return { score: Math.round(score * 100) / 100, deviations };
}

// ─── Layer 6: Coach Feedback API ───────────────────────────────────

function buildCoachPrompt(sport, exercise, report, critical, safety) {
  const lines = [
    `אתה מאמן מומחה ב-${sport}.`,
    `המשתמש מבצע ${exercise}.`,
    `זוויות מפרקים: ${JSON.stringify(report.jointAngles)}.`,
    `ציון יציבות: ${report.stabilityScore}, ציון סימטריה: ${report.symmetryScore}.`,
  ];

  if (critical) {
    lines.push(`סטייה קריטית: ${critical.joint} = ${Math.round(critical.current)}° (אידיאלי: ${critical.ideal}°, סטייה: ${Math.round(critical.deviation)}°).`);
  }

  if (!safety.safe) {
    lines.push(`בעיות בטיחות: ${safety.issues.map(i => i.message_he).join(', ')}.`);
  }

  lines.push('תן תיקון טכני של עד 7 מילים בעברית. התמקד רק בסטייה הכי קריטית.');

  return lines.join(' ');
}

/**
 * Generate a coaching feedback request if there's a significant deviation or safety issue.
 * Returns null when form is good (prevents API spam).
 */
export function generateCoachFeedback(report, profile, safetyResult) {
  const calibrationData = profile.calibration || { isAdaptive: false, sport: profile.sport || 'fitness' };
  const { deviations } = evaluateAgainstTargets(report.jointAngles, calibrationData, profile.cueKey);

  // Skip if everything is good
  if (deviations.length === 0 && safetyResult.safe && report.stabilityScore > 0.8) {
    return null;
  }

  // Find the most critical deviation
  const sorted = [...deviations].sort((a, b) => b.deviation - a.deviation);
  const critical = sorted[0] || null;

  const sportName = profile.sport || 'fitness';
  const prompt = buildCoachPrompt(sportName, profile.cueKey, report, critical, safetyResult);

  return {
    shouldSend: true,
    prompt,
    rawData: { report, deviations, safetyIssues: safetyResult.issues },
  };
}

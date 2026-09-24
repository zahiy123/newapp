// ═══════════════════════════════════════════════════════════════
// Kinetic Engine — Schema-driven peak detection & snapshot system
// ═══════════════════════════════════════════════════════════════

// MediaPipe landmark indices
const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
};

// ─── Helpers ───

function dist2D(a, b) {
  if (!a || !b) return null;
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function resolvePoint(ref, landmarks, ballData, equipmentData) {
  if (!ref) return null;
  if (ref.source === 'ball') {
    if (!ballData?.detected) return null;
    return { x: ballData.x, y: ballData.y };
  }
  if (ref.source === 'equipment') {
    if (!equipmentData || !Array.isArray(equipmentData)) return null;
    const matches = equipmentData.filter(e => e.className === ref.class);
    const target = matches[ref.index || 0];
    if (!target) return null;
    if (ref.anchor === 'top') return { x: target.x, y: target.y - target.h / 2 };
    if (ref.anchor === 'bottom') return { x: target.x, y: target.y + target.h / 2 };
    if (ref.anchor === 'left') return { x: target.x - target.w / 2, y: target.y };
    if (ref.anchor === 'right') return { x: target.x + target.w / 2, y: target.y };
    return { x: target.x, y: target.y };
  }
  if (ref.landmark != null) {
    const lm = landmarks?.[ref.landmark];
    if (!lm || (lm.visibility != null && lm.visibility < 0.3)) return null;
    return { x: lm.x, y: lm.y };
  }
  return null;
}

function readSignal(trigger, angles, landmarks, ballData, equipmentData) {
  switch (trigger.type) {
    case 'min_angle':
    case 'max_angle':
      return angles?.[trigger.joint] ?? null;

    case 'min_distance':
    case 'max_distance': {
      const fromPt = resolvePoint(trigger.from, landmarks, ballData, equipmentData);
      const toPt = resolvePoint(trigger.to, landmarks, ballData, equipmentData);
      return dist2D(fromPt, toPt);
    }

    case 'min_y':
    case 'max_y': {
      const lm = landmarks?.[trigger.landmark];
      if (!lm || (lm.visibility != null && lm.visibility < 0.3)) return null;
      return lm.y;
    }

    // Equipment bounding box angle relative to vertical (degrees)
    case 'equipment_angle': {
      if (!equipmentData || !Array.isArray(equipmentData)) return null;
      const matches = equipmentData.filter(e => e.className === trigger.equipmentClass);
      const target = matches[trigger.index || 0];
      if (!target || target.h < 0.05) return null;
      // Approximate tilt from aspect ratio: 0° = perfectly vertical
      return Math.abs(Math.atan2(target.w, target.h) * (180 / Math.PI));
    }

    // Equipment velocity magnitude
    case 'max_equipment_velocity':
    case 'min_equipment_velocity': {
      if (!equipmentData || !Array.isArray(equipmentData)) return null;
      const matches = equipmentData.filter(e => e.className === trigger.equipmentClass);
      const target = matches[trigger.index || 0];
      if (!target?.velocity) return null;
      return Math.sqrt(target.velocity.vx ** 2 + target.velocity.vy ** 2);
    }

    // Distance between equipment centroid and a body landmark
    case 'equipment_proximity': {
      const equipPt = resolvePoint(
        { source: 'equipment', class: trigger.equipmentClass, index: trigger.equipmentIndex || 0 },
        landmarks, ballData, equipmentData
      );
      const bodyPt = resolvePoint(
        { landmark: trigger.landmark },
        landmarks, ballData, equipmentData
      );
      return dist2D(equipPt, bodyPt);
    }

    default:
      return null;
  }
}

function getReversalThreshold(trigger) {
  return trigger.reversalDeg || trigger.reversalPx || 2;
}

function hasReversed(trigger, currentValue, extremeValue) {
  if (currentValue == null || extremeValue == null) return false;
  const thresh = getReversalThreshold(trigger);

  switch (trigger.type) {
    case 'min_angle':
    case 'min_distance':
    case 'min_y':
    case 'equipment_angle':
    case 'min_equipment_velocity':
    case 'equipment_proximity':
      return currentValue > extremeValue + thresh;

    case 'max_angle':
    case 'max_y':
    case 'max_distance':
    case 'max_equipment_velocity':
      return currentValue < extremeValue - thresh;

    default:
      return false;
  }
}

function isMoreExtreme(trigger, currentValue, extremeValue) {
  switch (trigger.type) {
    case 'min_angle':
    case 'min_distance':
    case 'min_y':
    case 'equipment_angle':
    case 'min_equipment_velocity':
    case 'equipment_proximity':
      return currentValue < extremeValue;

    case 'max_angle':
    case 'max_y':
    case 'max_distance':
    case 'max_equipment_velocity':
      return currentValue > extremeValue;

    default:
      return false;
  }
}

// ─── Default trigger (fallback when no schema configured) ───

const DEFAULT_TRIGGER = {
  id: 'generic_min_angle',
  type: 'min_angle',
  joint: null, // auto-select first available
  reversalDeg: 2,
  minROM: 0.15,
  fallbackOnPhaseChange: true,
};

// ─── PeakDetector Class ───

export class PeakDetector {
  constructor(triggers, options = {}) {
    this.triggers = (triggers && triggers.length > 0) ? triggers : [DEFAULT_TRIGGER];
    this.onPeak = options.onPeak || (() => {});
    this.startingValues = {};
    this.extremeValues = {};
    this.bestSnapshot = null;
    this.peakFired = false;
    this.lastPhase = null;
  }

  feed(frameData) {
    if (this.peakFired) return;

    const { angles, landmarks, ballData, equipmentData, analyzerState, captureFrame } = frameData;
    const currentPhase = analyzerState?.phase;

    for (const trigger of this.triggers) {
      const tid = trigger.id || trigger.type;

      // Phase transition trigger
      if (trigger.type === 'phase_transition') {
        if (this.lastPhase === trigger.from && currentPhase === trigger.to) {
          this.peakFired = true;
          const frame = captureFrame?.();
          this.onPeak({
            triggerId: tid,
            triggerType: trigger.type,
            frame,
            angles: angles ? { ...angles } : null,
            landmarks,
            ballData: ballData ? { ...ballData } : null,
            equipmentData: equipmentData || null,
            phase: currentPhase,
            prevPhase: this.lastPhase,
            extremeValue: null,
            timestamp: Date.now(),
          });
          this.lastPhase = currentPhase;
          return;
        }
        // Don't update lastPhase yet — do it at the end
        continue;
      }

      // Phase guard
      if (trigger.phaseGuard && currentPhase && !trigger.phaseGuard.includes(currentPhase)) {
        continue;
      }

      // Read signal
      let value = readSignal(trigger, angles, landmarks, ballData, equipmentData);

      // Auto-select joint for generic trigger
      if (value == null && trigger.joint == null &&
          (trigger.type === 'min_angle' || trigger.type === 'max_angle') && angles) {
        const firstKey = Object.keys(angles)[0];
        if (firstKey) value = angles[firstKey];
      }

      if (value == null) continue;

      // Initialize starting value for ROM validation
      if (this.startingValues[tid] == null) {
        this.startingValues[tid] = value;
      }

      // Track extremum and buffer snapshot
      if (this.extremeValues[tid] == null || isMoreExtreme(trigger, value, this.extremeValues[tid])) {
        this.extremeValues[tid] = value;
        const frame = captureFrame?.();
        if (frame) {
          this.bestSnapshot = {
            triggerId: tid,
            triggerType: trigger.type,
            frame,
            angles: angles ? { ...angles } : null,
            landmarks,
            ballData: ballData ? { ...ballData } : null,
            equipmentData: equipmentData || null,
            phase: currentPhase,
            extremeValue: value,
            timestamp: Date.now(),
          };
        }
      }

      // Check reversal
      if (this.bestSnapshot && this.bestSnapshot.triggerId === tid &&
          hasReversed(trigger, value, this.extremeValues[tid])) {
        // ROM validation
        if (trigger.minROM != null && this.startingValues[tid] != null) {
          const rom = Math.abs(this.startingValues[tid] - this.extremeValues[tid]);
          const base = Math.abs(this.startingValues[tid]) || 1;
          if (rom / base < trigger.minROM) continue; // too shallow
        }

        this.peakFired = true;
        this.onPeak(this.bestSnapshot);
        this.lastPhase = currentPhase;
        return;
      }
    }

    // Phase-change fallback
    if (this.lastPhase != null && currentPhase !== this.lastPhase && !this.peakFired && this.bestSnapshot) {
      const fallbackTrigger = this.triggers.find(t =>
        t.fallbackOnPhaseChange && t.id === this.bestSnapshot.triggerId
      );
      if (fallbackTrigger) {
        const tid = fallbackTrigger.id || fallbackTrigger.type;
        let qualified = true;
        if (fallbackTrigger.minROM != null && this.startingValues[tid] != null && this.extremeValues[tid] != null) {
          const rom = Math.abs(this.startingValues[tid] - this.extremeValues[tid]);
          const base = Math.abs(this.startingValues[tid]) || 1;
          qualified = rom / base >= fallbackTrigger.minROM;
        }
        if (qualified) {
          this.peakFired = true;
          this.onPeak(this.bestSnapshot);
        }
      }
    }

    this.lastPhase = currentPhase;
  }

  resetForNewRep() {
    this.extremeValues = {};
    this.bestSnapshot = null;
    this.peakFired = false;
  }

  reset() {
    this.startingValues = {};
    this.extremeValues = {};
    this.bestSnapshot = null;
    this.peakFired = false;
    this.lastPhase = null;
  }

  destroy() {
    this.reset();
    this.onPeak = null;
  }
}

// ─── Movement State Data ───

export function buildMovementState(snapshot, exerciseName, repNumber) {
  return {
    trigger: {
      id: snapshot.triggerId,
      type: snapshot.triggerType,
      extremeValue: snapshot.extremeValue,
    },
    repNumber,
    exercise: exerciseName,
    phase: snapshot.phase,
    prevPhase: snapshot.prevPhase || null,
    timestamp: snapshot.timestamp,
    jointAngles: snapshot.angles,
    ballPosition: snapshot.ballData?.detected ? {
      x: snapshot.ballData.x,
      y: snapshot.ballData.y,
      confidence: snapshot.ballData.confidence,
      distanceEstimate: snapshot.ballData.distanceEstimate,
    } : null,
    equipment: snapshot.equipmentData?.length > 0
      ? snapshot.equipmentData.map(e => ({
          trackId: e.trackId,
          class: e.className,
          x: e.x,
          y: e.y,
          confidence: e.confidence,
          velocity: e.velocity || null,
        }))
      : null,
  };
}

// ─── Peak Trigger Schemas per cueKey ───

export const PEAK_TRIGGERS = {
  // === Fitness — angle-based ===
  squat:     [{ id: 'knee_depth',  type: 'min_angle', joint: 'leftKnee',      reversalDeg: 2, minROM: 0.15, fallbackOnPhaseChange: true }],
  push:      [{ id: 'elbow_depth', type: 'min_angle', joint: 'leftElbow',     reversalDeg: 2, minROM: 0.15, fallbackOnPhaseChange: true }],
  dip:       [{ id: 'elbow_depth', type: 'min_angle', joint: 'leftElbow',     reversalDeg: 2, minROM: 0.15, fallbackOnPhaseChange: true }],
  lunge:     [{ id: 'knee_depth',  type: 'min_angle', joint: 'leftKnee',      reversalDeg: 2, minROM: 0.15, fallbackOnPhaseChange: true }],
  bicep:     [{ id: 'curl_depth',  type: 'min_angle', joint: 'rightElbow',    reversalDeg: 2, minROM: 0.15, fallbackOnPhaseChange: true }],
  tricep:    [{ id: 'extension',   type: 'max_angle', joint: 'rightElbow',    reversalDeg: 2, minROM: 0.15, fallbackOnPhaseChange: true }],
  shoulder:  [{ id: 'press_top',   type: 'max_angle', joint: 'rightShoulder', reversalDeg: 2, minROM: 0.15, fallbackOnPhaseChange: true }],
  row:       [{ id: 'pull_depth',  type: 'min_angle', joint: 'rightElbow',    reversalDeg: 2, minROM: 0.15, fallbackOnPhaseChange: true }],
  lateral:   [{ id: 'raise_top',   type: 'max_angle', joint: 'rightShoulder', reversalDeg: 3, minROM: 0.10, fallbackOnPhaseChange: true }],
  bridge:    [{ id: 'hip_top',     type: 'max_angle', joint: 'rightHip',      reversalDeg: 2, minROM: 0.10, fallbackOnPhaseChange: true }],
  crunch:    [{ id: 'hip_flex',    type: 'min_angle', joint: 'rightHip',      reversalDeg: 2, minROM: 0.10, fallbackOnPhaseChange: true }],
  deadlift:  [{ id: 'hip_hinge',   type: 'min_angle', joint: 'rightHip',      reversalDeg: 2, minROM: 0.15, fallbackOnPhaseChange: true }],
  mountain:  [{ id: 'knee_drive',  type: 'min_angle', joint: 'rightHip',      reversalDeg: 3, minROM: 0.08, fallbackOnPhaseChange: true }],
  legRaise:  [{ id: 'leg_top',     type: 'min_angle', joint: 'rightHip',      reversalDeg: 3, minROM: 0.10, fallbackOnPhaseChange: true }],

  // === Jumps / vertical ===
  jump:      [{ id: 'apex',        type: 'min_y',     landmark: LM.RIGHT_HIP,   reversalPx: 0.01 }],
  pull:      [{ id: 'chin_top',    type: 'min_y',     landmark: LM.NOSE,        reversalPx: 0.01 }],
  calfRaise: [{ id: 'calf_top',    type: 'min_y',     landmark: LM.RIGHT_ANKLE, reversalPx: 0.005 }],

  // === Sport drills — phase-based ===
  kick:      [{ id: 'kick_strike',    type: 'phase_transition', from: 'windup',    to: 'strike' }],
  shooting:  [{ id: 'shot_release',   type: 'phase_transition', from: 'setup',     to: 'release' }],
  serve:     [{ id: 'serve_trophy',   type: 'phase_transition', from: 'toss',      to: 'trophy' }],
  stroke:    [{ id: 'stroke_contact', type: 'phase_transition', from: 'backswing', to: 'forward' }],
  pass:      [{ id: 'pass_release',   type: 'phase_transition', from: 'windup',    to: 'release' }],

  // === Ball-aware drills — distance + phase fallback ===
  amputeeKick: [
    { id: 'foot_ball_closest', type: 'min_distance', from: { landmark: LM.RIGHT_ANKLE }, to: { source: 'ball' }, reversalPx: 0.02, phaseGuard: ['strike'] },
    { id: 'kick_phase',        type: 'phase_transition', from: 'windup', to: 'strike' },
  ],
  dribble: [
    { id: 'foot_ball_touch', type: 'min_distance', from: { landmark: LM.RIGHT_ANKLE }, to: { source: 'ball' }, reversalPx: 0.02 },
  ],

  // === Holds — capture at hold start ===
  plank:     [{ id: 'hold_start', type: 'phase_transition', from: 'idle', to: 'hold' }],
  wallsit:   [{ id: 'hold_start', type: 'phase_transition', from: 'idle', to: 'hold' }],
  sideplank: [{ id: 'hold_start', type: 'phase_transition', from: 'idle', to: 'hold' }],

  // === Wheelchair sports ===
  wheelchairShooting: [{ id: 'wc_shot',   type: 'max_angle', joint: 'rightElbow',    reversalDeg: 3, minROM: 0.10, fallbackOnPhaseChange: true }],
  wheelchairStroke:   [{ id: 'wc_stroke', type: 'max_angle', joint: 'rightShoulder', reversalDeg: 3, minROM: 0.10, fallbackOnPhaseChange: true }],

  // === Rehab — gentle thresholds ===
  rehabPendulum:   [{ id: 'pendulum',  type: 'max_angle', joint: 'rightShoulder', reversalDeg: 2, minROM: 0.05, fallbackOnPhaseChange: true }],
  rehabMiniSquat:  [{ id: 'mini_squat', type: 'min_angle', joint: 'rightKnee',    reversalDeg: 2, minROM: 0.05, fallbackOnPhaseChange: true }],
  rehabSitToStand: [{ id: 'stand_up',   type: 'max_angle', joint: 'rightKnee',    reversalDeg: 2, minROM: 0.05, fallbackOnPhaseChange: true }],

  // === Equipment-aware triggers ===
  crutchKick: [
    { id: 'crutch_stable_kick', type: 'equipment_angle', equipmentClass: 'crutch', reversalDeg: 3, phaseGuard: ['strike'] },
    { id: 'foot_ball_closest',  type: 'min_distance', from: { landmark: LM.RIGHT_ANKLE }, to: { source: 'ball' }, reversalPx: 0.02, phaseGuard: ['strike'] },
    { id: 'kick_phase',         type: 'phase_transition', from: 'windup', to: 'strike' },
  ],
  wheelchairShot: [
    { id: 'wrist_height',       type: 'min_y', landmark: LM.RIGHT_WRIST, reversalPx: 0.01 },
    { id: 'ball_wrist_release', type: 'max_distance', from: { landmark: LM.RIGHT_WRIST }, to: { source: 'equipment', class: 'ball', anchor: 'center' }, reversalPx: 0.02, phaseGuard: ['release'] },
  ],
  dumbbellCurl: [
    { id: 'curl_depth',         type: 'min_angle', joint: 'rightElbow', reversalDeg: 2, minROM: 0.15, fallbackOnPhaseChange: true },
    { id: 'dumbbell_shoulder',  type: 'equipment_proximity', equipmentClass: 'dumbbell', landmark: LM.RIGHT_SHOULDER, reversalPx: 0.02 },
  ],
  bandPullApart: [
    { id: 'wrist_spread',       type: 'max_distance', from: { landmark: LM.LEFT_WRIST }, to: { landmark: LM.RIGHT_WRIST }, reversalPx: 0.02, minROM: 0.10, fallbackOnPhaseChange: true },
  ],
  kettlebellSwing: [
    { id: 'hip_hinge',          type: 'min_angle', joint: 'rightHip', reversalDeg: 3, minROM: 0.15, fallbackOnPhaseChange: true },
    { id: 'kb_height',          type: 'min_y', landmark: LM.RIGHT_WRIST, reversalPx: 0.01 },
  ],
  medicineBallSlam: [
    { id: 'ball_overhead',      type: 'min_y', landmark: LM.RIGHT_WRIST, reversalPx: 0.01 },
    { id: 'slam_phase',         type: 'phase_transition', from: 'windup', to: 'strike' },
  ],
};

export function getPeakTriggers(cueKey) {
  return PEAK_TRIGGERS[cueKey] || [DEFAULT_TRIGGER];
}

import { useRef, useCallback, useState } from 'react';
import { SPORT_PROFILES } from '../utils/motionEngine';

// Segment length ratios relative to torso (shoulder-to-hip distance)
const SEG = {
  upperArm: 0.55,
  forearm: 0.50,
  thigh: 0.75,
  shin: 0.70,
  head: 0.25,
};

// Key landmark indices (matching usePose.js)
const LM = {
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_HIP: 23, RIGHT_HIP: 24,
};

/**
 * Forward kinematics: given a joint origin, angle, and segment length,
 * compute the endpoint position.
 * angle is in degrees from vertical (0 = straight down, 90 = horizontal right)
 */
function fk(origin, angleDeg, length) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return {
    x: origin.x + Math.cos(rad) * length,
    y: origin.y + Math.sin(rad) * length,
  };
}

/**
 * Interpolate between two angles using sine easing
 */
function sineInterp(a, b, t) {
  const s = (Math.sin((t - 0.5) * Math.PI) + 1) / 2;
  return a + (b - a) * s;
}

/**
 * Map cueKey to the targetMetrics key used in SPORT_PROFILES
 */
const CUE_TO_METRICS = {
  squat: 'squat',
  push: 'pushup',
  lunge: 'lunge',
  bicep: 'bicepCurl',
  shoulder: 'shoulderPress',
  plank: 'plank',
};

export function useGhostSkeleton() {
  const phaseRef = useRef(0);
  const directionRef = useRef(1); // 1 = forward, -1 = backward (ping-pong)
  const [enabled, setEnabled] = useState(false);

  const toggle = useCallback(() => {
    setEnabled(prev => !prev);
  }, []);

  const drawGhost = useCallback((ctx, sport, cueKey, userLandmarks, canvasWidth, canvasHeight) => {
    if (!enabled) return;

    // Get target metrics for this exercise
    const metricsKey = CUE_TO_METRICS[cueKey];
    if (!metricsKey) return; // no ghost for unsupported exercises

    const profile = SPORT_PROFILES[sport] || SPORT_PROFILES.fitness;
    const metrics = profile.targetMetrics[metricsKey];
    if (!metrics) return;

    // Advance animation phase (ping-pong 0→1→0)
    phaseRef.current += 0.02 * directionRef.current;
    if (phaseRef.current >= 1) { phaseRef.current = 1; directionRef.current = -1; }
    if (phaseRef.current <= 0) { phaseRef.current = 0; directionRef.current = 1; }
    const t = phaseRef.current;

    // Determine anchor point: use user's hip center if available, else canvas center
    let anchorX = canvasWidth * 0.5;
    let anchorY = canvasHeight * 0.55;
    let torsoLen = canvasHeight * 0.22;

    if (userLandmarks) {
      const lh = userLandmarks[LM.LEFT_HIP];
      const rh = userLandmarks[LM.RIGHT_HIP];
      const ls = userLandmarks[LM.LEFT_SHOULDER];
      const rs = userLandmarks[LM.RIGHT_SHOULDER];

      if (lh?.visibility > 0.3 && ls?.visibility > 0.3) {
        const hipX = (lh.x + (rh?.visibility > 0.3 ? rh.x : lh.x)) / 2;
        const hipY = (lh.y + (rh?.visibility > 0.3 ? rh.y : lh.y)) / 2;
        const shoulderX = (ls.x + (rs?.visibility > 0.3 ? rs.x : ls.x)) / 2;
        const shoulderY = (ls.y + (rs?.visibility > 0.3 ? rs.y : ls.y)) / 2;

        anchorX = hipX * canvasWidth + canvasWidth * 0.12; // offset right
        anchorY = hipY * canvasHeight;
        torsoLen = Math.abs(shoulderY - hipY) * canvasHeight;
        if (torsoLen < 30) torsoLen = canvasHeight * 0.22;
      }
    }

    // Calculate joint angles from metrics
    const kneeAngle = metrics.knee
      ? sineInterp(metrics.knee.max, metrics.knee.ideal, t)
      : 170;
    const hipAngle = metrics.hip
      ? sineInterp(metrics.hip.max, metrics.hip.ideal, t)
      : 170;
    const elbowAngle = metrics.elbow
      ? sineInterp(metrics.elbow.max, metrics.elbow.ideal, t)
      : 170;
    const shoulderAngle = metrics.shoulder
      ? sineInterp(metrics.shoulder.max, metrics.shoulder.ideal, t)
      : 20;

    // Compute positions using forward kinematics
    const hip = { x: anchorX, y: anchorY };

    // Torso: shoulder above hip
    // Map hip angle to torso tilt (standing exercises: mostly vertical)
    const torsoAngle = metricsKey === 'pushup' || metricsKey === 'plank'
      ? 5 // nearly horizontal for floor exercises
      : 180 - (hipAngle * 0.15); // slight forward lean for squats/lunges
    const shoulder = fk(hip, torsoAngle, torsoLen);

    // Head above shoulder
    const head = fk(shoulder, torsoAngle, torsoLen * SEG.head);

    // Arms from shoulder
    const armDir = metricsKey === 'shoulderPress' ? shoulderAngle + 90 : 250; // default: arms hanging
    const elbow = fk(shoulder, armDir, torsoLen * SEG.upperArm);
    const wrist = fk(elbow, armDir + (180 - elbowAngle), torsoLen * SEG.forearm);

    // Legs from hip
    const legDir = metricsKey === 'pushup' || metricsKey === 'plank'
      ? 360 - torsoAngle + 5 // legs extend behind for floor exercises
      : 270 + (180 - hipAngle) * 0.3; // slight forward bend
    const knee = fk(hip, legDir, torsoLen * SEG.thigh);
    const ankle = fk(knee, legDir + (180 - kneeAngle) * 0.5, torsoLen * SEG.shin);

    // Draw ghost
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#60A5FA';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    // Head circle
    ctx.beginPath();
    ctx.arc(head.x, head.y, torsoLen * SEG.head * 0.6, 0, Math.PI * 2);
    ctx.stroke();

    // Helper: draw line
    function line(a, b) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Torso
    line(shoulder, hip);

    // Arms (both sides, mirrored)
    line(shoulder, elbow);
    line(elbow, wrist);

    // Mirror arm
    const mirrorElbow = { x: shoulder.x - (elbow.x - shoulder.x), y: elbow.y };
    const mirrorWrist = { x: elbow.x - (wrist.x - elbow.x) + (shoulder.x - elbow.x) * 2, y: wrist.y };
    line(shoulder, mirrorElbow);
    line(mirrorElbow, mirrorWrist);

    // Legs (both sides, mirrored)
    line(hip, knee);
    line(knee, ankle);

    // Mirror leg
    const mirrorKnee = { x: hip.x - (knee.x - hip.x), y: knee.y };
    const mirrorAnkle = { x: knee.x - (ankle.x - knee.x) + (hip.x - knee.x) * 2, y: ankle.y };
    line(hip, mirrorKnee);
    line(mirrorKnee, mirrorAnkle);

    ctx.restore();
  }, [enabled]);

  return { drawGhost, toggle, isEnabled: enabled };
}

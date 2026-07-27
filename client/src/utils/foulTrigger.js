// === Local Hybrid Foul Trigger Filter ===
// Runs on-device at ~20fps. Only triggers a Claude VAR API call when
// multiple conditions are met simultaneously, saving API costs.
// The phone manages the game for FREE — Claude is VAR only.

const SPORT_THRESHOLDS = {
  football:            { bboxOverlap: 0.15, fallDelta: 0.12, cooldown: 8000, ignoreWheelchair: false },
  footballAmputee:     { bboxOverlap: 0.12, fallDelta: 0.18, cooldown: 8000, ignoreWheelchair: false },
  basketball:          { bboxOverlap: 0.20, fallDelta: 0.10, cooldown: 6000, ignoreWheelchair: false },
  basketballWheelchair: { bboxOverlap: 0.25, fallDelta: 0.25, cooldown: 8000, ignoreWheelchair: true },
};

// Landmark indices
const LM_WRIST_L = 15, LM_WRIST_R = 16;
const LM_ELBOW_L = 13, LM_ELBOW_R = 14;
const LM_SHOULDER_L = 11, LM_SHOULDER_R = 12;
const LM_HIP_L = 23, LM_HIP_R = 24;

export class FoulTriggerEngine {
  constructor(sport = 'football') {
    this.sport = sport;
    this.thresholds = SPORT_THRESHOLDS[sport] || SPORT_THRESHOLDS.football;
    this.lastTriggerTime = 0;

    // Per-player tracking state
    this.playerHistory = new Map(); // trackId → { centers: [{x,y,t}], lastContact: null }

    // Ring buffer for VAR frame capture (stores last 30 frame snapshots)
    this.frameBuffer = [];
    this.maxBufferSize = 30;

    // Contact tracking
    this.activeContacts = []; // [{ playerA, playerB, startTime, startFrame }]
  }

  /**
   * Push a frame snapshot into the ring buffer.
   * @param {string} frameBase64 - base64 JPEG of current frame
   */
  pushFrame(frameBase64) {
    this.frameBuffer.push({ data: frameBase64, timestamp: Date.now() });
    if (this.frameBuffer.length > this.maxBufferSize) {
      this.frameBuffer.shift();
    }
  }

  /**
   * Main update — call every frame during PLAYING phase.
   * @param {Array} trackedPlayers - from trackPlayers() with trackId, center, bbox, landmarks
   * @param {object} teamDetector - TeamDetector instance
   * @param {object|null} ballData - { x, y } from ball detection or null
   * @returns {{ trigger: boolean, reason: string, frames: Array, teamA: string, teamB: string } | null}
   */
  update(trackedPlayers, teamDetector, ballData) {
    const now = Date.now();

    // Update player history
    for (const player of trackedPlayers) {
      if (!this.playerHistory.has(player.trackId)) {
        this.playerHistory.set(player.trackId, { centers: [], lastContact: null });
      }
      const history = this.playerHistory.get(player.trackId);
      history.centers.push({ x: player.center.x, y: player.center.y, t: now });
      // Keep last 30 frames (~1.5s)
      if (history.centers.length > 30) history.centers.shift();
    }

    // Cooldown check
    if (now - this.lastTriggerTime < this.thresholds.cooldown) return null;

    // Check contact between rival players
    const contactResult = this._checkContact(trackedPlayers, teamDetector, now);
    if (contactResult) {
      this.lastTriggerTime = now;
      return contactResult;
    }

    // Check handball (football sports only)
    if ((this.sport === 'football' || this.sport === 'footballAmputee') && ballData) {
      const handballResult = this._checkHandball(trackedPlayers, teamDetector, ballData);
      if (handballResult) {
        this.lastTriggerTime = now;
        return handballResult;
      }
    }

    // Check crutch contact (amputee football only)
    if (this.sport === 'footballAmputee') {
      const crutchResult = this._checkCrutchContact(trackedPlayers, teamDetector, now);
      if (crutchResult) {
        this.lastTriggerTime = now;
        return crutchResult;
      }
    }

    return null;
  }

  /**
   * Check for contact + fall/stop between rival players.
   */
  _checkContact(players, teamDetector, now) {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const pA = players[i], pB = players[j];

        // Only check rivals (different teams)
        if (teamDetector?.isCalibrated()) {
          const teamA = teamDetector.getTeam(pA.trackId);
          const teamB = teamDetector.getTeam(pB.trackId);
          if (teamA && teamB && teamA === teamB) continue; // same team
        }

        // Check bbox overlap
        const overlap = bboxOverlap(pA.bbox, pB.bbox);
        if (overlap < this.thresholds.bboxOverlap) continue;

        // Contact detected — check for disruption within 500ms
        const fallA = this._checkFall(pA.trackId, now);
        const fallB = this._checkFall(pB.trackId, now);

        if (!fallA && !fallB) continue;
        const fallenPlayer = fallA ? pA : pB;

        // Ignore routine falls for wheelchair basketball
        if (this.thresholds.ignoreWheelchair) continue;

        // For amputee football: ignore if already in low stance (crutch-supported)
        if (this.sport === 'footballAmputee') {
          const preContactY = this._getPreContactY(fallenPlayer.trackId, now - 500);
          if (preContactY > 0.6) continue; // was already low — routine crutch stance
        }

        return {
          trigger: true,
          reason: 'contact_foul',
          reasonText: this.sport === 'footballAmputee'
            ? 'מגע פיזי חשוד בין שחקנים יריבים עם נפילה'
            : 'חשד לעבירה: מגע בין שחקנים עם נפילה',
          frames: this._getVARFrames(),
          playerA: teamDetector?.getTeam(pA.trackId) || '?',
          playerB: teamDetector?.getTeam(pB.trackId) || '?',
        };
      }
    }
    return null;
  }

  /**
   * Check if a player fell recently (center.y increased rapidly).
   */
  _checkFall(trackId, now) {
    const history = this.playerHistory.get(trackId);
    if (!history || history.centers.length < 5) return false;

    const recent = history.centers.slice(-5);
    const oldest = recent[0];
    const newest = recent[recent.length - 1];

    // Y increases = moving down in frame = falling
    const deltaY = newest.y - oldest.y;
    return deltaY > this.thresholds.fallDelta;
  }

  /**
   * Get a player's Y position at a specific time.
   */
  _getPreContactY(trackId, targetTime) {
    const history = this.playerHistory.get(trackId);
    if (!history || history.centers.length === 0) return 0.5;
    // Find closest center to targetTime
    let best = history.centers[0];
    for (const c of history.centers) {
      if (Math.abs(c.t - targetTime) < Math.abs(best.t - targetTime)) {
        best = c;
      }
    }
    return best.y;
  }

  /**
   * Check handball: ball position near wrist/elbow landmarks.
   */
  _checkHandball(players, teamDetector, ballData) {
    for (const player of players) {
      const lm = player.landmarks;
      if (!lm) continue;

      // Skip goalkeepers
      const team = teamDetector?.getTeam(player.trackId);
      if (team === 'GK_A' || team === 'GK_B') continue;

      // Check wrists and elbows
      const handPoints = [lm[LM_WRIST_L], lm[LM_WRIST_R], lm[LM_ELBOW_L], lm[LM_ELBOW_R]]
        .filter(p => p && p.visibility > 0.3);

      for (const hp of handPoints) {
        const dist = Math.hypot(hp.x - ballData.x, hp.y - ballData.y);
        if (dist < 0.05) {
          return {
            trigger: true,
            reason: 'handball',
            reasonText: 'חשד לנגיעת יד בכדור',
            frames: this._getVARFrames(),
            playerA: team || '?',
            playerB: null,
          };
        }
      }
    }
    return null;
  }

  /**
   * Check crutch-to-body contact (amputee football specific).
   */
  _checkCrutchContact(players, teamDetector, now) {
    for (let i = 0; i < players.length; i++) {
      for (let j = 0; j < players.length; j++) {
        if (i === j) continue;
        const attacker = players[i], victim = players[j];

        // Only check rivals
        if (teamDetector?.isCalibrated()) {
          const tA = teamDetector.getTeam(attacker.trackId);
          const tB = teamDetector.getTeam(victim.trackId);
          if (tA && tB && tA === tB) continue;
        }

        const aLm = attacker.landmarks;
        const vLm = victim.landmarks;
        if (!aLm || !vLm) continue;

        // Attacker's wrists near victim's torso
        const wrists = [aLm[LM_WRIST_L], aLm[LM_WRIST_R]].filter(w => w?.visibility > 0.3);
        const torso = [vLm[LM_SHOULDER_L], vLm[LM_SHOULDER_R], vLm[LM_HIP_L], vLm[LM_HIP_R]]
          .filter(t => t?.visibility > 0.3);

        let crutchHit = false;
        for (const w of wrists) {
          for (const t of torso) {
            if (Math.hypot(w.x - t.x, w.y - t.y) < 0.04) {
              crutchHit = true;
              break;
            }
          }
          if (crutchHit) break;
        }

        if (crutchHit && this._checkFall(victim.trackId, now)) {
          return {
            trigger: true,
            reason: 'crutch_contact',
            reasonText: 'חשד לשימוש בקב נגד שחקן יריב',
            frames: this._getVARFrames(),
            playerA: teamDetector?.getTeam(attacker.trackId) || '?',
            playerB: teamDetector?.getTeam(victim.trackId) || '?',
          };
        }
      }
    }
    return null;
  }

  /**
   * Get 3 frames for VAR: earliest in buffer, middle, and latest.
   */
  _getVARFrames() {
    if (this.frameBuffer.length === 0) return [];
    if (this.frameBuffer.length === 1) return [this.frameBuffer[0]];
    if (this.frameBuffer.length === 2) return [...this.frameBuffer];

    const first = this.frameBuffer[0];
    const mid = this.frameBuffer[Math.floor(this.frameBuffer.length / 2)];
    const last = this.frameBuffer[this.frameBuffer.length - 1];
    return [first, mid, last];
  }

  reset() {
    this.playerHistory.clear();
    this.frameBuffer = [];
    this.activeContacts = [];
    this.lastTriggerTime = 0;
  }
}

/**
 * Compute overlap ratio between two bounding boxes.
 * Returns 0.0 (no overlap) to 1.0 (full overlap).
 */
function bboxOverlap(a, b) {
  if (!a || !b) return 0;
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlapArea = overlapX * overlapY;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const minArea = Math.min(areaA, areaB);
  return minArea > 0 ? overlapArea / minArea : 0;
}

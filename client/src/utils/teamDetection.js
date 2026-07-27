// === Auto Team Detection via Jersey Color Clustering ===
// Samples torso pixel colors from video for each skeleton,
// clusters into 2 teams using k-means(k=2) on RGB.
// Detects goalkeepers and referees as color outliers.

const MIN_SAMPLES_PER_PLAYER = 5;
const MIN_PLAYERS_PER_TEAM = 2;

export class TeamDetector {
  constructor() {
    // playerSamples: Map<trackId, Array<{r,g,b}>>
    this.playerSamples = new Map();
    // Cluster results
    this.centerA = null; // { r, g, b }
    this.centerB = null;
    this.assignments = new Map(); // trackId → 'A' | 'B' | 'GK_A' | 'GK_B' | 'REF'
    this.calibrated = false;
    this._samplingCanvas = null;
    this._samplingCtx = null;
  }

  /**
   * Sample the average torso color for a player from the video element.
   * @param {HTMLVideoElement} videoEl
   * @param {Array} landmarks - 33 MediaPipe landmarks (normalized 0-1)
   * @param {number} canvasW - video width in pixels
   * @param {number} canvasH - video height in pixels
   * @returns {{ r, g, b } | null}
   */
  sampleTorsoColor(videoEl, landmarks, canvasW, canvasH) {
    if (!videoEl || videoEl.readyState < 2) return null;

    // Torso midpoint = average of shoulders (11,12) and hips (23,24)
    const points = [landmarks[11], landmarks[12], landmarks[23], landmarks[24]]
      .filter(p => p && p.visibility > 0.3);
    if (points.length < 2) return null;

    const midX = points.reduce((s, p) => s + p.x, 0) / points.length;
    const midY = points.reduce((s, p) => s + p.y, 0) / points.length;

    const px = Math.round(midX * canvasW);
    const py = Math.round(midY * canvasH);

    // Create/reuse sampling canvas
    if (!this._samplingCanvas) {
      this._samplingCanvas = document.createElement('canvas');
      this._samplingCtx = this._samplingCanvas.getContext('2d', { willReadFrequently: true });
    }

    // Draw a small region around the torso midpoint
    const sampleSize = 10; // 10x10 pixel sample
    this._samplingCanvas.width = sampleSize;
    this._samplingCanvas.height = sampleSize;

    try {
      const sx = Math.max(0, px - sampleSize / 2);
      const sy = Math.max(0, py - sampleSize / 2);
      this._samplingCtx.drawImage(videoEl, sx, sy, sampleSize, sampleSize, 0, 0, sampleSize, sampleSize);
      const imageData = this._samplingCtx.getImageData(0, 0, sampleSize, sampleSize);
      const data = imageData.data;

      let totalR = 0, totalG = 0, totalB = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        totalR += data[i];
        totalG += data[i + 1];
        totalB += data[i + 2];
        count++;
      }

      if (count === 0) return null;
      return {
        r: Math.round(totalR / count),
        g: Math.round(totalG / count),
        b: Math.round(totalB / count),
      };
    } catch {
      return null; // CORS or other canvas error
    }
  }

  /**
   * Add a color sample for a tracked player.
   */
  addSample(trackId, rgb) {
    if (!rgb) return;
    if (!this.playerSamples.has(trackId)) {
      this.playerSamples.set(trackId, []);
    }
    const samples = this.playerSamples.get(trackId);
    if (samples.length < 60) { // cap at 60 samples per player
      samples.push(rgb);
    }
  }

  /**
   * Run k-means(k=2) clustering on all player average colors.
   * Call this periodically (e.g., every 30 frames) during calibration.
   * @param {Function} goalZoneChecker - (center) => 'left'|'right'|null
   */
  classify(goalZoneChecker) {
    // Compute average color per player
    const playerAvgs = [];
    for (const [trackId, samples] of this.playerSamples) {
      if (samples.length < MIN_SAMPLES_PER_PLAYER) continue;
      const avg = {
        r: samples.reduce((s, c) => s + c.r, 0) / samples.length,
        g: samples.reduce((s, c) => s + c.g, 0) / samples.length,
        b: samples.reduce((s, c) => s + c.b, 0) / samples.length,
      };
      playerAvgs.push({ trackId, avg });
    }

    if (playerAvgs.length < 4) return; // need at least 4 players to cluster

    // k-means with k=2
    // Initialize centers: pick the two most distant colors
    let maxDist = 0;
    let c1 = playerAvgs[0].avg, c2 = playerAvgs[1].avg;
    for (let i = 0; i < playerAvgs.length; i++) {
      for (let j = i + 1; j < playerAvgs.length; j++) {
        const d = colorDist(playerAvgs[i].avg, playerAvgs[j].avg);
        if (d > maxDist) {
          maxDist = d;
          c1 = playerAvgs[i].avg;
          c2 = playerAvgs[j].avg;
        }
      }
    }

    // Run 10 iterations of k-means
    for (let iter = 0; iter < 10; iter++) {
      const group1 = [], group2 = [];
      for (const p of playerAvgs) {
        if (colorDist(p.avg, c1) < colorDist(p.avg, c2)) {
          group1.push(p);
        } else {
          group2.push(p);
        }
      }
      if (group1.length > 0) c1 = avgColor(group1.map(p => p.avg));
      if (group2.length > 0) c2 = avgColor(group2.map(p => p.avg));
    }

    this.centerA = c1;
    this.centerB = c2;

    // Assign teams
    const stdA = computeStdDev(playerAvgs.filter(p => colorDist(p.avg, c1) < colorDist(p.avg, c2)).map(p => p.avg), c1);
    const stdB = computeStdDev(playerAvgs.filter(p => colorDist(p.avg, c1) >= colorDist(p.avg, c2)).map(p => p.avg), c2);

    this.assignments.clear();
    let teamACount = 0, teamBCount = 0;

    for (const p of playerAvgs) {
      const distA = colorDist(p.avg, c1);
      const distB = colorDist(p.avg, c2);

      // Outlier check: if color is far from both clusters
      const isOutlierA = distA > (stdA || 50) * 2;
      const isOutlierB = distB > (stdB || 50) * 2;

      if (isOutlierA && isOutlierB) {
        // Could be GK or REF — use position context if available
        this.assignments.set(p.trackId, 'REF');
      } else if (distA < distB) {
        this.assignments.set(p.trackId, 'A');
        teamACount++;
      } else {
        this.assignments.set(p.trackId, 'B');
        teamBCount++;
      }
    }

    this.calibrated = teamACount >= MIN_PLAYERS_PER_TEAM && teamBCount >= MIN_PLAYERS_PER_TEAM;
  }

  /**
   * Get team assignment for a player.
   * @returns 'A' | 'B' | 'GK_A' | 'GK_B' | 'REF' | null
   */
  getTeam(trackId) {
    return this.assignments.get(trackId) || null;
  }

  isCalibrated() {
    return this.calibrated;
  }

  /**
   * Get team color for canvas drawing.
   */
  getTeamColor(trackId) {
    const team = this.getTeam(trackId);
    switch (team) {
      case 'A': return '#FF4444'; // red
      case 'B': return '#4444FF'; // blue
      case 'GK_A': return '#FF8888';
      case 'GK_B': return '#8888FF';
      case 'REF': return '#FFFF00'; // yellow
      default: return '#FFFFFF'; // unknown
    }
  }

  /**
   * Calibration progress (0.0 - 1.0).
   */
  getProgress() {
    if (this.playerSamples.size === 0) return 0;
    let totalReady = 0;
    for (const [, samples] of this.playerSamples) {
      if (samples.length >= MIN_SAMPLES_PER_PLAYER) totalReady++;
    }
    return Math.min(totalReady / 4, 1); // need at least 4 ready players
  }

  reset() {
    this.playerSamples.clear();
    this.assignments.clear();
    this.centerA = null;
    this.centerB = null;
    this.calibrated = false;
  }
}

function colorDist(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function avgColor(colors) {
  const n = colors.length;
  return {
    r: colors.reduce((s, c) => s + c.r, 0) / n,
    g: colors.reduce((s, c) => s + c.g, 0) / n,
    b: colors.reduce((s, c) => s + c.b, 0) / n,
  };
}

function computeStdDev(colors, center) {
  if (colors.length === 0) return 50;
  const variance = colors.reduce((s, c) => s + colorDist(c, center) ** 2, 0) / colors.length;
  return Math.sqrt(variance);
}

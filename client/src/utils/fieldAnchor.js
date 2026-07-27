// === Virtual Field Anchor Tracking ===
// Stabilizes field coordinates when camera pans/tilts by tracking
// the median movement of all detected player positions.
// No ML required — pure math offset accumulator.

// Sport-specific goal/basket zone definitions (normalized 0-1 coordinates)
const GOAL_ZONES = {
  football: {
    left:  { x: 0, y: 0.2, width: 0.08, height: 0.6 },
    right: { x: 0.92, y: 0.2, width: 0.08, height: 0.6 },
  },
  footballAmputee: {
    left:  { x: 0, y: 0.2, width: 0.08, height: 0.6 },
    right: { x: 0.92, y: 0.2, width: 0.08, height: 0.6 },
  },
  basketball: {
    left:  { x: 0, y: 0.05, width: 0.15, height: 0.4 },
    right: { x: 0.85, y: 0.05, width: 0.15, height: 0.4 },
  },
  basketballWheelchair: {
    left:  { x: 0, y: 0.05, width: 0.15, height: 0.4 },
    right: { x: 0.85, y: 0.05, width: 0.15, height: 0.4 },
  },
};

export class FieldAnchorTracker {
  constructor(sport = 'football') {
    this.sport = sport;
    this.offsetX = 0; // accumulated camera pan offset (normalized)
    this.offsetY = 0;
    this.prevCenters = []; // previous frame player centers
    this.initialized = false;
    this.smoothingFactor = 0.3; // EMA smoothing for offset updates
  }

  /**
   * Update tracker with current frame poses.
   * Computes camera pan by measuring median shift of all player centers.
   * @param {Array} poses - Array of { center: { x, y } } from useMultiPose
   */
  update(poses) {
    if (!poses || poses.length === 0) return;

    const currentCenters = poses.map(p => ({ x: p.center.x, y: p.center.y }));

    if (this.prevCenters.length > 0 && currentCenters.length >= 2) {
      // Match current centers to previous (nearest neighbor)
      const shifts = [];
      for (const curr of currentCenters) {
        let bestDist = Infinity;
        let bestShift = null;
        for (const prev of this.prevCenters) {
          const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
          if (dist < bestDist && dist < 0.2) { // max 20% movement = same player
            bestDist = dist;
            bestShift = { dx: curr.x - prev.x, dy: curr.y - prev.y };
          }
        }
        if (bestShift) shifts.push(bestShift);
      }

      if (shifts.length >= 2) {
        // Median shift = camera pan (if most players shift the same way, it's the camera)
        shifts.sort((a, b) => a.dx - b.dx);
        const medianDx = shifts[Math.floor(shifts.length / 2)].dx;
        shifts.sort((a, b) => a.dy - b.dy);
        const medianDy = shifts[Math.floor(shifts.length / 2)].dy;

        // Only count as camera pan if shift is consistent (low variance)
        const dxVariance = shifts.reduce((s, sh) => s + (sh.dx - medianDx) ** 2, 0) / shifts.length;
        if (dxVariance < 0.001) { // players are shifting uniformly → camera pan
          this.offsetX += medianDx * this.smoothingFactor;
          this.offsetY += medianDy * this.smoothingFactor;
        }
      }
    }

    this.prevCenters = currentCenters;
    this.initialized = true;
  }

  /**
   * Convert raw normalized coordinates to stabilized field coordinates.
   * Subtracts the accumulated camera offset.
   */
  toFieldCoords(x, y) {
    return {
      x: x - this.offsetX,
      y: y - this.offsetY,
    };
  }

  /**
   * Get goal/basket zones adjusted for camera offset.
   * Returns { left: {x,y,width,height}, right: {x,y,width,height} }
   */
  getGoalZones() {
    const zones = GOAL_ZONES[this.sport] || GOAL_ZONES.football;
    return {
      left: {
        x: zones.left.x - this.offsetX,
        y: zones.left.y - this.offsetY,
        width: zones.left.width,
        height: zones.left.height,
      },
      right: {
        x: zones.right.x - this.offsetX,
        y: zones.right.y - this.offsetY,
        width: zones.right.width,
        height: zones.right.height,
      },
    };
  }

  /**
   * Check if a point is inside a goal zone.
   * @returns 'left' | 'right' | null
   */
  isInGoalZone(x, y) {
    const zones = this.getGoalZones();
    const fx = x - this.offsetX;
    const fy = y - this.offsetY;
    if (fx >= zones.left.x && fx <= zones.left.x + zones.left.width &&
        fy >= zones.left.y && fy <= zones.left.y + zones.left.height) {
      return 'left';
    }
    if (fx >= zones.right.x && fx <= zones.right.x + zones.right.width &&
        fy >= zones.right.y && fy <= zones.right.y + zones.right.height) {
      return 'right';
    }
    return null;
  }

  reset() {
    this.offsetX = 0;
    this.offsetY = 0;
    this.prevCenters = [];
    this.initialized = false;
  }
}

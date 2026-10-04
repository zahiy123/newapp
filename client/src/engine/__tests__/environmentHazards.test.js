import { describe, it, expect } from 'vitest';
import { findObstacles, normalizeBox, obstacleMessage } from '../environmentHazards.js';

const W = 1280, H = 720;

/** Standing person in the middle of the frame (normalized landmarks). */
function standingPerson(cx = 0.5) {
  const lm = Array.from({ length: 33 }, () => ({ x: cx, y: 0.5, visibility: 0.95 }));
  const set = (i, x, y) => { lm[i] = { x, y, visibility: 0.95 }; };
  set(0, cx, 0.12);                                   // nose
  set(11, cx + 0.06, 0.25); set(12, cx - 0.06, 0.25); // shoulders
  set(15, cx + 0.08, 0.5); set(16, cx - 0.08, 0.5);   // wrists
  set(23, cx + 0.04, 0.5); set(24, cx - 0.04, 0.5);   // hips
  set(25, cx + 0.04, 0.7); set(26, cx - 0.04, 0.7);   // knees
  set(27, cx + 0.04, 0.9); set(28, cx - 0.04, 0.9);   // ankles
  return lm;
}

/** Person sitting: hips lower, knees forward at hip height. */
function seatedPerson(cx = 0.5) {
  const lm = standingPerson(cx);
  lm[23] = { x: cx + 0.04, y: 0.6, visibility: 0.95 };
  lm[24] = { x: cx - 0.04, y: 0.6, visibility: 0.95 };
  lm[25] = { x: cx + 0.08, y: 0.62, visibility: 0.95 };
  lm[26] = { x: cx - 0.08, y: 0.62, visibility: 0.95 };
  return lm;
}

/** MediaPipe-style detection with a PIXEL bounding box from normalized coords. */
function det(label, x0, y0, x1, y1, score = 0.7) {
  return { label, score, bbox: { originX: x0 * W, originY: y0 * H, width: (x1 - x0) * W, height: (y1 - y0) * H } };
}

/** The same detection seen in n frames. */
const seen = (d, n = 3) => Array.from({ length: n }, () => d);

describe('environmentHazards', () => {
  it('normalizes MediaPipe pixel boxes (originX/originY) — the old bug read x/y and got 0,0', () => {
    const b = normalizeBox({ originX: 640, originY: 360, width: 128, height: 72 }, W, H);
    expect(b.x0).toBeCloseTo(0.5); expect(b.y0).toBeCloseTo(0.5);
    expect(b.x1).toBeCloseTo(0.6); expect(b.y1).toBeCloseTo(0.6);
  });

  it('a chair right next to a standing person is an obstacle', () => {
    const chair = det('chair', 0.6, 0.55, 0.75, 0.92);
    const out = findObstacles(seen(chair), standingPerson(), { frameW: W, frameH: H });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: 'chair', kind: 'obstacle' });
  });

  it('a bag on the floor in front of the person is an obstacle', () => {
    const bag = det('backpack', 0.42, 0.85, 0.52, 0.98);
    const out = findObstacles(seen(bag), standingPerson(), { frameW: W, frameH: H });
    expect(out.map(o => o.label)).toEqual(['backpack']);
  });

  it('a chair far away at the side of the room is NOT an obstacle', () => {
    const farChair = det('chair', 0.9, 0.5, 0.99, 0.8);
    const out = findObstacles(seen(farChair), standingPerson(0.4), { frameW: W, frameH: H });
    expect(out).toEqual([]);
  });

  it('the chair the person is SITTING on is reported as a seat (with its own message)', () => {
    const seat = det('chair', 0.4, 0.5, 0.6, 0.9);
    const out = findObstacles(seen(seat), seatedPerson(), { frameW: W, frameH: H });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('seat');
    expect(obstacleMessage(out[0], true)).toContain('אתה יושב על כיסא');
  });

  it('a wheelchair / seated trainee: their seat is not an obstacle', () => {
    const seat = det('chair', 0.4, 0.5, 0.6, 0.9);
    const out = findObstacles(seen(seat), seatedPerson(), { frameW: W, frameH: H, seatedUser: true });
    expect(out).toEqual([]);
  });

  it('an object seen in only one frame is ignored (no flicker false alarms)', () => {
    const chair = det('chair', 0.6, 0.55, 0.75, 0.92);
    expect(findObstacles([chair], standingPerson(), { frameW: W, frameH: H })).toEqual([]);
  });

  it('a wider clearance (e.g. football) widens the zone', () => {
    // Person at the left third; the chair at 0.8-0.9 is beyond arm's reach (zone ends ≈ 0.77)
    const chair = det('chair', 0.8, 0.6, 0.9, 0.9);
    expect(findObstacles(seen(chair), standingPerson(0.3), { frameW: W, frameH: H, clearanceZone: 1 })).toEqual([]);
    expect(findObstacles(seen(chair), standingPerson(0.3), { frameW: W, frameH: H, clearanceZone: 3 })).toHaveLength(1);
  });

  it('person and non-obstacle labels are ignored', () => {
    const out = findObstacles([...seen(det('person', 0.4, 0.1, 0.6, 0.9)), ...seen(det('sports ball', 0.45, 0.85, 0.5, 0.9))],
      standingPerson(), { frameW: W, frameH: H });
    expect(out).toEqual([]);
  });

  it('no person visible → repeatedly seen obstacles are still reported', () => {
    const chair = det('chair', 0.6, 0.55, 0.75, 0.92);
    expect(findObstacles(seen(chair), null, { frameW: W, frameH: H })).toHaveLength(1);
  });
});

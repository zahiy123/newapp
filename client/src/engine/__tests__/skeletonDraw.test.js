import { describe, it, expect, vi } from 'vitest';
vi.mock('@mediapipe/tasks-vision', () => ({ PoseLandmarker: {}, FilesetResolver: {}, DrawingUtils: class {} }));
const { drawableSkeleton } = await import('../../hooks/usePose.js');

describe('the skeleton shows only what the camera really sees', () => {
  const conn = [{ start: 11, end: 13 }, { start: 13, end: 15 }, { start: 23, end: 25 }, { start: 25, end: 27 }];
  it('guessed joints outside the picture / low-confidence joints are not drawn, nor their lines', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    lm[11] = { x: 0.4, y: 0.3, visibility: 0.99 }; lm[13] = { x: 0.35, y: 0.45, visibility: 0.95 };
    lm[15] = { x: 0.3, y: 0.6, visibility: 0.3 };             // unsure
    lm[23] = { x: 0.45, y: 0.9, visibility: 0.9 }; lm[25] = { x: 0.46, y: 1.4, visibility: 0.8 };   // a guessed knee below the frame
    const sk = drawableSkeleton(lm, conn);
    expect(sk.points.length).toBe(3);                           // 11, 13, 23
    expect(sk.connections).toEqual([{ start: 11, end: 13 }]);
  });
  it('an anatomically impossible line (a guessed joint) is never drawn', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    const set = (i, x, y) => { lm[i] = { x, y, visibility: 0.95 }; };
    set(11, 0.45, 0.3); set(12, 0.55, 0.3); set(23, 0.46, 0.5); set(24, 0.54, 0.5);   // torso 0.2
    set(13, 0.42, 0.42);                                     // a real upper arm (0.12)
    set(15, 0.05, 0.98);                                     // a "forearm" across the whole screen
    const sk = drawableSkeleton(lm, [{ start: 11, end: 13 }, { start: 13, end: 15 }]);
    expect(sk.connections).toEqual([{ start: 11, end: 13 }]);
  });
  it('the amputated side stays hidden', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
    expect(drawableSkeleton(lm, conn, new Set([25, 27])).connections).toEqual([{ start: 11, end: 13 }, { start: 13, end: 15 }]);
  });
});

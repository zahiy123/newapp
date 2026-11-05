import { describe, it, expect } from 'vitest';
import { decodeRfdetr, rfdetrInput, isRfdetr } from '../rfdetrDecode.js';

describe('RF-DETR output decoding', () => {
  it('knows an RF-DETR export by its outputs', () => {
    expect(isRfdetr(['dets', 'labels'])).toBe(true);
    expect(isRfdetr(['output0'])).toBe(false);
  });
  it('sigmoid scores, the best class per query, the threshold, best first; the extra column ignored', () => {
    // 3 queries × 4 logit columns (3 classes + 1 unused)
    const labels = new Float32Array([
      -5, 3, -5, -5,      // q0 → class 1, score ≈ 0.95
      -5, -5, -5, 6,      // q1 → the unused column → dropped
      0.2, -5, -5, -5,    // q2 → class 0, score ≈ 0.55
    ]);
    const dets = new Float32Array([0.5, 0.5, 0.1, 0.2, 0.1, 0.1, 0.1, 0.1, 0.3, 0.4, 0.05, 0.05]);
    const r = decodeRfdetr(dets, labels, { queries: 3, numClasses: 3, threshold: 0.5 });
    expect(r.map(d => d.classId)).toEqual([1, 0]);
    expect(r[0].score).toBeCloseTo(0.953, 2);
    for (const [k, v] of Object.entries({ x: 0.5, y: 0.5, w: 0.1, h: 0.2 })) expect(r[0][k]).toBeCloseTo(v, 5);
    expect(decodeRfdetr(dets, labels, { queries: 3, numClasses: 3, threshold: 0.9 })).toHaveLength(1);
  });
  it('the ImageNet-normalised CHW input', () => {
    const px = new Uint8ClampedArray([255, 0, 128, 255]);
    const x = rfdetrInput(px, 1);
    expect(x[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
    expect(x[1]).toBeCloseTo((0 - 0.456) / 0.224, 4);
    expect(x[2]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 4);
  });
});

// ============================================================
// rfdetrDecode — the RF-DETR (Apache 2.0) ONNX output → detections (Stage 5, the owner's licence decision 2026-11-04)
//
// PURE. An RF-DETR export has ONE input (1×3×R×R, ImageNet-normalised RGB) and two outputs:
//   dets   [1, Q, 4]   boxes as (cx, cy, w, h), normalised 0–1
//   labels [1, Q, C+1] class LOGITS (sigmoid → a score per class; the last column is unused)
// No NMS is needed (a DETR predicts each object once). The old YOLO decoder stays for the old model.
// ============================================================

export const IMAGENET_MEAN = [0.485, 0.456, 0.406];
export const IMAGENET_STD = [0.229, 0.224, 0.225];

/** Is this session an RF-DETR export (by its output names)? */
export const isRfdetr = (outputNames = []) => outputNames.includes('dets') && outputNames.includes('labels');

/** RGBA pixels (canvas ImageData.data) → the CHW float input RF-DETR expects. */
export function rfdetrInput(rgba, size) {
  const area = size * size;
  const out = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    out[i] = (rgba[i * 4] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    out[area + i] = (rgba[i * 4 + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    out[2 * area + i] = (rgba[i * 4 + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  return out;
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * dets / labels (flat Float32Arrays) → [{ classId, score, x, y, w, h }] (x, y = the box CENTRE, normalised),
 * best first. numClasses = the real classes (the labels' extra column is ignored); classOffset maps the
 * logit index to the class id (0 when the training kept the dataset's ids).
 */
export function decodeRfdetr(dets, labels, { queries, numClasses, threshold = 0.4, classOffset = 0 }) {
  const width = labels.length / queries;
  const out = [];
  for (let q = 0; q < queries; q++) {
    let best = -1; let bestLogit = -Infinity;
    for (let c = 0; c < width; c++) {
      const v = labels[q * width + c];
      if (v > bestLogit) { bestLogit = v; best = c; }
    }
    const classId = best - classOffset;
    if (classId < 0 || classId >= numClasses) continue;
    const score = sigmoid(bestLogit);
    if (score < threshold) continue;
    out.push({ classId, score, x: dets[q * 4], y: dets[q * 4 + 1], w: dets[q * 4 + 2], h: dets[q * 4 + 3] });
  }
  return out.sort((a, b) => b.score - a.score);
}

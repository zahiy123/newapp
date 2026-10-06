// ============================================================
// MediaPipe assets — served from OUR origin (client/public/mediapipe), never from a CDN.
//
// Why: the first launch of the day used to fetch the Wasm runtime from jsDelivr (@latest —
// not even the installed version) and the models from storage.googleapis.com: slow, with
// QUIC protocol errors and "fallback to ArrayBuffer". Local, same-origin, VERSIONED paths:
//   • served with application/wasm → streaming compilation, no ArrayBuffer fallback
//   • the version / model revision is in the path → cached as immutable for a year
//     (client/vercel.json headers), so every later launch loads from the disk cache
//   • the Wasm always matches the installed @mediapipe/tasks-vision JS API
//
// Updating MediaPipe: bump the exact version in package.json, run `npm run sync:mediapipe`
// (copies the Wasm into public/mediapipe/<version>/wasm), and update MEDIAPIPE_VERSION.
// A test checks that the version, the installed package and the public folder match.
// ============================================================

export const MEDIAPIPE_VERSION = '0.10.32';

/** Folder with the vision Wasm runtime (FilesetResolver.forVisionTasks). */
export const MEDIAPIPE_WASM_PATH = `/mediapipe/${MEDIAPIPE_VERSION}/wasm`;

/** Model files (the original model revision is part of each file name). */
export const MEDIAPIPE_MODELS = Object.freeze({
  poseLite: '/mediapipe/models/pose_landmarker_lite_f16_v1.task',
  poseFull: '/mediapipe/models/pose_landmarker_full_f16_v1.task',
  objectDetector: '/mediapipe/models/efficientdet_lite0_int8_v1.tflite',
});

/**
 * Warm the HTTP cache in the background right after the app opens (idle time), so the
 * training screen finds the runtime + pose model already on disk. Runs once per page load;
 * failures are ignored (the hooks load the same URLs normally).
 */
let prewarmed = false;
export function prewarmMediapipe() {
  if (prewarmed || typeof window === 'undefined' || typeof fetch !== 'function') return;
  prewarmed = true;
  const run = async () => {
    try {
      // The same SIMD check MediaPipe uses to pick its runtime → warm exactly the file it will load
      const { FilesetResolver } = await import('@mediapipe/tasks-vision');
      const runtime = (await FilesetResolver.isSimdSupported()) ? 'vision_wasm_internal' : 'vision_wasm_nosimd_internal';
      const urls = [`${MEDIAPIPE_WASM_PATH}/${runtime}.js`, `${MEDIAPIPE_WASM_PATH}/${runtime}.wasm`, MEDIAPIPE_MODELS.poseLite];
      await Promise.all(urls.map(u => fetch(u).then(r => r.arrayBuffer()).catch(() => {})));
    } catch { /* best effort */ }
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(() => { run(); }, { timeout: 4000 });
  else setTimeout(run, 1500);
}

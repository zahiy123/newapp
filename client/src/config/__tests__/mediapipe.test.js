import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MEDIAPIPE_VERSION, MEDIAPIPE_WASM_PATH, MEDIAPIPE_MODELS } from '../mediapipe.js';

const root = join(__dirname, '..', '..', '..');          // client/
const pub = (url) => join(root, 'public', ...url.split('/').filter(Boolean));

describe('MediaPipe assets are local, versioned and in sync', () => {
  it('the configured version = the installed package = the pinned dependency', () => {
    const installed = JSON.parse(readFileSync(join(root, 'node_modules/@mediapipe/tasks-vision/package.json'), 'utf8')).version;
    const pinned = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies['@mediapipe/tasks-vision'];
    expect(installed).toBe(MEDIAPIPE_VERSION);
    expect(pinned).toBe(MEDIAPIPE_VERSION);            // exact pin: the Wasm can never drift from the JS API
  });

  it('the Wasm runtime (SIMD + no-SIMD) is in public/ and identical to the installed one', () => {
    for (const f of readdirSync(join(root, 'node_modules/@mediapipe/tasks-vision/wasm'))) {
      const local = pub(`${MEDIAPIPE_WASM_PATH}/${f}`);
      expect(existsSync(local), f).toBe(true);
      expect(statSync(local).size, f).toBe(statSync(join(root, 'node_modules/@mediapipe/tasks-vision/wasm', f)).size);
    }
  });

  it('every model file is in public/', () => {
    for (const url of Object.values(MEDIAPIPE_MODELS)) {
      expect(existsSync(pub(url)), url).toBe(true);
      expect(statSync(pub(url)).size, url).toBeGreaterThan(1_000_000);
    }
  });

  it('no code loads MediaPipe from a CDN anymore', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { if (f !== '__tests__') walk(p); continue; }
        if (!/\.(js|jsx)$/.test(f) || p.includes(join('config', 'mediapipe.js'))) continue;
        const s = readFileSync(p, 'utf8');
        if (/cdn\.jsdelivr\.net\/npm\/@mediapipe|storage\.googleapis\.com\/mediapipe-models/.test(s)) offenders.push(p);
      }
    };
    walk(join(root, 'src'));
    expect(offenders).toEqual([]);
  });

  it('versioned assets are cached as immutable by Vercel', () => {
    const v = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
    const h = v.headers.find(x => x.source === '/mediapipe/(.*)');
    expect(h.headers.find(x => x.key === 'Cache-Control').value).toContain('immutable');
  });
});

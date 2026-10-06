// Copies the installed @mediapipe/tasks-vision Wasm runtime into public/mediapipe/<version>/wasm
// (served locally and cached as immutable). Run after changing the MediaPipe version:
//   npm run sync:mediapipe   — then set MEDIAPIPE_VERSION in src/config/mediapipe.js
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const dest = join(root, 'public', 'mediapipe', version, 'wasm');
if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
for (const f of readdirSync(join(pkgDir, 'wasm'))) cpSync(join(pkgDir, 'wasm', f), join(dest, f));
console.log(`MediaPipe ${version} Wasm → public/mediapipe/${version}/wasm`);

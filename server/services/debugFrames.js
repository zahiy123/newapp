import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = path.join(__dirname, '..', 'debug_frames');

// Ensure debug directory exists on module load
try {
  if (!fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    console.log(`[DEBUG_VISION] Created debug_frames directory: ${DEBUG_DIR}`);
  }
} catch (e) {
  console.warn('[DEBUG_VISION] Could not pre-create directory:', e.message);
}

export async function saveDebugFrames(frames, exercise, playerName, repNumber) {
  try {
    // Double-check directory exists (in case it was deleted mid-session)
    if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

    const timestamp = Date.now();
    const safeName = (playerName || 'unknown').replace(/[^a-zA-Z0-9\u0590-\u05FF_-]/g, '_');
    const safeExercise = (exercise || 'unknown').replace(/[^a-zA-Z0-9\u0590-\u05FF_-]/g, '_');
    const prefix = `${safeName}_${safeExercise}_rep${repNumber}_${timestamp}`;

    const savedFiles = [];
    frames.forEach((frame, i) => {
      const filename = `${prefix}_f${i + 1}.jpg`;
      const filepath = path.join(DEBUG_DIR, filename);
      fs.writeFileSync(filepath, Buffer.from(frame, 'base64'));
      savedFiles.push(filename);
    });

    console.log(`[DEBUG_VISION] Saved ${savedFiles.length} frames → ${DEBUG_DIR}`);
    savedFiles.forEach(f => console.log(`  → ${f}`));

    return { saved: savedFiles.length, dir: DEBUG_DIR, files: savedFiles };
  } catch (err) {
    console.warn('[DEBUG_VISION] Frame save error:', err.message);
    return { saved: 0, error: err.message };
  }
}

// Utility: list all saved debug frames
export function listDebugFrames() {
  try {
    if (!fs.existsSync(DEBUG_DIR)) return [];
    return fs.readdirSync(DEBUG_DIR).filter(f => f.endsWith('.jpg')).sort();
  } catch {
    return [];
  }
}

// Utility: count frames per exercise
export function getDebugStats() {
  const files = listDebugFrames();
  const stats = {};
  for (const file of files) {
    // Format: name_exercise_repN_timestamp_fN.jpg
    const parts = file.split('_rep');
    const exerciseKey = parts[0] || 'unknown';
    stats[exerciseKey] = (stats[exerciseKey] || 0) + 1;
  }
  return { totalFrames: files.length, byExercise: stats, dir: DEBUG_DIR };
}

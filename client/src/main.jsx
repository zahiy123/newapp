// ---- Console Sanitizer: suppress noisy MediaPipe/AudioContext warnings ----
// These messages come from browser internals or WASM and don't affect performance.
{
  const SUPPRESSED_PATTERNS = [
    'OpenGL error checking is disabled',
    'gl_context.cc',
    'NORM_RECT without IMAGE_DIMENSIONS',
    'Graph successfully started running',
    'AudioContext encountered an error',
    'the WebAudio renderer',
    'Download the React DevTools',
  ];
  const matchesSuppressed = (args) =>
    args.some(a => typeof a === 'string' && SUPPRESSED_PATTERNS.some(p => a.includes(p)));

  const _origWarn = console.warn;
  console.warn = (...args) => {
    if (matchesSuppressed(args)) return;
    _origWarn.apply(console, args);
  };
  const _origLog = console.log;
  console.log = (...args) => {
    if (matchesSuppressed(args)) return;
    _origLog.apply(console, args);
  };
  const _origError = console.error;
  console.error = (...args) => {
    if (matchesSuppressed(args)) return;
    _origError.apply(console, args);
  };
}

import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { prewarmMediapipe } from './config/mediapipe'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Load the MediaPipe runtime + pose model into the browser cache while the app is idle,
// so the training screen starts instantly (local, immutable-cached assets)
prewarmMediapipe()

// WAKE THE AI COACH'S SERVER at once (owner, 2026-10-25: a sleeping server took 33 s — the first briefing fell back);
// while the app is open it is pinged every 10 min so it never falls asleep mid-session
{
  const base = import.meta.env.VITE_API_URL || 'https://newapp-nujg.onrender.com';
  const ping = () => { try { fetch(`${base}/api/health`).catch(() => {}); fetch(`${base}/api/coach/warm`).catch(() => {}); } catch { /* offline */ } };
  ping();
  setInterval(ping, 10 * 60 * 1000);
}

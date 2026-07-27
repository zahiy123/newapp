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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

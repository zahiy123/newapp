// VITE_API_URL is set in:
//   .env.local  → http://localhost:3001  (dev, gitignored)
//   .env        → https://newapp-nujg.onrender.com  (production fallback)
// Vite's dev proxy in vite.config.js also forwards /api to localhost:3001.
const API_BASE = import.meta.env.VITE_API_URL || 'https://newapp-nujg.onrender.com';

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

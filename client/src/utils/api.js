import { auth } from '../services/firebase';

// VITE_API_URL is set in:
//   .env.local  → http://localhost:3001  (dev, gitignored)
//   .env        → https://newapp-nujg.onrender.com  (production fallback)
// Vite's dev proxy in vite.config.js also forwards /api to localhost:3001.
const API_BASE = import.meta.env.VITE_API_URL || 'https://newapp-nujg.onrender.com';

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

/**
 * Get auth headers with Firebase ID token (if user is logged in).
 * Merges with any existing headers object.
 */
export async function getAuthHeaders(extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  try {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {
    // If token fetch fails, proceed without auth header
  }
  return headers;
}

/**
 * Authenticated fetch — automatically attaches Firebase ID token.
 * Drop-in replacement for fetch() in API calls.
 */
export async function authFetch(url, options = {}) {
  const headers = await getAuthHeaders(options.headers);
  return fetch(url, { ...options, headers });
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = await getAuthHeaders(options.headers);
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

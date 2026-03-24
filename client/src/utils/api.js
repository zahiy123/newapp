const API_BASE = import.meta.env.VITE_API_URL || 'https://newapp-nujg.onrender.com';

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

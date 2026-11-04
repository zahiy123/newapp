// The physiotherapist portal's API (server/routes/clinic.js). Every call carries the login token; the server
// checks every permission (zero trust) — this file only calls and translates the errors for the screen.
import { apiUrl, authFetch } from './api';

export async function clinic(method, path, body) {
  try {
    const res = await authFetch(apiUrl(`/api/clinic${path}`), { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data?.error || `http_${res.status}`) };
  } catch {
    return { ok: false, status: 0, data: null, error: 'network' };
  }
}

const ERR_HE = {
  auth_not_configured: 'הפורטל עדיין לא מאובטח בשרת — הוא ייפתח אחרי חיבור מפתח הניהול',
  not_admin: 'אין הרשאת מנהל',
  not_clinician: 'החשבון הזה לא מאושר כמטפל',
  clinician_not_active: 'החשבון הזה לא מאושר כמטפל',
  invite_invalid: 'הקוד לא תקין או שפג תוקפו — בקש מהמטפל קוד חדש',
  consent_required: 'צריך לאשר את השיתוף כדי להתחבר',
  already_linked: 'אתה כבר מחובר למטפל — נתק קודם את החיבור הקיים',
  clinician_cannot_link: 'חשבון מטפל לא יכול להתחבר כמטופל',
  self_link: 'אי אפשר להתחבר לעצמך',
  linked_as_trainee: 'החשבון הזה מחובר כמטופל — מטפל צריך חשבון נפרד',
  name_required: 'יש להזין שם מלא',
  no_active_assignment: 'אין חיבור פעיל עם המטופל הזה',
  too_many: 'יותר מדי ניסיונות — נסה שוב בעוד כמה דקות',
  network: 'אין חיבור לשרת — בדוק את האינטרנט ונסה שוב',
};
const ERR_EN = {
  auth_not_configured: 'The portal is not secured on the server yet — it opens once the admin key is connected',
  invite_invalid: 'The code is invalid or expired — ask your clinician for a new one',
  already_linked: 'You are already linked to a clinician — unlink first',
  network: 'No connection to the server — check the internet and try again',
};
export const clinicError = (code, isHe = true) => (isHe ? ERR_HE[code] : ERR_EN[code] || ERR_HE[code]) || (isHe ? 'משהו השתבש — נסה שוב' : 'Something went wrong — try again');

export const getLoginAs = () => { try { return localStorage.getItem('loginAs') || 'trainee'; } catch { return 'trainee'; } };
export const setLoginAs = (v) => { try { localStorage.setItem('loginAs', v); } catch { /* storage unavailable */ } };

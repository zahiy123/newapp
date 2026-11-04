// The physiotherapist portal's API (Stage 4B). Mounted behind requireAuthStrict: every request carries a
// VERIFIED token; every rule is checked in services/clinic.js (zero trust — the client is never trusted).
import { Router } from 'express';
import { createClinic, ClinicError } from '../services/clinic.js';
import { adminDb, adminAuth } from '../services/firebaseAdmin.js';

const router = Router();
let clinic = null;
const get = () => (clinic ||= createClinic({ db: adminDb(), auth: adminAuth() }));
const userOf = (req) => ({ uid: req.uid, email: req.userEmail || '', role: req.userRole || null });

// a small flood guard for the code endpoints (guessing invite codes)
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(get(), userOf(req), req));
  } catch (err) {
    if (err instanceof ClinicError) return res.status(err.status).json({ error: err.code });
    console.error('[Clinic]', req.path, err.message);
    res.status(500).json({ error: 'server_error' });
  }
};

router.get('/me', handle((c, u) => c.me(u)));
router.post('/request', handle((c, u, req) => c.requestClinician(u, req.body || {})));
router.get('/admin', handle((c, u) => c.adminList(u)));
router.post('/admin/approve', handle((c, u, req) => c.adminApprove(u, String(req.body?.uid || ''))));
router.post('/admin/reject', handle((c, u, req) => c.adminReject(u, String(req.body?.uid || ''))));
router.post('/admin/revoke', handle((c, u, req) => c.adminRevoke(u, String(req.body?.uid || ''))));
router.post('/invites', handle((c, u) => c.createInvite(u)));
router.get('/invites/:code', (req, res, next) => (limited(`peek-${req.uid}`, 10, 600000) ? res.status(429).json({ error: 'too_many' }) : next()),
  handle((c, u, req) => c.peekInvite(u, req.params.code)));
router.post('/link', (req, res, next) => (limited(`link-${req.uid}`, 10, 600000) ? res.status(429).json({ error: 'too_many' }) : next()),
  handle((c, u, req) => c.link(u, req.body?.code, req.body?.consent)));
router.post('/unlink', handle((c, u) => c.unlink(u)));
router.post('/end', handle((c, u, req) => c.endPatient(u, String(req.body?.traineeId || ''))));
router.get('/patients', handle((c, u) => c.patients(u)));
router.get('/patients/:id', handle((c, u, req) => c.patientData(u, String(req.params.id || ''))));
router.put('/patients/:id/plan', handle((c, u, req) => c.setPlan(u, String(req.params.id || ''), req.body || {})));
router.put('/patients/:id/limits', handle((c, u, req) => c.setLimits(u, String(req.params.id || ''), req.body || {})));
router.post('/patients/:id/unlock', handle((c, u, req) => c.unlock(u, String(req.params.id || ''), req.body || {})));
router.post('/lock', (req, res, next) => (limited(`lock-${req.uid}`, 20, 600000) ? res.status(429).json({ error: 'too_many' }) : next()),
  handle((c, u, req) => c.lockSelf(u, req.body || {})));
router.get('/my-audit', handle((c, u) => c.myAudit(u)));

export default router;

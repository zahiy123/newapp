// ============================================================
// clinic — the physiotherapist portal's access layer (Stage 4B, steps 0–1; built 2026-11-04)
//
// ZERO TRUST: every clinician action is checked HERE, on the server, on every request:
//   • the verified Firebase token (never a client claim);
//   • the role: a clinician = the token's custom claim role:'clinician' AND an ACTIVE clinicians/{uid} record
//     (a revoked clinician loses access at once, even with an old token);
//   • the pair: a clinician touches a trainee's data only with an ACTIVE assignment for that exact pair;
//   • every clinician read / write of trainee data → auditLog (who, what, when) — the trainee can see it.
// The role is granted ONLY by an admin (ADMIN_EMAILS on the server). A trainee links only by an invite code
// from the clinician + explicit consent, and can unlink at any time.
// Server-only collections (the Firestore rules deny every client): clinicianRequests, clinicians, invites,
// assignments, auditLog.
// The storage / auth are injected (db, auth) — the logic is tested with an in-memory store.
// ============================================================

import { patientFlags } from './clinicFlags.js';

export class ClinicError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

export const INVITE_TTL_MS = 7 * 864e5;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';     // no 0/O, 1/I/L

export function adminEmails(env = process.env) {
  return String(env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
export const isAdminEmail = (email, env) => !!email && adminEmails(env).includes(String(email).toLowerCase());

export function makeInviteCode(rand = Math.random) {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return c;
}
export const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
export const inviteUsable = (inv, now) => !!inv && !inv.usedBy && Number(inv.expiresAt) > now;
export const assignmentId = (clinicianId, traineeId) => `${clinicianId}_${traineeId}`;

// THE CLINICAL LIMITS (step 4) — validated here: only known joints, sane numbers, short lists
export const LIMIT_JOINTS = ['left_knee', 'right_knee', 'left_hip', 'right_hip', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow'];
export function cleanLimits(body = {}) {
  const romLimits = {};
  for (const [k, v] of Object.entries(body.romLimits || {})) {
    const n = Math.round(Number(v));
    if (!LIMIT_JOINTS.includes(k)) throw new ClinicError(400, 'bad_joint');
    if (!(n >= 5 && n <= 180)) throw new ClinicError(400, 'bad_limit');
    romLimits[k] = n;
  }
  const blockedJoints = [...new Set(body.blockedJoints || [])];
  if (blockedJoints.some(k => !LIMIT_JOINTS.includes(k))) throw new ClinicError(400, 'bad_joint');
  const blockedPatterns = [...new Set((body.blockedPatterns || []).map(x => String(x).slice(0, 40)))].slice(0, 60);
  if (blockedPatterns.some(x => !/^[A-Za-z0-9_]+$/.test(x))) throw new ClinicError(400, 'bad_pattern');
  const exp = body.expiresAt == null || body.expiresAt === '' ? null : Number(body.expiresAt);
  if (exp != null && !(exp > 0)) throw new ClinicError(400, 'bad_expiry');
  return { romLimits, blockedJoints, blockedPatterns, expiresAt: exp, note: String(body.note || '').slice(0, 300) };
}

/**
 * The portal's operations. `user` = { uid, email, role } from the VERIFIED token.
 * db: get(path) · set(path, data) · update(path, data) · add(collection, data) → id · where(collection, field, value) → [{id, ...}]
 *     · list(collection, { orderBy, limit }) → [{id, ...}] newest first (Firestore timestamps as milliseconds)
 * auth: setClaims(uid, claims)
 */
export function createClinic({ db, auth, env = process.env, now = () => Date.now(), rand = Math.random }) {
  const audit = (entry) => db.add('auditLog', { ...entry, at: now() });

  const requireAdmin = (user) => {
    if (!isAdminEmail(user?.email, env)) throw new ClinicError(403, 'not_admin');
  };
  const requireClinician = async (user) => {
    if (user?.role !== 'clinician') throw new ClinicError(403, 'not_clinician');
    const rec = await db.get(`clinicians/${user.uid}`);
    if (!rec?.active) throw new ClinicError(403, 'clinician_not_active');
    return rec;
  };
  const activeAssignmentOf = async (traineeId) => (await db.where('assignments', 'traineeId', traineeId)).find(a => a.status === 'active') || null;

  /** THE gate of every clinician access to a trainee's data (used by every later portal endpoint). */
  async function assertAccess(user, traineeId, action) {
    await requireClinician(user);
    const a = await db.get(`assignments/${assignmentId(user.uid, traineeId)}`);
    if (a?.status !== 'active') throw new ClinicError(403, 'no_active_assignment');
    await audit({ actorId: user.uid, actorRole: 'clinician', traineeId, action });
    return a;
  }

  return {
    assertAccess,

    /** Who am I to the portal (the client shows the right screens; the server still checks everything). */
    async me(user) {
      const isAdmin = isAdminEmail(user.email, env);
      const clin = await db.get(`clinicians/${user.uid}`);
      const req = await db.get(`clinicianRequests/${user.uid}`);
      const clinician = user.role === 'clinician' && clin?.active;
      let myClinician = null;
      // (an admin may be BOTH — their own clinician for tests / management, owner 2026-11-04)
      if (!clinician || isAdmin) {
        const a = await activeAssignmentOf(user.uid);
        if (a) { const c = await db.get(`clinicians/${a.clinicianId}`); myClinician = { id: a.clinicianId, name: c?.name || '', since: a.linkedAt }; }
      }
      return {
        isAdmin, role: clinician ? 'clinician' : 'trainee',
        clinicianStatus: clinician ? 'active' : req?.status === 'pending' ? 'pending' : (clin && !clin.active) ? 'revoked' : null,
        myClinician,
      };
    },

    /** A therapist registers in the clinician login → a request the admin approves. */
    async requestClinician(user, { name, licenseNo = '', phone = '' } = {}) {
      const n = String(name || '').trim().slice(0, 60);
      if (n.length < 2) throw new ClinicError(400, 'name_required');
      if (!isAdminEmail(user.email, env) && await activeAssignmentOf(user.uid)) throw new ClinicError(409, 'linked_as_trainee');
      await db.set(`clinicianRequests/${user.uid}`, { uid: user.uid, email: user.email || '', name: n, licenseNo: String(licenseNo).slice(0, 30), phone: String(phone).slice(0, 20), status: 'pending', at: now() });
      return { status: 'pending' };
    },

    async adminList(user) {
      requireAdmin(user);
      return {
        requests: (await db.where('clinicianRequests', 'status', 'pending')),
        clinicians: (await db.where('clinicians', 'active', true)),
      };
    },

    async adminApprove(user, uid) {
      requireAdmin(user);
      const req = await db.get(`clinicianRequests/${uid}`);
      if (!req) throw new ClinicError(404, 'no_request');
      await auth.setClaims(uid, { role: 'clinician' });
      await db.set(`clinicians/${uid}`, { uid, email: req.email, name: req.name, licenseNo: req.licenseNo || '', active: true, approvedBy: user.email, approvedAt: now() });
      await db.update(`clinicianRequests/${uid}`, { status: 'approved', decidedAt: now() });
      await audit({ actorId: user.uid, actorRole: 'admin', action: 'approve_clinician', targetId: uid });
      return { ok: true };
    },

    async adminReject(user, uid) {
      requireAdmin(user);
      await db.update(`clinicianRequests/${uid}`, { status: 'rejected', decidedAt: now() });
      await audit({ actorId: user.uid, actorRole: 'admin', action: 'reject_clinician', targetId: uid });
      return { ok: true };
    },

    /** Revoke a clinician: the role, the record, and EVERY assignment — at once. */
    async adminRevoke(user, uid) {
      requireAdmin(user);
      await auth.setClaims(uid, {});
      await db.update(`clinicians/${uid}`, { active: false, revokedAt: now() });
      for (const a of await db.where('assignments', 'clinicianId', uid)) {
        if (a.status === 'active') await db.update(`assignments/${a.id}`, { status: 'revoked', revokedAt: now(), revokedBy: 'admin' });
      }
      await audit({ actorId: user.uid, actorRole: 'admin', action: 'revoke_clinician', targetId: uid });
      return { ok: true };
    },

    async createInvite(user) {
      const rec = await requireClinician(user);
      let code;
      for (let i = 0; i < 5; i++) { code = makeInviteCode(rand); if (!(await db.get(`invites/${code}`))) break; }
      await db.set(`invites/${code}`, { code, clinicianId: user.uid, clinicianName: rec.name, createdAt: now(), expiresAt: now() + INVITE_TTL_MS, usedBy: null });
      return { code, expiresAt: now() + INVITE_TTL_MS };
    },

    /** The trainee sees WHO invited them before consenting (nothing else is revealed). */
    async peekInvite(user, code) {
      const inv = await db.get(`invites/${normalizeCode(code)}`);
      if (!inviteUsable(inv, now())) throw new ClinicError(404, 'invite_invalid');
      return { clinicianName: inv.clinicianName, expiresAt: inv.expiresAt };
    },

    /** The trainee links with an invite code + explicit consent (one active clinician at a time). */
    async link(user, code, consent) {
      if (consent !== true) throw new ClinicError(400, 'consent_required');
      // THE ADMIN EXCEPTION (owner, 2026-11-04): an ADMIN_EMAILS account may link to itself / be a clinician and a
      // trainee at once — for tests and management. Every other account keeps all the separations below.
      const admin = isAdminEmail(user.email, env);
      if (user.role === 'clinician' && !admin) throw new ClinicError(409, 'clinician_cannot_link');
      const c = normalizeCode(code);
      const inv = await db.get(`invites/${c}`);
      if (!inviteUsable(inv, now())) throw new ClinicError(404, 'invite_invalid');
      if (inv.clinicianId === user.uid && !admin) throw new ClinicError(409, 'self_link');
      const clin = await db.get(`clinicians/${inv.clinicianId}`);
      if (!clin?.active) throw new ClinicError(404, 'invite_invalid');
      const existing = await activeAssignmentOf(user.uid);
      if (existing && !admin) throw new ClinicError(409, 'already_linked');
      // (the admin re-links freely: the previous link is closed, never two active clinicians)
      if (existing) await db.update(`assignments/${existing.id}`, { status: 'revoked', revokedAt: now(), revokedBy: 'admin_relink' });
      const id = assignmentId(inv.clinicianId, user.uid);
      await db.set(`assignments/${id}`, { clinicianId: inv.clinicianId, traineeId: user.uid, status: 'active', consentAt: now(), linkedAt: now(), via: c });
      await db.update(`invites/${c}`, { usedBy: user.uid, usedAt: now() });
      await audit({ actorId: user.uid, actorRole: 'trainee', traineeId: user.uid, action: inv.clinicianId === user.uid ? 'admin_self_link' : 'consent_link', targetId: inv.clinicianId });
      return { ok: true, clinicianName: clin.name };
    },

    /** The trainee unlinks — the clinician's access ends at once. */
    async unlink(user) {
      const a = await activeAssignmentOf(user.uid);
      if (!a) return { ok: true };
      await db.update(`assignments/${a.id}`, { status: 'revoked', revokedAt: now(), revokedBy: 'trainee' });
      await audit({ actorId: user.uid, actorRole: 'trainee', traineeId: user.uid, action: 'unlink', targetId: a.clinicianId });
      return { ok: true };
    },

    /** The clinician ends the care of a trainee. */
    async endPatient(user, traineeId) {
      await requireClinician(user);
      const id = assignmentId(user.uid, traineeId);
      const a = await db.get(`assignments/${id}`);
      if (a?.status !== 'active') throw new ClinicError(404, 'no_active_assignment');
      await db.update(`assignments/${id}`, { status: 'revoked', revokedAt: now(), revokedBy: 'clinician' });
      await audit({ actorId: user.uid, actorRole: 'clinician', traineeId, action: 'end_care' });
      return { ok: true };
    },

    /** The clinician's own patients + each one's RED FLAGS and last workout (audited as a list view). */
    async patients(user) {
      await requireClinician(user);
      const list = (await db.where('assignments', 'clinicianId', user.uid)).filter(a => a.status === 'active');
      const out = [];
      for (const a of list) {
        const p = await db.get(`users/${a.traineeId}`);
        const workouts = await db.list(`users/${a.traineeId}/workouts`, { orderBy: 'date', limit: 12 });
        const pains = await db.list(`users/${a.traineeId}/painLog`, { orderBy: 'date', limit: 30 });
        const last = workouts[0] || null;
        const lock = await db.get(`users/${a.traineeId}/clinicalLocks/current`);
        out.push({
          locked: !!lock?.locked,
          traineeId: a.traineeId, name: p?.name || '', sport: p?.sport || '', since: a.linkedAt,
          lastWorkoutAt: last ? (Number(last.at) || Number(last.date) || null) : null,
          workoutsThisWeek: workouts.filter(w => now() - (Number(w.at) || Number(w.date) || 0) <= 7 * 864e5).length,
          flags: patientFlags({ workouts, pains, now: now(), locked: !!lock?.locked }),
        });
      }
      out.sort((x, y) => (y.flags.filter(f => f.severity === 'red').length - x.flags.filter(f => f.severity === 'red').length) || (y.flags.length - x.flags.length));
      if (out.length) await audit({ actorId: user.uid, actorRole: 'clinician', action: 'view_patient_list', traineeIds: out.map(x => x.traineeId) });
      return out;
    },

    /**
     * ONE patient's full data for the clinician (zero trust: assertAccess = an active clinician + an active
     * assignment for this exact pair, AUDITED). Only what the care needs — never the login / contact details.
     */
    async patientData(user, traineeId) {
      await assertAccess(user, traineeId, 'view_patient_data');
      const p = (await db.get(`users/${traineeId}`)) || {};
      const profile = {
        name: p.name || '', age: p.age ?? null, sport: p.sport || '', trainingTrack: p.trainingTrack || null,
        disability: p.disability || null, amputationSide: p.amputationSide || null, amputationLevel: p.amputationLevel || null,
        mobilityAid: p.mobilityAid || null, scanData: p.scanData ? { romBaseline: p.scanData.romBaseline || null } : null,
      };
      const [workouts, pains, notebook] = await Promise.all([
        db.list(`users/${traineeId}/workouts`, { orderBy: 'date', limit: 60 }),
        db.list(`users/${traineeId}/painLog`, { orderBy: 'date', limit: 100 }),
        db.list(`users/${traineeId}/coachNotebook`, { orderBy: 'date', limit: 30 }),
      ]);
      const limits = await db.get(`users/${traineeId}/clinicalConstraints/current`);
      const lock = await db.get(`users/${traineeId}/clinicalLocks/current`);
      const violations = await db.list(`users/${traineeId}/limitViolations`, { orderBy: 'at', limit: 30 });
      return { profile, workouts, pains, notebook, limits, lock, violations, flags: patientFlags({ workouts, pains, now: now(), locked: !!lock?.locked }) };
    },

    /** The clinician sets / replaces the patient's limits (the trainee can only read them — the rules). */
    async setLimits(user, traineeId, body) {
      const clean = cleanLimits(body);
      await assertAccess(user, traineeId, 'set_limits');
      const rec = await db.get(`clinicians/${user.uid}`);
      await db.set(`users/${traineeId}/clinicalConstraints/current`, { ...clean, updatedAt: now(), by: user.uid, byName: rec?.name || '' });
      return { ok: true, limits: clean };
    },

    /**
     * THE LOCK (owner, 2026-11-04): the trainee's own app reports 3 crossings of a clinical limit in a set →
     * the server locks the workouts until the clinician approves. Only the trainee themself, only under limits.
     */
    async lockSelf(user, body = {}) {
      const limits = await db.get(`users/${user.uid}/clinicalConstraints/current`);
      if (!limits) throw new ClinicError(409, 'no_limits');
      const v = {
        exercise: String(body.exercise || '').slice(0, 80), joint: LIMIT_JOINTS.includes(body.joint) ? body.joint : null,
        value: Number(body.value) || null, limit: Number(body.limit) || null, crossings: Number(body.crossings) || null, at: now(),
      };
      await db.set(`users/${user.uid}/clinicalLocks/current`, { locked: true, ...v });
      await db.add(`users/${user.uid}/limitViolations`, { ...v, locked: true });
      await audit({ actorId: user.uid, actorRole: 'system', traineeId: user.uid, action: 'locked_by_limit', detail: v });
      return { ok: true, locked: true };
    },

    /** Only the assigned clinician unlocks — "the patient is fit to continue" (audited). */
    async unlock(user, traineeId, { note = '' } = {}) {
      await assertAccess(user, traineeId, 'approve_continue');
      const lock = await db.get(`users/${traineeId}/clinicalLocks/current`);
      if (!lock?.locked) return { ok: true, locked: false };
      const rec = await db.get(`clinicians/${user.uid}`);
      await db.set(`users/${traineeId}/clinicalLocks/current`, { ...lock, locked: false, approvedAt: now(), approvedBy: user.uid, approvedByName: rec?.name || '', note: String(note).slice(0, 300) });
      return { ok: true, locked: false };
    },

    /** The trainee's own access log: who viewed / changed their data, when. */
    async myAudit(user) {
      const rows = await db.where('auditLog', 'traineeId', user.uid);
      const listed = (await db.where('auditLog', 'action', 'view_patient_list')).filter(r => (r.traineeIds || []).includes(user.uid));
      const names = {};
      const all = [...rows, ...listed].sort((a, b) => b.at - a.at).slice(0, 50);
      for (const r of all) if (r.actorRole === 'clinician' && !(r.actorId in names)) names[r.actorId] = (await db.get(`clinicians/${r.actorId}`))?.name || '';
      return all.map(r => ({ at: r.at, action: r.action, by: r.actorRole === 'clinician' ? names[r.actorId] : r.actorRole }));
    },
  };
}

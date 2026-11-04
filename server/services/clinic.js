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

/**
 * The portal's operations. `user` = { uid, email, role } from the VERIFIED token.
 * db: get(path) · set(path, data) · update(path, data) · add(collection, data) → id · where(collection, field, value) → [{id, ...}]
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

    /** The clinician's own patients (names only here — the full data comes through assertAccess, audited). */
    async patients(user) {
      await requireClinician(user);
      const list = (await db.where('assignments', 'clinicianId', user.uid)).filter(a => a.status === 'active');
      const out = [];
      for (const a of list) {
        const p = await db.get(`users/${a.traineeId}`);
        out.push({ traineeId: a.traineeId, name: p?.name || '', sport: p?.sport || '', since: a.linkedAt });
      }
      if (out.length) await audit({ actorId: user.uid, actorRole: 'clinician', action: 'view_patient_list', traineeIds: out.map(x => x.traineeId) });
      return out;
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

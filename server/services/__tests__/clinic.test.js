import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClinic, makeInviteCode, normalizeCode, ClinicError } from '../clinic.js';

// an in-memory store with the adapter's shape
function memDb() {
  const docs = new Map();
  let n = 0;
  return {
    docs,
    async get(p) { return docs.has(p) ? { ...docs.get(p) } : null; },
    async set(p, d) { docs.set(p, { ...d }); },
    async update(p, d) { docs.set(p, { ...(docs.get(p) || {}), ...d }); },
    async add(c, d) { const id = `a${++n}`; docs.set(`${c}/${id}`, { ...d }); return id; },
    async where(c, f, v) { return [...docs.entries()].filter(([k, d]) => k.startsWith(`${c}/`) && k.split('/').length === 2 && d[f] === v).map(([k, d]) => ({ id: k.split('/')[1], ...d })); },
  };
}
const setup = () => {
  const db = memDb();
  const claims = {};
  let t = 1000;
  const clinic = createClinic({ db, auth: { setClaims: async (uid, c) => { claims[uid] = c; } }, env: { ADMIN_EMAILS: 'owner@x.com' }, now: () => t, rand: () => 0.5 });
  const admin = { uid: 'ADM', email: 'owner@x.com' };
  return { db, claims, clinic, admin, tick: (ms) => { t += ms; } };
};
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof ClinicError && e.code === code);

async function approvedClinician(s, uid = 'PT1', name = 'דנה') {
  await s.clinic.requestClinician({ uid, email: `${uid}@x.com` }, { name });
  await s.clinic.adminApprove(s.admin, uid);
  return { uid, email: `${uid}@x.com`, role: 'clinician' };
}

test('only an admin approves a clinician; the role is a server-set claim', async () => {
  const s = setup();
  await s.clinic.requestClinician({ uid: 'PT1', email: 'pt@x.com' }, { name: 'דנה' });
  await rejects(s.clinic.adminApprove({ uid: 'X', email: 'someone@x.com' }, 'PT1'), 'not_admin');
  await s.clinic.adminApprove(s.admin, 'PT1');
  assert.deepEqual(s.claims.PT1, { role: 'clinician' });
  assert.equal((await s.clinic.me({ uid: 'PT1', email: 'pt@x.com', role: 'clinician' })).role, 'clinician');
  // a self-made claim without the active record is NOT a clinician
  await rejects(s.clinic.createInvite({ uid: 'FAKE', role: 'clinician' }), 'clinician_not_active');
});

test('invite → consent → link; the clinician sees only their own patient; unlink ends access at once', async () => {
  const s = setup();
  const pt = await approvedClinician(s);
  const pt2 = await approvedClinician(s, 'PT2', 'רון');
  const { code } = await s.clinic.createInvite(pt);
  const trainee = { uid: 'T1', email: 't@x.com' };
  assert.equal((await s.clinic.peekInvite(trainee, code.toLowerCase())).clinicianName, 'דנה');
  await rejects(s.clinic.link(trainee, code, false), 'consent_required');
  await s.clinic.link(trainee, code, true);
  await rejects(s.clinic.link({ uid: 'T2' }, code, true), 'invite_invalid');            // one use
  assert.equal((await s.clinic.patients(pt)).length, 1);
  assert.equal((await s.clinic.patients(pt2)).length, 0);
  await s.clinic.assertAccess(pt, 'T1', 'view_progress');
  await rejects(s.clinic.assertAccess(pt2, 'T1', 'view_progress'), 'no_active_assignment');
  await s.clinic.unlink(trainee);
  await rejects(s.clinic.assertAccess(pt, 'T1', 'view_progress'), 'no_active_assignment');
});

test('an expired invite, a second clinician, a self-link are refused', async () => {
  const s = setup();
  const pt = await approvedClinician(s);
  const { code } = await s.clinic.createInvite(pt);
  s.tick(8 * 864e5);
  await rejects(s.clinic.link({ uid: 'T1' }, code, true), 'invite_invalid');
  const fresh = await s.clinic.createInvite(pt);
  await rejects(s.clinic.link({ uid: 'PT1', role: 'clinician' }, fresh.code, true), 'clinician_cannot_link');
  await s.clinic.link({ uid: 'T1' }, fresh.code, true);
  const pt2 = await approvedClinician(s, 'PT2', 'רון');
  const other = await s.clinic.createInvite(pt2);
  await rejects(s.clinic.link({ uid: 'T1' }, other.code, true), 'already_linked');
});

test('revoking a clinician removes the role and every assignment at once', async () => {
  const s = setup();
  const pt = await approvedClinician(s);
  const { code } = await s.clinic.createInvite(pt);
  await s.clinic.link({ uid: 'T1' }, code, true);
  await s.clinic.adminRevoke(s.admin, 'PT1');
  assert.deepEqual(s.claims.PT1, {});
  await rejects(s.clinic.assertAccess(pt, 'T1', 'view'), 'clinician_not_active');      // even with the old token
  assert.equal((await s.clinic.me({ uid: 'T1' })).myClinician, null);
});

test('every clinician access is in the audit log, and the trainee sees who and when', async () => {
  const s = setup();
  const pt = await approvedClinician(s);
  const { code } = await s.clinic.createInvite(pt);
  await s.clinic.link({ uid: 'T1' }, code, true);
  await s.clinic.patients(pt);
  await s.clinic.assertAccess(pt, 'T1', 'view_progress');
  const log = await s.clinic.myAudit({ uid: 'T1' });
  assert.deepEqual(log.map(r => r.action).sort(), ['consent_link', 'view_patient_list', 'view_progress']);
  assert.equal(log.find(r => r.action === 'view_progress').by, 'דנה');
});

test('invite codes: 6 clear characters, normalized', () => {
  const c = makeInviteCode();
  assert.match(c, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(normalizeCode(' ab-c1 2x '), 'ABC12X');
});

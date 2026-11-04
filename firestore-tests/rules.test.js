// The Firestore security rules (../firestore.rules) on the emulator — run: npm test (in firestore-tests/)
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs, addDoc } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/alice'), { name: 'Alice' });
    await setDoc(doc(db, 'users/alice/workouts/w1'), { reps: 10 });
    await setDoc(doc(db, 'users/alice/clinicalConstraints/c1'), { knee: 90 });
    await setDoc(doc(db, 'assignments/pt_alice'), { clinicianId: 'pt', traineeId: 'alice', status: 'active' });
    await setDoc(doc(db, 'auditLog/x'), { actorId: 'pt' });
  });
});

const as = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();

test('a trainee reads and writes their OWN data — every collection the app uses today', async () => {
  const db = as('alice');
  await assertSucceeds(getDoc(doc(db, 'users/alice')));
  await assertSucceeds(setDoc(doc(db, 'users/alice'), { name: 'A' }, { merge: true }));
  for (const sub of ['workouts', 'painLog', 'games', 'coachNotebook', 'anatomic_data', 'validationReps']) {
    await assertSucceeds(addDoc(collection(db, `users/alice/${sub}`), { x: 1 }));
    await assertSucceeds(getDocs(collection(db, `users/alice/${sub}`)));
  }
});

test('nobody reads or writes another user — not even a clinician (only the audited server)', async () => {
  await assertFails(getDoc(doc(as('bob'), 'users/alice')));
  await assertFails(getDocs(collection(as('bob'), 'users/alice/workouts')));
  await assertFails(setDoc(doc(as('bob'), 'users/alice/workouts/w2'), { reps: 1 }));
  // a clinician with an ACTIVE assignment still cannot read directly — the data goes only through the server
  await assertFails(getDoc(doc(as('pt', { role: 'clinician' }), 'users/alice/workouts/w1')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/alice')));
});

test('what the clinician sets: the trainee reads it, never writes it', async () => {
  const db = as('alice');
  await assertSucceeds(getDoc(doc(db, 'users/alice/clinicalConstraints/c1')));
  await assertFails(setDoc(doc(db, 'users/alice/clinicalConstraints/c1'), { knee: 140 }));
  await assertFails(setDoc(doc(db, 'users/alice/clinicalLocks/l1'), { locked: false }));
  await assertFails(setDoc(doc(db, 'users/alice/clinicianPlans/p1'), { plan: 'mine' }));
  await assertFails(setDoc(doc(db, 'users/alice/limitViolations/v1'), { erased: true }));
});

test('the portal collections are server-only — no client reads or writes, a self-made claim changes nothing', async () => {
  for (const db of [as('alice'), as('pt', { role: 'clinician' }), as('hacker', { role: 'admin' })]) {
    await assertFails(getDoc(doc(db, 'assignments/pt_alice')));
    await assertFails(setDoc(doc(db, 'assignments/hacker_alice'), { status: 'active' }));
    await assertFails(getDocs(collection(db, 'auditLog')));
    await assertFails(addDoc(collection(db, 'auditLog'), { fake: true }));
    await assertFails(setDoc(doc(db, 'clinicians/hacker'), { active: true }));
    await assertFails(getDoc(doc(db, 'invites/ABCDEF')));
  }
});

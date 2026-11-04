import admin from 'firebase-admin';

let app = null;

/**
 * Initialize Firebase Admin SDK.
 * Supports three modes:
 *   1. FIREBASE_SERVICE_ACCOUNT env var (JSON string of the service account)
 *   2. GOOGLE_APPLICATION_CREDENTIALS env var (path to JSON file)
 *   3. No credentials — admin features disabled (auth middleware becomes pass-through)
 */
export function initFirebaseAdmin() {
  if (app) return app;

  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('[Firebase Admin] Initialized with service account');
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      app = admin.initializeApp();
      console.log('[Firebase Admin] Initialized with application default credentials');
    } else {
      console.log('[Firebase Admin] No credentials configured — auth middleware disabled');
      return null;
    }
  } catch (err) {
    console.error('[Firebase Admin] Init failed:', err.message);
    return null;
  }

  return app;
}

/**
 * Express middleware: verify Firebase ID token from Authorization header.
 * If Firebase Admin is not initialized, requests pass through (dev mode).
 */
export function requireAuth(req, res, next) {
  // If admin not initialized, skip auth (dev mode)
  if (!app) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const idToken = authHeader.slice(7);
  admin.auth().verifyIdToken(idToken)
    .then(decoded => {
      req.uid = decoded.uid;
      req.userEmail = decoded.email;
      req.userRole = decoded.role || null;          // a custom claim — set ONLY by the server (clinic.js)
      next();
    })
    .catch(err => {
      console.warn('[Auth] Token verification failed:', err.message);
      res.status(401).json({ error: 'Invalid or expired token' });
    });
}


/** Is the Admin SDK connected (the server can verify tokens)? Shown in /api/health. */
export const adminReady = () => !!app;

/**
 * STRICT auth for the clinic portal (Stage 4B, zero trust): never a pass-through — without the Admin SDK the
 * portal is closed (503), and every request must carry a valid token.
 */
export function requireAuthStrict(req, res, next) {
  if (!app) return res.status(503).json({ error: 'auth_not_configured' });
  return requireAuth(req, res, next);
}

/** The clinic's storage adapter over Firestore (server-only collections; the Admin SDK bypasses the rules). */
export function adminDb() {
  const fs = admin.firestore();
  return {
    async get(p) { const d = await fs.doc(p).get(); return d.exists ? d.data() : null; },
    async set(p, data) { await fs.doc(p).set(data); },
    async update(p, data) { await fs.doc(p).set(data, { merge: true }); },
    async add(c, data) { return (await fs.collection(c).add(data)).id; },
    async where(c, field, value) { const q = await fs.collection(c).where(field, '==', value).limit(500).get(); return q.docs.map(d => ({ id: d.id, ...d.data() })); },
  };
}
export const adminAuth = () => ({ setClaims: (uid, claims) => admin.auth().setCustomUserClaims(uid, claims) });

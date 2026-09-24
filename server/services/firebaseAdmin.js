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
      next();
    })
    .catch(err => {
      console.warn('[Auth] Token verification failed:', err.message);
      res.status(401).json({ error: 'Invalid or expired token' });
    });
}

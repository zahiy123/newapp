// ============================================================
// AnatomicPassport — Firebase CRUD + KSG Integration
//
// Handles the full lifecycle of the Anatomic Passport:
//   1. CREATE — after Full Anatomic Scan completes
//   2. READ   — load into KSG at session start
//   3. UPDATE — only on explicit user-requested re-scan
//   4. DELETE — not exposed (passport is permanent)
//
// Clinical rule: A passport with scan_status !== "complete"
// can NEVER be saved or loaded. The SchemaValidator enforces
// this at the KSG level, and we enforce it here at the
// persistence level as well (defense in depth).
// ============================================================

import { db } from '../services/firebase.js';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { validatePassport } from './SchemaValidator.js';
import KSG from './KineticStateGraph.js';
import { SCAN_STATUS } from './constants.js';


// Firestore path: users/{uid}/anatomic_data/passport
// Using a subcollection to keep the passport separate from
// the user profile document (which has different update patterns).
const COLLECTION = 'users';
const SUBCOLLECTION = 'anatomic_data';
const DOC_ID = 'passport';

function passportDocRef(uid) {
  return doc(db, COLLECTION, uid, SUBCOLLECTION, DOC_ID);
}


// ---- Result wrapper ----
// Every operation returns { ok, data?, error? } instead of throwing.
// This makes error handling explicit at the call site.

function success(data) {
  return { ok: true, data };
}

function failure(error, code = 'UNKNOWN') {
  return { ok: false, error: error.message || String(error), code };
}


// ============================================================
// CREATE / UPDATE — Save passport to Firebase
// ============================================================

export async function savePassport(uid, passport) {
  KSG.debug.write('savePassport() called', { uid });

  // Guard: uid required
  if (!uid || typeof uid !== 'string') {
    KSG.debug.error('savePassport failed — invalid uid');
    return failure(new Error('User ID (uid) is required'), 'INVALID_UID');
  }

  // Guard: scan must be complete
  if (passport?.scan_status !== SCAN_STATUS.COMPLETE) {
    KSG.debug.error('savePassport failed — scan not complete', {
      scan_status: passport?.scan_status,
    });
    return failure(
      new Error('Cannot save an incomplete scan. scan_status must be "complete"'),
      'INCOMPLETE_SCAN'
    );
  }

  // Full schema validation before touching Firebase
  const errors = validatePassport(passport);
  if (errors.length > 0) {
    KSG.debug.error(`savePassport validation FAILED — ${errors.length} error(s)`,
      errors.map(e => `${e.path}: ${e.detail}`));
    return failure(
      new Error(`Passport validation failed: ${errors[0].detail}`),
      'VALIDATION_FAILED'
    );
  }

  KSG.debug.validation('Passport pre-save validation PASSED');

  // Prepare the document — add Firebase metadata
  const document = {
    ...passport,
    _firebase_meta: {
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      schema_version: passport.version,
    },
  };

  try {
    await setDoc(passportDocRef(uid), document);
    KSG.debug.write('Passport saved to Firebase', {
      uid,
      classification: passport.classification,
    });
    return success({ uid, classification: passport.classification });
  } catch (err) {
    KSG.debug.error('Firebase write failed', { uid, error: err.message });
    return failure(err, 'FIREBASE_WRITE_FAILED');
  }
}


// ============================================================
// READ — Load passport from Firebase
// ============================================================

export async function loadPassport(uid) {
  KSG.debug.write('loadPassport() called', { uid });

  // Guard: uid required
  if (!uid || typeof uid !== 'string') {
    KSG.debug.error('loadPassport failed — invalid uid');
    return failure(new Error('User ID (uid) is required'), 'INVALID_UID');
  }

  try {
    const snapshot = await getDoc(passportDocRef(uid));

    if (!snapshot.exists()) {
      KSG.debug.write('No passport found in Firebase for user', { uid });
      return failure(
        new Error('No Anatomic Passport found for this user. A Full Anatomic Scan is required.'),
        'NOT_FOUND'
      );
    }

    const raw = snapshot.data();
    KSG.debug.write('Raw passport loaded from Firebase', {
      uid,
      classification: raw?.classification,
      scan_status: raw?.scan_status,
    });

    // Strip Firebase metadata before validation
    const { _firebase_meta, ...passport } = raw;

    // Validate what we loaded — trust nothing from the database
    const errors = validatePassport(passport);
    if (errors.length > 0) {
      KSG.debug.error(`Loaded passport FAILED validation — ${errors.length} error(s)`,
        errors.map(e => `${e.path}: ${e.detail}`));
      return failure(
        new Error(
          `Stored passport is corrupt or outdated (${errors.length} validation error(s)). ` +
          `A new Full Anatomic Scan is required. First error: ${errors[0].detail}`
        ),
        'CORRUPT_PASSPORT'
      );
    }

    KSG.debug.validation('Loaded passport validation PASSED');
    return success(passport);
  } catch (err) {
    KSG.debug.error('Firebase read failed', { uid, error: err.message });
    return failure(err, 'FIREBASE_READ_FAILED');
  }
}


// ============================================================
// LOAD INTO KSG — Load from Firebase and inject into KSG
// ============================================================

export async function loadPassportIntoKSG(uid) {
  KSG.debug.write('loadPassportIntoKSG() called', { uid });

  const result = await loadPassport(uid);
  if (!result.ok) {
    return result;
  }

  try {
    // This will run schema validation AGAIN inside KSG
    // (defense in depth — double validation)
    KSG.loadPassport(result.data);

    KSG.debug.write('Passport loaded into KSG successfully', {
      uid,
      classification: result.data.classification,
    });

    return success({
      uid,
      classification: result.data.classification,
      mobility_mode: result.data.structural_profile.mobility_mode,
      risk_zones: result.data.risk_zones.length,
    });
  } catch (err) {
    KSG.debug.error('Failed to load passport into KSG', {
      uid,
      error: err.message,
    });
    return failure(err, 'KSG_LOAD_FAILED');
  }
}


// ============================================================
// CHECK — Does this user have a passport?
// ============================================================

export async function hasPassport(uid) {
  if (!uid || typeof uid !== 'string') {
    return false;
  }

  try {
    const snapshot = await getDoc(passportDocRef(uid));
    return snapshot.exists();
  } catch {
    return false;
  }
}


// ============================================================
// RESCAN — Mark that a new scan is needed
// (Doesn't delete the old passport — just lets the UI know)
// ============================================================

export async function requiresRescan(uid) {
  if (!uid) return true;

  const result = await loadPassport(uid);

  // No passport → needs scan
  if (!result.ok) return true;

  // Passport exists and is valid → no rescan needed
  return false;
}


// ============================================================
// FACTORY — Create an empty passport template
// (Used by the Scan Engine to build up incrementally)
// ============================================================

export function createEmptyPassportDraft() {
  return {
    version: '1.0',
    scan_date: null,
    scan_duration_sec: 0,
    scan_status: 'incomplete',

    body_map: {
      left_leg: createEmptyLimb(),
      right_leg: createEmptyLimb(),
      left_arm: createEmptyLimb(),
      right_arm: createEmptyLimb(),
    },

    external_aids: {
      crutches: { detected: false, type: null, side: null },
      wheelchair: { detected: false, type: null },
      brace: { detected: false, location: null },
      other: [],
    },

    structural_profile: {
      mobility_mode: null,
      center_of_gravity: {
        bias: null,
        stability_score: 0,
        vertical_axis_deviation: 0,
      },
      proportions: {
        left_arm_to_torso: 0,
        right_arm_to_torso: 0,
        left_leg_to_torso: 0,
        right_leg_to_torso: 0,
        shoulder_width_to_hip: 0,
      },
    },

    compensation_map: {
      patterns: [],
      symmetry_index: 0,
    },

    risk_zones: [],

    kinetic_baseline: {
      natural_rhythm_hz: 0,
      gait_symmetry_index: 0,
      preferred_tempo: null,
      dominant_side: null,
      damping_spectrum: {
        left_leg: [],
        right_leg: [],
        left_arm: [],
        right_arm: [],
      },
    },

    classification: null,

    scan_metadata: {
      frames_analyzed: 0,
      retries: { phase_a: 0, phase_b: 0, movements_repeated: [] },
      user_reported_fields: [],
      scan_environment: null,
      camera_quality: null,
      lighting_quality: null,
    },
  };
}

function createEmptyLimb() {
  return {
    status: 'unresolved',
    detection_method: null,
    confidence: null,
    damping_factor: null,
    damping_class: null,
    range_of_motion: null,
    stiffness_profile: null,
    notes: null,
  };
}

// validationStore — labelled validation clips in Firestore (Stage 3.1 validation dataset)
// users/{uid}/validationReps/{autoId}: { profileId, sportContexts, kind, durationMs, frames: [{t, f}],
//   verdict: { issues, accuracy, events }, label: 'good'|'fault', faults: string[], createdAt }
// Landmarks only (compact strings) — no video, no images.

import { addDoc, collection, getDocs, limit, orderBy, query, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

/** Validation mode: `?validate=1` turns it on (remembered per device), `?validate=0` off. */
export function readValidationMode(search) {
  try {
    const v = new URLSearchParams(search || '').get('validate');
    if (v === '1') localStorage.setItem('validationMode', '1');
    if (v === '0') localStorage.removeItem('validationMode');
    return localStorage.getItem('validationMode') === '1';
  } catch {
    return false;
  }
}

export async function saveLabelledClip(uid, clip, label, faults = []) {
  if (!uid || !clip) return null;
  const { id, index, ...rest } = clip;
  return addDoc(collection(db, 'users', uid, 'validationReps'), {
    ...rest, clipId: id, label, faults, createdAt: Timestamp.now(),
  });
}

/** Labelled clips, newest first, as { clip, label, faults } items for agreement.js. */
export async function loadLabelledClips(uid, max = 500) {
  if (!uid) return [];
  const snap = await getDocs(query(collection(db, 'users', uid, 'validationReps'), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map((d) => {
    const { label, faults, ...clip } = d.data();
    return { clip: { ...clip, id: d.id }, label, faults: faults || [] };
  });
}

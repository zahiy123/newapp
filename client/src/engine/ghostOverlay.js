// ============================================================
// ghostOverlay — where and how big the big Ghost is drawn on the trainee's body
//
// PURE math, one coordinate chain (clean pass, 2026-10-12):
//
//   camera frame (normalized 0-1, what MediaPipe sees)
//     → displayed camera view (`object-fit: contain`: the WHOLE frame is shown, so what the camera
//       sees, what the trainee sees and where the Ghost is drawn are the same picture)
//     → the Ghost's body units (warmupGhost / profileGhost: hip center at 0, ankles at 1.78,
//       shoulders at −1.4).
//
// Field-test history this module answers:
//   • the camera view on a phone is short and wide; the video used `object-fit: cover`, which cut
//     ~35% of the upright camera frame (head / feet) off the screen — the Ghost, placed on the real
//     body in the frame, landed partly in the cut-off part ("it sits low, I must tilt the phone");
//   • close to the phone MediaPipe "guesses" hips / knees / ankles BELOW the picture with high
//     confidence — only landmarks really inside the picture are used;
//   • the torso estimated from the shoulder width uses a REAL body's proportions;
//   • the Ghost stands on the trainee's feet when they are seen (no bobbing with the hips), and its
//     shoulders are locked to the trainee's shoulders (almost always in the picture);
//   • time-based smoothing with a soft dead-band: it glides with the body and never trembles.
// ============================================================

// ---- the Ghost body model (body units) ----
const GHOST_TORSO_UNITS = 1.4;                                   // hip center → shoulders
const LEG_PER_TORSO = 1.78 / GHOST_TORSO_UNITS;                  // hip → ankle, in torso lengths
const SHOULDER_TO_ANKLE_PER_TORSO = (GHOST_TORSO_UNITS + 1.78) / GHOST_TORSO_UNITS;

// ---- a real body ----
// torso (shoulder joints → hip joints, ~0.5 m) per shoulder-joint width (~0.38 m)
const TORSO_PER_SHOULDER_WIDTH = 1.3;

// ---- landmark trust ----
const MIN_VISIBILITY = 0.5;
const IN_FRAME_MAX_Y = 0.97;          // below this a landmark is a guess outside the picture
const SHOULDER_LOCK = 0.6;            // Ghost shoulders ↔ trainee shoulders, at most this × torso apart

// ---- smoothing ----
const MAX_SIZE_STEP = 0.06;           // relative torso change allowed per update
const POS_TAU_MS = 220;               // position follows the body with this time constant
const SIZE_TAU_MS = 650;              // the size changes slower still
const POS_DEADBAND = 0.012;           // landmark noise below ~1% of the frame is not followed (soft)
const SIZE_DEADBAND = 0.04;           // relative torso noise below 4% is not followed (soft)
const FOOT_KEEP_UPDATES = 30;         // a real feet line that flickers out is kept ~0.5 s

// ---- the trainee's own proportions (the Ghost is fitted to them) ----
// Ghost segment lengths per torso (warmupGhost / GHOST_BODY): thigh 0.9, shin 0.88, upper arm 0.6, forearm 0.55
const GHOST_RATIO = { thigh: 0.9 / 1.4, shin: 0.88 / 1.4, upperArm: 0.6 / 1.4, forearm: 0.55 / 1.4 };
const SEGMENTS = {
  thigh: [[23, 25], [24, 26]], shin: [[25, 27], [26, 28]],
  upperArm: [[11, 13], [12, 14]], forearm: [[13, 15], [14, 16]],
};
const LIMB_MIN = 0.8, LIMB_MAX = 1.25;  // a factor outside this is a measurement error, not a body
// seated: knees about at hip height (thighs toward the camera / horizontal), with hysteresis
const SEATED_KNEE_DROP = 0.45;        // knee below the hip by less than this × torso → seated frame
const SEATED_ON = 8, SEATED_MAX = 16;
// lying (floor exercises: plank, push-up, bridge): the torso is closer to horizontal than vertical
const LYING_ON = 6, LYING_MAX = 12;

/**
 * Normalized camera coords → displayed view coords for an `object-fit` box.
 * @param {'contain'|'cover'} fit
 * @returns {(nx: number, ny: number) => { x: number, y: number }} with .scaleY (px per normalized y)
 */
export function frameTransform(videoW, videoH, viewW, viewH, fit = 'contain') {
  const s = fit === 'cover' ? Math.max(viewW / videoW, viewH / videoH) : Math.min(viewW / videoW, viewH / videoH);
  const dw = videoW * s;
  const dh = videoH * s;
  const ox = (viewW - dw) / 2;
  const oy = (viewH - dh) / 2;
  const map = (nx, ny) => ({ x: ox + nx * dw, y: oy + ny * dh });
  map.scaleY = dh;
  map.box = { x: ox, y: oy, w: dw, h: dh };
  return map;
}

/** The `object-fit: cover` mapping (kept for callers that still crop). */
export const coverTransform = (videoW, videoH, viewW, viewH) => frameTransform(videoW, videoH, viewW, viewH, 'cover');

const follow = (prev, target, a, band) => {
  const d = target - prev;
  const k = band > 0 ? Math.min(1, Math.abs(d) / band) : 1;   // quadratic below the band → no tremble
  return prev + d * a * k;
};

/**
 * Where the trainee's body is (normalized camera coords), smoothed with the previous anchor.
 * @param {Array|null} landmarks - pose landmarks (normalized)
 * @param {Object|null} prev - the previous anchor
 * @param {number} [alpha=0.25] - per-update smoothing when no frame time is given
 * @param {number} [aspect=4/3] - video width / height (normalized x and y have different px scales)
 * @param {number|null} [dtMs] - frame time → time-based smoothing with a dead-band
 * @returns {{ hipX, hipY, torso, footY, footMiss, footReal } | null}
 *   torso and the y values are in normalized-y units
 */
export function bodyAnchor(landmarks, prev = null, alpha = 0.25, aspect = 4 / 3, dtMs = null) {
  const seen = (p) => p && (p.visibility ?? 1) >= MIN_VISIBILITY
    && p.x >= -0.02 && p.x <= 1.02 && p.y >= 0 && p.y <= IN_FRAME_MAX_Y;
  const ls = landmarks?.[11], rs = landmarks?.[12], lh = landmarks?.[23], rh = landmarks?.[24];
  const shoulders = [ls, rs].filter(seen);
  if (!shoulders.length) return prev;
  const mid = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
  const sh = mid(shoulders);
  // 3D length in normalized-y units (MediaPipe z is in x units): bending toward the camera does not
  // shrink the Ghost — its size follows the body size / the distance only
  const len = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y, ((a.z ?? 0) - (b.z ?? 0)) * aspect);

  // ---- body size + hip position ----
  const hips = [lh, rh].filter(seen);
  const sidePairs = [[ls, lh], [rs, rh]].filter(([s, h]) => seen(s) && seen(h)).map(([s, h]) => len(s, h));
  let hipX, hipY, torso;
  if (sidePairs.length && hips.length) {
    // the best: shoulder → hip on a visible side (works side-on too)
    torso = Math.max(...sidePairs);
    const hp = mid(hips);
    hipX = hp.x; hipY = hp.y;
  } else if (seen(ls) && seen(rs)) {
    // hips out of the picture: the shoulder width — only when facing the camera (side-on the
    // shoulders overlap and the width says nothing about the body size → keep the previous size)
    const width = Math.abs(ls.x - rs.x) * aspect;
    const facing = !prev || width * TORSO_PER_SHOULDER_WIDTH > prev.torso * 0.75;
    torso = facing ? width * TORSO_PER_SHOULDER_WIDTH : prev.torso;
    hipX = sh.x; hipY = sh.y + torso;
  } else {
    if (!prev) return null;
    torso = prev.torso;
    hipX = sh.x; hipY = sh.y + torso;
  }
  if (!(torso > 0.03)) return prev;

  // ---- lying on the floor? (the shoulder → hip line is more horizontal than vertical) ----
  // Every standing rule below (feet line, shoulder lock, seated) is wrong for a lying body: the
  // shoulder lock put the Ghost's hips a torso BELOW the shoulders — off the picture (field test)
  let lyingCount = prev?.lyingCount ?? 0;
  if (hips.length) {
    const hp = mid(hips);
    const horizontal = Math.abs(sh.x - hp.x) * aspect > Math.abs(sh.y - hp.y) * 1.2;
    lyingCount = horizontal ? Math.min(LYING_MAX, lyingCount + 1) : Math.max(0, lyingCount - 1);
  }
  const lying = lyingCount >= LYING_ON;
  if (lying && hips.length) {
    const hp = mid(hips);
    // the head's side on the picture (the Ghost lies the same way round) + the body's center
    const headDir = Math.sign(sh.x - hp.x) || prev?.headDir || 1;
    const out = { hipX: hp.x, hipY: hp.y, torso, footY: null, footMiss: 0, footReal: false,
      limbs: prev?.limbs || { thigh: 1, shin: 1, upperArm: 1, forearm: 1 }, seatedCount: 0, seated: false, lyingCount, lying: true, headDir };
    // the moment the body lies down: straight onto the hips (no slow glide from the standing place)
    if (!prev || !prev.lying) return out;
    const bounded = Math.min(prev.torso * (1 + MAX_SIZE_STEP), Math.max(prev.torso * (1 - MAX_SIZE_STEP), torso));
    const a = typeof dtMs === 'number' && dtMs > 0 ? 1 - Math.exp(-Math.min(dtMs, 100) / POS_TAU_MS) : alpha;
    return { ...out, hipX: follow(prev.hipX, hp.x, a, POS_DEADBAND), hipY: follow(prev.hipY, hp.y, a, POS_DEADBAND), torso: prev.torso + a * (bounded - prev.torso) };
  }

  // ---- the feet line: the REAL standing foot when seen, else predicted from the body ----
  const legLen = torso * LEG_PER_TORSO;
  const ankles = [landmarks?.[27], landmarks?.[28]]
    .filter(a => seen(a) && a.y - hipY > legLen * 0.55 && a.y - hipY < legLen * 1.6);
  const footReal = ankles.length ? Math.max(...ankles.map(a => a.y)) : null;
  const footMiss = footReal === null ? (prev?.footMiss ?? 0) + 1 : 0;
  const keepFoot = footReal === null && prev?.footY != null && prev.footReal && footMiss <= FOOT_KEEP_UPDATES;
  let footTarget = footReal ?? (keepFoot ? prev.footY : hipY + legLen);
  const footIsReal = footReal !== null || keepFoot;

  // ---- shoulder lock: the Ghost's standing shoulders stay on the trainee's ----
  if (Math.abs(footTarget - SHOULDER_TO_ANKLE_PER_TORSO * torso - sh.y) > SHOULDER_LOCK * torso) {
    footTarget = sh.y + SHOULDER_TO_ANKLE_PER_TORSO * torso;
    hipY = sh.y + torso;
  }

  // ---- the trainee's proportions: each limb's length vs. the torso, as a factor of the Ghost's ----
  // (a limb pointing at the camera looks short → a long reading counts fast, a short one slowly)
  const limbs = { ...(prev?.limbs || { thigh: 1, shin: 1, upperArm: 1, forearm: 1 }) };
  for (const [seg, pairs] of Object.entries(SEGMENTS)) {
    const reads = pairs.filter(([a, b]) => seen(landmarks?.[a]) && seen(landmarks?.[b])).map(([a, b]) => len(landmarks[a], landmarks[b]));
    if (!reads.length) continue;
    const f = Math.min(LIMB_MAX, Math.max(LIMB_MIN, Math.max(...reads) / torso / GHOST_RATIO[seg]));
    limbs[seg] += (f > limbs[seg] ? 0.1 : 0.01) * (f - limbs[seg]);
  }
  // ---- seated? (knees in the picture at about hip height) ----
  const knees = [landmarks?.[25], landmarks?.[26]].filter(seen);
  let seatedCount = prev?.seatedCount ?? 0;
  if (knees.length && hips.length) {
    const kneeDrop = Math.max(...knees.map(k => k.y)) - hipY;
    seatedCount = kneeDrop < SEATED_KNEE_DROP * torso ? Math.min(SEATED_MAX, seatedCount + 1) : Math.max(0, seatedCount - 1);
  }
  const seated = seatedCount >= SEATED_ON;

  if (!prev) return { hipX, hipY, torso, footY: footTarget, footMiss, footReal: footIsReal, limbs, seatedCount, seated, lyingCount, lying: false };

  // ---- smoothing: no sudden size change, glide with the body, ignore noise ----
  const bounded = Math.min(prev.torso * (1 + MAX_SIZE_STEP), Math.max(prev.torso * (1 - MAX_SIZE_STEP), torso));
  if (typeof dtMs === 'number' && dtMs > 0) {
    const dt = Math.min(dtMs, 100);
    const aPos = 1 - Math.exp(-dt / POS_TAU_MS);
    const aSize = 1 - Math.exp(-dt / SIZE_TAU_MS);
    return {
      hipX: follow(prev.hipX, hipX, aPos, POS_DEADBAND),
      hipY: follow(prev.hipY, hipY, aPos, POS_DEADBAND),
      torso: follow(prev.torso, bounded, aSize, SIZE_DEADBAND * prev.torso),
      footY: prev.footY == null ? footTarget : follow(prev.footY, footTarget, aPos, POS_DEADBAND),
      footMiss,
      footReal: footIsReal,
      limbs, seatedCount, seated, lyingCount, lying: false,
    };
  }
  return {
    hipX: prev.hipX + alpha * (hipX - prev.hipX),
    hipY: prev.hipY + alpha * (hipY - prev.hipY),
    torso: prev.torso + alpha * (bounded - prev.torso),
    footY: prev.footY == null ? footTarget : prev.footY + alpha * (footTarget - prev.footY),
    footMiss,
    footReal: footIsReal,
    limbs, seatedCount, seated, lyingCount, lying: false,
  };
}

/**
 * Placement before a body has been seen: centered in the displayed camera picture, full height.
 * (videoW / videoH optional: without them the whole view is used.)
 */
export function defaultPlacement(viewW, viewH, videoW = null, videoH = null) {
  const box = videoW && videoH ? frameTransform(videoW, videoH, viewW, viewH).box : { x: 0, y: 0, w: viewW, h: viewH };
  return { origin: { x: box.x + box.w / 2, y: box.y + box.h * 0.55 }, scale: box.h / 5.2, feetY: null };
}

/**
 * Where and how big to draw the Ghost on the overlay canvas (same size as the camera view).
 * @returns {{ origin: {x,y}, scale: number, feetY: number|null }} - scale = canvas px per Ghost body unit
 */
export function overlayPlacement(anchor, videoW, videoH, viewW, viewH) {
  const map = frameTransform(videoW, videoH, viewW, viewH, 'contain');
  // exactly the trainee's size (only a microscopic Ghost is prevented)
  const minScale = map.box.h / 18;
  return {
    origin: map(anchor.hipX, anchor.hipY),
    scale: Math.max(minScale, (anchor.torso * map.scaleY) / GHOST_TORSO_UNITS),
    feetY: typeof anchor.footY === 'number' && !anchor.seated && !anchor.lying ? map(anchor.hipX, anchor.footY).y : null,
    body: { limbs: anchor.limbs || null, seated: !!anchor.seated, lying: !!anchor.lying, headDir: anchor.headDir || null },
  };
}

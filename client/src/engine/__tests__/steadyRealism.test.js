import { describe, it, expect } from 'vitest';
import { createLandmarkFilter, filterLandmarks, HOLD_MS } from '../landmarkFilter.js';
import { bodyAnchor, overlayPlacement } from '../ghostOverlay.js';
import { shadowBallAt } from '../warmupGhost.js';
import { profileGhostPose } from '../exercise/profileGhost.js';
import { EXPERT_PROFILES } from '../exercise/exerciseProfiles.js';
import { catalogGhostSpec, buildCatalog } from '../catalog/catalog.js';
import { getLimbProfile } from '../limbProfile.js';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });

const frame = (dx = 0, noise = () => 0) => Array.from({ length: 33 }, (_, i) => ({
  x: 0.4 + (i % 5) * 0.05 + dx + noise(), y: 0.2 + Math.floor(i / 5) * 0.1 + noise(), z: 0, visibility: 0.9,
}));

describe('Steady skeleton — One Euro landmark filter', () => {
  it('a still body does not tremble', () => {
    const f = createLandmarkFilter();
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.01; };   // ±0.5% jitter
    let maxStep = 0, prev = null;
    for (let i = 0; i < 120; i++) {
      const out = filterLandmarks(f, frame(0, rnd), i * 33);
      if (prev && i > 10) maxStep = Math.max(maxStep, Math.abs(out[12].x - prev[12].x));
      prev = out;
    }
    expect(maxStep).toBeLessThan(0.0025);        // raw jitter steps up to 0.01
  });

  it('a fast move is followed closely (no lag that hides a kick)', () => {
    const f = createLandmarkFilter();
    for (let i = 0; i < 10; i++) filterLandmarks(f, frame(0), i * 33);
    let out;
    for (let i = 10; i < 16; i++) out = filterLandmarks(f, frame((i - 9) * 0.03), i * 33);   // 0.9 /s
    expect(out[12].x - frame(0.18)[12].x).toBeGreaterThan(-0.03);   // within 3% of the true position
  });

  it('a missed detection is bridged briefly, a long gap is "no body"', () => {
    const f = createLandmarkFilter();
    filterLandmarks(f, frame(), 0);
    const held = filterLandmarks(f, null, 100);
    expect(held).not.toBeNull();
    expect(held.held).toBe(true);
    expect(filterLandmarks(f, null, HOLD_MS + 50)).toBeNull();
  });

  it('a jump of the whole body restarts the filter (no slow slide across the screen)', () => {
    const f = createLandmarkFilter();
    for (let i = 0; i < 5; i++) filterLandmarks(f, frame(), i * 33);
    const out = filterLandmarks(f, frame(0.45), 200);
    expect(out[12].x).toBeCloseTo(frame(0.45)[12].x, 6);
  });
});

describe('Big Ghost — always on screen', () => {
  const body = (ankleY) => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
    const put = (i, x, y) => { lm[i] = { x, y, z: 0, visibility: 0.95 }; };
    put(11, 0.55, 0.3); put(12, 0.45, 0.3); put(23, 0.53, 0.6); put(24, 0.47, 0.6);
    put(27, 0.53, ankleY); put(28, 0.47, ankleY);
    return lm;
  };

  it('ankles guessed below the picture are ignored — the feet are predicted from the body', () => {
    const a = bodyAnchor(body(1.35), null);          // MediaPipe "guesses" feet off-screen
    expect(a.footY).toBeLessThan(1);
    expect(a.footReal).toBe(false);
    const pl = overlayPlacement(a, 640, 480, 640, 480);
    expect(pl.feetY).toBeLessThan(480);
  });

  it('real feet in the frame are used', () => {
    const a = bodyAnchor(body(0.92), null);
    expect(a.footY).toBeCloseTo(0.92, 6);
    expect(a.footReal).toBe(true);
  });
});

describe('The striking surface of the foot — like a real player', () => {
  const kickId = buildCatalog('field', lpOk).find(i => i.patternId === 'shadowKick').id;
  const passId = buildCatalog('field', lpOk).find(i => i.patternId === 'shadowPass').id;

  it('instep kick: toes pointed through the swing, the LACES marked; pass: foot turned out, the INSIDE marked', () => {
    const kick = profileGhostPose(EXPERT_PROFILES.footballKick, 0.48, lpOk);
    const kf = Object.values(kick.feet).find(f => f.patch);
    expect(kf.style).toBe('laces');
    expect(kf.dir.y).toBeGreaterThan(0.2);            // toes pointing down (plantar flexion)
    expect(kf.contact).toBeGreaterThan(0.9);          // the contact flash at the strike
    const pass = profileGhostPose(EXPERT_PROFILES.shadowPass, 0.48, lpOk);
    const pf = Object.values(pass.feet).find(f => f.patch);
    expect(pf.style).toBe('inside');
    expect(Math.abs(pf.dir.x)).toBeGreaterThan(0.6);  // foot turned out (sideways)
    expect(pf.normal.z).toBeLessThan(-0.9);           // the inside of the foot faces the target
  });

  it('a planted foot stays flat on the floor', () => {
    const squat = profileGhostPose(EXPERT_PROFILES.squat, 0.5, lpOk);
    for (const f of Object.values(squat.feet)) expect(Math.abs(f.dir.y)).toBeLessThan(0.05);
  });

  it('at contact the ball touches the striking surface', () => {
    for (const [id, prof] of [[kickId, EXPERT_PROFILES.footballKick], [passId, EXPERT_PROFILES.shadowPass]]) {
      const spec = catalogGhostSpec(id);
      const ball = shadowBallAt(spec, 0.3, lpOk);
      const contact = profileGhostPose(spec.profile, spec.profile.ghost.contactT, lpOk);
      const foot = Object.values(contact.feet).find(f => f.patch);
      const d = Math.hypot(ball.x - foot.patch.x, ball.y - foot.patch.y, ball.z - foot.patch.z);
      expect(d, prof.id).toBeLessThan(ball.r * 1.35);
    }
  });
});

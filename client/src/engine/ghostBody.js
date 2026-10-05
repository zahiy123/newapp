// Ghost body model in "body units" (hip center = origin, y grows downward).
// Shared by the warm-up Ghost (warmupGhost.js) and the profile Ghost (exercise/profileGhost.js).
export const GHOST_BODY = Object.freeze({
  shoulderY: -1.4, shoulderX: 0.42, hipX: 0.21, waistY: -0.55, waistX: 0.27,
  upperArm: 0.6, forearm: 0.55, thigh: 0.9, shin: 0.88,
  headY: -1.8, headR: 0.22,
});

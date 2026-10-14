// ============================================================
// exerciseNav — moving between the exercises of the workout (owner, 2026-10-14: an IRON RULE)
//
// PURE. The trainee's manual navigation is the ONLY thing that moves them:
//   1. a skip / "next" moves forward AT ONCE to the next exercise and stays there
//   2. nothing may force them back or override their choice — no late callback, no background job
//   3. the same for every sport
// The bug it replaces: "next" moved only AFTER a network call (the workout adaptation, seconds) and
// computed the target from the index captured at the tap — a second tap / a pick from the list in
// the meantime was then overridden and the trainee was thrown BACK.
// The live index lives here (not in a render's closure); every move bumps `seq`, so a background
// job started earlier can tell that the trainee has moved since — and drops its result.
// ============================================================

/** The navigation state of one workout. */
export function createExerciseNav(idx = 0) {
  return { idx: Math.max(0, idx | 0), seq: 0 };
}

/** Go to an exercise (the trainee's choice). Returns the index now shown. */
export function navGo(nav, target, total) {
  if (!nav || !(total > 0)) return nav?.idx ?? 0;
  const t = Math.max(0, Math.min(total - 1, target | 0));
  if (t !== nav.idx) { nav.idx = t; nav.seq += 1; }
  return nav.idx;
}

/** Skip / next: one exercise FORWARD from where the trainee IS now. null = it was the last one. */
export function navNext(nav, total) {
  if (!nav || nav.idx >= total - 1) return null;
  return navGo(nav, nav.idx + 1, total);
}

/** Back — only on the trainee's explicit "previous". null = already the first. */
export function navPrev(nav, total) {
  if (!nav || nav.idx <= 0) return null;
  return navGo(nav, nav.idx - 1, total);
}

/** Has the trainee stayed where they were when a background job started (seq taken then)? */
export function navUnchangedSince(nav, seq) {
  return !!nav && nav.seq === seq;
}

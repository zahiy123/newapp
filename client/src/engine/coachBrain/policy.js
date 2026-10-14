// ============================================================
// policy — Layer 3 of the coach brain: REINFORCEMENT LEARNING FROM EXPERT FEEDBACK (owner, 2026-10-14)
//
// PURE. WHAT to say, HOW (the tone / style) and WHEN — without hurting motivation:
//   expert prior  the way real human coaches give a correction (coaching-principles): safety first,
//                 then the foundation, then precision; ONE correction between attempts (never during
//                 the effort peak, never two in a row); an external-focus cue; a frustrated trainee
//                 gets a calm, single cue; a tired one a short one. These are the starting beliefs.
//   learning      per trainee, a Thompson-sampling bandit over the correction STYLES: the reward is
//                 the measured outcome — the corrected error does NOT come back in the next attempts.
//                 Over sessions the coach learns which way of saying it works for THIS trainee.
//   timing        a correction is held until the attempt ends (between reps), with a gap after the
//                 last line; a danger is never delayed (handled before the policy).
// Honest scope: the prior is authored from expert coaching practice; a dataset of recorded human
// coaches (demonstrations) is the planned next source of the prior — the learning loop is live now.
// ============================================================

export const STYLES = Object.freeze(['direct', 'why', 'external', 'calm']);

// The expert prior: how much a human coach would use each style in each situation (Beta pseudo-counts)
const PRIOR = {
  normal:      { direct: [3, 2], why: [4, 2], external: [3, 2], calm: [1, 2] },
  frustrated:  { direct: [1, 3], why: [1, 3], external: [3, 2], calm: [4, 1] },
  tired:       { direct: [4, 1], why: [1, 3], external: [2, 2], calm: [3, 2] },
};

export const MIN_GAP_MS = 6000;      // never two corrections closer than this
export const REWARD_ATTEMPTS = 3;    // the outcome of a correction = the next attempts

/** The situation the trainee is in (from the behavior layer). */
export function situationOf(state) {
  if ((state?.frustration ?? 0) >= 0.4) return 'frustrated';
  if ((state?.fatigue ?? 0) >= 0.4) return 'tired';
  return 'normal';
}

/** A new policy, or the trainee's learned one ({ arms: { situation: { style: [a, b] } } }). */
export function createPolicy(saved = null) {
  const arms = {};
  for (const [sit, styles] of Object.entries(PRIOR)) {
    arms[sit] = {};
    for (const st of STYLES) {
      const learned = saved?.arms?.[sit]?.[st];
      arms[sit][st] = Array.isArray(learned) && learned.length === 2 ? [...learned] : [...styles[st]];
    }
  }
  return { arms, pending: null };
}

// a Beta(a, b) sample (two Gamma samples; Marsaglia–Tsang for shape ≥ 1, boosted below 1)
function gamma(k, rnd) {
  if (k < 1) return gamma(k + 1, rnd) * Math.pow(rnd(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      const u1 = rnd() || 1e-9, u2 = rnd();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const betaSample = (a, b, rnd) => { const x = gamma(a, rnd), y = gamma(b, rnd); return x / (x + y); };

/**
 * Choose the style for this correction (Thompson sampling within the situation).
 * @param {{ hasExternal?: boolean, hasWhy?: boolean }} rule - which texts the correction has
 */
export function chooseStyle(policy, situation, rule = {}, rnd = Math.random) {
  const arms = policy.arms[situation] || policy.arms.normal;
  let best = 'direct', bestV = -1;
  for (const st of STYLES) {
    if (st === 'why' && !rule.hasWhy) continue;
    if (st === 'external' && !rule.hasExternal) continue;
    const [a, b] = arms[st];
    const v = betaSample(a, b, rnd);
    if (v > bestV) { bestV = v; best = st; }
  }
  return best;
}

/**
 * When to say it (the expert timing): between attempts, after the gap, not over another line.
 * @param {{ sinceVoiceMs: number, betweenAttempts: boolean, coachSpeaking?: boolean }} c
 */
export function timingOk(c) {
  return !c.coachSpeaking && c.betweenAttempts && c.sinceVoiceMs >= MIN_GAP_MS;
}

/** The correction's words in the chosen style. rule: { msg:{he,en}, why?:{he,en}, external?:{he,en} } */
export function renderCorrection(rule, style, he = true) {
  const L = (o) => (o ? (he ? o.he : o.en) : '');
  const msg = L(rule.msg);
  switch (style) {
    case 'why': return rule.why ? `${msg}. ${L(rule.why)}` : msg;
    case 'external': return rule.external ? L(rule.external) : msg;
    case 'calm': return he ? `בלי לחץ — רק דבר אחד: ${msg}` : `No pressure — just one thing: ${msg}`;
    default: return msg;
  }
}

/** A correction was given: its outcome is judged on the next attempts. */
export function policyGiven(policy, { ruleId, style, situation }) {
  policy.pending = { ruleId, style, situation, seen: 0, repeats: 0 };
  return policy;
}

/**
 * One attempt after a correction: did the corrected error come back?
 * @returns {null | { reward: 0|1, ruleId, style }} - the outcome once REWARD_ATTEMPTS have passed
 */
export function policyAttempt(policy, errorIds) {
  const p = policy?.pending;
  if (!p) return null;
  p.seen += 1;
  if ((errorIds || []).includes(p.ruleId)) p.repeats += 1;
  if (p.seen < REWARD_ATTEMPTS) return null;
  const reward = p.repeats <= 1 ? 1 : 0;           // fixed (at most one slip) = the cue worked
  const arm = policy.arms[p.situation]?.[p.style];
  if (arm) { if (reward) arm[0] += 1; else arm[1] += 1; }
  policy.pending = null;
  return { reward, ruleId: p.ruleId, style: p.style };
}

/** What is saved per trainee (the learned beliefs). */
export function policySnapshot(policy) {
  return { v: 1, arms: policy.arms };
}

// ============================================================
// agreement — system verdict vs. human labels (Stage 3.1 validation dataset)
//
// PURE. Labelled clips ({ clip, label: 'good'|'fault', faults?: ruleId[] }) are the ground
// truth. This module:
//   • replays a stored clip through the live evaluator (any profile variant) → issues
//   • reports agreement: % agreement, false alarms (system flagged a good rep — the worst
//     case for trust), misses (a human-marked fault the system did not flag), per rule
//   • tunes a rule: replays every clip with candidate thresholds and ranks them — so a
//     threshold is chosen from data, not guessed
// ============================================================

import { createExecutionTracker, updateExecution } from '../exercise/profileEvaluator.js';
import { decodeFrame } from './clipRecorder.js';

/** Re-run a clip through the evaluator; returns the set of rule ids raised. */
export function replayClip(profile, clip, lp = {}) {
  const tr = createExecutionTracker(profile, lp);
  // Prime the in-view / confidence hysteresis with the first frame (the clip was recorded trusted)
  const first = decodeFrame(clip.frames[0]?.f);
  for (let k = 0; k < 5; k++) updateExecution(tr, first, -250 + k * 50);
  const ids = new Set();
  for (const fr of clip.frames) {
    const r = updateExecution(tr, decodeFrame(fr.f), fr.t);
    for (const i of r.issues) ids.add(i.id);
  }
  return ids;
}

/**
 * @param {Array<{ clip: Object, label: 'good'|'fault', faults?: string[] }>} labelled
 * @param {(item) => Set<string>|string[]} [verdictOf] - system issues per item (default: recorded verdict)
 */
export function agreementReport(labelled, verdictOf = (it) => it.clip.verdict?.issues || []) {
  const out = { n: 0, agree: 0, agreementPct: null, falseAlarms: 0, misses: 0, perRule: {} };
  const rule = (id) => (out.perRule[id] ||= { flagged: 0, flaggedOnGood: 0, confirmed: 0, missed: 0 });
  for (const it of labelled || []) {
    if (it.label !== 'good' && it.label !== 'fault') continue;
    const issues = [...(verdictOf(it) || [])];
    const flagged = issues.length > 0;
    out.n += 1;
    if (flagged === (it.label === 'fault')) out.agree += 1;
    if (flagged && it.label === 'good') out.falseAlarms += 1;
    if (!flagged && it.label === 'fault') out.misses += 1;
    for (const id of issues) {
      const r = rule(id);
      r.flagged += 1;
      if (it.label === 'good') r.flaggedOnGood += 1;
      else if (!it.faults?.length || it.faults.includes(id)) r.confirmed += 1;
    }
    if (it.label === 'fault') for (const id of it.faults || []) if (!issues.includes(id)) rule(id).missed += 1;
  }
  out.agreementPct = out.n ? Math.round((100 * out.agree) / out.n) : null;
  return out;
}

/** The profile with one rule's threshold replaced (static or dynamic rule). */
export function withThreshold(profile, ruleId, value) {
  const swap = (list) => (list || []).map(r => (r.id === ruleId ? { ...r, value } : r));
  return { ...profile, rules: swap(profile.rules), dynamics: swap(profile.dynamics) };
}

/**
 * Rank candidate thresholds of a rule by agreement on the labelled clips of this profile
 * (ties: fewer false alarms first — a wrong correction costs more trust than silence).
 * @returns {Array<{ value, agreementPct, falseAlarms, misses, n }>}
 */
export function tuneRule(profile, ruleId, candidates, labelled, lp = {}) {
  const items = (labelled || []).filter(it => it.clip.profileId === profile.id);
  return candidates.map((value) => {
    const variant = withThreshold(profile, ruleId, value);
    const rep = agreementReport(items, it => replayClip(variant, it.clip, lp));
    return { value, agreementPct: rep.agreementPct, falseAlarms: rep.falseAlarms, misses: rep.misses, n: rep.n };
  }).sort((a, b) => (b.agreementPct ?? -1) - (a.agreementPct ?? -1) || a.falseAlarms - b.falseAlarms);
}

/** Candidate thresholds around a rule's current value (±30%, 7 steps). */
export function candidatesAround(value, steps = 7, spread = 0.3) {
  const out = [];
  for (let k = 0; k < steps; k++) out.push(Math.round(value * (1 - spread + (2 * spread * k) / (steps - 1)) * 100) / 100);
  return out;
}

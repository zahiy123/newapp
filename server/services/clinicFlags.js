// ============================================================
// clinicFlags — the RED FLAGS of a patient in the clinician's list (Stage 4B step 3, 2026-11-04)
//
// PURE. From the patient's recent workouts + pain log (newest first or any order):
//   red_pain        a red pain report (6+) in the last 7 days
//   repeated_yellow 2+ yellow reports (4–5) in the last 7 days
//   safe_mode       safe mode chosen in the last 7 days
//   rom_drop        a joint's latest range ≥ 15° below its best of the earlier workouts, in the last 2 workouts
//   stepped_down    the complexity step went DOWN (2 struggling workouts)
//   inactive        no workout in the last 7 days (and at least one before)
// Each flag: { code, severity: 'red'|'amber', detail }. Sorted red first.
// ============================================================

const DAY = 864e5;
const atOf = (x) => Number(x?.at) || Number(x?.date) || 0;

export function patientFlags({ workouts = [], pains = [], now = Date.now(), locked = false }) {
  const ws = [...workouts].sort((a, b) => atOf(a) - atOf(b));                 // oldest first
  const recent = (x) => now - atOf(x) <= 7 * DAY;
  const allPain = [...pains, ...ws.flatMap(w => (w.painReports || []).map(p => ({ ...p, at: Number(p.at) || atOf(w) })))];
  // the same report may be in both the pain log and the workout: one per (at, level, zone)
  const seen = new Set();
  const painList = allPain.filter(p => { const k = `${p.at}|${p.level}|${p.zone}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const flags = [];
  if (locked) flags.push({ code: 'locked', severity: 'red', detail: {} });
  const reds = painList.filter(p => recent(p) && Number(p.level) >= 6);
  if (reds.length) flags.push({ code: 'red_pain', severity: 'red', detail: { level: Math.max(...reds.map(p => Number(p.level))), zone: reds[0].zone || null, count: reds.length } });
  const yellows = painList.filter(p => recent(p) && Number(p.level) >= 4 && Number(p.level) <= 5);
  if (yellows.length >= 2) flags.push({ code: 'repeated_yellow', severity: 'amber', detail: { count: yellows.length } });
  if (painList.some(p => recent(p) && p.choice === 'safe_mode')) flags.push({ code: 'safe_mode', severity: 'red', detail: {} });

  const withRom = ws.filter(w => w.rom && Object.keys(w.rom).length);
  if (withRom.length >= 3) {
    const lastTwo = withRom.slice(-2);
    const before = withRom.slice(0, -2);
    for (const joint of Object.keys(lastTwo[1].rom || {})) {
      const best = Math.max(...before.map(w => Number(w.rom?.[joint]) || 0));
      const latest = lastTwo.map(w => Number(w.rom?.[joint]) || 0);
      if (best > 0 && latest.every(v => v > 0 && best - v >= 15)) {
        flags.push({ code: 'rom_drop', severity: 'amber', detail: { joint, best, latest: latest[1] } });
        break;
      }
    }
  }
  const v2 = ws.filter(w => w.dataVersion >= 2);
  if (v2.length >= 2 && (Number(v2[v2.length - 1].loadStep) || 0) < (Number(v2[v2.length - 2].loadStep) || 0)) {
    flags.push({ code: 'stepped_down', severity: 'amber', detail: { step: Number(v2[v2.length - 1].loadStep) || 0 } });
  }
  if (ws.length && !ws.some(recent)) flags.push({ code: 'inactive', severity: 'amber', detail: { days: Math.floor((now - atOf(ws[ws.length - 1])) / DAY) } });
  return flags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'red' ? -1 : 1));
}

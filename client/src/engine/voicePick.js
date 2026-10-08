// ============================================================
// voicePick — choose the coach's voice EXPLICITLY from the voices the device really has
// (owner field test, 2026-10-08: "the female coach still speaks with a man's voice")
//
// PURE. window.speechSynthesis.getVoices() is the only truth: we keep the voices of the language,
// score them for the coach's gender by their names (Carmit / Hila … female; Asaf / Avri … male;
// "female" / "male" in the name), prefer the trainee's own saved choice, and say whether the
// choice is CONFIDENT. When a device has no female Hebrew voice at all, the caller raises the pitch
// clearly and the voice screen tells the trainee how to install one.
// ============================================================

const FEMALE = /\bfemale\b|woman|נשי|carmit|כרמית|hila|הילה|zira|samantha|karen|victoria|susan|tessa|moira|fiona|sivan|yael|noa|hebrew.*\bf\b/i;
const MALE = /\bmale\b|\bman\b|גברי|asaf|אסף|avri|אברי|david|mark|daniel|alex|fred|james|george|guy/i;
const QUALITY = /natural|neural|online|enhanced|premium|wavenet/i;

const langOf = (v) => String(v?.lang || '').toLowerCase().replace('_', '-');

/** Voices of a language ("he" matches he-IL / he_IL; the legacy "iw" code too). */
export function voicesFor(voices, lang = 'he-IL') {
  const pre = String(lang).slice(0, 2).toLowerCase();
  const alt = pre === 'he' ? 'iw' : pre;
  return (voices || []).filter(v => { const l = langOf(v); return l.startsWith(pre) || l.startsWith(alt); });
}

/** The gender a voice name tells (null = unknown). */
export function voiceGender(v) {
  const n = `${v?.name || ''} ${v?.voiceURI || ''}`;
  if (FEMALE.test(n)) return 'female';
  if (MALE.test(n)) return 'male';
  return null;
}

/** Score of a voice for a coach (higher is better). */
export function scoreVoice(v, gender) {
  const g = voiceGender(v);
  let s = 0;
  if (g === gender) s += 30;
  else if (g && g !== gender) s -= 30;
  if (QUALITY.test(v?.name || '')) s += 4;
  if (v?.localService) s += 2;
  return s;
}

/**
 * The coach's voice.
 * @returns {{ voice: SpeechSynthesisVoice|null, confident: boolean, candidates: Array }}
 *   confident = the voice is known to be of the coach's gender (or the trainee chose it)
 */
export function pickCoachVoice(voices, gender, lang = 'he-IL', savedURI = null) {
  const list = voicesFor(voices, lang);
  const candidates = list.map(v => ({ v, score: scoreVoice(v, gender), gender: voiceGender(v) }))
    .sort((a, b) => b.score - a.score);
  if (savedURI) {
    const saved = list.find(v => v.voiceURI === savedURI || v.name === savedURI);
    if (saved) return { voice: saved, confident: true, candidates };
  }
  const best = candidates[0];
  if (!best) return { voice: null, confident: false, candidates };
  return { voice: best.v, confident: best.gender === gender, candidates };
}

/** Pitch for the coach when no voice of its gender exists on the device: clearly different. */
export function fallbackPitch(gender) {
  return gender === 'female' ? 1.45 : gender === 'male' ? 0.8 : 1;
}

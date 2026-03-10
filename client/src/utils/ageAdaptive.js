// Age-adaptive coaching configuration
// Controls TTS rate, pitch, and coaching style based on athlete age

const AGE_GROUPS = {
  kids:   { min: 0,  max: 12, rate: 1.0,  pitch: 1.1,  style: 'playful' },
  youth:  { min: 13, max: 18, rate: 1.15, pitch: 1.05, style: 'push' },
  adults: { min: 19, max: 40, rate: 1.3,  pitch: 1.0,  style: 'aggressive' },
  older:  { min: 41, max: 60, rate: 1.1,  pitch: 0.95, style: 'technical' },
  senior: { min: 61, max: 999, rate: 0.9, pitch: 0.9,  style: 'gentle' },
};

export function getAgeGroup(age) {
  const a = Number(age) || 25;
  for (const [key, group] of Object.entries(AGE_GROUPS)) {
    if (a >= group.min && a <= group.max) return key;
  }
  return 'adults';
}

export function getCoachingRate(age) {
  return AGE_GROUPS[getAgeGroup(age)]?.rate ?? 1.2;
}

export function getCoachingPitch(age) {
  return AGE_GROUPS[getAgeGroup(age)]?.pitch ?? 1.0;
}

export function getCoachingStyle(age) {
  return AGE_GROUPS[getAgeGroup(age)]?.style ?? 'aggressive';
}

// Server-side prompt snippet for Claude to match the coaching tone
export function getAgeStylePrompt(age) {
  const style = getCoachingStyle(age);
  const prompts = {
    playful:    'Use a fun, playful tone. Use words like "!וואו", "!סבבה", "!אלוף". Short sentences. Make it feel like a game.',
    push:       'Use an energetic, motivating tone. Challenge them: "!אתה מכונה", "!תראה לי מה יש לך". Push hard but respect.',
    aggressive: 'Use an intense, aggressive coaching tone. Direct commands: "!תדחוף חזק", "!אל תוותר", "!עוד אחד". No softness.',
    technical:  'Use a calm, technical tone. Focus on form: "שמור על טכניקה", "תנועה מבוקרת". Precise corrections.',
    gentle:     'Use a warm, gentle tone. Encourage: "יפה מאוד", "לאט ובטוח", "מצוין, ככה". Never rush.',
  };
  return prompts[style] || prompts.aggressive;
}

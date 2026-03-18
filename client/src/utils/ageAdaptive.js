// Age-adaptive coaching configuration
// Controls TTS rate, pitch, and coaching style based on athlete life-stage (3 brackets)

const AGE_GROUPS = {
  kids:        { min: 5,  max: 12, rate: 1.0,  pitch: 1.15, style: 'playful' },
  performance: { min: 13, max: 50, rate: 1.3,  pitch: 1.0,  style: 'aggressive' },
  longevity:   { min: 51, max: 99, rate: 0.95, pitch: 0.9,  style: 'gentle' },
};

export function getAgeGroup(age) {
  const a = Number(age) || 25;
  for (const [key, group] of Object.entries(AGE_GROUPS)) {
    if (a >= group.min && a <= group.max) return key;
  }
  return 'performance';
}

export function getLifeStage(age) {
  return getAgeGroup(age);
}

export function isAgeValid(age) {
  const a = Number(age);
  return Number.isFinite(a) && a >= 5 && a <= 99;
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

// Exercise filter by age group — returns banned keywords and age-appropriate replacements
export function getAgeExerciseFilter(age) {
  const stage = getLifeStage(age);

  if (stage === 'kids') {
    return {
      banned: [
        'דיפס', 'dip', 'שקיעות', 'טריצפס', 'tricep',
        'משיכת משקולת', 'bent over row',
        'לחיצת כתפ', 'shoulder press',
        'ישיבה על הקיר', 'wall sit',
        'מתיחת גומייה', 'band pull apart',
      ],
      replacements: [
        { name: 'קפיצות צפרדע', description: 'קפיצות כמו צפרדע קדימה', sets: 2, reps: '8', restSeconds: 45, tips: 'נחיתה רכה על כפות הרגליים' },
        { name: 'הליכת דוב', description: 'הליכה על ידיים ורגליים כמו דוב', sets: 2, reps: '10', restSeconds: 45, tips: 'שמור על ברכיים כפופות קלות' },
        { name: 'קפיצות על רגל אחת', description: 'קפיצות על רגל אחת קדימה', sets: 2, reps: '8', restSeconds: 45, tips: 'שמור על איזון' },
        { name: 'ריצת עכביש', description: 'ריצה נמוכה עם תנועות צד', sets: 2, reps: '10', restSeconds: 45, tips: 'הישאר נמוך' },
        { name: 'קפיצות כוכב', description: 'קפיצה למעלה עם פתיחת ידיים ורגליים', sets: 2, reps: '10', restSeconds: 45, tips: 'נחיתה רכה' },
        { name: 'איזון על רגל אחת', description: 'עמידה על רגל אחת למשך 20 שניות', sets: 2, reps: '20', restSeconds: 30, tips: 'מבט קדימה לנקודה קבועה' },
      ],
    };
  }

  if (stage === 'longevity') {
    return {
      banned: [
        'בורפי', 'burpee',
        'jumping jack', "ג'אמפינג", 'קפיצות פיצוח',
        'ספרינט', 'sprint',
        'מטפס הרים', 'mountain climber',
      ],
      replacements: [
        { name: 'הליכה מהירה', description: 'הליכה מהירה במקום', sets: 3, reps: '30', restSeconds: 60, tips: 'שמור על קצב נשימה יציב' },
        { name: 'גשר ישבן', description: 'הרמת ירכיים שכיבה על הגב', sets: 3, reps: '10', restSeconds: 60, tips: 'סחוט את הישבן למעלה, תנועה איטית' },
        { name: 'איזון על רגל אחת', description: 'עמידה על רגל אחת ליד קיר', sets: 3, reps: '20', restSeconds: 45, tips: 'החזק ליד קיר לביטחון' },
        { name: 'מתיחות כתפיים', description: 'סיבובי כתפיים ומתיחות', sets: 3, reps: '10', restSeconds: 45, tips: 'תנועות רכות ומבוקרות' },
        { name: 'ישיבה על הקיר', description: 'ישיבה על הקיר ללא כיסא', sets: 3, reps: '20', restSeconds: 60, tips: 'שמור על גב צמוד לקיר' },
        { name: 'פלאנק', description: 'החזקה בתנוחת פלאנק', sets: 3, reps: '20', restSeconds: 60, tips: 'נשום בקצב יציב, שמור על גב ישר' },
      ],
    };
  }

  // performance (13-50): full access
  return { banned: [], replacements: [] };
}

// Server-side prompt snippet for Claude to match the coaching tone
export function getAgeStylePrompt(age) {
  const style = getCoachingStyle(age);
  const prompts = {
    playful:    'Use a fun, playful, gamified tone. Use words like "!וואו", "!סבבה", "!אלוף". Short sentences. Make it feel like a game. Celebrate every small win.',
    aggressive: 'Use an intense, aggressive coaching tone. Direct commands: "!תדחוף חזק", "!אל תוותר", "!עוד אחד". Bio-mechanical precision feedback. Challenge the athlete.',
    gentle:     'Use a warm, gentle, safety-first tone. Encourage: "לאט ובטוח", "מצוין, ככה", "יפה מאוד". Focus on joint health, breathing reminders, and controlled movement. Never rush.',
  };
  return prompts[style] || prompts.aggressive;
}

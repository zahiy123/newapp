// ============================================================
// coachVoiceText — the coach speaks in its own gender (owner, 2026-10-08)
//
// PURE. All coach lines are written in the masculine first person ("אני סופר איתך"). When the
// trainee picks the female coach, every first-person form the coach says about ITSELF becomes
// feminine ("אני סופרת איתך", "אני עוקבת אחריך", "אני לא מצליחה לראות"). Words addressed to the
// trainee are left unchanged. Used for the voice and for the coach's speech bubble.
// ============================================================

// masculine → feminine present-tense forms that follow "אני" / "אני לא"
const FEMININE = {
  'סופר': 'סופרת', 'עוקב': 'עוקבת', 'מוכן': 'מוכנה', 'מצליח': 'מצליחה', 'צריך': 'צריכה',
  'ממשיך': 'ממשיכה', 'יכול': 'יכולה', 'בטוח': 'בטוחה', 'שמח': 'שמחה', 'חושב': 'חושבת',
  'אוהב': 'אוהבת', 'מאמין': 'מאמינה', 'מבין': 'מבינה', 'מתחיל': 'מתחילה', 'נותן': 'נותנת',
  'מסביר': 'מסבירה', 'מראה': 'מראה', 'בודק': 'בודקת', 'שומע': 'שומעת', 'גאה': 'גאה',
  'מחכה': 'מחכה', 'רואה': 'רואה', 'רוצה': 'רוצה', 'צופה': 'צופה', 'מתקשה': 'מתקשה',
  'מדגים': 'מדגימה', 'מלווה': 'מלווה', 'סומך': 'סומכת', 'זוכר': 'זוכרת', 'מכיר': 'מכירה',
};
const FORMS = Object.keys(FEMININE).sort((a, b) => b.length - a.length).join('|');
// "אני X", "אני לא X", "אני עדיין X", "אני כבר X", "אני פה ו..." is not touched
const SELF = new RegExp(`(^|[^א-ת])(אני(?: לא| עדיין| כבר| גם| תמיד| פשוט)?) (${FORMS})(?=$|[^א-ת])`, 'g');

/** The coach line in the coach's gender ('female' → feminine first person; otherwise unchanged). */
export function genderizeCoachText(text, coach) {
  if (coach !== 'female' || !text) return text;
  return String(text).replace(SELF, (m, pre, ani, verb) => `${pre}${ani} ${FEMININE[verb] || verb}`);
}

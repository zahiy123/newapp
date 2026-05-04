import { getAgeExerciseFilter } from './ageAdaptive';

const PLAN_KEY = 'training_plan';
const PROGRESS_KEY = 'training_progress';

// === CLIENT-SIDE CROSS-SPORT FILTER ===
// Mirrors server/services/claude.js BANNED_KEYWORDS_BY_SPORT
const BANNED_KEYWORDS = {
  fitness: [
    'כדור', 'שער', 'דריבל', 'דריבלינג', 'קליעה', 'בעיטה', 'בעיטות',
    'מסירה', 'מסירות', 'כדרור', 'חרוטים', 'קונוסים',
    'זריקה לסל', 'הנחתה', 'הגשה', 'סל', 'טניס', 'מחבט', 'פורהנד', 'בקהנד',
    'גול', 'שוער', 'עמדת שוער', 'חסימה', 'נגיחה', 'פנדל', 'קורנר',
    'ריצה עם כדור', 'שליטה בכדור', 'קבלת כדור',
  ],
  football: [
    'סל', 'קליעה לסל', 'חישוק', 'כדרור ביד', 'זריקה לסל', 'הנחתה',
    'טניס', 'מחבט', 'פורהנד', 'בקהנד', 'רשת', 'כיסא גלגלים',
  ],
  basketball: [
    'בעיטה', 'בעיטות', 'שער', 'גול', 'קורנר', 'פנדל', 'נגיחה', 'שוער', 'קביים',
    'טניס', 'מחבט', 'פורהנד', 'בקהנד',
  ],
  tennis: [
    'בעיטה', 'בעיטות', 'שער', 'גול', 'קורנר', 'פנדל', 'נגיחה', 'שוער',
    'סל', 'קליעה לסל', 'חישוק', 'כדרור ביד', 'הנחתה', 'קביים',
  ],
};

const SPORT_ALIAS = {
  footballAmputee: 'football', footballAmputeeGK: 'football',
  basketballWheelchair: 'basketball', tennisWheelchair: 'tennis',
};

const FITNESS_REPLACEMENTS = [
  { name: 'בורפיז', description: 'בורפיז מלאים בקצב גבוה', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על טכניקה נכונה' },
  { name: 'מטפס הרים', description: 'תנועת ריצה בתנוחת פלאנק', sets: 3, reps: '20', restSeconds: 60, tips: 'שמור על ירכיים למטה' },
  { name: 'סקוואט קפיצות', description: 'כריעות עם קפיצה פיצוצית', sets: 3, reps: '10', restSeconds: 60, tips: 'נחיתה רכה' },
  { name: 'פלאנק', description: 'החזקה בתנוחת פלאנק', sets: 3, reps: '30', restSeconds: 45, tips: 'שמור על ליבה מחוזקת' },
  { name: 'כפיפות בטן', description: 'כפיפות בטן על הרצפה', sets: 3, reps: '15', restSeconds: 45, tips: 'אל תמשוך את הצוואר' },
  { name: 'שכיבות סמיכה', description: 'שכיבות סמיכה מלאות', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
  { name: 'jumping jacks', description: 'קפיצות פיצוח בקצב מהיר', sets: 3, reps: '30', restSeconds: 45, tips: 'ידיים מלאות מעל הראש' },
  { name: 'ריצת אינטרוולים', description: 'ספרינט 30 שניות, הליכה 30 שניות', sets: 3, reps: '6', restSeconds: 60, tips: 'ספרינט מלא ואז שחרור' },
  { name: 'סקוואט', description: 'כריעות עם משקל הגוף', sets: 3, reps: '12', restSeconds: 60, tips: 'ברכיים מעל האצבעות' },
  { name: 'לאנג\'ים', description: 'מכרעות קדימה לסירוגין', sets: 3, reps: '10', restSeconds: 60, tips: 'צעד גדול קדימה' },
  { name: 'גשר ישבן', description: 'הרמת ירכיים שכיבה על הגב', sets: 3, reps: '12', restSeconds: 60, tips: 'סחוט את הישבן למעלה' },
  { name: 'פלאנק צידי', description: 'החזקה בתנוחת פלאנק צידי', sets: 3, reps: '20', restSeconds: 45, tips: 'שמור על הירכיים גבוהות' },
  { name: 'דיפס', description: 'שקיעות גוף על כיסא או ספסל', sets: 3, reps: '10', restSeconds: 60, tips: 'תנועה מבוקרת, אל תנעל מרפקים' },
  { name: 'ישיבה על הקיר', description: 'ישיבה על הקיר ללא כיסא', sets: 3, reps: '30', restSeconds: 60, tips: 'ברכיים ב-90 מעלות' },
  { name: 'ספרינטים', description: 'ריצות קצרות הלוך וחזור', sets: 3, reps: '8', restSeconds: 90, tips: 'האץ בהדרגה' },
  { name: 'לחיצת כתפיים', description: 'לחיצות כתפיים במשקל גוף או משקולות', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
];

// Sanitize a plan loaded from cache/Firestore — strip any leaked exercises
export function sanitizePlan(plan, sport, age) {
  if (!plan?.weeks) return plan;

  const resolved = SPORT_ALIAS[sport] || sport;
  const sportBanned = BANNED_KEYWORDS[resolved] || [];
  const sportReplacements = resolved === 'fitness' ? FITNESS_REPLACEMENTS : null;

  // Age-based filter
  const ageFilter = getAgeExerciseFilter(age);
  const ageBanned = ageFilter.banned;
  const ageReplacements = ageFilter.replacements;

  if (!sportBanned.length && !ageBanned.length) return plan;

  let dirty = false;
  for (const week of plan.weeks) {
    if (!week?.days) continue;
    for (const day of week.days) {
      if (!day?.exercises) continue;
      const usedNames = new Set();
      day.exercises = day.exercises.map(ex => {
        const lower = (ex.name || '').toLowerCase();

        // Sport-based filter
        const isSportBanned = sportBanned.length > 0 && sportBanned.some(kw => lower.includes(kw));
        if (isSportBanned) {
          dirty = true;
          console.warn(`[Client Filter][${resolved}] Removed: "${ex.name}"`);
          if (!sportReplacements) return null;
          for (const r of sportReplacements) {
            if (!usedNames.has(r.name)) {
              usedNames.add(r.name);
              return { ...r, sets: ex.sets || r.sets, reps: ex.reps || r.reps, restSeconds: ex.restSeconds || r.restSeconds };
            }
          }
          return sportReplacements[0];
        }

        // Age-based filter
        const isAgeBanned = ageBanned.length > 0 && ageBanned.some(kw => lower.includes(kw));
        if (isAgeBanned) {
          dirty = true;
          console.warn(`[Client Filter][age] Removed: "${ex.name}"`);
          if (!ageReplacements.length) return null;
          for (const r of ageReplacements) {
            if (!usedNames.has(r.name)) {
              usedNames.add(r.name);
              return { ...r, sets: ex.sets || r.sets, reps: ex.reps || r.reps, restSeconds: ex.restSeconds || r.restSeconds };
            }
          }
          return ageReplacements[0];
        }

        usedNames.add(ex.name);
        return ex;
      }).filter(Boolean);
    }
  }

  if (dirty) {
    console.warn(`[Client Filter] Plan was sanitized for sport="${resolved}", age=${age}`);
  }
  return plan;
}

// Build a fingerprint from profile settings that affect plan generation
export function buildFingerprint(userProfile) {
  if (!userProfile) return '';
  return JSON.stringify({
    sport: userProfile.sport,
    goals: [...(userProfile.goals || [])].sort(),
    disability: userProfile.disability || 'none',
    skillLevel: userProfile.skillLevel || 'beginner',
    location: userProfile.trainingLocation || 'field',
    equipment: userProfile.equipment || 'none',
    daysPerWeek: userProfile.trainingDays || 3,
  });
}

// Save plan + fingerprint to localStorage (sanitizes before saving)
export function savePlan(plan, fingerprint) {
  try {
    // Sanitize before saving — extract sport from plan or fingerprint
    const sport = plan?.sport || (() => { try { return JSON.parse(fingerprint).sport; } catch { return null; } })();
    const clean = sport ? sanitizePlan(plan, sport) : plan;
    localStorage.setItem(PLAN_KEY, JSON.stringify({
      plan: clean,
      fingerprint,
      savedAt: Date.now(),
    }));
  } catch (err) {
    console.warn('Failed to save plan to localStorage:', err);
  }
}

// Load plan only if fingerprint matches current profile
export function loadPlan(fingerprint) {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.fingerprint !== fingerprint) return null;
    return data.plan;
  } catch {
    return null;
  }
}

export function clearPlan() {
  localStorage.removeItem(PLAN_KEY);
}

// --- Progress tracking ---

export function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : { completedDays: [] };
  } catch {
    return { completedDays: [] };
  }
}

function saveProgress(progress) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (err) {
    console.warn('Failed to save progress:', err);
  }
}

export function markDayCompleted(weekIdx, dayIdx) {
  const progress = loadProgress();
  const already = progress.completedDays.some(d => d.week === weekIdx && d.day === dayIdx);
  if (!already) {
    progress.completedDays.push({ week: weekIdx, day: dayIdx });
    saveProgress(progress);
  }
  return progress;
}

export function isDayCompleted(weekIdx, dayIdx) {
  const progress = loadProgress();
  return progress.completedDays.some(d => d.week === weekIdx && d.day === dayIdx);
}

export function isWeekComplete(weekIdx, totalDaysInWeek) {
  const progress = loadProgress();
  const completedInWeek = progress.completedDays.filter(d => d.week === weekIdx).length;
  return completedInWeek >= totalDaysInWeek;
}

export function areAllWeeksComplete(plan) {
  if (!plan?.weeks?.length) return false;
  return plan.weeks.every((week, wi) =>
    isWeekComplete(wi, week.days?.length || 0)
  );
}

// Find the next incomplete {week, day} in the plan
export function getNextWorkoutDay(plan) {
  const progress = loadProgress();
  for (let wi = 0; wi < (plan?.weeks?.length || 0); wi++) {
    const week = plan.weeks[wi];
    for (let di = 0; di < (week?.days?.length || 0); di++) {
      if (!progress.completedDays.some(d => d.week === wi && d.day === di)) {
        return { week: wi, day: di };
      }
    }
  }
  return null;
}

export function clearProgress() {
  localStorage.removeItem(PROGRESS_KEY);
}

// --- Active workout resume ---
const ACTIVE_WORKOUT_KEY = 'active_workout';

export function saveActiveWorkout(state) {
  try {
    localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify({
      ...state,
      savedAt: Date.now(),
    }));
  } catch (err) {
    console.warn('Failed to save active workout:', err);
  }
}

export function loadActiveWorkout() {
  try {
    const raw = localStorage.getItem(ACTIVE_WORKOUT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Expire if older than 30 minutes
    if (Date.now() - data.savedAt > 30 * 60 * 1000) {
      localStorage.removeItem(ACTIVE_WORKOUT_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearActiveWorkout() {
  localStorage.removeItem(ACTIVE_WORKOUT_KEY);
}

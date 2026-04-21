# מפת דרכים לשיפור - AI מאמן אישי

**תאריך:** 14.04.2026
**מבוסס על:** דוח QA מקיף + סקירת קוד + מבחני E2E

---

## 1. שיפורים טכניים - יציבות ומהירות

### P0 - דחוף (שבוע הקרוב)

#### תיקון RTL בדף כניסה
```
קובץ: client/src/pages/Login.jsx
מאמץ: 5 דקות
```
להוסיף `dir={isRTL ? 'rtl' : 'ltr'}` ל-div הראשי. כרגע דף הכניסה — הדף הראשון שכל משתמש רואה — מוצג בכיוון הפוך.

#### הוספת קישור אימון לתפריט מובייל
```
קובץ: client/src/components/Layout/Header.jsx
מאמץ: 2 דקות
```
התפריט במובייל חסר את הקישור הכי חשוב באפליקציה — כפתור "אימון". רוב המשתמשים במובייל.

#### כיבוי Debug Mode בייצור
```
קובץ: server/routes/coach.js שורה 189
מאמץ: 1 דקה
```
שנה `const shouldDebug = true` ל-`const shouldDebug = process.env.DEBUG_VISION === 'true'`. כרגע כל פריים נשמר לדיסק — ימלא את שטח האחסון.

#### תיקון נגישות בטופס כניסה
```
קובץ: client/src/pages/Login.jsx
מאמץ: 5 דקות
```
הוסף `id` לכל input ו-`htmlFor` תואם לכל label. קוראי מסך לא מזהים את השדות.

#### תיקון updateDoc crash ב-Dashboard
```
קובץ: client/src/pages/Dashboard.jsx שורה 285
מאמץ: 1 דקה
```
`updateDoc` לא מיובא אבל נקרא בשורה 285. החלף ב-`setDoc(..., { merge: true })` שכבר מיובא. כרגע Tips לא נשמרים לעולם.

#### תיקון AuthContext Deadlock
```
קובץ: client/src/context/AuthContext.jsx שורות 22-36
מאמץ: 5 דקות
```
עטוף את `getDoc()` ב-`try/catch/finally` עם `setLoading(false)` ב-finally. כרגע אם הרשת נופלת, האפליקציה נתקעת על spinner אינסופי.

#### תיקון Interval Leak ב-GameMode
```
קובץ: client/src/pages/GameMode.jsx
מאמץ: 10 דקות
```
הוסף `clearInterval(gameTimerRef.current)` לפני כל `setInterval` חדש ב-handleTogglePause.

#### הוספת Authentication Middleware לשרת
```
קובץ: server/server.js + server/middleware/auth.js חדש
מאמץ: 30 דקות
```
כל ה-API endpoints פתוחים לכל העולם. כל מי שמוצא את ה-URL של Render יכול לחייב אותך ב-Anthropic ללא הגבלה. הוסף middleware שמאמת Firebase ID token מהלקוח.

#### חסימת qaMode bypass
```
קובץ: server/routes/coach.js שורה 170
מאמץ: 2 דקות
```
שנה ל-`const qaMode = process.env.QA_MODE === 'true' && req.body.qaMode`. כרגע כל לקוח יכול לעקוף rate limiting.

#### סניטציית Prompt Injection
```
קובץ: server/services/claude.js
מאמץ: 20 דקות
```
הגבל אורך שם משתמש ל-30 תווים, הסר תווי בקרה, והעבר נתוני משתמש ל-user message במקום system prompt.

### P1 - חשוב (חודש הקרוב)

#### Error Boundary גלובלי
```
קבצים: App.jsx + ErrorBoundary.jsx חדש
מאמץ: 30 דקות
```
יצירת קומפוננטת Error Boundary שעוטפת את כל האפליקציה. במקום מסך לבן בקריסה, המשתמש יראה: "משהו השתבש. לחץ כאן לרענן". כולל דיווח אוטומטי של השגיאה.

#### פתרון Cold Start של שרת
```
מאמץ: שעה (אפשרות 1) או 0 (אפשרות 2)
```
- **אפשרות 1 (חינמית):** הגדרת GitHub Actions cron job שעושה ping לשרת כל 10 דקות.
- **אפשרות 2 (מומלצת):** שדרוג ל-Render Starter plan ($7/חודש) — always-on, אפס cold start.

#### Onboarding Flow למשתמש חדש
```
קבצים: Dashboard.jsx + ProfileWizard.jsx חדש
מאמץ: 3-4 שעות
```
משתמש חדש צריך לעבור wizard: פרופיל → ספורט → מטרות → תוכנית ראשונה. כרגע הוא מגיע ל-Dashboard ריק ולא מבין מה לעשות.

#### הוספת Firestore Security Rules
```
קובץ: firestore.rules
מאמץ: שעה
```
כרגע הדאטאבייס פתוח. צריך rules שמגבילים:
- כל משתמש קורא/כותב רק את המסמכים שלו
- שדות חובה מוגדרים
- גודל מסמך מוגבל

### P2 - נחמד (רבעון הקרוב)

#### Service Worker + PWA
```
מאמץ: 2-3 שעות
```
הפיכת האפליקציה ל-PWA עם:
- אייקון על מסך הבית
- עבודה אופליין (לפחות Dashboard)
- Push notifications לתזכורות אימון

#### Lazy Loading לדפים כבדים
```
קבצים: App.jsx
מאמץ: 30 דקות
```
Training.jsx ו-GameMode.jsx טוענים MediaPipe, מודלים, וספריות כבדות. שימוש ב-`React.lazy()` ו-`Suspense` יאפשר טעינה מהירה יותר של דפים אחרים.

#### מערכת Logging מסודרת
```
מאמץ: 2 שעות
```
החלפת `console.log` ב-logger מובנה (כמו winston) עם רמות (debug/info/warn/error), rotation, ושליחה לשירות מוניטורינג.

---

## 2. הצעות UX - ממשק Premium

### עיצוב

#### כרטיס אימון חי
כרגע מסך האימון מציג מצלמה + מספר חזרות. הצעה:
- **מד זווית ויזואלי** שמראה טווח תנועה בזמן אמת (arc indicator)
- **סמלי ירוק/צהוב/אדום** ליד מונה החזרות — מציג את הציון בזמן אמת
- **אנימציית "V" ירוק** כשחזרה מאושרת ע"י AI

#### מסך סיכום אימון
אחרי כל אימון, מסך סיכום עם:
- גרף radar של הביצועים (כוח, טכניקה, סיבולת)
- ציון כולל + השוואה לאימון הקודם
- ציטוט מוטיבציה אישי מה-AI
- כפתור שיתוף ל-WhatsApp

#### Dark Mode
הוספת מצב כהה — חשוב במיוחד לאימונים בערב. הרקע הלבן מסנוור.

### זרימה

#### Quick Start
כפתור גדול ובולט ב-Dashboard: "התחל אימון עכשיו" — שמתחיל את האימון הבא בתוכנית בלחיצה אחת, בלי לבחור שבוע/יום.

#### Progress Ring
מעגל התקדמות ב-Dashboard שמראה כמה מהתוכנית השבועית הושלמה. מוטיבציה ויזואלית.

#### Streak Counter
"אימנת 5 ימים ברצף!" — מנגנון gamification פשוט שמעודד רציפות.

### פידבק

#### Haptic Feedback
רטט קל בנייד כשחזרה נספרת — מחזק את תחושת ה"הישג".

#### Sound Effects
צליל "דינג" קצר באישור חזרה, צליל אחר בסיום סט. מחזק את האימון הקולי.

#### שיפור TTS
- הוספת השהייה (150ms) בין מספר החזרה לבין ההוראה הטכנית
- שימוש ב-SSML אם הדפדפן תומך — שליטה מדויקת יותר בהגייה

---

## 3. סיכום אישי - מה הכי דחוף

### הדבר הכי דחוף: אבטחת שרת + Cold Start + Onboarding

האפליקציה היא **מוצר מרשים מבחינה טכנית** — AI coaching בזמן אמת, pose detection, פידבק קולי בעברית, תמיכה בפרוטזה. אבל שלושה דברים דורשים טיפול מיידי:

1. **שרת פתוח ללא אימות** — כל מי שמוצא את ה-URL של Render יכול לחייב אותך ב-Anthropic ללא הגבלה. הוספת Firebase auth middleware לוקחת 30 דקות ומגינה על הכסף שלך.

2. **Cold Start של 30+ שניות** — משתמש חדש שמנסה לראשונה חושב שהאפליקציה שבורה. הוא לא ימתין. פתרון: $7/חודש ל-Render Starter, או cron ping חינמי.

3. **אין Onboarding** — משתמש חדש מגיע ל-Dashboard ריק. הוא לא יודע שצריך למלא פרופיל, לבחור ספורט, ולהגדיר מטרות. חצי מהמשתמשים יעזבו כאן.

### הדבר הכי קל לתקן (5 דקות, השפעה גדולה):
- RTL בדף כניסה
- קישור "אימון" בתפריט מובייל
- כיבוי debug mode

### מבט קדימה:
האפליקציה בנויה על ארכיטקטורה חזקה. המנגנונים מתקדמים (best-frame buffer, relative thresholding, adaptive warm-up, pipe-delimited AI responses). מה שחסר הוא **ליטוש של הרושם הראשוני** — הנקודה שבה משתמש חדש מחליט אם להישאר או לעזוב.

> **שורה תחתונה:** תקן את RTL + מובייל nav + cold start = שלושה שינויים קטנים שיעשו את ההבדל בין "אפליקציית מפתח" ל"מוצר שמשתמשים אוהבים".

---

*דוח זה נוצר על ידי Senior QA Automation + Code Review*
*Playwright E2E | 54 מבחנים | Desktop + Mobile*
*Claude Opus 4.6*

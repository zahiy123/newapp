// ============================================================
// techniqueWhy — the professional WHY of every correction the older analyzers give
// (owner, 2026-10-18: "every wrong movement, in every exercise and sport — a focused, professional
// technical explanation to the end, not slogans")
//
// PURE DATA. The analyzers in exerciseAnalysis.js say WHAT to fix ("keep the elbows pinned"); a coach
// also says WHY (the biomechanics), so the trainee understands and keeps it. The coach says
// `correction + why` the first time a correction comes up in an exercise, the short form after that.
// Keyed by the analyzer's exact Hebrew warning text.
// ============================================================

const w = (he, en) => ({ he, en });

export const TECHNIQUE_WHY = Object.freeze({
  'אל תרד יותר מדי! שמור על הברך מעל הקרסול': w('ברך שעוברת את הקרסול מעבירה את העומס מהשריר לגיד הפיקה ולסחוס', 'A knee travelling past the ankle moves the load from the muscle to the patellar tendon and cartilage'),
  'אל תרים את הכתפיים! רק המרפקים זזים, הכתפיים נשארות למטה': w('כתפיים שעולות מפעילות את הטרפז במקום השריר שאתה מאמן, ולוחצות על הצוואר', 'Shrugging shoulders recruit the traps instead of the target muscle and load the neck'),
  'אל תרים מעל גובה הכתפיים!': w('מעל גובה הכתף גידי הכתף נלחצים והטרפז משתלט — העבודה האמיתית היא עד הגובה הזה', 'Above shoulder height the tendons get pinched and the traps take over — the real work is up to this height'),
  'אל תרכן יותר מדי! תשמור על גב ישר, אתה מסתכן בפציעה': w('הרכנה מוגזמת מעבירה את כל המשקל לגב התחתון — ודיסק תחת עומס הוא פציעה שמחכה לקרות', 'Leaning too far puts all the load on the lower back — a loaded disc is an injury waiting to happen'),
  'דחוף את המשקולות למעלה! אל תקמר את הגב': w('קשת בגב הופכת את הלחיצה ללחיצת חזה ודוחסת את החוליות — בטן מהודקת שומרת את העבודה בכתפיים', 'Arching turns the press into a chest press and compresses the vertebrae — braced abs keep the work in the shoulders'),
  'הברכיים קורסות פנימה! תפתח אותן החוצה לרוחב כתפיים': w('ברך שקורסת פנימה מסובבת את המפרק ומעמיסה על הרצועה הצולבת — ברך בקו האצבעות מפעילה את הישבן ומגינה על הברך', 'A knee caving in twists the joint and loads the ACL — a knee over the toes fires the glutes and protects the knee'),
  'הגב נוטה קדימה! שמור על חזה זקוף': w('חזה זקוף שומר על עמוד שדרה ניטרלי ומחלק את העומס בין הירכיים לברכיים', 'A tall chest keeps the spine neutral and shares the load between hips and knees'),
  'הגוף מתנדנד! שמור על גוף ישר': w('תנופה מרימה את המשקל במקום השריר — גוף יציב מכריח את השריר לעשות את כל העבודה', 'Momentum lifts the weight instead of the muscle — a still body makes the muscle do all the work'),
  'הורד את הכתפיים! אל תרים אותן': w('כתפיים למטה ואחורה מייצבות את השכמה — כך הכוח עובר בבטחה מהגוף לידיים', 'Shoulders down and back stabilize the shoulder blade — so the force travels safely from the body to the arms'),
  'החזק את המשקולת קרוב לחזה!': w('משקל קרוב לגוף מקצר את המנוף על הגב — רחוק מהגוף, הגב התחתון סוחב אותו', 'A load close to the body shortens the lever on the back — far from it, the lower back carries it'),
  'הירכיים גבוהות מדי! הורד אותן ושמור על גב ישר': w('אגן גבוה מוריד את העבודה מהבטן ומעביר את המשקל לכתפיים — קו ישר מחזק את הליבה', 'High hips take the work off the abs and shift the weight to the shoulders — a straight line trains the core'),
  'הירכיים שוקעות! הרם אותן ושמור על בטן אסופה': w('אגן ששוקע מקמר את הגב התחתון ומעביר את העומס מהבטן לחוליות', 'Sagging hips arch the lower back and move the load from the abs to the vertebrae'),
  'הישבן למעלה מדי! שמור על קו ישר מכתפיים לקרסול': w('ישבן גבוה מקצר את המנוף ומוריד את העבודה מהליבה — רק קו ישר נותן לבטן לעבוד באמת', 'A high bottom shortens the lever and takes the work off the core — only a straight line makes the abs really work'),
  'הנמך את מרכז הכובד! כופף את הברכיים': w('מרכז כובד נמוך נותן יציבות ומאפשר לזוז מהר לכל כיוון — ברכיים ישרות נועלות אותך במקום', 'A low center of gravity gives balance and lets you move fast in any direction — straight knees lock you in place'),
  'הרכן את הגוף יותר קדימה! זווית של 45 מעלות, גב ישר': w('בזווית של 45 מעלות שרירי הגב העליון עובדים נגד הכובד בטווח המלא — זקוף מדי, התרגיל מאבד את העומס', 'At 45 degrees the upper-back muscles work against gravity through the full range — too upright, the drill loses its load'),
  'הרם את הירכיים יותר גבוה! סחוט את הישבן חזק למעלה': w('רק בקו ישר מהכתפיים לברכיים הישבן מתכווץ עד הסוף — חצי גובה משאיר את העבודה לגב התחתון', 'Only at a straight shoulder-to-knee line do the glutes contract fully — half height leaves the work to the lower back'),
  'הרם את הירכיים! אל תיתן להן לשקוע': w('אגן ששוקע מקמר את הגב התחתון — ליבה מהודקת מחזיקה את הגוף כיחידה אחת', 'Sinking hips arch the lower back — a braced core holds the body as one unit'),
  'הרם את הכתפיים יותר! כווץ את הבטן': w('הבטן מתכווצת רק כשהכתפיים עולות מהרצפה — תנועה קטנה מדי לא מפעילה את שריר הבטן הישר', 'The abs contract only when the shoulders leave the floor — too small a movement never fires the rectus abdominis'),
  'הרם ברכיים גבוה יותר!': w('ברך עד גובה המותן מפעילה את מכופפי הירך בטווח המלא — זה מה שבונה צעד מהיר וחזק', 'A knee to hip height works the hip flexors through the full range — that builds a fast, powerful stride'),
  'הרם ידיים ורגליים מהרצפה!': w('רק כשהידיים והרגליים באוויר שרירי הגב והישבן מחזיקים את הגוף — על הרצפה הם נחים', 'Only with the arms and legs in the air do the back and glutes hold the body — on the floor they rest'),
  'יישר את הזרועות עד הסוף! טווח תנועה מלא': w('יישור מלא מפעיל את השריר בכל הטווח — חצי תנועה בונה חצי כוח', 'Full extension works the muscle through its whole range — half a movement builds half the strength'),
  'ישר את הרגליים! הברכיים כפופות': w('ברך כפופה מקצרת את המנוף ומקלה מדי — רגל ישרה מעבירה את העבודה לשריר שהתרגיל מכוון אליו', 'A bent knee shortens the lever and makes it too easy — a straight leg sends the work to the target muscle'),
  'ישר את הרגליים! שמור על ברכיים ישרות': w('ברך כפופה מקצרת את המנוף ומקלה מדי — רגל ישרה מעבירה את העבודה לשריר שהתרגיל מכוון אליו', 'A bent knee shortens the lever and makes it too easy — a straight leg sends the work to the target muscle'),
  'כווץ עד הסוף! הביא את היד לכתף': w('הכיווץ המלא בסוף התנועה הוא החלק שהשריר מתאמץ בו הכי הרבה — בלעדיו מפספסים את החצי החשוב', 'The full squeeze at the top is where the muscle works hardest — without it you miss the important half'),
  'כופף קצת את המרפקים!': w('מרפק נעול לגמרי מעביר את העומס מהשריר למפרק — כיפוף קל שומר את המתח על השריר', 'A fully locked elbow moves the load from the muscle to the joint — a slight bend keeps the tension on the muscle'),
  'עלה קצת! הירכיים יורדות מדי': w('ירידה מתחת לטווח מעמיסה על הברכיים יותר ממה שהתרגיל מתכנן — בטווח הנכון השריר עובד בבטחה', 'Dropping below the range loads the knees more than the drill plans — in the right range the muscle works safely'),
  'רד לתנוחת פלאנק! ידיים על הרצפה, גוף ישר': w('התרגיל נמדד מתנוחת הפלאנק — רק ממנה הליבה והכתפיים עובדות כמו שצריך', 'The drill is measured from the plank position — only from there do the core and shoulders work properly'),
  'רד קצת יותר! ברכיים ב-90 מעלות': w('ב-90 מעלות הירך מקבילה לרצפה — שם הישבן והארבע ראשי מקבלים את העבודה המלאה', 'At 90 degrees the thigh is parallel to the floor — that is where the glutes and quads get the full work'),
  'שמור את המרפקים צמודים לגוף! אל תיתן להם לזוז': w('מרפק צמוד משאיר את כל העבודה בשריר שאתה מאמן — מרפק שזז מעביר אותה לכתף', 'A pinned elbow keeps all the work in the target muscle — a moving elbow hands it to the shoulder'),
  'שמור את המרפקים קרובים לראש! אל תיתן להם להתפשט': w('מרפקים קרובים לראש מבודדים את הטרייספס — מרפקים פתוחים מעבירים את העומס לכתף', 'Elbows close to the head isolate the triceps — flared elbows move the load to the shoulder'),
  'שמור על גב ישר ובטן אסופה! האגן צונח': w('אגן שצונח מקמר את הגב התחתון ומעביר את העומס מהבטן לחוליות', 'A dropping pelvis arches the lower back and moves the load from the abs to the vertebrae'),
  'שמור על גוף ישר! אתה נוטה לצד': w('נטייה לצד מעבירה את המשקל לצד אחד ויוצרת חוסר איזון — גוף ישר עובד שווה בשני הצדדים', 'Leaning to one side shifts the weight there and builds an imbalance — a straight body works both sides equally'),
  'שמור על הזרועות ישרות! אל תכופף את המרפקים': w('זרוע ישרה שומרת את המשקל רחוק מהכתף וכך השריר עובד באמת — כיפוף מקל ומשנה את התרגיל', 'A straight arm keeps the load away from the shoulder so the muscle really works — bending makes it easier and changes the drill'),
  'שמור על הירכיים למטה! אל תרים את הישבן, ליבה חזקה': w('ישבן גבוה מוריד את העבודה מהליבה — ירכיים בקו אחד עם הכתפיים מכריחות את הבטן לעבוד', 'A high bottom takes the work off the core — hips in line with the shoulders make the abs work'),
});

/** The why of an analyzer correction (by its Hebrew text), or null. */
export function techniqueWhy(text) {
  return (text && TECHNIQUE_WHY[String(text).trim()]) || null;
}

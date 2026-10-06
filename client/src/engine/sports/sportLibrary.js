// ============================================================
// sportLibrary — sport-specific coaching knowledge layered on the execution profiles (Stage 3.1)
//
// PURE DATA + composition. The same exercise is coached differently per sport: a squat for
// a rehab trainee is about slow control and a level pelvis; for a footballer about single-leg
// hip stability; a landing for a basketball player is about soft knees. Each sport defines:
//   family    — field / court / racket / endurance (running) / rehab / strength / seated
//   emphasis  — the sport's coaching priorities, with WHY (the coach explains, not only corrects)
//   tempoScale— tempo of strength reps / holds in this sport (the Ghost demonstrates it:
//               period × tempoScale); cyclic and strike movements keep their technical rhythm
//   rules     — DYNAMIC rules on motion events (motionFeatures.js), each with a correction
//               (msg), an explanation in the sport's terms (why), and the profile tags it
//               applies to (appliesTo). Severity: 'error' (coaching) | 'danger'.
//
// Rule events / features:
//   rep      toPeakMs, peakHoldMs, returnMs, pelvisDropMax, swayRatio, trunkRange
//   landing  absorptionDeg, cadence
//   strike   chainLeadMs, balance, trunkLean, distalSpeed
//   window   swayRatio, pelvisDrop
//
// Profile tags: strength, hold, isometric, lowerBody, upperBody, bilateral, singleLeg,
// squatPattern, hinge, hipExtension, push, overhead, shoulder, arm, core, gait, cyclic,
// landing, strike, chain, singleLegStance, ballSkill, rehab, conditioning.
// "Lowering" phase: toPeak for squat / hinge / push / lunge patterns, return for the others.
//
// Adding a sport = adding an entry here (+ tests run every expert Ghost under every sport).
// ============================================================

const msg = (he, en) => ({ he, en });

const LOWERING_TO_PEAK = ['squatPattern', 'hinge', 'push', 'singleLeg'];
const LOWERING_ON_RETURN = ['overhead', 'shoulder', 'arm', 'hipExtension'];

// ---- Reusable rule builders ----
const loweringTempo = (minMs, why) => [
  { id: 'tempo_lowering', on: 'rep', feature: 'toPeakMs', op: '<', value: minMs, severity: 'error', appliesTo: LOWERING_TO_PEAK,
    msg: msg('לאט יותר בירידה — שלוט בתנועה', 'Slower on the way down — control it'), why },
  { id: 'tempo_lowering_return', on: 'rep', feature: 'returnMs', op: '<', value: minMs, severity: 'error', appliesTo: LOWERING_ON_RETURN,
    msg: msg('הורד לאט ובשליטה, אל תפיל', 'Lower slowly and under control — don\'t drop it'), why },
];
const pelvisLevel = (maxDeg, appliesTo, why) => ({
  id: 'pelvis_level', on: 'rep', feature: 'pelvisDropMax', op: '>', value: maxDeg, severity: 'error', appliesTo,
  msg: msg('שמור על אגן ישר — הפעל את הישבן', 'Keep your pelvis level — engage the glutes'), why,
});
const softLanding = (minDeg, appliesTo, why) => ({
  id: 'soft_landing', on: 'landing', feature: 'absorptionDeg', op: '<', value: minDeg, severity: 'error', appliesTo,
  msg: msg('נחיתה רכה — כופף את הברך ברגע המגע', 'Land soft — bend the knee as the foot touches'), why,
});
const holdSteady = (why) => ({
  id: 'hold_steady', on: 'window', feature: 'swayRatio', op: '>', value: 0.12, severity: 'error', appliesTo: ['isometric'],
  msg: msg('יציב — נשום והחזק בלי להתנדנד', 'Steady — breathe and hold without swaying'), why,
});
const strikeChain = (why) => ({
  id: 'strike_chain', on: 'strike', feature: 'chainLeadMs', op: '<', value: 15, severity: 'error', appliesTo: ['chain'],
  msg: msg('התחל את התנועה מהירך — ואז הברך', 'Start the swing from the hip — then the knee'), why,
});
const strikeBalance = (why) => ({
  id: 'strike_balance', on: 'strike', feature: 'balance', op: '>', value: 0.45, severity: 'error', appliesTo: ['strike'],
  msg: msg('משקל מעל רגל התמיכה', 'Weight over the support foot'), why,
});
const trunkControlSeated = (why) => ({
  id: 'trunk_control', on: 'rep', feature: 'trunkRange', op: '>', value: 25, severity: 'error', appliesTo: ['upperBody'],
  msg: msg('יציבות גו — אל תתנדנד עם הגוף', 'Stable trunk — don\'t rock your body'), why,
});

// ---- Explanations (shared wording) ----
const WHY = {
  eccentric: msg('השלב המבוקר בירידה בונה את רוב הכוח ומגן על הגידים והמפרקים',
    'The controlled lowering phase builds most of the strength and protects tendons and joints'),
  rehabTempo: msg('בשיקום, תנועה איטית ומבוקרת מעמיסה את הרקמה בבטחה ובונה שליטה עצבית-שרירית',
    'In rehab, slow controlled movement loads the tissue safely and builds neuromuscular control'),
  rehabPelvis: msg('ירידת אגן מעידה על חולשת הגלוטאוס מדיוס ומעמיסה על הברך והגב — במיוחד בצד הפרוטזה',
    'Pelvic drop shows a weak gluteus medius and loads the knee and back — especially on the prosthetic side'),
  holdBreath: msg('בהחזקה סטטית, יציבות ונשימה רגועה הן העבודה עצמה — התנדנדות מעבירה את העומס מהליבה',
    'In a static hold, stability and calm breathing are the work — swaying shifts the load off the core'),
  fieldPelvis: msg('בבעיטה, בשינויי כיוון ובנחיתה האגן חייב להישאר יציב — ירידת אגן היא גורם סיכון קלאסי לרצועה הצולבת ולמפשעה',
    'In kicks, cuts and landings the pelvis must stay stable — pelvic drop is a classic ACL / groin risk'),
  kickChain: msg('הכוח עובר בשרשרת ירך → ברך → כף רגל; בעיטה מהברך לבד מאבדת עוצמה ומעמיסה על הברך',
    'Power flows hip → knee → foot; kicking from the knee alone loses power and strains the knee'),
  kickBalance: msg('רגל התמיכה ליד הכדור ומשקל מעליה — כך הבעיטה מדויקת והגוף לא נופל אחורה',
    'Support foot beside the ball with your weight over it — the kick stays accurate and you don\'t fall back'),
  ampKickBalance: msg('בכדורגל קטועים הקביים הן הבסיס: חזה ומשקל מעליהן — אחרת אין יציבות לבעיטה ויש סיכון לנפילה',
    'In amputee football the crutches are the base: chest and weight over them — otherwise the kick is unstable and you risk falling'),
  courtLanding: msg('בריבאונד, בזריקה ובעצירה הברך היא בולם הזעזועים — נחיתה נוקשה מעבירה את המכה לברך, לירך ולגב',
    'In rebounds, jump shots and stops the knee is the shock absorber — a stiff landing sends the impact into the knee, hip and back'),
  racketLanding: msg('צעד הפיצול והתנועה במגרש נשענים על נחיתה רכה ומוכנה — ברכיים כפופות = תגובה מהירה יותר לכדור',
    'The split step and court movement rely on a soft, ready landing — bent knees mean a faster reaction to the ball'),
  runCadence: msg('קצב צעדים גבוה (~170-180 בדקה) מקצר את הצעד, מקטין את הזעזוע בכל נחיתה ומונע "בלימה" עם העקב',
    'A higher cadence (~170-180/min) shortens the stride, lowers the impact per landing and prevents heel braking'),
  runLanding: msg('הברך היא הבולם בכל צעד — נחיתה על רגל ישרה מעבירה כפי 2-3 ממשקל הגוף לברך, לירך ולגב',
    'The knee is the shock absorber on every step — landing on a straight leg sends 2-3× body weight into the knee, hip and back'),
  runPelvis: msg('ירידת אגן בריצה = גלוטאוס מדיוס חלש → עומס על הברך ועל רצועת ה-IT',
    'Pelvic drop while running = a weak gluteus medius → stress on the knee and the IT band'),
  seatedTrunk: msg('בכיסא, הליבה היא הבסיס לכל זריקה ודחיפה — נדנוד גו מבזבז כוח ומסכן את הכתפיים',
    'In a wheelchair the core is the base of every throw and push — rocking wastes power and stresses the shoulders'),
  enduranceForm: msg('בסיבולת, שמירה על טכניקה תחת עייפות היא מה שמונע פציעות עומס',
    'In endurance, keeping technique under fatigue is what prevents overuse injuries'),
};

// Emphasis item; appliesTo (profile tags) limits it to the relevant movement patterns
const E = (id, he, en, appliesTo = null) => ({ id, ...msg(he, en), ...(appliesTo ? { appliesTo } : {}) });

/** @type {Object<string, Object>} */
export const SPORT_LIBRARY = Object.freeze({
  fitness: {
    id: 'fitness', family: 'strength', name: msg('כושר', 'Fitness'), tempoScale: 1,
    emphasis: [E('control', 'שליטה בירידה (אקסצנטרי)', 'Control on the way down (eccentric)'),
      E('range', 'טווח תנועה מלא ובטוח', 'Full, safe range of motion'), E('core', 'ליבה יציבה', 'Stable core')],
    rules: [...loweringTempo(600, WHY.eccentric), holdSteady(WHY.holdBreath)],
  },
  rehab: {
    id: 'rehab', family: 'rehab', name: msg('שיקום', 'Rehab'), tempoScale: 1.8,
    emphasis: [E('tempo', 'קצב איטי ומבוקר', 'Slow, controlled tempo'), E('symmetry', 'אגן ישר ויציבות', 'Level pelvis and stability'),
      E('pain', 'בלי כאב — טווח שנמדד בסריקה', 'Pain-free — within the scanned range')],
    rules: [...loweringTempo(1200, WHY.rehabTempo), pelvisLevel(8, ['lowerBody'], WHY.rehabPelvis), holdSteady(WHY.holdBreath)],
  },
  football: {
    id: 'football', family: 'field', name: msg('כדורגל', 'Football'), tempoScale: 1,
    emphasis: [E('chain', 'שרשרת ירך → ברך → כף רגל בבעיטה', 'Hip → knee → foot chain in the kick', ['strike']),
      E('plant', 'רגל תמיכה יציבה ומשקל מעליה', 'Stable support foot, weight over it', ['strike', 'singleLeg']),
      E('hip', 'יציבות אגן בשינויי כיוון', 'Pelvic stability in changes of direction', ['lowerBody', 'gait'])],
    rules: [...loweringTempo(600, WHY.eccentric), pelvisLevel(10, ['lowerBody', 'singleLeg'], WHY.fieldPelvis),
      strikeChain(WHY.kickChain), strikeBalance(WHY.kickBalance), softLanding(10, ['landing'], WHY.courtLanding)],
  },
  footballAmputee: {
    id: 'footballAmputee', family: 'field', name: msg('כדורגל קטועים', 'Amputee football'), tempoScale: 1,
    emphasis: [E('crutchBase', 'משקל וחזה מעל הקביים', 'Weight and chest over the crutches'),
      E('core', 'ליבה חזקה — הגו מייצב את הבעיטה', 'Strong core — the trunk stabilizes the kick'),
      E('chain', 'בעיטה מהירך, לא מהברך', 'Kick from the hip, not the knee', ['strike'])],
    rules: [...loweringTempo(600, WHY.eccentric), pelvisLevel(10, ['lowerBody', 'singleLeg'], WHY.fieldPelvis),
      strikeChain(WHY.kickChain), strikeBalance(WHY.ampKickBalance),
      { id: 'strike_trunk', on: 'strike', feature: 'trunkLean', op: '>', value: 30, severity: 'error', appliesTo: ['strike'],
        msg: msg('חזה מעל הכדור והקביים — אל תיפול אחורה', 'Chest over the ball and crutches — don\'t lean back'), why: WHY.ampKickBalance }],
  },
  footballAmputeeGK: {
    id: 'footballAmputeeGK', family: 'field', name: msg('שוער כדורגל קטועים', 'Amputee football goalkeeper'), tempoScale: 1,
    emphasis: [E('ready', 'עמדת מוכנות נמוכה ויציבה', 'Low, stable ready position'), E('reaction', 'תגובה מהירה לשני הצדדים', 'Fast reaction to both sides'),
      E('core', 'ליבה ויציבות גו', 'Core and trunk stability')],
    rules: [...loweringTempo(600, WHY.eccentric), trunkControlSeated(WHY.seatedTrunk), holdSteady(WHY.holdBreath)],
  },
  basketball: {
    id: 'basketball', family: 'court', name: msg('כדורסל', 'Basketball'), tempoScale: 1,
    emphasis: [E('landing', 'נחיתה רכה — ברכיים בולמות', 'Soft landings — knees absorb', ['landing', 'gait', 'squatPattern']), E('hip', 'יציבות אגן בעצירות ובשינויי כיוון', 'Pelvic stability in stops and cuts', ['lowerBody']),
      E('power', 'כוח מתפרץ מהרגליים', 'Explosive leg power')],
    rules: [...loweringTempo(600, WHY.eccentric), pelvisLevel(10, ['lowerBody', 'singleLeg'], WHY.fieldPelvis), softLanding(12, ['landing', 'gait'], WHY.courtLanding)],
  },
  basketballWheelchair: {
    id: 'basketballWheelchair', family: 'seated', name: msg('כדורסל בכיסא גלגלים', 'Wheelchair basketball'), tempoScale: 1,
    emphasis: [E('trunk', 'ליבה ויציבות גו בכיסא', 'Core and trunk stability in the chair'), E('shoulder', 'כתפיים בריאות — טווח מבוקר', 'Healthy shoulders — controlled range'),
      E('push', 'דחיפה יעילה של הגלגלים', 'Efficient wheel push', ['upperBody'])],
    rules: [...loweringTempo(600, WHY.eccentric), trunkControlSeated(WHY.seatedTrunk)],
  },
  tennis: {
    id: 'tennis', family: 'racket', name: msg('טניס', 'Tennis'), tempoScale: 1,
    emphasis: [E('chain', 'שרשרת רגליים → ירך → גו → זרוע במכה', 'Legs → hip → trunk → arm chain in the stroke', ['strike']),
      E('split', 'צעד פיצול ונחיתה מוכנה', 'Split step and a ready landing', ['landing', 'gait', 'squatPattern']), E('balance', 'מעבר משקל קדימה לתוך המכה', 'Weight transfer forward into the shot', ['strike', 'singleLeg'])],
    rules: [...loweringTempo(600, WHY.eccentric), pelvisLevel(10, ['lowerBody', 'singleLeg'], WHY.fieldPelvis), softLanding(10, ['landing'], WHY.racketLanding),
      strikeChain(WHY.kickChain)],
  },
  tennisWheelchair: {
    id: 'tennisWheelchair', family: 'seated', name: msg('טניס בכיסא גלגלים', 'Wheelchair tennis'), tempoScale: 1,
    emphasis: [E('trunk', 'סיבוב גו מבוקר במכה', 'Controlled trunk rotation in the stroke'), E('shoulder', 'כתפיים בריאות', 'Healthy shoulders')],
    rules: [...loweringTempo(600, WHY.eccentric), trunkControlSeated(WHY.seatedTrunk)],
  },
  // ---- Library-ready (not selectable in the app yet; the owner named it as a relevant sport) ----
  running: {
    id: 'running', family: 'endurance', name: msg('ריצה', 'Running'), tempoScale: 1,
    emphasis: [E('cadence', 'קצב צעדים 170-180 בדקה', 'Cadence 170-180 steps/min', ['gait']), E('landing', 'נחיתה רכה מתחת לגוף', 'Soft landing under the body', ['gait', 'landing']),
      E('posture', 'גו זקוף עם הטיה קלה קדימה', 'Tall trunk with a slight forward lean'), E('hip', 'אגן ישר', 'Level pelvis', ['lowerBody', 'gait'])],
    rules: [...loweringTempo(600, WHY.eccentric),
      { id: 'cadence', on: 'landing', feature: 'cadence', op: '<', value: 155, severity: 'error', appliesTo: ['gait'],
        msg: msg('צעדים קצרים ומהירים יותר', 'Shorter, quicker steps'), why: WHY.runCadence },
      softLanding(8, ['gait', 'landing'], WHY.runLanding), pelvisLevel(8, ['gait', 'singleLeg', 'lowerBody'], WHY.runPelvis)],
  },
});

/**
 * Sport contexts for a trainee, most general first:
 *   rehab only → ['rehab']; rehab + sport → ['rehab', sport]; sport → [sport]; default ['fitness'].
 * @param {Object} userProfile - Firestore profile (sport, trainingTrack, rehabSport)
 */
export function sportContextsFor(userProfile) {
  const p = userProfile || {};
  const known = (k) => (k && SPORT_LIBRARY[k] ? k : null);
  if (p.trainingTrack === 'rehab_only' || (p.sport === 'rehab' && !p.trainingTrack)) return ['rehab'];
  if (p.trainingTrack === 'rehab_sport') return ['rehab', known(p.rehabSport)].filter(Boolean);
  return [known(p.sport) || 'fitness'];
}

const tagsMatch = (rule, tags) => !rule.appliesTo || rule.appliesTo.some(t => tags.has(t));

/** The safer of two versions of the same rule ('<' → the higher minimum, '>' → the lower maximum);
 *  on a tie the later, more specific one (its explanation is in the sport's terms). */
function saferRule(a, b) {
  if (!a) return b;
  if (a.op !== b.op) return b;
  return (a.op === '<' ? b.value >= a.value : b.value <= a.value) ? b : a;
}

/**
 * Layer the sport contexts on an execution profile: adds the matching dynamic rules (when two
 * contexts define the same rule, the SAFER threshold wins — rehab + sport never relaxes the
 * rehab baseline; the profile's own exercise rules are refined the same way),
 * scales the Ghost's tempo (the slowest context wins, so the Ghost always demonstrates a tempo
 * that passes every tempo rule), and attaches the sport emphasis for coaching / the AI coach.
 */
export function applySportContext(profile, contexts = ['fitness']) {
  if (!profile) return profile;
  const sports = contexts.map(c => SPORT_LIBRARY[c]).filter(Boolean);
  if (!sports.length) return profile;
  const tags = new Set(profile.tags || []);
  const byId = new Map((profile.dynamics || []).map(r => [r.id, r]));
  for (const sp of sports) for (const r of sp.rules) if (tagsMatch(r, tags)) byId.set(r.id, saferRule(byId.get(r.id), { ...r, sport: sp.id }));
  // Tempo scaling is for strength reps / holds; a stride or a kick has its own technical rhythm
  const scalable = profile.kind === 'reps' || profile.kind === 'hold';
  const tempoScale = scalable ? Math.max(...sports.map(s => s.tempoScale || 1)) : 1;
  return {
    ...profile,
    sportContexts: sports.map(s => s.id),
    // Emphasis relevant to this movement pattern (items without appliesTo are general to the sport)
    sportEmphasis: sports.flatMap(s => s.emphasis.filter(e => tagsMatch(e, tags)).map(e => ({ ...e, sport: s.id }))),
    dynamics: [...byId.values()],
    ghost: profile.ghost && { ...profile.ghost, periodMs: Math.round((profile.ghost.periodMs || 1600) * tempoScale) },
  };
}

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export function extractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch {}
  }
  let start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    if (depth === 0) {
      try { return JSON.parse(text.substring(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

async function callClaude(system, content, maxTokens = 4096, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content }]
      });
      return message.content[0].text;
    } catch (err) {
      if (err.status === 429 && attempt < retries) {
        const wait = (attempt + 1) * 15000; // 15s, 30s
        console.log(`Rate limited. Waiting ${wait / 1000}s before retry...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

export async function callClaudeVision(system, contentBlocks, maxTokens = 4096, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: contentBlocks }]
      });
      return message.content[0].text;
    } catch (err) {
      if (err.status === 429 && attempt < retries) {
        const wait = (attempt + 1) * 15000;
        console.log(`Vision rate limited. Waiting ${wait / 1000}s before retry...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

const SPORT_CONTEXTS = {
  footballAmputee: `You are an expert AMPUTEE FOOTBALL (Para-Football) coach.
This sport is played by athletes with lower limb amputations using forearm crutches. NO prosthetics allowed during play.
Key rules: 7 players per team, no offside, field is smaller (60x40m), goalkeeper has upper limb deficiency.

Your expertise includes:
- Ball control with ONE leg while balancing on crutches
- Crutch-based agility: pivoting, turning, sprinting on crutches
- Shooting accuracy and power from a single standing leg
- Passing drills maintaining balance on crutches
- Core stability crucial for crutch movement and balance
- Explosive power for crutch sprinting and quick direction changes
- Upper body and shoulder endurance for sustained crutch use
- Fall prevention and safe landing techniques
- Match preparation: positioning, game awareness on crutches

SAFETY RULES:
- Always warm up shoulder joints and wrists before crutch drills
- Monitor for shoulder/wrist overuse pain
- Include grip strength exercises for crutch endurance
- Progressively build crutch sprint distance
- Core work is essential to prevent lower back strain
- Rest between high-intensity crutch drills must be adequate`,

  footballAmputeeGK: `You are an expert AMPUTEE FOOTBALL GOALKEEPER coach.
In amputee football, the goalkeeper has an upper limb deficiency. The goalkeeper uses one arm.
Focus on: one-arm diving saves, positioning, distribution with one arm, footwork agility.
Adapt all drills for single-arm use. Emphasize balance during dives using the remaining arm.`,

  football: `You are an expert football (soccer) coach specializing in personalized solo training.

Your expertise includes:
- Dribbling: close control, speed dribbling, directional changes, sole rolls, inside/outside cuts
- Passing: wall passes, long-range accuracy, first touch receiving, one-touch passing
- Shooting: power shots, placement, volleys, one-on-one finishing angles
- 1v1 skills: feints, step-overs, body feints, change of pace
- Tactical awareness: positioning, off-the-ball movement, creating space
- Physical conditioning: sprint intervals, agility ladders, shuttle runs

WARM-UP PROTOCOL:
- Light jog 3-5 min, dynamic stretches (leg swings, hip circles)
- Ball warm-up: juggling, soft touches, figure-8 around legs

DRILL DESIGN:
- Use cones/markers as simulated defenders for solo training
- Include game-realistic scenarios (receive → turn → shoot)
- Build drills from simple to complex within the session
- Always include a conditioning element (sprints, interval runs)

SAFETY:
- Proper warm-up before explosive movements
- Gradual increase in sprint intensity
- Ankle and knee stability exercises as injury prevention`,

  basketballWheelchair: `You are an expert wheelchair basketball coach specializing in personalized training.

Your expertise includes:
- Wheelchair handling: push speed, stopping, pivoting, 360 spins, figure-8 maneuvers
- Shooting mechanics: adapted form from chair, free throws, mid-range, three-point
- Passing: chest pass, bounce pass, overhead from chair position
- Defensive positioning: chair-to-chair, blocking lanes, boxing out
- Court mobility: sprint pushes, lateral slides in chair, fast-break transitions
- Upper body conditioning: shoulder press, pull motions, core stability for balance in chair

WARM-UP PROTOCOL:
- Chair push laps 3-5 min, arm circles, shoulder rolls
- Ball handling warm-up: dribbling in place, figure-8 around wheels

DRILL DESIGN:
- Alternate chair movement drills with shooting/passing drills
- Include game scenarios: fast break, pick-and-roll positioning
- Chair agility courses with cones for directional changes
- Pair upper body strength with court-specific movements

SAFETY:
- Check tire pressure and chair stability before training
- Warm up shoulders and wrists thoroughly to prevent overuse
- Monitor for pressure sores and adjust seating as needed
- Adequate rest between high-intensity chair sprints`,

  tennisWheelchair: `You are an expert wheelchair tennis coach specializing in personalized training.

Your expertise includes:
- Chair positioning: optimal distance from ball, pre-shot chair placement
- One-bounce rule: timing the second bounce, strategic use of extra bounce
- Adapted strokes: forehand and backhand from seated position, topspin, slice
- Serve technique: toss consistency from chair, power generation through trunk rotation
- Court coverage: efficient push patterns, recovery to center, diagonal movement
- Volley and net play: approach shots from chair, quick hands at net

WARM-UP PROTOCOL:
- Chair push laps 3-5 min, shoulder and wrist rotations
- Shadow swings from chair position, mini-rally with soft balls

DRILL DESIGN:
- Chair movement drills: side-to-side pushes, forward-backward sprints
- Stroke repetition: cross-court rallies, down-the-line targets
- Serve practice: placement targets in service boxes
- Match simulation: point play with tactical targets

SAFETY:
- Thorough shoulder and wrist warm-up before serving
- Monitor for rotator cuff strain from repeated overhead motions
- Ensure court surface is smooth for safe chair movement
- Rest between intense rallying to prevent fatigue-related injury`,

  basketball: `You are an expert basketball coach specializing in personalized solo training.

Your expertise includes:
- Shooting form: set shots, jump shots, free throws, three-pointers, floaters
- Dribbling: crossover, between the legs, behind the back, hesitation, spin move
- Defensive fundamentals: defensive slides, close-outs, stance and footwork
- Layup mechanics: right and left hand, reverse layups, euro-step
- Court spacing: off-ball movement, cutting, V-cuts, L-cuts
- Conditioning: suicide drills, defensive slides, sprint intervals

WARM-UP PROTOCOL:
- Light jog 3-5 min, dynamic stretches (high knees, butt kicks, lateral shuffles)
- Ball handling warm-up: stationary dribbling, two-ball drills, figure-8

DRILL DESIGN:
- Use cones as defenders for dribble moves and driving lanes
- Spot-up shooting from multiple positions around the key
- Combine ball handling with finishing at the rim
- Include game-speed movements (catch-and-shoot, pull-up jumpers)

SAFETY:
- Proper warm-up before jumping and cutting movements
- Ankle stability exercises as injury prevention
- Gradual increase in intensity for sprint/agility drills
- Rest between high-intensity shooting/driving series`,

  tennis: `You are an expert tennis coach specializing in personalized solo training.

Your expertise includes:
- Stroke techniques: forehand (topspin, flat, slice), backhand (one-hand, two-hand), volleys, drop shots
- Serve: flat serve, slice serve, kick serve, toss placement, trophy position
- Footwork: split step, recovery steps, lateral movement, approach footwork
- Court movement: baseline positioning, net approach, defensive lob recovery
- Rally building: cross-court consistency, down-the-line attacks, approach shots
- Match strategy: serve patterns, return positioning, point construction

WARM-UP PROTOCOL:
- Light jog 3-5 min, dynamic stretches (arm circles, trunk rotation, leg swings)
- Shadow swings: forehand and backhand without ball, serve motion warm-up

DRILL DESIGN:
- Use targets (cones, towels) for placement accuracy
- Wall rallying for stroke repetition and timing
- Serve practice: placement targets in service boxes
- Footwork patterns: lateral shuffles, cross-step, recovery runs
- Combine footwork with stroke practice (move → hit → recover)

SAFETY:
- Thorough shoulder warm-up before serving
- Wrist and elbow care: avoid overloading with excessive topspin early
- Proper footwear for court surface
- Rest between intense serving sessions to protect shoulder`,
  fitness: `You are an expert personal fitness coach specializing in GENERAL FITNESS ONLY.
This is NOT a sport program. ABSOLUTELY NO balls, NO dribbling, NO shooting, NO passing, NO sport-specific drills of any kind.
Every exercise must be pure fitness: strength, cardio, aerobic conditioning, flexibility, or core work.

STRENGTH BLOCK:
- Compound exercises first (squat, deadlift, bench press, rows), then isolation work
- Progressive overload: increase weight/reps/sets each week
- Muscle group rotation across days: upper body → lower body → full body/core

CARDIO/CONDITIONING:
- HIIT intervals, circuit training, jump rope, sprint intervals, burpees, mountain climbers
- 10-15 minutes high intensity
- Running, cycling, rowing — pure cardio, NO ball sports

SESSION STRUCTURE:
- Each session: 2-3 strength exercises + 1 cardio/conditioning exercise
- Day rotation ensures balanced muscle development
- ALL exercises must match the athlete's available equipment (see equipment rules below)

EQUIPMENT RULES:
- If equipment is "none"/bodyweight: ONLY bodyweight exercises. NO dumbbells, NO barbells, NO machines, NO bands.
- If equipment is "dumbbells": Include dumbbell exercises, bodyweight exercises allowed too.
- If equipment is "resistance_bands": Include band exercises, bodyweight exercises allowed too.
- NEVER suggest equipment the athlete doesn't have.

DISABILITY AWARENESS:
- Adapt ALL exercises to the athlete's physical abilities
- For wheelchair users: upper body focus, seated cardio (boxing, arm ergometer)
- For amputees: adapted exercises maintaining balance and safety
- Always provide safe alternatives

SAFETY:
- Proper warm-up before strength work
- Correct form over heavy weight
- Adequate rest between strength sets
- Cool-down with stretching after cardio`
};

const LOCATION_RULES = {
  home: `LOCATION: INDOOR/HOME - Limited space.
- Focus on ball feel, tight-space dribbling, seated/floor strength work.
- NO long sprints, NO high kicks, NO shooting drills.
- VIRTUAL OPPONENT: "Place 2 chairs 1.5m apart to simulate a defender."`,
  yard: `LOCATION: YARD - Medium space (5-15m).
- Short sprints, passing against wall/fence, controlled shooting.
- VIRTUAL OPPONENT: "Set up 3-4 bottles for slalom dribbling."`,
  field: `LOCATION: FULL FIELD - Open space.
- Explosive sprints, long passing, power shooting at goal.
- VIRTUAL OPPONENT: "Place bags/cones at 5m intervals as defensive line."`,
  gym: `LOCATION: GYM - Equipment available.
- Strength training with machines/weights, core on mats, ball work in open areas.`
};

const LOCATION_RULES_FITNESS = {
  home: `LOCATION: HOME - Limited space, bodyweight focus.
- Bodyweight circuits: push-ups, squats, lunges, planks, burpees.
- Small space cardio: jumping jacks, high knees, mountain climbers.
- NO equipment needed, use furniture for dips/elevated push-ups.`,
  yard: `LOCATION: YARD - Medium outdoor space.
- Jump rope, burpees, agility ladder drills.
- Bodyweight circuits with more range of movement.
- Sprint intervals between two points (10-20m).`,
  field: `LOCATION: FIELD - Open space for running.
- Sprint intervals, shuttle runs, outdoor conditioning.
- Long distance intervals (200-400m repeats).
- Combine running with bodyweight stations.`,
  gym: `LOCATION: GYM - Full equipment available.
- Machines, free weights, barbells, cardio equipment.
- Use treadmill/bike/rower for cardio finisher.
- Full strength training with proper equipment.`
};

const LEVEL_FOCUS = {
  beginner: 'Basic balance, simple ball touches, learning crutch movement, low intensity.',
  intermediate: 'Controlled dribbling, passing accuracy, moderate speed drills.',
  pro: 'High-speed dribbling, power shooting, explosive sprints, match-endurance.'
};

function buildWeekPrompt({ profile, sport, goals, daysPerWeek, location, weekNumber, equipment }) {
  const skillLevel = profile.skillLevel || 'beginner';
  const mobilityAid = profile.mobilityAid || 'none';
  const topGoals = goals.slice(0, 3).join(', ');
  const aidInfo = mobilityAid !== 'none' ? `Uses ${mobilityAid} during sport.` : '';
  const locationRulesMap = sport === 'fitness' ? LOCATION_RULES_FITNESS : LOCATION_RULES;
  const locationRules = locationRulesMap[location] || locationRulesMap.field;
  const levelDirective = LEVEL_FOCUS[skillLevel] || LEVEL_FOCUS.beginner;
  const hasStrength = goals.some(g => ['strength', 'weightLoss'].includes(g));
  const eq = equipment || 'none';

  const equipmentRules = {
    none: `BODYWEIGHT ONLY — NO WEIGHTS, NO DUMBBELLS, NO BARBELLS, NO MACHINES, NO RESISTANCE BANDS.
The athlete has ZERO equipment. Every exercise must use bodyweight only.
Strength exercises MUST use these EXACT Hebrew names (pick from this list):
שכיבות סמיכה, סקוואט, פלאנק, לאנג'ים, דיפס, כפיפות מרפק, גשר ישבן, כפיפות בטן, מטפס הרים, ישיבה על הקיר, פלאנק צידי.
NEVER suggest exercises that require any equipment when equipment is "none".`,
    dumbbells: `Strength exercises MUST use these EXACT Hebrew names (pick from this list):
שכיבות סמיכה, סקוואט, פלאנק, לאנג'ים, דיפס, כפיפות מרפק, גשר ישבן, כפיפות בטן, מטפס הרים, ישיבה על הקיר, פלאנק צידי,
כתפיים עם משקולות, גובלט סקוואט, הרמה צידית, משיכת משקולת, הרחבת מרפק.
Prefer dumbbell exercises when possible.`,
    resistance_bands: `Strength exercises MUST use these EXACT Hebrew names (pick from this list):
שכיבות סמיכה, סקוואט, פלאנק, לאנג'ים, דיפס, כפיפות מרפק, גשר ישבן, כפיפות בטן, מטפס הרים, ישיבה על הקיר, פלאנק צידי,
לחיצת כתפיים עם גומייה, סקוואט עם גומייה, כפיפות מרפק עם גומייה, משיכת גומייה, מתיחת גומייה.
Prefer resistance band exercises when possible.`,
  };

  const disabilityStrength = {
    one_arm: `For ONE-ARM athletes: ONLY use exercises they can do with one arm.
PREFERRED: סקוואט, לאנג'ים, גשר ישבן, כפיפות בטן, פלאנק, מטפס הרים, ישיבה על הקיר, פלאנק צידי, כפיפות מרפק (one arm).
AVOID: שכיבות סמיכה (unless modified), מתיחת גומייה. Focus on core and legs.`,
    one_leg: `For ONE-LEG amputee athletes (crutches): ONLY upper body + core + adapted exercises.
PREFERRED: שכיבות סמיכה, דיפס, פלאנק, כפיפות מרפק, כפיפות בטן, גשר ישבן, פלאנק צידי, כתפיים עם משקולות, הרמה צידית, הרחבת מרפק, משיכת משקולת.
AVOID: סקוואט, לאנג'ים, מטפס הרים (require two legs). Squat only if described as single-leg with crutch support.`,
    two_legs: `For WHEELCHAIR athletes: ONLY upper body exercises done seated.
PREFERRED: שכיבות סמיכה, דיפס, כפיפות מרפק, כפיפות בטן, פלאנק, כתפיים עם משקולות, הרמה צידית, הרחבת מרפק, משיכת משקולת, מתיחת גומייה.
AVOID: סקוואט, לאנג'ים, גשר ישבן, מטפס הרים, ישיבה על הקיר (require standing/legs).`,
  };

  const eqRule = equipmentRules[eq] || equipmentRules.none;
  const disaStrength = disabilityStrength[profile.disability] || '';

  const strengthRule = sport === 'fitness'
    ? (hasStrength
      ? `MANDATORY: Every day MUST have 2-3 strength exercises + 1 cardio finisher. ${eqRule} ${disaStrength}`
      : `Each day: 1-2 strength exercises + 1 cardio finisher. ${eqRule} ${disaStrength}`)
    : `Include MAX 1 strength/conditioning exercise per day — the rest must be sport-specific drills. ${eqRule} ${disaStrength}`;

  const fitnessThemes = {
    beginner: ['חיזוק בסיסי', 'עוצמה ושריפת שומן', 'סיבולת וכוח', 'אימון שיא'],
    intermediate: ['חיזוק בסיסי', 'עוצמה ושריפת שומן', 'סיבולת וכוח', 'אימון שיא'],
    pro: ['חיזוק בסיסי', 'עוצמה ושריפת שומן', 'סיבולת וכוח', 'אימון שיא'],
  };
  const sportThemes = {
    beginner: ['יציבות בסיסית והיכרות', 'שליטה בכדור וחיזוק ליבה', 'תנועה עם כדור ומסירות', 'אימון משולב ומשחקון'],
    intermediate: ['טכניקה ושליטה', 'מהירות ודריבלינג', 'כוח ובעיטות', 'סימולציית משחק'],
    pro: ['עצימות גבוהה וטכניקה', 'מהירות פיצוצית ודריבלינג מתקדם', 'בעיטות כוח וטקטיקה', 'מוכנות למשחק מלא']
  };
  const themes = sport === 'fitness' ? fitnessThemes : sportThemes;
  const theme = (themes[skillLevel] || themes.beginner)[weekNumber - 1];

  const progressionRules = {
    beginner: {
      1: { sets: 2, reps: 8, rest: 60 },
      2: { sets: 2, reps: 10, rest: 55 },
      3: { sets: 3, reps: 8, rest: 50 },
      4: { sets: 3, reps: 10, rest: 45 },
    },
    intermediate: {
      1: { sets: 3, reps: 10, rest: 50 },
      2: { sets: 3, reps: 12, rest: 45 },
      3: { sets: 4, reps: 10, rest: 45 },
      4: { sets: 4, reps: 12, rest: 40 },
    },
    pro: {
      1: { sets: 4, reps: 10, rest: 45 },
      2: { sets: 4, reps: 12, rest: 40 },
      3: { sets: 5, reps: 10, rest: 35 },
      4: { sets: 5, reps: 12, rest: 30 },
    },
  };
  const prog = (progressionRules[skillLevel] || progressionRules.beginner)[weekNumber] || progressionRules.beginner[1];

  const age = Number(profile.age) || 25;
  const ageRule = age <= 12
    ? 'AGE GROUP KIDS (5-12): Lower volume (2 sets max), playful/fun approach, shorter sessions (25-30 min), NO heavy loads, NO technical lifts (dips, rows, shoulder press), focus on coordination, animal movements, and game-style exercises. Use encouraging game language.'
    : age <= 50
    ? 'AGE GROUP PERFORMANCE (13-50): Full access to all exercises. Intensity and volume based on skill level. Push limits. Bio-mechanical precision.'
    : 'AGE GROUP LONGEVITY (51-99): Low impact ONLY, NO explosive movements (burpees, jumping jacks, sprints, mountain climbers), focus on stability, balance, mobility, and joint health. Longer rest (+15s), longer warm-up (8-10 min). Breathing cues in tips.';

  return `Create week ${weekNumber}/4. Theme: "${theme}"

PLAYER: ${profile.name}, Age ${profile.age}, ${profile.gender}, ${profile.height}cm, ${profile.weight}kg
Disability: ${profile.disability}. ${aidInfo}
Level: ${skillLevel} — ${levelDirective}
${ageRule}
Sport: ${sport}. Goals: ${topGoals}. Days/week: ${daysPerWeek}.
Equipment available: ${eq === 'none' ? 'NONE — bodyweight only, absolutely no weights or equipment exercises' : eq === 'dumbbells' ? 'Dumbbells' : 'Resistance bands'}.

${locationRules}

STRENGTH: ${strengthRule}

PROGRESSIVE OVERLOAD (Week ${weekNumber}):
- ${sport === 'fitness' ? 'Strength' : 'All'} exercises: ${prog.sets} sets × ${prog.reps} reps, ${prog.rest}s rest
- This is week ${weekNumber}/4 — ${weekNumber === 1 ? 'foundation, lower volume' : weekNumber === 2 ? 'build volume' : weekNumber === 3 ? 'peak intensity' : 'consolidate and test'}.

${sport === 'fitness'
    ? `STRICT FITNESS-ONLY RULES:
- ZERO balls, ZERO sport drills, ZERO dribbling/shooting/passing. This is a GYM/FITNESS program.
- Each day MUST have 2-3 strength exercises + 1 cardio/conditioning exercise as finisher.
- Rotate muscle groups: Day 1=upper body, Day 2=lower body, Day 3=full body/core, then repeat.
- Cardio finisher examples: ריצת אינטרוולים, ספרינטים, jumping jacks, בורפיז, קפיצות חבל, מטפס הרים.
- RESPECT EQUIPMENT: If no equipment → bodyweight ONLY. If dumbbells → use them. If bands → use them.
- If you include ANY ball or sport drill, the entire plan is INVALID.`
    : `SPORT-FOCUSED RULES:
- The sport (${sport}) is the PRIMARY focus. ${hasStrength ? '3' : '2-3'} exercises should be sport-specific drills.
- Maximum 1 strength/conditioning exercise per day as a supplement — NOT the main focus.
- Sport drills: dribbling, passing, shooting, agility, tactical movement for this specific sport.
- SOLO TRAINING: Include household items as simulated defenders/targets in tips.`}

CRITICAL: Return ONLY raw JSON. NO markdown, NO backticks.
Descriptions max 15 words. ${sport === 'fitness' ? (hasStrength ? '3-4' : '3') : '3-4'} exercises per day${sport !== 'fitness' ? ` (${hasStrength ? '3' : '2-3'} sport drills + max 1 strength)` : ' (all fitness exercises, NO sport drills)'}.

{"weekNumber":${weekNumber},"theme":"${theme}","days":[{"day":"יום א","focus":"focus","exercises":[{"name":"שם","description":"תיאור קצר","sets":${prog.sets},"reps":"${prog.reps}","restSeconds":${prog.rest},"tips":"טיפ"}],"warmup":"חימום","cooldown":"שחרור","durationMinutes":50}]}

Hebrew only. ${daysPerWeek} days.`;
}

// Local fallback week generator when API is unavailable
export function getLocalFallbackWeek({ profile, sport, goals, daysPerWeek, location, weekNumber, equipment }) {
  const hasStrength = goals?.some(g => ['strength', 'weightLoss'].includes(g));
  const disability = profile?.disability || 'none';
  const mobilityAid = profile?.mobilityAid || 'none';
  const skillLevel = profile?.skillLevel || 'beginner';
  const eq = equipment || 'none';
  const days = [];

  // Progressive overload by week
  const progressionRules = {
    beginner: { 1: { sets: 2, reps: 8, rest: 60 }, 2: { sets: 2, reps: 10, rest: 55 }, 3: { sets: 3, reps: 8, rest: 50 }, 4: { sets: 3, reps: 10, rest: 45 } },
    intermediate: { 1: { sets: 3, reps: 10, rest: 50 }, 2: { sets: 3, reps: 12, rest: 45 }, 3: { sets: 4, reps: 10, rest: 45 }, 4: { sets: 4, reps: 12, rest: 40 } },
    pro: { 1: { sets: 4, reps: 10, rest: 45 }, 2: { sets: 4, reps: 12, rest: 40 }, 3: { sets: 5, reps: 10, rest: 35 }, 4: { sets: 5, reps: 12, rest: 30 } },
  };
  const prog = (progressionRules[skillLevel] || progressionRules.beginner)[weekNumber] || progressionRules.beginner[1];

  // === DISABILITY-ADAPTED STRENGTH EXERCISES ===
  // one_leg (amputee football with crutches)
  const strengthOneLeg = {
    none: [
      { name: 'דיפס', description: 'שקיעות גוף נשענים על הקביים', sets: 3, reps: '10', restSeconds: 60, tips: 'תנועה מבוקרת, אל תנעל את המרפקים' },
      { name: 'סקוואט', description: 'כריעה על הרגל העומדת עם תמיכת קביים', sets: 3, reps: '8', restSeconds: 60, tips: 'היעזר בקביים לאיזון' },
      { name: 'פלאנק', description: 'החזקה בתנוחת פלאנק', sets: 3, reps: '30', restSeconds: 45, tips: 'שמור על ליבה מחוזקת' },
      { name: 'שכיבות סמיכה', description: 'שכיבות סמיכה על הברכיים או מלאות', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
      { name: 'כפיפות בטן', description: 'כפיפות בטן על הרצפה', sets: 3, reps: '15', restSeconds: 45, tips: 'אל תמשוך את הצוואר' },
      { name: 'גשר ישבן', description: 'הרמת ירכיים שכיבה על הגב', sets: 3, reps: '12', restSeconds: 60, tips: 'סחוט את הישבן למעלה' },
    ],
    dumbbells: [
      { name: 'כתפיים עם משקולות', description: 'לחיצת כתפיים בישיבה עם משקולות', sets: 3, reps: '10', restSeconds: 60, tips: 'גב צמוד לכיסא' },
      { name: 'כפיפות מרפק', description: 'כפיפות מרפק עם משקולות', sets: 3, reps: '10', restSeconds: 60, tips: 'מרפקים צמודים לגוף' },
      { name: 'הרמה צידית', description: 'הרמת משקולות לצדדים', sets: 3, reps: '12', restSeconds: 60, tips: 'אל תרים מעל הכתפיים' },
      { name: 'משיכת משקולת', description: 'משיכת משקולת בכפיפה', sets: 3, reps: '10', restSeconds: 60, tips: 'כווץ את הגב' },
      { name: 'הרחבת מרפק', description: 'הרחבת מרפק מעל הראש', sets: 3, reps: '10', restSeconds: 60, tips: 'מרפקים קרובים לראש' },
      { name: 'שכיבות סמיכה', description: 'שכיבות סמיכה מלאות', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
      { name: 'פלאנק', description: 'החזקה בתנוחת פלאנק', sets: 3, reps: '30', restSeconds: 45, tips: 'שמור על ליבה מחוזקת' },
      { name: 'גשר ישבן', description: 'הרמת ירכיים עם משקולת', sets: 3, reps: '12', restSeconds: 60, tips: 'סחוט את הישבן למעלה' },
    ],
    resistance_bands: [
      { name: 'לחיצת כתפיים עם גומייה', description: 'לחיצת כתפיים בישיבה עם גומייה', sets: 3, reps: '12', restSeconds: 60, tips: 'תנועה מבוקרת' },
      { name: 'כפיפות מרפק עם גומייה', description: 'כפיפות מרפק עם גומייה', sets: 3, reps: '12', restSeconds: 60, tips: 'מרפקים צמודים לגוף' },
      { name: 'משיכת גומייה', description: 'משיכת גומייה לכיוון החזה', sets: 3, reps: '12', restSeconds: 60, tips: 'כווץ את הכתפיים אחורה' },
      { name: 'שכיבות סמיכה', description: 'שכיבות סמיכה מלאות', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
      { name: 'פלאנק', description: 'החזקה בתנוחת פלאנק', sets: 3, reps: '30', restSeconds: 45, tips: 'שמור על ליבה מחוזקת' },
      { name: 'פלאנק צידי', description: 'החזקה בתנוחת פלאנק צידי', sets: 3, reps: '20', restSeconds: 45, tips: 'שמור על הירכיים גבוהות' },
      { name: 'מתיחת גומייה', description: 'מתיחת גומייה לצדדים', sets: 3, reps: '12', restSeconds: 60, tips: 'זרועות ישרות' },
    ],
  };

  // one_arm
  const strengthOneArm = {
    none: [
      { name: 'סקוואט', description: 'כריעות עם משקל הגוף', sets: 3, reps: '12', restSeconds: 60, tips: 'ברכיים מעל האצבעות' },
      { name: 'לאנג\'ים', description: 'מכרעות קדימה לסירוגין', sets: 3, reps: '10', restSeconds: 60, tips: 'צעד גדול קדימה' },
      { name: 'פלאנק', description: 'החזקה בתנוחת פלאנק', sets: 3, reps: '30', restSeconds: 45, tips: 'שמור על ליבה מחוזקת' },
      { name: 'גשר ישבן', description: 'הרמת ירכיים שכיבה על הגב', sets: 3, reps: '12', restSeconds: 60, tips: 'סחוט את הישבן למעלה' },
      { name: 'כפיפות בטן', description: 'כפיפות בטן על הרצפה', sets: 3, reps: '15', restSeconds: 45, tips: 'אל תמשוך את הצוואר' },
      { name: 'מטפס הרים', description: 'תנועת ריצה בתנוחת פלאנק', sets: 3, reps: '20', restSeconds: 60, tips: 'שמור על ירכיים למטה' },
      { name: 'ישיבה על הקיר', description: 'ישיבה על הקיר ללא כיסא', sets: 3, reps: '30', restSeconds: 60, tips: 'ברכיים ב-90 מעלות' },
    ],
    dumbbells: [
      { name: 'כתפיים עם משקולות', description: 'לחיצת כתפיים ביד הפעילה', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על יציבות הגוף' },
      { name: 'גובלט סקוואט', description: 'כריעות עם משקולת ביד אחת', sets: 3, reps: '10', restSeconds: 60, tips: 'אחיזה יציבה במשקולת' },
      { name: 'כפיפות מרפק', description: 'כפיפות מרפק ביד אחת', sets: 3, reps: '10', restSeconds: 60, tips: 'מרפק צמוד לגוף' },
      { name: 'הרמה צידית', description: 'הרמה צידית ביד אחת', sets: 3, reps: '12', restSeconds: 60, tips: 'אל תרים מעל הכתף' },
      { name: 'משיכת משקולת', description: 'משיכת משקולת ביד אחת', sets: 3, reps: '10', restSeconds: 60, tips: 'כווץ את הגב' },
      { name: 'פלאנק', description: 'החזקה בתנוחת פלאנק', sets: 3, reps: '30', restSeconds: 45, tips: 'שמור על ליבה מחוזקת' },
      { name: 'לאנג\'ים', description: 'מכרעות קדימה', sets: 3, reps: '10', restSeconds: 60, tips: 'צעד גדול קדימה' },
    ],
    resistance_bands: [
      { name: 'לחיצת כתפיים עם גומייה', description: 'לחיצת כתפיים ביד הפעילה', sets: 3, reps: '12', restSeconds: 60, tips: 'עמוד על הגומייה לייצוב' },
      { name: 'סקוואט עם גומייה', description: 'כריעות עם רצועת התנגדות', sets: 3, reps: '12', restSeconds: 60, tips: 'גומייה מתחת לכפות הרגליים' },
      { name: 'כפיפות מרפק עם גומייה', description: 'כפיפות מרפק ביד אחת', sets: 3, reps: '12', restSeconds: 60, tips: 'מרפק צמוד' },
      { name: 'לאנג\'ים', description: 'מכרעות קדימה', sets: 3, reps: '10', restSeconds: 60, tips: 'צעד גדול קדימה' },
      { name: 'פלאנק', description: 'החזקה בתנוחת פלאנק', sets: 3, reps: '30', restSeconds: 45, tips: 'שמור על ליבה מחוזקת' },
      { name: 'גשר ישבן', description: 'הרמת ירכיים', sets: 3, reps: '12', restSeconds: 60, tips: 'סחוט את הישבן' },
    ],
  };

  // two_legs / wheelchair - upper body only
  const strengthWheelchair = {
    none: [
      { name: 'שכיבות סמיכה', description: 'שכיבות סמיכה על הברכיים או מכיסא', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
      { name: 'דיפס', description: 'שקיעות גוף על משענות כיסא', sets: 3, reps: '10', restSeconds: 60, tips: 'תנועה מבוקרת' },
      { name: 'פלאנק', description: 'החזקה בתנוחת פלאנק', sets: 3, reps: '20', restSeconds: 45, tips: 'שמור על ליבה מחוזקת' },
      { name: 'כפיפות בטן', description: 'כפיפות בטן על הרצפה', sets: 3, reps: '15', restSeconds: 45, tips: 'אל תמשוך את הצוואר' },
      { name: 'כפיפות מרפק', description: 'כפיפות מרפק בישיבה', sets: 3, reps: '10', restSeconds: 60, tips: 'מרפקים צמודים לגוף' },
    ],
    dumbbells: [
      { name: 'כתפיים עם משקולות', description: 'לחיצת כתפיים בישיבה', sets: 3, reps: '10', restSeconds: 60, tips: 'גב צמוד לכיסא' },
      { name: 'כפיפות מרפק', description: 'כפיפות מרפק בישיבה', sets: 3, reps: '10', restSeconds: 60, tips: 'מרפקים צמודים לגוף' },
      { name: 'הרמה צידית', description: 'הרמה צידית בישיבה', sets: 3, reps: '12', restSeconds: 60, tips: 'אל תרים מעל הכתפיים' },
      { name: 'משיכת משקולת', description: 'משיכת משקולת בישיבה', sets: 3, reps: '10', restSeconds: 60, tips: 'כווץ את שרירי הגב' },
      { name: 'הרחבת מרפק', description: 'הרחבת מרפק מעל הראש בישיבה', sets: 3, reps: '10', restSeconds: 60, tips: 'מרפקים קרובים לראש' },
      { name: 'שכיבות סמיכה', description: 'שכיבות סמיכה מכיסא', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
    ],
    resistance_bands: [
      { name: 'לחיצת כתפיים עם גומייה', description: 'לחיצת כתפיים בישיבה', sets: 3, reps: '12', restSeconds: 60, tips: 'תנועה מבוקרת' },
      { name: 'כפיפות מרפק עם גומייה', description: 'כפיפות מרפק בישיבה', sets: 3, reps: '12', restSeconds: 60, tips: 'מרפקים צמודים' },
      { name: 'משיכת גומייה', description: 'משיכת גומייה לכיוון החזה', sets: 3, reps: '12', restSeconds: 60, tips: 'כווץ את הכתפיים אחורה' },
      { name: 'מתיחת גומייה', description: 'מתיחת גומייה לצדדים', sets: 3, reps: '12', restSeconds: 60, tips: 'זרועות ישרות' },
      { name: 'שכיבות סמיכה', description: 'שכיבות סמיכה מכיסא', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
      { name: 'דיפס', description: 'שקיעות גוף על כיסא', sets: 3, reps: '10', restSeconds: 60, tips: 'תנועה מבוקרת' },
    ],
  };

  // Regular (no disability)
  const strengthRegular = {
    none: [
      { name: 'שכיבות סמיכה', description: 'שכיבות סמיכה מלאות', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
      { name: 'סקוואט', description: 'כריעות עם משקל הגוף', sets: 3, reps: '12', restSeconds: 60, tips: 'ברכיים מעל האצבעות' },
      { name: 'פלאנק', description: 'החזקה בתנוחת פלאנק', sets: 3, reps: '30', restSeconds: 45, tips: 'שמור על ליבה מחוזקת' },
      { name: 'לאנג\'ים', description: 'מכרעות קדימה לסירוגין', sets: 3, reps: '10', restSeconds: 60, tips: 'צעד גדול קדימה' },
      { name: 'כפיפות מרפק', description: 'כפיפות מרפק עם משקל הגוף', sets: 3, reps: '10', restSeconds: 60, tips: 'מרפקים צמודים לגוף' },
      { name: 'גשר ישבן', description: 'הרמת ירכיים שכיבה על הגב', sets: 3, reps: '12', restSeconds: 60, tips: 'סחוט את הישבן למעלה' },
      { name: 'כפיפות בטן', description: 'כפיפות בטן על הרצפה', sets: 3, reps: '15', restSeconds: 45, tips: 'אל תמשוך את הצוואר' },
      { name: 'מטפס הרים', description: 'תנועת ריצה בתנוחת פלאנק', sets: 3, reps: '20', restSeconds: 60, tips: 'שמור על ירכיים למטה' },
    ],
    dumbbells: [
      { name: 'כתפיים עם משקולות', description: 'לחיצת כתפיים עם משקולות', sets: 3, reps: '10', restSeconds: 60, tips: 'אל תקמר את הגב' },
      { name: 'גובלט סקוואט', description: 'כריעות עם משקולת מול החזה', sets: 3, reps: '12', restSeconds: 60, tips: 'החזק את המשקולת קרוב לחזה' },
      { name: 'שכיבות סמיכה', description: 'שכיבות סמיכה מלאות', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
      { name: 'הרמה צידית', description: 'הרמה צידית עם משקולות', sets: 3, reps: '12', restSeconds: 60, tips: 'אל תרים מעל גובה הכתפיים' },
      { name: 'משיכת משקולת', description: 'משיכת משקולת בכפיפה', sets: 3, reps: '10', restSeconds: 60, tips: 'כווץ את שרירי הגב' },
      { name: 'הרחבת מרפק', description: 'הרחבת מרפק מעל הראש', sets: 3, reps: '10', restSeconds: 60, tips: 'מרפקים קרובים לראש' },
      { name: 'כפיפות מרפק', description: 'כפיפות מרפק עם משקולות', sets: 3, reps: '10', restSeconds: 60, tips: 'מרפקים צמודים לגוף' },
      { name: 'גשר ישבן', description: 'הרמת ירכיים עם משקולת', sets: 3, reps: '12', restSeconds: 60, tips: 'משקולת על הירכיים' },
    ],
    resistance_bands: [
      { name: 'לחיצת כתפיים עם גומייה', description: 'לחיצת כתפיים עם רצועת התנגדות', sets: 3, reps: '12', restSeconds: 60, tips: 'תנועה מבוקרת' },
      { name: 'סקוואט עם גומייה', description: 'כריעות עם רצועת התנגדות', sets: 3, reps: '12', restSeconds: 60, tips: 'גומייה מתחת לכפות הרגליים' },
      { name: 'שכיבות סמיכה', description: 'שכיבות סמיכה מלאות', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
      { name: 'לאנג\'ים', description: 'מכרעות קדימה', sets: 3, reps: '10', restSeconds: 60, tips: 'ברך לא עוברת את האצבעות' },
      { name: 'כפיפות מרפק עם גומייה', description: 'כפיפות מרפק עם גומייה', sets: 3, reps: '12', restSeconds: 60, tips: 'מרפקים צמודים לגוף' },
      { name: 'משיכת גומייה', description: 'משיכת גומייה לכיוון החזה', sets: 3, reps: '12', restSeconds: 60, tips: 'כווץ את הכתפיים אחורה' },
      { name: 'מתיחת גומייה', description: 'מתיחת גומייה לצדדים', sets: 3, reps: '12', restSeconds: 60, tips: 'זרועות ישרות' },
      { name: 'גשר ישבן', description: 'הרמת ירכיים עם גומייה', sets: 3, reps: '12', restSeconds: 60, tips: 'גומייה סביב הברכיים' },
    ],
  };

  // Disability-adapted sport drills
  const sportDrillsOneLeg = {
    home: [
      { name: 'שליטה בכדור עם קביים', description: 'נגיעות בכדור ברגל אחת עם תמיכת קביים', sets: 3, reps: '20', restSeconds: 45, tips: 'היישען על הקביים ליציבות' },
      { name: 'כדרור במקום', description: 'שליטה בכדור ברגל אחת', sets: 3, reps: '15', restSeconds: 60, tips: 'ראש למעלה' },
    ],
    field: [
      { name: 'דריבלינג עם קביים', description: 'כדרור בין קונוסים עם קביים', sets: 3, reps: '8', restSeconds: 90, tips: 'ראש למעלה, מבט על המגרש' },
      { name: 'בעיטות לשער', description: 'בעיטות ברגל אחת עם תמיכת קביים', sets: 3, reps: '8', restSeconds: 60, tips: 'היישען חזק על הקביים לפני הבעיטה' },
    ],
    gym: [
      { name: 'שליטה בכדור', description: 'תרגול שליטה ברגל אחת', sets: 3, reps: '15', restSeconds: 45, tips: 'נגיעות מבוקרות' },
      { name: 'סיבוב עם כדור', description: 'סיבוב על קביים עם כדור', sets: 3, reps: '10', restSeconds: 60, tips: 'סיבוב מלא על הקביים' },
    ],
    yard: [
      { name: 'דריבלינג עם קביים', description: 'כדרור בשטח פתוח עם קביים', sets: 3, reps: '8', restSeconds: 90, tips: 'שנה כיוון' },
      { name: 'מסירות', description: 'מסירות ברגל אחת לקיר', sets: 3, reps: '12', restSeconds: 45, tips: 'דיוק במסירה' },
    ],
  };

  const sportDrillsRegular = {
    home: [
      { name: 'שליטה בכדור', description: 'נגיעות קצרות בכדור במקום', sets: 3, reps: '30', restSeconds: 45, tips: 'שמור על ראש למעלה' },
      { name: 'דריבלינג בין כיסאות', description: 'כדרור בין כיסאות כמכשולים', sets: 3, reps: '10', restSeconds: 60, tips: 'השתמש בשתי הרגליים' },
    ],
    field: [
      { name: 'דריבלינג עם קונוסים', description: 'כדרור מהיר בין קונוסים', sets: 3, reps: '10', restSeconds: 60, tips: 'ראש למעלה, מבט על המגרש' },
      { name: 'בעיטות לשער', description: 'בעיטות מרחקים שונים', sets: 3, reps: '10', restSeconds: 60, tips: 'כוון לפינות' },
    ],
    gym: [
      { name: 'שליטה בכדור', description: 'תרגול שליטה בכדור', sets: 3, reps: '20', restSeconds: 45, tips: 'נגיעות מבוקרות' },
      { name: 'דריבלינג במקום', description: 'כדרור מהיר במקום', sets: 3, reps: '15', restSeconds: 60, tips: 'שינוי כיוונים' },
    ],
    yard: [
      { name: 'דריבלינג חופשי', description: 'כדרור בשטח פתוח', sets: 3, reps: '10', restSeconds: 60, tips: 'שנה כיוון לעיתים קרובות' },
      { name: 'מסירות לקיר', description: 'מסירות לקיר וקבלה', sets: 3, reps: '15', restSeconds: 45, tips: 'קבלה עם כפות הרגליים' },
    ],
  };

  const sportDrillsWheelchair = {
    home: [
      { name: 'שליטה בכדור בישיבה', description: 'ניהול כדור בישיבה על כיסא', sets: 3, reps: '20', restSeconds: 45, tips: 'שמור על ראש למעלה' },
      { name: 'מסירות בישיבה', description: 'מסירות כדור מהכיסא', sets: 3, reps: '15', restSeconds: 60, tips: 'דיוק במסירה' },
    ],
    field: [
      { name: 'נהיגת כיסא עם כדור', description: 'תנועה עם כיסא ושליטה בכדור', sets: 3, reps: '8', restSeconds: 90, tips: 'שמור על שליטה' },
      { name: 'זריקות לסל', description: 'זריקות מכיסא הגלגלים', sets: 3, reps: '10', restSeconds: 60, tips: 'סיבוב גוף שלם' },
    ],
    gym: [
      { name: 'שליטה בכדור', description: 'תרגול שליטה בישיבה', sets: 3, reps: '15', restSeconds: 45, tips: 'נגיעות מבוקרות' },
      { name: 'סיבובי כיסא', description: 'סיבובים מהירים בכיסא', sets: 3, reps: '10', restSeconds: 60, tips: 'שימוש בידיים לסיבוב' },
    ],
    yard: [
      { name: 'נהיגת כיסא', description: 'נהיגה מהירה בין נקודות', sets: 3, reps: '8', restSeconds: 90, tips: 'שנה כיוון' },
      { name: 'מסירות', description: 'מסירות כדור מכיסא', sets: 3, reps: '12', restSeconds: 45, tips: 'דיוק ועוצמה' },
    ],
  };

  // Fitness-specific cardio/conditioning drills per disability
  const sportDrillsFitnessRegular = {
    home: [
      { name: 'בורפיז', description: 'בורפיז מלאים בקצב גבוה', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על טכניקה נכונה' },
      { name: 'jumping jacks', description: 'קפיצות פיצוח בקצב מהיר', sets: 3, reps: '30', restSeconds: 45, tips: 'ידיים מלאות מעל הראש' },
    ],
    field: [
      { name: 'ריצת אינטרוולים', description: 'ספרינט 30 שניות, הליכה 30 שניות', sets: 3, reps: '6', restSeconds: 60, tips: 'ספרינט מלא ואז שחרור' },
      { name: 'ספרינטים', description: 'ספרינט 50 מטר חזרה הליכה', sets: 3, reps: '8', restSeconds: 90, tips: 'הנעה מלאה מכפות הרגליים' },
    ],
    gym: [
      { name: 'ריצת אינטרוולים', description: 'אינטרוולים על הליכון או אופני כושר', sets: 3, reps: '8', restSeconds: 60, tips: 'חלופות מהיר-איטי' },
      { name: 'קפיצות', description: 'קפיצות סקוואט פיצוציות', sets: 3, reps: '12', restSeconds: 60, tips: 'נחיתה רכה על כפות הרגליים' },
    ],
    yard: [
      { name: 'בורפיז', description: 'בורפיז מלאים בשטח פתוח', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על קצב' },
      { name: 'ספרינטים', description: 'ריצות קצרות הלוך וחזור', sets: 3, reps: '8', restSeconds: 90, tips: 'האץ בהדרגה' },
    ],
  };

  const sportDrillsFitnessOneLeg = {
    home: [
      { name: 'אירובי ישיבה', description: 'תנועות אירוביות בישיבה על כיסא', sets: 3, reps: '30', restSeconds: 45, tips: 'שמור על קצב גבוה' },
      { name: 'סיבובי גוף עליון מהירים', description: 'סיבובי גוף מהירים בישיבה', sets: 3, reps: '20', restSeconds: 45, tips: 'תנועה מלאה מצד לצד' },
    ],
    field: [
      { name: 'הליכת קביים מהירה', description: 'הליכה מהירה על קביים 50 מטר', sets: 3, reps: '6', restSeconds: 90, tips: 'שמור על יציבות' },
      { name: 'סיבובי גוף עליון מהירים', description: 'סיבובים עם קביים לייצוב', sets: 3, reps: '20', restSeconds: 45, tips: 'תנועה מבוקרת ומהירה' },
    ],
    gym: [
      { name: 'אירובי ישיבה', description: 'ארגומטר ידיים או אופני ישיבה', sets: 3, reps: '30', restSeconds: 60, tips: 'קצב גבוה ויציב' },
      { name: 'סיבובי גוף עליון מהירים', description: 'סיבובים עם כבל או גומייה', sets: 3, reps: '15', restSeconds: 45, tips: 'שליטה בתנועה' },
    ],
    yard: [
      { name: 'הליכת קביים מהירה', description: 'הליכה מהירה בשטח פתוח', sets: 3, reps: '6', restSeconds: 90, tips: 'שמור על קצב ויציבות' },
      { name: 'אירובי ישיבה', description: 'אירובי בישיבה על ספסל', sets: 3, reps: '30', restSeconds: 45, tips: 'ידיים פעילות כל הזמן' },
    ],
  };

  const sportDrillsFitnessOneArm = {
    home: [
      { name: 'סקוואט קפיצות', description: 'כריעות עם קפיצה פיצוצית', sets: 3, reps: '10', restSeconds: 60, tips: 'נחיתה רכה' },
      { name: 'לאנג\'ים עם קפיצה', description: 'מכרעות עם החלפת רגליים באוויר', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על איזון' },
    ],
    field: [
      { name: 'ריצה', description: 'ריצה חופשית בקצב משתנה', sets: 3, reps: '6', restSeconds: 90, tips: 'חלופות מהיר-איטי' },
      { name: 'סקוואט קפיצות', description: 'כריעות עם קפיצה במגרש', sets: 3, reps: '12', restSeconds: 60, tips: 'הנעה מלאה' },
    ],
    gym: [
      { name: 'ריצה', description: 'ריצת אינטרוולים על הליכון', sets: 3, reps: '8', restSeconds: 60, tips: 'שנה מהירות כל דקה' },
      { name: 'לאנג\'ים עם קפיצה', description: 'מכרעות קפיצה באזור חופשי', sets: 3, reps: '10', restSeconds: 60, tips: 'נחיתה יציבה' },
    ],
    yard: [
      { name: 'ריצה', description: 'ריצת אינטרוולים בשטח', sets: 3, reps: '6', restSeconds: 90, tips: 'ספרינט ואז הליכה' },
      { name: 'סקוואט קפיצות', description: 'כריעות קפיצה בחצר', sets: 3, reps: '12', restSeconds: 60, tips: 'נחיתה רכה' },
    ],
  };

  const sportDrillsFitnessWheelchair = {
    home: [
      { name: 'אגרוף ישיבה', description: 'מכות אגרוף מהירות בישיבה', sets: 3, reps: '30', restSeconds: 45, tips: 'תנועה מלאה ומהירה' },
      { name: 'סיבובי ידיים מהירים', description: 'סיבובי ידיים קדימה ואחורה', sets: 3, reps: '20', restSeconds: 45, tips: 'שמור על קצב' },
    ],
    field: [
      { name: 'ספרינט כיסא', description: 'ספרינט בכיסא גלגלים 30 מטר', sets: 3, reps: '6', restSeconds: 90, tips: 'הנעה מלאה מהכתפיים' },
      { name: 'סיבובי ידיים מהירים', description: 'סיבובי ידיים עם משקל קל', sets: 3, reps: '20', restSeconds: 45, tips: 'שמור על קצב גבוה' },
    ],
    gym: [
      { name: 'אגרוף ישיבה', description: 'אגרוף על שק או באוויר', sets: 3, reps: '30', restSeconds: 60, tips: 'סיבוב גוף עליון מלא' },
      { name: 'ספרינט כיסא', description: 'ספרינט כיסא בשטח חופשי', sets: 3, reps: '6', restSeconds: 90, tips: 'מהירות מקסימלית' },
    ],
    yard: [
      { name: 'ספרינט כיסא', description: 'ספרינט כיסא הלוך וחזור', sets: 3, reps: '6', restSeconds: 90, tips: 'שנה כיוון מהר' },
      { name: 'אגרוף ישיבה', description: 'סדרות אגרוף מהירות', sets: 3, reps: '30', restSeconds: 45, tips: 'שמור על נשימה' },
    ],
  };

  // === SPORT-SPECIFIC DRILL POOLS (Basketball, Tennis) ===
  const sportDrillsBasketball = {
    home: [
      { name: 'כדרור ביד', description: 'כדרור נמוך וגבוה במקום', sets: 3, reps: '20', restSeconds: 45, tips: 'שמור על ראש למעלה' },
      { name: 'תרגול זריקה', description: 'תנועת זריקה לסל דמיוני', sets: 3, reps: '15', restSeconds: 60, tips: 'מרפק מתחת לכדור' },
    ],
    yard: [
      { name: 'כדרור בין קונוסים', description: 'כדרור ביד בין מכשולים', sets: 3, reps: '10', restSeconds: 60, tips: 'החלף ידיים' },
      { name: 'זריקות חופשיות', description: 'זריקות חופשיות לסל או למטרה', sets: 3, reps: '12', restSeconds: 60, tips: 'כופף ברכיים לפני הזריקה' },
    ],
    field: [
      { name: 'כדרור מהיר', description: 'כדרור בריצה למרחקים ארוכים', sets: 3, reps: '8', restSeconds: 90, tips: 'ראש למעלה, שליטה בכדור' },
      { name: 'זריקות ממרחקים שונים', description: 'זריקות מנקודות שונות במגרש', sets: 3, reps: '10', restSeconds: 60, tips: 'קשת גבוהה על הכדור' },
    ],
    gym: [
      { name: 'כדרור + זריקות חופשיות', description: 'שילוב כדרור וזריקות', sets: 3, reps: '10', restSeconds: 60, tips: 'כדרור → עצירה → זריקה' },
      { name: 'תרגול הנחתה', description: 'הנחתות מצד ימין ושמאל', sets: 3, reps: '10', restSeconds: 60, tips: 'שתי ידיים לסירוגין' },
    ],
  };

  const sportDrillsTennis = {
    home: [
      { name: 'תנועות מחבט', description: 'תנועות פורהנד ובקהנד באוויר', sets: 3, reps: '15', restSeconds: 45, tips: 'סיבוב מלא של הגוף' },
      { name: 'עבודת רגליים', description: 'צעדי הצלבה ותנועה צידית', sets: 3, reps: '20', restSeconds: 45, tips: 'הישאר על כפות הרגליים' },
    ],
    yard: [
      { name: 'מכות לקיר', description: 'חזרות פורהנד ובקהנד לקיר', sets: 3, reps: '20', restSeconds: 60, tips: 'שמור על מרחק נכון מהקיר' },
      { name: 'תנועת מגרש', description: 'ריצה לצדדים כמו במגרש', sets: 3, reps: '10', restSeconds: 60, tips: 'חזרה למרכז אחרי כל תנועה' },
    ],
    field: [
      { name: 'פורהנד ובקהנד', description: 'תרגול מכות מקו הבסיס', sets: 3, reps: '15', restSeconds: 60, tips: 'סיום גבוה של המחבט' },
      { name: 'תרגול הגשה', description: 'הגשות למטרות בתיבת ההגשה', sets: 3, reps: '10', restSeconds: 60, tips: 'זריקת כדור גבוהה ויציבה' },
    ],
    gym: [
      { name: 'עבודת רגליים', description: 'תרגילי זריזות ותנועה צידית', sets: 3, reps: '15', restSeconds: 45, tips: 'צעדים קצרים ומהירים' },
      { name: 'תנועות מחבט', description: 'תנועות מחבט עם גומייה להתנגדות', sets: 3, reps: '12', restSeconds: 60, tips: 'התנגדות מבוקרת' },
    ],
  };

  const sportDrillsBasketballWheelchair = {
    home: [
      { name: 'כדרור מכיסא', description: 'כדרור נמוך וגבוה בישיבה', sets: 3, reps: '20', restSeconds: 45, tips: 'שמור על ראש למעלה' },
      { name: 'מסירות מכיסא', description: 'מסירות חזה ובאונס מישיבה', sets: 3, reps: '15', restSeconds: 60, tips: 'סיבוב גוף עליון למסירה' },
    ],
    yard: [
      { name: 'כדרור + נהיגת כיסא', description: 'כדרור תוך כדי נהיגה בכיסא', sets: 3, reps: '8', restSeconds: 90, tips: 'דחיפה אחת ואז כדרור' },
      { name: 'זריקות מכיסא', description: 'זריקות לסל או למטרה מהכיסא', sets: 3, reps: '12', restSeconds: 60, tips: 'כוח מסיבוב הגוף' },
    ],
    field: [
      { name: 'ספרינט כיסא + כדרור', description: 'ספרינט בכיסא עם שליטה בכדור', sets: 3, reps: '6', restSeconds: 90, tips: 'שמור על שליטה במהירות' },
      { name: 'זריקות ממרחקים', description: 'זריקות מנקודות שונות במגרש', sets: 3, reps: '10', restSeconds: 60, tips: 'השתמש בכוח הרגליים והגוף' },
    ],
    gym: [
      { name: 'כדרור מכיסא', description: 'כדרור + עצירות מהירות', sets: 3, reps: '15', restSeconds: 45, tips: 'החלף ידיים' },
      { name: 'זריקות חופשיות מכיסא', description: 'זריקות חופשיות מישיבה', sets: 3, reps: '12', restSeconds: 60, tips: 'מרפק מתחת לכדור' },
    ],
  };

  const sportDrillsTennisWheelchair = {
    home: [
      { name: 'תנועות מחבט מכיסא', description: 'פורהנד ובקהנד בישיבה', sets: 3, reps: '15', restSeconds: 45, tips: 'סיבוב גוף עליון מלא' },
      { name: 'עבודת ידיים מהירה', description: 'תגובה מהירה עם מחבט', sets: 3, reps: '20', restSeconds: 45, tips: 'אחיזה רפויה ומוכנה' },
    ],
    yard: [
      { name: 'מכות לקיר מכיסא', description: 'חזרות מכות לקיר מישיבה', sets: 3, reps: '15', restSeconds: 60, tips: 'כוח מסיבוב הגוף' },
      { name: 'תנועת כיסא במגרש', description: 'נהיגת כיסא קדימה ואחורה', sets: 3, reps: '10', restSeconds: 60, tips: 'חזרה למרכז' },
    ],
    field: [
      { name: 'מכות מקו הבסיס', description: 'פורהנד ובקהנד מהכיסא', sets: 3, reps: '12', restSeconds: 60, tips: 'מיקום כיסא לפני המכה' },
      { name: 'תרגול הגשה מכיסא', description: 'הגשות מותאמות מישיבה', sets: 3, reps: '10', restSeconds: 60, tips: 'זריקה יציבה ושליטה בגוף' },
    ],
    gym: [
      { name: 'תנועת כיסא + מחבט', description: 'שילוב נהיגת כיסא עם מכות', sets: 3, reps: '10', restSeconds: 60, tips: 'עצור לפני המכה' },
      { name: 'עבודת ידיים מהירה', description: 'תנועות מחבט מהירות בישיבה', sets: 3, reps: '15', restSeconds: 45, tips: 'החלף פורהנד ובקהנד' },
    ],
  };

  // Select pools based on disability and sport
  let strengthMap, drillMap, warmupText;

  const isFitness = sport === 'fitness';
  const isWheelchair = disability === 'two_legs' || mobilityAid === 'wheelchair';
  const isFootball = ['football', 'footballAmputee', 'footballAmputeeGK'].includes(sport);

  // Sport-specific drill map selection
  function getSportDrillMap() {
    if (isFitness) {
      if (disability === 'one_leg') return sportDrillsFitnessOneLeg;
      if (disability === 'one_arm') return sportDrillsFitnessOneArm;
      if (isWheelchair) return sportDrillsFitnessWheelchair;
      return sportDrillsFitnessRegular;
    }
    if (sport === 'basketball' || sport === 'basketballWheelchair') {
      return isWheelchair ? sportDrillsBasketballWheelchair : sportDrillsBasketball;
    }
    if (sport === 'tennis' || sport === 'tennisWheelchair') {
      return isWheelchair ? sportDrillsTennisWheelchair : sportDrillsTennis;
    }
    // Football variants + fallback
    if (disability === 'one_leg') return sportDrillsOneLeg;
    if (isWheelchair) return sportDrillsWheelchair;
    return sportDrillsRegular;
  }

  if (disability === 'one_leg') {
    strengthMap = strengthOneLeg;
    warmupText = isFitness
      ? 'חימום כתפיים ופרקי ידיים + הרמות ברך + מתיחות דינמיות'
      : 'חימום כתפיים ופרקי ידיים + הרמות ברך עם קביים';
  } else if (disability === 'one_arm') {
    strengthMap = strengthOneArm;
    warmupText = 'סיבוב יד פעילה + ריצה קלה + מתיחות דינמיות';
  } else if (isWheelchair) {
    strengthMap = strengthWheelchair;
    warmupText = 'חימום כתפיים + סיבובי ידיים + מתיחות פלג גוף עליון';
  } else {
    strengthMap = strengthRegular;
    warmupText = isFitness ? 'ריצה קלה + מתיחות דינמיות + חימום מפרקים' : 'ריצה קלה + מתיחות דינמיות';
  }

  drillMap = getSportDrillMap();

  const strengthPool = strengthMap[eq] || strengthMap.none;
  const drillPool = drillMap[location] || drillMap.field;

  const dayNames = ['יום א', 'יום ב', 'יום ג', 'יום ד', 'יום ה', 'יום ו'];
  const numDays = Math.min(daysPerWeek || 3, 6);

  const fallbackThemesBySport = {
    fitness: ['חיזוק בסיסי', 'עוצמה ושריפת שומן', 'סיבולת וכוח', 'אימון שיא'],
    football: ['יציבות וטכניקת כדור', 'שליטה ומסירות', 'מהירות ודריבלינג', 'כוח ובעיטות'],
    basketball: ['יסודות קליעה ודריבלינג', 'תנועה והגנה', 'קליעה ממרחק', 'סימולציית משחק'],
    tennis: ['טכניקת מכות', 'תנועה ועבודת רגליים', 'הגשה ודיוק', 'סימולציית נקודות'],
  };
  const themeKey = isFitness ? 'fitness'
    : (sport === 'basketball' || sport === 'basketballWheelchair') ? 'basketball'
    : (sport === 'tennis' || sport === 'tennisWheelchair') ? 'tennis'
    : 'football';
  const fallbackThemes = fallbackThemesBySport[themeKey];

  function applyProgression(ex) {
    const e = { ...ex };
    // Apply week progression for reps-based exercises (not timed holds)
    const isTimedHold = e.name === 'פלאנק' || e.name === 'פלאנק צידי' || e.name === 'ישיבה על הקיר';
    e.sets = prog.sets;
    if (!isTimedHold) {
      e.reps = String(prog.reps);
    }
    e.restSeconds = prog.rest;
    return e;
  }

  for (let d = 0; d < numDays; d++) {
    const exercises = [];
    exercises.push(applyProgression(drillPool[d % drillPool.length]));
    if (hasStrength) {
      exercises.push(applyProgression(strengthPool[(d * 2) % strengthPool.length]));
      exercises.push(applyProgression(strengthPool[(d * 2 + 1) % strengthPool.length]));
    } else {
      exercises.push(applyProgression(strengthPool[d % strengthPool.length]));
    }
    if (exercises.length < 4) {
      exercises.push(applyProgression(drillPool[(d + 1) % drillPool.length]));
    }

    days.push({
      day: dayNames[d],
      focus: isFitness
        ? (d % 3 === 0 ? 'פלג גוף עליון + קרדיו' : d % 3 === 1 ? 'פלג גוף תחתון + קרדיו' : 'גוף מלא + ליבה')
        : themeKey === 'basketball'
        ? (d % 2 === 0 ? 'כדרור וקליעה' : 'תנועה והגנה')
        : themeKey === 'tennis'
        ? (d % 2 === 0 ? 'מכות וטכניקה' : 'תנועה והגשה')
        : (d % 2 === 0 ? 'טכניקה וכוח' : 'מהירות ושליטה'),
      exercises,
      warmup: warmupText,
      cooldown: 'מתיחות סטטיות + נשימות',
      durationMinutes: 50,
    });
  }

  return {
    weekNumber,
    theme: fallbackThemes[(weekNumber - 1) % fallbackThemes.length],
    days,
  };
}

// Local fallback summary when API is unavailable
function getLocalFallbackSummary({ profile, sessionData }) {
  const name = profile?.name || 'שחקן';
  const exercises = sessionData?.exercises || [];
  const completedCount = exercises.filter(e => (e.setsCompleted || 0) >= (e.setsTarget || 1)).length;
  const totalCount = exercises.length;
  const totalCal = sessionData?.totalCalories || 0;
  const duration = Math.floor((sessionData?.totalDuration || 0) / 60);

  if (completedCount === totalCount && totalCount > 0) {
    return `${name}, כל הכבוד! סיימת את כל ${totalCount} התרגילים ב-${duration} דקות ושרפת ${totalCal} קלוריות. המשך כך!`;
  } else if (completedCount > 0) {
    return `${name}, עבודה טובה! השלמת ${completedCount} מתוך ${totalCount} תרגילים. בפעם הבאה ננסה לסיים הכל!`;
  }
  return `${name}, התחלת אימון וזה כבר מעולה! בפעם הבאה ננסה להשלים יותר תרגילים.`;
}

// === CROSS-SPORT ISOLATION FILTER ===
// Banned keywords per sport — exercises containing these terms are blocked
const BANNED_KEYWORDS_BY_SPORT = {
  fitness: [
    'כדור', 'שער', 'דריבל', 'דריבלינג', 'קליעה', 'בעיטה', 'בעיטות',
    'מסירה', 'מסירות', 'כדרור', 'חרוטים', 'קונוסים',
    'זריקה לסל', 'הנחתה', 'הגשה', 'סל', 'טניס', 'מחבט', 'פורהנד', 'בקהנד',
    'גול', 'שוער', 'עמדת שוער', 'חסימה', 'נגיחה', 'פנדל', 'קורנר',
    'ריצה עם כדור', 'שליטה בכדור', 'קבלת כדור',
    'dribble', 'dribbling', 'shoot', 'goal', 'pass', 'ball', 'kick', 'basket', 'racket', 'serve', 'cone',
  ],
  football: [
    'סל', 'קליעה לסל', 'חישוק', 'כדרור ביד', 'זריקה לסל', 'הנחתה',
    'טניס', 'מחבט', 'פורהנד', 'בקהנד', 'רשת',
    'כיסא גלגלים', 'wheelchair',
    'basket', 'racket', 'serve', 'forehand', 'backhand', 'dunk', 'layup',
  ],
  basketball: [
    'בעיטה', 'בעיטות', 'שער', 'גול', 'קורנר', 'פנדל', 'נגיחה', 'שוער',
    'קביים', 'crutch',
    'טניס', 'מחבט', 'פורהנד', 'בקהנד',
    'kick', 'goal', 'corner', 'penalty', 'racket', 'serve', 'forehand', 'backhand',
  ],
  tennis: [
    'בעיטה', 'בעיטות', 'שער', 'גול', 'קורנר', 'פנדל', 'נגיחה', 'שוער',
    'סל', 'קליעה לסל', 'חישוק', 'כדרור ביד', 'הנחתה',
    'קביים', 'crutch',
    'kick', 'goal', 'corner', 'penalty', 'basket', 'dunk', 'layup',
  ],
};

// Aliases — sport variants map to parent sport's banned list
const SPORT_ALIAS = {
  footballAmputee: 'football',
  footballAmputeeGK: 'football',
  basketballWheelchair: 'basketball',
  tennisWheelchair: 'tennis',
};

// Per-sport replacement exercises when a foreign exercise is filtered out
const REPLACEMENT_EXERCISES = {
  fitness: [
    { name: 'בורפיז', description: 'בורפיז מלאים בקצב גבוה', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על טכניקה נכונה' },
    { name: 'מטפס הרים', description: 'תנועת ריצה בתנוחת פלאנק', sets: 3, reps: '20', restSeconds: 60, tips: 'שמור על ירכיים למטה' },
    { name: 'jumping jacks', description: 'קפיצות פיצוח בקצב מהיר', sets: 3, reps: '30', restSeconds: 45, tips: 'ידיים מלאות מעל הראש' },
    { name: 'ריצת אינטרוולים', description: 'ספרינט 30 שניות, הליכה 30 שניות', sets: 3, reps: '6', restSeconds: 60, tips: 'ספרינט מלא ואז שחרור' },
    { name: 'סקוואט קפיצות', description: 'כריעות עם קפיצה פיצוצית', sets: 3, reps: '10', restSeconds: 60, tips: 'נחיתה רכה' },
    { name: 'פלאנק', description: 'החזקה בתנוחת פלאנק', sets: 3, reps: '30', restSeconds: 45, tips: 'שמור על ליבה מחוזקת' },
    { name: 'כפיפות בטן', description: 'כפיפות בטן על הרצפה', sets: 3, reps: '15', restSeconds: 45, tips: 'אל תמשוך את הצוואר' },
    { name: 'שכיבות סמיכה', description: 'שכיבות סמיכה מלאות', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
    { name: 'סקוואט', description: 'כריעות עם משקל הגוף', sets: 3, reps: '12', restSeconds: 60, tips: 'ברכיים מעל האצבעות' },
    { name: 'לאנג\'ים', description: 'מכרעות קדימה לסירוגין', sets: 3, reps: '10', restSeconds: 60, tips: 'צעד גדול קדימה' },
    { name: 'גשר ישבן', description: 'הרמת ירכיים שכיבה על הגב', sets: 3, reps: '12', restSeconds: 60, tips: 'סחוט את הישבן למעלה' },
    { name: 'פלאנק צידי', description: 'החזקה בתנוחת פלאנק צידי', sets: 3, reps: '20', restSeconds: 45, tips: 'שמור על הירכיים גבוהות' },
    { name: 'דיפס', description: 'שקיעות גוף על כיסא או ספסל', sets: 3, reps: '10', restSeconds: 60, tips: 'תנועה מבוקרת, אל תנעל מרפקים' },
    { name: 'ישיבה על הקיר', description: 'ישיבה על הקיר ללא כיסא', sets: 3, reps: '30', restSeconds: 60, tips: 'ברכיים ב-90 מעלות' },
    { name: 'ספרינטים', description: 'ריצות קצרות הלוך וחזור', sets: 3, reps: '8', restSeconds: 90, tips: 'האץ בהדרגה' },
    { name: 'לחיצת כתפיים', description: 'לחיצות כתפיים במשקל גוף או משקולות', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על גב ישר' },
  ],
  football: [
    { name: 'דריבל', description: 'דריבל עם כדור בין קונוסים', sets: 3, reps: '10', restSeconds: 60, tips: 'שמור על הכדור קרוב' },
    { name: 'בעיטות לשער', description: 'בעיטות מדויקות לפינות השער', sets: 3, reps: '10', restSeconds: 60, tips: 'כוון לפינות' },
    { name: 'מסירות קצרות', description: 'מסירות מדויקות למרחק קצר', sets: 3, reps: '12', restSeconds: 45, tips: 'פנים הרגל, דיוק מרבי' },
    { name: 'ריצה עם כדור', description: 'ריצה חופשית עם שליטה בכדור', sets: 3, reps: '8', restSeconds: 60, tips: 'ראש למעלה' },
    { name: 'עצירות וסיבובים', description: 'עצירות פתאומיות ושינויי כיוון', sets: 3, reps: '10', restSeconds: 60, tips: 'נחיתה על כף הרגל' },
    { name: 'שליטה בכדור', description: 'קבלת כדור ושליטה במגע ראשון', sets: 3, reps: '15', restSeconds: 45, tips: 'מגע רך, רגל רפויה' },
  ],
  basketball: [
    { name: 'כדרור ביד', description: 'כדרור נמוך וגבוה במקום', sets: 3, reps: '20', restSeconds: 45, tips: 'שמור על ראש למעלה' },
    { name: 'זריקות חופשיות', description: 'זריקות חופשיות לסל', sets: 3, reps: '12', restSeconds: 60, tips: 'כופף ברכיים לפני הזריקה' },
    { name: 'כדרור בין קונוסים', description: 'כדרור ביד בין מכשולים', sets: 3, reps: '10', restSeconds: 60, tips: 'החלף ידיים' },
    { name: 'תרגול הנחתה', description: 'הנחתות מצד ימין ושמאל', sets: 3, reps: '10', restSeconds: 60, tips: 'שתי ידיים לסירוגין' },
    { name: 'מסירות חזה', description: 'מסירות חזה מדויקות', sets: 3, reps: '12', restSeconds: 45, tips: 'זרועות ישרות בסיום' },
    { name: 'זריקות ממרחקים', description: 'זריקות מנקודות שונות', sets: 3, reps: '10', restSeconds: 60, tips: 'קשת גבוהה' },
  ],
  tennis: [
    { name: 'פורהנד', description: 'תנועות פורהנד חוזרות', sets: 3, reps: '15', restSeconds: 45, tips: 'סיבוב מלא של הגוף' },
    { name: 'בקהנד', description: 'תנועות בקהנד חוזרות', sets: 3, reps: '15', restSeconds: 45, tips: 'שתי ידיים יציבות' },
    { name: 'הגשה', description: 'תרגול הגשה מדויקת', sets: 3, reps: '10', restSeconds: 60, tips: 'זריקה גבוהה וישרה' },
    { name: 'עבודת רגליים', description: 'צעדי הצלבה ותנועה צידית', sets: 3, reps: '20', restSeconds: 45, tips: 'הישאר על כפות הרגליים' },
    { name: 'וולי', description: 'מכות וולי ליד הרשת', sets: 3, reps: '12', restSeconds: 45, tips: 'קדימה לכדור' },
    { name: 'תנועות מחבט', description: 'תנועות פורהנד ובקהנד באוויר', sets: 3, reps: '15', restSeconds: 45, tips: 'סיבוב מלא' },
  ],
};

// Focus text per sport for sanitization
const FOCUS_BY_SPORT = {
  fitness: ['פלג גוף עליון + קרדיו', 'פלג גוף תחתון + קרדיו', 'גוף מלא + ליבה'],
  football: ['טכניקה וכוח', 'מהירות ושליטה', 'דיוק ועוצמה'],
  basketball: ['כדרור וקליעה', 'תנועה והגנה', 'קליעה ועוצמה'],
  tennis: ['מכות וטכניקה', 'תנועה והגשה', 'דיוק ועוצמה'],
};

const THEME_BY_SPORT = {
  fitness: ['חיזוק בסיסי', 'עוצמה ושריפת שומן', 'סיבולת וכוח', 'אימון שיא'],
  football: ['יציבות וטכניקת כדור', 'שליטה ומסירות', 'מהירות ודריבלינג', 'כוח ובעיטות'],
  basketball: ['יסודות קליעה ודריבלינג', 'תנועה והגנה', 'קליעה ממרחק', 'סימולציית משחק'],
  tennis: ['טכניקת מכות', 'תנועה ועבודת רגליים', 'הגשה ודיוק', 'סימולציית נקודות'],
};

function resolveSport(sport) {
  return SPORT_ALIAS[sport] || sport;
}

function hasBannedKeyword(text, bannedList) {
  const lower = (text || '').toLowerCase();
  return bannedList.some(kw => lower.includes(kw));
}

function filterCrossSportLeakage(weekData, sport) {
  if (!weekData?.days) return weekData;

  const resolved = resolveSport(sport);
  const bannedList = BANNED_KEYWORDS_BY_SPORT[resolved];
  if (!bannedList) return weekData; // unknown sport — no filter

  const replacements = REPLACEMENT_EXERCISES[resolved] || REPLACEMENT_EXERCISES.fitness;
  const focusList = FOCUS_BY_SPORT[resolved] || FOCUS_BY_SPORT.fitness;
  const themeList = THEME_BY_SPORT[resolved] || THEME_BY_SPORT.fitness;

  // Sanitize week theme
  if (weekData.theme && hasBannedKeyword(weekData.theme, bannedList)) {
    weekData.theme = themeList[(weekData.weekNumber || 1) % themeList.length];
  }

  let replacementIdx = 0;

  for (let di = 0; di < weekData.days.length; di++) {
    const day = weekData.days[di];
    if (!day.exercises) continue;

    // Sanitize day focus
    if (day.focus && hasBannedKeyword(day.focus, bannedList)) {
      day.focus = focusList[di % focusList.length];
    }

    const usedInDay = new Set(day.exercises.filter(e => !hasBannedKeyword(e.name, bannedList)).map(e => e.name));
    day.exercises = day.exercises.map(ex => {
      if (hasBannedKeyword(ex.name, bannedList)) {
        console.warn(`[CrossSport Filter][${resolved}] Removed: "${ex.name}"`);
        for (let i = 0; i < replacements.length; i++) {
          const candidate = replacements[(replacementIdx + i) % replacements.length];
          if (!usedInDay.has(candidate.name)) {
            const replacement = { ...candidate, sets: ex.sets || candidate.sets, reps: ex.reps || candidate.reps, restSeconds: ex.restSeconds || candidate.restSeconds };
            usedInDay.add(candidate.name);
            replacementIdx = (replacementIdx + i + 1) % replacements.length;
            return replacement;
          }
        }
        return { ...replacements[replacementIdx++ % replacements.length] };
      }
      return ex;
    });
  }

  return weekData;
}

// Generate a single week
export async function generateWeek(params) {
  const sportContext = SPORT_CONTEXTS[params.sport] || SPORT_CONTEXTS.football;
  const prompt = buildWeekPrompt(params);

  console.log(`Generating week ${params.weekNumber}/4 (${params.profile.skillLevel || 'beginner'}, ${params.location})...`);
  try {
    const text = await callClaude(sportContext, prompt);
    const parsed = extractJSON(text);
    if (parsed) return filterCrossSportLeakage(parsed, params.sport);

    console.error(`Week ${params.weekNumber} parse failed. Length: ${text.length}`);
    console.error('Start:', text.substring(0, 300));
  } catch (err) {
    console.error(`Week ${params.weekNumber} API error:`, err.message);
  }

  // Fallback to local template
  console.log(`Using local fallback for week ${params.weekNumber}`);
  return filterCrossSportLeakage(getLocalFallbackWeek(params), params.sport);
}

// Generate tips
export async function generateTips({ profile, sport, goals, location }) {
  const sportContext = SPORT_CONTEXTS[sport] || SPORT_CONTEXTS.football;
  const skillLevel = profile.skillLevel || 'beginner';
  const mobilityAid = profile.mobilityAid || 'none';
  const aidInfo = mobilityAid !== 'none' ? `Uses ${mobilityAid}.` : '';
  const hasStrength = goals.some(g => ['strength', 'weightLoss'].includes(g));

  const text = await callClaude(sportContext,
    `Give 4 training tips and 4 safety notes for a ${skillLevel}-level ${sport} player.
Disability: ${profile.disability}. ${aidInfo} Location: ${location}.${hasStrength ? ' Include strength advice.' : ''}
ONLY raw JSON, no markdown: {"generalTips":["tip1","tip2","tip3","tip4"],"safetyNotes":["note1","note2","note3","note4"]}
Hebrew only.`, 1024);

  return extractJSON(text) || { generalTips: [], safetyNotes: [] };
}

export async function generateWorkoutSummary({ profile, sessionData }) {
  const sportCtx = SPORT_CONTEXTS[sessionData.sport] || SPORT_CONTEXTS.football;
  const system = `${sportCtx}

You are writing a short post-workout summary as an elite personal coach.
Be specific about what the athlete did well and what needs improvement.
Reference specific exercises by name. Be motivational but honest.
Write in Hebrew. Keep it to 2-3 sentences max. Address the player by name.`;

  const exerciseLines = (sessionData.exercises || []).map(e =>
    `${e.name}: ${e.repsActual || 0}/${e.repsTarget || 0} reps, ${e.setsCompleted || 0}/${e.setsTarget || 0} sets, quality: ${e.quality || 'unknown'}`
  ).join('; ');

  const content = `Player: ${profile.name}, Age: ${profile.age}, Sport: ${sessionData.sport}, Disability: ${profile.disability || 'none'}
Session status: ${sessionData.status}, Duration: ${Math.floor((sessionData.totalDuration || 0) / 60)} min, Calories: ${sessionData.totalCalories || 0}
Warm-up completed: ${sessionData.warmUpCompleted ? 'yes' : 'no'}
Exercises: ${exerciseLines}
Write a short, personal coaching summary for this session.`;

  try {
    const text = await callClaude(system, content, 512);
    return text;
  } catch (err) {
    console.error('Workout summary API error:', err.message);
    return getLocalFallbackSummary({ profile, sessionData });
  }
}

export async function analyzeMovement({ exercise, poseData, sport }) {
  const sportContext = SPORT_CONTEXTS[sport] || '';
  const text = await callClaude(sportContext,
    `Analyze movement during: ${exercise}
Pose data: ${JSON.stringify(poseData)}
Return ONLY valid JSON:
{"correct":true,"feedback":"Hebrew feedback","encouragement":"Hebrew motivation","corrections":["correction1"]}`, 1024);
  const parsed = extractJSON(text);
  if (parsed) return parsed;
  return { correct: true, feedback: text, encouragement: '', corrections: [] };
}

// === REAL-TIME AI COACHING ===

const AGE_STYLE_PROMPTS = {
  kids: 'Use a fun, playful, gamified tone. Words like "וואו!", "סבבה!", "אלוף!". Short sentences. Make it feel like a game. Celebrate every small win.',
  performance: 'Use an intense, aggressive coaching tone. Direct commands: "תדחוף חזק!", "אל תוותר!", "עוד אחד!". Bio-mechanical precision feedback. Challenge the athlete.',
  longevity: 'Use a warm, gentle, safety-first tone. Encourage: "לאט ובטוח", "מצוין, ככה", "יפה מאוד". Focus on joint health, breathing reminders, and controlled movement. Never rush.',
};

function getAgeGroup(age) {
  const a = Number(age) || 25;
  if (a <= 12) return 'kids';
  if (a <= 50) return 'performance';
  return 'longevity';
}

export async function generateRealtimeFeedback(data) {
  const sportContext = SPORT_CONTEXTS[data.sport] || SPORT_CONTEXTS.football || '';
  const ageGroup = getAgeGroup(data.age);
  const ageStyle = AGE_STYLE_PROMPTS[ageGroup] || AGE_STYLE_PROMPTS.performance;

  const system = `${sportContext}

You are giving LIVE coaching feedback during a training exercise.

COACHING TONE:
${ageStyle}

RULES:
- Return ONE Hebrew sentence, maximum 15 words
- If form is good (goodFormPct > 70%) → encourage and push harder
- If form is bad (badFormPct > 40%) → correct the TOP issue specifically
- If athlete is struggling (low reps vs target) → motivate, don't criticize
- Use the athlete's name: ${data.playerName || 'אלוף'}
- Be specific to the exercise: ${data.exercise}
${data.disability && data.disability !== 'none' ? `- Athlete has disability: ${data.disability}. Be sensitive and adaptive.` : ''}

Return ONLY valid JSON: {"feedback":"Hebrew sentence here","isUrgent":false}
isUrgent=true only for safety/critical form issues.`;

  const content = `Exercise: ${data.exercise}
Duration: ${data.duration}s
Reps: ${data.reps}/${data.targetReps} (set ${data.sets}/${data.targetSets})
Good form: ${data.goodFormPct}%, Bad form: ${data.badFormPct}%
Top issues: ${(data.topIssues || []).join(', ') || 'none'}
Skill level: ${data.skillLevel || 'intermediate'}`;

  try {
    const text = await callClaude(system, content, 150, 0); // 0 retries for speed
    const parsed = extractJSON(text);
    if (parsed?.feedback) return parsed;
    // If not JSON, use raw text as feedback
    if (text && text.length < 100) return { feedback: text.trim(), isUrgent: false };
    return { feedback: '', isUrgent: false };
  } catch (err) {
    console.error('generateRealtimeFeedback error:', err.message);
    return { feedback: '', isUrgent: false };
  }
}

// === DYNAMIC WORKOUT ADAPTATION ===

export async function adaptWorkout({ profile, completedExercises, performance, remainingPlan, environmentContext }) {
  const sportContext = SPORT_CONTEXTS[profile.sport] || SPORT_CONTEXTS.football || '';

  const performanceSummary = (completedExercises || []).map(ex =>
    `${ex.name}: ${ex.repsActual || 0}/${ex.repsTarget || 0} reps, quality: ${ex.quality || 'unknown'}`
  ).join('\n');

  const envInfo = environmentContext?.equipment?.length > 0
    ? `Available equipment: ${environmentContext.equipment.map(e => e.object || e.label).join(', ')}`
    : 'No special equipment detected';

  const system = `${sportContext}

You are adapting a workout MID-SESSION based on athlete performance.

Athlete: ${profile.name || 'Athlete'}, age ${profile.age || 25}, ${profile.disability || 'no disability'}
Skill level: ${profile.skillLevel || 'intermediate'}
${envInfo}

RULES:
1. If performance is consistently poor → SIMPLIFY remaining exercises (fewer reps, more rest, easier variations)
2. If performance is perfect → INTENSIFY (add reps, reduce rest, harder variations)
3. Keep SAME number of remaining exercises (substitute, don't add/remove)
4. Respect disability limitations strictly
5. Progressive overload: challenge athletes who are crushing it
6. All exercise names MUST be in Hebrew
7. Each exercise must have: name, description (max 15 words Hebrew), sets, reps, restSeconds, tips

Return ONLY valid JSON:
{"adapted":true,"plan":[{"name":"שם","description":"תיאור","sets":3,"reps":"12","restSeconds":60,"tips":"טיפ"}],"reasoning":"Short Hebrew explanation"}
If no changes needed: {"adapted":false,"reasoning":"הכל בסדר"}`;

  const content = `Completed exercises:
${performanceSummary || 'None yet'}

Remaining plan:
${(remainingPlan || []).map(e => `${e.name} (${e.sets}x${e.reps}, rest ${e.restSeconds}s)`).join('\n')}

Should we adapt the remaining workout?`;

  try {
    const text = await callClaude(system, content, 1500, 1);
    const parsed = extractJSON(text);
    if (parsed?.adapted !== undefined) return parsed;
    return { adapted: false, plan: remainingPlan, reasoning: 'Could not parse response' };
  } catch (err) {
    console.error('adaptWorkout error:', err.message);
    return { adapted: false, plan: remainingPlan, reasoning: 'API error' };
  }
}

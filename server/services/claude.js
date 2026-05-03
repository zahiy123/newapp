import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Sanitize user input to prevent prompt injection
function sanitizeInput(value, maxLength = 50) {
  if (typeof value !== 'string') return String(value || '');
  // Strip control characters, pipe delimiters, and prompt-like patterns
  return value
    .replace(/[\x00-\x1f]/g, '')           // control chars
    .replace(/[|]/g, '')                     // pipe (our delimiter)
    .replace(/ignore.*instruction/gi, '')    // common injection patterns
    .replace(/system.*prompt/gi, '')
    .replace(/\n/g, ' ')                     // newlines
    .trim()
    .slice(0, maxLength);
}

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

const HAIKU_VISION_MODEL = 'claude-haiku-4-5-20251001';

async function callClaudeHaiku(system, content, maxTokens = 2048, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const message = await client.messages.create({
        model: HAIKU_VISION_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content }]
      });
      return message.content[0].text;
    } catch (err) {
      if (err.status === 429 && attempt < retries) {
        const wait = (attempt + 1) * 15000;
        console.log(`Haiku rate limited. Waiting ${wait / 1000}s before retry...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

// === BIOMECHANICAL KNOWLEDGE LIBRARY ===
// Exercise-specific checklists injected into vision analysis for surgical precision
const BIOMECHANICS_DB = {
  // Fitness exercises
  'squat': 'CHECKPOINTS: knees track over toes (no valgus), heels planted, spine neutral, depth below parallel, weight mid-foot, core braced',
  'push-up': 'CHECKPOINTS: elbows 45° from body, chest touches floor, full lockout, core tight (no hip sag), head neutral',
  'pushup': 'CHECKPOINTS: elbows 45° from body, chest touches floor, full lockout, core tight (no hip sag), head neutral',
  'burpee': 'CHECKPOINTS: soft landing on balls of feet, chest to floor in push-up, explosive hip extension on jump, arms overhead at peak',
  'plank': 'CHECKPOINTS: straight line head-to-heels, no hip sag or pike, shoulders over wrists, core engaged, glutes active',
  'lunge': 'CHECKPOINTS: front knee over ankle (not past toes), back knee toward floor, torso upright, hip flexor stretch at bottom',
  'dips': 'CHECKPOINTS: shoulders stay above elbows, elbows 90° at bottom, no shoulder shrug, controlled descent, full lockout',
  'bridge': 'CHECKPOINTS: feet hip-width, drive through heels, squeeze glutes at top, neutral spine, no rib flare',
  'crunch': 'CHECKPOINTS: lower back stays on floor, curl shoulders toward hips, exhale on contraction, no neck pulling',
  'mountain climber': 'CHECKPOINTS: hands under shoulders, hips level (no bouncing), drive knees to chest, maintain plank spine',
  'wall sit': 'CHECKPOINTS: back flat on wall, thighs parallel to floor, knees 90°, weight in heels, core braced',
  'shoulder press': 'CHECKPOINTS: elbows under wrists, press straight up (not forward), full lockout overhead, core tight, no back arch',
  'row': 'CHECKPOINTS: pull elbows back (not up), squeeze shoulder blades together, neutral spine, controlled eccentric',
  'bicep curl': 'CHECKPOINTS: elbows pinned at sides, full range of motion, no swinging/momentum, controlled descent',
  'lateral raise': 'CHECKPOINTS: slight elbow bend, raise to shoulder height (not above), thumbs slightly up, no shrugging',
  // Football (soccer)
  'kick': 'CHECKPOINTS: plant foot 15cm beside ball, ankle locked rigid, hip rotation drives power, follow-through high and across body, eyes on ball at contact',
  'dribble': 'CHECKPOINTS: ball within 1m of feet, use inside/outside/sole, low center of gravity, head up scanning, soft touches',
  'pass': 'CHECKPOINTS: plant foot points to target, inside-foot contact at ball center, follow-through toward target, body over ball for ground pass',
  'shoot': 'CHECKPOINTS: approach at 30-45° angle, plant foot beside ball, strike with laces (instep), lean over ball, follow-through toward target',
  'first touch': 'CHECKPOINTS: cushion ball (withdraw foot on contact), body behind ball line, open body to field, soft surface contact',
  'juggle': 'CHECKPOINTS: locked ankle, contact on laces/top of foot, slight backspin, consistent height, alternating feet',
  // Basketball
  'basketball shoot': 'CHECKPOINTS (BEEF): Balance feet shoulder-width, Eyes on back of rim, Elbow under ball at 90° (not flared), Follow-through gooseneck and hold',
  'free throw': 'CHECKPOINTS: feet shoulder-width behind line, ball in shooting pocket, elbow 90°, one-motion release, follow-through hold 2s',
  'layup': 'CHECKPOINTS: two-step gather, opposite knee drives up, extend arm fully, soft touch off backboard high, protect ball with off-hand',
  'crossover': 'CHECKPOINTS: low dribble below knee, pound ball hard into floor, push off opposite foot, sell with head/shoulder fake, eyes up',
  'defensive slide': 'CHECKPOINTS: low stance, wide base, slide feet (no crossing), hands active, hips square to offensive player',
  // Amputee football (crutch-based)
  'crutch-kick': 'CHECKPOINTS: crutches at shoulder-width+ base, shoulders aligned over crutches, weight shifted fully to crutches before kick, core braced, single-leg hip rotation, balanced follow-through',
  'crutch-sprint': 'CHECKPOINTS: crutch plant ahead of body, swing-through gait rhythm, core engaged, shoulders not hunched, firm grip (not white-knuckle)',
  'crutch-balance': 'CHECKPOINTS: triangular base (2 crutch tips + standing foot), weight centered over triangle, shoulders relaxed, micro-adjustments via wrists',
  'crutch-pivot': 'CHECKPOINTS: plant crutches firmly, rotate on standing foot, maintain triangular base throughout turn, core stabilizes rotation',
  'crutch-pass': 'CHECKPOINTS: stable crutch base, body weight on crutches, passing foot swings through ball, follow-through to target while maintaining balance',
  // Tennis
  'forehand': 'CHECKPOINTS: early unit turn, racket back with non-dominant hand, contact point in front of body, full follow-through over shoulder, weight transfer forward',
  'backhand': 'CHECKPOINTS: early shoulder turn, firm two-hand grip, contact in front of body, follow-through across body, balanced wide stance',
  'serve': 'CHECKPOINTS: ball toss at 1 o\'clock position, trophy pose (racket behind head), full extension at contact, pronation on follow-through, land on front foot',
  'volley': 'CHECKPOINTS: split step before contact, short backswing, firm wrist, punch through ball, recover to ready position',
  // Wheelchair Basketball
  'wheelchair shooting': 'CHECKPOINTS: torso upright and braced against backrest, elbow 90° under ball, shooting hand behind ball center, follow-through gooseneck, non-shooting hand stabilizes, chair locked/braced before release',
  'wheelchair dribble': 'CHECKPOINTS: ball below shoulder height, push-push-dribble rhythm (2 pushes max), fingertip control, eyes up, trunk stable, chair momentum maintained',
  'wheelchair pass': 'CHECKPOINTS: chest pass from sternum, elbows drive outward, wrists snap on release, torso leans into pass for power, chair angled toward target, follow-through arms extended',
  // Wheelchair Tennis
  'wheelchair stroke': 'CHECKPOINTS: early trunk rotation (not just arm), racket back with shoulder turn, contact point in front of wheel axle, trunk lean into shot, push-hit timing (push chair then swing), follow-through across body',
  'wheelchair serve': 'CHECKPOINTS: ball toss at 1 o\'clock, trophy pose with trunk lean forward, full arm extension at contact, pronation on snap, chair positioned sideways to baseline, balance maintained post-serve',
  // Warm-up / Dynamic exercises
  'arm circles': 'CHECKPOINTS: arms fully extended, smooth circular motion, shoulders relaxed (no shrugging), consistent tempo, both directions equal time',
  'high knees': 'CHECKPOINTS: knee drives above hip line, land on balls of feet, arms pump opposite to legs, torso upright, quick ground contact',
  'side steps': 'CHECKPOINTS: low athletic stance, feet never cross, hips stay low, arms ready, quick lateral push-off, weight on balls of feet',
  'balance hops': 'CHECKPOINTS: soft landing on ball of foot, knee slightly bent on landing, core engaged, minimal upper body sway, controlled rhythm',
  'forward kicks': 'CHECKPOINTS: standing leg slightly bent, kick leg swings from hip, controlled arc (not flinging), core braced, arms counterbalance',
  'single leg high knee': 'CHECKPOINTS: standing leg stable, driving knee reaches hip height, core engaged, hands on crutches for balance if needed, controlled tempo',
  'arm punches': 'CHECKPOINTS: full extension on punch, retract to guard position, core rotates with punch, shoulders stay down, alternate arms evenly',
  'core twists': 'CHECKPOINTS: hips face forward (rotate only torso), arms move with shoulders, controlled tempo, full range of rotation, core engaged throughout',
  // Fitness — remaining
  'pull-up': 'CHECKPOINTS: dead hang start, chin clears bar, elbows full extension at bottom, no kipping, controlled descent, shoulder blades retract at top',
  'pullup': 'CHECKPOINTS: dead hang start, chin clears bar, elbows full extension at bottom, no kipping, controlled descent, shoulder blades retract at top',
  'tricep extension': 'CHECKPOINTS: elbows pinned by ears, full extension at top, controlled descent behind head, no elbow flare, core braced',
  'side plank': 'CHECKPOINTS: straight line head-to-feet, bottom shoulder stacked over elbow/wrist, hips off ground and not sagging, top arm extended or on hip, core and glutes engaged',
  'band pull apart': 'CHECKPOINTS: arms extended at shoulder height, squeeze shoulder blades together, controlled return, chest open, no shoulder shrugging',
  'goblet squat': 'CHECKPOINTS: weight held at chest, elbows inside knees at bottom, heels planted, depth below parallel, torso upright, core braced',
  'jumping jack': 'CHECKPOINTS: soft landing on balls of feet, full arm extension overhead, legs wider than shoulders at top, arms touch at top, rhythmic tempo',
  'running form': 'CHECKPOINTS: midfoot/forefoot strike, slight forward lean 5-10°, arms at 90° pumping forward (not across), cadence 170-180 spm, relaxed shoulders',
  'glute bridge': 'CHECKPOINTS: feet hip-width, drive through heels, squeeze glutes at top, neutral spine, no rib flare',
  // === NEW FITNESS — Standing Strength ===
  'calf raise': 'CHECKPOINTS: full ankle plantarflexion at top, controlled descent (no bouncing), weight on balls of feet, knees straight not locked, pause at top',
  'sumo squat': 'CHECKPOINTS: wide stance toes out 45°, knees track over toes, depth below parallel, torso upright, weight in heels, squeeze adductors',
  'reverse lunge': 'CHECKPOINTS: step back controlled, front knee over ankle, back knee toward floor, torso upright, push off front heel to return',
  'bulgarian split squat': 'CHECKPOINTS: rear foot elevated, front knee over ankle, depth until rear knee near floor, torso upright, front heel drives up',
  'single leg deadlift': 'CHECKPOINTS: flat back throughout, hip hinge not squat, rear leg extends straight behind, standing knee slight bend, arms hang vertically',
  'step up': 'CHECKPOINTS: full foot on platform, drive through heel, stand tall at top, controlled descent, no push-off from ground foot',
  'front raise': 'CHECKPOINTS: arms raise to shoulder height (not above), slight elbow bend, controlled descent, no momentum/swinging, core braced',
  'upright row': 'CHECKPOINTS: hands close grip, pull elbows up and out, bar/weights close to body, stop at chin height, controlled descent',
  'shrug': 'CHECKPOINTS: elevate shoulders to ears, squeeze traps at top 1-2s, controlled descent, no head forward movement, arms straight',
  'arnold press': 'CHECKPOINTS: start palms facing you at chin, rotate palms outward while pressing, full lockout overhead, reverse on descent, core tight',
  'hammer curl': 'CHECKPOINTS: neutral grip (palms facing each other), elbows pinned at sides, full range of motion, no swinging, controlled negative',
  'overhead tricep extension': 'CHECKPOINTS: elbows by ears pointing up, lower weight behind head, full extension at top, no elbow flare, core braced',
  // === NEW FITNESS — Floor/Lying ===
  'superman': 'CHECKPOINTS: simultaneous arm and leg lift, arms straight overhead, legs straight behind, hold 2-3s at top, neck neutral',
  'dead bug': 'CHECKPOINTS: lower back pressed into floor, extend opposite arm and leg, controlled movement, exhale on extension, return to start before switching',
  'bird dog': 'CHECKPOINTS: hands under shoulders knees under hips, extend opposite arm and leg straight, hold 1-2s, core braced no rotation, return controlled',
  'russian twist': 'CHECKPOINTS: lean back 45° from floor, feet elevated or planted, rotate from thoracic spine, arms extended or holding weight, control both directions',
  'leg raise': 'CHECKPOINTS: lower back pressed into floor, legs straight, raise to 90°, controlled descent (don\'t drop), no arch in lower back',
  'flutter kicks': 'CHECKPOINTS: lower back pressed into floor, legs straight 6 inches off ground, small rapid kicks, hands under glutes for support, continuous movement',
  'bicycle crunch': 'CHECKPOINTS: opposite elbow to knee, full twist from thoracic, extend opposite leg, controlled pace, don\'t pull neck',
  'reverse crunch': 'CHECKPOINTS: curl hips off floor toward chest, lower back lifts, controlled descent, don\'t use momentum, exhale on curl',
  'hip thrust': 'CHECKPOINTS: upper back on bench/elevated surface, feet hip-width flat, drive through heels, full hip extension at top, squeeze glutes',
  'v-ups': 'CHECKPOINTS: start fully extended on floor, simultaneously lift legs and torso, reach hands to toes, controlled descent back to flat, core engaged throughout',
  'donkey kicks': 'CHECKPOINTS: hands and knees position, kick one leg up and back, squeeze glute at top, knee bent 90°, no lower back arch, alternate legs',
  // === NEW FITNESS — Cardio/Dynamic ===
  'high knees main': 'CHECKPOINTS: knee drives above hip line, land on balls of feet, arms pump opposite to legs, torso upright, quick ground contact, maintain rhythm',
  'butt kicks': 'CHECKPOINTS: heel kicks toward glutes, land on balls of feet, upright torso, arms pump naturally, quick cadence, knees point down',
  'skater jumps': 'CHECKPOINTS: lateral bound on single leg, soft landing with knee bend, opposite leg sweeps behind, arm drives across body, controlled deceleration',
  'tuck jumps': 'CHECKPOINTS: explosive vertical jump, tuck knees to chest at peak, soft landing on balls of feet, immediate reset, arms drive up',
  'bear crawl': 'CHECKPOINTS: hands under shoulders knees under hips, knees hover 1 inch off ground, opposite hand and foot move together, back flat, controlled pace',
  'inch worm': 'CHECKPOINTS: walk hands out to plank, maintain straight legs during walk-out, plank position briefly, walk hands back to feet, slow controlled movement',
  // === NEW FITNESS — Additional ===
  'good morning': 'CHECKPOINTS: barbell or hands behind head, hip hinge with flat back, slight knee bend, hamstring stretch at bottom, drive hips forward to stand',
  'hollow body hold': 'CHECKPOINTS: lower back pressed into floor, shoulders and feet 6 inches off ground, arms overhead, core maximally engaged, hold steady',
  'plank to push-up': 'CHECKPOINTS: start in forearm plank, place one hand then other to push-up, lower one elbow then other back to plank, alternate leading arm, no hip rotation',
  'star jumps': 'CHECKPOINTS: explosive jump, spread arms and legs wide in air (star shape), soft landing together, immediate reset, arms and legs symmetrical',
  'plank shoulder tap': 'CHECKPOINTS: maintain plank position, lift one hand to tap opposite shoulder, minimize hip rotation, alternate hands, core braced throughout',
  'superman banana': 'CHECKPOINTS: alternate between superman (face down, limbs up) and hollow body (face up, limbs up), controlled roll, no momentum, core engaged both positions',
  // === NEW BASKETBALL ===
  'bounce pass': 'CHECKPOINTS: step toward target, push ball down at 2/3 distance, aim for partner waist height, follow-through fingers point down, backspin on ball',
  'chest pass': 'CHECKPOINTS: ball at chest, step forward, extend both arms fully, snap wrists on release, follow-through with palms out, aim partner chest height',
  'overhead pass': 'CHECKPOINTS: ball above and behind head, step forward, snap pass over head, follow-through arms extended, use for long distance or over defenders',
  'behind-back dribble': 'CHECKPOINTS: low stance, push ball behind back with wrist, receive with opposite hand, keep ball low, head up, maintain speed',
  'spin move': 'CHECKPOINTS: plant pivot foot, reverse spin 180°, protect ball during rotation, accelerate out of spin, maintain low center of gravity',
  'jump shot': 'CHECKPOINTS: squared to basket, jump straight up, release at peak of jump, elbow under ball 90°, follow-through gooseneck, consistent arc',
  'hook shot': 'CHECKPOINTS: shoulder toward defender, single arm arc motion, release at highest point, follow-through over head, soft touch off backboard',
  'post moves': 'CHECKPOINTS: back to basket wide stance, feel defender with hip, drop step or face-up, protect ball high, power finish at rim',
  // === NEW TENNIS ===
  'overhead smash': 'CHECKPOINTS: position under ball, racket back and up early, full extension at contact, snap wrist down, follow-through across body, balanced landing',
  'split step': 'CHECKPOINTS: time jump as opponent contacts ball, land on balls of both feet, wide base, knees bent ready, immediate push-off in correct direction',
  'drop shot': 'CHECKPOINTS: disguise with full stroke prep, open racket face, slice under ball, soft hands absorb impact, short follow-through, use against deep opponents',
  'slice': 'CHECKPOINTS: continental grip, high-to-low racket path, open face cuts under ball, firm wrist, follow-through forward and down, backspin',
  'approach shot': 'CHECKPOINTS: move forward through the shot, contact in front, deep placement, split step after hit, close to net ready for volley',
  'return stance': 'CHECKPOINTS: wide base, weight on balls of feet, racket in front ready, split step as server tosses, explosive first step to ball',
  // === NEW FOOTBALL ===
  'headers': 'CHECKPOINTS: eyes on ball, meet ball with forehead (not top of head), neck muscles braced, attack the ball (don\'t let it hit you), jump timing, arms for balance',
  'instep shot': 'CHECKPOINTS: approach 30-45° angle, plant foot beside ball pointing target, strike with laces top of foot, ankle locked, lean over ball, follow-through high',
  'outside foot pass': 'CHECKPOINTS: contact with outside of foot, plant foot beside ball, short backswing, aim across body, disguise direction, follow-through toward target',
  'chest control': 'CHECKPOINTS: chest out to meet ball, withdraw chest on contact (cushion), arms wide for balance, knees slightly bent, ball drops to feet',
  'cone drill': 'CHECKPOINTS: low center of gravity, quick direction changes, push off outside foot, maintain balance, eyes up, decelerate before turn',
  'quick turns': 'CHECKPOINTS: decelerate with short steps, low center of gravity, pivot on ball of foot, accelerate immediately after turn, body rotation leads',
  'sprint recovery': 'CHECKPOINTS: decelerate gradually, lower center of gravity, shorten stride, transition to defensive stance, ready for next action',
  'shield ball': 'CHECKPOINTS: body between opponent and ball, wide stable stance, arm creates space legally, ball on far foot, low center of gravity, back to pressure',
  // === NEW AMPUTEE FOOTBALL ===
  'crutch dribbling': 'CHECKPOINTS: ball within crutch reach, use sole of foot for control, crutches planted for stability, small touches, head up scanning, maintain triangular base',
  'crutch shot': 'CHECKPOINTS: crutch base planted wide, weight shifts to crutches, kicking leg swings fully, hip rotation drives power, follow-through balanced, core braced',
  'crutch agility': 'CHECKPOINTS: quick lateral crutch repositioning, maintain base throughout, short explosive movements, core stabilizes, weight shifts smoothly between crutches',
  'crutch quick turn': 'CHECKPOINTS: plant crutches firmly, rotate trunk on standing foot, maintain balance through turn, re-establish base immediately, quick acceleration out',
  'crutch shield': 'CHECKPOINTS: wide crutch base, body between opponent and ball, ball on standing-leg side, crutches create barrier, low center of gravity, core engaged',
  'crutch header': 'CHECKPOINTS: stable crutch base before jump, explosive push through standing leg, meet ball with forehead, brace neck, land with crutch support, absorb impact',
  'crutch chest control': 'CHECKPOINTS: crutches planted firmly, chest meets ball, withdraw chest on impact (cushion), maintain crutch stability throughout, ball drops to standing foot',
  // === NEW AMPUTEE FOOTBALL GK ===
  'gk dive save': 'CHECKPOINTS: explosive lateral push, lead with hands, body follows hands, land on side (not stomach), extend fully, quick recovery to feet',
  'gk distribution': 'CHECKPOINTS: overhand throw or punt kick, step toward target, follow-through, accuracy over power, quick release, scan field before distributing',
  'gk positioning': 'CHECKPOINTS: centered on goal line, knees slightly bent ready stance, weight on balls of feet, hands ready at waist, narrow angle for shooter',
  'gk one-hand save': 'CHECKPOINTS: lead with dominant hand, full arm extension, fingertip save if needed, push ball away from goal, wrist firm, maintain body behind ball',
  'gk crutch block': 'CHECKPOINTS: crutch base wide, lower body behind ball, use body as barrier, arms protect upper area, anticipate shot direction, quick repositioning',
  'gk high catch': 'CHECKPOINTS: jump timing crucial, catch at highest point, two hands secure ball, bring ball to chest on landing, land balanced, elbows in',
  'gk low save': 'CHECKPOINTS: get body behind ball, lower to ground quickly, scoop ball with both hands, bring to chest, protect with body, quick recovery',
  'gk quick release': 'CHECKPOINTS: scan field immediately after save, choose target quickly, overhand throw for accuracy, roll for close player, get ball out fast',
  'gk footwork': 'CHECKPOINTS: shuffle across goal, stay on balls of feet, don\'t cross feet, face the ball always, quick side steps, set before shot',
  'gk reaction': 'CHECKPOINTS: explosive first step, read shooter body language, stay big as long as possible, commit at last moment, spring from ready position',
  // === NEW WHEELCHAIR BASKETBALL ===
  'wc bounce pass': 'CHECKPOINTS: push ball downward from chest, aim at 2/3 distance to partner, follow-through fingers down, trunk leans into pass, chair angled toward target',
  'wc hook shot': 'CHECKPOINTS: single arm arc from shoulder, release at highest point, trunk lean for power, non-shooting hand stabilizes, follow-through over head',
  'wc layup': 'CHECKPOINTS: push chair to basket, ball protected on approach, extend arm fully at basket, soft touch off glass, maintain chair speed throughout',
  'wc push sprint': 'CHECKPOINTS: lean forward in chair, powerful push-recovery rhythm, hands hit push rims at 12 o\'clock, full push through to 6 o\'clock, recover hands quickly',
  'wc defense': 'CHECKPOINTS: chair angled 45° to offensive player, hands active and up, maintain distance, quick lateral pushes, anticipate offensive moves, block passing lanes',
  'wc pick and roll': 'CHECKPOINTS: set solid screen (chair stopped), roll after contact, open to ball, receive pass in motion, finish at basket, communication essential',
  'wc block out': 'CHECKPOINTS: chair positioned between opponent and basket, widen chair stance, hold position, reach up for rebound, secure ball to chest',
  'wc fast break': 'CHECKPOINTS: explosive first push, maintain top speed, ball control while pushing (dribble rules), look up for outlet, finish at basket under control',
  // === NEW WHEELCHAIR TENNIS ===
  'wc smash': 'CHECKPOINTS: position chair under ball, racket back and up, full arm extension overhead at contact, snap wrist down, trunk lean into shot, recover chair position',
  'wc volley': 'CHECKPOINTS: short compact backswing, firm wrist, punch through ball, recover to ready position, chair positioned near net, split step timing with push',
  'wc return': 'CHECKPOINTS: ready position in chair, anticipate serve direction, quick chair push toward ball, early racket preparation, contact in front, depth on return',
  'wc split step': 'CHECKPOINTS: quick forward-back chair push (simulating split step), time with opponent contact, immediate directional push, anticipate ball placement',
  'wc drop shot': 'CHECKPOINTS: disguise with full prep, open racket face, soft hands, short follow-through, place near net, use when opponent deep on court',
  'wc push recovery': 'CHECKPOINTS: immediate chair push after shot, return to center court, push-coast-push rhythm, maintain ready position, anticipate next shot location',
};

// Fuzzy match: find best biomechanics checklist for an exercise name (Hebrew or English)
function getBiomechanicsChecklist(exercise, sport) {
  if (!exercise) return '';
  const name = exercise.toLowerCase().replace(/[^\w\s\u0590-\u05FF]/g, '');
  // Direct key match
  if (BIOMECHANICS_DB[name]) return BIOMECHANICS_DB[name];
  // Partial match: check if any key is contained in the exercise name
  for (const [key, val] of Object.entries(BIOMECHANICS_DB)) {
    if (name.includes(key) || key.includes(name)) return val;
  }
  // Hebrew exercise name mapping
  const hebrewMap = {
    'סקוואט': 'squat', 'שכיבות סמיכה': 'push-up', 'פלאנק': 'plank',
    'לאנג': 'lunge', 'דיפס': 'dips', 'בורפי': 'burpee', 'גשר': 'bridge',
    'כפיפות בטן': 'crunch', 'מטפס הרים': 'mountain climber', 'ישיבה על הקיר': 'wall sit',
    'כתפיים': 'shoulder press', 'משיכת משקולת': 'row', 'כפיפות מרפק': 'bicep curl',
    'הרמה צידית': 'lateral raise', 'בעיטה': 'kick', 'כדרור': 'dribble', 'מסירה': 'pass',
    'שליטה ראשונית': 'first touch', 'ג\'אגלינג': 'juggle', 'בעיטת שוט': 'shoot',
    'זריקה': 'basketball shoot', 'עליה לסל': 'layup', 'הגנה': 'defensive slide', 'קרוסאובר': 'crossover',
    'פורהנד': 'forehand', 'בקהנד': 'backhand', 'הגשה': 'serve', 'ווליי': 'volley',
    'זריקה כיסא': 'wheelchair shooting', 'כדרור כיסא': 'wheelchair dribble', 'מסירה כיסא': 'wheelchair pass',
    'מכות כיסא': 'wheelchair stroke', 'הגשה כיסא': 'wheelchair serve',
    'מסירה בקביים': 'crutch-pass', 'ציר קביים': 'crutch-pivot', 'איזון קביים': 'crutch-balance',
    'עיגולי ידיים': 'arm circles', 'הרמת ברך': 'high knees', 'צעדים צידיים': 'side steps',
    'קפיצות איזון': 'balance hops', 'בעיטות קדימה': 'forward kicks', 'אגרופים': 'arm punches',
    'סיבובי גוף': 'core twists', 'טריצפס': 'tricep extension', 'מתח': 'pull-up',
    'פלאנק צידי': 'side plank', 'גומייה': 'band pull apart', 'גובלט': 'goblet squat',
    // === NEW FITNESS — Standing ===
    'הרמות עקב': 'calf raise', 'סקוואט סומו': 'sumo squat', "לאנג' הפוך": 'reverse lunge',
    'ספליט סקוואט בולגרי': 'bulgarian split squat', 'דדליפט חד-רגלי': 'single leg deadlift',
    'סטפ-אפ': 'step up', 'הרמה קדמית': 'front raise', 'משיכה זקופה': 'upright row',
    'כיווץ כתפיים': 'shrug', 'לחיצת ארנולד': 'arnold press', 'כפיפות פטיש': 'hammer curl',
    'הרחבת טריצפס מעל הראש': 'overhead tricep extension',
    // === NEW FITNESS — Floor/Lying ===
    'סופרמן': 'superman', 'דד באג': 'dead bug', 'ציפור-כלב': 'bird dog', 'ציפור כלב': 'bird dog',
    'סיבוב רוסי': 'russian twist', 'הרמות רגליים': 'leg raise', 'בעיטות פרפר': 'flutter kicks',
    'כפיפות אופניים': 'bicycle crunch', 'כפיפות בטן הפוכות': 'reverse crunch',
    'הרמת ירכיים': 'hip thrust', 'כפיפות V': 'v-ups', 'בעיטות חמור': 'donkey kicks',
    // === NEW FITNESS — Cardio/Dynamic ===
    'ברכיים גבוהות': 'high knees main', 'בעיטות ישבן': 'butt kicks',
    'קפיצות מחליק': 'skater jumps', 'קפיצות טאק': 'tuck jumps',
    'זחילת דוב': 'bear crawl', 'תולעת': 'inch worm',
    // === NEW FITNESS — Additional ===
    'גוד מורנינג': 'good morning', 'החזקת גוף חלול': 'hollow body hold',
    'פלאנק לשכיבות סמיכה': 'plank to push-up', 'קפיצות כוכב': 'star jumps',
    'פלאנק עם נגיעת כתף': 'plank shoulder tap', 'סופרמן-בננה': 'superman banana',
    // === NEW BASKETBALL ===
    'מסירת הקפצה': 'bounce pass', 'מסירת חזה': 'chest pass', 'מסירה מעל הראש': 'overhead pass',
    'דריבל מאחורי הגב': 'behind-back dribble', 'ספין מוב': 'spin move',
    'זריקת קפיצה': 'jump shot', 'הוק שוט': 'hook shot', 'תנועות פוסט': 'post moves',
    // === NEW TENNIS ===
    'סמאש': 'overhead smash', 'דרופ שוט': 'drop shot', 'ספליט סטפ': 'split step',
    'עמדת קבלה': 'return stance', 'סלייס': 'slice', 'גישה לרשת': 'approach shot',
    // === NEW FOOTBALL ===
    'נגיחות ראש': 'headers', 'בעיטת גב כף רגל': 'instep shot',
    'מסירה חיצונית': 'outside foot pass', 'שליטה בחזה': 'chest control',
    'תרגיל זריזות קונוסים': 'cone drill', 'פניות מהירות': 'quick turns',
    'חזרה מספרינט': 'sprint recovery', 'הגנה על הכדור': 'shield ball',
    // === NEW AMPUTEE FOOTBALL ===
    'דריבלינג בקביים': 'crutch dribbling', 'בעיטת דריבל בקביים': 'crutch shot',
    'זריזות בקביים': 'crutch agility', 'פנייה מהירה בקביים': 'crutch quick turn',
    'הגנה על כדור בקביים': 'crutch shield', 'נגיחה בקביים': 'crutch header',
    'שליטה בחזה בקביים': 'crutch chest control',
    // === NEW AMPUTEE GK ===
    'צלילה לשער': 'gk dive save', 'הפצה מהשער': 'gk distribution',
    'מיקום שוער': 'gk positioning', 'עצירה ביד אחת': 'gk one-hand save',
    'חסימה בקביים': 'gk crutch block', 'תפיסה גבוהה': 'gk high catch',
    'עצירה נמוכה': 'gk low save', 'שחרור מהיר': 'gk quick release',
    'עבודת רגליים שוער': 'gk footwork', 'תגובה מהירה': 'gk reaction',
    // === NEW WHEELCHAIR BASKETBALL ===
    'מסירת הקפצה כיסא': 'wc bounce pass', 'הוק שוט כיסא': 'wc hook shot',
    'לייאפ כיסא': 'wc layup', 'ספרינט כיסא': 'wc push sprint',
    'הגנה כיסא': 'wc defense', 'פיק אנד רול כיסא': 'wc pick and roll',
    'חסימת ריבאונד כיסא': 'wc block out', 'מהיר כיסא': 'wc fast break',
    // === NEW WHEELCHAIR TENNIS ===
    'סמאש כיסא': 'wc smash', 'ווליי כיסא': 'wc volley', 'קבלה כיסא': 'wc return',
    'ספליט סטפ כיסא': 'wc split step', 'דרופ שוט כיסא': 'wc drop shot',
    'התאוששות דחיפה כיסא': 'wc push recovery',
  };
  for (const [heb, eng] of Object.entries(hebrewMap)) {
    if (name.includes(heb) && BIOMECHANICS_DB[eng]) return BIOMECHANICS_DB[eng];
  }
  // Sport-based fallback for crutch exercises
  if (sport === 'footballAmputee' && (name.includes('קביים') || name.includes('crutch'))) {
    return BIOMECHANICS_DB['crutch-balance'];
  }
  return '';
}

// Format joint angles object into readable string for AI prompts
function formatAngles(a) {
  if (!a || typeof a !== 'object') return 'N/A';
  const entries = Object.entries(a).filter(([, v]) => typeof v === 'number');
  if (entries.length === 0) return 'N/A';
  return entries.map(([k, v]) => `${k}: ${Math.round(v)}°`).join(', ');
}

// Server-side scoring: compute score from joint angles deterministically
// Haiku provides Hebrew feedback (instruction + pro_tip) — score is computed here
const SCORING_RULES = [
  // === FITNESS: Standing ===
  // Squat: knee at peak (index 1) — lower = deeper = better
  { keywords: ['סקוואט', 'squat', 'גובלט', 'goblet'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [90, 120] },
  // Push-up: elbow at peak (bottom position)
  { keywords: ['פוש', 'push', 'שכיבות'], joint: 'elbow', phase: 1, dir: 'lower',
    thresholds: [90, 120] },
  // Pull-up: elbow at peak (top position)
  { keywords: ['מתח', 'pull up', 'pullup', 'chin', 'סנטר'], joint: 'elbow', phase: 1, dir: 'lower',
    thresholds: [90, 120] },
  // Dips: elbow at bottom
  { keywords: ['מקבילים', 'dip', 'שקיע'], joint: 'elbow', phase: 1, dir: 'lower',
    thresholds: [90, 120] },
  // Lunge: front knee at bottom — lower = deeper
  { keywords: ['לאנג', 'lunge', 'מכרע'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [90, 120] },
  // Shoulder press: elbow at top — higher = more extension = better
  { keywords: ['כתפיים', 'shoulder press', 'לחיצת כתפ'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [150, 170] },
  // Bicep curl: elbow at peak — lower = more curl = better
  { keywords: ['ביספ', 'bicep', 'כפיפות מרפק', 'כפיפות ידיים'], joint: 'elbow', phase: 1, dir: 'lower',
    thresholds: [40, 70] },
  // Tricep extension: elbow at top — higher = full extension = better
  { keywords: ['טריצפס', 'tricep', 'הרחבת מרפק'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [150, 170] },
  // Bent over row: elbow at pull — lower = deeper pull = better
  { keywords: ['משיכת משקולת', 'משיכה', 'row'], joint: 'elbow', phase: 1, dir: 'lower',
    thresholds: [80, 110] },
  // Lateral raise: shoulder at peak — higher = more raise = better
  { keywords: ['הרמה צידית', 'lateral raise'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [70, 90] },
  // Band pull apart: shoulder angle (arms back) — wider spread = better
  { keywords: ['גומייה', 'band pull', 'מתיחת גומייה'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [140, 170] },
  // === FITNESS: Lying / Hold ===
  // Plank: trunk alignment (shoulder-hip-ankle) — higher = straighter = better
  { keywords: ['פלאנק', 'plank'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [160, 175] },
  // Side plank: trunk alignment
  { keywords: ['פלאנק צידי', 'side plank'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [155, 170] },
  // Glute bridge: knee at peak — lower = more bend = better
  { keywords: ['גשר', 'bridge', 'glute'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [85, 110] },
  // Crunch: trunk at peak — lower = more curl = better
  { keywords: ['כפיפות בטן', 'crunch', 'בטן'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [120, 150] },
  // Mountain climbers: knee at peak — lower = more drive = better
  { keywords: ['מטפס הרים', 'mountain climber'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [60, 90] },
  // Wall sit: knee angle — closer to 90 = better (lower is better)
  { keywords: ['ישיבה על הקיר', 'wall sit', 'ישיבת קיר'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [90, 110] },
  // === FOOTBALL (soccer) ===
  // Kicks: knee at peak — lower = more backswing = better
  { keywords: ['בעיטה', 'kick'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [50, 90] },
  // Pass: knee at contact — controlled swing (moderate angle)
  { keywords: ['מסירה', 'pass'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [100, 140] },
  // Shoot: knee at backswing — lower = more power
  { keywords: ['שוט', 'shoot', 'בעיטת שוט'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [50, 90] },
  // Dribbling: knee flexion — lower center of gravity = better
  { keywords: ['כדרור', 'dribbl'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [130, 155] },
  // First touch: knee at cushion — slight flex = better
  { keywords: ['שליטה ראשונית', 'first touch'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [120, 150] },
  // Juggle: knee consistency — moderate flex
  { keywords: ['ג\'אגלינג', 'juggle', 'ליפטינג'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [100, 140] },
  // === BASKETBALL ===
  // Shooting: elbow at release — higher = more extension = better
  { keywords: ['זריקה', 'basketball shoot', 'free throw'], joint: 'elbow', phase: 2, dir: 'higher',
    thresholds: [120, 160] },
  // Layup: knee drive up — lower = more drive = better
  { keywords: ['עליה לסל', 'layup', 'עלייה לסל'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [60, 100] },
  // Crossover: knee flexion (low stance) — lower = better
  { keywords: ['קרוסאובר', 'crossover'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [110, 140] },
  // Defensive slide: knee flexion (low stance)
  { keywords: ['הגנה', 'defensive slide', 'החלקת הגנה'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [100, 130] },
  // Hand dribbling: knee flexion
  { keywords: ['כדרור ביד', 'hand dribbl', 'כדרור כדורסל'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [130, 155] },
  // === TENNIS ===
  // Forehand/backhand stroke: shoulder rotation at contact — higher = better
  { keywords: ['פורהנד', 'בקהנד', 'forehand', 'backhand', 'stroke'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [80, 120] },
  // Serve: elbow at release — higher = full extension = better
  { keywords: ['הגשה', 'serve', 'סרב'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 165] },
  // Volley: elbow at contact — firm compact angle, lower = better (tight punch)
  { keywords: ['ווליי', 'volley'], joint: 'elbow', phase: 1, dir: 'lower',
    thresholds: [80, 120] },
  // Footwork: knee flexion — athletic stance
  { keywords: ['עבודת רגליים', 'footwork', 'רגליים מהירות'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [120, 150] },
  // === AMPUTEE FOOTBALL ===
  // Crutch sprint: trunk lean — lower = more stable = better
  { keywords: ['ספרינט קביים', 'crutch sprint', 'ריצה בקביים'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [10, 25] },
  // Crutch kick: shoulder stability during kick — higher = more upright = better
  { keywords: ['בעיטה בקביים', 'בעיטת קביים', 'crutch kick', 'amputee kick'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [60, 90] },
  // Crutch pass: trunk stability — higher = more upright = better
  { keywords: ['מסירה בקביים', 'crutch pass', 'מסירת קביים'], joint: 'trunk', phase: 1, dir: 'higher',
    thresholds: [155, 170] },
  // Crutch pivot: trunk rotation
  { keywords: ['ציר קביים', 'crutch pivot', 'פיבוט קביים'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [15, 30] },
  // Crutch balance: trunk alignment — higher = straighter = better
  { keywords: ['איזון קביים', 'crutch balance'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [165, 175] },
  // === WHEELCHAIR BASKETBALL ===
  // Wheelchair shooting: elbow at release — higher = better
  { keywords: ['זריקה כיסא', 'wheelchair shoot'], joint: 'elbow', phase: 2, dir: 'higher',
    thresholds: [120, 160] },
  // Wheelchair dribbling: elbow flexion — controlled push
  { keywords: ['כדרור כיסא', 'wheelchair dribbl'], joint: 'elbow', phase: 1, dir: 'lower',
    thresholds: [80, 120] },
  // Wheelchair pass: elbow at release — higher = stronger pass
  { keywords: ['מסירה כיסא', 'wheelchair pass', 'מסירת חזה כיסא'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 165] },
  // === WHEELCHAIR TENNIS ===
  // Wheelchair stroke: shoulder rotation — higher = more rotation = better
  { keywords: ['מכות כיסא', 'wheelchair stroke', 'wheelchair forehand'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [70, 110] },
  // Wheelchair serve: elbow at contact — higher = full extension
  { keywords: ['הגשה כיסא', 'wheelchair serve'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 165] },
  // === WARM-UP / DYNAMIC ===
  // High knees: knee at peak — lower = higher drive = better
  { keywords: ['הרמת ברך', 'high knee'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [60, 90] },
  // Arm circles: shoulder range — higher = wider circle
  { keywords: ['עיגולי ידיים', 'arm circle'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [120, 160] },
  // Forward kicks: knee at peak — lower = higher kick
  { keywords: ['בעיטות קדימה', 'forward kick'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [80, 120] },
  // Jumping exercises (burpees, jumping jacks)
  { keywords: ["ג'אמפינג", 'jumping jack', 'בורפי', 'burpee', 'קפיצות'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [100, 140] },
  // Running form: trunk lean — small forward lean is ideal
  { keywords: ['ריצה', 'ספרינט', 'sprint', 'running'], joint: 'trunk', phase: 0, dir: 'lower',
    thresholds: [5, 15] },
  // === NEW FITNESS — Standing Strength ===
  // Calf raise: ankle plantarflexion — knee should stay straight (higher = better)
  { keywords: ['הרמות עקב', 'calf raise', 'עקבים'], joint: 'knee', phase: 0, dir: 'higher',
    thresholds: [160, 175] },
  // Sumo squat: wider stance, same knee tracking
  { keywords: ['סקוואט סומו', 'sumo squat', 'סומו'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [85, 115] },
  // Reverse lunge: front knee angle at bottom
  { keywords: ["לאנג' הפוך", 'reverse lunge', 'לאנג הפוך'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [90, 120] },
  // Bulgarian split squat: deep front knee bend
  { keywords: ['ספליט סקוואט בולגרי', 'bulgarian', 'בולגרי'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [85, 110] },
  // Single-leg deadlift: hip hinge depth (trunk angle)
  { keywords: ['דדליפט', 'deadlift', 'דד ליפט'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [30, 60] },
  // Step-up: knee at drive
  { keywords: ['סטפ-אפ', 'step up', 'סטפ אפ', 'מדרגה'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [90, 120] },
  // Front raise: shoulder flexion at top — higher = better
  { keywords: ['הרמה קדמית', 'front raise', 'הרמות קדמיות'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [70, 90] },
  // Upright row: elbow at pull — higher = better (elbows up)
  { keywords: ['משיכה זקופה', 'upright row'], joint: 'elbow', phase: 1, dir: 'lower',
    thresholds: [60, 90] },
  // Shrug: shoulder elevation (measured as shoulder angle change)
  { keywords: ['כיווץ כתפיים', 'shrug', 'שראג'], joint: 'shoulder', phase: 1, dir: 'lower',
    thresholds: [15, 30] },
  // Arnold press: elbow at top — higher = full extension
  { keywords: ['לחיצת ארנולד', 'arnold press', 'ארנולד'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [150, 170] },
  // Hammer curl: elbow at peak — lower = more curl
  { keywords: ['כפיפות פטיש', 'hammer curl', 'פטיש'], joint: 'elbow', phase: 1, dir: 'lower',
    thresholds: [40, 70] },
  // Overhead tricep ext: elbow at top — higher = full extension
  { keywords: ['הרחבת טריצפס מעל', 'overhead tricep', 'טריצפס מעל'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [150, 170] },
  // === NEW FITNESS — Floor/Lying ===
  // Superman: trunk extension — higher = more arch = better
  { keywords: ['סופרמן', 'superman'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [160, 175] },
  // Dead bug: trunk stability — higher = flatter back = better
  { keywords: ['דד באג', 'dead bug'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [165, 178] },
  // Bird dog: trunk alignment — higher = flatter = better
  { keywords: ['ציפור', 'bird dog', 'בירד דוג'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [160, 175] },
  // Russian twist: trunk rotation — lower = more rotation = better
  { keywords: ['סיבוב רוסי', 'russian twist', 'רוסי'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [20, 40] },
  // Leg raise: hip angle at top — lower = higher lift = better
  { keywords: ['הרמות רגליים', 'leg raise', 'הרמת רגליים'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [80, 120] },
  // Flutter kicks: trunk stability while kicking
  { keywords: ['בעיטות פרפר', 'flutter kick', 'פלאטר'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [160, 175] },
  // Bicycle crunch: trunk curl — lower = more curl
  { keywords: ['כפיפות אופניים', 'bicycle crunch', 'אופניים'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [120, 150] },
  // Reverse crunch: hip curl
  { keywords: ['כפיפות בטן הפוכות', 'reverse crunch', 'הפוכות'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [120, 150] },
  // Hip thrust: hip extension at top — higher = more extension
  { keywords: ['הרמת ירכיים', 'hip thrust'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [85, 110] },
  // V-ups: trunk angle at peak — lower = more fold
  { keywords: ['כפיפות V', 'v-up', 'v up'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [60, 100] },
  // Donkey kicks: knee angle at top — lower = more kick back
  { keywords: ['בעיטות חמור', 'donkey kick', 'חמור'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [80, 110] },
  // === NEW FITNESS — Cardio/Dynamic ===
  // High knees (main): knee at peak — lower = higher
  { keywords: ['ברכיים גבוהות', 'high knee main'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [60, 90] },
  // Butt kicks: knee at peak — lower = closer to glute
  { keywords: ['בעיטות ישבן', 'butt kick'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [30, 60] },
  // Skater jumps: knee at landing — lower = more controlled
  { keywords: ['קפיצות מחליק', 'skater jump', 'מחליק'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [100, 130] },
  // Tuck jumps: knee at peak — lower = more tuck
  { keywords: ['קפיצות טאק', 'tuck jump', 'טאק'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [50, 80] },
  // Bear crawl: trunk alignment
  { keywords: ['זחילת דוב', 'bear crawl', 'דוב'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [155, 170] },
  // Inch worm: trunk at bottom — lower = deeper stretch
  { keywords: ['תולעת', 'inch worm'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [140, 165] },
  // === NEW FITNESS — Additional ===
  // Good morning: trunk lean — lower = more hinge
  { keywords: ['גוד מורנינג', 'good morning'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [30, 60] },
  // Hollow body: trunk alignment — higher = flatter
  { keywords: ['החזקת גוף חלול', 'hollow body', 'גוף חלול'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [165, 178] },
  // Plank to push-up: elbow at top — higher = full push-up
  { keywords: ['פלאנק לשכיבות', 'plank to push', 'פלאנק שכיבות'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [150, 170] },
  // Star jumps: knee at landing
  { keywords: ['קפיצות כוכב', 'star jump', 'כוכב'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [100, 140] },
  // Plank shoulder tap: trunk stability
  { keywords: ['פלאנק עם נגיעת כתף', 'shoulder tap', 'נגיעת כתף'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [160, 175] },
  // Superman banana: trunk alignment
  { keywords: ['סופרמן-בננה', 'superman banana', 'בננה'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [155, 170] },
  // === NEW BASKETBALL ===
  // Bounce pass: elbow extension — higher = more push
  { keywords: ['מסירת הקפצה', 'bounce pass'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 165] },
  // Chest pass: elbow at release — higher = full push
  { keywords: ['מסירת חזה', 'chest pass'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 165] },
  // Overhead pass: elbow extension overhead
  { keywords: ['מסירה מעל הראש', 'overhead pass'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 165] },
  // Behind-back dribble: knee flexion (low stance)
  { keywords: ['דריבל מאחורי הגב', 'behind-back dribble'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [110, 140] },
  // Spin move: trunk rotation
  { keywords: ['ספין מוב', 'spin move', 'ספין'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [15, 35] },
  // Jump shot: elbow at release
  { keywords: ['זריקת קפיצה', 'jump shot'], joint: 'elbow', phase: 2, dir: 'higher',
    thresholds: [120, 160] },
  // Hook shot: shoulder at release — higher = more arc
  { keywords: ['הוק שוט', 'hook shot'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [100, 140] },
  // Post moves: knee flexion (power stance)
  { keywords: ['תנועות פוסט', 'post moves', 'פוסט'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [100, 130] },
  // === NEW TENNIS ===
  // Overhead smash: elbow at contact — higher = full extension
  { keywords: ['סמאש', 'smash', 'overhead smash'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 170] },
  // Split step: knee at landing — lower = more loaded
  { keywords: ['ספליט סטפ', 'split step'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [110, 140] },
  // Drop shot: shoulder angle (soft touch)
  { keywords: ['דרופ שוט', 'drop shot'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [60, 100] },
  // Slice: elbow angle at contact — higher = cleaner cut
  { keywords: ['סלייס', 'slice'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [120, 155] },
  // Approach shot: trunk lean forward
  { keywords: ['גישה לרשת', 'approach shot'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [5, 15] },
  // Return stance: knee flexion
  { keywords: ['עמדת קבלה', 'return stance'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [120, 150] },
  // === NEW FOOTBALL ===
  // Headers: trunk alignment at jump — higher = straighter
  { keywords: ['נגיחות ראש', 'header'], joint: 'trunk', phase: 1, dir: 'higher',
    thresholds: [155, 170] },
  // Instep shot: knee at backswing — lower = more power
  { keywords: ['בעיטת גב כף', 'instep shot'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [50, 90] },
  // Outside-foot pass: knee at contact
  { keywords: ['מסירה חיצונית', 'outside foot', 'outside pass'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [100, 140] },
  // Chest control: knee flex on cushion
  { keywords: ['שליטה בחזה', 'chest control'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [120, 150] },
  // Cone drill: knee flexion — low = agile
  { keywords: ['תרגיל זריזות', 'cone drill', 'קונוסים'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [110, 140] },
  // Quick turns: trunk rotation
  { keywords: ['פניות מהירות', 'quick turn'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [20, 40] },
  // Sprint recovery: trunk alignment
  { keywords: ['חזרה מספרינט', 'sprint recovery'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [155, 170] },
  // Shield ball: knee flexion (low stance)
  { keywords: ['הגנה על הכדור', 'shield ball'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [110, 140] },
  // === NEW AMPUTEE FOOTBALL ===
  // Crutch dribbling: trunk stability
  { keywords: ['דריבלינג בקביים', 'crutch dribbling'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [155, 170] },
  // Crutch shot: shoulder stability
  { keywords: ['בעיטת דריבל בקביים', 'crutch shot'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [60, 90] },
  // Crutch agility: trunk stability during movement
  { keywords: ['זריזות בקביים', 'crutch agility'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [150, 168] },
  // Crutch quick turn: trunk rotation
  { keywords: ['פנייה מהירה בקביים', 'crutch quick turn'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [15, 30] },
  // Crutch shield: trunk upright
  { keywords: ['הגנה על כדור בקביים', 'crutch shield'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [155, 170] },
  // Crutch header: trunk alignment
  { keywords: ['נגיחה בקביים', 'crutch header'], joint: 'trunk', phase: 1, dir: 'higher',
    thresholds: [155, 170] },
  // Crutch chest control: trunk stability
  { keywords: ['שליטה בחזה בקביים', 'crutch chest control'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [155, 170] },
  // === NEW AMPUTEE GK ===
  // GK dive: lateral reach measured as trunk lean
  { keywords: ['צלילה לשער', 'gk dive', 'dive save'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [30, 60] },
  // GK distribution: elbow extension on throw
  { keywords: ['הפצה מהשער', 'gk distribution'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 165] },
  // GK positioning: knee flexion in ready stance
  { keywords: ['מיקום שוער', 'gk positioning'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [130, 155] },
  // GK one-hand save: elbow extension
  { keywords: ['עצירה ביד אחת', 'gk one-hand'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 170] },
  // GK crutch block: trunk stability
  { keywords: ['חסימה בקביים', 'gk crutch block'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [150, 168] },
  // GK high catch: shoulder at catch — higher = more reach
  { keywords: ['תפיסה גבוהה', 'gk high catch'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [120, 160] },
  // GK low save: knee flexion — lower = more committed
  { keywords: ['עצירה נמוכה', 'gk low save'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [60, 100] },
  // GK quick release: elbow on throw
  { keywords: ['שחרור מהיר', 'gk quick release'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 165] },
  // GK footwork: knee flexion
  { keywords: ['עבודת רגליים שוער', 'gk footwork'], joint: 'knee', phase: 0, dir: 'lower',
    thresholds: [120, 150] },
  // GK reaction: knee at burst — lower = more explosive
  { keywords: ['תגובה מהירה', 'gk reaction'], joint: 'knee', phase: 1, dir: 'lower',
    thresholds: [100, 135] },
  // === NEW WHEELCHAIR BASKETBALL ===
  // WC bounce pass: elbow extension
  { keywords: ['מסירת הקפצה כיסא', 'wc bounce pass'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 165] },
  // WC hook shot: shoulder arc
  { keywords: ['הוק שוט כיסא', 'wc hook shot'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [100, 140] },
  // WC layup: elbow at finish
  { keywords: ['לייאפ כיסא', 'wc layup'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 170] },
  // WC push sprint: shoulder rotation (push cycle)
  { keywords: ['ספרינט כיסא', 'wc push sprint'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [80, 120] },
  // WC defense: trunk stability
  { keywords: ['הגנה כיסא', 'wc defense'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [155, 172] },
  // WC pick and roll: trunk rotation
  { keywords: ['פיק אנד רול כיסא', 'wc pick and roll'], joint: 'trunk', phase: 1, dir: 'lower',
    thresholds: [15, 35] },
  // WC block out: trunk stability
  { keywords: ['חסימת ריבאונד כיסא', 'wc block out'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [155, 172] },
  // WC fast break: shoulder push cycle
  { keywords: ['מהיר כיסא', 'wc fast break'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [80, 120] },
  // === NEW WHEELCHAIR TENNIS ===
  // WC smash: elbow at contact
  { keywords: ['סמאש כיסא', 'wc smash'], joint: 'elbow', phase: 1, dir: 'higher',
    thresholds: [140, 170] },
  // WC volley: elbow compact
  { keywords: ['ווליי כיסא', 'wc volley'], joint: 'elbow', phase: 1, dir: 'lower',
    thresholds: [80, 120] },
  // WC return: shoulder rotation
  { keywords: ['קבלה כיסא', 'wc return'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [70, 110] },
  // WC split step: trunk stability during chair push
  { keywords: ['ספליט סטפ כיסא', 'wc split step'], joint: 'trunk', phase: 0, dir: 'higher',
    thresholds: [155, 172] },
  // WC drop shot: shoulder angle (soft touch)
  { keywords: ['דרופ שוט כיסא', 'wc drop shot'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [60, 100] },
  // WC push recovery: shoulder push range
  { keywords: ['התאוששות דחיפה כיסא', 'wc push recovery'], joint: 'shoulder', phase: 1, dir: 'higher',
    thresholds: [80, 120] },
];

// Extract a joint value from angle data — handles both 'elbow' and 'leftElbow'/'rightElbow' keys
function getJointAngle(phaseData, jointName) {
  if (!phaseData || typeof phaseData !== 'object') return null;
  // Direct match
  if (typeof phaseData[jointName] === 'number') return phaseData[jointName];
  // Left/right variants — pick the one that exists (prefer min for "lower is better")
  const leftKey = `left${jointName.charAt(0).toUpperCase() + jointName.slice(1)}`;
  const rightKey = `right${jointName.charAt(0).toUpperCase() + jointName.slice(1)}`;
  const left = typeof phaseData[leftKey] === 'number' ? phaseData[leftKey] : null;
  const right = typeof phaseData[rightKey] === 'number' ? phaseData[rightKey] : null;
  if (left !== null && right !== null) return Math.min(left, right); // Use more bent side
  return left ?? right ?? null;
}

function computeScoreFromAngles(exercise, jointAngles) {
  if (!jointAngles || !Array.isArray(jointAngles) || jointAngles.length === 0) return null;
  const ex = (exercise || '').toLowerCase();

  for (const rule of SCORING_RULES) {
    if (!rule.keywords.some(k => ex.includes(k))) continue;

    const phaseData = jointAngles[rule.phase] || jointAngles[1] || jointAngles[0];
    if (!phaseData) continue;

    const angle = getJointAngle(phaseData, rule.joint);
    if (typeof angle !== 'number') continue;

    const [lowThresh, highThresh] = rule.thresholds;

    if (rule.dir === 'lower') {
      if (angle < lowThresh) return Math.min(10, 8 + Math.round(2 * (1 - angle / lowThresh)));
      if (angle <= highThresh) return 5 + Math.round(2 * (highThresh - angle) / (highThresh - lowThresh));
      return 2 + Math.round(2 * Math.max(0, 1 - (angle - highThresh) / 60));
    } else {
      if (angle > highThresh) return Math.min(10, 8 + Math.round(2 * Math.min(1, (angle - highThresh) / 20)));
      if (angle >= lowThresh) return 5 + Math.round(2 * (angle - lowThresh) / (highThresh - lowThresh));
      return 2 + Math.round(2 * Math.max(0, angle / lowThresh));
    }
  }

  return null; // No matching rule — let Haiku score
}

// Extract key angles from a phase data object for the response
function extractKeyAngles(jointAngles) {
  if (!jointAngles || !Array.isArray(jointAngles)) return {};
  const peak = jointAngles[1] || jointAngles[0] || {};
  const result = {};
  for (const [k, v] of Object.entries(peak)) {
    if (typeof v === 'number') result[k] = Math.round(v);
  }
  return result;
}

function qualityLabel(score) {
  if (score >= 8) return 'EXCELLENT';
  if (score >= 5) return 'MEDIOCRE';
  return 'BAD';
}

const __analyzerDirname = path.dirname(fileURLToPath(import.meta.url));

const cleanBase64 = (b) => {
  if (typeof b !== 'string' || !b) return '';
  return b.replace(/^data:image\/\w+;base64,/, '').trim().replace(/\s/g, '');
};

// Load saved debug frames from disk as base64 (fallback when client sends placeholders)
const MAX_DEBUG_FRAME_BYTES = 1024 * 1024; // 1MB per frame max

async function loadDebugFrames(playerName, exercise, repNumber) {
  try {
    const debugDir = path.join(__analyzerDirname, '..', 'debug_frames');
    if (!fs.existsSync(debugDir)) return [];

    const files = (await fs.promises.readdir(debugDir))
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .reverse(); // Most recent first

    // Find the 3 most recent frames matching this exercise+rep (or just the latest 3)
    const safeExercise = (exercise || '').replace(/[^a-zA-Z0-9\u0590-\u05FF_-]/g, '_');
    const pattern = `rep${repNumber}_`;

    // Try exact match first, then any recent frames
    let matched = files.filter(f => f.includes(safeExercise) && f.includes(pattern));
    if (matched.length < 3) matched = files.filter(f => f.includes(safeExercise));
    if (matched.length < 3) matched = files.slice(0, 3);

    // Take the 3 frames (f1, f2, f3) — sort by name to get correct order
    const sorted = matched.slice(0, 3).sort();
    const results = [];
    for (const f of sorted) {
      const filePath = path.join(debugDir, f);
      const stat = await fs.promises.stat(filePath);
      if (stat.size > MAX_DEBUG_FRAME_BYTES) {
        console.warn(`[VISION] Skipping oversized debug frame: ${f} (${Math.round(stat.size/1024)}KB)`);
        continue;
      }
      const data = await fs.promises.readFile(filePath);
      results.push(data.toString('base64'));
    }
    return results;
  } catch (err) {
    console.warn('[VISION] Failed to load debug frames:', err.message);
    return [];
  }
}

export async function analyzeRepFrames({ frames, sport, exercise, playerProfile, repNumber, jointAngles, telemetry, previousScore }) {
  const safeFallback = { is_correct: true, instruction: '', pro_tip: '', feedback: '', score: 0, angles: {} };
  try {
    const playerName = sanitizeInput(playerProfile?.name, 30) || 'ספורטאי';
    const safeExercise = sanitizeInput(exercise, 40) || 'exercise';
    const safeSport = sanitizeInput(sport, 30) || 'fitness';
    const hasAngles = jointAngles && Array.isArray(jointAngles) && jointAngles.length > 0;

    // Compute score server-side from angles (deterministic, reliable)
    const serverScore = hasAngles ? computeScoreFromAngles(exercise, jointAngles) : null;
    const keyAngles = hasAngles ? extractKeyAngles(jointAngles) : {};

    // Compact angle summary (one line)
    const anglesBlock = hasAngles
      ? `\nAngles: start=${formatAngles(jointAngles[0])}, peak=${formatAngles(jointAngles[1] || jointAngles[0])}` + (jointAngles[2] ? `, end=${formatAngles(jointAngles[2])}` : '')
      : '';

    // Compact telemetry (only if available)
    const telemetryBlock = telemetry && Array.isArray(telemetry) && telemetry.length > 0
      ? `\nKeypoints: ${JSON.stringify(telemetry)}`
      : '';

    const scoreHint = serverScore !== null
      ? `\nQuality: ${serverScore}/10 (${qualityLabel(serverScore)}). Match tone.`
      : '';

    // Wire in biomechanics checklist
    const biomechanics = getBiomechanicsChecklist(exercise, sport);
    const bioBlock = biomechanics ? `\nCheck: ${biomechanics}` : '';

    // Build clean frame array — validate each frame is real base64 (>500 chars)
    let cleanFrames = [];
    if (frames && Array.isArray(frames)) {
      cleanFrames = frames.map(f => cleanBase64(f)).filter(f => f.length > 500);
    }

    // If frames are placeholders/empty, try loading from debug_frames on disk
    if (cleanFrames.length === 0) {
      console.log(`[VISION] No valid frames from client, loading from debug_frames...`);
      const diskFrames = await loadDebugFrames(playerName, exercise, repNumber);
      if (diskFrames.length > 0) {
        cleanFrames = diskFrames.filter(f => f.length > 500);
        console.log(`[VISION] Loaded ${cleanFrames.length} frames from disk (${cleanFrames.map(f => Math.round(f.length/1024) + 'KB').join(', ')})`);
      }
    }

    // Body metrics for biomechanical context
    const height = playerProfile?.height;
    const weight = playerProfile?.weight;
    const bodyBlock = (height || weight)
      ? `\nנתוני גוף: ${height ? `גובה ${height} ס"מ` : ''}${height && weight ? ', ' : ''}${weight ? `משקל ${weight} ק"ג` : ''}. התאם ציפיות טווח תנועה ועומס בהתאם.`
      : '';

    // Prosthesis / amputation context for vision analysis
    const disability = playerProfile?.disability || 'none';
    const ampSide = playerProfile?.amputationSide || '';
    const ampLevel = playerProfile?.amputationLevel || '';
    const mobilityAid = playerProfile?.mobilityAid || 'none';
    const hasProsthesis = disability !== 'none' || (ampSide && ampSide !== 'none');

    // Active device detection — visually scan frames for assistive devices
    const deviceDetectionBlock = `
זיהוי ציוד עזר בתמונה:
- חפש: קביים, פרוטזה רגילה, פרוטזת ריצה (Blade), כיסא גלגלים, סד.
- אם מזהה קביים: בדוק מרחק מהגוף, זווית נטייה, בסיס משולש תמיכה (2 קביים + רגל).
- אם מזהה Blade: בדוק זווית עקמומיות, נקודת מגע עם הרצפה, יישור מול הברך.
- נקודות ייחוס: קצה קב = נקודת מגע קרקע. קצה Blade = בסיס עמידה. השתמש בהן לחישוב יציבות.
- אם הקביים רחוקות/צרות מדי, או Blade בזווית לא נכונה — ציין ב-INSTRUCTION.
מילון ציוד: קביים רחוקות מדי, קרב קביים לגוף, בסיס משולש יציב, Blade בזווית טובה, נקודת מגע יציבה.`;

    const ampBlock = hasProsthesis
      ? `\nהספורטאי: מוגבלות=${disability}, צד=${ampSide || 'לא ידוע'}, רמה=${ampLevel || 'לא ידוע'}, עזר=${mobilityAid}.
אסור להעיר על: סימטריה ירכיים, נטייה לצד, רגל חסרה.
התמקד ב: ליבה, גב, כתפיים, ידיים, טווח תנועה עליון, מנח ציוד עזר.
אם פלג עליון ישר ותנועה מלאה, ציון 8 ומעלה.
${deviceDetectionBlock}`
      : '';

    // Lightweight device scan for users without disability in profile
    const deviceScanBlock = !hasProsthesis
      ? `\nאם אתה מזהה קביים, פרוטזה, או כיסא גלגלים בתמונה — התאם את הניתוח בהתאם. התעלם מהרגל/יד החסרה.`
      : '';

    // === UNIVERSAL PRO COACH — BIOMECHANICAL ANALYSIS ===
    const sportContext = {
      footballAmputee: `כדורגל קטועים — ניתוח מקצועי:
ריצה: זווית גזע קדימה 10-15°, קצב קביים סימטרי, נחיתה על כריות כף רגל.
בעיטה: בסיס קביים רחב ויציב, רוטציית ירך מלאה, מרכז כובד מעל משולש תמיכה.
כדור: מרחק רגל-כדור, זווית פגיעה, מעקב גוף אחרי בעיטה.
קביים: רוחב בסיס, זווית נטייה, גובה אחיזה, קצוות=נקודות מגע קרקע.`,
      football: `כדורגל — ניתוח מקצועי:
ריצה: זווית נחיתה (forefoot), הטיית גוף 15-20° קדימה, תדירות צעדים, הנפת ברכיים.
בעיטה: רגל עמידה 15ס"מ ליד הכדור, נעילת קרסול, רוטציית ירך, מעקב רגל גבוה.
כדור: מרחק כדור-רגל, זווית פגיעה, מגע פנימי/חיצוני, שליטה ראשונית.
יציבות: מרכז כובד נמוך, כתפיים מעל אגן, זרועות לאיזון.`,
      basketball: `כדורסל — ניתוח מקצועי:
זריקה: מרפק 90° מתחת לכדור, מעקב גוזנק, שחרור בנקודה הגבוהה, קו ישר כדור-סל.
דריבלינג: כדור מתחת לגובה מותניים, דחיפת אצבעות (לא כף), ראש למעלה.
הגנה: עמידה רחבה, ברכיים כפופות, ידיים פעילות, החלקה בלי צלב רגליים.
יציבות: איזון רגליים, מרכז כובד נמוך, כתפיים מעל בסיס.`,
      tennis: `טניס — ניתוח מקצועי:
מכות: סיבוב כתפיים מוקדם, נקודת מגע מול הגוף, מעקב מלא מעל כתף, העברת משקל קדימה.
הגשה: זריקת כדור בשעה 1, תנוחת גביע, הארכה מלאה במגע, פרונציה במעקב.
תנועה: ספליט סטפ לפני מגע, צעדים קטנים להתאמה, חזרה למרכז.
יציבות: בסיס רחב, ברכיים כפופות, גוף פתוח לכיוון המגרש.`,
      fitness: `כושר — ניתוח מקצועי:
יציבה: עמוד שדרה ניטרלי, כתפיים מעל אגן, ליבה מתוחה, ראש בקו עם גב.
טווח תנועה: טווח מלא בכל חזרה, שליטה אקסצנטרית (ירידה איטית), אין קיצורי דרך.
מפרקים: ברכיים בקו עם אצבעות רגליים, מרפקים 45° מהגוף, כתפיים לא מורמות.
נשימה: נשיפה במאמץ, שאיפה בהרפיה. קצב קבוע ומבוקר.`,
    };
    const sportHint = sportContext[sport] || sportContext.fitness;

    const historyBlock = previousScore != null
      ? `\nביצוע קודם: ${previousScore}/10. ${previousScore > 0 ? 'השווה לביצוע הנוכחי. אם שיפור — ציין. אם ירידה — ציין.' : ''}`
      : '';

    const system = `ענה אך ורק בפורמט: SCORE|INSTRUCTION|PRO_TIP
שורה אחת בלבד. בלי #, בלי **, בלי כותרות, בלי הסברים נוספים.
אתה מאמן מוסמך בעל ניסיון של 20 שנה. הערות שלך חייבות להיות:
- ברמה ביומכנית: ציין שמות שרירים, מפרקים, וזוויות ספציפיות
- פדנטי: שים לב לפרטים הקטנים — זווית כף רגל, סיבוב אגן, קו כתפיים
- אגרסיבי-חיובי: דרוש יותר אבל תשבח כשמגיע
- השתמש בשמות אנטומיים בעברית: ארבע ראשי, שריר התאומים, דלתואיד, ליבה, טרפז, חזה גדול, סולאוס, גסטרוק
בטיחות (עדיפות ראשונה — תמיד ב-INSTRUCTION לפני הכל):
- קריסת ברך פנימה (Valgus): "עצור! הברך קורסת פנימה — דחוף ברך החוצה בקו הבהונות"
- הקשתת גב תחתון (Lordosis): "עצור! גב תחתון מוקשת — כווץ ליבה ושטח אגן"
- נעילת מרפקים תחת עומס: "עצור! אל תנעל מרפקים — שמור כפיפה קלה של 5°"
- שורש כף יד כפוף מעל 30°: "הזהר! שורש כף יד כפוף — יישר לניטרלי למניעת CTS"
- סיבוב ברך תחת עומס: "עצור! ברך מסתובבת — בהונות וברכיים באותו כיוון"
אם אין סכנת פציעה, דלג על התראה ותן תיקון רגיל.
עיקרון השרשרת הקינטית — נתח מלמטה למעלה:
1. כפות רגליים (Ankle/Foot): מנח Point/Flex, משקל על עקב/בהונות/כף מלאה, קרסול יציב
2. ברכיים: קו עם בהונות, לא קורסות פנימה, זווית נכונה לתרגיל
3. ירכיים/אגן: סיבוב אגן, נטייה קדמית/אחורית, עומק כיפוף
4. ליבה: ליבה מתוחה, גב ישר, אין הקשתה או כיפוף מוגזם
5. כתפיים/שכמות: כתפיים נמוכות ואחורה, שכמות נעולות, לא מורמות לאוזניים
6. ראש ומבט: ראש בקו עמוד שדרה, מבט קדימה (לא למטה!), סנטר מעט מוכנס
7. כפות ידיים (Wrist/Hand): שורש כף יד ניטרלי, אחיזה נכונה
חלוקת משקל:
- סקוואט/לאנג׳: 60% עקב, 40% כף — אם עקב מורם = ארבע ראשי דומיננטי, חסר עומק
- קביים: משולש תמיכה — 2 קביים + רגל עומדת, משקל מחולק שווה
- שכיבות: משקל על כפות ידיים + בהונות, לא על בטן או ברכיים
- כיסא גלגלים: מרכז כובד מעל צירי הגלגלים, לא נשען קדימה
קשר גוף-אביזר (Object-Body Link):
- כדור בבעיטה: מגע שרוכים = כוח, פנים כף = דיוק, חיצוני = סיבוב. ציין אם נכון לתרגיל
- כדור בדריבלינג: כדור צמוד לגוף, כף רגל מכסה את הכדור, לא בועט — שולט
- קביים: ידיות בגובה ירך, מרפק 150-160° (לא נעול, לא כפוף), קצה קביה 15-20 ס"מ מכף רגל
- משקולת/דמבל: קרוב למרכז כובד, שורש כף יד ניטרלי, לא מטלטל — שולט
- גומיית התנגדות: מתיחה רציפה, לא שחרור פתאומי, עוטפת סביב כף יד ולא אצבעות
- כדור בכדורסל: כדור על אצבעות (לא כף יד), מרפק מתחת לכדור בזריקה
כף רגל — לפי תרגיל:
- בעיטה: כף רגל פשוטה (Point), קרסול נעול, מגע בחלק הנכון של הכדור
- דריבלינג: כף רגל flex קלה, בהונות מכוונות לכדור, קרסול רפוי
- סקוואט/לאנג׳: כף שטוחה, עקב דבוק, בהונות 0-30° החוצה
- פלאנק/שכיבות: בהונות כפופות, קרסול 90°
- ריצה/ספרינט: נחיתה על כף קדמית, לא על עקב
כף יד — לפי תרגיל:
- קביים: שורש כף יד ניטרלי, אצבעות עוטפות ידית, אגודל מעל
- שכיבות סמיכה: כף מתחת לכתף, אצבעות פרושות, לחץ מפוזר
- לחיצת כתפיים/כפיפות: שורש כף יד ישר בקו עם אמה
- זריקת כדורסל: כדור על אצבעות, שורש כף יד לא נוגע בכדור
מאמן ${safeSport}. תרגיל: ${safeExercise}.
${playerName} rep#${repNumber}. ${sportHint}${bodyBlock}${anglesBlock}${telemetryBlock}${bioBlock}${ampBlock}${deviceScanBlock}${historyBlock}${scoreHint}
כללי ציון:
ציון 1-3: סכנת פציעה או טכניקה שבורה. פתח עם "עצור!" + תיקון בטיחותי.
ציון 4-7: תיקון פעיל. תגיד איך לתקן, לא מה לא בסדר. משפט קצר וברור.
ציון 8-10: אישור קצר. טכניקה טובה, תמשיך. ציין נקודת חוזק אחת.
סגנון: עברית פשוטה, מילים מקצועיות. משפטים קצרים עם נקודה. אסור להמציא מילים.
3|עצור! ברך קורסת פנימה. דחוף ברך החוצה בקו בהונות, כף רגל שטוחה|אחיזת קביים ניטרלית
5|הרם עקב מהרצפה, ליבה מתוחה, מבט קדימה|שרוכים לכדור בבעיטה
8|שרשרת קינטית מצוינת — כף רגל יציבה, ליבה נעולה, ראש בקו|שמור אחיזה ניטרלית
9|מושלם. כל המפרקים בקו, משקל מחולק נכון|גב ישר וחזק`;

    const t0 = Date.now();
    let message;

    if (cleanFrames.length > 0) {
      // VISION PATH: send 2 frames (start + peak)
      const imageBlocks = cleanFrames.slice(0, 2).map((f) => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: f }
      }));

      console.log(`[VISION-IMG] ${cleanFrames.length} frames for ${exercise} rep#${repNumber} serverScore=${serverScore} bio=${!!biomechanics} sizes=${cleanFrames.map(f => Math.round(f.length/1024) + 'KB').join(',')}`);
      message = await client.messages.create({
        model: HAIKU_VISION_MODEL,
        max_tokens: 120,
        system,
        messages: [{ role: 'user', content: [
          ...imageBlocks,
          { type: 'text', text: 'נתח' }
        ]}]
      });
    } else {
      // TEXT-ONLY: angles + telemetry only
      console.warn(`[VISION-TEXT] No images for ${exercise} rep#${repNumber} — text-only`);
      message = await client.messages.create({
        model: HAIKU_VISION_MODEL,
        max_tokens: 120,
        system,
        messages: [{ role: 'user', content: 'נתח לפי הזוויות שקיבלת. ענה בפורמט SCORE|INSTRUCTION|PRO_TIP בלבד.' }]
      });
    }

    let rawText = message.content[0].text.trim();
    const elapsed = Date.now() - t0;
    console.log(`[VISION] Response in ${elapsed}ms (${rawText.length} chars): ${rawText}`);

    // Strip Markdown artifacts (#, *, **, ```) before parsing
    rawText = rawText.replace(/^[#*`\s]+/gm, '').replace(/\*\*/g, '').replace(/\*/g, '').trim();
    // If multi-line, take only the first line that has a pipe
    const pipeLine = rawText.split('\n').find(l => l.includes('|'));
    if (pipeLine) rawText = pipeLine.trim();

    // Parse pipe-delimited: SCORE|INSTRUCTION|PRO_TIP
    const parts = rawText.split('|').map(s => s.trim());
    const parsedScore = parseInt(parts[0], 10);
    let instruction, proTip, feedback;

    if (!isNaN(parsedScore) && parts.length >= 2) {
      // Pipe format parsed successfully
      instruction = parts[1] || 'המשך ככה';
      proTip = parts[2] || '';
      feedback = instruction + (proTip && proTip !== instruction ? '. ' + proTip : '');
    } else {
      // Fallback: try JSON extraction
      console.warn(`[VISION] Pipe parse failed, trying JSON fallback: ${rawText}`);
      const jsonText = rawText.includes('{') ? rawText : '{' + rawText;
      const jsonParsed = extractJSON(jsonText);
      if (jsonParsed) {
        instruction = jsonParsed.instruction || 'המשך ככה';
        proTip = jsonParsed.pro_tip || '';
        feedback = instruction + (proTip && proTip !== instruction ? '. ' + proTip : '');
      } else {
        // Both parsers failed — but if we have a serverScore from angles, use it
        if (serverScore !== null) {
          console.warn(`[VISION] Parse failed but serverScore=${serverScore}, returning angle-based result`);
          return {
            is_correct: true,
            instruction: serverScore >= 8 ? 'טכניקה טובה, המשך ככה' : 'שפר את הטכניקה, שמור על טווח תנועה מלא',
            pro_tip: '',
            feedback: serverScore >= 8 ? 'טכניקה טובה, המשך ככה' : 'שפר את הטכניקה, שמור על טווח תנועה מלא',
            score: serverScore,
            issue_key: '',
            angles: keyAngles,
          };
        }
        return safeFallback;
      }
    }

    return {
      is_correct: true,
      instruction,
      pro_tip: proTip,
      feedback,
      score: serverScore ?? (parsedScore || 5),
      issue_key: '',
      angles: keyAngles,
    };
  } catch (err) {
    if (err.status === 429) return safeFallback;
    // Vision API error (400 invalid image, etc.) — fall back to serverScore if available
    if (serverScore !== null) {
      console.warn(`[VISION] API error but serverScore=${serverScore}, returning angle-based result`);
      return {
        is_correct: true,
        instruction: serverScore >= 8 ? 'טכניקה טובה, המשך ככה' : 'שפר את הטכניקה, שמור על טווח תנועה מלא',
        pro_tip: '',
        feedback: serverScore >= 8 ? 'טכניקה טובה, המשך ככה' : 'שפר את הטכניקה, שמור על טווח תנועה מלא',
        score: serverScore,
        issue_key: '',
        angles: keyAngles,
      };
    }
    console.error('analyzeRepFrames error:', err.message);
    return safeFallback;
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
- Rest between high-intensity crutch drills must be adequate

ADVANCED CRUTCH BIOMECHANICS:
- Crutch base must be >= shoulder width for stability during kicks
- Crutch leverage sprint: plant crutches ahead of body, swing-through gait for max speed
- Pre-kick sequence: shift weight fully to crutches → brace core → hip rotation → kick with standing leg
- Balance triangle: 2 crutch tips + standing foot form stable equilateral triangle
- Shoulder fatigue monitoring: hunched shoulders = immediate rest needed
- Wrist angle: neutral position (not hyperextended) during all weight-bearing phases
- Ball control: trap ball with sole while crutches provide tripod stability, then pass/shoot
- Turning technique: pivot on standing foot, use crutches as compass points for direction change`,

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
- Ankle and knee stability exercises as injury prevention

BIOMECHANICS FOCUS:
- Kicking: plant foot 15cm beside ball, ankle locked rigid, hip rotation drives power, follow-through high across body
- Running technique: arm drive opposite to legs, heel-to-toe transition, forward lean 5-10 degrees
- Passing: inside-foot technique, plant foot points to target, weight transfer through ball, follow-through to target
- First touch: cushion ball (withdraw foot on contact), body behind ball line, open body to next action
- Shooting: approach at 30-45 degree angle, strike with laces for power or inside for placement, lean over ball
- Dribbling: ball within 1m, alternate inside/outside/sole, low center of gravity, periodic head-up scanning`,

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
- Rest between high-intensity shooting/driving series

SHOOTING BIOMECHANICS (BEEF METHOD):
- Balance: feet shoulder-width apart, square to basket, weight on balls of feet
- Eyes: focus on back of rim throughout entire shot
- Elbow: directly under ball at 90 degree set point, NOT flared out, forms L-shape
- Follow-through: full arm extension, wrist snap (gooseneck), hold finish until ball hits rim
- One-motion shot: legs drive upward → elbow extends → wrist flicks (continuous kinetic chain)
- Release point: ball leaves hand above the shooting eye, index+middle finger last contact
- Off-hand: guide hand stays on side of ball, comes off cleanly at release (no thumb flick)

DRIBBLING BIOMECHANICS:
- Pound dribble below knee height for control, waist height for speed
- Fingertip control (not palm), push ball down rather than slapping
- Crossover: hard pound at 45 degree angle, low and quick, sell with shoulder/head fake
- Eyes up: scan court while dribbling, use peripheral vision for ball`,

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
- Rest between intense serving sessions to protect shoulder

STROKE BIOMECHANICS:
- Forehand: early unit turn with shoulders, racket back via non-dominant hand, contact in front of body at waist height, full follow-through over opposite shoulder, weight transfers from back to front foot
- Backhand (two-hand): early shoulder turn, dominant hand at base of grip, contact in front, follow-through across body to opposite shoulder
- Serve: ball toss at 1 o'clock position (for right-hander), trophy position with racket behind head, full vertical extension at contact, pronation through ball on follow-through, land on front foot inside baseline
- Volley: split step as opponent contacts ball, short backswing (no full swing), firm wrist, punch through ball, recover to ready position immediately`,
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
- Cool-down with stretching after cardio

EXERCISE BIOMECHANICS:
- Squat: knees track over toes (no valgus collapse inward), heels planted on floor, spine neutral (not rounded), depth to parallel minimum, core braced throughout, weight in mid-foot to heels
- Push-up: elbows at 45 degrees from torso (not flared 90), chest touches floor for full ROM, full lockout at top, rigid plank body line (no hip sag or pike), head in neutral alignment
- Plank: straight line from head to heels, no hip sag or pike, shoulders stacked directly over wrists, core and glutes actively engaged
- Lunge: front knee tracks over ankle (not past toes), back knee descends toward floor, torso stays upright, front shin roughly vertical
- Burpee: soft landing on balls of feet from jump, chest contacts floor in push-up phase, explosive hip drive to standing, full extension with arms overhead at top
- Dips: shoulders stay above elbow level at bottom, elbows bend to 90 degrees, no shoulder shrug or forward lean, controlled descent 2-3 seconds
- Bridge: drive through heels, squeeze glutes at top, neutral spine (no rib flare), hold peak contraction 1-2 seconds
- Mountain climber: hands under shoulders, hips stay level (no bouncing up/down), drive knees to chest alternating, maintain plank spine throughout
- Crunch: lower back stays pressed to floor, curl shoulders toward hips, exhale forcefully on contraction, no neck pulling with hands`
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
שכיבות סמיכה, סקוואט, פלאנק, לאנג'ים, דיפס, כפיפות מרפק, גשר ישבן, כפיפות בטן, מטפס הרים, ישיבה על הקיר, פלאנק צידי,
הרמות עקב, סקוואט סומו, לאנג' הפוך, ספליט סקוואט בולגרי, דדליפט חד-רגלי, סטפ-אפ, הרמה קדמית, כיווץ כתפיים,
סופרמן, דד באג, ציפור-כלב, סיבוב רוסי, הרמות רגליים, בעיטות פרפר, כפיפות אופניים, כפיפות בטן הפוכות, הרמת ירכיים, כפיפות V, בעיטות חמור,
ברכיים גבוהות, בעיטות ישבן, קפיצות מחליק, קפיצות טאק, זחילת דוב, תולעת, גוד מורנינג, החזקת גוף חלול, פלאנק לשכיבות סמיכה, קפיצות כוכב, פלאנק עם נגיעת כתף, סופרמן-בננה.
NEVER suggest exercises that require any equipment when equipment is "none".`,
    dumbbells: `Strength exercises MUST use these EXACT Hebrew names (pick from this list):
שכיבות סמיכה, סקוואט, פלאנק, לאנג'ים, דיפס, כפיפות מרפק, גשר ישבן, כפיפות בטן, מטפס הרים, ישיבה על הקיר, פלאנק צידי,
כתפיים עם משקולות, גובלט סקוואט, הרמה צידית, משיכת משקולת, הרחבת מרפק,
הרמות עקב, סקוואט סומו, לאנג' הפוך, ספליט סקוואט בולגרי, דדליפט חד-רגלי, סטפ-אפ, הרמה קדמית, משיכה זקופה, כיווץ כתפיים, לחיצת ארנולד, כפיפות פטיש, הרחבת טריצפס מעל הראש,
סופרמן, דד באג, ציפור-כלב, סיבוב רוסי, הרמות רגליים, כפיפות V, בעיטות חמור, גוד מורנינג.
Prefer dumbbell exercises when possible.`,
    resistance_bands: `Strength exercises MUST use these EXACT Hebrew names (pick from this list):
שכיבות סמיכה, סקוואט, פלאנק, לאנג'ים, דיפס, כפיפות מרפק, גשר ישבן, כפיפות בטן, מטפס הרים, ישיבה על הקיר, פלאנק צידי,
לחיצת כתפיים עם גומייה, סקוואט עם גומייה, כפיפות מרפק עם גומייה, משיכת גומייה, מתיחת גומייה,
הרמות עקב, סקוואט סומו, לאנג' הפוך, דדליפט חד-רגלי, סטפ-אפ, הרמה קדמית, כיווץ כתפיים,
סופרמן, דד באג, ציפור-כלב, סיבוב רוסי, הרמות רגליים, כפיפות V, גוד מורנינג.
Prefer resistance band exercises when possible.`,
  };

  const disabilityStrength = {
    one_arm: `For ONE-ARM athletes: ONLY use exercises they can do with one arm.
PREFERRED: סקוואט, לאנג'ים, גשר ישבן, כפיפות בטן, פלאנק, מטפס הרים, ישיבה על הקיר, פלאנק צידי, כפיפות מרפק (one arm), הרמות עקב, סקוואט סומו, דדליפט חד-רגלי, סיבוב רוסי, הרמות רגליים, ברכיים גבוהות, בעיטות ישבן.
AVOID: שכיבות סמיכה (unless modified), מתיחת גומייה, דד באג, ציפור-כלב (require two arms). Focus on core and legs.`,
    one_leg: `For ONE-LEG amputee athletes (crutches): ONLY upper body + core + adapted exercises.
AMPUTATION SIDE: ${profile.amputationSide || 'unknown'}. LEVEL: ${profile.amputationLevel || 'unknown'}.
COMPENSATION ANALYSIS: Watch for hip shift to the amputated side during standing exercises. Core engagement compensates for missing leg stability.
IGNORE all analysis of the amputated leg — focus on standing leg alignment, crutch positioning, and trunk stability.
PREFERRED: שכיבות סמיכה, דיפס, פלאנק, כפיפות מרפק, כפיפות בטן, גשר ישבן, פלאנק צידי, כתפיים עם משקולות, הרמה צידית, הרחבת מרפק, משיכת משקולת, סופרמן, דד באג, ציפור-כלב, סיבוב רוסי, הרמות רגליים, כפיפות V, הרמה קדמית, כיווץ כתפיים, גוד מורנינג.
AVOID: סקוואט, לאנג'ים, מטפס הרים, ברכיים גבוהות, קפיצות מחליק, קפיצות טאק, הרמות עקב (require two legs). Squat only if described as single-leg with crutch support.`,
    two_legs: `For WHEELCHAIR athletes: ONLY upper body exercises done seated.
PREFERRED: שכיבות סמיכה, דיפס, כפיפות מרפק, כפיפות בטן, פלאנק, כתפיים עם משקולות, הרמה צידית, הרחבת מרפק, משיכת משקולת, מתיחת גומייה, הרמה קדמית, כיווץ כתפיים, לחיצת ארנולד, כפיפות פטיש, סיבוב רוסי, הרמות רגליים, כפיפות V.
AVOID: סקוואט, לאנג'ים, גשר ישבן, מטפס הרים, ישיבה על הקיר, הרמות עקב, ברכיים גבוהות, קפיצות, דדליפט (require standing/legs).`,
  };

  const eqRule = equipmentRules[eq] || equipmentRules.none;
  const disaStrength = disabilityStrength[profile.disability] || '';

  // === SOUND LIMB FOCUS: Adaptive warmup rules per disability ===
  const warmupAdaptation = {
    one_leg: `WARMUP ADAPTATION (ONE-LEG AMPUTEE, ${profile.amputationSide || 'unknown'} side):
- Focus warmup on the SOUND LEG (healthy leg) — it bears all the load.
- Include: ankle rotations, single-leg balance, hip circles, calf raises on sound leg.
- Add upper body: shoulder rotations, wrist circles (essential for crutch users).
- Core activation: standing core twists, pelvic tilts.
- NEVER include exercises requiring the missing leg. NO bilateral squats, NO lunges.
- voicePrompt must mention: "הרגל הבריאה שלך נושאת הכל, בוא נחמם אותה כמו שצריך"`,
    one_arm: `WARMUP ADAPTATION (ONE-ARM AMPUTEE, ${profile.amputationSide || 'unknown'} side):
- Focus warmup on the SOUND ARM — it compensates for both sides.
- Include: single arm circles, wrist rotations, shoulder mobility on healthy side.
- Add: core twists, leg warmup (full bilateral since legs are intact).
- Back warmup: the healthy shoulder/back bears asymmetric load.
- NEVER include exercises requiring two arms (e.g., bilateral arm circles).
- voicePrompt must mention: "היד החזקה שלך עושה עבודה כפולה, נחמם אותה טוב"`,
    two_legs: `WARMUP ADAPTATION (WHEELCHAIR / BILATERAL LEG AMPUTEE):
- UPPER BODY ONLY warmup. Zero leg exercises.
- Include: shoulder rotations, arm circles, wrist circles, core twists, chest openers.
- Wheelchair push warm-up: gentle forward/back rolls.
- Focus on shoulder joint health — critical for wheelchair propulsion.
- voicePrompt must mention: "נחמם את הכתפיים והידיים שלך, הן המנוע שלך"`,
    other: `WARMUP ADAPTATION (OTHER DISABILITY):
- Conservative warmup targeting movable joints only.
- Focus on core activation and available limb mobility.
- Gentle range-of-motion exercises.
- voicePrompt must be encouraging and adaptive.`,
  };
  const warmupRule = warmupAdaptation[profile.disability] || '';

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

PLAYER: ${sanitizeInput(profile.name, 30)}, Age ${Number(profile.age) || 25}, ${sanitizeInput(profile.gender, 10)}, ${Number(profile.height) || 170}cm, ${Number(profile.weight) || 70}kg
Disability: ${profile.disability}.${profile.amputationSide && profile.amputationSide !== 'none' ? ` Side: ${profile.amputationSide}. Level: ${profile.amputationLevel}.` : ''} ${aidInfo}
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

WORKOUT SEQUENCE (MANDATORY ORDER of exercises in the day):
${sport === 'fitness'
    ? `1. Compound movement first (squat/deadlift/push-up pattern) — heaviest exercise when fresh
2. Secondary compound or isolation (shoulder press/curl/row)
3. Core/stability exercise (plank/crunch/russian twist)
4. Cardio finisher LAST (jumping jacks/high knees/mountain climbers)`
    : `1. TECHNIQUE drill first (low intensity skill: passing/dribbling/footwork) — practice form when fresh
2. MAIN sport drill (shooting/kicking/advanced moves) — high intensity
3. STRENGTH supplement (1 exercise: push-ups/squats/planks)
4. CONDITIONING finisher LAST (sprints/agility/high knees)`}
LOCATION-SPECIFIC EXERCISE SELECTION:
- home: ONLY floor + bodyweight + limited space. NO running drills, NO cone work, NO sprints. Prefer: ${sport === 'fitness' ? 'פלאנק, שכיבות סמיכה, סקוואט, דד באג, סופרמן, סיבוב רוסי, הרמות רגליים, ברכיים גבוהות' : 'עבודת רגליים, מסירות לקיר, דריבל במקום, שכיבות סמיכה'}.
- yard: Running OK, agility OK, moderate space. Prefer: ${sport === 'fitness' ? 'ספרינטים, קפיצות מחליק, זחילת דוב, בורפיז, ריצת אינטרוולים' : 'ספרינטים, דריבלינג, מסירות, בעיטות, תרגיל זריזות קונוסים'}.
- field: Full drills, sprints, large area. All exercises allowed.
- gym: Equipment exercises priority. Prefer: ${sport === 'fitness' ? 'גובלט סקוואט, כתפיים עם משקולות, משיכת משקולת, הרמה צידית, כפיפות מרפק, הרחבת מרפק' : 'תרגילי כוח עם ציוד + תרגילי ספורט'}.

CRITICAL: Return ONLY raw JSON. NO markdown, NO backticks, NO prose.
DESCRIPTION STYLE: Write simple, clear action instructions in Hebrew. NOT "ביצוע פלנק סטטי" but "הישאר במצב שכיבת סמיכה על המרפקים עם גב ישר". Max 12 words.
TIPS: One short safety/form tip per exercise. Max 10 words. Example: "שמור על גב ישר, אל תעגל את הכתפיים".
INSTRUCTIONS: Array of 2-4 short Hebrew steps (max 8 words each). Example: ["עמוד ברוחב כתפיים","כופף ברכיים לאט","דחוף חזרה למעלה"].
VOICE_PROMPT: One sentence in Hebrew (max 15 words) that a coach would say to explain the exercise aloud.

WARMUP (MANDATORY): Each day MUST have a warmup object (not just text). The warmup prepares the body for the workout.
${warmupRule}
warmup format: {"text":"תיאור קצר","instructions":["שלב 1","שלב 2","שלב 3"],"voicePrompt":"משפט מעודד למאמן"}
- warmup.text: max 8 words summary.
- warmup.instructions: 2-4 short Hebrew steps specific to the warmup.
- warmup.voicePrompt: one encouraging Hebrew sentence (max 15 words) referencing the player's condition if applicable.
cooldown: max 8 words.
${sport === 'fitness' ? (hasStrength ? '3-4' : '3') : '3-4'} exercises per day${sport !== 'fitness' ? ` (${hasStrength ? '3' : '2-3'} sport drills + max 1 strength)` : ' (all fitness exercises, NO sport drills)'}.

{"weekNumber":${weekNumber},"theme":"${theme}","days":[{"day":"יום א","focus":"מיקוד","exercises":[{"name":"שם","description":"הסבר פשוט איך לבצע","sets":${prog.sets},"reps":"${prog.reps}","restSeconds":${prog.rest},"tips":"דגש בטיחות קצר","instructions":["צעד 1","צעד 2","צעד 3"],"voicePrompt":"הסבר קולי קצר למאמן"}],"warmup":{"text":"חימום פשוט","instructions":["שלב 1","שלב 2","שלב 3"],"voicePrompt":"משפט מעודד"},"cooldown":"שחרור ומתיחות","durationMinutes":50}]}

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
    warmupText = {
      text: isFitness
        ? 'חימום כתפיים ופרקי ידיים + הרמות ברך + מתיחות דינמיות'
        : 'חימום כתפיים ופרקי ידיים + הרמות ברך עם קביים',
      instructions: [
        'סיבובי כתפיים קדימה ואחורה',
        'סיבובי פרק כף יד',
        'הרמות ברך ברגל הבריאה',
        'מתיחות דינמיות לפלג גוף עליון'
      ],
      voicePrompt: 'הרגל הבריאה שלך נושאת הכל, בוא נחמם אותה ואת הכתפיים כמו שצריך'
    };
  } else if (disability === 'one_arm') {
    strengthMap = strengthOneArm;
    warmupText = {
      text: 'סיבוב יד פעילה + ריצה קלה + מתיחות דינמיות',
      instructions: [
        'סיבובי יד פעילה קדימה ואחורה',
        'ריצה קלה במקום',
        'מתיחות דינמיות לרגליים וגב'
      ],
      voicePrompt: 'היד החזקה שלך עושה עבודה כפולה, נחמם אותה טוב יחד עם כל הגוף'
    };
  } else if (isWheelchair) {
    strengthMap = strengthWheelchair;
    warmupText = {
      text: 'חימום כתפיים + סיבובי ידיים + מתיחות פלג גוף עליון',
      instructions: [
        'סיבובי כתפיים רחבים',
        'סיבובי זרועות קדימה ואחורה',
        'מתיחות חזה ופתיחת כתפיים',
        'סיבובי גוף עליון מצד לצד'
      ],
      voicePrompt: 'נחמם את הכתפיים והידיים שלך, הן המנוע שלך'
    };
  } else {
    strengthMap = strengthRegular;
    warmupText = {
      text: isFitness ? 'ריצה קלה + מתיחות דינמיות + חימום מפרקים' : 'ריצה קלה + מתיחות דינמיות',
      instructions: [
        'ריצה קלה במקום דקה אחת',
        'סיבובי זרועות רחבים',
        'מתיחות דינמיות לרגליים'
      ],
      voicePrompt: 'בוא נחמם את הגוף לפני שמתחילים, כמה דקות ואנחנו מוכנים'
    };
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
    const text = await callClaudeHaiku(sportContext, prompt, 2048);
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

  const text = await callClaudeHaiku(sportContext,
    `Give 4 training tips and 4 safety notes for a ${skillLevel}-level ${sport} player.
Disability: ${profile.disability}.${profile.amputationSide && profile.amputationSide !== 'none' ? ` Side: ${profile.amputationSide}. Level: ${profile.amputationLevel}.` : ''} ${aidInfo} Location: ${location}.${hasStrength ? ' Include strength advice.' : ''}
ONLY raw JSON, no markdown: {"generalTips":["tip1","tip2","tip3","tip4"],"safetyNotes":["note1","note2","note3","note4"]}
Hebrew only. Max 10 words per tip/note.`, 512);

  return extractJSON(text) || { generalTips: [], safetyNotes: [] };
}

export async function generateWorkoutSummary({ profile, sessionData }) {
  const sportCtx = SPORT_CONTEXTS[sessionData.sport] || SPORT_CONTEXTS.football;
  const system = `${sportCtx}

You are writing a post-workout summary as an elite personal coach.
Be specific about what the athlete did well and what needs improvement.
Reference specific exercises by name. Be motivational but honest.
Write in Hebrew. Address the player by name.

Format your response EXACTLY like this:
SUMMARY: [2-3 sentences summarizing performance]
TIP1: [short actionable tip for next session, max 12 words]
TIP2: [short actionable tip for next session, max 12 words]
TIP3: [short actionable tip for next session, max 12 words]`;

  const exerciseLines = (sessionData.exercises || []).map(e =>
    `${e.name}: ${e.repsActual || 0}/${e.repsTarget || 0} reps, ${e.setsCompleted || 0}/${e.setsTarget || 0} sets, quality: ${e.quality || 'unknown'}`
  ).join('; ');

  const content = `Player: ${sanitizeInput(profile.name, 30)}, Age: ${Number(profile.age) || 25}, Sport: ${sanitizeInput(sessionData.sport, 30)}, Disability: ${sanitizeInput(profile.disability, 20) || 'none'}
Session status: ${sessionData.status}, Duration: ${Math.floor((sessionData.totalDuration || 0) / 60)} min, Calories: ${sessionData.totalCalories || 0}
Warm-up completed: ${sessionData.warmUpCompleted ? 'yes' : 'no'}
Exercises: ${exerciseLines}
Write a short, personal coaching summary for this session.`;

  try {
    const text = await callClaude(system, content, 512);
    // Parse structured response: SUMMARY: ... TIP1: ... TIP2: ... TIP3: ...
    const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?=\nTIP|$)/s);
    const tips = [];
    for (let i = 1; i <= 3; i++) {
      const tipMatch = text.match(new RegExp(`TIP${i}:\\s*(.+?)(?=\\nTIP|$)`, 's'));
      if (tipMatch) tips.push(tipMatch[1].trim());
    }
    return { summary: summaryMatch ? summaryMatch[1].trim() : text, tips };
  } catch (err) {
    console.error('Workout summary API error:', err.message);
    const fallback = getLocalFallbackSummary({ profile, sessionData });
    return { summary: fallback, tips: [] };
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

You are a LIVE personal trainer standing RIGHT NEXT to the athlete in a gym. Speak naturally as if you're talking to them face-to-face.

COACHING TONE:
${ageStyle}

RULES:
- Return 1-2 Hebrew sentences. EVERY sentence MUST contain a SPECIFIC TECHNIQUE CUE for ${data.exercise}.
- NEVER give generic praise like "עבודה טובה" or "תמשיך ככה" alone. ALWAYS add what to improve or maintain.
- Maximum 25 words total. Each sentence max 12 words — TTS engines cut long sentences.
- NO brackets, NO lists, NO bullet points, NO special characters. Write FLOWING spoken Hebrew only.
- NO parentheses or quotation marks. Write as if you're talking out loud.
- Reference EXACT joint angles from the data below when available. Example: "המרפק ב-95 מעלות, תנסה להגיע ל-75"
- Sound like a REAL Israeli coach. Use slang: יאללה, אחלה, ככה, בול, שריפה, אש.
- If form is good (goodFormPct > 70%) → name what's good + give next optimization target with numbers.
  Example: אש! הגב ישר ב-170 מעלות, עכשיו תנסה להוריד את המרפקים ל-90
- If form is bad (badFormPct > 40%) → name the EXACT issue + the fix with angle/distance.
  Example: יופי של אנרגיה! המרפק רק ב-120, תרד עוד קצת עד 90 מעלות
- If athlete is struggling → motivate + give ONE easy technique cue.
  Example: אתה אלוף! רק תשמור על הגב ישר ונשלים עוד שלוש
${data.disability && data.disability !== 'none' ? `- Athlete has disability: ${data.disability}. Be sensitive, adaptive, and celebrate every rep. Give disability-specific biomechanical cues.` : ''}

Return ONLY valid JSON: {"feedback":"Hebrew spoken coaching sentence","isUrgent":false}
isUrgent=true only for safety/critical form issues (fall risk, joint danger, equipment instability).`;

  const biomechanics = getBiomechanicsChecklist(data.exercise, data.sport);
  const anglesSection = data.jointAngles ? `\nCURRENT JOINT ANGLES: ${formatAngles(data.jointAngles)}` : '';
  const romSection = data.angleRanges?.min && Object.keys(data.angleRanges.min).length > 0
    ? `\nROM THIS WINDOW: deepest=${formatAngles(data.angleRanges.min)}, highest=${formatAngles(data.angleRanges.max)}`
    : '';

  const content = `Exercise: ${data.exercise}
Duration: ${data.duration}s
Reps: ${data.reps}/${data.targetReps} (set ${data.sets}/${data.targetSets})
Good form: ${data.goodFormPct}%, Bad form: ${data.badFormPct}%
Top issues: ${(data.topIssues || []).join(', ') || 'none'}
Skill level: ${data.skillLevel || 'intermediate'}${biomechanics ? `\n\nBIOMECHANICS CHECKLIST:\n${biomechanics}` : ''}${anglesSection}${romSection}${anglesSection || romSection ? '\nUse these EXACT angle numbers for quantitative coaching cues in Hebrew.' : ''}`;

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

Athlete: ${sanitizeInput(profile.name, 30) || 'Athlete'}, age ${Number(profile.age) || 25}, ${sanitizeInput(profile.disability, 20) || 'no disability'}
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

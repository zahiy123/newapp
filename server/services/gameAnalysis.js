import { callClaudeVision, extractJSON } from './claude.js';

// === VAR Single-Frame Analysis Prompts ===
const VAR_PROMPTS = {
  footballAmputee: `You are a VAR referee for an amputee football match, by the WAFF Laws of the Game (FIFA laws with these amendments).
Outfield players are leg amputees on forearm crutches (no prosthesis while playing); the goalkeeper is a single-arm amputee and must stay inside the goal area (10 m wide × 8 m deep). 60 × 40 m pitch, goals 5 × 2.2 m, NO OFFSIDE, kick-ins (kicked, not thrown).
CRUTCHES ARE PART OF THE ARMS: INTENTIONALLY controlling / directing / blocking the ball with a crutch (or a residual limb) = a handling offence (a direct free kick; by a defender inside his own goal area = a PENALTY). INCIDENTAL contact (the ball hits a still crutch, no control) is NOT an offence.
SLIDE TACKLES ARE NOT PERMITTED (a direct free kick + a yellow) — the goalkeeper may dive. A player who fell and plays the ball = an indirect free kick. Striking / tripping an opponent with a crutch = a foul (violent → red).
The goalkeeper ACTIVELY playing outside the goal area: 1st time a yellow + a direct free kick, 2nd time a red; an inadvertent step out (momentum, after releasing the ball) is not penalised.
Losing balance on crutches, falls and shoulder contact are ROUTINE — never a foul by themselves.`,

  football: `You are a VAR referee for a football (soccer) match.
Shoulder-to-shoulder contact is LEGAL. Sliding tackles are legal if ball is played first.
Only flag: dangerous tackles (studs up, from behind), deliberate handball, holding, pushing, elbowing.
Do NOT flag: shoulder challenges, 50/50 ball contests, incidental contact, diving.`,

  basketball: `You are a VAR referee for a basketball match.
Body contact in the paint/post area is NORMAL and routine.
Only flag: pushing, elbowing, tripping, holding, flagrant fouls, over-the-back.
Do NOT flag: incidental contact, box-out contact, normal screens, shooting fouls that are 50/50.`,

  basketballWheelchair: `You are a VAR referee for a wheelchair basketball match.
Wheelchair collisions and contact are ROUTINE and legal parts of the game.
Only flag: deliberately tipping opponent's wheelchair, reaching fouls (grabbing opponent's arm/wheelchair), holding the wheelchair.
Do NOT flag: wheelchair bumps, chair-to-chair contact, routine collisions, tipping from natural gameplay momentum.`,
};

const REFEREE_PROMPTS = {
  footballAmputee: `You are an expert amputee football referee analyzing game footage.
Rules: 7 players per team. Field players use forearm crutches and have lower limb amputations. NO prosthetics allowed during play.
No offside rule. Field is 60x40m. Goalkeeper has upper limb deficiency (one arm).
Fouls: crutch contact with opponent, dangerous crutch swings, tripping, handball (by field players), holding.
A goal is scored when the ball fully crosses the goal line between the posts.
Corners awarded when defending team last touches ball over their goal line.
Throw-ins when ball crosses sideline. Free kicks for fouls outside the penalty area.
Penalties for fouls inside the penalty area.
Identify teams by jersey color (Team A = lighter jerseys, Team B = darker jerseys, or describe by dominant color).`,

  football: `You are an expert football (soccer) referee analyzing game footage.
Standard FIFA rules: 11v11, offside rule applies, yellow and red cards.
Fouls: tripping, pushing, holding, handball (deliberate), dangerous play.
Goals, corners, throw-ins, free kicks, penalties, offsides.
Identify teams by jersey color (Team A = lighter, Team B = darker).`,

  basketball: `You are an expert basketball referee analyzing game footage.
Rules: 5v5, 2-point and 3-point field goals, free throws.
Violations: traveling, double dribble, backcourt, shot clock.
Fouls: personal fouls, charging, blocking, flagrant fouls.
Events: baskets (2pt/3pt), fouls, turnovers, blocks, steals.
Identify teams by jersey color (Team A = lighter, Team B = darker).`,

  basketballWheelchair: `You are an expert wheelchair basketball referee analyzing game footage.
Rules: 5v5 in wheelchairs. 2-point and 3-point field goals. Traveling = more than 2 pushes without dribbling.
Wheelchair contact is routine and legal. Fouls: reaching, holding opponent or wheelchair, deliberately tipping chair.
Events: baskets (2pt/3pt), fouls, turnovers, blocks, wheelchair tips.
Identify teams by jersey color (Team A = lighter, Team B = darker).`,
};

export async function analyzeGameFrames({ frames, sport, batchIndex, totalBatches, previousEvents }) {
  const sportKey = sport || 'football';
  const system = REFEREE_PROMPTS[sportKey] || REFEREE_PROMPTS.football;

  // Build content blocks: images interleaved with timestamp text
  const contentBlocks = [];

  for (const frame of frames) {
    contentBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: frame.data, // base64 string without data: prefix
      }
    });
    contentBlocks.push({
      type: 'text',
      text: `[Frame at ${formatTimestamp(frame.timestamp)}]`
    });
  }

  // Add analysis instruction
  const prevEventsText = previousEvents && previousEvents.length > 0
    ? `\nPrevious events detected (for context continuity):\n${JSON.stringify(previousEvents.slice(-10))}`
    : '';

  contentBlocks.push({
    type: 'text',
    text: `Analyze these ${frames.length} consecutive frames from a ${sportKey === 'footballAmputee' ? 'amputee football' : sportKey} match.
Batch ${batchIndex + 1} of ${totalBatches}.${prevEventsText}

Return ONLY a valid JSON array of detected events:
[{"type":"goal|foul|corner|throw_in|penalty|free_kick|offside|yellow_card|red_card|basket_2pt|basket_3pt|turnover|block",
  "timestamp": <seconds from video start>,
  "team": "A" or "B",
  "confidence": 0.0 to 1.0,
  "description_he": "תיאור קצר בעברית",
  "description_en": "Short English description"}]

Only report events with confidence >= 0.6. Return [] if no clear events are detected.
Do NOT guess or hallucinate events. Only report what you can clearly see in the frames.`
  });

  try {
    const text = await callClaudeVision(system, contentBlocks, 2048);
    const parsed = extractJSON(text);

    if (Array.isArray(parsed)) {
      return parsed.filter(e => e.confidence >= 0.6);
    }

    // Try to extract array from text
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const arr = JSON.parse(arrayMatch[0]);
        if (Array.isArray(arr)) return arr.filter(e => e.confidence >= 0.6);
      } catch {}
    }

    console.log('Game analysis: no events parsed from response');
    return [];
  } catch (err) {
    console.error('Game analysis error:', err.message);
    throw err;
  }
}

function formatTimestamp(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * VAR single-frame analysis — cheap, focused query.
 * Called only when local trigger detects suspected foul.
 * @returns {{ isFoul: boolean, reason: string }}
 */
export async function analyzeVARFrame({ frame, sport, triggerReason, teamContext, incident = null, offence = null }) {
  const sportKey = sport || 'football';
  const sportLabel = {
    football: 'football (soccer)',
    footballAmputee: 'amputee football',
    basketball: 'basketball',
    basketballWheelchair: 'wheelchair basketball',
  }[sportKey] || sportKey;

  const system = VAR_PROMPTS[sportKey] || VAR_PROMPTS.football;

  // the incident the assistant referee flagged (Stage 5): ask the VAR the RIGHT question for it
  const QUESTIONS = {
    goal: 'Did the WHOLE ball cross the goal line between the posts and under the crossbar? If the frame cannot show it, say so.',
    crutch_handball: 'Was the crutch used INTENTIONALLY to control / direct / block the ball (an offence), or was it incidental contact with a still crutch (not an offence)?',
    slide_tackle: 'Is this an outfield player SLIDING into a tackle (not permitted), or a fall / a loss of balance (routine)?',
    crutch_strike: 'Did a crutch strike or trip an opponent (a foul), or was it normal crutch placement?',
    gk_outside: 'Is the goalkeeper actively playing OUTSIDE the goal area (an offence), or an inadvertent step out?',
    fallen_play: 'Is a player who is DOWN on the ground playing the ball (an indirect free kick)?',
  };
  const question = QUESTIONS[offence] || QUESTIONS[incident] || '';
  const teamInfo = teamContext
    ? `Team context: Player A is on team ${teamContext.playerA}, Player B is on team ${teamContext.playerB}.`
    : '';

  const contentBlocks = [
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: frame },
    },
    {
      type: 'text',
      text: `This is a ${sportLabel} match on a neighborhood field.
A local detection system flagged a suspected incident: "${triggerReason}".
${teamInfo}

${question ? `THE QUESTION: ${question}\n` : ''}Analyze this frame carefully. Remember: falls and physical contact are ROUTINE in this sport.
Determine if this is truly an illegal foul or just clean/normal play.

Return ONLY valid JSON (no markdown, no explanation):
{"isFoul": true/false, "reason": "הסבר קצר בעברית"}`,
    },
  ];

  try {
    const text = await callClaudeVision(system, contentBlocks, 256);
    const parsed = extractJSON(text);
    if (parsed && typeof parsed.isFoul === 'boolean') {
      return parsed;
    }
    // Fallback: try to extract JSON from text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        if (typeof obj.isFoul === 'boolean') return obj;
      } catch {}
    }
    console.log('VAR analysis: could not parse response:', text.substring(0, 200));
    return { isFoul: false, reason: 'לא ניתן לנתח' };
  } catch (err) {
    console.error('VAR analysis error:', err.message);
    return { isFoul: false, reason: 'שגיאת ניתוח' };
  }
}

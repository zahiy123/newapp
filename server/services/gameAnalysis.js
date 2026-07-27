import { callClaudeVision, extractJSON } from './claude.js';

// === VAR Single-Frame Analysis Prompts ===
const VAR_PROMPTS = {
  footballAmputee: `You are a VAR referee for an amputee football match.
Players use forearm crutches with lower limb amputations. Losing balance on crutches is NORMAL and routine.
Only flag: deliberate crutch-to-body strikes, tripping with crutch, handball by field player, or dangerous high crutch swing near opponent's head.
Do NOT flag: routine falls, balance loss, shoulder contact, normal crutch placement.`,

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
export async function analyzeVARFrame({ frame, sport, triggerReason, teamContext }) {
  const sportKey = sport || 'football';
  const sportLabel = {
    football: 'football (soccer)',
    footballAmputee: 'amputee football',
    basketball: 'basketball',
    basketballWheelchair: 'wheelchair basketball',
  }[sportKey] || sportKey;

  const system = VAR_PROMPTS[sportKey] || VAR_PROMPTS.football;

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

Analyze this frame carefully. Remember: falls and physical contact are ROUTINE in this sport.
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

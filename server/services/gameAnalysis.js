import { callClaudeVision, extractJSON } from './claude.js';

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

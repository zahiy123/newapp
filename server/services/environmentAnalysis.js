import { callClaudeHaiku, extractJSON } from './claude.js';

const EMPTY_RESULT = {
  hazards: [],
  equipment: [],
  assistiveDevices: [],
  overallSafety: 'safe',
  adaptations: [],
};

// The AI check could not run / be parsed — must NOT be presented as "safe, no hazards"
const FAILED_RESULT = { ...EMPTY_RESULT, overallSafety: 'unknown', aiFailed: true };

/**
 * analyzeEnvironment — COCO + Claude Vision hybrid
 * Receives COCO detections + camera frame, sends to Claude Vision
 * for contextual safety/equipment analysis.
 */
export async function analyzeEnvironment({ frame, cocoDetections, profile, location }) {
  const objectList = (cocoDetections || [])
    .map(o => `${o.label} (confidence: ${Math.round((o.score || 0) * 100)}%)`)
    .join(', ');

  const system = `You are a sports training safety expert analyzing a training environment via camera.

Athlete profile:
- Name: ${profile?.name || 'Athlete'}
- Age: ${profile?.age || 25}
- Disability: ${profile?.disability || 'none'}
- Mobility aid: ${profile?.mobilityAid || 'none'}
- Sport: ${profile?.sport || 'fitness'}
- Training location: ${location || 'home'}

Objects detected by computer vision: ${objectList || 'none detected'}

The athlete is about to do a STANDING warm-up and exercises in front of the camera.
MOVEMENT ZONE = the floor area within about 1.5 m around the person (arm's reach to each side + a step forward/back).

TASKS:
1. HAZARDS — be thorough, this is a safety check:
   - Any object INSIDE the movement zone that the person could hit, trip over or fall onto IS a hazard:
     chairs, stools, tables, bags, boxes, shoes, cables, toys, bottles/cups on the floor, pets, glass items.
   - An object that could ALSO be used as equipment (e.g. a chair) is STILL a hazard if it is inside the movement zone —
     list it in "hazards" (you may also list it in "equipment").
   - If the person is SITTING on a chair/sofa/bench: report that seat as a hazard
     ("you are sitting on a chair — stand up and move it out of the movement area before the standing warm-up"),
     UNLESS the person uses a wheelchair (mobility aid: wheelchair).
   - Also: slippery or uneven floor, a low ceiling/lamp, sharp edges close by.
   - Objects clearly OUTSIDE the movement zone (far side of the room, against a distant wall) are NOT hazards.
   - Describe where it is without left/right (e.g. "right behind you", "next to you", "on the floor in front of you").
2. EQUIPMENT: objects that can substitute training equipment (chair→dips/step-ups, wall→wall-sits, bottle→light weight).
3. ASSISTIVE DEVICES: crutches, wheelchair, prosthetics, braces — even if not in the detections, look for them in the image.
4. Overall safety: "caution" if there is any hazard, "unsafe" only for a serious danger, otherwise "safe".

ALL text must be in Hebrew.

Keep it SHORT (this runs right before the workout): at most 4 hazards, each warning at most 12 words;
at most 2 equipment items; "adaptations" may be an empty list. "object" is the English object name.

Return ONLY valid JSON:
{
  "hazards": [{"object": "chair", "warning": "Hebrew warning with where it is"}],
  "equipment": [{"object": "name", "suggestion": "Hebrew suggestion for how to use it"}],
  "assistiveDevices": ["device name"],
  "overallSafety": "safe" | "caution" | "unsafe",
  "adaptations": []
}`;

  const contentBlocks = [];

  // Add camera frame if provided
  if (frame) {
    // frame is base64 JPEG
    const base64Data = frame.startsWith('data:') ? frame.split(',')[1] : frame;
    contentBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: base64Data,
      },
    });
  }

  contentBlocks.push({
    type: 'text',
    text: `Analyze this training environment. COCO detections: ${objectList || 'none'}. Provide safety analysis and equipment suggestions in Hebrew.`,
  });

  try {
    // Haiku vision: fast enough for the pre-workout scan's time limit; no retries (the client times out anyway)
    const text = await callClaudeHaiku(system, contentBlocks, 1200, 0);
    const parsed = extractJSON(text);
    if (parsed && parsed.overallSafety) return parsed;
    console.warn('Environment analysis: unparseable response');
    return FAILED_RESULT;
  } catch (err) {
    console.error('Environment analysis failed:', err.message);
    return FAILED_RESULT;
  }
}

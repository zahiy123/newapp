import { callClaudeVision, extractJSON } from './claude.js';

const EMPTY_RESULT = {
  hazards: [],
  equipment: [],
  assistiveDevices: [],
  overallSafety: 'safe',
  adaptations: [],
};

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

TASKS:
1. Identify HAZARDS: objects that could cause injury during exercise (sharp edges, slippery surfaces, obstacles in movement path, fragile items nearby)
2. Identify usable EQUIPMENT: objects that can substitute training equipment (chair→dips/step-ups, wall→wall-sits, bottle→light weight, table→incline push-ups)
3. Detect ASSISTIVE DEVICES: crutches, wheelchair, prosthetics, braces — even if not in COCO detections, look for them in the image
4. Overall safety assessment

ALL text must be in Hebrew.

Return ONLY valid JSON:
{
  "hazards": [{"object": "name", "warning": "Hebrew warning"}],
  "equipment": [{"object": "name", "suggestion": "Hebrew suggestion for how to use it"}],
  "assistiveDevices": ["device name"],
  "overallSafety": "safe" | "caution" | "unsafe",
  "adaptations": ["Hebrew adaptation suggestion based on what's available"]
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
    const text = await callClaudeVision(system, contentBlocks, 500, 1);
    const parsed = extractJSON(text);
    if (parsed && parsed.overallSafety) return parsed;
    return EMPTY_RESULT;
  } catch (err) {
    console.error('Environment analysis failed:', err.message);
    return EMPTY_RESULT;
  }
}

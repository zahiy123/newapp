import { Router } from 'express';
import { generateWeek, generateTips, analyzeMovement, generateWorkoutSummary, getLocalFallbackWeek, generateRealtimeFeedback, adaptWorkout } from '../services/claude.js';
import { analyzeGameFrames } from '../services/gameAnalysis.js';
import { analyzeEnvironment } from '../services/environmentAnalysis.js';

const router = Router();

// In-flight request tracking to prevent duplicates
const inFlight = new Set();

// Rate limiting for real-time endpoints
const rateLimits = new Map();

function shouldThrottle(key, minIntervalMs) {
  const now = Date.now();
  const last = rateLimits.get(key);
  if (last && now - last < minIntervalMs) return true;
  rateLimits.set(key, now);
  return false;
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, time] of rateLimits) {
    if (now - time > 300000) rateLimits.delete(key);
  }
}, 300000);

// Generate a single week
router.post('/training-week', async (req, res) => {
  const { profile, sport, goals, daysPerWeek, location, weekNumber } = req.body;
  const key = `${profile?.name}-w${weekNumber}`;

  if (inFlight.has(key)) {
    return res.status(429).json({ error: 'Request already in progress' });
  }
  inFlight.add(key);

  try {
    console.log('Generating week', weekNumber, 'for:', profile?.name);
    const week = await generateWeek({ profile, sport, goals, daysPerWeek, location, weekNumber, equipment: req.body.equipment });
    console.log('Week', weekNumber, 'generated successfully');
    res.json(week);
  } catch (error) {
    console.error('Week generation error:', error.message);
    // Double-layer fallback: return local template instead of 500
    console.log('Using route-level fallback for week', weekNumber);
    const fallback = getLocalFallbackWeek({ profile, sport, goals, daysPerWeek, location, weekNumber, equipment: req.body.equipment });
    res.json(fallback);
  } finally {
    inFlight.delete(key);
  }
});

// Generate tips
router.post('/training-tips', async (req, res) => {
  try {
    const { profile, sport, goals, location } = req.body;
    const tips = await generateTips({ profile, sport, goals, location });
    res.json(tips);
  } catch (error) {
    console.error('Tips error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/analyze-movement', async (req, res) => {
  try {
    const { exercise, poseData, sport } = req.body;
    const analysis = await analyzeMovement({ exercise, poseData, sport });
    res.json(analysis);
  } catch (error) {
    console.error('Movement analysis error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/workout-summary', async (req, res) => {
  try {
    const { profile, sessionData } = req.body;
    const summary = await generateWorkoutSummary({ profile, sessionData });
    res.json({ summary });
  } catch (error) {
    console.error('Workout summary error:', error.message);
    // Double-layer fallback: return a minimal template instead of 500
    const name = req.body?.profile?.name || 'שחקן';
    const exercises = req.body?.sessionData?.exercises || [];
    const completed = exercises.filter(e => (e.setsCompleted || 0) >= (e.setsTarget || 1)).length;
    const total = exercises.length;
    const fallback = `${name}, סיימת ${completed} מתוך ${total} תרגילים. ${completed === total ? 'כל הכבוד!' : 'בפעם הבאה ננסה לסיים הכל!'}`;
    res.json({ summary: fallback });
  }
});

router.post('/analyze-game-frames', async (req, res) => {
  try {
    const { frames, sport, batchIndex, totalBatches, previousEvents } = req.body;
    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: 'No frames provided' });
    }
    console.log(`Analyzing game batch ${batchIndex + 1}/${totalBatches} (${frames.length} frames, sport: ${sport})`);
    const events = await analyzeGameFrames({ frames, sport, batchIndex, totalBatches, previousEvents });
    console.log(`Batch ${batchIndex + 1}: ${events.length} events detected`);
    res.json({ events, batchIndex });
  } catch (error) {
    console.error('Game analysis error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// === REAL-TIME AI COACHING ===

// Rate-limited: 1 request per 15s per player+exercise
const realtimeInFlight = new Set();

router.post('/realtime-feedback', async (req, res) => {
  const { playerName, exercise } = req.body;
  const key = `rt-${playerName}-${exercise}`;

  if (shouldThrottle(key, 15000)) {
    return res.json({ feedback: '', isUrgent: false });
  }

  if (realtimeInFlight.has(key)) {
    return res.json({ feedback: '', isUrgent: false });
  }
  realtimeInFlight.add(key);

  try {
    const result = await generateRealtimeFeedback(req.body);
    res.json(result);
  } catch (error) {
    console.error('Realtime feedback error:', error.message);
    res.json({ feedback: '', isUrgent: false });
  } finally {
    realtimeInFlight.delete(key);
  }
});

// === ENVIRONMENT SCANNING ===

router.post('/analyze-environment', async (req, res) => {
  try {
    const { frame, cocoDetections, profile, location } = req.body;
    const analysis = await analyzeEnvironment({ frame, cocoDetections, profile, location });
    res.json(analysis);
  } catch (error) {
    console.error('Environment analysis error:', error.message);
    res.json({ hazards: [], equipment: [], assistiveDevices: [], overallSafety: 'safe', adaptations: [] });
  }
});

// === DYNAMIC WORKOUT ADAPTATION ===

// Rate-limited: 1 request per 2 minutes per user
router.post('/adapt-workout', async (req, res) => {
  const userName = req.body.profile?.name || 'unknown';
  const key = `adapt-${userName}`;

  if (shouldThrottle(key, 120000)) {
    return res.json({ adapted: false, plan: req.body.remainingPlan, reasoning: 'Rate limited' });
  }

  try {
    const result = await adaptWorkout(req.body);
    res.json(result);
  } catch (error) {
    console.error('Workout adaptation error:', error.message);
    res.json({ adapted: false, plan: req.body.remainingPlan, reasoning: 'Error' });
  }
});

export default router;

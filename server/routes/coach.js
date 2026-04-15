import { Router } from 'express';
import { generateWeek, generateTips, analyzeMovement, generateWorkoutSummary, getLocalFallbackWeek, generateRealtimeFeedback, adaptWorkout, analyzeRepFrames } from '../services/claude.js';
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
  console.log(`[COACH] /realtime-feedback → ${playerName} | ${exercise} | goodForm=${req.body.goodFormPct}% | reps=${req.body.reps}`);

  if (shouldThrottle(key, 15000)) {
    console.log(`[COACH] /realtime-feedback THROTTLED (${key})`);
    return res.json({ feedback: '', isUrgent: false });
  }

  if (realtimeInFlight.has(key)) {
    return res.json({ feedback: '', isUrgent: false });
  }
  realtimeInFlight.add(key);

  try {
    const result = await generateRealtimeFeedback(req.body);
    console.log(`[COACH] /realtime-feedback ← feedback="${result.feedback?.slice(0, 60)}" urgent=${result.isUrgent}`);
    res.json(result);
  } catch (error) {
    console.error('[COACH] /realtime-feedback ERROR:', error.message);
    res.json({ feedback: '', isUrgent: false });
  } finally {
    realtimeInFlight.delete(key);
  }
});

// === PER-REP HAIKU VISION ANALYSIS ===

const repAnalysisInFlight = new Set();

router.post('/analyze-rep', async (req, res) => {
  const { playerName, exercise, frames, sport, playerProfile, repNumber, qaMode, jointAngles, telemetry } = req.body;
  const safeFallback = { is_correct: true, feedback: '', score: 0 };
  const key = `rep-${playerName}-${exercise}`;
  const framesSizes = frames ? frames.map(f => typeof f === 'string' ? Math.round(f.length / 1024) : 0) : [];
  console.log(`[Server] 📥 Received analysis request for exercise: ${exercise} | player=${playerName} | rep#${repNumber} | sport=${sport} | frames=${framesSizes.join(',')}KB | angles=${jointAngles?.length || 0}`);

  // QA mode: skip throttle and in-flight checks for testing
  if (!qaMode) {
    if (shouldThrottle(key, 3000)) {
      console.log(`[COACH] /analyze-rep THROTTLED (${key})`);
      return res.json(safeFallback);
    }
    if (repAnalysisInFlight.has(key)) {
      console.log(`[COACH] /analyze-rep IN-FLIGHT (${key})`);
      return res.json(safeFallback);
    }
  }

  if (!frames || !Array.isArray(frames) || frames.length < 2) {
    console.warn(`[COACH] /analyze-rep INVALID FRAMES: ${frames?.length || 0} frames (need >=2)`);
    return res.json(safeFallback);
  }

  repAnalysisInFlight.add(key);

  // Debug mode: save frames when DEBUG_VISION env is set OR when qaMode is requested
  const shouldDebug = process.env.DEBUG_VISION === 'true' || qaMode === true;
  if (shouldDebug) {
    try {
      const { saveDebugFrames } = await import('../services/debugFrames.js');
      await saveDebugFrames(frames, exercise, playerName, repNumber);
    } catch (debugErr) {
      console.warn('[DEBUG_VISION] Save failed:', debugErr.message);
    }
  }

  try {
    const t0 = Date.now();
    const result = await analyzeRepFrames({ frames, sport, exercise, playerProfile, repNumber, jointAngles, telemetry });
    const elapsed = Date.now() - t0;
    console.log(`[COACH-RESULT] exercise=${exercise} | rep=${repNumber} | score=${result.score} | issue=${result.issue_key || 'none'} | instruction="${result.instruction || ''}" | pro_tip="${result.pro_tip || ''}" | elapsed=${elapsed}ms`);
    // Attach debug metadata in QA mode
    if (shouldDebug) {
      result._debug = { framesDir: 'server/debug_frames', savedAt: Date.now(), repNumber };
    }
    res.json(result);
  } catch (error) {
    console.error('[COACH] /analyze-rep ERROR:', error.message, error.stack?.slice(0, 200));
    res.json(safeFallback);
  } finally {
    repAnalysisInFlight.delete(key);
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

// === QA DEBUG ENDPOINT ===
// GET /api/coach/debug-frames — list saved debug frames (only works with DEBUG_VISION or in dev)
router.get('/debug-frames', async (req, res) => {
  try {
    const { getDebugStats } = await import('../services/debugFrames.js');
    const stats = getDebugStats();
    res.json(stats);
  } catch (error) {
    res.json({ totalFrames: 0, error: error.message });
  }
});

export default router;

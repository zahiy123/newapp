import { Router } from 'express';
import { generateWeek, generateTips, analyzeMovement, generateWorkoutSummary, getLocalFallbackWeek } from '../services/claude.js';
import { analyzeGameFrames } from '../services/gameAnalysis.js';

const router = Router();

// In-flight request tracking to prevent duplicates
const inFlight = new Set();

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

export default router;

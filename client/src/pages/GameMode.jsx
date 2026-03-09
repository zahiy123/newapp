import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useCamera } from '../hooks/useCamera';
import { useMultiPose } from '../hooks/useMultiPose';
import { useWhistle } from '../hooks/useWhistle';
import { useSpeech } from '../hooks/useSpeech';
import { useVideoFrames } from '../hooks/useVideoFrames';
import { GAME_SPORTS, FOUL_RULES, GAME_EVENT_TYPES, trackPlayers } from '../utils/gameRules';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '../utils/api';
import { db } from '../services/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import VideoAnalysisPlayer from '../components/VideoAnalysisPlayer';

const GAME_PHASE = {
  SETUP_SPORT: 'setup_sport',
  CHOOSE_MODE: 'choose_mode',
  SETUP_TEAMS: 'setup_teams',
  SCANNING: 'scanning',
  READY: 'ready',
  PLAYING: 'playing',
  HALF_TIME: 'half_time',
  FULL_TIME: 'full_time',
  VIDEO_UPLOAD: 'video_upload',
  VIDEO_ANALYZING: 'video_analyzing',
  VIDEO_REVIEW: 'video_review',
};

export default function GameMode() {
  const { t } = useTranslation();
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();
  const canvasRef = useRef(null);

  const lang = userProfile?.lang === 'en' ? 'en-US' : 'he-IL';
  const isHe = lang.startsWith('he');
  const playerName = userProfile?.name || '';

  const { videoRef, active: cameraActive, start: startCamera, stop: stopCamera } = useCamera();
  const { ready: poseReady, allPoses, playerCount, startLoop, stopLoop } = useMultiPose(canvasRef);
  const { shortWhistle, longWhistle, foulHorn, goalHorn, halfTimeWhistle } = useWhistle();
  const { speakPriority, stop: stopSpeech } = useSpeech(lang);
  const { extractBatch, getTotalBatches, progress: extractProgress, duration: videoDuration, abort: abortExtraction, reset: resetExtraction } = useVideoFrames();

  // Setup state
  const [gamePhase, setGamePhase] = useState(GAME_PHASE.SETUP_SPORT);
  const [selectedSport, setSelectedSport] = useState(null);
  const [playersPerTeam, setPlayersPerTeam] = useState(7);
  const [halfLength, setHalfLength] = useState(25);

  // Game state
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [currentHalf, setCurrentHalf] = useState(1);
  const [gameTimer, setGameTimer] = useState(0);
  const [gamePaused, setGamePaused] = useState(false);
  const gameTimerRef = useRef(null);
  const trackedPlayersRef = useRef([]);

  // Event log
  const [events, setEvents] = useState([]);

  // Foul detection throttle
  const lastFoulTimeRef = useRef(0);

  // Video upload state
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [analysisError, setAnalysisError] = useState(null);
  const abortControllerRef = useRef(null);

  const sportOptions = Object.values(GAME_SPORTS);

  // Start camera for scanning
  const handleStartScanning = useCallback(async () => {
    await startCamera();
    setTimeout(() => {
      if (videoRef.current) startLoop(videoRef.current);
    }, 500);
    setGamePhase(GAME_PHASE.SCANNING);

    speakPriority(
      isHe
        ? `${playerName}, כוון את המצלמה למגרש. אני מזהה שחקנים.`
        : `${playerName}, point the camera at the field. I'm detecting players.`,
      { rate: 1.1 }
    );
  }, [startCamera, startLoop, videoRef, speakPriority, isHe, playerName]);

  // Announce player count when it changes during scanning
  useEffect(() => {
    if (gamePhase !== GAME_PHASE.SCANNING) return;
    if (playerCount > 0) {
      setGamePhase(GAME_PHASE.READY);
    }
  }, [playerCount, gamePhase]);

  // Announce ready
  useEffect(() => {
    if (gamePhase === GAME_PHASE.READY && playerCount > 0) {
      speakPriority(
        isHe
          ? `אני רואה ${playerCount} שחקנים. מוכנים להתחיל?`
          : `I see ${playerCount} players. Ready to start?`,
        { rate: 1.1 }
      );
    }
  }, [gamePhase]);

  // Start game
  function handleStartGame() {
    setScoreA(0);
    setScoreB(0);
    setCurrentHalf(1);
    setGameTimer(0);
    setEvents([]);
    setGamePaused(false);
    setGamePhase(GAME_PHASE.PLAYING);

    longWhistle();
    speakPriority(
      isHe ? 'המשחק מתחיל! יאללה!' : 'Game starts! Let\'s go!',
      { rate: 1.3, pitch: 1.1 }
    );

    // Start game timer
    gameTimerRef.current = setInterval(() => {
      setGameTimer(prev => {
        const newTime = prev + 1;
        if (newTime >= halfLength * 60) {
          clearInterval(gameTimerRef.current);
          return newTime;
        }
        return newTime;
      });
    }, 1000);
  }

  // Check for half/full time
  useEffect(() => {
    if (gamePhase !== GAME_PHASE.PLAYING) return;
    if (gameTimer >= halfLength * 60) {
      clearInterval(gameTimerRef.current);
      if (currentHalf === 1) {
        setGamePhase(GAME_PHASE.HALF_TIME);
        halfTimeWhistle();
        speakPriority(
          isHe ? 'מחצית! תוצאה: ' + scoreA + ' - ' + scoreB : 'Half time! Score: ' + scoreA + ' - ' + scoreB,
          { rate: 1.1 }
        );
      } else {
        setGamePhase(GAME_PHASE.FULL_TIME);
        longWhistle();
        setTimeout(() => longWhistle(), 800);
        speakPriority(
          isHe ? 'סיום! התוצאה הסופית: ' + scoreA + ' - ' + scoreB : 'Full time! Final score: ' + scoreA + ' - ' + scoreB,
          { rate: 1.1 }
        );
      }
    }
  }, [gameTimer, gamePhase]);

  // Start second half
  function handleStartSecondHalf() {
    setCurrentHalf(2);
    setGameTimer(0);
    setGamePhase(GAME_PHASE.PLAYING);
    shortWhistle();
    speakPriority(
      isHe ? 'מחצית שנייה! יאללה!' : 'Second half! Let\'s go!',
      { rate: 1.3 }
    );
    gameTimerRef.current = setInterval(() => {
      setGameTimer(prev => {
        if (prev + 1 >= halfLength * 60) {
          clearInterval(gameTimerRef.current);
        }
        return prev + 1;
      });
    }, 1000);
  }

  // Pause/resume
  function handleTogglePause() {
    if (gamePaused) {
      setGamePaused(false);
      shortWhistle();
      gameTimerRef.current = setInterval(() => {
        setGameTimer(prev => {
          if (prev + 1 >= halfLength * 60) clearInterval(gameTimerRef.current);
          return prev + 1;
        });
      }, 1000);
    } else {
      setGamePaused(true);
      shortWhistle();
      clearInterval(gameTimerRef.current);
    }
  }

  // Add goal
  function addGoal(team) {
    if (team === 'A') setScoreA(prev => prev + 1);
    else setScoreB(prev => prev + 1);
    goalHorn();
    const time = formatTime(gameTimer);
    setEvents(prev => [...prev, {
      type: 'goal', team, time: gameTimer, timeStr: time,
      text: isHe ? `גול! קבוצה ${team === 'A' ? "א'" : "ב'"} - ${time}` : `Goal! Team ${team} - ${time}`
    }]);
    speakPriority(
      isHe ? `גול! קבוצה ${team === 'A' ? "א'" : "ב'"}!` : `Goal! Team ${team}!`,
      { rate: 1.3, pitch: 1.2 }
    );
  }

  // Add foul
  function addFoul(team, foulType) {
    foulHorn();
    const time = formatTime(gameTimer);
    const foulName = foulType || (isHe ? 'עבירה' : 'Foul');
    setEvents(prev => [...prev, {
      type: 'foul', team, time: gameTimer, timeStr: time,
      text: isHe ? `עבירה: ${foulName} - קבוצה ${team === 'A' ? "א'" : "ב'"} - ${time}` : `Foul: ${foulName} - Team ${team} - ${time}`
    }]);
    speakPriority(
      isHe ? `עבירה! ${foulName}!` : `Foul! ${foulName}!`,
      { rate: 1.25, pitch: 1.05 }
    );
  }

  // Live foul detection from poses
  useEffect(() => {
    if (gamePhase !== GAME_PHASE.PLAYING || gamePaused) return;
    if (allPoses.length < 2) return;

    const now = Date.now();
    if (now - lastFoulTimeRef.current < 5000) return; // 5s cooldown

    // Track players
    trackedPlayersRef.current = trackPlayers(trackedPlayersRef.current, allPoses);

    // Check foul rules
    const sportKey = selectedSport?.key || 'football';
    const rules = FOUL_RULES[sportKey] || [];

    for (const rule of rules) {
      const result = rule.detect(trackedPlayersRef.current);
      if (result) {
        lastFoulTimeRef.current = now;
        const foulName = isHe ? rule.name.he : rule.name.en;
        addFoul('?', foulName);
        break;
      }
    }
  }, [allPoses, gamePhase, gamePaused]);

  // Save game report to Firestore
  const [gameSaved, setGameSaved] = useState(false);

  async function saveGameReport(source = 'live') {
    if (!user || gameSaved) return;
    try {
      const goalEvents = events.filter(e => e.type === 'goal' || e.type === 'basket_2pt' || e.type === 'basket_3pt');
      const foulEvents = events.filter(e => e.type === 'foul');

      const videoScoreA = goalEvents.filter(e => e.team === 'A').length;
      const videoScoreB = goalEvents.filter(e => e.team === 'B').length;
      const finalScoreA = source === 'video_upload' ? videoScoreA : scoreA;
      const finalScoreB = source === 'video_upload' ? videoScoreB : scoreB;

      await addDoc(collection(db, 'users', user.uid, 'games'), {
        sport: selectedSport?.key || 'unknown',
        sportName: isHe ? selectedSport?.name?.he : selectedSport?.name?.en,
        date: serverTimestamp(),
        source,
        teamA: { score: finalScoreA },
        teamB: { score: finalScoreB },
        events: events.map(e => ({
          type: e.type,
          team: e.team,
          time: e.time || e.timestamp,
          timeStr: e.timeStr || formatTime(e.timestamp || 0),
          confidence: e.confidence,
        })),
        totalGoals: goalEvents.length,
        totalFouls: foulEvents.length,
        duration: source === 'video_upload' ? Math.floor(videoDuration) : gameTimer,
        halfLength,
        playersPerTeam,
        currentHalf,
      });
      setGameSaved(true);
    } catch (err) {
      console.error('Failed to save game report:', err);
    }
  }

  // End game
  function handleEndGame() {
    clearInterval(gameTimerRef.current);
    setGamePhase(GAME_PHASE.FULL_TIME);
    longWhistle();
    speakPriority(
      isHe ? 'המשחק הסתיים!' : 'Game over!',
      { rate: 1.1 }
    );
  }

  // Auto-save when reaching FULL_TIME
  useEffect(() => {
    if (gamePhase === GAME_PHASE.FULL_TIME && !gameSaved) {
      saveGameReport('live');
    }
  }, [gamePhase]);

  // Cleanup
  useEffect(() => {
    return () => {
      clearInterval(gameTimerRef.current);
      stopLoop();
      stopCamera();
      stopSpeech();
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, []);

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  // === VIDEO UPLOAD HANDLERS ===

  function handleVideoFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Size checks
    if (file.size > 1024 * 1024 * 1024) {
      setAnalysisError(t('game.videoBlocked'));
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      setAnalysisError(t('game.videoTooLarge'));
    } else {
      setAnalysisError(null);
    }

    setVideoFile(file);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(URL.createObjectURL(file));
  }

  async function handleStartVideoAnalysis() {
    if (!videoFile || !selectedSport) return;
    setGamePhase(GAME_PHASE.VIDEO_ANALYZING);
    setEvents([]);
    setAnalysisError(null);
    setGameSaved(false);
    resetExtraction();

    try {
      const { totalBatches } = await getTotalBatches(videoFile);
      setAnalysisProgress({ current: 0, total: totalBatches });

      let allEvents = [];
      abortControllerRef.current = new AbortController();

      for (let i = 0; i < totalBatches; i++) {
        if (abortControllerRef.current.signal.aborted) break;

        setAnalysisProgress({ current: i + 1, total: totalBatches });

        // Extract frames for this batch
        const { frames, aborted } = await extractBatch(videoFile, i);
        if (aborted || frames.length === 0) break;

        // Send to API
        try {
          const resp = await fetch(apiUrl('/api/coach/analyze-game-frames'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              frames,
              sport: selectedSport.key,
              batchIndex: i,
              totalBatches,
              previousEvents: allEvents.slice(-10),
            }),
            signal: abortControllerRef.current.signal,
          });

          if (!resp.ok) {
            console.error(`Batch ${i} failed: ${resp.status}`);
            // Retry once
            const retry = await fetch(apiUrl('/api/coach/analyze-game-frames'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                frames,
                sport: selectedSport.key,
                batchIndex: i,
                totalBatches,
                previousEvents: allEvents.slice(-10),
              }),
              signal: abortControllerRef.current.signal,
            });
            if (retry.ok) {
              const data = await retry.json();
              if (data.events?.length) {
                allEvents = [...allEvents, ...data.events];
                setEvents([...allEvents]);
              }
            }
            continue;
          }

          const data = await resp.json();
          if (data.events?.length) {
            allEvents = [...allEvents, ...data.events];
            setEvents([...allEvents]);
          }
        } catch (fetchErr) {
          if (fetchErr.name === 'AbortError') break;
          console.error(`Batch ${i} error:`, fetchErr.message);
          // Skip failed batch, continue with rest
        }
      }

      if (!abortControllerRef.current.signal.aborted) {
        setGamePhase(GAME_PHASE.VIDEO_REVIEW);
      }
    } catch (err) {
      console.error('Video analysis error:', err);
      setAnalysisError(err.message || t('game.analysisError'));
      setGamePhase(GAME_PHASE.VIDEO_UPLOAD);
    }
  }

  function handleCancelAnalysis() {
    abortControllerRef.current?.abort();
    abortExtraction();
    setGamePhase(GAME_PHASE.VIDEO_UPLOAD);
  }

  // Auto-save when video review is reached
  useEffect(() => {
    if (gamePhase === GAME_PHASE.VIDEO_REVIEW && !gameSaved && events.length > 0) {
      saveGameReport('video_upload');
    }
  }, [gamePhase]);

  // Helper: get event type info
  function getEventTypeInfo(type) {
    const sportKey = selectedSport?.key || 'football';
    const types = GAME_EVENT_TYPES[sportKey] || GAME_EVENT_TYPES.football;
    return types[type] || { color: '#6b7280', he: type, en: type };
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">{t('game.title')}</h1>
        <button onClick={() => { clearInterval(gameTimerRef.current); stopLoop(); stopCamera(); stopSpeech(); handleCancelAnalysis?.(); navigate('/'); }}
          className="text-sm text-gray-500 hover:text-red-500">
          {t('game.endGame')}
        </button>
      </div>

      {/* === SETUP: Sport Selection === */}
      {gamePhase === GAME_PHASE.SETUP_SPORT && (
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">{t('game.selectSport')}</h2>
          <div className="grid grid-cols-3 gap-3">
            {sportOptions.map(sport => (
              <button
                key={sport.key}
                onClick={() => {
                  setSelectedSport(sport);
                  setPlayersPerTeam(sport.playersPerTeam);
                  setHalfLength(sport.defaultHalfLength);
                  setGamePhase(GAME_PHASE.CHOOSE_MODE);
                }}
                className="p-4 rounded-xl border-2 border-gray-200 hover:border-blue-500 transition text-center space-y-2"
              >
                <div className="text-3xl">{sport.icon}</div>
                <div className="text-sm font-medium">{isHe ? sport.name.he : sport.name.en}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* === CHOOSE MODE: Live vs Video === */}
      {gamePhase === GAME_PHASE.CHOOSE_MODE && selectedSport && (
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">{t('game.chooseMode')}</h2>
          <div className="text-center text-4xl mb-2">{selectedSport.icon}</div>
          <p className="text-center text-gray-600">{isHe ? selectedSport.name.he : selectedSport.name.en}</p>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setGamePhase(GAME_PHASE.SETUP_TEAMS)}
              className="p-6 rounded-xl border-2 border-gray-200 hover:border-green-500 transition text-center space-y-3 group"
            >
              <div className="text-4xl group-hover:scale-110 transition-transform">&#127909;</div>
              <div className="font-bold text-gray-800">{t('game.liveGame')}</div>
              <p className="text-xs text-gray-500">{t('game.liveGameDesc')}</p>
            </button>

            <button
              onClick={() => { setVideoFile(null); setVideoPreviewUrl(null); setAnalysisError(null); setGamePhase(GAME_PHASE.VIDEO_UPLOAD); }}
              className="p-6 rounded-xl border-2 border-gray-200 hover:border-purple-500 transition text-center space-y-3 group"
            >
              <div className="text-4xl group-hover:scale-110 transition-transform">&#128229;</div>
              <div className="font-bold text-gray-800">{t('game.uploadVideo')}</div>
              <p className="text-xs text-gray-500">{t('game.uploadVideoDesc')}</p>
            </button>
          </div>

          <button
            onClick={() => setGamePhase(GAME_PHASE.SETUP_SPORT)}
            className="w-full text-sm text-gray-400 hover:text-gray-600 transition"
          >
            {isHe ? 'חזרה לבחירת ענף' : 'Back to sport selection'}
          </button>
        </div>
      )}

      {/* === VIDEO UPLOAD === */}
      {gamePhase === GAME_PHASE.VIDEO_UPLOAD && selectedSport && (
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">{t('game.uploadVideo')}</h2>
          <div className="text-center text-4xl mb-2">{selectedSport.icon}</div>

          {/* File input */}
          <label className="block">
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-purple-400 transition cursor-pointer">
              <div className="text-4xl mb-2">&#128193;</div>
              <p className="text-gray-600 font-medium">{t('game.selectVideo')}</p>
              <p className="text-xs text-gray-400 mt-1">.mp4, .webm, .mov</p>
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/*"
                onChange={handleVideoFileSelect}
                className="hidden"
              />
            </div>
          </label>

          {/* Error */}
          {analysisError && (
            <div className="bg-red-50 text-red-600 rounded-lg p-3 text-sm">
              {analysisError}
            </div>
          )}

          {/* Preview */}
          {videoPreviewUrl && (
            <div className="space-y-3">
              <video
                src={videoPreviewUrl}
                controls
                className="w-full rounded-xl bg-black"
                style={{ maxHeight: '300px' }}
              />
              <div className="text-sm text-gray-500 text-center">
                {videoFile?.name} ({(videoFile?.size / (1024 * 1024)).toFixed(1)} MB)
              </div>

              <button
                onClick={handleStartVideoAnalysis}
                disabled={videoFile?.size > 1024 * 1024 * 1024}
                className="w-full py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-lg font-bold text-lg hover:opacity-90 transition disabled:opacity-50"
              >
                {t('game.startAnalysis')} &#9654;
              </button>
            </div>
          )}

          <button
            onClick={() => setGamePhase(GAME_PHASE.CHOOSE_MODE)}
            className="w-full text-sm text-gray-400 hover:text-gray-600 transition"
          >
            {isHe ? 'חזרה' : 'Back'}
          </button>
        </div>
      )}

      {/* === VIDEO ANALYZING === */}
      {gamePhase === GAME_PHASE.VIDEO_ANALYZING && (
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-800 text-center">{t('game.analyzing')}</h2>

          {/* Progress bar */}
          <div className="space-y-2">
            <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-indigo-600 rounded-full transition-all duration-500"
                style={{ width: `${analysisProgress.total > 0 ? (analysisProgress.current / analysisProgress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-sm text-gray-500 text-center">
              {t('game.analysisBatch', { current: analysisProgress.current, total: analysisProgress.total })}
            </p>
          </div>

          {/* Live events appearing */}
          {events.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-600">
                {t('game.eventsDetected')}: {events.length}
              </h3>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {[...events].reverse().map((ev, i) => {
                  const info = getEventTypeInfo(ev.type);
                  return (
                    <div key={i} className="text-sm px-3 py-1.5 rounded flex items-center gap-2 bg-gray-50">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: info.color }} />
                      <span className="font-mono text-xs text-gray-400">{formatTime(ev.timestamp)}</span>
                      <span className="font-medium">{isHe ? info.he : info.en}</span>
                      <span className="text-gray-400 text-xs">
                        {isHe ? `קבוצה ${ev.team === 'A' ? "א'" : "ב'"}` : `Team ${ev.team}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button
            onClick={handleCancelAnalysis}
            className="w-full py-2 bg-red-100 text-red-600 rounded-lg font-medium hover:bg-red-200 transition"
          >
            {t('game.cancelAnalysis')}
          </button>
        </div>
      )}

      {/* === VIDEO REVIEW === */}
      {gamePhase === GAME_PHASE.VIDEO_REVIEW && (
        <div className="space-y-4">
          {/* Video player with timeline */}
          <VideoAnalysisPlayer
            videoFile={videoFile}
            events={events}
            sport={selectedSport?.key || 'football'}
            isHe={isHe}
          />

          {/* Game Report */}
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h2 className="text-xl font-bold text-gray-800 text-center">{t('game.gameReport')}</h2>

            {/* Score from detected goals */}
            {(() => {
              const goalTypes = ['goal', 'basket_2pt', 'basket_3pt'];
              const goalsA = events.filter(e => goalTypes.includes(e.type) && e.team === 'A').length;
              const goalsB = events.filter(e => goalTypes.includes(e.type) && e.team === 'B').length;
              return (
                <div className="text-center">
                  <div className="text-6xl font-bold text-gray-800">{goalsA} - {goalsB}</div>
                  <div className="flex justify-center gap-8 mt-2 text-sm text-gray-500">
                    <span>{t('game.teamA')}</span>
                    <span>{t('game.teamB')}</span>
                  </div>
                </div>
              );
            })()}

            {/* Event type counts */}
            <div className="grid grid-cols-3 gap-3 text-center">
              {Object.entries(
                events.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {})
              ).map(([type, count]) => {
                const info = getEventTypeInfo(type);
                return (
                  <div key={type} className="rounded-lg p-3" style={{ backgroundColor: info.color + '15' }}>
                    <div className="text-2xl font-bold" style={{ color: info.color }}>{count}</div>
                    <div className="text-xs text-gray-500">{isHe ? info.he : info.en}</div>
                  </div>
                );
              })}
            </div>

            {/* Event list */}
            {events.length > 0 && (
              <div>
                <h3 className="font-medium text-gray-700 mb-2">{isHe ? 'סיכום אירועים' : 'Event Summary'}</h3>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {events.map((ev, i) => {
                    const info = getEventTypeInfo(ev.type);
                    return (
                      <div key={i} className="text-sm px-3 py-1.5 rounded flex items-center gap-2 bg-gray-50">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: info.color }} />
                        <span className="font-mono text-xs text-gray-400">{formatTime(ev.timestamp)}</span>
                        <span className="font-medium">{isHe ? info.he : info.en}</span>
                        <span className="text-gray-400 text-xs">
                          {isHe ? `קבוצה ${ev.team === 'A' ? "א'" : "ב'"}` : `Team ${ev.team}`}
                        </span>
                        <span className="text-gray-400 text-xs ml-auto">
                          {isHe ? ev.description_he : ev.description_en}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {events.length === 0 && (
              <p className="text-center text-gray-400">{t('game.noEvents')}</p>
            )}

            {/* Save status */}
            {gameSaved && (
              <p className="text-center text-green-500 text-sm font-medium">
                {isHe ? 'הדו"ח נשמר!' : 'Report saved!'}
              </p>
            )}

            <button onClick={() => navigate('/')}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:opacity-90 transition">
              {t('training.backToPlan')}
            </button>
          </div>
        </div>
      )}

      {/* === SETUP: Teams (Live mode) === */}
      {gamePhase === GAME_PHASE.SETUP_TEAMS && selectedSport && (
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">{t('game.teamSetup')}</h2>
          <div className="text-center text-4xl mb-2">{selectedSport.icon}</div>
          <p className="text-center text-gray-600">{isHe ? selectedSport.name.he : selectedSport.name.en}</p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('game.playersPerTeam')}</label>
            <div className="flex gap-2">
              {[3, 4, 5, 6, 7, 8].map(n => (
                <button key={n} onClick={() => setPlayersPerTeam(n)}
                  className={`flex-1 py-3 rounded-lg text-sm font-bold border-2 transition ${
                    playersPerTeam === n ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200'
                  }`}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('game.halfLength')}</label>
            <div className="flex gap-2">
              {[5, 10, 15, 20, 25, 45].map(n => (
                <button key={n} onClick={() => setHalfLength(n)}
                  className={`flex-1 py-3 rounded-lg text-sm font-bold border-2 transition ${
                    halfLength === n ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200'
                  }`}>
                  {n}'
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleStartScanning}
            className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-bold text-lg hover:opacity-90 transition">
            {isHe ? 'סרוק מגרש' : 'Scan Field'} &#128247;
          </button>
        </div>
      )}

      {/* === Camera + Pose View === */}
      {(gamePhase === GAME_PHASE.SCANNING || gamePhase === GAME_PHASE.READY || gamePhase === GAME_PHASE.PLAYING || gamePhase === GAME_PHASE.HALF_TIME) && (
        <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted style={{ transform: 'scaleX(-1)' }} />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ transform: 'scaleX(-1)' }} />

          {/* Loading pose */}
          {!poseReady && cameraActive && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <div className="text-white text-center space-y-2">
                <div className="animate-spin inline-block w-8 h-8 border-4 border-white border-t-transparent rounded-full"></div>
                <p>{t('training.loadingPose')}</p>
              </div>
            </div>
          )}

          {/* Player count badge */}
          <div className="absolute top-3 left-3 bg-black/70 text-white px-3 py-1 rounded-full text-sm font-bold">
            {t('game.playersDetected')}: {playerCount}
          </div>

          {/* Scanning overlay */}
          {gamePhase === GAME_PHASE.SCANNING && playerCount === 0 && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <div className="text-white text-center space-y-3">
                <div className="animate-pulse text-4xl">&#128269;</div>
                <p className="text-lg">{t('game.scanPlayers')}</p>
                <p className="text-sm text-white/70">{t('game.noPlayersYet')}</p>
              </div>
            </div>
          )}

          {/* Ready overlay */}
          {gamePhase === GAME_PHASE.READY && (
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 p-6">
              <div className="text-center space-y-3">
                <p className="text-green-400 font-bold text-lg">{t('game.ready')}</p>
                <button onClick={handleStartGame}
                  className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-bold text-lg hover:opacity-90 transition">
                  {t('game.startGame')} &#9654;
                </button>
              </div>
            </div>
          )}

          {/* PLAYING: Scoreboard + Timer */}
          {gamePhase === GAME_PHASE.PLAYING && (
            <>
              {/* Scoreboard */}
              <div className="absolute top-3 right-3 bg-black/80 text-white rounded-xl px-4 py-2 text-center">
                <div className="text-xs text-white/60">{t('game.halfTime')} {currentHalf}</div>
                <div className="text-3xl font-bold">{scoreA} - {scoreB}</div>
                <div className="flex justify-between text-xs text-white/70 px-1">
                  <span>{t('game.teamA')}</span>
                  <span>{t('game.teamB')}</span>
                </div>
              </div>

              {/* Timer */}
              <div className="absolute bottom-3 right-3 bg-black/80 text-white rounded-xl px-4 py-2">
                <span className="text-2xl font-bold font-mono">{formatTime(gameTimer)}</span>
                {gamePaused && <span className="ml-2 text-yellow-400 text-sm animate-pulse">||</span>}
              </div>
            </>
          )}

          {/* Half time overlay */}
          {gamePhase === GAME_PHASE.HALF_TIME && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <div className="text-center space-y-4">
                <div className="text-4xl">&#9200;</div>
                <div className="text-white text-2xl font-bold">{t('game.halfTime')}</div>
                <div className="text-white text-5xl font-bold">{scoreA} - {scoreB}</div>
                <button onClick={handleStartSecondHalf}
                  className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-bold text-lg">
                  {isHe ? 'התחל מחצית שנייה' : 'Start Second Half'} &#9654;
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* === PLAYING: Controls === */}
      {gamePhase === GAME_PHASE.PLAYING && (
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => addGoal('A')}
              className="py-3 bg-red-500 text-white rounded-lg font-bold hover:bg-red-600 transition">
              {t('game.addGoal')} - {t('game.teamA')}
            </button>
            <button onClick={() => addGoal('B')}
              className="py-3 bg-blue-500 text-white rounded-lg font-bold hover:bg-blue-600 transition">
              {t('game.addGoal')} - {t('game.teamB')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => addFoul('A')}
              className="py-2 bg-yellow-500 text-white rounded-lg text-sm font-medium hover:bg-yellow-600 transition">
              {t('game.addFoul')} - {t('game.teamA')}
            </button>
            <button onClick={() => addFoul('B')}
              className="py-2 bg-yellow-500 text-white rounded-lg text-sm font-medium hover:bg-yellow-600 transition">
              {t('game.addFoul')} - {t('game.teamB')}
            </button>
          </div>
          <div className="flex gap-3">
            <button onClick={handleTogglePause}
              className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition">
              {gamePaused ? t('game.resumeGame') : t('game.pauseGame')}
            </button>
            <button onClick={handleEndGame}
              className="flex-1 py-2 bg-red-100 text-red-600 rounded-lg font-medium hover:bg-red-200 transition">
              {t('game.endGame')}
            </button>
          </div>
        </div>
      )}

      {/* === Event Log (Live mode) === */}
      {events.length > 0 && (gamePhase === GAME_PHASE.PLAYING || gamePhase === GAME_PHASE.HALF_TIME) && (
        <div className="bg-white rounded-xl shadow p-4">
          <h3 className="font-semibold text-gray-800 mb-2">{isHe ? 'אירועים' : 'Events'}</h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {[...events].reverse().map((ev, i) => (
              <div key={i} className={`text-sm px-3 py-1 rounded ${
                ev.type === 'goal' ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'
              }`}>
                <span className="font-mono text-xs mr-2">{ev.timeStr}</span>
                {ev.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === FULL TIME: Game Report (Live mode) === */}
      {gamePhase === GAME_PHASE.FULL_TIME && (
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="text-xl font-bold text-gray-800 text-center">{t('game.gameReport')}</h2>
          <div className="text-center">
            <div className="text-6xl font-bold text-gray-800">{scoreA} - {scoreB}</div>
            <div className="flex justify-center gap-8 mt-2 text-sm text-gray-500">
              <span>{t('game.teamA')}</span>
              <span>{t('game.teamB')}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-green-600">{events.filter(e => e.type === 'goal').length}</div>
              <div className="text-xs text-gray-500">{t('game.goal')}</div>
            </div>
            <div className="bg-yellow-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-yellow-600">{events.filter(e => e.type === 'foul').length}</div>
              <div className="text-xs text-gray-500">{t('game.foul')}</div>
            </div>
          </div>

          {events.length > 0 && (
            <div>
              <h3 className="font-medium text-gray-700 mb-2">{isHe ? 'סיכום אירועים' : 'Event Summary'}</h3>
              <div className="space-y-1">
                {events.map((ev, i) => (
                  <div key={i} className={`text-sm px-3 py-1 rounded ${
                    ev.type === 'goal' ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'
                  }`}>
                    <span className="font-mono text-xs mr-2">{ev.timeStr}</span>
                    {ev.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={() => navigate('/')}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:opacity-90 transition">
            {t('training.backToPlan')}
          </button>
        </div>
      )}
    </div>
  );
}

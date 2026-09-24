// ============================================================
// AnatomicScan — Smart Diagnostic Scan Page
//
// Walks the user through the full scan pipeline:
//   Calibration → Phase A (15s static) → Profile Form (with kinetic summary) → Phase B → Result
//
// Features:
//   - Camera auto-start on mount with permission error handling
//   - Hermetic calibration: ALL 33 landmarks must be at 0.6+ confidence
//   - Immediate auto-advance to Phase A on full body detection
//   - KineticAnalyzer auto-infers anatomy after Phase A
//   - Profile form shows kinetic summary + training-only fields
//   - Frame quality guard (pause on lost tracking)
//   - Full i18n support (Hebrew + English)
//   - Voice feedback via Web Speech API
//   - Saves scan results to Firestore on completion
// ============================================================

import { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCamera } from '../hooks/useCamera';
import { usePose } from '../hooks/usePose';
import { useEquipmentDetection } from '../hooks/useEquipmentDetection';
import { buildScanData } from '../engine/scan/ScanDataBuilder';
import { useAnatomicScan } from '../hooks/useAnatomicScan';
import { useSpeech } from '../hooks/useSpeech';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import AnatomyProfileForm from '../components/AnatomyProfileForm';


// Object detection throttle (ms) — only during Phase A
const OBJ_DETECT_INTERVAL_MS = 200;


export default function AnatomicScan({ onScanComplete }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { lang } = useLanguage();
  const { user, userProfile, refreshProfile } = useAuth();
  const isHe = lang === 'he';
  const speechLang = isHe ? 'he-IL' : 'en-US';
  const { speak, speakPriority, unlockAudio, playAchievementDing, stop: stopSpeech } = useSpeech(speechLang);

  // ---- Save state ----
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // ---- Failed state — blocks all voice output until user clicks Retry ----
  const [isFailed, setIsFailed] = useState(false);

  // ---- Correction mode — user picks the correct side ----
  const [showCorrectionPicker, setShowCorrectionPicker] = useState(false);

  // Persisted form data — survives back-navigation
  const savedFormDataRef = useRef(null);


  // ---- Camera & Pose ----
  const canvasRef = useRef(null);
  const {
    videoRef,
    active: cameraActive,
    error: cameraError,
    start: startCamera,
    stop: stopCamera,
  } = useCamera();

  const {
    ready: poseReady,
    landmarksRef,
    startLoop: startPoseLoop,
    stopLoop: stopPoseLoop,
  } = usePose(canvasRef, undefined, undefined, cameraActive);

  const {
    ready: objReady,
    detectForScan,
  } = useEquipmentDetection();

  // ---- Scan Pipeline ----
  const {
    start: startScan,
    stop: stopScan,
    reset: resetScan,
    feedFrame,
    submitUserAnswer,
    scanStatus,
    progress,
    currentInstruction,
    instructionHe,
    result,
    error: scanError,
    userQueries,
    qualityWarning,
    fullBodyWarning,
    missingBodyParts,
    calibrationInfo,
    setAnatomyProfile,
    confirmProfile,
    confirmDiagnosis,
    rejectDiagnosis,
    rejectWithCorrection,
    pauseScan,
    resumeScan,
    captureAndVerify,
    snapshot,
    verifying,
    verificationResult,
    missingFields,
    kineticProfile,
    kineticInferredProfile,
    visionDiagnosis,
    awaitingVision,
    awaitingConfirmation,
  } = useAnatomicScan({
    videoRef,
    userName: userProfile?.name || user?.displayName || null,
    onStatusChange: (status) => {
      if (status === 'complete' || status === 'error') {
        stopPoseLoop();
      }
    },
  });

  // ---- Auto-start camera on mount ----
  useEffect(() => {
    startCamera();
  }, [startCamera]);

  // ---- Bilingual instruction helper ----
  const displayInstruction = isHe ? (instructionHe || currentInstruction) : currentInstruction;

  // ---- rAF Bridge Loop ----
  const scanLoopRef = useRef(null);
  const objThrottleRef = useRef(0);
  const latestObjDetsRef = useRef(null);

  useEffect(() => {
    // Run rAF loop during calibration, scanning, and paused phases
    if (scanStatus !== 'scanning' && scanStatus !== 'calibrating' && scanStatus !== 'paused') return;

    function loop() {
      const landmarks = landmarksRef.current;
      if (landmarks) {
        // Async YOLO detection — store results in ref for next feedFrame
        if (objReady && videoRef.current) {
          const now = performance.now();
          if (now - objThrottleRef.current >= OBJ_DETECT_INTERVAL_MS) {
            objThrottleRef.current = now;
            detectForScan(videoRef.current).then(dets => {
              if (dets) latestObjDetsRef.current = dets;
            });
          }
        }
        // Pass latest detections (may be from previous async cycle)
        feedFrame(landmarks, latestObjDetsRef.current);
        latestObjDetsRef.current = null;
      }
      scanLoopRef.current = requestAnimationFrame(loop);
    }

    scanLoopRef.current = requestAnimationFrame(loop);

    return () => {
      if (scanLoopRef.current) {
        cancelAnimationFrame(scanLoopRef.current);
        scanLoopRef.current = null;
      }
    };
  }, [scanStatus, feedFrame, landmarksRef, objReady, detectForScan, videoRef, pauseScan, resumeScan]);

  // ---- Voice Feedback ----

  const lastSpokenRef = useRef({ status: 'idle', instruction: null, warning: false });

  useEffect(() => {
    if (scanStatus === 'error' && !isFailed) {
      setIsFailed(true);
      stopSpeech();
    }
  }, [scanStatus, isFailed, stopSpeech]);

  // Status change announcements
  useEffect(() => {
    if (isFailed) return;
    if (scanStatus === lastSpokenRef.current.status) return;
    const prev = lastSpokenRef.current.status;
    lastSpokenRef.current.status = scanStatus;
    lastSpokenRef.current.instruction = null;

    if (scanStatus === 'calibrating') {
      speakPriority(isHe ? 'הסריקה מתחילה. עמוד מול המצלמה' : 'Scan starting. Stand in front of the camera.');
    } else if (scanStatus === 'profile_input') {
      playAchievementDing();
      speakPriority(isHe ? 'ניתוח הושלם. מלא את הפרופיל שלך' : 'Analysis complete. Complete your profile.');
    } else if (scanStatus === 'complete') {
      playAchievementDing();
      speakPriority(t('scan.complete'));
    } else if (scanStatus === 'idle' && prev !== 'idle') {
      stopSpeech();
    }
  }, [scanStatus, isFailed, speakPriority, playAchievementDing, stopSpeech, t, isHe]);

  // Speak movement instructions during scanning
  useEffect(() => {
    if (isFailed || scanStatus !== 'scanning') return;
    const instrToSpeak = displayInstruction;
    if (instrToSpeak && instrToSpeak !== lastSpokenRef.current.instruction) {
      lastSpokenRef.current.instruction = instrToSpeak;
      speak(instrToSpeak);
    }
  }, [scanStatus, isFailed, displayInstruction, speak]);

  // Speak vision diagnosis result (or uncertainty warning)
  const lastVisionSpokenRef = useRef(null);
  useEffect(() => {
    if (isFailed || !awaitingConfirmation || !visionDiagnosis) return;
    // Only speak once per diagnosis
    const diagKey = visionDiagnosis.description_he || visionDiagnosis.description;
    if (diagKey === lastVisionSpokenRef.current) return;
    lastVisionSpokenRef.current = diagKey;

    // Always read out the diagnosis and ask for confirmation
    const desc = isHe ? visionDiagnosis.description_he : visionDiagnosis.description;
    if (desc) {
      speakPriority(isHe ? `אבחנתי: ${desc}` : `My diagnosis: ${desc}`);
      setTimeout(() => {
        speak(isHe ? 'האם זה מדויק?' : 'Is this accurate?');
      }, 2000);
    }
  }, [awaitingConfirmation, visionDiagnosis, isFailed, isHe, speakPriority, speak]);

  // Speak quality warnings
  useEffect(() => {
    if (isFailed) return;
    if (qualityWarning && !lastSpokenRef.current.warning) {
      lastSpokenRef.current.warning = true;
      speakPriority(t('scan.qualityLost'));
    } else if (!qualityWarning) {
      lastSpokenRef.current.warning = false;
    }
  }, [qualityWarning, isFailed, speakPriority, t]);

  // Speak full-body visibility warnings
  const lastFullBodyWarningRef = useRef(false);
  useEffect(() => {
    if (isFailed) return;
    if (fullBodyWarning && !lastFullBodyWarningRef.current) {
      lastFullBodyWarningRef.current = true;
      speakPriority(isHe
        ? 'כל הגוף חייב להיות גלוי. אנא התרחק מהמצלמה.'
        : 'Full body must be visible. Please step back from the camera.');
    } else if (!fullBodyWarning) {
      lastFullBodyWarningRef.current = false;
    }
  }, [fullBodyWarning, isFailed, speakPriority, isHe]);

  // ---- Snapshot + Verify + Save on completion ----
  const savedRef = useRef(false);
  useEffect(() => {
    if (scanStatus !== 'complete' || !result || !user || savedRef.current) return;

    savedRef.current = true;

    async function verifyAndSave() {
      setSaving(true);
      try {
        // 1. Capture snapshot + send for server verification
        const verification = await captureAndVerify(result, visionDiagnosis);

        // 2. Use verified scanData (with corrections applied) or fallback to local
        const verifiedScanData = verification?.scanData || buildScanData(result, visionDiagnosis);

        // 2b. Preserve ROM history — carry forward previous baselines
        const existingBaselines = userProfile?.scanData?.previousBaselines || [];
        const existingRom = userProfile?.scanData?.romBaseline || null;
        if (existingRom && verifiedScanData.romBaseline) {
          // Push old baseline into history (max 10)
          const history = [...existingBaselines, existingRom].slice(-10);
          verifiedScanData.previousBaselines = history;
        }

        // 3. Build save payload
        const saveData = {
          scanComplete: true,
          scanResult: result.passportFields,
          scanDate: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          scanData: verifiedScanData,
          scanVerification: {
            verified: verification?.verified ?? true,
            confidence: verification?.confidence ?? 0,
            corrections: verification?.corrections ?? null,
            description: verification?.description ?? '',
            description_he: verification?.description_he ?? '',
            fallback: verification?.fallback ?? false,
          },
        };
        if (result.anatomyProfile) {
          saveData.anatomyProfile = result.anatomyProfile;
        }
        if (result.kineticProfile) {
          saveData.kineticProfile = {
            overallPosture: result.kineticProfile.overallPosture,
            detectedProsthetics: result.kineticProfile.detectedProsthetics,
          };
        }
        if (result.anatomyClassification) {
          saveData.anatomyClassification = result.anatomyClassification;
        }

        // 4. Save to Firestore
        await setDoc(doc(db, 'users', user.uid), saveData, { merge: true });
        await refreshProfile();
        setSaved(true);
        onScanComplete?.();
        // Navigate to profile after brief delay
        setTimeout(() => navigate('/profile'), 2000);
      } catch (err) {
        console.error('Failed to verify/save scan results:', err);
      }
      setSaving(false);
    }

    verifyAndSave();
  }, [scanStatus, result, user, visionDiagnosis, captureAndVerify, refreshProfile, onScanComplete, navigate]);

  // ---- Actions ----
  const handleStart = useCallback(async () => {
    unlockAudio();
    if (!cameraActive) {
      await startCamera();
    }
    if (videoRef.current && poseReady) {
      startPoseLoop(videoRef.current);
    }
    // 100ms delay — give browser time to register the user gesture for TTS
    setTimeout(() => startScan(), 100);
  }, [unlockAudio, cameraActive, startCamera, videoRef, poseReady, startPoseLoop, startScan]);

  const handleStop = useCallback(() => {
    stopScan();
    stopPoseLoop();
    stopSpeech();
    setIsFailed(false);
    savedFormDataRef.current = null;
    lastSpokenRef.current = { status: 'idle', instruction: null, warning: false };
  }, [stopScan, stopPoseLoop, stopSpeech]);

  const handleReset = useCallback(() => {
    resetScan();
    stopSpeech();
    setIsFailed(false);
    savedFormDataRef.current = null;
    savedRef.current = false;
    setSaved(false);
    setSaving(false);
    lastSpokenRef.current = { status: 'idle', instruction: null, warning: false };
  }, [resetScan, stopSpeech]);

  // Confirm vision diagnosis → stop everything, verify, save, navigate to profile
  const handleConfirmAndFinish = useCallback(async () => {
    // 1. Stop scan, pose loop, and speech
    stopScan();
    stopPoseLoop();
    stopSpeech();

    // 2. Save vision diagnosis data to Firestore — no flips, AI already reports correct side
    if (user && visionDiagnosis) {
      setSaving(true);
      try {
        const cls = visionDiagnosis.classification || 'NATURAL';
        const side = (visionDiagnosis.prostheticSide || '').toLowerCase() || null;
        const aidsList = visionDiagnosis.aids || [];

        // Map classification → profile fields
        const classMap = {
          TRANSFEMORAL_AMPUTEE: 'one_leg', TRANSTIBIAL_AMPUTEE: 'one_leg',
          BILATERAL_AMPUTEE: 'two_legs', ARM_AMPUTEE: 'one_arm',
          WHEELCHAIR: 'other', MEDICAL: 'other', NATURAL: 'none',
        };
        const levelMap = { TRANSFEMORAL_AMPUTEE: 'above_knee', TRANSTIBIAL_AMPUTEE: 'below_knee' };
        const mobilityAid = visionDiagnosis.mobilityAid || 'none';

        // Capture snapshot + verify with server
        const verification = await captureAndVerify(result, visionDiagnosis);
        const verifiedScanData = verification?.scanData || buildScanData(result, visionDiagnosis);

        // Preserve ROM history — carry forward previous baselines
        const existingBaselines = userProfile?.scanData?.previousBaselines || [];
        const existingRom = userProfile?.scanData?.romBaseline || null;
        if (existingRom && verifiedScanData.romBaseline) {
          const history = [...existingBaselines, existingRom].slice(-10);
          verifiedScanData.previousBaselines = history;
        }

        console.log('[ScanConfirm] Saving — classification:', cls, 'side:', side, 'mobilityAid:', mobilityAid);

        const saveData = {
          scanComplete: true,
          scanDate: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          disability: classMap[cls] || 'none',
          amputationSide: side || 'none',
          amputationLevel: levelMap[cls] || '',
          mobilityAid,
          visionDiagnosis: {
            classification: cls,
            adaptedTrack: visionDiagnosis.adaptedTrack,
            prostheticSide: side,
            aids: aidsList,
            confidence: visionDiagnosis.confidence,
            description: visionDiagnosis.description,
            description_he: visionDiagnosis.description_he,
            specialProtocol: visionDiagnosis.specialProtocol,
          },
          scanData: verifiedScanData,
          scanVerification: {
            verified: verification?.verified ?? true,
            confidence: verification?.confidence ?? 0,
            corrections: verification?.corrections ?? null,
            description: verification?.description ?? '',
            description_he: verification?.description_he ?? '',
            fallback: verification?.fallback ?? false,
          },
        };
        await setDoc(doc(db, 'users', user.uid), saveData, { merge: true });
        await refreshProfile();
        setSaved(true);
      } catch (err) {
        console.error('Failed to save scan results:', err);
      }
      setSaving(false);
    }

    // 3. Navigate to profile
    setTimeout(() => navigate('/profile'), 1500);
  }, [stopScan, stopPoseLoop, stopSpeech, user, result, visionDiagnosis, captureAndVerify, refreshProfile, navigate]);

  const handleRetryCamera = useCallback(() => {
    startCamera();
  }, [startCamera]);

  // ---- Start pose loop once camera is ready ----
  useEffect(() => {
    if (cameraActive && poseReady && videoRef.current &&
        (scanStatus === 'scanning' || scanStatus === 'calibrating')) {
      startPoseLoop(videoRef.current);
    }
  }, [cameraActive, poseReady, videoRef, scanStatus, startPoseLoop]);

  // ---- Cleanup on unmount ----
  useEffect(() => {
    return () => {
      stopCamera();
      stopPoseLoop();
      stopSpeech();
    };
  }, [stopCamera, stopPoseLoop, stopSpeech]);


  // ---- Render ----
  const progressPercent = Math.round(progress * 100);
  const hasCameraPermissionError = cameraError && scanStatus === 'idle';

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>{t('scan.title')}</h1>

      {/* Video + canvas overlay for live pose visualization */}
      <div style={{
        ...styles.videoContainer,
        ...(cameraActive ? {} : styles.videoContainerHidden),
      }}>
        <video
          ref={videoRef}
          style={styles.video}
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          style={styles.canvasOverlay}
        />

        {/* Quality warning overlay */}
        {qualityWarning && (
          <div style={styles.qualityOverlay}>
            <p style={styles.qualityText}>{t('scan.qualityLost')}</p>
          </div>
        )}

        {/* Full-body visibility warning overlay */}
        {fullBodyWarning && !qualityWarning && (
          <div style={styles.fullBodyOverlay}>
            <p style={styles.fullBodyText}>
              {isHe
                ? 'כל הגוף חייב להיות גלוי! התרחק מהמצלמה.'
                : 'Full body must be visible! Step back from the camera.'}
            </p>
            {missingBodyParts && missingBodyParts.length > 0 && (
              <p style={styles.fullBodyMissing}>
                {isHe ? 'חסר: ' : 'Missing: '}
                {missingBodyParts.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Camera permission error */}
      {hasCameraPermissionError && (
        <div style={styles.center}>
          <div style={styles.cameraErrorCard}>
            <p style={styles.cameraErrorText}>{t('scan.cameraPermission')}</p>
            <p style={styles.cameraErrorDetail}>{cameraError}</p>
            <button onClick={handleRetryCamera} style={styles.button}>
              {t('scan.cameraRetry')}
            </button>
          </div>
        </div>
      )}

      {/* IDLE — Start button */}
      {scanStatus === 'idle' && !hasCameraPermissionError && (
        <div style={styles.center}>
          <p style={styles.description}>
            {t('scan.description')}
          </p>
          <button onClick={handleStart} style={styles.button}>
            {t('scan.startScan')}
          </button>
        </div>
      )}

      {/* CALIBRATING — Single message + landmark counter */}
      {scanStatus === 'calibrating' && (
        <div style={styles.center}>
          <div style={styles.calibratingPulse}>
            <p style={styles.instruction}>{displayInstruction}</p>
          </div>
          {calibrationInfo && (
            <div style={styles.calibrationDebug}>
              <p style={styles.calibrationCount}>
                {isHe
                  ? `זוהו ${calibrationInfo.visibleCount}/${calibrationInfo.totalRequired} נקודות`
                  : `Detected ${calibrationInfo.visibleCount}/${calibrationInfo.totalRequired} landmarks`}
              </p>
              <div style={styles.calibrationBar}>
                <div
                  style={{
                    ...styles.calibrationBarFill,
                    width: `${(calibrationInfo.visibleCount / calibrationInfo.totalRequired) * 100}%`,
                    backgroundColor: calibrationInfo.visibleCount === calibrationInfo.totalRequired ? '#4caf50' : '#ff9800',
                  }}
                />
              </div>
            </div>
          )}
          <button onClick={handleStop} style={styles.buttonSecondary}>
            {t('scan.cancel')}
          </button>
        </div>
      )}

      {/* PROFILE_INPUT — Kinetic summary + Training profile form (after Phase A) */}
      {scanStatus === 'profile_input' && (
        <div style={styles.center}>
          <AnatomyProfileForm
            existingProfile={userProfile}
            missingFields={missingFields}
            isHe={isHe}
            savedFormData={savedFormDataRef.current}
            onFormChange={(data) => { savedFormDataRef.current = data; }}
            onBack={handleStop}
            onReset={handleStop}
            kineticProfile={kineticProfile}
            kineticInferredProfile={kineticInferredProfile}
            onSubmit={async (profileData) => {
              console.log('[AnatomicScan] Profile submitted:', profileData);
              setAnatomyProfile(profileData);
              confirmProfile();
              // Save profile to Firestore
              try {
                await setDoc(doc(db, 'users', user.uid), {
                  ...profileData,
                  updatedAt: new Date().toISOString(),
                }, { merge: true });
                await refreshProfile();
              } catch (err) {
                console.error('Failed to save anatomy profile:', err);
              }
            }}
          />
        </div>
      )}

      {/* SCANNING — Progress + instruction */}
      {scanStatus === 'scanning' && !awaitingVision && !awaitingConfirmation && (
        <div style={styles.center}>
          <p style={styles.instruction}>{displayInstruction}</p>
          <div style={styles.progressBar}>
            <div
              style={{ ...styles.progressFill, width: `${progressPercent}%` }}
            />
          </div>
          <p style={styles.progressText}>{progressPercent}%</p>
          <button onClick={handleStop} style={styles.buttonSecondary}>
            {t('scan.cancel')}
          </button>
        </div>
      )}

      {/* VISION DIAGNOSIS — Awaiting AI analysis */}
      {scanStatus === 'scanning' && awaitingVision && (
        <div style={styles.center}>
          <div style={styles.visionAnalyzingCard}>
            <div style={styles.visionSpinner} />
            <p style={styles.visionAnalyzingText}>
              {isHe ? 'מנתח את גופך באמצעות ראייה ממוחשבת...' : 'Analyzing your body with AI vision...'}
            </p>
          </div>
        </div>
      )}

      {/* VISION DIAGNOSIS — Awaiting user confirmation (HARD GATE) */}
      {scanStatus === 'scanning' && awaitingConfirmation && visionDiagnosis && (
        <div style={styles.visionOverlay}>
          <div style={styles.visionCard}>
            <h2 style={styles.visionTitle}>
              {isHe ? 'אבחון אנטומי' : 'Anatomical Diagnosis'}
            </h2>
            <p style={styles.visionDescription}>
              {isHe ? visionDiagnosis.description_he : visionDiagnosis.description}
            </p>
            {visionDiagnosis.aids && visionDiagnosis.aids.length > 0 && (
              <p style={styles.visionAids}>
                {isHe ? 'עזרים שזוהו: ' : 'Aids detected: '}
                {visionDiagnosis.aids.join(', ')}
              </p>
            )}
            {visionDiagnosis.kineticAgreement !== undefined && (
              <p style={{
                ...styles.visionKinetic,
                color: visionDiagnosis.kineticAgreement ? '#4caf50' : '#ff9800',
              }}>
                {visionDiagnosis.kineticAgreement
                  ? (isHe ? 'ניתוח תנועה מאשר את האבחנה' : 'Movement analysis confirms diagnosis')
                  : (isHe ? 'ניתוח תנועה שונה מהאבחנה החזותית' : 'Movement analysis differs from visual diagnosis')}
              </p>
            )}
            <p style={styles.visionQuestion}>
              {isHe ? 'האם האבחנה מדויקת?' : 'Is this diagnosis accurate?'}
            </p>
            {!showCorrectionPicker ? (
              <div style={styles.visionButtons}>
                <button onClick={handleConfirmAndFinish} style={styles.visionConfirmBtn}>
                  {isHe ? 'מאשר' : 'Confirm'}
                </button>
                <button onClick={() => { pauseScan(); setShowCorrectionPicker(true); }} style={styles.visionRejectBtn}>
                  {isHe ? 'דווח על טעות' : 'Report Error'}
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#333' }}>
                  {isHe ? 'באיזה צד הקטיעה/פרוטזה?' : 'Which side is the amputation/prosthetic?'}
                </p>
                <div style={styles.visionButtons}>
                  <button
                    onClick={() => { setShowCorrectionPicker(false); rejectWithCorrection('left'); }}
                    style={{ ...styles.visionConfirmBtn, backgroundColor: '#1976d2' }}
                  >
                    {isHe ? 'רגל שמאל' : 'Left leg'}
                  </button>
                  <button
                    onClick={() => { setShowCorrectionPicker(false); rejectWithCorrection('right'); }}
                    style={{ ...styles.visionConfirmBtn, backgroundColor: '#1976d2' }}
                  >
                    {isHe ? 'רגל ימין' : 'Right leg'}
                  </button>
                  <button
                    onClick={() => { setShowCorrectionPicker(false); rejectDiagnosis(); }}
                    style={styles.buttonSecondary}
                  >
                    {isHe ? 'ביטול' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AWAITING USER — Questions */}
      {scanStatus === 'awaiting_user' && userQueries && (
        <div style={styles.center}>
          <h2 style={styles.subtitle}>{t('scan.helpTitle')}</h2>
          {userQueries.map((q) => (
            <div key={q.limb} style={styles.queryCard}>
              <p>{q.context}</p>
              <div style={styles.queryButtons}>
                <button
                  onClick={() =>
                    submitUserAnswer(q.limb, {
                      status: 'prosthetic_below_knee',
                      description: isHe ? 'פרוטזה מתחת לברך' : 'Below-knee prosthetic',
                    })
                  }
                  style={styles.button}
                >
                  {t('scan.prosthetic')}
                </button>
                <button
                  onClick={() =>
                    submitUserAnswer(q.limb, {
                      status: 'anatomical_healthy',
                      description: isHe ? 'גפה בריאה' : 'Healthy limb',
                    })
                  }
                  style={styles.button}
                >
                  {t('scan.healthy')}
                </button>
                <button
                  onClick={() =>
                    submitUserAnswer(q.limb, {
                      status: 'anatomical_weak',
                      description: isHe ? 'חלש / מוגבלות תנועה' : 'Weak / limited mobility',
                    })
                  }
                  style={styles.buttonSecondary}
                >
                  {t('scan.weakLimited')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* COMPLETE — Results */}
      {scanStatus === 'complete' && result && (
        <div style={styles.center}>
          <h2 style={styles.subtitle}>{t('scan.complete')}</h2>

          {/* Verification status */}
          {verifying && (
            <div style={styles.verifyingCard}>
              <div style={styles.visionSpinner} />
              <p style={styles.verifyingText}>
                {isHe ? 'מאמת תוצאות סריקה...' : 'Verifying scan results...'}
              </p>
            </div>
          )}
          {verificationResult && !verifying && (
            <div style={{
              ...styles.verificationBadge,
              backgroundColor: verificationResult.verified ? '#e8f5e9' : '#fff3e0',
              borderColor: verificationResult.verified ? '#4caf50' : '#ff9800',
            }}>
              <span style={{
                ...styles.verificationIcon,
                color: verificationResult.verified ? '#4caf50' : '#ff9800',
              }}>
                {verificationResult.verified ? '\u2713' : '\u26A0'}
              </span>
              <span style={styles.verificationLabel}>
                {verificationResult.verified
                  ? (isHe ? 'אומת בהצלחה' : 'Verified')
                  : (isHe ? 'נדרשת בדיקה נוספת' : 'Needs review')}
                {verificationResult.fallback
                  ? (isHe ? ' (מקומי)' : ' (local)')
                  : ` (${Math.round((verificationResult.confidence || 0) * 100)}%)`}
              </span>
            </div>
          )}

          {saving && <p style={styles.savingText}>{t('scan.savingResult')}</p>}
          {saved && <p style={styles.savedText}>{t('scan.savedResult')}</p>}

          <div style={styles.resultGrid}>
            {Object.entries(result.passportFields).map(([limb, fields]) => (
              fields && (
                <div key={limb} style={styles.limbCard}>
                  <h3 style={styles.limbName}>{formatLimb(limb, t)}</h3>
                  <p>{t('scan.status')}: <strong>{fields.status}</strong></p>
                  <p>{t('scan.stiffness')}: {fields.stiffness_profile || 'N/A'}</p>
                  <p>{t('scan.rom')}: {fields.range_of_motion || 'N/A'}</p>
                </div>
              )
            ))}
          </div>
          <p style={styles.meta}>
            {t('scan.duration')}: {result.scanDuration?.toFixed(1)}s | {t('scan.frames')}: {result.totalFrames}
          </p>
          <button onClick={handleReset} style={styles.button}>
            {t('scan.newScan')}
          </button>
        </div>
      )}

      {/* PAUSED — show resume + reset buttons */}
      {scanStatus === 'paused' && (
        <div style={styles.center}>
          <div style={styles.pausedCard}>
            <p style={styles.pausedTitle}>
              {isHe ? 'הסריקה הושהתה' : 'Scan Paused'}
            </p>
            <p style={styles.pausedDesc}>
              {isHe
                ? 'תקן את הבעיה ולחץ המשך. כל הנתונים שנאספו נשמרים.'
                : 'Fix the issue and press Resume. All collected data is preserved.'}
            </p>
            <div style={styles.visionButtons}>
              <button onClick={resumeScan} style={styles.visionConfirmBtn}>
                {isHe ? 'המשך סריקה' : 'Resume Scan'}
              </button>
              <button onClick={handleReset} style={styles.buttonSecondary}>
                {isHe ? 'התחל מחדש' : 'Start Over'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ERROR — show reset button only, no failure message */}
      {scanStatus === 'error' && (
        <div style={styles.center}>
          <button onClick={handleReset} style={styles.button}>
            {t('scan.tryAgain')}
          </button>
        </div>
      )}
    </div>
  );
}


// ---- Helpers ----

function formatLimb(key, t) {
  const map = {
    left_leg: t('scan.leftLeg'),
    right_leg: t('scan.rightLeg'),
    left_arm: t('scan.leftArm'),
    right_arm: t('scan.rightArm'),
  };
  return map[key] || key;
}


// ---- Inline Styles ----

const styles = {
  container: {
    maxWidth: 700,
    margin: '0 auto',
    padding: 24,
    fontFamily: 'system-ui, sans-serif',
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 22,
    fontWeight: 600,
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: '#555',
    marginBottom: 24,
    lineHeight: 1.5,
  },
  center: {
    textAlign: 'center',
    marginTop: 24,
  },
  videoContainer: {
    position: 'relative',
    width: '100%',
    maxWidth: 640,
    margin: '0 auto',
    borderRadius: 12,
    overflow: 'hidden',
    border: '2px solid #333',
    backgroundColor: '#000',
    aspectRatio: '4 / 3',
  },
  videoContainerHidden: {
    height: 0,
    overflow: 'hidden',
    border: 'none',
    margin: 0,
  },
  video: {
    width: '100%',
    display: 'block',
    transform: 'scaleX(-1)',
  },
  canvasOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    transform: 'scaleX(-1)',
  },
  instruction: {
    fontSize: 20,
    fontWeight: 600,
    margin: '24px 0 16px',
    minHeight: 60,
  },
  progressBar: {
    width: '100%',
    height: 12,
    backgroundColor: '#e0e0e0',
    borderRadius: 6,
    overflow: 'hidden',
    margin: '8px 0',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4caf50',
    borderRadius: 6,
    transition: 'width 0.1s ease',
  },
  progressText: {
    fontSize: 14,
    color: '#888',
    marginBottom: 16,
  },
  button: {
    padding: '12px 32px',
    fontSize: 16,
    fontWeight: 600,
    backgroundColor: '#1976d2',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    margin: 8,
  },
  buttonSecondary: {
    padding: '10px 24px',
    fontSize: 14,
    fontWeight: 500,
    backgroundColor: '#f5f5f5',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: 8,
    cursor: 'pointer',
    margin: 8,
  },
  queryCard: {
    padding: 20,
    margin: '16px 0',
    border: '1px solid #ddd',
    borderRadius: 12,
    textAlign: 'left',
  },
  queryButtons: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  resultGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 16,
    margin: '16px 0',
    textAlign: 'left',
  },
  limbCard: {
    padding: 16,
    border: '1px solid #ddd',
    borderRadius: 10,
    backgroundColor: '#fafafa',
  },
  limbName: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 8,
    textTransform: 'capitalize',
  },
  meta: {
    fontSize: 13,
    color: '#999',
    margin: '16px 0',
  },
  error: {
    color: '#d32f2f',
    fontWeight: 500,
    margin: '16px 0',
  },
  cameraErrorCard: {
    padding: 24,
    margin: '24px auto',
    maxWidth: 400,
    border: '2px solid #ff9800',
    borderRadius: 12,
    backgroundColor: '#fff3e0',
  },
  cameraErrorText: {
    fontSize: 18,
    fontWeight: 600,
    color: '#e65100',
    marginBottom: 8,
  },
  cameraErrorDetail: {
    fontSize: 13,
    color: '#bf360c',
    marginBottom: 16,
  },
  calibratingPulse: {
    animation: 'pulse 2s ease-in-out infinite',
    padding: '24px 0',
  },
  qualityOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(211, 47, 47, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  qualityText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 700,
    textAlign: 'center',
    padding: 16,
  },
  calibrationDebug: {
    margin: '16px auto',
    padding: 16,
    maxWidth: 400,
    border: '1px solid #ddd',
    borderRadius: 10,
    backgroundColor: '#fafafa',
  },
  calibrationCount: {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 8,
  },
  calibrationBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  calibrationBarFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.15s ease, background-color 0.15s ease',
  },
  savingText: {
    fontSize: 14,
    color: '#1976d2',
    marginBottom: 8,
  },
  savedText: {
    fontSize: 14,
    color: '#4caf50',
    fontWeight: 600,
    marginBottom: 8,
  },
  // Vision Diagnosis styles
  visionOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: 24,
  },
  visionCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 32,
    maxWidth: 480,
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  },
  visionTitle: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 16,
    color: '#1a237e',
  },
  visionDescription: {
    fontSize: 18,
    lineHeight: 1.5,
    color: '#333',
    marginBottom: 12,
    padding: '12px 16px',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  visionAids: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  visionKinetic: {
    fontSize: 14,
    fontWeight: 500,
    marginBottom: 16,
  },
  visionQuestion: {
    fontSize: 16,
    fontWeight: 600,
    color: '#333',
    marginBottom: 20,
  },
  visionButtons: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  visionConfirmBtn: {
    padding: '14px 36px',
    fontSize: 16,
    fontWeight: 700,
    backgroundColor: '#4caf50',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  visionRejectBtn: {
    padding: '14px 36px',
    fontSize: 16,
    fontWeight: 700,
    backgroundColor: '#f44336',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  visionAnalyzingCard: {
    padding: 32,
    margin: '24px auto',
    maxWidth: 400,
    border: '2px solid #1976d2',
    borderRadius: 16,
    backgroundColor: '#e3f2fd',
    textAlign: 'center',
  },
  visionAnalyzingText: {
    fontSize: 18,
    fontWeight: 600,
    color: '#1565c0',
    marginTop: 16,
  },
  visionSpinner: {
    width: 40,
    height: 40,
    border: '4px solid #bbdefb',
    borderTop: '4px solid #1976d2',
    borderRadius: '50%',
    margin: '0 auto',
    animation: 'spin 1s linear infinite',
  },
  // Full-body visibility gate overlay
  fullBodyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 152, 0, 0.8)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  fullBodyText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 700,
    textAlign: 'center',
    padding: 16,
  },
  fullBodyMissing: {
    color: '#fff3e0',
    fontSize: 14,
    textAlign: 'center',
    padding: '0 16px',
  },
  // Paused state card
  pausedCard: {
    padding: 32,
    margin: '24px auto',
    maxWidth: 420,
    border: '2px solid #ff9800',
    borderRadius: 16,
    backgroundColor: '#fff8e1',
    textAlign: 'center',
  },
  pausedTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: '#e65100',
    marginBottom: 12,
  },
  pausedDesc: {
    fontSize: 15,
    color: '#bf360c',
    marginBottom: 20,
    lineHeight: 1.5,
  },
  // Verification status styles
  verifyingCard: {
    padding: 20,
    margin: '12px auto',
    maxWidth: 360,
    border: '1px solid #bbdefb',
    borderRadius: 12,
    backgroundColor: '#e3f2fd',
    textAlign: 'center',
  },
  verifyingText: {
    fontSize: 15,
    fontWeight: 600,
    color: '#1565c0',
    marginTop: 12,
  },
  verificationBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 20px',
    borderRadius: 24,
    border: '2px solid',
    margin: '12px auto',
    fontSize: 14,
    fontWeight: 600,
  },
  verificationIcon: {
    fontSize: 18,
    fontWeight: 700,
  },
  verificationLabel: {
    fontSize: 14,
    color: '#333',
  },
};

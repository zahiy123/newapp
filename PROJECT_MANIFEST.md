# Project Manifest — AI Kinetic Training Platform
## Last Updated: 2026-09-19

---

## Tech Stack
- **Frontend:** React 19 + Vite + Tailwind CSS
- **Backend:** Express.js + Claude Haiku API
- **Database:** Firebase (Auth + Firestore)
- **Vision:** MediaPipe Pose + YOLOv8s-seg (ONNX, browser-side) + Claude Haiku Vision
- **i18n:** Hebrew (default) + English, RTL support
- **Sports:** football, footballAmputee, basketball, basketballWheelchair, tennis, tennisWheelchair, fitness, rehab

---

## UX Design Principles

### Onboarding (one-time, inside ProfileGate)
```
Details (name, age, gender, height, weight)
  -> Kinetic Scan (camera auto-detects disabilities, ROM, aids)
     -> Profile completion (preferences, settings)
        -> Sport Selection (filtered by scan results)
           -> Goals + Muscle Focus
              -> Dashboard (ready to train)
```
- The kinetic scan is **part of onboarding**, not a separate post-registration step.
- No manual disability questionnaires — everything auto-detected from movement.
- Sport list is filtered based on scan results (e.g. amputee -> amputee football).

### Pre-Workout (lightweight, every session)
```
Readiness Rating (1-5 emoji, 3 seconds)
  -> Quick Space Safety Scan (camera checks surroundings, ~10 seconds)
     -> Start Training
```
- No heavy scans or long processes before workouts.
- Readiness adjusts volume/rest automatically.
- Environment scan is fast and non-blocking.

---

## Development Roadmap — Status Overview

| # | Stage | Status | Notes |
|---|-------|--------|-------|
| 0 | Infrastructure + Edge Model | DONE | YOLOv8s-seg ONNX + bug fixes + auth middleware |
| 0+ | Training Engine Overhaul | DONE | 6 engine improvements |
| 1A | Registration + Profile + Onboarding | DONE | 5-step onboarding flow with progress bar |
| 1B | Kinetic Scan Upgrade (inside onboarding) | DONE | ScanDataBuilder + YOLO equipment detection + hip rotation + scanData→Firestore |
| 1C | Sport + Goals flow polish | DONE | Iron Rule sport filtering + limb-aware muscle groups + goal blocking |
| 2 | Pre-Workout: Quick Space Scan + Warm-up | PENDING | Lightweight pre-workout checks only |
| 3 | Kinetic Coach Core — Hybrid Architecture | PENDING | Blocked by 2 |
| 4 | Analytics Report + Load Adaptation | PENDING | Blocked by 3 |
| 5 | Game Mode + Real-Time Refereeing | PENDING | Blocked by 3 |
| 6 | Social Platform + Battle Arenas | PENDING | Blocked by 4 |
| 7 | Full Mobile App (PWA / React Native) | PENDING | Blocked by 4, 5 |

---

## Completed Work — Detailed

### Stage 0: Infrastructure (DONE)
- **YOLOv8s-seg Edge Model** — Trained on 44,604 images, 10 classes (prosthetic_leg, prosthetic_arm, crutches, agility_ladder, balance_pad, dumbbell, kettlebell, barbell, bench, ball). Exported to ONNX (45.2MB). Browser inference hook: `client/src/hooks/useSegmentationModel.js`.
- **YOLOv8s-seg training** — Currently running epoch 73/100 in background (RTX 3050). Best model at epoch 69.
- **Auth Middleware** — Opt-in Firebase Admin token verification: `server/services/firebaseAdmin.js`. All client API calls use `authFetch()`.
- **Bug Fixes** — Removed aggressive retry logic, fixed AbortError/429 spam, fixed hardcoded API URLs.

### Stage 0+: Training Engine Overhaul (DONE)
Six improvements to the AI training plan generator (`server/services/claude.js` -> `buildWeekPrompt()`):

1. **Muscle Group Focus** — User selects focus area in Goals page. AI biases 60% of exercises toward selected group.
2. **Scan Results Integration** — Anatomic scan passport data fed into training prompt (ROM limits, compensations, risk zones).
3. **Day-Level Intensity Rotation** — Each day gets HIGH/MEDIUM/LOW following a wave pattern.
4. **Energy System Specificity** — Sport-specific work:rest ratios for all 8 sports.
5. **Training Modes** — Weekly rotation: linear -> superset -> circuit -> EMOM.
6. **Readiness Rating** — Pre-workout 1-5 scale adjusts volume/rest.

### Stage 1A: Registration + Profile + Onboarding (DONE)
- **5-step onboarding flow:** Details -> Scan -> Profile -> Sport -> Goals
- **Shared progress bar:** `client/src/components/OnboardingProgress.jsx`
- **ProfileGate** validates all 5 fields before advancing
- **Server-side validation** middleware on `/training-week` and `/training-tips`
- **No manual disability selection** — detected automatically via kinetic scan only
- **Disability-aware sport filtering** — `getAvailableSports()` returns only accessible sports

### Stage 1B: Kinetic Scan Upgrade (DONE)
- **ScanDataBuilder** — New pure-logic module (`client/src/engine/scan/ScanDataBuilder.js`) assembles unified `scanData` from analyzer outputs: bodyMap (per-joint ROM), compensationMap (hip_drop/trunk_lean/shoulder_elevation), riskZones, limbStatus (Iron Rule enforcement), specialProtocol
- **YOLO Equipment Detection Integration** — Replaced generic COCO object detection with custom YOLOv8n (16 classes) in AnatomicScan. `detectForScan()` adapter returns PhaseA-compatible format. Labels updated in PhaseAAnalyzer for direct YOLO class matching (`prosthetic_leg`, `prosthetic_arm`)
- **Hip Rotation Movement** — Added `gamma_hip_rotation` to Track Gamma (full body assessment) with wheelchair override (`gamma_trunk_rotation`)
- **scanData Pipeline** — Both Firestore save paths in AnatomicScan now include `scanData`, which flows via Dashboard payload → server `buildWeekPrompt()` → AI prompt SCAN RESULTS block
- **Iron Rule** — `limbStatus` per limb with `canTrain` flag. Absent/above-knee prosthetic limbs marked `canTrain: false`, ROM 0%

### Stage 1C: Sport + Goals Flow Polish (DONE)
- **Iron Rule Sport Filtering** — `getAvailableSports(disability, scanData)` uses `SPORT_REQUIREMENTS` per sport (which limbs must be functional). Wheelchair users get wheelchair sports, amputees get amputee sports. fitness/rehab always available. Falls back to legacy disability string if no scanData.
- **Limb-Aware Muscle Groups** — `getAvailableMuscleGroups(scanData)` blocks muscle group selection when ALL required limbs are non-trainable (e.g. both legs absent → lower_body blocked). One healthy leg still allows lower_body.
- **Goal Blocking** — `getAvailableGoals(scanData)` blocks 'speed' for wheelchair users or bilateral leg amputees. Other goals always available.
- **Adapted Sport Notice** — Blue info banner in SportSelection when scanData shows non-NATURAL classification.
- **Auto-Clear Invalid Selection** — If a previously selected sport/muscle group becomes blocked after scan, it auto-resets.
- **Seamless Data Flow** — Both SportSelection and Goals pages read `scanData` from Firestore on load, no manual input needed.

### Existing Features (Already Built)
- **Training Plan Generator** — 4-week periodized plans with progressive overload, Universal Exercise Formula, constraint rotation, Hebrew coach style, disability-adapted exercises
- **Live Training Page** — Full state machine (IDLE -> ENV_SCAN -> WARM_UP -> EXERCISING -> RESTING -> EXERCISE_DONE), camera-based pose tracking, set/rep counting, AI coaching feedback
- **Haiku Vision** — Per-rep frame analysis via Claude Haiku, form scoring, feedback
- **Real-Time AI Coaching** — Rate-limited coaching suggestions during workout
- **Workout Summary** — Post-workout AI summary with tips
- **Workout Adaptation** — Dynamic mid-workout plan adjustment based on performance
- **Game Mode** — Video-based game analysis, event detection, VAR frame analysis
- **Environment Scanning** — Hazard/equipment detection before workout
- **Anatomic Scan (Phase A+B)** — Camera-based body classification (prosthetics, aids, wheelchair)
- **Stats Page** — Workout history, charts, personal bests, AI quality tracking
- **Equipment Detection** — COCO object detection + custom YOLO model
- **Ghost Skeleton Overlay** — Target pose visualization
- **Calorie Estimation** — Per-exercise calorie calculation
- **Workout Persistence** — LocalStorage + Firestore save/resume

---

## Pending Work — Detailed

### Stage 1B: Kinetic Scan Upgrade (NEXT)
**Location:** Inside ProfileGate step 2 (AnatomicScan) — part of onboarding, NOT a separate step.

**What to upgrade:**
1. Define guided movement protocol: walking in place, hip rotations, full arm movements, squats
2. Upgrade AnatomicScan from static photo to protocol-driven dynamic scan with real-time guidance
3. Integrate YOLO Edge model for real-time prosthetic/equipment detection during scan
4. Combined limitation detection (arms+legs, missing limbs, ROM differences)
5. Build kinetic profile automatically from movement patterns (bodyMap, compensationMap, riskZones)
6. Save full scan results to Firestore as `scanData` (already wired in Dashboard payload)
7. Iron Rule enforcement: never instruct a limited/missing limb

**Key constraint:** The scan must feel natural — the user follows simple movement prompts on screen (like "walk in place", "raise both arms"), and the system silently builds the profile in the background.

### Stage 1C: Sport + Goals Flow Polish
1. Ensure `getAvailableSports()` uses scan results (not just manual disability field) to filter sports
2. Verify scan-to-sport pipeline: scan detects one_leg -> show footballAmputee, basketballWheelchair, etc.
3. Auto-populate profile disability fields from scan results
4. Verify muscle group focus and scan data flow through to training plan generation

### Stage 2: Pre-Workout — Quick Space Scan + Warm-up
**Design principle: lightweight and fast. No heavy processes before workouts.**

1. Quick space safety scan (~10 seconds): camera checks for obstacles, lighting, floor space
2. Show brief safety summary (safe/caution) — non-blocking
3. 5-minute sport-specific warm-up with guidance (already partially built)
4. Warm-up adapted to workout type and physical limitations (warm-up rules already in claude.js)

### Stage 3: Kinetic Coach Core — Hybrid Architecture
1. Edge processing 60FPS: MediaPipe + Kalman + local rep counting
2. Peak Event Triggering: send single frame + JSON at peak moment
3. Sub-second voice feedback from Claude
4. Neural Emergency Brake (stop on dangerous movement)
5. Real-time fatigue adaptation
6. Injury Ledger (persistent injury tracking)
7. Ghost Overlay (target skeleton)
8. Form Degradation Curve
9. Automatic Progressive Overload engine
10. Injury Prediction from movement patterns

### Stage 4: Analytics + Load Adaptation
1. Detailed per-workout report (form scores, reps, fatigue curve)
2. Progress charts over time (Chart.js)
3. Load adaptation: 2-3 declining workouts -> auto-reduce
4. Detect excessive ease -> auto-increase
5. Recovery scoring between workouts
6. History persistence in Firestore

### Stage 5: Game Mode + Real-Time Refereeing
1. Full computerized refereeing
2. Player detection + ball tracking
3. Goal, foul, penalty, out-of-bounds detection
4. Automatic event management
5. VAR review with confidence scores

### Stage 6: Social Platform + Battle Arenas
1. Multiplayer battle system
2. Global competitions between athletes
3. Leaderboard, challenges, achievements
4. Public profiles

### Stage 7: Full Mobile App
1. Convert to React Native / PWA
2. Mobile optimization (GPU, battery)
3. Publish to App Store + Google Play

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `server/services/claude.js` | AI training plan generator, buildWeekPrompt(), SPORT_CONTEXTS, energy systems, all prompt engineering |
| `server/routes/coach.js` | All coach API endpoints (training-week, analyze-rep, realtime-feedback, etc.) |
| `server/services/firebaseAdmin.js` | Firebase Admin auth middleware |
| `client/src/pages/Training.jsx` | Live workout page (~3000 lines), state machine, readiness rating |
| `client/src/pages/Dashboard.jsx` | Plan display, generation trigger, payload builder |
| `client/src/pages/Goals.jsx` | Goal + muscle group focus selection |
| `client/src/pages/ProfileGate.jsx` | 5-step onboarding orchestrator |
| `client/src/pages/AnatomicScan.jsx` | Body scan (Phase A + B) with YOLO equipment detection + scanData save |
| `client/src/engine/scan/ScanDataBuilder.js` | Assembles scanData (bodyMap, compensationMap, riskZones, limbStatus) from scan outputs |
| `client/src/engine/scan/ScanSequencer.js` | Scan pipeline state machine (pure logic) |
| `client/src/engine/scan/movements.js` | Guided movement definitions per track + wheelchair overrides |
| `client/src/hooks/useSegmentationModel.js` | YOLOv8s-seg browser inference |
| `client/src/hooks/useEquipmentDetection.js` | YOLOv8n equipment detection (16 classes) with detectForScan() adapter |
| `client/src/hooks/useAnatomicScan.js` | Scan logic hook |
| `client/src/hooks/useHaikuVision.js` | Per-rep Claude Haiku vision analysis |
| `client/src/hooks/useAICoach.js` | Real-time AI coaching feedback |
| `client/src/utils/sportLogic.js` | Sport definitions, disability filtering, goals |
| `client/src/utils/motionEngine.js` | Kalman filter, joint angles, safety checks |
| `client/src/utils/exerciseAnalysis.js` | Exercise analyzers, orientation/perspective checks |
| `client/src/components/OnboardingProgress.jsx` | 5-step shared progress bar |
| `client/src/i18n/he.json` | Hebrew translations |
| `client/src/i18n/en.json` | English translations |

---

## Background Processes
- **YOLOv8s-seg training** — Epoch 73/100, running on RTX 3050 GPU, best model at epoch 69. Model: 11.8M params, 10 classes, 44,604 training images.

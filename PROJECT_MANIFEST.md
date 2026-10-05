# Project Manifest — AI Kinetic Training Platform
## Last Updated: 2026-10-04

---

## Manifest Update Protocol (MANDATORY)
- This file is the single source of truth for the project's state and plan.
- **Every task, step, or change** (code, models, decisions, strategy) must be reflected here in the same work session — before the task is reported as done.
- On each update: bump `Last Updated`, update the Roadmap table status, move items from "Pending" to "Completed", and append a line to the **Change Log** at the bottom.
- The stage order in the Roadmap is fixed. New features are placed *inside* the existing stages, never by reordering them.
- No practical work on a new stage starts without the owner's explicit approval.

---

## Strategic Focus — Rehab-Community Track (B2B + B2C)
*Decided 2026-09-28.*

- **Dropped:** professional sports teams as a target channel.
- **Focus:** one combined **Rehab-Community** track, built on the existing architecture:
  - **B2C:** individuals in rehab or with limitations (amputees, wheelchair users, post-injury) who train at home with the camera.
  - **B2B:** rehab centers, clinics, physiotherapists, disability-sport associations and community organizations that manage groups of trainees.
- **Sport-Specific Rehabilitation:** a rehab trainee can choose to:
  1. **Rehab only:** a classic rehab program.
  2. **Rehab + Sport:** rehab combined with exercises from an adapted sport that fits their limitations (e.g. rehab + amputee football).
  3. **Sport only:** training dedicated entirely to the selected adapted sport.
  The purpose is added value, motivation, and a path from rehab into community sport.
- **Motion Silhouette (Ghost):** a **mandatory requirement**. An animated silhouette on screen that is **built and calibrated precisely from the trainee's onboarding profile scan** (proportions, per-joint ROM, limbStatus, prosthetics) and respects the Iron Rule (no instruction for absent or non-trainable limbs).
- **Adaptive Coach Styles:** the coach's tone, pace and wording adapt to the trainee and track (e.g. encouraging and calm in rehab, aggressive and high-energy in sport). This replaces the single fixed "aggressive" style.

### Owner Decisions — 2026-09-28
| Topic | Decision |
|---|---|
| Ghost silhouette | Approved. Must be built and fitted **exactly from the onboarding profile scan data** |
| Adaptive coach styles | Approved. To be developed |
| Medical sensitivity / regulation | Acknowledged. Kept **for the final stages only** (Stage 7) |
| Equipment YOLO model | **No new export.** The current deployed model (v1) performs well and stays as-is |
| Two-way voice | Approved. Free built-in speech recognition first (Web Speech / native mobile APIs). Cloud STT only in the future, if higher accuracy is needed |
| Coach feedback policy | Approved. Silent on small, harmless errors. **Immediate alert** on dangerous angles or injury-risk errors |
| Pain Traffic Light Protocol | Approved. 0-3 green (continue), 4-5 yellow (auto load reduction), >5 red (emergency stop + Injury Ledger entry) |
| Movement analysis baseline | Approved. **No generic symmetry.** The trainee is compared only to their own personal profile and baseline (`ghostProfile`) |
| Coach Notebook (long-term memory) | Approved. A per-workout summary saved in Firestore. The next workout opens with a personal question |

Where each point sits in the existing stages is listed under the relevant stage below and marked **[Strategy 2026-09]**.

---

## Tech Stack
- **Frontend:** React 19 + Vite + Tailwind CSS
- **Backend:** Express.js + Claude Haiku API
- **Database:** Firebase (Auth + Firestore)
- **Vision:** MediaPipe Pose + YOLOv8s-seg (ONNX, browser-side) + custom YOLOv8n equipment model + Claude Haiku Vision
- **i18n:** Hebrew (default) + English, RTL support
- **Sports:** football, footballAmputee, footballAmputeeGK, basketball, basketballWheelchair, tennis, tennisWheelchair, fitness, rehab

---

## UX Design Principles

### Onboarding (one-time, inside ProfileGate)
```
Details (name, age, gender, height, weight)
  -> Kinetic Scan (camera auto-detects disabilities, ROM, aids)
       includes a SEPARATE assessment of the RIGHT arm and the LEFT arm
     -> Profile completion (preferences, settings)
        -> Sport Selection (filtered by scan results)
           -> Goals
              -> [only if the "strength" goal is selected] Muscle Group Focus
                 -> Dashboard (ready to train)
```
- The kinetic scan is **part of onboarding**, not a separate post-registration step.
- No manual disability questionnaires. Everything is auto-detected from movement.
- The sport list is filtered by scan results (e.g. amputee -> amputee football).
- **Each upper limb is assessed separately** (right and left), so limitations, different ROM or specific problems in one arm are detected independently (Stage 1D).
- **Muscle group selection appears only when the trainee explicitly chooses the strength goal.** Otherwise the focus is `full_body` (Stage 1D).

### Pre-Workout (lightweight, every session)
```
Readiness Rating (1-5 emoji, 3 seconds)
  -> Quick Space Safety Scan (camera checks surroundings, ~10 seconds)
     -> Start Training
```
- No heavy scans or long processes before workouts.
- Readiness adjusts volume and rest automatically.
- The environment scan is fast and non-blocking.

---

## Stable Checkpoints (safe restore points)
| Tag | Commit | Date | What it contains |
|---|---|---|---|
| `checkpoint-stage2-stable` | (this commit, see `git show checkpoint-stage2-stable`) | 2026-10-05 | Stages 0-2 complete and verified on device: scan (per-arm, side fix, pacing, lock, accurate diagnosis), track selection, environment scan + obstacles, scan-adapted warm-up with ball question, seated tracking, Ghost demo panel |

**How to return to a checkpoint:**
- Look at it without changing anything: `git checkout checkpoint-stage2-stable` (then `git checkout main` to come back).
- Undo later work on `main` safely (keeps history): `git revert <commits after the checkpoint>`, then push → Vercel redeploys.
- Redeploy the checkpoint in Vercel without code changes: Vercel → Deployments → the deployment of the checkpoint commit → "Promote to Production" (instant rollback).
- New risky features are built on a **feature branch** first (Vercel gives the branch its own preview URL) and are merged into `main` only after the owner approves.

## Development Roadmap — Status Overview

| # | Stage | Status | Notes |
|---|-------|--------|-------|
| 0 | Infrastructure + Edge Model | DONE | YOLOv8s-seg ONNX + bug fixes + auth middleware |
| 0+ | Training Engine Overhaul | DONE | 6 engine improvements |
| 1A | Registration + Profile + Onboarding | DONE | 5-step onboarding flow with progress bar |
| 1B | Kinetic Scan Upgrade (inside onboarding) | DONE | ScanDataBuilder + YOLO equipment detection + hip rotation + scanData→Firestore |
| 1C | Sport + Goals flow polish | DONE | Iron Rule sport filtering + limb-aware muscle groups + goal blocking |
| 1D | **Onboarding Corrections** | **DONE (code + tests), awaiting a real-camera check** | Separate right/left arm assessment + walking in place in the scan calibration; muscle-group step only for the strength goal |
| 2 | Pre-Workout: Track Selection + Quick Space Scan + Warm-up | **DONE ✅ — verified by the owner on device (2026-10-05)** | Stable checkpoint `checkpoint-stage2-stable`. 2.1 track selection; 2.2/2.2b environment scan + movement-zone obstacles; 2.3 scan + track adapted warm-up, ball question; 2.4/2.5 seated tracking + Ghost panel |
| 3 | Kinetic Coach Core — Hybrid Architecture | PENDING | Blocked by 2. Includes the **scan-calibrated Ghost**, **Sport-Specific Rehab tracks**, **Adaptive Coach Styles**, **Two-way voice**, **Critical-only feedback**, **Pain Traffic Light**, **Personal-baseline analysis**, **Coach Notebook** |
| 4 | Analytics Report + Load Adaptation | PENDING | Blocked by 3. Produces the reports the Physio Portal (4B) displays |
| 4B | **Physiotherapist Portal (B2B Dashboard)** | PENDING | Blocked by 3, 4. Full permission isolation (Firestore rules), clinical reports, clinician-set limits enforced in real time |
| 5 | Game Mode + Real-Time Refereeing | PENDING | Blocked by 3. Re-scoped to **community games** (not pro teams) |
| 6 | Social Platform + Battle Arenas | PENDING | Blocked by 4. Includes **community groups + B2B organization accounts** |
| 7 | Full Mobile App (PWA / React Native) | PENDING | Blocked by 4, 5 |

---

## Completed Work — Detailed

### Stage 0: Infrastructure (DONE)
- **YOLOv8s-seg Edge Model:** trained on 44,604 images, 10 classes (prosthetic_leg, prosthetic_arm, crutches, agility_ladder, balance_pad, dumbbell, kettlebell, barbell, bench, ball). Exported to ONNX (45.2MB, `client/public/models/yolov8s_seg.onnx`, 2026-09-23). Browser inference hook: `client/src/hooks/useSegmentationModel.js` (not yet committed to git).
- **Auth Middleware:** opt-in Firebase Admin token verification in `server/services/firebaseAdmin.js`. All client API calls use `authFetch()`.
- **Bug Fixes:** removed aggressive retry logic, fixed AbortError/429 spam, fixed hardcoded API URLs.

### Stage 0+: Training Engine Overhaul (DONE)
Six improvements to the AI training plan generator (`server/services/claude.js` -> `buildWeekPrompt()`):

1. **Muscle Group Focus:** the user selects a focus area on the Goals page. The AI biases 60% of exercises toward the selected group.
2. **Scan Results Integration:** anatomic scan passport data is fed into the training prompt (ROM limits, compensations, risk zones).
3. **Day-Level Intensity Rotation:** each day gets HIGH/MEDIUM/LOW following a wave pattern.
4. **Energy System Specificity:** sport-specific work:rest ratios for all sports.
5. **Training Modes:** weekly rotation of linear -> superset -> circuit -> EMOM.
6. **Readiness Rating:** a pre-workout 1-5 scale adjusts volume and rest.

### Stage 1A: Registration + Profile + Onboarding (DONE)
- **5-step onboarding flow:** Details -> Scan -> Profile -> Sport -> Goals
- **Shared progress bar:** `client/src/components/OnboardingProgress.jsx`
- **ProfileGate** validates all 5 fields before advancing.
- **Server-side validation** middleware on `/training-week` and `/training-tips`.
- **No manual disability selection:** disabilities are detected automatically by the kinetic scan only.
- **Disability-aware sport filtering:** `getAvailableSports()` returns only accessible sports.

### Stage 1B: Kinetic Scan Upgrade (DONE)
- **ScanDataBuilder:** a pure-logic module (`client/src/engine/scan/ScanDataBuilder.js`) that assembles a unified `scanData` from analyzer outputs: bodyMap (per-joint ROM), compensationMap (hip_drop/trunk_lean/shoulder_elevation), riskZones, limbStatus (Iron Rule enforcement), specialProtocol.
- **YOLO Equipment Detection Integration:** replaced generic COCO detection with a custom YOLOv8n model (16 classes) in AnatomicScan. The `detectForScan()` adapter returns a PhaseA-compatible format.
- **Dynamic guided movements:** walking in place, hip rotations, arm movements, squats, with wheelchair overrides (`gamma_trunk_rotation`).
- **scanData Pipeline:** Firestore save → Dashboard payload → server `buildWeekPrompt()` → SCAN RESULTS block in the AI prompt.
- **Iron Rule:** `limbStatus` per limb with a `canTrain` flag. Absent or above-knee prosthetic limbs are marked `canTrain: false` with ROM 0%.

### Stage 1C: Sport + Goals Flow Polish (DONE)
- **Iron Rule Sport Filtering:** `getAvailableSports(disability, scanData)` uses `SPORT_REQUIREMENTS` per sport. fitness and rehab are always available.
- **Limb-Aware Muscle Groups:** `getAvailableMuscleGroups(scanData)` blocks a group when all of its required limbs are non-trainable.
- **Goal Blocking:** `getAvailableGoals(scanData)` blocks 'speed' for wheelchair users and bilateral leg amputees.
- **Adapted Sport Notice** and **Auto-Clear Invalid Selection**.
- **Seamless Data Flow:** SportSelection and Goals read `scanData` from Firestore on load.

### Existing Features (Already Built)
- **Training Plan Generator:** 4-week periodized plans, progressive overload, Universal Exercise Formula, Hebrew coach style, disability-adapted exercises.
- **Live Training Page:** state machine (IDLE -> ENV_SCAN -> WARM_UP -> EXERCISING -> RESTING -> EXERCISE_DONE), pose tracking, set/rep counting, AI coaching.
- **Haiku Vision:** per-rep frame analysis, form scoring and feedback.
- **Real-Time AI Coaching**, **Workout Summary**, **Workout Adaptation**.
- **Game Mode:** video-based game analysis, event detection, VAR frame analysis.
- **Environment Scanning**, **Anatomic Scan (Phase A+B)**, **Stats Page**, **Calorie Estimation**, **Workout Persistence**.
- **Ghost Skeleton Overlay (basic):** `client/src/hooks/useGhostSkeleton.js`. A forward-kinematics target skeleton built from generic `SPORT_PROFILES` angles and torso-relative segment ratios. It is **not yet** personalized to scanned ROM or limbStatus (see Stage 3).

### AI Models Status (verified 2026-09-28)
| Model | Training run | Status | Deployed file |
|---|---|---|---|
| Equipment YOLOv8n v1 | `training/local_pipeline/runs/equipment_yolov8n` | Done (150 epochs, 2026-08-02) | `equipment_yolov8n.onnx` + `_q` (**in use. Owner decision: keep, do not replace**) |
| Equipment YOLOv8n v2 | `.../equipment_yolov8n_v2` | Done (80 epochs, 2026-08-12) | not exported (not needed) |
| Equipment YOLOv8n v3 | `.../equipment_yolov8n_v3` | Done (60/60 epochs, 2026-08-17, mAP50 0.728) | not exported (not needed) |
| YOLOv8s-seg | run folder not found locally | ONNX exported 2026-09-23 | `yolov8s_seg.onnx` |

---

## Pending Work — Detailed

### Stage 1D: Onboarding Corrections (DONE in code, 2026-10-04; awaiting a real-camera check)
Two critical corrections to the existing onboarding (Stages 1B/1C), completed **before Stage 2**.

**Key finding during implementation:** in the real app, the **"Confirm"** button after the vision diagnosis (`handleConfirmAndFinish` in `AnatomicScan.jsx`) **ends the scan and saves immediately**. As a result, the guided diagnostic tracks (`DIAG_TRACKS`: squats, march, arms_raise, …) and Phase B **never run** for real users. The movements that actually run are the **motion calibration** (`MOTION_CAL_MOVEMENTS`). The per-arm assessment and walking in place were therefore added **to the motion calibration**, so they really run for every user. `DIAG_TRACKS` was left completely untouched.

**1. Separate assessment of each arm (right and left), purely ADDITIVE (DONE)**
- **Nothing removed:** the 4 original calibration movements (`raise_right_hand`, `slight_bend`, `pelvis_rotation`, `calf_raise`) and their logic are unchanged and keep their relative order. `DIAG_TRACKS`, Phase B and all analyzers are unchanged.
- **New motion calibration order (12 movements):**
  1. `raise_right_hand` (existing)
  2. `raise_left_hand` (**new**): the left hand is verified independently, and it also detects a mirrored camera if the right-hand step was missed
  3. `right_arm_flexion` / `right_arm_abduction` / `right_elbow_flex` (**new**): right arm only (forward-overhead raise, side raise, elbow bend-straighten)
  4. `left_arm_flexion` / `left_arm_abduction` / `left_elbow_flex` (**new**): left arm only
  5. `slight_bend` (knee bend), `pelvis_rotation`, `calf_raise` (tiptoes) (existing)
  6. `march_in_place_cal` (**new**): walking in place, **skipped when a wheelchair is detected** (never instructed)
- **Per-arm windows:** each arm movement collects 2.5-6 seconds and advances on real movement. It **always advances after 6s**, so a limited or paralyzed arm never blocks the scan; it is recorded as `no_movement`, which is itself a finding.
- **Iron Rule:** an arm whose elbow/wrist is not visible is skipped **before its instruction is emitted** (status `not_visible`).
- **Measured per arm** (2D frontal-camera estimate): shoulder flexion peak (°), shoulder abduction peak (°), elbow min/max/range (°), smoothness (jitter), and compensations (`trunk_lean`, `shoulder_elevation`).
- **Code:** a new pure module `client/src/engine/scan/ArmAssessment.js`, plus `ScanSequencer.js` (new movements, `_advanceMotionCalibration()`, `_motionCalSkipReason()`, getters `armAssessment` and `calibrationResults`).
- **Saved to Firestore, in addition to the existing fields:** `scanData.armAssessment` (full per-arm summary), `bodyMap.<side>_shoulder/elbow.measured` (degrees), and `romBaseline.arms` (for progress tracking). This works in both save paths, including the "Confirm" early finish (`getArmAssessment()` in `useAnatomicScan`).
- **Training plan:** `buildWeekPrompt()` gets a "Per-arm assessment" line (limited ROM per arm, no movement → do not load, not visible → do not instruct).
- The scan is about **30-40 seconds longer**.
- **Tests:** a new `ArmAssessment.test.js` with 13 tests (healthy + limited arm measured separately, a still arm does not block, not-visible arm skipped without instruction, wheelchair → no walking instruction, left-hand mirror detection). In `ScanSequencer.test.js` only the calibration helpers and the "has 4 movements" assertion were updated, because they hardcode the old 4-step sequence. **No new failures.** After the 2026-10-04 fixes, 366 tests pass. The 23 remaining failures were already failing before this work and are unrelated (see Open Technical Debt).

**3. Critical fix: left/right side inversion (DONE, 2026-10-04)**
- *Symptom (owner report):* a LEFT-leg amputee was detected as a RIGHT-leg amputee.
- *Root cause (two places, same wrong assumption that the image is mirrored):*
  - `KineticAnalyzer.js` swapped left and right in every landmark mapping (`JOINT_DEFS`, gait, arms, legs): `left_knee` used MediaPipe `RIGHT_*`. But MediaPipe runs on the **raw** camera image (the preview is only CSS-mirrored), and the calibration ("raise your RIGHT hand") verifies that MediaPipe `RIGHT_*` = the person's right. So a frozen LEFT knee was reported as "right". The existing KineticAnalyzer tests had always expected the anatomical convention, which is why 18 of them were failing.
  - The vision prompt (`buildAnatomyVisionPrompt`) and the verification prompt (`verifyScan`) told Claude that the image is "mirrored (selfie)" and to "trust" the (inverted) kinetic labels.
- *Fix:*
  - KineticAnalyzer now uses the **anatomical convention** (MediaPipe `LEFT_*` = person's left), the same as PhaseBAnalyzer and the calibration.
  - The hip-deviation and center-of-gravity side signals read the body's orientation from the landmarks themselves (`personLeftSign()`), so they are correct whether or not a device delivers a mirrored stream.
  - The vision and verification prompts now say the images are the **raw, non-mirrored** camera view (person's left = image right, apply the mapping once). Kinetic hints are supporting evidence only.
  - If the calibration detects a mirrored stream, the frames sent to vision and verification are flipped back to the raw view (`captureMultipleFrames` / `captureSnapshot`).
- *Result:* 22 previously failing tests now pass (all 18 KineticAnalyzer tests). **Needs a real-camera confirmation by the owner** (left-leg amputee).

**4. Critical fix: scan pace and synchronization (DONE, 2026-10-04)**
- *Symptom (owner report):* the scan said "raise your right/left hand" and immediately jumped ahead, with no real time to perform the movement.
- *Root cause:* each calibration movement advanced on the **first frame** in which movement was detected (often while the instruction was still being spoken).
- *Fix:* every calibration movement now has two timed phases:
  1. **Get ready** (2.5-6.5 s, scaled to the instruction's word count): the instruction is spoken and nothing is measured. The UI shows "Listen and get ready…".
  2. **Measure** (at least **4 s**, up to 8 s): the UI shows "Measuring now — do the movement" with a countdown bar, plus a short **ding** at the start. A sound is used rather than speech, so it never cuts off the instruction. The movement advances only after the full 4 s window **and** detected movement, or at 8 s with "no movement" recorded.
- The per-arm instructions were shortened so they are quick to hear.
- Speech-end events are **not** used for timing, because `onend` is unreliable on Windows Chrome (see `SPEECH_FIX_STATUS.md`). The timing is deterministic in the sequencer.
- **Total calibration time: about 1.7-2.5 minutes** (12 movements). It can be tuned via the `MOTION_CAL_PREP_*` / `MOTION_CAL_MEASURE_*` constants in `ScanSequencer.js`.
- *Tests:* 5 new timing tests (no advance before get-ready + 4 s, measureStart cue timing, movement during get-ready alone does not count, max-window timeout, get-ready bounds).

**5. Critical fix: the scan skipped steps and jumped to results (DONE, 2026-10-04)**
- *Symptom (owner report):* only the right and left hand raises were noticeable. Knees, pelvis, tiptoes and walking were effectively skipped, and the scan jumped to results.
- *Root cause:* `AnatomicScan.jsx` fed the sequencer on **every `requestAnimationFrame` tick**, i.e. at the screen refresh rate (60 / 120 / 144 Hz), often repeating the same landmarks. All sequencer windows are counted in frames at 30 fps, so on a 144 Hz screen everything ran about 5× too fast. The full calibration took **about 23 s instead of about 2 min**, each new instruction cut off the previous one, and the steps flashed by unnoticed. This was also the real cause of the original "too fast" report.
- *Fix:* `useAnatomicScan.feedFrame()` throttles to exactly `SCAN_SAMPLE_RATE` (30) frames per second of real time, using the new pure module `engine/scan/frameThrottle.js`. Object detections that arrive on skipped ticks are kept for the next fed frame. The console now logs every calibration step and phase (`[useAnatomicScan] Calibration N/12 — prep|measure`).
- *Tests:* `frameThrottle.test.js` covers about 30 fps on 60/75/120/144/165 Hz screens, plus an **end-to-end 144 Hz run of the real sequencer**: all 12 steps run in order with no skips, each with its measurement window, and the total real time is between 78 s and 176 s. Verified that this test fails without the throttle (23 s).

**6. Hermetic lock: no step is ever skipped silently (DONE, 2026-10-04)**
- *Owner requirement:* the scan must go through every step in order (arms → knees → pelvis → tiptoes → walking), with a real time window. No jumps, and no move to results before every step was actually performed.
- *Fix:* a movement without detected motion by the end of its measurement window is **repeated**, never advanced. The coach says "I didn't detect the movement. Let's try again." plus the instruction, then runs a fresh get-ready + measurement window, and the UI shows "attempt 2 of 3".
  - Only after `MOTION_CAL_MAX_ATTEMPTS` (3) failed attempts is the step recorded as **not performed** (`calibrationResults.incompleteSteps`), and the user is told explicitly ("Moving on to the next movement."). The limit exists so a paralyzed or absent limb can never trap the user. The constant can be changed in `ScanSequencer.js`.
  - Results (detection → vision → "Is this diagnosis accurate?") come only after the last step.
- Walking-in-place detection in calibration is now range-based (one ankle lifts ≥ 3% of frame height, `_hasMarchMovement`). The old variance threshold was borderline for real (and prosthetic-side) steps.
- *Tests:* repeat-with-nudge on the same step, "not performed" only after 3 attempts with an explicit announcement, and "a retry that succeeds counts as performed". The 144 Hz end-to-end test confirms all 12 steps run in order with no repeats when the movements are performed.

**7. Accurate diagnosis report — no invented limbs, no side confusion (DONE, 2026-10-04)**
- *Symptom (owner report):* the "Is this diagnosis accurate?" summary listed prostheses/amputations on both sides in a confused way. The owner has a LEFT below-knee amputation only.
- *Root causes:* (a) the side inversion (#3); (b) the vision prompt actively pushed the model to find prostheses ("Only report NATURAL if you can CLEARLY see all limbs are intact", "partial analysis is better than no analysis", "trust these [kinetic] labels"); (c) classification, side and summary came from the model's free text, so they could contradict each other.
- *Fix (server):*
  - A new prompt asks for **each of the 4 limbs independently**: `intact | prosthetic | absent | unclear`, plus level and the **visual evidence** seen. Strict rules: no evidence → not affected; never infer from posture or asymmetry; one limb says nothing about another; hidden → `unclear`. Kinetic hints are weak supporting evidence only.
  - The new pure module `server/services/anatomyDiagnosis.js` (`normalizeAnatomyDiagnosis`) **derives classification, side and the Hebrew/English summary deterministically** from the per-limb data. A limb marked affected without real evidence is downgraded to `unclear`. Example output: "רגל שמאל: קטיעה מתחת לברך עם פרוטזה. תקינות: רגל ימין, יד שמאל, יד ימין."
  - "Report error → left/right leg" (`/correct-anatomy`) rebuilds the diagnosis from the per-limb data (`applySideCorrection`) instead of swapping words in the text.
- *Tests:* `server/services/__tests__/anatomyDiagnosis.test.js` with 8 tests (`npm test` in `server/`), including the owner's exact case and "evidence-less amputation is not reported".

**8. Pace + detection sensitivity tuning (DONE, 2026-10-04; owner feedback: "too slow, misses real movements")**
- *Pace:* get-ready 1.5-4 s (was 2.5-6.5 s), measurement window 2.5-6 s (was 4-8 s). The 12-step calibration takes **about 68 s** when the movements are performed (was about 103 s). The order and the hermetic lock are unchanged.
- *Sensitivity: 5 root causes of missed movements were fixed:*
  1. Movement during the get-ready phase was ignored. Detection now runs on **every frame of the step**; only advancing waits for the window.
  2. The hand raise was compared to the step's first frame (a hand already up at the start could never count). It is now measured as the rise above the wrist's lowest point in the step, with the threshold lowered from 12% to 8% of frame height.
  3. The knee bend checked only the LEFT knee (the owner's prosthetic side). It now uses the knee-angle range of **either** knee, ≥ 5°.
  4. The full-body visibility gate was active during calibration, so an arm raised out of frame froze the scan. It is now bypassed during calibration, as it already was during diagnostics.
  5. Thresholds: walking lift 3% → 2% of frame height; pelvis 0.015 → 0.012; arm-movement variance 12 → 8 deg².
- *Tests:* 7 new sensitivity tests (movement during get-ready, hand already up, right-knee-only bend, short step, arm out of frame, moderate raise, **no false positives from rest jitter**). Verified that 5 of them fail on the previous version (`b9d336f`). Client: 383 pass, 0 new failures, 23 pre-existing.

**9. Instant results after the last step (DONE, 2026-10-04; owner: "jump straight to the results")**
- *Before:* after step 12, the user waited about 8-13 s: 2 s of "stand still" detection, about 1 s of frame capture, and a 5-10 s Claude vision call (plus 15 s waits on rate limits), all sequential.
- *Fix:*
  - **Background vision diagnosis:** at the start of the `slight_bend` step (standing, arms down, full body in frame, about 20 s before the end), `useAnatomicScan` captures the frames and sends the vision request (`startVisionPrefetch`). At the end, `handleVisionCapture` uses the ready result. If the background call failed, it falls back to capturing and calling at the end, as before.
  - **No extra stand-still at the end:** the posture (kinetic) analysis uses the standing-still frames recorded during the first get-ready phase of the scan (`_stillFrameRange`). The last calibration frame goes **directly** to `visionDiagnosis`. The old 2 s detection is kept only as a fallback (strict mode / too few still frames).
  - If a mirrored stream is detected, frames recorded before detection are corrected retroactively (`_setMirrored`).
- The vision request no longer carries kinetic hints. They were weak supporting evidence only.
- *Tests:* fast-path test (the last step → `visionDiagnosis` on the same frame, using ≥ 30 still frames). Calibration-end helpers were updated. Client: 383 pass, 0 new failures, 23 pre-existing. The hook's background call is verified by build only and needs a real-device check.

**2. Muscle group selection only for the strength track (DONE)**
- `Goals.jsx`: the muscle group section is **not rendered at all** unless the `strength` goal is selected. For any other goal set, the focus is automatically `full_body`, and deselecting strength resets it immediately.
- Defensive layers: `Dashboard.jsx` sends `full_body` unless the goals include `strength` (this covers existing users with an old stored focus), and `buildWeekPrompt()` applies the muscle-group bias only when `strength` is in the goals.

### Stage 2: Pre-Workout — Track Selection + Quick Space Scan + Warm-up (IN PROGRESS, approved 2026-10-04)
**Design principle: lightweight and fast. No heavy processes before workouts.**

**Owner decisions (2026-10-04):**
| Topic | Decision |
|---|---|
| Disability / amputation data | **Never asked manually.** Detected by the scan and shown read-only, with a "rescan" option |
| Training track | Chosen in Stage 2 (moved forward from Stage 3 #11): **clean rehab** or **rehab combined with a sport**. Picking a sport directly = sport-only |
| Warm-up length | **Short and efficient: about 2.5 minutes** (do not discourage the trainee) |
| Space scan + obstacles | **Never blocking.** On an obstacle: announce it, suggest moving it, and state clearly that continuing without moving it is **the trainee's own responsibility**. Then continue |

**2.1 Track selection + no manual disability questionnaires (DONE, 2026-10-04)**
- `RehabSelection.jsx` rewritten. The old manual questionnaire (single/double amputation, wheelchair, injury → prosthesis yes/no → target area) was removed; its fields (`rehabCondition`, `rehabHasProsthesis`, `rehabTargetArea`) were saved but **never used** by the plan generator. The new screen shows:
  - **"What the scan detected"** (read-only, the new `components/ScanFindings.jsx`, from the scan's deterministic description) with a "rescan" link.
  - Track choice: **clean rehab** (`rehab_only`) or **rehab combined with a sport** (`rehab_sport`). For the combined track, the sport is picked from the sports the scan allows (Iron Rule via `getAvailableSports`).
- Saved: `sport: 'rehab'`, `trainingTrack`, `rehabSport`. `SportSelection` marks a directly chosen sport as `trainingTrack: 'sport_only'`.
- `Profile.jsx`: the manual disability/side/level/aid selects were replaced by the same read-only `ScanFindings` card. The fields are still filled by the scan and used across the app.
- Plan generation: `Dashboard` sends `trainingTrack` + `rehabSport`. `buildWeekPrompt()` adds a TRAINING TRACK block (clean rehab = no sport drills; combined = about 60-70% rehab + 30-40% adapted sport drills, Iron Rule). The cross-sport filter uses the combined sport's rules (rehab's own list bans every ball/sport word and would have deleted all sport drills).
- Scan "Report error → side": now shows the corrected diagnosis for confirmation (then saves like "Confirm"). Previously it continued into the old diagnostic tracks and the manual `AnatomyProfileForm`. Also fixed: "Report error" paused the scan, which hid the side picker.

**2.2 Quick space safety scan — before the warm-up, never blocking (DONE in code, 2026-10-04; awaiting a real-device check)**
- *Bug found (owner report: "the system skips the environment scan and starts the warm-up"):* `Training.jsx` `handleStartBriefing` deliberately ran the **warm-up first** ("WARMUP CHECK FIRST — before env scan"). The environment scan only ran afterwards, and **only if the object detector was loaded** (`objReady`), so in practice it was skipped. It also waited with no time limit for the Claude Vision reply.
- *New flow, once per workout:* **Start → environment scan → warm-up → briefing → exercises.**
  1. About 3 s of local object detection (only if the detector is loaded; the scan runs either way).
  2. AI hazard analysis of one camera frame (`/api/coach/analyze-environment`) with a **6 s limit** (`fetchWithTimeout`). On timeout or error, it continues with the local results.
  3. AI hazards and the sport-profile safety check (`runSafetyCheck`) are merged.
  4. **No hazards:** "Your space is clear and safe. On to the warm-up!" (voice + screen), then the warm-up after 3 s.
  5. **Hazards:** announced by voice and on screen with a suggestion to move them, plus **"If you choose to continue without moving it — it is your own responsibility."** Buttons: **"I moved it — check again"** (re-runs the scan) and **"Continue at my own risk"**. **Never blocks:** a 12 s countdown, then the warm-up.
  6. `sessionData.environmentScan` records the hazards found and whether the trainee continued with hazards (for the trainee's record and future clinician reports).
- Constants: `ENV_SCAN_COLLECT_MS`, `ENV_VISION_TIMEOUT_MS`, `ENV_SAFE_CONTINUE_SEC`, `ENV_HAZARD_CONTINUE_SEC` in `Training.jsx`.
- *Verification:* client build passes. `Training.jsx` has no component-test setup (camera + MediaPipe), so the flow needs the owner's real-device check.

**2.2b Obstacle detection fix (DONE in code, 2026-10-04; owner report: "I sat on a chair in front of the camera and it said the space is clear")**
- *Root causes (3):*
  1. **Coordinate bug:** `motionEngine.bboxProximity()` read `bbox.x/y`, but MediaPipe ObjectDetector boxes are **pixels** with `originX/originY`. Every object was computed at (0,0), so a chair next to the trainee was "far" on low-clearance profiles (rehab/fitness) and anything anywhere was "too close" on high-clearance ones. The obstacle list also missed bags, boxes, plants and similar items.
  2. **AI prompt bias:** it told the model "chair → equipment (dips/step-ups)", so chairs were classified as equipment, not hazards. There was no movement-zone definition and no rule for a seat the person sits on.
  3. **The AI reply silently became "safe":** a 500-token limit (Hebrew is token-heavy) truncated the JSON, and unparseable or failed responses returned `overallSafety: 'safe'`. The slow Sonnet call also often exceeded the client's 6 s limit.
- *Fix:*
  - The new pure module `client/src/engine/environmentHazards.js` (`findObstacles`): normalizes pixel boxes, builds the **movement zone** (body box + arm's reach on each side, scaled by the sport clearance, down to the floor), and reports objects overlapping it. The obstacle list covers chairs, couches, benches, tables, beds, plants, backpacks/handbags/suitcases, bottles/cups, TVs/laptops, bikes, pets and more. An object must be seen in ≥ 2 frames. **The seat the person sits on** (it contains the hips) gets its own message ("you're sitting on a chair — the warm-up is done standing — move it out of the movement area"). It is ignored for wheelchair users.
  - The AI prompt (`server/services/environmentAnalysis.js`) defines the movement zone (about 1.5 m) and makes **any object inside it a hazard even if it could also be equipment**, with the seat rule and "far objects are not hazards". Output is short (≤ 4 hazards, ≤ 12 words each).
  - AI call: **Haiku vision** (fast), 1200 tokens, no retries. Failures return `aiFailed` / `overallSafety: 'unknown'`, never "safe". The client waits up to 8 s. When only the quick local check ran, the screen and voice say "No obstacles found in the quick check — make sure the space is clear" instead of "the space is safe".
  - Local and AI hazards are merged without double warnings for the same object.
- *Tests:* 10 new tests (`environmentHazards.test.js`): pixel-box normalization, a chair next to the person, a bag on the floor, a far chair ignored, the seated chair → seat message, wheelchair seat ignored, one-frame flicker ignored, clearance widening, person/ball ignored, no person visible. Client: 393 pass, 0 new failures. Server: 8/8.
- *Remaining debt:* the in-workout live safety check (`runSafetyCheck` in the exercise loop) still uses the buggy `bboxProximity`. It should be switched to `findObstacles` when the exercise loop is reworked (Stage 3).

**2.3 Warm-up (about 2.5 min), connected to the scan and the track (DONE in code, 2026-10-04; awaiting a real-device check)**
*Owner decisions:* about 2.5 min (3 × 45 s). Rehab + sport track asks "do you have a ball?" (default: no → air movements; the workout itself uses the ball). The Ghost is shown **by default** in the warm-up, with a toggle. Strict Iron Rule + scanned ROM.
- *Before:* the warm-up came from the legacy `disability` field (`getWarmUpExercises`) and ignored the scan, the per-arm measurement, the track and the mobility aid. A prosthesis user without crutches was told to **"hold the crutches"**. "Bigger circles!" corrections could push past a limited range. There was no Ghost in the warm-up.
- **New pure modules (19 tests in `engine/__tests__/warmup.test.js`):**
  - `engine/limbProfile.js` (`getLimbProfile`): one per-limb view (`ok / limited / prosthetic / absent / no_movement`, level, `trainable`, arm `romCapDeg`). It merges the sources in order of precision: `visionDiagnosis.limbs` → `scanData.limbStatus` → classification + side → legacy fields, plus `armAssessment` (limited arm = measured shoulder peak < 140°; no movement = not trainable), wheelchair and crutches.
  - `engine/warmupPlanner.js` (`planWarmUp`, `needsBallQuestion`): 3 exercises = upper-body mobility (arm circles; single-arm circles if one arm cannot move; with a range note and suppressed "bigger" corrections for a limited arm) + lower-body mobility (side steps for rehab / high knees for sport; **intact-knee raise** for a one-leg amputee, with crutch or wall/chair support text matching the aid; none for wheelchair or bilateral) + a third slot by track: rehab only → trunk twists; rehab + sport / sport only → **sport activation** (football: air kicks with the intact leg, or ball touches with a ball; basketball: air chest passes / wall passes with a ball; tennis: shadow swings). Every exercise carries **its own screen + voice instructions** and keeps the existing movement analyzer.
  - `engine/warmupGhost.js` (`ghostPose`, `drawWarmupGhost`): an animated demo figure in a corner panel. Absent / non-trainable limbs are **not drawn**; a below-knee prosthetic shank is dashed and not animated (the stable support leg); arm angles are capped at the scanned range; animation is time-based (same speed on every screen); left/right follows the trainee's landmark convention.
- **Training.jsx:** the warm-up list = `planWarmUp(profile, { hasBall })`. After the environment scan, the **ball question** (rehab + football/basketball) is shown, with a 10 s auto-answer "no ball". `warmUpInfo()` prefers the planner's text over the static map (screen + voice). Corrections listed in `suppressCorrections` are skipped. The warm-up Ghost is drawn via `beforeDrawRef` (on by default; the 👻 button toggles it during the warm-up).
- **Scan save:** `visionDiagnosis.limbs` (per-limb status + level) is now stored, for the most precise `limbProfile`.
- *Pacing check (item 8):* the warm-up timer is a 1 s real-time interval and the Ghost is time-based. The scan's refresh-rate bug does not apply here.
- *Verification:* client build passes; 412 tests pass, 0 new failures. The Training page itself has no component tests (camera + MediaPipe), so the owner's device check is needed (Ghost panel position, ball question, the instructions spoken).

**2.4 Owner device-test fixes (DONE in code, 2026-10-05)**
- *Owner report:* "Stage 2 works very well (including the ball question and the flow). Two last fixes: (1) the Ghost looks too basic; (2) warm-up sync: arm circles while sitting are not recognized and the system just carries on."
- **Seated movement (root cause):** the four upper-body warm-up analyzers (`analyzeArmCircles`, `analyzeArmPunches`, `analyzeSingleArmRotation`, `analyzeCoreTwists` in `utils/exerciseAnalysis.js`) returned `moving: false` whenever the posture was `sitting` or `unknown`. A seated trainee doing the exercise therefore froze the movement-locked timer and got "I'm here, start when you're ready" nudges. The posture gate was removed for these four, since their movement is measured from the wrists/shoulders. Core twists now need only the shoulders (hips are often out of frame when seated) and also count a change in shoulder width as movement.
- **Timer sync:** the warm-up timer counts a second if there was movement **now or within the last 1.5 s**. Previously it sampled a single instant per second, which skipped seconds and made the "paused" state flicker at the still ends of a circle or punch. The 20 s re-explain now uses the exercise's own scan-adapted instructions (`warmUpInfo`).
- **Ghost look:** `drawWarmupGhost` was redrawn as a soft, filled silhouette: natural limb thickness, a torso tapered from the shoulders to the waist to the hips, head and neck, hands and feet, a light-to-sky gradient with a soft glow, a floor shadow and a rounded panel. A below-knee prosthesis is drawn as a grey socket + pylon + foot. Kicks are visually distinct from knee raises. No text on the canvas (it is mirrored). Verified by rendering preview images.
- *Tests:* 6 new seated tests (`warmupSeated.test.js`; the fixture is confirmed as `sitting`; 4 of them fail on the previous code). Client: 418 pass, 0 new failures.

**2.5 Second device-test round (DONE ✅, verified by the owner 2026-10-05)**
- *Owner report:* "Seated arm circles are still not read; the Ghost still looks like the old thin lines."
- *Deployment verified first:* the commit was built and served by Vercel (GitHub status `success`; the production bundle at `newapp-ruddy.vercel.app` contains the new code). So these were real bugs, not a stale deploy. Note: `newapp.vercel.app` is someone else's site; ours is **`newapp-ruddy.vercel.app`**.
- **Seated tracking, real root cause:** (1) the exercise `LandmarkStabilizer` (Kalman `measurementNoise` 0.12 + EMA) shrinks a 1 Hz arm circle to about ¼ of its size; (2) `detectMovement` averages motion over 7 points (nose, shoulders, hips, wrists), so two moving wrists on a still seated body fall under the threshold. The previous synthetic tests bypassed the stabilizer, which is why they passed.
  - The warm-up now uses a **light stabilizer** (`WARMUP_STABILIZER_CONFIG`). The exercise stabilizer is unchanged.
  - **Path-based motion** (`recentMotion` in `utils/exerciseAnalysis.js`): path length + spatial span of each wrist (shoulders for twists, 1 s window) over a short window. Small seated movements count; camera jitter does not.
  - Realistic tests (`warmupRealistic.test.js`, 7 tests): frames go through the real stabilizer at 20 fps with camera noise. Small seated circles (r = 4% of the frame), single-arm circles, short punches and gentle twists are detected; sitting still with normal **and double** camera noise is not. 5 of them failed on the previous code.
  - **Friendly standing suggestion:** if the trainee is seated and no movement is read for 10 s, the coach says once per exercise "Great job getting moving! If you can, let's try it standing for a moment. If sitting is more comfortable, keep going — I'm still tracking." It is not offered to wheelchair users or when both legs are affected. Tracking continues while seated.
- **Ghost not visible / looked unchanged, root cause:** it was drawn into the pose canvas, which (1) is CSS-stretched to the screen (a 4:3 frame squeezed into a portrait phone makes the figure thin), (2) is drawn only while a body is detected, and (3) sat in the top corner **under the full-width warm-up feedback banner** and other chips.
  - New `components/WarmupGhostPanel.jsx`: its **own** fixed-size, high-DPI canvas (`drawWarmupGhost(..., { fill: true })`), mid-left of the camera view (a free area), above the overlays, always animating, mirrored like the camera, with a "הדגמה" caption as DOM text. The pose canvas no longer draws the warm-up ghost.
  - Verified with rendered previews of the panel at phone size. A bounds test checks that every move stays inside the panel.
- Client: 426 tests pass, 0 new failures.

### Stage 3: Kinetic Coach Core — Hybrid Architecture

**3.0 (early) — Ghost Overlay & Progressive Range Challenge (MERGED to `main` + production 2026-10-05 at owner's request — the Vercel preview required login; owner device test pending on the production URL)**
*Owner request:* the Ghost can appear as a full-size transparent layer on the trainee's body (sized to their distance from the camera), working at the optimal range from the scan, and gradually challenging the trainee to widen the range when they reach the goals safely. It must be isolated and easy to roll back.
- **Safety mechanism (built first):**
  1. Stable restore point: tag `checkpoint-stage2-stable` (see "Stable Checkpoints").
  2. Developed on the branch **`feature/ghost-overlay`**. `main` / production stay on the checkpoint, and Vercel gives the branch its own **preview URL** for testing. It is merged only after the owner approves.
  3. **Feature flag** `client/src/config/features.js` → `FEATURES.GHOST_OVERLAY`. Setting it to `false` removes the option completely.
  4. **Opt-in:** the default stays the stable demo panel. The full overlay is turned on with a "Ghost: panel / full" button and remembered per device.
  5. **Automatic fallback:** any runtime error in the overlay → it stops, the app returns to the panel (and remembers it), and the trainee sees a short notice. Any error in the range challenge → only the challenge turns off; the warm-up and its tracking keep running.
  6. Existing tracking/analyzers were not changed. All new logic lives in new modules.
- **New modules (11 tests, `engine/__tests__/ghostOverlay.test.js`):**
  - `engine/ghostOverlay.js`: `coverTransform` (normalized camera coords → displayed `object-fit: cover` coords), `bodyAnchor` (hip center + torso length, smoothed, keeps the last anchor when the body is not visible), `overlayPlacement` (Ghost origin at the hips, scale from the torso → bigger when closer).
  - `engine/rangeProgression.js`: the challenge starts at the scanned range (or 120° if not measured); **+5° after 3 consecutive reps that reach the target**; −5° after 3 reps far below it; never above the scanned range + 20° in a session or 170°, never below the start. Rep peaks come from the real shoulder angle (`shoulderAngle`, anatomical sides), with a re-arm so one rep is never counted twice (a bug the tests caught). Applies to the arm-range moves (arm circles, single-arm circles).
  - `warmupGhost.js`: the figure drawing is shared (`drawFigure`) by the panel and the new `drawGhostOverlay` (42% transparent, full size). The Ghost's arm circles **peak exactly at the challenge target** (`targetDeg`).
- **UI:** `components/GhostOverlay.jsx` (own canvas over the camera, mirrored + cover-mapped like the video). A "🎯 Range target: N°" chip. Voice: "Great! Let's widen the range a little" / "Easy — back to the previous range". Per-exercise results go to `sessionData.rangeChallenge` (start / target / max / reps).
- *Verification:* client build passes; 437 tests pass, 0 new failures; rendered previews of the overlay on a portrait phone view. Owner device test on the branch preview URL pending → then merge to `main`.
- **Device-test fixes (2026-10-05; owner: "only the small Ghost shows, my movement is not detected, no big Ghost to follow")**, with the real root causes:
  1. **No big Ghost:** the full overlay was **opt-in** behind a small button (design choice), and its anchor **required visible hips**. Seated close to the camera, the hips are not detected, so nothing was drawn. Fix: the full overlay is the **default** (new storage key `ghostModeV2`; the panel remains an option and the error fallback). When the hips are not visible, the anchor is estimated from the shoulders (torso ≈ 1.67 × shoulder width). Before any body is seen, the Ghost is drawn centered at full height (`defaultPlacement`), so it is always visible.
  2. **Range challenge could never expand on arm circles:** a rep required the arm to return to rest (< 35°). During circles the arm stays at shoulder height, so only the first rep counted. Fix: **cycle-based rep detection** with 15° hysteresis (every circle counts). The default start is 110° (circles just above the shoulder). Visual feedback: the target chip flashes green "+5°", plus the voice line.
  3. **Movement detection made independent of the old pipeline:** the new `engine/warmupActivity.js` reads the **raw** pose landmarks every 50 ms and watches only the body parts of the current move (wrists+elbows / shoulders / knees+ankles) with path-based detection. It feeds the movement-locked timer directly. It does not depend on React state throttling, posture detection, smoothing or the per-exercise analyzers.
  4. **Live on-screen indicator:** "🟢 Movement detected" / "⚪ Waiting for movement", so the owner and Claude can see in real time whether tracking works on the device.
  - Tests: 6 new regression tests (`ghostOverlay.test.js`, 17 total). Every circle counts; 3 circles reaching the target → +5°; seated shoulders-only anchor; default placement; direct activity seated vs. still. **4 of them fail on the deployed version** (confirmed). Client: 443 pass, 0 new failures.
- **Cold start + required limbs in view (2026-10-05; owner: "skeleton detection takes too long at the start of an exercise; the timer started on a leg exercise although the camera didn't see my legs")**, with the root causes:
  1. **Free first seconds:** each warm-up exercise reset `lastActivityRef` to *now*, and the timer counted any second with activity in the last 1.5 s, so the first ~1.5 s always counted, even with nobody in view. On top of that, MediaPipe outputs **guessed** out-of-frame legs, and the per-exercise analyzer could mark them as "moving".
  2. **Slow reaction:** the timer sampled once per second, and activity detection needed ~0.3-0.5 s of accumulated path.
  3. **Model cold start:** the first `detectForVideo` compiles GPU shaders (1-3 s on a phone), and the pose loop only started when "Start" was pressed.
  - **Fixes:**
    - **Required limbs gate** (`warmupActivity.requiredPointsFor` / `pointsInView`): per move, the needed landmarks (arms: shoulder, elbow, wrist of the trainable arms; twist: shoulders; legs: hip, knee, ankle of the **working** leg(s) only, not a prosthetic side) must have visibility ≥ 0.5 **and be inside the frame**, with hysteresis (in view after 150 ms, out after 500 ms). Out of view → the timer is frozen, a clear amber prompt "לא רואים את הרגליים / הידיים / הכתפיים — אנא היכנס למסגרת" + "the count starts when I can see you" appears, the voice repeats it every 10 s, and the generic nudges are skipped. Analyzer movement also counts only when in view.
    - **No free start:** `lastActivityRef = 0` at the exercise start; inactivity nudges measure from the exercise start.
    - **Fast start:** a 200 ms burst check in `recentMotion` (`burst` option), so movement is read within about 4 samples. The timer runs in **200 ms ticks** with a moving-time accumulator and counts movement read in the last 0.8 s.
    - **Model warm-up:** one inference on a blank 256×256 canvas right after loading (`usePose`). The pose loop starts as soon as the camera + model are ready (`Training.jsx`), so the skeleton is already tracked when the first exercise starts.
  - Tests: 7 (`warmupActivityGate.test.js`): required points per move (the prosthetic leg is not required), out-of-frame / low-confidence points are not in view, out-of-frame "moving" legs never count, arms in view count, no flicker on one bad frame, movement detected within ≤ 4 samples, still with jitter → no false start. Client: 460 pass, 0 new failures.
- **Direction swapping for two-way moves (2026-10-05; owner request):** arm circles / single-arm circles go **forward for the first half, backward for the second**.
  - At the halfway point of the exercise's moving time, the coach announces "עכשיו נחליף כיוון — ממשיכים לאחורה", a "🔄 switch direction" banner appears, and the **Ghost reverses at the same moment**.
  - **No jump:** each Ghost component (panel / overlay) keeps its own animation clock that runs backward for `direction: 'backward'`, so the figure continues from the same pose in the opposite rotation.
  - **Direction is visible** even from a frontal camera: the elbow flexes slightly out of phase, so the hand traces an ellipse, plus an amber fading trail with an arrowhead at each hand (`handTrail` / `drawMotionTrail`), and a "כיוון: קדימה ⟳ / אחורה ⟲" chip.
  - **Accuracy does not crash on the switch:** it compares shoulder-angle ranges, which are the same in both directions; the tracker is re-targeted (samples kept). A test checks that accuracy stays ≥ 80% through the switch.
  - Planner: arm-circle ghosts are `directional`, and the limited-range text also mentions the switch. Switch times are saved in `sessionData.directionSwitches`.
  - Tests: 6 (`direction.test.js`): directional flag, elliptical hand path, reversed rotation sense, trail points the opposite way, identical pose at the switch, accuracy through the switch. Client: 466 pass, 0 new failures.
- **Real-time accuracy vs. the Ghost (2026-10-05; owner request, after confirming the overlay + tracking work on device):**
  - New pure module `engine/movementAccuracy.js`. The Ghost animates on its own clock, so the score compares the **range and its position** rather than instant positions: the trainee signal range (p5-p95 over about 2.5 s) vs. the Ghost signal range (the same percentiles over one Ghost cycle, taken **from the drawn Ghost geometry**, so a widened range target is included) → **accuracy = overlap / union**. Too small, too large or shifted (e.g. circles too low) all lower it.
  - Signals: arm moves → shoulder angle per trainable arm; twist → shoulder width relative to its recent maximum; knee raise / kick → thigh vertical extent relative to thigh length. Side steps: no score.
  - Example values: like the Ghost 90%, slightly smaller 80%, 10° too low 73%, half the range 40%, way too low 1%.
  - Shown next to "🟢 Movement detected" as "92% accuracy": **green ≥ 85, yellow 60-84, red < 60**. It is hidden when not moving.
  - Light: computed inside the existing 20 Hz activity loop (no extra loop), smoothed, and UI updates at most every 250 ms. 2000 updates < 200 ms in a test.
  - Isolated: an error turns off only the accuracy display. Per-exercise avg/best go to `sessionData.warmUpAccuracy`.
  - Tests: 10 (`movementAccuracy.test.js`). Client: 453 pass (443 + 10), 0 new failures (the 23 long-standing failures are unrelated and unchanged).
1. Edge processing at 60FPS: MediaPipe + Kalman + local rep counting.
2. Peak Event Triggering: send a single frame + JSON at the peak moment.
3. Sub-second voice feedback from Claude.
4. Neural Emergency Brake (stop on dangerous movement).
5. Real-time fatigue adaptation.
6. Injury Ledger (persistent injury tracking).
7. **Motion Silhouette / Ghost (MANDATORY) [Strategy 2026-09, approved 2026-09-28]:**
   - **Built from the profile scan:** a `ghostProfile` is generated **once, at the end of the onboarding Kinetic Scan** (and regenerated on every rescan), and saved in Firestore next to `scanData`. It contains:
     - **Body proportions:** the trainee's own segment lengths (upper arm, forearm, thigh, shin, torso) measured from scan landmarks. This replaces the generic `SEG` ratios in `useGhostSkeleton.js`.
     - **Per-joint ROM limits** from `scanData.bodyMap`.
     - **limbStatus + prosthetics:** absent or non-trainable limbs are not animated (Iron Rule). Prosthetic limbs are drawn by their actual function.
     - **Compensations** from `compensationMap`, so the ghost demonstrates the *corrected* pattern.
   - **Gap to close:** `scanData` does not store body proportions today. The existing onboarding scan gets a small output extension (a `buildGhostProfile()` step next to `ScanDataBuilder`) with **no new user-facing step** in onboarding.
   - An animated silhouette (smooth body shape, not just a stick skeleton) that shows the target movement.
   - **Progression:** target angles start inside the scanned ROM and move gradually toward the healthy range as the trainee improves (updated by rescans / Stage 4 ROM tracking).
   - **Sync:** the silhouette's tempo follows the prescribed rep tempo. Deviation between the trainee and the silhouette feeds the form score.
   - Upgrades `useGhostSkeleton.js` instead of replacing it.
8. Form Degradation Curve.
9. Automatic Progressive Overload engine.
10. Injury prediction from movement patterns.
11. **Sport-Specific Rehabilitation tracks [Strategy 2026-09]:** *(track selection + prompt TRACK block moved forward and DONE in Stage 2.1; remaining here: a sport-drill library tagged by required limbs)*
    - A new profile field, `trainingTrack`: `rehab_only` | `rehab_sport` | `sport_only`, plus `rehabSport` (the chosen adapted sport). It is selected on the Sport/Goals pages; rehab remains always available.
    - `buildWeekPrompt()` gets a TRACK block: in `rehab_sport` the week mixes rehab exercises with sport drills adapted to the limitations (e.g. rehab + amputee football: crutch-based drills, ball control on the healthy leg, upper-body strength for crutch sprinting).
    - A sport drill library tagged by required limbs, so the Iron Rule filters it the same way it filters sports.
    - The trainee can switch tracks at any time without losing history.
12. **Adaptive Coach Styles [approved 2026-09-28]:**
    - A `coachStyle` profile setting with defined personas, for example:
      - **Encouraging:** calm, patient, positive, slower speech (default for `rehab_only`).
      - **Balanced:** supportive but demanding (default for `rehab_sport`).
      - **Aggressive:** high-energy prodding, fast speech (current style, rate 1.35; default for `sport_only`).
    - The default follows `trainingTrack`, and the trainee can change it in settings.
    - The style controls: TTS rate and pitch in `useSpeech.js`, the phrase bank (Hebrew + English), feedback frequency, and the tone instructions in the Claude prompts (`claude.js`, real-time coaching, workout summary).
    - **Automatic softening:** in any style, the coach switches to a calm tone on pain reports, a readiness score of 1-2, or an Emergency Brake event.
13. **Two-Way Voice Conversation [approved 2026-09-28]:**
    - **Phase 1 (free):** browser `SpeechRecognition` / `webkitSpeechRecognition` (`he-IL` + `en-US`) on web, and native speech APIs (iOS Speech / Android SpeechRecognizer) in Stage 7.
    - Short command intents: "pain in [body part]", "one more", "change exercise", "I need a break", "stop", "repeat". Commands are parsed locally by keyword; free speech goes to Claude.
    - **Echo guard:** pause recognition while the coach's TTS is speaking, so the coach does not hear itself.
    - Graceful fallback: if recognition isn't supported (e.g. Firefox), large on-screen buttons provide the same commands.
    - Known limitation: Chrome's Web Speech recognition sends audio to Google's servers and needs an internet connection.
    - *Future note:* consider cloud STT (e.g. Whisper / Google Cloud STT / Azure) only if exceptional accuracy is needed.
14. **Feedback Policy — Critical-Only Interruption [approved 2026-09-28]:**
    - Errors are classified into two levels:
      - **Minor / harmless:** the coach stays **silent** during the rep. At most, it notes the error between sets if it repeats.
      - **Critical:** a dangerous angle or injury-risk error (e.g. knee valgus under load, lumbar hyperextension, exceeding the scanned ROM, loading a non-trainable limb). The coach reacts **immediately** with a short, sharp alert, and on repetition triggers the Emergency Brake (#4).
    - Danger thresholds are **personal**: derived from `ghostProfile` ROM limits and `riskZones`, not generic values.
    - **Design for Stage 4B:** thresholds are computed by a single `getEffectiveLimits()` function, so clinician-set limits (4B) can later be merged in as the strictest layer without rewriting the coach.
    - Critical alerts use a local, pre-generated phrase (zero latency) and never wait for Claude.
15. **Pain Traffic Light Protocol [approved 2026-09-28]:**
    - Pain is reported by voice (#13), by tapping a body map on screen, or when the coach asks after a suspicious movement.
    - 🟢 **0-3 Green:** continue as planned.
    - 🟡 **4-5 Yellow:** automatic load reduction (fewer reps, less range, longer rest, or a regression exercise), a calm tone, and a re-check after the set.
    - 🔴 **>5 Red:** emergency stop of the exercise (Emergency Brake #4), a calm safety message, and an **Injury Ledger entry** (#6: body part, score, exercise, movement context, date).
    - **Recurrence prevention:** the Injury Ledger feeds `buildWeekPrompt()` and the next workouts, so exercises that provoked red pain are avoided or regressed. The coach checks that area at the start of the next workout.
16. **Personal-Baseline Movement Analysis [approved 2026-09-28]:**
    - **No generic left/right symmetry** metrics (they are meaningless for amputees and complex disabilities).
    - Every metric (ROM, depth, speed, smoothness, compensations) is compared **only to the trainee's own `ghostProfile` / baseline** from the profile scan and their own history.
    - Feedback is phrased relative to the trainee ("deeper than your baseline", "your hip drop is back to your normal level").
17. **Coach Notebook — Long-Term Memory [approved 2026-09-28]:**
    - After each workout, Claude writes a short structured summary (performance, pain reports, what motivated the trainee, notable events, a follow-up question) and saves it to Firestore (e.g. `users/{uid}/coachNotebook/{workoutId}`).
    - At the start of the next workout, the latest entries are loaded into the coaching prompt, and the coach **opens with a personal question** that fits the trainee's state (e.g. "Last time your left knee hurt at level 4. How is it today?").
    - The notebook is compact: recent summaries are kept in full and older ones are condensed, to keep prompts short.

### Stage 4: Analytics + Load Adaptation
1. Detailed per-workout report (form scores, reps, fatigue curve).
2. Progress charts over time.
3. Load adaptation: 2-3 declining workouts -> auto-reduce.
4. Detect excessive ease -> auto-increase.
5. Recovery scoring between workouts.
6. History persistence in Firestore.
7. **[Strategy 2026-09] ROM progress reports:** per-joint ROM over time compared with the trainee's own initial scan / `ghostProfile` baseline (no generic symmetry metrics). This is the core value metric for rehab.
8. **[Strategy 2026-09] B2B clinician view:** moved to the dedicated **Stage 4B: Physiotherapist Portal**. Stage 4 builds the report data and components that 4B reuses.
9. **[Strategy 2026-09] Ghost adherence metric:** how closely the trainee matched the silhouette, per exercise and over time.
10. **Pain + Injury history view:** Pain Traffic Light reports and Injury Ledger entries over time, with the exercises that triggered them.

### Stage 4B: Physiotherapist Portal — B2B Dashboard [approved 2026-09-28]
**Timing:** right after the training and exercise stages (3) and the analytics data layer (4). It is a separate area in the web app for clinicians only.

**1. Security & Isolation (hard requirement)**
- **Clinician role:** a Firebase Auth custom claim (`role: 'clinician'`) set only on the server through `firebaseAdmin.js`. A user can never grant it to themselves.
- **Assignment model:** `clinicianAssignments/{clinicianId}_{traineeId}` with `status: pending | active | revoked`. The trainee accepts the link through an invite code or link from the clinician, and the trainee can revoke it at any time.
- **Firestore Security Rules:** a clinician can read a trainee's data (`users/{traineeId}/**`) **only if** an `active` assignment document exists for that exact pair. There is no list or query access to other users. Trainees never see other trainees or clinician-private notes.
- **Server-side enforcement too:** any Express endpoint that uses the Admin SDK (which bypasses the rules) must verify the assignment explicitly before returning data.
- **Rules as code:** add `firestore.rules` to the repo (it does not exist today), plus automated rules tests with the Firebase Emulator (e.g. "clinician A cannot read trainee of clinician B").
- **Audit log:** every clinician read or write of trainee data is logged (`auditLog`: who, what, when).

**2. Clinical Reports & Monitoring**
- A patient list showing each trainee's status (last workout, adherence, pain alerts).
- A full per-trainee report, reusing the Stage 4 components:
  - ROM over time vs the personal baseline (`ghostProfile`), with no generic symmetry.
  - Exercise quality (form scores, Ghost adherence), reps, sets, fatigue curve.
  - Pain Traffic Light history and Injury Ledger entries, with the triggering exercises.
  - Coach Notebook summaries (read-only).
- **Red-flag alerts:** a red pain event, repeated yellow events, or ROM regression highlight the trainee in the list.

**3. Clinical Limits ("Boundaries") — enforced in real time**
- The clinician defines per-trainee limits in `users/{traineeId}/clinicalConstraints/{id}`:
  - Max or forbidden ROM per joint (e.g. "knee flexion ≤ 90°").
  - Forbidden movements or exercises (e.g. "no jumping", "no deep squat").
  - Load limits and an optional expiry date (e.g. "until 2026-11-01").
- **Write access:** only the assigned clinician can write. The trainee can only read.
- **Enforcement:** `getEffectiveLimits()` (Stage 3 #14) merges three layers and always takes the **strictest** value: clinician limits, then scanned ROM (`ghostProfile`), then general safety rules.
  - The **Ghost** never demonstrates beyond the effective limit.
  - The **coach** gives an immediate critical alert when the limit is crossed, and repeated crossing triggers the Emergency Brake.
  - The **plan generator** (`buildWeekPrompt()`) gets a CLINICAL CONSTRAINTS block, so forbidden exercises are never planned.
- Every violation is recorded and shown to the clinician in the report.

### Stage 5: Game Mode + Real-Time Refereeing
**[Strategy 2026-09] Re-scoped:** targets community games and adapted-sport clubs (e.g. amputee football community matches), not professional teams.
1. Computerized refereeing for community games.
2. Player detection + ball tracking.
3. Goal, foul, penalty and out-of-bounds detection.
4. Automatic event management.
5. VAR review with confidence scores.

### Stage 6: Social Platform + Battle Arenas
1. Multiplayer battle system.
2. Competitions between athletes (community-level).
3. Leaderboards, challenges, achievements. **[Strategy 2026-09]** Fairness by classification (compare trainees with similar limitations, or compare each trainee with their own baseline).
4. Public profiles (opt-in, with medical data never public).
5. **[Strategy 2026-09] Community groups:** rehab-center groups and adapted-sport clubs with a group feed and shared challenges.
6. **[Strategy 2026-09] B2B organization accounts:** an organization admin manages staff and trainees, assigns programs, and sees aggregated (anonymized) group progress. Built on top of the Stage 4B clinician role and assignment model.

### Stage 7: Full Mobile App
1. Convert to React Native / PWA.
2. Mobile optimization (GPU, battery).
3. Publish to the App Store and Google Play.
4. Native speech recognition (iOS Speech / Android SpeechRecognizer) for two-way voice (see Stage 3 #13).
5. **Medical sensitivity + regulation [owner decision 2026-09-28: final stage only]:**
   - Health-data privacy compliance (medical data, B2B data processing agreements).
   - Trainee consent flow for sharing data with clinicians/organizations.
   - Product wording as "adapted training", not "medical treatment", to avoid medical-device classification.

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
| `client/src/engine/scan/ScanDataBuilder.js` | Assembles scanData (bodyMap, compensationMap, riskZones, limbStatus) |
| `client/src/engine/scan/frameThrottle.js` | Feeds the ScanSequencer at exactly 30 fps of real time, independent of screen refresh rate |
| `client/src/engine/scan/ArmAssessment.js` | Per-arm (right/left) measurement: shoulder flexion/abduction, elbow range, compensations (Stage 1D) |
| `client/src/engine/scan/ScanSequencer.js` | Scan pipeline state machine (pure logic) |
| `client/src/engine/scan/movements.js` | Guided movement definitions per track + wheelchair overrides |
| `client/src/hooks/useGhostSkeleton.js` | Ghost skeleton (basic). Upgraded to the ROM-personalized silhouette in Stage 3 |
| `client/src/hooks/useSegmentationModel.js` | YOLOv8s-seg browser inference |
| `client/src/hooks/useEquipmentDetection.js` | YOLOv8n equipment detection (16 classes) with detectForScan() adapter |
| `client/src/hooks/useAnatomicScan.js` | Scan logic hook |
| `client/src/hooks/useHaikuVision.js` | Per-rep Claude Haiku vision analysis |
| `client/src/hooks/useAICoach.js` | Real-time AI coaching feedback |
| `client/src/utils/sportLogic.js` | Sport definitions, disability filtering, goals |
| `client/src/utils/motionEngine.js` | Kalman filter, joint angles, safety checks, SPORT_PROFILES |
| `client/src/utils/exerciseAnalysis.js` | Exercise analyzers, orientation/perspective checks |
| `client/src/components/OnboardingProgress.jsx` | 5-step shared progress bar |
| `client/src/i18n/he.json` / `en.json` | Translations |

---

## Background Processes
- **None running** (verified 2026-09-28). A stuck `resume_training.py` process (resuming the already-finished equipment v3 run, running since 2026-09-19 with no progress) was stopped.

---

## Open Technical Debt
- **Deployment (2026-10-04):** all Stage 1D work was committed and pushed to `main` as `b9d336f`, so Vercel redeploys the client. **The server must also be redeployed** (the new vision prompt and diagnosis logic live in `server/`). The owner tests on the deployed site, so check deploy state before diagnosing "still broken" reports.
- **Equipment model never committed:** `client/public/models/equipment_yolov8n_q.onnx` (and `equipment_yolov8n.onnx`, `yolov8s_seg.onnx`) are untracked, so the deployed site cannot load the equipment detector (`useEquipmentDetection.js`). Owner decision needed: commit the model files (3-45 MB) or host them elsewhere.
- **Guided diagnostic tracks never run (found 2026-10-04):** the "Confirm" button after the vision diagnosis (`handleConfirmAndFinish`) ends the scan, so `DIAG_TRACKS` (squats, march, both arms, wrists…) and Phase B are skipped for real users. `ScanSequencer.confirmDiagnosis()` exists but the UI does not call it. Owner decision needed: keep the short scan, or continue into the diagnostic tracks after "Confirm".
- ~~Left/right convention conflict~~: **fixed 2026-10-04** (Stage 1D #3). A real-camera confirmation is still pending.
- **Arm amputees cannot pass the scan gates:** calibration requires all 33 landmarks to be visible, and the full-body gate requires both wrists. A missing arm will halt the scan before the per-arm skip logic can help.
- **23 pre-existing failing tests** (down from 45: the side fix repaired 22). They are stale expectations from before earlier scan upgrades (e.g. `DIAG_TRACKS.NORMAL` expected length 3, actual 10; movements.js track lengths). None were caused by Stage 1D.
- Commit untracked files: `useSegmentationModel.js`, new `.onnx` models (consider Git LFS for large files), `training/` scripts.
- Clean up stray temp files in the repo root (`C:UserszahiyOneDriveDesktoptemp_*.js*`, `.png`, `.pt`).

---

## Change Log
- **2026-09-19:** Stages 1B + 1C completed.
- **2026-09-28:** Stopped the stuck training process. Verified model status. Added the strategic direction (Rehab-Community B2B+B2C, Sport-Specific Rehabilitation, mandatory ROM-personalized Motion Silhouette) inside existing stages 2-7 without reordering. Added the Manifest Update Protocol. Fixed stale sections (1B/1C "NEXT", Background Processes).
- **2026-09-28:** Owner decisions recorded: the Ghost is built from the onboarding profile scan (`ghostProfile`, Stage 3 #7, basic ROM clamp in Stage 2 #6); Adaptive Coach Styles added (Stage 3 #12); regulation and consent moved entirely to Stage 7; the equipment YOLO v1 model is kept and the v3 export was dropped from technical debt.
- **2026-09-28:** Final coach-intelligence decisions added to Stage 3 (#13-17): two-way voice (free Web Speech / native first, cloud STT as a future option), a critical-only feedback policy, the Pain Traffic Light Protocol with an Injury Ledger link, personal-baseline analysis (no generic symmetry), and the Coach Notebook in Firestore. Stage 4 (#7, #10) and Stage 7 (#4) updated to match.
- **2026-09-28:** Added the dedicated **Stage 4B: Physiotherapist Portal (B2B Dashboard)** after Stages 3 and 4: security isolation (custom claim role, assignment model, Firestore rules + emulator tests, server checks, audit log), clinical reports, and clinician limits enforced in real time via `getEffectiveLimits()` (hook added to Stage 3 #14). The Stage 4 #8 clinician view moved to 4B. Stage 6 B2B organization accounts are built on 4B.
- **2026-10-04:** Added **Stage 1D: Onboarding Corrections** before Stage 2: separate right/left arm assessment in the scan (today only `raise_right_hand` exists; bodyMap ROM is per-limb, not measured per joint), and the muscle group step shown only when the `strength` goal is selected. The UX onboarding flow was updated. Stage 2 is now blocked by 1D.
- **2026-10-04:** 1D plan refined per owner: (1) the arm fix is strictly **additive**. No existing scan movement is removed, each arm (shoulder + elbow) is assessed separately, and knee bend, pelvis rotation, tiptoes and walking in place are guaranteed for every non-wheelchair trainee. A gap was noted: the ARM_AMPUTEE track does not assess the remaining arm. (2) The muscle group section is fully hidden for any non-strength choice, with an automatic `full_body` focus.
- **2026-10-04:** **Stage 1D implemented.** (1) Per-arm assessment: `raise_left_hand` plus 3 movements per arm (flexion, abduction, elbow) and walking in place (skipped for wheelchair users) were added to the motion calibration. They went there because the diagnostic tracks never run (the "Confirm" button ends the scan). Measurements are saved in `scanData.armAssessment`, `bodyMap.*.measured` and `romBaseline.arms`, and fed into `buildWeekPrompt()`. Nothing existing was removed. (2) The muscle group section is shown only for the strength goal (Goals, Dashboard and server). 13 new tests, no new failures (339 pass; 45 failures pre-existing). Technical debt recorded: diagnostics skipped by "Confirm", a left/right convention conflict, and arm amputees blocked by the visibility gates.
- **2026-10-04:** **Two critical fixes (owner report).** (1) Side inversion: a left-leg amputee was detected as right. KineticAnalyzer swapped left and right on a raw (non-mirrored) feed, and the vision and verification prompts claimed the image was mirrored. Both were fixed to the anatomical convention, the hip and CoG signals became orientation-independent, and vision frames are unmirrored if the stream is mirrored. 22 previously failing tests now pass. (2) Scan pace: every calibration movement now has a get-ready phase (2.5-6.5 s) and a measurement window of at least 4 s (max 8 s), with an on-screen phase indicator, a countdown bar and a ding cue. Calibration takes about 1.7-2.5 min. Tests: 366 pass, 0 new failures, 23 pre-existing. Awaiting the owner's real-camera check.
- **2026-10-04:** **Critical fix: the scan skipped steps (owner report).** Root cause: the scan loop fed the sequencer at the screen refresh rate (up to 144 Hz) while all windows assume 30 fps, so calibration ran about 5× too fast (about 23 s instead of about 2 min). Fixed with a real-time 30 fps throttle in `useAnatomicScan.feedFrame` (`frameThrottle.js`) and step logging. A new end-to-end 144 Hz test confirms all 12 steps run in order with full windows. Tests: 374 pass, 0 new failures, 23 pre-existing.
- **2026-10-04:** **Owner report: the scan still jumped to results and the report confused the sides.** Found that the owner tested the deployed site (commit `2d69f93`), which has none of the session's fixes. Also added: (1) a hermetic step lock: no movement → the step is repeated with a spoken nudge (up to 3 attempts, then explicitly recorded as not performed), plus range-based walking detection; (2) an accurate per-limb diagnosis: an evidence-based vision prompt, with deterministic classification/side/summary in `server/services/anatomyDiagnosis.js`, plus a per-limb side correction. Tests: client 376 pass (0 new failures, 23 pre-existing); server 8/8.
- **2026-10-04:** Committed and pushed Stage 1D to `main` (`b9d336f`). Remaining: redeploy the server; decide how to ship the untracked ONNX model files.
- **2026-10-04:** Pace and sensitivity tuning (owner feedback). Calibration went from about 103 s to about 68 s (get-ready 1.5-4 s, measurement 2.5-6 s). Five causes of missed movements were fixed: detection during get-ready, a relative hand-raise baseline, either-knee bend, the full-body gate bypassed during calibration, and lower thresholds. 7 new tests, including no false positives. Committed and pushed as `769ffba` (client only; no server redeploy needed).
- **2026-10-04:** Instant results after the last scan step. The vision diagnosis now runs in the background from the `slight_bend` step, and the end-of-scan 2 s stand-still was replaced by the standing-still frames from the first get-ready phase. The last step jumps straight to the results screen. Committed and pushed (client only).
- **2026-10-04:** Stage 2 started. Owner decisions recorded: no manual disability questions, a track choice (clean rehab / rehab + sport), a warm-up of about 2.5 min, and a non-blocking space scan with an own-responsibility notice. **2.1 done:** the new `RehabSelection` with a read-only `ScanFindings` card and track/sport choice; Profile's manual disability fields replaced; the track is sent to the plan prompt plus a cross-sport filter fix; the scan correction path shows the corrected diagnosis for confirmation; the "Report error" pause bug fixed. Tests: client 383 pass (0 new failures), server 8/8. Committed and pushed (client + server — server redeploy needed).
- **2026-10-04:** **Stage 2.2 implemented (owner report: the environment scan was skipped).** Root cause: the warm-up was deliberately run before the scan, and the scan required the object detector. New flow: scan → warm-up. A 6 s bounded AI check, never blocking; hazards are announced with a "move it" suggestion and an own-responsibility notice, with re-check / continue buttons and an auto-continue after 12 s. Build passes; awaiting a real-device check. Committed and pushed (client only).
- **2026-10-04:** Stage 2.2b obstacle-detection fix (owner: a chair was ignored). Fixed the pixel/normalized bbox bug, added a movement-zone obstacle module with seat handling (10 tests), the AI prompt now treats in-zone objects as hazards, faster Haiku vision with no silent "safe" on failure, and honest wording when only the quick check ran. Committed and pushed (client + server — server redeploy needed).
- **2026-10-04:** **Stage 2.3 implemented.** New `limbProfile` / `warmupPlanner` / `warmupGhost` modules (19 tests): a 3 × 45 s warm-up from the scan's per-limb data + aid + track + sport, its own instructions per exercise (no crutch text for prosthesis users), suppressed range-pushing corrections for limited arms, the ball question for rehab + sport, and a default-on warm-up Ghost that hides non-trainable limbs and caps arm angles at the scanned ROM. The scan now saves `visionDiagnosis.limbs`. Stage 2 is code-complete. Committed and pushed (client only).
- **2026-10-05:** Stage 2 device-test fixes. Seated warm-up movement is recognized (the posture gate was removed from the 4 upper-body analyzers; twists use the shoulders only); the timer counts movement within 1.5 s (no skipped seconds or flicker); the re-explain uses scan-adapted text; the Ghost was redrawn as a soft silhouette with a prosthetic socket + pylon. 6 new tests. Committed and pushed (client only).
- **2026-10-05:** Second device round. Verified the deploy was live (real bugs). Seated tracking: a light warm-up stabilizer + path-based motion detection (`recentMotion`), realistic stabilizer + noise tests, and a friendly "try standing, I'm still tracking" suggestion. Ghost: moved to its own unstretched panel (`WarmupGhostPanel`) mid-left, no longer hidden under the feedback banner. Committed and pushed (client only).
- **2026-10-05:** **Stage 2 closed and verified on device by the owner** (environment scan, warm-up adaptation, seated tracking, Ghost panel). Stable restore point tagged `checkpoint-stage2-stable` (git tag, pushed). Added the "Stable Checkpoints" section with restore instructions. Next: Ghost Overlay & Progressive Range Challenge, built on the branch `feature/ghost-overlay` behind a feature flag.
- **2026-10-05:** Stage 3.0 (early) Ghost Overlay & Progressive Range Challenge built on the branch `feature/ghost-overlay` (not on main): feature flag, opt-in toggle (panel stays default), automatic fallback to the panel on any overlay error, and a challenge that disables itself on error without affecting the warm-up. New modules `ghostOverlay` / `rangeProgression` + a shared Ghost figure (11 tests). Awaiting the owner's test on the Vercel preview URL before merging.
- **2026-10-05:** Merged `feature/ghost-overlay` into `main` (fast-forward) at the owner's request (the Vercel preview URL needed a login) and deployed to production. Build passes; client 437 / server 8 tests pass, 0 new failures. Rollback if needed: Vercel "Promote to Production" on the `checkpoint-stage2-stable` deployment, or set `FEATURES.GHOST_OVERLAY = false`.
- **2026-10-05:** Ghost overlay device-test fixes: full overlay by default and always visible (shoulder fallback / centered default), cycle-based reps so the range challenge expands on circles (+5° with a green flash + voice), direct raw-landmark activity detection feeding the timer, and a live "movement detected" indicator. 6 regression tests (4 fail on the previous deploy). Pushed to main.
- **2026-10-05:** Real-time accuracy % vs. the Ghost (range + position overlap) next to the movement indicator, colour-coded green/yellow/red, light and isolated. 10 tests; 453 pass. Committed and pushed to main (client only).
- **2026-10-05:** Warm-up cold start + required-limbs gate: no free first seconds, the required limbs (working leg / arms / shoulders) must be in view or the timer freezes with an amber "step into the frame" prompt, 200 ms burst detection + 200 ms timer ticks, a GPU warm-up inference, and the pose loop starts as soon as the camera is ready. 7 tests; 460 pass. Committed together with the direction swapping.
- **2026-10-05:** Direction swapping for arm circles: a voice + banner announcement halfway, the Ghost reverses continuously (direction-aware animation clock), an elliptical hand path + amber trail with arrows + a direction chip, and accuracy stable across the switch. 6 tests; client 466 pass. Committed and pushed together with the cold-start / required-limbs fixes.

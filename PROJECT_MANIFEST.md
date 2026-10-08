# Project Manifest — AI Kinetic Training Platform
## Last Updated: 2026-10-05

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
| `checkpoint-stage2-stable` | (see `git show checkpoint-stage2-stable`) | 2026-10-05 | Stages 0-2 complete and verified on device: scan (per-arm, side fix, pacing, lock, accurate diagnosis), track selection, environment scan + obstacles, scan-adapted warm-up with ball question, seated tracking, Ghost demo panel |
| `checkpoint-stage2-final` | (see `git show checkpoint-stage2-final`) | 2026-10-05 | Everything above + the full-body Ghost overlay, progressive range challenge, real-time accuracy %, required-limbs-in-view gate, instant start, synchronized direction swapping — all verified on device. **Restore point before Stage 3.** |
| `checkpoint-stage3.1-profiles` | `273d096` | 2026-10-05 | Everything above + Stage 3.1 Expert Execution Profiles (17 expert + family coverage of every exercise), temporal motion engine, sport library, dynamic Ghosts, required-limbs gate in exercises. Build + all new tests pass and it is deployed; **not yet verified on device**. Restore point before the validation / rep-counting work. Flag `FEATURES.EXPERT_PROFILE = false` turns the 3.1 layer off without a revert. |

**Every restore point, oldest → newest (all are git tags pushed to GitHub; any of them can be restored):**

| # | Tag | Commit | Deployed? | State it restores |
|---|---|---|---|---|
| 1 | `checkpoint-stage2-stable` | `ddf4af4` | yes | Stage 2 verified on device (scan, track selection, environment scan, adapted warm-up, Ghost panel) |
| 2 | `checkpoint-stage2-final` | `454bc17` | yes | + full Ghost overlay, range challenge, accuracy %, required-limbs gate — **last state verified on device** |
| 3 | `checkpoint-stage3.1-profiles` | `273d096` | yes | + Stage 3.1 Expert Execution Profiles, temporal motion engine, sport library, dynamic Ghosts |
| 4 | `backup-2026-10-06-pre-local-mediapipe` | `9f08c08` | no (deployed together with #5) | + positioning coach ("now I can see you"), confidence gate, internal validation tool |
| 5 | `backup-2026-10-06-pre-ghost-equipment-fix` | `39a1a74` | yes | + local MediaPipe assets (fast first load), exercise demo Ghost from the briefing, ROM gauge only for dynamic reps |
| 6 | `backup-2026-10-06-pre-catalog` | `90e4dc3` | deployed together with #8 | + Ghost on by default everywhere, old skeleton retired, hard equipment / ball match (dashboard ball question, substitutions, server guard) |
| 7 | `backup-2026-10-06-catalog-v1` | `7cbcc68` | deployed together with #8 | + exercise catalog (pattern × variation, Ghost for every exercise, ~350 per family), coherent goal sessions, timed exercises — **before the track / goal lock fixes** |
| 8 | `checkpoint-2026-10-06-locked-chain` | `66c98bf` | yes | + the locked chain track → goals → day goal → exercises → Ghost (goals per track, rehab session goals, unrelated sports removed) |
| 9 | `checkpoint-2026-10-06-start-gate` | `1f714d0` | yes | + start gate (no false start), exact rep counting, steady Ghost size, functional exercises per sport / limitation, drive voice |
| 10 | `checkpoint-2026-10-06-functional` | `5a9761f` | yes | + no generic filler in sport / rehab tracks, amputee football = 4 functional categories in the sport's language, equipment set-up only where used |
| 11 | `checkpoint-2026-10-06-checkin` | `a4947f5` | yes | + kick volume, big Ghost, split balance sets, crutch safety, daily check-in, one-leg crutch work, ball-day technique, arm-amputee / goalkeeper adaptation |
| 12 | `checkpoint-2026-10-06-front-view` | `73ee592` | yes | + instant counting, distance-sized Ghost on the body for every exercise, true left / right splits, no crutch wording with a prosthesis, grouped kicks, front-view measurement |
| 13 | `checkpoint-2026-10-06-pro-ghost` | `ad47b25` | yes | + early start with an immediate count, steady feet-anchored 3/4-view Ghost, a full set per leg for kicks, shadow ball, wide camera |
| 14 | `checkpoint-2026-10-08-real-kick` | `2ae70ef` | yes | + instant big Ghost, laces / inside-of-foot striking surface, One Euro steady skeleton, realistic kick / pass |
| 15 | `checkpoint-2026-10-08-coach` | `2036591` | yes | + big Ghost performance fix (no blur, 1.5x density), virtual male / female coach, no automatic moves between exercises + voice 'next' |
| 16 | `checkpoint-2026-10-08-controls` | `72802e3` | yes | + Ghost / coach control strip below the camera, fresh Ghost mode key, coach selection screen |
| 17 | `checkpoint-2026-10-08-pro-coach` | `ddbb81f` | **yes — the current production (2026-10-08)** | + high-contrast big Ghost, professional coach silhouettes, voice next only on the explicit phrase (mic off while the coach speaks), the female coach speaks in the feminine |

**How to return to a checkpoint:**
- **To a deployed point (#1, #2, #3, #5, #8, #9, #10, #11, #12, #13, #14, #15, #16, #17): instant rollback with no code change** — Vercel → Deployments → the deployment of that commit → "Promote to Production".
- **To any point in the code:** `git checkout <tag>` to look at it, or create a branch from it (`git checkout -b restore-<n> <tag>`) and deploy that branch / merge it into `main` after approval.
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
| 3 | Kinetic Coach Core — Hybrid Architecture | **IN PROGRESS** (3.0 DONE ✅; **3.1 Expert Execution Profile — code + tests done, awaiting the owner's device check**) | Approved 2026-10-05. Includes the **scan-calibrated Ghost**, **Sport-Specific Rehab tracks**, **Adaptive Coach Styles**, **Two-way voice**, **Critical-only feedback**, **Pain Traffic Light**, **Personal-baseline analysis**, **Coach Notebook** |
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

**3.0 (early) — Ghost Overlay & Progressive Range Challenge (DONE ✅ — verified by the owner on device 2026-10-05: full overlay, accuracy %, required-limbs gate, synchronized direction swap)**
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
**3.1 — Expert Execution Profile per exercise (IN PROGRESS — code + tests done 2026-10-05, awaiting the owner's device check)**
*Owner request (2026-10-05):* start Stage 3.1 with an "Expert Execution Profile" for every exercise: (1) a kinematic model — the angles each exercise needs (e.g. knee/hip in a squat, elbow in a push-up), the allowed range, and when a movement is wrong or dangerous; (2) precise limb enforcement — the exercise's own limbs must be in the camera frame (no leg exercise approved without seeing the legs); (3) full sync with the Ghost — the Ghost demonstrates exactly the same correct profile. Also split the overloaded `Training.jsx` into clean modules.
- **Safety:** feature flag `FEATURES.EXPERT_PROFILE` (off → the exercise phase runs exactly as at `checkpoint-stage2-final`). All logic lives in new modules; the existing rep analyzers were not changed. Any runtime error in the module disables it for the session and re-opens the gates, so the old pipeline continues (automatic fallback).
- **New modules (`client/src/engine/exercise/`):**
  - `kinematics.js` — one joint vocabulary shared by the evaluator AND the Ghost: `knee` (hip-knee-ankle), `hip` (shoulder-hip-knee), `elbow`, `shoulder` (elbow-shoulder-hip), `bodyLine` (shoulder-hip-ankle) and `trunkLean` (hip→shoulder vs. vertical). The same `angleCosine` as the rep analyzers. Limbs are measured only if usable (absent / above-knee prosthetic legs and non-trainable arms never; a below-knee prosthesis keeps a real knee → measured).
  - `exerciseProfiles.js` — **14 expert profiles**: squat, mini squat (rehab), lunge, wall sit, hip hinge (deadlift / good morning), push-up, plank, glute bridge, shoulder press, lateral raise, front raise, controlled front raise (rehab), bicep curl, active elbow flexion (rehab). Each has target ranges at rest and at the peak of the rep (or the hold range), **error** rules (coaching, on screen) and **danger** rules (red alert + voice), e.g. squat trunk collapse > 72° = danger, push-up/plank hip sag < 140° = danger. **6 family profiles** (standing legs, arms, full body, floor core, seated arms, upper body) give every other exercise at least the required-limbs enforcement. **All 100 cueKeys of the analyzer map are mapped** (a test enforces it, so a new exercise cannot ship without a profile). `personalizeProfile` caps shoulder targets and the Ghost at the scanned shoulder range (`romCapDeg`).
  - `profileGhost.js` — the Ghost is **generated from the profile** by forward/inverse kinematics (standing side view, split stance, prone on hands / forearms, supine bridge, standing front view): the angles measured on the Ghost equal the profile numbers. Same output shape as the warm-up Ghost, so the existing panel and full overlay draw it (`ghostPose({ profile })`). Iron Rule kept (absent arm / above-knee leg not drawn, below-knee prosthesis = dashed pylon).
  - `profileEvaluator.js` — at 20 Hz on the raw landmarks: required regions in view (legs / arms / torso / body; side view = any one side, front view = every usable arm; hysteresis 150 ms in / 500 ms out), the phase of the rep, rules that must persist ≥ 400 ms (no single-frame false alarms), and accuracy % (reps: overlap of the trainee's primary-joint range with the target range; holds: time inside the hold range; errors cost points).
- **Training.jsx modularization (first cut):** new `hooks/training/useExpertExecution.js` (the whole exercise-phase profile loop, voice and fallback), `components/ExecutionHud.jsx` (missing-limb banner, error / danger banner, profile name + accuracy chip, "stand side-on" hint for side-view profiles), `engine/training/viewPrompts.js` (the "step into the frame" prompts, moved out of Training.jsx and shared with the warm-up), `engine/ghostBody.js` (the shared Ghost body model). Training.jsx only wires them (gate + Ghost + HUD). Further extraction (warm-up loop, environment scan, set/rest flow) continues in the next 3.1 steps.
- **Behaviour in the exercise phase (flag on):**
  1. **Required limbs gate:** while the exercise's limbs are out of the frame (or only "guessed" with low confidence), nothing counts — no reps, no technique cues, no "start moving" nags — and an amber banner + voice (every 10 s) says exactly what to bring into view ("לא רואים את הרגליים — אנא היכנס למסגרת").
  2. **Danger** → red pulsing banner + voice alert (max every 6 s). **Errors** → amber banner only (critical-only voice policy).
  3. **Accuracy %** vs. the profile next to the profile name (green ≥ 85, yellow 60-84, red < 60).
  4. **Ghost of the same profile:** the 👻 button shows the profile Ghost (panel, or the full overlay for standing exercises; floor exercises always use the panel) instead of the old skeleton. Exercises with only a family profile keep the old Ghost.
- **Tests (25, `engine/exercise/__tests__/exerciseProfiles.test.js`):** coverage of every cueKey; profile well-formedness; **Ghost ⇄ profile sync** (Ghost angles = profile angles < 1°, Ghost inside the target ranges at rest and at the peak, zero rule hits on the Ghost over a full cycle, the live evaluator scores the Ghost ≥ 85% with no issues — also personalized); Iron Rule drawing; legs out of frame / low-confidence legs → not approved; upper-body exercises do not need the legs; absent arm never required; hysteresis; squat back collapse and push-up hip sag → danger after persisting; one-frame spikes ignored; shallow-squat error only at the bottom; partial range scores < 60%.
- *Verification:* client build passes; client tests 491 pass (466 + 25), 0 new failures (the 23 long-standing scan-module failures are unchanged). Not yet checked on a device.
- **Sport-depth extension (2026-10-05; owner clarification: the coach must understand and teach EVERY sport the trainee picks — running, tennis, martial arts, rehab, endurance… — with the full movement chain, not dry single-frame angles):**
  - **Principle:** an exercise profile = the movement's intrinsic technique; the **sport library** layers the sport's priorities, errors and explanations on top of it. The same squat is coached as slow control + level pelvis in rehab, as single-leg hip stability for a footballer, and as soft knees for a basketball player.
  - **Temporal motion engine** `engine/exercise/motionFeatures.js` (follows the movement over time, distances scaled by torso length): whole-body **center of mass** (segment-weighted), **weight transfer** (CoM vs. the support foot), **rep tempo** (to-peak / hold / return ms), **foot contacts → shock absorption** (knee flexion in the 250 ms after touchdown, touchdown knee = straightest of the last 100 ms so 20 Hz sampling does not hide it) and **cadence**, **kinetic-chain sequencing** at a strike (proximal segment's peak speed must lead the distal one; no real proximal drive = a limb-only strike), **pelvic drop** (frontal view, hip stability), **sway** (stability in holds), **trunk range** (core control).
  - **Profiles** gained `tags` (movement pattern), `dynamics` (temporal rules), `chain`, and a **`why` explanation** on rules. New expert profiles: **running in place** (cadence ≥ 150-155, soft landing, tall trunk, arm swing), **high knees**, **football kick** (hip → knee sequencing, weight over the support foot, no leaning back). Name overrides fix misleading cueKeys (bear crawl / inchworm → floor; sprints → full body). 17 expert profiles in total.
  - **Dynamic Ghosts:** keyframe animation + a stride skeleton (support leg by FK, swinging leg from the hip, per-side arm swing, alternating sides for running). The running Ghost runs at 171 steps/min with ~16° of absorption on every landing; the kick Ghost leads with the hip 150 ms before the knee with the weight over the support foot. With a prosthesis the Ghost plants on the prosthetic side and kicks with the working leg.
  - **Sport library** `engine/sports/sportLibrary.js`: fitness, rehab, football, amputee football, amputee GK, basketball, wheelchair basketball, tennis, wheelchair tennis, plus library-ready **running, martial arts, endurance**. Each: family, **emphasis** (coaching priorities, matched to the movement pattern), **tempoScale** (strength reps / holds only — a stride or a kick keeps its technical rhythm), and **dynamic rules with sport-worded explanations** (e.g. football: hip stability = ACL/groin risk; amputee football: chest and weight over the crutches; basketball: the knee is the shock absorber in rebounds; running: cadence lowers impact, pelvic drop = weak glute med → IT band). Contexts from the track: rehab only → rehab; rehab + sport → rehab then the sport (**the safer threshold always wins**, so a sport never relaxes the rehab baseline); sport → that sport.
  - **Coaching behaviour:** the HUD shows the correction **and why it matters**, the sport's relevant focus ("🏅 דגש: …") and live cadence when running. Voice stays critical-only, plus: a technique error repeated 3 times in a row is **corrected and explained once per exercise** by voice.
  - **Tests (+34; 59 in `engine/exercise/__tests__`):** every expert Ghost is a clean demonstration (no issues, ≥ 85%) under **every sport and rehab + sport combination**; sport contexts; safer-rule merge; pattern-specific rules and emphasis; rehab flags a fitness-tempo squat and explains it once in rehab terms; a fast drop flagged in fitness; frontal pelvic drop; a swaying plank; running stiff landings and low cadence; a knee-first kick (flagged, < 60%); leaning back; amputee-football crutch rule; below-knee (plant on the prosthesis, kick detected on the working leg) and above-knee kicks.
  - *Verification:* client build passes; client 525 pass, 0 new failures (23 long-standing scan-module failures unchanged).
- **Sport-library roadmap (inside the existing stages — order unchanged):**
  - **3.1 (next steps):** expert + dynamic profiles per sport for the drills the coach already gives — tennis strokes / split step (trunk-rotation chain, needs a rotation metric from landmark depth), basketball shooting / layup / rebound landing, amputee-football crutch kick / crutch sprint / crutch balance, goalkeeper ready position / dive, wheelchair push stroke and seated throws (trunk control), floor core (crunch, bird dog, dead bug); profile-based rep counting to replace the per-exercise analyzers; per-exercise execution results in the session report; fix the `runSafetyCheck` bbox-units bug (use `findObstacles`); continue splitting Training.jsx.
  - **3.x (coach intelligence, items 12-17):** the AI coach receives the profile + sport emphasis + recent temporal events, so its spoken feedback explains errors in the sport's language; the Coach Notebook stores per-sport recurring faults.
  - **Sport selection:** running, martial arts and endurance become selectable sports once their drill profiles exist (sport list + plan prompt), without changing the stage order.
  - **Stage 4 (analytics):** trends of the temporal features per sport (cadence, absorption, chain timing, tempo, pelvic stability) as personal-baseline progress.
- **Next 3.1 steps:** see the sport-library roadmap above, as re-ordered by the owner below.

**3.1 — Approved coaching principles (owner approval 2026-10-05, "100%"). These apply to every exercise, sport and later stage:**
1. **Measurement accuracy before coaching. No guessing:**
   - **Validation dataset:** real recorded reps (landmarks only, never video) labelled by a person as **"good / fault"** (plus which fault). Every rule threshold is tuned and reported against this data (agreement %, false alarms, misses) instead of literature values alone.
   - **Position the trainee like a real coach — never guess, never run a partial workout (owner UX directive, 2026-10-05; replaces "silence when unsure"):**
     - When the camera angle or the trainee's position is not right (camera too low, feet cut off, standing at the wrong angle, too close or too far, off-centre), the coach **immediately says, by voice and on screen, ONE simple and precise instruction**. For example: "step back so I can see you head to toe", "tilt the camera down a little", "move a little to the left", "turn side-on to the camera".
     - Nothing counts while the position is wrong.
     - **Only once the trainee is positioned right** does the coach say **"Great, now I can see you — let's start!"** (later re-positionings: "Perfect, I can see you — carry on").
   - **Trainees never label or rate anything.** The trainee is training, not doing quality control. The "good / fault" labelling of the validation dataset is an **internal tool** for the owner / clinicians only (hidden URL switch `?validate=1`); it never appears in a normal workout.
   - Automatic view detection (front / side); personal calibration from the scan (limb lengths, ROM).
2. **Correction hierarchy and timing:**
   - **One correction at a time**, chosen by importance: **safety → foundation → precision**.
   - Corrections are given **between reps** (at the end of a rep / in the rest phase), **never in the middle of a movement**. The only exception is **danger**, which is immediate.
   - Each fault gets a cooldown, and a fixed fault gets positive confirmation ("exactly like that!").
3. **External-focus cues:**
   - The coach phrases corrections with an external focus (on the floor, the ball, the target), not dry joint commands. For example: "push the floor away" instead of "straighten your knee", "drive your knee toward the ball" instead of "flex your hip". This is research-based: an external focus improves learning and performance.
   - Each fault has several phrasings, and the Coach Notebook (item 17) later learns which one works for this trainee.
4. **Order of the next 3.1 steps (owner-approved):**
   1. **Device check** of the deployed 3.1 (owner), plus fixes from it.
   2. **Validation dataset + confidence gate** (recorder, labelling UI, agreement report; silence when unsure; view detection). **— code + tests done 2026-10-05, awaiting the owner's device check:**
      - **Confidence gate** `engine/exercise/confidence.js`. The coach does not correct when it is unsure:
        - Camera view: front / side / oblique, from shoulder width ÷ torso length. A side-view profile is not judged while the trainee faces the camera, and a front-view profile is not judged from the side.
        - Tracking: mean visibility of the measured points < 0.65, or a primary-joint jump > 45° in 50 ms (a glitch).
        - Hysteresis: about 0.5 s to lose confidence, about 0.25 s to regain it.
        - While unsure: no rules, no danger, no coaching and no accuracy samples. After 2 s the HUD says what to fix ("📐 stand side-on" / "move closer or add light — until then I won't correct, no guessing"). A wrong view is spoken once per exercise.
      - **Clip recorder** `engine/validation/clipRecorder.js`. In validation mode each set is cut into clips: one per rep, one per kick (with the follow-through), or 5 s windows for holds and running.
        - Each clip holds the compact landmarks of 13 points and the system verdict (issues, accuracy, events). Landmarks only: no video, no image, Firestore-safe strings.
        - Untrustworthy stretches (limbs out of view or low confidence) produce no clip.
      - **Labelling:** `components/ValidationPanel.jsx`.
        - Shown after the set (rest or exercise done). Every rep shows what the system said and has 👍 "good" / 👎 "fault" buttons, plus optional fault chips from the profile's rules.
        - Labels are saved together on "Done" to `users/{uid}/validationReps` (`services/validationStore.js`).
        - Validation mode is turned on with `?validate=1` (remembered per device; `?validate=0` turns it off). A 🧪 chip is shown while recording.
      - **Agreement** `engine/validation/agreement.js` + page **`/validation`** (`pages/ValidationReport.jsx`):
        - Per profile and sport context: labelled reps, agreement %, **false alarms** (a good rep was corrected — the worst for trust), **misses**, per rule.
        - **"Check thresholds"** replays every stored rep through the live evaluator with candidate thresholds (±30%) and ranks them (ties: fewer false alarms). Thresholds are chosen from data.
      - Tests (12, `engine/validation/__tests__/validation.test.js`):
        - Confidence gate: view detection; a front-filmed squat is never corrected even with a collapsing back; weak tracking is silenced; one bad frame does not silence.
        - Recorder: the encoding round-trip; one clip per rep / kick, windows for running; no clips from untrustworthy stretches.
        - Agreement: replay reproduces the live verdict; agreement / false alarms / misses / per rule; tuning loosens a too-strict trunk-lean threshold to between the "good" (52°) and "fault" (66°) labels with 0 false alarms and 0 misses.
      - *Verification:* client build passes; client 537 pass, 0 new failures (23 long-standing scan-module failures unchanged).
      - *Note:* the Firestore rules are not in the repo. If saving labels fails on device, the rules must allow `users/{uid}/validationReps` for the owner (like `users/{uid}/workouts`).
      - **Positioning coach (owner UX directive, 2026-10-05)** `engine/exercise/setupCoach.js`:
        - Like a human coach, it returns the single most important fix per frame, in priority order:
          1. Body found ("stand in front of the camera").
          2. Too close / head and feet cut ("step back so I see you head to toe").
          3. Feet cut: "tilt the camera down" when there is room above the head, otherwise "step back — I can't see your feet".
          4. Head cut: "tilt the camera up" or step back.
          5. Leaving the frame or off-centre: "move a little left / right", as the trainee sees the mirrored screen.
          6. Too far: "come closer".
          7. Orientation for the measurement: "turn side-on" / "face the camera".
          8. Clarity: "add light or move whatever hides you". Hidden arms: "keep your arms clear".
        - Feet are required only when the exercise uses the legs. Prosthetic / absent legs follow the Iron Rule; one visible foot is enough side-on.
        - The evaluator's gate is now "positioned right + required limbs" (`setup` in each result). Until then there are no reps, no rules and no nudges.
        - The hook speaks a new instruction once it has been stable for 0.5 s and repeats it every 7 s. When positioned right for 0.7 s: "Great, now I can see you — let's start!" with a green banner (later: "Perfect, I can see you — carry on").
        - HUD: a big amber 📷 instruction, "we start as soon as I see you right".
        - Tests: 15 (`setupCoach.test.js`): every instruction, from shifted / zoomed / turned / dimmed Ghost frames, the prosthesis and upper-body cases, and the evaluator gate guiding and then opening. The confidence tests now check that the coach says how to stand.
        - Client: 552 pass, 0 new failures.
        - *Follow-up:* run the same positioning check before the calibration countdown (today it starts at the exercise phase).
- **Owner fixes, 2026-10-06 (backup tag `backup-2026-10-06-pre-local-mediapipe` = commit `9f08c08`, pushed before the changes):**
  1. **Local MediaPipe (performance, root fix).**
     - *Problem:* the first launch of the day was slow, with QUIC protocol errors and "fallback to ArrayBuffer". The Wasm runtime came from jsDelivr at `@latest` (not even the installed 0.10.32) and the models from storage.googleapis.com.
     - *Fix:* everything is served from our own origin:
       - `client/public/mediapipe/0.10.32/wasm/` holds the SIMD + no-SIMD runtimes (copied from the installed package by `npm run sync:mediapipe`).
       - `client/public/mediapipe/models/` holds `pose_landmarker_lite_f16_v1.task`, `pose_landmarker_full_f16_v1.task` and `efficientdet_lite0_int8_v1.tflite`.
       - One config, `src/config/mediapipe.js`, is used by `usePose`, `useMultiPose` and `useObjectDetection`.
       - `@mediapipe/tasks-vision` is pinned to exactly `0.10.32`, so the Wasm always matches the JS API.
     - **Caching:** `client/vercel.json` serves `/mediapipe/*` with `Cache-Control: public, max-age=31536000, immutable` (the versions are in the paths) and `.wasm` as `application/wasm`, which enables streaming compilation with no ArrayBuffer fallback.
     - **Prewarm:** right after the app opens, during idle time, the exact runtime MediaPipe will choose (same SIMD check) and the pose model are fetched into the browser cache, so the training screen starts immediately.
     - *Verified:*
       - Tests (5, `src/config/__tests__/mediapipe.test.js`): version = installed = pinned; local Wasm identical to the package; models present; no CDN URLs left in the code; immutable cache header.
       - Local server: Wasm 200 `application/wasm`.
       - **Real headless Chromium:** FilesetResolver + PoseLandmarker created from the local files only (runtime 49 ms, model 241 ms, detection runs), with zero external MediaPipe requests.
  2. **Exercise demo Ghost before and during the exercise.**
     - *Root cause:* the profile Ghost was tied to the old 👻 skeleton toggle, which starts **off**, and it existed only in the exercise phase.
     - *Fix:*
       - A separate exercise Ghost switch, **on by default** (remembered per device).
       - The Ghost of the same execution profile (`buildExecutionProfile`, shared with the live evaluation) is shown right after the warm-up: in the **briefing** (top, above the instructions card, labelled "Demo: <exercise>"), the equipment check, the **calibration** and the **exercise** (panel, or the full overlay for standing exercises).
       - Exercises with only a family profile (no expert model yet) keep the old skeleton toggle.
  3. **ROM gauge only where range is really measured.**
     - The gauge is shown only for dynamic repetition exercises (analyzer type `reps` and profile kind `reps`). It is never shown for static holds / stops (plank, wall sit, "static ball stop against the wall", isometric…), technique / ball drills, kicks or running.
     - Rule in `engine/training/rangeGauge.js`; 3 tests.
  - *Verification:* client build passes; client 560 pass, 0 new failures (23 long-standing scan-module failures unchanged).
- **Critical owner fixes, 2026-10-06 (backup tag `backup-2026-10-06-pre-ghost-equipment-fix` = `39a1a74`, pushed before the changes):**
  1. **The Ghost is on by default in the warm-up and through the whole exercise. No old switch hides it.**
     - *Root cause:*
       - Exercises without an expert profile fell back to the old skeleton Ghost (`useGhostSkeleton`), which starts **off** and supports only a few exercises.
       - "Ball stop against the wall", for example, had no demo at all.
     - *Fix:*
       - The old skeleton Ghost is **retired** from the exercise flow, and the 👻 button controls only the new Ghost (on by default, remembered per device).
       - The demo Ghost is shown in the briefing, equipment check, calibration, **every set of the exercise** and the **rest between sets** (top, so the next set is demonstrated).
       - Which Ghost (`engine/training/demoGhost.js`):
         - The expert profile's Ghost.
         - Otherwise an animated movement only when it truly is the exercise's movement: side steps for footwork / defensive slides / agility, the chest-pass motion for passes, trunk rotation for racket strokes.
         - Otherwise none. A misleading demo of a different movement is never shown.
       - The full overlay is clearer (55% instead of 42% opacity).
     - *Coverage today:* **31 of 99 exercise types** have a correct demo. The rest get theirs as their expert profiles are built (the special sport libraries, the next 3.1 step).
     - Owner option: restrict the AI coach to exercises that have a demo until then.
  2. **Hard equipment match (the ball case and all equipment).**
     - *Root cause:*
       - "Do I have a ball?" was never a profile fact. The profile equipment is only none / dumbbells / bands.
       - The ball question was asked only before the warm-up in the rehab + sport track and affected only the warm-up. The plan, generated in advance, kept ball drills such as "ball stop against the wall".
     - *Fix — one rule applied at every point where exercises reach the trainee:*
       - **Ball is a profile fact (`hasBall`):** a fixed "⚽ Do you have a ball? Yes / No" on the dashboard, next to the equipment.
         - If it is unknown and today's workout contains a ball drill, the coach asks before the workout. An explicit tap is saved to the profile and never asked again.
         - No answer within 10 s means no ball for this session only.
       - **`engine/exercise/equipmentFit.js`:**
         - Detects what each exercise needs: a ball (by analyzer + name, excluding look-alikes such as flutter kicks, butt kicks and "balls of the feet"), dumbbells or bands.
         - Replaces an exercise whose equipment is missing with the **same movement pattern without it**, keeping sets, reps and rest and recording what was replaced and why:
           - Ball drills: a kick → shadow kick (which keeps the expert kick profile and its Ghost); dribbling / ball stops → footwork; shooting → shadow shooting; passes → shadow chest pass; strokes / serves → shadow stroke / serve; headers → tuck jumps; goalkeeper ball drills → ready stance.
           - Load equipment: weights / bands → the bodyweight version (goblet squat → bodyweight squat, curls → active elbow flexion, press → push-ups…).
         - The substitute names avoid the word "כדור", because the analyzer map files any name containing it under dribbling (a test caught this).
       - **Applied in:** the plan shown on the dashboard, the training screen (load + after the ball answer) and live plan adaptation.
       - **Server:**
         - The plan prompt states the ball rule ("NO ball → absolutely no ball drills, use shadow drills").
         - A post-generation guard (`server/services/equipmentFit.js`) replaces any ball drill that slipped through when `hasBall === false`.
         - The dashboard sends `hasBall` with the plan request.
  - *Tests:*
    - Client +13: `equipmentFit.test.js` (9: ball and look-alikes, weights / bands, availability, the owner's case, substitutes map to the right analyzer of the same pattern with no missing equipment, shadow kick keeps the kick Ghost, bodyweight versions) and `demoGhost.test.js` (4).
    - Server +2 (10/10).
    - Client 573 pass, 0 new failures.
  - *Server redeploy needed* for the server-side ball guard. The client already enforces the rule on its own.
  - *Found (pre-existing debt):* in the analyzer map the generic keyword "זריקה" comes before the wheelchair entries, so "זריקה כיסא גלגלים" is analysed as standing shooting. The keyword order must be fixed in the special sport libraries step.
- **Exercise catalog + coherent sessions (owner requirement, 2026-10-06; backup tag `backup-2026-10-06-pre-catalog` = `90e4dc3`):**
  - *Owner requirement:*
    1. About 300+ varied exercises per sport, with no boring repeats.
    2. **Every exercise has a live, matching Ghost.**
    3. **Absolute session coherence:** a football speed session is (almost) entirely speed, accelerations and explosive footwork; a rehab + sport session serves the rehab need first, with the sport's tools; every exercise prepares for or supports the session goal, with nothing thrown in from another track.
  - **Architecture: exercise = MOVEMENT PATTERN × VARIATION.**
    - Hand-writing hundreds of exercises, or letting the AI invent free names, cannot guarantee a Ghost. So the catalog is generated from patterns that have a verified Ghost, and **an exercise without a Ghost cannot exist.**
    - `engine/catalog/patterns.js`: 30 patterns.
      - 22 measured expert patterns: the 17 existing ones + 5 new speed / power / balance patterns with Ghosts — **butt kicks, A-skip, acceleration lean (wall march, 45° body lean), single-leg knee-up balance, squat jump** (the Ghost really leaves the floor and lands, which the landing / shock-absorption engine measures).
      - Plus Ghost-move patterns: side steps, knee-lift march, arm circles, trunk rotations, shadow chest pass, shadow forehand, shadow punches, front kick.
      - Each pattern has qualities (speed / acceleration / agility / power / plyometric / strength / endurance / core / stability / balance / mobility / technique / rehab…), sport families, body needs (standing / two legs / floor / arms → the limbProfile and wheelchair filter) and an external-focus coaching cue ("push the floor away", "drop straight down like an elevator").
    - `engine/catalog/catalog.js`: the variations change the exercise AND its Ghost / profile:
      - **Tempo:** standard / controlled 3-1-1 (Ghost ×1.6) / **explosive = fast drive with a controlled lowering**. The Ghost is asymmetric (`toPeakShare`): squat / push / hinge get a fast return; press / raise / bridge get a fast push.
      - **Partial range (rehab):** the Ghost's peak is halfway, and the measured targets move with it.
      - **Side** (left / right / alternating): the Ghost works that leg.
      - **Dose:** the prescription per goal.
      - Ids are `pattern|tempo|range|side|dose`.
    - **Catalog size per sport family: field 357, court 355, racket 355, combat 367, endurance 351, rehab 351, strength 351, seated 359** (25-27 distinct patterns per family). An above-knee amputee or a wheelchair user gets their own subset (no two-leg jumps / nothing standing).
    - *Honest note:* the 300+ come from about 26 distinct movements × variations. Real breadth grows with every new pattern; each new Ghost pattern adds about 12-54 exercises to every family it belongs to.
  - **Coherent sessions** `engine/catalog/sessionPlanner.js`:
    - Nine goals: speed, agility, power, strength, endurance, technique, mobility, rehab, rehab + sport.
    - A template of blocks: **prep** (activation / coordination / mobility) → **main** (only the goal's qualities, with the goal's dose) → **support** (what the goal relies on) → **cooldown** (mobility).
    - Selection: seeded random choice (variety across days and weeks, the same day is stable), never the same pattern twice in a session, never the same exercise twice in a week when an alternative exists.
    - Rehab / mobility: no plyometrics, no explosive tempo.
    - **Rehab + sport:** the main block is rehab / stability with a controlled tempo; the support block is the sport's technique as safe shadow drills.
    - `coherenceReport`: the share of main + support exercises on goal, whether the main block is all on goal, and the list of off-goal exercises.
  - **Plan engine:**
    - `engine/catalog/planBuilder.js`: the AI keeps deciding the **week structure and each day's focus**. Each day's goal is read from the focus (Hebrew / English keywords).
      - Rehab-only tracks are always rehab / mobility.
      - Rehab + sport is always rehab-first.
      - Days without a clear focus rotate goals per sport family.
      - The day is filled from the catalog.
      - Deterministic per user / week / day, so the **dashboard** and the **training screen** show exactly the same session.
    - Dashboard: "🎯 Session goal: <goal>" under each day.
    - Training:
      - A catalog exercise brings its exact profile + Ghost by `catalogId` (not by its name).
      - Timed exercises (intervals "6×10 s", holds "3×30 s") are counted as **seconds of work**, and the clock stops when the trainee is out of position (`timedAnalyzer.js`).
      - With the catalog on, live AI adaptation does not insert exercises without a Ghost.
    - Server prompt: every day has ONE goal written at the start of its focus (fixed vocabulary), and every exercise serves it.
    - Flag `FEATURES.CATALOG_PLANS` (off → the AI exercises as before). Errors fall back to the AI plan.
  - *Tests:*
    - +16 catalog / planner tests (`engine/catalog/__tests__/catalog.test.js`):
      - **Every catalog item in every family has a drawable Ghost.**
      - **Every Ghost variation of a measured pattern** (70+ tempo / range / side combinations) is a clean ≥ 85% demonstration.
      - The side variation moves the right leg; ids round-trip; sizes ≥ 300 per family; body fit (above-knee / wheelchair / below-knee).
      - **A football speed session's main block is 100% speed / acceleration** (10 seeds).
      - **Every goal in every family is 100% coherent.**
      - Rehab + sport is rehab-first with no plyometrics / explosive tempo, and has sport technique in support.
      - Variety and stability; a week has no repeated exercise; an intruder exercise is flagged.
      - Day goal inference; a whole plan rebuilt with a Ghost id + training parameters on every exercise; no catalog exercise needs equipment.
    - +2 timed-analyzer tests; the 5 new patterns pass the all-sports Ghost sweep.
    - Client 590 pass, server 10/10, 0 new failures.
  - **Next (catalog growth, inside 3.1 → special sport libraries):**
    - New Ghost patterns per sport: football — lateral bound, deceleration stop, crossover step, crutch kick / crutch sprint; basketball — shooting form, defensive stance, rebound jump; tennis — split step, lunge recovery; running — wall drill variants, bounding, ankling; martial arts — roundhouse, guard stance, sprawl; wheelchair — push stroke, seated rotations; floor core — dead bug, bird dog, side plank, mountain climber (prone stride base).
    - Each new pattern multiplies into every family it serves.
    - The server prompt moves from free exercises to day goals only (saves AI tokens).
- **The locked chain: track → goals → day goal → exercises → Ghost (owner fix, 2026-10-06; restore point `backup-2026-10-06-catalog-v1` = `7cbcc68`):**
  - *Owner requirements:*
    1. Only the sports relevant to the user — no unrelated sports (e.g. martial arts) unless requested.
    2. The track chosen in the profile decides which goals are shown: rehab → rehab goals (targeted strengthening, stability, range of motion); sport → sport goals (speed, explosive power, technique, agility); rehab + sport → both. Never a goal or exercise unrelated to the track.
    3. From the profile and track to the last exercise with its Ghost, everything locked and 100% matched to the session's goal, with no random exercises.
  - *Root causes found:*
    - The Goals page offered one fixed list to everyone (technique, aerobic, strength, weight loss, speed, flexibility), so a rehab-only trainee was offered speed / weight loss.
    - The sport library and the catalog contained martial arts and a standalone endurance sport, which are not app sports.
    - The day goal could be any goal, not necessarily one the trainee chose.
  - *Fix — one source of truth:* `engine/catalog/trackGoals.js`.
    - **Goals per track:**
      - Rehab only: **targeted strengthening / stability & balance / range of motion**.
      - Sport: **speed / explosive power / technique / agility**, limited to what the sport family can really train. Wheelchair sports today: technique + power. Fitness: strength / endurance / power / mobility.
      - **Rehab + sport:** the three rehab goals + "sport tools in rehab".
    - **The Goals page** shows only the track's goals, with a description and a track-specific subtitle. Goals saved earlier are mapped to today's ids or dropped if they are outside the track.
    - **Selected goals** = the trainee's choices within the track (all the track's goals if none is selected).
    - **Day goal** (`inferGoal`): **always one of the selected goals.** The AI focus only picks among them; otherwise they rotate by day.
    - **Server:** the AI may write a day focus only from the trainee's goals (the dashboard sends their names). The client enforces this anyway.
    - **New rehab session goals:**
      - Targeted strengthening: every main exercise is strength AND rehab (rehab pattern / controlled tempo / partial range).
      - Stability & balance: stability or balance AND rehab.
      - Range of motion: mobility.
      - All rehab goals: no plyometrics and no explosive tempo.
    - The muscle-group focus also applies to targeted strengthening.
    - **Unrelated sports removed:** martial arts and the standalone endurance sport (library entries, explanations, patterns). The library holds the app sports + rehab + fitness + running (the owner named running as relevant; not selectable yet).
  - *Tests:* `engine/catalog/__tests__/chain.test.js` (+23):
    - Only the app sports; no pattern of a foreign family; goals per track; legacy mapping; out-of-track goals dropped.
    - **The full chain for 17 track × sport × body cases** (every app sport, rehab-only healthy / below-knee / above-knee / wheelchair, rehab + 4 sports), with and without selected goals, over a 4-week plan:
      - Every offered goal belongs to the track.
      - **Every day goal is one of the selected goals.**
      - Every day is **100% coherent**, with an on-goal main block and ≥ 5 exercises.
      - Every exercise is a valid catalog id **with a Ghost**, of the trainee's sport family only.
      - Rehab tracks have no explosive tempo or plyometrics.
    - Client 611 pass, server 10/10, 0 new failures.
- **Owner fix cluster, 2026-10-06 (backup tag `backup-2026-10-06-pre-detection-fixes` = `7b9a017`):**
  1. **No false "got you, let's start".**
     - *Root cause:* the calibration stage ended after a fixed 5 s whether or not anyone was in the frame, then said "מעולה, תפסתי את הטווח שלך. יאללה נתחיל!" and started the exercise — a timer, not a detection.
     - *Fix:* a hard **start gate** (`engine/training/coachFlow.js`). It opens only when the trainee is **positioned right** (setupCoach), the **measurement is reliable** (confidence gate) and they are **in the exercise's start position**:
       - Rep exercises: at rest. Holds: inside the hold range. Kicks: standing tall.
       - These must hold continuously for 600 ms. Leaving the position for 400 ms closes the gate again, and flickering detection / background noise never opens it.
     - The expert module now also runs during the calibration. The countdown (3 s) **advances only while the gate is open**; otherwise it shows "⏳ waiting for the start position", and the coach says what to do ("take the start position — exactly like the Ghost", with drive).
     - Calibration angles are collected only from real start-position frames.
     - The start line is honest: "That's it, you're in position — let's start!" (no "I got your range").
  2. **Exact rep counting.**
     - For expert rep exercises the count comes from the profile rep detector (`isValidRep`): a full rest → peak → rest cycle of the primary joint with ≥ 250 ms to the peak and ≥ 200 ms back (no jitter / twitches), only in view, only with a reliable measurement, only during the exercise, from zero every set.
     - The exercise's own analyzer still runs for posture / form / visibility feedback, but its count and count voice are replaced (`profileRepAnalyzer.js`).
     - Timed exercises count **only seconds of real work** (`workingRef`): running in place = a stride / landing in the last 1.5 s; holds = inside the hold position. Standing or sitting idle stops the clock.
     - *Tests:* the Ghost's 5 cycles → exactly 5 reps; standing still and sitting still with landmark noise for 10 s → 0 reps; a twitch is not a rep; running in place counts while striding and not while standing; the analyzer's own counts are dropped.
  3. **The Ghost keeps a steady, proportional size.**
     - *Root cause:* with the hips undetected, the overlay estimated the body size from the shoulder width. Turning side-on, the shoulders overlap, so the Ghost shrank to a dot.
     - *Fix* (`engine/ghostOverlay.js`):
       - The torso is measured shoulder → hip on whichever side is visible (works side-on).
       - The shoulder-width estimate is used only when facing the camera; otherwise the last good size is kept.
       - The size changes at most 6% per update.
       - It is never drawn smaller than about 45% of the view height.
     - *Tests:* +3 (turning side-on does not shrink it; one-side torso; gradual change + minimum size).
  4. **Functional exercises only — no generic filler** (e.g. "point your hands at the wall" — the front-raise cue — in amputee football rehab).
     - `engine/catalog/relevance.js`: per sport, the movement patterns that are functional for it.
       - **Amputee football:** balance on the remaining leg, core, crutch upper body (push-ups, press), the kick, mini squat / hinge / bridge / lunge.
       - **Wheelchair sports:** shoulders, pushing strength, trunk, the sport motion.
       - Football / basketball / tennis / goalkeeper / running each have their own lists.
       - **Rehab only with a leg limitation and healthy arms: no isolated arm raises / curls.** Arm rehab is kept when an arm is limited.
     - **Adapted sport goals:** amputee football → technique, balance & core, upper-body strength, power; wheelchair sports → technique, upper-body strength, power.
     - A goal is offered only when a real coherent session can be built for THIS trainee (sport + body).
     - *Quality fixes found on the way:*
       - An explosive tempo no longer turns a squat into a "speed" exercise.
       - A controlled tempo no longer turns a push-up into a "stability" or "range of motion" exercise.
       - The main block is filled first, so a mobility session no longer loses its patterns to the warm-up block.
       - A unilateral skill may appear per side in a technique session (right foot, left foot, alternating).
       - **Goals rotate over the whole plan**: before this, with 3 days a week and 4 goals the 4th goal never got a day.
  5. **Drive in the coach's voice.**
     - Positioning instructions ("step back…", "tilt the camera…") are now said with **rotating energy lines and the trainee's name**, never the same twice in a row: "יאללה {name}, קום ותן בראש!", "{name}, אני מחכה לך — בוא נעלה הילוך!", "קדימה אלוף, האימון לא מחכה!", "{name}, תראה לי שאתה רעב!"…
     - It is spoken a little faster (1.12).
     - The ready lines are energetic: "מעולה! עכשיו אני רואה אותך — יאללה, תן בראש!".
     - The warm-up "step into the frame" prompt carries the same drive.
  - *Verification:* client build passes; client 634 pass (+ coach-flow, rep-analyzer, overlay and relevance / chain tests), 0 new failures; server unchanged (10/10).
- **Hard rule: no generic filler in sport / rehab tracks (owner, 2026-10-06, after the device check).**
  - *Owner report:* in "rehab + amputee football" the first exercise was "arm circles", with an instruction to "stand by two chairs" — no relation to amputee football or real sports rehab.
  - *Root causes:*
    1. The **warm-up** opened with arm circles in every track.
    2. The catalog's generic mobility group (arm circles, knee-lift march) was in every sport's list as prep / cooldown.
    3. The coach's opening (`speakBriefing`), the re-explain, the idle prods and the exercise cards added the location's equipment set-up ("place two chairs 2 m apart" for ball sports at home) to **every** exercise.
  - *Fix:*
    - **Amputee football** (rehab + sport and sport) is built ONLY from four categories (`AMPUTEE_FOOTBALL_CATEGORIES`):
      - **core:** plank, glute bridge, trunk rotations;
      - **single-leg balance:** knee-up balance;
      - **upper-body strength for the crutches:** push-ups, shoulder press;
      - **kicks:** shadow kick.
      - Every exercise is **named in the sport's language** (`SPORT_LABELS`), e.g. "שכיבות סמיכה — כוח לקביים", "יציבות על רגל אחת — בסיס לבעיטה", "רוטציות גו — כוח סיבובי לבעיטה", with a matching cue.
      - Its goals: targeted strengthening, stability, sport tools in rehab. Range of motion is outside its four categories, so it is not offered.
    - **Arm circles / knee-lift marches are removed from every sport and rehab track.** They remain only in general fitness, and as real range-of-motion work for a limited arm in rehab only.
      - Warm-up: the arm circles are replaced by a functional **push activation** ("דחיפות מתפרצות — הפעלת פלג גוף עליון"; "דחיפות קביים באוויר" only for a crutch user — the owner's earlier rule: no crutch instructions to a prosthesis user).
      - Prep: short plank / single-leg balance holds are real athletic activation.
      - Rehab-only range of motion uses functional ROM work (trunk rotations, hip hinge, lunge).
      - Wheelchair upper-body sessions use pull strength (curls) in support.
    - **Equipment set-up only where equipment is used** (`engine/training/exerciseSetup.js`): marker / ball / cone drills get it; catalog bodyweight / shadow exercises never do. This applies to the briefing, the re-explain, the idle prods and the exercise cards.
    - The idle prods were rewritten with drive (no more "take your time").
  - *Tests:* client 638 pass, 0 new failures. New / updated tests:
    - Amputee football (BK / AK, rehab + sport and sport): every exercise of 4 weeks belongs to the 4 categories and carries the sport's name.
    - No arm circles / knee-lift marches in 10 sport / rehab cases.
    - Sport / rehab warm-ups get the push activation, never arm circles.
    - No equipment set-up for catalog exercises.
    - The crutch / prosthesis wording rule still holds.
- **Kick volume, big Ghost, both legs in balance sets (owner, 2026-10-06; backup tag `backup-2026-10-06-pre-kicks-bigghost-sides` = `fce9d34`):**
  1. **Kick volume.**
     - A new measured pattern with its own Ghost: **shadow pass, inside of the foot** (shorter, controlled swing). It passed the all-sports Ghost sweep.
     - **Every amputee-football session carries a dedicated kick block** of 3 exercises (football: 2), after the support block (`SPORT_SKILL_BLOCK`). Together with the technique work this gives 3-5 kick / pass exercises per session.
     - Kick sets are named **power** (3×6, full force) or **accuracy** (3×10, controlled).
     - **A leg amputee kicks and passes only with the working leg** (never the prosthesis, never "alternating"). A healthy footballer works both feet.
     - Coherence stays 100%: the kick block is the sport's skill volume, outside the goal percentage.
  2. **Big Ghost in every exercise.**
     - The switch is now "צללית: גדולה / קטנה" and appears in every exercise with a demo.
     - **Big:** standing exercises → full size on the body (as in the warm-up); floor exercises (plank, push-ups, bridge) → a large figure beside the trainee (48% of the width, 72% of the height) with no dark box, so the trainee stays visible.
     - **Small:** the corner panel.
  3. **Both legs in balance sets.**
     - Single-leg balance is a **split set** (`bothSides`): each leg gets the full dose (3×30 s → 30 s on each leg).
     - Order: **the base (sound) leg first, then the prosthesis.** A below-knee prosthesis bears weight; an above-knee leg or a wheelchair user gets no split.
     - At the start of every set the coach says clearly: "מתחילים: עמידה על רגל ימין. באמצע הסט נחליף רגל."
     - At half of the set's work: "החלף רגל! עכשיו עמידה על רגל שמאל — הפרוטזה. יאללה, יציב!" — the **Ghost switches legs**, a "🔄 החלף רגל!" banner appears, and a status chip shows "🦵 עמידה על … · חצי 1/2 → 2/2".
  - *Tests:*
    - Every amputee-football session has ≥ 3 kicks, all with the working leg.
    - A healthy footballer kicks with both feet.
    - Balance is split for below-knee (full dose per leg) and not for above-knee.
    - The leg order and the spoken lines.
    - Client 644 pass, 0 new failures.
- **SAFETY — crutches without a prosthesis (owner hard rule, 2026-10-06):**
  - *Rule:*
    - A trainee who moves on crutches without a prosthesis cannot stand on, or switch to, a missing leg. Balance / two-leg standing work is cancelled or pre-adapted to the working leg (or crutch-supported).
    - Only an ACTIVE prosthesis gets the split balance sets.
    - Nothing ever tries to make a crutch user stand on a missing leg.
  - *Risk found:* the leg status comes from the scan classification. A below-knee classification marks the leg "prosthetic" even when the trainee trains on crutches without wearing it, so a crutch user could have received a split set onto that side and a Ghost with a prosthesis.
  - *Fix:*
    1. **`trainingLimbs(lp)`** (`engine/limbProfile.js`): the limbs AS THEY TRAIN. On crutches, a prosthetic leg is treated as absent while training. It is used everywhere training is planned or demonstrated: the training screen (Ghost, evaluation, split sets), the plan on the dashboard and the training screen, and the warm-up planner.
    2. **Body fit:**
       - Crutch users never get two-leg work, neither dynamic (`twoLegs`: jumps, lunges, running) nor a static stance on both legs.
       - A new need, `bilateralStance`, covers squat / mini squat / wall sit / hinge: both legs present, never on crutches. An active prosthesis of any level counts (an above-knee amputee with a prosthesis keeps these rehab staples).
    3. **Split balance sets only with an active prosthesis** (`canSplitLegs`: both legs bear weight, no wheelchair, **no crutches**).
    4. **Balance holds stand only on a weight-bearing leg:** the Ghost never stands on an absent / above-knee side (`supportMustBear`) and draws no prosthesis for a crutch user.
    5. **Crutch wording** (`crutchLabel`):
       - "עמידה על הרגל המתפקדת — יציבות" (crutch support allowed).
       - "בעיטה בצל על הקביים" and "מסירה בצל על הקביים" (weight over the crutches, the working leg kicks).
    6. **Warm-up:** a crutch user with one working leg gets no knee raise (lifting the only leg leaves nothing on the ground); trunk rotations replace it. Kicks on the crutches stay (that IS the sport, crutch-supported).
  - *Tests (+7, `crutchSafety.test.js`):*
    - The training-limbs view.
    - For 3 crutch tracks over 4 weeks: no split, no two-leg standing, working-leg wording, kicks only with the working leg on the crutches.
    - The balance Ghost stands on the working leg and draws no prosthesis.
    - The crutch warm-up has no knee raise / leg switch.
    - An active prosthesis keeps the split.
  - Client 651 pass, 0 new failures.
- **Daily check-in, one-leg crutch work, today's technique, arm amputees (owner, 2026-10-06; restore tag `backup-2026-10-06-pre-checkin` = `30377e7`):**
  1. **Daily check-in before every workout** (`engine/training/dailyCheckIn.js`, `components/DailyCheckIn.jsx`).
     - Before the first exercise the coach asks:
       - **Where do you train today** (home / yard / field / gym).
       - **Is a ball available** (ball sports and rehab + sport).
       - **Prosthesis today, or crutches only** (leg amputees, not wheelchair users).
     - The answers are prefilled from the last check-in (`lastCheckIn`, saved to the profile), and the start is blocked until it is answered.
     - **Today's workout is built ONLY from the answers:** `applyCheckIn` gives the effective profile, and `trainingLimbs(lp, todayMobility)` lets today's answer override the profile / scan. "Crutches today" means the prosthesis is not worn; "prosthesis today" means an active prosthesis even if the scan once saw crutches.
     - The effective profile drives the day's plan (rebuilt after the answers), the warm-up, the Ghost, the safety rules, the equipment fit and the set-up texts. The separate ball question is skipped when the check-in answered it.
  2. **One-leg squats / lunges with crutches.**
     - New measured patterns with Ghosts: **single-leg squat** and **single-leg lunge** (the Ghost stands on the weight-bearing leg).
     - On crutches they are named "סקוואט / לאנג' על רגל אחת — בתמיכת קביים" (crutches at the sides to stabilize).
     - They are a new 5th amputee-football category (`singleLegStrength`) and part of football / basketball / tennis / running / rehab.
  3. **Technique that fits today.**
     - With a ball today, the kick / pass become real ball work with the same motion and the same Ghost, set up for the place: at home, soft control kicks / passes to a wall from 2 m; outside, to a wall / goal / partner from 5–10 m. On crutches the line keeps "על הקביים".
     - Ball variants require the ball (`requiresBall` → the equipment fit) and get the place's set-up text. Without a ball they stay shadow drills.
  4. **Arm amputees / limited arms (e.g. amputee goalkeepers).**
     - No weight on both arms (`twoArms`: push-ups, planks) with an absent / non-trainable arm.
     - Arm patterns work the usable arm (the profiles already measure per usable arm, and the Ghost never draws the absent arm).
     - **Goalkeeper work:** a new **goalkeeper ready stance** pattern (hold, Ghost), plus the goalkeeper's language: "צעדי שוער לצדדים", "קפיצת שוער — זינוק למעלה", "לחיצת כתפיים — כוח לתפיסה ולזריקה", "בעיטת הוצאה בצל".
  - *Tests:*
    - +7 (`dailyCheckIn.test.js`): the questions per profile; prefill / completeness; today overrides the profile both ways.
    - **The same trainee:** prosthesis day → split sets; crutch day → working leg only + crutch-supported one-leg squats / lunges; ball at home → wall ball work requiring the ball; no ball → shadow; crutch-day warm-up has no knee raise.
    - Arm-amputee goalkeeper: no push-ups / planks, goalkeeper work present.
    - The 3 new patterns pass the all-sports Ghost sweep and the variation sweep.
    - Client 658 pass, 0 new failures.
- **Six owner fixes, 2026-10-06 (backup tag `backup-2026-10-06-pre-front-view` = `fdd9278`):**
  1. **Instant rep count.**
     - Before: the count fired only after the full return to the start, so it was heard after the rep.
     - Now a fast-count event (`repCount`) fires **mid-return** of a real rep (after reaching ≥ 80% of the way to the peak, when the return passes 40%), re-arms at rest, and keeps a jitter guard (≥ 180 ms to the peak).
     - The full-cycle `rep` event keeps the tempo rules.
     - Test: the count fires before the trainee is back at the start.
  2. **The big Ghost follows the body size / distance in EVERY exercise.**
     - "צללית: גדולה" draws the Ghost on the body for standing AND floor exercises.
     - Its hips are aligned to the trainee's hips (`drawGhostOverlay` aligns the profile Ghost's hip).
     - Its size comes from the trainee's torso in 3D (`bodyAnchor` with depth), so it scales with the distance and does not shrink when bending toward the camera (test).
  3. **Real left / right split.**
     - A unilateral movement (kick, pass, single-leg squat / lunge, lunge, balance) is ONE exercise whose sets are split between the legs. It is never shown for one side alone.
     - Base leg first, then the other leg or the prosthesis, with each leg getting the full dose.
     - The coach speaks the right action: "מתחילים: בעיטות ברגל ימין … החלף רגל! עכשיו בעיטות ברגל שמאל — הפרוטזה" for kicks, "עמידה על …" for stance work.
     - The Ghost switches the working leg (`splitWorkingSide`), and the chip shows "בעיטות ב… / עמידה על … · חצי 1/2".
     - Trainees who cannot switch (crutches / above-knee / wheelchair) get the working-leg-only version (`sideFitsBody`, `canSplitLegs`).
  4. **No crutch wording for prosthesis users.**
     - Every crutch phrase ("כוח לקביים", "דחיפה על הקביים", "ליבה … ולקביים") now lives only in the crutch labels, used only on a crutches day.
     - With a prosthesis: "שכיבות סמיכה — כוח פלג גוף עליון", "לחיצת כתפיים — כוח כתפיים", "פלאנק — ליבה לבעיטה".
     - Test: no "קביים" in any name / description / tip of a prosthesis user's 4-week plan.
  5. **Similar movements together.**
     - All kicks / passes of a session form one consecutive run, placed where the first stands, in a teaching progression (pass accuracy → pass power → kick accuracy → kick power).
     - A repeated movement sits next to its twin (`groupSimilar`). Tested.
  6. **Front view.**
     - Standing exercises are shown and measured **facing the camera**. The profile Ghost is built in 3D and drawn from the front (`toFront`): the sagittal movement goes into depth, so every angle is exactly the profile's.
     - Hip and shoulder angles are measured against the **trunk axis** (shoulders wider than hips would otherwise add 5-9°).
     - Trunk lean and the torso scale use depth: from the front a forward lean is in z, and a 2D torso would read bending as "too far".
     - The setup coach asks a standing trainee who stands side-on to **face the camera**.
     - Floor exercises (push-up, plank, bridge) accept any view and keep their lying Ghost.
     - Tests were rewritten for the front view (side-on → "face the camera", lean in depth).
  - *Verification:* client 661 pass (+ new tests), 0 new failures; server 10/10; build passes.
- **Six owner upgrades, 2026-10-06 (backup tag `backup-2026-10-06-pre-smooth-ghost` = `88deef1`):**
  1. **Fast start, immediate count.**
     - The execution module now runs from the briefing on. In the briefing and the equipment check it runs *quietly*: no positioning voice over the explanation; danger alerts are still spoken.
     - The first real work (a full rep, a kick, running strides) starts the exercise at once (`earlyRef`), from the briefing, the equipment check or the start countdown. The explanation is cut to one short line ("יפה, התחלת! אני סופר איתך") and the reps already done are counted and said.
     - Kicks done before the start are carried into the kick analyzer's count (`withRepOffset`).
     - In the exercise, the count is said **the moment the rep is done** (`speakCountNow`), cutting any explanation or command in progress. Each number is said once; the AI feedback no longer repeats the number.
  2. **Steady Ghost.**
     - The on-body Ghost's anchor is smoothed by time (position τ 220 ms, size τ 650 ms) with a soft dead-band, so landmark noise does not shake it.
     - Standing exercises: the Ghost **stands on the trainee's feet** (ankles, kept 0.5 s when they flicker) instead of following the moving hips, so it no longer bobs up and down. Floor exercises keep the hip alignment.
     - Keyframe motion is a **monotone cubic** through the keyframes: continuous speed, no stop at each keyframe, no overshoot.
  3. **Kicks / passes: a full set per leg.**
     - A split kick exercise has twice the sets, with the reps per set unchanged (`splitBy: 'set'`). Odd sets use the base leg, even sets the other leg / prosthesis.
     - Each set starts with "סט מלא: בעיטות ב…". The rest before a leg change says "בסט הבא מחליפים רגל: …".
     - The chip shows "בעיטות ב… · סט X/Y" and the Ghost kicks with that set's leg.
     - Balance / one-leg work still switches legs mid-set.
  4. **Professional Ghost look.**
     - Standing exercise Ghosts are drawn in a **3/4 view** (turned 38° for kicks, toward the kicking leg; 26° otherwise). The depth of the movement is visible, and the measurement stays frontal.
     - Far-side limbs are drawn behind the body and shaded; near-side limbs are drawn in front.
     - The figure has tapered athletic limbs with a crisp outline, a jersey, shorts, boots and an oval head.
     - Depth is measured from the planted feet, so in a squat the hips move back and the feet stay put.
  5. **Shadow ball.**
     - In shadow kick / pass exercises the Ghost has a ball. It rests in front of the kicking foot, and at contact it flies toward the camera, growing and fading with a floor shadow. A kick lifts it in an arc; a pass rolls it.
     - Only these two exercises get the ball (`catalogGhostSpec` → `spec.ball`).
  6. **Wide camera.**
     - The camera request is 4:3 (the full phone sensor; 16:9 modes crop the body), 1440×1080, `resizeMode: none`, with zoom set to its minimum (widest) where supported.
     - If the device refuses the wide request, the previous request is used as a fallback.
  - *Verification:* new tests in `engine/__tests__/ghostPro.test.js`; client 673 pass, 0 new failures (the 23 baseline scan failures are unchanged); server 10/10; build passes. Rendered in Chromium and checked visually.
- **Four owner fixes from the field test, 2026-10-06 (backup = restore point #13, `ad47b25`):**
  1. **The big Ghost loads at once.**
     - Cause 1: in the briefing only the small panel was shown. The big Ghost now shows on the body in every demo phase (briefing, equipment check, countdown, exercise, rest).
     - It is drawn from the very first frame (centred until the camera / a body is there) and fades in over 0.25 s.
     - Cause 2: MediaPipe also "guesses" ankles below the picture when the feet are out of view, and the feet-anchored Ghost was drawn there, off-screen. Now only REAL feet (inside the frame, at a plausible leg length) are used. Otherwise the feet line is predicted from the hips + torso, so it always exists and changes smoothly.
  2. **The striking part of the foot.**
     - The standing Ghost has real 3D feet (`footGeometry`): flat on the floor when planted, perpendicular to the shin in the air.
     - Kick (`foot: 'laces'`): the ankle is locked with the toes pointed through the swing, and the **laces** strike.
     - Pass (`foot: 'inside'`): the leg is turned out about 80° from the hip with the ankle locked, and the **inside of the foot** faces the target.
     - The striking surface is an amber patch on the boot, with a burst ring at the moment of contact. It is drawn over the ball so it is always visible.
     - The shadow ball rests exactly where that surface meets it at contact (`contactT`).
  3. **Steady skeleton and Ghost (from the root).**
     - Every landmark goes through a **One Euro filter** (`engine/landmarkFilter.js`): heavy smoothing when still, almost none in fast moves.
     - A missed detection is bridged for 280 ms. A whole-body jump restarts the filter.
     - Detection runs only on a NEW camera frame (no re-detecting the same frame), on a frame downscaled to 640 px (same aspect, so the landmarks are unchanged). This keeps every detection fast on a phone, so no movements are skipped.
     - The pose canvas is not reallocated every frame; the drawing helper is reused.
     - The camera request is 1280×960 (4:3, full field of view).
  4. **Human, realistic kick and pass.**
     - Kick: plant (support knee soft) → loaded backswing (hip back, heel to the seat) → the THIGH drives first with the knee bent → contact with the foot low, chest over the ball → the knee snaps straight → a high follow-through. The timing is real: a slow backswing, then an explosive drive → contact → snap.
     - Pass: a short backswing, the foot low and turned out, a short follow-through toward the target.
     - The support-side arm opens out for balance (arm abduction, drawn only).
     - Kicks / passes are shown in a near-side view (55°), the way technique is taught. The measurement is unchanged.
  - *Verification:* new tests in `engine/__tests__/steadyRealism.test.js` (filter steadiness / lag / gap / jump; off-screen feet; laces / inside geometry; flat planted feet; the ball touching the striking surface). Kick dynamics tests: hip-first chain and balance on the new Ghost; the knee-first test was retimed. Client 682 pass, 0 new failures; server 10/10; build passes. Rendered in Chromium and checked frame by frame.
- **Three owner items, 2026-10-08 (backup = restore point #14, `2ae70ef`):**
  1. **The big Ghost — root cause found and fixed.**
     - A strict canvas probe drew every catalog Ghost, at every phase, for healthy / below-knee / above-knee trainees: no drawing error.
     - The cause was **cost**. The full-screen Ghost was drawn at the device pixel density (3× on a phone) with a canvas blur (`shadowBlur`) on every body part: ~40 ms per frame in Chromium, more than a whole frame. On a phone, with pose detection on the same thread, it loaded slowly, froze, or did not appear.
     - Now there is no blur in the big Ghost and the canvas density is capped at 1.5×: **2.9 ms per frame**, measured.
     - The "Ghost: big / small" toggle is available from the briefing on.
     - Test: no blur, and no runtime error in any exercise.
  2. **Virtual coach (male / female) at the side of the screen.**
     - Chosen in the daily check-in ("מי מלווה אותך היום?": male coach / female coach / no character), remembered on the device and in `lastCheckIn.coach`.
     - The coach (`engine/coachAvatar.js`, `components/CoachAvatar.jsx`) is a real character drawn with the Ghost's body engine: skin, a tracksuit (sleeves, long pants with a stripe), white shoes, hair (short / ponytail), a face that talks (the mouth opens while the coach's voice speaks) and a whistle on a lanyard.
     - It stands at the right side of the screen, opposite the Ghost panel.
     - Behaviour:
       - It **demonstrates** the current warm-up move or exercise: exactly the Ghost's profile, the trainee's limbs (prosthesis included), the striking surface and the shadow ball.
       - It **celebrates** for 3 s after a set or exercise (arms up).
       - Otherwise it **stands ready**, breathing and nodding while it talks, with a speech bubble showing the current coaching line.
     - The voice follows the coach: a matching device voice when one exists for the language, otherwise a lower pitch for the male coach and a higher pitch for the female coach.
     - SAFETY: a runtime error hides only the coach.
  3. **No automatic moves between exercises.**
     - A finished warm-up move no longer jumps to the next one. The coach says "כל הכבוד! כשאתה מוכן — לחץ 'הבא' או תגיד 'הבא'", a "▶ התרגיל הבא" card appears and the Next button pulses.
     - The main exercises already waited for a tap (the "done" screen); it now also says "ממשיכים רק כשאתה מוכן".
     - **Voice "next"** (`useVoiceCommand` + `voiceCommands.js`): the app listens ONLY while waiting for that decision (a finished warm-up move / the exercise-done screen), for short commands ("הבא", "תרגיל הבא", "ממשיכים", "next"…). The coach's own voice is ignored (while it speaks, and 0.9 s after). On browsers without speech recognition the button works as before.
  - *Verification:* `engine/__tests__/coachAndFlow.test.js` (strict-canvas run of every Ghost, no blur, coach modes / demo = Ghost / breathing + talking / drawing, voice commands + echo guard). Client 691 pass, 0 new failures; server 10/10; build passes. Coaches rendered in Chromium and checked.
- **Field test, 2026-10-08 — "the big Ghost does not appear, the coach option does not exist" (backup = restore point #15, `2036591`):**
  - **Diagnosis:**
    - The real `GhostOverlay` component was run in Chromium with a fake camera, on a phone-sized screen with the app's CSS: it draws the big Ghost at once.
    - A strict canvas probe of the training screen's real spec chain (personalized + sport-layered profiles, leg switch, every family / sport / limb profile, every warm-up move) found no runtime error.
    - **Root cause:** on a phone the camera view is only 40% of the screen height. The small Ghost panel (and in the briefing its top placement) sat exactly over the "צללית: גדולה" and 👻 buttons inside the camera view, so they could be neither seen nor pressed.
    - In addition, an old error fallback had saved "panel" on the device permanently (`ghostModeV2`), so the big Ghost never came back.
    - The coach was never shown because no coach is selected by default (`none`), and its only selection was at the bottom of the check-in card, inside the small camera view. On a resumed session the check-in does not appear at all.
  - **Fix:**
    - **A control strip BELOW the camera view** (`components/TrainingViewControls.jsx`), always visible and never covered: Ghost **off / small / big** and coach **male / female / none**. It wraps to two lines on a narrow phone, and is pinned to the bottom in full screen. The old in-camera buttons were removed.
    - A fresh storage key (`ghostModeV3`, default big). An overlay error now falls back for THIS session only and shows the error text (a tap on "big" retries).
    - **Coach selection screen** at the start: a full-screen card with an animated preview of each coach, shown once per device when no coach was chosen yet (also on a resumed session). The coach choice also moved to the TOP of the check-in, with previews.
  - *Verification:* a Playwright run on a 390×844 phone screen with a fake camera: selection screen → coach chosen → small Ghost + coach beside it → a real click on "גדולה" → the big Ghost on the body at once, no error. Client 691 pass, 0 new failures; build passes.
- **Field test #2, 2026-10-08 — "the coach looks like a joke, the big Ghost still does not show, the auto skip is back" (+ the coach speaks in its own gender) (backup = restore point #16, `72802e3`):**
  1. **Big Ghost — invisible on a real picture.**
     - Tested on a BRIGHT synthetic room (white wall, white shirt, dark pants) as the fake camera: after the blur was removed for speed, the pale, outline-less figure at 55% vanished into the wall / shirt and the dark pants. On the earlier green test picture it had looked fine.
     - Fix: the big Ghost now has a high-contrast look (`OVERLAY_LOOK`): a strong cyan body with a thick dark outline (2.6×) at 72% opacity. It is visible on both bright and dark backgrounds, and still has no blur (fast).
     - Also fixed a real drawing bug: the round end caps of every limb were drawn inward, cutting a hole at each joint (`taperPath`, now anticlockwise).
  2. **Professional coach.**
     - The cartoon face, whistle and skin colours were replaced by a clean athletic silhouette, like the figures of professional training apps: a monochrome performance tracksuit with ONE accent colour (blue / rose), a collar + zip line, the accent stripe on the outer edge of the pants, white shoes and a hair silhouette.
     - Each coach has a real body type: male broader shoulders and fuller limbs; female narrower waist, wider hips and lighter limbs (`torsoShape`, `limbScale`).
     - The coach stands on a light studio card. "Talking" is shown by an animated sound wave next to the name, not a moving mouth.
  3. **The auto skip — root cause: the app heard itself.**
     - The voice "next" listened for single words ("הבא", "ממשיכים", "עבור"), and the coach itself says them ("…תגיד 'הבא'", "תרגיל הבא").
     - The phone's recognizer returns the text ~1 s after the audio, after the 0.9 s echo guard, so the app skipped by itself.
     - Fix:
       - Only the explicit phrase ("תרגיל הבא" / "next exercise"), as a short FINAL result, counts.
       - The **microphone is OFF while the coach speaks** and re-opens only 1.5 s after it stops; anything heard in a session that overlapped the coach's speech is discarded.
       - The prompts no longer invite "הבא".
       - A move by voice always shows "🎤 שמעתי 'תרגיל הבא' — עוברים".
     - No other automatic exercise change exists in the code (checked every `setCurrentIdx` / `setWarmUpIdx` / timer).
  4. **The coach speaks in its own gender** (`engine/coachVoiceText.js`): with the female coach, every first-person form the coach says about itself becomes feminine ("אני סופרת איתך", "אני עוקבת אחריך", "אני לא מצליחה לראות", "אני מוכנה"…), in the voice and the speech bubble. Words addressed to the trainee are unchanged.
  - *Verification:* a Playwright run on a phone screen with a BRIGHT fake camera (big Ghost clearly visible); coaches rendered and checked; new tests (explicit phrase only, the mic session rule, feminine forms). Client 693 pass, 0 new failures; build passes.
   3. **Profile-based rep counting with a quality score per rep** (replacing the per-exercise analyzers step by step), including the correction hierarchy, timing and external-focus cues.
   4. **Special sport libraries:** leg amputees (amputee football: crutch kick / crutch sprint / balance / header / goalkeeper), wheelchair (push stroke, seated throws, shoulder protection), running (opened for selection), then tennis / martial arts (trunk-rotation metric) and basketball.
   - Following (already in the roadmap): velocity-based fatigue detection (stop the set at ~20% rep-speed loss or form decay), automatic progression / regression, Pain Traffic Light integration, two-way voice ("why?"), best vs. weakest rep clips with the Ghost in the Stage 4 report.

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
| `client/src/engine/exercise/exerciseProfiles.js` | Stage 3.1 Expert Execution Profiles (kinematic targets, error/danger rules, required limbs, Ghost angles) + cueKey mapping |
| `client/src/engine/exercise/profileEvaluator.js` | Live evaluation vs. a profile: limbs in view, rules with persistence, accuracy % |
| `client/src/engine/exercise/profileGhost.js` | Ghost generated from a profile (FK/IK), drawn by the warm-up Ghost drawers |
| `client/src/engine/exercise/kinematics.js` | Shared joint-angle definitions (evaluator + Ghost) |
| `client/src/engine/exercise/motionFeatures.js` | Temporal analysis: CoM / weight transfer, tempo, landing absorption, cadence, kinetic-chain sequencing, pelvic drop, sway |
| `client/src/config/mediapipe.js` | MediaPipe runtime + model paths (local, versioned, immutable-cached) + idle prewarm |
| `client/public/mediapipe/` | Local MediaPipe Wasm (per version) + pose / object models — never loaded from a CDN |
| `client/src/engine/exercise/equipmentFit.js` | Hard equipment match: what an exercise needs, what the trainee has (ball / weights / bands), substitution by movement pattern |
| `server/services/equipmentFit.js` | Server-side guard: no ball → no ball drill survives plan generation |
| `client/src/engine/training/demoGhost.js` | Which demo Ghost an exercise gets (expert profile Ghost or a truly matching movement, never a misleading one) |
| `client/src/engine/catalog/patterns.js` | Movement patterns of the catalog (Ghost source, qualities, sports, body needs, external-focus cue) |
| `client/src/engine/catalog/catalog.js` | Catalog = pattern × variation (tempo / range / side / dose), each with its Ghost + profile; ~350+ per sport family |
| `client/src/engine/catalog/sessionPlanner.js` | Coherent goal-based sessions (prep / main / support / cooldown) + coherence report + day-goal inference |
| `client/src/engine/training/coachFlow.js` | Start gate (no false start), exact rep validity, real-work monitor, drive voice lines |
| `client/src/engine/training/profileRepAnalyzer.js` | The rep count comes from the profile detector; the analyzer keeps form / posture feedback |
| `client/src/engine/catalog/relevance.js` | Functional patterns per sport / limitation (no generic filler), amputee-football categories, sport-language labels |
| `client/src/engine/limbProfile.js` → `trainingLimbs` | The limbs as they train (crutches → the prosthesis is not worn) — the safety base of all training planning |
| `client/src/engine/training/dailyCheckIn.js` + `components/DailyCheckIn.jsx` | Daily check-in (where / ball / prosthesis or crutches today) → the effective profile of the workout |
| `client/src/engine/training/exerciseSetup.js` | Equipment set-up instructions only for drills that really use equipment |
| `client/src/engine/catalog/trackGoals.js` | Single source of truth: goals per track (rehab / sport / rehab + sport), the trainee's valid goals, legacy mapping |
| `client/src/engine/catalog/planBuilder.js` | Rebuilds the AI week plan's days from the catalog (deterministic, shared by dashboard + training) |
| `client/src/engine/training/timedAnalyzer.js` | Timed exercises: seconds of work, paused when out of position |
| `client/src/engine/training/rangeGauge.js` | When the ROM gauge is shown (dynamic rep exercises only) |
| `client/src/engine/exercise/confidence.js` | Silence when unsure: camera-view detection + tracking confidence with hysteresis |
| `client/src/engine/validation/clipRecorder.js` / `agreement.js` | Validation dataset: per-rep clips (landmarks only) + agreement / false alarms / misses / threshold tuning by replay |
| `client/src/pages/ValidationReport.jsx` | `/validation` page: coach vs. human agreement per exercise, threshold check |
| `client/src/engine/sports/sportLibrary.js` | Sport library: emphasis, sport-specific dynamic rules + explanations, tempo, per-track contexts |
| `client/src/hooks/training/useExpertExecution.js` | Exercise-phase profile loop (20 Hz), voice prompts, automatic fallback |
| `client/src/components/ExecutionHud.jsx` | Exercise HUD: missing limbs, error/danger, accuracy |
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
- **2026-10-05:** The owner verified on device the full Ghost overlay, accuracy %, required-limbs gate and direction swap → Stage 3.0 marked DONE. New restore point `checkpoint-stage2-final` before starting Stage 3.
- **2026-10-05:** **Stage 3.1 started (owner approval): Expert Execution Profile per exercise.** New `engine/exercise/` (kinematics, 14 expert + 6 family profiles covering all 100 cueKeys, a Ghost generated from the profile by FK/IK, a live evaluator), `useExpertExecution` hook + `ExecutionHud` + shared `viewPrompts` / `ghostBody` modules extracted from Training.jsx. In the exercise phase (flag `EXPERT_PROFILE`, automatic fallback): required limbs in view before anything counts, danger voice alerts, error banners, accuracy %, and the Ghost of the same profile. 25 tests (incl. Ghost ⇄ profile sync); client 491 pass, 0 new failures. Not yet committed — awaiting the owner.
- **2026-10-05:** **3.1 sport-depth extension (owner clarification: deep, professional coaching for every sport, not only strength angles).** Temporal motion engine (center of mass, weight transfer, tempo, shock absorption, cadence, kinetic-chain sequencing, pelvic drop, sway), profile tags + dynamic rules + `why` explanations, new expert profiles (running in place, high knees, football kick) with dynamic keyframe Ghosts, and the sport library (12 sports incl. library-ready running / martial arts / endurance) layered per track with a safer-threshold merge. HUD shows correction + why + sport focus + cadence; a repeated error is explained once by voice. +34 tests (every Ghost is clean under every sport); client 525 pass, 0 new failures. Sport-library roadmap recorded inside Stage 3/4. Not yet committed.
- **2026-10-05:** Owner approved the coaching principles (validation dataset with good/fault labels + silence when unsure; correction hierarchy safety → foundation → precision, one at a time, between reps only except danger; external-focus cues) and the order of the next 3.1 steps (device check → validation + confidence gate → profile-based rep counting with quality scores → special sport libraries: amputees, wheelchair, running…). Recorded inside Stage 3.1. New restore point `checkpoint-stage3.1-profiles` (`273d096`, tag pushed). Started step 2 (validation dataset + confidence gate).
- **2026-10-05:** **3.1 step 2 implemented: validation dataset + confidence gate.** Silence when unsure (camera-view detection, tracking confidence, hysteresis; no corrections, only "fix the camera" guidance), per-rep clip recorder (landmarks only) in validation mode (`?validate=1`), "good / fault" labelling after each set saved to Firestore, and the `/validation` page with agreement, false alarms, misses and data-driven threshold checks by replay. 12 tests; client 537 pass, 0 new failures. Not yet committed.
- **2026-10-05:** **Owner UX directive: trainees never label or rate; the coach positions them like a human coach.** New positioning coach (`setupCoach.js`): one precise spoken + on-screen instruction at a time (step back / tilt the camera down or up / move left or right / come closer / turn side-on / face the camera / add light), nothing counts until positioned right, then "Great, now I can see you — let's start!". The validation labelling stays an internal tool for the owner / clinicians (`?validate=1`). Principles updated in Stage 3.1. 15 tests; client 552 pass, 0 new failures. Not yet committed.
- **2026-10-06:** Backup tag `backup-2026-10-06-pre-local-mediapipe` (`9f08c08`: positioning coach + validation work, committed). **Local MediaPipe:** Wasm + models served from `public/mediapipe` (versioned, immutable cache, application/wasm, exact version pin, idle prewarm), no CDN; verified in headless Chromium (runtime 49 ms + model 241 ms locally, zero external requests). **Exercise demo Ghost** on by default from the briefing through the calibration and the exercise (same profile as the evaluation). **ROM gauge** only for dynamic repetition exercises (never static holds / ball drills). +8 tests; client 560 pass, 0 new failures. Ready to deploy — awaiting the owner.
- **2026-10-06:** Backup tag `backup-2026-10-06-pre-ghost-equipment-fix` (`39a1a74`). **Ghost on by default** in the warm-up and from the briefing through every set and rest of the exercise; the old skeleton Ghost retired; demo = expert profile Ghost or a truly matching movement (31/99 exercise types today); clearer overlay. **Hard equipment match:** `hasBall` profile fact (dashboard Yes / No, asked before a workout with ball drills, saved on an explicit tap), `equipmentFit` substitutes by movement pattern everywhere exercises are shown (dashboard, training, live adaptation) + server prompt rule + server post-generation guard. +13 client / +2 server tests; client 573 pass, server 10/10, 0 new failures. Not yet committed — server redeploy needed for the server guard.
- **2026-10-06:** **Exercise catalog + coherent sessions (owner requirement: 300+ exercises per sport, a Ghost for every exercise, absolute session coherence).** Commit `90e4dc3` (Ghost / equipment fixes) + backup tag `backup-2026-10-06-pre-catalog`. Exercise = movement pattern × variation (tempo incl. asymmetric explosive, partial range, side, dose); 30 patterns incl. 5 new Ghost patterns (butt kicks, A-skip, acceleration lean, single-leg balance, squat jump with real flight / landing); 351-367 exercises per sport family, every one with a verified Ghost. Goal-based session templates (9 goals; prep → main → support → cooldown), 100% coherence in tests (football speed = all speed / acceleration; rehab + sport = rehab first, no plyometrics); the AI keeps the week structure, each day is filled from the catalog (dashboard and training identical); timed exercises count seconds of work; server prompt: one goal per day. +18 tests; client 590 pass, server 10/10, 0 new failures. Flag `CATALOG_PLANS`. Not yet committed.
- **2026-10-06:** Restore point `backup-2026-10-06-catalog-v1` (`7cbcc68`, the catalog work committed locally, tag pushed, not deployed) before the owner's track / goal lock fixes. The Stable Checkpoints section now lists **every** restore point (1-7) with its commit, deploy status, what it contains and how to return to it.
- **2026-10-06:** **Locked chain (owner fix): track → goals → day goal → exercises → Ghost.** The Goals page offers only the track's goals (rehab: targeted strengthening / stability & balance / range of motion; sport: speed / explosive power / technique / agility; rehab + sport: both; fitness: strength / endurance / power / mobility); every day's goal is one of the trainee's selected goals; new rehab session goals with rehab-only main blocks; the server may only use the trainee's goals; martial arts and the standalone endurance sport removed. +23 chain tests over 17 track × sport × body cases; client 611 pass, server 10/10, 0 new failures. Not yet committed — awaiting the owner.
- **2026-10-06:** Committed and pushed `66c98bf` (catalog + coherent sessions + locked chain + Ghost / equipment fixes) → deployed to production, verified in the served bundle (rehab goals, "sport tools in rehab", shadow kick, session goal line, ball question present; martial-arts patterns absent). New restore point `checkpoint-2026-10-06-locked-chain` (#8). **The server must be redeployed** for the server-side parts (ball guard, one goal per day from the trainee's goals); the client enforces both without it.
- **2026-10-06:** **Owner fix cluster.** Backup tag `backup-2026-10-06-pre-detection-fixes` (`7b9a017`). (1) A hard start gate replaces the 5 s calibration timer: positioned + reliable + in the start position for 600 ms before anything starts, honest start line. (2) Exact rep counting from the profile detector (full cycles with real durations; idle / sitting / noise = 0), and timed exercises count only real work. (3) The overlay Ghost keeps its size side-on (same-side torso, no shoulder-width shrink, ±6% per update, minimum ~45% of the view). (4) Functional patterns per sport / limitation (amputee football: balance, core, crutch upper body, the kick — no isolated arm raises), adapted sport goals, honest goal feasibility, quality fixes (tempo no longer inflates qualities, main block first, per-side technique, goals rotate over the whole plan). (5) Positioning prompts with rotating drive lines and the name. Client 634 pass, 0 new failures. Not yet committed.
- **2026-10-06:** Committed and pushed `1f714d0` → deployed to production, verified in the served bundle (start-position wait, honest start line, drive lines, balance & core goal present; the old "תפסתי את הטווח" line is still in the bundle only as the fallback when the expert module is off). New restore point `checkpoint-2026-10-06-start-gate` (#9).
- **2026-10-06:** **Hard rule: no generic filler in sport / rehab tracks (owner device report: arm circles + "two chairs" first in rehab + amputee football).** Amputee football = only core / single-leg balance / crutch upper body / kicks, named in the sport's language; arm circles and knee-lift marches removed from every sport / rehab track (warm-up → functional push activation; prep → plank / balance holds; ROM → trunk rotation / hinge / lunge); equipment set-up only for drills that use equipment; drive in idle prods. Client 638 pass, 0 new failures. Not yet committed.
- **2026-10-06:** Committed and pushed `5a9761f` → deployed, verified in the served bundle (push activation, amputee-football labels, drive prods present). Restore point `checkpoint-2026-10-06-functional` (#10).
- **2026-10-06:** **Kick volume, big Ghost, both legs (owner).** Shadow-pass pattern + a 3-exercise kick block in every amputee-football session (power / accuracy sets, working leg only); "Ghost: big / small" in every exercise (on the body when standing, large beside the trainee on the floor); split balance sets — base leg then prosthesis (below-knee), each leg the full dose, the coach calls the start and the switch, the Ghost changes legs, a status chip. Client 644 pass, 0 new failures. Not yet committed.
- **2026-10-06:** **SAFETY: crutches without a prosthesis.** `trainingLimbs` (on crutches the prosthesis is not worn) used by the training screen, the plan and the warm-up; no split sets, no two-leg standing (`twoLegs` / new `bilateralStance`) on crutches; split only with an active prosthesis; balance Ghost only on a weight-bearing leg; crutch wording; no knee raise of the only leg in the warm-up. +7 safety tests; client 651 pass, 0 new failures. Not yet committed (together with the kick / big Ghost / split work).
- **2026-10-06:** **Daily check-in + one-leg crutch work + today's technique + arm amputees (owner).** A pre-workout check-in (where / ball / prosthesis or crutches today, prefilled) rebuilds the day from today's reality and overrides the profile (`applyCheckIn`, `trainingLimbs(lp, todayMobility)`); single-leg squat / lunge patterns (crutch-supported wording); ball-day kicks / passes as real wall / goal work by location; arm amputees get no two-arm floor work, plus the goalkeeper ready stance and goalkeeper language. +7 tests; client 658 pass, 0 new failures. Not yet committed.
- **2026-10-06:** Committed and pushed `a4947f5` (includes `30377e7`) → deployed, verified in the served bundle (check-in, crutch-only option, crutch-supported one-leg work, goalkeeper stance, ball wall work, leg switch). Restore point `checkpoint-2026-10-06-checkin` (#11).
- **2026-10-06:** **Six owner fixes.** Instant mid-return rep count; the big Ghost on the body for every exercise, sized by the 3D torso (distance) and hip-aligned; unilateral work = one exercise split between both legs (kick / stand wording, Ghost switches leg; working leg only on crutches); no crutch wording for prosthesis users; kicks / passes grouped in one run; standing exercises measured and demonstrated FACING the camera (3D front Ghost, trunk-axis hip / shoulder angles, 3D trunk lean and torso). Client 661 pass, server 10/10, 0 new failures. Not yet committed.
- **2026-10-06:** Committed and pushed `73ee592` → deployed, verified in the served bundle. Restore point `checkpoint-2026-10-06-front-view` (#12). Awaiting the owner's device check (front-view measurement relies on MediaPipe depth — thresholds may need per-exercise tuning).
- **2026-10-06:** **Six owner upgrades.** Early start with an immediate count (counts from the briefing; the number is said at the rep); steady Ghost (time-based smoothing, feet-anchored, smooth keyframes); kicks and passes as a full set per leg with a spoken leg change; professional 3/4-view Ghost (tapered limbs, jersey, boots, depth order); shadow ball in shadow kicks / passes; wide 4:3 camera with minimum zoom. Client 673 pass, server 10/10, 0 new failures. Committed as `ad47b25`.
- **2026-10-06:** Pushed `ad47b25` → deployed, verified in the served bundle. Restore point `checkpoint-2026-10-06-pro-ghost` (#13). Awaiting the owner's device check.
- **2026-10-06:** **Four field-test fixes.** Instant big Ghost (all demo phases, first-frame draw, fade-in, off-screen feet ignored); laces / inside-of-foot striking surface with a contact flash and the ball at the contact point; One Euro landmark filter + gap bridging + new-frame-only downscaled detection; realistic kick / pass timing and mechanics with a balance arm and a near-side view. Client 682 pass, server 10/10, 0 new failures. Committed as `2ae70ef`.
- **2026-10-08:** Pushed `2ae70ef` → deployed, verified in the served bundle. Restore point `checkpoint-2026-10-08-real-kick` (#14). Awaiting the owner's device check.
- **2026-10-08:** **Three owner items.** Big Ghost root cause = per-frame canvas blur at 3x density (~40 ms/frame) → no blur + 1.5x cap (2.9 ms/frame), toggle from the briefing; virtual coach (male / female, chosen in the check-in) at the side — demonstrates with the Ghost, talks, celebrates, own voice; no automatic moves between exercises (warm-up waits for 'next'), with a voice 'next' command while waiting. Client 691 pass, server 10/10, 0 new failures. Committed as `2036591`.
- **2026-10-08:** Pushed `2036591` → deployed, verified in the served bundle. Restore point `checkpoint-2026-10-08-coach` (#15). `client/src/hooks/useSegmentationModel.js` was committed by mistake (untracked local file, not imported) and untracked again (kept on disk). Awaiting the owner's device check.
- **2026-10-08:** **Field test fix.** Root cause of 'no big Ghost': the small Ghost panel covered the in-camera Ghost buttons on a phone + a permanently saved 'panel' from an old fallback → a control strip below the camera (Ghost off / small / big, coach male / female / none), a fresh storage key, session-only fallback; a coach selection screen with previews at the start, and the coach choice at the top of the check-in. Verified with a real click in a phone-sized browser. Committed as `72802e3`.
- **2026-10-08:** Pushed `72802e3` → deployed, verified in the served bundle. Restore point `checkpoint-2026-10-08-controls` (#16). Awaiting the owner's device check.
- **2026-10-08:** **Field test #2.** Big Ghost invisible on a bright picture → high-contrast look (dark thick outline, strong cyan, 72%) + fixed inward limb caps; professional athletic coach silhouettes (body type per coach, accent tracksuit, sound wave when talking); auto skip = the app heard its own 'הבא' → explicit 'תרגיל הבא' only, mic off while the coach speaks (+1.5 s), on-screen notice; the female coach speaks in the feminine. Client 693 pass, 0 new failures. Committed as `ddbb81f`.
- **2026-10-08:** Pushed `ddbb81f` → deployed, verified in the served bundle. Restore point `checkpoint-2026-10-08-pro-coach` (#17). Awaiting the owner's device check.

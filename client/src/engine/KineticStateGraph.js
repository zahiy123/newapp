// ============================================================
// KineticStateGraph (KSG) — The Central Nervous System
//
// Singleton EventEmitter that holds all kinetic state.
// Every engine reads from it, every engine writes to it.
// All writes are schema-validated. No guessing enters the graph.
//
// Architecture:
//   KSG
//   ├── passport  (Anatomic Passport — loaded once per session)
//   ├── ontology  (Sport Ontology — loaded per sport selection)
//   ├── twin      (Digital Twin Blueprint — built per exercise)
//   └── runtime   (Runtime Layer — updated continuously)
//
// Access from React: use the useKSG() hook
// Access from engines: import KSG directly
// ============================================================

import { KSG_CELL, KSG_EVENT } from './constants.js';
import {
  validatePassport,
  validateRuntimeUpdate,
  getCellFromPath,
  ValidationError,
} from './SchemaValidator.js';


// ---- Simple EventEmitter ----

class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, fn) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(fn);
    // Return unsubscribe function
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this._listeners.get(event);
    if (set) {
      set.delete(fn);
      if (set.size === 0) this._listeners.delete(event);
    }
  }

  emit(event, data) {
    const set = this._listeners.get(event);
    if (set) {
      for (const fn of set) {
        try {
          fn(data);
        } catch (err) {
          console.error(`[KSG] Error in listener for "${event}":`, err);
        }
      }
    }
  }

  removeAllListeners() {
    this._listeners.clear();
  }
}


// ---- Deep get/set by dot-path ----

function deepGet(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function deepSet(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  // structuredClone is available in modern browsers and Node 17+
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}


// ---- Debug Logger ----

const DEBUG_PREFIX = '[KSG:DEBUG]';
const VALID_PREFIX = '[KSG:VALID]';
const ALERT_PREFIX = '[KSG:ALERT]';

class DebugLogger {
  constructor() {
    this._enabled = false;
    this._history = [];       // keeps last N entries for inspection
    this._maxHistory = 200;
  }

  enable()  { this._enabled = true; }
  disable() { this._enabled = false; }
  isEnabled() { return this._enabled; }

  _record(level, prefix, msg, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: msg,
      data: data !== undefined ? data : null,
    };
    this._history.push(entry);
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }
    if (this._enabled) {
      const style = level === 'error' ? 'color:#e74c3c;font-weight:bold'
                  : level === 'warn'  ? 'color:#f39c12;font-weight:bold'
                  : level === 'valid' ? 'color:#2ecc71'
                  : 'color:#3498db';
      if (data !== undefined) {
        console.log(`%c${prefix} ${msg}`, style, data);
      } else {
        console.log(`%c${prefix} ${msg}`, style);
      }
    }
  }

  write(msg, data)      { this._record('info', DEBUG_PREFIX, msg, data); }
  validation(msg, data) { this._record('valid', VALID_PREFIX, msg, data); }
  alert(msg, data)      { this._record('warn', ALERT_PREFIX, msg, data); }
  error(msg, data)      { this._record('error', DEBUG_PREFIX, msg, data); }

  getHistory() { return [...this._history]; }
  clearHistory() { this._history = []; }
}


// ---- The KSG Class ----

class KineticStateGraph extends EventEmitter {
  constructor() {
    super();

    // Debug logger
    this.debug = new DebugLogger();

    // The four cells — all start empty
    this._cells = {
      [KSG_CELL.PASSPORT]: null,
      [KSG_CELL.ONTOLOGY]: null,
      [KSG_CELL.TWIN]: null,
      [KSG_CELL.RUNTIME]: null,
    };

    // Lock flags — passport is readonly after load
    this._passportLocked = false;

    // Session tracking
    this._sessionId = null;
    this._sessionStart = null;
  }

  enableDebug()  { this.debug.enable(); return this; }
  disableDebug() { this.debug.disable(); return this; }

  // ---- Passport Operations ----

  loadPassport(passport) {
    this.debug.write('loadPassport() called', { classification: passport?.classification });

    // Validate the entire passport before accepting it
    const errors = validatePassport(passport);
    if (errors.length > 0) {
      this.debug.error(`Passport validation FAILED — ${errors.length} error(s)`,
        errors.map(e => `${e.path}: ${e.detail}`));
      this.emit(KSG_EVENT.VALIDATION_ERROR, {
        operation: 'loadPassport',
        errors: errors.map(e => ({ path: e.path, message: e.detail })),
      });
      throw new ValidationError(
        'passport',
        `Passport validation failed with ${errors.length} error(s): ${errors[0].detail}`,
        errors
      );
    }

    this.debug.validation('Passport validation PASSED — all fields valid');

    // Deep clone to prevent external mutation
    this._cells[KSG_CELL.PASSPORT] = deepClone(passport);
    this._passportLocked = true;

    const summary = {
      classification: passport.classification,
      mobility_mode: passport.structural_profile.mobility_mode,
      risk_zones: passport.risk_zones.length,
    };
    this.debug.write('Passport loaded into KSG', summary);
    this.emit(KSG_EVENT.PASSPORT_LOADED, summary);

    return true;
  }

  clearPassport() {
    this.debug.write('Passport cleared from KSG');
    this._cells[KSG_CELL.PASSPORT] = null;
    this._passportLocked = false;
    this.emit(KSG_EVENT.PASSPORT_CLEARED, {});
  }

  getPassport() {
    // Return a deep clone so nobody can mutate internal state
    return this._cells[KSG_CELL.PASSPORT]
      ? deepClone(this._cells[KSG_CELL.PASSPORT])
      : null;
  }

  hasPassport() {
    return this._cells[KSG_CELL.PASSPORT] !== null;
  }

  // ---- Ontology Operations ----

  loadOntology(ontology) {
    this.debug.write('loadOntology() called', { sport: ontology?.sport });
    if (!ontology || typeof ontology !== 'object') {
      this.debug.error('Ontology validation FAILED — not an object');
      throw new ValidationError('ontology', 'must be a non-null object', ontology);
    }
    this._cells[KSG_CELL.ONTOLOGY] = deepClone(ontology);
    const info = { sport: ontology.sport || 'unknown', actions: Object.keys(ontology.actions || {}) };
    this.debug.write('Ontology loaded into KSG', info);
    this.emit(KSG_EVENT.ONTOLOGY_LOADED, info);
    return true;
  }

  getOntology() {
    return this._cells[KSG_CELL.ONTOLOGY]
      ? deepClone(this._cells[KSG_CELL.ONTOLOGY])
      : null;
  }

  hasOntology() {
    return this._cells[KSG_CELL.ONTOLOGY] !== null;
  }

  // ---- Twin Operations ----

  setTwin(twin) {
    if (!twin || typeof twin !== 'object') {
      throw new ValidationError('twin', 'must be a non-null object', twin);
    }
    this._cells[KSG_CELL.TWIN] = deepClone(twin);
    this.emit(KSG_EVENT.TWIN_READY, {
      exercise: twin.exercise || 'unknown',
      phases: twin.phases ? Object.keys(twin.phases) : [],
    });
    return true;
  }

  updateTwin(path, value) {
    if (!this._cells[KSG_CELL.TWIN]) {
      throw new Error('[KSG] Cannot update twin — no twin loaded');
    }
    const fullPath = `twin.${path}`;
    deepSet(this._cells[KSG_CELL.TWIN], path, value);
    this.emit(KSG_EVENT.TWIN_UPDATED, { path: fullPath, value });
  }

  getTwin() {
    return this._cells[KSG_CELL.TWIN]
      ? deepClone(this._cells[KSG_CELL.TWIN])
      : null;
  }

  hasTwin() {
    return this._cells[KSG_CELL.TWIN] !== null;
  }

  // ---- Runtime Operations ----

  startSession() {
    const sessionId = crypto.randomUUID ? crypto.randomUUID() : `session_${Date.now()}`;
    this._sessionId = sessionId;
    this._sessionStart = new Date().toISOString();

    this._cells[KSG_CELL.RUNTIME] = {
      session_id: sessionId,
      session_start: this._sessionStart,
      fatigue: {
        index: 0,
        trend: 'stable',
        per_zone: {},
      },
      compensation_drift: {},
      cumulative_load: {},
      current_movement: {
        phase: 'idle',
        intent_confidence: 0,
        rhythm_match: 0,
        rep_count: 0,
        last_rep_quality: 0,
      },
      alerts: [],
    };

    this.debug.write(`Session started: ${sessionId}`);
    this.emit(KSG_EVENT.SESSION_STARTED, { session_id: sessionId });
    return sessionId;
  }

  endSession() {
    const runtime = this._cells[KSG_CELL.RUNTIME];
    const summary = runtime ? deepClone(runtime) : null;

    const alertCount = runtime ? runtime.alerts.length : 0;
    this.debug.write(`Session ended — ${alertCount} alerts total`, {
      session_id: this._sessionId,
      fatigue: runtime?.fatigue?.index,
      alerts: alertCount,
    });

    this._cells[KSG_CELL.RUNTIME] = null;
    this._cells[KSG_CELL.TWIN] = null;
    this._sessionId = null;
    this._sessionStart = null;

    this.emit(KSG_EVENT.SESSION_ENDED, { summary });
    return summary;
  }

  updateRuntime(path, value) {
    if (!this._cells[KSG_CELL.RUNTIME]) {
      throw new Error('[KSG] Cannot update runtime — no active session');
    }

    const fullPath = `runtime.${path}`;

    // Validate the update
    const errors = validateRuntimeUpdate(fullPath, value);
    if (errors.length > 0) {
      this.debug.error(`Runtime validation FAILED at ${fullPath}`,
        errors.map(e => `${e.path}: ${e.detail}`));
      this.emit(KSG_EVENT.VALIDATION_ERROR, {
        operation: 'updateRuntime',
        path: fullPath,
        errors: errors.map(e => ({ path: e.path, message: e.detail })),
      });
      throw errors[0];
    }

    this.debug.validation(`Runtime write OK: ${fullPath}`, value);
    deepSet(this._cells[KSG_CELL.RUNTIME], path, value);
    this.emit(KSG_EVENT.RUNTIME_UPDATED, { path: fullPath, value });

    // Auto-detect alerts
    this._checkRuntimeAlerts(path, value);
  }

  getRuntime() {
    return this._cells[KSG_CELL.RUNTIME]
      ? deepClone(this._cells[KSG_CELL.RUNTIME])
      : null;
  }

  hasActiveSession() {
    return this._cells[KSG_CELL.RUNTIME] !== null;
  }

  // ---- Generic get (read from any cell by full path) ----

  get(fullPath) {
    const cell = getCellFromPath(fullPath);
    if (!cell) return undefined;

    const data = this._cells[cell];
    if (!data) return undefined;

    // Strip the cell prefix: "passport.body_map.left_leg" → "body_map.left_leg"
    const innerPath = fullPath.substring(cell.length + 1);
    if (!innerPath) return deepClone(data);
    return deepClone(deepGet(data, innerPath));
  }

  // ---- Alert Management ----

  addAlert(alert) {
    if (!this._cells[KSG_CELL.RUNTIME]) {
      throw new Error('[KSG] Cannot add alert — no active session');
    }

    const fullAlert = {
      timestamp: new Date().toISOString(),
      resolved: false,
      ...alert,
    };

    this._cells[KSG_CELL.RUNTIME].alerts.push(fullAlert);
    this.debug.alert(`${fullAlert.severity?.toUpperCase()} ${fullAlert.type} alert on ${fullAlert.zone}`, fullAlert);

    // Emit specific alert events
    const eventMap = {
      compensation: KSG_EVENT.RUNTIME_COMPENSATION_ALERT,
      fatigue: KSG_EVENT.RUNTIME_FATIGUE_ALERT,
      risk: KSG_EVENT.RUNTIME_RISK_ALERT,
    };

    const event = eventMap[alert.type];
    if (event) {
      this.emit(event, fullAlert);
    }

    return fullAlert;
  }

  getUnresolvedAlerts() {
    const runtime = this._cells[KSG_CELL.RUNTIME];
    if (!runtime) return [];
    return runtime.alerts.filter(a => !a.resolved);
  }

  resolveAlert(timestamp) {
    const runtime = this._cells[KSG_CELL.RUNTIME];
    if (!runtime) return false;
    const alert = runtime.alerts.find(a => a.timestamp === timestamp);
    if (alert) {
      alert.resolved = true;
      return true;
    }
    return false;
  }

  // ---- Internal: Auto-check for alert conditions ----

  _checkRuntimeAlerts(path, value) {
    const passport = this._cells[KSG_CELL.PASSPORT];
    if (!passport) return;

    // Check compensation drift against thresholds
    if (path.startsWith('compensation_drift.') && typeof value === 'object') {
      if (Math.abs(value.delta) > 0.10) {
        const zone = path.replace('compensation_drift.', '');
        const severity = Math.abs(value.delta) > 0.20 ? 'critical' : 'warning';
        this.addAlert({
          type: 'compensation',
          zone,
          severity,
          message: `Compensation drift on ${zone}: delta ${value.delta.toFixed(3)} exceeds threshold`,
        });
      }
    }

    // Check fatigue index
    if (path === 'fatigue.index' && typeof value === 'number') {
      if (value > 0.8) {
        this.addAlert({
          type: 'fatigue',
          zone: 'global',
          severity: 'critical',
          message: `Global fatigue index at ${(value * 100).toFixed(0)}%`,
        });
      } else if (value > 0.6) {
        this.addAlert({
          type: 'fatigue',
          zone: 'global',
          severity: 'warning',
          message: `Global fatigue index rising: ${(value * 100).toFixed(0)}%`,
        });
      }
    }

    // Check cumulative load against risk zones
    if (path.startsWith('cumulative_load.') && typeof value === 'object') {
      if (value.percentage > 0.9) {
        const zone = path.replace('cumulative_load.', '');
        this.addAlert({
          type: 'risk',
          zone,
          severity: 'critical',
          message: `Cumulative load on ${zone} at ${(value.percentage * 100).toFixed(0)}% of limit`,
        });
      } else if (value.percentage > 0.7) {
        const zone = path.replace('cumulative_load.', '');
        this.addAlert({
          type: 'risk',
          zone,
          severity: 'warning',
          message: `Cumulative load on ${zone} approaching limit: ${(value.percentage * 100).toFixed(0)}%`,
        });
      }
    }
  }

  // ---- Debug / Inspection ----

  getSnapshot() {
    return {
      passport: this._cells[KSG_CELL.PASSPORT] ? '✓ loaded' : '✗ empty',
      ontology: this._cells[KSG_CELL.ONTOLOGY] ? '✓ loaded' : '✗ empty',
      twin: this._cells[KSG_CELL.TWIN] ? '✓ loaded' : '✗ empty',
      runtime: this._cells[KSG_CELL.RUNTIME] ? '✓ active' : '✗ no session',
      session_id: this._sessionId,
      listeners: Object.fromEntries(
        [...this._listeners.entries()].map(([k, v]) => [k, v.size])
      ),
    };
  }

  // ---- Reset (for testing / logout) ----

  reset() {
    this._cells = {
      [KSG_CELL.PASSPORT]: null,
      [KSG_CELL.ONTOLOGY]: null,
      [KSG_CELL.TWIN]: null,
      [KSG_CELL.RUNTIME]: null,
    };
    this._passportLocked = false;
    this._sessionId = null;
    this._sessionStart = null;
    this.removeAllListeners();
  }
}


// ---- Singleton Export ----

const KSG = new KineticStateGraph();

// Prevent accidental creation of additional instances
if (typeof window !== 'undefined') {
  if (window.__KSG_INSTANCE__) {
    console.warn('[KSG] Multiple KSG instances detected — using existing singleton');
  }
  window.__KSG_INSTANCE__ = KSG;

  // ---- Browser Console Debug Tool ----
  // Usage: open DevTools console and type debugPassportState()
  window.debugPassportState = function debugPassportState() {
    const BORDER = '═'.repeat(58);
    const passport = KSG.getPassport();
    const runtime  = KSG.getRuntime();

    console.log(`\n%c${BORDER}`, 'color:#2ecc71');
    console.log('%c  ANATOMIC PASSPORT — DEBUG STATE', 'color:#3498db;font-size:14px;font-weight:bold');
    console.log(`%c${BORDER}`, 'color:#2ecc71');

    if (!passport) {
      console.log('%c  ✗ No passport loaded in KSG', 'color:#e74c3c;font-weight:bold');
      console.log('  Possible reasons:');
      console.log('    — User has not completed Full Anatomic Scan');
      console.log('    — Passport failed validation on load');
      console.log('    — Session not started yet');
      console.log(`%c${BORDER}\n`, 'color:#2ecc71');
      return;
    }

    // Source indicator
    const source = KSG._passportLocked ? 'KSG (in-memory, loaded from Firebase)' : 'unknown';
    console.log(`%c  Source: ${source}`, 'color:#95a5a6');
    console.log(`  Classification: %c${passport.classification}`, 'color:#e67e22;font-weight:bold');
    console.log(`  Scan Date: ${passport.scan_date}`);
    console.log(`  Mobility: ${passport.structural_profile.mobility_mode}`);
    console.log('');

    // Body Map
    console.log('%c  ── BODY MAP ──', 'color:#3498db;font-weight:bold');
    for (const [limb, data] of Object.entries(passport.body_map)) {
      const icon = data.status.includes('healthy') ? '🟢'
                 : data.status.includes('prosthetic') ? '🔵'
                 : data.status === 'absent' ? '🔴'
                 : data.status === 'anatomical_weak' ? '🟡'
                 : '⚪';
      const damping = data.damping_factor !== null ? `ξ=${data.damping_factor}` : 'n/a';
      console.log(`  ${icon} ${limb.padEnd(12)} ${data.status.padEnd(28)} ${damping.padEnd(10)} [${data.damping_class || '-'}]`);
    }
    console.log('');

    // Risk Zones
    if (passport.risk_zones.length > 0) {
      console.log('%c  ── RISK ZONES ──', 'color:#e74c3c;font-weight:bold');
      for (const rz of passport.risk_zones) {
        const icon = rz.monitoring_priority === 'high' ? '🔴' : rz.monitoring_priority === 'medium' ? '🟡' : '🟢';
        console.log(`  ${icon} ${rz.zone.padEnd(18)} ${rz.risk_type.padEnd(18)} limit: ${(rz.load_limit_factor * 100).toFixed(0)}%`);
      }
      console.log('');
    }

    // Compensation
    if (passport.compensation_map.patterns.length > 0) {
      console.log('%c  ── COMPENSATION PATTERNS ──', 'color:#f39c12;font-weight:bold');
      for (const cp of passport.compensation_map.patterns) {
        console.log(`  ⚠ ${cp.type} (${cp.side}) — ${cp.severity} — ${cp.cause}`);
      }
      console.log(`  Symmetry Index: ${passport.compensation_map.symmetry_index}`);
      console.log('');
    }

    // Kinetic Baseline
    console.log('%c  ── KINETIC BASELINE ──', 'color:#9b59b6;font-weight:bold');
    console.log(`  Natural Rhythm: ${passport.kinetic_baseline.natural_rhythm_hz} Hz`);
    console.log(`  Gait Symmetry:  ${passport.kinetic_baseline.gait_symmetry_index}`);
    console.log(`  Tempo:          ${passport.kinetic_baseline.preferred_tempo}`);
    console.log(`  Dominant Side:  ${passport.kinetic_baseline.dominant_side}`);
    console.log('');

    // Runtime (if session active)
    if (runtime) {
      console.log('%c  ── RUNTIME (live session) ──', 'color:#1abc9c;font-weight:bold');
      console.log(`  Session: ${runtime.session_id}`);
      console.log(`  Fatigue: ${(runtime.fatigue.index * 100).toFixed(0)}% (${runtime.fatigue.trend})`);
      console.log(`  Phase:   ${runtime.current_movement.phase}`);
      console.log(`  Reps:    ${runtime.current_movement.rep_count}`);
      const unresolvedAlerts = runtime.alerts.filter(a => !a.resolved);
      if (unresolvedAlerts.length > 0) {
        console.log(`  %cAlerts:  ${unresolvedAlerts.length} unresolved`, 'color:#e74c3c');
        for (const a of unresolvedAlerts) {
          console.log(`    ⚠ [${a.severity}] ${a.type} @ ${a.zone}: ${a.message}`);
        }
      }
    } else {
      console.log('%c  ── RUNTIME: no active session ──', 'color:#95a5a6');
    }

    // Debug Log
    const debugHistory = KSG.debug.getHistory();
    if (debugHistory.length > 0) {
      console.log('');
      console.log(`%c  ── DEBUG LOG (last ${Math.min(debugHistory.length, 10)} entries) ──`, 'color:#95a5a6');
      const recent = debugHistory.slice(-10);
      for (const entry of recent) {
        const icon = entry.level === 'error' ? '✗' : entry.level === 'warn' ? '⚠' : entry.level === 'valid' ? '✓' : '·';
        console.log(`  ${icon} [${entry.timestamp.substring(11, 19)}] ${entry.message}`);
      }
    }

    console.log(`%c${BORDER}\n`, 'color:#2ecc71');

    // Return the raw object for further inspection
    return { passport, runtime, debugHistory: KSG.debug.getHistory() };
  };
}

export default KSG;
export { KineticStateGraph };

// ============================================================
// useKSG — React hook for accessing the Kinetic State Graph
//
// Subscribes to KSG events and triggers re-renders only when
// the specific path you're watching changes.
//
// Usage:
//   const passport = useKSG('passport');
//   const fatigue = useKSG('runtime.fatigue.index');
//   const alerts = useKSGAlerts();
//   const snapshot = useKSGSnapshot();
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import KSG from '../engine/KineticStateGraph.js';
import { KSG_EVENT } from '../engine/constants.js';

// Maps cell names to events that should trigger a re-read
const CELL_EVENTS = {
  passport: [KSG_EVENT.PASSPORT_LOADED, KSG_EVENT.PASSPORT_CLEARED],
  ontology: [KSG_EVENT.ONTOLOGY_LOADED],
  twin:     [KSG_EVENT.TWIN_READY, KSG_EVENT.TWIN_UPDATED],
  runtime:  [KSG_EVENT.RUNTIME_UPDATED, KSG_EVENT.SESSION_STARTED, KSG_EVENT.SESSION_ENDED],
};

export function useKSG(path) {
  const [value, setValue] = useState(() => KSG.get(path));
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    // Determine which cell this path belongs to
    const cell = path.split('.')[0];
    const events = CELL_EVENTS[cell];
    if (!events) return;

    const handler = () => {
      const newVal = KSG.get(pathRef.current);
      setValue(prev => {
        // Simple equality check to avoid unnecessary re-renders
        const prevStr = JSON.stringify(prev);
        const newStr = JSON.stringify(newVal);
        return prevStr === newStr ? prev : newVal;
      });
    };

    const unsubs = events.map(ev => KSG.on(ev, handler));

    // Sync on mount
    handler();

    return () => unsubs.forEach(unsub => unsub());
  }, [path]);

  return value;
}

export function useKSGAlerts() {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    const handler = () => {
      setAlerts(KSG.getUnresolvedAlerts());
    };

    const unsubs = [
      KSG.on(KSG_EVENT.RUNTIME_COMPENSATION_ALERT, handler),
      KSG.on(KSG_EVENT.RUNTIME_FATIGUE_ALERT, handler),
      KSG.on(KSG_EVENT.RUNTIME_RISK_ALERT, handler),
      KSG.on(KSG_EVENT.SESSION_STARTED, handler),
      KSG.on(KSG_EVENT.SESSION_ENDED, handler),
    ];

    handler();
    return () => unsubs.forEach(unsub => unsub());
  }, []);

  return alerts;
}

export function useKSGSnapshot() {
  const [snapshot, setSnapshot] = useState(() => KSG.getSnapshot());

  useEffect(() => {
    const handler = () => setSnapshot(KSG.getSnapshot());

    const allEvents = Object.values(KSG_EVENT);
    const unsubs = allEvents.map(ev => KSG.on(ev, handler));

    return () => unsubs.forEach(unsub => unsub());
  }, []);

  return snapshot;
}

export function useKSGActions() {
  const loadPassport = useCallback((passport) => KSG.loadPassport(passport), []);
  const startSession = useCallback(() => KSG.startSession(), []);
  const endSession = useCallback(() => KSG.endSession(), []);
  const updateRuntime = useCallback((path, value) => KSG.updateRuntime(path, value), []);
  const loadOntology = useCallback((ontology) => KSG.loadOntology(ontology), []);
  const setTwin = useCallback((twin) => KSG.setTwin(twin), []);

  return { loadPassport, startSession, endSession, updateRuntime, loadOntology, setTwin };
}

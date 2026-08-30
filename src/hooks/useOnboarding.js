import { useCallback, useState } from 'react';

// Lightweight, localStorage-only onboarding state (V1). Tracks which contextual
// first-session prompts a user has completed or dismissed so returning users
// don't see them again. No Supabase, no schema. Defensive read/write; a
// missing/corrupt value falls back to all-false, and only the known boolean
// keys are ever read or written (so unrelated localStorage is never touched).

const KEY = 'moflow_onboarding_v1';

const DEFAULTS = Object.freeze({
  // Cards -> Flow bridge shown after a card save; dismissed permanently once
  // the user acts on it or declines with "Not now".
  flowBridgeDismissed: false,
  // Flow -> Activity "more realistic projection" next-step prompt.
  activityPromptDismissed: false,
  // The user explicitly applied a scanned balance total to available cash.
  balanceScanCompleted: false,
  // The user completed at least one recent-activity screenshot import.
  activityImportCompleted: false,
});

const readState = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };
    const next = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof parsed[k] === 'boolean') next[k] = parsed[k];
    }
    return next;
  } catch {
    return { ...DEFAULTS };
  }
};

const writeState = (value) => {
  try {
    // Persist only the known keys; never spill unrelated data into this key.
    const clean = {};
    for (const k of Object.keys(DEFAULTS)) clean[k] = !!value[k];
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // Ignore storage write errors and keep in-memory state.
  }
};

export default function useOnboarding() {
  const [onboarding, setOnboarding] = useState(readState);

  const updateOnboarding = useCallback((patch) => {
    setOnboarding((prev) => {
      const next = { ...prev, ...patch };
      writeState(next);
      return next;
    });
  }, []);

  return { onboarding, updateOnboarding };
}

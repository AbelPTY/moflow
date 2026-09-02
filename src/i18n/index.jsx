import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALES,
  isSupportedLocale,
  resolveLocale,
  translate,
  formatCurrency as fmtCurrency,
  formatDate as fmtDate,
  formatNumber as fmtNumber,
} from './core.js';

export {
  DEFAULT_LOCALE,
  LOCALES,
  isSupportedLocale,
  resolveLocale,
  detectLocale,
  normalizeToLocale,
  translate,
  formatCurrency,
  formatNumber,
  formatDate,
} from './core.js';

const STORAGE_KEY = 'moflow.locale';

const readStoredLocale = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isSupportedLocale(v) ? v : null;
  } catch {
    return null;
  }
};

const writeStoredLocale = (loc) => {
  try {
    localStorage.setItem(STORAGE_KEY, loc);
  } catch {
    /* private mode / storage disabled — non-fatal, session-only locale */
  }
};

const I18nContext = createContext(null);

// Wraps the app. Locale precedence: saved preference -> device language ->
// en-US. Switching updates the whole UI immediately and persists locally
// (no DB, no migration in V1).
export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    return resolveLocale(readStoredLocale(), nav);
  });

  useEffect(() => {
    try {
      document.documentElement.setAttribute('lang', locale);
    } catch {
      /* no-op */
    }
  }, [locale]);

  const setLocale = useCallback((next) => {
    if (!isSupportedLocale(next)) return;
    writeStoredLocale(next);
    setLocaleState(next);
  }, []);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      locales: LOCALES,
      t: (key, vars) => translate(locale, key, vars),
      formatCurrency: (amount, currency) => fmtCurrency(amount, locale, currency),
      formatNumber: (n, options) => fmtNumber(n, locale, options),
      formatDate: (date, options) => fmtDate(date, locale, options),
    }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// Hook for components. Safe outside a provider (falls back to en-US) so a stray
// consumer never crashes.
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    locales: LOCALES,
    t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
    formatCurrency: (amount, currency) => fmtCurrency(amount, DEFAULT_LOCALE, currency),
    formatNumber: (n, options) => fmtNumber(n, DEFAULT_LOCALE, options),
    formatDate: (date, options) => fmtDate(date, DEFAULT_LOCALE, options),
  };
}

export default I18nProvider;

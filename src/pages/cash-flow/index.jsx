import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from 'date-fns';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import UpcomingPaymentsCalendar from '../../components/UpcomingPaymentsCalendar';
import FlowLiteSetup from './FlowLiteSetup';
import ExtraIncomePanel from './ExtraIncomePanel';
import CashAccountsPanel from './CashAccountsPanel';
import BalanceScanner from '../../components/BalanceScanner';
import Icon from '../../components/AppIcon';
import { useI18n } from '../../i18n';
import useOnboarding from '../../hooks/useOnboarding';
import { trackProductEvent } from '../../lib/analytics';
import useScheduledPayments from '../../hooks/useScheduledPayments';
import useTransactions from '../../hooks/useTransactions';
import useCreditCards from '../../hooks/useCreditCards';
import { nextDueDate } from '../../lib/cardGuard';
import {
  LAST_DAY,
  DEFAULT_SEMI_MONTHLY,
  incomeOccurrences,
  normalizeSemiMonthly,
  validateSemiMonthly,
} from '../../lib/recurringIncome';
import { readAvailableCash, writeAvailableCash } from '../../lib/availableCash';

const WINDOW_OPTIONS = [7, 14, 30];
// Semi-monthly day picker options (1..31); 29–31 clamp to the real month end.
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);
const HISTORY_WEEKS = 8;
const HISTORY_DAYS = HISTORY_WEEKS * 7;

const LS_INCOME_AMT = 'cashflow_income_amount';
const LS_INCOME_DAY = 'cashflow_income_day';

// V2.7: recurring-income frequency + semi-monthly (quincenal) schedule. Absence
// of the frequency key means 'monthly' (the pre-existing behavior), so existing
// users are never reinterpreted. Values are canonical (see recurringIncome.js);
// display translation is handled by i18n.
const LS_INCOME_FREQ = 'cashflow_income_frequency_v1';
const LS_INCOME_SEMI = 'cashflow_income_semimonthly_v1';

const readIncomeFrequency = () => {
  try {
    const raw = localStorage.getItem(LS_INCOME_FREQ);
    return raw === 'semi_monthly' ? 'semi_monthly' : 'monthly';
  } catch {
    return 'monthly';
  }
};

const readSemiMonthly = () => {
  try {
    const raw = localStorage.getItem(LS_INCOME_SEMI);
    if (raw) return normalizeSemiMonthly(JSON.parse(raw));
  } catch {
    // fall through to defaults
  }
  return normalizeSemiMonthly({ ...DEFAULT_SEMI_MONTHLY });
};

// New key on purpose: V2.1 uses a different spending model, so an old
// V2 manual/auto value should not silently override the new baseline.
const LS_EXPECTED_DAILY = 'cashflow_expected_daily_spend_v21';
const LS_YAPPY_OVERRIDES = 'cashflow_recurring_yappy_overrides_v1';

// V2.6: one-time dated extra income + a custom look-ahead end date.
const LS_EXTRA_INCOME = 'cashflow_extra_income_v1';
const LS_CUSTOM_LOOKAHEAD = 'cashflow_custom_lookahead_date_v1';
const LS_LOOKAHEAD_MODE = 'cashflow_lookahead_mode_v1';

const DEFAULT_WINDOW_DAYS = 14;

// Horizon (days) beyond which we show a subtle "less certain" note, because
// expected everyday spending is estimated from historical behavior.
const LONG_RANGE_DAYS = 45;

const money = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const percent = (n) =>
  `${Math.round(Math.max(0, Math.min(1, Number(n) || 0)) * 100)}%`;

const readYappyOverrides = () => {
  try {
    const raw = localStorage.getItem(LS_YAPPY_OVERRIDES);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeYappyOverrides = (value) => {
  try {
    localStorage.setItem(LS_YAPPY_OVERRIDES, JSON.stringify(value || {}));
  } catch {
    // Ignore localStorage write errors and keep the current UI state.
  }
};

// --- Extra income (one-time dated inflows) persistence ---
const readExtraIncome = () => {
  try {
    const raw = localStorage.getItem(LS_EXTRA_INCOME);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeExtraIncome = (value) => {
  try {
    localStorage.setItem(LS_EXTRA_INCOME, JSON.stringify(value || []));
  } catch {
    // Ignore localStorage write errors and keep the current UI state.
  }
};

// --- Custom look-ahead end date persistence ---
const readCustomLookahead = () => {
  try {
    return localStorage.getItem(LS_CUSTOM_LOOKAHEAD) || '';
  } catch {
    return '';
  }
};

const writeCustomLookahead = (value) => {
  try {
    if (value) localStorage.setItem(LS_CUSTOM_LOOKAHEAD, value);
    else localStorage.removeItem(LS_CUSTOM_LOOKAHEAD);
  } catch {
    // Ignore localStorage write errors and keep the current UI state.
  }
};

// --- Active look-ahead mode persistence ('preset' | 'custom') ---
const readLookaheadMode = () => {
  try {
    const raw = localStorage.getItem(LS_LOOKAHEAD_MODE);
    return raw === 'custom' || raw === 'preset' ? raw : '';
  } catch {
    return '';
  }
};

const writeLookaheadMode = (value) => {
  try {
    localStorage.setItem(LS_LOOKAHEAD_MODE, value);
  } catch {
    // Ignore localStorage write errors and keep the current UI state.
  }
};

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

// Whole calendar days from today to a yyyy-MM-dd string. Returns null when the
// date is invalid or strictly before today (a past horizon is never used).
const daysFromTodayTo = (dateStr) => {
  if (!dateStr) return null;
  const d = parseISO(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = differenceInCalendarDays(target, startOfToday());
  return diff < 0 ? null : diff;
};

// Resolve the initial look-ahead state from persisted values. Restores a valid
// custom horizon; falls back safely to the 14-day preset (and flags a mode
// reset) when a stored custom date is missing/invalid/past. `resetMode` tells
// the component to persist 'preset' once on mount so storage self-heals.
const initialLookahead = () => {
  const storedDate = readCustomLookahead();
  const mode = readLookaheadMode();

  if (mode === 'custom') {
    const diff = daysFromTodayTo(storedDate);
    if (diff !== null) {
      return { mode: 'custom', windowDays: diff, customDate: storedDate, resetMode: false };
    }
    // Stored custom date is invalid or now in the past -> safe fallback.
    return { mode: 'preset', windowDays: DEFAULT_WINDOW_DAYS, customDate: storedDate, resetMode: true };
  }

  // Missing/invalid mode, or an explicit 'preset' -> existing default.
  return { mode: 'preset', windowDays: DEFAULT_WINDOW_DAYS, customDate: storedDate, resetMode: false };
};

const newExtraIncomeId = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // fall through to a non-crypto id
  }
  return `ei_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const median = (values) => {
  const clean = values
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!clean.length) return 0;

  const middle = Math.floor(clean.length / 2);

  return clean.length % 2
    ? clean[middle]
    : (clean[middle - 1] + clean[middle]) / 2;
};

const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const looksLikeCreditAccount = (account) => {
  const value = String(account || '').toLowerCase();

  return (
    value.includes('credit card') ||
    value.includes('mastercard') ||
    value.includes('visa') ||
    /\bcc\b/.test(value)
  );
};

const dateForDayOfMonth = (year, monthIndex, day) => {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(day, lastDay));
};

const RECURRING_YAPPY_STOP_WORDS = new Set([
  'yappy',
  'pago',
  'pagos',
  'transferencia',
  'transfer',
  'transf',
  'servicio',
  'servicios',
  'factura',
  'cuenta',
  'de',
  'del',
  'la',
  'el',
  'para',
  'por',
  'a',
]);

const recurringYappyTokens = (transaction) => {
  const raw = normalizeText(
    `${transaction.merchant || ''} ${transaction.description || ''}`
  );

  if (!raw.includes('yappy')) return [];

  return raw
    .split(' ')
    .filter(Boolean)
    .filter((token) => !RECURRING_YAPPY_STOP_WORDS.has(token))
    .filter((token) => !/\d/.test(token))
    .filter((token) => token.length >= 3)
    .slice(0, 8);
};

const YAPPY_FIXED_PROVIDER_ALIASES = [
  {
    id: 'ensa',
    label: 'ENSA',
    terms: ['ensa'],
  },
  {
    id: 'mas-movil',
    label: 'Mas Movil',
    terms: ['mas movil', 'masmovil', 'cable wireless', 'cable and wireless', 'cable & wireless'],
  },
  {
    id: 'idaan',
    label: 'IDAAN',
    terms: ['idaan', 'idann'],
  },
];

const detectYappyFixedProvider = (transaction) => {
  const raw = normalizeText(
    `${transaction.merchant || ''} ${transaction.description || ''}`
  );

  return (
    YAPPY_FIXED_PROVIDER_ALIASES.find((provider) =>
      provider.terms.some((term) => raw.includes(normalizeText(term)))
    ) || null
  );
};

const recurringYappyKey = (transaction) => {
  const provider = detectYappyFixedProvider(transaction);
  if (provider) return `provider:${provider.id}`;

  return recurringYappyTokens(transaction).slice(0, 4).join(' ');
};

const tokenSimilarity = (a, b) => {
  const left = new Set(a);
  const right = new Set(b);

  if (!left.size || !right.size) return 0;

  let intersection = 0;
  left.forEach((token) => {
    if (right.has(token)) intersection += 1;
  });

  return intersection / Math.min(left.size, right.size);
};

const monthDistance = (a, b) =>
  (b.getFullYear() - a.getFullYear()) * 12 +
  (b.getMonth() - a.getMonth());

const nextMonthlyDateAfter = (lastDate, typicalDay, start) => {
  let candidate = dateForDayOfMonth(
    start.getFullYear(),
    start.getMonth(),
    typicalDay
  );

  if (candidate <= start) {
    candidate = dateForDayOfMonth(
      start.getFullYear(),
      start.getMonth() + 1,
      typicalDay
    );
  }

  if (candidate <= lastDate) {
    candidate = dateForDayOfMonth(
      lastDate.getFullYear(),
      lastDate.getMonth() + 1,
      typicalDay
    );
  }

  return candidate;
};

const CashFlow = () => {
  const { t } = useI18n();
  const { payments, loading: payLoading } = useScheduledPayments();
  const { transactions, loading: txLoading } = useTransactions(null, {
    filters: { dateRange: 'all' },
  });
  const { cards, loading: cardsLoading } = useCreditCards();

  // Flow Lite onboarding bridge: only active when arriving from the Cards
  // post-save CTA (/cash-flow?setup=1). Normal visits are unaffected.
  const [searchParams] = useSearchParams();
  const setupMode = searchParams.get('setup') === '1';
  const [flowLiteDismissed, setFlowLiteDismissed] = useState(false);

  const navigate = useNavigate();
  const { onboarding, updateOnboarding } = useOnboarding();

  // Fire flow_opened exactly once per Flow page mount (not per render).
  useEffect(() => {
    trackProductEvent('flow_opened', { source_screen: 'flow' });
  }, []);

  // Balance-screenshot scanner for the full Flow available-cash control. The
  // scanned total is applied only when the user explicitly confirms; it reuses
  // the existing setCash (cashflow_available_cash) — never auto-overwritten.
  const [showBalanceScanner, setShowBalanceScanner] = useState(false);
  const [balanceApplied, setBalanceApplied] = useState(false);
  // Bumped when account balances are persisted, to refresh the Cash accounts panel.
  const [accountsRefreshKey, setAccountsRefreshKey] = useState(0);

  // Look-ahead: 'preset' (7/14/30) or 'custom' (exact end date). windowDays stays
  // the single horizon the engine uses; custom just derives it from a date. The
  // active mode + custom date are restored from localStorage on load.
  const initialLA = useMemo(() => initialLookahead(), []);
  const [windowDays, setWindowDays] = useState(initialLA.windowDays);
  const [lookaheadMode, setLookaheadMode] = useState(initialLA.mode);
  const [customDate, setCustomDate] = useState(initialLA.customDate);

  // Self-heal storage once if a stored custom date was invalid/past on load.
  useEffect(() => {
    if (initialLA.resetMode) writeLookaheadMode('preset');
  }, [initialLA.resetMode]);
  // One-time dated extra-income events (persisted to localStorage).
  const [extraIncome, setExtraIncome] = useState(() => readExtraIncome());
  // Restored SYNCHRONOUSLY from persistence on first render (lazy init) so the
  // confirmed starting balance survives refresh/reopen/relaunch and can never be
  // lost to effect ordering. '' means NO value set; '0' is a confirmed zero.
  const [availableCash, setAvailableCash] = useState(() => readAvailableCash());
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeDay, setIncomeDay] = useState('');
  // V2.7 recurring-income frequency ('monthly' | 'semi_monthly') + the quincenal
  // schedule. Canonical values only; UI labels come from i18n.
  const [incomeFrequency, setIncomeFrequency] = useState(() => readIncomeFrequency());
  const [semiMonthly, setSemiMonthly] = useState(() => readSemiMonthly());
  const [expectedDailySpend, setExpectedDailySpend] = useState('');
  const [whatIfSpend, setWhatIfSpend] = useState('');
  const [yappyOverrides, setYappyOverrides] = useState(() => readYappyOverrides());
  const [editingYappyKey, setEditingYappyKey] = useState(null);
  const [yappyEditForm, setYappyEditForm] = useState({
    label: '',
    amount: '',
    nextDateStr: '',
  });

  // Existing simple recurring-income model:
  // latest month's INCOME total, using the latest deposit's day-of-month.
  const detectedIncome = useMemo(() => {
    if (!transactions?.length) return { amount: 0, day: 1 };

    const incomes = transactions
      .filter(
        (t) =>
          t.budgetBucket === 'INCOME' &&
          Number(t.amount) > 0 &&
          t.dateString
      )
      .sort((a, b) => parseISO(b.dateString) - parseISO(a.dateString));

    if (incomes.length === 0) return { amount: 0, day: 1 };

    const latest = incomes[0];
    const day = parseInt(latest.dateString.split('-')[2], 10) || 1;
    const ym = latest.dateString.substring(0, 7);

    const monthTotal = incomes
      .filter((t) => t.dateString.substring(0, 7) === ym)
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    return { amount: Math.round(monthTotal), day };
  }, [transactions]);

  // Detect recurring fixed expenses paid through Yappy from transaction history.
  // This is history-derived, not provider-specific. A candidate must repeat
  // under a similar description fingerprint with a roughly monthly cadence.
  const recurringYappy = useMemo(() => {
    if (!transactions?.length) return [];

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const historyStart = addMonths(today, -6);
    const groups = [];

    transactions.forEach((t) => {
      if (!t.dateString || Number(t.amount) >= 0) return;

      const tokens = recurringYappyTokens(t);
      const key = recurringYappyKey(t);
      if (!key || tokens.length === 0) return;

      const date = parseISO(t.dateString);
      if (
        Number.isNaN(date.getTime()) ||
        date < historyStart ||
        date >= today
      ) {
        return;
      }

      const amount = Math.abs(Number(t.amount) || 0);
      if (!amount) return;

      const provider = detectYappyFixedProvider(t);

      const item = {
        date,
        amount,
        label: provider?.label || String(t.merchant || t.description || key).trim(),
        key,
        tokens,
        providerId: provider?.id || null,
      };

      const matchingGroup = groups.find((group) => {
        if (provider?.id && group.providerId) {
          return provider.id === group.providerId;
        }

        return tokenSimilarity(group.tokens, tokens) >= 0.67;
      });

      if (matchingGroup) {
        matchingGroup.items.push(item);
        const overlap = matchingGroup.tokens.filter((token) =>
          tokens.includes(token)
        );
        if (overlap.length >= 2) matchingGroup.tokens = overlap;
      } else {
        groups.push({
          key,
          tokens,
          providerId: provider?.id || null,
          items: [item],
        });
      }
    });

    const detected = [];

    groups.forEach((group) => {
      const { items } = group;
      const key = group.providerId
        ? `provider:${group.providerId}`
        : group.tokens.slice(0, 4).join(' ') || group.key;
      const sorted = items.sort((a, b) => a.date - b.date);
      if (sorted.length < 2) return;

      const recent = sorted.slice(-4);
      const gaps = [];

      for (let i = 1; i < recent.length; i += 1) {
        const days = differenceInCalendarDays(
          recent[i].date,
          recent[i - 1].date
        );

        const months = monthDistance(
          recent[i - 1].date,
          recent[i].date
        );

        if (months >= 1 && months <= 2) gaps.push(days);
      }

      const monthlyEnough =
        gaps.length > 0 &&
        gaps.filter((days) => days >= 20 && days <= 45).length >=
          Math.ceil(gaps.length / 2);

      if (!monthlyEnough) return;

      const last = recent[recent.length - 1];
      const typicalAmount = median(recent.map((item) => item.amount));
      const typicalDay = Math.max(
        1,
        Math.min(
          31,
          Math.round(median(recent.map((item) => item.date.getDate())))
        )
      );

      const nextDate = nextMonthlyDateAfter(
        last.date,
        typicalDay,
        today
      );

      detected.push({
        key,
        label: last.label || key,
        amount: typicalAmount,
        nextDate,
        nextDateStr: format(nextDate, 'yyyy-MM-dd'),
      });
    });

    return detected.sort((a, b) => a.nextDate - b.nextDate);
  }, [transactions]);

  const recurringYappyAdjusted = useMemo(() => {
    return (recurringYappy || [])
      .map((item) => {
        const override = yappyOverrides[item.key] || {};

        if (override.ignored) return null;

        const amount =
          override.amount !== undefined && override.amount !== ''
            ? Math.max(0, Number(override.amount) || 0)
            : item.amount;

        const nextDateStr = override.nextDateStr || item.nextDateStr;
        const nextDate = nextDateStr ? parseISO(nextDateStr) : item.nextDate;

        return {
          ...item,
          label: override.label || item.label,
          amount,
          nextDate,
          nextDateStr,
          confirmed: Boolean(override.confirmed),
          userAdjusted:
            Boolean(override.label) ||
            override.amount !== undefined ||
            Boolean(override.nextDateStr),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.nextDate - b.nextDate);
  }, [recurringYappy, yappyOverrides]);

  const saveYappyOverrides = (nextValue) => {
    setYappyOverrides(nextValue);
    writeYappyOverrides(nextValue);
  };

  const confirmYappy = (item) => {
    const next = {
      ...yappyOverrides,
      [item.key]: {
        ...(yappyOverrides[item.key] || {}),
        confirmed: true,
        ignored: false,
      },
    };
    saveYappyOverrides(next);
  };

  const ignoreYappy = (item) => {
    const next = {
      ...yappyOverrides,
      [item.key]: {
        ...(yappyOverrides[item.key] || {}),
        ignored: true,
        confirmed: false,
      },
    };
    saveYappyOverrides(next);
    if (editingYappyKey === item.key) setEditingYappyKey(null);
  };

  const startEditingYappy = (item) => {
    setEditingYappyKey(item.key);
    setYappyEditForm({
      label: item.label || '',
      amount: String(Math.round(Number(item.amount || 0) * 100) / 100),
      nextDateStr: item.nextDateStr || '',
    });
  };

  const saveYappyEdit = (item) => {
    const amount = Math.max(0, Number(yappyEditForm.amount) || 0);

    const next = {
      ...yappyOverrides,
      [item.key]: {
        ...(yappyOverrides[item.key] || {}),
        label: yappyEditForm.label.trim() || item.label,
        amount,
        nextDateStr: yappyEditForm.nextDateStr || item.nextDateStr,
        confirmed: true,
        ignored: false,
      },
    };

    saveYappyOverrides(next);
    setEditingYappyKey(null);
  };

  const restoreIgnoredYappy = (key) => {
    const next = { ...yappyOverrides };
    if (!next[key]) return;
    next[key] = { ...next[key], ignored: false };
    saveYappyOverrides(next);
  };

  const ignoredYappyCount = Object.values(yappyOverrides).filter(
    (value) => value?.ignored
  ).length;

  // V2.1 spending model:
  //
  // 1) Learn "normal" variable spending from the most recent 8 weeks.
  // 2) Include both cash/debit and credit-card purchases.
  // 3) Use the MEDIAN weekly total instead of a raw daily average so one
  //    unusually expensive week does not dominate the forecast.
  // 4) Learn what share historically happened on credit cards.
  // 5) Only the cash/debit share reduces projected cash day-by-day.
  //    The credit-card share is shown as future card accrual; it does not hit
  //    cash until a future statement/payment cycle.
  //
  // This deliberately avoids pretending that a card purchase leaves the bank
  // account on purchase day.
  const spendingModel = useMemo(() => {
    if (!transactions?.length) {
      return {
        dailyTotal: 0,
        weeklyMedian: 0,
        cardShare: 0,
        cashShare: 1,
        qualifyingCount: 0,
        activeWeeks: 0,
      };
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const historyStart = addDays(today, -HISTORY_DAYS);

    const scheduledLabels = (payments || [])
      .map((p) => normalizeText(p.entity))
      .filter((label) => label.length >= 4);

    const validHistoryDates = transactions
      .map((t) => {
        if (!t.dateString) return null;
        const d = parseISO(t.dateString);
        return Number.isNaN(d.getTime()) ? null : d;
      })
      .filter((d) => d && d >= historyStart && d < today);

    const oldestHistoryDate = validHistoryDates.length
      ? validHistoryDates.reduce((oldest, d) => (d < oldest ? d : oldest))
      : null;

    const availableDays = oldestHistoryDate
      ? Math.min(
          HISTORY_DAYS,
          Math.max(1, differenceInCalendarDays(today, oldestHistoryDate))
        )
      : 0;

    const activeWeeks = availableDays
      ? Math.min(HISTORY_WEEKS, Math.max(1, Math.ceil(availableDays / 7)))
      : 0;

    const weeks = Array.from({ length: activeWeeks }, () => ({
      total: 0,
      cash: 0,
      card: 0,
    }));

    let qualifyingCount = 0;

    transactions.forEach((t) => {
      if (!activeWeeks) return;
      if (!t.dateString || Number(t.amount) >= 0) return;
      if (t.is_transfer) return;
      if (!['NEEDS', 'WANTS'].includes(t.budgetBucket)) return;

      const d = parseISO(t.dateString);
      if (Number.isNaN(d.getTime()) || d < historyStart || d >= today) return;

      const description = normalizeText(
        `${t.merchant || ''} ${t.description || ''}`
      );

      const matchesKnownBill = scheduledLabels.some(
        (label) => description.includes(label)
      );

      if (matchesKnownBill) return;

      const daysAgo = differenceInCalendarDays(today, d);

      // Week 0 = 1-7 days ago, week 1 = 8-14 days ago, etc.
      const weekIndex = Math.floor((daysAgo - 1) / 7);

      if (weekIndex < 0 || weekIndex >= activeWeeks) return;

      const amount = Math.abs(Number(t.amount) || 0);
      if (!amount) return;

      qualifyingCount += 1;
      weeks[weekIndex].total += amount;

      if (looksLikeCreditAccount(t.account)) {
        weeks[weekIndex].card += amount;
      } else {
        weeks[weekIndex].cash += amount;
      }
    });

    const weeklyMedian = median(weeks.map((week) => week.total));
    const totalSpend = weeks.reduce((sum, week) => sum + week.total, 0);
    const totalCardSpend = weeks.reduce((sum, week) => sum + week.card, 0);

    const cardShare =
      totalSpend > 0
        ? Math.max(0, Math.min(1, totalCardSpend / totalSpend))
        : 0;

    return {
      dailyTotal: weeklyMedian / 7,
      weeklyMedian,
      cardShare,
      cashShare: 1 - cardShare,
      qualifyingCount,
      activeWeeks,
    };
  }, [transactions, payments]);

  // Load persisted assumptions. The new expected-spend key lets V2.1 seed
  // from the new median-week model instead of inheriting V2's raw average.
  useEffect(() => {
    // Available cash is restored via lazy state init (see useState above), NOT
    // here — keeping it out of this transaction-derived effect prevents the
    // confirmed balance from being reset/raced on remount or data refresh.
    const incomeStored = localStorage.getItem(LS_INCOME_AMT);
    setIncomeAmount(
      incomeStored !== null
        ? incomeStored
        : detectedIncome.amount
          ? String(detectedIncome.amount)
          : ''
    );

    const incomeDayStored = localStorage.getItem(LS_INCOME_DAY);
    setIncomeDay(
      incomeDayStored !== null
        ? incomeDayStored
        : detectedIncome.day
          ? String(detectedIncome.day)
          : ''
    );

    const spendStored = localStorage.getItem(LS_EXPECTED_DAILY);
    setExpectedDailySpend(
      spendStored !== null
        ? spendStored
        : spendingModel.dailyTotal
          ? String(Math.round(spendingModel.dailyTotal * 100) / 100)
          : ''
    );
  }, [
    detectedIncome.amount,
    detectedIncome.day,
    spendingModel.dailyTotal,
  ]);

  // The ONE explicit-confirmation entry point (manual entry + "Use $X as
  // available cash"). Persists exactly what the user confirmed; a blank value
  // clears back to unset (never stored as 0). Guarded against storage failure.
  const setCash = (value) => {
    setAvailableCash(value);
    writeAvailableCash(value);
  };

  const setIncAmt = (value) => {
    setIncomeAmount(value);
    localStorage.setItem(LS_INCOME_AMT, value);
  };

  const setIncDay = (value) => {
    setIncomeDay(value);
    localStorage.setItem(LS_INCOME_DAY, value);
  };

  const persistSemiMonthly = (next) => {
    const normalized = normalizeSemiMonthly(next);
    setSemiMonthly(normalized);
    try {
      localStorage.setItem(LS_INCOME_SEMI, JSON.stringify(normalized));
    } catch {
      // Ignore localStorage write errors and keep the current UI state.
    }
  };

  // Switch frequency. Moving to semi-monthly seeds both installments from the
  // current single amount (same-amount on) so the projection stays sensible
  // without extra input; the user can change everything afterward.
  const setFrequency = (value) => {
    const freq = value === 'semi_monthly' ? 'semi_monthly' : 'monthly';
    setIncomeFrequency(freq);
    try {
      localStorage.setItem(LS_INCOME_FREQ, freq);
    } catch {
      // Ignore localStorage write errors and keep the current UI state.
    }
    if (freq === 'semi_monthly') {
      const seedAmount = parseFloat(incomeAmount) || semiMonthly.first_amount || 0;
      persistSemiMonthly({
        first_day: semiMonthly.first_day ?? DEFAULT_SEMI_MONTHLY.first_day,
        second_day: semiMonthly.second_day ?? DEFAULT_SEMI_MONTHLY.second_day,
        first_amount: seedAmount,
        second_amount: seedAmount,
        same_amount: true,
      });
    }
  };

  const setSemiFirstDay = (value) => persistSemiMonthly({ ...semiMonthly, first_day: value });
  const setSemiSecondDay = (value) => persistSemiMonthly({ ...semiMonthly, second_day: value });
  const setSemiFirstAmount = (value) => {
    const amt = parseFloat(value);
    persistSemiMonthly({
      ...semiMonthly,
      first_amount: Number.isFinite(amt) ? amt : 0,
      // Mirror into the second installment while same-amount is on.
      second_amount: semiMonthly.same_amount ? (Number.isFinite(amt) ? amt : 0) : semiMonthly.second_amount,
    });
  };
  const setSemiSecondAmount = (value) => {
    const amt = parseFloat(value);
    persistSemiMonthly({ ...semiMonthly, second_amount: Number.isFinite(amt) ? amt : 0, same_amount: false });
  };
  const setSemiSameAmount = (checked) => {
    persistSemiMonthly({
      ...semiMonthly,
      same_amount: !!checked,
      second_amount: checked ? semiMonthly.first_amount : semiMonthly.second_amount,
    });
  };

  const setDailySpend = (value) => {
    setExpectedDailySpend(value);
    localStorage.setItem(LS_EXPECTED_DAILY, value);
  };

  const resetDailySpend = () => {
    const detected = spendingModel.dailyTotal
      ? String(Math.round(spendingModel.dailyTotal * 100) / 100)
      : '';

    setExpectedDailySpend(detected);

    if (detected) {
      localStorage.setItem(LS_EXPECTED_DAILY, detected);
    } else {
      localStorage.removeItem(LS_EXPECTED_DAILY);
    }
  };

  // --- Look-ahead controls ---
  // custom_horizon_used tracks a DELIBERATE user action, not restoration of a
  // saved horizon on load. This ref fires the event at most once per custom
  // "session" (until the user switches back to a preset), so repeated date
  // tweaks or rerenders don't emit duplicate identical events. It starts false
  // and is only flipped by an actual handler, so a page that initializes in
  // custom mode never emits the event.
  const customHorizonTrackedRef = useRef(false);
  const trackCustomHorizonOnce = () => {
    if (!customHorizonTrackedRef.current) {
      customHorizonTrackedRef.current = true;
      trackProductEvent('custom_horizon_used', { source_screen: 'flow' });
    }
  };

  const selectPreset = (days) => {
    setLookaheadMode('preset');
    writeLookaheadMode('preset');
    setWindowDays(days);
    // Leaving custom re-arms the event for a genuine future re-engagement.
    customHorizonTrackedRef.current = false;
  };

  const selectCustomMode = () => {
    setLookaheadMode('custom');
    writeLookaheadMode('custom');
    // Restore the last valid (non-past) custom date if we have one.
    const diff = daysFromTodayTo(customDate);
    if (diff !== null) {
      setWindowDays(diff);
      trackCustomHorizonOnce();
    }
  };

  const changeCustomDate = (value) => {
    setCustomDate(value);
    writeCustomLookahead(value);
    const diff = daysFromTodayTo(value);
    // Only a valid, non-past date drives the projection horizon.
    if (diff !== null) {
      setLookaheadMode('custom');
      writeLookaheadMode('custom');
      setWindowDays(diff);
      trackCustomHorizonOnce();
    }
  };

  const customDateValid = daysFromTodayTo(customDate) !== null;
  const isLongRange = windowDays > LONG_RANGE_DAYS;
  // Custom = today is a valid 0-day window internally, but should read "Today".
  const isCustomToday = lookaheadMode === 'custom' && windowDays === 0;
  const horizonShort = isCustomToday ? t('flow.todayShort') : `${windowDays}d`;
  // Horizon phrase for "included in your {horizon} projection" style copy.
  const horizonPhrase = isCustomToday ? t('flow.horizonTodayPossessive') : t('flow.horizonDayShort', { days: windowDays });
  // Locale-aware timeline event-type label (canonical row.type unchanged).
  const eventTypeLabel = (type) => {
    const key = `flow.eventTypes.${type}`;
    const val = t(key);
    return val === key ? t('flow.eventTypes.default') : val;
  };

  // --- Extra-income CRUD (persisted) ---
  const persistExtraIncome = (next) => {
    setExtraIncome(next);
    writeExtraIncome(next);
  };

  const addExtraIncome = (item) => {
    persistExtraIncome([...extraIncome, { ...item, id: newExtraIncomeId() }]);
    trackProductEvent('extra_income_added', { source_screen: 'flow' });
  };

  const updateExtraIncome = (id, patch) =>
    persistExtraIncome(
      extraIncome.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );

  const deleteExtraIncome = (id) =>
    persistExtraIncome(extraIncome.filter((e) => e.id !== id));

  const cash = parseFloat(availableCash) || 0;
  const incAmt = parseFloat(incomeAmount) || 0;
  const incDay = parseInt(incomeDay, 10) || 0;
  const semiValidation = useMemo(() => validateSemiMonthly(semiMonthly), [semiMonthly]);
  const dailyLifestyleSpend = Math.max(
    0,
    parseFloat(expectedDailySpend) || 0
  );
  const scenarioSpend = Math.max(0, parseFloat(whatIfSpend) || 0);

  const dailyCashSpend = dailyLifestyleSpend * spendingModel.cashShare;
  const dailyCardSpend = dailyLifestyleSpend * spendingModel.cardShare;

  const proj = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const windowEnd = addDays(start, windowDays);
    const events = [];

    // Pending scheduled bills. Overdue bills are pulled to today.
    (payments || []).forEach((p) => {
      if (p.status === 'paid' || !p.payment_date) return;

      const d = parseISO(p.payment_date);
      if (Number.isNaN(d.getTime()) || d > windowEnd) return;

      const overdue = d < start;
      const eventDate = overdue ? start : d;

      events.push({
        date: eventDate,
        dateStr: format(eventDate, 'yyyy-MM-dd'),
        label: p.entity,
        amount: -Math.abs(Number(p.amount) || 0),
        type: 'bill',
        overdue,
      });
    });

    // History-derived recurring Yappy fixed expenses.
    // If an equivalent scheduled payment already exists near the same date,
    // skip the inferred item to avoid double-counting.
    (recurringYappyAdjusted || []).forEach((item) => {
      if (!item.nextDate || item.nextDate > windowEnd) return;

      const duplicateScheduled = (payments || []).some((p) => {
        if (p.status === 'paid' || !p.payment_date) return false;

        const scheduledDate = parseISO(p.payment_date);
        if (Number.isNaN(scheduledDate.getTime())) return false;

        const dateGap = Math.abs(
          differenceInCalendarDays(scheduledDate, item.nextDate)
        );

        const scheduledAmount = Math.abs(Number(p.amount) || 0);
        const amountTolerance = Math.max(5, item.amount * 0.2);
        const sameAmount =
          Math.abs(scheduledAmount - item.amount) <= amountTolerance;

        const scheduledText = normalizeText(p.entity);
        const sameEntity = item.key
          .split(' ')
          .filter(Boolean)
          .some((token) => scheduledText.includes(token));

        return dateGap <= 7 && (sameAmount || sameEntity);
      });

      if (duplicateScheduled) return;

      events.push({
        date: item.nextDate,
        dateStr: item.nextDateStr,
        label: item.label,
        isRecurringYappy: true,
        amount: -Math.abs(item.amount),
        type: 'recurring-yappy',
      });
    });

    // Future recurring income.
    // Strictly future (> today) so current cash does not double-count income
    // that may already have posted today.
    if (incomeFrequency === 'semi_monthly') {
      // V2.7 semi-monthly / quincenal: TWO calendar-month installments, each a
      // separate dated event on its own date (never combined into one). Skipped
      // when the schedule is invalid (duplicate/reversed dates) so the timeline
      // never shows an ambiguous payment; the UI surfaces the validation.
      if (semiValidation.valid) {
        incomeOccurrences('semi_monthly', semiMonthly, start, windowEnd, { strictlyAfterStart: true })
          .forEach((o) => {
            if (!(o.amount > 0)) return;
            events.push({
              date: o.date,
              dateStr: o.dateStr,
              label: o.installment === 1
                ? t('flow.semiMonthly.firstPaymentLabel')
                : t('flow.semiMonthly.secondPaymentLabel'),
              amount: o.amount,
              type: 'income',
            });
          });
      }
    } else if (incAmt > 0 && incDay >= 1 && incDay <= 31) {
      // Existing monthly recurrence — unchanged.
      for (let m = 0; m <= 2; m += 1) {
        const d = dateForDayOfMonth(
          start.getFullYear(),
          start.getMonth() + m,
          incDay
        );

        if (d > start && d <= windowEnd) {
          events.push({
            date: d,
            dateStr: format(d, 'yyyy-MM-dd'),
            label: 'Expected income',
            amount: incAmt,
            type: 'income',
          });
        }
      }
    }

    // Existing unpaid statement balances are known cash obligations.
    // New projected card purchases are NOT added here: they belong to a future
    // card cycle and are tracked separately as expected card accrual.
    (cards || []).forEach((card) => {
      if (card.statement_paid) return;

      const balance = Number(card.statement_balance) || 0;
      const due = nextDueDate(card.due_day);

      if (balance > 0 && due && due <= windowEnd) {
        events.push({
          date: due,
          dateStr: format(due, 'yyyy-MM-dd'),
          label: `${card.card_name} statement`,
          amount: -balance,
          type: 'card',
        });
      }
    });

    // One-time dated extra income (V2.6). A positive inflow on its own date.
    // Included ONLY when the event falls within [start, windowEnd]: an event
    // today (== start) counts once; strictly-past events are ignored so they
    // never affect a future projection window, and events past windowEnd are
    // out of horizon. It joins the same chronological stream as every other
    // event, so date ordering (and thus the low point/shortfall) stays correct.
    (extraIncome || []).forEach((item) => {
      const amt = Number(item?.amount) || 0;
      if (!(amt > 0) || !item?.date) return;

      const d = parseISO(item.date);
      if (Number.isNaN(d.getTime())) return;

      const eventDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (eventDate < start || eventDate > windowEnd) return;

      events.push({
        date: eventDate,
        dateStr: item.date,
        label: (item.label && item.label.trim()) || 'Extra income',
        amount: amt,
        type: 'extra-income',
      });
    });

    // Only the historically cash/debit portion of everyday lifestyle spending
    // reduces current cash now.
    if (dailyCashSpend > 0) {
      for (let day = 1; day <= windowDays; day += 1) {
        const d = addDays(start, day);

        events.push({
          date: d,
          dateStr: format(d, 'yyyy-MM-dd'),
          label: 'Expected cash/debit spending',
          amount: -dailyCashSpend,
          type: 'expected-cash',
        });
      }
    }

    // Scenario input is immediate cash spending and intentionally not persisted.
    if (scenarioSpend > 0) {
      events.push({
        date: start,
        dateStr: format(start, 'yyyy-MM-dd'),
        label: 'What-if cash spend',
        amount: -scenarioSpend,
        type: 'scenario',
      });
    }

    const priority = {
      income: 0,
      'extra-income': 0,
      bill: 1,
      card: 1,
      'recurring-yappy': 1,
      scenario: 2,
      'expected-cash': 3,
    };

    events.sort(
      (a, b) =>
        a.date - b.date ||
        (priority[a.type] ?? 9) - (priority[b.type] ?? 9)
    );

    let running = cash;
    let lowest = cash;
    let lowestDate = null;
    let shortfall = null;

    const rows = events.map((event) => {
      running += event.amount;

      if (running < lowest) {
        lowest = running;
        lowestDate = event.dateStr;
      }

      if (shortfall === null && running < 0) {
        shortfall = {
          date: event.dateStr,
          label: event.label,
          balance: running,
        };
      }

      return { ...event, running };
    });

    const totalIncome = events
      .filter((e) => e.type === 'income')
      .reduce((sum, e) => sum + e.amount, 0);

    const totalExtraIncome = events
      .filter((e) => e.type === 'extra-income')
      .reduce((sum, e) => sum + e.amount, 0);

    const totalBills = Math.abs(
      events
        .filter((e) => e.type === 'bill')
        .reduce((sum, e) => sum + e.amount, 0)
    );

    const totalCards = Math.abs(
      events
        .filter((e) => e.type === 'card')
        .reduce((sum, e) => sum + e.amount, 0)
    );

    const totalRecurringYappy = Math.abs(
      events
        .filter((e) => e.type === 'recurring-yappy')
        .reduce((sum, e) => sum + e.amount, 0)
    );

    const totalExpectedCashSpending = Math.abs(
      events
        .filter((e) => e.type === 'expected-cash')
        .reduce((sum, e) => sum + e.amount, 0)
    );

    const totalScenarioSpend = Math.abs(
      events
        .filter((e) => e.type === 'scenario')
        .reduce((sum, e) => sum + e.amount, 0)
    );

    const totalExpectedLifestyleSpending =
      dailyLifestyleSpend * windowDays;

    const expectedCardAccrual = dailyCardSpend * windowDays;

    return {
      rows,
      lowest,
      lowestDate,
      shortfall,
      totalIncome,
      totalExtraIncome,
      totalBills,
      totalCards,
      totalRecurringYappy,
      totalKnownCommitments: totalBills + totalCards + totalRecurringYappy,
      totalExpectedCashSpending,
      totalExpectedLifestyleSpending,
      expectedCardAccrual,
      totalScenarioSpend,
      projectedEnd: running,
    };
  }, [
    payments,
    cards,
    recurringYappyAdjusted,
    cash,
    incAmt,
    incDay,
    incomeFrequency,
    semiMonthly,
    semiValidation,
    t,
    dailyCashSpend,
    dailyCardSpend,
    dailyLifestyleSpend,
    scenarioSpend,
    windowDays,
    extraIncome,
  ]);

  const cardCalendarEvents = useMemo(
    () =>
      (cards || [])
        .filter(
          (card) =>
            (Number(card.statement_balance) || 0) > 0 && card.due_day
        )
        .map((card) => {
          const due = nextDueDate(card.due_day);
          if (!due) return null;

          return {
            id: `card-${card.id}`,
            entity: `${card.card_name} statement`,
            amount: Number(card.statement_balance) || 0,
            payment_date: format(due, 'yyyy-MM-dd'),
            status: card.statement_paid ? 'paid' : 'pending',
            readOnly: true,
          };
        })
        .filter(Boolean),
    [cards]
  );

  const loading = payLoading || txLoading || cardsLoading;
  const hasSpendEstimate = dailyLifestyleSpend > 0;

  // Flow -> Activity next-step prompt. "Meaningful setup" = available cash is
  // set AND there is some income or known-commitment context. Shown once, only
  // until the user dismisses it or completes an activity import.
  const hasSemiMonthlyIncome =
    incomeFrequency === 'semi_monthly' &&
    (Number(semiMonthly.first_amount) > 0 || Number(semiMonthly.second_amount) > 0);
  const flowHasMeaningfulSetup =
    String(availableCash ?? '') !== '' &&
    (String(incomeAmount ?? '') !== '' || hasSemiMonthlyIncome || proj.totalKnownCommitments > 0);
  const showActivityPrompt =
    !loading &&
    flowHasMeaningfulSetup &&
    !onboarding.activityImportCompleted &&
    !onboarding.activityPromptDismissed;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PrimaryNavBar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28 md:pb-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">{t('flow.title')}</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            {t('flow.subtitle')}
          </p>
        </div>

        {setupMode && !flowLiteDismissed && (
          <FlowLiteSetup
            cards={cards}
            payments={payments}
            loading={loading}
            availableCash={availableCash}
            incomeAmount={incomeAmount}
            onCashChange={setCash}
            onIncomeAmountChange={setIncAmt}
            onBalanceApplied={() => updateOnboarding({ balanceScanCompleted: true })}
            onSeeFullFlow={() => setFlowLiteDismissed(true)}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
              {t('flow.availableCashNow')}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-2xl font-bold text-muted-foreground">
                $
              </span>
              <input
                type="number"
                value={availableCash}
                onChange={(e) => setCash(e.target.value)}
                placeholder="0.00"
                className="w-full text-2xl font-bold text-foreground outline-none bg-transparent"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Your current spendable cash across checking, savings, and cash.
            </p>
            <button
              type="button"
              onClick={() => {
                const opening = !showBalanceScanner;
                if (opening) {
                  setBalanceApplied(false);
                  trackProductEvent('balance_scan_started', { source_screen: 'flow' });
                }
                setShowBalanceScanner(opening);
              }}
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700"
            >
              <Icon name="Camera" size={14} />
              {t('flow.scanBalances')}
            </button>
            {balanceApplied && (
              <p className="text-[11px] font-semibold text-emerald-600 mt-1">
                {t('flow.availableCashUpdated')}
              </p>
            )}
          </div>

          <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-2">
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider">
                {t('flow.recurringIncome')}
              </label>
              <select
                value={incomeFrequency}
                onChange={(e) => setFrequency(e.target.value)}
                aria-label={t('flow.recurringFrequency')}
                className="text-xs font-semibold text-foreground bg-transparent border border-border rounded-md px-2 py-1 outline-none"
              >
                <option value="monthly">{t('flow.freq.monthly')}</option>
                <option value="semi_monthly">{t('flow.freq.semiMonthly')}</option>
              </select>
            </div>

            {incomeFrequency === 'semi_monthly' ? (
              <div className="space-y-3">
                {/* First installment */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-muted-foreground w-28 shrink-0">
                    {t('flow.semiMonthly.firstPayment')}
                  </span>
                  <span className="text-lg font-bold text-muted-foreground">$</span>
                  <input
                    type="number"
                    value={semiMonthly.first_amount || ''}
                    onChange={(e) => setSemiFirstAmount(e.target.value)}
                    placeholder="0"
                    className="w-20 text-lg font-bold text-emerald-600 outline-none bg-transparent"
                  />
                  <span className="text-xs text-muted-foreground">{t('flow.onDay')}</span>
                  <select
                    value={semiMonthly.first_day === LAST_DAY ? LAST_DAY : String(semiMonthly.first_day)}
                    onChange={(e) => setSemiFirstDay(e.target.value === LAST_DAY ? LAST_DAY : parseInt(e.target.value, 10))}
                    className="text-sm font-bold text-foreground bg-transparent border-b border-border outline-none py-0.5"
                  >
                    {DAY_OPTIONS.map((d) => (
                      <option key={d} value={String(d)}>{d}</option>
                    ))}
                    <option value={LAST_DAY}>{t('flow.semiMonthly.lastDay')}</option>
                  </select>
                </div>

                {/* Second installment */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-muted-foreground w-28 shrink-0">
                    {t('flow.semiMonthly.secondPayment')}
                  </span>
                  <span className="text-lg font-bold text-muted-foreground">$</span>
                  <input
                    type="number"
                    value={semiMonthly.second_amount || ''}
                    onChange={(e) => setSemiSecondAmount(e.target.value)}
                    disabled={semiMonthly.same_amount}
                    placeholder="0"
                    className="w-20 text-lg font-bold text-emerald-600 outline-none bg-transparent disabled:opacity-50"
                  />
                  <span className="text-xs text-muted-foreground">{t('flow.onDay')}</span>
                  <select
                    value={semiMonthly.second_day === LAST_DAY ? LAST_DAY : String(semiMonthly.second_day)}
                    onChange={(e) => setSemiSecondDay(e.target.value === LAST_DAY ? LAST_DAY : parseInt(e.target.value, 10))}
                    className="text-sm font-bold text-foreground bg-transparent border-b border-border outline-none py-0.5"
                  >
                    {DAY_OPTIONS.map((d) => (
                      <option key={d} value={String(d)}>{d}</option>
                    ))}
                    <option value={LAST_DAY}>{t('flow.semiMonthly.lastDay')}</option>
                  </select>
                </div>

                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={semiMonthly.same_amount}
                    onChange={(e) => setSemiSameAmount(e.target.checked)}
                    className="accent-emerald-600"
                  />
                  {t('flow.semiMonthly.sameAmount')}
                </label>

                {semiValidation.valid ? (
                  <p className="text-[11px] text-muted-foreground">{t('flow.semiMonthly.help')}</p>
                ) : (
                  <p className="text-[11px] font-semibold text-red-600">
                    {t(`flow.semiMonthly.${semiValidation.error}`)}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold text-muted-foreground">$</span>
                  <input
                    type="number"
                    value={incomeAmount}
                    onChange={(e) => setIncAmt(e.target.value)}
                    placeholder="0"
                    className="w-24 text-xl font-bold text-emerald-600 outline-none bg-transparent"
                  />
                  <span className="text-sm text-muted-foreground">{t('flow.onDay')}</span>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={incomeDay}
                    onChange={(e) => setIncDay(e.target.value)}
                    placeholder="-"
                    className="w-12 text-xl font-bold text-foreground outline-none bg-transparent border-b border-border"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {t('flow.incomeAutoDetected')}
                </p>
              </>
            )}
          </div>

          <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider">
                {t('flow.expectedEverydaySpending')}
              </label>
              <button
                type="button"
                onClick={resetDailySpend}
                className="text-[10px] font-bold text-blue-600 hover:text-blue-700"
              >
                {t('flow.useHistory')}
              </button>
            </div>

            <div className="flex items-center gap-1 mt-1">
              <span className="text-xl font-bold text-muted-foreground">
                $
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={expectedDailySpend}
                onChange={(e) => setDailySpend(e.target.value)}
                placeholder="0.00"
                className="w-full text-xl font-bold text-foreground outline-none bg-transparent"
              />
              <span className="text-sm text-muted-foreground">{t('flow.perDay')}</span>
            </div>

            <p className="text-[11px] text-muted-foreground mt-1">
              {t('flow.typicalVariableSpending')}
            </p>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border shadow-sm flex flex-col justify-between">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
              {t('flow.lookAheadLabel')}
            </label>
            <div className="flex w-full gap-1 rounded-xl border border-border bg-muted/40 p-1">
              {WINDOW_OPTIONS.map((days) => {
                const active = lookaheadMode === 'preset' && windowDays === days;
                return (
                  <button
                    key={days}
                    onClick={() => selectPreset(days)}
                    className={`flex-1 min-w-0 py-2 min-h-[40px] rounded-lg text-sm font-bold transition-colors ${
                      active
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {days}d
                  </button>
                );
              })}
              <button
                onClick={selectCustomMode}
                className={`flex-1 min-w-0 py-2 min-h-[40px] rounded-lg text-sm font-bold transition-colors ${
                  lookaheadMode === 'custom'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('flow.horizonCustom')}
              </button>
            </div>

            {lookaheadMode === 'custom' && (
              <div className="mt-2">
                <input
                  type="date"
                  min={format(new Date(), 'yyyy-MM-dd')}
                  value={customDate}
                  onChange={(e) => changeCustomDate(e.target.value)}
                  className="w-full max-w-full py-2 px-2 min-h-[40px] rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-blue-500"
                />
                {customDate && !customDateValid && (
                  <p className="text-[11px] text-red-600 mt-1">
                    {t('flow.customDateInvalid')}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {isLongRange && (
          <p className="text-[11px] text-muted-foreground -mt-2 mb-6">
            {t('flow.longRangeNote')}
          </p>
        )}

        <CashAccountsPanel
          key={accountsRefreshKey}
          onApply={(total) => {
            setCash(String(Math.round((Number(total) || 0) * 100) / 100));
            setBalanceApplied(true);
          }}
        />

        <ExtraIncomePanel
          items={extraIncome}
          onAdd={addExtraIncome}
          onUpdate={updateExtraIncome}
          onDelete={deleteExtraIncome}
        />

        {showBalanceScanner && (
          <div className="mb-6">
            <BalanceScanner
              onApply={(total) => {
                setCash(String(Math.round((Number(total) || 0) * 100) / 100));
                updateOnboarding({ balanceScanCompleted: true });
                trackProductEvent('balance_scan_applied', { source_screen: 'flow' });
                setBalanceApplied(true);
                setShowBalanceScanner(false);
              }}
              onBalancesUpdated={() => setAccountsRefreshKey((k) => k + 1)}
              onClose={() => setShowBalanceScanner(false)}
            />
          </div>
        )}

        {loading ? (
          <div className="bg-card p-12 rounded-xl border border-border text-center text-muted-foreground">
            {t('flow.loadingCashFlow')}
          </div>
        ) : (
          <>
            <div className="bg-card rounded-2xl border border-border shadow-sm p-5 md:p-6 mb-6">
              <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    {t('flow.projectedAvailable')}
                  </p>
                  <p
                    className={`text-4xl md:text-5xl font-extrabold mt-1 ${
                      proj.projectedEnd < 0
                        ? 'text-red-600'
                        : 'text-foreground'
                    }`}
                  >
                    {money(proj.projectedEnd)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {isCustomToday
                      ? t('flow.cashPositionToday')
                      : t('flow.cashPositionDays', { days: windowDays })}
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-5 gap-y-3 text-sm">
                  <BreakdownItem label={t('flow.cashNow')} value={money(cash)} />
                  <BreakdownItem
                    label={t('flow.income')}
                    value={`+${money(proj.totalIncome)}`}
                    tone="positive"
                  />
                  {proj.totalExtraIncome > 0 && (
                    <BreakdownItem
                      label={t('flow.extraIncome')}
                      value={`+${money(proj.totalExtraIncome)}`}
                      tone="positive"
                    />
                  )}
                  <BreakdownItem
                    label={t('flow.known')}
                    value={`-${money(proj.totalKnownCommitments)}`}
                  />
                  <BreakdownItem
                    label={t('flow.expectedCash')}
                    value={`-${money(proj.totalExpectedCashSpending)}`}
                  />
                  <BreakdownItem
                    label={t('flow.whatIf')}
                    value={`-${money(proj.totalScenarioSpend)}`}
                  />
                </div>
              </div>

              {!hasSpendEstimate && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {t('flow.noSpendEstimate')}
                </div>
              )}
            </div>

            {/* FLOW -> ACTIVITY NEXT STEP (contextual, dismissible) */}
            {showActivityPrompt && (
              <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 shadow-sm p-5">
                <div className="flex items-start gap-3">
                  <div className="bg-primary/10 p-2.5 rounded-xl shrink-0">
                    <Icon name="ScanLine" size={22} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-extrabold text-foreground">
                      {t('flow.wantRealisticProjection')}
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {t('flow.scanActivityPrompt')}
                    </p>
                    <div className="mt-4 flex flex-col-reverse sm:flex-row gap-2">
                      <button
                        onClick={() => updateOnboarding({ activityPromptDismissed: true })}
                        className="px-5 py-3 min-h-[48px] rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                      >
                        {t('flow.notNow')}
                      </button>
                      <button
                        onClick={() => {
                          trackProductEvent('onboarding_activity_prompt_clicked', { source_screen: 'flow' });
                          navigate('/financial-overview?scan=activity');
                        }}
                        className="inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors"
                      >
                        <Icon name="Camera" size={18} />
                        {t('activity.scanRecentActivity')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-blue-900">
                    {t('flow.spendingBehaviorModel')}
                  </p>
                  <p className="text-xs text-blue-800 mt-1">
                    {t('flow.typicalWeek', { amount: money(spendingModel.weeklyMedian), weeks: HISTORY_WEEKS, cardPct: percent(spendingModel.cardShare), cashPct: percent(spendingModel.cashShare) })}
                  </p>
                </div>
                <div className="text-xs text-blue-900 md:text-right shrink-0">
                  <p>
                    {t('flow.cashImpact')} <strong>{money(dailyCashSpend)}{t('flow.perDaySuffix')}</strong>
                  </p>
                  <p>
                    {t('flow.cardAccrual')} <strong>{money(dailyCardSpend)}{t('flow.perDaySuffix')}</strong>
                  </p>
                </div>
              </div>

              <p className="text-[11px] text-blue-700 mt-2">
                {t('flow.cardPurchaseNote')}
              </p>
            </div>

            {(recurringYappyAdjusted.length > 0 || ignoredYappyCount > 0) && (
              <div className="bg-card border border-border rounded-xl p-4 mb-6">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      {t('flow.recurringYappyCommitments')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('flow.yappyInferNote')}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {t('flow.activeCount', { count: recurringYappyAdjusted.length })}
                    {ignoredYappyCount > 0 ? t('flow.ignoredSuffix', { count: ignoredYappyCount }) : ''}
                  </div>
                </div>

                <div className="space-y-3">
                  {recurringYappyAdjusted.map((item) => {
                    const includedInForecast =
                      item.nextDate &&
                      item.nextDate >= new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) &&
                      item.nextDate <= addDays(
                        new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()),
                        windowDays
                      );

                    const isEditing = editingYappyKey === item.key;

                    return (
                      <div
                        key={item.key}
                        className="rounded-xl border border-border bg-background/40 p-3"
                      >
                        {isEditing ? (
                          <div className="grid grid-cols-1 md:grid-cols-[1fr_150px_170px_auto] gap-2 items-end">
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                                {t('flow.name')}
                              </label>
                              <input
                                type="text"
                                value={yappyEditForm.label}
                                onChange={(e) =>
                                  setYappyEditForm((prev) => ({
                                    ...prev,
                                    label: e.target.value,
                                  }))
                                }
                                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                                {t('flow.expectedAmount')}
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={yappyEditForm.amount}
                                onChange={(e) =>
                                  setYappyEditForm((prev) => ({
                                    ...prev,
                                    amount: e.target.value,
                                  }))
                                }
                                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                                {t('flow.nextExpectedDate')}
                              </label>
                              <input
                                type="date"
                                value={yappyEditForm.nextDateStr}
                                onChange={(e) =>
                                  setYappyEditForm((prev) => ({
                                    ...prev,
                                    nextDateStr: e.target.value,
                                  }))
                                }
                                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card"
                              />
                            </div>

                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => saveYappyEdit(item)}
                                className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold"
                              >
                                {t('common.save')}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingYappyKey(null)}
                                className="px-3 py-2 rounded-lg bg-muted text-xs font-bold text-muted-foreground"
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-foreground truncate">
                                  {item.label}
                                </p>
                                <span
                                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                    item.confirmed
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : 'bg-amber-100 text-amber-700'
                                  }`}
                                >
                                  {item.confirmed ? t('flow.confirmed') : t('flow.detected')}
                                </span>
                                {item.userAdjusted && (
                                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                    {t('flow.adjusted')}
                                  </span>
                                )}
                              </div>

                              <p className="text-xs text-muted-foreground mt-1">
                                {t('flow.nextExpected', { date: item.nextDateStr, amount: money(item.amount) })}
                              </p>

                              <p
                                className={`text-[11px] mt-1 ${
                                  includedInForecast
                                    ? 'text-emerald-700'
                                    : 'text-muted-foreground'
                                }`}
                              >
                                {includedInForecast
                                  ? t('flow.includedInProjection', { horizon: horizonPhrase })
                                  : t('flow.outsideForecast', { horizon: horizonPhrase })}
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-2 shrink-0">
                              {!item.confirmed && (
                                <button
                                  type="button"
                                  onClick={() => confirmYappy(item)}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                                >
                                  {t('flow.confirm')}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => startEditingYappy(item)}
                                className="px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs font-bold"
                              >
                                {t('common.edit')}
                              </button>
                              <button
                                type="button"
                                onClick={() => ignoreYappy(item)}
                                className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-xs font-bold"
                              >
                                {t('flow.ignoreRecurrence')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {ignoredYappyCount > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                      {t('flow.ignoredRecurrences')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(yappyOverrides)
                        .filter(([, value]) => value?.ignored)
                        .map(([key, value]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => restoreIgnoredYappy(key)}
                            className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground"
                          >
                            {t('flow.restore', { name: value?.label || key.replace('provider:', '') })}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
              <SummaryStat
                label={t('flow.knownCommitmentsShort', { horizon: horizonShort })}
                value={money(proj.totalKnownCommitments)}
                sub={t('flow.knownCommitmentsSub', { bills: money(proj.totalBills), cards: money(proj.totalCards), yappy: money(proj.totalRecurringYappy) })}
                tone="neutral"
              />

              <SummaryStat
                label={t('flow.expectedLifestyleSpend', { horizon: horizonShort })}
                value={money(proj.totalExpectedLifestyleSpending)}
                sub={t('flow.expectedLifestyleSub', { cash: money(proj.totalExpectedCashSpending), card: money(proj.expectedCardAccrual) })}
                tone="neutral"
              />

              <SummaryStat
                label={t('flow.projectedLowPoint')}
                value={money(proj.lowest)}
                sub={
                  proj.lowestDate
                    ? t('flow.onDate', { date: proj.lowestDate })
                    : t('flow.noDeclineInRange')
                }
                tone={proj.lowest < 0 ? 'danger' : 'positive'}
              />

              <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                  {t('flow.whatIfCashSpend')}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold text-muted-foreground">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={whatIfSpend}
                    onChange={(e) => setWhatIfSpend(e.target.value)}
                    placeholder="0.00"
                    className="min-w-0 flex-1 text-xl font-bold text-foreground outline-none bg-transparent"
                  />
                  {scenarioSpend > 0 && (
                    <button
                      type="button"
                      onClick={() => setWhatIfSpend('')}
                      className="px-3 py-1.5 rounded-lg bg-muted text-xs font-bold text-muted-foreground hover:text-foreground"
                    >
                      {t('flow.clear')}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {t('flow.whatIfNote')}
                </p>
              </div>
            </div>

            {proj.shortfall ? (
              <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="font-bold text-red-800">
                  {t('flow.shortfallOn', { date: proj.shortfall.date })}
                </p>
                <p className="text-sm text-red-700 mt-1">
                  {t('flow.shortfallBody', { amount: money(proj.shortfall.balance), label: proj.shortfall.label })}
                </p>
              </div>
            ) : (
              <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <p className="text-sm text-emerald-800 font-medium">
                  {t('flow.staysAbove', { horizon: isCustomToday ? t('flow.throughToday') : t('flow.throughNextDays', { days: windowDays }), amount: money(proj.lowest) })}
                </p>
              </div>
            )}

            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden mb-8">
              <div className="px-5 py-3 border-b border-border">
                <p className="font-bold text-foreground">{t('flow.timeline')}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t('flow.timelineNote')}
                </p>
              </div>

              {proj.rows.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm italic">
                  {isCustomToday
                    ? t('flow.noEventsToday')
                    : t('flow.noEventsDays', { days: windowDays })}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  <div className="flex items-center justify-between px-5 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider bg-background/50">
                    <span>{t('flow.startingBalance')}</span>
                    <span>{money(cash)}</span>
                  </div>

                  {proj.rows.map((row, index) => (
                    <div
                      key={`${row.dateStr}-${row.type}-${index}`}
                      className={`flex items-center justify-between gap-4 px-5 py-3 ${
                        row.type === 'expected-cash'
                          ? 'bg-background/30'
                          : ''
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`text-xs font-mono w-20 shrink-0 ${
                            row.overdue
                              ? 'text-red-500 font-bold'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {row.overdue ? t('flow.overdueRow') : row.dateStr}
                        </span>

                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {row.label}{row.isRecurringYappy ? ` ${t('flow.recurringYappySuffix')}` : ''}
                          </p>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {eventTypeLabel(row.type)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <span
                          className={`text-sm font-semibold ${
                            row.amount >= 0
                              ? 'text-emerald-600'
                              : 'text-foreground'
                          }`}
                        >
                          {row.amount >= 0 ? '+' : ''}
                          {money(row.amount)}
                        </span>
                        <span
                          className={`text-sm font-bold w-24 text-right ${
                            row.running < 0
                              ? 'text-red-600'
                              : 'text-foreground'
                          }`}
                        >
                          {money(row.running)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <UpcomingPaymentsCalendar extraEvents={cardCalendarEvents} />
          </>
        )}
      </div>
    </div>
  );
};

const BreakdownItem = ({ label, value, tone = 'neutral' }) => {
  const toneClass =
    tone === 'positive' ? 'text-emerald-600' : 'text-foreground';

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`font-bold mt-0.5 ${toneClass}`}>{value}</p>
    </div>
  );
};

const SummaryStat = ({ label, value, sub, tone }) => {
  const toneClass =
    {
      positive: 'text-emerald-600',
      danger: 'text-red-600',
      neutral: 'text-foreground',
    }[tone] || 'text-foreground';

  return (
    <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={`text-xl font-bold ${toneClass}`}>{value}</p>
      {sub && (
        <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
      )}
    </div>
  );
};

export default CashFlow;

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from 'date-fns';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import UpcomingPaymentsCalendar from '../../components/UpcomingPaymentsCalendar';
import FlowLiteSetup from './FlowLiteSetup';
import ExtraIncomePanel from './ExtraIncomePanel';
import BalanceScanner from '../../components/BalanceScanner';
import Icon from '../../components/AppIcon';
import useScheduledPayments from '../../hooks/useScheduledPayments';
import useTransactions from '../../hooks/useTransactions';
import useCreditCards from '../../hooks/useCreditCards';
import { nextDueDate } from '../../lib/cardGuard';

const WINDOW_OPTIONS = [7, 14, 30];
const HISTORY_WEEKS = 8;
const HISTORY_DAYS = HISTORY_WEEKS * 7;

const LS_CASH = 'cashflow_available_cash';
const LS_INCOME_AMT = 'cashflow_income_amount';
const LS_INCOME_DAY = 'cashflow_income_day';

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

  // Balance-screenshot scanner for the full Flow available-cash control. The
  // scanned total is applied only when the user explicitly confirms; it reuses
  // the existing setCash (cashflow_available_cash) — never auto-overwritten.
  const [showBalanceScanner, setShowBalanceScanner] = useState(false);

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
  const [availableCash, setAvailableCash] = useState('');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeDay, setIncomeDay] = useState('');
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
    const cashStored = localStorage.getItem(LS_CASH);
    if (cashStored !== null) setAvailableCash(cashStored);

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

  const setCash = (value) => {
    setAvailableCash(value);
    localStorage.setItem(LS_CASH, value);
  };

  const setIncAmt = (value) => {
    setIncomeAmount(value);
    localStorage.setItem(LS_INCOME_AMT, value);
  };

  const setIncDay = (value) => {
    setIncomeDay(value);
    localStorage.setItem(LS_INCOME_DAY, value);
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
  const selectPreset = (days) => {
    setLookaheadMode('preset');
    writeLookaheadMode('preset');
    setWindowDays(days);
  };

  const selectCustomMode = () => {
    setLookaheadMode('custom');
    writeLookaheadMode('custom');
    // Restore the last valid (non-past) custom date if we have one.
    const diff = daysFromTodayTo(customDate);
    if (diff !== null) setWindowDays(diff);
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
    }
  };

  const customDateValid = daysFromTodayTo(customDate) !== null;
  const isLongRange = windowDays > LONG_RANGE_DAYS;
  // Custom = today is a valid 0-day window internally, but should read "Today".
  const isCustomToday = lookaheadMode === 'custom' && windowDays === 0;
  const horizonShort = isCustomToday ? 'today' : `${windowDays}d`;

  // --- Extra-income CRUD (persisted) ---
  const persistExtraIncome = (next) => {
    setExtraIncome(next);
    writeExtraIncome(next);
  };

  const addExtraIncome = (item) =>
    persistExtraIncome([...extraIncome, { ...item, id: newExtraIncomeId() }]);

  const updateExtraIncome = (id, patch) =>
    persistExtraIncome(
      extraIncome.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );

  const deleteExtraIncome = (id) =>
    persistExtraIncome(extraIncome.filter((e) => e.id !== id));

  const cash = parseFloat(availableCash) || 0;
  const incAmt = parseFloat(incomeAmount) || 0;
  const incDay = parseInt(incomeDay, 10) || 0;
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
        label: `${item.label} (recurring Yappy)`,
        amount: -Math.abs(item.amount),
        type: 'recurring-yappy',
      });
    });

    // Future recurring income.
    // Strictly future (> today) so current cash does not double-count income
    // that may already have posted today.
    if (incAmt > 0 && incDay >= 1 && incDay <= 31) {
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PrimaryNavBar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28 md:pb-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Cash Flow</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            See what your cash is likely to look like after income, known
            commitments, and normal spending behavior.
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
            onSeeFullFlow={() => setFlowLiteDismissed(true)}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
              Available cash now
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
              onClick={() => setShowBalanceScanner((s) => !s)}
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700"
            >
              <Icon name="Camera" size={14} />
              Scan balances
            </button>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
              Recurring income
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-muted-foreground">
                $
              </span>
              <input
                type="number"
                value={incomeAmount}
                onChange={(e) => setIncAmt(e.target.value)}
                placeholder="0"
                className="w-24 text-xl font-bold text-emerald-600 outline-none bg-transparent"
              />
              <span className="text-sm text-muted-foreground">on day</span>
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
              Auto-detected from history and editable.
            </p>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Expected everyday spending
              </label>
              <button
                type="button"
                onClick={resetDailySpend}
                className="text-[10px] font-bold text-blue-600 hover:text-blue-700"
              >
                Use history
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
              <span className="text-sm text-muted-foreground">/ day</span>
            </div>

            <p className="text-[11px] text-muted-foreground mt-1">
              Typical variable spending across cash, debit, and credit cards.
            </p>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border shadow-sm flex flex-col justify-between">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
              Look ahead
            </label>
            <div className="flex gap-2 flex-wrap">
              {WINDOW_OPTIONS.map((days) => {
                const active = lookaheadMode === 'preset' && windowDays === days;
                return (
                  <button
                    key={days}
                    onClick={() => selectPreset(days)}
                    className={`flex-1 min-w-[64px] py-2 min-h-[40px] rounded-lg text-sm font-bold transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {days} days
                  </button>
                );
              })}
              <button
                onClick={selectCustomMode}
                className={`flex-1 min-w-[64px] py-2 min-h-[40px] rounded-lg text-sm font-bold transition-colors ${
                  lookaheadMode === 'custom'
                    ? 'bg-blue-600 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted'
                }`}
              >
                Custom
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
                    Pick a date that is today or later to use it as your forecast end.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {isLongRange && (
          <p className="text-[11px] text-muted-foreground -mt-2 mb-6">
            Longer-range projections are inherently less certain: expected everyday
            spending is estimated from your recent history, not guaranteed.
          </p>
        )}

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
                setShowBalanceScanner(false);
              }}
              onClose={() => setShowBalanceScanner(false)}
            />
          </div>
        )}

        {loading ? (
          <div className="bg-card p-12 rounded-xl border border-border text-center text-muted-foreground">
            Loading cash flow...
          </div>
        ) : (
          <>
            <div className="bg-card rounded-2xl border border-border shadow-sm p-5 md:p-6 mb-6">
              <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Projected available cash
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
                      ? 'Estimated cash position as of today.'
                      : `Estimated cash position ${windowDays} days from now.`}
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-5 gap-y-3 text-sm">
                  <BreakdownItem label="Cash now" value={money(cash)} />
                  <BreakdownItem
                    label="Income"
                    value={`+${money(proj.totalIncome)}`}
                    tone="positive"
                  />
                  {proj.totalExtraIncome > 0 && (
                    <BreakdownItem
                      label="Extra income"
                      value={`+${money(proj.totalExtraIncome)}`}
                      tone="positive"
                    />
                  )}
                  <BreakdownItem
                    label="Known"
                    value={`-${money(proj.totalKnownCommitments)}`}
                  />
                  <BreakdownItem
                    label="Expected cash"
                    value={`-${money(proj.totalExpectedCashSpending)}`}
                  />
                  <BreakdownItem
                    label="What-if"
                    value={`-${money(proj.totalScenarioSpend)}`}
                  />
                </div>
              </div>

              {!hasSpendEstimate && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  No everyday-spending estimate is active. This projection
                  currently reflects known commitments and income only.
                </div>
              )}
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-blue-900">
                    Spending behavior model
                  </p>
                  <p className="text-xs text-blue-800 mt-1">
                    Typical week: {money(spendingModel.weeklyMedian)} based on
                    the median of up to {HISTORY_WEEKS} recent weeks.
                    Historically, about {percent(spendingModel.cardShare)} of
                    qualifying everyday spending used credit cards and{' '}
                    {percent(spendingModel.cashShare)} used cash/debit.
                  </p>
                </div>
                <div className="text-xs text-blue-900 md:text-right shrink-0">
                  <p>
                    Cash impact: <strong>{money(dailyCashSpend)}/day</strong>
                  </p>
                  <p>
                    Card accrual: <strong>{money(dailyCardSpend)}/day</strong>
                  </p>
                </div>
              </div>

              <p className="text-[11px] text-blue-700 mt-2">
                New card purchases are tracked as expected card accrual, not
                as immediate cash outflow. Existing statement balances due
                inside the forecast are already counted as known commitments.
              </p>
            </div>

            {(recurringYappyAdjusted.length > 0 || ignoredYappyCount > 0) && (
              <div className="bg-card border border-border rounded-xl p-4 mb-6">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      Recurring Yappy commitments
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      MoFlow infers monthly fixed expenses from Yappy history.
                      Confirm, edit, or ignore each one. Ignoring a recurrence
                      never deletes historical transactions.
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {recurringYappyAdjusted.length} active
                    {ignoredYappyCount > 0 ? ` · ${ignoredYappyCount} ignored` : ''}
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
                                Name
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
                                Expected amount
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
                                Next expected date
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
                                className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingYappyKey(null)}
                                className="px-3 py-2 rounded-lg bg-muted text-xs font-bold text-muted-foreground"
                              >
                                Cancel
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
                                  {item.confirmed ? 'Confirmed' : 'Detected'}
                                </span>
                                {item.userAdjusted && (
                                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                    Adjusted
                                  </span>
                                )}
                              </div>

                              <p className="text-xs text-muted-foreground mt-1">
                                Next expected {item.nextDateStr} · {money(item.amount)}
                              </p>

                              <p
                                className={`text-[11px] mt-1 ${
                                  includedInForecast
                                    ? 'text-emerald-700'
                                    : 'text-muted-foreground'
                                }`}
                              >
                                {includedInForecast
                                  ? `Included in your ${isCustomToday ? "today's" : `${windowDays}-day`} cash projection.`
                                  : `Outside your current ${isCustomToday ? "today's" : `${windowDays}-day`} forecast.`}
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-2 shrink-0">
                              {!item.confirmed && (
                                <button
                                  type="button"
                                  onClick={() => confirmYappy(item)}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                                >
                                  Confirm
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => startEditingYappy(item)}
                                className="px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs font-bold"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => ignoreYappy(item)}
                                className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-xs font-bold"
                              >
                                Ignore recurrence
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
                      Ignored recurrences
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
                            Restore {value?.label || key.replace('provider:', '')}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
              <SummaryStat
                label={`Known commitments (${horizonShort})`}
                value={money(proj.totalKnownCommitments)}
                sub={`${money(proj.totalBills)} bills + ${money(
                  proj.totalCards
                )} card statements + ${money(
                  proj.totalRecurringYappy
                )} recurring Yappy`}
                tone="neutral"
              />

              <SummaryStat
                label={`Expected lifestyle spend (${horizonShort})`}
                value={money(proj.totalExpectedLifestyleSpending)}
                sub={`${money(
                  proj.totalExpectedCashSpending
                )} cash impact + ${money(
                  proj.expectedCardAccrual
                )} card accrual`}
                tone="neutral"
              />

              <SummaryStat
                label="Projected low point"
                value={money(proj.lowest)}
                sub={
                  proj.lowestDate
                    ? `on ${proj.lowestDate}`
                    : 'no decline in range'
                }
                tone={proj.lowest < 0 ? 'danger' : 'positive'}
              />

              <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                  What-if cash spend
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
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Test an immediate purchase or other cash outflow today.
                </p>
              </div>
            </div>

            {proj.shortfall ? (
              <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="font-bold text-red-800">
                  Projected cash shortfall on {proj.shortfall.date}
                </p>
                <p className="text-sm text-red-700 mt-1">
                  The projection reaches{' '}
                  <span className="font-bold">
                    {money(proj.shortfall.balance)}
                  </span>{' '}
                  at{' '}
                  <span className="font-bold">{proj.shortfall.label}</span>.
                  Review the timing of income, commitments, expected cash
                  spending, or the what-if scenario.
                </p>
              </div>
            ) : (
              <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <p className="text-sm text-emerald-800 font-medium">
                  Projection stays above $0{' '}
                  {isCustomToday ? 'through today' : `through the next ${windowDays} days`}{' '}
                  based on the assumptions shown above. The lowest projected
                  cash balance is{' '}
                  <span className="font-bold">{money(proj.lowest)}</span>.
                </p>
              </div>
            )}

            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden mb-8">
              <div className="px-5 py-3 border-b border-border">
                <p className="font-bold text-foreground">Cash flow timeline</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  This timeline shows actual cash timing, including detected
                  recurring Yappy fixed expenses. Expected credit-card purchases
                  are not deducted until they become a future statement obligation.
                </p>
              </div>

              {proj.rows.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm italic">
                  {isCustomToday
                    ? 'No projected cash-flow events today.'
                    : `No projected cash-flow events in the next ${windowDays} days.`}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  <div className="flex items-center justify-between px-5 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider bg-background/50">
                    <span>Starting balance</span>
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
                          {row.overdue ? 'overdue' : row.dateStr}
                        </span>

                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {row.label}
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

const eventTypeLabel = (type) => {
  const labels = {
    income: 'Income',
    'extra-income': 'Extra income',
    bill: 'Known bill',
    card: 'Card statement',
    'recurring-yappy': 'Recurring Yappy commitment',
    'expected-cash': 'Expected cash spending',
    scenario: 'What-if scenario',
  };

  return labels[type] || 'Cash flow';
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

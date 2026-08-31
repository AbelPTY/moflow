// Pure helpers for account identity across MoFlow (Account Foundation V1.1).
//
// Design rules:
//   * An account's identity is its ROW (id) / its exact NAME -- never its type.
//   * Multiple accounts of the SAME type must stay distinct.
//   * Normalization ONLY lowercases + trims + collapses whitespace. It must NOT
//     fold different names (e.g. "BG Savings" vs "UNFCU Savings") together.

export const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'cash', label: 'Cash' },
  { value: 'investment', label: 'Investment' },
  { value: 'other', label: 'Other' },
];

// Cash accounts that may feed Flow's available-cash total.
export const ELIGIBLE_CASH_TYPES = ['checking', 'savings', 'cash'];

export const isEligibleCashType = (type) =>
  ELIGIBLE_CASH_TYPES.includes(String(type || '').toLowerCase());

export const accountTypeLabel = (value) =>
  ACCOUNT_TYPES.find((t) => t.value === value)?.label || 'Other';

// Normalize a name for de-duplication / matching ONLY. Case- and
// whitespace-insensitive; nothing else. Distinct names stay distinct.
export const normalizeAccountName = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

// Build the account options shown in selectors:
//   1. the user's first-class accounts (durable rows), then
//   2. legacy transaction-derived account names not already represented.
// Deduped by normalized name (first-class wins). Preserves backward
// compatibility: existing transaction account names still appear.
//
// accounts:     [{ id, account_name, account_type, is_active }]
// legacyNames:  ['UNFCU', 'Banco General', ...] (strings from transactions)
// Returns:      [{ name, type, id|null, source: 'account'|'legacy' }]
export const mergeAccountOptions = (accounts = [], legacyNames = []) => {
  const out = [];
  const seen = new Set();

  (accounts || [])
    .filter((a) => a && (a.is_active === undefined || a.is_active) && a.account_name)
    .forEach((a) => {
      const key = normalizeAccountName(a.account_name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({
        name: a.account_name,
        type: a.account_type || 'other',
        id: a.id ?? null,
        source: 'account',
      });
    });

  (legacyNames || [])
    .filter(Boolean)
    .forEach((name) => {
      const key = normalizeAccountName(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ name: String(name), type: null, id: null, source: 'legacy' });
    });

  return out;
};

// Find the first-class account whose NAME matches `name` (normalized, exact —
// never by type). Returns the account or null. Used to preselect a scanned
// balance row against an existing account only on a strong name match; a bare
// "savings"/"checking" never resolves to one of several same-type accounts.
export const matchAccountByName = (name, accounts = []) => {
  const key = normalizeAccountName(name);
  if (!key) return null;
  return (
    (accounts || []).find(
      (a) =>
        a &&
        (a.is_active === undefined || a.is_active) &&
        normalizeAccountName(a.account_name) === key
    ) || null
  );
};

// Did the account NAME change on an edit? (exact, trimmed). Only a name change
// should trigger transaction-rename propagation -- type/institution/currency do not.
export const accountNameChanged = (oldName, newName) =>
  !!String(oldName || '').trim() && String(oldName).trim() !== String(newName || '').trim();

// Does a transaction row belong to `name` (by the exact stored name in either
// field)? Used to target rename propagation precisely (no fuzzy matching).
export const transactionMatchesAccountName = (row, name) =>
  !!row && !!name && (row.account_name === name || row.source_account === name);

// De-duplicate scanned balance rows coming from ONE multi-image session.
// Same account across screenshots (same normalized name) collapses to a SINGLE
// row -- balances are NEVER summed. Distinct names (even same type/institution)
// stay separate. When the same name repeats, keep the most complete record
// (prefer one with a positive balance, else the first seen) and flag the later
// occurrence so the UI can note it.
//
// rows: [{ name, balance, currency, type, is_credit, ... }]
// Returns: [{ ...row, _duplicateOf: index|undefined }] deduped list.
export const dedupeDetectedAccounts = (rows = []) => {
  const byName = new Map(); // normName -> index in result
  const result = [];

  (rows || []).forEach((row) => {
    if (!row) return;
    const key = normalizeAccountName(row.name);
    if (!key) {
      result.push({ ...row });
      return;
    }

    if (!byName.has(key)) {
      byName.set(key, result.length);
      result.push({ ...row });
      return;
    }

    // Same account seen again in another screenshot: keep the more complete one.
    const idx = byName.get(key);
    const existing = result[idx];
    const existingBal = Number(existing.balance) || 0;
    const incomingBal = Number(row.balance) || 0;
    // Prefer a row that actually has a balance; otherwise keep the existing.
    if (existingBal === 0 && incomingBal !== 0) {
      result[idx] = { ...row };
    }
    // Never sum -- the duplicate representation is dropped (not added).
  });

  return result;
};

export default mergeAccountOptions;

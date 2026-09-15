// Targeted balance-scan logic — PURE helpers for BalanceScanner's account-centric
// mode. No React, no network, no persistence side effects: they only decide what
// a targeted scan should do, so write-safety and conflict handling are unit
// testable without a DOM.
//
// Bulk mode is unchanged and does not use these helpers. Targeted mode is opened
// from a specific first-class account ("Scan" on an account row); the user is
// updating exactly ONE known account (targetAccount.id), so these helpers never
// batch-write and never touch Available Cash.

import { matchAccountByName, isEligibleCashType } from './accountOptions';

const CREDIT_TYPES = new Set(['credit_card', 'credit', 'loan', 'debt', 'line_of_credit']);

// A scanned row that represents a credit product (never a cash balance).
export function isCreditScanRow(row) {
  return !!row && (row.is_credit || CREDIT_TYPES.has(row.type));
}

// Candidate detected rows for a targeted scan: everything that is NOT a credit
// product. The target is already a known cash account, so a detected type of
// 'other' is still a valid candidate; only credit rows are excluded (a credit
// balance can never be written as a cash balance). Order is preserved so the
// UI can default to the first candidate.
export function targetedCandidateRows(rows) {
  return (rows || []).filter((r) => r && !isCreditScanRow(r));
}

// Does a detected row's name strongly (exact-normalized, via the existing
// matchAccountByName — no fuzzy matching) resolve to a DIFFERENT existing account
// than the target? Returns conflict details for the confirmation UI, else null.
// This never redirects the write; it only flags that the user must confirm.
export function detectTargetConflict(row, targetAccount, accounts) {
  if (!row || !targetAccount) return null;
  const matched = matchAccountByName(row.name, accounts);
  if (matched && matched.id && matched.id !== targetAccount.id) {
    return {
      detectedName: matched.account_name || row.name || '',
      targetName: targetAccount.account_name || '',
      matchedId: matched.id,
    };
  }
  return null;
}

// Build the single by-id balance write for targeted mode, or null when the
// balance is not a finite number. current_balance = 0 is VALID (a real zero
// balance). The write ALWAYS targets targetAccount.id — never any detected/other
// account — and carries balance_as_of so the account's as-of date is updated.
export function buildTargetedBalanceUpdate(targetAccount, balanceValue, todayStr) {
  if (!targetAccount || !targetAccount.id) return null;
  const n = typeof balanceValue === 'number' ? balanceValue : parseFloat(balanceValue);
  if (!Number.isFinite(n)) return null;
  return {
    id: targetAccount.id,
    current_balance: n,
    balance_as_of: todayStr || null,
  };
}

// Re-export for callers/tests that want the same cash-eligibility notion the
// bulk scanner uses, without importing accountOptions directly.
export { isEligibleCashType };

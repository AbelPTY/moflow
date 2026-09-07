// Receipt & Invoice Intelligence V1 — thin data-access layer (RLS-scoped).
//
// Persists ONLY structured extraction (no raw image/XML bytes). Fetches a bounded
// match-window of transactions for receipt→transaction matching. Supabase is
// imported lazily so pure modules/tests never pull in the client.
//
// NOTE: writes target public.transaction_receipts, which is created by the
// PROPOSED (not-yet-applied) migration 20260906000000_transaction_receipts.sql.
// Until that migration is applied, saveReceipt returns { ok:false, pendingMigration:true }.

import { normalizeDate } from './receiptIntelligence.js';

async function client(c) {
  if (c) return c;
  const { supabase } = await import('./supabase.js');
  return supabase;
}

const pad2 = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Fetch the user's transactions within ±windowDays of the receipt date. Bounded;
// RLS scopes to the owner. Never fetches the whole history.
export async function fetchMatchWindowTransactions(c, { date, windowDays = 2, limit = 100 } = {}) {
  const d = normalizeDate(date);
  if (!d) return [];
  const cl = await client(c);
  const base = new Date(`${d}T00:00:00`);
  const from = new Date(base); from.setDate(from.getDate() - windowDays);
  const to = new Date(base); to.setDate(to.getDate() + windowDays);
  const { data, error } = await cl
    .from('transactions')
    .select('id, date, merchant, description, amount, category, budget_bucket, classification_source, user_categorized, needs_review')
    .gte('date', iso(from))
    .lte('date', iso(to))
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Build the DB row from a normalized receipt (structured only; no raw bytes).
function rowFromReceipt(receipt, transactionId) {
  return {
    transaction_id: transactionId || null,
    document_type: receipt.documentType || 'receipt',
    source_type: receipt.sourceType || 'image',
    merchant_name: receipt.merchantDisplayName || null,
    legal_entity_name: receipt.legalEntityName || null,
    tax_id: receipt.taxId || null,
    transaction_date: receipt.transactionDate || null,
    subtotal: receipt.subtotal ?? null,
    tax: receipt.tax ?? null,
    total: receipt.total ?? null,
    currency: receipt.currency || 'USD',
    payment_method: receipt.paymentMethod || null,
    fingerprint: receipt.fingerprint || null,
    extracted_data: receipt,
  };
}

// Persist a receipt (optionally linked to a transaction). Never overwrites the
// transaction's own classification. Returns { ok, id? } or a safe failure.
// Gracefully reports pendingMigration if the table does not exist yet.
export async function saveReceipt(c, { receipt, transactionId } = {}) {
  if (!receipt) return { ok: false, reason: 'no_receipt' };
  const cl = await client(c);
  const { data, error } = await cl
    .from('transaction_receipts')
    .insert(rowFromReceipt(receipt, transactionId))
    .select('id')
    .single();
  if (error) {
    const code = String(error.code || '');
    // 42P01 = undefined_table -> migration not applied yet (controlled state,
    // NOT a generic failure). Only this specific signal maps to pending storage.
    if (code === '42P01' || /relation .* does not exist/i.test(error.message || '')) {
      return { ok: false, pendingMigration: true };
    }
    // 23505 = unique_violation on (user_id, fingerprint) -> duplicate receipt.
    if (code === '23505') return { ok: false, duplicate: true };
    // Everything else (permission/RLS/network/other DB) is surfaced as-is so a
    // real error is never masked behind the pending-storage message.
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true, id: data?.id };
}

// Duplicate check by fingerprint (HEAD count). Safe if the table is missing.
export async function receiptExistsByFingerprint(c, fingerprint) {
  if (!fingerprint) return false;
  try {
    const cl = await client(c);
    const { count, error } = await cl
      .from('transaction_receipts')
      .select('id', { count: 'exact', head: true })
      .eq('fingerprint', fingerprint);
    if (error) return false;
    return (count || 0) > 0;
  } catch {
    return false;
  }
}

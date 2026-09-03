// Transaction Intelligence V1 — product wiring / data-access layer.
//
// Bridges the pure engine (transactionIntelligence.js) to the live database
// (public.transactions + public.user_merchant_rules) with owner-only RLS. Pure
// decision logic (protection, eligibility, insert metadata, backfill preview) is
// separated from the thin DB calls so it can be unit-tested with no network.
//
// It NEVER touches raw/identity fields (date, amount, bank_reference,
// account_name/source_account, raw merchant/description) — only the
// classification metadata columns. Duplicate identity is unaffected.

// NOTE: the Supabase client and the user-rule loader are imported LAZILY inside
// the async DB functions (mirroring analytics.js), so this module's PURE
// functions load with no environment/DB — keeping them unit-testable.
import {
  classifyTransaction,
  buildAutoWriteMetadata,
  buildUserEditMetadata,
  learnedRuleFromCorrection,
  normalizeMerchant,
  UNCATEGORIZED,
  UNSORTED,
} from './transactionIntelligence.js';

// Resolve the default Supabase client on demand (never at module load).
async function defaultClientAsync() {
  const { supabase } = await import('./supabase.js');
  return supabase;
}

// ---------------------------------------------------------------------------
// Pure predicates (unit-tested)
// ---------------------------------------------------------------------------

// A category/bucket is "unresolved" (default/blank/Uncategorized/Unsorted).
export function isUnresolved(row = {}) {
  const c = String(row.category ?? '').trim().toLowerCase();
  const b = String(row.budget_bucket ?? '').trim().toLowerCase();
  return c === '' || c === 'uncategorized' || b === '' || b === 'unsorted';
}

// A row whose classification must never be silently overwritten (mirrors the
// engine's protection rule, evaluated against persisted columns).
export function isProtectedRow(row = {}) {
  if (row.user_categorized === true) return true;
  if (row.classification_source === 'user') return true;
  if (
    (row.classification_source === 'legacy' || row.classification_source === 'manual') &&
    row.needs_review === false &&
    !isUnresolved(row)
  ) return true;
  return false;
}

// A row eligible to receive an automatic/bulk classification: not protected AND
// (flagged for review OR still unresolved).
export function isEligibleForApply(row = {}) {
  return !isProtectedRow(row) && (row.needs_review === true || isUnresolved(row));
}

// ---------------------------------------------------------------------------
// Insert-time classification (pure) — returns ONLY the metadata columns to merge
// into an insert row. Caller keeps all raw/identity fields as-is.
// ---------------------------------------------------------------------------
export function classifyForInsert(row = {}, learnedRules = []) {
  const cls = classifyTransaction({
    description: row.description || row.description_raw || '',
    merchant: row.merchant || '',
    amount: Number(row.amount) || 0,
    account_name: row.account_name,
    source_account: row.source_account,
    learned_rules: learnedRules,
  });
  return { classification: cls, metadata: buildAutoWriteMetadata(cls) };
}

// Backfill preview (pure): classify each candidate unresolved row and bucket the
// result. Protected rows are excluded up front. Returns counts + per-id plan.
export function previewBackfill(rows = [], learnedRules = []) {
  const plan = { auto: [], suggested: [], review: [], protected: 0, alreadyResolved: 0 };
  for (const row of rows) {
    if (isProtectedRow(row)) { plan.protected += 1; continue; }
    if (!isUnresolved(row)) { plan.alreadyResolved += 1; continue; }
    const { classification, metadata } = classifyForInsert(row, learnedRules);
    const entry = { id: row.id, metadata };
    if (classification.state === 'auto') plan.auto.push(entry);
    else if (classification.state === 'suggested') plan.suggested.push(entry);
    else plan.review.push(entry);
  }
  return {
    counts: {
      auto: plan.auto.length,
      suggested: plan.suggested.length,
      review: plan.review.length,
      protected: plan.protected,
      alreadyResolved: plan.alreadyResolved,
    },
    plan,
  };
}

// ---------------------------------------------------------------------------
// DB access (thin; RLS scopes every query/write to the authenticated owner)
// ---------------------------------------------------------------------------

// Load the user's active rules (manual + learned + migrated + fallback) once per
// batch. Returns engine-shaped rules; on failure returns [] (static-only).
export async function loadUserRules(client) {
  const c = client || (await defaultClientAsync());
  const { fetchActiveUserRules } = await import('./engine/userRules.js');
  return fetchActiveUserRules(c);
}

// Count of rows needing review (badge). Uses a HEAD count — never downloads rows.
export async function fetchReviewCount(client) {
  try {
    const c = client || (await defaultClientAsync());
    const { count, error } = await c
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('needs_review', true);
    if (error) throw error;
    return count || 0;
  } catch {
    return 0;
  }
}

// Fetch rows flagged for review, newest first (backed by idx_transactions_needs_review).
export async function fetchNeedsReview(client, limit = 100) {
  const c = client || (await defaultClientAsync());
  const { data, error } = await c
    .from('transactions')
    .select('id, date, merchant, description, amount, account_name, category, budget_bucket, classification_source, classification_confidence, transaction_nature, normalized_merchant, user_categorized, needs_review')
    .eq('needs_review', true)
    .order('date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Fetch historical unresolved candidates for "Improve categorization". These are
// rows with a default/blank category or bucket (historical rows keep
// needs_review=false, so we identify them by their unresolved category/bucket).
export async function fetchImproveCandidates(client, limit = 500) {
  const c = client || (await defaultClientAsync());
  const { data, error } = await c
    .from('transactions')
    .select('id, merchant, description, amount, category, budget_bucket, classification_source, user_categorized, needs_review')
    .or('category.is.null,category.eq.Uncategorized,budget_bucket.is.null,budget_bucket.eq.Unsorted')
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Apply a previewBackfill plan (auto + suggested + review). Each entry carries
// the exact metadata to write (from buildAutoWriteMetadata). Protected rows were
// already excluded when the plan was built. Returns the count written.
export async function applyBackfill(client, plan) {
  const c = client || (await defaultClientAsync());
  const entries = [...(plan.auto || []), ...(plan.suggested || []), ...(plan.review || [])];
  let count = 0;
  for (const e of entries) {
    const { error } = await c.from('transactions').update(e.metadata).eq('id', e.id);
    if (!error) count += 1;
  }
  return count;
}

// Persist an explicit user edit (Accept / Change): marks the row user-owned and
// resolved. Only classification columns are written.
export async function saveUserClassification(client, id, { category, bucket, nature } = {}) {
  const c = client || (await defaultClientAsync());
  const updates = buildUserEditMetadata({ category, bucket, nature });
  const { error } = await c.from('transactions').update(updates).eq('id', id);
  if (error) throw error;
  return updates;
}

// "Remember for future": upsert a learned merchant rule. Because the unique key
// is an EXPRESSION index (lower(btrim(pattern))), we select-then-insert/update
// rather than relying on onConflict, so a repeated correction UPDATES in place.
export async function rememberLearnedRule(client, { normalizedMerchant, category, bucket, is_transfer = null } = {}) {
  const c = client || (await defaultClientAsync());
  const payload = learnedRuleFromCorrection({ normalizedMerchant, category, bucket, is_transfer });
  if (!payload) return { ok: false, reason: 'incomplete' };
  const pat = payload.pattern.trim().toLowerCase();
  const { data: existing } = await c
    .from('user_merchant_rules')
    .select('id, pattern, match_type, match_field')
    .eq('match_type', 'exact')
    .eq('match_field', 'merchant');
  const match = (existing || []).find(
    (r) => String(r.pattern || '').trim().toLowerCase() === pat
  );
  if (match) {
    const { error } = await c
      .from('user_merchant_rules')
      .update({ category: payload.category, budget_bucket: payload.budget_bucket, is_transfer: payload.is_transfer, active: true, updated_at: new Date().toISOString() })
      .eq('id', match.id);
    if (error) throw error;
    return { ok: true, action: 'updated', id: match.id };
  }
  const { data, error } = await c.from('user_merchant_rules').insert(payload).select('id').single();
  if (error) throw error;
  return { ok: true, action: 'inserted', id: data?.id };
}

// "Apply to similar transactions": update the eligible, unprotected rows that
// share the same deterministic normalized merchant. Candidates are matched
// client-side (historical rows may have NULL normalized_merchant), so nothing
// protected is ever touched. Returns { count, ids }.
export async function applyToSimilar(client, { normalizedMerchant, category, bucket, nature } = {}, { limit = 500 } = {}) {
  const c = client || (await defaultClientAsync());
  const target = String(normalizedMerchant || '').trim().toLowerCase();
  if (!target || !category || !bucket) return { count: 0, ids: [] };
  // Fetch a bounded set of the user's unresolved/needs-review candidate rows.
  const { data, error } = await c
    .from('transactions')
    .select('id, merchant, description, category, budget_bucket, classification_source, user_categorized, needs_review')
    .or('needs_review.eq.true,category.is.null,category.eq.Uncategorized,budget_bucket.is.null,budget_bucket.eq.Unsorted')
    .limit(limit);
  if (error) throw error;
  const eligible = (data || []).filter(
    (r) => isEligibleForApply(r) && normalizeMerchant(r.merchant || r.description).toLowerCase() === target
  );
  const updates = { ...buildUserEditMetadata({ category, bucket, nature }), normalized_merchant: String(normalizedMerchant).trim() };
  const ids = [];
  for (const r of eligible) {
    const { error: uErr } = await c.from('transactions').update(updates).eq('id', r.id);
    if (!uErr) ids.push(r.id);
  }
  return { count: ids.length, ids };
}

export { UNCATEGORIZED, UNSORTED };

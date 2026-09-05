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
  buildAiClassifyPayload,
  sanitizeAiBatch,
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
// AI fallback (V1.2) — LAST resort for rows the deterministic engine leaves in
// 'review'. Pure selection + a thin, fail-safe network call. AI NEVER overrides
// a protected / user / rule / deterministic / merchant classification: only rows
// the engine itself returns as state='review' (and are not protected) are ever
// eligible, and an AI result is always source='ai', capped ≤0.80, needs_review.
// ---------------------------------------------------------------------------

// Pure: from raw rows, run the deterministic engine and return ONLY the rows it
// leaves unresolved (state='review') and unprotected — the AI-eligible tail.
// Each candidate carries just what the payload builder needs.
export function selectAiReviewCandidates(rows = [], learnedRules = []) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (isProtectedRow(row)) continue;
    const { classification } = classifyForInsert(row, learnedRules);
    if (classification.state !== 'review') continue;
    out.push({
      id: row.id,
      normalizedMerchant: classification.normalizedMerchant
        || normalizeMerchant(row.merchant || row.description || ''),
      description: row.description || row.description_raw || row.merchant || '',
      amount: Number(row.amount) || 0,
    });
  }
  return out;
}

// Pure: build the review-row metadata for an AI classification (source='ai',
// confidence ≤0.80, needs_review=true, user_categorized=false) — reuses the
// engine's canonical writer so it can never drift from the AUTO/SUGGESTED policy.
export function aiMetadataFor(classification, normalizedMerchant) {
  return buildAutoWriteMetadata({ ...classification, normalizedMerchant });
}

// Network (thin, injectable): send the AI-eligible candidates to the shared
// Gemini endpoint (scanReceipt mode:'classify') and return a per-id map of the
// sanitized AI classification (or null). ALWAYS resolves — any failure (offline,
// non-2xx, bad JSON, rejected taxonomy) yields nulls so the caller falls back to
// review. Requests are deduped + capped inside buildAiClassifyPayload.
export async function aiClassifyReviewRows(candidates = [], { fetchImpl, endpoint = '/api/scanReceipt' } = {}) {
  const byId = {};
  for (const r of Array.isArray(candidates) ? candidates : []) {
    if (r && r.id != null) byId[String(r.id)] = null;
  }
  const { payload, dedupe, keyForId } = buildAiClassifyPayload(candidates);
  if (payload.transactions.length === 0) return { byId, aiCount: 0, ok: true };

  try {
    const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!doFetch) return { byId, aiCount: 0, ok: false };
    let headers = { 'Content-Type': 'application/json' };
    if (!fetchImpl) {
      // Reuse the app's authenticated fetch header (lazy so pure tests don't
      // pull in the Supabase client).
      try {
        const { authHeader } = await import('./apiClient.js');
        headers = { ...headers, ...(await authHeader()) };
      } catch {
        // No auth context -> let the server reject; treated as a safe failure.
      }
    }
    const res = await doFetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!res || !res.ok) return { byId, aiCount: 0, ok: false };
    const json = await res.json();
    const results = sanitizeAiBatch(json, new Set(payload.transactions.map((t) => t.id)));
    let aiCount = 0;
    for (const { id, classification } of results) {
      const ids = dedupe[keyForId[id]] || [id];
      for (const rid of ids) {
        if (byId[rid] === null) { byId[rid] = classification; aiCount += 1; }
      }
    }
    return { byId, aiCount, ok: true };
  } catch {
    return { byId, aiCount: 0, ok: false };
  }
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

// Scope & Safety V1: the classification columns a scope preview/apply needs.
const SCOPE_ROW_COLUMNS = 'id, merchant, description, description_raw, amount, category, budget_bucket, classification_source, user_categorized, needs_review';

// Fetch canonical rows by id (chunked). Used for SELECTED / filtered-view scopes
// so protection + unresolved decisions run on authoritative DB fields, not the
// display shape. RLS scopes every read to the owner.
export async function fetchRowsByIds(client, ids = []) {
  const c = client || (await defaultClientAsync());
  const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
  const out = [];
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const { data, error } = await c.from('transactions').select(SCOPE_ROW_COLUMNS).in('id', chunk);
    if (error) throw error;
    if (data) out.push(...data);
  }
  return out;
}

// Fetch unresolved candidates (category/bucket default/blank) for the default
// "all unresolved" scope. Bounded; RLS-scoped.
export async function fetchUnresolvedRows(client, limit = 1000) {
  const c = client || (await defaultClientAsync());
  const { data, error } = await c
    .from('transactions')
    .select(SCOPE_ROW_COLUMNS)
    .or('category.is.null,category.eq.Uncategorized,budget_bucket.is.null,budget_bucket.eq.Unsorted')
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Fetch rows eligible for the ADVANCED "all eligible" scope: everything that is
// NOT a protected user classification (may include automatic classifications for
// reprocessing). Never returns user_categorized rows. Bounded; RLS-scoped.
export async function fetchEligibleForReprocess(client, limit = 1000) {
  const c = client || (await defaultClientAsync());
  const { data, error } = await c
    .from('transactions')
    .select(SCOPE_ROW_COLUMNS)
    .not('user_categorized', 'is', true)
    .or('classification_source.is.null,classification_source.neq.user')
    .limit(limit);
  if (error) throw error;
  // Final protection filter client-side (covers resolved legacy-manual rows).
  return (data || []).filter((r) => !isProtectedRow(r));
}

// Calibration V1: fetch a BOUNDED, read-only sample for quality analysis. Never
// fetches the full history; RLS scopes every read to the owner. scope:
//   'latest'     -> newest `size` rows
//   'unresolved' -> unresolved rows (bounded)
//   'selected'   -> the given ids (bounded)
export async function fetchCalibrationSample(client, { size = 250, scope = 'latest', selectedIds } = {}) {
  const c = client || (await defaultClientAsync());
  const cap = Math.max(1, Math.min(Number(size) || 250, 500));
  if (scope === 'selected') {
    const rows = await fetchRowsByIds(c, Array.from(selectedIds || []));
    return rows.slice(0, cap);
  }
  if (scope === 'unresolved') {
    return fetchUnresolvedRows(c, cap);
  }
  const { data, error } = await c
    .from('transactions')
    .select(`${SCOPE_ROW_COLUMNS}, date`)
    .order('date', { ascending: false })
    .limit(cap);
  if (error) throw error;
  return data || [];
}

// Apply a flat categorization plan ([{ id, metadata }]). Groups rows sharing the
// exact same metadata into one update (fewer requests). Returns rows written.
export async function applyCategorizationPlan(client, entries = []) {
  const c = client || (await defaultClientAsync());
  const groups = new Map(); // metadataJSON -> ids[]
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || e.id == null || !e.metadata) continue;
    const key = JSON.stringify(e.metadata);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e.id);
  }
  let written = 0;
  for (const [key, ids] of groups.entries()) {
    const metadata = JSON.parse(key);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error } = await c.from('transactions').update(metadata).in('id', chunk);
      if (!error) written += chunk.length;
    }
  }
  return written;
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

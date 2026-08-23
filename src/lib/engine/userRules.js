import { supabase as defaultClient } from '../supabase';

// USER-tier merchant rules: data access + adapter to the engine rule shape.
// READ-ONLY in this phase (no insert/update/delete). Ownership isolation is
// enforced by RLS (auth.uid() = user_id); we deliberately do NOT add a
// browser-supplied user_id filter as a substitute for RLS.

const SELECT_COLUMNS =
  'id, pattern, match_type, match_field, category, subcategory, budget_bucket, is_transfer, source, confidence, priority, branches';

// Pure adapter: DB row -> engine rule. Mirrors the static rule's { id, assign }
// shape (plus provenance) so the shared matcher/consumers treat both uniformly.
// Never mutates the input row.
export function userRuleRowToEngineRule(row) {
  return {
    id: row.id,
    source: row.source,
    confidence: row.confidence,
    match_type: row.match_type === 'exact' ? 'exact' : 'contains',
    match_field: row.match_field === 'description' ? 'description' : 'merchant',
    pattern: row.pattern,
    priority: row.priority,
    // Raw ordered conditional branches (only used for source='fallback'); the
    // engine validates/parses them. NULL for ordinary rules -> unchanged behavior.
    branches: row.branches ?? null,
    assign: {
      category: row.category,
      subcategory: row.subcategory ?? null,
      budgetBucket: row.budget_bucket,
      // Preserve NULL: null means "do not override transfer semantics".
      is_transfer: row.is_transfer == null ? null : row.is_transfer,
    },
  };
}

// Loads the authenticated user's ACTIVE rules, ordered by priority ascending
// (lower = higher priority) with a deterministic tie-break (created_at asc,
// then id asc). Returns engine-shaped rules. On ANY failure it logs safely and
// returns [] so classification transparently falls back to static behavior --
// a rule-load failure must never break the dashboard.
export async function fetchActiveUserRules(client = defaultClient) {
  try {
    const { data, error } = await client
      .from('user_merchant_rules')
      .select(SELECT_COLUMNS)
      .eq('active', true)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw error;
    return (data || []).map(userRuleRowToEngineRule);
  } catch (err) {
    // Do not surface raw Supabase error details to the UI.
    console.error('user_merchant_rules load failed; using static rules only:', err?.message || err);
    return [];
  }
}

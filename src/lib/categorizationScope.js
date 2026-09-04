// Activity Categorization Scope & Safety V1 — pure scope/preview/merge logic.
//
// Both "Categorize from Rules" and "Magic Sweep" are gated behind an explicit
// SCOPE choice + a no-write PREVIEW + explicit Apply. This module is the pure,
// unit-tested core: it decides which rows are in scope, previews the outcome
// per mode (rules vs magic/AI), and merges an inferred classification into an
// unresolved row WITHOUT clobbering a valid dimension. No DB, no network, no AI
// here — the caller performs I/O.
//
// SAFETY PRINCIPLE: only UNRESOLVED rows are eligible by default, and a resolved
// PROTECTED row (user-categorized / source='user' / resolved legacy-manual) is
// never touched. Provenance of an automatic result is preserved (never forced to
// 'user' just because the user confirmed the batch).

import {
  isUnresolved,
  isProtectedRow,
  classifyForInsert,
} from './transactionRules.js';
import { UNCATEGORIZED, UNSORTED } from './transactionIntelligence.js';

export const SCOPE = { UNRESOLVED: 'unresolved', SELECTED: 'selected', ALL_ELIGIBLE: 'all_eligible' };
export const FILTER_SCOPE = { FILTERED: 'filtered', ALL: 'all' };
export const MODE = { RULES: 'rules', MAGIC: 'magic' };

// ---------------------------------------------------------------------------
// Unresolved detection (trimmed, case-insensitive; EITHER dimension missing).
// ---------------------------------------------------------------------------
const catMissing = (row) => {
  const c = String(row?.category ?? '').trim().toLowerCase();
  return c === '' || c === 'uncategorized';
};
const bucketMissing = (row) => {
  const b = String(row?.budget_bucket ?? row?.bucket ?? row?.budgetBucket ?? '').trim().toLowerCase();
  return b === '' || b === 'unsorted';
};

// Canonical unresolved test — a transaction is unresolved when its category OR
// its budget_bucket is null/blank/Uncategorized/Unsorted (does NOT require both).
export function isUnresolvedClassification(transaction) {
  return isUnresolved(transaction);
}

// Aggregate breakdown of unresolved rows by which dimension(s) are missing.
export function unresolvedBreakdown(rows = []) {
  let both = 0, categoryOnly = 0, bucketOnly = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const cm = catMissing(r);
    const bm = bucketMissing(r);
    if (cm && bm) both += 1;
    else if (cm) categoryOnly += 1;
    else if (bm) bucketOnly += 1;
  }
  return { both, categoryOnly, bucketOnly, total: both + categoryOnly + bucketOnly };
}

// ---------------------------------------------------------------------------
// Canonical category -> bucket map (reusable market knowledge, no personal
// data). Used ONLY to fill a MISSING bucket for a row that already has a valid
// category, so the completed pair stays coherent.
// ---------------------------------------------------------------------------
const CATEGORY_BUCKET = {
  groceries: 'NEEDS', 'household/utilities': 'NEEDS', utilities: 'NEEDS', transportation: 'NEEDS',
  fuel: 'NEEDS', 'medical/health': 'NEEDS', healthcare: 'NEEDS', health: 'NEEDS', insurance: 'NEEDS',
  education: 'NEEDS', maintenance: 'NEEDS', 'bank fees': 'NEEDS', financial: 'NEEDS', 'financial fees': 'NEEDS',
  'household help': 'NEEDS',
  'dining out': 'WANTS', dining: 'WANTS', food: 'WANTS', shopping: 'WANTS', subscriptions: 'WANTS',
  sports: 'WANTS', entertainment: 'WANTS', 'personal care': 'WANTS', travel: 'WANTS', gifts: 'WANTS',
  'office/social events': 'WANTS', 'work expenses': 'WANTS', miscellaneous: 'WANTS',
  salary: 'INCOME', income: 'INCOME', interest: 'INCOME', 'interest income': 'INCOME',
  'refund/reimbursement': 'INCOME', reimbursements: 'INCOME',
  'loan payment': 'DEBT_FUNDING', 'debt payment': 'DEBT_FUNDING', 'debt repayment': 'DEBT_FUNDING',
  transfer: 'TRANSFERS', 'credit card payment': 'TRANSFERS', payment: 'TRANSFERS', cash: 'TRANSFERS',
  savings: 'SAVINGS', investments: 'SAVINGS', 'savings/investment': 'SAVINGS',
  'emergency fund': 'SAVINGS', retirement: 'SAVINGS',
};
export function bucketForCategory(category) {
  const k = String(category || '').trim().toLowerCase();
  return CATEGORY_BUCKET[k] || null;
}

// ---------------------------------------------------------------------------
// Merge an inferred classification into an unresolved row. PREFER filling the
// missing dimension over rewriting a valid one. Returns { category, bucket,
// changed:[...] } — `changed` names exactly which dimensions this would write.
// ---------------------------------------------------------------------------
export function mergeClassificationIntoUnresolved(existing = {}, inferred = {}) {
  const existingCat = String(existing.category ?? '').trim();
  const existingBucket = String(existing.budget_bucket ?? existing.bucket ?? '').trim();
  const catMiss = catMissing({ category: existingCat });
  const bucketMiss = bucketMissing({ budget_bucket: existingBucket });

  const infCat = inferred.category && inferred.category !== UNCATEGORIZED ? inferred.category : null;
  const infBucket = inferred.bucket ?? inferred.budget_bucket ?? null;
  const infBucketValid = infBucket && String(infBucket).trim().toLowerCase() !== 'unsorted' ? infBucket : null;

  let category = existingCat || UNCATEGORIZED;
  let bucket = existingBucket || UNSORTED;
  const changed = [];

  // Already resolved -> never touch.
  if (!catMiss && !bucketMiss) return { category, bucket, changed };

  // Both missing -> take the inferred pair as-is (coherent by construction).
  if (catMiss && bucketMiss) {
    if (infCat && infBucketValid) { category = infCat; bucket = infBucketValid; changed.push('category', 'bucket'); }
    return { category, bucket, changed };
  }

  // Bucket missing, category valid -> fill ONLY the bucket, keep the category.
  if (bucketMiss && !catMiss) {
    const fill = bucketForCategory(existingCat) || infBucketValid;
    if (fill) { bucket = fill; changed.push('bucket'); }
    return { category, bucket, changed };
  }

  // Category missing, bucket valid -> fill the category; keep the valid bucket
  // when it is compatible with the inferred category, otherwise correct the pair
  // to stay coherent (both fields shown as changed in the preview).
  if (infCat) {
    category = infCat; changed.push('category');
    const natural = bucketForCategory(infCat);
    if (natural && natural !== existingBucket) { bucket = natural; changed.push('bucket'); }
  }
  return { category, bucket, changed };
}

// ---------------------------------------------------------------------------
// Provenance — map a classifier result to the persisted classification_source.
// Automatic results KEEP their automatic provenance (never forced to 'user').
// ---------------------------------------------------------------------------
export function provenanceSourceOf(classification = {}) {
  const s = classification.source;
  if (s === 'deterministic') return 'deterministic';
  if (s === 'merchant_rule') return 'merchant_rule';
  if (s === 'user_rule') return classification.ruleKind === 'learned' ? 'learned_rule' : 'manual_rule';
  if (s === 'ai') return 'ai';
  return 'import';
}

// Metadata for an explicitly-applied automatic (rule/deterministic/merchant)
// result. Provenance stays automatic; user_categorized=false; the row is
// RESOLVED (needs_review=false) because the user explicitly confirmed the batch.
export function metadataForAutomatic(classification, merged) {
  return {
    category: merged.category,
    budget_bucket: merged.bucket,
    classification_source: provenanceSourceOf(classification),
    classification_confidence: typeof classification.confidence === 'number'
      ? Math.round(classification.confidence * 100) / 100 : null,
    transaction_nature: classification.nature && classification.nature !== 'unknown' ? classification.nature : null,
    normalized_merchant: classification.normalizedMerchant || null,
    user_categorized: false,
    needs_review: false,
  };
}

// Metadata for an AI suggestion (Magic Sweep only). source='ai', capped
// confidence, needs_review=true, user_categorized=false — never auto-accepted.
export function metadataForAi(aiClassification, merged) {
  return {
    category: merged.category,
    budget_bucket: merged.bucket,
    classification_source: 'ai',
    classification_confidence: typeof aiClassification.confidence === 'number'
      ? Math.round(aiClassification.confidence * 100) / 100 : null,
    transaction_nature: aiClassification.nature && aiClassification.nature !== 'unknown' ? aiClassification.nature : null,
    normalized_merchant: aiClassification.normalizedMerchant || merged.normalizedMerchant || null,
    user_categorized: false,
    needs_review: true,
  };
}

// ---------------------------------------------------------------------------
// Scope resolution — from a set of rows, the rows a given scope may act on.
// Protected rows are ALWAYS excluded (unless a future explicit override).
// ---------------------------------------------------------------------------
export function resolveScopeRows(rows = [], { scope = SCOPE.UNRESOLVED, selectedIds } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope === SCOPE.SELECTED) {
    const set = selectedIds instanceof Set ? selectedIds : new Set((selectedIds || []).map(String));
    return list.filter((r) => set.has(String(r.id)) && !isProtectedRow(r));
  }
  if (scope === SCOPE.ALL_ELIGIBLE) {
    // Advanced: may reprocess automatic classifications, but NEVER user ones.
    return list.filter((r) => !isProtectedRow(r));
  }
  // Default safe scope: unresolved and unprotected only.
  return list.filter((r) => isUnresolvedClassification(r) && !isProtectedRow(r));
}

// ---------------------------------------------------------------------------
// Preview — no writes. Classifies each in-scope row deterministically and
// buckets the outcome. RULES mode is binary (canCategorize / stillUnresolved);
// MAGIC mode additionally routes still-review rows to AI (aiSuggestions).
// Returns aggregate counts + a write `plan` (applied later on Apply) + the list
// of AI candidates (rows Magic Sweep will send to Gemini).
// ---------------------------------------------------------------------------
export function previewCategorization({ rows = [], mode = MODE.RULES, learnedRules = [] } = {}) {
  const inScope = Array.isArray(rows) ? rows : [];
  const breakdown = unresolvedBreakdown(inScope.filter(isUnresolvedClassification));
  let protectedCount = 0;
  let canCategorize = 0;
  let aiSuggestions = 0;
  let stillUnresolved = 0;
  const plan = [];        // automatic writes: { id, metadata }
  const aiCandidates = []; // magic-mode rows to classify via AI: { id, normalizedMerchant, description, amount, _row }

  for (const row of inScope) {
    if (isProtectedRow(row)) { protectedCount += 1; continue; }
    const { classification } = classifyForInsert(row, learnedRules);
    const resolvedByEngine =
      classification.category &&
      classification.category !== UNCATEGORIZED &&
      classification.state !== 'review';

    if (resolvedByEngine) {
      const merged = mergeClassificationIntoUnresolved(row, {
        category: classification.category, bucket: classification.bucket,
      });
      if (merged.changed.length === 0) { stillUnresolved += 1; continue; }
      canCategorize += 1;
      plan.push({ id: row.id, metadata: metadataForAutomatic(classification, merged) });
    } else if (mode === MODE.MAGIC) {
      aiSuggestions += 1;
      aiCandidates.push({
        id: row.id,
        normalizedMerchant: classification.normalizedMerchant || '',
        description: row.description || row.description_raw || row.merchant || '',
        amount: Number(row.amount) || 0,
        _row: row,
      });
    } else {
      stillUnresolved += 1;
    }
  }

  return {
    mode,
    total: inScope.length,
    breakdown,
    counts: { protected: protectedCount, canCategorize, aiSuggestions, stillUnresolved },
    plan,
    aiCandidates,
  };
}

// Merge a sanitized AI classification onto its row and produce the write entry
// (needs_review=true, source='ai'). Used after previewCategorization when Magic
// Sweep's AI candidates come back. Returns { id, metadata } or null.
export function planEntryForAi(row, aiClassification) {
  if (!row || !aiClassification) return null;
  const merged = mergeClassificationIntoUnresolved(row, {
    category: aiClassification.category, bucket: aiClassification.bucket,
  });
  if (merged.changed.length === 0) return null;
  return { id: row.id, metadata: metadataForAi(aiClassification, merged) };
}

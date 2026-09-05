// Transaction Intelligence Calibration V1 — pure, READ-ONLY quality analysis.
//
// Runs the CURRENT deterministic engine against a bounded sample of historical
// rows and produces an aggregate quality report. It NEVER writes, NEVER calls
// AI/Gemini (privacy — analytics must not ship financial data anywhere), and
// NEVER exposes account numbers, balances, bank references, user ids, amounts,
// or raw descriptions in its output. Everything here is pure + data-injected so
// it is unit-testable with no DB and no network; the caller fetches the sample.
//
// TWO INDEPENDENT CONCEPTS (kept explicitly separate):
//   1. OPERATIONAL PROTECTION — a user-classified row stays protected in the real
//      product; calibration never writes to it. Reported under `operational`.
//   2. SHADOW BENCHMARK — for trusted ground-truth rows, calibration generates a
//      FRESH prediction that deliberately ignores the row's stored classification
//      (classifyForInsert feeds ONLY merchant/description/amount — never the
//      stored category/bucket/source/confidence/user_categorized/needs_review),
//      then compares it to the stored truth. A row can be BOTH protected AND in
//      the benchmark — that is not a contradiction. Reported under `benchmark`.
//
// This exception lives ONLY here (read-only benchmarking). Production protection
// (isProtectedRow, classification writes, bulk categorization, review) is unchanged.

import { classifyForInsert, isProtectedRow } from './transactionRules.js';
import { UNCATEGORIZED } from './transactionIntelligence.js';
import { provenanceSourceOf } from './categorizationScope.js';

// Bounded sample sizes offered to the diagnostic surface.
export const CALIBRATION_SAMPLE_SIZES = [100, 250, 500];

// Diagnostic outcome groups (per evaluated row) — OPERATIONAL view.
export const OUTCOME = {
  RESOLVED: 'A_resolved',        // deterministic / rule resolved
  AI_CANDIDATE: 'B_ai_candidate', // engine=review, has a usable signal -> would go to AI
  UNRESOLVED: 'C_unresolved',    // engine=review, no usable signal
  PROTECTED: 'D_protected',      // operationally protected -> excluded from resolution RATES
};

// Diagnostic error buckets (recommendations only — never auto-applied).
export const ERROR_BUCKET = {
  SHOULD_BE_DETERMINISTIC: 'SHOULD_BE_DETERMINISTIC',
  LEARNABLE_USER_PATTERN: 'LEARNABLE_USER_PATTERN',
  AI_CANDIDATE: 'AI_CANDIDATE',
  AMBIGUOUS_NEEDS_USER: 'AMBIGUOUS_NEEDS_USER',
};

// Categories whose correct answer comes from a DETERMINISTIC financial-nature
// rule — if the engine missed one of these on a trusted row, a deterministic
// rule *should* have caught it.
const DETERMINISTIC_TRUTH_CATEGORIES = new Set([
  'credit card payment', 'loan payment', 'transfer', 'bank fees', 'interest', 'salary',
]);

const norm = (v) => String(v ?? '').trim().toLowerCase();
const isBlank = (v) => { const s = norm(v); return s === '' || s === 'uncategorized' || s === 'unsorted'; };

// A row is trusted ground truth ONLY when its provenance is genuinely human:
// user_categorized=true or classification_source='user'. Legacy/'manual' rows
// are the schema default and are NEVER blindly trusted.
export function isTrustedGroundTruth(row = {}) {
  return row.user_categorized === true || row.classification_source === 'user';
}

// Did the row carry any usable text for the engine to reason from? A trusted row
// with NO merchant/description is "unpredictable" — it is excluded from accuracy
// denominators (there is nothing to predict from), NOT counted as a wrong guess.
export function hasInputSignal(row = {}) {
  return String(row.merchant || '').trim() !== '' ||
    String(row.description || row.description_raw || '').trim() !== '';
}

// A privacy-safe merchant label for repeated-miss aggregation. Transfer-nature
// rows collapse to a generic label (avoids surfacing a counterparty's name).
function missLabel(prediction) {
  if (prediction && prediction.nature === 'transfer') return 'TRANSFER COUNTERPARTY';
  const m = String(prediction?.normalizedMerchant || '').trim();
  return m || 'UNKNOWN';
}

// Evaluate one row against the FRESH engine prediction. Returns ONLY non-sensitive
// diagnostic fields (id + flags + a merchant label) — never amount, account,
// description, category/bucket values, or reference data.
export function evaluateRow(row = {}, learnedRules = []) {
  // Fresh prediction: classifyForInsert passes ONLY merchant/description/amount
  // (+ learned rules), so no stored answer can leak in. Verified by tests C–F.
  const { classification } = classifyForInsert(row, learnedRules);
  const protectedOperationally = isProtectedRow(row);
  const trusted = isTrustedGroundTruth(row);
  const inputSignal = hasInputSignal(row);

  const resolvedByEngine =
    classification.category && classification.category !== UNCATEGORIZED && classification.state !== 'review';
  const label = missLabel(classification);
  const predictionHasSignal = label !== 'UNKNOWN';

  let outcome;
  if (protectedOperationally) outcome = OUTCOME.PROTECTED;
  else if (resolvedByEngine) outcome = OUTCOME.RESOLVED;
  else if (predictionHasSignal) outcome = OUTCOME.AI_CANDIDATE;
  else outcome = OUTCOME.UNRESOLVED;

  const source = resolvedByEngine
    ? provenanceSourceOf(classification)
    : (outcome === OUTCOME.AI_CANDIDATE ? 'ai' : 'none');

  // SHADOW BENCHMARK: a trusted row with usable input is included, regardless of
  // operational protection. Match flags are true/false when the dimension has a
  // known truth (a review prediction -> Uncategorized -> counts as FALSE, i.e.
  // wrong, never silently dropped); null when there is nothing to benchmark
  // (untrusted, no input signal, or blank stored truth for that dimension).
  const includedInBenchmark = trusted && inputSignal;
  let categoryMatch = null;
  let bucketMatch = null;
  let fullMatch = null;
  let errorBucket = null;
  const gtCategory = row.category;
  const gtBucket = row.budget_bucket ?? row.budgetBucket;

  if (includedInBenchmark) {
    const catKnown = !isBlank(gtCategory);
    const bucketKnown = !isBlank(gtBucket);
    categoryMatch = catKnown ? norm(classification.category) === norm(gtCategory) : null;
    bucketMatch = bucketKnown ? norm(classification.bucket) === norm(gtBucket) : null;
    fullMatch = (catKnown && bucketKnown) ? (categoryMatch && bucketMatch) : null;
  }

  // A "miss" (for repeated-merchant discovery + recommendations): a benchmark row
  // the engine got wrong, OR any non-protected row the engine could not resolve.
  const isMiss =
    (!protectedOperationally && !resolvedByEngine) ||
    (includedInBenchmark && fullMatch === false);

  if (isMiss) {
    errorBucket = classifyErrorBucket({ classification, trusted: includedInBenchmark, gtCategory });
  }

  return {
    id: row.id, outcome, source, trusted,
    protectedOperationally, includedInBenchmark, hasInputSignal: inputSignal,
    categoryMatch, bucketMatch, fullMatch, errorBucket, label, isMiss,
  };
}

// Deterministic error-bucket assignment. A trusted miss whose truth is a
// deterministic-nature category should have been deterministic; otherwise a
// merchant with a signal is a learnable/AI candidate; anything without a signal
// is ambiguous. (Repeated-vs-single upgraded by the caller.)
function classifyErrorBucket({ classification, trusted, gtCategory }) {
  if (trusted && DETERMINISTIC_TRUTH_CATEGORIES.has(norm(gtCategory))) {
    return ERROR_BUCKET.SHOULD_BE_DETERMINISTIC;
  }
  const label = missLabel(classification);
  if (label === 'UNKNOWN' || label === 'TRANSFER COUNTERPARTY') return ERROR_BUCKET.AMBIGUOUS_NEEDS_USER;
  return ERROR_BUCKET.AI_CANDIDATE; // may be upgraded to LEARNABLE_USER_PATTERN if repeated
}

// Rate helper — returns null (rendered as N/A) when the denominator is zero, so a
// zero sample never masquerades as 0%.
const rate = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
// Explicit accuracy triple with a visible denominator.
const accuracy = (correct, denominator) => ({ correct, denominator, pct: rate(correct, denominator) });

// Run the full calibration over a sample. PURE + READ-ONLY. `repeatThreshold`
// (default 3) is how many times a missed merchant must recur to be flagged as a
// learnable pattern. Returns an aggregate report with NO sensitive fields.
export function runCalibration(rows = [], learnedRules = [], { repeatThreshold = 3, topMisses = 10 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const evaluated = list.map((r) => evaluateRow(r, learnedRules));

  // Repeated-miss discovery (aggregate normalized-merchant counts among misses).
  const missCounts = new Map();
  for (const e of evaluated) {
    if (!e.isMiss) continue;
    missCounts.set(e.label, (missCounts.get(e.label) || 0) + 1);
  }
  for (const e of evaluated) {
    if (e.errorBucket === ERROR_BUCKET.AI_CANDIDATE && (missCounts.get(e.label) || 0) >= repeatThreshold) {
      e.errorBucket = ERROR_BUCKET.LEARNABLE_USER_PATTERN;
    }
  }

  // OPERATIONAL view — resolution rates over NON-protected rows only.
  const op = {
    evaluated: evaluated.length,
    protected: evaluated.filter((e) => e.outcome === OUTCOME.PROTECTED).length,
    resolved: evaluated.filter((e) => e.outcome === OUTCOME.RESOLVED).length,
    aiCandidate: evaluated.filter((e) => e.outcome === OUTCOME.AI_CANDIDATE).length,
    unresolved: evaluated.filter((e) => e.outcome === OUTCOME.UNRESOLVED).length,
  };
  const opDenom = op.resolved + op.aiCandidate + op.unresolved;

  // Source hit-rate breakdown among resolved rows.
  const bySource = {};
  for (const e of evaluated) {
    if (e.outcome !== OUTCOME.RESOLVED) continue;
    bySource[e.source] = (bySource[e.source] || 0) + 1;
  }

  // SHADOW BENCHMARK view — trusted ground truth, with EXPLICIT denominators.
  const trusted = evaluated.filter((e) => e.trusted);
  const benchRows = evaluated.filter((e) => e.includedInBenchmark); // trusted + input signal
  const catRows = benchRows.filter((e) => e.categoryMatch !== null);
  const bucketRows = benchRows.filter((e) => e.bucketMatch !== null);
  const fullRows = benchRows.filter((e) => e.fullMatch !== null);

  // Error-bucket tallies.
  const errorBuckets = {};
  for (const key of Object.values(ERROR_BUCKET)) errorBuckets[key] = 0;
  for (const e of evaluated) if (e.errorBucket) errorBuckets[e.errorBucket] += 1;

  const topMissMerchants = [...missCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topMisses)
    .map(([merchant, count]) => ({ merchant, count }));

  return {
    sampleSize: evaluated.length,
    operational: {
      evaluated: op.evaluated,
      protected: op.protected,
      resolved: op.resolved,
      aiCandidate: op.aiCandidate,
      unresolved: op.unresolved,
      rates: {
        resolved: rate(op.resolved, opDenom),
        aiCandidate: rate(op.aiCandidate, opDenom),
        unresolved: rate(op.unresolved, opDenom),
      },
    },
    sourceHitRates: bySource,
    benchmark: {
      groundTruthCount: trusted.length,                              // all trusted rows
      predictedCount: benchRows.length,                             // fresh predictions available (had input)
      unpredictableCount: trusted.length - benchRows.length,        // trusted rows with no input signal
      categoryAccuracy: accuracy(catRows.filter((e) => e.categoryMatch).length, catRows.length),
      bucketAccuracy: accuracy(bucketRows.filter((e) => e.bucketMatch).length, bucketRows.length),
      fullPairAccuracy: accuracy(fullRows.filter((e) => e.fullMatch).length, fullRows.length),
    },
    errorBuckets,
    topMissMerchants,
    // Non-sensitive per-row diagnostics (id + flags + label only).
    rows: evaluated,
  };
}

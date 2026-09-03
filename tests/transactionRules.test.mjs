// Transaction Intelligence V1 wiring — pure data-layer logic tests.
// FICTIONAL data only. Pure functions (no DB, no network).
//
// Run from repo root:  node tests/transactionRules.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const TR = await vite.ssrLoadModule('/src/lib/transactionRules.js');
  const { isUnresolved, isProtectedRow, isEligibleForApply, classifyForInsert, previewBackfill } = TR;

  // isUnresolved.
  ok('unresolved: Uncategorized', isUnresolved({ category: 'Uncategorized', budget_bucket: 'NEEDS' }) === true);
  ok('unresolved: Unsorted bucket', isUnresolved({ category: 'Groceries', budget_bucket: 'Unsorted' }) === true);
  ok('unresolved: blank', isUnresolved({ category: '', budget_bucket: '' }) === true);
  ok('resolved', isUnresolved({ category: 'Groceries', budget_bucket: 'NEEDS' }) === false);

  // isProtectedRow (mirrors engine protection against persisted columns).
  ok('protect: user_categorized', isProtectedRow({ user_categorized: true }) === true);
  ok('protect: source=user', isProtectedRow({ classification_source: 'user', category: 'X', budget_bucket: 'NEEDS' }) === true);
  ok('protect: resolved legacy', isProtectedRow({ classification_source: 'legacy', needs_review: false, category: 'Groceries', budget_bucket: 'NEEDS' }) === true);
  ok('protect: resolved manual', isProtectedRow({ classification_source: 'manual', needs_review: false, category: 'Groceries', budget_bucket: 'NEEDS' }) === true);
  ok('not protect: unresolved legacy', isProtectedRow({ classification_source: 'legacy', needs_review: false, category: 'Uncategorized', budget_bucket: 'Unsorted' }) === false);
  ok('not protect: import unresolved', isProtectedRow({ classification_source: 'import', needs_review: true, category: 'Uncategorized', budget_bucket: 'Unsorted' }) === false);

  // isEligibleForApply (M: excludes protected rows).
  ok('M: eligible needs_review', isEligibleForApply({ needs_review: true, classification_source: 'import' }) === true);
  ok('M: eligible unresolved', isEligibleForApply({ category: 'Uncategorized', budget_bucket: 'Unsorted' }) === true);
  ok('M: NOT eligible protected user', isEligibleForApply({ user_categorized: true, needs_review: true }) === false);
  ok('M: NOT eligible resolved legacy', isEligibleForApply({ classification_source: 'legacy', needs_review: false, category: 'Groceries', budget_bucket: 'NEEDS' }) === false);

  // classifyForInsert: returns metadata (classification_* names), never category_*.
  const { classification, metadata } = classifyForInsert({ description: 'PAGO VISA', merchant: 'PAGO VISA', amount: -100 });
  ok('classifyForInsert: cc auto', classification.category === 'Credit Card Payment' && metadata.classification_source === 'deterministic');
  ok('classifyForInsert: metadata cols', 'classification_source' in metadata && 'classification_confidence' in metadata && 'needs_review' in metadata && 'user_categorized' in metadata && 'transaction_nature' in metadata && 'normalized_merchant' in metadata);
  ok('classifyForInsert: no category_* keys', !('category_source' in metadata) && !('category_confidence' in metadata));
  ok('classifyForInsert: auto not user', metadata.user_categorized === false && metadata.needs_review === false);
  const unkIns = classifyForInsert({ description: 'ZZZ QRS NOMATCH', amount: -9 });
  ok('classifyForInsert: unknown -> review', unkIns.metadata.category === 'Uncategorized' && unkIns.metadata.needs_review === true && unkIns.metadata.classification_source === 'import');

  // previewBackfill: buckets rows; excludes protected; leaves resolved alone.
  const rows = [
    { id: 1, category: 'Uncategorized', budget_bucket: 'Unsorted', description: 'PAGO VISA', merchant: 'PAGO VISA', amount: -100, classification_source: 'legacy', needs_review: false }, // auto (cc)
    { id: 2, category: 'Uncategorized', budget_bucket: 'Unsorted', description: 'ZZZ QRS NOMATCH', merchant: 'ZZZ QRS', amount: -9, classification_source: 'legacy', needs_review: false }, // review
    { id: 3, category: 'Groceries', budget_bucket: 'NEEDS', description: 'SUPER 99', merchant: 'SUPER 99', amount: -20, classification_source: 'legacy', needs_review: false }, // protected (resolved legacy)
    { id: 4, category: 'Dining', budget_bucket: 'WANTS', user_categorized: true, description: 'X', merchant: 'X', amount: -1 }, // protected (user)
  ];
  const pv = previewBackfill(rows, []);
  ok('O/P: preview does not mutate input', rows[0].category === 'Uncategorized' && rows[2].category === 'Groceries');
  ok('P: protected excluded', pv.counts.protected === 2);
  ok('Q: auto bucketed', pv.counts.auto === 1 && pv.plan.auto[0].id === 1);
  ok('Q: review bucketed', pv.counts.review === 1 && pv.plan.review[0].id === 2);
  ok('Q: no false suggested', pv.counts.suggested === 0);

  // R: normalized_merchant is populated intentionally (present in insert metadata).
  ok('R: normalized_merchant in insert metadata', typeof metadata.normalized_merchant === 'string' && metadata.normalized_merchant.length > 0);
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

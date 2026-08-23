// Synthetic tests for the generic conditional-fallback tier (Phase 1).
// FICTIONAL identifiers only — no real names/private data.
//
// Loads the REAL production modules through Vite's SSR pipeline so that the
// `import merchant_rules.json` in ruleMatcher/normalize is transformed exactly
// as in the build (native Node ESM would reject the JSON import without an
// import attribute — ERR_IMPORT_ATTRIBUTE_MISSING).
//
// Run (where Node exists) from repo root:  node tests/conditionalFallback.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

// Fictional fallback rule mirroring the conditional shape.
const fb = (priority = 100, pattern = 'TEST FAMILY CONTACT') => ({
  id: 'fb-' + pattern, source: 'fallback', match_type: 'contains', match_field: 'description', pattern, priority,
  branches: [
    { amount_sign: 'positive', category: 'Family Transfer', budget_bucket: 'TRANSFERS', is_transfer: true, merchant_label: 'Test Contact' },
    { secondary_contains: ['TEST BUSINESS'], category: 'Business Pass-through', budget_bucket: 'TRANSFERS', is_transfer: true },
    { secondary_contains: ['TEST CASH'], category: 'Cash Swap', budget_bucket: 'TRANSFERS', is_transfer: true },
    { category: 'Family Support', budget_bucket: 'NEEDS', is_transfer: false },
  ],
});
const staticRules = [{ id: 'g1', matchAny: ['__nomatch__'], assign: { category: 'S1', budgetBucket: 'NEEDS', is_transfer: false } }];
const F = (description, amount) => ({ merchant: '', description, amount });
const cat = (m) => (m && m.rule.assign.category);

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { classifyTransaction } = await vite.ssrLoadModule('/src/lib/engine/ruleMatcher.js');
  const { processTransactionRow } = await vite.ssrLoadModule('/src/lib/engine/normalize.js');

  // 1 positive -> branch1
  ok('1 positive->Family Transfer', (() => { const m = classifyTransaction(F('TEST FAMILY CONTACT', 10), staticRules, [fb()]); return m.kind === 'fallback' && cat(m) === 'Family Transfer'; })());
  // 2 zero + business -> branch2
  ok('2 zero+business->Business', cat(classifyTransaction(F('TEST FAMILY CONTACT TEST BUSINESS', 0), staticRules, [fb()])) === 'Business Pass-through');
  // 3 negative + business -> branch2 (sign-unrestricted)
  ok('3 neg+business->Business', cat(classifyTransaction(F('TEST FAMILY CONTACT TEST BUSINESS', -5), staticRules, [fb()])) === 'Business Pass-through');
  // 4 zero + cash -> branch3
  ok('4 zero+cash->Cash Swap', cat(classifyTransaction(F('TEST FAMILY CONTACT TEST CASH', 0), staticRules, [fb()])) === 'Cash Swap');
  // 5 negative + none -> default
  ok('5 neg+none->Family Support', cat(classifyTransaction(F('TEST FAMILY CONTACT', -5), staticRules, [fb()])) === 'Family Support');
  // 6 zero + none -> default
  ok('6 zero+none->Family Support', cat(classifyTransaction(F('TEST FAMILY CONTACT', 0), staticRules, [fb()])) === 'Family Support');
  // 7 manual wins over fallback
  const manual = { id: 'm1', source: 'manual', match_type: 'contains', match_field: 'description', pattern: 'TEST FAMILY CONTACT', priority: 100, assign: { category: 'ManualCat', subcategory: null, budgetBucket: 'WANTS', is_transfer: null } };
  ok('7 manual wins', (() => { const m = classifyTransaction(F('TEST FAMILY CONTACT', 10), staticRules, [manual, fb()]); return m.kind === 'manual' && cat(m) === 'ManualCat'; })());
  // 8 static wins over fallback
  const sr2 = [{ id: 'gS', matchAny: ['TEST FAMILY CONTACT'], assign: { category: 'StaticCat', budgetBucket: 'NEEDS', is_transfer: false } }];
  ok('8 static wins', (() => { const m = classifyTransaction(F('TEST FAMILY CONTACT', 10), sr2, [fb()]); return m.kind === 'static' && cat(m) === 'StaticCat'; })());
  // 9 migrated wins over fallback
  const migrated = { id: 'mig1', source: 'migrated', match_type: 'contains', match_field: 'description', pattern: 'TEST FAMILY CONTACT', priority: 1001, assign: { category: 'MigCat', subcategory: null, budgetBucket: 'NEEDS', is_transfer: false } };
  ok('9 migrated wins', (() => { const m = classifyTransaction(F('TEST FAMILY CONTACT', 10), staticRules, [migrated, fb()]); return m.kind === 'migrated' && cat(m) === 'MigCat'; })());
  // 10 learned non-participating
  const learned = { id: 'l1', source: 'learned', match_type: 'contains', match_field: 'description', pattern: 'TEST FAMILY CONTACT', priority: 100, assign: { category: 'LearnedCat', subcategory: null, budgetBucket: 'NEEDS', is_transfer: false } };
  ok('10 learned ignored', classifyTransaction(F('TEST FAMILY CONTACT', 10), staticRules, [learned]) === null);
  // 11 malformed branches -> ignored, no crash
  let threw = false; let r11;
  try { r11 = classifyTransaction(F('TEST FAMILY CONTACT', 10), staticRules, [{ id: 'bad', source: 'fallback', match_type: 'contains', match_field: 'description', pattern: 'TEST FAMILY CONTACT', priority: 100, branches: 'not-an-array' }]); } catch { threw = true; }
  ok('11 malformed branches safe', !threw && r11 === null);
  // 12 two fallback rules -> priority order
  const fbOther = { id: 'fbO', source: 'fallback', match_type: 'contains', match_field: 'description', pattern: 'TEST OTHER', priority: 10, branches: [{ category: 'CatA', budget_bucket: 'WANTS', is_transfer: false }] };
  ok('12 first-by-priority fallback wins', cat(classifyTransaction(F('TEST OTHER TEST FAMILY CONTACT', -1), staticRules, [fbOther, fb(20)])) === 'CatA');
  // 13 merchant_label via processTransactionRow
  ok('13 merchant_label applied', (() => { const r = processTransactionRow({ description_raw: 'TEST FAMILY CONTACT', amount: 10 }, { userRules: [fb()] }); return r.merchant === 'Test Contact' && r.category === 'Family Transfer' && r.is_transfer === true; })());
  // 14 NULL branches on manual -> unchanged (branches ignored for non-fallback)
  const manualNull = { ...manual, branches: null };
  ok('14 manual w/ null branches unchanged', (() => { const m = classifyTransaction(F('TEST FAMILY CONTACT', 10), staticRules, [manualNull]); return m.kind === 'manual' && cat(m) === 'ManualCat'; })());
} finally {
  await vite.close();
}

console.log(`\n${pass}/${pass + fail} tests passed`);
process.exit(fail === 0 ? 0 : 1);

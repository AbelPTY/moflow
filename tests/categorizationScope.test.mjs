// Activity Categorization Scope & Safety V1 — pure scope/preview/merge tests.
// FICTIONAL data only. Loaded through Vite SSR (no DB, no network).
//
// Run (where Node exists) from repo root:  node tests/categorizationScope.test.mjs
import { createServer } from 'vite';
import { readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const CS = await vite.ssrLoadModule('/src/lib/categorizationScope.js');
  const TI = await vite.ssrLoadModule('/src/lib/transactionIntelligence.js');
  const EN = await vite.ssrLoadModule('/src/i18n/en-US.js');
  const ES = await vite.ssrLoadModule('/src/i18n/es-PA.js');
  const {
    isUnresolvedClassification, unresolvedBreakdown, bucketForCategory,
    mergeClassificationIntoUnresolved, provenanceSourceOf, metadataForAutomatic, metadataForAi,
    resolveScopeRows, previewCategorization, planEntryForAi,
    SCOPE, MODE,
  } = CS;

  // ---- Unresolved detection (A–E) ----------------------------------------
  ok('A: Uncategorized + valid bucket is unresolved', isUnresolvedClassification({ category: 'Uncategorized', budget_bucket: 'NEEDS' }) === true);
  ok('B: valid category + Unsorted is unresolved', isUnresolvedClassification({ category: 'Groceries', budget_bucket: 'Unsorted' }) === true);
  ok('C: both missing is unresolved', isUnresolvedClassification({ category: 'Uncategorized', budget_bucket: 'Unsorted' }) === true);
  ok('D: valid + valid is RESOLVED', isUnresolvedClassification({ category: 'Groceries', budget_bucket: 'NEEDS' }) === false);
  ok('E: null/blank variants unresolved', isUnresolvedClassification({ category: null, budget_bucket: 'NEEDS' }) === true && isUnresolvedClassification({ category: '  ', budget_bucket: 'WANTS' }) === true && isUnresolvedClassification({ category: 'Groceries', budget_bucket: null }) === true);
  ok('E2: case-insensitive + trimmed', isUnresolvedClassification({ category: ' uncategorized ', budget_bucket: 'needs' }) === true && isUnresolvedClassification({ category: 'Groceries', budget_bucket: ' UNSORTED ' }) === true);

  // breakdown
  const bd = unresolvedBreakdown([
    { category: 'Uncategorized', budget_bucket: 'Unsorted' }, // both
    { category: 'Uncategorized', budget_bucket: 'NEEDS' },    // category only
    { category: 'Groceries', budget_bucket: 'Unsorted' },     // bucket only
    { category: 'Groceries', budget_bucket: 'NEEDS' },        // resolved (ignored)
  ]);
  ok('breakdown both/categoryOnly/bucketOnly', bd.both === 1 && bd.categoryOnly === 1 && bd.bucketOnly === 1 && bd.total === 3);

  // ---- Protection (F, G, S) ----------------------------------------------
  const rowUserCat = { id: 'p1', category: 'Uncategorized', budget_bucket: 'Unsorted', user_categorized: true };
  const rowSrcUser = { id: 'p2', category: 'Uncategorized', budget_bucket: 'Unsorted', classification_source: 'user' };
  const rowLegacy = { id: 'p3', category: 'Groceries', budget_bucket: 'NEEDS', classification_source: 'manual', needs_review: false };
  ok('F/S: user_categorized protected -> excluded from default', resolveScopeRows([rowUserCat], { scope: SCOPE.UNRESOLVED }).length === 0);
  ok('G: source=user protected -> excluded', resolveScopeRows([rowSrcUser], { scope: SCOPE.UNRESOLVED }).length === 0);

  // ---- Default scope (H) --------------------------------------------------
  const mixed = [
    { id: 'a', category: 'Uncategorized', budget_bucket: 'Unsorted' },
    { id: 'b', category: 'Groceries', budget_bucket: 'NEEDS' }, // resolved
    rowUserCat,
    rowLegacy,
  ];
  const def = resolveScopeRows(mixed, { scope: SCOPE.UNRESOLVED }).map((r) => r.id);
  ok('H: default = unresolved + unprotected only', JSON.stringify(def) === JSON.stringify(['a']));

  // ---- Selected scope (I, U) ---------------------------------------------
  const sel = resolveScopeRows(mixed, { scope: SCOPE.SELECTED, selectedIds: new Set(['a', 'b']) }).map((r) => r.id);
  ok('I: selected uses selected ids only (b included even if resolved)', JSON.stringify(sel.sort()) === JSON.stringify(['a', 'b']));
  ok('I2: selected still excludes protected', resolveScopeRows([rowUserCat], { scope: SCOPE.SELECTED, selectedIds: new Set(['p1']) }).length === 0);
  ok('U: no selection -> empty scope', resolveScopeRows(mixed, { scope: SCOPE.SELECTED, selectedIds: new Set() }).length === 0);

  // ---- Filtered-view scope (J): operates only on the passed (filtered) rows -
  const filteredSubset = [mixed[0]]; // pretend a filter left just row 'a'
  ok('J: scope respects the filtered subset it is given', resolveScopeRows(filteredSubset, { scope: SCOPE.UNRESOLVED }).length === 1);

  // ---- Advanced ALL_ELIGIBLE (T) -----------------------------------------
  const autoResolved = { id: 'c', category: 'Groceries', budget_bucket: 'NEEDS', classification_source: 'merchant_rule', needs_review: false };
  const allElig = resolveScopeRows([mixed[0], autoResolved, rowUserCat, rowSrcUser], { scope: SCOPE.ALL_ELIGIBLE }).map((r) => r.id);
  ok('T: all-eligible includes automatic but EXCLUDES user classifications', allElig.includes('a') && allElig.includes('c') && !allElig.includes('p1') && !allElig.includes('p2'));

  // ---- Partial merge (O, P, Q) -------------------------------------------
  const o = mergeClassificationIntoUnresolved({ category: 'Uncategorized', budget_bucket: 'NEEDS' }, { category: 'Groceries', bucket: 'NEEDS' });
  ok('O: fill category, preserve compatible bucket', o.category === 'Groceries' && o.bucket === 'NEEDS' && JSON.stringify(o.changed) === JSON.stringify(['category']));
  const p = mergeClassificationIntoUnresolved({ category: 'Groceries', budget_bucket: 'Unsorted' }, { category: 'Dining Out', bucket: 'WANTS' });
  ok('P: fill bucket from category, preserve category (ignores inferred cat)', p.category === 'Groceries' && p.bucket === 'NEEDS' && JSON.stringify(p.changed) === JSON.stringify(['bucket']));
  const q = mergeClassificationIntoUnresolved({ category: 'Uncategorized', budget_bucket: 'NEEDS' }, { category: 'Dining Out', bucket: 'WANTS' });
  ok('Q: incompatible -> coherent pair (both changed)', q.category === 'Dining Out' && q.bucket === 'WANTS' && q.changed.includes('category') && q.changed.includes('bucket'));
  const both = mergeClassificationIntoUnresolved({ category: 'Uncategorized', budget_bucket: 'Unsorted' }, { category: 'Fuel', bucket: 'NEEDS' });
  ok('merge: both missing -> inferred pair', both.category === 'Fuel' && both.bucket === 'NEEDS' && both.changed.length === 2);
  const resolved = mergeClassificationIntoUnresolved({ category: 'Groceries', budget_bucket: 'NEEDS' }, { category: 'Dining Out', bucket: 'WANTS' });
  ok('merge: resolved row -> no change', resolved.category === 'Groceries' && resolved.bucket === 'NEEDS' && resolved.changed.length === 0);
  ok('bucketForCategory known/unknown', bucketForCategory('Groceries') === 'NEEDS' && bucketForCategory('Zzz Unknown') === null);

  // ---- Provenance (R) -----------------------------------------------------
  ok('R: provenance mapping', provenanceSourceOf({ source: 'merchant_rule' }) === 'merchant_rule' && provenanceSourceOf({ source: 'user_rule', ruleKind: 'learned' }) === 'learned_rule' && provenanceSourceOf({ source: 'user_rule' }) === 'manual_rule' && provenanceSourceOf({ source: 'deterministic' }) === 'deterministic');
  const metaAuto = metadataForAutomatic({ source: 'merchant_rule', confidence: 0.9, nature: 'expense', normalizedMerchant: 'Arrocha' }, { category: 'Medical/Health', bucket: 'NEEDS' });
  ok('R2: automatic write keeps automatic provenance, not user', metaAuto.classification_source === 'merchant_rule' && metaAuto.user_categorized === false && metaAuto.needs_review === false && metaAuto.category === 'Medical/Health');
  const metaAi = metadataForAi({ confidence: 0.8, nature: 'expense' }, { category: 'Shopping', bucket: 'WANTS' });
  ok('AI write: source ai, needs_review, not user', metaAi.classification_source === 'ai' && metaAi.needs_review === true && metaAi.user_categorized === false && metaAi.classification_confidence <= 0.8);

  // ---- Preview by mode (K, L, M, N) --------------------------------------
  const rows = [
    { id: 'u1', merchant: 'FERRETERIA DESCONOCIDA XYZ', description: 'FERRETERIA DESCONOCIDA XYZ', amount: -10, category: 'Uncategorized', budget_bucket: 'Unsorted' }, // review
    { id: 'm1', merchant: 'ARROCHA', description: 'FCIA ARROCHA', amount: -25, category: 'Uncategorized', budget_bucket: 'Unsorted' }, // merchant rule
    { id: 'd1', merchant: 'PAGO VISA', description: 'PAGO VISA THANK YOU', amount: -500, category: 'Uncategorized', budget_bucket: 'Unsorted' }, // deterministic
    rowUserCat, // protected
  ];
  const rowsSnapshot = JSON.stringify(rows);
  const scoped = resolveScopeRows(rows, { scope: SCOPE.UNRESOLVED });
  const rulesPrev = previewCategorization({ rows: scoped, mode: MODE.RULES });
  ok('M: RULES mode never produces AI candidates', rulesPrev.aiCandidates.length === 0 && rulesPrev.counts.aiSuggestions === 0);
  ok('M2: RULES canCategorize=2 (merchant+deterministic), stillUnresolved=1', rulesPrev.counts.canCategorize === 2 && rulesPrev.counts.stillUnresolved === 1);
  const magicPrev = previewCategorization({ rows: scoped, mode: MODE.MAGIC });
  ok('N: MAGIC routes ONLY the review row to AI', magicPrev.counts.aiSuggestions === 1 && magicPrev.aiCandidates.length === 1 && magicPrev.aiCandidates[0].id === 'u1');
  ok('N2: MAGIC auto-categorizes the rule/deterministic rows', magicPrev.counts.canCategorize === 2 && magicPrev.counts.stillUnresolved === 0);
  ok('K/L: preview performs NO writes/mutation (rows unchanged)', JSON.stringify(rows) === rowsSnapshot);
  ok('K2: preview produces a plan but does not apply it', Array.isArray(rulesPrev.plan) && rulesPrev.plan.every((e) => e.metadata && e.id));
  ok('preview breakdown present', rulesPrev.breakdown.total === 3);

  // planEntryForAi merges an AI answer onto its row.
  const aiEntry = planEntryForAi(rows[0], { category: 'Shopping', bucket: 'WANTS', confidence: 0.8, source: 'ai' });
  ok('AI plan entry: needs_review + ai source', aiEntry && aiEntry.metadata.classification_source === 'ai' && aiEntry.metadata.needs_review === true);

  // ---- W: AI privacy payload still strips sensitive fields ---------------
  const { buildAiClassifyPayload } = TI;
  const richCand = [{ id: 'u1', normalizedMerchant: 'Arrocha', description: 'FCIA ARROCHA 1234', amount: -25, account_name: 'Secret 9999', bank_reference: 'TRN-X' }];
  const { payload } = buildAiClassifyPayload(richCand);
  ok('W: AI payload strips amount/account/bank_reference', Object.keys(payload.transactions[0]).sort().join(',') === 'amountSign,description,id,normalizedMerchant' && JSON.stringify(payload).indexOf('9999') === -1 && JSON.stringify(payload).indexOf('TRN-X') === -1);

  // ---- X: account-aware dedupe unchanged (module still behaves) -----------
  const DD = await vite.ssrLoadModule('/src/lib/dedupeTransactions.js');
  ok('X: account-aware dedupe module intact (untouched by this feature)', typeof DD.flagDuplicateActivityRows === 'function');

  // ---- V: EN/ES copy ------------------------------------------------------
  ok('V: EN scope title', EN.default.activity.scope.title === 'What should MoFlow categorize?');
  ok('V2: ES scope title', ES.default.activity.scope.title === '¿Qué deseas que MoFlow categorice?');
  ok('V3: ES unresolved-only option', ES.default.activity.scope.unresolvedOnly === 'Solo sin categoría o sin clasificar');
  ok('V4: ES apply', ES.default.activity.scope.apply === 'Aplicar categorización');
  ok('V5: ES filtered view', ES.default.activity.scope.filteredView === 'Vista filtrada actual');
  ok('V6: EN advanced warning present', typeof EN.default.activity.scope.advancedWarning === 'string' && EN.default.activity.scope.advancedWarning.length > 0);

  // ---- Y: /api unchanged --------------------------------------------------
  ok('Y: /api count remains 12', readdirSync('api').filter((f) => f.endsWith('.js')).length === 12);

  console.log(`\nCategorization scope tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await vite.close();
}

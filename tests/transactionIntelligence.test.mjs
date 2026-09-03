// Transaction Intelligence V1 — pure engine tests. FICTIONAL data only.
// Loaded through Vite SSR (pure module, no DB, no network).
//
// Run (where Node exists) from repo root:  node tests/transactionIntelligence.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const TI = await vite.ssrLoadModule('/src/lib/transactionIntelligence.js');
  const {
    normalizeMerchant, inferTransactionNature, classifyTransaction, categorizeTransaction,
    scoreClassification, classificationState, detectRecurring, findTransferPair, findRefundPair,
    sanitizeAiClassification, learnedRuleFromCorrection, buildAutoWriteMetadata, buildUserEditMetadata,
    reasonKeyForClassification,
    CONFIDENCE, THRESHOLD, UNCATEGORIZED, UNSORTED,
  } = TI;
  const RM = await vite.ssrLoadModule('/src/lib/engine/ruleMatcher.js');

  // A. Merchant normalization — noise/number/case cleanup.
  ok('A: strips store number + city', normalizeMerchant('SUPER 99 #045') === 'Super 99');
  ok('A: strips card mask', normalizeMerchant('COMPRA UBER **** 3355') === 'Uber');

  // B. Same-merchant aliases normalize consistently.
  const s1 = normalizeMerchant('SUPER99 VIA ESPANA');
  const s2 = normalizeMerchant('SUPER 99 PANAMA');
  const s3 = normalizeMerchant('super 99 #12');
  ok('B: aliases converge', s1 === 'Super 99' && s2 === 'Super 99' && s3 === 'Super 99');

  // C. User rule overrides all lower-priority rules.
  const userRules = [{
    id: 'u1', source: 'manual', match_type: 'contains', match_field: 'merchant',
    pattern: 'SUPER 99', priority: 1, assign: { category: 'Dining', budgetBucket: 'WANTS', is_transfer: null },
  }];
  const cUser = classifyTransaction({ description: 'SUPER 99 #045', merchant: 'SUPER 99', amount: -20, learned_rules: userRules });
  ok('C: user rule wins over merchant rule', cUser.category === 'Dining' && cUser.bucket === 'WANTS' && cUser.source === 'user_rule');
  ok('C: user rule confidence = 1', cUser.confidence === CONFIDENCE.USER_RULE);

  // D. Credit-card payment detection (nature).
  const ccNat = inferTransactionNature({ description: 'PAGO VISA', amount: -500 });
  ok('D: nature = credit_card_payment', ccNat.nature === 'credit_card_payment');
  const cc = classifyTransaction({ description: 'PAGO VISA', amount: -500 });
  ok('D: classify cc -> Credit Card Payment / TRANSFERS', cc.category === 'Credit Card Payment' && cc.bucket === 'TRANSFERS');

  // E. Transfer pair detection.
  const rowA = { id: 'a', amount: -200, date: '2026-09-01', account_name: 'BG Checking' };
  const rowB = { id: 'b', amount: 200, date: '2026-09-02', account_name: 'BG Savings' };
  ok('E: transfer pair found across accounts', findTransferPair(rowA, [rowA, rowB]) === rowB);
  ok('E: no pair in same account', findTransferPair(rowA, [rowA, { ...rowB, account_name: 'BG Checking' }]) === null);

  // F. Refund detection (opposite sign, same merchant, window).
  const charge = { id: 'c', amount: -80, date: '2026-08-10', merchant: 'AMAZON' };
  const refund = { id: 'r', amount: 80, date: '2026-08-20', merchant: 'AMAZON #9' };
  ok('F: refund pair found', findRefundPair(refund, [charge, refund]) === charge);
  ok('F: no refund from different merchant', findRefundPair(refund, [{ ...charge, merchant: 'NETFLIX' }, refund]) === null);

  // G. Salary detection.
  const sal = inferTransactionNature({ description: 'ACH CREDIT PAYROLL PLANILLA', amount: 3000 });
  ok('G: salary nature = income', sal.nature === 'income' && sal.reasonCode === 'salary');
  const salC = classifyTransaction({ description: 'PLANILLA EMPRESA XYZ', amount: 3000 });
  ok('G: classify salary -> Salary / INCOME', salC.category === 'Salary' && salC.bucket === 'INCOME');

  // H. Bank fee detection.
  const fee = inferTransactionNature({ description: 'COMISION CARGO POR MANEJO', amount: -5 });
  ok('H: fee nature', fee.nature === 'fee');
  const feeC = classifyTransaction({ description: 'CARGO POR MANEJO DE CUENTA', amount: -5 });
  ok('H: classify fee -> Bank Fees / NEEDS', feeC.category === 'Bank Fees' && feeC.bucket === 'NEEDS');

  // I. Recurring merchant confidence boost.
  const nearby = [
    { merchant: 'NETFLIX', date: '2026-06-15', amount: -12.99 },
    { merchant: 'NETFLIX', date: '2026-07-15', amount: -12.99 },
    { merchant: 'NETFLIX', date: '2026-08-15', amount: -12.99 },
  ];
  ok('I: detectRecurring true for monthly', detectRecurring('Netflix', nearby) === true);
  ok('I: detectRecurring false for one-off', detectRecurring('Netflix', [nearby[0]]) === false);

  // J/K/L. Confidence thresholds -> state.
  ok('J: AUTO threshold', classificationState(0.96) === 'auto' && THRESHOLD.AUTO === 0.95);
  ok('K: SUGGESTED band', classificationState(0.8) === 'suggested');
  ok('L: REVIEW band', classificationState(0.5) === 'review');

  // M. Unknown remains Uncategorized/Unsorted (review).
  const unk = classifyTransaction({ description: 'ZZZ QRS UNMATCHED THING', amount: -33 });
  ok('M: unknown -> Uncategorized/Unsorted/review', unk.category === UNCATEGORIZED && unk.bucket === UNSORTED && unk.state === 'review');

  // N. AI output rejects unknown taxonomy values.
  ok('N: rejects unknown category', sanitizeAiClassification({ category: 'crypto_moon', bucket: 'needs' }) === null);
  ok('N: rejects unknown bucket', sanitizeAiClassification({ category: 'groceries', bucket: 'yolo' }) === null);
  const aiOk = sanitizeAiClassification({ category: 'groceries', bucket: 'needs', nature: 'expense', confidence: 0.9 });
  ok('N: accepts allowed -> app values', aiOk && aiOk.category === 'Groceries' && aiOk.bucket === 'NEEDS');
  ok('N: AI confidence capped at CONFIDENCE.AI', aiOk.confidence <= CONFIDENCE.AI);

  // O. Explicit user category is not overwritten (no opt-in).
  const keep = classifyTransaction({ description: 'SUPER 99', merchant: 'SUPER 99', amount: -20, existing_category: 'Dining', existing_bucket: 'WANTS', user_set: true });
  ok('O: user-set preserved', keep.category === 'Dining' && keep.bucket === 'WANTS' && keep.source === 'user_set');
  const reled = classifyTransaction({ description: 'SUPER 99', merchant: 'SUPER 99', amount: -20, existing_category: 'Dining', existing_bucket: 'WANTS', user_set: true, reclassify: true });
  ok('O: reclassify opt-in re-runs engine', reled.source !== 'user_set');

  // S. Deterministic for same input.
  const in1 = { description: 'PAGO VISA', amount: -100 };
  ok('S: deterministic same output', JSON.stringify(classifyTransaction(in1)) === JSON.stringify(classifyTransaction(in1)));

  // Canonical values are app-native (untranslated) — no Spanish leaks into engine output.
  ok('R: canonical category untranslated', cc.category === 'Credit Card Payment' && !/Tarjeta/.test(cc.category));
  ok('R: canonical bucket uppercase code', ['NEEDS','WANTS','SAVINGS','INCOME','TRANSFERS','DEBT_FUNDING','Unsorted'].includes(cc.bucket));

  // learnedRuleFromCorrection shape (source='learned', exact merchant).
  const lr = learnedRuleFromCorrection({ normalizedMerchant: 'Super 99', category: 'Groceries', bucket: 'NEEDS' });
  ok('learned rule shape', lr && lr.source === 'learned' && lr.match_type === 'exact' && lr.match_field === 'merchant' && lr.pattern === 'Super 99' && lr.budget_bucket === 'NEEDS');
  ok('learned rule rejects incomplete', learnedRuleFromCorrection({ normalizedMerchant: '', category: 'X', bucket: 'NEEDS' }) === null);

  // scoreClassification tiers.
  ok('score: user_rule = 1', scoreClassification({ source: 'user_rule' }) === 1);
  ok('score: merchant_rule = 0.9', scoreClassification({ source: 'merchant_rule' }) === 0.9);
  ok('score: recurring boosts merchant_rule', scoreClassification({ source: 'merchant_rule', recurring: true }) === 0.95);
  ok('score: none = 0', scoreClassification({ source: 'none' }) === 0);

  // categorizeTransaction returns null on no match (does not fabricate).
  ok('categorize null on no match', categorizeTransaction({ merchant: 'ZZZQRS', description: 'ZZZQRS', amount: -1 }) === null);

  // ---- Persistence foundation (section 14) ----

  // A. Historical categorized legacy row is PROTECTED (legacy + not needs_review).
  const legacyKept = classifyTransaction({ description: 'SUPER 99', merchant: 'SUPER 99', amount: -20, existing_category: 'Groceries', existing_bucket: 'NEEDS', classification_source: 'legacy', needs_review: false });
  ok('A: legacy resolved row protected', legacyKept.category === 'Groceries' && legacyKept.bucket === 'NEEDS' && legacyKept.source === 'legacy');

  // B. Legacy Uncategorized/Unsorted row CAN be classified (not protected).
  const legacyOpen = classifyTransaction({ description: 'PAGO VISA', amount: -100, existing_category: 'Uncategorized', existing_bucket: 'Unsorted', classification_source: 'legacy', needs_review: true });
  ok('B: legacy unresolved classifiable', legacyOpen.category === 'Credit Card Payment' && legacyOpen.source === 'deterministic');

  // C. user_categorized row is protected.
  const uc = classifyTransaction({ description: 'PAGO VISA', amount: -100, existing_category: 'Dining', existing_bucket: 'WANTS', user_categorized: true, classification_source: 'user' });
  ok('C: user_categorized protected', uc.category === 'Dining' && uc.source === 'user_set');

  // D. classification_source='user' is protected even without user_categorized flag.
  const usrc = classifyTransaction({ description: 'PAGO VISA', amount: -100, existing_category: 'Dining', existing_bucket: 'WANTS', classification_source: 'user' });
  ok('D: classification_source=user protected', usrc.category === 'Dining' && usrc.source === 'user_set');

  // E. reclassify=true allows explicit reclassification of a protected row.
  const forced = classifyTransaction({ description: 'PAGO VISA', amount: -100, existing_category: 'Dining', existing_bucket: 'WANTS', classification_source: 'user', reclassify: true });
  ok('E: reclassify overrides protection', forced.category === 'Credit Card Payment' && forced.source === 'deterministic');

  // F. manual rule > learned rule.
  const staticList = [{ id: 's_grocery', matchAny: ['SUPER 99'], assign: { category: 'Groceries', budgetBucket: 'NEEDS', is_transfer: false } }];
  const manualRule = { id: 'm1', source: 'manual', match_type: 'contains', match_field: 'merchant', pattern: 'SUPER 99', priority: 1, assign: { category: 'Dining', budgetBucket: 'WANTS', is_transfer: null } };
  const learnedRule = { id: 'l1', source: 'learned', match_type: 'exact', match_field: 'merchant', pattern: 'SUPER 99', priority: 50, assign: { category: 'Shopping', budgetBucket: 'WANTS', is_transfer: null } };
  const mVl = RM.classifyTransaction({ merchant: 'SUPER 99', description: 'SUPER 99', amount: -10 }, staticList, [manualRule, learnedRule]);
  ok('F: manual beats learned', mVl.kind === 'manual' && mVl.rule.assign.category === 'Dining');

  // G. learned rule > migrated/static.
  const lVs = RM.classifyTransaction({ merchant: 'SUPER 99', description: 'SUPER 99', amount: -10 }, staticList, [learnedRule]);
  ok('G: learned beats static', lVs.kind === 'learned' && lVs.rule.assign.category === 'Shopping');
  // no learned rules -> unchanged static behavior (determinism preserved).
  const staticOnly = RM.classifyTransaction({ merchant: 'SUPER 99', description: 'SUPER 99', amount: -10 }, staticList, []);
  ok('G: static unchanged with no learned', staticOnly.kind === 'static' && staticOnly.rule.assign.category === 'Groceries');

  // H. learned rule payload is canonical (English/app-native).
  const lr2 = learnedRuleFromCorrection({ normalizedMerchant: 'Riba Smith', category: 'Groceries', bucket: 'NEEDS' });
  ok('H: learned payload canonical', lr2.category === 'Groceries' && lr2.budget_bucket === 'NEEDS' && !/[áéíóúñ]/.test(lr2.category));

  // I. Repeated correction for same normalized merchant -> identical unique-key
  //    fields (so an upsert updates in place, never duplicates).
  const lrA = learnedRuleFromCorrection({ normalizedMerchant: 'Super 99', category: 'Groceries', bucket: 'NEEDS' });
  const lrB = learnedRuleFromCorrection({ normalizedMerchant: 'Super 99', category: 'Dining', bucket: 'WANTS' });
  ok('I: upsert key stable across corrections', lrA.pattern === lrB.pattern && lrA.match_type === lrB.match_type && lrA.match_field === lrB.match_field);

  // J. confidence stays within 0..1 across sources.
  const confs = [legacyKept, legacyOpen, cc, salC, unk].map((r) => r.confidence);
  ok('J: confidence within [0,1]', confs.every((c) => c >= 0 && c <= 1));

  // K. No Spanish leaks into canonical metadata.
  const meta = buildAutoWriteMetadata(cc);
  ok('K: auto metadata canonical', meta.category === 'Credit Card Payment' && meta.budget_bucket === 'TRANSFERS' && meta.classification_source === 'deterministic' && !/[áéíóúñ]/.test(meta.category));
  ok('K: auto AUTO -> needs_review false', meta.needs_review === false && meta.user_categorized === false);

  // Auto metadata: REVIEW-state row keeps Uncategorized + needs_review true.
  const metaReview = buildAutoWriteMetadata(unk);
  ok('auto REVIEW keeps uncategorized + flagged', metaReview.category === UNCATEGORIZED && metaReview.needs_review === true && metaReview.classification_source === 'import');

  // User-edit metadata payload.
  const ue = buildUserEditMetadata({ category: 'Groceries', bucket: 'NEEDS' });
  ok('user-edit metadata', ue.classification_source === 'user' && ue.user_categorized === true && ue.needs_review === false && ue.classification_confidence === 1);
  ok('user-edit omits nature unless given', ue.transaction_nature === undefined);

  // classification_source mapping for learned vs merchant.
  const learnedClass = classifyTransaction({ merchant: 'SUPER 99', description: 'SUPER 99', amount: -10, learned_rules: [learnedRule] });
  ok('learned -> learned_rule source', buildAutoWriteMetadata(learnedClass).classification_source === 'learned_rule');

  // J. Historical 'manual' compatibility: a resolved manual/legacy row (the live
  //    default) is protected exactly like a resolved legacy row.
  const manualHist = classifyTransaction({ description: 'PAGO VISA', amount: -100, existing_category: 'Groceries', existing_bucket: 'NEEDS', classification_source: 'manual', needs_review: false });
  ok('J: resolved manual row protected', manualHist.category === 'Groceries' && manualHist.source === 'legacy');
  const manualOpen = classifyTransaction({ description: 'PAGO VISA', amount: -100, existing_category: 'Uncategorized', existing_bucket: 'Unsorted', classification_source: 'manual', needs_review: false });
  ok('J: unresolved manual row classifiable', manualOpen.category === 'Credit Card Payment' && manualOpen.source === 'deterministic');

  // F. Review reason is derived from PERSISTED source/nature only — it cannot
  //    contradict the stored classification, and shows no internal codes.
  ok('F: user source -> userSet reason', reasonKeyForClassification('user', null) === 'userSet');
  ok('F: merchant_rule -> merchantRule (nature ignored)', reasonKeyForClassification('merchant_rule', 'transfer') === 'merchantRule');
  ok('F: learned_rule -> learnedRule', reasonKeyForClassification('learned_rule', null) === 'learnedRule');
  ok('F: deterministic cc -> creditCardPayment', reasonKeyForClassification('deterministic', 'credit_card_payment') === 'creditCardPayment');
  ok('F: import -> noMatch', reasonKeyForClassification('import', null) === 'noMatch');
  ok('F: reason keys are not internal source codes', !['merchant_rule', 'learned_rule', 'deterministic'].includes(reasonKeyForClassification('merchant_rule', null)));

  // O. No duplicate metadata fields: helpers emit classification_* only.
  const autoKeys = Object.keys(buildAutoWriteMetadata(cc));
  const editKeys = Object.keys(buildUserEditMetadata({ category: 'Groceries', bucket: 'NEEDS' }));
  ok('O: auto classification_* not category_*', autoKeys.includes('classification_source') && autoKeys.includes('classification_confidence') && !autoKeys.includes('category_source') && !autoKeys.includes('category_confidence'));
  ok('O: edit classification_* not category_*', editKeys.includes('classification_source') && editKeys.includes('classification_confidence') && !editKeys.includes('category_source') && !editKeys.includes('category_confidence'));
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

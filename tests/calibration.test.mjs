// Transaction Intelligence Calibration V1 — pure, READ-ONLY analysis tests.
// FICTIONAL data only. Loaded through Vite SSR (no DB, no network, no AI).
//
// Run (where Node exists) from repo root:  node tests/calibration.test.mjs
import { createServer } from 'vite';
import { readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const CAL = await vite.ssrLoadModule('/src/lib/calibration.js');
  const TR = await vite.ssrLoadModule('/src/lib/transactionRules.js');
  const {
    runCalibration, isTrustedGroundTruth, hasInputSignal,
    OUTCOME, ERROR_BUCKET, CALIBRATION_SAMPLE_SIZES,
  } = CAL;
  const { classifyForInsert } = TR;

  const rows = [
    { id: 'm1', merchant: 'ARROCHA', description: 'FCIA ARROCHA', amount: -25, category: 'Uncategorized', budget_bucket: 'Unsorted' },
    { id: 'd1', merchant: 'PAGO VISA', description: 'PAGO VISA THANK YOU', amount: -500, category: 'Uncategorized', budget_bucket: 'Unsorted' },
    { id: 'a1', merchant: 'CAFE DESCONOCIDO XYZ', description: 'CAFE DESCONOCIDO XYZ', amount: -6, category: 'Uncategorized', budget_bucket: 'Unsorted' },
    { id: 'c1', merchant: '', description: '', amount: -1, category: 'Uncategorized', budget_bucket: 'Unsorted' },
    // trusted + engine reproduces it (Arrocha -> Medical/Health)
    { id: 't1', merchant: 'ARROCHA', description: 'FCIA ARROCHA', amount: -30, category: 'Medical/Health', budget_bucket: 'NEEDS', user_categorized: true, classification_source: 'user' },
    // trusted + engine MISSES it (unknown merchant, human labeled Shopping/WANTS) -> unresolved shadow prediction
    { id: 't2', merchant: 'TIENDA LOCAL RARA', description: 'TIENDA LOCAL RARA', amount: -40, category: 'Shopping', budget_bucket: 'WANTS', user_categorized: true, classification_source: 'user' },
    // legacy 'manual' resolved -> protected but NOT trusted ground truth
    { id: 'l1', merchant: 'SOMETHING', description: 'SOMETHING', amount: -9, category: 'Groceries', budget_bucket: 'NEEDS', classification_source: 'manual', needs_review: false },
  ];

  const snapshot = JSON.stringify(rows);
  const report = runCalibration(rows, [], { repeatThreshold: 3 });
  const byId = Object.fromEntries(report.rows.map((r) => [r.id, r]));

  // O. no writes / no mutation of input rows.
  ok('O: calibration performs NO writes (rows unmutated)', JSON.stringify(rows) === snapshot);

  // A. trusted user row remains OPERATIONALLY protected.
  ok('A: trusted user row protectedOperationally + outcome PROTECTED', byId.t1.protectedOperationally === true && byId.t1.outcome === OUTCOME.PROTECTED);
  // B. same trusted row IS included in the shadow benchmark (not a contradiction).
  ok('B: trusted user row includedInBenchmark', byId.t1.includedInBenchmark === true && byId.t2.includedInBenchmark === true);

  // C–F. Fresh prediction receives NO stored-answer leakage: identical inputs +
  // different stored fields => identical prediction.
  const base = { merchant: 'ARROCHA', description: 'FCIA ARROCHA', amount: -25 };
  const p1 = classifyForInsert(base, []).classification;
  const p2 = classifyForInsert({
    ...base,
    category: 'ZZZ WRONG', budget_bucket: 'WANTS',              // C, D
    user_categorized: true,                                     // E
    classification_source: 'user', classification_confidence: 0.99, needs_review: false, // F
  }, []).classification;
  ok('C: stored category does not change fresh prediction', p1.category === p2.category && p1.category === 'Medical/Health');
  ok('D: stored bucket does not change fresh prediction', p1.bucket === p2.bucket && p1.bucket === 'NEEDS');
  ok('E: user_categorized does not change fresh prediction', p1.source === p2.source);
  ok('F: classification_source/confidence/needs_review do not change fresh prediction', p1.state === p2.state && p1.confidence === p2.confidence);

  // trust rules (B/C/M of the original list; M here).
  ok('trust: user_categorized trusted', isTrustedGroundTruth(rows[4]) === true);
  ok('trust: source=user trusted', isTrustedGroundTruth({ classification_source: 'user' }) === true);
  ok('M: legacy/manual NOT trusted', isTrustedGroundTruth(rows[6]) === false);

  // operational grouping + rates exclude protected.
  ok('operational: resolved/ai/unresolved outcomes', byId.m1.outcome === OUTCOME.RESOLVED && byId.d1.outcome === OUTCOME.RESOLVED && byId.a1.outcome === OUTCOME.AI_CANDIDATE && byId.c1.outcome === OUTCOME.UNRESOLVED);
  ok('operational: source labels', byId.m1.source === 'merchant_rule' && byId.d1.source === 'deterministic' && byId.a1.source === 'ai');
  ok('operational: protected count = 3', report.operational.protected === 3);
  ok('operational: rates over non-protected sum to 100', (report.operational.rates.resolved + report.operational.rates.aiCandidate + report.operational.rates.unresolved) === 100);

  // G/H. trusted correct vs incorrect category.
  ok('G: trusted correct category counted', byId.t1.categoryMatch === true && byId.t1.bucketMatch === true && byId.t1.fullMatch === true);
  ok('H: trusted incorrect category counted', byId.t2.categoryMatch === false && byId.t2.bucketMatch === false && byId.t2.fullMatch === false);

  // I. unresolved shadow prediction is NOT removed from the accuracy denominator.
  ok('I: t2 (unresolved shadow) is in the denominator as WRONG', byId.t2.includedInBenchmark === true && byId.t2.categoryMatch === false);

  // J/K/L. explicit denominators.
  const bench = report.benchmark;
  ok('J: category accuracy explicit denominator', bench.categoryAccuracy.correct === 1 && bench.categoryAccuracy.denominator === 2 && bench.categoryAccuracy.pct === 50);
  ok('K: bucket accuracy explicit denominator', bench.bucketAccuracy.correct === 1 && bench.bucketAccuracy.denominator === 2 && bench.bucketAccuracy.pct === 50);
  ok('L: full-pair accuracy explicit denominator', bench.fullPairAccuracy.correct === 1 && bench.fullPairAccuracy.denominator === 2 && bench.fullPairAccuracy.pct === 50);
  ok('benchmark: groundTruthCount=2, predictedCount=2, unpredictable=0', bench.groundTruthCount === 2 && bench.predictedCount === 2 && bench.unpredictableCount === 0);

  // Unpredictable trusted row (no input signal) is excluded from the denominator,
  // NOT counted as a wrong guess.
  const withUnpredictable = runCalibration([
    { id: 'up', merchant: '', description: '', amount: -1, category: 'Groceries', budget_bucket: 'NEEDS', user_categorized: true, classification_source: 'user' },
    { id: 'ok', merchant: 'ARROCHA', description: 'FCIA ARROCHA', amount: -5, category: 'Medical/Health', budget_bucket: 'NEEDS', user_categorized: true, classification_source: 'user' },
  ], []);
  ok('unpredictable: excluded from denom (groundTruth 2, predicted 1, unpredictable 1)', withUnpredictable.benchmark.groundTruthCount === 2 && withUnpredictable.benchmark.predictedCount === 1 && withUnpredictable.benchmark.unpredictableCount === 1);
  ok('unpredictable: category denom = 1 (only the predictable one)', withUnpredictable.benchmark.categoryAccuracy.denominator === 1 && withUnpredictable.benchmark.categoryAccuracy.pct === 100);
  ok('hasInputSignal helper', hasInputSignal({ merchant: 'X' }) === true && hasInputSignal({ merchant: '', description: '' }) === false);

  // N. zero-trusted sample -> N/A (null), not misleading 0%.
  const noTrusted = runCalibration([
    { id: 'x', merchant: 'CAFE X', description: 'CAFE X', amount: -3, category: 'Uncategorized', budget_bucket: 'Unsorted' },
  ], []);
  ok('N: zero-trusted -> accuracy pct null (N/A)', noTrusted.benchmark.groundTruthCount === 0 && noTrusted.benchmark.categoryAccuracy.pct === null && noTrusted.benchmark.fullPairAccuracy.pct === null);

  // error buckets.
  ok('error bucket: single unknown-merchant miss -> AI_CANDIDATE', byId.a1.errorBucket === ERROR_BUCKET.AI_CANDIDATE);
  ok('error bucket: no-signal miss -> AMBIGUOUS_NEEDS_USER', byId.c1.errorBucket === ERROR_BUCKET.AMBIGUOUS_NEEDS_USER);
  const detMiss = runCalibration([
    { id: 'dt', merchant: 'RANDOM CO', description: 'RANDOM CO', amount: -100, category: 'Transfer', budget_bucket: 'TRANSFERS', user_categorized: true, classification_source: 'user' },
  ], []);
  ok('error bucket: trusted deterministic-truth miss -> SHOULD_BE_DETERMINISTIC', detMiss.rows[0].errorBucket === ERROR_BUCKET.SHOULD_BE_DETERMINISTIC);

  // repeated-miss discovery + LEARNABLE upgrade.
  const repeat = runCalibration([
    { id: 'r1', merchant: 'CAFE UNIDO', description: 'CAFE UNIDO', amount: -4, category: 'Uncategorized', budget_bucket: 'Unsorted' },
    { id: 'r2', merchant: 'CAFE UNIDO', description: 'CAFE UNIDO', amount: -5, category: 'Uncategorized', budget_bucket: 'Unsorted' },
    { id: 'r3', merchant: 'CAFE UNIDO', description: 'CAFE UNIDO', amount: -6, category: 'Uncategorized', budget_bucket: 'Unsorted' },
  ], [], { repeatThreshold: 3 });
  ok('repeated miss aggregated + LEARNABLE_USER_PATTERN', repeat.topMissMerchants.find((m) => m.merchant === 'Cafe Unido')?.count === 3 && repeat.errorBuckets.LEARNABLE_USER_PATTERN === 3);

  // P. no Gemini/network — calibration must not touch fetch.
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network call not allowed in calibration'); };
  let networkThrew = false;
  try { runCalibration(rows, []); } catch { networkThrew = true; }
  globalThis.fetch = savedFetch;
  ok('P: no network/Gemini call during calibration', networkThrew === false);

  // Q/L(privacy). No sensitive fields in the diagnostic output.
  const dump = JSON.stringify(report);
  ok('Q: no sensitive substrings in output', !/bank_reference|account_name|account_number|balance|"amount"|description_raw/i.test(dump));
  ok('Q2: per-row output is flags + id + label only (no category/bucket values)', report.rows.every((r) => {
    const keys = Object.keys(r).sort().join(',');
    return keys === 'bucketMatch,categoryMatch,errorBucket,fullMatch,hasInputSignal,id,includedInBenchmark,isMiss,label,outcome,protectedOperationally,source,trusted';
  }));

  // M(sample sizes) + R(/api).
  ok('bounded sample sizes', JSON.stringify(CALIBRATION_SAMPLE_SIZES) === JSON.stringify([100, 250, 500]));
  ok('R: /api count remains 12', readdirSync('api').filter((f) => f.endsWith('.js')).length === 12);

  console.log(`\nCalibration tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await vite.close();
}

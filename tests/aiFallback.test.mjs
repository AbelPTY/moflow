// Transaction Intelligence V1.2 — AI fallback tests. Pure + injected-fetch, no
// real network, no DB. FICTIONAL data only. Loaded through Vite SSR.
//
// Run (where Node exists) from repo root:  node tests/aiFallback.test.mjs
import { createServer } from 'vite';
import { readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const TI = await vite.ssrLoadModule('/src/lib/transactionIntelligence.js');
  const TR = await vite.ssrLoadModule('/src/lib/transactionRules.js');
  const EN = await vite.ssrLoadModule('/src/i18n/en-US.js');
  const ES = await vite.ssrLoadModule('/src/i18n/es-PA.js');
  const {
    cleanDescriptionForAi, buildAiClassifyPayload, sanitizeAiBatch, amountSignOf,
    AI_MAX_BATCH, reasonKeyForClassification, CONFIDENCE,
    buildUserEditMetadata, learnedRuleFromCorrection,
  } = TI;
  const {
    selectAiReviewCandidates, aiClassifyReviewRows, aiMetadataFor,
  } = TR;

  // A fake fetch that returns a given classifications payload (or a failure).
  const fetchReturning = (classifications, { ok: httpOk = true } = {}) =>
    async () => ({ ok: httpOk, json: async () => ({ classifications }) });

  // --- Selection: only REVIEW + unprotected rows are AI-eligible ----------
  const rows = [
    { id: 'rev', merchant: 'FERRETERIA DESCONOCIDA XYZ', description: 'FERRETERIA DESCONOCIDA XYZ', amount: -12 }, // review
    { id: 'auto', merchant: 'PAGO VISA', description: 'PAGO VISA THANK YOU', amount: -500 },                        // deterministic AUTO
    { id: 'sugg', merchant: 'ARROCHA', description: 'FCIA ARROCHA', amount: -25 },                                  // merchant SUGGESTED
    { id: 'prot', merchant: 'WHATEVER', description: 'WHATEVER', amount: -9, classification_source: 'manual', needs_review: false, category: 'Groceries', budget_bucket: 'NEEDS' }, // protected
  ];
  const userRuleRow = { id: 'user', merchant: 'MY CLUB', description: 'MY CLUB', amount: -30 };
  const manualRule = [{ id: 'u1', source: 'manual', match_type: 'contains', match_field: 'merchant', pattern: 'MY CLUB', priority: 1, assign: { category: 'Shopping', budgetBucket: 'WANTS', is_transfer: null } }];
  const learnedRule = [{ id: 'l1', source: 'learned', match_type: 'contains', match_field: 'merchant', pattern: 'MY CLUB', priority: 50, assign: { category: 'Entertainment', budgetBucket: 'WANTS', is_transfer: false } }];

  const cand = selectAiReviewCandidates(rows, []);
  const candIds = cand.map((c) => c.id);
  ok('A: REVIEW row selected for AI', candIds.includes('rev'));
  ok('B: AUTO row never sent', !candIds.includes('auto'));
  ok('C: deterministic/merchant SUGGESTED row never sent', !candIds.includes('sugg'));
  ok('D: user-rule row never sent', selectAiReviewCandidates([userRuleRow], manualRule).length === 0);
  ok('E: learned-rule row never sent', selectAiReviewCandidates([userRuleRow], learnedRule).length === 0);
  ok('F: protected legacy/manual row never sent', !candIds.includes('prot'));

  // --- Privacy: payload strips everything except the 4 allowed fields -----
  const rich = [{
    id: 'p1', normalizedMerchant: 'Arrocha',
    description: 'COMPRA VISA FCIA ARROCHA 1234 REF 998877',
    amount: -84.37, account_name: 'BAC Checking 4021', account_number: '000123456',
    bank_reference: 'TRN-556677', user_id: 'uuid-secret', source_account: 'savings',
  }];
  const { payload } = buildAiClassifyPayload(rich);
  const tx0 = payload.transactions[0];
  const txKeys = Object.keys(tx0).sort().join(',');
  ok('G: payload strips amount value', !('amount' in tx0) && JSON.stringify(payload).indexOf('84.37') === -1);
  ok('H: payload strips account fields', JSON.stringify(payload).indexOf('4021') === -1 && JSON.stringify(payload).indexOf('000123456') === -1 && !('account_name' in tx0));
  ok('I: payload strips bank_reference + user_id', JSON.stringify(payload).indexOf('556677') === -1 && JSON.stringify(payload).indexOf('uuid-secret') === -1);
  ok('I2: payload exposes ONLY id/normalizedMerchant/description/amountSign', txKeys === 'amountSign,description,id,normalizedMerchant');
  ok('I3: amountSign, not amount', tx0.amountSign === 'negative' && amountSignOf(50) === 'positive');

  // J. cleaned description removes numeric/reference noise, keeps merchant words.
  const cleaned = cleanDescriptionForAi('COMPRA VISA FCIA ARROCHA 1234 REF 998877 **** 4021');
  ok('J: cleaned drops long digits + refs', !/1234|998877|4021/.test(cleaned) && /ARROCHA/i.test(cleaned));
  ok('J2: cleaned keeps short brand numbers (Super 99)', /99/.test(cleanDescriptionForAi('SUPER 99 VIA ESPANA')));

  // K. batch capped at 50.
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, normalizedMerchant: `Merchant ${i}`, description: `Merchant ${i}`, amount: -1 }));
  ok('K: batch hard-capped at 50', buildAiClassifyPayload(many).payload.transactions.length === AI_MAX_BATCH);
  ok('K2: AI_MAX_BATCH is 50', AI_MAX_BATCH === 50);

  // L. duplicate unresolved merchants deduped to a single request.
  const dupes = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, normalizedMerchant: 'Arrocha', description: 'FCIA ARROCHA', amount: -10 }));
  const dPayload = buildAiClassifyPayload(dupes);
  ok('L: duplicate merchants deduped to 1 request', dPayload.payload.transactions.length === 1);
  ok('L2: dedupe map covers all 5 ids', Object.values(dPayload.dedupe)[0].length === 5);

  // M. valid AI result sanitized to app taxonomy + capped.
  const good = sanitizeAiBatch({ classifications: [{ id: 'x', nature: 'expense', category: 'dining', bucket: 'wants', confidence: 0.78 }] }, new Set(['x']));
  ok('M: valid result sanitized to app values', good.length === 1 && good[0].classification.category === 'Dining' && good[0].classification.bucket === 'WANTS' && good[0].classification.source === 'ai');

  // N/O/P. invented taxonomy rejected.
  ok('N: invented category rejected', sanitizeAiBatch({ classifications: [{ id: 'x', category: 'crypto', bucket: 'wants', confidence: 0.7 }] }, new Set(['x'])).length === 0);
  ok('O: invented bucket rejected', sanitizeAiBatch({ classifications: [{ id: 'x', category: 'dining', bucket: 'fun', confidence: 0.7 }] }, new Set(['x'])).length === 0);
  ok('P: invented nature rejected', sanitizeAiBatch({ classifications: [{ id: 'x', nature: 'vibes', category: 'dining', bucket: 'wants', confidence: 0.7 }] }, new Set(['x'])).length === 0);
  ok('P2: id not in submitted set rejected', sanitizeAiBatch({ classifications: [{ id: 'nope', category: 'dining', bucket: 'wants', confidence: 0.7 }] }, new Set(['x'])).length === 0);
  ok('P3: duplicate id kept once', sanitizeAiBatch({ classifications: [{ id: 'x', category: 'dining', bucket: 'wants', confidence: 0.7 }, { id: 'x', category: 'groceries', bucket: 'needs', confidence: 0.7 }] }, new Set(['x'])).length === 1);

  // Q. confidence 0.99 capped to 0.80.
  const capped = sanitizeAiBatch({ classifications: [{ id: 'x', nature: 'expense', category: 'dining', bucket: 'wants', confidence: 0.99 }] }, new Set(['x']));
  ok('Q: confidence capped at 0.80', capped[0].classification.confidence === 0.8);
  ok('Q2: AI can never reach AUTO threshold', capped[0].classification.confidence < 0.95 && capped[0].classification.state === 'suggested');

  // R/S/T. AI persistence metadata.
  const meta = aiMetadataFor(capped[0].classification, 'Arrocha');
  ok('R: AI result persists needs_review=true', meta.needs_review === true);
  ok('S: AI result persists classification_source=ai', meta.classification_source === 'ai');
  ok('T: AI result never user_categorized', meta.user_categorized === false);
  ok('T2: AI confidence stored <= 0.80', meta.classification_confidence <= 0.8);
  ok('T3: AI writes the suggested category/bucket', meta.category === 'Dining' && meta.budget_bucket === 'WANTS' && meta.normalized_merchant === 'Arrocha');

  // U. AI HTTP failure -> safe review fallback (all null, ok:false).
  const uCand = [{ id: 'u1', normalizedMerchant: 'Unknown A', description: 'Unknown A', amount: -5 }];
  const uRes = await aiClassifyReviewRows(uCand, { fetchImpl: fetchReturning([], { ok: false }) });
  ok('U: AI failure -> null result + ok:false', uRes.byId.u1 === null && uRes.ok === false && uRes.aiCount === 0);
  const eRes = await aiClassifyReviewRows(uCand, { fetchImpl: async () => { throw new Error('network'); } });
  ok('U2: AI throw -> safe fallback', eRes.byId.u1 === null && eRes.ok === false);

  // V. partial batch failure: present ids classified, missing ids stay null.
  const vCand = [
    { id: 'v1', normalizedMerchant: 'Alpha Store', description: 'Alpha Store', amount: -5 },
    { id: 'v2', normalizedMerchant: 'Beta Shop', description: 'Beta Shop', amount: -6 },
  ];
  const vRes = await aiClassifyReviewRows(vCand, {
    fetchImpl: fetchReturning([{ id: 'v1', nature: 'expense', category: 'shopping', bucket: 'wants', confidence: 0.7 }]),
  });
  ok('V: partial batch classifies present id', vRes.byId.v1 && vRes.byId.v1.category === 'Shopping');
  ok('V2: partial batch leaves missing id null', vRes.byId.v2 === null && vRes.ok === true && vRes.aiCount === 1);

  // dedupe expansion across ids on the network path.
  const dRes = await aiClassifyReviewRows(dupes, {
    fetchImpl: fetchReturning([{ id: 'd0', nature: 'expense', category: 'healthcare', bucket: 'needs', confidence: 0.7 }]),
  });
  ok('L3: one AI answer expands to all deduped ids', Object.keys(dRes.byId).every((k) => dRes.byId[k] && dRes.byId[k].category === 'Healthcare') && dRes.aiCount === 5);

  // W. Accept converts an AI suggestion to a user classification.
  const accepted = buildUserEditMetadata({ category: 'Dining Out', bucket: 'WANTS' });
  ok('W: Accept -> user/1.0/user_categorized/no-review', accepted.classification_source === 'user' && accepted.classification_confidence === 1 && accepted.user_categorized === true && accepted.needs_review === false);

  // X. learned rule ONLY on explicit Remember (AI never auto-creates one).
  ok('X: AI metadata creates NO learned rule (source stays ai)', meta.classification_source === 'ai');
  ok('X2: explicit Remember builds a learned rule', (() => { const r = learnedRuleFromCorrection({ normalizedMerchant: 'Arrocha', category: 'Medical/Health', bucket: 'NEEDS' }); return r && r.source === 'learned'; })());

  // Y. EN/ES AI-assisted label + reason mapping.
  ok('Y: reason key for ai source', reasonKeyForClassification('ai') === 'aiSuggested');
  ok('Y2: EN label', EN.default.txIntel.reasons.aiSuggested === 'AI-assisted suggestion');
  ok('Y3: ES label', ES.default.txIntel.reasons.aiSuggested === 'Sugerencia asistida por IA');

  // Z. /api still exactly 12 endpoints.
  const apiCount = readdirSync('api').filter((f) => f.endsWith('.js')).length;
  ok('Z: /api count remains 12', apiCount === 12);

  console.log(`\nAI fallback tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await vite.close();
}

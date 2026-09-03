// Panama Merchant Intelligence V1.1 — pure engine tests. FICTIONAL/PUBLIC
// merchant names only (reusable market knowledge, no personal identifiers).
// Verifies: (1) bank-statement variants converge to one normalized merchant,
// (2) known Panama merchants classify to the EXISTING app category/bucket,
// (3) short/ambiguous tokens do NOT collide with unrelated descriptions,
// (4) user/learned rules still override the built-in mapping,
// (5) classification is deterministic + repeatable.
//
// Run (where Node exists) from repo root:  node tests/panamaMerchants.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const TI = await vite.ssrLoadModule('/src/lib/transactionIntelligence.js');
  const {
    normalizeMerchant, classifyTransaction, panamaMerchantCategory,
    CONFIDENCE, UNCATEGORIZED, UNSORTED,
  } = TI;

  // Classify a purchase-style row (negative amount, merchant == description).
  const c = (desc, amount = -25, extra = {}) =>
    classifyTransaction({ description: desc, merchant: desc, amount, ...extra });
  const norm = (d) => normalizeMerchant(d);
  // Assert a description maps to a normalized merchant + category + bucket, is a
  // merchant_rule (suggested) match, and repeats identically.
  const expect = (label, desc, merchant, category, bucket) => {
    const r1 = c(desc); const r2 = c(desc);
    ok(`${label}: normalized -> ${merchant}`, r1.normalizedMerchant === merchant);
    ok(`${label}: ${category}/${bucket}`, r1.category === category && r1.bucket === bucket);
    ok(`${label}: source merchant_rule + generic reason`, r1.source === 'merchant_rule' && r1.reasons.includes('merchantRule'));
    ok(`${label}: deterministic repeat`, r1.category === r2.category && r1.bucket === r2.bucket && r1.normalizedMerchant === r2.normalizedMerchant);
  };

  // ---- 1. ARROCHA (the explicit focus) -----------------------------------
  const arrVariants = ['FCIA ARROCHA', 'FARMACIA ARROCHA', 'ARROCHA #12', 'ARROCHA PHARMACY', 'COMPRA VISA FCIA ARROCHA 1234'];
  const arr = arrVariants.map((v) => c(v));
  ok('ARROCHA: all variants normalize to "Arrocha"', arr.every((r) => r.normalizedMerchant === 'Arrocha'));
  ok('ARROCHA: all -> Medical/Health + NEEDS', arr.every((r) => r.category === 'Medical/Health' && r.bucket === 'NEEDS'));
  ok('ARROCHA: all -> same source', arr.every((r) => r.source === 'merchant_rule'));

  // ---- 2. Groceries ------------------------------------------------------
  ok('SUPER 99 variants converge', ['SUPER99', 'SUPER 99 #045', 'SUPER 99 PANAMA'].every((v) => norm(v) === 'Super 99'));
  expect('SUPER 99', 'SUPER 99 #045 PANAMA', 'Super 99', 'Groceries', 'NEEDS');
  ok('RIBA SMITH variants converge', ['RIBA SMITH', 'RIBA SMITH S A', 'RIBASMITH'].every((v) => norm(v) === 'Riba Smith'));
  expect('RIBA SMITH', 'RIBA SMITH S A', 'Riba Smith', 'Groceries', 'NEEDS');
  ok('REY variants converge', ['SUPERMERCADO REY', 'SUPERMERCADOS REY', 'EL REY', 'REY #045', 'REY PANAMA'].every((v) => norm(v) === 'Rey'));
  expect('REY', 'SUPERMERCADO REY #045', 'Rey', 'Groceries', 'NEEDS');
  ok('PRICESMART variants converge', ['PRICESMART PANAMA', 'PRICE SMART', 'PRICESMART #7'].every((v) => norm(v) === 'PriceSmart'));
  expect('PRICESMART', 'PRICESMART PANAMA', 'PriceSmart', 'Groceries', 'NEEDS');

  // ---- 3. Utilities ------------------------------------------------------
  expect('ENSA', 'PAGO ENSA', 'ENSA', 'Household/Utilities', 'NEEDS');
  expect('NATURGY', 'NATURGY PANAMA', 'Naturgy', 'Household/Utilities', 'NEEDS');
  expect('IDAAN', 'IDAAN', 'IDAAN', 'Household/Utilities', 'NEEDS');
  ok('CABLE & WIRELESS variants converge', ['C&W', 'CABLE & WIRELESS', 'CABLE WIRELESS PANAMA'].every((v) => norm(v) === 'Cable & Wireless'));
  expect('CABLE & WIRELESS', 'CABLE & WIRELESS', 'Cable & Wireless', 'Household/Utilities', 'NEEDS');
  ok('+MOVIL variants converge', ['MAS MOVIL', '+MOVIL', 'MASMOVIL'].every((v) => norm(v) === '+Móvil'));
  expect('+MOVIL', 'MAS MOVIL', '+Móvil', 'Household/Utilities', 'NEEDS');

  // ---- 4. Fuel -----------------------------------------------------------
  expect('TERPEL', 'TERPEL EL DORADO', 'Terpel', 'Fuel', 'NEEDS');
  expect('TEXACO', 'TEXACO VIA ESPANA', 'Texaco', 'Fuel', 'NEEDS');
  expect('DELTA', 'DELTA COSTA VERDE', 'Delta', 'Fuel', 'NEEDS');
  expect('PUMA', 'PUMA TOCUMEN', 'Puma', 'Fuel', 'NEEDS');

  // ---- 5. Insurance ------------------------------------------------------
  expect('ASSA', 'ASSA COMPANIA DE SEGUROS', 'ASSA', 'Insurance', 'NEEDS');
  expect('MAPFRE', 'MAPFRE PANAMA', 'Mapfre', 'Insurance', 'NEEDS');

  // ---- 6. Transportation -------------------------------------------------
  expect('PANAPASS', 'APP PANAPASS', 'Panapass', 'Transportation', 'NEEDS');
  expect('UBER', 'UBER TRIP', 'Uber', 'Transportation', 'NEEDS');
  expect('METROBUS', 'METROBUS RECARGA', 'Metrobus', 'Transportation', 'NEEDS');
  expect('CORREDOR', 'PEAJE CORREDOR SUR', 'Corredor', 'Transportation', 'NEEDS');

  // ---- 7. Dining ---------------------------------------------------------
  expect('MCDONALDS', 'MCDONALDS ALBROOK', "McDonald's", 'Dining Out', 'WANTS');
  expect('STARBUCKS', 'STARBUCKS MULTIPLAZA', 'Starbucks', 'Dining Out', 'WANTS');
  expect('KFC', 'KFC VIA ESPANA', 'KFC', 'Dining Out', 'WANTS');
  expect('DOMINOS', "DOMINO'S PIZZA", "Domino's", 'Dining Out', 'WANTS');
  ok('UBER EATS != UBER (dining, not transport)', c('UBER EATS').category === 'Dining Out' && c('UBER EATS').normalizedMerchant === 'Uber Eats');

  // ---- 8. Bank-description cleanup does not erase merchant identity -------
  ok('cleanup: COMPRA VISA FCIA ARROCHA 1234 -> Arrocha', norm('COMPRA VISA FCIA ARROCHA 1234') === 'Arrocha');
  ok('cleanup: POS SUPER 99 #045 PANAMA -> Super 99', norm('POS SUPER 99 #045 PANAMA') === 'Super 99');
  ok('cleanup: stacked lead noise -> Terpel', norm('COMPRA POS VISA TERPEL 998877') === 'Terpel');

  // ---- 9. FALSE-POSITIVE safety (boundary-aware; must NOT match) ----------
  const notRey = c('REYES AUTO IMPORT', -40);
  ok('neg: "REYES AUTO" is NOT Rey supermarket', notRey.normalizedMerchant !== 'Rey' && notRey.category !== 'Groceries');
  const notDelta = c('DELTA AIRLINES TICKET', -300);
  ok('neg: "DELTA AIRLINES" is NOT Delta fuel', notDelta.normalizedMerchant !== 'Delta' && notDelta.category !== 'Fuel');
  const notAssa = c('ASSAULT DEFENSE COURSE', -60);
  ok('neg: "ASSAULT ..." is NOT ASSA insurance', notAssa.normalizedMerchant !== 'ASSA' && notAssa.category !== 'Insurance');
  const notMovil = c('PAGO AUTOMOVIL PRESTAMO', -500);
  ok('neg: "AUTOMOVIL" is NOT +Móvil utilities', notMovil.normalizedMerchant !== '+Móvil');
  const notEnsa = c('SUSCRIPCION PRENSA DIGITAL', -15);
  ok('neg: "PRENSA" is NOT ENSA utilities', notEnsa.normalizedMerchant !== 'ENSA' && notEnsa.category !== 'Household/Utilities');
  const notCorredor = c('CORREDOR DE SEGUROS XYZ', -120);
  ok('neg: "CORREDOR DE SEGUROS" is NOT Corredor toll', notCorredor.normalizedMerchant !== 'Corredor' && notCorredor.category !== 'Transportation');
  const notPuma = c('PUMA STORE MULTIPLAZA', -80);
  ok('neg: "PUMA STORE" is NOT Puma fuel', notPuma.normalizedMerchant !== 'Puma' && notPuma.category !== 'Fuel');

  // ---- 10. Precedence: user + learned rules override the Panama mapping ----
  const userRule = [{
    id: 'u1', source: 'manual', match_type: 'contains', match_field: 'merchant',
    pattern: 'ARROCHA', priority: 1, assign: { category: 'Shopping', budgetBucket: 'WANTS', is_transfer: null },
  }];
  const cUser = c('FCIA ARROCHA', -25, { learned_rules: userRule });
  ok('precedence: user rule beats Panama mapping', cUser.category === 'Shopping' && cUser.bucket === 'WANTS' && cUser.source === 'user_rule');
  const learnedRule = [{
    id: 'l1', source: 'learned', match_type: 'contains', match_field: 'merchant',
    pattern: 'TERPEL', priority: 50, assign: { category: 'Transportation', budgetBucket: 'NEEDS', is_transfer: false },
  }];
  const cLearned = c('TERPEL EL DORADO', -30, { learned_rules: learnedRule });
  ok('precedence: learned rule beats Panama mapping', cLearned.category === 'Transportation' && cLearned.source === 'user_rule');

  // ---- 11. Precedence: deterministic nature beats merchant mapping --------
  const cNature = classifyTransaction({ description: 'PAGO VISA ARROCHA', merchant: 'ARROCHA', amount: -100 });
  ok('precedence: cc-payment nature beats Arrocha merchant', cNature.category === 'Credit Card Payment' && cNature.source === 'deterministic');

  // ---- 12. Confidence / state -------------------------------------------
  const cConf = c('IDAAN');
  ok('confidence: merchant match = MERCHANT_RULE (suggested)', cConf.confidence === CONFIDENCE.MERCHANT_RULE && cConf.state === 'suggested');

  // ---- 13. panamaMerchantCategory helper is exact + safe -----------------
  ok('helper: exact hit', panamaMerchantCategory('Arrocha') && panamaMerchantCategory('Arrocha').category === 'Medical/Health');
  ok('helper: case-insensitive', panamaMerchantCategory('super 99').category === 'Groceries');
  ok('helper: miss -> null', panamaMerchantCategory('Reyes Auto') === null && panamaMerchantCategory('') === null);

  // ---- 14. Unknown merchant still routes to review -----------------------
  const unk = c('FERRETERIA DESCONOCIDA XYZ', -10);
  ok('unknown merchant -> review (Uncategorized/Unsorted)', unk.category === UNCATEGORIZED && unk.bucket === UNSORTED && unk.state === 'review');

  console.log(`\nPanama merchant tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await vite.close();
}

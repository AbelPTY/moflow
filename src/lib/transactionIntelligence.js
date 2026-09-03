// Transaction Intelligence V1 — a pure, deterministic classification layer.
//
// It reasons about THREE independent dimensions for a transaction:
//   A. nature   — the financial nature (expense/income/transfer/refund/…)
//   B. category — the app's stored category string (e.g. "Groceries")
//   C. bucket   — the app's stored budget bucket (e.g. "NEEDS")
//
// COMPATIBILITY: this module NEVER invents new stored values. It emits the
// SAME category strings and UPPERCASE bucket codes the app already stores
// (see src/rules/merchant_rules.json), so historical data and the Budget/
// Spending screens keep working. Display translation is handled separately by
// the i18n layer (catDisplay + buckets.*). `nature` is a NEW, additive,
// lowercase canonical dimension used only for reasoning/AI contracts; it is not
// persisted in V1 (no schema for it yet — see the migration proposal).
//
// It REUSES the existing rule engine (ruleMatcher + merchant_rules.json +
// user_merchant_rules) rather than duplicating it. Everything here is pure and
// data-injected so it is unit-testable with no DB and no network.
//
// Nothing here mutates raw imported values (description_raw/description stay
// untouched). Confidence is HEURISTIC, not statistically calibrated.

import staticRules from '../rules/merchant_rules.json';
import { classifyTransaction as matchRule } from './engine/ruleMatcher.js';

// ---------------------------------------------------------------------------
// Canonical taxonomies
// ---------------------------------------------------------------------------

// Additive, lowercase canonical NATURE dimension (not persisted in V1).
export const NATURES = [
  'expense', 'income', 'transfer', 'refund', 'credit_card_payment',
  'loan_payment', 'fee', 'interest', 'savings', 'investment', 'unknown',
];

// App-stored bucket codes (UPPERCASE), exactly as already used in
// merchant_rules.json and the Budget screen. Display is localized via i18n.
export const BUCKETS = ['NEEDS', 'WANTS', 'SAVINGS', 'INCOME', 'TRANSFERS', 'DEBT_FUNDING', 'Unsorted'];

export const UNCATEGORIZED = 'Uncategorized';
export const UNSORTED = 'Unsorted';

// The AI fallback is constrained to THIS lowercase canonical set only. Anything
// outside it is rejected (the model may never invent taxonomy). These map to the
// app's stored category strings via CANON_TO_APP_CATEGORY below.
export const AI_ALLOWED_CATEGORIES = [
  'salary', 'business_freelance', 'interest', 'investment_income', 'refund_reimbursement', 'other_income',
  'housing', 'groceries', 'dining', 'utilities', 'transportation', 'fuel', 'healthcare', 'insurance',
  'education', 'shopping', 'entertainment', 'travel', 'subscriptions', 'bank_fees', 'taxes', 'other_expense',
  'transfer', 'credit_card_payment', 'loan_payment', 'savings', 'investment',
  'uncategorized',
];
export const AI_ALLOWED_BUCKETS = ['needs', 'wants', 'savings_debt', 'income', 'transfers', 'unsorted'];
export const AI_ALLOWED_NATURES = NATURES;

// canonical (lowercase) -> app-stored category string. Only values that also
// exist in the i18n catDisplay map so translation works out of the box.
const CANON_TO_APP_CATEGORY = {
  groceries: 'Groceries',
  dining: 'Dining',
  utilities: 'Utilities',
  transportation: 'Transportation',
  fuel: 'Fuel',
  healthcare: 'Healthcare',
  insurance: 'Insurance',
  education: 'Education',
  shopping: 'Shopping',
  entertainment: 'Entertainment',
  travel: 'Travel',
  subscriptions: 'Subscriptions',
  bank_fees: 'Bank Fees',
  salary: 'Salary',
  interest: 'Interest',
  refund_reimbursement: 'Refund/Reimbursement',
  transfer: 'Transfer',
  credit_card_payment: 'Credit Card Payment',
  loan_payment: 'Loan Payment',
  other_income: 'Income',
  other_expense: 'Other',
  uncategorized: UNCATEGORIZED,
};
const CANON_TO_APP_BUCKET = {
  needs: 'NEEDS', wants: 'WANTS', savings_debt: 'SAVINGS', income: 'INCOME',
  transfers: 'TRANSFERS', unsorted: UNSORTED,
};

// nature -> default app category/bucket for deterministic (non-merchant) rules.
const NATURE_DEFAULTS = {
  credit_card_payment: { category: 'Credit Card Payment', bucket: 'TRANSFERS' },
  loan_payment: { category: 'Loan Payment', bucket: 'DEBT_FUNDING' },
  transfer: { category: 'Transfer', bucket: 'TRANSFERS' },
  refund: { category: 'Refund/Reimbursement', bucket: 'INCOME' },
  fee: { category: 'Bank Fees', bucket: 'NEEDS' },
  interest: { category: 'Interest', bucket: 'INCOME' },
  savings: { category: 'Savings', bucket: 'SAVINGS' },
  income: { category: 'Income', bucket: 'INCOME' },
};

// Finer category override by reasonCode (nature stays canonical, e.g. income).
const REASON_CATEGORY = {
  salary: 'Salary',
};

// ---------------------------------------------------------------------------
// Confidence model (HEURISTIC — not statistically calibrated)
// ---------------------------------------------------------------------------
export const CONFIDENCE = {
  USER_RULE: 1.0,       // explicit user rule / user-set value
  DETERMINISTIC: 0.97,  // strong nature signal (cc payment, transfer, fee…)
  MERCHANT_RULE: 0.9,   // static/merchant rule match
  RECURRING_BOOST: 0.05,
  AI: 0.8,              // capped; AI never auto-applies above SUGGESTED on its own
  NONE: 0.0,
};
export const THRESHOLD = { AUTO: 0.95, SUGGESTED: 0.75 };

// Map a confidence to a review state.
export function classificationState(confidence) {
  const c = Number(confidence) || 0;
  if (c >= THRESHOLD.AUTO) return 'auto';
  if (c >= THRESHOLD.SUGGESTED) return 'suggested';
  return 'review';
}

// ---------------------------------------------------------------------------
// Merchant normalization (deterministic, display-only; raw is never touched)
// ---------------------------------------------------------------------------

// A small set of PUBLIC market/brand aliases (reusable global/market knowledge,
// never personal identifiers — consistent with merchant_rules.json policy).
const MERCHANT_ALIASES = [
  [/\bSUPER\s*99\b/i, 'Super 99'],
  [/\bRIBA\s*SMITH\b/i, 'Riba Smith'],
  [/\bEL\s*MACHETAZO\b/i, 'El Machetazo'],
  [/\bPRICE\s*SMART\b/i, 'PriceSmart'],
  [/\bNETFLIX\b/i, 'Netflix'],
  [/\bSPOTIFY\b/i, 'Spotify'],
  [/\bUBER\s*EATS\b/i, 'Uber Eats'],
  [/\bUBER\b/i, 'Uber'],
  [/\bAMAZON\b/i, 'Amazon'],
  [/\bSTARBUCKS\b/i, 'Starbucks'],
  [/\bMC\s*DONALD'?S\b/i, "McDonald's"],
];

// Bank noise / boilerplate that is safe to strip from the front of a merchant.
const BANK_NOISE_PREFIXES = [
  'COMPRA ', 'PURCHASE ', 'POS ', 'PAGO A ', 'PAGO ', 'DEBITO ', 'CREDITO ',
  'ACH ', 'TRANSFERENCIA A ', 'TRANSFERENCIA DE ', 'YAPPY A ', 'YAPPY DE ',
];

// Title-case a token run while keeping short connectors lowercase.
const titleCase = (s) =>
  s.toLowerCase().replace(/\b([a-zà-ÿ])([a-zà-ÿ']*)/gi, (m, a, b) => a.toUpperCase() + b);

// Normalize a merchant for DISPLAY and for merchant-level learned rules.
// Deterministic: trim, strip bank noise, drop store-number / branch-city
// suffixes when safe, collapse whitespace, apply public brand aliases,
// title-case the remainder. Returns '' for empty input. NEVER mutates raw.
export function normalizeMerchant(input) {
  let s = String(input == null ? '' : input).trim();
  if (!s) return '';

  // Alias match wins immediately (case-insensitive), before any destruction.
  for (const [re, canonical] of MERCHANT_ALIASES) {
    if (re.test(s)) return canonical;
  }

  const upper = s.toUpperCase();
  let work = upper;
  for (const p of BANK_NOISE_PREFIXES) {
    if (work.startsWith(p)) { work = work.slice(p.length); break; }
  }

  // Strip a trailing transaction / store number like "#045", "No. 12", "*1234".
  work = work.replace(/\s*[#*]\s*\d{2,}\s*$/g, '');
  work = work.replace(/\s+NO\.?\s*\d{2,}\s*$/g, '');
  // Strip a trailing card mask like "**** 3355".
  work = work.replace(/\s*\*{2,}\s*\d{2,}\s*$/g, '');
  // Collapse repeated whitespace.
  work = work.replace(/\s+/g, ' ').trim();

  if (!work) work = upper.replace(/\s+/g, ' ').trim();
  return titleCase(work);
}

// ---------------------------------------------------------------------------
// Deterministic financial-nature inference (does NOT rely only on sign)
// ---------------------------------------------------------------------------

const has = (hay, needles) => needles.some((n) => hay.includes(n));

// Returns { nature, confidence, reasonCode } or { nature:'unknown', ... }.
// reasonCode is an i18n key suffix (reasons.<code>) — not user text.
export function inferTransactionNature({ description = '', merchant = '', amount = 0 } = {}) {
  const d = String(description || '').toUpperCase();
  const m = String(merchant || '').toUpperCase();
  const hay = `${d} ${m}`;
  const amt = Number(amount) || 0;

  // Credit-card payments (explicit patterns; sign-independent).
  if (has(hay, ['PAGO VISA', 'PAYMENT - THANK YOU', 'PAYMENT THANK YOU', 'TARJETA VISA PAYMENT', 'PAGO TARJETA', 'PAGO A TARJETA', 'CREDIT CARD PAYMENT'])) {
    return { nature: 'credit_card_payment', confidence: CONFIDENCE.DETERMINISTIC, reasonCode: 'creditCardPayment' };
  }
  // Loan payments.
  if (has(hay, ['PAGO PRESTAMO', 'PAGO DE PRESTAMO', 'LOAN PAYMENT', 'PRESTAMO PERSONAL', 'ABONO PRESTAMO', 'MORTGAGE'])) {
    return { nature: 'loan_payment', confidence: CONFIDENCE.DETERMINISTIC, reasonCode: 'loanPayment' };
  }
  // Transfers (keyword-driven; pairing is confirmed elsewhere).
  if (has(hay, ['TRANSFERENCIA A ', 'TRANSFERENCIA DE ', 'ACH XPRESS A ', 'ACH XPRESS DE ', 'YAPPY A ', 'YAPPY DE ', 'TRANSFER TO ', 'TRANSFER FROM ', 'INTERNAL TRANSFER'])) {
    return { nature: 'transfer', confidence: 0.9, reasonCode: 'transferKeyword' };
  }
  // Bank fees.
  if (has(hay, ['COMISION', 'CARGO POR MANEJO', 'MAINTENANCE FEE', 'SERVICE CHARGE', 'ATM FEE', 'CARGO ADMINISTRATIVO', 'OVERDRAFT'])) {
    return { nature: 'fee', confidence: CONFIDENCE.DETERMINISTIC, reasonCode: 'bankFee' };
  }
  // Interest credit.
  if (has(hay, ['INTERES GANADO', 'INTEREST EARNED', 'INTERES CUENTA', 'DIVIDENDO', 'INTEREST PAID', 'INTERES PAGADO']) && amt >= 0) {
    return { nature: 'interest', confidence: CONFIDENCE.DETERMINISTIC, reasonCode: 'interest' };
  }
  // Salary / payroll (positive only).
  if (amt > 0 && has(hay, ['PLANILLA', 'PAYROLL', 'SALARIO', 'SALARY', 'NOMINA', 'ACH CREDIT PAYROLL', 'DIRECT DEP'])) {
    return { nature: 'income', confidence: CONFIDENCE.DETERMINISTIC, reasonCode: 'salary' };
  }
  // Savings contribution / investment.
  if (has(hay, ['APORTACION', 'APORTE', 'AHORRO PROGRAMADO', 'SAVINGS DEPOSIT'])) {
    return { nature: 'savings', confidence: 0.85, reasonCode: 'savings' };
  }
  return { nature: 'unknown', confidence: CONFIDENCE.NONE, reasonCode: 'none' };
}

// ---------------------------------------------------------------------------
// Merchant/static + user rule categorization (reuses the existing engine)
// ---------------------------------------------------------------------------

// Returns { category, bucket, is_transfer, source, ruleId } or null.
// userRules: engine-shaped rows (see userRules.js). staticList override for tests.
export function categorizeTransaction({ merchant = '', description = '', amount = 0, userRules = [] } = {}, staticList) {
  const rules = Array.isArray(staticList) ? staticList : (staticRules && staticRules.rules) || [];
  const match = matchRule(
    { merchant: String(merchant || ''), description: String(description || '').toUpperCase(), amount: Number(amount) || 0 },
    rules,
    Array.isArray(userRules) ? userRules : []
  );
  if (!match || !match.rule || !match.rule.assign) return null;
  const a = match.rule.assign;
  const source = (match.kind === 'manual' || match.kind === 'learned'
    || match.kind === 'migrated' || match.kind === 'fallback')
    ? 'user_rule'
    : 'merchant_rule';
  return {
    category: a.category,
    bucket: a.budgetBucket,
    is_transfer: a.is_transfer == null ? undefined : a.is_transfer,
    source,
    ruleId: match.rule.id,
    kind: match.kind,
  };
}

// ---------------------------------------------------------------------------
// Recurring / relational detection (pure, over caller-provided nearby rows)
// ---------------------------------------------------------------------------

const dateKey = (d) => String(d || '').slice(0, 10);
const amt2 = (a) => Math.round((Number(a) || 0) * 100) / 100;
const daysBetween = (a, b) => {
  const da = new Date(dateKey(a)); const db = new Date(dateKey(b));
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.abs((da - db) / 86400000);
};

// A merchant looks recurring if >= 3 charges of a similar amount appear at a
// roughly weekly/monthly cadence. Pure; returns boolean.
export function detectRecurring(normalizedMerchant, nearby = []) {
  const key = String(normalizedMerchant || '').toLowerCase();
  if (!key) return false;
  const hits = (nearby || [])
    .filter((r) => normalizeMerchant(r.merchant || r.description).toLowerCase() === key)
    .map((r) => dateKey(r.date))
    .filter(Boolean)
    .sort();
  if (hits.length < 3) return false;
  const gaps = [];
  for (let i = 1; i < hits.length; i++) gaps.push(daysBetween(hits[i - 1], hits[i]));
  // weekly (~7) or monthly (~28-31) cadence, allowing slack.
  return gaps.every((g) => (g >= 5 && g <= 9) || (g >= 24 && g <= 35));
}

// Transfer pair: an opposite-sign row of the same amount within a few days in a
// DIFFERENT account. Returns the matching row or null. Pure.
export function findTransferPair(row, nearby = []) {
  const a = amt2(row.amount);
  if (a === 0) return null;
  const acct = String(row.account_name || row.source_account || '').toLowerCase();
  return (nearby || []).find((o) => o !== row
    && amt2(o.amount) === -a
    && String(o.account_name || o.source_account || '').toLowerCase() !== acct
    && daysBetween(row.date, o.date) <= 3) || null;
}

// Refund pair: an opposite-sign row from the SAME normalized merchant within ~45
// days, amount matching (or smaller for a partial refund). Returns row or null.
export function findRefundPair(row, nearby = []) {
  const a = amt2(row.amount);
  if (a <= 0) return null; // a refund is a positive row we try to pair to a prior charge
  const merch = normalizeMerchant(row.merchant || row.description).toLowerCase();
  if (!merch) return null;
  return (nearby || []).find((o) => o !== row
    && amt2(o.amount) < 0
    && Math.abs(amt2(o.amount)) >= a
    && normalizeMerchant(o.merchant || o.description).toLowerCase() === merch
    && daysBetween(row.date, o.date) <= 45) || null;
}

// ---------------------------------------------------------------------------
// scoreClassification — turn a source + signals into a heuristic confidence.
// ---------------------------------------------------------------------------
export function scoreClassification({ source, recurring = false } = {}) {
  let base;
  switch (source) {
    case 'user_set':
    case 'user_rule': base = CONFIDENCE.USER_RULE; break;
    case 'deterministic': base = CONFIDENCE.DETERMINISTIC; break;
    case 'merchant_rule': base = CONFIDENCE.MERCHANT_RULE; break;
    case 'ai': base = CONFIDENCE.AI; break;
    default: base = CONFIDENCE.NONE;
  }
  if (recurring && base > 0 && base < 1) base = Math.min(1, base + CONFIDENCE.RECURRING_BOOST);
  return Math.round(base * 100) / 100;
}

// ---------------------------------------------------------------------------
// classifyTransaction — the orchestrator. PURE. Precedence:
//   1. explicit user-set existing classification (never silently overwritten)
//   2. explicit user rule (manual)              [via categorize -> user_rule]
//   3. deterministic nature rule
//   4. merchant/static rule
//   5. recurring-pattern strengthening
//   6. Uncategorized/Unsorted (review)
// AI is applied only by the caller for rows this returns as 'review'.
// ---------------------------------------------------------------------------
export function classifyTransaction(input = {}) {
  const {
    description = '', merchant = '', amount = 0,
    account_name = '', source_account = '', // eslint-disable-line no-unused-vars
    existing_category = '', existing_bucket = '',
    user_set = false,
    user_categorized = false,
    // Canonical persisted provenance column (reused from the live schema).
    classification_source = '',
    needs_review = false,
    nearby_transactions = [],
    learned_rules = [],
    reclassify = false,
  } = input;

  const normalizedMerchant = normalizeMerchant(merchant || description);
  const recurring = detectRecurring(normalizedMerchant, nearby_transactions);
  const reasons = [];

  // Is this an existing classification MoFlow must not silently overwrite?
  //   A. user_categorized = true
  //   B. classification_source = 'user'
  //   C. PROTECTED legacy: classification_source in ('legacy','manual') AND
  //      needs_review=false AND a real (non-default) category is present. The
  //      live table's historical default is 'manual' (a schema default, not a
  //      proven human edit), so a RESOLVED legacy/manual row is treated
  //      conservatively as protected — never silently reclassified.
  const hasRealCategory = !!existing_category && existing_category !== UNCATEGORIZED;
  const isLegacyProtected =
    (classification_source === 'legacy' || classification_source === 'manual') &&
    needs_review === false && hasRealCategory;
  const isProtected =
    user_set === true ||
    user_categorized === true ||
    classification_source === 'user' ||
    isLegacyProtected;

  // 1. Never overwrite a protected classification unless the caller opts in.
  if (isProtected && !reclassify) {
    const src = (user_categorized || classification_source === 'user' || user_set) ? 'user_set' : 'legacy';
    reasons.push(src === 'legacy' ? 'legacyProtected' : 'userSet');
    return result(normalizedMerchant, natureFromCategory(existing_category, amount), existing_category, existing_bucket || UNSORTED, CONFIDENCE.USER_RULE, src, reasons, recurring);
  }

  const ruled = categorizeTransaction({ merchant, description, amount, userRules: learned_rules });

  // 2. Explicit user rule (manual / learned / fallback) always wins.
  if (ruled && ruled.source === 'user_rule') {
    reasons.push(ruled.kind === 'learned' ? 'learnedRule' : 'userRule');
    if (recurring) reasons.push('recurring');
    const conf = scoreClassification({ source: 'user_rule', recurring });
    return result(normalizedMerchant, natureFromCategory(ruled.category, amount), ruled.category, ruled.bucket, conf, 'user_rule', reasons, recurring, { ruleKind: ruled.kind });
  }

  // 3. Deterministic nature (cc payment / transfer / refund / fee / interest / salary / loan).
  const nat = inferTransactionNature({ description, merchant, amount });
  if (nat.nature !== 'unknown' && NATURE_DEFAULTS[nat.nature]) {
    const def = NATURE_DEFAULTS[nat.nature];
    const category = REASON_CATEGORY[nat.reasonCode] || def.category;
    reasons.push(nat.reasonCode);
    const conf = scoreClassification({ source: 'deterministic', recurring: false }) * (nat.confidence / CONFIDENCE.DETERMINISTIC);
    return result(normalizedMerchant, nat.nature, category, def.bucket, Math.round(conf * 100) / 100, 'deterministic', reasons, recurring);
  }

  // 4. Known merchant / static rule.
  if (ruled) {
    reasons.push('merchantRule');
    if (recurring) reasons.push('recurring');
    const conf = scoreClassification({ source: 'merchant_rule', recurring });
    return result(normalizedMerchant, natureFromCategory(ruled.category, amount), ruled.category, ruled.bucket, conf, 'merchant_rule', reasons, recurring, { ruleKind: ruled.kind });
  }

  // 6. Nothing matched -> keep it for review (never a false auto).
  reasons.push('noMatch');
  const fallbackNature = amount > 0 ? 'income' : amount < 0 ? 'expense' : 'unknown';
  return result(normalizedMerchant, fallbackNature, UNCATEGORIZED, UNSORTED, CONFIDENCE.NONE, 'none', reasons, recurring);
}

function result(normalizedMerchant, nature, category, bucket, confidence, source, reasons, recurring, extra = {}) {
  return {
    normalizedMerchant,
    nature,
    category,
    bucket: bucket || UNSORTED,
    confidence,
    state: classificationState(confidence),
    source,
    recurring: !!recurring,
    reasons,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Persistence-metadata builders (pure). These produce the exact column payloads
// for the transaction_intelligence_metadata migration. Callers do the DB write;
// nothing here persists. Raw merchant/description are never included.
// ---------------------------------------------------------------------------

// Map an engine result to the DB classification_source value (reuses the live
// public.transactions.classification_source column; NO new category_source).
function classificationSourceOf(classification) {
  const s = classification.source;
  if (s === 'deterministic') return 'deterministic';
  if (s === 'merchant_rule') return 'merchant_rule';
  if (s === 'ai') return 'ai';
  if (s === 'user_rule') return classification.ruleKind === 'learned' ? 'learned_rule' : 'manual_rule';
  return 'import';
}

// Metadata for an AUTOMATIC classification write at import/backfill time.
// Decision (documented): AUTO writes the category/bucket with needs_review=false.
// SUGGESTED ALSO writes the suggested category/bucket but keeps needs_review=true
// so the value is visible + explainable in place while still queued for the user
// to confirm. REVIEW leaves Uncategorized/Unsorted and only flags needs_review.
// user_categorized is always false for automatic writes. Column names match the
// LIVE schema: classification_source / classification_confidence / needs_review.
export function buildAutoWriteMetadata(classification) {
  const c = classification || {};
  const state = c.state || classificationState(c.confidence);
  const writesCategory = state === 'auto' || state === 'suggested';
  return {
    transaction_nature: c.nature && c.nature !== 'unknown' ? c.nature : null,
    category: writesCategory ? c.category : UNCATEGORIZED,
    budget_bucket: writesCategory ? c.bucket : UNSORTED,
    normalized_merchant: c.normalizedMerchant || null,
    classification_source: writesCategory ? classificationSourceOf(c) : 'import',
    classification_confidence: typeof c.confidence === 'number' ? Math.round(c.confidence * 100) / 100 : null,
    user_categorized: false,
    needs_review: state !== 'auto',
  };
}

// Metadata for an EXPLICIT user edit of category/bucket (and optionally nature).
// Marks the row as user-owned and resolved. transaction_nature is only set when
// the caller explicitly provides one (a plain category edit leaves it as-is via
// undefined, so the write can omit it).
export function buildUserEditMetadata({ category, bucket, nature } = {}) {
  const out = {
    category,
    budget_bucket: bucket,
    classification_source: 'user',
    classification_confidence: 1,
    user_categorized: true,
    needs_review: false,
  };
  if (nature !== undefined) out.transaction_nature = nature;
  return out;
}

// Plain-language reason KEY (txIntel.reasons.<key>) derived ONLY from persisted
// classification metadata (source + nature). It never re-classifies, so a review
// explanation can never contradict the stored category/bucket. Returns a key
// suffix; the UI translates it. Unknown/unresolved -> 'noMatch'.
export function reasonKeyForClassification(classification_source, transaction_nature) {
  switch (classification_source) {
    case 'user': return 'userSet';
    case 'manual_rule': return 'userRule';
    case 'learned_rule': return 'learnedRule';
    case 'merchant_rule': return 'merchantRule';
    case 'legacy':
    case 'manual': return 'legacyProtected';
    case 'deterministic':
      return {
        credit_card_payment: 'creditCardPayment', loan_payment: 'loanPayment',
        transfer: 'transferKeyword', refund: 'refundPair', fee: 'bankFee',
        interest: 'interest', income: 'salary', savings: 'savings',
      }[transaction_nature] || 'merchantRule';
    default: return 'noMatch';
  }
}

// Best-effort nature from an app category (for rows already categorized).
function natureFromCategory(category, amount) {
  const c = String(category || '').toLowerCase();
  if (c.includes('credit card payment')) return 'credit_card_payment';
  if (c.includes('loan payment')) return 'loan_payment';
  if (c === 'transfer') return 'transfer';
  if (c.includes('refund') || c.includes('reimburs')) return 'refund';
  if (c.includes('bank') || c.includes('fee')) return 'fee';
  if (c === 'interest') return 'interest';
  if (c === 'salary' || c === 'income') return 'income';
  const amt = Number(amount) || 0;
  return amt > 0 ? 'income' : amt < 0 ? 'expense' : 'unknown';
}

// ---------------------------------------------------------------------------
// Learned rules — build a user_merchant_rules row from a user correction.
// Pure: returns the row shape; the caller persists it (source='learned').
// ---------------------------------------------------------------------------
export function learnedRuleFromCorrection({ normalizedMerchant, category, bucket, is_transfer = null } = {}) {
  const pattern = String(normalizedMerchant || '').trim();
  if (!pattern || !category || !bucket) return null;
  return {
    pattern,
    match_type: 'exact',
    match_field: 'merchant',
    category,
    budget_bucket: bucket,
    is_transfer: is_transfer == null ? null : !!is_transfer,
    source: 'learned',
    confidence: 1,
    priority: 50, // above migrated (1000+), below manual default (100)? see note
    active: true,
  };
}

// ---------------------------------------------------------------------------
// AI fallback contract — sanitize a model response to the allowed taxonomy.
// Rejects any unknown/invented value (returns null). Maps canonical -> app.
// Confidence is capped to CONFIDENCE.AI so AI never auto-applies on its own.
// ---------------------------------------------------------------------------
export function sanitizeAiClassification(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const cat = String(obj.category || '').toLowerCase();
  const buck = String(obj.bucket || '').toLowerCase();
  const nat = String(obj.nature || '').toLowerCase();
  if (!AI_ALLOWED_CATEGORIES.includes(cat)) return null;
  if (!AI_ALLOWED_BUCKETS.includes(buck)) return null;
  if (nat && !AI_ALLOWED_NATURES.includes(nat)) return null;
  const appCategory = CANON_TO_APP_CATEGORY[cat] || UNCATEGORIZED;
  const appBucket = CANON_TO_APP_BUCKET[buck] || UNSORTED;
  let confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) confidence = CONFIDENCE.AI;
  confidence = Math.min(confidence, CONFIDENCE.AI);
  return {
    category: appCategory,
    bucket: appBucket,
    nature: nat && AI_ALLOWED_NATURES.includes(nat) ? nat : natureFromCategory(appCategory, 0),
    confidence: Math.round(confidence * 100) / 100,
    source: 'ai',
    state: classificationState(Math.min(confidence, CONFIDENCE.AI)),
  };
}

export default classifyTransaction;

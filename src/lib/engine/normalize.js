import rulesData from '../../rules/merchant_rules.json';
import { classifyTransaction } from './ruleMatcher';

// Canonical account names used across the UI.
//
// Important:
// - This does NOT modify the original account_name/source_account stored
//   in Supabase.
// - It only normalizes the account identity presented to the app.
// - Ambiguous mixed statement containers such as "UNFCU Statement" are
//   intentionally NOT mapped here.
const canonicalizeAccount = (account) => {
  const value = String(account || '').trim();

  const aliases = {
    'Cuenta Principal': 'Banco General - Savings',

    'Banco General Mileage Credit Card': 'Banco General - Mileage CC',
    'Banco General Star Credit Card': 'Banco General - Star CC',

    'Davivienda Credit Card': 'Davivienda CC',

    'UNFCU Credit Card': 'UNFCU Visa Elite 5659',
    'UNFCU Loan': 'UNFCU Personal Loan 7612',
  };

  return aliases[value] || value;
};

// options.userRules (optional): the authenticated user's engine-shaped rules,
// evaluated BEFORE the static rules. When omitted/empty, behavior is byte-for-
// byte identical to the pre-integration static-only pipeline.
export function processTransactionRow(t, options = {}) {
  const userRules = options.userRules || [];

  // --- A. Bulletproof Date Handling ---
  // Grab the date from whatever key the AI or frontend used
  let rawDate = t.date || t.dateString || t.transaction_date || '';
  let cleanDate = rawDate.split('T')[0]; // strip time if present

  // CRITICAL FIX: If date is empty, set to null to prevent Supabase crash
  if (!cleanDate || cleanDate.trim() === '') {
    cleanDate = null;
  }

  // --- B. Bulletproof Amount Handling ---
  // Strip out any accidental currency symbols or commas the AI included
  let safeAmountString = String(t.amount || 0).replace(/[^0-9.-]+/g, '');
  let rawAmount = parseFloat(safeAmountString);

  // CRITICAL FIX: If it's still not a number, default to 0
  if (isNaN(rawAmount)) {
    rawAmount = 0;
  }

  const description = (
    t.description_raw ||
    t.description ||
    ''
  ).toUpperCase();

  // Prevent account masks (like **** 3355) from becoming the merchant name
  let merchantName =
    t.merchant_extracted &&
    t.merchant_extracted.length > 1 &&
    !t.merchant_extracted.includes('****')
      ? t.merchant_extracted
      : t.merchant_clean || t.merchant || 'Unknown Transaction';

  // --- C. Sign Enforcement ---
  if (
    description.startsWith('YAPPY A ') ||
    description.includes('TRANSFERENCIA A ') ||
    description.includes('PAGO ') ||
    description.includes('RETIRO ') ||
    description.includes('WITHDRAWAL') ||
    description.includes('COMPRA ') ||
    description.includes('ACH XPRESS A ')
  ) {
    if (rawAmount > 0) rawAmount = -rawAmount;
  } else if (
    description.startsWith('YAPPY DE ') ||
    description.includes('TRANSFERENCIA DE ') ||
    description.includes('DEPOSITO ') ||
    description.includes('CREDIT') ||
    description.includes('DESEMBOLSO') ||
    description.includes('ACH -') ||
    description.includes('TRR') ||
    description.includes('DESCRIPTIVE DEPOSIT')
  ) {
    if (rawAmount < 0) rawAmount = Math.abs(rawAmount);
  }

  // Set initial default assignments
  let category = t.category || 'Uncategorized';
  let budgetBucket = t.budget_bucket || 'Unsorted';
  let is_transfer = t.is_transfer || false;

  // --- D. Rule Engine Processing ---
  // Precedence: MANUAL user rule -> LEGACY ordered (STATIC + MIGRATED). With an
  // empty userRules array this reduces EXACTLY to the original static-only
  // first-match behavior.
  let ruleMatched = false;

  // Set for ANY user rule (MANUAL or MIGRATED). When true, the bucket-cleanup
  // below is skipped so the user rule's transfer intent survives: explicit
  // true/false is honored, and NULL preserves the pre-rule (seeded/stored)
  // value. STATIC matches keep the legacy cleanup exactly.
  let userRuleMatched = false;

  const match = classifyTransaction(
    {
      merchant: merchantName,
      description,
      amount: rawAmount,
    },
    rulesData?.rules,
    userRules
  );

  if (match) {
    ruleMatched = true;
    category = match.rule.assign.category;
    budgetBucket = match.rule.assign.budgetBucket;

    const it = match.rule.assign.is_transfer;

    // Honor explicit true/false; NULL/undefined preserves the current value.
    if (it !== null && it !== undefined) {
      is_transfer = it;
    }

    if (
      match.kind === 'manual' ||
      match.kind === 'learned' ||
      match.kind === 'migrated' ||
      match.kind === 'fallback'
    ) {
      // User-tier rules govern transfer semantics: skip the bucket cleanup below
      // so an explicit true/false (or NULL "preserve") is not overridden.
      userRuleMatched = true;
    }

    // Optional display-merchant alias from a conditional fallback branch.
    if (match.kind === 'fallback' && match.merchant_label) {
      merchantName = match.merchant_label;
    }

    // Reimbursement override reproduces legacy STATIC category behavior and also
    // applies to MIGRATED rules (which reproduce a static group). It does NOT
    // apply to an intentional MANUAL override or an explicit FALLBACK assignment.
    if (
      (match.kind === 'static' || match.kind === 'migrated') &&
      rawAmount > 0 &&
      ['Sports', 'Office/Social Events', 'Work Expenses'].includes(category)
    ) {
      category = 'Reimbursements';
      budgetBucket = 'INCOME';
    }
  }

  // Clean up buckets. Skipped for ANY user rule (MANUAL, MIGRATED or FALLBACK),
  // so its explicit true/false -- or NULL "preserve" -- is not overridden by the
  // bucket. STATIC and no-match rows keep this cleanup exactly as before.
  if (!userRuleMatched) {
    if (
      ['TRANSFERS', 'CC_PAYMENT', 'ADJUSTMENT'].includes(budgetBucket)
    ) {
      is_transfer = true;
    } else if (
      ['INCOME', 'NEEDS', 'WANTS', 'SAVINGS'].includes(budgetBucket)
    ) {
      is_transfer = false;
    }
  }

  const rawAccount = t.source_account || t.account_name;

  // Output mapped exactly to what your Database and UI expect
  return {
    ...t,
    id: t.id,
    merchant: merchantName,
    description,
    account: canonicalizeAccount(rawAccount),
    budgetBucket,
    category,
    is_transfer,
    amount: rawAmount,
    date: cleanDate, // DB expects this
    dateString: cleanDate, // UI expects this
  };
}
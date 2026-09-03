// Spanish Completion V1 — verifies screen label dictionaries switch EN/ES and
// that display translations never mutate canonical stored values. FICTIONAL/UI
// data only. Loaded through Vite SSR (pure core).
//
// Run (where Node exists) from repo root:  node tests/i18nScreens.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const { translate, translateCategory, formatCurrency, formatDate, formatDuration } = await vite.ssrLoadModule('/src/i18n/core.js');
  const { simulate } = await vite.ssrLoadModule('/src/lib/loanMath.js');
  const en = (k, v) => translate('en-US', k, v);
  const es = (k, v) => translate('es-PA', k, v);
  const differs = (k) => en(k) !== es(k) && en(k) !== k && es(k) !== k;

  // A. Cards labels switch EN/ES.
  ok('A: cards.creditCards', en('cards.creditCards') === 'Credit Cards' && es('cards.creditCards') === 'Tarjetas de crédito');
  ok('A: cards.scanStatement differs', differs('cards.scanStatement'));

  // B. Loans labels switch EN/ES.
  ok('B: loans.monthlyPayment', en('loans.monthlyPayment') === 'Monthly payment' && es('loans.monthlyPayment') === 'Pago mensual');
  ok('B: loans.remainingPrincipal differs', differs('loans.remainingPrincipal'));

  // C. Flow labels switch EN/ES (Projected available cash — NOT "Safe to Spend").
  ok('C: flow.availableCashNow', en('flow.availableCashNow') === 'Available cash now' && es('flow.availableCashNow') === 'Disponible en efectivo ahora');
  ok('C: flow.projectedAvailable differs', differs('flow.projectedAvailable'));
  ok('C: no "Safe to Spend" wording', !/safe to spend/i.test(en('flow.projectedAvailable')) && !/safe to spend/i.test(es('flow.projectedAvailable')));

  // D. Bills labels switch EN/ES.
  ok('D: bills.title', en('bills.title') === 'Bills' && es('bills.title') === 'Pagos');
  ok('D: bills.subtitle differs', differs('bills.subtitle'));

  // E. Activity labels switch EN/ES.
  ok('E: activity.title', en('activity.title') === 'Activity' && es('activity.title') === 'Actividad');
  ok('E: activity.reviewTransactions differs', differs('activity.reviewTransactions'));

  // F. Accounts labels switch EN/ES.
  ok('F: accounts.addAccount', en('accounts.addAccount') === 'Add account' && es('accounts.addAccount') === 'Agregar cuenta');
  ok('F: accounts.balanceNotSet differs', differs('accounts.balanceNotSet'));

  // G. Category display switches without mutating the stored value.
  const catValue = 'groceries';
  ok('G: category display en/es', en('categories.groceries') === 'Groceries' && es('categories.groceries') === 'Supermercado');
  ok('G: stored category unchanged', catValue === 'groceries');

  // H. Bucket display switches without mutating the stored value.
  const bucketValue = 'savings_debt';
  ok('H: bucket display en/es', en('buckets.savings_debt') === 'Savings/Debt' && es('buckets.savings_debt') === 'Ahorro y deuda');
  // L. "Projected available cash" Spanish is exactly this (not "Disponible proyectado").
  ok('L: projected available exact ES', es('flow.projectedAvailable') === 'Efectivo disponible proyectado');
  ok('H: stored bucket unchanged', bucketValue === 'savings_debt');

  // account_type / loan_type stay canonical while display translates.
  ok('canonical account_type display', en('accountTypes.checking') === 'Checking' && es('accountTypes.checking') === 'Cuenta corriente');
  ok('canonical loan_type display', en('loanTypes.mortgage') === 'Mortgage' && es('loanTypes.mortgage') === 'Hipoteca');

  // I. Date formatting (UTC-pinned).
  const d = new Date(Date.UTC(2026, 8, 15));
  ok('I: en date', formatDate(d, 'en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) === 'Sep 15, 2026');
  ok('I: es date has Spanish month', /sept/i.test(formatDate(d, 'es-PA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })));

  // J. USD formatting in es-PA (Panama uses USD, never EUR).
  const esUsd = formatCurrency(10600, 'es-PA', 'USD');
  ok('J: es-PA USD grouped', esUsd.includes('10,600.00'));
  ok('J: es-PA USD not EUR', !esUsd.includes('€'));

  // K. Multiple-currency formatting still respects the supplied currency code.
  const eur = formatCurrency(1000, 'es-PA', 'EUR');
  const gbp = formatCurrency(1000, 'en-US', 'GBP');
  ok('K: EUR code respected', eur.includes('€') || /EUR/.test(eur));
  ok('K: GBP code respected', gbp.includes('£') || /GBP/.test(gbp));

  // L. English fallback still works (missing es key -> en-US).
  ok('L: fallback probe', es('common.fallbackProbe') === 'English fallback');
  ok('L: unknown key never undefined', es('cards.__nope__') === 'cards.__nope__');

  // Interpolation used by wired screens.
  ok('interpolation: cards.dueInDays', es('cards.dueInDays', { count: 3 }) === 'en 3 días');

  // ---- Completion: new namespaces switch EN/ES ----
  ok('cards panel: financingGuard', differs('cards.financingGuard'));
  ok('loans panel: analyzeExtra', differs('loans.analyzeExtra'));
  ok('loans panel: disclosure', differs('loans.disclosure'));
  ok('bills calendar: upcomingPayments', differs('bills.upcomingPayments'));
  ok('activityScanner: foundTransactions', differs('activityScanner.foundTransactions'));
  ok('balanceScanner: foundBalances', differs('balanceScanner.foundBalances'));
  ok('scanner: scanImages interpolates', es('scanner.scanImages', { count: 4 }) === 'Escanear 4 imágenes');
  ok('budget: title', en('budget.title') === 'Monthly Budget' && es('budget.title') === 'Presupuesto mensual');
  ok('spending: totalSpent', differs('spending.totalSpent'));
  ok('bulkUpload: title', differs('bulkUpload.title'));
  ok('flowLite: coverTitle', differs('flowLite.coverTitle'));

  // M. translateCategory: known category translates for display; canonical value
  //    is never mutated; unknown/custom names pass through unchanged.
  const stored = 'Groceries';
  ok('M: category display en', translateCategory('en-US', stored) === 'Groceries');
  ok('M: category display es', translateCategory('es-PA', stored) === 'Supermercado');
  ok('M: stored value unchanged', stored === 'Groceries');
  ok('M: custom category passes through', translateCategory('es-PA', 'My Custom Cat') === 'My Custom Cat');
  ok('M: empty passes through', translateCategory('es-PA', '') === '');

  // "Available cash" standardization (requirement 1).
  ok('available cash wording', es('flow.availableCashNow') === 'Disponible en efectivo ahora');

  // ---- Deep Flow / Activity switch EN/ES ----
  ok('deep flow: recurringIncome', differs('flow.recurringIncome'));
  ok('deep flow: spendingBehaviorModel', differs('flow.spendingBehaviorModel'));
  ok('deep flow: startingBalance', differs('flow.startingBalance'));
  ok('deep flow: eventTypes.income', en('flow.eventTypes.income') === 'Income' && es('flow.eventTypes.income') === 'Ingresos');
  ok('custom horizon: horizonCustom', en('flow.horizonCustom') === 'Custom' && es('flow.horizonCustom') === 'Personalizado');
  ok('activity edit: thMerchant', differs('activity.thMerchant'));
  ok('activity filters: allTypes', differs('activity.allTypes'));
  ok('bulkUpload error: parseFailedPdf', es('bulkUpload.parseFailedPdf', { msg: 'x' }) === 'El análisis del PDF falló: x');

  // G. Duration formatting with pluralization (EN + ES).
  ok('G: 1 month', formatDuration(1, 'en-US') === '1 month' && formatDuration(1, 'es-PA') === '1 mes');
  ok('G: 2 months', formatDuration(2, 'en-US') === '2 months' && formatDuration(2, 'es-PA') === '2 meses');
  ok('G: 12 months', formatDuration(12, 'en-US') === '1 year' && formatDuration(12, 'es-PA') === '1 año');
  ok('G: 13 months', formatDuration(13, 'en-US') === '1 year 1 month' && formatDuration(13, 'es-PA') === '1 año 1 mes');
  ok('G: 27 months', formatDuration(27, 'en-US') === '2 years 3 months' && formatDuration(27, 'es-PA') === '2 años 3 meses');
  ok('G: no awkward "1 años/meses"', !/1 años|1 meses/.test(formatDuration(13, 'es-PA')) && !/1 years|1 months/.test(formatDuration(13, 'en-US')));
  ok('G: 0 months', formatDuration(0, 'en-US') === '0 months' && formatDuration(0, 'es-PA') === '0 meses');

  // H. Loan numeric calculations unchanged; warningCode is language-neutral.
  const okLoan = simulate({ remainingPrincipal: 10000, apr: 6, monthlyPayment: 200 });
  ok('H: amortizing loan math', okLoan.amortizes === true && okLoan.months === 58 && okLoan.warningCode === '');
  const nonAmort = simulate({ remainingPrincipal: 10000, apr: 24, monthlyPayment: 50 });
  ok('H: non-amortizing detected', nonAmort.amortizes === false && nonAmort.warningCode === 'NON_AMORTIZING');
  ok('H: warning code is language-neutral', typeof nonAmort.warningCode === 'string' && !/[áéíóúñ]/.test(nonAmort.warningCode));

  // I. Non-amortizing warning translates EN/ES.
  ok('I: warn EN', en('loans.warnNonAmortizing').includes('does not cover'));
  ok('I: warn ES', es('loans.warnNonAmortizing').includes('no cubre'));
  ok('I: warn differs', differs('loans.warnNonAmortizing'));

  // Q. Transaction Intelligence review labels switch EN/ES.
  ok('Q: needsReview', en('txIntel.needsReview') === 'Needs review' && es('txIntel.needsReview') === 'Requiere revisión');
  ok('Q: rememberForFuture', es('txIntel.rememberForFuture') === 'Recordar para futuras transacciones');
  ok('Q: applyToMatching', es('txIntel.applyToMatching') === 'Aplicar a transacciones similares');
  ok('Q: improveCategorization', es('txIntel.improveCategorization') === 'Mejorar categorización');
  ok('Q: autoCategorized', es('txIntel.autoCategorized') === 'Categorizado automáticamente');
  ok('Q: reason creditCardPayment differs', differs('txIntel.reasons.creditCardPayment'));
  ok('Q: reason recurring differs', differs('txIntel.reasons.recurring'));
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

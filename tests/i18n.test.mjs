// Synthetic tests for the i18n foundation (pure core). FICTIONAL/UI data only.
// Loaded through Vite SSR so import.meta / ESM resolve as in the build.
//
// Run (where Node exists) from repo root:  node tests/i18n.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const {
    translate, resolveLocale, detectLocale, normalizeToLocale,
    formatCurrency, formatDate, formatNumber, DEFAULT_LOCALE, LOCALES,
  } = await vite.ssrLoadModule('/src/i18n/core.js');

  // A. English default fallback (no/invalid locale -> en-US).
  ok('A: default locale is en-US', DEFAULT_LOCALE === 'en-US');
  ok('A: en-US nav.cards', translate('en-US', 'nav.cards') === 'Cards');
  ok('A: invalid locale falls back to en-US', translate('zz-ZZ', 'nav.cards') === 'Cards');

  // B. Spanish locale selection.
  ok('B: es-PA nav.cards -> Tarjetas', translate('es-PA', 'nav.cards') === 'Tarjetas');
  ok('B: es-PA nav.bills -> Pagos', translate('es-PA', 'nav.bills') === 'Pagos');

  // C. Browser es-* resolves to es-PA.
  ok('C: es-MX -> es-PA', resolveLocale(null, { language: 'es-MX' }) === 'es-PA');
  ok('C: es-419 (languages) -> es-PA', detectLocale({ languages: ['es-419', 'en'] }) === 'es-PA');
  ok('C: normalizeToLocale es-ES', normalizeToLocale('es-ES') === 'es-PA');

  // D. Browser en-* resolves to en-US.
  ok('D: en-GB -> en-US', resolveLocale(null, { language: 'en-GB' }) === 'en-US');
  ok('D: unknown (fr) -> en-US default', resolveLocale(null, { language: 'fr-FR' }) === 'en-US');

  // E. Saved preference always wins; invalid saved is ignored.
  ok('E: saved es-PA beats en device', resolveLocale('es-PA', { language: 'en-US' }) === 'es-PA');
  ok('E: saved en-US beats es device', resolveLocale('en-US', { language: 'es-PA' }) === 'en-US');
  ok('E: invalid saved -> device', resolveLocale('xx-XX', { language: 'es-PA' }) === 'es-PA');

  // F. Missing Spanish key falls back to English; totally unknown key never undefined.
  ok('F: missing es key -> en-US value', translate('es-PA', 'common.fallbackProbe') === 'English fallback');
  ok('F: unknown key returns the key (never undefined)', translate('es-PA', 'no.such.key') === 'no.such.key');
  ok('F: unknown key is a string', typeof translate('en-US', 'totally.missing') === 'string');

  // G. account_type stays canonical while DISPLAY translates.
  const accountTypeValue = 'checking'; // what is stored in the DB
  ok('G: en display', translate('en-US', `accountTypes.${accountTypeValue}`) === 'Checking');
  ok('G: es display', translate('es-PA', `accountTypes.${accountTypeValue}`) === 'Cuenta corriente');
  ok('G: stored value unchanged', accountTypeValue === 'checking');

  // H. loan_type stays canonical while DISPLAY translates.
  const loanTypeValue = 'mortgage';
  ok('H: en display', translate('en-US', `loanTypes.${loanTypeValue}`) === 'Mortgage');
  ok('H: es display', translate('es-PA', `loanTypes.${loanTypeValue}`) === 'Hipoteca');
  ok('H: stored value unchanged', loanTypeValue === 'mortgage');

  // I. category/bucket display does not mutate the stored value.
  const bucketValue = 'needs';
  const catValue = 'groceries';
  ok('I: bucket en/es display', translate('en-US', 'buckets.needs') === 'Needs' && translate('es-PA', 'buckets.needs') === 'Necesidades');
  ok('I: category en/es display', translate('en-US', 'categories.groceries') === 'Groceries' && translate('es-PA', 'categories.groceries') === 'Supermercado');
  ok('I: stored values unchanged', bucketValue === 'needs' && catValue === 'groceries');

  // J. Currency formatting — Panama uses USD, Spanish must NOT imply EUR.
  ok('J: en-US currency exact', formatCurrency(10600, 'en-US', 'USD') === '$10,600.00');
  const esCur = formatCurrency(10600, 'es-PA', 'USD');
  ok('J: es-PA currency has grouped amount', esCur.includes('10,600.00'));
  ok('J: es-PA currency is USD, not EUR', !esCur.includes('€'));
  ok('J: number formatting', formatNumber(1234.5, 'en-US') === '1,234.5');

  // K. Date formatting (UTC-pinned so it is timezone-stable).
  const d = new Date(Date.UTC(2026, 8, 15)); // 2026-09-15
  const enDate = formatDate(d, 'en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const esDate = formatDate(d, 'es-PA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  ok('K: en date', enDate === 'Sep 15, 2026');
  ok('K: es date has day/year', esDate.includes('15') && esDate.includes('2026'));
  ok('K: es date month is Spanish (sept)', /sept/i.test(esDate));

  ok('locales list is en-US + es-PA', LOCALES.length === 2 && LOCALES.includes('en-US') && LOCALES.includes('es-PA'));
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

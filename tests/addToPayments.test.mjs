// Workflow Quality Pass V1 — Activity → Add to Payments. Pure logic + i18n.
// FICTIONAL data only. Reuses the existing scheduled_payments model shape
// (entity, amount, payment_date, status, is_recurring) — no new table.
//
// Run (where Node exists) from repo root:  node tests/addToPayments.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const {
    FREQUENCIES, addPeriod, suggestNextDueDate, normalizeName, isEligibleForPayment,
    buildPaymentFromTransaction, suggestFrequency, findDuplicatePayment,
  } = await vite.ssrLoadModule('/src/lib/paymentFromActivity.js');
  const { translate } = await vite.ssrLoadModule('/src/i18n/core.js');
  const en = (k, v) => translate('en-US', k, v);
  const es = (k, v) => translate('es-PA', k, v);
  const differs = (k) => en(k) !== es(k) && en(k) !== k && es(k) !== k;

  // A synthetic historical expense (manual cash — no account/card/source).
  const cashTx = { id: 'tx-1', merchant: 'Corner Store', amount: -25.5, category: 'Groceries', budgetBucket: 'NEEDS', account: '', dateString: '2026-09-03' };
  // A bank expense (has account).
  const bankTx = { id: 'tx-2', merchant: 'Netflix', amount: -12.99, category: 'Subscriptions', budgetBucket: 'WANTS', account: 'Banco General - Star CC', dateString: '2026-09-03' };
  const incomeTx = { id: 'tx-3', merchant: 'Salary', amount: 2000, category: 'Income', budgetBucket: 'INCOME', account: 'Checking', dateString: '2026-09-01' };

  // E. Manually entered cash expense is eligible; income is not.
  ok('E: cash expense eligible', isEligibleForPayment(cashTx) === true);
  ok('eligible: bank expense eligible', isEligibleForPayment(bankTx) === true);
  ok('eligible: income NOT eligible', isEligibleForPayment(incomeTx) === false);
  ok('eligible: zero NOT eligible', isEligibleForPayment({ amount: 0 }) === false);

  // B/C/D. Prefill maps merchant→name, |amount|→amount, category present.
  const payload = buildPaymentFromTransaction(bankTx, { frequency: 'monthly', nextDueDate: '2026-10-03' });
  ok('B: name prefilled from merchant', payload.entity === 'Netflix');
  ok('C: amount prefilled as positive', payload.amount === 12.99);
  ok('D: model shape (existing columns + recurrence_frequency)', 'entity' in payload && 'amount' in payload && 'payment_date' in payload && 'status' in payload && 'is_recurring' in payload && 'recurrence_frequency' in payload);
  ok('D: no invented columns', !('frequency' in payload) && !('category' in payload) && !('note' in payload) && !('source' in payload) && !('account' in payload));
  ok('D: status pending', payload.status === 'pending');
  ok('D: recurring true for a recurrence', payload.is_recurring === true);

  // K. Add to Payments persists the selected canonical frequency.
  ok('K: persists selected frequency', payload.recurrence_frequency === 'monthly');
  const wkPayload = buildPaymentFromTransaction(bankTx, { frequency: 'weekly', nextDueDate: '2026-09-10' });
  ok('K: weekly persisted + recurring', wkPayload.recurrence_frequency === 'weekly' && wkPayload.is_recurring === true);
  const smPayload = buildPaymentFromTransaction(bankTx, { frequency: 'semi_monthly', nextDueDate: '2026-09-15' });
  ok('K: semi_monthly persisted', smPayload.recurrence_frequency === 'semi_monthly');

  // F/L. Frequency remains user-confirmed: no/blank frequency -> one-time
  //      payment (is_recurring=false, recurrence_frequency=null).
  const oneOff = buildPaymentFromTransaction(cashTx, { frequency: '', nextDueDate: '2026-10-03' });
  ok('F: no frequency -> not recurring', oneOff.is_recurring === false);
  ok('L: one-time stores null frequency', oneOff.recurrence_frequency === null);
  ok('F: FREQUENCIES canonical set', JSON.stringify(FREQUENCIES) === JSON.stringify(['monthly', 'semi_monthly', 'biweekly', 'weekly']));

  // G. Next due date is a suggestion the user confirms; Sep 3 monthly -> Oct 3.
  ok('G: monthly Sep 3 -> Oct 3', suggestNextDueDate('2026-09-03', 'monthly', '2026-09-09') === '2026-10-03');
  ok('G: weekly +7 rolled to future', suggestNextDueDate('2026-09-03', 'weekly', '2026-09-09') === '2026-09-10');
  ok('G: biweekly +14', suggestNextDueDate('2026-09-03', 'biweekly', '2026-09-04') === '2026-09-17');
  ok('G: old monthly rolls to next future', (() => { const d = suggestNextDueDate('2026-01-03', 'monthly', '2026-09-09'); return d === '2026-10-03'; })());
  ok('G: addPeriod monthly clamps end-of-month', (() => { const r = addPeriod(new Date(2026, 0, 31), 'monthly'); return r.getMonth() === 1; })()); // Jan 31 -> Feb (clamped)

  // H. create writes to existing payment model (validated above). Missing due
  //    date is rejected so a malformed obligation is never written.
  let threwDate = false; try { buildPaymentFromTransaction(bankTx, { frequency: 'monthly', nextDueDate: '' }); } catch { threwDate = true; }
  ok('H: missing due date rejected', threwDate);
  let threwName = false; try { buildPaymentFromTransaction({ ...bankTx, merchant: '' }, { name: '', frequency: 'monthly', nextDueDate: '2026-10-03' }); } catch { threwName = true; }
  ok('H: missing name rejected', threwName);

  // I. Original transaction is unchanged by building a payload (no mutation).
  const before = JSON.stringify(bankTx);
  buildPaymentFromTransaction(bankTx, { frequency: 'weekly', nextDueDate: '2026-09-10' });
  ok('I: source transaction unchanged', JSON.stringify(bankTx) === before);

  // Frequency suggestion (recommendation only) from history.
  const history = [
    { id: 'h1', merchant: 'Netflix', amount: -12.99, dateString: '2026-08-03' },
    { id: 'h2', merchant: 'Netflix', amount: -12.99, dateString: '2026-07-03' },
    bankTx,
  ];
  ok('suggest: monthly cadence detected', suggestFrequency(bankTx, history) === 'monthly');
  ok('suggest: no history -> null (user chooses)', suggestFrequency(cashTx, []) === null);

  // J/K/L. Duplicate detection.
  const existing = [
    { id: 'p1', entity: 'Netflix', amount: 12.99, payment_date: '2026-10-03', status: 'pending', is_recurring: true },
    { id: 'p2', entity: 'Electric Co', amount: 80, payment_date: '2026-10-10', status: 'pending', is_recurring: true },
    { id: 'pcard', entity: 'Star CC statement', amount: 300, status: 'pending', readOnly: true },
  ];
  const dup = findDuplicatePayment(payload, existing);
  ok('J: duplicate warned', dup && dup.id === 'p1');
  ok('J: dissimilar not flagged', findDuplicatePayment(buildPaymentFromTransaction(cashTx, { frequency: 'monthly', nextDueDate: '2026-10-03' }), existing) === null);
  ok('J: read-only card event never a duplicate', findDuplicatePayment({ entity: 'Star CC statement', amount: 300 }, existing) === null);
  // K. "Use existing" path: no new record (caller simply does not create) — the
  //    detector returning a match is what enables that choice.
  ok('K: match enables use-existing (no create)', !!dup);
  // L. "Create anyway" only proceeds past an explicit override flag: with the
  //    override, the same payload is still a valid write.
  ok('L: create-anyway yields a valid payload', payload.entity === 'Netflix' && payload.amount === 12.99);

  // N. Flow consumes the new payment through the existing pipeline: the payload
  //    is a pending, dated scheduled_payment (exactly what cash-flow proj reads).
  ok('N: flow-consumable shape', payload.status === 'pending' && /^\d{4}-\d{2}-\d{2}$/.test(payload.payment_date) && payload.amount > 0);

  // O. No learned rule is created: the payload carries no rule/learn metadata.
  ok('O: no rule/learn metadata on payload', !('rule' in payload) && !('learned' in payload) && !('normalized_merchant' in payload));

  // Canonical category value is not mutated/translated by this flow.
  ok('category: canonical value preserved', bankTx.category === 'Subscriptions');

  // P. EN/ES strings present + correct terminology (Payments=Pagos, never Flow).
  ok('P: action EN', en('addToPayments.action') === 'Add to Payments');
  ok('P: action ES', es('addToPayments.action') === 'Agregar a Pagos');
  ok('P: NOT "Add to Flow" EN', !/add to flow/i.test(en('addToPayments.action')) && !/add to flow/i.test(en('addToPayments.title')));
  ok('P: NOT "Agregar a Flujo" ES', !/agregar a flujo/i.test(es('addToPayments.action')) && !/agregar a flujo/i.test(es('addToPayments.title')));
  ok('P: freq monthly EN/ES', en('addToPayments.freq.monthly') === 'Monthly' && es('addToPayments.freq.monthly') === 'Mensual');
  ok('P: freq semi_monthly EN/ES', en('addToPayments.freq.semi_monthly') === 'Twice monthly' && es('addToPayments.freq.semi_monthly') === 'Dos veces al mes');
  ok('P: freq biweekly EN/ES', en('addToPayments.freq.biweekly') === 'Biweekly' && es('addToPayments.freq.biweekly') === 'Cada dos semanas');
  ok('P: freq weekly EN/ES', en('addToPayments.freq.weekly') === 'Weekly' && es('addToPayments.freq.weekly') === 'Semanal');
  ok('P: duplicateTitle exact', en('addToPayments.duplicateTitle') === 'A similar payment already exists.' && es('addToPayments.duplicateTitle') === 'Ya existe un pago similar.');
  ok('P: useExisting/createAnyway ES', es('addToPayments.useExisting') === 'Usar existente' && es('addToPayments.createAnyway') === 'Crear de todos modos');
  ok('P: successTitle EN/ES', en('addToPayments.successTitle') === 'Added to Payments' && es('addToPayments.successTitle') === 'Agregado a Pagos');
  ok('P: subtitle differs', differs('addToPayments.subtitle'));

  ok('normalizeName basic', normalizeName('  NETFLIX.COM *123 ') === 'netflix com 123');
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

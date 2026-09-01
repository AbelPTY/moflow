// Synthetic tests for eligible-cash aggregation + per-account balance identity.
// FICTIONAL data only. Loaded through Vite SSR (pure module, no Supabase/env).
//
// Run (where Node exists) from repo root:  node tests/accountBalances.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const { eligibleCashByCurrency, eligibleCashTotal, hasKnownBalance, dedupeDetectedAccounts, matchAccountByName, normalizeAccountName } =
    await vite.ssrLoadModule('/src/lib/accountOptions.js');

  const acc = (id, name, type, balance, currency = 'USD', is_active = true) =>
    ({ id, account_name: name, account_type: type, current_balance: balance, currency, is_active });

  // A. Two savings accounts aggregate.
  const A = [acc('s1', 'Savings A', 'savings', 5000), acc('s2', 'Savings B', 'savings', 3000)];
  ok('A: two savings -> $8,000', eligibleCashTotal(A, 'USD') === 8000);
  ok('A: still two distinct accounts', A.length === 2 && A[0].id !== A[1].id);

  // B. Two checking + one savings aggregate.
  const B = [acc('c1', 'Checking A', 'checking', 2000), acc('c2', 'Checking B', 'checking', 1000), acc('s1', 'Savings A', 'savings', 3000)];
  ok('B: 2 checking + 1 savings -> $6,000', eligibleCashTotal(B, 'USD') === 6000);

  // C. Same account seen twice across screenshots -> not double counted (scanner dedupe).
  const twice = dedupeDetectedAccounts([
    { name: 'BG Savings', balance: 5000, type: 'savings' },
    { name: 'BG Savings', balance: 5000, type: 'savings' },
  ]);
  ok('C: duplicate scanned account collapses to one', twice.length === 1 && Number(twice[0].balance) === 5000);

  // D. Two DIFFERENT savings never deduped by type.
  const distinct = dedupeDetectedAccounts([
    { name: 'BG Savings', balance: 5000, type: 'savings' },
    { name: 'UNFCU Savings', balance: 3200, type: 'savings' },
  ]);
  ok('D: distinct savings stay separate', distinct.length === 2);

  // E. Investment excluded from available cash.
  const E = [acc('s1', 'Savings A', 'savings', 3000), acc('i1', 'Brokerage', 'investment', 50000)];
  ok('E: investment excluded from cash total', eligibleCashTotal(E, 'USD') === 3000);

  // F. Credit/loan-style types excluded (only checking/savings/cash count).
  const F = [acc('s1', 'Savings A', 'savings', 3000), acc('o1', 'Misc', 'other', 999)];
  ok('F: non-eligible type excluded', eligibleCashTotal(F, 'USD') === 3000);

  // G. Unknown/null balance distinguished from 0.
  ok('G: null balance is NOT known', hasKnownBalance({ current_balance: null }) === false);
  ok('G: undefined balance is NOT known', hasKnownBalance({}) === false);
  ok('G: zero balance IS known', hasKnownBalance({ current_balance: 0 }) === true);
  const G = [acc('s1', 'Savings A', 'savings', null), acc('s2', 'Savings B', 'savings', 0)];
  ok('G: null excluded, 0 included -> total 0', eligibleCashTotal(G, 'USD') === 0);
  ok('G: null account does not create a phantom currency', !('EUR' in eligibleCashByCurrency(G)));

  // H. Multiple currencies never combined.
  const H = [acc('s1', 'USD Savings', 'savings', 10600, 'USD'), acc('s2', 'Euro Savings', 'savings', 2000, 'EUR')];
  const byCur = eligibleCashByCurrency(H);
  ok('H: currencies kept separate', byCur.USD === 10600 && byCur.EUR === 2000);
  ok('H: USD total is only USD', eligibleCashTotal(H, 'USD') === 10600);
  ok('H: EUR total is only EUR', eligibleCashTotal(H, 'EUR') === 2000);

  // I. A balance write targets the correct account id, never "any savings".
  const savings = [acc('a', 'BG Savings', 'savings', null), acc('b', 'UNFCU Savings', 'savings', null)];
  ok('I: name resolves to the specific account id', matchAccountByName('UNFCU Savings', savings)?.id === 'b');
  ok('I: not the other same-type account', matchAccountByName('UNFCU Savings', savings)?.id !== 'a');
  ok('I: bare type resolves to nothing', matchAccountByName('savings', savings) === null);

  // Inactive eligible accounts are excluded from the total.
  const withInactive = [acc('s1', 'Savings A', 'savings', 3000), acc('s2', 'Closed Savings', 'savings', 9999, 'USD', false)];
  ok('inactive account excluded from cash total', eligibleCashTotal(withInactive, 'USD') === 3000);
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
